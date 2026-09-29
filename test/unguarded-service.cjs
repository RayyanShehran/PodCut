// Non-shipping regression loader. Production exports never expose an unlock option.
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createRequire } = require('node:module');
const { runInThisContext } = require('node:vm');
const cache = new Map();
module.exports = function load(file, multipleCuts = false) {
  const path = resolve(__dirname, file);
  const key = path + (multipleCuts ? ':multiple' : '');
  if (cache.has(key)) return cache.get(key).exports;
  const mod = { exports: {} }, localRequire = createRequire(path);
  cache.set(key, mod);
  const script = readFileSync(path, 'utf8').replace('const MUTATION_ENABLED = false;', 'const MUTATION_ENABLED = true;')
    .replace('const MAX_ASSISTED_CUTS = 1;', multipleCuts ? 'const MAX_ASSISTED_CUTS = 2;' : 'const MAX_ASSISTED_CUTS = 1;');
  runInThisContext(`(function(require,module,exports){${script}\n})`, { filename: path })(
    name => name === '../src/assisted.js' ? load(name, multipleCuts) :
      multipleCuts && name === './core.js' ? load('../src/core.js', true) : localRequire(name), mod, mod.exports);
  return mod.exports;
};
