(function () {
  "use strict";
  const core = globalThis.PodCutCore;
  const host = globalThis.PodCutPremiere;
  let recipe = core.recipeForPreset("natural");
  let sequenceInfo = null;
  let analysisResult = null;
  let analyzing = false;
  let exportWaiting = false;
  let retryBlocked = false;
  let elapsedTimer = null;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const getPath = (path) => path.split(".").reduce((value, key) => value[key], recipe);

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
    if (determinate) {
      const percent = Math.min(100, Math.round(completed / total * 100));
      $("#progressFill").style.width = `${percent}%`;
      $("#progressValue").textContent = `${percent}%`;
      track.setAttribute("aria-valuenow", String(percent));
    } else {
      $("#progressFill").style.width = "";
      $("#progressValue").textContent = elapsedMs === undefined ? "" : `${Math.floor(elapsedMs / 60000)}:${String(Math.floor(elapsedMs / 1000) % 60).padStart(2, "0")}`;
      track.removeAttribute("aria-valuenow");
    }
  }

  function showDiagnostics(entries) {
    if (!entries || !entries.length) return;
    $("#diagnostics").hidden = false;
    $("#diagnosticText").textContent = entries.map((entry) => `${entry.elapsedMs}ms ${entry.stage} ${JSON.stringify(entry.detail)}`).join("\n");
  }

  function renderRecipe() {
    $$('[data-setting]').forEach((input) => {
      const value = getPath(input.dataset.setting);
      if (input.type === "checkbox") input.checked = value;
      else input.value = value;
    });
    ["cutSilence", "fillerWords", "longPauses"].forEach((key) => {
      const panel = $(`[data-settings-for="${key}"]`);
      panel.classList.toggle("disabled", !recipe[key].enabled);
      panel.querySelectorAll("input, select").forEach((control) => { control.disabled = !recipe[key].enabled; });
    });
    const enabled = [recipe.cutSilence, recipe.fillerWords, recipe.longPauses].filter((item) => item.enabled).length;
    $("#recipeStatus").textContent = `${enabled} of 3 enabled`;
  }

  function setBusy(value) {
    $("#analyze").disabled = retryBlocked || value || !sequenceInfo || sequenceInfo.state !== "ready" || sequenceInfo.audioTracks === 0;
    $("#testAudio").disabled = value;
    $("#refreshSequence").disabled = value;
  }

  function clearAnalysis() {
    analysisResult = null;
    $("#review").hidden = true;
  }

  async function refreshSequence() {
    setBusy(true);
    $("#sequenceName").textContent = "Checking Premiere…";
    $("#sequenceMeta").textContent = "";
    try {
      sequenceInfo = await host.activeSequence();
      const ready = sequenceInfo.state === "ready";
      $("#sequenceDot").classList.toggle("ready", ready);
      $("#sequenceName").textContent = ready ? sequenceInfo.name : "No active sequence";
      $("#sequenceMeta").textContent = ready
        ? `${core.formatDuration(sequenceInfo.durationSeconds)} · ${sequenceInfo.videoTracks}V / ${sequenceInfo.audioTracks}A · ${sequenceInfo.videoClips + sequenceInfo.audioClips} clips`
        : sequenceInfo.message;
      message(ready
        ? sequenceInfo.audioTracks === 0
          ? "This sequence has no audio tracks to analyze."
          : "Ready to analyze the active sequence. Premiere will render temporary audio without changing the timeline."
        : "", "warning");
    } catch (error) {
      sequenceInfo = { state: "error" };
      $("#sequenceDot").classList.remove("ready");
      $("#sequenceName").textContent = "Sequence inspection failed";
      $("#sequenceMeta").textContent = "See the developer console for details.";
      console.error("PodCut sequence inspection failed", error);
      message("Could not read the active sequence. Refresh after checking the project and plugin permissions.", "error");
    } finally { setBusy(false); }
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

  function renderReview(result) {
    analysisResult = result;
    $("#review").hidden = false;
    renderSummary();
    $("#decisions").innerHTML = result.decisions.length
      ? result.decisions.map((decision) => `<label><input type="checkbox" data-decision-id="${decision.id}" checked /><span><b>${decision.type === "long-pause" ? "Long pause" : "Silence"}</b><small>${core.formatTimestamp(decision.cutStart)} → ${core.formatTimestamp(decision.cutEnd)}</small></span><strong>Remove ${core.formatDuration(decision.removeSeconds)}</strong></label>`).join("")
      : '<p class="empty">No cuts meet the current recipe settings.</p>';
    $("#apply").disabled = true;
    $("#review").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function generatedAudio() {
    const sampleRate = 1000;
    const segments = [
      [0.6, 0.2], [1.6, 0], [0.6, 0.2], [4.8, 0], [0.6, 0.2]
    ];
    return {
      sampleRate,
      channels: [Float32Array.from(segments.flatMap(([seconds, level]) => Array(Math.round(seconds * sampleRate)).fill(level)))]
    };
  }

  async function analyzeTestAudio() {
    const errors = core.validateRecipe(recipe);
    if (errors.length) return message(errors[0], "error");
    setBusy(true);
    $("#testAudio").textContent = "Analyzing…";
    try {
      progress("Analyzing", "Generated development audio", 0, 1);
      renderReview(await core.analyzeAudioAsync(generatedAudio(), recipe, (done, total) => progress("Analyzing", `${done} of ${total} frames`, done, total)));
      $("#reviewLabel").textContent = "GENERATED PCM";
      message("Real RMS analysis completed against generated PCM. No Premiere media or demo result counts were used.", "");
    } finally {
      $("#testAudio").textContent = "Analyze Generated Test Audio";
      setBusy(false);
    }
  }

  async function analyzeSequence() {
    if (analyzing) {
      if (exportWaiting) host.stopWaiting();
      return;
    }
    const errors = core.validateRecipe(recipe);
    if (errors.length) return message(errors[0], "error");
    analyzing = true;
    exportWaiting = true;
    setBusy(true);
    $("#analyze").disabled = false;
    $("#analyze").textContent = "Stop waiting";
    $("#diagnostics").hidden = true;
    const exportStartedAt = Date.now();
    let latestDetail = "Resolving Premiere paths and WAV preset";
    progress("Preparing", latestDetail, undefined, undefined, 0);
    elapsedTimer = setInterval(() => progress("Exporting audio", latestDetail, undefined, undefined, Date.now() - exportStartedAt), 1000);
    message("Premiere is rendering temporary sequence audio for analysis. The timeline remains unchanged.", "");
    try {
      const wav = await host.sequenceAudio(sequenceInfo.sequence, (status) => {
        latestDetail = status.stage === "waiting" ? `Promise ${status.detail.promise}; event ${status.detail.event}; output ${status.detail.output}` : JSON.stringify(status.detail);
        progress(status.stage === "preparing" || status.stage === "preset" ? "Preparing" : "Exporting audio", latestDetail, undefined, undefined, status.elapsedMs);
        showDiagnostics(status.diagnostics);
      });
      exportWaiting = false;
      clearInterval(elapsedTimer);
      $("#analyze").disabled = true;
      $("#analyze").textContent = "Analyzing…";
      const pcm = await globalThis.PodCutAudio.decodeWavAsync(wav, (done, total) => progress("Reading / decoding", `${done} of ${total} samples`, done, total));
      renderReview(await core.analyzeAudioAsync(pcm, recipe, (done, total) => progress("Analyzing", `${done} of ${total} frames`, done, total)));
      $("#reviewLabel").textContent = "PREMIERE SEQUENCE";
      progress("Ready", "Review the detected edits below", 1, 1);
      message("Sequence audio analysis complete. Review only; Apply to Timeline remains disabled.", "");
    } catch (error) {
      console.error("PodCut sequence analysis failed", error);
      clearInterval(elapsedTimer);
      showDiagnostics(error.diagnostics);
      $("#progress").hidden = true;
      if (error.code === "STOPPED_WAITING") retryBlocked = true;
      message(error.message || "Sequence audio analysis failed. See the developer console for details.", "error");
    } finally {
      analyzing = false;
      exportWaiting = false;
      $("#analyze").textContent = "Analyze Sequence";
      setBusy(false);
    }
  }

  function init() {
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
      clearAnalysis();
      renderRecipe();
    });
    $$('[data-setting]').forEach((input) => input.addEventListener("change", () => {
      const oldValue = getPath(input.dataset.setting);
      const value = input.type === "checkbox" ? input.checked : typeof oldValue === "number" ? Number(input.value) : input.value;
      setPath(input.dataset.setting, value);
      $("#preset").value = core.matchingPreset(recipe);
      clearAnalysis();
      renderRecipe();
      const errors = core.validateRecipe(recipe);
      message(errors[0] || "", errors.length ? "error" : "");
    }));
    $("#decisions").addEventListener("change", (event) => {
      const decision = analysisResult && analysisResult.decisions.find((item) => item.id === event.target.dataset.decisionId);
      if (decision) {
        decision.enabled = event.target.checked;
        renderSummary();
      }
    });
    $("#refreshSequence").addEventListener("click", refreshSequence);
    $("#analyze").addEventListener("click", analyzeSequence);
    $("#testAudio").addEventListener("click", analyzeTestAudio);
    renderRecipe();
    refreshSequence();
    try { require("uxp").entrypoints.setup({ panels: { podcutPanel: { show: refreshSequence } } }); }
    catch (error) { console.info("PodCut running outside UXP; panel lifecycle unavailable."); }
  }

  init();
})();
