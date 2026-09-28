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
    if (!prepared || prepared.cutCount !== 1 || prepared.plan.fps !== 30 || prepared.plan.segments.length !== 2)
      return 'Assisted drafts require exactly one enabled internal cut at 30 fps.';
    if (!/\.prproj$/i.test(prepared.current.source.projectPath || '')) return 'Save the project before preparing a draft.';
    return null;
  }
  function validateDraft(record, inspected) {
    if (record?.version !== 1 || !record.candidateSequenceId || !record.sourceSnapshot || record.cuts?.length !== 1)
      throw new Error('Interrupted or invalid draft record. Inspect the project; do not resume automatically.');
    const source = inspected.original, candidate = inspected.candidate;
    if (source.projectId !== record.projectId || source.projectPath !== record.projectPath ||
        source.sequenceId !== record.originalSequenceId || candidate.sequenceId !== record.candidateSequenceId ||
        candidate.projectId !== record.projectId || candidate.projectPath !== record.projectPath ||
        JSON.stringify(source) !== JSON.stringify(record.sourceSnapshot))
      throw new Error('Recorded project or original metadata changed. Draft validation is pending.');
    const plan = core.planSimpleEdit({ durationSeconds: source.durationSeconds,
      sourceInSeconds: source.videoItems[0].inPoint, fps: source.fps, cuts: record.cuts });
    if (plan.fps !== 30 || plan.segments.length !== 2 || JSON.stringify(plan) !== JSON.stringify(record.plan))
      throw new Error('Recorded plan differs from the proven assisted scope.');
    if (candidate.videoTransitions || candidate.audioTransitions || candidate.captionTracks !== 0 ||
        candidate.videoMuted || candidate.audioMuted || candidate.unsupportedEffects?.length ||
        Math.abs(candidate.durationSeconds - plan.outputFrames / plan.fps) > 1e-4)
      throw new Error('Candidate structure changed. Inspect it before validation.');
    for (const track of [candidate.videoItems, candidate.audioItems]) {
      if (track?.length !== 2) throw new Error('Candidate must contain exactly two retained pairs.');
      for (let i = 0; i < 2; i++) {
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
