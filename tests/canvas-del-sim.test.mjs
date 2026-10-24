import './v8-guard.mjs';
// The canvas Delete key (2026-10-23, the user: "i should be able to delete a selected module with the delete key") in the page
// simulation: Delete / Backspace delete the selected canvas modules — each removable one through its own ⋯ menu's Delete /
// Remove (a modulator: modDelete; a Serum part: sxRemovePart; a 900 Series module with its cords: PATCH.remove), the whole
// press ONE History step (song History mark / fold, main.js histFold: the steps the paths recorded fold into the one holding the
// state before the press — a no-op step on top serves —; the removed parts' ⏻ metas merged); a bar range pressed last keeps Delete;
// the instrument, an FX panel, OUT and the master canvas's modules stay with a notice that says why; the key does nothing to the
// canvas with focus in a text field, under ROLL, with a menu open, with a modifier or a repeat. The real Serum panels (canvas-3-sim's
// harness); the world a scripted one with a selection of several (selectMany / selection, cv-world's API). One boot per file;
// strings, numbers and booleans only into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/canvas-del-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as C from '../serum-core.js?v=9';
import * as CMOD from '../cv-model.js?v=9';
import * as S from '../song.js?v=9';
import { MODELS } from '../models.js?v=9';

for (const g of ['SxBase', 'SxFilt2', 'SxWarp', 'SxMod', 'SxSample', 'SxGran', 'SxSpec', 'SxSeq', 'SerumDSP', 'FXMods2', 'FXDSP', 'Dr808', 'DrSeq', 'ModCore', 'PatchDSP', 'PatchMoog', 'MASTERDSP']) globalThis[g] = null;
const VP = { left: 0, top: 48 }, BAND = { left: 44, top: 48, right: 1520, bottom: 700 };
function scriptedWorld(root) {
  const L = {};
  const W = {
    el: root, k: 1, cam: { tx: 0, ty: 0, k: 1 }, items: new Map(), selected: null, selection: [], mode: 'always',
    setCamera(c) { W.cam = { tx: c.tx, ty: c.ty, k: c.k }; W.k = c.k; W.emit('cameraend', { cam: W.cam, zoomed: true }); },
    band: () => Object.assign({}, BAND),
    toClient: (wx, wy) => ({ x: VP.left + wx * W.k + W.cam.tx, y: VP.top + wy * W.k + W.cam.ty }),
    toWorld: (x, y) => ({ x: (x - VP.left - W.cam.tx) / W.k, y: (y - VP.top - W.cam.ty) / W.k }),
    add(it) { W.items.set(it.id, it); return () => W.remove(it.id); },
    // (cv-world: an item that goes leaves the selection)
    remove(id) { W.items.delete(id); W.selection = W.selection.filter(x => x !== id); if (W.selected === id) W.selected = W.selection.at(-1) || null; },
    update() {}, clear() { W.items.clear(); W.selection = []; W.selected = null; },
    select(id) { W.selected = id; W.selection = id ? [id] : []; W.emit('select', { id, ids: W.selection.slice() }); },
    selectMany(ids) { W.selection = ids.slice(); W.selected = ids.at(-1) || null; W.emit('select', { id: W.selected, ids: ids.slice() }); },
    focusItem() {}, dragPointer() {}, ghost: g => (g ? { x: 0, y: 0, w: g.w, h: g.h } : null), setDragging() {},
    modsMode: () => W.mode, setModsMode(m) { W.mode = m; W.emit('mods', m); },
    on(t, fn) { (L[t] || (L[t] = [])).push(fn); return () => { L[t] = L[t].filter(f => f !== fn); }; },
    emit(t, d) { for (const f of (L[t] || []).slice()) f(d); },
  };
  return W;
}

await (await import('../cv-mods-ui.js?v=9')).ready();
const sim = await bootMain({ ls: fakeStorage({}), hash: '#serum', synthTest: { cvWorld: root => scriptedWorld(root) } });
{ // (canvas-3-sim's stub fixes: boxes for the panels' tickers, detaching removes, the document as each element's owner)
  const D0 = globalThis.document, ce = D0.createElement, cn = D0.createElementNS;
  const detach = x => { const p = x && x.parentNode; if (p && Array.isArray(p.children)) { const i = p.children.indexOf(x); if (i >= 0) p.children.splice(i, 1); } };
  const fix = e => {
    e.getClientRects = () => [{}]; e.ownerDocument = D0;
    e.remove = () => { detach(e); e.parentNode = null; };
    const ap = e.append;
    e.append = (...n) => { for (const x of n) if (x && typeof x === 'object' && x.parentNode) detach(x); ap.apply(e, n); };
    let tc = '';
    Object.defineProperty(e, 'textContent', { get: () => tc, set: v => { tc = v == null ? '' : String(v); for (const c of e.children.splice(0)) if (c && typeof c === 'object') c.parentNode = null; }, configurable: true });
    return e;
  };
  D0.createElement = tag => fix(ce(tag));
  D0.createElementNS = (ns, tag) => fix(cn(ns, tag));
  D0.querySelector('.scope').getClientRects = () => [{}];
}
const api = sim.api, cv = globalThis.__synthTest.cv, acc = globalThis.__synthTest.acc, sh = globalThis.__synthTest.shell, MS = globalThis.__synthTest.master;
const M = cv.mod, PT = cv.parts;
class FXStub { constructor(box) { this.el = globalThis.document.createElement('div'); box.append(this.el); } refresh() {} destroy() {} paintMods() {} setLive() {} }
acc.uiLoad(Promise.resolve({ sx: await import('../serum-ui.js?v=9'), fxui: { FXRackUI: FXStub }, wk: await import('../wk.js?v=9'), mod: await import('../sx-ui-mod.js?v=9') }));
await sim.power(); sim.raf();
cv.renderViews(); await sim.settle(10); sim.raf(); await sim.settle(5); sim.raf();

const P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack), V = () => cv.view(), W = () => cv.world();
const keys = () => [...V().modules.keys()].sort().join(',');
const has = k => V().modules.has(k);
const hsteps = () => cv.hist.u.length;
const note = () => sim.$('#notice').textContent;
const settle = async (n = 1) => { for (let i = 0; i < n; i++) { sim.raf(); await sim.settle(5); sim.raf(); } };
const base = (id, t = T(), dev = 'i1') => C.destBase(t.dev[dev].vals.s, null, id);
const MOD = id => MODELS.find(m => m.id === id);
// a key press on the page (main.js's window keydown): whether the handler called preventDefault
function press(key, o = {}) {
  const e = { key, defaultPrevented: false };
  sim.key(o.code || key, true, Object.assign({ key, preventDefault() { e.prevented = true; } }, o));
  sim.key(o.code || key, false, { key });
  return !!e.prevented;
}
const sel = (...ids) => W().selectMany(ids);

test('the harness: the CANVAS view shows (ROLL hidden), a Serum on track 1, the world a selection of several', () => {
  cv.openTab('canvas');
  assert.deepEqual([sim.$('#tab-inst').hidden, sim.$('#tab-roll').hidden, CMOD.instOf(T()).model, keys()], [false, true, 'serum', 'i1,i1/fx,out']);
  sel('i1', 'out');
  assert.equal(W().selection.join(','), 'i1,out');
  W().selectMany([]);
});

test('Delete on a selected LFO deletes it (its menu\'s Delete: one step "Delete LFO 1"), "Deleted LFO 1 · tap to undo"; one undo brings it back; Backspace deletes a selected Macro the same way', async () => {
  const l = M.add('lfo'); await settle();
  assert.equal(l, 'l1');
  const n0 = hsteps();
  sel('l1');
  press('Delete'); await settle();
  assert.deepEqual([has('l1'), 'l1' in T().dev, hsteps(), cv.hist.undoLabel], [false, false, n0 + 1, 'Delete LFO 1']);
  assert.equal(note(), 'Deleted LFO 1 · tap to undo');
  assert.equal(W().selection.length, 0, 'the deleted module left the selection');
  cv.undo(); await settle();
  assert.deepEqual([has('l1'), 'l1' in T().dev, hsteps()], [true, true, n0], 'one undo: it is back');
  const m = M.add('macro'); await settle();
  assert.equal(m, 'm1');
  const n1 = hsteps();
  sel('m1');
  assert.equal(press('Backspace'), true, 'the page\'s Backspace (no browser back)');
  await settle();
  assert.deepEqual([has('m1'), hsteps(), cv.hist.undoLabel], [false, n1 + 1, 'Delete Macro 1']);
  cv.undo(); await settle();
  assert.equal(has('m1'), true);
});

test('the instrument / OUT alone: nothing deleted, no step — a notice says why; a mixed selection deletes the modulators, the notice says what stayed', async () => {
  const n0 = hsteps(), k0 = keys();
  sel('i1', 'out');
  press('Delete'); await settle();
  assert.deepEqual([keys(), hsteps()], [k0, n0]);
  assert.equal(note(), 'The instrument and OUT can’t be deleted · to change the instrument, use Replace with… in its ⋯ menu');
  sel('out');
  press('Backspace'); await settle();
  assert.deepEqual([keys(), hsteps(), note()], [k0, n0, 'OUT can’t be deleted']);
  sel('i1/fx');
  press('Delete'); await settle();
  assert.deepEqual([keys(), hsteps(), note()], [k0, n0, 'The FX panel can’t be deleted']);
  // mixed: the instrument, OUT, LFO 1 and Macro 1 — the two modulators go in one step
  sel('i1', 'l1', 'out', 'm1');
  press('Delete'); await settle();
  assert.deepEqual([has('l1'), has('m1'), has('i1'), has('out'), hsteps(), cv.hist.undoLabel], [false, false, true, true, n0 + 1, 'Delete 2 modules']);
  assert.equal(note(), 'Deleted 2 modules · the instrument and OUT stay · tap to undo');
  assert.equal(W().selection.join(','), 'i1,out', 'what stayed stays selected');
  // the notice's tap undoes the press — both modulators back
  sim.$('#notice').onclick();
  await settle();
  assert.deepEqual([has('l1'), has('m1'), hsteps()], [true, true, n0]);
});

test('a selected Serum part is removed (its ⋯ Remove: ⏻ off, one step); two parts and VOICE in one press: both removed in ONE step whose undo turns both back on (the merged ⏻ meta) and whose redo turns both off', async () => {
  assert.equal(PT.show('i1'), true); await settle(2);
  assert.equal(PT.add('i1', 'osc'), 'oscB'); await settle();
  assert.equal(PT.add('i1', 'osc'), 'oscC'); await settle();
  assert.deepEqual([base('b.on'), base('c.on'), has('i1/oscB'), has('i1/oscC')], [1, 1, true, true]);
  const n0 = hsteps();
  sel('i1/oscC');
  press('Delete'); await settle();
  assert.deepEqual([base('c.on'), has('i1/oscC'), hsteps(), cv.hist.undoLabel, note()], [0, false, n0 + 1, 'Remove OSC C', 'Deleted OSC C · tap to undo']);
  cv.undo(); await settle();
  assert.deepEqual([base('c.on'), has('i1/oscC'), hsteps()], [1, true, n0]);
  sel('i1/oscB', 'i1', 'i1/oscC');
  press('Backspace'); await settle();
  assert.deepEqual([base('b.on'), base('c.on'), has('i1/oscB'), has('i1/oscC'), has('i1'), hsteps(), cv.hist.undoLabel], [0, 0, false, false, true, n0 + 1, 'Delete 2 modules']);
  assert.equal(note(), 'Deleted 2 modules · the instrument stays · tap to undo');
  const meta = cv.hist.u.at(-1).meta;
  assert.deepEqual([meta.dev, JSON.stringify(meta.f)], ['i1', JSON.stringify([[['p', 'b.on'], 1, 0], [['p', 'c.on'], 1, 0]])], 'the folded step carries both parts\' ⏻');
  cv.undo(); await settle();
  assert.deepEqual([base('b.on'), base('c.on'), has('i1/oscB'), has('i1/oscC'), hsteps()], [1, 1, true, true, n0], 'one undo: both on, both modules back');
  cv.redo(); await settle();
  assert.deepEqual([base('b.on'), base('c.on'), has('i1/oscB'), has('i1/oscC')], [0, 0, false, false], 'redo: both off again');
  cv.undo(); await settle();
  assert.deepEqual([base('b.on'), base('c.on')], [1, 1]);
  // a part something reads is refused by its own rule — said in the press's notice; the other part still goes
  const H = cv.sxRec(T(), 'i1').ui;
  H.addModUI('lfo2', 'a.level'); await settle();
  assert.equal(has('i1/lfo2'), true);
  const n1 = hsteps();
  sel('i1/lfo2', 'i1/oscC');
  press('Delete'); await settle();
  assert.deepEqual([has('i1/lfo2'), has('i1/oscC'), hsteps()], [true, false, n1 + 1]);
  assert.match(note(), /^Deleted OSC C · LFO 2 modulates 1 knob · its ⋯ → Remove All Destinations first · tap to undo$/);
  cv.undo(); await settle();
  assert.equal(has('i1/oscC'), true);
});

test('Backspace on a box-selection of three 900 Series modules: the modules and their cords go in ONE step; one undo brings them and the cords back', async () => {
  api.addTrack(MOD('m900')); await settle(4);
  const t = T(), dev = CMOD.primId(t), rec = () => cv.patchOf(T(), dev);
  assert.equal(CMOD.instOf(t).model, 'm900');
  const r0 = JSON.stringify(rec()), cords0 = rec().cords.length;
  const end = e => e.slice(0, e.indexOf('.'));
  const mids = [...new Set(rec().cords.flatMap(c => [end(c.a), end(c.b)]))].filter(m => m !== 'c').slice(0, 3);
  assert.equal(mids.length, 3);
  const ks = mids.map(m => dev + '/' + m), gone = rec().cords.filter(c => mids.includes(end(c.a)) || mids.includes(end(c.b))).length;
  assert.equal(ks.every(k => V().modules.has(k)), true, 'the three are modules of the view');
  assert.equal(gone > 0, true);
  const n0 = hsteps();
  sel(...ks);
  press('Backspace'); await settle(2);
  assert.deepEqual([mids.some(m => m in rec().mods), ks.some(k => V().modules.has(k)), rec().cords.length, hsteps(), cv.hist.undoLabel], [false, false, cords0 - gone, n0 + 1, 'Delete 3 modules']);
  assert.equal(note(), 'Deleted 3 modules · tap to undo');
  cv.undo(); await settle(2);
  assert.deepEqual([JSON.stringify(rec()) === r0, ks.every(k => V().modules.has(k)), hsteps()], [true, true, n0], 'one undo: the modules and their cords back');
  // the controller (the instrument) alone: its notice
  sel(dev);
  press('Delete'); await settle();
  assert.deepEqual([JSON.stringify(rec()) === r0, hsteps(), note()], [true, n0, 'The instrument can’t be deleted · to change the instrument, use Replace with… in its ⋯ menu']);
});

test('the key leaves the canvas alone: focus in a text field, under ROLL, with a menu open, ⌘⌫ / Ctrl-⌫, Shift / Alt, a held key\'s repeat', async () => {
  const L = M.add('lfo'); await settle();
  const k0 = keys(), n0 = hsteps(), gone = () => !has(L);
  sel(L);
  const inp = sim.dom.document.createElement('input'); inp.type = 'text';
  press('Delete', { target: inp }); await settle();
  assert.deepEqual([gone(), hsteps()], [false, n0], 'a text field keeps its Delete');
  const ta = sim.dom.document.createElement('textarea');
  press('Backspace', { target: ta }); await settle();
  assert.equal(gone(), false, 'a textarea too');
  const ce = sim.dom.document.createElement('div'); ce.isContentEditable = true;
  press('Backspace', { target: ce }); await settle();
  assert.equal(gone(), false, 'contenteditable too');
  for (const o of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { repeat: true }]) {
    press('Backspace', o); press('Delete', o); await settle();
    assert.deepEqual([gone(), hsteps()], [false, n0], JSON.stringify(o));
  }
  // ROLL shown: the roll's own Delete (its notes), never the canvas's modules
  cv.openTab('roll'); await settle();
  press('Delete'); await settle();
  assert.deepEqual([gone(), hsteps()], [false, n0], 'ROLL');
  cv.openTab('canvas'); await settle();
  // a menu open (the ≡ menu)
  const menu = sh.shell.menus[0];
  menu.open();
  assert.equal(menu.isOpen(), true);
  press('Delete'); await settle();
  assert.deepEqual([gone(), hsteps()], [false, n0], 'a menu open');
  menu.close();
  assert.equal(keys(), k0);
  // and then it works
  press('Delete'); await settle();
  assert.deepEqual([gone(), hsteps()], [true, n0 + 1]);
  cv.undo(); await settle();
});

test('the arrangement\'s bar range pressed after the canvas keeps Delete (the modules stay); a press on the canvas after it gives Delete back to the modules', async () => {
  const L = M.add('lfo'); await settle();
  sel(L);
  // (the stub keeps each element's listeners: a press there — other listeners on the viewport (the world's) may want a real event)
  const fire = s => { for (const f of (sim.$(s).listeners.pointerdown || []).slice()) { try { f({ type: 'pointerdown', pointerId: 91, pointerType: 'mouse', button: 0, buttons: 1, clientX: 0, clientY: 0, target: sim.$(s), preventDefault() {}, stopPropagation() {} }); } catch { /* not ours */ } } };
  api.arr().host.setRange(0, 1920);
  fire('#arrwrap');
  const name = V().modules.get(L).title;
  press('Delete'); await settle();
  assert.deepEqual([has(L), cv.hist.undoLabel === 'Delete ' + name], [true, false], 'the range\'s Delete (its bars cleared), not the module');
  fire('#viewport');
  press('Delete'); await settle();
  assert.deepEqual([has(L), cv.hist.undoLabel], [false, 'Delete ' + name], 'the canvas pressed last: its module');
  cv.undo(); await settle();
  assert.equal(has(L), true);
  api.arr().host.setRange(null, null);
});

test('a no-op step on top (History holds the state already: the first path records nothing): a press over two modules is still ONE step whose undo brings BOTH back', async () => {
  const a = M.add('lfo'), b = M.add('macro'); await settle();
  cv.hist.record(P(), 'nothing'); // (an edit that changed nothing: its step equals the state)
  const n0 = hsteps();
  sel(a, b);
  press('Delete'); await settle();
  assert.deepEqual([has(a), has(b), hsteps(), cv.hist.undoLabel, note()], [false, false, n0, 'Delete 2 modules', 'Deleted 2 modules · tap to undo']);
  sim.$('#notice').onclick(); await settle();
  assert.deepEqual([has(a), has(b), hsteps()], [true, true, n0 - 1], 'one undo (the notice\'s tap): both back');
});

test('song History mark / fold: the steps an action pushed fold into the one holding the state at mark (a no-op step on top serves); the dropped ones\' metas handed back; nothing pushed → null', () => {
  const p = S.newProject({ model: 'minimoog' }), h = new S.History(10), js = x => JSON.stringify(x);
  p.bpm = 100; h.record(p, 'a'); p.bpm = 101;
  const s0 = js(p);
  let mk = h.mark(p);
  assert.deepEqual([mk.same, h.fold(mk)], [false, null], 'nothing pushed: null');
  h.record(p, 'x'); p.bpm = 102; h.record(p, 'y'); h.u.at(-1).meta = { m: 1 }; p.bpm = 103;
  mk = { top: h.u[0], meta: undefined, same: false };
  const r = h.fold(mk);
  assert.deepEqual([h.u.length, r.step.label, js(r.metas)], [2, 'x', '[{"m":1}]']);
  assert.equal(js(h.undo(p)), s0, 'one undo: the state at mark');
  // a no-op step on top: record() pushes nothing for the first edit — that step is kept
  const q = S.newProject({ model: 'minimoog' }), g = new S.History(10);
  q.bpm = 90; g.record(q, 'noop');
  const t0 = js(q);
  mk = g.mark(q);
  assert.equal(mk.same, true);
  assert.equal(g.record(q, 'first'), false);
  q.bpm = 91; g.record(q, 'second'); q.bpm = 92;
  const r2 = g.fold(mk);
  assert.deepEqual([g.u.length, r2.step === mk.top, r2.metas.length], [1, true, 1]);
  assert.equal(js(g.undo(q)), t0, 'one undo: the state before both edits');
});

test('the master canvas: nothing on it is deleted — its notice says so', async () => {
  MS.open(); await settle(2);
  const n0 = hsteps(), k0 = keys();
  sel(...[...V().modules.keys()]);
  press('Delete'); await settle();
  assert.deepEqual([keys(), hsteps(), note()], [k0, n0, 'The master canvas’s modules can’t be deleted']);
  MS.off(); await settle(2);
});
