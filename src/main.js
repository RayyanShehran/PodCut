(function () {
  "use strict";
  const core = globalThis.PodCutCore;
  const host = globalThis.PodCutPremiere;
  let recipe = core.recipeForPreset("natural");
  let sequenceInfo = null;
  let analysisResult = null;
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
    $("#analyze").disabled = true;
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
          : "Sequence audio acquisition is not connected yet. Use generated test audio to exercise the real detector."
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
      await Promise.resolve();
      renderReview(core.analyzeAudio(generatedAudio(), recipe));
      message("Real RMS analysis completed against generated PCM. No Premiere media or demo result counts were used.", "");
    } finally {
      $("#testAudio").textContent = "Analyze Generated Test Audio";
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
    $("#testAudio").addEventListener("click", analyzeTestAudio);
    renderRecipe();
    refreshSequence();
    try { require("uxp").entrypoints.setup({ panels: { podcutPanel: { show: refreshSequence } } }); }
    catch (error) { console.info("PodCut running outside UXP; panel lifecycle unavailable."); }
  }

  init();
})();
