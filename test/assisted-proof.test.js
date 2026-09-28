const test = require('node:test');
const assert = require('node:assert/strict');
const proof = require('../scripts/assisted-proof.js');
const service = require('../src/apply.js');
let next = 0;
function fixture() {
  let revision = 1;
  const item = (inPoint = 0, start = 0, end = 36, gain = -6) => ({
    start, end, inPoint, outPoint: inPoint + end - start, gain,
    getStartTime() { return { seconds: this.start }; }, getEndTime() { return { seconds: this.end }; },
    getInPoint() { return { seconds: this.inPoint }; }, getOutPoint() { return { seconds: this.outPoint }; },
    getProjectItem() { return { getId: () => 'media' }; },
    createSetInPointAction(t) { return () => { this.start += t.seconds - this.inPoint; this.inPoint = t.seconds; }; },
    createSetOutPointAction(t) { return () => { this.end += t.seconds - this.outPoint; this.outPoint = t.seconds; }; },
    createMoveAction(t) { return () => { this.start += t.seconds; this.end += t.seconds; }; }
  });
  const tracks = [[item()], [item()]], calls = [], names = [];
  const sequence = { guid: { toString: () => 'candidate' }, getVideoTrack: () => ({ getTrackItems: () => tracks[0] }),
    getAudioTrack: () => ({ getTrackItems: () => tracks[1] }), getEndTime: () => ({ seconds: Math.max(...tracks.flat().map(i => i.end)) }) };
  const project = { path: 'C:/Fixtures/assisted.prproj', getSequences: async () => [sequence], getSequence: () => sequence,
    lockedAccess: f => f(), executeTransaction(f) { f({ addAction(a) { a(); return true; } }); return true; } };
  const api = { TickTime: { createWithSeconds: seconds => ({ seconds }) }, SequenceEditor: { getEditor: () => ({
    createCloneTrackItemAction(i, offset) { return () => {
      const track = tracks.find(t => t.includes(i)); track.push(item(i.inPoint, i.start + offset.seconds, i.end + offset.seconds, i.gain));
    }; }
  }) } };
  const metadata = { projectItemId: 'media', start: 0, end: 36, inPoint: 0, outPoint: 36, trackIndex: 0, speed: 1 };
  const source = { projectId: 'project', projectPath: project.path, sequenceId: 'original', name: 'Source', durationSeconds: 36,
    fps: 30, videoTracks: 1, audioTracks: 1, captionTracks: 0, videoTransitions: 0, audioTransitions: 0,
    videoItems: [{ ...metadata }], audioItems: [{ ...metadata }], mediaPath: 'fixture.mov', unsupportedEffects: [] };
  const review = { key: `assisted-${++next}`, recipe: '{}', currentRecipe: '{}', analysisId: next,
    source: structuredClone(source), revision: 1, confirmed: true,
    decisions: [{ enabled: true, cutStart: 10.25, cutEnd: 11.8 }, { enabled: false, cutStart: 22.55, cutEnd: 25.45 }] };
  const base = { sourceRevision: () => revision, inspect: async () => ({ key: review.key, source, handles: { project } }),
    createCandidate: async () => { calls.push('candidate'); return 'candidate'; },
    nameCandidate: async (op, name) => { names.push(name); return true; },
    presentCandidate: async () => true, restoreOriginal: async () => { calls.push('restore'); }, reconcile: async () => {} };
  const run = proof(base, api, service, 'assisted.prproj');
  return { run, review, calls, names, tracks, project, source, change: () => revision++ };
}
test('assisted proof retains only enabled ranges and ends awaiting manual linking, never finished', async () => {
  const f = fixture(), op = await f.run.prepare(f.review);
  assert.equal(op.status, 'awaiting-manual-linking'); assert.equal(op.plan.outputFrames, 1034);
  assert.equal(op.outputName, 'PodCut ASSISTED DRAFT — linking required');
  assert.ok(op.stages.includes('awaiting manual linking')); assert.ok(!op.stages.includes('completed'));
  for (const track of f.tracks) {
    assert.deepEqual(track.map(i => [i.start, i.end, i.inPoint, i.outPoint].map(s => Math.round(s * 30))),
      [[0, 308, 0, 308], [308, 1034, 354, 1080]]);
    assert.deepEqual(track.map(i => i.gain), [-6, -6]); // Mock copy semantics, not host gain proof.
  }
  assert.deepEqual(f.names, ['PodCut ASSISTED DRAFT — linking required']);
  assert.equal((await f.run.prepare(f.review)).status, 'failed'); assert.equal(f.calls.filter(c => c === 'candidate').length, 1);
});
test('assisted proof rejects wrong projects, multiple cuts and stale review before candidate creation', async () => {
  for (const mutate of [f => { f.source.projectPath = f.review.source.projectPath = 'other.prproj'; }, f => { f.review.decisions[1].enabled = true; }, f => f.change()]) {
    const f = fixture(); mutate(f);
    const op = await f.run.prepare(f.review);
    assert.equal(op.status, 'failed'); assert.equal(f.calls.filter(c => c === 'candidate').length, 0);
  }
});
test('duplicate concurrent submission creates one assisted draft', async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.run.prepare(f.review), f.run.prepare(f.review)]);
  assert.equal(results.filter(r => r.status === 'fulfilled' && r.value.status === 'awaiting-manual-linking').length, 1);
  assert.equal(f.calls.filter(c => c === 'candidate').length, 1);
});
test('failed or invalidated draft is isolated and never labeled awaiting validation', async () => {
  for (const invalidation of [false, true]) {
    const f = fixture();
    const real = f.project.executeTransaction;
    f.project.executeTransaction = function (callback) {
      if (invalidation) { real.call(this, callback); f.change(); return true; }
      return false;
    };
    const op = await f.run.prepare(f.review);
    assert.equal(op.status, 'failed'); assert.ok(f.names[0].startsWith('PodCut FAILED'));
    assert.ok(f.calls.includes('restore')); assert.equal(f.names.includes('PodCut ASSISTED DRAFT — linking required'), false);
  }
});
