// tests/ui-bench-m3.mjs — S0, milestone 3's rendering spike (docs/canvas/IMPL-3.md §1.4–1.5; the rendering map RM §6), opened
// as tests/ui-bench.html?m3=1. A test page only: the app runs unchanged in an iframe (same origin, the test hooks on) and every
// scene is built by script inside it. Nothing the bench does is stored: the app's store writes are switched off for the run
// (the user's project, prefs and cameras stay as they were; the iframe's state is thrown away).
//   Scenes (§1.5): hw5 (the 1h five hardware panels; first and last: validity, thermal drift), sx1 (the app's own bundled Serum,
//   OSC page, 10 canvas mod cables), p1 (Serum (complete) in parts: VOICE = a header proxy + VOICING + ENV 1, OSC A, FILTER 1,
//   the own FX), p1x (a fully opened Serum in parts — VOICE, 3 OSC, SUB, NOISE, 2 FILTER, ENV 2, 2 LFO, MACROS, ARP, the own FX
//   with 4 effects — + 6 Serum-faithful modulators: LFO ×2, ENV ×2, MACROS, a chaos row), hwm (hw5 + the 6 modulators in the
//   left column), t2 (two p1x Serums on one track), t3 (p1 + OB-Xa, Jupiter-8, CS-80 on GL faces, 4 effects).
//   Panels: the real serum-ui / sx-ui-osc / sx-ui-seq classes, each in a .cv-mod shell made by cv-module's createModule (the
//   real bar, jacks, world item), over one hand-made host per Serum (a SerumUI over the app's own sxHost, its bundled shell
//   built into a detached box and dropped) or per modulator (a slot host: a SerumUI over a synthetic Serum state). Each view
//   registers into its own page record (ui.bp while it builds); the host paints a composite page of the views on screen (H4).
//   ENV / LFO panels get a fixed slot (an object derived from the SerumUI: its s() or edSel overridden). H1 / H3 are emulated
//   (prune=1, default): an OSC's inactive type views and an LFO's PATH / VELO / NOTE areas are taken out after the build.
//   Traffic (§1.5): the transport loops 2 bars of a chord (through the ARP on Serum tracks); the parts' hosts get the Serum's real
//   snapshot (an app monitor subscription, live while one of their views is shown); real 2b modulators (LFO ×2, ENV, chaos,
//   Macro; a second ENV under the Serum-faithful ones; the Mod Wheel on Serum tracks) cabled with track.mods rows keep ModCore
//   running — visible where they are the scene's modulators,
//   hidden (traffic only) where the Serum-faithful ones replace them, whose slot hosts take the real mc values and lane E's
//   mcx phases / stages (§2.9). Cables: the real cv-cables layer from hand-made edges (internal ≈ 12 per Serum: a fork, a
//   stub; 8–10 mod cables to knobs). The app's own modules a scene does not show are moved far off and hidden.
//   H5 shim (h5=1, default): wk.fitCanvas and sx-ui-seq storeDpr are loaded as patched copies (an import map in the iframe:
//   blob modules, their imports made absolute) and SerumUI.prototype.paintCanvas is replaced: an in-world canvas stores dpr·k
//   px per layout px at rest (the cap of 2 lifted, 16e6 px per canvas kept), Σ ≤ 64 MiB (off-screen first back to dpr, then
//   the on-screen ones farthest from the centre); today's rule when off (?h5=0, or M4's "today" pass).
//   Runs: M0 scripted (idle / pan / zoom / settle / deep / deepSettle, + firstMove / settle / burstMax), M2 policy matrix on
//   p1x / hwm / t2 (base contain layers skip noWC permWC still opacity0 none), M4 density audit (k 0.25 … 2, today and H5), M5
//   memory + a 60 s k-sweep (localStorage heartbeat: a tab the OS killed is reported at the next load), P1 / P2 probes (buttons
//   too), the self-check per scene (live canvases repaint at ≥ 0.8 × the snapshot rate idle, §1.4 counts, no console error).
//   &hand=1: M1, the 45 s hand protocol on screen per scene (its steps tick themselves off; Skip step); &hold=1: M3, the
//   rest test (everything live frozen, the burst held open, screenshots A / B / C, markers to locate the page in them);
//   &diff=1: the M3 diff on the Mac (three screenshots per hold + the results JSON). One JSON for everything (Copy results).
//   &auto=1 (the CDP harness): no taps; window.__m3 holds the state and the result.
const BASE = new URL('../', location.href).href;
const Q = new URLSearchParams(location.search);
const MODE = Q.get('hand') === '1' ? 'hand' : Q.get('hold') === '1' ? 'hold' : Q.get('diff') === '1' ? 'diff' : 'auto';
const AUTO = Q.get('auto') === '1', H5ON = Q.get('h5') !== '0', PRUNE = Q.get('prune') !== '0';
const ONLY = Q.get('scenes') ? Q.get('scenes').split(',') : null;
const NO_M2 = Q.get('m2') === '0';
const MiB = 1024 * 1024, CANVAS_BUDGET = 64 * MiB, CANVAS_MAX_PX = 16e6;
// §1.4 budgets (painted elements, canvases)
const BUDGET = { complete: { el: 1600, cv: 12 }, full: { el: 5000, cv: 40 }, mod: { el: 160, cv: 2 } };
const AUTO_ORDER = ['hw5', 'sx1', 'p1', 'p1x', 'hwm', 't2', 't3', 'hw5'], HAND_ORDER = ['hw5', 'sx1', 'p1x', 'hwm', 't2', 't3', 'hw5'];
const M2_SCENES = ['p1x', 'hwm', 't2'];
const POLICIES = {
  base: '',
  contain: '#world .cv-mod > .cv-body { contain: content; }', // (= style.css's own .cv-body rule today: an A/A control)
  layers: '#viewport[data-cv-busy] #world .cv-mod { will-change: transform; }',
  skip: '#world .cv-mod > .cv-body { content-visibility: auto; contain-intrinsic-size: auto 1200px 400px; }',
  noWC: '#viewport[data-cv-busy] > #world { will-change: auto !important; }',
  permWC: '#viewport > #world { will-change: transform !important; }',
  still: '', // (H7: live repaints dropped while the camera moves — the monitors' deliveries, in script)
  opacity0: '#world .cv-mod:not([data-cv-face="gl"]) > .cv-body { opacity: 0 !important; }',
  none: '#world .cv-mod:not([data-cv-face="gl"]) > .cv-body { display: none !important; }',
};
const SCENES = {
  hw5: { title: 'Five hardware panels', kind: 'hw', models: ['obxa', 'jupiter8', 'ms20', 'cs80', 'prophet5'] },
  sx1: { title: 'One Serum, whole panel', kind: 'sx' },
  p1: { title: 'Serum (complete) as parts', kind: 'parts', parts: 'complete' },
  p1x: { title: 'A fully opened Serum as parts + 6 Serum modulators', kind: 'parts', parts: 'full', slots: true },
  hwm: { title: 'Five hardware panels + 6 Serum modulators', kind: 'hw', models: ['obxa', 'jupiter8', 'ms20', 'cs80', 'prophet5'], slots: true },
  t2: { title: 'Two fully opened Serums as parts', kind: 'parts', parts: 'full', serums: 2 },
  t3: { title: 'Serum parts + OB-Xa, Jupiter-8, CS-80', kind: 'parts', parts: 'complete', hw: ['obxa', 'jupiter8', 'cs80'], fx4: true },
};
// part widths: the panel's column in the 1200 px bundled Serum (§2.2) and the module's, rounded up to the 32 px grid
const PART = {
  voice: { w: 544, title: 'VOICE' }, oscA: { w: 257, title: 'OSC A', o: 0 }, oscB: { w: 257, title: 'OSC B', o: 1 }, oscC: { w: 257, title: 'OSC C', o: 2 },
  sub: { w: 240, title: 'SUB' }, noise: { w: 240, title: 'NOISE' }, filter1: { w: 300, title: 'FILTER 1', k: 0 }, filter2: { w: 300, title: 'FILTER 2', k: 1 },
  env2: { w: 314, title: 'ENV 2', env: 1 }, lfo1: { w: 393, title: 'LFO 1', lfo: 0 }, lfo2: { w: 393, title: 'LFO 2', lfo: 1 }, macros: { w: 236, title: 'MACROS' },
  arp: { w: 1100, title: 'ARP' },
};
const SLOTS = [ // the Serum-faithful modulators: [key, kind, the real 2b module that feeds it, title]
  ['lfoA', 'lfo', 'l1', 'LFO 1'], ['lfoB', 'lfo', 'l2', 'LFO 2'], ['envA', 'env', 'e1', 'ENV 1'], ['envB', 'env', 'e2', 'ENV 2'], ['mac', 'macro', 'm1', 'Macros 1'], ['chaos', 'chaos', 'h1', 'Chaos 1'],
];
const SLOT_W = { lfo: 393, env: 314, macro: 236, chaos: 300 };
const MOD_GAP = 80, VGAP = 64, HGAP = 96, BAR_H = 40;
const gup = v => Math.ceil(v / 32) * 32;

/* ------------------------------------------------------------------------------------------------ small helpers */
const $ = (s, r = document) => r.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r1 = x => Math.round(x * 10) / 10, r2 = x => Math.round(x * 100) / 100, r3 = x => Math.round(x * 1000) / 1000;
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* no storage */ } },
};
function q(a) { // frame intervals → { n, med, p95, max, over33, over50 }
  if (!a.length) return { n: 0, med: 0, p95: 0, max: 0, over33: 0, over50: 0 };
  const s = a.slice().sort((x, y) => x - y), at = p => r1(s[Math.min(s.length - 1, Math.floor(s.length * p))]);
  return { n: a.length, med: at(0.5), p95: at(0.95), max: r1(s[s.length - 1]), over33: a.filter(x => x > 33).length, over50: a.filter(x => x > 50).length };
}
const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

/* ------------------------------------------------------------------------------------------------ page chrome */
const CSS = `
  :root { color-scheme: dark; }
  [hidden] { display: none !important; }
  html, body { height: 100%; }
  body { margin: 0; padding: 0; font: 15px/1.45 -apple-system, "Helvetica Neue", Arial, sans-serif; background: #0d0e11; color: #e6e6e6; }
  body.m3-full { overflow: hidden; touch-action: none; overscroll-behavior: none; }
  .m3-top { padding: 10px 14px 6px; }
  .m3-top h1 { font-size: 19px; margin: 0 0 4px; }
  .m3-top p, .m3-note { margin: 3px 0; color: #b0b4bc; }
  .m3-steps { margin: 6px 0; padding-left: 20px; color: #cfd3da; } .m3-steps li { margin: 3px 0; } .m3-steps li.now { color: #fff; font-weight: 600; }
  button { font: inherit; padding: 9px 16px; border-radius: 9px; border: 1px solid #4a4f5a; background: #1c1f26; color: #fff; touch-action: manipulation; }
  button.go { background: #2f6fd6; border-color: #2f6fd6; font-weight: 600; } button:disabled { opacity: 0.45; }
  .m3-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 6px 0; }
  #m3status { color: #ffb347; font-weight: 600; } .warn { color: #ffb347; } .bad { color: #ff6b5a; font-weight: 600; } .ok { color: #7bd88f; }
  #m3frame { display: block; width: 100%; border: 0; background: #000; }
  .m3-res { padding: 8px 14px 40px; } .m3-res table { border-collapse: collapse; margin: 8px 0; font-variant-numeric: tabular-nums; font-size: 13px; }
  .m3-res th, .m3-res td { border: 1px solid #333; padding: 3px 8px; text-align: right; } .m3-res th:first-child, .m3-res td:first-child { text-align: left; }
  #m3out { width: 100%; height: 110px; background: #111; color: #ccc; border: 1px solid #333; font: 11px monospace; }
  .m3-bar { position: fixed; left: 0; right: 0; bottom: 0; min-height: 104px; box-sizing: border-box; padding: 8px 14px calc(8px + env(safe-area-inset-bottom));
    background: #15171c; border-top: 1px solid #333; display: flex; gap: 14px; align-items: center; z-index: 10; }
  .m3-bar .m3-say { flex: 1; font-size: 17px; line-height: 1.35; } .m3-bar .m3-say b { color: #fff; } .m3-bar .m3-k { font: 600 28px/1 -apple-system, sans-serif; min-width: 92px; text-align: center; }
  .m3-bar .m3-sub { color: #9aa0aa; font-size: 13px; }
  .m3-cover { position: fixed; inset: 0; background: rgba(8,9,12,0.86); display: flex; align-items: center; justify-content: center; z-index: 20; text-align: center; padding: 24px; }
  .m3-cover > div { max-width: 640px; } .m3-cover button { font-size: 20px; padding: 14px 28px; margin-top: 14px; }
  .m3-mark { position: fixed; width: 12px; height: 12px; background: #ff00ff; z-index: 30; pointer-events: none; }
`;
function chrome() {
  document.title = 'SYNTH Canvas — milestone 3 rendering test';
  document.body.textContent = '';
  const st = h('style'); st.textContent = CSS; document.head.append(st);
}
const say = t => { const e = $('#m3status'); if (e) e.textContent = t; if (AUTO) console.log('[m3] ' + t); };

/* ------------------------------------------------------------------------------------------------ build / staleness */
async function buildInfo() {
  const b = { files: null, deployed: null, stale: false, note: '' };
  try { const t = await (await fetch('../sw.js', { cache: 'no-store' })).text(); b.deployed = (/const BUILD = '([0-9a-f]+)'/.exec(t) || [])[1] || null; } catch (e) { /* offline */ }
  let shells = [];
  try { if (globalThis.caches) shells = (await caches.keys()).filter(k => /^synth-shell-v\d+-[0-9a-f]+$/.test(k)).map(k => k.replace(/^synth-shell-v\d+-/, '')); } catch (e) { /* none */ }
  const viaSW = !!(navigator.serviceWorker && navigator.serviceWorker.controller) && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (!viaSW) { b.files = b.deployed; b.note = 'the files on the server'; return b; }
  if (shells.length === 1 && (!b.deployed || shells[0] === b.deployed)) { b.files = shells[0]; b.note = 'the app’s current build'; return b; }
  b.files = shells.length === 1 ? shells[0] : null; b.stale = true; b.note = 'an update of the app is installed but not applied';
  return b;
}
async function applyUpdate(btn) { // as bench.html: the waiting worker takes over (the page reloads on the takeover)
  let reg = null;
  try { reg = await navigator.serviceWorker.getRegistration(); if (reg && !reg.waiting) { await reg.update(); await sleep(1500); } } catch (e) { /* none */ }
  const w = reg && (reg.waiting || reg.installing);
  if (!w) { location.reload(); return; }
  btn.disabled = true; btn.textContent = 'Updating…';
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  setTimeout(() => location.reload(), 4000);
  try { w.postMessage({ t: 'skip' }); } catch (e) { location.reload(); }
}
function envInfo(B) {
  return { date: new Date().toISOString(), page: location.origin + location.pathname, build: B.files, deployed: B.deployed, stale: B.stale,
    ua: navigator.userAgent, dpr: devicePixelRatio, viewport: innerWidth + '×' + innerHeight, screen: screen.width + '×' + screen.height, h5: H5ON, prune: PRUNE,
    canvas: A.W ? (r => Math.round(r.width) + '×' + Math.round(r.height))(A.W.viewport.getBoundingClientRect()) : null };
}

/* ------------------------------------------------------------------------------------------------ the H5 shim (import map) */
// wk.js (fitCanvas) and sx-ui-seq.js (storeDpr) as patched copies: one expression each, the relative imports made absolute
// (the copies are blob modules); every importer of either URL gets the copy (the iframe's import map). __m3h5.density
// (set by the page once the world exists) decides; without it, or with __m3h5.on false, today's rule.
const H5_HOOK = 'globalThis.__m3h5 && globalThis.__m3h5.on && globalThis.__m3h5.density';
const PATCHES = {
  'wk.js': [/let s = canvasK !== 1 && inWorld\(cv\) \? clamp\(dpr \* canvasK, 0\.5, 2\) : dpr;/,
    `let s = canvasK !== 1 && inWorld(cv) ? (${H5_HOOK} ? globalThis.__m3h5.density(cv, dpr, canvasK) : clamp(dpr * canvasK, 0.5, 2)) : dpr;`],
  'sx-ui-seq.js': [/return k === 1 \? dpr : clamp\(dpr \* k, 0\.5, 2\);/,
    `return k === 1 ? dpr : (${H5_HOOK} ? globalThis.__m3h5.density(cv, dpr, k) : clamp(dpr * k, 0.5, 2));`],
};
async function h5Map() {
  const imports = {}, done = [];
  for (const [f, [re, rep]] of Object.entries(PATCHES)) {
    const url = new URL(f + '?v=9', BASE).href;
    let src = await (await fetch(url)).text();
    if ((src.match(re) || []).length !== 1) throw new Error('H5 shim: ' + f + ' no longer has the expected line');
    src = src.replace(re, rep).replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\2/g, (m, a, qq, p) => a + qq + new URL(p, url).href + qq);
    src += '\n;globalThis.__m3patched = (globalThis.__m3patched || []).concat(' + JSON.stringify(f) + ');\n';
    imports[url] = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    done.push(f);
  }
  return { map: '<script type="importmap">' + JSON.stringify({ imports }) + '<\/script>', files: done };
}

/* ------------------------------------------------------------------------------------------------ the app in the iframe */
// (runs in the iframe before main.js: so its capture listeners come before gesture.js's, which swallows a two-finger
// session's pointer events) the input-to-frame queue, touches down, console errors, a repaint counter per canvas (clearRect)
const HEAD_JS = `window.__synthTest = {};
(function () {
  var I = window.__m3in = { on: false, q: [], touches: 0, maxT: 0, knob: null, errs: [], paints: new WeakMap() };
  addEventListener('pointermove', function (e) { if (I.on) I.q.push(e.timeStamp, performance.now()); if (I.knob && e.pointerId === I.knob.id) I.knob.moves++; }, { capture: true, passive: true });
  // fingers down now, the most since a burst began (maxT), and each touch sequence (first finger down … last up): its most
  I.gest = []; var g = null;
  var tc = function (e) {
    I.touches = e.touches ? e.touches.length : 0; if (I.touches > I.maxT) I.maxT = I.touches;
    if (I.touches && !g) g = { t0: performance.now(), max: 0 };
    if (g && I.touches > g.max) g.max = I.touches;
    if (!I.touches && g) { g.t1 = performance.now(); I.gest.push(g); if (I.gest.length > 200) I.gest.shift(); g = null; }
  };
  addEventListener('touchstart', tc, { capture: true, passive: true }); addEventListener('touchend', tc, { capture: true, passive: true }); addEventListener('touchcancel', tc, { capture: true, passive: true });
  addEventListener('pointerdown', function (e) {
    var t = e.target, k = t && t.closest ? t.closest('[data-dest], .wk-knob') : null;
    if (k && I.on) I.knob = { id: e.pointerId, t0: e.timeStamp, moves: 0, dest: k.getAttribute('data-dest') || '' };
  }, { capture: true, passive: true });
  var up = function (e) { if (I.knob && e.pointerId === I.knob.id) { I.knob.t1 = e.timeStamp; I.lastKnob = I.knob; I.knob = null; } };
  addEventListener('pointerup', up, { capture: true, passive: true }); addEventListener('pointercancel', up, { capture: true, passive: true });
  addEventListener('error', function (e) { I.errs.push('error: ' + String(e.message || e.error)); });
  addEventListener('unhandledrejection', function (e) { I.errs.push('unhandled: ' + String(e.reason && e.reason.message || e.reason)); });
  var ce = console.error;
  console.error = function () { try { I.errs.push([].map.call(arguments, function (a) { return a && a.stack ? String(a.stack).split('\\n').slice(0, 2).join(' ') : String(a); }).join(' ').slice(0, 300)); } catch (x) {} return ce.apply(console, arguments); };
  var C = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, cr = C && C.clearRect, P = I.paints;
  if (cr) C.clearRect = function (x, y, w, h) { var c = this.canvas; if (c) P.set(c, (P.get(c) || 0) + 1); return cr.call(this, x, y, w, h); };
  window.__m3h5 = { on: false, density: null };
})();`;
const A = {}; // the app: { win, doc, api, cv, shell, W, mod: {SU, OSC, SEQ, CORE, MOD, CAB, WK}, frame, h5 }
async function boot(frame) {
  const html = await (await fetch('../index.html', { cache: 'no-store' })).text();
  let map = '', h5files = [], h5err = null;
  if (H5ON) { try { const m = await h5Map(); map = m.map; h5files = m.files; } catch (e) { h5err = String(e.message || e); } }
  frame.srcdoc = html.replace(/<head>/i, '<head><base href="' + BASE + '">' + map + '<script>' + HEAD_JS + '<\/script>');
  const up = async n => {
    for (let i = 0; i < n; i++) {
      await sleep(50);
      const w = frame.contentWindow;
      if (w && w.__synthTest && w.__synthTest.cv && w.__synthTest.api && w.__synthTest.shell && w.document.querySelector('#world') && w.__synthTest.cv.world()) return w;
    }
    return null;
  };
  let win = await up(map ? 500 : 900);
  if (!win && map) { // (the app did not start with the patched copies: again without them, today's rule only)
    h5err = 'the app did not start with the H5 shim'; h5files = [];
    frame.srcdoc = html.replace(/<head>/i, '<head><base href="' + BASE + '"><script>' + HEAD_JS + '<\/script>');
    win = await up(900);
  }
  if (!win) throw new Error('the app did not start in the frame');
  const T = win.__synthTest;
  Object.assign(A, { win, doc: win.document, api: T.api, cv: T.cv, shell: T.shell, modUI: T.modUI, frame, W: T.cv.world() });
  // nothing the bench changes is stored (project, prefs, cameras): the store's writes go nowhere for the iframe's life
  const st = A.api.store; A.blocked = 0;
  for (const m of ['set', 'setRaw', 'saveProject', 'saveNow']) if (typeof st[m] === 'function') st[m] = () => { A.blocked++; };
  // no dialog stops a run (the iframe's confirm / alert answer at once; what they asked is kept with the results)
  A.dialogs = [];
  win.confirm = msg => { A.dialogs.push('confirm: ' + String(msg).slice(0, 160)); return true; };
  win.alert = msg => { A.dialogs.push('alert: ' + String(msg).slice(0, 160)); };
  const imp = u => win.Function('u', 'return import(u)')(new URL(u, BASE).href);
  A.mod = { SU: await imp('serum-ui.js?v=9'), OSC: await imp('sx-ui-osc.js?v=9'), SEQ: await imp('sx-ui-seq.js?v=9'), CORE: await imp('serum-core.js?v=9'),
    MOD: await imp('cv-module.js?v=9'), CAB: await imp('cv-cables.js?v=9'), WK: await imp('wk.js?v=9') };
  A.h5 = { want: H5ON, files: (win.__m3patched || []).slice(), err: h5err, ok: H5ON && !h5err && h5files.every(f => (win.__m3patched || []).includes(f)) };
  installH5();
  // one layout on every device: the on-screen keys hidden, the top tray folded to its row (the canvas takes the height)
  try { const kr = A.doc.querySelector('#kbrow'), kh = A.doc.querySelector('#kbHide'); if (kr && !kr.hidden && kh) kh.click(); } catch (e) { console.error(e); }
  try { A.shell.topSet(0, 'end'); } catch (e) { console.error(e); }
  await sleep(300);
  // the camera as a finger has it: no lock, pinch zooms the canvas (device prefs; not stored, see above)
  try { if (A.W.lockOn && A.W.lockOn()) A.W.setLock(false); } catch (e) { /* older world */ }
  try { if (A.W.pinchMode !== 'canvas') A.W.setPinchMode('canvas'); } catch (e) { /* older world */ }
  // the monitors' deliveries counted per track (the self-check's snapshot rate) and dropped in bursts under 'still' (H7)
  const M = A.api.monitors, deliver = M.deliver;
  A.mon = { n: new Map(), still: false, dropped: 0 };
  M.deliver = function (id, d) {
    const k = id + (d && d.mc && typeof d.i !== 'string' && typeof d.c !== 'string' ? ':mc' : ':' + (d && (d.i || d.c) || 'p'));
    A.mon.n.set(k, (A.mon.n.get(k) || 0) + 1);
    if (A.mon.still && A.W.busy) { A.mon.dropped++; return; }
    return deliver.call(this, id, d);
  };
  return A;
}
// H5 (§1.4): the density of an in-world canvas at rest, within the 64 MiB total; recomputed at a zoom end (lazily, inside
// rescaleCanvases: a rest) and at every camera rest (an over-budget allocation that changes re-fits the displays)
function installH5() {
  const { win, W, WK, mod } = Object.assign({ WK: A.mod.WK }, A);
  const S = { k: NaN, map: new WeakMap(), drops: 0, bytes: 0, n: 0, key: '' };
  function alloc(k, dpr) {
    S.k = k; S.map = new WeakMap(); S.drops = 0;
    const vp = W.viewport.getBoundingClientRect(), cx = vp.left + vp.width / 2, cy = vp.top + vp.height / 2, L = [];
    for (const c of W.el.querySelectorAll('canvas')) {
      const w = c.offsetWidth, hh = c.offsetHeight;
      if (!(w > 0 && hh > 0)) continue;
      const r = c.getBoundingClientRect(), on = r.right > vp.left && r.left < vp.right && r.bottom > vp.top && r.top < vp.bottom;
      L.push({ c, a: w * hh, on, dist: Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy), d: Math.min(Math.max(0.5, dpr * k), Math.sqrt(CANVAS_MAX_PX / (w * hh))) });
    }
    let sum = L.reduce((s, x) => s + x.a * x.d * x.d * 4, 0);
    const drop = x => { const nd = Math.min(x.d, dpr); sum -= x.a * (x.d * x.d - nd * nd) * 4; if (nd < x.d) S.drops++; x.d = nd; };
    if (sum > CANVAS_BUDGET) for (const x of L.filter(x => !x.on)) { if (sum <= CANVAS_BUDGET) break; drop(x); }
    if (sum > CANVAS_BUDGET) for (const x of L.filter(x => x.on).sort((a, b) => b.dist - a.dist)) { if (sum <= CANVAS_BUDGET) break; drop(x); }
    for (const x of L) S.map.set(x.c, x.d);
    S.bytes = sum; S.n = L.length;
    return L.filter(x => x.d < Math.max(0.5, dpr * k)).map(x => x.d.toFixed(2)).join();
  }
  const density = (cv, dpr, k) => { if (S.k !== k) S.key = alloc(k, dpr); const d = S.map.get(cv); return d != null ? d : Math.max(0.5, dpr * k); };
  win.__m3h5.density = density;
  win.__m3h5.on = !!A.h5.ok;
  A.h5.state = S;
  W.on('cameraend', () => { // a rest: a pan may bring off-screen (dropped) canvases into view
    if (!win.__m3h5.on) return;
    const dpr = Math.min(2, Math.max(1, win.devicePixelRatio || 1)), was = S.key;
    S.key = alloc(W.k, dpr);
    if (S.key !== was) { try { mod.WK.rescaleCanvases(W.el); } catch (e) { console.error(e); } }
  });
  // SerumUI.prototype.paintCanvas: the same, the store from density() (the cap of 2 lifted; 16e6 per canvas kept)
  const SU = mod.SU.SerumUI.prototype, orig = SU.paintCanvas, WKm = mod.WK;
  SU.paintCanvas = function (cv) {
    if (!(win.__m3h5.on && win.__m3h5.density)) return orig.call(this, cv);
    if (!cv.sized) {
      const r = cv.el.getBoundingClientRect(), dpr = Math.min(2, (this.d.defaultView && this.d.defaultView.devicePixelRatio) || 1);
      cv.sized = true;
      cv.hid = !(r.width > 0 && r.height > 0);
      if (cv.hid) { if (!this.ro) cv.sized = false; return; }
      const ls = WKm.localScale(cv.el), lw = cv.el.clientWidth || r.width * ls, lh = cv.el.clientHeight || r.height * ls;
      let qd = ls === 1 ? dpr : win.__m3h5.density(cv.el, dpr, WKm.canvasScale(cv.el));
      if (lw * lh * qd * qd > CANVAS_MAX_PX) qd = Math.sqrt(CANVAS_MAX_PX / (lw * lh));
      const w = Math.max(1, Math.round(lw * qd)), hh = Math.max(1, Math.round(lh * qd));
      if (cv.el.width !== w || cv.el.height !== hh) { cv.el.width = w; cv.el.height = hh; }
      cv.w = w; cv.h = hh; cv.dpr = qd; cv.last = null;
    }
    if (cv.hid) return;
    let k;
    try { k = cv.key(); } catch (err) { k = Math.random(); }
    if (k === cv.last) return;
    cv.last = k;
    const g = cv.el.getContext ? cv.el.getContext('2d') : null;
    if (!g) return;
    try { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.w, cv.h); cv.draw(g, cv.w, cv.h, cv.dpr); } catch (err) { console.warn('serum-ui: display draw failed', err); }
  };
}
function setH5(on) { // M4: today's rule ↔ H5, every display re-fitted
  A.win.__m3h5.on = !!on && !!A.h5.ok;
  A.h5.state.k = NaN;
  try { A.mod.WK.rescaleCanvases(A.W.el); } catch (e) { console.error(e); }
}
const trk = () => { const P = A.api.project(); return P.tracks.find(t => t.id === P.selTrack); };
const raf = () => new Promise(r => A.win.requestAnimationFrame(r));
const now = () => A.win.performance.now();
async function mounted() { await sleep(250); for (let i = 0; i < 80 && A.cv.mount(); i++) await raf(); await sleep(500); }
// audio: AudioContext inside a user gesture (the click that calls this); the CDP harness passes the autoplay policy
function audioOn() { try { const p = A.api.powerOn(); if (p && p.catch) p.catch(() => {}); } catch (e) { console.error(e); } }
const audioRunning = () => { const c = A.api.ctx(); return !!c && c.state === 'running'; };

/* ------------------------------------------------------------------------------------------------ hosts and views */
// a SerumUI as the host of mounted views: its bundled shell built into a detached box, its page DOM dropped, the shown page
// replaced by a composite of the views on screen (paint, canvases, halo scans: H4); the footer (and, for a slot host, the
// header) painted no more
function makeHost(S, base, dev, o = {}) {
  const { doc } = A, { SU } = A.mod;
  const box = doc.createElement('div');
  const ui = new SU.SerumUI(box, base);
  try { ui.pageBox.textContent = ''; } catch (e) { /* none */ }
  const clr = P => { for (const k of ['binds', 'canvases', 'editors', 'lives']) P[k].length = 0; };
  clr(ui.footPage);
  if (!o.head) clr(ui.headPage);
  const H = { ui, dev, views: [], snapN: 0, slot: o.slot || null, t0: now() };
  const roots = () => H.views.filter(v => v.shown).map(v => v.root);
  H.vpage = { el: { querySelectorAll: sel => [].concat(...roots().map(r => [...r.querySelectorAll(sel)])), classList: { toggle() {} } }, binds: [], canvases: [], editors: [], lives: [] };
  ui.pages.osc = H.vpage; ui.page = 'osc';
  H.compose = () => { const V = H.views.filter(v => v.shown); for (const k of ['binds', 'canvases', 'editors', 'lives']) H.vpage[k] = [].concat(...V.map(v => v.page[k])); };
  H.anyShown = () => H.views.some(v => v.shown);
  S.hosts.push(H);
  return H;
}
// a view: the panel built under a part root (ui.bp = its page while it builds), its canvases re-fitted at a zoom end
function mountView(H, root, build) {
  const { ui } = H, page = { el: root, binds: [], canvases: [], editors: [], lives: [] };
  const was = ui.bp;
  ui.bp = page;
  let made = null;
  try { made = build(root); } finally { ui.bp = was; }
  const v = { root, page, made, shown: true, offs: [] };
  v.offs.push(A.mod.WK.onRescale(root, () => { for (const cv of page.canvases) cv.sized = false; ui.edDirty = true; ui.queue(); }));
  H.views.push(v); H.compose();
  return v;
}
// fixed slots (§2.3: an ENV / LFO panel shows one slot): an object derived from the SerumUI with its own edSel (LFO) or an
// s() whose ui.env names the slot (ENV); every other member is the host's
function derived(ui, o) {
  const d = Object.create(ui);
  if (o.lfo != null) d.edSel = 'lfo' + (o.lfo + 1);
  if (o.env != null) d.s = function () { const s = ui.s(); if (!s) return s; const v = Object.create(s); v.ui = Object.assign({}, s.ui, { env: o.env }); return v; };
  return d;
}
// H1 / H3 emulated (prune): the OSC's inactive type views and an LFO panel's PATH (unless its type is path) and VELO / NOTE
// areas leave the DOM; their canvases and editors leave the view's page
function prune(v, kind, H) {
  if (!PRUNE) return;
  const { root, page } = v;
  if (kind === 'osc' && v.made && v.made.views) {
    const t = A.mod.CORE.oscTypeOf(H.ui.s(), v.made.o);
    for (const [type, x] of Object.entries(v.made.views)) if (type !== t) { if (x.el) x.el.remove(); for (const e of x.head || []) e.remove(); }
  }
  if (kind === 'lfo') {
    const boxes = [...root.querySelectorAll('.sx-edbox')]; // [LFO curve, PATH, VELO / NOTE curve]
    if (boxes[1]) boxes[1].remove(); // (the slot's type is not path in these scenes)
    if (boxes[2] && boxes[2].parentElement) boxes[2].parentElement.remove();
  }
  page.canvases = page.canvases.filter(cv => root.contains(cv.el));
  page.editors = page.editors.filter(ed => { const r = ed && (ed.root || ed.el); const keep = !r || root.contains(r); if (!keep && ed.destroy) { try { ed.destroy(); } catch (e) { /* gone */ } } return keep; });
}
const PANELS = { // part → (root, H) → the panel (built under H.ui.bp)
  voice: (root, H) => {
    const { ui } = H, d = A.doc;
    if (ui.head) root.append(ui.head);
    const row = d.createElement('div'); row.style.cssText = 'display:flex;gap:8px;align-items:flex-start';
    row.append(ui.voicingPanel(), derived(ui, { env: 0 }).envPanel());
    root.append(row);
  },
  osc: (root, H, P) => new A.mod.OSC.OscPanel(root, H.ui.kit, P.o),
  sub: (root, H) => new A.mod.OSC.SubPanel(root, H.ui.kit),
  noise: (root, H) => new A.mod.OSC.NoisePanel(root, H.ui.kit),
  filter: (root, H, P) => new A.mod.OSC.FilterPanel(root, H.ui.kit, P.k),
  env: (root, H, P) => { root.append(derived(H.ui, { env: P.env }).envPanel()); },
  lfo: (root, H, P) => { root.append(derived(H.ui, { lfo: P.lfo }).lfoPanel()); },
  macros: (root, H) => { root.append(H.ui.macrosPanel()); },
  chaos: (root, H) => { root.append(H.ui.chaosPanel()); },
  arp: (root, H) => new A.mod.SEQ.ArpPage(root, H.ui.kit),
};
const partKind = p => (/^osc/.test(p) ? 'osc' : /^filter/.test(p) ? 'filter' : /^env/.test(p) ? 'env' : /^lfo/.test(p) ? 'lfo' : p);
// a module (cv-module createModule: the real bar, jacks and world item) whose body holds one view of host H
function addModule(S, key, o, H, build, kind) {
  const { doc, W } = A, { MOD } = A.mod, wPanel = o.w, wMod = gup(wPanel + 16);
  let view = null, cost = 400;
  const m = MOD.createModule({
    id: 'm3:' + key, kind: o.kind || 'part', title: o.title, sub: o.sub, color: o.color || S.color, x: 0, y: 0, w: wMod, jacks: o.jacks || [], cost: 400,
    body: { mount: body => {
      body.style.background = 'var(--sx-bg, #14161b)';
      const root = doc.createElement('div');
      root.className = H.ui.el.className + ' m3-part';
      root.setAttribute('data-dev', H.dev);
      root.style.width = wPanel + 'px';
      body.append(root);
      view = mountView(H, root, r => build(r));
      if (kind) prune(view, kind, H);
      cost = 1 + body.getElementsByTagName('*').length + 12;
    }, unmount: () => {} },
    menu: () => [],
    onScreen: on => { if (!view || view.shown === on) return; view.shown = on; H.compose(); if (on) { H.ui.edDirty = true; H.ui.queue(); } },
  }, { world: W, doc });
  m.cost = cost;
  W.el.append(m.el);
  W.add(m);
  const rec = { key, m, H, view, kind: o.kind || 'part', group: o.group, slot: !!o.slot };
  S.mods.push(rec);
  return rec;
}
const J = (id, side, y, kind = 'audio') => ({ id, side, kind, y: BAR_H + y, label: id });
function partJacks(p) {
  if (p === 'voice') return [J('main', 'left', 28), J('direct', 'left', 60), J('note', 'left', 92), J('out', 'right', 28), J('env1', 'right', 60, 'mod')];
  if (/^filter/.test(p)) return [J('in', 'left', 28), J('out', 'right', 28)];
  if (/^(env|lfo)/.test(p)) return [J('out', 'right', 28, 'mod')];
  if (p === 'macros') return Array.from({ length: 8 }, (_, i) => J('k' + (i + 1), 'right', 40 + i * 22, 'mod'));
  if (p === 'arp') return [J('note', 'right', 28)];
  return [J('out', 'right', 28)];
}
// one Serum's parts (p1: VOICE, OSC A, FILTER 1; p1x: everything §1.4's budget line names) over a host on the app's sxHost
function serumParts(S, dev, which) {
  const base = Object.assign({}, A.api.sxHost(S.t, dev), { monitor() {} }); // (the snapshot comes from S's own subscription)
  const H = makeHost(S, base, dev, { head: true });
  const list = which === 'complete' ? ['voice', 'oscA', 'filter1'] : ['voice', 'oscA', 'oscB', 'oscC', 'sub', 'noise', 'filter1', 'filter2', 'env2', 'lfo1', 'lfo2', 'macros', 'arp'];
  for (const p of list) {
    const P = PART[p], kind = partKind(p);
    addModule(S, dev + '/' + p, { title: P.title, sub: dev === 'i1' ? '' : 'Serum ' + dev.slice(1), w: P.w, jacks: partJacks(p), group: dev + ':' + which, kind: 'part' }, H,
      root => PANELS[kind](root, H, P), kind);
  }
  // the snapshot: the app's monitor for this Serum, live while any of its views is on screen (H4), fanned out to the views
  S.offs.push(A.api.monitors.sub(S.t.id, dev, { role: 'both', live: () => H.anyShown(), deliver: d => { H.snapN++; H.ui.setSnapshot(d); } }));
  return H;
}
// the Serum-faithful modulators (§2.2): a slot host each — a SerumUI over a synthetic Serum state holding the device in one
// slot (LFO → LFO 1, ENV → ENV 2, chaos → chaos 1 (a row reads it, so the panel shows), macros → the 8 macros)
function slotMods(S) {
  const { CORE } = A.mod;
  for (const [key, kind, real, title] of SLOTS) {
    const s = CORE.normalizeSerum(CORE.defaultSerum()), fx = CORE.migrateFx1(CORE.defaultFxV1());
    if (kind === 'chaos') CORE.addMod(s, fx, 'chaos1', 'a.level', { amt: 0.3 });
    if (kind === 'env') { s.ui.env = 1; s.p['e2.dec'] = 0.45; s.p['e2.sus'] = 0.3; }
    const mem = {};
    const base = { state: () => s, fx: () => fx, edit: fn => { fn(s); }, editFx: fn => { fn(fx); }, bpm: () => A.api.project().bpm, v2Fx: true, dev: 'm3' + key,
      notify() {}, monitor() {}, storage: { get: (k, d) => (k in mem ? mem[k] : d), set: (k, v) => { mem[k] = v; } }, seqCmd() {}, tracks: () => [] };
    const H = makeHost(S, base, 'm3' + key, { head: false, slot: { kind, real } });
    const sn = { eff: new Float32Array(4096), lfoPh: new Float32Array(10), lfoOut: new Float32Array(10), lfoY: new Float32Array(10), env: new Float32Array(4),
      envStage: new Uint8Array(4), envT: new Float32Array(4), notes: 1 };
    H.slot.msg = { s: sn };
    const w = SLOT_W[kind];
    addModule(S, 'slot/' + key, { title, w, kind: 'mod', slot: true, color: A.mod.CAB.MOD_COLOR[kind], group: 'slot:' + key,
      jacks: kind === 'macro' ? Array.from({ length: 8 }, (_, i) => J('k' + (i + 1), 'right', 40 + i * 22, 'mod')) : [J('out', 'right', 28, 'mod')] }, H,
    root => (kind === 'lfo' ? PANELS.lfo(root, H, { lfo: 0 }) : kind === 'env' ? PANELS.env(root, H, { env: 1 }) : kind === 'macro' ? PANELS.macros(root, H) : PANELS.chaos(root, H)),
    kind === 'lfo' ? 'lfo' : null);
  }
  // the real ModCore feed of the hidden 2b modules (mc: lfo 0…9, env 10…13, chaos 14, 15; lane E's mcx, IMPL-3 §9.1: ph[l] the
  // phase of LFO slot l, ph[10 + l] its Path Y; env[j] the stage of ENV slot j = mc[10 + j], env[4 + j] its stage time) → the
  // slot's snapshot as §2.9 maps it (LFO 1: lfoPh / lfoOut / lfoY; ENV 2: envStage / envT); a build without mcx: a time proxy
  const prim = A.api.project().tracks.find(t => t.id === S.t.id).prim || 'i1';
  const slotsOf = () => { try { const p = A.modUI.pay(S.t); return p && !p.off && p.slots ? p.slots : {}; } catch (e) { return {}; } };
  let map = null;
  S.offs.push(A.api.monitors.sub(S.t.id, prim, { role: 'inst', mods: true, live: () => S.hosts.some(H => H.slot && H.anyShown()), deliver: d => {
    if (!d || !d.mc) return;
    S.mcN = (S.mcN || 0) + 1;
    if (d.mcx) S.mcx = (S.mcx || 0) + 1;
    if (!map) map = slotsOf();
    const tt = (now() - S.t0) / 1000, X = d.mcx && d.mcx.ph && d.mcx.env ? d.mcx : null;
    for (const H of S.hosts) {
      if (!H.slot || !H.anyShown()) continue;
      const e = map[H.slot.real], i = e && e.i >= 0 && e.i < d.mc.length ? e.i : -1, v = i >= 0 ? d.mc[i] : 0, sn = H.slot.msg.s;
      if (H.slot.kind === 'lfo') {
        if (X && i >= 0 && i < 10) { sn.lfoPh[0] = X.ph[i]; sn.lfoOut[0] = v; sn.lfoY[0] = X.ph[10 + i]; }
        else { sn.lfoPh[0] = (tt * (H.slot.real === 'l1' ? 0.5 : 0.8)) % 1; sn.lfoY[0] = v; sn.lfoOut[0] = sn.lfoPh[0]; }
      } else if (H.slot.kind === 'env') {
        if (X && i >= 10 && i < 14) { sn.envStage[1] = X.env[i - 10]; sn.envT[1] = X.env[i - 6]; sn.env[1] = v; }
        else { sn.envStage[1] = 1 + (Math.floor(tt * 2) % 4); sn.envT[1] = (tt % 0.5) + v * 0.001; sn.env[1] = v; }
      }
      H.snapN++;
      H.ui.setSnapshot(H.slot.msg);
    }
  } }));
}

/* ------------------------------------------------------------------------------------------------ scenes */
const S0 = { cur: null };
async function newTrack(model) {
  A.shell.srcPick(model, 'track');
  await mounted();
  return trk();
}
function sxSetup(t, dev, which) { // the Serum's sound: its parts on, the ARP on, every display moving (§1.5)
  const H = A.api.sxHost(t, dev), { CORE } = A.mod, full = which !== 'complete';
  H.edit(s => {
    const on = full ? ['a.on', 'b.on', 'c.on', 's.on', 'n.on', 'f.on', 'f2.on'] : ['a.on', 'f.on'], off = full ? [] : ['b.on', 'c.on', 's.on', 'n.on', 'f2.on'];
    for (const k of on) s.p[k] = 1;
    for (const k of off) s.p[k] = 0;
    s.p['arp.on'] = 1;
    s.p['e2.dec'] = 0.45; s.p['e2.sus'] = 0.25;
    const fx = H.fx(), add = (src, dst, amt) => CORE.addMod(s, fx, src, dst, { amt });
    add('lfo1', 'a.wt', 0.6); add('lfo2', 'f.cutoff', 0.3); add('env2', 'f.cutoff', 0.35);
    if (full) { add('lfo1', 'b.wt', 0.5); add('lfo1', 'c.wt', 0.45); add('lfo2', 'f2.cutoff', 0.3); add('env2', 'f2.cutoff', 0.35); }
  }, { label: 'ui-m3' });
}
function addEffects(key, n) {
  const items = (A.cv.fx.items || []).filter(x => x.group === 'Effects'), pref = ['eq', 'compressor', 'comp', 'delay', 'reverb', 'chorus', 'distortion', 'dist', 'filter'];
  const pick = [...pref.map(p => items.find(x => x.type === p)).filter(Boolean), ...items].filter((x, i, L) => L.indexOf(x) === i).slice(0, n);
  for (const x of pick) A.cv.fx.addEffect(key, x.type);
}
// the real 2b modulators (ModCore traffic; on Serum scenes also the Mod Wheel and a Macro) and their rows onto knobs
function realMods(S, hwDests) {
  const P = A.api.project(), M = A.cv.mod, made = {};
  const at = i => ({ x: -320, y: i * 320 });
  const kinds = [['l1', 'lfo'], ['l2', 'lfo'], ['e1', 'env'], ['h1', 'chaos'], ['m1', 'macro']].concat(S.D.slots ? [['e2', 'env']] : [], S.D.kind === 'hw' ? [] : [['wheel', 'wheel']]);
  kinds.forEach(([want, kind], i) => {
    if (kind === 'wheel' && P.perf && P.perf.wheel) { made.wheel = 'wheel'; return; }
    const k = M.add(kind, at(i));
    if (k) made[want] = k;
    if (kind === 'wheel' && k) S.placedWheel = true;
  });
  S.real = made;
  const src = w => (w === 'm1a' ? made.m1 + '.k1' : w === 'm1b' ? made.m1 + '.k2' : w === 'wheel' ? 'wheel' : made[w] + '.out');
  // (sx1: the 8 cables of §1.5 — 2 LFOs, the Mod Wheel, a Macro — + the ENV and chaos rows that keep ModCore's other kinds running)
  const order = S.D.kind === 'hw' ? ['l1', 'l1', 'l2', 'l2', 'e1', 'e2', 'h1', 'm1a'] : ['l1', 'l1', 'l2', 'l2', 'wheel', 'wheel', 'm1a', 'm1b', 'e1', 'h1'].concat(S.D.slots ? ['e2'] : []);
  const dests = hwDests || S.dests;
  const rows = [];
  let di = 0;
  for (const w of order) {
    if (w !== 'wheel' && !made[w.replace(/[ab]$/, '')]) continue;
    for (let tries = 0; tries < dests.length; tries++) {
      const dst = dests[di++ % dests.length], s = src(w);
      if (rows.some(r => r.dst === dst)) continue;
      let ok = false;
      try { ok = M.can(s, dst).ok; } catch (e) { ok = false; }
      if (!ok) continue;
      const id = M.connect(s, dst);
      if (id) { rows.push({ id, src: s, dst, w }); break; }
    }
  }
  S.rows = rows;
}
// the loop: 2 bars of a 4-note chord on the scene's track (a Serum's ARP plays it), the transport looping
async function play(S) {
  const P = A.api.project(), T = A.api.transport();
  if (T.playing) A.doc.querySelector('#tPlay').click();
  const bt = 960 * 4 * P.sig[0] / P.sig[1];
  A.api.clipToTrack(S.t.id, [48, 52, 55, 59].map(n => ({ n, t: 0, d: 2 * bt - 24, v: 100 })));
  P.loop.start = 0; P.loop.end = 2 * bt; P.loop.on = true;
  await sleep(150);
  if (!A.api.transport().playing) A.doc.querySelector('#tPlay').click();
  await sleep(300);
}
function stopPlay() { if (A.api.transport().playing) A.doc.querySelector('#tPlay').click(); }
// a module of the app the scene does not show: far off (its displays and monitors sleep: off screen) and hidden
function hideApp(S, keys) {
  const t = S.t; t.lay = Object.assign({}, t.lay);
  keys.forEach((k, i) => { if (k in t.dev || k === 'wheel' || /\/fx$/.test(k)) { t.lay[k] = Object.assign({}, t.lay[k], { x: -64000 - i * 3200, y: -64000 }); S.hide.add(k); } });
}
function setLay(t, k, x, y) { t.lay = Object.assign({}, t.lay); t.lay[k] = Object.assign({}, t.lay[k], { x: Math.round(x / 32) * 32, y: Math.round(y / 32) * 32 }); }
const appMod = k => (A.cv.view() ? A.cv.view().modules.get(k) : null);
const rectH = rec => Math.max(BAR_H, rec.m.el.offsetHeight || rec.m.rect().h);
// columns of modules from x0 (each column's modules stacked, VGAP apart) → the next column's x, the tallest column's bottom
function columns(cols, x0, y0) {
  let x = x0, bottom = y0;
  for (const col of cols) {
    let y = y0, w = 0;
    for (const r of col.filter(Boolean)) { r.m.setPos(x, y, false); y = gup(y + rectH(r) + VGAP); w = Math.max(w, r.m.w); }
    bottom = Math.max(bottom, y); x = gup(x + w + HGAP);
  }
  return { x, bottom };
}
const byKey = (S, k) => S.mods.find(r => r.key === k) || null;
// the scene's cables (cv-cables, read-only): per Serum the internal ones (a fork, a stub) and the mod cables of its rows
function sceneCables(S) {
  const L = [], c = S.color;
  const audio = (id, a, b, o) => L.push(Object.assign({ id, a, b, kind: 'audio', readonly: true, color: c }, o));
  for (const dev of S.sdevs) {
    const p = k => 'm3:' + dev + '/' + k, has = k => !!byKey(S, dev + '/' + k);
    const full = has('oscB');
    audio(dev + 'a1', p('oscA') + '.out', p('filter1') + '.in');
    if (full) {
      audio(dev + 'b1', p('oscB') + '.out', p('filter1') + '.in', { label: 'BAL 50 %' }); audio(dev + 'b2', p('oscB') + '.out', p('filter2') + '.in'); // (a fork)
      audio(dev + 'c2', p('oscC') + '.out', p('filter2') + '.in'); audio(dev + 'cs', p('oscC') + '.out', 'stub:' + dev, { label: '→ Filter (off)', dim: true }); // (a stub)
      audio(dev + 's1', p('sub') + '.out', p('filter1') + '.in'); audio(dev + 'nd', p('noise') + '.out', p('voice') + '.direct', { label: 'direct' });
      audio(dev + 'f2', p('filter2') + '.out', p('voice') + '.main'); audio(dev + 'ar', p('arp') + '.note', p('voice') + '.note');
    }
    audio(dev + 'f1', p('filter1') + '.out', p('voice') + '.main');
    audio(dev + 'vf', p('voice') + '.out', 'app:' + dev + '/fx.in', { label: 'MAIN' });
    audio(dev + 'fo', 'app:' + dev + '/fx.out', 'app:out.in');
  }
  // mod cables: the slot modulators (p1x, hwm) take the real rows' places; else the real modules are drawn as the sources
  const MC = A.mod.CAB.MOD_COLOR;
  (S.rows || []).forEach((r, i) => {
    const kind = r.w === 'wheel' ? 'wheel' : /^m1/.test(r.w) ? 'macro' : r.w[0] === 'l' ? 'lfo' : r.w[0] === 'e' ? 'env' : 'chaos';
    let a;
    if (S.D.slots) { const sk = { l1: 'lfoA', l2: 'lfoB', e1: 'envA', e2: 'envB', h1: 'chaos', m1a: 'mac', m1b: 'mac' }[r.w]; if (!sk) return; a = 'm3:slot/' + sk + '.' + (/^m1/.test(r.w) ? (r.w === 'm1a' ? 'k1' : 'k2') : 'out'); }
    else a = 'app:' + (r.w === 'wheel' ? 'wheel' : r.src.split('.')[0]) + '.' + (/^m1/.test(r.w) ? r.src.split('.')[1] : 'out');
    L.push({ id: 'mod' + i, a, b: 'knob:' + r.dst, kind: 'mod', color: MC[kind], amt: 0.35, bi: 0 });
  });
  return L;
}
// the cables' end points (world px, at rest): module jacks (cv-module port()), knob centres ([data-dest] in a visible module)
function sceneLayout(S) {
  const { W } = A, ports = new Map();
  const jack = (m, j) => { const p = m.port(j), r = m.rect(); return { x: r.x + p.x, y: r.y + p.y }; };
  for (const c of S.cables) for (const end of [c.a, c.b]) {
    if (ports.has(end)) continue;
    let pt = null;
    if (end.startsWith('m3:')) { const [k, j] = [end.slice(3, end.lastIndexOf('.')), end.slice(end.lastIndexOf('.') + 1)], r = byKey(S, k); if (r) pt = jack(r.m, j); }
    else if (end.startsWith('app:')) { const [k, j] = [end.slice(4, end.lastIndexOf('.')), end.slice(end.lastIndexOf('.') + 1)], m = appMod(k); if (m) pt = jack(m, j); }
    else if (end.startsWith('stub:')) { const dev = end.slice(5), r = byKey(S, dev + '/oscC'); if (r) { const p = jack(r.m, 'out'); pt = { x: p.x + 120, y: p.y + 48 }; } }
    else if (end.startsWith('knob:')) {
      const [dev, id] = end.slice(5).split(':');
      const els = [...W.el.querySelectorAll('[data-dev="' + dev + '"] [data-dest="' + id + '"], [data-cv-mod="' + dev + '"] [data-dest="' + id + '"]')];
      const el = els.find(e => { const m = e.closest('.cv-mod'); return m && !S.hiddenEl(m) && e.getClientRects().length; });
      if (el) { const r = el.getBoundingClientRect(); pt = W.toWorld(r.left + r.width / 2, r.top + r.height / 2); }
    }
    if (pt) ports.set(end, pt);
  }
  S.cab.layout(ports);
  S.ports = ports.size;
}
async function build(id) {
  const D = SCENES[id], S = { id, D, hosts: [], mods: [], offs: [], hide: new Set(), rows: [], sdevs: [], t0: now(), info: {}, e0: A.win.__m3in.errs.length };
  S0.cur = S;
  say('Building ' + id + ' — ' + D.title + '…');
  const tb = now();
  const first = D.kind === 'hw' ? D.models[0] : 'serum';
  S.t = await newTrack(first);
  S.color = S.t.color || '#ff9f43';
  const more = (D.kind === 'hw' ? D.models.slice(1) : []).concat(D.serums === 2 ? ['serum'] : []).concat(D.hw || []);
  try { A.cv.touch(false); } catch (e) { /* older hooks */ } // (the touch soft caps' notices and confirms: CPU, not rendering)
  try { for (const m of more) { A.cv.add(m, null); await sleep(300); } } finally { try { A.cv.touch(null); } catch (e) { /* older hooks */ } }
  if (more.length) { A.cv.tidy(); await mounted(); }
  S.sdevs = Object.keys(S.t.dev).filter(k => S.t.dev[k] && S.t.dev[k].kind === 'synth' && S.t.dev[k].model === 'serum').sort();
  for (const dev of S.sdevs) sxSetup(S.t, dev, D.parts || 'full');
  if (D.fx4 || D.parts === 'full') for (const dev of S.sdevs) addEffects(dev + '/fx', 4);
  await sleep(200);
  // the knobs the real rows modulate: a Serum's (in its mounted parts), a hardware panel's ([data-dest] in its module)
  const hwDevs = Object.keys(S.t.dev).filter(k => S.t.dev[k] && S.t.dev[k].kind === 'synth' && S.t.dev[k].model !== 'serum').sort();
  const hwDests = [];
  for (const k of hwDevs) { const el = A.W.el.querySelector('[data-cv-mod="' + k + '"]'); const L = el ? [...new Set([...el.querySelectorAll('[data-dest]')].map(e => e.getAttribute('data-dest')))] : []; hwDests.push(...L.filter((_, i) => i % 7 === 3).slice(0, 4).map(d => k + ':' + d)); }
  const SX = ['a.pan', 'f.res', 'a.fine', 'f.drive', 'a.warp', 'f.mix', 'a.level', 'a.det', 'a.crs', 'a.semi', 'b.pan', 'f2.res'];
  S.dests = D.kind === 'sx' || D.parts === 'complete' && !D.hw ? SX.map(d => 'i1:' + d)
    : D.serums === 2 ? SX.map((d, i) => (i % 2 ? 'i2:' : 'i1:') + d) : D.hw ? SX.slice(0, 6).map(d => 'i1:' + d).concat(hwDests) : SX.map(d => 'i1:' + d);
  if (D.kind !== 'hw' || D.slots) realMods(S, D.kind === 'hw' ? hwDests : null);
  await play(S);
  // what the scene hides: the bundled Serums of a parts scene; the real 2b modules where the Serum-faithful ones stand
  const hideKeys = [];
  if (D.kind === 'parts') hideKeys.push(...S.sdevs);
  if (D.slots) hideKeys.push(...Object.values(S.real || {}));
  const P = A.api.project();
  if (D.kind === 'hw' && P.perf && P.perf.wheel && !S.placedWheel) hideKeys.push('wheel'); // (a wheel the user's project has)
  hideApp(S, hideKeys);
  // the app's own layout for the modules it keeps (lay; the view re-syncs), then ours beside them
  if (D.kind === 'parts') {
    for (const dev of S.sdevs) serumParts(S, dev, D.parts);
  }
  if (D.slots) slotMods(S);
  A.cv.render();
  await raf(); await raf(); await sleep(250);
  // positions
  let bottom = 0, right = 0;
  if (D.kind === 'parts') {
    let y0 = 0;
    for (const dev of S.sdevs) {
      const g = k => byKey(S, dev + '/' + k);
      const full = !!g('oscB');
      // Serum's own order, left to right: the oscillators side by side, SUB / NOISE, the filters, VOICE (+ ENV 2), the LFOs and
      // MACROS; the ARP under the oscillators (the scene stays about 5 k × 1.7 k world px: fitted near 25 %)
      const cols = full ? [[g('oscA')], [g('oscB')], [g('oscC')], [g('sub'), g('noise')], [g('filter1'), g('filter2')], [g('voice'), g('env2')], [g('lfo1'), g('lfo2'), g('macros')]]
        : [[g('oscA')], [g('filter1')], [g('voice')]];
      const c = columns(cols, 0, y0);
      let yb = c.bottom;
      if (g('arp')) {
        const ob = Math.max(...['oscA', 'oscB', 'oscC', 'sub', 'noise'].map(g).filter(Boolean).map(r => r.m.y + rectH(r)));
        const ya = gup(ob + VGAP);
        g('arp').m.setPos(0, ya, false); yb = Math.max(yb, gup(ya + rectH(g('arp')) + VGAP));
      }
      setLay(S.t, dev + '/fx', c.x, y0);
      const fxm = appMod(dev + '/fx'), fxw = fxm ? fxm.w : 760;
      right = Math.max(right, gup(c.x + fxw + HGAP));
      y0 = gup(Math.max(yb, y0 + (fxm ? fxm.rect().h : 600) + VGAP) + 96);
    }
    bottom = y0;
    setLay(S.t, 'out', right, 0);
    if (D.hw) { // t3: the hardware panels below the parts
      let y = bottom;
      for (const k of Object.keys(S.t.dev).filter(k => S.t.dev[k] && S.t.dev[k].kind === 'synth' && S.t.dev[k].model !== 'serum').sort()) { setLay(S.t, k, 0, y); const m = appMod(k); y = gup(y + (m ? m.rect().h : 800) + VGAP); }
    }
    // the visible real modulators: the column left of the parts
    let ym = 0, xm = -320;
    const hMax = Math.max(900, bottom);
    for (const k of Object.values(S.real || {})) if (!S.hide.has(k)) { const m = appMod(k), hh = m ? m.rect().h : 240; if (ym && ym + hh > hMax) { ym = 0; xm -= 320; } setLay(S.t, k, xm, ym); ym = gup(ym + hh + VGAP); }
  }
  if (D.kind === 'hw' && A.cv.view()) for (const [k, m] of A.cv.view().modules) if (!S.hide.has(k)) { const r = m.rect(); bottom = Math.max(bottom, r.y + r.h); }
  if (D.slots) { // the Serum-faithful modulators: their own left-growing column (right edges at −MOD_GAP)
    let y = 0, edge = -MOD_GAP, colW = 0;
    const hMax = Math.max(1100, bottom);
    for (const r of S.mods.filter(x => x.slot)) {
      const w = r.m.w, hh = rectH(r);
      if (y && y + hh > hMax) { y = 0; edge -= colW + HGAP; colW = 0; }
      r.m.setPos(Math.floor((edge - w) / 32) * 32, y, false); y = gup(y + hh + VGAP); colW = Math.max(colW, w);
    }
  }
  A.cv.render();
  await raf(); await sleep(200);
  for (const r of S.mods) A.W.update(r.m.id);
  // the hidden app modules leave the world's registry (off screen first: their displays and monitors sleep; the minimap and
  // the screen plan see the scene only)
  for (const k of S.hide) { const m = appMod(k); if (m) { try { m.onScreen(false); } catch (e) { /* gone */ } A.W.remove(k); try { A.mod.WK.releaseCanvases(m.el); } catch (e) { /* gone */ } } }
  // the scene's stylesheet: what it hides; ours: the part roots' container (not Serum's 1200 px width queries: lane B's sxp)
  S.style = A.doc.createElement('style');
  S.style.textContent = [...S.hide].map(k => '#world > [data-cv-mod="' + k + '"]').concat(['#world > svg.cv-cables', '#world > svg.cv-cable-ends', '#world > .cv-mbadge'].filter(() => D.kind !== 'sx')).join(',\n')
    + (S.hide.size || D.kind !== 'sx' ? ' { display: none !important; }\n' : '\n')
    + '.m3-part.sx-root { container-name: m3p; margin: 0 auto; }\n';
  A.doc.head.append(S.style);
  S.hiddenEl = m => { const k = m.getAttribute('data-cv-mod'); return S.hide.has(k); };
  // cables: a layer of our own (in a container with no stacking context of its own: the app's z-order holds)
  if (D.kind !== 'sx') {
    S.layer = A.doc.createElement('div'); S.layer.className = 'm3-cables'; S.layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0';
    A.W.el.append(S.layer);
    S.cab = A.mod.CAB.createCables(S.layer, { doc: A.doc, k: () => A.W.k, mods: 'always' });
    S.cables = sceneCables(S);
    S.cab.set(S.cables);
    sceneLayout(S);
    S.offs.push(A.W.on('cameraend', () => S.cab.rezoom()));
  }
  // the camera: the scene fitted (the modules it shows)
  S.fit = [...S.mods.map(r => r.m.id), ...(A.cv.view() ? [...A.cv.view().modules.keys()].filter(k => !S.hide.has(k)) : [])];
  for (let i = 0; i < 40; i++) { if (S.mods.every(r => r.view)) break; await raf(); }
  await sleep(400);
  if (D.kind !== 'sx') sceneLayout(S);
  // the part of the scene the self-check, M4 and the hand test look at: ours (the parts with their own FX, the modulators),
  // else the whole scene
  S.focus = S.mods.length ? S.mods.map(r => r.m.id).concat(S.sdevs.map(d => d + '/fx').filter(k => D.kind === 'parts' && !S.hide.has(k))) : S.fit;
  A.W.fit({ ids: S.fit, animate: false });
  await sleep(500);
  S.info = sceneInfo(S);
  S.info.buildMs = Math.round(now() - tb);
  S.t0 = now();
  return S;
}
async function teardown(S) {
  if (!S) return;
  stopPlay();
  for (const f of S.offs.splice(0)) { try { f(); } catch (e) { console.error(e); } }
  for (const r of S.mods) {
    try { A.W.remove(r.m.id); } catch (e) { /* gone */ }
    if (r.view) { for (const f of r.view.offs) f(); const x = r.view.made; if (x && typeof x.destroy === 'function') { try { x.destroy(); } catch (e) { /* gone */ } } for (const ed of r.view.page.editors) if (ed && ed.destroy) { try { ed.destroy(); } catch (e) { /* gone */ } } }
    try { r.m.destroy(); } catch (e) { /* gone */ }
    r.m.el.remove();
  }
  for (const H of S.hosts) { try { H.ui.destroy(); } catch (e) { console.error(e); } }
  if (S.cab) S.cab.destroy();
  if (S.layer) S.layer.remove();
  if (S.style) S.style.remove();
  if (S.policy) S.policy.remove();
  A.mon.still = false;
  if (S.placedWheel) { try { A.cv.mod.del('wheel', true); } catch (e) { console.error(e); } }
  const t = A.api.project().tracks.find(x => x.id === S.t.id);
  if (t) { t.notes = []; try { A.api.deleteTrack(t); } catch (e) { console.error(e); } }
  await sleep(300);
  S0.cur = null;
}

/* ------------------------------------------------------------------------------------------------ counts, self-check */
// the scene's modules (ours + the app's it shows): elements, painted elements (a layout box), canvases, Σ stores
function sceneMods(S) {
  const out = [];
  for (const r of S.mods) out.push({ key: r.key, el: r.m.el, group: r.group, slot: r.slot });
  for (const m of A.W.el.querySelectorAll(':scope > .cv-mod[data-cv-mod]')) { const k = m.getAttribute('data-cv-mod'); if (!k.startsWith('m3:') && !S.hide.has(k)) out.push({ key: k, el: m, group: 'app' }); }
  return out;
}
function count(el) {
  let n = 0, vis = 0;
  for (const e of [el, ...el.getElementsByTagName('*')]) { n++; if (e.getClientRects().length) vis++; }
  const cvs = [...el.getElementsByTagName('canvas')];
  return { n, vis, cv: cvs.length, cvVis: cvs.filter(c => c.getClientRects().length).length, bytes: cvs.reduce((s, c) => s + c.width * c.height * 4, 0) };
}
function sceneInfo(S) {
  const groups = {}, mods = sceneMods(S);
  let n = 0, vis = 0, cv = 0, bytes = 0;
  for (const m of mods) {
    const c = count(m.el);
    n += c.n; vis += c.vis; cv += c.cvVis; bytes += c.bytes;
    const g = m.group || 'app';
    const G = groups[g] || (groups[g] = { mods: 0, n: 0, vis: 0, cv: 0 });
    G.mods++; G.n += c.n; G.vis += c.vis; G.cv += c.cvVis;
  }
  // the own FX belongs to its Serum's parts group (§1.4: "own FX with 4 effects" is in the budget line)
  for (const dev of S.sdevs || []) {
    const fx = A.W.el.querySelector(':scope > .cv-mod[data-cv-mod="' + dev + '/fx"]'), g = Object.keys(groups).find(k => k.startsWith(dev + ':'));
    if (fx && g && !S.hide.has(dev + '/fx')) { const c = count(fx); groups[g].n += c.n; groups[g].vis += c.vis; groups[g].cv += c.cvVis; groups[g].mods++; groups.app.n -= c.n; groups.app.vis -= c.vis; groups.app.cv -= c.cvVis; groups.app.mods--; }
  }
  const all = [...A.W.el.querySelectorAll('canvas')].reduce((s, c) => s + c.width * c.height * 4, 0);
  const budgets = [];
  for (const [g, G] of Object.entries(groups)) {
    const B = /:complete$/.test(g) ? BUDGET.complete : /:full$/.test(g) ? BUDGET.full : /^slot:/.test(g) ? BUDGET.mod : null;
    if (B) budgets.push({ group: g, vis: G.vis, el: B.el, cv: G.cv, cvMax: B.cv, ok: G.vis <= B.el && G.cv <= B.cv });
  }
  const g = A.W.glStats();
  return { modules: mods.length, elements: n, painted: vis, canvases: cv, canvasMB: r1(bytes / MiB), canvasMBall: r1(all / MiB), world: A.W.el.getElementsByTagName('*').length,
    glMB: g ? r1((g.bytes || 0) / MiB) : null, faces: g ? g.faces : null,
    groups, budgets, k: r3(A.W.k), gl: A.W.glStats() ? 'gl' : '2d', ports: S.ports || 0, cables: (S.cables || []).length, rows: (S.rows || []).length };
}
// idle with the audio running: every live display repaints at ≥ 0.8 × the snapshot rate; §1.4's counts; no console error
async function selfCheck(S, ms = 2500) {
  const I = A.win.__m3in, e0 = S.e0, vp = A.W.viewport.getBoundingClientRect();
  const cvs = sceneMods(S).flatMap(m => [...m.el.getElementsByTagName('canvas')].map(c => ({ c, mod: m.key })))
    .filter(x => { const r = x.c.getBoundingClientRect(); return r.width > 2 && r.height > 2 && r.right > vp.left && r.left < vp.right && r.bottom > vp.top && r.top < vp.bottom; });
  const p0 = cvs.map(x => I.paints.get(x.c) || 0), n0 = new Map(A.mon.n);
  const t0 = now();
  await sleep(ms);
  const dt = (now() - t0) / 1000, rates = {};
  for (const [k, v] of A.mon.n) if (k.startsWith(S.t.id + ':')) rates[k.slice(S.t.id.length + 1)] = r1((v - (n0.get(k) || 0)) / dt);
  const ref = Math.max(0, ...Object.values(rates));
  const live = [], slow = [];
  cvs.forEach((x, i) => {
    const n = (I.paints.get(x.c) || 0) - p0[i], hz = n / dt, ratio = ref > 0 ? hz / ref : 0;
    if (ratio < 0.2) return;
    const row = { mod: x.mod, cls: String(x.c.className || '').slice(0, 40), hz: r1(hz), ratio: r2(ratio) };
    live.push(row);
    if (ratio < 0.8) slow.push(row);
  });
  const errors = I.errs.slice(e0);
  const budgets = sceneInfo(S).budgets, over = budgets.filter(b => !b.ok);
  const ok = !slow.length && !errors.length && !over.length;
  return { ok, rates, ref, mcx: S.mcx || 0, onScreen: cvs.length, live: live.length, slow, liveList: live.slice(0, 40), errors: errors.slice(0, 8), over, why: [slow.length ? slow.length + ' slow displays' : '', errors.length ? errors.length + ' console errors' : '', over.length ? 'over budget: ' + over.map(b => b.group).join(', ') : ''].filter(Boolean).join('; ') };
}

/* ------------------------------------------------------------------------------------------------ frames */
// rAF intervals (the iframe's frames), the bursts (movestart … cameraend), input-to-frame (pointermove → the next frame's
// script), the k range and visualViewport.scale (the page and the frame), until stop()
function recorder() {
  const { win, W } = A, I = win.__m3in, R = { f: [], ev: [], lat: [], disp: [], cams: [], kMin: W.k, kMax: W.k, vv: [1, 1], touchMax: 0, t0: now() };
  let last = -1, on = true;
  I.on = true; I.q.length = 0; I.maxT = I.touches;
  const vvOf = w => (w.visualViewport ? w.visualViewport.scale : 1);
  const tick = t => {
    if (last >= 0) R.f.push(t - last, t);
    last = t;
    if (I.q.length) { const n = now(); for (let j = 0; j < I.q.length; j += 2) { R.lat.push(n - I.q[j]); R.disp.push(n - I.q[j + 1]); } I.q.length = 0; }
    const v = Math.max(vvOf(window), vvOf(win)), v0 = Math.min(vvOf(window), vvOf(win));
    if (v > R.vv[1]) R.vv[1] = v; if (v0 < R.vv[0]) R.vv[0] = v0;
    if (on) win.requestAnimationFrame(tick);
  };
  win.requestAnimationFrame(tick);
  const offs = [W.on('movestart', () => { R.ev.push(1, now(), W.k); I.maxT = I.touches; }), W.on('cameraend', d => { R.ev.push(2, now(), W.k, I.maxT); }),
    W.on('camera', c => { R.cams.push(now()); if (c.k < R.kMin) R.kMin = c.k; if (c.k > R.kMax) R.kMax = c.k; })];
  return { R, stop() { on = false; I.on = false; for (const f of offs) f(); R.t1 = now(); return R; } };
}
// the frames of [a, b] by phase: burst (movestart … cameraend, its first 100 ms apart: firstMove), settle (800 ms after a
// cameraend), rest; per burst the first-move and settle maxima and their > 33 ms counts
function analyse(R, a = -Infinity, b = Infinity) {
  const bursts = [];
  for (let i = 0; i < R.ev.length;) {
    const type = R.ev[i], t = R.ev[i + 1], k = R.ev[i + 2];
    if (type === 1) { bursts.push({ s: t, e: Infinity, k0: k, k1: k }); i += 3; } else { const B = bursts[bursts.length - 1]; if (B && B.e === Infinity) { B.e = t; B.k1 = k; B.touches = R.ev[i + 3]; } i += 4; }
  }
  const inB = bursts.filter(B => B.e > a && B.s < b);
  const burst = [], first = [], settle = [], rest = [];
  for (const B of inB) { B.first = []; B.settle = []; }
  for (let i = 0; i < R.f.length; i += 2) {
    const dt = R.f[i], t = R.f[i + 1];
    if (t < a || t > b) continue;
    let cls = 'rest';
    for (const B of inB) {
      if (t > B.s && t <= B.s + 100) { cls = 'first'; B.first.push(dt); break; }
      if (t > B.s && t <= B.e) { cls = 'burst'; break; }
      if (t > B.e && t <= B.e + 800) { cls = 'settle'; B.settle.push(dt); }
    }
    (cls === 'first' ? first : cls === 'burst' ? burst : cls === 'settle' ? settle : rest).push(dt);
  }
  const mx = L => (L.length ? r1(Math.max(...L)) : 0);
  const lat = q(R.lat.filter(x => x >= 0 && x < 1000)), disp = q(R.disp.filter(x => x >= 0 && x < 1000));
  return {
    bursts: inB.length, burst: q(burst), first: { max: mx(first), n: first.length, multi: inB.filter(B => B.first.filter(x => x > 33).length > 1).length, over33: first.filter(x => x > 33).length },
    settle: { max: mx(settle), n: settle.length, multi: inB.filter(B => B.settle.filter(x => x > 33).length > 1).length, over33: settle.filter(x => x > 33).length },
    rest: q(rest), all: q([...burst, ...first, ...settle, ...rest]), lat: { n: lat.n, med: lat.med, p95: lat.p95, dispMed: disp.med, dispP95: disp.p95 },
  };
}
// §1.5's pass criteria: P (opt-in) and P+ (on by default)
function verdict(a, o = {}) {
  const lat = a.lat && a.lat.n ? a.lat.p95 : 0, mb = o.mb || 0, lost = !!o.lost, nb = a.burst.n > 0;
  const P = nb && a.burst.med <= 17.5 && a.burst.p95 <= 25 && a.burst.max <= 50 && a.first.max <= 100 && a.settle.max <= 100 && lat <= 40 && !lost && mb <= 64;
  const Pp = P && a.burst.med <= 17.0 && a.burst.p95 <= 20 && a.burst.max <= 33 && a.first.max <= 80 && a.settle.max <= 80 && !a.first.multi && !a.settle.multi && lat <= 33;
  return !nb ? 'no bursts' : Pp ? 'P+' : P ? 'P' : 'fail';
}
async function drive(kind, ms, F = 1.6) { // pan: a 300 px sine sweep; zoom: in to F× and back out, about the band's centre
  const { W, doc } = A, vp = doc.querySelector('#viewport').getBoundingClientRect(), cx = vp.left + vp.width / 2, cy = vp.top + vp.height / 2;
  const t0 = now(); let lastX = 0, lastK = 1;
  while (now() - t0 < ms) {
    await raf();
    const ph = (now() - t0) / ms * 2 * Math.PI;
    if (kind === 'pan') { const x = 300 * Math.sin(ph); W.panBy(x - lastX, 0); lastX = x; }
    else { const k = Math.pow(F, 0.5 - 0.5 * Math.cos(ph)); W.zoomAt(k / lastK, cx, cy); lastK = k; }
  }
}
// M0: the 1h phases at the fitted camera (+ firstMove / settle / burstMax), the GL draws per phase
async function m0(S, short) {
  A.W.fit({ ids: S.fit, animate: false }); await sleep(400);
  const rec = recorder(), win = [], out = {};
  const phase = async (name, run) => { const a = now(); try { A.W.glStats(true); } catch (e) { /* 2D */ } await run(); win.push([name, a, now()]); const g = A.W.glStats(); if (g) out['gl:' + name] = { n: g.frames, mean: g.frames ? r3(g.ms / g.frames) : 0, max: r2(g.max) }; };
  if (!short) await phase('idle', () => sleep(1000));
  await phase('pan', () => drive('pan', 2000));
  if (!short) await phase('zoom', () => drive('zoom', 2000));
  await phase('settle', () => sleep(900));
  await phase('deep', () => drive('zoom', 3000, 4));
  await phase('deepSettle', () => sleep(900));
  const R = rec.stop();
  for (const [name, a, b] of win) { const x = analyse(R, a, b); out[name] = Object.assign(x.all, { burstMax: x.burst.max, firstMove: x.first.max, settle: x.settle.max, bursts: x.bursts }); delete out[name].over50; }
  const tot = analyse(R);
  out.total = { burst: tot.burst, first: tot.first, settle: tot.settle, verdict: verdict(tot, { mb: S.info.canvasMB }) };
  return out;
}
// M2: the policies, scripted (the same M0 phases) — a stylesheet each; 'still' drops the monitors' deliveries in bursts
async function m2(S) {
  const out = {};
  for (const [name, css] of Object.entries(POLICIES)) {
    say('M2 ' + S.id + ' · ' + name);
    S.policy = A.doc.createElement('style'); S.policy.textContent = css; A.doc.head.append(S.policy);
    A.mon.still = name === 'still'; A.mon.dropped = 0;
    await sleep(500);
    const r = await m0(S, true);
    out[name] = { pan: pick(r.pan), deep: pick(r.deep), settle: r.settle.max, deepSettle: r.deepSettle.max, verdict: r.total.verdict, dropped: A.mon.dropped };
    S.policy.remove(); S.policy = null; A.mon.still = false;
    await sleep(300);
  }
  return out;
}
const pick = x => ({ med: x.med, p95: x.p95, max: x.max, over33: x.over33, firstMove: x.firstMove, settle: x.settle });
// M4: the displays' density at k 0.25 … 2 with today's rule and H5: min on screen, Σ stores on / off screen; faces' soft count
async function m4(S) {
  A.W.fit({ ids: S.focus, animate: false }); await sleep(300);
  const out = { today: {}, h5: {} }, cam0 = A.W.cam, vp = A.W.viewport.getBoundingClientRect(), dpr = A.win.devicePixelRatio || 1;
  // zoomed about the scene's biggest display on screen (else the view's centre): every k has displays to measure
  let anchor = A.W.toWorld(vp.left + vp.width / 2, vp.top + vp.height / 2), big = 0;
  for (const m of sceneMods(S)) for (const c of m.el.getElementsByTagName('canvas')) {
    const r = c.getBoundingClientRect();
    if (r.width * r.height > big && r.left >= vp.left && r.right <= vp.right && r.top >= vp.top && r.bottom <= vp.bottom) { big = r.width * r.height; anchor = A.W.toWorld(r.left + r.width / 2, r.top + r.height / 2); }
  }
  out.anchor = big ? 'display' : 'centre';
  for (const rule of ['today', 'h5']) {
    if (rule === 'h5' && !A.h5.ok) { out.h5 = null; continue; }
    setH5(rule === 'h5');
    for (const k of [0.25, 0.5, 1, 1.5, 2]) {
      A.W.setCamera({ tx: vp.width / 2 - anchor.x * k, ty: vp.height / 2 - anchor.y * k, k });
      await sleep(80); await raf(); await raf(); await sleep(120);
      let onMin = Infinity, n = 0, on = 0, off = 0, bytes = 0, bytesOn = 0, below = 0;
      const worst = [];
      for (const m of sceneMods(S)) for (const c of m.el.getElementsByTagName('canvas')) {
        const r = c.getBoundingClientRect(), b = c.width * c.height * 4;
        bytes += b;
        if (!(r.width > 2 && r.height > 2)) continue;
        n++;
        const isOn = r.right > vp.left && r.left < vp.right && r.bottom > vp.top && r.top < vp.bottom;
        if (!isOn) { off++; continue; }
        on++; bytesOn += b;
        const d = c.width / (r.width * dpr);
        if (d < onMin) onMin = d;
        if (d < 0.99) { below++; if (worst.length < 4) worst.push(m.key + ' ' + r2(d)); }
      }
      const g = A.W.glStats();
      out[rule][k] = { onMin: onMin === Infinity ? null : r3(onMin), n, on, off, below, mb: r1(bytes / MiB), mbOn: r1(bytesOn / MiB), worst, soft: g ? g.soft : null, faceMB: g ? r1((g.faceBytes || 0) / MiB) : null, drops: rule === 'h5' ? A.h5.state.drops : 0 };
    }
  }
  setH5(H5ON);
  A.W.setCamera(cam0); await sleep(300);
  return out;
}
// M5: a 60 s k-sweep (0.25 ↔ 2, with a pan) — frames, texture and store bytes; the heartbeat says where a lost tab died
async function m5(S, ms = 60000) {
  const { W, doc } = A, vp = doc.querySelector('#viewport').getBoundingClientRect(), cx = vp.left + vp.width / 2, cy = vp.top + vp.height / 2;
  const rec = recorder(), t0 = now(); let lastK = W.k, lastX = 0, glMax = 0, cvMax = 0;
  A.W.setCamera({ tx: W.cam.tx, ty: W.cam.ty, k: 1 }); await sleep(200); lastK = W.k;
  while (now() - t0 < ms) {
    await raf();
    const t = (now() - t0) / 1000, k = 0.25 * Math.pow(8, 0.5 - 0.5 * Math.cos(2 * Math.PI * t / 7.5)), x = 160 * Math.sin(2 * Math.PI * t / 5);
    W.zoomAt(k / lastK, cx, cy); lastK = k; W.panBy(x - lastX, 0); lastX = x;
    if ((t | 0) !== ((t - 0.02) | 0)) { heartbeat('m5 ' + S.id + ' ' + (t | 0) + ' s'); const g = W.glStats(); if (g) glMax = Math.max(glMax, g.bytes || 0); cvMax = Math.max(cvMax, A.h5.state.bytes || 0); }
  }
  await sleep(1200);
  const R = rec.stop(), a = analyse(R), info = sceneInfo(S), g = W.glStats();
  return { ms, frames: a.all, burst: a.burst, glMB: r1(glMax / MiB), h5MB: r1(cvMax / MiB), glNowMB: g ? r1((g.bytes || 0) / MiB) : null, canvasMB: info.canvasMB, canvasMBall: info.canvasMBall, elements: info.elements, painted: info.painted };
}
function heartbeat(phase) { LS.set('m3.hb', { phase, mode: MODE, t: Date.now() }); }

/* ------------------------------------------------------------------------------------------------ probes */
// P1: SVG <foreignObject> → Image → canvas: taints (getImageData) / uploads (texImage2D)? (blob and data URLs)
async function probeP1() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="font:600 18px -apple-system,sans-serif;color:#fff;background:#2f6fd6;padding:8px">LEVEL 0.50 · Serum</div></foreignObject></svg>';
  const one = async url => {
    const r = { loaded: false, drawn: false, tainted: null, gl: null };
    try {
      const img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('image error')); img.src = url; });
      r.loaded = true;
      const c = document.createElement('canvas'); c.width = 240; c.height = 80;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0); r.drawn = true;
      try { const d = g.getImageData(10, 10, 1, 1).data; r.tainted = false; r.px = [d[0], d[1], d[2], d[3]]; } catch (e) { r.tainted = true; r.err = e.name; }
      const gl = document.createElement('canvas').getContext('webgl2');
      if (gl) { try { const tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tx); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c); r.gl = gl.getError() === 0 ? 'ok' : 'error ' + gl.getError(); } catch (e) { r.gl = e.name; } }
    } catch (e) { r.err = String(e.message || e); }
    return r;
  };
  const blob = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const out = { blob: await one(blob), data: await one('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)) };
  URL.revokeObjectURL(blob);
  return out;
}
// P2: OffscreenCanvas 2D + FontFace (Inter from its file, as the page loads it) in a Worker: 4 Mpx of text, the bitmap
// transferred and uploaded (texImage2D)
async function probeP2() {
  const out = { worker: false };
  let font = null;
  try {
    const css = await (await fetch('https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap')).text();
    const u = (/url\((https:[^)]+)\)/.exec(css) || [])[1];
    if (u) font = await (await fetch(u)).arrayBuffer();
  } catch (e) { out.fontFetch = String(e.message || e); }
  const code = `onmessage = async e => {
    const r = { offscreen: typeof OffscreenCanvas === 'function', font: 'none' }, t0 = performance.now();
    try { if (e.data.font && typeof FontFace === 'function' && self.fonts) { const f = new FontFace('M3Inter', e.data.font); await f.load(); self.fonts.add(f); r.font = 'loaded'; } } catch (err) { r.font = 'error: ' + err.message; }
    r.fontMs = performance.now() - t0;
    if (!r.offscreen) { postMessage(r); return; }
    const W = 2000, H = 2000, c = new OffscreenCanvas(W, H), g = c.getContext('2d');
    if (!g) { r.ctx = false; postMessage(r); return; }
    const t1 = performance.now(); let n = 0;
    g.fillStyle = '#101216'; g.fillRect(0, 0, W, H); g.fillStyle = '#e6e6e6'; g.font = '500 13px ' + (r.font === 'loaded' ? 'M3Inter' : 'sans-serif');
    for (let y = 14; y < H; y += 16) for (let x = 4; x < W; x += 124) { g.fillText('LEVEL 0.50 dB', x, y); n++; }
    r.paintMs = performance.now() - t1; r.strings = n;
    const t2 = performance.now(), bmp = c.transferToImageBitmap(); r.bmpMs = performance.now() - t2;
    r.bmp = bmp; postMessage(r, [bmp]);
  };`;
  try {
    const w = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    out.worker = true;
    const r = await new Promise((ok, no) => { w.onmessage = e => ok(e.data); w.onerror = e => no(new Error(e.message || 'worker error')); w.postMessage({ font }, font ? [font] : []); setTimeout(() => no(new Error('timeout')), 20000); });
    w.terminate();
    Object.assign(out, { offscreen: r.offscreen, font: r.font, fontMs: r1(r.fontMs || 0), paintMs: r1(r.paintMs || 0), strings: r.strings, bmpMs: r1(r.bmpMs || 0) });
    if (r.bmp) {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (gl) { const t = performance.now(), tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tx); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, r.bmp); gl.finish(); out.uploadMs = r1(performance.now() - t); out.gl = gl.getError() === 0 ? 'ok' : 'error'; gl.deleteTexture(tx); }
      r.bmp.close();
    }
  } catch (e) { out.err = String(e.message || e); }
  return out;
}

/* ------------------------------------------------------------------------------------------------ results */
const RES_KEY = 'm3.res';
function results() { return LS.get(RES_KEY, null) || {}; }
function saveResult(part, data) { const R = results(); R[part] = data; R.kind = 'ui-m3'; if (!LS.set(RES_KEY, R)) say('Could not keep the results on this device (storage full?) — copy them now'); return R; }
function merged() {
  const R = results(), last = R.hold || R.hand || R.auto || {};
  const out = Object.assign({ kind: 'ui-m3', v: 1 }, last.env || {}, { valid: validity(R) }, R);
  delete out.env;
  return out;
}
// §1.5: a run counts when hw5 first and last land in the envelope (M1: median ≤ 17.5, firstMove / settle ≤ 80, the last
// burst median within 1.0 ms of the first), every scene passed its self-check, visualViewport.scale stayed 1, nothing was lost
function validity(R) {
  const v = { notes: [] };
  const env = a => a && a.burst.med <= 17.5 && a.first.max <= 80 && a.settle.max <= 80;
  if (R.hand && R.hand.scenes) {
    const h = R.hand.scenes, A1 = h['hw5'] && h['hw5'].a, A2 = h['hw5#2'] && h['hw5#2'].a;
    v.hw5First = !!env(A1); v.hw5Last = !!env(A2); v.drift = A1 && A2 ? r1(A2.burst.med - A1.burst.med) : null;
    v.vvScale1 = Object.values(h).every(x => !x.vv || (x.vv[0] > 0.99 && x.vv[1] < 1.01));
    v.hand = v.hw5First && v.hw5Last && v.drift != null && Math.abs(v.drift) <= 1.0 && v.vvScale1;
  }
  if (R.auto && R.auto.scenes) {
    v.selfChecks = Object.entries(R.auto.scenes).every(([, s]) => s.self && s.self.ok);
    if (!v.selfChecks) v.notes.push('self-check failed: ' + Object.entries(R.auto.scenes).filter(([, s]) => !(s.self && s.self.ok)).map(([k, s]) => k + ' (' + (s.self ? s.self.why : 'none') + ')').join(', '));
  }
  if (R.lost && R.lost.length) v.notes.push('tab lost: ' + R.lost.map(x => x.phase).join(', '));
  const parts = [R.auto, R.hand, R.hold].filter(x => x && x.env);
  v.stale = parts.some(x => x.env.stale);
  v.builds = [...new Set(parts.map(x => x.env.build))];
  if (v.stale) v.notes.push('a part ran on an older build than the deployed one');
  if (v.builds.length > 1) v.notes.push('the parts ran on different builds: ' + v.builds.join(', '));
  v.hold = R.hold ? 'diff on the Mac (?m3=1&diff=1)' : null;
  return v;
}
function copyBox(parent) {
  const row = h('div', 'm3-row'), b = h('button', '', 'Copy results'), out = h('textarea'); out.id = 'm3out'; out.readOnly = true;
  b.onclick = async () => { const t = JSON.stringify(merged()); out.value = t; try { await navigator.clipboard.writeText(t); say('Copied — paste it into the chat'); } catch (e) { out.select(); say('Select the text below and copy it'); } };
  const clr = h('button', '', 'Clear stored results'); clr.onclick = () => { if (confirm('Clear the results kept on this device?')) { LS.del(RES_KEY); say('Cleared'); out.value = ''; } };
  row.append(b, clr); parent.append(row, out);
  out.value = JSON.stringify(merged());
  return out;
}

/* ------------------------------------------------------------------------------------------------ the three pages */
let B = null; // build info
async function header(steps, nowIdx) {
  const top = h('div', 'm3-top');
  top.append(h('h1', '', 'SYNTH Canvas — milestone 3 rendering test (S0)'));
  const bl = h('p', 'm3-note', 'Checking which app build this page measures…'); top.append(bl);
  if (steps) { const ol = h('ol', 'm3-steps'); steps.forEach((s, i) => { const li = h('li', i === nowIdx ? 'now' : '', s); ol.append(li); }); top.append(ol); }
  const row = h('div', 'm3-row'), st = h('span'); st.id = 'm3status'; row.append(st); top.append(row);
  document.body.append(top);
  B = await buildInfo();
  bl.textContent = 'Measuring ' + B.note + (B.files ? ' (build ' + B.files + ')' : '') + '.' + (B.stale ? ' A newer build (' + B.deployed + ') is deployed — apply it first.' : '');
  if (B.stale) { bl.className = 'bad'; const b = h('button', '', 'Apply update'); b.onclick = () => applyUpdate(b); bl.append(' ', b); }
  // a tab the OS closed mid-run (the heartbeat is still there): reported once, kept with the results
  const hb = LS.get('m3.hb', null);
  if (hb && hb.phase) { const R = results(); R.lost = (R.lost || []).concat([{ phase: hb.phase, mode: hb.mode, at: new Date(hb.t).toISOString() }]); LS.set(RES_KEY, R); LS.del('m3.hb'); const w = h('p', 'bad', 'The last run stopped without finishing (during “' + hb.phase + '”): the tab was probably closed by iPadOS. It is noted in the results.'); top.append(w); }
  return { top, row };
}
const STEPS = ['Automatic runs (≈ 10 min, hands off)', 'Hand test (≈ 10 min: pinch and pan as the bar says)', 'Screenshots (≈ 5 min: three screenshots, twice)'];
function frameEl(full) {
  const f = h('iframe'); f.id = 'm3frame'; f.title = 'SYNTH Canvas';
  f.style.height = full ? 'calc(100% - 104px)' : Math.max(420, innerHeight - 250) + 'px';
  if (full) { f.style.position = 'fixed'; f.style.left = '0'; f.style.top = '0'; }
  return f;
}
async function cover(html, label) { // a full-screen prompt whose button is the user gesture (audio)
  const c = h('div', 'm3-cover'), d = h('div'); d.innerHTML = html;
  const b = h('button', 'go', label); d.append(h('br'), b); c.append(d); document.body.append(c);
  if (AUTO) { c.remove(); return; }
  await new Promise(r => { b.onclick = () => { audioOn(); c.remove(); r(); }; });
}
async function ensureAudio() {
  if (AUTO) audioOn();
  for (let i = 0; i < 3 && !audioRunning(); i++) {
    await sleep(1500);
    if (audioRunning()) break;
    if (!AUTO && i < 2) await cover('<p>The sound did not start yet. Tap the button to start it (the test plays a quiet chord loop; the iPad’s silent switch does not matter).</p>', 'Start sound');
  }
  return audioRunning();
}
window.__m3 = { state: 'loading', result: null, A, S0, merged: () => merged() };
// (the CDP harness: the steps by hand)
const FN = () => ({ build, teardown, selfCheck, m0, m2, m4, m5, sceneInfo, probeP1, probeP2, audioOn, setH5 });

// the bottom bar of the three full-frame pages: the zoom on the left, what to do, the buttons
function bottomBar() {
  const bar = h('div', 'm3-bar'), kEl = h('div', 'm3-k', '–'), sayEl = h('div', 'm3-say'), btns = h('div', 'm3-row'), st = h('div', 'm3-sub'); st.id = 'm3status';
  const box = h('div'); box.style.flex = '1'; box.append(sayEl, st);
  bar.append(kEl, box, btns); document.body.append(bar);
  return { bar, kEl, sayEl, btns, st };
}
// the first screen: the three steps, the build this page measures (an update not applied: Apply update), a lost tab
async function intro(stepIdx, extra) {
  const c = h('div', 'm3-cover'), d = h('div');
  d.style.textAlign = 'left';
  d.append(h('h1', '', 'SYNTH Canvas — milestone 3 rendering test'));
  const ol = h('ol', 'm3-steps'); STEPS.forEach((s, i) => ol.append(h('li', i === stepIdx ? 'now' : '', s))); d.append(ol);
  if (extra) { const p = h('p'); p.innerHTML = extra; d.append(p); }
  const bl = h('p', 'm3-note', 'Checking which app build this page measures…'); d.append(bl);
  const b = h('button', 'go', 'Starting the app…'); b.disabled = true; d.append(b);
  c.append(d); document.body.append(c);
  B = await buildInfo();
  bl.textContent = 'Measuring ' + B.note + (B.files ? ' (build ' + B.files + ')' : '') + '.' + (B.stale ? ' A newer build (' + B.deployed + ') is deployed — tap Apply update first.' : '');
  if (B.stale) { bl.className = 'bad'; const u = h('button', '', 'Apply update'); u.onclick = () => applyUpdate(u); bl.append(' ', u); }
  const hb = LS.get('m3.hb', null);
  if (hb && hb.phase) {
    const R = results(); R.lost = (R.lost || []).concat([{ phase: hb.phase, mode: hb.mode, at: new Date(hb.t).toISOString() }]); LS.set(RES_KEY, R); LS.del('m3.hb');
    d.insertBefore(h('p', 'bad', 'The last run stopped without finishing (during “' + hb.phase + '”): iPadOS probably closed the tab. That is noted in the results; carry on.'), b);
  }
  return { c, b, ready(label) { b.textContent = label; b.disabled = false; return new Promise(r => { b.onclick = () => { audioOn(); c.remove(); r(); }; if (AUTO) { c.remove(); r(); } }); } };
}
function resultsPanel(btns) { // a Results button: the summary table and Copy results over the frame
  const pan = h('div', 'm3-cover'), box = h('div', 'm3-res'); box.style.cssText = 'max-width:none;width:100%;max-height:100%;overflow:auto;text-align:left;background:#0d0e11;border-radius:12px';
  const tbl = h('div'), close = h('button', '', 'Close'); close.onclick = () => { pan.hidden = true; };
  box.append(close, tbl); copyBox(box); pan.append(box); pan.hidden = true; document.body.append(pan);
  const b = h('button', '', 'Results'); b.onclick = () => { const o = box.querySelector('#m3out'); if (o) o.value = JSON.stringify(merged()); pan.hidden = false; }; btns.append(b);
  return { tbl, show() { pan.hidden = false; } };
}
async function pageAuto() {
  document.body.classList.add('m3-full');
  const frame = frameEl(true); document.body.append(frame);
  const ui = bottomBar(), go = h('button', 'go', 'Start'), p1 = h('button', '', 'P1'), p2 = h('button', '', 'P2'), next = h('a');
  p1.title = 'Probe P1: SVG foreignObject → canvas (taint)'; p2.title = 'Probe P2: OffscreenCanvas text in a Worker';
  next.href = location.pathname + '?m3=1&hand=1' + (H5ON ? '' : '&h5=0'); next.textContent = 'Next: step 2 →'; next.style.cssText = 'color:#8cb8ff;font-weight:600;font-size:18px'; next.hidden = true;
  ui.btns.append(go, p1, p2); const RP = resultsPanel(ui.btns); ui.btns.append(next);
  go.disabled = true;
  ui.sayEl.innerHTML = 'Step 1 of 3 — <b>automatic runs</b> (about 10 minutes). Hands off until the bar says Done.';
  const I0 = await intro(0, 'Before you start: <b>plug the iPad in</b>, hold it in <b>landscape</b> for all three steps, close the other apps and keep this tab in front until the end. Your project in the app is not changed: the test works on a copy that is never saved.');
  say('Starting the app…');
  try { await boot(frame); } catch (e) { say('The app did not start: ' + e.message); window.__m3.state = 'error'; return; }
  A.W.on('camera', c => { ui.kEl.textContent = Math.round(c.k * 100) + ' %'; });
  say(A.h5.ok ? '' : 'H5 shim off (' + (A.h5.err || 'h5=0') + ')');
  window.__m3.state = 'ready'; window.__m3.fn = FN();
  p1.onclick = async () => { say('P1…'); const r = await probeP1(); const R = results(); R.probes = Object.assign(R.probes || {}, { p1: r }); LS.set(RES_KEY, R); say('P1: ' + JSON.stringify(r).slice(0, 200)); };
  p2.onclick = async () => { say('P2…'); const r = await probeP2(); const R = results(); R.probes = Object.assign(R.probes || {}, { p2: r }); LS.set(RES_KEY, R); say('P2: ' + JSON.stringify(r).slice(0, 200)); };
  const run = async () => {
    go.disabled = true;
    audioOn(); // (the tap that started this is the gesture)
    const out = { env: envInfo(B), h5: A.h5.ok, h5err: A.h5.err, scenes: {}, m2: {}, m5: null, order: [] };
    out.env.gl = A.W.glStats() ? 'gl' : '2d';
    const hb = setInterval(() => heartbeat('auto ' + (S0.cur ? S0.cur.id : '')), 1000);
    window.__m3.state = 'running';
    try {
      if (!(await ensureAudio())) out.audio = 'not running';
      const order = AUTO_ORDER.filter(id => !ONLY || ONLY.includes(id));
      const seen = {};
      for (let i = 0; i < order.length; i++) {
        const id = order[i], key = seen[id] ? id + '#2' : id; seen[id] = 1;
        ui.sayEl.innerHTML = 'Step 1 of 3 — automatic runs, hands off. Scene ' + (i + 1) + ' of ' + order.length + ': <b>' + SCENES[id].title + '</b>';
        const S = await build(id);
        out.order.push(key);
        say(key + ': self-check…');
        A.W.fit({ ids: S.focus, animate: false });
        await sleep(600);
        const self = await selfCheck(S);
        say(key + ': M0 (scripted pan and zoom)…');
        const r0 = await m0(S);
        say(key + ': M4 (display density)…');
        const r4 = await m4(S);
        out.scenes[key] = { title: S.D.title, info: S.info, self, m0: r0, m4: r4 };
        if (!NO_M2 && M2_SCENES.includes(id) && !out.m2[id]) out.m2[id] = await m2(S);
        if (id === 't2' && !out.m5) { say('M5: a 60 s zoom sweep on t2…'); out.m5 = await m5(S, Q.get('m5ms') ? +Q.get('m5ms') : 60000); }
        const errs = A.win.__m3in.errs.slice(S.e0);
        if (errs.length > self.errors.length) { self.errors = errs.slice(0, 8); self.ok = false; self.why = [self.why, errs.length + ' console errors'].filter(Boolean).join('; '); }
        await teardown(S);
        saveResult('auto', out);
        draw(RP.tbl, out);
      }
      say('Probes P1, P2…');
      out.probes = { p1: await probeP1(), p2: await probeP2() };
      out.blocked = A.blocked; out.dialogs = A.dialogs.slice(0, 12);
      out.done = true;
      saveResult('auto', out);
      draw(RP.tbl, out);
      ui.sayEl.innerHTML = '<b>Step 1 done.</b> Tap <b>Next: step 2</b> (the hand test).';
      say('');
      next.hidden = false;
      window.__m3.result = out; window.__m3.state = 'done';
    } catch (e) {
      console.error(e); say('Stopped: ' + (e && e.message)); out.error = String(e && e.stack || e); saveResult('auto', out); window.__m3.result = out; window.__m3.state = 'error';
      try { await teardown(S0.cur); } catch (x) { /* gone */ }
    } finally { clearInterval(hb); LS.del('m3.hb'); }
  };
  go.onclick = run;
  go.disabled = false;
  if (AUTO) { I0.c.remove(); if (Q.get('norun') !== '1') run(); return; }
  await I0.ready('Start step 1');
  run();
}
function draw(el, out) { // the summary table: per scene M0 (pan / zoom / deep: median, p95, max, firstMove, settle), self-check, counts
  let t = '<table><tr><th>scene</th><th>self-check</th><th>painted el · canvases · MB</th><th>pan med/p95/max</th><th>zoom</th><th>deep</th><th>first / settle max</th><th>M0</th></tr>';
  for (const [k, s] of Object.entries(out.scenes || {})) {
    const m = s.m0, f = x => x ? x.med + ' / ' + x.p95 + ' / ' + x.max : '–';
    t += '<tr><td>' + k + '</td><td class="' + (s.self.ok ? 'ok' : 'bad') + '">' + (s.self.ok ? 'ok' : s.self.why) + '</td><td>' + s.info.painted + ' · ' + s.info.canvases + ' · ' + s.info.canvasMB + '</td><td>' + f(m.pan) + '</td><td>' + f(m.zoom) + '</td><td>' + f(m.deep)
      + '</td><td>' + Math.max(m.pan.firstMove, m.zoom.firstMove, m.deep.firstMove) + ' / ' + Math.max(m.settle.settle, m.deepSettle.settle) + '</td><td>' + m.total.verdict + '</td></tr>';
  }
  t += '</table>';
  for (const [k, v] of Object.entries(out.m2 || {})) {
    t += '<table><tr><th>M2 ' + k + '</th><th>pan med/max</th><th>deep med/max</th><th>first move</th><th>settle</th><th>verdict</th></tr>';
    for (const [p, x] of Object.entries(v)) t += '<tr><td>' + p + '</td><td>' + x.pan.med + ' / ' + x.pan.max + '</td><td>' + x.deep.med + ' / ' + x.deep.max + '</td><td>' + Math.max(x.pan.firstMove, x.deep.firstMove) + '</td><td>' + Math.max(x.settle, x.deepSettle) + '</td><td>' + x.verdict + '</td></tr>';
    t += '</table>';
  }
  if (out.m5) t += '<p>M5 (t2, 60 s sweep): frames ' + out.m5.frames.med + ' / ' + out.m5.frames.p95 + ' / ' + out.m5.frames.max + ' ms · GL ' + out.m5.glMB + ' MB · canvases ' + out.m5.canvasMB + ' MB</p>';
  el.innerHTML = t;
}

/* ---- M1: the hand test */
const PROTOCOL = [
  { id: 'slow', say: 'Pinch out to <b>25 %</b> and back to <b>100 %</b> — <b>slowly</b> (about 1.5 s each way)', kind: 'out' },
  { id: 'medium', say: 'Again: <b>25 %</b> and back to <b>100 %</b> — <b>medium</b> (about 0.7 s each way)', kind: 'out' },
  { id: 'fast', say: 'Again: <b>25 %</b> and back to <b>100 %</b> — <b>fast</b> (about 0.3 s each way)', kind: 'out' },
  { id: 'in1', say: 'Pinch in to <b>200 %</b> and back to <b>100 %</b>', kind: 'in' },
  { id: 'in2', say: 'Once more: <b>200 %</b> and back to <b>100 %</b>', kind: 'in' },
  { id: 'pan2', say: 'Pan with <b>two fingers</b>, three times (any direction)', kind: 'pan2', n: 3 },
  { id: 'pan1', say: 'Pan with <b>one finger</b> on empty canvas (between modules), three times', kind: 'pan1', n: 3 },
  { id: 'knob', say: 'Drag <b>one knob</b> up and down for about 2 seconds', kind: 'knob' },
];
async function pageHand() {
  document.body.classList.add('m3-full');
  const frame = frameEl(true); document.body.append(frame);
  const { kEl, sayEl, btns } = bottomBar();
  const bStart = h('button', 'go', 'Start'), bNext = h('button', '', 'Skip step'), bDone = h('button', '', 'Done');
  btns.append(bStart, bNext, bDone); resultsPanel(btns);
  bStart.disabled = bNext.disabled = bDone.disabled = true;
  sayEl.innerHTML = 'Step 2 of 3 — <b>the hand test</b>. Starting the app…';
  const I0 = await intro(1, 'Seven short scenes. For each, the bar at the bottom says what to do — pinch out to 25 % and back, pinch in to 200 % and back, pan with two fingers and with one, drag a knob — with the zoom shown on the left. Steps tick themselves off; tap <b>Skip step</b> if one does not, <b>Done</b> to end a scene early.');
  try { await boot(frame); } catch (e) { sayEl.textContent = 'The app did not start: ' + e.message; return; }
  A.W.on('camera', c => { kEl.textContent = Math.round(c.k * 100) + ' %'; });
  window.__m3.state = 'ready'; window.__m3.fn = FN();
  await I0.ready('Start step 2');
  await ensureAudio();
  const out = { env: envInfo(B), h5: A.h5.ok, scenes: {}, order: [] };
  out.env.gl = A.W.glStats() ? 'gl' : '2d';
  const order = HAND_ORDER.filter(id => !ONLY || ONLY.includes(id)).slice();
  const hb = setInterval(() => heartbeat('hand ' + (S0.cur ? S0.cur.id : '')), 1000);
  const seen = {};
  for (let i = 0; i < order.length; i++) {
    const id = order[i], key = seen[id] ? id + '#2' : id; seen[id] = 1;
    sayEl.innerHTML = 'Scene ' + (i + 1) + ' of ' + order.length + ': building <b>' + SCENES[id].title + '</b>…';
    bStart.disabled = true; bNext.disabled = true; bDone.disabled = true;
    const S = await build(id);
    out.order.push(key);
    const r = await handScene(S, i, order.length, { sayEl, bStart, bNext, bDone });
    out.scenes[key] = r;
    // §1.5: p1 is hand-tested when p1x fails (the last hw5 stays last)
    if (id === 'p1x' && r.verdict === 'fail' && !order.includes('p1')) order.splice(i + 1, 0, 'p1');
    await teardown(S);
    saveResult('hand', out);
  }
  clearInterval(hb); LS.del('m3.hb');
  out.done = true; out.dialogs = A.dialogs.slice(0, 12); saveResult('hand', out);
  const nx = location.pathname + '?m3=1&hold=1' + (H5ON ? '' : '&h5=0');
  sayEl.innerHTML = 'Step 2 done. ' + Object.entries(out.scenes).map(([k, x]) => k + ' <b>' + x.verdict + '</b>').join(' · ') + ' — <a style="color:#8cb8ff" href="' + nx + '">Next: step 3, the screenshots →</a>';
  bStart.hidden = bNext.hidden = bDone.hidden = true;
  window.__m3.result = out; window.__m3.state = 'done';
}
// one scene of the protocol: the camera at 100 % (t2's knob step at 50 %); the steps tick themselves off (pinches from the
// camera's rests, pans from the touch sequences, the knob from its press); the log keeps each step's bursts (their speed)
async function handScene(S, i, n, ui) {
  const { W } = A, vp = W.viewport.getBoundingClientRect();
  const focus = (k = 1) => { // the focus group's box, its centre in the middle of the canvas
    const rs = S.focus.map(id => W.rectOf(id)).filter(Boolean); if (!rs.length) return;
    const x0 = Math.min(...rs.map(r => r.x)), x1 = Math.max(...rs.map(r => r.x + r.w)), y0 = Math.min(...rs.map(r => r.y)), y1 = Math.max(...rs.map(r => r.y + r.h));
    const cx = (x0 + x1) / 2, cy = Math.min((y0 + y1) / 2, y0 + 400);
    W.setCamera({ tx: vp.width / 2 - cx * k, ty: vp.height / 2 - cy * k, k });
  };
  focus(1);
  await sleep(400);
  ui.sayEl.innerHTML = 'Scene ' + (i + 1) + ' of ' + n + ': <b>' + S.D.title + '</b>. Tap <b>Start</b>, then follow the steps (about 45 s).';
  ui.bStart.disabled = false; ui.bNext.disabled = true; ui.bDone.disabled = true;
  await new Promise(r => { ui.bStart.onclick = r; if (AUTO) r(); });
  ui.bStart.disabled = true; ui.bNext.disabled = false; ui.bDone.disabled = false;
  const rec = recorder(), I = A.win.__m3in, log = [];
  let step = 0, done = false, st = { kMin: W.k, kMax: W.k, n: 0 };
  const show = () => { const P = PROTOCOL[step]; ui.sayEl.innerHTML = '<span class="m3-sub">Scene ' + (i + 1) + '/' + n + ' · step ' + (step + 1) + '/' + PROTOCOL.length + '</span><br>' + (P ? P.say + (P.n ? ' — ' + st.n + ' of ' + P.n : '') : 'All done — finishing…'); };
  let stepT0 = now();
  const advance = why => {
    // the step's bursts: [ms (movestart → the last move: cameraend less the 150 ms idle), k at its start, k at its end]
    const ev = rec.R.ev, bs = [];
    for (let j = 0, cur = null; j < ev.length;) { if (ev[j] === 1) { cur = [ev[j + 1], ev[j + 2]]; j += 3; } else { if (cur && cur[0] >= stepT0) bs.push([Math.round(ev[j + 1] - cur[0] - 150), r2(cur[1]), r2(ev[j + 2])]); cur = null; j += 4; } }
    log.push({ step: PROTOCOL[step].id, why, t: r1((now() - rec.R.t0) / 1000), kMin: r3(st.kMin), kMax: r3(st.kMax), bursts: bs.slice(0, 8) });
    stepT0 = now();
    step++; st = { kMin: W.k, kMax: W.k, n: 0 };
    if (step < PROTOCOL.length && PROTOCOL[step].kind === 'knob') { I.lastKnob = null; if (S.id === 't2') focus(0.5); }
    if (step >= PROTOCOL.length) { done = true; setTimeout(fin, 1500); }
    show();
  };
  const offs = [
    W.on('camera', c => { if (c.k < st.kMin) st.kMin = c.k; if (c.k > st.kMax) st.kMax = c.k; }),
    W.on('cameraend', d => {
      const P = PROTOCOL[step]; if (!P || done) return;
      // a pinch step: out to ≤ 30 % (in to ≥ 180 %) and back to about 100 % (a rest near 100 % starts the step's range anew)
      const k = d.cam.k;
      if (P.kind === 'out' && st.kMin <= 0.3 && k >= 0.9) advance('k');
      else if (P.kind === 'in' && st.kMax >= 1.8 && k <= 1.1) advance('k');
      else if ((P.kind === 'out' || P.kind === 'in') && Math.abs(k - 1) < 0.1) { st.kMin = k; st.kMax = k; }
    }),
  ];
  // pans: touch sequences (first finger down … last up) of one / two fingers that moved the camera and did not zoom it;
  // the knob: a press on a control held and moved for over 0.6 s
  let gSeen = I.gest.length, kAt = W.k;
  const knobT = setInterval(() => {
    const P = PROTOCOL[step], K = I.lastKnob;
    if (P && P.kind === 'knob' && K && K.moves > 10 && K.t1 - K.t0 > 600) { I.lastKnob = null; advance('knob'); return; }
    while (gSeen < I.gest.length) {
      const G = I.gest[gSeen++], C = rec.R.cams;
      let camMoved = false;
      for (let j = C.length - 1; j >= 0 && C[j] > G.t0; j--) if (C[j] <= G.t1 + 100) { camMoved = true; break; }
      if (P && (P.kind === 'pan1' || P.kind === 'pan2') && camMoved && Math.abs(W.k - kAt) < 0.02 && (P.kind === 'pan2' ? G.max === 2 : G.max === 1)) { st.n++; if (st.n >= P.n) advance('pans'); else show(); }
      kAt = W.k;
    }
  }, 200);
  ui.bNext.onclick = () => { if (!done && step < PROTOCOL.length) advance('skipped'); };
  let finish;
  const ended = new Promise(r => { finish = r; });
  function fin() { finish(); }
  ui.bDone.onclick = () => { done = true; fin(); };
  show();
  if (AUTO) window.__m3.hand = { step: () => step, advance, S, n: i + 1 };
  await ended;
  clearInterval(knobT); for (const f of offs) f();
  const R = rec.stop(), a = analyse(R), info = sceneInfo(S);
  const verdictS = verdict(a, { mb: info.canvasMB });
  ui.bNext.disabled = true; ui.bDone.disabled = true;
  return { title: S.D.title, a, verdict: verdictS, kRange: [r3(R.kMin), r3(R.kMax)], vv: [r3(R.vv[0]), r3(R.vv[1])], steps: log, skipped: log.filter(x => x.why === 'skipped').length,
    secs: r1((R.t1 - R.t0) / 1000), info: { painted: info.painted, canvases: info.canvases, canvasMB: info.canvasMB, k: info.k } };
}

/* ---- M3: the rest test */
async function pageHold() {
  document.body.classList.add('m3-full');
  const frame = frameEl(true); document.body.append(frame);
  for (const side of ['left', 'right']) { const m = h('div', 'm3-mark'); m.style[side] = '0'; m.style.top = '0'; document.body.append(m); }
  const { bar, kEl, sayEl, btns, st } = bottomBar();
  const bGo = h('button', 'go', 'Start'); btns.append(bGo); resultsPanel(btns);
  bGo.disabled = true;
  sayEl.innerHTML = 'Step 3 of 3 — <b>screenshots</b>. Starting the app…';
  const I0 = await intro(2, 'The page zooms one scene to 50 % and <b>holds the zoom</b>: take <b>screenshot A</b> while it holds, then <b>B</b> and <b>C</b> after it lets go, when the bar asks (screenshot: the top button and volume up together). Then the same at 150 %. Nothing moves on the canvas meanwhile — please don’t touch it.');
  try { await boot(frame); } catch (e) { sayEl.textContent = 'The app did not start: ' + e.message; return; }
  A.W.on('camera', c => { kEl.textContent = Math.round(c.k * 100) + ' %'; });
  window.__m3.state = 'ready'; window.__m3.fn = FN();
  await I0.ready('Start step 3');
  sayEl.innerHTML = 'Building the scene…';
  const S = await build('p1x');
  const out = { env: envInfo(B), h5: A.h5.ok, holds: [] };
  out.env.gl = A.W.glStats() ? 'gl' : '2d';
  // everything live frozen for the whole run: the transport stopped, the fan-out and the ModCore feed paused, CSS animations
  stopPlay();
  A.mon.freeze = true;
  const M = A.api.monitors, deliver = M.deliver; M.deliver = function () { A.mon.dropped++; };
  const fz = A.doc.createElement('style'); fz.textContent = '#world *, #world *::before, #world *::after { animation-play-state: paused !important; transition: none !important; }'; A.doc.head.append(fz);
  const tap = label => new Promise(r => { bGo.textContent = label; bGo.disabled = false; bGo.onclick = () => { bGo.disabled = true; r(); }; if (AUTO) setTimeout(r, 50); });
  const shotWait = AUTO ? 300 : 0;
  for (const k1 of [0.5, 1.5]) {
    const vp = A.W.viewport.getBoundingClientRect(), voice = byKey(S, 'i1/voice'), r = voice ? voice.m.rect() : { x: 0, y: 0, w: 600, h: 400 };
    const cx = r.x + r.w / 2, cy = r.y + Math.min(r.h, 500) / 2;
    A.W.setCamera({ tx: vp.width / 2 - cx, ty: vp.height / 2 - cy, k: 1 });
    await sleep(800);
    sayEl.innerHTML = 'Hold ' + (out.holds.length + 1) + ' of 2: the page will zoom to <b>' + k1 * 100 + ' %</b> and <b>hold the zoom</b> for 12 s. When the bar turns blue, take <b>screenshot A</b> (top button + volume up).';
    await tap('Zoom and hold');
    // zoom in 8 frames and keep the burst open (a 0.002 px pan every 70 ms)
    const fx = vp.left + vp.width / 2, fy = vp.top + vp.height / 2;
    let last = 1;
    for (let i = 1; i <= 8; i++) { await raf(); const k = Math.pow(k1, i / 8); A.W.zoomAt(k / last, fx, fy); last = k; }
    // on whole device px (the rest's rounding then lands on the very same camera), held open by a ±0.002 px jitter (net 0)
    { const c = A.W.cam, d = A.win.devicePixelRatio || 1; A.W.panBy(Math.round(c.tx * d) / d - c.tx, Math.round(c.ty * d) / d - c.ty); }
    let jit = 1;
    const hold = setInterval(() => { A.W.panBy(0.002 * jit, 0); jit = -jit; }, 70);
    await sleep(300);
    bar.style.background = '#1d4fa8';
    const busy = A.W.busy, camA = A.W.cam, regions = holdRegions(S, frame);
    for (let s = 12; s > 0; s--) { sayEl.innerHTML = '<b>Take screenshot A now</b> (the zoom is held) — ' + s + ' s left'; await sleep(AUTO ? 40 : 1000); }
    if (AUTO) await harnessShot('A' + k1);
    clearInterval(hold);
    if (jit < 0) A.W.panBy(-0.002, 0); // (back on the device-px camera)
    bar.style.background = '';
    sayEl.innerHTML = 'Released — wait…'; await sleep(2000 + shotWait);
    sayEl.innerHTML = 'Take <b>screenshot B</b> now, then tap the button.';
    if (AUTO) await harnessShot('B' + k1);
    await tap('I took B');
    await sleep(1000);
    sayEl.innerHTML = 'Take <b>screenshot C</b> now, then tap the button.';
    if (AUTO) await harnessShot('C' + k1);
    await tap('I took C');
    out.holds.push({ k: k1, busy, camA, cam: A.W.cam, regions });
    saveResult('hold', out);
  }
  M.deliver = deliver; fz.remove(); A.mon.freeze = false;
  await teardown(S);
  out.done = true; out.dialogs = A.dialogs.slice(0, 12); saveResult('hold', out);
  sayEl.innerHTML = 'All three steps are done. Tap <b>Copy results</b> and paste them into the chat, with the six screenshots (A, B, C twice).';
  bGo.textContent = 'Copy results'; bGo.disabled = false;
  bGo.onclick = async () => { const t = JSON.stringify(merged()); try { await navigator.clipboard.writeText(t); st.textContent = 'Copied.'; } catch (e) { st.textContent = 'Copy failed — open ?m3=1 and use Copy results there.'; } };
  window.__m3.result = out; window.__m3.state = 'done';
}
// (the CDP harness) a screenshot taken now: the harness sees __m3.want, captures, clears it
async function harnessShot(name) { window.__m3.want = name; for (let i = 0; i < 400 && window.__m3.want === name; i++) await sleep(50); }
// the screenshot's regions (page CSS px; the markers at the page's top corners locate the page in a screenshot): each module,
// its live regions (display canvases, meters), the viewport, grid-only tiles (no module, cable layer or badge in them)
function holdRegions(S, frame) {
  // (every rect clipped to the canvas's viewport: what is outside it — the app's bar, this page's bar — is not the scene)
  const fr = frame.getBoundingClientRect(), vp = A.W.viewport.getBoundingClientRect();
  const clip = r => { const x0 = Math.max(r.left, vp.left), y0 = Math.max(r.top, vp.top), x1 = Math.min(r.right, vp.right), y1 = Math.min(r.bottom, vp.bottom); return x1 > x0 && y1 > y0 ? { left: x0, top: y0, width: x1 - x0, height: y1 - y0 } : null; };
  const rr = r => [r1(r.left + fr.left), r1(r.top + fr.top), r1(r.width), r1(r.height)];
  const mods = sceneMods(S).map(m => {
    const c = clip(m.el.getBoundingClientRect());
    if (!c) return null;
    const live = [...m.el.querySelectorAll('canvas, .wk-meter, [class*="meter"], [class*="gr"], svg')].filter(e => e.getClientRects().length && (e.tagName !== 'svg' || e.closest('[class*="meter"], [class*="gr"]'))).map(e => clip(e.getBoundingClientRect())).filter(Boolean).map(rr);
    return { key: m.key, r: rr(c), live: live.slice(0, 60) };
  }).filter(Boolean);
  const avoid = [...A.W.el.querySelectorAll(':scope > .cv-mod, .m3-cables svg, .cv-mbadge')].filter(e => e.getClientRects().length && getComputedStyle(e).display !== 'none').map(e => e.getBoundingClientRect());
  const tiles = [];
  for (let y = vp.top + 8; y + 48 < vp.bottom && tiles.length < 24; y += 64) for (let x = vp.left + 8; x + 48 < vp.right && tiles.length < 24; x += 64) {
    const hit = avoid.some(r => x < r.right + 8 && x + 48 > r.left - 8 && y < r.bottom + 8 && y + 48 > r.top - 8);
    if (!hit) tiles.push([r1(x + fr.left), r1(y + fr.top), 48, 48]);
  }
  return { page: [innerWidth, innerHeight], dpr: devicePixelRatio, markers: [[0, 0, 12, 12], [innerWidth - 12, 0, 12, 12]], viewport: rr(vp), mods, grid: tiles };
}

/* ---- M3's diff (on the Mac): three screenshots per hold + the results JSON → per module % of pixels changing by > 16/255 */
async function pageDiff() {
  const { top } = await header(null);
  top.append(h('p', 'm3-note', 'The rest test (M3): paste the results JSON, pick the screenshots in order (A, B, C of the 50 % hold, then A, B, C of the 150 % hold), Compare. A ↔ B: the render-in (per module); B ↔ C: the noise floor outside the live regions (must be 0.00); the grid tiles A ↔ B must be 0.00.'));
  const ta = h('textarea'); ta.id = 'm3out'; ta.placeholder = 'results JSON'; ta.value = JSON.stringify(merged());
  const inp = h('input'); inp.type = 'file'; inp.multiple = true; inp.accept = 'image/*';
  const go = h('button', 'go', 'Compare'), outEl = h('div', 'm3-res');
  top.append(ta, h('br'), inp, go); document.body.append(outEl);
  go.onclick = async () => {
    let R; try { R = JSON.parse(ta.value); } catch (e) { say('The JSON does not parse'); return; }
    const holds = (R.hold && R.hold.holds) || [], files = [...inp.files].sort((a, b) => (a.name < b.name ? -1 : 1));
    if (files.length < 3 * holds.length) { say('Pick ' + 3 * holds.length + ' screenshots'); return; }
    const out = [];
    for (let i = 0; i < holds.length; i++) out.push(await diffHold(holds[i], files.slice(3 * i, 3 * i + 3)));
    outEl.innerHTML = out.map(o => '<h3>hold k ' + o.k + '</h3><p>offset ' + o.off + ' · scale ' + o.scale + ' · grid A↔B <b class="' + (o.grid.pct ? 'bad' : 'ok') + '">' + o.grid.pct + ' %</b> · viewport A↔B ' + o.vp.ab.pct + ' %, B↔C ' + o.vp.bc.pct + ' %</p><table><tr><th>module</th><th>A↔B % &gt;16</th><th>A↔B mean</th><th>B↔C % (masked)</th></tr>'
      + o.mods.map(m => '<tr><td>' + m.key + '</td><td>' + m.ab.pct + '</td><td>' + m.ab.mean + '</td><td class="' + (m.bc.pct ? 'bad' : 'ok') + '">' + m.bc.pct + '</td></tr>').join('') + '</table>').join('');
    const RR = results(); RR.holdDiff = out; LS.set(RES_KEY, RR);
    window.__m3.diff = out;
  };
}
async function decode(file) {
  const bm = await createImageBitmap(file), c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bm, 0, 0);
  return { w: bm.width, h: bm.height, d: g.getImageData(0, 0, bm.width, bm.height).data };
}
async function diffHold(H, files) {
  const [Aa, Bb, Cc] = [await decode(files[0]), await decode(files[1]), await decode(files[2])];
  // the left marker (#ff00ff, 12 × 12 CSS px at the page's top-left) in each shot: its first pixel the page's origin, its
  // width the scale (a shot without it: the page at the top-left, the page's dpr)
  const mag = (X, i) => X.d[i] > 200 && X.d[i + 1] < 90 && X.d[i + 2] > 200;
  const locate = X => {
    for (let y = 0; y < Math.min(X.h, 700); y++) for (let x = 0; x < Math.min(X.w, 240); x++) if (mag(X, (y * X.w + x) * 4) && mag(X, ((y + 4) * X.w + x + 4) * 4)) {
      let e = x; while (e < X.w && mag(X, (y * X.w + e) * 4)) e++;
      return { o: [x, y], sc: (e - x) / 12 };
    }
    return { o: [0, 0], sc: H.regions.dpr };
  };
  const LA = locate(Aa), LB = locate(Bb), LC = locate(Cc), sc = LA.sc, off = LA.o;
  const L = new Map([[Aa, LA.o], [Bb, LB.o], [Cc, LC.o]]);
  const cmp = (X, Y, r, masks) => {
    const ox = L.get(X), oy = L.get(Y), dx = oy[0] - ox[0], dy = oy[1] - ox[1]; // (Y's pixel of X's: shifted by the offsets' difference)
    const x0 = Math.max(0, Math.round(ox[0] + r[0] * sc)), y0 = Math.max(0, Math.round(ox[1] + r[1] * sc)), x1 = Math.min(X.w, Y.w - dx, Math.round(ox[0] + (r[0] + r[2]) * sc)), y1 = Math.min(X.h, Y.h - dy, Math.round(ox[1] + (r[1] + r[3]) * sc));
    const M = (masks || []).map(m => [ox[0] + m[0] * sc - 2, ox[1] + m[1] * sc - 2, ox[0] + (m[0] + m[2]) * sc + 2, ox[1] + (m[1] + m[3]) * sc + 2]);
    let n = 0, s = 0, big = 0, bx0 = Infinity, by0 = Infinity, bx1 = -1, by1 = -1;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (M.length && M.some(m => x >= m[0] && x < m[2] && y >= m[1] && y < m[3])) continue;
      const i = (y * X.w + x) * 4, j = ((y + dy) * Y.w + x + dx) * 4, dd = (Math.abs(X.d[i] - Y.d[j]) + Math.abs(X.d[i + 1] - Y.d[j + 1]) + Math.abs(X.d[i + 2] - Y.d[j + 2])) / 3;
      s += dd; n++;
      if (dd > 16) { big++; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
    }
    // (where it changed: the box of the changed pixels, page CSS px)
    const box = big ? [r1((bx0 - off[0]) / sc), r1((by0 - off[1]) / sc), r1((bx1 - bx0 + 1) / sc), r1((by1 - by0 + 1) / sc)] : null;
    return { px: n, mean: n ? r2(s / n) : 0, pct: n ? r2(100 * big / n) : 0, box };
  };
  const mods = H.regions.mods.map(m => ({ key: m.key, ab: cmp(Aa, Bb, m.r), bc: cmp(Bb, Cc, m.r, m.live) }));
  const g = H.regions.grid.map(t => cmp(Aa, Bb, t)), gp = g.reduce((a, x) => a + x.px, 0), gb = g.reduce((a, x) => a + x.pct * x.px / 100, 0);
  return { k: H.k, off, offB: LB.o, offC: LC.o, scale: r2(sc), mods, vp: { ab: cmp(Aa, Bb, H.regions.viewport), bc: cmp(Bb, Cc, H.regions.viewport, H.regions.mods.flatMap(m => m.live)) }, grid: { tiles: g.length, pct: gp ? r2(100 * gb / gp) : 0 } };
}

/* ------------------------------------------------------------------------------------------------ entry */
export async function main() {
  chrome();
  try {
    if (MODE === 'hand') await pageHand();
    else if (MODE === 'hold') await pageHold();
    else if (MODE === 'diff') await pageDiff();
    else await pageAuto();
  } catch (e) { console.error(e); say('Error: ' + (e && e.message)); window.__m3.state = 'error'; window.__m3.error = String(e && e.stack || e); }
}
