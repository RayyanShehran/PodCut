const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../src/apply.js');

let next = 0;
function fixture() {
  const item = { projectItemId: 'media', start: 0, end: 36, inPoint: 0, outPoint: 36, trackIndex: 0, speed: 1, disabled: false, reversed: false };
  const source = { projectId: 'project', sequenceId: 'original', name: 'Source', durationSeconds: 36, fps: 30,
    videoTracks: 1, audioTracks: 1, captionTracks: 0, videoTransitions: 0, audioTransitions: 0, otherItems: 0,
    videoItems: [{ ...item }], audioItems: [{ ...item }], mediaPath: 'fixture.mov', offline: false,
    nested: false, multicam: false, merged: false, videoMuted: false, audioMuted: false, unsupportedEffects: [] };
  const review = { key: `key-${++next}`, recipe: '{}', currentRecipe: '{}', analysisId: next, source: structuredClone(source), confirmed: true,
    decisions: [{ enabled: true, cutStart: 10.25, cutEnd: 11.8 }, { enabled: true, cutStart: 22.55, cutEnd: 25.45 }] };
  const currentKey = review.key;
  const calls = [];
  const adapter = {
    inspect: async () => ({ key: currentKey, source }),
    createCandidate: async () => { calls.push('candidate'); return 'candidate-id'; },
    createSubclip: async () => { calls.push('subclip'); return `sub-${calls.length}`; },
    editCandidate: async () => { calls.push('edit'); return true; },
    verifyCandidate: async () => { calls.push('verify'); return true; },
    nameCandidate: async (_, name) => { calls.push(name.startsWith('PodCut FAILED') ? 'failed-label' : 'final-label'); return true; },
    presentCandidate: async () => { calls.push('present'); return true; },
    reconcile: async () => { calls.push('reconcile'); },
    restoreOriginal: async () => { calls.push('restore'); }
  };
  return { source, review, calls, adapter };
}

test('frame plan, verification, and duplicate Apply guard', async () => {
  const f = fixture();
  const operation = await service.apply(f.adapter, f.review);
  assert.equal(operation.status, 'completed');
  assert.equal(operation.plan.outputFrames, 947);
  assert.deepEqual(f.calls, ['candidate', 'subclip', 'subclip', 'edit', 'verify', 'final-label', 'present']);
  assert.equal((await service.apply(f.adapter, f.review)).status, 'failed');
  assert.equal(f.calls.filter(x => x === 'candidate').length, 1);
});

test('Apply plans only enabled review cuts; disabled pauses are retained', async () => {
  const f = fixture();
  f.review.decisions[1].enabled = false;
  const operation = await service.apply(f.adapter, f.review);
  assert.equal(operation.status, 'completed');
  assert.equal(operation.plan.outputFrames, 1034);
  assert.deepEqual(operation.plan.segments.map(s => [s.sourceStartFrame, s.sourceEndFrame]), [[0, 308], [354, 1080]]);
  assert.equal(f.calls.filter(x => x === 'subclip').length, 1);
  const none = fixture();
  none.review.decisions.forEach(d => { d.enabled = false; });
  const rejected = await service.apply(none.adapter, none.review);
  assert.equal(rejected.status, 'failed');
  assert.match(rejected.errors.join(' '), /at least one cut/);
  assert.ok(!none.calls.includes('candidate'));
});

test('stale and unsupported input fail before any candidate exists', async () => {
  for (const change of [f => { f.review.key = 'old'; }, f => { f.review.currentRecipe = 'changed'; }, f => { f.source.captionTracks = 1; },
    f => { f.review.decisions[0].cutStart = 0; }]) {
    const f = fixture(); change(f);
    const operation = await service.apply(f.adapter, f.review);
    assert.equal(operation.status, 'failed');
    assert.equal(operation.candidateSequenceId, null);
    assert.ok(!f.calls.includes('candidate'));
  }
});

test('false or thrown partial mutations never complete, retain failed candidate, and retry fresh', async () => {
  for (const failedStage of ['createCandidate', 'createSubclip', 'editCandidate', 'verifyCandidate', 'nameCandidate', 'presentCandidate']) {
    for (const mode of ['false', 'throw']) {
      const f = fixture();
      const prior = f.adapter[failedStage];
      let once = true;
      f.adapter[failedStage] = async (...args) => {
        if (once) { once = false; if (mode === 'throw') throw new Error(`injected ${failedStage}`); return false; }
        return prior(...args);
      };
      const operation = await service.apply(f.adapter, f.review);
      assert.equal(operation.status, 'failed');
      assert.ok(f.calls.includes('reconcile'));
      assert.ok(f.calls.includes('restore'));
      if (failedStage !== 'presentCandidate') assert.ok(!f.calls.includes('final-label'));
      if (failedStage !== 'createCandidate') assert.ok(f.calls.includes('failed-label'));
      const retry = await service.apply(f.adapter, f.review);
      assert.equal(retry.status, 'completed');
      assert.notEqual(retry.id, operation.id);
    }
  }
});

test('concurrent Apply is refused without starting another candidate', async () => {
  const f = fixture();
  let release;
  f.adapter.createCandidate = () => new Promise(resolve => { release = () => resolve('candidate-id'); });
  const pending = service.apply(f.adapter, f.review);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(service.apply(f.adapter, f.review), /already running/);
  release();
  assert.equal((await pending).status, 'completed');
});

test('pending preflight reports its stage and blocks overlapping inspection or mutation', async () => {
  const f = fixture();
  let release;
  let inspections = 0;
  const events = [];
  f.adapter.inspect = async (report) => {
    inspections += 1;
    report('source.video.0.projectItem', 'start');
    await new Promise(resolve => { release = resolve; });
    report('source.video.0.projectItem', 'complete', { durationMs: 1 });
    return { key: f.review.key, source: f.source };
  };
  const pending = service.prepare(f.adapter, f.review, entry => events.push(entry));
  await assert.rejects(service.prepare(f.adapter, f.review), /preflight is already running/);
  const denied = await service.apply(f.adapter, f.review);
  assert.equal(denied.status, 'failed');
  assert.match(denied.errors.join(' '), /preflight is already running/);
  assert.equal(inspections, 1);
  assert.ok(!f.calls.includes('candidate'));
  release();
  await pending;
  assert.ok(events.some(entry => entry.stage === 'source.video.0.projectItem' && entry.phase === 'start' && entry.runId));
  assert.ok(events.some(entry => entry.stage === 'source.video.0.projectItem' && entry.phase === 'complete'));
});
