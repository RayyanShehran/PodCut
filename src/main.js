(function () {
  "use strict";
  const core = globalThis.PodCutCore;
  const host = globalThis.PodCutPremiere;
  const applyService = globalThis.PodCutApply;
  const audio = globalThis.PodCutAudio;
  const PUBLIC_APPLY_ENABLED = false; // Playback validation has not passed; keep the production action gated.
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  let recipe = core.recipeForPreset("natural");
  let sequenceInfo = null;
  let analysisResult = null;
  let reviewSource = null;
  let analyzing = false;
  let applying = false;
  let applyCheckId = 0;
  let readyApply = null;
  let refreshing = false;
  let refreshQueued = false;
  let exportWaiting = false;
  let retryBlocked = false;
  let operationId = 0;
  let refreshId = 0;
  let elapsedTimer = null;
  let initialized = false;
  let reviewFilter = "all";
  const settingsKey = "podcut.settings.v1";

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const getPath = (path) => path.split(".").reduce((value, key) => value[key], recipe);
  const sequenceKey = core.sequenceKey;

  function saveSettings() {
    if (core.validateRecipe(recipe).length) return;
    try {
      localStorage.setItem(settingsKey, JSON.stringify({ version: 1, recipe, preset: $("#preset").value,
        advanced: $("#advancedToggle").getAttribute("aria-expanded") === "true",
        developer: $("#developerToggle").getAttribute("aria-expanded") === "true" }));
    } catch (error) { console.warn("PodCut could not save settings", error); }
  }

  function restoreSettings() {
    let raw = null;
    try { raw = localStorage.getItem(settingsKey); } catch (error) { console.warn("PodCut could not read settings", error); }
    const saved = core.readSettings(raw);
    recipe = saved.recipe;
    $("#preset").value = saved.preset;
    for (const [id, expanded] of [["advanced", saved.advanced], ["developer", saved.developer]]) {
      $(`#${id}Toggle`).setAttribute("aria-expanded", String(expanded));
      $(`#${id === "advanced" ? "advancedSettings" : "developerPanel"}`).hidden = !expanded;
    }
  }

  function setPath(path, value) {
    const keys = path.split(".");
    let target = recipe;
    keys.slice(0, -1).forEach((key) => { target = target[key]; });
    target[keys[keys.length - 1]] = value;
  }

  function message(text, kind) {
    const box = $("#message");
    box.hidden = !text;
    box.textContent = text || "";
    box.className = `message ${kind || ""}`;
  }

  function progress(stage, detail, completed, total, elapsedMs) {
    const panel = $("#progress");
    const track = $("#progressTrack");
    panel.hidden = false;
    $("#progressStage").textContent = stage;
    $("#progressDetail").textContent = detail || "";
    const determinate = Number.isFinite(completed) && Number.isFinite(total) && total > 0;
    track.classList.toggle("indeterminate", !determinate);
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    if (determinate) {
      const percent = Math.min(100, Math.round(completed / total * 100));
      $("#progressFill").style.width = `${percent}%`;
      $("#progressValue").textContent = `${percent}%`;
      track.setAttribute("aria-valuenow", String(percent));
    } else {
      $("#progressFill").style.width = "";
      $("#progressValue").textContent = elapsedMs === undefined ? "" : formatElapsed(elapsedMs);
      track.removeAttribute("aria-valuenow");
    }
  }

  function formatElapsed(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function showDiagnostics(entries) {
    if (!entries || !entries.length) return;
    $("#toggleDiagnostics").hidden = false;
    $("#diagnosticText").textContent = entries.map((entry) => `${entry.elapsedMs}ms ${entry.stage} ${JSON.stringify(entry.detail)}`).join("\n");
  }

  function clearTimer() {
    if (elapsedTimer) clearInterval(elapsedTimer);
    elapsedTimer = null;
  }

  function isCurrent(id) { return id === operationId; }

  function setActionDisabled(selector, disabled) {
    const control = $(selector);
    control.setAttribute("aria-disabled", String(Boolean(disabled)));
    control.tabIndex = disabled ? -1 : 0;
  }

  function clearAnalysis() {
    applyCheckId += 1;
    readyApply = null;
    analysisResult = null;
    reviewSource = null;
    $("#review").hidden = true;
    $("#progress").hidden = true;
    $("#toggleDiagnostics").hidden = true;
    $("#diagnosticText").hidden = true;
    $("#applyConfirmation").hidden = true;
  }

  function invalidateForRecipe() {
    if (reviewSource && reviewSource.recipe !== JSON.stringify(recipe)) {
      clearAnalysis();
      message("Recipe changed. Analyze again to refresh the review.", "warning");
      return true;
    }
    return false;
  }

  function syncControls() {
    const busy = analyzing || refreshing || applying;
    $("#preset").disabled = busy;
    setActionDisabled("#refreshSequence", busy);
    setActionDisabled("#testAudio", busy);
    setActionDisabled("#resetSettings", busy);
    $$('[data-setting]').forEach((control) => {
      const operation = control.dataset.setting.split(".")[0];
      control.disabled = busy || !recipe[operation].enabled;
    });
    $$('[data-setting$=".enabled"]').forEach((control) => { control.disabled = busy; });
    $$('#decisions input[type="checkbox"]').forEach((control) => { control.disabled = busy; });
    $$('[data-filter], #enableVisible, #disableVisible, [data-locate-id]').forEach((control) =>
      setActionDisabledControl(control, busy || (control.dataset.locateId && reviewSource?.key === "generated")));
    const ready = sequenceInfo && sequenceInfo.state === "ready" && sequenceInfo.audioTracks > 0;
    setActionDisabled("#analyze", applying || (analyzing ? !exportWaiting : retryBlocked || refreshing || !ready));
    $("#analyze").textContent = analyzing ? (exportWaiting ? "Stop waiting" : "Analyzing…") : "Analyze Sequence";
  }

  function setActionDisabledControl(control, disabled) {
    control.setAttribute("aria-disabled", String(Boolean(disabled)));
    control.tabIndex = disabled ? -1 : 0;
  }

  function renderRecipe() {
    $$('[data-setting]').forEach((input) => {
      const value = getPath(input.dataset.setting);
      if (input.type === "checkbox") input.checked = value;
      else input.value = value;
    });
    ["cutSilence", "longPauses"].forEach((key) => {
      $(`[data-settings-for="${key}"]`).classList.toggle("disabled", !recipe[key].enabled);
    });
    const enabled = [recipe.cutSilence, recipe.longPauses].filter((item) => item.enabled).length;
    $("#recipeStatus").textContent = `${enabled} tool${enabled === 1 ? "" : "s"} enabled`;
    syncControls();
  }

  async function refreshSequence(manual) {
    if (analyzing || applying) return;
    if (refreshing) { refreshQueued = true; return; }
    refreshing = true;
    const id = ++refreshId;
    syncControls();
    $("#sequenceName").textContent = "Checking Premiere…";
    $("#sequenceMeta").textContent = "";
    try {
      const next = await host.activeSequence();
      if (id !== refreshId || analyzing) return;
      const stale = reviewSource && reviewSource.key !== "generated" && reviewSource.key !== sequenceKey(next);
      if (stale) clearAnalysis();
      sequenceInfo = next;
      const ready = next.state === "ready";
      $("#sequenceDot").classList.toggle("ready", ready);
      $("#sequenceName").textContent = ready ? next.name : "No active sequence";
      $("#sequenceMeta").textContent = ready
        ? `${core.formatDuration(next.durationSeconds)} · ${next.videoTracks}V / ${next.audioTracks}A · ${next.videoClips + next.audioClips} clips`
        : next.message;
      if (manual && retryBlocked) retryBlocked = false;
      if (stale) message("Active sequence or available metadata changed. Analyze again.", "warning");
      else if (ready && next.audioTracks === 0) message("This sequence has no audio tracks to analyze.", "warning");
      else if (!analysisResult) message("", "");
    } catch (error) {
      if (id !== refreshId) return;
      sequenceInfo = { state: "error" };
      $("#sequenceDot").classList.remove("ready");
      $("#sequenceName").textContent = "Sequence inspection failed";
      $("#sequenceMeta").textContent = "Refresh after checking the project.";
      console.error("PodCut sequence inspection failed", error);
      message("Could not read the active sequence. Refresh after checking the project and plugin permissions.", "error");
    } finally {
      if (id === refreshId) refreshing = false;
      syncControls();
      if (!refreshing && refreshQueued) {
        refreshQueued = false;
        refreshSequence(false);
      }
    }
  }

  function activeSourceChanged() {
    if (applying) return;
    clearAnalysis();
    sequenceInfo = null;
    $("#sequenceName").textContent = "Checking Premiere…";
    $("#sequenceMeta").textContent = "";
    syncControls();
    if (!analyzing) refreshSequence(false);
  }

  function renderSummary() {
    const totals = core.reviewTotals(analysisResult);
    $("#summary").innerHTML = [
      ["Silences", analysisResult.silenceCount], ["Enabled / total", `${totals.enabled} / ${analysisResult.decisions.length}`], ["Long pauses", analysisResult.longPauseCount],
      ["Estimated removed", core.formatDuration(totals.removed)], ["Original", core.formatDuration(analysisResult.durationSeconds)], ["Estimated edited", core.formatDuration(totals.edited)]
    ].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join("");
  }

  function renderFilter() {
    $$('[data-filter]').forEach((control) => control.setAttribute("aria-pressed", String(control.dataset.filter === reviewFilter)));
    $$("#decisions .decision").forEach((row) => {
      const enabled = row.querySelector('input[type="checkbox"]').checked;
      row.hidden = reviewFilter !== "all" && enabled !== (reviewFilter === "enabled");
    });
  }

  function setVisibleDecisions(enabled) {
    if (!analysisResult || applying) return;
    const visible = core.filteredDecisions(analysisResult, reviewFilter);
    visible.forEach((decision) => { decision.enabled = enabled; });
    const byId = new Map(analysisResult.decisions.map((decision) => [decision.id, decision]));
    $$("#decisions .decision").forEach((row) => { row.querySelector('input[type="checkbox"]').checked = byId.get(row.dataset.id).enabled; });
    renderSummary();
    renderFilter();
    refreshApplyState();
  }

  function applyReview(confirmed) {
    return { key: reviewSource.key, recipe: reviewSource.recipe, currentRecipe: JSON.stringify(recipe),
      source: reviewSource.applySnapshot, analysisId: reviewSource.analysisId,
      decisions: analysisResult.decisions, confirmed };
  }

  async function refreshApplyState() {
    const id = ++applyCheckId;
    readyApply = null;
    setActionDisabled("#apply", true);
    $("#applyConfirmation").hidden = true;
    if (!analysisResult || !reviewSource) return;
    if (reviewSource.key === "generated") { $("#applyStatus").textContent = "Generated audio cannot be applied to a Premiere sequence."; return; }
    if (reviewSource.applyError || !reviewSource.applySnapshot) {
      $("#applyStatus").textContent = `Unsupported: ${reviewSource.applyError || "Source inspection unavailable."}`; return;
    }
    $("#applyStatus").textContent = "Checking source layout and frame plan…";
    try {
      const prepared = await applyService.prepare(host.applyAdapter(), applyReview(false));
      if (id !== applyCheckId || applying) return;
      readyApply = prepared;
      const removed = (prepared.removedFrames / prepared.plan.fps).toFixed(3);
      const kept = (prepared.plan.outputFrames / prepared.plan.fps).toFixed(3);
      $("#applyStatus").textContent = `Ready for confirmation: ${prepared.cutCount} cuts; remove ${prepared.removedFrames} frames (${removed}s), retain ${prepared.plan.outputFrames} frames (${kept}s). ${PUBLIC_APPLY_ENABLED ? "" : "Apply remains locked pending playback validation."}`;
      setActionDisabled("#apply", !PUBLIC_APPLY_ENABLED);
    } catch (error) {
      if (id !== applyCheckId || applying) return;
      $("#applyStatus").textContent = `Unsupported or stale: ${error.message || error}`;
    }
  }

  async function confirmApply() {
    if (!PUBLIC_APPLY_ENABLED || !readyApply || applying || !reviewSource) return;
    $("#applyConfirmationText").textContent = `Create “${readyApply.outputName}” from “${readyApply.current.source.name}”? ${readyApply.cutCount} enabled cuts remove ${readyApply.removedFrames} frames (${(readyApply.removedFrames / readyApply.plan.fps).toFixed(3)}s). Only one online V1/A1 source clip with no extra content is supported. Premiere will add a new sequence and retained subclips; the original remains untouched.`;
    $("#applyConfirmation").hidden = false;
  }

  async function runApply() {
    if (!PUBLIC_APPLY_ENABLED || !readyApply || applying || !reviewSource) return;
    const review = applyReview(true);
    applying = true;
    applyCheckId += 1;
    $("#applyConfirmation").hidden = true;
    syncControls();
    try {
      const operation = await applyService.apply(host.applyAdapter(), review, (stage) => {
        progress(stage[0].toUpperCase() + stage.slice(1), "Premiere candidate sequence; no project save requested");
      });
      if (operation.status === "completed") {
        $("#progress").hidden = true;
        $("#applyStatus").textContent = `Completed: ${operation.outputName} (${operation.candidateSequenceId}).`;
        message(`Verified new sequence “${operation.outputName}”. The source is unchanged. Undo is not one-step: the first Undo reverses output naming; the candidate edit, subclips, and clone have separate history entries.`, "");
      } else {
        $("#progress").hidden = true;
        $("#applyStatus").textContent = `Failed operation ${operation.id}. Partial candidate: ${operation.candidateSequenceId || "not identified"}. Subclips: ${operation.subclips.map(s => s.id || s).join(", ") || "none"}.`;
        message(`${operation.errors.join(" ")} Original review retained. Inspect the labeled partial candidate and subclips in Premiere; retry creates a fresh candidate.`, "error");
      }
    } catch (error) {
      $("#progress").hidden = true;
      message(error.message || "Apply failed before candidate creation.", "error");
    } finally {
      applying = false;
      syncControls();
    }
  }

  function renderReview(result, source) {
    analysisResult = result;
    reviewSource = source;
    $("#review").hidden = false;
    renderSummary();
    $("#decisions").innerHTML = result.decisions.length
      ? result.decisions.map((decision) => `<div class="decision" data-id="${decision.id}"><label><input type="checkbox" data-decision-id="${decision.id}" ${decision.enabled ? "checked" : ""} /><span><b>${decision.type === "long-pause" ? "Long pause" : "Silence"}</b><small>${core.formatTimestamp(decision.cutStart)} → ${core.formatTimestamp(decision.cutEnd)}</small></span></label><strong>−${core.formatDuration(decision.removeSeconds)}</strong><div class="locate text-button" role="button" tabindex="${source.key === "generated" ? "-1" : "0"}" aria-disabled="${source.key === "generated"}" data-locate-id="${decision.id}">Locate</div></div>`).join("")
      : '<p class="empty">No cuts meet the current recipe settings.</p>';
    renderFilter();
    setActionDisabled("#apply", true);
    refreshApplyState();
  }

  function generatedAudio() {
    const sampleRate = 1000;
    const segments = [[0.6, 0.2], [1.6, 0], [0.6, 0.2], [4.8, 0], [0.6, 0.2]];
    return { sampleRate, channels: [Float32Array.from(segments.flatMap(([seconds, level]) => Array(Math.round(seconds * sampleRate)).fill(level)))] };
  }

  async function analyzeTestAudio() {
    if (analyzing || applying) return;
    const errors = core.validateRecipe(recipe);
    if (errors.length) return message(errors[0], "error");
    const id = ++operationId;
    const recipeSnapshot = clone(recipe);
    analyzing = true;
    syncControls();
    try {
      progress("Analyzing", "Generated development audio", 0, 1);
      const result = await core.analyzeAudioAsync(generatedAudio(), recipeSnapshot, (done, total) => {
        if (isCurrent(id)) progress("Analyzing", `${done} of ${total} frames`, done, total);
      });
      if (!isCurrent(id)) return;
      renderReview(result, { recipe: JSON.stringify(recipeSnapshot), sequence: null, key: "generated" });
      $("#reviewLabel").textContent = "Generated PCM";
      progress("Ready", "Review the detected edits below", 1, 1);
      message("Generated PCM analysis complete. No Premiere media was used.", "");
    } catch (error) {
      if (!isCurrent(id)) return;
      console.error("PodCut generated analysis failed", error);
      $("#progress").hidden = true;
      message(error.message || "Generated audio analysis failed.", "error");
    } finally {
      if (isCurrent(id)) analyzing = false;
      syncControls();
    }
  }

  async function analyzeSequence() {
    if (applying) return;
    if (analyzing) {
      if (exportWaiting) {
        host.stopWaiting();
        message("Stopping PodCut’s wait. Premiere’s export is not cancelled.", "warning");
      }
      return;
    }
    const errors = core.validateRecipe(recipe);
    if (errors.length) return message(errors[0], "error");
    if (!sequenceInfo || sequenceInfo.state !== "ready") return;
    const id = ++operationId;
    const recipeSnapshot = clone(recipe);
    const source = { recipe: JSON.stringify(recipeSnapshot), sequence: sequenceInfo.sequence, key: sequenceKey(sequenceInfo) };
    analyzing = true;
    exportWaiting = true;
    syncControls();
    $("#toggleDiagnostics").hidden = true;
    $("#diagnosticText").hidden = true;
    const exportStartedAt = Date.now();
    let latestDetail = "Resolving Premiere paths and WAV preset";
    progress("Preparing", latestDetail, undefined, undefined, 0);
    elapsedTimer = setInterval(() => {
      if (isCurrent(id) && exportWaiting) $("#progressValue").textContent = formatElapsed(Date.now() - exportStartedAt);
    }, 1000);
    message("Premiere is rendering temporary sequence audio. The timeline remains unchanged.", "");
    try {
      const wav = await host.sequenceAudio(source.sequence, (status) => {
        if (!isCurrent(id)) return;
        latestDetail = status.stage === "waiting" ? `Promise ${status.detail.promise}; event ${status.detail.event}; output ${status.detail.output}` : JSON.stringify(status.detail);
        progress(status.stage === "preparing" || status.stage === "preset" ? "Preparing" : "Exporting audio", latestDetail, undefined, undefined, status.elapsedMs);
        showDiagnostics(status.diagnostics);
      });
      if (!isCurrent(id)) return;
      exportWaiting = false;
      clearTimer();
      syncControls();
      const pcm = await audio.decodeWavAsync(wav, (done, total) => {
        if (isCurrent(id)) progress("Decoding", `${done} of ${total} samples`, done, total);
      });
      if (!isCurrent(id)) return;
      const result = await core.analyzeAudioAsync(pcm, recipeSnapshot, (done, total) => {
        if (isCurrent(id)) progress("Analyzing", `${done} of ${total} frames`, done, total);
      });
      if (!isCurrent(id)) return;
      const current = await host.activeSequence();
      if (!isCurrent(id)) return;
      if (sequenceKey(current) !== source.key) {
        sequenceInfo = current;
        clearAnalysis();
        throw new Error("The active sequence changed during analysis. Refresh and analyze again.");
      }
      try {
        const inspected = await host.applyAdapter().inspect();
        if (inspected.key !== source.key) throw new Error("Source changed after analysis.");
        source.applySnapshot = inspected.source;
      } catch (error) { source.applyError = error.message || String(error); }
      source.analysisId = id;
      renderReview(result, source);
      $("#reviewLabel").textContent = "Premiere sequence";
      progress("Ready", "Review the detected edits below", 1, 1);
      message("Sequence audio analysis complete. Review only; timeline editing remains disabled.", "");
    } catch (error) {
      if (!isCurrent(id)) return;
      console.error("PodCut sequence analysis failed", error);
      showDiagnostics(error.diagnostics);
      $("#progress").hidden = true;
      if (error.code === "STOPPED_WAITING" || error.code === "EXPORT_TIMEOUT") {
        retryBlocked = true;
        message(`${error.message} After Premiere export activity ends, refresh the sequence to retry.`, "error");
      } else message(error.message || "Sequence audio analysis failed. Open Developer for diagnostics.", "error");
    } finally {
      if (isCurrent(id)) {
        clearTimer();
        analyzing = false;
        exportWaiting = false;
      }
      syncControls();
    }
  }

  function toggleDisclosure(button, panel) {
    const expanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!expanded));
    panel.hidden = expanded;
    saveSettings();
  }

  function onShow(rootNode) {
    const app = $("#app");
    if (rootNode && rootNode.appendChild && rootNode.contains && !rootNode.contains(app)) rootNode.appendChild(app);
    app.hidden = false;
    if (!analyzing && !applying) refreshSequence(false);
  }

  async function locateDecision(id) {
    if (applying) return;
    const decision = analysisResult && analysisResult.decisions.find((item) => item.id === id);
    if (!decision || !reviewSource || reviewSource.key === "generated") return;
    try {
      const current = await host.activeSequence();
      const seconds = core.locateSeconds(reviewSource, current, decision, recipe);
      if (seconds === null) {
        clearAnalysis();
        message("Review no longer matches the active sequence. Analyze again.", "warning");
        return;
      }
      await host.setPlayerPosition(current.sequence, seconds);
    } catch (error) {
      console.error("PodCut locate failed", error);
      message(error.message || "Could not locate this decision. Refresh the sequence and retry.", "error");
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;
    $$('[role="button"]').forEach((control) => {
      control.addEventListener("click", (event) => {
        if (control.getAttribute("aria-disabled") === "true") event.stopImmediatePropagation();
      });
      control.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
        event.preventDefault();
        if (control.getAttribute("aria-disabled") !== "true") control.click();
      });
    });
    Object.entries(core.PRESETS).forEach(([id, preset]) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = preset.label;
      $("#preset").appendChild(option);
    });
    const custom = document.createElement("option");
    custom.value = "custom";
    custom.textContent = "Custom";
    $("#preset").appendChild(custom);
    restoreSettings();
    $("#preset").addEventListener("change", (event) => {
      if (event.target.value !== "custom") recipe = core.recipeForPreset(event.target.value);
      invalidateForRecipe();
      renderRecipe();
      saveSettings();
    });
    $$('[data-setting]').forEach((input) => input.addEventListener("change", () => {
      const oldValue = getPath(input.dataset.setting);
      const value = input.type === "checkbox" ? input.checked : typeof oldValue === "number" ? Number(input.value) : input.value;
      setPath(input.dataset.setting, value);
      $("#preset").value = core.matchingPreset(recipe);
      const stale = invalidateForRecipe();
      renderRecipe();
      const errors = core.validateRecipe(recipe);
      if (errors.length) message(errors[0], "error");
      else if (!stale) message("", "");
      saveSettings();
    }));
    $("#decisions").addEventListener("change", (event) => {
      const decision = analysisResult && analysisResult.decisions.find((item) => item.id === event.target.dataset.decisionId);
      if (decision && !applying) { decision.enabled = event.target.checked; renderSummary(); renderFilter(); refreshApplyState(); }
    });
    $("#decisions").addEventListener("click", (event) => {
      const control = event.target.closest("[data-locate-id]");
      if (control && control.getAttribute("aria-disabled") !== "true") locateDecision(control.dataset.locateId);
    });
    $("#decisions").addEventListener("keydown", (event) => {
      if (event.target.dataset.locateId && (event.key === "Enter" || event.key === " " || event.key === "Spacebar")) {
        event.preventDefault();
        event.target.click();
      }
    });
    $$('[data-filter]').forEach((control) => control.addEventListener("click", () => {
      reviewFilter = control.dataset.filter;
      if (analysisResult) renderFilter();
    }));
    $("#enableVisible").addEventListener("click", () => setVisibleDecisions(true));
    $("#disableVisible").addEventListener("click", () => setVisibleDecisions(false));
    $("#advancedToggle").addEventListener("click", () => toggleDisclosure($("#advancedToggle"), $("#advancedSettings")));
    $("#developerToggle").addEventListener("click", () => toggleDisclosure($("#developerToggle"), $("#developerPanel")));
    $("#refreshSequence").addEventListener("click", () => refreshSequence(true));
    $("#analyze").addEventListener("click", analyzeSequence);
    $("#apply").addEventListener("click", confirmApply);
    $("#confirmApply").addEventListener("click", runApply);
    $("#cancelApply").addEventListener("click", () => { $("#applyConfirmation").hidden = true; });
    $("#testAudio").addEventListener("click", analyzeTestAudio);
    $("#toggleDiagnostics").addEventListener("click", () => {
      const details = $("#diagnosticText");
      details.hidden = !details.hidden;
      $("#toggleDiagnostics").textContent = details.hidden ? "Show export diagnostics" : "Hide export diagnostics";
    });
    $("#resetSettings").addEventListener("click", () => {
      if (analyzing || refreshing) return;
      try { localStorage.removeItem(settingsKey); } catch (error) { console.warn("PodCut could not clear settings", error); }
      recipe = core.recipeForPreset("natural");
      $("#preset").value = "natural";
      $("#advancedToggle").setAttribute("aria-expanded", "false");
      $("#advancedSettings").hidden = true;
      $("#developerToggle").setAttribute("aria-expanded", "false");
      $("#developerPanel").hidden = true;
      invalidateForRecipe();
      renderRecipe();
      message("Settings reset to Natural Podcast.", "");
    });
    const icon = $("#refreshIcon");
    icon.addEventListener("load", () => { icon.hidden = false; $("#refreshFallback").hidden = true; });
    icon.addEventListener("error", () => { icon.hidden = true; $("#refreshFallback").hidden = false; });
    if (icon.complete && icon.naturalWidth > 0) { icon.hidden = false; $("#refreshFallback").hidden = true; }
    renderRecipe();
    host.onActiveSourceChanged(activeSourceChanged);
    refreshSequence(false);
    try { require("uxp").entrypoints.setup({ panels: { podcutPanel: { show: onShow } } }); }
    catch (error) { console.info("PodCut running outside UXP; panel lifecycle unavailable."); }
  }

  init();
})();
