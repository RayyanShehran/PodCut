// Development-only console proof. Build copies src/, never scripts/.
// Not a public editing adapter: exactly one internal cut, disposable project only.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.PodCutAssistedProof = factory;
})(globalThis, function (base, api, service, projectSuffix) {
  let current;
  const fresh = op => {
    if (!Number.isInteger(op.sourceRevision) || base.sourceRevision() !== op.sourceRevision)
      throw new Error('Source changed during assisted preparation. Analyze again.');
  };
  const checkPlan = op => {
    if (op.plan.fps !== 30 || op.plan.segments.length !== 2)
      throw new Error('Disposable proof requires one internal cut at 30 fps.');
  };
  const candidate = async op => {
    const project = current.handles.project;
    if (!project.path.endsWith(projectSuffix)) throw new Error('Wrong disposable project.');
    const listed = (await project.getSequences()).find(s => s.guid.toString() === op.candidateSequenceId);
    if (!listed) throw new Error('Assisted candidate missing.');
    return { project, sequence: await project.getSequence(listed.guid) };
  };
  const pairs = async sequence => [
    (await sequence.getVideoTrack(0)).getTrackItems(1, false),
    (await sequence.getAudioTrack(0)).getTrackItems(1, false)
  ];
  const tick = seconds => api.TickTime.createWithSeconds(seconds);
  const transaction = (project, op, make, label) => {
    let accepted;
    project.lockedAccess(() => {
      fresh(op);
      const actions = make();
      accepted = project.executeTransaction(c => {
        for (const action of actions) if (c.addAction(action) === false) throw new Error('Action rejected.');
      }, `PodCut assisted ${op.id}: ${label}`);
    });
    if (!accepted) throw new Error(`Assisted ${label} failed; draft requires isolation.`);
  };
  const adapter = {
    ...base,
    async inspect(trace) { current = await base.inspect(trace); return current; },
    async createCandidate(op) {
      checkPlan(op);
      if (!current.source.projectPath.endsWith(projectSuffix)) throw new Error('Wrong disposable project.');
      return base.createCandidate.call(adapter, op);
    },
    // The existing service expects a segment token. No media subclip is created.
    async createSubclip(op, segment) { fresh(op); return { id: 'dev-track-clone', ...segment }; },
    async editCandidate(op) {
      const { project, sequence } = await candidate(op);
      const editor = api.SequenceEditor.getEditor(sequence);
      let items = await pairs(sequence);
      if (items.some(track => track.length !== 1)) throw new Error('Draft changed before editing.');
      const [head, tail] = op.plan.segments;
      transaction(project, op, () => items.map(track => editor.createCloneTrackItemAction(
        track[0], tick(op.sourceSnapshot.durationSeconds), 0, 0, true, false)), 'clone tails');
      items = await pairs(sequence);
      if (items.some(track => track.length !== 2)) throw new Error('Expected exactly two retained pairs.');
      transaction(project, op, () => items.map(track => track[1].createSetInPointAction(
        tick(tail.sourceStartFrame / op.plan.fps))), 'trim tails');
      transaction(project, op, () => items.map(track => track[0].createSetOutPointAction(
        tick(head.sourceEndFrame / op.plan.fps))), 'trim heads');
      const starts = await Promise.all(items.map(track => track[1].getStartTime()));
      transaction(project, op, () => items.map((track, i) => track[1].createMoveAction(
        tick(tail.outputStartFrame / op.plan.fps - starts[i].seconds))), 'move tails');
      return true;
    },
    async verifyCandidate(op) {
      fresh(op);
      const original = await base.inspect();
      if (JSON.stringify(original.source) !== JSON.stringify(op.sourceSnapshot)) throw new Error('Original changed.');
      const { sequence } = await candidate(op);
      if (Math.abs((await sequence.getEndTime()).seconds - op.plan.outputFrames / op.plan.fps) > 1e-4)
        throw new Error('Draft duration differs from plan.');
      const items = await pairs(sequence);
      for (const track of items) {
        if (track.length !== 2) throw new Error('Draft item count differs.');
        for (let i = 0; i < 2; i++) {
          const item = track[i], segment = op.plan.segments[i];
          const actual = await Promise.all([item.getStartTime(), item.getEndTime(), item.getInPoint(), item.getOutPoint()]);
          const expected = [segment.outputStartFrame, segment.outputEndFrame, segment.sourceStartFrame, segment.sourceEndFrame];
          if (actual.some((t, j) => Math.abs(t.seconds - expected[j] / op.plan.fps) > 1e-4) ||
              (await item.getProjectItem()).getId() !== op.sourceSnapshot.videoItems[0].projectItemId)
            throw new Error('Draft V/A source ranges differ from plan.');
        }
      }
      return true; // Structural verification only; does NOT verify native links or sound.
    },
    nameCandidate(op, name) {
      return base.nameCandidate(op, name.startsWith('PodCut FAILED') ? name : 'PodCut ASSISTED DRAFT — linking required');
    }
  };
  return {
    adapter,
    async prepare(review, onStage) {
      const result = await service.apply(adapter, review, onStage);
      if (result.status === 'completed') result.status = 'awaiting-manual-linking';
      return result;
    }
  };
});
