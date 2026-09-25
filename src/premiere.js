(function (root) {
  "use strict";

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
      name: sequence.name,
      durationSeconds: end.seconds,
      videoTracks,
      audioTracks,
      videoClips,
      audioClips
    };
  }

  function waitForExport(ppro, startExport) {
    return new Promise((resolve, reject) => {
      const eventName = ppro.Constants.OperationCompleteEvent.EXPORT_MEDIA_COMPLETE;
      const timeout = setTimeout(() => finish(new Error("Premiere audio export timed out.")), 10 * 60 * 1000);
      const onComplete = (event) => {
        const success = !event || event.state === undefined || event.state === ppro.Constants.OperationCompleteState.SUCCESS;
        finish(success ? null : new Error("Premiere could not export the sequence audio."));
      };
      function finish(error) {
        clearTimeout(timeout);
        ppro.EventManager.removeGlobalEventListener(eventName, onComplete);
        if (error) reject(error); else resolve();
      }
      ppro.EventManager.addGlobalEventListener(eventName, onComplete);
      Promise.resolve().then(startExport).then((started) => {
        if (!started) finish(new Error("Premiere did not start the sequence audio export."));
      }, finish);
    });
  }

  async function sequenceAudio(sequence) {
    const ppro = getApi();
    if (!ppro) throw new Error("Premiere is unavailable.");
    const uxp = require("uxp");
    const fs = require("fs");
    const temp = await uxp.storage.localFileSystem.getTemporaryFolder();
    const name = `podcut-${Date.now()}.wav`;
    const separator = temp.nativePath.includes("\\") ? "\\" : "/";
    const outputPath = `${temp.nativePath}${separator}${name}`;
    const appPath = uxp.host && uxp.host.applicationPath;
    if (!appPath) throw new Error("Premiere 26.5 or later is required for sequence audio analysis.");
    const appFolder = appPath.replace(/[\\/][^\\/]+$/, "");
    // ponytail: use Premiere's bundled WAV preset; add a preset picker if other hosts move it.
    const presetPath = `${appFolder}${separator}MediaIO${separator}systempresets${separator}3F3F3F3F_57415645${separator}Waveform Audio 48kHz 16-bit.epr`;
    const encoder = ppro.EncoderManager.getManager();
    try {
      await waitForExport(ppro, () => encoder.exportSequence(
        sequence,
        ppro.Constants.ExportType.IMMEDIATELY,
        outputPath,
        presetPath,
        true
      ));
      return await fs.readFile(`plugin-temp:/${name}`);
    } finally {
      try { await fs.unlink(`plugin-temp:/${name}`); } catch (error) { /* temporary output may not exist */ }
    }
  }

  root.PodCutPremiere = { activeSequence, sequenceAudio };
})(typeof globalThis === "undefined" ? this : globalThis);
