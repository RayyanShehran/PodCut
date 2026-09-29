const test = require('node:test');
const assert = require('node:assert/strict');
const state = require('../src/assisted-state.js');
const core = require('../src/core.js');
const store = () => { const data = new Map(); return {
  getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k)
}; };

test('work journal blocks jobs across reload, corruption and late old completion', () => {
  const s = store(), old = state.begin(s, 'export', { sequenceId: 'original' });
  assert.equal(state.pending(s).id, old.id);
  assert.throws(() => state.begin(s, 'assisted'), /Interrupted work/);
  s.removeItem(state.workKey); // Explicit user recovery, not assumed host cancellation.
  const fresh = state.begin(s, 'export');
  state.finish(s, old);
  assert.equal(state.pending(s).id, fresh.id);
  state.finish(s, fresh);
  assert.equal(state.pending(s), null);
  s.setItem(state.workKey, '{bad');
  assert.equal(state.pending(s).kind, 'unknown');
  assert.throws(() => state.begin(s, 'export'), /Interrupted work/);
  assert.throws(() => state.begin({ getItem: () => null, setItem: () => { throw Error('storage failed'); } }, 'assisted'), /storage failed/);
});

function fixture(cuts = [{cutStart:9.07,cutEnd:11.8}]) {
  const item = (start,end,inPoint,outPoint) => ({ start,end,inPoint,outPoint,trackIndex:0,speed:1,projectItemId:'media' });
  const original = { projectId:'p',projectPath:'project.prproj',sequenceId:'s',durationSeconds:36,fps:30,
    videoItems:[item(0,36,0,36)],audioItems:[item(0,36,0,36)] };
  const plan = core.planSimpleEdit({durationSeconds:36,sourceInSeconds:0,fps:30,cuts});
  const record = { version:1,projectId:'p',projectPath:'project.prproj',originalSequenceId:'s',candidateSequenceId:'c',
    sourceSnapshot:structuredClone(original),plan,cuts };
  const parts = plan.segments.map(s => item(s.outputStartFrame/30,s.outputEndFrame/30,s.sourceStartFrame/30,s.sourceEndFrame/30));
  const candidate = {...original,sequenceId:'c',captionTracks:0,durationSeconds:plan.outputFrames/30,
    videoItems:structuredClone(parts),audioItems:structuredClone(parts)};
  return {record,inspected:{original,candidate}};
}
test('draft reconciliation verifies exact ownership and ranges, never links or persisted completion', () => {
  const f = fixture();
  assert.deepEqual(state.validateDraft(f.record,f.inspected), f.record.plan);
  for (const mutate of [f=>f.inspected.original.projectPath='copy.prproj',f=>f.inspected.candidate.sequenceId='other',
    f=>f.inspected.original.audioItems[0].end=35,f=>f.inspected.candidate.audioItems[1].inPoint+=1/30,
    f=>f.inspected.candidate.videoItems.push(f.inspected.candidate.videoItems[0]),f=>f.record.plan.outputFrames++,
    f=>f.inspected.candidate.videoItems[0].speed=2,f=>f.record.candidateSequenceId=null]) {
    const f = fixture(); mutate(f); assert.throws(()=>state.validateDraft(f.record,f.inspected));
  }
});

test('multi-cut draft reconciliation checks every retained pair without unlocking production creation', () => {
  const f=fixture([{cutStart:9.07,cutEnd:11.8},{cutStart:22.55,cutEnd:25.45}]);
  assert.deepEqual(state.validateDraft(f.record,f.inspected),f.record.plan);
  assert.equal(f.record.plan.segments.length,3);
  assert.match(state.scopeError({cutCount:2,plan:f.record.plan,current:{source:f.inspected.original}}),/exactly one/);
  f.inspected.candidate.audioItems[2].inPoint+=1/30;
  assert.throws(()=>state.validateDraft(f.record,f.inspected),/ranges/);
});

test('reopening accepts Premiere extended drive prefix but not another project', () => {
  const f = fixture(), path = 'C:\\Fixtures\\proof.prproj';
  f.record.projectPath = f.record.sourceSnapshot.projectPath = path;
  f.inspected.original.projectPath = f.inspected.candidate.projectPath = '\\\\?\\' + path;
  assert.deepEqual(state.validateDraft(f.record, f.inspected), f.record.plan);
  assert.equal(core.projectPathKey('\\\\?\\C:\\Fixtures\\proof.prproj'), path);
  assert.notEqual(core.projectPathKey('C:\\Fixtures\\copy.prproj'), path);
  f.inspected.original.projectId = 'another-project';
  assert.throws(() => state.validateDraft(f.record, f.inspected), /Recorded project/);
});
