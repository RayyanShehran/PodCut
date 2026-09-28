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

  async function traced(trace, stage, work) {
    if (!trace) return work();
    const started = Date.now();
    trace(stage, "start");
    try {
      const result = await work();
      trace(stage, "complete", { durationMs: Date.now() - started });
      return result;
    } catch (error) {
      trace(stage, "error", { durationMs: Date.now() - started, error: error.message || String(error) });
      throw error;
    }
  }

  async function inspectTrack(sequence, kind, count, trace) {
    let clips = 0;
    for (let index = 0; index < count; index += 1) {
      const track = await traced(trace, `active.${kind}Track.${index}`, () => sequence[kind === "video" ? "getVideoTrack" : "getAudioTrack"](index));
      clips += track.getTrackItems(1, false).length;
    }
    return clips;
  }

  async function activeSequence(trace) {
    const ppro = getApi();
    if (!ppro) return { state: "host-unavailable", message: "Open PodCut inside Premiere Pro 26.5 or later." };
    const project = await traced(trace, "active.project", () => ppro.Project.getActiveProject());
    if (!project) return { state: "no-project", message: "Open a Premiere project to continue." };
    const sequence = await traced(trace, "active.sequence", () => project.getActiveSequence());
    if (!sequence) return { state: "no-sequence", message: "Open or select a sequence to continue." };

    const [end, videoTracks, audioTracks] = await Promise.all([
      traced(trace, "active.endTime", () => sequence.getEndTime()),
      traced(trace, "active.videoTrackCount", () => sequence.getVideoTrackCount()),
      traced(trace, "active.audioTrackCount", () => sequence.getAudioTrackCount())
    ]);
    const [videoClips, audioClips] = await Promise.all([
      inspectTrack(sequence, "video", videoTracks, trace),
      inspectTrack(sequence, "audio", audioTracks, trace)
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

  let sourceWatch = null;

  // INFO_CHANGED includes TRACK_CHANGED; don't double-subscribe to each edit.
  // This is conservative invalidation, not proof of every audio-affecting change.
  function createSourceWatch(ppro, callback) {
    const manager = ppro.EventManager;
    let revision = 0, generation = 0, disposed = false, bindings = [], ready, bindingError;
    const clearTracks = () => {
      for (const [target, event, handler] of bindings) {
        try { manager.removeEventListener(target, event, handler); }
        catch (error) { console.warn("PodCut source listener cleanup", error); }
      }
      bindings = [];
    };
    const bind = () => {
      const run = ++generation;
      clearTracks();
      bindingError = null;
      ready = (async () => {
        const project = await ppro.Project.getActiveProject();
        const sequence = project && await project.getActiveSequence();
        const tracks = [];
        if (sequence) for (const [kind, events] of [["Video", ppro.Constants.VideoTrackEvent], ["Audio", ppro.Constants.AudioTrackEvent]]) {
          const count = await sequence[`get${kind}TrackCount`]();
          for (let i = 0; i < count; i++) tracks.push([await sequence[`get${kind}Track`](i), events.INFO_CHANGED]);
        }
        if (disposed || run !== generation) return;
        for (const [track, event] of tracks) {
          const handler = () => {
            if (disposed || run !== generation) return;
            revision += 1;
            console.info("PodCut source invalidated", JSON.stringify({ kind: "track", revision, event }));
            callback({ kind: "track", revision });
          };
          manager.addEventListener(track, event, handler);
          bindings.push([track, event, handler]);
        }
      })().catch(error => {
        if (disposed || run !== generation) return;
        bindingError = error;
        revision += 1;
        clearTracks();
        console.error("PodCut source watch failed", error);
        callback({ kind: "watch-error", revision });
      });
    };
    const activated = () => {
      if (disposed) return;
      revision += 1;
      bind();
      callback({ kind: "activation", revision });
    };
    const globals = [ppro.Constants.ProjectEvent.ACTIVATED, ppro.Constants.ProjectEvent.OPENED,
      ppro.Constants.ProjectEvent.CLOSED, ppro.Constants.SequenceEvent.ACTIVATED, ppro.Constants.SequenceEvent.CLOSED];
    for (const event of globals) manager.addGlobalEventListener(event, activated,
      event === ppro.Constants.ProjectEvent.ACTIVATED || event === ppro.Constants.ProjectEvent.OPENED);
    bind();
    return {
      revision: () => revision,
      async ready() {
        let pending;
        do { pending = ready; await pending; } while (pending !== ready);
        if (disposed || bindingError) throw new Error("Source change monitoring unavailable. Reload PodCut before analyzing.");
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        generation += 1;
        clearTracks();
        for (const event of globals) manager.removeGlobalEventListener(event, activated);
      }
    };
  }

  function onActiveSourceChanged(callback) {
    if (sourceWatch) sourceWatch.dispose();
    const ppro = getApi();
    sourceWatch = ppro ? createSourceWatch(ppro, callback) : null;
    const watch = sourceWatch;
    return () => { if (watch) watch.dispose(); if (sourceWatch === watch) sourceWatch = null; };
  }
  function sourceRevision() { return sourceWatch ? sourceWatch.revision() : undefined; }
  async function readySourceWatch() { if (sourceWatch) await sourceWatch.ready(); }

  async function setPlayerPosition(sequence, seconds) {
    const ppro = getApi();
    if (!ppro || !sequence || !Number.isFinite(seconds) || seconds < 0) throw new Error("Cannot locate this decision in Premiere.");
    const moved = await sequence.setPlayerPosition(ppro.TickTime.createWithSeconds(seconds));
    if (!moved) throw new Error("Premiere did not move the sequence playhead.");
  }

  function applyAdapter() {
    const ppro = getApi();
    if (!ppro) throw new Error("Apply requires Premiere Pro 26.5 or later.");
    const core = root.PodCutCore;
    const handles = new Map();
    const tick = (seconds) => ppro.TickTime.createWithSeconds(seconds);
    const guid = (sequence) => sequence.guid.toString();
    const checkedTransaction = (project, actions, label) => {
      let accepted = false;
      project.lockedAccess(() => {
        const prepared = actions(); // Build all actions before the first addAction; Premiere may partially apply on a throw.
        accepted = project.executeTransaction((compound) => {
          for (const action of prepared) if (compound.addAction(action) === false) throw new Error(`${label}: action rejected.`);
        }, label);
      });
      return accepted;
    };
    const itemIds = async (folder) => {
      const items = await folder.getItems();
      const result = [];
      for (const item of items) {
        result.push(item);
        let childFolder;
        try { childFolder = ppro.FolderItem.cast(item); } catch (error) { childFolder = null; }
        if (childFolder && typeof childFolder.getItems === "function") result.push(...await itemIds(childFolder));
      }
      return result;
    };
    const components = async (item, label, trace) => {
      const chain = await traced(trace, `${label}.componentChain`, () => item.getComponentChain());
      if (!chain) return [];
      const names = [];
      for (let i = 0; i < chain.getComponentCount(); i += 1) {
        const component = chain.getComponentAtIndex(i);
        const name = await traced(trace, `${label}.component.${i}.name`, () => component.getDisplayName());
        if (!["Motion", "Opacity", "Time Remapping", "Volume", "Channel Volume", "Panner"].includes(name)) names.push(name);
        for (let j = 0; j < component.getParamCount(); j += 1)
          if (component.getParam(j).isTimeVarying()) names.push(`${name} keyframes`);
      }
      return names;
    };
    const inspectItem = async (item, label, trace) => {
      const call = (name, work) => traced(trace, `${label}.${name}`, work);
      const projectItem = await call("projectItem", () => item.getProjectItem());
      return { projectItemId: projectItem.getId(), start: (await call("start", () => item.getStartTime())).seconds,
        end: (await call("end", () => item.getEndTime())).seconds, inPoint: (await call("inPoint", () => item.getInPoint())).seconds,
        outPoint: (await call("outPoint", () => item.getOutPoint())).seconds, trackIndex: await call("trackIndex", () => item.getTrackIndex()), speed: await call("speed", () => item.getSpeed()),
        disabled: await call("disabled", () => item.isDisabled()), reversed: Boolean(await call("reversed", () => item.isSpeedReversed())),
        adjustmentLayer: Boolean(item.isAdjustmentLayer && await call("adjustmentLayer", () => item.isAdjustmentLayer())),
        effects: await components(item, label, trace) };
    };
    const inspectSequence = async (project, sequence, trace) => {
      const call = (name, work) => traced(trace, `source.${name}`, work);
      const videoTracks = await call("videoTrackCount", () => sequence.getVideoTrackCount());
      const audioTracks = await call("audioTrackCount", () => sequence.getAudioTrackCount());
      const captionTracks = await call("captionTrackCount", () => sequence.getCaptionTrackCount());
      const videos = [], audios = [];
      // Adobe PREVIEW/FEEDBACK track-item types are not timeline edits; inspect only CLIP and TRANSITION.
      let videoTransitions = 0, audioTransitions = 0, videoMuted = false, audioMuted = false;
      for (let i = 0; i < videoTracks; i += 1) {
        const track = await call(`videoTrack.${i}`, () => sequence.getVideoTrack(i));
        videos.push(...track.getTrackItems(1, false));
        videoTransitions += track.getTrackItems(2, false).length;
        videoMuted ||= await call(`videoTrack.${i}.muted`, () => track.isMuted());
      }
      for (let i = 0; i < audioTracks; i += 1) {
        const track = await call(`audioTrack.${i}`, () => sequence.getAudioTrack(i));
        audios.push(...track.getTrackItems(1, false));
        audioTransitions += track.getTrackItems(2, false).length;
        audioMuted ||= await call(`audioTrack.${i}.muted`, () => track.isMuted());
      }
      const videoItems = await Promise.all(videos.map((item, i) => inspectItem(item, `source.video.${i}`, trace)));
      const audioItems = await Promise.all(audios.map((item, i) => inspectItem(item, `source.audio.${i}`, trace)));
      const projectItem = videos.length ? await call("mediaItem", () => videos[0].getProjectItem()) : null;
      const media = projectItem && ppro.ClipProjectItem.cast(projectItem);
      const source = { projectId: project.guid.toString(), projectPath: project.path,
        sequenceId: guid(sequence), name: sequence.name, durationSeconds: (await call("endTime", () => sequence.getEndTime())).seconds,
        fps: (await call("settings", () => sequence.getSettings())).getVideoFrameRate().value, videoTracks, audioTracks, captionTracks,
        videoTransitions, audioTransitions, videoItems, audioItems, videoMuted, audioMuted,
        mediaPath: media && await call("mediaPath", () => media.getMediaFilePath()), offline: media && await call("offline", () => media.isOffline()),
        nested: media && await call("nested", () => media.isSequence()), multicam: media && await call("multicam", () => media.isMulticamClip()),
        merged: media && await call("merged", () => media.isMergedClip()),
        unsupportedEffects: [...videoItems, ...audioItems].flatMap(item => item.effects) };
      return { source, media, videos, audios };
    };
    const sequences = async (project) => new Map((await project.getSequences()).map(sequence => [guid(sequence), sequence]));
    const getHandle = (operation) => {
      const handle = handles.get(operation.id);
      if (!handle) throw new Error("Apply operation lost its Premiere handles.");
      return handle;
    };
    const requireFresh = (operation) => {
      if (!Number.isInteger(operation.sourceRevision) || operation.sourceRevision !== sourceRevision())
        throw new Error("Sequence content changed before mutation, or monitoring is unavailable. Analyze again.");
    };
    return {
      sourceRevision,
      async inspect(trace) {
        const current = await activeSequence(trace);
        if (current.state !== "ready") throw new Error(current.message || "No active sequence.");
        if (trace) trace("active.ready", "complete", { projectId: current.projectId, sequenceId: current.sequenceId, videoClips: current.videoClips, audioClips: current.audioClips });
        const inspected = await inspectSequence(current.project, current.sequence, trace);
        return { key: core.sequenceKey(current), source: inspected.source,
          handles: { project: current.project, original: current.sequence, media: inspected.media } };
      },
      async createCandidate(operation) {
        requireFresh(operation);
        const inspected = await this.inspect();
        if (JSON.stringify(inspected.source) !== JSON.stringify(operation.sourceSnapshot))
          throw new Error("The source changed during Apply preflight.");
        const { project, original, media } = inspected.handles;
        const handle = { project, original, media, originalSource: inspected.source, subclips: new Map(),
          beforeSequences: await sequences(project) };
        handles.set(operation.id, handle);
        const accepted = checkedTransaction(project, () => {
          requireFresh(operation);
          return [original.createCloneAction()];
        }, `PodCut clone ${operation.id}`);
        const after = await sequences(project);
        const added = [...after].filter(([id]) => !handle.beforeSequences.has(id));
        if (added.length === 1) { handle.candidate = added[0][1]; operation.candidateSequenceId = added[0][0]; }
        if (!accepted || !handle.candidate) throw new Error("Premiere did not create exactly one identifiable candidate sequence.");
        return operation.candidateSequenceId;
      },
      async createSubclip(operation, segment) {
        const handle = getHandle(operation);
        const before = new Set((await itemIds(await handle.project.getRootItem())).map(item => item.getId()));
        const name = `PodCut ${operation.id} segment ${operation.subclips.length + 2}`;
        const accepted = checkedTransaction(handle.project, () => {
          requireFresh(operation);
          return [handle.media.createSubClipAction(name,
            tick(segment.sourceStartFrame / operation.plan.fps), tick(segment.sourceEndFrame / operation.plan.fps), true,
            { takeVideo: true, takeAudio: true })];
        }, `PodCut subclip ${operation.id}`);
        const added = (await itemIds(await handle.project.getRootItem())).filter(item => !before.has(item.getId()) && item.name === name);
        if (added.length === 1) handle.subclips.set(added[0].getId(), added[0]);
        if (!accepted || added.length !== 1) throw new Error(`Premiere did not create exactly one identifiable subclip ${name}.`);
        return { id: added[0].getId(), sourceStartFrame: segment.sourceStartFrame, sourceEndFrame: segment.sourceEndFrame };
      },
      async editCandidate(operation) {
        const handle = getHandle(operation);
        if (JSON.stringify((await inspectSequence(handle.project, handle.original)).source) !== JSON.stringify(handle.originalSource))
          throw new Error("The original sequence changed before candidate editing.");
        const candidate = handle.candidate;
        const video = (await candidate.getVideoTrack(0)).getTrackItems(1, false);
        const audio = (await candidate.getAudioTrack(0)).getTrackItems(1, false);
        if (video.length !== 1 || audio.length !== 1) throw new Error("Candidate changed before editing.");
        const editor = ppro.SequenceEditor.getEditor(candidate);
        const segments = operation.plan.segments;
        return checkedTransaction(handle.project, () => {
          requireFresh(operation);
          const actions = [video[0].createSetOutPointAction(tick(segments[0].sourceEndFrame / operation.plan.fps)),
            audio[0].createSetOutPointAction(tick(segments[0].sourceEndFrame / operation.plan.fps))];
          for (let i = 1; i < segments.length; i += 1) {
            const subclipId = operation.subclips[i - 1].id || operation.subclips[i - 1];
            const subclip = handle.subclips.get(subclipId);
            if (!subclip) throw new Error(`Retained subclip ${i} is missing.`);
            actions.push(editor.createOverwriteItemAction(subclip, tick(segments[i].outputStartFrame / operation.plan.fps), 0, 0));
          }
          return actions;
        }, `PodCut edit ${operation.id}`);
      },
      async verifyCandidate(operation) {
        const handle = getHandle(operation);
        const after = await inspectSequence(handle.project, handle.candidate);
        const before = await inspectSequence(handle.project, handle.original);
        if (JSON.stringify(before.source) !== JSON.stringify(handle.originalSource)) throw new Error("Original sequence changed during Apply.");
        const plan = operation.plan;
        const expectedEnd = plan.outputFrames / plan.fps;
        if (after.source.videoTracks !== handle.originalSource.videoTracks ||
            after.source.audioTracks !== handle.originalSource.audioTracks || after.source.captionTracks !== 0 ||
            after.source.videoTransitions || after.source.audioTransitions ||
            Math.abs(after.source.durationSeconds - expectedEnd) > 1e-4 ||
            after.source.videoItems.length !== plan.segments.length || after.source.audioItems.length !== plan.segments.length)
          throw new Error("Candidate structure or duration does not match the frame plan.");
        for (let i = 0; i < plan.segments.length; i += 1) {
          const segment = plan.segments[i];
          for (const item of [after.source.videoItems[i], after.source.audioItems[i]]) {
            const near = (value, frame) => Math.abs(value - frame / plan.fps) < 1e-4;
            if (!near(item.start, segment.outputStartFrame) || !near(item.end, segment.outputEndFrame) ||
                item.trackIndex !== 0 ||
                !near(item.outPoint - item.inPoint, segment.sourceEndFrame - segment.sourceStartFrame) ||
                !near(item.inPoint, i ? 0 : segment.sourceStartFrame) ||
                !near(item.outPoint, i ? segment.sourceEndFrame - segment.sourceStartFrame : segment.sourceEndFrame) ||
                item.projectItemId !== (i ? operation.subclips[i - 1].id || operation.subclips[i - 1] : handle.originalSource.videoItems[0].projectItemId))
              throw new Error(`Candidate video/audio segment ${i + 1} differs from the frame plan.`);
          }
        }
        return true;
      },
      async nameCandidate(operation, name) {
        const handle = getHandle(operation);
        if (!handle.candidate || guid(handle.candidate) !== operation.candidateSequenceId) return false;
        const item = await handle.candidate.getProjectItem();
        return checkedTransaction(handle.project, () => [item.createSetNameAction(name)], `PodCut name ${operation.id}`);
      },
      async presentCandidate(operation) {
        const handle = getHandle(operation);
        return handle.project.openSequence(handle.candidate);
      },
      async reconcile(operation) {
        const handle = handles.get(operation.id);
        if (!handle) return;
        const after = await sequences(handle.project);
        const added = [...after].filter(([id]) => !handle.beforeSequences.has(id));
        if (!operation.candidateSequenceId && added.length === 1) {
          handle.candidate = added[0][1]; operation.candidateSequenceId = added[0][0];
        }
        const owned = (await itemIds(await handle.project.getRootItem())).filter(item => item.name.startsWith(`PodCut ${operation.id} segment `));
        for (const item of owned) if (!operation.subclips.some(entry => (entry.id || entry) === item.getId()))
          operation.subclips.push({ id: item.getId(), recovered: true });
      },
      async restoreOriginal(operation) {
        const handle = handles.get(operation.id);
        if (!handle) return;
        const active = await handle.project.getActiveSequence();
        if (active && guid(active) === operation.candidateSequenceId) {
          if (!(await handle.project.openSequence(handle.original))) throw new Error("Premiere did not reopen the source sequence.");
        }
      }
    };
  }

  return { activeSequence, applyAdapter, claimExport, createExportWaiter, createSourceWatch, onActiveSourceChanged, readySourceWatch, sourceRevision, releaseExport, resolvePresetPath, sequenceAudio, setPlayerPosition, stopWaiting };
});
