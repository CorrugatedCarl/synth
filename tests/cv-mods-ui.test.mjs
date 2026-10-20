import './v8-guard.mjs';
// cv-mods-ui.js (stage 2a lane B; docs/canvas/IMPL-2a.md §3): the modulator modules' bodies on tests/wk-dom.mjs — the Mod
// Wheel (#modw's look: a drag sets it from the slot's screen rect at any zoom, keys, update from the host, a two-finger
// cancel / lost capture end the drag, the "+N on other tracks" chip and its tap), Velocity (the default curve, the last
// velocity's dot / bar / value, a custom curve), Aftertouch and Bend (meters; Bend bipolar), bodyFor, destroy; (2b lane C,
// IMPL-2b §6.1) the editing bodies CC and Note: their DOM, one o.edit per gesture, update / sync; (milestone 3 lane B)
// LFO, ENV, Macro and Chaos as Serum's own panels over slot hosts (the body contract; the panels: tests/sx-host.test.mjs).
// Never passes fake-DOM nodes to assert.* (strings and numbers only; the Serum-panel tests through safeAssert).
// Run alone: node --max-old-space-size=2048 --test tests/cv-mods-ui.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh, all, ptr, key, place, layout, Ev } from './wk-dom.mjs';
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

/* ---------------------------------------------------------------- milestone 3 (IMPL-3 §2.2–2.3): Serum's own panels */
// the LFO / ENV / Macro / Chaos bodies are Serum's panels over a slot host (sx-host slotHost + sx-ui-mod mountSlot): on the
// selector fake DOM (tests/serum-ui-stubs/dom.js; the panels query their own subtree), the Serum UI modules loaded first
// (U.ready). The panel behaviour itself is tests/sx-host.test.mjs's; here the body contract main.js mounts.
const SD = await import('./serum-ui-stubs/dom.js');
const sweep = SD.safeAssert(assert);
function srig(kind, st0, extra = {}) {
  const d = SD.fresh(), calls = [], st = Object.assign({ kind }, st0);
  const o = Object.assign({ doc: d, get: () => st, edit: f => { calls.push(['edit', JSON.parse(JSON.stringify(f))]); Object.assign(st, JSON.parse(JSON.stringify(f))); },
    set: (k, v) => calls.push(['set', k, v]), live: f => calls.push(['live', Object.keys(f)]), cancel: () => calls.push(['cancel']), bpm: () => 120 }, extra);
  const B = U.bodyFor(kind, o);
  d.body.append(B.el);
  return { d, B, st, calls };
}
const tag = n => n.tagName + '.' + n.className;

test('(milestone 3) the LFO / ENV / Macro / Chaos bodies are Serum\'s own panels (LfoPanel 1, EnvPanel 2, MacrosPanel, ChaosRow): bodyFor by kind, the bundled panel\'s classes, bare, data-nomod; a body made before the modules load fills in when they do', async () => {
  const early = U.bodyFor('lfo', { doc: SD.fresh(), get: () => ({ kind: 'lfo' }), edit() {} });
  early.update(0.5);   // (a live value before the panel exists: kept for it)
  await U.ready();
  sweep.deepEqual(U.SLOT_KINDS, ['lfo', 'env', 'macro', 'chaos']);
  sweep.ok(early.host() && early.el.querySelector('.sx-panel'), 'filled in');
  early.destroy();
  const want = { lfo: ['l1.rate', 'LFO 1'], env: ['e2.att', 'ENV 2'], macro: ['m1', 'MACROS'], chaos: ['c1.rate', 'CHAOS 1'] };
  for (const [kind, [dest, title]] of Object.entries(want)) {
    const { B } = srig(kind, {});
    const root = B.el.querySelector('.sx-root');
    sweep.deepEqual([B.el.className, root.className, root.getAttribute('data-nomod'), B.el.querySelector('.sx-panel').getAttribute('aria-label')],
      ['cv-mbody cv-mslot cv-m' + kind, 'sx-root sx-part', '1', title], kind);
    const ctl = B.el.querySelector('[data-dest="' + dest + '"]');
    sweep.ok(ctl && ctl.getAttribute('data-nomod') === '1', kind + ' ' + dest);
    sweep.equal(B.el.querySelectorAll('.sx-tname').length, 0, kind + ': no title (the module bar has it)');
    sweep.equal(typeof B.sync, 'function');
    B.destroy();
    sweep.equal(B.el.parentNode, null);
  }
  // the other kinds keep their own bodies; unknown → null
  const d = SD.fresh();
  sweep.deepEqual(['cc', 'note', 'nope'].map(k => { const b = U.bodyFor(k, { doc: d, get: () => ({}), edit() {} }); const c = b ? b.el.className : null; if (b) b.destroy(); return c; }),
    ['cv-mbody cv-mcc cv-medit', 'cv-mbody cv-mnote', null]);
});

test('(milestone 3) body edits: a knob gesture → live per move, ONE edit at the end (main.js: one History step); without o.live only the edit; macro knobs → set(k, v) per move + edit {v}; a toggle → one edit; update(v) feeds the panel\'s live displays; sync re-reads the device', async () => {
  await U.ready();
  const L = srig('lfo', { lfo: { mono: 1 }, rate: 0.5 });
  const rate = L.B.el.querySelector('[data-dest="l1.rate"]');
  SD.ptr(rate, 'pointerdown', 10, 100); SD.ptr(rate, 'pointermove', 10, 80); SD.ptr(rate, 'pointermove', 10, 60); SD.ptr(rate, 'pointerup', 10, 60);
  const kinds = L.calls.map(c => c[0]);
  sweep.deepEqual([kinds[0], kinds.filter(k => k === 'edit').length, kinds.at(-1)], ['live', 1, 'edit']);
  sweep.deepEqual(Object.keys(L.calls.at(-1)[1]), ['rate']);
  sweep.equal(L.st.rate, L.calls.at(-1)[1].rate);
  // without o.live (today's main.js): the moves stay in the panel, the end is the one edit
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
  sweep.deepEqual(Mc.B.el.querySelectorAll('[data-jack]').map(n => n.getAttribute('data-jack')), ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8']);
  // the ENV: Serum's default curves (0…1, 0.5 linear) shown as Serum shows them: 50 / 67 / 67 %
  const E = srig('env', {});
  sweep.deepEqual(['e2.ca', 'e2.cd', 'e2.cr'].map(id => E.B.el.querySelector('[data-dest="' + id + '"]').getAttribute('aria-valuetext')), ['50%', '67%', '67%']);
  for (const R of [L, N, Mc, E]) R.B.destroy();
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

test('noteBody: the keyboard meter lights the last note and names it', () => {
  const N = rig('note', {}), K = N.B, mark = cls(K.el, 'cv-mkeyon');
  assert.deepEqual([K.el.className, byCls(K.el, 'cv-mkey').length, byCls(K.el, 'cv-mblk').length, mark.getAttribute('display'), txt(K.el, 'cv-mval')], ['cv-mbody cv-mnote', 128, 53, 'none', '—']);
  K.update(60);
  assert.deepEqual([mark.hasAttribute('display'), mark.getAttribute('x'), txt(K.el, 'cv-mval'), K.el.getAttribute('aria-valuenow')], [false, '90', 'C4', '60']);
  K.update(61);
  assert.deepEqual([txt(K.el, 'cv-mval'), mark.getAttribute('height')], ['C#4', '24']);
  K.update(null);
  assert.deepEqual([mark.getAttribute('display'), txt(K.el, 'cv-mval')], ['none', '—']);
  K.destroy();
});
