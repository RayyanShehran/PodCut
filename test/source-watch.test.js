const test = require('node:test');
const assert = require('node:assert/strict');
const { createSourceWatch } = require('../src/premiere.js');

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
