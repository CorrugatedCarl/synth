// Source lint (owner I; SPEC-serum2 §0.4 import suffixes, §3.11.1 index spaces, §15.13 lint):
//  1. every relative import / export-from / import() in the site's ES modules carries the shared `?v=N` suffix
//     (N = main.js VERSION): a module imported with two specifiers would be instantiated twice, with separate caches.
//     Test files map the suffix through their loaders (serum-ui.hooks.mjs) and are not linted; the classic DSP scripts
//     import nothing;
//  2. no Phase-1 "idx ≥ NS ⇒ FX destination" test remains in the ES modules (false for the SYN2 rows 248–528: FX rows
//     are recognised with isFxId, voice slots with vi()).
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const read = (dir, f) => readFileSync(new URL(f, dir), 'utf8');
const MAIN = read(ROOT, 'main.js');
const N = (/const VERSION = '(\d+)'/.exec(MAIN) || [])[1];
const SITE = readdirSync(ROOT).filter(f => f.endsWith('.js'));
const isModule = src => /^\s*(import\s[^(]|import\s*\{|export\s)/m.test(src);
const MODULES = SITE.filter(f => isModule(read(ROOT, f)));
const CLASSIC = SITE.filter(f => !MODULES.includes(f));

// relative specifiers of a source: [specifier, dynamic suffix expression or '']
function specifiers(src) {
  const out = [];
  const stat = /\b(?:import|export)\s*(?:[\w*{}\s,$]*?\sfrom\s*)?(['"])(\.{1,2}\/[^'"]+)\1/g;
  const dyn = /\bimport\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*(\+\s*[A-Za-z_$][\w$]*)?\s*\)/g;
  let m;
  while ((m = stat.exec(src))) out.push([m[2], '']);
  while ((m = dyn.exec(src))) out.push([m[2], m[3] ? m[3].replace(/^\+\s*/, '') : '']);
  return out;
}

test('§0.4: the site version N is read from main.js and the classic DSP scripts import nothing', () => {
  assert.match(N || '', /^\d+$/, 'main.js VERSION');
  for (const f of ['engine.js', 'serum-dsp.js', 'fx-dsp.js', 'sx-base.js', 'sx-mod.js']) assert.ok(CLASSIC.includes(f), f + ' is a classic script');
  for (const f of CLASSIC) assert.deepEqual(specifiers(read(ROOT, f)), [], f + ' (classic script) has no imports');
  assert.ok(MODULES.includes('serum-core.js') && MODULES.includes('main.js') && MODULES.includes('models.js'));
});

for (const f of MODULES) {
  test(`§0.4: every relative import of ${f} carries ?v=${N}`, () => {
    const src = read(ROOT, f), bad = [];
    for (const [spec, expr] of specifiers(src)) {
      if (expr) { // './x.js?v=' + VERSION: the expression must be this file's VERSION constant, equal to N
        const k = new RegExp(`const ${expr} = '(\\d+)'`).exec(src);
        if (!spec.endsWith('?v=') || !k || k[1] !== N) bad.push(spec + ' + ' + expr);
      } else if (!spec.endsWith('?v=' + N)) bad.push(spec);
    }
    assert.deepEqual(bad, []);
  });
}

for (const f of MODULES) {
  const hits = read(ROOT, f).split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => />=\s*(?:\w+\.)?NS\b/.test(l) && !/^\s*(\/\/|\*)/.test(l));
  test(`§3.11.1: no "idx >= NS ⇒ FX" test in ${f}`, () => {
    assert.deepEqual(hits.map(([n, l]) => n + ': ' + l.trim()), []);
  });
}

// every test file imports tests/v8-guard.mjs first (the node 24 / V8 crash guard of the parallel suite)
test('tests: every test file imports ./v8-guard.mjs as its first import', () => {
  const T = new URL('./', import.meta.url);
  const bad = readdirSync(T).filter(f => f.endsWith('.test.mjs')).filter(f => {
    const m = /^import\s[^\n]*$/m.exec(read(T, f));
    return !m || m[0] !== "import './v8-guard.mjs';";
  });
  assert.deepEqual(bad, []);
});
