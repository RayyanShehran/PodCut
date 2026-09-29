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

test('saved native two-cut assisted draft preserves all three minus6 sections', {
  skip: !process.env.PODCUT_MULTI_CUT_PROOF
}, () => {
  const dir = process.env.PODCUT_MULTI_CUT_PROOF;
  const source = pcm(join(dir, 'podcut_multicut_source_20260929.wav'));
  const output = pcm(join(dir, 'podcut_multicut_output_20260929.wav'));
  const baseline = pcm(join(dir, 'Assisted-Draft-2026-09-28', 'podcut-assisted-source.wav'));
  assert.ok(source.samples.equals(baseline.samples), 'Source differs from recorded minus6 baseline');
  const e = JSON.parse(readFileSync(join(dir, 'podcut_multicut_proof_20260929.json'), 'utf8'));
  assert.equal(e.after - e.before, 1);
  assert.equal(e.originalUnchanged, true);
  assert.equal(e.record.status, 'awaiting-manual-linking');
  assert.equal(e.record.cuts.length, 2);
  assert.equal(e.record.plan.outputFrames, 912);
  assert.equal(output.info.sampleCount, 912 * 1600);
  require('../src/assisted-state.js').validateDraft(e.record, e.inspected);
  for (const s of e.record.plan.segments)
    retained(source, output, s.sourceStartFrame + 2, s.outputStartFrame + 2, s.sourceEndFrame - s.sourceStartFrame - 4);
});

test('saved assisted draft retains both minus6 sections and awaits native linking', {
  skip: !process.env.PODCUT_ASSISTED_PROOF
}, () => {
  const dir = process.env.PODCUT_ASSISTED_PROOF;
  const source = pcm(join(dir, 'podcut-assisted-source.wav'));
  const output = pcm(join(dir, 'podcut-assisted-draft.wav'));
  // Fractional host ticks add one zero stereo sample-frame at export end,
  // not a video frame or changed retained speech.
  assert.equal(output.info.sampleCount, 999 * 1600 + 1);
  assert.ok(output.samples.subarray(-4).equals(Buffer.alloc(4)));
  retained(source, output, 2, 2, 269);
  retained(source, output, 356, 275, 722);
  const e = JSON.parse(readFileSync(join(dir, 'podcut-assisted-proof.json'), 'utf8'));
  assert.equal(e.operation.status, 'awaiting-manual-linking');
  assert.equal(e.operation.plan.outputFrames, 999);
  assert.equal(e.sequenceCountAfter - e.sequenceCountBefore, 1);
  assert.equal(e.duplicateRejected, true);
  assert.equal(e.publicApplyDisabled, true);
  assert.equal(e.productionHooksRestored, true);
  assert.equal(e.manualRelinkVerified, false);
  // Recorded native clicks, not a programmatic link-property query.
  assert.equal(e.headSelection.length, 2);
  assert.equal(e.tailSelection.length, 1);
  for (const items of e.originalAfter)
    assert.deepEqual(items.map(i => [i.start, i.end, i.inPoint, i.outPoint]), [[0, 36, 0, 36]]);
  for (const items of e.candidateRanges) {
    assert.deepEqual(items.map(i => [i.start, i.end, i.inPoint, i.outPoint].map(t => Math.round(t * 30))),
      [[0, 273, 0, 273], [273, 999, 354, 1080]]);
    for (const item of items) assert.equal(item.projectItemId, e.operation.sourceSnapshot.videoItems[0].projectItemId);
  }
});

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
