(function () {
  "use strict";
  const core = globalThis.PodCutCore;
  const host = globalThis.PodCutPremiere;
  let recipe = core.recipeForPreset("natural");
  let sequenceInfo = null;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const getPath = (path) => path.split(".").reduce((value, key) => value[key], recipe);

  function setPath(path, value) {
    const keys = path.split(".");
    let target = recipe;
    keys.slice(0, -1).forEach((key) => { target = target[key]; });
    target[keys.at(-1)] = value;
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
    $("#analyze").disabled = value || !sequenceInfo || sequenceInfo.state !== "ready";
    $("#refreshSequence").disabled = value;
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
      message(ready && sequenceInfo.audioTracks === 0 ? "This sequence has no audio tracks to analyze." : "", "warning");
    } catch (error) {
      sequenceInfo = { state: "error" };
      $("#sequenceDot").classList.remove("ready");
      $("#sequenceName").textContent = "Sequence inspection failed";
      $("#sequenceMeta").textContent = "See the developer console for details.";
      console.error("PodCut sequence inspection failed", error);
      message("Could not read the active sequence. Refresh after checking the project and plugin permissions.", "error");
    } finally { setBusy(false); }
  }

  function renderReview(result, demo) {
    $("#review").hidden = false;
    $("#reviewLabel").textContent = demo ? "DEMO DATA" : "SEQUENCE INVENTORY";
    $("#summary").innerHTML = [
      ["Silences", result.silences], ["Filler words", result.fillers], ["Long pauses", result.pauses],
      ["Estimated removed", core.formatDuration(result.removed)], ["Original", core.formatDuration(result.original)], ["Estimated edited", core.formatDuration(result.original - result.removed)]
    ].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join("");
    $("#decisions").innerHTML = result.decisions.length
      ? result.decisions.map((item) => `<label><input type="checkbox" checked disabled /> <span>${item.label}</span><small>${item.time}</small></label>`).join("")
      : '<p class="empty">No edit decisions were generated. Audio-content and transcript analysis are not implemented yet.</p>';
    $("#apply").disabled = true;
    $("#review").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function analyze() {
    const errors = core.validateRecipe(recipe);
    if (errors.length) return message(errors[0], "error");
    setBusy(true);
    $("#analyze").textContent = "Analyzing…";
    try {
      await Promise.resolve();
      renderReview({ silences: 0, fillers: 0, pauses: 0, removed: 0, original: sequenceInfo.durationSeconds, decisions: [] }, false);
      message("Sequence metadata was analyzed. Audio-content detection is not implemented in this foundation build.", "warning");
    } finally {
      $("#analyze").textContent = "Analyze Sequence";
      setBusy(false);
    }
  }

  function showDemo() {
    renderReview({
      silences: 12, fillers: 5, pauses: 3, removed: 94, original: 1840,
      decisions: [
        { label: "Silence · suggested cut", time: "02:14.2–02:16.1" },
        { label: "Long pause · shorten", time: "08:40.0–08:44.3" },
        { label: "Filler word · transcript required", time: "12:05.8–12:06.2" }
      ]
    }, true);
    message("Demo data previews the review experience only. It did not come from Premiere and cannot be applied.", "warning");
  }

  function init() {
    Object.entries(core.PRESETS).forEach(([id, preset]) => $("#preset").append(new Option(preset.label, id)));
    $("#preset").append(new Option("Custom", "custom"));
    $("#preset").value = "natural";
    $("#preset").addEventListener("change", (event) => {
      if (event.target.value !== "custom") recipe = core.recipeForPreset(event.target.value);
      renderRecipe();
    });
    $$('[data-setting]').forEach((input) => input.addEventListener("change", () => {
      const oldValue = getPath(input.dataset.setting);
      const value = input.type === "checkbox" ? input.checked : typeof oldValue === "number" ? Number(input.value) : input.value;
      setPath(input.dataset.setting, value);
      $("#preset").value = core.matchingPreset(recipe);
      renderRecipe();
      const errors = core.validateRecipe(recipe);
      message(errors[0] || "", errors.length ? "error" : "");
    }));
    $("#refreshSequence").addEventListener("click", refreshSequence);
    $("#analyze").addEventListener("click", analyze);
    $("#demo").addEventListener("click", showDemo);
    renderRecipe();
    refreshSequence();
    try { require("uxp").entrypoints.setup({ panels: { podcutPanel: { show: refreshSequence } } }); }
    catch (error) { console.info("PodCut running outside UXP; panel lifecycle unavailable."); }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
