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
