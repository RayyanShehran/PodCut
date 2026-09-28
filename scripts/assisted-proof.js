// Development-only restriction around the same assisted adapter used by the panel.
(function (root) {
  const make = typeof module === 'object' && module.exports ? require('../src/assisted.js') : root.PodCutAssisted;
  const proof = (base, api, service, projectSuffix) => {
    if (typeof projectSuffix !== 'string' || !projectSuffix.endsWith('.prproj'))
      throw new Error('A disposable project suffix is required.');
    return make(base, api, service, projectSuffix);
  };
  if (typeof module === 'object' && module.exports) module.exports = proof;
  else root.PodCutAssistedProof = proof;
})(globalThis);
