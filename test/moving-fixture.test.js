const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

// Optional external media regression: catch frozen/duplicated/reordered fixture video.
test('moving fixture preserves every chronological NASA frame, including muted intervals', {
  skip: !process.env.PODCUT_MOVING_FIXTURE
}, () => {
  const ffmpeg = process.env.PODCUT_FFMPEG;
  const source = process.env.PODCUT_NASA_SOURCE;
  assert.ok(ffmpeg && source, 'Supply PODCUT_FFMPEG and PODCUT_NASA_SOURCE');
  const hashes = (file, filter) => execFileSync(ffmpeg, ['-v', 'error', '-i', file,
    '-map', '0:v:0', '-vf', filter, '-fps_mode', 'passthrough', '-f', 'framemd5', '-'],
  { encoding: 'utf8', maxBuffer: 2e6 }).split('\n').filter(line => line && !line.startsWith('#'))
    .map(line => line.split(',').at(-1).trim());
  const expected = hashes(source, 'trim=start_frame=600:end_frame=1680,setpts=N/(30*TB)');
  const actual = hashes(process.env.PODCUT_MOVING_FIXTURE, 'null');
  assert.equal(actual.length, 1080);
  assert.deepEqual(actual, expected, 'Video must match source frames exactly, not padded holds');
  for (const [start, end] of [[300, 360], [660, 780]]) {
    assert.equal(new Set(actual.slice(start, end)).size, end - start, 'Muted video frames must remain distinct');
  }
});
