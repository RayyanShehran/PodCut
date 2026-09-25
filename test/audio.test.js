const test = require("node:test");
const assert = require("node:assert/strict");
const { decodeWav, detectSilences } = require("../src/audio.js");

function audio(segments, channels = 1, sampleRate = 1000) {
  const values = segments.flatMap(({ seconds, level }) => Array(Math.round(seconds * sampleRate)).fill(level));
  return { sampleRate, channels: Array.from({ length: channels }, () => Float32Array.from(values)) };
}

const settings = { style: "balanced", minimumSeconds: 0.5 };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

function pcm16Wav(samples, channels = 1, sampleRate = 48000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return buffer;
}

test("16-bit stereo WAV decodes to RMS-preserving PCM", () => {
  const decoded = decodeWav(pcm16Wav([16384, 0, 0, 16384], 2));
  assert.equal(decoded.sampleRate, 48000);
  assert.equal(decoded.channels[0].length, 2);
  assert.ok(Math.abs(decoded.channels[0][0] - Math.sqrt(0.5 * 0.5 / 2)) < 1e-6);
  assert.ok(Math.abs(decoded.channels[0][1] - Math.sqrt(0.5 * 0.5 / 2)) < 1e-6);
});

test("speech-only audio has no silence", () => {
  assert.deepEqual(detectSilences(audio([{ seconds: 1, level: 0.2 }]), settings), []);
});

test("all-silent audio produces one qualified range", () => {
  const [range] = detectSilences(audio([{ seconds: 1, level: 0 }]), settings);
  assert.deepEqual({ start: range.start, end: range.end, qualifies: range.qualifies }, { start: 0, end: 1, qualifies: true });
  assert.equal(range.levelDbfs, -Infinity);
});

test("speech, silence, speech produces the expected range", () => {
  const [range] = detectSilences(audio([
    { seconds: 0.4, level: 0.2 }, { seconds: 1, level: 0 }, { seconds: 0.4, level: 0.2 }
  ]), settings);
  close(range.start, 0.4);
  close(range.end, 1.4);
});

test("multiple, leading, and trailing silences remain separate", () => {
  const ranges = detectSilences(audio([
    { seconds: 0.6, level: 0 }, { seconds: 0.2, level: 0.2 },
    { seconds: 0.8, level: 0 }, { seconds: 0.2, level: 0.2 }, { seconds: 1, level: 0 }
  ]), settings);
  assert.deepEqual(ranges.map(({ start, end }) => ({ start, end })), [
    { start: 0, end: 0.6 }, { start: 0.8, end: 1.6 }, { start: 1.8, end: 2.8 }
  ]);
});

test("silence below the minimum is detected but does not qualify", () => {
  const [range] = detectSilences(audio([
    { seconds: 0.2, level: 0.2 }, { seconds: 0.4, level: 0 }, { seconds: 0.2, level: 0.2 }
  ]), settings);
  assert.equal(range.qualifies, false);
});

test("editing styles use explicit increasingly aggressive thresholds", () => {
  const quiet = audio([{ seconds: 1, level: 0.01 }]);
  assert.equal(detectSilences(quiet, { ...settings, style: "natural" }).length, 0);
  assert.equal(detectSilences(quiet, { ...settings, style: "balanced" }).length, 1);
  assert.equal(detectSilences(quiet, { ...settings, style: "tight" }).length, 1);
});

test("stereo channels are combined by RMS", () => {
  const stereo = audio([{ seconds: 1, level: 0.2 }], 2);
  stereo.channels[1].fill(0);
  assert.deepEqual(detectSilences(stereo, settings), []);
  stereo.channels[0].fill(0);
  assert.equal(detectSilences(stereo, settings).length, 1);
});

test("sample positions convert accurately to seconds", () => {
  const [range] = detectSilences(audio([
    { seconds: 0.24, level: 0.2 }, { seconds: 0.52, level: 0 }, { seconds: 0.24, level: 0.2 }
  ], 1, 8000), settings);
  close(range.start, 0.24);
  close(range.end, 0.76);
});

test("invalid audio and detection settings are rejected", () => {
  assert.throws(() => detectSilences({ sampleRate: 0, channels: [[]] }, settings), /sampleRate/);
  assert.throws(() => detectSilences({ sampleRate: 1000, channels: [[0], [0, 0]] }, settings), /equal lengths/);
  assert.throws(() => detectSilences(audio([{ seconds: 1, level: 0 }]), { ...settings, style: "mystery" }), /Unknown/);
  assert.throws(() => detectSilences(audio([{ seconds: 1, level: 0 }]), { ...settings, minimumSeconds: 0 }), /positive/);
});
