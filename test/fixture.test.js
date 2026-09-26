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
  for (const style of ["natural", "balanced", "tight"]) {
    const ranges = detectSilences(decodeWav(wav), { style, minimumSeconds: 1.1 })
      .filter(({ qualifies }) => qualifies)
      .map(({ start, end }) => [start, end]);
    assert.deepEqual(ranges, [[10, 12], [22, 26]]);
  }
});
