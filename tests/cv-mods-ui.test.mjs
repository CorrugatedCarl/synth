import './v8-guard.mjs';
// cv-mods-ui.js (stage 2a lane B; docs/canvas/IMPL-2a.md §3; MOD1 §4, lane F): the modulator modules' faces. (MOD1 §4.2) The six
// plain ones on the RIG grid without a SerumHost (tests/wk-dom.mjs): the Mod Wheel (a drag sets it from the slot's screen rect at any
// zoom, keys, update from the host, a two-finger cancel / lost capture end the drag, the "+N on other tracks" chip and its tap),
// Velocity (the default curve, the last velocity's dot / bar / value, a custom curve), Aftertouch and Bend (meters; Bend bipolar),
// CC (one o.edit per gesture, Learn, the meter), Note (the keyboard meter) — each a section.rig-face of MOD_FACE's recipe (columns =
// cv-mods MOD_COLS, ≤ 48 elements, a jack row with span.rig-jack[data-jack="out"]). (MOD1 §4.1) LFO, Envelope, Macros and Chaos:
// rig-ui's slot faces over sx-host slot hosts (the body contract main.js mounts: update / sync / menuItems / host / view / value /
// knobs, the old body's ⋯ items, data-nomod, the MONO lock, `shown`, every data-dest of the old panel on the face). G8: no Serum-part
// UI in cv-mods-ui.js or rig-ui.js.
// Never passes fake-DOM nodes to assert.* (strings and numbers only; the slot faces' tests through safeAssert).
// Run alone: node --max-old-space-size=2048 --test tests/cv-mods-ui.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fresh, all, ptr, key, place, layout, Ev } from './wk-dom.mjs';
import * as U from '../cv-mods-ui.js?v=9';
import { MOD_COLS } from '../cv-mods.js?v=9';
import { GRID, faceW, layoutOf } from '../rig-grid.js?v=9';

const cls = (root, c) => all(root).find(n => n.classList && n.classList.contains(c)) || null;
const rowsOf = el => el.children.filter(n => n.classList.contains('rig-row'));
const PLAIN = ['wheel', 'velo', 'at', 'bend', 'note', 'cc'];

/* ---------------------------------------------------------------- (MOD1 §4.2) the plain faces: the recipes */
test('(MOD1 §4.2) MOD_FACE: the six plain faces\' recipes — columns = cv-mods MOD_COLS (widths 64·n + 32), a screen first, the jack row last with OUT at the right; every row height GRID\'s', () => {
  assert.deepEqual(Object.keys(U.MOD_FACE).sort(), PLAIN.slice().sort());
  for (const k of PLAIN) {
    const F = U.MOD_FACE[k], L = layoutOf(F);
    assert.equal(F.cols, MOD_COLS[k], k + ': MOD_COLS');
    assert.equal(L.w, faceW(MOD_COLS[k]), k + ': the width');
    assert.equal(F.rows[0].t, 'screen', k + ': its screen first');
    assert.equal(F.rows[0].h, GRID.rows.screenL, k + ': a large screen');
    const J = L.rows.at(-1);
    assert.deepEqual([J.t, J.cells.map(c => c.jack.port + ':' + c.col)], ['jacks', ['out:' + (F.cols - 1)]], k + ': OUT at the right');
    for (const r of F.rows) if (r.t !== 'screen') assert.equal(r.h, GRID.rows[r.t], k + ' ' + r.t);
  }
  assert.ok(Object.isFrozen(U.MOD_FACE) && Object.isFrozen(U.MOD_FACE.cc.rows));
});

test('(MOD1 §4.2) every plain face: a section.rig-face[data-rig-kind] of its recipe (rows, --rig-n), its title, the jack row\'s OUT (cv-module\'s inline anchor: a mod jack, awake), ≤ 48 elements (G5); the bodies by kind (bodyFor), unknown → null', () => {
  const d = fresh(), st = { kind: 'cc', cc: 1, ch: 0 };
  const titles = { wheel: 'Mod Wheel', velo: 'Velocity', at: 'Aftertouch', bend: 'Bend', note: 'Note', cc: 'CC 3' };
  for (const k of PLAIN) {
    const B = U.bodyFor(k, { doc: d, get: () => (k === 'cc' ? st : 0), edit() {}, devKey: k === 'cc' ? 'c3' : undefined });
    d.body.append(B.el);
    const F = U.MOD_FACE[k], rows = rowsOf(B.el);
    assert.deepEqual([B.el.tagName, B.el.classList.contains('rig-face'), B.el.getAttribute('data-rig-kind'), B.el.getAttribute('aria-label'), B.el.style['--rig-n']],
      ['SECTION', true, k, titles[k], String(F.cols)], k);
    assert.deepEqual(rows.map(r => r.className.split(' ').slice(0, 2).join(' ')), F.rows.map(r => 'rig-row rig-' + r.t), k + ': its rows');
    assert.equal(rows[0].getAttribute('data-h'), 'L');
    assert.ok(cls(rows[0], 'rig-disp'), k + ': the screen\'s frame');
    const j = all(B.el).filter(n => n.getAttribute && n.getAttribute('data-jack') !== null);
    assert.deepEqual(j.map(n => [n.getAttribute('data-jack'), n.className, n.getAttribute('data-rig-dir'), n.getAttribute('data-rig-sig'), n.hasAttribute('data-cv-awake'), n.getAttribute('aria-label')]),
      [['out', 'rig-jack cv-jack cv-fjack', 'out', 'mod', true, titles[k] + ' · OUT']], k + ': one OUT jack');
    assert.equal(cls(B.el, 'rig-jl').textContent, 'OUT');
    assert.equal(j[0].parentNode.style.gridColumn, F.cols + ' / span 1', k + ': in the last column');
    assert.ok(all(B.el).length <= 48, k + ': ' + all(B.el).length + ' elements');
    assert.equal(typeof B.update, 'function');
    B.destroy();
    assert.equal(B.el.parentNode, null, k + ': removed');
  }
  assert.equal(U.bodyFor('nope', { doc: d }), null);
  assert.equal(d.getElementById(U.MOD_CSS_ID) !== null, true, 'the screens\' CSS, once');
  assert.equal(all(d.head).filter(n => n.id === U.MOD_CSS_ID).length, 1);
});

/* ---------------------------------------------------------------- the Mod Wheel */
const wheelOf = B => ({ press: B.el.children[0], w: cls(B.el, 'rig-mw'), th: cls(B.el, 'rig-mw-thumb'), slot: cls(B.el, 'rig-mw-slot'), val: cls(B.el, 'rig-mval'), oth: cls(B.el, 'rig-mothers') });
test('wheelBody: the face\'s screen is the wheel — the slider (role, 0…127), its slot and thumb, its value; update() redraws without calling set; the thumb at (1 − v) of the travel', () => {
  const d = fresh(), sets = [];
  let cur = 0.5;
  const B = U.wheelBody({ get: () => cur, set: v => sets.push(v), doc: d });
  d.body.append(B.el);
  const { press, w, th, val } = wheelOf(B);
  assert.deepEqual([press.className, w.getAttribute('role'), w.tabIndex, w.getAttribute('aria-valuemin'), w.getAttribute('aria-valuemax'), w.getAttribute('aria-valuenow'), w.getAttribute('aria-label')],
    ['rig-row rig-screen rig-mpress', 'slider', 0, '0', '127', '64', 'Mod Wheel']);
  assert.deepEqual([th.style.top, val.textContent, !!cls(B.el, 'rig-mw-slot'), cls(B.el, 'rig-mlab').textContent], ['calc(0.5000 * (100% - 26px))', '64', true, 'Mod']);
  B.update(1);
  assert.deepEqual([th.style.top, val.textContent, w.getAttribute('aria-valuenow'), sets.length, B.value()], ['calc(0.0000 * (100% - 26px))', '127', '127', 0, 1], 'the host\'s value: no set');
  B.update(NaN); B.update(7);
  assert.deepEqual([B.value(), val.textContent], [1, '127'], 'NaN ignored, clamped');
  B.destroy();
  assert.equal(B.el.parentNode, null, 'removed');
});

test('wheelBody: a press anywhere on the screen moves the thumb under the pointer and the drag follows (set per move, from the slot\'s screen rect — any zoom); a mouse move with no button, a pointercancel (a second finger) or a lost capture end it; update() is ignored while dragging', () => {
  const d = fresh(), sets = [];
  const B = U.wheelBody({ get: () => 0, set: v => sets.push(Math.round(v * 1000) / 1000), doc: d });
  d.body.append(B.el);
  const { press: w, slot, w: sl } = wheelOf(B);
  // the slot: 160 layout px at zoom 0.5 → 80 screen px from y 100; the thumb 13 screen px
  place(slot, 10, 100, 15, 80); layout(slot, 30, 160);
  ptr(w, 'pointerdown', 17, 106.5, { pointerId: 3, pointerType: 'touch' }); // the thumb's centre at the top: 1
  assert.deepEqual([sets, w._cap, sl.classList.contains('rig-on'), B.dragging()], [[1], 3, true, true]);
  ptr(w, 'pointermove', 17, 140, { pointerId: 3, pointerType: 'touch' }); // the middle
  ptr(w, 'pointermove', 17, 400, { pointerId: 3, pointerType: 'touch' }); // past the bottom: 0
  ptr(w, 'pointermove', 17, 140, { pointerId: 9, pointerType: 'touch' }); // another finger: not this drag
  assert.deepEqual(sets, [1, 0.5, 0]);
  B.update(0.8);
  assert.equal(B.value(), 0, 'the host\'s value waits while the finger holds it');
  ptr(w, 'pointercancel', 17, 400, { pointerId: 3, pointerType: 'touch' });
  assert.deepEqual([B.dragging(), w._cap, sl.classList.contains('rig-on')], [false, null, false], 'a second finger (gesture.js pointercancel) ends it');
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

test('wheelBody: keys on the slider (or the screen: the module\'s first child, canvas-2a-sim) — arrows ±1/127, Page Up / Down ±16/127, Home 0, End 1 (consumed: never a canvas nudge); other keys stay the page\'s', () => {
  const d = fresh(), sets = [];
  const B = U.wheelBody({ get: () => 64 / 127, set: v => sets.push(Math.round(v * 127)), doc: d });
  d.body.append(B.el);
  const { w, press } = wheelOf(B);
  const e1 = key(w, 'ArrowUp');
  key(w, 'ArrowRight'); key(w, 'ArrowDown'); key(w, 'PageUp'); key(w, 'PageDown'); key(w, 'PageDown'); key(w, 'Home'); key(press, 'End');
  assert.deepEqual(sets, [65, 66, 65, 81, 65, 49, 0, 127]);
  assert.equal(e1._stop, true, 'consumed');
  const e2 = key(w, 'x');
  assert.deepEqual([sets.length, !!e2._stop], [8, false]);
  B.destroy();
});

test('wheelBody: "+N on other tracks" — hidden at 0, "+N tracks" on the screen (its aria label and tip say it whole); a tap calls onJump (never the world\'s press, never the wheel\'s); its keys are its own', () => {
  const d = fresh(), jumps = [], sets = [];
  const B = U.wheelBody({ doc: d, onJump: () => jumps.push('jump'), set: v => sets.push(v) });
  d.body.append(B.el);
  const { oth: o, press } = wheelOf(B);
  assert.deepEqual([o.tagName, o.hidden, B.others(), press.contains(o)], ['BUTTON', true, 0, true]);
  B.setOthers(3);
  assert.deepEqual([o.hidden, o.textContent, o.getAttribute('aria-label'), o.title], [false, '+3 tracks', '+3 on other tracks: list them', '+3 on other tracks — tap to list them']);
  B.setOthers(1);
  assert.deepEqual([o.textContent, o.getAttribute('aria-label')], ['+1 track', '+1 on other track: list them']);
  const p = ptr(o, 'pointerdown', 1, 1);
  o.click();
  assert.deepEqual([jumps, !!p._stop, B.dragging(), sets.length], [['jump'], true, false, 0]);
  key(o, 'ArrowUp');
  assert.equal(sets.length, 0, 'the chip\'s keys never move the wheel');
  B.setOthers(0);
  assert.deepEqual([o.hidden, o.textContent, o.hasAttribute('aria-label')], [true, '', false]);
  B.setOthers(NaN);
  assert.equal(o.hidden, true);
  B.destroy();
});

// UI fixes
test('(U3) two fingers win on the wheel: the press\'s jump and the drag are rolled back by the two-finger cancel (set(v0): the value from before the press); a plain pointercancel or a lift keeps them', () => {
  const d = fresh(), sets = [];
  const B = U.wheelBody({ get: () => 0.25, set: v => sets.push(Math.round(v * 1000) / 1000), doc: d });
  d.body.append(B.el);
  const { press: w, slot, w: sl } = wheelOf(B);
  place(slot, 10, 100, 15, 80); layout(slot, 30, 160);
  ptr(w, 'pointerdown', 17, 106.5, { pointerId: 3, pointerType: 'touch' }); // the jump: 1
  ptr(w, 'pointermove', 17, 140, { pointerId: 3, pointerType: 'touch' });
  ptr(w, 'pointercancel', 17, 140, { pointerId: 3, pointerType: 'touch', gesture: 'two-finger' });
  assert.deepEqual([sets, B.value(), B.dragging(), sl.classList.contains('rig-on')], [[1, 0.5, 0.25], 0.25, false, false], 'back to 0.25, sent once more');
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
  cls(B.el, 'rig-mothers').click();
  assert.deepEqual(got, ['rig-mothers']);
  B.destroy();
});

/* ---------------------------------------------------------------- Velocity, Aftertouch, Bend */
test('veloBody: the default curve (the diagonal) with the last velocity on it — dot, drop line, bar, value, aria; a custom curve; update ignores NaN and clamps', () => {
  const d = fresh();
  const B = U.veloBody({ get: () => 100 / 127, doc: d });
  const scr = cls(B.el, 'rig-disp'), crv = cls(B.el, 'rig-mcrv'), dot = cls(B.el, 'rig-mdot'), drop = cls(B.el, 'rig-mdrop'), fill = cls(B.el, 'rig-mfill');
  assert.deepEqual([scr.getAttribute('role'), scr.getAttribute('aria-label'), crv.getAttribute('d'), cls(B.el, 'rig-mcurve').getAttribute('viewBox'), cls(B.el, 'rig-mlab').textContent],
    ['meter', 'Last velocity', 'M 0 100 L 100 0', '0 0 100 100', 'Vel']);
  assert.deepEqual([dot.getAttribute('cx'), dot.getAttribute('cy'), drop.getAttribute('d'), fill.style.height, cls(B.el, 'rig-mval').textContent, scr.getAttribute('aria-valuenow')],
    ['78.7', '21.3', 'M 78.7 100 V 21.3', '78.7%', '100', '100']);
  B.update(0.5);
  assert.deepEqual([dot.getAttribute('cx'), dot.getAttribute('cy'), cls(B.el, 'rig-mval').textContent], ['50', '50', '64']);
  B.update(NaN); B.update(2);
  assert.deepEqual([B.value(), cls(B.el, 'rig-mval').textContent], [1, '127']);
  const C = U.veloBody({ curve: [[0, 0], [0.5, 0.8], [1, 1]], doc: d });
  C.update(0.25);
  assert.deepEqual([cls(C.el, 'rig-mcrv').getAttribute('d'), cls(C.el, 'rig-mdot').getAttribute('cy')], ['M 0 100 L 50 20 L 100 0', '60'], 'a custom curve: the dot on it');
  B.destroy(); C.destroy();
});

test('atBody / bendBody: a level bar from the bottom (0…127) and a bipolar one from the centre (−100…+100 %, up = up); the same value twice writes nothing', () => {
  const d = fresh();
  const A = U.atBody({ get: () => 0.5, doc: d }), Bn = U.bendBody({ get: () => 0, doc: d });
  const am = cls(A.el, 'rig-disp');
  assert.deepEqual([am.getAttribute('role'), am.getAttribute('aria-label'), cls(A.el, 'rig-mfill').style.height, cls(A.el, 'rig-mval').textContent, cls(A.el, 'rig-mlab').textContent],
    ['meter', 'Aftertouch', '50%', '64', 'AT']);
  A.update(1);
  assert.deepEqual([cls(A.el, 'rig-mfill').style.height, am.getAttribute('aria-valuenow')], ['100%', '127']);
  cls(A.el, 'rig-mfill').style.height = 'x';
  A.update(1);
  assert.equal(cls(A.el, 'rig-mfill').style.height, 'x', 'change-gated');
  const bm = cls(Bn.el, 'rig-disp'), bf = () => cls(Bn.el, 'rig-mfill');
  assert.deepEqual([bm.getAttribute('aria-label'), !!cls(Bn.el, 'rig-mmid'), cls(Bn.el, 'rig-mbar').classList.contains('rig-mbi'), bf().style.top, bf().style.height, cls(Bn.el, 'rig-mval').textContent, cls(Bn.el, 'rig-mlab').textContent],
    ['Pitch bend', true, true, '50%', '0%', '0', 'Bend']);
  Bn.update(-0.5);
  assert.deepEqual([bf().style.top, bf().style.height, cls(Bn.el, 'rig-mval').textContent, bm.getAttribute('aria-valuenow')], ['50%', '25%', '−50%', '-50']);
  Bn.update(3);
  assert.deepEqual([bf().style.top, bf().style.height, cls(Bn.el, 'rig-mval').textContent], ['0%', '50%', '+100%']);
  A.destroy(); Bn.destroy();
});

/* ---------------------------------------------------------------- CC, Note */
// a plain body over a plain state: edits land in `edits` (one per gesture) and apply to the state (as the host would)
function rig(kind, st0, extra = {}) {
  const d = fresh(), edits = [], sets = [], st = Object.assign({ kind }, st0);
  const o = Object.assign({ doc: d, get: () => st, edit: f => { edits.push(JSON.parse(JSON.stringify(f))); Object.assign(st, JSON.parse(JSON.stringify(f))); }, set: (k, v) => sets.push(k + ':' + v) }, extra);
  const B = U.bodyFor(kind, o);
  d.body.append(B.el);
  return { d, B, st, edits, sets };
}
const txt = (root, c) => { const n = cls(root, c); return n ? n.textContent : null; };

test('ccBody (2b → MOD1): the controller number (a box: one edit per key), the channel (Omni / 1…16) with its caption, Learn arms o.learn(true) and shows it (setLearn from the host) — the knob row; the value meter on the screen', () => {
  const learns = [];
  const R = rig('cc', { cc: 7, ch: 0, v: 0.5 }, { learn: on => learns.push(on) }), B = R.B;
  const rows = rowsOf(B.el), kr = rows[1], nb = cls(kr, 'wk-nb'), learn = cls(kr, 'rig-mlearn');
  assert.deepEqual([rows.map(r => r.className.replace('rig-row rig-', '')).join(), kr.children.length], ['screen,knobs,jacks', 3]);
  assert.deepEqual([nb.parentNode === kr.children[0], cls(kr.children[1], 'wk-menu') !== null, learn.parentNode === kr.children[2]], [true, true, true], 'number · channel · Learn');
  assert.deepEqual([nb.getAttribute('aria-valuetext'), txt(nb, 'wk-lab'), txt(B.el, 'wk-mtxt'), txt(kr.children[1], 'rig-cap'), learn.textContent, learn.getAttribute('aria-pressed'), txt(B.el, 'rig-mval'), cls(B.el, 'rig-mfill').style.height, txt(B.el, 'rig-mlab')],
    ['7', 'CC', 'Omni', 'CHANNEL', 'Learn', 'false', '64', '50%', 'Val']);
  key(nb, 'ArrowUp');
  assert.deepEqual([R.edits, R.st.cc, nb.getAttribute('aria-valuetext')], [[{ cc: 8 }], 8, '8']);
  learn.click();
  assert.deepEqual([learns, learn.textContent, learn.getAttribute('aria-pressed'), B.armed(), learn.classList.contains('rig-on')], [[true], 'Listening…', 'true', true, true]);
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
  assert.deepEqual([txt(B.el, 'rig-mval'), cls(B.el, 'rig-mfill').style.height], ['127', '100%']);
  assert.equal(cls(B.el, 'rig-disp').getAttribute('aria-label'), 'MIDI CC');
  B.destroy();
});

test('noteBody (MOD1 review, reviewer 2 P3): a readable keyboard — two octaves (14 white keys, 10 black: a piano\'s, not 128 slivers) from a C — lights the last note and names it; the window follows the notes played (an octave step, only when a note falls outside it)', () => {
  const N = rig('note', {}), K = N.B, scr = cls(K.el, 'rig-disp'), kb = cls(K.el, 'rig-mkeys');
  const marks = all(K.el).filter(n => n.classList && n.classList.contains('rig-mkeyon')), [mw, mb] = marks;
  const wp = cls(K.el, 'rig-mwhite').getAttribute('d'), bp = cls(K.el, 'rig-mblack').getAttribute('d');
  const lit = () => marks.map(m => (m.hasAttribute('display') ? '-' : m.getAttribute('x') + '/' + m.getAttribute('width'))).join(' ');
  assert.deepEqual([scr.getAttribute('role'), scr.getAttribute('aria-label'), kb.getAttribute('viewBox'), (wp.match(/M/g) || []).length, (bp.match(/M/g) || []).length, marks.length, lit(), txt(K.el, 'rig-mval'), txt(K.el, 'rig-mlab'), kb.getAttribute('data-lo')],
    ['meter', 'Last note', '0 0 140 40', 14, 10, 2, '- -', '—', 'Note', '48']);
  assert.deepEqual([mw.getAttribute('height'), mb.getAttribute('height'), K.el.children.length > 0 && all(K.el).indexOf(mw) < all(K.el).indexOf(cls(K.el, 'rig-mblack')), all(K.el).indexOf(mb) > all(K.el).indexOf(cls(K.el, 'rig-mblack'))], ['40', '24', true, true], 'a white key lit under the black keys, a black one over them');
  K.update(60);
  assert.deepEqual([lit(), txt(K.el, 'rig-mval'), scr.getAttribute('aria-valuenow'), kb.getAttribute('data-lo')], ['70/10 -', 'C4', '60', '48'], 'C4: the eighth white key of C3 … B4');
  K.update(61);
  assert.deepEqual([lit(), txt(K.el, 'rig-mval'), kb.getAttribute('data-lo')], ['- 77/6', 'C#4', '48'], 'C#4: a black key between the eighth and ninth');
  K.update(48);
  assert.deepEqual([lit(), kb.getAttribute('data-lo')], ['0/10 -', '48'], 'C3: the first key, the window stays');
  K.update(72);
  assert.deepEqual([lit(), txt(K.el, 'rig-mval'), kb.getAttribute('data-lo')], ['70/10 -', 'C5', '60'], 'above it: the window steps up (C4 … B5)');
  K.update(30);
  assert.deepEqual([lit(), txt(K.el, 'rig-mval'), kb.getAttribute('data-lo')], ['- 37/6', 'F#1', '24'], 'below it: down to the note\'s octave (C1 … B2)');
  K.update(127);
  assert.deepEqual([lit(), txt(K.el, 'rig-mval'), kb.getAttribute('data-lo')], ['110/10 -', 'G9', '108']);
  K.update(0);
  assert.deepEqual([lit(), txt(K.el, 'rig-mval'), kb.getAttribute('data-lo')], ['0/10 -', 'C-1', '0']);
  K.update(null);
  assert.deepEqual([lit(), txt(K.el, 'rig-mval')], ['- -', '—']);
  assert.ok(all(K.el).length <= 48, all(K.el).length + ' elements');
  K.destroy();
});

/* ---------------------------------------------------------------- (MOD1 §4.1) the slot faces: rig-ui's faces over slot hosts */
// the LFO / Envelope / Macros / Chaos bodies are rig-ui faces (slot: true) on sx-host slot hosts: on the selector fake DOM
// (tests/serum-ui-stubs/dom.js; the faces query their own subtree), the modules loaded first (U.ready). The face recipes and donors are
// tests/rig-ui.test.mjs's; here the body contract main.js mounts.
const SD = await import('./serum-ui-stubs/dom.js');
const sweep = SD.safeAssert(assert);
const KEY = { lfo: 'l3', env: 'e2', macro: 'm1', chaos: 'h4' };
function srig(kind, st0, extra = {}) {
  const d = SD.fresh(), calls = [], st = Object.assign({ kind }, st0);
  const o = Object.assign({ doc: d, get: () => st, edit: f => { calls.push(['edit', JSON.parse(JSON.stringify(f))]); Object.assign(st, JSON.parse(JSON.stringify(f))); },
    set: (k, v) => calls.push(['set', k, v]), live: f => calls.push(['live', Object.keys(f)]), cancel: () => calls.push(['cancel']), bpm: () => 120, devKey: KEY[kind] }, extra);
  const B = U.bodyFor(kind, o);
  d.body.append(B.el);
  return { d, B, st, calls };
}
// the old body's panel for parity: the same panel class mounted on a second slot host (sx-host's registered view of the kind)
async function oldPanel(kind, extra) {
  const SX = await import('../sx-host.js?v=9'), song = await import('../song.js?v=9');
  const d = SD.fresh(), box = d.createElement('div');
  d.body.appendChild(box);
  const H = SX.slotHost(kind, Object.assign({ doc: d, get: () => song.normModDev({ kind }), edit() {}, live() {}, cancel() {}, devKey: KEY[kind] }, extra));
  const V = H.mount({ lfo: 'lfo', env: 'env', macro: 'macros', chaos: 'chaos' }[kind], box, { k: H.slot, bare: true, dev: H.dev });
  await SD.flush(d);
  return { H, V, box, d };
}
const FACE_OF = { lfo: 'lfo', env: 'env', macro: 'macros', chaos: 'chaos' };

test('(MOD1 §4.1) the LFO / Envelope / Macros / Chaos bodies are rig-ui faces on their slot hosts (bodyFor by kind): the face of its kind, titled by the module id\'s number, bare, data-nomod, at its RIG-grid width; every data-dest of the old panel on it; a body made before the modules load fills in when they do', async () => {
  const early = U.bodyFor('lfo', { doc: SD.fresh(), get: () => ({ kind: 'lfo' }), edit() {}, devKey: 'l1' });
  early.update(0.5);   // (a live value before the face exists: kept for it)
  await U.ready();
  sweep.deepEqual(U.SLOT_KINDS, ['lfo', 'env', 'macro', 'chaos']);
  sweep.ok(early.host() && early.el.querySelector('.rig-face'), 'filled in');
  sweep.equal(early.host().liveV, 0.5, 'the early value reached its host');
  early.destroy();
  const want = { lfo: ['l1.rate', 'LFO 3'], env: ['e2.att', 'Envelope 2'], macro: ['m1', 'Macros 1'], chaos: ['c1.rate', 'Chaos 4'] };
  for (const [kind, [dest, title]] of Object.entries(want)) {
    const { B } = srig(kind, {});
    const root = B.el.querySelector('.sx-root'), face = B.el.querySelector('.rig-face');
    sweep.deepEqual([B.el.className, B.el.getAttribute('data-slot-kind'), root.className, root.getAttribute('data-nomod'), root.style.width, face.getAttribute('data-rig-kind'), face.getAttribute('aria-label')],
      ['cv-mface', kind, 'sx-root sx-part', '1', faceW(MOD_COLS[kind]) + 'px', FACE_OF[kind], title], kind);
    sweep.equal(root.parentNode === B.el && face.parentNode === root, true, kind + ': the face in its host root');
    sweep.deepEqual([B.view().face.kind, B.view().face.w], [FACE_OF[kind], faceW(MOD_COLS[kind])], kind + ': view() is the face');
    const ctl = B.el.querySelector('[data-dest="' + dest + '"]');
    sweep.ok(ctl && ctl.getAttribute('data-nomod') === '1' && face.contains(ctl), kind + ' ' + dest);
    sweep.equal(B.el.querySelectorAll('.sx-tname').length, 0, kind + ': no title (the module bar has it)');
    const jacks = B.el.querySelectorAll('[data-jack]').map(n => n.getAttribute('data-jack'));
    sweep.deepEqual(jacks, kind === 'macro' ? ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8'] : ['out'], kind + ': its jacks');
    if (kind !== 'macro') {
      const j = B.el.querySelector('[data-jack="out"]');
      sweep.deepEqual([j.className, j.getAttribute('data-rig-sig'), j.getAttribute('aria-label')], ['rig-jack cv-jack cv-fjack', 'mod', title + ' · OUT'], kind + ': OUT (an inline anchor)');
    }
    const O = await oldPanel(kind), mine = new Set(B.el.querySelectorAll('[data-dest]').map(e => e.getAttribute('data-dest')));
    sweep.deepEqual(O.box.querySelectorAll('[data-dest]').map(e => e.getAttribute('data-dest')).filter(x => !mine.has(x)), [], kind + ': every data-dest of the old panel on the face');
    O.H.destroy();
    sweep.equal(typeof B.sync, 'function');
    B.destroy();
    sweep.equal(B.el.parentNode, null);
  }
  // the other kinds keep their own (plain) faces
  const d = SD.fresh();
  sweep.deepEqual(['cc', 'note', 'nope'].map(k => { const b = U.bodyFor(k, { doc: d, get: () => ({}), edit() {} }); const c = b ? b.el.getAttribute('data-rig-kind') : null; if (b) b.destroy(); return c; }),
    ['cc', 'note', null]);
});

test('(MOD1 §4.1) body edits through the face: a knob gesture → live per move, ONE edit at the end (main.js: one History step); without o.live only the edit; macro knobs → set(k, v) per move + edit {v}; a toggle → one edit; update(v) feeds the face\'s live displays; sync re-reads the device', async () => {
  await U.ready();
  const L = srig('lfo', { lfo: { mono: 1 }, rate: 0.5 });
  const rate = L.B.el.querySelector('[data-dest="l1.rate"]');
  SD.ptr(rate, 'pointerdown', 10, 100); SD.ptr(rate, 'pointermove', 10, 80); SD.ptr(rate, 'pointermove', 10, 60); SD.ptr(rate, 'pointerup', 10, 60);
  const kinds = L.calls.map(c => c[0]);
  sweep.deepEqual([kinds[0], kinds.filter(k => k === 'edit').length, kinds.at(-1)], ['live', 1, 'edit']);
  sweep.deepEqual(Object.keys(L.calls.at(-1)[1]), ['rate']);
  sweep.equal(L.st.rate, L.calls.at(-1)[1].rate);
  // without o.live (today's main.js): the moves stay in the face, the end is the one edit
  const N = srig('lfo', { lfo: { mono: 1 }, rate: 0.5 }, { live: undefined });
  const r2 = N.B.el.querySelector('[data-dest="l1.rate"]');
  SD.ptr(r2, 'pointerdown', 10, 100); SD.ptr(r2, 'pointermove', 10, 70); SD.ptr(r2, 'pointerup', 10, 70);
  sweep.deepEqual(N.calls.map(c => c[0]), ['edit']);
  // the MONO button = GLOBAL / PER NOTE: one edit, the lfo object whole
  N.calls.length = 0;
  N.B.el.querySelectorAll('.wk-tog').find(b => b.textContent.trim() === 'MONO').click();
  sweep.deepEqual([N.calls.length, N.calls[0][1].lfo.mono, N.st.lfo.mono], [1, 0, 0]);
  // the monitor: a level, or { v, ph } (the LFO's phase dot in its editor)
  N.B.update({ v: 0.3, ph: 0.75 });
  sweep.equal(N.B.host().snap.lfoPh[0], 0.75);
  sweep.equal(N.B.value(), 0.3);
  // an outside change (undo / redo): sync shows the device again
  N.st.lfo = Object.assign({}, N.st.lfo, { mono: 1 });
  N.B.sync();
  sweep.equal(N.B.el.querySelectorAll('.wk-tog').find(b => b.textContent.trim() === 'MONO').getAttribute('aria-pressed'), 'true');
  const Mc = srig('macro', { v: [0.5, 0, 0, 0, 0, 0, 0, 0] });
  const k1 = Mc.B.el.querySelector('[data-dest="m1"]');
  SD.ptr(k1, 'pointerdown', 10, 100); SD.ptr(k1, 'pointermove', 10, 80); SD.ptr(k1, 'pointerup', 10, 80);
  sweep.ok(Mc.calls.some(c => c[0] === 'set' && c[1] === 0));
  sweep.deepEqual(Mc.calls.filter(c => c[0] === 'edit').map(c => Object.keys(c[1])), [['v']]);
  sweep.equal(Mc.calls.some(c => c[0] === 'live'), false);
  sweep.deepEqual(Mc.B.knobs().map(k => k.getAttribute('data-dest')), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'], 'knobs(): the eight macro knobs');
  sweep.equal(Mc.B.knobs()[0] === k1, true);
  // the ENV: the curves (0…1, 0.5 linear) shown as before: 50 / 67 / 67 %; START / END on the face (ENV 2's variant)
  const E = srig('env', {});
  sweep.deepEqual(['e2.ca', 'e2.cd', 'e2.cr'].map(id => E.B.el.querySelector('[data-dest="' + id + '"]').getAttribute('aria-valuetext')), ['50%', '67%', '67%']);
  sweep.deepEqual(['e2.start', 'e2.end'].map(id => !!E.B.el.querySelector('.rig-face').querySelector('.rig-knobs').parentNode.querySelector('[data-dest="' + id + '"]')), [true, true]);
  // the Chaos: S&H and RATE (PageUp) → one edit each
  const C = srig('chaos', { chaos: { mono: 0, sh: 0 }, rate: 0.4 });
  C.B.el.querySelectorAll('.wk-tog').find(b => b.textContent.trim() === 'S&H').click();
  SD.fire(C.B.el.querySelector('[data-dest="c1.rate"]'), 'keydown', { key: 'PageUp' });
  sweep.deepEqual(C.calls.filter(c => c[0] === 'edit').map(c => Object.keys(c[1]).join()), ['chaos', 'rate']);
  for (const R of [L, N, Mc, E, C]) R.B.destroy();
});

test('(MOD1 §4.1) the ⋯ items are the old body\'s, item for item: the panel\'s own and the host\'s Bypass All / Remove All Destinations — no Swap with ▸, no Lock, no MIDI learn', async () => {
  await U.ready();
  const labels = L => L.map(i => (i.sep ? '|' : i.label + (i.sub ? ' ▸' : '')));
  for (const kind of ['lfo', 'env', 'macro', 'chaos']) {
    const rows = { count: () => 2, bypassed: () => false, bypass() {}, remove() {} };
    const { B } = srig(kind, {}, { rows });
    const O = await oldPanel(kind, { rows });
    const mine = labels(B.menuItems()), old = labels(O.V.menuItems());
    sweep.deepEqual(mine, old, kind + ': ' + mine.join(' '));
    sweep.equal(mine.some(x => /^Swap with|^Lock Module|MIDI/.test(x)), false, kind);
    if (kind !== 'macro') sweep.deepEqual(mine.slice(-2), ['Bypass All Destinations', 'Remove All Destinations'], kind);
    else sweep.deepEqual(mine, [], 'macro: none (as before)');
    O.H.destroy();
    B.destroy();
  }
  const { B } = srig('env', {});
  sweep.deepEqual(labels(B.menuItems()).slice(0, 3), ['Legato Inverted', 'Grid ▸', 'Voice Steal Retrigger']);
  B.destroy();
});

test('(MM, IMPL-MM §7.2) the MONO lock through the body: lock: { mono: 1 } reaches the slot host — the LFO\'s and the Chaos face\'s MONO switch is lit, disabled, its tap makes no call (no live, no edit); without it (the tracks\' modules) the tap edits as before; the other kinds ignore the option', async () => {
  await U.ready();
  const monoOf = B => B.el.querySelectorAll('.wk-tog').find(b => b.textContent.trim() === 'MONO');
  for (const [kind, st0, field] of [['lfo', { lfo: { mono: 0 } }, 'lfo'], ['chaos', { chaos: { mono: 0, sh: 0 } }, 'chaos']]) {
    const L = srig(kind, st0, { lock: { mono: 1 } });
    const m = monoOf(L.B);
    sweep.deepEqual([m.getAttribute('aria-pressed'), m.getAttribute('aria-disabled'), m.title], ['true', 'true', 'The master’s modulators are global (it has no notes)'], kind + ': locked');
    m.click(); m.click();
    sweep.deepEqual([L.calls, L.st[field].mono], [[], 0], kind + ': a tap changes nothing');
    L.B.destroy();
    const T0 = srig(kind, st0);
    const m0 = monoOf(T0.B);
    sweep.deepEqual([m0.getAttribute('aria-pressed'), m0.getAttribute('aria-disabled')], ['false', null], kind + ': a track\'s module: as before');
    m0.click();
    sweep.deepEqual([T0.calls.length, T0.calls[0][0], T0.st[field].mono], [1, 'edit', 1], kind + ': its tap edits');
    T0.B.destroy();
  }
  for (const kind of ['env', 'macro']) { const R = srig(kind, {}, { lock: { mono: 1 } }); sweep.ok(R.B.host(), kind + ': built'); sweep.equal(monoOf(R.B), undefined, kind + ': no MONO'); R.B.destroy(); }
});

test('(MOD1 §4.3, P2-10) o.shown reaches the face\'s view: an off-screen face is no shown view of its slot host (its tick and paints stop); host() is the slot host (Cut B\'s bodyAns reads its ring), update with F takes the ring path', async () => {
  await U.ready();
  let on = false;
  const hf = () => 2000, { B } = srig('lfo', {}, { shown: () => on, heardFrame: hf, sampleRate: () => 48000 });
  const H = B.host();
  sweep.deepEqual([H.kind, H.views.length, H.anyShown(), H.host.heardFrame === hf], ['lfo', 1, false, true], 'off screen');
  on = true;
  sweep.equal(H.anyShown(), true, 'on screen');
  B.update({ v: 0.2, ph: 0.4, F: 1000 });
  sweep.ok(H.sl, 'the ring (H.sl): Cut B\'s path');
  B.destroy();
  const { B: C } = srig('chaos', {});
  sweep.equal(C.host().anyShown(), true, 'no o.shown: always shown (as before)');
  C.destroy();
});

test('(MOD1 §4.1) the Chaos face: its scope screen (S&H on it), BPM · RATE · MONO, OUT; the scope follows the monitor', async () => {
  await U.ready();
  const { B, d } = srig('chaos', {});
  const face = B.el.querySelector('.rig-face'), rows = face.children.filter(n => n.classList.contains('rig-row'));
  sweep.deepEqual(rows.map(r => r.className.replace('rig-row rig-', '')), ['screen', 'knobs', 'jacks']);
  const disp = rows[0].querySelector('.rig-disp');
  sweep.ok(disp.querySelector('canvas') && disp.querySelectorAll('.wk-tog').map(b => b.textContent.trim()).join() === 'S&H', 'the scope and S&H');
  sweep.deepEqual(rows[1].children.map(c => (c.children[0].getAttribute('data-dest') || c.children[0].textContent.trim())), ['c1.bpm', 'c1.rate', 'MONO']);
  const sc = B.view().panel.ctx.scope;
  const n0 = sc.n;
  B.update(0.25); await SD.flush(d); B.update(0.75); await SD.flush(d);
  sweep.ok(sc.n >= n0 + 2, 'two samples: ' + n0 + ' → ' + sc.n);
  B.destroy();
});

test('(MOD1 G8) no Serum-part UI: cv-mods-ui.js and rig-ui.js name none of mountSlot / mountPart / PART_W / PART_PH / COL / phaseOf / partView; the faces and their menus say no "ENV" (the LFO\'s mode ENV is no module name), no "Serum", no "Xfer", "Macro" only as a knob\'s name', async () => {
  for (const f of ['cv-mods-ui.js', 'rig-ui.js']) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    for (const w of ['mountSlot', 'mountPart', 'PART_W', 'PART_PH', 'phaseOf', 'partView']) sweep.equal(src.includes(w), false, f + ': ' + w);
    sweep.equal(/\bCOL\b/.test(src), false, f + ': COL');
  }
  await U.ready();
  const bad = [];
  const scan = (kind, el, items) => {
    const words = [];
    const walk = n => { for (const c of n.children) { if (c.getAttribute('aria-label') === 'LFO mode') continue; for (const v of [c.getAttribute('aria-label'), c.getAttribute('title'), c.children.length ? '' : c.textContent]) if (v) words.push(v); walk(c); } };
    walk(el);
    for (const i of items) if (i && i.label) words.push(i.label);
    for (const w of words) if (/\bENV\b|Serum|Xfer|\bMacro\b(?! [1-8]\b)/.test(w)) bad.push(kind + ': ' + w);
  };
  for (const kind of ['lfo', 'env', 'macro', 'chaos']) { const { B } = srig(kind, {}, { rows: { count: () => 1, bypassed: () => false, bypass() {}, remove() {} } }); scan(kind, B.el, B.menuItems()); B.destroy(); }
  for (const kind of PLAIN) { const d = fresh(), B = U.bodyFor(kind, { doc: d, get: () => (kind === 'cc' ? { kind: 'cc', cc: 1, ch: 0 } : 0), edit() {} }); scan(kind, B.el, []); B.destroy(); }
  sweep.deepEqual(bad, []);
});
