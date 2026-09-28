const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { decodeWav, detectSilences, wavInfo } = require("../src/audio.js");

// Supply a WAV extracted from the external MOV fixture; large media stays out of Git.
test("controlled interview fixture has two internal pauses", { skip: !process.env.PODCUT_FIXTURE_WAV }, () => {
  const file = fs.readFileSync(process.env.PODCUT_FIXTURE_WAV);
  const wav = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const info = wavInfo(wav);
  assert.equal(info.durationSeconds, 36);
  assert.equal(info.sampleRate, 48000);
  assert.equal(info.channels, 2);
  const audio = decodeWav(wav);
  const ranges = detectSilences(audio, { style: "natural", minimumSeconds: 1.1 })
    .filter(({ qualifies }) => qualifies);
  assert.equal(ranges.length, 2);
  for (const [range, expected] of ranges.map((range, index) => [range, [[10, 12], [22, 26]][index]])) {
    assert.ok(Math.abs(range.start - expected[0]) < 0.2);
    assert.ok(Math.abs(range.end - expected[1]) < 0.2);
  }

  // The previous source was already clipped and excessively loud before editing.
  for (const [start, end] of [[0, 10], [12, 22], [26, 36]]) {
    const speech = audio.channels[0].subarray(start * info.sampleRate, end * info.sampleRate);
    let sumSquares = 0;
    let max = 0;
    for (const sample of speech) { assert.ok(Number.isFinite(sample)); sumSquares += sample * sample; max = Math.max(max, Math.abs(sample)); }
    assert.ok(max < 0.8, `speech peak ${max} is too high`);
    assert.ok(Math.sqrt(sumSquares / speech.length) < 0.12, `speech RMS is too high`);
  }
});
