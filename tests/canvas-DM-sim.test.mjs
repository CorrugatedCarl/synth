import './v8-guard.mjs';
// Stage DM lane H (docs/canvas/IMPL-DM.md §1.2, §4.5, §4.6, §5.5–§5.8, §6.1, §8 G4's host part, G6, G7's flows; the host): our drum
// machine in the page simulation with the real engine — the kit tile makes a kit track (the Sequencer + the Starter's eight voices, the
// grid EMPTY; one Replace step), the voices are cv-module 'pm' modules under the Sequencer (Tidy's rack, the rig mark), every grid gesture
// is ONE History step that ↶ / ↷ move (keepDevs keeps the knobs, never the record), a structural edit (add / remove / TYPE / kit load) is
// one step carrying kitBack (its vals back exactly), the knobs write vals → the {t:'patch'} (no step); the voice tiles (on a kit: add; on
// another canvas: a kit with that voice; on the track list: a new kit track); 16 voices the most (KIT_FULL); the names everywhere through the
// record (the roll, the Ducker's NOTE menu, the Pads, a Combiner's Marks menu and its hits); a modulation drag onto a kit knob refused with
// NOMOD_KIT's words; playing: the heard step at its heard time; the bounce payload = the live one; save → load (schema 18) with reconcile;
// another track's bytes untouched. Drives __synthTest.cv.kit (§6.1: add / state / cellRect + the sims' readers) — the faces' own deps.
// canvas-LC-sim's scripted world and DOM fixes; one boot; strings, numbers and booleans only into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/canvas-DM-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as CMOD from '../cv-model.js?v=9';
import * as CM from '../cv-migrate.js?v=9';
import * as DC from '../drum-core.js?v=9';
import * as KC from '../kit-core.js?v=9';
import * as PC from '../pads-core.js?v=9';
import * as cvPads from '../cv-pads.js?v=9';
import { drumRowsOf } from '../roll.js?v=9';
import { NOMOD_KIT } from '../cv-mods.js?v=9';
import { KIT_FULL } from '../cv-tray.js?v=9';
import { MODELS } from '../models.js?v=9';
import { GROOVE } from './kit-fixtures.mjs';

for (const g of ['SxBase', 'SxFilt2', 'SxWarp', 'SxMod', 'SxSample', 'SxGran', 'SxSpec', 'SxSeq', 'SerumDSP', 'FXMods2', 'FXDSP', 'Dr808', 'DrKit', 'DrSeq', 'ModCore', 'PatchDSP', 'PatchMoog', 'MASTERDSP']) globalThis[g] = null;
const VP = { left: 0, top: 48 }, BAND = { left: 44, top: 48, right: 1520, bottom: 900 };
function scriptedWorld(root) {
  const L = {};
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
  };
  return W;
}

await (await import('../cv-mods-ui.js?v=9')).ready();
const sim = await bootMain({ ls: fakeStorage({}), hash: '#juno60', clock: 'std', outLat: 0.2, synthTest: { cvWorld: root => scriptedWorld(root) } });
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
const api = sim.api, cv = globalThis.__synthTest.cv, sh = globalThis.__synthTest.shell, acc = globalThis.__synthTest.acc, X = cv.mod;
await sim.power(); sim.raf();
cv.renderViews(); await sim.settle(10); sim.raf(); await sim.settle(5); sim.raf();

const K = () => cv.kit;
const KIT = KC.KIT, NAME = MODELS.find(m => m.id === 'kit').name, BAR = 3840;
const P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack), V = () => cv.view();
const byId = id => P().tracks.find(t => t.id === id);
const I = (t = T()) => CMOD.instOf(t);
const D = (t = T()) => cv.drumOf(t, CMOD.primId(t));
const keys = () => [...V().modules.keys()].sort().join(',');
const hsteps = () => cv.hist.u.length;
const note = () => sim.$('#notice').textContent;
const settle = async (n = 2) => { for (let i = 0; i < n; i++) { sim.raf(); await sim.settle(4); } };
const node = (t = T()) => sim.nodeOf(t.id);
const sent = (t, k) => node(t).posted.map(x => x.m).filter(m => m.t === k);
const got = (t, k) => node(t).got.filter(m => m.t === k);
const tiles = () => sh.shell.tiles;
const kitTap = async id => { tiles().kitTile(id).dispatchEvent({ type: 'click', defaultPrevented: false, stopPropagation() {}, preventDefault() {} }); await settle(3); };
const vox = (t = T()) => KIT.CODES.map((s, j) => (I(t).vals[s + 't'] > 0 ? j : -1)).filter(j => j >= 0).join(',');
const cellsOf = (p = 0, t = T()) => D(t).pat[p].cells.map(c => c.l + '@' + c.s + ':' + c.v).join(' ');
const ERR = [];
const errOn = () => { const ce = console.error; ERR.length = 0; console.error = (...a) => { ERR.push(String(a[0] && a[0].message || a[0])); }; return () => { console.error = ce; }; };
const fresh = async model => { sh.srcPick(model, 'track'); await settle(4); return T(); };
const kitNow = async () => { const t = await fresh('juno60'); sh.srcPick('kit', 'replace'); await settle(4); return T(); };
const ID = {};

test('§1.2 the kit tile on a Juno: one Replace step — the Sequencer + the Starter\'s eight voices, every pattern EMPTY (the user\'s answer), pattern A; the record = kit-core starter(), the vals the Starter kit; "Replaced Juno-60 with <NAME> · tap to undo"; ↶ the Juno whole', async () => {
  const off = errOn();
  try {
    assert.equal(typeof K(), 'object', '__synthTest.cv.kit');
    const t = await fresh('juno60'), s0 = JSON.stringify(t.dev), n0 = hsteps();
    sh.srcPick('kit', 'replace'); await settle(4);
    const d = I();
    assert.deepEqual([d.model, hsteps() - n0, note()], ['kit', 1, 'Replaced Juno-60 with ' + NAME + ' · tap to undo']);
    assert.equal(JSON.stringify(D()), JSON.stringify(KC.starter()), 'the record: the Starter\'s types, notes and names on an empty grid');
    assert.deepEqual([D().pat.every(p => p.cells.length === 0), D().ui.pat, vox()], [true, 0, '0,1,2,3,4,5,6,7'], 'every pattern empty; A selected; eight voices');
    assert.equal(KIT.IDS.every(id => d.vals[id] === KIT.KITS[0].v[id]), true, 'the vals: the Starter kit (the model\'s defaults, never a last-used set)');
    assert.equal(keys(), ['fx1', 'i1', ...KIT.CODES.slice(0, 8).map(s => 'i1/' + s), 'out'].sort().join(','), 'the Sequencer, eight voice modules, the FX panel, OUT');
    const S = K().state(t.id);
    assert.deepEqual([S.pattern, S.len, S.swing, S.playing, S.voices.length], [0, 16, 50, false, 8]);
    assert.deepEqual(S.voices.map(v => v.slot + ':' + v.type + ':' + v.name + ':' + v.note).join(' '), KC.names(KC.starter()).slice(0, 8).map((nm, j) => j + ':' + KIT.STARTER[j].t + ':' + nm + ':' + KIT.STARTER[j].n).join(' '));
    assert.equal(S.voices.every(v => Object.keys(v.cells).length === 0), true, 'no cells');
    // the modules: the Sequencer 1248 px wide (19 columns), the voices 'pm' modules 288 px wide, in rows of four under it, 32 px apart; the rig mark
    const q = V().modules.get('i1'), a = V().modules.get('i1/ka'), b = V().modules.get('i1/kb'), e = V().modules.get('i1/ke');
    assert.deepEqual([q.w, a.w, a.kind, b.x - a.x, a.x - q.x, e.x - a.x, e.y - a.y > 0, a.y > q.y + q.fixed.h - 1], [1248, 288, 'pm', 320, 0, 0, true, true], 'the rack: four a row, under the Sequencer');
    assert.deepEqual([q.el.hasAttribute('data-cv-rig'), a.el.hasAttribute('data-cv-rig'), V().modules.get('fx1').el.hasAttribute('data-cv-rig')], [true, true, false], 'the kit\'s modules wear the rig\'s mark (the skins)');
    assert.deepEqual([q.title, a.title], ['Sequencer', 'Kick']);
    cv.undo(); sim.raf(); await settle(3);
    assert.deepEqual([I().model, JSON.stringify(T().dev) === s0], ['juno60', true], '↶: the Juno whole');
    cv.redo(); sim.raf(); await settle(3);
    assert.deepEqual([I().model, cellsOf()], ['kit', ''], '↷: the kit again');
    ID.t = T().id;
  } finally { off(); }
  assert.deepEqual(ERR, [], 'no console error');
});

test('R2-1 / R2-7 / R2-9 the Sequencer\'s host element: the rig\'s own (`inst custom m-kit`: no padding, no hardware classes) on a new kit track, after a Replace of a Minimoog, after a track switch; the module never folds and its OUT jack is the Sequencer\'s; kit → Juno a classic module again', async () => {
  const look = t => { const E = K().faces().seqs.get(t.id + '/i1'), m = V().modules.get('i1'); return [E ? E.el.className : null, m.nofold, m.el.hasAttribute('data-cv-nofold'), m.jack('out').getAttribute('aria-label')]; };
  const KIT_LOOK = ['inst custom m-kit', true, true, 'Sequencer out'];
  const id = K().add(null); await settle(4);
  assert.deepEqual(look(byId(id)), KIT_LOOK, 'a new kit track');
  const mm = await fresh('minimoog');
  assert.equal(V().modules.get('i1').el.hasAttribute('data-cv-nofold'), false);
  sh.srcPick('kit', 'replace'); await settle(4);
  assert.deepEqual(look(T()), KIT_LOOK, 'a Minimoog replaced');
  api.selectTrack(id); sim.raf(); await settle(3); api.selectTrack(mm.id); sim.raf(); await settle(3);
  assert.deepEqual(look(T()), KIT_LOOK, 'after a track switch');
  sh.srcPick('juno60', 'replace'); await settle(4);
  const m = V().modules.get('i1'), el = m.body.children.find(x => x && x.className && /\binst\b/.test(x.className));
  assert.deepEqual([I().model, !!el && /\bm-juno60\b/.test(el.className) && !/\bm-kit\b|\bcustom\b/.test(el.className), m.nofold, m.el.hasAttribute('data-cv-nofold'), m.jack('out').getAttribute('aria-label')], ['juno60', true, false, false, m.title + ' out'], 'kit → Juno: a classic module again');
  api.deleteTrack(byId(id)); sim.raf(); await settle(); api.deleteTrack(T()); sim.raf(); await settle();
  api.selectTrack(ID.t); sim.raf(); await settle(2);
});

test('§5.5 a cell tap = ONE History step (the payload posted in place); a velocity drag = one step; ↶ / ↷ move the pattern; a knob turn is never reverted (keepDevs keeps vals, not the record)', async () => {
  const t = byId(ID.t);
  api.selectTrack(ID.t); sim.raf(); await settle(2);
  const n0 = hsteps(), q0 = sent(t, 'seq').length;
  assert.equal(K().cell(ID.t, 0, 0, 100), true);
  await settle();
  assert.deepEqual([hsteps() - n0, cellsOf(), cv.hist.u.at(-1).label, sent(T(), 'seq').length - q0], [1, '0@0:100', 'Edit pattern', 1], 'one step, the plan posted once');
  assert.equal(sent(T(), 'seq').at(-1).s.plan.st[0], 1, 'the posted plan: the kick on step 1 (slot 0 = bit 0)');
  K().cell(ID.t, 0, 0, 37); await settle(); // (the velocity drag's gesture: one cell write)
  assert.deepEqual([hsteps() - n0, cellsOf()], [2, '0@0:37']);
  K().knob(ID.t, 'kau', 7.5, 'end'); await settle();
  assert.deepEqual([hsteps() - n0, I().vals.kau], [2, 7.5], 'a knob: no step');
  const pt = sent(T(), 'patch').at(-1);
  assert.equal(!!pt, true, 'the {t:\'patch\'} posted');
  cv.undo(); sim.raf(); await settle();
  assert.deepEqual([cellsOf(), I().vals.kau], ['0@0:100', 7.5], '↶: the velocity back, the knob kept');
  cv.undo(); sim.raf(); await settle();
  assert.deepEqual([cellsOf(), I().vals.kau], ['', 7.5], '↶: the cell off');
  cv.redo(); cv.redo(); sim.raf(); await settle();
  assert.deepEqual([cellsOf(), I().vals.kau], ['0@0:37', 7.5], '↷ ↷');
  assert.equal(sent(T(), 'seq').at(-1).s.pk, DC.payload(D(), null, 'now').pk, 'the machine holds the restored pattern');
  // a no-op (a cell on an empty slot's row) records nothing
  const n1 = hsteps();
  K().cell(ID.t, 12, 0, 100); await settle();
  assert.equal(hsteps(), n1, 'a refused cell: no step');
});

test('§5.5 pattern / LENGTH / SWING / CLEAR / mute / solo: one step each; the payload follows (mute = mute | ~solo); ↶ each', async () => {
  const n0 = hsteps();
  K().press(ID.t, { k: 'pat', p: 1 }, 'Pattern B'); await settle();
  assert.deepEqual([K().state(ID.t).pattern, hsteps() - n0], [1, 1]);
  K().press(ID.t, { k: 'len', n: 12 }, 'Length 12'); await settle();
  K().press(ID.t, { k: 'swing', v: 62 }, 'Swing 62 %'); await settle();
  assert.deepEqual([K().state(ID.t).len, K().state(ID.t).swing, hsteps() - n0], [12, 62, 3]);
  K().press(ID.t, { k: 'mute', lane: 2 }, 'Mute Clap'); await settle();
  assert.equal(sent(T(), 'seq').at(-1).s.mute, 4, 'the clap muted in the payload');
  K().press(ID.t, { k: 'solo', lane: 0 }, 'Solo Kick'); await settle();
  assert.equal(sent(T(), 'seq').at(-1).s.mute, 0xFFFE | 4, 'soloed: every other voice out');
  for (let i = 0; i < 5; i++) cv.undo();
  sim.raf(); await settle();
  assert.deepEqual([K().state(ID.t).pattern, K().state(ID.t).len, K().state(ID.t).swing, D().x.mute, D().x.solo, hsteps() - n0], [0, 16, 50, 0, 0, 0], 'all undone');
  assert.equal(sent(T(), 'seq').at(-1).s.mute, 0);
});

test('R1-2 a kit gesture that changes nothing keeps the redo stack: ↶ a cell, then CLEAR on the empty pattern / a cell set to the velocity it has / Reset sound on an untouched voice → no step, ↷ still brings the cell back', async () => {
  api.selectTrack(ID.t); sim.raf(); await settle();
  const c0 = cellsOf();
  K().press(ID.t, { k: 'clear' }, 'Clear pattern A'); K().cell(ID.t, 1, 3, 100); await settle();
  cv.undo(); sim.raf(); await settle();
  const n0 = hsteps(), r0 = cv.hist.r.length;
  assert.deepEqual([cellsOf(), r0 > 0], ['', true], 'pattern A empty, a redo held');
  assert.equal(K().press(ID.t, { k: 'clear' }, 'Clear pattern A'), false, 'CLEAR on an empty pattern: nothing');
  K().cell(ID.t, 12, 0, 100); await settle(); // (an empty slot's row: refused)
  cv.menu('i1/kb').find(it => it.label === 'Reset sound').action(); await settle(); // (the Snare at its type's defaults already)
  assert.deepEqual([hsteps() - n0, cv.hist.r.length], [0, r0], 'no step, the redo stack kept');
  cv.redo(); sim.raf(); await settle();
  assert.equal(cellsOf(), '1@3:100', '↷ the cell');
  cv.undo(); cv.undo(); sim.raf(); await settle();
  assert.equal(cellsOf(), c0);
});

test('§1.2 "+ ADD DRUM" (a Tom) and Remove: one step each — the rows, the names, the modules, the roll\'s rows, the Ducker\'s NOTE menu and a new Pads module follow; ↶ restores the voice exactly (kitBack)', async () => {
  const t = T(), n0 = hsteps(), v0 = JSON.stringify(I().vals), d0 = JSON.stringify(D());
  assert.equal(K().voice(ID.t, 'add', 5), true); await settle(3);
  const S = K().state(ID.t), tom = S.voices.find(v => v.slot === 8);
  assert.deepEqual([hsteps() - n0, cv.hist.u.at(-1).label, vox(), tom.type, tom.name, tom.note], [1, 'Add Tom', '0,1,2,3,4,5,6,7,8', 5, 'Tom', 41], 'slot 9 a Tom on its first free note');
  assert.equal(V().modules.has('i1/ki'), true, 'its module');
  assert.equal(drumRowsOf(I()).map(r => r.n + ':' + r.name).join(','), KC.rows(D()).map(r => r.n + ':' + r.name).join(','), 'the roll\'s rows: the record\'s names');
  assert.equal(drumRowsOf(I()).some(r => r.name === 'Tom' && r.n === 41), true);
  const duck = globalThis.__synthTest.sc.sources(null).notes(ID.t); // (the master's Ducker: the source menu's notes of the kit track)
  assert.equal(duck.map(r => r.name).join(','), 'Kick,Snare,Clap,Closed hat,Open hat,Low tom,High tom,Rim,Tom', 'the Ducker\'s NOTE menu names the kit\'s drums');
  const pads = cvPads.defaultsOf(T(), cv.drumOf), drums = pads.pads.filter(p => p && p.t && p.t[0] && p.t[0].k === 'drum').map(p => p.t[0].s);
  assert.deepEqual([drums.length, drums.includes('ki'), PC.soundName('ki', 'kit', D())], [9, true, 'Tom'], 'a new Pads module: the nine present voices');
  cv.undo(); sim.raf(); await settle(3);
  assert.deepEqual([vox(), JSON.stringify(I().vals) === v0, JSON.stringify(D()) === d0, V().modules.has('i1/ki')], ['0,1,2,3,4,5,6,7', true, true, false], '↶: the vals (kitBack) and the record exactly');
  cv.redo(); sim.raf(); await settle(3);
  assert.equal(vox(), '0,1,2,3,4,5,6,7,8', '↷');
  cv.undo(); sim.raf(); await settle(3);
  // Remove the clap (its cells in two patterns go, its note freed); ↶ brings it back whole
  K().cell(ID.t, 2, 4, 100); K().press(ID.t, { k: 'pat', p: 3 }, 'Pattern D'); K().cell(ID.t, 2, 6, 64); K().press(ID.t, { k: 'pat', p: 0 }, 'Pattern A'); await settle();
  const n1 = hsteps(), d1 = JSON.stringify(D());
  assert.equal(K().voice(ID.t, 'remove', 2), true); await settle(3);
  assert.deepEqual([hsteps() - n1, vox(), D().map.kc.length, D().pat[0].cells.some(c => c.l === 2), D().pat[3].cells.length, V().modules.has('i1/kc')], [1, '0,1,3,4,5,6,7', 0, false, 0, false]);
  cv.undo(); sim.raf(); await settle(3);
  assert.deepEqual([vox(), JSON.stringify(D()) === d1, V().modules.has('i1/kc')], ['0,1,2,3,4,5,6,7', true, true], '↶ the clap whole');
  // the voice's ⋯ Remove and the Sequencer's ⋯ (Clear all patterns)
  assert.equal(cv.menu('i1/kc').some(it => it.label === 'Remove'), true);
  assert.equal(cv.menu('i1').some(it => it.label === 'Clear all patterns'), true);
  const n2 = hsteps();
  cv.menu('i1').find(it => it.label === 'Clear all patterns').action(); await settle();
  assert.deepEqual([hsteps() - n2, D().pat.every(p => !p.cells.length)], [1, true], 'Clear all: one step');
  cv.undo(); sim.raf(); await settle(2);
});

test('R1-1 the canvas Delete key over 2 / 3 voices: ONE step "Delete n modules" whose meta is kitBack\'s (kit, every field, the preset pair); ↶ every voice back — the record, the TYPEs, the modules', async () => {
  api.selectTrack(ID.t); sim.raf(); await settle(2);
  sh.openTab('canvas'); await settle(2);
  K().press(ID.t, { k: 'paint', lane: 1, steps: [4, 12], v: 100 }, 'Edit pattern'); K().press(ID.t, { k: 'paint', lane: 2, steps: [4, 12], v: 90 }, 'Edit pattern'); await settle(2);
  const d0 = JSON.stringify(D()), v0 = JSON.stringify(I().vals), Wd = cv.world();
  for (const ks of [['i1/kb', 'i1/kc'], ['i1/kb', 'i1/kc', 'i1/kd']]) {
    const n0 = hsteps(), p0 = I().preset == null ? null : I().preset;
    Wd.selection = ks.slice(); Wd.selected = ks.at(-1);
    sim.key('Delete', true, { key: 'Delete', preventDefault() {} }); sim.key('Delete', false, { key: 'Delete' }); await settle(3);
    const m = cv.hist.u.at(-1).meta || {};
    assert.deepEqual([hsteps() - n0, cv.hist.u.at(-1).label, ks.some(k => V().modules.has(k)), m.kit, Array.isArray(m.f) && m.f.length, JSON.stringify(m.p), m.parts === undefined], [1, 'Delete ' + ks.length + ' modules', false, 1, ks.length, JSON.stringify([p0, null]), true], 'one folded step, kitBack\'s meta');
    cv.undo(); sim.raf(); await settle(3);
    assert.deepEqual([JSON.stringify(D()) === d0, JSON.stringify(I().vals) === v0, ks.every(k => V().modules.has(k)), vox()], [true, true, true, '0,1,2,3,4,5,6,7'], '↶ ' + ks.length + ': every voice back');
  }
  delete Wd.selection; Wd.selected = null;
  K().press(ID.t, { k: 'clear' }, 'Clear pattern A'); await settle();
});

test('§1.2 TYPE ▾: the Kick becomes a Snare — TUNE, DECAY, k1–k4 the Snare\'s defaults, LEVEL and CHOKE kept, the automatic name follows; one step, ↶ the Kick exactly', async () => {
  const n0 = hsteps(), v0 = JSON.stringify(I().vals);
  K().knob(ID.t, 'kal', 6, 'end'); K().knob(ID.t, 'kac', 2, 'end'); await settle();
  const v1 = JSON.stringify(I().vals);
  assert.equal(K().voice(ID.t, 'type', 0, 2), true); await settle(3);
  const v = I().vals, Tn = KIT.TYPES[2];
  assert.deepEqual([hsteps() - n0, v.kat, v.kau, v.kad, v.kal, v.kac, v.ka1], [1, 2, Math.round(Tn.u.def * 1000) / 100, Math.round(Tn.d.def * 1000) / 100, 6, 2, Math.round(Tn.k[0].def * 1000) / 100]);
  assert.deepEqual(K().state(ID.t).voices.slice(0, 2).map(x => x.name).join(','), 'Snare,Snare 2', 'the automatic names');
  cv.undo(); sim.raf(); await settle(3);
  assert.deepEqual([JSON.stringify(I().vals) === v1, D().ty[0]], [true, 1], '↶: the Kick, its LEVEL / CHOKE turns kept');
  K().knob(ID.t, 'kal', KIT.KITS[0].v.kal, 'end'); K().knob(ID.t, 'kac', 0, 'end'); await settle();
  assert.equal(JSON.stringify(I().vals) === v0, true);
});

test('§5.7 KIT ▾ a kit load: one step, the voices and sounds the kit\'s, the patterns kept, its name on KIT ▾; ↶ the vals back; the kit tile on a kit canvas: the Starter as a preset (patterns kept, no Replace)', async () => {
  K().cell(ID.t, 0, 4, 100); await settle();
  const n0 = hsteps(), c0 = cellsOf(), v0 = JSON.stringify(I().vals);
  assert.equal(K().load(ID.t, 'Deep'), true); await settle(3);
  const deep = KIT.KITS.find(k => k.name === 'Deep');
  assert.deepEqual([hsteps() - n0, cv.hist.u.at(-1).label, KIT.IDS.every(id => I().vals[id] === deep.v[id]), cellsOf(), I().preset], [1, 'Load kit Deep', true, c0, 'Deep']);
  cv.undo(); sim.raf(); await settle(3);
  assert.deepEqual([JSON.stringify(I().vals) === v0, cellsOf()], [true, c0], '↶ the Starter\'s vals');
  K().load(ID.t, 'Tight'); await settle(2);
  const n1 = hsteps();
  sh.srcPick('kit', 'replace'); await settle(3);
  assert.deepEqual([I().model, hsteps() - n1, KIT.IDS.every(id => I().vals[id] === KIT.KITS[0].v[id]), cellsOf()], ['kit', 1, true, c0], 'the Starter loaded, the pattern kept');
  assert.equal(note(), 'Loaded the Starter kit · tap to undo', 'not a Replace');
});

test('§1.2 the voice tiles: on the kit canvas a tap adds that voice (first empty slot); on a Juno canvas a kit with the Sequencer + that voice and an empty pattern A (a Replace); on the track list a new kit track with it', async () => {
  api.selectTrack(ID.t); sim.raf(); await settle();
  tiles().setView('drums'); await settle();
  assert.deepEqual(tiles().kitTiles().map(b => b.getAttribute('data-kit')).join(','), 'kick,snare,hat,clap,tom,perc');
  const n0 = hsteps();
  await kitTap('perc');
  assert.deepEqual([vox(), D().ty[8], hsteps() - n0], ['0,1,2,3,4,5,6,7,8', 6, 1], 'a Perc added');
  cv.undo(); sim.raf(); await settle(2);
  const j = await fresh('juno60');
  await kitTap('clap');
  assert.deepEqual([I().model, vox(), D().ty[0], D().pat.every(p => !p.cells.length), note()], ['kit', '0', 4, true, 'Replaced Juno-60 with ' + NAME + ' · tap to undo'], 'a kit holding the clap');
  assert.equal(keys(), ['fx1', 'i1', 'i1/ka', 'out'].sort().join(','));
  const nt = P().tracks.length;
  K().drag.drop('tom', { over: 'tracks' }); await settle(3);
  assert.deepEqual([P().tracks.length - nt, I().model, vox(), D().ty[0]], [1, 'kit', '0', 5], 'the track list: a new kit track with the tom');
  api.deleteTrack(T()); sim.raf(); await settle();
  api.deleteTrack(byId(j.id)); sim.raf(); await settle();
  api.selectTrack(ID.t); sim.raf(); await settle();
});

test('§1.2 sixteen voices the most: the 17th refused with KIT_FULL\'s words (no step); the voice tiles greyed by setKitFull; a removed voice frees them', async () => {
  api.selectTrack(ID.t); sim.raf(); await settle();
  const n0 = hsteps();
  for (let i = 0; i < 8; i++) K().voice(ID.t, 'add', 1 + (i % 6));
  await settle(3);
  assert.deepEqual([vox().split(',').length, hsteps() - n0, V().modules.has('i1/kp')], [16, 8, true]);
  const n1 = hsteps();
  assert.equal(K().voice(ID.t, 'add', 2), false);
  await settle();
  assert.deepEqual([hsteps(), note()], [n1, KIT_FULL], 'refused, said');
  assert.equal(tiles().kitPlaced('kick'), KIT_FULL, 'the tiles greyed');
  await kitTap('snare');
  assert.deepEqual([hsteps(), vox().split(',').length], [n1, 16], 'a greyed tile adds nothing');
  K().voice(ID.t, 'remove', 15); await settle(2);
  assert.equal(tiles().kitPlaced('kick'), null, 'a slot free: available again');
  assert.equal(K().heavy().kind, 'kit', 'heavyOf: the kit\'s kind (PT_HEAVY\'s line)');
  for (let i = 0; i < 9; i++) cv.undo(); // (the Remove, the eight adds)
  sim.raf(); await settle(3);
  assert.equal(vox(), '0,1,2,3,4,5,6,7');
});

test('§10 a modulation drag onto a kit knob is refused with NOMOD_KIT\'s words (no row, no step)', async () => {
  X.add('lfo', null); await settle(2);
  const n0 = hsteps(), r0 = (T().mods || []).length;
  const c = X.can('l1.out', 'i1:kau');
  assert.deepEqual([c.ok, c.why], [false, NOMOD_KIT]);
  X.connect('l1.out', 'i1:kau'); await settle();
  assert.deepEqual([note(), (T().mods || []).length, hsteps()], [NOMOD_KIT, r0, n0]);
  cv.undo(); sim.raf(); await settle(2); // (the LFO)
});

test('IMPL-LC §6.7: a Combiner\'s Marks menu lists the kit\'s drums by name; a mark on the kick reads its pattern\'s hits (swing included)', async () => {
  api.selectTrack(ID.t); sim.raf(); await settle();
  K().press(ID.t, { k: 'paint', lane: 0, steps: [0, 4, 8, 12], v: 100 }, 'Edit pattern'); await settle();
  const other = await fresh('juno60');
  X.add('comb', null); await settle(2);
  const key = Object.keys(T().dev).find(k => T().dev[k].kind === 'comb'), o = X.comb(key);
  const nm = byId(ID.t).name, L = o.markList().filter(e => e.value && e.value.t === ID.t).map(e => e.label);
  assert.equal(L.join('|'), [nm, ...['Kick', 'Snare', 'Clap', 'Closed hat', 'Open hat', 'Low tom', 'High tom', 'Rim'].map(x => nm + ' · ' + x)].join('|'));
  T().dev[key].mark = { t: ID.t, n: 36 };
  assert.equal(o.marks(0, BAR).join(','), '0,960,1920,2880', 'the kick\'s four hits');
  api.deleteTrack(other); sim.raf(); await settle();
  api.selectTrack(ID.t); sim.raf(); await settle();
});

test('play: the plan as DrSeq clocks it — every step posted at its tick\'s frame, the session at the heard post (200 ms behind render), the Sequencer\'s playhead the heard step; stopped: nothing', async () => {
  api.selectTrack(ID.t); sim.raf(); await settle();
  K().press(ID.t, { k: 'clear' }, 'Clear pattern A'); await settle();
  for (const c of GROOVE.cells) K().cell(ID.t, c.l, c.s, c.v);
  await settle();
  assert.equal(D().pat[0].cells.length, GROOVE.cells.length);
  const t = T();
  api.transport().pos = 0;
  node(t).got.length = 0;
  K().play(); await sim.settle(5);
  const Tr = api.transport(), fr = tick => Tr.a.frame + (tick - Tr.a.tick) * Tr.a.fpt;
  assert.equal(Tr.playing, true);
  for (let i = 0; i < 8; i++) { sim.run(Math.round(BAR / 4 * Tr.a.fpt)); sim.raf(); }
  await sim.settle(2); sim.raf(); await settle(2);
  const posts = got(t, 'step').filter(q => q.F < fr(2 * BAR));
  assert.equal(posts.length, 32, 'two measures of steps');
  posts.forEach((q, i) => { const dF = q.F - fr(i * 240); assert.ok(dF >= -1e-6 && dF < 8, 'post ' + i + ' at its tick (+' + dF.toFixed(2) + ')'); });
  const S = K().state(ID.t), heard = sim.ctx().frames - api.outLatency() * sim.ctx().sampleRate, all = got(t, 'step');
  const last = all.filter(q => q.F <= heard + sim.ctx().sampleRate / 60).at(-1);
  assert.deepEqual([S.playing, S.step, all.at(-1).F > heard], [true, last.s, true], 'the heard step shown, the newest still ahead of the ear');
  K().stop(); await settle(3);
  assert.deepEqual([K().state(ID.t).playing, K().state(ID.t).step], [false, -1]);
});

test('§5.8 the bounce: the offline payload = the live one (one pk), and the kit sounds in the render', async () => {
  const t = T(), dev = CMOD.primId(t);
  assert.equal(cv.drumPayload(t, dev, true).pk, cv.drumPayload(t, dev).pk, 'offline ≡ live');
  assert.equal(sent(t, 'seq').at(-1).s.pk, cv.drumPayload(t, dev).pk, 'what the machine holds');
  Object.assign(P().loop, { start: 0, end: BAR, on: true });
  for (const [k, x] of [['#bRange', 'loop'], ['#bSr', '48000'], ['#bBits', '24'], ['#bTail', '0'], ['#bOs', '4']]) sim.$(k).value = x;
  sim.$('#bNorm').checked = false;
  sim.lastOffline = null;
  await sim.$('#bGo').onclick();
  for (let i = 0; i < 40 && !sim.lastOffline; i++) await sim.settle(5);
  const off = sim.lastOffline && sim.lastOffline.nodes.find(n => n.po && n.po.trackId === ID.t);
  assert.equal(!!off && !!off.po.seq, true, 'the kit\'s node in the bounce, with its payload');
  assert.equal(off.po.seq.pk, cv.drumPayload(t, dev).pk, 'the same payload');
  let pk = 0;
  for (const x of sim.lastOffline.L) pk = Math.max(pk, Math.abs(x));
  assert.ok(pk > 0.05, 'the kit is heard in the bounce (peak ' + pk.toFixed(3) + ')');
  P().loop.on = false;
});

test('§5.6 save → load (schema 18): the record, the vals and every iN/k* place survive; a record whose ty disagrees with the vals is reconciled (the vals win); toV1 lists the kit as lost (its notes kept)', async () => {
  const t = T();
  t.lay = Object.assign({}, t.lay, { 'i1/kb': { x: 900, y: 1400 } });
  const json = JSON.stringify(P()), p2 = cv.loadProject(json), t2 = p2.tracks.find(x => x.id === ID.t);
  assert.deepEqual([p2.schema, CM.SCHEMA], [19, 19]); // ((AUTO) 19 since the curves)
  assert.equal(JSON.stringify(cv.drumOf(t2, 'i1')), JSON.stringify(D(t)), 'the record');
  assert.deepEqual([t2.lay['i1/kb'].x, t2.lay['i1/kb'].y], [900, 1400], 'a voice\'s place');
  const o = JSON.parse(json), r = o.tracks.find(x => x.id === ID.t);
  r.dev.i1.drum.ty = r.dev.i1.drum.ty.map(() => 0);
  const t3 = cv.loadProject(JSON.stringify(o)).tracks.find(x => x.id === ID.t);
  assert.equal(cv.drumOf(t3, 'i1').ty.join(), KC.typesOf(t3.dev.i1.vals).join(), 'reconciled: ty = the vals\' TYPEs');
  const v1 = CM.toV1(JSON.parse(await cv.projectFile()));
  assert.equal((v1.lost || []).some(x => x.includes(t.name)), true, 'toV1: the kit track listed');
});

test('another track\'s bytes untouched: a Juno and an 808 beside a kit being edited post nothing new; their payloads equal', async () => {
  const j = await fresh('juno60'), m = await fresh('tr808');
  const strip = o => { const c = Object.assign({}, o); delete c.serumT; delete c.seqT; delete c.fxrT; return JSON.stringify(c); }, bj = strip(api.buildPatch(j)), b8 = strip(api.buildPatch(m)), jp = sent(j, 'patch').length, mp = sent(m, 'patch').length, ms = sent(m, 'seq').length, pk8 = cv.drumPayload(m, CMOD.primId(m)).pk, js = JSON.stringify(j.dev), m8 = JSON.stringify(m.dev);
  api.selectTrack(ID.t); sim.raf(); await settle();
  K().cell(ID.t, 1, 3, 100); K().voice(ID.t, 'add', 3); K().knob(ID.t, 'kbu', 3, 'end'); K().load(ID.t, 'Crunch'); await settle(3);
  assert.deepEqual([sent(byId(j.id), 'patch').length - jp, sent(byId(m.id), 'patch').length - mp, sent(byId(m.id), 'seq').length - ms], [0, 0, 0], 'nothing posted to them');
  cv.undo(); cv.undo(); cv.undo(); sim.raf(); await settle(3);
  // (any ↶ re-sends every track's patch — the app's restore, not the kit's: the bytes are what the node was built with)
  assert.deepEqual([sent(byId(j.id), 'patch').slice(jp).every(x => strip(x.p) === bj), sent(byId(m.id), 'patch').slice(mp).every(x => strip(x.p) === b8), sent(byId(m.id), 'seq').length - ms], [true, true, 0], 'the restores: their own patches byte for byte, no payload');
  assert.deepEqual([JSON.stringify(byId(j.id).dev) === js, JSON.stringify(byId(m.id).dev) === m8, cv.drumPayload(byId(m.id), 'i1').pk === pk8], [true, true, true]);
  api.deleteTrack(byId(j.id)); api.deleteTrack(byId(m.id)); sim.raf(); await settle();
});

test('§6.1 __synthTest.cv.kit: add (a new kit track, the tile\'s action), state, cellRect (world px of a cell on the Sequencer)', async () => {
  const off = errOn();
  try {
    const n = P().tracks.length, id = K().add(null);
    await settle(4);
    assert.deepEqual([P().tracks.length - n, byId(id).dev.i1.model, T().id === id, cellsOf()], [1, 'kit', true, '']);
    const q = V().modules.get('i1'), r = K().cellRect(id, 0, 4), r2 = K().cellRect(id, 1, 4), W = cv.world(), c0 = W.toClient(q.x, q.y);
    assert.deepEqual([W.cam.k, Math.round(c0.x), Math.round(c0.y)], [1, BAND.left + 24, BAND.top + 24], '§4.5 the first view: the Sequencer at 100 % (its 1248 px fit the band), its top-left framed');
    assert.deepEqual([r.w, r.h, r.x - q.x, r2.y - r.y], [64, 48, 16 + (2 + 4) * 64, 48], 'one cell of step 5, kick row; the snare row under it');
    assert.equal(K().cellRect(id, 12, 0), null, 'an empty slot: no cell');
    api.deleteTrack(byId(id)); sim.raf(); await settle();
  } finally { off(); }
  assert.deepEqual(ERR, []);
});
