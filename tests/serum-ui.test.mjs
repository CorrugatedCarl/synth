// serum-ui.js (U1; SPEC-serum2 §11.14, §13, §15.12) — pure helpers and headless checks of SerumUI / PresetBrowser on a
// minimal fake DOM. Run: node --test tests/
//
// Sibling modules are replaced by stubs (tests/serum-ui-stubs/, via tests/serum-ui.hooks.mjs redirectUI) so this file
// tests serum-ui alone (§10.1: a unit test imports only its own module plus fixtures): graph.js, fx-ui.js, wtedit.js and
// wt.js are small stand-ins; the sub-panel modules serum-ui hosts — sx-ui-osc (U2), sx-ui-seq (U4), sx-ui-mix (U3) —
// re-export the real modules' pure helpers and replace their panels / pages by kit-built stand-ins (their own tests:
// tests/sx-ui-osc.test.mjs, tests/sx-ui-seq.test.mjs, tests/sx-ui-mix.test.mjs). serum-core.js and wk.js are the real
// modules serum-ui builds on. A separate test imports serum-ui.js with the real siblings in a child process when they
// all exist (§15.12 "importing every browser module in node does not throw"); the export-parity tests compare the
// stubs with the real modules.
import './v8-guard.mjs';
import test from 'node:test';
import assertBase from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { redirectUI } from './serum-ui.hooks.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { inspect } from 'node:util';
import { fileURLToPath } from 'node:url';

const SAME = new Set(['equal', 'strictEqual', 'notEqual', 'notStrictEqual']), DEEP = new Set(['deepEqual', 'deepStrictEqual', 'notDeepEqual', 'notDeepStrictEqual']);
const assert = new Proxy(assertBase, {
  get(t, k) {
    const f = t[k];
    if (typeof f !== 'function') return f;
    if (SAME.has(k)) return (a, b, ...r) => (isNode(a) || isNode(b) ? f.call(t, scrub(a), scrub(b), ...r) : f.call(t, a, b, ...r));   // identity kept
    if (DEEP.has(k)) return (a, b, ...r) => f.call(t, scrub(a), scrub(b), ...r);
    return f;
  },
});
const ROOT = new URL('../', import.meta.url);
const SIBLINGS = ['graph.js', 'fx-ui.js', 'wtedit.js', 'wt.js', 'sx-ui-osc.js', 'sx-ui-seq.js'];

/* ---------------------------------------------------------------- sibling stubs */
// tests/serum-ui.hooks.mjs redirects the sibling imports to tests/serum-ui-stubs/*.js
if (typeof nodeModule.registerHooks === 'function') {
  nodeModule.registerHooks({ resolve: (spec, ctx, next) => redirectUI(spec, ctx.parentURL) || next(spec, ctx) });
} else nodeModule.register('./serum-ui-stubs/hooks-ui.mjs', import.meta.url);

// DSP globals defined (null) so wk.loadDSP resolves at once instead of injecting scripts into the fake DOM
globalThis.SerumDSP = null;
globalThis.FXDSP = null;

// imported before any DOM exists: the module must not touch document / window at top level (§0.1, §10.6)
const ui = await import('../serum-ui.js');
const core = await import('../serum-core.js');
const gxStub = await import('../graph.js');
const fxStub = await import('../fx-ui.js');
const wteStub = await import('../wtedit.js');
const wtStub = await import('../wt.js');
const oscStub = await import('../sx-ui-osc.js');
const seqStub = await import('../sx-ui-seq.js');
const mixStub = await import('../sx-ui-mix.js');
const kitStub = await import('./serum-ui-stubs/kit.js');
const wkm = await import('../wk.js?v=7');   // the instance serum-ui uses (same specifier: shared modifier latches)

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
test('imports in node without a DOM; siblings and sub-panel modules stubbed for the unit tests', () => {
  for (const k of ['SerumUI', 'PresetBrowser', 'haloArcs', 'knobMenuItems', 'moduleMenuItems', 'dropRow', 'busMenuItems', 'lfoTileCount', 'sortPresets',
    'filterPresets', 'stepPreset', 'presetTags', 'withMeta', 'hybridPick', 'captureDue', 'undoStack', 'makeKit', 'virtGet', 'virtSet', 's1Diff', 'rowAlias', 'rowBad']) {
    assert.equal(typeof ui[k], 'function', k);
  }
  assert.deepEqual(ui.PAGES, ['osc', 'mix', 'fx', 'matrix', 'arp', 'clip', 'global']);
  for (const m of [gxStub, fxStub, wteStub, wtStub, oscStub, seqStub, mixStub]) assert.equal(m.__stub, true);
});

test('imports in node with the real sibling modules (child process; skipped while a sibling is missing)', t => {
  const missing = SIBLINGS.filter(f => !existsSync(fileURLToPath(new URL(f, ROOT))));
  if (missing.length) { t.skip('missing sibling module(s): ' + missing.join(', ')); return; }
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import(${JSON.stringify(new URL('serum-ui.js', ROOT).href)}); if (typeof m.SerumUI !== 'function') process.exit(3);`],
  { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
});

test('export parity (§15.12): the sub-panel stubs export exactly the real modules\' names; the sibling stubs only real names', t => {
  // sx-ui-osc / sx-ui-seq stubs re-export the real module and shadow its panels: the same names by construction, and
  // every shadowing class must exist in the real module
  for (const [file, stub] of [['sx-ui-osc.js', oscStub], ['sx-ui-seq.js', seqStub]]) {
    const real = exportNames(file), mine = new Set(Object.keys(stub).filter(k => k !== '__stub' && k !== 'made' && k !== 'calls'));
    assert.deepEqual([...mine].filter(k => !real.has(k)), [], file + ': stub-only names');
    assert.deepEqual([...real].filter(k => !mine.has(k)), [], file + ': names missing from the stub');
  }
  // sx-ui-mix (U3) is loaded on demand: its stub follows §11.14 until the module exists, then exactly its names
  const mixNames = new Set(Object.keys(mixStub).filter(k => k !== '__stub' && k !== 'made'));
  assert.deepEqual([...mixNames].sort(), ['MixerPage', 'channelStrips', 'routeMenuItems']);
  if (existsSync(fileURLToPath(new URL('sx-ui-mix.js', ROOT)))) assert.deepEqual([...exportNames('sx-ui-mix.js')].sort(), [...mixNames].sort());
  else t.diagnostic('sx-ui-mix.js not present yet: §11.14 names checked');
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
/* ================================================================ fake DOM (headless checks) */
// Fake DOM objects print as a one-line tag: an assertion failure that shows an element would otherwise make node's
// inspector walk the whole (cyclic, document-sized) tree and exhaust memory.
const INSPECT = inspect.custom;
const tagOf = n => (!n ? String(n) : n.nodeType === 1 ? '<' + n.localName + (n.className ? '.' + n.className.trim().split(/\s+/).join('.') : '')
  + (n.getAttribute('data-dest') ? ' data-dest=' + n.getAttribute('data-dest') : '') + '>' : n.nodeType === 3 ? '#text ' + JSON.stringify(n.data.slice(0, 40)) : '[' + (n.constructor && n.constructor.name) + ']');
// node's AssertionError ignores custom inspectors (it inspects with customInspect off and depth 1000), so the assertions of
// this file see fake DOM nodes as `<tag.class>#id` strings instead (identity kept through the id).
const NODE_ID = new WeakMap();
let nodeN = 0;
const isNode = v => v instanceof Tgt || v instanceof Txt;
const nodeStr = n => { if (!NODE_ID.has(n)) NODE_ID.set(n, ++nodeN); return tagOf(n) + '#' + NODE_ID.get(n); };
const scrub = (v, d = 0) => (isNode(v) ? nodeStr(v) : d < 3 && Array.isArray(v) ? v.map(x => scrub(x, d + 1))
  : d < 3 && v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x, d + 1)])) : v);
let NOW = 1000;
class Ev {
  constructor(type, o = {}) {
    Object.assign(this, { bubbles: false, cancelable: false, isTrusted: false, button: 0, buttons: 0, clientX: 0, clientY: 0,
      shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, pointerId: 1, pointerType: 'mouse', deltaX: 0, deltaY: 0,
      deltaMode: 0, key: '', timeStamp: NOW++ }, o);
    this.type = type; this.defaultPrevented = false; this._stop = false; this._imm = false; this.target = null; this.currentTarget = null;
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
  stopImmediatePropagation() { this._stop = true; this._imm = true; }
}
class Tgt {
  constructor() { this._l = []; }
  [INSPECT]() { return tagOf(this); }
  addEventListener(t, fn, o) { const c = o === true || !!(o && o.capture); if (!this._l.some(x => x.t === t && x.fn === fn && x.c === c)) this._l.push({ t, fn, c }); }
  removeEventListener(t, fn, o) { const c = o === true || !!(o && o.capture); this._l = this._l.filter(x => !(x.t === t && x.fn === fn && x.c === c)); }
  dispatchEvent(ev) {
    ev.target = this;
    const path = [];
    for (let n = this; n; n = n._parent()) path.push(n);
    const run = (n, cap) => { ev.currentTarget = n; for (const x of n._l.slice()) { if (x.t !== ev.type || x.c !== cap) continue; x.fn.call(n, ev); if (ev._imm) break; } };
    for (let i = path.length - 1; i > 0 && !ev._stop; i--) run(path[i], true);
    if (!ev._stop) run(this, true);
    if (!ev._stop) run(this, false);
    if (ev.bubbles) for (let i = 1; i < path.length && !ev._stop; i++) run(path[i], false);
    ev.currentTarget = null;
    return !ev.defaultPrevented;
  }
}
class Txt { constructor(t) { this.nodeType = 3; this.data = String(t); this.parentNode = null; } [INSPECT]() { return tagOf(this); } get textContent() { return this.data; } contains(n) { return n === this; } _parent() { return this.parentNode; } }
function compound(s) {
  const re = /([a-zA-Z][\w-]*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g, c = { tag: null, cls: [], id: null, attrs: [] };
  let m, pos = 0;
  while ((m = re.exec(s))) {
    if (m.index !== pos) throw new Error('fake DOM: unsupported selector ' + s);
    pos = re.lastIndex;
    if (m[1]) c.tag = m[1].toLowerCase(); else if (m[2]) c.cls.push(m[2]); else if (m[3]) c.id = m[3]; else c.attrs.push([m[4], m[5]]);
  }
  if (pos !== s.length) throw new Error('fake DOM: unsupported selector ' + s);
  return c;
}
function matches(el, sel) {
  if (!el || el.nodeType !== 1) return false;
  return sel.split(',').map(x => x.trim()).filter(Boolean).map(compound).some(c => {
    if (c.tag && el.localName !== c.tag) return false;
    for (const k of c.cls) if (!el.classList.contains(k)) return false;
    if (c.id && el.id !== c.id) return false;
    for (const [a, v] of c.attrs) { if (!el.hasAttribute(a)) return false; if (v !== undefined && el.getAttribute(a) !== v) return false; }
    return true;
  });
}
const CTX2D = () => new Proxy({ measureText: t => ({ width: String(t).length * 6 }) }, { get: (t, k) => (k in t ? t[k] : () => undefined), set: (t, k, v) => { t[k] = v; return true; } });
class El extends Tgt {
  constructor(doc, tag, ns) {
    super();
    this.ownerDocument = doc; this.localName = tag.toLowerCase(); this.tagName = tag.toUpperCase(); this.namespaceURI = ns;
    this.nodeType = 1; this.childNodes = []; this.parentNode = null; this._a = new Map(); this._rect = null;
    this.value = ''; this.disabled = false; this.width = 300; this.height = 150; this.files = null;
    this.style = { setProperty(k, v) { this[k] = v; }, getPropertyValue(k) { return this[k] || ''; } };
    const self = this, get = () => self.className.split(/\s+/).filter(Boolean), put = a => { self.className = a.join(' '); };
    this.classList = {
      add(...c) { const a = get(); for (const x of c) if (!a.includes(x)) a.push(x); put(a); },
      remove(...c) { put(get().filter(x => !c.includes(x))); },
      toggle(c, f) { const want = f === undefined ? !get().includes(c) : !!f; if (want) this.add(c); else this.remove(c); return want; },
      contains(c) { return get().includes(c); },
    };
  }
  _parent() { return this.parentNode; }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  setAttribute(k, v) { this._a.set(k, String(v)); }
  getAttribute(k) { return this._a.has(k) ? this._a.get(k) : null; }
  hasAttribute(k) { return this._a.has(k); }
  removeAttribute(k) { this._a.delete(k); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get tabIndex() { const v = this.getAttribute('tabindex'); return v == null ? -1 : +v; }
  set tabIndex(v) { this.setAttribute('tabindex', v); }
  get type() { return this.getAttribute('type') || ''; }
  set type(v) { this.setAttribute('type', v); }
  get title() { return this.getAttribute('title') || ''; }
  set title(v) { this.setAttribute('title', v); }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { for (const n of this.childNodes) n.parentNode = null; this.childNodes = v === '' || v == null ? [] : [new Txt(v)]; for (const n of this.childNodes) n.parentNode = this; }
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
  append(...ns) { for (const n of ns) this.appendChild(typeof n === 'string' ? new Txt(n) : n); }
  insertBefore(n, ref) { if (!ref) return this.appendChild(n); if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(ref), 0, n); return n; }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; const d = this.ownerDocument; if (n.contains && n.contains(d.activeElement)) d.activeElement = d.body; return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
  get isConnected() { return this.ownerDocument.documentElement.contains(this); }
  matches(sel) { return matches(this, sel); }
  closest(sel) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (matches(n, sel)) return n; return null; }
  querySelectorAll(sel) { const out = []; const walk = n => { for (const c of n.childNodes) if (c.nodeType === 1) { if (matches(c, sel)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  focus() { if (this.isConnected) this.ownerDocument._focus(this); }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument._focus(this.ownerDocument.body); }
  select() {}
  click() { this.dispatchEvent(new Ev('click', { bubbles: true, cancelable: true })); }
  getBoundingClientRect() {
    const r = this._rect || { left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0, width: this.localName === 'canvas' ? 300 : 40, height: this.localName === 'canvas' ? 120 : 20 };
    return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top };
  }
  setPointerCapture() {} releasePointerCapture() {}
  getContext() { return this._g || (this._g = CTX2D()); }
}
class Win extends Tgt {
  constructor() { super(); this.innerWidth = 1440; this.innerHeight = 900; this.devicePixelRatio = 1; this.raf = []; this.confirms = []; }
  _parent() { return null; }
  requestAnimationFrame(f) { this.raf.push(f); return this.raf.length; }
  confirm(msg) { this.confirms.push(msg); return this.answer !== false; }
}
class Doc extends Tgt {
  constructor() {
    super();
    this.nodeType = 9; this.defaultView = new Win(); this.hidden = false; this.pointAt = null;
    this.documentElement = this.createElement('html'); this.documentElement.parentNode = this;
    this.head = this.createElement('head'); this.body = this.createElement('body');
    this.documentElement.append(this.head, this.body);
    this.activeElement = this.body;
  }
  _parent() { return this.defaultView; }
  createElement(t) { return new El(this, t, 'http://www.w3.org/1999/xhtml'); }
  createElementNS(ns, t) { return new El(this, t, ns); }
  createTextNode(t) { return new Txt(t); }
  getElementById(id) { return this.documentElement.querySelectorAll('#' + id)[0] || null; }
  elementFromPoint(x, y) { return this.pointAt ? this.pointAt(x, y) : null; }
  _focus(el) { const prev = this.activeElement; if (prev === el) return; this.activeElement = el; if (prev && prev !== this.body) prev.dispatchEvent(new Ev('blur')); el.dispatchEvent(new Ev('focus')); }
}
function fire(el, type, o = {}) { const e = new Ev(type, Object.assign({ bubbles: true, cancelable: true }, o)); el.dispatchEvent(e); return e; }
const ptr = (el, type, x, y, o = {}) => fire(el, type, Object.assign({ clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }, o));
const tick = () => new Promise(r => setTimeout(r, 0));
async function flush(doc, rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await tick();
    const q = doc.defaultView.raf.splice(0);
    for (const f of q) f(NOW++);
  }
}
const ctxMenus = doc => doc.body.querySelectorAll('.wk-ctx');
const menuLabels = m => m.querySelectorAll('.wk-ci, .wk-sep').map(n => (n.classList.contains('wk-sep') ? '' : n.querySelector('.wk-cl').textContent));
function pick(doc, label) {
  const ms = ctxMenus(doc), m = ms[ms.length - 1];
  const it = m.querySelectorAll('.wk-ci').find(n => n.querySelector('.wk-cl').textContent === label);
  assert.ok(it, 'menu item ' + label + ' in ' + JSON.stringify(menuLabels(m)));
  ptr(it, 'pointerdown', 1, 1);
  fire(it, 'click');
}
const byDest = (root, id) => root.querySelectorAll('[data-dest="' + id + '"]')[0] || null;

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
async function mount(over, prep) {
  const doc = new Doc();
  globalThis.document = doc;
  globalThis.MouseEvent = Ev;
  const host = mkHost(over), root = doc.createElement('div');
  doc.body.appendChild(root);
  if (prep) prep(host, doc);
  const u = new ui.SerumUI(root, host);
  await flush(doc);
  return { doc, host, root, u, s: () => host.st.s };
}
const tabsOf = u => u.el.querySelectorAll('[role="tab"]').filter(t => t.classList.contains('sx-tab'));
const seen = el => new Set(el.querySelectorAll('[data-dest]').map(n => n.getAttribute('data-dest')));
const hbtn = (u, aria) => u.el.querySelectorAll('button').find(b => b.getAttribute('aria-label') === aria) || null;

/* ================================================================ headless SerumUI */
test('SerumUI: header (§13.2), seven pages, keyboard panel under every page, data-dest coverage of serum-ui\'s panels', async () => {
  const { doc, host, u, s } = await mount();
  const el = u.el;
  assert.ok(el.classList.contains('sx-root'));
  assert.deepEqual(host.log.filter(x => x[0] === 'monitor'), [['monitor', true]]);
  const tabs = tabsOf(u);
  assert.deepEqual(tabs.map(t => t.textContent), ['OSC', 'MIX', 'FX', 'MATRIX', 'ARP', 'CLIP', 'GLOBAL']);
  assert.deepEqual(tabs.map(t => t.getAttribute('aria-selected')), ['true', 'false', 'false', 'false', 'false', 'false', 'false']);
  // header: wave icon, preset area with ARTIST / DESC, undo / redo, menu, modifier bar, voice counter, MASTER + meter
  const H = u.head;
  assert.ok(H.querySelector('.sx-wave'));
  assert.ok(hbtn(u, 'Artist, description and tags'));
  assert.equal(H.querySelector('.sx-undo').querySelectorAll('button').length, 2);
  assert.ok(H.querySelector('.sx-mkeys'), 'touch modifier bar');
  assert.ok(H.querySelector('.wk-meter'), 'output meter');
  assert.ok(byDest(H, 'g.master'));
  // the keyboard panel (sx-ui-seq KeyboardPanel) sits under the pages, built once
  const kb = seqStub.made.filter(x => x instanceof seqStub.KeyboardPanel).at(-1);
  assert.ok(u.footEl.contains(kb.el));
  assert.equal(u.pageBox.contains(kb.el), false);
  const n0 = kb.n;
  u.setPage('global');
  await flush(doc);
  assert.equal(s().ui.page, 'global');
  assert.ok(host.log.some(x => x[0] === 'edit' && x[3] === true));     // page change is a UI-only edit
  assert.ok(kb.n > n0, 'the keyboard panel repaints on every page');
  for (const p of ui.PAGES) { u.setPage(p); await flush(doc); }
  // every destination of the panels serum-ui owns carries data-dest (§13.3): ENV / LFO knobs follow the selection
  u.setPage('osc');
  await flush(doc);
  const all = new Set([...seen(u.pages.osc.el), ...seen(u.pages.global.el), ...seen(u.head)]);
  const groups = ['Env 1', 'LFO 1', 'Chaos', 'Global', 'Master', 'Macros', 'Voice Control'];
  const want = core.DESTS.filter(d => groups.includes(d.group) && !core.MATRIX_ONLY.includes(d.id)).map(d => d.id)
    .concat(['e2.start', 'e2.end'], ...['a', 'b', 'c'].map(k => [k + '.uniw', k + '.uniwarp', k + '.uniwarp2', k + '.uniwt', k + '.stack']));
  assert.deepEqual(want.filter(id => !all.has(id)), []);
  for (const id of all) assert.ok(core.DEST_INDEX[id] !== undefined, id);
  u.selectSrc('env3');
  u.selectSrc('lfo10');
  await flush(doc);
  assert.equal(s().ui.env, 2);
  assert.ok(byDest(el, 'e3.att') && byDest(el, 'e3.ca') && byDest(el, 'e3.start') && byDest(el, 'l10.rate') && byDest(el, 'l10.phase'));
  assert.equal(byDest(u.pages.osc.el, 'e1.att'), null);
  // hidden pages are not painted (§13.1): the MIX page's row C follows the selection when it is shown
  assert.ok(byDest(u.pages.mix.el, 'e1.att'), 'the hidden MIX page still shows its last painted state');
  u.setPage('mix');
  await flush(doc);
  assert.equal(byDest(u.pages.mix.el, 'e1.att'), null);
  assert.ok(byDest(u.pages.mix.el, 'e3.att'));
  u.setPage('osc');
  await flush(doc);
  // LFO tiles: 6 by default (LFO 7–10 once the LFO before them is used, inv B16); the selected LFO 10 stays visible
  const shown = () => u.pages.osc.el.querySelectorAll('[data-lfotile]').filter(t => !t.classList.contains('sx-hidden')).map(t => t.getAttribute('data-lfotile'));
  assert.deepEqual(shown(), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  u.selectSrc('lfo2');
  await flush(doc);
  assert.deepEqual(shown(), ['1', '2', '3', '4', '5', '6']);
  assert.equal(u.pages.osc.el.querySelectorAll('.sx-tile').filter(t => /^env[1-4]$/.test(t.getAttribute('data-src'))).length, 4);
  assert.equal(u.pages.osc.el.querySelectorAll('[data-mactile]').length, 16);   // MACROS panel + the tile strip (§13.13)
  assert.deepEqual(u.pages.osc.el.querySelector('.sx-tiles').querySelectorAll('[data-mactile]').map(t => t.getAttribute('data-mactile')), ['1', '2', '3', '4', '5', '6', '7', '8']);
  u.destroy();
  assert.equal(el.isConnected, false);
  assert.deepEqual(host.log.filter(x => x[0] === 'monitor'), [['monitor', true], ['monitor', false]]);
});

test('SerumUI: right-click on a source tile, an ENV tab or the LFO title — Bypass All / Remove All Destinations (inv B15), one undo step each', async () => {
  const { doc, u, s } = await mount();
  u.edit(st => {
    st.matrix[0] = row({ src: 'env2', amt: 0.5, dst: 'f.cutoff' });
    st.matrix[1] = row({ src: 'env2', amt: 0.3, dst: 'a.level' });
    st.matrix[2] = row({ src: 'lfo1', amt: 0.2, dst: 'a.pan' });
    st.matrix[3] = row({ src: 'velo', amt: 0.4, dst: 'a.level' });
  });
  await flush(doc);
  const tile = src => u.el.querySelectorAll('.sx-tile').find(t => t.getAttribute('data-src') === src);
  const labels = () => menuLabels(ctxMenus(doc).at(-1));
  // ENV 2 tile: both items; bypass sets every ENV 2 row, the other sources untouched; again (✓) un-bypasses them
  fire(tile('env2'), 'contextmenu', { clientX: 5, clientY: 5 });
  assert.deepEqual(labels(), ['Bypass All Destinations', 'Remove All Destinations']);
  pick(doc, 'Bypass All Destinations');
  await flush(doc);
  assert.deepEqual(s().matrix.slice(0, 4).map(r => r.byp), [1, 1, 0, 0]);
  assert.equal(u.undo.label(), 'Bypass All Destinations');
  fire(tile('env2'), 'contextmenu', { clientX: 5, clientY: 5 });
  pick(doc, 'Bypass All Destinations');
  await flush(doc);
  assert.deepEqual(s().matrix.slice(0, 4).map(r => r.byp), [0, 0, 0, 0]);
  // the ENV tab of the envelope editor: the same menu; Remove All Destinations clears ENV 2's rows in one undo step
  const tab = u.el.querySelectorAll('[role="tab"]').find(t => t.getAttribute('aria-label') === 'ENV 2' || t.title === 'ENV 2');
  assert.ok(tab, 'ENV 2 tab');
  fire(tab, 'contextmenu', { clientX: 5, clientY: 5 });
  pick(doc, 'Remove All Destinations');
  await flush(doc);
  assert.deepEqual(s().matrix.slice(0, 4).map(r => r.src), ['', '', 'lfo1', 'velo']);
  assert.equal(u.undo.label(), 'Remove All Destinations');
  u.undoRedo(false);
  await flush(doc);
  assert.deepEqual(s().matrix.slice(0, 4).map(r => r.src), ['env2', 'env2', 'lfo1', 'velo'], 'one undo step');
  // LFO 1 and VELO tiles
  fire(tile('lfo1'), 'contextmenu', { clientX: 5, clientY: 5 });
  pick(doc, 'Remove All Destinations');
  fire(tile('velo'), 'contextmenu', { clientX: 5, clientY: 5 });
  pick(doc, 'Bypass All Destinations');
  assert.deepEqual(s().matrix.slice(0, 4).map(r => [r.src, r.byp]), [['env2', 0], ['env2', 0], ['', 0], ['velo', 1]]);
  // a source without destinations: both items disabled
  fire(tile('env4'), 'contextmenu', { clientX: 5, clientY: 5 });
  assert.equal(ctxMenus(doc).at(-1).querySelectorAll('.wk-ci').filter(n => n.classList.contains('wk-dis') || n.getAttribute('aria-disabled') === 'true').length, 2);
  u.destroy();
});

test('SerumUI: knob right-click menu v2 (grouped Mod Source, Aux Source, Edit Custom Curve) and its actions', async () => {
  const { doc, host, u, s } = await mount();
  const knob = byDest(u.el, 'f.cutoff');
  fire(knob, 'contextmenu', { clientX: 50, clientY: 60 });
  let m = ctxMenus(doc);
  assert.equal(m.length, 1);
  assert.deepEqual(menuLabels(m[0]), ['Reset Control', 'Enter Value…', '', 'Mod Source', '', 'MIDI Learn', 'Lock']);
  pick(doc, 'Mod Source');
  pick(doc, 'LFOs');
  pick(doc, 'LFO 3');
  await flush(doc);
  assert.deepEqual(s().matrix[0], row({ src: 'lfo3', amt: 0.5, dst: 'f.cutoff' }));
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
  assert.deepEqual(s().locks.p, ['f.cutoff']);
  fire(knob, 'contextmenu', { clientX: 50, clientY: 60 });
  pick(doc, 'MIDI Learn');
  await flush(doc);
  assert.deepEqual(host.log.filter(x => x[0] === 'learn'), [['learn', 'f.cutoff']]);
  fire(knob, 'contextmenu', { clientX: 50, clientY: 60 });
  m = ctxMenus(doc);
  assert.deepEqual(menuLabels(m.at(-1)).slice(-3), ['MIDI Re-learn (CC 33)', 'Remove MIDI CC 33', 'Unlock']);
  pick(doc, 'Remove MIDI CC 33');
  assert.deepEqual(s().midi, {});
  fire(knob, 'contextmenu', { clientX: 50, clientY: 60 });
  pick(doc, 'Remove Modulator: LFO 3');
  assert.equal(s().matrix[0].src, '');
  s().p['f.cutoff'] = 0.9;
  fire(knob, 'contextmenu', { clientX: 50, clientY: 60 });
  pick(doc, 'Reset Control');
  assert.equal(s().p['f.cutoff'], core.DESTS[core.DEST_INDEX['f.cutoff']].def);
  u.destroy();
});

test('SerumUI: module menus (Lock / Init / Copy / Copy (w/mods) / Paste / Swap), Unlock Control, module label drag', async () => {
  const { doc, u, s } = await mount();
  const pw = byDest(u.el, 'a.on');
  assert.equal(pw.getAttribute('data-module'), 'oscA');
  fire(pw, 'contextmenu', { clientX: 10, clientY: 10 });
  assert.deepEqual(menuLabels(ctxMenus(doc).at(-1)).slice(0, 7), ['Lock Module', 'Init Module', 'Copy', 'Copy (w/mods)', 'Swap with', '', 'Reset Control']);
  u.edit(st => { st.p['a.level'] = 0.2; st.matrix[0] = row({ src: 'lfo1', amt: 0.3, dst: 'a.wt' }); });
  pick(doc, 'Copy (w/mods)');
  const pwC = byDest(u.el, 'c.on');
  fire(pwC, 'contextmenu', { clientX: 10, clientY: 10 });
  assert.deepEqual(menuLabels(ctxMenus(doc).at(-1)).slice(0, 6), ['Lock Module', 'Init Module', 'Copy', 'Copy (w/mods)', 'Paste', 'Swap with']);
  pick(doc, 'Paste');
  assert.equal(s().p['c.level'], 0.2);
  assert.ok(s().matrix.some(r => r.src === 'lfo1' && r.dst === 'c.wt'));
  // the clipboard does not fit another kind: no Paste on the noise module
  fire(byDest(u.el, 'n.on'), 'contextmenu', { clientX: 10, clientY: 10 });
  assert.equal(menuLabels(ctxMenus(doc).at(-1)).includes('Paste'), false);
  // Swap with ▸ (touch long-press equivalent of the label drag)
  u.edit(st => { st.p['b.level'] = 0.6; });
  fire(pw, 'contextmenu', { clientX: 10, clientY: 10 });
  pick(doc, 'Swap with');
  pick(doc, 'OSC B');
  assert.deepEqual([s().p['a.level'], s().p['b.level']], [0.6, 0.2]);
  assert.ok(s().matrix.some(r => r.src === 'lfo1' && r.dst === 'b.wt'));
  // Init Module removes the module's modulations
  fire(byDest(u.el, 'b.on'), 'contextmenu', { clientX: 10, clientY: 10 });
  pick(doc, 'Init Module');
  assert.equal(s().p['b.level'], fresh().p['b.level']);
  assert.equal(s().matrix.some(r => r.dst === 'b.wt'), false);
  // the module title opens the same menu (right-click), Lock Module there, then Unlock Control on one of its knobs
  const title = u.el.querySelectorAll('[data-modlabel]').find(n => n.getAttribute('data-modlabel') === 'oscB');
  fire(title, 'contextmenu', { clientX: 5, clientY: 5 });
  assert.deepEqual(menuLabels(ctxMenus(doc).at(-1)).slice(0, 2), ['Lock Module', 'Init Module']);
  pick(doc, 'Lock Module');
  assert.deepEqual(s().locks.mod, ['oscB']);
  await flush(doc);
  const bl = byDest(u.el, 'b.level');
  assert.ok(bl.classList.contains('sx-locked-ctl'));
  fire(bl, 'contextmenu', { clientX: 5, clientY: 5 });
  assert.equal(menuLabels(ctxMenus(doc).at(-1)).at(-1), 'Unlock Control');
  pick(doc, 'Unlock Control');
  assert.deepEqual(s().locks.unp, ['b.level']);
  await flush(doc);
  assert.equal(bl.classList.contains('sx-locked-ctl'), false);           // unlocked controls show no lock tint
  assert.ok(byDest(u.el, 'b.pan').classList.contains('sx-locked-ctl'));
  // module label drag (§13.3, inv B2): plain = swap, Alt = copy
  const lab = m => u.el.querySelectorAll('[data-modlabel]').find(n => n.getAttribute('data-modlabel') === m);
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

test('SerumUI: tile drag-and-drop onto a control, the matrix, an LFO point, macros; Alt-drag depth; Shift+Alt polarity', async () => {
  const { doc, host, u, s } = await mount();
  const el = u.el, tile = el.querySelector('[data-src="lfo2"]'), res = byDest(el, 'f.res');
  s().p['f.res'] = 0.7;
  doc.pointAt = () => res;
  ptr(tile, 'pointerdown', 10, 10);
  ptr(tile, 'pointermove', 30, 30);
  assert.ok(doc.body.querySelector('.sx-ghost'));
  assert.ok(res.classList.contains('sx-droptgt'));
  ptr(tile, 'pointerup', 30, 30);
  fire(tile, 'click');                                                  // the click after a drag does not select
  await flush(doc);
  assert.equal(doc.body.querySelector('.sx-ghost'), null);
  assert.equal(res.classList.contains('sx-droptgt'), false);
  near(s().matrix[0].amt, 0.3, 1e-12);
  assert.deepEqual(Object.assign({}, s().matrix[0], { amt: 0 }), row({ src: 'lfo2', dst: 'f.res' }));
  assert.equal(s().ui.mod, 'lfo2');
  // click selects; Escape cancels a drag
  const env2 = el.querySelector('[data-src="env2"]');
  fire(env2, 'click');
  assert.equal(s().ui.mod, 'env2'); assert.equal(s().ui.env, 1);
  ptr(env2, 'pointerdown', 10, 10);
  ptr(env2, 'pointermove', 40, 40);
  fire(doc.body, 'keydown', { key: 'Escape' });
  ptr(env2, 'pointerup', 40, 40);
  assert.equal(s().matrix[1].src, '');
  assert.equal(doc.body.querySelector('.sx-ghost'), null);
  // Alt-drag on the knob edits the selected source's row, else the most recent row (200 px = 2.0)
  u.selectSrc('lfo2');
  ptr(res, 'pointerdown', 100, 100, { altKey: true });
  ptr(el, 'pointermove', 100, 50);
  ptr(el, 'pointerup', 100, 50);
  near(s().matrix[0].amt, 0.8, 1e-9);
  assert.ok(host.log.some(x => x[1] === 'Mod depth' && x[2] === 'end'));
  ptr(res, 'pointerdown', 100, 100, { altKey: true, shiftKey: true });
  assert.equal(s().matrix[0].bi, 1);
  // a macro tile on another macro's knob adds macroA → mB; on another macro's label it swaps the two macros
  const m1 = el.querySelector('[data-src="macro1"]'), m4 = el.querySelector('[data-src="macro4"]');
  doc.pointAt = () => byDest(u.pages.osc.el, 'm3');
  ptr(m1, 'pointerdown', 10, 10); ptr(m1, 'pointermove', 30, 30); ptr(m1, 'pointerup', 30, 30);
  assert.ok(s().matrix.some(r => r.src === 'macro1' && r.dst === 'm3'));
  u.edit(st => { st.macros[0].name = 'Grit'; st.macros[0].v = 0.25; st.macros[3].name = 'Air'; });
  doc.pointAt = () => m4;
  ptr(m1, 'pointerdown', 10, 10); ptr(m1, 'pointermove', 30, 30); ptr(m1, 'pointerup', 30, 30);
  assert.deepEqual([s().macros[0].name, s().macros[3].name, s().macros[3].v], ['Air', 'Grit', 0.25]);
  assert.ok(s().matrix.some(r => r.src === 'macro4' && r.dst === 'm3'));       // the rows follow the swap
  // drop onto a matrix SOURCE cell
  u.setPage('matrix');
  await flush(doc);
  const cell = el.querySelectorAll('[data-msrc="src"]')[40];
  doc.pointAt = () => cell.querySelector('button');
  const lfo1 = u.pages.matrix.el.querySelector('[data-src="lfo1"]');
  ptr(lfo1, 'pointerdown', 10, 10); ptr(lfo1, 'pointermove', 30, 30); ptr(lfo1, 'pointerup', 30, 30);
  assert.equal(s().matrix[40].src, 'lfo1');
  // drop onto an LFO point → X / Y menu → new bus with its row
  u.setPage('osc');
  u.selectSrc('lfo1');
  await flush(doc);
  s().lfo[0].pts = [[0, 0, 0], [0.5, 1, 0], [1, 0, 0]];
  const box = u.pages.osc.lfoBox;
  box._rect = { left: 0, top: 200, width: 200, height: 100 };
  doc.pointAt = () => box;
  const velo = el.querySelector('[data-src="velo"]');
  ptr(velo, 'pointerdown', 10, 10); ptr(velo, 'pointermove', 99, 203); ptr(velo, 'pointerup', 99, 203);
  assert.deepEqual(menuLabels(ctxMenus(doc).at(-1)), ['X', 'Y']);
  pick(doc, 'Y');
  assert.deepEqual(s().lfo[0].pts[1], [0.5, 1, 0, 0, 1]);
  assert.ok(s().matrix.some(r => r.src === 'velo' && r.dst === 'bus1' && r.bi === 1 && r.amt === 0.5));
  // Path-type LFOs ignore point links (§5.7): the drop goes to the control under the pointer instead
  u.edit(st => { st.lfo[0].type = 'path'; });
  await flush(doc);
  assert.equal(u.lfoPointAt(99, 203), null);
  u.destroy();
});

// iPad Safari, one finger: pointerdown, then per move pointermove + touchmove (at the touched node); Safari sends
// pointercancel when it starts a native pan (and a touchmove it may still cancel only before that). Event times: the
// fake Ev stamps NOW++; wait(ms) is a finger resting.
test('SerumUI: touch tile drag (iPad Safari) — strip tiles drag up / down at once, sideways scrolls; a quick drop needs a settled target; ghost above the finger, on screen, naming the target; hold + any way; long-press menu; MACROS tiles; one finger; row handle keeps the hold', async (t) => {
  const { doc, u, s } = await mount();
  const el = u.el, strip = u.pages.osc.el.querySelector('.sx-tiles'), res = byDest(el, 'f.res'), m3 = byDest(u.pages.osc.el, 'm3');
  const tileIn = (root, src) => root.querySelectorAll('[data-src="' + src + '"]')[0];
  const T = (n, type, x, y, o = {}) => ptr(n, type, x, y, Object.assign({ pointerType: 'touch', pointerId: 4, button: 0, isPrimary: true }, o));
  const mv = (n, x, y, o) => { T(n, 'pointermove', x, y, o); return fire(n, 'touchmove', { touches: [{ clientX: x, clientY: y }] }); };
  const wait = ms => { NOW += ms; };
  const ghost = () => doc.body.querySelector('.sx-ghost');
  const rows = () => s().matrix.filter(r => r.src).map(r => r.src + '→' + r.dst);
  const resName = core.destLabel('f.res', s(), u.fx());
  doc.pointAt = () => res;
  // a strip tile moved mainly down: the drag starts at once (no hold); the ghost sits above the finger and names the control
  const lfo2 = tileIn(strip, 'lfo2'), env2 = tileIn(strip, 'env2');
  T(lfo2, 'pointerdown', 100, 100);
  assert.equal(mv(lfo2, 101, 104).defaultPrevented, false);                   // undecided: the browser may still scroll
  assert.equal(ghost(), null);
  assert.equal(mv(lfo2, 102, 110).defaultPrevented, true);                    // ours: no page scroll, no pointercancel
  assert.ok(ghost().classList.contains('sx-ghost-touch'));
  assert.equal(ghost().textContent, 'LFO 2 → ' + resName);
  assert.equal(ghost().style.transform, 'translate(82px,50px)');               // centred (40 × 20 box), bottom edge 40 px above
  assert.ok(res.classList.contains('sx-droptgt'));
  doc.pointAt = () => null;
  mv(lfo2, 300, 20);
  assert.equal(ghost().textContent, 'LFO 2');
  assert.equal(ghost().style.transform, 'translate(280px,8px)');               // kept 8 px inside the top
  // a long label at the screen's sides stays whole: measured once its text is set (1440 px viewport)
  ghost()._rect = { left: 0, top: 0, width: 180, height: 30 };
  doc.pointAt = () => res;
  mv(lfo2, 1430, 110);
  assert.equal(ghost().style.transform, 'translate(1252px,40px)');
  mv(lfo2, 10, 110);
  assert.equal(ghost().style.transform, 'translate(8px,40px)');
  // lifted at once (a flick that ends over a control): no drop
  T(lfo2, 'pointerup', 10, 110);
  fire(lfo2, 'click');
  await flush(doc);
  assert.equal(ghost(), null);
  assert.ok(!res.classList.contains('sx-droptgt'));
  assert.deepEqual(rows(), []);
  // rested on a control, then flicked onto another and lifted: no drop either
  T(lfo2, 'pointerdown', 100, 100);
  mv(lfo2, 102, 110);
  wait(150);
  doc.pointAt = () => m3;
  mv(lfo2, 102, 160);
  T(lfo2, 'pointerup', 102, 160);
  assert.deepEqual(rows(), []);
  // rested ≥ 100 ms on the control: the drop counts
  doc.pointAt = () => res;
  T(lfo2, 'pointerdown', 100, 100);
  mv(lfo2, 102, 110);
  wait(120);
  T(lfo2, 'pointerup', 102, 110);
  fire(lfo2, 'click');
  await flush(doc);
  assert.equal(ghost(), null);
  assert.deepEqual(rows(), ['lfo2→f.res']);
  // a sideways swipe on the strip is its native scroll: nothing cancelled, Safari's pointercancel ends it quietly
  T(env2, 'pointerdown', 100, 100);
  assert.equal(mv(env2, 110, 102).defaultPrevented, false);
  T(env2, 'pointercancel', 110, 102);
  assert.equal(ghost(), null);
  assert.deepEqual(rows(), ['lfo2→f.res']);
  // one finger: a second touch (elsewhere, or on another tile) before the drag starts abandons it; a pinch is no drag
  T(env2, 'pointerdown', 100, 100);
  T(doc.body, 'pointerdown', 400, 300, { pointerId: 5, isPrimary: false });
  assert.equal(mv(env2, 100, 120).defaultPrevented, false);
  assert.equal(ghost(), null);
  T(doc.body, 'pointerup', 400, 300, { pointerId: 5, isPrimary: false });
  T(env2, 'pointerup', 100, 120);
  T(lfo2, 'pointerdown', 100, 100);
  T(env2, 'pointerdown', 140, 100, { pointerId: 5, isPrimary: false });
  mv(lfo2, 100, 120); mv(env2, 140, 120, { pointerId: 5, isPrimary: false });
  assert.equal(ghost(), null);
  T(env2, 'pointerup', 140, 120, { pointerId: 5, isPrimary: false });
  T(lfo2, 'pointerup', 100, 120);
  T(env2, 'pointerdown', 100, 100);
  assert.equal(fire(env2, 'touchmove', { touches: [{ clientX: 100, clientY: 112 }, { clientX: 300, clientY: 88 }] }).defaultPrevented, false);
  mv(env2, 100, 112);
  assert.equal(ghost(), null);
  T(env2, 'pointerup', 100, 112);
  assert.deepEqual(rows(), ['lfo2→f.res']);
  // a drag another pointer replaced (a mouse drag, then a finger on another tile) neither moves nor drops for the first
  ptr(lfo2, 'pointerdown', 100, 100);
  ptr(lfo2, 'pointermove', 110, 100);
  assert.equal(ghost().textContent, 'LFO 2');
  doc.pointAt = () => m3;
  T(env2, 'pointerdown', 100, 100);
  mv(env2, 100, 120);
  assert.equal(ghost().textContent, ui.srcLabel(s(), 'env2') + ' → ' + core.destLabel('m3', s(), u.fx()));
  ptr(lfo2, 'pointermove', 120, 100);
  ptr(lfo2, 'pointerup', 120, 100);
  assert.ok(ghost() && m3.classList.contains('sx-droptgt'));                 // the finger's drag goes on
  assert.deepEqual(rows(), ['lfo2→f.res']);
  wait(120);
  T(env2, 'pointerup', 100, 120);
  assert.deepEqual(rows(), ['lfo2→f.res', 'env2→m3']);
  doc.pointAt = () => res;
  // a MACROS-panel tile (the page scrolls vertically, touch-action: pan-y): sideways drags at once, vertical scrolls
  const mac = u.pages.osc.el.querySelectorAll('[data-mactile="2"]').find(n => !strip.contains(n));
  T(mac, 'pointerdown', 100, 100);
  assert.equal(mv(mac, 101, 110).defaultPrevented, false);
  T(mac, 'pointercancel', 101, 110);
  assert.equal(ghost(), null);
  doc.pointAt = () => tileIn(strip, 'macro3');                                 // on another macro: a swap, named
  T(mac, 'pointerdown', 100, 100);
  assert.equal(mv(mac, 110, 101).defaultPrevented, true);
  assert.equal(ghost().textContent, ui.srcLabel(s(), 'macro2') + ' ⇄ ' + ui.srcLabel(s(), 'macro3'));
  doc.pointAt = () => m3;
  mv(mac, 112, 101);
  wait(120);
  T(mac, 'pointerup', 112, 101);
  assert.deepEqual(rows(), ['lfo2→f.res', 'env2→m3', 'macro2→m3']);
  doc.pointAt = () => res;
  // the touch ghost names every drop kind (the finger hides the target)
  assert.deepEqual([{ kind: 'msrc', slot: 4, field: 'src' }, { kind: 'msrc', slot: 0, field: 'aux' }, { kind: 'point', lfo: 1, idx: 2 },
    { kind: 'copyLfo', to: 2 }, { kind: 'lfoWt', o: 1 }, { kind: 'lfoNoise' }, { kind: 'module', m: 'filter2' }, { kind: 'xy' }].map(h => u.hitName(h)),
  ['Slot 5 source', 'Slot 1 aux source', 'LFO 2 point', 'copy to LFO 3', 'OSC B wavetable', 'Noise', 'Filter 2', 'X | Y']);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    // hold 250 ms, then sideways (the strip's own axis) still drags; jitter after the hold starts nothing; no settle needed
    T(env2, 'pointerdown', 100, 100);
    t.mock.timers.tick(260);
    assert.ok(env2.classList.contains('wk-armed'));
    assert.equal(mv(env2, 103, 101).defaultPrevented, true);
    assert.equal(ghost(), null);
    mv(env2, 130, 101);
    assert.ok(ghost());
    T(env2, 'pointerup', 130, 101);
    assert.deepEqual(rows(), ['lfo2→f.res', 'env2→m3', 'macro2→m3', 'env2→f.res']);
    // a still long-press (with jitter) opens the source menu, no drag
    const n0 = ctxMenus(doc).length;
    T(lfo2, 'pointerdown', 100, 100);
    t.mock.timers.tick(250);
    mv(lfo2, 101, 102);
    t.mock.timers.tick(260);
    assert.equal(ctxMenus(doc).length, n0 + 1);
    assert.deepEqual(menuLabels(ctxMenus(doc).at(-1)), ['Bypass All Destinations', 'Remove All Destinations']);
    assert.ok(!lfo2.classList.contains('wk-armed'));
    mv(lfo2, 101, 200);
    T(lfo2, 'pointerup', 101, 200);
    assert.equal(ghost(), null);
    fire(ctxMenus(doc).at(-1), 'keydown', { key: 'Escape' });
    assert.equal(ctxMenus(doc).length, n0);
    // a drag that starts inside the long-press's 8 px: the long-press opens no menu under the dragging finger
    const n1 = ctxMenus(doc).length;
    doc.pointAt = () => null;
    T(lfo2, 'pointerdown', 100, 100);
    mv(lfo2, 100, 107);
    assert.ok(ghost());
    t.mock.timers.tick(600);
    assert.equal(ctxMenus(doc).length, n1);
    assert.ok(ghost());
    T(lfo2, 'pointerup', 100, 107);
    assert.equal(ghost(), null);
    // module labels keep the hold (touch-action: none, a long-press menu); their ghost goes above the finger, naming the target
    const oscA = el.querySelectorAll('[data-modlabel]').find(n => n.getAttribute('data-modlabel') === 'oscA');
    doc.pointAt = () => res;
    T(oscA, 'pointerdown', 100, 100);
    mv(oscA, 100, 130);
    assert.equal(ghost(), null);
    T(oscA, 'pointerup', 100, 130);
    T(oscA, 'pointerdown', 100, 100);
    t.mock.timers.tick(300);
    mv(oscA, 100, 130);
    assert.ok(ghost().classList.contains('sx-ghost-touch'));
    assert.equal(ghost().textContent, 'Modulate · ' + ui.srcLabel(s(), 'osca') + ' → ' + resName);
    assert.equal(ghost().style.transform, 'translate(80px,70px)');
    T(oscA, 'pointercancel', 100, 130);
    assert.equal(ghost(), null);
  } finally { t.mock.timers.reset(); }
  u.edit(st => { st.matrix[10] = row({ src: 'velo', amt: 0.2, dst: 'a.pan' }); });
  u.setPage('matrix');
  await flush(doc);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    // the MATRIX row handle keeps the hold: a swipe over the grips (the list scrolls) reorders nothing
    const mrows = () => u.pages.matrix.el.querySelectorAll('.sx-mrow'), h = mrows()[10].querySelector('.sx-mh');
    doc.pointAt = () => mrows()[1].querySelector('.sx-mn');
    T(h, 'pointerdown', 5, 5);
    assert.equal(mv(h, 5, 16).defaultPrevented, false);
    T(h, 'pointerup', 5, 16);
    assert.ok(!mrows()[1].classList.contains('sx-dropline'));
    assert.equal(s().matrix[10].src, 'velo');
    T(h, 'pointerdown', 5, 5);
    t.mock.timers.tick(260);
    assert.equal(mv(h, 5, 12).defaultPrevented, true);
    assert.ok(mrows()[1].classList.contains('sx-dropline'));
    T(h, 'pointerup', 5, 12);
    assert.equal(s().matrix[1].src, 'velo');
  } finally { t.mock.timers.reset(); }
  // CSS: no iOS callout on the tiles / labels; MACROS tiles pan the page vertically (and pinch-zoom where supported);
  // the touch ghost wraps within the screen
  const R = cssRules();
  assert.match(R.find(r => r.sel === '.sx-tile').body, /-webkit-touch-callout:\s*none/);
  assert.match(R.find(r => r.sel === '.sx-tname').body, /-webkit-touch-callout:\s*none/);
  assert.match(R.find(r => r.sel === '.sx-macro .sx-tile').body, /touch-action:\s*pan-y;\s*touch-action:\s*pan-y pinch-zoom/);
  assert.match(R.find(r => r.sel === '.sx-tiles').body, /touch-action:\s*pan-x/);
  assert.match(R.find(r => r.sel === '.sx-ghost.sx-ghost-touch').body, /max-width:\s*min\(360px, calc\(100vw - 16px\)\)/);
  u.destroy();
});

test('SerumUI: halos and live dots from snapshots (eff by vi), voice counter, output meter, phase capture (S1 knob ends, S2 Per Voice)', async () => {
  const { doc, host, u, s } = await mount();
  u.edit(st => { st.matrix[0] = row({ src: 'lfo1', amt: 0.4, dst: 'a.wt' }); st.p['c.phase'] = 1; st.p['c.rand'] = 0.5; st.p['a.phase'] = 1; st.p['a.rand'] = 0.5; });
  await flush(doc);
  const wtk = byDest(u.el, 'a.wt');
  assert.ok(wtk.classList.contains('wk-modded'));
  const eff = new Float32Array(core.NSV + 8);
  eff[core.vi('a.wt')] = 0.3;
  const memNow = new Float32Array(48).fill(0.25);
  const mix = new Float32Array(11).fill(-Infinity);
  mix[9] = -6;
  u.setSnapshot({ s: { eff, notes: 1, oscVoices: 3, maxVoices: 136, memNow, mix, lfoPh: new Float32Array(10), envStage: new Uint8Array(4), envT: new Float32Array(4) }, gr: null, fxph: null });
  await flush(doc);
  assert.notEqual(wtk.querySelector('.wk-live').getAttribute('display'), 'none');
  assert.equal(u.vcEl.textContent, '3 / 136');
  assert.equal(u.meter.levels()[0], -6);
  // S2 mode (default): PHASE 360° + RAND 100 % is an ordinary setting — no knob-end capture on any oscillator (§6.4)
  assert.equal(s().global.s1, 0);
  const set0 = s().osc.map(O => O.memSet.slice());
  fire(byDest(u.el, 'c.rand'), 'keydown', { key: 'End' });
  fire(byDest(u.el, 'a.rand'), 'keydown', { key: 'End' });
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
  fire(byDest(u.el, 'a.rand'), 'keydown', { key: 'End' });
  fire(byDest(u.el, 'c.rand'), 'keydown', { key: 'End' });
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
  const on = id => (s().p[id] >= 0.5 ? 1 : 0);
  assert.equal(u.vcEl.textContent, '0 / ' + (8 * (16 * (on('a.on') + on('b.on') + on('c.on')) + on('s.on') + on('n.on'))));   // POLY × the oscillators that are on
  u.destroy();
});

test('SerumUI: MATRIX page — 64 rows, Alt-click reassign / INV bypass, row menu, handle drag, ≈ and red rows, OUT, header menu', async () => {
  const { doc, host, u, s } = await mount();
  u.edit(st => { st.matrix[0] = row({ src: 'lfo1', amt: 0.4, dst: 'a.wt' }); st.matrix[4] = row({ src: 'lfo1', amt: 0.1, dst: 'f.cutoff' }); });
  u.setPage('matrix');
  await flush(doc);
  const rows = () => u.pages.matrix.el.querySelectorAll('.sx-mrow');
  assert.equal(rows().length, 64);
  assert.equal(rows()[0].classList.contains('sx-dim'), false);
  assert.equal(rows()[1].classList.contains('sx-dim'), true);
  fire(u.el.querySelector('[data-malt="src"][data-slot="0"]').querySelector('button'), 'click', { altKey: true, clientX: 5, clientY: 5 });
  pick(doc, 'Envelopes');
  pick(doc, 'Env 3');
  assert.deepEqual([s().matrix[0].src, s().matrix[4].src], ['env3', 'env3']);
  const inv = () => u.el.querySelector('[data-malt="mode"][data-slot="4"]').querySelector('button');
  fire(inv(), 'click', { altKey: true });
  assert.equal(s().matrix[4].byp, 1);
  fire(inv(), 'click');
  assert.equal(s().matrix[4].inv, 1);
  const handle = r => rows()[r].querySelector('.sx-mh');
  fire(handle(4), 'click');
  assert.deepEqual(menuLabels(ctxMenus(doc).at(-1)), ['Edit Custom Curve', 'Clear', 'Duplicate', 'Move Up', 'Move Down']);
  pick(doc, 'Duplicate');
  assert.deepEqual(s().matrix[1], s().matrix[4]);
  // drag a row's handle onto another row: the row moves there
  u.edit(st => { st.matrix[10] = row({ src: 'velo', amt: 0.2, dst: 'a.pan' }); });
  await flush(doc);
  doc.pointAt = () => rows()[2].querySelector('.sx-mn');
  ptr(handle(10), 'pointerdown', 5, 5); ptr(handle(10), 'pointermove', 5, 40); ptr(handle(10), 'pointerup', 5, 40);
  assert.equal(s().matrix[2].src, 'velo');
  assert.equal(s().matrix[5].dst, 'f.cutoff');                            // the rows between shifted down
  // ≈ on rows aimed at the other mode's field of an S1 pair; red rows for deleted FX destinations
  u.edit(st => { st.matrix[20] = row({ src: 'lfo2', amt: 0.3, dst: 'a.warpMode' }); st.matrix[21] = row({ src: 'lfo2', amt: 0.3, dst: 'fx.zz.mix' }); });
  await flush(doc);
  assert.equal(rows()[20].querySelector('.sx-alias').classList.contains('sx-hidden'), false);
  assert.equal(rows()[0].querySelector('.sx-alias').classList.contains('sx-hidden'), true);
  assert.ok(rows()[21].classList.contains('sx-bad'));
  u.edit(st => { st.global.s1 = 1; });
  await flush(doc);
  assert.equal(rows()[20].querySelector('.sx-alias').classList.contains('sx-hidden'), true);
  // OUT: the live row output of the recent voice (snapshot.mOut)
  const mOut = new Float32Array(64);
  mOut[0] = -0.5;
  u.setSnapshot({ s: { notes: 1, mOut }, gr: null, fxph: null });
  await flush(doc);
  const bar = rows()[0].querySelector('.sx-mout-g').querySelector('i');
  assert.equal(bar.style.width, '25%');
  assert.equal(bar.style.left, '25%');
  // CRV double-click opens the Editable Curve popover; the aux CRV drags
  fire(rows()[0].querySelector('.sx-mcrv').firstChild, 'dblclick');
  assert.equal(gxStub.made.at(-1).o.kind, 'mcurve');
  u.pop.close();
  // header menu
  const mb = u.pages.matrix.el.querySelectorAll('button').find(b => b.getAttribute('aria-label') === 'Matrix menu');
  fire(mb, 'click');
  assert.deepEqual(menuLabels(ctxMenus(doc).at(-1)), ['Sort by Source', 'Sort by Destination', 'Lock Matrix', '', 'Create Vibrato', 'Create Velo->Amp', '',
    'Apply and Delete Macros', 'Init Modulations']);
  pick(doc, 'Lock Matrix');
  assert.ok(s().locks.mod.includes('matrix'));
  u.edit(st => { st.matrix[30] = row({ src: 'lfo5', amt: 0.1, dst: 'a.pan' }); st.matrix[31] = row({ src: 'env4', amt: 0.1, dst: 'a.pan' }); });
  fire(mb, 'click');
  pick(doc, 'Sort by Source');
  const order = s().matrix.filter(r => r.src).map(r => r.src);
  assert.deepEqual(order.slice(0, 3), ['env3', 'env3', 'env3']);
  assert.ok(order.indexOf('env4') < order.indexOf('lfo2') && order.indexOf('lfo2') < order.indexOf('lfo5'));
  u.edit(st => { st.p['a.level'] = 0.5; st.macros[1].v = 0.5; st.matrix[60] = row({ src: 'macro2', amt: 0.4, dst: 'a.level' }); });
  fire(mb, 'click');
  pick(doc, 'Apply and Delete Macros');
  fire(u.el.querySelector('.sx-dlg').querySelectorAll('button').find(b => b.textContent === 'OK'), 'click');
  near(s().p['a.level'], 0.7, 1e-6);
  assert.equal(s().matrix.some(r => r.src === 'macro2'), false);
  fire(mb, 'click');
  pick(doc, 'Init Modulations');
  fire(u.el.querySelector('.sx-dlg').querySelectorAll('button').find(b => b.textContent === 'OK'), 'click');
  assert.equal(s().matrix.filter(r => r.src).length, 0);
  // remove ✕ clears a row
  u.edit(st => { st.matrix[7] = row({ src: 'lfo1', amt: 0.2, dst: 'a.pan' }); });
  await flush(doc);
  fire(rows()[7].querySelector('.sx-mx-x').querySelector('button'), 'click');
  assert.equal(s().matrix[7].src, '');
  void host;
  u.destroy();
});

test('SerumUI: main menu v2 (§13.12) — Init Preset resets every lock, Resample ▸, MPE items, tuning, default preset', async () => {
  const { doc, host, u, s } = await mount();
  const menuBtn = u.el.querySelectorAll('.sx-hbtn').find(b => b.textContent === 'Menu');
  fire(menuBtn, 'click');
  assert.deepEqual(menuLabels(ctxMenus(doc)[0]), ['About', '', 'Init Preset', 'Init LFOs + LFO Mods', 'Init Modulations', 'Load Preset…', 'Revert to Saved',
    'Save as Default Preset', 'Import Preset Pack…', '', 'Render OSC A Warp', 'Resample to', '', 'Load Tuning…', 'MPE Enabled',
    'MPE: XYZ → Macro 1, 2, 3', 'MPE: YZ → Macro 1, 2', 'MPE: Y → Mod Wheel', 'MPE Bend Range', '', 'Lock FX Rack', 'Load Effect Chain…',
    'Save Effect Chain…', '', 'Velo->Amp', 'Vibrato quick-assign']);
  pick(doc, 'Velo->Amp');
  assert.ok(s().matrix.some(r => r.src === 'fixed' && r.dst === 'g.amp' && r.aux === 'velo' && r.inv === 1));
  fire(menuBtn, 'click');
  pick(doc, 'Resample to');
  pick(doc, 'A and B (Stereo)');
  u.uiEdit(st => { st.ui.osc = 2; });
  fire(menuBtn, 'click');
  assert.ok(menuLabels(ctxMenus(doc).at(-1)).includes('Render OSC C Warp'));
  pick(doc, 'Resample to');
  pick(doc, 'Selected Osc (OSC C)');
  assert.deepEqual(host.log.filter(x => x[0] === 'resample'), [['resample', 'AB'], ['resample', 'C']]);
  fire(menuBtn, 'click');
  pick(doc, 'Render OSC C Warp');
  assert.deepEqual(oscStub.calls.filter(c => c[0] === 'renderOscWarp').at(-1), ['renderOscWarp', 2]);
  // MPE
  fire(menuBtn, 'click'); pick(doc, 'MPE Enabled');
  fire(menuBtn, 'click'); pick(doc, 'MPE: YZ → Macro 1, 2');
  fire(menuBtn, 'click'); pick(doc, 'MPE Bend Range'); pick(doc, '24 semitones');
  assert.deepEqual(s().global.mpe, { on: 1, bend: 24, xyz: 2 });
  fire(menuBtn, 'click'); pick(doc, 'MPE: YZ → Macro 1, 2');
  assert.equal(s().global.mpe.xyz, 0);                                      // a checked mapping toggles off
  // Load Tuning… (host.tuningFile), Save as Default Preset, Lock FX Rack
  fire(menuBtn, 'click'); pick(doc, 'Load Tuning…');
  await flush(doc);
  assert.equal(s().global.tun.name, '19-EDO');
  assert.equal(s().global.tun.kind, 'scl');
  assert.equal(s().global.tun.tab.length, 128);
  fire(menuBtn, 'click'); pick(doc, 'Save as Default Preset');
  const def = host.store.get(ui.DEFAULT_KEY);
  assert.equal(def.v.s.global.tun.name, '19-EDO');
  assert.equal(def.v.s.ui, undefined);
  fire(menuBtn, 'click'); pick(doc, 'Lock FX Rack');
  assert.equal(host.st.fx.lock, 1);
  // Init Preset (initPreset): everything incl. every lock reset; the page stays; the FX rack lock too
  u.setPage('matrix');
  u.edit(st => { st.p['f.cutoff'] = 0.9; st.locks.p.push('f.cutoff'); st.locks.mod.push('oscA'); st.locks.misc.os = 1; });
  fire(menuBtn, 'click'); pick(doc, 'Init Preset');
  assert.equal(s().p['f.cutoff'], fresh().p['f.cutoff']);
  assert.deepEqual([s().locks.p, s().locks.mod, s().locks.misc.os], [[], [], 0]);
  assert.equal(s().ui.page, 'matrix');
  assert.ok(host.st.fx.v === 2 && host.st.fx.racks.every(R => R.lock === 0), 'the v2 default rack, unlocked (RULINGS2 F1)');
  assert.equal(u.dirty, false);
  assert.match(u.el.querySelector('.sx-pname').textContent, /Init/);
  // Revert to Saved reloads the current preset
  fire(menuBtn, 'click'); pick(doc, 'Revert to Saved');
  assert.deepEqual(host.log.filter(x => x[0] === 'load').at(-1), ['load', 'f:1']);
  u.destroy();
});

/* ================================================================ M2: GLOBAL page, preset browser v2, undo, touch, header, pages */
const panelOf = (root, title) => root.querySelectorAll('.sx-panel').find(p => p.getAttribute('aria-label') === title) || null;
const btnIn = (root, aria) => root.querySelectorAll('button').find(b => b.getAttribute('aria-label') === aria) || null;
const segIn = (root, label, text) => root.querySelectorAll('[role="radiogroup"]').find(g => g.getAttribute('aria-label') === label)
  .querySelectorAll('button').find(b => b.textContent === text);
const spin = (root, label) => root.querySelectorAll('[role="spinbutton"]').find(n => n.getAttribute('aria-label') === label) || null;
const okDialog = (u, label = 'OK') => fire(u.el.querySelector('.sx-dlg').querySelectorAll('button').find(b => b.textContent === label), 'click');
const noUi = st => JSON.stringify(Object.assign({}, st, { ui: undefined }));

test('SerumUI: GLOBAL page (§13.10) — QUALITY, S1 Compatibility Mode, TUNING, MPE, VOICE CONTROL, UNISON, CHAOS', async () => {
  const { doc, host, u, s } = await mount();
  u.setPage('global');
  await flush(doc);
  const G = u.pages.global.el;
  assert.deepEqual(G.querySelectorAll('.sx-panel').map(p => p.getAttribute('aria-label')),
    ['QUALITY', 'TUNING', 'MPE', 'VOICE CONTROL', 'UNISON A', 'UNISON B', 'UNISON C', 'CHAOS (S1)', 'PREFERENCES', 'INFO']);
  // QUALITY: Draft / High / Ultra (global.os 1 / 2 / 4) + lock, effective rate (snapshot tapRate, else the factor)
  const Q = panelOf(G, 'QUALITY');
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
  // TUNING: A4 field (400–480) + lock, TUN FILE menu (host.tuningFile), MTS-ESP disabled (deviation 1)
  const T = panelOf(G, 'TUNING');
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
  // MPE: enabled, bend range 1–96, XYZ mapping (radio + off)
  const M = panelOf(G, 'MPE');
  fire(btnIn(M, 'MPE Enabled'), 'click');
  fire(spin(M, 'BEND RANGE'), 'keydown', { key: 'End' });
  fire(segIn(M, 'MPE expression mapping', 'YZ→M1,2'), 'click');
  assert.deepEqual(s().global.mpe, { on: 1, bend: 96, xyz: 2 });
  fire(spin(M, 'BEND RANGE'), 'keydown', { key: 'Home' });
  fire(segIn(M, 'MPE expression mapping', 'Off'), 'click');
  assert.deepEqual(s().global.mpe, { on: 1, bend: 1, xyz: 0 });
  // VOICE CONTROL: oscillator toggles, length, step grid, RANDOM / SCALING knobs, LFO scaling mode in the knob menu, presets
  const V = panelOf(G, 'VOICE CONTROL');
  fire(btnIn(V, 'N'), 'click');
  assert.deepEqual(s().vc.sel, [1, 1, 1, 0, 1]);
  fire(spin(V, 'LENGTH'), 'keydown', { key: 'ArrowUp' });
  assert.equal(s().vc.len, 2);
  const cell = V.querySelector('.wk-sg').querySelectorAll('[tabindex="0"]')[0];
  fire(cell, 'keydown', { key: 'ArrowUp' });
  assert.equal(s().vc.steps[0][0], 0.05);
  for (const id of ['vc.pan', 'vc.det', 'vc.cut', 'vc.env', 'vc.escale', 'vc.lscale']) assert.ok(byDest(V, id), id);
  fire(byDest(V, 'vc.lscale'), 'contextmenu', { clientX: 5, clientY: 5 });
  assert.deepEqual(menuLabels(ctxMenus(doc).at(-1)).slice(0, 3), ['By Percentage', 'By Rate', '']);
  assert.ok(menuLabels(ctxMenus(doc).at(-1)).includes('Mod Source'));          // the knob menu stays (drop target, MIDI)
  pick(doc, 'By Rate');
  assert.equal(s().vc.lmode, 1);
  const vcp = V.querySelectorAll('button').find(b => /^PRESET:/.test(b.textContent));
  fire(vcp, 'click');
  pick(doc, 'Factory');
  pick(doc, 'Analog Drift');
  const AD = core.FACTORY_VC.find(x => x.name === 'Analog Drift');
  assert.equal(s().vc.name, 'Analog Drift');
  assert.deepEqual(['vc.pan', 'vc.det', 'vc.cut', 'vc.env'].map(id => s().p[id]), ['vc.pan', 'vc.det', 'vc.cut', 'vc.env'].map(id => AD.p[id]));
  u.edit(st => { st.p['vc.pan'] = 0.4; });
  fire(vcp, 'click');
  pick(doc, 'Save…');
  u.el.querySelector('.sx-dlg').querySelector('input').value = 'Mine';
  okDialog(u);
  assert.deepEqual(host.store.get(ui.VC_KEY).map(x => [x.name, x.p['vc.pan']]), [['Mine', 0.4]]);
  fire(vcp, 'click');
  pick(doc, 'Init');
  assert.equal(s().p['vc.pan'], fresh().p['vc.pan']);
  assert.deepEqual(s().vc.steps, fresh().vc.steps);
  fire(vcp, 'click');
  pick(doc, 'User');
  pick(doc, 'Mine');
  assert.equal(s().p['vc.pan'], 0.4);
  // UNISON A / B / C (the gear popovers' contents)
  const UA = panelOf(G, 'UNISON B');
  fire(spin(UA, 'RANGE'), 'keydown', { key: 'ArrowUp' });
  assert.equal(s().osc[1].uni.range, 2.01);
  // CHAOS (S1): shown in S1 mode or while a chaos source is used; Convert to Chaos LFOs (deviation 22)
  const CH = panelOf(G, 'CHAOS (S1)');
  await flush(doc);
  assert.ok(CH.classList.contains('sx-hidden'));
  u.edit(st => { st.matrix[3] = row({ src: 'chaos1', amt: 0.5, dst: 'a.wt' }); });
  await flush(doc);
  assert.equal(CH.classList.contains('sx-hidden'), false);
  fire(CH.querySelectorAll('button').find(b => b.textContent === 'Convert to Chaos LFOs'), 'click');
  okDialog(u);
  assert.equal(s().matrix[3].src, 'lfo1');
  assert.equal(s().lfo[0].type, 'rossler');
  await flush(doc);
  assert.ok(CH.classList.contains('sx-hidden'));
  u.destroy();
});

test('SerumUI: GLOBAL preferences (§13.10) persist app-wide, call host.prefsChanged; Help tooltips off strips the help texts', async () => {
  const { doc, host, u } = await mount();
  u.setPage('global');
  await flush(doc);
  const P = panelOf(u.pages.global.el, 'PREFERENCES');
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
  // a new panel (another track) starts from the stored preferences
  const v = u.prefs;
  u.destroy();
  const m2 = await mount(null, h => { h.store.set(ui.PREFS_KEY, v); });
  assert.deepEqual(m2.u.prefs, v);
  // Help tooltips off: every help text (title) of the panel moves to data-help; on: back
  const titled = () => m2.u.el.querySelectorAll('[title]').length;
  assert.ok(titled() > 20);
  m2.u.setPage('global');
  await flush(m2.doc);
  fire(btnIn(panelOf(m2.u.pages.global.el, 'PREFERENCES'), 'Help tooltips'), 'click');
  await flush(m2.doc);
  assert.equal(titled(), 0);
  assert.ok(m2.u.el.querySelectorAll('[data-help]').length > 20);
  m2.u.setPage('matrix');
  await flush(m2.doc);
  assert.equal(titled(), 0);                                                 // pages built later too
  m2.u.setPage('global');
  await flush(m2.doc);
  fire(btnIn(panelOf(m2.u.pages.global.el, 'PREFERENCES'), 'Help tooltips'), 'click');
  await flush(m2.doc);
  assert.equal(m2.u.el.querySelectorAll('[data-help]').length, 0);
  assert.ok(titled() > 20);
  m2.u.destroy();
});

test('PresetBrowser v2 (§13.11): preview + macros, auto-preview, ratings, tags, metadata, keys 7 / 8 / 9, Shift-Backspace', async () => {
  const macros = [];
  const { doc, host, u, s } = await mount({ previewMacros: v => macros.push(v) }, h => {
    h.presets.setMeta = (k, patch) => { h.log.push(['setMeta', k, patch]); const p = h.presets.list().find(x => x.key === k); Object.assign(p, patch); };
  });
  fire(btnIn(u.head, 'Preset Deep Bass, browse presets'), 'click');
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

test('SerumUI: panel undo / redo (§13.2.4) — header buttons, Cmd/Ctrl-Z, Shift-Cmd/Ctrl-Z, coalescing, FX state; Alt-F', async () => {
  const { doc, host, u, s } = await mount();
  const [ub, rb] = u.head.querySelector('.sx-undo').querySelectorAll('button');
  await flush(doc);
  assert.equal(ub.disabled, true);
  const def = s().p['f.cutoff'];
  fire(byDest(u.el, 'f.cutoff'), 'keydown', { key: 'End' });
  await flush(doc);
  assert.equal(s().p['f.cutoff'], 1);
  assert.equal(ub.disabled, false);
  fire(ub, 'click');
  assert.equal(s().p['f.cutoff'], def);
  assert.ok(host.log.some(x => x[0] === 'edit' && x[1] === 'Undo'));
  await flush(doc);
  assert.equal(rb.disabled, false);
  fire(rb, 'click');
  assert.equal(s().p['f.cutoff'], 1);
  // Cmd/Ctrl-Z and Shift-Cmd/Ctrl-Z on the panel
  fire(byDest(u.el, 'f.res'), 'keydown', { key: 'z', metaKey: true });
  assert.equal(s().p['f.cutoff'], def);
  fire(byDest(u.el, 'f.res'), 'keydown', { key: 'Z', ctrlKey: true, shiftKey: true });
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
  // the view (page, selections) survives an undo
  u.setPage('matrix');
  u.undoRedo(true);
  assert.equal(s().ui.page, 'matrix');
  assert.equal(host.st.fx.lock, 1);
  // Alt/Option-F expands the matrix; the Keyboard shortcuts preference gates the keys
  fire(u.pages.matrix.el.querySelector('.sx-mrow').querySelector('.sx-mn'), 'keydown', { key: 'ƒ', code: 'KeyF', altKey: true });
  assert.ok(u.pages.matrix.el.classList.contains('sx-mxexp'));
  u.setPref('keys', 0);
  fire(byDest(u.el, 'g.master'), 'keydown', { key: 'z', metaKey: true });
  assert.equal(host.st.fx.lock, 1);
  u.destroy();
});

test('SerumUI: touch first-class (§13.1) — touch mode, status-line tooltips, modifier latches, double-tap typed entry', async () => {
  const { doc, host, u, s } = await mount();
  assert.equal(u.el.classList.contains('sx-touch'), false);
  const wave = u.head.querySelector('.sx-wave');
  assert.equal(wave.draggable, true);
  const k = byDest(u.el, 'f.cutoff');
  ptr(k, 'pointerdown', 10, 10, { pointerType: 'touch' });
  assert.ok(u.el.classList.contains('sx-touch'));
  assert.equal(wave.draggable, false);                                       // touch: no HTML drag on the wave icon
  assert.match(u.statusEl.textContent, /^Filter Cutoff: /);                // no hover on touch: the status line
  ptr(k, 'pointerup', 10, 10, { pointerType: 'touch' });
  assert.match(u.statusEl.textContent, /^Filter Cutoff: /);                // stays a moment after the touch ends
  const tile = u.el.querySelector('[data-src="lfo1"]');
  ptr(tile, 'pointerdown', 10, 10, { pointerType: 'touch' });
  assert.match(u.statusEl.textContent, /^LFO 1\nDrag onto a control/);
  ptr(tile, 'pointerup', 10, 10, { pointerType: 'touch' });
  // the modifier bar (header): Alt latched → the next gesture is an Alt gesture (wave icon: the Renders menu)
  const bar = u.head.querySelector('.sx-mkeys');
  fire(bar.querySelector('[data-mod="alt"]'), 'click');
  fire(wave, 'click');
  assert.deepEqual(menuLabels(ctxMenus(doc).at(-1)), ['Renders → OSC A', '', 'Render 1']);
  assert.equal(host.log.some(x => x[0] === 'renderLast'), false);
  assert.equal(wkm.modifierBar.mods({}).alt, false);                          // the latch was consumed
  // numField: double-tap = typed entry (decimal keypad)
  u.setPage('global');
  await flush(doc);
  const a4 = spin(u.pages.global.el, 'A4 (Hz)');
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

test('SerumUI: header wave icon (§13.2.5) — render, Shift = preset JSON, Alt = Renders folder, drag acts as a click', async () => {
  const { doc, host, u, s } = await mount();
  const wave = u.head.querySelector('.sx-wave');
  fire(wave, 'click');
  assert.deepEqual(host.log.filter(x => x[0] === 'renderLast'), [['renderLast', { shift: false }]]);
  assert.ok(host.log.some(x => x[0] === 'notify' && x[1] === 'Rendering…'));
  fire(wave, 'click', { shiftKey: true });
  assert.deepEqual(host.log.filter(x => x[0] === 'renderLast').at(-1), ['renderLast', { shift: true }]);
  const ds = fire(wave, 'dragstart');
  assert.equal(ds.defaultPrevented, true);                                  // no render to hand over: the drag acts as a click
  assert.equal(host.log.filter(x => x[0] === 'renderLast').length, 3);
  fire(wave, 'click');                                                       // the click that ends that drag renders nothing more
  assert.equal(host.log.filter(x => x[0] === 'renderLast').length, 3);
  // Alt: the Renders folder of the sample store → the selected oscillator plays it as a Sample
  u.uiEdit(st => { st.ui.osc = 1; });
  fire(wave, 'click', { altKey: true });
  assert.deepEqual(menuLabels(ctxMenus(doc).at(-1)), ['Renders → OSC B', '', 'Render 1']);
  pick(doc, 'Render 1');
  assert.deepEqual([s().osc[1].type, s().osc[1].smp], ['sample', 'smp:r1']);
  u.destroy();
  // nothing played yet: the host rejects → its message; no renderLast → a notice
  const m2 = await mount({ renderLast: () => Promise.reject(new Error('Play a note first')) });
  fire(m2.u.head.querySelector('.sx-wave'), 'click');
  await flush(m2.doc);
  assert.ok(m2.host.log.some(x => x[0] === 'notify' && x[1] === 'Play a note first'));
  m2.u.destroy();
  const m3 = await mount({ renderLast: undefined });
  fire(m3.u.head.querySelector('.sx-wave'), 'click');
  assert.ok(m3.host.log.some(x => x[0] === 'notify' && x[1] === 'Rendering is not available'));
  m3.u.destroy();
  // a host that hands the render back ({name, blob}): a desktop drag offers it through DownloadURL (deviation 21) while
  // it is the render of the current note group and patch; a newer note group or an edit makes the drag a click again
  let n = 0;
  const m4 = await mount({ renderLast: o => { n++; return Promise.resolve(o.shift ? undefined : { name: 'Lead C3', blob: new Blob(['RIFF'], { type: 'audio/wav' }) }); } });
  const W = m4.u.head.querySelector('.sx-wave'), dt = () => { const d = { data: {}, setData(k, v) { this.data[k] = v; } }; return d; };
  m4.u.setSnapshot({ s: { notes: 1 } });
  await flush(m4.doc);
  fire(W, 'click');
  await flush(m4.doc);
  assert.equal(n, 1);
  let T = dt(), e = fire(W, 'dragstart', { dataTransfer: T });
  assert.equal(e.defaultPrevented, false);
  assert.match(T.data.DownloadURL, /^audio\/wav:Lead C3\.wav:blob:/);
  assert.equal(n, 1);
  m4.u.setSnapshot({ s: { notes: 0 } });
  m4.u.setSnapshot({ s: { notes: 2 } });                                    // a new note group: the kept render is stale
  T = dt(); e = fire(W, 'dragstart', { dataTransfer: T });
  assert.equal(e.defaultPrevented, true);
  assert.equal(T.data.DownloadURL, undefined);
  assert.equal(n, 2);
  await flush(m4.doc);
  m4.u.setN('a.level', 0.2, 'set');                                         // an edit: stale as well
  T = dt(); e = fire(W, 'dragstart', { dataTransfer: T });
  assert.equal(e.defaultPrevented, true);
  m4.u.destroy();
});

test('SerumUI: MIX (sx-ui-mix on demand), FX (FXRackUI v2: 3 racks, IRs), ARP / CLIP (sx-ui-seq) pages through the kit; LFO PHASE snap', async () => {
  const { doc, host, u, s } = await mount();
  u.setPage('mix');
  await u.mixReady;
  await flush(doc);
  const mix = mixStub.made.at(-1);
  assert.ok(u.pages.mix.el.contains(mix.el));
  assert.equal(mix.kit, u.kit);
  assert.ok(byDest(u.pages.mix.el, 'g.bus1v'));
  assert.ok(u.pages.mix.el.querySelector('.sx-tiles') && u.pages.mix.el.querySelector('.sx-rowC'));   // row B / C as OSC
  u.setPage('fx');
  await flush(doc);
  const rack = fxStub.made.at(-1);
  assert.deepEqual(rack.opts, { embedded: true, dsp: null, racks: 3, mod: true });
  assert.equal(rack.host.racks(), 3);
  assert.equal(rack.host.irs, host.smp);
  rack.host.editFx(f => { f.lock = 1; }, { label: 'Rack lock' });
  assert.equal(host.st.fx.lock, 1);
  // RULINGS2 U3: the rack's control-specific items lead serum-ui's knob menu of an FX control (mod: true)
  const LLC = { label: 'Limiter Latency Comp (no host latency in a browser)', disabled: true };
  rack.extras = id => (id === 'fx.cmp.ratio' ? [LLC] : []);
  assert.deepEqual(u.extraKnobItems('fx.cmp.ratio'), [LLC]);
  assert.deepEqual(u.extraKnobItems('fx.cmp.thr'), []);
  assert.deepEqual(u.extraKnobItems('a.level'), []);
  // ARP / CLIP: the sub-pages get the kit; the macros pane toggles
  for (const p of ['arp', 'clip']) {
    u.setPage(p);
    await flush(doc);
    const pg = seqStub.made.filter(x => x instanceof (p === 'arp' ? seqStub.ArpPage : seqStub.ClipPage)).at(-1);
    assert.equal(pg.kit, u.kit);
    assert.ok(u.pages[p].el.contains(pg.el));
    const mac = panelOf(u.pages[p].el, 'MACROS');
    assert.ok(mac.classList.contains('sx-hidden'));
    fire(btnIn(u.pages[p].el, 'MACROS'), 'click');
    await flush(doc);
    assert.equal(mac.classList.contains('sx-hidden'), false);
    assert.equal(mac.querySelectorAll('[data-mactile]').length, 8);
  }
  fire(byDest(u.pages.arp.el, 'arp.rate'), 'keydown', { key: 'End' });
  assert.equal(s().arp.slots[s().arp.sel].n.rate, 1);                       // virtual destination: the selected slot's base
  // LFO PHASE ✓ Snap to Grid: multiples of 360 / lfoGrid.x degrees while dragging
  u.setPage('osc');
  u.selectSrc('lfo2');
  await flush(doc);
  u.edit(st => { st.lfoGrid = { x: 4, y: 4 }; });
  fire(byDest(u.el, 'l2.phase'), 'contextmenu', { clientX: 5, clientY: 5 });
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

/* ================================================================ review round (U1): regressions of the verified findings */
// the panel's stylesheet (the CSS template of serum-ui.js) as [{cond, sel, body}] rules; cond = the enclosing at-rule
function cssRules() {
  const src = readFileSync(fileURLToPath(new URL('serum-ui.js', ROOT)), 'utf8');
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
const minW = cond => { const m = /\(min-width:\s*(\d+)px\)/.exec(cond); return m ? +m[1] : 0; };

test('review: CSS — narrow-layout hide rules never out-rank the wide layout (OSC B / C, Filter 2); row C; full-screen editors; 44 px touch targets', () => {
  const R = cssRules();
  // the one-panel-at-a-time rules (specificity 0,4,0) live only below the widths that show every panel (§13.2)
  const hideO = R.filter(r => /\.sx-opan:not\(/.test(r.sel) && /display:\s*none/.test(r.body));
  const hideF = R.filter(r => /\.sx-fpan:not\(/.test(r.sel) && /display:\s*none/.test(r.body));
  assert.equal(hideO.length, 3);
  assert.equal(hideF.length, 2);
  const cols3 = R.find(r => r.sel === '.sx-colO' && /repeat\(3,/.test(r.body)), tabsF = R.find(r => r.sel === '.sx-colF > .sx-ptabs' && /display:\s*none/.test(r.body));
  assert.equal(minW(cols3.cond), 1100);
  assert.equal(minW(tabsF.cond), 1366);
  for (const r of hideO) assert.ok(maxW(r.cond) < 1100, r.sel + ' in ' + JSON.stringify(r.cond));
  for (const r of hideF) assert.ok(maxW(r.cond) < 1366, r.sel + ' in ' + JSON.stringify(r.cond));
  // no rule shows the panels again by out-ranking (the old 0,3,0 overrides that lost to 0,4,0 are gone)
  assert.equal(R.some(r => /\.sx-colO\[data-tab\] > \.sx-opan$/.test(r.sel) || /\.sx-colF\[data-tab\] > \.sx-fpan$/.test(r.sel)), false);
  // row C: 2 × 2 from 768, 4 columns from 1100 px (iPad Pro 11″ landscape, 1194 px)
  const rowC = R.filter(r => r.sel === '.sx-rowC' && /grid-template-columns/.test(r.body)).map(r => [minW(r.cond), /repeat\(2,/.test(r.body) ? 2 : (r.body.match(/minmax/g) || []).length]);
  assert.deepEqual(rowC, [[768, 2], [1100, 4]]);
  // editor popovers (curve editors, PZ, OSC MAPPING …) full screen below 1100 px
  const ed = R.find(r => r.sel === '.sx-pop.sx-pop-ed');
  assert.ok(ed && maxW(ed.cond) === 1099 && /inset:\s*0/.test(ed.body) && /100dvh/.test(ed.body));
  // touch: ≥ 44 px for the ENV tabs, every seg button, the browser tabs, stars, play / more, the matrix CRV cells
  const touch = sel => R.find(r => r.sel === '.sx-touch ' + sel);
  for (const sel of ['.sx-etabs button', '.sx-seg button', '.pb-tabs button', '.pb-stars button', '.pb-play']) {
    assert.ok(touch(sel) && /min-height:\s*44px/.test(touch(sel).body), sel);
  }
  assert.ok(/width:\s*44px/.test(touch('.sx-crv').body) && /height:\s*44px/.test(touch('.sx-crv').body));
  assert.ok(R.some(r => r.sel === '.sx-touch.sx-root' && /--sx-crvw:\s*46px/.test(r.body)));   // the matrix CRV columns grow with it
});

test('review: panel undo after an outside preset load / project undo; undo re-seeds the FX rack only for preset-like steps', async () => {
  const { doc, host, u, s } = await mount();
  const seeds = [], e0 = host.edit, f0 = host.editFx;
  host.edit = (fn, o) => { seeds.push(['edit', o && o.label, !!(o && o.seed)]); e0(fn, o); };
  host.editFx = (fn, o) => { seeds.push(['editFx', o && o.label, !!(o && o.seed)]); f0(fn, o); };
  u.setN('a.level', 0.3, 'set');
  await flush(doc);
  // MIDI program change in main.js: the state is replaced, the key changes, the host calls refresh()
  const other = fresh(); other.p['f.cutoff'] = 0.123; other.p['a.level'] = 0.9;
  const b0 = other.p['b.level'];
  for (const k of Object.keys(s())) delete s()[k];
  Object.assign(s(), other);
  host.presets.load('f:3');
  u.refresh();
  await flush(doc);
  assert.equal(u.undo.label(), 'Load preset');
  assert.match(u.head.querySelector('.sx-pname').textContent, /Soft Pad/);
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
  // a preset-like step (Init Preset) re-seeds when undone, like the load did
  fire(btnIn(u.head, 'Main menu'), 'click');
  pick(doc, 'Init Preset');
  await flush(doc);
  seeds.length = 0;
  u.undoRedo(false);
  await flush(doc);
  assert.ok(seeds.some(x => x[1] === 'Undo' && x[2]), JSON.stringify(seeds));
  u.destroy();
});

test('review: no-op presses are no edits; LFO PHASE snap while dragging only; Smoothing scale commits once; Quality re-selection; asset meter', async () => {
  const usage = { bytes: 12.5 * 1048576, budget: 192 * 1048576 };
  const { doc, host, u, s } = await mount({ qualityChosen: os => host.log.push(['quality', os]) }, h => { h.smp.usage = () => usage; });
  // a press and release (click, long-press) without a move: no host edit, no '*', no undo step
  const k = byDest(u.pages.osc.el, 'e1.att');
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
  u.lfoSnap = false;
  // GLOBAL > PREFERENCES Smoothing scale: a drag shows its value and commits once (storage + prefsChanged)
  u.setPage('global');
  await flush(doc);
  const sv = u.pages.global.el.querySelectorAll('.sx-nfv').find(n => n.getAttribute('aria-label') === 'Smoothing scale');
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
  // QUALITY: choosing the selected quality again resets the CPU safeguard steps (host.qualityChosen), without an edit
  const os0 = s().global.os, cur = segIn(u.pages.global.el, 'Quality', ['Draft', 'High', 'Ultra'][[1, 2, 4].indexOf(os0)]);
  host.log.length = 0;
  fire(cur, 'click');
  assert.deepEqual(host.log.filter(x => x[0] === 'quality' || x[0] === 'edit'), [['quality', os0]]);
  fire(segIn(u.pages.global.el, 'Quality', 'Ultra'), 'click');
  assert.equal(s().global.os, 4);
  assert.deepEqual(host.log.filter(x => x[0] === 'quality'), [['quality', os0], ['quality', 4]]);
  // the project asset meter (§14.2) from host.smp.usage
  await flush(doc);
  const meter = u.pages.global.el.querySelector('.sx-assets');
  assert.equal(meter.textContent, 'Assets: 12.5 MB of 192 MB');
  u.destroy();
  const m2 = await mount();
  m2.u.setPage('global');
  await flush(m2.doc);
  assert.ok(m2.u.pages.global.el.querySelector('.sx-assets').parentNode.classList.contains('sx-hidden'));   // no host member: hidden
  m2.u.destroy();
});

test('review: locks through serum-core setLock / setModuleLock; Sort by Destination in FX order; Init Preset keeps initPreset\'s ui', async () => {
  const v1 = core.defaultFxV1();
  v1.p['fx.dist.on'] = 1; v1.p['fx.dly.on'] = 1;
  const fx = core.migrateFx1(v1);
  fx.racks[0].mods[0].id = 'zz'; fx.racks[0].mods[1].id = 'aa';           // main rack: Distortion zz, then Delay aa
  const { doc, host, u, s } = await mount(null, h => { h.st.fx = fx; h.store.set(ui.PREFS_KEY, { view3d: 1 }); });
  // a parameter lock inside a locked module: one item, Unlock Control, which unlocks it for real
  u.edit(st => { st.locks.mod = ['oscA']; st.locks.p = ['a.level']; });
  await flush(doc);
  const al = byDest(u.el, 'a.level');
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
  const title = u.el.querySelectorAll('[data-modlabel]').find(n => n.getAttribute('data-modlabel') === 'oscA');
  fire(title, 'contextmenu', { clientX: 5, clientY: 5 });
  pick(doc, 'Lock Module');
  assert.deepEqual([s().locks.mod, s().locks.unp], [[], []]);
  // MATRIX header menu: Sort by Destination follows the destination menu (FX rows in rack / instance order)
  const pd = Object.keys(fx.racks[0].mods[0].p)[1], pa = Object.keys(fx.racks[0].mods[1].p)[1];
  u.edit(st => { st.matrix[0] = row({ src: 'lfo1', amt: 0.2, dst: 'fx.aa.' + pa }); st.matrix[1] = row({ src: 'lfo2', amt: 0.2, dst: 'fx.zz.' + pd }); });
  u.setPage('matrix');
  await flush(doc);
  fire(btnIn(u.pages.matrix.el, 'Matrix menu'), 'click');
  pick(doc, 'Sort by Destination');
  assert.deepEqual(s().matrix.slice(0, 2).map(r => r.dst), ['fx.zz.' + pd, 'fx.aa.' + pa]);
  // Init Preset: initPreset's ui (Default waveform view 3D, default selections); the page stays
  u.edit(st => { st.ui.view3d = [0, 0, 0]; st.ui.mod = 'lfo4'; });
  fire(btnIn(u.head, 'Main menu'), 'click');
  pick(doc, 'Init Preset');
  assert.deepEqual(s().ui.view3d, [1, 1, 1]);
  assert.equal(s().ui.page, 'matrix');
  assert.equal(s().ui.mod, fresh().ui.mod);
  u.destroy();
});

test('review: module labels as audio sources; X|Y dot Modulate X / Y; macro tiles on MATRIX; LFO / VELO / NOTE module menu; dropTarget long-press; LFO → wavetable', async () => {
  const unh = [], onU = e => unh.push(e);
  process.on('unhandledRejection', onU);
  const { doc, host, u, s } = await mount();
  const el = u.el, lab = m => el.querySelectorAll('[data-modlabel]').find(n => n.getAttribute('data-modlabel') === m);
  const drag = (from, over, o) => { doc.pointAt = () => over; ptr(from, 'pointerdown', 10, 10, o); ptr(from, 'pointermove', 40, 30, o); ptr(from, 'pointerup', 40, 30, o); };
  // OSC A / SUB / NOISE / FILTER 2 labels dropped on a control = that audio-rate source (§3.10, inv B18)
  const res = byDest(el, 'f.res');
  doc.pointAt = () => res;
  ptr(lab('oscA'), 'pointerdown', 10, 10); ptr(lab('oscA'), 'pointermove', 40, 30);
  assert.ok(res.classList.contains('sx-droptgt'));
  assert.match(doc.body.querySelector('.sx-ghost').textContent, /^Modulate · OSC A/);
  ptr(lab('oscA'), 'pointerup', 40, 30);
  drag(lab('sub'), byDest(el, 'a.pan'));
  drag(lab('filter2'), byDest(el, 'b.pan'));
  const rows = () => s().matrix.filter(r => r.src).map(r => r.src + '→' + r.dst);
  assert.deepEqual(rows(), ['osca→f.res', 'sub→a.pan', 'filt2→b.pan']);
  drag(lab('filter'), lab('filter2'));                                       // a label onto its own kind still swaps
  assert.deepEqual(rows(), ['osca→f2.res', 'sub→a.pan', 'filt2→b.pan']);     // (rows to the filters follow the swap)
  // a granular / spectral X|Y dot (data-xy): the drop offers Modulate X / Modulate Y (§13.3)
  const dot = doc.createElement('div');
  dot.setAttribute('data-xy', '1'); dot.setAttribute('data-dest-x', 'a.pos'); dot.setAttribute('data-dest-y', 'a.gy');
  u.kit.dropTarget(dot, 'a.pos');
  u.pages.osc.el.appendChild(dot);
  drag(el.querySelector('[data-src="lfo3"]'), dot);
  assert.deepEqual(menuLabels(ctxMenus(doc).at(-1)), ['Modulate X', 'Modulate Y']);
  pick(doc, 'Modulate Y');
  assert.ok(rows().includes('lfo3→a.gy'));
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
  // the MATRIX page's tile strip carries the macro tiles too (§13.13)
  u.setPage('matrix');
  await flush(doc);
  assert.equal(u.pages.matrix.el.querySelectorAll('[data-mactile]').length, 8);
  u.setPage('osc');
  await flush(doc);
  // the LFO / VELO / NOTE editor's title is the module menu of the module shown (inv B16, B17)
  const lfoTitle = () => u.pages.osc.el.querySelectorAll('.sx-tname').find(n => /^(LFO \d+|VELO|NOTE)$/.test(n.textContent));
  u.selectSrc('lfo1');
  await flush(doc);
  fire(lfoTitle(), 'contextmenu', { clientX: 5, clientY: 5 });
  // (then the module's destinations, inv B15: Bypass All / Remove All Destinations)
  assert.deepEqual(menuLabels(ctxMenus(doc).at(-1)), ['Lock Module', 'Init Module', 'Copy', 'Copy (w/mods)', 'Swap with', '', 'Bypass All Destinations', 'Remove All Destinations']);
  pick(doc, 'Lock Module');
  assert.ok(s().locks.mod.includes('lfo1'));
  await flush(doc);
  assert.ok(lfoTitle().closest('.sx-panel').classList.contains('sx-locked'));
  u.edit(st => { st.lfo[0].pts = [[0, 1, 0], [1, 0, 0]]; });
  fire(lfoTitle(), 'contextmenu', { clientX: 5, clientY: 5 });
  pick(doc, 'Copy');                                                         // the menu equivalent of the Alt-drag copy
  u.selectSrc('lfo2');
  await flush(doc);
  assert.equal(lfoTitle().textContent, 'LFO 2');
  fire(lfoTitle(), 'keydown', { key: 'Enter' });
  pick(doc, 'Paste');
  assert.deepEqual(s().lfo[1].pts, s().lfo[0].pts);
  u.selectSrc('velo');
  await flush(doc);
  fire(lfoTitle(), 'contextmenu', { clientX: 5, clientY: 5 });
  assert.deepEqual(menuLabels(ctxMenus(doc).at(-1)), ['Lock Module', 'Init Module', 'Copy', 'Copy (w/mods)', '', 'Bypass All Destinations', 'Remove All Destinations']);
  pick(doc, 'Lock Module');
  assert.ok(s().locks.mod.includes('velo'));
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
  const P1 = u.openCurve(0, byDest(el, 'f.res'));
  assert.ok(P1 && P1.box.classList.contains('sx-pop-ed'));
  P1.close();
  const P2 = u.kit.popover('pane', byDest(el, 'f.res'), 'Routing', box => { box.appendChild(doc.createElement('div')); return { refresh() {}, destroy() {} }; }, () => '');
  assert.equal(P2.box.classList.contains('sx-pop-ed'), false);
  P2.close();
  u.destroy();
});

test('review: preset browser reads once, keeps its rows on ↑↓ / preview, preview ends after 4 s, one tag set; Hybridize Favoring an unreadable preset; header reads per refresh only', async t => {
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
  fire(btnIn(u.head, 'Preset Deep Bass (edited), browse presets'), 'click');
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

test('review: hidden canvases are neither drawn nor measured; kit.live tells its callbacks whether their page is shown', async () => {
  const { doc, u } = await mount();
  u.ro = { observe() {}, disconnect() {} };                                  // a browser's ResizeObserver (none in the fake DOM)
  let draws = 0, lives = 0;
  u.bp = u.pages.osc;
  const cv = u.kit.canvas('', () => 'k' + u.snapSeq, () => { draws++; });
  u.bp = u.pages.matrix || null;
  u.setPage('matrix');
  await flush(doc);
  u.bp = u.pages.matrix;
  let hiddenCalls = 0;
  u.kit.live(on => { if (on) lives++; else hiddenCalls++; });
  u.bp = null;
  u.setPage('osc');
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
  assert.equal(lives, 0);                                                    // the MATRIX page is hidden: told so
  assert.ok(hiddenCalls > 0);                                                // (functional work such as clip recording goes on)
  cv.el._rect = { left: 0, top: 0, width: 300, height: 120 };              // shown again: the ResizeObserver clears `sized`
  cv.sized = false;
  u.setSnapshot({ s: { notes: 0 } });
  await flush(doc);
  assert.equal(draws, 1);
  u.setPage('matrix');
  await flush(doc);
  u.setSnapshot({ s: { notes: 0 } });
  await flush(doc);
  assert.ok(lives > 0);
  u.destroy();
});

test('RULINGS2 F1: effect chains are v2 — Factory chains (FACTORY_CHAINS2), saved chains, v1 library entries migrate; locked parameters, rack locks and rows of instances that stay', async () => {
  const { host, u, s } = await mount();
  // the current rack (v2): one Delay (id dly) whose MIX is locked, one Chorus addressed by a matrix row; rack 1 (BUS 1) locked
  host.st.fx = core.defaultFx2();
  core.newInstance(host.st.fx, 'dly'); core.newInstance(host.st.fx, 'cho');
  host.st.fx.racks[0].mods[0].p.mix = 0.77;
  host.st.fx.racks[1].lock = 1;
  u.edit(st => { st.locks.p.push('fx.dly.mix'); st.matrix[0] = Object.assign({}, st.matrix[0], { src: 'lfo1', dst: 'fx.cho.mix', amt: 0.5 }); });
  // Factory ▸ Dub Delay (a migrated Phase-1 chain: S1 Delay "dly", no Chorus)
  const dub = core.FACTORY_CHAINS.chains.find(c => c.name === 'Dub Delay');
  assert.ok(dub && dub.fx.v === 2, 'factory chains are v2');
  u.loadChain(dub.fx, dub.name);
  const fx = host.st.fx;
  assert.equal(fx.v, 2);
  assert.deepEqual(fx.racks[0].mods.map(I => I.id), dub.fx.racks[0].mods.map(I => I.id));
  assert.equal(core.fxDest('fx.dly.mix', fx).inst.p.mix, 0.77, 'the locked parameter keeps its value');
  assert.equal(fx.racks[1].lock, 1, 'rack locks stay');
  assert.equal(s().matrix[0].dst, '', 'the row of the Chorus the chain does not bring back goes');
  // saving stores a v2 chain; a v1 library entry written by an older version loads (migrated)
  host.store.set('synth.fxchains', [{ name: 'Old', fx: Object.assign(core.defaultFxV1(), { p: Object.assign(core.defaultFxV1().p, { 'fx.rev.on': 1 }) }) }]);
  const list = u.chains();
  assert.equal(list.length, 1);
  assert.equal(list[0].fx.v, 2);
  assert.deepEqual(list[0].fx.racks[0].mods.map(I => I.id), ['rev']);
  u.loadChain(list[0].fx, 'Old');
  assert.deepEqual(host.st.fx.racks[0].mods.map(I => I.id), ['rev']);
  u.destroy();
});

test('a Phase-1 chain (v1 library entry, Phase-1 factory chain) on a migrated Phase-1 track keeps the locked, mapped and modulated modules (as Phase 1)', async () => {
  const { host, u, s } = await mount();
  // a Phase-1 FX state: Distortion on (drive edited) — its ON and DRIVE locked, LFO 1 → DRIVE, CC 20 → MIX
  const v1 = core.defaultFxV1();
  v1.p['fx.dist.on'] = 1; v1.p['fx.dist.drive'] = 0.62;
  u.edit(st => {
    st.locks.p.push('fx.dist.on', 'fx.dist.drive');
    st.matrix[0] = Object.assign({}, st.matrix[0], { src: 'lfo1', dst: 'fx.dist.drive', amt: 0.4 });
    st.midi['20'] = 'fx.dist.mix';
  });
  const check = (what) => {
    const fx = host.st.fx, ids = fx.racks[0].mods.map(I => I.id), d = core.fxDest('fx.dist.drive', fx);
    assert.ok(ids.includes('dist') && ids.includes('cho'), what + ': instances ' + ids);
    assert.deepEqual([d.inst.p.on, d.inst.p.drive], [1, 0.62], what + ': the locked values (the Distortion keeps sounding)');
    assert.deepEqual([s().locks.p.slice().sort(), s().matrix[0].dst, s().midi['20']], [['fx.dist.drive', 'fx.dist.on'], 'fx.dist.drive', 'fx.dist.mix'], what + ': locks, row, MIDI map');
  };
  // the library entry written by Phase 1 (v1), picked from the chain menu
  const wide = core.FACTORY_CHAINS_V1.chains.find(c => c.name === 'Wide Chorus');
  for (const name of ['Wide Chorus', 'Mine']) {
    host.st.fx = core.normalizeFx(v1, s());
    host.store.set('synth.fxchains', [{ name: 'Mine', fx: wide.fx }]);
    const items = u.chainMenu();
    const it = name === 'Mine' ? items.find(x => x.label === 'Mine') : items.find(x => x.label === 'Factory').sub.find(x => x.label === name);
    it.action();
    check(name === 'Mine' ? 'v1 library entry' : 'Phase-1 factory chain');
  }
  // saving a chain keeps the v1 entry as stored (it still migrates at load with refs)
  assert.deepEqual(host.store.get('synth.fxchains', []).map(c => [c.name, c.fx.v]), [['Mine', 1]]);
  u.destroy();
});
