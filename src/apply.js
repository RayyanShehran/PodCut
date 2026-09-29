(function (root, factory) {
  const core = typeof module === "object" && module.exports ? require("./core.js") : root.PodCutCore;
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PodCutApply = api;
})(typeof globalThis === "undefined" ? this : globalThis, function (core) {
  "use strict";
  const MUTATION_ENABLED = false; // Production service lock; independent of panel appearance.

  let running = false;
  let preparing = false;
  const completed = new Set();
  const id = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const requireTrue = (value, stage) => { if (value === false || value == null) throw new Error(`Premiere did not complete ${stage}.`); return value; };
  function assertFresh(adapter, review) {
    if (adapter.sourceRevision && (!Number.isInteger(review.revision) || adapter.sourceRevision() !== review.revision))
      throw new Error("Sequence content changed after analysis, or change monitoring is unavailable. Analyze again.");
  }

  async function prepare(adapter, review, onProgress) {
    if (preparing) throw new Error("An Apply preflight is already running. Wait for its Premiere inspection to finish.");
    if (!review || review.key === "generated" || !review.source || !review.recipe || !review.decisions)
      throw new Error("Analyze a Premiere sequence before applying edits.");
    if (review.currentRecipe !== review.recipe)
      throw new Error("The recipe changed after analysis. Analyze again.");
    preparing = true;
    const runId = id();
    const started = Date.now();
    const pendingStages = new Set();
    let heartbeats = 0;
    const report = (stage, phase, detail) => {
      if (phase === "start") pendingStages.add(stage);
      else if (phase === "complete" || phase === "error") pendingStages.delete(stage);
      const entry = { runId, stage, phase, elapsedMs: Date.now() - started, ...(detail || {}) };
      console.info("PodCut preflight", JSON.stringify(entry));
      if (onProgress) onProgress(entry);
    };
    const heartbeat = setInterval(() => {
      report([...pendingStages].filter(stage => stage !== "inspect").join(", ") || "inspect", "pending");
      if (++heartbeats === 12) clearInterval(heartbeat); // Keep host work locked, but bound diagnostic output.
    }, 5000);
    try {
      assertFresh(adapter, review);
      report("inspect", "start");
      const current = await adapter.inspect(report);
      assertFresh(adapter, review);
      report("inspect", "complete");
      if (current.key !== review.key || JSON.stringify(current.source) !== JSON.stringify(review.source))
        throw new Error("The source sequence changed after analysis. Analyze again.");
      const reason = core.simpleSourceError(current.source);
      if (reason) throw new Error(reason);
      const cuts = review.decisions.filter(d => d.enabled).map(d => ({ cutStart: d.cutStart, cutEnd: d.cutEnd }));
      const plan = core.planSimpleEdit({ durationSeconds: current.source.durationSeconds,
        sourceInSeconds: current.source.videoItems[0].inPoint, fps: current.source.fps, cuts });
      return { current, plan, cutCount: cuts.length, removedFrames: Math.round(current.source.durationSeconds * plan.fps) - plan.outputFrames,
        outputName: `${current.source.name} — PodCut` };
    } catch (error) {
      report([...pendingStages].filter(stage => stage !== "inspect").join(", ") || "inspect", "error", { error: error.message || String(error) });
      throw error;
    } finally {
      clearInterval(heartbeat);
      preparing = false;
    }
  }

  async function apply(adapter, review, onStage) {
    if (!MUTATION_ENABLED) throw new Error("Automatic Apply is unavailable pending validation. Analysis and review remain available.");
    return execute(adapter, review, onStage);
  }

  async function prepareAssisted(adapter, review, onStage) {
    if (!review?.experimentalConfirmed) throw new Error("Explicit experimental assisted-draft confirmation is required.");
    if (typeof adapter.sourceRevision !== "function" || !Number.isInteger(review.revision))
      throw new Error("Source change monitoring is required for assisted drafts.");
    return execute(adapter, review, onStage, true);
  }

  async function execute(adapter, review, onStage, assisted = false) {
    if (running) throw new Error("An Apply operation is already running.");
    running = true;
    const operation = { id: id(), status: "preflight", stages: [], originalSequenceId: null,
      candidateSequenceId: null, subclips: [], errors: [] };
    const stage = (name) => { operation.stages.push(name); if (onStage) onStage(name, operation); };
    const token = review && `${review.key}|${review.recipe}|${review.analysisId}`;
    try {
      if (completed.has(token)) throw new Error("This analysis was already applied. Analyze again for another output.");
      const prepared = await prepare(adapter, review);
      if (assisted && (prepared.cutCount !== 1 || prepared.plan.fps !== 30 || prepared.plan.segments.length !== 2 ||
          !/\.prproj$/i.test(prepared.current.source.projectPath || "")))
        throw new Error("Assisted drafts require a saved project and exactly one enabled internal cut at 30 fps.");
      operation.originalSequenceId = prepared.current.source.sequenceId;
      operation.projectId = prepared.current.source.projectId;
      operation.sourceSnapshot = prepared.current.source;
      operation.plan = prepared.plan;
      operation.cutCount = prepared.cutCount;
      operation.outputName = prepared.outputName;
      stage("ready");
      if (!review.confirmed) throw new Error("Confirm the frame-aligned edit before Apply.");
      stage("creating candidate");
      assertFresh(adapter, review);
      operation.sourceRevision = review.revision;
      operation.candidateSequenceId = requireTrue(await adapter.createCandidate(operation), "candidate creation");
      for (const segment of prepared.plan.segments.slice(1)) {
        stage("creating retained subclip");
        operation.subclips.push(requireTrue(await adapter.createSubclip(operation, segment), "subclip creation"));
      }
      stage("editing candidate");
      requireTrue(await adapter.editCandidate(operation), "candidate edit");
      stage("verifying candidate");
      requireTrue(await adapter.verifyCandidate(operation), "candidate verification");
      stage("naming output");
      requireTrue(await adapter.nameCandidate(operation, prepared.outputName), "output naming");
      stage("opening output");
      requireTrue(await adapter.presentCandidate(operation), "output opening");
      operation.status = "completed";
      completed.add(token);
      stage("completed");
      return operation;
    } catch (error) {
      operation.status = "failed";
      operation.errors.push(error.message || String(error));
      try { await adapter.reconcile(operation); }
      catch (reconcileError) { operation.errors.push(`Artifact inspection failed: ${reconcileError.message || reconcileError}`); }
      if (operation.candidateSequenceId) {
        try { await adapter.nameCandidate(operation, `PodCut FAILED ${operation.id}`); }
        catch (nameError) { operation.errors.push(`Could not label partial candidate: ${nameError.message || nameError}`); }
      }
      try { await adapter.restoreOriginal(operation); }
      catch (restoreError) { operation.errors.push(`Could not reopen original: ${restoreError.message || restoreError}`); }
      stage("failed");
      return operation;
    } finally { running = false; }
  }

  return { prepare, apply, prepareAssisted };
});
