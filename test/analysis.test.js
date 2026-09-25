const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");

function audio(segments, sampleRate = 1000) {
  const samples = segments.flatMap(({ seconds, level }) => Array(Math.round(seconds * sampleRate)).fill(level));
  return { sampleRate, channels: [Float32Array.from(samples)] };
}

test("real detections become padded review decisions", () => {
  const recipe = core.recipeForPreset("natural");
  recipe.longPauses.enabled = false;
  recipe.cutSilence.minimumSeconds = 0.8;
  recipe.cutSilence.paddingBefore = 0.15;
  recipe.cutSilence.paddingAfter = 0.2;
  const result = core.analyzeAudio(audio([
    { seconds: 0.4, level: 0.2 }, { seconds: 1.2, level: 0 }, { seconds: 0.4, level: 0.2 }
  ]), recipe);
  const [decision] = result.decisions;
  assert.equal(result.silenceCount, 1);
  assert.ok(Math.abs(decision.cutStart - 0.6) < 1e-9);
  assert.ok(Math.abs(decision.cutEnd - 1.45) < 1e-9);
  assert.ok(Math.abs(result.removedSeconds - 0.85) < 1e-9);
});

test("leading and trailing silence never create negative or reversed cuts", () => {
  const recipe = core.recipeForPreset("tight");
  recipe.longPauses.enabled = false;
  const result = core.analyzeAudio(audio([
    { seconds: 1, level: 0 }, { seconds: 0.2, level: 0.2 }, { seconds: 1, level: 0 }
  ]), recipe);
  assert.deepEqual(result.decisions.map(({ cutStart, cutEnd }) => ({ cutStart, cutEnd })), [
    { cutStart: 0, cutEnd: 0.9 }, { cutStart: 1.3, cutEnd: 2.2 }
  ]);
});

test("padding larger than a silence yields no invalid decision", () => {
  const decisions = core.silenceDecisions(
    [{ start: 1, end: 1.3, qualifies: true }],
    { minimumSeconds: 0.1, paddingBefore: 0.2, paddingAfter: 0.2 },
    3
  );
  assert.deepEqual(decisions, []);
});

test("overlapping source ranges merge before padding", () => {
  const decisions = core.silenceDecisions(
    [{ start: 1, end: 3 }, { start: 2.5, end: 5 }],
    { minimumSeconds: 0.5, paddingBefore: 0.1, paddingAfter: 0.2 },
    6
  );
  assert.deepEqual(decisions.map(({ cutStart, cutEnd }) => ({ cutStart, cutEnd })), [{ cutStart: 1.2, cutEnd: 4.9 }]);
});

test("long pauses reuse detections and do not duplicate silence decisions", () => {
  const recipe = core.recipeForPreset("natural");
  recipe.cutSilence.minimumSeconds = 0.5;
  recipe.longPauses.thresholdSeconds = 2;
  recipe.longPauses.keepSeconds = 0.8;
  const result = core.analyzeAudio(audio([
    { seconds: 0.2, level: 0.2 }, { seconds: 1, level: 0 }, { seconds: 0.2, level: 0.2 },
    { seconds: 3, level: 0 }, { seconds: 0.2, level: 0.2 }
  ]), recipe);
  assert.equal(result.longPauseCount, 1);
  assert.deepEqual(result.decisions.map(({ type }) => type), ["silence", "long-pause"]);
  assert.ok(Math.abs(result.decisions[1].removeSeconds - 2.2) < 1e-9);
});

test("disabled recipe operations produce no decisions", () => {
  const recipe = core.recipeForPreset("natural");
  recipe.cutSilence.enabled = false;
  recipe.longPauses.enabled = false;
  const result = core.analyzeAudio(audio([{ seconds: 2, level: 0 }]), recipe);
  assert.equal(result.silenceCount, 1);
  assert.deepEqual(result.decisions, []);
  assert.equal(result.removedSeconds, 0);
});

test("timestamps preserve millisecond precision", () => {
  assert.equal(core.formatTimestamp(84.35), "00:01:24.350");
});
