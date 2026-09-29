// Non-shipping regression loader. Production exports never expose an unlock option.
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createRequire } = require('node:module');
const { runInThisContext } = require('node:vm');
const cache = new Map();
module.exports = function load(file) {
  const path = resolve(__dirname, file);
  if (cache.has(path)) return cache.get(path).exports;
  const mod = { exports: {} }, localRequire = createRequire(path);
  cache.set(path, mod);
  const script = readFileSync(path, 'utf8').replace('const MUTATION_ENABLED = false;', 'const MUTATION_ENABLED = true;');
  runInThisContext(`(function(require,module,exports){${script}\n})`, { filename: path })(
    name => name === '../src/assisted.js' ? load(name) : localRequire(name), mod, mod.exports);
  return mod.exports;
};
