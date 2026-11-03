import './v8-guard.mjs';
// Stage LC lane H (docs/canvas/IMPL-LC.md §8, §2.3, §11 G8 and G5's host half; the host): the Combiner in the page simulation with the real
// engine — the tile adds one on any canvas (a Juno, an 808, a Wavecraft — a track device there, never INTO it —, the master), numbered
// "Combiner n", never a replace; the IN is the face's drop target ([data-dest="in"], a stand-in until lane F's face is in): the drag lights it
// for an LFO not yet plugged only (cmbSrcOk, not destOk alone), a release plugs it (one step "Plug LFO 1 into Combiner 1", +100 %), every
// refusal has words and leaves no step (an Envelope / Macros / CC / Chaos / the wheel / Velocity / another combiner: "A combiner takes LFOs";
// the same LFO twice; an eleventh ModCore LFO; an OUT past the 16 value sources — and no other cable left); on a Wavecraft canvas in cords
// mode its rows are cords, the IN a stacked jack end (its count in the layer), no amount badge on an input; the body's host (o: §7.2) — the
// inputs in t.mods order, setAmt live then one step, setMute, unplug, select, edit (mode / window / marks: one step each), song(), marks; the
// cord's menu, the inspector and the Mod list in the input's words; delete (rows in and out), Tidy, undo / redo of each act, save → load;
// a project without combiners byte-identical through load and save; the 'mods' monitor feeding a combiner body ({ F, cb, i }). The checks
// that need lane E's compile (pay.cmb, the OUT's value slot, the off rule, win / mark outside the key) run once it is merged (LANE_E).
// canvas-MOD1-sim's scripted world (a real cv-cords layer behind it); one boot; strings, numbers and booleans only into assert.
// Run alone: node --max-old-space-size=2048 --test tests/canvas-LC-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as CMOD from '../cv-model.js?v=9';
import * as CG from '../cv-graph.js?v=9';
import * as CVM from '../cv-module.js?v=9';
import * as CB from '../cv-cables.js?v=9';
import * as RC from '../rig-core.js?v=9';
import * as RU from '../rig-ui.js?v=9';
import * as S from '../song.js?v=9';
import { createCords } from '../cv-cords.js?v=9';

for (const g of ['SxBase', 'SxFilt2', 'SxWarp', 'SxMod', 'SxSample', 'SxGran', 'SxSpec', 'SxSeq', 'SerumDSP', 'FXMods2', 'FXDSP', 'Dr808', 'DrSeq', 'ModCore', 'PatchDSP', 'PatchMoog', 'MASTERDSP']) globalThis[g] = null;
const VP = { left: 0, top: 48 }, BAND = { left: 44, top: 48, right: 1520, bottom: 900 };
let LAYER = null;
const cordsOf = root => new Proxy({}, { get: (o, k) => { if (!LAYER) LAYER = createCords(root, { world: root, doc: globalThis.document, mode: 'svg' }); const f = LAYER[k]; return typeof f === 'function' ? f.bind(LAYER) : f; } });
function scriptedWorld(root) {
  const L = {}, CORDS = cordsOf(root);
  const W = {
    el: root, k: 1, cam: { tx: 0, ty: 0, k: 1 }, items: new Map(), selected: null, mode: 'always',
    setCamera(c) { W.cam = { tx: c.tx, ty: c.ty, k: c.k }; W.k = c.k; W.emit('cameraend', { cam: W.cam, zoomed: true }); },
    band: () => Object.assign({}, BAND),
    toClient: (wx, wy) => ({ x: VP.left + wx * W.k + W.cam.tx, y: VP.top + wy * W.k + W.cam.ty }),
    toWorld: (x, y) => ({ x: (x - VP.left - W.cam.tx) / W.k, y: (y - VP.top - W.cam.ty) / W.k }),
    add(it) { W.items.set(it.id, it); return () => W.remove(it.id); },
    remove(id) { W.items.delete(id); },
    update() {}, clear() { W.items.clear(); },
    select(id) { W.selected = id; W.emit('select', { id }); },
    focusItem() {}, dragPointer() {}, ghost: g => (g ? { x: 0, y: 0, w: g.w, h: g.h } : null), setDragging() {},
    modsMode: () => W.mode, setModsMode(m) { W.mode = m; W.emit('mods', m); },
    on(t, fn) { (L[t] || (L[t] = [])).push(fn); return () => { L[t] = L[t].filter(f => f !== fn); }; },
    emit(t, d) { for (const f of (L[t] || []).slice()) f(d); },
    cords: () => CORDS,
    setCordHook() { return () => {}; }, setJackNear() { return () => {}; },
    glass: false, setGlass(on) { W.glass = !!on; },
  };
  return W;
}

await (await import('../cv-mods-ui.js?v=9')).ready();
const sim = await bootMain({ ls: fakeStorage({}), hash: '#juno60', synthTest: { cvWorld: root => scriptedWorld(root) } });
{ // (canvas-3-sim's DOM fixes: a box for every element, its document, remove / append / textContent detach as in a browser)
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
  if (typeof globalThis.addEventListener === 'function') try { D0.defaultView = globalThis; } catch (err) { /* a getter */ }
}
const api = sim.api, cv = globalThis.__synthTest.cv, acc = globalThis.__synthTest.acc, sh = globalThis.__synthTest.shell, RG = cv.rig, X = cv.mod, MS = globalThis.__synthTest.master, MU = globalThis.__synthTest.modUI;
class FXStub { constructor(box) { this.el = globalThis.document.createElement('div'); box.append(this.el); } refresh() {} destroy() {} paintMods() {} setLive() {} }
acc.uiLoad(Promise.resolve({ host: await import('../sx-host.js?v=9'), fxui: { FXRackUI: FXStub }, wk: await import('../wk.js?v=9'), mod: await import('../sx-ui-mod.js?v=9'), rig: RU }));
await sim.power(); sim.raf();
cv.renderViews(); await sim.settle(10); sim.raf(); await sim.settle(5); sim.raf();

// (lane E's compile merged: a combiner with an input compiles to a payload block of its own, pay.cmb — the checks that read it run from there on)
const LANE_E = (() => {
  const t = { id: 'trk_p', prim: 'i1', dev: { i1: { kind: 'synth', model: 'juno60', vals: {} }, out: { kind: 'out' }, l1: S.normModDev({ kind: 'lfo' }), x1: S.normModDev({ kind: 'comb' }) },
    wires: [{ id: 'w1', a: 'i1.out', b: 'out.in' }], mods: [{ id: 'r1', src: 'l1.out', dst: 'x1:in', amt: 1, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 }] };
  try { return Array.isArray(CG.compileMods(t, { bpm: 120 }).cmb); } catch (err) { return false; }
})();
const NO_E = !LANE_E && 'lane E\'s compile (pay.cmb) is not merged in this tree';
const NO_F = typeof (await import('../cv-mods-ui.js?v=9')).combBody !== 'function' && 'lane F\'s face is not merged in this tree';
const RIG = RC.RIG, P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack), V = () => cv.view();
const I = (t = T()) => CMOD.instOf(t);
const keys = () => [...V().modules.keys()].sort().join(',');
const hsteps = () => cv.hist.u.length;
const note = () => sim.$('#notice').textContent;
const settle = async (n = 2) => { for (let i = 0; i < n; i++) { sim.raf(); await sim.settle(4); } };
const fresh = async model => { sh.srcPick(model, 'track'); await settle(4); return T(); };
const tiles = () => sh.shell.tiles;
const tap = async id => { tiles().modTile(id).dispatchEvent({ type: 'click', defaultPrevented: false, stopPropagation() {}, preventDefault() {} }); await settle(3); }; // (the tray's own click listener)
const drop = async (id, at) => { X.drag.drop(id, { over: 'canvas', at }); await settle(3); };
const devKeys = (t = T()) => Object.keys(t.dev).filter(k => CMOD.kindOfId(k) && t.dev[k].kind === CMOD.kindOfId(k)).sort().join(',');
const title = k => (V().modules.get(k) || {}).title;
const posted = (t, ty) => sim.nodeOf(t.id).posted.map(x => x.m).filter(m => !ty || m.t === ty);
const walk = (n, f, out = []) => { for (const c of (n && n.children) || []) { if (c && typeof c === 'object') { if (f(c)) out.push(c); walk(c, f, out); } } return out; };
const rowsOf = (t = T()) => (t.mods || []).map(r => r.id + ':' + r.src + '>' + r.dst + '@' + r.amt + (r.byp ? '~' : '')).join(' ');
const ERR = [];
const errOn = () => { const ce = console.error; ERR.length = 0; console.error = (...a) => { ERR.push(String(a[0] && a[0].message || a[0])); }; return () => { console.error = ce; }; };
// (lane F's face holds the IN: a [data-dest="in"] socket under the module — the drag's target, the cords' and the lines' end; a stand-in here
// until its face is in this tree, as a face would hold it)
function inOf(key) {
  const m = V().modules.get(key), had = walk(m.el, c => typeof c.getAttribute === 'function' && c.getAttribute('data-dest') === 'in');
  if (had.length) return had[0];
  const s = globalThis.document.createElement('span');
  s.setAttribute('data-dest', 'in');
  m.body.append(s);
  V().remeasure(key);
  return s;
}
// a juno with LFO 1 … n, an Envelope, Macros, CC, Chaos, Velocity and a combiner (or two)
async function juno(o = {}) {
  await fresh(o.model || 'juno60');
  for (let i = 0; i < (o.lfos || 2); i++) X.add('lfo', null);
  if (o.all) for (const k of ['env', 'macro', 'cc', 'chaos', 'velo']) X.add(k, null);
  await settle(2);
  for (let i = 0; i < (o.combs || 1); i++) await tap('comb');
  for (let i = 1; i <= (o.combs || 1); i++) inOf('x' + i);
  await settle(2);
  return T();
}

test('boot: a Juno-60; the Combiner tile after Macros; nothing of a combiner on a fresh track', () => {
  assert.equal(I().model, 'juno60');
  assert.deepEqual(tiles().modTiles().map(b => b.getAttribute('data-mod')).slice(0, 4), ['lfo', 'env', 'macro', 'comb']);
  assert.deepEqual([devKeys(), CVM.MOD_ORDER.at(-1), CVM.MOD_W.comb], ['', 'comb', 416]);
});

test('G8 §8.1 the tile adds a Combiner — on a Juno, an 808, a Wavecraft (a track device: never INTO the Wavecraft, never a replace) and the master — one step "Add Combiner 1", "Added Combiner 1 · tap to undo", numbered; its module 416 px wide (MOD_W.comb), kind mod, the face mark; undo / redo exact', async () => {
  const off = errOn();
  try {
    for (const model of ['juno60', 'tr808', RIG.ID]) {
      const t = await fresh(model), s0 = JSON.stringify(t), n0 = hsteps(), k0 = keys();
      await tap('comb');
      const m = V().modules.get('x1');
      assert.deepEqual([I().model, devKeys(), hsteps() - n0, cv.hist.undoLabel, note(), title('x1'), m.kind, m.w, m.el.getAttribute('data-cv-face'), T().dev.x1.kind, T().dev.x1.mode, T().dev.x1.win, T().dev.x1.mark],
        [model, 'x1', 1, 'Add Combiner 1', 'Added Combiner 1 · tap to undo', 'Combiner 1', 'mod', CVM.MOD_W.comb, '', 'comb', 'add', 1, null], model);
      assert.ok(!keys().split(',').some(k => /\/(comb|x\d)/.test(k)), model + ': nothing inside an instrument');
      await drop('comb', { x: -1400, y: 600 });
      assert.deepEqual([devKeys(), cv.hist.undoLabel, title('x2')], ['x1,x2', 'Add Combiner 2', 'Combiner 2'], model + ': a drop, the next number');
      cv.undo(); await settle(3); cv.undo(); await settle(3);
      assert.deepEqual([JSON.stringify(T()), keys()], [s0, k0], model + ': undo — exact');
      cv.redo(); await settle(3);
      assert.deepEqual([devKeys(), title('x1')], ['x1', 'Combiner 1'], model + ': redo');
    }
    await fresh('juno60');
    const tr = JSON.stringify(T());
    MS.open(); await settle(3);
    const n0 = hsteps();
    await tap('comb');
    assert.deepEqual([Object.keys(P().master.mdev).join(), P().master.mdev.x1.kind, cv.hist.undoLabel, note(), title('x1'), V().modules.get('x1').w, hsteps() - n0], ['x1', 'comb', 'Add Combiner 1', 'Added Combiner 1 · tap to undo', 'Combiner 1', 416, 1], 'the master');
    cv.undo(); await settle(3);
    assert.equal(Object.keys((P().master || {}).mdev || {}).length, 0, 'the master: undo');
    cv.redo(); await settle(3);
    MS.off(); await settle(3);
    assert.equal(JSON.stringify(T()), tr, 'the track untouched');
    assert.equal(ERR.join(' | '), '', 'no console error');
  } finally { off(); }
});

test('G8 §2.3 numbering: titles from the id\'s number — deleting Combiner 2 leaves Combiner 1 and 3 (one step "Delete Combiner 2"), a new one the next number (cv-model addModDev\'s rule, every kind\'s: past the highest); Tidy stacks them at the modulator column\'s end (modX −512), one step, undo / redo', async () => {
  await fresh('juno60');
  X.add('lfo', null); X.add('chaos', null); await settle(2);
  for (let i = 0; i < 3; i++) await tap('comb');
  assert.deepEqual([title('x1'), title('x2'), title('x3')], ['Combiner 1', 'Combiner 2', 'Combiner 3']);
  X.del('x2', true); await settle(2);
  assert.deepEqual([devKeys(), cv.hist.undoLabel, title('x1'), title('x3')], ['h1,l1,x1,x3', 'Delete Combiner 2', 'Combiner 1', 'Combiner 3']);
  await tap('comb');
  assert.deepEqual([devKeys(), title('x4'), cv.hist.undoLabel, title('x3')], ['h1,l1,x1,x3,x4', 'Combiner 4', 'Add Combiner 4', 'Combiner 3'], 'the others keep their numbers');
  X.del('x4', true); await settle(2);
  await tap('comb');
  assert.deepEqual([devKeys(), title('x4')], ['h1,l1,x1,x3,x4', 'Combiner 4'], 'the highest removed: its number comes round again');
  const t = T();
  t.lay = Object.assign({}, t.lay, { x1: { x: 2048, y: 3072 } }); cv.renderViews(); await settle(3);
  const n0 = hsteps();
  cv.tidy(); await settle(3);
  const R = V().rects();
  assert.equal(hsteps(), n0 + 1, 'Tidy: one step');
  assert.deepEqual(['x1', 'x3', 'x4'].map(k => R[k].x), [-512, -512, -512], 'at modX(comb)');
  assert.ok(R.x1.y > R.h1.y && R.x3.y > R.x1.y && R.x4.y > R.x3.y && R.h1.y > R.l1.y, 'after the Chaos, by number');
  const lay = JSON.stringify(T().lay);
  cv.undo(); await settle(3); cv.redo(); await settle(3);
  assert.equal(JSON.stringify(T().lay), lay, 'undo / redo exact');
});

test('(R2-2) the face grows 32 px a list line: a plug moves the modules stacked under the Combiner down by it, in the plug\'s own step (undo takes both); an unplug moves them back up; a module beside the column stays', async () => {
  await fresh('juno60');
  await tap('comb');
  for (let i = 0; i < 6; i++) X.add('lfo', null);              // (taps: stacked under the Combiner, the column's end)
  await settle(3);
  inOf('x1'); await settle(2);
  const y = k => V().rects()[k].y, ly = k => T().lay[k] && T().lay[k].y;
  X.connect('l1.out', 'x1:in'); await settle(3);              // (one input: the face's one line — no growth)
  const R0 = V().rects(), y0 = ['l1', 'l2', 'l6'].map(y), i0 = y('i1');
  assert.ok(R0.l1.y > R0.x1.y && R0.l1.x < R0.x1.x + R0.x1.w && R0.x1.x < R0.l1.x + R0.l1.w, 'LFO 1 stacked under the Combiner: ' + JSON.stringify([R0.x1, R0.l1]));
  for (const k of ['l2', 'l3', 'l4', 'l5']) { X.connect(k + '.out', 'x1:in'); await settle(3); }
  assert.equal(CMOD.inputsOf(T(), 'x1').length, 5);
  assert.deepEqual(['l1', 'l2', 'l6'].map(y), y0.map(v => v + 4 * 32), 'four plugs: the stack under it 4 · 32 px down');
  assert.deepEqual([ly('l1'), y('i1')], [y0[0] + 128, i0], 'written to the lay; the instrument beside the column stays');
  const n0 = hsteps();
  cv.undo(); await settle(3);
  assert.deepEqual([CMOD.inputsOf(T(), 'x1').length, y('l1'), ly('l1'), hsteps()], [4, y0[0] + 96, y0[0] + 96, n0 - 1], 'undo: the plug and the room together');
  cv.redo(); await settle(3);
  assert.deepEqual([CMOD.inputsOf(T(), 'x1').length, y('l1')], [5, y0[0] + 128], 'redo');
  // an unplug (the face's list): back up one line, one step
  const row = T().mods.find(r => r.src === 'l5.out').id;
  assert.ok(cv.mod.comb('x1').unplug(row)); await settle(3);
  assert.deepEqual([CMOD.inputsOf(T(), 'x1').length, y('l1'), cv.hist.undoLabel], [4, y0[0] + 96, 'Unplug LFO 5']);
});

test('G8 §8.3 the IN: the drag lights it for an LFO not yet plugged only (markDests → cmbSrcOk; every knob as before); refusals in words, no step — an Envelope, Macros, CC, Chaos, Velocity, the wheel, another combiner ("A combiner takes LFOs"), the same LFO twice ("That LFO is already plugged in"); a release plugs it: one step "Plug LFO 1 into Combiner 1", a row at +100 %, selected; undo / redo', async () => {
  await juno({ all: true, combs: 2 });
  X.add('wheel', null); await settle(2);
  const CF = 'i1:cf', mk = src => X.opts.markDests(src);
  assert.deepEqual(['l1.out', 'l2.out', 'e1.out', 'm1.k1', 'c1.out', 'h1.out', 've.out', 'wheel', 'x2.out', 'x1.out'].map(s => mk(s)('x1', 'in')), [true, true, false, false, false, false, false, false, false, false], 'the IN lit for an LFO only');
  assert.deepEqual(['l1.out', 'e1.out', 'x1.out', 'wheel'].map(s => mk(s)('i1', 'cf')), [true, true, true, true], 'a knob as before (destOk), a combiner\'s OUT too');
  assert.deepEqual([mk('l1.out')('x1', 'out'), mk('l1.out')('l1', 'rate'), X.opts.canMod('l1.out', 'x1:rate').ok], [false, false, false], 'no other end of a modulator');
  const n0 = hsteps(), r0 = rowsOf();
  for (const s of ['e1.out', 'm1.k1', 'c1.out', 'h1.out', 've.out', 'wheel', 'x2.out']) {
    assert.deepEqual(X.opts.canMod(s, 'x1:in'), { ok: false, why: 'A combiner takes LFOs' }, s);
    X.opts.onMod(s, 'x1:in'); await settle(1);
    assert.deepEqual([note(), hsteps(), rowsOf()], ['A combiner takes LFOs', n0, r0], s + ': said, no step, no row');
  }
  assert.deepEqual(X.opts.canMod('l1.out', 'x1:in'), { ok: true, why: '' });
  const SL = MU.srcList(T());
  assert.deepEqual(['x1.out', 'x2.out'].map(id => (SL.find(s => s.id === id) || {}).label), ['Combiner 1', 'Combiner 2'], 'the knobs\' source menus list each combiner');
  X.opts.onMod('l1.out', 'x1:in'); await settle(2);
  const r1 = T().mods.find(r => r.dst === 'x1:in');
  assert.deepEqual([hsteps() - n0, cv.hist.undoLabel, r1.src, r1.amt, r1.byp, r1.bi, V().cables.selected()], [1, 'Plug LFO 1 into Combiner 1', 'l1.out', 1, 0, 0, r1.id]);
  assert.deepEqual([mk('l1.out')('x1', 'in'), mk('l2.out')('x1', 'in'), mk('l1.out')('x2', 'in')], [false, true, true], 'plugged: no longer lit there; another combiner takes it');
  X.opts.onMod('l1.out', 'x1:in'); await settle(1);
  assert.deepEqual([note(), hsteps() - n0], ['That LFO is already plugged in', 1], 'twice: said, no step');
  X.opts.onMod('l2.out', 'x1:in'); X.opts.onMod('l1.out', 'x2:in'); await settle(2);
  assert.deepEqual([CMOD.inputsOf(T(), 'x1').map(r => r.src).join(), CMOD.inputsOf(T(), 'x2').map(r => r.src).join(), hsteps() - n0, cv.hist.undoLabel], ['l1.out,l2.out', 'l1.out', 3, 'Plug LFO 1 into Combiner 2']);
  const s3 = JSON.stringify(T());
  cv.undo(); await settle(2); cv.undo(); await settle(2);
  assert.equal(CMOD.inputsOf(T(), 'x1').map(r => r.src).join(), 'l1.out', 'undo, undo');
  cv.redo(); await settle(2); cv.redo(); await settle(2);
  assert.equal(JSON.stringify(T()), s3, 'redo, redo: exact');
});

test('G8 §4 the budgets — refused at the drop with the words, no row, no step, no other cable left: an input needing an eleventh ModCore LFO ("That LFO can’t join: this track runs 10 LFOs"); a combiner\'s OUT past the 16 value sources (the value table\'s words)', async () => {
  await juno({ lfos: 11 });
  const knobs = ['lr', 'rg', 'sb', 'nz', 'hp', 'cf', 'rs', 'ep', 'en', 'vm']; // (ten of the Juno's modulatable knobs)
  for (let i = 0; i < 10; i++) X.opts.onMod('l' + (i + 1) + '.out', 'i1:' + knobs[i]);
  await settle(2);
  const pay0 = MU.pay(T()), n0 = hsteps(), r0 = rowsOf();
  assert.deepEqual([pay0.n.lfo, pay0.left.length], [10, 0], 'ten LFOs on ten knobs');
  X.opts.onMod('l11.out', 'x1:in'); await settle(2);
  assert.deepEqual([note(), hsteps(), rowsOf(), MU.pay(T()).left.length], [CMOD.CMB_FULL, n0, r0, 0], 'the eleventh: said, nothing written, nothing left');
  assert.equal(CMOD.CMB_FULL, 'That LFO can’t join: this track runs 10 LFOs');
  X.opts.onMod('l3.out', 'x1:in'); await settle(2);
  assert.deepEqual([hsteps() - n0, CMOD.inputsOf(T(), 'x1').length, MU.pay(T()).left.length], [1, 1, 0], 'an LFO with a slot of its own already: plugged');
  // the value table: 16 CC modules cabled
  await juno({ lfos: 0 });
  for (let i = 0; i < 16; i++) X.add('cc', null);
  await settle(2);
  const K16 = ['lr', 'rg', 'sb', 'nz', 'hp', 'cf', 'rs', 'ep', 'en', 'vm', 'lv', 'a', 'd', 's', 'r', 'ch'];
  for (let i = 0; i < 16; i++) X.opts.onMod('c' + (i + 1) + '.out', 'i1:' + K16[i]);
  await settle(2);
  const p1 = MU.pay(T()), n1 = hsteps(), r1 = rowsOf();
  assert.deepEqual([p1.n.vals, p1.left.length], [16, 0], 'sixteen value sources');
  X.opts.onMod('x1.out', 'i1:hs'); await settle(2);
  assert.deepEqual([note(), hsteps(), rowsOf(), MU.pay(T()).left.length], ['This track’s value sources are full (16/16)', n1, r1, 0], 'the OUT: said, nothing written');
});

test('G8 §4.1 the OUT cabled to a knob like any modulator — one step "Modulate … with Combiner 1"; its badge; the payload not off (cmb: the off rule); undo / redo', { skip: NO_E }, async () => {
  await juno();
  X.opts.onMod('l1.out', 'x1:in'); await settle(2);
  const n0 = hsteps();
  X.opts.onMod('x1.out', 'i1:cf'); await settle(2);
  const r = T().mods.find(x => x.src === 'x1.out'), c = V().cables.list().find(x => x.id === (r && r.id));
  assert.deepEqual([hsteps() - n0, /^Modulate .+ with Combiner 1$/.test(cv.hist.undoLabel), !!c && !c.nobadge, MU.pay(T()).off === true, Array.isArray(MU.pay(T()).cmb)], [1, true, true, false, true]);
  cv.undo(); await settle(2);
  assert.equal(T().mods.some(x => x.src === 'x1.out'), false);
  cv.redo(); await settle(2);
  assert.equal(T().mods.some(x => x.src === 'x1.out'), true);
});

test('G8 §8.6 the off rule: a track whose one modulation is a combiner with an input (no OUT yet) posts a payload of its own (pay.cmb) — never {off}', { skip: NO_E }, async () => {
  const t = await juno({ lfos: 1 });
  sim.nodeOf(t.id).posted.length = 0;
  X.opts.onMod('l1.out', 'x1:in'); await settle(3);
  const pay = api.buildMods(T());
  assert.deepEqual([pay.off === true, Array.isArray(pay.cmb) && pay.cmb.length, posted(T(), 'mods').some(m => !m.off && Array.isArray(m.cmb))], [false, 1, true]);
});

test('G8 §2.3 mode / window / marks: one step each through the body\'s edit (undo / redo); window and marks post nothing (outside the payload\'s key)', { skip: NO_E }, async () => {
  const t = await juno({ lfos: 1 });
  X.opts.onMod('l1.out', 'x1:in'); X.opts.onMod('x1.out', 'i1:cf'); await settle(3);
  const o = X.comb('x1'), n0 = hsteps();
  sim.nodeOf(t.id).posted.length = 0;
  o.edit({ win: 2 }); await settle(2);
  o.edit({ mark: { t: T().id, n: -1 } }); await settle(2);
  assert.deepEqual([hsteps() - n0, T().dev.x1.win, JSON.stringify(T().dev.x1.mark), posted(T(), 'mods').length], [2, 2, JSON.stringify({ t: T().id, n: -1 }), 0], 'two steps, no repost');
  o.edit({ mode: 'mul' }); await settle(2);
  assert.deepEqual([hsteps() - n0, T().dev.x1.mode, posted(T(), 'mods').length], [3, 'mul', 1], 'the mode: a step and a repost');
  cv.undo(); await settle(2); cv.undo(); await settle(2); cv.undo(); await settle(2);
  assert.deepEqual([T().dev.x1.mode, T().dev.x1.win, T().dev.x1.mark], ['add', 1, null], 'undo × 3');
  cv.redo(); await settle(2);
  assert.equal(T().dev.x1.win, 2, 'redo');
});

test('G8 §7.2 the body\'s host (o): devKey, shown, get, the inputs in t.mods order (name, colour, amount, mute, slot, why), song() (one object, reused), the payload, setAmt live (no step per move) then one step at its end, setMute one step "Mute LFO 2" / "Unmute LFO 2", unplug one step "Unplug LFO 1", select → the cord selected, edit → one step "Edit Combiner 1"; undo / redo of each', async () => {
  const t = await juno({ lfos: 3 });
  X.opts.onMod('l2.out', 'x1:in'); X.opts.onMod('l1.out', 'x1:in'); await settle(2);
  T().dev.l3.rise = 0.5; // (an input the combiner hears without its per-note Rise: "≈" on its line)
  X.opts.onMod('l3.out', 'x1:in'); await settle(2);
  const o = X.comb('x1');
  assert.deepEqual([o.devKey, typeof o.shown, typeof o.heardFrame, typeof o.sampleRate, o.get().kind, o.cords(), typeof o.doc], ['x1', 'function', 'function', 'function', 'comb', false, 'object']);
  const L = o.inputs();
  assert.deepEqual(L.map(x => [x.src, x.name, x.amt, x.byp, typeof x.color, /^#[0-9a-f]{6}$/i.test(x.color), x.why]), [
    ['l2.out', 'LFO 2', 1, 0, 'string', true, ''], ['l1.out', 'LFO 1', 1, 0, 'string', true, ''], ['l3.out', 'LFO 3', 1, 0, 'string', true, '']], 't.mods order');
  assert.deepEqual(L.map(x => x.apx), ['', '', 'Rise and Delay act per note: not in the Combiner'], 'RISE / DELAY: the "≈" reason (apx)');
  // ((review 2 R2-5, the lead) each line its own tint by its place in the list — the dot and its faint curve; the cords keep theirs
  const CMU = await import('../cv-mods-ui.js?v=9');
  assert.deepEqual([L.map(x => x.color).join(), L.map(x => x.row).join()], [CMU.CMB_TINT.slice(0, 3).join(), T().mods.filter(r => r.dst === 'x1:in').map(r => r.id).join()], 'a tint per line, by its index');
  assert.equal(new Set(CMU.CMB_TINT).size, CMU.CMB_TINT.length, 'the tints distinct');
  assert.ok(CMU.CMB_TINT.length >= 6 && CMU.CMB_TINT.length <= 8 && Object.isFrozen(CMU.CMB_TINT));
  assert.equal(V().cables.list().find(c => c.id === L[0].row).color, CB.MOD_COLOR.lfo, 'the cord itself: its LFO\'s colour, unchanged');
  if (LANE_E) assert.ok(L.every(x => Number.isInteger(x.l) && x.l >= 0 && x.l < 10), 'each with its ModCore slot');
  const sg = o.song(), sg2 = o.song();
  assert.deepEqual([sg === sg2, sg.bpm, sg.sig.join('/'), sg.playing, sg.tick, sg.cursor, sg.start, sg.pass, typeof sg.loop.on, sg.loop.end > sg.loop.start || !sg.loop.on], [true, P().bpm, P().sig.join('/'), false, 0, 0, 0, 0, 'boolean', true], 'one object, reused; stopped at the cursor');
  // setAmt: live moves (the row written, no step), the end one step; a typed set one step
  const r2 = L[0].row, n0 = hsteps();
  o.setAmt(r2, 0.8, 'move'); o.setAmt(r2, 0.6, 'move'); await settle(1);
  assert.deepEqual([T().mods.find(r => r.id === r2).amt, hsteps() - n0 <= 1], [0.6, true], 'moves: written live');
  o.setAmt(r2, 0.5, 'end'); await settle(2);
  assert.deepEqual([T().mods.find(r => r.id === r2).amt, hsteps() - n0, cv.hist.undoLabel], [0.5, 1, 'Mod amount']);
  o.setAmt(r2, 0.7, 'move'); o.setAmt(r2, 0.5, 'move'); o.setAmt(r2, 0.5, 'end'); await settle(2);
  assert.deepEqual([T().mods.find(r => r.id === r2).amt, hsteps() - n0], [0.5, 1], 'moves back to where it began, then its end: no step');
  o.setAmt(r2, 0.9, 'move'); o.setAmt(r2, 0, 'cancel'); await settle(2);
  assert.deepEqual([T().mods.find(r => r.id === r2).amt, hsteps() - n0], [0.5, 1], 'a cancel (two fingers): the value back, no step');
  o.setAmt(r2, -0.25, 'set'); await settle(2);
  assert.deepEqual([T().mods.find(r => r.id === r2).amt, hsteps() - n0], [-0.25, 2], 'a typed value: one step');
  o.setMute(r2, true); await settle(2);
  assert.deepEqual([T().mods.find(r => r.id === r2).byp, hsteps() - n0, cv.hist.undoLabel, o.inputs()[0].byp], [1, 3, 'Mute LFO 2', 1]);
  o.setMute(r2, false); await settle(2);
  assert.deepEqual([T().mods.find(r => r.id === r2).byp, cv.hist.undoLabel], [0, 'Unmute LFO 2']);
  o.select(L[1].row); await settle(1);
  assert.deepEqual([V().cables.selected(), o.selected()], [L[1].row, L[1].row], 'select: the cord');
  o.unplug(L[1].row); await settle(2);
  assert.deepEqual([o.inputs().map(x => x.name).join(), cv.hist.undoLabel, hsteps() - n0], ['LFO 2,LFO 3', 'Unplug LFO 1', 5]);
  o.edit({ mode: 'mul' }); await settle(2);
  assert.deepEqual([T().dev.x1.mode, cv.hist.undoLabel, hsteps() - n0], ['mul', 'Edit Combiner 1', 6]);
  for (let i = 0; i < 6; i++) { cv.undo(); await settle(1); }
  assert.deepEqual([o.inputs().map(x => x.name + '@' + x.amt + (x.byp ? '~' : '')).join(), T().dev.x1.mode], ['LFO 2@1,LFO 1@1,LFO 3@1', 'add'], 'undo × 6: as it was');
  for (let i = 0; i < 6; i++) { cv.redo(); await settle(1); }
  assert.deepEqual([o.inputs().map(x => x.name + '@' + x.amt).join(), T().dev.x1.mode], ['LFO 2@-0.25,LFO 3@1', 'mul'], 'redo × 6');
  assert.equal(t.id, T().id);
});

test('G5 (the host\'s half) song(): stopped, the cursor; playing, the heard tick of the frame — one value within a frame (frame-stamped), moving on with the frames; stopped again, the cursor', async () => {
  await juno({ lfos: 1 });
  const o = X.comb('x1'), Tr = api.transport();
  P().metronome.countIn = 0; P().metronome.on = false;
  assert.deepEqual([o.song().playing, o.song().tick, o.song().cursor], [false, Tr.pos, Tr.pos]);
  sim.$('#tPlay').click(); await sim.settle(2);
  const seen = [];
  for (let i = 0; i < 4; i++) { sim.run(4800); sim.raf(); const a = o.song().tick, b = o.song().tick; seen.push([o.song().playing, a === b, Number.isFinite(a)]); seen.push(a); }
  const ticks = seen.filter(x => typeof x === 'number');
  assert.deepEqual(seen.filter(x => typeof x !== 'number'), [[true, true, true], [true, true, true], [true, true, true], [true, true, true]], 'playing, one value a frame');
  assert.ok(ticks.every((x, i) => !i || x >= ticks[i - 1]) && ticks.at(-1) > ticks[0], 'moving on: ' + ticks.join(' '));
  sim.$('#tPlay').click(); await sim.settle(2); sim.raf(); // (the same button stops)
  assert.deepEqual([o.song().playing, o.song().tick], [false, Tr.pos], 'stopped: the cursor');
});

test('(lane F\'s asks) a combiner face is synced (once a frame) after an edit, ▶, ■, a seek, a tempo, signature or loop change and a skin switch; a cord\'s selection lights its line (B.highlight), another one unlights it; song().start / pass: the run\'s first tick and its loop pass (0 at ▶, counting the wraps; a seek starts again)', async () => {
  const t = await juno({ lfos: 2 });
  X.opts.onMod('l1.out', 'x1:in'); X.opts.onMod('l2.out', 'x1:in'); await settle(2);
  const had = X.bodies.get('x1'), B = { kind: 'comb', n: 0, hl: [], sync() { B.n++; }, highlight(r) { B.hl.push(r); }, update() {}, destroy() {} };
  X.bodies.set('x1', B);
  const o = X.comb('x1'), sel = sh.shell.skinSel, ids = T().mods.filter(r => r.dst === 'x1:in').map(r => r.id);
  try {
    const step = async f => { B.n = 0; f(); await settle(2); return B.n > 0; };
    P().metronome.countIn = 0; P().metronome.on = false;
    Object.assign(P().loop, { on: true, start: 0, end: 960 });
    const got = [
      await step(() => o.setMute(ids[0], true)), await step(() => o.edit({ win: 2 })), await step(() => sim.$('#tPlay').click()),
      await step(() => cv.setProjectBpm(130)), await step(() => sim.$('#tSigD').onchange({ target: { value: 8 } })), await step(() => sim.$('#tSigD').onchange({ target: { value: 4 } })),
      await step(() => sim.$('#tLoop').onclick()), await step(() => sim.$('#tLoop').onclick()), await step(() => sim.$('#tStart').onclick()), await step(() => sim.$('#tPlay').click()),
      await step(() => sim.$('#tStart').onclick()), await step(() => { sel.value = 'ivory'; sel.onchange(); }), await step(() => { sel.value = 'charcoal'; sel.onchange(); }), await step(() => cv.undo()),
    ];
    assert.deepEqual(got, got.map(() => true), 'mute, window, ▶, tempo, signature ×2, loop ×2, seek, ■, the cursor home, skin ×2, undo');
    B.hl.length = 0;
    X.sel(ids[1]); V().cables.select(ids[1]); await settle(1);
    assert.deepEqual(B.hl.at(-1), ids[1], 'a cord selected: its line lit');
    V().cables.select(null); await settle(1);
    assert.equal(B.hl.at(-1), null, 'none: unlit');
    // song().start / pass
    cv.setProjectBpm(120);
    sim.$('#tPlay').click(); await sim.settle(2);
    assert.deepEqual([o.song().playing, o.song().start, o.song().pass], [true, 0, 0], '▶: the run from 0, pass 0');
    for (let i = 0; i < 6; i++) { sim.run(9600); sim.raf(); }
    const p1 = o.song().pass;
    assert.ok(p1 >= 1 && o.song().tick < 960, 'a 1-beat loop past its end: pass ' + p1 + ', tick ' + o.song().tick);
    sim.$('#tStart').onclick(); await sim.settle(1); sim.raf();
    assert.deepEqual([o.song().start, o.song().pass], [0, 0], 'a seek: the run starts again');
    sim.$('#tPlay').click(); await sim.settle(2); sim.raf();
    assert.deepEqual([o.song().playing, o.song().pass], [false, 0]);
    // (review 1 R1-5) a recording with a one-bar count-in: ▶ (every LFO's reset) is a bar before the cursor — song().start is the engine's ▶ tick
    Object.assign(P().loop, { on: false }); P().metronome.countIn = 1;
    const n0 = posted(T(), 'transport').length;
    sim.$('#tRec').onclick(); await sim.settle(2); sim.raf();
    const go = posted(T(), 'transport').slice(n0).filter(m => m.play)[0];
    assert.deepEqual([o.song().playing, go && go.tick, o.song().start], [true, -3840, -3840], 'the count-in: song().start = the transport\'s ▶ tick');
    sim.$('#tRec').onclick(); await sim.settle(1); sim.$('#tPlay').click(); await sim.settle(2); sim.raf();
    P().metronome.countIn = 0;
  } finally { if (had) X.bodies.set('x1', had); else X.bodies.delete('x1'); Object.assign(P().loop, { on: true, start: 0, end: 15360 }); }
  assert.equal(t.id, T().id);
});

test('G8 §8.3 a tap on the IN: "Connect to…" with the track\'s LFOs not yet plugged (a pick plugs it: one step); none left: said', async () => {
  await juno({ lfos: 2 });
  X.opts.onMod('l1.out', 'x1:in'); await settle(2);
  const o = X.comb('x1'), n0 = hsteps();
  const menu = o.connect(inOf('x1'));
  assert.deepEqual(menu.map(x => x.label), ['LFO 2'], 'the LFOs not plugged');
  menu[0].action(); await settle(2);
  assert.deepEqual([hsteps() - n0, cv.hist.undoLabel, CMOD.inputsOf(T(), 'x1').length], [1, 'Plug LFO 2 into Combiner 1', 2]);
  assert.deepEqual([o.connect(inOf('x1')).length, note()], [0, 'Every LFO of this track is plugged into Combiner 1']);
});

test('G8 §8.4 the input cord\'s menu (Disconnect, Mute / Unmute — its amount the face\'s), the inspector in the input\'s words, the Mod list "LFO 1 → Combiner 1 · IN"; the cord\'s tap selects it (no inspector)', async () => {
  await juno({ lfos: 1 });
  X.opts.onMod('l1.out', 'x1:in'); await settle(2);
  const id = T().mods.find(r => r.dst === 'x1:in').id;
  assert.deepEqual(X.cmenu(id).map(x => x.label), ['Mute'], 'the host\'s item (cv-cables puts Disconnect first)');
  X.cmenu(id)[0].action(); await settle(2);
  assert.deepEqual([T().mods.find(r => r.id === id).byp, cv.hist.undoLabel, X.cmenu(id).map(x => x.label).join()], [1, 'Mute LFO 1', 'Unmute']);
  assert.deepEqual([X.label('x1:in'), X.label('x1'), X.label('l1.out')], ['Combiner 1 · IN', 'Combiner 1', 'LFO 1']);
  const H = X.host() || (X.list(), X.host());
  assert.equal(H.budget('x1').kind, 'comb', 'the layer\'s budget kind: the input\'s inspector');
  X.list(); await settle(1);
  const sh2 = walk(sim.$('#ov'), c => typeof c.getAttribute === 'function' && c.getAttribute('data-dev') === 'x1' && /cv-ml-dev/.test(String(c.className || '')));
  assert.ok(sh2.length === 1, 'the Mod list: the combiner\'s section');
  const line = walk(sh2[0], c => /cv-ml-line/.test(String(c.className || '')))[0];
  assert.equal(line && line.children[0].textContent, 'LFO 1 → Combiner 1 · IN · +100% · muted');
  // (R2-3) its header counts the combiner's input rows (cv-mods inputsOf), not the payload's knob rows
  const hb = walk(sh2[0], c => /cv-ml-b/.test(String(c.className || '')))[0];
  assert.deepEqual([H.budget('x1').canvas, String(hb && hb.textContent).split(' · ')[0]], [1, '1 input'], 'the Mod list header: its inputs');
  X.layer().close(); X.layer().close();
  X.act(id, 'disconnect'); await settle(2);
  assert.deepEqual([CMOD.inputsOf(T(), 'x1').length, cv.hist.undoLabel], [0, 'Disconnect']);
});

test('G8 delete: the combiner\'s rows in and out go with it (one step "Delete Combiner 1", undo brings them back exact); deleting an input LFO takes its input row; a Wavecraft LFO plugged in stays (its module is in use)', async () => {
  await juno({ lfos: 2 });
  X.opts.onMod('l1.out', 'x1:in'); X.opts.onMod('l2.out', 'x1:in'); await settle(2);
  T().mods.push({ id: 'r99', src: 'x1.out', dst: 'i1:cf', amt: 0.5, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 }); // (an OUT row as a saved project holds it: lane E compiles it)
  cv.renderViews(); await settle(2);
  const s = JSON.stringify(T());
  X.del('x1', true); await settle(2);
  assert.deepEqual([devKeys(), (T().mods || []).length, cv.hist.undoLabel], ['l1,l2', 0, 'Delete Combiner 1']);
  cv.undo(); await settle(3);
  assert.equal(JSON.stringify(T()), s, 'undo: the combiner and its rows');
  X.del('l1', true); await settle(2);
  assert.deepEqual([devKeys(), CMOD.inputsOf(T(), 'x1').map(r => r.src).join(), cv.hist.undoLabel], ['l2,x1', 'l2.out', 'Delete LFO 1']);
  await fresh(RIG.ID);
  RG.add(null, 'lfo'); await settle(2);
  await tap('comb'); inOf('x1'); await settle(2);
  X.opts.onMod('i1/lfo1.out', 'x1:in'); await settle(2);
  assert.equal(CMOD.inputsOf(T(), 'x1').map(r => r.src).join(), 'i1/lfo1.out', 'a Wavecraft LFO: its link row');
  const n0 = hsteps();
  RG.remove('i1/lfo1'); await settle(2);
  assert.deepEqual([hsteps(), keys().includes('i1/lfo1'), CMOD.inputsOf(T(), 'x1').length, note()], [n0, true, 1, RC.WORDS.inUse('LFO 1', 1)], 'its module in use: not removed, said');
});

test('G8 §8.3 a Wavecraft canvas (cords): a Wavecraft LFO\'s cord and a track LFO\'s cord into the IN — cords, both jack ends on the IN\'s socket (plug s 0: stacked, never a knob\'s rim), its count "2" in the layer\'s top; no badge on an input; the OUT a cord at the knob\'s rim with its badge; lines mode: lines onto the IN\'s centre, no layer count; a Juno: lines, no count', async () => {
  await fresh(RIG.ID);
  RG.add(null, 'lfo'); X.add('lfo', null); await settle(2);
  await tap('comb'); inOf('x1'); await settle(2);
  X.opts.onMod('i1/lfo1.out', 'x1:in'); await settle(2);
  X.opts.onMod('l1.out', 'x1:in'); await settle(3);
  assert.equal(RG.mode(), 'cords');
  const ins = T().mods.filter(r => r.dst === 'x1:in').map(r => r.id);
  const recs = V().cables.list().filter(c => ins.includes(c.id));
  assert.deepEqual(recs.map(c => [RG.cordOf(c), !!c.nobadge, RG.toCord(c).s]), [[true, true, 0], [true, true, 0]], 'cords, no badge, jack plugs');
  const Ly = RG.layer(), A = Ly.anchors, Q = V().ports().get('x1:in');
  assert.ok(Q && Number.isFinite(Q.x), 'the IN\'s socket in the ports');
  for (const id of ins) { const c = Ly.cords.find(x => x.id === id); assert.deepEqual([c.b, A.get(c.b).x, A.get(c.b).y], ['x1:in', Q.x, Q.y], id + ': its end on the socket'); }
  const cn = Ly.counts.get('x1:in');
  assert.deepEqual([cn && cn.n, cn && cn.to], [2, 'r'], 'the count');
  const top = LAYER && LAYER.top(), jn = walk(top, c => typeof c.getAttribute === 'function' && c.getAttribute('data-of') === 'x1:in' && !c.hidden);
  assert.deepEqual([jn.length, jn[0] && jn[0].textContent], [1, '2'], 'shown in the layer\'s top');
  const badge = id => V().cables.badge(id);
  assert.deepEqual(ins.map(id => !badge(id) || !!badge(id).hidden), [true, true], 'no badge');
  assert.deepEqual(X.comb('x1').inputs().map(x => x.name + ':' + x.apx), ['LFO 1 · ' + RIG.NAME + ':', 'LFO 1:'], 'the Wavecraft\'s LFO 1 (its own number; the clash told apart, MOD1\'s rule) and the track\'s: nothing the combiner does not hear');
  T().mods.push({ id: 'r91', src: 'l1.out', dst: 'i1:l1.rate', amt: 0.5, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 }); // (its rate under a cable)
  assert.deepEqual(X.comb('x1').inputs().map(x => x.apx), ['Its modulation stays inside the ' + RIG.NAME, ''], '"≈": the twin copies its knobs\' bases');
  T().mods.pop();
  // the OUT's row (written as a saved project holds it: its compile — the value slot — is lane E's; the drop's own test is the OUT test's)
  T().mods.push({ id: 'r90', src: 'x1.out', dst: 'i1:f.cutoff', amt: 0.5, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 });
  cv.renderViews(); await settle(3);
  const o = V().cables.list().find(c => c.a === 'x1.out'), K = o && RG.layer().anchors.get('knob:' + o.id);
  assert.ok(o, 'the OUT\'s record');
  assert.deepEqual([RG.cordOf(o), RG.toCord(o).s, !!badge(o.id) && !badge(o.id).hidden, !!K, RG.layer().cords.find(c => c.id === o.id).b, RG.layer().counts.has('x1:in')], [true, 2, true, true, 'knob:' + o.id, true], 'the OUT: a cord with a knob end (the rig\'s knob-end rule: its rim once its knob is measured — canvas-WC-sim\'s geometry), its badge; the IN\'s count as before');
  RG.wires('lines'); await settle(3);
  assert.deepEqual([recs.map(c => RG.cordOf(c)).join(), !LAYER || walk(LAYER.top(), c => typeof c.getAttribute === 'function' && c.getAttribute('data-of') === 'x1:in').length === 0], ['false,false', true], 'lines: no cord, no layer count');
  RG.wires('cords'); await settle(3);
  await juno({ lfos: 2 });
  X.opts.onMod('l1.out', 'x1:in'); X.opts.onMod('l2.out', 'x1:in'); await settle(2);
  assert.deepEqual(V().cables.list().filter(c => c.b === 'x1:in').map(c => RG.cordOf(c)).join(), 'false,false', 'a Juno: lines');
});

test('G8 §8.5 monitoring: a combiner body wants the \'mods\' monitor (MC_KINDS); the slow {smon, mc, mcx, cF, cb} and the fast {fast, F, mc, x, cb} reach it as one reused { F, cb, i, n } through pay.slots[id]', { skip: NO_E }, async () => {
  const t = await juno({ lfos: 1 });
  X.opts.onMod('l1.out', 'x1:in'); await settle(3);
  const got = [], B = { kind: 'comb', update: v => got.push([v.F, v.i, v.n, v.cb.length, v]), sync() {}, destroy() {} }, had = X.bodies.get('x1');
  X.bodies.set('x1', B);
  try {
    const e = MU.pay(T()).slots.x1;
    assert.deepEqual([e.kind, e.i, e.n], ['comb', 0, 1]);
    const cb = new Float64Array(4);
    MU.mcSnap(t.id, new Float32Array(16), null, cb, 4096);
    MU.mcSnap(t.id, new Float32Array(16), null, cb, 8192);
    assert.deepEqual(got.map(g => g.slice(0, 4)), [[4096, 0, 1, 4], [8192, 0, 1, 4]]);
    assert.equal(got[0][4], got[1][4], 'one reused object');
    MU.mcSnap(t.id, new Float32Array(16), null, null, 1); MU.mcSnap(t.id, new Float32Array(16), null, cb, undefined);
    assert.equal(got.length, 2, 'without cb / cF: nothing');
  } finally { if (had) X.bodies.set('x1', had); else X.bodies.delete('x1'); }
});

test('G8 §6.7 the marks: markList (Off, every track, a drum machine\'s sounds), marks(t0, t1) — the chosen track\'s notes (every note or one number) in the window, sorted ticks; Off: none', async () => {
  await fresh('tr808');
  const dr = T();
  const t = await juno({ lfos: 1 });
  t.notes.push({ id: 'n1', t: 960, d: 240, n: 60, v: 100 }, { id: 'n2', t: 0, d: 240, n: 64, v: 100 }, { id: 'n3', t: 4000, d: 240, n: 60, v: 100 });
  const o = X.comb('x1'), L = o.markList(), V2 = x => JSON.stringify(x.value);
  assert.deepEqual([L[0].label, L[0].value], ['Off', null], 'Off: the mark null');
  assert.ok(L.some(x => V2(x) === JSON.stringify({ t: t.id, n: -1 }) && x.label === t.name) && L.some(x => V2(x) === JSON.stringify({ t: dr.id, n: -1 })), 'every track: its every note');
  assert.ok(L.some(x => x.value && x.value.t === dr.id && x.value.n === 36 && /Kick/.test(x.label)), 'the drum machine\'s sounds (its rows): the mark edit({ mark }) takes');
  assert.deepEqual(o.marks(0, 3840), [], 'Off: none');
  o.edit({ mark: { t: t.id, n: -1 } }); await settle(2);
  assert.deepEqual(o.marks(0, 3840), [0, 960]);
  o.edit({ mark: { t: t.id, n: 60 } }); await settle(2);
  assert.deepEqual([o.marks(0, 3840), o.marks(3840, 7680)], [[960], [4000]]);
});

test('G8 save → load: a track and a master combiner, their inputs and OUT rows, mode / window / marks come back exact; a project without combiners saves byte for byte through load and save; no console error', async () => {
  const off = errOn();
  try {
    await fresh('juno60');
    X.add('lfo', null); await settle(2);
    X.opts.onMod('l1.out', 'i1:cf'); await settle(2);
    const p0 = JSON.parse(S.serialize(P())), id0 = T().id;
    p0.tracks = p0.tracks.filter(x => x.id === id0); p0.selTrack = id0; delete p0.master;
    api.applyRestore(acc.loadProject(p0, { file: true })); await settle(4);
    const plain = S.serialize(P());
    assert.ok(!/"kind":"comb"|:in"/.test(plain), 'a project without combiners');
    api.applyRestore(acc.loadProject(JSON.parse(plain), { file: true })); await settle(4);
    assert.equal(S.serialize(P()), plain, 'no combiner: byte for byte through load and save');
    const t = await juno({ lfos: 2 });
    X.opts.onMod('l1.out', 'x1:in'); X.opts.onMod('l2.out', 'x1:in'); await settle(2);
    X.comb('x1').edit({ mode: 'mul' }); X.comb('x1').edit({ win: 4 }); X.comb('x1').edit({ mark: { t: t.id, n: 36 } }); await settle(2);
    X.comb('x1').setAmt(T().mods.find(r => r.src === 'l2.out').id, -0.5, 'set'); X.comb('x1').setMute(T().mods.find(r => r.src === 'l2.out').id, true); await settle(2);
    MS.open(); await settle(3);
    X.add('lfo', null); await tap('comb'); inOf('x1'); await settle(2);
    X.opts.onMod('l1.out', 'x1:in'); await settle(2);
    MS.off(); await settle(2);
    const txt = S.serialize(P()), j = JSON.parse(txt), tj = j.tracks.find(x => x.id === t.id);
    assert.deepEqual([JSON.stringify(tj.dev.x1), tj.mods.filter(r => r.dst === 'x1:in').map(r => r.src + '@' + r.amt + (r.byp ? '~' : '')).join(), j.master.mdev.x1.kind, j.master.mods.filter(r => r.dst === 'x1:in').length],
      [JSON.stringify({ kind: 'comb', mode: 'mul', win: 4, mark: { t: t.id, n: 36 } }), 'l1.out@1,l2.out@-0.5~', 'comb', 1]);
    api.applyRestore(acc.loadProject(JSON.parse(txt), { file: true })); await settle(4);
    const t1 = JSON.parse(S.serialize(P())), tj1 = t1.tracks.find(x => x.id === t.id), cmb = q => JSON.stringify([q.dev, q.mods, q.lay && q.lay.x1]);
    assert.deepEqual([cmb(tj1), cmb(t1.master), JSON.stringify(t1.master.mdev)], [cmb(tj), cmb(j.master), JSON.stringify(j.master.mdev)], 'with combiners: their devices, rows and places exact (a track\'s nid follows its highest device number at load, l2 here: song.js\'s rule)');
    const s1 = S.serialize(P());
    api.applyRestore(acc.loadProject(JSON.parse(s1), { file: true })); await settle(4);
    assert.equal(S.serialize(P()), s1, 'loaded once: byte for byte from then on');
    api.selectTrack(t.id); await settle(4);
    assert.deepEqual([title('x1'), CMOD.inputsOf(T(), 'x1').length], ['Combiner 1', 2]);
    MS.open(); await settle(3);
    assert.deepEqual([title('x1'), CMOD.inputsOf(MS.mod.rec(), 'x1').length], ['Combiner 1', 1]);
    MS.off(); await settle(2);
    assert.equal(ERR.join(' | '), '', 'no console error');
  } finally { off(); }
});

test('(lane F\'s face, at integration) the face mounts in the host — a comb body, its IN (B.inJack) the module\'s [data-dest="in"] —, a tap on the IN opens "Connect to…" (none left: said), a play and an edit with undo raise no console error', { skip: NO_F }, async () => {
  const off = errOn();
  try {
    await juno({ lfos: 2 });
    const B = X.bodies.get('x1');
    assert.deepEqual([!!B, B && B.kind, !!(B && B.inJack), B && B.inJack.getAttribute('data-dest'), inOf('x1') === (B && B.inJack)], [true, 'comb', true, 'in', true]);
    X.opts.onMod('l1.out', 'x1:in'); await settle(2);
    B.inJack.listeners.click[0]({ stopPropagation() {} }); await settle(2);
    X.opts.onMod('l2.out', 'x1:in'); await settle(2);
    B.inJack.listeners.click[0]({ stopPropagation() {} }); await settle(2);
    const opened = note();
    sim.$('#tPlay').click(); await sim.settle(2);
    for (let i = 0; i < 3; i++) { sim.run(4800); sim.raf(); }
    sim.$('#tPlay').click(); await sim.settle(2); sim.raf();
    X.comb('x1').edit({ mode: 'mul' }); await settle(2);
    cv.undo(); await settle(2);
    assert.deepEqual([opened, ERR.join(' | ')], ['Every LFO of this track is plugged into Combiner 1', '']);
  } finally { off(); }
});
