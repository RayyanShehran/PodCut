(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PodCutCore = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
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
    return mergeRanges(ranges.map((range) => ({
      start: Math.max(0, range.start + settings.paddingBefore),
      end: Math.min(sequenceDuration, range.end - settings.paddingAfter)
    }))).filter((range) => range.end - range.start >= settings.minimumSeconds).map((range, index) => ({
      id: `silence-${index + 1}`,
      kind: "silence",
      start: range.start,
      end: range.end,
      removeSeconds: range.end - range.start,
      enabled: true
    }));
  }

  function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.round(totalSeconds || 0));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h ? `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s` : `${m}m ${String(s).padStart(2, "0")}s`;
  }

  return { PRESETS, recipeForPreset, matchingPreset, validateRecipe, mergeRanges, silenceDecisions, formatDuration };
});
