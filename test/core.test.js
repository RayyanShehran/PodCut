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
