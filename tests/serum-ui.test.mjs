// serum-ui.js (E5) — pure helpers (§8.8, §10.6) and headless checks of SerumUI / PresetBrowser on a minimal fake DOM.
// Run: node --test tests/
//
// Sibling UI modules are replaced by small stubs (tests/serum-ui-stubs/, via tests/serum-ui.hooks.mjs) so this file
// tests serum-ui alone (§10.1: a unit test imports only its own module plus fixtures): graph.js, fx-ui.js,
// wtedit.js and wt.js are stubbed; serum-core.js and wk.js are the real modules serum-ui builds on. A separate test imports serum-ui.js
// with the real siblings in a child process when they all exist (§10.6 "importing every browser module in node
// does not throw").
import test from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { redirect } from './serum-ui.hooks.mjs';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const SIBLINGS = ['graph.js', 'fx-ui.js', 'wtedit.js', 'wt.js'];

/* ---------------------------------------------------------------- sibling stubs */
// tests/serum-ui.hooks.mjs redirects the sibling imports to tests/serum-ui-stubs/*.js
if (typeof nodeModule.registerHooks === 'function') {
  nodeModule.registerHooks({ resolve: (spec, ctx, next) => redirect(spec, ctx.parentURL) || next(spec, ctx) });
} else nodeModule.register('./serum-ui.hooks.mjs', import.meta.url);

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

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const fresh = () => core.normalizeSerum(core.defaultSerum());
const row = o => Object.assign({ src: '', amt: 0, dst: '', bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1 }, o);
const labels = items => items.map(it => it.label);

/* ================================================================ import */
test('imports in node without a DOM; siblings stubbed for the unit tests', () => {
  for (const k of ['SerumUI', 'PresetBrowser', 'haloArcs', 'knobMenuItems', 'dropRow', 'busMenuItems', 'lfoTileCount', 'sortPresets', 'stepPreset', 'captureDue']) {
    assert.equal(typeof ui[k], 'function', k);
  }
  for (const m of [gxStub, fxStub, wteStub, wtStub]) assert.equal(m.__stub, true);
});

test('imports in node with the real sibling modules (child process; skipped while a sibling is missing)', t => {
  const missing = SIBLINGS.filter(f => !existsSync(fileURLToPath(new URL(f, ROOT))));
  if (missing.length) { t.skip('missing sibling module(s): ' + missing.join(', ')); return; }
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import(${JSON.stringify(new URL('serum-ui.js', ROOT).href)}); if (typeof m.SerumUI !== 'function') process.exit(3);`],
  { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
});

/* ================================================================ haloArcs (§5.8) */
test('haloArcs: unipolar, bipolar row, bipolar source, negative, clamp, selected, bypass, amt·out, FX base', () => {
  const s = fresh(), fx = core.defaultFx();
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
  const a = ui.haloArcs(s, fx, 'f.cutoff', 'lfo1');
  assert.deepEqual(a.map(x => x.slot), [0, 1, 2, 3, 4, 6, 8]);
  const exp = [[0.5, 0.8, 'sel'], [0.3, 0.5, 'neg'], [0.25, 0.75, 'other'], [0.2, 0.8, 'other'], [0.5, 1, 'other'], [0.5, 0.75, 'other'], [0.3, 0.7, 'neg']];
  a.forEach((x, i) => { near(x.from, exp[i][0], 1e-12); near(x.to, exp[i][1], 1e-12); assert.equal(x.kind, exp[i][2]); });
  for (const x of a) assert.ok(x.from <= x.to && x.from >= 0 && x.to <= 1);
  // the selected source wins over a negative depth
  assert.equal(ui.haloArcs(s, fx, 'f.cutoff', 'env2')[1].kind, 'sel');
  // clamp at 0 on the low side
  s.p['f.cutoff'] = 0.05;
  const b = ui.haloArcs(s, fx, 'f.cutoff', '');
  near(b[1].from, 0); near(b[1].to, 0.05, 1e-12);
  // FX bases come from fx.p (not the default); g.master lives in s.p
  fx.p['fx.dly.mix'] = 0.2;
  s.matrix[10] = row({ src: 'lfo5', amt: 0.5, dst: 'fx.dly.mix' });
  const c = ui.haloArcs(s, fx, 'fx.dly.mix', 'lfo5');
  assert.equal(c.length, 1); near(c[0].from, 0.2, 1e-12); near(c[0].to, 0.7, 1e-12); assert.equal(c[0].kind, 'sel');
  s.p['g.master'] = 0.7;
  s.matrix[11] = row({ src: 'env1', amt: -0.1, dst: 'g.master' });
  const m = ui.haloArcs(s, fx, 'g.master', 'lfo1');
  near(m[0].from, 0.6, 1e-12); near(m[0].to, 0.7, 1e-12); assert.equal(m[0].kind, 'neg');
  assert.deepEqual(ui.haloArcs(s, fx, 'nope', 'lfo1'), []);
  assert.deepEqual(ui.haloArcs(s, fx, 'b.level', 'lfo1'), []);
});

/* ================================================================ knobMenuItems (§9.4) */
test('knobMenuItems: exact labels and order for 0 / 1 / 2 rows, with and without MIDI', () => {
  const s = fresh(), fx = core.defaultFx();
  assert.deepEqual(labels(ui.knobMenuItems(s, fx, 'f.cutoff', {})),
    ['Reset Control', 'Enter Value…', '', 'Mod Source', '', 'Lock']);
  assert.deepEqual(labels(ui.knobMenuItems(s, fx, 'f.cutoff', { midi: true })),
    ['Reset Control', 'Enter Value…', '', 'Mod Source', '', 'MIDI Learn', 'Lock']);
  s.matrix[3] = row({ src: 'lfo1', amt: 0.3, dst: 'f.cutoff' });
  s.matrix[0] = row({ src: 'lfo2', amt: 0.3, dst: 'a.level' });
  s.midi['21'] = 'f.cutoff';
  const one = ui.knobMenuItems(s, fx, 'f.cutoff', { midi: true });
  assert.deepEqual(labels(one), ['Bypass Modulator: LFO 1', 'Remove Modulator: LFO 1', 'Remove All Modulators', '',
    'Reset Control', 'Enter Value…', '', 'Mod Source', '', 'MIDI Re-learn (CC 21)', 'Remove MIDI CC 21', 'Lock']);
  assert.equal(one[0].kind, 'bypass'); assert.equal(one[0].slot, 3); assert.equal(one[0].checked, false);
  assert.equal(one[1].kind, 'remove'); assert.equal(one[1].slot, 3);
  assert.equal(one[3].kind, 'sep');
  assert.deepEqual(labels(ui.knobMenuItems(s, fx, 'f.cutoff', {})),
    ['Bypass Modulator: LFO 1', 'Remove Modulator: LFO 1', 'Remove All Modulators', '', 'Reset Control', 'Enter Value…', '', 'Mod Source', '', 'Lock']);
  s.macros[1].name = 'Wobble';
  s.matrix[9] = row({ src: 'macro2', amt: -0.5, dst: 'f.cutoff', byp: 1 });
  s.locks.p.push('f.cutoff');
  const two = ui.knobMenuItems(s, fx, 'f.cutoff', {});
  assert.deepEqual(labels(two), ['Bypass Modulator: LFO 1', 'Bypass Modulator: Wobble', 'Remove Modulator: LFO 1', 'Remove Modulator: Wobble',
    'Remove All Modulators', '', 'Reset Control', 'Enter Value…', '', 'Mod Source', '', 'Unlock']);
  assert.deepEqual(two.slice(0, 2).map(x => x.checked), [false, true]);
  assert.equal(two[two.length - 1].kind, 'unlock');
  // Mod Source ▸: every SRC_MENU source in order, macros by their names
  const ms = two.find(x => x.kind === 'modsrc');
  assert.deepEqual(ms.sub.map(x => x.src), core.SRC_MENU.slice());
  assert.equal(ms.sub.find(x => x.src === 'macro2').label, 'Wobble');
  assert.equal(ms.sub.find(x => x.src === 'lfo3').label, 'LFO 3');
});

test('knobMenuItems: module power button and PHASE knob', () => {
  const s = fresh(), fx = core.defaultFx();
  s.locks.mod.push('oscA');
  const pw = ui.knobMenuItems(s, fx, 'a.on', { module: 'oscA', paste: true, midi: true });
  assert.deepEqual(labels(pw), ['Lock Module', 'Copy OSC', 'Paste OSC', 'Init OSC', '',
    'Reset Control', 'Enter Value…', '', 'Mod Source', '', 'MIDI Learn', 'Lock']);
  assert.equal(pw[0].checked, true);
  const f = ui.knobMenuItems(s, fx, 'f.on', { module: 'filter' });
  assert.deepEqual(labels(f).slice(0, 4), ['Lock Module', 'Copy Filter', 'Init Filter', '']);
  assert.equal(f[0].checked, false);
  s.matrix[2] = row({ src: 'fixed', amt: 1, dst: 'b.on' });
  assert.deepEqual(labels(ui.knobMenuItems(s, fx, 'b.on', { module: 'oscB' })).slice(0, 8),
    ['Lock Module', 'Copy OSC', 'Init OSC', '', 'Bypass Modulator: Fixed', 'Remove Modulator: Fixed', 'Remove All Modulators', '']);
  assert.deepEqual(labels(ui.knobMenuItems(s, fx, 'a.phase', {})),
    ['Reset Control', 'Enter Value…', 'New MemTrig phase set', '', 'Mod Source', '', 'Lock']);
  assert.ok(!labels(ui.knobMenuItems(s, fx, 'n.phase', {})).includes('New MemTrig phase set'));
});

/* ================================================================ dropRow (§5.8) */
test('dropRow: drop defaults (limit on / off, bipolar, bool, FX base) and full matrix', () => {
  let s = fresh();
  const fx = core.defaultFx();
  s.p['f.cutoff'] = 0.5;
  let r = ui.dropRow(s, fx, 'lfo1', 'f.cutoff', { limit: 1 });
  assert.equal(r.slot, 0); assert.equal(r.row, s.matrix[0]);
  assert.deepEqual(r.row, row({ src: 'lfo1', amt: 0.5, dst: 'f.cutoff' }));
  s.p['f.res'] = 0.9;
  near(ui.dropRow(s, fx, 'env2', 'f.res').row.amt, 0.1, 1e-12);          // limit is the default
  s.p['f.drive'] = 0.99;
  near(ui.dropRow(s, fx, 'env2', 'f.drive', { limit: true }).row.amt, 0.05, 1e-12);
  near(ui.dropRow(s, fx, 'env3', 'f.drive', { limit: 0 }).row.amt, 0.5, 1e-12);
  r = ui.dropRow(s, fx, 'lfo2', 'a.semi', { limit: 1 });                   // centred → bipolar 0.5
  assert.equal(r.row.bi, 1); near(r.row.amt, 0.5);
  assert.equal(ui.dropRow(s, fx, 'velo', 'a.on').row.amt, -1);            // bool on → −1
  assert.equal(ui.dropRow(s, fx, 'velo', 'b.on').row.amt, 1);             // bool off → +1
  fx.p['fx.dly.mix'] = 0.8;
  near(ui.dropRow(s, fx, 'lfo3', 'fx.dly.mix').row.amt, 0.2, 1e-12);      // FX base from fx.p
  assert.equal(s.matrix.filter(x => x.src).length, 8);
  s = fresh();
  for (let i = 0; i < 32; i++) s.matrix[i] = row({ src: 'fixed', amt: 0.1, dst: 'a.level' });
  assert.equal(ui.dropRow(s, fx, 'lfo1', 'f.cutoff'), null);
});

/* ================================================================ busMenuItems / linkPoints (§9.4) */
test('busMenuItems: linked buses with source labels, then New bus; none free → no New bus', () => {
  const s = fresh();
  s.lfo[0].pts = [[0, 0, 0], [0.25, 1, 0, 0, 3], [0.5, 0.2, 0, 2, 0], [1, 0, 0]];
  s.lfo[1].pts = [[0, 0, 0], [0.5, 1, 0, 0, 3], [1, 0, 0]];
  s.lfo[2].pts = [[0, 0, 0], [0.5, 1, 0, 0, 5], [1, 0, 0]];
  s.macros[0].name = 'Drive';
  s.matrix[0] = row({ src: 'env2', amt: 0.5, dst: 'bus3', bi: 1 });
  s.matrix[1] = row({ src: 'macro1', amt: 0.5, dst: 'bus3', bi: 1 });
  s.matrix[2] = row({ src: 'lfo4', amt: 0.5, dst: 'bus2', bi: 1 });
  s.matrix[3] = row({ src: 'env2', amt: 0.2, dst: 'bus3', bi: 1 });
  assert.deepEqual(ui.busMenuItems(s, 0, 1, 'y'), [
    { label: 'Bus 2 (LFO 4)', bus: 2 }, { label: 'Bus 3 (Env 2, Drive)', bus: 3, checked: true }, { label: 'Bus 5', bus: 5 }, { label: 'New bus', bus: 1 }]);
  assert.deepEqual(ui.busMenuItems(s, 0, [2], 'x').map(x => !!x.checked), [true, false, false, false]);
  assert.deepEqual(ui.busMenuItems(s, 0, [1, 2], 'y').map(x => !!x.checked), [false, false, false, false]);
  const t = fresh();
  for (let k = 1; k <= 16; k++) t.matrix[k - 1] = row({ src: 'lfo1', amt: 0.5, dst: 'bus' + k, bi: 1 });
  assert.deepEqual(ui.busMenuItems(t, 0, 1, 'y'), []);   // nothing linked, every bus targeted: no New bus
});

test('linkPoints: new bus with its row, X never on end points, relinking prunes orphaned bus rows', () => {
  const s = fresh(), fx = core.defaultFx();
  s.lfo[0].pts = [[0, 0, 0], [0.5, 1, 0], [1, 0, 0]];
  assert.equal(ui.linkPoints(s, fx, 0, [1], 'y', 4, 'env2'), 1);
  assert.deepEqual(s.lfo[0].pts[1], [0.5, 1, 0, 0, 4]);
  assert.deepEqual(s.matrix[0], row({ src: 'env2', amt: 0.5, dst: 'bus4', bi: 1 }));
  assert.equal(ui.linkPoints(s, fx, 0, [0, 2], 'x', 6, 'lfo2'), 0);       // first / last points: no X link
  assert.equal(s.matrix[1].src, '');
  assert.equal(ui.linkPoints(s, fx, 0, [1], 'y', 7, null), 1);             // relink: bus 4 no longer linked → row pruned
  assert.deepEqual(s.lfo[0].pts[1], [0.5, 1, 0, 0, 7]);
  assert.equal(s.matrix[0].src, '');
  assert.equal(ui.linkPoints(s, fx, 0, [1], 'y', 17, 'env1'), 0);
});

/* ================================================================ lfoTileCount (§9.3) */
test('lfoTileCount: min(8, max(4, highest used LFO + 1))', () => {
  const s = fresh();
  assert.equal(ui.lfoTileCount(s), 4);
  s.matrix[4] = row({ src: 'lfo7', amt: 0.5, dst: 'a.level' });
  assert.equal(ui.lfoTileCount(s), 8);
  s.matrix[4] = row({ src: 'lfo5', amt: 0.5, dst: 'a.level' });
  assert.equal(ui.lfoTileCount(s), 6);
  s.matrix[4] = row({ src: 'lfo2', amt: 0.5, dst: 'a.level' });
  assert.equal(ui.lfoTileCount(s), 4);
  s.matrix[5] = row({ src: 'env1', aux: 'lfo6', amt: 0.5, dst: 'a.level', byp: 1 });   // aux and bypassed rows count
  assert.equal(ui.lfoTileCount(s), 7);
  s.matrix[6] = row({ src: 'lfo8', amt: 0, dst: '' });
  assert.equal(ui.lfoTileCount(s), 8);
});

/* ================================================================ presets (§9.10) */
const PL = [
  { key: 'a', name: 'Bass One', cat: 'Bass', author: 'Zed', user: false },
  { key: 'b', name: 'Arp', cat: 'Seq', author: 'Amy', user: true },
  { key: 'c', name: 'Bass Two', cat: 'Bass', author: 'Amy', user: false },
  { key: 'd', name: 'Lead', cat: 'Lead', author: 'Zed', user: false },
  { key: 'e', name: 'Arp', cat: 'Bass', author: 'Kim', user: true },
];
const keys = l => l.map(p => p.key);
test('sortPresets: column, direction, secondary sort = previously clicked column, then Name', () => {
  assert.deepEqual(keys(ui.sortPresets(PL, { sort: 'name', sort2: 'cat', dir: 1 })), ['e', 'b', 'a', 'c', 'd']);
  assert.deepEqual(keys(ui.sortPresets(PL, { sort: 'author', sort2: 'cat', dir: 1 })), ['c', 'b', 'e', 'a', 'd']);
  assert.deepEqual(keys(ui.sortPresets(PL, { sort: 'author', sort2: 'name', dir: 1 })), ['b', 'c', 'e', 'a', 'd']);
  assert.deepEqual(keys(ui.sortPresets(PL, { sort: 'author', sort2: 'cat', dir: -1 })), ['a', 'd', 'e', 'c', 'b']);
  assert.deepEqual(keys(ui.sortPresets(PL, { sort: 'cat', sort2: 'author', dir: 'asc' })), ['c', 'e', 'a', 'd', 'b']);
  const num = [{ key: 'x', name: 'Pad 10', cat: '', author: '' }, { key: 'y', name: 'pad 2', cat: '', author: '' }];
  assert.deepEqual(keys(ui.sortPresets(num, { sort: 'name' })), ['y', 'x']);
  assert.notEqual(ui.sortPresets(PL, {}), PL);
  assert.deepEqual(keys(PL), ['a', 'b', 'c', 'd', 'e']);   // input untouched
});

test('filterPresets / browserList / presetCats / normBrowser', () => {
  assert.deepEqual(keys(ui.filterPresets(PL, { cat: 'Bass' })), ['a', 'c', 'e']);
  assert.deepEqual(keys(ui.filterPresets(PL, { q: 'amy' })), ['b', 'c']);
  assert.deepEqual(keys(ui.filterPresets(PL, { cat: 'Bass', q: 'TWO' })), ['c']);
  assert.deepEqual(keys(ui.browserList(PL, { sort: 'author', sort2: 'name', dir: 1, cat: 'Bass', q: '' })), ['c', 'e', 'a']);
  assert.deepEqual(ui.presetCats(PL), ['Bass', 'Lead', 'Seq']);
  assert.deepEqual(ui.normBrowser(null), { sort: 'name', sort2: 'cat', dir: 1, cat: '', q: '' });
  assert.deepEqual(ui.normBrowser({ sort: 'author', sort2: 'bogus', dir: 'desc', cat: 'Pad', q: 3 }), { sort: 'author', sort2: 'cat', dir: -1, cat: 'Pad', q: '' });
});

test('stepPreset: previous / next within the category, wrapping', () => {
  const L = ui.sortPresets(PL, { sort: 'name', sort2: 'cat' });   // e, b, a, c, d
  assert.equal(ui.stepPreset(L, 'e', 1, 'Bass'), 'a');
  assert.equal(ui.stepPreset(L, 'a', 1, 'Bass'), 'c');
  assert.equal(ui.stepPreset(L, 'c', 1, 'Bass'), 'e');            // wraps
  assert.equal(ui.stepPreset(L, 'e', -1, 'Bass'), 'c');           // wraps backwards
  assert.equal(ui.stepPreset(L, 'b', 1, 'Seq'), 'b');             // single entry
  assert.equal(ui.stepPreset(L, 'zz', 1, 'Bass'), 'e');           // unknown key → first / last of the category
  assert.equal(ui.stepPreset(L, 'zz', -1, 'Bass'), 'c');
  assert.equal(ui.stepPreset(L, 'd', 1, null), 'e');              // no category: whole list
  assert.equal(ui.stepPreset(L, 'a', 1, 'Pad'), null);
  assert.equal(ui.stepPreset([], 'a', 1), null);
});

/* ================================================================ captureDue (§6.4) */
test('captureDue: RAND crossing to MemTrig while PHASE is Mem and notes sound', () => {
  const P = (ap, ar, bp, br) => ({ 'a.phase': ap, 'a.rand': ar, 'b.phase': bp, 'b.rand': br });
  assert.deepEqual(ui.captureDue(P(1, 0.5, 0.5, 0.5), P(1, 1, 0.5, 1), 2), [0]);
  assert.deepEqual(ui.captureDue(P(1, 0.5, 1, 0.2), P(1, 0.9995, 1, 1), 1), [0, 1]);
  assert.deepEqual(ui.captureDue(P(1, 0.5, 1, 0.2), P(1, 1, 1, 1), 0), []);           // no notes
  assert.deepEqual(ui.captureDue(P(0.5, 0.5, 1, 1), P(0.5, 1, 1, 1), 3), []);          // A not Mem, B already 1
  assert.deepEqual(ui.captureDue(P(1, 1, 1, 1), P(1, 1, 1, 1), 3), []);                // no crossing
  assert.deepEqual(ui.captureDue(null, P(1, 1, 1, 1), 3), []);                         // first observation
  assert.deepEqual(ui.captureDue({ p: P(1, 0.2, 1, 0.2) }, { p: P(1, 1, 1, 0.2) }, 1), [0]);   // whole states
});

/* ================================================================ smaller helpers */
test('clipModule / pasteModule / initModule: OSC A → B, single-direction warp, kinds', () => {
  const s = fresh();
  s.p['a.level'] = 0.3; s.p['a.semi'] = 19 / 24; s.p['a.warpMode'] = 18 / 22; s.p['a.on'] = 1; s.p['b.on'] = 0;
  s.osc[0].wt = 'user:abc'; s.osc[0].remap = [[0, 0, 0], [0.5, 0.8, 0.2], [1, 1, 0]];
  s.global.uniRange[0] = 7.5; s.global.uniMode[0] = 3;
  const clip = ui.clipModule(s, 'oscA');
  assert.equal(clip.kind, 'osc');
  assert.equal(ui.pasteModule(s, 'oscB', clip), true);
  assert.equal(s.p['b.level'], 0.3); assert.equal(s.p['b.semi'], 19 / 24); assert.equal(s.p['b.on'], 1);
  assert.equal(s.osc[1].wt, 'user:abc');
  assert.deepEqual(s.osc[1].remap, s.osc[0].remap);
  assert.notEqual(s.osc[1].remap, s.osc[0].remap);
  assert.equal(s.global.uniRange[1], 7.5); assert.equal(s.global.uniMode[1], 3);
  assert.equal(s.p['b.warpMode'], 18 / 22); assert.equal(s.p['a.warpMode'], 0);   // the pasted oscillator wins
  assert.equal(ui.pasteModule(s, 'sub', ui.clipModule(s, 'noise')), false);
  s.p['f.cutoff'] = 0.9; s.filter.keytrack = 1; s.p['f.type'] = 5 / 95;
  assert.equal(ui.initModule(s, 'filter'), true);
  assert.equal(s.p['f.cutoff'], 0.5); assert.equal(s.filter.keytrack, 0); assert.equal(s.p['f.type'], 1 / 95);
  assert.equal(s.p['b.level'], 0.3);
  assert.equal(ui.clipModule(s, 'bogus'), null);
});

test('parseGrid, parseAmount, normPrefs, memTrigSet, tileDests, modTipLines, ccFor', () => {
  assert.deepEqual(ui.parseGrid('8'), { x: 8, y: 8 });
  assert.deepEqual(ui.parseGrid(' 4 , 16 '), { x: 4, y: 16 });
  assert.deepEqual(ui.parseGrid('12x3'), { x: 12, y: 3 });
  for (const bad of ['0', '65', 'x', '', '8,0', '1,2,3']) assert.equal(ui.parseGrid(bad), null, bad);
  near(ui.parseAmount('35', 'f.cutoff', 0), 0.35);
  near(ui.parseAmount('-35 %', 'f.cutoff', 0), -0.35);
  near(ui.parseAmount('0,5%', 'f.cutoff', 0), 0.005);
  assert.equal(ui.parseAmount('150', 'f.cutoff', 0), 1);
  near(ui.parseAmount('12st', 'a.semi', 0), 0.5);
  near(ui.parseAmount('-7 st', 'a.semi', 1), -7 / 12);
  near(ui.parseAmount('1 st', 'a.oct', 0), 1 / 96);
  assert.equal(ui.parseAmount('12st', 'f.cutoff', 0), null);
  assert.equal(ui.parseAmount('abc', 'f.cutoff', 0), null);
  assert.deepEqual(ui.normPrefs(undefined), Object.assign({}, ui.PREFS_DEFAULT));
  assert.deepEqual(ui.normPrefs({ tooltips: 0, dblClick: 'reset', wheel: false, defOs: 3, smooth: 99, author: 'x'.repeat(80), askPreset: true }),
    Object.assign({}, ui.PREFS_DEFAULT, { tooltips: 0, dblClick: 'reset', wheel: 0, defOs: 2, smooth: 8, author: 'x'.repeat(64), askPreset: 1 }));
  assert.equal(ui.normPrefs({ smooth: 0 }).smooth, 0.01);
  const m1 = ui.memTrigSet(1234), m2 = ui.memTrigSet(1234);
  assert.deepEqual(m1, m2);
  assert.equal(m1.length, 16);
  assert.ok(m1.every(v => v >= 0 && v < 1));
  assert.notDeepEqual(ui.memTrigSet(1235), m1);
  const s = fresh();
  s.matrix[2] = row({ src: 'lfo1', amt: 0.42, dst: 'f.cutoff', bi: 1 });
  s.matrix[5] = row({ src: 'lfo1', amt: -0.1, dst: 'a.level', byp: 1 });
  s.matrix[6] = row({ src: 'lfo1' });
  assert.deepEqual(ui.tileDests(s, 'lfo1'), ['f.cutoff', 'a.level']);
  assert.deepEqual(ui.modTipLines(s, 'f.cutoff'), ['LFO 1 +42% <->']);
  assert.deepEqual(ui.modTipLines(s, 'a.level'), ['LFO 1 -10% -> (bypassed)']);
  s.midi = { 30: 'f.cutoff', 12: 'f.cutoff', 5: 'a.level' };
  assert.equal(ui.ccFor(s, 'f.cutoff'), 12);
  assert.equal(ui.ccFor(s, 'f.res'), null);
});

/* ================================================================ fake DOM (headless checks) */
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
class Txt { constructor(t) { this.nodeType = 3; this.data = String(t); this.parentNode = null; } get textContent() { return this.data; } contains(n) { return n === this; } _parent() { return this.parentNode; } }
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

function mkHost(over) {
  const st = { s: fresh(), fx: core.defaultFx() }, log = [], store = new Map();
  const presets = [
    { key: 'f:0', name: 'Init', cat: 'Init', author: '', user: false },
    { key: 'f:1', name: 'Deep Bass', cat: 'Bass', author: 'Ann', user: false },
    { key: 'f:2', name: 'Acid Bass', cat: 'Bass', author: 'Bob', user: false },
    { key: 'u:1', name: 'My Bass', cat: 'Bass', author: 'Me', user: true },
    { key: 'f:3', name: 'Soft Pad', cat: 'Pad', author: 'Ann', user: false },
  ];
  let cur = 'f:1';
  const saw = new Float32Array(2048).map((_, i) => 1 - 2 * i / 2048);
  const host = {
    st, log, store, presets,
    state: () => st.s,
    edit: (fn, o) => { fn(st.s); log.push(['edit', o && o.label, o && o.phase, !!(o && o.ui)]); },
    fx: () => st.fx,
    editFx: (fn, o) => { fn(st.fx); log.push(['editFx', o && o.label]); },
    bpm: () => 120,
    wt: {
      list: () => [{ id: 'factory:Default', name: 'Default', cat: 'Basic', user: false }, { id: 'user:1', name: 'Mine', cat: '', user: true }],
      get: id => Promise.resolve(id === 'factory:Default' ? { name: 'Default', frames: [saw], morph: 0 } : id === 'user:1' ? { name: 'Mine', frames: [saw, saw, saw], morph: 1 } : null),
      saveNew: (t, name) => { log.push(['saveNew', name, t.frames.length]); return Promise.resolve('user:new'); },
      update() {},
      noises: () => [{ id: 'noise:White', name: 'White', cat: 'Colors', user: false, oneshot: 0 }, { id: 'noise:Click', name: 'Click', cat: 'Transient', user: false, oneshot: 1 }],
      saveNoise: (e, name) => { log.push(['saveNoise', name]); return Promise.resolve('nzuser:new'); },
    },
    audition: { on() {}, off() {} },
    monitor: on => log.push(['monitor', on]),
    presets: {
      list: () => presets,
      load: k => { cur = k; log.push(['load', k]); },
      save: o => { log.push(['save', o.name, o.cat]); presets.push({ key: 'u:' + presets.length, name: o.name, cat: o.cat, author: '', user: true }); cur = 'u:' + (presets.length - 1); return cur; },
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

/* ================================================================ headless SerumUI */
test('SerumUI: pages, header, every panel DEST carries data-dest (§3.13, §9.3, §9.7)', async () => {
  const { doc, host, u, s } = await mount();
  const el = u.el;
  assert.ok(el.classList.contains('sx-root'));
  assert.deepEqual(host.log.filter(x => x[0] === 'monitor'), [['monitor', true]]);
  const tabs = el.querySelectorAll('[role="tab"]');
  assert.deepEqual(tabs.map(t => t.textContent), ['OSC', 'FX', 'MATRIX', 'GLOBAL']);
  assert.deepEqual(tabs.map(t => t.getAttribute('aria-selected')), ['true', 'false', 'false', 'false']);
  u.setPage('global');
  await flush(doc);
  assert.equal(s().ui.page, 'global');
  assert.ok(host.log.some(x => x[0] === 'edit' && x[3] === true));     // page change is a UI-only edit
  const seen = new Set(el.querySelectorAll('[data-dest]').map(n => n.getAttribute('data-dest')));
  const dyn = /^(e[23]\.(att|hold|dec|sus|rel|ca|cd|cr)|l[2-8]\.(rate|rise|delay|smooth))$/;   // follow the selected source
  const want = core.DESTS.slice(0, core.NS).map(d => d.id).filter(id => !core.MATRIX_ONLY.includes(id) && !dyn.test(id)).concat(['g.master']);
  assert.deepEqual(want.filter(id => !seen.has(id)), []);
  for (const id of seen) assert.ok(core.DEST_INDEX[id] !== undefined && !core.MATRIX_ONLY.includes(id), id);
  // the ENV / LFO knobs follow the selected source
  u.setPage('osc');
  u.selectSrc('env3');
  u.selectSrc('lfo6');
  await flush(doc);
  assert.equal(s().ui.env, 2);
  assert.ok(byDest(el, 'e3.att') && byDest(el, 'e3.ca') && byDest(el, 'e3.cr') && byDest(el, 'l6.rate') && byDest(el, 'l6.smooth'));
  assert.equal(byDest(el, 'e1.att'), null);
  // LFO tiles: 4 by default; the selected LFO 6 stays visible
  const lfoTiles = el.querySelectorAll('[data-lfotile]').filter(t => t.isConnected && !t.closest('.sx-hidden'));
  assert.deepEqual(lfoTiles.filter(t => !t.classList.contains('sx-hidden')).map(t => t.getAttribute('data-lfotile')).filter((v, i, a) => a.indexOf(v) === i),
    ['1', '2', '3', '4', '5', '6']);
  u.destroy();
  assert.equal(el.isConnected, false);
  assert.deepEqual(host.log.filter(x => x[0] === 'monitor'), [['monitor', true], ['monitor', false]]);
});

test('SerumUI: knob right-click menu (exact items) and its actions', async () => {
  const { doc, host, u, s } = await mount();
  const knob = byDest(u.el, 'f.cutoff');
  fire(knob, 'contextmenu', { clientX: 50, clientY: 60 });
  let m = ctxMenus(doc);
  assert.equal(m.length, 1);
  assert.deepEqual(menuLabels(m[0]), ['Reset Control', 'Enter Value…', '', 'Mod Source', '', 'MIDI Learn', 'Lock']);
  pick(doc, 'Mod Source');
  pick(doc, 'LFO 3');
  await flush(doc);
  assert.deepEqual(s().matrix[0], row({ src: 'lfo3', amt: 0.5, dst: 'f.cutoff' }));
  assert.equal(s().ui.mod, 'lfo3');
  assert.ok(knob.classList.contains('wk-modded'));                    // halo drawn
  fire(knob, 'contextmenu', { clientX: 50, clientY: 60 });
  m = ctxMenus(doc);
  assert.deepEqual(menuLabels(m[m.length - 1]).slice(0, 4), ['Bypass Modulator: LFO 3', 'Remove Modulator: LFO 3', 'Remove All Modulators', '']);
  pick(doc, 'Bypass Modulator: LFO 3');
  assert.equal(s().matrix[0].byp, 1);
  fire(knob, 'contextmenu', { clientX: 50, clientY: 60 });
  pick(doc, 'Lock');
  assert.deepEqual(s().locks.p, ['f.cutoff']);
  fire(knob, 'contextmenu', { clientX: 50, clientY: 60 });
  pick(doc, 'MIDI Learn');
  await flush(doc);
  assert.deepEqual(host.log.filter(x => x[0] === 'learn'), [['learn', 'f.cutoff']]);
  await flush(doc);
  fire(knob, 'contextmenu', { clientX: 50, clientY: 60 });
  m = ctxMenus(doc);
  assert.deepEqual(menuLabels(m[m.length - 1]).slice(-3), ['MIDI Re-learn (CC 33)', 'Remove MIDI CC 33', 'Unlock']);
  pick(doc, 'Remove MIDI CC 33');
  assert.deepEqual(s().midi, {});
  fire(knob, 'contextmenu', { clientX: 50, clientY: 60 });
  pick(doc, 'Remove Modulator: LFO 3');
  assert.equal(s().matrix[0].src, '');
  s().p['f.cutoff'] = 0.9;
  fire(knob, 'contextmenu', { clientX: 50, clientY: 60 });
  pick(doc, 'Reset Control');
  assert.equal(s().p['f.cutoff'], 0.5);
  // module power button: module items first, then the knob menu of a.on
  const pw = byDest(u.el, 'a.on');
  assert.equal(pw.getAttribute('data-module'), 'oscA');
  fire(pw, 'contextmenu', { clientX: 10, clientY: 10 });
  m = ctxMenus(doc);
  assert.deepEqual(menuLabels(m[m.length - 1]).slice(0, 5), ['Lock Module', 'Copy OSC', 'Init OSC', '', 'Reset Control']);
  pick(doc, 'Copy OSC');
  const pwB = byDest(u.el, 'b.on');
  fire(pwB, 'contextmenu', { clientX: 10, clientY: 10 });
  m = ctxMenus(doc);
  assert.deepEqual(menuLabels(m[m.length - 1]).slice(0, 5), ['Lock Module', 'Copy OSC', 'Paste OSC', 'Init OSC', '']);
  s().p['a.level'] = 0.2;
  u.edit(st => { st.p['a.level'] = 0.2; });
  fire(pwB, 'contextmenu', { clientX: 10, clientY: 10 });
  pick(doc, 'Lock Module');
  assert.deepEqual(s().locks.mod, ['oscB']);
  u.destroy();
});

test('SerumUI: tile drag-and-drop onto a control, the matrix and an LFO point; Alt-drag depth; Shift+Alt type', async () => {
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
  // Alt-drag on the knob edits the selected source's row, else the most recent row (200 px = 2.0)
  u.selectSrc('lfo2');
  ptr(res, 'pointerdown', 100, 100, { altKey: true });
  ptr(el, 'pointermove', 100, 50);
  ptr(el, 'pointerup', 100, 50);
  near(s().matrix[0].amt, 0.8, 1e-9);
  assert.ok(host.log.some(x => x[1] === 'Mod depth' && x[2] === 'end'));
  ptr(res, 'pointerdown', 100, 100, { altKey: true, shiftKey: true });
  assert.equal(s().matrix[0].bi, 1);
  // the depth handle works without Alt
  ptr(res.querySelector('.wk-dh'), 'pointerdown', 100, 100);
  ptr(el, 'pointermove', 100, 300);
  ptr(el, 'pointerup', 100, 300);
  near(s().matrix[0].amt, -1, 1e-9);
  // drop onto a matrix SOURCE cell
  u.setPage('matrix');
  await flush(doc);
  const cell = el.querySelectorAll('[data-msrc="src"]')[5];
  doc.pointAt = () => cell.querySelector('button');
  const lfo1 = u.pages.matrix.el.querySelector('[data-src="lfo1"]');
  ptr(lfo1, 'pointerdown', 10, 10); ptr(lfo1, 'pointermove', 30, 30); ptr(lfo1, 'pointerup', 30, 30);
  assert.equal(s().matrix[5].src, 'lfo1');
  // drop onto an LFO point → X / Y menu → new bus with its row
  u.setPage('osc');
  u.selectSrc('lfo1');
  await flush(doc);
  s().lfo[0].pts = [[0, 0, 0], [0.5, 1, 0], [1, 0, 0]];
  u.lfoBox._rect = { left: 0, top: 200, width: 200, height: 100 };
  doc.pointAt = () => u.lfoBox;
  const velo = el.querySelector('[data-src="velo"]');
  ptr(velo, 'pointerdown', 10, 10); ptr(velo, 'pointermove', 99, 203); ptr(velo, 'pointerup', 99, 203);
  const m = ctxMenus(doc);
  assert.deepEqual(menuLabels(m[m.length - 1]), ['X', 'Y']);
  pick(doc, 'Y');
  assert.deepEqual(s().lfo[0].pts[1], [0.5, 1, 0, 0, 1]);
  assert.ok(s().matrix.some(r => r.src === 'velo' && r.dst === 'bus1' && r.bi === 1 && r.amt === 0.5));
  u.destroy();
});

test('SerumUI: halos and live dots from snapshots, voice counter, phase capture (§6.4)', async () => {
  const { doc, host, u, s } = await mount();
  u.edit(st => { st.matrix[0] = row({ src: 'lfo1', amt: 0.4, dst: 'a.wt' }); st.p['a.phase'] = 1; st.p['a.rand'] = 0.5; });
  await flush(doc);
  const wtk = byDest(u.el, 'a.wt');
  assert.ok(wtk.classList.contains('wk-modded'));
  const eff = new Float32Array(248);
  eff[core.DEST_INDEX['a.wt']] = 0.3;
  const memNow = new Float32Array(32).fill(0.25);
  u.setSnapshot({ s: { eff, notes: 1, oscVoices: 3, maxVoices: 136, memNow, wtPos: new Float32Array([0.3, 0]), lfoPh: new Float32Array(8), envStage: new Uint8Array(3), envT: new Float32Array(3) }, gr: null, fxph: null });
  await flush(doc);
  const live = wtk.querySelector('.wk-live');
  assert.notEqual(live.getAttribute('display'), 'none');
  assert.equal(u.vcEl.textContent, '3 / 136');
  const amber = u.el.querySelectorAll('.sx-amber');
  assert.equal(amber.length, 0);
  const randKnob = byDest(u.el, 'a.rand');
  fire(randKnob, 'keydown', { key: 'End' });                          // RAND → 100 % while PHASE is Mem and a note sounds
  await flush(doc);
  assert.deepEqual(s().osc[0].memSet, new Array(16).fill(0.25));
  assert.ok(host.log.some(x => x[1] === 'Capture phases'));
  u.setSnapshot({ s: { eff, notes: 0, oscVoices: 200, maxVoices: 300, memNow }, gr: null, fxph: null });
  await flush(doc);
  assert.ok(u.el.querySelectorAll('.sx-amber').length >= 1);         // UNISON tinted above 128 oscillator voices
  u.destroy();
});

test('SerumUI: matrix page (32 rows, Alt-click reassign / bypass, row menu) and main menu actions', async () => {
  const { doc, host, u, s } = await mount();
  u.edit(st => { st.matrix[0] = row({ src: 'lfo1', amt: 0.4, dst: 'a.wt' }); st.matrix[4] = row({ src: 'lfo1', amt: 0.1, dst: 'f.cutoff' }); });
  u.setPage('matrix');
  await flush(doc);
  const rows = u.pages.matrix.el.querySelectorAll('.sx-mrow');
  assert.equal(rows.length, 32);
  assert.equal(rows[0].classList.contains('sx-dim'), false);
  assert.equal(rows[1].classList.contains('sx-dim'), true);
  fire(u.el.querySelector('[data-malt="src"][data-slot="0"]').querySelector('button'), 'click', { altKey: true, clientX: 5, clientY: 5 });
  pick(doc, 'Env 3');
  assert.deepEqual([s().matrix[0].src, s().matrix[4].src], ['env3', 'env3']);
  fire(u.el.querySelector('[data-malt="mode"][data-slot="4"]').querySelector('button'), 'click', { altKey: true });
  assert.equal(s().matrix[4].byp, 1);
  fire(u.el.querySelector('[data-malt="mode"][data-slot="4"]').querySelector('button'), 'click');
  assert.equal(s().matrix[4].inv, 1);
  fire(rows[4].querySelector('.sx-mmore').querySelector('button'), 'click');
  pick(doc, 'Duplicate');
  assert.deepEqual(s().matrix[1], s().matrix[4]);
  fire(rows[4].querySelector('.sx-mmore').querySelector('button'), 'click');
  pick(doc, 'Move Up');
  assert.equal(s().matrix[3].dst, 'f.cutoff');
  // main menu
  const menuBtn = u.el.querySelectorAll('.sx-hbtn').find(b => b.textContent === 'Menu');
  fire(menuBtn, 'click');
  assert.deepEqual(menuLabels(ctxMenus(doc)[0]), ['Init Preset', 'Init All LFOs', '', 'Render OSC A Warp', 'Render OSC B Warp', 'Resample to OSC A',
    'Resample to OSC B', 'Resample to A+B (Stereo)', '', 'Lock FX Rack', 'Load Effect Chain…', 'Save Effect Chain…', '', 'Velo->Amp', 'Vibrato quick-assign', '', 'About']);
  pick(doc, 'Velo->Amp');
  assert.ok(s().matrix.some(r => r.src === 'fixed' && r.dst === 'g.amp' && r.aux === 'velo' && r.inv === 1));
  fire(menuBtn, 'click');
  pick(doc, 'Resample to A+B (Stereo)');
  assert.deepEqual(host.log.filter(x => x[0] === 'resample'), [['resample', 'AB']]);
  fire(menuBtn, 'click');
  pick(doc, 'Lock FX Rack');
  assert.equal(host.st.fx.lock, 1);
  // Init Preset keeps locks (applyPreset) and the FX lock (applyPresetFx)
  u.edit(st => { st.p['f.cutoff'] = 0.9; st.locks.p.push('f.cutoff'); st.p['a.level'] = 0.1; });
  fire(menuBtn, 'click');
  pick(doc, 'Init Preset');
  assert.equal(s().p['f.cutoff'], 0.9);
  assert.equal(s().p['a.level'], 0.75);
  assert.equal(s().matrix.filter(r => r.src).length, 0);
  assert.equal(s().ui.page, 'matrix');
  assert.equal(host.st.fx.lock, 1);
  assert.equal(u.dirty, false);
  u.destroy();
});

test('SerumUI: GLOBAL preferences persist; FX page embeds the rack with the §8.7.2 adapter', async () => {
  const { doc, host, u, s } = await mount();
  u.setPage('global');
  await flush(doc);
  const prefRow = u.pages.global.el.querySelectorAll('.sx-pref').find(r => r.firstChild.textContent === 'Ask before preset change when edited');
  fire(prefRow.querySelector('button'), 'click');
  assert.equal(host.store.get(ui.PREFS_KEY).askPreset, 1);
  const os = u.pages.global.el.querySelectorAll('.sx-seg')[0].querySelectorAll('button');
  fire(os[2], 'click');
  assert.equal(s().global.os, 4);
  u.setPage('fx');
  await flush(doc);
  const rack = fxStub.made[fxStub.made.length - 1];
  assert.equal(rack.opts.embedded, true);
  assert.equal(rack.host.fx(), host.st.fx);
  assert.equal(rack.host.locked('fx.dly.mix'), false);
  s().locks.p.push('fx.dly.mix');
  assert.equal(rack.host.locked('fx.dly.mix'), true);
  rack.host.editFx(fx => { fx.p['fx.dly.on'] = 1; }, { label: 'x' });
  assert.equal(host.st.fx.p['fx.dly.on'], 1);
  assert.equal(rack.host.gr(), null);
  u.setSnapshot({ s: null, gr: new Float32Array([1, 0, 0, 0]), fxph: null });
  assert.equal(rack.host.gr()[0], 1);
  assert.ok(rack.n >= 1);
  u.destroy();
  assert.equal(rack.dead, true);
});

test('PresetBrowser: sort, secondary sort, browse-to-audition, Enter, Delete (user only), ◀ ▶ within the category, ask before change', async () => {
  const { doc, host, u, s } = await mount();
  const nameBtn = u.el.querySelector('.sx-pname');
  assert.match(nameBtn.textContent, /Deep Bass/);
  fire(nameBtn, 'click');
  const ov = u.el.querySelector('.pb-root');
  assert.ok(ov);
  const names = () => ov.querySelectorAll('.pb-row').map(r => r.firstChild.firstChild.textContent);
  assert.deepEqual(names(), ['Acid Bass', 'Deep Bass', 'Init', 'My Bass', 'Soft Pad']);
  const cols = ov.querySelector('.pb-hd').querySelectorAll('button');
  fire(cols[2], 'click');                                               // Author (ties → Name, the previous column)
  assert.deepEqual(names(), ['Init', 'Deep Bass', 'Soft Pad', 'Acid Bass', 'My Bass']);
  assert.equal(cols[2].getAttribute('aria-sort'), 'ascending');
  fire(cols[1], 'click');                                               // Category, ties → Author
  assert.deepEqual(names(), ['Deep Bass', 'Acid Bass', 'My Bass', 'Init', 'Soft Pad']);
  fire(cols[1], 'click');
  assert.equal(cols[1].getAttribute('aria-sort'), 'descending');
  assert.deepEqual(host.store.get(ui.BROWSER_KEY), { sort: 'cat', sort2: 'author', dir: -1, cat: '', q: '' });
  fire(cols[1], 'click');
  const list = ov.querySelector('.pb-list');
  fire(list, 'keydown', { key: 'ArrowDown' });                          // browse-to-audition
  assert.deepEqual(host.log.filter(x => x[0] === 'load'), [['load', 'f:2']]);
  fire(list, 'keydown', { key: 'ArrowDown' });
  fire(list, 'keydown', { key: 'Delete' });                             // user preset: confirm + delete
  assert.deepEqual(host.log.filter(x => x[0] === 'del'), [['del', 'u:1']]);
  assert.equal(doc.defaultView.confirms.length, 1);
  fire(list, 'keydown', { key: 'Home' });
  fire(list, 'keydown', { key: 'Delete' });                             // factory: nothing
  assert.equal(host.log.filter(x => x[0] === 'del').length, 1);
  fire(list, 'keydown', { key: 'Enter' });
  assert.equal(u.el.querySelector('.pb-root'), null);
  // header ◀ ▶ step within the current preset's category, in the browser's sort order (Category, Author)
  host.presets.load('f:1');
  u.refresh();
  const arrowsB = u.el.querySelector('.sx-preset').querySelectorAll('.sx-hbtn');
  fire(arrowsB[3], 'click');
  assert.equal(host.presets.current(), 'f:2');
  fire(arrowsB[3], 'click');
  assert.equal(host.presets.current(), 'f:1');                          // wraps inside Bass (the user preset was deleted)
  // ask before preset change when edited
  u.setPref('askPreset', 1);
  u.edit(st => { st.p['a.level'] = 0.5; });
  doc.defaultView.answer = false;
  fire(arrowsB[1], 'click');
  assert.equal(host.presets.current(), 'f:1');
  doc.defaultView.answer = true;
  fire(arrowsB[1], 'click');
  assert.equal(host.presets.current(), 'f:2');
  assert.equal(u.dirty, false);
  // save dialog
  fire(arrowsB[0], 'click');
  const dlg = u.el.querySelector('.sx-dlg');
  const [nameI, catI] = dlg.querySelectorAll('input');
  nameI.value = 'New One'; catI.value = 'Keys';
  fire(dlg.querySelectorAll('button').find(b => b.textContent === 'Save'), 'click');
  assert.deepEqual(host.log.filter(x => x[0] === 'save'), [['save', 'New One', 'Keys']]);
  assert.equal(u.el.querySelector('.sx-dlg'), null);
  u.destroy();
});

test('SerumUI: WT editor overlay, LFO → wavetable / noise, Wavetable to LFO Shape, Render warp guard', async () => {
  const { doc, host, u, s } = await mount();
  const edBtn = u.el.querySelectorAll('.sx-hbtn').find(b => b.getAttribute('aria-label') === 'Open wavetable editor (OSC A)');
  fire(edBtn, 'click');
  const ed = wteStub.made[wteStub.made.length - 1];
  assert.equal(ed.isOpen, true);
  assert.equal(ed.o.osc, 0);
  assert.equal(u.editorOsc, 0);
  // the editor's host: the SerumUI host with edit routed through SerumUI (dirty tracking, §8.8)
  assert.equal(ed.o.host.wt, host.wt);
  assert.equal(ed.o.host.state(), host.st.s);
  assert.equal(ed.o.host.storage, host.storage);
  u.dirty = false;
  ed.o.host.edit(st => { st.osc[0].wt = 'user:copy'; }, { label: 'Edit wavetable' });
  assert.equal(s().osc[0].wt, 'user:copy');
  assert.equal(u.dirty, true);
  assert.ok(host.log.some(x => x[0] === 'edit' && x[1] === 'Edit wavetable'));
  u.dirty = false;
  ed.o.host.edit(() => {}, { label: 'View', ui: true });
  assert.equal(u.dirty, false);
  u.edit(st => { st.osc[0].wt = 'factory:Default'; });
  const ov = u.el.querySelector('.sx-ov');
  fire(ov, 'keydown', { key: 'Escape' });
  assert.equal(u.el.querySelector('.sx-ov'), null);
  assert.equal(ed.isOpen, false);
  assert.equal(u.editorOsc, null);
  await u.lfoToWavetable(0, 1);
  assert.equal(s().osc[1].wt, 'user:new');
  await u.lfoToNoise(2);
  assert.equal(s().noise.src, 'nzuser:new');
  assert.ok(wtStub.calls.some(c => c[0] === 'lfoToNoise' && c[1] === 1025));
  await flush(doc);
  u.wtToLfo(0);
  assert.deepEqual(s().lfo[0].pts, [[0, 0.5, 0], [0.5, 1, 0], [1, 0.5, 0]]);
  await u.renderOscWarp(0);                                             // no DSP loaded in node → notice, no change
  assert.ok(host.log.some(x => x[0] === 'notify' && /Render OSC Warp/.test(x[1])));
  u.destroy();
});

/* ================================================================ review round 2 */
const live = s => s.matrix.filter(r => r.src).map(r => r.src + '>' + r.dst);

test('linkPoints / ptsBuses: a matrix row aimed at a bus no point ever linked survives new links and relinks (inv A13)', () => {
  const s = fresh(), fx = core.defaultFx();
  s.lfo[0].pts = [[0, 0, 0], [0.3, 1, 0], [0.6, 0.5, 0], [1, 0, 0]];
  s.matrix[0] = row({ src: 'lfo2', amt: 0.5, dst: 'bus1', bi: 1 });          // routing prepared before linking
  assert.equal(core.newBus(s), 2);
  assert.equal(ui.linkPoints(s, fx, 0, [1], 'y', 2, 'lfo3'), 1);
  assert.deepEqual(live(s), ['lfo2>bus1', 'lfo3>bus2']);
  ui.linkPoints(s, fx, 0, [1], 'y', 3, null);                                 // bus 2 lost its only link: pruned
  assert.deepEqual(live(s), ['lfo2>bus1']);
  ui.linkPoints(s, fx, 0, [2], 'x', 1, null);                                 // linking to the prepared bus keeps it
  assert.deepEqual(live(s), ['lfo2>bus1']);
  assert.deepEqual(ui.ptsBuses([[0, 0, 0], [0.5, 1, 0, 4, 3], [0.7, 0, 0, 0, 4], [1, 0, 0], 'x', null]), [4, 3]);
  assert.deepEqual(ui.ptsBuses(null), []);
});

test('groupItems: one contiguous run per group, explicit order first, stable inside a group', () => {
  const items = [{ v: '', group: '' }, { v: 1, group: 'A' }, { v: 2, group: 'B' }, { v: 3, group: 'A' }, { v: 4, group: 'User' }, { v: 5, group: 'B' }];
  assert.deepEqual(ui.groupItems(items).map(x => x.v), ['', 1, 3, 2, 5, 4]);
  assert.deepEqual(ui.groupItems(items, ['B', 'A']).map(x => x.v), [2, 5, 1, 3, '', 4]);
  assert.deepEqual(items.map(x => x.v), ['', 1, 2, 3, 4, 5]);                 // input untouched
  assert.deepEqual(ui.groupItems([]), []);
});

test('layers3d: real frames of morph tables are always drawn (green), interpolated slots fill up to 40 (§9.3, §7.1)', () => {
  const real = L => L.filter(x => x.real).map(x => x.slot).sort((a, b) => a - b);
  const l5 = ui.layers3d(256, 5);
  assert.deepEqual(real(l5), [0, 64, 128, 191, 255]);
  assert.deepEqual(l5.filter(x => x.real).map(x => x.frame).sort((a, b) => a - b), [0, 1, 2, 3, 4]);
  assert.ok(l5.length <= 40 && l5.length > 30);
  for (let i = 1; i < l5.length; i++) assert.ok(l5[i - 1].z >= l5[i].z);    // back to front
  assert.equal(new Set(l5.map(x => x.slot)).size, l5.length);
  const l32 = ui.layers3d(256, 32);
  assert.equal(real(l32).length, 32);
  assert.deepEqual(real(l32).slice(0, 3), [0, 8, 16]);
  assert.equal(ui.layers3d(256, 100).filter(x => x.real).length, 40);        // many frames: 40 real layers
  const raw = ui.layers3d(10, 10);
  assert.equal(raw.length, 10);
  assert.ok(raw.every(x => x.real && x.frame === x.slot));
  assert.equal(ui.layers3d(256, 256).length, 40);
  assert.deepEqual(ui.layers3d(1, 1), [{ z: 0, slot: 0, frame: 0, real: true }]);
});

test('isPristine: the untouched default (any view, oversampling, author) only', () => {
  const s = fresh();
  assert.equal(ui.isPristine(s), true);
  s.global.os = 4; s.author = 'Me'; s.ui.view3d = [1, 0]; s.ui.page = 'fx';
  assert.equal(ui.isPristine(s), true);
  s.p['a.level'] = 0.2;
  assert.equal(ui.isPristine(s), false);
  assert.equal(ui.isPristine(null), false);
});

test('SerumUI: LFO graph edits, shape loads and Wavetable to LFO prune only the buses that lost their links', async () => {
  const { doc, u, s } = await mount();
  const ed = gxStub.made.filter(e => e.o.kind === 'lfo').pop();
  const P = () => JSON.parse(JSON.stringify(s().lfo[0].pts));
  u.edit(st => {
    st.lfo[0].pts = [[0, 0, 0], [0.3, 1, 0, 0, 2], [0.6, 0.5, 0], [1, 0, 0]];
    st.matrix[0] = row({ src: 'env2', amt: 0.5, dst: 'bus3', bi: 1 });       // bus 3: no point links it
    st.matrix[1] = row({ src: 'lfo2', amt: 0.5, dst: 'bus2', bi: 1 });
  });
  let p = P();
  p[2][1] = 0.4;
  ed.o.set(p, 'start'); ed.o.set(p, 'move'); ed.o.set(p, 'end');           // ordinary drag: nothing pruned
  assert.deepEqual(live(s()), ['env2>bus3', 'lfo2>bus2']);
  p = P(); p.push([1, 0.2, 0]); p.splice(3, 1);
  ed.o.set(p, 'set');                                                         // add / move a point
  assert.deepEqual(live(s()), ['env2>bus3', 'lfo2>bus2']);
  const linked = P();
  p = P(); p.splice(1, 1);
  ed.o.set(linked, 'start'); ed.o.set(p, 'move'); ed.o.set(p, 'end');      // the linked point goes mid-drag
  assert.deepEqual(live(s()), ['env2>bus3']);
  // a shape load replacing linked points
  u.edit(st => { st.lfo[0].pts = [[0, 0, 0], [0.3, 1, 0, 0, 4], [1, 0, 0]]; st.matrix[2] = row({ src: 'velo', amt: 0.5, dst: 'bus4', bi: 1 }); });
  u.lfoFolderMenu(u.el.querySelector('.sx-hbtn'));
  pick(doc, 'Load Shape');
  const sub = ctxMenus(doc);
  pick(doc, sub[sub.length - 1].querySelectorAll('.wk-ci')[0].querySelector('.wk-cl').textContent);
  assert.deepEqual(live(s()), ['env2>bus3']);
  // Wavetable to LFO Shape
  u.edit(st => { st.lfo[0].pts = [[0, 0, 0], [0.3, 1, 0, 0, 5], [1, 0, 0]]; st.matrix[2] = row({ src: 'velo', amt: 0.5, dst: 'bus5', bi: 1 }); });
  await flush(doc);
  u.wtToLfo(0);
  assert.deepEqual(live(s()), ['env2>bus3']);
  u.destroy();
});

test('SerumUI: DESTINATION and wavetable menus show each group once (§9.5, §9.3)', async () => {
  const lst = [{ id: 'factory:A', name: 'A', cat: 'Basic', user: false }, { id: 'factory:B', name: 'B', cat: 'Digital', user: false },
    { id: 'user:1', name: 'Mine', cat: '', user: true }, { id: 'factory:C', name: 'C', cat: 'FM', user: false }, { id: 'factory:D', name: 'D', cat: 'Digital', user: false }];
  const { u } = await mount(null, h => { h.wt.list = () => lst; });
  const runs = items => items.map(x => x.group).filter((g, i, a) => i === 0 || g !== a[i - 1]);
  const di = u.destItems();
  assert.equal(di[0].v, '');
  assert.equal(di.length, core.DESTS.length + 1);
  const groups = new Set(core.DESTS.map(d => d.group));
  assert.equal(runs(di.slice(1)).length, groups.size);
  for (const g of groups) {                                                 // DESTS order inside every group
    const ids = di.filter(x => x.group === g).map(x => core.DEST_INDEX[x.v]);
    assert.deepEqual(ids, ids.slice().sort((a, b) => a - b));
  }
  assert.deepEqual(u.wtItems(0).map(x => x.label), ['A', 'B', 'D', 'C', 'Mine', 'Default']);
  assert.deepEqual(runs(u.wtItems(0)), ['Basic', 'Digital', 'FM', 'User', 'Current']);
  u.destroy();
});

test('SerumUI: effect chains from the main menu follow the rack rules (single-chain files, locked FX values, sorted)', async () => {
  const { host, u } = await mount();
  u.edit(st => { st.locks.p.push('fx.dly.mix'); });
  host.st.fx.p['fx.dly.mix'] = 0.123;
  host.st.fx.lock = 1;
  const chain = core.defaultFx();
  chain.p['fx.dly.mix'] = 0.9; chain.p['fx.rev.on'] = 1;
  // the rack's Export Effect Chain… format loads
  assert.equal(u.importChainText(JSON.stringify({ type: 'synth.fxchain', v: 1, name: 'Wide', fx: chain }), 'Wide.fxchain.json'), 1);
  assert.equal(host.st.fx.p['fx.rev.on'], 1);
  assert.equal(host.st.fx.p['fx.dly.mix'], 0.123);                          // locked parameter keeps its value
  assert.equal(host.st.fx.lock, 1);
  assert.ok(host.log.some(x => x[0] === 'editFx' && x[1] === 'Load Effect Chain'));
  assert.ok(host.log.some(x => x[0] === 'notify' && /Wide/.test(x[1])));
  // a library file merges by name: normalised copies without ui / lock, sorted by name
  const raw = Object.assign(core.defaultFx(), { lock: 1 });
  assert.equal(u.importChainText(JSON.stringify({ type: 'synth.fxchains', v: 1, chains: [{ name: 'Zed', fx: raw }, { name: ' Alpha ', fx: { p: {} } }, { name: 'bad' }] })), 2);
  const stored = host.store.get('synth.fxchains');
  assert.deepEqual(stored.map(c => c.name), ['Alpha', 'Zed']);
  for (const c of stored) { assert.equal(c.fx.ui, undefined); assert.equal(c.fx.lock, undefined); assert.ok(Array.isArray(c.fx.order)); }
  assert.equal(u.importChainText(JSON.stringify({ hello: 1 })), 0);
  assert.ok(host.log.some(x => x[0] === 'notify' && x[1] === 'No effect chains in that file'));
  u.loadChain(stored[1].fx, 'Zed');
  assert.equal(host.st.fx.p['fx.dly.mix'], 0.123);
  // Load Effect Chain ▸ Factory: serum-core FACTORY_CHAINS first, loaded by the same rules (locked values kept, never stored)
  const menu = u.chainMenu(), hall = core.FACTORY_CHAINS.chains.find(c => c.name === 'Hall Verb').fx;
  assert.equal(menu[0].label, 'Factory');
  assert.deepEqual(menu[0].sub.map(i => i.label), core.FACTORY_CHAINS.chains.map(c => c.name));
  assert.deepEqual(menu.slice(2, 4).map(i => i.label), ['Alpha', 'Zed']);
  menu[0].sub.find(i => i.label === 'Hall Verb').action();
  assert.equal(host.st.fx.p['fx.rev.on'], 1);
  assert.equal(host.st.fx.p['fx.rev.size'], hall.p['fx.rev.size']);
  assert.equal(host.st.fx.p['fx.dly.mix'], 0.123);
  assert.deepEqual(host.store.get('synth.fxchains').map(c => c.name), ['Alpha', 'Zed']);
  u.destroy();
});

test('SerumUI: Rename for user tables without host.wt.rename (full update), internal-rate text, view3d preference on new tracks', async () => {
  const { doc, host, u, s } = await mount();
  const ups = [];
  host.wt.update = (id, t, o) => { ups.push([id, t.name, t.frames.length, o]); };
  u.edit(st => { st.osc[0].wt = 'user:1'; });
  await flush(doc);
  const ren = u.el.querySelectorAll('.sx-hbtn').filter(b => b.getAttribute('aria-label') === 'Rename user wavetable')[0];
  assert.equal(ren.classList.contains('sx-hidden'), false);
  fire(ren, 'click');
  const dlg = u.el.querySelector('.sx-dlg');
  dlg.querySelector('input').value = 'Renamed';
  fire(dlg.querySelectorAll('button').find(b => b.textContent === 'OK'), 'click');
  await flush(doc);
  assert.deepEqual(ups, [['user:1', 'Renamed', 3, {}]]);
  delete host.wt.update;
  u.refresh();
  assert.equal(ren.classList.contains('sx-hidden'), true);                  // neither rename nor get + update
  // effective internal rate: snapshot tapRate first, then host.sampleRate, else a generic line
  assert.match(u.osText(), /^Runs at 2× the device rate/);
  host.sampleRate = () => 48000;
  assert.equal(u.osText(), 'Running at 96 kHz');
  u.setSnapshot({ s: { notes: 0, tapRate: 88200 }, gr: null, fxph: null });
  assert.equal(u.osText(), 'Running at 88.2 kHz');
  u.destroy();
  // "Default WT view" 3D: a pristine new track opens in 3D, an edited sound keeps its view
  const prefs = Object.assign({}, ui.PREFS_DEFAULT, { view3d: 1 });
  const m1 = await mount(null, h => { h.store.set(ui.PREFS_KEY, prefs); h.st.s.global.os = 4; });
  assert.deepEqual(m1.s().ui.view3d, [1, 1]);
  assert.equal(m1.u.dirty, false);
  m1.u.destroy();
  const m2 = await mount(null, h => { h.store.set(ui.PREFS_KEY, prefs); h.st.s.p['a.level'] = 0.3; });
  assert.deepEqual(m2.s().ui.view3d, [0, 0]);
  m2.u.destroy();
  void s;
});

test('SerumUI: Delete user wavetable / noise (host.wt.del, confirmation naming the users), Save over a user preset asks', async () => {
  const { doc, host, u, s } = await mount();
  const dels = [];
  host.wt.del = id => { dels.push(id); host.st.s.osc[0].wt = 'factory:Default'; return Promise.resolve(true); };
  host.wt.users = id => ['Track 1', 'Track 3'];
  const btnBy = l => u.el.querySelectorAll('.sx-hbtn').filter(b => b.getAttribute('aria-label') === l)[0];
  const del = btnBy('Delete user wavetable');
  assert.equal(del.classList.contains('sx-hidden'), true, 'hidden for a factory table');
  u.edit(st => { st.osc[0].wt = 'user:1'; });
  await flush(doc);
  assert.equal(del.classList.contains('sx-hidden'), false, 'shown for a user table');
  const win = doc.defaultView;
  win.answer = false;
  fire(del, 'click');
  await flush(doc);
  assert.deepEqual(dels, [], 'declined: nothing deleted');
  assert.match(win.confirms.at(-1), /Mine/);
  assert.match(win.confirms.at(-1), /Track 1, Track 3/);
  win.answer = true;
  fire(del, 'click');
  await flush(doc);
  assert.deepEqual(dels, ['user:1']);
  assert.ok(host.log.some(x => x[0] === 'notify' && /Deleted “Mine”/.test(x[1])));
  // noise: the button follows nzuser: sources
  const nd = btnBy('Delete user noise');
  assert.equal(nd.classList.contains('sx-hidden'), true);
  u.edit(st => { st.noise.src = 'nzuser:9'; });
  await flush(doc);
  assert.equal(nd.classList.contains('sx-hidden'), false);
  delete host.wt.del;
  u.refresh();
  assert.equal(nd.classList.contains('sx-hidden'), true, 'no host.wt.del: no button');
  // Save Preset under the name of an existing user preset asks before replacing it
  u.savePresetDialog();
  let dlg = u.el.querySelector('.sx-dlg');
  dlg.querySelector('input').value = 'My Bass';
  win.answer = false;
  const saves = () => host.log.filter(x => x[0] === 'save').length;
  fire(dlg.querySelectorAll('button').find(b => b.textContent === 'Save'), 'click');
  assert.equal(saves(), 0, 'declined: not saved');
  assert.match(win.confirms.at(-1), /Replace the saved preset “My Bass”/);
  win.answer = true;
  fire(dlg.querySelectorAll('button').find(b => b.textContent === 'Save'), 'click');
  assert.equal(saves(), 1);
  const nConf = win.confirms.length;
  u.savePresetDialog();
  dlg = u.el.querySelector('.sx-dlg');
  dlg.querySelector('input').value = 'Brand New';
  fire(dlg.querySelectorAll('button').find(b => b.textContent === 'Save'), 'click');
  assert.equal(saves(), 2);
  assert.equal(win.confirms.length, nConf, 'a new name saves without asking');
  u.destroy();
  void s;
});

test('SerumUI: the wavetable menu arrows step inside the current category and wrap there', async () => {
  const lst = [['factory:A1', 'A1', 'Basic'], ['factory:A2', 'A2', 'Basic'], ['factory:B1', 'B1', 'Analog'], ['factory:B2', 'B2', 'Analog'], ['user:1', 'Mine', '']];
  const { doc, u, s } = await mount({}, h => { h.wt.list = () => lst.map(([id, name, cat]) => ({ id, name, cat, user: id.startsWith('user:') })); });
  const next = u.el.querySelectorAll('button').filter(b => b.getAttribute('aria-label') === 'Next OSC A wavetable')[0];
  const prev = u.el.querySelectorAll('button').filter(b => b.getAttribute('aria-label') === 'Previous OSC A wavetable')[0];
  u.edit(st => { st.osc[0].wt = 'factory:A2'; });
  await flush(doc);
  fire(next, 'click');
  assert.equal(s().osc[0].wt, 'factory:A1', 'wraps inside Basic');
  fire(prev, 'click');
  assert.equal(s().osc[0].wt, 'factory:A2');
  u.edit(st => { st.osc[0].wt = 'factory:B1'; });
  await flush(doc);
  fire(next, 'click');
  assert.equal(s().osc[0].wt, 'factory:B2');
  fire(next, 'click');
  assert.equal(s().osc[0].wt, 'factory:B1', 'wraps inside Analog');
  u.edit(st => { st.osc[0].wt = 'user:1'; });
  await flush(doc);
  fire(next, 'click');                                                     // a category of one: the whole list
  assert.equal(s().osc[0].wt, 'factory:A1');
  u.destroy();
});

test('SerumUI: WARP knob redraws its arc when the warp mode turns it bipolar (§9.3)', async () => {
  const { doc, u, s } = await mount();
  u.edit(st => { st.p['a.warp'] = 0.3; st.p['a.warpMode'] = 4 / 22; });
  await flush(doc);
  const k = byDest(u.el, 'a.warp'), d = () => k.querySelector('.wk-val').getAttribute('d'), txt = k.querySelector('.wk-num').textContent;
  const uni = d();
  u.edit(st => { st.p['a.warpMode'] = 6 / 22; });                          // Bend +/-
  await flush(doc);
  assert.notEqual(d(), uni);
  assert.equal(k.querySelector('.wk-num').textContent, txt);
  u.edit(st => { st.p['a.warpMode'] = 4 / 22; });
  await flush(doc);
  assert.equal(d(), uni);
  assert.equal(s().p['a.warp'], 0.3);
  u.destroy();
});

test('SerumUI: LFO → noise and WAV noise imports set oneshot to the new source default (§9.3, §7.9)', async () => {
  const { u, s } = await mount();
  u.edit(st => { st.noise.src = 'noise:Click'; st.noise.oneshot = 1; st.noise.keytrack = 0; });
  await u.lfoToNoise(0);
  assert.deepEqual([s().noise.src, s().noise.oneshot, s().noise.keytrack, s().p['n.on']], ['nzuser:new', 0, 1, 1]);
  u.edit(st => { st.noise.oneshot = 1; });
  await u.importNoiseFiles([{ name: 'loop.wav', arrayBuffer: async () => new ArrayBuffer(8) }]);    // smpl loop → loops
  assert.equal(s().noise.oneshot, 0);
  await u.importNoiseFiles([{ name: 'hit.wav', arrayBuffer: async () => new ArrayBuffer(16) }]);    // no loop → once
  assert.equal(s().noise.oneshot, 1);
  u.destroy();
});

test('SerumUI: phase capture ignores RAND crossings brought by a replaced state (preset load, undo)', async () => {
  const { doc, host, u, s } = await mount();
  u.edit(st => { st.p['a.phase'] = 1; st.p['a.rand'] = 0; });
  const memNow = new Float32Array(32).fill(0.37);
  u.setSnapshot({ s: { notes: 1, memNow, eff: new Float32Array(248) }, gr: null, fxph: null });
  await flush(doc);
  u.dirty = false;
  const next = fresh();
  next.p['a.phase'] = 1; next.p['a.rand'] = 1; next.osc[0].memSet = new Array(16).fill(0.5);
  host.st.s = next;                                                          // the host swaps the state and refreshes
  u.refresh();
  await flush(doc);
  assert.deepEqual(s().osc[0].memSet, new Array(16).fill(0.5));
  assert.equal(host.log.some(x => x[1] === 'Capture phases'), false);
  assert.equal(u.dirty, false);
  // the user's own RAND move still captures
  u.setN('a.rand', 0, 'set');
  await flush(doc);
  u.setN('a.rand', 1, 'set');
  await flush(doc);
  assert.deepEqual(s().osc[0].memSet, new Array(16).fill(0.37));
  u.destroy();
});

test('PresetBrowser: choosing the current preset again reloads it after edits or Init Preset', async () => {
  const { doc, host, u } = await mount();
  const loads = () => host.log.filter(x => x[0] === 'load').length;
  const rowOf = name => u.el.querySelectorAll('.pb-row').find(r => r.firstChild.firstChild.textContent === name);
  fire(u.el.querySelector('.sx-pname'), 'click');
  fire(rowOf('Deep Bass'), 'dblclick');                                      // unchanged: nothing to reload
  assert.equal(loads(), 0);
  assert.equal(u.el.querySelector('.pb-root'), null);
  u.edit(st => { st.p['f.cutoff'] = 0.123; });
  fire(u.el.querySelector('.sx-pname'), 'click');
  fire(rowOf('Deep Bass'), 'dblclick');
  assert.deepEqual(host.log.filter(x => x[0] === 'load'), [['load', 'f:1']]);
  assert.equal(u.dirty, false);
  assert.equal(u.el.querySelector('.pb-root'), null);
  const menuBtn = u.el.querySelectorAll('.sx-hbtn').find(b => b.textContent === 'Menu');
  fire(menuBtn, 'click');
  pick(doc, 'Init Preset');
  await flush(doc);
  assert.match(u.el.querySelector('.sx-pname').textContent, /Init/);
  fire(u.el.querySelector('.sx-pname'), 'click');
  fire(rowOf('Deep Bass'), 'click');
  assert.equal(loads(), 2);
  assert.equal(u.nameOverride, null);
  u.destroy();
});

test('SerumUI: Shift+Alt-click and Alt-drag on modulated switches do not also flip them; tile pointercancel', async () => {
  const { doc, u, s } = await mount();
  u.edit(st => { st.matrix[0] = row({ src: 'lfo1', amt: 0.5, dst: 'f.routeA' }); st.matrix[1] = row({ src: 'lfo1', amt: 0.5, dst: 'a.warpMode' }); });
  await flush(doc);
  const A = byDest(u.el, 'f.routeA'), a0 = s().p['f.routeA'];
  ptr(A, 'pointerdown', 5, 5, { altKey: true, shiftKey: true });
  ptr(A, 'pointerup', 5, 5, { altKey: true, shiftKey: true });
  fire(A, 'click', { altKey: true, shiftKey: true });
  assert.equal(s().matrix[0].bi, 1);
  assert.equal(s().p['f.routeA'], a0);
  fire(A, 'click');                                                          // a later plain click works again
  assert.notEqual(s().p['f.routeA'], a0);
  const wm = byDest(u.el, 'a.warpMode'), b = wm.querySelector('.wk-mbtn') || wm;
  const pops = () => doc.body.querySelectorAll('.wk-pop').length;
  ptr(b, 'pointerdown', 5, 5, { altKey: true, shiftKey: true });
  ptr(b, 'pointerup', 5, 5, { altKey: true, shiftKey: true });
  fire(b, 'click', { altKey: true, shiftKey: true });
  assert.equal(s().matrix[1].bi, 1);
  assert.equal(pops(), 0);
  // tile: a cancelled drag does not swallow the next click
  const t3 = u.el.querySelector('[data-src="lfo3"]');
  doc.pointAt = () => null;
  ptr(t3, 'pointerdown', 10, 10); ptr(t3, 'pointermove', 60, 10); ptr(t3, 'pointercancel', 60, 10);
  assert.equal(doc.body.querySelector('.sx-ghost'), null);
  fire(t3, 'click');
  assert.equal(s().ui.mod, 'lfo3');
  u.destroy();
});

test('SerumUI: remap popover releases its editor; noise overview (generateNoise, shared, skipped when deselected); file dialog cancel; dirty after resample / MIDI learn', async () => {
  const { doc, host, u, s } = await mount();
  const pen = u.el.querySelectorAll('.sx-hbtn').find(x => /remap/.test(x.getAttribute('aria-label') || ''));
  u.remapPopover(0, pen);
  const ed = u.pop.ed;
  assert.ok(u.edSig.has(ed));
  u.pop.close();
  assert.equal(u.edSig.has(ed), false);
  assert.equal(u.edKey.has(ed), false);
  // noise overview
  doc.defaultView.requestIdleCallback = f => { setTimeout(f, 0); return 1; };
  u.edit(st => { st.noise.src = 'noise:Rain'; });
  const gen = id => wtStub.calls.filter(c => c[0] === 'generateNoise' && c[1] === id).length;
  u.noiseOverview('noise:Rain');
  await flush(doc);
  const ov = u.noiseOverview('noise:Rain');
  assert.ok(ov instanceof Float32Array && ov.length === 512);
  assert.equal(gen('noise:Rain'), 1);
  assert.equal(u.noiseOverview('noise:Pink'), null);                          // not the selected source: skipped
  await flush(doc);
  assert.equal(gen('noise:Pink'), 0);
  const m2 = await mount();
  assert.equal(m2.u.noiseOverview('noise:Rain'), ov);                        // shared between panels
  assert.equal(gen('noise:Rain'), 1);
  m2.u.destroy();
  globalThis.document = doc;
  // a cancelled file dialog resolves and removes its input
  const pr = u.importChains();
  const inp = doc.body.querySelectorAll('input').find(i => i.type === 'file');
  assert.ok(inp);
  fire(inp, 'cancel');
  await pr;
  assert.equal(inp.isConnected, false);
  // resampling and MIDI learn change the sound (dirty)
  u.dirty = false;
  u.resample('A');
  await flush(doc);
  assert.equal(u.dirty, true);
  u.dirty = false;
  u.midiLearn('f.cutoff');
  await flush(doc);
  assert.equal(u.dirty, true);
  assert.equal(s().midi['33'], 'f.cutoff');
  u.destroy();
});
