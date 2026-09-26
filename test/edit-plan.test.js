const test = require("node:test");
const assert = require("node:assert/strict");
const { planSimpleEdit } = require("../src/core.js");

const cuts = [{ cutStart: 10.25, cutEnd: 11.8 }, { cutStart: 22.55, cutEnd: 25.45 }];

test("two Premiere fixture cuts align to frames and retain matching source ranges", () => {
  assert.deepEqual(planSimpleEdit({ durationSeconds: 36, sourceInSeconds: 0, fps: 30, cuts }), {
    fps: 30,
    segments: [
      { sourceStartFrame: 0, sourceEndFrame: 308, outputStartFrame: 0, outputEndFrame: 308 },
      { sourceStartFrame: 354, sourceEndFrame: 677, outputStartFrame: 308, outputEndFrame: 631 },
      { sourceStartFrame: 764, sourceEndFrame: 1080, outputStartFrame: 631, outputEndFrame: 947 }
    ],
    outputFrames: 947
  });
});

test("source-trimmed clips offset source ranges without shifting the output", () => {
  const plan = planSimpleEdit({ durationSeconds: 31, sourceInSeconds: 5, fps: 30, cuts: [cuts[0]] });
  assert.deepEqual(plan.segments, [
    { sourceStartFrame: 150, sourceEndFrame: 458, outputStartFrame: 0, outputEndFrame: 308 },
    { sourceStartFrame: 504, sourceEndFrame: 1080, outputStartFrame: 308, outputEndFrame: 884 }
  ]);
  assert.equal(plan.outputFrames, 884);
});

test("invalid or unsupported cuts are rejected before any host action is planned", () => {
  const plan = (ranges) => planSimpleEdit({ durationSeconds: 36, sourceInSeconds: 0, fps: 30, cuts: ranges });
  assert.throws(() => plan([]), /at least one cut/);
  assert.throws(() => plan([{ cutStart: 0, cutEnd: 2 }]), /strictly inside/);
  assert.throws(() => plan([{ cutStart: 10, cutEnd: 12 }, { cutStart: 11, cutEnd: 14 }]), /overlap/);
  assert.throws(() => plan([{ cutStart: 10.001, cutEnd: 10.002 }]), /collapse/);
  assert.throws(() => planSimpleEdit({ durationSeconds: 36, sourceInSeconds: 0.01, fps: 30, cuts }), /align/);
});
