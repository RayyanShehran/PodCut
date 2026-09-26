(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PodCutPremiere = api;
})(typeof globalThis === "undefined" ? this : globalThis, function (root) {
  "use strict";

  let activeExport = null;

  function claimExport() {
    if (activeExport) throw new Error("An export is already active. Wait for it to finish before trying again.");
    const operation = {
      stopped: false,
      waiter: null,
      stop() {
        this.stopped = true;
        if (this.waiter) this.waiter.stop();
      }
    };
    activeExport = operation;
    return operation;
  }

  function releaseExport(operation) {
    if (activeExport === operation) activeExport = null;
  }

  function stoppedError() {
    const error = new Error("Stopped waiting. Premiere export was not cancelled; do not retry until any export activity has ended.");
    error.code = "STOPPED_WAITING";
    return error;
  }

  function getApi() {
    try { return require("premierepro"); }
    catch (error) { return null; }
  }

  async function inspectTrack(sequence, kind, count) {
    let clips = 0;
    for (let index = 0; index < count; index += 1) {
      const track = await sequence[kind === "video" ? "getVideoTrack" : "getAudioTrack"](index);
      clips += track.getTrackItems(1, false).length;
    }
    return clips;
  }

  async function activeSequence() {
    const ppro = getApi();
    if (!ppro) return { state: "host-unavailable", message: "Open PodCut inside Premiere Pro 26.5 or later." };
    const project = await ppro.Project.getActiveProject();
    if (!project) return { state: "no-project", message: "Open a Premiere project to continue." };
    const sequence = await project.getActiveSequence();
    if (!sequence) return { state: "no-sequence", message: "Open or select a sequence to continue." };

    const [end, videoTracks, audioTracks] = await Promise.all([
      sequence.getEndTime(),
      sequence.getVideoTrackCount(),
      sequence.getAudioTrackCount()
    ]);
    const [videoClips, audioClips] = await Promise.all([
      inspectTrack(sequence, "video", videoTracks),
      inspectTrack(sequence, "audio", audioTracks)
    ]);

    return {
      state: "ready",
      project,
      sequence,
      projectId: project.guid.toString(),
      projectPath: project.path,
      sequenceId: sequence.guid.toString(),
      name: sequence.name,
      durationSeconds: end.seconds,
      videoTracks,
      audioTracks,
      videoClips,
      audioClips
    };
  }

  function resolvePresetPath(applicationPath) {
    const separator = applicationPath.includes("\\") ? "\\" : "/";
    const appFolder = applicationPath.replace(/[\\/][^\\/]+$/, "");
    return `${appFolder}${separator}MediaIO${separator}systempresets${separator}3F3F3F3F_57415645${separator}Waveform Audio 48kHz 16-bit.epr`;
  }

  function createExportWaiter(options) {
    const state = { promise: "pending", event: "pending", output: "not checked" };
    let settled = false;
    let polling = false;
    let pollTimer;
    let timeoutTimer;
    let resolveResult;
    let rejectResult;
    const report = () => options.onStatus && options.onStatus({ ...state });

    const promise = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    function cleanup() {
      clearTimeout(pollTimer);
      clearTimeout(timeoutTimer);
      options.removeListener(options.eventName, onComplete);
    }
    function finish(error, value) {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) rejectResult(error); else resolveResult(value);
    }
    function scheduleInspect(delay) {
      clearTimeout(pollTimer);
      pollTimer = setTimeout(inspect, delay);
    }
    async function inspect() {
      if (settled || polling) return;
      polling = true;
      try {
        const output = await options.inspectOutput();
        state.output = output.detail;
        report();
        if (output.ready && state.promise === "resolved true") finish(null, output.value);
      } catch (error) {
        state.output = `read error: ${error.message}`;
        report();
      } finally {
        polling = false;
        if (!settled) scheduleInspect(options.pollMs || 1000);
      }
    }
    function onComplete(event) {
      if (settled) return;
      state.event = event && event.state !== undefined ? `received (state ${event.state})` : "received";
      report();
      scheduleInspect(0);
    }
    function stop() {
      finish(stoppedError());
    }

    options.addListener(options.eventName, onComplete);
    report();
    Promise.resolve().then(options.startExport).then((started) => {
      state.promise = `resolved ${started}`;
      report();
      if (!started) {
        const error = new Error("Premiere rejected the sequence audio export before it started.");
        error.code = "EXPORT_NOT_STARTED";
        finish(error);
      } else scheduleInspect(0);
    }, (cause) => {
      state.promise = `rejected: ${cause && cause.message ? cause.message : cause}`;
      report();
      const error = new Error(`Premiere sequence audio export failed: ${cause && cause.message ? cause.message : cause}`);
      error.code = "EXPORT_REJECTED";
      finish(error);
    });
    scheduleInspect(options.pollMs || 1000);
    timeoutTimer = setTimeout(() => {
      const error = new Error(`Premiere audio export timed out. Promise: ${state.promise}; event: ${state.event}; output: ${state.output}.`);
      error.code = "EXPORT_TIMEOUT";
      finish(error);
    }, options.timeoutMs || 10 * 60 * 1000);
    return { promise, state, stop };
  }

  async function sequenceAudio(sequence, onStatus) {
    const ppro = getApi();
    if (!ppro) throw new Error("Premiere is unavailable.");
    const operation = claimExport();
    const operationId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    const diagnostics = [];
    let outputPath;
    let lastSize = -1;
    let unchanged = 0;
    let lastWaitStatus = "";
    const log = (stage, detail) => {
      const entry = { operationId, elapsedMs: Date.now() - startedAt, stage, detail };
      diagnostics.push(entry);
      console.info("PodCut export", JSON.stringify(entry));
      if (onStatus) onStatus({ stage, detail, elapsedMs: entry.elapsedMs, diagnostics });
    };

    try {
      const uxp = require("uxp");
      const fs = require("fs");
      const temp = await uxp.storage.localFileSystem.getTemporaryFolder();
      if (operation.stopped) throw stoppedError();
      const name = `podcut-${operationId}.wav`;
      const separator = temp.nativePath.includes("\\") ? "\\" : "/";
      outputPath = `${temp.nativePath}${separator}${name}`;
      const appPath = uxp.host && uxp.host.applicationPath;
      if (!appPath) throw new Error("Premiere 26.5 or later is required for sequence audio analysis.");
      const presetPath = resolvePresetPath(appPath);
      const encoder = ppro.EncoderManager.getManager();
      const expectedDuration = (await sequence.getEndTime()).seconds;
      if (operation.stopped) throw stoppedError();
      log("preparing", { premiere: uxp.host.version, sequence: sequence.name, durationSeconds: expectedDuration, applicationPath: appPath, presetPath, tempPath: temp.nativePath, outputPath });
      let extension;
      try {
        extension = await ppro.EncoderManager.getExportFileExtension(sequence, presetPath);
        log("preset", { extension });
      } catch (cause) {
        log("preset", { error: cause.message || String(cause) });
        throw new Error(`Premiere could not read the WAV export preset: ${cause.message || cause}`);
      }
      if (operation.stopped) throw stoppedError();

      const fileUrl = `plugin-temp:/${name}`;
      const waiter = createExportWaiter({
      eventName: ppro.Constants.OperationCompleteEvent.EXPORT_MEDIA_COMPLETE,
      addListener: (eventName, handler) => ppro.EventManager.addGlobalEventListener(eventName, handler),
      removeListener: (eventName, handler) => ppro.EventManager.removeGlobalEventListener(eventName, handler),
      startExport: () => {
        log("exporting", { exportType: ppro.Constants.ExportType.IMMEDIATELY, outputPath, presetPath, exportFull: true });
        return encoder.exportSequence(sequence, ppro.Constants.ExportType.IMMEDIATELY, outputPath, presetPath, true);
      },
      inspectOutput: async () => {
        let stat;
        try { stat = await fs.lstat(fileUrl); }
        catch (error) {
          const text = `${error && error.code ? error.code : ""} ${error && error.message ? error.message : error}`;
          if (/ENOENT|not found|no such file/i.test(text)) return { ready: false, detail: "missing" };
          throw error;
        }
        unchanged = stat.size === lastSize ? unchanged + 1 : 0;
        lastSize = stat.size;
        if (stat.size < 44 || unchanged < 1) return { ready: false, detail: `${stat.size} bytes, still changing` };
        const buffer = await fs.readFile(fileUrl);
        const info = root.PodCutAudio.wavInfo(buffer);
        if (Math.abs(info.durationSeconds - expectedDuration) > 0.5) return { ready: false, detail: `${stat.size} bytes, duration ${info.durationSeconds.toFixed(2)}s (expected ${expectedDuration.toFixed(2)}s)` };
        return { ready: true, detail: `${stat.size} bytes, ${info.channels}ch ${info.sampleRate}Hz ${info.bitsPerSample}-bit, ${info.durationSeconds.toFixed(2)}s`, value: buffer };
      },
      onStatus: (state) => {
        const serialized = JSON.stringify(state);
        if (serialized !== lastWaitStatus) {
          lastWaitStatus = serialized;
          log("waiting", state);
        }
      }
      });
      operation.waiter = waiter;
      const buffer = await waiter.promise;
      log("ready", { bytes: buffer.byteLength, extension });
      try { await fs.unlink(fileUrl); } catch (error) { log("cleanup", { error: error.message || String(error) }); }
      return buffer;
    } catch (error) {
      error.diagnostics = diagnostics;
      error.outputPath = outputPath;
      throw error;
    } finally {
      releaseExport(operation);
    }
  }

  function stopWaiting() {
    if (activeExport) activeExport.stop();
  }

  function onActiveSourceChanged(callback) {
    const ppro = getApi();
    if (!ppro) return;
    ppro.EventManager.addGlobalEventListener(ppro.Constants.ProjectEvent.ACTIVATED, callback, true);
    ppro.EventManager.addGlobalEventListener(ppro.Constants.ProjectEvent.OPENED, callback, true);
    ppro.EventManager.addGlobalEventListener(ppro.Constants.ProjectEvent.CLOSED, callback);
    ppro.EventManager.addGlobalEventListener(ppro.Constants.SequenceEvent.ACTIVATED, callback);
  }

  async function setPlayerPosition(sequence, seconds) {
    const ppro = getApi();
    if (!ppro || !sequence || !Number.isFinite(seconds) || seconds < 0) throw new Error("Cannot locate this decision in Premiere.");
    const moved = await sequence.setPlayerPosition(ppro.TickTime.createWithSeconds(seconds));
    if (!moved) throw new Error("Premiere did not move the sequence playhead.");
  }

  return { activeSequence, claimExport, createExportWaiter, onActiveSourceChanged, releaseExport, resolvePresetPath, sequenceAudio, setPlayerPosition, stopWaiting };
});
