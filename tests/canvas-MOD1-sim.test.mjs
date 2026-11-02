import './v8-guard.mjs';
// Stage MOD1 lane H (docs/canvas/IMPL-MOD1.md §2.2, §4.3, §5, §9 G2 / G3; the host): one LFO, one Envelope, one Macros in the page simulation.
// The Modulators' tiles route by the track (§5): on a Wavecraft track an LFO / Envelope / Macros goes INTO the Wavecraft (rigAdd: its slot,
// its auto-plug, dev.rig.n numbered around the track's own modulators — one numbering per canvas), on a Juno / an 808 / a 900 Series a
// track device, on the master a master device — never a replace; a Wavecraft made on a track that holds track modulators numbers around
// them; every modulator module carries data-cv-face="" (never a Wavecraft's own: data-cv-rig, nor a Pads module; cv-face's "gl" / "dom" /
// "svg" on a hardware module is another word, never touched), its width
// faceW(MOD_COLS[kind]), its out jack inline (the ids as before: l1.out, m1.k3); the words everywhere ("Added Envelope 2 · tap to undo",
// History, the source menu — a Wavecraft's own LFO by its own number, not "<NAME> LFO 1"); a macro knob posts {t: 'mval'} only; Tidy; undo /
// redo of every structural act; G2: old projects open and play (the 2b fixture tracks as a file, a schema-6 file, the master with an LFO
// and a Macros on two effects, a Wavecraft beside old track modulators with clashing numbers) — no throw, no console error, every
// modulator marked, its {t: 'mods'} posted. The faces themselves are lane F's: the checks that need them (.rig-face in every modulator,
// an off-screen face's tick, the master's MONO lock on the face) run once rig-ui has F's chaos recipe (FACES), i.e. after integration.
// canvas-WC-sim's scripted world (a real cv-cords layer behind a recorder); one boot; strings, numbers and booleans only into assert.
// Run alone: node --max-old-space-size=2048 --test tests/canvas-MOD1-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as CMOD from '../cv-model.js?v=9';
import * as CV from '../cv-mods.js?v=9';
import * as CVM from '../cv-module.js?v=9';
import * as CM from '../cv-migrate.js?v=9';
import * as RC from '../rig-core.js?v=9';
import * as RU from '../rig-ui.js?v=9';
import * as TRAY from '../cv-tray.js?v=9';
import { faceW } from '../rig-grid.js?v=9';
import { createCords } from '../cv-cords.js?v=9';
import { MODELS } from '../models.js?v=9';
import * as MB from './fixtures/mods-2b.mjs?v=9';

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
const api = sim.api, cv = globalThis.__synthTest.cv, acc = globalThis.__synthTest.acc, sh = globalThis.__synthTest.shell, RG = cv.rig, X = cv.mod, MS = globalThis.__synthTest.master;
class FXStub { constructor(box) { this.el = globalThis.document.createElement('div'); box.append(this.el); } refresh() {} destroy() {} paintMods() {} setLive() {} }
acc.uiLoad(Promise.resolve({ host: await import('../sx-host.js?v=9'), fxui: { FXRackUI: FXStub }, wk: await import('../wk.js?v=9'), mod: await import('../sx-ui-mod.js?v=9'), rig: RU }));
await sim.power(); sim.raf();
cv.renderViews(); await sim.settle(10); sim.raf(); await sim.settle(5); sim.raf();

const FACES = !!(RU.FACE && RU.FACE.chaos); // (lane F's faces merged: rig-ui has the chaos recipe — the face checks run from there on)
const RIG = RC.RIG, P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack), V = () => cv.view();
const I = (t = T()) => CMOD.instOf(t);
const keys = () => [...V().modules.keys()].sort().join(',');
const hsteps = () => cv.hist.u.length;
const note = () => sim.$('#notice').textContent;
const settle = async (n = 2) => { for (let i = 0; i < n; i++) { sim.raf(); await sim.settle(4); } };
const fresh = async model => { sh.srcPick(model, 'track'); await settle(4); return T(); };
const tiles = () => sh.shell.tiles;
const tap = async id => { tiles().modTile(id).dispatchEvent({ type: 'click', defaultPrevented: false, stopPropagation() {}, preventDefault() {} }); await settle(3); }; // (the tray's own click listener)
const drop = async (id, at) => { X.drag.drop(id, { over: 'canvas', at }); await settle(3); }; // (a Modulators tile dropped on the canvas at a world point)
const devKeys = (t = T()) => Object.keys(t.dev).filter(k => CMOD.kindOfId(k) && t.dev[k].kind === CMOD.kindOfId(k)).sort().join(',');
const rigN = (t = T()) => JSON.stringify(Object.fromEntries(Object.entries(RC.normRig(I(t).rig).n).sort())); // (dev.rig.n, its keys sorted)
const title = k => (V().modules.get(k) || {}).title;
const posted = (t, ty) => sim.nodeOf(t.id).posted.map(x => x.m).filter(m => !ty || m.t === ty);
const walk = (n, f, out = []) => { for (const c of (n && n.children) || []) { if (c && typeof c === 'object') { if (f(c)) out.push(c); walk(c, f, out); } } return out; };
const clsOf = c => ' ' + String((c.getAttribute && c.getAttribute('class')) || (typeof c.className === 'string' ? c.className : '') || '') + ' ';
const hasCls = (c, k) => clsOf(c).includes(' ' + k + ' ') || !!(c.classList && typeof c.classList.contains === 'function' && c.classList.contains(k)); // (the stub's classList is its own set)
// the modulator modules on the canvas shown: key → [its kind, data-cv-face, data-cv-rig] (strings only)
const FM = el => el.getAttribute('data-cv-face') === ''; // (MOD1's mark: the empty value — cv-face's 'gl' / 'dom' / 'svg' on a hardware module is its own)
const MODS = () => [...V().modules].filter(([k, m]) => m.kind === 'mod' && !/^pd\d+$/.test(k)).map(([k, m]) => k + (FM(m.el) ? ':face' : '') + (m.el.hasAttribute('data-cv-rig') ? ':rig' : '')).sort().join(' ');
const faceKinds = k => walk(V().modules.get(k).el, c => hasCls(c, 'rig-face') && !!c.getAttribute('data-rig-kind')).map(c => c.getAttribute('data-rig-kind')).join(',');
const ERR = [];
const errOn = () => { const ce = console.error; ERR.length = 0; console.error = (...a) => { ERR.push(String(a[0] && a[0].message || a[0])); }; return () => { console.error = ce; }; };

test('boot: a Juno-60, the panels and rig-ui loaded; the words are phase 0\'s (MOD_LABEL), the tray\'s data (LFO · Envelope · Macros first; the Wavecraft modules\' tiles without them)', () => {
  assert.equal(I().model, 'juno60');
  assert.deepEqual(tiles().modTiles().map(b => b.getAttribute('data-mod')), ['lfo', 'env', 'macro', 'wheel', 'velo', 'at', 'bend', 'note', 'cc', 'chaos'], 'LFO · Envelope · Macros first');
  assert.deepEqual(['env', 'lfo', 'macros'].map(k => tiles().partTile(k) === null), [true, true, true], 'one tile per type: no Wavecraft module tile for them');
  assert.deepEqual(TRAY.RIG_TILES.map(x => x.id), ['osc', 'sub', 'noise', 'filter', 'arp', 'clip']);
});

test('G3 §5 on a Juno, an 808 and a 900 Series a Modulators tile adds a track device — never a replace: the model stays, one step "Add Envelope 1", "Added Envelope 1 · tap to undo"; the Macros tile "Macros 1"; a drop too; undo / redo exact', async () => {
  for (const model of ['juno60', 'tr808', 'm900']) {
    const t = await fresh(model), n0 = hsteps();
    await tap('env');
    assert.deepEqual([I().model, devKeys(), hsteps() - n0, cv.hist.undoLabel, note()], [model, 'e1', 1, 'Add Envelope 1', 'Added Envelope 1 · tap to undo'], model + ': Envelope');
    await tap('lfo'); await tap('macro');
    assert.deepEqual([I().model, devKeys(), cv.hist.undoLabel, note(), title('m1'), title('l1'), title('e1')], [model, 'e1,l1,m1', 'Add Macros 1', 'Added Macros 1 · tap to undo', 'Macros 1', 'LFO 1', 'Envelope 1'], model + ': LFO, Macros');
    const s = JSON.stringify(t);
    await drop('lfo', { x: -900, y: 400 });
    assert.deepEqual([I().model, devKeys(), cv.hist.undoLabel], [model, 'e1,l1,l2,m1', 'Add LFO 2'], model + ': a drop');
    cv.undo(); await settle(3);
    assert.equal(JSON.stringify(T()), s, model + ': undo — exact');
    cv.redo(); await settle(3);
    assert.deepEqual([devKeys(), title('l2')], ['e1,l1,l2,m1', 'LFO 2'], model + ': redo');
  }
});

test('G3 §5 on a Wavecraft track the LFO / Envelope / Macros tiles add INTO the Wavecraft (rigAdd): a slot of its own, numbered — one step each, "Added Envelope 2 · tap to undo" (Envelope 1 is the starter\'s amp Envelope), "Added LFO 1", "Added Macros 1"; no track device; a second Macros says why, no step; never a replace', async () => {
  await fresh(RIG.ID);
  const n0 = hsteps();
  await tap('env');
  assert.deepEqual([I().model, devKeys(), hsteps() - n0, cv.hist.undoLabel, note()], [RIG.ID, '', 1, 'Add Envelope 2', 'Added Envelope 2 · tap to undo']);
  assert.ok(keys().includes('i1/env2'), 'Envelope 2: the rig\'s env2');
  await tap('lfo');
  assert.deepEqual([keys().includes('i1/lfo1'), cv.hist.undoLabel, note(), title('i1/lfo1')], [true, 'Add LFO 1', 'Added LFO 1 · tap to undo', 'LFO 1']);
  await tap('macro');
  assert.deepEqual([keys().includes('i1/macros'), cv.hist.undoLabel, note(), title('i1/macros')], [true, 'Add Macros 1', 'Added Macros 1 · tap to undo', 'Macros 1']);
  assert.equal(rigN(), JSON.stringify({ env2: 2, lfo1: 1, macros: 1 }), 'every new LFO / Envelope / Macros stores its number (dev.rig.n)');
  const n1 = hsteps();
  await tap('macro');
  assert.deepEqual([hsteps(), note(), devKeys()], [n1, 'Macros 1 is already on the canvas', ''], 'one Macros per Wavecraft: said, no step, no track Macros');
  // a drop: where it lands, into the Wavecraft
  await drop('lfo', { x: 2400, y: -900 });
  assert.deepEqual([keys().includes('i1/lfo2'), cv.hist.undoLabel, devKeys()], [true, 'Add LFO 2', ''], 'a drop: LFO 2 into the rig');
  cv.undo(); await settle(3);
  assert.deepEqual([keys().includes('i1/lfo2'), rigN()], [false, JSON.stringify({ env2: 2, lfo1: 1, macros: 1 })], 'undo: gone, its number with it');
  cv.redo(); await settle(3);
  assert.deepEqual([title('i1/lfo2'), JSON.parse(rigN()).lfo2], ['LFO 2', 2], 'redo: back with its number');
});

test('G3 §2.2 one numbering per canvas: on a Wavecraft track that holds track modulators (an old project, the hook\'s modAdd) a new Wavecraft LFO / Envelope / Macros takes the lowest number neither host shows — "LFO 3" beside the track\'s LFO 1 and LFO 2, "Envelope 3" beside Envelope 1 (the amp) and the track\'s Envelope 2, "Macros 2" beside the track\'s Macros 1; the bars, History, the notices, the source menu read it; undo / redo keep it', async () => {
  await fresh(RIG.ID);
  for (const k of ['lfo', 'lfo', 'env', 'env', 'macro']) X.add(k, null);
  await settle(3);
  assert.equal(devKeys(), 'e1,e2,l1,l2,m1', 'the track\'s own (cv.mod.add: the hook\'s track device)');
  await tap('lfo');
  assert.deepEqual([cv.hist.undoLabel, note(), title('i1/lfo1')], ['Add LFO 3', 'Added LFO 3 · tap to undo', 'LFO 3']);
  await tap('env');
  assert.deepEqual([cv.hist.undoLabel, note(), title('i1/env2')], ['Add Envelope 3', 'Added Envelope 3 · tap to undo', 'Envelope 3']);
  await tap('macro');
  assert.deepEqual([cv.hist.undoLabel, note(), title('i1/macros')], ['Add Macros 2', 'Added Macros 2 · tap to undo', 'Macros 2']);
  assert.equal(rigN(), JSON.stringify({ env2: 3, lfo1: 3, macros: 2 }));
  // the source menu and the labels: the Wavecraft's own LFO by its own number, never "<NAME> LFO 1"
  const L = globalThis.__synthTest.modUI.srcList(T()), lab = id => (L.find(s => s.id === id) || {}).label;
  assert.deepEqual([lab('i1/lfo1.out'), lab('i1/env2.out'), lab('i1/env1.out'), lab('l1.out'), lab('e2.out'), lab('m1.k2')], ['LFO 3', 'Envelope 3', `Envelope 1 · ${RIG.NAME}`, 'LFO 1', 'Envelope 2', 'Macro 2']); // (a macro knob: its own name, "Macro 2" by default; (MOD1 review 1 P2) the amp Envelope 1 beside the hook's track Envelope 1 — an old project's clash — told apart)
  assert.ok(L.every(s => !new RegExp(RIG.NAME + ' (LFO|ENV)').test(s.label) && !/\bENV\b/.test(s.label)), 'no "<NAME> LFO n" / "ENV n" in the source menu');
  assert.deepEqual([X.label('i1/lfo1.out'), X.label('i1/env2.out')], ['LFO 3', 'Envelope 3'], 'the Mod list / inspector / History words (modLabel)');
  cv.undo(); await settle(3);
  assert.deepEqual([keys().includes('i1/macros'), 'macros' in JSON.parse(rigN())], [false, false], 'undo: the Macros and its number gone');
  cv.redo(); await settle(3);
  assert.equal(title('i1/macros'), 'Macros 2', 'redo: the same number');
});

test('G3 §2.2 a Wavecraft made on a track that holds track modulators numbers around them: the Wavecraft tile over a Juno with LFO 1 and Envelope 1 — the starter\'s amp Envelope reads "Envelope 2" (dev.rig.n.env1), the track\'s modules stay (D2); a track with none keeps the slot numbers (nothing written)', async () => {
  await fresh('juno60');
  await tap('lfo'); await tap('env');
  assert.equal(devKeys(), 'e1,l1');
  sh.srcPick(RIG.ID, 'replace'); await settle(4);
  assert.deepEqual([I().model, devKeys(), rigN(), title('i1/env1'), title('e1'), title('l1')], [RIG.ID, 'e1,l1', JSON.stringify({ env1: 2 }), 'Envelope 2', 'Envelope 1', 'LFO 1']);
  cv.undo(); await settle(3);
  assert.deepEqual([I().model, devKeys()], ['juno60', 'e1,l1'], 'undo: the Juno back, its modulators');
  cv.redo(); await settle(3);
  assert.deepEqual([I().model, title('i1/env1')], [RIG.ID, 'Envelope 2'], 'redo');
  await fresh('juno60');
  sh.srcPick(RIG.ID, 'replace'); await settle(4);
  assert.deepEqual([I().model, rigN(), title('i1/env1')], [RIG.ID, '{}', 'Envelope 1'], 'no track modulators: as before');
});

test('G3 §5 on the master a Modulators tile adds a master device (LFO, Macros); an Envelope is refused there with the master\'s words — no step', async () => {
  await fresh('juno60');
  const tr = JSON.stringify(T());
  MS.open(); await settle(3);
  const n0 = hsteps();
  await tap('lfo');
  assert.deepEqual([Object.keys(P().master.mdev).join(), cv.hist.undoLabel, note()], ['l1', 'Add LFO 1', 'Added LFO 1 · tap to undo']);
  await tap('macro');
  assert.deepEqual([Object.keys(P().master.mdev).sort().join(), cv.hist.undoLabel], ['l1,m1', 'Add Macros 1']);
  const n1 = hsteps();
  await tap('env');
  assert.deepEqual([hsteps(), note()], [n1, MS.mod.src], 'refused, said');
  assert.equal(MODS(), 'l1:face m1:face', 'the master\'s modulators wear the face mark');
  assert.equal(hsteps() - n0, 2);
  MS.off(); await settle(3);
  assert.equal(JSON.stringify(T()), tr, 'the track untouched');
});

test('G3 §4.3 every modulator module carries data-cv-face — all ten kinds on a Juno (the wheel, Velocity … Chaos) —, never the instrument, its FX panel, OUT nor a Pads module; a Wavecraft\'s own LFO / Envelope / Macros keep data-cv-rig (no face mark); a track module on a Wavecraft canvas wears the face mark', async () => {
  await fresh('juno60');
  for (const k of ['wheel', 'velo', 'at', 'bend', 'note', 'lfo', 'env', 'macro', 'cc', 'chaos']) X.add(k, null);
  X.add('pads', null);
  await settle(4);
  assert.equal(MODS(), 'at:face bd:face c1:face e1:face h1:face l1:face m1:face nt:face ve:face wheel:face');
  assert.deepEqual([...V().modules].filter(([k, m]) => FM(m.el) && !(m.kind === 'mod' && !/^pd\d+$/.test(k))).map(([k]) => k), [], 'nothing else');
  // cv-face's own data-cv-face on a hardware module ('gl' / 'dom' / 'svg': its drawing mode, sxHeavyCount reads 'gl') is never touched
  V().modules.get('i1').el.setAttribute('data-cv-face', 'gl');
  cv.renderViews(); await settle(2);
  assert.deepEqual([['gl', 'dom', 'svg'].includes(V().modules.get('i1').el.getAttribute('data-cv-face')), MODS()], [true, 'at:face bd:face c1:face e1:face h1:face l1:face m1:face nt:face ve:face wheel:face'], 'the Juno keeps cv-face\'s mark (its value, never stripped)');
  assert.ok([...V().modules.keys()].some(k => /^pd\d+$/.test(k)), 'a Pads module there, unmarked');
  await fresh(RIG.ID);
  await tap('lfo'); X.add('lfo', null); await settle(3);
  const mk = k => { const m = V().modules.get(k); return (FM(m.el) ? 'face' : '') + (m.el.hasAttribute('data-cv-rig') ? 'rig' : ''); };
  assert.deepEqual([mk('i1/lfo1'), mk('i1/env1'), mk('l1'), mk('i1')], ['rig', 'rig', 'face', 'rig']);
  // the popups' skin (wk popSkin): a ⋯ menu from a modulator wears the canvas's skin, as a rig's or an FX module's
  const src = readFileSync(new URL('../main.js', import.meta.url), 'utf8'), at = src.indexOf('wkPopSkin(el => {'), blk = src.slice(at, src.indexOf('});', at));
  assert.ok(at > 0 && /\.cv-mod\[data-cv-face=""\]/.test(blk) && /\.cv-mod\[data-cv-rig\]/.test(blk) && /\.cv-mod\[data-cv-fx\]/.test(blk), 'wkPopSkin\'s closest() takes the face mark — its empty value only (an instrument\'s cv-face mark keeps its popups unskinned)');
});

test('G3 §4.3 sizes and jacks: a modulator module is faceW(MOD_COLS[kind]) wide; its out jack INLINE (the face\'s [data-jack="out"] its anchor, the right-edge dot the fallback), a Macros\' k1…k8 as before — the jack ids unchanged; a cable from it as before (cablesOf\'s records)', async () => {
  await fresh('juno60');
  for (const k of ['wheel', 'velo', 'at', 'bend', 'note', 'lfo', 'env', 'macro', 'cc', 'chaos']) X.add(k, null);
  await settle(3);
  const K = { wheel: 'wheel', velo: 've', at: 'at', bend: 'bd', note: 'nt', lfo: 'l1', env: 'e1', macro: 'm1', cc: 'c1', chaos: 'h1' };
  for (const [kind, k] of Object.entries(K)) {
    const m = V().modules.get(k);
    assert.equal(m.w, faceW(CV.MOD_COLS[kind]), kind + ': its face\'s width');
    assert.equal(m.jackIds().join(), kind === 'macro' ? 'k1,k2,k3,k4,k5,k6,k7,k8' : 'out', kind + ': the jack ids');
    const j = m.jack(kind === 'macro' ? 'k1' : 'out'); // (its anchor once measured — .cv-jack-in —, else its dot: data-inline, the fallback)
    assert.deepEqual([j.getAttribute('data-cv-jack'), j.hasAttribute('data-inline') || hasCls(j, 'cv-jack-in')], [k + (kind === 'macro' ? '.k1' : '.out'), true], kind + ': inline, its id as before');
    const spec = CVM.modJacks(kind, 'X');
    assert.deepEqual(spec.map(j => j.id + ':' + j.side + ':' + j.kind), kind === 'macro' ? CVM.modJacks('macro').map(j => j.id + ':inline:mod') : ['out:inline:mod'], kind + ': modJacks');
  }
  X.opts.onMod('l1.out', 'i1:cf'); X.opts.onMod('m1.k3', 'i1:rs'); await settle(2);
  const rows = V().cables.list().filter(c => c.kind === 'mod').map(c => c.a + '>' + c.b).sort();
  assert.deepEqual(rows, ['l1.out>i1:cf', 'm1.k3>i1:rs'], 'the rows\' ends: the same ids');
});

test('G3 Tidy: the modulator column left of the instrument at modX(kind) — each right edge just left of −MOD_GAP —, stacked without overlap, one step; undo / redo', async () => {
  await fresh('juno60');
  for (const k of ['wheel', 'velo', 'lfo', 'env', 'macro', 'chaos']) X.add(k, null);
  await settle(3);
  const t = T(), L0 = Object.assign({}, t.lay);
  L0.h1 = { x: -2048, y: 3072 }; t.lay = L0; // (a module moved off the column: Tidy has work)
  cv.renderViews(); await settle(3);
  const n0 = hsteps();
  cv.tidy(); await settle(3);
  assert.equal(hsteps(), n0 + 1, 'one step');
  const R = V().rects(), mods = [...V().modules].filter(([k, m]) => m.kind === 'mod' && !/^pd\d+$/.test(k) && R[k]).map(([k]) => k); // (the project's Pads module shows on every track: not a modulator)
  assert.equal(mods.length, 6);
  for (const k of mods) {
    const kind = k === 'wheel' ? 'wheel' : t.dev[k].kind;
    assert.equal(R[k].x, CVM.modX(kind), k + ' at modX');
    assert.ok(R[k].x + R[k].w <= -CVM.MOD_GAP, k + ': right of it the gap');
  }
  for (const a of mods) for (const b of mods) if (a < b) assert.ok(!(R[a].x < R[b].x + R[b].w && R[b].x < R[a].x + R[a].w && R[a].y < R[b].y + R[b].h && R[b].y < R[a].y + R[a].h), a + ' / ' + b);
  const lay = JSON.stringify(T().lay);
  cv.undo(); await settle(3); cv.redo(); await settle(3);
  assert.equal(JSON.stringify(T().lay), lay, 'undo / redo exact');
});

test('G3 a macro knob move posts {t: \'mval\'} only (no patch, no mods) and its gesture is one step "Edit Macros 1"; deleting a modulator is one step, undo brings it and its cable back', async () => {
  const t = await fresh('juno60');
  X.add('macro', null); await settle(2);
  X.opts.onMod('m1.k1', 'i1:cf'); await settle(2);
  const H = X.bodies.get('m1').host(), n0 = hsteps(), sent = () => posted(t).filter(m => ['mval', 'mods', 'patch'].includes(m.t)).map(m => m.t);
  sim.nodeOf(t.id).posted.length = 0;
  H.setN('m1', 0.4, 'start'); H.setN('m1', 0.5, 'move'); await settle(1);
  assert.deepEqual([...new Set(sent())], ['mval'], 'the move: {t: mval} only');
  H.setN('m1', 0.5, 'end'); await settle(2);
  const mv = posted(t, 'mval');
  assert.deepEqual([+mv[mv.length - 1].v.toFixed(2), posted(t, 'patch').length, hsteps() - n0, cv.hist.undoLabel], [0.5, 0, 1, 'Edit Macros 1'], 'no patch; the end one step');
  const s = JSON.stringify(T());
  X.del('m1', true); await settle(2);
  assert.deepEqual([devKeys(), (T().mods || []).length, cv.hist.undoLabel], ['', 0, 'Delete Macros 1']);
  cv.undo(); await settle(3);
  assert.equal(JSON.stringify(T()), s, 'undo: the module and its cable');
});

test('G3 (lane F\'s faces) every modulator\'s body holds its face (.rig-face[data-rig-kind]); an off-screen (folded) face is not shown (its slot host\'s tick stops); the master\'s LFO wears its face', { skip: !FACES && 'lane F\'s faces are not merged in this tree' }, async () => {
  await fresh('juno60');
  for (const k of ['wheel', 'velo', 'at', 'bend', 'note', 'lfo', 'env', 'macro', 'cc', 'chaos']) X.add(k, null);
  await settle(4);
  for (const k of ['wheel', 've', 'at', 'bd', 'nt', 'l1', 'e1', 'm1', 'c1', 'h1']) assert.ok(faceKinds(k).length > 0, k + ': a face');
  const H = X.bodies.get('l1').host(), shown = () => H.views.some(v => v.shown());
  assert.equal(shown(), true, 'on screen: shown');
  V().toggleFold('l1'); await settle(2);
  assert.equal(shown(), false, 'folded: not shown — tickLive false');
  V().toggleFold('l1'); await settle(2);
  assert.equal(shown(), true, 'unfolded: shown again');
  MS.open(); await settle(3);
  const k = X.add('lfo', null); await settle(3);
  assert.equal(faceKinds(k), 'lfo', 'the master\'s LFO: its face (its MONO switch\'s lock: the next test, through its host)');
  MS.off(); await settle(3);
});

test('G3 the master\'s MONO lock: an LFO\'s / a Chaos\'s MONO turned off through its slot host (what its switch does) changes nothing — no step, the record GLOBAL', async () => {
  await fresh('juno60');
  MS.open(); await settle(3);
  const kl = X.add('lfo', null), kc = X.add('chaos', null); await settle(3);
  const rec = () => JSON.stringify([P().master.mdev[kl], P().master.mdev[kc]]), r0 = rec(), u0 = cv.hist.u.at(-1);
  X.bodies.get(kl).host().edit(s => { s.lfo[0].mono = 0; }, { label: 'MONO' }); await settle(2);
  X.bodies.get(kc).host().edit(s => { s.chaos[0].mono = 0; }, { label: 'MONO' }); await settle(2);
  assert.deepEqual([cv.hist.u.at(-1) === u0, rec(), P().master.mdev[kl].lfo.mono, P().master.mdev[kc].chaos.mono], [true, r0, 1, 1]);
  MS.off(); await settle(3);
});

test('G3 §5 (lane U\'s Modulators view) the tray\'s words there: a tap ADDS a modulator — never "in place of" an instrument, never a new track — on a Juno and on a <NAME> (its LFO / Envelope / Macros into it), in either mode', { skip: !TRAY.SRC_VIEWS.some(v => v.id === 'mods') && 'lane U\'s Modulators view is not merged in this tree' }, async () => {
  const T0 = tiles(), v0 = T0.view(), txt = () => sim.$('#srcMode').children.map(c => c.textContent || '').join(''); // (the stub keeps nodes only)
  try {
    T0.setView('mods');
    await fresh('juno60');
    for (const mode of ['replace', 'track']) {
      sh.cvOpenSources(mode);
      assert.equal(txt(), `Tap a modulator to add it to “${T().name}”, or drag it where you want it. Then drag its OUT onto a knob to move it.`, mode);
    }
    await fresh(RIG.ID);
    sh.cvOpenSources('replace');
    assert.equal(txt(), `Tap a modulator to add it to “${T().name}” — an LFO, Envelope or Macros goes into its ${RIG.NAME} — or drag it where you want it. Then drag its OUT onto a knob.`); // ((MOD1 review) no "plugged in": AUTOPLUG plugs none of them in but an Envelope on a gate
    assert.ok(!/in place of|a new track/.test(txt()));
  } finally { sh.cvOpenSources('replace'); T0.setView(v0); }
});

/* ---------------------------------------------------------------- G2: old projects open and play */
// a project file through the app's load path (loadProject: upgrade, the split, deserialize) and restore; every track shown once: no throw, no
// console error, each modulator module marked (and wearing a face once lane F is in), its {t: 'mods'} posted
async function openFile(p) {
  const off = errOn();
  try {
    api.applyRestore(acc.loadProject(JSON.parse(JSON.stringify(p)), { file: true }));
    await settle(4);
    const out = [];
    for (const t of P().tracks) {
      api.selectTrack(t.id); await settle(4);
      const mods = CMOD.modDevs(t);
      if (!mods.length) continue;
      const marked = mods.every(x => { const m = V().modules.get(x.id); return !!m && FM(m.el); });
      const faced = !FACES || mods.every(x => faceKinds(x.id).length > 0);
      const pay = api.buildMods(t), want = !!pay && !pay.off; // (a payload of its own: rows the track's ModCore runs — a Serum's rows go into its matrix)
      const N = sim.nodeOf(t.id), got = posted(t, 'mods').length > 0 || !!(N && N.po && N.po.mods); // (a new node's payload travels in its processorOptions)
      out.push(t.id + ':' + (marked ? 'marked' : 'UNMARKED') + (faced ? '' : ':NOFACE') + (!want ? '' : got ? ':mods' : ':NOMODS'));
    }
    return out.join(' ');
  } finally { off(); }
}
const UID = 'p_mod1abcdef';

test('G2 the 2b fixture tracks (a Serum complete and a Juno with every modulator kind, the wheel) saved as a file open and play: no throw, no console error, every modulator marked, {t: mods} posted', async () => {
  const p = { name: 'MOD1 2b', schema: CM.SCHEMA, uid: UID, bpm: 120, perf: { wheel: { v: 1 } }, tracks: MB.tracks() };
  const r = await openFile(p), L = r.split(' ');
  assert.deepEqual([L.filter(x => /UNMARKED|NOFACE|NOMODS/.test(x)), L.filter(x => /:mods$/.test(x)).length >= 4, P().tracks.filter(t => CMOD.modDevs(t).length).length, ERR.join(' | ')], [[], true, L.length, ''], r);
});

test('G2 a schema-6 file with modulators (STEPS[6] moves their places) opens and plays', async () => {
  const t = MB.tracks()[1];
  t.lay = { i1: { x: 0, y: 0 }, l1: { x: -320, y: 0, fold: 1 }, l2: { x: -320, y: 320 }, e1: { x: -320, y: 640 }, m1: { x: -320, y: 960 }, c1: { x: -320, y: 1344 }, nt: { x: -320, y: 1600 }, h1: { x: 200, y: 100 } };
  const r = await openFile({ name: 'M3', schema: 6, uid: UID, perf: { wheel: { v: 1 } }, tracks: [t] }), L = r.split(' ');
  assert.deepEqual([L.filter(x => /UNMARKED|NOFACE|NOMODS/.test(x)), L.some(x => /:mods$/.test(x)), ERR.join(' | ')], [[], true, ''], r);
});

test('G2 a Wavecraft with its own LFO / Envelope / Macros beside old track LFO / Envelope / Macros (numbers clashing: "LFO 1" twice), saved and opened: no throw, no console error, both hosts\' modules up — the track\'s marked, the rig\'s its own', async () => {
  await fresh(RIG.ID);
  RG.add(null, 'lfo'); RG.add(null, 'macros'); await settle(2);
  for (const k of ['lfo', 'env', 'macro']) X.add(k, null);
  X.opts.onMod('l1.out', 'i1:f.cutoff'); await settle(3);
  assert.deepEqual([title('i1/lfo1'), title('l1'), title('i1/macros'), title('m1')], ['LFO 1', 'LFO 1', 'Macros 1', 'Macros 1'], 'the clash an old project may hold (§13)');
  const p = JSON.parse(JSON.stringify(P())), id = T().id;
  p.tracks = p.tracks.filter(t => t.id === id);
  p.selTrack = id;
  const r = await openFile(p);
  assert.deepEqual([r, ERR.join(' | ')], [id + ':marked:mods', '']);
  assert.ok(['i1/lfo1', 'i1/macros', 'i1/env1', 'l1', 'e1', 'm1'].every(k => V().modules.has(k)), 'both hosts\' modules on the canvas');
});

test('G2 the master with an LFO and a Macros on two effects, saved and opened: no throw, no console error, the master\'s modulators marked, its {t: mods} posted to MASTER', async () => {
  await fresh('juno60');
  MS.open(); await settle(3);
  cv.fx.addEffect('mfx', 'cmp'); await settle(1); cv.fx.addEffect('mfx', 'dly'); await settle(2);
  const a = X.add('lfo', null), b = X.add('macro', null); await settle(3);
  assert.ok(X.connect(a + '.out', 'mfx:fx.cmp.thr') && X.connect(b + '.k1', 'mfx:fx.dly.mix'), 'two rows');
  await settle(2);
  const p = JSON.parse(JSON.stringify(P())), want = Object.keys(p.master.mdev).sort().map(k => k + ':face').join(' ');
  MS.off(); await settle(2);
  const off = errOn();
  try {
    api.applyRestore(acc.loadProject(p, { file: true })); await settle(4);
    MS.open(); await settle(4);
    const got = MS.rec().node.posted.map(x => x.m).filter(m => m.t === 'mods');
    assert.deepEqual([MODS(), got.length > 0, ERR.join(' | ')], [want, true, '']);
    if (FACES) for (const k of Object.keys(p.master.mdev)) assert.ok(faceKinds(k).length > 0, k + ': a face');
  } finally { off(); MS.off(); await settle(2); }
});

/* ---------------------------------------------------------------- the reviews (MOD1 reviewers 1 and 2): the fixes' tests */
// (reviewer 1 P1) a slot face mounted or painted while hidden — folded, off screen, the CANVAS tab hidden — is painted once it shows again: the
// canvas's shown hook (sxReshow) reshows every modulator body's slot host, as it does the Serum views (a view stale = skipped by a paint)
const vstate = H => H.views.map(v => (v.shown() ? 'shown' : 'hidden') + (v.stale ? '+stale' : '')).join(',');
for (const kind of ['lfo', 'env', 'macro', 'chaos']) {
  test('P1 (reviewer 1, R1-r) a folded ' + kind + ' face mounted again (its track shown again), then unfolded: painted (not stale)', async () => {
    const a = await fresh('juno60');
    const k = X.add(kind, null); await settle(4);
    V().toggleFold(k); await settle(3);
    await fresh('juno60'); // (another track: the canvas switches)
    api.selectTrack(a.id); await settle(6); // (back: every body mounted again — this one hidden, folded: its first paint skipped)
    const H = X.bodies.get(k).host();
    assert.equal(vstate(H), 'hidden+stale', kind + ': mounted folded');
    V().toggleFold(k); await settle(6);
    assert.equal(vstate(H), 'shown', kind + ': unfolded — its first paint');
  });
}
test('P1 (reviewer 1, R1-o) an LFO face folded, edited through its host (as an undo would), unfolded: painted again (not stale)', async () => {
  await fresh('juno60');
  const l = X.add('lfo', null); await settle(4);
  const H = X.bodies.get(l).host();
  V().toggleFold(l); await settle(3);
  H.edit(s => { s.p['l1.rate'] = 0.123; }, { label: 'RATE' }); await settle(3);
  assert.equal(vstate(H), 'hidden+stale', 'folded, edited: the paint skipped it');
  V().toggleFold(l); await settle(4);
  assert.equal(vstate(H), 'shown');
});
test('P1 an Envelope face off screen (the world\'s plan) while edited, back on screen: painted again (not stale)', async () => {
  await fresh('juno60');
  const e = X.add('env', null); await settle(4);
  const H = X.bodies.get(e).host(), m = V().modules.get(e);
  m.onScreen(false); await settle(2);
  H.edit(s => { s.p['e2.att'] = 0.3; }, { label: 'ATTACK' }); await settle(3);
  assert.equal(vstate(H), 'hidden+stale', 'off screen, edited');
  m.onScreen(true); await settle(4);
  assert.equal(vstate(H), 'shown');
});
test('P1 a Macros face edited while the CANVAS tab is hidden (ROLL shown), CANVAS again: painted again (not stale)', async () => {
  await fresh('juno60');
  const k = X.add('macro', null); await settle(4);
  const H = X.bodies.get(k).host();
  try {
    sh.openTab('roll'); await settle(3);
    H.edit(s => { s.macros[0].v = 0.7; }, { label: 'MACRO 1' }); await settle(3);
    assert.equal(vstate(H), 'hidden+stale', 'ROLL shown, edited');
  } finally { sh.openTab('canvas'); await settle(4); }
  assert.equal(vstate(H), 'shown');
});

// (reviewer 1 P2) the "Connect to…" source list (modSrcList: sourcesOf + linkSources) names nothing twice: a <NAME>'s LFOs / Envelopes are
// listed only where a module of them is on its canvas (rig-core partKeys: laid, powered, or a slot a row reads — nothing a cable uses goes)
const srcLabels = () => globalThis.__synthTest.modUI.srcList(T()).filter(s => !s.hidden).map(s => s.label);
const dups = L => [...new Set(L.filter((x, i) => L.indexOf(x) !== i))].join(',');
test('P2 (reviewer 1, R1-a) a Juno with LFO 1, LFO 2 → the <NAME> tile → the LFO tile (its LFO 3): the source list names nothing twice — the <NAME>\'s modules on the canvas only', async () => {
  await fresh('juno60');
  await tap('lfo'); await tap('lfo');
  sh.srcPick(RIG.ID, 'replace'); await settle(4);
  await tap('lfo');
  const L = srcLabels();
  assert.deepEqual([dups(L), L.filter(x => /^(LFO|Envelope)/.test(x)).join(' / ')], ['', 'LFO 1 / LFO 2 / LFO 3 / Envelope 1'], L.join(' / '));
});
test('P2 (reviewer 1, R1-a2) the contract\'s own example (§2.2): a Juno with an Envelope → the <NAME> tile — "Envelope 2" (the amp) once in the source list', async () => {
  await fresh('juno60');
  await tap('env');
  sh.srcPick(RIG.ID, 'replace'); await settle(4);
  const L = srcLabels();
  assert.deepEqual([dups(L), L.filter(x => /^(LFO|Envelope)/.test(x)).join(' / ')], ['', 'Envelope 1 / Envelope 2'], L.join(' / '));
});
test('P2 a <NAME>\'s slot a track row reads stays in the source list (its module stands); an old project\'s clash ("LFO 1" in both hosts) is told apart', async () => {
  await fresh(RIG.ID);
  RG.add(null, 'lfo'); await settle(2);
  X.add('lfo', null); await settle(3);
  assert.deepEqual([title('i1/lfo1'), title('l1')], ['LFO 1', 'LFO 1'], 'an old project\'s clash (§13)');
  let L = srcLabels();
  assert.deepEqual([dups(L), L.filter(x => /^LFO/.test(x)).join(' / ')], ['', `LFO 1 / LFO 1 · ${RIG.NAME}`]);
  const t = T();
  t.mods = (t.mods || []).concat([{ id: 'r99', src: 'i1/lfo4.out', dst: 'i1:f.cutoff', amt: 0.5 }]); // (an old project: a row from LFO 4, no place of its own)
  L = srcLabels();
  assert.deepEqual([dups(L), L.filter(x => /^LFO/.test(x)).join(' / ')], ['', `LFO 1 / LFO 1 · ${RIG.NAME} / LFO 4`]);
  t.mods = t.mods.filter(r => r.id !== 'r99');
});

// (reviewer 2 P2 / P3) the bars: the Mod Wheel's title "Mod Wheel" (not its id); a face of 3 columns holds its title alone (the sub-label only
// on a face of 4 or more columns: LFO, Envelope, Macros) — tests/ui-layout-wc.mjs measures every bar's title unclipped in Chrome
test('P3 (reviewer 2) the Mod Wheel\'s bar reads "Mod Wheel"; the 3-column faces\' bars no sub-label, the wider faces\' the track\'s name', async () => {
  const t = await fresh('juno60');
  for (const k of ['wheel', 'velo', 'at', 'bend', 'note', 'lfo', 'env', 'macro', 'cc', 'chaos']) X.add(k, null);
  await settle(4);
  const bar = k => { const m = V().modules.get(k), ts = walk(m.el, c => hasCls(c, 'cv-title')), ss = walk(m.el, c => hasCls(c, 'cv-sub')); return (ts[0] ? ts[0].textContent : '?') + '|' + (ss[0] && !ss[0].hidden ? ss[0].textContent : ''); };
  assert.deepEqual(['wheel', 've', 'at', 'bd', 'nt', 'c1', 'h1', 'l1', 'e1', 'm1'].map(bar),
    ['Mod Wheel|', 'Velocity|', 'Aftertouch|', 'Bend|', 'Note|', 'CC 1|', 'Chaos 1|', 'LFO 1|' + t.name, 'Envelope 1|' + t.name, 'Macros 1|' + t.name]);
  assert.deepEqual(['wheel', 'at', 'bend'].map(k => CV.MOD_COLS[k] + ':' + V().modules.get(CV.MOD_DEV[k] || k).w), ['3:224', '3:224', '3:224'], 'the wheel, Aftertouch and Bend on 3 columns (224): their titles in full');
});

// (reviewer 2 P3) the Modulators view's words true on a <NAME>: an LFO / Envelope / Macros goes INTO it — plugged in only by an Envelope on a
// gate (rig-core AUTOPLUG: lfo [], macros [])
test('P3 the Modulators view on a <NAME>: an LFO / Envelope / Macros goes into it — no "plugged in" (rig-core AUTOPLUG: lfo [], macros [])', { skip: !TRAY.SRC_VIEWS.some(v => v.id === 'mods') && 'no Modulators view' }, async () => {
  assert.deepEqual([RC.AUTOPLUG.lfo.length, RC.AUTOPLUG.macros.length], [0, 0]);
  const T0 = tiles(), v0 = T0.view(), txt = () => sim.$('#srcMode').children.map(c => c.textContent || '').join('');
  try {
    T0.setView('mods');
    await fresh(RIG.ID);
    sh.cvOpenSources('replace');
    assert.equal(txt(), `Tap a modulator to add it to “${T().name}” — an LFO, Envelope or Macros goes into its ${RIG.NAME} — or drag it where you want it. Then drag its OUT onto a knob.`);
    assert.ok(!/plugged in/.test(txt() + TRAY.SRC_VIEWS.find(v => v.id === 'mods').note));
  } finally { sh.cvOpenSources('replace'); T0.setView(v0); }
});

// (optional, the lead) a Modulators LFO tile dropped at a point on a <NAME> canvas: rigAdd with that place — the module lands where it was dropped
test('a Modulators LFO tile dropped on a <NAME> canvas lands at the drop point (modTile → rigAdd with its place), one step; undo', async () => {
  await fresh(RIG.ID);
  const n0 = hsteps();
  await drop('lfo', { x: 3000, y: -1600 });
  const L = T().lay['i1/lfo1'];
  assert.ok(!!L, 'laid');
  assert.deepEqual([hsteps() - n0, cv.hist.undoLabel, L.x <= 3000 && L.x + 352 >= 3000, L.y <= -1600 && L.y >= -1600 - 600], [1, 'Add LFO 1', true, true], JSON.stringify(L));
  cv.undo(); await settle(3);
  assert.equal(keys().includes('i1/lfo1'), false);
});
