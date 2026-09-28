const test = require('node:test');
const assert = require('node:assert/strict');
const { createSourceWatch } = require('../src/premiere.js');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

test('saved Premiere active-export changes and project switches reject stale results and recover', {
  skip: !process.env.PODCUT_ASSISTED_PROOF
}, () => {
  const read = name => JSON.parse(readFileSync(join(process.env.PODCUT_ASSISTED_PROOF, name), 'utf8'));
  const f = read('podcut-assisted-freshness.json');
  const resolvedAt = events => events.find(e => e.detail?.promise === 'resolved true').at;
  assert.equal(f.render.accepted, true);
  assert.ok(f.render.exportStartedAt < f.render.changeRequestedAt);
  assert.ok(f.render.changeReturnedAt < resolvedAt(f.render.events));
  assert.ok(f.renderOutcome.revision > f.render.revisionBefore);
  assert.equal(f.renderOutcome.reviewHidden, true);
  assert.equal(f.renderOutcome.analyzeDisabled, 'false');
  assert.equal(f.recovery.reviewHidden, false);
  const s = read('podcut-assisted-project-switch.json');
  assert.equal(s.before.reviewHidden, false);
  assert.equal(s.after.reviewHidden, true);
  assert.notEqual(s.after.projectPath, s.before.projectPath);
  assert.ok(s.after.revision > s.before.revision);
  assert.match(s.after.preflightError, /changed after analysis/);
  assert.equal(s.after.count, s.before.count);
  assert.equal(s.pending.openReturned, true);
  assert.ok(s.pending.events.find(e => e.stage === 'exporting').at < s.pending.openRequestedAt);
  assert.ok(s.pending.openFinishedAt < resolvedAt(s.pending.events));
  assert.ok(s.pendingOutcome.revision > s.pending.revisionBefore);
  assert.equal(s.pendingOutcome.reviewHidden, true);
  assert.match(s.pendingOutcome.message, /changed during analysis/);
  assert.equal(s.pendingOutcome.count, s.before.count);
  assert.equal(s.recovery.reviewHidden, false);
  assert.equal(s.recovery.analyzeDisabled, 'false');
  assert.equal(s.publicApplyEnabled, false);
  for (const [index, expected] of [
    [0, [[0,1080,0,1080]]], [1, [[0,273,0,273],[273,999,354,1080]]]
  ]) for (const track of s.finalRanges[index].tracks) {
    assert.deepEqual(track.map(i => ['start','end','inPoint','outPoint'].map(k => Math.round(i[k] * 30))), expected);
  }
});

function fixture() {
  const global = new Map(), listeners = [], changes = [];
  let sequence = { getVideoTrackCount: async () => 1, getAudioTrackCount: async () => 1,
    getVideoTrack: async () => 'v1', getAudioTrack: async () => 'a1' };
  const pp = { Constants: { ProjectEvent: { ACTIVATED: 'project', OPENED: 'open', CLOSED: 'close' },
    SequenceEvent: { ACTIVATED: 'sequence', CLOSED: 'sequenceClose' },
    VideoTrackEvent: { INFO_CHANGED: 'info' }, AudioTrackEvent: { INFO_CHANGED: 'info' } },
    Project: { getActiveProject: async () => ({ getActiveSequence: async () => sequence }) },
    EventManager: {
      addGlobalEventListener: (name, handler) => global.set(name, handler),
      removeGlobalEventListener: name => global.delete(name),
      addEventListener: (target, name, handler) => listeners.push({ target, name, handler }),
      removeEventListener: (target, name, handler) => {
        const i = listeners.findIndex(x => x.target === target && x.name === name && x.handler === handler);
        assert.notEqual(i, -1); listeners.splice(i, 1);
      }
    } };
  return { pp, global, listeners, changes, setSequence: value => { sequence = value; } };
}

test('track changes, Undo/Redo, sequence/project switching invalidate monotonically and remove old handlers', async () => {
  const f = fixture(), watch = createSourceWatch(f.pp, event => f.changes.push(event));
  await watch.ready();
  assert.equal(f.listeners.length, 2);
  const old = f.listeners.find(x => x.target === 'a1').handler;
  old(); old(); old(); // change, Undo, Redo must not restore an old revision.
  assert.equal(watch.revision(), 3);
  f.setSequence(null);
  f.global.get('sequence')();
  await watch.ready();
  assert.equal(f.listeners.length, 0);
  old();
  assert.equal(watch.revision(), 4, 'Queued event from detached track must be ignored');
  f.global.get('project')();
  await watch.ready();
  assert.equal(watch.revision(), 5);
  watch.dispose(); watch.dispose();
  assert.equal(f.global.size, 0);
  assert.equal(f.listeners.length, 0);
});

test('pending old bindings cannot attach after switching or destroy; repeated registration stays bounded', async () => {
  const f = fixture();
  let release;
  f.setSequence({ getVideoTrackCount: () => new Promise(resolve => { release = resolve; }),
    getAudioTrackCount: async () => 0, getVideoTrack: async () => 'obsolete' });
  const watch = createSourceWatch(f.pp, () => {});
  await new Promise(resolve => setImmediate(resolve));
  f.setSequence(null);
  f.global.get('sequence')();
  await watch.ready();
  release(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.listeners.length, 0);
  watch.dispose();
  for (let i = 0; i < 3; i++) {
    const next = createSourceWatch(f.pp, () => {});
    await next.ready();
    assert.equal(f.global.size, 5);
    next.dispose();
    assert.equal(f.global.size, 0);
  }
});

test('listener setup failure blocks analysis readiness instead of pretending freshness is monitored', async () => {
  const f = fixture();
  f.pp.EventManager.addEventListener = () => { throw Error('host listener failed'); };
  const watch = createSourceWatch(f.pp, () => {});
  await assert.rejects(watch.ready(), /monitoring unavailable/);
  assert.equal(watch.revision(), 1);
  watch.dispose();
});

test('one native disposal failure does not skip the remaining registrations or reactivate callbacks', async () => {
  const f = fixture(), removed = [];
  const watch = createSourceWatch(f.pp, event => f.changes.push(event));
  await watch.ready();
  const old = f.global.get('project');
  f.pp.EventManager.removeGlobalEventListener = name => {
    removed.push(name);
    if (name === 'project') throw Error('native removal failed');
    f.global.delete(name);
  };
  watch.dispose(); watch.dispose(); old();
  assert.equal(removed.length, 5);
  assert.equal(f.listeners.length, 0);
  assert.equal(f.changes.length, 0);
  await assert.rejects(watch.ready(), /monitoring unavailable/);
});
