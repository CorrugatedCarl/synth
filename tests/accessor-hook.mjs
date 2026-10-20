// The dynamic accessor recorder (IMPL-3 §4.3 R0, the accessor map's §0): preloaded into one test file's run,
//   node --max-old-space-size=2048 --import ./tests/accessor-hook.mjs --test tests/<file>.test.mjs
// it records every call of cv-model's track accessors — track.model / vals / preset / seq / fx: the 1e transition
// accessors until R7, the guard builds' throwing descriptors after it (cv-model adopt { guard }) — with its caller's
// file:line (the first stack frame outside cv-model.js), and prints them at exit (stderr), the site files first, then
// tests/. A call is told by cv-model through globalThis.__synthAccess(key, op) before the accessor runs (or throws).
//   ACCESS_STRICT=1   a recorded call from a site file (not tests/) fails the run (exit code 1): the N5 gate over a sim
//   ACCESS_OUT=<file> the sites also written as JSON { calls, sites: { 'main.js:123': { n, keys } } }
// Not a test file itself (no v8-guard import, nothing for node --test to collect).
import { writeFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).href;
const sites = new Map(); // 'file:line' → { n, keys: Set }
let calls = 0;
const where = stack => {
  for (const l of String(stack || '').split('\n').slice(1)) {
    const m = /(file:\/\/[^\s)]+?):(\d+):\d+\)?\s*$/.exec(l);
    if (!m) continue;
    const f = m[1].split('?')[0];
    if (/\/cv-model\.js$/.test(f) || /\/accessor-hook\.mjs$/.test(f)) continue;
    return (f.startsWith(ROOT) ? decodeURI(f.slice(ROOT.length)) : decodeURI(f)) + ':' + m[2];
  }
  return '?';
};
globalThis.__synthAccess = (key, op) => {
  calls++;
  const lim = Error.stackTraceLimit;
  Error.stackTraceLimit = 12;
  const at = where(new Error().stack);
  Error.stackTraceLimit = lim;
  let s = sites.get(at);
  if (!s) sites.set(at, s = { n: 0, keys: new Set() });
  s.n++; s.keys.add(key + (op === 'set' ? '=' : ''));
};
process.on('exit', () => {
  const L = [...sites].sort((a, b) => (a[0].startsWith('tests/') - b[0].startsWith('tests/')) || (a[0] < b[0] ? -1 : 1));
  const site = L.filter(([k]) => !k.startsWith('tests/'));
  const out = [`accessor-hook: ${calls} accessor call${calls === 1 ? '' : 's'} at ${L.length} site${L.length === 1 ? '' : 's'} (${site.length} outside tests/)`];
  for (const [k, s] of L) out.push(`  ${k}  ×${s.n}  ${[...s.keys].join(' ')}`);
  process.stderr.write(out.join('\n') + '\n');
  if (process.env.ACCESS_OUT) {
    const o = { calls, sites: {} };
    for (const [k, s] of L) o.sites[k] = { n: s.n, keys: [...s.keys] };
    try { writeFileSync(process.env.ACCESS_OUT, JSON.stringify(o, null, 1)); } catch (err) { process.stderr.write('accessor-hook: ' + err.message + '\n'); }
  }
  if (process.env.ACCESS_STRICT === '1' && site.length) process.exitCode = 1;
});
