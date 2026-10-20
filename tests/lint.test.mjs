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
// the root scripts and the hardware panel layouts (panels/*.js: plain data modules, imported by panels/index.js)
const SITE = readdirSync(ROOT).filter(f => f.endsWith('.js')).concat(readdirSync(new URL('panels/', ROOT)).filter(f => f.endsWith('.js')).map(f => 'panels/' + f));
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

// the hardware panel layouts are data: panels/<model>.js import nothing (panels/index.js imports them, cv-panel.js the index)
test('panels/<model>.js import nothing (data only)', () => {
  const bad = SITE.filter(f => f.startsWith('panels/') && f !== 'panels/index.js' && specifiers(read(ROOT, f)).length);
  assert.deepEqual(bad, []);
});

for (const f of MODULES) {
  const hits = read(ROOT, f).split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => />=\s*(?:\w+\.)?NS\b/.test(l) && !/^\s*(\/\/|\*)/.test(l));
  test(`§3.11.1: no "idx >= NS ⇒ FX" test in ${f}`, () => {
    assert.deepEqual(hits.map(([n, l]) => n + ': ' + l.trim()), []);
  });
}

// §0.4 for the tests and the installed app: the tests import the site's modules with the same ?v=N as the modules under
// test (else a second instance of wk.js, serum-core.js … with its own state), and index.html and the service worker
// (sw.js: its precache and cache name) carry that N too — one bump of main.js VERSION reaches everything
test('§0.4: the tests\' versioned imports, index.html and sw.js carry ?v=' + N, () => {
  const bad = [];
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
      if (e.isDirectory()) { if (e.name !== 'ref-p1') walk(u); continue; }
      if (!/\.(mjs|js)$/.test(e.name)) continue;
      for (const [spec] of specifiers(readFileSync(u, 'utf8')).filter(([sp]) => /\?v=\d/.test(sp))) {
        if (!spec.endsWith('?v=' + N)) bad.push(u.pathname.split('/tests/')[1] + ': ' + spec);
      }
    }
  };
  walk(new URL('./', import.meta.url));
  assert.deepEqual(bad, []);
  const html = read(ROOT, 'index.html'), sw = read(ROOT, 'sw.js');
  assert.deepEqual([...new Set([...html.matchAll(/\?v=(\d+)/g)].map(m => m[1]))], [N], 'index.html');
  assert.equal((/const VERSION = '(\d+)'/.exec(sw) || [])[1], N, 'sw.js VERSION');
  assert.equal((/const VERSION = '(\d+)'/.exec(read(ROOT, 'assets.js')) || [])[1], N, 'assets.js VERSION');
});

// The accessor ratchet (milestone 3, IMPL-3 §4.3 R0; N5): per root file, the code lines that read a track's v1 fields
// (`t.model`, `tr.vals`, `x.fx` … with the names the 1e code gave tracks and track views), `trk().preset` / `curView().seq`,
// `fxOf(` and `isSx(` — comment lines and trailing ` // …` comments left out. Each file's count is held in
// tests/fixtures/accessor-allow.json: above it fails (a new site: read the device — instOf(t, dev), a device view —
// instead), below it asks to lower the file's count (shrink-only). A file's `sites` (when listed) name each kept line by a
// fragment of it (`has`) with the reason it stays (`why`: a v1 branch, a device record, a device view …); the dynamic
// proof is tests/accessor-hook.mjs over the sims.
const ACC_RE = [/\b(?:t|tr|x|T|v|V)\.(?:model|vals|preset|seq|fx)\b/, /\b(?:trk|curView)\(\)\.(?:model|vals|preset|seq|fx)\b/, /\bfxOf\(/, /\bisSx\(/];
const codeOf = l => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l.replace(/\s\/\/\s.*$/, ''));
const accLines = src => src.split('\n').map(codeOf).filter(l => ACC_RE.some(r => r.test(l))).map(l => l.trim());
test('N5: the accessor ratchet — each root file at its allowlisted count of v1 track-field sites (tests/fixtures/accessor-allow.json)', () => {
  const allow = JSON.parse(readFileSync(new URL('./fixtures/accessor-allow.json', import.meta.url), 'utf8')).files, bad = [];
  for (const f of SITE) {
    const L = accLines(read(ROOT, f)), A = allow[f] || { n: 0 };
    if (L.length > A.n) bad.push(`${f}: ${L.length} sites, allowed ${A.n} — a new one reads a track's v1 field (use the device: instOf(t, dev) / a device view): ${L.slice(0, 3).join(' | ')}`);
    else if (L.length < A.n) bad.push(`${f}: ${L.length} sites, allowed ${A.n} — lower its count in accessor-allow.json to ${L.length}`);
    if (Array.isArray(A.sites)) {
      if (A.sites.length !== A.n) bad.push(`${f}: ${A.sites.length} listed sites for a count of ${A.n}`);
      for (const s of A.sites) if (!s || !s.why || !L.some(l => l.includes(s.has))) bad.push(`${f}: the kept site “${s && s.has}” ${s && s.why ? 'is gone (remove it)' : 'has no reason'}`);
    } else if (!A.why && A.n) bad.push(`${f}: no reason for its ${A.n} sites`);
  }
  for (const f of Object.keys(allow)) if (!SITE.includes(f)) bad.push(`${f}: listed, not a root file`);
  assert.deepEqual(bad, []);
});

// every test file imports tests/v8-guard.mjs first (the node 24 / V8 crash guard of the parallel suite)
test('tests: every test file imports ./v8-guard.mjs as its first import', () => {
  const T = new URL('./', import.meta.url);
  const bad = readdirSync(T).filter(f => f.endsWith('.test.mjs')).filter(f => {
    const m = /^import\s[^\n]*$/m.exec(read(T, f));
    return !m || m[0] !== "import './v8-guard.mjs';";
  });
  assert.deepEqual(bad, []);
});
