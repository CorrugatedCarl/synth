// gesture.js — the two-finger layer (lead ruling G1; ipad-designs/two-finger.critique.md §4–5) on the fake DOM of
// tests/wk-dom.mjs with the real wk.js widgets, roll.js and arrange.js: pairing (time rule with its distance cap, the late
// rule with its age / distance / edge limits, music and perf), the owner's rollback (the flagged pointercancel, claim(),
// range inputs), swallowing, click suppression and its grace, the session's lifecycle (stale sessions, watchdog, hidden
// page, regrip, spent fingers), routing (own canvases, the script's pan to the nearest scroller, WebKit 181954's spoilt
// moves, native mode wherever the browser pans by itself: left to the browser, swallowed only; ruling Z1), passive
// move / lift / touch listeners (nothing of the browser's scroll, pinch or taps waits for the layer), physical pairing
// distances under the browser's pinch-zoom (visualViewport), freed touches (a long-press menu / hold chooser),
// GestureEvents, destroy. The prototype's
// checks (ipad-inv/two-finger/check.mjs, 19) and the critique's cases A–I (skeptic.mjs) are here as assertions.
// Run: node --max-old-space-size=2048 --test tests/gesture.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as dom from './wk-dom.mjs';
import * as G from '../gesture.js?v=10';
import * as wk from '../wk.js?v=10';
import * as S from '../song.js?v=10';
import { PianoRoll } from '../roll.js?v=10';
import { Arrangement } from '../arrange.js?v=10';

const { Ev, ptr, fire, place } = dom;
// never hand a fake-DOM node to assert (its AssertionError walks the cyclic tree: tens of GB): primitives, or JSON
const safe = v => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
const eq = (a, b, m) => assert.equal(safe(a), safe(b), m);
const ok = (v, m) => assert.ok(!!v, m);

// a fake clock and timers (the watchdog, the regrip window)
let T = 0;
const timers = [];
const setT = (f, ms) => { timers.push({ f, at: T + ms, live: true }); return timers.length; };
const clearT = id => { if (timers[id - 1]) timers[id - 1].live = false; };
const tick = to => { T = to; for (let i = 0; i < timers.length; i++) { const x = timers[i]; if (x.live && x.at <= T) { x.live = false; x.f(); } } };

// the window's rAF queue (gesture.js tracks the fingers once a frame): flushed after each touch event unless a test
// holds it — WebKit's one pointermove per finger of a touch event, then frame()
const rafQ = [];
let rafId = 0, holdF = false;
const frame = () => { for (const x of rafQ.splice(0)) x.f(T); };
function setup(o = {}) {
  const d = dom.fresh(), win = d.defaultView, pans = [];
  win.document = d;
  T = 0; timers.length = 0; rafQ.length = 0; holdF = false;
  win.requestAnimationFrame = f => { rafQ.push({ f, id: ++rafId }); return rafId; };
  win.cancelAnimationFrame = id => { const k = rafQ.findIndex(x => x.id === id); if (k >= 0) rafQ.splice(k, 1); };
  // the used touch-action / overflow of the fake nodes: n._ta (default auto: native), n._ox / n._oy (scrollers)
  win.getComputedStyle = n => ({ touchAction: n._ta || 'auto', overflowX: n._ox || 'visible', overflowY: n._oy || 'visible' });
  const g = G.installGestures(win, Object.assign({ now: () => T, event: (t, i) => new Ev(t, i), pan: (dx, dy) => pans.push([dx, dy]),
    setTimeout: setT, clearTimeout: clearT }, o));
  const div = (tag = 'div', parent = d.body) => { const e = d.createElement(tag); parent.append(e); return e; };
  const zone = kind => { const e = div(); e.setAttribute('data-gesture', kind); return e; };
  return { d, win, g, pans, div, zone };
}
const touch = (el, type, x, y, id, extra = {}) => {
  const e = ptr(el, type, x, y, Object.assign({ pointerType: 'touch', pointerId: id, isPrimary: id === 1 }, extra));
  if (!holdF) frame();
  return e;
};
const counter = (el, type) => { const c = { n: 0 }; el.addEventListener(type, () => c.n++); return c; };

/* ------------------------------------------------------------------ the shared 181954 filter */
test('jumpy (WebKit 181954, shared with wk.js dragSource): more than 48 px within 250 ms of a script scroll of the page; never without one', () => {
  const last = { x: 100, y: 100 };
  eq([G.jumpy(last, 100, 149, 1100, 1000), G.jumpy(last, 100, 148, 1100, 1000)], [true, false], '48 px is fine');
  eq([G.jumpy(last, 100, 400, 1249, 1000), G.jumpy(last, 100, 400, 1250, 1000)], [true, false], '250 ms');
  eq(G.jumpy(last, 100, 400, 1100, null), false, 'no script scroll');
  eq([G.JUMP_PX, G.JUMP_MS], [48, 250]);
});

/* ------------------------------------------------------------------ the prototype's checks (check.mjs, 19) */
test('check 1: a wk knob turned by the first finger, a second finger 80 ms later elsewhere → nav: the 2nd pointerdown is swallowed, the knob rolls back and sees no more moves', () => {
  const { d, div } = setup();
  let v = 0.5; const log = [];
  const k = wk.knob({ label: 'CUT', get: () => v, set: (n, ph) => { v = n; log.push(ph + ':' + n.toFixed(3)); } });
  d.body.append(k.el); place(k.el, 100, 100, 40, 60);
  k.el._ta = 'none'; // (.wk-knob: the script's pan)
  const other = div();
  touch(k.el, 'pointerdown', 120, 130, 1);
  T = 40; touch(k.el, 'pointermove', 120, 110, 1);
  ok(v > 0.5, 'the knob turned');
  T = 80; const e2 = touch(other, 'pointerdown', 300, 130, 2);
  T = 100; touch(k.el, 'pointermove', 120, 60, 1);
  ok(e2.defaultPrevented && e2._imm, '2nd pointerdown swallowed');
  eq(v, 0.5, 'rolled back; later moves of the first finger never reach it');
  eq(log.at(-1), 'end:0.500', log.join(' '));
});

test('check 2: a two-finger tap on a wk.toggle — WebKit\'s metaKey click at the midpoint is swallowed; a later click works', () => {
  const { g, d } = setup();
  let on = 0;
  const t = wk.toggle({ label: 'ON', get: () => on, set: n => { on = n; } });
  d.body.append(t.el);
  touch(t.el, 'pointerdown', 10, 10, 1);
  T = 30; touch(t.el, 'pointerdown', 40, 10, 2);
  T = 120; touch(t.el, 'pointerup', 10, 10, 1); touch(t.el, 'pointerup', 40, 10, 2);
  T = 130; const c = fire(t.el, 'click', { metaKey: true, detail: 1 });
  ok(c._imm && on === 0, 'swallowed, not flipped ' + JSON.stringify(g.state()));
  T = 600; fire(t.el, 'click', { detail: 1 });
  eq(on, 1, 'a later click works');
});

test('check 3–4: a chord on [data-gesture=music] passes; a pan whose second finger lands on the keys never plays it and pans', () => {
  {
    const { zone, div } = setup();
    const keys = zone('music'), k1 = div('div', keys), k2 = div('div', keys);
    const got = []; keys.addEventListener('pointerdown', e => got.push(e.pointerId));
    touch(k1, 'pointerdown', 10, 300, 1); T = 20; touch(k2, 'pointerdown', 40, 300, 2);
    eq(got.join(), '1,2', 'chord');
  }
  {
    const { zone, div, pans } = setup();
    const keys = zone('music'), btn = div('button');
    keys._ta = 'none'; // (.keys: a finger on them → the script's pan)
    const got = []; keys.addEventListener('pointerdown', e => got.push(e.pointerId));
    touch(btn, 'pointerdown', 100, 250, 1); T = 60; touch(keys, 'pointerdown', 140, 300, 2);
    T = 80; touch(btn, 'pointermove', 100, 200, 1); touch(keys, 'pointermove', 140, 250, 2);
    eq(got.length, 0, 'the key never sees its pointerdown');
    ok(pans.length > 0, 'page scroll requested ' + JSON.stringify(pans));
  }
});

test('check 5: both fingers on one own canvas — every event reaches it (its own pinch); clicks suppressed after', () => {
  const { g, d } = setup();
  const cv = d.createElement('canvas'); cv.setAttribute('data-gesture', 'own'); d.body.append(cv);
  const got = []; for (const t of ['pointerdown', 'pointermove', 'pointerup']) cv.addEventListener(t, e => got.push(t[7] + e.pointerId));
  touch(cv, 'pointerdown', 10, 10, 1); T = 30; touch(cv, 'pointerdown', 60, 10, 2);
  eq(g.state().session, 'own');
  touch(cv, 'pointermove', 0, 10, 1); touch(cv, 'pointerup', 0, 10, 1); touch(cv, 'pointerup', 60, 10, 2);
  eq(got.join(), 'd1,d2,m1,u1,u2');
  ok(g.busy(), 'grace');
});

test('check 6: a native range input the first finger moved gets its value back (input + change)', () => {
  const { div } = setup();
  const r = div('input'); r.type = 'range'; r.value = '0.5';
  const seen = []; r.addEventListener('input', () => seen.push('input:' + r.value)); r.addEventListener('change', () => seen.push('change:' + r.value));
  touch(r, 'pointerdown', 10, 10, 1);
  r.value = '0.7'; // the thumb followed the finger
  T = 50; touch(globalThis.document.body, 'pointerdown', 60, 10, 2);
  eq([r.value, seen.join()], ['0.5', 'input:0.5,change:0.5']);
});

test('check 7: two hands — a knob dragged 600 ms, then a finger elsewhere: independent, the knob keeps turning', () => {
  const { g, d, div } = setup();
  let v = 0.5;
  const k = wk.knob({ label: 'RES', get: () => v, set: n => { v = n; } });
  d.body.append(k.el);
  const b = div(), bdown = counter(b, 'pointerdown');
  touch(k.el, 'pointerdown', 120, 130, 1); T = 100; touch(k.el, 'pointermove', 120, 100, 1);
  T = 600; touch(b, 'pointerdown', 700, 400, 2);
  T = 620; touch(k.el, 'pointermove', 120, 80, 1);
  eq([bdown.n, g.state().session], [1, null]);
  ok(v > 0.6, 'v=' + v.toFixed(3));
});

test('check 9: a long-press armed by the first finger never opens its menu (the synthetic cancel clears it)', () => {
  const { d } = setup();
  const t = wk.toggle({ label: 'X', get: () => 0, set: () => {} });
  d.body.append(t.el);
  const menus = counter(t.el, 'contextmenu');
  const realST = globalThis.setTimeout, realCT = globalThis.clearTimeout, lp = [];
  globalThis.setTimeout = (f, ms) => { lp.push({ f, ms, live: true }); return lp.length; };
  globalThis.clearTimeout = id => { if (lp[id - 1]) lp[id - 1].live = false; };
  try {
    touch(t.el, 'pointerdown', 10, 10, 1);
    T = 50; touch(d.body, 'pointerdown', 200, 10, 2);
    for (const x of lp) if (x.live) x.f();
  } finally { globalThis.setTimeout = realST; globalThis.clearTimeout = realCT; }
  eq(menus.n, 0, 'timers ' + lp.map(x => x.ms + (x.live ? '+' : '-')).join(','));
});

test('check 10: native where the browser pans by itself (every touch\'s touch-action allows panning: auto, manipulation, pan-x / pan-y, pan-y pinch-zoom — as before the layer): no script pan; a finger on touch-action none (or pinch-zoom alone) → the browser pans and zooms nothing, the script pans; touchmove never prevented', () => {
  for (const [ta, native] of [['auto', true], ['manipulation', true], ['pan-y pinch-zoom', true], ['pan-x', true], ['pan-y', true], ['none', false], ['pinch-zoom', false]]) {
    const { div, pans, g } = setup();
    const a = div(), b = div(); a._ta = ta;
    touch(a, 'pointerdown', 100, 100, 1); T = 30; touch(b, 'pointerdown', 160, 100, 2, { isPrimary: false });
    const tm = fire(a, 'touchmove'); touch(a, 'pointermove', 100, 60, 1);
    eq([g.state().native, tm.defaultPrevented, pans.length > 0], [native, false, !native], ta + ' + auto ' + JSON.stringify(pans));
  }
});

test('check 11–12: a still knob finger held 1 s, then a key: it sounds; a fresh tap 60 ms after a pinch works (its touchend not prevented)', () => {
  {
    const { d, zone } = setup();
    const keys = zone('music'), notes = counter(keys, 'pointerdown');
    const k = wk.knob({ label: 'A', get: () => 0.5, set: () => {} }); d.body.append(k.el);
    touch(k.el, 'pointerdown', 100, 100, 1); T = 1000; touch(keys, 'pointerdown', 200, 300, 2);
    eq(notes.n, 1);
  }
  {
    const { d, div } = setup();
    let on = 0;
    const t = wk.toggle({ label: 'Y', get: () => on, set: n => { on = n; } }); d.body.append(t.el);
    const a = div();
    touch(a, 'pointerdown', 10, 10, 1); T = 20; touch(a, 'pointerdown', 90, 10, 2); T = 200; touch(a, 'pointerup', 10, 10, 1); touch(a, 'pointerup', 90, 10, 2);
    T = 260; touch(t.el, 'pointerdown', 5, 5, 3, { isPrimary: true }); touch(t.el, 'pointerup', 5, 5, 3, { isPrimary: true });
    const te = fire(t.el, 'touchend'); fire(t.el, 'click', { detail: 1 });
    ok(on === 1 && !te.defaultPrevented);
  }
});

/* ------------------------------------------------------------------ the critique's cases (skeptic.mjs A–I) */
test('A: a held note does not defeat "always" — a two-finger pan elsewhere is a session, its second finger reaches nothing, the page pans; the note lifts normally', () => {
  const { g, zone, div, pans } = setup();
  const keys = zone('music'), a = div(), b = div('button');
  keys._ta = 'none'; // the held key: WebKit would not pinch while it is down → the script pans
  const bdown = counter(b, 'pointerdown'), kup = counter(keys, 'pointerup');
  touch(keys, 'pointerdown', 100, 700, 1);
  T = 2000; touch(a, 'pointerdown', 300, 200, 2, { isPrimary: false });
  T = 2030; touch(b, 'pointerdown', 380, 200, 3, { isPrimary: false });
  T = 2060; touch(a, 'pointermove', 300, 150, 2); touch(b, 'pointermove', 380, 150, 3);
  eq([g.state().session, g.state().native, bdown.n], ['nav', false, 0]);
  ok(pans.length > 0, 'pans');
  touch(keys, 'pointerup', 100, 700, 1);
  eq(kup.n, 1, 'the note\'s finger is not the session\'s');
});

test('B: octave (perf) then a key 120 ms later — both work; the grip (perf) then a key too', () => {
  const { g, zone, div } = setup();
  const perf = zone('perf'), keys = zone('music'), oct = div('button', perf), grip = div('div', perf);
  const notes = counter(keys, 'pointerdown'), clicks = counter(oct, 'click'), gd = counter(grip, 'pointerdown');
  touch(oct, 'pointerdown', 40, 640, 1);
  T = 120; touch(keys, 'pointerdown', 400, 720, 2, { isPrimary: false });
  T = 160; touch(oct, 'pointerup', 40, 640, 1); fire(oct, 'click', { detail: 1 });
  T = 400; touch(keys, 'pointerup', 400, 720, 2);
  eq([notes.n, clicks.n, g.state().session], [1, 1, null]);
  T = 1000; touch(grip, 'pointerdown', 300, 600, 3, { isPrimary: true });
  T = 1050; touch(keys, 'pointerdown', 320, 700, 4, { isPrimary: false });
  eq([gd.n, notes.n, g.state().session], [1, 2, null]);
});

test('C: a session whose pointerup never comes cannot lock the page — the next primary tap ends it and works', () => {
  const { g, div } = setup();
  const a = div(), btn = div('button'), downs = counter(btn, 'pointerdown'), clicks = counter(btn, 'click');
  touch(a, 'pointerdown', 100, 100, 1); T = 30; touch(a, 'pointerdown', 160, 100, 2, { isPrimary: false });
  T = 200; touch(a, 'pointerup', 100, 100, 1); // finger 2's pointerup / pointercancel never arrives
  eq(g.state().session, 'nav', 'still waiting (regrip)');
  T = 5000; touch(btn, 'pointerdown', 10, 10, 7, { isPrimary: true }); touch(btn, 'pointerup', 10, 10, 7, { isPrimary: true }); fire(btn, 'click', { detail: 1 });
  T = 60000; touch(btn, 'pointerdown', 10, 10, 8, { isPrimary: true }); touch(btn, 'pointerup', 10, 10, 8, { isPrimary: true }); fire(btn, 'click', { detail: 1 });
  eq([downs.n, clicks.n, g.state().session, g.state().touches], [2, 2, null, 0]);
});

test('D: an Apple Pencil (or mouse / trackpad) tap 150 ms after a pinch is not swallowed: any pointerdown outside a session ends the grace', () => {
  for (const type of ['pen', 'mouse']) {
    const { div, g } = setup();
    const a = div(), btn = div('button'), clicks = counter(btn, 'click');
    touch(a, 'pointerdown', 100, 100, 1); T = 30; touch(a, 'pointerdown', 160, 100, 2, { isPrimary: false });
    T = 300; touch(a, 'pointerup', 100, 100, 1); touch(a, 'pointerup', 160, 100, 2);
    ok(g.busy(), type + ': grace');
    T = 450; ptr(btn, 'pointerdown', 10, 10, { pointerType: type, pointerId: 50, isPrimary: true }); ptr(btn, 'pointerup', 10, 10, { pointerType: type, pointerId: 50, isPrimary: true });
    const c = fire(btn, 'click', { detail: 1 });
    eq([clicks.n, c._imm], [1, false], type);
  }
});

test('E: a resting thumb — 5 s still, or at a window edge — never pairs with a tap 300 px away', () => {
  for (const [x, at] of [[10, 5000], [10, 800], [1270, 800]]) {
    const { div, g } = setup();
    const panel = div(), btn = div('button'), downs = counter(btn, 'pointerdown'), clicks = counter(btn, 'click');
    touch(panel, 'pointerdown', x, 500, 1);
    T = at; touch(btn, 'pointerdown', x < 640 ? x + 300 : x - 300, 400, 2, { isPrimary: false }); T = at + 80; touch(btn, 'pointerup', 300, 400, 2); fire(btn, 'click', { detail: 1 });
    eq([downs.n, clicks.n, g.state().session], [1, 1, null], x + ' px, ' + at + ' ms');
  }
});

test('F: two hands at once far apart (Play, then a knob 100 ms later 900 px away) — independent', () => {
  const { g, div } = setup();
  const play = div('button'), knob = div(), kd = counter(knob, 'pointerdown');
  touch(play, 'pointerdown', 50, 100, 1); T = 100; touch(knob, 'pointerdown', 950, 300, 2, { isPrimary: false });
  eq([g.state().session, kd.n], [null, 1]);
});

test('G: a range input under a finger stays native (the browser pinches there, as it always did) — its value goes back at pairing, at the browser\'s plain pointercancel, when the last touch ends (a thumb that followed the browser\'s gesture), at a joined finger\'s lift and a spent finger\'s', () => {
  {
    const { div, g } = setup();
    const r = div('input'); r.type = 'range'; r.value = '0.5'; const a = div();
    touch(r, 'pointerdown', 10, 10, 1);
    r.value = '0.6'; // the thumb followed the first finger
    T = 40; const e2 = touch(a, 'pointerdown', 80, 10, 2, { isPrimary: false });
    eq([g.state().native, fire(r, 'touchmove').defaultPrevented, e2.defaultPrevented, e2._imm, r.value], [true, false, false, true, '0.5'], 'native; back at pairing');
    r.value = '0.7'; // the browser's gesture: the thumb goes on following finger 1
    T = 60; touch(r, 'pointercancel', 30, 10, 1); // the browser takes the touches
    eq(r.value, '0.5', 'back at the browser\'s pointercancel');
    T = 70; touch(a, 'pointercancel', 90, 10, 2);
    eq([g.state().session, g.state().late], [null, 1]);
    r.value = '0.8'; // its touchmove default handling still moves it while the pinch goes on
    T = 900; const te = fire(r, 'touchend', { touches: [] });
    eq([r.value, g.state().late, te.defaultPrevented], ['0.5', 0, false], 'back when the last touch ends');
  }
  {
    const { div, g } = setup();
    const r = div('input'); r.type = 'range'; r.value = '0.5'; const a = div();
    touch(a, 'pointerdown', 10, 10, 1); T = 40; touch(r, 'pointerdown', 80, 10, 2, { isPrimary: false }); // the 2nd finger on it
    eq([g.state().native, g.state().late], [true, 1]);
    r.value = '0.9';
    fire(r, 'touchend', { touches: [{}] });
    eq(r.value, '0.9', 'a touch still down: not yet');
    T = 100; touch(r, 'pointerup', 80, 10, 2);
    eq(r.value, '0.5', 'back at its lift');
  }
  {
    const { div, g } = setup();
    const r = div('input'); r.type = 'range'; r.value = '0.5'; const a = div();
    touch(r, 'pointerdown', 10, 10, 1); T = 30; touch(a, 'pointerdown', 80, 10, 2, { isPrimary: false });
    T = 100; touch(a, 'pointerup', 80, 10, 2);
    tick(600);
    eq([g.state().session, g.state().spent], [null, 1]);
    r.value = '0.3';
    const m = touch(r, 'pointermove', 12, 10, 1), u = touch(r, 'pointerup', 10, 10, 1);
    eq([r.value, m._imm, m.defaultPrevented, u._imm, u.defaultPrevented], ['0.5', true, false, true, false], 'back at the spent finger\'s lift (a native session\'s: swallowed only)');
  }
  {
    const { div, g } = setup(); // a missed touchend: the next primary touch puts it back
    const r = div('input'); r.type = 'range'; r.value = '0.5'; const a = div(), b = div();
    touch(r, 'pointerdown', 10, 10, 1); T = 30; touch(a, 'pointerdown', 80, 10, 2, { isPrimary: false });
    touch(r, 'pointercancel', 10, 10, 1); touch(a, 'pointercancel', 80, 10, 2);
    r.value = '0.2';
    T = 2000; touch(b, 'pointerdown', 300, 300, 5, { isPrimary: true });
    eq([r.value, g.state().late], ['0.5', 0]);
  }
});

test('H: gesturestart with no touch down (a Mac trackpad\'s pinch) is never prevented', () => {
  const { d } = setup();
  eq(fire(d.body, 'gesturestart', { scale: 1 }).defaultPrevented, false);
});

test('I (the accepted trade-off): two step taps overlapping 120 ms apart are a two-finger gesture — neither presses', () => {
  const { div } = setup();
  const s1 = div('button'), s2 = div('button'), c1 = counter(s1, 'click'), c2 = counter(s2, 'click');
  touch(s1, 'pointerdown', 100, 300, 1); T = 120; touch(s2, 'pointerdown', 160, 300, 2, { isPrimary: false });
  T = 150; touch(s1, 'pointerup', 100, 300, 1); fire(s1, 'click', { detail: 1 });
  T = 230; touch(s2, 'pointerup', 160, 300, 2); fire(s2, 'click', { detail: 1 });
  eq([c1.n, c2.n], [0, 0]);
});

/* ------------------------------------------------------------------ pairing rules */
test('pairing: the late rule — a still first finger (≤ 10 px) pairs with a second ≤ 360 px away up to 1.2 s; farther, later or moved: independent', () => {
  for (const [dx, at, moved, want] of [[200, 800, 0, 'nav'], [500, 800, 0, null], [200, 1500, 0, null], [200, 800, 15, null], [200, 200, 15, 'nav']]) {
    const { g, div } = setup();
    const a = div(), b = div();
    touch(a, 'pointerdown', 400, 400, 1);
    if (moved) { T = 100; touch(a, 'pointermove', 400 + moved, 400, 1); }
    T = at; touch(b, 'pointerdown', 400 + dx, 400, 2, { isPrimary: false });
    eq(g.state().session, want, [dx, at, moved].join(' / '));
  }
});

test('pairing: three fingers — the third joins the nav session (swallowed); in an own session a finger off its element is independent', () => {
  {
    const { g, div } = setup();
    const a = div(), c = div('button'), cd = counter(c, 'pointerdown');
    touch(a, 'pointerdown', 100, 100, 1); T = 30; touch(a, 'pointerdown', 200, 100, 2, { isPrimary: false });
    T = 60; const e3 = touch(c, 'pointerdown', 300, 100, 3, { isPrimary: false });
    eq([g.state().fingers, cd.n, e3._imm], [3, 0, true]);
  }
  {
    const { g, d, div } = setup();
    const cv = d.createElement('canvas'); cv.setAttribute('data-gesture', 'own'); d.body.append(cv);
    const btn = div('button'), bd = counter(btn, 'pointerdown'), cd = counter(cv, 'pointerdown');
    touch(cv, 'pointerdown', 10, 10, 1); T = 30; touch(cv, 'pointerdown', 60, 10, 2, { isPrimary: false });
    T = 60; touch(btn, 'pointerdown', 100, 10, 3, { isPrimary: false });
    T = 90; touch(cv, 'pointerdown', 30, 30, 4, { isPrimary: false });
    eq([g.state().session, g.state().fingers, bd.n, cd.n], ['own', 3, 1, 3]);
  }
});

test('rollback: claim() callbacks run before the synthetic pointercancel (flagged, bubbling, at the touched element); an unclaimed one does not', () => {
  const { g, div } = setup();
  const w = div(), inner = div('span', w), b = div(), log = [];
  w.addEventListener('pointercancel', e => log.push('cancel ' + e.gesture + ' ' + e.pointerId + ' ' + e.pointerType + ' ' + (e.target === inner)));
  touch(inner, 'pointerdown', 100, 100, 1);
  g.claim(1, { cancel: () => log.push('claim A') });
  const off = g.claim(1, { cancel: () => log.push('claim B') });
  off();
  T = 50; touch(b, 'pointerdown', 200, 100, 2, { isPrimary: false });
  eq(log.join(' | '), 'claim A | cancel two-finger 1 touch true');
});

/* ------------------------------------------------------------------ swallowing and suppression */
test('swallowing: a nav session\'s moves, ups, pointerover / -enter are swallowed; pointerout / -leave pass (hover tips hide); a plain pointercancel of a session finger too', () => {
  const { div } = setup();
  const a = div(), b = div(), seen = [];
  for (const t of ['pointermove', 'pointerup', 'pointerover', 'pointerenter', 'pointerout', 'pointerleave', 'pointercancel']) a.addEventListener(t, () => seen.push(t));
  touch(a, 'pointerdown', 100, 100, 1); T = 30; touch(b, 'pointerdown', 200, 100, 2, { isPrimary: false });
  seen.length = 0;
  for (const t of ['pointermove', 'pointerover', 'pointerenter', 'pointerout', 'pointerleave']) touch(a, t, 100, 90, 1);
  touch(a, 'pointercancel', 100, 90, 2);
  touch(a, 'pointerup', 100, 90, 1);
  eq(seen.join(), 'pointerout,pointerleave');
});

test('suppression: during a session and its grace clicks with detail ≥ 1, mousedown / -up and contextmenu are swallowed — a keyboard / VoiceOver click (detail 0) passes; touchend is never prevented (passive), a script session\'s neither', () => {
  const { div } = setup();
  const a = div(), btn = div('button'), inp = div('input'), clicks = counter(btn, 'click');
  a._ta = 'none'; // (a knob: the script's pan)
  touch(a, 'pointerdown', 100, 100, 1); T = 30; touch(a, 'pointerdown', 200, 100, 2, { isPrimary: false });
  fire(btn, 'click', { detail: 1 }); fire(btn, 'click', { detail: 0 }); btn.click();
  eq(clicks.n, 2, 'detail 0 passes');
  ok(fire(btn, 'mousedown', { detail: 1 })._imm && fire(btn, 'contextmenu')._imm, 'mousedown, contextmenu');
  eq([fire(btn, 'touchend').defaultPrevented, fire(inp, 'touchend').defaultPrevented], [false, false]);
  T = 100; touch(a, 'pointerup', 100, 100, 1); touch(a, 'pointerup', 200, 100, 2);
  T = 499; fire(btn, 'click', { detail: 1 });
  eq(clicks.n, 2, 'the grace');
  T = 501; fire(btn, 'click', { detail: 1 });
  eq(clicks.n, 3, 'after it');
});

test('suppression: touchend is never prevented, in a session or its grace (WebKit\'s two-finger double-tap resets the page\'s zoom) — a native or a script session\'s ⌘-click, mousedown and contextmenu still swallowed; a finger in a scroller that can scroll beside a knob finger: that scroller pans natively (no script pan: no double scroll), an overflow box that cannot scroll: the script pans', () => {
  {
    const { g, div } = setup();
    const a = div(), b = div('button'), clicks = counter(b, 'click');
    touch(a, 'pointerdown', 100, 100, 1); T = 30; touch(b, 'pointerdown', 180, 100, 2, { isPrimary: false });
    eq([g.state().session, g.state().native, fire(b, 'touchend', { touches: [{}] }).defaultPrevented], ['nav', true, false], 'during the session');
    T = 120; touch(a, 'pointerup', 100, 100, 1); touch(b, 'pointerup', 180, 100, 2);
    const te = fire(b, 'touchend', { touches: [] });
    T = 140; const c = fire(b, 'click', { metaKey: true, detail: 1 }), md = fire(b, 'mousedown', { detail: 1 }), cm = fire(b, 'contextmenu');
    eq([g.busy(), te.defaultPrevented, c._imm, md._imm, cm._imm, clicks.n], [true, false, true, true, true, 0], 'its grace: the two-finger tap\'s click swallowed');
    // another two-finger tap within the grace, one finger on a knob: a script session — its touchend not prevented
    // either, its click swallowed
    const k = div(); k._ta = 'none';
    T = 300; touch(k, 'pointerdown', 120, 100, 3, { isPrimary: false }); T = 320; touch(b, 'pointerdown', 190, 100, 4, { isPrimary: false });
    eq([g.state().native, fire(b, 'touchend', { touches: [{}] }).defaultPrevented], [false, false], 'script session');
    T = 360; touch(k, 'pointerup', 120, 100, 3); touch(b, 'pointerup', 190, 100, 4);
    const te2 = fire(b, 'touchend', { touches: [] }), c2 = fire(b, 'click', { metaKey: true, detail: 1 });
    eq([g.busy(), te2.defaultPrevented, c2._imm, clicks.n], [true, false, true, 0], 'its grace');
    T = 900;
    eq([g.busy(), fire(b, 'touchend', { touches: [] }).defaultPrevented], [false, false], 'after it');
  }
  for (const [scrolls, native] of [[true, true], [false, false]]) {
    const { g, div, pans } = setup();
    const k = div(), box = div(), row = div('div', box);
    k._ta = 'none'; box._oy = 'auto'; place(box, 300, 0, 400, 300); // the Serum matrix list: its own scroller
    box.scrollHeight = scrolls ? 1200 : 300;
    touch(k, 'pointerdown', 100, 100, 1); T = 30; touch(row, 'pointerdown', 400, 100, 2, { isPrimary: false });
    const tm = fire(row, 'touchmove'); T = 40; touch(row, 'pointermove', 400, 60, 2);
    eq([g.state().native, tm.defaultPrevented, pans.length > 0], [native, false, !native], scrolls ? 'a list that scrolls: no double scroll' : 'a box that cannot scroll');
  }
});

test('suppression: the grace ends with a pen, mouse or a non-primary touch pointerdown that is no session\'s', () => {
  for (const [type, primary] of [['pen', true], ['mouse', true], ['touch', false]]) {
    const { g, div, zone } = setup();
    const keys = zone('music'), a = div(), btn = div('button'), clicks = counter(btn, 'click');
    touch(keys, 'pointerdown', 50, 700, 9, { isPrimary: true }); // a held note: the next touches are not primary
    T = 1000; touch(a, 'pointerdown', 100, 100, 1, { isPrimary: false }); T = 1030; touch(a, 'pointerdown', 200, 100, 2, { isPrimary: false });
    T = 1100; touch(a, 'pointerup', 100, 100, 1); touch(a, 'pointerup', 200, 100, 2);
    ok(g.busy(), type + ': grace');
    T = 1150; ptr(btn, 'pointerdown', 800, 100, { pointerType: type, pointerId: 30, isPrimary: primary });
    fire(btn, 'click', { detail: 1 });
    eq([clicks.n, g.busy()], [1, false], type);
  }
});

/* ------------------------------------------------------------------ lifecycle */
test('lifecycle: regrip — a nav session down to one finger takes another within 400 ms and pans on from the new grip (no jump); after that the finger is spent: swallowed until it lifts, never paired', () => {
  const { g, div, pans } = setup();
  const a = div(), b = div(), b2 = div('button'), b2d = counter(b2, 'pointerdown');
  a._ta = 'none'; // the first finger on a knob: the script's pan
  touch(a, 'pointerdown', 400, 300, 1); T = 30; touch(b, 'pointerdown', 500, 300, 2, { isPrimary: false });
  T = 60; touch(b, 'pointermove', 500, 280, 2); // the midpoint 10 px up
  eq([g.state().native, JSON.stringify(pans)], [false, '[[0,10]]']);
  T = 100; touch(b, 'pointerup', 500, 280, 2);
  eq([g.state().session, g.state().fingers], ['nav', 1], 'waiting');
  tick(300); const e3 = touch(b2, 'pointerdown', 600, 300, 3, { isPrimary: false });
  eq([b2d.n, e3._imm, e3.defaultPrevented, g.state().fingers], [0, true, true, 2], 'joined');
  T = 330; touch(b2, 'pointermove', 600, 260, 3); // the new grip's midpoint 20 px up (not measured from the old one)
  eq(JSON.stringify(pans), '[[0,10],[0,20]]');
  T = 360; touch(b2, 'pointerup', 600, 260, 3);
  tick(761);
  eq([g.state().session, g.state().spent], [null, 1], 'spent');
  const m = touch(a, 'pointermove', 380, 300, 1), u = touch(a, 'pointerup', 380, 300, 1);
  eq([m._imm, m.defaultPrevented, u._imm, u.defaultPrevented, g.state().touches], [true, false, true, false, 0], 'swallowed (never prevented: passive) until it lifts');
});

test('lifecycle: while one finger waits for a re-grip, a key (music) is the other hand\'s — it plays and does not join', () => {
  const { g, div, zone } = setup();
  const a = div(), b = div(), keys = zone('music'), notes = counter(keys, 'pointerdown');
  touch(a, 'pointerdown', 400, 300, 1); T = 30; touch(b, 'pointerdown', 500, 300, 2, { isPrimary: false });
  T = 100; touch(b, 'pointerup', 500, 300, 2);
  T = 200; touch(keys, 'pointerdown', 450, 700, 3, { isPrimary: false });
  eq([notes.n, g.state().fingers], [1, 1]);
  T = 300; const c = div('button'), e4 = touch(c, 'pointerdown', 500, 300, 4, { isPrimary: false });
  eq([e4._imm, g.state().fingers], [true, 2], 'any other finger re-grips');
});

test('lifecycle: a spent finger never pairs and does not keep the clicks suppressed', () => {
  const { g, div } = setup();
  const a = div(), b = div(), c = div('button'), cd = counter(c, 'pointerdown'), clicks = counter(c, 'click');
  touch(a, 'pointerdown', 400, 300, 1); T = 30; touch(b, 'pointerdown', 500, 300, 2, { isPrimary: false });
  T = 100; touch(b, 'pointerup', 500, 300, 2); tick(600);
  T = 700; touch(c, 'pointerdown', 450, 300, 3, { isPrimary: false }); fire(c, 'click', { detail: 1 });
  eq([cd.n, clicks.n, g.state().session, g.state().spent], [1, 1, null, 1]);
});

test('lifecycle: the watchdog ends a session after 3 s without an event from its fingers (spent); a hidden page, pagehide and the window\'s blur end it at once (spent), a control\'s blur does not', () => {
  {
    const { g, div } = setup();
    const a = div(), b = div();
    touch(a, 'pointerdown', 100, 100, 1); T = 30; touch(b, 'pointerdown', 200, 100, 2, { isPrimary: false });
    T = 2000; touch(a, 'pointermove', 100, 102, 1);
    tick(3030); eq(g.state().session, 'nav', 'an event 1 s ago');
    tick(5000); eq([g.state().session, g.state().spent], [null, 2], 'idle 3 s');
  }
  for (const how of ['hidden', 'pagehide', 'blur', 'control-blur']) {
    const { g, d, win, div } = setup();
    const a = div(), b = div();
    touch(a, 'pointerdown', 400, 300, 1); T = 30; touch(b, 'pointerdown', 500, 300, 2, { isPrimary: false });
    T = 60; touch(b, 'pointermove', 560, 300, 2);
    eq(g.state().session, 'nav', how + ': a session');
    if (how === 'hidden') { d.visibilityState = 'hidden'; fire(d, 'visibilitychange'); }
    else if (how === 'control-blur') a.dispatchEvent(new Ev('blur'));
    else win.dispatchEvent(new Ev(how));
    if (how === 'control-blur') eq(g.state().session, 'nav', how);
    else eq([g.state().session, g.state().spent], [null, 2], how);
  }
});

/* ------------------------------------------------------------------ routing */
test('routing: the script\'s pan scrolls the nearest scroller under the midpoint that can still go that way, the rest the page (clamped, whole px); WebKit 181954: a far move just after the page scrolled is dropped, never two in a row', () => {
  const { d, win, div, g } = setup({ pan: undefined });
  const box = div(), inner = div('div', box);
  box._oy = 'auto'; place(box, 0, 0, 400, 300); box.scrollHeight = 1000; box.scrollTop = 690;
  inner._ta = 'none'; // (the script's pan)
  d.elementFromPoint = () => inner;
  const root = d.documentElement; place(root, 0, 0, 1280, 800); root.scrollHeight = 3000;
  win.scrollX = 0; win.scrollY = 100; win.scrollBy = (x, y) => { win.scrollX += x; win.scrollY += y; };
  touch(inner, 'pointerdown', 100, 200, 1); T = 30; touch(inner, 'pointerdown', 200, 200, 2, { isPrimary: false });
  T = 40; touch(inner, 'pointermove', 100, 180, 1); // midpoint 10 px up: past the 8 px
  eq([box.scrollTop, win.scrollY], [700, 100], 'the scroller first, to its end');
  T = 50; touch(inner, 'pointermove', 200, 180, 2); // 10 more
  eq([box.scrollTop, win.scrollY], [700, 110], 'then the page');
  T = 60; touch(inner, 'pointermove', 100, 500, 1); // a spoilt move (320 px) 10 ms after the page scrolled
  eq(win.scrollY, 110, 'dropped');
  T = 70; touch(inner, 'pointermove', 100, 170, 1);
  eq(win.scrollY, 115, 'the next good one');
  T = 80; touch(inner, 'pointermove', 100, 400, 1); T = 90; touch(inner, 'pointermove', 100, 420, 1);
  eq([box.scrollTop, win.scrollY], [575, 115], 'never two in a row (a real fast move, 125 px down): the scroller first again');
  T = 100; touch(inner, 'pointermove', 200, 100000, 2); T = 110; touch(inner, 'pointermove', 200, 100000, 2);
  eq([box.scrollTop, win.scrollY], [0, 0], 'clamped at the top');
  eq([g.state().session, g.state().native], ['nav', false]);
});

test('routing: native mode — the used touch-action stops at a scroll container (WebKit resets it there)', () => {
  for (const [scrolls, want] of [[true, true], [false, false]]) {
    const { div, g } = setup();
    const outer = div(), sc = div('div', outer), a = div('div', sc), b = div();
    outer._ta = 'none'; if (scrolls) sc._oy = 'auto';
    touch(a, 'pointerdown', 100, 100, 1); T = 30; touch(b, 'pointerdown', 200, 100, 2, { isPrimary: false });
    eq(g.state().native, want, scrolls ? 'inside a scroller' : 'under touch-action none');
  }
});

/* ------------------------------------------------------------------ GestureEvents (critique H, J) */
test('GestureEvents: not passed on during a nav session, passed in an own session; never preventDefault-ed (the page\'s pinch is the browser\'s)', () => {
  const run = own => {
    const { d, div, g } = setup();
    const cv = d.createElement('canvas'); if (own) cv.setAttribute('data-gesture', 'own'); d.body.append(cv);
    const b = own ? cv : div(), seen = counter(cv, 'gesturechange');
    touch(cv, 'pointerdown', 100, 100, 1); T = 30; touch(b, 'pointerdown', 200, 100, 2, { isPrimary: false });
    const e = fire(cv, 'gesturechange', { scale: 2 });
    const r = [g.state().session, seen.n, e.defaultPrevented];
    touch(cv, 'pointerup', 100, 100, 1); touch(b, 'pointerup', 200, 100, 2);
    const e2 = fire(cv, 'gesturechange', { scale: 2 });
    return r.concat([seen.n, e2.defaultPrevented]);
  };
  eq(run(false), ['nav', 0, false, 1, false], 'nav');
  eq(run(true), ['own', 1, false, 2, false], 'own');
});

test('GestureEvents with the real piano roll and arrangement (critique J): a nav session that started on them never zooms them; a trackpad pinch (no touch) still does', () => {
  const doc = dom.fresh(), win = doc.defaultView;
  win.document = doc; win.GestureEvent = function GestureEvent() {};
  globalThis.window = win;
  dom.raf.install();
  try {
    T = 0; timers.length = 0;
    const g = G.installGestures(win, { now: () => T, event: (t, i) => new Ev(t, i), pan: () => {}, setTimeout: setT, clearTimeout: clearT });
    const p = S.newProject({ model: 'x', name: 't' });
    const wrap = doc.createElement('div'); wrap.setAttribute('data-gesture', 'own'); doc.body.appendChild(wrap); place(wrap, 0, 0, 900, 400);
    const log = [];
    const roll = new PianoRoll(wrap, { getProject: () => p, getTrack: () => p.tracks[0], edit: (l, fn) => fn(), beginEdit: () => log.push('begin'), endEdit: () => log.push('end'),
      changed: () => {}, audition: () => {}, auditionOff: () => {}, getPlayhead: () => 0, setPlayhead: () => {}, setLoop: () => {}, getSnap: () => p.snap, onSelect: () => {},
      touch: true, onRows: () => {} });
    place(roll.el, 0, 0, 900, 400);
    const box = doc.createElement('div'); doc.body.appendChild(box); place(box, 0, 400, 900, 200);
    const arr = new Arrangement(box, { getProject: () => p, getPlayhead: () => 0, setPlayhead: () => {}, setLoop: () => {}, getRange: () => null, setRange: () => {},
      selectTrack: () => {}, openTrack: () => {}, rowHeight: 56 });
    place(arr.el, 0, 400, 900, 136);
    dom.raf.flush(2);
    const other = doc.createElement('div'); doc.body.appendChild(other);
    let id = 0;
    for (const [name, el, x, y] of [['roll', roll.el, 300, 250], ['arrangement', arr.el, 300, 450]]) {
      const ppt = el === roll.el ? () => roll.ppt : () => arr.ppt, z0 = ppt();
      T += 1000;
      touch(el, 'pointerdown', x, y, ++id, { isPrimary: true }); T += 40;
      touch(other, 'pointerdown', x + 200, y, ++id, { isPrimary: false });
      eq(g.state().session, 'nav', name);
      for (const t of ['gesturestart', 'gesturechange']) fire(el, t, { scale: t === 'gesturestart' ? 1 : 2, clientX: x + 100, clientY: y });
      eq(ppt(), z0, name + ': not zoomed by the nav session\'s GestureEvents');
      touch(el, 'pointerup', x, y, id - 1); touch(other, 'pointerup', x + 200, y, id);
      fire(el, 'gestureend', { scale: 2 });
      T += 1000;
      fire(el, 'gesturestart', { scale: 1 }); fire(el, 'gesturechange', { scale: 1.5, clientX: x, clientY: y }); fire(el, 'gestureend', { scale: 1.5 });
      ok(ppt() !== z0, name + ': a trackpad pinch zooms ' + ppt() / z0);
    }
    roll.destroy(); arr.destroy(); g.destroy();
  } finally { dom.raf.uninstall(); delete globalThis.window; }
});

/* ------------------------------------------------------------------ review fixes (build 1) */
// a strip that scrolls sideways (overflow-x auto) under both fingers (on touch-action none: the script's pan), and a
// page; real panBy (no opts.pan)
function stripRig() {
  const r = setup({ pan: undefined });
  const { d, win, div } = r;
  const box = div(), inner = div('div', box);
  box._ox = 'auto'; box._oy = 'auto'; place(box, 0, 0, 800, 300);
  box.scrollWidth = 3000; box.scrollLeft = 1000; box.scrollHeight = 1000; box.scrollTop = 500;
  inner._ta = 'none';
  d.elementFromPoint = () => inner;
  const root = d.documentElement; place(root, 0, 0, 1280, 800); root.scrollWidth = 1280; root.scrollHeight = 3000;
  win.scrollX = 0; win.scrollY = 100; win.scrollBy = (x, y) => { win.scrollX += x; win.scrollY += y; };
  return Object.assign(r, { box, inner });
}

test('once a frame: a sideways two-finger swipe (fingers side by side, WebKit\'s one pointermove per finger) scrolls the strip by the midpoint\'s travel; a staggered lift (the last move and the other finger\'s pointerup in one touch event) scrolls the last step', () => {
  const { g, box, inner } = stripRig();
  touch(inner, 'pointerdown', 400, 200, 1); T = 30; touch(inner, 'pointerdown', 480, 200, 2, { isPrimary: false });
  holdF = true;
  for (let k = 1; k <= 10; k++) { // 6 px per event (720 px/s at 120 Hz), 80 px apart: one finger's half-frame is 7.5 % off
    T = 30 + 8 * k;
    touch(inner, 'pointermove', 400 + 6 * k, 200, 1); touch(inner, 'pointermove', 480 + 6 * k, 200, 2);
    frame();
  }
  eq([g.state().native, box.scrollLeft], [false, 940], 'the strip scrolled the 60 px');
  T = 120; touch(inner, 'pointermove', 466, 200, 1); touch(inner, 'pointerup', 546, 200, 2); // finger 2 lifts: no frame between
  holdF = false;
  T = 130; touch(inner, 'pointerup', 466, 200, 1);
  eq([g.state().session, box.scrollLeft], [null, 934], 'the last step scrolled');
});

test('own sessions: down to one finger, over after REGRIP_MS (another finger on the element meanwhile stays in it) — the other hand\'s taps, clicks and pinch work again; a slow two-finger tap\'s click is still swallowed (its touchend never prevented)', () => {
  {
    const { g, d, div } = setup();
    const cv = d.createElement('canvas'); cv.setAttribute('data-gesture', 'own'); d.body.append(cv);
    const btn = div('button'), clicks = counter(btn, 'click'), a = div(), b = div('button'), bd = counter(b, 'pointerdown');
    touch(cv, 'pointerdown', 100, 100, 1); T = 30; touch(cv, 'pointerdown', 160, 100, 2, { isPrimary: false });
    eq(g.state().session, 'own');
    T = 300; touch(cv, 'pointerup', 200, 100, 2);
    for (let t = 350; t <= 690; t += 40) { T = t; touch(cv, 'pointermove', 100 + t / 10, 100, 1); } // the thumb goes on moving
    eq(g.state().session, 'own', 'waiting for a re-grip');
    tick(701);
    eq([g.state().session, g.state().spent], [null, 0], 'over; the finger left is not spent');
    T = 1200; touch(cv, 'pointermove', 180, 100, 1);
    eq(fire(btn, 'touchend').defaultPrevented, false, 'after the grace a tap elsewhere is a tap');
    ptr(btn, 'pointerdown', 10, 10, { pointerType: 'mouse', pointerId: 40, isPrimary: true }); fire(btn, 'click', { detail: 1 });
    eq(clicks.n, 1, 'a trackpad click counts');
    T = 1500; touch(a, 'pointerdown', 600, 400, 3, { isPrimary: false }); T = 1530; const e4 = touch(b, 'pointerdown', 700, 400, 4, { isPrimary: false });
    eq([g.state().session, e4._imm, bd.n], ['nav', true, 0], 'the other hand\'s pinch');
  }
  {
    const { g, d } = setup();
    const cv = d.createElement('canvas'); cv.setAttribute('data-gesture', 'own'); d.body.append(cv);
    touch(cv, 'pointerdown', 100, 100, 1); T = 30; touch(cv, 'pointerdown', 160, 100, 2, { isPrimary: false });
    T = 100; touch(cv, 'pointerup', 100, 100, 1);
    tick(600); touch(cv, 'pointerup', 160, 100, 2);
    const te = fire(cv, 'touchend'), c = fire(cv, 'click', { metaKey: true, detail: 1 });
    eq([g.state().session, te.defaultPrevented, c._imm], [null, false, true], 'a slow two-finger tap: WebKit\'s midpoint click swallowed (the grace)');
  }
  {
    const { g, d } = setup();
    const cv = d.createElement('canvas'); cv.setAttribute('data-gesture', 'own'); d.body.append(cv);
    touch(cv, 'pointerdown', 100, 100, 1); T = 30; touch(cv, 'pointerdown', 160, 100, 2, { isPrimary: false });
    T = 100; touch(cv, 'pointerup', 160, 100, 2);
    tick(300); touch(cv, 'pointerdown', 180, 120, 3, { isPrimary: false });
    tick(1000);
    eq([g.state().session, g.state().fingers], ['own', 2], 'a re-grip within 400 ms stays in the session');
  }
});

test('pairing distances: 520 px apart pairs (one hand), 621 px does not (two hands); a still finger 15 px from the window edge is a resting thumb (never pairs late)', () => {
  for (const [dx, want] of [[520, 'nav'], [621, null]]) {
    const { g, div } = setup();
    const a = div(), b = div();
    touch(a, 'pointerdown', 100, 300, 1); T = 100; touch(b, 'pointerdown', 100 + dx, 300, 2, { isPrimary: false });
    eq(g.state().session, want, dx + ' px');
  }
  for (const [x, want] of [[15, null], [40, 'nav']]) {
    const { g, div } = setup();
    const a = div(), b = div();
    touch(a, 'pointerdown', x, 300, 1); T = 800; touch(b, 'pointerdown', x + 150, 300, 2, { isPrimary: false });
    eq(g.state().session, want, 'a still finger ' + x + ' px from the edge');
  }
});

/* ------------------------------------------------------------------ native: swallowed only; freed touches */
test('a native session only swallows (stopImmediatePropagation, never preventDefault: the browser\'s pinch and scroll as without the layer); a script session prevents its pointerdown only — its moves, lifts and touchmove are swallowed, never prevented', () => {
  for (const [ta, native] of [['auto', true], ['none', false]]) {
    const { g, div } = setup();
    const a = div(), b = div(); a._ta = ta;
    const seen = []; for (const t of ['pointerdown', 'pointermove', 'pointerup']) b.addEventListener(t, () => seen.push(t));
    touch(a, 'pointerdown', 100, 100, 1);
    T = 30; const d2 = touch(b, 'pointerdown', 200, 100, 2, { isPrimary: false });
    T = 40; const m1 = touch(a, 'pointermove', 100, 80, 1), m2 = touch(b, 'pointermove', 200, 80, 2);
    const tm = fire(b, 'touchmove'), ge = fire(b, 'gesturechange', { scale: 1.5 });
    T = 60; const u1 = touch(a, 'pointerup', 100, 80, 1), u2 = touch(b, 'pointerup', 200, 80, 2);
    eq([g.state().session, seen.length], [null, 0], ta);
    eq([d2, m1, m2, u1, u2].map(e => [e.defaultPrevented, e._imm]), [[!native, true]].concat([1, 2, 3, 4].map(() => [false, true])), ta + ': pointer events');
    eq([tm.defaultPrevented, ge.defaultPrevented, ge._imm], [false, false, true], ta + ': touchmove, GestureEvent');
  }
});

test('freed touches: a finger whose long-press opened a menu (contextmenu) or a hold chooser (wk-hold, bubbling from the widget) never pairs — the other hand\'s tap on the menu works; without it the late rule pairs them', () => {
  for (const how of ['contextmenu', 'wk-hold']) {
    const { g, div } = setup();
    const knob = div(), face = div('div', knob), row = div('button'), rd = counter(row, 'pointerdown'), clicks = counter(row, 'click');
    touch(face, 'pointerdown', 100, 100, 1);
    T = 450; fire(knob, how, { button: 2 });
    eq(g.state().free, 1, how);
    T = 700; touch(row, 'pointerdown', 300, 100, 2, { isPrimary: false }); touch(row, 'pointerup', 300, 100, 2); fire(row, 'click', { detail: 1 });
    eq([g.state().session, rd.n, clicks.n], [null, 1, 1], how);
  }
  {
    const { g, div } = setup();
    const knob = div(), row = div('button'), rd = counter(row, 'pointerdown');
    touch(knob, 'pointerdown', 100, 100, 1);
    T = 700; touch(row, 'pointerdown', 300, 100, 2, { isPrimary: false });
    eq([g.state().session, rd.n, g.state().free], ['nav', 0, 0], 'no menu: the still finger pairs late');
  }
  {
    const { g, div } = setup(); // a contextmenu during a session is swallowed and frees nothing
    const a = div(), b = div();
    touch(a, 'pointerdown', 100, 100, 1); T = 30; touch(b, 'pointerdown', 200, 100, 2, { isPrimary: false });
    const c = fire(a, 'contextmenu');
    eq([c._imm, g.state().free], [true, 0]);
  }
});

/* ------------------------------------------------------------------ review fixes (Z1 build) */
test('passive: pointermove, pointerup / -cancel and the touch events are passive capture listeners and there is no touchmove one (WebKit tracks a window\'s non-passive move / lift listeners as synchronous for every touch on the page: each scroll, pinch and tap would wait for the main thread); pointerdown non-passive (touchstart already was at 75926b6)', () => {
  const rec = [];
  const win = { addEventListener: (t, fn, o) => rec.push([t, o]), removeEventListener() {} };
  const g = G.installGestures(win, { now: () => 0, setTimeout: () => 0, clearTimeout: () => {} });
  const opts = t => rec.filter(x => x[0] === t).map(x => x[1]);
  const passive = o => !!(o && typeof o === 'object' && o.passive === true), capture = o => o === true || !!(o && o.capture);
  for (const t of ['pointermove', 'pointerup', 'pointercancel', 'pointerover', 'pointerenter', 'touchend', 'touchcancel', 'gesturestart', 'gesturechange', 'gestureend']) {
    const os = opts(t);
    eq([os.length, os.every(passive), os.every(capture)], [1, true, true], t);
  }
  eq(opts('touchmove').length, 0, 'no touchmove listener');
  eq(opts('pointerdown').map(o => [passive(o), capture(o)]), [[false, true]], 'pointerdown');
  g.destroy();
});

test('pairing distances are physical under the browser\'s own pinch-zoom (visualViewport.scale 2, the view panned 300 CSS px): a still finger and a tap 600 pt away stay two hands; a resting thumb at the zoomed view\'s left / right edge never pairs late; a grip 150 pt apart pairs; the script\'s pan starts after PAN_PX on the glass', () => {
  const vv = () => ({ scale: 2, offsetLeft: 300, offsetTop: 0, width: 640, height: 400 }); // client x 300 … 940 visible
  for (const [zoomed, want] of [[true, null], [false, 'nav']]) { // a still finger, a tap 300 CSS px away 600 ms later
    const { g, div, win } = setup();
    if (zoomed) win.visualViewport = vv();
    const a = div(), btn = div('button'), downs = counter(btn, 'pointerdown');
    touch(a, 'pointerdown', 350, 150, 1); T = 600; touch(btn, 'pointerdown', 650, 150, 2, { isPrimary: false });
    eq([g.state().session, downs.n], [want, want ? 0 : 1], zoomed ? 'zoomed 2×: 600 pt apart, two hands' : 'scale 1: 300 pt apart, the late rule pairs');
  }
  for (const [x, zoomed, want] of [[305, true, null], [935, true, null], [305, false, 'nav']]) { // 10 pt inside the view's edge
    const { g, div, win } = setup();
    if (zoomed) win.visualViewport = vv();
    const a = div(), btn = div('button');
    touch(a, 'pointerdown', x, 200, 1); T = 800; touch(btn, 'pointerdown', x < 600 ? x + 100 : x - 100, 200, 2, { isPrimary: false });
    eq(g.state().session, want, 'a still finger at client x ' + x + (zoomed ? ' (the zoomed view\'s edge)' : ' (scale 1: not an edge)'));
  }
  {
    const { g, div, win } = setup();
    win.visualViewport = vv();
    const a = div(), b = div();
    touch(a, 'pointerdown', 400, 200, 1); T = 100; touch(b, 'pointerdown', 475, 200, 2, { isPrimary: false });
    eq(g.state().session, 'nav', 'a grip 150 pt (75 CSS px) apart');
  }
  for (const [zoomed, want] of [[false, false], [true, true]]) { // the midpoint 5 CSS px: 5 pt at scale 1, 10 pt zoomed 2×
    const { g, div, win, pans } = setup();
    if (zoomed) win.visualViewport = vv();
    const a = div(), b = div(); a._ta = 'none';
    touch(a, 'pointerdown', 400, 100, 1); T = 30; touch(b, 'pointerdown', 460, 100, 2, { isPrimary: false });
    T = 40; touch(a, 'pointermove', 400, 90, 1);
    eq([g.state().native, pans.length > 0], [false, want], zoomed ? 'zoomed: past PAN_PX' : 'scale 1: not yet');
  }
});

test('a range input under a script session\'s finger (beside a knob finger): its thumb may follow (the touchmove is the browser\'s) — its value goes back at its lift and again when the last touch ends', () => {
  const { div, g } = setup();
  const k = div(), r = div('input'); k._ta = 'none'; r.type = 'range'; r.value = '0.5';
  touch(k, 'pointerdown', 100, 100, 1); T = 30; touch(r, 'pointerdown', 200, 100, 2, { isPrimary: false });
  eq([g.state().native, g.state().late], [false, 1]);
  r.value = '0.8'; // the thumb followed the finger
  T = 60; touch(r, 'pointerup', 200, 100, 2);
  eq(r.value, '0.5', 'back at its lift');
  r.value = '0.7'; // (its default handling went on)
  T = 80; touch(k, 'pointerup', 100, 100, 1); fire(r, 'touchend', { touches: [] });
  eq([r.value, g.state().late], ['0.5', 0], 'back when the last touch ends');
});

/* ------------------------------------------------------------------ destroy */
test('destroy() takes every listener off the window and forgets the session', () => {
  const { g, win, div } = setup();
  const types = ['pointerdown', 'gotpointercapture', 'pointermove', 'pointerup', 'pointercancel', 'pointerover', 'pointerenter', 'touchend',
    'touchcancel', 'gesturestart', 'gesturechange', 'gestureend', 'click', 'dblclick', 'auxclick', 'mousedown', 'mouseup', 'contextmenu', 'wk-hold',
    'visibilitychange', 'pagehide', 'blur'];
  const n = types.reduce((s, t) => s + win.listenerCount(t), 0);
  eq([n, g.state().listeners], [types.length, types.length], 'one per type');
  const a = div();
  touch(a, 'pointerdown', 100, 100, 1); T = 30; touch(a, 'pointerdown', 200, 100, 2, { isPrimary: false });
  g.destroy();
  eq([types.reduce((s, t) => s + win.listenerCount(t), 0), g.state().listeners, g.state().session, g.state().touches], [0, 0, null, 0]);
});
