import './v8-guard.mjs';
// cv-world.js (stage 1b WORLD lane; docs/canvas/IMPL-1b.md §8.2): camera maths, culling / cards / sliced mounting,
// pinch-defer, native-zoom hand-over, momentum guard, late-finger pinch, wheel + veto, edit state, edge auto-pan, ghost
// re-projection, localPoint under the world transform. Fake DOM: tests/wk-dom.mjs. Never pass fake-DOM nodes to assert.*
// (compare ids / strings / numbers). Run alone: node --max-old-space-size=2048 --test tests/cv-world.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as dom from './wk-dom.mjs';
import * as W from '../cv-world.js?v=9';
import * as wk from '../wk.js?v=9';

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
  eq([W.K_MIN, W.K_MAX, W.CARD_K, W.EDIT_K, W.GRID, W.CULL_MARGIN, W.SLICE_MS, W.MOMENTUM_GUARD_MS, W.WHEEL_VETO_MS, W.BUDGET_EL],
    [0.25, 2, 0.5, 0.9, 8, 256, 12, 120, 300, 9000], 'the contract constants');
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
  ok(/0\.24\) 1\.1px/.test(W.gridImage(1)) && /0\.15\) 0\.9px/.test(W.gridImage(1)), 'the major layer first, then the fine one');
  ok(/, 0\) 0\.9px/.test(W.gridImage(0)), 'fine layer transparent at alpha 0');
  eq(W.visibleRect({ tx: 100, ty: 50, k: 2 }, 800, 600, 0), { x: -50, y: -25, w: 400, h: 300 });
  eq(W.visibleRect({ tx: 0, ty: 0, k: 0.5 }, 100, 100, 50), { x: -100, y: -100, w: 400, h: 400 }, 'margin in screen px');
  eq([W.intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 }), W.intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })], [true, false]);
});

test('lodOf: card below 0.5, body from it; a pinch keeps the previous level across 0.5 (pinch-defer)', () => {
  eq([W.lodOf(0.49, 'body', false), W.lodOf(0.5, 'card', false), W.lodOf(1.2, 'card', false)], ['card', 'body', 'body']);
  eq([W.lodOf(0.3, 'body', true), W.lodOf(0.9, 'card', true)], ['body', 'card'], 'pinching: kept');
  eq(W.lodOf(0.3, undefined, true), 'card', 'nothing before: the level of k');
});

test('planMount: margin culling (screen px), nearest the centre first, the DOM budget cuts the farthest (the nearest always mounts)', () => {
  const c = { tx: 0, ty: 0, k: 1 }, vw = 1000, vh = 600;
  const items = [
    { id: 'far', rect: { x: 1400, y: 0, w: 100, h: 100 }, cost: 10 },     // 400 px right of the view: culled (margin 256)
    { id: 'edge', rect: { x: 1200, y: 0, w: 100, h: 100 }, cost: 10 },    // 200 px out: inside the margin
    { id: 'mid', rect: { x: 450, y: 250, w: 100, h: 100 }, cost: 10 },    // on the centre
    { id: 'left', rect: { x: 0, y: 0, w: 100, h: 100 }, cost: 10 },
  ];
  const p = W.planMount(items, c, vw, vh);
  eq(p.body, ['mid', 'left', 'edge'], 'nearest the centre first');
  eq([p.card, p.why], [['far'], { far: 'cull' }]);
  const b = W.planMount(items, c, vw, vh, { budget: 15 });
  eq([b.body, b.card.sort(), b.why.left, b.why.edge], [['mid'], ['edge', 'far', 'left'], 'budget', 'budget'], 'past the budget: cards');
  eq(W.planMount([{ id: 'serum', rect: { x: 0, y: 0, w: 10, h: 10 }, cost: 20000 }], c, vw, vh).body, ['serum'], 'the nearest always mounts');
  const z = W.planMount(items, { tx: 0, ty: 0, k: 0.4 }, vw, vh);
  eq([z.body.length, z.why.mid], [0, 'zoom'], 'below CARD_K: every item a card');
  eq(W.planMount(items, c, vw, vh, { margin: 0 }).card.sort(), ['edge', 'far'], 'no margin');
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
  for (const t of ['camera', 'movestart', 'cameraend', 'lod', 'native', 'select', 'edit']) world.on(t, x => events.push([t, x]));
  // a world item: a positioned element (its body the owner's) logging its view() calls; viewMs: the clock a call takes
  function item(id, x, y, iw, ih, cost, viewMs = 0) {
    const el = d.createElement('div'), body = d.createElement('div');
    el.setAttribute('data-cv-mod', id); body.className = 'bg';
    el.append(body); w.append(el);
    const it = { id, el, body, cull: 'hide', cost, log: [], x, y, rect: () => ({ x: it.x, y: it.y, w: iw, h: ih }),
      view(v, why) { it.log.push(v + (why ? ':' + why : '')); T += viewMs; } };
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
  eq(vp.style.backgroundSize, '128px 128px, 32px 32px');
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

test('items: cards first at add (switch), bodies in ≤ 12 ms slices nearest the centre first; culling, cards below 0.5, budget cards; clear() + re-add shows cards first', () => {
  const { world, frame, item } = setup();
  const a = item('a', 400, 200, 200, 200, 100, 5), b = item('b', 100, 100, 100, 100, 100, 5), c = item('c', 700, 400, 100, 100, 100, 5), far = item('far', 5000, 0, 100, 100, 100, 5);
  for (const it of [b, far, c, a]) world.add(it);
  eq([a.log, b.log, far.log], [['card:switch'], ['card:switch'], ['card:switch']], 'cards first, at once');
  frame();
  // 5 ms per view(): two per frame (a third would pass 12 ms), cards first, then bodies nearest the centre (500, 300)
  const order = () => [a, b, c, far].map(x => x.log.slice(1).join(',')).join(' | ');
  eq(order(), 'body |  |  | card:cull', 'first frame: the culled card, then the nearest body');
  frame();
  eq(order(), 'body | body | body | card:cull', 'second frame: the next two');
  eq(world.viewOf('far'), 'card');
  // zoom out below CARD_K: every item a card (why 'zoom'), at the zoom end only
  world.setCamera({ tx: 0, ty: 0, k: 0.4 });
  frame(3);
  eq([a.log.at(-1), b.log.at(-1), c.log.at(-1), far.log.at(-1)], ['card:zoom', 'card:zoom', 'card:zoom', 'card:zoom']);
  // a track switch: clear and add again → cards first, then bodies
  world.setCamera({ tx: 0, ty: 0, k: 1 });
  frame(3);
  world.clear();
  eq(world.ids(), []);
  const a2 = item('a', 400, 200, 200, 200, 100), b2 = item('b', 100, 100, 100, 100, 100);
  world.add(a2); world.add(b2);
  eq([a2.log, b2.log], [['card:switch'], ['card:switch']]);
  frame(2);
  eq([a2.log, b2.log], [['card:switch', 'body'], ['card:switch', 'body']]);
});

test('items: the DOM budget leaves the farthest as "budget" cards; update() re-plans after a size change; a pinch across 0.5 defers the level to its end', () => {
  const { world, frame, item, events, vp } = setup();
  const near1 = item('n', 450, 250, 100, 100, 6000), far1 = item('f', 900, 500, 100, 100, 6000);
  world.add(near1); world.add(far1);
  frame(3);
  eq([near1.log.at(-1), far1.log.at(-1)], ['body', 'card:budget'], '9000 elements: the nearer Serum mounts, the other stays a card');
  // the hooks' pinch from k 1 down to 0.4: nothing changes until the fingers lift
  const at = { cx: 500, cy: 400 };
  win2touches(vp, 2);
  ok(world.hooks.zoom(0.7, 500, 400, at) && world.hooks.zoom(0.6, 500, 400, at), 'claimed');
  frame(2);
  ok(world.k < 0.5, 'k ' + world.k);
  eq([near1.log.at(-1), vp.getAttribute('data-cv-lod')], ['body', 'body'], 'mid-pinch: no view change (pinch-defer)');
  win2touches(vp, 0); // the last finger lifts: the burst ends (150 ms after the last move), the plan runs
  adv(200); frame(3);
  eq([near1.log.at(-1), far1.log.at(-1), vp.getAttribute('data-cv-lod')], ['card:zoom', 'card:zoom', 'card'], 'at the end: cards');
  ok(events.some(e => e[0] === 'lod' && e[1].lod === 'card'), 'lod event');
  // update(): a module that grew is re-planned
  world.setCamera({ tx: 0, ty: 0, k: 1 }); frame(3);
  near1.x = 5000; world.update('n'); frame(2);
  eq(near1.log.at(-1), 'card:cull', 'moved out of view (update)');
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
  const wide = item('wide', 0, 3000, 2600, 2400); // wider than the band even at CARD_K: left aligned at CARD_K
  world.add(wide);
  world.focusItem('wide', { animate: false, edit: false });
  eq(cam(world.cam), { tx: 48, ty: 48 - 1500, k: 0.5 });
  // reveal: a client rect just past the right edge of the band → the minimal pan
  world.setCamera({ tx: 0, ty: 0, k: 1 });
  world.reveal({ left: 980, top: 200, right: 1040, bottom: 230 });
  frame(30);
  eq(cam(world.cam), { tx: -56, ty: 0, k: 1 }, '16 px inside the band');
});

test('fit: a layout that fits just under CARD_K with the 48 px margin is shown at CARD_K (bodies) when it fits there with 12 px; never below the band', () => {
  const { world, frame, item } = setup();
  const a = item('a', 0, 0, 1900, 1100); // band 1000 × 600: 48 px pads → k = min(904/1900, 504/1100) ≈ 0.458
  world.add(a); frame();
  world.fit({ animate: false });
  eq(world.k, 0.5, 'bodies (1900 × 0.5 = 950 ≤ 976, 550 ≤ 576)');
  a.x = 0; const b = item('b', 0, 0, 2400, 1100); world.remove('a'); world.add(b);
  world.fit({ animate: false });
  ok(world.k < 0.5, 'too wide even at a thin margin: the true fit (' + world.k + ')');
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

test('toolbar: − / % / + / fit / tidy / ∿ (disabled) / the native chip; ⊕ ⊖ step the zoom about the band centre, % resets to 100 %; folds behind one ⊕ button', () => {
  const { tb, world, frame, tidy, item } = setup();
  const btn = n => all(tb).find(x => x.getAttribute && x.getAttribute('data-cv-tb') === n);
  eq(['out', 'pct', 'in', 'fit', 'tidy', 'mods', 'native', 'tools'].map(n => !!btn(n)), [true, true, true, true, true, true, true, true]);
  eq([btn('mods').disabled, btn('mods').getAttribute('aria-label'), btn('pct').textContent], [true, 'Modulation cables arrive in a later stage', '100%']);
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
