const test = require('node:test');
const assert = require('node:assert/strict');
const { simpleSourceError, planSimpleEdit } = require('../src/core.js');

function source() {
  const item = { projectItemId: 'media-1', start: 0, end: 36, inPoint: 0, outPoint: 36, trackIndex: 0, speed: 1, disabled: false, reversed: false };
  return { videoTracks: 1, audioTracks: 1, captionTracks: 0, videoTransitions: 0, audioTransitions: 0,
    otherItems: 0, videoItems: [{ ...item }], audioItems: [{ ...item }], mediaPath: 'fixture.mov',
    offline: false, nested: false, multicam: false, merged: false, videoMuted: false, audioMuted: false,
    unsupportedEffects: [], durationSeconds: 36, fps: 30 };
}

test('only the proved single-source V1/A1 layout is eligible', () => {
  assert.equal(simpleSourceError(source()), null);
  const emptyExtraTracks = source(); emptyExtraTracks.videoTracks = 2; emptyExtraTracks.audioTracks = 3;
  assert.equal(simpleSourceError(emptyExtraTracks), null);
  for (const change of [
    s => { s.videoTracks = 0; }, s => { s.captionTracks = 1; },
    s => { s.videoTransitions = 1; }, s => { s.videoItems.push({ ...s.videoItems[0] }); },
    s => { s.audioItems[0].projectItemId = 'other'; }, s => { s.audioItems[0].end = 35; },
    s => { s.videoItems[0].trackIndex = 1; }, s => { s.videoItems[0].speed = 2; }, s => { s.offline = true; },
    s => { s.unsupportedEffects.push('Color'); }, s => { s.fps = 29.97; }
  ]) {
    const candidate = source(); change(candidate);
    assert.ok(simpleSourceError(candidate));
  }
});

test('eligible source still rejects a cut before mutation planning', () => {
  const candidate = source();
  assert.equal(simpleSourceError(candidate), null);
  assert.throws(() => planSimpleEdit({ durationSeconds: 36, sourceInSeconds: 0, fps: 30,
    cuts: [{ cutStart: 0, cutEnd: 2 }] }));
});
