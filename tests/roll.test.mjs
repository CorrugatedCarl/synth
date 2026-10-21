// roll.js (PianoRoll) on the fake DOM of tests/wk-dom.mjs, driven with synthetic touch / mouse pointers: the row model
// (default, automatic sizing that grows back, the touch floor, Fit caps, Keys −/+ steps, the device's chosen row height),
// two-finger pinch zoom (zone and axis chosen once from where / at what angle the fingers land, the engage threshold, once
// per frame, the anchor under the fingers, a third finger), the key strip's first-finger audition, WebKit GestureEvents,
// the same-frame playhead draw (roll and arrangement); touch / pen note editing (grab zones per pointer type and tool,
// the same-target double-tap, drawing runs, handle resizes, pitch / time hysteresis, hold-then-drag select box, hold on
// a note = its chord, modifier latches, thresholds, auto-scroll zones, stem / loop reach, the floating readout, reveal)
// and the arrangement's touch taps; and — last, in the page simulation — the row height persisting (synth.rollView) into
// the next session and the toolbar's touch modifier latches. (7a, IMPL-7a §4.2) A drum track's rows: drumRowsOf, the
// compact table (names, "Other", the scroll extent), drags / nudges / drawing / keys by rows, "Drum rows" off (the piano
// with the names, the unplayed rows dimmed), the velocity lane's 100 / 127 lines, a map edit noticed.
// Run: node --max-old-space-size=2048 --test tests/roll.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as dom from './wk-dom.mjs';
import * as S from '../song.js?v=9';
import { PianoRoll, drumRowsOf } from '../roll.js?v=9';
import * as DC from '../drum-core.js?v=9';
import { Arrangement } from '../arrange.js?v=9';

// never hand a fake-DOM node to assert (its AssertionError walks the cyclic tree: tens of GB): compare primitives, and
// anything else as JSON (a node would throw on its cycle at once)
const safe = v => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
const eq = (a, b, m) => assert.equal(safe(a), safe(b), m);
const ok = (v, m) => assert.ok(!!v, m);
const near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (±${tol})`);

const GUT = 64, RUL = 24;
function mk(o = {}) {
  const W = o.w || 900, H = o.h || 560;
  const doc = dom.fresh();
  globalThis.window = doc.defaultView;
  if (o.gesture) doc.defaultView.GestureEvent = function GestureEvent() {};
  dom.raf.install();
  const box = doc.createElement('div'); doc.body.appendChild(box);
  dom.place(box, 0, 0, W, H);
  const p = S.newProject({ model: 'x', name: 't' });
  const tr = p.tracks[0];
  tr.notes.push(...(o.notes || []).map((n, i) => ({ id: 1000 + i, ...n })));
  const log = [], rows = [];
  let cur = tr;
  const host = {
    getProject: () => p, getTrack: () => cur,
    edit: (l, fn) => { log.push('edit:' + l); fn(); }, beginEdit: l => log.push('begin:' + l), endEdit: () => log.push('end'), changed: () => {},
    audition: n => log.push('on' + n), auditionOff: n => log.push('off' + n),
    getPlayhead: () => 0, setPlayhead: () => {}, setLoop: () => {}, getSnap: () => p.snap, onSelect: () => {},
    touch: !!o.touch, rollRowH: o.rollRowH, onRows: r => rows.push(r),
  };
  Object.assign(host, o.host);
  const roll = new PianoRoll(box, host);
  dom.place(roll.el, 0, 0, W, H);
  dom.raf.flush(2);
  return { roll, p, tr, log, rows, doc, setTrack: t => { cur = t; roll.setTrack(); } };
}
let T = 5000;
const F = () => dom.raf.flush(1);
const tp = (roll, type, id, x, y, o = {}) => dom.ptr(roll.el, type, x, y, Object.assign({ pointerId: id, pointerType: 'touch', isPrimary: id === 1, timeStamp: (T += 30) }, o));
const lift = (roll, ...ids) => { for (const id of ids) tp(roll, 'pointerup', id, 0, 0); };
const rowAt = (roll, y) => (roll.sy + y - RUL) / roll.rowH; // fractional row (127 − pitch) under client y
const BAR = 3840; // newProject: 4/4, PPQ 960

/* ------------------------------------------------------------------ the row model */
test('rows: 12 px with a mouse, 18 px on touch; a stored row height (5–56) wins; a bad one is ignored', () => {
  eq([mk().roll.rowH, mk({ touch: true }).roll.rowH], [12, 18], 'defaults');
  eq([mk({ rollRowH: 30 }).roll.rowH, mk({ rollRowH: 30 }).roll.rowPref], [30, 30], 'stored');
  eq([mk({ rollRowH: 400 }).roll.rowH, mk({ rollRowH: 2 }).roll.rowH], [56, 5], 'clamped');
  for (const bad of [0, -3, NaN, 'tall', undefined, null]) eq([mk({ rollRowH: bad }).roll.rowH, mk({ rollRowH: bad }).roll.rowPref], [12, null], 'ignored: ' + bad);
});

test('rows: opening a wide track shrinks them, a narrow one grows them back (1100×380, the iPad\'s short roll); touch never below 14 px', () => {
  const wide = n => ({ id: 'W', notes: [{ id: 1, t: 0, d: 960, n: 36, v: 100 }, { id: 2, t: 960, d: 960, n: 84, v: 100 }] }), narrow = { id: 'N', notes: [{ id: 3, t: 0, d: 960, n: 60, v: 100 }, { id: 4, t: 960, d: 960, n: 64, v: 100 }] };
  for (const touch of [false, true]) {
    const { roll, setTrack } = mk({ w: 1100, h: 380, touch });
    eq(roll.gh, 283, 'grid height');
    const seq = [roll.rowH];
    setTrack(narrow); seq.push(roll.rowH);
    setTrack(wide()); seq.push(roll.rowH);
    setTrack(narrow); seq.push(roll.rowH);
    // mouse: the C3–C5 default view fits at 10 px, a 5-note track at the 12 px default, C2–C6 at 5 px — and back
    eq(seq, touch ? [14, 18, 14, 18] : [10, 12, 5, 12], touch ? 'touch' : 'mouse');
    // the wide track scrolls instead (its centre is in view)
    if (touch) { setTrack(wide()); ok(128 * roll.rowH > roll.gh && roll.sy > 0, 'scrolls'); }
  }
});

test('rows: a chosen row height (Alt-wheel, Keys −/+, pinch) is kept on track switches and reported to the host (onRows)', () => {
  const { roll, rows, setTrack } = mk({ w: 1100, h: 380 });
  const wide = { id: 'W', notes: [{ id: 1, t: 0, d: 960, n: 24, v: 100 }, { id: 2, t: 960, d: 960, n: 96, v: 100 }] };
  // Alt-wheel up: rows grow about the pointer; the host hears the rounded height
  const e = dom.fire(roll.el, 'wheel', { deltaY: -60, altKey: true, clientX: 400, clientY: 200 });
  ok(e.defaultPrevented, 'wheel handled');
  ok(roll.rowH > 10 && rows.length === 1 && rows[0] === roll.rowH, 'onRows: ' + rows);
  const chosen = roll.rowH;
  setTrack(wide);
  eq([roll.rowH, roll.rowPref != null], [chosen, true], 'kept on a wide track');
  // Fit is a one-off view: not a choice (not reported), within its caps
  roll.fit(); eq(rows.length, 1, 'Fit is not reported');
  ok(roll.rowH >= 5 && roll.rowH <= 32, 'Fit within 5–32 with a mouse: ' + roll.rowH);
  setTrack(wide);
  eq(roll.rowH, chosen, 'the choice comes back on the next track');
});

test('rows: Fit caps at 32 px with a mouse and 44 px on touch (and keeps 14 px or more on touch)', () => {
  const one = [{ t: 0, d: 960, n: 60, v: 100 }], span = [{ t: 0, d: 960, n: 24, v: 100 }, { t: 960, d: 960, n: 100, v: 100 }];
  const fit = o => { const r = mk(o); r.roll.fit(); return r.roll.rowH; };
  eq([fit({ notes: one }), fit({ notes: one, touch: true })], [32, 44], 'caps');
  eq([fit({ notes: span }), fit({ notes: span, touch: true })], [5, 14], 'floors');
});

test('rows: Keys −/+ step through 5…56 in fixed steps — symmetric, the pitch in the middle stays', () => {
  const { roll, rows } = mk();
  const mid = rowAt(roll, RUL + roll.gh / 2), lad = [];
  for (let i = 0; i < 12; i++) { roll.zoomRows(1); lad.push(roll.rowH); }
  eq(lad, [14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 56, 56], 'up');
  near(rowAt(roll, RUL + roll.gh / 2), mid, 0.5, 'middle row');
  const down = [];
  for (let i = 0; i < 16; i++) { roll.zoomRows(-1); down.push(roll.rowH); }
  eq(down, [48, 40, 32, 28, 24, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 5], 'down');
  eq(rows.length, 25, 'every real step reported (10 up, 15 down), none at the limits');
});

test('rows: on touch the roll counts as touch once a finger lands, even on a device that reported a mouse', () => {
  const span = { id: 'W', notes: [{ id: 1, t: 0, d: 960, n: 24, v: 100 }, { id: 2, t: 960, d: 960, n: 100, v: 100 }] };
  const { roll, setTrack } = mk({ w: 1100, h: 380 });
  setTrack(span); eq(roll.rowH, 5, 'mouse: shrinks to fit');
  tp(roll, 'pointerdown', 1, 400, 200); lift(roll, 1);
  setTrack(span); eq(roll.rowH, 14, 'after a touch: 14 px, scrolling');
});

/* ------------------------------------------------------------------ pinch */
test('pinch on the key strip: a vertical spread sizes the rows only; the pitch under the fingers stays; time is held; the size is kept', () => {
  const { roll, rows } = mk();
  const ppt0 = roll.ppt, sx0 = roll.sx, row0 = rowAt(roll, 250);
  tp(roll, 'pointerdown', 1, 30, 200); tp(roll, 'pointerdown', 2, 34, 300);
  eq([roll.g.type, roll.g.zone, roll.g.ax], ['pinch', 'keys', 'y'], 'zone');
  for (let k = 1; k <= 10; k++) { tp(roll, 'pointermove', 1, 30 + (k % 2) * 6, 200 - 10 * k); tp(roll, 'pointermove', 2, 34, 300 + 10 * k); F(); }
  ok(roll.rowH >= 33 && roll.rowH <= 37, 'rows ×3: ' + roll.rowH);
  eq([roll.ppt, roll.sx], [ppt0, sx0], 'time untouched (sideways wobble on the keys never scrolls)');
  near((rowAt(roll, 250) - row0) * roll.rowH, 0, 1, 'pitch under the midpoint (px)');
  // pan down 60 px while pinching: the pitch follows the fingers
  tp(roll, 'pointermove', 1, 30, 160); tp(roll, 'pointermove', 2, 34, 460); F();
  near((rowAt(roll, 310) - row0) * roll.rowH, 0, 1, 'pitch follows a pan (px)');
  eq(rows.length, 0, 'not reported mid-pinch');
  lift(roll, 1, 2);
  eq([roll.g, rows.length, rows[0], roll.rowPref != null], [null, 1, roll.rowH, true], 'reported once, at the end');
});

test('pinch on the grid: sideways (with wobble) zooms time; steeper than 60° zooms rows; a natural 45° thumb-and-finger pinch zooms time only', () => {
  { // horizontal with ±9 px vertical wobble
    const { roll } = mk(), rowH0 = roll.rowH, t0 = roll.x2t(400);
    tp(roll, 'pointerdown', 1, 300, 250); tp(roll, 'pointerdown', 2, 500, 255);
    for (let k = 1; k <= 10; k++) { tp(roll, 'pointermove', 1, 300 - 10 * k, 250 + (k % 3) * 8); tp(roll, 'pointermove', 2, 500 + 10 * k, 255 - (k % 2) * 9); F(); }
    eq([roll.g.zone, roll.g.ax, roll.rowH], ['grid', 'x', rowH0], 'time only');
    ok(roll.ppt > 1.8 * 220 / BAR, 'zoomed in');
    lift(roll, 1, 2);
    near(roll.x2t(400), t0, 1e-6, 'the tick under the midpoint stays');
  }
  { // vertical
    const { roll } = mk(), ppt0 = roll.ppt;
    tp(roll, 'pointerdown', 1, 400, 180); tp(roll, 'pointerdown', 2, 410, 320);
    for (let k = 1; k <= 8; k++) { tp(roll, 'pointermove', 1, 400, 180 - 8 * k); tp(roll, 'pointermove', 2, 410, 320 + 8 * k); F(); }
    eq([roll.g.ax, roll.ppt], ['y', ppt0], 'rows only');
    ok(roll.rowH > 12, 'rows grew: ' + roll.rowH);
    lift(roll, 1, 2);
  }
  { // 45°: today's behaviour (time), not rows
    const { roll } = mk(), ppt0 = roll.ppt, r0 = roll.rowH;
    tp(roll, 'pointerdown', 1, 400, 300); tp(roll, 'pointerdown', 2, 460, 240);
    for (let k = 1; k <= 8; k++) { tp(roll, 'pointermove', 1, 400 - 8 * k, 300 + 8 * k); tp(roll, 'pointermove', 2, 460 + 8 * k, 240 - 8 * k); F(); }
    eq([roll.g.ax, roll.rowH], ['x', r0], 'time only');
    ok(roll.ppt > 2 * ppt0, 'time zoomed ' + (roll.ppt / ppt0).toFixed(2));
    lift(roll, 1, 2);
  }
});

test('pinch: a wide sideways pinch whose left finger starts on the key strip zooms time (zone by the midpoint and angle)', () => {
  const { roll } = mk(), ppt0 = roll.ppt, r0 = roll.rowH;
  tp(roll, 'pointerdown', 1, 40, 260); tp(roll, 'pointerdown', 2, 500, 250);
  for (let k = 1; k <= 8; k++) { tp(roll, 'pointermove', 1, 40, 260); tp(roll, 'pointermove', 2, 500 + 20 * k, 250); F(); }
  eq([roll.g.zone, roll.g.ax, roll.rowH], ['grid', 'x', r0], 'not the keys');
  ok(roll.ppt > 1.2 * ppt0, 'time zoomed');
  lift(roll, 1, 2);
});

test('pinch from the ruler or the velocity lane zooms time even when vertical', () => {
  for (const y0 of [10, 520]) {
    const { roll } = mk(), r0 = roll.rowH;
    tp(roll, 'pointerdown', 1, 400, y0); tp(roll, 'pointerdown', 2, 420, y0 === 10 ? 200 : 300);
    eq([roll.g.zone, roll.g.ax], ['time', 'x'], 'zone at y ' + y0);
    tp(roll, 'pointermove', 2, 420, y0 === 10 ? 300 : 200); F();
    eq(roll.rowH, r0, 'rows untouched');
    lift(roll, 1, 2);
  }
});

test('pinch: a two-finger pan with spread jitter under 6 px is a pure pan (no zoom); past 6 px the zoom engages without a jump', () => {
  const { roll } = mk(), ppt0 = roll.ppt, r0 = roll.rowH, sy0 = roll.sy;
  tp(roll, 'pointerdown', 1, 300, 200); tp(roll, 'pointerdown', 2, 420, 260);
  // each touch event's fingers arrive as separate pointermoves (12 px steps): applied once per frame, from both
  for (let k = 1; k <= 10; k++) { tp(roll, 'pointermove', 1, 300 + 4 * k, 200 + 12 * k + (k % 2) * 3); tp(roll, 'pointermove', 2, 420 + 4 * k, 260 + 12 * k); F(); }
  eq([roll.ppt, roll.rowH, roll.sy, roll.g.on], [ppt0, r0, sy0 - 120, false], 'pan only');
  lift(roll, 1, 2);
  const b = mk(), q0 = b.roll.ppt;
  tp(b.roll, 'pointerdown', 1, 300, 250); tp(b.roll, 'pointerdown', 2, 400, 250);
  tp(b.roll, 'pointermove', 2, 406, 250); F();
  eq(b.roll.g.on, true, 'engaged at the threshold');
  near(b.roll.ppt / q0, 1, 1e-12, 'rebased there: no jump');
  tp(b.roll, 'pointermove', 2, 506, 250); F();
  near(b.roll.ppt / q0, 206 / 106, 1e-9, 'then proportional to the spread');
  lift(b.roll, 1, 2);
});

test('pinch: moves are applied once per frame, not per pointermove', () => {
  const { roll } = mk(), ppt0 = roll.ppt;
  tp(roll, 'pointerdown', 1, 300, 250); tp(roll, 'pointerdown', 2, 400, 250);
  tp(roll, 'pointermove', 2, 500, 250);
  eq([roll.ppt, roll.g.pend, dom.raf.pending > 0], [ppt0, true, true], 'waiting for the frame');
  F();
  eq(roll.g.pend, false); ok(roll.ppt > ppt0, 'applied in the frame');
  // a finger lifting first applies the moves still waiting
  tp(roll, 'pointermove', 2, 600, 250);
  const before = roll.ppt;
  tp(roll, 'pointerup', 2, 600, 250);
  ok(roll.ppt > before && roll.g === null, 'caught up, then ended');
  lift(roll, 1);
});

test('pinch: rows clamp at 56 px and the anchor holds there', () => {
  const { roll } = mk();
  tp(roll, 'pointerdown', 1, 30, 240); tp(roll, 'pointerdown', 2, 30, 260);
  const row0 = rowAt(roll, 250);
  tp(roll, 'pointermove', 1, 30, 40); tp(roll, 'pointermove', 2, 30, 460); F();
  eq(roll.rowH, 56, 'max');
  near((rowAt(roll, 250) - row0) * roll.rowH, 0, 1, 'anchor (px)');
  lift(roll, 1, 2);
});

test('pinch: a quick re-pinch over a note does not delete it, and a two-finger tap then a tap does not add one (lastTap cleared)', () => {
  { const { roll, tr } = mk({ notes: [{ t: 0, d: 960 * 4, n: 60, v: 100 }] });
    const y = roll.n2y(60) + roll.rowH / 2, x = roll.t2x(960);
    tp(roll, 'pointerdown', 1, x, y); tp(roll, 'pointerdown', 2, x + 200, y + 10);
    eq(roll.lastTap, null, 'cleared at the pinch');
    lift(roll, 1, 2);
    tp(roll, 'pointerdown', 3, x + 1, y, { isPrimary: true }); tp(roll, 'pointerup', 3, x + 1, y, { isPrimary: true });
    eq(tr.notes.length, 1, 'the note survives'); }
  { const { roll, tr, log } = mk();
    tp(roll, 'pointerdown', 1, 400, 200); tp(roll, 'pointerdown', 2, 500, 200); lift(roll, 1, 2);
    tp(roll, 'pointerdown', 3, 402, 201, { isPrimary: true }); tp(roll, 'pointerup', 3, 402, 201, { isPrimary: true });
    eq([tr.notes.length, log.filter(s => s.startsWith('edit')).length], [0, 0], 'nothing added'); }
});

test('pinch: a third finger (or a palm) taking over the pair restarts from the current view — no jump', () => {
  const { roll } = mk();
  tp(roll, 'pointerdown', 1, 300, 200); tp(roll, 'pointerdown', 2, 300, 300);
  tp(roll, 'pointermove', 1, 300, 180); tp(roll, 'pointermove', 2, 300, 320); F();
  tp(roll, 'pointerdown', 3, 600, 400);
  const before = [roll.rowH, roll.sy, roll.sx, roll.ppt];
  tp(roll, 'pointerup', 1, 300, 180); // the pair is now (2, 3)
  tp(roll, 'pointermove', 2, 300, 321); F();
  eq(roll.g && roll.g.type, 'pinch', 'still a pinch');
  eq([roll.rowH, roll.ppt], [before[0], before[3]], 'no zoom jump');
  near(roll.sx, before[2], 1e-6, 'no time jump');
  ok(Math.abs(roll.sy - before[1]) <= 1, 'no vertical jump');
  lift(roll, 2, 3);
});

test('pinch end: pointercancel and lostpointercapture end it like pointerup — the row height is kept and reported, the view redrawn', () => {
  for (const how of ['pointercancel', 'lostpointercapture']) {
    const { roll, rows } = mk();
    tp(roll, 'pointerdown', 1, 30, 200); tp(roll, 'pointerdown', 2, 30, 300);
    tp(roll, 'pointermove', 1, 30, 150); tp(roll, 'pointermove', 2, 30, 350); F();
    tp(roll, how, 2, 30, 350);
    eq([roll.g, rows.length, rows[0], roll.rowPref], [null, 1, roll.rowH, roll.rowHf], how);
    ok(dom.raf.pending > 0, how + ': redraw requested');
    lift(roll, 1);
  }
  // a time-only pinch reports nothing
  const { roll, rows } = mk();
  tp(roll, 'pointerdown', 1, 300, 250); tp(roll, 'pointerdown', 2, 400, 250);
  tp(roll, 'pointermove', 2, 500, 250); F(); lift(roll, 1, 2);
  eq([rows.length, roll.rowPref], [0, null], 'time pinch');
});

test('key strip: the first finger sounds at once (no hold); a second finger keeps it until the pinch is confirmed, then it stops; nothing stuck', () => {
  const { roll, log } = mk();
  const k1 = 127 - Math.floor((200 - RUL + roll.syr) / roll.rowH);
  tp(roll, 'pointerdown', 1, 30, 200);
  eq(log, ['on' + k1], 'immediate');
  tp(roll, 'pointerup', 1, 30, 200);
  eq(log, ['on' + k1, 'off' + k1], 'a tap: on / off');
  log.length = 0;
  tp(roll, 'pointerdown', 1, 30, 200, { timeStamp: (T += 1000) });
  tp(roll, 'pointerdown', 2, 30, 300);
  eq([log, [...roll.keys]], [['on' + k1], [k1]], 'two fingers down, not yet a pinch: still sounding');
  tp(roll, 'pointermove', 2, 30, 302); F();
  eq(log.length, 1, 'a 2 px wobble does not confirm it');
  tp(roll, 'pointermove', 2, 30, 330); F();
  eq([log, roll.keys.size], [['on' + k1, 'off' + k1], 0], 'confirmed: stopped');
  lift(roll, 1, 2);
  eq(log.length, 2, 'one off');
  // a pinch that never moves: the key stops when it ends
  log.length = 0;
  tp(roll, 'pointerdown', 1, 30, 200, { timeStamp: (T += 1000) }); tp(roll, 'pointerdown', 2, 30, 300); lift(roll, 1, 2);
  eq([log, roll.keys.size], [['on' + k1, 'off' + k1], 0], 'still pinch: off at the end');
  // a two-finger pan on the keys confirms it too
  log.length = 0;
  tp(roll, 'pointerdown', 1, 30, 200, { timeStamp: (T += 1000) }); tp(roll, 'pointerdown', 2, 30, 300);
  tp(roll, 'pointermove', 1, 30, 210); tp(roll, 'pointermove', 2, 30, 310); F();
  eq(log, ['on' + k1, 'off' + k1], 'pan confirms');
  lift(roll, 1, 2);
});

test('key strip: setTrack or destroy during a pinch leaves no note sounding', () => {
  for (const end of ['setTrack', 'destroy']) {
    const { roll, log } = mk();
    tp(roll, 'pointerdown', 1, 30, 200); tp(roll, 'pointerdown', 2, 30, 300);
    if (end === 'setTrack') roll.setTrack(); else roll.destroy();
    eq([log.length, log[1] && log[1].slice(0, 3), roll.keys.size, roll.g], [2, 'off', 0, null], end);
  }
});

/* ------------------------------------------------------------------ WebKit gesture events */
test('GestureEvents (WebKit): always preventDefault; a trackpad pinch (no fingers) zooms time, Shift the rows; with fingers only the pointers act; destroy removes them', () => {
  const { roll, rows } = mk({ gesture: true });
  eq(roll.el.listenerCount('gesturechange'), 1, 'listening');
  const ppt0 = roll.ppt, r0 = roll.rowH;
  ok(dom.fire(roll.el, 'gesturestart', { scale: 1 }).defaultPrevented, 'start prevented');
  ok(dom.fire(roll.el, 'gesturechange', { scale: 1.5, clientX: 400, clientY: 200 }).defaultPrevented, 'change prevented');
  near(roll.ppt / ppt0, 1.5, 1e-9, 'time ×1.5');
  dom.fire(roll.el, 'gesturechange', { scale: 3, clientX: 400, clientY: 200 });
  near(roll.ppt / ppt0, 3, 1e-9, 'relative to the last scale');
  dom.fire(roll.el, 'gestureend', { scale: 3 });
  dom.fire(roll.el, 'gesturestart', { scale: 1 });
  dom.fire(roll.el, 'gesturechange', { scale: 2, clientX: 400, clientY: 200, shiftKey: true });
  eq([roll.rowH, rows.length], [Math.round(r0 * 2), 1], 'Shift: rows, reported');
  dom.fire(roll.el, 'gestureend', { scale: 2 });
  // fingers on the roll (iPad): the gesture events only preventDefault — the pointers zoom
  const ppt1 = roll.ppt, r1 = roll.rowH;
  tp(roll, 'pointerdown', 1, 300, 250); tp(roll, 'pointerdown', 2, 400, 250);
  ok(dom.fire(roll.el, 'gesturestart', { scale: 1 }).defaultPrevented, 'prevented');
  ok(dom.fire(roll.el, 'gesturechange', { scale: 4, clientX: 350, clientY: 250 }).defaultPrevented, 'prevented');
  eq([roll.ppt, roll.rowH], [ppt1, r1], 'the gesture did not zoom');
  lift(roll, 1, 2);
  // a straggling gesturechange after the fingers lifted is ignored too
  dom.fire(roll.el, 'gesturechange', { scale: 5, clientX: 350, clientY: 250 });
  eq(roll.ppt, ppt1, 'straggler ignored');
  roll.destroy();
  eq(['gesturestart', 'gesturechange', 'gestureend'].map(t => roll.el.listenerCount(t)), [0, 0, 0], 'removed');
  eq(mk().roll.el.listenerCount('gesturechange'), 0, 'not added without GestureEvent');
});

/* ------------------------------------------------------------------ playhead: same-frame draw */
test('playhead: setPlayhead(t, true) draws the roll and the arrangement in this frame (no frame left pending); without it a frame is requested', () => {
  const { roll, p, doc } = mk();
  const calls = () => roll.el.getContext('2d').calls.length;
  let n = calls();
  roll.setPlayhead(960);
  eq([calls(), dom.raf.pending], [n, 1], 'requested');
  roll.setPlayhead(1920, true);
  ok(calls() > n, 'drawn now'); eq([dom.raf.pending, roll.raf], [0, 0], 'the pending frame cancelled');
  n = calls(); roll.render(); roll.setPlayhead(2880, true);
  ok(calls() > n && dom.raf.pending === 0, 'a pending render drawn now too');
  ok(roll.el.getContext('2d').calls.some(c => c[0] === 'fillRect' && c[1] === Math.round(roll.t2x(2880)) && c[2] === RUL), 'at the new position');
  // arrangement
  const box = doc.createElement('div'); doc.body.appendChild(box); dom.place(box, 0, 0, 800, 200);
  const arr = new Arrangement(box, { getProject: () => p, getPlayhead: () => 0, setPlayhead: () => {}, setLoop: () => {}, getRange: () => null, setRange: () => {}, selectTrack: () => {}, openTrack: () => {}, rowHeight: 56 });
  dom.place(arr.el, 0, 0, 800, 80);
  dom.raf.flush(1);
  const ac = () => arr.el.getContext('2d').calls.length;
  let m = ac();
  arr.setPlayhead(960);
  eq([ac(), dom.raf.pending], [m, 1], 'arrangement: requested');
  arr.setPlayhead(1920, true);
  ok(ac() > m, 'arrangement: drawn now'); eq([dom.raf.pending, arr.raf], [0, 0], 'arrangement: nothing pending');
  m = ac(); arr.setPlayhead(1920, true);
  ok(ac() > m, 'arrangement: same tick still drawn');
  arr.destroy(); m = ac(); arr.setPlayhead(2880, true);
  eq(ac(), m, 'not after destroy');
  roll.destroy(); n = calls(); roll.setPlayhead(10, true);
  eq([calls(), dom.raf.pending], [n, 0], 'roll: not after destroy');
});

/* ------------------------------------------------------------------ touch / pen note editing */
// one pointer gesture: down at the first point, a move to each later one, up at the last (touch unless o says otherwise);
// gap: ms since the last gesture (400: never the second half of a double-tap; 0 for one)
let PID = 100;
function gest(roll, pts, o = {}, gap = 400) {
  T += gap;
  const b = Object.assign({ pointerId: ++PID, pointerType: 'touch', isPrimary: true }, o), at = () => Object.assign({ timeStamp: (T += 16) }, b);
  dom.ptr(roll.el, 'pointerdown', pts[0][0], pts[0][1], at());
  for (const [x, y] of pts.slice(1)) dom.ptr(roll.el, 'pointermove', x, y, at());
  const [x, y] = pts[pts.length - 1];
  dom.ptr(roll.el, 'pointerup', x, y, at());
}
const tap = (roll, x, y, o, gap) => gest(roll, [[x, y]], o, gap);
const tap2 = (roll, x, y, x2, y2, o) => { tap(roll, x, y, o); tap(roll, x2, y2, o, 0); }; // two quick taps
const line = (x0, y0, x1, y1, n = 6) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
const N = (t, d, n, v = 100) => ({ t, d, n, v });
const yOf = (roll, n) => roll.n2y(n) + roll.rowH / 2;
const CELL = 240 * 220 / BAR; // a 1/16 note at the default zoom: 13.75 px
const ids = roll => [...roll.sel].sort((a, b) => a - b);
const press = (roll, x, y, o) => { const b = Object.assign({ pointerId: ++PID, pointerType: 'touch', isPrimary: true, timeStamp: (T += 400) }, o); dom.ptr(roll.el, 'pointerdown', x, y, b); return b; };
const moveTo = (roll, x, y, b) => dom.ptr(roll.el, 'pointermove', x, y, Object.assign({}, b, { timeStamp: (T += 16) }));
const release = (roll, x, y, b) => dom.ptr(roll.el, 'pointerup', x, y, Object.assign({}, b, { timeStamp: (T += 16) }));

test('double-tap counts on the same target only: quick taps on two neighbouring notes delete nothing (touch: their centres; mouse: 2 px either side); on one note it deletes; on empty grid it adds', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const pt of ['touch', 'mouse']) {
    const { roll, tr } = mk({ touch: pt === 'touch', notes: [N(3840, 240, 60), N(4080, 240, 60)] });
    const y = yOf(roll, 60), xb = roll.t2x(4080), o = { pointerType: pt }, d = pt === 'touch' ? CELL / 2 : 2;
    tap2(roll, xb - d, y, xb + d, y, o);
    eq(tr.notes.length, 2, pt + ': both neighbours survive');
    tap2(roll, xb + d, y, xb + d + 1, y, o);
    eq(tr.notes.map(n => n.t), [3840], pt + ': a double-tap on one note deletes it');
    tap2(roll, roll.t2x(7680), yOf(roll, 64), roll.t2x(7680) + 3, yOf(roll, 64), o);
    eq(tr.notes.map(n => [n.t, n.n]), [[3840, 60], [7680, 64]], pt + ': a double-tap on empty grid adds one');
  }
  // touch: a double-tap a cell past a selected note (its far handle reach) adds a note there instead of deleting it
  const { roll, tr } = mk({ touch: true, notes: [N(3840, 240, 60)] });
  const y = yOf(roll, 60), x = roll.t2x(4080) + CELL * 0.6;
  roll.selectAll();
  tap2(roll, x, y, x + 2, y);
  eq(tr.notes.map(n => n.t), [3840, 4080], 'added in the next cell');
  // a finger's second tap may land farther off: 14 px apart still counts
  tap2(roll, roll.t2x(4100), y, roll.t2x(4100) + 14, y);
  eq(tr.notes.map(n => n.t), [3840], 'the second note, deleted');
});

test('double-tap by touch / pen targets the note under the press: just past a selected note (the next cell) or just above it adds a note; on a neighbour\'s start it deletes the neighbour, never the selected note; a tap in one note then in its neighbour deletes nothing', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const pt of ['touch', 'pen']) {
    const o = { pointerType: pt };
    for (const dx of [2, 4]) {
      // the next 1/16 cell after a note a double-tap just added (selected: its handle reaches into the cell)
      const { roll, tr } = mk({ touch: true });
      const y = yOf(roll, 60), xa = roll.t2x(3840) + CELL / 2;
      tap2(roll, xa, y, xa + 1, y, o);
      eq([tr.notes.map(n => n.t), ids(roll).length], [[3840], 1], `${pt}: added, selected`);
      const xn = roll.t2x(4080) + dx;
      tap2(roll, xn, y, xn + 1, y, o);
      eq(tr.notes.map(n => n.t), [3840, 4080], `${pt}: ${dx} px into the next cell adds the next note`);
      // the row above a selected quarter note's end zone: a chord note
      const q = mk({ touch: true, notes: [N(3840, 960, 60)] }), x1 = q.roll.t2x(4800) - 3, ya = q.roll.n2y(60) - dx;
      q.roll.selectAll();
      tap2(q.roll, x1, ya, x1 + 1, ya, o);
      eq(q.tr.notes.map(n => n.n).sort(), [60, 61], `${pt}: ${dx} px above its end zone adds a chord note`);
    }
    for (const dx of [3, 5]) {
      // A selected, B its unselected neighbour: a double-tap dx px inside B deletes B
      const { roll, tr } = mk({ touch: true, notes: [N(3840, 240, 60), N(4080, 240, 60)] });
      const y = yOf(roll, 60), xb = roll.t2x(4080) + dx;
      tap(roll, roll.t2x(3840) + CELL / 2, y, o);
      eq(ids(roll), [1000], 'A selected');
      tap2(roll, xb, y, xb + 1, y, o);
      eq(tr.notes.map(n => n.id), [1000], `${pt}: ${dx} px into B deletes B, keeps A`);
    }
    // the first tap inside A, the second 3 px into its neighbour B: two targets, nothing deleted
    const { roll, tr } = mk({ touch: true, notes: [N(3840, 240, 60), N(4080, 240, 60)] });
    const y = yOf(roll, 60), xb = roll.t2x(4080) + 3;
    tap(roll, xb - 6, y, o); tap(roll, xb, y, o, 0);
    eq(tr.notes.map(n => n.id), [1000, 1001], `${pt}: A then B: both kept`);
  }
});

test('Draw tool by touch: tapping out a run of 1/16 notes creates every note; a finger just past a note\'s end, or just off its row, resizes it (no stray note)', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { roll, tr } = mk({ touch: true });
  roll.setTool('draw');
  const y = yOf(roll, 60);
  for (let i = 0; i < 8; i++) tap(roll, roll.t2x(3840 + 240 * i) + CELL / 2, y, undefined, 120);
  eq(tr.notes.map(n => [n.t, n.d, n.n]), Array.from({ length: 8 }, (_, i) => [3840 + 240 * i, 240, 60]), 'eight back-to-back notes');
  // near misses on an unselected 1/8 note: 2 px past its end; 2 px above its row (3 px inside the end)
  for (const [dx, dy] of [[2, 0], [-3, -roll.rowH / 2 - 2]]) {
    tr.notes.length = 0; tr.notes.push({ id: 7, t: 7680, d: 480, n: 64, v: 100 }); roll.selectNone();
    const x1 = roll.t2x(8160), yy = yOf(roll, 64) + dy;
    gest(roll, line(x1 + dx, yy, x1 + dx + 2 * CELL, yy));
    eq(tr.notes.map(n => [n.t, n.d, n.n]), [[7680, 960, 64]], `resized from ${dx}, ${dy}`);
  }
});

test('touch resize: a 1/16 note\'s end handle resizes it (never moves it); unselected, 4 px inside its end resizes and 8 px inside moves; a mouse keeps its legacy zones', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { roll, tr, log } = mk({ touch: true, notes: [N(3840, 240, 60)] });
  const nt = tr.notes[0], y = yOf(roll, 60), x1 = () => roll.t2x(nt.t + nt.d), reset = () => { nt.t = 3840; nt.d = 240; roll.selectNone(); };
  gest(roll, line(x1() - 4, y, x1() - 4 + 2 * CELL, y));
  eq([nt.t, nt.d], [3840, 720], 'unselected, 4 px inside the end: resized');
  reset(); gest(roll, line(x1() - 8, y, x1() - 8 + 2 * CELL, y));
  eq([nt.t, nt.d], [4320, 240], 'unselected, 8 px inside: moved');
  reset(); tap(roll, x1() - CELL / 2, y);
  eq([ids(roll), roll.coarse], [[1000], true], 'a tap selects it (handles shown)');
  for (const dx of [2, 15]) {
    nt.d = 240; log.length = 0;
    gest(roll, line(x1() + dx, y, x1() + dx + 3 * CELL, y));
    eq([nt.t, nt.d], [3840, 960], `selected, ${dx} px past its end (on / beyond its tab): resized`);
    eq(log.filter(s => s.startsWith('begin')), ['begin:Resize notes'], 'one resize step');
  }
  // a 1/32 (too short for a start zone): its end handle still resizes
  nt.d = 120;
  gest(roll, line(x1() + 3, y, x1() + 3 + 1.5 * CELL, y));
  eq([nt.t, nt.d], [3840, 480], 'a 1/32 by its end');
  dom.fire(roll.el, 'pointermove', { pointerType: 'mouse', clientX: 400, clientY: 300, buttons: 0 });
  eq(roll.coarse, false, 'a mouse again: no handles');
  // mouse: 4 px past the end is a miss (a select box), 2 px inside resizes — as before
  const m = mk({ notes: [N(3840, 240, 60)] }), mn = m.tr.notes[0], my = yOf(m.roll, 60), mx1 = m.roll.t2x(4080), mo = { pointerType: 'mouse' };
  gest(m.roll, line(mx1 + 4, my, mx1 + 4 + 2 * CELL, my), mo);
  eq([mn.t, mn.d], [3840, 240], 'mouse +4 px: untouched');
  gest(m.roll, line(mx1 - 2, my, mx1 - 2 + 2 * CELL, my), mo);
  eq([mn.t, mn.d], [3840, 720], 'mouse −2 px: resized');
});

test('touch / pen, a selected run of back-to-back 1/16 notes: a press near a note\'s start moves the run (a selected neighbour\'s handle does not take it), near its end resizes; an unselected next note\'s start still resizes the selected one', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const run = () => Array.from({ length: 8 }, (_, i) => N(3840 + 240 * i, 240, 60));
  for (const pt of ['touch', 'pen']) {
    const o = { pointerType: pt };
    for (const dx of [3, 5]) {
      const { roll, tr } = mk({ touch: true, notes: run() }), y = yOf(roll, 60), x3 = roll.t2x(4560) + dx;
      roll.selectAll();
      gest(roll, line(x3, y, x3 + 2 * CELL, y), o);
      eq(tr.notes.map(n => [n.t, n.d]), run().map(n => [n.t + 480, 240]), `${pt}: ${dx} px inside note 3's start: the run moved`);
    }
    const { roll, tr } = mk({ touch: true, notes: run() }), y = yOf(roll, 60), xe = roll.t2x(4800) - 2;
    roll.selectAll();
    gest(roll, line(xe, y, xe + 2 * CELL, y), o);
    eq(tr.notes.map(n => n.d), run().map(() => 720), `${pt}: 2 px before its end: every note resized`);
    // only note 2 selected: the first px of the unselected note 3 resize note 2 (back-to-back notes stay grabbable)
    const u = mk({ touch: true, notes: run() }), x3 = u.roll.t2x(4560) + 3;
    u.roll._setSel([1002]);
    gest(u.roll, line(x3, y, x3 + 2 * CELL, y), o);
    eq(u.tr.notes.map(n => [n.t, n.d]), run().map((n, i) => [n.t, i === 2 ? 720 : 240]), `${pt}: note 2 resized`);
  }
});

test('touch move: a vertical drag with sideways drift keeps the start; a sideways drag with vertical drift keeps the pitch; time follows after 10 px (a mouse: 4 px)', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { roll, tr } = mk({ touch: true, notes: [N(960, 960, 60)] });
  const nt = tr.notes[0], rh = roll.rowH;
  let xm = roll.t2x(960) + 20, y = yOf(roll, 60);
  gest(roll, Array.from({ length: 7 }, (_, k) => [xm + 8 * k / 6, y - rh * k]));
  eq([nt.t, nt.n], [960, 66], 'six rows up, 8 px sideways: start kept');
  y = yOf(roll, 66);
  gest(roll, line(xm, y, xm + 2 * CELL, y + 7));
  eq([nt.t, nt.n], [1440, 66], 'two cells right, 7 px down: pitch kept');
  xm = roll.t2x(1440) + 20;
  gest(roll, line(xm, y, xm + 9, y));
  eq(nt.t, 1440, '9 px sideways: not yet a move in time');
  gest(roll, line(xm, y, xm, y - 0.7 * rh));
  eq(nt.n, 66, 'under ¾ of a row: pitch kept');
  gest(roll, line(xm, y, xm, y - rh - 6));
  eq(nt.n, 67, 'a row and a bit: one up');
  // a mouse: the same vertical drag's 8 px drift moves the start one cell, as before
  const m = mk({ notes: [N(960, 960, 60)] }), mn = m.tr.notes[0], mxm = m.roll.t2x(960) + 20, my = yOf(m.roll, 60);
  gest(m.roll, Array.from({ length: 7 }, (_, k) => [mxm + 8 * k / 6, my - m.roll.rowH * k]), { pointerType: 'mouse' });
  eq([mn.t, mn.n], [1200, 66], 'mouse unchanged');
});

test('touch, Select tool: a finger held still on the empty grid (500 ms, ≤ 8 px), then dragged, draws a select box without scrolling; a quick drag scrolls; under 8 px nothing scrolls; a tap deselects', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { roll } = mk({ touch: true, notes: [N(3840, 240, 60), N(4080, 240, 62), N(4320, 240, 64), N(7680, 240, 60)] });
  const sx = roll.sx, sy = roll.sy, x0 = roll.t2x(3700), y0 = yOf(roll, 66);
  let b = press(roll, x0, y0); moveTo(roll, x0 + 4, y0 + 3, b);
  eq([roll.g.type, roll.sy], ['pan', sy], 'a still finger: not scrolling yet');
  t.mock.timers.tick(500);
  eq(roll.g.type, 'marquee', 'held: a select box');
  moveTo(roll, roll.t2x(4500), yOf(roll, 59), b); release(roll, roll.t2x(4500), yOf(roll, 59), b);
  eq([ids(roll), roll.sx, roll.sy], [[1000, 1001, 1002], sx, sy], 'the three notes in the box; the view held');
  // a second finger while armed: a pinch, the selection put back
  b = press(roll, x0, y0);
  t.mock.timers.tick(500);
  eq(roll.sel.size, 0, 'armed: a new box');
  tp(roll, 'pointerdown', PID + 50, x0 + 200, y0 + 40, { isPrimary: false });
  eq([roll.g.type, ids(roll)], ['pinch', [1000, 1001, 1002]], 'pinch: selection restored');
  lift(roll, PID, PID + 50);
  // a quick drag scrolls (the selection stays); a 7 px wobble doesn't, and is a tap: it deselects
  gest(roll, line(400, 300, 400, 200));
  eq([roll.sy, ids(roll).length], [sy + 100, 3], 'scrolled 100 px');
  gest(roll, line(400, 300, 400, 293));
  eq([roll.sy, roll.sel.size], [sy + 100, 0], 'a 7 px wobble: no scroll; deselected');
});

test('touch: a finger held on a note selects its chord (notes starting with it, a played chord\'s spread too), which then resizes as one', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { roll, tr, log } = mk({ touch: true, notes: [N(3840, 480, 60), N(3840, 480, 64), N(3850, 480, 67), N(4320, 480, 60)] });
  const x = roll.t2x(3840) + 10, y = yOf(roll, 64);
  let b = press(roll, x, y);
  eq(ids(roll), [1001], 'the note first');
  t.mock.timers.tick(500);
  eq(ids(roll), [1000, 1001, 1002], 'held: its chord');
  release(roll, x, y, b);
  eq(ids(roll), [1000, 1001, 1002], 'kept on release');
  log.length = 0;
  const x1 = roll.t2x(4320), y60 = yOf(roll, 60);
  gest(roll, line(x1 + 2, y60, x1 + 2 + 2 * CELL, y60));
  eq(tr.notes.filter(n => n.id !== 1003).map(n => n.d), [960, 960, 960], 'every chord note resized');
  eq(tr.notes.find(n => n.id === 1003).d, 480, 'the next note untouched');
  eq([log.filter(s => s.startsWith('begin')).length, log.filter(s => s === 'end').length], [1, 1], 'one undo step');
  // a hold that moved first is a drag, not a chord select
  roll.selectNone();
  b = press(roll, x, y); moveTo(roll, x, y - 40, b);
  t.mock.timers.tick(500);
  release(roll, x, y - 40, b);
  eq(ids(roll), [1001], 'moved: one note');
});

test('touch: a pause on a note of a larger selection keeps the selection (the drag then resizes every note); with Shift the hold still adds the note\'s chord', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { roll, tr } = mk({ touch: true, notes: [N(3840, 960, 60), N(4800, 960, 62), N(5760, 960, 64), N(6720, 960, 65)] });
  roll.selectAll();
  const x1 = roll.t2x(5760) - 3, y = yOf(roll, 62), b = press(roll, x1, y);
  t.mock.timers.tick(560);
  eq(ids(roll), [1000, 1001, 1002, 1003], 'held: the selection stays');
  moveTo(roll, x1 + CELL, y, b); moveTo(roll, x1 + 4 * CELL, y, b); release(roll, x1 + 4 * CELL, y, b);
  eq(tr.notes.map(n => n.d), [1920, 1920, 1920, 1920], 'every selected note resized');
  eq(ids(roll), [1000, 1001, 1002, 1003], 'still all four');
  // Shift (adds): a hold on a selected note of a larger selection adds its chord
  const c = mk({ touch: true, notes: [N(3840, 480, 60), N(3840, 480, 64), N(5760, 480, 60), N(7680, 480, 60)] });
  c.roll._setSel([1000, 1003]);
  const xc = c.roll.t2x(3840) + 10, bc = press(c.roll, xc, yOf(c.roll, 60), { shiftKey: true });
  t.mock.timers.tick(500);
  release(c.roll, xc, yOf(c.roll, 60), bc);
  eq(ids(c.roll), [1000, 1001, 1003], 'Shift: the chord added, the note kept');
});

test('modifier latches (host.mods / consumeMods): Shift adds to the selection, Fine drags without snap, Alt copies; latched ones are spent by the gesture, locked ones stay, a pinch spends none', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const L = { fine: 0, alt: 0, shift: 0 };
  let spent = 0;
  const host = { mods: e => ({ fine: !!(e && e.shiftKey) || L.fine > 0, alt: !!(e && e.altKey) || L.alt > 0, shift: !!(e && e.shiftKey) || L.shift > 0 }),
    consumeMods: () => { spent++; for (const k in L) if (L[k] === 1) L[k] = 0; } };
  const { roll, tr } = mk({ touch: true, notes: [N(3840, 240, 60), N(4320, 240, 60)], host });
  const y = yOf(roll, 60), cx = t0 => roll.t2x(t0) + CELL / 2;
  tap(roll, cx(3840), y); L.shift = 1; tap(roll, cx(4320), y);
  eq([ids(roll), L.shift], [[1000, 1001], 0], 'Shift: added, then released');
  L.shift = 2; tap(roll, cx(4320), y); tap(roll, cx(3840), y);
  eq([ids(roll).length, L.shift], [0, 2], 'locked Shift: taps take notes out, and it stays');
  L.shift = 0;
  // Fine: a resize without snapping
  L.fine = 1;
  const x1 = roll.t2x(4080);
  gest(roll, line(x1 - 3, y, x1 - 3 + 20, y));
  ok(tr.notes[0].d % 240 !== 0, 'Fine: an unsnapped length ' + tr.notes[0].d);
  eq(L.fine, 0, 'spent');
  tr.notes[0].d = 240; roll.selectNone();
  // Alt: a drag copies
  L.alt = 1;
  gest(roll, line(cx(4320), y, cx(4320) + 2 * CELL, y));
  eq(tr.notes.map(n => n.t).sort((a, b) => a - b), [3840, 4320, 4800], 'Alt: copied');
  // an aborted gesture (a pinch) spends nothing
  L.shift = 1; const s0 = spent;
  tp(roll, 'pointerdown', 1, cx(3840), y, { timeStamp: (T += 1000) }); tp(roll, 'pointerdown', 2, cx(3840) + 200, y + 30);
  lift(roll, 1, 2);
  eq([L.shift, spent], [1, s0], 'kept for the next edit');
});

test('modifier latches: a one-finger scroll of the roll and a press on the key strip spend none (kept for the next edit); a tap on the empty grid and a note edit spend them', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const L = { fine: 0, alt: 0, shift: 0 };
  let spent = 0;
  const host = { mods: () => ({ fine: L.fine > 0, alt: L.alt > 0, shift: L.shift > 0 }), consumeMods: () => { spent++; for (const k in L) if (L[k] === 1) L[k] = 0; } };
  const { roll, log } = mk({ touch: true, notes: [N(3840, 240, 60), N(4320, 240, 60)], host });
  const y = yOf(roll, 60), cx = t0 => roll.t2x(t0) + CELL / 2, ye = yOf(roll, 66);
  tap(roll, cx(3840), y);
  eq(ids(roll), [1000], 'selected');
  L.shift = 1; L.fine = 1;
  let s0 = spent;
  const sx0 = roll.sx, xs = roll.t2x(6000);
  gest(roll, line(xs, ye, xs - 120, ye));
  ok(roll.sx > sx0, 'the finger scrolled the roll: ' + sx0 + ' → ' + roll.sx);
  eq([L.shift, L.fine, spent - s0], [1, 1, 0], 'scroll: kept');
  tap(roll, 30, y);
  ok(log.includes('on60'), 'the key sounded');
  eq([L.shift, L.fine, spent - s0], [1, 1, 0], 'key strip: kept');
  tap(roll, cx(4320), y);
  eq([ids(roll), L.shift, L.fine, spent - s0], [[1000, 1001], 0, 0, 1], 'the next edit: Shift added the note, then both released');
  L.shift = 1; s0 = spent;
  tap(roll, roll.t2x(6000), ye);
  eq([ids(roll), L.shift, spent - s0], [[1000, 1001], 0, 1], 'a tap on the empty grid (Shift: the selection stays) spends it');
});

test('touch thresholds: a 7 px wobble on a note changes nothing; auto-scroll zones (touch 28 px, mouse 6 px); a press inside the zone waits to move toward the edge', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { roll, tr, log } = mk({ touch: true, notes: [N(3840, 960, 60)] });
  const y = yOf(roll, 60), xm = roll.t2x(4100);
  gest(roll, line(xm, y, xm + 7, y));
  eq([tr.notes[0].t, log.filter(s => s.startsWith('begin')).length], [3840, 0], 'wobble: no edit');
  const drag = (r, x0, x1, pt, dy = 0) => {
    const yy = yOf(r, 60), b = press(r, x0, yy, { pointerType: pt });
    moveTo(r, x1, yy + dy, b);
    const v = r._autoDir()[0]; release(r, x1, yy + dy, b); return v;
  };
  roll.selectAll();
  const W = roll.W;
  ok(drag(roll, roll.t2x(4800), W - 20, 'touch') > 0, 'touch: 20 px from the edge scrolls');
  const m = mk({ notes: [N(3840, 960, 60)] });
  m.roll.selectAll();
  eq(drag(m.roll, m.roll.t2x(4800) - 2, W - 20, 'mouse'), 0, 'mouse: not yet');
  // a resize grabbed inside the zone: no scroll until it moves on toward the edge
  tr.notes[0].d = 960; roll.ppt = (W - 20 - GUT) / 4800; roll.sx = 0;
  const xe = roll.t2x(4800);
  eq(Math.round(xe), W - 20, 'the end in the zone');
  eq(drag(roll, xe - 4, xe - 1, 'touch', 5), 0, 'pressed in the zone, 3 px on: waits');
  ok(drag(roll, xe - 4, xe + 4, 'touch') > 0, '8 px toward the edge: scrolls');
});

test('touch / pen reach: a velocity stem 12 px off and a loop edge 12 px off are grabbed by a finger (a mouse misses); a pen resizes 6 px past a selected 1/8 note and draws a select box at once', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const type = (r, x, y, pt) => { const b = press(r, x, y, { pointerType: pt }); const g = r.g && r.g.type; release(r, x, y, b); return g; };
  for (const pt of ['touch', 'mouse']) {
    const { roll, p } = mk({ touch: pt === 'touch', notes: [N(3840, 240, 60, 100)] });
    p.loop.start = 0; p.loop.end = 2 * BAR; p.loop.on = true;
    eq(type(roll, roll.t2x(3840) + 12, roll.v2y(100), pt), pt === 'touch' ? 'vel' : 'velpaint', pt + ': stem');
    eq(type(roll, roll.t2x(2 * BAR) + 12, 12, pt), pt === 'touch' ? 'loopEdge' : 'ruler', pt + ': loop edge');
  }
  const { roll, tr } = mk({ notes: [N(3840, 480, 60)] });
  roll.selectAll();
  const x1 = roll.t2x(4320), y = yOf(roll, 60), pen = { pointerType: 'pen' };
  gest(roll, line(x1 + 6, y, x1 + 6 + 2 * CELL, y), pen);
  eq(tr.notes[0].d, 960, 'pen: resized from 6 px past the end');
  roll.selectNone();
  gest(roll, line(roll.t2x(3700), yOf(roll, 62), roll.t2x(4000), yOf(roll, 59)), pen);
  eq(ids(roll), [1000], 'pen: a select box with no hold');
});

test('touch, a ruler / loop-edge drag a second finger takes over: the loop goes back as at the press, its on flag too (host.restoreLoop; without it setLoop restores the bounds); a finished drag, a pinch before any loop change and a mouse cancel keep it', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const log = [];
  let p = null;
  const host = { setLoop: (s, e) => { log.push('loop ' + s + ' ' + e); Object.assign(p.loop, { start: s, end: e, on: true }); },
    restoreLoop: L => { log.push('restoreLoop ' + JSON.stringify([L.start, L.end, L.on])); Object.assign(p.loop, { start: L.start, end: L.end, on: L.on }); } };
  const m = mk({ touch: true, host }), roll = m.roll;
  p = m.p;
  const lp = () => [p.loop.start, p.loop.end, !!p.loop.on], at = (t0, L0) => { Object.assign(p.loop, { start: L0[0], end: L0[1], on: L0[2] }); log.length = 0; return roll.t2x(t0); };
  // a new loop dragged on the ruler over one that was off, then a second finger lands: back to off, the old bounds
  let x = at(3 * BAR, [0, 2 * BAR, false]);
  tp(roll, 'pointerdown', 1, x, 12); tp(roll, 'pointermove', 1, x + 100, 12);
  ok(p.loop.on && p.loop.start === 3 * BAR, 'the drag set a loop: ' + lp());
  tp(roll, 'pointerdown', 2, x + 300, 200);
  eq([lp(), log[log.length - 1], roll.g && roll.g.type], [[0, 2 * BAR, false], 'restoreLoop ' + JSON.stringify([0, 2 * BAR, false]), 'pinch'], 'restored; the pinch goes on');
  lift(roll, 1, 2);
  // a loop edge dragged, then the second finger
  x = at(2 * BAR, [0, 2 * BAR, true]);
  tp(roll, 'pointerdown', 1, x + 6, 12); tp(roll, 'pointermove', 1, x + 106, 12);
  eq([roll.g && roll.g.type, p.loop.end > 2 * BAR], ['loopEdge', true], 'the edge moved');
  tp(roll, 'pointerdown', 2, x + 300, 200);
  eq(lp(), [0, 2 * BAR, true], 'edge restored');
  lift(roll, 1, 2);
  // a press on the ruler, then the second finger before the loop changed: nothing to restore
  x = at(3 * BAR, [0, 2 * BAR, false]);
  tp(roll, 'pointerdown', 1, x, 12); tp(roll, 'pointerdown', 2, x + 300, 200);
  eq([lp(), log.join('|')], [[0, 2 * BAR, false], ''], 'untouched, no call');
  lift(roll, 1, 2);
  // a finished drag keeps its loop
  x = at(3 * BAR, [0, 2 * BAR, false]);
  tp(roll, 'pointerdown', 1, x, 12); tp(roll, 'pointermove', 1, x + 100, 12); tp(roll, 'pointerup', 1, x + 100, 12);
  eq([p.loop.start, p.loop.on, log.some(s => s.startsWith('restoreLoop'))], [3 * BAR, true, false], 'kept');
  // a mouse drag cut short (pointercancel) keeps it too (no takeover by fingers)
  x = at(3 * BAR, [0, 2 * BAR, false]);
  const b = { pointerId: 77, pointerType: 'mouse', isPrimary: true, button: 0 };
  dom.ptr(roll.el, 'pointerdown', x, 12, Object.assign({ timeStamp: (T += 400) }, b)); dom.ptr(roll.el, 'pointermove', x + 100, 12, Object.assign({ timeStamp: (T += 16) }, b));
  dom.ptr(roll.el, 'pointercancel', x + 100, 12, Object.assign({ timeStamp: (T += 16) }, b));
  eq([p.loop.start, p.loop.on, log.some(s => s.startsWith('restoreLoop'))], [3 * BAR, true, false], 'mouse: kept');
  // without host.restoreLoop the bounds come back through setLoop
  delete roll.host.restoreLoop;
  x = at(3 * BAR, [0, 2 * BAR, true]);
  tp(roll, 'pointerdown', 1, x, 12); tp(roll, 'pointermove', 1, x + 100, 12); tp(roll, 'pointerdown', 2, x + 300, 200);
  eq([lp(), log[log.length - 1]], [[0, 2 * BAR, true], 'loop 0 ' + 2 * BAR], 'bounds via setLoop');
  lift(roll, 1, 2);
});

test('touch readout: during a finger drag the length floats above the finger (with a guide line), a mouse keeps the corner readout', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const pt of ['touch', 'mouse']) {
    const { roll } = mk({ touch: pt === 'touch', notes: [N(3840, 480, 60)] });
    roll.selectAll();
    const x1 = roll.t2x(4320), y = yOf(roll, 60), ctx = roll.el.getContext('2d');
    const b = press(roll, x1 - 2, y, { pointerType: pt }); moveTo(roll, x1 + 40, y, b);
    ctx.calls.length = 0; F();
    const txt = ctx.calls.filter(c => c[0] === 'fillText' && /^C4/.test(String(c[1]))).map(c => [String(c[1]), Math.round(c[2]), Math.round(c[3])]);
    const guide = ctx.calls.some(c => c[0] === 'fillRect' && c[1] === Math.round(roll.t2x(roll.g.note.t + roll.g.note.d)) && c[2] === RUL && c[3] === 1);
    ctx.calls.length = 0;
    release(roll, x1 + 40, y, b);
    eq(txt.length, 1, pt + ': one readout');
    if (pt === 'touch') ok(/^C4 {2}L \d+\.\d+\.\d{3}$/.test(txt[0][0]) && txt[0][2] < y - 40 && txt[0][1] > GUT && guide, 'touch: floats above the finger, guide line ' + txt[0]);
    else eq([txt[0].slice(1), guide], [[6, 8], false], 'mouse: the corner, no guide');
  }
});

test('reveal(t): the arrangement\'s double-tapped bar comes into view near the left; one already in view stays put', () => {
  const { roll } = mk();
  roll.zoomX(4);
  roll.reveal(10 * BAR);
  const x = roll.t2x(10 * BAR);
  ok(x >= GUT && x < GUT + roll.gw * 0.1, 'near the left: ' + x);
  const sx = roll.sx;
  roll.reveal(10 * BAR + BAR / 2);
  eq(roll.sx, sx, 'in view: no scroll');
});

test('arrangement, touch: a double-tap 18 px apart opens the track at the tapped bar (a mouse needs 10 px); a tap shows where notes are edited; beats when zoomed in; a 32 px edge zone', () => {
  const doc = dom.fresh(); globalThis.window = doc.defaultView; dom.raf.install();
  const p = S.newProject({ model: 'x', name: 't' }), opened = [], ranges = [];
  const box = doc.createElement('div'); doc.body.appendChild(box); dom.place(box, 0, 0, 800, 200);
  const arr = new Arrangement(box, { getProject: () => p, getPlayhead: () => 0, setPlayhead: () => {}, setLoop: () => {}, getRange: () => null,
    setRange: (s, e) => ranges.push([s, e]), selectTrack: () => {}, openTrack: (id, t0) => opened.push([id, t0]), rowHeight: 56 });
  dom.place(arr.el, 0, 0, 800, 80); dom.raf.flush(1);
  const pt = (type, id) => ({ pointerId: id, pointerType: type, isPrimary: true });
  const tapA = (x, type) => { const id = ++PID; dom.ptr(arr.el, 'pointerdown', x, 50, pt(type, id)); dom.ptr(arr.el, 'pointerup', x, 50, pt(type, id)); };
  tapA(300, 'mouse'); tapA(318, 'mouse');
  eq([opened.length, !!arr.tip], [0, false], 'mouse: 18 px apart is two clicks; no tip');
  arr.tap = null;
  tapA(300, 'touch');
  ok(arr.tip && arr.tip.row === 0, 'touch: a tap shows the tip');
  tapA(318, 'touch');
  eq([opened.length, opened[0][0], opened[0][1], !!arr.tip], [1, p.tracks[0].id, Math.floor(arr.xt(300) / BAR) * BAR, false], 'opened at the tapped bar, tip gone');
  // zoomed in (a bar ≥ 160 px): a finger's range snaps to beats; a mouse to bars
  arr.auto = false; arr.ppt = 0.05; arr.x0 = 0;
  for (const type of ['touch', 'mouse']) {
    ranges.length = 0; const id = ++PID;
    dom.ptr(arr.el, 'pointerdown', 100, 50, pt(type, id)); dom.ptr(arr.el, 'pointermove', 300, 50, pt(type, id)); dom.ptr(arr.el, 'pointerup', 300, 50, pt(type, id));
    eq(ranges[ranges.length - 1], type === 'touch' ? [1920, 6720] : [0, 7680], type + ': range grid');
  }
  // edge auto-scroll zone: 32 px for a finger (16 px mouse); a drag that starts inside it waits to move outward
  const x00 = arr.x0;
  eq(arr.edgeScroll(775, { touch: false, x: 400 }), false, 'mouse: 25 px from the edge, no scroll');
  ok(arr.edgeScroll(775, { touch: true, x: 400 }) && arr.x0 > x00, 'touch: scrolls');
  const x01 = arr.x0;
  eq([arr.edgeScroll(780, { touch: true, x: 778 }), arr.x0], [false, x01], 'pressed in the zone: waits');
  ok(arr.edgeScroll(784, { touch: true, x: 778 }), 'moved on toward the edge: scrolls');
  arr.destroy();
});

test('arrangement, two-finger takeover: the flagged pointercancel (gesture.js) and the canvas\'s own pinch restore the range, the loop and the selected track; a plain cancel keeps them; stale touches; lost capture', () => {
  const doc = dom.fresh(); globalThis.window = doc.defaultView; dom.raf.install();
  const p = S.newProject({ model: 'x', name: 't' });
  p.tracks.push(S.newTrack(p, { model: 'x' }));
  const [t0, t1] = p.tracks.map(t => t.id), log = [];
  let rng = null;
  const box = doc.createElement('div'); doc.body.appendChild(box); dom.place(box, 0, 0, 800, 200);
  const host = { getProject: () => p, getPlayhead: () => 0, setPlayhead: t => log.push('seek ' + t), getRange: () => rng, openTrack: () => {}, rowHeight: 56,
    setLoop: (s, e) => { log.push('loop ' + s + ' ' + e); Object.assign(p.loop, { start: s, end: e, on: true }); },
    restoreLoop: L => { log.push('restoreLoop ' + JSON.stringify(L)); Object.assign(p.loop, L); },
    setRange: (s, e) => { rng = s == null ? null : [s, e]; log.push('range ' + s + ' ' + e); },
    selectTrack: id => { log.push('select ' + id); p.selTrack = id; } };
  const arr = new Arrangement(box, host);
  dom.place(arr.el, 0, 0, 800, 136); dom.raf.flush(1);
  eq(arr.el.getAttribute('data-gesture'), 'own', 'the canvas owns its two-finger pinch');
  const T = (type, x, y, id, o = {}) => dom.ptr(arr.el, type, x, y, Object.assign({ pointerId: id, pointerType: 'touch', isPrimary: true }, o));
  const TWO = { gesture: 'two-finger' };
  // a lane drag on track 2 (selects it at the first move, sets a range), then a second finger elsewhere: all undone
  let id = ++PID;
  T('pointerdown', 100, 100, id); T('pointermove', 300, 100, id);
  eq([p.selTrack, !!rng], [t1, true], 'the drag selected track 2 and set a range');
  log.length = 0;
  T('pointercancel', 300, 100, id, TWO);
  eq([p.selTrack, rng, log.join('|'), arr.g], [t0, null, 'range null null|select ' + t0, null], 'restored');
  // a plain cancel (a native scroll took the touch) keeps what the drag did
  id = ++PID;
  T('pointerdown', 100, 100, id); T('pointermove', 300, 100, id); T('pointercancel', 300, 100, id);
  eq([p.selTrack, !!rng], [t1, true], 'plain cancel keeps');
  // a ruler drag over a loop that was off: restoreLoop gets the loop as it was (bounds and the off flag)
  host.selectTrack(t0); rng = null;
  Object.assign(p.loop, { on: false, start: 0, end: 7680 });
  const L0 = JSON.stringify(p.loop);
  id = ++PID;
  T('pointerdown', 400, 10, id); T('pointermove', 600, 10, id);
  ok(p.loop.on && p.loop.start > 0, 'the drag set a loop');
  log.length = 0;
  T('pointercancel', 600, 10, id, TWO);
  eq([JSON.stringify(p.loop), log.join('|')], [L0, 'restoreLoop {"start":0,"end":7680,"on":false}'], 'loop restored');
  // without restoreLoop the host's setLoop puts the bounds back
  delete host.restoreLoop; log.length = 0;
  id = ++PID;
  T('pointerdown', 400, 10, id); T('pointermove', 600, 10, id); T('pointercancel', 600, 10, id, TWO);
  eq(log[log.length - 1], 'loop 0 7680', 'bounds via setLoop');
  // the canvas's own pinch: a second finger on the canvas undoes the first finger's drag before zooming
  Object.assign(p.loop, { on: true, start: 0, end: 7680 });
  host.selectTrack(t0); rng = null;
  const a = ++PID, b = ++PID;
  T('pointerdown', 100, 100, a); T('pointermove', 300, 100, a);
  eq([p.selTrack, !!rng], [t1, true], 'dragging');
  T('pointerdown', 500, 100, b, { isPrimary: false });
  eq([arr.g && arr.g.kind, p.selTrack, rng], ['pinch', t0, null], 'pinch; drag undone');
  T('pointerup', 500, 100, b, { isPrimary: false }); T('pointerup', 300, 100, a);
  eq(arr.g, null, 'pinch over');
  // a touch whose pointerup never came: a primary touch forgets it (no phantom pinch)
  T('pointerdown', 100, 100, ++PID);
  T('pointerdown', 200, 100, ++PID);
  eq([arr.g && arr.g.kind, arr.pts.size], ['lane', 1], 'stale touch forgotten');
  // a lost capture ends the drag as a cancel (no tap: no seek)
  log.length = 0;
  dom.fire(arr.el, 'lostpointercapture', { pointerId: PID, pointerType: 'touch' });
  eq([arr.g, log.join('|')], [null, ''], 'lost capture: ended, nothing committed');
  arr.destroy();
});

/* ------------------------------------------------------------------ 7a: drum rows (IMPL-7a §4.2; lane H2) */
// a drum track's host: host.drumRows(track) → the drum machine's rows (drumRowsOf: the map's primaries, kick first) for
// the tracks marked drum, null for the others (main.js wires it from the track's instrument device)
const DMAP = () => JSON.parse(JSON.stringify(DC.DEFAULT_MAP));
function mkDrum(o = {}) {
  const map = o.map || (o.model === 'tr606' ? JSON.parse(JSON.stringify(DC.MAP606)) : o.model === 'tr909' ? JSON.parse(JSON.stringify(DC.MAP909)) : DMAP()), dev = { model: o.model || 'tr808', drum: { map } };
  const r = mk(Object.assign({}, o, { host: Object.assign({ drumRows: t => (t && t.drum !== false ? drumRowsOf(dev) : null) }, o.host) }));
  r.dev = dev;
  return r;
}
const rowY = (roll, r) => roll.r2y(r) + roll.rowH / 2;
// the text the next frame draws (the back canvas's fillText calls)
const frameTexts = roll => { roll.bctx.calls.length = 0; roll.render(); F(); return roll.bctx.calls.filter(c => c[0] === 'fillText').map(c => String(c[1])); };
const MOUSE = { pointerType: 'mouse' };
// the default map's rows from the bottom (row 16 … row 1): Kick 36, Snare 38, Low tom 41, Mid tom 45, Hi tom 48, Rim shot 37,
// Hand clap 39, Cowbell 56, Cymbal 49, Open hat 46, Closed hat 42, Low conga 64, Mid conga 63, Hi conga 62, Claves 75, Maracas 70;
// "Other" is row 0
const ORDER = [36, 38, 41, 45, 48, 37, 39, 56, 49, 46, 42, 64, 63, 62, 75, 70];

test('7a drumRowsOf: a drum machine\'s device → its mapped primaries, kick first ({ n, name }); null for any other model (and __proto__)', () => {
  const rows = drumRowsOf({ model: 'tr808' });
  eq(rows.map(e => e.n), ORDER, 'the default map\'s primaries');
  eq(rows.slice(0, 3), [{ n: 36, name: 'Kick' }, { n: 38, name: 'Snare' }, { n: 41, name: 'Low tom' }], 'named');
  const map = DMAP(); map.sd = [40, 38]; map.cb = [];
  const r2 = drumRowsOf({ model: 'tr808', drum: { map } });
  eq([r2.length, r2[1], r2.some(e => e.name === 'Cowbell')], [15, { n: 40, name: 'Snare' }, false], 'a re-mapped snare; an unmapped cowbell has no row');
  for (const d of [null, undefined, 7, {}, { model: 'juno60', drum: { map } }, { model: '__proto__' }, { model: 'toString' }]) eq(drumRowsOf(d), null, JSON.stringify(d));
});

// (7b, IMPL-7b §4) the TR-606's rows: its seven sounds' primaries, kick first — Kick 36, Snare 38, Low tom 41, Hi tom 48, Cymbal 49,
// Open hat 46, Closed hat 42 (the 808's primaries: a pattern moved between the machines plays the same drums)
const ORDER6 = [36, 38, 41, 48, 49, 46, 42], NAMES6 = ['Kick', 'Snare', 'Low tom', 'Hi tom', 'Cymbal', 'Open hat', 'Closed hat'];
test('7b drumRowsOf: a TR-606\'s device → its seven rows, kick first; a re-mapped sound moves its row; an 808 map on a 606 gives no 808-only sound a row; the 808\'s sixteen are unchanged', () => {
  const rows = drumRowsOf({ model: 'tr606' });
  eq(rows, ORDER6.map((n, i) => ({ n, name: NAMES6[i] })), 'no record: the 606\'s default map');
  eq(drumRowsOf({ model: 'tr606', drum: DC.normDrum(undefined, 'tr606') }), rows, 'a fresh 606 record: the same');
  const map = JSON.parse(JSON.stringify(DC.MAP606)); map.sd = [40, 38]; map.lt = [41, 43]; map.ht = [45, 50, 47]; // (a key belongs to one sound: 45 leaves the low tom)
  const r2 = drumRowsOf({ model: 'tr606', drum: { map } });
  eq([r2.length, r2[1], r2[3], r2.map(e => e.name)], [7, { n: 40, name: 'Snare' }, { n: 45, name: 'Hi tom' }, NAMES6], 'a re-mapped snare and hi tom keep their rows (HT on 45: not the 808\'s mid tom)');
  eq(drumRowsOf({ model: 'tr606', drum: { map: DMAP() } }).map(e => e.name), NAMES6, 'an 808\'s sixteen-sound map on a 606: its seven only');
  eq([drumRowsOf({ model: 'tr808' }).length, drumRowsOf({ model: 'tr808' }).map(e => e.n)], [16, ORDER], 'the 808 is as it was');
});

test('7b drum rows on a TR-606: seven named rows + "Other", kick at the bottom, the gutter names them; a vertical drag moves between the seven — never into "Other"; the 808-only keys sit in "Other"', () => {
  const { roll, tr } = mkDrum({ model: 'tr606', notes: [N(0, 120, 36), N(480, 120, 38), N(960, 120, 37), N(1440, 120, 45)], rollRowH: 56 });
  eq([roll.isDrum(), roll.drumRows().on, roll.drumRows().rows.length, roll._nRows(), roll.gut], [true, true, 7, 8, 120]);
  eq(ORDER6.map(n => roll._row(n)), [7, 6, 5, 4, 3, 2, 1], 'kick the bottom row (7), the closed hat row 1');
  eq([roll._row(37), roll._row(45), roll._row(60), roll._noteAt(0), roll._noteAt(7), roll._lab(36), roll._lab(48), roll._lab(37)], [0, 0, 0, -1, 36, 'Kick 36', 'Hi tom 48', 'C#2'],
    'the rim shot, the 808\'s mid tom, middle C: "Other" (an alias too)');
  dom.fire(roll.el, 'wheel', { deltaY: -5000, clientX: 400, clientY: 200 });
  const tx = frameTexts(roll);
  for (const s of ['Other', ...NAMES6, '36', '42']) ok(tx.includes(s), 'the gutter names ' + s);
  for (const s of ['Mid tom', 'Rim shot', 'Cowbell', 'Maracas']) ok(!tx.includes(s), 'no row for ' + s);
  const sn = tr.notes.find(x => x.n === 38), x = roll.t2x(480 + 60), h = roll.rowH;
  for (const o of [MOUSE, {}]) {
    sn.n = 38;
    gest(roll, line(x, rowY(roll, 6), x, rowY(roll, 5)), o);
    eq(sn.n, 41, 'the snare up one row: Low tom');
    gest(roll, line(x, roll.n2y(41) + h / 2, x, roll.n2y(41) + h / 2 + 2 * h), o);
    eq(sn.n, 36, 'down two rows: Kick');
    gest(roll, line(x, roll.n2y(36) + h / 2, x, roll.n2y(36) + h / 2 - 30 * h, 12), o);
    eq(sn.n, 42, 'up past the top named row: Closed hat (row 1), never "Other"');
  }
  const d2 = mkDrum({ model: 'tr606', notes: [N(0, 480, 38), N(480, 480, 60)] });
  const ns = () => d2.tr.notes.map(y => y.n);
  d2.roll.selectAll();
  d2.roll.nudge(0, -1);
  eq(ns(), [36, 42], 'down one row: the snare to Kick, 60 onto the closed hat (the top named row)');
  d2.roll.nudge(0, -40);
  eq(ns(), [36, 42], 'clamped at the kick');
});

// (7c, IMPL-7c §4) the TR-909's rows: its eleven sounds' primaries, kick first — Kick 36, Snare 38, Low tom 41, Mid tom 45, Hi tom 48, Rim shot 37,
// Hand clap 39, **Ride 51, Crash 49** (sound ids 7 and 8: the 808's cowbell and cymbal slots, the 909 has neither), Open hat 46, Closed hat 42
const ORDER9 = [36, 38, 41, 45, 48, 37, 39, 51, 49, 46, 42], NAMES9 = ['Kick', 'Snare', 'Low tom', 'Mid tom', 'Hi tom', 'Rim shot', 'Hand clap', 'Ride', 'Crash', 'Open hat', 'Closed hat'];
test('7c drumRowsOf: a TR-909\'s device → its eleven rows, kick first, Ride and Crash on sound ids 7 and 8; a re-mapped sound moves its row; the 808\'s sixteen and the 606\'s seven are unchanged', () => {
  const rows = drumRowsOf({ model: 'tr909' });
  eq(rows, ORDER9.map((n, i) => ({ n, name: NAMES9[i] })), 'no record: the 909\'s default map (the 808\'s id 7 is a Cowbell, 8 a Cymbal: not here)');
  eq(drumRowsOf({ model: 'tr909', drum: DC.normDrum(undefined, 'tr909') }), rows, 'a fresh 909 record: the same');
  const map = JSON.parse(JSON.stringify(DC.MAP909)); map.sd = [40, 38]; map.rd = [53, 51]; map.ch = [];
  const r2 = drumRowsOf({ model: 'tr909', drum: { map } });
  eq([r2.length, r2[1], r2[7], r2.some(e => e.name === 'Closed hat'), r2.map(e => e.name).join()], [10, { n: 40, name: 'Snare' }, { n: 53, name: 'Ride' }, false, NAMES9.slice(0, 10).join()],
    'a re-mapped snare and ride keep their rows; an unmapped closed hat has none');
  eq(drumRowsOf({ model: 'tr909', drum: { map: DMAP() } }).map(e => e.name), NAMES9, 'an 808\'s sixteen-sound map on a 909: its eleven only (no 808-only sound gets a row)');
  eq([drumRowsOf({ model: 'tr808' }).length, drumRowsOf({ model: 'tr808' }).map(e => e.n), drumRowsOf({ model: 'tr606' }).map(e => e.n)], [16, ORDER, ORDER6], 'the 808 and the 606 are as they were');
  eq([drumRowsOf({ model: 'tr808' })[7].name, drumRowsOf({ model: 'tr808' })[8].name, drumRowsOf({ model: 'tr606' })[4].name], ['Cowbell', 'Cymbal', 'Cymbal'], 'ids 7 / 8 keep the 808\'s names there');
});

test('7c drum rows on a TR-909: eleven named rows + "Other", kick at the bottom, the gutter names them (Ride, Crash); a vertical move steps between the eleven — Ride up is Crash, never an 808-only row; the 808-only keys sit in "Other"', () => {
  const { roll } = mkDrum({ model: 'tr909', notes: [N(0, 120, 36), N(480, 120, 51), N(960, 120, 49), N(1440, 120, 56)], rollRowH: 32 });
  eq([roll.isDrum(), roll.drumRows().on, roll.drumRows().rows.length, roll._nRows(), roll.gut], [true, true, 11, 12, 120]);
  eq(ORDER9.map(n => roll._row(n)), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 'kick the bottom row (11), the closed hat row 1; ride row 4 under crash row 3');
  eq([roll._row(56), roll._row(59), roll._row(57), roll._row(35), roll._row(60), roll._noteAt(0), roll._noteAt(4), roll._noteAt(3), roll._lab(36), roll._lab(51), roll._lab(49), roll._lab(56)],
    [0, 0, 0, 0, 0, -1, 51, 49, 'Kick 36', 'Ride 51', 'Crash 49', 'G#3'], 'the 808\'s cowbell key, the ride and crash aliases (59, 57), middle C: "Other"');
  dom.fire(roll.el, 'wheel', { deltaY: -5000, clientX: 400, clientY: 200 });
  const tx = frameTexts(roll);
  for (const s of ['Other', ...NAMES9, '36', '51', '49']) ok(tx.includes(s), 'the gutter names ' + s);
  for (const s of ['Cowbell', 'Cymbal', 'Low conga', 'Claves', 'Maracas']) ok(!tx.includes(s), 'no row for ' + s);
  const d2 = mkDrum({ model: 'tr909', notes: [N(0, 480, 36), N(480, 480, 51), N(960, 480, 49)] });
  const ns = () => d2.tr.notes.map(y => y.n);
  d2.roll.selectAll();
  d2.roll.nudge(0, 1);
  eq(ns(), [38, 49, 46], 'up one row: kick to snare, ride to crash, crash to open hat');
  d2.roll.nudge(0, -1);
  eq(ns(), [36, 51, 49], 'and back down');
  d2.roll.nudge(0, -40);
  eq(ns(), [36, 51, 49], 'clamped at the kick');
});

test('7a drum rows (compact, the default): the named rows only, kick at the bottom, "Other" on top; the gutter names them; the scroll extent is the table\'s; a synth track keeps the piano', () => {
  const { roll, tr, setTrack } = mkDrum({ notes: [N(0, 120, 36), N(480, 120, 38), N(960, 120, 60)], rollRowH: 56 });
  eq([roll.isDrum(), roll.drumRows().on, roll.drumRows().rows.length, roll._nRows(), roll.gut, roll.gw], [true, true, 16, 17, 120, 900 - 120]);
  eq(ORDER.map(n => roll._row(n)), ORDER.map((_, i) => 16 - i), 'kick the bottom row (16), maracas row 1');
  eq([roll._row(60), roll._row(35), roll._noteAt(0), roll._noteAt(16), roll._lab(36), roll._lab(60), roll._lab(-1)], [0, 0, -1, 36, 'Kick 36', 'C4', 'Other'], 'every other note (an alias too) in "Other"');
  eq(roll.n2y(36) - roll.n2y(38), 56, 'one row apart');
  // the scroll extent: 17 rows of 56 px, both ways
  dom.fire(roll.el, 'wheel', { deltaY: 5000, clientX: 400, clientY: 200 });
  eq(roll.sy, 17 * 56 - roll.gh, 'scrolled to the end of the rows, not of 128');
  let tx = frameTexts(roll);
  for (const s of ['Kick', 'Snare', 'Cowbell', '36', '38']) ok(tx.includes(s), 'the gutter names ' + s);
  dom.fire(roll.el, 'wheel', { deltaY: -5000, clientX: 400, clientY: 200 });
  eq(roll.sy, 0);
  tx = frameTexts(roll);
  for (const s of ['Other', 'Maracas', '70', 'Claves']) ok(tx.includes(s), 'the top: ' + s);
  ok(!tx.includes('C2') && !tx.includes('C3'), 'no C labels in the gutter');
  // a synth track: the piano, its 64 px gutter
  setTrack({ id: 'S', drum: false, notes: [] });
  eq([roll.isDrum(), roll.drumRows(), roll._nRows(), roll.gut, roll.n2y(60) - roll.n2y(61)], [false, null, 128, 64, 56]);
  setTrack(tr);
  eq([roll.isDrum(), roll._nRows(), roll.gut], [true, 17, 120], 'back on the drum track');
  // the "Drum rows" choice set while a synth track shows: its view stays, the next drum track opens with it
  setTrack({ id: 'S', drum: false, notes: [N(0, 480, 60)] });
  const v0 = [roll.sy, roll.rowH, roll._nRows()];
  roll.setDrumRows(false);
  eq([roll.sy, roll.rowH, roll._nRows()], v0, 'a synth track: untouched');
  setTrack(tr);
  eq([roll.drumRows().on, roll._nRows()], [false, 128], 'the drum track: the full keyboard');
});

test('7a review 2 #8: the compact drum rows fill the grid\'s height (up to 32 px with a mouse, 44 px on touch; never below the touch minimum), and refit on a resize; a chosen row height wins; the piano keeps its default rows', () => {
  for (const [w, h, touch] of [[1024, 700, true], [1440, 520, false], [900, 1200, true], [900, 1200, false], [600, 260, true]]) {
    const { roll, setTrack } = mkDrum({ w, h, touch, notes: [N(0, 120, 36)] });
    const want = Math.min(touch ? 44 : 32, Math.max(touch ? 14 : 5, Math.floor(roll.gh / 17)));
    eq([roll._nRows(), roll.rowH], [17, want], `${w}×${h} ${touch ? 'touch' : 'mouse'}: grid ${roll.gh} px`);
    if (want * 17 <= roll.gh) eq(roll.sy, 0, 'all the rows in view');
    setTrack({ id: 'S', drum: false, notes: [] });
    const ref = mk({ w, h, touch }); ref.setTrack({ id: 'S2', notes: [] });
    eq(roll.rowH, ref.roll.rowH, 'a synth track: the piano\'s rows as on a roll that never showed drums');
    if (h >= 520) eq(roll.rowH, touch ? 18 : 12, 'the default');
  }
  // a resize (the iPad turned): the rows refit
  const { roll, doc } = mkDrum({ w: 1024, h: 400, touch: true });
  const h0 = roll.rowH;
  dom.place(roll.box, 0, 0, 1024, 800); dom.place(roll.el, 0, 0, 1024, 800); roll.resize(); F();
  ok(roll.rowH > h0 && roll.rowH === Math.min(44, Math.floor(roll.gh / 17)), `refit: ${h0} → ${roll.rowH} (grid ${roll.gh})`);
  void doc;
  // a chosen row height wins
  eq(mkDrum({ w: 1024, h: 700, touch: true, rollRowH: 20 }).roll.rowH, 20, 'the stored choice');
});

test('7a drum rows: a vertical drag moves between drum rows (mouse and touch) — never into "Other"; a note in "Other" moves onto the rows and back keeps its pitch; nudge by rows', () => {
  for (const o of [MOUSE, {}]) {
    const touch = !o.pointerType, at = touch ? 'touch' : 'mouse';
    const { roll, tr } = mkDrum({ notes: [N(0, 480, 38), N(1920, 480, 60)], touch });
    const sn = tr.notes.find(x => x.n === 38), ot = tr.notes.find(x => x.n === 60), x = roll.t2x(240), h = roll.rowH;
    gest(roll, line(x, rowY(roll, 15), x, rowY(roll, 14)), o);
    eq(sn.n, 41, at + ': the snare up one row: Low tom');
    gest(roll, line(x, roll.n2y(41) + h / 2, x, roll.n2y(41) + h / 2 + 2 * h), o);
    eq(sn.n, 36, at + ': down two rows: Kick');
    gest(roll, line(x, roll.n2y(36) + h / 2, x, roll.n2y(36) + h / 2 + 5 * h), o);
    eq(sn.n, 36, at + ': below the kick: stays');
    gest(roll, line(x, roll.n2y(36) + h / 2, x, roll.n2y(36) + h / 2 - 30 * h, 12), o);
    eq(sn.n, 70, at + ': up past the top named row: Maracas (row 1), never "Other"');
    // "Other": 60 moved down one row (the top named row), then back up in the same drag → its own pitch again
    const x2 = roll.t2x(2100), y0 = rowY(roll, 0);
    gest(roll, [[x2, y0], [x2, y0 + 0.5 * h], [x2, y0 + h], [x2, y0 + 1.5 * h], [x2, y0 + 0.4 * h], [x2, y0]], o);
    eq(ot.n, 60, at + ': down and back: 60');
    gest(roll, line(x2, y0, x2, y0 + 3 * h), o);
    eq(ot.n, 62, at + ': three rows down from "Other": Hi conga (row 3)');
  }
  const { roll, tr } = mkDrum({ notes: [N(0, 480, 38), N(480, 480, 60)] });
  const ns = () => tr.notes.map(x => x.n);
  roll.selectAll();
  roll.nudge(0, 1);
  eq(ns(), [38, 60], 'up one row: "Other" has nowhere up, so the selection stays (one clamp for all, as the piano\'s)');
  roll.nudge(0, -1);
  eq(ns(), [36, 70], 'down one row: the snare to Kick, 60 onto Maracas');
  roll.nudge(0, -40);
  eq(ns(), [36, 70], 'clamped at the kick');
  roll.selectPitch(36);
  roll.nudge(0, 2);
  eq(ns(), [41, 70], 'the kick up two rows: Low tom');
});

test('7a drum rows: drawing / adding on a drum row writes its note (v 100); "Other" writes nothing; the key strip plays a row\'s note ("Other" none) and a double-tap selects the row', () => {
  const { roll, tr, log } = mkDrum({ notes: [N(3840, 120, 60), N(4800, 120, 61)] });
  const at = t => tr.notes.filter(n => n.t === t).map(n => [n.n, n.v]);
  // a double-click on the snare row adds a snare; on "Other" nothing
  const x = roll.t2x(960) + 2;
  tap2(roll, x, rowY(roll, 15), x, rowY(roll, 15), MOUSE);
  eq(at(960), [[38, 100]], 'double-click: a snare');
  tap2(roll, roll.t2x(1920) + 2, rowY(roll, 0), roll.t2x(1920) + 2, rowY(roll, 0), MOUSE);
  eq(at(1920), [], '"Other": nothing');
  roll.setTool('draw');
  tap(roll, roll.t2x(2880) + 2, rowY(roll, 16), MOUSE);
  eq(at(2880), [[36, 100]], 'draw on the kick row');
  tap(roll, roll.t2x(2400) + 2, rowY(roll, 0), MOUSE);
  eq(at(2400), [], 'draw on "Other": nothing');
  gest(roll, line(roll.t2x(1440) + 2, rowY(roll, 16), roll.t2x(1440) + 2, rowY(roll, 14)), MOUSE);
  eq(at(1440), [[41, 100]], 'draw and drag up two rows: Low tom');
  roll.setTool('select');
  // the key strip
  log.length = 0;
  tap(roll, 30, rowY(roll, 16), MOUSE);
  tap(roll, 30, rowY(roll, 0), MOUSE);
  eq(log, ['on36', 'off36'], 'the kick sounds; "Other" sounds nothing');
  tap2(roll, 30, rowY(roll, 0), 30, rowY(roll, 0), MOUSE);
  eq([...roll.sel].map(id => tr.notes.find(n => n.id === id).n).sort(), [60, 61], 'a double-tap on "Other" selects its notes');
  // the readout names the row
  roll._hover(roll.t2x(100), rowY(roll, 16), true);
  eq(roll._info()[0], 'Kick 36');
  roll._hover(roll.t2x(100), rowY(roll, 0), true);
  eq(roll._info()[0], 'Other');
});

test('7a "Drum rows" off: the full keyboard with the drum rows named in the gutter and the rows no sound plays dimmed; on again; the velocity lane\'s 100 / 127 lines; a map edit is noticed', () => {
  const { roll, tr, dev } = mkDrum({ notes: [N(0, 120, 36), N(480, 120, 60)], rollRowH: 18 });
  roll.setDrumRows(false);
  eq([roll.isDrum(), roll.drumRows().on, roll._nRows(), roll.gut, roll.n2y(36) - roll.n2y(37)], [true, false, 128, 120, 18], 'the piano, the wide gutter');
  eq([roll._row(60), roll._lab(36), roll._lab(60)], [67, 'Kick 36', 'C4']);
  roll.sy += roll.n2y(60) - 30; roll.clampY();
  const tx = frameTexts(roll);
  ok(tx.includes('Kick 36') && tx.includes('Snare 38'), 'named plates');
  const R = roll.rowH, G = roll.gut;
  ok(roll.bctx.calls.some(c => c[0] === 'rect' && c[1] === 0 && c[3] === G - 1 && c[4] === R && Math.abs(c[2] - roll.n2y(40)) < 0.01), 'an unmapped row (40) dimmed in the gutter');
  ok(!roll.bctx.calls.some(c => c[0] === 'rect' && c[1] === 0 && c[3] === G - 1 && c[4] === R && Math.abs(c[2] - roll.n2y(38)) < 0.01), 'a named row (38) not');
  // a drag in the piano moves by semitones
  const n0 = tr.notes.find(x => x.n === 60), x = roll.t2x(540);
  gest(roll, line(x, yOf(roll, 60), x, yOf(roll, 60) - R), MOUSE);
  eq(n0.n, 61, 'the piano: a semitone');
  roll.setDrumRows(true);
  eq([roll.drumRows().on, roll._nRows()], [true, 17], 'compact again');
  // the velocity lane: the normal (100) and accent (127) lines on a drum track, and the corner label
  frameTexts(roll);
  const vline = v => roll.bctx.calls.some(c => c[0] === 'fillRect' && c[1] === roll.gut && c[2] === Math.round(roll.v2y(v)) && c[4] === 1);
  eq(vline(100), true);
  ok(roll.bctx.calls.some(c => c[0] === 'fillText' && c[1] === '100'), 'the 100 label');
  // the map edited elsewhere (MAP…: snare to 40): the next frame re-reads the rows; refreshRows does it at once
  dev.drum.map.sd = [40, 38];
  frameTexts(roll);
  eq([roll._row(40), roll._row(38), roll._lab(40)], [15, 0, 'Snare 40'], 'the snare row on 40, 38 in "Other"');
  dev.drum.map.sd = [38];
  roll.refreshRows();
  eq(roll._row(38), 15);
  // a synth track draws no 100 line
  const s = mk();
  s.roll.render(); F();
  eq(s.roll.bctx.calls.some(c => c[0] === 'fillRect' && c[1] === 64 && c[2] === Math.round(s.roll.v2y(100)) && c[4] === 1), false);
});

/* ------------------------------------------------------------------ the page: synth.rollView */
test('page: Keys −/+ in the Piano Roll toolbar; the row height persists per device (synth.rollView) into the next session; save() writes a pending one; a bad value is ignored', async () => {
  // last: the page simulation replaces the globals the fake DOM above installed
  const { bootMain } = await import('./main-sim.mjs');
  const { fakeStorage } = await import('./fakes.mjs');
  const ls = fakeStorage({});
  const s1 = await bootMain({ ls, touch: true });
  await s1.settle(20);
  const roll1 = s1.api.roll();
  eq([roll1.rowH, roll1.rowPref, ls.m.has('synthc.rollView')], [18, null, false], 'touch default, nothing stored');
  const find = (n, label) => { if (n.attrs && n.attrs['aria-label'] === label) return n; for (const c of n.children || []) { const f = find(c, label); if (f) return f; } return null; };
  const bigger = find(s1.$('#rolltools'), 'Bigger keys'), smaller = find(s1.$('#rolltools'), 'Smaller keys');
  ok(bigger && smaller, 'Keys −/+ buttons');
  eq([bigger.textContent, smaller.textContent], ['+', '−'], 'labels');
  bigger.click(); bigger.click();
  eq(roll1.rowH, 24, '18 → 20 → 24');
  eq(ls.m.has('synthc.rollView'), false, 'debounced');
  await s1.settle(360);
  eq(JSON.parse(ls.m.get('synthc.rollView')).rowH, 24, 'written 300 ms after the last change');
  smaller.click();
  s1.api.save();
  eq(JSON.parse(ls.m.get('synthc.rollView')).rowH, 20, 'save() writes the pending one at once');
  const s2 = await bootMain({ ls, touch: true });
  await s2.settle(20);
  eq([s2.api.roll().rowH, s2.api.roll().rowPref], [20, 20], 'next session');
  const s3 = await bootMain({ ls: fakeStorage({ 'synthc.rollView': JSON.stringify({ rowH: 'tall' }) }) });
  await s3.settle(20);
  eq([s3.api.roll().rowH, s3.api.roll().rowPref], [12, null], 'bad value ignored (mouse default)');
  const s4 = await bootMain({ ls: fakeStorage({ 'synthc.rollView': JSON.stringify({ rowH: 300 }) }) });
  await s4.settle(20);
  eq(s4.api.roll().rowH, 56, 'clamped');
});

test('page: the Piano Roll toolbar\'s touch modifier latches (Fine / Alt / Shift) — hidden with a mouse until a finger or pen touches the roll; tap = next gesture, double-tap = lock, tap again = off', async () => {
  const { bootMain } = await import('./main-sim.mjs');
  const { fakeStorage } = await import('./fakes.mjs');
  const s = await bootMain({ ls: fakeStorage({}) });
  await s.settle(20);
  const all = (n, f, out = []) => { if (f(n)) out.push(n); for (const c of n.children || []) all(c, f, out); return out; };
  const last = f => { const l = all(s.$('#rolltools'), f); return l[l.length - 1] || null; };
  const G = last(n => n.id === 'rollMods'), B = {};
  for (const k of ['fine', 'alt', 'shift']) B[k] = last(n => n.dataset && n.dataset.mod === k);
  ok(G && B.fine && B.alt && B.shift, 'the group and its buttons');
  eq([B.fine.textContent, B.alt.textContent, B.shift.textContent], ['Fine', 'Alt', 'Shift'], 'wk.modifierBar\'s labels');
  const host = s.api.roll().host;
  eq(G.style.display, 'none', 'hidden with a mouse');
  host.mods({ pointerType: 'mouse' });
  eq(G.style.display, 'none', 'still hidden after a mouse press');
  host.mods({ pointerType: 'touch' });
  eq(G.style.display, '', 'shown once a finger touched the roll');
  const st = () => [host.mods({}).fine, host.mods({}).alt, host.mods({}).shift];
  eq(st(), [false, false, false], 'all off');
  B.shift.click();
  eq([st(), B.shift.attrs['aria-pressed'], B.shift.attrs['aria-label']], [[false, false, true], 'true', 'Shift (next gesture)'], 'Shift latched');
  host.consumeMods();
  eq([st(), B.shift.attrs['aria-pressed']], [[false, false, false], 'false'], 'spent by the gesture');
  B.alt.click(); B.alt.click();
  eq([st(), B.alt.attrs['aria-label']], [[false, true, false], 'Alt (locked)'], 'double-tap: locked');
  host.consumeMods();
  eq(st(), [false, true, false], 'a locked key stays');
  B.alt.click();
  eq(st(), [false, false, false], 'tap: off');
  eq(host.mods({ shiftKey: true, altKey: false }), { fine: true, alt: false, shift: true }, 'the keyboard\'s Shift still counts (Fine and Shift)');
});

test('page: the roll\'s touch defaults follow a coarse pointer or an iPad — a mouse-driven touchscreen laptop (maxTouchPoints 10, fine pointer) keeps 12 px rows, no grab tabs and no Modifiers group; an iPad with a trackpad keeps them', async () => {
  const { bootMain } = await import('./main-sim.mjs');
  const { fakeStorage } = await import('./fakes.mjs');
  const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1';
  for (const [o, want, msg] of [[{ maxTouch: 10 }, [12, false, 'none'], 'touchscreen laptop'], [{ maxTouch: 5, ua: IPAD_UA, platform: 'MacIntel' }, [18, true, ''], 'iPad + trackpad'],
    [{}, [12, false, 'none'], 'desktop'], [{ touch: true }, [18, true, ''], 'coarse pointer']]) {
    const s = await bootMain(Object.assign({ ls: fakeStorage({}) }, o));
    await s.settle(20);
    const all = (n, f, out = []) => { if (f(n)) out.push(n); for (const c of n.children || []) all(c, f, out); return out; };
    const G = all(s.$('#rolltools'), n => n.id === 'rollMods').pop(), r = s.api.roll();
    eq([r.rowBase, r.coarse, G.style.display], want, msg);
  }
});

test('page: the arrangement host\'s restoreLoop (a two-finger takeover of a ruler drag, arrange.js restore) puts the loop back with its on flag; setLoop turns it on', async () => {
  const { bootMain } = await import('./main-sim.mjs');
  const { fakeStorage } = await import('./fakes.mjs');
  const s = await bootMain({ ls: fakeStorage({}) });
  await s.settle(20);
  const p = s.api.project(), h = s.api.arr().host;
  ok(typeof h.restoreLoop === 'function', 'main.js gives the arrangement restoreLoop');
  ok(s.api.roll().host.restoreLoop === h.restoreLoop, 'and the piano roll the same (roll.js _rollback)');
  const L0 = { start: p.loop.start, end: p.loop.end, on: !!p.loop.on };
  h.setLoop(960, 3840);
  eq([p.loop.start, p.loop.end, p.loop.on], [960, 3840, true], 'a ruler drag: setLoop sets and turns the loop on');
  h.restoreLoop({ start: 0, end: 7680, on: false });
  eq([p.loop.start, p.loop.end, p.loop.on], [0, 7680, false], 'restored, off again');
  h.restoreLoop(L0);
  eq([p.loop.start, p.loop.end, p.loop.on], [L0.start, L0.end, L0.on]);
});
