import './v8-guard.mjs';
// cv-mods-ui.js (stage 2a lane B; docs/canvas/IMPL-2a.md §3): the modulator modules' bodies on tests/wk-dom.mjs — the Mod
// Wheel (#modw's look: a drag sets it from the slot's screen rect at any zoom, keys, update from the host, a two-finger
// cancel / lost capture end the drag, the "+N on other tracks" chip and its tap), Velocity (the default curve, the last
// velocity's dot / bar / value, a custom curve), Aftertouch and Bend (meters; Bend bipolar), bodyFor, destroy. Never passes
// fake-DOM nodes to assert.* (strings and numbers only).
// Run alone: node --max-old-space-size=2048 --test tests/cv-mods-ui.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh, all, ptr, key, place, layout } from './wk-dom.mjs';
import * as U from '../cv-mods-ui.js?v=9';

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
  assert.deepEqual(['wheel', 'velo', 'at', 'bend', 'lfo'].map(k => { const b = U.bodyFor(k, { doc: d }); return b ? b.el.className : null; }),
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
