const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { wavInfo } = require('../src/audio.js');

// Non-shipping host regression. Compare signed, interleaved PCM, not detector RMS
// or variable WAV headers. Exact equality is justified only for this PCM fixture.
function pcm(file) {
  const bytes = readFileSync(file);
  const info = wavInfo(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.equal(info.channels, 2);
  assert.equal(info.sampleRate, 48000);
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    if (bytes.toString('ascii', offset, offset + 4) === 'data')
      return { info, samples: bytes.subarray(offset + 8, offset + 8 + size) };
    offset += 8 + size + size % 2;
  }
  throw new Error('Missing PCM payload');
}

function retained(source, output, sourceFrame, outputFrame, frames) {
  const bytesPerFrame = 48000 / 30 * 4;
  const part = (data, frame) => data.subarray(frame * bytesPerFrame, (frame + frames) * bytesPerFrame);
  const expected = part(source.samples, sourceFrame);
  const actual = part(output.samples, outputFrame);
  assert.equal(expected.length, frames * bytesPerFrame);
  assert.equal(actual.length, expected.length);
  assert.ok(actual.equals(expected), 'Retained signed channel samples changed (gain/polarity/routing/interleaving)');
}

test('retained PCM check catches the demonstrated post-cut gain reset', () => {
  const samples = Buffer.alloc(1600 * 4);
  const louder = Buffer.alloc(samples.length);
  for (let i = 0; i < samples.length; i += 2) {
    samples.writeInt16LE(i % 4 ? -1000 : 1000, i);
    louder.writeInt16LE(i % 4 ? -2000 : 2000, i);
  }
  retained({ samples }, { samples: Buffer.from(samples) }, 0, 0, 1);
  assert.throws(() => retained({ samples }, { samples: louder }, 0, 0, 1), /samples changed/);
});

test('Premiere track clones preserve minus6 gain in every retained section, including trimmed source', {
  skip: !process.env.PODCUT_TRACK_CLONE_PROOF
}, () => {
  const dir = process.env.PODCUT_TRACK_CLONE_PROOF;
  for (const [sourceName, outputName, duration, windows] of [
    ['podcut-trackclone-minus6-source-v2.wav', 'podcut-trackclone-minus6-output-v2.wav', 1034,
      [[60, 60, 180], [420, 374, 180]]],
    ['podcut-trackclone-trim-source.wav', 'podcut-trackclone-trim-output.wav', 974,
      [[60, 60, 120], [360, 314, 180]]]
  ]) {
    const source = pcm(join(dir, sourceName));
    const output = pcm(join(dir, outputName));
    assert.equal(output.info.sampleCount, duration * 1600);
    for (const window of windows) retained(source, output, ...window);
  }
  const evidence = JSON.parse(readFileSync(join(dir, 'podcut-trackclone-trim-proof.json'), 'utf8'));
  assert.deepEqual(evidence.originalAfter, evidence.operation.sourceSnapshot);
  for (const [output, expected] of [[evidence.output, [[0, 308, 0, 308], [308, 1034, 354, 1080]]],
    [evidence.trimOutput, [[0, 248, 60, 308], [248, 974, 354, 1080]]]]) {
    for (const items of [output.videoItems, output.audioItems]) {
      assert.equal(items.length, expected.length);
      items.forEach((item, i) => {
        assert.equal(item.projectItemId, evidence.operation.sourceSnapshot.videoItems[0].projectItemId);
        assert.deepEqual([item.start, item.end, item.inPoint, item.outPoint].map(t => Math.round(t * 30)), expected[i]);
      });
    }
  }
});
