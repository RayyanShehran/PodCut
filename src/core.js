(function (root, factory) {
  const audio = typeof module === "object" && module.exports ? require("./audio.js") : root.PodCutAudio;
  const api = factory(audio);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PodCutCore = api;
})(typeof globalThis === "undefined" ? this : globalThis, function (audio) {
  "use strict";

  const BASE = {
    cutSilence: { enabled: true, minimumSeconds: 0.8, paddingBefore: 0.15, paddingAfter: 0.15, style: "balanced" },
    fillerWords: { enabled: false, umUh: true, like: false, youKnow: true, repeatedWords: true, falseStarts: true },
    longPauses: { enabled: true, thresholdSeconds: 3, keepSeconds: 0.8 }
  };

  const PRESETS = {
    natural: {
      label: "Natural Podcast",
      recipe: { ...BASE, cutSilence: { ...BASE.cutSilence, minimumSeconds: 1.1, paddingBefore: 0.2, paddingAfter: 0.25, style: "natural" }, longPauses: { enabled: true, thresholdSeconds: 4, keepSeconds: 1.1 } }
    },
    tight: {
      label: "Tight Podcast",
      recipe: { ...BASE, cutSilence: { ...BASE.cutSilence, minimumSeconds: 0.6, paddingBefore: 0.1, paddingAfter: 0.1, style: "tight" }, fillerWords: { ...BASE.fillerWords, enabled: true }, longPauses: { enabled: true, thresholdSeconds: 2.2, keepSeconds: 0.55 } }
    },
    youtube: {
      label: "YouTube Fast-Paced",
      recipe: { ...BASE, cutSilence: { ...BASE.cutSilence, minimumSeconds: 0.45, paddingBefore: 0.08, paddingAfter: 0.08, style: "tight" }, fillerWords: { ...BASE.fillerWords, enabled: true, like: true }, longPauses: { enabled: true, thresholdSeconds: 1.6, keepSeconds: 0.35 } }
    }
  };

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function recipeForPreset(id) { return clone((PRESETS[id] || PRESETS.natural).recipe); }
  function sameRecipe(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function matchingPreset(recipe) { return Object.keys(PRESETS).find((id) => sameRecipe(recipe, PRESETS[id].recipe)) || "custom"; }

  function readSettings(raw) {
    const defaults = { recipe: recipeForPreset("natural"), preset: "natural", advanced: false, developer: false };
    try {
      const saved = JSON.parse(raw);
      if (!saved || saved.version !== 1 || !saved.recipe || ![...Object.keys(PRESETS), "custom"].includes(saved.preset) ||
          typeof saved.advanced !== "boolean" || typeof saved.developer !== "boolean") return defaults;
      const r = saved.recipe;
      for (const [group, fields] of Object.entries(defaults.recipe)) {
        if (!r[group]) return defaults;
        for (const [key, value] of Object.entries(fields)) if (typeof r[group][key] !== typeof value) return defaults;
      }
      if (validateRecipe(r).length || (saved.preset !== "custom" && !sameRecipe(r, recipeForPreset(saved.preset)))) return defaults;
      return { recipe: r, preset: saved.preset, advanced: saved.advanced, developer: saved.developer };
    } catch (error) { return defaults; }
  }

  function sequenceKey(info) {
    return info && info.state === "ready"
      ? [info.projectId, info.projectPath, info.sequenceId, info.name, info.durationSeconds, info.videoTracks, info.audioTracks, info.videoClips, info.audioClips].join("|")
      : info && info.state;
  }

  function reviewTotals(result) {
    const enabled = result.decisions.filter((decision) => decision.enabled);
    const removed = enabled.reduce((total, decision) => total + decision.removeSeconds, 0);
    return { enabled: enabled.length, removed, edited: Math.max(0, result.durationSeconds - removed) };
  }

  function filteredDecisions(result, filter) {
    return result.decisions.filter((decision) => filter === "all" || decision.enabled === (filter === "enabled"));
  }

  function locateSeconds(source, currentInfo, decision, recipe) {
    if (!source || source.key === "generated" || source.recipe !== JSON.stringify(recipe) || source.key !== sequenceKey(currentInfo) ||
        !decision || !Number.isFinite(decision.cutStart) || decision.cutStart < 0 || decision.cutStart > currentInfo.durationSeconds) return null;
    return decision.cutStart;
  }

  function validateRecipe(recipe) {
    const errors = [];
    const finite = (value, min, max, label) => {
      if (!Number.isFinite(value) || value < min || value > max) errors.push(`${label} must be between ${min} and ${max} seconds.`);
    };
    finite(recipe.cutSilence.minimumSeconds, 0.1, 10, "Minimum silence");
    finite(recipe.cutSilence.paddingBefore, 0, 2, "Padding before");
    finite(recipe.cutSilence.paddingAfter, 0, 2, "Padding after");
    finite(recipe.longPauses.thresholdSeconds, 1, 30, "Pause threshold");
    finite(recipe.longPauses.keepSeconds, 0.1, 5, "Natural pause");
    if (!audio.STYLE_THRESHOLDS_DBFS[recipe.cutSilence.style]) errors.push("Editing style is invalid.");
    if (recipe.longPauses.keepSeconds >= recipe.longPauses.thresholdSeconds) errors.push("Natural pause must be shorter than the pause threshold.");
    return errors;
  }

  function mergeRanges(ranges) {
    return ranges
      .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
      .sort((a, b) => a.start - b.start)
      .reduce((merged, range) => {
        const last = merged[merged.length - 1];
        if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
        else merged.push({ start: range.start, end: range.end });
        return merged;
      }, []);
  }

  function silenceDecisions(ranges, settings, sequenceDuration) {
    return mergeRanges(ranges.filter((range) => range.qualifies !== false && range.end - range.start >= settings.minimumSeconds)).map((range, index) => ({
      id: `silence-${index + 1}`,
      type: "silence",
      sourceStart: range.start,
      sourceEnd: range.end,
      cutStart: range.start === 0 ? 0 : range.start + settings.paddingAfter,
      cutEnd: range.end === sequenceDuration ? sequenceDuration : range.end - settings.paddingBefore,
      reason: `Silence longer than ${settings.minimumSeconds}s`,
      enabled: true
    })).filter((decision) => decision.cutStart < decision.cutEnd).map((decision) => ({
      ...decision,
      removeSeconds: decision.cutEnd - decision.cutStart
    }));
  }

  function longPauseDecisions(ranges, settings, sequenceDuration) {
    return ranges.filter((range) => range.duration >= settings.thresholdSeconds).map((range, index) => {
      const edgePadding = settings.keepSeconds / 2;
      const cutStart = range.start === 0 ? 0 : range.start + edgePadding;
      const cutEnd = range.end === sequenceDuration ? sequenceDuration : range.end - edgePadding;
      return {
        id: `long-pause-${index + 1}`,
        type: "long-pause",
        sourceStart: range.start,
        sourceEnd: range.end,
        cutStart,
        cutEnd,
        removeSeconds: cutEnd - cutStart,
        reason: `Shorten pause to ${settings.keepSeconds}s`,
        enabled: true
      };
    }).filter((decision) => decision.removeSeconds > 0);
  }

  function analysisFromDetections(audioInput, recipe, detections) {
    const durationSeconds = audioInput.channels[0].length / audioInput.sampleRate;
    const longPauses = detections.filter((range) => range.duration >= recipe.longPauses.thresholdSeconds);
    const ordinarySilences = recipe.longPauses.enabled
      ? detections.filter((range) => range.duration < recipe.longPauses.thresholdSeconds)
      : detections;
    const decisions = [
      ...(recipe.cutSilence.enabled ? silenceDecisions(ordinarySilences, recipe.cutSilence, durationSeconds) : []),
      ...(recipe.longPauses.enabled ? longPauseDecisions(longPauses, recipe.longPauses, durationSeconds) : [])
    ].sort((a, b) => a.cutStart - b.cutStart);
    return {
      durationSeconds,
      detections,
      decisions,
      silenceCount: detections.filter((range) => range.qualifies).length,
      longPauseCount: longPauses.length,
      removedSeconds: decisions.reduce((total, decision) => total + (decision.enabled ? decision.removeSeconds : 0), 0)
    };
  }

  function analyzeAudio(audioInput, recipe) {
    const errors = validateRecipe(recipe);
    if (errors.length) throw new Error(errors[0]);
    return analysisFromDetections(audioInput, recipe, audio.detectSilences(audioInput, recipe.cutSilence));
  }

  async function analyzeAudioAsync(audioInput, recipe, onProgress) {
    const errors = validateRecipe(recipe);
    if (errors.length) throw new Error(errors[0]);
    const detections = await audio.detectSilencesAsync(audioInput, recipe.cutSilence, onProgress);
    return analysisFromDetections(audioInput, recipe, detections);
  }

  function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.round(totalSeconds || 0));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h ? `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s` : `${m}m ${String(s).padStart(2, "0")}s`;
  }

  function formatTimestamp(totalSeconds) {
    const milliseconds = Math.max(0, Math.round(totalSeconds * 1000));
    const hours = Math.floor(milliseconds / 3600000);
    const minutes = Math.floor((milliseconds % 3600000) / 60000);
    const seconds = Math.floor((milliseconds % 60000) / 1000);
    const millis = milliseconds % 1000;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
  }

  return { PRESETS, recipeForPreset, matchingPreset, readSettings, sequenceKey, reviewTotals, filteredDecisions, locateSeconds, validateRecipe, mergeRanges, silenceDecisions, longPauseDecisions, analyzeAudio, analyzeAudioAsync, formatDuration, formatTimestamp };
});
