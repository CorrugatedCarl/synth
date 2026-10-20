import './v8-guard.mjs';
// cv-mods-ui.js (stage 2a lane B; docs/canvas/IMPL-2a.md §3): the modulator modules' bodies on tests/wk-dom.mjs — the Mod
// Wheel (#modw's look: a drag sets it from the slot's screen rect at any zoom, keys, update from the host, a two-finger
// cancel / lost capture end the drag, the "+N on other tracks" chip and its tap), Velocity (the default curve, the last
// velocity's dot / bar / value, a custom curve), Aftertouch and Bend (meters; Bend bipolar), bodyFor, destroy; (2b lane C,
// IMPL-2b §6.1) the editing bodies — LFO (badge, mode, rate / BPM ladders, the shape menu and point editor), ENV, Macro,
// CC, Chaos, Note: their DOM, one o.edit per gesture, update / sync. Never passes fake-DOM nodes to assert.* (strings and
// numbers only).
// Run alone: node --max-old-space-size=2048 --test tests/cv-mods-ui.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh, all, ptr, key, place, layout, Ev } from './wk-dom.mjs';
import * as U from '../cv-mods-ui.js?v=9';
import { normEnvMod } from '../serum-core.js?v=9';

const cls = (root, c) => all(root).find(n => n.classList && n.classList.contains(c)) || null;

test('wheelBody: the slider (role, 0…127), #modw\'s slot and thumb, its value; update() redraws without calling set; the thumb at (1 − v) of the travel', () => {
  const d = fresh(), sets = [];
  let cur = 0.5;
  const B = U.wheelBody({ get: () => cur, set: v => sets.push(v), doc: d });
  d.body.append(B.el);
  const w = cls(B.el, 'cv-mw'), th = cls(B.el, 'cv-mw-thumb'), val = cls(B.el, 'cv-mval');
  assert.deepEqual([B.el.className, w.getAttribute('role'), w.tabIndex, w.getAttribute('aria-valuemin'), w.getAttribute('aria-valuemax'), w.getAttribute('aria-valuenow'), w.getAttribute('aria-label')],
    ['cv-mbody cv-mwheel', 'slider', 0, '0', '127', '64', 'Mod Wheel']);
  assert.deepEqual([th.style.top, val.textContent, !!cls(B.el, 'cv-mw-slot'), cls(B.el, 'cv-mlab').textContent], ['calc(0.5000 * (100% - 26px))', '64', true, 'Mod']);
  B.update(1);
  assert.deepEqual([th.style.top, val.textContent, w.getAttribute('aria-valuenow'), sets.length, B.value()], ['calc(0.0000 * (100% - 26px))', '127', '127', 0, 1], 'the host\'s value: no set');
  B.update(NaN); B.update(7);
  assert.deepEqual([B.value(), val.textContent], [1, '127'], 'NaN ignored, clamped');
  B.destroy();
  assert.equal(B.el.parentNode, null, 'removed');
});

test('wheelBody: a press moves the thumb under the pointer and the drag follows (set per move, from the slot\'s screen rect — any zoom); a mouse move with no button, a pointercancel (a second finger) or a lost capture end it; update() is ignored while dragging', () => {
  const d = fresh(), sets = [];
  const B = U.wheelBody({ get: () => 0, set: v => sets.push(Math.round(v * 1000) / 1000), doc: d });
  d.body.append(B.el);
  const w = cls(B.el, 'cv-mw'), slot = cls(B.el, 'cv-mw-slot');
  // the slot: 160 layout px at zoom 0.5 → 80 screen px from y 100; the thumb 13 screen px
  place(slot, 10, 100, 15, 80); layout(slot, 30, 160);
  ptr(w, 'pointerdown', 17, 106.5, { pointerId: 3, pointerType: 'touch' }); // the thumb's centre at the top: 1
  assert.deepEqual([sets, w._cap, w.classList.contains('cv-on'), B.dragging()], [[1], 3, true, true]);
  ptr(w, 'pointermove', 17, 140, { pointerId: 3, pointerType: 'touch' }); // the middle
  ptr(w, 'pointermove', 17, 400, { pointerId: 3, pointerType: 'touch' }); // past the bottom: 0
  ptr(w, 'pointermove', 17, 140, { pointerId: 9, pointerType: 'touch' }); // another finger: not this drag
  assert.deepEqual(sets, [1, 0.5, 0]);
  B.update(0.8);
  assert.equal(B.value(), 0, 'the host\'s value waits while the finger holds it');
  ptr(w, 'pointercancel', 17, 400, { pointerId: 3, pointerType: 'touch' });
  assert.deepEqual([B.dragging(), w._cap, w.classList.contains('cv-on')], [false, null, false], 'a second finger (gesture.js pointercancel) ends it');
  ptr(w, 'pointermove', 17, 120, { pointerId: 3, pointerType: 'touch' });
  assert.equal(sets.length, 3, 'no move after the end');
  // a mouse: a move with no button ends it (a swallowed pointerup)
  ptr(w, 'pointerdown', 17, 173.5, { pointerId: 1 });
  ptr(w, 'pointermove', 17, 150, { pointerId: 1, buttons: 0 });
  assert.deepEqual([sets.at(-1), B.dragging()], [0, false]);
  // right / Ctrl-click: no drag; a lost capture ends one
  ptr(w, 'pointerdown', 17, 150, { pointerId: 1, button: 2 }); ptr(w, 'pointerdown', 17, 150, { pointerId: 1, ctrlKey: true });
  assert.equal(B.dragging(), false);
  ptr(w, 'pointerdown', 17, 140, { pointerId: 4, pointerType: 'pen' });
  ptr(w, 'lostpointercapture', 17, 140, { pointerId: 4, pointerType: 'pen' });
  assert.equal(B.dragging(), false);
  B.destroy();
});

test('wheelBody: keys — arrows ±1/127, Page Up / Down ±16/127, Home 0, End 1 (consumed: never a canvas nudge); other keys stay the page\'s', () => {
  const d = fresh(), sets = [];
  const B = U.wheelBody({ get: () => 64 / 127, set: v => sets.push(Math.round(v * 127)), doc: d });
  d.body.append(B.el);
  const w = cls(B.el, 'cv-mw');
  const e1 = key(w, 'ArrowUp');
  key(w, 'ArrowRight'); key(w, 'ArrowDown'); key(w, 'PageUp'); key(w, 'PageDown'); key(w, 'PageDown'); key(w, 'Home'); key(w, 'End');
  assert.deepEqual(sets, [65, 66, 65, 81, 65, 49, 0, 127]);
  assert.equal(e1._stop, true, 'consumed');
  const e2 = key(w, 'x');
  assert.deepEqual([sets.length, !!e2._stop], [8, false]);
  B.destroy();
});

test('wheelBody: "+N on other tracks" — hidden at 0, the count and its aria label; a tap calls onJump (never the world\'s press)', () => {
  const d = fresh(), jumps = [];
  const B = U.wheelBody({ doc: d, onJump: () => jumps.push('jump') });
  d.body.append(B.el);
  const o = cls(B.el, 'cv-mothers');
  assert.deepEqual([o.tagName, o.hidden, B.others()], ['BUTTON', true, 0]);
  B.setOthers(3);
  assert.deepEqual([o.hidden, o.textContent, o.getAttribute('aria-label'), o.title], [false, '+3 on other tracks', '+3 on other tracks: list them', '+3 on other tracks — tap to list them']);
  B.setOthers(1);
  assert.equal(o.textContent, '+1 on other track');
  const p = ptr(o, 'pointerdown', 1, 1);
  o.click();
  assert.deepEqual([jumps, !!p._stop], [['jump'], true]);
  B.setOthers(0);
  assert.deepEqual([o.hidden, o.textContent, o.hasAttribute('aria-label')], [true, '', false]);
  B.setOthers(NaN);
  assert.equal(o.hidden, true);
  B.destroy();
});

test('veloBody: the default curve (the diagonal) with the last velocity on it — dot, drop line, bar, value, aria; a custom curve; update ignores NaN and clamps', () => {
  const d = fresh();
  const B = U.veloBody({ get: () => 100 / 127, doc: d });
  const crv = cls(B.el, 'cv-mcrv'), dot = cls(B.el, 'cv-mdot'), drop = cls(B.el, 'cv-mdrop'), fill = cls(B.el, 'cv-mfill');
  assert.deepEqual([B.el.className, B.el.getAttribute('role'), crv.getAttribute('d'), cls(B.el, 'cv-mcurve').getAttribute('viewBox')], ['cv-mbody cv-mvelo', 'meter', 'M 0 100 L 100 0', '0 0 100 100']);
  assert.deepEqual([dot.getAttribute('cx'), dot.getAttribute('cy'), drop.getAttribute('d'), fill.style.height, cls(B.el, 'cv-mval').textContent, B.el.getAttribute('aria-valuenow')],
    ['78.7', '21.3', 'M 78.7 100 V 21.3', '78.7%', '100', '100']);
  B.update(0.5);
  assert.deepEqual([dot.getAttribute('cx'), dot.getAttribute('cy'), cls(B.el, 'cv-mval').textContent], ['50', '50', '64']);
  B.update(NaN); B.update(2);
  assert.deepEqual([B.value(), cls(B.el, 'cv-mval').textContent], [1, '127']);
  const C = U.veloBody({ curve: [[0, 0], [0.5, 0.8], [1, 1]], doc: d });
  C.update(0.25);
  assert.deepEqual([cls(C.el, 'cv-mcrv').getAttribute('d'), cls(C.el, 'cv-mdot').getAttribute('cy')], ['M 0 100 L 50 20 L 100 0', '60'], 'a custom curve: the dot on it');
  B.destroy(); C.destroy();
});

test('atBody / bendBody: a level bar from the left (0…127) and a bipolar one from the centre (−100…+100 %); bodyFor by kind', () => {
  const d = fresh();
  const A = U.atBody({ get: () => 0.5, doc: d }), Bn = U.bendBody({ get: () => 0, doc: d });
  assert.deepEqual([A.el.className, A.el.getAttribute('aria-label'), cls(A.el, 'cv-mfill').style.width, cls(A.el, 'cv-mval').textContent, cls(A.el, 'cv-mlab').textContent],
    ['cv-mbody cv-mat', 'Aftertouch', '50%', '64', 'AT']);
  A.update(1);
  assert.deepEqual([cls(A.el, 'cv-mfill').style.width, A.el.getAttribute('aria-valuenow')], ['100%', '127']);
  assert.deepEqual([Bn.el.className, !!cls(Bn.el, 'cv-mmid'), cls(Bn.el, 'cv-mfill').style.left, cls(Bn.el, 'cv-mfill').style.width, cls(Bn.el, 'cv-mval').textContent],
    ['cv-mbody cv-mbend', true, '50%', '0%', '0']);
  Bn.update(-0.5);
  assert.deepEqual([cls(Bn.el, 'cv-mfill').style.left, cls(Bn.el, 'cv-mfill').style.width, cls(Bn.el, 'cv-mval').textContent, Bn.el.getAttribute('aria-valuenow')], ['25%', '25%', '−50%', '-50']);
  Bn.update(3);
  assert.deepEqual([cls(Bn.el, 'cv-mfill').style.left, cls(Bn.el, 'cv-mfill').style.width, cls(Bn.el, 'cv-mval').textContent], ['50%', '50%', '+100%']);
  assert.deepEqual(['wheel', 'velo', 'at', 'bend', 'nope'].map(k => { const b = U.bodyFor(k, { doc: d }); return b ? b.el.className : null; }),
    ['cv-mbody cv-mwheel', 'cv-mbody cv-mvelo', 'cv-mbody cv-mat', 'cv-mbody cv-mbend', null]);
  A.destroy(); Bn.destroy();
});

// UI fixes
test('(U3) two fingers win on the wheel: the press\'s jump and the drag are rolled back by the two-finger cancel (set(v0): the value from before the press); a plain pointercancel or a lift keeps them', () => {
  const d = fresh(), sets = [];
  const B = U.wheelBody({ get: () => 0.25, set: v => sets.push(Math.round(v * 1000) / 1000), doc: d });
  d.body.append(B.el);
  const w = cls(B.el, 'cv-mw'), slot = cls(B.el, 'cv-mw-slot');
  place(slot, 10, 100, 15, 80); layout(slot, 30, 160);
  ptr(w, 'pointerdown', 17, 106.5, { pointerId: 3, pointerType: 'touch' }); // the jump: 1
  ptr(w, 'pointermove', 17, 140, { pointerId: 3, pointerType: 'touch' });
  ptr(w, 'pointercancel', 17, 140, { pointerId: 3, pointerType: 'touch', gesture: 'two-finger' });
  assert.deepEqual([sets, B.value(), B.dragging(), w.classList.contains('cv-on')], [[1, 0.5, 0.25], 0.25, false, false], 'back to 0.25, sent once more');
  ptr(w, 'pointerdown', 17, 106.5, { pointerId: 4, pointerType: 'touch' });
  ptr(w, 'pointercancel', 17, 106.5, { pointerId: 4, pointerType: 'touch' });
  assert.deepEqual([sets.at(-1), B.value()], [1, 1], 'a plain cancel keeps');
  B.destroy();
});

test('(U14) "+N on other tracks": a tap gives onJump the chip (the host lists the tracks at it)', () => {
  const d = fresh(), got = [];
  const B = U.wheelBody({ doc: d, onJump: el => got.push(el && el.className) });
  d.body.append(B.el);
  B.setOthers(2);
  cls(B.el, 'cv-mothers').click();
  assert.deepEqual(got, ['cv-mothers']);
  B.destroy();
});

/* ---------------------------------------------------------------- stage 2b (IMPL-2b §6.1): the editing bodies */
// a 2b body over a plain state: edits land in `edits` (one per gesture) and apply to the state (as the host would)
function rig(kind, st0, extra = {}) {
  const d = fresh(), edits = [], sets = [], st = Object.assign({ kind }, st0);
  const o = Object.assign({ doc: d, get: () => st, edit: f => { edits.push(JSON.parse(JSON.stringify(f))); Object.assign(st, JSON.parse(JSON.stringify(f))); }, set: (k, v) => sets.push(k + ':' + v) }, extra);
  const B = U.bodyFor(kind, o);
  d.body.append(B.el);
  return { d, B, st, edits, sets };
}
const txt = (root, c) => { const n = cls(root, c); return n ? n.textContent : null; };
const byCls = (root, c) => all(root).filter(n => n.classList && n.classList.contains(c));
const nbVal = root => { const n = cls(root, 'wk-nb'); return n ? n.getAttribute('aria-valuetext') : null; };
const LFO0 = () => ({ mode: 'retrig', mono: 1, type: 'normal', dir: 'fwd', bpm: 0, dot: 0, trip: 0, anchor: 1, x10: 0, swing: 0, pts: [[0, 0, 0], [0.5, 1, 0], [1, 0, 0]], path: [], loop: -1, start: 0 });

test('lfoBody (2b): the GLOBAL / PER NOTE badge toggles lfo.mono (one edit, the lfo object whole), the mode seg lfo.mode, BPM / dotted / triplet toggles; the rate numBox shows Hz (pow4 0…100) or the Serum ladder label in BPM mode and writes rate once per gesture', () => {
  const R = rig('lfo', { lfo: LFO0(), rate: 0.5 }), B = R.B;
  const badge = cls(B.el, 'cv-mbadge2');
  assert.deepEqual([B.el.className, badge.textContent, badge.getAttribute('aria-pressed'), nbVal(B.el)], ['cv-mbody cv-mlfo cv-medit', 'GLOBAL', 'true', '6.25 Hz'], 'pow4: 0.5⁴ · 100 = 6.25 Hz');
  badge.click();
  assert.deepEqual([R.edits.length, R.st.lfo.mono, R.st.lfo.mode, badge.textContent], [1, 0, 'retrig', 'PER NOTE'], 'the lfo given whole, mono flipped');
  const segs = byCls(B.el, 'wk-sb');
  assert.deepEqual(segs.map(b => b.textContent), ['RETRIG', 'ENV', 'FREE']);
  segs[2].click();
  assert.deepEqual([R.edits.length, R.st.lfo.mode], [2, 'free']);
  const togs = byCls(B.el, 'wk-tog');
  assert.deepEqual(togs.map(b => b.textContent), ['BPM', '·', 'T']);
  togs[0].click();
  assert.deepEqual([R.st.lfo.bpm, nbVal(B.el)], [1, '1/4'], 'BPM on: the straight ladder (15 entries), n 0.5 → index 7 = 1/4');
  togs[1].click();
  assert.deepEqual([R.st.lfo.dot, nbVal(B.el)], [1, '1/4.'], 'dotted: the 29-entry ladder (index 14)');
  togs[1].click(); togs[0].click();
  assert.deepEqual([R.st.lfo.dot, R.st.lfo.bpm, R.edits.length], [0, 0, 6]);
  // the rate: a key on the numBox = one 'set' edit; a drag edits once at its end
  const nb = cls(B.el, 'wk-nb');
  key(nb, 'ArrowUp');
  assert.equal(R.edits.length, 7);
  assert.ok(R.st.rate > 0.5 && R.edits[6].rate === R.st.rate, 'rate written');
  const before = R.edits.length;
  ptr(nb, 'pointerdown', 50, 50, { pointerId: 2 }); ptr(nb, 'pointermove', 50, 30, { pointerId: 2 }); ptr(nb, 'pointermove', 50, 10, { pointerId: 2 });
  assert.equal(R.edits.length, before, 'moving: no edit yet (shown live)');
  ptr(nb, 'pointerup', 50, 10, { pointerId: 2 });
  assert.equal(R.edits.length, before + 1, 'one edit at the lift');
  B.destroy();
  assert.equal(B.el.parentNode, null);
});

test('lfoBody (2b): the shape menu lists Serum\'s presets + Custom and matches the points; the point editor — a tap adds a point, a drag moves one (the ends pinned to x 0 / 1), a second tap removes it, a vertical drag on a segment bends it; every gesture = one edit of lfo.pts; update({v, ph}) puts the dot on the shape', () => {
  const R = rig('lfo', { lfo: LFO0(), rate: 0.5 }), B = R.B;
  assert.deepEqual([txt(B.el, 'wk-mtxt'), U.LFO_SHAPES[0].name, U.LFO_SHAPES.length > 5], ['Triangle', 'Triangle', true]);
  const sv = cls(B.el, 'cv-mshape');
  place(sv, 0, 0, 190, 72); // 1 css px = 1 user unit
  assert.deepEqual([byCls(sv, 'cv-mpt').length, cls(sv, 'cv-mcrv').getAttribute('d').slice(0, 6)], [3, 'M0 72L']);
  // a tap at (95, 18) → a point at x 0.5, y 0.75 after the first segment's point… the triangle peak is at x 0.5: it lands after it
  ptr(sv, 'pointerdown', 47.5, 36, { pointerId: 1 }); ptr(sv, 'pointerup', 47.5, 36, { pointerId: 1 });
  assert.deepEqual([R.edits.length, R.st.lfo.pts], [1, [[0, 0, 0], [0.25, 0.5, 0], [0.5, 1, 0], [1, 0, 0]]], 'added, sorted into its segment');
  assert.equal(txt(B.el, 'wk-mtxt'), 'Custom');
  // drag the new point (index 1) to x 0.1, y 0.2 — the x stays between its neighbours
  const pt = byCls(sv, 'cv-mpt')[1];
  ptr(pt, 'pointerdown', 47.5, 36, { pointerId: 2 }); ptr(pt, 'pointermove', 19, 57.6, { pointerId: 2 });
  assert.equal(R.edits.length, 1, 'moving: shown live, not written');
  assert.equal(byCls(sv, 'cv-mpt')[1].getAttribute('cx'), '19', 'followed');
  ptr(pt, 'pointermove', -40, 57.6, { pointerId: 2 }); ptr(pt, 'pointerup', -40, 57.6, { pointerId: 2 });
  assert.deepEqual([R.edits.length, R.st.lfo.pts[1]], [2, [0, 0.2, 0]], 'clamped to its left neighbour (x 0), one edit');
  // the ends: pinned at x 0 / 1
  const p0 = byCls(sv, 'cv-mpt')[0];
  ptr(p0, 'pointerdown', 0, 72, { pointerId: 3 }); ptr(p0, 'pointermove', 60, 40, { pointerId: 3 }); ptr(p0, 'pointerup', 60, 40, { pointerId: 3 });
  assert.deepEqual(R.st.lfo.pts[0], [0, 0.4444, 0], 'x stays 0, y moved');
  // a second tap on a point removes it (never an end)
  const p1 = byCls(sv, 'cv-mpt')[1];
  ptr(p1, 'pointerdown', 0, 57.6, { pointerId: 4, timeStamp: 1000 }); ptr(p1, 'pointerup', 0, 57.6, { pointerId: 4, timeStamp: 1000 });
  ptr(p1, 'pointerdown', 0, 57.6, { pointerId: 5, timeStamp: 1200 }); ptr(p1, 'pointerup', 0, 57.6, { pointerId: 5, timeStamp: 1200 });
  assert.deepEqual([R.edits.length, R.st.lfo.pts.length], [4, 3], 'removed');
  const e0 = byCls(sv, 'cv-mpt')[0];
  ptr(e0, 'pointerdown', 0, 40, { pointerId: 6, timeStamp: 2000 }); ptr(e0, 'pointerup', 0, 40, { pointerId: 6, timeStamp: 2000 });
  ptr(e0, 'pointerdown', 0, 40, { pointerId: 7, timeStamp: 2100 }); ptr(e0, 'pointerup', 0, 40, { pointerId: 7, timeStamp: 2100 });
  assert.equal(R.st.lfo.pts.length, 3, 'an end stays');
  // a vertical drag on the first segment bends it: 60 px of travel = the full curvature (towards the drag)
  ptr(sv, 'pointerdown', 30, 50, { pointerId: 8 }); ptr(sv, 'pointermove', 30, 20, { pointerId: 8 }); ptr(sv, 'pointerup', 30, 20, { pointerId: 8 });
  assert.deepEqual([R.edits.length, R.st.lfo.pts[0][2]], [5, 0.5], 'the segment\'s curvature');
  // the shape menu sets the points (one edit)
  const W = cls(B.el, 'wk-menu').wk;
  W.open();
  const items = all(R.d.body).filter(n => n.getAttribute && n.getAttribute('role') === 'option');
  assert.ok(items.length === U.LFO_SHAPES.length + 1 && items.at(-1).textContent === 'Custom', 'the presets and Custom');
  items[1].dispatchEvent(new Ev('click', { bubbles: true }));
  W.close();
  assert.deepEqual([R.edits.length, R.st.lfo.pts.length, txt(B.el, 'wk-mtxt')], [6, U.LFO_SHAPES[1].pts.length, U.LFO_SHAPES[1].name]);
  // live: the bar and the dot at the phase
  const dot = cls(sv, 'cv-mdot');
  B.update(0.25);
  assert.deepEqual([cls(B.el, 'cv-mlive').childNodes[0].style.width, dot.getAttribute('display')], ['25%', 'none']);
  B.update({ v: 0.5, ph: 0.25 });
  assert.deepEqual([dot.hasAttribute('display'), dot.getAttribute('cx')], [false, '47.5']);
  B.update({ v: 0.5 });
  assert.equal(dot.getAttribute('display'), 'none');
  B.destroy();
});

test('envBody (2b): five vertical sliders (A H D S R: Serum\'s pow5 0…32 s laws, S in %), curve numBoxes for A / D / R (crv), the AHDSR display follows the values; update(v) the level line', () => {
  const R = rig('env', { env: { bpm: 0, legInv: 0, stealRe: 0 }, att: 0.11, hold: 0, dec: 0.5, sus: 1, rel: 0.215, crv: [0.5, 0.666, 0.666] }), B = R.B;
  const sl = byCls(B.el, 'wk-sl');
  assert.deepEqual([B.el.className, sl.length, sl.map(s => s.getAttribute('aria-orientation')).join(), byCls(B.el, 'cv-mtag').map(n => n.textContent)],
    ['cv-mbody cv-menv cv-medit', 5, 'vertical,vertical,vertical,vertical,vertical', ['A', 'H', 'D', 'S', 'R', 'A∿', 'D∿', 'R∿']]);
  assert.deepEqual(sl.map(s => s.getAttribute('aria-valuetext')), ['0.52 ms', '0.00 ms', '1.00 s', '100%', '14.7 ms'], 'laws: 0.11⁵ · 32 ≈ 0.52 ms, 0.5⁵ · 32 = 1 s, 0.215⁵ · 32 ≈ 14.7 ms');
  const d0 = cls(B.el, 'cv-mcrv').getAttribute('d');
  key(sl[3], 'ArrowDown');
  assert.deepEqual([R.edits.length, R.st.sus < 1, Object.keys(R.edits[0])], [1, true, ['sus']]);
  assert.notEqual(cls(B.el, 'cv-mcrv').getAttribute('d'), d0, 'the display redrawn');
  const nbs = byCls(B.el, 'wk-nb');
  assert.deepEqual(nbs.map(n => n.getAttribute('aria-valuetext')), ['50%', '67%', '67%'], 'Serum\'s ENV panel format (pct of the 0…1 value)');
  key(nbs[0], 'ArrowUp');
  assert.deepEqual([R.edits.length, R.st.crv[0] > 0.5, R.st.crv[0] < 0.52, R.st.crv[1], nbs[0].getAttribute('aria-valuetext')], [2, true, true, 0.666, '50%'], 'one fine step up, the others untouched');
  B.update(0.5);
  assert.equal(cls(B.el, 'cv-mdrop').getAttribute('d'), 'M0 28H190');
  B.destroy();
});

test('envBody: the curves are the state\'s 0…1 values (0.5 = linear, Serum\'s e<k>.ca / cd / cr): a fresh ENV module shows Serum\'s defaults 50 / 67 / 67 %, typed entry and reset round-trip, 0.5 draws straight segments', () => {
  const R = rig('env', Object.assign({ kind: 'env' }, normEnvMod({}))), B = R.B;
  const nbs = byCls(B.el, 'wk-nb'), shown = () => nbs.map(n => n.getAttribute('aria-valuetext')).join();
  assert.deepEqual([R.st.crv, shown()], [[0.5, 0.666, 0.666], '50%,67%,67%'], 'the default module = Serum\'s default curves (not +50 / +67 / +67)');
  // a typed entry stores what was typed: "0" is the 0 curve (hard), not a quirk of the old −1…1 mapping; "%" optional
  const typed = (nb, t) => { nb.wk.edit(); const inp = byCls(nb, 'wk-in')[0]; inp.value = t; key(inp, 'Enter'); };
  typed(nbs[0], '0');
  assert.deepEqual([R.st.crv, nbs[0].getAttribute('aria-valuetext')], [[0, 0.666, 0.666], '0%']);
  typed(nbs[1], '100%');
  typed(nbs[2], '25');
  assert.deepEqual([R.st.crv, shown(), R.edits.length], [[0, 1, 0.25], '0%,100%,25%', 3], 'one edit per entry, the others kept');
  typed(nbs[0], 'nonsense');
  assert.deepEqual([R.st.crv[0], R.edits.length], [0, 3], 'a bad entry changes nothing');
  // the default back (reset) is exactly Serum's default, and a host edit / undo shows at once through sync()
  nbs[2].wk.reset(); nbs[1].wk.reset(); nbs[0].wk.reset();
  assert.deepEqual([R.st.crv, shown()], [[0.5, 0.666, 0.666], '50%,67%,67%'], 'reset = the exact defaults');
  R.st.crv = [0.9, 0.2, 0.35]; B.sync();
  assert.equal(shown(), '90%,20%,35%', 'sync follows the state');
  B.destroy();
  // the display: 0.5 is linear (the engine bends by 10 · (2c − 1)): equal rises up the attack; above 0.5 rises sooner, below later
  const ys = c => {
    const Q = rig('env', { env: {}, att: 0.5, hold: 0, dec: 0.5, sus: 0.5, rel: 0.5, crv: [c, 0.5, 0.5] });
    const pts = cls(Q.B.el, 'cv-mcrv').getAttribute('d').split('L').slice(1, 13).map(p => +p.split(' ')[1]);
    Q.B.destroy();
    return pts;
  };
  const lin = ys(0.5), up = ys(0.9), dn = ys(0.1), step = lin[1] - lin[0];
  assert.ok(lin.every((y, i) => i === 0 || Math.abs(lin[i] - lin[i - 1] - step) < 0.25), 'c = 0.5: equal steps (a straight attack)');
  assert.ok(up[5] < lin[5] && dn[5] > lin[5], 'above 0.5 rises sooner (the engine\'s bend(q, +k)), below later');
  assert.deepEqual([ys(-3).join() === ys(0).join(), ys(7).join() === ys(1).join()], [true, true], 'out-of-range values clamp to 0…1');
});

test('macroBody (2b): 8 rows (a knob, an editable name ≤ 16 chars, the value); a knob turn calls o.set(k, v) per move and edits v once at the lift; a key one edit; a name change edits names (trimmed, clipped, empty → the default); update([…]) lights the live dots', () => {
  const R = rig('macro', { v: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], names: ['Cut', 'Res', 'C', 'D', 'E', 'F', 'G', 'H'] }), B = R.B;
  const rows = byCls(B.el, 'cv-mmrow'), knobs = byCls(B.el, 'wk-knob'), names = byCls(B.el, 'cv-mname'), vals = byCls(B.el, 'cv-mmv');
  assert.deepEqual([rows.length, knobs.length, names.map(n => n.value).join(), vals.map(v => v.textContent).join(), rows.map(r => r.getAttribute('data-k')).join()],
    [8, 8, 'Cut,Res,C,D,E,F,G,H', '10%,20%,30%,40%,50%,60%,70%,80%', '1,2,3,4,5,6,7,8']);
  assert.deepEqual([knobs[0].getAttribute('aria-label'), names[0].getAttribute('maxlength')], ['Cut', '16']);
  ptr(knobs[2], 'pointerdown', 100, 100, { pointerId: 1 }); ptr(knobs[2], 'pointermove', 100, 60, { pointerId: 1 });
  assert.deepEqual([R.sets.slice(-1)[0].startsWith('2:'), R.edits.length], [true, 0], 'live per move, no edit yet');
  ptr(knobs[2], 'pointermove', 100, 40, { pointerId: 1 }); ptr(knobs[2], 'pointerup', 100, 40, { pointerId: 1 });
  assert.deepEqual([R.edits.length, R.st.v[2] > 0.3, R.st.v[1], vals[2].textContent], [1, true, 0.2, Math.round(R.st.v[2] * 100) + '%'], 'one edit of the whole v');
  key(knobs[7], 'ArrowDown');
  assert.deepEqual([R.edits.length, R.st.v[7] < 0.8], [2, true]);
  names[1].value = '  A very long macro name indeed ';
  names[1].dispatchEvent(new Ev('change'));
  assert.deepEqual([R.edits.length, R.st.names[1], names[1].value], [3, 'A very long macr', 'A very long macr']);
  names[1].value = '';
  names[1].dispatchEvent(new Ev('change'));
  assert.deepEqual([R.edits.length, R.st.names[1]], [4, 'Macro 2']);
  names[1].dispatchEvent(new Ev('change'));
  assert.equal(R.edits.length, 4, 'unchanged: no edit');
  const p = ptr(names[0], 'pointerdown', 1, 1);
  assert.equal(!!p._stop, true, 'the name box keeps its press');
  const dotOn = k => !cls(knobs[k], 'wk-live').hasAttribute('display');
  B.update([0.9, null, R.st.v[2]]);
  assert.deepEqual([dotOn(0), dotOn(1), dotOn(2)], [true, false, false], 'a live dot when it differs from the base (wk\'s 0.002 rule)');
  B.update(null);
  assert.equal(dotOn(0), false);
  R.st.v[0] = 0.55; B.sync();
  assert.equal(vals[0].textContent, '55%');
  B.destroy();
  // (fixer C, U8) blank names (normDev's '') show the default as a placeholder and label the knob "Macro n"
  const R2 = rig('macro', { v: [0, 0, 0, 0, 0, 0, 0, 0], names: ['', 'Res', '', '', '', '', '', ''] }), N2 = byCls(R2.B.el, 'cv-mname'), K2 = byCls(R2.B.el, 'wk-knob');
  assert.deepEqual([N2.map(n => n.getAttribute('placeholder')).join(), N2[0].value, N2[1].value, K2[0].getAttribute('aria-label'), K2[1].getAttribute('aria-label')],
    ['Macro 1,Macro 2,Macro 3,Macro 4,Macro 5,Macro 6,Macro 7,Macro 8', '', 'Res', 'Macro 1', 'Res']);
  R2.B.destroy();
});

test('ccBody (2b): the controller numBox (0…127, one edit per key), the channel menu (Omni / 1…16), Learn arms o.learn(true) and shows it (setLearn from the host), the value meter', () => {
  const learns = [];
  const R = rig('cc', { cc: 7, ch: 0, v: 0.5 }, { learn: on => learns.push(on) }), B = R.B;
  const nb = cls(B.el, 'wk-nb'), learn = cls(B.el, 'cv-mlearn');
  assert.deepEqual([B.el.className, nb.getAttribute('aria-valuetext'), txt(B.el, 'wk-mtxt'), learn.textContent, learn.getAttribute('aria-pressed'), txt(B.el, 'cv-mval'), cls(B.el, 'cv-mfill').style.width],
    ['cv-mbody cv-mcc cv-medit', 'CC 7', 'Omni', 'Learn', 'false', '64', '50%']);
  key(nb, 'ArrowUp');
  assert.deepEqual([R.edits, R.st.cc, nb.getAttribute('aria-valuetext')], [[{ cc: 8 }], 8, 'CC 8']);
  learn.click();
  assert.deepEqual([learns, learn.textContent, learn.getAttribute('aria-pressed'), B.armed()], [[true], 'Listening…', 'true', true]);
  B.setLearn(false);
  assert.deepEqual([learn.textContent, B.armed()], ['Learn', false]);
  learn.click(); learn.click();
  assert.deepEqual(learns, [true, true, false]);
  const W = cls(B.el, 'wk-menu').wk;
  W.open();
  const opts = all(R.d.body).filter(n => n.getAttribute && n.getAttribute('role') === 'option');
  assert.deepEqual([opts.length, opts[0].textContent, opts[16].textContent], [17, 'Omni', 'Ch 16']);
  opts[3].dispatchEvent(new Ev('click', { bubbles: true }));
  W.close();
  assert.deepEqual([R.st.ch, txt(B.el, 'wk-mtxt')], [3, 'Ch 3']);
  B.update(1);
  assert.deepEqual([txt(B.el, 'cv-mval'), cls(B.el, 'cv-mfill').style.width], ['127', '100%']);
  B.destroy();
});

test('chaosBody (2b): the rate in Hz (pow5 0…1000) or the LFO ladder label with BPM, smoothing in %, a scope of the last 64 values; noteBody: the keyboard meter lights the last note and names it; bodyFor for every 2b kind', () => {
  const R = rig('chaos', { chaos: { mono: 0, sh: 0 }, rate: 0.2512, bpm: 0, smooth: 0.25 }), B = R.B;
  const nbs = byCls(B.el, 'wk-nb');
  assert.deepEqual([B.el.className, nbs[0].getAttribute('aria-valuetext'), nbs[1].getAttribute('aria-valuetext'), cls(B.el, 'cv-mline').getAttribute('d')], ['cv-mbody cv-mchaos cv-medit', '1.00 Hz', '25%', '']);
  cls(B.el, 'wk-tog').click();
  assert.deepEqual([R.edits, nbs[0].getAttribute('aria-valuetext')], [[{ bpm: 1 }], '2 bar'], '0.2512 · 14 → index 4 of the straight ladder (32, 16, 8, 4, 2 bar)');
  key(nbs[1], 'ArrowUp');
  assert.deepEqual([R.edits.length, R.st.smooth > 0.25], [2, true]);
  for (let i = 0; i < 70; i++) B.update(i % 2);
  const dd = cls(B.el, 'cv-mline').getAttribute('d');
  assert.deepEqual([dd.startsWith('M0 '), dd.split('L').length], [true, 64]);
  B.destroy();
  const N = rig('note', {}), K = N.B, mark = cls(K.el, 'cv-mkeyon');
  assert.deepEqual([K.el.className, byCls(K.el, 'cv-mkey').length, byCls(K.el, 'cv-mblk').length, mark.getAttribute('display'), txt(K.el, 'cv-mval')], ['cv-mbody cv-mnote', 128, 53, 'none', '—']);
  K.update(60);
  assert.deepEqual([mark.hasAttribute('display'), mark.getAttribute('x'), txt(K.el, 'cv-mval'), K.el.getAttribute('aria-valuenow')], [false, '90', 'C4', '60']);
  K.update(61);
  assert.deepEqual([txt(K.el, 'cv-mval'), mark.getAttribute('height')], ['C#4', '24']);
  K.update(null);
  assert.deepEqual([mark.getAttribute('display'), txt(K.el, 'cv-mval')], ['none', '—']);
  K.destroy();
  const d = fresh();
  assert.deepEqual(['lfo', 'env', 'macro', 'cc', 'chaos', 'note', 'nope'].map(k => { const b = U.bodyFor(k, { doc: d, get: () => ({}), edit() {} }); const c = b ? b.el.className : null; if (b) b.destroy(); return c; }),
    ['cv-mbody cv-mlfo cv-medit', 'cv-mbody cv-menv cv-medit', 'cv-mbody cv-mmacro cv-medit', 'cv-mbody cv-mcc cv-medit', 'cv-mbody cv-mchaos cv-medit', 'cv-mbody cv-mnote', null], 'defaults without a state');
});
