(function (root, factory) {
  const core = typeof module === 'object' && module.exports ? require('./core.js') : root.PodCutCore;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PodCutAssistedState = api;
})(globalThis, function (core) {
  const workKey = 'podcut.pending-work.v1';
  const draftKey = 'podcut.assisted-draft.v1';
  function pending(storage) {
    const raw = storage.getItem(workKey);
    if (!raw) return null;
    try {
      const work = JSON.parse(raw);
      if (typeof work.id === 'string' && ['export', 'assisted'].includes(work.kind)) return work;
    } catch (_) {}
    return { kind: 'unknown', id: 'unreadable' }; // Fail closed, never treat corruption as an idle runtime.
  }
  function begin(storage, kind, detail) {
    if (pending(storage)) throw new Error('Interrupted work must be checked before starting another job.');
    const work = { ...detail, kind, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
    storage.setItem(workKey, JSON.stringify(work));
    if (pending(storage)?.id !== work.id) throw new Error('Could not record work safely. No host operation started.');
    return work;
  }
  function finish(storage, work) {
    if (pending(storage)?.id === work.id) storage.removeItem(workKey);
  }
  function scopeError(prepared) {
    const reason = core.assistedPlanError(prepared);
    if (reason) return reason;
    if (!/\.prproj$/i.test(prepared.current.source.projectPath || '')) return 'Save the project before preparing a draft.';
    return null;
  }
  function validateDraft(record, inspected) {
    if (record?.version !== 1 || !record.candidateSequenceId || !record.sourceSnapshot || !record.cuts?.length)
      throw new Error('Interrupted or invalid draft record. Inspect the project; do not resume automatically.');
    const source = inspected.original, candidate = inspected.candidate;
    const pathKey = core.projectPathKey;
    const snapshotKey = value => JSON.stringify({ ...value, projectPath: pathKey(value.projectPath) });
    if (source.projectId !== record.projectId || pathKey(source.projectPath) !== pathKey(record.projectPath) ||
        source.sequenceId !== record.originalSequenceId || candidate.sequenceId !== record.candidateSequenceId ||
        candidate.projectId !== record.projectId || pathKey(candidate.projectPath) !== pathKey(record.projectPath) ||
        snapshotKey(source) !== snapshotKey(record.sourceSnapshot))
      throw new Error('Recorded project or original metadata changed. Draft validation is pending.');
    const plan = core.planSimpleEdit({ durationSeconds: source.durationSeconds,
      sourceInSeconds: source.videoItems[0].inPoint, fps: source.fps, cuts: record.cuts });
    if (plan.fps !== 30 || plan.segments.length !== record.cuts.length + 1 || JSON.stringify(plan) !== JSON.stringify(record.plan))
      throw new Error('Recorded plan differs from the proven assisted scope.');
    if (candidate.videoTransitions || candidate.audioTransitions || candidate.captionTracks !== 0 ||
        candidate.videoMuted || candidate.audioMuted || candidate.unsupportedEffects?.length ||
        Math.abs(candidate.durationSeconds - plan.outputFrames / plan.fps) > 1e-4)
      throw new Error('Candidate structure changed. Inspect it before validation.');
    for (const track of [candidate.videoItems, candidate.audioItems]) {
      if (track?.length !== plan.segments.length) throw new Error('Candidate retained-pair count differs from plan.');
      for (let i = 0; i < track.length; i++) {
        const item = track[i], part = plan.segments[i];
        const expected = [part.outputStartFrame, part.outputEndFrame, part.sourceStartFrame, part.sourceEndFrame];
        if (item.trackIndex !== 0 || item.speed !== 1 || item.disabled || item.reversed || item.adjustmentLayer ||
            item.projectItemId !== source.videoItems[0].projectItemId ||
            ['start','end','inPoint','outPoint'].some((k,j) => !Number.isFinite(item[k]) || Math.abs(item[k] - expected[j] / plan.fps) > 1e-4))
          throw new Error('Candidate source ranges or V/A boundaries changed.');
      }
    }
    return plan; // Structural only: never a native-link, property, or playback verdict.
  }
  return { workKey, draftKey, pending, begin, finish, scopeError, validateDraft };
});
