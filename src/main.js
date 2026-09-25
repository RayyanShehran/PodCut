(function () {
  "use strict";
  const core = globalThis.PodCutCore;
  const host = globalThis.PodCutPremiere;
  const audio = globalThis.PodCutAudio;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  let recipe = core.recipeForPreset("natural");
  let sequenceInfo = null;
  let analysisResult = null;
  let reviewSource = null;
  let analyzing = false;
  let refreshing = false;
  let exportWaiting = false;
  let retryBlocked = false;
  let operationId = 0;
  let refreshId = 0;
  let elapsedTimer = null;
  let initialized = false;

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const getPath = (path) => path.split(".").reduce((value, key) => value[key], recipe);
  const sequenceKey = (info) => info && info.state === "ready"
    ? [info.name, info.durationSeconds, info.videoTracks, info.audioTracks, info.videoClips, info.audioClips].join("|")
    : info && info.state;

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
    analysisResult = null;
    reviewSource = null;
    $("#review").hidden = true;
  }

  function invalidateForRecipe() {
    if (reviewSource && reviewSource.recipe !== JSON.stringify(recipe)) clearAnalysis();
  }

  function syncControls() {
    const busy = analyzing || refreshing;
    $("#preset").disabled = busy;
    setActionDisabled("#refreshSequence", busy);
    setActionDisabled("#testAudio", busy);
    $$('[data-setting]').forEach((control) => {
      const operation = control.dataset.setting.split(".")[0];
      control.disabled = busy || !recipe[operation].enabled;
    });
    $$('[data-setting$=".enabled"]').forEach((control) => { control.disabled = busy; });
    const ready = sequenceInfo && sequenceInfo.state === "ready" && sequenceInfo.audioTracks > 0;
    setActionDisabled("#analyze", analyzing ? !exportWaiting : retryBlocked || refreshing || !ready);
    $("#analyze").textContent = analyzing ? (exportWaiting ? "Stop waiting" : "Analyzing…") : "Analyze Sequence";
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
    if (analyzing || refreshing) return;
    refreshing = true;
    const id = ++refreshId;
    syncControls();
    $("#sequenceName").textContent = "Checking Premiere…";
    $("#sequenceMeta").textContent = "";
    try {
      const next = await host.activeSequence();
      if (id !== refreshId || analyzing) return;
      if (sequenceInfo && (sequenceInfo.sequence !== next.sequence || sequenceKey(sequenceInfo) !== sequenceKey(next))) clearAnalysis();
      sequenceInfo = next;
      const ready = next.state === "ready";
      $("#sequenceDot").classList.toggle("ready", ready);
      $("#sequenceName").textContent = ready ? next.name : "No active sequence";
      $("#sequenceMeta").textContent = ready
        ? `${core.formatDuration(next.durationSeconds)} · ${next.videoTracks}V / ${next.audioTracks}A · ${next.videoClips + next.audioClips} clips`
        : next.message;
      if (manual && retryBlocked) retryBlocked = false;
      message(ready && next.audioTracks === 0 ? "This sequence has no audio tracks to analyze." : "", "warning");
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
    }
  }

  function removedSeconds() {
    return analysisResult.decisions.filter((decision) => decision.enabled).reduce((total, decision) => total + decision.removeSeconds, 0);
  }

  function renderSummary() {
    const removed = removedSeconds();
    $("#summary").innerHTML = [
      ["Silences", analysisResult.silenceCount], ["Proposed cuts", analysisResult.decisions.length], ["Long pauses", analysisResult.longPauseCount],
      ["Estimated removed", core.formatDuration(removed)], ["Original", core.formatDuration(analysisResult.durationSeconds)], ["Estimated edited", core.formatDuration(analysisResult.durationSeconds - removed)]
    ].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join("");
  }

  function renderReview(result, source) {
    analysisResult = result;
    reviewSource = source;
    $("#review").hidden = false;
    renderSummary();
    $("#decisions").innerHTML = result.decisions.length
      ? result.decisions.map((decision) => `<label><input type="checkbox" data-decision-id="${decision.id}" ${decision.enabled ? "checked" : ""} /><span><b>${decision.type === "long-pause" ? "Long pause" : "Silence"}</b><small>${core.formatTimestamp(decision.cutStart)} → ${core.formatTimestamp(decision.cutEnd)}</small></span><strong>Remove ${core.formatDuration(decision.removeSeconds)}</strong></label>`).join("")
      : '<p class="empty">No cuts meet the current recipe settings.</p>';
    setActionDisabled("#apply", true);
  }

  function generatedAudio() {
    const sampleRate = 1000;
    const segments = [[0.6, 0.2], [1.6, 0], [0.6, 0.2], [4.8, 0], [0.6, 0.2]];
    return { sampleRate, channels: [Float32Array.from(segments.flatMap(([seconds, level]) => Array(Math.round(seconds * sampleRate)).fill(level)))] };
  }

  async function analyzeTestAudio() {
    if (analyzing) return;
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
  }

  function teardown() {
    operationId += 1;
    refreshId += 1;
    clearTimer();
    if (exportWaiting) host.stopWaiting();
    analyzing = false;
    refreshing = false;
    exportWaiting = false;
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
    $("#preset").value = "natural";
    $("#preset").addEventListener("change", (event) => {
      if (event.target.value !== "custom") recipe = core.recipeForPreset(event.target.value);
      invalidateForRecipe();
      renderRecipe();
      message("", "");
    });
    $$('[data-setting]').forEach((input) => input.addEventListener("change", () => {
      const oldValue = getPath(input.dataset.setting);
      const value = input.type === "checkbox" ? input.checked : typeof oldValue === "number" ? Number(input.value) : input.value;
      setPath(input.dataset.setting, value);
      $("#preset").value = core.matchingPreset(recipe);
      invalidateForRecipe();
      renderRecipe();
      const errors = core.validateRecipe(recipe);
      message(errors[0] || "", errors.length ? "error" : "");
    }));
    $("#decisions").addEventListener("change", (event) => {
      const decision = analysisResult && analysisResult.decisions.find((item) => item.id === event.target.dataset.decisionId);
      if (decision) { decision.enabled = event.target.checked; renderSummary(); }
    });
    $("#advancedToggle").addEventListener("click", () => toggleDisclosure($("#advancedToggle"), $("#advancedSettings")));
    $("#developerToggle").addEventListener("click", () => toggleDisclosure($("#developerToggle"), $("#developerPanel")));
    $("#refreshSequence").addEventListener("click", () => refreshSequence(true));
    $("#analyze").addEventListener("click", analyzeSequence);
    $("#testAudio").addEventListener("click", analyzeTestAudio);
    $("#toggleDiagnostics").addEventListener("click", () => {
      const details = $("#diagnosticText");
      details.hidden = !details.hidden;
      $("#toggleDiagnostics").textContent = details.hidden ? "Show export diagnostics" : "Hide export diagnostics";
    });
    renderRecipe();
    refreshSequence(false);
    try { require("uxp").entrypoints.setup({ panels: { podcutPanel: { show: () => refreshSequence(false), destroy: teardown } } }); }
    catch (error) { console.info("PodCut running outside UXP; panel lifecycle unavailable."); }
  }

  init();
})();
