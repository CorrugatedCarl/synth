// serum-core unit tests (spec §10.2). Run: node --test tests/serum-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as C from '../serum-core.js';
import { loadFixture } from './fixtures/load.mjs';

const {
  DESTS, DEST_INDEX, NS, NF, ND, SOURCES, SRC_INDEX, SRC_MENU, NSRC, FILTERS, WARPS, UNI_STACKS, UNI_MODES, DIST_MODES,
  MODFX_LADDER, DLY_LADDER, CMP_RATIO_DETENTS, LFO_LADDER, DIDX, FIDX, SIDX, SUB_IDS, MATRIX_ONLY, MODULE_FIELDS,
  lawValue, lawNorm, fmtParam, parseParam, defaultSerum, normalizeSerum, compileSerum, defaultFx, normalizeFx, compileFx, compileFxT,
  fxModded, lfoLadder, bend, evalPts, renderPts, uniTables, detuneShape, stackSemis, semitoneAmount, midiValue,
  isCenter, destLabel, varLabel, FACTORY_PRESETS, FACTORY_CHAINS,
  addMod, modsFor, removeMods, setModAmount, toggleModBypass, toggleModPolarity, reassignSource, veloToAmp, vibratoAssign,
  initLfos, copyLfo, linkedBuses, newBus, pruneBuses, clearPointMods, warpChoice, lfoUsed, applyPreset, applyPresetFx,
  destBase, copyModule,
} = C;

const json = f => JSON.parse(readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8'));
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);
const db = g => 20 * Math.log10(g);
const STEPPED = new Set(['int', 'enum', 'bool']);
const row = o => Object.assign({ src: '', amt: 0, dst: '', bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1 }, o);
const withRows = (rows, mut) => {
  const s = defaultSerum();
  rows.forEach((r, i) => { s.matrix[i] = row(r); });
  if (mut) mut(s);
  return normalizeSerum(s);
};

/* ------------------------------------------------------------ 1. destinations */

test('1 DESTS: counts, ids, index, fixture equality, grid-exact stepped defaults', () => {
  assert.equal(ND, 248);
  assert.equal(NS, 148);
  assert.equal(NF, 100);
  assert.equal(DESTS.length, 248);
  assert.equal(new Set(DESTS.map(d => d.id)).size, 248);
  DESTS.forEach((d, i) => assert.equal(DEST_INDEX[d.id], i));
  const fx = json('dests.json');
  assert.equal(fx.NS, NS);
  assert.equal(fx.NF, NF);
  assert.equal(fx.ND, ND);
  assert.equal(fx.DESTS.length, ND);
  fx.DESTS.forEach((f, i) => {
    const d = DESTS[i];
    for (const k of ['id', 'label', 'law', 'lo', 'hi', 'fmt', 'scope', 'ctr', 'group']) assert.equal(d[k], f[k], `${f.id}.${k}`);
    close(d.def, f.def, 1e-12, f.id + '.def');
    assert.deepEqual(Object.keys(d).sort(), ['ctr', 'def', 'fmt', 'group', 'hi', 'id', 'label', 'law', 'lo', 'scope']);
  });
  for (const d of DESTS) {
    if (!STEPPED.has(d.law)) continue;
    const m = d.hi - d.lo, k = Math.round(d.def * m);
    assert.equal(d.def, k / m, d.id + ' default on grid');
  }
  // spot rows of the §3.13 table
  assert.deepEqual({ ...DESTS[42] }, { id: 'f.cutoff', label: 'Filter Cutoff', law: 'exp', lo: C.MIDI0, hi: 22050, def: 0.5, fmt: 'hz', scope: 'V', ctr: 0, group: 'Filter' });
  assert.equal(DESTS[134].def, 1 / 95);
  assert.equal(DESTS[101].def, 13 / 24);
  assert.equal(DESTS[148].id, 'g.master');
  assert.equal(DESTS[234].id, 'g.bypass');
  assert.equal(DESTS[247].id, 'fx.fil.type');
  assert.equal(C.MIDI0, 8.175798915643707);
});

test('1b DIDX / FIDX / SIDX naming and spot values (§3.13)', () => {
  const D = { A_LEVEL: 0, B_LEVEL: 17, N_LEVEL: 34, S_LEVEL: 40, F_CUTOFF: 42, E1_ATT: 48, L1_RATE: 63, C1_RATE: 95, G_PORTA: 97, G_TUNE: 99,
    G_AMP: 100, G_BENDUP: 101, BUS1: 103, A_ON: 119, N_ON: 121, S_ON: 122, F_ON: 123, F_ROUTEA: 124, A_TRACK: 128, A_WARPMODE: 130,
    S_SHAPE: 132, S_OCT: 133, F_TYPE: 134, E1_CA: 135, C1_BPM: 144, G_WHEEL: 146, G_BEND: 147 };
  for (const k of Object.keys(D)) assert.equal(DIDX[k], D[k], k);
  assert.equal(DIDX.E1_ATT + 5 * 2, DIDX.E3_ATT);
  assert.equal(DIDX.L1_RATE + 4 * 7, DIDX.L8_RATE);
  assert.equal(DIDX.E1_CA + 3 * 2, DIDX.E3_CA);
  assert.equal(Object.keys(DIDX).length, NS);
  const F = { G_MASTER: 0, HYPER_ON: 1, G_BYPASS: 86, HYPER_RETRIG: 87, DIST_MODE: 88, FIL_TYPE: 99, DLY_TIMEL: 43 };
  for (const k of Object.keys(F)) assert.equal(FIDX[k], F[k], k);
  assert.equal(Object.keys(FIDX).length, NF);
  const S = { WHEEL: 1, ENV1: 2, LFO1: 5, VELO: 13, NOTE: 14, AT: 15, PAT: 16, CHAOS1: 17, NOISE: 19, RAND1: 20, ALT1: 22, MACRO1: 24,
    BEND: 28, MPEX: 29, RELVEL: 32, FIXED: 33 };
  for (const k of Object.keys(S)) assert.equal(SIDX[k], S[k], k);
  assert.equal(Object.keys(SIDX).length, 33);
  assert.deepEqual([...MATRIX_ONLY].slice(0, 5), ['g.tune', 'g.amp', 'g.wheel', 'g.bend', 'g.bypass']);
  assert.equal(MATRIX_ONLY.length, 21);
});

/* ------------------------------------------------------------ 2. sources */

test('2 SOURCES (§3.12) and SRC_MENU', () => {
  assert.equal(SOURCES.length, 34);
  assert.equal(NSRC, 34);
  const exp = ['', 'wheel', 'env1', 'env2', 'env3', 'lfo1', 'lfo2', 'lfo3', 'lfo4', 'lfo5', 'lfo6', 'lfo7', 'lfo8', 'velo', 'note', 'at', 'pat',
    'chaos1', 'chaos2', 'noise', 'rand1', 'rand2', 'alt1', 'alt2', 'macro1', 'macro2', 'macro3', 'macro4', 'bend', 'mpex', 'mpey', 'mpez', 'relvel', 'fixed'];
  assert.deepEqual(SOURCES.map(s => s.id), exp);
  SOURCES.forEach((s, i) => assert.equal(SRC_INDEX[s.id], i));
  const bi = SOURCES.filter(s => s.pol === 'bi').map(s => s.id);
  assert.deepEqual(bi, ['chaos1', 'chaos2', 'noise', 'bend', 'mpex']);
  assert.deepEqual(SOURCES.filter(s => s.tile).map(s => s.id).sort(),
    ['env1', 'env2', 'env3', 'lfo1', 'lfo2', 'lfo3', 'lfo4', 'lfo5', 'lfo6', 'lfo7', 'lfo8', 'macro1', 'macro2', 'macro3', 'macro4', 'note', 'velo', 'wheel']);
  assert.equal(SOURCES[16].label, 'Poly AT');
  assert.equal(SOURCES[32].label, 'Rel. Velo');
  assert.equal(SOURCES[5].scope, 'V/G');
  assert.equal(SRC_MENU.length, 33);
  assert.deepEqual([...SRC_MENU].sort(), exp.slice(1).sort());
  assert.deepEqual(SRC_MENU.slice(0, 3), ['env1', 'env2', 'env3']);
  assert.equal(SRC_MENU[SRC_MENU.length - 1], 'fixed');
});

/* ------------------------------------------------------------ 3. enumerations */

test('3 FILTERS equal the fixture; enumerations and ladders (§3.3–3.11)', () => {
  const fx = json('filters.json').FILTERS;
  assert.equal(FILTERS.length, 96);
  assert.equal(fx.length, 96);
  fx.forEach((f, i) => {
    assert.deepEqual({ ...FILTERS[i] }, { id: f.id, name: f.name, cat: f.cat, varLabel: f.varLabel, family: f.family }, f.id);
  });
  for (const f of FILTERS) {
    assert.ok(C.FILTER_CATS.includes(f.cat));
    assert.ok(C.FILTER_FAMILY.includes(f.family));
  }
  assert.equal(C.FILTER_FAMILY.length, 19);
  assert.equal(varLabel(0), 'FAT');
  assert.equal(varLabel(76), '');
  assert.equal(varLabel(500), '');
  assert.equal(WARPS.length, 23);
  assert.deepEqual(WARPS.slice(18, 21).map(w => w.nameB), ['FM (from A)', 'AM (from A)', 'RM (from A)']);
  assert.deepEqual(WARPS.slice(18, 21).map(w => w.name), ['FM (from B)', 'AM (from B)', 'RM (from B)']);
  WARPS.forEach((w, i) => { if (i < 18 || i > 20) assert.equal(w.nameB, w.name); });
  assert.equal(WARPS[22].id, 'fm_sub');
  assert.ok(WARPS.every(w => !/[^\x20-\x7e]/.test(w.name + w.nameB)), 'ASCII names');
  assert.equal(UNI_STACKS.length, 9);
  assert.equal(UNI_MODES.length, 5);
  assert.equal(DIST_MODES.length, 16);
  assert.equal(C.SUB_SHAPES.length, 5);
  assert.deepEqual([...SUB_IDS], ['sub:Sine', 'sub:RoundRect', 'sub:Saw', 'sub:Square', 'sub:Pulse']);
  assert.equal(MODFX_LADDER.length, 31);
  assert.equal(MODFX_LADDER[0].label, 'Off');
  assert.equal(MODFX_LADDER[0].beats, Infinity);
  for (let i = 2; i < 31; i++) assert.ok(MODFX_LADDER[i].beats < MODFX_LADDER[i - 1].beats, 'MODFX decreasing at ' + i);
  assert.equal(MODFX_LADDER[21].label, '1/4');
  assert.equal(DLY_LADDER.length, 12);
  for (let i = 1; i < 12; i++) assert.ok(DLY_LADDER[i].beats > DLY_LADDER[i - 1].beats);
  assert.deepEqual(DLY_LADDER[7], { label: '1/4', beats: 1 });
  const ratios = [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2, 3, 4, 5, 6, 7, 8, 10, 16, 32];
  assert.equal(CMP_RATIO_DETENTS.length, 21);
  ratios.forEach((r, i) => {
    assert.equal(CMP_RATIO_DETENTS[i], 1 - 1 / r);
    close(lawValue('fx.cmp.ratio', CMP_RATIO_DETENTS[i]), r, 1e-9, 'detent ' + r);
  });
  assert.equal(CMP_RATIO_DETENTS[20], 1);
  assert.equal(fmtParam('fx.cmp.ratio', CMP_RATIO_DETENTS[20]), 'Limit');
  assert.deepEqual(C.FX_MODULES.map(m => m.id), ['hyper', 'dist', 'flg', 'phs', 'cho', 'dly', 'cmp', 'rev', 'eq', 'fil']);
  assert.deepEqual([...C.FX_ORDER_DEFAULT], ['hyper', 'dist', 'flg', 'phs', 'cho', 'dly', 'cmp', 'rev', 'eq', 'fil']);
  assert.deepEqual(C.REV_LABELS[1], ['SIZE', 'DECAY', 'LOW CUT', 'SPIN', 'HIGH CUT', 'SPIN DEPTH', 'MIX']);
  assert.deepEqual(C.FORMANTS[2][4], [430, 1170, 3260]);
  assert.equal(C.LAWS.length, 12);
  assert.equal(C.LAW.npitch, 11);
});

test('3b every exported constant is deep-frozen', () => {
  const seen = new Set();
  const check = (o, path) => {
    if (!o || typeof o !== 'object' || seen.has(o)) return;
    seen.add(o);
    assert.ok(Object.isFrozen(o), path + ' frozen');
    for (const k of Object.keys(o)) check(o[k], path + '.' + k);
  };
  for (const k of Object.keys(C)) if (typeof C[k] === 'object') check(C[k], k);
  assert.equal(C.MAX_PTS, 480);
  assert.equal(C.CURVE_K, 10);
  assert.equal(C.MC_K, 6);
  assert.equal(C.VERSION, 1);
  assert.equal(C.CP_VER, 1);
  assert.equal(C.FXP_VER, 1);
});

/* ------------------------------------------------------------ 4. laws */

const DOMAIN = { ratio: [0, 0.96875], rpow3: [0, 0.99], npitch: [0.125, 1] };

test('4 laws: round trips over invertible domains and value ranges', () => {
  for (let i = 0; i < ND; i++) {
    const d = DESTS[i];
    if (STEPPED.has(d.law)) continue;
    const [a, b] = DOMAIN[d.law] || [0, 1];
    for (let j = 0; j <= 1000; j++) {
      const n = a + (b - a) * j / 1000;
      close(lawNorm(d.id, lawValue(d.id, n)), n, 1e-9, `${d.id} n=${n}`);
    }
    const v0 = lawValue(i, a), v1 = lawValue(i, b);
    for (let j = 0; j <= 1000; j++) {
      const v = v0 + (v1 - v0) * j / 1000;
      close(lawValue(i, lawNorm(i, v)), v, 1e-9 * Math.max(1, Math.abs(v)), `${d.id} v=${v}`);
    }
  }
});

test('4b laws: stepped laws, clamping, index access', () => {
  assert.equal(lawValue('a.semi', 0.75), 6);
  assert.equal(lawNorm('a.semi', 7), 19 / 24);
  assert.equal(lawNorm('a.semi', 6.6), 19 / 24);
  assert.equal(lawValue('f.type', 1 / 95), 1);
  assert.equal(lawNorm('f.type', 95), 1);
  assert.equal(lawValue('a.on', 0.5), 1);
  assert.equal(lawValue('a.on', 0.4999), 0);
  assert.equal(lawNorm('a.on', true), 1);
  assert.equal(lawNorm('a.on', 0), 0);
  assert.equal(lawValue('a.level', 2), 1);
  assert.equal(lawValue('a.level', -1), 0);
  assert.equal(lawValue(0, 0.5), 0.25);
  assert.equal(lawNorm('f.cutoff', 1e9), 1);
  assert.equal(lawNorm('f.cutoff', -5), 0);
  assert.equal(lawValue('fx.cmp.thr', 1), 1e-6);
  assert.equal(lawNorm('fx.cmp.ratio', 1e9), 1);
  assert.equal(lawValue('n.pitch', 0.1), -200);
  assert.equal(lawValue('nope', 0.3), 0.3);
  assert.equal(lawNorm('nope', 5), 5);
});

test('4c laws: spot values (§10.2.4)', () => {
  close(lawValue('f.cutoff', 0.5), 424.6, 0.5, 'f.cutoff');
  close(lawValue('e1.att', 0.25), 0.03125, 1e-12);
  close(lawValue('e1.att', 0.5), 1.0, 5e-4);
  close(lawValue('e1.att', 0.75), 7.594, 5e-4);
  close(lawValue('g.porta', 0.5), 0.25, 1e-12);
  close(lawValue('l1.rate', 0.5), 6.25, 1e-12);
  close(lawValue('c1.rate', 0.2512), 1.0, 0.005);
  close(db(lawValue('g.master', 0.7)), -9.29, 0.01);
  close(db(lawValue('a.level', 0.75)), -5.0, 0.01);
  close(db(lawValue('fx.cmp.thr', 0.5)), -18.06, 0.005);
  assert.equal(lawValue('fx.cmp.ratio', 0.75), 4);
  assert.equal(lawValue('fx.cmp.ratio', 0.99), 1e9);
  close(lawValue('fx.cmp.att', 0.3), 90, 1e-9);
  close(db(lawValue('fx.cmp.gain', 1)), 30.10, 0.005);
  close(lawValue('fx.dist.freq', 0.5), 329.6, 0.05);
  close(lawValue('fx.dist.freq', 1), 13289.75, 0.01);
  close(lawValue('fx.dist.q', 0.5), 2.0, 1e-12);
  close(lawValue('fx.eq.freqL', 0.333), 209.6, 1);
  close(lawValue('fx.eq.freqH', 0.666), 2041, 5);
  close(lawValue('fx.dly.freq', 0.5), 848.5, 0.05);
  close(lawValue('fx.dly.q', 6 / 7.4), 6.8, 1e-12);
  close(lawValue('fx.cho.lpf', 0.5), 1000, 1e-9);
  close(lawValue('fx.phs.freq', 0.5), 600, 1e-9);
  close(lawValue('fx.flg.rate', 0.25), 0.078125, 1e-15);
  close(lawValue('fx.dly.timeL', 0.625), 77.29, 0.005);
  for (const d of DESTS) if (/\.level$/.test(d.id) && d.hi === 4) close(lawValue(d.id, 0.5), 1, 1e-15, d.id);
  assert.equal(lawValue('n.pitch', 1), 48);
  close(lawValue('n.pitch', 0.25), -100, 1e-12);
  assert.equal(lawValue('n.pitch', 0), -200);
  assert.equal(lawValue('g.bendup', DESTS[DEST_INDEX['g.bendup']].def), 2);
  assert.equal(lawValue('g.benddn', DESTS[DEST_INDEX['g.benddn']].def), -2);
});

/* ------------------------------------------------------------ 5. display */

test('5 fmtParam (§10.2.5)', () => {
  const s = defaultSerum();
  const cases = [
    [['f.cutoff', 0.5], '425 Hz'], [['a.level', 0.75], '75%'], [['e1.att', 0.11], '0.52 ms'], [['e1.rel', 0.215], '14.7 ms'],
    [['e1.dec', 0.5], '1.00 s'], [['g.master', 0.7], '-9.3 dB'], [['a.phase', 1], 'Mem'], [['a.crs', 0.5], '--'], [['a.semi', 0.75], '+6 st'],
    [['l1.rate', 0.5, { s }], '1/4'], [['fx.cmp.ratio', 1], 'Limit'], [['fx.dly.offL', 4 / 3 - 0.5], 'TRIP'], [['a.pan', 0.5], 'C'],
    [['b.warpMode', 18 / 22], 'FM (from A)'], [['a.warpMode', 18 / 22], 'FM (from B)'], [['f.type', 1 / 95], 'MG Low 12'], [['fx.dist.q', 0.5], '2.00'],
  ];
  for (const [args, want] of cases) assert.equal(fmtParam(...args), want, args.join(' '));
  const fxL = defaultFx();
  fxL.p['fx.cmp.ratio'] = 1;
  assert.equal(fmtParam('fx.cmp.att', 0.3, { fx: fxL }), '0.90 ms');
  assert.equal(fmtParam('fx.cmp.att', 0.3), '90.0 ms');
  assert.equal(fmtParam('fx.cmp.att', 0.3, { fx: defaultFx() }), '90.0 ms');
  const eff = new Float32Array(248);
  eff[DEST_INDEX['fx.cmp.ratio']] = 1;
  assert.equal(fmtParam('fx.cmp.att', 0.3, { fx: defaultFx(), eff }), '0.90 ms');
});

test('5b fmtParam: every format, switch-dependent formats, robustness', () => {
  const s = defaultSerum(), fx = defaultFx();
  assert.equal(fmtParam('fx.cho.feed', 0.1), '10%');
  assert.equal(fmtParam('fx.cmp.mbL', 0.5), '100%');
  assert.equal(fmtParam('a.pan', 0.25), 'L25');
  assert.equal(fmtParam('a.pan', 1), 'R50');
  assert.equal(fmtParam('f.pan', 0.7), 'R40');
  assert.equal(fmtParam('f.pan', 0.5), 'C');
  assert.equal(fmtParam('a.oct', 0.625), '+1 oct');
  assert.equal(fmtParam('a.oct', 0.5), '0 oct');
  assert.equal(fmtParam('a.semi', 5 / 12), '-2 st');
  assert.equal(fmtParam('g.tune', 0.5 + 0.5 / 128), '+0.50 st');
  assert.equal(fmtParam('a.fine', 0.535), '+7 ct');
  assert.equal(fmtParam('a.fine', 0.5), '0 ct');
  assert.equal(fmtParam('a.crs', 0.75), '+32.00 st');
  assert.equal(fmtParam('a.uni', 0.2), '4');
  assert.equal(fmtParam('a.det', 0.5), '0.25');
  assert.equal(fmtParam('a.phase', 0.5), '180°');
  assert.equal(fmtParam('fx.flg.phase', 0.5), '180°');
  assert.equal(fmtParam('a.wt', 1 / 16), '17');
  assert.equal(fmtParam('a.wt', 1), '256');
  assert.equal(fmtParam('a.wt', 0.5, { frames: [6, 2], interp: [0, 1] }), '4');
  assert.equal(fmtParam('a.wt', 1, { frames: [6, 2], interp: [0, 1] }), '6');
  assert.equal(fmtParam('b.wt', 0.5, { frames: [6, 2], interp: [0, 1] }), '2');
  assert.equal(fmtParam('a.uniwarp', 0.325), '-35%');
  assert.equal(fmtParam('g.curve', 0.5), '0%');
  assert.equal(fmtParam('fx.dist.freq', 0.5), '330 Hz');
  assert.equal(fmtParam('fx.eq.freqH', 0.666), '2.04 kHz');
  assert.equal(fmtParam('f.cutoff', 1), '22.1 kHz');
  assert.equal(fmtParam('f.cutoff', 0), '8.18 Hz');
  assert.equal(fmtParam('l1.rate', 0.5, { s: Object.assign(defaultSerum(), { lfo: [Object.assign(defaultSerum().lfo[0], { bpm: 0 })] }) }), '6.25 Hz');
  assert.equal(fmtParam('e1.att', 0.5), '1.00 s');
  assert.equal(fmtParam('g.porta', 0.9), '4.72 s');
  assert.equal(fmtParam('e1.att', 0.95), '24.8 s');
  assert.equal(fmtParam('fx.cho.dly1', 0.5), '5.00 ms');
  assert.equal(fmtParam('fx.cmp.rel', 0), '0.10 ms');
  assert.equal(fmtParam('fx.cmp.thr', 1), '-inf dB');
  assert.equal(fmtParam('fx.cmp.gain', 1), '30.1 dB');
  assert.equal(fmtParam('e1.sus', 1), '0.0 dB');
  assert.equal(fmtParam('fx.eq.gainL', 0.5625), '+3.0 dB');
  assert.equal(fmtParam('fx.dly.level', 0.5), '0.0 dB');
  assert.equal(fmtParam('fx.dly.level', 0), '-inf dB');
  assert.equal(fmtParam('a.on', 1), 'On');
  assert.equal(fmtParam('b.on', 0), 'Off');
  assert.equal(fmtParam('a.stack', 2 / 8), '12 (2x)');
  assert.equal(fmtParam('s.shape', 0.25), 'RoundRect');
  assert.equal(fmtParam('fx.dist.mode', 11 / 15), 'X-Shaper');
  assert.equal(fmtParam('fx.dly.mode', 1), 'Tap->Delay');
  assert.equal(fmtParam('fx.eq.typeH', 1), 'LP');
  assert.equal(fmtParam('fx.fil.type', 1), 'Scream BP');
  assert.equal(fmtParam('fx.cmp.ratio', 0.75), '4:1');
  assert.equal(fmtParam('fx.cmp.ratio', 0), '1.0:1');
  assert.equal(fmtParam('fx.cmp.ratio', 1 - 1 / 1.5), '1.5:1');
  assert.equal(fmtParam('fx.dly.offL', 0.5), 'x1.00');
  assert.equal(fmtParam('fx.dly.offL', 1), 'DOT');
  assert.equal(fmtParam('fx.dly.offL', 0.25), 'Dot 1/2');
  assert.equal(fmtParam('fx.dly.offL', 0.3), 'x0.80');
  assert.equal(fmtParam('fx.dly.q', 6 / 7.4), '6.8');
  assert.equal(fmtParam('fx.dist.lbh', 0), 'LP 0');
  assert.equal(fmtParam('fx.dist.lbh', 0.5), 'BP 50');
  assert.equal(fmtParam('fx.dist.lbh', 0.8), 'HP 80');
  // var: percentage, or EQ gain for eq-family types
  assert.equal(fmtParam('f.var', 0.3), '30%');
  const eq = defaultSerum();
  eq.p['f.type'] = 73 / 95;
  assert.equal(fmtParam('f.var', 1, { s: eq }), '+24.0 dB');
  assert.equal(fmtParam('f.var', 0.5, { s: eq }), '0.0 dB');
  assert.equal(fmtParam('f.var', 0, { s: eq }), '-96.0 dB');
  const fxe = defaultFx();
  fxe.p['fx.fil.type'] = 71 / 95;
  assert.equal(fmtParam('fx.fil.var', 0.25, { fx: fxe }), '-12.0 dB');
  // noise pitch
  assert.equal(fmtParam('n.pitch', 0.5), '0.0 st');
  assert.equal(fmtParam('n.pitch', 0.75), '+24.0 st');
  const kt = defaultSerum();
  kt.noise.keytrack = 1;
  assert.equal(fmtParam('n.pitch', 0.25, { s: kt }), '-100 st');
  // LFO rate with dot/trip, LFO times
  const st = defaultSerum();
  st.lfo[2].trip = 1;
  const L = lfoLadder(0, 1);
  assert.equal(fmtParam('l3.rate', L.findIndex(e => e.label === '1/8T') / (L.length - 1), { s: st }), '1/8T');
  assert.equal(fmtParam('l1.delay', 0.25), '2.00 beats');
  st.lfo[0].bpm = 0;
  assert.equal(fmtParam('l1.delay', 0.25, { s: st }), '1.00 s');
  // chaos rate: Hz, or straight ladder label with its BPM switch on
  assert.equal(fmtParam('c1.rate', 0.2512), '1.00 Hz');
  const ch = defaultSerum();
  ch.p['c1.bpm'] = 1;
  assert.equal(fmtParam('c1.rate', lawNorm('c1.rate', 2), { s: ch, bpm: 120 }), '1/4');
  assert.equal(fmtParam('c1.rate', 0, { s: ch, bpm: 120 }), '32 bar');
  // mod-FX and delay ladders
  assert.equal(fmtParam('fx.flg.rate', 0.25), '0.08 Hz');
  const fb = defaultFx();
  fb.p['fx.flg.bpm'] = 1;
  assert.equal(fmtParam('fx.flg.rate', 21 / 30, { fx: fb }), '1/4');
  assert.equal(fmtParam('fx.flg.rate', 0, { fx: fb }), 'Off');
  assert.equal(fmtParam('fx.dly.timeL', 0.625), '1/4');
  assert.equal(fmtParam('fx.dly.timeL', 6 / 11, { fx }), '1/8');
  const fd = defaultFx();
  fd.p['fx.dly.bpm'] = 0;
  assert.equal(fmtParam('fx.dly.timeL', 0.625, { fx: fd }), '77.3 ms');
  // reverb time slot
  assert.equal(fmtParam('fx.rev.t', 0.12), '2.1 s');
  assert.equal(fmtParam('fx.rev.t', 1), 'inf');
  const pl = defaultFx();
  pl.rev.type = 0;
  assert.equal(fmtParam('fx.rev.t', 0.12, { fx: pl }), '24 ms');
  // never throws; unknown id → String(n); ASCII only
  assert.equal(fmtParam('nope', 0.3), '0.3');
  for (const d of DESTS) {
    for (const n of [-1, 0, 0.3, 0.5, 0.9996, 1, 2, NaN]) {
      for (const ctx of [undefined, null, { s, fx }, { s: 5, fx: 'x' }, { s: { lfo: 'q', p: 3, noise: 1 }, fx: { p: null, rev: 7 } }, { frames: 'x', interp: 3, eff: 1 }]) {
        const t = fmtParam(d.id, n, ctx);
        assert.equal(typeof t, 'string');
        assert.ok(!/[−–]|NaN|undefined/.test(t), `${d.id} ${n} → ${t}`);
      }
    }
  }
});

test('5c labels and centre flags', () => {
  assert.equal(isCenter('a.pan'), true);
  assert.equal(isCenter('a.level'), false);
  assert.equal(isCenter('nope'), false);
  assert.equal(destLabel('f.cutoff'), 'Filter Cutoff');
  assert.equal(destLabel('f.var'), 'FAT');
  const s = defaultSerum();
  s.p['f.type'] = 18 / 95;
  assert.equal(destLabel('f.var', s), 'FREQ');
  s.p['f.type'] = 76 / 95;
  assert.equal(destLabel('f.var', s), 'Filter Var');
  const fx = defaultFx();
  fx.p['fx.fil.type'] = 86 / 95;
  assert.equal(destLabel('fx.fil.var', null, fx), 'FORMNT');
  assert.equal(destLabel('fx.rev.c'), 'SPIN');
  fx.rev.type = 0;
  assert.equal(destLabel('fx.rev.c', null, fx), 'DAMP');
  assert.equal(destLabel('fx.rev.t', null, fx), 'PRE DELAY');
  assert.equal(destLabel('fx.rev.on', null, fx), 'Reverb Enable');
  assert.equal(destLabel('zzz'), 'zzz');
});

/* ------------------------------------------------------------ 6. typed entry */

test('6 parseParam (§10.2.6)', () => {
  close(parseParam('f.cutoff', '425 Hz'), 0.5, 1e-3, '425 Hz');
  close(parseParam('f.cutoff', '1,2 kHz'), lawNorm('f.cutoff', 1200), 1e-12, '1,2 kHz');
  close(parseParam('e1.att', '1/8', { bpm: 120 }), lawNorm('e1.att', 0.25), 1e-12, '1/8');
  assert.equal(parseParam('a.semi', '+7'), 19 / 24);
  assert.equal(parseParam('a.level', '50%'), 0.5);
  const s = defaultSerum();
  s.lfo[0].trip = 1;
  const L = lfoLadder(0, 1), j = L.findIndex(e => e.label === '1/8T');
  assert.ok(j > 0);
  assert.equal(parseParam('l1.rate', '1/8T', { s }), j / (L.length - 1));
  assert.equal(parseParam('fx.dly.timeL', '1/8', { fx: defaultFx() }), 6 / 11, 'delay BPM is on by default');
  const fb = defaultFx();
  fb.p['fx.flg.bpm'] = 1;
  assert.equal(parseParam('fx.flg.rate', '1/4', { fx: fb }), 21 / 30);
  const sc = defaultSerum();
  sc.p['c1.bpm'] = 1;
  assert.equal(parseParam('c1.rate', '1/4', { s: sc, bpm: 120 }), lawNorm('c1.rate', 2));
  const fl = defaultFx();
  fl.p['fx.cmp.ratio'] = 1;
  close(parseParam('fx.cmp.att', '5 ms', { fx: fl }), Math.sqrt(0.5), 1e-15);
  for (const g of ['garbage', '', '   ', 'abc Hz', '5 parsecs', '1/0', 'NaN', '--5', 'x'.repeat(80)]) assert.equal(parseParam('f.cutoff', g), null, g);
});

// deterministic PRNG for the property tests
const prng = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
function fmtContexts() {
  const s2 = defaultSerum();
  s2.lfo.forEach(L => { L.bpm = 0; });
  Object.assign(s2.p, { 'c1.bpm': 1, 'c2.bpm': 1, 'f.type': 73 / 95 });
  s2.noise.keytrack = 1;
  const f2 = defaultFx();
  Object.assign(f2.p, { 'fx.flg.bpm': 1, 'fx.phs.bpm': 1, 'fx.cho.bpm': 1, 'fx.dly.bpm': 0, 'fx.cmp.ratio': 1, 'fx.fil.type': 71 / 95 });
  f2.rev.type = 0;
  const s3 = defaultSerum();
  s3.lfo.forEach((L, i) => { L.dot = i & 1; L.trip = (i >> 1) & 1; });
  return [undefined, { s: defaultSerum(), fx: defaultFx() }, { s: s2, fx: f2, bpm: 97 }, { s: s3, fx: defaultFx(), bpm: 140, frames: [6, 64], interp: [0, 1] }];
}

test('6b parseParam reads back every fmtParam output (all destinations, formats and switch states)', () => {
  const rnd = prng(7), ctxs = fmtContexts();
  let n0 = 0;
  for (const ctx of ctxs) {
    for (const d of DESTS) {
      for (let k = 0; k < 60; k++) {
        const n = k < 11 ? k / 10 : rnd(), t = fmtParam(d.id, n, ctx), p = parseParam(d.id, t, ctx);
        assert.notEqual(p, null, `${d.id} '${t}'`);
        assert.equal(fmtParam(d.id, p, ctx), t, `${d.id} n=${n} '${t}' → ${p}`);
        n0++;
      }
    }
  }
  assert.equal(n0, 4 * 248 * 60);
});

test('6c parseParam: units, conversions, labels, switches', () => {
  const P = parseParam, nm = lawNorm;
  // frequency
  close(P('f.cutoff', '1.2k'), nm('f.cutoff', 1200), 1e-12);
  close(P('f.cutoff', '1200 HZ'), nm('f.cutoff', 1200), 1e-12);
  assert.equal(P('f.cutoff', '30 kHz'), 1, 'clamped');
  assert.equal(P('f.cutoff', '50%'), 0.5, '% = knob position on non-percent formats');
  // time: bare = the unit the control shows at its current base (§8.1 'display units'), s, beat divisions at
  // ctx.bpm, bars, beats
  close(P('e1.att', '500'), nm('e1.att', 0.5), 1e-12, 'default attack shows ms');
  close(P('e1.dec', '2'), nm('e1.dec', 2), 1e-12, 'default decay shows 1.00 s');
  const tc = defaultSerum();
  tc.p['e1.dec'] = 0.2;
  tc.p['e1.att'] = 0.6;
  close(P('e1.dec', '2', { s: tc }), nm('e1.dec', 0.002), 1e-12, 'a decay showing ms');
  close(P('e1.att', '2', { s: tc }), nm('e1.att', 2), 1e-12, 'an attack showing s');
  close(P('e1.att', '2 ms', { s: tc }), nm('e1.att', 0.002), 1e-12, 'units always win');
  const tf = defaultFx();
  tf.p['fx.cmp.rel'] = 1;
  close(P('fx.cmp.rel', '0.5', { fx: tf }), nm('fx.cmp.rel', 500), 1e-12, 'release showing 1.00 s');
  close(P('fx.cmp.rel', '0.5', { fx: defaultFx() }), nm('fx.cmp.rel', 0.5), 1e-12, 'release showing 90.0 ms');
  const tl = defaultSerum();
  tl.lfo[0].bpm = 0;
  tl.p['l1.delay'] = 0.5;
  close(P('l1.delay', '1.5', { s: tl }), nm('l1.delay', 1.5), 1e-12, 'LFO delay showing 2.00 s');
  close(P('e1.att', '0,5 s'), nm('e1.att', 0.5), 1e-12);
  close(P('e1.att', '1/4.', { bpm: 120 }), nm('e1.att', 0.75), 1e-12);
  close(P('e1.att', '1/8T', { bpm: 120 }), nm('e1.att', 1 / 6), 1e-12);
  close(P('e1.att', '1/4d', { bpm: 60 }), nm('e1.att', 1.5), 1e-12);
  close(P('e1.att', '2 bar', { bpm: 120 }), nm('e1.att', 4), 1e-12);
  close(P('e1.att', '2 beats', { bpm: 120 }), nm('e1.att', 1), 1e-12);
  close(P('g.porta', '1/8'), nm('g.porta', 0.25), 1e-12, 'default bpm 120');
  assert.equal(P('e1.att', '5 Hz'), null);
  close(P('fx.cho.dly1', '0.005 s'), 0.5, 1e-12);
  close(P('fx.cmp.rel', '90 ms'), 0.3, 1e-12);
  close(P('fx.cmp.att', '90'), 0.3, 1e-12);
  const fl = defaultFx();
  fl.p['fx.cmp.ratio'] = 1;
  close(P('fx.cmp.att', '0.9 ms', { fx: fl }), 0.3, 1e-12);
  assert.equal(P('fx.cmp.att', '20 ms', { fx: fl }), 1, 'look-ahead clamped to 10 ms');
  const eff = new Float64Array(248);
  eff[DEST_INDEX['fx.cmp.ratio']] = 1;
  close(P('fx.cmp.att', '0.9', { fx: defaultFx(), eff }), 0.3, 1e-12, 'snapshot eff ratio');
  // pitch units and unicode minus
  assert.equal(P('a.semi', '1 oct'), 1);
  assert.equal(P('a.semi', '−7 st'), 5 / 24);
  assert.equal(P('a.semi', '-12'), 0);
  assert.equal(P('a.oct', '-24 st'), 2 / 8);
  assert.equal(P('a.oct', '+1'), 5 / 8);
  close(P('a.fine', '0.25 st'), 0.625, 1e-12);
  close(P('a.fine', '-50 ct'), 0.25, 1e-12);
  assert.equal(P('a.crs', '--'), 0.5);
  close(P('a.crs', '+32.00 st'), 0.75, 1e-12);
  close(P('g.tune', '-0.5'), 0.5 - 0.5 / 128, 1e-12);
  assert.equal(P('g.bendup', '+2 st'), 26 / 48);
  close(P('n.pitch', '+24 st'), 0.75, 1e-12);
  close(P('n.pitch', '-100'), 0.25, 1e-12);
  close(P('n.pitch', '-1 oct'), nm('n.pitch', -12), 1e-12);
  // pans
  close(P('a.pan', 'L12'), 0.38, 1e-12);
  close(P('a.pan', '12 R'), 0.62, 1e-12);
  assert.equal(P('a.pan', 'C'), 0.5);
  close(P('a.pan', '-25'), 0.25, 1e-12);
  close(P('f.pan', 'R40'), 0.7, 1e-12);
  close(P('f.pan', 'l 40'), 0.3, 1e-12);
  assert.equal(P('f.pan', 'center'), 0.5);
  // phase, frame, plain numbers
  assert.equal(P('a.phase', 'Mem'), 1);
  assert.equal(P('a.phase', '90°'), 0.25);
  assert.equal(P('a.phase', '90 deg'), 0.25);
  assert.equal(P('a.phase', '360'), 0.9994, 'degrees never select Mem');
  assert.equal(P('fx.flg.phase', '360'), 1);
  assert.equal(P('a.wt', '17'), 16 / 255);
  assert.equal(P('a.wt', '4', { frames: [6, 2], interp: [0, 1] }), 3 / 5);
  assert.equal(P('a.wt', '99', { frames: [6, 2] }), 1);
  assert.equal(P('b.wt', '2', { frames: [6, 2] }), 1);
  assert.equal(P('a.wt', '3', { frames: [1, 1] }), 0);
  assert.equal(P('a.det', '0.25'), 0.5);
  assert.equal(P('a.uni', '4'), 3 / 15);
  assert.equal(P('a.uni', '17'), 1);
  assert.equal(P('fx.hyper.unison', '4'), 4 / 7);
  assert.equal(P('fx.dist.q', '2.00'), 0.5);
  close(P('fx.dly.q', '6.8'), 6 / 7.4, 1e-12);
  // percent formats
  close(P('fx.cho.feed', '10%'), 0.1 / 0.95, 1e-12);
  close(P('fx.cmp.mbL', '100'), 0.5, 1e-12);
  close(P('a.uniwarp', '-35%'), 0.325, 1e-12);
  // gains
  close(P('g.master', '-9.3 dB'), 0.7, 2e-3);
  assert.equal(P('g.master', '-inf dB'), 0);
  assert.equal(P('e1.sus', '-inf'), 0);
  assert.equal(P('fx.cmp.thr', '-inf dB'), 1, 'threshold minimum is at n = 1');
  close(P('fx.cmp.thr', '-18.06'), 0.5, 1e-4);
  close(P('fx.cmp.gain', '30.1 dB'), 1, 1e-3);
  assert.equal(P('fx.eq.gainL', '+3 dB'), 0.5625);
  assert.equal(P('fx.dly.level', '0 dB'), 0.5);
  close(P('fx.dly.level', '+12.04 dB'), 1, 1e-4);
  assert.equal(P('fx.dly.level', '-inf dB'), 0);
  // filter Var: percent, or EQ gain for eq types
  close(P('f.var', '30'), 0.3, 1e-12);
  const eq = defaultSerum();
  eq.p['f.type'] = 73 / 95;
  assert.equal(P('f.var', '+12 dB', { s: eq }), 0.75);
  assert.equal(P('f.var', '-inf', { s: eq }), 0);
  assert.equal(fmtParam('f.var', P('f.var', '-12 dB', { s: eq }), { s: eq }), '-12.0 dB');
  assert.equal(P('f.var', '40%', { s: eq }), 0.4);
  // switches and enums
  assert.equal(P('a.on', 'on'), 1);
  assert.equal(P('a.on', 'OFF'), 0);
  assert.equal(P('a.on', '100%'), 1);
  assert.equal(P('a.on', '30%'), 0);
  assert.equal(P('a.on', 'maybe'), null);
  assert.equal(P('a.warpMode', 'fm (from a)'), 18 / 22);
  assert.equal(P('b.warpMode', 'FM (from B)'), 18 / 22);
  assert.equal(P('a.warpMode', 'Remap 3'), 15 / 22);
  assert.equal(P('a.warpMode', 'remap'), null, 'ambiguous prefix');
  assert.equal(P('a.warpMode', 'quant'), 17 / 22, 'unique prefix');
  assert.equal(P('f.type', 'mg low 24'), 3 / 95);
  for (const [id, t] of [['f.type', 'undefined'], ['fx.fil.type', 'Undefined'], ['s.shape', 'UNDEFINED'], ['f.type', 'undef'], ['a.stack', 'null']]) {
    assert.equal(P(id, t), null, `${id} '${t}': entries without nameB have no phantom label`);
  }
  assert.equal(P('f.type', 'Formant-II'), 87 / 95);
  assert.equal(P('f.type', 'lh6'), 18 / 95, 'id');
  assert.equal(P('fx.fil.type', 'scream b'), 1);
  assert.equal(P('a.stack', '12 + 7 (2x)'), 5 / 8);
  assert.equal(P('s.shape', 'roundrect'), 1 / 4);
  assert.equal(P('fx.dly.mode', 'ping-pong'), 0.5);
  assert.equal(P('fx.eq.typeH', 'lp'), 1);
  // ratio, delay offset, LP/BP/HP
  assert.equal(P('fx.cmp.ratio', '4:1'), 0.75);
  assert.equal(P('fx.cmp.ratio', '4'), 0.75);
  assert.equal(P('fx.cmp.ratio', 'Limit'), 1);
  close(P('fx.cmp.ratio', '1.5:1'), 1 / 3, 1e-12);
  close(P('fx.dly.offL', 'TRIP'), 4 / 3 - 0.5, 1e-12);
  assert.equal(P('fx.dly.offL', 'DOT'), 1);
  assert.equal(P('fx.dly.offL', 'Dot 1/2'), 0.25);
  assert.equal(P('fx.dly.offL', 'x1.25'), 0.75);
  assert.equal(P('fx.dly.offL', '1.25'), 0.75);
  assert.equal(P('fx.dist.lbh', 'BP 50'), 0.5);
  assert.equal(fmtParam('fx.dist.lbh', P('fx.dist.lbh', 'LP 25')), 'LP 25', 'band word wins at the boundary');
  assert.equal(fmtParam('fx.dist.lbh', P('fx.dist.lbh', 'HP 75')), 'HP 75');
  assert.equal(P('fx.dist.lbh', 'HP'), 1);
  close(P('fx.dist.lbh', '30'), 0.3, 1e-12);
  // synced rates and times
  const off = defaultSerum();
  off.lfo[0].bpm = 0;
  assert.equal(P('l1.rate', '6.25 hz', { s: off }), 0.5);
  close(P('l1.rate', '1/4', { s: off, bpm: 120 }), nm('l1.rate', 2), 1e-12, 'division → Hz with BPM off');
  assert.equal(P('l1.rate', '1/8T'), null, 'not on the straight ladder');
  assert.equal(P('l1.rate', '4/4'), 5 / 14, 'equal beat value → 1 bar');
  assert.equal(P('l1.rate', '1 BAR'), 5 / 14);
  assert.equal(P('l1.rate', '5 Hz'), null, 'Hz with BPM on');
  assert.equal(P('l1.delay', '2 beats'), 0.25);
  assert.equal(P('l1.delay', '1/4'), 0.125);
  assert.equal(P('l1.delay', '1'), 0.125, 'bare = beats with BPM on');
  assert.equal(P('l1.delay', '1 s', { bpm: 120 }), 0.25);
  assert.equal(P('l1.delay', '1 s', { bpm: 60 }), 0.125, 'absolute time made tempo-relative');
  assert.equal(P('l1.delay', '1 s', { s: off }), 0.25);
  close(P('c1.rate', '2 hz'), nm('c1.rate', 2), 1e-12);
  const sc = defaultSerum();
  sc.p['c1.bpm'] = 1;
  close(P('c1.rate', 'fast', { s: sc, bpm: 120 }), nm('c1.rate', 256), 1e-12);
  close(P('c1.rate', '1/8T', { s: sc, bpm: 120 }), nm('c1.rate', 6), 1e-12, 'any division (the DSP snaps)');
  const fb = defaultFx();
  fb.p['fx.cho.bpm'] = 1;
  assert.equal(P('fx.cho.rate', 'Off', { fx: fb }), 0);
  assert.equal(P('fx.cho.rate', '4 bar T', { fx: fb }), 11 / 30);
  assert.equal(P('fx.cho.rate', '4 bart', { fx: fb }), 11 / 30);
  assert.equal(P('fx.cho.rate', '1/16.', { fx: fb }), 25 / 30);
  assert.equal(P('fx.cho.rate', '0.08 hz', { fx: fb }), null);
  close(P('fx.cho.rate', '0.078125 hz'), 0.25, 1e-12);
  assert.equal(P('fx.dly.timeL', '1/4'), 7 / 11);
  assert.equal(P('fx.dly.timeL', 'FAST'), 0);
  assert.equal(P('fx.dly.timeL', '4 bar'), 1);
  assert.equal(P('fx.dly.timeL', '1/5'), null);
  const fd = defaultFx();
  fd.p['fx.dly.bpm'] = 0;
  close(P('fx.dly.timeL', '250 ms', { fx: fd }), nm('fx.dly.timeL', 250), 1e-12);
  close(P('fx.dly.timeL', '1/8', { fx: fd, bpm: 120 }), nm('fx.dly.timeL', 250), 1e-12);
  // reverb slot t: Hall decay s / Plate pre-delay ms
  close(P('fx.rev.t', '2.144 s'), 0.12, 1e-12);
  close(P('fx.rev.t', '2.144'), 0.12, 1e-12, 'Hall: bare = s');
  assert.equal(P('fx.rev.t', 'inf'), 1);
  assert.equal(P('fx.rev.t', '20 s'), 0.9989, 'finite never inf');
  const pl = defaultFx();
  pl.rev.type = 0;
  close(P('fx.rev.t', '24 ms', { fx: pl }), 0.12, 1e-12);
  close(P('fx.rev.t', '0.024 s', { fx: pl }), 0.12, 1e-12);
  // numbers as input, stepped results on the grid
  assert.equal(P('a.semi', 7), 19 / 24);
  for (const d of DESTS) {
    if (!STEPPED.has(d.law)) continue;
    const m = d.hi - d.lo;
    for (const t of ['37%', '0', '1', '5', '-3']) { const p = P(d.id, t); if (p !== null) assert.equal(p, Math.round(p * m) / m, d.id + ' ' + t); }
  }
});

test('6d parseParam never throws; null or n in [0, 1] for any text, id and ctx', () => {
  const rnd = prng(99), chars = 'abcdefhiklmnoprstxz0123456789 .,-+/%:°∞LRCTdk−';
  const hostile = [null, 5, 'x', { s: 5, fx: 'x' }, { s: { lfo: 'q', p: 3, noise: 1 }, fx: { p: null, rev: 7 } }, { frames: 'x', interp: 3, eff: 1, bpm: -5 }];
  for (const x of [undefined, null, {}, [], NaN, true, () => 1, Symbol.iterator]) assert.equal(parseParam('f.cutoff', x), null);
  for (const id of [undefined, null, 'nope', 'constructor', '__proto__', 999, -1, 2.5]) assert.equal(parseParam(id, '1'), null);
  for (const t of ['constructor', '__proto__', 'toString', '5 constructor', '1 __proto__', 'hasOwnProperty']) {
    for (const d of DESTS) assert.equal(parseParam(d.id, t), null, d.id + ' ' + t);
  }
  for (let k = 0; k < 30000; k++) {
    let t = '';
    for (let c = 1 + Math.floor(rnd() * 9); c > 0; c--) t += chars[Math.floor(rnd() * chars.length)];
    const d = DESTS[Math.floor(rnd() * DESTS.length)], p = parseParam(d.id, t, hostile[k % hostile.length]);
    if (p !== null) assert.ok(p >= 0 && p <= 1 && !Object.is(p, -0), `${d.id} '${t}' → ${p}`);
  }
});

test('6e fmtParam display boundaries: precision and sign come from the printed value', () => {
  assert.equal(fmtParam('fx.eq.freqL', parseParam('fx.eq.freqL', '100 Hz')), '100 Hz');
  assert.equal(fmtParam('c1.rate', lawNorm('c1.rate', 999.97)), '1.00 kHz');
  assert.equal(fmtParam('f.cutoff', lawNorm('f.cutoff', 9.996)), '10.0 Hz');
  assert.equal(fmtParam('fx.eq.freqH', lawNorm('fx.eq.freqH', 9996)), '10.0 kHz');
  assert.equal(fmtParam('e1.att', lawNorm('e1.att', 0.9996)), '1.00 s');
  assert.equal(fmtParam('e1.att', lawNorm('e1.att', 0.009996)), '10.0 ms');
  assert.equal(fmtParam('e1.att', lawNorm('e1.att', 9.996)), '10.0 s');
  assert.equal(fmtParam('a.fine', 0.5018), '0 ct');
  assert.equal(fmtParam('a.uniwarp', 0.5018), '0%');
  assert.equal(fmtParam('n.pitch', 0.5004), '0.0 st');
  assert.equal(fmtParam('e1.sus', 0.9983), '0.0 dB');
  assert.equal(fmtParam('g.tune', 0.5 - 1e-6), '0.00 st');
  assert.equal(fmtParam('fx.cmp.ratio', lawNorm('fx.cmp.ratio', 1.97)), '2:1');
  assert.equal(fmtParam('fx.dly.offL', 1.3437 - 0.5), 'TRIP', 'detent window on the printed x1.34');
  // §3.2 xoff windows (±0.01) on the printed value in exact hundredths (1.5 − 1.49 is 0.010000000000000009 in
  // floating point, which once shrank DOT and Dot 1/2 to the printed centre only); the offset range ends at 1.5
  const xo = v => fmtParam('fx.dly.offL', lawNorm('fx.dly.offL', v));
  for (const [v, want] of [[1.32, 'x1.32'], [1.3249, 'x1.32'], [1.3251, 'TRIP'], [1.33, 'TRIP'], [4 / 3, 'TRIP'], [1.34, 'TRIP'],
    [1.3449, 'TRIP'], [1.3451, 'x1.35'], [1.48, 'x1.48'], [1.4849, 'x1.48'], [1.4851, 'DOT'], [1.49, 'DOT'], [1.491, 'DOT'], [1.5, 'DOT'],
    [0.73, 'x0.73'], [0.7349, 'x0.73'], [0.7351, 'Dot 1/2'], [0.74, 'Dot 1/2'],
    [0.741, 'Dot 1/2'], [0.75, 'Dot 1/2'], [0.759, 'Dot 1/2'], [0.76, 'Dot 1/2'], [0.7651, 'x0.77'], [0.77, 'x0.77'], [1, 'x1.00']]) {
    assert.equal(xo(v), want, String(v));
  }
  // spec examples unchanged
  assert.equal(fmtParam('e1.att', 0.11), '0.52 ms');
  assert.equal(fmtParam('e1.rel', 0.215), '14.7 ms');
  assert.equal(fmtParam('fx.eq.freqH', 0.666), '2.04 kHz');
});

/* ------------------------------------------------------------ 7, 8. matrix typing, MIDI values */

test('7 semitoneAmount', () => {
  assert.equal(semitoneAmount('a.semi', 12, 1), 1);
  assert.equal(semitoneAmount('a.semi', 12, 0), 0.5);
  assert.equal(semitoneAmount('a.oct', 12, 0), 0.125);
  assert.equal(semitoneAmount('a.fine', 0.5, 0), 0.25);
  assert.equal(semitoneAmount('g.tune', 64, 1), 1);
  assert.equal(semitoneAmount('a.semi', 48, 0), 1);
  assert.equal(semitoneAmount('a.semi', -48, 0), -1);
  assert.equal(semitoneAmount('f.cutoff', 12, 0), null);
  assert.equal(semitoneAmount('s.oct', -12, 0), -0.125);
});

test('8 midiValue (normative formula of §8.1)', () => {
  assert.equal(midiValue('a.on', 63), 0);
  assert.equal(midiValue('a.on', 64), 1);
  // §10.2.8 quotes 13/24 for cc 64, but the normative formula lawNorm(lawValue(cc/127)) gives the grid value 12/24
  // there (−12 + 24·64/127 = 0.09 → 0 st); 13/24 (+1 st) is reached from cc 67 on. Reported to the lead.
  assert.equal(midiValue('a.semi', 64), 12 / 24);
  assert.equal(midiValue('a.semi', 67), 13 / 24);
  assert.equal(midiValue('f.cutoff', 127), 1);
  assert.equal(midiValue('macro2', 32), 32 / 127);
  assert.equal(midiValue('f.type', 127), 1);
  assert.equal(midiValue('nope', 3), null);
});

/* ------------------------------------------------------------ 9. normalizeSerum */

const deepFreeze = o => { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const sharesObjects = (a, b) => {
  const seen = new Set();
  const walk = o => { if (o && typeof o === 'object') { seen.add(o); Object.values(o).forEach(walk); } };
  walk(b);
  let shared = false;
  const walk2 = o => { if (o && typeof o === 'object') { if (seen.has(o)) shared = true; Object.values(o).forEach(walk2); } };
  walk2(a);
  return shared;
};

function messyState() {
  const s = defaultSerum();
  s.v = 0;
  s.author = 'x'.repeat(100);
  s.p['a.level'] = 5;
  s.p['b.level'] = -3;
  s.p['f.res'] = NaN;
  s.p['a.pan'] = 'abc';
  s.p['a.semi'] = 0.52;
  s.p['f.type'] = 0.5;
  s.p['bus3'] = 0.9;
  s.p['g.wheel'] = 0.7;
  s.p['g.bend'] = 0.1;
  s.p['a.warpMode'] = 18 / 22;
  s.p['b.warpMode'] = 19 / 22;
  s.p['fx.dly.mix'] = 0.3;          // FX ids do not live in s.p
  s.p.bogus = 1;
  s.lfo[0].pts = [[0.7, 0.2, 0], [0.3, 0.9, 2], [0.123456789, 1.5, -0.5, 3, 0], ['x'], null, [0.5, NaN]];
  s.lfo[1].pts = Array.from({ length: 600 }, (_, i) => [i / 599, (i % 7) / 7, 0, i % 17, (i * 3) % 17]);
  s.lfo[1].loop = 900;
  s.lfo[1].start = -3;
  s.lfo[2] = 'junk';
  s.lfo[3].mode = 'weird';
  s.osc[0].remap = [[0.5, 0.5, 0]];
  s.osc[1].memSet = [1.25, -0.25, 'x'];
  s.osc[1].wt = 42;
  s.matrix = s.matrix.concat(Array.from({ length: 8 }, () => row({ src: 'env1', dst: 'a.level', amt: 1 })));
  s.matrix[0] = row({ src: 'lfo1', dst: 'f.cutoff', amt: 2, curve: -3, out: 7 });
  s.matrix[1] = row({ src: 'warble', dst: 'f.cutoff', amt: 0.5 });
  s.matrix[2] = row({ src: 'env2', dst: 'nowhere', amt: 0.5 });
  s.matrix[3] = row({ src: 'env2', dst: 'f.res', amt: 0.5, aux: 'zzz' });
  s.matrix[4] = 'not a row';
  s.midi = { 7: 'f.cutoff', '07': 'f.res', 120: 'a.level', 1: 'macro2', 2: 'macro9', 3: 'unknown.id', 4: 'fx.dly.mix', x: 'a.level' };
  s.locks = { p: ['a.level', 'a.level', 'nope', 'fx.rev.mix'], mod: ['filter', 'oscA', 'bogus', 'oscA'], misc: { poly: true, os: 'x' } };
  s.global = { os: 8, a4: 445.04, uniRange: [60, 0.123], uniMode: [9, -1] };
  s.voicing.poly = 99;
  s.ui = { page: 'nope', env: 7, mod: 'zzz', view3d: [1], wtSel: [300, -1], filtView: 9, extra: 1 };
  s.macros[1].name = 'y'.repeat(40);
  s.lfoGrid = { x: 0, y: 100 };
  return s;
}

test('9 normalizeSerum: defaults, idempotence, JSON round trip, size', () => {
  const d = defaultSerum();
  for (const x of [{}, null, undefined, 'x', 42, [], { v: 99 }]) assert.deepEqual(normalizeSerum(x), d, String(x));
  assert.deepEqual(normalizeSerum(d), d);
  const n1 = normalizeSerum(messyState());
  assert.deepEqual(normalizeSerum(n1), n1, 'idempotent');
  assert.deepEqual(JSON.parse(JSON.stringify(n1)), n1, 'JSON round trip');
  assert.deepEqual(JSON.parse(JSON.stringify(d)), d);
  assert.ok(JSON.stringify(d).length < 24 * 1024, 'default < 24 KB');
  assert.equal(Object.keys(d.p).length, 150);
  // worst case: every graph at MAX_PTS points with full-precision coordinates and bus links
  const w = defaultSerum(), big = (bus) => Array.from({ length: 700 }, (_, i) => [i / 699 + 1e-7, Math.sin(i) * 0.5 + 0.5, Math.cos(i) * 0.99, bus ? 16 : 0, bus ? 15 : 0]);
  w.lfo.forEach(L => { L.pts = big(true); });
  w.osc.forEach(o => { o.remap = big(false); });
  w.velo.pts = big(false);
  w.note.pts = big(false);
  w.matrix = w.matrix.map((_, i) => row({ src: 'macro4', dst: DESTS[200 + (i % 40)].id, amt: -0.123456789, curve: 0.987654321, aux: 'chaos2' }));
  w.notes = 'n'.repeat(5000);
  // tiny negative phases: x − floor(x) rounds to exactly 1 there; [0, 1) and idempotence must still hold
  const tn = defaultSerum();
  tn.osc[0].memSet[0] = -1e-20;
  tn.osc[1].memSet[5] = -Number.MIN_VALUE;
  tn.osc[1].memSet[6] = -1;
  const tnn = normalizeSerum(tn);
  assert.deepEqual([tnn.osc[0].memSet[0], tnn.osc[1].memSet[5], tnn.osc[1].memSet[6]], [0, 0, 0]);
  assert.deepEqual(normalizeSerum(tnn), tnn);
  assert.equal(compileSerum(tn).serum.memSet[0], 0);
  const fn = defaultFx();
  fn.phase = [-1e-20, -1e-17, 0.9999999999999999, -0.25];
  const fnn = normalizeFx(fn);
  assert.deepEqual(fnn.phase, [0, 0, 0.9999999999999999, 0.75]);
  assert.ok(fnn.phase.every(x => x >= 0 && x < 1));
  assert.deepEqual(normalizeFx(fnn), fnn);
  assert.ok([...compileFx(fn).phase].every(x => x >= 0 && x < 1));
  const nw = normalizeSerum(w), size = JSON.stringify(nw).length;
  assert.ok(nw.lfo.every(L => L.pts.length === 480));
  assert.ok(size < 256 * 1024, 'worst case ' + size + ' bytes');
  assert.deepEqual(normalizeSerum(nw), nw);
});

test('9b normalizeSerum: clamps, snaps, placeholders, warp rule, points, matrix, midi, locks, ui', () => {
  const src = deepFreeze(messyState());
  const n = normalizeSerum(src);           // input deep-frozen: any mutation would throw
  assert.equal(sharesObjects(n, src), false, 'no shared objects with the input');
  assert.equal(n.v, 1);
  assert.equal(n.author.length, 64);
  assert.equal(n.p['a.level'], 1);
  assert.equal(n.p['b.level'], 0);
  assert.equal(n.p['f.res'], DESTS[DEST_INDEX['f.res']].def);
  assert.equal(n.p['a.pan'], 0.5);
  assert.equal(n.p['a.semi'], 0.5);
  assert.equal(n.p['f.type'], 48 / 95);
  assert.equal(n.p.bus3, 0.5);
  assert.equal(n.p['g.wheel'], 0);
  assert.equal(n.p['g.bend'], 0.5);
  assert.equal(n.p['a.warpMode'], 18 / 22);
  assert.equal(n.p['b.warpMode'], 0);
  assert.equal(n.p['fx.dly.mix'], undefined);
  assert.equal(n.p.bogus, undefined);
  for (const k of Object.keys(n.p)) {
    const i = DEST_INDEX[k];
    if (STEPPED.has(DESTS[i].law)) { const m = DESTS[i].hi - DESTS[i].lo; assert.equal(n.p[k], Math.round(n.p[k] * m) / m, k); }
  }
  // B's FM is kept when A is not FM/AM/RM, and 21/22 never conflict
  const w = defaultSerum();
  w.p['a.warpMode'] = 21 / 22;
  w.p['b.warpMode'] = 18 / 22;
  assert.equal(normalizeSerum(w).p['b.warpMode'], 18 / 22);
  // points: dropped malformed, clamped, rounded, sorted, ends forced, bus links on LFOs only
  assert.deepEqual(n.lfo[0].pts, [[0, 1, -0.5], [0.3, 0.9, 1], [1, 0.2, 0]]);
  assert.equal(n.lfo[1].pts.length, 480);
  assert.equal(n.lfo[1].pts[0].length, 3, 'first point carries no mx');
  assert.equal(n.lfo[1].pts[479][0], 1);
  assert.deepEqual(n.lfo[1].pts[1], [0.00167, 0.14286, 0, 1, 3]);
  assert.equal(n.lfo[1].loop, 479);
  assert.equal(n.lfo[1].start, 0);
  assert.deepEqual(n.lfo[2], defaultSerum().lfo[2]);
  assert.equal(n.lfo[3].mode, 'off');
  assert.deepEqual(n.osc[0].remap, [[0, 0.5, 0], [1, 0.5, 0]]);
  assert.deepEqual(n.osc[1].memSet.slice(0, 3), [0.25, 0.75, C.MEMSET_DEFAULT_B[2]]);
  assert.equal(n.osc[1].memSet.length, 16);
  assert.equal(n.osc[1].wt, 'factory:Default');
  for (const L of n.lfo) for (const p of L.pts) for (const v of p.slice(0, 3)) assert.equal(Math.round(v * 1e5) / 1e5, v);
  const mono = defaultSerum();
  mono.velo.pts = [[0.2, 0.3, 0, 5, 5], [0.8, 0.7, 0]];
  assert.deepEqual(normalizeSerum(mono).velo.pts, [[0, 0.3, 0], [1, 0.7, 0]], 'no bus links outside LFO graphs; ends forced');
  // matrix: padded/truncated to 32, unknown ids clear the row, values clamped
  assert.equal(n.matrix.length, 32);
  assert.deepEqual(n.matrix[0], row({ src: 'lfo1', dst: 'f.cutoff', amt: 1, curve: -1, out: 1 }));
  for (const r of [1, 2, 3, 4]) assert.deepEqual(n.matrix[r], row({}), 'row ' + r);
  assert.deepEqual(normalizeSerum({ matrix: [row({ src: 'env1', dst: 'a.level', amt: 0.5 })] }).matrix.length, 32);
  // midi: canonical cc 0–119, DEST ids or macro1–4
  assert.deepEqual(n.midi, { 1: 'macro2', 4: 'fx.dly.mix', 7: 'f.cutoff' });
  // locks
  assert.deepEqual(n.locks, { p: ['a.level', 'fx.rev.mix'], mod: ['oscA', 'filter'], misc: { poly: 1, os: 0, tuning: 0 } });
  // global, voicing, ui, macros, grid
  assert.deepEqual(n.global, { os: 4, a4: 445, uniRange: [48, 0.12], uniMode: [4, 0] });
  for (const [x, want] of [[1, 1], [2, 2], [4, 4], [3, 4], [1.2, 1], [0, 1], ['2', 2]]) assert.equal(normalizeSerum({ global: { os: x } }).global.os, want, 'os ' + x);
  assert.equal(n.voicing.poly, 32);
  assert.deepEqual(n.ui, { page: 'osc', env: 2, mod: 'lfo1', envLock: 1, envZoom: 1, view3d: [1, 0], wtSel: [255, 0], filtView: 2 });
  assert.equal(n.macros[1].name.length, 24);
  assert.deepEqual(n.lfoGrid, { x: 1, y: 64 });
});

/* ------------------------------------------------------------ 10–12. compileSerum */

const CP_SHAPE = {
  base: [Float64Array, 148], mSrc: [Int8Array, 32], mDst: [Int16Array, 32], mAmt: [Float64Array, 32], mBi: [Uint8Array, 32],
  mK: [Float64Array, 32], mAux: [Int8Array, 32], mInv: [Uint8Array, 32], mCtx: [Uint8Array, 32], mOn: [Uint8Array, 32],
  srcUsed: [Uint8Array, 34], modded: [Uint8Array, 148], uniMode: [Uint8Array, 2], uniRange: [Float64Array, 2], memSet: [Float64Array, 32],
  lfoMode: [Uint8Array, 8], lfoBpm: [Uint8Array, 8], lfoAnchor: [Uint8Array, 8], lfoLad: [Float64Array, 344], lfoLadN: [Uint8Array, 8],
  chaosMono: [Uint8Array, 2], chaosSh: [Uint8Array, 2], macro: [Float64Array, 4],
};
const CP_NUM = ['ver', 'NS', 'NSRC', 'mN', 'subDirect', 'noiseOneshot', 'noiseKey', 'noiseDirect', 'filKey', 'direct', 'mono', 'legato',
  'poly', 'always', 'scaled', 'oneNote', 'os', 'a4', 'smooth',
  'veloPorta', 'notePorta'];   // not in the §4.1 table: carry §2.2 velo.porta / note.porta to the DSP (§5.3, §6.1)
const CT_SHAPE = {
  lfoTab: [Float32Array, 8 * 1025], lfoPtsOff: [Uint16Array, 9], lfoPmAny: [Uint8Array, 8], lfoStart: [Float64Array, 8],
  lfoLoop: [Float64Array, 8], remap: [Float32Array, 2 * 2049], veloTab: [Float32Array, 129], noteTab: [Float32Array, 129],
};

test('10 compileSerum(defaultSerum()): fields, types, CT, memoisation', () => {
  const s = defaultSerum(), P = compileSerum(s), CP = P.serum, CT = P.serumT;
  assert.deepEqual({ ...P, serum: 0, serumT: 0 }, {
    engine: 'serum', mode: 'poly', poly: 8, prio: 'last', legato: false, glide: 0, glideLegato: false, unison: 1, unisonDetune: 0,
    drift: 0, bendRange: 2, level: 1, bpm: 120, needs: ['factory:Default'], serum: 0, serumT: 0,
  });
  for (const [k, [T, len]] of Object.entries(CP_SHAPE)) {
    assert.ok(CP[k] instanceof T, k + ' type');
    assert.equal(CP[k].length, len, k + ' length');
  }
  for (const k of CP_NUM) assert.equal(typeof CP[k], 'number', k);
  assert.deepEqual(Object.keys(CP).sort(), Object.keys(CP_SHAPE).concat(CP_NUM, ['wt', 'noiseId', 'ctKey']).sort());
  assert.deepEqual(CP.wt, ['factory:Default', 'factory:Default']);
  assert.equal(CP.noiseId, 'noise:White');
  assert.equal(CP.ver, 1);
  assert.equal(CP.NS, 148);
  assert.equal(CP.NSRC, 34);
  assert.equal(CP.mN, 0);
  assert.equal(CP.direct, 0);
  assert.equal(CP.os, 2);
  assert.equal(CP.a4, 440);
  assert.equal(CP.smooth, 1);
  assert.deepEqual([CP.veloPorta, CP.notePorta], [0, 0]);
  for (let i = 0; i < NS; i++) assert.equal(CP.base[i], s.p[DESTS[i].id]);
  assert.deepEqual([...CP.lfoMode], [2, 2, 2, 2, 2, 2, 2, 2]);
  assert.deepEqual([...CP.lfoLadN], [15, 15, 15, 15, 15, 15, 15, 15]);
  assert.equal(CP.lfoLad[7], 1);
  assert.equal(CP.lfoLad[15], 0);
  assert.deepEqual([...CP.memSet.slice(0, 16)], [...C.MEMSET_DEFAULT_A]);
  // CT
  for (const [k, [T, len]] of Object.entries(CT_SHAPE)) {
    assert.ok(CT[k] instanceof T, k + ' type');
    assert.equal(CT[k].length, len, k + ' length');
  }
  assert.ok(CT.lfoPts instanceof Float64Array && CT.lfoPts.length === 3 * 24);
  assert.ok(CT.lfoPm instanceof Uint8Array && CT.lfoPm.length === 2 * 24);
  assert.equal(typeof CT.key, 'string');
  assert.match(CT.key, /^[0-9a-f]{8}$/);
  for (let l = 0; l < 8; l++) {
    assert.equal(CT.lfoTab[l * 1025], 0);
    assert.equal(CT.lfoTab[l * 1025 + 512], 1);
    assert.equal(CT.lfoTab[l * 1025 + 1024], 0);
    assert.equal(CT.lfoPtsOff[l], 3 * l);
    assert.equal(CT.lfoStart[l], 0);
    assert.equal(CT.lfoLoop[l], -1);
  }
  assert.equal(CT.veloTab[64], 0.5);
  assert.equal(CT.noteTab[128], 1);
  assert.equal(CT.remap[2049 + 1024], 0.5);
  assert.equal(CP.ctKey, CT.key);
  // memoisation by content
  const P2 = compileSerum(defaultSerum());
  assert.equal(P2.serumT.key, CT.key);
  assert.equal(P2.serumT, CT, 'equal curves → same CT object');
  const s3 = defaultSerum();
  s3.p['f.cutoff'] = 0.3;
  s3.matrix[0] = row({ src: 'env2', dst: 'f.cutoff', amt: 0.5 });
  const P3 = compileSerum(s3);
  assert.equal(P3.serumT, CT, 'only s.p / matrix changed → CT reused');
  const s4 = defaultSerum();
  s4.lfo[5].pts[1][0] = 0.4;
  const P4 = compileSerum(s4);
  assert.notEqual(P4.serumT.key, CT.key, 'moved point → new key');
  assert.notEqual(P4.serumT, CT);
  const s5 = defaultSerum();
  s5.lfo[2].start = 1;
  assert.notEqual(compileSerum(s5).serumT.key, CT.key, 'start index is part of the key');
  assert.equal(compileSerum(s5).serumT.lfoStart[2], 0.5);
  // compileSerum does not touch its input
  const frozen = deepFreeze(defaultSerum());
  compileSerum(frozen, { bpm: 90, smooth: 2 });
  const P6 = compileSerum(frozen, { bpm: 90, smooth: 2 });
  assert.equal(P6.bpm, 90);
  assert.equal(P6.serum.smooth, 2);
  // "follow portamento/legato" flags (§2.2) reach the DSP; they are not curve data (CT unchanged)
  const sp = defaultSerum();
  sp.velo.porta = 1;
  assert.deepEqual([compileSerum(sp).serum.veloPorta, compileSerum(sp).serum.notePorta], [1, 0]);
  sp.velo.porta = 0;
  sp.note.porta = 1;
  assert.deepEqual([compileSerum(sp).serum.veloPorta, compileSerum(sp).serum.notePorta], [0, 1]);
  assert.equal(compileSerum(sp).serumT, CT);
  // ctx scalars are clamped: tempo 20–999 (non-positive / missing → 120), smoothing scale 0.01–8 (§4.1, §9.7)
  for (const [ctx, bpm, smooth] of [[{ bpm: 0, smooth: 0 }, 120, 0.01], [{ bpm: -5, smooth: -5 }, 120, 0.01], [{ bpm: 5, smooth: 50 }, 20, 8],
    [{ bpm: 5000, smooth: NaN }, 999, 1], [{ bpm: Infinity, smooth: '2' }, 120, 1], [{ bpm: 133.5, smooth: 0.5 }, 133.5, 0.5], [null, 120, 1]]) {
    const Q = compileSerum(defaultSerum(), ctx);
    assert.deepEqual([Q.bpm, Q.serum.smooth], [bpm, smooth], JSON.stringify(ctx));
  }
});

test('10b compileSerum: structured switches, voicing, LFO data and point links', () => {
  const s = defaultSerum();
  s.voicing = { mono: 1, legato: 1, poly: 5, always: 1, scaled: 1, oneNote: 0 };
  s.global = { os: 4, a4: 432.5, uniRange: [12.5, 0], uniMode: [2, 4] };
  s.lfo[1] = Object.assign(s.lfo[1], { mode: 'env', bpm: 0, dot: 1, trip: 1, anchor: 0, loop: 1,
    pts: [[0, 0, 0], [0.25, 1, 0.5, 0, 3], [0.75, 0.2, 0, 2, 0], [1, 0, 0]] });
  s.lfo[0].mode = 'trig';
  s.chaos[1] = { mono: 1, sh: 1 };
  s.macros[2].v = 0.4;
  s.noise = { src: 'noise:Pink', oneshot: 1, keytrack: 1, direct: 1 };
  s.filter.keytrack = 1;
  const n = normalizeSerum(s), P = compileSerum(n), CP = P.serum, CT = P.serumT;
  assert.equal(P.mode, 'mono');
  assert.equal(P.poly, 1);
  assert.equal(P.legato, true);
  assert.deepEqual([CP.mono, CP.legato, CP.poly, CP.always, CP.scaled, CP.oneNote], [1, 1, 5, 1, 1, 0]);
  assert.deepEqual([CP.os, CP.a4, [...CP.uniRange], [...CP.uniMode]], [4, 432.5, [12.5, 0], [2, 4]]);
  assert.deepEqual([...CP.lfoMode.slice(0, 3)], [0, 1, 2]);
  assert.deepEqual([CP.lfoBpm[1], CP.lfoAnchor[1], CP.lfoLadN[1]], [0, 0, 43]);
  const lad = lfoLadder(1, 1);
  for (let j = 0; j < 43; j++) assert.equal(CP.lfoLad[43 + j], lad[j].beats);
  assert.deepEqual([...CP.chaosMono, ...CP.chaosSh], [0, 1, 0, 1]);
  assert.equal(CP.macro[2], 0.4);
  assert.deepEqual([CP.noiseOneshot, CP.noiseKey, CP.noiseDirect, CP.filKey, CP.noiseId], [1, 1, 1, 1, 'noise:Pink']);
  assert.equal(CP.direct, 0, 'noise direct but noise off and untargeted');
  assert.equal(CT.lfoPtsOff[1], 3);
  assert.equal(CT.lfoPtsOff[2], 7);
  assert.equal(CT.lfoPtsOff[8], 3 * 7 + 4);
  assert.deepEqual([...CT.lfoPts.slice(12, 18)], [0.25, 1, 0.5, 0.75, 0.2, 0]);
  assert.deepEqual([...CT.lfoPm.slice(6, 12)], [0, 0, 0, 3, 2, 0]);
  assert.deepEqual([...CT.lfoPmAny], [0, 1, 0, 0, 0, 0, 0, 0]);
  assert.equal(CT.lfoLoop[1], 0.25);
  close(CT.lfoTab[1025 + 128], evalPts(n.lfo[1].pts, 0.125), 1e-7);
});

test('11 needs and direct', () => {
  const base = { 'factory:Default': 1 };
  assert.deepEqual(compileSerum(defaultSerum()).needs, Object.keys(base));
  const b = withRows([{ src: 'macro1', dst: 'b.on', amt: 1 }], s => { s.osc[1].wt = 'factory:Saw to Square'; });
  assert.deepEqual(compileSerum(b).needs, ['factory:Default', 'factory:Saw to Square']);
  const sh = withRows([{ src: 'lfo1', dst: 's.shape', amt: 0.5 }], s => { s.p['s.on'] = 1; s.p['s.shape'] = 0.5; });
  assert.deepEqual(compileSerum(sh).needs, ['factory:Default', ...SUB_IDS]);
  const sub = withRows([], s => { s.p['s.on'] = 1; s.p['s.shape'] = 0.5; s.sub.direct = 1; });
  assert.deepEqual(compileSerum(sub).needs, ['factory:Default', 'sub:Saw']);
  assert.equal(compileSerum(sub).serum.direct, 1);
  const subOff = withRows([], s => { s.p['s.shape'] = 0.5; s.p['a.on'] = 0; });
  assert.deepEqual(compileSerum(subOff).needs, []);
  const nz = withRows([{ src: 'env2', dst: 'n.on', amt: 1 }], s => { s.noise.direct = 1; s.noise.src = 'noise:Rain'; });
  assert.deepEqual(compileSerum(nz).needs, ['factory:Default', 'noise:Rain']);
  assert.equal(compileSerum(nz).serum.direct, 1);
  const byp = withRows([{ src: 'env2', dst: 'n.on', amt: 1, byp: 1 }]);
  assert.deepEqual(compileSerum(byp).needs, ['factory:Default'], 'bypassed row does not make noise possibly on');
});

test('12 matrix compile', () => {
  const s = withRows([
    { src: 'lfo1', dst: 'a.level', amt: 0.5, byp: 1 },
    { src: '', dst: 'a.level', amt: 0.5 },
    { src: 'env2', dst: '', amt: 0.5 },
    { src: 'env2', dst: 'f.cutoff', amt: 0, out: 1 },
    { src: 'env2', dst: 'f.cutoff', amt: 0.5, out: 0 },
    { src: 'lfo2', dst: 'f.cutoff', amt: -0.8, out: 0.5, bi: 1, curve: 0.25, aux: 'chaos1', inv: 1 },
    { src: 'env3', dst: 'e1.att', amt: 1 },
    { src: 'macro1', dst: 'l3.rate', amt: 1 },
    { src: 'velo', dst: 'g.wheel', amt: 1 },
    { src: 'note', dst: 'fx.dly.mix', amt: 1 },
    { src: 'fixed', dst: 'g.master', amt: -1 },
    { src: 'rand1', dst: 'a.uni', amt: 1 },
    { src: 'rand2', dst: 'n.rand', amt: 1 },
    { src: 'alt1', dst: 'bus4', amt: 1 },
  ]);
  const CP = compileSerum(s).serum;
  assert.equal(CP.mN, 9);
  assert.deepEqual([...CP.mSrc.slice(0, 9)], ['lfo2', 'env3', 'macro1', 'velo', 'note', 'fixed', 'rand1', 'rand2', 'alt1'].map(x => SRC_INDEX[x]));
  assert.deepEqual([...CP.mDst.slice(0, 9)], ['f.cutoff', 'e1.att', 'l3.rate', 'g.wheel', 'fx.dly.mix', 'g.master', 'a.uni', 'n.rand', 'bus4'].map(x => DEST_INDEX[x]));
  assert.equal(CP.mAmt[0], -0.4);
  assert.equal(CP.mBi[0], 1);
  assert.equal(CP.mK[0], 1.5);
  assert.equal(CP.mAux[0], SRC_INDEX.chaos1);
  assert.equal(CP.mInv[0], 1);
  assert.equal(CP.mAmt[5], -1);
  assert.deepEqual([...CP.mCtx.slice(0, 9)], [1, 1, 3, 2, 4, 4, 1, 1, 3]);
  assert.deepEqual([...CP.mOn.slice(0, 9)], [0, 0, 0, 0, 0, 0, 1, 1, 0]);
  assert.deepEqual([...CP.mSrc.slice(9)], new Array(23).fill(0));
  const used = new Set(['lfo2', 'chaos1', 'env3', 'macro1', 'velo', 'note', 'fixed', 'rand1', 'rand2', 'alt1'].map(x => SRC_INDEX[x]));
  for (let i = 0; i < NSRC; i++) assert.equal(CP.srcUsed[i], used.has(i) ? 1 : 0, 'srcUsed ' + SOURCES[i].id);
  const md = new Set(['f.cutoff', 'e1.att', 'l3.rate', 'g.wheel', 'a.uni', 'n.rand', 'bus4'].map(x => DEST_INDEX[x]));
  for (let i = 0; i < NS; i++) assert.equal(CP.modded[i], md.has(i) ? 1 : 0, 'modded ' + DESTS[i].id);
  // mOn exactly for the eight note-on destinations
  const on = ['a.uni', 'b.uni', 'a.phase', 'b.phase', 'a.rand', 'b.rand', 'n.phase', 'n.rand'];
  const s2 = withRows(on.concat(['a.level', 'n.level', 'a.wt', 'b.det']).map(dst => ({ src: 'env1', dst, amt: 0.5 })));
  assert.deepEqual([...compileSerum(s2).serum.mOn.slice(0, 12)], [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0]);
  // scopes → contexts for every destination
  const want = { V: 1, 'V*': 1, 'V*M': 3, G: 2, M: 4 };
  for (let k = 0; k < ND; k += 32) {
    const rows = DESTS.slice(k, k + 32).map(d => ({ src: 'fixed', dst: d.id, amt: 0.1 }));
    const cp = compileSerum(withRows(rows)).serum;
    rows.forEach((r, j) => assert.equal(cp.mCtx[j], want[DESTS[k + j].scope], r.dst));
  }
  // fxModded
  const fm = fxModded(s);
  assert.ok(fm instanceof Uint8Array && fm.length === 100);
  assert.deepEqual([...fm].map((v, k) => (v ? k : -1)).filter(k => k >= 0), [0, DEST_INDEX['fx.dly.mix'] - NS]);
});

/* ------------------------------------------------------------ 13–15. ladders, curves, unison */

test('13 lfoLadder', () => {
  assert.deepEqual([lfoLadder(0, 0), lfoLadder(1, 0), lfoLadder(0, 1), lfoLadder(1, 1)].map(l => l.length), [15, 29, 29, 43]);
  for (const L of [lfoLadder(1, 0), lfoLadder(0, 1), lfoLadder(1, 1)]) for (let i = 1; i < L.length; i++) assert.ok(L[i].beats < L[i - 1].beats);
  const S = lfoLadder(0, 0);
  S.forEach((e, i) => { assert.equal(e.beats, 128 * Math.pow(2, -i)); assert.equal(e.label, LFO_LADDER[i].label); });
  assert.equal(S[Math.round(0.5 * 14)].label, '1/4');
  const D = lfoLadder(1, 1), find = l => D.find(e => e.label === l);
  assert.equal(find('1/4.').beats, 1.5);
  assert.equal(find('1/8T').beats, 1 / 3);
  assert.equal(find('4 barT').beats, 32 / 3);
  assert.equal(find('fast.'), undefined);
  assert.equal(D[0].label, '32 bar.');
  assert.equal(D[42].label, 'fast');
});

test('14 bend and evalPts', () => {
  for (let k = -10; k <= 10; k += 0.5) {
    assert.ok(bend(0, k) === 0, 'bend(0) = 0');   // −0 for k < 0 (verbatim §4.4 formula) compares equal
    assert.equal(bend(1, k), 1);
    let prev = -1;
    for (let t = 0; t <= 1.0000001; t += 0.01) { const y = bend(t, k); assert.ok(y >= prev, `monotone k=${k}`); prev = y; }
  }
  for (const t of [0, 0.1, 0.5, 0.77, 1]) assert.equal(bend(t, 0), t);
  assert.ok(bend(0.5, 5) > 0.5 && bend(0.5, -5) < 0.5);
  const step = [[0, 0, 0], [0.5, 0, 0], [0.5, 1, 0], [1, 1, 0]];
  assert.equal(evalPts(step, 0.5), 1, 'equal x: the later point wins');
  assert.equal(evalPts(step, 0.4999), 0);
  assert.equal(evalPts(step, 0.75), 1);
  assert.equal(evalPts([[0, 0.3, 0], [1, 0.9, 0]], -1), 0.3);
  assert.equal(evalPts([[0, 0.3, 0], [1, 0.9, 0]], 2), 0.9);
  assert.equal(evalPts([[0, 0.3, 0], [1, 0.9, 0], [1, 0.1, 0]], 1), 0.1);
  close(evalPts([[0, 0, 0.5], [1, 1, 0]], 0.3), bend(0.3, 5), 1e-15);
  close(evalPts([[0, 1, -0.5], [0.5, 0, 0], [1, 1, 0]], 0.25), 1 - bend(0.5, -5), 1e-15);
  const r = renderPts([[0, 0, 0], [1, 1, 0]], 4);
  assert.ok(r instanceof Float32Array);
  assert.deepEqual([...r], [0, 0.25, 0.5, 0.75, 1]);
});

test('15 unison tables', () => {
  const { uniShape, uniStack, uniCenter } = uniTables();
  assert.ok(uniShape instanceof Float64Array && uniShape.length === 5 * 256);
  assert.ok(uniStack instanceof Float64Array && uniStack.length === 9 * 256);
  assert.ok(uniCenter instanceof Uint8Array && uniCenter.length === 256);
  const sh = (m, N, i) => uniShape[m * 256 + (N - 1) * 16 + i];
  for (let m = 0; m < 5; m++) assert.equal(sh(m, 1, 0), 0);
  assert.deepEqual([sh(0, 2, 0), sh(0, 2, 1)], [-1, 1]);
  for (let i = 0; i < 7; i++) {
    const t = 2 * i / 6 - 1;
    close(sh(2, 7, i), Math.sign(t) * Math.pow(Math.abs(t), 2.5), 1e-15);
    close(sh(1, 7, i), Math.sign(t) * Math.pow(Math.abs(t), 1.5), 1e-15);
    close(sh(3, 7, i), Math.sign(t) * Math.sqrt(Math.abs(t)), 1e-15);
    assert.equal(sh(4, 7, i), 0, 'Random is drawn by the DSP');
    assert.equal(sh(2, 7, i), detuneShape(2, t) + 0);
  }
  assert.ok(Math.abs(sh(2, 7, 2)) < Math.abs(sh(0, 7, 2)), 'Exp inner voices closer to centre');
  const N8 = [
    [0, 0, 0, 0, 0, 0, 0, 0], [0, 12, 0, 12, 0, 12, 0, 12], [0, 12, 0, 24, 0, 12, 0, 24], [0, 12, 0, 24, 0, 36, 0, 12],
    [0, 7, 12, 0, 7, 12, 0, 7], [0, 7, 12, 19, 24, 0, 7, 12], [0, 7, 12, 19, 24, 31, 36, 0],
    [0, 0, 0, -12, -12, 0, 0, 0], [0, 0, 0, -24, -24, 0, 0, 0],
  ];
  N8.forEach((want, k) => {
    assert.deepEqual(Array.from({ length: 8 }, (_, i) => uniStack[k * 256 + 7 * 16 + i]), want, UNI_STACKS[k]);
    want.forEach((v, i) => assert.equal(stackSemis(k, i, 8), v));
  });
  assert.equal(stackSemis(7, 3, 7), -12);
  assert.equal(stackSemis(7, 2, 7), 0);
  const centres = N => Array.from({ length: N }, (_, i) => uniCenter[(N - 1) * 16 + i]);
  assert.deepEqual(centres(1), [1]);
  assert.deepEqual(centres(2), [1, 1]);
  assert.deepEqual(centres(7), [0, 0, 0, 1, 0, 0, 0]);
  assert.deepEqual(centres(8), [0, 0, 0, 1, 1, 0, 0, 0]);
  assert.equal(uniCenter[15], 0, 'unused slots are 0');
  uniShape[0] = 99;
  assert.equal(uniTables().uniShape[0], 0, 'fresh copies');
});

/* ------------------------------------------------------------ 16. helpers */

const fill = (s, n, src = 'macro1') => { for (let r = 0; r < n; r++) s.matrix[r] = row({ src, dst: 'a.level', amt: 0.1 }); };

test('16a addMod: drag-and-drop defaults (§5.8), FX bases, bool dests, slots, full matrix', () => {
  const s = defaultSerum(), fx = defaultFx();
  s.p['f.cutoff'] = 0.8;
  assert.equal(addMod(s, fx, 'lfo1', 'f.cutoff'), 0);
  assert.equal(s.matrix[0].src, 'lfo1');
  assert.equal(s.matrix[0].bi, 0);
  close(s.matrix[0].amt, 0.2, 1e-12, 'limit: 1 − base');
  assert.deepEqual(Object.keys(s.matrix[0]).sort(), Object.keys(row({})).sort());
  s.p['f.res'] = 0.99;
  assert.equal(addMod(s, fx, 'env2', 'f.res'), 1);
  assert.equal(s.matrix[1].amt, 0.05, 'limit floor');
  assert.equal(addMod(s, fx, 'env2', 'f.drive'), 2);
  assert.equal(s.matrix[2].amt, 0.5, 'limit ceiling');
  assert.equal(addMod(s, fx, 'env3', 'f.res', { limit: false }), 3);
  assert.equal(s.matrix[3].amt, 0.5, 'limit off');
  assert.equal(addMod(s, fx, 'velo', 'a.pan'), 4);
  assert.deepEqual([s.matrix[4].bi, s.matrix[4].amt], [1, 0.5], 'centred dest → bipolar 0.5');
  assert.equal(addMod(s, fx, 'velo', 'bus7'), 5);
  assert.deepEqual([s.matrix[5].bi, s.matrix[5].amt], [1, 0.5]);
  assert.equal(addMod(s, fx, 'macro1', 'b.on'), 6);
  assert.equal(s.matrix[6].amt, 1, 'bool off → +1');
  assert.equal(addMod(s, fx, 'macro1', 'a.on'), 7);
  assert.equal(s.matrix[7].amt, -1, 'bool on → −1');
  // FX destinations read their base from fx.p; g.master from s.p
  fx.p['fx.dly.mix'] = 0.9;
  fx.p['fx.dly.on'] = 1;
  const r1 = addMod(s, fx, 'lfo2', 'fx.dly.mix'), r2 = addMod(s, fx, 'lfo2', 'fx.dly.on'), r3 = addMod(s, null, 'lfo2', 'fx.dly.mix');
  close(s.matrix[r1].amt, 0.1, 1e-12, 'FX base from fx');
  assert.equal(s.matrix[r2].amt, -1);
  assert.equal(s.matrix[r3].amt, 0.5, 'no fx → FX default base 0.3');
  s.p['g.master'] = 0.9;
  close(s.matrix[addMod(s, fx, 'env1', 'g.master')].amt, 0.1, 1e-12);
  // explicit options
  const r4 = addMod(s, fx, 'chaos1', 'f.cutoff', { amt: -2, bi: 1 });
  assert.deepEqual([s.matrix[r4].amt, s.matrix[r4].bi], [-1, 1]);
  const r5 = addMod(s, fx, 'note', 'a.pan', { bi: 0 });
  assert.deepEqual([s.matrix[r5].bi, s.matrix[r5].amt], [0, 0.5], 'forced unipolar on a centred dest: 1 − 0.5');
  assert.equal(addMod(s, fx, 'note', 'f.cutoff', { slot: 31 }), 31);
  assert.equal(s.matrix[31].src, 'note');
  assert.equal(addMod(s, fx, 'note', 'f.cutoff', { slot: 32 }), -1);
  // first slot with src === '' (a row with only a destination counts as free)
  s.matrix[4] = row({ dst: 'f.res', amt: 0.4 });
  assert.equal(addMod(s, fx, 'wheel', 'f.mix'), 4);
  // bad ids, full matrix
  for (const [a, b] of [['', 'f.cutoff'], ['nope', 'f.cutoff'], ['lfo1', ''], ['lfo1', 'nope']]) assert.equal(addMod(s, fx, a, b), -1);
  const full = defaultSerum();
  fill(full, 32);
  const before = JSON.stringify(full);
  assert.equal(addMod(full, fx, 'lfo1', 'f.cutoff'), -1);
  assert.equal(JSON.stringify(full), before, 'full matrix: no-op');
  assert.equal(addMod(null, fx, 'lfo1', 'f.cutoff'), -1);
  // the drop rows compile as expected
  assert.deepEqual(normalizeSerum(s), s, 'helpers keep the state normalized');
});

test('16b modsFor / removeMods / setModAmount / toggles / reassignSource', () => {
  const s = defaultSerum();
  s.matrix[2] = row({ src: 'lfo1', dst: 'f.cutoff', amt: 0.5 });
  s.matrix[5] = row({ src: 'env2', dst: 'f.cutoff', amt: 0.3, byp: 1 });
  s.matrix[9] = row({ src: 'lfo1', dst: 'a.level', amt: 0.2 });
  s.matrix[11] = row({ src: 'lfo1', dst: 'f.cutoff', amt: 0 });
  const m = modsFor(s, 'f.cutoff');
  assert.deepEqual(m.map(x => x.slot), [2, 5, 11], 'any state');
  assert.equal(m[0].row, s.matrix[2]);
  assert.deepEqual(modsFor(s, ''), []);
  assert.deepEqual(modsFor(s, 'f.res'), []);
  assert.equal(setModAmount(s, 2, 1.7), true);
  assert.equal(s.matrix[2].amt, 1);
  assert.equal(setModAmount(s, 2, -0.25), true);
  assert.equal(s.matrix[2].amt, -0.25);
  assert.equal(setModAmount(s, 40, 0.5), false);
  assert.equal(setModAmount(s, 2, NaN), false);
  assert.equal(toggleModBypass(s, 5), true);
  assert.equal(s.matrix[5].byp, 0);
  toggleModBypass(s, 5);
  assert.equal(s.matrix[5].byp, 1);
  assert.equal(toggleModPolarity(s, 9), true);
  assert.equal(s.matrix[9].bi, 1);
  assert.equal(toggleModPolarity(s, -1), false);
  assert.equal(reassignSource(s, 'lfo1', 'macro3'), 3);
  assert.deepEqual([2, 9, 11].map(r => s.matrix[r].src), ['macro3', 'macro3', 'macro3']);
  assert.equal(reassignSource(s, 'macro3', 'bogus'), 0);
  assert.equal(reassignSource(s, 'macro3', ''), 0);
  assert.equal(removeMods(s, 'f.cutoff', 'env2'), 1);
  assert.deepEqual(s.matrix[5], row({}));
  assert.equal(removeMods(s, 'f.cutoff'), 2);
  assert.deepEqual(modsFor(s, 'f.cutoff'), []);
  assert.equal(s.matrix[9].dst, 'a.level');
  assert.deepEqual(normalizeSerum(s), s);
});

// eff n of one destination under §5.2 with constant source values (compiled rows)
function evalDest(s, dst, src) {
  const CP = compileSerum(s).serum, di = DEST_INDEX[dst];
  let off = 0;
  for (let r = 0; r < CP.mN; r++) {
    if (CP.mDst[r] !== di) continue;
    const pol = k => SOURCES[k].pol;
    let v = src[SOURCES[CP.mSrc[r]].id];
    let x = CP.mBi[r] ? 0.5 * (pol(CP.mSrc[r]) === 'uni' ? 2 * v - 1 : v) : v;
    if (CP.mAux[r]) {
      let a = src[SOURCES[CP.mAux[r]].id];
      if (pol(CP.mAux[r]) === 'bi') a = (a + 1) / 2;
      a = Math.min(1, Math.max(0, a));
      x *= CP.mInv[r] ? 1 - a : a;
    }
    off += CP.mAmt[r] * x;
  }
  return Math.min(1, Math.max(0, CP.base[di] + off));
}

test('16c veloToAmp and vibratoAssign', () => {
  const s = defaultSerum();
  s.matrix[0] = row({ src: 'env2', dst: 'f.cutoff', amt: 0.5 });
  assert.equal(veloToAmp(s), 1);
  assert.deepEqual(s.matrix[1], row({ src: 'fixed', amt: -1, dst: 'g.amp', aux: 'velo', inv: 1 }));
  assert.equal(veloToAmp(s), 1, 'identical row exists → no duplicate');
  assert.equal(s.matrix.filter(r => r.dst === 'g.amp').length, 1);
  for (const v of [0, 0.3, 1]) close(evalDest(s, 'g.amp', { fixed: 1, velo: v }), v, 1e-12, 'eff amp n = velocity');
  const full = defaultSerum();
  fill(full, 32);
  assert.equal(veloToAmp(full), -1);
  // vibrato: first LFO used by no row (src or aux, bypassed included)
  const v = defaultSerum();
  v.matrix[0] = row({ src: 'lfo1', dst: 'f.cutoff', amt: 0.5, byp: 1 });
  v.matrix[1] = row({ src: 'env1', dst: 'f.res', amt: 0.5, aux: 'lfo2' });
  v.matrix[2] = row({ src: 'lfo4', dst: 'f.res', amt: 0.5 });
  const slot = vibratoAssign(v);
  assert.equal(slot, 3);
  assert.deepEqual(v.matrix[3], row({ src: 'lfo3', amt: 0.008, dst: 'g.tune', bi: 1, aux: 'wheel' }));
  const L = v.lfo[2];
  assert.deepEqual([L.mode, L.bpm, L.loop, L.start], ['trig', 0, -1, 0]);
  assert.equal(v.p['l3.rate'], 0.48);
  close(lawValue('l3.rate', 0.48), 5.3, 0.01, '≈ 5.3 Hz');
  assert.equal(evalPts(L.pts, 0), evalPts(L.pts, 1), 'tied ends');
  for (let k = 0; k <= 100; k++) close(evalPts(L.pts, k / 100), 0.5 + 0.5 * Math.sin(2 * Math.PI * k / 100), 0.01, 'sine-like');
  // depth: ±0.51 st at full wheel, nothing without the wheel
  const st = n => lawValue('g.tune', n);
  close(st(evalDest(v, 'g.tune', { lfo3: 1, wheel: 1 })), 0.512, 1e-9);
  close(st(evalDest(v, 'g.tune', { lfo3: 0, wheel: 1 })), -0.512, 1e-9);
  close(st(evalDest(v, 'g.tune', { lfo3: 1, wheel: 0 })), 0, 1e-9);
  assert.deepEqual(normalizeSerum(v), v);
  assert.equal(vibratoAssign(v), 4, 'next call takes LFO 5');
  assert.equal(v.matrix[4].src, 'lfo5');
  // no unused LFO / no free slot → −1, nothing changed
  const u = defaultSerum();
  for (let l = 0; l < 8; l++) u.matrix[l] = row({ src: 'lfo' + (l + 1), dst: 'f.res', amt: 0.1 });
  const ub = JSON.stringify(u);
  assert.equal(vibratoAssign(u), -1);
  assert.equal(JSON.stringify(u), ub);
  const f = defaultSerum();
  fill(f, 32);
  const fb = JSON.stringify(f);
  assert.equal(vibratoAssign(f), -1);
  assert.equal(JSON.stringify(f), fb);
  // the chosen LFO starts fresh: its old bus links go (rows of buses no point links any more are pruned, inv A13,
  // other bus rows stay), Delay / Rise / Smooth and the switches return to their defaults
  const w = defaultSerum();
  w.lfo[0] = { mode: 'env', bpm: 1, dot: 1, trip: 1, anchor: 0, pts: [[0, 0, 0], [0.4, 1, 0, 2, 3], [1, 0, 0]], loop: 1, start: 1 };
  w.lfo[1].pts = [[0, 0, 0], [0.5, 1, 0, 0, 2], [1, 0, 0]];
  Object.assign(w.p, { 'l1.delay': 0.5, 'l1.rise': 0.4, 'l1.smooth': 0.3 });
  w.matrix[0] = row({ src: 'env2', dst: 'bus3', amt: 0.5, bi: 1 });
  w.matrix[1] = row({ src: 'env3', dst: 'bus2', amt: 0.5, bi: 1 });
  w.matrix[2] = row({ src: 'macro1', dst: 'bus7', amt: 0.5 });
  assert.equal(vibratoAssign(w), 3, 'slot chosen before pruning (a full matrix returns −1 with nothing changed)');
  assert.deepEqual(w.matrix[3], row({ src: 'lfo1', amt: 0.008, dst: 'g.tune', bi: 1, aux: 'wheel' }));
  assert.deepEqual(w.matrix[0], row({}), 'bus 3 lost its only link');
  assert.equal(w.matrix[1].dst, 'bus2', 'bus 2 is still linked by LFO 2');
  assert.equal(w.matrix[2].dst, 'bus7', 'a bus the LFO never linked keeps its row');
  assert.deepEqual([...linkedBuses(w).keys()], [2]);
  assert.deepEqual(w.lfo[0], Object.assign(defaultSerum().lfo[0], { mode: 'trig', bpm: 0, pts: w.lfo[0].pts }));
  assert.deepEqual(['rate', 'delay', 'rise', 'smooth'].map(k => w.p['l1.' + k]), [0.48, 0, 0, 0]);
  assert.deepEqual(normalizeSerum(w), w);
});

test('16d warpChoice and lfoUsed', () => {
  const s = defaultSerum();
  warpChoice(s, 0, 18);
  assert.equal(s.p['a.warpMode'], 18 / 22);
  warpChoice(s, 1, 19);
  assert.deepEqual([s.p['a.warpMode'], s.p['b.warpMode']], [0, 19 / 22], 'most recent choice wins');
  warpChoice(s, 0, 18);
  assert.deepEqual([s.p['a.warpMode'], s.p['b.warpMode']], [18 / 22, 0]);
  warpChoice(s, 1, 21);
  assert.deepEqual([s.p['a.warpMode'], s.p['b.warpMode']], [18 / 22, 21 / 22], '21/22 never affect the other');
  warpChoice(s, 1, 22);
  assert.equal(s.p['a.warpMode'], 18 / 22);
  warpChoice(s, 0, 20);
  assert.deepEqual([s.p['a.warpMode'], s.p['b.warpMode']], [20 / 22, 22 / 22]);
  warpChoice(s, 0, 99);
  assert.equal(s.p['a.warpMode'], 1);
  warpChoice(s, 1, 4.4);
  assert.equal(s.p['b.warpMode'], 4 / 22);
  assert.deepEqual(normalizeSerum(s), s);
  const u = defaultSerum();
  assert.equal(lfoUsed(u, 0), false);
  u.matrix[7] = row({ src: 'env1', dst: 'f.res', amt: 0.5, aux: 'lfo1', byp: 1 });
  u.matrix[8] = row({ src: 'lfo8', dst: '', amt: 0 });
  assert.equal(lfoUsed(u, 0), true, 'aux, bypassed');
  assert.equal(lfoUsed(u, 7), true, 'any row state');
  assert.equal(lfoUsed(u, 1), false);
});

test('16e LFO buses: linkedBuses / newBus / pruneBuses / clearPointMods', () => {
  const s = defaultSerum();
  s.lfo[0].pts = [[0, 0, 0], [0.3, 0.5, 0, 0, 3], [0.6, 0.2, 0, 3, 0], [1, 0, 0]];
  s.lfo[4].pts = [[0, 0.2, 0, 0, 1], [1, 0.2, 0, 0, 1]];
  s.matrix[0] = row({ src: 'env2', dst: 'bus3', amt: 0.5, bi: 1 });
  s.matrix[1] = row({ src: 'macro1', dst: 'bus3', amt: 0.5, bi: 1 });
  s.matrix[2] = row({ src: 'env2', dst: 'bus3', amt: 0.2 });
  s.matrix[3] = row({ src: 'velo', dst: 'bus2', amt: 0.5 });
  const lb = linkedBuses(s);
  assert.ok(lb instanceof Map);
  assert.deepEqual([...lb.keys()], [1, 3]);
  assert.deepEqual(lb.get(3), { points: [{ lfo: 0, pt: 1, axis: 'y' }, { lfo: 0, pt: 2, axis: 'x' }], sources: ['env2', 'macro1'] });
  assert.deepEqual(lb.get(1), { points: [{ lfo: 4, pt: 0, axis: 'y' }, { lfo: 4, pt: 1, axis: 'y' }], sources: [] });
  assert.equal(newBus(s), 4, 'skips linked (1, 3) and targeted (2) buses');
  // pruneBuses: the bus2 row has no linking point
  assert.equal(pruneBuses(s), 1);
  assert.deepEqual(s.matrix[3], row({}));
  assert.equal(newBus(s), 2);
  // clearing one of two points sharing bus 3 keeps the rows; clearing both deletes them
  assert.equal(clearPointMods(s, 0, [1]), 0);
  assert.deepEqual(s.lfo[0].pts[1], [0.3, 0.5, 0]);
  assert.equal(s.matrix[0].dst, 'bus3');
  assert.equal(clearPointMods(s, 0, 2), 3);
  assert.deepEqual(s.lfo[0].pts[2], [0.6, 0.2, 0]);
  assert.deepEqual(modsFor(s, 'bus3'), []);
  assert.equal(linkedBuses(s).has(3), false);
  assert.equal(clearPointMods(s, 4), 0, 'every point when idxs is omitted');
  assert.equal(linkedBuses(s).size, 0);
  assert.deepEqual(normalizeSerum(s), s);
  // robustness, all buses in use
  assert.equal(clearPointMods(s, 9, [0]), 0);
  assert.equal(clearPointMods(null, 0, [0]), 0);
  assert.equal(newBus(null), 1);
  const f = defaultSerum();
  f.lfo[0].pts = [[0, 0, 0]].concat(Array.from({ length: 16 }, (_, b) => [(b + 1) / 17, 0.5, 0, b + 1, 0]), [[1, 0, 0]]);
  assert.equal(newBus(f), 0);
  const g = defaultSerum();
  for (let b = 1; b <= 16; b++) g.matrix[b - 1] = row({ src: 'env2', dst: 'bus' + b, amt: 0.5 });
  assert.equal(newBus(g), 0, 'targeted buses are not free either');
  // only the buses that lost their last link are pruned: a routing prepared in the matrix on a bus no point has
  // linked yet (newBus treats it as taken) survives Remove Point Modulations on an unrelated point
  const h = defaultSerum();
  h.lfo[0].pts = [[0, 0, 0], [0.5, 1, 0, 0, 2], [1, 0, 0]];
  h.matrix[0] = row({ src: 'env2', dst: 'bus2', amt: 0.5, bi: 1 });
  h.matrix[1] = row({ src: 'lfo3', dst: 'bus5', amt: 0.5, bi: 1 });
  assert.equal(newBus(h), 1);
  assert.equal(clearPointMods(h, 0, [1]), 1);
  assert.deepEqual([h.matrix[0], h.matrix[1].dst], [row({}), 'bus5']);
  assert.equal(clearPointMods(h, 0), 0, 'nothing unlinked → nothing pruned');
  assert.equal(h.matrix[1].dst, 'bus5');
  // pruneBuses with a bus list only looks at those buses; without one it sweeps every unlinked bus
  h.matrix[2] = row({ src: 'env3', dst: 'bus6', amt: 0.5 });
  assert.equal(pruneBuses(h, [6, 99, 'x']), 1);
  assert.equal(pruneBuses(h, new Set([1, 2])), 0);
  assert.equal(pruneBuses(h, 5), 1);
  h.matrix[1] = row({ src: 'lfo3', dst: 'bus5', amt: 0.5, bi: 1 });
  assert.equal(pruneBuses(h, []), 0);
  assert.equal(pruneBuses(h), 1);
});

test('16f initLfos and copyLfo', () => {
  const s = defaultSerum();
  s.lfo[0] = { mode: 'env', bpm: 0, dot: 1, trip: 1, anchor: 0, pts: [[0, 0.1, 0.5], [0.4, 0.9, 0, 2, 3], [1, 0.1, 0]], loop: 1, start: 1 };
  Object.assign(s.p, { 'l1.rate': 0.3, 'l1.rise': 0.2, 'l1.delay': 0.1, 'l1.smooth': 0.6 });
  // copyLfo: everything incl. bus links and the four knobs, deep
  assert.equal(copyLfo(s, 0, 5), true);
  assert.deepEqual(s.lfo[5], s.lfo[0]);
  assert.notEqual(s.lfo[5].pts, s.lfo[0].pts);
  assert.notEqual(s.lfo[5].pts[1], s.lfo[0].pts[1]);
  assert.deepEqual(['rate', 'rise', 'delay', 'smooth'].map(k => s.p['l6.' + k]), [0.3, 0.2, 0.1, 0.6]);
  s.lfo[5].pts[1][1] = 0.2;
  assert.equal(s.lfo[0].pts[1][1], 0.9);
  for (const [a, b] of [[0, 0], [0, 8], [-1, 2], [1.5, 2]]) assert.equal(copyLfo(s, a, b), false);
  assert.deepEqual(normalizeSerum(s), s);
  // copying over an LFO whose points linked a bus nothing else links prunes that bus's rows (inv A13)
  const c = defaultSerum();
  c.lfo[2].pts = [[0, 0, 0], [0.5, 1, 0, 9, 0], [1, 0, 0]];
  c.lfo[3].pts = [[0, 0, 0], [0.5, 1, 0, 0, 4], [1, 0, 0]];
  c.lfo[4].pts = [[0, 0, 0], [0.5, 1, 0, 0, 4], [1, 0, 0]];
  c.matrix[0] = row({ src: 'env2', dst: 'bus9', amt: 0.5 });
  c.matrix[1] = row({ src: 'env2', dst: 'bus4', amt: 0.5 });
  c.matrix[2] = row({ src: 'env2', dst: 'bus11', amt: 0.5 });
  assert.equal(copyLfo(c, 0, 2), true);
  assert.deepEqual(c.matrix.slice(0, 3).map(r => r.dst), ['', 'bus4', 'bus11']);
  assert.equal(copyLfo(c, 0, 3), true);
  assert.equal(c.matrix[1].dst, 'bus4', 'still linked by LFO 5');
  // initLfos: LFOs and knobs to default, LFO-reading rows cleared, orphaned bus rows pruned
  s.matrix[0] = row({ src: 'lfo1', dst: 'f.cutoff', amt: 0.5 });
  s.matrix[1] = row({ src: 'env1', dst: 'f.res', amt: 0.5, aux: 'lfo6' });
  s.matrix[2] = row({ src: 'env2', dst: 'bus2', amt: 0.5 });
  s.matrix[3] = row({ src: 'env3', dst: 'l1.rate', amt: 0.5 });
  s.matrix[4] = row({ src: 'macro1', dst: 'a.level', amt: 0.5 });
  s.matrix[5] = row({ src: 'macro2', dst: 'bus12', amt: 0.5 });
  assert.equal(initLfos(s), 3);
  assert.equal(s.matrix[5].dst, 'bus12', 'a bus no point linked before the reset keeps its row');
  s.matrix[5] = row({});
  const d = defaultSerum();
  assert.deepEqual(s.lfo, d.lfo);
  for (let l = 1; l <= 8; l++) for (const k of ['rate', 'rise', 'delay', 'smooth']) assert.equal(s.p[`l${l}.${k}`], d.p[`l${l}.${k}`]);
  assert.deepEqual(s.matrix.slice(0, 3), [row({}), row({}), row({})]);
  assert.equal(s.matrix[3].dst, 'l1.rate', 'rows targeting LFO knobs stay');
  assert.equal(s.matrix[4].src, 'macro1');
  assert.deepEqual(normalizeSerum(s), s);
});

// A state whose module fields all differ from `other` (k = 0 / 1 give two distinct valid values)
function moduleState(k) {
  const s = defaultSerum();
  for (const m of Object.keys(MODULE_FIELDS)) {
    for (const id of MODULE_FIELDS[m].p) {
      const d = DESTS[DEST_INDEX[id]], x = 0.3 + 0.2 * k;
      s.p[id] = STEPPED.has(d.law) ? Math.round(x * (d.hi - d.lo)) / (d.hi - d.lo) : x;
    }
  }
  s.osc = [0, 1].map(o => ({ wt: `user:k${k}o${o}`, remap: [[0, 0.1 * k, 0], [0.5, 0.3, 0.2 * k], [1, 1, 0]], memSet: Array(16).fill(0.1 + 0.3 * k + 0.01 * o) }));
  s.global.uniRange = [3 + k, 5 + k];
  s.global.uniMode = [1 + k, 2 + k];
  s.noise = { src: `nzuser:k${k}`, oneshot: k, keytrack: 1 - k, direct: k };
  s.sub = { direct: k };
  s.filter = { keytrack: k };
  return normalizeSerum(s);
}

test('16g applyPreset: parameter, module and misc locks; midi; no shared objects', () => {
  const cur = moduleState(0), pre = moduleState(1);
  Object.assign(cur.p, { 'f.cutoff': 0.21, 'g.master': 0.4, 'e2.att': 0.33 });
  Object.assign(pre.p, { 'f.cutoff': 0.77, 'g.master': 0.9, 'e2.att': 0.66 });
  cur.voicing.poly = 3;
  cur.global.os = 4;
  cur.global.a4 = 432;
  pre.voicing.poly = 16;
  pre.global.os = 1;
  pre.global.a4 = 445;
  cur.ui.page = 'matrix';
  cur.midi = { 1: 'f.cutoff' };
  pre.midi = { 7: 'g.master' };
  pre.author = 'P';
  const preset = deepFreeze({ name: 'P', cat: 'Lead', v: { s: pre }, fx: defaultFx() });
  // no locks: the preset's state, cur's ui/locks
  const r0 = applyPreset(cur, preset);
  assert.deepEqual({ ...r0, ui: 0, locks: 0 }, { ...normalizeSerum(pre), ui: 0, locks: 0 });
  assert.deepEqual(r0.ui, cur.ui);
  assert.equal(sharesObjects(r0, preset), false, 'no object shared with the preset');
  assert.equal(sharesObjects(r0, cur), false, 'no object shared with cur');
  r0.p['a.level'] = 0.123;
  r0.lfo[0].pts[1][1] = 0.4;
  r0.osc[0].remap[0][1] = 0.6;
  r0.matrix[0].amt = 1;
  r0.global.uniRange[0] = 9;
  assert.deepEqual(preset.v.s, pre, 'frozen preset intact');
  // parameter locks (synth ids, g.master; FX ids are applyPresetFx's)
  cur.locks.p = ['f.cutoff', 'g.master', 'fx.rev.mix'];
  const r1 = applyPreset(cur, preset);
  assert.deepEqual([r1.p['f.cutoff'], r1.p['g.master'], r1.p['e2.att']], [0.21, 0.4, 0.66]);
  assert.equal(r1.p['fx.rev.mix'], undefined);
  assert.deepEqual(r1.locks, cur.locks);
  cur.locks.p = [];
  // each module lock keeps every MODULE_FIELDS field of that module and nothing else
  for (const m of Object.keys(MODULE_FIELDS)) {
    cur.locks.mod = [m];
    const r = applyPreset(cur, preset);
    for (const mm of Object.keys(MODULE_FIELDS)) {
      const want = mm === m ? cur : pre;
      for (const id of MODULE_FIELDS[mm].p) assert.equal(r.p[id], want.p[id], `${m} lock: ${id}`);
      for (const path of MODULE_FIELDS[mm].paths) {
        const get = o => path.reduce((v, k) => v[k], o);
        assert.deepEqual(get(r), get(want), `${m} lock: ${path.join('.')}`);
        if (typeof get(r) === 'object') assert.notEqual(get(r), get(cur), 'deep copy');
      }
    }
    assert.equal(r.p['e2.att'], 0.66);
  }
  cur.locks.mod = [];
  // misc locks
  for (const [k, path, cv, pv] of [['poly', ['voicing', 'poly'], 3, 16], ['os', ['global', 'os'], 4, 1], ['tuning', ['global', 'a4'], 432, 445]]) {
    cur.locks.misc = { poly: 0, os: 0, tuning: 0, [k]: 1 };
    const r = applyPreset(cur, preset);
    assert.equal(r[path[0]][path[1]], cv, k + ' locked');
    for (const [k2, p2, , pv2] of [['poly', ['voicing', 'poly'], 3, 16], ['os', ['global', 'os'], 4, 1], ['tuning', ['global', 'a4'], 432, 445]]) {
      if (k2 !== k) assert.equal(r[p2[0]][p2[1]], pv2, `${k} lock leaves ${k2}`);
    }
    assert.equal(pv, applyPreset({ ...cur, locks: { p: [], mod: [], misc: {} } }, preset)[path[0]][path[1]]);
  }
  cur.locks.misc = { poly: 0, os: 0, tuning: 0 };
  // midi: a non-empty preset map wins, an empty one keeps the current map
  assert.deepEqual(applyPreset(cur, preset).midi, { 7: 'g.master' });
  const pe = deepFreeze({ name: 'E', cat: 'Init', v: { s: { ...pre, midi: {} } }, fx: null });
  assert.deepEqual(applyPreset(cur, pe).midi, { 1: 'f.cutoff' });
  // warp single direction re-applied (keeps A)
  const cw = defaultSerum();
  cw.p['b.warpMode'] = 19 / 22;
  cw.locks.mod = ['oscB'];
  const pw = defaultSerum();
  pw.p['a.warpMode'] = 18 / 22;
  const rw = applyPreset(cw, { v: { s: pw } });
  assert.deepEqual([rw.p['a.warpMode'], rw.p['b.warpMode']], [18 / 22, 0]);
  // factory Init (deep-frozen), garbage presets
  const ri = applyPreset(cur, FACTORY_PRESETS[0]);
  assert.deepEqual({ ...ri, ui: 0, locks: 0, midi: 0 }, { ...defaultSerum(), ui: 0, locks: 0, midi: 0 });
  assert.deepEqual(applyPreset(cur, null).p, defaultSerum().p);
  assert.deepEqual(applyPreset(null, preset).p, normalizeSerum(pre).p);
  for (const r of [r0, r1, ri]) assert.deepEqual(normalizeSerum(r), r, 'result normalized');
});

test('16h applyPresetFx: Lock FX Rack, locked FX ids, ui and lock from the current rack', () => {
  const cur = defaultFx(), pre = defaultFx();
  cur.p['fx.rev.mix'] = 0.9;
  cur.p['fx.dly.feed'] = 0.1;
  cur.p['fx.dist.on'] = 1;
  cur.order = ['fil', 'eq', 'rev', 'cmp', 'dly', 'cho', 'phs', 'flg', 'dist', 'hyper'];
  cur.ui.sel = 'rev';
  cur.ui.lvl.cmp = 1;
  pre.p['fx.rev.mix'] = 0.5;
  pre.p['fx.dly.feed'] = 0.7;
  pre.p['fx.cho.on'] = 1;
  pre.dist.xa = [[0, 0, 0], [0.5, 0.8, 0], [1, 1, 0]];
  pre.phase = [0.1, 0.2, 0.3, 0.4];
  deepFreeze(pre);
  const r = applyPresetFx(cur, pre, ['fx.rev.mix', 'f.cutoff', 'g.master', 'nope']);
  assert.equal(r.p['fx.rev.mix'], 0.9, 'locked');
  assert.equal(r.p['fx.dly.feed'], 0.7);
  assert.equal(r.p['fx.dist.on'], 0);
  assert.equal(r.p['fx.cho.on'], 1);
  assert.deepEqual(r.order, [...C.FX_ORDER_DEFAULT]);
  assert.deepEqual(r.dist.xa, pre.dist.xa);
  assert.deepEqual(r.phase, pre.phase);
  assert.deepEqual(r.ui, cur.ui);
  assert.notEqual(r.ui, cur.ui);
  assert.equal(r.lock, 0);
  assert.equal(sharesObjects(r, pre), false);
  assert.equal(sharesObjects(r, cur), false);
  r.dist.xa[1][1] = 0.1;
  assert.equal(pre.dist.xa[1][1], 0.8);
  // Lock FX Rack: a deep copy of the current rack, whatever the preset holds
  cur.lock = 1;
  const k = applyPresetFx(cur, pre, []);
  assert.deepEqual(k, normalizeFx(cur));
  assert.equal(sharesObjects(k, cur), false);
  cur.lock = 0;
  // absent preset rack → defaults (+ locked values, ui)
  const d = applyPresetFx(cur, undefined, ['fx.dly.feed']);
  assert.deepEqual({ ...d, ui: 0, p: 0 }, { ...defaultFx(), ui: 0, p: 0 });
  assert.equal(d.p['fx.dly.feed'], 0.1);
  assert.equal(d.p['fx.rev.mix'], defaultFx().p['fx.rev.mix']);
  assert.deepEqual(applyPresetFx(null, null), defaultFx());
});

test('16i destBase and copyModule (extras)', () => {
  const s = defaultSerum(), fx = defaultFx();
  s.p['f.cutoff'] = 0.3;
  s.p['g.master'] = 0.6;
  fx.p['fx.rev.mix'] = 0.8;
  assert.equal(destBase(s, fx, 'f.cutoff'), 0.3);
  assert.equal(destBase(s, fx, 'g.master'), 0.6);
  assert.equal(destBase(s, fx, 'fx.rev.mix'), 0.8);
  assert.equal(destBase(s, null, 'fx.rev.mix'), DESTS[DEST_INDEX['fx.rev.mix']].def);
  assert.equal(destBase(null, null, 'f.res'), 0.1);
  assert.equal(destBase(s, fx, 'nope'), 0);
  // module Copy / Paste / Init
  const a = moduleState(0), b = moduleState(1);
  assert.equal(copyModule(b, a, 'filter'), true);
  for (const id of MODULE_FIELDS.filter.p) assert.equal(b.p[id], a.p[id]);
  assert.deepEqual(b.filter, a.filter);
  assert.notEqual(b.filter, a.filter);
  assert.notEqual(b.p['a.level'], a.p['a.level'], 'other modules untouched');
  assert.equal(copyModule(b, defaultSerum(), 'oscA'), true);
  assert.deepEqual(b.osc[0], defaultSerum().osc[0], 'Init OSC A');
  assert.deepEqual([b.global.uniRange[0], b.global.uniMode[0], b.global.uniRange[1]], [2, 0, 6]);
  assert.equal(copyModule(b, a, 'constructor'), false);
  assert.equal(copyModule(b, a, 'lfo'), false);
  assert.deepEqual(normalizeSerum(b), b);
  // Paste OSC A onto OSC B (and back): a.* → b.*, osc[0] → osc[1], uniRange / uniMode [0] → [1]
  const x = moduleState(0), y = moduleState(1);
  x.p['a.semi'] = 1;
  assert.equal(copyModule(y, x, 'oscB', 'oscA'), true);
  for (const id of MODULE_FIELDS.oscA.p) assert.equal(y.p['b.' + id.slice(2)], x.p[id], id);
  assert.equal(y.p['b.semi'], 1);
  assert.deepEqual(y.osc[1], x.osc[0]);
  assert.notEqual(y.osc[1], x.osc[0]);
  assert.deepEqual([y.global.uniRange[1], y.global.uniMode[1]], [x.global.uniRange[0], x.global.uniMode[0]]);
  assert.deepEqual(y.osc[0], moduleState(1).osc[0], 'OSC A of the target untouched');
  assert.equal(y.p['a.semi'], moduleState(1).p['a.semi']);
  const z = moduleState(1);
  assert.equal(copyModule(z, x, 'oscA', 'oscB'), true);
  assert.deepEqual(z.osc[0], x.osc[1]);
  for (const id of MODULE_FIELDS.oscB.p) assert.equal(z.p['a.' + id.slice(2)], x.p[id], id);
  for (const [m, f] of [['oscA', 'filter'], ['noise', 'sub'], ['oscB', 'lfo']]) assert.equal(copyModule(z, x, m, f), false, m + ' ← ' + f);
  // the pasted oscillator wins the warp single-direction rule (inv A5), like warpChoice
  const w1 = defaultSerum(), w2 = defaultSerum();
  w1.p['a.warpMode'] = 19 / 22;            // AM (from B)
  w2.p['a.warpMode'] = 18 / 22;            // FM (from B)
  copyModule(w2, w1, 'oscB', 'oscA');      // B: AM (from A) → A's FM (from B) goes Off
  assert.deepEqual([w2.p['a.warpMode'], w2.p['b.warpMode']], [0, 19 / 22]);
  const w3 = defaultSerum();
  w3.p['b.warpMode'] = 20 / 22;
  copyModule(w3, w1, 'oscA');
  assert.deepEqual([w3.p['a.warpMode'], w3.p['b.warpMode']], [19 / 22, 0]);
  w3.p['b.warpMode'] = 21 / 22;           // FM (Noise) never conflicts
  copyModule(w3, w1, 'oscA');
  assert.equal(w3.p['b.warpMode'], 21 / 22);
});

/* ------------------------------------------------------------ hardening */

test('hardening: compilers never throw and repair non-normalized input', () => {
  const ref = compileSerum(defaultSerum());
  for (const x of [null, undefined, {}, 'x', 7, [], { v: 1 }, { ...defaultSerum(), lfo: 'x' }, { ...defaultSerum(), matrix: [] }]) {
    const P = compileSerum(x);
    assert.equal(P.engine, 'serum');
    assert.deepEqual(P.serum.base, ref.serum.base, String(x));
    assert.equal(P.serumT.key, ref.serumT.key);
  }
  const bad = defaultSerum();
  bad.lfo[3].pts = [[0, 0, 0], [0.5, NaN, 0], [1, 0, 0]];
  bad.p['a.level'] = 7;
  bad.voicing.poly = 'many';
  bad.global.os = 3;
  bad.matrix[0] = row({ src: 'env2', dst: 'f.cutoff', amt: 5, out: 3 });
  const P = compileSerum(bad);
  assert.ok(P.serumT.lfoTab.every(Number.isFinite));
  assert.equal(P.serumT.key, compileSerum(normalizeSerum(bad)).serumT.key);
  assert.equal(P.serum.base[0], 1);
  assert.equal(P.poly, 8);
  assert.equal(P.serum.os, 4);
  assert.equal(P.serum.mAmt[0], 1);
  const ids = defaultSerum();
  ids.osc[1].wt = 'noise:Pink';
  ids.noise.src = 'bogus';
  ids.p['b.on'] = 1;
  ids.p['n.on'] = 1;
  const I = compileSerum(ids);
  assert.deepEqual([I.serum.wt[1], I.serum.noiseId, I.needs], ['factory:Default', 'noise:White', ['factory:Default', 'noise:White']], 'table ids repaired');
  const tricky = defaultSerum();
  tricky.osc[0].memSet[3] = 'x';
  tricky.macros[1].v = 9;
  tricky.global.uniRange = [99, -1];
  const T = compileSerum(tricky).serum;
  assert.deepEqual([T.memSet[3], T.macro[1], T.uniRange[0], T.uniRange[1]], [0, 1, 48, 0]);
  // FX
  const fref = compileFx(defaultFx());
  for (const x of [null, undefined, {}, 'x', { ...defaultFx(), order: ['dist', 'dist'] }, { ...defaultFx(), phase: [1] }]) {
    const F = compileFx(x);
    assert.deepEqual(F.base, fref.base);
    assert.equal(F.xsKey, fref.xsKey);
    assert.equal(compileFxT(x).key, fref.xsKey);
  }
  const fb = defaultFx();
  fb.dist.xb = [[0, 0, 0], [0.4, Infinity, 0], [1, 1, 0]];
  fb.p['fx.dly.mix'] = -3;
  fb.rev.type = 'x';
  fb.phase = [1.5, -0.25, 'a', 0];
  const F = compileFx(fb, null);
  assert.equal(F.base[DEST_INDEX['fx.dly.mix'] - NS], 0);
  assert.equal(F.revType, 1);
  assert.deepEqual([...F.phase], [0.5, 0.75, 0, 0]);
  assert.ok(compileFxT(fb).xsB.every(Number.isFinite));
  assert.deepEqual(fxModded(null), new Uint8Array(100));
  // FX ctx scalars clamped like compileSerum's; silence is a switch (default 1)
  for (const [ctx, want] of [[{ bpm: -5, smooth: -1, silence: 1e9 }, [120, 0.01, 1]], [{ bpm: 0, smooth: 0, silence: 0 }, [120, 0.01, 0]],
    [{ bpm: 2000, smooth: 9, silence: 'x' }, [999, 8, 1]], [{ bpm: 90, smooth: 2, silence: false }, [90, 2, 0]], [{}, [120, 1, 1]]]) {
    const Q = compileFx(defaultFx(), ctx);
    assert.deepEqual([Q.bpm, Q.smooth, Q.silence], want, JSON.stringify(ctx));
  }
});

test('hardening: malformed curves never reach the tables or the shared curve cache', () => {
  const finite = T => Object.values(T).every(a => !ArrayBuffer.isView(a) || a.every(Number.isFinite));
  // every curve flaw is repaired through normalize, so the CT always matches its key (and the normalized state)
  const flaws = {
    'c string': [[0, 0.2, 'oops'], [1, 1, 0]], 'c -100': [[0, 0, -100], [0.5, 1, 0], [1, 0, 0]], 'c 1e308': [[0, 0, 1e308], [1, 1, 0]],
    'c NaN': [[0, 0, NaN], [1, 1, 0]], 'c object': [[0, 0, {}], [1, 1, 0]], 'c null': [[0, 0, null], [1, 1, 0]],
    unsorted: [[0, 0, 0], [0.75, 0.2, 0], [0.25, 1, 0], [1, 0, 0]], 'x > 1': [[0, 0, 0], [1.5, 1, 0], [1, 0, 0]],
    'y < 0': [[0, -0.5, 0], [1, 1, 0]], 'y string': [[0, '0.5', 0], [1, 1, 0]], 'first x ≠ 0': [[0.1, 0, 0], [1, 1, 0]],
    'last x ≠ 1': [[0, 0, 0], [0.9, 1, 0]], 'bus 300': [[0, 0, 0], [0.5, 1, 0, 0, 300], [1, 0, 0]], 'bus 2.5': [[0, 0, 0], [0.5, 1, 0, 2.5, 0], [1, 0, 0]],
    'bus on an end': [[0, 0, 0, 3, 0], [1, 1, 0]],
  };
  const ref = compileSerum(defaultSerum());
  for (const [name, pts] of Object.entries(flaws)) {
    for (const where of ['lfo', 'remap', 'velo']) {
      const s = defaultSerum();
      if (where === 'lfo') s.lfo[2].pts = pts; else if (where === 'remap') s.osc[1].remap = pts; else s.velo.pts = pts;
      const P = compileSerum(s), N = compileSerum(normalizeSerum(s));
      assert.ok(finite(P.serumT), `${name} in ${where}: finite tables`);
      assert.equal(P.serumT, N.serumT, `${name} in ${where}: the repaired tables are the normalized state's`);
      assert.ok(finite(N.serumT));
      assert.deepEqual([...P.serum.base], [...ref.serum.base]);
    }
    const f = defaultFx();
    f.dist.xa = pts.map(p => p.slice(0, 3));
    const X = compileFxT(f), Xn = compileFxT(normalizeFx(f));
    assert.ok(X.xsA.every(Number.isFinite) && X.xsB.every(Number.isFinite), name + ' in X-Shaper');
    assert.equal(X, Xn, name + ' X-Shaper: same tables as the normalized state');
    assert.equal(compileFx(f).xsKey, Xn.key);
  }
  // the reported sequence: a bad curvature compiled first must not poison the normalized state's CT
  const s1 = defaultSerum();
  s1.lfo[2].pts = [[0, 0.2, 'oops'], [1, 1, 0]];
  const T1 = compileSerum(s1).serumT, T2 = compileSerum(normalizeSerum(s1)).serumT;
  assert.equal(T1, T2);
  assert.ok(T2.lfoTab.every(Number.isFinite));
  close(T2.lfoTab[2 * 1025 + 512], 0.6, 1e-7);
  // LFO start / loop must index a point: otherwise the CT would be cached under another state's key
  for (const [start, loop] of [[1.5, -1], ['1', -1], [-1, -1], [5, -1], [0, 2.5], [0, -2], [0, 9], [0, null]]) {
    const s = defaultSerum();
    s.lfo[4].start = start;
    s.lfo[4].loop = loop;
    const P = compileSerum(s), N = normalizeSerum(s);
    assert.equal(P.serumT, compileSerum(N).serumT, `start ${start} loop ${loop}`);
    assert.equal(P.serumT.lfoStart[4], N.lfo[4].pts[N.lfo[4].start][0]);
  }
  const ok = defaultSerum();
  ok.lfo[1].start = 1;
  ok.lfo[1].loop = 2;
  assert.equal(compileSerum(ok).serumT.lfoLoop[1], 1);
  // normalized curves (graph.js output) are never re-normalized: c and links are accepted as they are
  const g = defaultSerum();
  g.lfo[0].pts = [[0, 0, -1, 0, 4], [0.5, 1, 1, 16, 0], [0.5, 0.3, 0.25], [1, 0, 0, 0, 2]];
  const G = compileSerum(g);
  assert.equal(G.serumT, compileSerum(normalizeSerum(g)).serumT);
  assert.deepEqual([...G.serumT.lfoPm.slice(0, 8)], [0, 4, 16, 0, 0, 0, 0, 2]);
});

test('hardening: normalizeSerum table ids, curve helper guards', () => {
  const s = defaultSerum();
  s.osc[0].wt = 'noise:Pink';
  s.osc[1].wt = 'user:abc';
  s.noise.src = 'factory:Default';
  let n = normalizeSerum(s);
  assert.deepEqual([n.osc[0].wt, n.osc[1].wt, n.noise.src], ['factory:Default', 'user:abc', 'noise:White']);
  s.osc[0].wt = 'factory:';
  s.noise.src = 'nzuser:9b1c';
  n = normalizeSerum(s);
  assert.deepEqual([n.osc[0].wt, n.noise.src], ['factory:Default', 'nzuser:9b1c']);
  s.osc[0].wt = 'user:' + 'x'.repeat(300);
  assert.equal(normalizeSerum(s).osc[0].wt, 'factory:Default');
  const huge = defaultSerum();
  huge.lfo[0].pts = new Array(200000).fill([0.5, 0.5, 0]);
  assert.equal(normalizeSerum(huge).lfo[0].pts.length, 480);
  assert.equal(evalPts([], 0.5), 0);
  assert.equal(evalPts(null, 0.5), 0);
  assert.equal(renderPts([[0, 0, 0], [1, 1, 0]], 0).length, 2);
  assert.equal(renderPts([[0, 0, 0], [1, 1, 0]], NaN).length, 2);
});

/* ------------------------------------------------------------ 17. FX */

test('17 defaultFx / normalizeFx / compileFx / compileFxT', () => {
  const fx = defaultFx();
  assert.deepEqual(normalizeFx(fx), fx);
  for (const x of [null, undefined, 'x', 3, [], {}]) assert.deepEqual(normalizeFx(x), fx);
  const ids = Object.keys(fx.p);
  assert.equal(ids.length, 98);
  assert.deepEqual(ids, DESTS.slice(NS).map(d => d.id).filter(id => id !== 'g.master' && id !== 'g.bypass'));
  for (const id of ids) assert.equal(fx.p[id], DESTS[DEST_INDEX[id]].def);
  assert.deepEqual(Object.keys(fx.ui.lvl), ['hyper', 'dim', 'dist', 'flg', 'phs', 'cho', 'dly', 'cmp', 'rev', 'fil']);
  const P = compileFx(fx);
  assert.deepEqual(Object.keys(P).sort(), ['NF', 'alloc', 'any', 'base', 'bpm', 'byp', 'choMono', 'filTypeAll', 'order', 'phase', 'revType',
    'seed', 'silence', 'smooth', 'ver', 'xsKey'].sort());
  assert.ok(P.base instanceof Float64Array && P.base.length === 100);
  for (const k of ['order', 'byp', 'alloc']) assert.ok(P[k] instanceof Uint8Array && P[k].length === 10, k);
  assert.ok(P.phase instanceof Float64Array && P.phase.length === 4);
  assert.deepEqual([...P.order], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual([P.ver, P.NF, P.any, P.base[0], P.base[86], P.seed, P.revType, P.choMono, P.filTypeAll, P.bpm, P.smooth, P.silence],
    [1, 100, 0, 1, 0, 0, 1, 0, 0, 120, 1, 1]);
  assert.deepEqual([...P.alloc], new Array(10).fill(0));
  for (let k = 1; k < 100; k++) if (k !== 86) assert.equal(P.base[k], DESTS[NS + k].def);
  assert.equal(compileFx(fx, { master: 0.7 }).base[0], 0.7);
  assert.equal(compileFx(fx, { bypass: 1 }).base[86], 1);
  const md = new Uint8Array(100);
  md[FIDX.DLY_ON] = 1;
  md[FIDX.FIL_TYPE] = 1;
  const Pm = compileFx(fx, { modded: md, seed: true, bpm: 140, smooth: 0.5, silence: 0 });
  assert.equal(Pm.alloc[5], 1);
  assert.equal(Pm.alloc.reduce((a, b) => a + b), 1);
  assert.equal(Pm.filTypeAll, 1);
  assert.deepEqual([Pm.seed, Pm.bpm, Pm.smooth, Pm.silence, Pm.any], [1, 140, 0.5, 0, 0]);
  const on = defaultFx();
  on.p['fx.rev.on'] = 1;
  on.byp.cho = 1;
  on.cho.mono = 1;
  on.rev.type = 0;
  on.phase = [0.1, 0.2, 0.3, 0.4];
  const Po = compileFx(on);
  assert.deepEqual([Po.alloc[7], Po.any, Po.byp[4], Po.choMono, Po.revType, ...Po.phase], [1, 1, 1, 1, 0, 0.1, 0.2, 0.3, 0.4]);
  // X-Shaper key and tables
  const a = defaultFx(), b = defaultFx();
  assert.equal(compileFx(a).xsKey, compileFx(b).xsKey);
  b.dist.xa = [[0, 0, 0], [0.5, 0.9, 0], [1, 1, 0]];
  assert.notEqual(compileFx(b).xsKey, compileFx(a).xsKey);
  const T = compileFxT(a);
  assert.equal(T.key, compileFx(a).xsKey);
  assert.equal(compileFxT(defaultFx()), T, 'memoised');
  assert.ok(T.xsA instanceof Float32Array && T.xsA.length === 1025 && T.xsB.length === 1025);
  assert.equal(T.xsA[512], 0.5);
  close(compileFxT(b).xsA[256], 0.45, 1e-7);
  // normalizeFx repairs
  const bad = { order: ['eq', 'eq', 'foo', 'dist', 7], byp: { dist: true, flg: 'x' }, p: { 'fx.dly.mix': 3, 'fx.dist.mode': 0.5, 'g.master': 0.2, junk: 1 },
    dist: { xa: [[0.5, 0.5]], xb: 'x' }, cho: { mono: 1 }, rev: { type: 5 }, phase: [1.25, -0.25, NaN], lock: 1, ui: { lvl: { cmp: 1, eq: 1 }, sel: 'rev' } };
  const nb = normalizeFx(bad);
  assert.deepEqual(nb.order, ['eq', 'dist', 'hyper', 'flg', 'phs', 'cho', 'dly', 'cmp', 'rev', 'fil']);
  assert.deepEqual([nb.byp.dist, nb.byp.flg], [1, 0]);
  assert.equal(nb.p['fx.dly.mix'], 1);
  assert.equal(nb.p['fx.dist.mode'], 8 / 15);
  assert.equal(nb.p['g.master'], undefined);
  assert.equal(nb.p.junk, undefined);
  assert.deepEqual(nb.dist, { xa: [[0, 0.5, 0], [1, 0.5, 0]], xb: [[0, 0, 0], [1, 1, 0]] });
  assert.deepEqual([nb.cho.mono, nb.rev.type, nb.phase, nb.lock], [1, 1, [0.25, 0.75, 0, 0], 1]);
  assert.deepEqual(nb.ui, { lvl: { hyper: 0, dim: 0, dist: 0, flg: 0, phs: 0, cho: 0, dly: 0, cmp: 1, rev: 0, fil: 0 }, sel: 'rev' });
  assert.deepEqual(normalizeFx(nb), nb);
  assert.deepEqual(JSON.parse(JSON.stringify(nb)), nb);
  assert.deepEqual([...compileFx(nb).order], [8, 1, 0, 2, 3, 4, 5, 6, 7, 9]);
  // inputs are never mutated (deep-frozen inputs would throw)
  const fz = deepFreeze(normalizeFx(bad));
  assert.deepEqual(normalizeFx(fz), nb);
  compileFx(fz, { modded: md });
  compileFxT(fz);
  assert.equal(normalizeFx(fz).dist.xa === fz.dist.xa, false);
});

/* ------------------------------------------------------------ 18. performance */

test('18 compileSerum of a dense patch ≤ 2 ms mean (CT memoised)', () => {
  const s = defaultSerum();
  const pts = (bus) => Array.from({ length: 480 }, (_, i) => [i / 479, (Math.sin(i * 0.37) + 1) / 2, ((i % 9) - 4) / 4, bus ? (i % 17) : 0, bus ? ((i * 5) % 17) : 0]);
  s.lfo.forEach((L, l) => { L.pts = pts(true); L.mode = ['trig', 'env', 'off'][l % 3]; L.dot = l & 1; L.trip = (l >> 1) & 1; });
  s.osc.forEach(o => { o.remap = pts(false); });
  s.velo.pts = pts(false);
  s.note.pts = pts(false);
  s.matrix = s.matrix.map((_, i) => row({ src: SRC_MENU[i], dst: DESTS[(i * 7) % ND].id, amt: 0.3, bi: i & 1, curve: 0.2, aux: i % 3 ? 'macro1' : '' }));
  const n = normalizeSerum(s);
  const first = compileSerum(n);
  for (let r = 0; r < 20; r++) { n.p['f.cutoff'] = r / 20; compileSerum(n); }
  const t0 = performance.now();
  for (let r = 0; r < 200; r++) { n.p['f.cutoff'] = r / 200; compileSerum(n); }
  const mean = (performance.now() - t0) / 200;
  assert.equal(compileSerum(n).serumT, first.serumT);
  assert.ok(mean <= 2, 'mean ' + mean.toFixed(3) + ' ms');
  console.log(`# compileSerum dense patch: ${mean.toFixed(3)} ms mean`);
});

/* ------------------------------------------------------------ fixtures */

test('fixtures: compiled defaults equal serum-core output', () => {
  const P = compileSerum(defaultSerum());
  assert.deepEqual(loadFixture('cp-default.json'), P.serum);
  assert.deepEqual(loadFixture('ct-default.json'), P.serumT);
  assert.deepEqual(loadFixture('fxp-default.json'), compileFx(defaultFx()));
  assert.deepEqual(loadFixture('fxt-default.json'), compileFxT(defaultFx()));
});

test('fixtures: gen.mjs reproduces dests.json and filters.json byte for byte', () => {
  const dir = mkdtempSync(join(tmpdir(), 'serum-gen-'));
  try {
    copyFileSync(new URL('./fixtures/gen.mjs', import.meta.url), join(dir, 'gen.mjs'));
    const r = spawnSync(process.execPath, [join(dir, 'gen.mjs')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    for (const f of ['dests.json', 'filters.json']) {
      assert.equal(readFileSync(join(dir, 'fixtures', f), 'utf8'), readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8'), f);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------ module fields, factory presets */

test('MODULE_FIELDS and FACTORY_PRESETS', async () => {
  assert.deepEqual(Object.keys(MODULE_FIELDS), ['oscA', 'oscB', 'noise', 'sub', 'filter']);
  for (const id of ['a.on', 'a.warpMode', 'a.track', 'a.stack', 'a.uniwt', 'a.level']) assert.ok(MODULE_FIELDS.oscA.p.includes(id), id);
  assert.equal(MODULE_FIELDS.oscA.p.length, 20);
  assert.deepEqual([...MODULE_FIELDS.sub.p], ['s.level', 's.pan', 's.on', 's.shape', 's.oct']);
  for (const id of ['f.on', 'f.type', 'f.routeA', 'f.routeS', 'f.cutoff', 'f.mix']) assert.ok(MODULE_FIELDS.filter.p.includes(id), id);
  assert.ok(MODULE_FIELDS.noise.p.includes('n.on'));
  assert.deepEqual(MODULE_FIELDS.oscB.paths, [['osc', 1], ['global', 'uniRange', 1], ['global', 'uniMode', 1]]);
  assert.ok(FACTORY_PRESETS.length >= 24, 'at least 24 factory presets (§0.5 M3)');
  const init = FACTORY_PRESETS[0];
  assert.deepEqual([init.name, init.cat], ['Init', 'Init']);
  assert.deepEqual(normalizeSerum(init.v.s), defaultSerum());
  assert.equal(normalizeSerum(init.v.s).p === init.v.s.p, false);
  // §10.2.19 (M3): every category has at least three presets (Init only the one); names are unique; each preset is
  // normalised, compiles, references factory content only (a fresh install plays it) and is frozen
  const CATS = ['Init', 'Bass', 'Lead', 'Pad', 'Pluck', 'Keys', 'Chord', 'Arp', 'Seq', 'Drum', 'FX'];
  const cats = new Set(FACTORY_PRESETS.map(p => p.cat));
  for (const c of CATS) assert.ok(cats.has(c), c);
  for (const c of cats) assert.ok(CATS.includes(c), 'known category ' + c);
  assert.equal(FACTORY_PRESETS.filter(p => p.cat === 'Init').length, 1);
  for (const c of cats) if (c !== 'Init') assert.ok(FACTORY_PRESETS.filter(p => p.cat === c).length >= 3, c + ': at least 3');
  assert.equal(new Set(FACTORY_PRESETS.map(p => p.name)).size, FACTORY_PRESETS.length);
  for (const pr of FACTORY_PRESETS) {
    assert.ok(Object.isFrozen(pr) && Object.isFrozen(pr.v.s.p), pr.name + ' frozen');
    assert.deepEqual(Object.keys(pr).sort(), ['cat', 'fx', 'name', 'v'], pr.name + ' preset shape (§0.3.12)');
    assert.deepEqual(normalizeSerum(pr.v.s), pr.v.s, pr.name + ' normalised');
    assert.deepEqual(normalizeFx(pr.fx), pr.fx, pr.name + ' fx normalised');
    for (const id of [pr.v.s.osc[0].wt, pr.v.s.osc[1].wt]) assert.match(id, /^factory:/, pr.name);
    assert.match(pr.v.s.noise.src, /^noise:/, pr.name);
    const cp = compileSerum(normalizeSerum(pr.v.s));
    assert.ok(cp.needs.every(id => /^(factory|noise|sub):/.test(id)), pr.name + ' needs');
    assert.ok(cp.serum.base.every(Number.isFinite), pr.name + ' finite CP');
    if (pr.cat === 'Init') continue;
    assert.ok(pr.v.s.notes.length > 20 && pr.v.s.notes.length <= 2000, pr.name + ' has notes');
    assert.equal(pr.v.s.author, 'Factory', pr.name + ' author');
    // matrix rows fill slots from 0 without holes: a row naming an unknown id would have been cleared by normalizeSerum
    const used = pr.v.s.matrix.map(r => r.src !== '' || r.dst !== '');
    assert.ok(used.every((u, i) => !u || i === 0 || used[i - 1]), pr.name + ' matrix has no cleared rows');
    for (const r of pr.v.s.matrix.filter(r => r.src)) assert.ok(r.dst && r.amt !== 0, pr.name + ' active row ' + r.src);
    // no LFO point is linked to a bus (factory shapes are plain graphs)
    assert.equal(linkedBuses(pr.v.s).size, 0, pr.name + ' no dangling bus links');
    const fxp = compileFx(pr.fx, { master: pr.v.s.p['g.master'], bypass: pr.v.s.p['g.bypass'], modded: fxModded(pr.v.s) });
    assert.ok(fxp.base.every(Number.isFinite), pr.name + ' finite FXP');
    assert.ok(pr.v.s.p['g.master'] > 0 && pr.v.s.p['g.master'] <= 1, pr.name + ' master');
  }
  // the table and noise ids exist in wt.js (a typo would leave an oscillator silent)
  const W = await import('../wt.js');
  const known = new Set([...W.FACTORY_TABLES.map(t => t.id), ...W.SUB_TABLES, ...W.NOISES.map(n => n.id)]);
  for (const pr of FACTORY_PRESETS) for (const id of compileSerum(pr.v.s).needs) assert.ok(known.has(id), pr.name + ': ' + id);
});

test('FACTORY_CHAINS: shared chain-library format, normalised racks without ui / lock, frozen', () => {
  assert.equal(FACTORY_CHAINS.type, 'synth.fxchains');
  assert.equal(FACTORY_CHAINS.v, 1);
  const L = FACTORY_CHAINS.chains;
  assert.ok(Array.isArray(L) && L.length >= 5);
  assert.ok(Object.isFrozen(FACTORY_CHAINS) && Object.isFrozen(L) && L.every(c => Object.isFrozen(c.fx.p)));
  assert.equal(new Set(L.map(c => c.name)).size, L.length);
  for (const n of ['Wide Chorus', 'Dub Delay', 'Hall Verb', 'OTT Squash', 'Lo-Fi']) assert.ok(L.some(c => c.name === n), n);
  for (const c of L) {
    assert.deepEqual(Object.keys(c).sort(), ['fx', 'name']);
    assert.ok(typeof c.name === 'string' && c.name.length > 0 && c.name.length <= 48);
    assert.equal('ui' in c.fx || 'lock' in c.fx, false, c.name);
    const n = normalizeFx(c.fx);
    assert.deepEqual(n, Object.assign({}, c.fx, { ui: defaultFx().ui, lock: 0 }), c.name + ' normalised');
    assert.ok(Object.keys(c.fx.byp).some(m => c.fx.p['fx.' + m + '.on'] === 1), c.name + ' enables a module');
    const fxp = compileFx(c.fx, {});
    assert.ok(fxp.base.every(Number.isFinite) && fxp.any === 1, c.name);
    assert.equal(fxp.base[0], 1, c.name + ' master stays 1 on other models');
  }
  // the OTT chain is the multiband compressor
  const ott = L.find(c => c.name === 'OTT Squash').fx;
  assert.equal(ott.p['fx.cmp.on'], 1);
  assert.equal(ott.p['fx.cmp.mb'], 1);
});
