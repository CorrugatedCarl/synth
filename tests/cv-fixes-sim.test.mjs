import './v8-guard.mjs';
// Stage-1b review fixes (lane 1) in the page simulation, with canvas-sim's scripted world (its band is set per test):
// the replace notice undoes only its own step; a cancelled / no-op drag and an already-tidy Tidy keep the redo stack;
// the default camera fits the instrument in a portrait band and is owed while ROLL shows; a Serum preset load relabels
// the canvas. One boot (tests/main-sim.mjs); strings and numbers only into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/cv-fixes-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as cvWorld from '../cv-world.js?v=9';

const VP = { left: 0, top: 48 }, BAND = { left: 44, top: 48, right: 1400, bottom: 700 };
function scriptedWorld(root) {
  const L = {};
  const W = {
    el: root, k: 1, cam: { tx: 0, ty: 0, k: 1 }, items: new Map(), log: [], selected: null,
    setCamera(c) { W.cam = { tx: c.tx, ty: c.ty, k: c.k }; W.k = c.k; W.log.push('cam ' + [c.tx, c.ty, c.k].join(',')); W.emit('cameraend', { cam: W.cam, zoomed: true }); },
    band: () => Object.assign({}, BAND),
    toClient: (wx, wy) => ({ x: VP.left + wx * W.k + W.cam.tx, y: VP.top + wy * W.k + W.cam.ty }),
    toWorld: (x, y) => ({ x: (x - VP.left - W.cam.tx) / W.k, y: (y - VP.top - W.cam.ty) / W.k }),
    add(it) { W.items.set(it.id, it); return () => W.remove(it.id); },
    remove(id) { W.items.delete(id); },
    update() {}, clear() { W.items.clear(); W.log.push('clear'); },
    select(id) { W.selected = id; W.emit('select', { id }); },
    focusItem(id, o) { W.log.push('focus ' + id + ' ' + JSON.stringify(o || {})); },
    dragPointer() {},
    on(t, fn) { (L[t] || (L[t] = [])).push(fn); return () => { L[t] = L[t].filter(f => f !== fn); }; },
    emit(t, d) { for (const f of (L[t] || []).slice()) f(d); },
  };
  return W;
}

const sim = await bootMain({ ls: fakeStorage({}), hash: '#minimoog', synthTest: { cvWorld: root => scriptedWorld(root) } });
const api = sim.api, cv = globalThis.__synthTest.cv, W = cv.world();
sim.raf(); await sim.settle(5);
const P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack), V = () => cv.view();
let pid = 300;
const pe = (el, type, x, y) => el.dispatchEvent({ type, target: el, currentTarget: el, button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1, pointerId: pid,
  pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, timeStamp: performance.now(), shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
  preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
function drag(m, dx, dy, end = 'pointerup') {
  pid++;
  pe(m.bar, 'pointerdown', 500, 70);
  pe(m.bar, 'pointermove', 500 + (dx || 40) / 2, 70 + dy / 2);
  pe(m.bar, 'pointermove', 500 + dx, 70 + dy);
  pe(m.bar, end, 500 + dx, 70 + dy);
}
const pos = k => { const m = V().modules.get(k); return [m.x, m.y]; };

test('the replace notice undoes only its own step: tapped at once it is Undo; after a later step (a move) the old instrument comes back as a step of its own and the move stays', () => {
  const id = T().id, from = T().model;
  assert.equal(cv.drop('prophet5', null), true);
  const note = sim.$('#notice');
  assert.match(note.textContent, /^Replaced Minimoog with Prophet-5 · tap to undo$/);
  const n1 = cv.hist.u.length;
  note.onclick();
  assert.deepEqual([P().tracks.find(x => x.id === id).model, cv.hist.u.length], [from, n1 - 1], 'at once: the replacement undone (its step popped)');
  assert.equal(cv.drop('prophet5', null), true);
  drag(V().modules.get('i1'), 0, 40);
  assert.deepEqual(pos('i1'), [0, 32], 'moved after the replacement (onto the dots)');
  assert.equal(cv.hist.undoLabel, 'Move Prophet-5');
  sim.$('#notice').onclick();
  assert.equal(T().model, from, 'the old instrument is back');
  assert.deepEqual(pos('i1'), [0, 32], 'and the later move is not undone');
  assert.equal(sim.$('#notice').hidden, true, 'the notice cleared');
  cv.undo();
  assert.deepEqual([T().model, pos('i1')[1]], ['prophet5', 32], 'its own step: Undo brings the Prophet-5 back, still moved');
  cv.undo();
  assert.deepEqual([T().model, pos('i1')[1]], ['prophet5', 0], 'then the move');
});

test('a cancelled drag (pointercancel: a second finger) and a drop on the cell it left record nothing — the redo stack survives; Tidy of a tidy canvas: no step', () => {
  drag(V().modules.get('fx1'), 160, 96);
  assert.equal(cv.hist.undoLabel, 'Move FX Panel');
  cv.undo();
  assert.equal(cv.hist.canRedoFrom(P()), true);
  const n = cv.hist.u.length;
  drag(V().modules.get('fx1'), 120, 64, 'pointercancel');
  assert.deepEqual([pos('fx1'), cv.hist.u.length, cv.hist.canRedoFrom(P())], [[1248, 0], n, true], 'cancelled: back, no step, redo kept');
  drag(V().modules.get('fx1'), 2, 1);
  assert.deepEqual([pos('fx1'), cv.hist.u.length, cv.hist.canRedoFrom(P())], [[1248, 0], n, true], 'dropped on its own cell: no step, redo kept');
  cv.redo();
  assert.deepEqual(pos('fx1'), [1408, 96], 'the undone move can still be redone');
  cv.tidy();
  const m = cv.hist.u.length;
  assert.equal(cv.hist.undoLabel, 'Tidy');
  cv.undo(); cv.redo();
  cv.tidy();
  assert.deepEqual([cv.hist.u.length, cv.hist.canRedoFrom(P())], [m, false], 'already tidy: Tidy adds no step');
  cv.undo();
  cv.tidy(); // (from the moved layout again: a real change)
  assert.equal(cv.hist.undoLabel, 'Tidy');
});

test('default camera: k = 1 when the instrument fits the band; a portrait band (rails on both sides) fits its width — its bar\'s ⋯ / ▾ clear the rail — never below CARD_K', () => {
  const r0 = BAND.right;
  try {
    for (const [right, k] of [[1400, 1], [44 + 936, (936 - 48) / 1080], [44 + 746, (746 - 48) / 1080], [44 + 400, cvWorld.CARD_K]]) {
      BAND.right = right;
      api.addTrack(); sim.raf();
      const m = V().modules.get('i1');
      assert.ok(Math.abs(W.cam.k - k) < 1e-9, `band ${right - 44}: k ${W.cam.k} ≠ ${k}`);
      assert.deepEqual([W.cam.tx, W.cam.ty], [BAND.left - VP.left + 24 - Math.round(m.x * k), BAND.top - VP.top + 24 - Math.round(m.y * k)]);
      if (k > cvWorld.CARD_K) assert.ok(VP.left + (m.x + m.w) * k + W.cam.tx <= right - 24 + 0.5, 'the whole instrument (its bar\'s right end) inside the band');
    }
  } finally { BAND.right = r0; }
});

test('default camera while ROLL shows: owed (the band has no size there), computed against the real band when CANVAS opens', () => {
  cv.openTab('roll');
  const n = W.log.length;
  api.addTrack(); sim.raf();
  assert.equal(W.log.slice(n).some(l => l.startsWith('cam ')), false, 'no camera computed under ROLL');
  cv.openTab('canvas');
  const cams = W.log.slice(n).filter(l => l.startsWith('cam '));
  assert.deepEqual(cams, ['cam 68,24,1'], 'on CANVAS: the default, 24 px inside the band past the rail');
  cv.openTab('canvas');
  assert.equal(W.log.slice(n).filter(l => l.startsWith('cam ')).length, 1, 'once');
});

test('a Serum preset load (sxLoad: the browser, next / previous, a MIDI program change) re-derives the canvas titles and route label', async () => {
  const t = api.addTrack(undefined); sim.raf();
  api.setTrackModel(t, 'serum'); sim.raf(); await sim.settle(5); sim.raf(); sim.raf();
  const v = V();
  let n = 0;
  const was = v.refresh;
  v.refresh = (...a) => { n++; return was.apply(v, a); };
  try {
    assert.equal(api.sxLoad(T(), 'f:Acid Machine'), true);
    for (let i = 0; i < 3; i++) sim.raf();
    assert.ok(n >= 1, 'cvView.refresh ran after the preset load (' + n + ')');
  } finally { v.refresh = was; }
});
