import './v8-guard.mjs';
// sx-host.js's pure helpers and the kit / host behaviour a Wavecraft keeps (SX0 §3: the split of tests/serum-ui.test.mjs when
// serum-ui.js went). The helper cases moved unchanged (haloArcs, knobMenuItems, dropRow, busMenuItems, lfoTileCount, captureDue,
// clipModule …, undoStack, virtGet / virtSet, s1Diff, sortPresets … browserList, withMeta …, isPristine / layers3d; 2a / 2b's rows).
// The SerumUI cases whose behaviour the Wavecraft still has are re-pointed onto a createHost with rig faces mounted the way main.js
// mounts them (rig-ui rigHost().face on the device's one SerumHost) and the drawer's dialogs (sx-ui-mod panelDialog: Quality…,
// Tuning…, Voice control…, Preferences…); the header, the seven pages, MATRIX, GLOBAL as a page, the main menu, the browser from the
// header, the bundled shell and its tile strip went with serum-ui.js (IMPL-SX0 §14 has the per-case table). graph.js / fx-ui.js /
// wtedit.js / wt.js are the stubs of tests/serum-ui-stubs/ (serum-ui.hooks.mjs redirect, as sx-host.test); serum-core.js, wk.js,
// sx-ui-osc / -seq / -mix / -mod and rig-ui the real modules. Never passes fake-DOM nodes to assert (D.safeAssert: nodes become tags).
// Run alone: node --max-old-space-size=2048 --test tests/sx-helpers.test.mjs
import test from 'node:test';
import assertBase from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { redirect } from './serum-ui.hooks.mjs';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);

/* ---------------------------------------------------------------- sibling stubs */
// tests/serum-ui.hooks.mjs redirects graph.js / fx-ui.js / wtedit.js / wt.js to tests/serum-ui-stubs/*.js
if (typeof nodeModule.registerHooks === 'function') {
  nodeModule.registerHooks({ resolve: (spec, ctx, next) => redirect(spec, ctx.parentURL) || next(spec, ctx) });
} else nodeModule.register('./serum-ui.hooks.mjs', import.meta.url);

// DSP globals defined (null) so wk.loadDSP resolves at once instead of injecting scripts into the fake DOM
globalThis.SerumDSP = null;
globalThis.FXDSP = null;

// imported before any DOM exists: the modules must not touch document / window at top level (§0.1, §10.6)
const ui = await import('../sx-host.js?v=9');
const core = await import('../serum-core.js?v=9');
const gxStub = await import('../graph.js?v=9');
const fxStub = await import('../fx-ui.js?v=9');
const wteStub = await import('../wtedit.js?v=9');
const wtStub = await import('../wt.js?v=9');
const MOD = await import('../sx-ui-mod.js?v=9');
const RU = await import('../rig-ui.js?v=9');
const wkm = await import('../wk.js?v=9');   // the instance sx-host uses (same specifier: shared modifier latches)
const D = await import('./serum-ui-stubs/dom.js');
const kitStub = await import('./serum-ui-stubs/kit.js');
const assert = D.safeAssert(assertBase);
const { fire, ptr, flush, ctxMenus, menuLabels } = D;

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const fresh = () => core.normalizeSerum(core.defaultSerum());
const row = o => Object.assign({ src: '', amt: 0, dst: '', bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 }, o);   // v2 row
const labels = items => items.map(it => it.label);
const exportNames = file => {
  const src = readFileSync(fileURLToPath(new URL(file, ROOT)), 'utf8'), out = new Set();
  for (const m of src.matchAll(/^export (?:async )?(?:function\*?|class|const|let|var) ([A-Za-z0-9_$]+)/gm)) out.add(m[1]);
  for (const m of src.matchAll(/^export \{([^}]*)\}/gm)) for (const x of m[1].split(',')) { const n = x.trim().split(/\s+as\s+/).pop(); if (n) out.add(n); }
  return out;
};
// a v2 FX state with one Delay instance under a dynamic id (fx.d7.<pid>, §3.16.4)
function fxV2() {
  const v1 = core.defaultFxV1();
  v1.p['fx.dly.on'] = 1; v1.p['fx.dly.mix'] = 0.3;
  const fx = core.migrateFx1(v1);
  fx.racks[0].mods[0].id = 'd7';
  return fx;
}

/* ================================================================ import, stubs, export parity */
// (SX0: serum-ui.js's three cases, re-pointed on sx-host.js — the module the helpers and createHost live in; the sub-panel stubs
// went with serum-ui.test, the four sibling stubs stay: sx-host.test, rig-ui.test, cv-mods-ui.test and this file use them)
test('imports in node without a DOM; the sibling modules stubbed for the unit tests', () => {
  for (const k of ['createHost', 'PresetBrowser', 'haloArcs', 'knobMenuItems', 'moduleMenuItems', 'dropRow', 'busMenuItems', 'lfoTileCount', 'sortPresets',
    'filterPresets', 'stepPreset', 'presetTags', 'withMeta', 'hybridPick', 'captureDue', 'undoStack', 'makeKit', 'virtGet', 'virtSet', 's1Diff', 'rowAlias', 'rowBad']) {
    assert.equal(typeof ui[k], 'function', k);
  }
  assert.deepEqual(ui.PAGES, ['osc', 'mix', 'fx', 'matrix', 'arp', 'clip', 'global']);
  for (const m of [gxStub, fxStub, wteStub, wtStub]) assert.equal(m.__stub, true);
});

test('imports in node with the real sibling modules (child process)', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import(${JSON.stringify(new URL('sx-host.js?v=9', ROOT).href)}); if (typeof m.createHost !== 'function') process.exit(3);`],
  { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
});

test('export parity (§15.12): the sibling stubs export only real names', () => {
  // graph / fx-ui / wtedit / wt stubs are partial stand-ins shared with the sub-panel tests: every stub name is real
  for (const [file, stub] of [['graph.js', gxStub], ['fx-ui.js', fxStub], ['wtedit.js', wteStub], ['wt.js', wtStub]]) {
    const real = exportNames(file);
    assert.deepEqual(Object.keys(stub).filter(k => !['__stub', 'made', 'calls'].includes(k) && !real.has(k)), [], file);
  }
});

/* ================================================================ haloArcs (§5.8) */
test('haloArcs: unipolar, bipolar row, bipolar source, negative, clamp, selected, bypass, amt·out, FX base', () => {
  const s = fresh(), fx = core.defaultFxV1();
  s.p['f.cutoff'] = 0.5;
  s.matrix[0] = row({ src: 'lfo1', amt: 0.3, dst: 'f.cutoff' });
  s.matrix[1] = row({ src: 'env2', amt: -0.2, dst: 'f.cutoff' });
  s.matrix[2] = row({ src: 'chaos1', amt: 0.25, dst: 'f.cutoff' });          // bipolar source, unipolar row
  s.matrix[3] = row({ src: 'velo', amt: 0.6, dst: 'f.cutoff', bi: 1 });       // bipolar row
  s.matrix[4] = row({ src: 'lfo2', amt: 1, dst: 'f.cutoff' });                // clamps at 1
  s.matrix[5] = row({ src: 'lfo3', amt: 0.4, dst: 'f.cutoff', byp: 1 });     // bypassed: no arc
  s.matrix[6] = row({ src: 'lfo4', amt: 0.5, dst: 'f.cutoff', out: 0.5 });   // amount × output
  s.matrix[7] = row({ src: 'lfo1', amt: 0.5, dst: 'a.level' });              // other control
  s.matrix[8] = row({ src: 'bend', amt: -0.4, dst: 'f.cutoff', bi: 1 });     // bipolar row, negative
  s.matrix[9] = row({ src: 'env3', amt: 0.5, dst: 'f.cutoff', out: 0 });     // output 0: inactive
  s.matrix[63] = row({ src: 'lfo10', amt: 0.1, dst: 'f.cutoff' });           // the last of 64 rows
  const a = ui.haloArcs(s, fx, 'f.cutoff', 'lfo1');
  assert.deepEqual(a.map(x => x.slot), [0, 1, 2, 3, 4, 6, 8, 63]);
  const exp = [[0.5, 0.8, 'sel'], [0.3, 0.5, 'neg'], [0.25, 0.75, 'other'], [0.2, 0.8, 'other'], [0.5, 1, 'other'], [0.5, 0.75, 'other'], [0.3, 0.7, 'neg'], [0.5, 0.6, 'other']];
  a.forEach((x, i) => { near(x.from, exp[i][0], 1e-12); near(x.to, exp[i][1], 1e-12); assert.equal(x.kind, exp[i][2]); });
  assert.equal(ui.haloArcs(s, fx, 'f.cutoff', 'env2')[1].kind, 'sel');
  s.p['f.cutoff'] = 0.05;
  const b = ui.haloArcs(s, fx, 'f.cutoff', '');
  near(b[1].from, 0); near(b[1].to, 0.05, 1e-12);
  // v1 FX bases come from fx.p; g.master lives in s.p
  fx.p['fx.dly.mix'] = 0.2;
  s.matrix[10] = row({ src: 'lfo5', amt: 0.5, dst: 'fx.dly.mix' });
  const c = ui.haloArcs(s, fx, 'fx.dly.mix', 'lfo5');
  assert.equal(c.length, 1); near(c[0].from, 0.2, 1e-12); near(c[0].to, 0.7, 1e-12);
  s.p['g.master'] = 0.7;
  s.matrix[11] = row({ src: 'env1', amt: -0.1, dst: 'g.master' });
  near(ui.haloArcs(s, fx, 'g.master', 'lfo1')[0].from, 0.6, 1e-12);
  assert.deepEqual(ui.haloArcs(s, fx, 'nope', 'lfo1'), []);
  assert.deepEqual(ui.haloArcs(s, fx, 'b.level', 'lfo1'), []);
});

test('haloArcs: dynamic FX ids of a v2 FX state (base from the instance, §3.16.4); unknown instances give no arcs', () => {
  const s = fresh(), fx = fxV2();
  s.matrix[0] = row({ src: 'lfo2', amt: 0.4, dst: 'fx.d7.mix' });
  s.matrix[1] = row({ src: 'lfo3', amt: 0.4, dst: 'fx.zz.mix' });          // deleted instance
  const a = ui.haloArcs(s, fx, 'fx.d7.mix', 'lfo2');
  assert.equal(a.length, 1);
  near(a[0].from, 0.3, 1e-12); near(a[0].to, 0.7, 1e-12); assert.equal(a[0].kind, 'sel');
  assert.deepEqual(ui.haloArcs(s, fx, 'fx.zz.mix', 'lfo3'), []);
  assert.equal(ui.rowBad(fx, s.matrix[0]), false);
  assert.equal(ui.rowBad(fx, s.matrix[1]), true);                            // red in the matrix (§13.6)
  assert.equal(ui.rowBad(fx, row({ src: 'lfo1', dst: 'f.cutoff' })), false);
  assert.equal(ui.rowBad(fx, row()), false);
});

/* ================================================================ knob / module menus (§9.4, §13.3, §13.6) */
test('knobMenuItems v2: exact labels and order for 0 / 1 / 2 rows, Aux Source / Edit Custom Curve, MIDI', () => {
  const s = fresh(), fx = core.defaultFxV1();
  assert.deepEqual(labels(ui.knobMenuItems(s, fx, 'f.cutoff', {})), ['Reset Control', 'Enter Value…', '', 'Mod Source', '', 'Lock']);
  assert.deepEqual(labels(ui.knobMenuItems(s, fx, 'f.cutoff', { midi: true })), ['Reset Control', 'Enter Value…', '', 'Mod Source', '', 'MIDI Learn', 'Lock']);
  s.matrix[3] = row({ src: 'lfo1', amt: 0.3, dst: 'f.cutoff' });
  s.matrix[40] = row({ src: 'env2', amt: 0.3, dst: 'f.cutoff', byp: 1 });
  s.midi['21'] = 'f.cutoff';
  s.ui.mod = 'velo';                                                         // no row of the selected source
  const it = ui.knobMenuItems(s, fx, 'f.cutoff', { midi: true });
  assert.deepEqual(labels(it), ['Bypass Modulator: LFO 1', 'Bypass Modulator: Env 2', 'Remove Modulator: LFO 1', 'Remove Modulator: Env 2',
    'Remove All Modulators', 'Aux Source', 'Edit Custom Curve', '', 'Reset Control', 'Enter Value…', '', 'Mod Source', '', 'MIDI Re-learn (CC 21)', 'Remove MIDI CC 21', 'Lock']);
  assert.deepEqual(it.slice(0, 2).map(x => [x.slot, x.checked]), [[3, false], [40, true]]);
  // Aux Source / Edit Custom Curve address the selected source's row, else the recent one, else the last
  s.ui.mod = 'lfo1';
  assert.equal(it.find(x => x.kind === 'curve').slot, 40);                  // the last row
  assert.equal(ui.knobMenuItems(s, fx, 'f.cutoff', {}).find(x => x.kind === 'curve').slot, 3);
  s.ui.mod = 'velo';
  assert.equal(ui.knobMenuItems(s, fx, 'f.cutoff', { recent: 3 }).find(x => x.kind === 'auxSrc').slot, 3);
  const aux = ui.knobMenuItems(s, fx, 'f.cutoff', {}).find(x => x.kind === 'auxSrc');
  assert.equal(aux.sub[0].label, 'None');
  assert.equal(aux.sub[0].checked, true);
  assert.deepEqual(aux.sub.slice(1).map(g => g.label), core.srcMenu(s).map(g => g.group));
  // Mod Source: grouped as serum-core srcMenu (§3.10)
  const ms = it.find(x => x.kind === 'modsrc');
  assert.deepEqual(ms.sub.map(g => g.label), ['Envelopes', 'LFOs', 'Performance', 'Random', 'Macros', 'Audio', 'Voice', 'Fixed']);
  assert.equal(ms.sub[1].sub.length, 10);
  s.macros[2].name = 'Bright';
  assert.ok(ui.knobMenuItems(s, fx, 'f.cutoff', {}).find(x => x.kind === 'modsrc').sub.find(g => g.label === 'Macros').sub.some(x => x.label === 'Bright'));
  s.locks.p.push('f.cutoff');
  assert.equal(labels(ui.knobMenuItems(s, fx, 'f.cutoff', {})).at(-1), 'Unlock');
  // PHASE knobs of every oscillator offer a MemTrig phase set
  for (const id of ['a.phase', 'b.phase', 'c.phase']) assert.ok(labels(ui.knobMenuItems(s, fx, id, {})).includes('New MemTrig phase set'), id);
});

test('knobMenuItems: module items first; Unlock Control / Lock Control inside a locked module (locks.unp)', () => {
  const s = fresh(), fx = core.defaultFxV1();
  assert.deepEqual(labels(ui.knobMenuItems(s, fx, 'a.on', { module: 'oscA' })).slice(0, 7),
    ['Lock Module', 'Init Module', 'Copy', 'Copy (w/mods)', 'Swap with', '', 'Reset Control']);
  assert.deepEqual(labels(ui.knobMenuItems(s, fx, 'a.on', { module: 'oscA', paste: true })).slice(0, 6),
    ['Lock Module', 'Init Module', 'Copy', 'Copy (w/mods)', 'Paste', 'Swap with']);
  assert.deepEqual(ui.moduleMenuItems(s, 'oscB', {}).find(x => x.kind === 'swap').sub.map(x => x.m), ['oscA', 'oscC']);
  assert.deepEqual(ui.moduleMenuItems(s, 'filter2', {}).find(x => x.kind === 'swap').sub.map(x => x.label), ['Filter 1']);
  assert.deepEqual(ui.moduleMenuItems(s, 'lfo3', {}).find(x => x.kind === 'swap').sub.length, 9);
  assert.equal(ui.moduleMenuItems(s, 'noise', {}).some(x => x.kind === 'swap'), false);   // a module of its own kind
  assert.deepEqual(ui.moduleMenuItems(s, 'nope', {}), []);
  // controls of a locked module: Unlock Control adds the id to locks.unp, then Lock Control
  assert.equal(ui.destModule('a.level'), 'oscA');
  assert.equal(ui.destModule('f2.cutoff'), 'filter2');
  assert.equal(ui.destModule('e4.start'), 'env4');
  assert.equal(labels(ui.knobMenuItems(s, fx, 'a.level', {})).includes('Unlock Control'), false);
  s.locks.mod.push('oscA');
  assert.equal(labels(ui.knobMenuItems(s, fx, 'a.level', {})).at(-1), 'Unlock Control');
  assert.equal(ui.moduleMenuItems(s, 'oscA', {})[0].checked, true);
  s.locks.unp.push('a.level');
  assert.equal(labels(ui.knobMenuItems(s, fx, 'a.level', {})).at(-1), 'Lock Control');
  assert.equal(labels(ui.knobMenuItems(s, fx, 'b.level', {})).includes('Lock Control'), false);
});

test('dropRow: drop defaults (limit on / off, bipolar, bool, FX base) and a full 64-row matrix', () => {
  const s = fresh(), fx = core.defaultFxV1();
  s.p['f.cutoff'] = 0.8;
  let r = ui.dropRow(s, fx, 'lfo1', 'f.cutoff');
  assert.equal(r.slot, 0); near(r.row.amt, 0.2, 1e-12);
  r = ui.dropRow(s, fx, 'lfo2', 'f.cutoff', { limit: false });
  near(r.row.amt, 0.5, 1e-12);
  r = ui.dropRow(s, fx, 'env2', 'a.pan');
  assert.equal(r.row.bi, 1);
  s.p['f.on'] = 1;
  assert.equal(ui.dropRow(s, fx, 'lfo3', 'f.on').row.amt, -1);
  for (let i = 0; i < 64; i++) s.matrix[i] = row({ src: 'fixed', amt: 0.1, dst: 'a.level' });
  assert.equal(ui.dropRow(s, fx, 'lfo1', 'f.cutoff'), null);
  s.matrix[50] = row();
  assert.equal(ui.dropRow(s, fx, 'lfo1', 'f.cutoff').slot, 50);
  assert.equal(ui.dropRow(s, fx, 'nope', 'f.cutoff'), null);
  // dynamic FX destination
  const s2 = fresh(), f2 = fxV2();
  const d = ui.dropRow(s2, f2, 'lfo1', 'fx.d7.mix');
  assert.equal(d.row.dst, 'fx.d7.mix');
  near(d.row.amt, 0.5, 1e-12);
});

test('busMenuItems / linkPoints / ptsBuses (inv A13): new bus with its row, X never on end points, orphaned rows pruned', () => {
  const s = fresh(), fx = core.defaultFxV1();
  s.lfo[0].pts = [[0, 0, 0], [0.3, 1, 0], [0.6, 0.5, 0], [1, 0, 0]];
  assert.deepEqual(ui.busMenuItems(s, 0, 1, 'y'), [{ label: 'New bus', bus: 1 }]);
  assert.equal(ui.linkPoints(s, fx, 0, [1], 'y', 1, 'lfo2'), 1);
  assert.equal(ui.linkPoints(s, fx, 0, [0], 'x', 1, null), 0);
  const it = ui.busMenuItems(s, 0, 1, 'y');
  assert.deepEqual(it[0], { label: 'Bus 1 (LFO 2)', bus: 1, checked: true });
  s.matrix[5] = row({ src: 'lfo3', amt: 0.5, dst: 'bus4', bi: 1 });           // routing prepared before linking
  ui.linkPoints(s, fx, 0, [1], 'y', 2, null);                                  // bus 1 lost its only link
  assert.deepEqual(s.matrix.filter(r => r.src).map(r => r.dst), ['bus4']);
  assert.deepEqual(ui.ptsBuses(s.lfo[0].pts), [2]);
  assert.deepEqual(ui.ptsBuses(null), []);
});

test('lfoTileCount (§13.13, inv B16): min(10, max(6, highest used LFO + 1)); LFO 1–6 by default, LFO 7–10 appear one by one', () => {
  const s = fresh();
  assert.equal(ui.lfoTileCount(s), 6);
  s.matrix[0] = row({ src: 'lfo5', amt: 0.1, dst: 'a.level' });
  assert.equal(ui.lfoTileCount(s), 6);
  s.matrix[1] = row({ src: 'velo', amt: 0.1, dst: 'a.level', aux: 'lfo6' });
  assert.equal(ui.lfoTileCount(s), 7);
  s.matrix[2] = row({ src: 'lfo9', amt: 0.1, dst: 'a.level' });
  assert.equal(ui.lfoTileCount(s), 10);
  s.matrix[3] = row({ src: 'lfo10', amt: 0.1, dst: 'a.level' });
  assert.equal(ui.lfoTileCount(s), 10);
});

test('captureDue (§6.4, §6.21 item 6): S1 knob-end rule on OSC A / B only; S2 mode and OSC C: phMem switched to Per Voice', () => {
  const p = { 'a.phase': 1, 'a.rand': 0.5, 'b.phase': 0.5, 'b.rand': 0.5, 'c.phase': 1, 'c.rand': 0.2 };
  // plain s.p maps: the Phase-1 knob-end rule of OSC A / B (OSC C has none)
  assert.deepEqual(ui.captureDue(p, Object.assign({}, p, { 'a.rand': 1, 'c.rand': 1 }), 1), [0]);
  assert.deepEqual(ui.captureDue(p, Object.assign({}, p, { 'b.rand': 1 }), 1), []);        // B not in Mem
  assert.deepEqual(ui.captureDue(p, Object.assign({}, p, { 'a.rand': 1 }), 0), []);        // no notes
  const st = (q, s1, mem) => ({ p: Object.assign({}, p, q), global: { s1 }, osc: mem.map(m => ({ phMem: m })) });
  // S1 mode: knob ends on A / B; OSC C by its phase-memory menu
  assert.deepEqual(ui.captureDue(st({}, 1, ['all', 'all', 'all']), st({ 'a.rand': 1, 'c.rand': 1 }, 1, ['all', 'all', 'all']), 2), [0]);
  assert.deepEqual(ui.captureDue(st({}, 1, ['all', 'all', 'all']), st({}, 1, ['voice', 'all', 'voice']), 2), [2]);   // A's menu is ignored in S1
  // S2 mode: no knob-end rule (PHASE 360° + RAND 100 % is an ordinary setting); Per Voice captures, on every oscillator
  assert.deepEqual(ui.captureDue(st({}, 0, ['voice', 'all', 'all']), st({ 'a.rand': 1, 'c.rand': 1 }, 0, ['voice', 'all', 'all']), 2), []);
  assert.deepEqual(ui.captureDue(st({}, 0, ['all', 'contig', 'all']), st({}, 0, ['voice', 'voice', 'all']), 2), [0, 1]);
  assert.deepEqual(ui.captureDue(st({}, 0, ['voice', 'all', 'all']), st({}, 0, ['voice', 'all', 'all']), 2), []);   // no switch
  assert.deepEqual(ui.captureDue(st({}, 0, ['all', 'all', 'all']), st({}, 0, ['voice', 'all', 'voice']), 0), []);   // no notes
  assert.deepEqual(ui.captureDue(null, st({}, 0, ['voice', 'all', 'voice']), 2), []);                                  // no previous state
});

test('clipModule / pasteModule / initModule delegate to serum-core copyModule / initModule (§11.1 pairs, with mods)', () => {
  const s = fresh();
  s.p['a.level'] = 0.2; s.osc[0].wt = 'user:1'; s.osc[0].uni.range = 7;
  s.matrix[0] = row({ src: 'lfo1', amt: 0.4, dst: 'a.wt' });
  const clip = ui.clipModule(s, 'oscA'), clipM = ui.clipModule(s, 'oscA', true);
  assert.equal(clip.kind, 'osc');
  assert.equal(clipM.mods, true);
  s.p['a.level'] = 0.9;                                                        // the clipboard is a snapshot
  assert.equal(ui.pasteModule(s, 'oscC', clip), true);
  assert.equal(s.p['c.level'], 0.2);
  assert.equal(s.osc[2].wt, 'user:1');
  assert.equal(s.osc[2].uni.range, 7);
  assert.equal(s.matrix.filter(r => r.dst === 'c.wt').length, 0);           // without mods
  assert.equal(ui.pasteModule(s, 'oscB', clipM), true);
  assert.ok(s.matrix.some(r => r.src === 'lfo1' && r.dst === 'b.wt'));      // with mods: re-targeted rows
  assert.equal(ui.pasteModule(s, 'noise', clip), false);
  assert.equal(ui.pasteModule(s, 'filter', ui.clipModule(s, 'filter2')), true);
  assert.equal(ui.clipModule(s, 'nope'), null);
  // Init Module resets the module and removes its modulations (rows from it as a source stay)
  s.matrix[1] = row({ src: 'env2', amt: 0.4, dst: 'b.level' });
  assert.equal(ui.initModule(s, 'oscB'), true);
  assert.equal(s.p['b.level'], fresh().p['b.level']);
  assert.equal(s.matrix.some(r => r.dst === 'b.level' || r.dst === 'b.wt'), false);
  assert.ok(s.matrix.some(r => r.dst === 'a.wt'));
  assert.equal(ui.initModule(s, 'nope'), false);
});

test('parseGrid, parseAmount, normPrefs v2, memTrigSet, tileDests, modTipLines, ccFor, groupItems', () => {
  assert.deepEqual(ui.parseGrid('8'), { x: 8, y: 8 });
  assert.deepEqual(ui.parseGrid('4, 16'), { x: 4, y: 16 });
  assert.equal(ui.parseGrid('0'), null);
  assert.equal(ui.parseGrid('65'), null);
  near(ui.parseAmount('35'), 0.35); near(ui.parseAmount('-35 %'), -0.35); near(ui.parseAmount('0,5%'), 0.005);
  near(ui.parseAmount('−20'), -0.2);
  assert.equal(ui.parseAmount('abc'), null);
  assert.equal(ui.parseAmount('250'), 1);
  const st = ui.parseAmount('12st', 'a.semi', 0);
  assert.ok(st === null || (st > 0 && st <= 1));
  const P = ui.normPrefs({ tooltips: 0, dblClick: 'reset', defOs: 4, author: 'x'.repeat(80), smooth: 2.345, mpeBendX: 1, junk: 1 });
  assert.deepEqual(P, Object.assign({}, ui.PREFS_DEFAULT, { tooltips: 0, dblClick: 'reset', defOs: 4, author: 'x'.repeat(64), smooth: 2.35, mpeBendX: 1 }));
  assert.equal(ui.normPrefs(null).midiFromPreset, 1);                       // Phase-1 behaviour by default
  assert.equal(ui.normPrefs({ midiFromPreset: 0 }).midiFromPreset, 0);
  assert.deepEqual(Object.keys(ui.normPrefs({})).sort(), Object.keys(ui.PREFS_DEFAULT).sort());
  const m1 = ui.memTrigSet(1234);
  assert.deepEqual(m1, ui.memTrigSet(1234));
  assert.equal(m1.length, 16);
  assert.ok(m1.every(v => v >= 0 && v < 1));
  const s = fresh();
  s.matrix[2] = row({ src: 'lfo1', amt: 0.42, dst: 'f.cutoff', bi: 1 });
  s.matrix[5] = row({ src: 'lfo1', amt: -0.1, dst: 'a.level', byp: 1 });
  s.matrix[60] = row({ src: 'lfo1', amt: 0.2, dst: 'c.level' });
  assert.deepEqual(ui.tileDests(s, 'lfo1'), ['f.cutoff', 'a.level', 'c.level']);
  assert.deepEqual(ui.modTipLines(s, 'f.cutoff'), ['LFO 1 +42% <->']);
  assert.deepEqual(ui.modTipLines(s, 'a.level'), ['LFO 1 -10% -> (bypassed)']);
  s.midi = { 30: 'f.cutoff', 12: 'f.cutoff', 5: 'a.level' };
  assert.equal(ui.ccFor(s, 'f.cutoff'), 12);
  assert.equal(ui.ccFor(s, 'f.res'), null);
  const items = [{ v: '', group: '' }, { v: 1, group: 'A' }, { v: 2, group: 'B' }, { v: 3, group: 'A' }];
  assert.deepEqual(ui.groupItems(items).map(x => x.v), ['', 1, 3, 2]);
  assert.deepEqual(ui.groupItems(items, ['B']).map(x => x.v), [2, '', 1, 3]);
});

/* ================================================================ undo (§13.2.4) */
test('undoStack: base, push, identical snapshots ignored, coalescing by label within 600 ms, redo branch, limit, bytes', () => {
  const U = ui.undoStack(3);
  assert.equal(U.undo(), null);
  U.base('s0');
  assert.equal(U.canUndo(), false);
  assert.equal(U.push('s0', 'Edit', 0), false);                              // identical to the top
  U.push('s1', 'Cutoff', 1000);
  U.push('s2', 'Cutoff', 1500);                                              // same label within 600 ms: one step
  assert.equal(U.steps(), 1);
  assert.equal(U.top(), 's2');
  U.push('s3', 'Cutoff', 2200);                                              // later: a new step
  U.push('s4', 'Res', 2300);
  assert.equal(U.steps(), 3);
  assert.equal(U.label(), 'Res');
  assert.equal(U.undo(), 's3');
  assert.equal(U.undo(), 's2');
  assert.equal(U.canRedo(), true);
  assert.equal(U.redoLabel(), 'Cutoff');
  assert.equal(U.redo(), 's3');
  U.push('s5', 'Res', 2400);                                                 // after an undo / redo: never coalesces
  assert.equal(U.canRedo(), false);                                          // the redo branch is dropped
  assert.equal(U.top(), 's5');
  assert.equal(U.undo(), 's3');
  U.redo();
  for (let i = 6; i < 12; i++) U.push('s' + i, 'L' + i, 5000 + i * 1000);
  assert.equal(U.steps(), 3);                                                // limit: 3 undo steps + the base
  assert.equal(U.size(), 4);
  assert.equal(U.undo(), 's10'); assert.equal(U.undo(), 's9'); assert.equal(U.undo(), 's8'); assert.equal(U.undo(), null);
  // byte cap: the oldest entries go first (2 bytes per character)
  const B = ui.undoStack(100, { maxBytes: 100 });
  B.base('x'.repeat(20));
  B.push('y'.repeat(20), 'a', 0); B.push('z'.repeat(20), 'b', 1000);
  assert.ok(B.bytes() <= 100);
  assert.equal(B.size(), 2);
  B.clear();
  assert.equal(B.size(), 0);
  assert.equal(ui.undoStack().steps(), 0);
});

/* ================================================================ virtual destinations, S1 helpers */
test('virtGet / virtSet: macros, arp slot and clip bases (EDIT ALL), other ids untouched', () => {
  const s = fresh();
  s.macros[4].v = 0.25;
  assert.equal(ui.virtGet(s, 'm5'), 0.25);
  assert.equal(ui.virtSet(s, 'm5', 0.75), true);
  assert.equal(s.macros[4].v, 0.75);
  s.arp.sel = 2;
  assert.equal(ui.virtGet(s, 'arp.gate'), s.arp.slots[2].n.gate);
  ui.virtSet(s, 'arp.gate', 0.9);
  assert.equal(s.arp.slots[2].n.gate, 0.9);
  assert.notEqual(s.arp.slots[0].n.gate, 0.9);
  s.arp.editAll = 1;
  ui.virtSet(s, 'arp.gate', 0.1);
  assert.ok(s.arp.slots.every(x => x.n.gate === 0.1));
  ui.virtSet(s, 'clip.trans', 0.6);
  assert.equal(s.clip.clips[s.clip.sel].n.trans, 0.6);
  assert.equal(ui.virtGet(s, 'a.level'), undefined);
  assert.equal(ui.virtSet(s, 'a.level', 0.5), false);
  assert.equal(ui.virtGet(s, 'arp.on'), undefined);                         // a stored destination
  assert.equal(ui.virtSet(s, 'arp.nope', 0.5), false);
});

test('virtGet / virtSet: arp.rate is the slot\'s n.hz in HZ mode, n.rate in BPM mode — per slot under EDIT ALL (RULINGS2 C1/U1)', () => {
  const s = fresh();
  s.arp.sel = 2; s.arp.slots[2].bpm = 0;
  assert.equal(ui.virtGet(s, 'arp.rate'), s.arp.slots[2].n.hz);
  ui.virtSet(s, 'arp.rate', 0.3);
  assert.equal(s.arp.slots[2].n.hz, 0.3);
  assert.equal(s.arp.slots[2].n.rate, core.ARP_N.rate, 'the BPM base is untouched');
  assert.equal(core.destBase(s, core.defaultFx2(), 'arp.rate'), 0.3, 'serum-core destBase maps it the same way');
  s.arp.slots[2].bpm = 1;
  assert.equal(ui.virtGet(s, 'arp.rate'), core.ARP_N.rate);
  s.arp.editAll = 1; s.arp.slots[5].bpm = 0;
  ui.virtSet(s, 'arp.rate', 0.6);
  assert.equal(s.arp.slots[5].n.hz, 0.6, 'an HZ slot: n.hz');
  assert.equal(s.arp.slots[5].n.rate, core.ARP_N.rate);
  assert.equal(s.arp.slots[0].n.rate, 0.6, 'a BPM slot: n.rate');
});

test('s1Diff / rowAlias: S1 pairs out of sync and rows on the other mode\'s field (§2.6.4)', () => {
  const s = fresh();
  assert.deepEqual(ui.s1Diff(s), []);
  const before = JSON.stringify(s);
  s.p['a.w1'] = 3 / 81;                                                      // an S2 warp with no S1 equivalent
  assert.deepEqual(ui.s1Diff(s), ['Osc A Warp']);                             // serum-core S1_PAIRS labels
  assert.equal(JSON.stringify(s) === before, false);
  const snap = JSON.stringify(s);
  ui.s1Diff(s);
  assert.equal(JSON.stringify(s), snap);                                     // read-only
  assert.equal(ui.rowAlias(s, row({ src: 'lfo1', dst: 'a.warpMode' })), true);   // S2 mode: the v1 field is aliased
  assert.equal(ui.rowAlias(s, row({ src: 'lfo1', dst: 'a.w1' })), false);
  s.global.s1 = 1;
  assert.equal(ui.rowAlias(s, row({ src: 'lfo1', dst: 'a.w1' })), true);
  assert.equal(ui.rowAlias(s, row({ src: 'lfo1', dst: 'g.bendup' })), false);
  assert.equal(ui.rowAlias(s, row({ src: 'lfo1', dst: 'f.cutoff' })), false);
  assert.equal(ui.rowAlias(s, null), false);
});

/* ================================================================ presets (§9.10, §13.11) */
const PL = [
  { key: 'f:a', name: 'Bass 2', cat: 'Bass', author: 'Zed', stars: 3, tags: ['dark', 'mono'] },
  { key: 'f:b', name: 'bass 10', cat: 'Bass', author: 'Amy', tags: ['mono'] },
  { key: 'u:c', name: 'Pad', cat: 'Pad', author: 'Amy', user: true, stars: 5, tags: ['wide'] },
  { key: 'f:d', name: 'Lead', cat: 'Lead', author: 'Bob' },
];
const keys = l => l.map(p => p.key);
test('sortPresets / filterPresets (tags all / any / excluded, ratings) / browserList / presetCats / presetTags / normBrowser', () => {
  assert.deepEqual(keys(ui.sortPresets(PL, { sort: 'name' })), ['f:a', 'f:b', 'f:d', 'u:c']);
  assert.deepEqual(keys(ui.sortPresets(PL, { sort: 'author', sort2: 'cat' })), ['f:b', 'u:c', 'f:d', 'f:a']);
  assert.deepEqual(keys(ui.sortPresets(ui.withMeta(PL), { sort: 'stars', dir: -1 })), ['u:c', 'f:a', 'f:b', 'f:d']);
  assert.deepEqual(keys(ui.filterPresets(PL, { cat: 'Bass' })), ['f:a', 'f:b']);
  assert.deepEqual(keys(ui.filterPresets(PL, { q: 'AMY' })), ['f:b', 'u:c']);
  assert.deepEqual(keys(ui.filterPresets(PL, { tags: ['mono'] })), ['f:a', 'f:b']);
  assert.deepEqual(keys(ui.filterPresets(PL, { tags: ['mono', 'dark'] })), ['f:a']);
  assert.deepEqual(keys(ui.filterPresets(PL, { tags: ['dark', 'wide'], tagMode: 'any' })), ['f:a', 'u:c']);
  assert.deepEqual(keys(ui.filterPresets(PL, { excl: ['mono'] })), ['u:c', 'f:d']);
  assert.deepEqual(keys(ui.filterPresets(PL, { stars: 'any' })), ['f:a', 'u:c']);
  assert.deepEqual(keys(ui.filterPresets(PL, { stars: 'none' })), ['f:b', 'f:d']);
  assert.deepEqual(keys(ui.filterPresets(PL, { stars: 5 })), ['u:c']);
  assert.deepEqual(keys(ui.browserList(PL, { cat: 'Bass', sort: 'name', dir: -1 })), ['f:b', 'f:a']);
  assert.deepEqual(ui.presetCats(PL), ['Bass', 'Lead', 'Pad']);
  assert.deepEqual(ui.presetTags(PL), ['dark', 'mono', 'wide']);
  assert.deepEqual(ui.normBrowser({ sort: 'bad', dir: 'desc', tags: ['a', 'a', '', 7], stars: 9, tab: 'tags', autoPreview: 'y' }),
    Object.assign({}, ui.BROWSER_DEFAULT, { dir: -1, tags: ['a'], tab: 'tags', autoPreview: 1, excl: [] }));
});

test('withMeta / stepPreset / hybridPick', () => {
  const W = ui.withMeta(PL, { 'f:b': { stars: 4, tags: ['soft'], comments: 'nice' }, 'f:zz': { stars: 1 } });
  assert.deepEqual(W.map(p => p.stars), [3, 4, 5, 0]);
  assert.deepEqual(W[1].tags, ['soft']);
  assert.equal(W[1].comments, 'nice');
  assert.equal(PL[1].stars, undefined);                                      // inputs untouched
  const L = ui.sortPresets(PL, { sort: 'name' });
  assert.equal(ui.stepPreset(L, 'f:a', 1, 'Bass'), 'f:b');
  assert.equal(ui.stepPreset(L, 'f:b', 1, 'Bass'), 'f:a');
  assert.equal(ui.stepPreset(L, 'nope', -1), 'u:c');
  assert.equal(ui.stepPreset([], 'x', 1), null);
  const h = ui.hybridPick(PL, 42, 4);
  assert.equal(h.length, 4);
  assert.equal(new Set(h).size, 4);
  assert.deepEqual(ui.hybridPick(PL, 42, 4), h);                             // deterministic per seed
  assert.deepEqual(ui.hybridPick(PL, 7, 3, 'f:d')[0], 'f:d');                // the favoured parent first
  assert.equal(ui.hybridPick(PL, 7, 2).length, 2);
  assert.deepEqual(ui.hybridPick([], 1, 4), []);
});

test('isPristine / layers3d', () => {
  const s = fresh();
  assert.equal(ui.isPristine(s), true);
  s.global.os = 4; s.author = 'Me'; s.ui.view3d = [1, 0, 0]; s.ui.page = 'fx'; s.global.mpe.on = 1;
  assert.equal(ui.isPristine(s), true);
  s.p['a.level'] = 0.2;
  assert.equal(ui.isPristine(s), false);
  assert.equal(ui.isPristine(null), false);
  assert.deepEqual(ui.layers3d(1, 1), [{ z: 0, slot: 0, frame: 0, real: true }]);
  assert.equal(ui.layers3d(256, 256).length, 40);
});

/* ================================================================ SYNTH Canvas 2a: canvas cables on a knob (host.extraRows) */
test('2a haloArcs: the host\'s extra rows (canvas cables) add their arcs after the matrix\'s — slot −1, canvas: true; inactive ones none', () => {
  const s = fresh(), fx = core.defaultFxV1();
  s.p['f.cutoff'] = 0.5;
  s.matrix[0] = row({ src: 'lfo1', amt: 0.3, dst: 'f.cutoff' });
  const extra = [{ id: 'r1', src: 'wheel', amt: 0.2, bi: 0, byp: 0, out: 1 }, { id: 'r2', src: 'bend', amt: -0.4, bi: 1, byp: 0, out: 1 },
    { id: 'r3', src: 'velo', amt: 0.5, bi: 0, byp: 1, out: 1 }, { id: 'r4', src: 'at', amt: 0.5, bi: 0, byp: 0, out: 0 }, null];
  const a = ui.haloArcs(s, fx, 'f.cutoff', 'wheel', extra);
  assert.deepEqual(a.map(x => [x.slot, x.kind, !!x.canvas]), [[0, 'other', false], [-1, 'sel', true], [-1, 'neg', true]]);
  near(a[1].from, 0.5, 1e-12); near(a[1].to, 0.7, 1e-12);
  near(a[2].from, 0.3, 1e-12); near(a[2].to, 0.7, 1e-12);
  assert.deepEqual(ui.haloArcs(s, fx, 'f.cutoff', 'wheel'), a.slice(0, 1), 'without the host hook: the matrix alone');
  assert.deepEqual(ui.haloArcs(s, fx, 'nope', 'wheel', extra), []);
});

test('2a knobMenuItems: canvas cables first, as disabled "Canvas cable: <source>" entries (removed on the canvas, not here)', () => {
  const s = fresh(), fx = core.defaultFxV1();
  s.matrix[3] = row({ src: 'lfo1', amt: 0.3, dst: 'f.cutoff' });
  const it = ui.knobMenuItems(s, fx, 'f.cutoff', { extra: [{ id: 'r1', src: 'wheel', amt: 0.2, bi: 0, byp: 0, out: 1 }, { id: 'r2', src: 'velo', amt: 0.1 }] });
  assert.deepEqual(labels(it).slice(0, 4), ['Canvas cable: ' + ui.srcLabel(s, 'wheel'), 'Canvas cable: ' + ui.srcLabel(s, 'velo'), 'Bypass Modulator: LFO 1', 'Remove Modulator: LFO 1']);
  assert.deepEqual(it.slice(0, 2).map(x => [x.kind, x.id, x.disabled]), [['canvas', 'r1', true], ['canvas', 'r2', true]]);
  assert.deepEqual(labels(ui.knobMenuItems(s, fx, 'f.cutoff', { extra: [] })), labels(ui.knobMenuItems(s, fx, 'f.cutoff', {})));
});

test('(2b fixer C, U6) knobMenuItems: a canvas row with a host label reads "Canvas cable: <label>" (an ext source has no Serum name); without one the Serum source\'s label as before', () => {
  const s = fresh(), fx = core.defaultFxV1();
  const it = ui.knobMenuItems(s, fx, 'f.cutoff', { extra: [{ id: 'r1', src: 'ext1', amt: 0.2, label: 'LFO 1' }, { id: 'r2', src: 'lfo3', amt: 0.1, label: 'LFO 2 · PER NOTE' }, { id: 'r3', src: 'velo', amt: 0.1 }] });
  assert.deepEqual(labels(it).slice(0, 3), ['Canvas cable: LFO 1', 'Canvas cable: LFO 2 · PER NOTE', 'Canvas cable: ' + ui.srcLabel(s, 'velo')]);
});

/* ================================================================ a Wavecraft's host: createHost + rig faces (SX0 §3) */
// The kit / host behaviour serum-ui.test pinned on a SerumUI, on the host main.js builds for a rig (renderCustom: sx-host createHost)
// with its modules' faces (sxViews: rig-ui rigHost().face per module, VOICE the Amplifier) and the drawer's dialogs (sx-ui-mod
// panelDialog). Where an expected value moved, it moved by design: the comment at the line says why.
function pick(doc, label) {
  const ms = ctxMenus(doc), m = ms[ms.length - 1];
  const it = m.querySelectorAll('.wk-ci').find(n => n.querySelector('.wk-cl').textContent === label);
  assert.ok(it, 'menu item ' + label + ' in ' + JSON.stringify(menuLabels(m)));
  ptr(it, 'pointerdown', 1, 1);
  fire(it, 'click');
}
const byDest = (root, id) => root.querySelectorAll('[data-dest="' + id + '"]')[0] || null;
const panelOf = (root, title) => root.querySelectorAll('.sx-panel').find(p => p.getAttribute('aria-label') === title) || null;
const btnIn = (root, aria) => root.querySelectorAll('button').find(b => b.getAttribute('aria-label') === aria) || null;
const segIn = (root, label, text) => root.querySelectorAll('[role="radiogroup"]').find(g => g.getAttribute('aria-label') === label)
  .querySelectorAll('button').find(b => b.textContent === text);
const spin = (root, label) => root.querySelectorAll('[role="spinbutton"]').find(n => n.getAttribute('aria-label') === label) || null;
const okDialog = (u, label = 'OK') => fire(u.el.querySelector('.sx-dlg').querySelectorAll('button').find(b => b.textContent === label), 'click');
const noUi = st => JSON.stringify(Object.assign({}, st, { ui: undefined }));

const PRESETS = () => [
  { key: 'f:0', name: 'Init', cat: 'Init', author: '', user: false },
  { key: 'f:1', name: 'Deep Bass', cat: 'Bass', author: 'Ann', user: false },
  { key: 'f:2', name: 'Acid Bass', cat: 'Bass', author: 'Bob', user: false },
  { key: 'u:1', name: 'My Bass', cat: 'Bass', author: 'Me', user: true },
  { key: 'f:3', name: 'Soft Pad', cat: 'Pad', author: 'Ann', user: false },
];
function mkHost(over) {
  const st = { s: fresh(), fx: core.defaultFxV1() }, log = [], store = new Map();
  const presets = PRESETS();
  let cur = 'f:1';
  const saw = new Float32Array(2048).map((_, i) => 1 - 2 * i / 2048);
  const objOf = k => {   // preset objects for Hybridize (presets.get)
    const p = presets.find(x => x.key === k);
    if (!p) return null;
    const s = fresh();
    s.p['a.level'] = 0.1 * (presets.indexOf(p) + 1);
    s.author = p.author;
    s.notes = 'About ' + p.name;
    return { name: p.name, cat: p.cat, v: { s }, fx: core.defaultFxV1(), date: '2026-01-02T00:00:00Z' };
  };
  const host = {
    st, log, store, presets,
    state: () => st.s,
    edit: (fn, o) => { fn(st.s); log.push(['edit', o && o.label, o && o.phase, !!(o && o.ui)]); },
    fx: () => st.fx,
    editFx: (fn, o) => { fn(st.fx); log.push(['editFx', o && o.label]); },
    bpm: () => 120,
    wt: {
      list: () => [{ id: 'factory:Default', name: 'Default', cat: 'Basic', user: false }, { id: 'user:1', name: 'Mine', cat: '', user: true }],
      get: id => Promise.resolve(id === 'factory:Default' ? { name: 'Default', frames: [saw], morph: 0 } : null),
      saveNew: (t, name) => { log.push(['saveNew', name]); return Promise.resolve('user:new'); },
      update() {},
      noises: () => [{ id: 'noise:White', name: 'White', cat: 'Colors', user: false, oneshot: 0 }],
      saveNoise: (e, name) => { log.push(['saveNoise', name]); return Promise.resolve('nzuser:new'); },
    },
    smp: {
      list: kind => (kind === 'sample' ? [{ id: 'smp:r1', name: 'Render 1', cat: 'User', folder: 'Renders', user: true }, { id: 'smp:x', name: 'Other', cat: 'User', folder: '', user: true }] : []),
    },
    tracks: () => [{ id: 't1', name: 'Track 1', model: 'serum' }],
    seqCmd: (cmd, arg) => log.push(['seqCmd', cmd, arg]),
    preview: key => log.push(['preview', key]),
    renderLast: o => { log.push(['renderLast', o]); return Promise.resolve(); },
    tuningFile: () => Promise.resolve({ name: '19-EDO', kind: 'scl', scl: '! 19\n19\n', kbm: '', tab: new Float64Array(128).fill(1) }),
    audition: { on() {}, off() {} },
    monitor: on => log.push(['monitor', on]),
    presets: {
      list: () => presets,
      load: k => { cur = k; log.push(['load', k]); },
      get: objOf,
      save: o => {
        log.push(['save', o.name, o.cat, !!o.overwrite]);
        if (!presets.some(p => p.user && p.name === o.name)) presets.push({ key: 'u:' + presets.length, name: o.name, cat: o.cat, author: '', user: true });
        cur = presets.find(p => p.user && p.name === o.name).key;
        return cur;
      },
      del: k => { const i = presets.findIndex(p => p.key === k); if (i >= 0) presets.splice(i, 1); log.push(['del', k]); },
      exportFile: k => log.push(['export', k]),
      importFile: () => Promise.resolve(null),
      current: () => cur,
    },
    midiLearn: id => { log.push(['learn', id]); st.s.midi['33'] = id; return Promise.resolve(33); },
    midiForget: id => { log.push(['forget', id]); for (const k of Object.keys(st.s.midi)) if (st.s.midi[k] === id) delete st.s.midi[k]; },
    resample: t => { log.push(['resample', t]); return Promise.resolve(); },
    storage: { get: (k, d) => (store.has(k) ? store.get(k) : d), set: (k, v) => store.set(k, JSON.parse(JSON.stringify(v))) },
    notify: t => log.push(['notify', t]),
    prefsChanged: p => log.push(['prefs', p]),
  };
  return Object.assign(host, over || {});
}
// every module a case reaches, as a rig shows them ([kind, part, shown?]: shown — the module on screen, H4; default true)
const FACES = [['amp', 'voice'], ['osc', 'oscA'], ['osc', 'oscB'], ['osc', 'oscC'], ['sub', 'sub'], ['noise', 'noise'], ['filter', 'filter'], ['filter', 'filter2'],
  ['env', 'env1'], ['env', 'env2'], ['env', 'env3'], ['env', 'env4'], ['lfo', 'lfo1'], ['lfo', 'lfo2'], ['macros', 'macros']];
// a Wavecraft's host over mkHost's state (main.js renderCustom: createHost(sxHost, { doc })), its faces in one root (F: part → View)
async function mount(over, prep, faces = FACES) {
  const doc = D.fresh();
  const host = mkHost(over), root = doc.createElement('div');
  doc.body.appendChild(root);
  if (prep) prep(host, doc);
  const u = ui.createHost(host, { doc }), rh = RU.rigHost({ doc }), F = {};
  for (const [kind, part, shown] of faces) F[part] = rh.face(kind, root, { host: u, part, dev: u.dev, shown });
  await flush(doc);
  return { doc, host, root, u, F, rh, s: () => host.st.s };
}
// the drawer's dialogs (rig-ui: Quality… / Tuning… / Voice control…; the Amplifier's ⋯ Preferences…): sx-ui-mod panelDialog
const dlg = (u, Make, title) => MOD.panelDialog(u, Make, title).el;
// a module's ⋯ (the canvas bar's: View.menuItems — the kit's module items, then the panel's own)
const items = V => V.menuItems().map(x => (x.sep ? '' : x.label));
const act = (V, label) => { const it = V.menuItems().find(x => x.label === label); assert.ok(it, label + ' in ' + JSON.stringify(items(V))); it.action(); };
// the canvas bar's title of a module: View.labelDrag makes it the module's label (data-modlabel, its swap / copy / source drag)
const titleOf = (doc, V) => { const t = doc.createElement('span'); doc.body.appendChild(t); V.labelDrag(t); return t; };

test('a Wavecraft\'s Envelope / LFO ⋯ — Bypass All / Remove All Destinations (inv B15), one undo step each (was: SerumUI\'s source tile, ENV tab and LFO title)', async () => {
  const { doc, u, F, s } = await mount();
  u.edit(st => {
    st.matrix[0] = row({ src: 'env2', amt: 0.5, dst: 'f.cutoff' });
    st.matrix[1] = row({ src: 'env2', amt: 0.3, dst: 'a.level' });
    st.matrix[2] = row({ src: 'lfo1', amt: 0.2, dst: 'a.pan' });
    st.matrix[3] = row({ src: 'velo', amt: 0.4, dst: 'a.level' });
  });
  await flush(doc);
  // Envelope 2's ⋯: both items; bypass sets every ENV 2 row, the other sources untouched; again (✓) un-bypasses them
  assert.deepEqual(items(F.env2).slice(-2), ['Bypass All Destinations', 'Remove All Destinations']);
  act(F.env2, 'Bypass All Destinations');
  await flush(doc);
  assert.deepEqual(s().matrix.slice(0, 4).map(r => r.byp), [1, 1, 0, 0]);
  assert.equal(u.undo.label(), 'Bypass All Destinations');
  act(F.env2, 'Bypass All Destinations');
  await flush(doc);
  assert.deepEqual(s().matrix.slice(0, 4).map(r => r.byp), [0, 0, 0, 0]);
  // Remove All Destinations clears ENV 2's rows in one undo step
  act(F.env2, 'Remove All Destinations');
  await flush(doc);
  assert.deepEqual(s().matrix.slice(0, 4).map(r => r.src), ['', '', 'lfo1', 'velo']);
  assert.equal(u.undo.label(), 'Remove All Destinations');
  u.undoRedo(false);
  await flush(doc);
  assert.deepEqual(s().matrix.slice(0, 4).map(r => r.src), ['env2', 'env2', 'lfo1', 'velo'], 'one undo step');
  // LFO 1's ⋯ (VELO has no module on a Wavecraft — its tile was the bundled strip's: its row stays as it was)
  act(F.lfo1, 'Remove All Destinations');
  assert.deepEqual(s().matrix.slice(0, 4).map(r => [r.src, r.byp]), [['env2', 0], ['env2', 0], ['', 0], ['velo', 0]]);
  // a source without destinations: both items disabled
  assert.equal(F.env4.menuItems().filter(x => (x.label === 'Bypass All Destinations' || x.label === 'Remove All Destinations') && x.disabled).length, 2);
  u.destroy();
});

test('a face knob\'s right-click menu v2 (grouped Mod Source, Aux Source, Edit Custom Curve) and its actions (was: SerumUI\'s)', async () => {
  const { doc, host, u, root, s } = await mount();
  // (RES, not CUTOFF: the Filter face's donor is the real FILTER panel, whose CUTOFF leads with its own Key Track and folds the kit's
  // menu into "Modulation, MIDI, Lock…" — sx-ui-osc extraMenu; serum-ui.test's OSC page held the panel stub. RES has the kit's menu alone)
  const knob = byDest(root, 'f.res');
  fire(knob, 'contextmenu', { clientX: 50, clientY: 60 });
  let m = ctxMenus(doc);
  assert.equal(m.length, 1);
  assert.deepEqual(menuLabels(m[0]), ['Reset Control', 'Enter Value…', '', 'Mod Source', '', 'MIDI Learn', 'Lock']);
  pick(doc, 'Mod Source');
  pick(doc, 'LFOs');
  pick(doc, 'LFO 3');
  await flush(doc);
  assert.deepEqual(s().matrix[0], row({ src: 'lfo3', amt: 0.5, dst: 'f.res' }));
  assert.equal(s().ui.mod, 'lfo3');
  assert.ok(knob.classList.contains('wk-modded'));                    // halo drawn
  fire(knob, 'contextmenu', { clientX: 50, clientY: 60 });
  m = ctxMenus(doc);
  assert.deepEqual(menuLabels(m.at(-1)).slice(0, 6), ['Bypass Modulator: LFO 3', 'Remove Modulator: LFO 3', 'Remove All Modulators', 'Aux Source', 'Edit Custom Curve', '']);
  pick(doc, 'Aux Source');
  pick(doc, 'Envelopes');
  pick(doc, 'Env 2');
  assert.equal(s().matrix[0].aux, 'env2');
  fire(knob, 'contextmenu', { clientX: 50, clientY: 60 });
  pick(doc, 'Edit Custom Curve');
  const ed = gxStub.made.at(-1);
  assert.equal(ed.o.kind, 'mcurve');
  assert.ok(u.pop && u.pop.o === 'crv0');
  ed.o.set([[0, 0, 0], [0.5, 0.8, 0], [1, 1, 0]], 'set');
  assert.deepEqual(s().matrix[0].crv, [[0, 0, 0], [0.5, 0.8, 0], [1, 1, 0]]);
  ed.o.slew.set({ slink: 1 }, 'set');
  ed.o.slew.set({ rise: 0.4 }, 'set');
  assert.deepEqual([s().matrix[0].rise, s().matrix[0].fall, s().matrix[0].slink], [0.4, 0.4, 1]);   // SmoothLink: FALL = RISE
  assert.deepEqual(ed.o.slew.get(), { rise: 0.4, fall: 0.4, slink: 1 });
  ed.o.init();
  assert.equal(s().matrix[0].crv, null);
  u.pop.close();
  fire(knob, 'contextmenu', { clientX: 50, clientY: 60 });
  pick(doc, 'Bypass Modulator: LFO 3');
  assert.equal(s().matrix[0].byp, 1);
  fire(knob, 'contextmenu', { clientX: 50, clientY: 60 });
  pick(doc, 'Lock');
  assert.deepEqual(s().locks.p, ['f.res']);
  fire(knob, 'contextmenu', { clientX: 50, clientY: 60 });
  pick(doc, 'MIDI Learn');
  await flush(doc);
  assert.deepEqual(host.log.filter(x => x[0] === 'learn'), [['learn', 'f.res']]);
  fire(knob, 'contextmenu', { clientX: 50, clientY: 60 });
  m = ctxMenus(doc);
  assert.deepEqual(menuLabels(m.at(-1)).slice(-3), ['MIDI Re-learn (CC 33)', 'Remove MIDI CC 33', 'Unlock']);
  pick(doc, 'Remove MIDI CC 33');
  assert.deepEqual(s().midi, {});
  fire(knob, 'contextmenu', { clientX: 50, clientY: 60 });
  pick(doc, 'Remove Modulator: LFO 3');
  assert.equal(s().matrix[0].src, '');
  s().p['f.res'] = 0.9;
  fire(knob, 'contextmenu', { clientX: 50, clientY: 60 });
  pick(doc, 'Reset Control');
  assert.equal(s().p['f.res'], core.DESTS[core.DEST_INDEX['f.res']].def);
  u.destroy();
});

test('(canvas 2b) the Filter face\'s routing switches (data-pdest, no data-dest) keep MIDI learn and the per-control lock but take no modulation — no Mod Source in the menu, no halo, no drop target, no Alt-drag depth (was: SerumUI + the real FILTER panel)', async () => {
  const { doc, host, u, F, s } = await mount();
  const FE = F.filter.el;
  // (the face's words on the switches are rig-ui's: found by their parameter, data-pdest)
  const sw = X => FE.querySelectorAll('.wk-tog').find(n => n.getAttribute('data-pdest') === 'f.route' + X);
  const S = sw('S'), A = sw('A');
  assert.deepEqual([S.getAttribute('data-pdest'), S.getAttribute('data-dest'), A.getAttribute('data-pdest')], ['f.routeS', null, 'f.routeA']);
  // right-click: Reset / Enter Value / MIDI Learn / Lock — but no Mod Source (the one way to add a row from the menu)
  fire(S, 'contextmenu', { clientX: 20, clientY: 20 });
  assert.deepEqual(menuLabels(ctxMenus(doc).at(-1)), ['Reset Control', 'Enter Value…', '', 'MIDI Learn', 'Lock']);
  pick(doc, 'MIDI Learn');
  await flush(doc);
  assert.deepEqual([host.log.filter(x => x[0] === 'learn'), s().midi['33']], [[['learn', 'f.routeS']], 'f.routeS'], 'learn arms on the switch and maps the CC to f.routeS');
  fire(S, 'contextmenu', { clientX: 20, clientY: 20 });
  assert.deepEqual(menuLabels(ctxMenus(doc).at(-1)).slice(-3), ['MIDI Re-learn (CC 33)', 'Remove MIDI CC 33', 'Lock']);
  pick(doc, 'Remove MIDI CC 33');
  assert.deepEqual(s().midi, {});
  // the lock: locks.p, the tint on the switch (not on its neighbour), Unlock back
  fire(S, 'contextmenu', { clientX: 20, clientY: 20 });
  pick(doc, 'Lock');
  await flush(doc);
  assert.deepEqual([s().locks.p, S.classList.contains('sx-locked-ctl'), A.classList.contains('sx-locked-ctl')], [['f.routeS'], true, false]);
  fire(S, 'contextmenu', { clientX: 20, clientY: 20 });
  assert.equal(menuLabels(ctxMenus(doc).at(-1)).at(-1), 'Unlock');
  pick(doc, 'Unlock');
  await flush(doc);
  assert.deepEqual([s().locks.p, S.classList.contains('sx-locked-ctl')], [[], false]);
  // a locked MODULE (the filter): the switch is a control in it — Unlock Control / Lock Control apply to it too
  u.edit(st => { core.setModuleLock(st, 'filter', true); });
  await flush(doc);
  assert.equal(S.classList.contains('sx-locked-ctl'), true, 'inside a locked module');
  fire(S, 'contextmenu', { clientX: 20, clientY: 20 });
  assert.equal(menuLabels(ctxMenus(doc).at(-1)).at(-1), 'Unlock Control');
  pick(doc, 'Unlock Control');
  await flush(doc);
  assert.deepEqual([s().locks.unp, S.classList.contains('sx-locked-ctl')], [['f.routeS'], false]);
  // still no modulation target: a row a preset carries on the switch draws no halo; a drop finds nothing on it (the bundled strip's
  // tile drag that exercised it went with the shell: its hit test is the drop's); Alt-drag edits no depth; the knob beside it stays a target
  u.edit(st => { st.matrix[0] = row({ src: 'lfo1', amt: 0.4, dst: 'f.routeS' }); });
  await flush(doc);
  assert.equal(S.classList.contains('wk-modded'), false, 'no halo');
  const res = byDest(FE, 'f.res');
  doc.pointAt = () => S;
  assert.equal(u.hitTest(20, 20, 'lfo2', false), null, 'the switch is no drop target');
  const edits0 = host.log.filter(x => x[1] === 'Mod depth').length;
  ptr(S, 'pointerdown', 100, 100, { altKey: true }); ptr(F.filter.root, 'pointermove', 100, 50); ptr(F.filter.root, 'pointerup', 100, 50);
  assert.deepEqual([host.log.filter(x => x[1] === 'Mod depth').length, s().matrix[0].amt], [edits0, 0.4], 'no depth edit');
  doc.pointAt = () => res;
  assert.deepEqual(Object.assign({}, u.hitTest(20, 20, 'lfo2', false), { el: null }), { kind: 'dest', el: null, id: 'f.res' }, 'the knob beside it is still a target');
  u.destroy();
});

test('module menus on a Wavecraft — the ⏻\'s right-click (Lock / Init / Copy / Copy (w/mods) / Paste / Swap), the ⋯\'s module items, Unlock Control, the bar title\'s label drag (was: SerumUI\'s module menus)', async () => {
  const { doc, u, root, F, s } = await mount();
  // each face's ⏻ in its canvas bar's power slot (View.power, main.js sxPowerEl: adopted by the host — its menu, its halo)
  const bar = doc.createElement('div');
  doc.body.appendChild(bar);
  for (const p of ['oscA', 'oscB', 'oscC', 'noise']) bar.appendChild(F[p].power);
  const pw = byDest(bar, 'a.on');
  assert.equal(pw.getAttribute('data-module'), 'oscA');
  fire(pw, 'contextmenu', { clientX: 10, clientY: 10 });
  assert.deepEqual(menuLabels(ctxMenus(doc).at(-1)).slice(0, 7), ['Lock Module', 'Init Module', 'Copy', 'Copy (w/mods)', 'Swap with', '', 'Reset Control']);
  u.edit(st => { st.p['a.level'] = 0.2; st.matrix[0] = row({ src: 'lfo1', amt: 0.3, dst: 'a.wt' }); });
  pick(doc, 'Copy (w/mods)');
  const pwC = byDest(bar, 'c.on');
  fire(pwC, 'contextmenu', { clientX: 10, clientY: 10 });
  assert.deepEqual(menuLabels(ctxMenus(doc).at(-1)).slice(0, 6), ['Lock Module', 'Init Module', 'Copy', 'Copy (w/mods)', 'Paste', 'Swap with']);
  pick(doc, 'Paste');
  assert.equal(s().p['c.level'], 0.2);
  assert.ok(s().matrix.some(r => r.src === 'lfo1' && r.dst === 'c.wt'));
  // the clipboard does not fit another kind: no Paste on the noise module
  fire(byDest(bar, 'n.on'), 'contextmenu', { clientX: 10, clientY: 10 });
  assert.equal(menuLabels(ctxMenus(doc).at(-1)).includes('Paste'), false);
  // Swap with ▸ (touch long-press equivalent of the label drag)
  u.edit(st => { st.p['b.level'] = 0.6; });
  fire(pw, 'contextmenu', { clientX: 10, clientY: 10 });
  pick(doc, 'Swap with');
  pick(doc, 'OSC B');
  assert.deepEqual([s().p['a.level'], s().p['b.level']], [0.6, 0.2]);
  assert.ok(s().matrix.some(r => r.src === 'lfo1' && r.dst === 'b.wt'));
  // Init Module removes the module's modulations
  fire(byDest(bar, 'b.on'), 'contextmenu', { clientX: 10, clientY: 10 });
  pick(doc, 'Init Module');
  assert.equal(s().p['b.level'], fresh().p['b.level']);
  assert.equal(s().matrix.some(r => r.dst === 'b.wt'), false);
  // the module's ⋯ (on the canvas bar; was: the panel title's right-click) carries the same items, Lock Module there, then Unlock
  // Control on one of its knobs
  assert.deepEqual(items(F.oscB).slice(0, 2), ['Lock Module', 'Init Module']);
  act(F.oscB, 'Lock Module');
  assert.deepEqual(s().locks.mod, ['oscB']);
  await flush(doc);
  const bl = byDest(root, 'b.level');
  assert.ok(bl.classList.contains('sx-locked-ctl'));
  fire(bl, 'contextmenu', { clientX: 5, clientY: 5 });
  assert.equal(menuLabels(ctxMenus(doc).at(-1)).at(-1), 'Unlock Control');
  pick(doc, 'Unlock Control');
  assert.deepEqual(s().locks.unp, ['b.level']);
  await flush(doc);
  assert.equal(bl.classList.contains('sx-locked-ctl'), false);           // unlocked controls show no lock tint
  assert.ok(byDest(root, 'b.pan').classList.contains('sx-locked-ctl'));
  // module label drag (§13.3, inv B2) on the bar titles (View.labelDrag): plain = swap, Alt = copy
  const T = { oscA: titleOf(doc, F.oscA), oscC: titleOf(doc, F.oscC), noise: titleOf(doc, F.noise) }, lab = m => T[m];
  u.edit(st => { st.p['a.pan'] = 0.1; st.p['c.pan'] = 0.9; });
  doc.pointAt = () => lab('oscC');
  ptr(lab('oscA'), 'pointerdown', 10, 10); ptr(lab('oscA'), 'pointermove', 40, 10); ptr(lab('oscA'), 'pointerup', 40, 10);
  assert.deepEqual([s().p['a.pan'], s().p['c.pan']], [0.9, 0.1]);
  ptr(lab('oscA'), 'pointerdown', 10, 10, { altKey: true }); ptr(lab('oscA'), 'pointermove', 40, 10, { altKey: true }); ptr(lab('oscA'), 'pointerup', 40, 10, { altKey: true });
  assert.deepEqual([s().p['a.pan'], s().p['c.pan']], [0.9, 0.9]);
  doc.pointAt = () => lab('noise');                                         // another kind: nothing
  ptr(lab('oscA'), 'pointerdown', 10, 10); ptr(lab('oscA'), 'pointermove', 40, 10); ptr(lab('oscA'), 'pointerup', 40, 10);
  assert.equal(s().p['a.pan'], 0.9);
  u.destroy();
});

test('Alt-drag depth on a face knob (the selected source\'s row, else the most recent) and Shift+Alt polarity (was: SerumUI\'s tile drag-and-drop case — its tile drops went with the bundled strip)', async () => {
  const { doc, host, u, root, F, s } = await mount();
  const res = byDest(root, 'f.res');
  s().p['f.res'] = 0.7;
  u.edit(st => { st.matrix[0] = row({ src: 'lfo2', amt: 0.3, dst: 'f.res' }); });   // (the row the strip's LFO 2 tile dropped on RES made)
  await flush(doc);
  // Alt-drag on the knob edits the selected source's row, else the most recent row (200 px = 2.0)
  u.selectSrc('lfo2');
  ptr(res, 'pointerdown', 100, 100, { altKey: true });
  ptr(F.filter.root, 'pointermove', 100, 50);
  ptr(F.filter.root, 'pointerup', 100, 50);
  near(s().matrix[0].amt, 0.8, 1e-9);
  assert.ok(host.log.some(x => x[1] === 'Mod depth' && x[2] === 'end'));
  ptr(res, 'pointerdown', 100, 100, { altKey: true, shiftKey: true });
  assert.equal(s().matrix[0].bi, 1);
  u.destroy();
});

test('halos and live dots on the faces from snapshots (eff by vi), phase capture (S1 knob ends, S2 Per Voice) (was: SerumUI\'s — its voice counter and output meter were the header\'s)', async () => {
  const { doc, host, u, root, s } = await mount();
  u.edit(st => { st.matrix[0] = row({ src: 'lfo1', amt: 0.4, dst: 'a.wt' }); st.p['c.phase'] = 1; st.p['c.rand'] = 0.5; st.p['a.phase'] = 1; st.p['a.rand'] = 0.5; });
  await flush(doc);
  const wtk = byDest(root, 'a.wt');
  assert.ok(wtk.classList.contains('wk-modded'));
  const eff = new Float32Array(core.NSV + 8);
  eff[core.vi('a.wt')] = 0.3;
  const memNow = new Float32Array(48).fill(0.25);
  const mix = new Float32Array(11).fill(-Infinity);
  mix[9] = -6;
  u.setSnapshot({ s: { eff, notes: 1, oscVoices: 3, maxVoices: 136, memNow, mix, lfoPh: new Float32Array(10), envStage: new Uint8Array(4), envT: new Float32Array(4) }, gr: null, fxph: null });
  await flush(doc);
  assert.notEqual(wtk.querySelector('.wk-live').getAttribute('display'), 'none');
  // S2 mode (default): PHASE 360° + RAND 100 % is an ordinary setting — no knob-end capture on any oscillator (§6.4)
  assert.equal(s().global.s1, 0);
  const set0 = s().osc.map(O => O.memSet.slice());
  fire(byDest(root, 'c.rand'), 'keydown', { key: 'End' });
  fire(byDest(root, 'a.rand'), 'keydown', { key: 'End' });
  await flush(doc);
  assert.equal(s().p['c.rand'], 1);
  assert.deepEqual(s().osc.map(O => O.memSet), set0);
  assert.ok(!host.log.some(x => x[1] === 'Capture phases'));
  // S2: switching the phase memory to Per Voice while notes sound captures the recent voice's phases, in the same
  // undo step (a sub-panel's kit edit, as sx-ui-osc's MEM menu makes it)
  s().osc[2].phMem = 'all';
  u.refresh();
  await flush(doc);
  u.kit.edit(st => { st.osc[2].phMem = 'voice'; }, 'Phase memory');
  await flush(doc);
  assert.deepEqual(s().osc[2].memSet, new Array(16).fill(0.25));
  assert.ok(host.log.some(x => x[1] === 'Capture phases'));
  assert.deepEqual(s().osc[0].memSet, set0[0]);
  assert.equal(u.undo.label(), 'Capture phases');
  u.undoRedo(false);
  await flush(doc);
  assert.equal(s().osc[2].phMem, 'all');                                  // one step: the menu change and the capture
  assert.deepEqual(s().osc[2].memSet, set0[2]);
  // a state replaced from outside (program change) with phMem Per Voice keeps the memSet it brings
  host.log.length = 0;
  s().osc[1].phMem = 'voice'; s().osc[1].memSet = new Array(16).fill(0.5);
  u.refresh();
  await flush(doc);
  assert.deepEqual(s().osc[1].memSet, new Array(16).fill(0.5));
  assert.ok(!host.log.some(x => x[1] === 'Capture phases'));
  // S1 mode: the Phase-1 knob-end rule on OSC A / B (RAND → 100 % while PHASE is Mem), never on OSC C
  u.edit(st => { st.global.s1 = 1; st.p['a.rand'] = 0.5; st.p['c.rand'] = 0.5; st.osc[2].phMem = 'all'; }, { label: 'S1' });
  await flush(doc);
  host.log.length = 0;
  const setC = s().osc[2].memSet.slice();
  fire(byDest(root, 'a.rand'), 'keydown', { key: 'End' });
  fire(byDest(root, 'c.rand'), 'keydown', { key: 'End' });
  await flush(doc);
  assert.deepEqual(s().osc[0].memSet, new Array(16).fill(0.25));
  assert.deepEqual(s().osc[2].memSet, setC);
  assert.ok(host.log.some(x => x[1] === 'Capture phases'));
  // no notes sounding: nothing is captured
  u.setSnapshot({ s: { eff, notes: 0, memNow: new Float32Array(48).fill(0.75) } });
  await flush(doc);
  u.kit.edit(st => { st.osc[2].phMem = 'voice'; }, 'Phase memory');
  await flush(doc);
  assert.deepEqual(s().osc[2].memSet, setC);
  u.setSnapshot(null);
  await flush(doc);
  u.destroy();
});

test('the drawer\'s dialogs (§13.10) — QUALITY, S1 Compatibility Mode, TUNING, VOICE CONTROL (was: SerumUI\'s GLOBAL page; its MPE, UNISON A–C and CHAOS (S1) panels went with it)', async () => {
  const { doc, host, u, s } = await mount();
  // QUALITY (Quality…): Draft / High / Ultra (global.os 1 / 2 / 4) + lock, effective rate (snapshot tapRate, else the factor)
  const Q = panelOf(dlg(u, MOD.QualityPanel, 'Quality'), 'QUALITY');
  fire(segIn(Q, 'Quality', 'Ultra'), 'click');
  assert.equal(s().global.os, 4);
  await flush(doc);
  assert.equal(Q.querySelector('.sx-rate').textContent, 'Runs at 4× the device rate (capped at 384 kHz)');
  u.setSnapshot({ s: { tapRate: 192000 }, gr: null, fxph: null });
  await flush(doc);
  u.paint(true);
  assert.equal(Q.querySelector('.sx-rate').textContent, 'Running at 192 kHz');
  fire(segIn(Q, 'Quality', 'Draft'), 'click');
  assert.equal(s().global.os, 1);
  fire(btnIn(Q, 'LOCK'), 'click');
  assert.equal(s().locks.misc.os, 1);
  // ✓ S1 Compatibility Mode: only global.s1 changes, switching back restores the state exactly (§2.6.4)
  const before = noUi(s()), s1 = btnIn(Q, 'S1 Compatibility Mode');
  fire(s1, 'click');
  assert.equal(s().global.s1, 1);
  assert.equal(noUi(Object.assign({}, s(), { global: Object.assign({}, s().global, { s1: 0 }) })), before);
  fire(s1, 'click');
  assert.equal(noUi(s()), before);
  assert.ok(host.log.some(x => x[0] === 'edit' && x[1] === 'S1 Compatibility Mode'));
  const note = Q.querySelector('.sx-note');
  assert.ok(note.classList.contains('sx-hidden'));
  u.edit(st => { st.p['a.w1'] = 3 / 81; });                                 // an S2 warp without an S1 rendition
  await flush(doc);
  assert.equal(note.textContent, 'S1 rendition differs: Osc A Warp');
  assert.equal(note.classList.contains('sx-hidden'), false);
  fire(btnIn(Q, 'Disable Smoothing'), 'click');
  assert.equal(s().global.nosmooth, 1);
  // TUNING (Tuning…): A4 field (400–480) + lock, TUN FILE menu (host.tuningFile), MTS-ESP disabled (deviation 1)
  const T = panelOf(dlg(u, MOD.TuningPanel, 'Tuning'), 'TUNING');
  fire(spin(T, 'A4 (Hz)'), 'keydown', { key: 'ArrowUp' });
  assert.equal(s().global.a4, 440.1);
  fire(spin(T, 'A4 (Hz)'), 'keydown', { key: 'End' });
  assert.equal(s().global.a4, 480);
  fire(btnIn(T, 'LOCK'), 'click');
  assert.equal(s().locks.misc.tuning, 1);
  const tun = btnIn(T, 'Tuning file');
  assert.equal(tun.textContent, 'TUN FILE: 12-TET (none)');
  fire(tun, 'click');
  assert.deepEqual(menuLabels(ctxMenus(doc).at(-1)), ['Load .scl / .kbm / .tun…', 'Clear Tuning']);
  pick(doc, 'Load .scl / .kbm / .tun…');
  await flush(doc);
  assert.deepEqual([s().global.tun.name, s().global.tun.kind, s().global.tun.tab.length], ['19-EDO', 'scl', 128]);
  assert.equal(tun.textContent, 'TUN FILE: 19-EDO');
  fire(tun, 'click');
  pick(doc, 'Clear Tuning');
  assert.equal(s().global.tun.kind, 'none');
  const mts = btnIn(T, 'MTS-ESP');
  assert.ok(mts.classList.contains('wk-dis'));
  assert.match(T.textContent, /Not available in the browser/);
  // VOICE CONTROL (Voice control…): oscillator toggles, length, step grid, RANDOM / SCALING knobs, LFO scaling mode in the knob menu, presets
  const vcDlg = () => panelOf(dlg(u, MOD.VcPanel, 'Voice control'), 'VOICE CONTROL');
  let V = vcDlg();
  fire(btnIn(V, 'N'), 'click');
  assert.deepEqual(s().vc.sel, [1, 1, 1, 0, 1]);
  fire(spin(V, 'LENGTH'), 'keydown', { key: 'ArrowUp' });
  assert.equal(s().vc.len, 2);
  const cell = V.querySelector('.wk-sg').querySelectorAll('[tabindex="0"]')[0];
  fire(cell, 'keydown', { key: 'ArrowUp' });
  assert.equal(s().vc.steps[0][0], 0.05);
  for (const id of ['vc.pan', 'vc.det', 'vc.cut', 'vc.env', 'vc.escale', 'vc.lscale']) assert.ok(byDest(V, id), id);
  // (SCALING LFO's knob menu — By Percentage · By Rate — is not here: a dialog is an overlay and the host's knob menu stays shut inside
  // one (sx-host onCtx: .sx-ov), so on a Wavecraft at ⟨B⟩ already vc.lmode had no control — a WC gap, reported in IMPL-SX0 §14)
  const vcp = () => V.querySelectorAll('button').find(b => /^PRESET:/.test(b.textContent));
  fire(vcp(), 'click');
  pick(doc, 'Factory');
  pick(doc, 'Analog Drift');
  const AD = core.FACTORY_VC.find(x => x.name === 'Analog Drift');
  assert.equal(s().vc.name, 'Analog Drift');
  assert.deepEqual(['vc.pan', 'vc.det', 'vc.cut', 'vc.env'].map(id => s().p[id]), ['vc.pan', 'vc.det', 'vc.cut', 'vc.env'].map(id => AD.p[id]));
  u.edit(st => { st.p['vc.pan'] = 0.4; });
  fire(vcp(), 'click');
  pick(doc, 'Save…');
  u.el.querySelector('.sx-dlg').querySelector('input').value = 'Mine';
  okDialog(u);
  assert.deepEqual(host.store.get(ui.VC_KEY).map(x => [x.name, x.p['vc.pan']]), [['Mine', 0.4]]);
  V = vcDlg();                                                              // (the name prompt took the host's one sheet: open it again)
  fire(vcp(), 'click');
  pick(doc, 'Init');
  assert.equal(s().p['vc.pan'], fresh().p['vc.pan']);
  assert.deepEqual(s().vc.steps, fresh().vc.steps);
  fire(vcp(), 'click');
  pick(doc, 'User');
  pick(doc, 'Mine');
  assert.equal(s().p['vc.pan'], 0.4);
  u.destroy();
});

test('preferences (§13.10; the Amplifier\'s ⋯ Preferences…) persist app-wide, call host.prefsChanged; Help tooltips off strips the help texts (was: SerumUI\'s GLOBAL preferences)', async () => {
  const { doc, host, u } = await mount();
  const P = panelOf(dlg(u, MOD.PrefsPanel, 'Preferences'), 'PREFERENCES');
  const labels = P.querySelectorAll('.wk-tog').map(b => b.getAttribute('aria-label'));
  for (const l of ['Help tooltips', 'Param value tooltips', 'Keyboard shortcuts', 'MPE enabled by default', 'MPE Pitch Bend (also) maps to Expr X',
    'MPE Expr Y acts bi-directional', 'Limit mod depth on drop', 'Load MIDI Map from Presets', 'Use Ultra quality when rendering']) assert.ok(labels.includes(l), l);
  fire(btnIn(P, 'MPE Pitch Bend (also) maps to Expr X'), 'click');
  fire(btnIn(P, 'MPE Expr Y acts bi-directional'), 'click');
  fire(btnIn(P, 'Load MIDI Map from Presets'), 'click');
  fire(btnIn(P, 'Use Ultra quality when rendering'), 'click');
  const st = host.store.get(ui.PREFS_KEY);
  assert.deepEqual([st.mpeBendX, st.mpeYBi, st.midiFromPreset, st.ultra], [1, 1, 0, 1]);
  assert.deepEqual(host.log.filter(x => x[0] === 'prefs').at(-1)[1], st);
  assert.equal(u.prefs.midiFromPreset, 0);
  // a new host (another track) starts from the stored preferences
  const v = u.prefs;
  u.destroy();
  const m2 = await mount(null, h => { h.store.set(ui.PREFS_KEY, v); });
  assert.deepEqual(m2.u.prefs, v);
  // Help tooltips off: every help text (title) of the faces moves to data-help; on: back
  const titled = () => m2.root.querySelectorAll('[title]').length;
  assert.ok(titled() > 20);
  const help = () => fire(btnIn(panelOf(dlg(m2.u, MOD.PrefsPanel, 'Preferences'), 'PREFERENCES'), 'Help tooltips'), 'click');
  help();
  await flush(m2.doc);
  assert.equal(titled(), 0);
  assert.ok(m2.root.querySelectorAll('[data-help]').length > 20);
  m2.rh.face('lfo', m2.root, { host: m2.u, part: 'lfo3', dev: m2.u.dev });  // (was: a page built later) a module mounted later
  await flush(m2.doc);
  assert.equal(titled(), 0);
  help();
  await flush(m2.doc);
  assert.equal(m2.root.querySelectorAll('[data-help]').length, 0);
  assert.ok(titled() > 20);
  m2.u.destroy();
});

test('review 2 P3-a (SX0): Escape closes the Preferences… / Info… dialogs while focus stays on the ⋯ button that opened them (outside the overlay) — the key is heard at the document, released on close; an Escape something else handled leaves it; the other ways to close release it too', async () => {
  const { doc, u } = await mount();
  const more = doc.createElement('button');
  doc.body.appendChild(more);
  const keys = () => doc._l.filter(x => x.t === 'keydown').length, n0 = keys(); // (the fake document's listener list)
  for (const [Make, title] of [[MOD.PrefsPanel, 'Preferences'], [MOD.InfoPanel, 'Info']]) {
    more.focus();
    const O = MOD.panelDialog(u, Make, title);
    assert.deepEqual([u.overlay === O, O.closed, doc.activeElement === more, keys() - n0], [true, false, true, 1], title + ' open, focus still on ⋯');
    fire(more, 'keydown', { key: 'Enter' });
    assert.equal(O.closed, false, 'another key: open');
    const held = fire(more, 'keydown', { key: 'Escape' });
    assert.equal(held.defaultPrevented, true, 'Escape closes it');
    assert.deepEqual([O.closed, u.overlay === null, O.el.isConnected, doc.activeElement === more, keys() - n0], [true, true, false, true, 0], title + ' closed: focus back, the listener released');
    // an Escape already handled (defaultPrevented: a number field's cancel, a popover's close) is not the dialog's
    const O2 = MOD.panelDialog(u, Make, title);
    const took = e => e.preventDefault();
    more.addEventListener('keydown', took);
    fire(more, 'keydown', { key: 'Escape' });
    more.removeEventListener('keydown', took);
    assert.equal(O2.closed, false, 'handled elsewhere: open');
    // the Close button, and a second dialog replacing it: one listener at a time
    const O3 = MOD.panelDialog(u, Make, title);
    assert.deepEqual([O2.closed, keys() - n0], [true, 1], 'a new dialog replaces the old: one listener');
    O3.close();
    assert.deepEqual([O3.closed, keys() - n0], [true, 0], 'closed by its own close(): released');
    fire(more, 'keydown', { key: 'Escape' });
  }
  // inside the overlay the key still closes it (and only once)
  const O4 = MOD.panelDialog(u, MOD.PrefsPanel, 'Preferences');
  fire(O4.el, 'keydown', { key: 'Escape' });
  assert.deepEqual([O4.closed, keys() - n0], [true, 0]);
  u.destroy();
});

test('panel undo / redo (§13.2.4) on a Wavecraft\'s host — Cmd/Ctrl-Z, Shift-Cmd/Ctrl-Z on a face, coalescing, FX state, the view state kept, the Keyboard shortcuts preference; the monitor on while it lives (was: SerumUI\'s — its header buttons and Alt-F went with the header and MATRIX)', async () => {
  const { doc, host, u, root, s } = await mount();
  assert.deepEqual(host.log.filter(x => x[0] === 'monitor'), [['monitor', true]]);
  await flush(doc);
  assert.equal(u.undo.canUndo(), false);
  const def = s().p['f.cutoff'];
  fire(byDest(root, 'f.cutoff'), 'keydown', { key: 'End' });
  await flush(doc);
  assert.equal(s().p['f.cutoff'], 1);
  assert.equal(u.undo.canUndo(), true);
  u.undoRedo(false);                                                        // (was: the header's ↶)
  assert.equal(s().p['f.cutoff'], def);
  assert.ok(host.log.some(x => x[0] === 'edit' && x[1] === 'Undo'));
  await flush(doc);
  assert.equal(u.undo.canRedo(), true);
  u.undoRedo(true);
  assert.equal(s().p['f.cutoff'], 1);
  // Cmd/Ctrl-Z and Shift-Cmd/Ctrl-Z on a face
  fire(byDest(root, 'f.res'), 'keydown', { key: 'z', metaKey: true });
  assert.equal(s().p['f.cutoff'], def);
  fire(byDest(root, 'f.res'), 'keydown', { key: 'Z', ctrlKey: true, shiftKey: true });
  assert.equal(s().p['f.cutoff'], 1);
  // the same gesture label within 600 ms is one step
  u.edit(st => { st.p['a.pan'] = 0.1; }, { label: 'Pan' });
  await flush(doc);
  u.edit(st => { st.p['a.pan'] = 0.2; }, { label: 'Pan' });
  await flush(doc);
  u.undoRedo(false);
  assert.equal(s().p['a.pan'], fresh().p['a.pan']);
  assert.equal(s().p['f.cutoff'], 1);
  // FX state edits are part of the snapshot
  u.editFx(f => { f.lock = 1; }, { label: 'FX lock' });
  await flush(doc);
  u.undoRedo(false);
  assert.equal(host.st.fx.lock, 0);
  // the view state (s.ui: selections) survives an undo (was: the page shown)
  u.uiEdit(st => { st.ui.mod = 'lfo4'; });
  u.undoRedo(true);
  assert.equal(s().ui.mod, 'lfo4');
  assert.equal(host.st.fx.lock, 1);
  // the Keyboard shortcuts preference gates the keys
  u.setPref('keys', 0);
  fire(byDest(root, 'g.master'), 'keydown', { key: 'z', metaKey: true });
  assert.equal(host.st.fx.lock, 1);
  u.destroy();
  assert.deepEqual(host.log.filter(x => x[0] === 'monitor'), [['monitor', true], ['monitor', false]]);
});

test('touch first-class (§13.1) on the faces — touch mode on every root, no status line (nothing shifts under a finger), double-tap typed entry in a dialog\'s number field (was: SerumUI\'s — its wave icon and modifier bar were the header\'s)', async () => {
  const { doc, u, root, F, s } = await mount();
  assert.equal(u.roots.some(r => r.classList.contains('sx-touch')), false);
  const k = byDest(root, 'f.cutoff'), R = F.filter.root;
  ptr(k, 'pointerdown', 10, 10, { pointerType: 'touch' });
  assert.ok(u.roots.every(r => r.classList.contains('sx-touch')), 'the first touch marks every root');
  // a Wavecraft's host has no touch status line: nothing appears above a face, nothing shifts (the user's decision)
  assert.equal(u.statusEl, null);
  assert.equal(root.querySelectorAll('.sx-status').length, 0);
  ptr(k, 'pointerup', 10, 10, { pointerType: 'touch' });
  // a touched control's drag + the repaints after it: the face's children stay exactly as they were
  const kids = R.children.slice();
  ptr(k, 'pointerdown', 10, 100, { pointerType: 'touch' });
  ptr(k, 'pointermove', 10, 60, { pointerType: 'touch' });
  await flush(doc);
  ptr(k, 'pointerup', 10, 60, { pointerType: 'touch' });
  await flush(doc);
  assert.equal(R.children.length, kids.length);
  assert.ok(R.children.every((c, i) => c === kids[i]));
  assert.equal(root.querySelectorAll('.sx-status').length, 0);
  // numField: double-tap = typed entry (decimal keypad) — the Tuning… dialog's A4
  const a4 = spin(panelOf(dlg(u, MOD.TuningPanel, 'Tuning'), 'TUNING'), 'A4 (Hz)');
  ptr(a4, 'pointerdown', 50, 50, { pointerType: 'touch', timeStamp: 5000 });
  ptr(a4, 'pointerup', 50, 50, { pointerType: 'touch', timeStamp: 5050 });
  ptr(a4, 'pointerdown', 52, 51, { pointerType: 'touch', timeStamp: 5200 });
  const inp = a4.parentNode.querySelector('input');
  assert.ok(inp, 'typed entry opened');
  assert.equal(inp.getAttribute('inputmode'), 'decimal');
  inp.value = '432';
  fire(inp, 'keydown', { key: 'Enter' });
  assert.equal(s().global.a4, 432);
  u.destroy();
});

test('LFO PHASE ✓ Snap to Grid through the LFO face\'s knob menu: multiples of 360 / lfoGrid.x degrees while dragging (was: the last part of SerumUI\'s MIX / FX / ARP / CLIP pages case)', async () => {
  const { doc, u, root, s } = await mount();
  u.selectSrc('lfo2');
  await flush(doc);
  u.edit(st => { st.lfoGrid = { x: 4, y: 4 }; });
  fire(byDest(root, 'l2.phase'), 'contextmenu', { clientX: 5, clientY: 5 });
  assert.equal(menuLabels(ctxMenus(doc).at(-1))[0], 'Snap to Grid');
  pick(doc, 'Snap to Grid');
  u.setN('l2.phase', 0.3, 'move');
  assert.equal(s().p['l2.phase'], 0.25);
  u.setN('l2.phase', 0.4, 'end');
  assert.equal(s().p['l2.phase'], 0.5);
  u.setN('l1.rate', 0.3, 'set');
  assert.equal(s().p['l1.rate'], 0.3);                                       // other knobs are not snapped
  u.destroy();
});

test('review: panel undo after an outside preset load / project undo; undo re-seeds the FX rack only for preset-like steps (on a Wavecraft\'s host)', async () => {
  const { doc, host, u, s } = await mount();
  const seeds = [], e0 = host.edit, f0 = host.editFx;
  host.edit = (fn, o) => { seeds.push(['edit', o && o.label, !!(o && o.seed)]); e0(fn, o); };
  host.editFx = (fn, o) => { seeds.push(['editFx', o && o.label, !!(o && o.seed)]); f0(fn, o); };
  u.setN('a.level', 0.3, 'set');
  await flush(doc);
  // MIDI program change in main.js: the state is replaced, the key changes, the host calls refresh() (the header's preset name went
  // with the header: the step's label is the pin)
  const other = fresh(); other.p['f.cutoff'] = 0.123; other.p['a.level'] = 0.9;
  const b0 = other.p['b.level'];
  for (const k of Object.keys(s())) delete s()[k];
  Object.assign(s(), other);
  host.presets.load('f:3');
  u.refresh();
  await flush(doc);
  assert.equal(u.undo.label(), 'Load preset');
  u.setN('b.level', 0.42, 'set');
  await flush(doc);
  u.undoRedo(false);
  await flush(doc);
  assert.deepEqual([s().p['f.cutoff'], s().p['a.level'], s().p['b.level']], [0.123, 0.9, b0]);                 // only the tweak is undone
  u.undoRedo(false);
  await flush(doc);
  assert.deepEqual([s().p['a.level'], s().p['f.cutoff']], [0.3, fresh().p['f.cutoff']]);                         // then the outside load
  // the app's project undo replaces the state without a key change; Cmd-Z right after it undoes that change
  u.undoRedo(true); u.undoRedo(true);
  await flush(doc);
  s().p['f.res'] = 0.77;                                                      // (no refresh yet)
  fire(u.el, 'keydown', { key: 'z', metaKey: true });
  await flush(doc);
  assert.equal(s().p['f.res'], fresh().p['f.res']);
  assert.equal(s().p['b.level'], 0.42);
  // a view-only edit that touches state outside s.ui (EDIT ALL) is no step and no outside change
  u.setN('e2.att', 0.5, 'set');
  await flush(doc);
  u.kit.edit(st => { st.arp.editAll = 1; }, { label: 'Edit All', ui: true });
  await flush(doc);
  u.refresh();
  await flush(doc);
  assert.equal(u.undo.label(), 'Env 2 Attack');
  // undo / redo of an ordinary edit: a whole-state replacement without the FX re-seed; an unchanged FX part is not sent
  seeds.length = 0;
  u.setN('e1.att', 0.6, 'set');
  await flush(doc);
  u.undoRedo(false);
  await flush(doc);
  assert.deepEqual(seeds.filter(x => x[1] === 'Undo'), [['edit', 'Undo', false]]);
  // a preset-like step re-seeds when undone, like the load did (was: Init Preset from the header's main menu; here the preset-like
  // step a Wavecraft takes — an outside load, program change / sxLoad)
  const third = fresh(); third.p['f.cutoff'] = 0.321;
  for (const k of Object.keys(s())) delete s()[k];
  Object.assign(s(), third);
  host.presets.load('f:2');
  u.refresh();
  await flush(doc);
  assert.equal(u.undo.label(), 'Load preset');
  seeds.length = 0;
  u.undoRedo(false);
  await flush(doc);
  assert.ok(seeds.some(x => x[1] === 'Undo' && x[2]), JSON.stringify(seeds));
  u.destroy();
});

test('review: no-op presses are no edits; LFO PHASE snap while dragging only; Smoothing scale commits once; Quality re-selection; asset meter (on a Wavecraft\'s faces and its drawer dialogs)', async () => {
  const usage = { bytes: 12.5 * 1048576, budget: 192 * 1048576 };
  const { doc, host, u, root, s } = await mount({ qualityChosen: os => host.log.push(['quality', os]) }, h => { h.smp.usage = () => usage; });
  // a press and release (click, long-press) without a move: no host edit, no '*', no undo step
  const k = byDest(root, 'e1.att');
  host.log.length = 0;
  ptr(k, 'pointerdown', 10, 10); ptr(k, 'pointerup', 10, 10); fire(k, 'click');
  await flush(doc);
  assert.deepEqual(host.log.filter(x => x[0] === 'edit'), []);
  assert.equal(u.dirty, false);
  assert.equal(u.undo.canUndo(), false);
  u.setN('e1.att', fresh().p['e1.att'], 'set');                              // a reset at the default
  assert.deepEqual(host.log.filter(x => x[0] === 'edit'), []);
  // a drag that changes the value: start (no edit: unchanged), moves, end → one undo step
  u.setN('e1.att', s().p['e1.att'], 'start'); u.setN('e1.att', 0.5, 'move'); u.setN('e1.att', 0.55, 'move'); u.setN('e1.att', 0.55, 'end');
  await flush(doc);
  assert.deepEqual(host.log.filter(x => x[0] === 'edit').map(x => x[2]), ['move', 'move']);
  assert.equal(u.undo.label(), 'Env 1 Attack');
  assert.equal(u.dirty, true);
  // LFO PHASE ✓ Snap to Grid (grid 8 = 45°): typed / wheel / key values ('set') keep their value; drags snap
  u.lfoSnap = true;
  u.edit(st => { st.lfoGrid = { x: 8, y: 8 }; });
  u.setN('l1.phase', 50 / 360, 'set');
  near(s().p['l1.phase'], 50 / 360, 1e-12);
  u.setN('l1.phase', 50 / 360, 'start'); u.setN('l1.phase', 50 / 360, 'end');   // a press without a move: unchanged
  near(s().p['l1.phase'], 50 / 360, 1e-12);
  u.setN('l1.phase', 50 / 360, 'start'); u.setN('l1.phase', 0.3, 'move');
  assert.equal(s().p['l1.phase'], 0.25);
  u.setN('l1.phase', 0.25, 'end');
  // a two-finger rollback (wk knob: 'move' + 'end' with the value from before the press) is no drag: never snapped
  u.setN('l1.phase', 0.1, 'set');
  host.log.length = 0;
  u.setN('l1.phase', 0.1, 'start'); u.setN('l1.phase', 0.1, 'move'); u.setN('l1.phase', 0.1, 'end');   // a still finger
  near(s().p['l1.phase'], 0.1, 1e-12);
  assert.deepEqual(host.log.filter(x => x[0] === 'edit'), []);
  u.setN('l1.phase', 0.1, 'start'); u.setN('l1.phase', 0.13, 'move');
  assert.equal(s().p['l1.phase'], 0.125);                                   // the drag snaps
  u.setN('l1.phase', 0.1, 'move'); u.setN('l1.phase', 0.1, 'end');          // rolled back after moves: the press value
  near(s().p['l1.phase'], 0.1, 1e-12);
  u.lfoSnap = false;
  // PREFERENCES Smoothing scale (Preferences…): a drag shows its value and commits once (storage + prefsChanged)
  const sv = dlg(u, MOD.PrefsPanel, 'Preferences').querySelectorAll('.sx-nfv').find(n => n.getAttribute('aria-label') === 'Smoothing scale');
  const nPrefs = () => host.log.filter(x => x[0] === 'prefs').length, p0 = nPrefs();
  ptr(sv, 'pointerdown', 100, 100);
  for (let i = 1; i <= 20; i++) ptr(sv, 'pointermove', 100, 100 - i * 2);
  await flush(doc);
  assert.equal(nPrefs(), p0);
  assert.equal(sv.textContent, '180%');                                     // 40 px of 400 px per 799 steps
  assert.equal(u.prefs.smooth, 1);
  ptr(sv, 'pointerup', 100, 60);
  assert.equal(nPrefs(), p0 + 1);
  assert.equal(host.store.get(ui.PREFS_KEY).smooth, 1.8);
  // QUALITY (Quality…): choosing the selected quality again resets the CPU safeguard steps (host.qualityChosen), without an edit
  const QD = dlg(u, MOD.QualityPanel, 'Quality');
  const os0 = s().global.os, cur = segIn(QD, 'Quality', ['Draft', 'High', 'Ultra'][[1, 2, 4].indexOf(os0)]);
  host.log.length = 0;
  fire(cur, 'click');
  assert.deepEqual(host.log.filter(x => x[0] === 'quality' || x[0] === 'edit'), [['quality', os0]]);
  fire(segIn(QD, 'Quality', 'Ultra'), 'click');
  assert.equal(s().global.os, 4);
  assert.deepEqual(host.log.filter(x => x[0] === 'quality'), [['quality', os0], ['quality', 4]]);
  // the project asset meter (§14.2) from host.smp.usage
  await flush(doc);
  const meter = QD.querySelector('.sx-assets');
  assert.equal(meter.textContent, 'Assets: 12.5 MB of 192 MB');
  u.destroy();
  const m2 = await mount();
  const Q2 = dlg(m2.u, MOD.QualityPanel, 'Quality');
  await flush(m2.doc);
  assert.ok(Q2.querySelector('.sx-assets').parentNode.classList.contains('sx-hidden'));   // no host member: hidden
  m2.u.destroy();
});

test('review: locks through serum-core setLock / setModuleLock on the faces — Unlock Control inside a locked module; unlocking the module (its ⋯) drops its per-control unlocks (was: SerumUI\'s; its MATRIX Sort and main-menu Init Preset went with those)', async () => {
  const v1 = core.defaultFxV1();
  v1.p['fx.dist.on'] = 1; v1.p['fx.dly.on'] = 1;
  const fx = core.migrateFx1(v1);
  fx.racks[0].mods[0].id = 'zz'; fx.racks[0].mods[1].id = 'aa';           // main rack: Distortion zz, then Delay aa
  const { doc, u, root, F, s } = await mount(null, h => { h.st.fx = fx; h.store.set(ui.PREFS_KEY, { view3d: 1 }); });
  // a parameter lock inside a locked module: one item, Unlock Control, which unlocks it for real
  u.edit(st => { st.locks.mod = ['oscA']; st.locks.p = ['a.level']; });
  await flush(doc);
  const al = byDest(root, 'a.level');
  fire(al, 'contextmenu', { clientX: 5, clientY: 5 });
  const L = menuLabels(ctxMenus(doc).at(-1));
  assert.equal(L.at(-1), 'Unlock Control');
  assert.equal(L.includes('Unlock') || L.includes('Lock'), false);
  pick(doc, 'Unlock Control');
  assert.deepEqual([s().locks.p, s().locks.unp], [[], ['a.level']]);
  fire(al, 'contextmenu', { clientX: 5, clientY: 5 });
  assert.equal(menuLabels(ctxMenus(doc).at(-1)).at(-1), 'Lock Control');
  fire(doc, 'keydown', { key: 'Escape' });
  // unlocking the module drops its per-control unlocks (no stale locks.unp comes back with a later Lock Module)
  act(F.oscA, 'Lock Module');
  assert.deepEqual([s().locks.mod, s().locks.unp], [[], []]);
  u.destroy();
});

test('review: module labels (the bar titles) as audio sources; X|Y dot Modulate X / Y; dropTarget long-press; an LFO\'s ⋯ module menu; LFO → wavetable; editor popovers (on a Wavecraft — the strip\'s LFO tile, MATRIX\'s macro tiles and the VELO / NOTE editor titles went with the shell)', async () => {
  const unh = [], onU = e => unh.push(e);
  process.on('unhandledRejection', onU);
  const { doc, host, u, root, F, s } = await mount();
  const T = {}, lab = m => T[m] || (T[m] = titleOf(doc, F[m]));
  const drag = (from, over, o) => { doc.pointAt = () => over; ptr(from, 'pointerdown', 10, 10, o); ptr(from, 'pointermove', 40, 30, o); ptr(from, 'pointerup', 40, 30, o); };
  // OSC A / SUB / NOISE / FILTER 2 labels dropped on a control = that audio-rate source (§3.10, inv B18)
  const res = byDest(root, 'f.res');
  doc.pointAt = () => res;
  ptr(lab('oscA'), 'pointerdown', 10, 10); ptr(lab('oscA'), 'pointermove', 40, 30);
  assert.ok(res.classList.contains('sx-droptgt'));
  assert.match(doc.body.querySelector('.sx-ghost').textContent, /^Modulate · OSC A/);
  ptr(lab('oscA'), 'pointerup', 40, 30);
  drag(lab('sub'), byDest(root, 'a.pan'));
  drag(lab('filter2'), byDest(root, 'b.pan'));
  const rows = () => s().matrix.filter(r => r.src).map(r => r.src + '→' + r.dst);
  assert.deepEqual(rows(), ['osca→f.res', 'sub→a.pan', 'filt2→b.pan']);
  drag(lab('filter'), lab('filter2'));                                       // a label onto its own kind still swaps
  assert.deepEqual(rows(), ['osca→f2.res', 'sub→a.pan', 'filt2→b.pan']);     // (rows to the filters follow the swap)
  // a granular / spectral X|Y dot (data-xy): the drop offers Modulate X / Modulate Y (§13.3)
  const dot = doc.createElement('div');
  dot.setAttribute('data-xy', '1'); dot.setAttribute('data-dest-x', 'a.pos'); dot.setAttribute('data-dest-y', 'a.gy');
  u.kit.dropTarget(dot, 'a.pos');
  F.oscA.el.appendChild(dot);
  drag(lab('sub'), dot);
  assert.deepEqual(menuLabels(ctxMenus(doc).at(-1)), ['Modulate X', 'Modulate Y']);
  pick(doc, 'Modulate Y');
  assert.ok(rows().includes('sub→a.gy'));
  drag(lab('noise'), dot);
  pick(doc, 'Modulate X');
  assert.ok(rows().includes('noise→a.pos'));
  // kit.dropTarget elements get the knob menu on a touch long-press (iPad Safari sends no contextmenu)
  const n0 = ctxMenus(doc).length;
  ptr(dot, 'pointerdown', 20, 20, { pointerType: 'touch' });
  await new Promise(r => setTimeout(r, 560));
  ptr(dot, 'pointerup', 20, 20, { pointerType: 'touch' });
  assert.equal(ctxMenus(doc).length, n0 + 1);
  assert.ok(menuLabels(ctxMenus(doc).at(-1)).includes('Reset Control'));
  fire(doc, 'keydown', { key: 'Escape' });
  // an LFO's ⋯ is its module menu (inv B16, B17), then the module's destinations (inv B15)
  assert.deepEqual(items(F.lfo1), ['Lock Module', 'Init Module', 'Copy', 'Copy (w/mods)', 'Swap with', '', 'Bypass All Destinations', 'Remove All Destinations']);
  act(F.lfo1, 'Lock Module');
  assert.ok(s().locks.mod.includes('lfo1'));
  u.edit(st => { st.lfo[0].pts = [[0, 1, 0], [1, 0, 0]]; });
  act(F.lfo1, 'Copy');                                                       // the menu equivalent of the Alt-drag copy
  act(F.lfo2, 'Paste');
  assert.deepEqual(s().lfo[1].pts, s().lfo[0].pts);
  // LFO → wavetable on a Sample oscillator: the type switches with the new table, once it is saved; a failed save
  // leaves the oscillator as it was (no early switch, no unhandled rejection)
  u.edit(st => { st.osc[1].type = 'sample'; st.osc[1].smp = 'smp:x'; });
  host.wt.saveNew = () => Promise.reject(new Error('quota exceeded'));
  u.doDrop({ kind: 'lfoWt', o: 1 }, 'lfo1', 0, 0);
  await flush(doc);
  assert.equal(s().osc[1].type, 'sample');
  assert.ok(host.log.some(x => x[0] === 'notify' && /LFO → wavetable failed/.test(x[1])));
  host.wt.saveNew = () => Promise.resolve('user:lfo');
  u.doDrop({ kind: 'lfoWt', o: 1 }, 'lfo1', 0, 0);
  await flush(doc);
  assert.deepEqual([s().osc[1].type, s().osc[1].wt], ['wt', 'user:lfo']);
  assert.deepEqual(host.log.filter(x => x[1] === 'LFO to wavetable').length, 1);   // one edit: table + type
  process.off('unhandledRejection', onU);
  assert.deepEqual(unh, []);
  // editor popovers (a class instance: curve editors, PZ, OSC MAPPING) are full-screen sheets below 1100 px (CSS
  // .sx-pop-ed); small panes (a plain object: routing, window …) stay anchored popovers
  const P1 = u.openCurve(0, byDest(root, 'f.res'));
  assert.ok(P1 && P1.box.classList.contains('sx-pop-ed'));
  P1.close();
  const P2 = u.kit.popover('pane', byDest(root, 'f.res'), 'Routing', box => { box.appendChild(doc.createElement('div')); return { refresh() {}, destroy() {} }; }, () => '');
  assert.equal(P2.box.classList.contains('sx-pop-ed'), false);
  P2.close();
  u.destroy();
});

test('review: hidden canvases are neither drawn nor measured; kit.live tells its callbacks whether their module is shown (on a Wavecraft\'s faces: a module off screen as the bundled panel\'s hidden page)', async () => {
  const on = { A: true, B: false };
  const { doc, u, F } = await mount(null, null, [['amp', 'voice'], ['osc', 'oscA', () => on.A], ['lfo', 'lfo1', () => on.B]]);
  u.ro = { observe() {}, disconnect() {} };                                  // a browser's ResizeObserver (none in the fake DOM)
  let draws = 0, lives = 0;
  u.bp = F.oscA.page;
  const cv = u.kit.canvas('', () => 'k' + u.snapSeq, () => { draws++; });
  u.bp = F.lfo1.page;
  let hiddenCalls = 0;
  u.kit.live(on => { if (on) lives++; else hiddenCalls++; });
  u.bp = null;
  await flush(doc);
  cv.el._rect = { left: 0, top: 0, width: 0, height: 0 };                  // inside a display: none subtree
  cv.sized = false;
  let rects = 0;
  const gb = cv.el.getBoundingClientRect.bind(cv.el);
  cv.el.getBoundingClientRect = () => { rects++; return gb(); };
  draws = 0; lives = 0;
  for (let i = 0; i < 5; i++) { u.setSnapshot({ s: { notes: 0 } }); await flush(doc); }
  assert.equal(draws, 0);
  assert.equal(rects, 1);                                                    // measured once, then left alone
  assert.equal(lives, 0);                                                    // the LFO module is off screen: told so
  assert.ok(hiddenCalls > 0);                                                // (functional work such as clip recording goes on)
  cv.el._rect = { left: 0, top: 0, width: 300, height: 120 };              // shown again: the ResizeObserver clears `sized`
  cv.sized = false;
  u.setSnapshot({ s: { notes: 0 } });
  await flush(doc);
  assert.equal(draws, 1);
  on.B = true; u.reshow();                                                   // (the module's on-screen change, main.js → reshow)
  await flush(doc);
  u.setSnapshot({ s: { notes: 0 } });
  await flush(doc);
  assert.ok(lives > 0);
  u.destroy();
});

test('IMPL-FR §3 B3: a Wavecraft\'s snapshot paints honour a canvas\' rate class — posts at 120 Hz redraw a maxHz 60 display at ≤ 60 / s and a plain one at every change; the deferred change of a module gone off screen meanwhile is not drawn until it shows; keyN keys compare by element', async () => {
  const on = { A: true };
  const { doc, u, F } = await mount(null, null, [['amp', 'voice'], ['osc', 'oscA', () => on.A]]);
  let T = 1000, heavy = 0, light = 0, nk = 0;
  u.tNow = () => T;
  wkm.clock._reset(); wkm.clock.config({ display: 120 });
  try {
    const frame = () => { for (const f of doc.defaultView.raf.splice(0)) f(T); };
    await flush(doc);
    u.bp = F.oscA.page;
    const H = u.kit.canvas('', () => 'h' + u.snapSeq, () => { heavy++; }, { maxHz: 60 });
    u.kit.canvas('', () => 'l' + u.snapSeq, () => { light++; });
    const kn = [0, 0];
    u.kit.canvas('', () => 'never', () => { nk++; }, { keyN: k => { k[0] = kn[0]; k[1] = kn[1]; return 2; } });
    u.bp = null;
    assert.equal(H.maxHz, 60);
    frame();
    u.setSnapshot({ s: { notes: 0 } });
    frame();
    heavy = 0; light = 0; nk = 0;
    for (let f = 1; f <= 24; f++) { T += 1000 / 120; u.setSnapshot({ s: { notes: 0 } }); frame(); if (f % 6 === 0) kn[1] = f; }
    assert.equal(light, 24);
    assert.ok(heavy >= 11 && heavy <= 13, heavy + ' heavy draws for 24 posts at 120 Hz');
    assert.equal(nk, 3, 'keyN: drawn when an element changed');
    // a change deferred, then the oscillator module off screen: nothing drawn while hidden, drawn when shown again
    T += 1000 / 120; u.setSnapshot({ s: { notes: 0 } }); frame();
    T += 1; u.setSnapshot({ s: { notes: 0 } }); frame();
    const h0 = heavy;
    on.A = false; u.paint(true);                                             // (was: the MATRIX page shown — setPage's own full paint)
    T += 1000 / 60; frame(); frame();
    assert.equal(heavy, h0, 'hidden: not drawn');
    on.A = true; u.reshow();                                                 // (was: the OSC page again; main.js → reshow: one frame queued)
    T += 1000 / 60; frame(); frame();
    assert.ok(heavy > h0, 'shown: drawn');
  } finally { wkm.clock._reset(); u.destroy(); }
});

test('IMPL-FR-B §4.6 (the kit half): kit.msg() is the slow message\'s s, kit.frame(fn) a frame client — and the sub-panel stub kit (tests/serum-ui-stubs/kit.js) holds every member of the real kit (on a Wavecraft\'s host; the FX page\'s rack adapter gr() / fast() went with the FX page: the canvas FX module\'s rack host is main.js fxHost)', async () => {
  const { doc, u } = await mount(null, null, [['amp', 'voice']]);
  const s0 = { notes: 1, eff: new Float32Array(core.NSV + 8) };
  u.setSnapshot({ s: s0, gr: null, fxph: null });
  assert.equal(u.kit.msg(), s0);
  assert.equal(typeof u.kit.frame, 'function');
  const K = kitStub.makeKit({ doc, s: fresh(), fx: core.defaultFxV1() });
  assert.deepEqual([typeof K.msg, typeof K.frame], ['function', 'function']);
  const real = Object.keys(u.kit).sort(), stub = Object.keys(K).sort();
  assert.deepEqual(real.filter(k => !stub.includes(k)), [], 'every member of the real kit in the stub');
  u.destroy();
});

// (the preset browser is the host's — PresetBrowser, built by mount for a host with presets: WC-2's, IMPL-WC §3.7; the header that
// opened it went with VoiceHeader, so these open it through the host: u.browser.open())
test('PresetBrowser v2 (§13.11) on a Wavecraft\'s host: preview + macros, auto-preview, ratings, tags, metadata, keys 7 / 8 / 9, Shift-Backspace', async () => {
  const macros = [];
  const { doc, host, u, s } = await mount({ previewMacros: v => macros.push(v) }, h => {
    h.presets.setMeta = (k, patch) => { h.log.push(['setMeta', k, patch]); const p = h.presets.list().find(x => x.key === k); Object.assign(p, patch); };
  });
  u.browser.open();                                                          // (was: the header's preset name)
  const B = u.browser, O = u.el.querySelector('.pb-root'), list = O.querySelector('.pb-list');
  const rows = () => list.querySelectorAll('.pb-row');
  const rowOf = name => rows().find(r => r.querySelector('.pb-name').firstChild.textContent === name);
  assert.equal(rows().length, 5);
  const macBar = O.querySelector('.pb-macros');
  assert.ok(macBar.classList.contains('sx-hidden'));
  // ▶ preview (host.preview), macros 1–8 adjustable while it plays (host.previewMacros), ← stops
  fire(rowOf('Acid Bass').querySelector('.pb-play'), 'click');
  assert.deepEqual(host.log.filter(x => x[0] === 'preview'), [['preview', 'f:2']]);
  assert.equal(host.log.some(x => x[0] === 'load'), false);                  // previewing does not load
  assert.equal(macBar.classList.contains('sx-hidden'), false);
  const mk1 = macBar.querySelectorAll('.wk-knob')[0];
  assert.equal(macBar.querySelectorAll('.wk-knob').length, 8);
  assert.equal(mk1.getAttribute('aria-label'), 'Macro 1');
  fire(mk1, 'keydown', { key: 'End' });
  assert.deepEqual(macros.at(-1), [1, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(s().macros[0].v, 0);                                          // the sound itself is untouched
  fire(list, 'keydown', { key: 'ArrowLeft' });
  assert.deepEqual(host.log.filter(x => x[0] === 'preview').at(-1), ['preview', null]);
  assert.ok(macBar.classList.contains('sx-hidden'));
  // auto-preview (synth.sx.browser.autoPreview): ↑↓ move and preview instead of loading
  fire(btnIn(O, 'Auto-preview'), 'click');
  assert.equal(host.store.get(ui.BROWSER_KEY).autoPreview, 1);
  const loads = host.log.filter(x => x[0] === 'load').length;
  fire(list, 'keydown', { key: 'ArrowDown' });
  assert.equal(host.log.filter(x => x[0] === 'load').length, loads);
  assert.equal(host.log.filter(x => x[0] === 'preview').at(-1)[0], 'preview');
  assert.notEqual(host.log.filter(x => x[0] === 'preview').at(-1)[1], null);
  fire(list, 'keydown', { key: 'ArrowLeft' });
  // ratings: factory presets in synth.sx.meta, user presets through presets.setMeta; a second click on the same star clears
  fire(rowOf('Deep Bass').querySelector('.pb-stars').querySelectorAll('button')[2], 'click');
  assert.deepEqual(host.store.get(ui.META_KEY), { 'f:1': { stars: 3 } });
  fire(rowOf('My Bass').querySelector('.pb-stars').querySelectorAll('button')[4], 'click');
  assert.deepEqual(host.log.filter(x => x[0] === 'setMeta'), [['setMeta', 'u:1', { stars: 5 }]]);
  assert.equal(rowOf('Deep Bass').querySelector('.pb-stars').querySelectorAll('.sx-on').length, 3);
  B.set({ stars: 3 });
  assert.deepEqual(rows().map(r => r.querySelector('.pb-name').firstChild.textContent), ['Deep Bass']);
  B.set({ stars: 'none' });
  assert.equal(rows().length, 3);
  B.set({ stars: '' });
  fire(rowOf('Deep Bass').querySelector('.pb-stars').querySelectorAll('button')[2], 'click');
  assert.deepEqual(host.store.get(ui.META_KEY), { 'f:1': { stars: 0 } });
  // metadata pane: comments, New tag (factory → synth.sx.meta)
  fire(rowOf('Soft Pad'), 'click');
  const meta = O.querySelector('.pb-meta');
  assert.match(meta.textContent, /About Soft Pad/);                          // description = the preset's notes
  const nt = meta.querySelectorAll('input').find(i => i.getAttribute('aria-label') === 'New tag');
  nt.value = 'warm';
  fire(nt, 'keydown', { key: 'Enter' });
  assert.deepEqual(host.store.get(ui.META_KEY)['f:3'].tags, ['warm']);
  const ct = O.querySelector('.pb-meta').querySelector('textarea');
  ct.value = 'lovely';
  fire(ct, 'change');
  assert.equal(host.store.get(ui.META_KEY)['f:3'].comments, 'lovely');
  // TAGS tab: chips include; Alt-click excludes; All / Any
  fire(O.querySelector('.pb-tabs').querySelectorAll('button').find(b => b.textContent === 'TAGS'), 'click');
  const chip = () => O.querySelectorAll('.sx-chip').find(c => c.textContent === 'warm');
  fire(chip(), 'click');
  assert.deepEqual(rows().map(r => r.querySelector('.pb-name').firstChild.textContent), ['Soft Pad']);
  fire(chip(), 'click', { altKey: true });
  assert.equal(rows().length, 4);
  assert.ok(chip().classList.contains('sx-excl'));
  fire(chip(), 'click');
  fire(chip(), 'click');
  assert.equal(rows().length, 5);
  fire(O.querySelector('.pb-tabs').querySelectorAll('button').find(b => b.textContent === 'CATEGORIES'), 'click');
  // browser menu and keys: 7 random, 8 Hybridize (4 random parents of the filtered list), 9 favouring the selection
  fire(btnIn(O, 'Browser menu'), 'click');
  assert.deepEqual(menuLabels(ctxMenus(doc).at(-1)), ['Load Random Preset (7)', 'Hybridize (8)', 'Hybridize Favoring Selected Preset (9)', '',
    'Rename…', 'Move to Category…', 'Delete (Shift-Backspace)', '', 'Create and Export a Pack…', 'Import Pack…']);
  // §13.11 items whose optional host member is missing (rename / move / exportPack) are shown, disabled
  const dis = ctxMenus(doc).at(-1).querySelectorAll('.wk-ci').filter(n => n.getAttribute('aria-disabled') === 'true').map(n => n.querySelector('.wk-cl').textContent);
  assert.ok(['Rename…', 'Move to Category…', 'Create and Export a Pack…'].every(l => dis.includes(l)), JSON.stringify(dis));
  fire(doc, 'keydown', { key: 'Escape' });
  fire(list, 'keydown', { key: '7' });
  assert.ok(host.log.filter(x => x[0] === 'load').length > loads);
  B.set({ cat: 'Bass' });
  fire(list, 'keydown', { key: '8' });
  assert.equal(u.nameOverride, 'Hybrid');
  assert.ok(host.log.some(x => x[0] === 'notify' && /^Hybrid of /.test(x[1])));
  assert.ok([0.2, 0.3, 0.4].some(v => Math.abs(s().p['a.level'] - v) < 1e-9));    // a.level of one of the Bass parents
  fire(rowOf('Deep Bass'), 'click');
  fire(list, 'keydown', { key: '9' });
  assert.equal(u.nameOverride, 'Hybrid');
  // Delete: Shift-Backspace (user presets only, confirm); a plain Backspace does nothing
  fire(rowOf('My Bass'), 'click');
  fire(list, 'keydown', { key: 'Backspace' });
  assert.equal(host.log.some(x => x[0] === 'del'), false);
  fire(list, 'keydown', { key: 'Backspace', shiftKey: true });
  assert.deepEqual(host.log.filter(x => x[0] === 'del'), [['del', 'u:1']]);
  // Cmd/Ctrl-F (inv B25): the search field takes the focus (the page's find does not open); plain F does nothing
  const qf = u.el.querySelector('.pb-q');
  fire(list, 'keydown', { key: 'f' });
  assert.notEqual(doc.activeElement, qf);
  for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
    list.focus();
    const ev = fire(list, 'keydown', Object.assign({ key: 'f' }, mod));
    assert.equal(doc.activeElement, qf, JSON.stringify(mod));
    if (ev && 'defaultPrevented' in ev) assert.equal(ev.defaultPrevented, true);
  }
  list.focus();
  // Escape closes (and stops a preview)
  fire(rowOf('Acid Bass').querySelector('.pb-play'), 'click');
  fire(list, 'keydown', { key: 'Escape' });
  assert.equal(u.el.querySelector('.pb-root'), null);
  assert.deepEqual(host.log.filter(x => x[0] === 'preview').at(-1), ['preview', null]);
  u.destroy();
});


test('review: preset browser reads once, keeps its rows on ↑↓ / preview, preview ends after 4 s, one tag set; Hybridize Favoring an unreadable preset; the host reads per refresh only (on a Wavecraft\'s host)', async t => {
  const cnt = { list: 0, current: 0 };
  const { doc, host, u, s } = await mount(null, h => {
    const L = h.presets.list, C = h.presets.current, G = h.presets.get;
    L().find(p => p.key === 'f:2').tags = ['dark'];                          // list rows carry the preset state's tags
    h.presets.list = () => { cnt.list++; return L(); };
    h.presets.current = () => { cnt.current++; return C(); };
    h.presets.get = k => (k === 'u:1' ? null : G(k));
  });
  // repaints (knob drags, snapshots) read neither the list nor the current key
  const c0 = Object.assign({}, cnt);
  for (let i = 0; i < 5; i++) { u.setN('e1.att', 0.3 + i / 100, 'move'); await flush(doc); }
  assert.deepEqual(cnt, c0);
  u.refresh();                                                               // an outside change: the key once
  assert.deepEqual([cnt.list, cnt.current], [c0.list, c0.current + 1]);
  // the browser: rows built once; ↑↓ (browse-to-audition) and previews update the rows in place
  u.browser.open();                                                          // (was: the header's preset name)
  const B = u.browser, O = u.el.querySelector('.pb-root'), list = O.querySelector('.pb-list');
  const rows0 = list.querySelectorAll('.pb-row');
  const cl = cnt.list;
  fire(list, 'keydown', { key: 'ArrowDown' });
  fire(list, 'keydown', { key: 'ArrowDown' });
  assert.equal(cnt.list, cl);
  assert.deepEqual(list.querySelectorAll('.pb-row'), rows0);
  assert.equal(rows0.filter(r => r.getAttribute('aria-selected') === 'true').length, 1);
  // ▶ preview: the stop icon and the macro strip end with the host's ≤ 4 s preview (§12.6)
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const play = rows0[0].querySelector('.pb-play');
  fire(play, 'click');
  assert.match(play.getAttribute('aria-label'), /^Stop preview of /);
  assert.equal(O.querySelector('.pb-macros').classList.contains('sx-hidden'), false);
  t.mock.timers.tick(3999);
  assert.equal(B.playing, rows0[0] && host.log.filter(x => x[0] === 'preview').at(-1)[1]);
  t.mock.timers.tick(1);
  assert.equal(B.playing, null);
  assert.match(play.getAttribute('aria-label'), /^Preview /);
  assert.ok(O.querySelector('.pb-macros').classList.contains('sx-hidden'));
  t.mock.timers.reset();
  assert.deepEqual(list.querySelectorAll('.pb-row'), rows0);
  // one tag set: the preset state's tags (s.tags) are TAGS chips, filter by them and can be removed in the details pane
  fire(O.querySelector('.pb-tabs').querySelectorAll('button').find(b => b.textContent === 'TAGS'), 'click');
  const chip = () => O.querySelector('.sx-tagbox').querySelectorAll('.sx-chip').find(c => c.textContent === 'dark');
  fire(chip(), 'click');
  assert.deepEqual(list.querySelectorAll('.pb-row').map(r => r.querySelector('.pb-name').firstChild.textContent), ['Acid Bass']);
  fire(chip(), 'click');
  fire(list.querySelectorAll('.pb-row').find(r => r.querySelector('.pb-name').firstChild.textContent === 'Acid Bass'), 'click');
  const x = O.querySelector('.pb-meta').querySelectorAll('.sx-chip').find(c => c.textContent === 'dark ✕');
  assert.ok(x);
  fire(x, 'click');
  assert.deepEqual(host.store.get(ui.META_KEY)['f:2'].tags, []);
  assert.equal(O.querySelector('.pb-meta').querySelectorAll('.sx-chip').length, 0);
  assert.equal(chip(), undefined);
  B.close();
  // Hybridize Favoring a preset the host cannot hand over refuses (instead of favouring another parent); unreadable
  // parents are skipped with a notice
  host.log.length = 0;
  assert.equal(u.hybridize(['u:1', 'f:1', 'f:2'], true), false);
  assert.ok(host.log.some(x => x[0] === 'notify' && x[1] === 'Hybridize: the selected preset cannot be read here'));
  assert.equal(u.hybridize(['f:1', 'u:1', 'f:2'], true), true);
  assert.ok(host.log.some(x => x[0] === 'notify' && /^Hybrid of Deep Bass, Acid Bass \(1 preset could not be read\)$/.test(x[1])));
  u.destroy();
});


// ((SX0, lane K) the host's chain library — loadChain / chains / chainMenu, reached only from the bundled header's main menu and FX page —
// left with the main menu: RULINGS2 F1's two cases went with it; the canvas FX module's chain menu is fx-ui's, the same rules pinned in
// tests/fx-ui.test.mjs: "Reset All Racks and Load Effect Chain drop the rows / locks / MIDI…", "a Phase-1 chain (v1 library entry,
// Phase-1 factory chain) keeps the modules…", "the effect-chain library keeps other writers' entries…; new chains are stored as v2")

test('a Wavecraft\'s host: settled() — a touch drop right after an edge auto-scroll needs a target the finger rested on (wk.dragSource info.scrolled)', async () => {
  const { u } = await mount();
  const H = { kind: 'dest', el: { n: 1 }, id: 'f.res' }, H2 = { kind: 'dest', el: { n: 2 }, id: 'f.cut' };   // (sameHit: by element)
  u.drag = { touch: true, quick: false, hit: H, at: 1000 };
  assert.equal(u.settled(H, 1050, Infinity), true);    // never scrolled: a held drag drops where it is
  assert.equal(u.settled(H, 1050, 40), false);         // scrolled 40 ms ago, on the target for 50 ms: no
  assert.equal(u.settled(H, 1100, 40), true);          // on it ≥ 100 ms: yes
  assert.equal(u.settled(H2, 1300, 40), false);        // not the target the finger rested on
  assert.equal(u.settled(H, 1050, 100), true);         // the last scroll step ≥ 100 ms ago
  assert.equal(u.settled(H, 1050), true);              // an older kit without info.scrolled
  u.drag = { touch: false, quick: false, hit: H, at: 1000 };
  assert.equal(u.settled(H, 1001, 0), true);           // mouse / pen: where it is released
  u.drag = { touch: true, quick: true, hit: H, at: 1000 };
  assert.equal(u.settled(H, 1050, Infinity), false);   // a quick drag keeps its rule
  u.drag = null;
  u.destroy();
});
test('module-label drag (touch) on a bar title — a lift right after an edge auto-scroll drops only on a target the finger rested on SETTLE_MS (was: SerumUI\'s panel label)', async () => {
  const { doc, u, root, F, s } = await mount();
  const lab = titleOf(doc, F.oscA);
  const res = byDest(root, 'f.res'), pan = byDest(root, 'a.pan'), rows = () => s().matrix.filter(r => r.src).map(r => r.src + '→' + r.dst);
  // the page scrolls (wk.dragSource edge auto-scroll): f.res comes under a still finger once it is up 50 px
  const html = doc.documentElement, q = new Map(), rAF = globalThis.requestAnimationFrame, cAF = globalThis.cancelAnimationFrame;
  let top = 1000, id = 0;
  Object.defineProperty(html, 'scrollTop', { configurable: true, get: () => top, set: v => { top = v; } });
  html.scrollHeight = 4000;
  globalThis.requestAnimationFrame = f => { q.set(++id, f); return id; };
  globalThis.cancelAnimationFrame = i => { q.delete(i); };
  const frames = (n, t0) => { for (let k = 0; k < n; k++) { const fs = [...q.values()]; q.clear(); for (const f of fs) f(t0 + 40 * k); } };
  const T = (type, x, y, t) => ptr(lab, type, x, y, { pointerType: 'touch', pointerId: 7, button: 0, isPrimary: true, timeStamp: t });
  const grab = async t => { T('pointerdown', 300, 400, t); await new Promise(r => setTimeout(r, 270)); T('pointermove', 300, 390, t + 300); };
  try {
    doc.pointAt = () => (top < 950 ? res : pan);
    // no auto-scroll: a held touch drag drops where it is lifted (as before)
    await grab(50000);
    T('pointerup', 300, 390, 50301);
    assert.deepEqual(rows(), ['osca→a.pan']);
    // up into the top edge zone: f.res scrolls under the finger at the 200 ms frame; lifted 30 ms later — no drop
    await grab(60000);
    T('pointermove', 300, 20, 60316);
    frames(6, 0);
    assert.ok(top < 950 && top > 900, String(top));
    assert.ok(res.classList.contains('sx-droptgt'));
    T('pointerup', 300, 20, 60316 + 200 + 30);
    assert.deepEqual(rows(), ['osca→a.pan']);
    assert.equal(res.classList.contains('sx-droptgt'), false);
    // the same, but the finger stays on f.res 210 ms while the page still scrolls: the drop counts
    top = 1000;
    await grab(70000);
    T('pointermove', 300, 20, 70316);
    frames(11, 0);
    T('pointerup', 300, 20, 70316 + 400 + 10);
    assert.deepEqual(rows(), ['osca→a.pan', 'osca→f.res']);
  } finally {
    if (rAF === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = rAF;
    if (cAF === undefined) delete globalThis.cancelAnimationFrame; else globalThis.cancelAnimationFrame = cAF;
    u.destroy();
  }
});

test('two-finger rollback (gesture.js\'s pointercancel flagged e.gesture === "two-finger"): numField, Alt depth drag restore the value from before the press; a plain cancel commits; the dialog backdrop closes on a finger\'s tap release only (on a Wavecraft — the matrix curve cell went with MATRIX)', async () => {
  const { doc, host, u, root, F, s } = await mount();
  const TWO = { gesture: 'two-finger' }, T = o => Object.assign({ pointerType: 'touch', pointerId: 7 }, o);
  // numField (the Tuning… dialog's A4): dragged, then a second finger — 440 again, and the rolled-back press is no double-tap's first tap
  const a4 = spin(panelOf(dlg(u, MOD.TuningPanel, 'Tuning'), 'TUNING'), 'A4 (Hz)');
  ptr(a4, 'pointerdown', 50, 50, T({ timeStamp: 9000 }));
  ptr(a4, 'pointermove', 50, 10, T());
  assert.notEqual(s().global.a4, 440);
  host.log.length = 0;
  ptr(a4, 'pointercancel', 50, 10, T(TWO));
  assert.equal(s().global.a4, 440);
  assert.deepEqual(host.log.map(x => x[2]), ['move', 'end']);
  ptr(a4, 'pointerdown', 50, 50, T({ timeStamp: 9100 }));
  assert.equal(a4.parentNode.querySelector('input'), null, 'no typed entry');
  ptr(a4, 'pointermove', 50, 10, T());
  ptr(a4, 'pointercancel', 50, 10, T());                       // plain: kept
  assert.notEqual(s().global.a4, 440);
  u.overlay.close();
  await flush(doc);
  // Alt depth drag on a knob: the row's amount comes back
  const R = F.filter.root;
  u.edit(st => { st.matrix[0] = row({ src: 'lfo2', amt: 0.3, dst: 'f.res' }); });
  u.selectSrc('lfo2');
  const res = byDest(root, 'f.res');
  ptr(res, 'pointerdown', 100, 100, { altKey: true, pointerId: 3 });
  ptr(R, 'pointermove', 100, 50, { pointerId: 3 });
  near(s().matrix[0].amt, 0.8, 1e-9);
  host.log.length = 0;
  ptr(R, 'pointercancel', 100, 50, { pointerId: 3, gesture: 'two-finger' });
  near(s().matrix[0].amt, 0.3, 1e-12);
  assert.deepEqual(host.log.filter(x => x[1] === 'Mod depth').map(x => x[2]), ['move', 'end']);
  assert.equal(doc.body.querySelector('.sx-ghost'), null);
  ptr(res, 'pointerdown', 100, 100, { altKey: true, pointerId: 4 });
  ptr(R, 'pointermove', 100, 50, { pointerId: 4 });
  ptr(R, 'pointercancel', 100, 50, { pointerId: 4 });       // plain: kept
  near(s().matrix[0].amt, 0.8, 1e-9);
  // dialog backdrop: a mouse closes at the press; a finger on its tap's release; a two-finger cancel leaves it open
  const ov = () => u.el.querySelector('.sx-dlg-ov');
  u.confirmDlg('Init?', 'Sure?', () => {});
  ptr(ov(), 'pointerdown', 5, 5, T());
  assert.ok(ov(), 'not at the press');
  ptr(ov(), 'pointercancel', 5, 5, T(TWO)); ptr(ov(), 'pointerup', 5, 5, T());
  assert.ok(ov(), 'cancelled: open');
  ptr(ov(), 'pointerdown', 5, 5, T()); ptr(ov(), 'pointerup', 30, 5, T());
  assert.ok(ov(), 'a 25 px drag: open');
  ptr(ov(), 'pointerdown', 5, 5, T()); ptr(ov(), 'pointerup', 8, 6, T());
  assert.equal(ov(), null, 'a tap closes it');
  u.confirmDlg('Init?', 'Sure?', () => {});
  ptr(ov(), 'pointerdown', 5, 5);
  assert.equal(ov(), null, 'a mouse: at the press');
  u.destroy();
});

test('C1 review 2: the selection a press makes never folds the start of that press\'s drag into the undo step before it — undo restores the value from before the drag (on the faces: FILTER 2, FILTER 1, OSC B)', async () => {
  for (const [label, on, id, sel] of [
    ['FILTER 2 (filtTab 0)', 'f2.on', 'f2.cutoff', st => { st.ui.filtTab = 0; }],
    ['FILTER 1 (filtTab 1)', 'f2.on', 'f.cutoff', st => { st.ui.filtTab = 1; }],
    ['OSC B (osc 0)', 'b.on', 'b.level', st => { st.ui.osc = 0; st.ui.oscTab = 0; }],
  ]) {
    const { doc, u, root, s } = await mount();
    u.setN(on, 1, 'set');
    if (id === 'f.cutoff') u.setN('f.on', 1, 'set');
    await flush(doc);
    u.uiEdit(sel);
    await flush(doc);
    const k = byDest(root, id), v0 = s().p[id];
    ptr(k, 'pointerdown', 10, 100, { pointerId: 5 });
    ptr(k, 'pointermove', 10, 60, { pointerId: 5 });
    await flush(doc, 1);                                   // a frame inside the drag (its first move came before it)
    ptr(k, 'pointermove', 10, 40, { pointerId: 5 });
    ptr(k, 'pointerup', 10, 40, { pointerId: 5, buttons: 0 });
    await flush(doc);
    assert.ok(s().p[id] !== v0, label + ': dragged');
    u.undoRedo(false);
    await flush(doc);
    assert.equal(s().p[id], v0, label + ': undo');
    u.destroy();
  }
  // the backstop: a view edit that re-tops (EDIT ALL …) during a drag waits for the drag's own step
  const { doc, u, root, s } = await mount();
  const k = byDest(root, 'a.level'), v0 = s().p['a.level'];
  ptr(k, 'pointerdown', 10, 100, { pointerId: 6 });
  u.uiEdit(st => { st.ui.osc = 0; });                      // (an edit that sets uiRebase)
  ptr(k, 'pointermove', 10, 60, { pointerId: 6 });
  await flush(doc, 1);
  ptr(k, 'pointerup', 10, 60, { pointerId: 6, buttons: 0 });
  await flush(doc);
  u.undoRedo(false);
  await flush(doc);
  assert.equal(s().p['a.level'], v0);
  u.destroy();
});

/* ================================================================ several instances on the canvas (SPEC-canvas §10 stage 1c) */
test('two Wavecraft hosts on one canvas: data-dev scoping, separate state and undo, popovers / overlays / the browser in the top layer; 4 MB undo on touch (was: two SerumUIs)', async () => {
  const doc = D.fresh();
  const world = doc.createElement('div'), ov = doc.createElement('div');
  world.setAttribute('data-cv-world', '');
  doc.body.appendChild(world); doc.body.appendChild(ov);
  wkm.setLayer(ov);
  try {
    const rh = RU.rigHost({ doc });
    const mk = (dev, touch) => {
      const host = mkHost({ dev }), root = doc.createElement('div');
      world.appendChild(root);
      doc.defaultView.matchMedia = q => ({ matches: !!touch && /coarse/.test(q), addEventListener() {}, removeEventListener() {} });
      const u = ui.createHost(host, { doc });
      for (const [kind, part] of [['amp', 'voice'], ['osc', 'oscA']]) rh.face(kind, root, { host: u, part, dev });
      return { host, u, root };
    };
    const A = mk('i1', false), B = mk('i2', true);
    await flush(doc);
    assert.deepEqual([A.u.el.getAttribute('data-dev'), B.u.el.getAttribute('data-dev')], ['i1', 'i2']);
    assert.ok(A.u.roots.every(r => r.getAttribute('data-dev') === 'i1') && B.u.roots.every(r => r.getAttribute('data-dev') === 'i2'), 'every face root carries its device');
    assert.ok(!!(byDest(A.root, 'a.level') && byDest(B.root, 'a.level')), '`a.level` in each, scoped by its [data-dev] root');
    assert.deepEqual([A.u.undoMax, B.u.undoMax], [16 * 1024 * 1024, 4 * 1024 * 1024], 'the touch device keeps 4 MB of panel undo');
    // an edit in one never reaches the other (state, undo)
    const v0 = B.host.st.s.p['a.level'];
    A.u.setN('a.level', 0.123, 'set');
    await flush(doc);
    assert.equal(A.host.st.s.p['a.level'], 0.123);
    assert.equal(B.host.st.s.p['a.level'], v0);
    assert.equal(A.u.undo.canUndo(), true); assert.equal(B.u.undo.canUndo(), false);
    // a popover: in the top layer at screen size (a twin root with the panel's classes and device), closed by a camera move
    const P = A.u.kit.popover('t1', byDest(A.root, 'a.level'), 'Test', () => ({ refresh() {}, destroy() {} }), () => '');
    assert.ok(P && ov.contains(P.box) && !A.root.contains(P.box), 'in #ov');
    const lay = P.box.parentNode;
    assert.ok(lay.classList.contains('sx-root') && lay.classList.contains('sx-layer'));
    assert.equal(lay.getAttribute('data-dev'), 'i1');
    wkm.closeTransient();
    assert.equal(A.u.pop, null, 'a pan (closeTransient) closes it');
    const O = A.u.overlayOpen('sx-dlg-ov', 'Dialog');
    assert.ok(ov.contains(O.el), 'an overlay: a sheet in the top layer');
    O.close();
    B.u.browser.open();
    assert.ok(ov.contains(B.u.browser.ov.el) && !B.root.contains(B.u.browser.ov.el), 'the preset browser too');
    B.u.browser.close();
    A.u.destroy(); B.u.destroy();
    assert.equal(ov.childNodes.length, 0, 'destroy takes the top-layer twins away');
  } finally { wkm.setLayer(null); }
});

test('2a: a Wavecraft\'s host with extraRows paints the canvas cables\' arcs on their knob (paintMods), none elsewhere (was: a SerumUI\'s)', async () => {
  const calls = [];
  const { u } = await mount({ extraRows: id => { calls.push(id); return id === 'g.master' ? [{ id: 'r1', src: 'wheel', amt: 0.25, bi: 0, byp: 0, out: 1 }] : []; } });
  u.scanMods(); u.paintMods(true);
  const m = u.modEls.find(x => x.id === 'g.master'), other = u.modEls.filter(x => x.id !== 'g.master' && x.arcs && x.arcs.length);
  assert.ok(m, 'the MASTER knob (the Amplifier\'s) is a modulation target');
  assert.deepEqual(m.arcs.map(a => [a.slot, !!a.canvas]), [[-1, true]]);
  assert.equal(other.length, 0);
  assert.ok(calls.includes('g.master'));
});

/* ================================================================ the host's stylesheet: the rules a Wavecraft's views use */
// the panel's stylesheet (the CSS template in sx-host.js: the host injects it for every view) as [{cond, sel, body}] rules;
// cond = the enclosing at-rule
function cssRules() {
  const src = readFileSync(fileURLToPath(new URL('sx-host.js', ROOT)), 'utf8');
  const css = src.slice(src.indexOf('const CSS = `') + 13, src.indexOf('`;', src.indexOf('const CSS = `'))).replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0, cond = '';
  while (i < css.length) {
    const o = css.indexOf('{', i), c = css.indexOf('}', i);
    if (c >= 0 && (o < 0 || c < o)) { cond = ''; i = c + 1; continue; }   // the end of an at-rule block
    if (o < 0) break;
    const head = css.slice(i, o).trim();
    if (head.startsWith('@')) { cond = head; i = o + 1; continue; }
    const e = css.indexOf('}', o);
    for (const sel of head.split(',')) out.push({ cond, sel: sel.trim(), body: css.slice(o + 1, e) });
    i = e + 1;
  }
  return out;
}
const maxW = cond => { const m = /\(max-width:\s*(\d+)px\)/.exec(cond); return m ? +m[1] : Infinity; };

test('review: CSS a Wavecraft\'s views use — full-screen editor popovers below 1100 px; ≥ 44 px touch targets (seg buttons, the browser\'s tabs, stars, play); reduced motion stops every transition (was: two CSS cases of the bundled layout — its OSC / FILTER columns, row C, ENV tabs, matrix CRV cells and C1 folds went with the shell)', () => {
  const R = cssRules();
  // editor popovers (curve editors, PZ, OSC MAPPING …) full screen below 1100 px
  const ed = R.find(r => r.sel === '.sx-pop.sx-pop-ed');
  assert.ok(ed && maxW(ed.cond) === 1099 && /inset:\s*0/.test(ed.body) && /100dvh/.test(ed.body));
  // touch: ≥ 44 px for every seg button (the faces', the dialogs'), the browser tabs, stars, play / more
  const touch = sel => R.find(r => r.sel === '.sx-touch ' + sel);
  for (const sel of ['.sx-seg button', '.pb-tabs button', '.pb-stars button', '.pb-play']) {
    assert.ok(touch(sel) && /min-height:\s*44px/.test(touch(sel).body), sel);
  }
  // instant: reduced motion stops every transition of a view root
  assert.ok(R.some(r => /prefers-reduced-motion:\s*reduce/.test(r.cond) && r.sel === '.sx-root *' && /transition:\s*none !important/.test(r.body)));
});
