(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PodCutAudio = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  "use strict";

  const STYLE_THRESHOLDS_DBFS = { natural: -42, balanced: -38, tight: -34 };
  const FRAME_SECONDS = 0.02;

  function validate(audio, settings) {
    if (!audio || !Number.isFinite(audio.sampleRate) || audio.sampleRate <= 0) throw new Error("Audio sampleRate must be positive.");
    if (!Array.isArray(audio.channels) || !audio.channels.length) throw new Error("Audio must contain at least one channel.");
    const sampleCount = audio.channels[0].length;
    if (!audio.channels.every((channel) => channel && channel.length === sampleCount)) throw new Error("Audio channels must have equal lengths.");
    if (!STYLE_THRESHOLDS_DBFS[settings.style]) throw new Error("Unknown silence editing style.");
    if (!Number.isFinite(settings.minimumSeconds) || settings.minimumSeconds <= 0) throw new Error("Minimum silence must be positive.");
  }

  function dbfs(sumSquares, count) {
    return sumSquares ? 20 * Math.log10(Math.sqrt(sumSquares / count)) : -Infinity;
  }

  function detectSilences(audio, settings) {
    validate(audio, settings);
    const thresholdDbfs = settings.thresholdDbfs ?? STYLE_THRESHOLDS_DBFS[settings.style];
    if (!Number.isFinite(thresholdDbfs) || thresholdDbfs >= 0) throw new Error("Silence threshold must be a negative dBFS value.");

    const { channels, sampleRate } = audio;
    const sampleCount = channels[0].length;
    const frameSamples = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
    const ranges = [];
    let active = null;

    for (let startSample = 0; startSample < sampleCount; startSample += frameSamples) {
      const endSample = Math.min(sampleCount, startSample + frameSamples);
      let sumSquares = 0;
      for (const channel of channels) {
        for (let sample = startSample; sample < endSample; sample += 1) {
          const value = channel[sample];
          if (!Number.isFinite(value)) throw new Error("Audio samples must be finite numbers.");
          sumSquares += value * value;
        }
      }
      const values = (endSample - startSample) * channels.length;
      if (dbfs(sumSquares, values) <= thresholdDbfs) {
        if (!active) active = { startSample, sumSquares: 0, values: 0 };
        active.sumSquares += sumSquares;
        active.values += values;
      } else if (active) {
        ranges.push({ ...active, endSample: startSample });
        active = null;
      }
    }
    if (active) ranges.push({ ...active, endSample: sampleCount });

    return ranges.map((range, index) => {
      const start = range.startSample / sampleRate;
      const end = range.endSample / sampleRate;
      const duration = end - start;
      return {
        id: `silence-${index + 1}`,
        start,
        end,
        duration,
        levelDbfs: dbfs(range.sumSquares, range.values),
        thresholdDbfs,
        qualifies: duration >= settings.minimumSeconds
      };
    });
  }

  return { STYLE_THRESHOLDS_DBFS, FRAME_SECONDS, detectSilences };
});
