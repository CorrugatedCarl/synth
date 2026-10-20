// tests/ui-bench-1i.mjs — stage 1i's UI bench (docs/canvas/IMPL-1i.md §9 "Rendering", §8.3; lane K1): the logic of
// tests/ui-bench-1i.html (a module, not a test file: node --test runs *.test.mjs only). It boots the app in an iframe (same
// origin, the test hooks on, the GL grid with readPixels: the pref synth.cv.gl = 'test'; ?gl=off the 2D path) and measures:
//  · hw5k — ui-bench's five panels (OB-Xa, Jupiter-8, MS-20, CS-80, Prophet-5) with their keyboards, ui-bench's drive (idle /
//    pan / zoom / settle / deep / deepSettle), run first and last (the drift); per phase the frames (median / p95 / max / over
//    33 ms), the GL draws (mean / max ms) and glStats().bytes (≤ 384 MB). Its own envelope ("ui-1i"), never 1h's hw5's.
//  · hw5 — the same five with their 1h faces, when ?base=<a folder holding the 1h build's panels/<id>.js> (the Mac harness
//    serves an export of the base): the 1h layouts through __synthTest.panels in this same app, so only the faces differ.
//  · one — one CS-80 alone at fit: its face's bytes (base + mips ≤ 58 MB, §3.3).
//  · paint — each keyboard model alone: its first base paint (raster + upload, cv-face paintMs; B1 when the CS-80's or the
//    modular's is over 100 ms on the iPad).
//  · keys — a key press: pointerdown → the host's noteOn (postTo) in the same task, timed around the dispatch (the engine
//    alone, on a stand-in over the bed, while the host has no api.perf yet).
//  · probes on the CS-80, the Prophet-5 (its wheels) and the Jupiter-8 (its bender): G1 (the GL pixels at rest = mid-burst =
//    at rest again, equalPx) at k 0.6 and 1.6 (the window landed); the shades on their keys' art (every black key's sides
//    and front edge, every E–F / B–C gap measured in the GL pixels within 0.5 device px of its .hw-kd) at k 0.5, 1, 1.6;
//    the wheel surfaces / lever caps over their art (the same measure, from 100 %).
//  · firstPan — the page's very first pan and pinch (the first scene's, nothing warmed before them), recorded on their own
//    (frames, worst three, GL draws) and never gated: they also warm the app's code paths for the scenes after them. A cold
//    first pan showed one 130–150 ms frame on the Mac once; 13 fresh-profile Chrome runs found no reproducible hitch (review 2
//    P2-3), so this row is for the iPad session: does WebKit hitch on first use (lazy Metal pipeline creation)?
//  · console errors (console.error, error, unhandledrejection in the app).
// The app shares the site's storage: the project is snapshotted first and put back whole at the end (as ui-bench).
export const FIVE = ['obxa', 'jupiter8', 'ms20', 'cs80', 'prophet5'];
export const BEDS = ['modular', 'minimoog', 'arp2600', 'solina', 'cs80', 'prophet5', 'ms20', 'obxa', 'jupiter8', 'juno60', 'dx7'];
/** The gates (§9): frames, draws, bytes, the one-face base, the key path, the shades' error (device px). */
export const GATE = Object.freeze({ frameMs: 33, glMean: 1, bytes: 384e6, oneFace: 58e6, keyMs: 1, alignPx: 0.5, paintB1: 100 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const raf = () => new Promise(r => requestAnimationFrame(r));
const q = a => { const s = a.slice().sort((x, y) => x - y); const at = p => +(s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0).toFixed(2); return { n: a.length, med: at(0.5), p95: at(0.95), max: +(s[s.length - 1] || 0).toFixed(1), over33: a.filter(x => x > GATE.frameMs).length }; };
const importIn = (win, rel) => win.Function('u', 'return import(u)')(new URL(rel, location.href).href);

/* ---- the app */
async function boot(frame) {
  const html = await (await fetch('../index.html', { cache: 'no-store' })).text();
  const hook = '<script>window.__synthTest = {}; window.__errs = []; (function () { var e0 = console.error; console.error = function () { window.__errs.push([].map.call(arguments, String).join(" ").slice(0, 300)); return e0.apply(console, arguments); };'
    + ' addEventListener("error", function (e) { window.__errs.push("error: " + e.message); }); addEventListener("unhandledrejection", function (e) { window.__errs.push("rejection: " + (e.reason && e.reason.message || e.reason)); }); })();<\/script>';
  frame.srcdoc = html.replace(/<head>/i, '<head><base href="' + new URL('../', location.href).href + '">' + hook);
  for (let i = 0; i < 400; i++) { await sleep(50); const w = frame.contentWindow; if (w && w.__synthTest && w.__synthTest.cv && w.__synthTest.api && w.__synthTest.shell && w.document.querySelector('#world')) return w; }
  throw new Error('the app did not start');
}
// the faces' bases landed and no job queued (≤ ms), then two frames
async function rest(world, ms = 4000) {
  const t0 = performance.now();
  await sleep(150);
  while (performance.now() - t0 < ms) {
    const g = typeof world.glStats === 'function' ? world.glStats() : null;
    if (!world.busy && (!g || (!g.queued && g.base >= g.glFaces))) break;
    await sleep(60);
  }
  await raf(); await raf();
}
async function track(E, ids, panels) { // a new track with these synths (hardware panels), tidied and fitted
  const { win, api, cv, shell } = E;
  if (panels) win.__synthTest.panels = panels; else delete win.__synthTest.panels;
  shell.srcPick(ids[0], 'track');
  await sleep(300);
  const t = api.project().tracks.find(x => x.id === api.project().selTrack);
  E.made.push(t.id);
  for (const id of ids.slice(1)) { cv.add(id, null); await sleep(250); }
  cv.tidy(); await sleep(300);
  for (let i = 0; i < 40 && cv.mount(); i++) await raf();
  await sleep(400);
  const world = cv.world();
  world.fit({ animate: false });
  await rest(world);
  return { t, world };
}
function drop(E, t) {
  try { t.notes = []; E.api.deleteTrack(t); } catch (e) { console.error(e); }
  E.made = E.made.filter(x => x !== t.id);
  delete E.win.__synthTest.panels;
}

/* ---- ui-bench's drive and phases */
function frames(run) {
  return new Promise(res => {
    const out = []; let last = performance.now(), on = true;
    const tick = t => { out.push(t - last); last = t; if (on) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    run().then(() => { on = false; res(out.slice(1)); });
  });
}
async function drive(win, world, kind, ms, F = 1.6) {
  const vp = win.document.querySelector('#viewport').getBoundingClientRect(), cx = vp.left + vp.width / 2, cy = vp.top + vp.height / 2;
  const t0 = performance.now(); let lastX = 0, lastK = 1;
  while (performance.now() - t0 < ms) {
    await raf();
    const ph = (performance.now() - t0) / ms * 2 * Math.PI;
    if (kind === 'pan') { const x = 300 * Math.sin(ph); world.panBy(x - lastX, 0); lastX = x; }
    else { const k = Math.pow(F, 0.5 - 0.5 * Math.cos(ph)); world.zoomAt(k / lastK, cx, cy); lastK = k; }
  }
}
const glRow = g => ({ n: g.frames, mean: g.frames ? +(g.ms / g.frames).toFixed(3) : 0, max: +g.max.toFixed(2), bytes: g.bytes, faceBytes: g.faceBytes, windows: g.windows, paints: g.paints, paintMax: +(g.paintMax || 0).toFixed(1) });
/**
 * The very first pan and pinch of a fresh page, each its own measured phase and nothing warmed first (review 2 P2-3: this
 * burst used to run unmeasured as the warm-up, after a cold 130–150 ms frame showed once on the Mac; 13 fresh-profile
 * runs there found no reproducible hitch). A record for the iPad session (WebKit's lazy pipeline creation may hitch on
 * first use), never a gate: per phase the frames (n, median, p95, max, over 33 ms), its worst three (ms) and the GL draws.
 */
export async function firstBurst(win, world, ms = 800) {
  const r = {}, gl = typeof world.glStats === 'function' && !!world.glStats();
  for (const kind of ['pan', 'zoom']) {
    if (gl) world.glStats(true);
    const f = await frames(() => drive(win, world, kind, ms));
    r[kind] = q(f);
    r[kind].worst = f.slice().sort((a, b) => b - a).slice(0, 3).map(v => +v.toFixed(1));
    if (gl) r[kind].gl = glRow(world.glStats());
  }
  return r;
}
async function measure(win, world) {
  const r = {}, gl = typeof world.glStats === 'function' && !!world.glStats();
  const phase = async (name, run) => {
    if (gl) world.glStats(true);
    r[name] = q(await frames(run));
    if (gl) r[name].gl = glRow(world.glStats());
  };
  await phase('idle', () => sleep(1000));
  await phase('pan', () => drive(win, world, 'pan', 2000));
  await phase('zoom', () => drive(win, world, 'zoom', 2000));
  await phase('settle', () => sleep(700));
  await phase('deep', () => drive(win, world, 'zoom', 3000, 4));
  await phase('deepSettle', () => sleep(700));
  return r;
}

/* ---- the probes (GL pixels: preserveDrawingBuffer under the pref 'test') */
function glOf(win) {
  const cv = win.document.querySelector('#viewport > .cv-gl'), gl = cv && cv.getContext('webgl2');
  const w = win.__synthTest.cv.world();
  return gl ? { cv, gl, d: win.devicePixelRatio, rect: () => cv.getBoundingClientRect(), stats: () => w.glStats() } : null;
}
// rows bottom-up in readPixels: a w × h block at device (x, y) (top-left), as luma rows top-down
function lumaBlock(G, x, y, w, h) {
  const { gl, cv } = G, b = new Uint8Array(w * h * 4);
  gl.readPixels(x, cv.height - y - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
  const L = [];
  for (let r = 0; r < h; r++) { const row = new Float64Array(w), src = (h - 1 - r) * w * 4; for (let i = 0; i < w; i++) { const p = src + i * 4; row[i] = (b[p] + b[p + 1] + b[p + 2]) / 3; } L.push(row); }
  return L;
}
const readAll = G => { const { gl, cv } = G, b = new Uint8Array(cv.width * cv.height * 4); gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
const med = a => { const s = Array.from(a).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
/**
 * A step edge's position along a line of luma `v` (pixel i covers [i, i + 1)) near `exp` (device px, the DOM's): the
 * levels A (before the edge) and B (after) from 3 px each side beyond ±4 px, the edge e = a + Σ (v − B) / (A − B) over the
 * window [a, a + 8) (the A-side coverage). null when the contrast is under 12 levels (the GL pixels are exact: no noise) or
 * the window leaves the line.
 */
export function stepEdge(v, exp) {
  const a = Math.round(exp) - 4, b = a + 8;
  if (a - 3 < 0 || b + 3 > v.length) return null;
  const A = med(v.slice(a - 3, a)), B = med(v.slice(b, b + 3));
  if (Math.abs(A - B) < 12) return null;
  let s = 0;
  for (let i = a; i < b; i++) s += Math.max(0, Math.min(1, (v[i] - B) / (A - B)));
  return a + s;
}
/** A thin dark line's centre (a white-key gap) near `exp`: the centroid of the deficit under the surrounding level. */
export function dipCentre(v, exp) {
  const a = Math.round(exp) - 4, b = a + 8;
  if (a - 3 < 0 || b + 3 > v.length) return null;
  const W = Math.max(med(v.slice(a - 3, a)), med(v.slice(b, b + 3)));
  let s = 0, m = 0;
  for (let i = a; i < b; i++) { const d = Math.max(0, W - v[i]); s += d; m += d * (i + 0.5); }
  return s > 8 ? m / s : null;
}
// the camera that puts el's point (fx, fy of its box) at the GL canvas centre at zoom k
async function lookAt(world, G, el, k, fx = 0.5, fy = 0.5) {
  const cr = G.rect(), r = el.getBoundingClientRect(), c = world.cam;
  const wx = (r.left + r.width * fx - cr.left - c.tx) / c.k, wy = (r.top + r.height * fy - cr.top - c.ty) / c.k;
  world.setCamera({ tx: Math.round(cr.width / 2 - wx * k), ty: Math.round(cr.height / 2 - wy * k), k });
  await rest(world);
  if (k > 1) { const t0 = performance.now(); while (performance.now() - t0 < 3000 && !(world.glStats().windows > 0)) await sleep(60); await rest(world); } // (the window landed)
}
async function g1At(world, G, win) { // ui-bench's G1 at the current camera: rest, a burst away and back (dyadic steps), rest
  const C = Object.assign({}, world.cam), vp = win.document.querySelector('#viewport').getBoundingClientRect(), cx = vp.left + Math.floor(vp.width / 2), cy = vp.top + Math.floor(vp.height / 2);
  const A = readAll(G);
  const [z1, z2] = C.k > 1 ? [0.5, 2] : [2, 0.5]; // (dyadic, within the zoom range: out and in above 100 %)
  world.panBy(37, -23); await raf(); world.zoomAt(z1, cx, cy); await raf(); world.zoomAt(z2, cx, cy); await raf(); world.panBy(-37, 23); await raf(); await raf();
  const busy = world.busy, c = Object.assign({}, world.cam), B = readAll(G);
  await rest(world); await sleep(300);
  const A2 = readAll(G), c2 = world.cam;
  let dMid = 0, dRest = 0;
  for (let i = 0; i < A.length; i++) { if (A[i] !== B[i]) dMid++; if (A[i] !== A2[i]) dRest++; }
  const same = c.tx === C.tx && c.ty === C.ty && c.k === C.k && c2.tx === C.tx && c2.ty === C.ty && c2.k === C.k;
  return { k: C.k, busyMid: busy, sameCam: same, equalPx: same && dMid === 0 && dRest === 0, diffMid: dMid, diffRest: dRest };
}
const BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
// the shades against the art in the GL pixels (all .hw-kd shown for the measure): every on-screen black key's left / right
// side (a row 2.5 mm above its front: no top face there) and its front edge (a column a quarter in from its centre), every
// E–F / B–C gap (a row at 80 % of the white length); err = |art − DOM| in device px
function align(G, wrap, k) {
  const d = G.d, cr = G.rect(), W = G.cv.width, H = G.cv.height, mm = 2 * k * d;
  const sh = [...wrap.querySelectorAll('.hw-kd')].map(s => { s.removeAttribute('hidden'); const r = s.getBoundingClientRect(); return { n: +s.getAttribute('data-note'), L: (r.left - cr.left) * d, R: (r.right - cr.left) * d, T: (r.top - cr.top) * d, B: (r.bottom - cr.top) * d }; });
  const out = [];
  const inX = (a, b) => a > 12 && b < W - 12, inY = (a, b) => a >= 0 && b < H; // (the rows / columns a measure reads on the canvas)
  return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => { // (the GL frame without the shades' effect: they are DOM; read now)
    for (const s of sh) {
      if (BLACK[s.n % 12]) {
        const y = Math.round(s.B - 2.5 * mm);
        if (!inX(s.L, s.R) || !inY(y - 1, y + 1) || !inY(Math.round(s.B) - 12, Math.round(s.B) + 12)) continue;
        const row = lumaBlock(G, 0, y, W, 1)[0];
        const l = stepEdge(row, s.L), r = stepEdge(row, s.R);
        if (l != null) out.push({ n: s.n, what: 'black left', err: +(l - s.L).toFixed(3) });
        if (r != null) out.push({ n: s.n, what: 'black right', err: +(r - s.R).toFixed(3) });
        const x = Math.round(s.L + (s.R - s.L) * 0.75), y0 = Math.max(0, Math.round(s.B) - 12), col = lumaBlock(G, x, y0, 1, Math.min(24, H - y0)).map(rw => rw[0]);
        const f = stepEdge(col, s.B - y0);
        if (f != null) out.push({ n: s.n, what: 'black front', err: +(f + y0 - s.B).toFixed(3) });
      } else if (s.n % 12 === 4 || s.n % 12 === 11) { // E | F, B | C: the gap after this white key
        const nx = sh.find(o => o.n === s.n + 1), y = Math.round(s.T + 0.8 * (s.B - s.T));
        if (!nx || !inX(s.L, nx.R) || !inY(y, y + 1)) continue;
        const row = lumaBlock(G, 0, y, W, 1)[0], c = dipCentre(row, (s.R + nx.L) / 2);
        if (c != null) out.push({ n: s.n, what: 'white gap', err: +(c - (s.R + nx.L) / 2).toFixed(3) });
      }
    }
    for (const s of wrap.querySelectorAll('.hw-kd')) s.setAttribute('hidden', '');
    const errs = out.map(o => Math.abs(o.err)), gs = G.stats ? G.stats() : null;
    res({ k, mode: gs ? gs.glFaces + ' gl / ' + gs.dom + ' dom' : null, n: out.length, maxErr: errs.length ? +Math.max(...errs).toFixed(3) : null, meanErr: errs.length ? +(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(3) : null, worst: out.slice().sort((a, b) => Math.abs(b.err) - Math.abs(a.err)).slice(0, 4) });
  })));
}
// a wheel's surface / a lever's cap: its DOM part's sides against the art's (the DOM hidden for the read: GL pixels only)
async function slots(G, root, k) {
  const d = G.d, cr = G.rect(), W = G.cv.width, mm = 2 * k * d, out = [];
  for (const el of root.querySelectorAll('.hw-wheel > .hw-ws, .hw-lever > .hw-lc')) {
    const r = el.getBoundingClientRect(), L = (r.left - cr.left) * d, R = (r.right - cr.left) * d, T = (r.top - cr.top) * d, B = (r.bottom - cr.top) * d;
    if (L < 12 || R > W - 12 || T < 0 || B > G.cv.height) continue;
    const y = el.classList.contains('hw-ws') ? Math.round(T + 1.8 * mm) : Math.round((T + B) / 2), row = lumaBlock(G, 0, y, W, 1)[0];
    const l = stepEdge(row, L), rr = stepEdge(row, R), id = el.parentNode.parentNode.getAttribute('data-ctl') + (el.classList.contains('hw-ws') ? ' surface' : ' cap');
    if (l != null) out.push({ id, side: 'left', err: +(l - L).toFixed(3) });
    if (rr != null) out.push({ id, side: 'right', err: +(rr - R).toFixed(3) });
  }
  const errs = out.map(o => Math.abs(o.err));
  return { k, n: out.length, maxErr: errs.length ? +Math.max(...errs).toFixed(3) : null, all: out };
}
async function probes(E, id) {
  const { win } = E, G = glOf(win);
  const { t, world } = await track(E, [id]);
  const out = { id };
  const root = win.document.querySelector(`.inst.hw[data-hw="${id}"]`), wrap = root && root.querySelector('.hw-c[data-ctl="perf:keys"]');
  out.faceBytes = world.glStats() ? world.glStats().faceBytes : null;
  if (!G || !wrap) { out.skipped = !G ? 'no GL canvas' : 'no bed'; drop(E, t); return out; }
  out.g1 = {}; out.align = {}; out.slots = {};
  for (const k of [0.5, 0.6, 1, 1.6]) {
    await lookAt(world, G, wrap, k, k > 1 ? 0.45 : 0.5, k < 1 ? 0.5 : 0.72); // (above 50 %: the keys' front half — black fronts, the gap rows — in view)
    if (k === 0.6 || k === 1.6) out.g1[k] = await g1At(world, G, win);
    if (k !== 0.6) out.align[k] = await align(G, wrap, k);
  }
  for (const k of [1, 1.6]) { // the controllers (the plate left of the bed; from 100 %: a wheel's 1.5 mm rim is ≥ 3 device px)
    const c = root.querySelector('.hw-wheel, .hw-lever');
    if (!c) break;
    await lookAt(world, G, c, k);
    for (const el of root.querySelectorAll('.hw-wheel, .hw-lever')) el.style.visibility = 'hidden';
    await raf(); await raf();
    out.slots[k] = await slots(G, root, k);
    for (const el of root.querySelectorAll('.hw-wheel, .hw-lever')) el.style.visibility = '';
  }
  drop(E, t);
  return out;
}
// a key press timed around its dispatch (the host's path in the same task; the engine alone without api.perf)
async function keyLatency(E, id) {
  const { win } = E, { t, world } = await track(E, [id]);
  const root = win.document.querySelector(`.inst.hw[data-hw="${id}"]`), keys = root && root.querySelector('.hw-c[data-ctl="perf:keys"] > .hw-keys');
  if (!keys) { drop(E, t); return { skipped: 'no bed' }; }
  const host = keys.getAttribute('aria-disabled') !== 'true';
  let target = keys, eng = null;
  if (!host) { // a stand-in over the bed with the engine alone
    const KY = await importIn(win, '../cv-keys.js?v=9'), PN = await importIn(win, '../cv-panel.js?v=9');
    const L = PN.layoutOf(id), c = L.controls.find(x => x.id === 'perf:keys');
    target = win.document.createElement('div'); target.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:auto';
    keys.parentNode.append(target);
    eng = KY.bed(target, KY.bedLayout(c), { on: () => {}, off: () => {}, at: null, shade: () => {} });
  }
  const r = target.getBoundingClientRect(), ms = [], N = 40, WARM = 4; // (the first presses warm the JIT: not counted)
  for (let i = 0; i < N + WARM; i++) {
    const x = r.left + r.width * (0.1 + 0.8 * (i % N) / (N - 1)), y = r.top + r.height * 0.85, o = { pointerId: 900 + i, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true, cancelable: true };
    await raf(); // (a press lands after a frame, as a finger's: style and layout clean)
    const t0 = performance.now();
    target.dispatchEvent(new win.PointerEvent('pointerdown', o));
    if (i >= WARM) ms.push(performance.now() - t0);
    target.dispatchEvent(new win.PointerEvent('pointerup', Object.assign({}, o, { buttons: 0 })));
  }
  if (eng) { eng.destroy(); target.remove(); }
  drop(E, t);
  void world;
  const s = q(ms);
  return { host, n: s.n, med: s.med, p95: s.p95, max: +Math.max(...ms).toFixed(3) };
}

/* ---- the run */
export async function run({ frame, status = () => {}, base = null, glMode = 'test', only = null }) {
  let glPref = null;
  try { glPref = localStorage.getItem('synth.cv.gl'); localStorage.setItem('synth.cv.gl', glMode); } catch (e) { /* no storage */ }
  status('starting the app…');
  const win = await boot(frame), T = win.__synthTest;
  const E = { win, api: T.api, cv: T.cv, shell: T.shell, made: [] };
  await sleep(800);
  const R = { date: new Date().toISOString().slice(0, 10), ua: navigator.userAgent, dpr: devicePixelRatio, viewport: innerWidth + '×' + innerHeight,
    frame: Math.round(frame.clientWidth) + '×' + Math.round(frame.clientHeight), gl: glMode === 'off' ? '2d' : 'gl', base: base || null, scenes: {}, paint: {}, probes: {}, gates: {} };
  const want = s => !only || only.includes(s);
  const snap = JSON.stringify(E.api.project());
  try {
    let warm = false; // (the first scene: the page's first pan and pinch, recorded as R.firstPan — unwarmed, informational — and warming the app's code paths for the rest, as ui-bench's 'one' scene did)
    const five = async (name, panels) => {
      status('measuring ' + name + '…');
      const { t, world } = await track(E, FIVE, panels);
      if (!warm) { warm = true; R.firstPan = await firstBurst(win, world); world.fit({ animate: false }); await rest(world); }
      R.scenes[name] = await measure(win, world); R.scenes[name].nodes = win.document.querySelectorAll('#world *').length; drop(E, t);
    };
    if (want('hw5k')) await five('hw5k');
    if (want('hw5') && base) {
      const panels = {};
      for (const id of FIVE) panels[id] = (await importIn(win, new URL('panels/' + id + '.js?v=9', new URL(base, location.href)).href)).default;
      await five('hw5', panels);
    }
    if (want('one')) {
      status('one CS-80…');
      const { t, world } = await track(E, ['cs80']), g = world.glStats();
      R.one = g ? { faceBytes: g.faceBytes, bytes: g.bytes, base: g.base, windows: g.windows, k: +world.cam.k.toFixed(3) } : null;
      drop(E, t);
    }
    if (want('paint')) for (const id of BEDS) {
      status('first base paint: ' + id + '…');
      const g0 = E.cv.world().glStats();
      const { t, world } = await track(E, [id]), g = world.glStats();
      R.paint[id] = g && g0 ? { paints: g.paints - g0.paints, ms: +(g.paintMs - g0.paintMs).toFixed(1), max: +g.paintMax.toFixed(1) } : null;
      drop(E, t);
    }
    if (want('keys')) { status('key latency…'); R.keys = await keyLatency(E, 'cs80'); }
    if (want('probes')) for (const id of ['cs80', 'prophet5', 'jupiter8']) { status('probes: ' + id + '…'); R.probes[id] = await probes(E, id); }
    if (want('hw5k') && want('last')) { await five('hw5kLast'); R.drift = +Math.abs(R.scenes.hw5kLast.pan.med - R.scenes.hw5k.pan.med).toFixed(2); }
  } finally {
    status('cleaning up…');
    for (const id of E.made.slice()) { const t = E.api.project().tracks.find(x => x.id === id); if (t) drop(E, t); }
    try { E.api.applyRestore(JSON.parse(snap)); E.api.save(); await E.api.store.flush(); } catch (e) { console.error('ui-bench-1i: the project could not be put back', e); }
    try { if (glPref == null) localStorage.removeItem('synth.cv.gl'); else localStorage.setItem('synth.cv.gl', glPref); } catch (e) { /* no storage */ }
    R.errors = (win.__errs || []).slice(0, 20);
  }
  R.gates = gates(R);
  return R;
}
/** The §9 gates from a result (null: not measured). */
export function gates(R) {
  const S = R.scenes.hw5k, G = {};
  if (S) {
    G.frames = ['pan', 'zoom', 'deep'].every(p => S[p].max <= GATE.frameMs);
    G.glMean = ['pan', 'zoom', 'deep'].every(p => !S[p].gl || S[p].gl.mean <= GATE.glMean);
    G.bytes = Object.values(S).every(p => !p || !p.gl || p.gl.bytes <= GATE.bytes);
  }
  if (R.one) G.oneFace = R.one.faceBytes <= GATE.oneFace;
  if (R.keys && !R.keys.skipped) G.keys = R.keys.max <= GATE.keyMs;
  const al = Object.values(R.probes || {}).flatMap(p => Object.values(p.align || {}).concat(Object.values(p.slots || {}))).filter(a => a.n);
  if (al.length) G.align = al.every(a => a.maxErr <= GATE.alignPx);
  const g1 = Object.values(R.probes || {}).flatMap(p => Object.values(p.g1 || {}));
  if (g1.length) G.g1 = g1.every(x => x.equalPx);
  const pt = R.paint || {};
  if (pt.cs80 || pt.modular) G.b1 = !((pt.cs80 && pt.cs80.ms > GATE.paintB1) || (pt.modular && pt.modular.ms > GATE.paintB1)); // (false: B1's banded bases, §3.3)
  G.errors = !(R.errors && R.errors.length);
  return G;
}
