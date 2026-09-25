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

  function decodeWav(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 44) throw new Error("Invalid WAV file.");
    const view = new DataView(buffer);
    const text = (offset) => String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    if (text(0) !== "RIFF" || text(8) !== "WAVE") throw new Error("Invalid WAV file.");

    let format;
    let dataOffset;
    let dataSize;
    for (let offset = 12; offset + 8 <= buffer.byteLength;) {
      const id = text(offset);
      const size = view.getUint32(offset + 4, true);
      const content = offset + 8;
      if (content + size > buffer.byteLength) throw new Error("Invalid WAV chunk size.");
      if (id === "fmt ") {
        if (size < 16) throw new Error("Invalid WAV format chunk.");
        format = {
          type: view.getUint16(content, true),
          channels: view.getUint16(content + 2, true),
          sampleRate: view.getUint32(content + 4, true),
          blockAlign: view.getUint16(content + 12, true),
          bitsPerSample: view.getUint16(content + 14, true)
        };
      } else if (id === "data") {
        dataOffset = content;
        dataSize = size;
      }
      offset = content + size + (size % 2);
    }
    if (!format || dataOffset === undefined) throw new Error("WAV format or data chunk is missing.");
    if (format.type !== 1 || format.bitsPerSample !== 16) throw new Error("PodCut currently supports 16-bit PCM WAV audio.");
    if (!format.channels || !format.sampleRate || format.blockAlign !== format.channels * 2 || dataSize % format.blockAlign) throw new Error("Invalid PCM WAV format.");

    const sampleCount = dataSize / format.blockAlign;
    const samples = new Float32Array(sampleCount);
    for (let sample = 0; sample < sampleCount; sample += 1) {
      let sumSquares = 0;
      for (let channel = 0; channel < format.channels; channel += 1) {
        const value = view.getInt16(dataOffset + sample * format.blockAlign + channel * 2, true) / 32768;
        sumSquares += value * value;
      }
      samples[sample] = Math.sqrt(sumSquares / format.channels);
    }
    return { sampleRate: format.sampleRate, channels: [samples] };
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

  return { STYLE_THRESHOLDS_DBFS, FRAME_SECONDS, decodeWav, detectSilences };
});
