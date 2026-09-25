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
    if (!ppro) return { state: "host-unavailable", message: "Open PodCut inside Premiere Pro 25.6 or later." };
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

  root.PodCutPremiere = { activeSequence };
})(typeof globalThis === "undefined" ? this : globalThis);
