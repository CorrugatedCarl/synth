import './v8-guard.mjs';
// cv-world.js (stage 1b WORLD lane; docs/canvas/IMPL-1b.md §8.2; Z1 of docs/canvas/IMPL-panels.md §8.1): camera maths,
// on-screen tracking (planScreen, onScreen from cached rects, the 'screen' event), zoom consistency (nothing changes look
// at any zoom), the soft DOM budget, sleeping controls below READ_K, native-zoom hand-over, momentum guard, late-finger
// pinch, wheel + veto, edit state, edge auto-pan, ghost re-projection, localPoint under the world transform. Fake DOM: tests/wk-dom.mjs. Never pass fake-DOM nodes to assert.*
// (compare ids / strings / numbers). Stage 1e: the jack hook (a press on a jack is the cable drag's; a second finger
// cancels it and pinches; a two-finger cancel, Escape, setActive(false) cancel it). Stage 2a: the ∿ cycle (Always / On
// select / Never, synth.cv.mods, 'mods' events). Stage 1i (IMPL-1i §4.3), with the real gesture.js on the same window: two
// fingers on a sleeping bed pinch, G2 (a resting finger never silences an awake bed), the 'sleeptap' event. Stage 9 (IMPL-9
// §4.2, §4.3, §4.5, §8.5; lane C9): the cord layer built lazily by cords() (its options: gl / svg / under), stepped and drawn
// ONCE a frame by the world (a pinch frame's two writes — gesture.js's pan and zoom hooks — step and draw it once at their end,
// the tick leaves it; the hold rule from the tick's frame length; the frame's camera), no frame while every
// rope sleeps (the real cv-cords on a fake GL too), a cord jack below READ_K not offered to the jack hook (it pans: sleeper),
// other jacks as before, the fit hook (ids, a READ_K floor, the foot kept). Stage P (IMPL-P §2, §7 C; lane C): the preset — o.perf
// at build, ?perf= over it, setPerf live to the cord layer and cv-face, glStats().perf / faceBudget —, ?texmax → createGL's
// maxTex, a device-ratio change re-checking the faces (no camera written), the real cords at medium / low through the world.
// Run alone: node --max-old-space-size=2048 --test tests/cv-world.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as dom from './wk-dom.mjs';
import * as W from '../cv-world.js?v=9';
import * as wk from '../wk.js?v=9';
import * as MOD from '../cv-module.js?v=9';
import * as CAB from '../cv-cables.js?v=9';
import * as FACES from '../cv-face.js?v=9';
import * as G from '../gesture.js?v=9';
import * as CORDS from '../cv-cords.js?v=9';

const { Ev, ptr, fire, place, layout, all } = dom;
// never hand a fake-DOM node to assert (its AssertionError walks the cyclic tree): primitives, or JSON
const safe = v => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
const eq = (a, b, m) => assert.equal(safe(a), safe(b), m);
const ok = (v, m) => assert.ok(!!v, m);
const near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, (m || '') + ': ' + a + ' vs ' + b + ' (±' + tol + ')');
const cam = c => ({ tx: Math.round(c.tx * 1000) / 1000, ty: Math.round(c.ty * 1000) / 1000, k: Math.round(c.k * 10000) / 10000 });

// a seeded generator (the maths tests draw random pivots)
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/* ------------------------------------------------------------------ pure maths */
test('maths: clampK, toWorld ∘ toLocal = identity, panCam is a finger delta, snap', () => {
  eq([W.clampK(0.1), W.clampK(3), W.clampK(1.3), W.clampK(NaN), W.clampK(-1), W.clampK(Infinity)], [0.25, 2, 1.3, 1, 0.25, 2]);
  eq([W.K_MIN, W.K_MAX, W.READ_K, W.EDIT_K, W.GRID, W.CULL_MARGIN, W.MOMENTUM_GUARD_MS, W.WHEEL_VETO_MS, W.BUDGET_EL],
    [0.25, 2, 0.5, 0.9, 8, 256, 120, 300, 9000], 'the contract constants');
  eq(['CARD_K', 'lodOf', 'planMount', 'SLICE_MS'].filter(k => k in W), [], 'no cards, no level of detail (Z1)');
  const R = rng(7);
  for (let i = 0; i < 200; i++) {
    const c = { tx: (R() - 0.5) * 4000, ty: (R() - 0.5) * 4000, k: 0.25 + R() * 1.75 }, x = (R() - 0.5) * 3000, y = (R() - 0.5) * 3000;
    const l = W.toLocal(c, x, y), w = W.toWorld(c, l.x, l.y);
    near(w.x, x, 1e-6, 'x'); near(w.y, y, 1e-6, 'y');
  }
  eq(W.panCam({ tx: 10, ty: 20, k: 0.5 }, 5, -7), { tx: 15, ty: 13, k: 0.5 }, 'content follows the finger');
  eq([W.DOT, W.MAJOR, ['SNAP_PREF', 'ZOOM_STEPS'].filter(k => k in W)], [32, 128, []], 'the visible grid; no snap pref (always on), no zoom steps (the toolbar has no ⊖ / ⊕)');
  eq([W.snap(13), W.snap(17), W.snap(48), W.snap(-3), W.snap(-20), W.snap(17, 16)], [0, 32, 64, 0, -32, 16], 'default: the dots (DOT)');
  ok(!Object.is(W.snap(-3), -0), 'no −0');
});

test('maths: zoomAbout keeps the pivot under it for random pivots and k in [0.25, 2], clamped steps included', () => {
  const R = rng(11);
  for (let i = 0; i < 300; i++) {
    const c = { tx: (R() - 0.5) * 2000, ty: (R() - 0.5) * 2000, k: 0.25 + R() * 1.75 }, lx = R() * 1400, ly = R() * 900;
    const f = i % 10 === 0 ? (R() < 0.5 ? 0.01 : 50) : 0.5 + R() * 1.5; // every 10th: far past the limits
    const w0 = W.toWorld(c, lx, ly), c2 = W.zoomAbout(c, f, lx, ly), w1 = W.toWorld(c2, lx, ly);
    near(w1.x, w0.x, 1e-6, 'pivot x'); near(w1.y, w0.y, 1e-6, 'pivot y');
    ok(c2.k >= W.K_MIN && c2.k <= W.K_MAX, 'clamped ' + c2.k);
  }
  eq(W.zoomAbout({ tx: 0, ty: 0, k: 2 }, 3, 100, 100), { tx: 0, ty: 0, k: 2 }, 'at the limit: nothing moves');
});

test('maths: fitCam contains every rect with the padding, k ≤ kMax, centred; empty → the origin at pad', () => {
  const R = rng(3);
  for (let i = 0; i < 100; i++) {
    const rects = Array.from({ length: 1 + Math.floor(R() * 4) }, () => ({ x: (R() - 0.5) * 4000, y: (R() - 0.5) * 3000, w: 100 + R() * 1200, h: 50 + R() * 800 }));
    const vw = 600 + R() * 1000, vh = 400 + R() * 600, kMax = R() < 0.5 ? 1 : 2, c = W.fitCam(rects, vw, vh, { pad: 48, kMax });
    ok(c.k <= kMax + 1e-9, 'k ≤ kMax');
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rects) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
    const a = W.toLocal(c, x0, y0), b = W.toLocal(c, x1, y1);
    if (c.k > W.K_MIN) { // (at K_MIN a huge layout may not fit: never below the camera range)
      ok(a.x >= 48 - 1e-6 && a.y >= 48 - 1e-6 && b.x <= vw - 48 + 1e-6 && b.y <= vh - 48 + 1e-6, 'inside the padded box ' + JSON.stringify([a, b, vw, vh]));
    }
    near((a.x + b.x) / 2, vw / 2, 1e-6, 'centred x'); near((a.y + b.y) / 2, vh / 2, 1e-6, 'centred y');
  }
  eq(W.fitCam([], 800, 600), { tx: 48, ty: 48, k: 1 });
  eq(W.fitCam([{ x: 0, y: 0, w: 100, h: 100 }], 1000, 1000).k, 1, 'a small layout stays at 100 % (kMax 1)');
});

test('maths: gridBg — two layers fixed to the world (dots on multiples of 32 and 128 at every zoom, never re-spaced), the fine layer fading smoothly when zoomed out; visibleRect / intersects', () => {
  const onGrid = (c, L, step) => {
    ok(L.x >= 0 && L.x < L.size && L.y >= 0 && L.y < L.size, 'position inside one tile');
    const w = W.toWorld(c, L.x + L.size / 2, L.y + L.size / 2), m = v => { const r = ((v % step) + step) % step; return r < step / 2 ? r : r - step; };
    near(m(w.x), 0, 1e-6, 'x on the grid'); near(m(w.y), 0, 1e-6, 'y on the grid');
  };
  for (const c of [{ tx: 13, ty: -57, k: 1 }, { tx: 1000.5, ty: 3, k: 0.3 }, { tx: -77, ty: 41, k: 2 }, { tx: 5, ty: 5, k: 0.25 }]) {
    const g = W.gridBg(c);
    near(g.minor.size, 32 * c.k, 1e-9, 'fine dots: exactly 32 world px apart'); near(g.major.size, 128 * c.k, 1e-9, 'major: 128');
    onGrid(c, g.minor, 32); onGrid(c, g.major, 128);
  }
  eq([W.gridBg({ tx: 0, ty: 0, k: 1 }).minor.a, W.gridBg({ tx: 0, ty: 0, k: 0.25 }).minor.a, W.gridBg({ tx: 0, ty: 0, k: 0.5 }).minor.a], [1, 0, 0.43], 'full at 100 %, gone at 25 %, between at 50 %');
  // a pinch from 25 % to 200 %: the fine layer's alpha only ever creeps (no step) and never goes back down
  let prev = -1;
  for (let k = 0.25; k <= 2; k += 0.005) { const a = W.gridBg({ tx: 0, ty: 0, k }).minor.a; ok(a >= prev && a - Math.max(prev, 0) <= 0.03, 'smooth at k ' + k.toFixed(3)); prev = a; }
  eq('gridImage' in W, false, '1g: no CSS background grid any more');
  eq(W.visibleRect({ tx: 100, ty: 50, k: 2 }, 800, 600, 0), { x: -50, y: -25, w: 400, h: 300 });
  eq(W.visibleRect({ tx: 0, ty: 0, k: 0.5 }, 100, 100, 50), { x: -100, y: -100, w: 400, h: 400 }, 'margin in screen px');
  eq([W.intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 }), W.intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })], [true, false]);
});

// a recording 2D context (plain object: path calls kept as data)
function recCtx() {
  const c = { calls: [], rects: [], arcs: [], fills: [], fillStyle: '' };
  for (const k of ['setTransform', 'clearRect', 'beginPath', 'moveTo']) c[k] = (...a) => c.calls.push([k, ...a]);
  c.rect = (x, y, w, h) => c.rects.push([x, y, w, h]);
  c.arc = (x, y, r) => c.arcs.push([x, y, r]);
  c.fill = () => c.fills.push(c.fillStyle);
  return c;
}
test('1g gridDraw: every dot on a whole device px of one origin (the major ones on the 128 multiples of the minor grid), sizes in whole device px, counts bounded, nothing below GRID_MIN_DPX, the fade of gridBg', () => {
  eq([W.GRID_MIN_DPX, W.GRID_MAX_DOTS], [6, 40000]);
  eq([W.gridSizes(1), W.gridSizes(2), W.gridSizes(3)], [{ side: 2, r: 1.5 }, { side: 3, r: 2 }, { side: 5, r: 3.5 }], 'device px: squares of whole px, discs on the squares\' centres');
  // (hotfix 2) a store below the device ratio (q device px per store px): the device sizes in whole store px (a square
  // rounded up), half px discs — dpr 2 on a 1× store: 2 store px (4 device: the 3 rounded up), r 1 (2 device, as at 2×)
  eq([W.gridSizes(1, 1), W.gridSizes(1, 2), W.gridSizes(1, 3), W.gridSizes(2, 1.5)], [{ side: 2, r: 1.5 }, { side: 2, r: 1 }, { side: 2, r: 1 }, { side: 4, r: 2.5 }]);
  const R = rng(5);
  for (let i = 0; i < 80; i++) {
    const d = [1, 2, 3][i % 3], q = i % 4 === 3 ? 2 : 1, c = { tx: (R() - 0.5) * 3000, ty: (R() - 0.5) * 3000, k: 0.25 + R() * 1.75 }, w = Math.round((300 + R() * 1200) * d), h = Math.round((200 + R() * 900) * d);
    const x = recCtx(), n = W.gridDraw(x, c, w, h, d, q), Z = W.gridSizes(d, q), o = Z.side >> 1, cc = Z.side / 2 - o, sp = 32 * c.k * d, a = W.gridBg(c).minor.a;
    eq(x.calls[0], ['setTransform', 1, 0, 0, 1, 0, 0]); eq(x.calls[1], ['clearRect', 0, 0, w, h], 'cleared first');
    // the dot whose world point is (I·32, J·32): round((I·32·k + t)·d)
    const idx = (p, t) => (p / d - t) / (32 * c.k);
    for (const [rx, ry, rw, rh] of x.rects) {
      eq([rw, rh], [Z.side, Z.side]);
      const X = rx + o, Y = ry + o, I = Math.round(idx(X, c.tx)), J = Math.round(idx(Y, c.ty));
      eq([X, Y], [Math.round((I * 32 * c.k + c.tx) * d), Math.round((J * 32 * c.k + c.ty) * d)], 'a minor dot on its whole device px');
      ok(!(I % 4 === 0 && J % 4 === 0), 'no minor dot under a major one');
    }
    for (const [ax, ay, r] of x.arcs) {
      eq(r, Z.r);
      const X = ax - cc, Y = ay - cc, I = Math.round(idx(X, c.tx)), J = Math.round(idx(Y, c.ty));
      ok(Number.isInteger(X) && Number.isInteger(Y), 'whole px');
      eq([X, Y, I % 4 === 0, J % 4 === 0], [Math.round((I * 32 * c.k + c.tx) * d), Math.round((J * 32 * c.k + c.ty) * d), true, true], 'a major dot = the minor-grid point at a multiple of 128');
    }
    eq([n.minor, n.major], [x.rects.length, x.arcs.length]);
    ok(n.minor + n.major <= W.GRID_MAX_DOTS, 'bounded');
    const want = a > 0 && sp * q >= W.GRID_MIN_DPX;
    eq(n.minor > 0, want && (w / sp) * (h / sp) > 16, 'the fine layer only while it shows (alpha) and ≥ 6 device px apart');
    if (n.minor) eq(x.fills[0], 'rgba(233, 231, 226, ' + Math.round(0.15 * a * 1000) / 1000 + ')', 'its alpha: gridBg\'s fade');
    eq(x.fills.at(-1), 'rgba(233, 231, 226, 0.24)', 'the major dots always');
  }
  // below the threshold (a 0.5 px spacing): no dots at all
  const x = recCtx(); eq(W.gridDraw(x, { tx: 0, ty: 0, k: 0.01 }, 800, 600, 1), { minor: 0, major: 0 }, 'k 0.01 (outside the camera range): nothing');
  // a 1440 × 900 window at dpr 2, 100 %: the fine dots (a few thousand) and the major ones; at 25 % only the major ones
  const y = recCtx(), n1 = W.gridDraw(y, { tx: 0, ty: 0, k: 1 }, 2880, 1800, 2), z = recCtx(), n2 = W.gridDraw(z, { tx: 0, ty: 0, k: 0.25 }, 2880, 1800, 2);
  ok(n1.minor > 1000 && n1.minor < 1400 && n1.major > 60 && n1.major < 120, JSON.stringify(n1));
  eq(n2.minor, 0); ok(n2.major > 1000 && n2.major < 1400, JSON.stringify(n2));
});

test('planScreen: an item is on screen when it meets the viewport grown by the margin (screen px, at every zoom); no rect → on', () => {
  const vw = 1000, vh = 600;
  const items = [
    { id: 'far', rect: { x: 1400, y: 0, w: 100, h: 100 } },   // 400 px right of the view at k 1
    { id: 'edge', rect: { x: 1200, y: 0, w: 100, h: 100 } },  // 200 px out: inside the 256 px margin
    { id: 'mid', rect: { x: 450, y: 250, w: 100, h: 100 } },
    { id: 'none', rect: null },
  ];
  eq(W.planScreen(items, { tx: 0, ty: 0, k: 1 }, vw, vh), { on: ['edge', 'mid', 'none'], off: ['far'] });
  eq(W.planScreen(items, { tx: 0, ty: 0, k: 1 }, vw, vh, 0), { on: ['mid', 'none'], off: ['far', 'edge'] }, 'no margin');
  // k 0.25: the view covers 4000 × 2400 world px (+ 1024 for the margin): everything; k 2: 500 × 300 (+ 128)
  eq(W.planScreen(items, { tx: 0, ty: 0, k: 0.25 }, vw, vh).off, [], 'zoomed out: all on screen');
  eq(W.planScreen(items, { tx: 0, ty: 0, k: 2 }, vw, vh), { on: ['mid', 'none'], off: ['far', 'edge'] }, 'k 2: the margin is 128 world px');
  eq(W.planScreen([{ id: 'a', rect: { x: -400, y: 0, w: 100, h: 100 } }], { tx: 0, ty: 0, k: 2 }, vw, vh).off, ['a'], 'left of the view');
  eq(W.planScreen([{ id: 'a', rect: { x: -170, y: 0, w: 100, h: 100 } }], { tx: 0, ty: 0, k: 2 }, vw, vh).on, ['a'], '−170…−70 meets −128');
});

/* ------------------------------------------------------------------ the world on the fake DOM */
let T = 1000;
const timers = [];
const setT = (f, ms) => { timers.push({ f, at: T + (+ms || 0), live: true }); return timers.length; };
const clearT = id => { if (id && timers[id - 1]) timers[id - 1].live = false; };
const adv = ms => { // the clock moves on; due timers run in order
  const to = T + ms;
  for (;;) {
    let n = null;
    for (const x of timers) if (x.live && x.at <= to && (!n || x.at < n.at)) n = x;
    if (!n) break;
    T = Math.max(T, n.at); n.live = false; n.f();
  }
  T = to;
};
function setup(o = {}) {
  const d = dom.fresh(), win = d.defaultView, rq = [];
  win.document = d;
  T = 1000; timers.length = 0;
  // [data-wk-inset] trays for wk.visibleBand (the fake document has no querySelectorAll of its own)
  d.querySelectorAll = sel => (sel === '[data-wk-inset]' ? all(d.documentElement).filter(n => n.hasAttribute && n.hasAttribute('data-wk-inset')) : []);
  const vp = d.createElement('div'), w = d.createElement('div'), ov = d.createElement('div'), tb = d.createElement('div');
  vp.id = 'viewport'; vp.tabIndex = 0; w.id = 'world'; w.setAttribute('data-cv-world', ''); ov.id = 'overlay'; tb.id = 'cvToolbar';
  vp.append(w); d.body.append(vp, ov, tb);
  place(vp, 0, 100, 1000, 600); place(ov, 0, 100, 1000, 600);
  const prefs = new Map(o.prefs || []), store = { get: (k, def) => (prefs.has(k) ? prefs.get(k) : def), set: (k, v) => prefs.set(k, v) };
  const tidy = { n: 0 };
  const env = { win, doc: d, now: () => T, raf: f => { rq.push(f); return rq.length; }, caf: () => {}, setTimeout: setT, clearTimeout: clearT };
  const world = W.createWorld(vp, Object.assign({ world: w, overlay: ov, toolbar: tb, env, store, onTidy: () => tidy.n++,
    isBackground: el => !!el && el.classList.contains('bg') }, o.opts || {}));
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { const q = rq.splice(0); for (const f of q) f(T); T += 16; } };
  const events = [];
  for (const t of ['camera', 'movestart', 'cameraend', 'screen', 'budget', 'native', 'select', 'edit']) world.on(t, x => events.push([t, x]));
  // a world item: a positioned element (its body the owner's) logging its onScreen calls and counting its rect() reads
  function item(id, x, y, iw, ih, cost) {
    const el = d.createElement('div'), body = d.createElement('div');
    el.setAttribute('data-cv-mod', id); body.className = 'bg';
    el.append(body); w.append(el);
    const it = { id, el, body, cost, log: [], reads: 0, x, y, rect: () => { it.reads++; return { x: it.x, y: it.y, w: iw, h: ih }; },
      onScreen(on) { it.log.push(on ? 'on' : 'off'); if (on) el.removeAttribute('data-cv-off'); else el.setAttribute('data-cv-off', ''); } };
    return it;
  }
  return { d, win, vp, w, ov, tb, world, frame, events, item, prefs, tidy, rq };
}
const touch = (el, type, x, y, id, o = {}) => ptr(el, type, x, y, Object.assign({ pointerType: 'touch', pointerId: id, isPrimary: id === 1 }, o));
const mouse = (el, type, x, y, o = {}) => ptr(el, type, x, y, Object.assign({ pointerType: 'mouse', pointerId: 1, isPrimary: true }, o));
const names = evs => evs.map(e => e[0]);

test('createWorld: the transform string, the dot grid, --ik written only at a zoom end, movestart → camera → cameraend', () => {
  const { w, vp, world, frame, events } = setup();
  frame();
  eq(w.style.transform, 'translate(0px, 0px) scale(1)');
  const gc = vp.childNodes[0];
  eq([gc.localName, gc.className, gc.getAttribute('aria-hidden'), vp.childNodes[1] === w, gc.width, gc.height, gc.style.width, gc.style.height],
    ['canvas', 'cv-grid', 'true', true, 2256, 1456, '2256px', '1456px'], '1g: the grid canvas under #world, device px (dpr 1; hotfix 2: vw / GRID_REACH + GRID_OVER)');
  eq(w.style['--ik'], '1');
  world.setCamera({ tx: 10.25, ty: -4, k: 0.5 });
  eq(names(events.splice(0)), ['movestart', 'camera', 'camera', 'cameraend', 'lod'].slice(0, 4), 'one jump: movestart, the frame, the rounded rest, cameraend');
  eq(w.style.transform, 'translate(10px, -4px) scale(0.5)', 'at rest: whole device px (dpr 1)');
  eq(w.style['--ik'], '2', 'zoom end: --ik = 1/k');
  // a wheel zoom: frames write the transform, --ik waits for the end of the burst (150 ms after the last wheel)
  fire(vp, 'wheel', { clientX: 500, clientY: 400, deltaY: -100, ctrlKey: true });
  frame();
  ok(w.style.transform !== 'translate(10px, -4px) scale(0.5)', 'zoomed: ' + w.style.transform);
  eq([w.style['--ik'], world.busy, vp.hasAttribute('data-cv-busy')], ['2', true, true], 'not yet: the burst runs (will-change on)');
  adv(200); frame();
  eq(world.busy, false);
  near(+w.style['--ik'], 1 / world.k, 1e-9, '--ik at the end');
  const end = events.filter(e => e[0] === 'cameraend').pop()[1];
  eq([end.zoomed, vp.hasAttribute('data-cv-busy')], [true, false]);
  // a pan burst ends with zoomed: false and leaves --ik
  const ik = w.style['--ik'];
  world.panBy(30, 0); frame(); adv(200);
  eq([events.filter(e => e[0] === 'cameraend').pop()[1].zoomed, w.style['--ik']], [false, ik]);
});

test('hotfix gridFollow: the transform keeps every world point where the camera puts it (wrapped by whole MAJOR periods), covers the viewport at s ≥ 1; the store constants', () => {
  eq([W.GRID_OVER, W.GRID_MAX_PX, W.GRID_MAX_S, W.GRID_REACH], [256, 8e6, 2, 0.5]);
  const R = rng(19), vw = 1000, vh = 600, cw = vw + 256, ch = vh + 256;
  for (let i = 0; i < 300; i++) {
    const c0 = { tx: (R() - 0.5) * 3000, ty: (R() - 0.5) * 3000, k: 0.25 + R() * 1.75 };
    const c = i % 3 ? { tx: c0.tx + (R() - 0.5) * 2000, ty: c0.ty + (R() - 0.5) * 2000, k: c0.k } : { tx: (R() - 0.5) * 3000, ty: (R() - 0.5) * 3000, k: W.clampK(c0.k * (0.5 + R() * 1.5)) };
    const f = W.gridFollow(c0, c, cw, ch, vw, vh), P = 128 * c.k;
    near(f.s, c.k / c0.k, 1e-12, 's');
    ok(f.x <= 1e-6 && f.x > -P - 1e-6 && f.y <= 1e-6 && f.y > -P - 1e-6, 'wrapped into (−P, 0]');
    // a major world point (I·128, J·128): the camera puts it at w·k + t; the canvas point under it (the inverse transform)
    // is a major point of the drawing (its world = (p − t0) / k0 a whole multiple of 128)
    for (const [I, J] of [[0, 0], [3, -2], [-7, 5]]) {
      const sx = I * 128 * c.k + c.tx, sy = J * 128 * c.k + c.ty, wx = ((sx - f.x) / f.s - c0.tx) / c0.k, wy = ((sy - f.y) / f.s - c0.ty) / c0.k;
      near(wx / 128, Math.round(wx / 128), 1e-6, 'x on a major point'); near(wy / 128, Math.round(wy / 128), 1e-6, 'y on a major point');
    }
    if (f.s >= 1 - 1e-12 && P / f.s <= 256 + 1e-9) ok(f.ok, 'covers the viewport at s ≥ 1 (the overscan ≥ one period)');
  }
  // a pure pan: s 1, the translate is the camera delta less whole periods; nothing moves → 0, 0
  eq(W.gridFollow({ tx: 0, ty: 0, k: 1 }, { tx: 0, ty: 0, k: 1 }, cw, ch, vw, vh), { x: 0, y: 0, s: 1, ok: true });
  eq(W.gridFollow({ tx: 0, ty: 0, k: 1 }, { tx: -40, ty: 300, k: 1 }, cw, ch, vw, vh), { x: -40, y: 300 - 384, s: 1, ok: true });
  // a zoom out by 0.6 cannot be covered (the redraw's case)
  eq(W.gridFollow({ tx: 0, ty: 0, k: 1 }, { tx: 0, ty: 0, k: 0.6 }, cw, ch, vw, vh).ok, false);
});

test('hotfix: the grid canvas is drawn at rest only — boot, a burst\'s end, a write outside a burst, a resize / device-ratio change; a burst moves it by transform (no draw, no layout read)', () => {
  const { vp, w, win, world, frame } = setup();
  frame();
  const gc = vp.childNodes[0], ctx = gc.getContext('2d'), draws = () => ctx.calls.filter(c => c[0] === 'clearRect').length;
  const n0 = draws();
  eq([n0, world.gridStats().tf, gc.style.transform || ''], [1, '', ''], 'drawn once at boot, no transform');
  frame(5);
  eq(draws(), n0, 'frames without a camera change draw nothing');
  // a pan burst: N frames, 0 draws, N transform writes, no layout read
  let reads = 0;
  const gbr = vp.getBoundingClientRect.bind(vp);
  vp.getBoundingClientRect = () => { reads++; return gbr(); };
  const m0 = world.gridStats().moves, c0 = world.cam, N = 12;
  for (let i = 0; i < N; i++) { world.panBy(7.3, -3.1); frame(); }
  eq([draws(), world.gridStats().moves - m0, reads, world.busy], [n0, N, 0, true], 'a pan: no draw, a transform a frame, no layout read');
  const f = W.gridFollow(c0, world.cam, 2256, 1456, 1000, 600), st = world.gridStats();
  eq([st.tf, gc.style.transform], ['translate(' + f.x + 'px, ' + f.y + 'px) scale(1)', st.tf], 'the transform: gridFollow from the drawn camera');
  // the dot drawn for world (0, 0) (at rest: store px = round(t0·d)) lands, moved by the transform, on world (0, 0)'s
  // screen px after the pan — or on a dot one MAJOR period away from it (the wrap): the pattern is where the camera puts it
  const P = 128, mx = ((Math.round(c0.tx) + f.x) - world.cam.tx) / P, my = ((Math.round(c0.ty) + f.y) - world.cam.ty) / P;
  near(mx, Math.round(mx), 1 / P, 'x: the same screen px (± a store px of rounding)'); near(my, Math.round(my), 1 / P, 'y');
  // the burst ends: exactly one draw, at the rested camera, the transform gone
  adv(200); frame(3);
  eq([draws(), world.busy, world.gridStats().tf, gc.style.transform], [n0 + 1, false, '', ''], 'endBurst: one draw, transform reset');
  const xs = ctx.calls.slice(ctx.calls.findLastIndex(c => c[0] === 'clearRect')).filter(c => c[0] === 'rect' || c[0] === 'arc');
  ok(xs.length > 0 && xs.every(c => c[0] === 'rect' ? Number.isInteger(c[1]) && Number.isInteger(c[2]) : Number.isInteger(c[1] * 2) && Number.isInteger(c[2] * 2)), 'whole store px (a disc\'s centre: half) after the draw');
  // a programmatic jump outside a burst: one draw
  world.setCamera({ tx: 33.4, ty: -17, k: 0.7 }); frame(2);
  eq([draws(), world.gridStats().tf], [n0 + 2, ''], 'a jump: one draw');
  const n1 = draws();
  world.resize(); frame(2);
  eq(draws(), n1, 'a resize that changes nothing: no draw');
  place(vp, 0, 100, 900, 600); world.resize();
  eq([gc.width, gc.height, gc.style.width, draws()], [2056, 1456, '2056px', n1 + 1], 'a resize: sized (vw / GRID_REACH + GRID_OVER) and drawn once');
  win.devicePixelRatio = 2; world.resize();
  eq([gc.width, gc.height, gc.style.width, gc.style.height, world.gridStats().s, draws()], [2056, 1456, '2056px', '1456px', 1, n1 + 2], 'dpr 2: over GRID_MAX_PX at 2× — the overscan wins, the store at 1× (CSS-sized)');
  // a resize inside a burst: drawn at once (the store was cleared), at the camera — no transform
  world.panBy(50, 0); frame();
  place(vp, 0, 100, 900, 500); world.resize();
  eq([draws(), world.gridStats().tf, world.busy], [n1 + 3, '', true], 'a resize in a burst: drawn once, no transform');
  adv(200); frame(2);
  eq(draws(), n1 + 3, 'its end: already drawn there (no second draw)');
  // stats
  const st2 = world.gridStats(true);
  ok(st2.n >= 5 && st2.dots > 0 && st2.max >= 0, JSON.stringify(st2));
  eq([world.gridStats().n, world.gridStats().moves], [0, 0], 'reset');
  world.destroy();
  eq([gc.width, gc.height, vp.childNodes.includes(gc)], [0, 0, false], 'destroy: released and removed');
  void w;
});

test('hotfix 2: inside a burst nothing is drawn, whatever the zoom (in ×8, out past GRID_REACH: the store only scales, bare strips accepted), one draw at rest; the store: overscan over scale under GRID_MAX_PX', () => {
  const { vp, world, frame, win } = setup();
  frame(); world.setCamera({ tx: 0, ty: 0, k: 0.25 }); frame(); adv(400); frame();
  const gc = vp.childNodes[0], ctx = gc.getContext('2d'), draws = () => ctx.calls.filter(c => c[0] === 'clearRect').length;
  const step = (f, n = 1) => { for (let i = 0; i < n; i++) { if (f) world.zoomAt(f, 500, 400); else world.panBy(0.01, 0); frame(); adv(0); } };
  const scaleOf = () => { const m = /scale\(([^)]+)\)/.exec(world.gridStats().tf); return m ? +m[1] : 1; };
  const n0 = draws();
  step(1.25, 3); // ×1.95
  eq([draws(), world.busy], [n0, true], 'a zoom in under ×2: no draw');
  step(1.3, 6); // ×8 (K_MAX)
  eq([draws(), world.k], [n0, 2], 'past ×2, to ×8: no draw (the store stretches)');
  near(scaleOf(), 8, 1e-9, 'stretched ×8: ' + world.gridStats().tf);
  step(0, 20); // ≈ 330 ms more of the burst: no timed redraw either
  eq(draws(), n0, 'never in the burst');
  adv(200); frame(2);
  eq([world.busy, draws(), world.gridStats().tf], [false, n0 + 1, ''], 'the end: one draw at rest, the transform gone');
  // a zoom out: covered to GRID_REACH (the store's overscan), then bare strips at the right / bottom — still no draw
  adv(400); frame();
  const n2 = draws(), st = world.gridStats(), c0 = world.cam, cov = () => W.gridFollow(c0, world.cam, st.w / st.s, st.h / st.s, 1000, 600).ok;
  step(0.6);
  eq([draws(), cov()], [n2, true], 'out ×0.6: covered by the overscan, no draw');
  step(0.6);
  eq([draws(), cov()], [n2, false], 'out ×0.36 (past GRID_REACH): uncovered strips, no draw');
  near(scaleOf(), 0.36, 1e-9);
  adv(200); frame(2);
  eq([draws(), world.gridStats().tf], [n2 + 1, ''], 'rest: drawn at the camera, full coverage');
  // the store (gridStore): a small window keeps 2×; a 13" iPad (1376 × 1032 at dpr 2) and a dpr-3 screen drop to 1×
  // (a whole device ratio) for the full reach; a 2560 × 1400 window at dpr 2 at 1× gives way on the reach; a 4K window
  // at dpr 2 keeps the old cap (reach 1, the overscan, then the scale below 1). Always ≤ GRID_MAX_PX, ≤ GRID_MAX_S.
  const R = rng(23);
  for (const [vw2, vh2, d, sWant, rWant] of [[400, 300, 2, 2, 0.5], [1376, 1032, 2, 1, 0.5], [1000, 700, 3, 1, 0.5], [2560, 1400, 2, 1, null], [3840, 2160, 2, null, 1]]) {
    place(vp, 0, 100, vw2, vh2); win.devicePixelRatio = d; world.resize();
    const g = world.gridStats(), tag = JSON.stringify([vw2, vh2, d, g.w, g.h, g.s, g.r]);
    eq(W.gridStore(vw2, vh2, d), { w: g.w, h: g.h, s: g.s, r: g.r }, 'gridStore: ' + tag);
    ok(g.w * g.h <= W.GRID_MAX_PX && g.s <= W.GRID_MAX_S, tag);
    if (sWant) eq(g.s, sWant, 'scale ' + tag); else ok(g.s < 1, 'scale capped (8.3 M CSS px: below 1) ' + tag);
    if (rWant) eq(g.r, rWant, 'reach ' + tag); else ok(g.r > 0.5 && g.r < 1, 'the reach gives way ' + tag);
    ok(g.w >= vw2 * g.s - 1 && g.h >= vh2 * g.s - 1, 'covers the viewport');
    // a zoom out to (just inside) the reach, from any rest camera, stays covered
    if (g.r < 1) for (let i = 0; i < 40; i++) {
      const a = { tx: (R() - 0.5) * 4000, ty: (R() - 0.5) * 4000, k: 0.25 + R() * 1.75 }, f = g.r * 1.01;
      const b = W.zoomAbout(a, f, R() * vw2, R() * vh2);
      ok(W.gridFollow(a, b, g.w / g.s, g.h / g.s, vw2, vh2).ok, 'covered to the reach ' + tag);
    }
    const last = ctx.calls.slice(ctx.calls.findLastIndex(c => c[0] === 'clearRect')), xs = last.filter(c => c[0] === 'rect');
    ok(xs.every(c => Number.isInteger(c[1]) && Number.isInteger(c[2])), 'whole store px under the cap too');
    const Z = W.gridSizes(g.s, d / g.s);
    ok(xs.every(c => c[3] === Z.side && c[4] === Z.side) && last.filter(c => c[0] === 'arc').every(c => c[3] === Z.r), 'the device-sized dots in store px ' + JSON.stringify(Z));
  }
  world.destroy();
});

/* ------------------------------------------------------------------ (1h) the GL path: a fake createGL through the world's options */
// a fake GL layer (IMPL-1h §2's surface): the canvas before #world, every draw / resize recorded, the world's loss hooks kept
function fakeGL(log) {
  return (vp, o) => {
    const cv = o.doc.createElement('canvas');
    cv.className = 'cv-gl'; vp.insertBefore(cv, o.world);
    const st = { frames: 0, ms: 0, max: 0, bytes: 0, texes: 0, lost: 0, w: 0, h: 0, d: 1 };
    let alive = true;
    const gl = { canvas: cv, hooks: o, test: !!o.test,
      resize(vw, vh, d) { log.push(['resize', vw, vh, d]); const w = Math.round(vw * d), h = Math.round(vh * d); if (w === st.w && h === st.h && d === st.d) return false; st.w = w; st.h = h; st.d = d; return true; },
      draw(cam, vw, vh, d, quads) { if (!alive) return false; log.push(['draw', cam.tx, cam.ty, cam.k, vw, vh, d, quads ? quads.length : -1]); st.frames++; return true; },
      upload() { return null; }, free() {}, stats(reset) { const s = Object.assign({}, st); if (reset) { st.frames = 0; st.ms = 0; st.max = 0; } return s; },
      destroy() { alive = false; log.push(['destroy']); cv.remove(); }, get alive() { return alive; } };
    return gl;
  };
}
const draws = log => log.filter(e => e[0] === 'draw').length;
// a bare world on a fresh fake document whose window carries a location / localStorage (the GL pref)
function bare(win0, createGL) {
  const d = dom.fresh(), win = d.defaultView;
  for (const k of Object.keys(win0)) Object.defineProperty(win, k, Object.getOwnPropertyDescriptor(win0, k)); // (a getter stays a getter)
  win.document = d; d.querySelectorAll = () => [];
  const vp = d.createElement('div'), w = d.createElement('div');
  vp.id = 'viewport'; w.id = 'world'; vp.append(w); d.body.append(vp); place(vp, 0, 0, 800, 600);
  const world = W.createWorld(vp, { world: w, env: { win, doc: d, now: () => T, raf: () => 1, caf: () => {}, setTimeout: setT, clearTimeout: clearT }, createGL });
  return { vp, world };
}

test('1h GL path: no .cv-grid canvas (the GL one before #world instead); one GL.draw per written frame, at rest, on resize / a device-ratio change — never without a change; FACES attached with { gl, world }; gridStats / glStats / rectOf', () => {
  const log = [];
  const { vp, w, win, world, frame, item } = setup({ opts: { createGL: fakeGL(log) } });
  frame();
  const cv = vp.childNodes[0];
  eq([cv.localName, cv.className, vp.childNodes[1] === w, dom.byCls(vp, 'cv-grid').length, world.glStats() !== null], ['canvas', 'cv-gl', true, 0, true], 'the GL canvas under #world, no 2D grid');
  const at = FACES.attachment();
  eq([!!at && at.world === world, !!at && at.gl.canvas === cv, !!at && at.gl.test], [true, true, false], 'FACES.attach({ gl, world }) after creation (no test flag)');
  eq([log[0][0], log[0].slice(1)], ['resize', [1000, 600, 1]], 'resize first: the buffer = the viewport at dpr');
  const n0 = draws(log);
  ok(n0 >= 1 && n0 <= 2, 'drawn at boot: ' + n0);
  eq(log.filter(e => e[0] === 'draw').pop().slice(1), [0, 0, 1, 1000, 600, 1, 0], 'the draw: the camera, the viewport, dpr, FACES.quads (the stub: none)');
  frame(5);
  eq(draws(log), n0, 'frames without a camera change: no draw');
  // a pan burst: one draw per written frame (the camera of that frame), no 2D store, no transform, no layout read
  let reads = 0;
  const gbr = vp.getBoundingClientRect.bind(vp);
  vp.getBoundingClientRect = () => { reads++; return gbr(); };
  const N = 12;
  for (let i = 0; i < N; i++) { world.panBy(7.3, -3.1); frame(); }
  const g = world.gridStats();
  eq([draws(log) - n0, reads, world.busy, g.gl, g.n, g.moves, g.dots, g.tf, g.w, g.h, g.s, g.r], [N, 0, true, true, n0 + N, 0, 0, '', 1000, 600, 1, 1], 'a pan: a draw a frame (gridStats: the GL draws, moves 0, dots 0, the buffer)');
  near(log.filter(e => e[0] === 'draw').pop()[1], 7.3 * N, 1e-9, 'the last draw at the written camera');
  eq(cv.style.transform || '', '', 'never transformed');
  const nb = draws(log);
  adv(200); frame(3);
  eq([draws(log) - nb, world.busy], [1, false], 'the burst\'s end: one draw at the rounded rest camera');
  eq(log.filter(e => e[0] === 'draw').pop().slice(1, 3), [Math.round(7.3 * N), Math.round(-3.1 * N)], 'crisp at rest');
  // a jump: one draw; a resize: resize + draw; a device-ratio change: resize at the new dpr + draw
  const n1 = draws(log);
  world.setCamera({ tx: 33.4, ty: -17, k: 0.7 }); frame(2);
  eq([draws(log), log.filter(e => e[0] === 'draw').pop().slice(1, 3)], [n1 + 2, [33, -17]], 'a jump: the frame and the rounded rest, a draw each (the 2D path: one draw, at rest)');
  world.setCamera({ tx: 40, ty: -17, k: 0.7 }); frame(2);
  eq(draws(log), n1 + 4, 'a jump that lands on device px: the frame, and the rest (endBurst always draws once: the contract\'s "at rest")');
  const r0 = log.filter(e => e[0] === 'resize').length;
  place(vp, 0, 100, 900, 600); world.resize(); frame(2);
  eq([log.filter(e => e[0] === 'resize').length - r0, log.filter(e => e[0] === 'resize').pop().slice(1), draws(log)], [1, [900, 600, 1], n1 + 5], 'a resize: the buffer re-sized, one draw');
  win.devicePixelRatio = 2; world.resize(); frame(2);
  eq([log.filter(e => e[0] === 'resize').pop().slice(1), draws(log), log.filter(e => e[0] === 'draw').pop()[6], world.gridStats().s], [[900, 600, 2], n1 + 6, 2, 2], 'dpr 2: the buffer at 2×, drawn with d 2');
  // glStats: GL.stats() + FACES.stats() (its bytes / gl renamed faceBytes / glFaces; (P) budget → faceBudget) + (P) the preset
  const n2 = draws(log), gs = world.glStats(), fs = FACES.stats();
  const was = ['base', 'bytes', 'd', 'dom', 'faceBytes', 'faces', 'frames', 'gl', 'glFaces', 'h', 'lost', 'max', 'ms', 'paintMax', 'paintMs', 'paints', 'queued', 'soft', 'softMin', 'texes', 'w', 'winPx', 'windows']; // (+ soft / softMin / winPx: 1h fixes B)
  const fk = Object.keys(fs).map(k => (k === 'bytes' ? 'faceBytes' : k === 'gl' ? 'glFaces' : k === 'budget' ? 'faceBudget' : k)); // ((P) cv-face's own: dE, budget, under …)
  eq(Object.keys(gs).sort(), [...new Set([...was, 'perf', ...fk])].sort());
  eq([gs.perf, 'budget' in gs, 'faceBudget' in gs], ['high', false, 'budget' in fs], '(P) the preset; FACES\' budget as faceBudget');
  eq([gs.gl, gs.frames, gs.w, gs.h, gs.faces, gs.faceBytes, gs.bytes], [true, n2, 1800, 1200, 0, 0, 0]);
  eq(world.glStats(true).frames, n2); eq(world.glStats().frames, 0, 'reset');
  eq(world.gridStats(true).n, 0, 'gridStats resets the same counters');
  // rectOf: the cached rect of an item (world px), null unknown, never a layout read
  const it = item('a', 100, 200, 300, 150);
  world.add(it);
  eq([world.rectOf('a'), world.rectOf(it.id), world.rectOf('nope'), world.rectOf(null)], [{ x: 100, y: 200, w: 300, h: 150 }, { x: 100, y: 200, w: 300, h: 150 }, null, null]);
  const reads0 = it.reads;
  for (let i = 0; i < 5; i++) world.rectOf('a');
  eq(it.reads, reads0, 'never a layout read');
  // destroy: FACES detached, the GL destroyed, its canvas gone
  world.destroy();
  eq([FACES.attachment(), log[log.length - 1][0], vp.childNodes.includes(cv)], [null, 'destroy', false]);
});

test('1h GL path: a context loss detaches FACES (the faces fall back to their DOM tier), a restore attaches again + redraws; the third loss (GL dead) builds the 2D grid live — drawn at rest, moved by transform in a burst, exactly the 2D path', () => {
  const log = [];
  let glObj = null;
  const S = setup({ opts: { createGL: (v, o) => (glObj = fakeGL(log)(v, o)) } });
  S.frame();
  ok(glObj && S.world.glStats(), 'on the GL path');
  const n0 = draws(log);
  glObj.hooks.onLost(false);
  eq([FACES.attachment(), S.world.glStats() !== null, draws(log)], [null, true, n0], 'lost: detached, the GL kept, no draw');
  glObj.hooks.onRestored();
  const at = FACES.attachment();
  eq([!!at && at.world === S.world, !!at && at.gl === glObj, draws(log)], [true, true, n0 + 1], 'restored: attached again, one redraw');
  // the third loss: the layer destroyed itself (onLost(true)) — the 2D grid canvas is built and drawn, the GL canvas gone
  glObj.destroy();
  glObj.hooks.onLost(true);
  const gc = S.vp.childNodes[0];
  eq([FACES.attachment(), S.world.glStats(), gc.className, S.vp.childNodes[1] === S.w, dom.byCls(S.vp, 'cv-gl').length, gc.width, gc.height], [null, null, 'cv-grid', true, 0, 2256, 1456], 'the 2D grid canvas, sized (the hotfix-2 store), the GL canvas gone');
  const ctx = gc.getContext('2d'), d2 = () => ctx.calls.filter(c => c[0] === 'clearRect').length;
  eq([d2(), S.world.gridStats().gl, S.world.gridStats().n], [1, undefined, 1], 'drawn once at the camera');
  const d0 = draws(log);
  for (let i = 0; i < 4; i++) { S.world.panBy(5, 0); S.frame(); }
  eq([d2(), draws(log), S.world.gridStats().moves, S.world.busy], [1, d0, 4, true], 'a burst: moved by transform, no draw (2D), no GL draw');
  adv(200); S.frame(2);
  eq([d2(), S.world.gridStats().tf], [2, ''], 'rest: one 2D draw');
  S.world.destroy();
});

test('1h: ?nogl / nogl=1 in the URL or the pref synth.cv.gl = "off" force the 2D path (createGL never called); "test" / ?gltest pass test: true (preserveDrawingBuffer); a throwing localStorage is ignored; a DOM without WebGL2 keeps the 2D path', () => {
  const tried = [];
  const mk = (vp, o) => { tried.push(!!o.test); return fakeGL([])(vp, o); };
  for (const [search, ls, want] of [['?nogl', null, 'off'], ['?a=1&nogl=1', null, 'off'], ['?nogl=1&b', null, 'off'], ['?noglx', null, 'gl'], ['', 'off', 'off'], ['', 'on', 'gl'], ['', 'test', 'test'], ['?gltest', 'off', 'test'], ['?gltest', null, 'test'], ['?nogl&gltest', 'test', 'off']]) {
    tried.length = 0;
    const w0 = { location: { search } };
    if (ls != null) w0.localStorage = { getItem: k => (k === 'synth.cv.gl' ? ls : null) };
    const { vp, world } = bare(w0, mk);
    const tag = JSON.stringify([search, ls]);
    eq([tried.length ? 'gl:' + tried[0] : 'off', vp.childNodes[0].className, world.glStats() === null], [want === 'off' ? 'off' : 'gl:' + (want === 'test'), want === 'off' ? 'cv-grid' : 'cv-gl', want === 'off'], tag);
    world.destroy();
  }
  const den = {};
  Object.defineProperty(den, 'localStorage', { get() { throw new Error('denied'); }, enumerable: true, configurable: true });
  const B = bare(den, mk);
  eq([B.vp.childNodes[0].className, B.world.glStats() !== null], ['cv-gl', true], 'a localStorage that throws (privacy mode): the GL path');
  B.world.destroy();
  // the default fake DOM has no WebGL2 (getContext('webgl2') → null): the real createGL yields null and the 2D grid is built
  const S = setup();
  S.frame();
  eq([S.vp.childNodes[0].className, S.world.glStats(), S.world.gridStats().gl, typeof S.world.rectOf], ['cv-grid', null, undefined, 'function'], 'no WebGL2: the 2D path (rectOf exists on both)');
  S.world.destroy();
});

test('1g: a resize that moves the viewport\'s top / left edge (the top tray\'s grip) keeps every world point where it was on the screen; one that keeps them moves nothing either', () => {
  const { vp, world, frame, events } = setup();
  world.setCamera({ tx: 40, ty: 30, k: 0.5 }); frame(); adv(200); frame();
  const p0 = world.toClient(400, 300), rs = [];
  world.on('resize', d => rs.push(d));
  events.length = 0;
  place(vp, 0, 180, 1000, 520); world.resize(); // the top tray grew by 80 px: the viewport's top went down, its height up
  const p1 = world.toClient(400, 300);
  eq([p1.x, p1.y, world.cam.tx, world.cam.ty, world.cam.k], [p0.x, p0.y, 40, -50, 0.5], 'the module stays put on the screen');
  eq([names(events).filter(n => n === 'camera').length, world.busy], [1, false], 'one written frame, no burst');
  eq(rs.map(d => [d.dx, d.dy, d.dw, d.dh]), [[0, 80, 0, -80]], 'announced with the edge delta (main.js: no default camera re-derived)');
  place(vp, 0, 180, 1000, 600); world.resize(); // the window grew below (the keyboard tray, a rotation): the edge stays
  const p2 = world.toClient(400, 300);
  eq([p2.x, p2.y, world.cam.ty], [p0.x, p0.y, -50], 'a resize that keeps the edges moves nothing');
  eq(rs.slice(1).map(d => [d.dx, d.dy, d.dh]), [[0, 0, 80]]);
  place(vp, 60, 180, 940, 600); world.resize(); // a left edge too (the height kept)
  const p3 = world.toClient(400, 300);
  eq([p3.x, p3.y], [p0.x, p0.y], 'left edge');
  // a window resize / rotation (both sizes change): the world stays on the viewport's top-left, as before
  const c4 = world.cam;
  place(vp, 0, 150, 1200, 700); world.resize(); place(vp, 60, 180, 940, 600); world.resize();
  eq([world.cam.tx, world.cam.ty], [c4.tx, c4.ty], 'a window resize: the camera kept');
  eq(rs.slice(-2).map(d => [d.dx, d.dy]), [[0, 0], [0, 0]]);
  // during an animation the target moves with the edge
  world.setCamera({ tx: 0, ty: 0, k: 1 }, { animate: true }); frame();
  place(vp, 60, 220, 940, 560); world.resize();
  frame(30); adv(300); frame();
  eq([world.cam.tx, world.cam.ty, world.cam.k], [0, -40, 1], 'the animation lands where its target went');
});

test('items: never a view(); onScreen from cached rects — once per crossing of the margin during a pan (no rect() read in the burst), re-read at cameraend / update; the screen event carries the changes', () => {
  const { world, frame, item, events } = setup();
  const a = item('a', 400, 200, 200, 200, 100), far = item('far', 1400, 0, 100, 100, 100);
  world.add(a); world.add(far);
  frame();
  eq([a.log, far.log], [[], ['off']], 'on screen from the start (nothing changes at add); the far one off');
  eq(events.filter(e => e[0] === 'screen').map(e => e[1]), [{ on: [], off: ['far'] }]);
  ok(!('view' in a) && a.el.childNodes.length === 1, 'the body is the owner\'s: never swapped');
  // a pan towards `far`: it comes on 256 px before it shows; rect() is not read during the burst
  const r0 = far.reads;
  events.length = 0;
  for (let i = 0; i < 10; i++) { world.panBy(-20, 0); frame(); }
  eq([far.log, far.reads], [['off', 'on'], r0], 'on once it is within the margin (cached rects only)');
  eq(events.filter(e => e[0] === 'screen').map(e => e[1]), [{ on: ['far'], off: [] }]);
  adv(200); frame();
  ok(far.reads > r0, 'cameraend: the rects are read again');
  // update(): a moved item is re-read and re-planned
  far.x = 9000; world.update('far'); frame();
  eq(far.log.at(-1), 'off');
  eq([world.onScreen('a'), world.onScreen('far')], [true, false]);
});

test('hotfix 2: a zoom burst writes no DOM but the camera\'s two transforms and the zoom text — its on-screen plan (data-cv-off, the screen event) and the % button\'s label wait for its end; a pan burst plans live as before', () => {
  const { vp, world, frame, item, events, tb } = setup();
  const a = item('a', 400, 200, 200, 200, 100), far = item('far', 1400, 0, 100, 100, 100);
  world.add(a); world.add(far);
  frame(); adv(400); frame();
  const pct = all(tb).find(n => n.classList && n.classList.contains('cv-tb-pct'));
  ok(!!pct, 'the % button');
  const lab0 = pct.getAttribute('aria-label');
  eq([far.log, lab0], [['off'], 'Zoom 100% — reset to 100 %']);
  // a pinch-like zoom out about the centre, 1 → 0.4 in 12 frames: far comes into view mid-burst (planScreen) …
  events.length = 0;
  for (let i = 0; i < 12; i++) { world.zoomAt(Math.pow(0.4, 1 / 12), 500, 400); frame(); }
  ok(world.busy && W.planScreen([{ id: 'far', rect: { x: 1400, y: 0, w: 100, h: 100 } }], world.cam, 1000, 600).on.length === 1, 'far is in view now');
  eq([far.log, far.el.hasAttribute('data-cv-off'), events.filter(e => e[0] === 'screen').length], [['off'], true, 0], '… but its plan waits (no attribute, no event mid-zoom)');
  eq([pct.textContent, pct.getAttribute('aria-label')], ['40%', lab0], 'the text follows the frames, the label waits');
  adv(200); frame(2);
  eq([world.busy, far.log, far.el.hasAttribute('data-cv-off'), events.filter(e => e[0] === 'screen').map(e => e[1])], [false, ['off', 'on'], false, [{ on: ['far'], off: [] }]], 'at rest: planned once');
  eq(pct.getAttribute('aria-label'), 'Zoom 40% — reset to 100 %', 'the label at rest');
  // a pan burst at that zoom still plans every frame (displays resume CULL_MARGIN early while panning)
  far.x = 3400; world.update('far'); frame();
  eq(far.log.at(-1), 'off');
  for (let i = 0; i < 20 && far.log.at(-1) === 'off'; i++) { world.panBy(-60, 0); frame(); }
  eq([world.busy, far.log.at(-1)], [true, 'on'], 'a pan: on mid-burst');
  void vp;
});

test('Z1: a zoom sweep 2 → 0.25 → 1 leaves every item\'s attributes and children as they were (but data-cv-off / -sel / -edit); the DOM budget is a warning (budget event), nothing hidden', () => {
  const { vp, world, frame, item, events, d } = setup();
  const a = item('a', 0, 0, 900, 500, 6000), b = item('b', 1100, 0, 700, 400, 6000);
  const knob = d.createElement('div'); knob.className = 'knob'; a.body.append(knob);
  const warn = console.warn; let warned = 0;
  console.warn = () => { warned++; };
  try {
    world.add(a); world.add(b);
  } finally { console.warn = warn; }
  eq([events.filter(e => e[0] === 'budget').map(e => e[1]), warned], [[{ over: true, cost: 12000 }], 1], 'past BUDGET_EL: one event and one warning');
  const snap = it => {
    const out = [];
    const walk = n => { out.push(n.localName + '|' + [...n._a].filter(([k]) => !/^data-cv-(off|sel|edit)$/.test(k)).map(x => x.join('=')).join(',') + '|' + JSON.stringify(n.style)); for (const c of n.childNodes) if (c.nodeType === 1) walk(c); };
    walk(it.el);
    return out.join('\n');
  };
  world.setCamera({ tx: 0, ty: 0, k: 2 }); frame(2);
  const s0 = [snap(a), snap(b)];
  const at = { cx: 500, cy: 400 };
  win2touches(vp, 2);
  for (let i = 0; i < 12; i++) { world.hooks.zoom(0.84, 500, 400, at); frame(); eq([snap(a), snap(b)], s0, 'mid-pinch (k ' + world.k.toFixed(2) + ')'); }
  win2touches(vp, 0); adv(200); frame(2);
  ok(world.k < 0.3, 'k ' + world.k);
  eq([snap(a), snap(b)], s0, 'zoomed out: the same modules');
  world.setCamera({ tx: 0, ty: 0, k: 1 }); frame(2);
  eq([snap(a), snap(b)], s0, 'back at 1');
  world.remove('b');
  eq(events.filter(e => e[0] === 'budget').at(-1)[1], { over: false, cost: 6000 }, 'back under: another event');
});

test('controls sleep below READ_K: a press in a module body pans (the control never sees it, nor its click); a tap selects, a double-tap focuses (edit state wakes them); the wheel is vetoed; the bar always works', () => {
  const { vp, world, frame, item, d } = setup();
  const m = item('m', 0, 0, 900, 500);
  world.add(m);
  const ctl = d.createElement('button'), bar = d.createElement('div');
  bar.setAttribute('data-cv-bar', '');
  m.body.append(ctl); m.el.append(bar);
  let downs = 0, clicks = 0, barDowns = 0;
  ctl.addEventListener('pointerdown', () => downs++); ctl.addEventListener('click', () => clicks++); bar.addEventListener('pointerdown', () => barDowns++);
  world.setCamera({ tx: 0, ty: 0, k: 0.4 }); frame();
  touch(ctl, 'pointerdown', 200, 300, 1); touch(vp, 'pointermove', 240, 300, 1); touch(vp, 'pointerup', 240, 300, 1);
  fire(ctl, 'click');
  eq([downs, clicks, world.cam.tx], [0, 0, 40], 'k 0.4: the press panned the camera');
  adv(500);
  touch(ctl, 'pointerdown', 200, 300, 1); touch(vp, 'pointerup', 200, 300, 1); fire(ctl, 'click');
  eq([world.selected, world.edit, downs, clicks], ['m', null, 0, 0], 'a tap selects the module; its click is the world\'s');
  adv(100);
  touch(ctl, 'pointerdown', 202, 300, 1); touch(vp, 'pointerup', 202, 300, 1);
  frame(30); adv(300); frame();
  eq([world.edit, world.k], ['m', 1], 'a double-tap focuses it: 100 %, edit state');
  touch(ctl, 'pointerdown', 200, 300, 1); touch(ctl, 'pointerup', 200, 300, 1);
  eq(downs, 1, 'awake: the control takes its press');
  // in edit state its controls stay awake even below READ_K (a pinned focus)
  world.setCamera({ tx: 0, ty: 0, k: 0.4 }); world.select('m'); frame();
  adv(400);
  eq(world.wheelVeto(), true, 'below READ_K no knob takes the wheel');
  touch(bar, 'pointerdown', 50, 110, 1); touch(bar, 'pointerup', 50, 110, 1);
  eq(barDowns, 1, 'the bar always gets its press (it moves the module)');
  world.setCamera({ tx: 0, ty: 0, k: 0.6 }); frame(); adv(400);
  touch(ctl, 'pointerdown', 200, 300, 1); touch(ctl, 'pointerup', 200, 300, 1);
  eq([downs, world.wheelVeto()], [2, false], 'k 0.6: as today');
});
function win2touches(vp, n) { // the window's touch count (touchstart / touchend carry e.touches)
  const win = vp.ownerDocument.defaultView;
  win.dispatchEvent(new Ev(n ? 'touchstart' : 'touchend', { touches: Array.from({ length: n }, (_, i) => ({ identifier: i })) }));
}

test('hooks (gesture.js): claimed only inside the band, not natively zoomed, zoom only in canvas pinch mode; a pinch keeps the content under the midpoint', () => {
  const { world, frame } = setup();
  frame();
  eq(world.hooks.pan(10, 0, { cx: 500, cy: 50 }), false, 'above the viewport (a tray): not the canvas');
  eq(world.hooks.pan(-10, 5, { cx: 500, cy: 400 }), true);
  eq(cam(world.cam), { tx: 10, ty: -5, k: 1 }, 'scroll convention: the camera moves with the fingers (−sx)');
  const c0 = world.cam, p0 = W.toWorld(c0, 300, 200); // client (300, 300) = local (300, 200)
  ok(world.hooks.zoom(1.5, 300, 300, { cx: 300, cy: 300 }));
  const p1 = W.toWorld(world.cam, 300, 200);
  near(p1.x, p0.x, 1e-9); near(p1.y, p0.y, 1e-9);
  eq(world.hooks.zoom(1, 300, 300, { cx: 300, cy: 300 }), true, 'the engagement probe (f = 1) is claimed, nothing moves');
  world.setPinchMode('page');
  const c1 = cam(world.cam);
  eq([world.hooks.zoom(1.2, 300, 300, { cx: 300, cy: 300 }), world.hooks.pan(5, 5, { cx: 300, cy: 300 }), world.pinchMode, cam(world.cam)], [false, false, 'page', c1], 'page mode (SPEC §4.3): two fingers are the browser\'s — the canvas pans with one finger only');
  world.setPinchMode('canvas');
  eq(world.hooks.pan(5, 5, { cx: 300, cy: 300 }), true);
  world.setPinchMode('page');
  world.setActive(false);
  eq(world.hooks.pan(5, 5, { cx: 300, cy: 300 }), false, 'ROLL shown: never');
});

test('native hand-over: visualViewport.scale 1.5 → hooks false, [data-cv-native], no own pan, the toolbar chip; back at 1 → the camera again', () => {
  const d0 = dom.fresh(); // (the visual viewport must exist before createWorld listens to it)
  const vv = new (Object.getPrototypeOf(d0.defaultView).constructor)();
  vv.scale = 1; vv.width = 1280; vv.height = 800; vv.offsetLeft = 0; vv.offsetTop = 0;
  const { win } = { win: d0.defaultView };
  win.visualViewport = vv;
  const vp = d0.createElement('div'), w = d0.createElement('div'), ov = d0.createElement('div'), tb = d0.createElement('div');
  w.setAttribute('data-cv-world', ''); vp.append(w); d0.body.append(vp, ov, tb); place(vp, 0, 100, 1000, 600);
  const rq = [], env = { win, doc: d0, now: () => T, raf: f => { rq.push(f); return 1; }, caf: () => {}, setTimeout: setT, clearTimeout: clearT };
  const world = W.createWorld(vp, { world: w, overlay: ov, toolbar: tb, env });
  const got = [];
  world.on('native', x => got.push(x.on));
  const chip = all(tb).find(n => n.getAttribute && n.getAttribute('data-cv-tb') === 'native');
  eq([world.native, chip.hidden], [false, true]);
  world.setToolbarCollapsed(true); // the page-zoomed chip is a notice, not a tool: it shows beside the one button too
  // (amended by fix B R1-F3, deliberately: a real pinch zoom shrinks the visual viewport to innerWidth / scale — the fake now does too;
  // a scale > 1 at the full width is the iPad app's stale reading, read as 1 — the next test)
  vv.scale = 1.5; vv.width = 1280 / 1.5; vv.dispatchEvent(new Ev('resize'));
  eq([world.native, vp.hasAttribute('data-cv-native'), chip.hidden, got], [true, true, false, [true]]);
  eq([world.hooks.pan(5, 5, { cx: 300, cy: 300 }), world.hooks.zoom(1.2, 300, 300, { cx: 300, cy: 300 })], [false, false], 'every hook hands back');
  touch(vp, 'pointerdown', 300, 300, 1); touch(vp, 'pointermove', 360, 300, 1); touch(vp, 'pointerup', 360, 300, 1);
  eq(cam(world.cam), { tx: 0, ty: 0, k: 1 }, 'no own pan: the browser pans the zoomed page');
  vv.scale = 1; vv.width = 1280; vv.dispatchEvent(new Ev('scroll'));
  eq([world.native, vp.hasAttribute('data-cv-native'), chip.hidden, got], [false, false, true, [true, false]]);
  eq(world.hooks.pan(5, 5, { cx: 300, cy: 300 }), true);
  world.destroy();
});

// (fix B R1-F3) WebKit in the iPad app leaves visualViewport.scale at 1.333 (= 1376 / 1032) after a Home round trip while the visual
// viewport's width stays the window's — a state no real pinch zoom produces (a zoom shrinks the width to innerWidth / scale) and no
// correct browser reports: it is read as scale 1. A real zoom (the width shrunk) still hands over.
test('native hand-over guard: visualViewport.scale 1.333 with the width still innerWidth (the iPad app after a Home round trip) → no hand-over, no chip; scale 1.5 with the width innerWidth / 1.5 (a real pinch) → hand-over', () => {
  const d0 = dom.fresh();
  const vv = new (Object.getPrototypeOf(d0.defaultView).constructor)();
  vv.scale = 1; vv.width = 1280; vv.height = 800; vv.offsetLeft = 0; vv.offsetTop = 0;
  const win = d0.defaultView;
  win.visualViewport = vv;
  const vp = d0.createElement('div'), w = d0.createElement('div'), ov = d0.createElement('div'), tb = d0.createElement('div');
  w.setAttribute('data-cv-world', ''); vp.append(w); d0.body.append(vp, ov, tb); place(vp, 0, 100, 1000, 600);
  const rq = [], env = { win, doc: d0, now: () => T, raf: f => { rq.push(f); return 1; }, caf: () => {}, setTimeout: setT, clearTimeout: clearT };
  const world = W.createWorld(vp, { world: w, overlay: ov, toolbar: tb, env });
  const got = [];
  world.on('native', x => got.push(x.on));
  const chip = all(tb).find(n => n.getAttribute && n.getAttribute('data-cv-tb') === 'native');
  eq([win.innerWidth, world.native, chip.hidden], [1280, false, true]);
  // the stale reading: the scale flips to 1.333 after the app came back, the width unchanged (a resize, as WebKit fires it)
  vv.scale = 1.333; vv.dispatchEvent(new Ev('resize'));
  eq([world.native, vp.hasAttribute('data-cv-native'), chip.hidden, got], [false, false, true, []], 'not a zoom: the canvas keeps the pinch');
  eq(world.hooks.pan(5, 5, { cx: 300, cy: 300 }), true, 'the hooks still the canvas\'s');
  vv.width = 1279.5; vv.dispatchEvent(new Ev('scroll'));                   // (half a px of rounding is still the window's width)
  eq([world.native, got], [false, []]);
  // a real pinch zoom: the visual viewport shrinks to innerWidth / scale
  vv.scale = 1.5; vv.width = 1280 / 1.5; vv.dispatchEvent(new Ev('resize'));
  eq([world.native, vp.hasAttribute('data-cv-native'), chip.hidden, got], [true, true, false, [true]], 'a real zoom hands over');
  eq(world.hooks.pan(5, 5, { cx: 300, cy: 300 }), false);
  vv.scale = 1; vv.width = 1280; vv.dispatchEvent(new Ev('scroll'));
  eq([world.native, chip.hidden, got], [false, true, [true, false]]);
  world.destroy();
});

test('one finger / the mouse pans from empty canvas and module backgrounds, never from a control; middle button anywhere; a tap deselects, a double-tap fits', () => {
  const { vp, w, world, frame, item, d } = setup();
  const m = item('m', 100, 100, 400, 300);
  world.add(m);
  const knob = d.createElement('div'); knob.className = 'wk-knob'; m.body.append(knob);
  let knobDown = 0; knob.addEventListener('pointerdown', () => knobDown++);
  frame();
  mouse(vp, 'pointerdown', 600, 500); mouse(vp, 'pointermove', 602, 500); // (≤ 4 px: still a tap)
  eq(world.cam.tx, 0, 'inside the slop');
  mouse(vp, 'pointermove', 650, 520); mouse(vp, 'pointerup', 650, 520);
  frame();
  eq(cam(world.cam), { tx: 50, ty: 20, k: 1 }, 'mouse drag on empty canvas pans');
  mouse(m.body, 'pointerdown', 200, 300); mouse(vp, 'pointermove', 220, 300); mouse(vp, 'pointerup', 220, 300);
  eq(world.cam.tx, 70, 'a known background pans');
  mouse(knob, 'pointerdown', 200, 300); mouse(vp, 'pointermove', 260, 300); mouse(vp, 'pointerup', 260, 300);
  eq([world.cam.tx, knobDown], [70, 1], 'a control keeps its press');
  mouse(knob, 'pointerdown', 200, 300, { button: 1 }); mouse(vp, 'pointermove', 230, 310, { button: 1 }); mouse(vp, 'pointerup', 230, 310, { button: 1 });
  eq([world.cam.tx, world.cam.ty], [100, 30], 'middle button: pans from anywhere');
  touch(w, 'pointerdown', 700, 600, 1); touch(vp, 'pointermove', 690, 590, 1); touch(vp, 'pointerup', 690, 590, 1);
  eq(world.cam.tx, 90, 'a finger on #world pans');
  adv(500);
  // tap a module background: selected; tap empty canvas: deselected; double-tap empty canvas: fit
  touch(m.body, 'pointerdown', 300, 300, 1); touch(vp, 'pointerup', 300, 300, 1);
  eq(world.selected, 'm');
  adv(500);
  touch(vp, 'pointerdown', 900, 650, 1); touch(vp, 'pointerup', 900, 650, 1);
  eq(world.selected, null);
  adv(100);
  touch(vp, 'pointerdown', 905, 652, 1); touch(vp, 'pointerup', 905, 652, 1);
  frame(30);
  const f = W.fitCam([m.rect()], 1000, 600);
  eq(cam(world.cam), cam(f), 'double-tap → fit (animated to it)');
});

test('momentum: a flicked touch glides and decays; a touch ≤ 120 ms after (or during) the glide only stops it — the control under it never sees the press', () => {
  const { vp, world, frame, item, d } = setup();
  const m = item('m', 0, 0, 900, 500);
  world.add(m);
  const knob = d.createElement('div'); m.body.append(knob);
  let presses = 0; knob.addEventListener('pointerdown', () => presses++);
  frame();
  touch(vp, 'pointerdown', 500, 300, 1);
  for (let i = 1; i <= 6; i++) { T += 16; touch(vp, 'pointermove', 500 - 20 * i, 300, 1); }
  touch(vp, 'pointerup', 380, 300, 1);
  const x0 = world.cam.tx;
  frame(5);
  ok(world.cam.tx < x0 - 20, 'gliding on: ' + x0 + ' → ' + world.cam.tx);
  ok(world.busy, 'the burst lasts while it glides');
  // a touch during the glide: consumed (stopImmediatePropagation), the glide stops, the knob never sees it
  let clicks = 0; knob.addEventListener('click', () => clicks++);
  const e = touch(knob, 'pointerdown', 200, 200, 2, { isPrimary: true });
  ok(e._imm, 'consumed');
  const x1 = world.cam.tx;
  frame(3);
  eq([presses, world.cam.tx], [0, x1], 'stopped, no press');
  touch(vp, 'pointerup', 200, 200, 2);
  fire(knob, 'click', { detail: 1 }); // (the browser's click after the lift)
  eq([clicks, world.selected], [0, null], 'nor its click; no selection');
  // a glide that ran out: a touch within 120 ms is still eaten, after it the knob works
  touch(vp, 'pointerdown', 500, 300, 1);
  for (let i = 1; i <= 4; i++) { T += 16; touch(vp, 'pointermove', 500 - 6 * i, 300, 1); }
  touch(vp, 'pointerup', 476, 300, 1);
  for (let i = 0; i < 300 && world.busy; i++) frame();
  eq(world.busy, false, 'the glide ended');
  T += 60;
  touch(knob, 'pointerdown', 200, 200, 3, { isPrimary: true }); touch(vp, 'pointerup', 200, 200, 3);
  eq(presses, 0, '60 ms after: eaten');
  T += 200;
  touch(knob, 'pointerdown', 200, 200, 4, { isPrimary: true });
  eq(presses, 1, 'after the guard: the knob\'s press');
});

test('late finger: a second touch during a live one-finger pan becomes a pinch — no child sees it, the content under the midpoint stays put, the camera is never rolled back', () => {
  const { vp, world, frame, item, d } = setup();
  const m = item('m', 0, 0, 900, 500);
  world.add(m);
  const knob = d.createElement('div'); m.body.append(knob);
  let presses = 0; knob.addEventListener('pointerdown', () => presses++);
  frame();
  touch(vp, 'pointerdown', 400, 300, 1); T += 16; touch(vp, 'pointermove', 420, 300, 1); T += 16; touch(vp, 'pointermove', 440, 300, 1);
  eq(world.cam.tx, 40);
  T += 500;
  const e = touch(knob, 'pointerdown', 640, 300, 2, { isPrimary: false });
  ok(e._imm, 'taken in the capture phase');
  eq(presses, 0);
  // spread 200 → 400 about the midpoint (540, 300): engages past 6 px, then the ratio applies
  const before = W.toWorld(world.cam, 540, 200);
  touch(vp, 'pointermove', 437, 300, 1); // 203 px apart: 3 px of spread — below PINCH_PX, only the midpoint pans
  touch(vp, 'pointermove', 430, 300, 1); // 210: engaged (f starts at 1)
  near(world.k, 1, 1e-9, 'no jump at the engagement');
  touch(vp, 'pointermove', 340, 300, 1); touch(knob, 'pointermove', 740, 300, 2);
  const mid = W.toWorld(world.cam, 540 - 0, 200);
  ok(world.k > 1.5, 'zoomed in ' + world.k);
  near(mid.x, before.x + (W.toWorld({ tx: 40, ty: 0, k: 1 }, 540, 200).x - W.toWorld({ tx: 40, ty: 0, k: 1 }, 540, 200).x), 4, 'the midpoint\'s content stays under it (≤ the sub-PINCH_PX drift)');
  touch(vp, 'pointerup', 340, 300, 1);
  let clicks = 0; knob.addEventListener('click', () => clicks++);
  fire(knob, 'click', { detail: 1 });
  eq(clicks, 0, 'a lifted pinch finger\'s click is the pinch\'s');
  const k1 = world.k;
  touch(vp, 'pointermove', 760, 320, 2);
  eq(world.k, k1, 'one finger left: it pans on, no zoom');
  touch(vp, 'pointerup', 760, 320, 2);
  frame(3);
  eq([presses, world.busy], [0, false], 'the knob never pressed; no glide after a pinch');
});

test('late finger in \'Zoom page\' mode: the pan stops where it is, the finger presses nothing, the canvas never zooms (the browser\'s pinch has both)', () => {
  const { vp, world, frame, item, d } = setup({ prefs: [['synth.cv.pinch', 'page']] });
  const m = item('m', 0, 0, 900, 500);
  world.add(m);
  const knob = d.createElement('div'); m.body.append(knob);
  let presses = 0, clicks = 0; knob.addEventListener('pointerdown', () => presses++); knob.addEventListener('click', () => clicks++);
  frame();
  touch(vp, 'pointerdown', 400, 300, 1); T += 16; touch(vp, 'pointermove', 420, 300, 1); T += 16; touch(vp, 'pointermove', 440, 300, 1);
  eq(world.cam.tx, 40, 'one finger pans in page mode');
  T += 500;
  const e = touch(knob, 'pointerdown', 640, 300, 2, { isPrimary: false });
  touch(vp, 'pointermove', 340, 300, 1); touch(knob, 'pointermove', 740, 300, 2);
  eq([!!e._imm, presses, cam(world.cam)], [true, 0, { tx: 40, ty: 0, k: 1 }], 'taken; no pan, no zoom after it');
  fire(knob, 'click', { detail: 1 });
  eq(clicks, 0, 'its click is the gesture\'s');
  touch(vp, 'pointerup', 340, 300, 1); touch(knob, 'pointerup', 740, 300, 2);
  frame(3);
  eq([world.k, world.busy], [1, false]);
});

test('a two-finger cancel (gesture.js pairs a second finger with the panning one) keeps the camera: no jump back, no glide', () => {
  const { vp, world, frame } = setup();
  frame();
  touch(vp, 'pointerdown', 400, 300, 1); T += 16; touch(vp, 'pointermove', 430, 300, 1); T += 16; touch(vp, 'pointermove', 470, 300, 1);
  const tx = world.cam.tx;
  const c = new Ev('pointercancel', { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: 470, clientY: 300 });
  c.gesture = 'two-finger';
  vp.dispatchEvent(c);
  frame(5);
  eq([world.cam.tx, tx], [70, 70], 'kept (the session\'s hooks go on from here)');
  ok(world.hooks.pan(-10, 0, { cx: 470, cy: 300 }));
  eq(world.cam.tx, 80);
});

test('wheel: Ctrl / ⌘ zooms at the pointer (the content there stays), plain wheel pans, a defaultPrevented one is left alone, a scroller that can still scroll keeps it, Shift = horizontal', () => {
  const { vp, w, world, frame, item, d, win } = setup();
  const m = item('m', 0, 0, 900, 500);
  world.add(m);
  const list = d.createElement('div'); m.body.append(list);
  list._oy = 'auto'; list.scrollHeight = 400; place(list, 50, 150, 200, 100); list.scrollTop = 0;
  win.getComputedStyle = n => ({ overflowX: n._ox || 'visible', overflowY: n._oy || 'visible' });
  frame();
  const p0 = W.toWorld(world.cam, 300, 100);
  fire(vp, 'wheel', { clientX: 300, clientY: 200, deltaY: -50, ctrlKey: true });
  const p1 = W.toWorld(world.cam, 300, 100);
  ok(world.k > 1, 'zoomed in');
  near(p1.x, p0.x, 1e-9); near(p1.y, p0.y, 1e-9);
  adv(400);
  const c0 = world.cam;
  const e = fire(vp, 'wheel', { clientX: 600, clientY: 500, deltaX: 10, deltaY: 30 });
  eq([e.defaultPrevented, world.cam.tx - c0.tx, world.cam.ty - c0.ty], [true, -10, -30], 'pans (the page would scroll the other way)');
  adv(400);
  const c1 = world.cam;
  const taken = new Ev('wheel', { bubbles: true, cancelable: true, deltaY: 40, clientX: 600, clientY: 500 });
  taken.preventDefault();
  vp.dispatchEvent(taken);
  eq(world.cam.ty, c1.ty, 'a knob / editor took it');
  const s = fire(list, 'wheel', { clientX: 100, clientY: 200, deltaY: 40 });
  eq([s.defaultPrevented, world.cam.ty], [false, c1.ty], 'the list scrolls (it can go down)');
  list.scrollTop = 300;
  fire(list, 'wheel', { clientX: 100, clientY: 200, deltaY: 40 });
  eq(world.cam.ty, c1.ty - 40, 'at its end: the camera');
  adv(400);
  const c2 = world.cam;
  fire(vp, 'wheel', { clientX: 600, clientY: 500, deltaY: 25, shiftKey: true });
  eq([world.cam.tx - c2.tx, world.cam.ty - c2.ty], [-25, 0], 'Shift-wheel: horizontal');
  eq(w.style.transform.includes('scale('), true);
});

test('Ctrl / ⌘-wheel (a trackpad pinch) is the camera\'s even over a knob (taken in the capture phase: the knob never turns); a hovered editor zone keeps its own zoom (edit state or not) except during the camera\'s veto — never left to the browser', () => {
  const { vp, world, frame, item, d } = setup();
  const m = item('m', 0, 0, 900, 500);
  world.add(m); frame(2);
  let v = 0.5;
  const k = wk.knob({ label: 'CUT', get: () => v, set: n => { v = n; } });
  m.body.append(k.el); k.el.focus();
  const e = fire(k.el, 'wheel', { clientX: 300, clientY: 300, deltaY: -60, ctrlKey: true, timeStamp: 1e6 });
  eq([v, e.defaultPrevented], [0.5, true], 'the knob never saw it');
  ok(world.k > 1, 'zoomed: ' + world.k);
  adv(400);
  const cv = d.createElement('canvas'); m.body.append(cv); place(cv, 50, 150, 300, 100);
  let ed = 0;
  const zp = wk.zoomPan(cv, { get: () => ({ x0: 0, x1: 1, y0: 0, y1: 1 }), set: () => { ed++; } });
  world.select('m'); world.setCamera({ tx: 0, ty: 0, k: 1 });
  eq(world.edit, 'm');
  adv(400); // (past the wheel veto of that camera move)
  fire(cv, 'wheel', { clientX: 100, clientY: 200, deltaY: -60, ctrlKey: true });
  eq([ed, world.k], [1, 1], 'in edit state: the editor zooms itself');
  world.escape();
  eq(world.edit, null);
  const h = fire(cv, 'wheel', { clientX: 100, clientY: 200, deltaY: -60, ctrlKey: true });
  eq([ed, world.k, h.defaultPrevented], [2, 1, true], 'hovered, not in edit state: still the editor (SPEC §4.1: as today when hovered)');
  // the camera's zoom keeps the wheel through its veto: a selected module at 80 %, a slow Ctrl-wheel (notches 200 ms
  // apart) that crosses 90 % — the burst ends (edit state on) while the veto runs: no notch may fall to the browser
  world.select('m'); world.setCamera({ tx: 0, ty: 0, k: 0.8 }); adv(400);
  fire(vp, 'wheel', { clientX: 600, clientY: 500, deltaY: -60, ctrlKey: true }); // off the editor: the camera, past 0.9
  const k1 = world.k;
  ok(k1 > 0.9, 'k ' + k1);
  adv(200);
  eq(world.edit, 'm', 'the burst ended: edit state');
  const n2 = fire(cv, 'wheel', { clientX: 100, clientY: 200, deltaY: -60, ctrlKey: true });
  ok(n2.defaultPrevented && world.k > k1 && ed === 2, 'during the veto: the camera (prevented: the page never zooms) — k ' + world.k + ', ed ' + ed);
  const k2 = world.k;
  adv(400);
  const n3 = fire(cv, 'wheel', { clientX: 100, clientY: 200, deltaY: -60, ctrlKey: true });
  eq([n3.defaultPrevented, ed, world.k], [true, 3, k2], 'after a 300 ms pause: the editor');
  zp.destroy();
});

test('wheel veto: for 300 ms after a camera move the kit\'s knobs leave the wheel (wk.setWheelVeto); main.js reads world.wheelVeto()', () => {
  const { vp, world, frame, d } = setup();
  frame();
  let v = 0.5;
  const k = wk.knob({ label: 'CUT', get: () => v, set: n => { v = n; } });
  vp.firstChild.append(k.el);
  eq(world.wheelVeto(), false);
  fire(vp, 'wheel', { clientX: 600, clientY: 500, deltaY: 30 }); // the camera pans …
  eq(world.wheelVeto(), true);
  k.el.focus();
  fire(k.el, 'wheel', { deltaY: -100, timeStamp: 1e6 }); // … and the knob slid under the pointer (even a focused one)
  eq(v, 0.5, 'vetoed');
  T += 301;
  eq(world.wheelVeto(), false);
  fire(k.el, 'wheel', { deltaY: -100, timeStamp: 2e6 });
  ok(v > 0.5, 'after the window the knob takes it');
  world.destroy();
  T = 0; // (the veto is gone with the world)
  fire(k.el, 'wheel', { deltaY: -100, timeStamp: 3e6 });
  ok(v > 0.51, 'no world: no veto');
  void d;
});

test('Safari gesture* events: zoom by the scale ratio about the event point, preventDefault-ed; ignored while touches are down', () => {
  const { vp, world, frame } = setup();
  frame();
  const g1 = fire(vp, 'gesturestart', { scale: 1, clientX: 500, clientY: 400 });
  fire(vp, 'gesturechange', { scale: 1.2, clientX: 500, clientY: 400 });
  const g3 = fire(vp, 'gesturechange', { scale: 1.5, clientX: 500, clientY: 400 });
  fire(vp, 'gestureend', { scale: 1.5 });
  near(world.k, 1.5, 1e-9);
  ok(g1.defaultPrevented && g3.defaultPrevented, 'prevented (no page zoom)');
  win2touches(vp, 2);
  const g4 = fire(vp, 'gesturestart', { scale: 1 }); fire(vp, 'gesturechange', { scale: 2, clientX: 500, clientY: 400 });
  eq([world.k, g4.defaultPrevented], [1.5, false], 'touches down: the two-finger hooks own the pinch');
});

test('edit state: [data-cv-edit] iff selected and k ≥ 0.9; a tap outside or Escape leaves it; Escape order drag → edit → selection', () => {
  const { vp, world, frame, item, events } = setup();
  const a = item('a', 0, 0, 300, 200), b = item('b', 400, 0, 300, 200);
  world.add(a); world.add(b); frame(2);
  world.select('a');
  eq([world.selected, world.edit, a.el.hasAttribute('data-cv-sel'), a.el.hasAttribute('data-cv-edit')], ['a', 'a', true, true]);
  world.setCamera({ tx: 0, ty: 0, k: 0.8 });
  eq([world.edit, a.el.hasAttribute('data-cv-edit'), a.el.hasAttribute('data-cv-sel')], [null, false, true], 'k < 0.9: selected, not editing');
  world.setCamera({ tx: 0, ty: 0, k: 1 });
  eq(world.edit, 'a');
  // a tap outside the module (on another module's control) leaves edit state, the selection stays
  const ctl = b.el.ownerDocument.createElement('button'); b.body.append(ctl);
  touch(ctl, 'pointerdown', 500, 200, 1); touch(ctl, 'pointerup', 501, 200, 1);
  eq([world.edit, world.selected, a.el.hasAttribute('data-cv-edit')], [null, 'a', false], 'left by a tap outside');
  touch(b.body, 'pointerdown', 500, 200, 1); touch(b.body, 'pointerup', 501, 200, 1);
  eq([world.edit, world.selected], ['b', 'b'], 'a tap on b\'s background selects b (and k ≥ 0.9: editing it)');
  world.select('a');
  eq(world.edit, 'a');
  touch(a.body, 'pointerdown', 100, 150, 1); // a pan from a's own background (a press outside would leave edit state)
  eq(world.escape(), true, 'a live pan ends first');
  eq(world.edit, 'a');
  touch(vp, 'pointerup', 100, 150, 1);
  eq([world.escape(), world.edit, world.selected], [true, null, 'a'], 'then edit state');
  eq([world.escape(), world.selected, world.escape()], [true, null, false], 'then the selection; then nothing');
  ok(events.some(e => e[0] === 'edit' && e[1].id === 'a') && events.some(e => e[0] === 'select' && e[1].id === null));
});

test('focusItem: the item centred at k (fit when larger than the band), selected and in edit state; the same double-tap again goes back; reveal pans the least', () => {
  const { world, frame, item } = setup();
  const a = item('a', 1000, 1000, 400, 200);
  world.add(a); frame();
  world.setCamera({ tx: 0, ty: 0, k: 0.6 });
  world.focusItem('a', { animate: false });
  eq(cam(world.cam), { tx: 500 - 1200, ty: 300 + 100 - 1100 - 100, k: 1 }, 'centred at 100 % in the band (0, 100)–(1000, 700)');
  eq([world.selected, world.edit], ['a', 'a']);
  world.focusItem('a', { animate: false });
  eq(cam(world.cam), { tx: 0, ty: 0, k: 0.6 }, 'again: back to the camera before');
  const big = item('big', 0, 0, 3000, 2000);
  world.add(big);
  world.focusItem('big', { animate: false, edit: false });
  ok(world.k < 1, 'larger than the band: fit (' + world.k + ')');
  eq([world.selected, world.edit], ['big', null], 'edit: false');
  world.setCamera({ tx: 0, ty: 0, k: 1 });
  const mid = item('mid', 0, 0, 1500, 900);
  world.add(mid);
  world.focusItem('mid'); // (animated) a bar double-tap: edit state at its fit, below EDIT_K
  for (let i = 0; i < 30; i++) frame();
  ok(world.k < W.EDIT_K, 'fit k ' + world.k);
  eq([world.selected, world.edit], ['mid', 'mid'], 'pinned edit state at the double-tap\'s zoom');
  world.zoomAt(0.8, 500, 400);
  adv(200); frame();
  eq(world.edit, null, 'zoomed out past it: over');
  // a tall module whose fit would only show its card (a Serum in an iPad's canvas): its width framed at k, top aligned
  const tall = item('tall', 2000, 0, 800, 2400);
  world.add(tall);
  world.focusItem('tall', { animate: false });
  eq(cam(world.cam), { tx: 500 - 2400, ty: 48, k: 1 }, 'k 1, centred across, its top 48 px inside the band');
  eq([world.selected, world.edit], ['tall', 'tall']);
  const wide = item('wide', 0, 3000, 2600, 2400); // wider than the band even at READ_K: left aligned at READ_K
  world.add(wide);
  world.focusItem('wide', { animate: false, edit: false });
  eq(cam(world.cam), { tx: 48, ty: 48 - 1500, k: 0.5 });
  // reveal: a client rect just past the right edge of the band → the minimal pan
  world.setCamera({ tx: 0, ty: 0, k: 1 });
  world.reveal({ left: 980, top: 200, right: 1040, bottom: 230 });
  frame(30);
  eq(cam(world.cam), { tx: -56, ty: 0, k: 1 }, '16 px inside the band');
});

test('fit: the true fit with the 48 px margin — below 0.5 too (no card level any more), down to K_MIN', () => {
  const { world, frame, item } = setup();
  const a = item('a', 0, 0, 1900, 1100); // band 1000 × 600: 48 px pads → k = min(904/1900, 504/1100) ≈ 0.458
  world.add(a); frame();
  world.fit({ animate: false });
  near(world.k, Math.min(904 / 1900, 504 / 1100), 1e-9, 'the true fit');
  const b = item('b', 0, 0, 9000, 5000); world.remove('a'); world.add(b);
  world.fit({ animate: false });
  eq(world.k, W.K_MIN, 'clamped at K_MIN');
});

test('keys (focus in the viewport or on a module root / bar): 0 fits, 1 = 100 %, arrows nudge the selection one dot (Shift ×4) through onMove start / end; form controls and play keys are not the canvas\'s', () => {
  const { vp, world, frame, item, d } = setup();
  const a = item('a', 16, 24, 300, 200), moves = [];
  a.onMove = (x, y, ph) => moves.push(ph + ':' + x + ',' + y);
  a.setPos = (x, y) => { a.x = x; a.y = y; };
  world.add(a); frame();
  const key = (k, o = {}) => { const e = new Ev('keydown', Object.assign({ key: k, cancelable: true, bubbles: true }, o)); return [world.key(e), e.defaultPrevented]; };
  eq(key('ArrowRight'), [false, false], 'no focus on the canvas');
  vp.focus();
  eq(key('ArrowRight'), [false, false], 'nothing selected');
  world.select('a');
  eq(key('ArrowRight'), [true, true]);
  eq(key('ArrowDown', { shiftKey: true }), [true, true]);
  eq(moves, ['start:64,32', 'end:64,32', 'start:64,160', 'end:64,160'], 'snapping: onto the dots, a dot a time (Shift ×4); one start / end pair per press');
  eq(key('ArrowRight'), [true, true]);
  eq(moves.slice(-2), ['start:96,160', 'end:96,160'], 'always a dot: onto the dots first, then 32');
  eq(key('a'), [false, false], 'a play key');
  eq(key(' '), [false, false], 'Space');
  eq(key('a', { metaKey: true }), [true, true], '⌘A: select all (one selection in 1b)');
  eq(key('1'), [true, true]);
  eq(key('0'), [true, true]);
  frame(30);
  eq(cam(world.cam), cam(W.fitCam([a.rect()], 1000, 600)), '0: fit');
  const inp = d.createElement('input'); a.el.append(inp); inp.focus();
  eq(key('ArrowLeft'), [false, false], 'a focused input keeps its arrows');
  a.el.tabIndex = 0; a.el.focus();
  eq(key('ArrowLeft')[0], true, 'the module root itself');
});

test('dragPointer: edge auto-pan per wk.edgePan2 against the band (a pointer over a side tray = past the edge, full speed); each panned frame emits camera; ghost stays under a still pointer', () => {
  const { vp, d, world, frame, events } = setup();
  const tray = d.createElement('aside'); tray.setAttribute('data-wk-inset', 'left'); d.body.append(tray); place(tray, 0, 100, 44, 600);
  frame();
  eq(world.band(), { left: 44, top: 100, right: 1000, bottom: 700 }, 'the band: the viewport less the rail');
  const g = world.ghost({ x: 500, y: 400, w: 200, h: 100, label: 'Juno-60' });
  eq(g, { x: 416, y: 256, w: 200, h: 100 }, 'centred under the pointer, snapped to the dots (32)');
  // an outline larger than the canvas (a Serum's): its label moves into the visible part, at the band's top-left
  world.ghost({ x: 500, y: 400, w: 1200, h: 900, label: 'Serum · replaces Juno-60' });
  const gEl = all(d.documentElement).find(n => n.className === 'cv-ghost'), lab = all(d.documentElement).find(n => n.className === 'cv-ghost-label');
  const TF = s => /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(s);
  const gt = TF(gEl.style.transform), lt = TF(lab.style.transform);
  ok(lt, 'label moved: ' + lab.style.transform);
  near(+gt[1] + +lt[1], 44, 1, 'label x at the band\'s left'); near(+gt[2] + 100 + +lt[2], 100, 1, 'label y at the band\'s top');
  world.ghost({ x: 500, y: 400, w: 200, h: 100, label: 'Juno-60' });
  eq(lab.style.transform, '', 'a box inside the band: the label in its corner');
  events.length = 0;
  world.dragPointer({ x: 500, y: 400, pointerType: 'touch' }); // the drag comes onto the canvas (arms every direction) …
  frame();
  world.dragPointer({ x: 20, y: 400, pointerType: 'touch' }); // … then over the rail: past the left edge
  for (let i = 0; i < 20; i++) frame();
  ok(world.cam.tx > 100, 'the camera moves right (content follows: more of the left side): ' + world.cam.tx);
  ok(events.filter(e => e[0] === 'camera').length >= 15, 'a camera event per panned frame');
  // the ghost re-projects every frame: it stays under the pointer (500, 400) whatever the camera did
  const ghost = all(d.documentElement).find(n => n.className === 'cv-ghost');
  const tf = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(ghost.style.transform);
  near(+tf[1] + parseFloat(ghost.style.width) / 2, 500, 16, 'x under the pointer (grid snap)');
  near(+tf[2] + 100 + parseFloat(ghost.style.height) / 2, 400, 16, 'y under the pointer');
  // speed: the law of wk.edgePan2 (full speed past the edge after its ramp: 1200 px/s → ≈ 19 px per 16 ms frame)
  const x0 = world.cam.tx; frame(); const step = world.cam.tx - x0;
  near(step, 1200 * 0.016, 1, 'px per frame');
  world.dragPointer({ x: 500, y: 400, pointerType: 'touch' }); // back inside: stops
  const x1 = world.cam.tx; frame(3);
  near(world.cam.tx, x1, 0.5, 'stopped in the middle (the rest rounds to device px)');
  world.dragPointer(null); world.ghost(null);
  adv(200); frame();
  eq([world.busy, ghost.hidden], [false, true]);
  void vp;
});

test('in-panel drags (wk.dragSource auto-scroll: Serum tiles / labels, the FX grip) pan the camera at the band\'s edge (wk.setEdgeHook → dragPointer); each camera step re-fires move at the same point (scrolled 0); the drop stops it', () => {
  const { world, frame, item, d } = setup();
  const m = item('m', 0, 0, 900, 1500);
  world.add(m); frame(2);
  const tile = d.createElement('div'); m.body.append(tile);
  const log = [];
  const src = wk.dragSource(tile, { data: 'lfo1', scrollAxis: 'none', move: i => log.push([i.x, i.y, i.scrolled]), drop: () => log.push('drop') });
  touch(tile, 'pointerdown', 500, 400, 1); T += 16; touch(tile, 'pointermove', 500, 390, 1);
  eq(cam(world.cam), { tx: 0, ty: 0, k: 1 }, 'mid-band: nothing');
  T += 16; touch(tile, 'pointermove', 500, 696, 1); // 4 px inside the band's bottom edge (the 72 px touch zone)
  for (let i = 0; i < 20; i++) frame();
  ok(world.cam.ty < -50, 'the camera pans (more of the module below): ty ' + world.cam.ty);
  ok(log.filter(x => Array.isArray(x) && x[1] === 696 && x[2] === 0).length >= 10, 'moves re-fired under the still finger, scrolled 0');
  touch(tile, 'pointerup', 500, 696, 1);
  eq(log.at(-1), 'drop');
  const ty1 = world.cam.ty, n = log.length;
  frame(5); adv(200); frame();
  near(world.cam.ty, ty1, 1, 'stopped at the drop');
  eq([log.length, world.busy], [n, false], 'no move after the drop');
  src.destroy();
});

test('wk.localPoint inside a module under the world transform: layout px at k = 0.5, 1, 2 (and wk.localScale = 1/k)', () => {
  const { world, d, frame, item } = setup();
  const a = item('a', 100, 50, 400, 300);
  world.add(a);
  const ed = d.createElement('div'); a.body.append(ed);
  for (const k of [0.5, 1, 2]) {
    world.setCamera({ tx: 20, ty: 10, k });
    frame();
    // the editor's layout box 200 × 100 at world (150, 90): on screen at local (150k + 20, 90k + 10) + the viewport's (0, 100)
    place(ed, 150 * k + 20, 90 * k + 10 + 100, 200 * k, 100 * k); layout(ed, 200, 100);
    const p = wk.localPoint(ed, { clientX: 150 * k + 20 + 50 * k, clientY: 90 * k + 110 + 25 * k });
    eq([Math.round(p.x * 1e6) / 1e6, Math.round(p.y * 1e6) / 1e6, wk.localScale(ed)], [50, 25, 1 / k], 'k ' + k);
  }
});

test('toolbar: % / fit / tidy / ∿ (2a: the mod cables\' visibility) / the native chip; no ⊖ / ⊕ (pinch, wheel and keys zoom), no Snap (always on); the % tap resets to 100 %; the tools button folds the rest', () => {
  const { tb, world, frame, tidy, item } = setup();
  const btn = n => all(tb).find(x => x.getAttribute && x.getAttribute('data-cv-tb') === n);
  eq(['pct', 'fit', 'tidy', 'lock', 'map', 'mods', 'behind', 'native', 'tools'].map(n => !!btn(n)), [true, true, true, true, true, true, true, true, true]);
  eq(['out', 'in', 'snap'].map(n => !!btn(n)), [false, false, false], 'no ⊖, no ⊕, no Snap');
  eq(all(tb).filter(n => n.getAttribute && n.getAttribute('data-cv-tb')).map(n => n.getAttribute('data-cv-tb')), ['tools', 'pct', 'fit', 'tidy', 'lock', 'map', 'mods', 'behind', 'native'], 'the order ((the user, 2026-10-26) the cables-behind toggle after ∿)');
  eq([btn('mods').disabled, btn('mods').getAttribute('aria-label'), btn('pct').textContent, btn('pct').getAttribute('aria-label')], [false, 'Modulation cables: Always', '100%', 'Zoom 100% — reset to 100 %']);
  world.add(item('a', 0, 0, 500, 300)); frame();
  world.setCamera({ tx: 0, ty: 0, k: 1.5 }); frame(30);
  eq([world.k, btn('pct').textContent, btn('pct').getAttribute('aria-label')], [1.5, '150%', 'Zoom 150% — reset to 100 %'], 'the readout follows the zoom');
  btn('pct').click(); frame(30);
  eq([world.k, btn('pct').textContent], [1, '100%'], 'a tap on the % resets to 100 %');
  btn('tidy').click();
  eq(tidy.n, 1);
  btn('fit').click(); frame(30);
  eq(cam(world.cam), cam(W.fitCam([{ x: 0, y: 0, w: 500, h: 300 }], 1000, 600)));
});

/* ------------------------------------------------------------------ Snap to grid is always on (the user: "remove the grid snap button") */
test('snap to grid is always on: no toolbar button, no snapOn / setSnap, no pref; ghost drops and keyboard nudges land on the dots (a ghost that says snap: false still pins one); a saved synth.cv.snap = false is ignored', () => {
  const { tb, vp, world, prefs, frame, item } = setup({ prefs: [['synth.cv.snap', false]] });
  frame();
  eq(all(tb).filter(n => n.getAttribute && n.getAttribute('data-cv-tb') === 'snap').length, 0, 'no Snap button');
  eq([typeof world.snapOn, typeof world.setSnap], ['undefined', 'undefined'], 'no toggle API');
  const g = world.ghost({ x: 500, y: 400, w: 200, h: 100, label: 'x' });
  eq([g.x, g.y], [416, 256], 'a saved "off" is ignored: the outline sits on the dots');
  const f = world.ghost({ x: 500, y: 400, w: 200, h: 100, snap: false });
  eq([f.x, f.y], [400, 250], 'a ghost that says snap: false (over a target) still follows the pointer');
  const a = item('a', 20, 40, 100, 100), moves = [];
  a.onMove = (x, y, ph) => moves.push(ph + ':' + x + ',' + y);
  a.setPos = (x, y) => { a.x = x; a.y = y; };
  world.add(a); frame(); world.select('a');
  vp.focus();
  world.key(new Ev('keydown', { key: 'ArrowRight', cancelable: true, bubbles: true }));
  eq(moves, ['start:64,32', 'end:64,32'], 'a nudge from off the dots: onto them, a dot further');
  eq(prefs.get('synth.cv.snap'), false, 'the stale pref is left alone: never read, never written');
});

/* ------------------------------------------------------------------ the toolbar collapses to one button (the user's request) */
test('toolbar collapse: expanded by default; the tools button (aria-expanded, a label, always the first thing in the corner) folds the toolbar to that one button and back; remembered in synth.cv.tbcollapsed; a saved true starts collapsed, anything else expanded; the minimap steps aside while collapsed (its pref untouched)', () => {
  const { tb, world, prefs, frame } = setup();
  frame();
  const btn = n => all(tb).find(x => x.getAttribute && x.getAttribute('data-cv-tb') === n);
  const bar = btn('tools').parentNode, mm = tb.childNodes.find(n => n.className === 'cv-minimap'), row = bar.childNodes.find(n => n.className === 'cv-tb-row');
  place(tb, 56, 640, 60, 44); place(mm, 56, 520, 176, 112);
  eq(W.TB_PREF, 'synth.cv.tbcollapsed');
  eq([btn('tools').tagName, btn('tools').type, btn('tools').className], ['BUTTON', 'button', 'cv-tb-btn'], 'a real button of the toolbar\'s own style (44 px on a coarse pointer: .cv-tb-btn)');
  eq([bar.childNodes[0] === btn('tools'), row.contains(btn('tools'))], [true, false], 'the first thing in the corner, outside the row that hides');
  eq([bar.hasAttribute('data-collapsed'), btn('tools').getAttribute('aria-expanded'), !!row.id && btn('tools').getAttribute('aria-controls') === row.id, btn('tools').getAttribute('aria-label'), btn('tools').title, world.toolbarCollapsed()],
    [false, 'true', true, 'Collapse toolbar', 'Collapse toolbar', false], 'expanded');
  const open = String(btn('tools').innerHTML);
  ok(/<svg[^>]*aria-hidden="true"/.test(open), 'an icon');
  eq([mm.hasAttribute('hidden'), world.reserved().length], [false, 2], 'the minimap shows; the band keeps clear of it and of the toolbar');
  const told = [];
  world.on('toolbar', c => told.push(c));
  btn('tools').click();
  eq([bar.hasAttribute('data-collapsed'), btn('tools').getAttribute('aria-expanded'), btn('tools').getAttribute('aria-label'), btn('tools').title, world.toolbarCollapsed(), prefs.get('synth.cv.tbcollapsed'), told],
    [true, 'false', 'Expand toolbar', 'Expand toolbar', true, true, [true]], 'collapsed');
  ok(String(btn('tools').innerHTML) !== open, 'the icon changes: "tools" when collapsed, "fold" when open');
  eq([mm.hasAttribute('hidden'), prefs.has(W.MAP_PREF), world.mapOn(), world.reserved().length], [true, false, true, 1], 'the minimap steps aside (its own pref not written, still on); the band keeps clear of the one button only');
  btn('tools').click();
  eq([bar.hasAttribute('data-collapsed'), btn('tools').getAttribute('aria-expanded'), String(btn('tools').innerHTML) === open, world.toolbarCollapsed(), prefs.get('synth.cv.tbcollapsed'), mm.hasAttribute('hidden'), told],
    [false, 'true', true, false, false, false, [true, false]], 'expanded again');
  world.setToolbarCollapsed(true); world.setToolbarCollapsed(true);
  eq(told, [true, false, true], 'a repeat is no event');
  eq(mm.hasAttribute('hidden'), true);
  world.setMap(false); world.setToolbarCollapsed(false);
  eq(mm.hasAttribute('hidden'), true, 'expanding does not bring back a minimap the user switched off');
  for (const v of [true, 1, 'true', null, 'x', 0, false]) {
    const S = setup({ prefs: [['synth.cv.tbcollapsed', v]] });
    S.frame();
    const b = all(S.tb).find(n => n.getAttribute && n.getAttribute('data-cv-tb') === 'tools'), m2 = S.tb.childNodes.find(n => n.className === 'cv-minimap');
    eq([S.world.toolbarCollapsed(), b.parentNode.hasAttribute('data-collapsed'), b.getAttribute('aria-expanded'), m2.hasAttribute('hidden')], v === true ? [true, true, 'false', true] : [false, false, 'true', false], 'saved ' + String(v));
  }
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  ok(/\.cv-tb\[data-collapsed\] > \.cv-tb-row \{ display: none; \}/.test(css), 'style.css hides the row (and only the row: the page-zoomed chip is a notice and stays) when collapsed');
  ok(!/\.cv-tb:not\(\[data-open\]\)/.test(css) && !/\[data-cv-tb="tools"\] \{ display: none; \}/.test(css), 'no width-bound fold left: the button is always there; the choice is the user\'s, remembered');
});

test('setPinchMode persists synth.cv.pinch and marks the viewport; setActive(false) stops everything and plans nothing; destroy() takes every listener off', () => {
  const { vp, w, world, prefs, frame, item, win } = setup({ prefs: [['synth.cv.pinch', 'page']] });
  eq([world.pinchMode, vp.getAttribute('data-cv-pinch')], ['page', 'page'], 'restored');
  world.setPinchMode('canvas');
  eq([prefs.get('synth.cv.pinch'), vp.getAttribute('data-cv-pinch')], ['canvas', 'canvas']);
  const a = item('a', 0, 0, 100, 100);
  world.add(a); frame(2);
  world.setActive(false);
  touch(vp, 'pointerdown', 500, 400, 1); touch(vp, 'pointermove', 560, 400, 1); touch(vp, 'pointerup', 560, 400, 1);
  eq(world.cam.tx, 0, 'hidden (ROLL): no pan');
  world.setActive(true); frame(2);
  world.destroy();
  eq([vp.listenerCount('pointerdown'), vp.listenerCount('wheel'), vp.listenerCount('pointermove'), w.listenerCount('focusin'), win.listenerCount('resize'), win.listenerCount('touchstart')], [0, 0, 0, 0, 0, 0]);
});

test('∿ (2a): the toolbar cycles the mod cables\' visibility Always → On select → Never → Always (data-mode, title, aria-label), remembered in synth.cv.mods, a \'mods\' event per change; setModsMode; a saved mode restores; anything else is Always', () => {
  const { tb, world, prefs, frame } = setup();
  frame();
  const b = all(tb).find(n => n.getAttribute && n.getAttribute('data-cv-tb') === 'mods');
  eq([W.MODS_PREF, W.MODS_MODES], ['synth.cv.mods', ['always', 'select', 'never']]);
  eq([b.disabled, b.hasAttribute('aria-disabled'), b.getAttribute('data-mode'), world.modsMode(), b.title], [false, false, 'always', 'always', 'Modulation cables: Always (tap: On select)']);
  const told = [];
  world.on('mods', m => told.push(m));
  b.click();
  eq([b.getAttribute('data-mode'), b.getAttribute('aria-label'), b.title, world.modsMode(), prefs.get('synth.cv.mods')], ['select', 'Modulation cables: On select', 'Modulation cables: On select (tap: Never)', 'select', 'select']);
  b.click();
  eq([b.getAttribute('data-mode'), world.modsMode(), prefs.get('synth.cv.mods')], ['never', 'never', 'never']);
  b.click();
  eq([b.getAttribute('data-mode'), world.modsMode(), prefs.get('synth.cv.mods')], ['always', 'always', 'always']);
  eq(told, ['select', 'never', 'always'], 'one event per change');
  world.setModsMode('never'); world.setModsMode('never'); world.setModsMode('bogus');
  eq([told.slice(3), world.modsMode(), b.getAttribute('data-mode')], [['never'], 'never', 'never'], 'the same mode or an unknown one: no event');
  const S2 = setup({ prefs: [['synth.cv.mods', 'select']] });
  S2.frame();
  const b2 = all(S2.tb).find(n => n.getAttribute && n.getAttribute('data-cv-tb') === 'mods');
  eq([S2.world.modsMode(), b2.getAttribute('data-mode')], ['select', 'select'], 'restored');
  const S3 = setup({ prefs: [['synth.cv.mods', 42]] });
  eq(S3.world.modsMode(), 'always', 'a bad pref: Always');
});

/* ------------------------------------------------------------------ stage 1c: selection, marquee, minimap */
test('selection (1c): Shift-click adds / removes, a move of a member keeps the group, ⌘A selects all, Escape clears; edit state only with one', () => {
  const { vp, world, item, frame } = setup();
  const a = item('a', 0, 0, 200, 100), b = item('b', 400, 0, 200, 100), c = item('c', 0, 400, 200, 100);
  for (const x of [a, b, c]) world.add(x);
  frame();
  world.select('a'); world.select('b', { add: true });
  eq([world.selection, world.selected], [['a', 'b'], 'b']);
  eq([a.el.hasAttribute('data-cv-sel'), b.el.hasAttribute('data-cv-sel'), c.el.hasAttribute('data-cv-sel')], [true, true, false]);
  eq(world.edit, null, 'two selected: no edit state');
  world.select('a', { keep: true });
  eq([world.selection, world.selected], [['a', 'b'], 'a'], 'a member of the group: kept (its move carries the others)');
  world.select('b', { add: true });
  eq(world.selection, ['a'], 'Shift-click again takes it out');
  world.select('c');
  eq(world.selection, ['c'], 'a plain select: only it');
  vp.focus();
  ok(world.key({ key: 'a', metaKey: true, preventDefault() {} }), '⌘A');
  eq(world.selection.sort(), ['a', 'b', 'c']);
  ok(world.escape());
  eq([world.selection, world.selected], [[], null]);
  world.select('b'); world.remove('b');
  eq([world.selection, world.selected], [[], null], 'a removed item leaves the selection');
});

test('marquee (1c): Shift + mouse drag on empty canvas selects what it touches (live), the camera stays; a plain mouse drag still pans; Escape cancels', () => {
  const { vp, ov, world, item, frame } = setup();
  const a = item('a', 0, 0, 200, 100), b = item('b', 400, 0, 200, 100), c = item('c', 0, 400, 200, 100);
  for (const x of [a, b, c]) world.add(x);
  frame();
  mouse(vp, 'pointerdown', 150, 150, { shiftKey: true }); // world (150, 50): inside a
  mouse(vp, 'pointermove', 450, 180, { shiftKey: true }); // to world (450, 80): a and b
  eq([vp.hasAttribute('data-cv-marquee'), ov.childNodes.length, a.el.hasAttribute('data-cv-sel'), b.el.hasAttribute('data-cv-sel'), c.el.hasAttribute('data-cv-sel')], [true, 1, true, true, false], 'live');
  const box = ov.childNodes[0];
  eq([box.className, box.style.left, box.style.top, box.style.width, box.style.height], ['cv-marquee', '150px', '50px', '300px', '30px']);
  mouse(vp, 'pointerup', 450, 180);
  frame();
  eq([world.selection.sort(), cam(world.cam), ov.childNodes.length, vp.hasAttribute('data-cv-marquee')], [['a', 'b'], { tx: 0, ty: 0, k: 1 }, 0, false]);
  mouse(vp, 'pointerdown', 700, 600); mouse(vp, 'pointermove', 760, 620); mouse(vp, 'pointerup', 760, 620);
  frame();
  eq(cam(world.cam), { tx: 60, ty: 20, k: 1 }, 'a plain drag pans (the user\'s choice)');
  world.select(null);
  mouse(vp, 'pointerdown', 100, 520, { shiftKey: true }); mouse(vp, 'pointermove', 400, 700, { shiftKey: true });
  ok(world.escape(), 'Escape');
  eq([world.selection, ov.childNodes.length, c.el.hasAttribute('data-cv-sel')], [[], 0, false], 'cancelled: nothing selected');
});

test('marquee (1c) by touch: a finger held 250 ms on empty canvas, then dragged, draws it; a quicker drag pans', () => {
  const { vp, world, item, frame } = setup();
  const a = item('a', 0, 0, 200, 100), b = item('b', 400, 0, 200, 100);
  world.add(a); world.add(b);
  frame();
  touch(vp, 'pointerdown', 150, 150, 1); adv(100); touch(vp, 'pointermove', 480, 160, 1); touch(vp, 'pointerup', 480, 160, 1);
  frame(40);
  ok(world.cam.tx !== 0, 'a quick drag pans');
  eq(world.selection, []);
  world.setCamera({ tx: 0, ty: 0, k: 1 });
  frame(); adv(600);
  touch(vp, 'pointerdown', 150, 150, 1); adv(W.MARQUEE_HOLD_MS + 10); touch(vp, 'pointermove', 480, 160, 1); touch(vp, 'pointerup', 480, 160, 1);
  frame();
  eq([world.selection.sort(), cam(world.cam)], [['a', 'b'], { tx: 0, ty: 0, k: 1 }], 'held, then dragged: a marquee');
});

test('marquee (1c) by touch: a second finger during it wins — the marquee ends unapplied and the two fingers pinch the camera', () => {
  const { vp, ov, world, item, frame } = setup();
  const a = item('a', 0, 0, 200, 100), b = item('b', 400, 0, 200, 100);
  world.add(a); world.add(b);
  frame(); adv(600);
  touch(vp, 'pointerdown', 150, 150, 1); adv(W.MARQUEE_HOLD_MS + 10); touch(vp, 'pointermove', 480, 160, 1);
  eq([vp.hasAttribute('data-cv-marquee'), ov.childNodes.length, a.el.hasAttribute('data-cv-sel')], [true, 1, true], 'a marquee runs');
  const e = touch(vp, 'pointerdown', 700, 160, 2, { isPrimary: false });
  ok(e._imm, 'the second finger is the world\'s');
  eq([vp.hasAttribute('data-cv-marquee'), ov.childNodes.length, a.el.hasAttribute('data-cv-sel'), b.el.hasAttribute('data-cv-sel'), world.selection], [false, 0, false, false, []], 'ended, nothing selected');
  touch(vp, 'pointermove', 460, 160, 1); touch(vp, 'pointermove', 380, 160, 1); touch(vp, 'pointermove', 800, 160, 2);
  ok(world.k > 1.2, 'a pinch: zoomed in ' + world.k);
  touch(vp, 'pointerup', 380, 160, 1); touch(vp, 'pointerup', 800, 160, 2);
  frame(3);
  eq([world.selection, world.busy], [[], false]);
});

test('minimap (1c): mapFit pure; drawn from cached rects only when the camera or the layout changes; tap centres, drag pans; the toggle remembered', () => {
  const F = W.mapFit([{ x: 0, y: 0, w: 1000, h: 500 }], { x: 0, y: 0, w: 500, h: 250 }, 176, 112, 6);
  near(F.s, 164 / 1000, 1e-9, 'fits the width'); near(F.ox, 6, 1e-9, 'x'); near(F.oy, (112 - 500 * F.s) / 2, 1e-9, 'centred y');
  eq(W.mapFit([], null, 176, 112), { s: 1, ox: 0, oy: 0 });
  const { tb, world, item, frame, prefs } = setup();
  const a = item('a', 0, 0, 1000, 500);
  world.add(a);
  frame();
  const mm = tb.childNodes.find(n => n.className === 'cv-minimap'), cv = mm.childNodes[0], ctx = cv.getContext('2d');
  ok(mm && !mm.hasAttribute('hidden'), 'shown by default');
  const calls = () => (ctx.calls || []).filter(x => x[0] === 'strokeRect').length;
  const n0 = calls();
  ok(n0 >= 1, 'drawn');
  const reads = a.reads;
  frame(3);
  eq([calls(), a.reads], [n0, reads], 'nothing changed: no redraw, no rect read');
  world.panBy(-100, 0); frame();
  eq([calls() > n0, a.reads], [true, reads], 'a camera move: redrawn from the cached rects');
  // a tap on the map centres the band (1000 × 600 viewport) on that world point
  place(cv, 10, 500, 176, 112);
  const M = W.mapFit([a.rect()], { x: 100, y: 0, w: 1000, h: 600 }, 176, 112), wx = 800, wy = 300;
  const cx = 10 + wx * M.s + M.ox, cy = 500 + wy * M.s + M.oy;
  world.setCamera({ tx: -100, ty: 0, k: 1 }); frame();
  ptr(cv, 'pointerdown', cx, cy, { pointerId: 3 }); ptr(cv, 'pointerup', cx, cy, { pointerId: 3 });
  frame(30);
  const c = world.cam;
  near((500 - c.tx) / c.k, wx, 1, 'centred x'); near((400 - 100 - c.ty) / c.k, wy, 1, 'centred y');
  const btn = tb.childNodes[0].childNodes.find(n => n.getAttribute && n.getAttribute('data-cv-tb') === 'tools') ? all(tb).find(n => n.getAttribute && n.getAttribute('data-cv-tb') === 'map') : null;
  ok(btn, 'the toolbar toggle');
  btn.click();
  eq([mm.hasAttribute('hidden'), prefs.get(W.MAP_PREF), btn.getAttribute('aria-pressed')], [true, false, 'false'], 'hidden, remembered');
});

/* ------------------------------------------------------------------ the Lock view toggle (the user's iPad request) */
test('lock view: the toolbar toggle after Tidy (a padlock, aria-pressed, "Lock view: on / off", remembered in synth.cv.lock, a lock event, [data-cv-locked]); a saved on starts locked', () => {
  const { tb, vp, world, prefs, frame } = setup();
  frame();
  const btns = all(tb).filter(n => n.getAttribute && n.getAttribute('data-cv-tb')), names = btns.map(n => n.getAttribute('data-cv-tb'));
  const b = btns.find(n => n.getAttribute('data-cv-tb') === 'lock');
  ok(b, 'the Lock button');
  eq(names.indexOf('lock'), names.indexOf('tidy') + 1, 'after Tidy (the Snap button is gone)');
  eq([W.LOCK_PREF, b.getAttribute('aria-pressed'), b.title, b.getAttribute('aria-label'), world.lockOn(), vp.hasAttribute('data-cv-locked')],
    ['synth.cv.lock', 'false', 'Lock view: off', 'Lock view: off', false, false], 'off by default');
  const open = String(b.innerHTML);
  ok(/<svg[^>]*aria-hidden="true"/.test(open) && /<rect/.test(open), 'a padlock icon');
  const told = [];
  world.on('lock', on => told.push(on));
  b.click();
  eq([b.getAttribute('aria-pressed'), b.title, b.getAttribute('aria-label'), world.lockOn(), prefs.get('synth.cv.lock'), vp.hasAttribute('data-cv-locked'), told],
    ['true', 'Lock view: on', 'Lock view: on', true, true, true, [true]]);
  ok(String(b.innerHTML) !== open, 'the shackle closes');
  b.click();
  eq([b.getAttribute('aria-pressed'), world.lockOn(), prefs.get('synth.cv.lock'), vp.hasAttribute('data-cv-locked'), told], ['false', false, false, false, [true, false]]);
  const S2 = setup({ prefs: [['synth.cv.lock', true]] });
  S2.frame();
  const b2 = all(S2.tb).find(n => n.getAttribute && n.getAttribute('data-cv-tb') === 'lock');
  eq([S2.world.lockOn(), b2.getAttribute('aria-pressed'), S2.vp.hasAttribute('data-cv-locked')], [true, 'true', true], 'restored on');
});

test('lock view: no gesture moves the camera — mouse / finger drags (empty canvas, a module background, the middle button), momentum, a late-finger pinch, the two-finger hooks (still claimed), the wheel and Ctrl-wheel and Safari gesture* (still prevented), the 0 / 1 keys, a double-tap fit, a double-tap focus (edit state where it is), reveal, a drag\'s edge pan', () => {
  const { vp, world, frame, item } = setup();
  const m = item('m', 100, 100, 400, 300);
  world.add(m);
  world.setCamera({ tx: 0, ty: 0, k: 0.6 }); frame(); adv(400);
  world.setLock(true);
  const c0 = cam(world.cam), same = msg => eq(cam(world.cam), c0, msg);
  mouse(vp, 'pointerdown', 600, 500); mouse(vp, 'pointermove', 650, 520); mouse(vp, 'pointerup', 650, 520); frame(3);
  same('a mouse drag on empty canvas');
  mouse(m.body, 'pointerdown', 200, 300); mouse(vp, 'pointermove', 260, 300); mouse(vp, 'pointerup', 260, 300); frame(3);
  same('a mouse drag from a module background');
  mouse(m.body, 'pointerdown', 200, 300, { button: 1 }); mouse(vp, 'pointermove', 230, 310, { button: 1 }); mouse(vp, 'pointerup', 230, 310, { button: 1 }); frame(3);
  same('the middle button');
  adv(500);
  touch(vp, 'pointerdown', 500, 300, 1);
  for (let i = 1; i <= 6; i++) { T += 16; touch(vp, 'pointermove', 500 - 20 * i, 300, 1); }
  touch(vp, 'pointerup', 380, 300, 1); frame(10);
  same('a flicked finger: no pan, no glide');
  eq(world.busy, false, 'no burst');
  adv(500);
  touch(vp, 'pointerdown', 400, 300, 1); T += 16; touch(vp, 'pointermove', 440, 300, 1); T += 500;
  const e2 = touch(vp, 'pointerdown', 640, 300, 2, { isPrimary: false });
  ok(e2._imm, 'the second finger is still the world\'s (it presses nothing)');
  touch(vp, 'pointermove', 340, 300, 1); touch(vp, 'pointermove', 740, 300, 2);
  touch(vp, 'pointerup', 340, 300, 1); touch(vp, 'pointerup', 740, 300, 2); frame(3);
  same('a late-finger pinch');
  eq([world.hooks.pan(-30, 10, { cx: 500, cy: 400 }), world.hooks.zoom(1, 500, 400, { cx: 500, cy: 400 }), world.hooks.zoom(1.5, 500, 400, { cx: 500, cy: 400 })],
    [true, true, true], 'the two-finger hooks: claimed (no scroller, no page takes them)');
  frame(); same('a two-finger pan / pinch');
  adv(400);
  const wh = fire(vp, 'wheel', { clientX: 600, clientY: 500, deltaX: 10, deltaY: 30 });
  const zw = fire(vp, 'wheel', { clientX: 300, clientY: 200, deltaY: -50, ctrlKey: true });
  fire(vp, 'gesturestart', { scale: 1, clientX: 500, clientY: 400 });
  const g = fire(vp, 'gesturechange', { scale: 1.5, clientX: 500, clientY: 400 });
  fire(vp, 'gestureend', { scale: 1.5 }); frame(3);
  same('wheel, Ctrl-wheel (a trackpad pinch), Safari gesture*');
  eq([wh.defaultPrevented, zw.defaultPrevented, g.defaultPrevented], [true, true, true], 'still taken: the page neither scrolls nor zooms');
  vp.focus();
  const key = k => { const e = new Ev('keydown', { key: k, cancelable: true, bubbles: true }); return [world.key(e), e.defaultPrevented]; };
  eq([key('0'), key('1')], [[true, true], [true, true]], '0 / 1: the canvas\'s keys, consumed');
  frame(30); same('0 / 1');
  adv(500);
  world.select('m');
  touch(vp, 'pointerdown', 900, 650, 1); touch(vp, 'pointerup', 900, 650, 1); adv(100);
  touch(vp, 'pointerdown', 905, 652, 1); touch(vp, 'pointerup', 905, 652, 1); frame(30);
  same('a double-tap on empty canvas: no fit');
  eq(world.selected, null, 'its tap still deselects');
  world.focusItem('m'); frame(30);
  same('a bar double-tap (focusItem)');
  eq([world.selected, world.edit], ['m', 'm'], 'selected and in edit state at this zoom (0.6 < EDIT_K)');
  world.reveal({ left: 980, top: 200, right: 1040, bottom: 230 }); frame(30);
  same('reveal (a focused control, an opened popover)');
  world.dragPointer({ x: 500, y: 400, pointerType: 'touch' }); frame();
  world.dragPointer({ x: 2, y: 400, pointerType: 'touch' });
  for (let i = 0; i < 20; i++) frame();
  same('a module / mod-source drag at the band\'s edge: no edge pan');
  world.dragPointer(null); adv(400); frame();
  eq(world.busy, false);
  world.setLock(false);
  mouse(vp, 'pointerdown', 600, 500); mouse(vp, 'pointermove', 650, 520); mouse(vp, 'pointerup', 650, 520); frame();
  eq(cam(world.cam).tx, c0.tx + 50, 'unlocked: the same drag pans again');
});

test('lock view: the toolbar\'s % / fit and the minimap (a tap, a drag) still move the camera; box-select (Shift-drag, a held finger) still works; a second finger still ends a finger\'s marquee unapplied (two fingers win) without moving the camera', () => {
  const { tb, vp, ov, world, item, frame } = setup();
  const a = item('a', 0, 0, 200, 100), b = item('b', 400, 0, 200, 100);
  world.add(a); world.add(b); frame();
  world.setLock(true);
  const btn = n => all(tb).find(x => x.getAttribute && x.getAttribute('data-cv-tb') === n);
  world.setCamera({ tx: 0, ty: 0, k: 1.5 }); frame(30);
  btn('pct').click(); frame(30);
  eq(world.k, 1, '%');
  btn('fit').click(); frame(30);
  eq(cam(world.cam), cam(W.fitCam([a.rect(), b.rect()], 1000, 600)), 'fit');
  const mm = tb.childNodes.find(n => n.className === 'cv-minimap'), cv = mm.childNodes[0];
  place(cv, 10, 500, 176, 112);
  world.setCamera({ tx: 0, ty: 0, k: 1 }); frame(); adv(400);
  ptr(cv, 'pointerdown', 60, 540, { pointerId: 3 }); ptr(cv, 'pointerup', 60, 540, { pointerId: 3 }); frame(30);
  const c1 = cam(world.cam);
  ok(c1.tx !== 0 || c1.ty !== 0, 'a minimap tap centres the view there: ' + JSON.stringify(c1));
  adv(400);
  ptr(cv, 'pointerdown', 100, 550, { pointerId: 4 }); ptr(cv, 'pointermove', 140, 560, { pointerId: 4 }); ptr(cv, 'pointerup', 140, 560, { pointerId: 4 }); frame(3);
  ok(JSON.stringify(cam(world.cam)) !== JSON.stringify(c1), 'a minimap drag moves the view');
  world.setCamera({ tx: 0, ty: 0, k: 1 }); frame(); adv(400);
  mouse(vp, 'pointerdown', 150, 150, { shiftKey: true }); mouse(vp, 'pointermove', 450, 180, { shiftKey: true }); mouse(vp, 'pointerup', 450, 180); frame();
  eq([world.selection.sort(), cam(world.cam)], [['a', 'b'], { tx: 0, ty: 0, k: 1 }], 'Shift-drag: a marquee');
  world.select(null); adv(600);
  touch(vp, 'pointerdown', 150, 150, 1); adv(W.MARQUEE_HOLD_MS + 10); touch(vp, 'pointermove', 480, 160, 1); touch(vp, 'pointerup', 480, 160, 1); frame();
  eq([world.selection.sort(), cam(world.cam)], [['a', 'b'], { tx: 0, ty: 0, k: 1 }], 'a held finger, then a drag: a marquee');
  world.select(null); adv(600);
  touch(vp, 'pointerdown', 150, 150, 1); adv(W.MARQUEE_HOLD_MS + 10); touch(vp, 'pointermove', 480, 160, 1);
  const e = touch(vp, 'pointerdown', 700, 160, 2, { isPrimary: false });
  ok(e._imm, 'the second finger is the world\'s');
  touch(vp, 'pointermove', 380, 160, 1); touch(vp, 'pointermove', 800, 160, 2);
  touch(vp, 'pointerup', 380, 160, 1); touch(vp, 'pointerup', 800, 160, 2); frame(3);
  eq([world.selection, ov.childNodes.length, cam(world.cam)], [[], 0, { tx: 0, ty: 0, k: 1 }], 'ended unapplied; the pinch moves nothing');
});

/* ------------------------------------------------------------------ 1e: the jack hook (cable drags) */
function jackRig(o) {
  const R = setup(o);
  const m = R.item('m', 0, 0, 900, 500);
  R.world.add(m);
  const jack = R.d.createElement('span'), dot = R.d.createElement('i');
  jack.setAttribute('data-cv-jack', 'm.out'); jack.append(dot); m.el.append(jack);
  let downs = 0; jack.addEventListener('pointerdown', () => downs++);
  const log = [];
  R.frame();
  Object.assign(R, { m, jack, dot, log });
  Object.defineProperty(R, 'downs', { get: () => downs });
  return R;
}

test('jack hook (1e): a press on a [data-cv-jack] goes to hooks.jack(e, jackEl) before any pan — taken (never a pan, never the jack\'s own pointerdown); a refusal leaves it alone; setJackHook\'s remover', () => {
  const R = jackRig();
  eq(typeof R.world.setJackHook, 'function');
  const off = R.world.setJackHook((e, el) => { R.log.push('jack ' + el.getAttribute('data-cv-jack') + ' ' + e.pointerType); return { cancel: () => R.log.push('cancel') }; });
  eq(typeof R.world.hooks.jack, 'function', 'installed on hooks.jack');
  const e = mouse(R.dot, 'pointerdown', 900, 168);
  eq([R.log, !!e._imm, e.defaultPrevented, R.downs, R.world.jacking], [['jack m.out mouse'], true, true, 0, true], 'taken in the capture phase (a press inside the jack too)');
  mouse(R.vp, 'pointermove', 960, 220, { buttons: 1 }); R.frame();
  eq(cam(R.world.cam), { tx: 0, ty: 0, k: 1 }, 'never a pan');
  mouse(R.vp, 'pointerup', 960, 220);
  eq(R.world.jacking, false, 'its lift ends it');
  // the hook says no: the press is left alone (the world does nothing with a jack either: not a background)
  R.log.length = 0;
  const off2 = R.world.setJackHook(() => false);
  const e2 = mouse(R.jack, 'pointerdown', 900, 168);
  eq([!!e2._imm, R.downs, R.world.jacking], [false, 1, false]);
  mouse(R.vp, 'pointermove', 990, 168, { buttons: 1 }); R.frame();
  eq(R.world.cam.tx, 0, 'no pan from a jack');
  mouse(R.vp, 'pointerup', 990, 168);
  off(); // (not its hook any more: nothing removed)
  eq(typeof R.world.hooks.jack, 'function');
  off2();
  eq([R.world.hooks.jack, R.world.hooks.jackCancel], [null, null], 'removed');
  // a press elsewhere never reaches a hook; a right / middle button never either
  R.world.setJackHook(() => { R.log.push('jack'); return true; });
  mouse(R.m.body, 'pointerdown', 300, 300); mouse(R.vp, 'pointerup', 300, 300);
  mouse(R.jack, 'pointerdown', 900, 168, { button: 2 });
  mouse(R.jack, 'pointerdown', 900, 168, { button: 1 }); mouse(R.vp, 'pointerup', 900, 168, { button: 1 });
  eq(R.log, [], 'only the primary button on a jack');
});

test('jack hook (1e): two fingers always win — a second touch cancels the cable drag (the answer\'s cancel, else hooks.jackCancel) and the two fingers pinch the camera; a two-finger pointercancel cancels it too; Escape too', () => {
  const R = jackRig();
  R.world.setJackHook(() => true, () => R.log.push('jackCancel'));
  touch(R.jack, 'pointerdown', 900, 168, 1);
  touch(R.jack, 'pointermove', 860, 200, 1); // (the drag's own moves: the world only tracks the finger)
  T += 300;
  const e = touch(R.vp, 'pointerdown', 1100, 200, 2, { isPrimary: false });
  eq([R.log, !!e._imm, R.world.jacking], [['jackCancel'], true, false], 'cancelled; the second finger is the world\'s');
  const k0 = R.world.k;
  touch(R.vp, 'pointermove', 830, 200, 1); touch(R.vp, 'pointermove', 800, 200, 1); touch(R.vp, 'pointermove', 1200, 200, 2);
  ok(R.world.k > k0 * 1.2, 'a pinch from the jack finger and the new one: ' + R.world.k);
  touch(R.vp, 'pointerup', 800, 200, 1); touch(R.vp, 'pointerup', 1200, 200, 2);
  R.frame(3);
  // the answer's own cancel wins over jackCancel; gesture.js's flagged cancel ends it
  R.log.length = 0;
  R.world.setJackHook(() => ({ cancel: () => R.log.push('own cancel') }), () => R.log.push('jackCancel'));
  touch(R.jack, 'pointerdown', 900, 168, 3);
  const c = new Ev('pointercancel', { bubbles: true, pointerId: 3, pointerType: 'touch', clientX: 900, clientY: 168 });
  c.gesture = 'two-finger';
  R.jack.dispatchEvent(c);
  eq([R.log, R.world.jacking], [['own cancel'], false]);
  // a plain lift: nothing cancelled; Escape (world.escape) cancels a live one first
  R.log.length = 0;
  touch(R.jack, 'pointerdown', 900, 168, 4); touch(R.vp, 'pointerup', 900, 168, 4);
  eq(R.log, []);
  mouse(R.jack, 'pointerdown', 900, 168);
  eq([R.world.escape(), R.log, R.world.jacking], [true, ['own cancel'], false]);
  mouse(R.vp, 'pointerup', 900, 168);
  // 'Zoom page' pinch mode: the drag is cancelled, the browser's pinch has both (no camera zoom)
  const P = jackRig({ prefs: [['synth.cv.pinch', 'page']] });
  P.world.setJackHook(() => true, () => P.log.push('jackCancel'));
  touch(P.jack, 'pointerdown', 900, 168, 1);
  touch(P.vp, 'pointerdown', 1100, 200, 2, { isPrimary: false });
  touch(P.vp, 'pointermove', 700, 200, 1); touch(P.vp, 'pointermove', 1300, 200, 2);
  eq([P.log, P.world.k], [['jackCancel'], 1]);
  touch(P.vp, 'pointerup', 700, 200, 1); touch(P.vp, 'pointerup', 1300, 200, 2);
});

test('jack hook (1e): a stale drag (its lift lost) ends at the next primary press; the view lock still allows patching; setActive(false) cancels', () => {
  const R = jackRig({ prefs: [['synth.cv.lock', true]] });
  R.world.setJackHook(() => true, () => R.log.push('cancel'));
  eq(R.world.lockOn(), true);
  touch(R.jack, 'pointerdown', 900, 168, 1);
  eq(R.world.jacking, true, 'locked view: a cable drag is no camera move');
  touch(R.m.body, 'pointerdown', 300, 300, 5, { isPrimary: true }); // (finger 1's lift was lost)
  eq([R.log, R.world.jacking], [['cancel'], false]);
  touch(R.vp, 'pointerup', 300, 300, 5);
  R.log.length = 0;
  touch(R.jack, 'pointerdown', 900, 168, 6);
  R.world.setActive(false);
  eq([R.log, R.world.jacking], [['cancel'], false]);
});

/* ------------------------------------------------------------------ UI fixes (stage 1e review, fixer U) */
test('U14: the band leaves out the floating toolbar and the minimap above it (fit / focus / reveal / the default camera never put a module under them); a drag hides the minimap and the toolbar takes no press', () => {
  const { tb, vp, world, item, frame } = setup();
  frame();
  const mm = tb.childNodes.find(n => n.className === 'cv-minimap');
  place(tb, 56, 644, 480, 44); place(mm, 56, 524, 176, 112); // (the viewport: 0…1000 × 100…700; the row at its foot, the map above)
  eq(world.reserved(), [{ left: 56, top: 644, right: 536, bottom: 688 }, { left: 56, top: 524, right: 232, bottom: 636 }], 'the toolbar row and the minimap');
  eq(world.band(), { left: 0, top: 100, right: 1000, bottom: 516 }, 'the band ends 8 px over the minimap');
  const a = item('a', 0, 0, 1000, 1200);
  world.add(a); frame();
  world.fit({ animate: false });
  const c = world.cam;
  ok(100 + c.ty + 1200 * c.k <= 524, 'a fit ends above the minimap: ' + (100 + c.ty + 1200 * c.k));
  world.setMap(false);
  eq(world.band().bottom, 636, 'the map hidden: only the toolbar row');
  world.setMap(true);
  // a drag (a module's, a cable's: dragPointer) — the minimap steps aside, the toolbar takes no press; a caller's hold too
  eq(tb.hasAttribute('data-cv-drag'), false);
  world.dragPointer({ x: 500, y: 400, pointerType: 'touch' });
  eq(tb.hasAttribute('data-cv-drag'), true, 'dragging');
  world.dragPointer(null);
  eq(tb.hasAttribute('data-cv-drag'), false, 'the drag ended');
  world.setDragging(true); world.dragPointer({ x: 500, y: 400, pointerType: 'mouse' }); world.dragPointer(null);
  eq(tb.hasAttribute('data-cv-drag'), true, 'a tray drag holds it over a null pointer (a pinned outline)');
  world.setDragging(false);
  eq(tb.hasAttribute('data-cv-drag'), false);
  // a resize of the viewport (a tray's height, a rotation) is announced: main.js re-derives an untouched default camera
  const rs = [];
  world.on('resize', d => rs.push(d.w + 'x' + d.h));
  world.resize();
  place(vp, 0, 100, 1000, 500); world.resize();
  eq(rs, ['1000x500'], 'once per real change');
  adv(200); frame();
});

test('U13: a press on an editable cable pans the camera like the canvas around it (the main.js background test: cv-module isBackground); a tap still selects it; a read-only cable takes no press at all', () => {
  const { vp, w, world, frame, d } = setup({ opts: { isBackground: el => MOD.isBackground(el) } });
  const sel = [], L = CAB.createCables(w, { doc: d, onSelect: id => sel.push(id) });
  L.set([{ id: 'w1', a: 'i1.out', b: 'fx1.in', kind: 'audio' }]);
  L.layout(new Map([['i1.out', { x: 100, y: 100 }], ['fx1.in', { x: 700, y: 400 }]]));
  const hit = all(L.under).find(n => n.getAttribute && n.getAttribute('class') === 'cv-cable-hit');
  frame();
  mouse(hit, 'pointerdown', 300, 300); mouse(vp, 'pointermove', 330, 300); mouse(vp, 'pointermove', 360, 310); mouse(vp, 'pointerup', 360, 310);
  frame();
  eq([world.cam.tx, world.cam.ty, sel], [60, 10, []], 'a mouse drag along it pans; no selection');
  adv(500);
  touch(hit, 'pointerdown', 300, 300, 1); touch(vp, 'pointermove', 340, 300, 1); touch(vp, 'pointerup', 340, 300, 1);
  eq([world.cam.tx, sel], [100, []], 'a finger too');
  adv(500); frame(30);
  const tx = world.cam.tx;
  touch(hit, 'pointerdown', 300, 300, 1); touch(vp, 'pointerup', 302, 301, 1);
  eq([world.cam.tx, sel], [tx, ['w1']], 'a tap selects it (the camera stays)');
  eq(MOD.isBackground(hit), true);
  L.set([{ id: 'w1', a: 'i1.out', b: 'fx1.in', kind: 'audio', readonly: true }]);
  eq(MOD.isBackground(hit), false, 'read-only: not a press target at all (CSS pointer-events: none)');
  L.destroy();
});


/* ------------------------------------------------------------------ (1h fixes A) a lost context never restored; a drop reaches the overlap rule */
test('1h fix 8: a context loss the browser never restores — after GL_LOST_MS the layer is given up as dead: the 2D grid built live (G4), FACES stays detached; a restore inside the window cancels that', () => {
  const log = [];
  let glObj = null;
  const S = setup({ opts: { createGL: (v, o) => (glObj = fakeGL(log)(v, o)) } });
  S.frame();
  eq(W.GL_LOST_MS, 3000);
  // restored in time: nothing happens later
  glObj.hooks.onLost(false);
  adv(1000); glObj.hooks.onRestored();
  adv(5000); S.frame();
  eq([S.world.glStats() !== null, dom.byCls(S.vp, 'cv-grid').length, !!FACES.attachment()], [true, 0, true], 'restored at 1 s: the GL path stays');
  // lost for good: the 2D grid after GL_LOST_MS, drawn at the camera; no GL draw ever again
  glObj.hooks.onLost(false);
  adv(2900); S.frame();
  eq([S.world.glStats() !== null, dom.byCls(S.vp, 'cv-grid').length], [true, 0], 'at 2.9 s: still waiting');
  const d0 = draws(log);
  adv(200); S.frame();
  const gc = S.vp.childNodes[0];
  eq([S.world.glStats(), gc.className, dom.byCls(S.vp, 'cv-gl').length, FACES.attachment(), S.world.gridStats().n, glObj.alive], [null, 'cv-grid', 0, null, 1, false], 'at 3 s: dead — the 2D grid canvas built and drawn, the GL destroyed');
  S.world.panBy(5, 0); S.frame(); adv(200); S.frame(2);
  eq([draws(log), S.world.gridStats().n], [d0, 2], 'the 2D path from here on');
  S.world.destroy();
});

test('1h fix R2: world.update(id) at a drop (cv-module onMove end / cancel, a fold, a size) reaches the overlap rule on the GL path (FACES.recheck) outside a burst — a module dropped onto a hardware module switches its face to the DOM tier at once, before any observer or rest', () => {
  const log = [];
  const { d, win, w, world, frame, item } = setup({ opts: { createGL: fakeGL(log) } });
  frame();
  // a hardware face in the world: .cv-mod[data-cv-mod=a] > .cv-body > .inst.hw > .hw-decor > svg, registered with cv-face
  // (the fake GL's upload gives nothing: the face stays 'svg' — the overlap rule's modes are what this test reads)
  const A = item('a', 0, 0, 400, 240), B = item('b', 1000, 0, 300, 100);
  const root = d.createElement('div'), deco = d.createElement('div'), svg = d.createElementNS('http://www.w3.org/2000/svg', 'svg');
  root.className = 'inst hw'; deco.className = 'hw-decor'; deco.append(svg); root.append(deco); A.body.append(root);
  A.el.style.left = '0px'; A.el.style.top = '0px'; B.el.style.left = '1000px'; B.el.style.top = '0px';
  class Img { constructor() { this.onload = null; } set src(u) { this._src = u; } get src() { return this._src; } }
  const face = FACES.register(deco, { markup: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"></svg>', w: 400, h: 200, offset: () => ({ x: 0, y: 40 }), env: { win, doc: d, Image: Img, Blob: class { constructor() {} }, URL: { createObjectURL: () => 'blob:1', revokeObjectURL: () => {} } } });
  world.add(A); world.add(B);
  frame(2);
  eq([face.mode, A.el.getAttribute('data-cv-face')], ['svg', 'svg'], 'apart: the GL mode (its base pending on a fake upload)');
  // B dropped onto A: cv-module writes left / top (lx / ly: rect()), then onMove 'end' → world.update('b')
  B.x = 200; B.y = 50; B.el.style.left = '200px'; B.el.style.top = '50px';
  world.update('b');
  eq([face.mode, A.el.getAttribute('data-cv-face')], ['dom', 'dom'], 'the overlap rule ran in update(): the DOM tier');
  B.x = 1000; B.y = 0; B.el.style.left = '1000px'; B.el.style.top = '0px';
  world.update('b');
  eq([face.mode, A.el.getAttribute('data-cv-face')], ['svg', 'svg'], 'apart: back');
  // inside a burst (an edge pan still running at the drop): no layout read then — the burst's end runs it
  world.panBy(3, 0); frame();
  ok(world.busy, 'a burst');
  B.x = 200; B.y = 50; B.el.style.left = '200px'; B.el.style.top = '50px';
  world.update('b');
  eq(face.mode, 'svg', 'not in the burst');
  adv(200); frame(2);
  eq(face.mode, 'dom', 'at its end (cameraend → recheck)');
  face.destroy();
  world.destroy();
  void w;
});

// (P R2-F2) a batch: world.update([ids]) — every listed item re-read, ONE recache pass and ONE FACES.recheck (the overlap rule is
// faces × items: one call per module made a big rack's every edit O(n³)); the end state exactly the per-id path's
function batchScene(many, k) {
  const log = [];
  const S = setup({ opts: { createGL: fakeGL(log) } }), { d, win, world, frame, item } = S;
  frame();
  class Img { constructor() { this.onload = null; } set src(u) { this._src = u; } get src() { return this._src; } }
  const faces = [], its = {};
  const at = (id, x, y, iw, ih, hw) => {
    const it = item(id, x, y, iw, ih);
    it.el.style.left = x + 'px'; it.el.style.top = y + 'px';
    if (hw) {
      const root = d.createElement('div'), deco = d.createElement('div'), svg = d.createElementNS('http://www.w3.org/2000/svg', 'svg');
      root.className = 'inst hw'; deco.className = 'hw-decor'; deco.append(svg); root.append(deco); it.body.append(root);
      faces.push([id, FACES.register(deco, { markup: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"></svg>', w: 400, h: 200, offset: () => ({ x: 0, y: 40 }),
        env: { win, doc: d, Image: Img, Blob: class { constructor() {} }, URL: { createObjectURL: () => 'blob:1', revokeObjectURL: () => {} } } })]);
    }
    its[id] = it; world.add(it);
    return it;
  };
  at('a', 0, 0, 400, 240, true); at('b', 1000, 0, 300, 100); at('c', 1000, 400, 300, 100); at('d', 2000, 0, 400, 240, true); at('e', 2000, 600, 300, 100);
  frame(2);
  const real = world.ids; let ids = 0; // (FACES' recheck reads the world's ids once per run)
  world.ids = () => { ids++; return real(); };
  const move = (id, x, y) => { const it = its[id]; it.x = x; it.y = y; it.el.style.left = x + 'px'; it.el.style.top = y + 'px'; };
  const snap = () => JSON.stringify({ rects: Object.keys(its).map(id => [id, world.rectOf(id), world.onScreen(id)]), faces: faces.map(([id, f]) => [id, f.mode]) });
  // b dropped onto a (overlap: a's face goes to the DOM tier), c far out of view (off screen), e onto d
  move('b', 200, 50); move('c', 9000, 400); move('e', 2100, 100);
  ids = 0;
  many(world);
  const runs = ids; // (before the frame: its 'screen' event runs the overlap rule too)
  frame(2);
  const out = { ids: runs, snap: snap(), modes: faces.map(([id, f]) => id + ':' + f.mode).join(' '), rect: JSON.stringify(world.rectOf('c')), on: world.onScreen('c') };
  for (const [, f] of faces) f.destroy();
  world.destroy();
  void k;
  return out;
}

test('(P R2-F2) world.update([ids]) / a Set: a batch — each known id re-read (unknown skipped), ONE FACES.recheck for the lot (the per-id calls ran it once each: faces × items every time), the same end state; none known → nothing; update() all as before', () => {
  const per = batchScene(w => { w.update('b'); w.update('c'); w.update('e'); });
  const arr = batchScene(w => w.update(['b', 'c', 'e']));
  const set = batchScene(w => w.update(new Set(['b', 'c', 'e', 'zz'])));
  eq(per.ids, 3, 'the per-id path: one recheck per update');
  eq([arr.ids, set.ids], [1, 1], 'a batch: one overlap pass for the lot');
  eq(arr.modes, 'a:dom d:dom', 'the overlap rule ran (b on a, e on d): both faces on the DOM tier');
  eq(arr.snap, per.snap, 'the same end state as the per-id calls: every cached rect, every item on / off screen, every face mode');
  eq(set.snap, per.snap, 'a Set the same, an unknown id skipped');
  eq([arr.rect, arr.on], [per.rect, per.on], 'the far one re-read (off screen at its new place)');
  const none = batchScene(w => { w.update(['nope', 'zz']); w.update([]); });
  eq(none.ids, 0, 'no known id: nothing runs (as update(unknown))');
  eq(none.modes, 'a:svg d:svg', '… and nothing re-read: the faces stay apart-looking until a rest');
  const all = batchScene(w => w.update());
  eq([all.ids, all.snap], [1, per.snap], 'update(): everything re-read, one recheck — the same state');
});

/* ------------------------------------------------------------------ milestone 3 H5: the canvas stores' budget */
test('H5 planStores (pure): no cap within the budget; past it the off-screen stores drop to the dpr first, then the on-screen ones farthest from the centre; the dpr is the floor', () => {
  const MB = 1024 * 1024, B = 64 * MB;
  const S = (key, w, h, t, on, dist) => ({ key, w, h, t, on, dist });
  eq([...W.planStores([S('a', 500, 400, 4, true, 0)], 2, B).caps], [], 'fits');
  // 500 × 400 at t = 4 → 12.8e6 B; 1000 × 800 at 4 → 51.2e6 B each
  const L = [S('near', 500, 400, 4, true, 50), S('far', 1000, 800, 4, true, 600), S('off', 1000, 800, 4, false, 10), S('mid', 1000, 800, 1, true, 0)];
  const P = W.planStores(L, 2, B);
  eq([...P.caps.entries()], [['off', 2], ['far', 2]], 'the off-screen one first, then the farthest on screen; mid already at ≤ the dpr: never a candidate');
  ok(P.bytes <= B, 'Σ ' + P.bytes);
  eq(W.planStores(L, 2, B, 40 * MB).caps.size, 3, 'fixed stores (never sized by the rule) count: one more drops');
  const all = W.planStores([S('x', 4000, 4000, 4, true, 0), S('y', 4000, 4000, 4, false, 0)], 2, B);
  eq([...all.caps.values()], [2, 2], 'everything at the dpr, never below (1:1 at k 1)');
  ok(all.bytes > B, 'still over: measured, never below the dpr');
  eq([...W.planStores([S('z', 100, 100, 0.5, false, 0)], 2, 1).caps], [], 'at k ≤ 1 nothing is above the dpr');
});

test('review 2 P2: canvasStats measures a canvas against its content box (a 1 px border is no layout of its store: 396 store px for a 198 px content box at dpr 2 is 1:1, not 0.99); stores round up — at k 0.4 (dpr · k 0.8: 198 → 158.4) no store falls below 1:1', () => {
  const { d, win, world, frame, item } = setup();
  wk.setCanvasScale(1); wk.setStoreCaps(null);
  win.devicePixelRatio = 2; world.resize(); frame();
  const A = item('a', 0, 0, 500, 400);
  world.add(A);
  const cv = d.createElement('canvas');
  A.body.append(cv);
  layout(cv, 198, 148);
  Object.defineProperty(cv, 'offsetWidth', { get: () => 200, configurable: true });
  Object.defineProperty(cv, 'offsetHeight', { get: () => 150, configurable: true });
  const off = wk.onRescale(cv, () => wk.fitCanvas(cv, 198, 148));
  wk.fitCanvas(cv, 198, 148);
  frame(2);
  try {
    eq([cv.width, cv.height, world.canvasStats().onMin], [396, 296, 1], 'k 1: 1:1 against the content box');
    world.setCamera({ tx: 0, ty: 0, k: 0.4 }); frame(2);
    const st = world.canvasStats();
    eq([cv.width, cv.height, st.onMin >= 1], [159, 119, true], 'k 0.4: ' + st.onMin);
  } finally {
    off();
    world.destroy();
    wk.setCanvasScale(1);
  }
});

test('H5 the world: storeDensity follows the zoom at rest; Σ past CANVAS_BUDGET caps the off-screen store, then the farthest on-screen one (repainted once); canvasStats; a pan re-plans at its rest; destroy clears the caps', () => {
  const { d, win, world, frame, item } = setup();
  wk.setCanvasScale(1); wk.setStoreCaps(null); // (the kit's scale is global: an earlier test's world zoomed)
  win.devicePixelRatio = 2; world.resize(); frame();
  const mk = (it, w, h) => {
    const cv = d.createElement('canvas'); it.body.append(cv);
    const paint = { n: 0 };
    const off = wk.onRescale(cv, () => { paint.n++; wk.fitCanvas(cv, w, h); });
    wk.fitCanvas(cv, w, h);
    return { cv, paint, off, w, h };
  };
  const A = item('a', 0, 0, 500, 400), B = item('b', 300, 0, 1000, 800), C = item('c', 3000, 0, 960, 800);
  for (const it of [A, B, C]) world.add(it);
  const a = mk(A, 500, 400), b = mk(B, 1000, 800), c = mk(C, 960, 800);
  frame(2);
  try {
    eq([a.cv.width, b.cv.width, c.cv.width], [1000, 2000, 1920], 'k 1, dpr 2');
    let st = world.canvasStats();
    eq([st.n, st.bytes, st.minDensity, st.onMin, st.capped, st.budget, st.dpr], [3, (1000 * 800 + 2000 * 1600 + 1920 * 1600) * 4, 1, 1, 0, 64 * 1024 * 1024, 2], 'within the budget: 1:1, no cap');
    world.setCamera({ tx: 0, ty: 0, k: 2 }); frame(2);
    eq([a.cv.width, b.cv.width, c.cv.width], [2000, 2000, 1920], 'at rest k 2: dpr · k = 4 for the near one; the budget capped the off-screen and the far one at the dpr');
    eq([wk.storeCap(a.cv), wk.storeCap(b.cv), wk.storeCap(c.cv)], [undefined, 2, 2]);
    eq([a.paint.n, b.paint.n, c.paint.n], [1, 1, 1], 'one repaint at the zoom\'s rest');
    st = world.canvasStats();
    eq([st.n, st.capped, st.offN, st.onMin, st.minDensity], [3, 2, 1, 0.5, 0.5], 'the far on-screen store below 1:1 by the budget (measured)');
    ok(st.bytes <= st.budget && st.planned <= st.budget, 'Σ ' + st.bytes);
    // a pan to C: at its rest C is on screen and near, A off → the plan moves the caps (one repaint)
    world.setCamera({ tx: -5600, ty: 0, k: 2 }); frame(2);
    eq([wk.storeCap(c.cv), wk.storeCap(a.cv)], [undefined, 2], 'C (now on screen, centred) uncapped; A (off screen) capped');
    eq(c.cv.width, 3840);
    // a zoom out to 50 %: every store at dpr · k = 1, no cap
    world.setCamera({ tx: 0, ty: 0, k: 0.5 }); frame(2);
    eq([a.cv.width, b.cv.width, c.cv.width, wk.storeCap(b.cv)], [500, 1000, 960, undefined]);
    eq(world.canvasStats().onMin, 1);
  } finally {
    for (const x of [a, b, c]) x.off();
    world.destroy();
    wk.setCanvasScale(1);
  }
  eq(wk.storeCap(b.cv), undefined, 'destroy cleared the caps');
});

/* ------------------------------------------------------------------ 1i: the hardware keys with the real gesture.js (IMPL-1i §4.3) */
// the two-finger layer on the same fake window (its capture listeners before the viewport's, as main.js boot installs it),
// its frames and the world's in one queue (flushed after each touch); a module with panel art (a background) and a bed
// ([data-gesture=music], touch-action none: cv-keys) and a controller ([data-gesture=perf]); notes: the bed's pointerdowns
function keysWorld(k) {
  const d = dom.fresh(), win = d.defaultView, rq = [];
  win.document = d; T = 1000; timers.length = 0;
  win.requestAnimationFrame = f => { rq.push(f); return rq.length; }; win.cancelAnimationFrame = () => {};
  win.getComputedStyle = n => ({ touchAction: n._ta || 'auto', overflowX: 'visible', overflowY: 'visible' });
  const ref = {}, frame = () => { for (const f of rq.splice(0)) f(T); };
  const g = G.installGestures(win, { now: () => T, event: (t, i) => new Ev(t, i), setTimeout: setT, clearTimeout: clearT,
    pan: (a, b, c) => ref.world.hooks.pan(a, b, c), zoom: (a, b, c, e) => ref.world.hooks.zoom(a, b, c, e) });
  const vp = d.createElement('div'), w = d.createElement('div'), ov = d.createElement('div');
  vp.id = 'viewport'; vp._ta = 'none'; w.setAttribute('data-cv-world', '');
  vp.append(w); d.body.append(vp, ov);
  place(vp, 0, 0, 1280, 800); place(ov, 0, 0, 1280, 800);
  const env = { win, doc: d, now: () => T, raf: f => win.requestAnimationFrame(f), caf: () => {}, setTimeout: setT, clearTimeout: clearT };
  const world = ref.world = W.createWorld(vp, { world: w, overlay: ov, env, isBackground: el => !!el && el.classList.contains('bg') });
  const mod = d.createElement('div'), body = d.createElement('div'), art = d.createElement('div'), keys = d.createElement('div'), wheel = d.createElement('div');
  mod.setAttribute('data-cv-mod', 'm'); body.className = 'bg'; art.className = 'bg';
  keys._ta = 'none'; keys.setAttribute('data-gesture', 'music'); wheel._ta = 'none'; wheel.setAttribute('data-gesture', 'perf');
  body.append(art, keys, wheel); mod.append(body); w.append(mod);
  world.add({ id: 'm', el: mod, body, rect: () => ({ x: 0, y: 0, w: 1800, h: 700 }), onScreen() {} });
  world.setCamera({ tx: 0, ty: 0, k }); frame();
  place(art, 100, 100, 800, 150); place(keys, 100, 300, 800, 200); place(wheel, 20, 300, 44, 128);
  const notes = []; keys.addEventListener('pointerdown', e => notes.push(e.pointerId));
  const rolls = []; wheel.addEventListener('pointerdown', e => rolls.push(e.pointerId));
  const sleeptaps = []; world.on('sleeptap', e => sleeptaps.push(e && e.id));
  const touch = (el, type, x, y, id, o = {}) => { const e = ptr(el, type, x, y, Object.assign({ pointerType: 'touch', pointerId: id, isPrimary: id === 1 }, o)); frame(); return e; };
  return { g, world, art, keys, wheel, notes, rolls, sleeptaps, touch, frame };
}

test('1i: k 0.4 — two fingers on a sleeping bed are the camera\'s pinch: no note, no two-finger session (the regression S1 became)', () => {
  const { g, world, keys, notes, touch } = keysWorld(0.4);
  touch(keys, 'pointerdown', 400, 400, 1); T += 40; touch(keys, 'pointerdown', 600, 400, 2, { isPrimary: false });
  T += 20; touch(keys, 'pointermove', 380, 400, 1); touch(keys, 'pointermove', 620, 400, 2);
  T += 20; touch(keys, 'pointermove', 300, 400, 1); touch(keys, 'pointermove', 700, 400, 2);
  eq([notes.length, g.state().session], [0, null], 'no key pressed, no session');
  ok(world.k > 0.6, 'the world pinched: ' + world.k);
});

test('1i G2: k 0.8 — a finger resting on the panel art, a key 400 ms later: the key gets its pointerdown, no session, the camera unchanged (the resting finger may still pan); 100 ms later: a nav pinch; a moving pan then a key: the world\'s pinch; a key first then the art: both', () => {
  { // resting finger, then a key after PAIR_MS
    const { g, world, art, keys, notes, touch } = keysWorld(0.8), c0 = JSON.stringify(world.cam);
    touch(art, 'pointerdown', 300, 150, 1); T += 400;
    const e = touch(keys, 'pointerdown', 400, 400, 2, { isPrimary: false });
    eq([notes.join(), g.state().session, JSON.stringify(world.cam), !!e._imm], ['2', null, c0, false], 'the key plays, nothing else');
    T += 16; touch(art, 'pointermove', 340, 150, 1); T += 16; touch(art, 'pointermove', 380, 150, 1);
    eq([Math.round(world.cam.tx), world.k], [80, 0.8], 'the resting finger pans on; no zoom');
    touch(keys, 'pointerup', 400, 400, 2); touch(art, 'pointerup', 380, 150, 1);
  }
  { // within PAIR_MS: gesture.js pairs (the time rule) — a nav pinch, the key never pressed
    const { g, art, keys, notes, touch } = keysWorld(0.8);
    touch(art, 'pointerdown', 300, 150, 1); T += 100; touch(keys, 'pointerdown', 400, 400, 2, { isPrimary: false });
    eq([notes.length, g.state().session], [0, 'nav']);
  }
  { // a pan already moving: the world takes the late finger as its pinch
    const { g, world, art, keys, notes, touch } = keysWorld(0.8);
    touch(art, 'pointerdown', 300, 150, 1); T += 16; touch(art, 'pointermove', 340, 150, 1); T += 400;
    const e = touch(keys, 'pointerdown', 400, 400, 2, { isPrimary: false });
    eq([notes.length, g.state().session, !!e._imm], [0, null, true], 'taken by the world');
    T += 16; touch(art, 'pointermove', 300, 150, 1); touch(keys, 'pointermove', 440, 400, 2);
    T += 16; touch(art, 'pointermove', 250, 150, 1); touch(keys, 'pointermove', 500, 400, 2);
    ok(world.k > 0.8, 'pinched: ' + world.k);
  }
  { // the key first, then the art (either delay): both — the note held, the art finger pans
    for (const gap of [100, 400]) {
      const { g, world, art, keys, notes, touch } = keysWorld(0.8);
      touch(keys, 'pointerdown', 400, 400, 1); T += gap; touch(art, 'pointerdown', 300, 150, 2, { isPrimary: false });
      T += 16; touch(art, 'pointermove', 340, 150, 2); T += 16; touch(art, 'pointermove', 380, 150, 2);
      eq([notes.join(), g.state().session, Math.round(world.cam.tx), world.k], ['1', null, 80, 0.8], 'key then the art ' + gap + ' ms later');
    }
  }
  { // asleep (k 0.4): a resting finger then a key is the pinch, as below READ_K any key is
    const { g, world, art, keys, notes, touch } = keysWorld(0.4);
    touch(art, 'pointerdown', 300, 150, 1); T += 400;
    const e = touch(keys, 'pointerdown', 400, 400, 2, { isPrimary: false });
    eq([notes.length, g.state().session, !!e._imm], [0, null, true], 'k 0.4: the world\'s');
    void world;
  }
});

test('1i G2 (review 1 F5): the hardware controllers too — a finger resting on the art, a wheel pressed 400 ms later: it gets its pointerdown (no session, the camera unchanged, the resting finger may still pan); 100 ms later: a nav pinch; a moving pan: the world\'s pinch; asleep (k 0.4): the pinch', () => {
  { // resting finger, then a controller after PAIR_MS: its press, never the world's late pinch finger
    const { g, world, art, wheel, rolls, touch } = keysWorld(0.8), c0 = JSON.stringify(world.cam);
    touch(art, 'pointerdown', 300, 150, 1); T += 400;
    const e = touch(wheel, 'pointerdown', 40, 360, 2, { isPrimary: false });
    T += 16; touch(art, 'pointermove', 300, 150, 1); touch(wheel, 'pointermove', 40, 300, 2); // (the thumb rolls the wheel up)
    T += 16; touch(wheel, 'pointermove', 40, 250, 2);
    eq([rolls.join(), g.state().session, !!e._imm, JSON.stringify(world.cam) === c0, world.k], ['2', null, false, true, 0.8], 'the wheel gets its press, the camera stays');
    T += 16; touch(art, 'pointermove', 340, 150, 1); T += 16; touch(art, 'pointermove', 380, 150, 1);
    eq([Math.round(world.cam.tx), world.k], [80, 0.8], 'the resting finger pans on; no zoom');
    touch(wheel, 'pointerup', 40, 250, 2); touch(art, 'pointerup', 380, 150, 1);
  }
  { // within PAIR_MS: gesture.js pairs — a nav pinch, the wheel never pressed
    const { g, art, wheel, rolls, touch } = keysWorld(0.8);
    touch(art, 'pointerdown', 300, 150, 1); T += 100; touch(wheel, 'pointerdown', 40, 360, 2, { isPrimary: false });
    eq([rolls.length, g.state().session], [0, 'nav']);
  }
  { // a pan already moving: the world takes the late finger as its pinch
    const { g, art, wheel, rolls, touch } = keysWorld(0.8);
    touch(art, 'pointerdown', 300, 150, 1); T += 16; touch(art, 'pointermove', 340, 150, 1); T += 400;
    const e = touch(wheel, 'pointerdown', 40, 360, 2, { isPrimary: false });
    eq([rolls.length, g.state().session, !!e._imm], [0, null, true], 'taken by the world');
  }
  { // asleep (k 0.4): a resting finger then a controller is the pinch, as below READ_K any control is
    const { g, art, wheel, rolls, touch } = keysWorld(0.4);
    touch(art, 'pointerdown', 300, 150, 1); T += 400;
    const e = touch(wheel, 'pointerdown', 40, 360, 2, { isPrimary: false });
    eq([rolls.length, g.state().session, !!e._imm], [0, null, true], 'k 0.4: the world\'s');
  }
});

test('1i: a tap on a sleeping bed or controller emits the world event sleeptap (main.js hints once); a tap on the art does not, nor the double-tap that focuses the module, nor a tap on awake keys', () => {
  const { world, art, keys, wheel, notes, sleeptaps, touch, frame } = keysWorld(0.4);
  touch(art, 'pointerdown', 300, 150, 1); touch(art, 'pointerup', 300, 150, 1);
  eq(sleeptaps, [], 'the art: no');
  adv(600);
  touch(keys, 'pointerdown', 400, 400, 1); touch(keys, 'pointerup', 400, 400, 1);
  eq([sleeptaps, notes.length, world.selected], [['m'], 0, 'm'], 'a tap on the sleeping keys: selected, the hint event, no note');
  adv(100);
  touch(keys, 'pointerdown', 402, 400, 1); touch(keys, 'pointerup', 402, 400, 1);
  eq(sleeptaps, ['m'], 'the second tap of a double-tap focuses the module: no event');
  for (let i = 0; i < 30; i++) { adv(16); frame(); }
  ok(world.k >= W.READ_K, 'focused: ' + world.k);
  touch(keys, 'pointerdown', 400, 400, 1); touch(keys, 'pointerup', 400, 400, 1);
  eq([sleeptaps.length, notes.length], [1, 1], 'awake: the key plays, no event');
  world.setCamera({ tx: 0, ty: 0, k: 0.4 }); world.select(null); frame(); adv(600);
  touch(wheel, 'pointerdown', 40, 360, 1); touch(wheel, 'pointerup', 40, 360, 1);
  eq(sleeptaps, ['m', 'm'], 'a sleeping controller (perf) too');
});

/* ------------------------------------------------------------------ (9) the cord layer, the cord jacks below READ_K, the fit hook */
// a recording stand-in for cv-cords (the surface cv-world uses): step / draw calls with the time, the camera; swing(n): awake for n
// steps (onWake asks the world for a frame, as the layer does)
function fakeCords(log, made) {
  return (vp, opts) => {
    const L = { opts, running: false, left: 0, owedF: false,
      step(T, busy) { log.push(['step', T, !!busy]); if (L.running) { L.owedF = true; if (--L.left <= 0) L.running = false; } return L.owedF; },
      owed: () => L.owedF, wants: () => L.running || L.owedF,
      draw(c, vw, vh, d) { log.push(['draw', c.tx, c.ty, c.k, vw, vh, d]); L.owedF = false; return true; },
      resize(vw, vh, d) { log.push(['resize', vw, vh, d]); }, reset() { log.push(['reset']); }, svg() { log.push(['svg']); }, destroy() { log.push(['destroy']); },
      setPerf(p) { log.push(['setPerf', p]); }, // ((P) the preset)
      swing(n) { L.running = true; L.left = n; opts.onWake(); } };
    if (made) made.push(L);
    return L;
  };
}
const kinds = log => log.map(e => e[0]);

test('(9) cords(): the layer built at the first call (never at boot), once; its options — the world\'s #world / doc / clock, mode gl (?nogl: svg; ?cords=under or the pref with the GL layer: under, drawn in GL.draw\'s frame), its viewport size; destroy takes it down', () => {
  const log = [], made = [];
  const S = setup({ opts: { createCords: fakeCords(log, made) } });
  S.frame();
  eq(made.length, 0, 'nothing at boot');
  const L = S.world.cords();
  eq([made.length, S.world.cords() === L, L.opts.world === S.w, L.opts.doc === S.d, L.opts.mode, L.opts.test, typeof L.opts.onWake, typeof L.opts.now, typeof L.opts.under], [1, true, true, true, 'gl', false, 'function', 'function', 'function']);
  eq(log[0], ['resize', 1000, 600, 1], 'sized to the viewport');
  S.world.destroy();
  eq([log.at(-1)[0], S.world.cords()], ['destroy', null]);
  const mode = (search, ls, gl) => {
    const m = [], d = dom.fresh(), win = d.defaultView;
    win.location = { search };
    if (ls) win.localStorage = { getItem: k => (k === 'synth.cv.cords' ? ls : null) };
    win.document = d; d.querySelectorAll = () => [];
    const vp = d.createElement('div'), w = d.createElement('div');
    vp.append(w); d.body.append(vp); place(vp, 0, 0, 800, 600);
    const world = W.createWorld(vp, { world: w, env: { win, doc: d, now: () => T, raf: () => 1, caf: () => {}, setTimeout: setT, clearTimeout: clearT }, createGL: gl ? fakeGL([]) : () => null, createCords: fakeCords([], m) });
    world.cords();
    const out = m[0].opts.mode;
    world.destroy();
    return out;
  };
  eq([mode('', null, true), mode('?nogl', null, true), mode('?cords=under', null, true), mode('', 'under', true), mode('?cords=under', null, false), mode('?nogl&cords=under', null, true)], ['gl', 'svg', 'under', 'under', 'gl', 'svg']);
});

test('(9) one draw a frame: the tick steps the ropes, then draws once (the camera stood); a pinch frame — gesture.js\'s own rAF writes twice (its pan hook, then its zoom hook), before the world\'s tick or after it — steps and draws them ONCE at its last camera and the tick, which steps them too, leaves the draw to it; the hold rule from the tick\'s frame length; no frame once every rope sleeps; none while the canvas view is hidden', async () => {
  const log = [], made = [];
  const S = setup({ opts: { createCords: fakeCords(log, made) } });
  S.frame();
  const L = S.world.cords();
  log.length = 0;
  L.swing(80);
  eq(S.rq.length, 1, 'a rope woke: a frame asked for');
  S.frame();
  eq(kinds(log), ['step', 'draw'], 'the frame: the step, then one draw');
  const at = { cx: 500, cy: 400 };
  for (let i = 0; i < 8; i++) {
    log.length = 0;
    const first = i % 2 === 0; // (gesture.js's rAF first, or the world's tick first)
    if (!first) S.frame();
    S.world.hooks.pan(-4, 2, at); S.world.hooks.zoom(1.05, 500, 400, at);
    const c = S.world.cam;
    eq(kinds(log).filter(k => k === 'draw').length, 0, 'nothing drawn mid-callback (two writes)');
    await null; // (the end of gesture.js's callback: its microtask)
    if (first) S.frame();
    const draws = log.filter(e => e[0] === 'draw');
    eq([draws.length, log.some(e => e[0] === 'step')], [1, true], 'pinch frame ' + i + ': stepped, one draw');
    eq(draws[0].slice(1, 4), [c.tx, c.ty, c.k], 'at the callback\'s last camera');
    ok(log.filter(e => e[0] === 'step').every(e => e[2] === false), 'no hold: 16 ms frames');
  }
  // the pinch stops: the tick steps every frame and takes the draw back once the last write is older than its lead (≤ 5 frames)
  log.length = 0;
  S.frame(6);
  eq(log.filter(e => e[0] === 'step').length, 6, 'the tick steps every frame');
  ok(log.filter(e => e[0] === 'draw').length >= 1 && log.filter(e => e[0] === 'draw').length <= 3, 'the tick draws again: ' + kinds(log).join(' '));
  // a slower finger — the gesture's writes every other frame, after the world's tick: never two draws in a frame (the tick
  // leaves the draw to the writes while they keep coming: the sway is drawn with the camera)
  const per = [];
  for (let i = 0; i < 10; i++) {
    log.length = 0; S.frame(); S.world.hooks.pan(-3, 1, at); S.world.hooks.zoom(i < 5 ? 1.03 : 0.97, 500, 400, at); await null;
    per.push(kinds(log).filter(k => k === 'draw').length);
    log.length = 0; S.frame(); per.push(kinds(log).filter(k => k === 'draw').length);
  }
  ok(per.slice(4).every(n => n <= 1) && per.slice(4).filter(n => n === 1).length >= 7, 'draws per frame: ' + per.join(''));
  // the hold rule: in a burst, a frame after one longer than 24 ms steps nothing (the tick's frame length, not the step's)
  log.length = 0;
  S.world.panBy(10, 0); adv(40); S.frame();
  eq([log[0][0], log[0][2]], ['step', true], 'a 56 ms frame in a burst: held');
  S.frame();
  eq(log.filter(e => e[0] === 'step').pop()[2], false, 'the next 16 ms frame: stepped');
  // a pan by the tick (the mouse's): the step first, the draw in write() at the new camera
  log.length = 0;
  S.world.panBy(30, 0); S.frame();
  eq(kinds(log), ['step', 'draw']);
  eq(log[1][1], S.world.cam.tx, 'the frame\'s camera');
  // the rest: still swinging → a step and a draw a frame, until it sleeps; then no frames at all
  let frames = 0;
  while (S.rq.length && frames < 200) { log.length = 0; S.frame(); frames++; ok(kinds(log).filter(k => k === 'draw').length <= 1, 'one draw'); }
  adv(400); S.frame(3);
  eq([L.wants(), S.rq.length], [false, 0], 'asleep: no frame requested');
  // the canvas view hidden (ROLL): never stepped; shown again: on where it was
  L.swing(5); S.world.setActive(false); log.length = 0; S.frame(3);
  eq(log.filter(e => e[0] === 'step').length, 0, 'hidden: never stepped');
  S.world.setActive(true); S.frame();
  ok(log.some(e => e[0] === 'step'), 'shown: stepped again');
});

// (R2b F5) a scripted gesture, a frame per entry of `pat` (1: gesture.js's rAF writes that frame — the pan hook, the zoom hook,
// its microtask): the world's tick (registered a frame ago, so before gesture's rAF in the frame: o.first false) at T, then the
// writes; o.first: gesture's rAF first. The clock +16 a frame (adv: the burst's timers run). → per frame { w, draws, steps, cam, t }
async function gestureFrames(S, log, pat, o = {}) {
  const at = { cx: 500, cy: 400 }, out = [];
  let n = 0;
  for (const w of pat) {
    log.length = 0;
    const t = T, tick = () => { for (const f of S.rq.splice(0)) f(T); };
    const write = async () => { S.world.hooks.pan(-3, 1, at); S.world.hooks.zoom(Math.floor(n++ / 6) % 2 ? 0.97 : 1.03, 500, 400, at); await null; };
    if (o.first) { if (w) await write(); tick(); } else { tick(); if (w) await write(); }
    out.push({ w, t, draws: log.filter(e => e[0] === 'draw'), steps: log.filter(e => e[0] === 'step'), cam: Object.assign({}, S.world.cam) });
    adv(16);
  }
  return out;
}
test('(R2b F5) one cord draw per displayed frame whatever the gesture\'s cadence — gesture.js\'s writes every frame (8 / 16 ms moves) or every 2nd–4th (33 ms, jittered), after the world\'s tick or before it: draws ≤ frames, each write frame\'s one draw at its final camera, the ropes stepped by the tick every frame, drawn again at once when the writes stop', async () => {
  const P = {
    every: Array(24).fill(1), // (8 and 16 ms moves: one flush a frame)
    p33: [1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1], // (33 ms moves: 2–3 frames apart)
    p33b: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1], // (a finger easing off: up to 4 frames)
  };
  for (const first of [false, true]) {
    for (const name of Object.keys(P)) {
      const log = [], made = [], S = setup({ opts: { createCords: fakeCords(log, made) } });
      S.frame();
      const L = S.world.cords();
      L.swing(100000); // (every rope awake the whole run)
      const out = await gestureFrames(S, log, P[name].concat(Array(8).fill(0)), { first }), tag = name + (first ? ' (gesture first)' : ' (tick first)') + ': ';
      const n = out.length, total = out.reduce((a, f) => a + f.draws.length, 0);
      // the one frame the tick cannot know about: the gesture's FIRST write comes after a tick that drew (a frame ahead of the burst)
      ok(out[0].draws.length <= (first ? 1 : 2), tag + 'the first write frame');
      out.forEach((f, i) => {
        if (i > 0) ok(f.draws.length <= 1, tag + 'frame ' + i + ': ' + f.draws.length + ' draws');
        if (f.w) {
          eq(f.draws.length >= 1, true, tag + 'write frame ' + i + ': drawn');
          eq(f.draws.at(-1).slice(1, 4), [f.cam.tx, f.cam.ty, f.cam.k], tag + 'write frame ' + i + ': at the final camera');
        }
      });
      ok(total <= n, tag + 'draws ' + total + ' ≤ frames ' + n);
      // the writes stopped: within the lead (≤ 6 frames) the tick takes the ropes back, then a draw every frame
      const rest = out.slice(P[name].length), at = rest.findIndex(f => f.draws.length);
      ok(at >= 0 && at <= 5, tag + 'the tick draws the swinging ropes again: ' + rest.map(f => f.draws.length).join(''));
      ok(rest.slice(at).every(f => f.draws.length === 1), tag + 'then one draw a frame: ' + rest.map(f => f.draws.length).join(''));
    }
  }
});

test('(R2b F5) the tick draws the cords once, at its end: a camera write inside it (a pan, a glide, a burst\'s rounding) and the layout that write sets off (the host relays the anchors on the camera event: a draw owed after it) are ONE draw at the final camera', () => {
  const log = [], S = setup({ opts: { createCords: fakeCords(log, []) } });
  S.frame();
  const L = S.world.cords();
  S.world.on('camera', () => { L.owedF = true; }); // (main.js: the camera event → the anchors → a draw owed)
  const draws = () => log.filter(e => e[0] === 'draw');
  for (const dx of [30, -12, 7]) {
    log.length = 0;
    S.world.panBy(dx, 0); S.frame();
    eq(draws().length, 1, 'a pan by the tick: one draw');
    eq(draws()[0].slice(1, 4), [S.world.cam.tx, S.world.cam.ty, S.world.cam.k], 'at the final camera');
    ok(kinds(log).indexOf('draw') > kinds(log).indexOf('step'), 'after the step');
  }
  // the wheel / trackpad's pan every frame (the tick's own writes frame after frame): a draw a frame, never two
  const per = [];
  for (let i = 0; i < 12; i++) { log.length = 0; S.world.panBy(5, 1); S.frame(); per.push(draws().length); }
  ok(per.every(n => n === 1), 'draws per frame ' + per.join(''));
});

test('(R2b F5) the tick steps the ropes every frame of a gesture, the frames it leaves the draw to a camera write too (the layer\'s 1/120 s steps are time-driven: no frame\'s time is lost to the writes\' spacing); no hold at 16 ms frames', async () => {
  for (const first of [false, true]) {
    const log = [], S = setup({ opts: { createCords: fakeCords(log, []) } });
    S.frame();
    S.world.cords().swing(100000);
    const out = await gestureFrames(S, log, [1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0], { first });
    out.forEach((f, i) => {
      ok(f.steps.length >= 1 && f.steps.every(s => s[2] === false), (first ? 'gesture first' : 'tick first') + ', frame ' + i + (f.w ? ' (a write)' : '') + ': stepped ' + f.steps.length + 'x');
      ok(f.steps.some(s => s[1] === f.t), 'frame ' + i + ': a step at the frame\'s time ' + f.t);
    });
  }
});

test('(9) the real cv-cords on a fake WebGL2 context through the world: a pinch with every cord swinging — one cord draw (3 draw calls) a frame at that frame\'s camera; camera-only frames upload nothing; asleep: no frames', async () => {
  const calls = [], gl = {};
  for (const k of ['COMPILE_STATUS', 'LINK_STATUS', 'VERTEX_SHADER', 'FRAGMENT_SHADER', 'ARRAY_BUFFER', 'STATIC_DRAW', 'DYNAMIC_DRAW', 'FLOAT', 'TRIANGLE_STRIP', 'BLEND', 'ONE', 'ONE_MINUS_SRC_ALPHA', 'COLOR_BUFFER_BIT', 'DEPTH_TEST']) gl[k] = k;
  for (const k of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'deleteShader', 'useProgram', 'bindVertexArray', 'bindBuffer', 'bufferData', 'bufferSubData', 'enableVertexAttribArray',
    'vertexAttribPointer', 'vertexAttribDivisor', 'uniform3fv', 'disable', 'enable', 'blendFunc', 'clearColor', 'viewport', 'clear', 'drawArrays', 'drawArraysInstanced']) gl[k] = () => { calls.push(k); };
  gl.uniform4fv = (u, a) => { calls.push(u === 'cam' ? ['cam', a[0], a[1], a[2]] : 'uniform4fv'); };
  Object.assign(gl, { createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), createVertexArray: () => ({}), getUniformLocation: (p, n) => n, getShaderParameter: () => true, getProgramParameter: () => true, getExtension: () => null });
  const glDoc = vp => ({ createElement: t => { const el = vp.ownerDocument.createElement(t); if (t === 'canvas') el.getContext = k => (k === 'webgl2' ? gl : null); return el; } });
  const S = setup({ opts: { createCords: (vp, o) => CORDS.createCords(vp, Object.assign({}, o, { doc: glDoc(vp) })) } });
  S.frame();
  const L = S.world.cords();
  L.alloc(false); L.set([]);
  eq(dom.byCls(S.vp, 'cv-cords').length, 0, 'no patched instrument shown, no cords: no canvas');
  L.alloc(true);
  const cv = dom.one(S.vp, 'cv-cords');
  eq([!!cv, S.vp.childNodes.indexOf(cv) === S.vp.childNodes.indexOf(S.w) + 1], [true, true], 'after #world');
  const P = new Map(), list = [];
  for (let i = 0; i < 20; i++) { P.set('a' + i, { x: 40 * i, y: 100 }); P.set('b' + i, { x: 40 * i + 200, y: 300 + 5 * i }); list.push({ id: 'c' + i, a: 'a' + i, b: 'b' + i, c: i % 8, s: i % 5 === 0 ? 1 : 0 }); }
  L.anchors(P); L.set(list); S.frame(2);
  eq([cv.width, cv.height], [1000, 600], 'the buffer: the viewport');
  L.pluck();
  const draws = () => calls.filter(k => k === 'drawArraysInstanced').length, ups = () => calls.filter(k => k === 'bufferSubData').length;
  for (let i = 0; i < 10; i++) {
    const d0 = draws(), n0 = calls.length, first = i % 2 === 0;
    if (!first) S.frame();
    S.world.hooks.pan(-3, 1, { cx: 500, cy: 400 }); S.world.hooks.zoom(i < 5 ? 1.08 : 0.93, 500, 400, { cx: 500, cy: 400 }); // (gesture.js's rAF: two writes)
    await null;
    if (first) S.frame();
    eq(draws() - d0, 1, 'frame ' + i + ': one cord draw');
    const cams = calls.slice(n0).filter(x => Array.isArray(x) && x[0] === 'cam');
    eq(cams.length, 2, 'the camera set once a program (the strips, the plugs)');
    near(cams[0][3], S.world.k, 1e-6, 'at the frame\'s camera'); near(cams[1][3], S.world.k, 1e-6);
    eq(calls.slice(n0).filter(k => k === 'drawArrays').length, 2, 'shadows + cords');
  }
  // the ropes settle, then the camera moves alone: a draw a frame, nothing uploaded
  let f = 0;
  while (L.stats().running && f < 3000) { S.frame(); f++; }
  adv(400); S.frame(3);
  const u0 = ups(), d1 = draws();
  for (let i = 0; i < 4; i++) { S.world.hooks.pan(6, 0, { cx: 500, cy: 400 }); await null; S.frame(); }
  eq([draws() - d1, ups() - u0], [4, 0], 'camera-only frames: drawn, nothing uploaded');
  adv(400); S.frame(3);
  eq([L.wants(), S.rq.length], [false, 0], 'all asleep: no frames');
  ok(L.stats().steps > 0 && L.stats().awakeMax === 20, JSON.stringify(L.stats()));
});

test('(9, IMPL-9 §4.2, review #5) below READ_K a cord jack is not offered to the jack hook unless its module is in edit state — the press is the module body\'s (it pans; a tap selects); every other jack keeps its press; above READ_K the hook has it', () => {
  const R = jackRig();
  const cj = R.d.createElement('span');
  cj.setAttribute('data-cv-jack', 'm.j-saw'); cj.setAttribute('data-kind', 'cord'); R.m.body.append(cj);
  R.world.setJackHook((e, el) => { R.log.push(el.getAttribute('data-cv-jack')); return { cancel: () => {} }; });
  touch(cj, 'pointerdown', 300, 300, 1); touch(R.vp, 'pointerup', 300, 300, 1);
  eq(R.log, ['m.j-saw'], 'k 1: the hook has it');
  R.log.length = 0;
  R.world.setCamera({ tx: 0, ty: 0, k: 0.4 }); R.frame(); adv(400);
  touch(cj, 'pointerdown', 200, 300, 1); touch(R.vp, 'pointermove', 250, 300, 1); touch(R.vp, 'pointerup', 250, 300, 1);
  eq([R.log, R.world.cam.tx, R.world.jacking], [[], 50, false], 'k 0.4: not offered; it panned (a sleeping module body)');
  adv(500);
  touch(cj, 'pointerdown', 200, 300, 1); touch(R.vp, 'pointerup', 200, 300, 1);
  eq([R.log, R.world.selected], [[], 'm'], 'a tap selects the module');
  touch(R.jack, 'pointerdown', 100, 168, 1); touch(R.vp, 'pointerup', 100, 168, 1);
  eq(R.log, ['m.out'], 'another jack: offered below READ_K as before');
  // in edit state (a double-tap's focus pinned below READ_K): the cord jack takes its press
  R.log.length = 0;
  R.world.focusItem('m', { k: 0.4, animate: false }); R.frame(); adv(400); R.frame();
  eq([R.world.edit, R.world.k < W.READ_K], ['m', true]);
  touch(cj, 'pointerdown', 200, 300, 1); touch(R.vp, 'pointerup', 200, 300, 1);
  eq(R.log, ['m.j-saw'], 'edit state: awake');
});

test('(9, IMPL-9 §4.5) the fit hook: the toolbar\'s fit, the 0 key frame the ids the host names, never below its kMin (the foot kept in view; a side that fits centred); null → every item; fit({ ids }) / fit({ all }) skip it; the remover', () => {
  const S = setup(), { world, frame, item, tb, vp } = S;
  const far = item('far', 4000, 4000, 200, 200), ctl = item('ctl', 0, 0, 640, 400), r1 = item('r1', 0, -512, 640, 512), r2 = item('r2', 0, -1024, 640, 512);
  for (const it of [far, ctl, r1, r2]) world.add(it);
  frame();
  // band 1000 × 600 at (0, 100): the rack 640 × 1424 at READ_K is 712 tall > 504 → floored, its foot kept
  const off = world.setFitHook(() => ({ ids: ['ctl', 'r1', 'r2', 'nope'], kMin: W.READ_K, foot: true }));
  world.fit({ animate: false });
  eq(world.k, W.READ_K, 'never below READ_K (the true fit: ' + (504 / 1424).toFixed(3) + ')');
  const foot = world.toClient(0, 400), mid = world.toClient(320, 0);
  near(foot.y, 100 + 600 - 48, 1e-6, 'the controller\'s foot at the band\'s bottom less the pad');
  near(mid.x, 500, 1e-6, 'centred across (it fits)');
  world.setCamera({ tx: 0, ty: 0, k: 1 }); frame(); adv(400);
  dom.byAttr(tb, 'data-cv-tb', 'fit')[0].click(); frame(30); adv(400); frame();
  eq(world.k, W.READ_K, 'the toolbar\'s fit');
  world.setCamera({ tx: 0, ty: 0, k: 1 }); frame(); adv(400);
  vp.focus(); world.key(new Ev('keydown', { key: '0', cancelable: true, bubbles: true })); frame(30); adv(400); frame();
  eq(world.k, W.READ_K, 'the 0 key');
  // a frame that fits: its own fit (≤ 1), the floor unused
  world.setFitHook(() => ({ ids: ['ctl'], kMin: W.READ_K }));
  world.fit({ animate: false });
  near(world.k, Math.min(1, 904 / 640, 504 / 400), 1e-9, 'the controller alone at 1');
  // fit({ all: true }) and explicit ids skip the hook; the remover; a hook saying null: every item
  world.fit({ all: true, animate: false });
  ok(world.k < 0.25 + 1e-9, 'every item (the far one too): ' + world.k);
  world.fit({ ids: ['far'], animate: false });
  eq(world.k, 1, 'explicit ids');
  off();
  world.fit({ animate: false });
  eq(world.k, 1, 'off() only removes its own hook: the second one stays');
  world.setFitHook(() => null);
  world.fit({ animate: false });
  ok(world.k < 0.25 + 1e-9, 'null: every item');
  // the pure floor: fitCam with kMin (the top kept without foot; centred where it fits)
  const c = W.fitCam([{ x: 0, y: 0, w: 640, h: 1424 }], 1000, 600, { pad: 48, kMin: 0.5 });
  eq([c.k, c.ty, c.tx], [0.5, 48, 500 - 160], 'no foot: the top kept');
  const c2 = W.fitCam([{ x: 0, y: 0, w: 4000, h: 300 }], 1000, 600, { pad: 48, kMin: 0.5, foot: true });
  eq([c2.k, c2.tx, c2.ty], [0.5, 48, 300 - 75], 'too wide: its left kept; the height fits: centred');
  eq(W.fitCam([{ x: 0, y: 0, w: 640, h: 1424 }], 1000, 600, { pad: 48 }), W.fitCam([{ x: 0, y: 0, w: 640, h: 1424 }], 1000, 600, { pad: 48, kMin: 0 }), 'no kMin: as before');
});

test('(WC, integration fixer L — review WC-int B3, reworked after its checks 2026-10-26: what matters first, centred) a floored fit\'s focus, in PRIORITY order: fit({ ids, kMin, focus }) / fitCam(…, { focus }) — on a side the rects no longer fit at kMin, the longest head of the focus that fits there: centred, then slid back only as far as the rects\' own edges allow (no blank band past an edge where they go on: the pad kept); centred as it is when it fits only with less air; the first one\'s start when even that does not fit (a keyboard-up band: the chain row whole, Envelope 1 dropped, not the box\'s top corner); the head BOTH floored sides hold, on each (a split view: the chain\'s start alone, after its third check); a side that fits stays centred; no focus or an empty one: as before; the world\'s fit takes its focus ids in their order', () => {
  const R = [{ x: -800, y: 0, w: 3000, h: 400 }], o = f => ({ pad: 48, kMin: 0.5, focus: f });
  const base = W.fitCam(R, 1000, 600, { pad: 48, kMin: 0.5 });
  eq([base.k, base.tx, base.ty], [0.5, 448, 200], 'the start rule (the floor): its left kept, its height centred');
  eq([W.fitCam(R, 1000, 600, o(null)), W.fitCam(R, 1000, 600, o([]))], [base, base], 'no focus, an empty one: as before');
  // (the rects\' edges on screen: left 48 at tx 448, right 952 at tx −148 — tx stays in [−148, 448], the band covered less the pad)
  eq(W.fitCam(R, 1000, 600, o([{ x: -700, y: 0, w: 900, h: 400 }])), base, 'centred would leave a blank band left of the rects: slid back to their left edge');
  const c = W.fitCam(R, 1000, 600, o([{ x: 400, y: 0, w: 1000, h: 400 }]));
  eq([c.k, c.tx, c.ty], [0.5, 500 - 900 * 0.5, 200], 'centred: the rects go on both ways');
  const ce = W.fitCam(R, 1000, 600, o([{ x: 1800, y: 0, w: 300, h: 400 }]));
  eq([ce.k, ce.tx], [0.5, 1000 - 48 - 2200 * 0.5], 'centred would leave a blank band right of them: slid back to their right edge');
  const c2 = W.fitCam(R, 1000, 600, o([{ x: 0, y: 0, w: 1880, h: 400 }]));
  eq([c2.k, c2.tx], [0.5, 500 - 940 * 0.5], 'fits only with less air: centred');
  const c3 = W.fitCam(R, 1000, 600, o([{ x: 100, y: 0, w: 2100, h: 400 }]));
  eq([c3.k, c3.tx], [0.5, 48 - 100 * 0.5], 'wider than the band: its start');
  // priority: the head that fits — a third one past the band is dropped (not the box of all three: 1100 px), then the first alone
  const p3 = W.fitCam(R, 1000, 600, o([{ x: 0, y: 0, w: 400, h: 400 }, { x: 1000, y: 0, w: 400, h: 400 }, { x: 1900, y: 0, w: 300, h: 400 }]));
  eq([p3.k, p3.tx], [0.5, 500 - 700 * 0.5], 'the first two centred, the third dropped');
  const p1 = W.fitCam(R, 1000, 600, o([{ x: 0, y: 0, w: 400, h: 400 }, { x: 1600, y: 0, w: 600, h: 400 }]));
  eq([p1.k, p1.tx], [0.5, 500 - 200 * 0.5], 'the first alone, centred');
  const p0 = W.fitCam(R, 1000, 600, o([{ x: 200, y: 0, w: 2100, h: 400 }, { x: 0, y: 0, w: 100, h: 100 }]));
  eq([p0.k, p0.tx], [0.5, 48 - 200 * 0.5], 'the first wider than the band: its start (the rest never framed instead)');
  // a rig under a keyboard-up band (600 tall): its modulator band (Envelope 1, −900 … −450) over its chain row (0 … 400) — the three do not fit
  // (650 px), the chain's start and the Amplifier do: the chain row whole at the band\'s foot (the rig ends there: no blank band under it),
  // Envelope 1\'s lower part above it; the width fits: centred
  const K = [{ x: 0, y: 0, w: 400, h: 400 }, { x: 400, y: 0, w: 400, h: 300 }, { x: 400, y: -900, w: 400, h: 450 }], RK = [{ x: 0, y: -1200, w: 800, h: 1600 }];
  const kb = W.fitCam(RK, 1000, 600, o(K));
  eq([kb.k, kb.tx, kb.ty], [0.5, 500 - 400 * 0.5, 600 - 48 - 400 * 0.5], 'the chain row whole, its foot at the band\'s less the pad');
  ok(kb.ty + 0 * 0.5 >= 48 && kb.ty + 400 * 0.5 <= 600 - 48 && kb.ty - 450 * 0.5 > 0 && kb.ty - 450 * 0.5 < 600, 'Envelope 1 partly in view above it');
  const K3 = K.slice(0, 2).concat([{ x: 400, y: -500, w: 400, h: 450 }]);
  eq([W.fitCam(RK, 1000, 600, o(K3)).ty], [600 - 48 - 400 * 0.5], 'the three fit (450 px): centred, slid back to the rig\'s foot');
  eq([W.fitCam([{ x: 0, y: -1200, w: 800, h: 2000 }], 1000, 600, o(K3)).ty], [300 - (-500 + 400) / 2 * 0.5], 'the rig going on below: centred');
  const kbs = W.fitCam(RK, 1000, 150, o(K));
  eq([kbs.k, kbs.ty], [0.5, 48 - 0 * 0.5], 'a band shorter than the chain row: the chain\'s start\'s top (never Envelope 1\'s, nor the box\'s corner)');
  // (after its third check) the head BOTH sides hold: a split view (500 × 600) — across only the chain's start fits (the Amplifier stands
  // 1024 px on), down all three would (574 px, with less air): the start placed down by itself, centred (157), not by the three (Envelope 1's
  // column is not on screen: that left the start at the band's foot under blank canvas); across centred too (the rig goes on left: an LFO)
  const SV = [{ x: 0, y: 0, w: 352, h: 572 }, { x: 1024, y: 0, w: 288, h: 388 }, { x: 1056, y: -576, w: 352, h: 468 }];
  const sv = W.fitCam([{ x: -800, y: -600, w: 2800, h: 2000 }], 500, 600, o(SV));
  eq([sv.k, sv.tx, sv.ty], [0.5, 250 - 352 / 2 * 0.5, 300 - 572 / 2 * 0.5], 'the chain\'s start alone, centred both ways');
  eq([W.fitCam([{ x: 0, y: -600, w: 2000, h: 2000 }], 500, 600, o(SV)).tx], [48], 'across: slid back to the rig\'s left edge (nothing left of it)');
  const c4 = W.fitCam([{ x: 0, y: -1600, w: 3000, h: 2000 }], 1000, 600, o([{ x: 2000, y: 0, w: 600, h: 400 }]));
  eq([c4.k, c4.tx, c4.ty], [0.5, 1000 - 48 - 3000 * 0.5, 600 - 48 - 400 * 0.5], 'both sides floored: each centred and slid back to the rects\' edge (right, foot)');
  const c5 = W.fitCam([{ x: 0, y: 0, w: 640, h: 400 }], 1000, 600, o([{ x: 0, y: 0, w: 100, h: 100 }]));
  eq(c5, W.fitCam([{ x: 0, y: 0, w: 640, h: 400 }], 1000, 600, { pad: 48, kMin: 0.5 }), 'not floored: the plain fit');
  // the world's fit: focus names ids (their rects as the fit reads them), in the order given (not the items\')
  const S = setup(), { world, frame, item } = S;
  for (const it of [item('lfo', -800, 0, 600, 400), item('osc', 0, 0, 400, 400), item('amp', 1000, 0, 400, 400), item('fx', 1600, 0, 600, 400)]) world.add(it);
  frame();
  world.fit({ ids: ['lfo', 'osc', 'amp', 'fx'], kMin: W.READ_K, animate: false });
  const a0 = world.toClient(1400, 0);
  ok(world.k === W.READ_K && a0.x > 1000, 'the start rule alone leaves the Amplifier out (' + a0.x + ')');
  world.fit({ ids: ['lfo', 'osc', 'amp', 'fx'], kMin: W.READ_K, focus: ['osc', 'amp', 'nope'], animate: false });
  const o1 = world.toClient(0, 0), a1 = world.toClient(1400, 0);
  eq(world.k, W.READ_K, 'at READ_K');
  ok(o1.x >= 48 - 1e-6 && a1.x <= 1000 - 48 + 1e-6, 'the focus whole: ' + o1.x + ' … ' + a1.x);
  ok(Math.abs((o1.x + a1.x) / 2 - 500) < 17, 'centred: ' + o1.x + ' … ' + a1.x);
  for (const [F, k0, k1] of [[['fx', 'osc'], 1600, 2200], [['osc', 'fx'], 0, 400]]) { // (osc … fx: 1100 px — one of them, the first named)
    world.fit({ ids: ['lfo', 'osc', 'amp', 'fx'], kMin: W.READ_K, focus: F, animate: false });
    const l = world.toClient(k0, 0).x, r = world.toClient(k1, 0).x;
    ok(l >= 0 && r <= 1000, F + ': ' + F[0] + ' whole (' + l + ' … ' + r + ')');
  }
});

/* ------------------------------------------------------------------ (P) the performance preset, ?texmax, the device-ratio route */
test('(P) the preset: o.perf at build (unknown → high), ?perf= over it for the session (never stored), the cord layer built with it, setPerf live to the cord layer (and cv-face\'s FACES.setPerf); glStats().perf; PERFS / PERF_PREF / perfOf', t => {
  eq([W.PERFS, W.PERF_PREF, ['high', 'medium', 'low', 'x', null].map(W.perfOf)], [['high', 'medium', 'low'], 'synth.cv.perf', ['high', 'medium', 'low', 'high', 'high']]);
  const log = [], made = [];
  const S = setup({ opts: { perf: 'medium', createGL: fakeGL([]), createCords: fakeCords(log, made) } });
  S.frame();
  eq([S.world.perf, S.world.glStats().perf], ['medium', 'medium'], 'o.perf');
  const L = S.world.cords();
  eq(L.opts.perf, 'medium', 'cords() built at the preset');
  S.world.setPerf('low');
  eq([S.world.perf, log.filter(e => e[0] === 'setPerf').map(e => e[1]), S.world.glStats().perf], ['low', ['low'], 'low'], 'setPerf → the cord layer');
  S.world.setPerf('turbo');
  eq([S.world.perf, log.filter(e => e[0] === 'setPerf').pop()[1]], ['high', 'high'], 'unknown → high');
  eq([...S.prefs.keys()].includes(W.PERF_PREF), false, 'the world never stores it (main.js does)');
  if (typeof FACES.setPerf === 'function') { // (lane T's cv-face: the texture density follows)
    S.world.setPerf('medium');
    eq([FACES.stats().perf, S.world.glStats().perf, 'faceBudget' in S.world.glStats()], ['medium', 'medium', true], 'FACES.setPerf reached; its budget as faceBudget');
    S.world.setPerf('high');
    eq(FACES.stats().perf, 'high');
  } else t.diagnostic('cv-face has no setPerf yet (lane T): its half checked after the merge');
  S.world.destroy();
  for (const [search, perf, want] of [['?perf=low', 'high', 'low'], ['?a=1&perf=medium', undefined, 'medium'], ['?perf=fast', 'medium', 'medium'], ['?perfx=low', 'medium', 'medium'], ['', 'low', 'low'], ['', 'bogus', 'high']]) {
    const d = dom.fresh(), win = d.defaultView, m = [];
    win.location = { search }; win.document = d; d.querySelectorAll = () => [];
    const vp = d.createElement('div'), w = d.createElement('div');
    vp.append(w); d.body.append(vp); place(vp, 0, 0, 800, 600);
    const prefs = new Map(), store = { get: (k, def) => (prefs.has(k) ? prefs.get(k) : def), set: (k, v) => prefs.set(k, v) };
    const world = W.createWorld(vp, { world: w, store, perf, env: { win, doc: d, now: () => T, raf: () => 1, caf: () => {}, setTimeout: setT, clearTimeout: clearT }, createGL: fakeGL([]), createCords: fakeCords([], m) });
    world.cords();
    eq([world.perf, m[0].opts.perf, prefs.size], [want, want, 0], JSON.stringify([search, perf]));
    world.destroy();
  }
});

test('(P) ?texmax=N reaches createGL as o.maxTex (beside ?nogl; cv-gl takes min(the GPU\'s, N)); absent, 0 or not a number: no maxTex', () => {
  for (const [search, want] of [['?texmax=4096', 4096], ['?a&texmax=2048&b=1', 2048], ['', null], ['?texmax=0', null], ['?texmax=abc', null], ['?texmax=4096x', null], ['?nogl&texmax=4096', 'off']]) {
    let seen = 'off';
    const mk = (vp, o) => { seen = 'maxTex' in o ? o.maxTex : null; return fakeGL([])(vp, o); };
    const { world } = bare({ location: { search } }, mk);
    eq(seen, want, search);
    world.destroy();
  }
});

test('(P, IMPL-P §1.1, skeptic #13) a device-ratio change (its matchMedia \'change\') re-checks the faces — cv-face\'s rest-time recheck (a registered face\'s offset read again, the overlap rule, its plan) — though no camera is written; not inside a burst; the GL buffer and the cords re-sized at the new ratio', () => {
  const mq = [];
  const win0 = { devicePixelRatio: 1, matchMedia: q => { const m = { media: q, matches: false, addEventListener: (ty, f) => mq.push({ q, f, on: true, m }), removeEventListener: (ty, f) => { for (const e of mq) if (e.f === f) e.on = false; } }; return m; } };
  const log = [], lc = [], made = [];
  const d = dom.fresh(), win = d.defaultView;
  for (const k of Object.keys(win0)) win[k] = win0[k];
  win.document = d; d.querySelectorAll = () => [];
  const vp = d.createElement('div'), w = d.createElement('div');
  w.setAttribute('data-cv-world', '');
  vp.append(w); d.body.append(vp); place(vp, 0, 0, 1000, 600);
  const rq = [];
  const world = W.createWorld(vp, { world: w, env: { win, doc: d, now: () => T, raf: f => { rq.push(f); return rq.length; }, caf: () => {}, setTimeout: setT, clearTimeout: clearT }, createGL: fakeGL(log), createCords: fakeCords(lc, made) });
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { const q = rq.splice(0); for (const f of q) f(T); T += 16; } };
  frame();
  world.cords();
  // a hardware face in a module (as the R2 test): its offset() reads counted
  const el = d.createElement('div'), body = d.createElement('div'), root = d.createElement('div'), deco = d.createElement('div'), svg = d.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('data-cv-mod', 'a'); body.className = 'bg'; root.className = 'inst hw'; deco.className = 'hw-decor';
  deco.append(svg); root.append(deco); body.append(root); el.append(body); w.append(el);
  el.style.left = '0px'; el.style.top = '0px';
  class Img { constructor() { this.onload = null; } set src(u) { this._src = u; } get src() { return this._src; } }
  let reads = 0;
  const face = FACES.register(deco, { markup: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"></svg>', w: 400, h: 200, offset: () => { reads++; return { x: 0, y: 40 }; }, env: { win, doc: d, Image: Img, Blob: class { constructor() {} }, URL: { createObjectURL: () => 'blob:1', revokeObjectURL: () => {} } } });
  world.add({ id: 'a', el, rect: () => ({ x: 0, y: 0, w: 400, h: 240 }) });
  frame(2);
  ok(reads > 0 && !world.busy, 'mounted (its offset read), at rest');
  const live = () => mq.filter(e => e.on && /resolution/.test(e.q));
  eq(live().length, 1, 'one device-ratio watch');
  const r0 = reads, c0 = log.filter(e => e[0] === 'resize').length, k0 = world.cam.k, tx0 = world.cam.tx;
  win.devicePixelRatio = 2;
  live()[0].f();
  eq([reads - r0, log.filter(e => e[0] === 'resize').pop().slice(1), log.filter(e => e[0] === 'resize').length - c0, lc.filter(e => e[0] === 'resize').pop().slice(1)], [1, [1000, 600, 2], 1, [1000, 600, 2]], 'the faces re-checked (the offset read again), the GL buffer and the cords at 2×');
  eq([world.cam.k, world.cam.tx, live().length, live()[0].q], [k0, tx0, 1, '(resolution: 2dppx)'], 'no camera written; the watch moved to the new ratio');
  // inside a burst: no re-check (no layout read in a burst; its end plans the faces)
  world.panBy(5, 0); frame();
  ok(world.busy, 'a burst');
  const r1 = reads;
  win.devicePixelRatio = 1.5;
  live()[0].f();
  eq(reads, r1, 'not in a burst');
  face.destroy();
  world.destroy();
  eq(mq.filter(e => e.on).length, 0, 'destroy: the watch removed');
});

test('(P) the real cv-cords through the world at each preset: medium swings at 6 points, low never asks for a frame at rest — a module drag (its anchors relayed) is one redraw a change, no rope-step, the dragged cord\'s end on its plug; setPerf mid-sway: asleep at once, no frame after its one draw', () => {
  const gl = {};
  for (const k of ['COMPILE_STATUS', 'LINK_STATUS', 'VERTEX_SHADER', 'FRAGMENT_SHADER', 'ARRAY_BUFFER', 'STATIC_DRAW', 'DYNAMIC_DRAW', 'FLOAT', 'TRIANGLE_STRIP', 'BLEND', 'ONE', 'ONE_MINUS_SRC_ALPHA', 'COLOR_BUFFER_BIT', 'DEPTH_TEST']) gl[k] = k;
  for (const k of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'deleteShader', 'useProgram', 'bindVertexArray', 'bindBuffer', 'bufferData', 'bufferSubData', 'enableVertexAttribArray',
    'vertexAttribPointer', 'vertexAttribDivisor', 'uniform3fv', 'uniform4fv', 'disable', 'enable', 'blendFunc', 'clearColor', 'viewport', 'clear', 'drawArrays', 'drawArraysInstanced']) gl[k] = () => {};
  Object.assign(gl, { createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), createVertexArray: () => ({}), getUniformLocation: (p, n) => n, getShaderParameter: () => true, getProgramParameter: () => true, getExtension: () => null });
  const glDoc = vp => ({ createElement: t => { const el = vp.ownerDocument.createElement(t); if (t === 'canvas') el.getContext = k => (k === 'webgl2' ? gl : null); return el; } });
  const P = new Map(), list = [];
  for (let i = 0; i < 12; i++) { P.set('a' + i, { x: 60 * i, y: 100 }); P.set('b' + i, { x: 60 * i + 200, y: 300 }); list.push({ id: 'c' + i, a: 'a' + i, b: 'b' + i, c: i % 8 }); }
  for (const perf of ['medium', 'low']) {
    const S = setup({ opts: { perf, createCords: (vp, o) => CORDS.createCords(vp, Object.assign({}, o, { doc: glDoc(vp) })) } });
    S.frame();
    const L = S.world.cords();
    L.alloc(true); L.anchors(new Map(P)); L.set(list); S.frame(2);
    eq([L.stats().perf, L.stats().quality, L.stats().pts], [perf, perf === 'low' ? 'still' : 'light', 14], perf);
    L.pluck();
    S.frame(3);
    eq(L.stats().awake, perf === 'low' ? 0 : 12, perf + ': plucked');
    let n = 0;
    while (L.wants() && n++ < 3000) S.frame();
    eq([L.wants(), S.rq.length], [false, 0], perf + ': at rest, no frames');
    // a module drag: the a ends of c3 and c4 moved, relayed a pointer move
    const st0 = L.stats().steps;
    for (let i = 1; i <= 8; i++) { const Q = new Map(P); Q.set('a3', { x: 180 + 32 * i, y: 100 }); Q.set('a4', { x: 240 + 32 * i, y: 100 }); L.anchors(Q); S.frame(); }
    const end = L.pointAt('c3', 0);
    ok(Math.abs(end.x - (180 + 256)) < 1e-6 && Math.abs(end.y - 100) < 1e-6, perf + ': the cord\'s end on its plug: ' + JSON.stringify(end));
    n = 0;
    while (L.wants() && n++ < 3000) S.frame();
    if (perf === 'low') eq([L.stats().steps - st0, n, S.rq.length], [0, 0, 0], 'low: no rope-step, no frame left owed after the drag');
    else ok(L.stats().steps > st0 && S.rq.length === 0, 'medium: the two swung, then sleep');
  }
  // setPerf mid-sway through the world
  const S = setup({ opts: { createCords: (vp, o) => CORDS.createCords(vp, Object.assign({}, o, { doc: glDoc(vp) })) } });
  S.frame();
  const L = S.world.cords();
  L.alloc(true); L.anchors(new Map(P)); L.set(list); S.frame(2); L.pluck(); S.frame(5);
  eq(L.stats().awake, 12, 'High: swinging');
  S.world.setPerf('medium');
  eq([L.stats().perf, L.stats().awake, L.stats().running], ['medium', 0, false], 'asleep at once');
  const d0 = L.stats().draws;
  S.frame(3);
  eq([L.stats().draws - d0, S.rq.length, L.wants()], [1, 0, false], 'one draw (the parabolas), then no frames');
});

/* ------------------------------------------------------------------ stage WC (IMPL-WC §3.2, §4.4; lane C) */
test('(WC, §3.2) a rig\'s cord jack ([data-kind=cord][data-cv-awake]) stays awake at every zoom a line jack does: offered to the jack hook below READ_K, never taken as the sleeping body; a 900 Series\' cord jack (no data-cv-awake) still sleeps', () => {
  const R = jackRig();
  const rj = R.d.createElement('span'), pj = R.d.createElement('span');
  rj.setAttribute('data-cv-jack', 'm.in'); rj.setAttribute('data-kind', 'cord'); rj.setAttribute('data-cv-awake', ''); R.m.body.append(rj);
  pj.setAttribute('data-cv-jack', 'm.j-saw'); pj.setAttribute('data-kind', 'cord'); R.m.body.append(pj);
  R.world.setJackHook((e, el) => { R.log.push(el.getAttribute('data-cv-jack')); return { cancel: () => {} }; });
  R.world.setCamera({ tx: 0, ty: 0, k: 0.4 }); R.frame(); adv(400);
  touch(rj, 'pointerdown', 200, 300, 1); touch(R.vp, 'pointermove', 250, 300, 1); touch(R.vp, 'pointerup', 250, 300, 1);
  eq([R.log, R.world.cam.tx, R.world.selected], [['m.in'], 0, null], 'k 0.4: offered, no pan, nothing selected');
  adv(500); R.log.length = 0;
  touch(pj, 'pointerdown', 200, 300, 1); touch(R.vp, 'pointermove', 250, 300, 1); touch(R.vp, 'pointerup', 250, 300, 1);
  eq([R.log, R.world.cam.tx], [[], 50], 'the 900 Series\' cord jack: asleep (the body pans), as before');
  // the hook declines the awake jack: still no sleeping-body pan from it (a jack is no body)
  R.world.setJackHook(() => false);
  adv(500);
  touch(rj, 'pointerdown', 200, 300, 1); touch(R.vp, 'pointermove', 260, 300, 1); touch(R.vp, 'pointerup', 260, 300, 1);
  eq(R.world.cam.tx, 50, 'declined: never the body\'s pan');
});

test('(WC, §4.4; the lead\'s decision 2) the cord hook: a press that would pan (empty canvas, a module background, a sleeping body) asks hit(p, HIT_PX / k) at its world point; a TAP on a cord is its tap(id, e, p) — not a deselect, no double-tap fit, its click eaten; a drag on it pans; no cord: as before; the remover', () => {
  const { vp, w, world, frame, item, d } = setup();
  const m = item('m', 100, 100, 400, 300);
  world.add(m);
  frame(); adv(500);
  const log = [];
  eq(typeof world.setCordHook, 'function');
  const off = world.setCordHook((p, r, e) => { log.push('hit ' + p.x + ',' + p.y + ' ' + r + ' ' + e.pointerType); return p.x > 800 ? 'x:i1:a>b' : null; }, (id, e, p) => log.push('tap ' + id + ' ' + p.x + ',' + p.y + ' ' + e.pointerType));
  world.select('m');
  touch(vp, 'pointerdown', 900, 650, 1); touch(vp, 'pointerup', 901, 651, 1);
  eq([log, world.selected], [['hit 900,550 ' + CORDS.HIT_PX + ' touch', 'tap x:i1:a>b 900,550 touch'], 'm'], 'a tap on a cord: its tap — the selection stays');
  const ck = new dom.Ev('click', { bubbles: true, cancelable: true });
  vp.dispatchEvent(ck);
  eq(ck.defaultPrevented, true, 'its click eaten (never the × that appeared under it)');
  adv(100); log.length = 0;
  touch(vp, 'pointerdown', 905, 652, 1); touch(vp, 'pointerup', 905, 652, 1); frame(30);
  eq([log.filter(s => s.startsWith('tap')).length, cam(world.cam)], [1, { tx: 0, ty: 0, k: 1 }], 'a second tap: the cord\'s again, no double-tap fit');
  adv(500); log.length = 0;
  mouse(w, 'pointerdown', 900, 500); mouse(vp, 'pointermove', 950, 520, { buttons: 1 }); mouse(vp, 'pointerup', 950, 520); frame();
  eq([log.filter(s => s.startsWith('tap')), world.cam.tx], [[], 50], 'a drag on it pans (a cord never steals a pan)');
  adv(500); log.length = 0;
  world.setCamera({ tx: 0, ty: 0, k: 1 }); frame(); adv(400);
  mouse(m.body, 'pointerdown', 300, 300); mouse(vp, 'pointerup', 300, 300);
  eq([log, world.selected], [['hit 300,200 ' + CORDS.HIT_PX + ' mouse'], 'm'], 'a module background: asked; no cord there — the tap selects the module');
  adv(500); log.length = 0;
  world.setCamera({ tx: 0, ty: 0, k: 0.5 }); frame(); adv(400);
  touch(vp, 'pointerdown', 450, 300, 1); touch(vp, 'pointerup', 450, 300, 1);
  eq(log, ['hit 900,400 ' + CORDS.HIT_PX * 2 + ' touch', 'tap x:i1:a>b 900,400 touch'], 'k 0.5: the world point, r = HIT_PX / k');
  world.setCamera({ tx: 0, ty: 0, k: 0.4 }); frame(); adv(400); log.length = 0;
  touch(m.body, 'pointerdown', 100, 150, 1); touch(vp, 'pointerup', 100, 150, 1);
  eq([log.length, world.selected], [1, 'm'], 'a sleeping body: asked (no cord: the tap selects it)');
  off();
  adv(500); log.length = 0;
  touch(vp, 'pointerdown', 900, 650, 1); touch(vp, 'pointerup', 900, 650, 1);
  eq([log, world.selected], [[], null], 'removed: a tap deselects as before');
});

/* ---- (WC, integration fixer K; the skeptics of review P2-3: a face clips its jacks' hit circles, an enlarged circle steals the controls above) */
test('(WC, fixer K; review P2-3, its skeptics) setJackNear(fn): a press on no jack asks fn(p, k, t, { empty, sleep, mod }) at its world point — the empty canvas (empty), a sleeping body (sleep, its module), anything else in a module (its module: the host keeps a control\'s press) — and a [data-cv-jack] it names is offered to the jack hook as that jack\'s press: taken in the capture phase (no pan, nothing selected); null or a non-jack: as before (a pan, a tap\'s select, a control\'s own press); a press on a jack is its own (never asked); never during a glide; the remover', () => {
  const R = jackRig(), asks = [];
  const ctl = R.d.createElement('button'); R.m.el.append(ctl);
  let ctlDowns = 0; ctl.addEventListener('pointerdown', () => ctlDowns++);
  R.world.setJackHook((e, el) => { R.log.push('jack ' + el.getAttribute('data-cv-jack') + ' ' + e.pointerType); return { cancel: () => {} }; });
  eq(typeof R.world.setJackNear, 'function');
  const where = t => (t === R.vp ? 'vp' : t === R.w ? 'world' : t === R.m.body ? 'body' : t === ctl ? 'ctl' : '?');
  let give = 'jack';
  const off = R.world.setJackNear((p, k, t, o) => {
    asks.push([p.x, p.y, k, where(t), String(o.empty), String(o.sleep), String(o.mod)].join(' '));
    return p.x < 950 ? null : give === 'jack' ? R.jack : give === 'body' ? R.m.body : null;
  });
  // the empty canvas right of the module (k 1): the near jack's press — taken, no pan
  touch(R.vp, 'pointerdown', 960, 300, 1); touch(R.vp, 'pointermove', 1000, 360, 1); R.frame(); touch(R.vp, 'pointerup', 1000, 360, 1);
  eq([asks.splice(0), R.log.splice(0), cam(R.world.cam), R.world.selected], [['960 200 1 vp true false null'], ['jack m.out touch'], { tx: 0, ty: 0, k: 1 }, null], 'asked at its world point; offered to the jack hook, taken (no pan)');
  adv(500);
  // an awake module background, nothing near: asked (its module), declined — the pan as ever
  touch(R.m.body, 'pointerdown', 300, 300, 1); touch(R.vp, 'pointermove', 340, 300, 1); R.frame(); touch(R.vp, 'pointerup', 340, 300, 1);
  eq([asks.splice(0), R.log.length, R.world.cam.tx], [['300 200 1 body false false m'], 0, 40], 'declined: the background pans');
  adv(500); R.world.setCamera({ tx: 0, ty: 0, k: 1 }); R.frame(); adv(400);
  // an awake control: asked (the host keeps it: null) — the control's own press, no pan
  touch(ctl, 'pointerdown', 200, 300, 1); touch(R.vp, 'pointerup', 200, 300, 1);
  eq([asks.splice(0), R.log.length, ctlDowns], [['200 200 1 ctl false false m'], 0, 1], 'a control: its own press');
  adv(500);
  // a press on the jack itself: its own (never asked)
  touch(R.jack, 'pointerdown', 900, 168, 1); touch(R.vp, 'pointerup', 900, 168, 1);
  eq([asks.splice(0), R.log.splice(0)], [[], ['jack m.out touch']], 'a jack: the jack hook, never asked');
  adv(500);
  // k 0.4: a sleeping body near the jack (the host names it) — taken; far from it — the body's pan, a tap selects
  R.world.setCamera({ tx: 0, ty: 0, k: 0.4 }); R.frame(); adv(400);
  touch(R.m.body, 'pointerdown', 390, 300, 1); touch(R.vp, 'pointermove', 420, 330, 1); R.frame(); touch(R.vp, 'pointerup', 420, 330, 1);
  eq([asks.splice(0), R.log.splice(0), R.world.cam.tx], [['975 500 0.4 body false true m'], ['jack m.out touch'], 0], 'k 0.4, a sleeping body: asked (sleep), taken');
  adv(500);
  touch(R.m.body, 'pointerdown', 100, 300, 1); touch(R.vp, 'pointerup', 100, 300, 1);
  eq([asks.splice(0), R.log.length, R.world.selected], [['250 500 0.4 body false true m'], 0, 'm'], 'declined: the tap selects the sleeping module');
  adv(500);
  // a non-jack answer: as before (the body's pan)
  give = 'body';
  touch(R.m.body, 'pointerdown', 390, 300, 1); touch(R.vp, 'pointermove', 420, 300, 1); R.frame(); touch(R.vp, 'pointerup', 420, 300, 1);
  eq([asks.splice(0).length, R.log.length, R.world.cam.tx], [1, 0, 30], 'a non-jack: never offered');
  give = 'jack';
  adv(500); R.world.setCamera({ tx: 0, ty: 0, k: 1 }); R.frame(); adv(400);
  // a flicked pan's glide: a touch during it only stops it (never asked)
  touch(R.vp, 'pointerdown', 500, 650, 1);
  for (let i = 1; i <= 6; i++) { T += 16; touch(R.vp, 'pointermove', 500 - 20 * i, 650, 1); }
  touch(R.vp, 'pointerup', 380, 650, 1); R.frame(5);
  asks.length = 0;
  touch(R.vp, 'pointerdown', 980, 300, 2, { isPrimary: true }); touch(R.vp, 'pointerup', 980, 300, 2);
  eq([asks.length, R.log.length], [0, 0], 'during a glide: never asked');
  for (let i = 0; i < 300 && R.world.busy; i++) R.frame();
  adv(500);
  off();
  touch(R.vp, 'pointerdown', 980, 300, 1); touch(R.vp, 'pointerup', 980, 300, 1);
  eq([asks.length, R.log.length], [0, 0], 'removed: never asked');
});

test('(WC, fixer K; review P3-9, its skeptics\' round 1) the drop outline\'s label in WHOLE lines, never sliced: placeGhost counts the lines its box holds (11 px at 1.2: 13.2 px a line, under the 8 px top, 3 px clear of the bottom border) — ≥ 2: data-lines and --gl-lines (style.css: a word-wrapped -webkit-line-clamp, its last line ending in …); 1: no data-lines — the base\'s one nowrap line ending in …; a box too short for two there (the iPad\'s Fit zoom: a 32 px Bend) takes them 1 px clear, centred (data-lift, its middle as the inline top; style.css translate −50 %) rather than lose the second; the lines and the width counted from the visible part of a box larger than the canvas (dx / dy: never past its outline)', () => {
  const { world, frame, d } = setup();
  frame();
  const lab = () => all(d.documentElement).find(n => n.className === 'cv-ghost-label');
  const at = (k, w, h, label, x = 500, y = 400) => {
    world.setCamera({ tx: 0, ty: 0, k }); frame();
    world.ghost({ x, y, w, h, label, snap: false });
    const L = lab(), v = L.style['--gl-lines'];
    return [L.getAttribute('data-lines'), v == null || v === '' ? null : String(v), L.hasAttribute('data-lift'), L.style.top || '', L.style.maxWidth || ''];
  };
  // a Modulators tile (240 × 128 world px) at the iPad's Fit zooms: the skeptic's Bend at 25 / 28 % and Aftertouch at 30 %
  eq(at(0.25, 240, 128, '+ Bend'), ['2', '2', true, '14.5px', ''], '32 px at 25 % (the base: "+ B…"): two whole lines in its 29 px, centred');
  eq(at(0.28, 240, 128, '+ Bend'), ['2', '2', true, '16.4px', ''], '35.84 px at 28 % (the skeptic\'s cut "BEND"): two whole lines, centred in 32.84');
  eq(at(0.3, 240, 128, '+ Aftertouch'), ['2', '2', true, '17.7px', ''], '38.4 px: two, centred');
  eq(at(0.25, 160, 160, '+ Note'), ['2', '2', true, '18.5px', ''], 'Note at 25 % (40 px): two, centred');
  eq(at(0.35, 240, 128, '+ Bend'), ['2', '2', false, '', ''], '44.8 px: two lines under the 8 px top (41.8 − 11 = 30.8 → 2)');
  eq(at(1, 240, 128, '+ Bend'), ['8', '8', false, '', ''], '128 px: eight under the 8 px top (125 − 11 = 114 → 8)');
  eq(at(0.25, 240, 96, '+ Bend'), [null, null, true, '10.5px', ''], '24 px: one line — the base\'s nowrap … — centred in its 21 px');
  eq(at(1, 240, 128, '+ Bend'), ['8', '8', false, '', ''], 'back: every lift mark taken off');
  eq(at(0.25, 240, 96, '+ Bend'), [null, null, true, '10.5px', ''], 'and the lines\'');
  // larger than the canvas (the band: x 0 … 1000, y 100 … 700): the label moved into its visible part, counted from there
  eq(at(1, 1200, 900, 'Serum · replaces Juno-60', 50, 400), ['55', '55', false, '', '630px'], 'its left 550 px off the band: the label 550 in, as wide as the 630 px it has left (1200 − 20 − 550)');
  eq(at(0.25, 800, 300, 'Serum · replaces Juno-60', 500, 110), ['2', '2', false, '', ''], 'its top 27.5 px over the band: two lines in the 44.5 px seen (75 − 3 − 27.5), not the four of the whole box');
  eq(at(0.25, 800, 300, 'Serum · replaces Juno-60', 500, 400), ['4', '4', false, '', ''], 'the same box inside the band: four');
  eq(at(0.25, 800, 160, 'Serum · replaces Juno-60', 500, 101), ['2', '2', true, '16.5px', ''], 'a 40 px box 19 px over the band (dy 4, the most: 40 − 36): two lines centred in the 33 px seen (the transform adds the dy)');
  world.ghost(null);
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const rule = sel => (css.match(new RegExp(sel.replace(/[.[\]]/g, m => '\\' + m) + ' \\{[^}]*\\}')) || [''])[0];
  const base = rule('#overlay .cv-ghost-label'), many = rule('#overlay .cv-ghost-label[data-lines]'), lift = rule('#overlay .cv-ghost-label[data-lift]');
  ok(/white-space: nowrap;/.test(base) && /overflow: hidden;/.test(base) && /text-overflow: ellipsis;/.test(base) && /top: 8px;/.test(base), 'one line: the base\'s nowrap under the 8 px top, ending in …: ' + base);
  ok(!/max-height/.test(base), 'no height cut through a line\'s letters: ' + base);
  ok(/white-space: normal;/.test(many) && /display: -webkit-box;/.test(many) && /-webkit-box-orient: vertical;/.test(many) && /-webkit-line-clamp: var\(--gl-lines/.test(many), 'several: wrapped and clamped to the lines counted, the last ending in …: ' + many);
  ok(!/overflow-wrap: (break-word|anywhere)|word-break: break-all|max-height/.test(many), 'at words only, never a height cut: ' + many);
  ok(/translate: 0 -50%;/.test(lift), 'a short box: its lines centred on the inline top: ' + lift);
});

/* ------------------------------------------------------------------ (the user, 2026-10-26: "we need a button that makes cables go behind") */
// a cord layer that records behind() and tells its allocation (cv-cords' onAlloc)
function fakeCordsB(log, made) {
  const mk = fakeCords(log, made);
  return (vp, opts) => {
    const L = mk(vp, opts);
    L.hide = null;
    L.behind = fn => { L.hide = typeof fn === 'function' ? fn : null; log.push(['behind', typeof fn]); };
    L.alloc = on => { log.push(['alloc', !!on]); if (typeof opts.onAlloc === 'function') opts.onAlloc(!!on); };
    return L;
  };
}
test('(the user, 2026-10-26: "we need a button that makes cables go behind") the toolbar\'s cables-behind toggle: after ∿, the row\'s style (a 44 px target on touch), shown only on a cord canvas (the cord layer allocated: a Wavecraft in cords mode, a 900 Series); off by default ("Cables behind modules: off", aria-pressed false — today\'s look); a tap puts the cables behind the modules: the layer told behind(fn), fn writing each module\'s world rect (x0 y0 x1 y1, its live x / y: a module in the finger), remembered in synth.cv.behind, a \'behind\' event; again: back on top (behind(null)); a saved on restores (the layer, built later, told at once); setBehind / behindOn', () => {
  const log = [], made = [];
  const S = setup({ opts: { createCords: fakeCordsB(log, made) } });
  S.frame();
  const b = all(S.tb).find(n => n.getAttribute && n.getAttribute('data-cv-tb') === 'behind');
  ok(b, 'the button');
  eq([W.BEHIND_PREF, b.className, b.hasAttribute('hidden'), b.getAttribute('aria-pressed'), b.getAttribute('aria-label'), b.title, S.world.behindOn()],
    ['synth.cv.behind', 'cv-tb-btn', true, 'false', 'Cables behind modules: off', 'Cables behind modules: off', false], 'off, hidden until a cord canvas');
  ok(/<svg[^>]*aria-hidden="true"/.test(String(b.innerHTML)), 'an icon');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  ok(/\.cv-tb-btn\[hidden\]\s*\{\s*display:\s*none;?\s*\}/.test(css), 'style.css hides a hidden toolbar button (its display is inline-flex)');
  ok(/@media \(pointer: coarse\) \{\s*\.cv-tb > \[data-cv-tb="tools"\][^}]*\}\s*\.cv-tb-btn \{ width: 44px; height: 44px;/.test(css), 'a 44 px target on touch (the row\'s)');
  const L = S.world.cords();
  L.alloc(true);
  eq(b.hasAttribute('hidden'), false, 'a cord canvas: shown');
  const it1 = S.item('a', 10, 20, 300, 200), it2 = S.item('b', 400, 20, 200, 100);
  S.world.add(it1); S.world.add(it2); S.frame();
  const told = [];
  S.world.on('behind', on => told.push(on));
  eq(L.hide, null, 'the layer not told yet');
  b.click();
  eq([b.getAttribute('aria-pressed'), b.getAttribute('aria-label'), S.world.behindOn(), S.prefs.get('synth.cv.behind'), told, typeof L.hide], ['true', 'Cables behind modules: on', true, true, [true], 'function'], 'on');
  const out = new Float32Array(4 * 64), n = L.hide(out, 64);
  eq([n, Array.from(out.slice(0, 8))], [2, [10, 20, 310, 220, 400, 20, 600, 120]], 'the modules\' world rects');
  it1.x = 50; it1.y = 60; // (a module in the finger: its live place, no rect read)
  const r0 = it1.reads;
  L.hide(out, 64);
  eq([Array.from(out.slice(0, 4)), it1.reads - r0], [[50, 60, 350, 260], 0], 'followed live, no layout read');
  eq(L.hide(out, 1), 1, 'never past max');
  b.click();
  eq([b.getAttribute('aria-pressed'), S.world.behindOn(), S.prefs.get('synth.cv.behind'), told, L.hide, log.filter(e => e[0] === 'behind').map(e => e[1])], ['false', false, false, [true, false], null, ['function', 'object']], 'off: back on top');
  S.world.setBehind(false); S.world.setBehind(true); S.world.setBehind(true);
  eq(told, [true, false, true], 'one event a change');
  L.alloc(false);
  eq(b.hasAttribute('hidden'), true, 'no cord canvas: hidden again (its state kept)');
  const S2 = setup({ prefs: [['synth.cv.behind', true]], opts: { createCords: fakeCordsB([], []) } });
  S2.frame();
  const b2 = all(S2.tb).find(n => n.getAttribute && n.getAttribute('data-cv-tb') === 'behind');
  eq([S2.world.behindOn(), b2.getAttribute('aria-pressed')], [true, 'true'], 'restored on');
  eq(typeof S2.world.cords().hide, 'function', 'the layer built later: told at once');
  const S3 = setup({ prefs: [['synth.cv.behind', 'yes']] });
  eq(S3.world.behindOn(), false, 'a bad pref: off');
});

test('(the cables-behind toggle) the real cv-cords through the world on a fake WebGL2: off (the default), no hide uniform is ever written — today\'s frames; on, every cord frame hands the GL the modules\' rects (nh, hb) and a module moved is followed at the next frame; off again: nh 0', async () => {
  const calls = [], gl = {};
  for (const k of ['COMPILE_STATUS', 'LINK_STATUS', 'VERTEX_SHADER', 'FRAGMENT_SHADER', 'ARRAY_BUFFER', 'STATIC_DRAW', 'DYNAMIC_DRAW', 'FLOAT', 'TRIANGLE_STRIP', 'BLEND', 'ONE', 'ONE_MINUS_SRC_ALPHA', 'COLOR_BUFFER_BIT', 'DEPTH_TEST']) gl[k] = k;
  for (const k of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'deleteShader', 'useProgram', 'bindVertexArray', 'bindBuffer', 'bufferData', 'bufferSubData', 'enableVertexAttribArray',
    'vertexAttribPointer', 'vertexAttribDivisor', 'uniform3fv', 'disable', 'enable', 'blendFunc', 'clearColor', 'viewport', 'clear', 'drawArrays', 'drawArraysInstanced', 'uniform2iv']) gl[k] = () => { calls.push(k); };
  gl.uniform4fv = (u, a) => { calls.push(u === 'hb' ? ['hb', ...Array.from(a)] : 'uniform4fv'); };
  gl.uniform1i = (u, v) => { calls.push([u, v]); };
  Object.assign(gl, { createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), createVertexArray: () => ({}), getUniformLocation: (p, n) => n, getShaderParameter: () => true, getProgramParameter: () => true, getExtension: () => null });
  const glDoc = vp => ({ createElement: t => { const el = vp.ownerDocument.createElement(t); if (t === 'canvas') el.getContext = k => (k === 'webgl2' ? gl : null); return el; } });
  const S = setup({ opts: { createCords: (vp, o) => CORDS.createCords(vp, Object.assign({}, o, { doc: glDoc(vp) })) } });
  S.frame();
  const L = S.world.cords(), it = S.item('m', 100, 50, 200, 150);
  S.world.add(it); L.alloc(true);
  L.anchors(new Map([['a', { x: 20, y: 100 }], ['b', { x: 500, y: 120 }]])); L.set([{ id: 'c', a: 'a', b: 'b', c: 2, s: 0 }]); S.frame(3);
  const hide = () => calls.filter(c => Array.isArray(c) && (c[0] === 'nh' || c[0] === 'hb') || c === 'uniform2iv');
  ok(calls.includes('drawArraysInstanced') && hide().length === 0, 'off: drawn, no hide uniform');
  const b = all(S.tb).find(n => n.getAttribute && n.getAttribute('data-cv-tb') === 'behind');
  b.click(); S.frame(2);
  const nh = () => calls.filter(c => Array.isArray(c) && c[0] === 'nh').pop(), hb = () => calls.filter(c => Array.isArray(c) && c[0] === 'hb').pop();
  eq([nh(), hb()], [['nh', 1], ['hb', 100, 50, 300, 200]], 'on: the module\'s rect');
  it.x = 140; S.world.hooks.pan(-2, 0, { cx: 500, cy: 400 }); await null; S.frame();
  eq(hb(), ['hb', 140, 50, 340, 200], 'moved: followed');
  b.click(); S.frame(8); // (the pan's own draws lead for a few frames: the tick draws once they are stale)
  eq(nh(), ['nh', 0], 'off again');
});
