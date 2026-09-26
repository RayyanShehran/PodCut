(function (root, factory) {
  const core = typeof module === "object" && module.exports ? require("./core.js") : root.PodCutCore;
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PodCutApply = api;
})(typeof globalThis === "undefined" ? this : globalThis, function (core) {
  "use strict";

  let running = false;
  const completed = new Set();
  const id = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const requireTrue = (value, stage) => { if (value === false || value == null) throw new Error(`Premiere did not complete ${stage}.`); return value; };

  async function prepare(adapter, review) {
    if (!review || review.key === "generated" || !review.source || !review.recipe || !review.decisions)
      throw new Error("Analyze a Premiere sequence before applying edits.");
    if (review.currentRecipe !== review.recipe)
      throw new Error("The recipe changed after analysis. Analyze again.");
    const current = await adapter.inspect();
    if (current.key !== review.key || JSON.stringify(current.source) !== JSON.stringify(review.source))
      throw new Error("The source sequence changed after analysis. Analyze again.");
    const reason = core.simpleSourceError(current.source);
    if (reason) throw new Error(reason);
    const cuts = review.decisions.filter(d => d.enabled).map(d => ({ cutStart: d.cutStart, cutEnd: d.cutEnd }));
    const plan = core.planSimpleEdit({ durationSeconds: current.source.durationSeconds,
      sourceInSeconds: current.source.videoItems[0].inPoint, fps: current.source.fps, cuts });
    return { current, plan, cutCount: cuts.length, removedFrames: Math.round(current.source.durationSeconds * plan.fps) - plan.outputFrames,
      outputName: `${current.source.name} — PodCut` };
  }

  async function apply(adapter, review, onStage) {
    if (running) throw new Error("An Apply operation is already running.");
    running = true;
    const operation = { id: id(), status: "preflight", stages: [], originalSequenceId: null,
      candidateSequenceId: null, subclips: [], errors: [] };
    const stage = (name) => { operation.stages.push(name); if (onStage) onStage(name, operation); };
    const token = review && `${review.key}|${review.recipe}|${review.analysisId}`;
    try {
      if (completed.has(token)) throw new Error("This analysis was already applied. Analyze again for another output.");
      const prepared = await prepare(adapter, review);
      operation.originalSequenceId = prepared.current.source.sequenceId;
      operation.projectId = prepared.current.source.projectId;
      operation.sourceSnapshot = prepared.current.source;
      operation.plan = prepared.plan;
      operation.outputName = prepared.outputName;
      stage("ready");
      if (!review.confirmed) throw new Error("Confirm the frame-aligned edit before Apply.");
      stage("creating candidate");
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

  return { prepare, apply };
});
