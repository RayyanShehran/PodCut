const test = require('node:test');
const assert = require('node:assert/strict');
const { planConsecutiveEdit, planSimpleEdit } = require('../src/core.js');

const clips = [
  { projectItemId: 'A', start: 0, end: 10, inPoint: 5, outPoint: 15 },
  { projectItemId: 'B', start: 10, end: 20, inPoint: 20, outPoint: 30 },
  { projectItemId: 'A', start: 20, end: 30, inPoint: 0, outPoint: 10 }
];
const plan = (cuts, source = clips) => planConsecutiveEdit({ clips: source, fps: 30, cuts });
const ranges = p => p.segments.map(s => [s.clipIndex, s.projectItemId, s.sourceStartFrame, s.sourceEndFrame, s.outputStartFrame, s.outputEndFrame]);

test('internal cut preserves clip identities, trimmed source ranges, and chronological placement', () => {
  const p = plan([{ cutStart: 3, cutEnd: 4 }]);
  assert.equal(p.outputFrames, 870);
  assert.deepEqual(ranges(p), [[0, 'A', 150, 240, 0, 90], [0, 'A', 270, 450, 90, 270],
    [1, 'B', 600, 900, 270, 570], [2, 'A', 0, 300, 570, 870]]);
});

test('boundary-crossing cut maps each side to its own media source', () => {
  const p = plan([{ cutStart: 9, cutEnd: 12 }]);
  assert.equal(p.outputFrames, 810);
  assert.deepEqual(ranges(p), [[0, 'A', 150, 420, 0, 270], [1, 'B', 660, 900, 270, 510], [2, 'A', 0, 300, 510, 810]]);
});

test('entire middle clip removal creates no empty segment and preserves the outer clips', () => {
  const p = plan([{ cutStart: 10, cutEnd: 20 }]);
  assert.equal(p.outputFrames, 600);
  assert.deepEqual(ranges(p), [[0, 'A', 150, 450, 0, 300], [2, 'A', 0, 300, 300, 600]]);
});

test('disabled decisions are not cuts; retained original clip boundary is not coalesced', () => {
  const decisions = [{ enabled: true, cutStart: 3, cutEnd: 4 }, { enabled: false, cutStart: 9, cutEnd: 12 }];
  assert.deepEqual(plan(decisions.filter(d => d.enabled)), plan([decisions[0]]));
  const p = plan([{ cutStart: 3, cutEnd: 4 }, { cutStart: 19, cutEnd: 21 }]);
  assert.equal(p.outputFrames, 810);
  assert.deepEqual(p.segments.map(s => [s.sequenceStartFrame, s.sequenceEndFrame]), [[0, 90], [120, 300], [300, 570], [630, 900]]);
});

test('single-clip planning matches the released frame policy exactly', () => {
  const cuts = [{ cutStart: 3.25, cutEnd: 4.45 }];
  const p = plan(cuts, [clips[0]]);
  const simple = planSimpleEdit({ durationSeconds: 10, sourceInSeconds: 5, fps: 30, cuts });
  assert.equal(p.outputFrames, simple.outputFrames);
  assert.deepEqual(p.segments.map(({ sourceStartFrame, sourceEndFrame, outputStartFrame, outputEndFrame }) =>
    ({ sourceStartFrame, sourceEndFrame, outputStartFrame, outputEndFrame })), simple.segments);
});

test('invalid, overlapping, unsorted, collapsed, and out-of-range cuts are rejected', () => {
  for (const cuts of [[], [{ cutStart: NaN, cutEnd: 2 }], [{ cutStart: -1, cutEnd: 2 }],
    [{ cutStart: 1, cutEnd: 31 }], [{ cutStart: 0, cutEnd: 2 }], [{ cutStart: 1, cutEnd: 30 }],
    [{ cutStart: 5, cutEnd: 4 }], [{ cutStart: 3.001, cutEnd: 3.002 }],
    [{ cutStart: 3, cutEnd: 6 }, { cutStart: 5, cutEnd: 8 }], [{ cutStart: 9, cutEnd: 12 }, { cutStart: 3, cutEnd: 4 }]])
    assert.throws(() => plan(cuts));
});

test('invalid clip spans cannot produce a timing plan', () => {
  for (const change of [c => { c[1].start += 1; }, c => { c[1].start -= 1; }, c => { c.reverse(); },
    c => { c[0].start = 1; }, c => { c[1].end = c[1].start; }, c => { c[1].inPoint = -1; },
    c => { c[1].outPoint = 29; }, c => { c[1].inPoint = 20.01; }, c => { c[1].projectItemId = ''; }]) {
    const source = structuredClone(clips); change(source);
    assert.throws(() => plan([{ cutStart: 3, cutEnd: 4 }], source));
  }
  assert.throws(() => planConsecutiveEdit({ clips, fps: 29.97, cuts: [{ cutStart: 3, cutEnd: 4 }] }));
});
