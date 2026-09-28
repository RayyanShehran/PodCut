const test = require("node:test");
const assert = require("node:assert/strict");
const { claimExport, createExportWaiter, releaseExport, resolvePresetPath } = require("../src/premiere.js");

const delay = () => new Promise((resolve) => setTimeout(resolve, 0));

test('sequence export uses existing sandbox storage when UXP temporary root disappears', async () => {
  const { readFileSync } = require('node:fs');
  const { runInNewContext } = require('node:vm');
  for (const missing of [false, true, 'EACCES']) {
    const files = [], removed = [], exports = [];
    const fs = {
      async lstat(path) {
        if (path === 'plugin-temp:/') {
          if (missing) throw Object.assign(Error(missing === 'EACCES' ? 'Permission denied' : 'No such file'),
            { code: missing === 'EACCES' ? 'EACCES' : 'ENOENT' });
          return {};
        }
        files.push(path); return { size: 128 };
      },
      async readFile() { return new ArrayBuffer(128); },
      async unlink(path) { removed.push(path); }
    };
    const uxp = { host: { applicationPath: 'C:\\Adobe\\Premiere.exe', version: '26.5' },
      storage: { localFileSystem: {
        async getTemporaryFolder() { return { nativePath: 'C:\\scratch-temp' }; },
        async getDataFolder() { return { nativePath: 'C:\\scratch-data' }; }
      } } };
    const pp = { Constants: { ExportType: { IMMEDIATELY: 1 }, OperationCompleteEvent: { EXPORT_MEDIA_COMPLETE: 'done' } },
      EventManager: { addGlobalEventListener() {}, removeGlobalEventListener() {} },
      EncoderManager: { getExportFileExtension: async () => 'wav', getManager: () => ({
        async exportSequence(...args) { exports.push(args); return true; }
      }) } };
    const module = { exports: {} };
    runInNewContext(readFileSync(require.resolve('../src/premiere.js'), 'utf8'), {
      module, require: name => ({ fs, uxp, premierepro: pp })[name], console,
      PodCutAudio: { wavInfo: () => ({ durationSeconds: 36, channels: 2, sampleRate: 48000, bitsPerSample: 16 }) },
      setTimeout: (fn, ms) => setTimeout(fn, ms >= 600000 ? ms : 1), clearTimeout
    });
    const run = module.exports.sequenceAudio({ name: 'probe', getEndTime: async () => ({ seconds: 36 }) });
    if (missing === 'EACCES') {
      await assert.rejects(run, /Permission denied/);
      assert.equal(exports.length, 0, 'Do not hide unrelated storage failures');
    } else {
      await run;
      assert.equal(exports.length, 1);
      assert.ok(exports[0][2].startsWith(missing ? 'C:\\scratch-data\\' : 'C:\\scratch-temp\\'));
      const prefix = missing ? 'plugin-data:/' : 'plugin-temp:/';
      assert.ok(files.every(path => path.startsWith(prefix)));
      assert.deepEqual(removed, [files[0]], 'Cleanup must use the selected storage scheme');
    }
    module.exports.releaseExport(module.exports.claimExport()); // Preparation failure also releases the lock.
  }
});

function waiter(startExport, inspectOutput = async () => ({ ready: false, detail: "missing" }), timing = {}) {
  let handler;
  let removed = 0;
  const operation = createExportWaiter({
    eventName: "complete",
    addListener: (name, value) => { handler = value; },
    removeListener: () => { removed += 1; },
    startExport,
    inspectOutput,
    pollMs: timing.pollMs || 10000,
    timeoutMs: timing.timeoutMs || 10000
  });
  return { ...operation, event: (value) => handler(value), removed: () => removed };
}

test("Windows application executable resolves the bundled WAV preset", () => {
  assert.equal(
    resolvePresetPath("C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\Adobe Premiere Pro.exe"),
    "C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\MediaIO\\systempresets\\3F3F3F3F_57415645\\Waveform Audio 48kHz 16-bit.epr"
  );
});

test("export false and rejection fail promptly and clean listeners", async () => {
  const refused = waiter(async () => false);
  await assert.rejects(refused.promise, /rejected.*before it started/i);
  assert.equal(refused.removed(), 1);

  const rejected = waiter(async () => { throw new Error("bad preset"); });
  await assert.rejects(rejected.promise, /bad preset/);
  assert.equal(rejected.removed(), 1);
});

test("completion event alone cannot complete an unrelated export", async () => {
  let ready = false;
  const operation = waiter(async () => true, async () => ({ ready, detail: ready ? "valid WAV" : "missing", value: "audio" }));
  operation.event({ state: 1 });
  await delay();
  assert.equal(operation.state.event, "received (state 1)");
  ready = true;
  operation.event({ state: 1 });
  assert.equal(await operation.promise, "audio");
  operation.event({ state: 1 });
  assert.equal(operation.removed(), 1);
});

test("stopping only stops the wait and cleans the listener", async () => {
  const operation = waiter(() => new Promise(() => {}));
  operation.stop();
  await assert.rejects(operation.promise, /was not cancelled/);
  assert.equal(operation.removed(), 1);
});

test("timeout cleans the listener without claiming cancellation", async () => {
  const operation = waiter(async () => true, undefined, { timeoutMs: 5 });
  await assert.rejects(operation.promise, /timed out/i);
  assert.equal(operation.removed(), 1);
});

test("the export lock covers asynchronous preparation", () => {
  const operation = claimExport();
  assert.throws(() => claimExport(), /already active/i);
  operation.stop();
  releaseExport(operation);
  const next = claimExport();
  releaseExport(next);
});
