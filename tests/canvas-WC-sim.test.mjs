import './v8-guard.mjs';
// Stage WC lane H (docs/canvas/IMPL-WC.md §3.5, §4, §8.2, §10 G2 host / G5 / G6 flows / G12 / G13): the Wavecraft (model `rig`) in the
// page simulation with the real engine and the real panels — the first drop of a module tile replaces any other instrument (one step,
// the notice, undo brings it back whole), the key gate (an oscillator alone plays only while a key is held), an Envelope takes the level
// over and pulling it gives the gate back, a module dropped on a rig adds itself and auto-plugs (AUTOPLUG), the starter tile, the
// drawing modes (cords: the cord layer draws the rig's own connections; lines: today's renderer — the same flows), the cord edits (plug /
// pull / re-patch / "Which cord?" / the ×) one History step each with undo / redo exact, a cord onto a socket-less knob going INTO THE
// BACK of its module (the user, 2026-10-25: the anchor on the target's outline, no rope point over its face, the knob's ring, the badge
// still re-targets), Make it a <NAME> (the same sound, the parts' places), a schema-15 parts-view project opening whole with its notice,
// the retired canvas-3 cases (a part tile on a Serum, the conversion), no Serum word on a rig (G13), every other canvas as today (G12:
// drawMode lines, nothing claimed, the layer's buffer off; the frozen record is tests/ref-WC/record.mjs), the rig's patch ≡ a Serum's
// (G2, host level). The world is canvas-sim's scripted one with a real cv-cords layer (SVG mode: the parabola) behind a recorder.
// One boot; strings, numbers and booleans only into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/canvas-WC-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as C from '../serum-core.js?v=9';
import * as CMOD from '../cv-model.js?v=9';
import * as CM from '../cv-migrate.js?v=9';
import * as RC from '../rig-core.js?v=9';
import * as RU from '../rig-ui.js?v=9';
import { createCords, makeRope, seed, step, smooth, along, STUDIO, restPath, CORD_Q, clip } from '../cv-cords.js?v=9';
import { MODELS } from '../models.js?v=9';
import { readFileSync } from 'node:fs';
import { fitCam, READ_K } from '../cv-world.js?v=9';
import * as CVM from '../cv-module.js?v=9';
import * as TRAY from '../cv-tray.js?v=9';
import * as WK from '../wk.js?v=9';

for (const g of ['SxBase', 'SxFilt2', 'SxWarp', 'SxMod', 'SxSample', 'SxGran', 'SxSpec', 'SxSeq', 'SerumDSP', 'FXMods2', 'FXDSP', 'Dr808', 'DrSeq', 'ModCore', 'PatchDSP', 'PatchMoog', 'MASTERDSP']) globalThis[g] = null;
const VP = { left: 0, top: 48 }, BAND = { left: 44, top: 48, right: 1520, bottom: 900 };
// the cord layer: a real cv-cords (SVG mode — the parabola, the same drawn polyline the GL path builds) behind a recorder
const REC = { calls: [], list: null, at: null, on: false };
let LAYER = null;
const recorder = root => new Proxy({}, { get: (o, k) => {
  if (!LAYER) LAYER = createCords(root, { world: root, doc: globalThis.document, mode: 'svg' });
  // ((fixer K) the host aims knob ends and places badges and fans on the layer's shape at rest — the browser's GL layer at High: the
  // settled rope (cv-cords restPath), as the crossing measure below settles it; the SVG layer here would answer its parabola)
  if (k === 'shape') return (a, b, out) => { REC.calls.push(k); return a && b && out ? restPath(a.x, a.y, b.x, b.y, out, CORD_Q.high) : 0; };
  const f = LAYER[k];
  if (typeof f !== 'function') return f;
  return (...a) => {
    REC.calls.push(k);
    if (k === 'set') REC.list = JSON.parse(JSON.stringify(a[0]));
    if (k === 'anchors') REC.at = a[0];
    if (k === 'alloc') REC.on = !!a[0];
    return f.apply(LAYER, a);
  };
} });
const W0 = {}; // (the scripted world, for a selection)
function scriptedWorld(root) {
  const L = {}, CORDS = recorder(root);
  const W = W0.w = {
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
    setCordHook(hit, tap) { W.cordHook = { hit, tap }; return () => { W.cordHook = null; }; },
    setJackNear(f) { W.jackNear = f; return () => { if (W.jackNear === f) W.jackNear = null; }; }, // ((fixer K, P2-3) the host's near hook
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
  if (typeof globalThis.addEventListener === 'function') try { D0.defaultView = globalThis; } catch (err) { /* a getter */ } // (the kit's menus listen on the window)
}
const api = sim.api, cv = globalThis.__synthTest.cv, acc = globalThis.__synthTest.acc, sh = globalThis.__synthTest.shell, RG = cv.rig;
class FXStub { constructor(box) { this.el = globalThis.document.createElement('div'); box.append(this.el); } refresh() {} destroy() {} paintMods() {} setLive() {} }
acc.uiLoad(Promise.resolve({ sx: await import('../serum-ui.js?v=9'), fxui: { FXRackUI: FXStub }, wk: await import('../wk.js?v=9'), mod: await import('../sx-ui-mod.js?v=9'), rig: RU }));
await sim.power(); sim.raf();
cv.renderViews(); await sim.settle(10); sim.raf(); await sim.settle(5); sim.raf();

const P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack), V = () => cv.view();
const I = (t = T()) => CMOD.instOf(t);
const dev = (t = T()) => CMOD.primId(t);
const keys = () => [...V().modules.keys()].sort().join(',');
const hsteps = () => cv.hist.u.length;
const NOTES = []; // (every notice a test read: G13 scans them)
const note = () => { const s = sim.$('#notice').textContent; NOTES.push(s); return s; };
const settle = async (n = 2) => { for (let i = 0; i < n; i++) { sim.raf(); await sim.settle(4); } };
const S = (t = T()) => I(t).vals.s;
const snap = (t = T()) => JSON.stringify(I(t));
const ends = (t = T()) => RG.edges(dev(t)).map(e => e.edge.a + '>' + e.edge.b).sort().join(' ');
const claimed = () => V().cables.cordList().map(c => c.id).sort();
const tile = async (kind, at) => { RG.drop(kind, at || null); await settle(3); };
const fresh = async model => { sh.srcPick(model, 'track'); await settle(4); return T(); };
const ID = {}, RIG = RC.RIG;

test('boot: a Juno-60 on track 1, its canvas draws lines (drawMode), nothing claimed, the cord layer\'s buffer off; the rig\'s widths are rig-ui\'s (the RIG grid); rig-ui is the panels\' (loaded with them)', () => {
  assert.equal(I().model, 'juno60');
  assert.deepEqual([RG.mode(), claimed().length, REC.on], ['lines', 0, false]);
  for (const k of ['amp', 'osc', 'sub', 'noise', 'filter', 'env', 'lfo', 'macros']) assert.equal(RG.width(k), RU.sizeOf(k).w, k);
  assert.ok(RG.ui() && typeof RG.ui().face === 'function', 'rig-ui\'s host made with the panels');
  ID.juno = T().id;
});

test('§3.5 the first drop: an Oscillator tile on the Juno REPLACES it — one step "Replace Juno-60", the notice "Replaced Juno-60 with <NAME> · Oscillator 1 · tap to undo", the Amplifier + Oscillator 1 (plugged into IN: route Main, no filter) + its FX panel + OUT, the row [module] [Amplifier] [FX] [OUT]; ENV 1 the gate; the canvas in cords mode; undo brings the Juno back whole', async () => {
  const t = T(), before = snap(t), n0 = hsteps();
  await tile('osc');
  assert.equal(I().model, 'rig');
  assert.deepEqual([hsteps() - n0, cv.hist.u.at(-1).label], [1, 'Replace Juno-60']);
  assert.equal(note(), 'Replaced Juno-60 with ' + RIG.NAME + ' · Oscillator 1 · tap to undo');
  assert.equal(keys(), 'i1,i1/fx,i1/oscA,out');
  assert.equal(ends(), 'oscA.out>voice.main', 'Oscillator 1 into the Amplifier\'s IN');
  assert.deepEqual([C.destBase(S(), null, 'a.on'), S().osc[0].route, RC.isGate(S())], [1, 1, true]);
  const L = T().lay, x = k => L[k].x;
  assert.ok(x('i1/oscA') < x('i1') && x('i1') < x('i1/fx'), 'left to right: the module, the Amplifier, the FX panel');
  assert.equal(RG.mode(), 'cords');
  cv.undo(); await settle(3);
  assert.equal(snap(), before, 'the Juno back, its whole state');
  assert.equal(keys(), 'fx1,i1,out');
  cv.redo(); await settle(3);
  assert.deepEqual([I().model, ends()], ['rig', 'oscA.out>voice.main']);
});

const peak = (x, a = 0, b = x.length) => { let m = 0; for (let i = a; i < b; i++) { const v = Math.abs(x[i]); if (v > m) m = v; } return m; };
const node = (t = T()) => sim.nodeOf(t.id);

test('§3.3 the key gate: an Oscillator alone plays only while a key is held — silent before, its level while held, silent a few ms after the key is up (the 3 ms ramps; ENV 1 the gate, no Envelope module)', async () => {
  assert.deepEqual([RC.isGate(S()), keys().includes('env1')], [true, false]);
  await settle(3);
  const quiet = sim.run(4800).get(node());
  assert.ok(peak(quiet.L) < 1e-4, 'silent with no key (' + peak(quiet.L).toExponential(2) + ')');
  api.noteOn(57, 100, 0);
  const held = sim.run(9600).get(node()), lv = peak(held.L, 4800);
  assert.ok(lv > 0.02, 'it plays while held (' + lv.toFixed(4) + ')');
  assert.ok(peak(held.L, 9600 - 2400) > 0.9 * lv, 'no decay while held (sustain 1)');
  api.noteOff(57, 0); await settle();
  sim.run(960); // (20 ms: the 3 ms release and the decimator)
  const after = sim.run(4800).get(node());
  assert.ok(peak(after.L) < lv * 0.02, 'silent after the key (' + peak(after.L).toExponential(2) + ' vs ' + lv.toFixed(4) + ')');
});

test('§3.4 an Envelope tile while the keys gate the level: it becomes Envelope 1 plugged into LEVEL (Serum\'s envelope defaults: "which then takes over the level"), one step "Add Envelope 1"; pulling its cord gives the gate back ("Envelope 1 unplugged · the keys gate the level again") — the module stays unplugged, its name kept; undo / redo exact', async () => {
  const n0 = hsteps(), s0 = JSON.stringify(S());
  await tile('env');
  assert.deepEqual([hsteps() - n0, cv.hist.u.at(-1).label, note()], [1, 'Add Envelope 1', 'Added Envelope 1 · tap to undo']);
  assert.ok(keys().includes('i1/env1'));
  assert.equal(RC.isGate(S()), false);
  assert.ok(ends().includes('env1.out>voice.level'), 'the amp-slot cord');
  assert.equal(C.destBase(S(), null, 'e1.rel'), C.DESTS[C.DEST_INDEX['e1.rel']].def, 'Serum\'s release');
  const s1 = JSON.stringify(S()), cord = RG.edges().find(e => e.edge.b === 'voice.level');
  cv.mod.opts.onPull(cord.id); await settle(3);
  assert.equal(note(), 'Envelope 1 unplugged · the keys gate the level again · tap to undo');
  assert.deepEqual([RC.isGate(S()), ends().includes('voice.level')], [true, false]);
  assert.ok(keys().includes('i1/env2') && !keys().includes('i1/env1'), 'the module moved to slot 2, unplugged');
  assert.equal(V().modules.get('i1/env2').title, 'Envelope 1', 'its name kept (dev.rig.n)');
  cv.undo(); await settle(3);
  assert.equal(JSON.stringify(S()), s1, 'undo: plugged again, field for field');
  assert.ok(keys().includes('i1/env1'));
  cv.undo(); await settle(3);
  assert.equal(JSON.stringify(S()), s0, 'undo: no Envelope');
  cv.redo(); await settle(3); cv.redo(); await settle(3);
  assert.deepEqual([RC.isGate(S()), keys().includes('i1/env2')], [true, true], 'redo, redo: unplugged again');
  cv.undo(); await settle(3); cv.undo(); await settle(3);
  assert.equal(JSON.stringify(S()), s0);
});

test('§3.5 a module tile on a rig ADDS it and auto-plugs (AUTOPLUG): a Filter (its OUT into the Amplifier), then an Oscillator into the Filter\'s IN (a Filter stands); a full kind says so (no step)', async () => {
  const n0 = hsteps();
  await tile('filter');
  assert.deepEqual([hsteps() - n0, cv.hist.u.at(-1).label, note()], [1, 'Add Filter 1', 'Added Filter 1 · tap to undo']);
  assert.ok(keys().includes('i1/filter'));
  assert.ok(ends().includes('filter.out>voice.main') && ends().includes('oscA.out>voice.main'), 'its OUT into IN; the oscillator where it was');
  await tile('osc');
  assert.equal(cv.hist.u.at(-1).label, 'Add Oscillator 2');
  assert.ok(ends().includes('oscB.out>filter.in'), 'Oscillator 2 into the Filter\'s IN');
  const s2 = JSON.stringify(S());
  cv.undo(); await settle(3);
  assert.deepEqual([keys().includes('i1/oscB'), C.destBase(S(), null, 'b.on')], [false, 0], 'undo: Oscillator 2 gone, its ⏻ off (sxBack)');
  cv.redo(); await settle(3);
  assert.equal(JSON.stringify(S()), s2, 'redo: exact');
  await tile('osc');
  const n1 = hsteps();
  await tile('osc');
  assert.deepEqual([note(), hsteps()], ['This ' + RIG.NAME + ' already has 3 oscillators', n1], 'full: the count, no step');
  ID.rig = T().id;
});

test('§3.5 the rig tile: on a rig its starter as a preset-style load (one step, its fields back on undo); on a Minimoog track a Replace with the starter (Oscillator 1 → Filter 1 → Amplifier, Envelope 1 on LEVEL)', async () => {
  const s0 = JSON.stringify(S()), n0 = hsteps();
  sh.srcPick('rig', 'replace'); await settle(3);
  assert.deepEqual([hsteps() - n0, cv.hist.u.at(-1).label], [1, RIG.NAME + ' starter']);
  assert.equal(ends(), 'env1.out>voice.level filter.out>voice.main oscA.out>filter.in');
  assert.equal(keys(), 'i1,i1/env1,i1/filter,i1/fx,i1/oscA,out', 'the starter\'s modules (the old ones gone with the state)');
  cv.undo(); await settle(3);
  assert.equal(JSON.stringify(S()), s0, 'undo: the rig as it was');
  cv.redo(); await settle(3);
  const t = await fresh('minimoog');
  assert.equal(I(t).model, 'minimoog');
  sh.srcPick('rig', 'replace'); await settle(4);
  assert.deepEqual([I().model, ends()], ['rig', 'env1.out>voice.level filter.out>voice.main oscA.out>filter.in']);
  assert.match(note(), new RegExp('^Replaced Minimoog with ' + RIG.NAME + ' · tap to undo$'));
  ID.starter = T().id;
});

const layerIds = () => (REC.list || []).map(c => c.id).sort();
const rigRec = (a, b) => RG.edges().find(e => e.edge.a === a && e.edge.b === b);
const world = () => cv.parts.root;
const xBtn = () => { const W = world().children || [], T = W.find(c => c.className === 'cv-cords-top'); return [...W, ...((T && T.children) || [])].find(c => c.className === 'cv-cable-x') || null; }; // ((fixer B2) a cord's ×: in the layer above the cords

test('§4.1 cords mode on the rig canvas: the cord layer draws the rig\'s own connections (its edges, the amp-slot cord) — no SVG path of theirs —, its buffer on; Amplifier → FX and FX → OUT stay lines; the layer\'s list is cv-cables\' claimed records (the user, 2026-10-26: a jack holding several stacks them on its socket — every end the jack itself)', async () => {
  assert.equal(RG.mode(), 'cords');
  const internal = RG.edges().map(e => e.id).sort();
  assert.deepEqual(claimed(), internal, 'claimed: the rig\'s edges');
  assert.deepEqual(layerIds(), internal, 'the layer: the same records');
  assert.equal(REC.on, true, 'the buffer on (alloc)');
  const lines = V().cables.list().filter(c => !V().cables.claimed(c.id)).map(c => c.a + '>' + c.b).sort();
  assert.deepEqual(lines, ['i1.out>i1/fx.in', 'i1/fx.out>out.in'], 'the lines: Amplifier → FX, FX → OUT');
  const amp = REC.list.find(c => c.id === rigRec('env1.out', 'voice.level').id);
  assert.deepEqual([amp.a, amp.b, amp.c, amp.s], ['i1/env1.out', 'i1.level', 1, 0], 'the amp-slot cord: Envelope 1 OUT → LEVEL, yellow, plugs at both ends');
  assert.equal(V().cables.badge(amp.id) || null, null, 'a connection, not a modulation row: no amount badge');
  for (const c of REC.list) assert.ok(REC.at.get(c.a) && REC.at.get(c.b), c.id + ': both anchors known');
});

test('§4.4 cord edits on the rig canvas (cv-cables\' cord drag → the host, rig-core): plug (an output onto an input), re-patch (an input\'s plug moved), pull (let go away from any jack) — one step each, the notices, undo / redo exact; "Which cord?" on an input holding several; a tap on a cord selects it and its × pulls it', async () => {
  const s0 = JSON.stringify(S()), n0 = hsteps(), O = cv.mod.opts;
  await tile('osc'); // (Oscillator 2: into the Filter's IN — AUTOPLUG)
  assert.ok(ends().includes('oscB.out>filter.in'));
  const s1 = JSON.stringify(S());
  O.onConnect('i1/oscB.out', 'i1.direct'); await settle(3);
  assert.deepEqual([cv.hist.u.at(-1).label, note()], ['Plug Oscillator 2 · OUT → Amplifier · DIRECT', 'Plug Oscillator 2 · OUT → Amplifier · DIRECT · tap to undo']);
  assert.ok(ends().includes('oscB.out>voice.direct') && !ends().includes('oscB.out>filter.in'), 'a cord into DIRECT replaces the one into the Filter (one route)');
  const s2 = JSON.stringify(S());
  O.onRepatch(rigRec('oscB.out', 'voice.direct').id, 'i1/oscB.out', 'i1.main'); await settle(3);
  assert.equal(cv.hist.u.at(-1).label, 'Re-patch Oscillator 2 · OUT → Amplifier · IN');
  assert.ok(ends().includes('oscB.out>voice.main'));
  const s3 = JSON.stringify(S());
  // "Which cord?": the Amplifier's IN holds the Filter's and Oscillator 2's — its menu lists them, the most recent first: the stack's top
  // (the user, 2026-10-26: stacked plugs, newest on top — Oscillator 2's, re-patched there last; was the last in edges() order, the Filter's)
  RG.ui().jackMenu('i1.main', null, 10, 10);
  const M = RG.menuLast().map(i => i.label);
  assert.deepEqual(M.slice(0, 3), ['Which cord?', 'Oscillator 2 · OUT', 'Filter 1 · OUT'], 'by source, the most recent (the stack\'s top) first');
  O.onPull(rigRec('oscB.out', 'voice.main').id); await settle(3);
  assert.deepEqual([cv.hist.u.at(-1).label, note()], ['Pull Oscillator 2 · OUT → Amplifier · IN', 'Cord pulled · tap to undo']);
  assert.equal(S().osc[1].route, 3, 'unplugged: route None (silent, its module dimmed)');
  // the ×: a tap on the Filter's cord into the Amplifier selects it (the layer's outline too); its × pulls it
  const fid = rigRec('filter.out', 'voice.main').id;
  V().cables.tap(fid, { x: 10, y: 10 });
  assert.equal(LAYER && REC.calls.includes('sel'), true, 'cordSel → the layer');
  const x = xBtn();
  assert.ok(x && !x.hidden, 'the × shows');
  x.dispatchEvent({ type: 'click', stopPropagation() {}, preventDefault() {} }); await settle(3);
  assert.equal(cv.hist.u.at(-1).label, 'Pull Filter 1 · OUT → Amplifier · IN');
  assert.equal(S().filter[0].route, 3);
  // undo every step: exact, step by step; redo exact
  const s5 = JSON.stringify(S());
  cv.undo(); await settle(3); cv.undo(); await settle(3);
  assert.equal(JSON.stringify(S()), s3, 'two undos (the ×\'s pull, the drag\'s): the re-patched state, exact');
  cv.redo(); await settle(3); cv.redo(); await settle(3);
  assert.equal(JSON.stringify(S()), s5, 'redo, redo: exact');
  for (let i = 0; i < 2; i++) { cv.undo(); await settle(3); }
  cv.undo(); await settle(3);
  assert.equal(JSON.stringify(S()), s2, 'undo the re-patch: exact');
  cv.undo(); await settle(3);
  assert.equal(JSON.stringify(S()), s1, 'undo the plug: exact');
  cv.undo(); await settle(3);
  assert.equal(JSON.stringify(S()), s0, 'undo the add: exact');
  assert.equal(hsteps(), n0);
});

test('§4.7 the regret path: wires(\'lines\') draws the same records with today\'s renderer (nothing claimed, the layer emptied, its buffer off, the rig\'s jacks stage 3\'s kinds), the same edits plug through rig-core; back to cords', async () => {
  const internal = RG.edges().map(e => e.id).sort();
  RG.wires('lines'); await settle(3);
  assert.deepEqual([RG.mode(), claimed().length, (REC.list || []).length, REC.on], ['lines', 0, 0, false]);
  const int = V().cables.list().filter(c => c.int).map(c => c.id).sort();
  assert.deepEqual(int, internal, 'the internal records drawn as lines: the same ids (rig-core edges)');
  const j = V().jacks().find(x => x.id === 'i1/oscA.out');
  assert.equal(j.kind, 'audio', 'the jack: stage 3\'s kind');
  RG.ui().jackMenu('i1/env1.out', null, 0, 0);
  assert.ok((RG.menuLast() || []).some(i => /LEVEL/.test(i.label || '')) || (RG.menuLast() || []).some(i => i.label === 'Envelope 1 · OUT → Amplifier · LEVEL'), 'an Envelope\'s OUT: the amp slot reached from its menu in lines mode too (lane C\'s open item)');
  const s0 = JSON.stringify(S());
  cv.mod.opts.onConnect('i1/oscA.out', 'i1.direct'); await settle(3);
  assert.ok(ends().includes('oscA.out>voice.direct'), 'a line drag plugs through rig-core');
  cv.undo(); await settle(3);
  assert.equal(JSON.stringify(S()), s0);
  RG.wires('cords'); await settle(3);
  assert.deepEqual([RG.mode(), claimed(), REC.on], ['cords', internal, true]);
  assert.equal(V().jacks().find(x => x.id === 'i1/oscA.out').kind, 'cord');
});

// sane geometry in the stub DOM: every module's element its world rect on the client (k 1, no pan), its height h; a knob of module key
// at (dx, dy) in it, 40 × 40, its kit disc filling it (as the kit draws it: inside the control — wk.discBox, review WC-int P3-18; the stub's
// default box sat at the client's origin) — its module's controls (querySelectorAll: what a badge must not cover, fixer B2) — then the view
// measures again (the knob ends, the anchors)
function geometry(h = 520, knobs = {}) {
  for (const [k, m] of V().modules) {
    const H = k === 'out' ? 260 : h;
    m.el.getBoundingClientRect = () => ({ left: VP.left + m.x, top: VP.top + m.y, width: m.w, height: H, right: VP.left + m.x + m.w, bottom: VP.top + m.y + H, x: VP.left + m.x, y: VP.top + m.y });
    m.el.offsetHeight = H;
    m.el.querySelectorAll = () => [];
  }
  for (const [k, list] of Object.entries(knobs)) {
    const m = V().modules.get(k), ctl = [];
    for (const [pid, dx, dy] of list) {
      const box = () => ({ left: VP.left + m.x + dx, top: VP.top + m.y + dy, width: 40, height: 40, right: VP.left + m.x + dx + 40, bottom: VP.top + m.y + dy + 40, x: 0, y: 0 });
      const walk = n => { for (const c of n.children || []) { if (c && c.getAttribute && c.getAttribute('data-dest') === pid) { c.getBoundingClientRect = box; c.offsetWidth = c.offsetHeight = 40; const d = WK.discOf(c); if (d) d.getBoundingClientRect = box; ctl.push(c); } walk(c); } };
      walk(m.el);
    }
    m.el.querySelectorAll = () => ctl;
  }
  cv.render(); V().remeasure();
}
const inRect = (p, r) => p.x > r.x + 1e-6 && p.x < r.x + r.w - 1e-6 && p.y > r.y + 1e-6 && p.y < r.y + r.h - 1e-6;
const onOutline = (p, r) => ((Math.abs(p.x - r.x) < 1e-6 || Math.abs(p.x - r.x - r.w) < 1e-6) && p.y >= r.y - 1e-6 && p.y <= r.y + r.h + 1e-6) || ((Math.abs(p.y - r.y) < 1e-6 || Math.abs(p.y - r.y - r.h) < 1e-6) && p.x >= r.x - 1e-6 && p.x <= r.x + r.w + 1e-6);
const destEl = (key, pid) => { let f = null; const walk = n => { for (const c of n.children || []) { if (!f && c && c.getAttribute && c.getAttribute('data-dest') === pid) f = c; if (!f) walk(c); } }; walk(V().modules.get(key).el); return f; };

test('(fixer B2; the user, 2026-10-26: "the cable going from lfo to filter should be going directly to the back of the knob that it is attached to") a cord onto a socket-less knob goes INTO THE KNOB: an LFO onto the Filter\'s LEVEL — its anchor on the knob\'s rim where the settled rope arrives radially (it goes in behind the knob there: the KNOB end, s 2, no box), the rope\'s last point at the rim, the knob\'s ring in its colour; its badge above the cords (the layer\'s top), on the cord just outside the rim and off every control; a second cord onto that knob: the rim points apart, the ring segmented, the badges apart; the badge drag re-targets (the ring and the rim follow)', async () => {
  await tile('lfo');
  assert.ok(keys().includes('i1/lfo1'), 'an LFO module (unplugged: a knob is its destination)');
  const id = cv.mod.connect('i1/lfo1.out', 'i1:f.level'); await settle(3);
  assert.match(String(id), /^o:i1:\d+$/, 'the rig\'s own row (its matrix)');
  const KN = { 'i1/filter': [['f.level', 60, 240], ['f.y', 0, 240], ['f.x', 60, 180], ['f.on', 0, 180]], i1: [['g.amp', 220, 120]] }; // (the stub face's controls with a data-dest: LEVEL and three neighbours)
  geometry(520, KN); await settle(2);
  const holders = [...V().modules].filter(([, m]) => { let f = false; const w = n => { for (const q of n.children || []) { if (q && q.getAttribute && q.getAttribute('data-dest') === 'f.level') f = true; if (!f) w(q); } }; w(m.el); return f; }).map(([k]) => k);
  assert.deepEqual(holders, ['i1/filter'], 'the LEVEL knob is the Filter\'s face\'s alone');
  assert.ok(claimed().includes(id), 'claimed: a cord');
  const c = REC.list.find(x => x.id === id), fm = V().modules.get('i1/filter');
  assert.deepEqual([c.s, c.b, c.c, 'box' in c], [2, 'knob:' + id, RC.LOOK.c.lfo, false], 'the KNOB end, the LFO\'s orange, no keep-out box');
  const E = REC.at.get(c.b), K = V().ports().get('i1:f.level');
  assert.deepEqual([K.x, K.y, K.r], [fm.x + 80, fm.y + 260, 20], 'the knob: its centre, its radius');
  assert.ok(Math.abs(Math.hypot(E.x - K.x, E.y - K.y) - 20) < 1e-9, 'the anchor on the knob\'s rim (' + E.x + ', ' + E.y + ')');
  const end = LAYER.pointAt(id, 1), pre = LAYER.pointAt(id, 0.985);
  assert.ok(Math.hypot(end.x - E.x, end.y - E.y) < 1e-9, 'the rope\'s last point at the rim');
  const hd = Math.atan2(end.y - pre.y, end.x - pre.x), to = Math.atan2(K.y - end.y, K.x - end.x), dA = Math.abs(Math.atan2(Math.sin(hd - to), Math.cos(hd - to)));
  assert.ok(dA < 12 * Math.PI / 180, 'it arrives heading into the knob (radially, ' + (dA * 180 / Math.PI).toFixed(1) + '° off)');
  assert.equal(destEl('i1/filter', 'f.level').getAttribute('data-rig-cord'), String(RC.LOOK.c.lfo), 'the knob\'s ring: the cord\'s colour');
  const HL = [], hl0 = V().cables.highlight; V().cables.highlight = ids => { HL.push(ids); return hl0(ids); };
  W0.w.select('i1/filter'); await settle(1); W0.w.select(null); await settle(1);
  V().cables.highlight = hl0;
  assert.ok(Array.isArray(HL[0]) && HL[0].includes(id), 'the Filter selected: the cord into its knob raised with it');
  // its badge: above the cords, off every control, on its cord just outside the rim
  const top = LAYER.top(), b = V().cables.badge(id), bp = { x: parseFloat(b.style.left), y: parseFloat(b.style.top) };
  assert.deepEqual([b.parentNode === top, b.hidden, b.getAttribute('data-at')], [true, false, 'c'], 'in the layer above the cords, shown, centred on its place');
  const BW = 14 + 6.6 * b.children[0].textContent.length, hit = (p, w = BW) => ({ x: p.x - w / 2, y: p.y - 22, w, h: 44 }); // (its amount's text: the host's estimate)
  const knobRects = Object.entries(KN).flatMap(([k, L]) => { const m = V().modules.get(k); return L.map(([pid, dx, dy]) => ({ pid, x: m.x + dx, y: m.y + dy, w: 40, h: 40 })); });
  const over = (a, r) => a.x < r.x + r.w && a.x + a.w > r.x && a.y < r.y + r.h && a.y + a.h > r.y;
  assert.deepEqual(knobRects.filter(r => over(hit(bp), r)).map(r => r.pid), [], 'its 44 px hit covers no knob (' + bp.x + ', ' + bp.y + ')');
  const dl = Array.from({ length: 401 }, (_, i) => LAYER.pointAt(id, i / 400)).reduce((m, p) => Math.min(m, Math.hypot(p.x - bp.x, p.y - bp.y)), Infinity);
  assert.ok(dl <= 22 + BW / 2 + 2 && Math.hypot(bp.x - E.x, bp.y - E.y) < 120, 'on (or just beside) its cord, near the rim: ' + dl.toFixed(1) + ' px off the rope');
  // a second cord onto the knob (the Macros' first knob, blue): the rim points apart, the ring in both colours, the badges apart
  await tile('macros');
  const id2 = cv.mod.connect('i1/macros.k1', 'i1:f.level'); await settle(3);
  geometry(520, KN); await settle(2);
  const E1 = REC.at.get('knob:' + id), E2 = REC.at.get('knob:' + id2), a1 = Math.atan2(E1.y - K.y, E1.x - K.x), a2 = Math.atan2(E2.y - K.y, E2.x - K.x);
  assert.ok(Math.abs(Math.hypot(E2.x - K.x, E2.y - K.y) - 20) < 1e-9 && Math.abs(Math.atan2(Math.sin(a1 - a2), Math.cos(a1 - a2))) >= 40 * Math.PI / 180 - 1e-9, 'both on the rim, ≥ 40° apart');
  const kel = destEl('i1/filter', 'f.level');
  assert.deepEqual([kel.getAttribute('data-rig-cord') !== null, kel.hasAttribute('data-rig-ring')], [true, true], 'a segmented ring');
  const css = RG.ringCss([{ c: RC.LOOK.c.lfo, th: a1 }, { c: RC.LOOK.c.macros, th: a2 }]);
  assert.ok(/^conic-gradient\(from /.test(css) && css.includes('#e27c2f') && css.includes('#3f80d8'), 'its gradient carries each cord\'s colour: ' + css);
  const p1 = V().cables.badge(id), p2 = V().cables.badge(id2), q1 = { x: parseFloat(p1.style.left), y: parseFloat(p1.style.top) }, q2 = { x: parseFloat(p2.style.left), y: parseFloat(p2.style.top) };
  assert.equal(over(hit(q1), hit(q2)), false, 'the two badges apart (' + JSON.stringify([q1, q2]) + ')');
  cv.mod.opts.onPull(id2); await settle(3);
  RG.remove('i1/macros'); await settle(3);
  geometry(520, KN); await settle(2);
  assert.equal(kel.hasAttribute('data-rig-ring'), false, 'one cord again: a plain ring');
  // the badge drag re-targets: the ring and the rim follow
  const slot = +id.split(':')[2];
  cv.mod.opts.onRepatchMod(id, 'i1:g.amp'); await settle(3);
  assert.equal(S().matrix[slot].dst, 'g.amp', 're-targeted (its badge dragged onto the Amplifier\'s LEVEL)');
  geometry(520, KN); await settle(2);
  assert.equal(destEl('i1', 'g.amp').getAttribute('data-rig-cord'), String(RC.LOOK.c.lfo), 'the ring moved with it');
  assert.equal(destEl('i1/filter', 'f.level').getAttribute('data-rig-cord'), null);
  const am = V().modules.get('i1'), KA = V().ports().get('i1:g.amp'), c2 = REC.list.find(x => x.id === id), E3 = REC.at.get(c2.b);
  assert.ok(Math.abs(Math.hypot(E3.x - KA.x, E3.y - KA.y) - 20) < 1e-9 && Math.abs(KA.x - am.x - 240) < 1e-9, 'into the Amplifier\'s LEVEL knob now (its rim)');
  ID.lfoRow = id;
});

test('(fixer B2; review 2 P1-2) the host\'s side of an Envelope\'s OUT dropped on LEVEL by a drag: pulled off LEVEL, Envelope 1 moves to a free slot (envFromAmp: its OUT \'i1/env<k>.out\', k ≥ 2) whose jack the drag\'s port() has no port for (no sx-edges end — cv-cables then asks with the jacks); the host\'s canConnect / onConnect take the canvas jacks: plugged back that way, one step, the Envelope shapes the level again', async () => {
  const O = cv.mod.opts;
  if (!rigRec('env1.out', 'voice.level')) { O.onConnect('i1/env1.out', 'i1.level'); await settle(3); }
  const amp = rigRec('env1.out', 'voice.level');
  assert.ok(amp, 'Envelope 1 on LEVEL');
  O.onPull(amp.id); await settle(3);
  const env = keys().split(',').find(k => /^i1\/env[2-4]$/.test(k)), jk = env + '.out';
  assert.deepEqual([RC.isGate(S()), !!env], [true, true], 'pulled: the keys gate the level, its module at a free slot (' + env + ')');
  assert.deepEqual([O.port(jk), O.port('i1.level')], [null, 'i1.level'], 'no port for its OUT (the reviewer\'s refusal: the drag found none)');
  assert.deepEqual(O.canConnect(jk, 'i1.level'), { ok: true, why: '' }, 'the jacks themselves: accepted');
  const n0 = hsteps();
  O.onConnect(jk, 'i1.level'); await settle(3);
  assert.deepEqual([hsteps() - n0, RC.isGate(S())], [1, false], 'plugged back: one step, the Envelope shapes the level');
});

test('G13: no Serum word on a rig — its modules\' titles, texts, labels and tooltips, its menus, its jack menu, the notices of the flows above', async () => {
  const bad = /Serum|VOICE|Xfer/;
  const hits = [];
  for (const [k, m] of V().modules) {
    if (k === 'out' || k === 'i1/fx') continue;
    if (bad.test(m.title)) hits.push(k + ' title ' + m.title);
    const walk = n => { for (const c of n.children || []) { if (!c || typeof c !== 'object') continue; const t = [typeof c.textContent === 'string' ? c.textContent : '', c.title || '', c.getAttribute ? c.getAttribute('aria-label') || '' : '', c.getAttribute ? c.getAttribute('title') || '' : ''].join(' | '); if (bad.test(t)) hits.push(k + ': ' + t.slice(0, 80)); walk(c); } };
    walk(m.el);
    const items = cv.menu(k), lab = L => L.flatMap(i => [i.label || '', ...(Array.isArray(i.sub) ? lab(i.sub) : [])]);
    for (const l of lab(items)) if (bad.test(l)) hits.push(k + ' menu: ' + l);
  }
  RG.ui().jackMenu('i1.main', null, 0, 0);
  for (const i of RG.menuLast() || []) if (bad.test(i.label || '')) hits.push('jack menu: ' + i.label);
  for (const n of NOTES) if (bad.test(n)) hits.push('notice: ' + n);
  const W = api.sxHost(T(), 'i1').words; // (the kit's texts the Amplifier's Info… / Preferences… dialogs show)
  for (const k of ['build', 's1Tip', 's1Warp']) if (!W || bad.test(W[k] || 'missing')) hits.push('host words ' + k + ': ' + (W && W[k]));
  assert.equal(api.sxHost({ id: 'no-such-track', dev: { i1: { kind: 'synth', model: 'serum' } } }, 'i1').words, null, 'a Serum: the kit\'s own words');
  assert.deepEqual(hits, []);
});

test('§3.4 Remove: a Filter goes with its sources re-plugged where its OUT went (nothing silenced); the amp Envelope\'s Remove pulls its cord first (the gate back) — one step each; an LFO a row reads stays (said)', async () => {
  const s0 = JSON.stringify(S());
  assert.ok(ends().includes('oscA.out>filter.in'));
  cv.menu('i1/lfo1').find(i => i.label === 'Remove').action(); await settle(2);
  assert.match(note(), /^LFO 1 modulates 1 knob · its ⋯ → Remove All Destinations first$/);
  cv.menu('i1/filter').find(i => i.label === 'Remove').action(); await settle(3);
  assert.equal(cv.hist.u.at(-1).label, 'Remove Filter 1');
  assert.ok(!keys().includes('i1/filter') && ends().includes('oscA.out>voice.main'), 'Oscillator 1 now into the Amplifier');
  cv.menu('i1/env1').find(i => i.label === 'Remove').action(); await settle(3);
  assert.deepEqual([cv.hist.u.at(-1).label, RC.isGate(S()), keys().includes('i1/env1')], ['Remove Envelope 1', true, false]);
  cv.undo(); await settle(3); cv.undo(); await settle(3);
  assert.equal(JSON.stringify(S()), s0, 'undo, undo: exact');
});

test('§3.4 the kit\'s Swap with ENV 1 a party (sx-host → host.envSwap): Envelope 2 plugged into LEVEL through rig-core (the slot move, the lay renamed) while ENV 1 is the gate; refused while ENV 1 holds a real envelope', async () => {
  const t = await fresh('juno60');
  await tile('osc'); await tile('env'); // (Envelope 1 on LEVEL)
  const n0 = hsteps();
  RG.envSwap(null, 'env1', 'env3');
  assert.deepEqual([note(), hsteps()], [RC.WORDS.ampHeld(1), n0], 'a real envelope on LEVEL: refused, no step');
  cv.mod.opts.onPull(RG.edges().find(e => e.edge.b === 'voice.level').id); await settle(3);
  assert.ok(keys().includes('i1/env2') && RC.isGate(S()));
  RG.envSwap(null, 'env1', 'env2'); await settle(3);
  assert.deepEqual([RC.isGate(S()), keys().includes('i1/env1'), keys().includes('i1/env2')], [false, true, false], 'Envelope 1 (at slot 2) back on LEVEL: its module at env1');
  assert.equal(V().modules.get('i1/env1').title, 'Envelope 1');
  void t;
});

// (WC pre-deploy [amp-held]) the refusal on an occupied LEVEL read "Envelope 1 already shapes the level" whoever held it: with Envelope 2
// plugged into LEVEL (it keeps its name, §3.4) the module named Envelope 1 dragged onto LEVEL was told Envelope 1 holds it — the drag
// chip (the host's canConnect), the drop (onConnect's refusal notice) and the kit's swap (envSwap) now name the module in the amp slot
test('(WC pre-deploy [amp-held]) Envelope 2 on LEVEL: the module named Envelope 1 dragged onto LEVEL is refused naming Envelope 2 — the drag chip, the drop\'s notice, the kit\'s swap; nothing changes', async () => {
  await fresh('juno60');
  await tile('osc'); await tile('env'); await tile('env'); // (Envelope 1 on LEVEL, Envelope 2 added)
  const O = cv.mod.opts;
  O.onPull(rigRec('env1.out', 'voice.level').id); await settle(3); // (Envelope 1 pulled: the keys gate the level, its module at a free slot)
  O.onConnect('i1/env2.out', 'i1.level'); await settle(3); // (Envelope 2 shapes the level: slot 1, named 2)
  assert.deepEqual([RC.isGate(S()), V().modules.get('i1/env1').title], [false, 'Envelope 2'], 'Envelope 2 in the amp slot, its name kept');
  const e1 = [...V().modules].find(([k, m]) => /^i1\/env[2-4]$/.test(k) && m.title === 'Envelope 1')[0], held = 'Envelope 2 already shapes the level — pull it first';
  const s0 = snap(), n0 = hsteps();
  assert.deepEqual(O.canConnect(e1 + '.out', 'i1.level'), { ok: false, why: held }, 'the drag chip names Envelope 2');
  O.onConnect(e1 + '.out', 'i1.level'); await settle(3);
  assert.deepEqual([note().includes(held), note().includes('Envelope 1 already'), hsteps(), snap() === s0], [true, false, n0, true], 'the drop: refused naming Envelope 2, no step');
  RG.envSwap(null, 'env1', e1.slice(3)); await settle(2);
  assert.deepEqual([note(), hsteps(), snap() === s0], [held, n0, true], 'the kit\'s swap: the same words');
  assert.equal(RG.can(null, e1.slice(3) + '.out', 'voice.level').why, held, 'the test hook\'s can too');
});

const lastPatch = t => { const L = node(t).posted.map(x => x.m).filter(m => m.t === 'patch'); return L.length ? L[L.length - 1] : null; };
const stable = x => JSON.stringify(x, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v));

test('§3.5 the first drop on a Serum (complete) replaces it too (a Filter tile: its OUT into the Amplifier, its IN empty; "Replaced Serum with <NAME> · Filter 1"), undo brings the Serum back whole — its own FX and state; on a new (empty) Minimoog track a Noise tile the same way', async () => {
  const t = await fresh('serum');
  assert.equal(I(t).model, 'serum');
  assert.equal(keys(), 'i1,i1/fx,out', 'a Serum is the whole panel (no parts view, §6)');
  const before = snap(t);
  await tile('filter');
  assert.deepEqual([I().model, note(), ends()], ['rig', 'Replaced Serum with ' + RIG.NAME + ' · Filter 1 · tap to undo', 'filter.out>voice.main']);
  assert.equal(keys(), 'i1,i1/filter,i1/fx,out');
  cv.undo(); await settle(3);
  assert.equal(snap(), before, 'the Serum back whole');
  assert.equal(keys(), 'i1,i1/fx,out');
  const e = await fresh('minimoog');
  assert.equal(e.notes.length, 0, 'an empty track');
  await tile('noise');
  assert.deepEqual([I().model, ends(), note()], ['rig', 'noise.out>voice.main', 'Replaced Minimoog with ' + RIG.NAME + ' · Noise · tap to undo']);
  // + Track from a rig track: the starter (the model's defaults())
  const n = await fresh('rig');
  assert.deepEqual([I(n).model, ends()], ['rig', 'env1.out>voice.level filter.out>voice.main oscA.out>filter.in']);
  assert.ok(keys().includes('i1/oscA') && Object.keys(n.lay || {}).includes('i1/oscA'), 'its modules laid out by Tidy\'s rule (auto places)');
});

test('Q4 (a) / G5: ⋯ → Make it a <NAME> on a Serum — one step, the same state (adopt: only the AMP ENV switches), its FX, its preset name, its rows; the parts\' old places kept (keepLay); "Now a <NAME> · same sound · tap to undo"; the default Serum: OSC A into the off Filter 1 → a Filter 1 module ⏻ off with the cord into it (I1\'); the posted patch the Serum\'s (W2, host level); undo: the Serum', async () => {
  const t = await fresh('serum');
  await settle(3);
  const d = I(t), s0 = JSON.stringify(d.vals.s), fx0 = JSON.stringify(d.fx), p0 = stable(api.buildPatch(t));
  t.lay = Object.assign({}, t.lay || {}, { 'i1/oscA': { x: -704, y: 96 }, 'i1/env2': { x: -704, y: -480 } }); // (a parts view's old places, kept by STEPS[15])
  const n0 = hsteps(), ml = cv.menu('i1').map(i => i.label);
  assert.ok(!ml.some(l => /Show parts|Bundle|^Add$/.test(l || '')) && ml.includes('Make it a ' + RIG.NAME), 'the Serum\'s ⋯: no Show parts / Bundle / Add (§6), Make it a <NAME>');
  cv.menu('i1').find(i => i.label === 'Make it a ' + RIG.NAME).action(); await settle(4);
  assert.deepEqual([I().model, hsteps() - n0, note()], ['rig', 1, 'Now a ' + RIG.NAME + ' · same sound · tap to undo']);
  assert.deepEqual([JSON.stringify(S()), JSON.stringify(I().fx)], [s0, fx0], 'the same state and FX (no AMP ENV switch was off)');
  assert.deepEqual([T().lay['i1/oscA'].x, T().lay['i1/oscA'].y], [-704, 96], 'the old place kept');
  assert.ok(keys().includes('i1/filter') && keys().includes('i1/oscA'), 'the default Serum: OSC A and the Filter it feeds (⏻ off: I1\')');
  assert.ok(ends().includes('oscA.out>filter.in'), 'the cord into the off Filter');
  assert.equal(stable(api.buildPatch(T())), p0, 'W2 (host level): the rig\'s live patch is the Serum\'s, field for field');
  cv.undo(); await settle(3);
  assert.deepEqual([I().model, JSON.stringify(I().vals.s)], ['serum', s0]);
  cv.redo(); await settle(3);
  ID.conv = T().id;
});

test('G2 (host level): the posted {t: \'patch\'} of a rig track deep-equals a Serum track\'s with the same state and FX (qr, osCap, ext, fxr: the live path, not patchFor alone)', async () => {
  const r = T(), d = I(r);
  assert.equal(d.model, 'rig');
  api.sendPatch(r); await settle(3);
  const twin = await fresh('serum');
  const e = I(twin);
  e.vals = JSON.parse(JSON.stringify(d.vals)); e.fx = JSON.parse(JSON.stringify(d.fx)); e.preset = d.preset;
  api.sendPatch(twin); await settle(3);
  const a = lastPatch(r), b = lastPatch(twin);
  assert.ok(a && b, 'both posted');
  assert.equal(stable(a.p), stable(b.p), 'the same payload');
});

test('G5: a schema-15 project with a Serum shown as parts opens with the Serum whole (its flag gone, its parts\' places kept), the same state, the notice "… was shown as parts — it opens whole now. ⋯ → Make it a <NAME> …"; no module over another', async () => {
  const t = await fresh('serum'), s0 = JSON.stringify(I(t).vals.s);
  t.lay = Object.assign({}, t.lay || {}, { i1: { x: 0, y: 0, ui: 'parts' }, 'i1/oscA': { x: -704, y: 96, auto: 1 }, 'i1/filter': { x: -352, y: 96, auto: 1 } });
  const j = JSON.parse(await acc.projectFile());
  assert.equal(j.schema, CM.SCHEMA);
  j.schema = 15;
  const tr = j.tracks.find(x => x.id === t.id);
  tr.lay = { i1: { x: 0, y: 0, ui: 'parts' }, 'i1/oscA': { x: -704, y: 96, auto: 1 }, 'i1/filter': { x: -352, y: 96, auto: 1 } };
  const p = cv.loadProject(JSON.stringify(j));
  cv.applyRestore(p); await settle(4);
  const u = p.tracks.find(x => x.id === t.id);
  assert.deepEqual([CMOD.instOf(u).model, JSON.stringify(CMOD.instOf(u).vals.s), u.lay.i1.ui, !!u.lay['i1/oscA']], ['serum', s0, undefined, true]);
  assert.match(note(), new RegExp('“' + t.name + '”: its Serum was shown as parts — it opens whole now\\. ⋯ → Make it a ' + RIG.NAME + ' keeps the parts as a ' + RIG.NAME + ' \\(same sound\\)'));
  api.selectTrack(t.id); await settle(4);
  assert.equal(keys(), 'i1,i1/fx,out', 'whole: no part module');
  const R = V().rects(), ks = Object.keys(R), hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (let i = 0; i < ks.length; i++) for (let k = i + 1; k < ks.length; k++) assert.ok(!hit(R[ks[i]], R[ks[k]]), ks[i] + ' over ' + ks[k]);
});

test('G12: every other canvas as today — a Juno, a Serum complete, an 808, a 900 Series: drawMode lines, nothing claimed, no cord group or badge in cv-cables\' markup, the rig\'s cords gone from the layer (the 900 Series\' its own patch cords), the buffer only on the 900 Series; the master canvas refuses a module tile', async () => {
  // (the view's own layers: the last cv-cables / cv-cable-ends pair in #world — the boot view's were made before the sim's DOM fix and
  // stay in the stub's tree after their remove(); the badges and the × are #world's children too)
  const hasCord = () => {
    const kids = world().children || [], lastOf = cls => kids.filter(c => c.getAttribute && c.getAttribute('class') === cls).at(-1);
    let f = false;
    const w = n => { for (const c of n.children || []) { if (c && c.getAttribute && c.getAttribute('data-cord') != null) f = true; if (!f) w(c); } };
    for (const L of [lastOf('cv-cables'), lastOf('cv-cable-ends')]) if (L) w(L);
    for (const c of kids) if (c && c.getAttribute && /cv-mbadge/.test(c.getAttribute('class') || c.className || '') && c.getAttribute('data-cord') != null && c.isConnected !== false) f = true;
    return f;
  };
  for (const [m, buf] of [['juno60', false], ['serum', false], ['tr808', false], ['m900', true]]) {
    await fresh(m);
    assert.deepEqual([I().model, RG.mode(), claimed().length, hasCord(), REC.on], [m, 'lines', 0, false, buf], m);
    if (m !== 'm900') assert.equal((REC.list || []).length, 0, m + ': the layer empty');
    else assert.ok((REC.list || []).every(c => !/^x:|^o:/.test(c.id)), 'the 900 Series: its own cords only');
  }
  globalThis.__synthTest.master.open(); await settle(2);
  const n0 = hsteps();
  RG.drop('osc'); await settle(2);
  assert.deepEqual([hsteps(), /master takes effects/.test(note())], [n0, true], 'refused on the master canvas');
  globalThis.__synthTest.master.off(); await settle(2);
});

test('§3.5 the first drop on an 808 and on a 900 Series: replaced by a rig holding the module (the 900 Series\' modules and cords gone, the cord layer the rig\'s), undo brings each back whole (the 808\'s pattern memory, the 900 Series\' patch and its cords)', async () => {
  for (const m of ['tr808', 'm900']) {
    const t = await fresh(m), before = snap(t);
    await tile('osc');
    assert.deepEqual([I().model, ends(), RG.mode(), REC.on], ['rig', 'oscA.out>voice.main', 'cords', true], m + ' → a rig');
    assert.ok(!keys().split(',').some(k => /^i1\/m\d+$/.test(k)), 'no patch module left');
    assert.ok((REC.list || []).every(c => /^x:/.test(c.id)), 'the layer: the rig\'s cords only');
    cv.undo(); await settle(4);
    assert.equal(snap(), before, m + ': back whole');
    assert.equal(RG.mode(), 'lines');
    if (m === 'm900') assert.ok((REC.list || []).length > 0 && REC.on, 'the 900 Series\' cords and buffer back');
  }
});

/* ---- review 1, fixer A: the rig's rules at the host (P2-1 / P2-2 Remove a Filter, P3-1 Init on the amp Envelope, P3-2 a History no-op
   before an edit, P3-3 the amp cord's source end, the gate's "Already connected", P2-3 MPE the Serum's in WC-1) */
const levelOf = async (n = 57) => { await settle(2); api.noteOn(n, 100, 0); const held = sim.run(9600).get(node()), lv = peak(held.L, 4800); api.noteOff(n, 0); await settle(); sim.run(4800); return lv; };

test('review 1 P2-1 / P2-2: ⋯ → Remove on a Filter pulls every cord into it first, then plugs the sole ones where its OUT went — the other Filter that fed it too (nothing audible without a cord), a forked source keeps its other branch, a chained source follows into the next Filter; the removed Filter is no module after; one step each, it sounds before and after, undo exact', async () => {
  const cases = [ // [the cords after the three tiles (Oscillator 1, Filter 1, Filter 2), the Filter removed, the ends after, what]
    [[['oscA.out', 'filter2.in'], ['filter2.out', 'filter.in']], 'filter', 'filter2.out>voice.main oscA.out>filter2.in', 'Oscillator 1 → Filter 2 → Filter 1 → IN, Remove Filter 1: Filter 2 into IN'],
    [[['oscA.out', 'filter.in'], ['filter.out', 'filter2.in']], 'filter2', 'filter.out>voice.main oscA.out>filter.in', 'Oscillator 1 → Filter 1 → Filter 2 → IN, Remove Filter 2: Filter 1 into IN'],
    [[['oscA.out', 'filter.in'], ['filter.out', 'filter2.in']], 'filter', 'filter2.out>voice.main oscA.out>filter2.in', 'Oscillator 1 → Filter 1 → Filter 2 → IN, Remove Filter 1: the oscillator into Filter 2'],
    [[['oscA.out', 'filter.in'], ['oscA.out', 'filter2.in']], 'filter', 'filter2.out>voice.main oscA.out>filter2.in', 'Oscillator 1 forked into both, Remove Filter 1: its Filter 2 branch kept'],
  ];
  for (const [cords, part, after, what] of cases) {
    await fresh('juno60');
    await tile('osc'); await tile('filter'); await tile('filter');
    for (const [a, b] of cords) { RG.plug(null, a, b); await settle(3); }
    const lv0 = await levelOf(), s0 = JSON.stringify(S()), n0 = hsteps();
    cv.menu('i1/' + part).find(i => i.label === 'Remove').action(); await settle(3);
    assert.deepEqual([hsteps() - n0, cv.hist.u.at(-1).label], [1, 'Remove ' + (part === 'filter' ? 'Filter 1' : 'Filter 2')], what);
    assert.equal(ends(), after, what);
    assert.deepEqual([keys().split(',').includes('i1/' + part), RG.opts(null).shown.includes(part)], [false, false], what + ': the Filter gone');
    if (/forked/.test(what)) assert.deepEqual([C.destBase(S(), null, 'a.fbal'), S().osc[0].route], [1, 0], 'the balance all to Filter 2, still routed to the filters');
    const lv1 = await levelOf();
    assert.ok(lv0 > 0.02 && lv1 > 0.02, what + ': it sounds before and after (' + lv0.toFixed(4) + ' / ' + lv1.toFixed(4) + ')');
    cv.undo(); await settle(3);
    assert.equal(JSON.stringify(S()), s0, what + ': undo exact');
  }
});

test('review 1 P3-1: ⋯ → Init on the amp Envelope is envFromAmp (§3.4) — the module stays, unplugged, at the first free slot with its name and its values; the keys gate the level; one step "Init Envelope 1"; undo exact', async () => {
  await fresh('juno60');
  await tile('osc'); await tile('env');
  const att = C.destBase(S(), null, 'e1.att'), title = V().modules.get('i1/env1').title, s0 = JSON.stringify(S()), n0 = hsteps();
  const it = cv.menu('i1/env1').find(i => /^Init\b/.test(i.label || ''));
  assert.ok(it, 'its ⋯ has Init');
  it.action(); await settle(3);
  assert.deepEqual([hsteps() - n0, cv.hist.u.at(-1).label, note()], [1, 'Init Envelope 1', 'Envelope 1 unplugged · the keys gate the level again · tap to undo']);
  assert.deepEqual([RC.isGate(S()), keys().includes('i1/env1'), keys().includes('i1/env2')], [true, false, true], 'the gate on LEVEL; the module at slot 2');
  assert.equal(V().modules.get('i1/env2').title, title, 'its name kept');
  assert.equal(C.destBase(S(), null, 'e2.att'), att, 'its values kept');
  cv.undo(); await settle(3);
  assert.deepEqual([JSON.stringify(S()), keys().includes('i1/env1')], [s0, true], 'undo exact');
});

test('review 1 P3-2: a cord\'s colour picked again records nothing; a structural edit after a History no-op step (an edit that changed nothing) is its own step — its label, its meta, one undo reverts it (a plug, an add, a remove, Init)', async () => {
  await fresh('juno60');
  await tile('osc'); await tile('filter');
  const colours = () => { RG.ui().jackMenu('i1/oscA.out', null, 0, 0); return (RG.menuLast() || []).find(i => i.label === 'Colour').sub; };
  const n0 = hsteps();
  colours().find(i => !i.checked).action(); await settle(2);
  assert.equal(hsteps() - n0, 1, 'a new colour: one step');
  colours().find(i => i.checked).action(); await settle(2);
  assert.equal(hsteps() - n0, 1, 'the same colour again: no step');
  const edits = [
    ['Plug Oscillator 1 · OUT → Amplifier · DIRECT', () => RG.plug(null, 'oscA.out', 'voice.direct')],
    ['Add LFO 1', () => RG.drop('lfo')],
    ['Remove LFO 1', () => cv.menu('i1/lfo1').find(i => i.label === 'Remove').action()],
    ['Init ' + RIG.NAME, () => RG.init()],
  ];
  for (const [label, act] of edits) {
    cv.hist.record(P(), 'Nothing'); // (a no-op step: its snapshot is now's)
    const s0 = JSON.stringify(S()), k0 = keys(), n1 = hsteps();
    act(); await settle(3);
    assert.deepEqual([hsteps() - n1, cv.hist.u.at(-1).label, cv.hist.u.at(-2).label], [1, label, 'Nothing'], label + ': its own step');
    cv.undo(); await settle(3);
    assert.deepEqual([JSON.stringify(S()), keys()], [s0, k0], label + ': one undo reverts it');
    cv.redo(); await settle(3);
  }
});

test('review 1 P3-3: the amp cord\'s source end re-patched to the Envelope at slot 3 — a canvas row on Envelope 1\'s ATTACK follows Envelope 1 to slot 2, the modules keep their names; with equal fields still one step (the modules move); undo exact', async () => {
  for (const shaped of [true, false]) {
    await fresh('juno60');
    await tile('osc'); await tile('env');
    RG.add(null, 'env', 'env3'); await settle(3);
    if (shaped) { S().p['e1.att'] = 0.33; S().p['e3.dec'] = 0.2; api.sendPatch(T()); await settle(2); }
    cv.mod.add('lfo', null); await settle(3);
    const lk = Object.keys(T().dev).find(k => T().dev[k].kind === 'lfo'), id = cv.mod.connect(lk + '.out', 'i1:e1.att'); await settle(3);
    const t1 = V().modules.get('i1/env1').title, t3 = V().modules.get('i1/env3').title, s0 = JSON.stringify(S()), n0 = hsteps(), what = shaped ? 'shaped' : 'equal fields';
    assert.notEqual(t1, t3);
    RG.repatch(null, RG.edges().find(e => e.edge.b === 'voice.level').id, 'a', 'env3.out'); await settle(3);
    const row = T().mods.find(x => x.id === id);
    assert.deepEqual([hsteps() - n0, row && row.dst], [1, 'i1:e2.att'], what + ': one step, the row followed Envelope 1');
    assert.deepEqual([V().modules.get('i1/env1').title, V().modules.get('i1/env2') ? V().modules.get('i1/env2').title : null, keys().includes('i1/env3')], [t3, t1, false], what + ': the names follow the modules');
    assert.ok(ends().includes('env1.out>voice.level'));
    if (shaped) assert.ok(Math.abs(C.destBase(S(), null, 'e2.att') - 0.33) < 1e-9, 'Envelope 1\'s ATTACK at slot 2');
    cv.undo(); await settle(3);
    assert.deepEqual([JSON.stringify(S()), T().mods.find(x => x.id === id).dst, V().modules.get('i1/env1').title], [s0, 'i1:e1.att', t1], what + ': undo');
  }
});

test('review 1 (observation): Envelope 1 standing as the gate (a row reads it) — its OUT dropped on LEVEL again is "Already connected" (no step, nothing rewritten), its ⋯ → Init says the keys gate the level (no step); an Envelope tile adds Envelope 2 (slot 2, unplugged)', async () => {
  await fresh('juno60');
  await tile('osc');
  Object.assign(S().matrix[0], { src: 'env1', dst: 'a.level', amt: 0.3 }); api.sendPatch(T());
  cv.renderViews(); await settle(4);
  assert.deepEqual([RC.isGate(S()), keys().includes('i1/env1'), ends().includes('env1.out>voice.level')], [true, true, true], 'the gate, read: Envelope 1 stands on LEVEL');
  const s0 = JSON.stringify(S()), n0 = hsteps();
  assert.equal(RG.can(null, 'env1.out', 'voice.level').why, RC.WORDS.same);
  RG.plug(null, 'env1.out', 'voice.level'); await settle(3);
  assert.deepEqual([note(), hsteps() - n0, JSON.stringify(S()) === s0], [RC.WORDS.same, 0, true], 'nothing rewritten');
  cv.menu('i1/env1').find(i => /^Init\b/.test(i.label || '')).action(); await settle(3);
  assert.deepEqual([note(), hsteps() - n0, JSON.stringify(S()) === s0], [RC.WORDS.gate, 0, true], 'Init: the gate already');
  await tile('env');
  assert.deepEqual([cv.hist.u.at(-1).label, keys().includes('i1/env2'), RC.isGate(S())], ['Add Envelope 2', true, true], 'a new Envelope at slot 2, the gate kept');
});

test('review 1 P2-3 (the lead: MPE is the Serum\'s in WC-1, §13): with "MPE on by default" a new Serum has MPE on, a new rig (+ Track, Init) keeps it off; the Amplifier\'s MPE… is disabled with the words', async () => {
  api.store.set('synth.sx.prefs', { mpeDefault: 1 }); api.prefsChanged();
  try {
    await fresh('serum');
    assert.equal(S().global.mpe.on, 1, 'a Serum: on');
    await fresh(RIG.ID);
    assert.deepEqual([I().model, S().global.mpe.on], [RIG.ID, 0], 'a rig\'s starter: off');
    RG.init(); await settle(3);
    assert.deepEqual([cv.hist.u.at(-1).label, S().global.mpe.on], ['Init ' + RIG.NAME, 0], 'Init: off');
  } finally { api.store.set('synth.sx.prefs', {}); api.prefsChanged(); }
  assert.ok(RC.WORDS.mpeLater.includes(RIG.NAME) && !/Serum|VOICE|Xfer/.test(RC.WORDS.mpeLater));
});

/* ---------------------------------------------------------------- review 2 (fixer B1): the browser review's findings, ported */
const kidsOf = (el, f, out = []) => { for (const c of (el && el.children) || []) { if (c && c.getAttribute && f(c)) out.push(c); if (c) kidsOf(c, f, out); } return out; };
const clsOf = c => ' ' + String((c.getAttribute && c.getAttribute('class')) || (typeof c.className === 'string' ? c.className : '') || '') + ' ';
const rowJacks = key => kidsOf(V().modules.get(key).el, c => c.getAttribute('data-jack') != null && clsOf(c).includes(' rig-jack '));

test('review 2 P1-1: the first drop leaves the rig patchable — once its faces mount, every jack-row jack is its module\'s jack (data-cv-jack, a focusable button) and the cord layer\'s anchor is its measured centre, not the edge dot; every first drop of a session', async () => {
  for (const [kind, part] of [['osc', 'oscA'], ['filter', 'filter']]) {
    await fresh('juno60');
    await tile(kind);
    for (const k of ['i1', 'i1/' + part]) {
      const J = rowJacks(k), m = V().modules.get(k);
      assert.ok(J.length > 0, k + ': its jack row');
      for (const je of J) {
        const id = k + '.' + je.getAttribute('data-jack'), A = REC.at && REC.at.get(id);
        assert.deepEqual([je.getAttribute('data-cv-jack'), je.getAttribute('data-kind'), je.getAttribute('role')], [id, 'cord', 'button'], kind + ' ' + id + ': the anchor is the jack'); // (its tab stop: cv-module.test, a DOM that reflects tabIndex)
        assert.ok(!!A && Math.abs(A.x - (m.x + m.w)) > 1, kind + ' ' + id + ': the layer\'s anchor measured (' + (A && A.x) + ', the edge ' + (m.x + m.w) + ')');
      }
    }
  }
});

test('review 2 P2-1 / P3-4: a modulation cord onto the rig\'s own knob is a History step — LFO 1 → CUTOFF one step "Modulate … with LFO 1" with "· tap to undo"; ↶ takes it (the step before it untouched), ↷ brings it; its badge re-aimed (CUTOFF → RES) one step; pulled away one step "Cord pulled · tap to undo"; a plug from a jack\'s menu says "· tap to undo" too', async () => {
  await fresh('juno60');
  await tile('osc'); await tile('filter'); await tile('lfo');
  const prev = cv.hist.u.at(-1).label, s0 = JSON.stringify(S()), n0 = hsteps();
  const id = cv.mod.connect('i1/lfo1.out', 'i1:f.cutoff'); await settle(3);
  assert.match(String(id), /^o:i1:\d+$/, 'the rig\'s own row');
  const slot = +String(id).split(':')[2], lab = cv.hist.u.at(-1).label;
  assert.equal(hsteps() - n0, 1, 'one History step');
  assert.match(lab, /^Modulate .+ with LFO 1$/);
  assert.equal(note(), lab + ' · tap to undo');
  assert.deepEqual([S().matrix[slot].src, S().matrix[slot].dst], ['lfo1', 'f.cutoff']);
  assert.ok(claimed().includes(id), 'a cord');
  const s1 = JSON.stringify(S());
  cv.undo(); await settle(3);
  assert.deepEqual([JSON.stringify(S()) === s0, cv.hist.u.at(-1).label], [true, prev], '↶: the row gone, the step before it still there');
  cv.redo(); await settle(3);
  assert.equal(JSON.stringify(S()), s1, '↷: back');
  const n1 = hsteps();
  cv.mod.opts.onRepatchMod(id, 'i1:f.res'); await settle(3);
  assert.deepEqual([hsteps() - n1, S().matrix[slot].dst], [1, 'f.res'], 'the badge re-aimed: one step');
  assert.match(cv.hist.u.at(-1).label, /^Re-patch LFO 1 → .+/);
  assert.equal(note(), cv.hist.u.at(-1).label + ' · tap to undo');
  cv.undo(); await settle(3);
  assert.equal(S().matrix[slot].dst, 'f.cutoff', '↶ the re-aim');
  cv.redo(); await settle(3);
  const n2 = hsteps(), s2 = JSON.stringify(S());
  cv.mod.opts.onPull(id); await settle(3);
  assert.deepEqual([hsteps() - n2, note()], [1, 'Cord pulled · tap to undo'], 'pulled away: one step');
  assert.ok(!S().matrix[slot].src, 'the row cleared');
  cv.undo(); await settle(3);
  assert.equal(JSON.stringify(S()), s2, '↶ the pull: exact');
  // (P3-4) a jack menu's plug: one step with its notice
  RG.ui().jackMenu('i1/oscA.out', null, 0, 0);
  const con = (RG.menuLast() || []).find(i => i.label === 'Connect to'), it = con && con.sub.find(i => i.label === 'Amplifier · DIRECT');
  assert.ok(it, 'Connect to ▸ Amplifier · DIRECT');
  const n3 = hsteps();
  it.action(); await settle(3);
  assert.deepEqual([hsteps() - n3, cv.hist.u.at(-1).label, note()], [1, 'Plug Oscillator 1 · OUT → Amplifier · DIRECT', 'Plug Oscillator 1 · OUT → Amplifier · DIRECT · tap to undo']);
});

test('review 2 P2-2: a dry source\'s cord says "dry" — rig-core\'s tag is the record\'s label (cv-cables draws it above the IN plug in cords mode, above the line in lines mode)', async () => {
  await fresh('juno60');
  await tile('osc'); await tile('filter');
  RG.plug(null, 'oscA.out', 'filter.in'); await settle(3);
  S().p['f.routeA'] = 0; api.sendPatch(T()); cv.renderViews(); await settle(4);
  const r = RG.edges().find(e => e.edge.a === 'oscA.out' && e.edge.b === 'filter.in');
  assert.deepEqual([!!r && r.dry, r && r.label], [true, RC.WORDS.dry]);
  const tags = () => kidsOf(world(), c => c.getAttribute('data-cable') === r.id).flatMap(g => kidsOf(g, c => clsOf(c).includes(' cv-cable-lab '))).map(x => x.textContent);
  assert.deepEqual(tags(), [RC.WORDS.dry], 'cords: the tag');
  RG.wires('lines'); await settle(3);
  assert.deepEqual(tags(), [RC.WORDS.dry], 'lines: the tag');
  RG.wires('cords'); await settle(3);
  const other = RG.edges().find(e => e.edge.a === 'filter.out');
  assert.equal(other.label, undefined, 'a filtered cord: no tag');
});

test('review 2 P2-6: the first drop brings the new rig into view — the world fits its group (the module, the Amplifier, its FX panel; OUT, where the old one stood, a pan away) into the band it frames (clear of an open Sources tray)', async () => {
  await fresh('juno60');
  const F = [];
  W0.w.fit = o => { F.push(o); };
  try { await tile('noise'); } finally { delete W0.w.fit; }
  const o = F.find(x => x && Array.isArray(x.ids));
  assert.ok(o, 'a fit');
  assert.deepEqual(o.ids.slice().sort(), ['i1', 'i1/fx', 'i1/noise']);
  assert.equal(o.animate, true);
});

test('review 2 P3-2: the bars of a rig\'s modules do not repeat "<NAME>" under every title (the Amplifier keeps the instrument\'s name); P3-6 the Noise cord on the layer is its rule\'s Cream', async () => {
  await fresh('juno60');
  await tile('osc'); await tile('noise'); await tile('lfo'); await tile('sub');
  const sub = k => { const s = V().modules.get(k).titleEl.children[1]; return s.hidden ? '' : s.textContent; };
  assert.deepEqual(['i1/oscA', 'i1/noise', 'i1/lfo1', 'i1/sub'].map(sub), ['', '', '', '']);
  assert.ok(sub('i1').length > 0, 'the Amplifier: "' + sub('i1') + '"');
  assert.deepEqual(['i1/sub', 'i1/noise', 'i1/oscA'].map(k => V().modules.get(k).title), ['Sub osc', 'Noise', 'Oscillator 1'], 'a title its bar holds (the 3-column bar: "Sub osc")');
  const c = REC.list.find(x => x.a === 'i1/noise.out');
  assert.equal(c && c.c, RC.LOOK.c.noise);
});

// the rig's true geometry in the stub DOM (review 2's measure, tidyproto.mjs): every module its world rect at its face's height (rig-ui
// sizeOf + the 40 px bar; the FX panel 420, OUT 260), each jack-row jack at its cell (layoutOf: inputs from the left, outputs from the right),
// a Macros tile at its knob cell, each knob at its cell's knob centre (every other [data-dest] element 0 × 0: not an end) — read lazily, so
// the rects follow the modules — then the view measures again
const kindOfPart = part => Object.keys(RC.MODULES).find(k => RC.MODULES[k].slots.includes(part)) || null;
const cvModVGAP = 64; // (cv-module VGAP: the band's bottoms at least this far over the chain's tops)
const PRE = { oscA: 'a', oscB: 'b', oscC: 'c', sub: 's', noise: 'n', filter: 'f.', filter2: 'f2.' };
const crect = (x, y, w, h) => ({ left: VP.left + x, top: VP.top + y, width: w, height: h, right: VP.left + x + w, bottom: VP.top + y + h, x: VP.left + x, y: VP.top + y });
function rigGeometry() {
  for (const [k, m] of V().modules) {
    const q = CMOD.partOf(k), part = q ? q.part : k === 'i1' ? 'voice' : null, kind = part === 'voice' ? 'amp' : part ? kindOfPart(part) : null;
    const H = kind && RU.FACE[kind] ? RU.sizeOf(kind, part).h + 40 : k === 'out' ? 260 : 420;
    m.el.getBoundingClientRect = () => crect(m.x, m.y, m.w, H);
    m.el.offsetHeight = H;
    if (!kind || !RU.FACE[kind]) continue;
    const L = RU.layoutOf(RU.FACE[RU.variantOf(kind, { k: part === 'env1' ? 0 : 1 })]), pre = /^env\d$/.test(part) ? 'e' + part.slice(3) : /^lfo\d+$/.test(part) ? 'l' + part.slice(3) : PRE[part] || '', at = new Map();
    for (const r of L.rows) for (const c of r.cells || []) {
      if (c.jack) at.set('>' + c.jack.port, { x: c.cx, y: 40 + r.top + 18 });
      else if (r.t === 'knobs') for (const a of c.alts || []) { if (a.id) at.set(String(a.id).replace(/^@/, pre), { x: c.cx, y: 40 + r.top + 24 }); else if (/^m[1-8]$/.test(a.name || '')) at.set('>k' + a.name.slice(1), { x: c.cx, y: 40 + r.top + 24 }); }
    }
    const els = kidsOf(m.el, c => c.getAttribute('data-jack') != null || c.getAttribute('data-dest') != null), seen = new Set(els.map(e => (e.getAttribute('data-jack') != null ? '>' + e.getAttribute('data-jack') : e.getAttribute('data-dest'))));
    for (const [id] of at) if (!seen.has(id)) { const e = globalThis.document.createElement('span'); e.setAttribute(id[0] === '>' ? 'data-jack' : 'data-dest', id[0] === '>' ? id.slice(1) : id); m.body.append(e); els.push(e); } // (the stub DOM builds no kit knob, no Macros tile: a stand-in at its cell)
    for (const e of els) {
      const jk = e.getAttribute('data-jack'), p = jk != null ? at.get('>' + jk) : at.get(e.getAttribute('data-dest')), s = jk != null ? 28 : 40;
      e.getBoundingClientRect = p ? () => crect(m.x + p.x - s / 2, m.y + p.y - s / 2, s, s) : () => crect(0, 0, 0, 0);
    }
  }
  cv.render(); V().remeasure();
}
// review 2's measure: the cords whose drawn rope passes inside a module other than its two ends (and its BACK end's target), 3 px in — the
// rope as the GL layer draws it once it has settled after Tidy moved its ends (cv-cords' own seed / step / smooth / along — a mod cord ends
// at its knob's rim since fixer B2, no dive; the SVG
// layer here draws the motion-off parabola, which hangs less: headless Chrome measured the same lay at S1 0 · S2 0 · S3 1)
const settled = (A, B) => {
  const r = makeRope(STUDIO.N), P = new Float64Array(2 * (2 + (STUDIO.N - 2) * STUDIO.SUB));
  seed(r, A.x, A.y, B.x, B.y, true);
  for (let i = 0; i < 1200; i++) step(r, A.x, A.y, B.x, B.y, STUDIO.DT);
  const m = smooth(r.X, r.Y, r.n, STUDIO.SUB, P);
  return u => along(P, m, u);
};
function crossings() {
  const M = [...V().modules].map(([k, m]) => ({ k, x0: m.x, y0: m.y, x1: m.x + m.w, y1: m.y + m.rect().h }));
  const modOf = j => { const s = String(j).replace(/#\d+$/, ''), i = s.lastIndexOf('.'); return i > 0 ? s.slice(0, i) : s; };
  const out = [];
  for (const c of REC.list || []) {
    const A = REC.at.get(c.a), B = REC.at.get(c.b), hits = new Set();
    if (!A || !B) continue;
    // its own ends: the jacks' modules, and (fixer B2) the module whose knob a mod cord ends on — found by where the end lies (the user's
    // "directly to the back of the knob": crossing its own target's face is the design, any other face is a crossing)
    const inM = q => M.filter(m => q.x >= m.x0 && q.x <= m.x1 && q.y >= m.y0 && q.y <= m.y1).map(m => m.k);
    const ends = [modOf(c.a), modOf(c.b), ...inM(A), ...inM(B)];
    const at = settled(A, B);
    for (let i = 0; i <= 80; i++) {
      const p = at(i / 80);
      if (!p) continue;
      for (const m of M) { if (ends.includes(m.k)) continue; if (p.x > m.x0 + 3 && p.x < m.x1 - 3 && p.y > m.y0 + 3 && p.y < m.y1 - 3) hits.add(m.k); }
    }
    if (hits.size) out.push(c.id + ' × ' + [...hits].join(', '));
  }
  return out;
}
const SCENES = {
  S1: [['lfo'], ['lfo1', 'f.cutoff']],
  S2: [['env', 'lfo', 'lfo', 'macros'], ['env2', 'f.cutoff'], ['lfo1', 'a.wt'], ['lfo2', 'f.res']],
  S3: [['osc', 'osc', 'sub', 'noise', 'filter', 'env', 'env', 'env', 'lfo', 'lfo', 'macros'], ['lfo1', 'a.wt'], ['lfo1', 'b.wt'], ['lfo2', 'f.cutoff'], ['lfo2', 'f2.cutoff'], ['env2', 'f.cutoff'], ['env3', 'f2.cutoff'], ['env4', 'c.wt'], ['macros.k1', 'a.level']],
};
async function scene(name) {
  await fresh(RIG.ID); // (the starter: Oscillator 1 → Filter 1 → Amplifier, Envelope 1 on LEVEL)
  const [adds, ...rows] = SCENES[name];
  for (const k of adds) { RG.add(null, k); await settle(2); }
  if (name === 'S3') { for (const [a, b] of [['oscB.out', 'filter.in'], ['oscC.out', 'filter2.in'], ['noise.out', 'filter2.in'], ['sub.out', 'voice.main'], ['filter2.out', 'voice.main']]) RG.plug(null, a, b); await settle(2); }
  for (const [a, b] of rows) cv.mod.connect('i1/' + (a.includes('.') ? a : a + '.out'), 'i1:' + b);
  await settle(3);
  rigGeometry(); await settle(2);
  cv.tidy(); await settle(3);
  rigGeometry(); await settle(3);
}
const box = k => { const m = V().modules.get(k); return { x: m.x, y: m.y, w: m.w, h: m.rect().h }; };
test('review 2 P2-5 (the user\'s rule: "shouldnt envelope come after the oscillator in the chain?") Tidy on a rig — the chain on one row left → right (sources → filters → Amplifier → FX → OUT), every modulator in one band above it over what it drives (Envelope 1 over the Amplifier); review 2\'s scenes measured on the cord layer: S1 0, S2 0, S3 ≤ 1 cords across a face between their ends', async () => {
  const counts = {};
  for (const name of ['S1', 'S2', 'S3']) {
    await scene(name);
    const L = T().lay, chain = ['i1/oscA', 'i1/filter', 'i1', 'i1/fx', 'out'];
    assert.deepEqual(chain.map(k => L[k].y), chain.map(() => L['i1/oscA'].y), name + ': the chain on one row');
    for (let i = 1; i < chain.length; i++) assert.ok(L[chain[i]].x > L[chain[i - 1]].x, name + ': ' + chain[i - 1] + ' → ' + chain[i] + ' left to right');
    const top = L.i1.y, band = Object.keys(L).filter(k => /^i1\/(env\d|lfo\d+|macros)$/.test(k));
    for (const k of band) { const b = box(k); assert.ok(b.y + b.h <= top - cvModVGAP, name + ': ' + k + ' in the band above the chain'); }
    const e1 = box('i1/env1'), a = box('i1');
    assert.ok(e1.x + e1.w / 2 >= a.x && e1.x + e1.w / 2 <= a.x + a.w || name === 'S3', name + ': Envelope 1 over the Amplifier');
    counts[name] = crossings();
  }
  assert.deepEqual([counts.S1, counts.S2], [[], []], 'S1, S2: no cord across a face');
  assert.ok(counts.S3.length <= 1, 'S3: ≤ 1 (' + counts.S3.join(' | ') + ')');
});

test('review 2 P2-5: an add never moves a module already standing — a tapped LFO waits at the band\'s left end (no target yet), an Envelope tapped onto the gate lands over the Amplifier, a Filter with no room in the row goes below it; Tidy then lays them by the rule', async () => {
  await fresh('juno60');
  await tile('osc');
  rigGeometry(); cv.tidy(); await settle(3); rigGeometry(); await settle(2);
  const snapLay = () => JSON.stringify(Object.fromEntries(Object.entries(T().lay).map(([k, e]) => [k, [e.x, e.y]])));
  let before = JSON.parse(snapLay());
  await tile('env'); rigGeometry(); await settle(2);
  const keep = (what) => { const now = JSON.parse(snapLay()); for (const k of Object.keys(before)) assert.deepEqual(now[k], before[k], what + ': ' + k + ' did not move'); before = now; };
  keep('Envelope 1');
  const e1 = box('i1/env1'), a = box('i1');
  assert.ok(e1.x + e1.w / 2 >= a.x && e1.x + e1.w / 2 <= a.x + a.w && e1.y + e1.h <= a.y - cvModVGAP, 'Envelope 1 over the Amplifier, in the band');
  await tile('lfo'); rigGeometry(); await settle(2);
  keep('LFO 1');
  const l1 = box('i1/lfo1'), o = box('i1/oscA');
  assert.ok(l1.x + l1.w <= Math.min(o.x, e1.x) - 32 && l1.y + l1.h <= a.y - cvModVGAP, 'LFO 1 at the band\'s left end');
  await tile('filter'); rigGeometry(); await settle(2);
  keep('Filter 1');
  const f = box('i1/filter');
  for (const k of ['i1/oscA', 'i1', 'i1/env1', 'i1/lfo1']) { const b = box(k); assert.ok(!(f.x < b.x + b.w && b.x < f.x + f.w && f.y < b.y + b.h && b.y < f.y + f.h), 'the Filter clear of ' + k); }
});

/* ------------------------------------------------------------------ integration fixer L (review WC-int, 2026-10-26: layout, camera, tray) */
// the camera as cv-world moves it: the scripted world's band / fit / focusItem made real for a framing test — a fit is cv-world's fitCam into
// the band (FIT_PAD 48; never below its kMin: what does not fit keeps its start in view — its focus ids whole, (B3) cv-world's fit), a focus centres its module at the k asked (fitted when larger); each reads the modules' rects when called. The band
// past an open Sources tray (240 px past the 44 px rail) unless told; restored after (the rest of the file keeps the still camera)
const FIT_PAD = 48, TRAY_BAND = { left: 284, top: 48, right: 1520, bottom: 900 };
function camera(band = TRAY_BAND) {
  const W = W0.w, was = { band: W.band, fit: W.fit, focusItem: W.focusItem }, calls = [];
  const rectOf = id => { const m = V().modules.get(id); return m ? m.rect() : null; };
  const set = c => { W.cam = { tx: c.tx, ty: c.ty, k: c.k }; W.k = c.k; };
  const bw = band.right - band.left, bh = band.bottom - band.top, ox = band.left - VP.left, oy = band.top - VP.top;
  W.band = () => Object.assign({}, band);
  W.fit = o => { const ids = (o && o.ids) || [...V().modules.keys()]; calls.push('fit ' + ids.slice().sort().join(',')); const c = fitCam(ids.map(rectOf).filter(Boolean), bw, bh, { pad: FIT_PAD, kMax: (o && o.kMax) || 1, kMin: o && o.kMin, foot: !!(o && o.foot), focus: o && Array.isArray(o.focus) ? o.focus.map(rectOf).filter(Boolean) : null }); set({ tx: c.tx + ox, ty: c.ty + oy, k: c.k }); }; // (its kMin / foot / focus as cv-world's fit)
  W.focusItem = (id, o) => { const r = rectOf(id); if (!r) return; const k = Math.min(o && o.k > 0 ? o.k : 1, (bw - 2 * FIT_PAD) / r.w, (bh - 2 * FIT_PAD) / r.h); calls.push('focus ' + id); set({ tx: ox + bw / 2 - (r.x + r.w / 2) * k, ty: oy + bh / 2 - (r.y + r.h / 2) * k, k }); };
  set({ tx: 0, ty: 0, k: 1 });
  return { calls, set, done() { W.band = was.band; W.focusItem = was.focusItem; if (was.fit) W.fit = was.fit; else delete W.fit; set({ tx: 0, ty: 0, k: 1 }); } };
}
// the share of module k inside the band on screen (0 … 1) at the world's camera
function seen(k, band = TRAY_BAND) {
  const m = V().modules.get(k);
  if (!m) return 0;
  const r = m.rect(), a = W0.w.toClient(r.x, r.y), b = W0.w.toClient(r.x + r.w, r.y + r.h);
  const w = Math.max(0, Math.min(b.x, band.right) - Math.max(a.x, band.left)), h = Math.max(0, Math.min(b.y, band.bottom) - Math.max(a.y, band.top));
  return w * h / Math.max(1, (b.x - a.x) * (b.y - a.y));
}
const rigKeys = () => [...V().modules.keys()].filter(k => k === 'i1' || k.startsWith('i1/'));
// the History steps after step u0 (History keeps 200 and this file fills it: a length difference reads 0 there)
const since = u0 => cv.hist.u.length - 1 - cv.hist.u.lastIndexOf(u0);

test('integration fixer L, review WC-int B2: a tapped module comes into view — with the Sources tray open (the band past it), each module tapped onto a rig (a Filter, an Envelope, an LFO at the band\'s left end, a second Oscillator under its neighbour, Macros) is ≥ 0.6 inside the band once its face has mounted, the camera panned at the zoom it had (modShow, the modulators\' rule); a dropped LFO that overlapped the Effects panel goes to the nearest free spot (under it, not 400 px up) and the camera follows it there', async () => {
  await fresh('juno60');
  await tile('osc'); rigGeometry(); await settle(2);
  const C = camera();
  try {
    for (const [kind, key] of [['filter', 'i1/filter'], ['env', 'i1/env1'], ['lfo', 'i1/lfo1'], ['osc', 'i1/oscB'], ['macros', 'i1/macros']]) {
      W0.w.fit({ ids: rigKeys() }); // (the user's view: the rig as it stands, framed)
      const k0 = W0.w.k;
      RG.drop(kind); rigGeometry(); await settle(3);
      assert.ok(V().modules.has(key), key + ' added');
      assert.ok(seen(key) >= 0.6, key + ' in view: ' + seen(key).toFixed(2) + ' (' + C.calls.at(-1) + ')');
      assert.ok(Math.abs(W0.w.k - k0) < 1e-9, key + ': the zoom it had');
    }
    // a drop overlapping the Effects panel's foot: the nearest free spot is under it (the old rule pushed a modulator up past the whole panel)
    W0.w.fit({ ids: rigKeys() });
    const fx = box('i1/fx'), at = { x: fx.x + 32, y: fx.y + fx.h - 96 };
    RG.drop('lfo', at); rigGeometry(); await settle(3);
    const l2 = box('i1/lfo2');
    assert.deepEqual([l2.x, l2.y], [at.x, Math.ceil((fx.y + fx.h + cvModVGAP) / 32) * 32], 'under the Effects panel, VGAP clear');
    assert.ok(seen('i1/lfo2') >= 0.6, 'the moved drop in view: ' + seen('i1/lfo2').toFixed(2));
  } finally { C.done(); }
});

// (an iPad upright with the Sources tray open: taller than wide — a rig's Tidy, its starter's lay too, wraps after the Amplifier there)
const PORTRAIT_BAND = { left: 284, top: 48, right: 1024, bottom: 1300 };
// (B3's second check) the keyboard tray up — the app's default on a fresh profile, how notes are played on the iPad: the band less its
// 170 px row (headless Chrome, the Sources tray open: desktop 1440 × 900 1200 × 439, iPad landscape 1126 × 544, upright 784 × 886), and the
// short screens the harm check measured (an iPad 11" in Chrome 1194 × 760: 954 × 299; 960 × 600, a desktop at 150 %: 720 × 139); (its third
// check, Chrome for Testing) the iPad's split views, upright and narrow (678 × 1024: 438 × 588; 504 × 1366: 264 × 930) — only the chain's start
// fits across, so it alone is what both sides hold
const KB_BANDS = [{ left: 284, top: 48, right: 1484, bottom: 487 }, { left: 284, top: 48, right: 1410, bottom: 592 }, { left: 284, top: 48, right: 1068, bottom: 934 },
  { left: 284, top: 48, right: 1238, bottom: 347 }, { left: 284, top: 48, right: 1004, bottom: 187 }, { left: 284, top: 48, right: 722, bottom: 636 },
  { left: 284, top: 48, right: 548, bottom: 978 }];
// what a first view holds whole when the rig is wider than the band at READ_K (B3): the module just added (lead), else the chain's start (the
// left-most of the Amplifier's row, no modulator, not its FX); the Amplifier; its Envelope 1
const MODK = /\/(env\d|lfo\d+|macros)$/;
function firstKeys(lead) {
  const A = box('i1'), row = rigKeys().filter(k => k !== 'i1' && k !== 'i1/fx' && !MODK.test(k) && box(k).y < A.y + A.h && box(k).y + box(k).h > A.y).sort((a, b) => box(a).x - box(b).x);
  return [lead || row[0], 'i1', 'i1/env1'].filter(k => k && V().modules.has(k));
}
test('integration fixer L, review WC-int B3 (tightened after its checks, 2026-10-26: a first view whose knobs answer, what matters in it) — a new <NAME> is framed on every entry point: the <NAME> tile on another instrument, a new track from the tray (its starter: the track\'s default camera), a rig track never moved switched back to (a grown one too: two LFOs at the band\'s left end), ⋯ → Make it a <NAME>, a module tile\'s Replace — once its faces have mounted (the fit reads their heights, not their bars) and NEVER below READ_K (cv-world: below it a press on a module pans instead of turning its knob — the 900 Series default\'s floor): the whole rig (the band, the chain, the Amplifier, its FX panel; OUT where the old one stood excepted) ≥ 0.9 inside the band when it fits there at READ_K or more, else at READ_K with WHAT MATTERS first (reworked after its second checks: in priority order — the module just added, else the chain\'s start; the Amplifier; its Envelope 1 — on each side the rig does not fit, the longest head of it that fits there whole, Envelope 1 dropped before the chain row, the chain\'s start\'s top-left in view when even that does not fit; centred, slid back only so far that no blank band opens where the rig goes on; the head BOTH sides hold — a split view centres the chain\'s start, after its third check) — past the open Sources tray, landscape and upright, the keyboard tray up and the short screens (the four cases met); a press on the canvas while the faces mount, or a finger still down on it then, leaves the camera to the user (no fit)', async () => {
  const met = { whole: 0, floor: 0, dropped: 0, start: 0 };
  const check = async (what, act, band = TRAY_BAND, press = false, lead = null) => {
    const C = camera(band), reads = [];
    const fit0 = W0.w.fit;
    W0.w.fit = o => { reads.push(((o && o.ids) || []).map(k => { const m = V().modules.get(k); return m && !m.fold ? m.rect().h : 99; })); fit0(o); };
    const down = () => W0.w.el.dispatchEvent({ type: 'pointerdown', pointerId: 7, bubbles: true, defaultPrevented: false, stopPropagation() {}, preventDefault() {} }); // (the user's finger on the canvas: the world's own element here)
    try {
      if (press === 'held') down();
      act();
      if (press === 'after') down();
      for (let i = 0; i < 6; i++) { rigGeometry(); sim.raf(); await sim.settle(4); }
      assert.equal(I().model, RIG.ID, what + ': a ' + RIG.NAME);
      if (press) { assert.equal(reads.length, 0, what + ': no fit (' + press + ')'); sim.win('pointerup', { pointerId: 7 }); return; }
      assert.ok(reads.length >= 1, what + ': framed');
      assert.ok(reads.at(-1).length >= 3 && reads.at(-1).every(h => h > 40), what + ': the fit read the faces\' heights (' + reads.at(-1) + ')');
      const k = W0.w.k, R = rigKeys().map(q => V().modules.get(q).rect()), kAll = fitCam(R, band.right - band.left, band.bottom - band.top, { pad: FIT_PAD }).k;
      assert.ok(k >= READ_K - 1e-9, what + ': never below READ_K (k ' + k.toFixed(3) + '; the whole rig would want ' + kAll.toFixed(3) + ')');
      if (kAll >= READ_K) {
        met.whole++;
        for (const q of rigKeys()) assert.ok(seen(q, band) >= 0.9, what + ': ' + q + ' in view ' + seen(q, band).toFixed(2));
      } else {
        met.floor++;
        assert.ok(Math.abs(k - READ_K) < 1e-9, what + ': at READ_K (' + k.toFixed(3) + ')');
        const F = firstKeys(lead), bw = band.right - band.left, bh = band.bottom - band.top;
        assert.ok(F.length >= 2, what + ': what matters (' + F + ')');
        // per side the rig does not fit at READ_K: the longest head of what matters (in its order) that fits there
        const X = [Math.min(...R.map(r => r.x)), Math.max(...R.map(r => r.x + r.w))], Y = [Math.min(...R.map(r => r.y)), Math.max(...R.map(r => r.y + r.h))];
        const side = (lo, hi, v, E) => {
          if ((E[1] - E[0]) * READ_K <= v - 2 * FIT_PAD) return { n: F.length, fits: true };
          for (let n = F.length; n >= 1; n--) { const a = Math.min(...F.slice(0, n).map(lo)), b = Math.max(...F.slice(0, n).map(hi)); if ((b - a) * READ_K <= v + 1e-6) return { n, a, b }; }
          return { n: 0 };
        };
        const sx = side(q => box(q).x, q => box(q).x + box(q).w, bw, X), sy = side(q => box(q).y, q => box(q).y + box(q).h, bh, Y), n = Math.min(sx.n, sy.n);
        for (const q of F.slice(0, n)) assert.ok(seen(q, band) >= 0.99, what + ': what matters whole, in its order (' + F.slice(0, n) + ') — ' + q + ' ' + seen(q, band).toFixed(2));
        if (n < F.length) met.dropped++;
        if (!n) { met.start++; const p = W0.w.toClient(box(F[0]).x, box(F[0]).y); assert.ok(p.x >= band.left - 0.5 && p.x < band.right && p.y >= band.top - 0.5 && p.y < band.bottom, what + ': ' + F[0] + '\'s top-left in view (' + Math.round(p.x) + ', ' + Math.round(p.y) + ')'); }
        // on each side the rig does not fit: no blank band where it goes on (its edges at the band's pad or past them); the head centred
        // unless that would open one (then slid back to the rig's edge) — the head BOTH sides hold (tightened after its third check: a split
        // view held Envelope 1 down the band while only the chain's start fitted across — the start pushed to the band's foot under blank
        // canvas), the first one alone where neither holds a head but this side holds it
        const sc = (c, u) => (c === 'x' ? W0.w.toClient(u, 0).x : W0.w.toClient(0, u).y);
        for (const [S, E, c, B0, B1, lo, hi] of [[sx, X, 'x', band.left, band.right, q => box(q).x, q => box(q).x + box(q).w], [sy, Y, 'y', band.top, band.bottom, q => box(q).y, q => box(q).y + box(q).h]]) {
          if (S.fits) continue;
          const e0 = sc(c, E[0]), e1 = sc(c, E[1]), h = n || (S.n ? 1 : 0), ha = h ? Math.min(...F.slice(0, h).map(lo)) : 0, hb = h ? Math.max(...F.slice(0, h).map(hi)) : 0;
          assert.ok(e0 <= B0 + FIT_PAD + 0.5 && e1 >= B1 - FIT_PAD - 0.5, what + ': no blank band where the rig goes on (' + c + ': ' + Math.round(e0) + ' … ' + Math.round(e1) + ' in ' + B0 + ' … ' + B1 + ')');
          if (h && (hb - ha) * READ_K <= B1 - B0 - 2 * FIT_PAD) {
            const m = (sc(c, ha) + sc(c, hb)) / 2;
            assert.ok(Math.abs(m - (B0 + B1) / 2) < 0.5 || Math.abs(e0 - B0 - FIT_PAD) < 0.5 || Math.abs(e1 - B1 + FIT_PAD) < 0.5, what + ': what matters centred, or slid back to the rig\'s edge (' + c + ': its middle ' + Math.round(m) + ', the band\'s ' + (B0 + B1) / 2 + ')');
          }
        }
      }
    } finally { W0.w.fit = fit0; C.done(); }
  };
  for (const band of [TRAY_BAND, PORTRAIT_BAND, ...KB_BANDS]) {
    const B = band === TRAY_BAND ? '' : band === PORTRAIT_BAND ? ' (upright)' : ' (the keyboard up, ' + (band.right - band.left) + ' × ' + (band.bottom - band.top) + ')';
    await fresh('juno60');
    await check('the ' + RIG.NAME + ' tile on a Juno' + B, () => sh.srcPick(RIG.ID, 'replace'), band);
    await check('a new track from the tray' + B, () => sh.srcPick(RIG.ID, 'track'), band);
    const rt = T().id;
    await fresh('juno60');
    await check('a rig track never moved, switched back to' + B, () => api.selectTrack(rt), band);
    await fresh('serum');
    await check('Make it a ' + RIG.NAME + B, () => RG.convert(), band);
    await fresh('juno60');
    await check('an Oscillator tile\'s Replace' + B, () => RG.drop('osc'), band, false, 'i1/oscA');
    // a rig grown with two LFOs (no target yet: the band's left end, left of the chain) — its left edge first would leave the Amplifier out
    await fresh(RIG.ID);
    for (let i = 0; i < 2; i++) { RG.add(null, 'lfo'); await settle(2); }
    rigGeometry(); await settle(2);
    const gt = T().id;
    await fresh('juno60');
    await check('a rig with two LFOs at the band\'s left end, switched back to' + B, () => api.selectTrack(gt), band);
  }
  assert.ok(met.whole > 0 && met.floor > 0 && met.dropped > 0 && met.start > 0, 'the four cases met: ' + JSON.stringify(met));
  await fresh('juno60');
  await check('a press while the faces mount', () => sh.srcPick(RIG.ID, 'replace'), TRAY_BAND, 'after');
  // a finger already down on the canvas when the request comes (a slow device: a track switch builds its canvas after the press that
  // follows it) — no fit while it is held; lifted (the window's pointerup), the next one frames again
  await fresh('juno60');
  await check('a finger held on the canvas', () => sh.srcPick(RIG.ID, 'replace'), TRAY_BAND, 'held');
  await fresh('juno60');
  await check('the finger lifted: framed again', () => sh.srcPick(RIG.ID, 'replace'));
});

test('integration fixer L, review WC-int B4: the tray\'s "+ Add a track…" mode — a module tile makes a NEW track holding a <NAME> that starts from that module (the Minimoog track untouched, one step, the tray back to replacing); the tiles are greyed for that new track (none), not for the current one; a module tile dropped on the track list makes one too', async () => {
  const tiles = sh.shell.tiles, tap = id => tiles.partTile(id).dispatchEvent({ type: 'click', defaultPrevented: false, stopPropagation() {}, preventDefault() {} }); // (the tray's own click listener)
  await fresh('minimoog');
  const t0 = T(), s0 = snap(t0), n0 = P().tracks.length, u0 = cv.hist.u.at(-1);
  sh.cvOpenSources('track');
  assert.equal(tiles.mode(), 'track');
  tap('osc'); await settle(3);
  assert.equal(P().tracks.length, n0 + 1, 'a new track');
  assert.notEqual(T().id, t0.id, 'the new track selected');
  assert.deepEqual([I().model, keys(), ends(), T().name], [RIG.ID, 'i1,i1/fx,i1/oscA,out', 'oscA.out>voice.main', RIG.NAME + ' ' + P().tracks.length]);
  assert.equal(snap(t0), s0, 'the Minimoog untouched');
  assert.equal(since(u0), 1, 'one step');
  assert.equal(tiles.mode(), 'replace', 'the tray back to replacing');
  cv.undo(); await settle(3);
  assert.equal(P().tracks.length, n0, '↶: the new track gone');
  // greyed by the track a tap would change: a rig with Macros on the canvas greys Macros while a tap adds to it, not while a tap makes a new track
  await fresh(RIG.ID);
  RG.add(null, 'macros'); await settle(2);
  sh.cvOpenSources('replace');
  assert.equal(tiles.partPlaced('macros'), 'Macros is on the canvas');
  sh.cvOpenSources('track');
  assert.deepEqual(['osc', 'sub', 'noise', 'filter', 'env', 'lfo', 'macros'].map(k => tiles.partPlaced(k)), [null, null, null, null, null, null, null], 'a new track: every tile live');
  const n1 = P().tracks.length, rigT = T().id;
  tap('macros'); await settle(3);
  assert.deepEqual([P().tracks.length, keys()], [n1 + 1, 'i1,i1/fx,i1/macros,out'], 'Macros starts a new ' + RIG.NAME);
  sh.cvOpenSources('replace');
  // a tile dropped on the track list (the tray's drag over the track list: info.over 'tracks')
  const n2 = P().tracks.length;
  assert.equal(cv.parts.drag.drop('filter', { over: 'tracks', x: 200, y: 20 }), true, 'taken');
  await settle(3);
  assert.deepEqual([P().tracks.length, I().model, keys()], [n2 + 1, RIG.ID, 'i1,i1/filter,i1/fx,out'], 'the track list: a new track');
  assert.ok(P().tracks.some(t => t.id === rigT), 'the rig track still there');
});

test('integration fixer L, review WC-int P3-3: the Envelope 1 → LEVEL cord hangs beside the Amplifier — its settled rope (cv-cords\' own) never over the Amplifier\'s bar (its ▾ fold, its ⋯) nor its face above the jack row: the starter, after Tidy, an Envelope tapped onto the gate (rigSpot); rig-ui\'s OUT / LEVEL cells sit cv-module\'s RIG_JACK in from their faces\' right edges', async () => {
  for (const [kind, part, port] of [['env', 'env1', 'out'], ['env', 'env2', 'out'], ['amp', 'voice', 'level']]) {
    const L = RU.layoutOf(RU.FACE[RU.variantOf(kind, { k: part === 'env1' ? 0 : 1 })]), w = RU.sizeOf(kind, part).w;
    let cx = null;
    for (const r of L.rows) for (const c of r.cells || []) if (c.jack && c.jack.port === port) cx = c.cx;
    assert.equal(w - cx, CVM.RIG_JACK, kind + ' ' + port);
  }
  const over = what => {
    const c = (REC.list || []).find(x => /env1\.out$/.test(x.a) && /level/.test(x.b));
    assert.ok(c, what + ': the cord');
    const A = REC.at.get(c.a), B = REC.at.get(c.b), a = box('i1'), at = settled(A, B), bad = [];
    for (let i = 0; i <= 80; i++) { const p = at(i / 80); if (p && p.x > a.x && p.x < a.x + a.w && p.y > a.y && p.y < B.y - 24) bad.push(Math.round(p.x - a.x) + ',' + Math.round(p.y - a.y)); }
    assert.equal(bad.join(' '), '', what + ': the rope over the Amplifier (its own px)');
  };
  await fresh(RIG.ID); rigGeometry(); await settle(3);
  over('the starter');
  cv.tidy(); await settle(3); rigGeometry(); await settle(3);
  over('after Tidy');
  await fresh('juno60'); await tile('osc'); rigGeometry(); await settle(2);
  RG.drop('env'); rigGeometry(); await settle(3);
  over('an Envelope tapped onto the gate');
});

test('integration fixer L, review WC-int P3-5: Tidy on a rig frames the whole rig once laid (OUT too: Tidy\'s row holds it) and says "Canvas tidied · tap to undo" — the tap undoes it; already tidy: no step, no notice, framed all the same', async () => {
  const FULL = { left: 44, top: 48, right: 1520, bottom: 900 };
  await fresh(RIG.ID);
  RG.add(null, 'lfo'); RG.add(null, 'osc'); rigGeometry(); await settle(2); // (Oscillator 2 under Oscillator 1: no room in the row — Tidy puts it there)
  const C = camera(FULL);
  try {
    C.set({ tx: -2400, ty: 900, k: 1 });
    const u0 = cv.hist.u.at(-1), lay0 = JSON.stringify(T().lay);
    cv.tidy(); rigGeometry(); await settle(3);
    assert.deepEqual([since(u0), cv.hist.u.at(-1).label, note()], [1, 'Tidy', 'Canvas tidied · tap to undo']);
    for (const k of V().modules.keys()) assert.ok(seen(k, FULL) >= 0.9, k + ' in view ' + seen(k, FULL).toFixed(2));
    sim.$('#notice').onclick(); await settle(3);
    assert.deepEqual([since(u0), JSON.stringify(T().lay) === lay0], [0, true], 'its tap undoes Tidy');
    cv.tidy(); rigGeometry(); await settle(3);
    const lay = JSON.stringify(T().lay);
    C.set({ tx: -2400, ty: 900, k: 1 });
    sim.$('#notice').textContent = '';
    cv.tidy(); rigGeometry(); await settle(3);
    assert.deepEqual([since(u0), sim.$('#notice').textContent, JSON.stringify(T().lay) === lay], [1, '', true], 'already tidy: no step, no notice');
    for (const k of V().modules.keys()) assert.ok(seen(k, FULL) >= 0.9, 'already tidy: ' + k + ' in view');
  } finally { C.done(); }
});

// an SVG path's points (M / L / C, as cv-cables writes them), 24 per segment
const pathPts = d => {
  const T = String(d || '').match(/[MLC]|-?\d+(?:\.\d+)?/g) || [], P = [];
  let i = 0, cur = null, cmd = null;
  const n = () => +T[i++];
  while (i < T.length) {
    if (/[MLC]/.test(T[i])) cmd = T[i++];
    if (cmd === 'M') { cur = { x: n(), y: n() }; P.push(cur); continue; }
    const c = cmd === 'C' ? [{ x: n(), y: n() }, { x: n(), y: n() }] : null, q = { x: n(), y: n() };
    for (let s = 1; s <= 24; s++) { const t = s / 24, u = 1 - t; P.push(c ? { x: u * u * u * cur.x + 3 * u * u * t * c[0].x + 3 * u * t * t * c[1].x + t * t * t * q.x, y: u * u * u * cur.y + 3 * u * u * t * c[0].y + 3 * u * t * t * c[1].y + t * t * t * q.y } : { x: cur.x + (q.x - cur.x) * t, y: cur.y + (q.y - cur.y) * t }); }
    cur = q;
  }
  return P;
};
// a line's drawn path (the newest layer's: the stub DOM keeps an old view's)
const lineD = id => { const g = kidsOf(W0.w.el, c => c.getAttribute('data-cable') === id).at(-1), p = g && kidsOf(g, c => clsOf(c).includes(' cv-cable '))[0]; return p ? p.getAttribute('d') : null; };
test('integration fixer L, review WC-int P3-11 (reworked after its check, 2026-10-26: the upright wrap keeps its width) — Tidy on an upright canvas wraps the chain after the Amplifier with its FX row UNDER the Amplifier (the Amplifier\'s width and a GAP saved against one row, as review 2 laid it) and the drawn Amplifier → Effects line goes ROUND the Amplifier: out of its OUT rightward, down beside it, along the gap between the rows, into the FX panel\'s IN from the left — no sample inside the Amplifier, the FX panel (its IN\'s end excepted) or any other module, 3 px in; landscape: one row, the plain line', async () => {
  await fresh(RIG.ID); rigGeometry(); await settle(3);
  const C = camera(PORTRAIT_BAND);
  try {
    cv.tidy(); await settle(3); rigGeometry(); await settle(3);
    const a = box('i1'), f = box('i1/fx'), o = box('i1/oscA');
    assert.ok(f.y >= a.y + a.h + cvModVGAP, 'the FX row under the chain');
    assert.equal(f.x, a.x, 'the FX panel under the Amplifier: the wrap keeps its width');
    const d = lineD('i1.out>i1/fx.in'), P = pathPts(d);
    assert.ok(P.length > 30, 'the line drawn: ' + d);
    const A = P[0], B = P.at(-1), inn = (p, r, m = 3) => p.x > r.x + m && p.x < r.x + r.w - m && p.y > r.y + m && p.y < r.y + r.h - m;
    assert.ok(Math.abs(A.x - (a.x + a.w)) < 1 && Math.abs(B.x - f.x) < 1 && B.y > f.y, 'from the Amplifier\'s OUT to the FX panel\'s IN');
    assert.ok(P[1].x > A.x && P.at(-2).x < B.x, 'out rightward, in from the left');
    assert.ok(Math.abs(Math.max(...P.map(p => p.x)) - (a.x + a.w + 2 * CVM.RIG_AMP_AIR)) < 0.5, 'its run down 2 × RIG_AMP_AIR beside the Amplifier: beyond Envelope 1\'s cord (RIG_AMP_AIR beside it, P3-3)');
    const bad = [];
    for (const [k, m] of V().modules) { const r = box(k); for (const p of P) if (inn(p, r) && !(k === 'i1/fx' && Math.hypot(p.x - B.x, p.y - B.y) < 8)) { bad.push(k + ' ' + Math.round(p.x) + ',' + Math.round(p.y)); break; } }
    assert.equal(bad.join(' | '), '', 'the line inside a module');
    assert.ok(Math.max(...P.map(p => p.y)) <= B.y + 0.5 && Math.min(...P.map(p => p.x)) < f.x && Math.min(...P.map(p => p.x)) > o.x + o.w, 'it never dips under its IN, and turns in the gap left of the FX panel');
  } finally { C.done(); }
  cv.tidy(); await settle(3); rigGeometry(); await settle(3);
  const a = box('i1'), f = box('i1/fx'), d = lineD('i1.out>i1/fx.in');
  assert.ok(f.y === a.y && f.x > a.x + a.w, 'landscape: one row');
  assert.match(d, /^M [\d.]+ [\d.]+ C [^C]+$/, 'the plain line (one cubic)');
});

test('integration fixer L, review WC-int P3-11 (after its second check, 2026-10-26: the FX row under the Amplifier must not cost Envelope 1 its place) — upright, a modulator driving a knob on the Effects panel (an LFO on Reverb MIX, Macros on Delay MIX — the check\'s two) stands right of the Amplifier\'s slot after Tidy, so Envelope 1 keeps its P3-3 place: its settled rope (cv-cords\' own) never over the Amplifier\'s bar nor its face above the jack row, and the FX modulator\'s line (the stub draws it, no rope) never inside the Amplifier; landscape as before (Envelope 1 beside the Amplifier there too)', async () => {
  for (const [src, kind, dst] of [['i1/lfo1.out', 'lfo', 'fx.rev.mix'], ['i1/macros.k1', 'macros', 'fx.dly.mix']]) {
    await fresh(RIG.ID); rigGeometry(); await settle(3);
    assert.ok(cv.fx.addEffect('i1/fx', 'rev') !== false && cv.fx.addEffect('i1/fx', 'dly') !== false, 'Reverb and Delay on the Effects panel');
    await settle(3);
    RG.add(null, kind); await settle(3);
    const id = cv.mod.connect(src, 'i1:' + dst); await settle(3);
    assert.match(String(id), /^o:i1:\d+$/, kind + ' → ' + dst);
    for (const band of [PORTRAIT_BAND, TRAY_BAND]) {
      const C = camera(band), B = band === PORTRAIT_BAND ? ' (upright)' : ' (landscape)';
      try {
        cv.tidy(); await settle(3); rigGeometry(); await settle(3);
        const a = box('i1'), f = box('i1/fx'), e = box('i1/env1'), m = box(src.slice(0, src.lastIndexOf('.')));
        if (band === PORTRAIT_BAND) assert.ok(f.y > a.y + a.h && f.x === a.x, kind + B + ': the FX row under the Amplifier');
        assert.equal(e.x + e.w - CVM.RIG_JACK, a.x + a.w + CVM.RIG_AMP_AIR, kind + B + ': Envelope 1\'s OUT beside the Amplifier');
        if (band === PORTRAIT_BAND) assert.ok(m.x >= a.x + a.w + 2 * CVM.RIG_AMP_AIR && m.x >= e.x + e.w + cvModVGAP, kind + B + ': right of the Amplifier\'s slot (' + m.x + ')');
        const c = (REC.list || []).find(x => /env1\.out$/.test(x.a) && /level/.test(x.b));
        assert.ok(c, kind + B + ': the Envelope 1 cord');
        const A = REC.at.get(c.a), Bq = REC.at.get(c.b), at = settled(A, Bq), bad = [];
        for (let i = 0; i <= 80; i++) { const p = at(i / 80); if (p && p.x > a.x && p.x < a.x + a.w && p.y > a.y && p.y < Bq.y - 24) bad.push(Math.round(p.x - a.x) + ',' + Math.round(p.y - a.y)); }
        assert.equal(bad.join(' '), '', kind + B + ': Envelope 1\'s rope over the Amplifier (its own px)');
        if (band === PORTRAIT_BAND) {
          const d = kidsOf(W0.w.el, g => /^o:i1:/.test(g.getAttribute('data-cable') || '')).map(g => kidsOf(g, q => clsOf(q).includes(' cv-cable '))[0]).filter(Boolean).map(q => q.getAttribute('d')).filter(Boolean);
          for (const q of d) { const P = pathPts(q); assert.equal(P.filter(p => p.x > a.x + 3 && p.x < a.x + a.w - 3 && p.y > a.y + 3 && p.y < a.y + a.h - 3).length, 0, kind + B + ': the modulator\'s line inside the Amplifier: ' + q); }
        }
      } finally { C.done(); }
    }
  }
});

test('integration fixer L, review WC-int P3-8: the tray\'s words in the <NAME> view — on a <NAME> track a module tile ADDS (never "in place of the <NAME>") and the <NAME> tile loads its starter; on another instrument a tile replaces it with a <NAME> holding that module; the Note tools section in our own words, through RIG.NAME (no "cut")', async () => {
  const tiles = sh.shell.tiles, v0 = tiles.view(), txt = () => sim.$('#srcMode').children.map(c => c.textContent || '').join(''); // (the stub's append keeps nodes only: text nodes, as the Moog view's)
  try {
    tiles.setView(RIG.VIEW);
    await fresh(RIG.ID);
    sh.cvOpenSources('replace');
    assert.equal(txt(), `Tap a module to add it to “${T().name}”, plugged in, or drag it where you want it. ${RIG.NAME} loads the starter rig (tap to undo). Drag a tile onto the track list for a new track.`);
    assert.ok(!/in place of/.test(txt()));
    await fresh('juno60');
    sh.cvOpenSources('replace');
    assert.equal(txt(), `Tap a module to replace the Juno-60 on “${T().name}” with a ${RIG.NAME} holding it, or ${RIG.NAME} for a starter rig that plays — or drag one onto the canvas. Drag a tile onto the track list for a new track.`);
    sh.cvOpenSources('track');
    assert.match(txt(), /a new track/);
    sh.cvOpenSources('replace');
  } finally { tiles.setView(v0); }
  const S = TRAY.SRC_VIEWS.find(v => v.id === RIG.VIEW).sections.find(s => s.id === 'rignotes');
  assert.equal(S.note, `The ${RIG.NAME}’s Arpeggiator and Clip sequencer arrive in a later update.`);
  assert.ok(!/\bcut\b/i.test(S.note));
});

test('integration fixer L, review WC-int P3-18: the merge\'s leftovers — a rig\'s own row pulled by its cord (cv-cables onPull) says "Cord pulled · tap to undo" ONCE (one write of the notice, one step, its tap undoes it); ONE knob-disc measure (tightened after its checks: wk.discBox — the control\'s .wk-svg child inside the control\'s box — main.js, cv-module.js and cv-cables.js call it and measure no disc of their own) and its callers agree: the cord\'s rim and badge (cv-module\'s knob end), the segmented ring (main) on the same disc centre and size, the same "no disc" (the control) for a disc spilling out of it (cv-cables\' aim: its own test); rigRecords keeps no records it never reads', async () => {
  await fresh(RIG.ID);
  RG.add(null, 'lfo'); await settle(2);
  const id = cv.mod.connect('i1/lfo1.out', 'i1:f.cutoff'); await settle(3);
  assert.match(String(id), /^o:i1:\d+$/);
  const n = sim.$('#notice'), writes = [], d0 = Object.getOwnPropertyDescriptor(n, 'textContent');
  let tc = n.textContent;
  Object.defineProperty(n, 'textContent', { get: () => tc, set: v => { tc = v == null ? '' : String(v); writes.push(tc); }, configurable: true });
  const u0 = cv.hist.u.at(-1), s0 = JSON.stringify(S());
  try { cv.mod.opts.onPull(id); await settle(2); } finally { if (d0) Object.defineProperty(n, 'textContent', d0); else delete n.textContent; n.textContent = tc; }
  assert.deepEqual([since(u0), writes.filter(w => /^Cord pulled/.test(w))], [1, ['Cord pulled · tap to undo']], 'one step, one notice');
  n.onclick(); await settle(3);
  assert.equal(JSON.stringify(S()), s0, 'its tap undoes the pull');
  // one knob-disc finder: the kit's
  const doc = globalThis.document, el = doc.createElement('div'), lab = doc.createElement('span'), sv = doc.createElement('div');
  sv.setAttribute('class', 'wk-svg'); el.append(lab, sv);
  assert.equal(typeof WK.discOf, 'function', 'wk exports discOf');
  assert.ok(WK.discOf(el) === sv && WK.discOf(lab) === null, 'the control\'s direct .wk-svg child, else null');
  const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  for (const f of ['main.js', 'cv-module.js', 'cv-cables.js']) assert.equal((src(f).match(/wk-svg/g) || []).length, 0, f + ': no finder of its own'); // ((tightened after its check) cv-cables\' discEl too
  assert.ok(!/rigArgs\s*=\s*\{/.test(src('main.js')), 'no dead records kept');
  // (tightened after its second check) one MEASURE: wk.discBox — the disc's box when it lies inside the control's (±0.5 px), else null
  assert.equal(typeof WK.discBox, 'function', 'wk exports discBox');
  const R0 = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t });
  el.getBoundingClientRect = () => R0(100, 100, 48, 64); sv.getBoundingClientRect = () => R0(106, 102, 36, 36);
  assert.deepEqual(WK.discBox(el), R0(106, 102, 36, 36), 'inside: its box');
  sv.getBoundingClientRect = () => R0(80, 102, 36, 36);
  assert.equal(WK.discBox(el), null, 'spilling out of the control: none (the control stands for it)');
  sv.getBoundingClientRect = () => R0(106, 102, 0, 0);
  assert.equal(WK.discBox(el), null, 'no size: none');
  for (const f of ['main.js', 'cv-module.js', 'cv-cables.js']) { const s = src(f); assert.ok(/(wk\.discBox|wkDiscBox)\(/.test(s) && !/\bdiscOf\b|wkDiscOf/.test(s.replace(/\/\/.*$/gm, '')), f + ': the one measure (discBox), no disc found or measured its own way'); }
  // its callers agree on a real knob (the kit's: a disc over its label): two cords onto Filter 1's LEVEL, two onto its Y (its disc spilling
  // out of the control); the stub's styles record the ring's custom properties
  await tile('macros');
  const KN = { 'i1/filter': [['f.level', 60, 240], ['f.y', 160, 240]] }, fm = V().modules.get('i1/filter'), lev = destEl('i1/filter', 'f.level'), fy = destEl('i1/filter', 'f.y');
  const style = () => ({ setProperty(k, v) { this[k] = String(v); }, getPropertyValue(k) { return this[k] || ''; }, removeProperty(k) { delete this[k]; } });
  lev.style = style(); fy.style = style();
  geometry(520, KN);
  const at = (e, x, y, w, h) => { e.getBoundingClientRect = () => crect(fm.x + x, fm.y + y, w, h); e.offsetWidth = w; e.offsetHeight = h; }; // (k 1: its CSS size its screen size)
  at(lev, 60, 240, 48, 64); at(WK.discOf(lev), 66, 242, 36, 36); // (the disc over the label: its centre 84, 260 — not the control's 84, 272)
  at(fy, 160, 240, 48, 64); at(WK.discOf(fy), 140, 242, 36, 36); // (spilling 20 px out of the control's left)
  const ids = [['i1/lfo1.out', 'f.level'], ['i1/macros.k1', 'f.level'], ['i1/lfo1.out', 'f.y'], ['i1/macros.k2', 'f.y']].map(([a, b]) => cv.mod.connect(a, 'i1:' + b));
  await settle(3);
  cv.render(); V().remeasure(); await settle(3);
  const K = V().ports().get('i1:f.level'), KY = V().ports().get('i1:f.y');
  assert.deepEqual([K.kx, K.ky, K.kr], [fm.x + 84, fm.y + 260, 18], 'the cord\'s rim and badge (cv-module): the disc\'s centre and radius');
  assert.deepEqual([lev.hasAttribute('data-rig-ring'), lev.style.getPropertyValue('--rig-rx'), lev.style.getPropertyValue('--rig-ry'), lev.style.getPropertyValue('--rig-rd')], [true, '24px', '20px', '36px'], 'the ring (main): the same disc, in the control');
  // ((WC-1 merge fixer, L × K) every drawn end a point: the LFO's OUT holds two cords (fixer K's fan) and this stub never measures its jack
  // (the default box: off the LFO's face) — a fan off its face's walls is centred on its jack (rigPack), never NaN: its plugs are the
  // sources the knob ends below are aimed from
  for (const c of REC.list || []) for (const e of ['a', 'b']) { const p = REC.at.get(c[e]); if (p) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), c.id + ' ' + c[e] + ': a point (' + JSON.stringify(p) + ')'); }
  for (const id of ids.slice(0, 2)) { const E = REC.at.get('knob:' + id); assert.ok(E && Math.abs(Math.hypot(E.x - K.kx, E.y - K.ky) - 18) < 1e-6, id + ': its end on the same disc\'s rim (' + JSON.stringify(E) + ')'); }
  assert.deepEqual([KY.kx, KY.kr, fy.hasAttribute('data-rig-ring'), fy.style.getPropertyValue('--rig-rx')], [undefined, undefined, false, ''], 'a disc spilling out: no disc for the rim nor the ring — the control stands for both');
});

/* ---- (WC, integration fixer K; the go / no-go review: B5, P2-1, P2-2, P2-3, P3-6, P3-12) */
const jackEl = id => (V().jacks().find(x => x.id === id) || {}).el || null;
// the rope as the GL layer draws it once settled: the Studio steps (settled's), cut at its knob's rim (cv-cords clip) when it ends on one
const drawn = (A, B, O) => {
  const r = makeRope(STUDIO.N), P = new Float64Array(2 * (2 + (STUDIO.N - 2) * STUDIO.SUB));
  seed(r, A.x, A.y, B.x, B.y, true);
  for (let i = 0; i < 1200; i++) step(r, A.x, A.y, B.x, B.y, STUDIO.DT);
  let m = smooth(r.X, r.Y, r.n, STUDIO.SUB, P);
  if (O) m = clip(P, m, O.x, O.y, O.r) + 1;
  return u => along(P, m, u);
};
const stackAt = jack => (REC.list || []).filter(c => c.a === jack || c.b === jack);
// the user, 2026-10-26 (canvas 050ea9f): "in cases like this all cables should overlap at the outlet" (an LFO's OUT with two cords fanned side by
// side) and "overlap everywhere" — fixer K's fan (B5's plug press, P3-6's row) retired by design
test('(the user, 2026-10-26: "all cables should overlap at the outlet", "overlap everywhere") STACKED PLUGS — every jack holding several cords, outputs and Σ inputs alike, has their plugs on its one socket like stackable patch cables: Oscillator 1 and the auto-plugged Oscillator 2 at the Filter\'s IN Σ, an LFO\'s OUT with two cords, then three — each record\'s end the jack itself (no "<jack>#<i>" fan), its anchor the jack\'s centre, the cables diverging from there; the newest on top (the last of the jack\'s cords in the layer\'s list: drawn last) — Oscillator 1 pulled and plugged again comes on top; a press on a stacked INPUT grabs that top cord (jackAt names it), on a stacked OUTPUT names none (a new cord); a single cord\'s jack names none', async () => {
  await fresh(RIG.ID);
  RG.add(null, 'osc'); await settle(2);
  RG.add(null, 'lfo'); await settle(2);
  rigGeometry(); await settle(2);
  const lfo = ['f.cutoff', 'f.level'].map(d => cv.mod.connect('i1/lfo1.out', 'i1:' + d)); await settle(3);
  rigGeometry(); await settle(2);
  const J = cv.mod.opts.jackAt, P = () => V().ports();
  const check = (jack, n, top, what) => {
    for (const c of REC.list) for (const e of ['a', 'b']) assert.ok(!/#\d+$/.test(String(c[e])), what + ': ' + c.id + ' ' + c[e] + ' — the jack itself, no fan');
    const L = stackAt(jack), Q = P().get(jack);
    assert.equal(L.length, n, what + ': ' + n + ' cords at ' + jack);
    for (const c of L) { const p = REC.at.get(jack); assert.deepEqual([p && p.x, p && p.y], [Q.x, Q.y], what + ': ' + c.id + ' on the socket'); }
    assert.equal(L[L.length - 1].id, top, what + ': the newest on top (drawn last)');
    return J(jackEl(jack), { x: Q.x + 3, y: Q.y - 2 }, 1);
  };
  const oscA = rigRec('oscA.out', 'filter.in').id, oscB = rigRec('oscB.out', 'filter.in').id;
  let r = check('i1/filter.in', 2, oscB, 'the Filter\'s IN Σ');
  assert.deepEqual([!!r && r.el === jackEl('i1/filter.in'), r && r.rec], [true, oscB], 'a press on the stacked input: its top cord');
  r = check('i1/lfo1.out', 2, lfo[1], 'the LFO\'s OUT');
  assert.deepEqual([!!r && r.el === jackEl('i1/lfo1.out'), r && r.rec], [true, null], 'a press on the stacked output: none named (a new cord)');
  const third = cv.mod.connect('i1/lfo1.out', 'i1:f.res'); await settle(3);
  rigGeometry(); await settle(2);
  check('i1/lfo1.out', 3, third, 'three on the LFO\'s OUT');
  cv.mod.opts.onPull(oscA); await settle(3);
  RG.plug(null, 'oscA.out', 'filter.in'); await settle(3);
  rigGeometry(); await settle(2);
  r = check('i1/filter.in', 2, oscA, 'Oscillator 1 plugged again');
  assert.equal(r && r.rec, oscA, 'a press grabs it');
  const M = P().get('i1.main'), r1 = J(jackEl('i1.main'), { x: M.x + 2, y: M.y }, 1);
  assert.deepEqual([!!r1 && r1.el === jackEl('i1.main'), r1 && r1.rec], [true, null], 'one cord at the Amplifier\'s IN: the jack, no record named');
});

test('(fixer K; review P2-3) at Fit zoom on the iPad (k 0.28) a press near a Wavecraft jack goes to the nearest jack centre within max(22 screen px, half the spacing): on the Amplifier\'s IN element but nearest DIRECT → DIRECT; nearest IN → IN; past 22 screen px of every jack → null (the press keeps its element); at 100 % half the spacing (32 world px) reaches', async () => {
  const W = W0.w, J = cv.mod.opts.jackAt, P = V().ports(), IN = P.get('i1.main'), DI = P.get('i1.direct'), inEl = jackEl('i1.main'), diEl = jackEl('i1.direct');
  W.setCamera({ tx: 0, ty: 0, k: 0.28 }); await settle(1);
  const a = J(inEl, { x: DI.x - 12, y: DI.y + 24 }, 0.28), b = J(inEl, { x: IN.x + 20, y: IN.y - 30 }, 0.28), c = J(inEl, { x: IN.x, y: IN.y + 24 / 0.28 }, 0.28);
  assert.deepEqual([!!a && a.el === diEl, !!b && b.el === inEl, c], [true, true, null], 'the nearest centre within 22 screen px (' + (22 / 0.28).toFixed(0) + ' world px)');
  W.setCamera({ tx: 0, ty: 0, k: 1 }); await settle(1);
  const d = J(inEl, { x: IN.x + 30, y: IN.y }, 1), e = J(inEl, { x: IN.x + 34, y: IN.y }, 1), f = J(inEl, { x: IN.x, y: IN.y + 33 }, 1);
  assert.deepEqual([!!d && d.el === inEl, !!e && e.el === diEl, f], [true, true, null], 'at 100 %: half the spacing');
});

test('(fixer K; review P2-3, its skeptics) the world\'s near hook (setJackNear → the host\'s rigNearJack): a press on no jack goes to the nearest rig jack within max(22 screen px, half the column) — on the empty canvas past a face\'s edge too (a face clips its jacks\' own circles: right of a right-hand OUT, below a jack row) and anywhere on a sleeping face; on an awake face only where no control is (a knob, a switch, a button, the bar keep theirs); another module\'s body (the FX panel) keeps its own; lines mode the same', async () => {
  const N = W0.w.jackNear;
  assert.equal(typeof N, 'function', 'the host registered its near hook');
  const P = V().ports(), k = 0.29, r = 22 / k, O = P.get('i1/oscA.out'), A = box('i1/oscA');
  const free = { closest: () => null }, ctl = { closest: () => ({}) }, at = (p, kk, t, o) => { const el = N(p, kk, t, o); return el ? el.getAttribute('data-cv-jack') : null; };
  const CAN = { empty: true, sleep: false, mod: null };
  const right = { x: A.x + A.w + 12, y: O.y }, below = { x: O.x, y: O.y + 70 }, far = { x: O.x + r + 4, y: O.y };
  assert.ok(right.x - O.x < r && below.y - O.y < r && right.x > A.x + A.w, 'the probes: past the face\'s edge, within 22 screen px (' + r.toFixed(0) + ' world px)');
  assert.deepEqual([at(right, k, free, CAN), at(below, k, free, CAN), at(far, k, free, CAN)], ['i1/oscA.out', 'i1/oscA.out', null], 'the empty canvas right of / below Oscillator 1\'s OUT; past 22 screen px: nothing');
  assert.equal(at(below, k, ctl, { empty: false, sleep: true, mod: 'i1/oscA' }), 'i1/oscA.out', 'a sleeping face: all of it (its controls sleep)');
  const DI = P.get('i1.direct'), NO = P.get('i1.note'), mid = f => ({ x: DI.x + f * (NO.x - DI.x), y: DI.y + 6 }), AMP = { empty: false, sleep: true, mod: 'i1' };
  assert.deepEqual([at(mid(0.45), k, free, AMP), at(mid(0.55), k, free, AMP)], ['i1.direct', 'i1.note'], 'between two jacks: the nearer centre');
  // awake (k 0.55): a control keeps its press; the face where no control is (the gap above the jack row, a label) → the jack
  const up = { x: O.x, y: O.y - 26 }, AW = { empty: false, sleep: false, mod: 'i1/oscA' };
  assert.deepEqual([at(up, 0.55, ctl, AW), at(up, 0.55, free, AW)], [null, 'i1/oscA.out'], 'awake: a control\'s press its own; the gap above the jack row the jack\'s');
  assert.deepEqual([at({ x: O.x, y: O.y + 30 }, 1, free, AW), at({ x: O.x, y: O.y + 34 }, 1, free, AW)], ['i1/oscA.out', null], 'at 100 %: half the column (32 world px)');
  const L = P.get('i1.level');
  assert.equal(at({ x: L.x + 20, y: L.y }, k, free, { empty: false, sleep: true, mod: 'i1/fx' }), null, 'another module\'s body (the FX panel): its own');
  RG.wires('lines'); await settle(3);
  try { // (lines mode: the anchors as measured — the sim's boxes, not the grid's: the probes from them)
    const Q = V().ports(), NT = Q.get('i1.note'), EN = Q.get('i1/env1.out');
    assert.deepEqual([at({ x: NT.x, y: NT.y + 60 }, k, free, CAN), at({ x: EN.x + 60, y: EN.y }, k, free, CAN), at({ x: EN.x + 60, y: EN.y }, k, ctl, { empty: false, sleep: false, mod: 'i1/env1' })], ['i1.note', 'i1/env1.out', null], 'lines mode: the same rule');
  } finally {
    RG.wires('cords'); await settle(3);
  }
});

test('(the user\'s stacked plugs, 2026-10-26; fixer K\'s P3-6 fan retired) S3\'s Filter 1 IN (four cords) and the Amplifier\'s IN (three) stack every plug on the jack\'s socket — each end the jack\'s own key at its centre, nothing laid along the row (over the Filter\'s switches, its "dry" tag); a forked source\'s BAL right of its jack', async () => {
  await scene('S3');
  const P = V().ports();
  for (const [jack, n] of [['i1/filter.in', 4], ['i1.main', 3]]) {
    const L = stackAt(jack), J = P.get(jack);
    assert.equal(L.length, n, jack + ': ' + n + ' cords');
    for (const c of L) { const p = REC.at.get(c.b); assert.deepEqual([c.b, p && p.x, p && p.y], [jack, J.x, J.y], jack + ': ' + c.id + ' on the socket'); }
  }
  const b = V().cables.forkBadge && V().cables.forkBadge('i1/oscC.out'), A = P.get('i1/oscC.out');
  if (b && A) assert.ok(parseFloat(b.style.left) >= A.x + 14, 'BAL right of the jack');
});

test('(fixer K; review P2-1, P2-2) a mod row\'s amount badge sits on its own settled rope after Tidy — the rope the GL layer draws at rest passes within half the badge\'s height (9 px) of its visible 18 px box — in S1, S2 and S3; a lone cord\'s knob end aimed on the same curve (its last stretch heads into the knob, ≤ 12°); the knob end\'s anchor carries the knob\'s disc (kx, ky, kr: cv-cords cuts the rope at the rim)', async () => {
  for (const name of ['S1', 'S2', 'S3']) {
    await scene(name);
    const per = new Map();
    for (const c of REC.list) if (c.s === 2) per.set(String(c.b).replace(/^knob:/, ''), 1);
    let n = 0;
    for (const c of REC.list.filter(x => x.s === 2)) {
      const A = REC.at.get(c.a), B = REC.at.get(c.b), row = V().cables.list().find(x => x.id === c.id), K = row && V().ports().get(row.b);
      if (!A || !B || !K || K.hid) continue;
      const O = Number.isFinite(K.kr) && K.kr > 0 ? { x: K.kx, y: K.ky, r: K.kr } : { x: K.x, y: K.y, r: K.r }; // (the knob's disc: cv-module's kx / ky / kr, else the control's centre and radius)
      assert.deepEqual([B.kx, B.ky, B.kr], [O.x, O.y, O.r], name + ' ' + c.id + ': the disc on its anchor');
      const b = V().cables.badge(c.id);
      if (!b || b.hidden) continue;
      const q = { x: parseFloat(b.style.left), y: parseFloat(b.style.top) }, w = 14 + 6.6 * b.children[0].textContent.length, at = drawn(A, B, O);
      let d = Infinity;
      for (let i = 0; i <= 240; i++) { const p = at(i / 240); d = Math.min(d, Math.hypot(Math.max(0, Math.abs(p.x - q.x) - w / 2), Math.max(0, Math.abs(p.y - q.y) - 9))); }
      assert.ok(d <= 9, name + ' ' + c.id + ': its badge ' + d.toFixed(1) + ' px off its rope (' + JSON.stringify(q) + ')');
      const lone = (REC.list || []).filter(x => x.s === 2 && V().cables.list().find(y => y.id === x.id && y.b === row.b)).length === 1;
      if (lone) {
        const e = at(1), pre = at(0.97), hd = Math.atan2(e.y - pre.y, e.x - pre.x), to = Math.atan2(O.y - e.y, O.x - e.x), dA = Math.abs(Math.atan2(Math.sin(hd - to), Math.cos(hd - to)));
        assert.ok(dA <= 12 * Math.PI / 180, name + ' ' + c.id + ': it arrives into its knob (' + (dA * 180 / Math.PI).toFixed(1) + '° off)');
      }
      n++;
    }
    assert.ok(n >= 1, name + ': badges measured');
  }
});

test('(the user, 2026-10-26: "cable should be on top of text here" — the IN Σ label drawn over its cable) a cord passes OVER its jack\'s label like a real cable — no label lifted above the cords (review WC-int P3-12\'s chip retired by design): in S1 and S3 the layer\'s top holds no label chip, every plugged jack\'s label stays in its face (under the cord layer) with its words; no lifted-label code left', async () => {
  for (const name of ['S1', 'S3']) {
    await scene(name);
    const top = LAYER.top();
    assert.equal(kidsOf(top, c => clsOf(c).includes(' rig-jl-top ') || clsOf(c).includes(' rig-jl ')).length, 0, name + ': no label over the cords');
    let n = 0;
    for (const c of REC.list) for (const e of c.s === 2 ? ['a'] : ['a', 'b']) {
      const el = jackEl(c[e]);
      if (!el) continue;
      const lab = kidsOf(el.parentNode, x => clsOf(x).includes(' rig-jl '))[0];
      if (!lab) continue; // (a Macros tile's knob jack: no label line)
      assert.ok(String(lab.textContent).length > 0, name + ' ' + c[e] + ': its label in its face, with its words');
      n++;
    }
    assert.ok(n >= 4, name + ': labels checked (' + n + ')');
  }
  const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  assert.ok(!/rig-jl-top/.test(src('style.css')) && !/rig-jl-top|rigLabels/.test(src('main.js')), 'no lifted-label code');
});
