import './v8-guard.mjs';
// Milestone 3 lane D (docs/canvas/IMPL-3.md §2.1–2.7, §7 "UI") in the page simulation: a Serum taken apart on the canvas.
// Show parts / Bundle are one History step each (lay only: vals.s and fx byte-identical, N2) and they, their undo and redo
// keep the Serum's one host (its panel undo); the part modules follow the state (I1 / I2) — a preset load adds modules,
// a part off dims; add / remove a part (a tile on a Serum, a bundled Serum, a classic track) with the ⏻ written back on
// undo / redo; the cable drag resolver's three destinations (an internal cable through sx-edges, a mod-out onto a knob, a
// refusal); an internal cable edit then Cmd-Z undoes the cable, not an earlier Show parts; the Mod list in parts view lists
// every matrix row; a row into a part with no module ends at VOICE with its tag; link rows from the parts' jacks; the slot
// hosts' gestures (one step, rollback, N.modsHold, mval, menu edits, view edits); the bar ⏻ is an x.on cable end; the
// modulator column grows leftwards (modX / modW); the track-level ModCore meters and mcx; D-R5's pref.
// The real Serum panels (serum-ui / sx-host / sx-ui-mod) in main-sim's DOM stub; the FX rack a stand-in. The world is
// canvas-sim's scripted one. Accessor-free (instruments read as devices). One boot per file; strings, numbers and booleans
// only into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/canvas-3-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as C from '../serum-core.js?v=9';
import * as SE from '../sx-edges.js?v=9';
import * as CMOD from '../cv-model.js?v=9';
import * as CVM from '../cv-module.js?v=9';
import { MODELS } from '../models.js?v=9';

// every DSP global wk.loadDSP waits for, defined (null): a host's load resolves at once — a pending one would hold each
// destroyed host for wk.js's give-up timer (the fixture check's lesson)
for (const g of ['SxBase', 'SxFilt2', 'SxWarp', 'SxMod', 'SxSample', 'SxGran', 'SxSpec', 'SxSeq', 'SerumDSP', 'FXMods2', 'FXDSP', 'Dr808', 'DrSeq', 'ModCore', 'PatchDSP', 'PatchMoog']) globalThis[g] = null;
const VP = { left: 0, top: 48 }, BAND = { left: 44, top: 48, right: 1520, bottom: 700 };
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
const sim = await bootMain({ ls: fakeStorage({}), hash: '#serum', synthTest: { cvWorld: root => scriptedWorld(root) } });
{ // (the panels' graph editors animate through wk.ticker, which asks getClientRects: the stub DOM's elements answer one box;
  // a SerumUI finds its document as its root's ownerDocument; a view switch takes elements out of the tree — remove(), a
  // cleared textContent and a move into another parent detach them here as in a browser, else a destroyed view's controls
  // would still answer the modules' knob-end walks)
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
  D0.querySelector('.scope').getClientRects = () => [{}]; // (the stub's one shared '.scope' element, which a module's body holds: a box too, for the painted count)
}
const api = sim.api, cv = globalThis.__synthTest.cv, acc = globalThis.__synthTest.acc, sh = globalThis.__synthTest.shell, M = cv.mod, PT = cv.parts;
// the real Serum panels (the page's own modules); a stand-in FX rack (its UI is not under test here)
class FXStub { constructor(box) { this.el = globalThis.document.createElement('div'); box.append(this.el); } refresh() {} destroy() {} paintMods() {} setLive() {} }
acc.uiLoad(Promise.resolve({ sx: await import('../serum-ui.js?v=9'), fxui: { FXRackUI: FXStub }, wk: await import('../wk.js?v=9'), mod: await import('../sx-ui-mod.js?v=9') }));
await sim.power(); sim.raf();
cv.renderViews(); await sim.settle(10); sim.raf(); await sim.settle(5); sim.raf();

const P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack), V = () => cv.view();
const I = t => CMOD.instOf(t);
const keys = () => [...V().modules.keys()].sort().join(',');
const partKeys = (dev = 'i1') => [...V().modules.keys()].filter(k => k.startsWith(dev + '/') && k !== dev + '/fx').sort().join(',');
const hsteps = () => cv.hist.u.length;
const note = () => sim.$('#notice').textContent;
const MOD = id => MODELS.find(m => m.id === id);
const state = (t = T(), dev = 'i1') => JSON.stringify({ s: Object.assign({}, t.dev[dev].vals.s, { ui: undefined }), fx: t.dev[dev].fx });
const rec = (dev = 'i1') => cv.sxRec(T(), dev);
const host = (dev = 'i1') => rec(dev).ui;
const settle = async () => { sim.raf(); await sim.settle(5); sim.raf(); };
const walk = (n, f, out = []) => { for (const c of n.children || []) { if (f(c)) out.push(c); walk(c, f, out); } return out; };
const base = (id, t = T(), dev = 'i1') => C.destBase(t.dev[dev].vals.s, null, id);
const ID = {};
const uiOf = (dev = 'i1', t = T()) => ((t.lay || {})[dev] || {}).ui;

test('boot: the Serum is up as the whole panel (a real SerumUI host in its module); D-R5\'s shipped default is the whole panel', () => {
  assert.equal(I(T()).model, 'serum');
  assert.deepEqual([!!host(), host().bundled, rec().mode, PT.isParts('i1'), PT.VIEW_DEFAULT, PT.newView()], [true, true, 'bundled', false, 'bundled', 'bundled']);
  assert.equal(keys(), 'i1,i1/fx,out');
  ID.a = T().id;
});

test('the sim\'s null DSP globals cover main.js\'s whole DSP list (IMPL-9 §3.7\'s two scripts too): the page\'s load of it resolves at once — no 20 s give-up wait, no "could not load"', async () => {
  const wk = await import('../wk.js?v=9');
  const list = /const DSP_FILES = \[([^\]]*)\]/.exec(readFileSync(new URL('../main.js', import.meta.url), 'utf8'))[1].match(/'[^']+'/g).map(x => x.slice(1, -1) + '?v=9');
  let tm;
  const r = await Promise.race([wk.loadDSP(list), new Promise(res => { tm = setTimeout(() => res('waited'), 1500); })]);
  clearTimeout(tm);
  assert.notEqual(r, 'waited', 'a script with no defined global is injected and never loads in this DOM: the load waits for its give-up timer');
  assert.deepEqual([list.length, Object.keys(r).length, Object.values(r).every(v => v === null)], [16, 16, true]);
});

test('Show parts / Bundle: one History step each, lay only (vals.s and fx byte-identical, N2); the host — its panel undo — survives both, their undo and their redo', async () => {
  const t = T(), H0 = host(), s0 = state(), n0 = hsteps();
  H0.edit(s => { s.p['f.res'] = 0.31; }, { label: 'RES' }); sim.raf(); // (a panel edit: the host's own undo step)
  assert.equal(H0.undo.canUndo(), true);
  const s1 = state();
  assert.notEqual(s1, s0);
  assert.equal(PT.show('i1'), true);
  await settle();
  assert.deepEqual([hsteps(), cv.hist.undoLabel, uiOf(), host() === H0, rec().mode, H0.bundled, H0.undo.canUndo(), state() === s1], [n0 + 1, 'Show parts', 'parts', true, 'parts', false, true, true]);
  assert.deepEqual([partKeys(), V().modules.has('i1/fx'), base('a.on') >= 0.5, base('f.on') >= 0.5], ['i1/oscA', true, true, false], 'VOICE (i1), OSC A and the own FX: the default Serum\'s parts that are on (FILTER 1 is off there)');
  assert.deepEqual([...rec().views.keys()].sort().join(','), 'i1,i1/oscA', 'each module\'s panel is a view of the one host');
  ID.lay1 = JSON.stringify(T().lay);
  assert.equal(PT.show('i1', false), true);
  await settle();
  assert.deepEqual([cv.hist.undoLabel, uiOf(), host() === H0, rec().mode, H0.bundled, state() === s1, partKeys()], ['Bundle', undefined, true, 'bundled', true, true, '']);
  cv.undo(); await settle();
  assert.deepEqual([uiOf(), host() === H0, rec().mode, partKeys(), state() === s1], ['parts', true, 'parts', 'i1/oscA', true], 'undo of Bundle: parts again, the same host');
  cv.undo(); await settle();
  assert.deepEqual([uiOf(), host() === H0, rec().mode, state() === s1], [undefined, true, 'bundled', true], 'undo of Show parts');
  cv.redo(); await settle();
  assert.deepEqual([uiOf(), host() === H0, rec().mode, JSON.stringify(T().lay) === ID.lay1], ['parts', true, 'parts', true], 'redo: the stored places');
  // the panel undo survived every switch: it still undoes the RES edit
  H0.undoRedo(false); sim.raf();
  assert.equal(+base('f.res').toFixed(4) !== 0.31, true);
  H0.undoRedo(true); sim.raf();
  assert.equal(+base('f.res').toFixed(2), 0.31);
  assert.equal(state(), s1, 'N2 after the round trips');
  assert.equal(t.id, T().id);
});

test('the part modules follow the state (I1 / I2): a preset load adds the parts it turns on — placed, no History step —; a part switched off in its panel dims (its bar\'s ⏻ is the panel\'s own toggle: a data-dest="x.on" control, a cable end)', async () => {
  assert.equal(uiOf(), 'parts');
  const n0 = hsteps();
  assert.equal(api.sxLoad(cv.view1e('i1'), 'f:Sub Foundation'), true);
  await settle();
  assert.deepEqual([partKeys(), hsteps()], ['i1/env2,i1/filter,i1/macros,i1/oscA,i1/oscB,i1/oscC', n0], 'OSC A–C and FILTER 1 are on in that preset (I1), its rows read ENV 2 and the macros (I2): modules, no step');
  for (const k of ['i1/oscB', 'i1/oscC', 'i1/filter', 'i1/env2', 'i1/macros']) assert.equal(!!(T().lay[k] && Number.isFinite(T().lay[k].x)), true, k + ' laid out');
  const m = V().modules.get('i1/oscC'), pw = walk(m.bar, c => !!c.attrs && c.attrs['data-dest'] === 'c.on');
  assert.deepEqual([pw.length, m.el.hasAttribute('data-off')], [1, false], 'the bar holds OSC C\'s own power toggle');
  const q = V().destPort('i1', 'c.on');
  assert.deepEqual([!!q, !!(q && q.hid)], [true, false], 'the bar ⏻ is the c.on cable end');
  host().edit(s => { s.p['c.on'] = 0; }, { label: 'OSC C on' }); await settle(); // (its ⏻ pressed in the panel: the Serum's own undo)
  assert.deepEqual([partKeys().includes('i1/oscC'), V().modules.get('i1/oscC').el.hasAttribute('data-off'), hsteps()], [true, true, n0], 'laid out: stays, dimmed');
});

test('add / remove a part: one step each with the ⏻ written back on undo / redo; full → the count, no step; an own LFO something reads is not removable', async () => {
  const n0 = hsteps();
  assert.equal(base('c.on'), 0);
  assert.equal(PT.add('i1', 'osc'), 'oscC', 'the first free oscillator: C (off, laid out)');
  await settle();
  assert.deepEqual([base('c.on'), hsteps(), cv.hist.undoLabel, V().modules.get('i1/oscC').el.hasAttribute('data-off')], [1, n0 + 1, 'Add OSC C', false]);
  assert.deepEqual(cv.hist.u[cv.hist.u.length - 1].meta, { trackId: T().id, dev: 'i1', part: 'oscC', on: [0, 1], f: [[['p', 'c.on'], 0, 1]] });
  cv.undo(); await settle();
  assert.deepEqual([base('c.on'), partKeys().includes('i1/oscC')], [0, true], 'undo: off again (its place stays: it was laid out before)');
  cv.redo(); await settle();
  assert.equal(base('c.on'), 1);
  const n1 = hsteps();
  assert.equal(PT.add('i1', 'osc'), null);
  assert.deepEqual([note(), hsteps()], ['This Serum already has 3 oscillators', n1], 'Q3: a 4th oscillator is refused with the count');
  assert.equal(PT.remove('i1/oscC'), true);
  await settle();
  assert.deepEqual([base('c.on'), partKeys().includes('i1/oscC'), cv.hist.undoLabel], [0, false, 'Remove OSC C']);
  cv.undo(); await settle();
  assert.deepEqual([base('c.on'), partKeys().includes('i1/oscC')], [1, true], 'undo of Remove: on, its module back');
  // an own LFO a matrix row reads (I2): a module; Remove refuses with the count
  host().addModUI('lfo2', 'a.level'); await settle();
  assert.equal(partKeys().includes('i1/lfo2'), true);
  const n2 = hsteps();
  assert.equal(PT.remove('i1/lfo2'), false);
  assert.deepEqual([/LFO 2 modulates 1 knob/.test(note()), hsteps(), partKeys().includes('i1/lfo2')], [true, n2, true]);
});

test('Sources tray: a part tile on a parts Serum (its first free slot), on a bundled Serum (it shows its parts first — the same step), on a classic track (the offer, then Replace with Serum: one step, undone at once)', async () => {
  let n = hsteps();
  PT.pick('filter'); await settle();
  assert.deepEqual([base('f2.on'), hsteps(), cv.hist.undoLabel, partKeys().includes('i1/filter2')], [1, n + 1, 'Add FILTER 2', true]);
  assert.equal(PT.show('i1', false), true); await settle();
  n = hsteps();
  PT.pick('noise'); await settle();
  assert.deepEqual([uiOf(), base('n.on'), hsteps(), cv.hist.undoLabel, partKeys().includes('i1/noise'), rec().mode], ['parts', 1, n + 1, 'Add NOISE', true, 'parts'], 'a bundled Serum: parts first, in the same step');
  cv.undo(); await settle();
  assert.deepEqual([uiOf(), base('n.on'), rec().mode], [undefined, 0, 'bundled'], 'one undo: the part and the view');
  cv.redo(); await settle();
  // greyed tiles (Q3): every oscillator on
  M.decor();
  const tiles = sh.shell.tiles;
  assert.deepEqual([tiles.partTile('osc').getAttribute('aria-disabled'), tiles.partTile('osc').classList.contains('cv-placed'), tiles.partTile('sub').getAttribute('aria-disabled')], ['true', true, null]);
  // a classic track: the offer, then its tap
  const j = api.addTrack(MOD('juno60')); sim.raf(); cv.renderViews(); await settle();
  ID.j = j.id;
  n = hsteps();
  PT.pick('osc');
  assert.deepEqual([note(), hsteps(), I(T()).model], ['Serum parts belong to a Serum · Replace with Serum', n, 'juno60']);
  sim.$('#notice').click(); await settle(); await settle();
  assert.deepEqual([I(T()).model, uiOf(), base('b.on'), hsteps(), cv.hist.undoLabel], ['serum', 'parts', 1, n + 1, 'Replace Juno-60 with Serum'], 'Serum in parts view, OSC B added: one step');
  assert.deepEqual(partKeys(), 'i1/oscA,i1/oscB');
  cv.undo(); await settle();
  assert.deepEqual([I(T()).model, uiOf()], ['juno60', undefined]);
});

test('the cable drag resolver (§2.5): an internal cable through sx-edges (one History step + meta), a mod-out onto a knob (a row), anything else refused with its reason; Cmd-Z after a canvas cable edit undoes the cable — not the earlier Show parts —, the fields written back; a panel edit since: they stay, said', async () => {
  api.selectTrack(ID.a); cv.renderViews(); await settle();
  assert.deepEqual([I(T()).model, uiOf(), rec().mode], ['serum', 'parts', 'parts']);
  PT.show('i1', false); await settle();
  PT.show('i1'); await settle();
  const n0 = hsteps(), O = M.opts;
  assert.equal(cv.hist.undoLabel, 'Show parts');
  assert.deepEqual([O.port('i1/oscB.out'), O.port('i1/filter2.in'), O.port('i1.main'), O.port('i1/oscB.warp')], ['i1/oscB.out', 'i1/filter2.in', 'i1.main', null], 'internal ends are ports (a warp input is not)');
  assert.deepEqual(O.canConnect('i1/oscB.out', 'i1/filter2.in'), { ok: true, why: '' });
  assert.deepEqual(O.canConnect('i1/oscB.out', 'out.in'), { ok: false, why: 'Serum sources play through their VOICE' }, 'a source → OUT: refused with its reason');
  assert.deepEqual(O.canConnect('i1/filter.out', 'i1/filter.in'), { ok: false, why: 'A filter cannot feed itself' });
  const route = () => SE.serumEdges(T().dev.i1.vals.s, T().dev.i1.fx).filter(e => e.a === 'oscB.out').map(e => e.b).sort().join();
  const F = () => [T().dev.i1.vals.s.osc[1].route, base('b.fbal'), base('f2.routeB')];
  const r0 = route(), f0 = F(), E = SE.setEdge(T().dev.i1.vals.s, T().dev.i1.fx, 'oscB.out', 'filter2.in');
  O.onConnect('i1/oscB.out', 'i1/filter2.in'); await settle();
  const f1 = F();
  assert.deepEqual([hsteps(), cv.hist.undoLabel, route().includes('filter2.in'), f1[0]], [n0 + 1, 'OSC B → FILTER 2', true, 0]);
  assert.deepEqual(cv.hist.u[cv.hist.u.length - 1].meta, { trackId: T().id, dev: 'i1', f: E.f }, 'the step\'s meta: sx-edges\' f as it stands');
  assert.equal(note(), 'OSC B → FILTER 2 · Undo');
  assert.equal(V().cables.list().some(c => c.int && c.a === 'i1/oscB.out' && c.b === 'i1/filter2.in'), true, 'drawn as an internal cable');
  // Cmd-Z with the focus on the canvas: History undoes the cable, the parts view stays
  sim.key('KeyZ', true, { key: 'z', metaKey: true }); await settle();
  assert.deepEqual([F(), route(), uiOf(), cv.hist.undoLabel], [f0, r0, 'parts', 'Show parts']);
  sim.key('KeyZ', true, { key: 'z', metaKey: true, shiftKey: true }); await settle();
  assert.deepEqual([F(), cv.hist.undoLabel], [f1, 'OSC B → FILTER 2'], 'redo: written again');
  // changed since (a panel edit of the balance): the undo leaves the fields as they are and says so
  host().edit(st => { st.p['b.fbal'] = 0.3; }, { label: 'BALANCE' }); await settle();
  cv.undo(); await settle();
  assert.deepEqual([T().dev.i1.vals.s.osc[1].route, +base('b.fbal').toFixed(2), /changed since/.test(note()), uiOf()], [0, 0.3, true, 'parts']);
  cv.redo(); await settle();
  // Disconnect on the cable (its × / menu): sx-edges cutEdge, one step
  host().edit(st => { st.p['b.fbal'] = 1; }, { label: 'BALANCE' }); await settle();
  const c = V().cables.list().find(x => x.int && x.a === 'i1/oscB.out' && x.b === 'i1/filter2.in');
  assert.equal(!!c, true);
  const n1 = hsteps();
  M.act(c.id, 'disconnect'); await settle();
  assert.deepEqual([hsteps(), /^Disconnect OSC B/.test(cv.hist.undoLabel), route().includes('filter2.in')], [n1 + 1, true, false]);
  // the third destination: a mod-out onto a knob (a row of track.mods, its own step)
  M.add('lfo'); await settle();
  const n2 = hsteps();
  O.onMod('l1.out', 'i1:f.cutoff'); await settle();
  assert.deepEqual([hsteps(), (T().mods || []).map(r => r.src + '>' + r.dst).join()], [n2 + 1, 'l1.out>i1:f.cutoff']);
});

test('a Serum\'s own sources: an own LFO onto its own knob is a native matrix row (the Serum\'s panel undo, drawn from its module); the Mod list in parts view lists every matrix row (own rows tagged Serum); the inspector edits one, without Keep on canvas', async () => {
  const O = M.opts, n0 = hsteps(), slots = () => T().dev.i1.vals.s.matrix.filter(r => r && r.src === 'lfo2').length;
  const k0 = slots();
  assert.deepEqual(O.canMod('i1/lfo2.out', 'i1:f.res'), { ok: true, why: '' });
  assert.deepEqual(O.canMod('i1/macros.k1', 'i1:f.res'), { ok: true, why: '' });
  O.onMod('i1/lfo2.out', 'i1:f.res'); await settle();
  assert.deepEqual([slots(), hsteps()], [k0 + 1, n0], 'a native row: no History step (the panel\'s)');
  const own = V().cables.list().filter(c => c.own && c.a === 'i1/lfo2.out').map(c => c.b);
  assert.equal(own.includes('i1:f.res'), true, 'drawn from LFO 2\'s jack');
  const L = PT.presetRows('i1');
  assert.equal(L.some(r => r.src === 'lfo2' && r.dst === 'f.res' && r.own === true), true, 'every matrix row in parts view');
  M.list(); await settle();
  const lines = walk(sim.$('#ov'), q => /\bcv-ml-line\b/.test(String(q.className || '')));
  const tagged = lines.filter(q => walk(q, z => !!z.attrs && z.attrs['data-tag'] === 'own').length > 0).length;
  assert.equal(tagged >= 2, true, 'own rows tagged Serum (LFO 2 on A LEVEL and F RES)');
  M.layer().close();
  const c = V().cables.list().find(x => x.own && x.b === 'i1:f.res');
  M.sel(c.id); await settle();
  const pop = walk(sim.$('#ov'), q => /\bcv-ml-pop\b/.test(String(q.className || ''))).pop();
  assert.equal(!!pop, true);
  const kept = walk(pop, q => !!q.attrs && q.attrs['data-act'] === 'keep');
  assert.deepEqual([kept.length ? !!kept[0].hidden : true, walk(pop, z => !!z.attrs && z.attrs['data-tag'] === 'own').length], [true, 1], 'no Keep on canvas for an own row; tagged Serum');
  M.layer().close();
});

test('a row into a knob no mounted view shows ends at VOICE\'s bar, tagged "OSC C · FINE · hidden"; the inspector offers "Show OSC C" (a module, no sound change, one step); link rows leave from the parts\' jacks', async () => {
  PT.remove('i1/oscC'); await settle();
  assert.equal(partKeys().includes('i1/oscC'), false);
  M.connect('l1.out', 'i1:c.fine'); await settle();
  const q = V().destPort('i1', 'c.fine'), tag = 'OSC C · FINE · hidden';
  assert.deepEqual([!!q.hid, q.tag], [true, tag]);
  const h = PT.hidden('i1', 'c.fine');
  assert.deepEqual([h.tag, h.show.label, PT.hidden('i1', 'a.level')], [tag, 'Show OSC C', null], 'OSC A LEVEL: on screen');
  const n0 = hsteps(), on0 = base('c.on');
  h.show.action(); await settle();
  assert.deepEqual([partKeys().includes('i1/oscC'), base('c.on'), hsteps(), cv.hist.undoLabel, V().modules.get('i1/oscC').el.hasAttribute('data-off')], [true, on0, n0 + 1, 'Show OSC C', true]);
  const t = T();
  assert.equal(CMOD.addMod(t, 'i1/lfo3.out', 'i1:f.cutoff', { project: P() }).ok, true);
  assert.equal(CMOD.addMod(t, 'i1/env1.out', 'i1:a.pan', { project: P() }).ok, true);
  cv.render(); await settle();
  const L = V().cables.list().filter(c => c.kind === 'mod' && !c.own && !c.preset).map(c => c.a + '>' + c.b);
  assert.deepEqual([partKeys().includes('i1/lfo3'), L.includes('i1/lfo3.out>i1:f.cutoff'), L.includes('i1.env1>i1:a.pan')], [true, true, true]);
});

test('slot hosts (a canvas LFO / Macro module is Serum\'s own panel): a drag is one History step opened at its first live change (the payload reposted under N.modsHold), its undo the pre-drag record; a rollback leaves none; macro moves post mval; a menu edit is one step; a view edit none', async () => {
  const t = T(), N = api.nodes.get(t.id), B = M.bodies.get('l1'), H = B.host();
  assert.equal(!!H, true);
  const r0 = JSON.stringify(t.dev.l1), n0 = hsteps(), x0 = H.getN('l1.rate');
  H.setN('l1.rate', x0 + 0.05, 'start');
  assert.deepEqual([hsteps(), N.modsHold, JSON.stringify(T().dev.l1) !== r0], [n0 + 1, true, true], 'the first live change: the step opened, the record written, the hold on');
  H.setN('l1.rate', x0 + 0.1, 'move');
  H.setN('l1.rate', x0 + 0.1, 'end'); await settle();
  assert.deepEqual([hsteps(), cv.hist.undoLabel, N.modsHold], [n0 + 1, 'Edit LFO 1', false]);
  cv.undo(); await settle();
  assert.equal(JSON.stringify(T().dev.l1), r0, 'undo: the record before the drag');
  const n1 = hsteps();
  H.setN('l1.rate', x0 + 0.2, 'start');
  H.setN('l1.rate', x0, 'end'); await settle();
  assert.deepEqual([hsteps(), JSON.stringify(T().dev.l1)], [n1, r0], 'a rollback: no step, the record as it was');
  H.edit(s => { s.lfo[0].mono = s.lfo[0].mono ? 0 : 1; }, { label: 'MONO' }); await settle();
  assert.deepEqual([hsteps(), cv.hist.undoLabel], [n1 + 1, 'Edit LFO 1']);
  H.edit(s => { s.ui.lfoZoom = 2; }, { label: 'View', ui: true }); await settle();
  assert.equal(hsteps(), n1 + 1, 'a view edit: no step');
  M.add('macro'); await settle();
  const mk = [...V().modules.keys()].find(k => /^m\d+$/.test(k));
  M.connect(mk + '.k1', 'i1:f.drive'); await settle();
  const Hm = M.bodies.get(mk).host(), node = sim.nodeOf(t.id), n2 = hsteps();
  node.posted.length = 0;
  Hm.setN('m1', 0.4, 'start'); Hm.setN('m1', 0.5, 'move'); Hm.setN('m1', 0.5, 'end'); await settle();
  const mv = node.posted.map(x => x.m).filter(m => m.t === 'mval');
  assert.deepEqual([mv.length >= 2, +mv[mv.length - 1].v.toFixed(2), hsteps(), +T().dev[mk].v[0].toFixed(2)], [true, 0.5, n2 + 1, 0.5]);
  const ops = PT.rowsOps(mk), n3 = hsteps();
  assert.equal(ops.count(), 1);
  ops.bypass(true); await settle();
  assert.deepEqual([ops.bypassed(), hsteps()], [true, n3 + 1]);
  ops.remove(); await settle();
  assert.deepEqual([ops.count(), hsteps()], [0, n3 + 2]);
});

test('the modulator column grows leftwards (modX / modW): a tapped LFO at x −512, 416 wide, never over the instrument; a drop over the instrument moves on left of it; the drop ghost is the kind\'s width', async () => {
  const t = T();
  assert.deepEqual([CVM.modX('lfo'), CVM.modW('lfo'), CVM.modX('env'), CVM.modX('wheel')], [-512, 416, -416, -320]);
  const k = M.add('lfo'); await settle();
  const r = V().modules.get(k).rect();
  assert.deepEqual([r.x, r.w, r.x + r.w <= -CVM.MOD_GAP], [-512, 416, true]);
  const I1 = V().modules.get('i1').rect(), p = PT.modClear(t, 'lfo', { x: I1.x + 20, y: I1.y + 20 });
  assert.equal(p.x + 416 <= I1.x - CVM.MOD_GAP, true, 'a drop over VOICE: left of it');
  const n0 = hsteps();
  assert.equal(M.drag.drop('env', { over: 'canvas', x: 300, y: 300, at: { x: I1.x + 200, y: I1.y + 100 } }), true); await settle();
  const e = [...V().modules.keys()].filter(q => /^e\d+$/.test(q)).pop(), re = V().modules.get(e).rect();
  assert.deepEqual([hsteps(), re.w, re.x + re.w <= I1.x - CVM.MOD_GAP], [n0 + 1, 320, true], 'an ENV dropped onto VOICE lands left of it');
});

test('the ModCore meters are track-level (role none, no part: lane E\'s \'mods\' id); mcx moves an LFO\'s phase dot in Serum\'s panel', async () => {
  const t = T();
  const S = [...cv.monitors.subs].find(x => x.trackId === t.id && x.mods);
  assert.deepEqual([!!S, S && S.dev, S && S.role], [true, null, 'none']);
  globalThis.__synthTest.modUI.editState('l1', { lfo: Object.assign({}, t.dev.l1.lfo, { mono: 1 }) }); await settle(); // (GLOBAL: evaluated by ModCore)
  const pay = api.buildMods(t), L1 = pay.slots && pay.slots.l1;
  assert.equal(!!L1, true, 'the cabled LFO has a ModCore slot');
  const mc = new Float32Array(16), mcx = { ph: new Float32Array(20), env: new Float32Array(8) };
  mc[L1.i] = 0.4; mcx.ph[L1.i] = 0.25; mcx.ph[10 + L1.i] = 0.7;
  cv.monitors.deliver(t.id, { t: 'smon', mc, mcx });
  const H = M.bodies.get('l1').host();
  assert.deepEqual([+H.snap.lfoPh[0].toFixed(2), +H.snap.lfoY[0].toFixed(2), +H.liveV.toFixed(2)], [0.25, 0.7, 0.4]);
});

test('D-R5: ⚙ "New Serums open as" (a device pref, the shipped default the whole panel): Parts — a new Serum track opens taken apart (VOICE, its parts, its own FX laid out by Tidy\'s rule); Tidy keeps the flag; a track switch away and back makes the host again in parts view', async () => {
  const sel = sh.shell.sxView;
  assert.deepEqual([!!sel, sel.value], [true, 'bundled']);
  sel.value = 'parts'; sel.onchange();
  assert.equal(PT.newView(), 'parts');
  const t = api.addTrack(MOD('serum')); sim.raf(); cv.renderViews(); await settle(); await settle();
  assert.deepEqual([uiOf('i1', t), rec().mode, partKeys()], ['parts', 'parts', 'i1/oscA']);
  const L = t.lay;
  assert.equal(L['i1/oscA'].x < L.i1.x && L.i1.x < L['i1/fx'].x, true, 'sources → VOICE → own FX');
  cv.tidy(); await settle();
  assert.equal(uiOf('i1', T()), 'parts', 'Tidy carries the parts flag');
  sel.value = 'bundled'; sel.onchange();
  api.selectTrack(ID.a); cv.renderViews(); await settle();
  api.selectTrack(t.id); cv.renderViews(); await settle(); await settle();
  assert.deepEqual([rec().mode, [...rec().views.keys()].sort().join(',')], ['parts', 'i1,i1/oscA']);
});

/* ---- review 1 (fixer A): F1 – F5 */
let pid = 900;
const pe = (el, type, x, y) => el.dispatchEvent({ type, target: el, currentTarget: el, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: pid,
  pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, timeStamp: performance.now(), shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
  preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
const dragBar = (m, dx, dy) => { pid++; pe(m.bar, 'pointerdown', 500, 70); pe(m.bar, 'pointermove', 500 + dx / 2, 70 + dy / 2); pe(m.bar, 'pointermove', 500 + dx, 70 + dy); pe(m.bar, 'pointerup', 500 + dx, 70 + dy); };
const usedOf = (t = T(), dev = 'i1') => (t.mods || []).map(r => r && r.src).filter(x => typeof x === 'string' && x.startsWith(dev + '/'));
const wantOf = (t = T()) => SE.partKeys(t.dev.i1.vals.s, null, 'i1', usedOf(t));
const keysOf = L => [...new Set(L)].map(p => 'i1/' + p).sort().join(',');

test('review 1 F1: Show parts / Bundle cycles release each discarded view set — the one host\'s disposers (offs) and adopted satellites (sats) stay level', async () => {
  const H = host();
  H.edit(s => { Object.assign(s.p, { 'b.on': 1, 'f.on': 1 }); }, { label: 'on' }); await settle();
  if (!PT.isParts('i1')) { PT.show('i1', true); await settle(); await settle(); }
  PT.show('i1', false); await settle(); await settle();
  const cyc = async () => { PT.show('i1', true); await settle(); await settle(); PT.show('i1', false); await settle(); await settle(); };
  await cyc();
  const o0 = H.offs.length, s0 = H.sats ? H.sats.size : 0;
  for (let i = 0; i < 4; i++) await cyc();
  assert.deepEqual([host() === H, rec().mode, H.offs.length, H.sats ? H.sats.size : 0], [true, 'bundled', o0, s0]);
});

test('review 1 F2 (the lead\'s rule): browsing every factory preset in parts view leaves the last preset\'s parts only — places the rule wrote are automatic and a load prunes those now neither on nor read; a part the user moved stays; no History step; the panel undo of the last load prunes likewise', async () => {
  PT.show('i1', true); await settle(); await settle();
  assert.equal(partKeys().includes('i1/oscB'), true);
  assert.deepEqual([T().lay['i1/oscB'].auto, T().lay['i1/filter'].auto], [1, 1], 'placed by the rule (I1): automatic');
  const n0 = hsteps();
  dragBar(V().modules.get('i1/oscB'), 0, 64); await settle();
  assert.deepEqual([hsteps(), /^Move /.test(cv.hist.undoLabel), T().lay['i1/oscB'].auto], [n0 + 1, true, undefined], 'a move: the user\'s place');
  const names = C.FACTORY_PRESETS.map(p => p.name), n1 = hsteps();
  for (const nm of names) { assert.equal(api.sxLoad(cv.view1e('i1'), 'f:' + nm), true); await settle(); }
  await settle(); await settle();
  const last = wantOf();
  assert.deepEqual([names[names.length - 1], last.length, last.includes('oscB')], ['Laser Drop', 2, false]);
  assert.deepEqual([partKeys(), hsteps()], [keysOf(last.concat('oscB')), n1], 'the last preset\'s parts, the moved OSC B (dimmed), nothing else; no step');
  assert.equal(V().modules.get('i1/oscB').el.hasAttribute('data-off'), true);
  host().undoRedo(false); await settle(); await settle();   // (the panel undo of the last load: the preset before it)
  assert.deepEqual([partKeys(), hsteps()], [keysOf(wantOf().concat('oscB')), n1]);
});

test('review 1 F3: a canvas cable undone inside the Serum (its panel undo), then the top ↶ named for the cable: it consumes the cable step alone (said: already undone) — never the Show parts before it —; ↷ writes the cable again', async () => {
  host().edit(s => { s.p['b.on'] = 1; s.p['f2.on'] = 1; s.osc[1].route = 1; }, { label: 'on' }); await settle();
  PT.show('i1', false); await settle(); await settle();
  PT.show('i1', true); await settle(); await settle();
  const F = () => [T().dev.i1.vals.s.osc[1].route, base('b.fbal'), base('f2.routeB')];
  const f0 = F(), n0 = hsteps();
  assert.equal(cv.hist.undoLabel, 'Show parts');
  assert.equal(PT.connect('i1/oscB.out', 'i1/filter2.in'), true); await settle(); await settle();
  const f1 = F();
  assert.deepEqual([hsteps(), cv.hist.undoLabel, f1[0]], [n0 + 1, 'OSC B → FILTER 2', 0]);
  host().undoRedo(false); await settle(); await settle();   // (Cmd-Z with the focus in OSC B's part)
  assert.deepEqual([F(), cv.hist.undoLabel], [f0, 'OSC B → FILTER 2'], 'the panel undid the cable; History\'s top still names it');
  cv.undo(); await settle(); await settle();               // (the top ↶)
  assert.deepEqual([uiOf(), rec().mode, F(), cv.hist.undoLabel, cv.hist.redoLabel, hsteps()], ['parts', 'parts', f0, 'Show parts', 'OSC B → FILTER 2', n0]);
  assert.equal(/OSC B → FILTER 2.*already undone/.test(note()), true, note());
  cv.redo(); await settle(); await settle();
  assert.deepEqual([F(), cv.hist.undoLabel, uiOf()], [f1, 'OSC B → FILTER 2', 'parts'], '↷: the cable again');
  cv.undo(); await settle(); await settle();
  assert.deepEqual([F(), cv.hist.undoLabel, uiOf()], [f0, 'Show parts', 'parts'], 'a plain ↶ of it: written back');
});

test('review 1 F4: a matrix row without a destination reads nothing — its LFO gets no module (I2), and Add / Remove agree with what is shown (one step each, the module gone after Remove)', async () => {
  const s = () => T().dev.i1.vals.s, U = SE.slotsUsed(s(), usedOf());
  const L = Array.from({ length: 10 }, (_, l) => 'lfo' + (l + 1)).find(l => !U.has(l) && !T().lay['i1/' + l]);
  const k = s().matrix.findIndex(r => !r.src && !r.dst && !r.aux);
  assert.equal(!!L && k >= 0, true);
  host().edit(st => { st.matrix[k] = C.normRow({ src: L, dst: '', amt: 0.5 }); }, { label: 'row' }); await settle(); await settle();
  assert.deepEqual([s().matrix[k].src, partKeys().includes('i1/' + L), SE.slotsUsed(s()).has(L)], [L, false, false], 'a row with no destination: no module');
  const n0 = hsteps();
  assert.equal(PT.add('i1', 'lfo', null, L), L); await settle(); await settle();
  assert.deepEqual([partKeys().includes('i1/' + L), hsteps()], [true, n0 + 1], 'Add ▸ ' + L);
  assert.equal(PT.remove('i1/' + L), true); await settle(); await settle();
  assert.deepEqual([partKeys().includes('i1/' + L), hsteps(), /^Remove LFO/.test(cv.hist.undoLabel)], [false, n0 + 2, true], 'Remove: gone, one step (not back at once)');
  host().edit(st => { st.matrix[k] = C.normRow(null); }, { label: 'row' }); await settle();
});

test('review 1 F5: "Replace with Serum" acts on the track it was offered for — tapped after another track was selected, it replaces nothing', async () => {
  const j = api.addTrack(MOD('juno60')); sim.raf(); cv.renderViews(); await settle();
  const p = api.addTrack(MOD('prophet5')); sim.raf(); cv.renderViews(); await settle();
  api.selectTrack(j.id); cv.renderViews(); await settle();
  const n0 = hsteps(), model = id => I(P().tracks.find(t => t.id === id)).model;
  PT.pick('osc');
  assert.equal(note(), 'Serum parts belong to a Serum · Replace with Serum');
  api.selectTrack(p.id); cv.renderViews(); await settle();
  sim.$('#notice').click(); await settle(); await settle();
  assert.deepEqual([model(j.id), model(p.id), hsteps()], ['juno60', 'prophet5', n0], 'nothing replaced');
  // offered and tapped on the same track: replaced (one step)
  PT.pick('osc');
  sim.$('#notice').click(); await settle(); await settle();
  assert.deepEqual([model(p.id), model(j.id), hsteps(), cv.hist.undoLabel], ['serum', 'juno60', n0 + 1, 'Replace Prophet-5 with Serum']);
  cv.undo(); await settle();
  assert.equal(model(p.id), 'prophet5');
});

test('review 2 P1-5: a stub\'s tap opens the source\'s routing popover after the tap\'s click — never inside it (the world takes a click while its gesture lasts); a selection without a tap opens it at once', async () => {
  api.selectTrack(ID.a); cv.renderViews(); await settle();
  if (!PT.isParts('i1')) { PT.show('i1', true); await settle(); await settle(); }
  host().edit(s => { s.p['b.on'] = 1; s.osc[1].route = 0; s.p['f.routeB'] = 0; s.p['f2.routeB'] = 0; }, { label: 'stub' }); await settle(); await settle();
  const c = V().cables.list().find(x => x.int && x.stub && x.a === 'i1/oscB.out');
  assert.equal(!!c, true, 'OSC B\'s stub');
  const open = () => (host().pop ? host().pop.o : null), shut = () => { if (host().pop) host().pop.close(); };
  const Vb = rec().views.get('i1/oscB').V, b = (Vb.panel.panel || Vb.panel).route.btn; // (the stub DOM's click() runs onclick only: a browser's runs the listeners)
  b.click = () => b.dispatchEvent({ type: 'click', target: b, currentTarget: b, preventDefault() {}, stopPropagation() {} });
  shut();
  M.sel(c.id); await settle();
  assert.equal(open(), 'route1', 'no tap: at once');
  shut();
  M.sel(c.id, 'mouse'); await settle(); await settle();
  assert.equal(open(), null, 'not inside the tap');
  sim.win('click'); await settle(); await settle();
  assert.equal(open(), 'route1', 'after its click: OSC B routing');
  shut();
});

test('review 2 P1-2: a part view a paint skipped while its module was off screen is painted when the module comes back on screen — engine off (the module\'s on-screen change → the host\'s reshow)', async () => {
  api.selectTrack(ID.a); cv.renderViews(); await settle();
  if (!PT.isParts('i1')) { PT.show('i1', true); await settle(); await settle(); }
  if (!V().modules.has('i1/macros')) { PT.add('i1', 'macros'); await settle(); await settle(); }
  const m = V().modules.get('i1/macros');
  const name1 = () => (walk(m.el, q => /\bsx-tl\b/.test(String(q.className || '')))[0] || {}).textContent;
  assert.equal(name1(), T().dev.i1.vals.s.macros[0].name || 'Macro 1');
  m.onScreen(false); await settle();
  host().edit(s => { s.macros[0].name = 'Bright'; }, { label: 'name' }); await settle(); await settle();
  assert.notEqual(name1(), 'Bright', 'off screen: skipped (H4)');
  m.onScreen(true); await settle(); await settle();
  assert.equal(name1(), 'Bright', 'on screen again: painted');
  host().edit(s => { s.macros[0].name = 'Macro 1'; }, { label: 'name' }); await settle();
});

test('review 2 P1-6 (the lead\'s decision): OSC A routed into an off FILTER 1 with no module (the default Serum as parts) is a dimmed stub "→ Filter 1 (off)"; its tap opens OSC A\'s routing and offers turning FILTER 1 on (one step: the module, the ⏻, the cable to it)', async () => {
  api.selectTrack(ID.a); cv.renderViews(); await settle();
  if (!PT.isParts('i1')) { PT.show('i1', true); await settle(); await settle(); }
  if (V().modules.has('i1/filter')) { PT.remove('i1/filter'); await settle(); await settle(); }
  host().edit(s => { s.p['f.on'] = 0; s.p['a.on'] = 1; s.osc[0].route = 0; s.p['f.routeA'] = 1; s.p['a.fbal'] = 0; }, { label: 'default routing' }); await settle(); await settle();
  assert.equal(partKeys().split(',').includes('i1/filter'), false);
  const c = V().cables.list().find(x => x.id === 'x:i1:oscA.out>filter.in');
  assert.deepEqual([!!c, c && c.b, c && !!c.stub, c && c.off, c && c.label, c && !!c.dim], [true, null, true, 'filter', '→ Filter 1 (off)', true]);
  const Va = rec().views.get('i1/oscA').V, b = (Va.panel.panel || Va.panel).route.btn; // (the stub DOM's click() runs onclick only)
  b.click = () => b.dispatchEvent({ type: 'click', target: b, currentTarget: b, preventDefault() {}, stopPropagation() {} });
  if (host().pop) host().pop.close();
  const n0 = hsteps();
  M.sel(c.id); await settle(); await settle();
  assert.deepEqual([host().pop ? host().pop.o : null, note()], ['route0', 'FILTER 1 is off · tap to turn it on']);
  host().pop.close();
  sim.$('#notice').click(); await settle(); await settle();
  assert.deepEqual([hsteps(), cv.hist.undoLabel, partKeys().split(',').includes('i1/filter'), base('f.on') >= 0.5], [n0 + 1, 'Add FILTER 1', true, true]);
  const c2 = V().cables.list().find(x => x.id === 'x:i1:oscA.out>filter.in');
  assert.deepEqual([c2.b, !!c2.stub], ['i1/filter.in', false], 'the cable into FILTER 1 now');
  assert.deepEqual(M.cmenu(c.id).map(i => i.label), [], 'not a stub any more: no stub menu');
  cv.undo(); await settle(); await settle();
  const c3 = V().cables.list().find(x => x.id === 'x:i1:oscA.out>filter.in');
  assert.deepEqual([c3.off, M.cmenu(c3.id).map(i => i.label)], ['filter', ['Routing…', 'Turn FILTER 1 on']], 'undone: the stub again; its menu');
});

test('review 2 P1-7: a row into a knob no mounted view shows ends at VOICE\'s top-left corner (its tagged badge right of it, above the bar: never over FILTER 1\'s bar left of VOICE)', async () => {
  api.selectTrack(ID.a); cv.renderViews(); await settle();
  if (!PT.isParts('i1')) { PT.show('i1', true); await settle(); await settle(); }
  if (V().modules.has('i1/oscC')) { PT.remove('i1/oscC'); await settle(); await settle(); }
  const q = V().destPort('i1', 'c.pan'), v = V().modules.get('i1').rect();
  assert.deepEqual([!!q.hid, q.x, q.y], [true, v.x, v.y]);
});

test('review 2 P2: a canvas ENV cabled to a Serum knob (injected into that Serum\'s ENV slot: no ModCore slot) moves its playhead from the Serum\'s own snapshot of that slot', async () => {
  api.selectTrack(ID.a); cv.renderViews(); await settle();
  const t = T(), e = M.add('env'); await settle(); await settle();
  M.connect(e + '.out', 'i1:a.level'); await settle(); await settle();
  const pay = api.buildMods(t);
  assert.equal(!!(pay.slots && pay.slots[e]), false, 'no ModCore slot: injected into the Serum');
  const inj = PT.injEnv ? PT.injEnv(t) : [];
  const q = inj.find(x => x.key === e);
  assert.deepEqual([!!q, q && q.dev], [true, 'i1'], 'injected into i1\'s ENV slot');
  const N = 4, s = { env: new Float32Array(N), envStage: new Uint8Array(N), envT: new Float32Array(N) };
  s.env[q.k] = 0.6; s.envStage[q.k] = 3; s.envT[q.k] = 0.42;
  cv.monitors.deliver(t.id, { t: 'smon', i: 'i1', s });
  const H = M.bodies.get(e).host();
  assert.deepEqual([H.snap && H.snap.envStage[1], H.snap && +H.snap.envT[1].toFixed(2), +H.liveV.toFixed(2)], [3, 0.42, 0.6], 'the canvas ENV\'s slot (ENV 2\'s layout) moves');
  // the track's only row that ENV's: nothing for ModCore (the payload off) — still listed, still fed
  const keep = t.mods;
  t.mods = keep.filter(r => r.src === e + '.out');
  try {
    assert.equal(!!api.buildMods(t).off, true, 'off'); // (a rebuild: a new payload object, the list memo misses)
    const q3 = PT.injEnv(t).find(x => x.key === e);
    assert.equal(!!q3, true, 'listed');
    s.envStage[q3.k] = 2; s.envT[q3.k] = 0.1;
    cv.monitors.deliver(t.id, { t: 'smon', i: 'i1', s });
    assert.equal(H.snap.envStage[1], 2);
  } finally { t.mods = keep; api.buildMods(t); }
  M.del(e, true); await settle();
});

test('review 2 P2 places: a preset load that turns OSC B / C and both filters on lays them out in order once settled (OSC A · B · C, FILTER 1 · 2 top to bottom, whatever Tidy\'s guessed heights); a part tile dropped on VOICE lands clear of it', async () => {
  api.selectTrack(ID.a); cv.renderViews(); await settle();
  if (!PT.isParts('i1')) { PT.show('i1', true); await settle(); await settle(); }
  for (const k of ['i1/oscB', 'i1/oscC', 'i1/filter', 'i1/filter2']) if (T().lay[k]) { PT.remove(k); await settle(); await settle(); }
  const ks = ['i1/oscA', 'i1/oscB', 'i1/oscC', 'i1/filter', 'i1/filter2'], H = { 'i1/oscB': 700, 'i1/oscC': 700, 'i1/filter': 520, 'i1/filter2': 520 };
  assert.equal(api.sxLoad(cv.view1e('i1'), 'f:Drift Machine'), true);
  cv.renderViews();
  for (const [k, h] of Object.entries(H)) { const m = V().modules.get(k); assert.equal(!!m, true, k); const r0 = m.rect; m.rect = () => Object.assign(r0(), { h }); } // (taller than Tidy's guesses, as in Chrome)
  await settle(); await settle(); await settle();
  const R = V().rects(), y = k => R[k].y;
  assert.deepEqual([y('i1/oscA') < y('i1/oscB'), y('i1/oscB') < y('i1/oscC'), y('i1/filter') < y('i1/filter2')], [true, true, true], ks.map(k => k + ' ' + y(k)).join(' · '));
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  assert.deepEqual(ks.flatMap((a, i) => ks.slice(i + 1).filter(b => hit(R[a], R[b])).map(b => a + '×' + b)), []);
  // a part tile dropped on VOICE: clear of it
  PT.remove('i1/noise'); await settle(); await settle();
  const v = V().modules.get('i1').rect();
  PT.drop('noise', { x: v.x + 40, y: v.y + 40 }); await settle(); await settle(); await settle();
  const R2 = V().rects();
  assert.deepEqual([!!R2['i1/noise'], Object.keys(R2).filter(z => z !== 'i1/noise' && hit(R2['i1/noise'], R2[z]))], [true, []]);
});

test('review 2 P2 (§2.2): an LFO\'s bar carries its GLOBAL / PER NOTE badge (its MONO) — a canvas LFO and a Serum\'s own LFO part; a mode badge, not a warning', async () => {
  api.selectTrack(ID.a); cv.renderViews(); await settle();
  if (!PT.isParts('i1')) { PT.show('i1', true); await settle(); await settle(); }
  const t = T(), l = [...V().modules.keys()].find(q => /^l\d+$/.test(q)) || M.add('lfo'); await settle();
  const badge = k => { const m = V().modules.get(k), b = walk(m.bar, q => /\bcv-badge\b/.test(String(q.className || '')))[0]; return [m.badge, b && b.attrs ? b.attrs['data-tone'] || null : null]; };
  globalThis.__synthTest.modUI.editState(l, { lfo: Object.assign({}, t.dev[l].lfo, { mono: 1 }) }); await settle(); await settle();
  assert.deepEqual(badge(l), ['GLOBAL', 'mode']);
  globalThis.__synthTest.modUI.editState(l, { lfo: Object.assign({}, t.dev[l].lfo, { mono: 0 }) }); await settle(); await settle();
  assert.deepEqual(badge(l), ['PER NOTE', 'mode']);
  const own = [...V().modules.keys()].find(q => /^i1\/lfo\d+$/.test(q)) || (PT.add('i1', 'lfo', null, 'lfo5') && 'i1/lfo5'); await settle(); await settle();
  const n = +own.split('lfo')[1];
  host().edit(s => { s.lfo[n - 1].mono = 1; }, { label: 'mono' }); await settle(); await settle();
  assert.deepEqual(badge(own), ['GLOBAL', 'mode']);
  host().edit(s => { s.lfo[n - 1].mono = 0; }, { label: 'mono' }); await settle(); await settle();
  assert.deepEqual(badge(own), ['PER NOTE', 'mode']);
});

test('review 2 P1-4: a modulator dropped near an instrument is cleared by its kind\'s measured height (never the guess: an OB-Xa face would leave GL) and of every module — a drop onto the instrument never lands on another modulator; a drop settles as a tap does', async () => {
  api.selectTrack(ID.a); cv.renderViews(); await settle();
  const t = T(), hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const l0 = [...V().modules.keys()].find(q => /^l\d+$/.test(q)) || M.add('lfo'); await settle();
  const m0 = V().modules.get(l0), r0 = m0.rect;
  m0.rect = () => Object.assign(r0(), { h: 451 }); // (a Serum-faithful LFO's measured height in Chrome; the guess MOD_H.lfo is 256)
  try {
    const I1 = V().modules.get('i1').rect(), at = { x: I1.x + 64, y: I1.y - CVM.MOD_H.lfo - 32 };
    const p = PT.modClear(t, 'lfo', at), R = V().rects();
    assert.equal(hit({ x: p.x, y: p.y, w: 416, h: 451 }, I1), false, 'clear of VOICE by 451 px, not 256');
    assert.deepEqual(Object.keys(R).filter(k => hit({ x: p.x, y: p.y, w: 416, h: 451 }, R[k])), [], 'clear of every module');
    // onto VOICE at the column's height: left of VOICE, then below the LFO standing there (the column stays one column)
    const q = PT.modClear(t, 'lfo', { x: I1.x + 20, y: R[l0].y + 8 });
    assert.deepEqual(Object.keys(R).filter(k => hit({ x: q.x, y: q.y, w: 416, h: 451 }, R[k])), [], 'never on another modulator');
    assert.equal(q.x + 416 <= I1.x - CVM.MOD_GAP, true, 'left of VOICE');
    // a tile dropped there: clear once settled
    const n0 = hsteps();
    assert.equal(M.drag.drop('lfo', { over: 'canvas', x: 300, y: 300, at: { x: I1.x + 220, y: R[l0].y + 200 } }), true); await settle(); await settle();
    const k = [...V().modules.keys()].filter(z => /^l\d+$/.test(z)).pop(), R2 = V().rects();
    assert.deepEqual([hsteps(), Object.keys(R2).filter(z => z !== k && hit(R2[k], R2[z]))], [n0 + 1, []]);
    cv.undo(); await settle();
  } finally { m0.rect = r0; }
});

test('S0 notice (IMPL-3 §9.9): on a touch device a track whose painted elements pass sx1\'s 1866 (the iPad session) says so once, at rest — after Show parts, Add part, a tray drop or a load; never on a desktop, under the count, mid-gesture or a second time; no History step', async () => {
  const HEAVY = 'This many Serum parts may stutter when zooming on this device — Bundle (⋯) puts it back together.';
  const WAIT = (PT.HEAVY_MS || 600) + 250, W = cv.world();
  assert.equal(PT.HEAVY, 1866, 'sx1\'s painted count (bench.json "ui-m3")');
  const t = api.addTrack(MOD('serum')); sim.raf(); cv.renderViews(); await settle(); await settle();
  assert.deepEqual([PT.newView(), uiOf('i1', t)], ['bundled', undefined]);
  api.notice('', 0);
  // touch, under the count (VOICE, OSC A and the own FX): nothing
  cv.touch(true);
  assert.equal(PT.show('i1', true), true); await settle(); await settle();
  await sim.settle(WAIT);
  assert.deepEqual([PT.painted() <= PT.HEAVY, note() === HEAVY], [true, false]);
  // a desktop: every part opened (a fully opened Serum is far past the count), nothing said
  cv.touch(false);
  const NS = { step: false }; // (no step, so no "Added … · tap to undo" notice either)
  for (const k of ['osc', 'osc', 'sub', 'noise', 'filter', 'filter']) { assert.notEqual(PT.add('i1', k, null, undefined, NS), null, k); await settle(); }
  for (const p of ['env2', 'env3', 'env4']) { assert.notEqual(PT.add('i1', 'env', null, p, NS), null, p); await settle(); }
  for (let n = 1; n <= 4; n++) { assert.notEqual(PT.add('i1', 'lfo', null, 'lfo' + n, NS), null, 'lfo' + n); await settle(); }
  for (const k of ['macros', 'arp', 'clip']) { assert.notEqual(PT.add('i1', k, null, undefined, NS), null, k); await settle(); }
  await settle();
  assert.equal(PT.painted() > PT.HEAVY, true, 'painted ' + PT.painted());
  api.notice('', 0);
  assert.equal(PT.show('i1', false), true); await settle(); await settle();
  assert.equal(PT.show('i1', true), true); await settle(); await settle();
  await sim.settle(WAIT);
  assert.equal(note() === HEAVY, false, 'a desktop never');
  // touch: Bundle says nothing; Show parts opens it again — while the camera moves, nothing; at rest, the notice, once, no step
  cv.touch(true);
  assert.equal(PT.show('i1', false), true); await settle(); await settle();
  await sim.settle(WAIT);
  assert.equal(note() === HEAVY, false, 'bundled: no parts to bundle');
  const n0 = hsteps();
  W.busy = true;
  assert.equal(PT.show('i1', true), true); await settle(); await settle();
  await sim.settle(WAIT);
  assert.equal(note() === HEAVY, false, 'a gesture is under way');
  W.busy = false;
  await sim.settle(WAIT);
  assert.deepEqual([note() === HEAVY, hsteps()], [true, n0 + 1], 'at rest: the notice; the one step is Show parts\'');
  // once per session: the same again (Bundle, Show parts) says nothing more
  api.notice('', 0);
  assert.equal(PT.show('i1', false), true); await settle(); await settle();
  assert.equal(PT.show('i1', true), true); await settle(); await settle();
  await sim.settle(WAIT);
  assert.equal(note(), '', 'a second time: nothing');
  // Add part (the session's flag reset): the "Added … · tap to undo" notice is not overwritten — the stutter notice waits for it
  PT.heavyReset();
  assert.equal(PT.remove('i1/lfo4'), true); await settle(); await settle();
  assert.equal(PT.add('i1', 'lfo', null, 'lfo4'), 'lfo4'); await settle(); await settle();
  await sim.settle(WAIT);
  assert.equal(/^Added LFO 4/.test(note()), true, note());
  await sim.settle(8400);
  assert.equal(note() === HEAVY, true, 'after the undo notice');
});
