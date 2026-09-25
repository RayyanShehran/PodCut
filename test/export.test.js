const test = require("node:test");
const assert = require("node:assert/strict");
const { createExportWaiter, resolvePresetPath } = require("../src/premiere.js");

const delay = () => new Promise((resolve) => setTimeout(resolve, 0));

function waiter(startExport, inspectOutput = async () => ({ ready: false, detail: "missing" })) {
  let handler;
  let removed = 0;
  const operation = createExportWaiter({
    eventName: "complete",
    addListener: (name, value) => { handler = value; },
    removeListener: () => { removed += 1; },
    startExport,
    inspectOutput,
    pollMs: 10000,
    timeoutMs: 10000
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
