const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./unguarded-service.cjs');
const proof = load('../scripts/assisted-proof.js');
const service = load('../src/apply.js');
let next = 0;
function fixture(inPoint = 0, multipleCuts = false) {
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
  const tracks = [[item(inPoint)], [item(inPoint)]], calls = [], names = [];
  let candidateId;
  const sequence = { guid: { toString: () => candidateId }, getVideoTrack: () => ({ getTrackItems: () => tracks[0] }),
    getAudioTrack: () => ({ getTrackItems: () => tracks[1] }), getEndTime: () => ({ seconds: Math.max(...tracks.flat().map(i => i.end)) }) };
  const project = { path: 'C:/Fixtures/assisted.prproj', getSequences: async () => [sequence], getSequence: () => sequence,
    lockedAccess: f => f(), executeTransaction(f) { f({ addAction(a) { a(); return true; } }); return true; } };
  const api = { TickTime: { createWithSeconds: seconds => ({ seconds }) }, SequenceEditor: { getEditor: () => ({
    createCloneTrackItemAction(i, offset) { return () => {
      const track = tracks.find(t => t.includes(i)); track.push(item(i.inPoint, i.start + offset.seconds, i.end + offset.seconds, i.gain));
    }; }
  }) } };
  const metadata = { projectItemId: 'media', start: 0, end: 36, inPoint, outPoint: inPoint + 36, trackIndex: 0, speed: 1 };
  const source = { projectId: 'project', projectPath: project.path, sequenceId: 'original', name: 'Source', durationSeconds: 36,
    fps: 30, videoTracks: 1, audioTracks: 1, captionTracks: 0, videoTransitions: 0, audioTransitions: 0,
    videoItems: [{ ...metadata }], audioItems: [{ ...metadata }], mediaPath: 'fixture.mov', unsupportedEffects: [] };
  const review = { key: `assisted-${++next}`, recipe: '{}', currentRecipe: '{}', analysisId: next,
    source: structuredClone(source), revision: 1, confirmed: true, experimentalConfirmed: true,
    decisions: [{ enabled: true, cutStart: 10.25, cutEnd: 11.8 }, { enabled: false, cutStart: 22.55, cutEnd: 25.45 }] };
  const base = { sourceRevision: () => revision, inspect: async () => ({ key: review.key, source, handles: { project } }),
    createCandidate: async () => { calls.push('candidate'); for (const track of tracks) track.splice(0, track.length, item(inPoint)); return candidateId = `candidate-${calls.length}`; },
    nameCandidate: async (op, name) => { names.push(name); return true; },
    presentCandidate: async () => true, restoreOriginal: async () => { calls.push('restore'); }, reconcile: async () => {} };
  const run = multipleCuts ? load('../src/assisted.js', true)(base, api, load('../src/apply.js', true), 'assisted.prproj') :
    proof(base, api, service, 'assisted.prproj');
  return { run, review, calls, names, tracks, project, source, base, api, change: () => revision++ };
}
test('experimental adapter requires explicit opt-in and enforces the same proven scope before mutation', async () => {
  const make = load('../src/assisted.js');
  for (const caseName of ['no opt-in', 'multiple cuts', 'other fps', 'unsaved project', 'supported']) {
    const f = fixture();
    f.review.experimentalConfirmed = caseName !== 'no opt-in';
    if (caseName === 'multiple cuts') f.review.decisions[1].enabled = true;
    if (caseName === 'other fps') f.review.source.fps = f.source.fps = 25;
    if (caseName === 'unsaved project') f.review.source.projectPath = f.source.projectPath = f.project.path = '';
    const run = make(f.base, f.api, service, { experimental: true });
    if (caseName === 'no opt-in') await assert.rejects(run.prepare(f.review), /confirmation/);
    else {
      const op = await run.prepare(f.review);
      assert.equal(op.status, caseName === 'supported' ? 'awaiting-manual-linking' : 'failed');
    }
    assert.equal(f.calls.filter(c => c === 'candidate').length, caseName === 'supported' ? 1 : 0);
  }
});

test('development two-cut construction maps trimmed source, enabled subset and every retained gain', async () => {
  for (const inPoint of [0, 2]) {
    const f = fixture(inPoint, true);
    f.review.decisions[1].enabled = true;
    f.review.decisions.push({enabled:false,cutStart:30,cutEnd:31});
    const before = structuredClone(f.source);
    const op = await f.run.prepare(f.review);
    assert.equal(op.status, 'awaiting-manual-linking');
    assert.equal(op.plan.outputFrames, 947);
    for (const track of f.tracks) {
      assert.deepEqual(track.map(i=>[i.start,i.end,i.inPoint,i.outPoint].map(s=>Math.round(s*30))),
        [[0,308,30*inPoint,308+30*inPoint],[308,631,354+30*inPoint,677+30*inPoint],[631,947,764+30*inPoint,1080+30*inPoint]]);
      assert.deepEqual(track.map(i=>i.gain),[-6,-6,-6]); // Mock only; native proof separately required.
    }
    assert.deepEqual(f.source,before);
  }
});

test('development two-cut partial failure is isolated and retry starts a fresh candidate', async () => {
  const f = fixture(0,true); f.review.decisions[1].enabled = true;
  const real = f.project.executeTransaction; let count=0;
  f.project.executeTransaction = function(callback) { if (++count === 4) return false; return real.call(this,callback); };
  const failed = await f.run.prepare(f.review);
  assert.equal(failed.status,'failed'); assert.equal(f.tracks[0].length,3);
  assert.ok(f.names[0].startsWith('PodCut FAILED')); assert.ok(f.calls.includes('restore'));
  f.project.executeTransaction=real;
  const retried = await f.run.prepare(f.review);
  assert.equal(retried.status,'awaiting-manual-linking');
  assert.notEqual(retried.candidateSequenceId,failed.candidateSequenceId);
  assert.equal(f.calls.filter(c=>c==='candidate').length,2);
  assert.equal(f.tracks[0].length,3);
});

test('development two-cut double submission creates one candidate; aligned adjacency rejects before mutation', async () => {
  const f=fixture(0,true); f.review.decisions[1].enabled=true;
  const results=await Promise.allSettled([f.run.prepare(f.review),f.run.prepare(f.review)]);
  assert.equal(results.filter(r=>r.status==='fulfilled' && r.value.status==='awaiting-manual-linking').length,1);
  assert.equal(f.calls.filter(c=>c==='candidate').length,1);
  for (const secondStart of [11.8,11.801,11.7]) {
    const f=fixture(0,true); f.review.decisions[1]={enabled:true,cutStart:secondStart,cutEnd:13};
    const op=await f.run.prepare(f.review);
    // 11.801 rounds to frame 355 and legitimately leaves one frame; exact adjacency/overlap reject.
    assert.equal(op.status,secondStart===11.801?'awaiting-manual-linking':'failed');
    assert.equal(f.calls.filter(c=>c==='candidate').length,secondStart===11.801?1:0);
  }
});
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
