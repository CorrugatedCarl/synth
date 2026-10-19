import './v8-guard.mjs';
// cv-world.js (stage 1b WORLD lane; docs/canvas/IMPL-1b.md §8.2; Z1 of docs/canvas/IMPL-panels.md §8.1): camera maths,
// on-screen tracking (planScreen, onScreen from cached rects, the 'screen' event), zoom consistency (nothing changes look
// at any zoom), the soft DOM budget, sleeping controls below READ_K, native-zoom hand-over, momentum guard, late-finger
// pinch, wheel + veto, edit state, edge auto-pan, ghost re-projection, localPoint under the world transform. Fake DOM: tests/wk-dom.mjs. Never pass fake-DOM nodes to assert.*
// (compare ids / strings / numbers). Stage 1e: the jack hook (a press on a jack is the cable drag's; a second finger
// cancels it and pinches; a two-finger cancel, Escape, setActive(false) cancel it). Stage 2a: the ∿ cycle (Always / On
// select / Never, synth.cv.mods, 'mods' events). Run alone: node --max-old-space-size=2048 --test tests/cv-world.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as dom from './wk-dom.mjs';
import * as W from '../cv-world.js?v=9';
import * as wk from '../wk.js?v=9';
import * as MOD from '../cv-module.js?v=9';
import * as CAB from '../cv-cables.js?v=9';

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
  eq([W.DOT, W.MAJOR, W.SNAP_PREF], [32, 128, 'synth.cv.snap'], 'the visible grid, its pref');
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
  const R = rng(5);
  for (let i = 0; i < 60; i++) {
    const d = [1, 2, 3][i % 3], c = { tx: (R() - 0.5) * 3000, ty: (R() - 0.5) * 3000, k: 0.25 + R() * 1.75 }, w = Math.round((300 + R() * 1200) * d), h = Math.round((200 + R() * 900) * d);
    const x = recCtx(), n = W.gridDraw(x, c, w, h, d), Z = W.gridSizes(d), o = Z.side >> 1, cc = Z.side / 2 - o, sp = 32 * c.k * d, a = W.gridBg(c).minor.a;
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
    const want = a > 0 && sp >= W.GRID_MIN_DPX;
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
    ['canvas', 'cv-grid', 'true', true, 1000, 600, '1000px', '600px'], '1g: the grid canvas under #world, device px (dpr 1)');
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

test('1g: the grid canvas is drawn on each written camera frame and on a resize / device-ratio change — never otherwise', () => {
  const { vp, w, win, world, frame } = setup();
  frame();
  const gc = vp.childNodes[0], ctx = gc.getContext('2d'), draws = () => ctx.calls.filter(c => c[0] === 'clearRect').length;
  const n0 = draws();
  ok(n0 >= 1, 'drawn at boot');
  frame(5);
  eq(draws(), n0, 'frames without a camera change draw nothing');
  world.panBy(10.3, -4.7); frame();
  eq(draws(), n0 + 1, 'one written frame, one draw');
  world.panBy(5, 5); world.panBy(5, 5); frame();
  eq(draws(), n0 + 2, 'two moves in one frame: one draw');
  adv(200); frame(3);
  const n1 = draws(); // (the burst's end may write its rounded rest)
  world.resize(); frame(2);
  eq(draws(), n1, 'a resize that changes nothing: no draw');
  place(vp, 0, 100, 900, 600); world.resize();
  eq([gc.width, gc.height, draws()], [900, 600, n1 + 1], 'a resize: sized and drawn');
  win.devicePixelRatio = 2; world.resize();
  eq([gc.width, gc.height, gc.style.width, gc.style.height, draws()], [1800, 1200, '900px', '600px', n1 + 2], 'dpr 2: device px, CSS-sized to the viewport');
  // the dots of a drawn frame are whole device px and the stats count the draws
  const st = world.gridStats(true);
  ok(st.n >= 3 && st.dots > 0 && st.max >= 0, JSON.stringify(st));
  eq(world.gridStats().n, 0, 'reset');
  const xs = ctx.calls.filter(c => c[0] === 'rect' || c[0] === 'arc').slice(-50);
  ok(xs.length > 0 && xs.every(c => Number.isInteger(c[1] * 2) && Number.isInteger(c[2] * 2)), 'whole (or half: a disc\'s centre) device px');
  world.destroy();
  eq([gc.width, gc.height, vp.childNodes.includes(gc)], [0, 0, false], 'destroy: released and removed');
  void w;
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
  vv.scale = 1.5; vv.dispatchEvent(new Ev('resize'));
  eq([world.native, vp.hasAttribute('data-cv-native'), chip.hidden, got], [true, true, false, [true]]);
  eq([world.hooks.pan(5, 5, { cx: 300, cy: 300 }), world.hooks.zoom(1.2, 300, 300, { cx: 300, cy: 300 })], [false, false], 'every hook hands back');
  touch(vp, 'pointerdown', 300, 300, 1); touch(vp, 'pointermove', 360, 300, 1); touch(vp, 'pointerup', 360, 300, 1);
  eq(cam(world.cam), { tx: 0, ty: 0, k: 1 }, 'no own pan: the browser pans the zoomed page');
  vv.scale = 1; vv.dispatchEvent(new Ev('scroll'));
  eq([world.native, vp.hasAttribute('data-cv-native'), chip.hidden, got], [false, false, true, [true, false]]);
  eq(world.hooks.pan(5, 5, { cx: 300, cy: 300 }), true);
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

test('keys (focus in the viewport or on a module root / bar): 0 fits, 1 = 100 %, arrows nudge the selection one GRID (Shift ×4) through onMove start / end; form controls and play keys are not the canvas\'s', () => {
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
  world.setSnap(false);
  eq(key('ArrowRight'), [true, true]);
  eq(moves.slice(-2), ['start:72,160', 'end:72,160'], 'snap off: the fine step from where it is');
  world.setSnap(true);
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

test('toolbar: − / % / + / fit / tidy / ∿ (2a: the mod cables\' visibility) / the native chip; ⊕ ⊖ step the zoom about the band centre, % resets to 100 %; folds behind one ⊕ button', () => {
  const { tb, world, frame, tidy, item } = setup();
  const btn = n => all(tb).find(x => x.getAttribute && x.getAttribute('data-cv-tb') === n);
  eq(['out', 'pct', 'in', 'fit', 'tidy', 'mods', 'native', 'tools'].map(n => !!btn(n)), [true, true, true, true, true, true, true, true]);
  eq([btn('mods').disabled, btn('mods').getAttribute('aria-label'), btn('pct').textContent], [false, 'Modulation cables: Always', '100%']);
  world.add(item('a', 0, 0, 500, 300)); frame();
  btn('in').click(); frame(30);
  eq([world.k, btn('pct').textContent], [1.25, '125%']);
  btn('in').click(); btn('in').click(); frame(30);
  eq(world.k, 2, 'steps compose while animating');
  btn('out').click(); frame(30);
  eq(world.k, 1.5);
  btn('pct').click(); frame(30);
  eq([world.k, btn('pct').textContent], [1, '100%']);
  btn('tidy').click();
  eq(tidy.n, 1);
  btn('fit').click(); frame(30);
  eq(cam(world.cam), cam(W.fitCam([{ x: 0, y: 0, w: 500, h: 300 }], 1000, 600)));
  btn('tools').click();
  eq([btn('tools').getAttribute('aria-expanded'), btn('tools').parentNode.hasAttribute('data-open')], ['true', true]);
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

test('Snap to grid: the toolbar toggle (aria-pressed, remembered in synth.cv.snap, a snap event); off = free ghost drops; a saved off starts off', () => {
  const { tb, world, prefs, frame } = setup();
  frame();
  const b = all(tb).find(n => n.getAttribute && n.getAttribute('data-cv-tb') === 'snap');
  ok(b, 'the Snap button');
  eq([b.getAttribute('aria-pressed'), world.snapOn()], ['true', true], 'on by default');
  const told = [];
  world.on('snap', on => told.push(on));
  b.click();
  eq([b.getAttribute('aria-pressed'), world.snapOn(), prefs.get('synth.cv.snap')], ['false', false, false]);
  eq(told, [false], 'a snap event');
  const g = world.ghost({ x: 500, y: 400, w: 200, h: 100, label: 'x' });
  eq([g.x % 32 !== 0 || g.y % 32 !== 0, g.x, g.y], [true, 400, 250], 'off: the outline follows the pointer exactly');
  b.click();
  eq([world.snapOn(), prefs.get('synth.cv.snap')], [true, true]);
  const S2 = setup({ prefs: [['synth.cv.snap', false]] });
  S2.frame();
  const b2 = all(S2.tb).find(n => n.getAttribute && n.getAttribute('data-cv-tb') === 'snap');
  eq([S2.world.snapOn(), b2.getAttribute('aria-pressed')], [false, 'false'], 'restored off');
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
test('lock view: the toolbar toggle next to Snap (a padlock, aria-pressed, "Lock view: on / off", remembered in synth.cv.lock, a lock event, [data-cv-locked]); a saved on starts locked', () => {
  const { tb, vp, world, prefs, frame } = setup();
  frame();
  const btns = all(tb).filter(n => n.getAttribute && n.getAttribute('data-cv-tb')), names = btns.map(n => n.getAttribute('data-cv-tb'));
  const b = btns.find(n => n.getAttribute('data-cv-tb') === 'lock');
  ok(b, 'the Lock button');
  eq(names.indexOf('lock'), names.indexOf('snap') + 1, 'next to Snap');
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

test('lock view: the toolbar\'s + / − / % / fit and the minimap (a tap, a drag) still move the camera; box-select (Shift-drag, a held finger) still works; a second finger still ends a finger\'s marquee unapplied (two fingers win) without moving the camera', () => {
  const { tb, vp, ov, world, item, frame } = setup();
  const a = item('a', 0, 0, 200, 100), b = item('b', 400, 0, 200, 100);
  world.add(a); world.add(b); frame();
  world.setLock(true);
  const btn = n => all(tb).find(x => x.getAttribute && x.getAttribute('data-cv-tb') === n);
  btn('in').click(); frame(30);
  eq(world.k, 1.25, '+');
  btn('out').click(); frame(30);
  eq(world.k, 1, '−');
  btn('in').click(); frame(30); btn('pct').click(); frame(30);
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
