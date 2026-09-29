// Experimental assisted editing only: internal cuts in one source pair at 30 fps. Never automatic Apply.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.PodCutAssisted = factory;
})(globalThis, function (base, api, service, scope) {
  const core = typeof module === 'object' && module.exports ? require('./core.js') : globalThis.PodCutCore;
  const MUTATION_ENABLED = true; // Experimental assisted path only; automatic Apply stays locked.
  let current;
  const projectMatches = path => typeof scope === 'string' ? path.endsWith(scope) :
    scope?.experimental === true && typeof path === 'string' && /\.prproj$/i.test(path);
  const fresh = op => {
    if (!Number.isInteger(op.sourceRevision) || base.sourceRevision() !== op.sourceRevision)
      throw new Error('Source changed during assisted preparation. Analyze again.');
  };
  const checkPlan = op => {
    const reason = core.assistedPlanError(op);
    if (reason) throw new Error(reason);
  };
  const candidate = async op => {
    const project = current.handles.project;
    if (!projectMatches(project.path)) throw new Error('Wrong or unsaved assisted project.');
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
      if (!MUTATION_ENABLED) throw new Error('Assisted draft creation is temporarily unavailable pending validation.');
      checkPlan(op);
      if (!projectMatches(current.source.projectPath)) throw new Error('Wrong or unsaved assisted project.');
      return base.createCandidate.call(adapter, op);
    },
    // The existing service expects a segment token. No media subclip is created.
    async createSubclip(op, segment) { fresh(op); return { id: 'retained-track-clone', ...segment }; },
    async editCandidate(op) {
      const { project, sequence } = await candidate(op);
      const editor = api.SequenceEditor.getEditor(sequence);
      let items = await pairs(sequence);
      if (items.some(track => track.length !== 1)) throw new Error('Draft changed before editing.');
      const segments = op.plan.segments, originals = items.map(track => track[0]);
      // Clone every tail from the untouched property-bearing head, before any trimming.
      for (let i = 1; i < segments.length; i++) {
        transaction(project, op, () => originals.map(item => editor.createCloneTrackItemAction(
          item, tick(op.sourceSnapshot.durationSeconds * i), 0, 0, true, false)), `clone pair ${i + 1}`);
        items = await pairs(sequence);
        if (items.some(track => track.length !== i + 1)) throw new Error('Retained clone count differs from plan.');
      }
      items = await pairs(sequence);
      for (let i = 1; i < segments.length; i++) {
        transaction(project, op, () => items.map(track => track[i].createSetInPointAction(
          tick(segments[i].sourceStartFrame / op.plan.fps))), `trim pair ${i + 1} in`);
        transaction(project, op, () => items.map(track => track[i].createSetOutPointAction(
          tick(segments[i].sourceEndFrame / op.plan.fps))), `trim pair ${i + 1} out`);
      }
      transaction(project, op, () => items.map(track => track[0].createSetOutPointAction(
        tick(segments[0].sourceEndFrame / op.plan.fps))), 'trim head');
      for (let i = 1; i < segments.length; i++) {
        const starts = await Promise.all(items.map(track => track[i].getStartTime()));
        transaction(project, op, () => items.map((track, j) => track[i].createMoveAction(
          tick(segments[i].outputStartFrame / op.plan.fps - starts[j].seconds))), `move pair ${i + 1}`);
      }
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
        if (track.length !== op.plan.segments.length) throw new Error('Draft item count differs.');
        for (let i = 0; i < track.length; i++) {
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
      const label = name.startsWith('PodCut FAILED') ? name : 'PodCut ASSISTED DRAFT — linking required';
      if (!name.startsWith('PodCut FAILED')) op.outputName = label;
      return base.nameCandidate(op, label);
    }
  };
  return {
    adapter,
    async prepare(review, onStage) {
      if (!MUTATION_ENABLED) throw new Error('Assisted draft creation is temporarily unavailable pending validation.');
      if (!review.experimentalConfirmed || (typeof scope !== 'string' && !scope?.experimental))
        throw new Error('Explicit experimental assisted-draft confirmation is required.');
      const stageName = stage => stage === 'completed' ? 'awaiting manual linking' :
        stage === 'creating retained subclip' ? 'preparing retained track clone' : stage;
      const result = await service.prepareAssisted(adapter, review, onStage && ((stage, op) => onStage(stageName(stage), op)));
      result.stages = result.stages.map(stageName);
      if (result.status === 'completed') result.status = 'awaiting-manual-linking';
      return result;
    }
  };
});
