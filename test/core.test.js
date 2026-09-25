const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");

test("presets are copied and manual changes become custom", () => {
  const recipe = core.recipeForPreset("natural");
  assert.equal(core.matchingPreset(recipe), "natural");
  recipe.cutSilence.minimumSeconds = 2;
  assert.equal(core.matchingPreset(recipe), "custom");
  assert.notEqual(core.recipeForPreset("natural").cutSilence.minimumSeconds, 2);
});

test("recipe validation catches unsafe timing", () => {
  const recipe = core.recipeForPreset("natural");
  recipe.longPauses.keepSeconds = recipe.longPauses.thresholdSeconds;
  assert.match(core.validateRecipe(recipe)[0], /shorter/);
});

test("overlapping silence ranges merge after padding", () => {
  const decisions = core.silenceDecisions(
    [{ start: 1, end: 3 }, { start: 2.5, end: 5 }, { start: 8, end: 8.3 }],
    { minimumSeconds: 0.5, paddingBefore: 0.1, paddingAfter: 0.1 },
    10
  );
  assert.deepEqual(decisions.map(({ cutStart, cutEnd }) => ({ cutStart, cutEnd })), [{ cutStart: 1.1, cutEnd: 4.9 }]);
});

test("duration formatting handles hour-long sequences", () => {
  assert.equal(core.formatDuration(4082), "1h 08m 02s");
});

test("settings restore validates schema, preset, and recipe", () => {
  const recipe = core.recipeForPreset("natural");
  const saved = { version: 1, recipe, preset: "natural", advanced: true, developer: false };
  assert.deepEqual(core.readSettings(JSON.stringify(saved)), { recipe, preset: "natural", advanced: true, developer: false });
  assert.equal(core.readSettings("broken").preset, "natural");
  assert.equal(core.readSettings(JSON.stringify({ ...saved, version: 2 })).advanced, false);
  assert.equal(core.readSettings(JSON.stringify({ ...saved, recipe: { ...recipe, cutSilence: { ...recipe.cutSilence, minimumSeconds: -1 } } })).recipe.cutSilence.minimumSeconds, 1.1);
  assert.equal(core.readSettings(JSON.stringify({ ...saved, preset: "tight" })).preset, "natural");
});

test("review totals, filters, and locate safety", () => {
  const decisions = [{ id: "a", enabled: true, removeSeconds: 2, cutStart: 3 }, { id: "b", enabled: false, removeSeconds: 5, cutStart: 6 }];
  const result = { decisions, durationSeconds: 20 };
  assert.deepEqual(core.reviewTotals(result), { enabled: 1, removed: 2, edited: 18 });
  assert.deepEqual(core.filteredDecisions(result, "disabled").map((decision) => decision.id), ["b"]);
  const recipe = core.recipeForPreset("natural");
  const info = { state: "ready", projectId: "p", projectPath: "project.prproj", sequenceId: "s", name: "S", durationSeconds: 20, videoTracks: 1, audioTracks: 1, videoClips: 1, audioClips: 1 };
  const source = { recipe: JSON.stringify(recipe), key: core.sequenceKey(info) };
  assert.equal(core.locateSeconds(source, info, decisions[0], recipe), 3);
  assert.equal(core.locateSeconds({ ...source, key: "generated" }, info, decisions[0], recipe), null);
  assert.equal(core.locateSeconds(source, { ...info, audioClips: 2 }, decisions[0], recipe), null);
  assert.equal(core.locateSeconds(source, info, { cutStart: 21 }, recipe), null);
});
