const test = require("node:test");
const assert = require("node:assert/strict");
const { detectSilences } = require("../src/audio.js");

function audio(segments, channels = 1, sampleRate = 1000) {
  const values = segments.flatMap(({ seconds, level }) => Array(Math.round(seconds * sampleRate)).fill(level));
  return { sampleRate, channels: Array.from({ length: channels }, () => Float32Array.from(values)) };
}

const settings = { style: "balanced", minimumSeconds: 0.5 };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

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
