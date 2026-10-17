import './v8-guard.mjs';
// tests/bench.html's page logic (§14.1 iPad record), the parts node can drive: its build check and its record. The page's
// own module text is cut out at fixed anchors and run with stand-ins (no DSP): a stale build gets an Apply-update button
// that skips the waiting worker (Safari's worker is not the Home Screen app's); record() marks a stale run and keeps a
// cold value only from the first whole pass since the page loaded. Strings and numbers only into assert.
// Run alone: node --max-old-space-size=2048 --test tests/bench-page.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./bench.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); assert.ok(i >= 0 && j > i, 'anchor ' + a); return html.slice(i, j); };
const buildSrc = cut('  const build = { files: null', '  /* ---- results */');
const recSrc = cut('  const med = a =>', '  // one key per line');
const runSrc = cut('  let stop = false, hiddenSeen = false', "  $('run5').onclick");

// the page's run() and record() with a fake measure(): a switch row reads 1.0 on its first call since load (JIT-cold),
// 0.3 after; o.hide: the page goes to the background during the first pass
function page(o = {}) {
  const body = `
    const list = [{ id: 'd', kind: 'voice' }, { id: 'q1', kind: 'switch' }, { id: 'q2', kind: 'switch' }];
    const els = {}; const $ = id => els[id] || (els[id] = { style: {}, disabled: false, hidden: false, textContent: '', value: '' });
    const cells = new Map(list.map(s => [s.id, { l: $('l' + s.id) }]));
    const missing = [], status = () => {}, tryLS = (fn, d) => d, build = { files: 'abc', deployed: 'def', note: O.stale ? 'stale' : '' };
    const env = {}, paint = () => {}, recs = []; const show = r => { last = r; recs.push(r); }; // (last: the page's own, in recSrc)
    const calls = {};
    const measure = s => { calls[s.id] = (calls[s.id] || 0) + 1;
      if (O.hide && s.id === 'd' && calls.d === 1) hiddenSeen = true;
      return { load: s.kind === 'switch' ? (calls[s.id] === 1 ? 1.0 : 0.3) : 0.2, worst: 0.1 }; };
    ${recSrc}
    ${runSrc}
    return { run, recs };`;
  const g = { document: { addEventListener() {} }, navigator: { userAgent: 'node' }, screen: { width: 1, height: 1 }, devicePixelRatio: 1,
    location: { origin: 'x', pathname: '/tests/bench.html' }, setTimeout: f => f(), performance };
  return new Function(...Object.keys(g), 'O', body)(...Object.values(g), o);
}

test('bench.html record: cold only from the page\'s first pass, and only when it ran whole; a later Run in the same load or an interrupted first pass: cold null', async () => {
  const A = page();
  await A.run(1);
  assert.deepEqual(A.recs.at(-1).cold, { q1: 1, q2: 1 }, 'the first pass since load: cold');
  await A.run(5);
  const r = A.recs.at(-1);
  assert.deepEqual([r.passes, r.cold], [5, null], 'a second Run in the same load is warm: no cold value');
  const B = page({ hide: true });
  await B.run(5);
  const rb = B.recs.at(-1);
  assert.deepEqual([rb.passes, rb.interrupted, rb.cold], [4, 1, null], 'pass 1 interrupted: pass 2 (warm) is never promoted to cold');
  assert.match(rb.method, /first pass since the page loaded/);
  assert.equal(rb.stale, false);
  const C = page({ stale: true });
  await C.run(1);
  assert.equal(C.recs.at(-1).stale, true, 'a run on an older build than the deployed one says so in the record');
});

test('bench.html build check: a stale build (two shells, a waiting worker) gets "Apply update", which skips the waiting worker and reloads on the takeover', async () => {
  const posted = [], listeners = [], reloads = [];
  const el = { className: '', textContent: '', kids: [], append(...n) { this.kids.push(...n); } };
  const btn = { type: '', textContent: '', disabled: false, style: {}, onclick: null };
  const reg = { waiting: { postMessage: m => posted.push(m) }, installing: null, update: async () => {} };
  const g = {
    $: id => (id === 'build' ? el : null),
    fetch: async () => ({ text: async () => "const BUILD = 'cf1b7a2474da';" }),
    caches: { keys: async () => ['synth-shell-v9-0123456789ab', 'synth-shell-v9-cf1b7a2474da', 'synth-data'] },
    navigator: { serviceWorker: { controller: {}, getRegistration: async () => reg, addEventListener: (t, f, o) => listeners.push([t, !!(o && o.once)]) } },
    location: { hostname: 'canvas.domlavin.com', reload: () => reloads.push(1) },
    document: { createElement: () => btn },
    setTimeout: () => 0,
  };
  const run = new Function(...Object.keys(g), buildSrc + '\nreturn build;');
  const build = run(...Object.values(g));
  for (let i = 0; i < 20 && !el.kids.length; i++) await new Promise(r => setImmediate(r));
  assert.equal(build.note, 'an update of the app is installed but not applied');
  assert.equal(el.className, 'warn');
  assert.match(el.textContent, /Home Screen app updates separately/);
  assert.match(el.textContent, /close every canvas\.domlavin\.com tab in Safari/);
  assert.doesNotMatch(el.textContent, /open SYNTH Canvas, tap Reload/, 'never the remedy that cannot work on the iPad');
  assert.equal(el.kids.includes(btn), true, 'the button is shown');
  assert.equal(btn.textContent, 'Apply update');
  btn.onclick();
  assert.deepEqual(posted, [{ t: 'skip' }], 'the waiting worker is told to skip waiting (sw.js { t: "skip" })');
  assert.deepEqual(listeners, [['controllerchange', true]], 'the page reloads when the new worker takes over');
  assert.equal(btn.disabled, true);
});
