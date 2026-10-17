// fx-ui.js (U3; SPEC-serum2 §2.5, §11.14, §13.5, §15.12) — the Phase-1 pure helpers (moveModule, ladderLabel,
// moduleTitle, v1 module presets, display maths), the v2 pure helpers (listRows, addMenuItems, moveTarget) and headless
// FXRackUI v2 checks on the fake DOM of tests/wk-dom.mjs: racks and tabs, instances of every type with every parameter
// bound to fx.<instance>.<pid>, splitters and branches, list drag / Alt-drag, module and rack menus, presets, chains,
// displays through the DSP helpers, the v1 → v2 transition.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Imported before any DOM exists (§0.1, §10.6).
const F = await import('../fx-ui.js');
const wk = await import('../wk.js?v=9'); // the instance fx-ui.js imports (versioned specifier)
const core = await import('../serum-core.js?v=9');
const { FXRackUI, moveModule, ladderLabel, moduleTitle, modulePresetPayload, applyModulePreset, svfDb, impulseDb, listRows, addMenuItems, moveTarget } = F;
import { all, byCls, one, byAttr, fresh, fire, ptr, key, place, raf, advance } from './wk-dom.mjs';

const FIX = JSON.parse(readFileSync(new URL('./fixtures/dests.json', import.meta.url), 'utf8'));
const MODS = ['hyper', 'dist', 'flg', 'phs', 'cho', 'dly', 'cmp', 'rev', 'eq', 'fil'];
const DEF = Object.fromEntries(FIX.DESTS.map(d => [d.id, d.def]));
const FX_IDS = FIX.DESTS.slice(FIX.NS).map(d => d.id).filter(id => id !== 'g.master' && id !== 'g.bypass');
// a v1 defaultFx() written out from Phase-1 §2.5 and the fixture defaults
function defFx() {
  const p = {};
  for (const id of FX_IDS) p[id] = DEF[id];
  return {
    v: 1, order: MODS.slice(), byp: Object.fromEntries(MODS.map(m => [m, 0])), p,
    dist: { xa: [[0, 0, 0], [1, 1, 0]], xb: [[0, 0, 0], [1, 1, 0]] }, cho: { mono: 0 }, rev: { type: 1 }, phase: [0, 0, 0, 0], lock: 0,
    ui: { lvl: { hyper: 0, dim: 0, dist: 0, flg: 0, phs: 0, cho: 0, dly: 0, cmp: 0, rev: 0, fil: 0 }, sel: '' },
  };
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` ${a} != ${b}`);
const TAB = (type, v) => core.FXP_TAB[type][v];
// a v2 instance of the type's newest (or given) variant with table defaults
function inst(id, type, v) {
  const T = core.FXTYPES.find(t => t.id === type), vv = v || T.variants[T.variants.length - 1], p = {};
  for (const r of TAB(type, vv)) p[r.pid] = r.def;
  const I = { id, type, v: vv, byp: 0, p, sub: {}, ph: 0, ui: { lvl: 0, lvl2: 0 } };
  if (type === 'dist') I.sub = { xa: [[0, 0, 0], [1, 1, 0]], xb: [[0, 0, 0], [1, 1, 0]] };
  if (type === 'cho') I.sub = { mono: 0 };
  if (type === 'rev' && vv === 1) I.sub = { type: 1 };
  if (type === 'conv') I.sub = { ir: 'fir:Medium/Chamber' };
  if (T.split) { I.br = Array.from({ length: T.split }, () => []); I.bb = new Array(T.split).fill(0); }
  return I;
}
function fx2(mods, bus1, bus2) {
  const f = core.defaultFx2();
  f.racks[0].mods = mods || [];
  f.racks[1].mods = bus1 || [];
  f.racks[2].mods = bus2 || [];
  return f;
}

/* ------------------------------------------------------------------ Phase-1 pure helpers */
test('moveModule: final index semantics, clamps, unknown id, no mutation', () => {
  const o = MODS.slice();
  assert.deepEqual(moveModule(o, 'hyper', 2), ['dist', 'flg', 'hyper', 'phs', 'cho', 'dly', 'cmp', 'rev', 'eq', 'fil']);
  assert.deepEqual(moveModule(o, 'fil', 0), ['fil', 'hyper', 'dist', 'flg', 'phs', 'cho', 'dly', 'cmp', 'rev', 'eq']);
  assert.deepEqual(moveModule(o, 'eq', 99).slice(-2), ['fil', 'eq']);
  assert.deepEqual(moveModule(o, 'dist', -5)[0], 'dist');
  assert.deepEqual(moveModule(o, 'cho', 4), o);
  assert.deepEqual(moveModule(o, 'nope', 0), o);
  assert.notEqual(moveModule(o, 'nope', 0), o);
  assert.deepEqual(o, MODS);
  assert.deepEqual(moveModule(null, 'x', 0), []);
});

test('ladderLabel: MODFX (31) and DLY (12) ladders', () => {
  assert.equal(ladderLabel('modfx', 0), 'Off');
  assert.equal(ladderLabel('modfx', 21 / 30), '1/4');
  assert.equal(ladderLabel('modfx', 1), '1/32');
  assert.equal(ladderLabel('modfx', 2 / 30), '32 bar T');
  assert.equal(ladderLabel('modfx', 1.7), '1/32');
  assert.equal(ladderLabel('dly', 0.625), '1/4');
  assert.equal(ladderLabel('dly', 6 / 11), '1/8');
  assert.equal(ladderLabel('dly', 0), 'fast');
  assert.equal(ladderLabel('dly', 1), '4 bar');
  assert.equal(ladderLabel('dly', NaN), 'fast');
});

test('moduleTitle: Phase-1 module labels, then the v2 type labels', () => {
  assert.deepEqual(MODS.map(moduleTitle), ['Hyper/Dimension', 'Distortion', 'Flanger', 'Phaser', 'Chorus', 'Delay', 'Compressor', 'Reverb', 'EQ', 'Filter']);
  assert.deepEqual(['bode', 'conv', 'util', 'split2', 'split3', 'splitms'].map(moduleTitle), ['Bode', 'Convolve', 'Utility', 'Splitter L/H', 'Splitter L/M/H', 'Splitter M/S']);
  assert.equal(moduleTitle('zzz'), 'zzz');
});

test('modulePresetPayload (v1): module ids (Hyper + Dimension), no enable, structured sub-state deep-copied', () => {
  const fx = defFx();
  fx.p['fx.hyper.rate'] = 0.9; fx.p['fx.dim.size'] = 0.1; fx.p['fx.hyper.on'] = 1;
  const h = modulePresetPayload(fx, 'hyper', 'Wide');
  assert.equal(h.name, 'Wide');
  assert.equal(h.m, 'hyper');
  assert.deepEqual(Object.keys(h.p).sort(), ['fx.dim.level', 'fx.dim.mix', 'fx.dim.size', 'fx.hyper.detune', 'fx.hyper.level', 'fx.hyper.mix', 'fx.hyper.rate', 'fx.hyper.retrig', 'fx.hyper.unison']);
  assert.equal(h.p['fx.hyper.rate'], 0.9);
  assert.equal(h.p['fx.dim.size'], 0.1);
  assert.equal('sub' in h, false);
  fx.dist.xa = [[0, 0, 0], [0.5, 0.9, 0.3], [1, 1, 0]];
  const d = modulePresetPayload(fx, 'dist', 'Fold');
  assert.deepEqual(Object.keys(d.p).sort(), ['fx.dist.drive', 'fx.dist.filt', 'fx.dist.freq', 'fx.dist.lbh', 'fx.dist.level', 'fx.dist.mix', 'fx.dist.mode', 'fx.dist.q']);
  assert.deepEqual(d.sub, { xa: fx.dist.xa, xb: fx.dist.xb });
  assert.notEqual(d.sub.xa, fx.dist.xa);
  assert.deepEqual(modulePresetPayload(fx, 'cho', 'c').sub, { mono: 0 });
  assert.deepEqual(modulePresetPayload(fx, 'rev', 'r').sub, { type: 1 });
  assert.equal('sub' in modulePresetPayload(fx, 'eq', 'e'), false);
  delete fx.p['fx.dly.feed'];
  assert.equal(modulePresetPayload(fx, 'dly', 'x').p['fx.dly.feed'], DEF['fx.dly.feed']); // missing → default
});

test('applyModulePreset (v1): values + sub-state applied; enable, bypass, order, other modules and locked ids kept', () => {
  const src = defFx();
  src.p['fx.dist.drive'] = 0.9; src.p['fx.dist.mode'] = 11 / 15; src.p['fx.dist.mix'] = 0.4;
  src.dist.xb = [[0, 0, 0], [0.5, 1, -0.5], [1, 0.5, 0]];
  const payload = modulePresetPayload(src, 'dist', 'Shaped');
  const fx = defFx();
  fx.order = moveModule(fx.order, 'dist', 7);
  fx.byp.dist = 1;
  fx.p['fx.dist.on'] = 1; fx.p['fx.eq.gainL'] = 0.75; fx.p['fx.dist.mix'] = 0.66;
  const before = JSON.stringify(fx);
  const out = applyModulePreset(fx, payload, ['fx.dist.mix']);
  assert.equal(JSON.stringify(fx), before); // input untouched
  assert.equal(out.p['fx.dist.drive'], 0.9);
  assert.equal(out.p['fx.dist.mode'], 11 / 15);
  assert.equal(out.p['fx.dist.mix'], 0.66); // locked
  assert.deepEqual(out.dist.xb, [[0, 0, 0], [0.5, 1, -0.5], [1, 0.5, 0]]);
  assert.equal(out.p['fx.dist.on'], 1);
  assert.equal(out.byp.dist, 1);
  assert.deepEqual(out.order, fx.order);
  assert.equal(out.p['fx.eq.gainL'], 0.75);
  const o2 = applyModulePreset(defFx(), { name: 'old', p: { 'fx.dim.size': 0.2, 'fx.hyper.unison': 1, 'fx.hyper.on': 1 } }, new Set(['fx.hyper.unison']));
  assert.equal(o2.p['fx.dim.size'], 0.2);
  assert.equal(o2.p['fx.hyper.unison'], DEF['fx.hyper.unison']);
  assert.equal(o2.p['fx.hyper.on'], 0); // never the enable
  const o3 = applyModulePreset(defFx(), { m: 'fil', p: { 'fx.fil.type': 0.5, 'fx.fil.res': 7 } }, id => id === 'fx.fil.cutoff');
  assert.equal(o3.p['fx.fil.type'], 48 / 95);
  assert.equal(o3.p['fx.fil.res'], 1);
  assert.equal(applyModulePreset(defFx(), { m: 'rev', p: {}, sub: { type: 0 } }).rev.type, 0);
  assert.deepEqual(applyModulePreset(defFx(), null), defFx());
});

test('display maths: svfDb (LP/BP/HP morph) and impulseDb', () => {
  const fs = 48000;
  near(svfDb(1000, 0.7071, 0, 20, fs), 0, 0.01, 'LP pass');
  near(svfDb(1000, 4, 0, 1000, fs), 20 * Math.log10(4), 0.01, 'LP peak = Q');
  near(svfDb(1000, 2, 1, 20000, fs), 0, 0.5, 'HP pass');
  near(svfDb(1000, 2, 0.5, 1000, fs), 0, 1e-9, 'BP unity peak');
  assert.ok(svfDb(1000, 0.7071, 0, 10000, fs) < -35);
  for (const v of impulseDb([1], fs, [20, 1000, 12000])) near(v, 0, 1e-9);
  const two = impulseDb([1, 1], fs, [0.0001, 23999.9]);
  near(two[0], 20 * Math.log10(2), 1e-6);
  assert.ok(two[1] < -60);
});

/* ------------------------------------------------------------------ v2 pure helpers */
// MAIN: dist, split2 [LOWS: eq, HIGHS: (empty)], dly, split3 [·, cho, ·]; BUS 1: dly2
function tree() {
  const S2 = inst('split2', 'split2'), S3 = inst('split3', 'split3');
  S2.br[0].push(inst('eq', 'eq'));
  S3.br[1].push(inst('cho', 'cho'));
  return fx2([inst('dist', 'dist'), S2, inst('dly', 'dly'), S3], [inst('dly2', 'dly')]);
}

test('listRows: processing order with branch headers and end slots, labels, layout indices, other racks', () => {
  const fx = tree(), rows = listRows(fx, 0);
  assert.deepEqual(rows.map(r => r.kind + ':' + r.key), [
    'inst:dist', 'inst:split2', 'branch:split2/0', 'inst:eq', 'end:split2/0/end', 'branch:split2/1', 'end:split2/1/end', 'inst:dly',
    'inst:split3', 'branch:split3/0', 'end:split3/0/end', 'branch:split3/1', 'inst:cho', 'end:split3/1/end', 'branch:split3/2', 'end:split3/2/end']);
  const eq = rows.find(r => r.id === 'eq');
  assert.deepEqual([eq.parent, eq.branch, eq.index, eq.depth, eq.n, eq.label, eq.on, eq.s1], ['split2', 0, 0, 1, 2, 'Equalizer', true, false]);
  assert.deepEqual(rows.filter(r => r.kind === 'branch').map(r => r.label), ['LOWS', 'HIGHS', 'LOWS', 'MIDS', 'HIGHS']);
  assert.deepEqual(rows.filter(r => r.kind === 'end').map(r => r.at), [1, 0, 0, 1, 0]);
  assert.deepEqual(rows.filter(r => r.kind === 'inst').map(r => r.n), [0, 1, 2, 3, 4, 5]);   // fxLayout order
  const b1 = listRows(fx, 1);
  assert.deepEqual(b1.map(r => [r.id, r.label, r.n, r.rack]), [['dly2', 'Delay 2', 6, 1]]);
  fx.ui.rack = 1;
  assert.equal(listRows(fx)[0].id, 'dly2');                                         // default rack = fx.ui.rack
  // a v1 state is read as its migration (enabled modules as S1 instances)
  const v1 = defFx(); v1.p['fx.rev.on'] = 1; v1.p['fx.dly.on'] = 1;
  assert.deepEqual(listRows(v1, 0).map(r => [r.id, r.s1]), [['dly', true], ['rev', true]]);
});

test('addMenuItems: 13 effects + 3 splitters at the top level, effects only in a branch, disabled when full', () => {
  const fx = tree();
  const top = addMenuItems(fx, 0, null);
  assert.deepEqual(top.map(x => x.label), ['Bode', 'Chorus', 'Compressor', 'Convolve', 'Delay', 'Distortion', 'Equalizer', 'Filter', 'Flanger',
    'Hyper/Dimension', 'Phaser', 'Reverb', 'Utility', 'Splitter L/H', 'Splitter L/M/H', 'Splitter M/S']);
  assert.deepEqual([...new Set(top.map(x => x.group))], ['Effects', 'Splitters']);
  assert.ok(top.every(x => !x.disabled));
  const br = addMenuItems(fx, 0, { splitter: 'split2', branch: 1 });
  assert.equal(br.length, 13);
  assert.ok(br.every(x => x.group === 'Effects' && !x.disabled));
  // a full branch (8) and a full rack (16)
  for (let i = 0; i < 8; i++) fx.racks[0].mods[1].br[1].push(inst('u' + i, 'util'));
  assert.ok(addMenuItems(fx, 0, { splitter: 'split2', branch: 1 }).every(x => x.disabled));
  const full = fx2(Array.from({ length: 16 }, (_, i) => inst('e' + i, 'eq')));
  assert.ok(addMenuItems(full, 0, null).every(x => x.disabled));
  assert.ok(addMenuItems(full, 1, null).every(x => !x.disabled));
  assert.ok(addMenuItems(fx, 0, { splitter: 'nope', branch: 0 }).every(x => x.disabled));
});

test('moveTarget: final index in the same list, into / out of branches, gaps at headers and end slots, splitter and cap rules', () => {
  const fx = tree(), rows = listRows(fx, 0), at = key => rows.findIndex(r => r.key === key);
  // dist (0) dropped before dly (top index 2): final index 1
  assert.deepEqual(moveTarget(fx, 'dist', at('dly')), { rack: 0, splitter: null, branch: 0, at: 1 });
  // dly (2) before dist: 0; to the end of the rack: 3
  assert.deepEqual(moveTarget(fx, 'dly', at('dist')), { rack: 0, splitter: null, branch: 0, at: 0 });
  assert.deepEqual(moveTarget(fx, 'dly', rows.length), { rack: 0, splitter: null, branch: 0, at: 3 });
  // into a branch: before eq → split2 LOWS 0; at the HIGHS end slot → HIGHS 0; before the HIGHS header → end of LOWS
  assert.deepEqual(moveTarget(fx, 'dly', at('eq')), { rack: 0, splitter: 'split2', branch: 0, at: 0 });
  assert.deepEqual(moveTarget(fx, 'dly', at('split2/1/end')), { rack: 0, splitter: 'split2', branch: 1, at: 0 });
  assert.deepEqual(moveTarget(fx, 'dly', at('split2/1')), { rack: 0, splitter: 'split2', branch: 0, at: 1 });
  assert.deepEqual(moveTarget(fx, 'dly', at('split2/0')), { rack: 0, splitter: 'split2', branch: 0, at: 0 });
  // out of a branch to the top level
  assert.deepEqual(moveTarget(fx, 'eq', at('dist')), { rack: 0, splitter: null, branch: 0, at: 0 });
  // splitters never enter branches (nor themselves)
  assert.equal(moveTarget(fx, 'split3', at('eq')), null);
  assert.equal(moveTarget(fx, 'split2', at('split2/1/end')), null);
  assert.deepEqual(moveTarget(fx, 'split3', at('dist')), { rack: 0, splitter: null, branch: 0, at: 0 });
  assert.equal(moveTarget(fx, 'nope', 0), null);
  // copy (Alt-drag): no own-list adjustment
  assert.deepEqual(moveTarget(fx, 'dist', at('dly'), 0, true), { rack: 0, splitter: null, branch: 0, at: 2 });
  // a full branch takes moves within it but nothing from outside
  for (let i = 0; i < 7; i++) fx.racks[0].mods[1].br[0].push(inst('u' + i, 'util'));
  const r2 = listRows(fx, 0), at2 = key => r2.findIndex(r => r.key === key);
  assert.equal(moveTarget(fx, 'dly', at2('u3')), null);
  assert.deepEqual(moveTarget(fx, 'u0', at2('eq')), { rack: 0, splitter: 'split2', branch: 0, at: 0 });
  assert.equal(moveTarget(fx, 'u0', at2('eq'), 0, true), null);
});

/* ------------------------------------------------------------------ FXRackUI */
function fakeDsp() {
  const calls = [];
  return {
    calls,
    distCurve: (mode, drive, a, b, n = 257, stages = 4) => { calls.push(['distCurve', mode, drive, a.length, b.length, n, stages]); return Float64Array.from({ length: n }, (_, i) => -1 + 2 * i / (n - 1)); },
    eqResponse: (fxp, inst, eff, freqs, fs) => { calls.push(['eqResponse', fxp.ver, inst, eff.length, fs]); return new Float64Array(freqs.length); },
    delayFilterResponse: (Fq, bw, freqs, fs) => { calls.push(['delayFilterResponse', Fq, bw, fs]); return new Float64Array(freqs.length).fill(-3); },
    filterImpulse: (type, fc, res, drive, vr, fs, len) => { calls.push(['filterImpulse', type, fc, res, drive, vr, fs, len]); const r = new Float64Array(len); r[0] = 1; return r; },
    splitResponse: (type, f1, f2, freqs, fs) => { calls.push(['splitResponse', type, f1, f2, fs]); return [new Float64Array(freqs.length), new Float64Array(freqs.length)]; },
  };
}
function mkRack(o = {}) {
  const d = fresh();
  const st = { fx: o.fx || fx2(), s: o.s || null, edits: [], sEdits: [], notes: [], store: new Map(), gr: null, locked: [] };
  const host = {
    fx: () => st.fx,
    editFx: (fn, opts) => { fn(st.fx); st.edits.push(opts); },
    bpm: () => 120,
    gr: () => st.gr,
    locked: id => st.locked.includes(id),
    storage: { get: (k, def) => (st.store.has(k) ? JSON.parse(st.store.get(k)) : def), set: (k, v) => st.store.set(k, JSON.stringify(v)) },
    notify: t => st.notes.push(t),
    racks: () => (o.racks === undefined ? 3 : o.racks),
  };
  if (o.tip) host.tip = o.tip;
  if (o.irs) host.irs = o.irs;
  if (o.v2Fx !== undefined) host.v2Fx = o.v2Fx;
  if (st.s) { host.state = () => st.s; host.edit = (fn, opts) => { fn(st.s); st.sEdits.push(opts); }; }
  const parent = d.createElement('div');
  d.body.appendChild(parent);
  const dsp = o.dsp === undefined ? fakeDsp() : o.dsp;
  const rack = new FXRackUI(parent, host, Object.assign({ embedded: !!o.embedded, dsp }, o.mod === undefined ? {} : { mod: o.mod }));
  return { d, st, rack, host, dsp, root: rack.el };
}
const panelOf = (rack, id) => rack.panels.get(id).el;
const rowOf = (rack, id) => rack.rowEls.find(r => r.row.kind === 'inst' && r.row.id === id);
const menuLabels = d => byCls(byCls(d.body, 'wk-ctx').at(-1), 'wk-cl').map(n => n.textContent);
function pick(d, label, level = -1) {
  const m = byCls(d.body, 'wk-ctx').at(level), it = byCls(m, 'wk-ci').find(n => one(n, 'wk-cl').textContent === label);
  assert.ok(it, 'menu item ' + label + ' in ' + JSON.stringify(byCls(m, 'wk-cl').map(n => n.textContent)));
  if (it.getAttribute('aria-haspopup')) { fire(it, 'pointerenter', { bubbles: false }); return; }
  fire(it, 'pointerdown'); fire(it, 'click');
}
const txt = (rack, id) => one(rack.knobs.get(id).el, 'wk-num').textContent;
const withPrompt = (v, fn) => { globalThis.prompt = () => v; try { return fn(); } finally { delete globalThis.prompt; } };

test('FXRackUI: frame — MAIN / BUS 1 / BUS 2 tabs (racks 3), MAIN only (racks 1), empty notice, structure', () => {
  const { rack, root, st } = mkRack();
  assert.ok(root.classList.contains('fxr-root') && root.classList.contains('fxr2'));
  assert.deepEqual(byCls(root, 'fxr2-tab').map(b => b.textContent), ['MAIN', 'BUS 1', 'BUS 2']);
  assert.equal(byCls(root, 'fxr2-tab')[0].getAttribute('aria-selected'), 'true');
  assert.equal(one(root, 'fxr-empty').hidden, false);
  assert.equal(byCls(root, 'fxr-mod').length, 0);
  // tabs select the rack (a ui-only edit)
  fire(byCls(root, 'fxr2-tab')[2], 'click');
  assert.equal(st.fx.ui.rack, 2);
  assert.deepEqual(st.edits.at(-1), { label: 'FX Rack BUS 2', phase: 'set', ui: true });
  assert.equal(byCls(root, 'fxr2-tab')[2].getAttribute('aria-selected'), 'true');
  rack.destroy();
  assert.equal(root.parentNode, null);
  const b = mkRack({ racks: 1 });
  assert.equal(byCls(b.root, 'fxr2-tab').length, 0);
  b.st.fx.ui.rack = 2; b.rack.refresh();
  assert.equal(b.rack.curRack(), 0);
  b.rack.destroy();
});

test('FXRackUI: + adds instances (ids type, type2 …; the newest variant, on), panels bind every parameter of every type', () => {
  const { rack, st, root, d } = mkRack();
  fire(one(root, 'fxr2-add'), 'click');
  assert.ok(menuLabels(d).includes('Splitter M/S'));
  pick(d, 'Delay');
  const I = st.fx.racks[0].mods[0];
  assert.deepEqual([I.id, I.type, I.v, I.p.on], ['dly', 'dly', 2, 1]);
  assert.deepEqual(st.edits.at(-1), { label: 'Add Delay', phase: 'set', seed: true });
  assert.equal(st.fx.ui.sel, 'dly');
  assert.equal(one(root, 'fxr-empty').hidden, true);
  assert.equal(rack.addInst('dly'), 'dly2');
  // every type: one panel per instance, a widget with data-dest = fx.<id>.<pid> for every parameter (Chorus HPF is the
  // LPF knob's label toggle; MIX / LEVEL share one knob; Bode RETRIG is the SHIFT control's menu item)
  // 16 top-level modules per rack (§2.7): the last type goes to BUS 1
  const types = core.FXTYPES.map(T => T.id).filter(t => t !== 'dly');
  for (const t of types.slice(0, 14)) assert.ok(rack.addInst(t), t);
  assert.equal(rack.addInst('util'), null);
  assert.match(st.notes.at(-1), /No room/);
  rack.setRack(1);
  assert.equal(rack.addInst(types[14]), types[14]);
  rack.setRack(0);
  const L = core.fxLayout(st.fx);
  assert.equal(L.inst.length, 17);
  for (const e of L.inst) {
    if (e.rack !== rack.curRack()) rack.setRack(e.rack);
    const P = rack.panels.get(e.id);
    assert.ok(P, 'panel ' + e.id);
    for (const r of TAB(e.type, e.v)) {
      const id = 'fx.' + e.id + '.' + r.pid;
      if (e.type === 'cho' && r.pid === 'hp') continue;
      if (e.type === 'bode' && r.pid === 'retrig') continue;          // SHIFT's menu item (§13.5, RULINGS2 U3: no widget)
      const w = rack.knobs.get(id);
      assert.ok(w, 'widget ' + id);
      assert.equal(typeof w.setMod, 'function');
      const shared = /\.(mix|level|dmix|dlevel)$/.test(id) && ['level', 'dlevel', 'mix', 'dmix'].includes(r.pid);
      if (!shared) assert.equal(w.el.getAttribute('data-dest'), id, 'data-dest ' + id);
    }
  }
  // Convolve's IR-shaping controls: data-nomod (deviation 20)
  rack.setRack(0);
  const nomod = byAttr(root, 'data-nomod', '1').map(n => n.getAttribute('data-dest')).sort();
  assert.deepEqual(nomod, ['fx.conv.att', 'fx.conv.damp', 'fx.conv.dec', 'fx.conv.minph', 'fx.conv.size', 'fx.conv.tone']);
  // widget kinds
  const kind = id => rack.knobs.get(id).el.className.split(' ')[0];
  assert.equal(kind('fx.dist.mode'), 'wk-menu');
  assert.equal(kind('fx.fil.type'), 'wk-menu');
  assert.equal(kind('fx.rev.type'), 'wk-menu');
  assert.equal(kind('fx.dist.filt'), 'wk-seg');
  assert.equal(kind('fx.cmp.mb'), 'wk-seg');                                        // S2: MODE SINGLE / MULTIBAND
  assert.equal(kind('fx.phs.poles'), 'wk-nb');
  assert.equal(kind('fx.dist.lbh'), 'wk-sl');
  assert.equal(kind('fx.util.invL'), 'wk-tog');
  assert.equal(kind('fx.dly.on'), 'wk-tog');                                         // the panel power = `on`
  // S2 menus list the S2 tables: 18 distortion modes, 108 filter types
  rack.knobs.get('fx.dist.mode').open();
  assert.equal(byCls(d.body, 'wk-mopt').length || byAttr(d.body, 'role', 'option').length, 18);
  rack.knobs.get('fx.dist.mode').close();
  st.fx.racks[0].mods.find(x => x.id === 'dist').p.mode = 1;
  rack.refresh();
  assert.equal(one(rack.knobs.get('fx.dist.mode').el, 'wk-mtxt').textContent, 'Soft Sat.');
  rack.destroy();
});

test('FXRackUI: knobs edit inst.p with phases and instance labels; typed entry; power = `on`, Alt-click switches the whole rack', () => {
  const { rack, st, root } = mkRack({ fx: fx2([inst('dly', 'dly'), inst('dly2', 'dly'), inst('eq', 'eq')], [inst('rev', 'rev')]) });
  const D2 = () => st.fx.racks[0].mods[1];
  const fe = rack.knobs.get('fx.dly2.feed').el;
  fe.focus();
  key(fe, 'ArrowUp');
  near(D2().p.feed, 0.41, 1e-12);
  assert.deepEqual(st.edits.at(-1), { label: 'Delay 2 Feed', phase: 'set' });
  assert.equal(st.fx.racks[0].mods[0].p.feed, TAB('dly', 2).find(r => r.pid === 'feed').def);
  ptr(fe, 'pointerdown', 0, 100); ptr(fe, 'pointermove', 0, 80); ptr(fe, 'pointerup', 0, 80);
  assert.deepEqual(st.edits.slice(-3).map(e => e.phase), ['start', 'move', 'end']);
  key(fe, 'Enter');
  one(fe, 'wk-in').value = '75%';
  key(one(fe, 'wk-in'), 'Enter');
  near(D2().p.feed, 0.75, 1e-12);
  // power button = the `on` parameter
  const pw = one(panelOf(rack, 'dly2'), 'fxr-pw');
  assert.equal(pw.getAttribute('data-dest'), 'fx.dly2.on');
  fire(pw, 'click');
  assert.equal(D2().p.on, 0);
  rack.refresh();
  assert.ok(panelOf(rack, 'dly2').classList.contains('fxr2-off'));
  assert.ok(rowOf(rack, 'dly2').el.classList.contains('fxr2-off'));
  // Alt-click: every module of the rack (MAIN only) follows
  fire(pw, 'click', { altKey: true });
  assert.deepEqual(st.fx.racks[0].mods.map(I => I.p.on), [1, 1, 1]);
  assert.equal(st.fx.racks[1].mods[0].p.on, 1);
  fire(rowOf(rack, 'eq').led.el, 'click', { altKey: true });                          // the list LED too
  assert.deepEqual(st.fx.racks[0].mods.map(I => I.p.on), [0, 0, 0]);
  assert.match(st.edits.at(-1).label, /Disable all MAIN modules/);
  rack.destroy();
});

test('FXRackUI: MIX ↔ LEVEL flip per instance (ui edit) keeps each id’s halo; bypassed chip clears inst.byp', () => {
  const D = inst('dly', 'dly'); D.byp = 1;
  const { rack, st } = mkRack({ fx: fx2([D]) });
  const mixW = rack.knobs.get('fx.dly.mix'), lvlW = rack.knobs.get('fx.dly.level');
  assert.equal(mixW.el, lvlW.el);
  const el = mixW.el;
  assert.equal(el.getAttribute('data-dest'), 'fx.dly.mix');
  mixW.setMod({ arcs: [{ from: 0.3, to: 0.5, kind: 'sel' }] });
  lvlW.setMod({ arcs: [{ from: 0.1, to: 0.2, kind: 'neg' }] });
  const arcs = () => byCls(el, 'wk-arc').filter(n => n.getAttribute('display') !== 'none').map(n => n.getAttribute('class'));
  assert.deepEqual(arcs(), ['wk-arc k-sel']);
  fire(one(el, 'wk-lab'), 'click');
  assert.equal(st.fx.racks[0].mods[0].ui.lvl, 1);
  assert.deepEqual(st.edits.at(-1), { label: 'Mix / Level', phase: 'set', ui: true });
  assert.equal(el.getAttribute('data-dest'), 'fx.dly.level');
  assert.equal(one(el, 'wk-lab').textContent, 'LEVEL');
  assert.equal(one(el, 'wk-num').textContent, '0.0 dB');
  assert.deepEqual(arcs(), ['wk-arc k-neg']);
  // inst.byp (v1 temporary bypass): a chip in the header and the row; a click clears it
  const chip = byCls(panelOf(rack, 'dly'), 'fxr2-chip')[0];
  assert.equal(chip.hidden, false);
  fire(chip, 'click');
  assert.equal(st.fx.racks[0].mods[0].byp, 0);
  assert.equal(byCls(panelOf(rack, 'dly'), 'fxr2-chip')[0].hidden, true);
  rack.destroy();
});

test('FXRackUI: dependent states — Overdrive STAGES, X-Shaper, reverb types, pre-delay sync, multiband, HPF label, delay LINK, filter VAR', () => {
  const R = inst('rev', 'rev');
  const { rack, st } = mkRack({ fx: fx2([inst('dist', 'dist'), R, inst('cmp', 'cmp'), inst('cho', 'cho'), inst('dly', 'dly'), inst('fil', 'fil')]) });
  const I = id => st.fx.racks[0].mods.find(x => x.id === id);
  const hidden = id => rack.knobs.get(id).el.classList.contains('fxr2-hide') || closestHide(rack.knobs.get(id).el);
  const closestHide = el => { for (let n = el; n; n = n.parentNode) if (n.classList && n.classList.contains('fxr2-hide')) return true; return false; };
  // STAGES only for Overdrive (mode 16); the X-Shaper buttons only in the X-Shaper modes
  assert.ok(hidden('fx.dist.stages'));
  I('dist').p.mode = 16 / 17; rack.refresh();
  assert.ok(!hidden('fx.dist.stages'));
  const xs = byCls(panelOf(rack, 'dist'), 'fxr-xs');
  assert.ok(xs.every(b => b.disabled));
  I('dist').p.mode = 12 / 17; rack.refresh();
  assert.ok(xs.every(b => !b.disabled));
  // reverb S2: Plate shows damp / width, Hall decay / spin, Nitrous its MODE seg; PRE-DLY ms ↔ ladder with BPM
  assert.ok(!hidden('fx.rev.damp') && !hidden('fx.rev.width') && hidden('fx.rev.decay') && hidden('fx.rev.nmode') && hidden('fx.rev.chr'));
  I('rev').p.type = 1 / 4; rack.refresh();
  assert.ok(hidden('fx.rev.damp') && !hidden('fx.rev.decay') && !hidden('fx.rev.spinr'));
  I('rev').p.type = 3 / 4; rack.refresh();
  assert.ok(!hidden('fx.rev.nmode') && !hidden('fx.rev.chr') && !hidden('fx.rev.feed') && hidden('fx.rev.decay'));
  assert.ok(!hidden('fx.rev.pre') && hidden('fx.rev.prelad'));
  fire(rack.knobs.get('fx.rev.prebpm').el, 'click');
  rack.refresh();
  assert.ok(hidden('fx.rev.pre') && !hidden('fx.rev.prelad'));
  assert.equal(txt(rack, 'fx.rev.prelad'), '1/4');
  // compressor S2: the multiband group follows MODE
  assert.ok(hidden('fx.cmp.xlo') && hidden('fx.cmp.mbH'));
  fire(byCls(rack.knobs.get('fx.cmp.mb').el, 'wk-sb')[1], 'click');
  assert.equal(I('cmp').p.mb, 1);
  rack.refresh();
  assert.ok(!hidden('fx.cmp.xlo') && !hidden('fx.cmp.gH') && !hidden('fx.cmp.mbH'));
  // chorus S2: a tap on the LPF label switches the filter to HPF (`hp`)
  const lpf = rack.knobs.get('fx.cho.lpf').el;
  assert.equal(one(lpf, 'wk-lab').textContent, 'LPF');
  fire(one(lpf, 'wk-lab'), 'click');
  assert.equal(I('cho').p.hp, 1);
  rack.refresh();
  assert.equal(one(lpf, 'wk-lab').textContent, 'HPF');
  // delay: BPM ladder text, LINK disables the right side
  assert.equal(txt(rack, 'fx.dly.timeL'), '1/4');
  fire(rack.knobs.get('fx.dly.link').el, 'click');
  rack.refresh();
  assert.ok(rack.knobs.get('fx.dly.timeR').el.classList.contains('wk-dis'));
  // FX filter VAR label follows the type
  assert.equal(one(rack.knobs.get('fx.fil.var').el, 'wk-lab').textContent, 'FAT');
  rack.destroy();
});

test('FXRackUI: formats follow the instance (a second delay’s own BPM, the S1 reverb type) and its variant tables', () => {
  const R1 = inst('rev', 'rev', 1); R1.sub.type = 0;
  const D2 = inst('dly2', 'dly'); D2.p.bpm = 0;
  const { rack } = mkRack({ fx: fx2([inst('dly', 'dly'), D2, R1]) });
  assert.equal(txt(rack, 'fx.dly.timeL'), '1/4');
  assert.match(txt(rack, 'fx.dly2.timeL'), /ms$/);
  assert.equal(txt(rack, 'fx.rev.t'), '24 ms');                                       // Plate: pre-delay
  assert.equal(one(rack.knobs.get('fx.rev.t').el, 'wk-lab').textContent, 'PRE DELAY');
  assert.ok(byCls(panelOf(rack, 'rev'), 'fxr2-s1').length === 1);                     // S1 badge
  rack.destroy();
});

test('FXRackUI: splitters — branch rows with + and bypass, selected branch panels nested, add into a branch, no splitters inside', () => {
  const { rack, st, root, d } = mkRack({ fx: fx2([inst('split2', 'split2')]) });
  const S = () => st.fx.racks[0].mods[0];
  assert.deepEqual(byCls(root, 'fxr2-brow').map(n => one(n, 'fxr2-blab').textContent), ['LOWS', 'HIGHS']);
  // + of HIGHS: effects only
  fire(byCls(byCls(root, 'fxr2-brow')[1], 'fxr2-plus')[0], 'click');
  assert.equal(menuLabels(d).includes('Splitter L/H'), false);
  pick(d, 'Utility');
  assert.deepEqual(S().br.map(b => b.map(x => x.id)), [[], ['util']]);
  assert.equal(st.fx.ui.br.split2, 1);                                                // the new module's branch is shown
  rack.refresh();
  const P = rack.panels.get('split2');
  assert.ok(P.brBox.contains(panelOf(rack, 'util')));
  assert.equal(rowOf(rack, 'util').row.depth, 1);
  // the LOWS branch shown: util's panel goes away; its row stays
  fire(byCls(P.el, 'fxr2-bname')[0], 'click');
  assert.equal(st.fx.ui.br.split2, 0);
  assert.deepEqual(st.edits.at(-1), { label: 'Select Branch', phase: 'set', ui: true });
  assert.equal(rack.panels.has('util'), false);
  assert.ok(rowOf(rack, 'util'));
  // branch bypass (bb) from the list and from the panel
  fire(byCls(byCls(root, 'fxr2-brow')[0], 'fxr2-bbyp')[0], 'click');
  assert.deepEqual(S().bb, [1, 0]);
  fire(byCls(P.el, 'fxr2-bbyp')[0], 'click');
  assert.deepEqual(S().bb, [0, 0]);
  // selecting a branch module shows its branch
  fire(rowOf(rack, 'util').name, 'click');
  assert.equal(st.fx.ui.sel, 'util');
  assert.equal(st.fx.ui.br.split2, 1);
  assert.ok(rack.panels.has('util'));
  // split display + crossover knob
  assert.ok(rack.dsp.calls.some(c => c[0] === 'splitResponse' && c[1] === 'split2'));
  assert.equal(txt(rack, 'fx.split2.freq'), '300 Hz');
  rack.destroy();
});

test('FXRackUI: list drag reorders (yellow line), drops into branches, Alt-drag duplicates (Shift-Alt with mods); Alt+arrows', () => {
  const s = core.normalizeSerum(core.defaultSerum());
  s.matrix[0] = Object.assign({}, s.matrix[0], { src: 'lfo1', dst: 'fx.dly.feed', amt: 0.5 });
  const S2 = inst('split2', 'split2');
  const { rack, st, root, d } = mkRack({ fx: fx2([inst('dist', 'dist'), inst('dly', 'dly'), S2]), s });
  const place2 = () => rack.rowEls.forEach((r, i) => place(r.el, 0, i * 30, 170, 28));
  place2();
  place(rack.list, 0, 0, 170, 400);
  // dly (row 1) dragged below the LOWS header (gap 4: dist, dly, split2, LOWS) → into LOWS
  const grip = rowOf(rack, 'dly').grip;
  ptr(grip, 'pointerdown', 160, 45);
  ptr(grip, 'pointermove', 160, 110);
  ptr(grip, 'pointermove', 160, 125);
  const ins = one(root, 'fxr-ins');
  assert.equal(ins.hidden, false);
  assert.equal(ins.style.top, '119px');
  ptr(grip, 'pointerup', 160, 125);
  assert.equal(ins.hidden, true);
  assert.deepEqual(st.fx.racks[0].mods.map(I => I.id), ['dist', 'split2']);
  assert.deepEqual(st.fx.racks[0].mods[1].br[0].map(I => I.id), ['dly']);
  assert.deepEqual(st.edits.at(-1), { label: 'Move FX Module', phase: 'set' });
  // Shift-Alt-drag of dist to the end: a copy with mods (rows re-targeted)
  st.s.matrix[1] = Object.assign({}, st.s.matrix[1], { src: 'env2', dst: 'fx.dist.drive', amt: 0.3 });
  place2();
  const g2 = rowOf(rack, 'dist').grip;
  ptr(g2, 'pointerdown', 160, 15, { altKey: true, shiftKey: true });
  ptr(g2, 'pointermove', 160, 300, { altKey: true, shiftKey: true });
  ptr(g2, 'pointerup', 160, 300, { altKey: true, shiftKey: true });
  assert.deepEqual(st.fx.racks[0].mods.map(I => I.id), ['dist', 'split2', 'dist2']);
  assert.ok(st.s.matrix.some(r => r.dst === 'fx.dist2.drive' && r.src === 'env2'));
  assert.ok(st.s.matrix.some(r => r.dst === 'fx.dist.drive'));
  // a splitter dragged into a branch: refused with a notice
  place2();
  const g3 = rowOf(rack, 'split2').grip;
  ptr(g3, 'pointerdown', 160, 45);
  ptr(g3, 'pointermove', 160, 100);
  ptr(g3, 'pointerup', 160, 100);
  assert.deepEqual(st.fx.racks[0].mods.map(I => I.id), ['dist', 'split2', 'dist2']);
  assert.match(st.notes.at(-1), /Splitters cannot go into a branch/);
  // Alt+↑ / ↓ on a row's name
  const nm = rowOf(rack, 'dist2').name;
  nm.focus();
  key(nm, 'ArrowUp', { altKey: true });
  assert.deepEqual(st.fx.racks[0].mods.map(I => I.id), ['dist', 'dist2', 'split2']);
  assert.equal(d.activeElement, rowOf(rack, 'dist2').name);
  rack.destroy();
});

test('FXRackUI: touch list drag — the ≡ grip (touch-action: none) drags on its first px of travel, any direction, with no hold; one finger only', () => {
  const { rack, st, root } = mkRack({ fx: fx2([inst('dist', 'dist'), inst('dly', 'dly'), inst('rev', 'rev')]) });
  rack.rowEls.forEach((r, i) => place(r.el, 0, i * 30, 170, 28));
  place(rack.list, 0, 0, 170, 400);
  const ins = one(root, 'fxr-ins'), order = () => st.fx.racks[0].mods.map(I => I.id);
  const T = (n, type, x, y, o) => ptr(n, type, x, y, Object.assign({ pointerType: 'touch', pointerId: 7, isPrimary: true }, o));
  const mv = (n, x, y) => { T(n, 'pointermove', x, y); return fire(n, 'touchmove', { touches: [{ clientX: x, clientY: y }] }); };
  // dist (row 0) pressed and moved at once — no 250 ms wait: within the 6 px touch slop nothing starts, past it the drag runs
  let grip = rowOf(rack, 'dist').grip;
  T(grip, 'pointerdown', 160, 15);
  assert.equal(mv(grip, 160, 19).defaultPrevented, false);
  assert.equal(ins.hidden, true, 'undecided inside the touch slop');
  assert.equal(mv(grip, 160, 40).defaultPrevented, true, 'a drag: the touchmove is cancelled (no page scroll, no pointercancel)');
  assert.equal(ins.hidden, false, 'the insertion line shows');
  mv(grip, 160, 75);
  T(grip, 'pointerup', 160, 75);
  fire(grip, 'click');
  assert.equal(ins.hidden, true);
  assert.deepEqual(order(), ['dly', 'rev', 'dist'], 'dropped below rev');
  assert.deepEqual(st.edits.at(-1), { label: 'Move FX Module', phase: 'set' });
  // sideways travel starts it too (nothing scrolls under the grip)
  rack.rowEls.forEach((r, i) => place(r.el, 0, i * 30, 170, 28));
  grip = rowOf(rack, 'rev').grip;
  T(grip, 'pointerdown', 160, 45);
  mv(grip, 150, 46);
  assert.equal(ins.hidden, false);
  mv(grip, 150, 2);
  T(grip, 'pointerup', 150, 2);
  assert.deepEqual(order(), ['rev', 'dly', 'dist']);
  // a second finger before the travel (a pinch): no drag
  rack.rowEls.forEach((r, i) => place(r.el, 0, i * 30, 170, 28));
  grip = rowOf(rack, 'dist').grip;
  T(grip, 'pointerdown', 160, 75);
  fire(grip, 'touchmove', { touches: [{ clientX: 160, clientY: 76 }, { clientX: 100, clientY: 200 }] });
  mv(grip, 160, 10);
  T(grip, 'pointerup', 160, 10);
  assert.equal(ins.hidden, true);
  assert.deepEqual(order(), ['rev', 'dly', 'dist'], 'unchanged');
  rack.destroy();
});

test('FXRackUI: module menu — presets (v2 payloads, locks kept, v1 payloads read), default preset, duplicate, move, remove, convert, init', () => {
  const s = core.normalizeSerum(core.defaultSerum());
  s.matrix[0] = Object.assign({}, s.matrix[0], { src: 'lfo1', dst: 'fx.cho.depth', amt: 0.5 });
  s.locks.p.push('fx.cho.depth');
  const { rack, st, d } = mkRack({ fx: fx2([inst('cho', 'cho'), inst('phs', 'phs', 1)]), s });
  const C = () => st.fx.racks[0].mods.find(x => x.id === 'cho');
  C().p.depth = 0.2; C().p.feed = 0.3; C().sub.mono = 1;
  rack.refresh();
  const open = id => fire(one(panelOf(rack, id), 'fxr-pre'), 'click');
  open('cho');
  assert.deepEqual(menuLabels(d), ['Factory', 'Save FX Preset…', 'Save as Default Preset', 'Duplicate FX Module', 'Duplicate FX Module (w/mods)', 'Move to',
    'Remove FX Module', 'Init Module']);
  // Factory ▸ = fx-core FACTORY_FX_PRESETS of the type
  pick(d, 'Factory');
  assert.deepEqual(menuLabels(d), core.FACTORY_FX_PRESETS.cho.map(p => p.name));
  st.locked = ['fx.cho.depth'];
  pick(d, 'Airy Chorus');
  assert.equal(C().p.hp, 1);
  assert.equal(C().p.depth, 0.2);                                                     // locked (host.locked): kept
  assert.equal(C().p.on, 1);
  assert.deepEqual(st.edits.at(-1), { label: 'Load Chorus Preset', phase: 'set', seed: true });
  st.locked = [];
  C().p.hp = 0; C().p.feed = 0.3; C().sub.mono = 1;
  rack.refresh();
  open('cho');
  withPrompt('Thin', () => pick(d, 'Save FX Preset…'));
  const saved = JSON.parse(st.store.get('synth.fxmod.cho'));
  assert.equal(saved.length, 1);
  assert.deepEqual([saved[0].type, saved[0].v, saved[0].name, saved[0].ftype, saved[0].fv], ['synth.fxmod', 2, 'Thin', 'cho', 2]);
  assert.equal(saved[0].p.depth, 0.2);
  assert.equal('on' in saved[0].p, false);
  assert.deepEqual(saved[0].sub, { mono: 1 });
  // change, lock one value (host.locked = Serum locks), load the preset back
  C().p.depth = 0.9; C().p.feed = 0.6; C().sub.mono = 0; C().p.on = 0;
  st.locked = ['fx.cho.feed'];
  rack.refresh();
  open('cho');
  pick(d, 'Thin');
  assert.equal(C().p.depth, 0.2);
  assert.equal(C().p.feed, 0.6);                                                      // locked
  assert.equal(C().sub.mono, 1);
  assert.equal(C().p.on, 0);                                                          // never the enable
  assert.deepEqual(st.edits.at(-1), { label: 'Load Chorus Preset', phase: 'set', seed: true });
  // a Phase-1 (v1) preset stored under the same key is listed and applied by pid
  st.store.set('synth.fxmod.cho', JSON.stringify(saved.concat([{ name: 'Old', m: 'cho', p: { 'fx.cho.depth': 0.5, 'fx.cho.lpf': 0.25 }, sub: { mono: 0 } }])));
  st.locked = [];
  open('cho');
  assert.ok(menuLabels(d).includes('Old') && menuLabels(d).includes('Delete FX Preset'));
  pick(d, 'Old');
  assert.equal(C().p.depth, 0.5);
  assert.equal(C().p.lpf, 0.25);
  // Save as Default Preset: new instances of the type start from it; Clear Default Preset
  open('cho');
  pick(d, 'Save as Default Preset');
  const def = JSON.parse(st.store.get('synth.fxmod.default.cho'));
  assert.equal(def.ftype, 'cho');
  assert.equal(rack.addInst('cho'), 'cho2');
  assert.equal(st.fx.racks[0].mods.find(x => x.id === 'cho2').p.depth, 0.5);
  assert.equal(st.fx.racks[0].mods.find(x => x.id === 'cho2').p.on, 1);
  open('cho');
  pick(d, 'Clear Default Preset');
  assert.equal(JSON.parse(st.store.get('synth.fxmod.default.cho')), null);
  assert.equal(rack.addInst('cho'), 'cho3');
  assert.equal(st.fx.racks[0].mods.find(x => x.id === 'cho3').p.depth, TAB('cho', 2).find(r => r.pid === 'depth').def);
  // Duplicate (w/mods): placed after the source, rows copied onto the new id
  open('cho');
  pick(d, 'Duplicate FX Module (w/mods)');
  assert.deepEqual(st.fx.racks[0].mods.map(x => x.id), ['cho', 'cho4', 'phs', 'cho2', 'cho3']);
  assert.ok(st.s.matrix.some(r => r.dst === 'fx.cho4.depth'));
  // Move to ▸ BUS 1
  open('cho4');
  pick(d, 'Move to');
  pick(d, 'BUS 1');
  assert.deepEqual(st.fx.racks[1].mods.map(x => x.id), ['cho4']);
  assert.equal(st.fx.ui.rack, 1);
  // Remove: the instance, its rows, locks and MIDI map entries
  st.s.midi = { 20: 'fx.cho.depth' };
  fire(byCls(rack.el, 'fxr2-tab')[0], 'click');
  open('cho');
  pick(d, 'Remove FX Module');
  assert.equal(st.fx.racks[0].mods.some(x => x.id === 'cho'), false);
  assert.equal(st.s.matrix.some(r => r.dst === 'fx.cho.depth'), false);
  assert.equal(st.s.locks.p.includes('fx.cho.depth'), false);
  assert.deepEqual(st.s.midi, {});
  assert.ok(st.s.matrix.some(r => r.dst === 'fx.cho4.depth'));                        // other instances keep theirs
  // Convert to Serum 2 Module (S1 phaser): same pids keep n, POLES 6 (Phase-1 sound), DEPTH 2 0
  const Ph = () => st.fx.racks[0].mods.find(x => x.id === 'phs');
  Ph().p.depth = 0.66;
  rack.refresh();
  open('phs');
  assert.ok(menuLabels(d).includes('Convert to Serum 2 Module'));
  pick(d, 'Convert to Serum 2 Module');
  assert.equal(Ph().v, 2);
  assert.equal(Ph().p.depth, 0.66);
  near(core.lawValue('fx.q.poles', Ph().p.poles, { v: 2, racks: [{ mods: [Object.assign(inst('q', 'phs'), { p: Ph().p })], byp: 0, lock: 0, route: 0 }, { mods: [] }, { mods: [] }] }), 6, 1e-9);
  assert.equal(Ph().p.depth2, 0);
  assert.ok(rack.knobs.has('fx.phs.poles'));                                          // the panel was rebuilt as S2
  // Init Module: table defaults, `on` kept
  Ph().p.on = 0;
  open('phs');
  pick(d, 'Init Module');
  assert.equal(Ph().p.depth, TAB('phs', 2).find(r => r.pid === 'depth').def);
  assert.equal(Ph().p.on, 0);
  rack.destroy();
});

test('FXRackUI: reverb S1 → S2 conversion maps Plate t → pre-delay, c → damp, w → width (confirmed)', () => {
  const R = inst('rev', 'rev', 1); R.sub.type = 0; R.p.t = 0.5; R.p.c = 0.4; R.p.w = 0.7; R.p.size = 0.6; R.p.on = 1;
  const { rack, st, d } = mkRack({ fx: fx2([R]) });
  globalThis.confirm = () => true;
  try {
    fire(one(panelOf(rack, 'rev'), 'fxr-pre'), 'click');
    pick(d, 'Convert to Serum 2 Module');
  } finally { delete globalThis.confirm; }
  const I = st.fx.racks[0].mods[0];
  assert.deepEqual([I.v, I.p.type, I.p.size, I.p.damp, I.p.width, I.p.on], [2, 0, 0.6, 0.4, 0.7, 1]);
  assert.deepEqual(I.sub, {});
  assert.equal(txt(rack, 'fx.rev.pre'), '100 ms');
  rack.destroy();
});

test('FXRackUI: rack menu — cut / copy / paste / clear FX Bus, locks, rack presets, effect chains (v2 files, v1 read), reset', () => {
  const { rack, st, d, root } = mkRack({ fx: fx2([inst('rev', 'rev'), inst('dly', 'dly')], [inst('dly2', 'dly')]) });
  const more = byCls(root, 'fxr-more').find(b => b.textContent === '⋯');
  fire(more, 'click');
  assert.deepEqual(menuLabels(d), ['Add', 'Cut FX Bus', 'Copy FX Bus', 'Paste FX Bus', 'Clear FX Bus', 'Lock FX Bus', 'Lock All FX Busses',
    'Load FX Bus…', 'Save FX Bus…', 'Export FX Bus…', 'Load Effect Chain…', 'Save Effect Chain…', 'Export Effect Chain…', 'Reset All Racks']);
  pick(d, 'Copy FX Bus');
  // paste into BUS 2: copies with ids made unique in the track
  rack.setRack(2);
  fire(more, 'click');
  pick(d, 'Paste FX Bus');
  assert.deepEqual(st.fx.racks[2].mods.map(x => x.id), ['rev2', 'dly3']);
  assert.deepEqual(st.edits.at(-1), { label: 'Paste FX Bus', phase: 'set', seed: true });
  // Lock FX Bus / Lock All (real state, not ui)
  fire(more, 'click');
  pick(d, 'Lock FX Bus');
  assert.deepEqual(st.fx.racks.map(R => R.lock), [0, 0, 1]);
  fire(more, 'click');
  pick(d, 'Lock All FX Busses');
  assert.deepEqual(st.fx.racks.map(R => R.lock), [1, 1, 1]);
  assert.equal(byCls(root, 'fxr2-tab')[0].classList.contains('fxr2-tlock'), true);
  // Save FX Bus… → synth.fxracks; Clear; Load it back
  withPrompt('Wide', () => { fire(more, 'click'); pick(d, 'Save FX Bus…'); });
  const lib = JSON.parse(st.store.get('synth.fxracks'));
  assert.deepEqual([lib[0].type, lib[0].v, lib[0].name, lib[0].rack.mods.map(x => x.type)], ['synth.fxrack', 1, 'Wide', ['rev', 'dly']]);
  fire(more, 'click');
  pick(d, 'Clear FX Bus');
  assert.deepEqual(st.fx.racks[2].mods, []);
  fire(more, 'click');
  pick(d, 'Load FX Bus…');
  pick(d, 'Wide');
  assert.deepEqual(st.fx.racks[2].mods.map(x => x.id), ['rev2', 'dly3']);
  // Cut FX Bus empties it and fills the clipboard
  fire(more, 'click');
  pick(d, 'Cut FX Bus');
  assert.deepEqual(st.fx.racks[2].mods, []);
  // effect chains: the whole FX state, saved without ui and locks; loading keeps ui and every rack's lock
  withPrompt('Big Room', () => { fire(more, 'click'); pick(d, 'Save Effect Chain…'); });
  const chains = JSON.parse(st.store.get('synth.fxchains'));
  assert.equal(chains[0].name, 'Big Room');
  assert.equal(chains[0].fx.v, 2);
  assert.equal('ui' in chains[0].fx, false);
  assert.deepEqual(chains[0].fx.racks.map(R => R.lock), [0, 0, 0]);
  fire(more, 'click');
  pick(d, 'Reset All Racks');
  assert.deepEqual(st.fx.racks.map(R => R.mods.length), [0, 0, 0]);
  assert.deepEqual(st.fx.racks.map(R => R.lock), [0, 0, 0]);
  assert.equal(st.edits.at(-1).seed, true);
  st.fx.racks[0].lock = 1;
  fire(more, 'click');
  pick(d, 'Load Effect Chain…');
  pick(d, 'Big Room');
  assert.deepEqual(st.fx.racks.map(R => R.mods.map(x => x.id)), [['rev', 'dly'], ['dly2'], []]);
  assert.deepEqual(st.fx.racks.map(R => R.lock), [1, 0, 0]);
  assert.deepEqual(st.edits.at(-1), { label: 'Load Effect Chain', phase: 'set', seed: true });
  // files: v2 library form; a v1 chain file imports (migrated to v2)
  const saved = [];
  const prevURL = globalThis.URL, prevBlob = globalThis.Blob;
  globalThis.Blob = class { constructor(parts) { this.text = parts.join(''); } };
  globalThis.URL = { createObjectURL: b => { saved.push(b.text); return 'blob:x'; }, revokeObjectURL: () => {} };
  try { withPrompt('Jet', () => { fire(more, 'click'); pick(d, 'Export Effect Chain…'); }); } finally { globalThis.URL = prevURL; globalThis.Blob = prevBlob; }
  const file = JSON.parse(saved[0]);
  assert.deepEqual([file.type, file.v, file.chains[0].name, file.chains[0].fx.v], ['synth.fxchains', 2, 'Jet', 2]);
  const v1 = defFx(); v1.p['fx.phs.on'] = 1;
  assert.equal(rack.importText(JSON.stringify({ type: 'synth.fxchains', v: 1, chains: [{ name: 'Old', fx: v1 }] })), 1);
  // the shared library (serum-ui's chain menu reads it too) stores the imported v1 chain migrated (v2, Phaser S1;
  // RULINGS2 F1: FX state v2 everywhere)
  const old = JSON.parse(st.store.get('synth.fxchains')).find(c => c.name === 'Old');
  assert.deepEqual([old.fx.v, old.fx.racks[0].mods.map(x => [x.id, x.v, x.p.on]), 'ui' in old.fx], [2, [['phs', 1, 1]], false]);
  assert.deepEqual(rack.chains().find(c => c.name === 'Old').fx.racks[0].mods.map(x => [x.id, x.v]), [['phs', 1]]);
  assert.equal(JSON.parse(st.store.get('synth.fxchains')).find(c => c.name === 'Big Room').fx.v, 2);   // S2 modules: v2
  assert.throws(() => rack.importText('{"nope":1}'));
  // Factory ▸ lists fx-core's factory chains (v1 or v2), loaded as v2
  fire(more, 'click');
  pick(d, 'Load Effect Chain…');
  pick(d, 'Factory');
  assert.deepEqual(menuLabels(d), core.FACTORY_CHAINS2.chains.map(c => c.name));
  pick(d, 'Dub Delay');
  assert.ok(st.fx.racks[0].mods.some(x => x.type === 'dly'));
  rack.destroy();
});

test('FXRackUI: rack background right-click opens the rack menu; panels keep their own (mod layer) menus', () => {
  const { rack, d } = mkRack({ fx: fx2([inst('eq', 'eq')]) });
  const e = fire(rack.rack, 'contextmenu', { clientX: 4, clientY: 4 });
  assert.ok(e.defaultPrevented);
  assert.ok(menuLabels(d).includes('Cut FX Bus'));
  const e2 = fire(panelOf(rack, 'eq'), 'contextmenu', { clientX: 4, clientY: 4 });
  assert.equal(e2.defaultPrevented, false);
  rack.destroy();
});

test('FXRackUI: a v1 host state is shown migrated, kept v1 by edits the v1 shape holds, converted in place by the first one it cannot (host.v2Fx)', () => {
  const v1 = defFx(); v1.p['fx.dly.on'] = 1; v1.p['fx.dly.feed'] = 0.7; v1.lock = 1;
  const { rack, st, root } = mkRack({ fx: v1, racks: 3, v2Fx: true });
  const obj = st.fx;
  assert.deepEqual([...rack.panels.keys()], ['dly']);
  assert.equal(txt(rack, 'fx.dly.feed'), '70%');
  assert.equal(st.fx.v, 1);                                                           // untouched until an edit
  // a parameter edit: written back into the same v1 object (the Phase-1 host keeps its state)
  const fe = rack.knobs.get('fx.dly.feed').el;
  fe.focus(); key(fe, 'ArrowDown');
  assert.equal(st.fx, obj);
  assert.equal(st.fx.v, 1);
  near(st.fx.p['fx.dly.feed'], 0.69, 1e-12);
  assert.equal(st.fx.lock, 1);
  assert.equal(txt(rack, 'fx.dly.feed'), '69%');
  // view-only state (the rack tab) has no v1 field: kept for the session, the state stays v1
  fire(byCls(root, 'fxr2-tab')[1], 'click');
  assert.equal(rack.curRack(), 1);
  assert.equal(st.fx.v, 1);
  fire(byCls(root, 'fxr2-tab')[0], 'click');
  // a Phase-1 module added (Hyper: S1 only) and edited (Dimension SIZE → fx.dim.size); the MIX / LEVEL flip → ui.lvl
  assert.equal(rack.addInst('hyper'), 'hyper');
  assert.equal(st.fx.v, 1);
  assert.equal(st.fx.p['fx.hyper.on'], 1);
  // the present modules take their slots in the rack's order (Hyper after Delay); the others keep theirs
  assert.deepEqual(st.fx.order, ['dly', 'dist', 'flg', 'phs', 'cho', 'hyper', 'cmp', 'rev', 'eq', 'fil']);
  rack.setP('hyper', 'dsize', 0.8, 'set');
  assert.equal(st.fx.p['fx.dim.size'], 0.8);
  assert.equal('fx.hyper.dsize' in st.fx.p, false);
  // Remove FX Module: the module at its v1 defaults, disabled (and left out of the view)
  rack.removeInst('dly');
  assert.equal(st.fx.v, 1);
  assert.deepEqual([st.fx.p['fx.dly.on'], st.fx.p['fx.dly.feed']], [DEF['fx.dly.on'], DEF['fx.dly.feed']]);
  assert.deepEqual([...rack.panels.keys()], ['hyper']);
  // an S2 module cannot live in a v1 state: the state converts to v2 in place (lock kept, Hyper stays S1)
  assert.equal(rack.addInst('dly'), 'dly');
  assert.equal(st.fx, obj);
  assert.equal(st.fx.v, 2);
  assert.equal('p' in st.fx, false);
  assert.equal(st.fx.racks[0].lock, 1);
  assert.deepEqual(st.fx.racks[0].mods.map(I => [I.id, I.v]), [['hyper', 1], ['dly', 2]]);
  near(st.fx.racks[0].mods[0].p.dsize, 0.8, 1e-12);
  rack.destroy();
});

test('FXRackUI: displays use the DSP helpers per instance; drags edit two parameters; X-Shaper popover edits inst.sub', () => {
  const { rack, st, dsp, d } = mkRack({ fx: fx2([inst('eq0', 'eq'), inst('dist', 'dist'), inst('dly', 'dly'), inst('fil', 'fil'), inst('eq', 'eq')]) });
  const I = id => st.fx.racks[0].mods.find(x => x.id === id);
  I('dist').p.mode = 16 / 17; I('dist').p.stages = 7 / 15;
  rack.refresh();
  const names = dsp.calls.map(c => c[0]);
  for (const n of ['distCurve', 'eqResponse', 'delayFilterResponse', 'filterImpulse']) assert.ok(names.includes(n), n);
  assert.deepEqual(dsp.calls.filter(c => c[0] === 'distCurve').at(-1).slice(1), [16, 0.25 * 1, 1025, 1025, 129, 8]);
  assert.deepEqual(dsp.calls.filter(c => c[0] === 'eqResponse').map(c => c[2]).sort(), [0, 4]);   // each EQ by its FXP index
  const n0 = dsp.calls.length;
  rack.refresh();
  assert.equal(dsp.calls.length, n0, 'unchanged parameters: no redraw');
  // delay filter display: a click edits nothing; a drag moves F (x, log axis) and Q (y)
  const dd = one(panelOf(rack, 'dly'), 'fxr-dlyf');
  place(dd, 0, 0, 212, 74);
  const q0 = I('dly').p.q, ne = st.edits.length;
  ptr(dd, 'pointerdown', 106, 30); ptr(dd, 'pointerup', 106, 30);
  assert.equal(st.edits.length, ne);
  ptr(dd, 'pointerdown', 106, 30); ptr(dd, 'pointermove', 156, 14.5); ptr(dd, 'pointerup', 156, 14.5);
  near(I('dly').p.q, Math.min(1, q0 + 15.5 / 62), 1e-9);
  assert.deepEqual(st.edits.slice(ne).map(e => e.phase), ['start', 'move', 'end']);
  assert.equal(st.edits[ne].label, 'Delay Filter');
  // transfer display: vertical drag = DRIVE
  const xf = one(panelOf(rack, 'dist'), 'fxr-xfer');
  place(xf, 0, 0, 78, 74);
  const dr0 = I('dist').p.drive;
  ptr(xf, 'pointerdown', 30, 50); ptr(xf, 'pointermove', 30, 20); ptr(xf, 'pointerup', 30, 20);
  assert.ok(I('dist').p.drive > dr0);
  // X-Shaper A popover (X-Shaper modes)
  I('dist').p.mode = 11 / 17;
  rack.refresh();
  fire(byCls(panelOf(rack, 'dist'), 'fxr-xs')[0], 'click');
  const pop = one(panelOf(rack, 'dist'), 'fxr-xpop');
  assert.equal(pop.getAttribute('aria-label'), 'X-Shaper A');
  const ed = one(pop, 'gx-xshape');
  place(ed, 0, 0, 214, 180);
  fire(ed, 'dblclick', { clientX: 7 + 0.5 * 200, clientY: 7 + 0.25 * 166 });
  assert.deepEqual(I('dist').sub.xa.map(q => q.slice(0, 2)), [[0, 0], [0.5, 0.75], [1, 1]]);
  key(ed, 'Escape');
  assert.equal(one(panelOf(rack, 'dist'), 'fxr-xpop'), null);
  rack.destroy();
});

test('FXRackUI: without a DSP the displays degrade and loadDSP is requested; GR meters read host.gr() at 4·(fxLayout index)', async () => {
  delete globalThis.FXDSP; delete globalThis.SerumDSP;
  const { rack, st, d } = mkRack({ dsp: null, fx: fx2([inst('eq', 'eq')]) });
  assert.ok(d.scripts.length >= 1);
  const FX = fakeDsp();
  globalThis.FXDSP = FX;
  for (const s of d.scripts) fire(s, 'load', { bubbles: false });
  await new Promise(r => setTimeout(r, 0));
  assert.ok(FX.calls.some(c => c[0] === 'eqResponse'));
  delete globalThis.FXDSP;
  rack.destroy();
  raf.install();
  try {
    const g = mkRack({ fx: fx2([inst('eq', 'eq')], [inst('cmp', 'cmp')]) });
    g.st.gr = new Float32Array(4 * 48);
    g.st.gr[4] = 6;                                                                    // FXP instance 1 = the BUS 1 compressor
    g.rack.setRack(1);
    const ctx = one(g.root, 'fxr-gr').getContext('2d');
    ctx.calls.length = 0;
    raf.flush(1, 100);
    assert.ok(ctx.calls.some(c => c[0] === 'fillText' && c[1] === '-6.0'));
    g.rack.setRack(0);
    raf.flush(2, 200);
    assert.equal(raf.pending, 0);                                                      // no compressor shown: the loop stops
    g.rack.destroy();
  } finally { raf.uninstall(); }
});

test('FXRackUI: Convolve — IMPULSE menu from host.irs, Load IR… imports, the IR overview is requested', async () => {
  const calls = [];
  const irs = {
    list: k => { calls.push(['list', k]); return [{ id: 'fir:Medium/Chamber', name: 'Chamber', folder: 'Medium' }, { id: 'fir:Cab/4x12', name: '4x12', folder: 'Cab' }, { id: 'ir:abc', name: 'Mine', user: true }]; },
    import: (files, o) => { calls.push(['import', files.length, o.kind]); return Promise.resolve('ir:new'); },
    overview: (id, n) => { calls.push(['overview', id, n]); return Promise.resolve(new Float32Array(2 * n).fill(0.5)); },
  };
  const { rack, st, root } = mkRack({ fx: fx2([inst('conv', 'conv')]), irs });
  const m = byCls(panelOf(rack, 'conv'), 'fxr2-irn')[0];
  assert.equal(one(m, 'wk-mtxt').textContent, 'Chamber');
  fire(one(m, 'wk-next'), 'click');                                                   // ▶ steps inside the folder (one item: stays)
  fire(one(m, 'wk-mbtn'), 'click');
  const opt = byAttr(root.ownerDocument.body, 'role', 'option').find(n => n.textContent.includes('4x12'));
  fire(opt, 'click');
  assert.equal(st.fx.racks[0].mods[0].sub.ir, 'fir:Cab/4x12');
  assert.match(st.edits.at(-1).label, /Convolve Impulse/);
  await new Promise(r => setTimeout(r, 0));
  assert.ok(calls.some(c => c[0] === 'overview' && c[1] === 'fir:Cab/4x12' && c[2] === 256));
  await rack.importIr('conv', [{ name: 'x.wav' }]);
  assert.deepEqual(calls.find(c => c[0] === 'import'), ['import', 1, 'ir']);
  assert.equal(st.fx.racks[0].mods[0].sub.ir, 'ir:new');
  // the shaping knobs carry data-nomod and say why in their tooltip
  assert.equal(rack.knobs.get('fx.conv.size').el.getAttribute('data-nomod'), '1');
  assert.equal(rack.knobs.get('fx.conv.irgain').el.hasAttribute('data-nomod'), false);
  // the display asks for the SHAPED IR (compileFx iIr: <ir>@<rate>~<shapeKey>) once the shaping values rest 120 ms
  const sidOf = () => core.compileFx(st.fx, { bpm: 120 }).iIr[0];
  const sid0 = sidOf();
  assert.match(sid0, /^ir:new@48000~[0-9a-f]{8}$/);
  assert.equal(rack.shapedIr('conv'), sid0);
  await new Promise(r => setTimeout(r, 160));
  assert.ok(calls.some(c => c[0] === 'overview' && c[1] === sid0 && c[2] === 256));
  // SIZE moved twice within 120 ms: only the resting value's shaped IR is requested
  rack.setP('conv', 'size', 0.6, 'move');
  rack.refresh();
  const sid1 = sidOf();
  rack.setP('conv', 'size', 0.7, 'move');
  rack.refresh();
  const sid2 = sidOf();
  assert.ok(sid1 !== sid0 && sid2 !== sid1);
  await new Promise(r => setTimeout(r, 160));
  assert.equal(calls.some(c => c[0] === 'overview' && c[1] === sid1), false);
  assert.ok(calls.some(c => c[0] === 'overview' && c[1] === sid2));
  rack.destroy();
});

test('FXRackUI: control context menu only without a mod layer (mod: false; default = not embedded); tooltips through host.tip; expand toggle (Alt+F)', () => {
  const a = mkRack({ fx: fx2([inst('eq', 'eq')]), tip: id => (id === 'fx.eq.gainL' ? 'EQ Gain L: +3.0 dB\nLFO 1 +50% ->' : null) });
  const g = a.rack.knobs.get('fx.eq.gainL').el;
  a.st.fx.racks[0].mods[0].p.gainL = 0.9;
  const e = fire(g, 'contextmenu', { clientX: 3, clientY: 3 });
  assert.ok(e.defaultPrevented);
  assert.deepEqual(menuLabels(a.d), ['Reset Control', 'Enter Value…']);
  pick(a.d, 'Reset Control');
  assert.equal(a.st.fx.racks[0].mods[0].p.gainL, 0.5);
  key(a.d.body, 'Shift');
  a.rack.knobs.get('fx.eq.qH').el.focus();
  g.focus();
  assert.equal(a.d.getElementById('wk-tip').textContent, 'EQ Gain L: +3.0 dB\nLFO 1 +50% ->');
  a.rack.knobs.get('fx.eq.qL').el.focus();
  assert.match(a.d.getElementById('wk-tip').textContent, /^Equalizer .+: .+$/);
  // Alt+F / the ⤢ button: expanded rack view (ui edit)
  key(a.root, 'f', { altKey: true, code: 'KeyF' });
  assert.equal(a.st.fx.ui.expand, 1);
  assert.ok(a.root.classList.contains('fxr2-expand'));
  assert.deepEqual(a.st.edits.at(-1), { label: 'Expand FX', phase: 'set', ui: true });
  a.rack.destroy();
  assert.equal(a.root.getAttribute('data-fxmod'), '0');
  const b = mkRack({ embedded: true, fx: fx2([inst('eq', 'eq')]) });
  assert.ok(b.root.classList.contains('fxr-embedded'));
  assert.equal(b.root.getAttribute('data-fxmod'), '1');
  assert.equal(fire(b.rack.knobs.get('fx.eq.gainL').el, 'contextmenu', { clientX: 3, clientY: 3 }).defaultPrevented, false);
  b.rack.destroy();
  // embedded without modulation (mod: false): the rack's own control menu again
  const c = mkRack({ embedded: true, mod: false, fx: fx2([inst('eq', 'eq')]) });
  assert.equal(fire(c.rack.knobs.get('fx.eq.gainL').el, 'contextmenu', { clientX: 3, clientY: 3 }).defaultPrevented, true);
  assert.deepEqual(menuLabels(c.d), ['Reset Control', 'Enter Value…']);
  c.rack.destroy();
});

test('FXRackUI: displays redraw on resize (ResizeObserver on the rack)', () => {
  const obs = [];
  globalThis.ResizeObserver = class { constructor(fn) { this.fn = fn; this.els = []; this.off = false; obs.push(this); } observe(el) { this.els.push(el); } disconnect() { this.off = true; } };
  try {
    const { rack, dsp } = mkRack({ fx: fx2([inst('dly', 'dly')]) });
    assert.deepEqual(obs[0].els, [rack.rack]);
    const dd = one(panelOf(rack, 'dly'), 'fxr-dlyf');
    place(dd, 0, 0, 212, 74);
    Object.defineProperty(dd, 'clientWidth', { value: 210, configurable: true });
    Object.defineProperty(dd, 'clientHeight', { value: 72, configurable: true });
    const n0 = dsp.calls.length;
    obs[0].fn([]);
    assert.ok(dsp.calls.length > n0);
    const cv = dd.childNodes.find(n => n.localName === 'canvas');
    assert.deepEqual([cv.width, cv.height], [210, 72]);
    const n1 = dsp.calls.length;
    obs[0].fn([]);
    assert.equal(dsp.calls.length, n1);
    rack.destroy();
    assert.equal(obs[0].off, true);
  } finally { delete globalThis.ResizeObserver; }
});

test('FXRackUI.lockedIds: dynamic ids of existing instances (SPEC-serum2 §3.11.1); no static-index FX test', () => {
  const { rack, st, host } = mkRack({ fx: fx2([inst('cho', 'cho'), inst('rev2', 'rev')]) });
  host.locked = () => true;
  assert.deepEqual(rack.lockedIds(), TAB('cho', 2).map(r => 'fx.cho.' + r.pid).concat(TAB('rev', 2).map(r => 'fx.rev2.' + r.pid)));
  host.locked = id => st.locked.includes(id);
  st.locked = ['fx.cho.feed', 'a.level', 'g.master', 'fx.rev2.size', 'fx.gone.x'];
  assert.deepEqual(rack.lockedIds(), ['fx.cho.feed', 'fx.rev2.size']);
  delete host.locked;
  assert.deepEqual(rack.lockedIds(), []);
  rack.destroy();
  const src = readFileSync(new URL('../fx-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, />=\s*(?:core\.)?NS\b/);
});

test('FXRackUI: refresh follows external state (undo, preset load): panels rebuilt by id / type / variant, order restored', () => {
  const { rack, st, root } = mkRack({ fx: fx2([inst('dist', 'dist'), inst('eq', 'eq')]) });
  const P0 = rack.panels.get('eq');
  st.fx = fx2([inst('eq', 'eq'), inst('dist', 'dist', 1)]);                           // a whole-state replacement
  rack.refresh();
  assert.equal(rack.panels.get('eq'), P0);                                            // same id / type / variant: kept
  assert.equal(rack.panels.get('dist').v, 1);                                         // variant changed: rebuilt
  assert.deepEqual(byCls(root, 'fxr-mod').map(n => n.getAttribute('data-inst')), ['eq', 'dist']);
  assert.deepEqual(byCls(root, 'fxr2-row').map(n => n.getAttribute('data-inst')), ['eq', 'dist']);
  st.fx = fx2([]);
  rack.refresh();
  assert.equal(rack.panels.size, 0);
  assert.equal(one(root, 'fxr-empty').hidden, false);
  assert.ok(all(root).length > 5);
  rack.destroy();
});

test('FXRackUI: serum-ui adapter naming (host.s): removing a splitter drops the rows / locks / MIDI of its branch instances too; Clear / Cut FX Bus likewise (fx-core)', () => {
  const s = core.normalizeSerum(core.defaultSerum());
  const S = inst('split2', 'split2');
  S.br[1].push(inst('dist', 'dist'));
  const row = (i, dst) => { s.matrix[i] = Object.assign({}, s.matrix[i], { src: 'lfo1', dst, amt: 0.4 }); };
  row(0, 'fx.dist.drive'); row(1, 'fx.split2.freq'); row(2, 'fx.eq.gainL'); row(3, 'fx.cho.depth');
  s.locks.p.push('fx.dist.mix');
  s.midi = { 21: 'fx.dist.drive', 22: 'fx.eq.gainL' };
  const st = { fx: fx2([S, inst('eq', 'eq')], [inst('cho', 'cho')]), edits: [], sEdits: [] };
  const d = fresh(), parent = d.createElement('div');
  d.body.appendChild(parent);
  const host = { fx: () => st.fx, editFx: (fn, o) => { fn(st.fx); st.edits.push(o); }, bpm: () => 120, gr: () => null, locked: () => false,
    storage: { get: (k, def) => def, set() {} }, notify() {}, racks: () => 3,
    s: () => s, edit: (fn, o) => { fn(s); st.sEdits.push(o); } };         // serum-ui's FX page adapter (s, not state)
  const rack = new FXRackUI(parent, host, { embedded: true, dsp: fakeDsp(), racks: 3 });
  assert.equal(rack.sState(), s);
  rack.removeInst('split2');
  assert.deepEqual(st.fx.racks[0].mods.map(x => x.id), ['eq']);
  assert.deepEqual(s.matrix.slice(0, 4).map(r => r.dst), ['', '', 'fx.eq.gainL', 'fx.cho.depth']);
  assert.equal(s.locks.p.includes('fx.dist.mix'), false);
  assert.deepEqual(s.midi, { 22: 'fx.eq.gainL' });
  assert.deepEqual(st.sEdits.at(-1), { label: 'Remove Splitter L/H', phase: 'set' });
  // Duplicate (w/mods) through host.s
  assert.equal(rack.duplicate('eq', true), 'eq2');
  assert.ok(s.matrix.some(r => r.dst === 'fx.eq2.gainL' && r.src === 'lfo1'));
  // Cut FX Bus (BUS 1): the clipboard holds the rack, its rows go
  rack.setRack(1);
  rack.rackMenu().find(x => x.label === 'Cut FX Bus').action();
  assert.deepEqual(st.fx.racks[1].mods, []);
  assert.equal(s.matrix.some(r => r.dst === 'fx.cho.depth'), false);
  // Paste FX Bus into BUS 2: new ids (the type id is free again: cho)
  rack.setRack(2);
  rack.rackMenu().find(x => x.label === 'Paste FX Bus').action();
  assert.deepEqual(st.fx.racks[2].mods.map(x => x.id), ['cho']);
  // Clear FX Bus (MAIN): every row addressing eq / eq2 goes
  rack.setRack(0);
  rack.rackMenu().find(x => x.label === 'Clear FX Bus').action();
  assert.deepEqual(st.fx.racks[0].mods, []);
  assert.equal(s.matrix.some(r => /^fx\.eq2?\./.test(r.dst)), false);
  rack.destroy();
});

test('FXRackUI: without a Serum state Duplicate (w/mods) is disabled and Remove leaves the (inactive) rows alone', () => {
  const { rack, st, d } = mkRack({ fx: fx2([inst('dly', 'dly')]) });
  fire(one(panelOf(rack, 'dly'), 'fxr-pre'), 'click');
  const items = byCls(byCls(d.body, 'wk-ctx').at(-1), 'wk-ci');
  const w = items.find(n => one(n, 'wk-cl').textContent === 'Duplicate FX Module (w/mods)');
  assert.equal(w.getAttribute('aria-disabled'), 'true');
  rack.removeInst('dly');
  assert.deepEqual(st.fx.racks[0].mods, []);
  rack.destroy();
});

test('FXRackUI: compressor multiband — band threshold bars drawn in the GR display and dragged per row (MB H / M / L)', () => {
  const C = inst('cmp', 'cmp');
  C.p.mb = 1; C.p.mbH = 0.25; C.p.mbM = 0.5; C.p.mbL = 0.75;
  const { rack, st } = mkRack({ fx: fx2([C]) });
  const cv = rack.panels.get('cmp').grCv;
  place(cv, 0, 0, 156, 64);                                                            // rows of (64 − 8) / 3 px; span = 156 − 56
  const ctx = cv.getContext('2d');
  ctx.calls.length = 0;
  rack.drawGr(rack.panels.get('cmp'));
  const bars = ctx.calls.filter(c => c[0] === 'fillRect' && c[3] === 2).map(c => c[1]);
  assert.deepEqual(bars, [22 + 25 - 1, 22 + 50 - 1, 22 + 75 - 1]);                     // H, M, L at 22 + n·span
  // drag on the L row (third): +20 px = +0.2; a press without travel changes nothing
  const I = st.fx.racks[0].mods[0], n0 = st.edits.length;
  ptr(cv, 'pointerdown', 60, 58);
  ptr(cv, 'pointerup', 60, 58);
  assert.equal(st.edits.length, n0);
  ptr(cv, 'pointerdown', 60, 58);
  ptr(cv, 'pointermove', 70, 58);
  ptr(cv, 'pointermove', 80, 58);
  ptr(cv, 'pointerup', 80, 58);
  near(I.p.mbL, 0.95, 1e-9);
  assert.deepEqual([I.p.mbH, I.p.mbM], [0.25, 0.5]);
  assert.deepEqual(st.edits.slice(n0).map(e => e.phase), ['start', 'move', 'move', 'end']);
  assert.equal(st.edits.at(-1).label, 'Compressor MB Low');
  // single-band mode: no band drag
  I.p.mb = 0;
  rack.refresh();
  const n1 = st.edits.length;
  ptr(cv, 'pointerdown', 60, 10);
  ptr(cv, 'pointermove', 90, 10);
  ptr(cv, 'pointerup', 90, 10);
  assert.equal(st.edits.length, n1);
  rack.destroy();
});

test('FXRackUI: Delay S2 MODE is a menu with the HQ switch beside it; the S1 variant keeps the Phase-1 segments', () => {
  const { rack, st } = mkRack({ fx: fx2([inst('dly', 'dly'), inst('dly2', 'dly', 1)]) });
  const kind = id => rack.knobs.get(id).el.className.split(' ')[0];
  assert.equal(kind('fx.dly.mode'), 'wk-menu');
  assert.equal(kind('fx.dly2.mode'), 'wk-seg');
  assert.equal(kind('fx.dly.hq'), 'wk-tog');
  assert.equal(rack.knobs.has('fx.dly2.hq'), false);
  rack.knobs.get('fx.dly.mode').open();
  const opts = byAttr(rack.el.ownerDocument.body, 'role', 'option');
  assert.deepEqual(opts.map(o => o.textContent), ['Normal', 'Ping-Pong', 'Tap->Delay']);
  fire(opts[1], 'click');
  assert.equal(st.fx.racks[0].mods[0].p.mode, 0.5);
  rack.destroy();
});

test('FXRackUI: splitter response display — a horizontal drag moves the nearer crossover relatively (no jump to the pointer on the press)', () => {
  const { rack, st } = mkRack({ fx: fx2([inst('split2', 'split2'), inst('split3', 'split3')]) });
  const I = id => st.fx.racks[0].mods.find(x => x.id === id);
  const hz = (I0, pid) => core.lawValue('fx.q.' + pid, I0.p[pid], { v: 2, racks: [{ mods: [Object.assign(inst('q', I0.type), { p: I0.p })] }, { mods: [] }, { mods: [] }] });
  const W = 212, pad = 6, span = W - 2 * pad, xOf = f => pad + Math.log(f / 20) / Math.log(1000) * span;
  const disp = id => { const el = one(panelOf(rack, id), 'fxr2-spl'); place(el, 0, 0, W, 74); return el; };
  // L/H: press, < 3 px, nothing
  const d2 = disp('split2'), ne = st.edits.length;
  ptr(d2, 'pointerdown', 100, 30); ptr(d2, 'pointermove', 101, 30); ptr(d2, 'pointerup', 101, 30);
  assert.equal(st.edits.length, ne);
  // 0.1 plot widths of travel multiply the crossover by 1000^0.1 wherever it was grabbed
  const f0 = hz(I('split2'), 'freq'), dx = 0.1 * span;
  ptr(d2, 'pointerdown', 100, 30); ptr(d2, 'pointermove', 100 + dx / 2, 30); ptr(d2, 'pointermove', 100 + dx, 30); ptr(d2, 'pointerup', 100 + dx, 30);
  near(hz(I('split2'), 'freq'), f0 * Math.pow(1000, 0.1), 1e-6 * f0, 'split2 freq');
  assert.deepEqual(st.edits.slice(ne).map(e => e.phase), ['start', 'move', 'move', 'end']);
  assert.equal(st.edits.at(-1).label, 'Splitter L/H ' + TAB('split2', 2).find(r => r.pid === 'freq').label);
  // L/M/H (200 Hz / 2 kHz): a press between them at 600 Hz grabs the nearer one (SPLIT 1); a 3 px drag moves it by 3 px
  // of the log axis — no jump to 600 Hz
  const d3 = disp('split3'), a0 = hz(I('split3'), 'freq1'), b0 = I('split3').p.freq2;
  ptr(d3, 'pointerdown', xOf(600), 30); ptr(d3, 'pointermove', xOf(600) + 3, 30); ptr(d3, 'pointerup', xOf(600) + 3, 30);
  near(hz(I('split3'), 'freq1'), a0 * Math.pow(1000, 3 / span), 1e-6 * a0, 'split3 freq1');
  assert.equal(I('split3').p.freq2, b0);
  // a press near SPLIT 2 drags SPLIT 2; SPLIT 1 keeps its value
  const f1 = I('split3').p.freq1, g0 = hz(I('split3'), 'freq2');
  ptr(d3, 'pointerdown', xOf(g0) + 2, 30); ptr(d3, 'pointermove', xOf(g0) + 2 + span / 10, 30); ptr(d3, 'pointerup', xOf(g0) + 2 + span / 10, 30);
  near(hz(I('split3'), 'freq2'), g0 * Math.pow(1000, 0.1), 1e-6 * g0, 'split3 freq2');
  assert.equal(I('split3').p.freq1, f1);
  rack.destroy();
});

/* ------------------------------------------------------------------ review fixes (v1 hosts, displays, touch, refs) */

test('FXRackUI: a v1 host without v2Fx never receives a v2 state — an edit only the v2 shape holds is refused (no host edit, a notice); v1-shape edits work', () => {
  const v1 = defFx(); v1.p['fx.rev.on'] = 1; v1.p['fx.rev.size'] = 0.9; v1.p['fx.dly.on'] = 1;
  const s = core.normalizeSerum(core.defaultSerum());
  s.matrix[0] = Object.assign({}, s.matrix[0], { src: 'lfo1', dst: 'fx.dly.feed', amt: 0.5 });
  const { rack, st, host } = mkRack({ fx: v1, racks: 3, s });
  const obj = st.fx, p0 = JSON.stringify(st.fx.p), n0 = st.edits.length;
  assert.equal(rack.addInst('bode'), null);                                          // an S2-only type
  assert.equal(rack.addInst('split2'), null);                                        // a splitter
  assert.equal(rack.duplicate('dly', false), null);                                  // a second Delay
  rack.upgrade('rev');                                                               // S1 → S2
  rack.setLock(1);                                                                   // a bus lock
  assert.equal(st.edits.length, n0);                                                 // refused before the host saw them
  assert.equal(st.notes.length, 5);
  assert.ok(st.notes.every(t => /Serum 2 FX rack/.test(t)), JSON.stringify(st.notes));
  assert.equal(st.fx, obj);
  assert.equal(st.fx.v, 1);
  assert.equal(JSON.stringify(st.fx.p), p0);
  assert.equal(s.matrix[0].dst, 'fx.dly.feed');                                       // no Serum-state side either
  assert.deepEqual([...rack.panels.keys()], ['dly', 'rev']);
  // edits the v1 shape holds go through
  rack.setP('rev', 'size', 0.5, 'set');
  assert.equal(st.fx.p['fx.rev.size'], 0.5);
  rack.removeInst('dly');
  assert.deepEqual([st.fx.v, st.fx.p['fx.dly.on']], [1, DEF['fx.dly.on']]);
  assert.equal(s.matrix[0].dst, core.defaultSerum().matrix[0].dst);                    // its row went with it
  // host.v2Fx may be a function (main.js answers per track): true → the same edit converts the state in place
  host.v2Fx = () => true;
  assert.equal(rack.addInst('bode'), 'bode');
  assert.equal(st.fx, obj);
  assert.equal(st.fx.v, 2);
  assert.deepEqual(st.fx.racks[0].mods.map(I => I.id), ['rev', 'bode']);
  rack.destroy();
});

test('FXRackUI: v1 write-back keeps the v1 order and the MIX / LEVEL labels of the modules the view leaves out', () => {
  const v1 = defFx();
  v1.order = ['fil', 'eq', 'rev', 'dly', 'cmp', 'hyper', 'dist', 'flg', 'cho', 'phs'];
  for (const m of ['hyper', 'cho', 'eq']) v1.p['fx.' + m + '.on'] = 1;
  v1.ui.lvl.dly = 1; v1.ui.lvl.rev = 1; v1.ui.lvl.cho = 1;                             // labels of pristine (left out) modules too
  const { rack, st } = mkRack({ fx: v1, racks: 1 });
  assert.deepEqual([...rack.panels.keys()], ['eq', 'hyper', 'cho']);
  const order0 = st.fx.order.slice(), lvl0 = JSON.stringify(st.fx.ui.lvl);
  rack.select('eq');                                                                 // a ui-only edit
  rack.setP('cho', 'depth', 0.3, 'set');                                              // a parameter edit
  assert.deepEqual(st.fx.order, order0);
  assert.equal(JSON.stringify(st.fx.ui.lvl), lvl0);
  // moving an instance: the present modules swap within their own slots, the others stay put
  rack.nudge('cho', -1);
  assert.deepEqual(st.fx.order, ['fil', 'eq', 'rev', 'dly', 'cmp', 'cho', 'dist', 'flg', 'hyper', 'phs']);
  assert.equal(JSON.stringify(st.fx.ui.lvl), lvl0);
  rack.destroy();
});

test('FXRackUI: GR meters of a v1 host state read the engine slot (fxLayout of the host state: all ten modules), not the view index', () => {
  const v1 = defFx(); v1.p['fx.cmp.on'] = 1;
  const eng = core.compileFx(v1, { bpm: 120 }).iId.indexOf('cmp');
  assert.equal(eng, 6);
  const { rack, st } = mkRack({ fx: v1, racks: 1 });
  assert.equal(rack.fx().racks[0].mods.findIndex(I => I.id === 'cmp'), 0);              // the view leaves the others out
  st.gr = new Float32Array(4 * 48);
  st.gr[4 * eng] = 9; st.gr[0] = 2;
  const P = rack.panels.get('cmp'), ctx = P.grCv.getContext('2d');
  ctx.calls.length = 0;
  rack.drawGr(P);
  assert.ok(ctx.calls.some(c => c[0] === 'fillText' && c[1] === '-9.0'), JSON.stringify(ctx.calls.filter(c => c[0] === 'fillText')));
  assert.equal(rack.grSlot('nope'), -1);
  rack.destroy();
});

test('FXRackUI: the GR loop runs through wk.ticker (10 fps with prefers-reduced-motion) and repaints only on change', () => {
  raf.install();
  const prevMM = globalThis.matchMedia;
  globalThis.matchMedia = q => ({ matches: /reduced-motion/.test(q) });
  try {
    const { rack, st } = mkRack({ fx: fx2([inst('cmp', 'cmp')]) });
    st.gr = new Float32Array(4 * 48);
    const ctx = rack.panels.get('cmp').grCv.getContext('2d');
    ctx.calls.length = 0;
    raf.flush(30, 0);                                                                  // 1.2 s of frames, 40 ms apart
    assert.equal(ctx.calls.filter(c => c[0] === 'clearRect').length, 1);               // one paint; nothing changed after it
    st.gr[0] = 4;
    raf.flush(3, 2000);
    assert.equal(ctx.calls.filter(c => c[0] === 'clearRect').length, 2);
    // the loop's own rate: ≤ 10 paints per second under reduced motion
    let paints = 0;
    for (let i = 0; i < 30; i++) { st.gr[0] = 5 + i; raf.flush(1, 4000 + 40 * i); }
    paints = ctx.calls.filter(c => c[0] === 'clearRect').length - 2;
    assert.ok(paints >= 10 && paints <= 13, String(paints));
    rack.destroy();
    assert.equal(raf.pending, 0);
  } finally { if (prevMM === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = prevMM; raf.uninstall(); }
});

test('FXRackUI: Reset All Racks and Load Effect Chain drop the rows / locks / MIDI of the instances they remove; same id and type keeps them', () => {
  const s = core.normalizeSerum(core.defaultSerum());
  s.matrix[0] = Object.assign({}, s.matrix[0], { src: 'lfo1', dst: 'fx.dly.feed', amt: 0.8 });
  s.locks.p.push('fx.dly.mix');
  const empty = core.defaultSerum().matrix[0].dst;
  const a = mkRack({ fx: fx2([inst('dly', 'dly')]), s, embedded: true });
  a.rack.resetRack();
  assert.deepEqual(a.st.fx.racks.map(R => R.mods.length), [0, 0, 0]);
  assert.equal(s.matrix[0].dst, empty);
  assert.equal(s.locks.p.includes('fx.dly.mix'), false);
  a.rack.addInst('dly');                                                             // a newcomer never inherits them
  assert.equal(s.matrix[0].dst, empty);
  a.rack.destroy();
  // Load Effect Chain: a Distortion (same id and type in the chain) keeps its row; the Delay, the splitter and its
  // EQ (not in the chain) lose theirs; an instance of the chain kept inside a splitter that goes keeps its row
  const s2 = core.normalizeSerum(core.defaultSerum());
  const S = inst('split2', 'split2');
  S.br[0] = [inst('eq', 'eq')]; S.br[1] = [inst('cho', 'cho')];
  const rows = ['fx.dist.drive', 'fx.dly.feed', 'fx.eq.gainL', 'fx.cho.depth', 'fx.split2.freq'];
  rows.forEach((dst, i) => { s2.matrix[i] = Object.assign({}, s2.matrix[i], { src: 'lfo1', dst, amt: 0.5 }); });
  const b = mkRack({ fx: fx2([inst('dist', 'dist'), inst('dly', 'dly'), S]), s: s2, embedded: true });
  const chain = fx2([inst('dist', 'dist'), inst('cho', 'cho'), inst('rev', 'rev')]);
  b.rack.loadChain(chain, 'Test');
  assert.deepEqual(b.st.fx.racks[0].mods.map(I => I.id), ['dist', 'cho', 'rev']);
  assert.deepEqual(s2.matrix.slice(0, 5).map(r => r.dst), ['fx.dist.drive', empty, empty, 'fx.cho.depth', empty]);
  assert.equal(b.st.sEdits.at(-1).label, 'Load Effect Chain');
  b.rack.destroy();
});

test('FXRackUI: the transfer display redraws on any X-Shaper curve edit (keyed on the curves, not on two table samples)', () => {
  const D0 = inst('dist', 'dist');
  D0.p.mode = 11 / 17;
  D0.sub.xa = [[0, 0, 0], [0.5, 0.5, 0], [1, 1, 0]];
  const { rack, st, dsp } = mkRack({ fx: fx2([D0]) });
  for (const D of rack.panels.get('dist').displays) place(D.el, 0, 0, 120, 74);
  rack.redraw(true);
  const n = () => dsp.calls.filter(c => c[0] === 'distCurve').length, n0 = n();
  rack.edit(f => { f.racks[0].mods[0].sub.xa = [[0, 0, 0], [0.5, 0.5, 0], [1, 0.1, 0]]; }, 'X-Shaper A', 'set');
  rack.refresh();
  assert.equal(n(), n0 + 1);
  rack.refresh();
  assert.equal(n(), n0 + 1);                                                          // unchanged: no redraw
  assert.equal(st.fx.racks[0].mods[0].sub.xa[2][1], 0.1);
  rack.destroy();
});

test('FXRackUI: display drags are relative inside the law range — a vertical drag never moves the cutoff; the axis reaches the law ends', () => {
  for (const n0 of [1, 0, 0.37]) {
    const F0 = inst('fil', 'fil');
    F0.p.cutoff = n0; F0.p.res = 0.2;
    const { rack, st } = mkRack({ fx: fx2([F0]) });
    const D = rack.panels.get('fil').displays[0];
    place(D.el, 0, 0, 200, 96);
    ptr(D.el, 'pointerdown', 100, 50); ptr(D.el, 'pointermove', 100, 40); ptr(D.el, 'pointermove', 100, 30); ptr(D.el, 'pointerup', 100, 30);
    const I = st.fx.racks[0].mods[0];
    assert.equal(I.p.cutoff, n0, 'cutoff at n ' + n0);
    near(I.p.res, 0.2 + 20 / 84, 1e-9);
    rack.destroy();
  }
  // a horizontal drag past the display's 20 kHz edge reaches the law's top (22.05 kHz, n 1); back again without a dead zone
  const F1 = inst('fil', 'fil');
  F1.p.cutoff = 0.9;
  const { rack, st } = mkRack({ fx: fx2([F1]) });
  const D = rack.panels.get('fil').displays[0];
  place(D.el, 0, 0, 200, 96);
  ptr(D.el, 'pointerdown', 50, 50); ptr(D.el, 'pointermove', 150, 50);
  near(st.fx.racks[0].mods[0].p.cutoff, 1, 1e-9);
  ptr(D.el, 'pointermove', 50, 50); ptr(D.el, 'pointerup', 50, 50);
  assert.ok(st.fx.racks[0].mods[0].p.cutoff < 0.9, String(st.fx.racks[0].mods[0].p.cutoff));   // the travel back counts fully
  rack.destroy();
});

test('FXRackUI: a plain click on an EQ handle edits nothing (no host edit); a drag edits with start / move / end', () => {
  const E = inst('eq', 'eq');
  E.p.freqL = 0.3137; E.p.gainL = 0.6123; E.p.freqH = 0.77; E.p.gainH = 0.41;
  const { rack, st } = mkRack({ fx: fx2([E]) });
  const D = rack.panels.get('eq').displays[0];
  place(D.el, 0, 0, 300, 110);
  rack.redraw(true);
  const arcs = D.cv.getContext('2d').calls.filter(c => c[0] === 'arc'), [hx, hy] = arcs.at(-2).slice(1, 3);
  const n0 = st.edits.length, p0 = JSON.stringify(E.p);
  ptr(D.el, 'pointerdown', hx, hy, { pointerId: 3 }); ptr(D.el, 'pointermove', hx + 1, hy, { pointerId: 3 }); ptr(D.el, 'pointerup', hx + 1, hy, { pointerId: 3 });
  assert.equal(st.edits.length, n0);
  assert.equal(JSON.stringify(st.fx.racks[0].mods[0].p), p0);
  // a vertical drag keeps the frequency exactly
  ptr(D.el, 'pointerdown', hx, hy, { pointerId: 3 }); ptr(D.el, 'pointermove', hx, hy - 10, { pointerId: 3 }); ptr(D.el, 'pointerup', hx, hy - 10, { pointerId: 3 });
  assert.deepEqual(st.edits.slice(n0).map(e => e.phase), ['start', 'move', 'end']);
  const I = st.fx.racks[0].mods[0];
  assert.equal(I.p.freqL, 0.3137);
  assert.ok(I.p.gainL > 0.6123);
  rack.destroy();
});

test('FXRackUI, two-finger rollback (gesture.js\'s pointercancel flagged e.gesture === "two-finger"): display drags (filter, EQ handle, transfer, splitter) and the multiband threshold bars put their values back; a plain cancel keeps; no click after it', () => {
  const C = inst('cmp', 'cmp');
  C.p.mb = 1; C.p.mbH = 0.25; C.p.mbM = 0.5; C.p.mbL = 0.75;
  const E = inst('eq', 'eq');
  E.p.freqL = 0.3137; E.p.gainL = 0.6123; E.p.freqH = 0.77; E.p.gainH = 0.41;
  const { rack, st } = mkRack({ fx: fx2([inst('fil', 'fil'), E, inst('dist', 'dist'), inst('split2', 'split2'), C]) });
  const I = id => st.fx.racks[0].mods.find(x => x.id === id), P = id => JSON.stringify(I(id).p);
  const TW = { pointerType: 'touch', pointerId: 8 }, TWO = { pointerType: 'touch', pointerId: 8, gesture: 'two-finger' };
  const roll = (el, x0, y0, x1, y1, id) => {
    const p0 = P(id), n0 = st.edits.length;
    ptr(el, 'pointerdown', x0, y0, TW); ptr(el, 'pointermove', (x0 + x1) / 2, (y0 + y1) / 2, TW); ptr(el, 'pointermove', x1, y1, TW);
    assert.notEqual(P(id), p0, id + ': dragged');
    ptr(el, 'pointercancel', x1, y1, TWO);
    assert.equal(P(id), p0, id + ': rolled back');
    assert.equal(st.edits.at(-1).phase, 'end', id + ': the gesture closed');
    assert.ok(st.edits.length > n0);
  };
  // FX filter display (dragXY): cutoff / res; its Alt-click view cycling never fires on a cancel
  const fd = rack.panels.get('fil').displays[0];
  place(fd.el, 0, 0, 200, 96);
  roll(fd.el, 100, 50, 150, 20, 'fil');
  ptr(fd.el, 'pointerdown', 100, 50, Object.assign({ altKey: true }, TW)); ptr(fd.el, 'pointercancel', 100, 50, Object.assign({ altKey: true }, TWO));
  assert.equal(rack.filtView('fil'), 0, 'no view cycle');
  // EQ handle (frequency + gain)
  const ed = rack.panels.get('eq').displays[0];
  place(ed.el, 0, 0, 300, 110);
  rack.redraw(true);
  const [hx, hy] = ed.cv.getContext('2d').calls.filter(c => c[0] === 'arc').at(-2).slice(1, 3);
  roll(ed.el, hx, hy, hx + 30, hy - 20, 'eq');
  // transfer curve (DRIVE) and the splitter crossover
  const xf = one(panelOf(rack, 'dist'), 'fxr-xfer');
  place(xf, 0, 0, 78, 74);
  roll(xf, 30, 50, 30, 20, 'dist');
  const sp = one(panelOf(rack, 'split2'), 'fxr2-spl');
  place(sp, 0, 0, 212, 74);
  roll(sp, 100, 30, 140, 30, 'split2');
  // the multiband GR display: a band threshold bar
  const cv = rack.panels.get('cmp').grCv;
  place(cv, 0, 0, 156, 64);
  roll(cv, 60, 58, 80, 58, 'cmp');
  // a plain cancel keeps the dragged value (as before)
  const p0 = P('dist');
  ptr(xf, 'pointerdown', 30, 50, TW); ptr(xf, 'pointermove', 30, 20, TW); ptr(xf, 'pointercancel', 30, 20, TW);
  assert.notEqual(P('dist'), p0);
  rack.destroy();
});

test('FXRackUI: panel cleanups live on the panel — rack-tab and branch switches do not grow the rack-wide list', () => {
  const S = inst('split2', 'split2');
  S.br[0] = [inst('eq2', 'eq')]; S.br[1] = [inst('conv2', 'conv')];
  const { rack } = mkRack({ fx: fx2([inst('eq', 'eq'), S], [inst('conv', 'conv'), inst('eq3', 'eq')]) });
  const n0 = rack.offs.length;
  for (let i = 0; i < 10; i++) { rack.setRack(1); rack.setRack(0); rack.selectBranch('split2', 1); rack.selectBranch('split2', 0); }
  assert.equal(rack.offs.length, n0);
  assert.ok(rack.panels.get('eq').offs.length >= 1);
  rack.destroy();
});

test('FXRackUI: touch long-press opens the rack background menu, a branch row\'s and a branch panel\'s add menu (the click after it is eaten); panels keep their own', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { rack, st, d } = mkRack({ fx: fx2([inst('split2', 'split2'), inst('eq', 'eq')]) });
    const hold = (el, id) => {
      ptr(el, 'pointerdown', 10, 10, { pointerType: 'touch', pointerId: id });
      t.mock.timers.tick(600);
      ptr(el, 'pointerup', 10, 10, { pointerType: 'touch', pointerId: id });
      return fire(el, 'click');
    };
    hold(rack.rack, 1);
    assert.ok(menuLabels(d).includes('Cut FX Bus'), JSON.stringify(menuLabels(d)));
    // a control inside a panel: the control's own menu (here: the rack's control menu, mod: false) — not the rack's
    hold(rack.knobs.get('fx.eq.freqL').el, 2);
    assert.ok(menuLabels(d).includes('Reset Control'), JSON.stringify(menuLabels(d)));
    // a branch row: its add menu; the BYP button under the finger is not toggled
    const br = rack.rowEls.find(r => r.row.kind === 'branch');
    hold(br.byp, 3);
    assert.ok(menuLabels(d).includes('Delay') && !menuLabels(d).includes('Cut FX Bus'), JSON.stringify(menuLabels(d)));
    assert.equal(st.fx.racks[0].mods[0].bb[0], 0);
    fire(br.byp, 'click');                                                            // a plain tap still toggles it
    assert.equal(st.fx.racks[0].mods[0].bb[0], 1);
    // a splitter branch panel in the rack view
    const bp = byCls(panelOf(rack, 'split2'), 'fxr2-bpanel')[1];
    hold(one(bp, 'fxr2-bname'), 4);
    assert.ok(menuLabels(d).includes('Delay'), JSON.stringify(menuLabels(d)));
    assert.equal(rack.branchOf('split2'), 0);                                          // the name's click was eaten
    rack.destroy();
  } finally { t.mock.timers.reset(); }
});

test('FXRackUI: a missing / empty IR overview is not cached — asked again later and picked up by the retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1e6 });
  try {
    let ready = false, calls = 0;
    const irs = { list: () => [{ id: 'fir:Medium/Chamber', name: 'Chamber', folder: 'Medium' }],
      overview: (id, n) => { calls++; return Promise.resolve(ready ? new Float32Array(2 * n).fill(0.5) : new Float32Array(2 * n)); } };
    const { rack } = mkRack({ fx: fx2([inst('conv', 'conv')]), irs });
    const tickle = () => new Promise(r => setImmediate(r));
    await tickle();
    assert.equal(calls, 1);
    assert.equal(rack.irCached('fir:Medium/Chamber'), null);
    rack.redraw(true);                                                                // within a second: no new request
    await tickle();
    assert.equal(calls, 1);
    ready = true;                                                                     // e.g. the factory IR got generated
    t.mock.timers.tick(2100);                                                         // the display's own retry
    await tickle(); await tickle();
    const ov = rack.irCached('fir:Medium/Chamber');
    assert.ok(ov && ov[0] === 0.5, 'overview picked up');
    rack.destroy();
  } finally { t.mock.timers.reset(); }
});

test('FXRackUI: S1 badges explain themselves (no conversion promised for Hyper / Flanger); Convolve shows EMBED for user IRs', () => {
  const { rack, st } = mkRack({ fx: fx2([inst('hyper', 'hyper'), inst('dist', 'dist', 1), inst('conv', 'conv')]) });
  const badge = id => one(rack.rowEls.find(r => r.row.kind === 'inst' && r.row.id === id).el, 'fxr2-s1');
  assert.match(badge('hyper').title, /no Serum 2 variant/);
  assert.match(badge('dist').title, /Convert to Serum 2/);
  assert.match(one(panelOf(rack, 'hyper'), 'fxr2-s1').title, /no Serum 2 variant/);
  const emb = one(panelOf(rack, 'conv'), 'fxr2-emb');
  assert.ok(emb.classList.contains('fxr2-hide'));                                     // factory IR
  rack.setIr('conv', 'ir:abc');
  rack.refresh();
  assert.equal(st.fx.racks[0].mods[2].sub.ir, 'ir:abc');
  assert.ok(!emb.classList.contains('fxr2-hide'));
  rack.destroy();
});

test('FXRackUI: FX filter display views (menu, Alt-click cycles: Frequency / Phase Response); control menus carry RATIO ▸ Limiter Latency Comp and SHIFT ▸ Retrig', () => {
  const { rack, st, d } = mkRack({ fx: fx2([inst('fil', 'fil'), inst('cmp', 'cmp'), inst('bode', 'bode')]) });
  const D = rack.panels.get('fil').displays[0];
  place(D.el, 0, 0, 200, 96);
  const e = fire(D.el, 'contextmenu', { clientX: 5, clientY: 5 });
  assert.ok(e.defaultPrevented);
  assert.deepEqual(menuLabels(d), ['Frequency Response', 'Phase Response', 'Spectrum (FFT): no FX filter tap']);
  pick(d, 'Phase Response');
  assert.equal(rack.filtView('fil'), 1);
  const ctx = D.cv.getContext('2d');
  assert.ok(ctx.calls.some(c => c[0] === 'fillText' && c[1] === 'PHASE'));
  const n0 = st.edits.length;
  ptr(D.el, 'pointerdown', 50, 50, { altKey: true }); ptr(D.el, 'pointerup', 50, 50, { altKey: true });
  assert.equal(rack.filtView('fil'), 0);
  ptr(D.el, 'pointerdown', 50, 50); ptr(D.el, 'pointerup', 50, 50);                   // a plain click: nothing
  assert.equal(rack.filtView('fil'), 0);
  assert.equal(st.edits.length, n0);
  // the control menus (mod: false)
  fire(rack.knobs.get('fx.cmp.ratio').el, 'contextmenu', { clientX: 5, clientY: 5 });
  assert.ok(menuLabels(d).includes('Limiter Latency Comp (no host latency in a browser)'), JSON.stringify(menuLabels(d)));
  assert.deepEqual(rack.ctlExtras('fx.bode.shift').map(x => [x.label, x.checked]), [['Retrig', false]]);
  fire(rack.knobs.get('fx.bode.shift').el, 'contextmenu', { clientX: 5, clientY: 5 });
  pick(d, 'Retrig');
  assert.equal(st.fx.racks[0].mods[2].p.retrig, 1);
  assert.deepEqual(rack.ctlExtras('fx.bode.shift').map(x => x.checked), [true]);
  assert.deepEqual(rack.ctlExtras('fx.cmp.thr'), []);
  // RULINGS2 U3: Limiter Latency Comp is the RATIO menu's only (not the module menu's); RETRIG has no panel toggle
  assert.ok(!rack.instMenu('cmp').some(x => /Limiter Latency/.test(x.label || '')), 'not in the module menu');
  assert.ok(rack.knobs.has('fx.bode.shift') && !rack.knobs.has('fx.bode.retrig'), 'no RETRIG toggle on the Bode panel');
  rack.destroy();
});

test('FXRackUI: touch rules under (pointer: coarse) and .wk-touch (44 px targets); the GR canvas is a touch-action: none drag control', () => {
  const { rack, d } = mkRack({ fx: fx2([inst('cmp', 'cmp')]) });
  const css = d.getElementById('fxr2-css').textContent;
  assert.match(css, /@media \(pointer: coarse\) \{[^}]*\.fxr2-tab, \.fxr2-bname \{ min-height: 44px; \}/);
  assert.match(css, /\.wk-touch \.fxr2-tab, \.wk-touch \.fxr2-bname \{ min-height: 44px; \}/);
  assert.match(css, /\.wk-touch \.fxr2-plus, \.wk-touch \.fxr2-bbyp \{ min-height: 44px; min-width: 44px; \}/);
  assert.match(css, /\.wk-touch \.fxr2-chip::before \{/);
  assert.match(css, /\.fxr2 \.fxr-gr \{ touch-action: none; \}/);
  assert.equal(rack.panels.get('cmp').grCv.style.touchAction, 'none');
  rack.destroy();
});

test('FXRackUI: a Phase-1 chain (v1 library entry, Phase-1 factory chain) keeps the modules the Serum state locks, maps and modulates (as Phase 1)', () => {
  const v1 = defFx();
  v1.p['fx.dist.on'] = 1; v1.p['fx.dist.drive'] = 0.62;
  const wide = core.FACTORY_CHAINS_V1.chains.find(c => c.name === 'Wide Chorus');
  for (const pick of ['Mine', 'Wide Chorus']) {
    const s = core.normalizeSerum(core.defaultSerum());
    s.locks.p.push('fx.dist.on', 'fx.dist.drive');
    s.matrix[0] = Object.assign({}, s.matrix[0], { src: 'lfo1', dst: 'fx.dist.drive', amt: 0.4 });
    s.midi['20'] = 'fx.dist.mix';
    const { rack, st } = mkRack({ fx: core.normalizeFx(v1, s), s, embedded: true });
    st.locked = ['fx.dist.on', 'fx.dist.drive'];
    st.store.set('synth.fxchains', JSON.stringify([{ name: 'Mine', fx: wide.fx }]));
    const load = rack.rackMenu().find(x => x.label === 'Load Effect Chain…').sub;
    (pick === 'Mine' ? load.find(x => x.label === 'Mine') : load.find(x => x.label === 'Factory').sub.find(x => x.label === pick)).action();
    const ids = st.fx.racks[0].mods.map(I => I.id), d = core.fxDest('fx.dist.drive', st.fx);
    assert.ok(ids.includes('dist') && ids.includes('cho'), pick + ': ' + ids);
    assert.deepEqual([d.inst.p.on, d.inst.p.drive], [1, 0.62], pick + ': locked values kept');
    assert.deepEqual([s.locks.p.slice().sort(), s.matrix[0].dst, s.midi['20']], [['fx.dist.drive', 'fx.dist.on'], 'fx.dist.drive', 'fx.dist.mix'], pick);
    rack.destroy();
  }
});

test('FXRackUI: the effect-chain library keeps other writers\' entries as they are; new chains are stored as v2 chains (RULINGS2 F1)', () => {
  const v1 = defFx(); v1.p['fx.flg.on'] = 1;
  const D1 = inst('dly', 'dly', 1);
  D1.p.on = 1;
  const { rack, st } = mkRack({ fx: fx2([D1]) });
  st.store.set('synth.fxchains', JSON.stringify([{ name: 'Theirs', fx: v1 }]));
  withPrompt('Mine', () => rack.saveChain());
  const lib = JSON.parse(st.store.get('synth.fxchains'));
  assert.deepEqual(lib.map(c => c.name), ['Mine', 'Theirs']);
  assert.deepEqual(lib[1].fx, v1);                                                    // untouched
  assert.deepEqual([lib[0].fx.v, lib[0].fx.racks[0].mods.map(x => [x.id, x.v, x.p.on]), 'ui' in lib[0].fx], [2, [['dly', 1, 1]], false]);
  rack.delChain('Mine');
  assert.deepEqual(JSON.parse(st.store.get('synth.fxchains')), [{ name: 'Theirs', fx: v1 }]);
  rack.destroy();
});

test('§13.5 Delay: a double-tap on the filter display shows the realtime spectrum of the Delay\'s output (host tap) — one Delay at a time; a drag never toggles it', () => {
  const taps = [];
  let frames = null;
  const { rack, st } = mkRack({ fx: fx2([inst('dly', 'dly'), inst('dly2', 'dly')]) });
  rack.host.setTap = id => taps.push(id);
  rack.host.tap = () => frames;
  const dd = one(panelOf(rack, 'dly'), 'fxr-dlyf'), d2 = one(panelOf(rack, 'dly2'), 'fxr-dlyf');
  place(dd, 0, 0, 212, 74); place(d2, 0, 0, 212, 74);
  const tap = (el, x, y) => { ptr(el, 'pointerdown', x, y); ptr(el, 'pointerup', x, y); };
  // a press that drags (F / Q) is no tap: tap + drag does not toggle
  tap(dd, 100, 30);
  ptr(dd, 'pointerdown', 100, 30); ptr(dd, 'pointermove', 140, 20); ptr(dd, 'pointerup', 140, 20);
  assert.deepEqual(taps, []);
  // double-tap: the rack taps this Delay; its display draws the spectrum (a 1 kHz sine: the peak near 1 kHz)
  frames = Float32Array.from({ length: 1024 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 1000 * i / 48000));
  tap(dd, 100, 30); tap(dd, 102, 31);
  assert.deepEqual(taps, ['dly']);
  assert.equal(rack.specId, 'dly');
  const cv = rack.specD.cv, strokes = () => cv.getContext('2d').calls.filter(c => c[0] === 'stroke').length;
  const n0 = strokes();
  rack.specD.draw(rack.specD);
  assert.ok(strokes() > n0, 'the overlay is drawn with the response');
  // the other Delay takes it over; double-tap again turns it off
  tap(d2, 50, 30); tap(d2, 50, 30);
  assert.deepEqual(taps, ['dly', 'dly2']);
  tap(d2, 50, 30); tap(d2, 50, 30);
  assert.deepEqual(taps, ['dly', 'dly2', '']);
  assert.equal(rack.specId, '');
  // the overlay's instance removed → the tap goes off; destroy → off
  tap(dd, 10, 10); tap(dd, 10, 10);
  rack.edit(f => { f.racks[0].mods = f.racks[0].mods.filter(I => I.id !== 'dly'); }, 'Remove', 'set');
  rack.refresh();
  assert.deepEqual([taps.at(-1), rack.specId], ['', '']);
  tap(d2, 50, 30); tap(d2, 50, 30);
  rack.destroy();
  assert.equal(taps.at(-1), '');
  assert.equal(st.notes.length, 0);
});
