// serum-dsp.js unit tests (owner E3; Phase 2: D1). Run: node --test tests/
// Covers SPEC-serum §10.4 items 1–29: script shape and loading, constants vs tests/fixtures (§3), table store, curves,
// SFilter (all 96 types) and filterImpulse, then voices (pitch, unison, warps, phase, envelopes, LFOs, chaos, noise,
// matrix, note-on evaluation, performance destinations), hooks, snapshot, warm-up, allocation-free hot paths and CPU,
// plus regressions from the reviews (matrix edits while notes sound, reset/warmUp re-sync, transport bookkeeping, WT
// frame-pair crossfades, unison steals, Env-mode anchored LFOs, point-modulation equivalence, low-note aliasing).
//
// Imports only the classic DSP scripts (through node:vm, as the spec's loadDSP) and tests/fixtures/* (E1, M1; C1): the
// compiled default CP/CT (cp-default.json, cp2-default.json, ct2-default.json) and dests.json / dests2.json /
// sources2.json / filters.json. Wavetables are built here (§7.3).
//
// Phase 2, M1a (SPEC-serum2 §0.5 step 2): serum-dsp reads CP v2 (VER 2) and needs sx-base.js + sx-mod.js (§0.3 scripts
// 1 and 4, loaded before it, as in every AudioWorkletGlobalScope). The Phase-1 expectations are unchanged: every test CP is
// the CP v2 a migrated v1 state compiles to (cpV2: the v1 fixture's values in the v2 shapes, S1 mode), FX rows address
// FX-context indices (a stand-in layout: g.master 0, g.bypass 1, v1 FX row k at 8 + k − 1), the CT is a full CT v2 (or
// delivered as parts, mergeCT). Modulation state lives in sx.mod / voice.mod (SxMod, §11.6).
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFixture } from './fixtures/load.mjs';
import * as core from '../serum-core.js?v=10';
import { dspScope, source as dspSource, noAlloc as noAlloc2 } from './dsp-scope.mjs';
import * as GH from './golden-harness.mjs';
import * as CPU from './cpu-gate.mjs';
import v8 from 'node:v8';

const SRC = readFileSync(new URL('../serum-dsp.js', import.meta.url), 'utf8');
const BASE_SRC = readFileSync(new URL('../sx-base.js', import.meta.url), 'utf8');
const MOD_SRC = readFileSync(new URL('../sx-mod.js', import.meta.url), 'utf8');
const FX_PATH = fileURLToPath(new URL('../fx-dsp.js', import.meta.url));

function fixture(name) {
  const url = new URL('fixtures/' + name, import.meta.url);
  return existsSync(url) ? JSON.parse(readFileSync(url, 'utf8')) : null;
}
const DESTS_FX = fixture('dests.json');
const FILTERS_FX = fixture('filters.json');

function mkConsole() {
  const msgs = [];
  const rec = (level) => (...a) => msgs.push({ level, text: a.map(String).join(' ') });
  return { log: rec('log'), info: rec('info'), warn: rec('warn'), error: rec('error'), msgs };
}
// sx-base.js, sx-mod.js, serum-dsp.js in §0.3 order (base: false / mod: false leave that script out)
function loadDSP(ctx = vm.createContext({ console: mkConsole() }), { base = true, mod = true } = {}) {
  if (base) vm.runInContext(BASE_SRC, ctx, { filename: 'sx-base.js' });
  if (mod) vm.runInContext(MOD_SRC, ctx, { filename: 'sx-mod.js' });
  vm.runInContext(SRC, ctx, { filename: 'serum-dsp.js' });
  return { ctx, SerumDSP: ctx.SerumDSP };
}
function makeProc(base = 48000, OS = 2) {
  return { base, OS, fs: base * OS, CH: 4 * OS, p: null, ct: null, bendRaw: 0, wheel: 0, at: 0,
    pat: new Float64Array(128), patSeen: false, bpm: 120, songBeat: () => null, held: [], voices: [], sx: null };
}
function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const dB = (x) => 20 * Math.log10(x);
function mag(h, f, fs) { // |DTFT| of a finite sequence at f Hz
  let re = 0, im = 0;
  for (let n = 0; n < h.length; n++) { const w = -2 * Math.PI * f * n / fs; re += h[n] * Math.cos(w); im += h[n] * Math.sin(w); }
  return Math.hypot(re, im);
}
const MIP_LEN = [2048, 2048, 2048, 1024, 512, 256, 256, 256, 256, 256, 256];
const MIP_HARM = [1023, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1];
function wtEntry(F, fill = (f, j, len) => Math.sin(2 * Math.PI * j / len) * (1 - f / (F + 1))) {
  return { kind: 'wt', v: 1, frames: F, interp: F > 1 ? 1 : 0, morph: F > 1 ? 1 : 0,
    levels: MIP_LEN.map((len, l) => { const data = new Float32Array(F * len); for (let f = 0; f < F; f++) for (let j = 0; j < len; j++) data[f * len + j] = fill(f, j, len); return { len, harm: MIP_HARM[l], data }; }) };
}
function noiseEntry(ch = 1, nLev = 2, len = 4096) {
  const levels = [];
  for (let l = 0, n = len; l < nLev; l++, n >>= 1) levels.push({ len: n, loopStart: 0, loopEnd: n, L: new Float32Array(n), R: ch === 2 ? new Float32Array(n) : null });
  return { kind: 'noise', v: 1, rate: 48000, ch, root: 60, len, loopStart: 0, loopEnd: len, levels };
}
const LAWS = ['lin', 'int', 'enum', 'bool', 'exp', 'pow2', 'pow3', 'pow4', 'pow5', 'rpow3', 'ratio', 'npitch'];
const constName = (id) => id.replace(/^fx\./, '').toUpperCase().replace(/\./g, '_');

/* ------------------------------------------------------------------ loading and shape (§10.4.1, §0.2) */

test('loads in a bare vm context and exports the §8.4.2 API with final signatures', () => {
  const ctx = vm.createContext({ console: mkConsole() });
  const before = new Set(Object.getOwnPropertyNames(vm.runInContext('globalThis', ctx)));
  const { SerumDSP: S } = loadDSP(ctx);
  assert.ok(S, 'SerumDSP published');
  assert.ok(Object.isFrozen(S));
  const added = Object.getOwnPropertyNames(vm.runInContext('globalThis', ctx)).filter((k) => !before.has(k));
  assert.deepEqual(added, ['SxBase', 'SxMod', 'SerumDSP'], 'nothing but the three globals leaks into the global scope');
  assert.equal(S.VER, 2);
  assert.equal(typeof S.epoch, 'number');
  const fns = { storeWT: 2, storeWTFrame: 3, dropWT: 1, attach: 1, reset: 1, idle: 2, transport: 2, begin: 2, fxMods: 1,
    snapshot: 1, mergeCT: 2, recentPitch: 1, warmUp: 1, bend: 2, evalPts: 4, renderWarp: 4, filterImpulse: 6, SerumVoice: 2, SFilter: 1 };
  for (const [k, n] of Object.entries(fns)) {
    assert.equal(typeof S[k], 'function', k);
    assert.equal(S[k].length, n, k + ' arity');
  }
  const sf = { setRate: 1, setType: 1, prealloc: 1, set: 5, tick: 2, process: 4, reset: 0 };
  for (const [k, n] of Object.entries(sf)) assert.equal(S.SFilter.prototype[k].length, n, 'SFilter.' + k);
  const sv = { apply: 1, noteOn: 4, noteOff: 1, kill: 0, render: 5 };
  for (const [k, n] of Object.entries(sv)) assert.equal(S.SerumVoice.prototype[k].length, n, 'SerumVoice.' + k);
  assert.ok(S.tables && typeof S.tables.get === 'function' && typeof S.tables.set === 'function', 'tables is a Map');
});

test('re-evaluation keeps the table Map; a throwing body leaves SerumDSP = null without throwing', () => {
  const con = mkConsole();
  const ctx = vm.createContext({ console: con });
  const { SerumDSP: S1 } = loadDSP(ctx);
  assert.equal(S1.storeWT('user:a', wtEntry(2)), true);
  const ep1 = S1.epoch;
  const fxThere = existsSync(FX_PATH);
  for (let k = 0; k < 2; k++) {
    loadDSP(ctx);
    if (fxThere) assert.doesNotThrow(() => vm.runInContext(readFileSync(FX_PATH, 'utf8'), ctx, { filename: 'fx-dsp.js' }));
  }
  const S2 = ctx.SerumDSP;
  assert.notEqual(S2, S1);
  assert.equal(S2.tables, S1.tables, 'same Map object');
  assert.ok(S2.tables.has('user:a'));
  assert.ok(S2.epoch > ep1, 'epoch keeps increasing across re-evaluation');
  // broken copy: throws inside the try body
  const broken = SRC.replace('try {', 'try {\n    throw new Error(\'boom\');');
  assert.notEqual(broken, SRC);
  assert.doesNotThrow(() => vm.runInContext(broken, ctx));
  assert.equal(ctx.SerumDSP, null);
  assert.ok(con.msgs.some((m) => m.level === 'error' && m.text.includes('serum-dsp: load failed')));
  // a good evaluation after the failure works again (fresh Map)
  loadDSP(ctx);
  assert.ok(ctx.SerumDSP && ctx.SerumDSP.tables.size === 0);
});

test('source follows the DSP script rules (IIFE, environment neutrality, no eval/instanceof/Math.random)', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const body = code.trim();
  assert.ok(body.startsWith('(function () {'), 'file is one IIFE');
  assert.ok(body.endsWith('})();'), 'file is one IIFE');
  assert.match(body, /^\(function \(\) \{\s*'use strict';/);
  const banned = ['sampleRate', 'currentTime', 'currentFrame', 'registerProcessor', 'AudioWorkletProcessor', 'window',
    'document', 'self', 'eval', 'instanceof', 'import', 'export', 'with'];
  for (const w of banned) assert.doesNotMatch(code, new RegExp('\\b' + w + '\\b'), w);
  assert.doesNotMatch(code, /new\s+Function/);
  assert.doesNotMatch(code, /Math\.random/);
});

/* ------------------------------------------------------------------ constants (§3.13, §3.12, §3.4, §3.6, §3.8) */

test('DIDX / FIDX spot values and naming rule (§3.13)', () => {
  const { SerumDSP: S } = loadDSP();
  const D = S.DIDX, F = S.FIDX;
  assert.ok(Object.isFrozen(D) && Object.isFrozen(F));
  assert.equal(Object.keys(D).length, 148);
  assert.equal(Object.keys(F).length, 100);
  const spot = { A_LEVEL: 0, B_LEVEL: 17, N_LEVEL: 34, S_LEVEL: 40, F_CUTOFF: 42, E1_ATT: 48, L1_RATE: 63, C1_RATE: 95,
    G_PORTA: 97, G_TUNE: 99, G_AMP: 100, G_BENDUP: 101, BUS1: 103, BUS16: 118, A_ON: 119, N_ON: 121, S_ON: 122, F_ON: 123,
    F_ROUTEA: 124, A_TRACK: 128, A_WARPMODE: 130, B_WARPMODE: 131, S_SHAPE: 132, S_OCT: 133, F_TYPE: 134, E1_CA: 135,
    C1_BPM: 144, G_WHEEL: 146, G_BEND: 147 };
  for (const [k, v] of Object.entries(spot)) assert.equal(D[k], v, 'DIDX.' + k);
  for (let e = 1; e <= 3; e++) {
    assert.equal(D[`E${e}_ATT`], 48 + 5 * (e - 1));
    assert.equal(D[`E${e}_CA`], 135 + 3 * (e - 1));
    assert.equal(D[`E${e}_CR`], 137 + 3 * (e - 1));
  }
  for (let l = 1; l <= 8; l++) assert.equal(D[`L${l}_RATE`], 63 + 4 * (l - 1));
  for (const k of Object.keys(D)) if (k.startsWith('A_') && D[k] <= 16) assert.equal(D['B_' + k.slice(2)], D[k] + 17, k);
  const fspot = { G_MASTER: 0, HYPER_ON: 1, DLY_TIMEL: 43, FIL_CUTOFF: 79, G_BYPASS: 86, HYPER_RETRIG: 87, DIST_MODE: 88,
    FIL_TYPE: 99 };
  for (const [k, v] of Object.entries(fspot)) assert.equal(F[k], v, 'FIDX.' + k);
});

test('DIDX / FIDX / LAW_TAB equal tests/fixtures/dests.json', { skip: !DESTS_FX && 'tests/fixtures/dests.json not present (E1, M1)' }, () => {
  const { SerumDSP: S } = loadDSP();
  const { NS, NF, ND, DESTS } = DESTS_FX;
  assert.deepEqual([NS, NF, ND, DESTS.length], [148, 100, 248, 248]);
  const T = S.LAW_TAB;
  assert.equal(T.law[Symbol.toStringTag], 'Uint8Array'); assert.equal(T.law.length, ND);
  assert.equal(T.lo[Symbol.toStringTag], 'Float64Array'); assert.equal(T.lo.length, ND);
  assert.equal(T.hi[Symbol.toStringTag], 'Float64Array'); assert.equal(T.hi.length, ND);
  assert.equal(T.cont[Symbol.toStringTag], 'Uint8Array'); assert.equal(T.cont.length, ND);
  DESTS.forEach((d, i) => {
    const name = constName(d.id);
    if (i < NS) assert.equal(S.DIDX[name], i, d.id);
    else assert.equal(S.FIDX[name], i - NS, d.id);
    assert.equal(T.law[i], LAWS.indexOf(d.law), d.id + ' law');
    assert.equal(T.lo[i], d.lo, d.id + ' lo');
    assert.equal(T.hi[i], d.hi, d.id + ' hi');
    assert.equal(T.cont[i], ['int', 'enum', 'bool'].includes(d.law) ? 0 : 1, d.id + ' cont');
  });
});

test('SIDX / SRC_POL follow §3.12', () => {
  const { SerumDSP: S } = loadDSP();
  const ids = ['', 'wheel', 'env1', 'env2', 'env3', 'lfo1', 'lfo2', 'lfo3', 'lfo4', 'lfo5', 'lfo6', 'lfo7', 'lfo8', 'velo',
    'note', 'at', 'pat', 'chaos1', 'chaos2', 'noise', 'rand1', 'rand2', 'alt1', 'alt2', 'macro1', 'macro2', 'macro3',
    'macro4', 'bend', 'mpex', 'mpey', 'mpez', 'relvel', 'fixed'];
  assert.ok(Object.isFrozen(S.SIDX));
  assert.equal(Object.keys(S.SIDX).length, 33);
  ids.forEach((id, i) => { if (i) assert.equal(S.SIDX[id.toUpperCase()], i, id); });
  const spot = { WHEEL: 1, ENV1: 2, LFO1: 5, VELO: 13, NOTE: 14, AT: 15, PAT: 16, CHAOS1: 17, NOISE: 19, RAND1: 20, ALT1: 22,
    MACRO1: 24, BEND: 28, MPEX: 29, RELVEL: 32, FIXED: 33 };
  for (const [k, v] of Object.entries(spot)) assert.equal(S.SIDX[k], v, k);
  assert.equal(S.SRC_POL[Symbol.toStringTag], 'Uint8Array');
  assert.equal(S.SRC_POL.length, 34);
  const bi = new Set(['chaos1', 'chaos2', 'noise', 'bend', 'mpex']);
  ids.forEach((id, i) => assert.equal(S.SRC_POL[i], bi.has(id) ? 1 : 0, id));
});

test('FILTER_FAMILY / FILTER_FAM_OF / SUB_IDS (§3.4, §3.6)', () => {
  const { SerumDSP: S } = loadDSP();
  assert.deepEqual([...S.FILTER_FAMILY], ['ladder', 'svf', 'dual', 'morph', 'comb', 'flange', 'phaser', 'fphs', 'eq', 'ring',
    'snh', 'bank', 'french', 'german', 'addbass', 'formant', 'breject', 'distcomb', 'scream']);
  assert.deepEqual([...S.SUB_IDS], ['sub:Sine', 'sub:RoundRect', 'sub:Saw', 'sub:Square', 'sub:Pulse']);
  assert.equal(S.FILTER_FAM_OF[Symbol.toStringTag], 'Uint8Array');
  assert.equal(S.FILTER_FAM_OF.length, 96);
  const firsts = { 0: 'ladder', 3: 'ladder', 4: 'svf', 17: 'svf', 18: 'dual', 30: 'dual', 31: 'morph', 38: 'morph', 39: 'comb',
    46: 'comb', 47: 'flange', 54: 'flange', 55: 'phaser', 68: 'phaser', 69: 'fphs', 70: 'fphs', 71: 'eq', 75: 'eq',
    76: 'ring', 77: 'ring', 78: 'snh', 79: 'snh', 80: 'bank', 82: 'bank', 83: 'french', 84: 'german', 85: 'addbass',
    86: 'formant', 88: 'formant', 89: 'breject', 90: 'distcomb', 93: 'distcomb', 94: 'scream', 95: 'scream' };
  for (const [t, fam] of Object.entries(firsts)) assert.equal(S.FILTER_FAMILY[S.FILTER_FAM_OF[t]], fam, 'type ' + t);
});

test('FILTER_FAM_OF equals tests/fixtures/filters.json', { skip: !FILTERS_FX && 'tests/fixtures/filters.json not present (E1, M1)' }, () => {
  const { SerumDSP: S } = loadDSP();
  assert.equal(FILTERS_FX.FILTERS.length, 96);
  FILTERS_FX.FILTERS.forEach((f, t) => assert.equal(S.FILTER_FAMILY[S.FILTER_FAM_OF[t]], f.family, f.id));
});

test('UNI tables follow §3.8', () => {
  const { SerumDSP: S } = loadDSP();
  const { uniShape, uniStack, uniCenter } = S.UNI;
  assert.equal(uniShape.length, 5 * 256); assert.equal(uniStack.length, 9 * 256); assert.equal(uniCenter.length, 256);
  const centre = (i, N) => (N % 2 ? i === (N - 1) / 2 : i === N / 2 - 1 || i === N / 2);
  const shape = [(t) => t, (t) => Math.sign(t) * Math.abs(t) ** 1.5, (t) => Math.sign(t) * Math.abs(t) ** 2.5,
    (t) => Math.sign(t) * Math.abs(t) ** 0.5];
  const cyc = { 4: [0, 7, 12], 5: [0, 7, 12, 19, 24], 6: [0, 7, 12, 19, 24, 31, 36] };
  const stack = (s, i, N) => {
    if (s === 0) return 0;
    if (s <= 3) return i % 2 ? 12 * (1 + ((i - 1) / 2) % s) : 0;
    if (s <= 6) return cyc[s][i % cyc[s].length];
    return centre(i, N) ? (s === 7 ? -12 : -24) : 0;
  };
  for (let N = 1; N <= 16; N++) {
    for (let i = 0; i < 16; i++) {
      const o = (N - 1) * 16 + i, t = N > 1 ? 2 * i / (N - 1) - 1 : 0;
      if (i >= N) { assert.equal(uniCenter[o], 0); continue; }
      for (let m = 0; m < 4; m++) assert.ok(Math.abs(uniShape[m * 256 + o] - shape[m](t)) < 1e-15, `shape m${m} N${N} i${i}`);
      assert.equal(uniShape[4 * 256 + o], 0, 'Random rows are 0 (drawn per note-on)');
      for (let s = 0; s < 9; s++) assert.equal(uniStack[s * 256 + o], stack(s, i, N), `stack ${s} N${N} i${i}`);
      assert.equal(uniCenter[o], centre(i, N) ? 1 : 0, `centre N${N} i${i}`);
    }
  }
  // §3.8 examples: 12 (2x) → 0, 12, 0, 24, 0, 12; N = 2 both centre; N = 1 shape 0; N = 2 Linear ±1
  assert.deepEqual([...uniStack.subarray(2 * 256 + 5 * 16, 2 * 256 + 5 * 16 + 6)], [0, 12, 0, 24, 0, 12]);
  assert.deepEqual([uniCenter[16], uniCenter[17]], [1, 1]);
  assert.equal(uniShape[0], 0);
  assert.deepEqual([uniShape[16], uniShape[17]], [-1, 1]);
});

/* ------------------------------------------------------------------ curves (§4.4) */

test('bend and evalPts match §4.4', () => {
  const { SerumDSP: S } = loadDSP();
  const bendRef = (t, k) => (Math.abs(k) < 1e-4 ? t : (1 - Math.exp(-k * t)) / (1 - Math.exp(-k)));
  for (let k = -10; k <= 10; k += 0.5) {
    assert.ok(S.bend(0, k) === 0); assert.ok(Math.abs(S.bend(1, k) - 1) < 1e-15);   // ±0 (verbatim §4.4 formula)
    let prev = -1;
    for (let j = 0; j <= 100; j++) {
      const t = j / 100, v = S.bend(t, k);
      assert.ok(Math.abs(v - bendRef(t, k)) < 1e-15);
      assert.ok(v >= prev - 1e-15, 'monotone'); prev = v;
    }
  }
  assert.equal(S.bend(0.37, 0), 0.37);
  // evalPts over an interleaved array holding two graphs; reference = linear scan per §4.4
  const ref = (pts, x) => {
    if (x <= 0) return pts[0][1];
    const last = pts.length - 1;
    if (x >= 1) return pts[last][1];
    let j = 0;
    for (let i = 0; i <= last; i++) if (pts[i][0] <= x) j = i;
    if (j === last) return pts[last][1];
    const dx = pts[j + 1][0] - pts[j][0];
    if (dx <= 1e-9) return pts[j + 1][1];
    return pts[j][1] + (pts[j + 1][1] - pts[j][1]) * bendRef((x - pts[j][0]) / dx, 10 * pts[j][2]);
  };
  const r = rng(7);
  for (let rep = 0; rep < 50; rep++) {
    const n = 2 + Math.floor(r() * 12), pts = [[0, r(), r() * 2 - 1]];
    for (let i = 1; i < n - 1; i++) pts.push([r(), r(), r() * 2 - 1]);
    pts.push([1, r(), 0]);
    pts.sort((a, b) => a[0] - b[0]);
    if (rep % 5 === 0 && n > 3) pts[2][0] = pts[1][0];          // vertical step
    const pre = [[0, 0.5, 0], [1, 0.5, 0]];
    const P = Float64Array.from([...pre, ...pts].flat());
    for (let j = 0; j <= 200; j++) {
      const x = j / 200;
      assert.ok(Math.abs(S.evalPts(P, 2, n, x) - ref(pts, x)) < 1e-12, `rep ${rep} x ${x}`);
    }
    for (const p of pts) assert.ok(Math.abs(S.evalPts(P, 2, n, p[0]) - ref(pts, p[0])) < 1e-12, 'at a point x');
  }
  // equal-x pair: the later point wins
  const P = Float64Array.from([0, 0, 0, 0.5, 0.2, 0, 0.5, 0.9, 0, 1, 1, 0]);
  assert.equal(S.evalPts(P, 0, 4, 0.5), 0.9);
  assert.ok(Math.abs(S.evalPts(P, 0, 4, 0.25) - 0.1) < 1e-15);
  assert.equal(S.evalPts(P, 0, 4, -1), 0);
  assert.equal(S.evalPts(P, 0, 4, 2), 1);
});

/* ------------------------------------------------------------------ table store (§7.5, §10.4.13) */

test('storeWT validates entries, stores them and bumps epoch; storeWTFrame / dropWT', () => {
  const con = mkConsole();
  const { SerumDSP: S } = loadDSP(vm.createContext({ console: con }));
  let ep = S.epoch;
  assert.equal(S.storeWT('factory:Default', wtEntry(1)), true);
  assert.ok(S.epoch > ep); ep = S.epoch;
  assert.ok(S.tables.has('factory:Default'));
  assert.equal(S.storeWT('user:x', wtEntry(256)), true);
  assert.equal(S.storeWT('noise:White', noiseEntry(2, 3)), true);
  assert.equal(S.storeWT('nzuser:m', noiseEntry(1, 1)), true);
  ep = S.epoch;
  const bad = {
    'b:kind': Object.assign(wtEntry(1), { kind: 'xx' }),
    'b:nokind': (() => { const e = wtEntry(1); delete e.kind; return e; })(),
    'b:frames0': Object.assign(wtEntry(1), { frames: 0 }),
    'b:frames257': Object.assign(wtEntry(1), { frames: 257 }),
    'b:levels10': (() => { const e = wtEntry(1); e.levels.pop(); return e; })(),
    'b:datalen': (() => { const e = wtEntry(2); e.levels[4].data = new Float32Array(512 * 2 - 1); return e; })(),
    'b:f64': (() => { const e = wtEntry(1); e.levels[0].data = new Float64Array(2048); return e; })(),
    'b:len': (() => { const e = wtEntry(1); e.levels[3] = { len: 1000, harm: 128, data: new Float32Array(1000) }; return e; })(),
    'b:nzch': Object.assign(noiseEntry(1), { ch: 3 }),
    'b:nzR': (() => { const e = noiseEntry(2); e.levels[1].R = null; return e; })(),
    'b:nzlen': (() => { const e = noiseEntry(1); e.levels[0].L = new Float32Array(10); return e; })(),
    'b:nzloop': (() => { const e = noiseEntry(1); e.levels[0].loopEnd = 99999; return e; })(),
    'b:nzlev': (() => { const e = noiseEntry(1, 1); e.levels = []; return e; })(),
    'b:nzrate': Object.assign(noiseEntry(1), { rate: 0 }),
    'b:null': null,
  };
  for (const [id, e] of Object.entries(bad)) assert.equal(S.storeWT(id, e), false, id);
  assert.equal(S.storeWT('', wtEntry(1)), false);
  assert.equal(S.epoch, ep, 'invalid entries do not bump epoch');
  for (const id of Object.keys(bad)) assert.equal(S.tables.has(id), false);
  assert.equal(S.storeWT('b:kind', null), false);           // second failure for the same id: no second warning
  const warns = con.msgs.filter((m) => m.level === 'warn');
  assert.equal(warns.filter((m) => m.text.includes('b:kind')).length, 1, 'one warning per id');
  assert.equal(warns.length, Object.keys(bad).length + 1);
  // storeWTFrame copies one frame of every level in place
  const e = S.tables.get('user:x');
  const lv = MIP_LEN.map((len) => ({ len, data: new Float32Array(len).fill(0.25) }));
  ep = S.epoch;
  assert.equal(S.storeWTFrame('user:x', 7, lv), true);
  assert.ok(S.epoch > ep);
  for (let l = 0; l < 11; l++) {
    const len = MIP_LEN[l], d = e.levels[l].data;
    assert.equal(d[7 * len], 0.25); assert.equal(d[8 * len - 1], 0.25);
    assert.notEqual(d[6 * len + 1], 0.25); assert.notEqual(d[8 * len + 1], 0.25);
  }
  assert.equal(S.storeWTFrame('user:x', 256, lv), false);
  assert.equal(S.storeWTFrame('nope', 0, lv), false);
  assert.equal(S.storeWTFrame('noise:White', 0, lv), false);
  assert.equal(S.storeWTFrame('user:x', 0, lv.slice(0, 10)), false);
  // dropWT
  ep = S.epoch;
  S.dropWT('user:x');
  assert.equal(S.tables.has('user:x'), false);
  assert.ok(S.epoch > ep);
});

/* ------------------------------------------------------------------ SFilter / filterImpulse (§8.4.5, §10.4.9–10) */

test('MG Low 6/12/18/24: unity passband and −6/−12/−18/−24 dB/oct slopes (fs 96 kHz, res 0, drive 0)', () => {
  const { SerumDSP: S } = loadDSP();
  const fs = 96000;
  for (const fc of [250, 1000, 3000]) {
    for (let t = 0; t < 4; t++) {
      const h = S.filterImpulse(t, fc, 0, 0, 0, fs, 16384);
      const g8 = dB(mag(h, fc / 8, fs)), gfc = dB(mag(h, fc, fs));
      const slope = (dB(mag(h, 8 * fc, fs)) - dB(mag(h, 2 * fc, fs))) / 2;
      assert.ok(Math.abs(g8) <= 1.5, `type ${t} fc ${fc}: gain at fc/8 ${g8.toFixed(2)} dB`);
      assert.ok(Math.abs(slope + 6 * (t + 1)) <= 4, `type ${t} fc ${fc}: slope ${slope.toFixed(2)} dB/oct`);
      assert.ok(Math.abs(gfc + 3.01 * (t + 1)) < 0.1, `type ${t} fc ${fc}: −3 dB per stage at fc (${gfc.toFixed(2)})`);
    }
  }
});

test('MG Low 24 and 12 self-oscillate at fc (±5 %) at res 1 (fs 96 kHz)', () => {
  const { SerumDSP: S } = loadDSP();
  const fs = 96000;
  for (const [type, fc] of [[3, 500], [1, 500], [3, 2000]]) {
    const f = new S.SFilter(fs);
    f.setType(type); f.set(fc, fc, 1, 0, 0);
    const N = fs, y = new Float64Array(N);
    for (let i = 0; i < N; i++) { const x = i === 0 ? 0.01 : 0; f.tick(x, x); y[i] = f.yl; }
    let first = -1, last = -1, zc = 0, pk = 0;
    for (let i = N / 2; i < N; i++) {
      if (y[i - 1] < 0 && y[i] >= 0) { const p = i - 1 - y[i - 1] / (y[i] - y[i - 1]); if (first < 0) first = p; last = p; zc++; }
      pk = Math.max(pk, Math.abs(y[i]));
    }
    const freq = (zc - 1) * fs / (last - first);
    assert.ok(Math.abs(freq / fc - 1) < 0.05, `type ${type} fc ${fc}: oscillates at ${freq.toFixed(1)} Hz`);
    assert.ok(pk > 0.03 && pk < 2, `type ${type}: bounded, audible oscillation (peak ${pk.toFixed(3)})`);
  }
  // below the threshold (res 0.9) the ring dies out
  const h = S.filterImpulse(3, 500, 0.9, 0, 0, fs, 96000);
  let tail = 0;
  for (let i = 90000; i < 96000; i++) tail = Math.max(tail, Math.abs(h[i]));
  assert.ok(tail < 1e-3, 'res 0.9 decays');
});

test('SFilter drive law, FAT and resonance behaviour', () => {
  const { SerumDSP: S } = loadDSP();
  const fs = 96000;
  // drive: small-signal input gain 10^(16·√d/20)
  for (const d of [0.25, 1]) {
    const h = S.filterImpulse(1, 1000, 0, d, 0, fs, 8192);
    const gdc = dB(mag(h, 1, fs));
    assert.ok(Math.abs(gdc - 16 * Math.sqrt(d)) < 0.05, `drive ${d}: ${gdc.toFixed(3)} dB`);
  }
  // resonance raises the peak at fc
  const g = (res) => dB(mag(S.filterImpulse(3, 1000, res, 0, 0, fs, 65536), 1000, fs));
  assert.ok(g(0.8) > g(0.4) + 6 && g(0.4) > g(0) + 3, 'resonance boosts fc');
  // FAT tames resonance on a loud signal at fc
  const rms = (vr) => {
    const f = new S.SFilter(fs);
    f.setType(1); f.set(1000, 1000, 0.95, 0, vr);
    let s = 0;
    for (let i = 0; i < fs; i++) { const x = 0.5 * Math.sin(2 * Math.PI * 1000 * i / fs); f.tick(x, x); if (i >= fs / 2) s += f.yl * f.yl; }
    return Math.sqrt(s / (fs / 2));
  };
  assert.ok(rms(1) < rms(0) * 0.9, `FAT lowers the resonant level (${rms(1).toFixed(3)} vs ${rms(0).toFixed(3)})`);
  // the stage saturation keeps a hot input bounded
  const f = new S.SFilter(fs);
  f.setType(3); f.set(2000, 2000, 1, 1, 0);
  let pk = 0;
  for (let i = 0; i < fs; i++) { const x = Math.sin(2 * Math.PI * 110 * i / fs) > 0 ? 1 : -1; f.tick(x, x); pk = Math.max(pk, Math.abs(f.yl)); }
  assert.ok(Number.isFinite(pk) && pk < 4, 'peak ' + pk);
});

test('SFilter API semantics: stereo, tick ≡ process, ranges, reset, setType, setRate, clamping', () => {
  const { SerumDSP: S } = loadDSP();
  const r = rng(3), n = 512;
  const noise = Float64Array.from({ length: n }, () => r() * 2 - 1);
  // stereo cutoffs are independent; identical cutoffs give identical channels
  const a = new S.SFilter(48000);
  a.set(500, 4000, 0.3, 0, 0);
  const L = noise.slice(), R = noise.slice();
  a.process(L, R, 0, n);
  assert.notDeepEqual(L, R);
  const b = new S.SFilter(48000);
  b.set(700, 700, 0.3, 0.2, 0.5);
  const L2 = noise.slice(), R2 = noise.slice();
  b.process(L2, R2, 0, n);
  assert.deepEqual(L2, R2);
  // tick ≡ process
  const c = new S.SFilter(48000);
  c.set(700, 700, 0.3, 0.2, 0.5);
  for (let i = 0; i < n; i++) { c.tick(noise[i], noise[i]); assert.equal(c.yl, L2[i]); assert.equal(c.yr, R2[i]); }
  // process touches only [off, off + n)
  const d = new S.SFilter(48000);
  const L3 = noise.slice(), R3 = noise.slice();
  d.process(L3, R3, 100, 50);
  for (let i = 0; i < n; i++) if (i < 100 || i >= 150) { assert.equal(L3[i], noise[i]); assert.equal(R3[i], noise[i]); }
  assert.notEqual(L3[120], noise[120]);
  // reset → silence in, silence out
  d.reset();
  const Z = new Float64Array(64), Z2 = new Float64Array(64);
  d.process(Z, Z2, 0, 64);
  assert.ok(Z.every((v) => v === 0) && Z2.every((v) => v === 0));
  // same family keeps state; switching family resets it
  const e = new S.SFilter(48000);
  e.setType(1); e.set(300, 300, 0.5, 0, 0);
  for (let i = 0; i < 200; i++) e.tick(1, 1);
  e.setType(3);
  e.tick(0, 0);
  assert.notEqual(e.yl, 0, 'MG Low 12 → 24 keeps the ladder state');
  e.setType(5); e.setType(3);
  e.tick(0, 0);
  assert.equal(e.yl, 0, 'ladder → svf → ladder starts from a cleared state');
  // setType clamps and rounds
  e.setType(200); assert.equal(e.type, 107);                 // SPEC-serum2 §11.10: SFilter covers types 0–107
  e.setType(-3); assert.equal(e.type, 0);
  e.setType(1.4); assert.equal(e.type, 1);
  // setRate keeps the cutoff in Hz
  const f = new S.SFilter(48000);
  f.setType(1); f.set(1000, 1000, 0, 0, 0);
  f.setRate(96000); f.reset();
  const h = new Float64Array(8192);
  for (let i = 0; i < h.length; i++) { const x = i ? 0 : 1e-2; f.tick(x, x); h[i] = f.yl / 1e-2; }
  assert.ok(Math.abs(dB(mag(h, 1000, 96000)) + 6.02) < 0.05, 'MG Low 12 is −6 dB at fc after setRate');
  // cutoff clamped to [8, 0.45·fs]; NaN arguments are sanitised
  const imp = (fc, res = 0) => S.filterImpulse(1, fc, res, 0, 0, 48000, 256);
  assert.deepEqual(imp(1e6), imp(0.45 * 48000));
  assert.deepEqual(imp(0), imp(8));
  assert.deepEqual(imp(NaN), imp(8));
  assert.ok(S.filterImpulse(1, 1000, NaN, NaN, NaN, 48000, 256).every(Number.isFinite));
});

test('every one of the 96 types survives 1 s of noise at drive 1, res 1 with random var/cutoff jumps', () => {
  const { SerumDSP: S } = loadDSP();
  const fs = 48000, B = 64;
  const L = new Float64Array(B), R = new Float64Array(B);
  for (let t = 0; t < 96; t++) {
    const r = rng(100 + t), f = new S.SFilter(fs);
    f.prealloc(true);
    f.setType(t);
    let pk = 0;
    for (let b = 0; b < fs / B; b++) {
      const fc = 8 * Math.pow(22050 / 8, r());
      f.set(fc, fc * (0.5 + r()), 1, 1, r());
      for (let i = 0; i < B; i++) { L[i] = r() * 2 - 1; R[i] = r() * 2 - 1; }
      f.process(L, R, 0, B);
      for (let i = 0; i < B; i++) {
        assert.ok(Number.isFinite(L[i]) && Number.isFinite(R[i]), `type ${t}: finite`);
        pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
      }
    }
    assert.ok(pk < 16, `type ${t}: |y| < 16 (peak ${pk.toFixed(2)})`);
    f.reset();
    L.fill(0); R.fill(0);
    f.process(L, R, 0, B);
    assert.ok(L.every((v) => v === 0), `type ${t}: reset clears the state`);
  }
});

test('filterImpulse: shape, determinism, DC gain', () => {
  const { SerumDSP: S } = loadDSP();
  const h = S.filterImpulse(1, 1000, 0, 0, 0, 48000);
  assert.equal(h[Symbol.toStringTag], 'Float64Array');
  assert.equal(h.length, 4096);
  assert.equal(S.filterImpulse(1, 1000, 0, 0, 0, 48000, 100).length, 100);
  assert.deepEqual(S.filterImpulse(3, 777, 0.7, 0.3, 0.2, 44100), S.filterImpulse(3, 777, 0.7, 0.3, 0.2, 44100));
  let dc = 0;
  for (const v of h) dc += v;
  assert.ok(Math.abs(dc - 1) < 1e-3, 'DC gain 1 at res 0: ' + dc);
  assert.ok(Math.abs(h[0] - S.filterImpulse(1, 1000, 0, 0, 0, 48000, 1)[0]) === 0);
});

test('SFilter hot paths do not allocate (§10.1)', () => {
  const { ctx, SerumDSP: S } = loadDSP();
  const f = new S.SFilter(96000);
  f.prealloc(true);
  f.setType(1);
  f.set(500, 600, 0.7, 0.4, 0.3);
  const L = new Float64Array(256).map((_, i) => Math.sin(i)), R = L.slice();
  f.process(L, R, 0, 256);
  const names = ['Float64Array', 'Float32Array', 'Uint8Array', 'Uint16Array', 'Int8Array', 'Int16Array', 'Int32Array',
    'Array', 'Map', 'Object'];
  const saved = {};
  for (const k of names) { saved[k] = ctx[k]; ctx[k] = function () { throw new Error('allocation: ' + k); }; }
  try {
    for (let b = 0; b < 50; b++) {
      f.set(200 + 100 * b, 300 + 90 * b, (b % 10) / 10, (b % 7) / 7, (b % 3) / 3);
      f.process(L, R, 0, 256);
      f.tick(0.1, -0.1);
      f.setType(b % 4);
    }
    f.setType(40); f.setType(2);
    f.reset();
    f.process(L, R, 0, 256);
  } finally {
    for (const k of names) ctx[k] = saved[k];
  }
  assert.ok(L.every(Number.isFinite));
});

test('SFilter cost (informative): 8 stereo MG Low 24 voices, 1 s at 96 kHz', () => {
  const { SerumDSP: S } = loadDSP();
  const fs = 96000, B = 256, fl = [];
  for (let v = 0; v < 8; v++) { const f = new S.SFilter(fs); f.setType(3); f.set(800, 900, 0.5, 0.2, 0.3); fl.push(f); }
  const L = new Float64Array(B), R = new Float64Array(B);
  const run = () => { for (let b = 0; b < fs / B; b++) for (const f of fl) { for (let i = 0; i < B; i++) { L[i] = Math.sin(i * 0.1); R[i] = L[i]; } f.set(800 + b, 900, 0.5, 0.2, 0.3); f.process(L, R, 0, B); } };
  run();
  const t0 = performance.now();
  run();
  const ms = performance.now() - t0;
  console.log(`  SFilter MG Low 24: 8 stereo voices × 1 s @ 96 kHz = ${ms.toFixed(1)} ms`);
  assert.ok(ms < 1000);
});


/* ================================================================== M2: voices, modulation, filters, hooks (§10.4) */

// ---- fixtures and builders (tests import only the DSP scripts and tests/fixtures/*) ----
const DESTS = DESTS_FX.DESTS;                             // the v1 table (idx 0–247): for its synth rows idx = vi (§3.11.1)
const DI = {};
DESTS.forEach((d, i) => { DI[d.id] = i; });
const SRC_IDS = ['', 'wheel', 'env1', 'env2', 'env3', 'lfo1', 'lfo2', 'lfo3', 'lfo4', 'lfo5', 'lfo6', 'lfo7', 'lfo8', 'velo',
  'note', 'at', 'pat', 'chaos1', 'chaos2', 'noise', 'rand1', 'rand2', 'alt1', 'alt2', 'macro1', 'macro2', 'macro3',
  'macro4', 'bend', 'mpex', 'mpey', 'mpez', 'relvel', 'fixed'];   // the Phase-1 sources (indices unchanged in v2, §3.10)
const SI = {};
SRC_IDS.forEach((id, i) => { if (id) SI[id] = i; });
const CTX_OF = { V: 1, 'V*': 1, 'V*M': 3, G: 2, M: 4 };
const ON_DESTS = ['a.uni', 'b.uni', 'a.phase', 'b.phase', 'a.rand', 'b.rand', 'n.phase', 'n.rand'];
const BI_SRC = new Set(['chaos1', 'chaos2', 'noise', 'bend', 'mpex']);
const NSV = 429, NSRC2 = 62, MAXFX = 8 + 48 * 24, N_LFO = 10;
// FX-context index (§4.2) of a v1 FX destination in the stand-in layout of these tests: g.master 0, g.bypass 1, the v1
// FX parameter rows in their v1 order from index 8 (row idx 149 + j → 8 + j)
const fxk = (id) => (id === 'g.master' ? 0 : id === 'g.bypass' ? 1 : 8 + DI[id] - 149);

// matrix row in CP v2 layout (§4.1): rows = [{src, dst, amt, bi, curve, aux, inv, out}]; mDst = vi or −1 − FX-ctx index
function addRow(cp, { src, dst, amt = 1, bi = 0, curve = 0, aux = '', inv = 0, out = 1 }) {
  const r = cp.mN++, si = SI[src], di = DI[dst], ai = aux ? SI[aux] : 0, fx = di >= 148;
  assert.ok(si && di !== undefined && ai !== undefined, 'row ' + src + ' → ' + dst);
  cp.mSrc[r] = si; cp.mDst[r] = fx ? -1 - fxk(dst) : di; cp.mAmt[r] = amt * out; cp.mBi[r] = bi; cp.mK[r] = 6 * curve;
  cp.mCrv[r] = -1; cp.mAK[r] = 0; cp.mRise[r] = 0; cp.mFall[r] = 0; cp.mRd[r] = 0;   // CP v2 row fields at their v1 values
  cp.mAux[r] = ai; cp.mInv[r] = inv; cp.mCtx[r] = fx ? 4 : CTX_OF[DESTS[di].scope]; cp.mOn[r] = ON_DESTS.includes(dst) ? 1 : 0;
  cp.srcUsed[si] = 1;
  if (ai) cp.srcUsed[ai] = 1;
  if (!fx && (cp.mCtx[r] & 1)) cp.modded[di] = 1;
}
// the CP v2 a migrated v1 state compiles to (§2.6.2, §4.1), from a CP v1: its values in the v2 shapes, S1 mode
const CP1 = loadFixture('cp-default.json');
function cpV2(c1 = CP1) {
  const c = loadFixture('cp2-default.json');
  c.base.set(c1.base.subarray(0, 148));
  c.wt = [c1.wt[0], c1.wt[1], c.wt[2]];
  c.uniMode.set(c1.uniMode.subarray(0, 2)); c.uniRange.set(c1.uniRange.subarray(0, 2)); c.memSet.set(c1.memSet.subarray(0, 32));
  c.route.set([0, 0, 1, c1.noiseDirect ? 2 : 0, c1.subDirect ? 2 : 0, 1, 1]);
  c.fKey[0] = c1.filKey ? 1 : 0; c.outMask = c1.direct ? 3 : 1;
  c.noiseOneshot = c1.noiseOneshot; c.noiseKey = c1.noiseKey; c.noiseId = c1.noiseId; c.noiseColor = -1;
  c.lfoMode.fill(2); c.lfoMode.set(c1.lfoMode); c.lfoBpm.set(c1.lfoBpm); c.lfoAnchor.set(c1.lfoAnchor);
  for (let l = 0; l < N_LFO; l++) c.lfoMono[l] = c.lfoMode[l] === 2 ? 1 : 0;   // migration: v1 'off' = FREE + MONO (§2.6.2)
  c.lfoLad.set(c1.lfoLad); c.lfoLadN.set(c1.lfoLadN);
  c.chaosMono.set(c1.chaosMono); c.chaosSh.set(c1.chaosSh); c.macro.fill(0); c.macro.set(c1.macro);
  for (const k of ['mono', 'legato', 'poly', 'always', 'scaled', 'oneNote', 'veloPorta', 'notePorta', 'os', 'a4', 'smooth']) c[k] = c1[k];
  c.s1 = 1; c.ctKey = c1.ctKey;
  return c;
}
// extra CP fields; the Phase-1 names map onto CP v2 (subDirect / noiseDirect → route, direct → outMask, filKey → fKey)
function setExtra(cp, extra) {
  for (const [k, v] of Object.entries(extra)) {
    if (k === 'subDirect') cp.route[4] = v ? 2 : 0;
    else if (k === 'noiseDirect') cp.route[3] = v ? 2 : 0;
    else if (k === 'direct') cp.outMask = v ? 3 : 1;
    else if (k === 'filKey') cp.fKey[0] = v ? 1 : 0;
    else if (k === 'wt') cp.wt = [v[0], v[1], v.length > 2 ? v[2] : cp.wt[2]];
    else if (ArrayBuffer.isView(v) && ArrayBuffer.isView(cp[k]) && v.length < cp[k].length) cp[k].set(v);
    else cp[k] = v;
  }
  return cp;
}
// CP = compiled default with base values p {id: n}, matrix rows and extra CP fields
function mkCP(p = {}, rows = [], extra = {}) {
  const cp = cpV2();
  for (const [id, n] of Object.entries(p)) { assert.ok(DI[id] < 148, id); cp.base[DI[id]] = n; }
  for (const r of rows) addRow(cp, r);
  return setExtra(cp, extra);
}
const grid = (id, v) => { const d = DESTS[DI[id]]; return (v - d.lo) / (d.hi - d.lo); };   // stepped-law n
// §4.4 reference curves
const bendRef = (t, k) => (Math.abs(k) < 1e-4 ? t : (1 - Math.exp(-k * t)) / (1 - Math.exp(-k)));
function evalPtsRef(pts, x) {
  if (x <= 0) return pts[0][1];
  const last = pts.length - 1;
  if (x >= 1) return pts[last][1];
  let j = 0;
  for (let i = 0; i <= last; i++) if (pts[i][0] <= x) j = i;
  if (j === last) return pts[last][1];
  const dx = pts[j + 1][0] - pts[j][0];
  if (dx <= 1e-9) return pts[j + 1][1];
  return pts[j][1] + (pts[j + 1][1] - pts[j][1]) * bendRef((x - pts[j][0]) / dx, 10 * (pts[j][2] || 0));
}
// CT = default full CT v2 (fixture) with LFO graphs replaced: lfos = {l: {pts: [[x, y, c, mx?, my?]], start?, loop?}}
let ctSeq = 0;
function mkCT(lfos = {}, cp = null) {
  const ct = loadFixture('ct2-default.json');
  const graphs = [];
  for (let l = 0; l < N_LFO; l++) {
    const o = ct.lfoPtsOff[l], n = ct.lfoPtsOff[l + 1] - o, pts = [];
    for (let j = 0; j < n; j++) pts.push([ct.lfoPts[3 * (o + j)], ct.lfoPts[3 * (o + j) + 1], ct.lfoPts[3 * (o + j) + 2], 0, 0]);
    graphs.push(lfos[l] ? { start: 0, loop: -1, ...lfos[l] } : { pts, start: 0, loop: -1 });
  }
  const tot = graphs.reduce((a, g) => a + g.pts.length, 0);
  ct.lfoPts = new Float64Array(3 * tot); ct.lfoPm = new Uint8Array(2 * tot); ct.lfoPtsOff = new Uint16Array(N_LFO + 1);
  ct.lfoPmAny = new Uint8Array(N_LFO); ct.lfoStart = new Float64Array(N_LFO); ct.lfoLoop = new Float64Array(N_LFO);
  let o = 0;
  graphs.forEach((g, l) => {
    ct.lfoPtsOff[l] = o;
    g.pts.forEach((p, j) => {
      ct.lfoPts.set([p[0], p[1], p[2] || 0], 3 * (o + j));
      ct.lfoPm[2 * (o + j)] = p[3] || 0; ct.lfoPm[2 * (o + j) + 1] = p[4] || 0;
      if (p[3] || p[4]) ct.lfoPmAny[l] = 1;
    });
    for (let j = 0; j <= 1024; j++) ct.lfoTab[l * 1025 + j] = evalPtsRef(g.pts, j / 1024);
    ct.lfoStart[l] = g.pts[g.start][0];
    ct.lfoLoop[l] = g.loop >= 0 ? g.pts[g.loop][0] : -1;
    o += g.pts.length;
  });
  ct.lfoPtsOff[N_LFO] = o;
  ct.key = 'test' + (++ctSeq);
  if (cp) cp.ctKey = ct.key;
  return ct;
}
// an FXP whose base is in FX-context order (§4.2) in the stand-in layout of fxk, from the v1 FXP fixture
function fxpV2(f1) {
  const base = new Float64Array(8 + 99);
  base[0] = f1.base[0]; base[1] = f1.base[86];
  for (let j = 1; j < 100; j++) base[8 + j - 1] = f1.base[j];
  return Object.assign({}, f1, { base });
}
// a full CT v2 as CT v2 parts (§4.1 serumT = {key, parts}); part keys = name + '#' + the CT key unless keyOf says otherwise
function ctParts(ct, keyOf = (name) => name + '#' + ct.key) {
  const parts = {}, L = 1025;
  for (let l = 0; l < N_LFO; l++) {
    const o = ct.lfoPtsOff[l], n = ct.lfoPtsOff[l + 1] - o;
    parts['lfo' + l] = { key: keyOf('lfo' + l), n, tab: ct.lfoTab.slice(l * L, (l + 1) * L), pts: ct.lfoPts.slice(3 * o, 3 * (o + n)),
      pm: ct.lfoPm.slice(2 * o, 2 * (o + n)), pmAny: ct.lfoPmAny[l], start: ct.lfoStart[l], loop: ct.lfoLoop[l] };
    parts['path' + l] = { key: keyOf('path' + l), x: ct.pathX.slice(l * L, (l + 1) * L), y: ct.pathY.slice(l * L, (l + 1) * L) };
  }
  for (let o = 0; o < 3; o++) {
    parts['remap' + o] = { key: keyOf('remap' + o), tab: ct.remap.slice(o * 2049, (o + 1) * 2049) };
    parts['spec' + o] = { key: keyOf('spec' + o), tab: ct.specFilt.slice(o * 513, (o + 1) * 513) };
  }
  parts.velo = { key: keyOf('velo'), tab: ct.veloTab.slice() };
  parts.note = { key: keyOf('note'), tab: ct.noteTab.slice() };
  for (let r = 0; r < 64; r++) parts['crv' + r] = { key: keyOf('crv' + r), tab: ct.crv.slice(r * 129, (r + 1) * 129) };
  return { key: ct.key, parts };
}

// ---- FFT and wavetable entries (§7.3 mip levels) ----
function fft(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
// entry from time-domain frames (Float64Array 2048 each): level ℓ keeps bins 0…harm (§7.3)
function entryFromFrames(frames, interp = frames.length > 1 ? 1 : 0) {
  const F = frames.length;
  const specs = frames.map((fr) => { const re = Float64Array.from(fr), im = new Float64Array(2048); fft(re, im, false); return [re, im]; });
  const levels = MIP_LEN.map((len, l) => {
    const H = MIP_HARM[l], data = new Float32Array(F * len);
    specs.forEach(([re, im], f) => {
      const r = new Float64Array(len), i = new Float64Array(len), sc = len / 2048;
      r[0] = re[0] * sc;
      for (let k = 1; k <= H && k < len / 2 && k < 1024; k++) {
        r[k] = re[k] * sc; i[k] = im[k] * sc; r[len - k] = re[k] * sc; i[len - k] = -im[k] * sc;
      }
      fft(r, i, true);
      for (let j = 0; j < len; j++) data[f * len + j] = r[j];
    });
    return { len, harm: H, data };
  });
  return { kind: 'wt', v: 1, frames: F, interp, morph: interp, levels };
}
const frame = (fn) => Float64Array.from({ length: 2048 }, (_, j) => fn(j / 2048));
function sawFrame() {                                     // factory:Default recipe: Σ (2/πk)·sin(2πkφ), k ≤ 1023
  const re = new Float64Array(2048), im = new Float64Array(2048);
  for (let k = 1; k <= 1023; k++) { const a = 2 / (Math.PI * k); im[k] = -a * 1024; im[2048 - k] = a * 1024; }
  fft(re, im, true);
  return re;
}
const SAW = entryFromFrames([sawFrame()]);
const SINE = entryFromFrames([frame((p) => Math.sin(2 * Math.PI * p))]);
const ZEROT = entryFromFrames([new Float64Array(2048)]);
function oddFrame() {                                    // factory:Square recipe: odd harmonics (4/π)/k
  const re = new Float64Array(2048), im = new Float64Array(2048);
  for (let k = 1; k <= 1023; k += 2) { const a = 4 / (Math.PI * k); im[k] = -a * 1024; im[2048 - k] = a * 1024; }
  fft(re, im, true);
  return re;
}
const SQUARE = entryFromFrames([oddFrame()]);
const SUBS = { 'sub:Sine': entryFromFrames([frame((p) => -Math.sin(2 * Math.PI * p))]),
  'sub:RoundRect': entryFromFrames([frame((p) => -Math.tanh(4 * Math.sin(2 * Math.PI * p)) / Math.tanh(4))]),
  'sub:Saw': entryFromFrames([frame((p) => 1 - 2 * ((p + 0.5) % 1))]),
  'sub:Square': entryFromFrames([frame((p) => (p < 0.5 ? -1 : 1))]),
  'sub:Pulse': entryFromFrames([frame((p) => (p < 0.25 ? -1 : 1 / 3))]) };
// noise entry from a sample (Float32 L/R), levels by halving (simple 2-tap average, test content only)
function noiseFrom(L, R, { rate = 48000, root = 60, loop = true, nLev = 3 } = {}) {
  const levels = [];
  let a = L, b = R;
  for (let l = 0; l < nLev && a.length >= 64; l++) {
    levels.push({ len: a.length, loopStart: 0, loopEnd: a.length, L: a, R: b });
    const h = a.length >> 1, a2 = new Float32Array(h), b2 = b ? new Float32Array(h) : null;
    for (let j = 0; j < h; j++) { a2[j] = 0.5 * (a[2 * j] + a[2 * j + 1]); if (b) b2[j] = 0.5 * (b[2 * j] + b[2 * j + 1]); }
    a = a2; b = b2;
  }
  return { kind: 'noise', v: 1, rate, ch: R ? 2 : 1, root, len: L.length, loopStart: 0, loopEnd: L.length, levels, oneshot: !loop };
}
// one-cycle loop (frameToNoise, §7.9): len 2048, rate 2048·261.6256, levels = exact FFT band limits, decimated by 2^ℓ
function cycleNoise(fr) {
  const re0 = Float64Array.from(fr), im0 = new Float64Array(2048);
  fft(re0, im0, false);
  const levels = [];
  for (let l = 0, len = 2048; l < 6; l++, len >>= 1) {
    const r = new Float64Array(len), i = new Float64Array(len), sc = len / 2048;
    r[0] = re0[0] * sc;
    for (let k = 1; k < len / 2; k++) { r[k] = re0[k] * sc; i[k] = im0[k] * sc; r[len - k] = re0[k] * sc; i[len - k] = -im0[k] * sc; }
    fft(r, i, true);
    levels.push({ len, loopStart: 0, loopEnd: len, L: Float32Array.from(r), R: null });
  }
  return { kind: 'noise', v: 1, rate: 2048 * 261.6256, ch: 1, root: 60, len: 2048, loopStart: 0, loopEnd: 2048, levels };
}

// ---- processors and rendering ----
function setup({ base = 48000, OS = 2, cp = mkCP(), ct = null, n = 1, fxp = null, tables = { 'factory:Default': SAW }, ctx } = {}) {
  const { SerumDSP: S, ctx: c } = loadDSP(ctx);
  for (const [id, e] of Object.entries(tables)) assert.equal(S.storeWT(id, e), true, id);
  const proc = makeProc(base, OS);
  proc.p = { serum: cp, fxr: fxp };
  proc.ct = ct;
  const vs = [];
  for (let i = 0; i < n; i++) vs.push(new S.SerumVoice(proc, i));
  proc.voices = vs;
  for (const v of vs) v.apply(proc.p);
  return { S, proc, vs, ctx: c, D: S.DIDX };
}
const spansOf = (sec, base = 48000) => Math.ceil(sec * base / 128);
// render `spans` spans of 128 base frames (OS-rate output); each(s) runs before span s
function run(S, proc, vs, spans, { each, dir = false } = {}) {
  const N = 128 * proc.OS;
  const L = new Float64Array(spans * N), R = new Float64Array(spans * N), DL = new Float64Array(spans * N), DR = new Float64Array(spans * N);
  const bl = new Float64Array(N), br = new Float64Array(N), dl = new Float64Array(N), dr = new Float64Array(N);
  for (let s = 0; s < spans; s++) {
    if (each) each(s);
    bl.fill(0); br.fill(0); dl.fill(0); dr.fill(0);
    S.begin(proc, N);
    for (const v of vs) if (v.active) v.render(bl, br, N, dir ? dl : undefined, dir ? dr : undefined);
    S.fxMods(proc);
    L.set(bl, s * N); R.set(br, s * N); DL.set(dl, s * N); DR.set(dr, s * N);
  }
  return { L, R, DL, DR, N };
}
const maxAbs = (x, a = 0, b = x.length) => { let m = 0; for (let i = a; i < b; i++) m = Math.max(m, Math.abs(x[i])); return m; };
const maxStep = (x, a = 1, b = x.length) => { let m = 0; for (let i = Math.max(1, a); i < b; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m; };
// frequency of the strongest component in [lo, hi] Hz: Blackman-Harris windowed DTFT, coarse scan + golden section
function bh(N) {
  const w = new Float64Array(N);
  for (let n = 0; n < N; n++) { const a = 2 * Math.PI * n / (N - 1); w[n] = 0.35875 - 0.48829 * Math.cos(a) + 0.14128 * Math.cos(2 * a) - 0.01168 * Math.cos(3 * a); }
  return w;
}
function dtft(x, w, f, fs) {
  const d = 2 * Math.PI * f / fs, cd = Math.cos(d), sd = Math.sin(d);
  let re = 0, im = 0, c = 1, s = 0;
  for (let n = 0; n < x.length; n++) { const v = x[n] * w[n]; re += v * c; im -= v * s; const t = c * cd - s * sd; s = s * cd + c * sd; c = t; }
  return Math.hypot(re, im);
}
function peakFreq(x, fs, lo, hi) {
  const w = bh(x.length), step = fs / x.length / 4;
  let best = lo, bm = -1;
  for (let f = lo; f <= hi; f += step) { const m = dtft(x, w, f, fs); if (m > bm) { bm = m; best = f; } }
  let a = best - step, b = best + step;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let it = 0; it < 60; it++) {
    const c = b - g * (b - a), d = a + g * (b - a);
    if (dtft(x, w, c, fs) > dtft(x, w, d, fs)) b = d; else a = c;
  }
  return (a + b) / 2;
}
// frequency from upward zero crossings (pure tones)
function zcFreq(x, fs, a = 0, b = x.length) {
  let first = -1, last = -1, n = 0;
  for (let i = Math.max(1, a); i < b; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) { const p = i - 1 - x[i - 1] / (x[i] - x[i - 1]); if (first < 0) first = p; last = p; n++; }
  }
  return (n - 1) * fs / (last - first);
}
// magnitude spectrum (dB) of N samples from off, Blackman-Harris window
function specDb(x, off, N) {
  const w = bh(N), re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = x[off + i] * w[i];
  fft(re, im, false);
  const db = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) db[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) + 1e-300);
  return db;
}
// §10.1 alias measure: largest bin below min(20 kHz, 0.45·base) farther than 10 bins from every harmonic of f0, in dBc
function aliasDbc(x, off, fs, base, f0, N = 65536) {
  const db = specDb(x, off, N), bin = fs / N, k0 = Math.round(f0 / bin);
  let fund = -Infinity;
  for (let k = k0 - 3; k <= k0 + 3; k++) fund = Math.max(fund, db[k]);
  const top = Math.min(20000, 0.45 * base) / bin;
  let worst = -Infinity, at = 0;
  for (let k = 11; k < top; k++) {
    const h = Math.round(k * bin / f0);
    if (Math.abs(k - h * f0 / bin) <= 10) continue;
    if (db[k] > worst) { worst = db[k]; at = k * bin; }
  }
  return { dbc: worst - fund, at };
}

/* ------------------------------------------------------------------ basic voice (§10.4.2, 3, 5) */

test('default CP + saw table: 440 Hz at note 69, level 0.5625 × table peak, release to −60 dB < 50 ms, then inactive', () => {
  const { S, proc, vs: [v] } = setup();
  v.noteOn(69, 1, false, 1);
  assert.equal(v.active, true);
  const { L, R } = run(S, proc, [v], 30);                   // 80 ms
  const fs = proc.fs, N = 4096 * 4;
  const f = peakFreq(L.subarray(L.length - N), fs, 400, 480);
  assert.ok(Math.abs(f - 440) <= 0.05, 'pitch ' + f);
  const pk = maxAbs(L, L.length / 2), tpk = maxAbs(SAW.levels[0].data);
  const err = 20 * Math.log10(pk / (0.5625 * tpk));
  assert.ok(Math.abs(err) <= 0.5, `level error ${err.toFixed(3)} dB`);
  assert.deepEqual(Array.from(L), Array.from(R), 'centre pan: L = R');
  v.noteOff();
  const t = run(S, proc, [v], 30);
  let last = 0;
  for (let i = 0; i < t.L.length; i++) if (Math.abs(t.L[i]) > pk * 1e-3) last = i;
  assert.ok(last / fs < 0.05, `−60 dB after ${(1000 * last / fs).toFixed(1)} ms`);
  assert.equal(v.active, false, 'inactive after the release');
  assert.equal(v.gate, false);
});

test('aliasing: saw, unison 1, no warp, at 110…4186 Hz (and 55–74 Hz at OS 2), base 48 kHz OS 1 and OS 2: ≤ −70 dBc (§10.4.3)', () => {
  for (const OS of [1, 2]) {
    for (const note of OS === 2 ? [33, 36.85, 38, 45, 69, 84, 96, 108] : [45, 69, 84, 96, 108]) {
      const { S, proc, vs: [v] } = setup({ OS, cp: mkCP({ 'a.rand': 0 }) });
      v.noteOn(note, 1, false, 1);
      const N = 65536, spans = Math.ceil((N + proc.fs * 0.02) / (128 * OS));
      const { L } = run(S, proc, [v], spans);
      const f0 = 440 * Math.pow(2, (note - 69) / 12);
      const { dbc, at } = aliasDbc(L, L.length - N, proc.fs, 48000, f0, N);
      assert.ok(dbc <= -70, `OS ${OS} f0 ${f0.toFixed(1)}: alias ${dbc.toFixed(1)} dBc at ${at.toFixed(0)} Hz`);
    }
  }
});

test('pitch maths: semi, coarse, bend with bend range, pitch tracking off, sub octave (§10.4.5)', () => {
  const tbl = { 'factory:Default': SINE, ...SUBS };
  const measure = (p, note, opts = {}) => {
    const cp = mkCP(p);
    const { S, proc, vs: [v] } = setup({ cp, tables: tbl, base: 48000, OS: 2 });
    Object.assign(proc, opts.proc || {});
    v.noteOn(note, 1, false, 1);
    const { L } = run(S, proc, [v], spansOf(opts.sec || 0.6));
    return zcFreq(L, proc.fs, Math.round(proc.fs * 0.1));
  };
  const cents = (a, b) => 1200 * Math.log2(a / b);
  const f0 = measure({}, 60);
  assert.ok(Math.abs(cents(f0, 440 * Math.pow(2, -9 / 12))) < 0.02, 'note 60 ' + f0);
  const f1 = measure({ 'a.semi': 13 / 24 }, 60);
  assert.ok(Math.abs(cents(f1, f0) - 100) <= 0.02, `semi +1: ${cents(f1, f0)} ct`);
  const f2 = measure({ 'a.crs': 1 }, 30);
  assert.ok(Math.abs(cents(f2, 440 * Math.pow(2, (30 - 69) / 12)) - 6400) <= 0.05, `crs +64: ${cents(f2, 440 * Math.pow(2, -39 / 12))}`);
  const f3 = measure({}, 60, { proc: { bendRaw: 1 } });
  assert.ok(Math.abs(cents(f3, f0) - 200) <= 0.05, `bend +1 × 2 st: ${cents(f3, f0)} ct`);
  const f4 = measure({ 'g.bendup': grid('g.bendup', 7) }, 60, { proc: { bendRaw: 1 } });
  assert.ok(Math.abs(cents(f4, f0) - 700) <= 0.05, 'bend up 7');
  const f5 = measure({}, 60, { proc: { bendRaw: -1 } });
  assert.ok(Math.abs(cents(f5, f0) + 200) <= 0.05, 'bend −1 × bend down −2');
  for (const note of [40, 77]) {
    const f = measure({ 'a.track': 0 }, note, { sec: 3 });
    assert.ok(Math.abs(cents(f, 440 * Math.pow(2, -69 / 12))) < 0.5, `tracking off at note ${note}: ${f} Hz`);
  }
  // sub (sine) alone, octave −1
  const sub0 = measure({ 'a.on': 0, 's.on': 1 }, 60), sub1 = measure({ 'a.on': 0, 's.on': 1, 's.oct': grid('s.oct', -1) }, 60);
  assert.ok(Math.abs(cents(sub0, f0)) < 0.05, 'sub tracks the note');
  assert.ok(Math.abs(cents(sub1, sub0) + 1200) < 0.05, 'sub one octave down');
  // master tune (matrix-only g.tune, base n) and A4
  const f6 = measure({ 'g.tune': grid('g.tune', 12) }, 60);
  assert.ok(Math.abs(cents(f6, f0) - 1200) < 0.05, 'g.tune +12');
  const { S, proc, vs: [v] } = setup({ cp: mkCP({}, [], { a4: 432 }), tables: tbl });
  v.noteOn(69, 1, false, 1);
  const { L } = run(S, proc, [v], spansOf(0.6));
  assert.ok(Math.abs(cents(zcFreq(L, proc.fs, 9600), 432)) < 0.05, 'A4 = 432');
});

test('unison: N 7, detune 1, range 2 → outer voices ±100 ct; Exp mode pulls inner voices in; width 0 → L = R (§10.4.4)', () => {
  const cp = mkCP({ 'a.uni': grid('a.uni', 7), 'a.det': 1, 'a.rand': 1 });
  const { S, proc, vs: [v] } = setup({ cp, tables: { 'factory:Default': SINE }, OS: 1 });
  v.noteOn(69, 1, false, 1);
  const N = 1 << 17;
  const { L, R } = run(S, proc, [v], Math.ceil((N + 4800) / 128));
  const x = L.subarray(L.length - N).map((a, i) => a + R[R.length - N + i]);
  const lo = peakFreq(x, proc.fs, 405, 419), hi = peakFreq(x, proc.fs, 462, 475);
  const cl = 1200 * Math.log2(lo / 440), ch = 1200 * Math.log2(hi / 440);
  assert.ok(Math.abs(cl + 100) <= 2 && Math.abs(ch - 100) <= 2, `outer voices at ${cl.toFixed(2)} / ${ch.toFixed(2)} ct`);
  assert.equal(v.uN[0], 7);
  // detune slot ratios: Linear t vs Exp |t|^2.5 (white box: per-unison pitch ratios)
  const ratios = (mode) => {
    const c = mkCP({ 'a.uni': grid('a.uni', 7), 'a.det': 1 }, [], { uniMode: Uint8Array.from([mode, 0]) });
    const { S: S2, proc: p2, vs: [w] } = setup({ cp: c, tables: { 'factory:Default': SINE } });
    w.noteOn(69, 1, false, 1);
    run(S2, p2, [w], 1);
    return Array.from(w.uRat.subarray(0, 7), (r) => 1200 * Math.log2(r));
  };
  const lin = ratios(0), ex = ratios(2);
  for (let i = 0; i < 7; i++) {
    const t = 2 * i / 6 - 1;
    assert.ok(Math.abs(lin[i] - 100 * t) < 1e-6, `linear slot ${i}`);
    assert.ok(Math.abs(ex[i] - 100 * Math.sign(t) * Math.abs(t) ** 2.5) < 1e-6, `exp slot ${i}`);
    if (i !== 0 && i !== 3 && i !== 6) assert.ok(Math.abs(ex[i]) < Math.abs(lin[i]), 'exp inner voices closer to centre');
  }
  // width 0: every unison voice centred
  const c0 = mkCP({ 'a.uni': grid('a.uni', 7), 'a.det': 1, 'a.uniw': 0 });
  const { S: S3, proc: p3, vs: [w3] } = setup({ cp: c0 });
  w3.noteOn(60, 1, false, 1);
  const r3 = run(S3, p3, [w3], 20);
  assert.ok(maxAbs(r3.L) > 0.1);
  assert.deepEqual(Array.from(r3.L), Array.from(r3.R));
  // width 1: outer voices panned → L ≠ R
  const r4 = (() => { const { S: S4, proc: p4, vs: [w4] } = setup({ cp: mkCP({ 'a.uni': grid('a.uni', 7), 'a.det': 1 }) }); w4.noteOn(60, 1, false, 1); return run(S4, p4, [w4], 20); })();
  assert.notDeepEqual(Array.from(r4.L), Array.from(r4.R));
});

test('unison gain compensation and blend: RMS of N detuned voices ≈ one voice; blend 0 keeps only the centre (§3.8)', () => {
  const rms = (p) => {
    const { S, proc, vs: [v] } = setup({ cp: mkCP({ 'a.rand': 1, ...p }), tables: { 'factory:Default': SINE }, OS: 1 });
    v.noteOn(69, 1, false, 1);
    const { L, R } = run(S, proc, [v], spansOf(1));
    let s = 0;
    for (let i = 24000; i < L.length; i++) s += L[i] * L[i] + R[i] * R[i];
    return Math.sqrt(s / (L.length - 24000));
  };
  const one = rms({});
  for (const N of [3, 8, 16]) {
    const r = rms({ 'a.uni': grid('a.uni', N), 'a.det': 0.7 });
    assert.ok(Math.abs(20 * Math.log10(r / one)) < 1.5, `N ${N}: ${(20 * Math.log10(r / one)).toFixed(2)} dB`);
  }
  // blend 0 → only the centre voice sounds (no beating, exact sine at the note)
  const { S, proc, vs: [v] } = setup({ cp: mkCP({ 'a.uni': grid('a.uni', 5), 'a.det': 1, 'a.blend': 0 }), tables: { 'factory:Default': SINE }, OS: 1 });
  v.noteOn(69, 1, false, 1);
  const { L } = run(S, proc, [v], spansOf(0.5));
  assert.ok(Math.abs(zcFreq(L, proc.fs, 4800) - 440) < 0.01);
  assert.ok(Math.abs(maxAbs(L, 12000) / one - 1) < 0.02, 'centre voice at full level (gain-compensated to 1)');
});

test('mip levels while gliding: hysteresis at OS 2, continuous level blend at OS 1 (§6.5, §7.4, deviation 9 sign-off)', () => {
  const glide = (OS) => {
    const { S, proc, vs: [v] } = setup({ OS, cp: mkCP({ 'g.porta': Math.pow(2 / 8, 0.2) }, [], { mono: 1 }) });
    proc.held = [40]; v.noteOn(40, 1, false, 1);
    run(S, proc, [v], 2);
    proc.held = [40, 100]; v.noteOn(100, 1, false, 1);
    const el = [], lv = [], N = 128 * OS, b = new Float64Array(N);
    for (let s = 0; s < spansOf(2.1); s++) {
      S.begin(proc, N);
      for (let c = 0; c < 32; c++) { v.render(b, b, proc.CH); el.push(v.uEl[0]); lv.push(v.uLv[0]); }
    }
    return { el, lv };
  };
  const a = glide(1);
  let dmax = 0;
  for (let i = 1; i < a.el.length; i++) dmax = Math.max(dmax, Math.abs(a.el[i] - a.el[i - 1]));
  assert.ok(dmax < 0.01, 'OS 1: the effective level moves continuously, max step ' + dmax);
  assert.ok(a.el[a.el.length - 1] - a.el[0] > 4, 'rising pitch drops harmonics');
  const b = glide(2);
  for (let i = 1; i < b.lv.length; i++) assert.ok(b.lv[i] === b.lv[i - 1] || b.lv[i] === b.lv[i - 1] + 1, 'OS 2: one level at a time, never back');
  assert.ok(b.el.every((x) => Number.isInteger(x)), 'OS 2: no blending');
});

test('memory: a voice without delay memory ≤ 256 KB at 192 kHz; delay families ≤ 2 MB (§8.4.3)', () => {
  const bytesOf = (root) => {
    const seen = new Set(), bufs = new Set();
    let n = 0;
    const walk = (o, key) => {
      if (!o || typeof o !== 'object' || seen.has(o)) return;
      if (['proc', 'lvD', 'sD', 'nLvL', 'nLvR', 'm'].includes(key)) return;   // host / shared wavetable data / the processor's sx.mod
      seen.add(o);
      if (ArrayBuffer.isView(o)) { if (!bufs.has(o.buffer)) { bufs.add(o.buffer); n += o.buffer.byteLength; } return; }
      for (const k of Object.keys(o)) walk(o[k], k);
    };
    walk(root, '');
    return n;
  };
  const { S, vs: [v] } = setup({ base: 48000, OS: 4 });
  const KB = bytesOf(v) / 1024;
  console.log(`  voice: ${KB.toFixed(1)} KB at fs 192 kHz (no delay family)`);
  assert.ok(KB <= 256);
  for (const t of [39, 47, 69, 80, 81, 82, 90]) {
    const f = new S.SFilter(192000);
    f.setType(t);
    assert.ok(bytesOf(f) <= 2 * 1024 * 1024, 'type ' + t);
  }
  v.filt.prealloc(true);
  const MB = bytesOf(v) / 1048576;
  console.log(`  voice with every filter family preallocated: ${MB.toFixed(2)} MB`);
  assert.ok(MB <= 2);
});

/* ------------------------------------------------------------------ matrix (§5.2, §10.4.6) */

test('matrix rows: bipolar ±12 st, unipolar range, aux (inv), curve, clamping (§10.4.6)', () => {
  const tbl = { 'factory:Default': SINE };
  const pitchOf = (cp, ct = null) => {
    const { S, proc, vs: [v] } = setup({ cp, ct, tables: tbl });
    v.noteOn(60, 1, false, 1);
    const { L } = run(S, proc, [v], spansOf(0.4));
    return zcFreq(L, proc.fs, 9600);
  };
  const f0 = pitchOf(mkCP());
  const fUp = pitchOf(mkCP({}, [{ src: 'fixed', dst: 'a.semi', bi: 1 }]));
  assert.ok(Math.abs(1200 * Math.log2(fUp / f0) - 1200) < 0.05, 'Fixed → semi, bipolar 100 % = +12 st');
  const cp = mkCP({}, [{ src: 'lfo1', dst: 'a.semi', bi: 1 }]);
  const ct = mkCT({ 0: { pts: [[0, 0, 0], [1, 0, 0]] } }, cp);
  const fDn = pitchOf(cp, ct);
  assert.ok(Math.abs(1200 * Math.log2(fDn / f0) + 1200) < 0.05, 'LFO at 0, bipolar 100 % = −12 st');
  // snapshot eff (the recent voice's eff vector)
  const effOf = (p, rows, vel = 1) => {
    const { S, proc, vs: [v] } = setup({ cp: mkCP(p, rows) });
    v.noteOn(60, vel, false, 1);
    run(S, proc, [v], 2);
    return S.snapshot(proc).eff;
  };
  const C = DI['f.cutoff'];
  assert.equal(effOf({ 'f.cutoff': 0.25 }, [{ src: 'fixed', dst: 'f.cutoff', amt: 0.5 }])[C], 0.75);
  assert.equal(effOf({ 'f.cutoff': 0.25 }, [{ src: 'fixed', dst: 'f.cutoff', amt: 1, aux: 'fixed', inv: 1 }])[C], 0.25);
  assert.equal(effOf({ 'f.cutoff': 0.25 }, [{ src: 'fixed', dst: 'f.cutoff', amt: 0.5, aux: 'velo' }], 0.5)[C], 0.5);
  assert.equal(effOf({ 'f.cutoff': 0.5 }, [{ src: 'fixed', dst: 'f.cutoff', amt: 1 }])[C], 1, 'clamped at 1');
  assert.equal(effOf({ 'f.cutoff': 0.5 }, [{ src: 'fixed', dst: 'f.cutoff', amt: -1 }])[C], 0, 'clamped at 0');
  const k = 6 * 0.5, bent = (1 - Math.exp(-k * 0.5)) / (1 - Math.exp(-k));
  const e = effOf({ 'f.cutoff': 0.1 }, [{ src: 'velo', dst: 'f.cutoff', amt: 0.5, curve: 0.5 }], 0.5)[C];
  assert.ok(Math.abs(e - (0.1 + 0.5 * bent)) < 1e-6, `curve bends the source: ${e}`);
  const eb = effOf({ 'f.cutoff': 0.5 }, [{ src: 'velo', dst: 'f.cutoff', amt: 0.4, bi: 1 }], 0.25)[C];
  assert.ok(Math.abs(eb - (0.5 + 0.4 * (0.25 - 0.5))) < 1e-6, 'bipolar row from a unipolar source');
  const ebb = effOf({ 'f.cutoff': 0.5 }, [{ src: 'bend', dst: 'f.cutoff', amt: 0.4 }])[C];
  assert.equal(ebb, 0.5, 'bipolar source at 0 adds nothing');
  const eo = effOf({ 'f.cutoff': 0.2 }, [{ src: 'fixed', dst: 'f.cutoff', amt: 0.6, out: 0.5 }])[C];
  assert.ok(Math.abs(eo - 0.5) < 1e-6, 'amount × output');
});

test('a row Fixed → b.on switches OSC B on at the next chunk with a one-chunk gain ramp (§1, §10.4.6)', () => {
  const cp = mkCP({ 'a.on': 0, 'b.on': 0, 'e1.att': 0, 'b.rand': 0, 'b.phase': 0.25 });
  const { S, proc, vs: [v] } = setup({ cp, tables: { 'factory:Default': SINE } });
  v.noteOn(69, 1, false, 1);
  const a = run(S, proc, [v], 4);
  assert.equal(maxAbs(a.L), 0, 'both oscillators off: silence');
  proc.p = { serum: mkCP({ 'a.on': 0, 'b.on': 0, 'e1.att': 0, 'b.rand': 0, 'b.phase': 0.25 }, [{ src: 'fixed', dst: 'b.on' }]), fxr: null };
  v.apply(proc.p);
  const b = run(S, proc, [v], 2), CH = proc.CH, A = 0.5625;
  for (let s = 0; s < CH; s++) assert.ok(Math.abs(b.L[s]) <= A * (s + 1) / CH + 1e-9, `ramp sample ${s}: ${b.L[s]}`);
  assert.ok(Math.abs(maxAbs(b.L, CH) - A) < 1e-3, 'full level after the first chunk');
});

/* ------------------------------------------------------------------ warps (§3.3, §10.4.7) */

test('warps: neutral settings are bit-identical to Off; FM/AM/RM without their modulator ≡ Off (§10.4.7)', () => {
  const tbl = { 'factory:Default': SAW, 'noise:White': noiseFrom(Float32Array.from({ length: 8192 }, (_, i) => Math.sin(i * 0.37) * 0.5), null), ...SUBS };
  const out = (p) => {
    const { S, proc, vs: [v] } = setup({ cp: mkCP({ 'b.on': 1, 'n.on': 1, 's.on': 1, 'a.uni': grid('a.uni', 3), ...p }), tables: tbl });
    v.noteOn(57, 1, false, 1);
    return run(S, proc, [v], 12).L;
  };
  const off = out({});
  const near = (x, msg) => { let d = 0; for (let i = 0; i < x.length; i++) d = Math.max(d, Math.abs(x[i] - off[i])); assert.ok(d <= 1e-12, msg + ': ' + d); };
  for (const m of [1, 4, 5, 7, 8, 9, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]) near(out({ 'a.warpMode': m / 22, 'a.warp': 0 }), 'mode ' + m + ' at w 0');
  for (const m of [6, 10]) near(out({ 'a.warpMode': m / 22, 'a.warp': 0.5 }), 'mode ' + m + ' at w 0.5');
  for (const m of [2, 3, 11, 12]) {
    const x = out({ 'a.warpMode': m / 22, 'a.warp': 0 });
    let d = 0;
    for (let i = 0; i < x.length; i++) d = Math.max(d, Math.abs(x[i] - off[i]));
    assert.ok(d > 1e-3, 'mode ' + m + ' is audible at every setting');
  }
  // modulator off: FM (from B) with B off, FM (Noise) with noise off, FM (Sub) with sub off, AM/RM with B off
  const off2 = (() => { const { S, proc, vs: [v] } = setup({ cp: mkCP({ 'a.uni': grid('a.uni', 3) }), tables: tbl }); v.noteOn(57, 1, false, 1); return run(S, proc, [v], 12).L; })();
  for (const m of [18, 19, 20, 21, 22]) {
    const { S, proc, vs: [v] } = setup({ cp: mkCP({ 'a.uni': grid('a.uni', 3), 'a.warpMode': m / 22, 'a.warp': 0.7 }), tables: tbl });
    v.noteOn(57, 1, false, 1);
    const x = run(S, proc, [v], 12).L;
    let d = 0;
    for (let i = 0; i < x.length; i++) d = Math.max(d, Math.abs(x[i] - off2[i]));
    assert.ok(d <= 1e-12, `mode ${m} without modulator ≡ Off (${d})`);
  }
});

test('warps: Sync raises the centroid, PWM duty, AM by a silent-but-on OSC B, single direction under modulation (§10.4.7)', () => {
  const centroid = (x, fs) => {
    const N = 16384, db = specDb(x, x.length - N, N);
    let s = 0, w = 0;
    for (let k = 1; k < N / 2 && k * fs / N < 20000; k++) { const m = Math.pow(10, db[k] / 20); s += m * k; w += m; }
    return s / w * fs / N;
  };
  const go = (p, tbl = { 'factory:Default': SINE }, cpx = {}) => {
    const { S, proc, vs: [v] } = setup({ cp: mkCP({ 'a.rand': 0, ...p }, [], cpx), tables: tbl });
    v.noteOn(57, 1, false, 1);
    return { ...run(S, proc, [v], 90), fs: proc.fs };
  };
  const c0 = centroid(go({}).L, 96000), c1 = centroid(go({ 'a.warpMode': 1 / 22, 'a.warp': 1 }).L, 96000);
  assert.ok(c1 >= 4 * c0, `sync centroid ${c1.toFixed(0)} vs ${c0.toFixed(0)}`);
  // PWM on a square: mean of sign falls with w
  let prev = 2;
  for (const w of [0, 0.25, 0.5, 0.75, 1]) {
    const { L } = go({ 'a.warpMode': 7 / 22, 'a.warp': w }, { 'factory:Default': SQUARE });
    let s = 0;
    for (let i = 20000; i < L.length; i++) s += Math.sign(L[i]);
    s /= L.length - 20000;
    assert.ok(s < prev, `duty falls with w (${w}: ${s.toFixed(3)})`);
    assert.ok(Math.abs(s + 0.995 * w) < 0.03, `PWM: high for φ < (1 − 0.995w)/2, the rest low (w ${w}: ${s})`);
    prev = s;
  }
  // AM w = 1 from an OSC B that is on but outputs 0 → 0.5·x; with B off → x
  const tbl = { 'factory:Default': SAW, zero: ZEROT };
  const wt = { wt: ['factory:Default', 'zero'] };
  const x0 = go({}, tbl, wt).L, xa = go({ 'a.warpMode': 19 / 22, 'a.warp': 1, 'b.on': 1, 'b.level': 0 }, tbl, wt).L;
  const xb = go({ 'a.warpMode': 19 / 22, 'a.warp': 1 }, tbl, wt).L;
  for (let i = 0; i < x0.length; i++) {
    assert.ok(Math.abs(xa[i] - 0.5 * x0[i]) < 1e-12, 'AM from silent-but-on B = 0.5·x');
    assert.ok(Math.abs(xb[i] - x0[i]) < 1e-12, 'AM with B off = x');
  }
  // both warp modes modulated into 18–20: B behaves as Off (A level 0: output = B alone)
  const tb2 = { 'factory:Default': SAW };
  const rowsBoth = [{ src: 'fixed', dst: 'a.warpMode', amt: 18 / 22 }, { src: 'fixed', dst: 'b.warpMode', amt: 19 / 22 }];
  const rowsA = [{ src: 'fixed', dst: 'a.warpMode', amt: 18 / 22 }];
  const outB = (rows) => {
    const { S, proc, vs: [v] } = setup({ cp: mkCP({ 'a.level': 0, 'b.on': 1, 'b.warp': 1, 'a.warp': 1 }, rows), tables: tb2 });
    v.noteOn(57, 1, false, 1);
    return run(S, proc, [v], 10).L;
  };
  assert.deepEqual(Array.from(outB(rowsBoth)), Array.from(outB(rowsA)));
  // FM from B changes A (B on, level 0 → only A's FM-modulated output)
  const fmA = (() => { const { S, proc, vs: [v] } = setup({ cp: mkCP({ 'b.on': 1, 'b.level': 0, 'a.warpMode': 18 / 22, 'a.warp': 0.6 }), tables: tb2 }); v.noteOn(57, 1, false, 1); return run(S, proc, [v], 10).L; })();
  const plainA = (() => { const { S, proc, vs: [v] } = setup({ cp: mkCP({ 'b.on': 1, 'b.level': 0 }), tables: tb2 }); v.noteOn(57, 1, false, 1); return run(S, proc, [v], 10).L; })();
  assert.ok(maxStep(fmA.map((a, i) => a - plainA[i])) > 1e-3, 'FM from B modulates A');
});

test('renderWarp matches the exact §3.3 formulas within the §0.2 tolerances (200 random w per mode)', () => {
  const { SerumDSP: S } = loadDSP();
  const fr = Float32Array.from(frame((p) => Math.sin(2 * Math.PI * p) + 0.2 * Math.sin(4 * Math.PI * p + 1)));
  const mod = Float32Array.from(frame((p) => Math.sin(2 * Math.PI * p + 0.3)));
  const remap = Float32Array.from({ length: 2049 }, (_, j) => Math.pow(j / 2048, 1.7));
  const hermRef = (b, p) => { const x = p * 2048, i = Math.floor(x), f = x - i, a = (k) => b[((k % 2048) + 2048) % 2048];
    const xm = a(i - 1), x0 = a(i), x1 = a(i + 1), x2 = a(i + 2);
    return ((((0.5 * (x2 - xm) + 1.5 * (x0 - x1)) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm)) * f + x0); };
  const G = (p) => { const x = p * 2048, i = Math.min(2047, Math.floor(x)); return remap[i] + (x - i) * (remap[i + 1] - remap[i]); };
  const frac = (x) => x - Math.floor(x);
  const exact = (m, w, ph, mv) => {           // [φ', output factor]
    const K = (a) => Math.pow(2, a);
    switch (m) {
      case 0: return [ph, 1];
      case 1: return [frac(ph * K(4.4 * w)), 1];
      case 2: return [frac(ph * K(4.4 * w)), ph < 0.25 || ph > 0.75 ? Math.sin(2 * Math.PI * ph) ** 2 : 1];
      case 3: return [frac(ph * K(4.4 * w)), Math.sin(Math.PI * ph) ** 2];
      case 4: case 5: case 6: {
        const k = m === 4 ? K(2.5 * w) : m === 5 ? K(-2.5 * w) : K(2.5 * (2 * w - 1));
        const u = ph < 0.5 ? 2 * ph : 2 - 2 * ph, up = Math.pow(u, k);
        return [ph < 0.5 ? up / 2 : 1 - up / 2, 1];
      }
      case 7: return [Math.min(1 - Math.pow(2, -24), ph / (1 - 0.995 * w)), 1];
      case 8: return [Math.pow(ph, K(2.5 * w)), 1];
      case 9: return [Math.pow(ph, K(-2.5 * w)), 1];
      case 10: return [Math.pow(ph, K(2.5 * (2 * w - 1))), 1];
      case 11: return [ph, ph < w ? 1 : -1];
      case 12: return [Math.pow(ph < 0.5 ? 2 * ph : 2 - 2 * ph, K(2.5 * (2 * w - 1))), 1];
      case 13: return [ph + w * (G(ph) - ph), 1];
      case 14: { const q = ph < 0.5 ? G(2 * ph) / 2 : 1 - G(2 - 2 * ph) / 2; return [ph + w * (q - ph), 1]; }
      case 15: return [frac(ph - (0.9 * w / (2 * Math.PI)) * Math.sin(2 * Math.PI * ph)), 1];
      case 16: { const s = Math.floor(4 * ph), u = 4 * ph - s, up = s % 2 ? 1 - G(1 - u) : G(u); return [ph + w * ((s + up) / 4 - ph), 1]; }
      case 17: { if (w < 1e-6) return [ph, 1]; const M = Math.max(2, Math.round(2048 * Math.pow(2, -10 * w))); return [Math.floor(ph * M) / M, 1]; }
      case 18: case 21: return [frac(ph + 3 * Math.pow(w, 1.5) * mv), 1];
      case 22: return [frac(ph + 4 * Math.pow(w, 1.5) * mv), 1];
      case 19: return [ph, 1 - w + w * (0.5 + 0.5 * mv)];
      case 20: return [ph, 1 - w + w * mv];
    }
  };
  const r = rng(11);
  for (let m = 0; m <= 22; m++) {
    for (let rep = 0; rep < 200; rep++) {
      const w = rep === 0 ? 0 : rep === 1 ? 1 : rep === 2 ? 0.5 : r();
      const over = rep % 3 === 0 ? 2 : 1;
      const y = S.renderWarp(fr, m, w, { over, remap, mod });
      assert.equal(y.length, 2048 * over);
      for (let j = 0; j < y.length; j += 7) {
        const ph = j / y.length, mv = hermRef(mod, ph), [pw, g] = exact(m, w, ph, mv);
        const want = hermRef(fr, pw) * g;
        assert.ok(Math.abs(y[j] - want) < 2e-4, `mode ${m} w ${w.toFixed(4)} φ ${ph}: ${y[j]} vs ${want}`);
      }
    }
  }
  // no opts.mod: m = 0 (AM → x·(1 − w/2), RM → x·(1 − w), FM → x)
  const x0 = S.renderWarp(fr, 0, 0);
  const am = S.renderWarp(fr, 19, 0.6), rm = S.renderWarp(fr, 20, 0.6), fm = S.renderWarp(fr, 18, 0.6);
  for (let j = 0; j < 2048; j++) {
    assert.ok(Math.abs(am[j] - x0[j] * 0.7) < 1e-6 && Math.abs(rm[j] - x0[j] * 0.4) < 1e-6 && Math.abs(fm[j] - x0[j]) < 1e-6);
  }
  // neutral settings return the plain cycle exactly
  const plain = S.renderWarp(fr, 0, 0);
  for (const m of [1, 4, 5, 7, 8, 9, 13, 14, 15, 16, 17, 18, 21, 22]) assert.deepEqual(Array.from(S.renderWarp(fr, m, 0, { mod })), Array.from(plain), 'mode ' + m);
  assert.deepEqual(Array.from(S.renderWarp(fr, 6, 0.5)), Array.from(plain));
  assert.deepEqual(Array.from(S.renderWarp(fr, 10, 0.5)), Array.from(plain));
});

/* ------------------------------------------------------------------ phase (§6.4, §10.4.8) */

test('phase: PHASE 0.5 / RAND 0 starts every note at φ = 0.5; MemTrig repeats; mono overlap continues; memNow', () => {
  const tbl = { 'factory:Default': SINE };
  const { S, proc, vs: [v] } = setup({ cp: mkCP({ 'a.rand': 0, 'a.phase': 0.5, 'e1.att': 0 }), tables: tbl });
  const f = 440 * Math.pow(2, (64 - 69) / 12), inc = f / proc.fs;
  for (let rep = 0; rep < 2; rep++) {
    v.noteOn(64, 1, false, 1);
    const { L } = run(S, proc, [v], 2);
    for (let s = proc.CH; s < 200; s++) assert.ok(Math.abs(L[s] - 0.5625 * Math.sin(2 * Math.PI * (0.5 + s * inc))) < 1e-5, `note ${rep} sample ${s}`);
    v.noteOff();
    run(S, proc, [v], 20);
    assert.equal(v.active, false);
  }
  // MemTrig: PHASE 1 + RAND 1 → identical starts (unison 4, detuned)
  const m = setup({ cp: mkCP({ 'a.rand': 1, 'a.phase': 1, 'a.uni': grid('a.uni', 4), 'a.det': 0.8 }), tables: tbl });
  const starts = [];
  for (let rep = 0; rep < 2; rep++) {
    m.vs[0].noteOn(60, 1, false, 1);
    starts.push(Array.from(run(m.S, m.proc, m.vs, 4).L.subarray(0, 512)));
    m.vs[0].noteOff();
    run(m.S, m.proc, m.vs, 20);
  }
  assert.deepEqual(starts[0], starts[1]);
  assert.ok(maxAbs(Float64Array.from(starts[0])) > 0.05);
  // RAND 1 (phase < Mem): different starts
  const q = setup({ cp: mkCP({ 'a.uni': grid('a.uni', 4) }), tables: tbl });
  const st2 = [];
  for (let rep = 0; rep < 2; rep++) { q.vs[0].noteOn(60, 1, false, 1); st2.push(Array.from(run(q.S, q.proc, q.vs, 4).L.subarray(0, 512))); q.vs[0].noteOff(); run(q.S, q.proc, q.vs, 20); }
  assert.notDeepEqual(st2[0], st2[1]);
  // mono, previous note still sounding: phases continue (no step at the note-on)
  const mo = setup({ cp: mkCP({ 'a.rand': 1, 'e1.att': 0 }, [], { mono: 1 }), tables: tbl });
  mo.vs[0].noteOn(60, 1, false, 1);
  const pre = run(mo.S, mo.proc, mo.vs, 10).L;
  mo.vs[0].noteOn(62, 1, false, 1);
  const post = run(mo.S, mo.proc, mo.vs, 10).L;
  const joined = Float64Array.from([...pre.subarray(pre.length - 64), ...post.subarray(0, 64)]);
  assert.ok(maxStep(joined) <= 2 * maxStep(post, 200), `no reset: step ${maxStep(joined)} vs ${maxStep(post, 200)}`);
  // memNow: relative phases of the recent voice's unison voices
  const u = setup({ cp: mkCP({ 'a.uni': grid('a.uni', 2), 'a.det': 0.6 }), tables: tbl });
  u.vs[0].noteOn(60, 1, false, 1);
  run(u.S, u.proc, u.vs, 7);
  const sn = u.S.snapshot(u.proc), w = u.vs[0];
  let d = w.uPh[1] - w.uPh[0]; d -= Math.floor(d);
  assert.ok(Math.abs(sn.memNow[1] - d) < 1e-6 && sn.memNow[0] === 0, 'memNow = frac(φ1 − φ0)');
});

/* ------------------------------------------------------------------ filters (§3.4, §6.11, §10.4.9–10) */

test('SFilter Normal types: LP/HP gain and slopes, Band 12 peak, Notch 12 depth, Peak 12 boost (fs 96 kHz)', () => {
  const { SerumDSP: S } = loadDSP();
  const fs = 96000;
  for (const fc of [250, 1000, 3000]) {
    [[0, 1], [1, 2], [2, 3], [3, 4], [4, 1], [5, 2], [6, 3], [7, 4]].forEach(([t, o]) => {
      const h = S.filterImpulse(t, fc, 0, 0, 0, fs, 32768);
      const g8 = dB(mag(h, fc / 8, fs)), slope = (dB(mag(h, 8 * fc, fs)) - dB(mag(h, 2 * fc, fs))) / 2;
      assert.ok(Math.abs(g8) <= 1.5, `LP type ${t} fc ${fc}: ${g8.toFixed(2)} dB at fc/8`);
      assert.ok(Math.abs(slope + 6 * o) <= 4, `LP type ${t} fc ${fc}: slope ${slope.toFixed(2)}`);
    });
    [[8, 1], [9, 2], [10, 3], [11, 4]].forEach(([t, o]) => {
      const h = S.filterImpulse(t, fc, 0, 0, 0, fs, 32768);
      const g8 = dB(mag(h, Math.min(8 * fc, 40000), fs)), slope = (dB(mag(h, fc / 2, fs)) - dB(mag(h, fc / 8, fs))) / 2;
      assert.ok(Math.abs(g8) <= 1.5, `HP type ${t} fc ${fc}: ${g8.toFixed(2)} dB at 8·fc`);
      assert.ok(Math.abs(slope - 6 * o) <= 4, `HP type ${t} fc ${fc}: slope ${slope.toFixed(2)}`);
    });
    const band = dB(mag(S.filterImpulse(12, fc, 0, 0, 0, fs, 32768), fc, fs));
    assert.ok(Math.abs(band) <= 1, `Band 12 peak ${band.toFixed(2)} dB`);
    const notch = dB(mag(S.filterImpulse(16, fc, 0, 0, 0, fs, 32768), fc, fs));
    assert.ok(notch <= -20, `Notch 12 at fc ${notch.toFixed(1)} dB`);
    const peak = dB(mag(S.filterImpulse(14, fc, 0.8, 0, 0, fs, 65536), fc, fs));
    assert.ok(peak >= 6, `Peak 12 res 0.8 at fc ${peak.toFixed(1)} dB`);
    const p0 = dB(mag(S.filterImpulse(14, fc, 0, 0, 0, fs, 32768), fc / 8, fs));
    assert.ok(Math.abs(p0) < 0.5, 'Peak 12 is flat away from fc');
  }
});

test('SFilter Misc/EQ types: Band EQ gain law, Low EQ cut, comb peaks, ring mod, S&H, formants (fs 96 kHz)', () => {
  const { SerumDSP: S } = loadDSP();
  const fs = 96000;
  for (const fc of [300, 2000]) {
    const up = dB(mag(S.filterImpulse(73, fc, 0, 0, 1, fs, 32768), fc, fs));
    assert.ok(Math.abs(up - 24) <= 1.5, `Band EQ 12 var 1: ${up.toFixed(2)} dB`);
    const flat = dB(mag(S.filterImpulse(73, fc, 0, 0, 0.5, fs, 32768), fc, fs));
    assert.ok(Math.abs(flat) <= 0.5, `Band EQ 12 var 0.5: ${flat.toFixed(2)} dB`);
    for (const t of [71, 72]) {
      const cut = dB(mag(S.filterImpulse(t, fc, 0, 0, 0, fs, 65536), fc / 16, fs));
      assert.ok(cut <= -40, `Low EQ type ${t} var 0 at fc/16: ${cut.toFixed(1)} dB`);
      const pass = dB(mag(S.filterImpulse(t, fc, 0, 0, 0.5, fs, 32768), fc / 16, fs));
      assert.ok(Math.abs(pass) < 0.5, `type ${t} var 0.5 flat`);
    }
    for (const t of [74, 75]) {
      const cut = dB(mag(S.filterImpulse(t, fc, 0, 0, 0, fs, 65536), Math.min(16 * fc, 40000), fs));
      assert.ok(cut <= -30, `High EQ type ${t} var 0 above fc: ${cut.toFixed(1)} dB`);
    }
  }
  // magnitude response from the impulse response (FFT, 1.46 Hz bins) and its local maxima
  const resp = (h) => { const re = Float64Array.from(h), im = new Float64Array(h.length); fft(re, im, false);
    return Float64Array.from({ length: h.length / 2 }, (_, k) => Math.hypot(re[k], im[k])); };
  const maxima = (m, lo, hi) => { const b = fs / (2 * m.length), out = [];
    for (let k = Math.ceil(lo / b); k < hi / b; k++) if (m[k] > m[k - 1] && m[k] >= m[k + 1]) out.push(k * b); return out; };
  // Cmb +: peaks at k·fc (±1 %)
  const cm = resp(S.filterImpulse(39, 1000, 0.6, 0, 0, fs, 65536)), cmax = maxima(cm, 500, 5600);
  for (let k = 1; k <= 5; k++) {
    const near = cmax.filter((f) => Math.abs(f / (k * 1000) - 1) <= 0.01);
    assert.ok(near.length === 1, `comb peak ${k}: ${cmax.filter((f) => Math.abs(f / (k * 1000) - 1) < 0.1)}`);
    const b = fs / 65536;
    assert.ok(cm[Math.round(k * 1000 / b)] > 2 * cm[Math.round((k + 0.5) * 1000 / b)], 'peak above the trough');
  }
  const cn = maxima(resp(S.filterImpulse(40, 1000, 0.6, 0, 0, fs, 65536)), 400, 3000);
  assert.ok([500, 1500, 2500].every((f) => cn.some((g) => Math.abs(g / f - 1) <= 0.01)), 'Cmb −: peaks at (k + ½)·fc');
  // Ring Mod: 1 kHz sine, fc 200 Hz → 800 and 1200 Hz
  const ring = new S.SFilter(fs);
  ring.setType(76); ring.set(200, 200, 0, 0, 0);
  const y = new Float64Array(32768);
  for (let i = 0; i < y.length; i++) { const x = Math.sin(2 * Math.PI * 1000 * i / fs); ring.tick(x, x); y[i] = ring.yl; }
  const w = bh(y.length), pk = (f) => dtft(y, w, f, fs);
  assert.ok(pk(800) > 100 * pk(1000) && pk(1200) > 100 * pk(1000), 'ring mod sidebands');
  assert.ok(Math.abs(pk(800) / pk(1200) - 1) < 0.05);
  // SampHold: piecewise constant runs of fs/fc
  const sh = new S.SFilter(fs);
  sh.setType(78); sh.set(1000, 1000, 0, 0, 0);
  const z = [];
  for (let i = 0; i < 9600; i++) { const x = Math.sin(2 * Math.PI * 97 * i / fs); sh.tick(x, x); z.push(sh.yl); }
  const runs = [];
  let len = 1;
  for (let i = 1; i < z.length; i++) { if (z[i] === z[i - 1]) len++; else { runs.push(len); len = 1; } }
  const mid = runs.slice(2, -2);
  assert.ok(mid.length > 50 && mid.every((r) => Math.abs(r - 96) <= 1), 'run lengths ≈ fs/fc');
  // SampHold-: x − held
  const sh2 = new S.SFilter(fs);
  sh2.setType(79); sh2.set(1000, 1000, 0, 0, 0);
  for (let i = 0; i < 500; i++) { const x = Math.sin(i * 0.01); sh.tick(x, x); sh2.tick(x, x); assert.ok(Math.abs(sh2.yl - (x - sh.yl)) < 1e-12); }
  // formants: P = 0 (vowel a) and P = 4 (vowel u): peaks within 15 % of F1 and F2
  const TAB = [[[730, 1090], [300, 870]], [[850, 1220], [370, 950]], [[1030, 1370], [430, 1170]]];
  for (let t = 0; t < 3; t++) {
    for (const [P, fc] of [[0, 60], [1, 9000]]) {
      const mx = maxima(resp(S.filterImpulse(86 + t, fc, 0.2, 0, 0, fs, 65536)), 100, 5000);
      for (const F of TAB[t][P]) {
        assert.ok(mx.some((f) => Math.abs(f / F - 1) <= 0.15), `formant table ${t + 1} vowel ${P ? 'u' : 'a'}: peaks ${mx.map(Math.round)} for ${F}`);
      }
    }
  }
});

test('level calibration (§6.11): LP/HP/BP/EQ families pass 0 ± 1 dB at res 0, drive 0 (fs 96 kHz)', () => {
  const { SerumDSP: S } = loadDSP();
  const fs = 96000, fc = 2000;
  const g = (t, f, vr = 0) => dB(mag(S.filterImpulse(t, fc, 0, 0, vr, fs, 32768), f, fs));
  const near0 = (x, msg) => assert.ok(Math.abs(x) <= 1, msg + ': ' + x.toFixed(2) + ' dB');
  // lowpass passband (fc/16): MG, SVF, LH/LB/LP/LN 12 with f2 below (pass in between), morph at var 0, French, German, AddBass, Dist.Comb LP, Scream LP
  for (const t of [0, 1, 2, 3, 4, 5, 6, 7, 31, 32, 33, 34, 35, 36, 83, 84, 85, 90, 92, 94]) near0(g(t, fc / 16), 'LP type ' + t);
  // highpass passband (8·fc)
  for (const t of [8, 9, 10, 11]) near0(g(t, 8 * fc), 'HP type ' + t);
  // dual LH 12 with f2 (var 0.5 → 424.6 Hz) under the cutoff: passes between them
  near0(g(19, Math.sqrt(424.6 * fc), 0.5), 'LH 12 between f2 and cutoff');
  // band-pass peaks at fc; Band 24 too
  near0(g(12, fc), 'Band 12 peak'); near0(g(13, fc), 'Band 24 peak');
  // Bandreject / EQ types at 0 dB (var 0.5) are flat away from fc
  for (const t of [71, 72, 73, 74, 75]) { near0(g(t, fc / 16, 0.5), 'EQ type ' + t); near0(g(t, fc, 0.5), 'EQ type ' + t + ' at fc'); }
  near0(g(89, fc / 16), 'Bandreject below'); near0(g(89, 16 * fc), 'Bandreject above');
  assert.ok(g(89, fc) < -40, 'Bandreject notch');
});

test('German LP is clean (THD < 0.1 % at −20 dBFS, res 0); every type: process touches only [off, off + n)', () => {
  const { SerumDSP: S } = loadDSP();
  const fs = 96000, f = new S.SFilter(fs);
  f.setType(84); f.set(8000, 8000, 0, 0, 0);
  const N = 65536, y = new Float64Array(N);
  for (let i = 0; i < 20000 + N; i++) { const x = 0.1 * Math.sin(2 * Math.PI * 1000 * i / fs); f.tick(x, x); if (i >= 20000) y[i - 20000] = f.yl; }
  const w = bh(N), h1 = dtft(y, w, 1000, fs);
  let hs = 0;
  for (let k = 2; k <= 8; k++) hs += dtft(y, w, 1000 * k, fs) ** 2;
  assert.ok(Math.sqrt(hs) / h1 < 1e-3, 'THD ' + (100 * Math.sqrt(hs) / h1).toFixed(4) + ' %');
  const r = rng(5);
  for (let t = 0; t < 96; t++) {
    const g = new S.SFilter(48000);
    g.setType(t); g.set(700, 900, 0.5, 0.3, 0.4);
    const L = Float64Array.from({ length: 256 }, () => r() - 0.5), R = L.map((x) => -x), L0 = L.slice(), R0 = R.slice();
    g.process(L, R, 100, 60);
    for (let i = 0; i < 256; i++) if (i < 100 || i >= 160) { assert.equal(L[i], L0[i], 'type ' + t); assert.equal(R[i], R0[i], 'type ' + t); }
  }
});

test('voice filter: routing, Combs ignores MIX, key tracking, stereo PAN, filter-on ramp (§6.11)', () => {
  const tbl = { 'factory:Default': SAW };
  const go = (p, note = 48) => {
    const { S, proc, vs: [v] } = setup({ cp: mkCP({ 'f.on': 1, 'f.type': 80 / 95, 'f.res': 0.7, ...p }), tables: tbl });
    v.noteOn(note, 1, false, 1);
    return run(S, proc, [v], 20);
  };
  const a = go({ 'f.mix': 0 }), b = go({ 'f.mix': 1 });
  assert.deepEqual(Array.from(a.L), Array.from(b.L), 'Combs: MIX has no effect');
  const dry = go({ 'f.on': 0 });
  assert.notDeepEqual(Array.from(dry.L), Array.from(b.L));
  // MG Low 12, mix 0 → dry; routing A off → dry
  const m0 = go({ 'f.type': 1 / 95, 'f.mix': 0 }), r0 = go({ 'f.type': 1 / 95, 'f.routeA': 0 });
  for (let i = 0; i < dry.L.length; i++) { assert.ok(Math.abs(m0.L[i] - dry.L[i]) < 1e-12); assert.ok(Math.abs(r0.L[i] - dry.L[i]) < 1e-12); }
  // PAN: L/R cutoffs differ → L ≠ R; centre → L = R
  const pc = go({ 'f.type': 1 / 95, 'f.cutoff': 0.4 }), pp = go({ 'f.type': 1 / 95, 'f.cutoff': 0.4, 'f.pan': 0.2 });
  assert.deepEqual(Array.from(pc.L), Array.from(pc.R));
  assert.ok(maxAbs(pp.L) > 1.2 * maxAbs(pp.R), 'pan left of centre raises the left cutoff');
  // key tracking: cutoff follows the note (a low cutoff passes more of a high note with key track on)
  const kt0 = go({ 'f.type': 3 / 95, 'f.cutoff': 0.3 }, 72), kt1 = (() => {
    const { S, proc, vs: [v] } = setup({ cp: mkCP({ 'f.on': 1, 'f.type': 3 / 95, 'f.cutoff': 0.3 }, [], { filKey: 1 }), tables: tbl });
    v.noteOn(72, 1, false, 1);
    return run(S, proc, [v], 20);
  })();
  assert.ok(maxAbs(kt1.L, 2000) > 1.5 * maxAbs(kt0.L, 2000), 'key track opens the filter for a high note');
  // filter switched on by a row mid-note: no step larger than the steady maximum step
  const { S, proc, vs: [v] } = setup({ cp: mkCP({ 'f.type': 1 / 95, 'f.cutoff': 0.2 }), tables: tbl });
  v.noteOn(48, 1, false, 1);
  const pre = run(S, proc, [v], 10).L;
  proc.p = { serum: mkCP({ 'f.type': 1 / 95, 'f.cutoff': 0.2 }, [{ src: 'fixed', dst: 'f.on' }]), fxr: null };
  v.apply(proc.p);
  const post = run(S, proc, [v], 10).L;
  const j = Float64Array.from([...pre.subarray(pre.length - 32), ...post.subarray(0, 64)]);
  assert.ok(maxStep(j) <= 1.05 * maxStep(pre, 100), 'filter-on ramp is click-free');
});

/* ------------------------------------------------------------------ portamento, steal, tables (§10.4.11–13) */

test('portamento: mono overlap glide 0.25 s linear (125 ms → 66 ± 0.3 st), scaled 24 st → 0.5 s, curve (§10.4.11)', () => {
  const glide = (p, extra, from, to, at) => {
    const { S, proc, vs: [v] } = setup({ cp: mkCP({ 'g.porta': 0.5, ...p }, [], { mono: 1, ...extra }) });
    proc.held = [from];
    v.noteOn(from, 1, false, 1);
    run(S, proc, [v], 10);
    proc.held = [from, to];
    v.noteOn(to, 1, false, 1);
    const pts = [];
    run(S, proc, [v], spansOf(0.6), { each: (s) => pts.push([s * 128 / 48000, v.mod.nP]) });
    return (t) => { const e = pts.find((q) => q[0] >= t - 1e-9); return e ? e[1] : NaN; };
  };
  const g = glide({}, {}, 60, 72);
  assert.ok(Math.abs(g(0.125) - 66) <= 0.3, 'at 125 ms: ' + g(0.125));
  assert.ok(Math.abs(g(0.3) - 72) < 1e-9, 'arrived');
  const sc = glide({}, { scaled: 1 }, 48, 72);
  assert.ok(Math.abs(sc(0.25) - 60) <= 0.3 && sc(0.45) < 72 && Math.abs(sc(0.52) - 72) < 1e-9, 'scaled: 24 st take 0.5 s');
  const cv = glide({ 'g.curve': 1 }, {}, 60, 72);
  assert.ok(cv(0.0625) > 60 + 3 * 1.5, 'curve > 0: leaves fast');
  // no overlap and not "always": jump
  const { S, proc, vs: [v] } = setup({ cp: mkCP({ 'g.porta': 0.5 }, [], { mono: 1 }) });
  proc.held = [60]; v.noteOn(60, 1, false, 1); run(S, proc, [v], 4);
  v.noteOff(); proc.held = [];
  run(S, proc, [v], 40);
  proc.held = [67]; v.noteOn(67, 1, false, 1);
  assert.equal(v.mod.nP, 67);
  assert.equal(S.recentPitch(proc), 67, 'recentPitch = the recent voice\'s pitch');
  assert.equal(S.recentPitch({}), 60);
  // always: glides from the last pitch even without overlap
  const al = setup({ cp: mkCP({ 'g.porta': 0.5 }, [], { mono: 1, always: 1 }) });
  al.proc.held = [60]; al.vs[0].noteOn(60, 1, false, 1); run(al.S, al.proc, al.vs, 4); al.vs[0].noteOff(); al.proc.held = [];
  run(al.S, al.proc, al.vs, 4);
  al.proc.held = [72]; al.vs[0].noteOn(72, 1, false, 1);
  assert.equal(al.vs[0].mod.nP, 60);
  // pitch tracking off: no glide on that oscillator, MIDI 0
  const tr = setup({ cp: mkCP({ 'g.porta': 0.5, 'a.track': 0 }, [], { mono: 1 }), tables: { 'factory:Default': SINE } });
  tr.proc.held = [60, 72]; tr.vs[0].noteOn(60, 1, false, 1); tr.vs[0].noteOn(72, 1, true, 1);
  const { L } = run(tr.S, tr.proc, tr.vs, spansOf(3));
  assert.ok(Math.abs(zcFreq(L, tr.proc.fs) / (440 * Math.pow(2, -69 / 12)) - 1) < 1e-3);
});

test('voice steal at the same note is click-free; kill() then render gives exact zeros (§10.4.12)', () => {
  const { S, proc, vs: [v] } = setup({ cp: mkCP({ 'a.uni': grid('a.uni', 3) }) });
  v.noteOn(50, 1, false, 1);
  const pre = run(S, proc, [v], 40).L;
  const steady = maxStep(pre, pre.length - 4000);
  v.noteOn(50, 0.7, false, 1);
  const post = run(S, proc, [v], 2).L;
  const j = Float64Array.from([...pre.subarray(pre.length - 64), ...post.subarray(0, 64)]);
  assert.ok(maxStep(j) <= 2 * steady, `steal step ${maxStep(j)} vs steady ${steady}`);
  v.kill();
  assert.equal(v.active, false);
  const z = run(S, proc, [v], 3);
  assert.ok(z.L.every((x) => x === 0) && z.R.every((x) => x === 0));
  const b = new Float64Array(256).fill(0);
  v.render(b, b, 256);
  assert.ok(b.every((x) => x === 0));
});

test('tables: missing id → silence; storeWTFrame changes the next chunk; dropWT silences; storeWT revives (§10.4.13)', () => {
  const { S, proc, vs: [v] } = setup({ cp: mkCP({}, [], { wt: ['user:x', 'user:x'] }), tables: {} });
  v.noteOn(60, 1, false, 1);
  assert.doesNotThrow(() => run(S, proc, [v], 4));
  assert.equal(maxAbs(run(S, proc, [v], 2).L), 0, 'missing table: silent');
  let ep = S.epoch;
  const two = entryFromFrames([sawFrame(), frame((p) => Math.sin(2 * Math.PI * p))], 0);
  assert.equal(S.storeWT('user:x', two), true);
  assert.ok(S.epoch > ep); ep = S.epoch;
  const CH = proc.CH;
  const a = run(S, proc, [v], 1).L;
  assert.ok(maxAbs(a, CH) > 0.1, 'sounds within one chunk after storeWT');
  // replace frame 0 by silence: output dies at the next chunk
  const lv = MIP_LEN.map((len) => ({ len, data: new Float32Array(len) }));
  assert.equal(S.storeWTFrame('user:x', 0, lv), true);
  assert.ok(S.epoch > ep); ep = S.epoch;
  const b = run(S, proc, [v], 2).L;
  assert.equal(maxAbs(b, CH), 0, 'frame replaced');
  S.dropWT('user:x');
  assert.ok(S.epoch > ep); ep = S.epoch;
  assert.equal(maxAbs(run(S, proc, [v], 1).L), 0, 'dropped: silent');
  assert.equal(S.storeWT('user:x', entryFromFrames([sawFrame()])), true);
  assert.ok(maxAbs(run(S, proc, [v], 1).L, CH) > 0.1, 'revived within one chunk');
  // invalid entries are refused
  assert.equal(S.storeWT('user:y', { kind: 'wt', frames: 1, levels: [] }), false);
});

/* ------------------------------------------------------------------ LFOs, point modulation (§5.7, §6.12, §10.4.14, 20) */

const lfoCP = (l, mode, p = {}, rows = [], extra = {}) => {      // LFO l in mode, BPM off (Hz rate law)
  const cp = mkCP(p, rows, extra);
  cp.lfoMode[l] = mode; cp.lfoMono[l] = mode === 2 ? 1 : 0; cp.lfoBpm[l] = 0; cp.lfoAnchor[l] = 0;
  return cp;
};
const sameArr = (a, b, msg) => {
  assert.equal(a.length, b.length, msg);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) assert.fail(`${msg}: first difference at ${i}: ${a[i]} vs ${b[i]}`);
};
const setLfo = (cp, l, { bpm = 0, anchor = 0, dot = 0, trip = 0 } = {}) => {
  cp.lfoBpm[l] = bpm; cp.lfoAnchor[l] = anchor;
  const lad = [];
  for (let i = 0; i < 15; i++) lad.push(128 * Math.pow(2, -i));
  if (dot) for (let i = 0; i < 14; i++) lad.push(1.5 * 128 * Math.pow(2, -i));
  if (trip) for (let i = 0; i < 14; i++) lad.push(2 / 3 * 128 * Math.pow(2, -i));
  lad.sort((a, b) => b - a);
  cp.lfoLadN[l] = lad.length;
  for (let j = 0; j < 43; j++) cp.lfoLad[l * 43 + j] = lad[j] || 0;
};

test('LFO point modulation: a bus row raises a linked point (Trig, voice context; Off, mono context) (§10.4.14)', () => {
  const pts = [[0, 0, 0], [0.5, 0.2, 0, 0, 1], [1, 0, 0]];
  for (const withRow of [false, true]) {
    for (const mode of [0, 2]) {
      const cp = lfoCP(0, mode, { 'l1.rate': 0 }, withRow ? [{ src: 'fixed', dst: 'bus1' }] : []);
      const ct = mkCT({ 0: { pts, start: 1 } }, cp);
      const { S, proc, vs: [v] } = setup({ cp, ct });
      S.transport(proc, true);                                // Off-mode accumulators → lfoStart (x 0.5)
      proc.sx.mon = 1;
      v.noteOn(60, 1, false, 1);
      run(S, proc, [v], 3);
      const want = withRow ? 1 : 0.2;
      assert.ok(Math.abs(S.snapshot(proc).lfoOut[0] - want) < 1e-6, `mode ${mode} row ${withRow}: ${S.snapshot(proc).lfoOut[0]}`);
      if (mode === 2) assert.ok(Math.abs(proc.sx.mod.g[5 * 32] - want) < 1e-6, 'Off LFO global value uses the mono bus');
    }
  }
  // X link: the point's x moves (between its neighbours) with the bus value
  const cp = lfoCP(0, 0, { 'l1.rate': 0 }, [{ src: 'fixed', dst: 'bus2', amt: -0.2 }]);
  const ct = mkCT({ 0: { pts: [[0, 0, 0], [0.5, 1, 0, 2, 0], [1, 0, 0]], start: 0 } }, cp);
  const { S, proc, vs: [v] } = setup({ cp, ct });
  proc.sx.mon = 1;
  v.noteOn(60, 1, false, 1);
  v.mod.lPh[0] = 0.3;                                           // bus2 = 2·0.3 − 1 = −0.4 → peak at x 0.1: y(0.3) = 1 − 0.2/0.9
  run(S, proc, [v], 1);
  assert.ok(Math.abs(S.snapshot(proc).lfoOut[0] - (1 - 0.2 / 0.9)) < 1e-6);
});

test('LFOs: BPM ladder period, Off + Anchor follows the song beat, Env hold/loop, delay + rise, smooth, rate 0 (§10.4.20)', () => {
  // Trig, BPM 120, 1/4 → period 0.5 s (± one chunk)
  {
    const cp = lfoCP(0, 0, { 'l1.rate': 0.5 });
    setLfo(cp, 0, { bpm: 1 });
    const { S, proc, vs: [v] } = setup({ cp });
    proc.sx.mon = 1;
    v.noteOn(60, 1, false, 1);
    const wraps = [];
    let last = v.mod.lPh[0], t = 0;
    const N = 128 * proc.OS, b = new Float64Array(N);
    for (let s = 0; s < spansOf(2.2); s++) {
      S.begin(proc, N);
      for (let c = 0; c < 32; c++) { v.render(b, b, proc.CH); t += 4 / 48000; if (v.mod.lPh[0] < last) wraps.push(t); last = v.mod.lPh[0]; }
    }
    const per = (wraps[wraps.length - 1] - wraps[0]) / (wraps.length - 1);
    assert.ok(Math.abs(per - 0.5) <= 4 / 48000, 'period ' + per);
    assert.ok(Math.abs(wraps[0] - 0.5) <= 2 * 4 / 48000, 'first cycle from the start point');
  }
  // Off + BPM + Anchor while the transport plays: φ = frac(lfoStart + beat/beats)
  {
    const cp = lfoCP(0, 2, { 'l1.rate': 0.5 });
    setLfo(cp, 0, { bpm: 1, anchor: 1 });
    const ct = mkCT({ 0: { pts: [[0, 0, 0], [0.25, 1, 0], [1, 0, 0]], start: 1 } }, cp);
    const { S, proc } = setup({ cp, ct, n: 0 });
    for (const beat of [0, 3.3, 17.81]) {
      proc.songBeat = () => beat;
      S.begin(proc, 256);
      const c = proc.sx.nCh - 1, b = beat + c * (proc.CH / proc.fs) * 2;
      const want = (0.25 + b) % 1;
      assert.ok(Math.abs(proc.sx.mod.oPh[0] - want) < 1e-9, `beat ${beat}: ${proc.sx.mod.oPh[0]} vs ${want}`);
    }
    proc.songBeat = () => null;                             // stopped: the processor beat clock carries on
    const b0 = proc.sx.mod.beatClk;
    S.begin(proc, 256);
    assert.ok(Math.abs(proc.sx.mod.beatClk - (b0 + 32 * (proc.CH / proc.fs) * 2)) < 1e-9);
  }
  // Env mode: one pass, holds y(1); with a loop point: loops while gated, runs out after note-off
  {
    const cp = lfoCP(0, 1, { 'l1.rate': 0.6 });
    const ct = mkCT({ 0: { pts: [[0, 0, 0], [0.5, 1, 0], [1, 0.3, 0]], loop: -1 } }, cp);
    const { S, proc, vs: [v] } = setup({ cp, ct });
    proc.sx.mon = 1;
    v.noteOn(60, 1, false, 1);
    run(S, proc, [v], spansOf(0.5));
    assert.equal(v.mod.lPh[0], 1);
    assert.ok(Math.abs(S.snapshot(proc).lfoOut[0] - 0.3) < 1e-6, 'holds y(1)');
    const cp2 = lfoCP(0, 1, { 'l1.rate': 0.6 });
    const ct2 = mkCT({ 0: { pts: [[0, 0, 0], [0.5, 1, 0], [1, 0.3, 0]], loop: 1 } }, cp2);
    const q = setup({ cp: cp2, ct: ct2 });
    q.proc.sx.mon = 1;
    q.vs[0].noteOn(60, 1, false, 1);
    let minPh = 1;
    run(q.S, q.proc, q.vs, spansOf(1), { each: (s) => { if (s > spansOf(0.3)) minPh = Math.min(minPh, q.vs[0].mod.lPh[0]); } });
    assert.ok(minPh >= 0.5 && q.vs[0].mod.lPh[0] < 1, 'loops between the loop point and the end while gated');
    q.vs[0].noteOff();
    run(q.S, q.proc, q.vs, spansOf(0.3));
    assert.equal(q.vs[0].mod.lPh[0], 1, 'runs out after note-off');
  }
  // delay 0.1 s then rise 0.2 s; smooth τ = 0.5·smooth³; rate 0 holds
  {
    const cp = lfoCP(0, 0, { 'l1.rate': 0, 'l1.delay': 0.1 / 4, 'l1.rise': 0.2 / 4 }, [{ src: 'lfo1', dst: 'f.res', amt: 0.1 }]);
    const ct = mkCT({ 0: { pts: [[0, 0.2, 0], [0.001, 1, 0], [0.5, 1, 0], [1, 1, 0]], start: 2 } }, cp);
    const { S, proc, vs: [v] } = setup({ cp, ct });
    v.noteOn(60, 1, false, 1);
    const tr = [];
    const N = 128 * proc.OS, b = new Float64Array(N);
    let t = 0;
    for (let s = 0; s < spansOf(0.5); s++) { S.begin(proc, N); for (let c = 0; c < 32; c++) { v.render(b, b, proc.CH); tr.push([t, v.src[5]]); t += 4 / 48000; } }
    for (const [tt, y] of tr) {
      const want = tt < 0.1 ? 0.2 : tt < 0.3 ? 0.2 + 0.8 * (tt - 0.1) / 0.2 : 1;
      assert.ok(Math.abs(y - want) < 1e-9 + 0.8 * 4 / 48000 / 0.2, `delay/rise at ${tt.toFixed(4)}: ${y} vs ${want}`);
    }
    assert.equal(v.mod.lPh[0], 0.5, 'rate 0 holds the phase');
    const sm = 0.6, tau = 0.5 * sm ** 3;
    const cps = lfoCP(0, 0, { 'l1.rate': 0, 'l1.delay': 0.1 / 4, 'l1.smooth': sm }, [{ src: 'lfo1', dst: 'f.res', amt: 0.1 }]);
    const cts = mkCT({ 0: { pts: [[0, 0, 0], [0.001, 1, 0], [0.5, 1, 0], [1, 1, 0]], start: 2 } }, cps);
    const w = setup({ cp: cps, ct: cts });
    w.vs[0].noteOn(60, 1, false, 1);
    const tr2 = [];
    t = 0;
    for (let s = 0; s < spansOf(0.6); s++) { w.S.begin(w.proc, N); for (let c = 0; c < 32; c++) { w.vs[0].render(b, b, w.proc.CH); tr2.push([t, w.vs[0].src[5]]); t += 4 / 48000; } }
    const hit = tr2.find(([tt, y]) => tt > 0.1 && y >= 1 - Math.exp(-1));
    assert.ok(Math.abs(hit[0] - 0.1 - tau) <= 0.1 * tau, `smooth τ ${hit[0] - 0.1} vs ${tau}`);
  }
});

/* ------------------------------------------------------------------ envelopes (§6.10, §10.4.16) */

test('envelopes: linear attack at curve 0.5, decay curve, curve rows, sustain law, envT, release (§10.4.16)', () => {
  const att = Math.pow(0.5 / 32, 0.2);
  const trace = (p, rows = [], sec = 1) => {
    const { S, proc, vs: [v] } = setup({ cp: mkCP(p, rows) });
    v.noteOn(60, 1, false, 1);
    const tr = [];
    const N = 128 * proc.OS, b = new Float64Array(N);
    let t = 0;
    for (let s = 0; s < spansOf(sec); s++) { S.begin(proc, N); for (let c = 0; c < 32; c++) { tr.push([t, v.eV[0], v.mod.eSt[0], v.mod.eT[0], v.eV[1]]); v.render(b, b, proc.CH); t += 4 / 48000; } }
    return { tr, v, S, proc };
  };
  const at = (tr, t, k = 1) => tr.reduce((a, r) => (Math.abs(r[0] - t) < Math.abs(a[0] - t) ? r : a))[k];
  const a = trace({ 'e1.att': att, 'e1.ca': 0.5 }).tr;
  assert.ok(Math.abs(at(a, 0.25) - 0.5) <= 0.02, 'linear attack mid value ' + at(a, 0.25));
  assert.ok(Math.abs(at(a, 0.25, 3) - 0.25) < 1e-3 && at(a, 0.25, 2) === 1, 'envT counts seconds into the attack');
  const b = trace({ 'e1.att': att, 'e1.ca': 0.5 }, [{ src: 'fixed', dst: 'e1.ca', amt: 0.4 }]).tr;
  assert.ok(at(b, 0.25) > 0.9, 'a Fixed → e1.ca row bends the attack: ' + at(b, 0.25));
  const dec = Math.pow(0.5 / 32, 0.2);
  const d = trace({ 'e1.att': 0, 'e1.dec': dec, 'e1.sus': 0, 'e1.cd': 0.666 }).tr;
  assert.ok(at(d, 0.25) < 0.5 - 0.1, 'decay with curve 0.666 is below linear at half time: ' + at(d, 0.25));
  const dl = trace({ 'e1.att': 0, 'e1.dec': dec, 'e1.sus': 0, 'e1.cd': 0.5 }).tr;
  assert.ok(Math.abs(at(dl, 0.25) - 0.5) < 0.02, 'linear decay');
  // sustain: ENV 1 amplitude n², ENV 2 linear; hold stage at 1
  const s = trace({ 'e1.att': 0, 'e1.dec': 0.1, 'e1.sus': 0.5, 'e2.att': 0, 'e2.dec': 0.1, 'e2.sus': 0.5, 'e1.hold': Math.pow(0.1 / 32, 0.2) }, [], 0.6);
  assert.ok(Math.abs(at(s.tr, 0.05) - 1) < 1e-12 && at(s.tr, 0.05, 2) === 2, 'hold stage');
  assert.ok(Math.abs(at(s.tr, 0.5) - 0.25) < 1e-9 && at(s.tr, 0.5, 2) === 4, 'ENV 1 sustain = n²');
  assert.ok(Math.abs(at(s.tr, 0.5, 4) - 0.5) < 1e-9, 'ENV 2 sustain linear');
  // release from the current level along the release curve
  s.v.noteOff();
  assert.equal(s.v.mod.eSt[0], 5);
  const r = run(s.S, s.proc, [s.v], 1);
  assert.ok(s.v.eV[0] < 0.25 && s.v.eV[0] > 0, 'releasing from 0.25');
  assert.ok(r.L.every(Number.isFinite));
});

/* ------------------------------------------------------------------ chaos (§6.13, §10.4.21) */

test('chaos: bounded at the maximum rate, deterministic, BPM snaps the S&H period to the straight ladder (§10.4.21)', () => {
  // mono generators (begin only): 60 s at rate 1000 Hz
  const mono = () => {
    const cp = mkCP({ 'c1.rate': 1, 'c2.rate': 1 }, [], { chaosMono: Uint8Array.from([1, 1]) });
    const { S, proc } = setup({ cp, n: 0, OS: 1 });
    const out = [];
    for (let s = 0; s < spansOf(60); s++) {
      S.begin(proc, 128);
      if (s % 50 === 0) out.push(proc.sx.mod.g[17 * 32 + 5], proc.sx.mod.g[18 * 32 + 9]);
      for (let c = 0; c < 32; c++) { const a = proc.sx.mod.g[17 * 32 + c], b = proc.sx.mod.g[18 * 32 + c]; if (!(Math.abs(a) <= 1 && Math.abs(b) <= 1)) assert.fail('chaos out of range'); }
    }
    return out;
  };
  const m1 = mono(), m2 = mono();
  assert.deepEqual(m1, m2, 'deterministic');
  assert.ok(new Set(m1.map((x) => x.toFixed(3))).size > 50, 'moving');
  // per voice (oscillators off), rows read both chaos sources
  const cp = mkCP({ 'c1.rate': 1, 'c2.rate': 1, 'a.on': 0 }, [{ src: 'chaos1', dst: 'f.res', amt: 0.1 }, { src: 'chaos2', dst: 'f.var', amt: 0.1 }]);
  const { S, proc, vs: [v] } = setup({ cp, OS: 1 });
  v.noteOn(60, 1, false, 1);
  let mx = 0;
  run(S, proc, [v], spansOf(10), { each: () => { mx = Math.max(mx, Math.abs(v.src[17]), Math.abs(v.src[18])); } });
  assert.ok(mx <= 1 && mx > 0.2);
  // S&H + BPM: 2.3 Hz snaps to 2 Hz (1/4 at 120 BPM) → updates every 0.5 s
  const n = Math.pow(2.3 / 1000, 0.2);
  const cps = mkCP({ 'c1.rate': n, 'c1.bpm': 1 }, [], { chaosMono: Uint8Array.from([1, 0]), chaosSh: Uint8Array.from([1, 0]) });
  const q = setup({ cp: cps, n: 0, OS: 1 });
  const changes = [];
  let prev = null, t = 0;
  for (let s = 0; s < spansOf(3); s++) {
    q.S.begin(q.proc, 128);
    for (let c = 0; c < 32; c++) { const y = q.proc.sx.mod.g[17 * 32 + c]; if (prev !== null && y !== prev) changes.push(t); prev = y; t += 4 / 48000; }
  }
  const gaps = changes.slice(1).map((x, i) => x - changes[i]);
  assert.ok(gaps.length >= 4 && gaps.every((g) => Math.abs(g - 0.5) <= 4 / 48000 + 1e-9), 'S&H every 0.5 s: ' + gaps);
});

/* ------------------------------------------------------------------ noise (§6.8, §10.4.22) */

test('noise: keytrack doubles the rate per octave, PITCH law, one-shot end → zeros, seamless loop, band-limited levels (§10.4.22)', () => {
  const sawCycle = sawFrame().map((x) => 0.5 * x);
  const tbl = { 'noise:White': cycleNoise(sawCycle) };
  const play = (note, p = {}, extra = {}, sec = 0.6, OS = 2) => {
    const cp = mkCP({ 'a.on': 0, 'n.on': 1, 'n.level': 1, 'n.rand': 0, ...p }, [], { noiseKey: 1, ...extra });
    const { S, proc, vs: [v] } = setup({ cp, tables: tbl, OS });
    v.noteOn(note, 1, false, 1);
    return { ...run(S, proc, [v], spansOf(sec)), fs: proc.fs, v };
  };
  const f60 = peakFreq(play(60).L.subarray(16384, 16384 + 32768), 96000, 200, 330);
  const f72 = peakFreq(play(72).L.subarray(16384, 16384 + 32768), 96000, 420, 620);
  assert.ok(Math.abs(f60 / 261.6256 - 1) < 1e-3, 'root note plays at the root pitch: ' + f60);
  assert.ok(Math.abs(f72 / f60 - 2) < 0.005, 'keytrack: an octave doubles the rate');
  // keytrack off: PITCH +48 st (n 1) = ×16, independent of the note
  const k0 = peakFreq(play(40, { 'n.pitch': 0.75 }, { noiseKey: 0 }).L.subarray(16384, 16384 + 32768), 96000, 1000, 1200);
  assert.ok(Math.abs(k0 / (261.6256 * 4) - 1) < 1e-3, 'keytrack off, +24 st: ' + k0);
  // band-limited levels: saw cycle at notes 60 and 84, fs 96 kHz → alias ≤ −50 dBc
  for (const note of [60, 84]) {
    const { L } = play(note, {}, {}, 0.9);
    const f0 = 261.6256 * Math.pow(2, (note - 60) / 12);
    const { dbc, at } = aliasDbc(L, L.length - 65536, 96000, 48000, f0);
    assert.ok(dbc <= -50, `noise note ${note}: alias ${dbc.toFixed(1)} dBc at ${at.toFixed(0)} Hz`);
  }
  // loop seam: a sine cycle loops without a click (max step = the sine's own slope)
  {
    const cp = mkCP({ 'a.on': 0, 'n.on': 1, 'n.level': 1, 'n.rand': 0, 'n.phase': 0.3, 'e1.att': 0 }, [], { noiseKey: 1 });
    const { S, proc, vs: [v] } = setup({ cp, tables: { 'noise:White': cycleNoise(frame((p) => 0.5 * Math.sin(2 * Math.PI * p))) } });
    v.noteOn(60, 1, false, 1);
    const { L } = run(S, proc, [v], spansOf(0.3));
    const slope = 0.5 * 2 * Math.PI * 261.6256 / 96000;
    assert.ok(maxStep(L, proc.CH) <= 1.02 * slope && maxAbs(L, 4000) > 0.49, `seam: ${maxStep(L, proc.CH)} vs ${slope}`);
  }
  // one-shot: a 0.05 s burst ends in exact zeros
  const burst = Float32Array.from({ length: 2400 }, (_, i) => Math.sin(i * 0.3) * 0.5);
  const os = setup({ cp: mkCP({ 'a.on': 0, 'n.on': 1, 'n.level': 1, 'n.pitch': 0.5 }, [], { noiseOneshot: 1 }), tables: { 'noise:White': noiseFrom(burst, null, { loop: false }) } });
  os.vs[0].noteOn(60, 1, false, 1);
  const o = run(os.S, os.proc, os.vs, spansOf(0.2));
  assert.ok(maxAbs(o.L, 0, 4000) > 0.1, 'burst audible');
  assert.ok(o.L.subarray(Math.ceil(0.06 * 96000)).every((x) => x === 0), 'zeros after the end');
  assert.equal(os.S.snapshot(os.proc).noisePos >= 1, true);
  // looping version keeps sounding
  const lo = setup({ cp: mkCP({ 'a.on': 0, 'n.on': 1, 'n.level': 1, 'n.pitch': 0.5 }), tables: { 'noise:White': noiseFrom(burst, null) } });
  lo.vs[0].noteOn(60, 1, false, 1);
  assert.ok(maxAbs(run(lo.S, lo.proc, lo.vs, spansOf(0.2)).L, Math.ceil(0.1 * 96000)) > 0.1, 'loop keeps sounding');
});

/* ------------------------------------------------------------------ fxMods, snapshot (§5.5, §8.4.4, §10.4.15) */

test('fxMods: Env1 → fx.fil.cutoff while the recent voice sounds; snapshot eff follows LFO → cutoff; no sx → null (§10.4.15)', () => {
  const fxp = fxpV2(loadFixture('fxp-default.json')), K = fxk('fx.fil.cutoff');
  const cp = mkCP({ 'e1.att': 0, 'e1.rel': 0.3 }, [{ src: 'env1', dst: 'fx.fil.cutoff', amt: 0.5 }, { src: 'lfo1', dst: 'f.cutoff', amt: 0.3 }]);
  const { S, proc, vs: [v] } = setup({ cp, fxp });
  assert.equal(S.snapshot({}), null);
  const o0 = S.fxMods(proc);
  assert.equal(o0.length, MAXFX);
  v.noteOn(60, 1, false, 1);
  const effs = [];
  run(S, proc, [v], 40, { each: (s) => { if (s > 1) effs.push(S.snapshot(proc).eff[42]); } });
  const off = S.fxMods(proc);
  assert.equal(off, o0, 'reused array');
  assert.ok(Math.abs(off[K] - 0.5) < 1e-9, `Env1 (sustain 1) × 0.5 at FX-ctx index ${K}: ` + off[K]);
  assert.ok(off.every((x, k) => k === K || x === 0));
  const sn = S.snapshot(proc);
  assert.ok(Math.abs(sn.eff[NSV + K] - Math.min(1, fxp.base[K] + 0.5)) < 1e-6, 'snapshot FX eff = base + offset (FX-ctx order after the 429 vi)');
  assert.ok(Math.max(...effs) - Math.min(...effs) > 0.1, 'eff[42] follows the LFO');
  v.noteOff();
  run(S, proc, [v], 60);
  assert.ok(Math.abs(S.fxMods(proc)[K]) < 1e-4, 'back to 0 after the release');
  // snapshot shape and counters
  assert.equal(sn.envStage.length, 4);
  assert.equal(sn.tapRate, proc.fs);
  assert.ok(sn.maxVoices === 8 * 16 && sn.oscVoices >= 0);
});

/* ------------------------------------------------------------------ hooks (§6.16, §10.4.23) */

test('hooks: transport makes renders repeatable; idle advances like rendering; reset restores the attach state (§10.4.23)', () => {
  const cp = mkCP({ 'a.uni': grid('a.uni', 3), 'c2.rate': 0.4 },
    [{ src: 'lfo1', dst: 'f.cutoff', amt: 0.3 }, { src: 'alt1', dst: 'a.semi', amt: 0.2, bi: 1 }, { src: 'chaos2', dst: 'a.fine', amt: 0.2 },
      { src: 'rand1', dst: 'a.level', amt: 0.1 }], { chaosMono: Uint8Array.from([0, 1]) });
  cp.base[DI['f.on']] = 1;
  const { S, proc, vs: [v] } = setup({ cp });
  let beat = null;                                           // song position of a playing transport (beats)
  proc.songBeat = () => beat;
  const span = (k) => run(S, proc, [v], k, { each: () => { if (beat !== null) beat += 128 / 48000 * 2; } });
  const take = () => {
    beat = 4;                                                // play with seek to beat 4
    S.transport(proc, true);
    v.noteOn(60, 0.8, false, 1);
    const a = span(40).L.slice();
    v.noteOn(64, 0.8, false, 1);
    const b = span(20).L.slice();
    v.kill();
    span(30);
    beat = null;
    S.transport(proc, false);
    return Float64Array.from([...a, ...b]);
  };
  span(17);
  const r1 = take();
  span(33);
  const r2 = take();
  assert.ok(maxAbs(r1) > 0.1);
  sameArr(r1, r2, 'repeatable after transport');
  // idle ≡ begin for the Off LFO, beat clock, mono chaos and smoothers
  const mk = () => setup({ cp: mkCP({}, [{ src: 'chaos1', dst: 'l1.rate', amt: 0.1 }], { chaosMono: Uint8Array.from([1, 0]) }), n: 0 });
  const A = mk(), B = mk();
  for (let s = 0; s < 300; s++) { A.S.begin(A.proc, 256); B.S.idle(B.proc, 128); }
  for (let l = 0; l < 8; l++) assert.ok(Math.abs(A.proc.sx.mod.oPh[l] - B.proc.sx.mod.oPh[l]) < 1e-9);
  assert.ok(Math.abs(A.proc.sx.mod.beatClk - B.proc.sx.mod.beatClk) < 1e-9);
  assert.deepEqual(Array.from(A.proc.sx.mod.mch), Array.from(B.proc.sx.mod.mch));
  // reset restores every sx field to its attach state (the host's monitor flag survives)
  proc.sx.mon = 1;
  S.reset(proc);
  const fresh = S.attach(makeProc());
  const noFn = (x) => JSON.parse(JSON.stringify(x, (key, v) => (typeof v === 'function' ? undefined : ArrayBuffer.isView(v) ? Array.from(v) : v)));
  for (const k of Object.keys(fresh)) {
    if (k === 'snap' || k === 'mon') continue;
    assert.deepEqual(k === 'mod' ? noFn(proc.sx[k]) : proc.sx[k], k === 'mod' ? noFn(fresh[k]) : fresh[k], 'reset restores ' + k);
  }
  assert.equal(proc.sx.mon, 1);
});

/* ------------------------------------------------------------------ performance destinations, note-on, voices (§10.4.24–28) */

test('performance destinations: Fixed → g.wheel / g.bend add to the host values in the mono context (§10.4.24)', () => {
  const at = (proc, src) => proc.sx.mod.g[src * 32 + proc.sx.nCh - 1];
  const { S, proc } = setup({ cp: mkCP({}, [{ src: 'fixed', dst: 'g.wheel', amt: 0.5 }, { src: 'fixed', dst: 'g.bend', amt: 0.25 }]), n: 0 });
  proc.wheel = 0.3; proc.bendRaw = 0;
  for (let s = 0; s < 20; s++) S.begin(proc, 256);
  assert.ok(Math.abs(at(proc, 1) - 0.8) < 1e-9, 'wheel 0.3 + 0.5');
  assert.ok(Math.abs(at(proc, 28) - 0.5) < 1e-9, 'bend 0 → 2·(0.5 + 0.25) − 1');
  proc.wheel = 0.8; proc.bendRaw = 0.8;
  for (let s = 0; s < 20; s++) S.begin(proc, 256);
  assert.equal(at(proc, 1), 1, 'clamped');
  assert.equal(at(proc, 28), 1, 'clamped');
  // without rows: the smoothed host values; a G row is evaluated in the mono context only (voices ignore it)
  const q = setup({ cp: mkCP(), n: 0 });
  q.proc.wheel = 0.4; q.proc.at = 0.6; q.proc.bendRaw = -0.5;
  for (let s = 0; s < 20; s++) q.S.begin(q.proc, 256);
  assert.ok(Math.abs(at(q.proc, 1) - 0.4) < 1e-9 && Math.abs(at(q.proc, 15) - 0.6) < 1e-9 && Math.abs(at(q.proc, 28) + 0.5) < 1e-9);
});

test('note-on evaluation: velocity → unison count, NoteOn Rand → start phase (§10.4.25)', () => {
  const nOf = (vel) => {
    const { S, proc, vs: [v] } = setup({ cp: mkCP({}, [{ src: 'velo', dst: 'a.uni' }]) });
    v.noteOn(60, vel, false, 1);
    run(S, proc, [v], 1);
    return v.uN[0];
  };
  assert.equal(nOf(1), 16);
  assert.equal(nOf(0), 1);
  assert.equal(nOf(0.5), 9);
  const starts = () => {
    const { S, proc, vs: [v] } = setup({ cp: mkCP({ 'a.rand': 0, 'a.phase': 0 }, [{ src: 'rand1', dst: 'a.phase' }]) });
    const ph = [];
    for (let k = 0; k < 4; k++) { v.noteOn(60, 1, false, 1); ph.push(v.uPh[0]); v.kill(); }
    return ph;
  };
  const p1 = starts(), p2 = starts();
  assert.deepEqual(p1, p2, 'identical for identical seeds');
  assert.equal(new Set(p1).size, 4, 'a different start phase per note');
});

test('poly legato copies the gated voice\'s envelope; poly AT; release velocity (§10.4.26–28)', () => {
  for (const legato of [1, 0]) {
    const { S, proc, vs: [a, b] } = setup({ cp: mkCP({ 'e1.att': 0.3, 'e1.dec': 0.4, 'e1.sus': 0.8 }, [], { legato }), n: 2 });
    a.stamp = 1; a.noteOn(60, 1, false, 1);
    run(S, proc, [a, b], 30);
    b.stamp = 2; b.noteOn(64, 1, false, 1);
    if (legato) {
      assert.equal(b.mod.eSt[0], a.mod.eSt[0]);
      assert.ok(Math.abs(b.eV[0] - a.eV[0]) < 1e-12 && b.eV[0] > 0.3, 'starts at the gated voice\'s level');
    } else {
      assert.equal(b.eV[0], 0);
      assert.equal(b.mod.eSt[0], 1);
    }
  }
  // poly AT: channel AT until poly pressure arrives, then per note
  const cp = mkCP({}, [{ src: 'pat', dst: 'f.res', amt: 0.5 }]);
  const { S, proc, vs: [x, y] } = setup({ cp, n: 2 });
  x.noteOn(60, 1, false, 1); y.noteOn(67, 1, false, 1);
  proc.at = 0.4;
  run(S, proc, [x, y], 30);
  assert.ok(Math.abs(x.src[16] - 0.4) < 1e-9 && Math.abs(y.src[16] - 0.4) < 1e-9, 'pat = AT before any poly pressure');
  proc.pat[60] = 0.7; proc.patSeen = true;
  run(S, proc, [x, y], 30);
  assert.ok(Math.abs(x.src[16] - 0.7) < 1e-9, 'note 60 reads its poly pressure');
  assert.ok(Math.abs(y.src[16]) < 1e-9, 'note 67 reads its own (0)');
  // release velocity via relvel → f.cutoff
  const rv = (arg) => {
    const q = setup({ cp: mkCP({ 'f.cutoff': 0.2, 'e1.rel': 0.6 }, [{ src: 'relvel', dst: 'f.cutoff', amt: 0.5 }]) });
    q.vs[0].noteOn(60, 1, false, 1);
    run(q.S, q.proc, q.vs, 2);
    const before = q.S.snapshot(q.proc).eff[42];
    if (arg === undefined) q.vs[0].noteOff(); else q.vs[0].noteOff(arg);
    run(q.S, q.proc, q.vs, 2);
    return [before, q.S.snapshot(q.proc).eff[42]];
  };
  const [b0, r2] = rv(0.2), [, r5] = rv();
  assert.ok(Math.abs(b0 - 0.45) < 1e-6, 'relvel 0.5 before note-off');
  assert.ok(Math.abs(r2 - 0.3) < 1e-6, 'noteOff(0.2)');
  assert.ok(Math.abs(r5 - 0.45) < 1e-6, 'noteOff() → 0.5');
});

/* ------------------------------------------------------------------ lifecycle (§8.4.2–3, §10.4.18) */

test('attach / begin / fxMods / snapshot: shapes, idempotence, span bookkeeping, base snapshot before any note', () => {
  const { SerumDSP: S } = loadDSP();
  const proc = makeProc();
  assert.equal(S.snapshot(proc), null, 'no sx → null');
  const sx = S.attach(proc);
  assert.equal(proc.sx, sx);
  assert.equal(S.attach(proc), sx, 'idempotent');
  const g = sx.mod.g;
  S.attach(proc);
  assert.equal(sx.mod.g, g, 'no reallocation');
  assert.equal(g.length, NSRC2 * 32);
  for (const [k, n] of [['monoSrc', NSRC2], ['monoOff', NSV], ['monoEff', NSV], ['fxOff', MAXFX], ['beatC', 32], ['macro', 8]]) assert.equal(sx.mod[k].length, n, k);
  assert.equal(sx.tap.length, 1024);
  const off = S.fxMods(proc);
  assert.equal(off[Symbol.toStringTag], 'Float64Array');
  assert.equal(off.length, MAXFX);
  assert.equal(S.fxMods(proc), off, 'reused');
  assert.ok(off.every((v) => v === 0));
  S.begin(proc, 256);
  assert.equal(sx.span, 1); assert.equal(sx.nCh, 32);
  S.begin(proc, 16);
  assert.equal(sx.span, 2); assert.equal(sx.nCh, 2);
  // a patch: snapshot shows the bases until a note plays; FX eff = FXP base (+ offsets) clamped
  const cp = mkCP({ 'f.cutoff': 0.25 }), fxp = fxpV2(loadFixture('fxp-default.json'));
  proc.p = { serum: cp, fxr: fxp };
  S.begin(proc, 256);
  const snap = S.snapshot(proc);
  assert.equal(S.snapshot(proc), snap, 'reused object');
  const lens = { eff: NSV + MAXFX, lfoPh: 10, lfoOut: 10, lfoY: 10, env: 4, envStage: 4, envT: 4, wtPos: 3, memNow: 48, filtTap: 2048 };
  for (const [k, n] of Object.entries(lens)) assert.equal(snap[k].length, n, k);
  for (const k of ['noisePos', 'notes', 'oscVoices', 'maxVoices', 'tapRate']) assert.equal(typeof snap[k], 'number', k);
  assert.equal(snap.eff[42], 0.25);
  for (let k = 0; k < MAXFX; k++) assert.equal(snap.eff[NSV + k], Math.fround(k < fxp.base.length ? fxp.base[k] : 0));
  assert.equal(snap.maxVoices, 8 * 16, 'poly 8 × (16 · A on)');
  // a CP with another major version: begin is bookkeeping only, voices stay silent
  proc.p = { serum: { ...cp, ver: 3 }, fxr: null };
  S.begin(proc, 256);
  assert.equal(sx.ok, 0);
  assert.ok(S.fxMods(proc).every((v) => v === 0));
});

test('SerumVoice: engine fields, reserved names, version guard (warn once, silent), render adds into the buffers', () => {
  const con = mkConsole();
  const ctx = vm.createContext({ console: con });
  const { S, proc, vs: [v] } = setup({ ctx });
  assert.ok(proc.sx, 'constructor attaches');
  const w = new S.SerumVoice(proc, 3);
  assert.deepEqual([w.active, w.gate, w.note, w.stamp, w.sus, w.vel], [false, false, -1, 0, false, 0]);
  for (const k of ['det', 'pitch', 'target', 'glc']) assert.equal(Object.prototype.hasOwnProperty.call(v, k), false, k);
  v.noteOn(60, 0.8, false, 1);
  assert.deepEqual([v.active, v.gate, v.note, v.vel], [true, true, 60, 0.8]);
  assert.equal(proc.sx.mod.recent, v);
  for (const k of ['det', 'pitch', 'target', 'glc']) assert.equal(Object.prototype.hasOwnProperty.call(v, k), false, k);
  const L = new Float64Array(256).fill(0.5), R = new Float64Array(256).fill(-0.5);
  S.begin(proc, 256);
  v.render(L, R, 256);
  const l2 = new Float64Array(256), r2 = new Float64Array(256);
  const { S: S2, proc: p2, vs: [u] } = setup();
  u.noteOn(60, 0.8, false, 1);
  S2.begin(p2, 256);
  u.render(l2, r2, 256);
  for (let i = 0; i < 256; i++) { assert.equal(L[i], 0.5 + l2[i]); assert.equal(R[i], -0.5 + r2[i]); }
  assert.ok(maxAbs(l2) > 0.01);
  v.noteOff(0.2);
  assert.equal(v.gate, false); assert.equal(v.mod.relvel, 0.2);
  v.noteOn(61, 1, false, 1); v.noteOff();
  assert.equal(v.mod.relvel, 0.5);
  v.kill();
  assert.equal(v.active, false);
  // another major version: warn once, stay silent/inactive
  const x = new S.SerumVoice(proc, 4);
  x.apply({ serum: { ...mkCP(), ver: 1 } });
  x.apply({ serum: { ...mkCP(), ver: 3 } });
  x.noteOn(60, 1, false, 1);
  assert.equal(x.active, false);
  assert.equal(con.msgs.filter((m) => m.level === 'warn' && m.text.includes('CP version')).length, 1);
});

test('lifecycle: note-on before begin, equal re-applies, OS change mid-note, renders without begin, direct bus (§10.4.18)', () => {
  // noteOn on a voice of a fresh processor before any begin: renders (extra-render rule), then normally
  {
    const { S, proc, vs: [v] } = setup();
    v.noteOn(60, 1, false, 1);
    const b = new Float64Array(256), c = new Float64Array(256);
    assert.doesNotThrow(() => v.render(b, c, 256));
    assert.ok(b.every(Number.isFinite) && maxAbs(b) > 0.001);
    assert.ok(maxAbs(run(S, proc, [v], 2).L) > 0.1);
  }
  // 100 applies of fresh, equal CP objects keep everything (Off LFO, alt flip-flop, smoothers): identical output
  const mk = () => mkCP({ 'f.on': 1, 'f.cutoff': 0.4, 'a.uni': grid('a.uni', 4) }, [{ src: 'lfo1', dst: 'f.cutoff', amt: 0.3 }, { src: 'alt1', dst: 'a.semi', amt: 0.1, bi: 1 }]);
  const play = (reapply) => {
    const { S, proc, vs: [v] } = setup({ cp: mk() });
    v.noteOn(60, 1, false, 1);
    const a = run(S, proc, [v], 10).L.slice();
    if (reapply) for (let k = 0; k < 100; k++) { proc.p = { serum: mk(), fxr: null }; v.apply(proc.p); }
    if (reapply === 2) for (let k = 0; k < 10; k++) v.apply(proc.p);
    const b = run(S, proc, [v], 10).L.slice();
    v.noteOn(62, 1, false, 1);
    const c = run(S, proc, [v], 10).L.slice();
    return Float64Array.from([...a, ...b, ...c]);
  };
  const ref = play(0);
  sameArr(play(1), ref, '100 equal applies');
  sameArr(play(2), ref, 're-applying the identical CP object');
  // OS 2 → 4 mid-note: continuous, same pitch
  {
    const { S, proc, vs: [v] } = setup({ cp: mkCP({ 'a.rand': 0 }), tables: { 'factory:Default': SINE } });
    v.noteOn(69, 1, false, 1);
    const a = run(S, proc, [v], 20).L;
    Object.assign(proc, { OS: 4, fs: 192000, CH: 16 });
    v.apply(proc.p);
    const b = run(S, proc, [v], spansOf(0.8)).L;
    assert.ok(b.every(Number.isFinite));
    assert.ok(Math.abs(peakFreq(b.subarray(b.length - 65536), 192000, 420, 460) - 440) <= 0.05);
    assert.ok(Math.abs(b[0] - a[a.length - 1]) < 0.05, 'continuous across the OS change');
  }
  // 36 chunks in two calls (32 + 4) without begin: finite and click-free
  {
    const { S, proc, vs: [v] } = setup({ cp: mkCP({ 'a.uni': grid('a.uni', 2), 'f.on': 1 }, [{ src: 'lfo1', dst: 'f.cutoff', amt: 0.2 }]) });
    v.noteOn(60, 1, false, 1);
    const pre = run(S, proc, [v], 20).L;
    const steady = maxStep(pre, pre.length - 2000);
    const CH = proc.CH, x = new Float64Array(36 * CH), y = new Float64Array(36 * CH), t1 = new Float64Array(32 * CH), t2 = new Float64Array(4 * CH);
    v.render(t1, new Float64Array(32 * CH), 32 * CH);
    v.render(t2, new Float64Array(4 * CH), 4 * CH);
    x.set(t1); x.set(t2, 32 * CH);
    const j = Float64Array.from([...pre.subarray(pre.length - 64), ...x]);
    assert.ok(j.every(Number.isFinite) && maxStep(j) <= 2 * steady, `extra renders: step ${maxStep(j)} vs ${steady}`);
    void y;
  }
  // direct out: sub with DIRECT → bufL/bufR without a direct pair, dirL/dirR (main excludes it) with one
  {
    const cp = mkCP({ 'a.on': 0, 's.on': 1, 'f.on': 1, 'f.routeS': 1 }, [], { subDirect: 1, direct: 1 });
    const tables = { 'factory:Default': SAW, ...SUBS };
    const a = setup({ cp, tables }), b = setup({ cp: mkCP({ 'a.on': 0, 's.on': 1, 'f.on': 1, 'f.routeS': 1 }, [], { subDirect: 1, direct: 1 }), tables });
    a.vs[0].noteOn(48, 1, false, 1); b.vs[0].noteOn(48, 1, false, 1);
    const ra = run(a.S, a.proc, a.vs, 10), rb = run(b.S, b.proc, b.vs, 10, { dir: true });
    assert.ok(maxAbs(ra.L) > 0.1, 'direct source in the main bus without dirL/dirR');
    assert.equal(maxAbs(rb.L), 0, 'main bus excludes the direct source');
    sameArr(rb.DL, ra.L, 'direct pair = what the main bus carried');
    // not direct: the routed sub is filtered (MG Low 12 at 425 Hz changes it)
    const c = setup({ cp: mkCP({ 'a.on': 0, 's.on': 1, 'f.on': 1, 'f.routeS': 1 }), tables });
    c.vs[0].noteOn(48, 1, false, 1);
    const rc = run(c.S, c.proc, c.vs, 10);
    assert.ok(maxAbs(rc.L.map((x2, i) => x2 - ra.L[i])) > 1e-3);
  }
});

/* ------------------------------------------------------------------ allocation-free hot paths (§10.1, §10.4.19) */

test('allocation-free: 1 s of a busy patch through begin / render / fxMods / snapshot (§10.4.19)', () => {
  // warped at OS 2; unwarped at OS 1 (fused two-level reads, frame-pair crossfades, a steal that drops unison voices)
  for (const [OS, warped] of [[2, 1], [1, 0]]) {
    const cp = mkCP({ 'a.uni': 1, 'b.on': 1, 'n.on': 1, 's.on': 1, 'f.on': 1, 'a.warpMode': warped ? 18 / 22 : 0, 'a.warp': 0.4,
      'b.warpMode': warped ? 4 / 22 : 0, 'b.warp': 0.6, 'a.det': 0.5, 'b.det': 0.5, 'l1.rate': 0.4, 'l2.rate': 0.5, 'l3.rate': 0.45, 'c1.rate': 0.5, 'c2.rate': 0.5,
      'n.pitch': 0.6, 'b.uni': warped ? 1 : 0 },
    [{ src: 'lfo1', dst: 'f.type', amt: 1 }, { src: 'lfo2', dst: 'a.wt', amt: 0.5 }, { src: 'lfo3', dst: 'f.cutoff', amt: 0.3, bi: 1 },
      { src: 'fixed', dst: 'bus1', amt: 0.3 }, { src: 'chaos1', dst: 'a.fine', amt: 0.2 }, { src: 'chaos2', dst: 'b.fine', amt: 0.2 },
      { src: 'env2', dst: 'fx.fil.cutoff', amt: 0.4 }, { src: 'noise', dst: 'f.res', amt: 0.1 }, { src: 'lfo1', dst: 'n.pitch', amt: 0.3, bi: 1 },
      { src: 'velo', dst: 'b.uni' }, { src: 'lfo1', dst: 'a.semi', amt: 0.5, bi: 1 }],
    { subDirect: 1, direct: 1, chaosMono: Uint8Array.from([1, 0]), wt: ['tbl:interp', 'factory:Default'] });
    cp.lfoMode.set([0, 1, 2]); cp.lfoBpm.fill(0);
    const ct = mkCT({ 0: { pts: [[0, 0, 0], [1, 1, 0]] }, 1: { pts: [[0, 0, 0], [0.4, 1, 0.3], [1, 0.2, 0]], loop: 1 },
      2: { pts: [[0, 0, 0], [0.5, 0.5, 0, 1, 1], [1, 0, 0]] } }, cp);
    const interp = entryFromFrames([sawFrame(), frame((p) => Math.sin(2 * Math.PI * p)), sawFrame().map((x) => -x)], 1);
    const nz = noiseFrom(Float32Array.from({ length: 8192 }, (_, i) => Math.sin(i * 0.37) * 0.5), Float32Array.from({ length: 8192 }, (_, i) => Math.cos(i * 0.29) * 0.5));
    const { S, proc, vs, ctx } = setup({ OS, cp, ct, n: 2, fxp: loadFixture('fxp-default.json'),
      tables: { 'factory:Default': SAW, 'tbl:interp': interp, 'noise:White': nz, ...SUBS } });
    proc.sx.mon = 1;
    vs[0].noteOn(60, 1, false, 1); vs[1].noteOn(67, 0.5, false, 1);
    const N = 128 * OS, L = new Float64Array(N), R = new Float64Array(N), DL = new Float64Array(N), DR = new Float64Array(N);
    const span = () => { S.begin(proc, N); for (const v of vs) v.render(L, R, N, DL, DR); S.fxMods(proc); S.snapshot(proc); };
    for (let s = 0; s < 4; s++) span();
    const names = ['Float64Array', 'Float32Array', 'Uint8Array', 'Uint16Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Array', 'Map', 'Object'];
    const saved = {};
    for (const k of names) { saved[k] = ctx[k]; ctx[k] = function () { throw new Error('allocation: ' + k); }; }
    try {
      for (let s = 0; s < spansOf(1); s++) {
        if (s === 100) vs[1].noteOff(0.4);
        if (s === 150) vs[0].noteOn(62, 0, false, 1);            // steal: velocity 0 drops OSC B's unison voices
        L.fill(0); R.fill(0);
        span();
        for (let i = 0; i < N; i++) if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) throw new Error('not finite at span ' + s);
      }
    } finally {
      for (const k of names) ctx[k] = saved[k];
    }
    assert.ok(maxAbs(DL) > 0, 'direct out in use');
  }
});

/* ------------------------------------------------------------------ warm-up (§10.4.29) */

test('warmUp leaves no state: no __warm table, later output bit-identical to a processor that never warmed up (§10.4.29)', () => {
  const play = (warm) => {
    const { SerumDSP: S, ctx } = loadDSP();
    S.storeWT('factory:Default', SAW);
    const proc = makeProc(48000, 2);
    if (warm) {
      const t0 = performance.now();
      S.warmUp(proc);
      console.log(`  warmUp: ${(performance.now() - t0).toFixed(1)} ms`);
      assert.equal(S.tables.has('__warm'), false);
      assert.deepEqual([...S.tables.keys()], ['factory:Default'], 'only the tables that were there before');
      assert.equal(proc.sx.span, 0);
    }
    const cp = mkCP({ 'f.on': 1, 'a.uni': grid('a.uni', 3) }, [{ src: 'lfo1', dst: 'f.cutoff', amt: 0.3 }, { src: 'rand1', dst: 'a.semi', amt: 0.2 }]);
    proc.p = { serum: cp, fxr: null };
    const vs = [new S.SerumVoice(proc, 0), new S.SerumVoice(proc, 1)];
    proc.voices = vs;
    vs.forEach((v) => v.apply(proc.p));
    vs[0].noteOn(60, 1, false, 1); vs[1].noteOn(64, 0.6, false, 1);
    void ctx;
    return run(S, proc, vs, 30).L;
  };
  sameArr(play(true), play(false), 'warm vs cold');
});

/* ------------------------------------------------------------------ CPU budgets (§8.4.3, §10.4.17) */

test('CPU budgets (a), (b), (c) at OS 2 (outside node:vm; fail only beyond 3×), OS 1 and 4 informative (§10.4.17)', async () => {
  const calib = CPU.T_REF_CALIB > 0 ? await CPU.calibRowB() : null;
  // evaluated in this realm (no vm global interceptor), as in the AudioWorkletGlobalScope
  const had = [globalThis.SxBase, globalThis.SxMod, globalThis.SerumDSP];
  vm.runInThisContext(BASE_SRC, { filename: 'sx-base.js' });
  vm.runInThisContext(MOD_SRC, { filename: 'sx-mod.js' });
  vm.runInThisContext(SRC, { filename: 'serum-dsp.js' });
  const S = globalThis.SerumDSP;
  try {
    const t256 = entryFromFrames(Array.from({ length: 256 }, (_, f) => { const s = sawFrame(), w = f / 255; return s.map((x, j) => (1 - w) * x + w * Math.sin(2 * Math.PI * j / 2048)); }), 1);
    S.storeWT('cpu:1', SAW); S.storeWT('cpu:256', t256);
    const D = S.DIDX;
    const bench = (OS, scen) => {
      const proc = makeProc(48000, OS);
      const cp = mkCP({ 'a.uni': 1, 'b.uni': 1, 'b.on': 1, 'f.on': 1, 'f.type': 3 / 95, 'f.routeB': 1, 'a.det': 0.5, 'b.det': 0.5 }, [],
        { wt: scen === 'a' ? ['cpu:1', 'cpu:1'] : ['cpu:256', 'cpu:256'] });
      if (scen === 'b') {
        cp.base[D.A_WARPMODE] = 4 / 22; cp.base[D.B_WARPMODE] = 4 / 22; cp.base[D.A_WARP] = 0.5; cp.base[D.B_WARP] = 0.5;
        cp.lfoMode[0] = 0; cp.lfoMono[0] = 0; cp.lfoBpm[0] = 0; cp.base[D.L1_RATE] = Math.pow(2 / 100, 0.25);
        addRow(cp, { src: 'lfo1', dst: 'a.wt' }); addRow(cp, { src: 'lfo1', dst: 'b.wt' });
      }
      proc.p = { serum: cp, fxr: null }; proc.ct = null;
      const vs = Array.from({ length: 8 }, (_, i) => new S.SerumVoice(proc, i));
      proc.voices = vs;
      vs.forEach((v) => v.apply(proc.p));
      vs.forEach((v, i) => v.noteOn(48 + 3 * i, 0.8, false, 1));
      const N = 128 * OS, L = new Float64Array(N), R = new Float64Array(N), spans = 48000 / 128;
      const go = () => { for (let s = 0; s < spans; s++) { S.begin(proc, N); for (const v of vs) v.render(L, R, N); S.fxMods(proc); } };
      go();
      let t0 = performance.now();
      go();
      const ms = performance.now() - t0;
      t0 = performance.now();
      for (let s = 0; s < spans; s++) { S.begin(proc, N); S.fxMods(proc); }
      return [ms, performance.now() - t0];
    };
    const res = {};
    for (const OS of [1, 2, 4]) for (const sc of ['a', 'b']) {
      const [ms, bm] = bench(OS, sc);
      res[OS + sc] = [ms, bm];
      console.log(`  CPU (${sc}) OS ${OS}: ${ms.toFixed(1)} ms per second of audio; begin + fxMods ${bm.toFixed(2)} ms`);
    }
    // the gated OS 2 rows: calibrated (× t_ref(calib) / t(calib), the calibration timed right before and after each run)
    // and re-measured (≤ 5 attempts) while over the bound (tests/cpu-gate.mjs; RULINGS2 Performance)
    const tc = () => { const t0 = performance.now(); calib(); return performance.now() - t0; };
    for (const [sc, target] of [['a', 400], ['b', 900]]) {
      for (let attempt = 0; attempt < 5 && !(res['2' + sc][0] <= 3 * target); attempt++) {
        const c0 = calib ? tc() : 0, [ms] = bench(2, sc), c1 = calib ? tc() : 0;
        const v = calib ? ms * CPU.T_REF_CALIB / ((c0 + c1) / 2) : ms;
        if (v < res['2' + sc][0]) res['2' + sc][0] = v;
      }
    }
    assert.ok(res['2a'][0] <= 3 * 400, '(a) ' + res['2a'][0].toFixed(0) + ' ms (target 400)');
    assert.ok(res['2b'][0] <= 3 * 900, '(b) ' + res['2b'][0].toFixed(0) + ' ms (target 900)');
    assert.ok(res['2a'][1] <= 3 * 0.02 * res['2a'][0], '(c) ' + res['2a'][1].toFixed(2) + ' ms (target 2 % of (a))');
    // 1x quality (and the CPU safeguard's OS cap) must save CPU: OS 1 cheaper than OS 2 (measured ≈ 0.7×). The test
    // files run in parallel, so the ratio is the median of 3 back-to-back pairs in alternating order (a load stretch
    // slows both members of a pair)
    const ratio = (sc) => {
      const q = [res['1' + sc][0] / res['2' + sc][0]];
      for (let k = 0; k < 2; k++) {
        if (k & 1) { const a = bench(1, sc)[0], b = bench(2, sc)[0]; q.push(a / b); } else { const b = bench(2, sc)[0], a = bench(1, sc)[0]; q.push(a / b); }
      }
      return q.sort((x, y) => x - y)[1];
    };
    const ra = ratio('a'), rb = ratio('b');
    console.log(`  CPU OS 1 / OS 2 (median of 3 pairs): (a) ${ra.toFixed(2)}, (b) ${rb.toFixed(2)}`);
    assert.ok(ra < 1 && rb < 1, 'OS 1 costs less than OS 2');
  } finally {
    [globalThis.SxBase, globalThis.SxMod, globalThis.SerumDSP] = had;
  }
});

/* ------------------------------------------------------------------ edits and hooks while notes sound (review round 2) */

test('matrix edits mid-note: a removed / bypassed / zeroed row returns its destination to the base at the next chunk (§5.1, §5.6)', () => {
  // Fixed → a.semi bipolar 1 (+12 st), note 57 → 440 Hz; the same patch without the row (compileSerum drops a bypassed,
  // zero-amount or removed row) → 220 Hz, eff and snapshot back at the base
  const { S, proc, vs: [v], D } = setup({ cp: mkCP({}, [{ src: 'fixed', dst: 'a.semi', amt: 1, bi: 1 }]) });
  v.noteOn(57, 1, false, 1);
  let r = run(S, proc, [v], 40);
  assert.ok(Math.abs(peakFreq(r.L.subarray(r.L.length - 16384), proc.fs, 100, 1000) - 440) < 0.05);
  proc.p = { serum: mkCP(), fxr: null };
  v.apply(proc.p);
  run(S, proc, [v], 1);
  assert.equal(v.eff[D.A_SEMI], 0.5, 'eff at the base after one span');
  assert.equal(S.snapshot(proc).eff[D.A_SEMI], 0.5, 'snapshot');
  r = run(S, proc, [v], 40);
  assert.ok(Math.abs(peakFreq(r.L.subarray(r.L.length - 16384), proc.fs, 100, 1000) - 220) < 0.05);
  // a row that switched OSC B on is bypassed: B is silent again after its one-chunk ramp
  const q = setup({ cp: mkCP({ 'a.on': 0, 'b.on': 0 }, [{ src: 'fixed', dst: 'b.on' }]) });
  q.vs[0].noteOn(60, 1, false, 1);
  assert.ok(maxAbs(run(q.S, q.proc, q.vs, 10).L) > 0.3, 'B sounds through the row');
  q.proc.p = { serum: mkCP({ 'a.on': 0, 'b.on': 0 }), fxr: null };
  q.vs[0].apply(q.proc.p);
  run(q.S, q.proc, q.vs, 1);
  assert.equal(maxAbs(run(q.S, q.proc, q.vs, 4).L), 0, 'B off once the row is gone');
  // a steal after the Velocity → a.uni row disappeared samples N from the base (no render in between)
  const w = setup({ cp: mkCP({}, [{ src: 'velo', dst: 'a.uni' }]) });
  w.vs[0].noteOn(60, 1, false, 1);
  run(w.S, w.proc, w.vs, 2);
  assert.equal(w.vs[0].uN[0], 16);
  w.proc.p = { serum: mkCP(), fxr: null };
  w.vs[0].apply(w.proc.p);
  w.vs[0].noteOn(62, 1, false, 1);
  assert.equal(w.vs[0].uN[0], 1, 'N from the base');
});

test('reset / warmUp between notes: a note-on before the next begin re-syncs the CP and sounds; a refused note-on frees the voice (§6.16, §8.4.3)', () => {
  const { S, proc, vs: [v] } = setup();
  v.noteOn(60, 1, false, 1);
  run(S, proc, [v], 4);
  v.kill();
  S.reset(proc);                                             // panic: allOff + reset, no apply
  v.noteOn(60, 1, false, 1);
  assert.deepEqual([v.active, v.gate], [true, true]);
  const b = new Float64Array(256);
  v.render(b, b, 256);                                       // render without begin (events before the next span)
  assert.ok(maxAbs(b) > 0, 'sounds before the next begin');
  assert.ok(maxAbs(run(S, proc, [v], 10).L) > 0.3, 'and after it');
  v.kill();
  S.warmUp(proc);
  v.noteOn(64, 1, false, 1);
  assert.equal(v.active, true, 'after warmUp');
  assert.ok(maxAbs(run(S, proc, [v], 10).L) > 0.3);
  // a minor version bump is understood (§4.3); another major is refused and leaves the voice free (gate false)
  const m = setup({ cp: { ...mkCP(), ver: 2.1 } });
  m.vs[0].noteOn(60, 1, false, 1);
  assert.ok(maxAbs(run(m.S, m.proc, m.vs, 10).L) > 0.3, 'CP ver 2.1 plays');
  const x = setup({ cp: { ...mkCP(), ver: 3 } });
  x.vs[0].noteOn(60, 1, false, 1);
  assert.deepEqual([x.vs[0].active, x.vs[0].gate], [false, false]);
  assert.equal(x.S.snapshot(x.proc).notes, 0);
});

test('note-on evaluation sees the envelopes before their restart: 0 for a fresh voice, the current level on a steal (§6.1)', () => {
  const cp = mkCP({ 'e2.att': 0, 'e2.dec': 0, 'e2.sus': 1 }, [{ src: 'env2', dst: 'a.uni' }]);
  const { S, proc, vs: [v] } = setup({ cp });
  v.noteOn(60, 1, false, 1);
  assert.equal(v.uN[0], 1, 'fresh voice: env2 = 0 at the note-on evaluation');
  assert.equal(v.eV[1], 1, 'the zero-length attack is still settled for the first chunk');
  run(S, proc, [v], 2);
  v.noteOn(62, 1, false, 1);
  assert.equal(v.uN[0], 16, 'steal: env2 at its current level 1');
});

test('Off-mode LFO: delay / rise start from the point-modulated first point (§6.12, §5.7)', () => {
  // first point y 0.2 linked to bus 1; Fixed → bus1 +0.5 → bus value 1 → y0' = 1
  const cp = lfoCP(0, 2, { 'l1.rate': 0, 'l1.delay': 0.1 / 4 }, [{ src: 'fixed', dst: 'bus1', amt: 0.5 }, { src: 'lfo1', dst: 'f.res', amt: 0.1 }]);
  const ct = mkCT({ 0: { pts: [[0, 0.2, 0, 0, 1], [0.5, 0.6, 0], [1, 0.2, 0]], start: 1 } }, cp);
  const { S, proc, vs: [v] } = setup({ cp, ct });
  S.transport(proc, true);
  run(S, proc, [v], 2);                                      // mono context picks up the bus row
  v.noteOn(60, 1, false, 1);
  assert.ok(Math.abs(v.src[5] - 1) < 1e-12, 'note-on evaluation: y0 = 1, got ' + v.src[5]);
  run(S, proc, [v], 4);
  assert.ok(Math.abs(v.src[5] - 1) < 1e-12, 'during the delay: y0 = 1, got ' + v.src[5]);
  run(S, proc, [v], spansOf(0.12));
  assert.ok(Math.abs(v.src[5] - 0.6) < 1e-12, 'after the delay: the shared value at x 0.5');
});

test('point-modulated LFOs: per-chunk evaluation equals evalPts on the modified point list (§5.7)', () => {
  const R = rng(7);
  for (let rep = 0; rep < 6; rep++) {
    const n = 3 + Math.floor(R() * 60), pts = [[0, R(), 2 * R() - 1, 0, R() < 0.3 ? 1 : 0]];
    for (let j = 1; j < n - 1; j++) pts.push([R(), R(), 2 * R() - 1, R() < 0.4 ? 1 + Math.floor(R() * 2) : 0, R() < 0.4 ? 1 + Math.floor(R() * 2) : 0]);
    pts.push([1, R(), 0, 0, R() < 0.3 ? 2 : 0]);
    pts.sort((a, b) => a[0] - b[0]);
    pts[0][0] = 0; pts[n - 1][0] = 1;
    const a1 = 2 * R() - 1, a2 = 2 * R() - 1;
    const cp = lfoCP(0, 0, { 'l1.rate': 0.55 }, [{ src: 'fixed', dst: 'bus1', amt: a1 }, { src: 'fixed', dst: 'bus2', amt: a2 }, { src: 'lfo1', dst: 'f.res', amt: 0.1 }]);
    const ct = mkCT({ 0: { pts } }, cp);
    const { S, proc, vs: [v] } = setup({ cp, ct });
    v.noteOn(60, 1, false, 1);
    run(S, proc, [v], 1);
    const vb = [0, 2 * v.eff[S.DIDX.BUS1] - 1, 2 * v.eff[S.DIDX.BUS1 + 1] - 1];
    const mod = pts.map((p, j) => {
      let x = p[0], y = p[1];
      if (p[4]) y = Math.min(1, Math.max(0, y + vb[p[4]]));
      if (p[3] && j > 0 && j < n - 1) x = Math.min(pts[j + 1][0], Math.max(pts[j - 1][0], x + vb[p[3]]));
      return [x, y, p[2]];
    });
    const P = Float64Array.from(mod.flat());
    const N = 128 * proc.OS, b = new Float64Array(N);
    for (let s = 0; s < 20; s++) {
      S.begin(proc, N);
      for (let c = 0; c < 32; c++) {
        const ph = v.mod.lPh[0];
        v.render(b, b, proc.CH);
        assert.equal(v.src[5], S.evalPts(P, 0, n, ph), `rep ${rep} phase ${ph}`);
      }
    }
  }
});

test('Env-mode LFO with BPM + Anchor follows lfoStart + Δbeat/beats and re-locks after a rate change (§6.12)', () => {
  const cp = lfoCP(0, 1, { 'l1.rate': 6 / 14 }, [{ src: 'lfo1', dst: 'f.res', amt: 0.1 }]);
  setLfo(cp, 0, { bpm: 1, anchor: 1 });                       // n 6/14 → 2 beats; with the row below 7/14 → 1 beat
  const ct = mkCT({ 0: { pts: [[0, 0, 0], [1, 1, 0]] } }, cp);
  const { S, proc, vs: [v] } = setup({ cp, ct });
  run(S, proc, [v], 3);
  const b0 = proc.sx.mod.beatClk;
  v.noteOn(60, 1, false, 1);
  run(S, proc, [v], spansOf(0.2));
  assert.ok(Math.abs(v.mod.lPh[0] - (proc.sx.mod.beatClk - b0) / 2) < 1e-9, '2 beats per cycle');
  const cp2 = lfoCP(0, 1, { 'l1.rate': 6 / 14 }, [{ src: 'lfo1', dst: 'f.res', amt: 0.1 }, { src: 'fixed', dst: 'l1.rate', amt: 1 / 14 }]);
  setLfo(cp2, 0, { bpm: 1, anchor: 1 });
  cp2.ctKey = cp.ctKey;
  proc.p = { serum: cp2, fxr: null };
  v.apply(proc.p);
  run(S, proc, [v], spansOf(0.1));
  assert.ok(Math.abs(v.mod.lPh[0] - (proc.sx.mod.beatClk - b0) / 1) < 1e-9, 'jumps to the anchored position of the new rate');
  run(S, proc, [v], spansOf(0.6));
  assert.equal(v.mod.lPh[0], 1, 'holds at the end');
});

test('interpolating tables crossfade a frame-pair jump over one chunk (stepped WT position, §5.6, §6.5)', () => {
  const sine = frame((p) => Math.sin(2 * Math.PI * p));
  const frames = [sine, sine.map((x) => 0.2 * x), sine.map((x) => -x)];
  const worst = (interp) => {
    const cp = mkCP({ 'l1.rate': Math.pow(2 / 100, 0.25) }, [{ src: 'lfo1', dst: 'a.wt', amt: 1 }], { wt: ['t', 't'] });
    cp.lfoMode[0] = 0; cp.lfoMono[0] = 0; cp.lfoBpm[0] = 0;
    const ct = mkCT({ 0: { pts: [[0, 0, 0], [0.5, 0, 0], [0.5, 1, 0], [1, 1, 0]] } }, cp);
    const { S, proc, vs: [v] } = setup({ cp, ct, tables: { t: entryFromFrames(frames, interp) } });
    v.noteOn(45, 1, false, 1);
    const { L } = run(S, proc, [v], 400);
    return [maxStep(L, 2000), maxStep(L, 2000, 20000)];
  };
  const [wi, si] = worst(1), [wd] = worst(0);
  assert.ok(wi <= 1.05 * wd, `interpolating ${wi.toFixed(4)} vs discrete ${wd.toFixed(4)}`);
  assert.ok(wi < 50 * si, `step ${wi.toFixed(4)} vs steady ${si.toFixed(4)}`);
});

test('a steal that lowers the unison count fades the dropped voices out over one chunk; an off oscillator then stops rendering (§6.1)', () => {
  const cp = mkCP({ 'a.uni': 0, 'a.det': 0.3, 'a.rand': 1 }, [{ src: 'velo', dst: 'a.uni' }]);
  const { S, proc, vs: [v] } = setup({ cp, tables: { 'factory:Default': SINE } });
  v.noteOn(48, 1, false, 1);
  const a = run(S, proc, [v], 60);
  v.noteOn(48, 0, false, 1);
  assert.equal(v.uN[0], 1);
  const b = run(S, proc, [v], 2);
  for (let i = 1; i < 16; i++) assert.equal(v.uGL[i], 0, 'unison voice ' + i + ' faded out');
  const all = new Float64Array(a.L.length + b.L.length);
  all.set(a.L); all.set(b.L, a.L.length);
  const steady = maxStep(a.L, a.L.length - 1024), jump = maxStep(all, a.L.length - 2, a.L.length + 64);
  assert.ok(jump < 50 * steady, `fade-out step ${jump} vs steady ${steady}`);
  proc.p = { serum: mkCP({ 'a.uni': 0, 'a.on': 0 }, [{ src: 'velo', dst: 'a.uni' }]), fxr: null };
  v.apply(proc.p);
  run(S, proc, [v], 2);
  const ph = v.uPh[0];
  run(S, proc, [v], 2);
  assert.equal(v.uPh[0], ph, 'OSC A off: not rendered');
});

test('mono legato: NOTE follows the new key (note.porta off), VELO stays (velo.porta off) (§5.3)', () => {
  const cp = mkCP({}, [{ src: 'note', dst: 'f.res', amt: 0.5 }, { src: 'velo', dst: 'f.drive', amt: 0.5 }], { mono: 1, legato: 1 });
  const { S, proc, vs: [v] } = setup({ cp });
  proc.held = [48];
  v.noteOn(48, 0.5, false, 1);
  run(S, proc, [v], 4);
  assert.ok(Math.abs(v.src[14] - 48 / 127) < 1e-9);
  proc.held = [48, 72];
  v.noteOn(72, 1, true, 1);
  run(S, proc, [v], 4);
  assert.ok(Math.abs(v.src[14] - 72 / 127) < 1e-9, 'NOTE ' + v.src[14]);
  assert.ok(Math.abs(v.src[13] - 0.5) < 1e-9, 'VELO kept');
});

test('transport play-with-seek clears lastPitch, Mem phases and the mono source vector: live ≡ offline after a seek (§6.16)', () => {
  const cases = [mkCP({ 'g.porta': 0.5 }, [], { always: 1 }), mkCP({ 'a.phase': 1, 'a.rand': 0 }),
    mkCP({}, [{ src: 'env1', dst: 'fx.fil.cutoff', amt: 0.3 }])];
  for (const cp of cases) {
    const render = (preroll) => {
      const { S, proc, vs } = setup({ cp, n: 2 });
      if (preroll) { vs[0].stamp = 1; vs[0].noteOn(40, 1, false, 1); run(S, proc, vs, 50); vs[0].noteOff(); run(S, proc, vs, 200); vs[0].kill(); }
      S.transport(proc, true);
      const fx = [];
      vs[1].stamp = 2; vs[1].noteOn(64, 1, false, 1);
      const L = run(S, proc, vs, 40, { each: () => fx.push(proc.sx.mod.fxOff[fxk('fx.fil.cutoff')]) }).L;
      return [L, Float64Array.from(fx)];
    };
    const [a, fa] = render(true), [b, fb] = render(false);
    sameArr(a, b, 'audio');
    sameArr(fa, fb, 'FX offsets');
  }
});

/* ------------------------------------------------------------------ robustness */

test('fuzz: random patches, rows, LFO graphs, rates and span sizes render finite, bounded audio', () => {
  const r = rng(2024);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const synth = DESTS.slice(0, 148).map((d) => d.id), fx = DESTS.slice(148).map((d) => d.id), srcs = Object.keys(SI);
  const tables = { 'factory:Default': SAW, 'tbl:sq': SQUARE, 'tbl:3': entryFromFrames([sawFrame(), oddFrame(), frame((p) => Math.sin(2 * Math.PI * p))], 1),
    'noise:White': noiseFrom(Float32Array.from({ length: 4096 }, () => r() - 0.5), Float32Array.from({ length: 4096 }, () => r() - 0.5)), ...SUBS };
  for (let rep = 0; rep < 12; rep++) {
    const p = {};
    for (const id of synth) if (r() < 0.5) p[id] = r();
    p['a.level'] = 0.5 + 0.5 * r(); p['e1.sus'] = 0.5 + 0.5 * r(); p['g.amp'] = 1;
    const rows = [];
    for (let k = 0; k < 1 + Math.floor(r() * 20); k++) {
      rows.push({ src: pick(srcs), dst: r() < 0.85 ? pick(synth) : pick(fx), amt: 2 * r() - 1, bi: r() < 0.5 ? 1 : 0, curve: r() < 0.3 ? 2 * r() - 1 : 0,
        aux: r() < 0.3 ? pick(srcs) : '', inv: r() < 0.5 ? 1 : 0 });
    }
    const cp = mkCP(p, rows, { wt: [pick(Object.keys(tables).filter((k) => !k.startsWith('noise') && !k.startsWith('sub'))), pick(['factory:Default', 'tbl:3', 'missing'])],
      uniMode: Uint8Array.from([Math.floor(5 * r()), Math.floor(5 * r())]), uniRange: Float64Array.from([48 * r(), 48 * r()]),
      chaosMono: Uint8Array.from([r() < 0.5, r() < 0.5]), chaosSh: Uint8Array.from([r() < 0.5, r() < 0.5]), mono: r() < 0.3 ? 1 : 0,
      legato: r() < 0.5 ? 1 : 0, noiseKey: r() < 0.5 ? 1 : 0, noiseOneshot: r() < 0.3 ? 1 : 0, subDirect: r() < 0.5 ? 1 : 0, filKey: r() < 0.5 ? 1 : 0 });
    for (let l = 0; l < 8; l++) { cp.lfoMode[l] = Math.floor(3 * r()); cp.lfoMono[l] = cp.lfoMode[l] === 2 ? 1 : 0; cp.lfoBpm[l] = r() < 0.5 ? 1 : 0; cp.lfoAnchor[l] = r() < 0.5 ? 1 : 0; }
    cp.outMask = cp.route[4] === 2 ? 3 : 1;
    const lfos = {};
    for (let l = 0; l < 8; l++) {
      const n = 2 + Math.floor(r() * 8), pts = [[0, r(), 2 * r() - 1]];
      for (let j = 1; j < n - 1; j++) pts.push([r(), r(), 2 * r() - 1, r() < 0.2 ? 1 + Math.floor(16 * r()) : 0, r() < 0.2 ? 1 + Math.floor(16 * r()) : 0]);
      pts.push([1, r(), 0]);
      pts.sort((a, b) => a[0] - b[0]);
      lfos[l] = { pts, start: Math.floor(r() * n), loop: r() < 0.5 ? Math.floor(r() * n) : -1 };
    }
    const ct = mkCT(lfos, cp);
    const [base, OS] = pick([[22050, 8], [44100, 2], [48000, 1], [48000, 4], [96000, 2], [192000, 1], [48000, 8]]);
    const { S, proc, vs } = setup({ cp, ct, n: 4, base, OS, tables });
    proc.bpm = 60 + 120 * r();
    proc.songBeat = r() < 0.5 ? () => null : (() => { let b = 0; return () => (b += 0.1); })();
    const N0 = 128 * OS, L = new Float64Array(N0), R = new Float64Array(N0), DL = new Float64Array(N0), DR = new Float64Array(N0);
    let t = 0, peak = 0;
    while (t < 0.3 * base) {
      const n = 4 * (1 + Math.floor(r() * 32)), N = n * OS;
      if (r() < 0.05) { const v = pick(vs); v.stamp = t; v.noteOn(24 + Math.floor(r() * 80), r(), r() < 0.2, 1); proc.held = [60, 64].slice(0, 1 + (r() < 0.5)); }
      if (r() < 0.03) pick(vs).noteOff(r() < 0.5 ? r() : undefined);
      if (r() < 0.01) pick(vs).kill();
      if (r() < 0.02) { proc.wheel = r(); proc.bendRaw = 2 * r() - 1; proc.at = r(); proc.pat[60] = r(); proc.patSeen = true; }
      L.fill(0); R.fill(0); DL.fill(0); DR.fill(0);
      S.begin(proc, N);
      for (const v of vs) if (v.active) v.render(L, R, N, DL, DR);
      const off = S.fxMods(proc);
      if (r() < 0.1) S.snapshot(proc);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(L[i]) || !Number.isFinite(R[i]) || !Number.isFinite(DL[i])) assert.fail(`rep ${rep}: non-finite output`);
        peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      }
      assert.ok(off.every(Number.isFinite));
      t += n;
    }
    assert.ok(peak < 100, `rep ${rep}: peak ${peak}`);
  }
});

/* ------------------------------------------------------------------ repairs: CPU / memory paths (verified review) */

test('SFilter.process block paths (MG Low 6–24, Low/High/Band/Peak/Notch 12) equal the per-sample tick bit for bit', () => {
  const { SerumDSP: S } = loadDSP();
  const r = rng(7);
  let bad = 0;
  for (let t = 0; t < 18; t++) {
    for (const [res, drv, vr] of [[0, 0, 0], [0.9, 0.5, 0.7], [1, 1, 1]]) {
      const a = new S.SFilter(96000), b = new S.SFilter(96000);
      a.setType(t); b.setType(t);
      for (let blk = 0; blk < 120; blk++) {
        const fc = 200 * Math.pow(2, 5 * Math.sin(blk * 0.05) + 3);
        a.set(fc, fc * 1.1, res, drv, vr); b.set(fc, fc * 1.1, res, drv, vr);
        const L = new Float64Array(32), R = new Float64Array(32);
        for (let i = 0; i < 32; i++) { L[i] = (r() * 2 - 1) * 2; R[i] = (r() * 2 - 1) * 0.5; }
        const L2 = L.slice(), R2 = R.slice();
        a.process(L, R, 0, 32);
        for (let i = 0; i < 32; i++) { b.tick(L2[i], R2[i]); L2[i] = b.yl; R2[i] = b.yr; }
        b.flush();
        for (let i = 0; i < 32; i++) if (!Object.is(L[i], L2[i]) || !Object.is(R[i], R2[i])) bad++;
        assert.ok(Object.is(a.yl, b.yl) && Object.is(a.yr, b.yr));
      }
    }
  }
  assert.equal(bad, 0);
});

test('spare voices get no filter delay lines; a modulated f.type preallocates only the families it can reach', () => {
  const comb = grid('f.type', 39), mg12 = grid('f.type', 1);
  {
    const { proc, vs } = setup({ cp: mkCP({ 'f.on': 1, 'f.type': comb }), n: 3 });
    assert.ok(vs.every(v => v.filt.pool.length > 1000), 'voices in use: comb lines');
    const cp2 = mkCP({ 'f.on': 1, 'f.type': grid('f.type', 81) });   // Allpasses (bank): larger lines
    proc.p = { serum: cp2, fxr: null };
    vs[2].spare = 1;
    for (const v of vs) v.apply(proc.p);
    assert.equal(vs[2].filt.type, 39, 'a spare voice keeps its type');
    assert.ok(vs[0].filt.pool.length > vs[2].filt.pool.length, 'and its pool');
  }
  {
    const { vs } = setup({ cp: mkCP({ 'f.on': 1, 'f.type': mg12 }, [{ src: 'lfo1', dst: 'f.type', amt: 0.05 }]), n: 1 });
    assert.ok(vs[0].filt.pool.length <= 4, 'MG Low 12 ± 0.05 reaches no delay family: ' + vs[0].filt.pool.length);
  }
  {
    const { vs } = setup({ cp: mkCP({ 'f.on': 1, 'f.type': grid('f.type', 37) }, [{ src: 'lfo1', dst: 'f.type', amt: 0.05 }]), n: 1 });
    assert.ok(vs[0].filt.pool.length > 1000, 'B/P/N 24 ± 0.05 reaches the combs: lines preallocated');
  }
});

test('an Off LFO nothing reads keeps exactly the phase of an evaluated one (only its output is skipped)', () => {
  const ph = [];
  for (const used of [false, true]) {
    const cp = lfoCP(2, 2, { 'l3.rate': 0.43 }, used ? [{ src: 'lfo3', dst: 'a.pan', amt: 0.1 }] : []);
    const { S, proc } = setup({ cp, n: 0 });
    for (let s = 0; s < 300; s++) S.begin(proc, 256);
    ph.push(proc.sx.mod.oPh[2]);
  }
  assert.ok(Object.is(ph[0], ph[1]) && ph[0] > 0, ph.join(' vs '));
});

test('a static WT position on an interpolating table reads a cached blend (−140 dB from the two-frame read)', () => {
  const T = wtEntry(8, (f, j, len) => Math.sin(2 * Math.PI * j / len * (1 + f)) / (1 + f));
  T.interp = 1; T.morph = 1;
  const outs = [];
  for (const src of [SRC, SRC.replace('const bc = two && dt === 0 ? this.bcGet(o, d, fa, fb, t0, len) : null;', 'const bc = null;')]) {
    assert.ok(src === SRC || src.includes('const bc = null;'));
    const ctx = vm.createContext({ console: mkConsole() });
    vm.runInContext(src, ctx);
    const { S, proc, vs: [v] } = setup({ ctx, cp: mkCP({ 'a.wt': 0.37, 'a.uni': grid('a.uni', 5) }), tables: { 'factory:Default': T } });
    v.noteOn(52, 0.9, false, 1);
    outs.push(run(S, proc, [v], 60).L);
  }
  let m = 0, pk = 0;
  for (let i = 0; i < outs[0].length; i++) { m = Math.max(m, Math.abs(outs[0][i] - outs[1][i])); pk = Math.max(pk, Math.abs(outs[1][i])); }
  assert.ok(pk > 0.05 && dB(m / pk) < -120, 'difference ' + dB(m / pk).toFixed(1) + ' dB');
});

test('first-use warm-up (warmStart / warmTick / warmEnd): waits for the tables, leaves the note bookkeeping as it was', () => {
  const { S, proc, vs: [v] } = setup({ tables: {} });
  S.begin(proc, 256);
  S.warmStart(proc);
  const N = 256;
  S.begin(proc, N);
  assert.ok(S.warmTick(proc, N) > 0 && proc.sx.hw === null, 'waiting for its table');
  assert.equal(S.storeWT('factory:Default', SAW), true);
  const rec0 = proc.sx.mod.recent, lp0 = proc.sx.mod.lastPitch, alt0 = proc.sx.alt, rng0 = proc.sx.rng;
  let left = 1;
  for (let k = 0; k < 200 && left > 0; k++) { S.begin(proc, N); left = S.warmTick(proc, N); if (k === 0) assert.equal(proc.sx.hw.length, 2); }
  assert.equal(left, 0, 'finished');
  assert.equal(proc.sx.hw, null);
  assert.ok(proc.sx.mod.recent === rec0 && proc.sx.mod.lastPitch === lp0 && proc.sx.alt === alt0 && proc.sx.rng === rng0, 'bookkeeping restored');
  assert.ok(proc.voices.length === 1 && !v.active, 'the processor’s voices untouched');
  // a reset ends a warm-up under way
  S.warmStart(proc); S.begin(proc, N); S.warmTick(proc, N);
  assert.ok(proc.sx.hw !== null);
  S.reset(proc);
  assert.ok(proc.sx.hw === null && S.warmTick(proc, N) === 0);
});

/* ------------------------------------------------------------------ CT v2 parts (SPEC-serum2 §4.1, §11.10 mergeCT) */

// content key of a CT part (FNV-1a over the bytes of its typed arrays and its scalars), as serum-core keys parts by content
function partKey(name, ...xs) {
  let h = 0x811C9DC5;
  const byte = (b) => { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; };
  for (const x of xs) {
    if (ArrayBuffer.isView(x)) { const u = new Uint8Array(x.buffer, x.byteOffset, x.byteLength); for (let i = 0; i < u.length; i++) byte(u[i]); }
    else for (const c of String(x)) byte(c.charCodeAt(0) & 255);
  }
  return name + ':' + h.toString(16);
}
const contentParts = (ct) => {
  const t = ctParts(ct);
  for (const [name, q] of Object.entries(t.parts)) q.key = partKey(name, ...Object.keys(q).filter((k) => k !== 'key').map((k) => q[k]));
  return t;
};

test('mergeCT: CT v2 parts render as the full CT; only changed parts merge; LFO points repack; invalid parts ignored once', () => {
  const rows = [{ src: 'lfo1', dst: 'f.cutoff', amt: 0.4, bi: 1 }, { src: 'lfo2', dst: 'a.fine', amt: 0.3, bi: 1 }, { src: 'lfo3', dst: 'a.wt', amt: 0.5 },
    { src: 'fixed', dst: 'bus1', amt: 0.3 }];
  const mk = () => { const c = mkCP({ 'f.on': 1, 'a.uni': grid('a.uni', 3), 'l1.rate': 0.5, 'l2.rate': 0.55, 'l3.rate': 0.45 }, rows); c.lfoMode.set([0, 1, 2]); c.lfoBpm.fill(0); return c; };
  const g1 = { 0: { pts: [[0, 0, 0], [0.3, 1, 0.4], [1, 0, 0]] }, 1: { pts: [[0, 0, 0], [0.5, 1, 0, 1, 0], [1, 0.2, 0]], loop: 1 },
    2: { pts: [[0, 0.2, 0], [0.6, 0.7, 0, 0, 1], [1, 0.9, 0]], start: 1 } };
  // LFO 2 gains two points (LFO 3's points move in the packed list) and the velocity curve changes
  const g2 = { ...g1, 1: { pts: [[0, 0, 0], [0.2, 0.6, 0], [0.5, 1, 0, 1, 0], [0.8, 0.1, 0], [1, 0.2, 0]], loop: 2 } };
  const cp1 = mk(), ct1 = mkCT(g1, cp1), cp2 = mk(), ct2 = mkCT(g2, cp2);
  for (let j = 0; j <= 128; j++) ct2.veloTab[j] = Math.sqrt(j / 128);
  const tables = { 'factory:Default': SAW };
  const play = (first, second, chk) => {
    const { S, proc, vs } = setup({ cp: cp1, ct: first, n: 2, tables });
    vs[0].noteOn(48, 0.6, false, 1);
    const a = run(S, proc, vs, 20).L;
    proc.p = { serum: cp2, fxr: null }; proc.ct = second;
    for (const v of vs) v.apply(proc.p);
    vs[1].noteOn(55, 0.6, false, 1);
    const b = run(S, proc, vs, 20).L;
    if (chk) chk(S, proc);
    return Float64Array.from([...a, ...b]);
  };
  const ref = play(ct1, ct2);
  const p1 = contentParts(ct1), p2 = contentParts(ct2);
  const changed = Object.keys(p2.parts).filter((k) => p2.parts[k].key !== p1.parts[k].key).sort();
  assert.deepEqual(changed, ['lfo1', 'velo'], 'only LFO 2 and the velocity curve differ');
  // all parts, then the whole second set (unchanged parts are skipped by key)
  sameArr(play(p1, p2), ref, 'parts ≡ full CT');
  // the second CT delivered as only its changed parts (§4.1 sendPatch)
  const delta = { key: p2.key, parts: { lfo1: p2.parts.lfo1, velo: p2.parts.velo } };
  sameArr(play(p1, delta, (S, proc) => {
    const C = proc.sx.CT;
    assert.equal(C.key, ct2.key);
    assert.deepEqual(Array.from(C.lfoPtsOff), Array.from(ct2.lfoPtsOff), 'packed offsets');
    assert.deepEqual(Array.from(C.lfoPts.subarray(0, 3 * ct2.lfoPtsOff[10])), Array.from(ct2.lfoPts), 'packed points');
    assert.deepEqual(Array.from(C.lfoPm.subarray(0, 2 * ct2.lfoPtsOff[10])), Array.from(ct2.lfoPm), 'packed point links');
    for (const k of ['lfoTab', 'lfoPmAny', 'lfoStart', 'lfoLoop', 'veloTab', 'noteTab', 'remap', 'crv', 'specFilt', 'pathX']) {
      assert.deepEqual(Array.from(C[k]), Array.from(ct2[k]), k);
    }
    const gen = proc.sx.ctGen;
    assert.equal(S.mergeCT(proc, delta), false, 'nothing new');
    assert.equal(proc.sx.ctGen, gen);
  }), ref, 'changed parts only ≡ full CT');
  // invalid parts: ignored, one warning per part name; valid parts of the same object still merge
  const con = mkConsole();
  const { S, proc } = setup({ ctx: vm.createContext({ console: con }) });
  const bad = { key: 'k', parts: { lfo0: { key: 'x', n: 3, tab: new Float32Array(10), pts: new Float64Array(9), pm: new Uint8Array(6) },
    velo: { key: 'v', tab: new Float64Array(129) }, note: { key: 'n2', tab: Float32Array.from({ length: 129 }, (_, j) => 1 - j / 128) } } };
  assert.equal(S.mergeCT(proc, bad), true, 'the note curve merged');
  assert.equal(proc.sx.CT.noteTab[0], 1);
  assert.equal(S.mergeCT(proc, bad), false);
  assert.equal(con.msgs.filter((m) => m.level === 'warn' && m.text.includes('invalid CT part')).length, 2, 'lfo0 and velo, once each');
  assert.equal(S.mergeCT(proc, null), false);
  assert.equal(S.mergeCT(proc, { key: 'k' }), false);
});

/* ================================================================== Phase 2, M2: the v2 voice (SPEC-serum2 §15.9) */
// The v2 voice through the whole §0.3 script list (tests/dsp-scope.mjs), with CPs compiled by serum-core from v2 states
// (S2 mode unless stated). Destination values are normalised n; enum/int laws through the helpers below.
const W2 = (id) => { const i = core.WARPS2.findIndex((w) => w.id === id); assert.ok(i >= 0, id); return i; };
const nEnum = (k, top) => k / top;                          // enum / int law n of index k (lo 0, hi top)
const nUni = (N) => (N - 1) / 15;
const nTime = (t) => Math.pow(t / 32, 0.2);                 // pow5 law 0–32 s (envelope times)
const TRI_SUB = entryFromFrames([frame((p) => 1 - 4 * Math.abs(((p + 0.25) % 1) - 0.5))]);
const TABLES2 = { 'factory:Default': SAW, ...SUBS, 'sub:Triangle': TRI_SUB };
// a normalised v2 state: deterministic start phases (RAND 0, PHASE 0) and an instant ENV 1 unless p overrides them; the
// oscillators read the single-frame test tables stored under 'factory:Default' (the v2 default is 'factory:Default Shapes')
function st2(p = {}, edit = null) {
  const s = core.defaultSerum();
  for (const O of s.osc) O.wt = 'factory:Default';
  Object.assign(s.p, { 'a.rand': 0, 'a.phase': 0, 'b.rand': 0, 'b.phase': 0, 'c.rand': 0, 'c.phase': 0, 'e1.att': 0 }, p);
  if (edit) edit(s);
  return core.normalizeSerum(s);
}
function setup2({ s = st2(), patch = null, base = 48000, OS = 2, n = 1, tables = TABLES2, assets = {}, cpEdit = null, scope = null } = {}) {
  const sc = scope || dspScope();
  const S = sc.global('SerumDSP'), B = sc.global('SxBase');
  for (const [id, e] of Object.entries(tables)) assert.equal(S.storeWT(id, e), true, id);
  for (const [id, e] of Object.entries(assets)) assert.equal(B.storeAsset(id, e), true, id);
  const P = patch || core.compileSerum(s, {});
  const cp = P.serum;
  if (cpEdit) cpEdit(cp);
  const proc = makeProc(base, OS);
  proc.mpe = new Float64Array(17 * 4); proc.vcN = 0;
  proc.p = { serum: cp, fxr: null };
  proc.ct = P.serumT;
  const vs = [];
  for (let i = 0; i < n; i++) vs.push(new S.SerumVoice(proc, i));
  proc.voices = vs;
  for (const v of vs) v.apply(proc.p);
  return { sc, S, B, proc, vs, cp, VI: S.VIDX };
}
const OUTS = ['L', 'R', 'dL', 'dR', 'b1L', 'b1R', 'b2L', 'b2R'];
// spans of 128 base frames through render(O, N) (outs: the §11.10 output object) or the Phase-1 signature
function run2(S, proc, vs, spans, { each, outs = false } = {}) {
  const N = 128 * proc.OS, res = { N }, O = {};
  for (const k of OUTS) { res[k] = new Float64Array(spans * N); O[k] = new Float64Array(N); }
  for (let sp = 0; sp < spans; sp++) {
    if (each) each(sp);
    for (const k of OUTS) O[k].fill(0);
    S.begin(proc, N);
    for (const v of vs) if (v.active) { if (outs) v.render(O, N); else v.render(O.L, O.R, N); }
    S.fxMods(proc);
    for (const k of OUTS) res[k].set(O[k], sp * N);
  }
  return res;
}
// one note, `spans` spans; returns the run2 result (and the setup)
function play2(opts, note = 57, spans = 30, { vel = 1, outs = false, each, off = -1 } = {}) {
  const u = setup2(opts);
  u.vs[0].noteOn(note, vel, false, 1);
  const r = run2(u.S, u.proc, u.vs, spans, { outs, each: (sp) => { if (sp === off) u.vs[0].noteOff(0.5); if (each) each(sp, u); } });
  return Object.assign(r, { u });
}
const rms = (x, a = 0, b = x.length) => { let e = 0; for (let i = a; i < b; i++) e += x[i] * x[i]; return Math.sqrt(e / Math.max(1, b - a)); };
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };

/* ------------------------------------------------------------------ oscillators (§6.3–§6.6) */

test('M2: OSC C renders exactly as OSC A for identical settings; OSC C draws from r2 (A/B start phases unchanged with C on)', () => {
  const osc = (k) => ({ [k + '.on']: 1, [k + '.uni']: nUni(4), [k + '.det']: 0.4, [k + '.w1']: nEnum(W2('bend_p'), 81), [k + '.warp']: 0.4,
    [k + '.semi']: nEnum(15, 24), [k + '.pan']: 0.3 });
  const a = play2({ s: st2(osc('a')) }), c = play2({ s: st2({ 'a.on': 0, ...osc('c') }, (s) => { s.osc[2].route = 0; }) });
  assert.ok(maxAbs(a.L) > 0.1, 'audible');
  sameArr(c.L, a.L, 'C ≡ A (L)'); sameArr(c.R, a.R, 'C ≡ A (R)');
  assert.equal(c.u.cp.use & 1, 1, 'OSC C possibly on (use bit 1)');
  // OSC A with random start phases: identical with OSC C off (use bit clear) and on at level 0 (r2 draws only)
  const pA = { 'a.rand': 1, 'a.uni': nUni(5), 'a.det': 0.3, 'b.on': 1, 'b.rand': 1, 'b.uni': nUni(3) };
  const off = play2({ s: st2(pA) }), on = play2({ s: st2({ ...pA, 'c.on': 1, 'c.level': 0, 'c.rand': 1, 'c.uni': nUni(7) }) });
  assert.equal(off.u.cp.use & 1, 0);
  sameArr(on.L, off.L, 'A/B unchanged by OSC C (L)'); sameArr(on.R, off.R, 'A/B unchanged by OSC C (R)');
});

test('M2: oscillator render order and the warp-source cycle rule (§6.6.6)', () => {
  // A ← B (FM o1 of A = B) accepted; B ← A (FM o1 of B = A) closes a cycle: B's slot acts as Off; order B, A
  let u = setup2({ s: st2({ 'b.on': 1, 'a.w1': nEnum(W2('fm_o1'), 81), 'a.warp': 0.3, 'b.w1': nEnum(W2('fm_o1'), 81), 'b.warp': 0.3 }) });
  u.vs[0].noteOn(57, 1, false, 1);
  run2(u.S, u.proc, u.vs, 2);
  let v = u.vs[0];
  assert.equal(v.ordN, 2);
  assert.deepEqual([v.ord[0], v.ord[1]], [1, 0], 'B renders first');
  assert.equal(v.md[0], W2('fm_o1'), 'A slot 1 stays FM');
  assert.equal(v.md[2], 0, 'B slot 1 rejected (cycle)');
  // A ← C (FM o2 of A), B ← C (AM o2 of B, slot 2), C ← A (FM o1 of C) rejected; order C, A, B (ties A, B, C)
  u = setup2({ s: st2({ 'b.on': 1, 'c.on': 1, 'a.w1': nEnum(W2('fm_o2'), 81), 'a.warp': 0.3, 'b.w2': nEnum(W2('am_o2'), 81),
    'b.warp2': 0.5, 'c.w1': nEnum(W2('fm_o1'), 81), 'c.warp': 0.2 }) });
  assert.equal(u.cp.use & 5, 5, 'OSC C and a warp slot 2 in use');
  u.vs[0].noteOn(57, 1, false, 1);
  run2(u.S, u.proc, u.vs, 2);
  v = u.vs[0];
  assert.deepEqual([v.ordN, v.ord[0], v.ord[1], v.ord[2]], [3, 2, 0, 1]);
  assert.deepEqual([v.md[0], v.md[3], v.md[4]], [W2('fm_o2'), W2('am_o2'), 0]);
  // a modulator that is off is unavailable: its slot acts as Off (identical to w1 = Off)
  const fmOff = play2({ s: st2({ 'a.w1': nEnum(W2('fm_o1'), 81), 'a.warp': 0.6 }) }), plain = play2({ s: st2({}) });
  sameArr(fmOff.L, plain.L, 'FM from an off oscillator ≡ Off');
});

/* ------------------------------------------------------------------ mixer and routing (§1, §6.12) */

const T_MG24 = 3, T_LOW12 = 5, T_HIGH12 = 9;
const FILT = (k, type, cut = 0.35, extra = {}) => ({ [k + '.on']: 1, [(k === 'f' ? 'f.type2' : 'f2.type')]: type / 107, [k + '.cutoff']: cut,
  [k + '.res']: 0, ...extra });
test('M2: routes Main / None / Direct, filter switches, filter balance, F1 ↔ F2 series, ENV toggles (§6.12)', () => {
  const p0 = { 'a.uni': nUni(3), 'a.det': 0.3, ...FILT('f', T_MG24) };
  const route = (r) => (s) => { s.osc[0].route = r; };
  const filtered = play2({ s: st2(p0) }), dry = play2({ s: st2({ ...p0, 'f.on': 0 }) });
  assert.ok(rms(filtered.L) < 0.7 * rms(dry.L), 'Filter 1 acts on A (route Filter)');
  sameArr(play2({ s: st2(p0, route(1)) }).L, dry.L, 'route Main bypasses the filter');
  sameArr(play2({ s: st2({ ...p0, 'f.routeA': 0 }) }).L, dry.L, 'A>Filter off: around the filter');
  const none = play2({ s: st2(p0, route(3)) });
  assert.equal(maxAbs(none.L) + maxAbs(none.R), 0, 'route None: silent');
  const dir = play2({ s: st2(p0, route(2)) }, 57, 30, { outs: true });
  assert.equal(dir.u.cp.outMask & 2, 2, 'outMask: direct pair');
  assert.equal(maxAbs(dir.L), 0, 'nothing on main');
  sameArr(dir.dL, dry.L, 'Direct carries the unfiltered A'); sameArr(dir.dR, dry.R, 'Direct R');
  // the Phase-1 signature folds direct into main when no direct buffers are given
  sameArr(play2({ s: st2(p0, route(2)) }).L, dry.L, 'render(L, R, N): direct → main');
  // balance: all to Filter 2 ≡ the same filter as Filter 1; the other filter receives nothing
  const viaF1 = play2({ s: st2({ ...p0, ...FILT('f2', T_HIGH12, 0.8) }, (s) => { s.p['f2.routeA'] = 0; }) });
  const viaF2 = play2({ s: st2({ ...p0, ...FILT('f', T_HIGH12, 0.8), ...FILT('f2', T_MG24), 'a.fbal': 1 }) });
  sameArr(viaF2.L, viaF1.L, 'fbal +1: A only through Filter 2'); sameArr(viaF2.R, viaF1.R, 'fbal +1 (R)');
  sameArr(play2({ s: st2({ ...p0, ...FILT('f2', T_HIGH12, 0.8) }) }).L, filtered.L, 'fbal −1 (n 0): Filter 2 gets nothing');
  // balance 0 (n 0.5) with two identical linear filters ≡ one filter (½ + ½)
  const lin = { 'a.uni': nUni(3), 'a.det': 0.3, ...FILT('f', T_LOW12, 0.4) };
  const one = play2({ s: st2(lin) }), half = play2({ s: st2({ ...lin, ...FILT('f2', T_LOW12, 0.4), 'a.fbal': 0.5 }) });
  assert.ok(maxDiff(half.L, one.L) < 1e-9 * maxAbs(one.L), 'balance centre: ½ F1 + ½ F2 ≡ F1');
  // series: F1 → F2 (types P, Q) ≡ F2 → F1 with the types swapped, the source entering the first filter of the chain
  const P = FILT('f', T_LOW12, 0.45), Q = FILT('f2', T_HIGH12, 0.7);      // LP ≈ 290 Hz, then HP ≈ 2 kHz
  const ser12 = play2({ s: st2({ 'a.uni': nUni(3), 'a.det': 0.3, ...P, ...Q }, (s) => { s.filter[0].route = 0; }) });
  const ser21 = play2({ s: st2({ 'a.uni': nUni(3), 'a.det': 0.3, ...FILT('f', T_HIGH12, 0.7), ...FILT('f2', T_LOW12, 0.45), 'a.fbal': 1 },
    (s) => { s.filter[1].route = 0; }) });
  sameArr(ser21.L, ser12.L, 'F1 → F2 ≡ F2 → F1 swapped');
  assert.ok(rms(ser12.L) < 0.5 * rms(play2({ s: st2({ 'a.uni': nUni(3), 'a.det': 0.3, ...P }) }).L), 'the band-pass chain removes energy');
  // F1 → F2 with Filter 2 off: Filter 2 passes its input around (≡ F1 → Main)
  const ser0 = play2({ s: st2({ 'a.uni': nUni(3), 'a.det': 0.3, ...P, ...Q, 'f2.on': 0 }, (s) => { s.filter[0].route = 0; }) });
  sameArr(ser0.L, play2({ s: st2({ 'a.uni': nUni(3), 'a.det': 0.3, ...P }) }).L, 'F1 → (F2 off) ≡ F1 → Main');
  // filter levels: (2n)², 0 dB at n 0.5
  const lv = play2({ s: st2({ ...lin, 'f.level': 0.25 }) });
  assert.ok(maxDiff(lv.L.map((x) => 4 * x), one.L) < 1e-12, 'f.level n 0.25 → ×1/4');
});

test('M2: bus sends (post level/pan, (n)², their ENV group) and the ENV toggle with the lifetime rule (b) (§6.12, §6.19)', () => {
  const p = { 'a.uni': nUni(2), 'a.det': 0.2, 'a.pan': 0.3, 'a.bus1': 1, 'a.bus2': 0.5, 'e1.rel': 0.3 };
  const r = play2({ s: st2(p, (s) => { s.osc[0].route = 1; }) }, 57, 60, { outs: true, off: 30 });
  assert.equal(r.u.cp.outMask, 1 | 4 | 8, 'outMask: main + both buses');
  sameArr(r.b1L, r.L, 'bus 1 at n 1 = the main signal'); sameArr(r.b1R, r.R, 'bus 1 R');
  assert.ok(maxDiff(r.b2L.map((x) => 4 * x), r.L) < 1e-12, 'bus 2 at n 0.5 = ¼');
  // a source routed to a filter sends with ENV on; the filter output sends too (its level applied)
  const f = play2({ s: st2({ ...p, ...FILT('f', T_LOW12, 0.5), 'f.bus1': 1, 'f.level': 0.25 }) }, 57, 30, { outs: true });
  assert.ok(rms(f.b1L) > 0, 'bus 1 gets A and Filter 1');
  // Phase-1 signature: the buses fold into main
  const fold = play2({ s: st2(p, (s) => { s.osc[0].route = 1; }) }, 57, 30);
  assert.ok(maxDiff(fold.L, r.L.subarray(0, fold.L.length).map((x) => x * 2.25)) < 1e-12, 'render(L, R, N): main + bus 1 + bus 2');
  // ENV toggle off: A at AMP level through the release, then the voice ends when every envelope is idle
  const q = { 'a.uni': nUni(1), 'e1.rel': nTime(0.02), 'e2.rel': nTime(0.3) };
  const envOff = play2({ s: st2(q, (s) => { s.osc[0].route = 1; s.osc[0].env = 0; }) }, 57, 160, { off: 19 });
  const envOn = play2({ s: st2(q, (s) => { s.osc[0].route = 1; }) }, 57, 160, { off: 19 });
  const N = envOn.N, at = (x, t) => rms(x, Math.round(t * 48000 / 128) * N, Math.round(t * 48000 / 128) * N + N);
  assert.ok(at(envOn.L, 0.15) < 1e-3 * at(envOn.L, 0.04), 'ENV on: released');
  assert.ok(Math.abs(at(envOff.L, 0.15) / at(envOff.L, 0.04) - 1) < 0.05, 'ENV off: steady through the ENV 1 release');
  assert.ok(at(envOff.L, 0.3) > 0.5 * at(envOff.L, 0.04), 'ENV off: still sounding while ENV 2 releases');
  assert.ok(at(envOff.L, 0.4) === 0, 'ENV off: the voice ends after the longest release (ENV 2, 0.3 s)');
  assert.equal(envOff.u.vs[0].active, false);
});

/* ------------------------------------------------------------------ filters (§6.13) */

test('M2: Clean Mode (−24 dB in, +24 dB out), types 96–107 through SxFilt2, PZ SVF corners, missing SxFilt2 (§6.13)', () => {
  const sc = dspScope(), S = sc.global('SerumDSP'), fs = 96000;
  const sig = Float64Array.from({ length: 4096 }, (_, i) => 0.6 * Math.sin(2 * Math.PI * 300 * i / fs) + 0.3 * Math.sin(2 * Math.PI * 2100 * i / fs));
  const proc1 = (type, clean, drive = 0, res = 0, sc = 1) => {
    const f = new S.SFilter(fs);
    if (type >= 96) f.prealloc(true, type, type);
    f.setType(type); f.set(800, 800, res, drive, 0.3); f.setClean(clean);
    const L = sig.map((x) => x * sc), R = sig.map((x) => x * sc);
    for (let o = 0; o < L.length; o += 32) f.process(L, R, o, 32);
    return L.map((x) => x / sc);
  };
  // a linear type is unchanged by Clean Mode (the two gains cancel); a driven ladder is cleaner
  assert.ok(maxDiff(proc1(T_LOW12, 1), proc1(T_LOW12, 0)) < 1e-9, 'linear SVF: Clean ≡ normal');
  const lin = proc1(T_MG24, 0, 0, 0, 1e-4), hot = proc1(T_MG24, 0, 1, 0), cl = proc1(T_MG24, 1, 1, 0);   // lin: small-signal
  const g = Math.pow(10, 0.8);                              // drive 1: input gain 10^(16/20)
  const err = (x) => rms(x.map((v, i) => v - g * lin[i]).subarray(2048));
  assert.ok(err(cl) < 0.05 * err(hot), `Clean Mode keeps the driven ladder linear (${err(cl)} vs ${err(hot)})`);
  // every new type runs through its SxFilt2 family inside SFilter, finite and not a pass-through
  for (let t = 96; t < 108; t++) {
    const y = proc1(t, 0, 0.3, 0.4);
    assert.ok(y.every(Number.isFinite), 'type ' + t + ' finite');
    assert.ok(maxDiff(y, sig) > 1e-3, 'type ' + t + ' filters');
  }
  // PZ SVF (103): the corners select LP / BP / HP (X, Y = 0, 0 → TL = LP by default)
  const pz = (x, y) => { const f = new S.SFilter(fs); f.prealloc(true, 103, 103); f.setType(103); f.set(1000, 1000, 0, 0, 0);
    f.setPZ(Float64Array.from(core.PZ_DEFAULT.flat()), 0); f.setXY(x, y);
    const L = Float64Array.from(sig), R = Float64Array.from(sig); for (let o = 0; o < L.length; o += 32) f.process(L, R, o, 32); return L; };
  const lp = pz(0, 0), hp = pz(0, 1);
  const band = (x, f) => mag(x.subarray(2048), f, fs);
  assert.ok(band(lp, 300) > 3 * band(lp, 2100) * 2, 'TL corner: low-pass');
  assert.ok(band(hp, 2100) > band(hp, 300), 'BL corner: high-pass');
  // without SxFilt2 the new types pass audio unfiltered (gain 1), once warned
  const sc0 = dspScope({ overrides: { 'sx-filt2.js': null } }), S0 = sc0.global('SerumDSP');
  const f0 = new S0.SFilter(fs);
  f0.prealloc(true, 96, 107); f0.setType(100); f0.set(800, 800, 0.5, 0.5, 0.5);
  const L = Float64Array.from(sig), R = Float64Array.from(sig);
  f0.process(L, R, 0, 4096);
  sameArr(L, sig, 'unfiltered without SxFilt2');
  assert.equal(sc0.logs.filter((m) => m.level === 'warn' && /SxFilt2 unavailable/.test(m.text)).length, 1);
});

test('M2: Filter 2 is independent; voices preallocate the new types their rows reach; key track in S1 and S2 mode (§6.13)', () => {
  // f2.type modulated by an LFO across the new types: preallocated in apply, nothing allocates while rendering
  const s = st2({ ...FILT('f', T_LOW12), ...FILT('f2', 100), 'l1.rate': 0.6 }, (st) => {
    st.matrix[0] = { ...st.matrix[0], src: 'lfo1', dst: 'f2.type', amt: 0.1 };
  });
  const u = setup2({ s });
  const f2 = u.vs[0].filt2;
  assert.ok(f2 && f2.f2o, 'Filter 2 allocated, new families prepared');
  for (let t = 100; t <= 107; t++) assert.ok(f2.f2o[t - 96] !== null, 'type ' + t + ' preallocated');
  u.vs[0].noteOn(48, 1, false, 1);
  const r = run2(u.S, u.proc, u.vs, 60);
  assert.ok(r.L.every(Number.isFinite) && maxAbs(r.L) > 0.01);
  assert.equal(u.vs[0].filt.type, T_LOW12, 'Filter 1 keeps its type');
  // key tracking: S2 mode follows note′ of the first sounding, tracking oscillator (fold included); S1 the gliding pitch
  const kt = (p, edit, note) => {
    const w = setup2({ s: st2({ ...FILT('f', T_LOW12), ...p }, (st) => { st.filter[0].keytrack = 1; if (edit) edit(st); }) });
    w.vs[0].noteOn(note, 1, false, 1);
    run2(w.S, w.proc, w.vs, 2);
    const fc0 = 8.175798915643707 * Math.pow(2, Math.log2(22050 / 8.175798915643707) * 0.5);
    return Math.log2(w.vs[0].fcOf(w.proc.sx, 0.5, 0) / fc0) * 12;
  };
  { const k = kt({}, null, 72); assert.ok(Math.abs(k - 12) < 1e-6, 'note 72 → +12 st: ' + k); }
  assert.ok(Math.abs(kt({ 'a.track': 0, 'b.on': 1 }, (st) => { st.osc[1].map = { k: [60, 71], v: [1, 127], fold: 1, warp: 0 }; }, 48)) < 1e-6,
    'A untracked: B folded 48 → 60');
  assert.ok(Math.abs(kt({ 'a.track': 0 }, null, 50) + 10) < 1e-6, 'no tracking oscillator: the played key');
  assert.ok(Math.abs(kt({ 'a.track': 0 }, (st) => { st.global.s1 = 1; }, 50) + 10) < 1e-6, 'S1 mode: the voice pitch');
});

/* ------------------------------------------------------------------ pitch (§6.3), tuning (§6.18), MPE (§6.17) */

const TSINE = { ...TABLES2, 'factory:Default': SINE };
// frequency of the voice output (pure tone) after 50 ms
function freq2(s, note = 57, { cpEdit, each, ch = 0, spans = 40 } = {}) {
  const u = setup2({ s, tables: TSINE, cpEdit });
  u.vs[0].noteOn(note, 1, false, 1, ch);
  const r = run2(u.S, u.proc, u.vs, spans, { each: each ? (sp) => each(sp, u) : undefined });
  return zcFreq(r.L, u.proc.fs, Math.round(u.proc.fs * 0.05));
}
const st = (f, ref) => 12 * Math.log2(f / ref);
const F57 = 220;

test('M2: pitch modes — harmonics, ratio (from another oscillator, with its bend), step (19-EDO scale), Hz offset (§6.3.3)', () => {
  const harm = (k) => st(freq2(st2({ 'a.semi': (k + 12) / 24 }, (s) => { s.osc[0].pitch.mode = 'harm'; }), k < 0 ? 81 : 57), k < 0 ? 880 : F57);
  for (const [k, e] of [[0, 0], [1, 12], [2, 19.0196], [-1, -12], [12, 44.4053], [-12, -44.4053]]) {
    assert.ok(Math.abs(harm(k) - e) < 0.002, `harmonics SEM ${k}: ${harm(k)} st (expected ${e})`);
  }
  // B in ratio mode from A (A at +7 st): ×1.5; A's pitch bend reaches B through its source pitch
  const nRatio = (r) => (Math.log2(r) + 4) / 8;
  const ratio = (edit = null, opts = {}) => st(freq2(st2({ 'a.level': 0, 'a.semi': 19 / 24, 'b.on': 1, 'b.ratio': nRatio(1.5), 'b.rand': 0 }, (s) => {
    s.osc[1].pitch = { mode: 'ratio', src: 'A' }; if (edit) edit(s);
  }), 57, opts), F57);
  assert.ok(Math.abs(ratio() - (7 + 12 * Math.log2(1.5))) < 0.002, 'ratio ×1.5 of A');
  assert.ok(Math.abs(ratio(null, { each: (sp, u) => { u.proc.bendRaw = 1; } }) - (9 + 12 * Math.log2(1.5))) < 0.01, 'A bend +2 reaches B');
  assert.ok(Math.abs(ratio((s) => { s.osc[1].pitch.src = 'note'; }) - 12 * Math.log2(1.5)) < 0.002, 'ratio of the note');
  // step mode with a 19-EDO scale: SEM ±k = k steps of 12/19 st, OCT = one period
  const edo = (cp) => { cp.sclN = 19; cp.sclPer = 12; for (let k = 0; k < 19; k++) cp.sclSteps[k] = 12 * k / 19; };
  const step = (semi, oct) => st(freq2(st2({ 'a.semi': (semi + 12) / 24, 'a.oct': (oct + 4) / 8 }, (s) => { s.osc[0].pitch.mode = 'step'; }),
    57, { cpEdit: edo }), F57);
  assert.ok(Math.abs(step(1, 0) - 12 / 19) < 0.002, 'one step');
  assert.ok(Math.abs(step(-3, 1) - (12 - 36 / 19)) < 0.002, 'oct +1, −3 steps');
  assert.ok(Math.abs(step(5, 0) - st(freq2(st2({ 'a.semi': 17 / 24 })), F57)) > 1, 'not semitones');
  // Hz offset: +10 Hz on every unison voice
  assert.ok(Math.abs(freq2(st2({ 'a.hz': 0.6 })) - (F57 + 10)) < 0.01, 'Hz +10');
});

test('M2: S2 bend ranges (g.bu2/g.bd2) vs S1 mode (g.bendup/g.benddn); tuning table; MPE per-voice bend and Expr X (§6.3.2, §6.17, §6.18)', () => {
  const bend = (b, p, s1 = 0) => st(freq2(st2({ 'g.bu2': 12 / 48, 'g.bd2': (48 - 7) / 48, ...p }, (s) => { s.global.s1 = s1; }), 57,
    { each: (sp, u) => { u.proc.bendRaw = b; } }), F57);
  assert.ok(Math.abs(bend(1) - 12) < 0.01, 'S2: bend up 12 (g.bu2)');
  assert.ok(Math.abs(bend(-1) + 7) < 0.01, 'S2: bend down −7 (g.bd2)');
  assert.ok(Math.abs(bend(1, {}, 1) - 2) < 0.01, 'S1 mode: g.bendup (+2)');
  // tuning: a table a quarter tone sharp everywhere; untuned without the use bit
  const tun = (cp) => { cp.use |= 512; for (let k = 0; k < 128; k++) cp.tune[k] = k + 0.5; };
  assert.ok(Math.abs(st(freq2(st2(), 57, { cpEdit: tun }), F57) - 0.5) < 0.002, 'tuned +50 ct');
  assert.ok(Math.abs(st(freq2(st2(), 57, { cpEdit: (cp) => { for (let k = 0; k < 128; k++) cp.tune[k] = k + 0.5; } }), F57)) < 0.002,
    'no use bit: the table is ignored');
  // MPE: member channel bend × CP.mpeBend per voice; the master channel and other channels do not move it
  const mpe = (cp) => { cp.use |= 256; cp.mpeOn = 1; cp.mpeBend = 48; };
  const u = setup2({ s: st2(), tables: TSINE, cpEdit: mpe, n: 2 });
  u.proc.mpe[2 * 4] = 0.25;                                 // channel 2: +12 st
  u.vs[0].noteOn(57, 1, false, 1, 2); u.vs[1].noteOn(57, 1, false, 1, 3);
  run2(u.S, u.proc, u.vs, 20);
  const fA = u.vs[0].fB[0], fB = u.vs[1].fB[0];
  assert.ok(Math.abs(st(fA, fB) - 12) < 1e-3, 'voice on channel 2 bends +12, channel 3 unchanged: ' + st(fA, fB));
  assert.ok(Math.abs(st(fB, F57)) < 1e-6);
  // XYZ → Macros 1–3 per voice (global.mpe.xyz 1): macro 1 = (x + 1)/2, macro 2 = Y, macro 3 = Z of the voice's channel
  const xyz = setup2({ s: st2({}, (st) => { st.global.mpe = { on: 1, bend: 48, xyz: 1 }; }), n: 2 });
  assert.equal(xyz.cp.use & 256, 256);
  const E = [[2, 0.5, 0.3, 0.8], [3, -1, 0.9, 0.1]];
  for (const [ch, x, y, z] of E) { xyz.proc.mpe[ch * 4 + 3] = x; xyz.proc.mpe[ch * 4 + 1] = y; xyz.proc.mpe[ch * 4 + 2] = z; }
  xyz.vs[0].noteOn(57, 1, false, 1, 2); xyz.vs[1].noteOn(60, 1, false, 1, 3);
  run2(xyz.S, xyz.proc, xyz.vs, 20);
  E.forEach(([ch, x, y, z], k) => {
    const m = xyz.vs[k].src;
    assert.ok(Math.abs(m[24] - (x + 1) / 2) < 1e-3 && Math.abs(m[25] - y) < 1e-3 && Math.abs(m[26] - z) < 1e-3,
      `channel ${ch}: macros ${m[24]}, ${m[25]}, ${m[26]}`);
  });
  // Expr X = CC10 (proc.mpe[ch·4 + 3], −1 … +1) on a member channel; ignored on channel 1; CP.mpeBendX takes the bend
  const S_MPEX = 29;
  for (const [x, ch, bx, want] of [[-1, 2, 0, -1], [0, 2, 0, 0], [1, 2, 0, 1], [1, 1, 0, 0], [1, 2, 1, 0.25]]) {
    const w = setup2({ s: st2(), cpEdit: (cp) => { mpe(cp); cp.mpeBendX = bx; } });
    w.proc.mpe[ch * 4 + 3] = x; w.proc.mpe[ch * 4] = 0.25;
    w.vs[0].noteOn(57, 1, false, 1, ch);
    run2(w.S, w.proc, w.vs, 20);
    assert.ok(Math.abs(w.vs[0].src[S_MPEX] - want) < 1e-3, `mpex (x ${x}, ch ${ch}, bendX ${bx}) = ${w.vs[0].src[S_MPEX]}`);
  }
});

/* ------------------------------------------------------------------ note-on: phases (§6.4), keyboard map (§6.2), VC (§6.16) */

test('M2: phase memory — S1 knob-end rule for A/B vs the S2 menu (all / contig / voice); Phase Legato (§6.4, §6.21 item 6)', () => {
  const ph0 = (p, edit, notes = 1) => {
    const u = setup2({ s: st2(p, edit) });
    const out = [];
    for (let k = 0; k < notes; k++) {
      u.vs[0].noteOn(57 + k, 1, false, 1);
      out.push(Array.from(u.vs[0].uPh.subarray(0, 4)).concat(Array.from(u.vs[0].uPh.subarray(32, 34))));
      run2(u.S, u.proc, u.vs, 3);
      u.vs[0].noteOff(0); run2(u.S, u.proc, u.vs, 20);
    }
    return { out, u };
  };
  const ms = core.defaultSerum().osc[0].memSet;
  // S2 'all': PHASE offset + RAND·u, no knob-end rule at PHASE 360° / RAND 100 %
  let r = ph0({ 'a.phase': 0.25, 'a.uni': nUni(4) });
  assert.deepEqual(r.out[0].slice(0, 4), [0.25, 0.25, 0.25, 0.25]);
  r = ph0({ 'a.phase': 1, 'a.rand': 1, 'a.uni': nUni(2) }, null, 2);
  assert.notDeepEqual(r.out[0].slice(0, 2), r.out[1].slice(0, 2), 'S2: random each note at the knob ends');
  // 'voice' (Phase-1 MemTrig): memSet + PHASE every note
  r = ph0({ 'a.phase': 0.1, 'a.uni': nUni(4) }, (s) => { s.osc[0].phMem = 'voice'; }, 2);
  for (const o of r.out) o.slice(0, 4).forEach((x, i) => assert.ok(Math.abs(x - ((ms[i] + 0.1) % 1)) < 1e-12, 'voice ' + i));
  // 'contig' (Phase-1 Mem): the second note continues the processor's phase memory (+ memSet)
  r = ph0({ 'a.uni': nUni(2) }, (s) => { s.osc[0].phMem = 'contig'; }, 2);
  assert.ok(Math.abs(((r.out[1][1] - r.out[1][0]) % 1 + 1) % 1 - ((ms[1] - ms[0]) % 1 + 1) % 1) < 1e-9, 'relative phases = memSet');
  assert.ok(Math.abs(r.out[1][0] - r.out[0][0]) > 1e-3, 'continues (not restarted)');
  // S1 mode: PHASE ≥ 0.9995 is Mem, + RAND ≥ 0.9995 MemTrig (A/B); phMem of A/B ignored; OSC C uses its menu
  r = ph0({ 'a.phase': 1, 'a.rand': 1, 'a.uni': nUni(3), 'c.on': 1, 'c.phase': 0.2 }, (s) => { s.global.s1 = 1; s.osc[0].phMem = 'all'; s.osc[2].phMem = 'voice'; }, 2);
  r.out.forEach((o) => o.slice(0, 3).forEach((x, i) => assert.ok(Math.abs(x - ms[i]) < 1e-12, 'S1 MemTrig at the knob ends')));
  const msC = core.defaultSerum().osc[2].memSet;
  r.out.forEach((o) => assert.ok(Math.abs(o[4] - ((msC[0] + 0.2) % 1)) < 1e-12, 'OSC C: its phMem (voice) in S1 mode'));
  r = ph0({ 'a.phase': 1, 'a.rand': 0, 'a.uni': nUni(2) }, (s) => { s.global.s1 = 1; }, 2);
  assert.ok(Math.abs(r.out[1][0] - r.out[0][0]) > 1e-3 && Math.abs(((r.out[1][1] - r.out[1][0]) % 1 + 1) % 1 - ((ms[1] - ms[0]) % 1 + 1) % 1) < 1e-9,
    'S1 Mem (PHASE at the end): continues with the memSet spread');
  // Phase Legato inverts the steal rule: a steal (note-on on a sounding voice) resets the phases
  const steal = (pl) => {
    const u = setup2({ s: st2({ 'a.phase': 0.25 }, (s) => { s.osc[0].phLegato = pl; }) });
    u.vs[0].noteOn(57, 1, false, 1); run2(u.S, u.proc, u.vs, 3);
    const before = u.vs[0].uPh[0];
    u.vs[0].noteOn(60, 1, false, 1);
    return [before, u.vs[0].uPh[0]];
  };
  const [b0, a0] = steal(0), [, a1] = steal(1);
  assert.equal(a0, b0, 'Phase-1 rule: a steal keeps the phase running');
  assert.equal(a1, 0.25, 'Phase Legato: a steal restarts at PHASE');
});

test('M2: keyboard mapping — key/velocity ranges, fold, warp-only modulators (§6.2 inv B21)', () => {
  const map = (k, v = [1, 127], fold = 0, warp = 0) => ({ k, v, fold, warp });
  // out of range: silent; fold: plays the folded key
  const silent = play2({ s: st2({}, (s) => { s.osc[0].map = map([60, 72]); }), tables: TSINE }, 48);
  assert.equal(maxAbs(silent.L), 0, 'A outside its key range is silent');
  const f = freq2(st2({}, (s) => { s.osc[0].map = map([60, 72], [1, 127], 1); }), 45);
  assert.ok(Math.abs(st(f, 440)) < 0.01, 'note 45 folds two octaves up to 69: ' + f);
  const fold = (lo, hi, n) => 69 + st(freq2(st2({}, (s) => { s.osc[0].map = map([lo, hi], [1, 127], 1); }), n), 440);
  assert.ok(Math.abs(fold(60, 64, 57) - 60) < 0.01, 'no octave fits (57 or 69): the nearer bound 60');
  assert.ok(Math.abs(fold(60, 61, 50) - 61) < 0.01, 'no octave fits (50 or 62): the nearer bound 61');
  assert.ok(Math.abs(fold(60, 61, 75) - 61) < 0.01, '75 → 63 or 51: 61');
  assert.ok(Math.abs(fold(48, 72, 100) - 64) < 0.01, '100 folds down to 64');
  const vel = play2({ s: st2({}, (s) => { s.osc[0].map = map([0, 127], [100, 127]); }) }, 57, 10, { vel: 0.5 });
  assert.equal(maxAbs(vel.L), 0, 'velocity 64 outside 100–127');
  // B frequency-modulated by A: A out of range stops modulating unless its map has warp set
  const fm = { 'b.on': 1, 'a.level': 0, 'b.w1': nEnum(W2('fm_o1'), 81), 'b.warp': 0.5 };
  const plainB = play2({ s: st2({ 'b.on': 1, 'a.level': 0 }) }, 48);
  const noWarp = play2({ s: st2(fm, (s) => { s.osc[0].map = map([60, 72]); }) }, 48);
  const warp = play2({ s: st2(fm, (s) => { s.osc[0].map = map([60, 72], [1, 127], 0, 1); }) }, 48);
  sameArr(noWarp.L, plainB.L, 'unavailable modulator: the slot acts as Off');
  assert.ok(maxDiff(warp.L, plainB.L) > 0.05, 'map.warp keeps A as a modulator');
  assert.equal(maxDiff(play2({ s: st2(fm) }, 48).L, warp.L), 0, 'in range ≡ warp-only modulator');
});

test('M2: Voice Control per-note offsets — pan, detune, cutoff (§6.2, §6.16); selection per channel', () => {
  const vc = (steps, sel = [1, 1, 1, 1, 1]) => (s) => { s.vc.steps[0] = steps; s.vc.sel = sel; };
  const r = play2({ s: st2({}, vc([1, 0, 0, 0, 0, 0])) });
  assert.equal(r.u.cp.use & 1024, 1024);
  assert.ok(maxAbs(r.L) < 1e-12 && maxAbs(r.R) > 0.1, 'pan +1: hard right');
  const r2 = play2({ s: st2({}, vc([1, 0, 0, 0, 0, 0], [0, 1, 1, 1, 1])) });
  assert.ok(Math.abs(maxAbs(r2.L) - maxAbs(r2.R)) < 1e-9, 'A not selected: centred');
  assert.ok(Math.abs(st(freq2(st2({}, vc([0, 0.5, 0, 0, 0, 0]))), F57) - 0.5) < 0.002, 'detune +50 ct');
  const u = setup2({ s: st2({ ...FILT('f', T_LOW12) }, vc([0, 0, 0.4, 0, 0, 0])) });
  u.vs[0].noteOn(57, 1, false, 1);
  run2(u.S, u.proc, u.vs, 2);
  const fc = (n) => 8.175798915643707 * Math.pow(2, Math.log2(22050 / 8.175798915643707) * n);
  assert.ok(Math.abs(u.vs[0].fcOf(u.proc.sx, 0.3, 0) / fc(0.5) - 1) < 1e-6, 'cutoff n + 0.5·0.4');
});

/* ------------------------------------------------------------------ sub and noise (§6.11) */

test('M2: sub — S2 shapes (Triangle), level law n² (S1: n), start phase, Contiguous (§6.11.1)', () => {
  const sub = (p, edit, note = 57, spans = 20) => play2({ s: st2({ 'a.on': 0, 's.on': 1, 's.level': 0.5, ...p }, (s) => { s.sub.route = 1; if (edit) edit(s); }) }, note, spans);
  const s2 = sub({}), s1 = sub({}, (s) => { s.global.s1 = 1; });
  assert.ok(Math.abs(maxAbs(s2.L) / maxAbs(s1.L) - 0.5) < 1e-3, 'S2 level n² = ¼ vs S1 n = ½');
  // shapes: s.shp selects SUB_IDS2 (index 2 = Triangle, absent from the S1 list)
  const tri = sub({ 's.shp': 2 / 5 }), sine = sub({ 's.shp': 0 });
  const crest = (x) => maxAbs(x, 4800) / rms(x, 4800);
  assert.ok(Math.abs(crest(tri.L) - Math.sqrt(3)) < 0.05, 'triangle crest √3: ' + crest(tri.L));
  assert.ok(Math.abs(crest(sine.L) - Math.SQRT2) < 0.02, 'sine crest √2');
  // start phase s.phase/360 (sine table −sin: φ 0.25 starts at the trough); then Contiguous continues the last phase
  const ph = sub({ 's.phase': 0.25 }, null, 57, 1);
  assert.ok(Math.abs(ph.L[0] - (-1 * 0.25 / ph.u.proc.CH)) < 1e-4, 'φ 0.25 of −sin (level ¼, first sample of the ENV 1 ramp): ' + ph.L[0]);
  const u = setup2({ s: st2({ 'a.on': 0, 's.on': 1 }, (s) => { s.sub.route = 1; s.sub.contig = 1; }) });
  u.vs[0].noteOn(57, 1, false, 1); run2(u.S, u.proc, u.vs, 7);
  u.vs[0].noteOff(0); run2(u.S, u.proc, u.vs, 10);
  assert.equal(u.vs[0].active, false);
  const last = u.proc.sx.subPh;
  assert.ok(last > 0 && last < 1);
  u.vs[0].noteOn(60, 1, false, 1);
  assert.equal(u.vs[0].sPh, last, 'Contiguous: the new note starts at the last sub phase of the processor');
});

test('M2: colour noises — in-band level at OS 1/2/4, pink/brown slopes, Geiger rate/symmetry, STEREO correlation (lags −4…4), FILTER tilt corners (§6.11.2)', () => {
  const OSn = 2, fs = 96000;
  // Geiger's gain at rate f: 40 clicks/s of ±(0.5 + 0.5u) (E[a²] = 7/12) decaying by dec per sample at −12 dBFS RMS
  const kG = (f) => { const dec = Math.exp(-1 / (0.00015 * f)); return Math.pow(10, -12 / 20) / Math.sqrt(40 / f * (7 / 12) / (1 - dec * dec)); };
  const noise = (src, p = {}, secs = 1.2) => play2({ s: st2({ 'a.on': 0, 'n.on': 1, 'n.level': 1, ...p }, (s) => { s.noise.src = src; s.noise.route = 1; }) },
    57, spansOf(secs));
  // averaged power spectrum (Hann, 8192) of x from 0.1 s; mean power density in [f0, f1]
  const psd = (x) => {
    const N = 8192, acc = new Float64Array(N / 2), w = Float64Array.from({ length: N }, (_, n) => 0.5 - 0.5 * Math.cos(2 * Math.PI * n / N));
    let k = 0;
    for (let o = Math.round(0.1 * fs); o + N <= x.length; o += N / 2, k++) {
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = x[o + i] * w[i];
      fft(re, im, false);
      for (let b = 0; b < N / 2; b++) acc[b] += re[b] * re[b] + im[b] * im[b];
    }
    return (f0, f1) => { let e = 0, n = 0; for (let b = Math.round(f0 * N / fs); b <= Math.round(f1 * N / fs); b++) { e += acc[b]; n++; } return e / n / k; };
  };
  const slope = (x, fa, fb) => { const P = psd(x); return 10 * Math.log10(P(fb / 1.2, fb * 1.2) / P(fa / 1.2, fa * 1.2)) / Math.log2(fb / fa); };
  const white = noise('color:White', { 'n.stereo': 0 });
  assert.ok(Math.abs(slope(white.L, 400, 6400)) < 0.5, 'white flat');
  // level: −12 dBFS RMS in the band the engine's decimator keeps (≤ base/2 = 24 kHz) at every Quality — white is
  // generated at the OS rate (K_WHITE·√OS), pink and brown hold their power far below 24 kHz
  const inband = (x, fsx) => {                                // (the last 1.37 s at every OS: brown's slow swings average out alike)
    const N = 65536 * Math.round(fsx / 48000), re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[x.length - N + i];
    fft(re, im, false);
    let e = 0;
    for (let k = 1; k <= Math.floor(24000 * N / fsx); k++) e += 2 * (re[k] * re[k] + im[k] * im[k]);
    return 10 * Math.log10(e / N / N);
  };
  for (const [src, tol] of [['color:White', 0.3], ['color:Pink', 1.5], ['color:Brown', 1.5]]) {
    const row = [];
    for (const OS of [1, 2, 4]) {
      const r = play2({ s: st2({ 'a.on': 0, 'n.on': 1, 'n.level': 1, 'n.stereo': 0 }, (s) => { s.noise.src = src; s.noise.route = 1; }), OS }, 57, 600);
      const l = inband(r.L, 48000 * OS);
      row.push(l.toFixed(2));
      assert.ok(Math.abs(l + 12) <= tol, src + ' in-band level at OS ' + OS + ': ' + l.toFixed(2) + ' dBFS');
    }
    console.log(`  ${src} in-band (≤ 24 kHz) RMS at OS 1/2/4: ${row.join(' / ')} dBFS`);
  }
  const pink = noise('color:Pink', { 'n.stereo': 0 }), brown = noise('color:Brown', { 'n.stereo': 0 });
  assert.ok(Math.abs(slope(pink.L, 200, 3200) + 3) <= 1, 'pink −3 dB/oct: ' + slope(pink.L, 200, 3200).toFixed(2));
  assert.ok(Math.abs(slope(brown.L, 300, 4800) + 6) <= 1.5, 'brown −6 dB/oct: ' + slope(brown.L, 300, 4800).toFixed(2));
  for (const [x, name] of [[pink, 'pink'], [brown, 'brown']]) {
    const l = 20 * Math.log10(rms(x.L, 9600));
    assert.ok(Math.abs(l + 12) < 1.5, name + ' level ' + l.toFixed(2));
  }
  // Geiger: Poisson clicks at 40/s (n.pitch 0 st), each click × kG (§6.11.2: −12 dBFS RMS at 40/s)
  const g = noise('color:Geiger', { 'n.stereo': 0 }, 2.1);
  let clicks = 0;
  for (let i = 9600; i < g.L.length; i++) if (Math.abs(g.L[i] - g.L[i - 1]) > 0.35 * kG(fs)) clicks++;
  assert.ok(clicks > 50 && clicks < 115, 'Geiger ≈ 80 clicks in 2 s: ' + clicks);
  // Geiger level: −12 dBFS RMS at 40 clicks/s at every Quality (4 s ≈ 160 clicks: ±0.4 dB of Poisson spread), and the RMS
  // follows the click rate (PITCH +24 st: 160/s → −6 dBFS) with the click size unchanged
  {
    const row = [];
    for (const OS of [1, 2, 4]) {
      const r = play2({ s: st2({ 'a.on': 0, 'n.on': 1, 'n.level': 1, 'n.stereo': 0 }, (st) => { st.noise.src = 'color:Geiger'; st.noise.route = 1; }), OS }, 57, spansOf(4.1));
      const l = 20 * Math.log10(rms(r.L, Math.round(0.1 * 48000 * OS)));
      row.push(l.toFixed(2));
      assert.ok(Math.abs(l + 12) <= 1.5, 'Geiger RMS at OS ' + OS + ': ' + l.toFixed(2) + ' dBFS');
    }
    const hi = noise('color:Geiger', { 'n.stereo': 0, 'n.pitch': 0.75 }, 2.1), lh = 20 * Math.log10(rms(hi.L, 9600));
    console.log(`  Geiger RMS at 40 clicks/s, OS 1/2/4: ${row.join(' / ')} dBFS; at 160/s (PITCH +24 st): ${lh.toFixed(2)} dBFS`);
    assert.ok(Math.abs(lh + 12 - 10 * Math.log10(4)) <= 1, 'Geiger RMS follows the click rate: ' + lh.toFixed(2));
  }
  // Geiger clicks ±(0.5 + 0.5u): sign and size drawn separately — symmetric sizes, balanced signs, no DC
  {
    const G = play2({ s: st2({ 'a.on': 0, 'n.on': 1, 'n.level': 1, 'n.stereo': 0, 'n.pitch': 0.9 }, (s) => { s.noise.src = 'color:Geiger'; s.noise.route = 1; }), OS: 1 },
      57, spansOf(4));
    const x = G.L.map((v) => v / kG(48000));                // (in click units: the size §6.11.2 gives)
    let np = 0, nn = 0, sp = 0, sn = 0, mx = 0, dc = 0;
    for (let i = 0; i < x.length; i++) dc += x[i];
    dc /= x.length;
    for (let i = 1; i < x.length; i++) {
      const d = x[i] - x[i - 1];
      if (d > 0.2) { np++; sp += d; } else if (d < -0.2) { nn++; sn -= d; }
      mx = Math.max(mx, Math.abs(d));
    }
    console.log(`  Geiger (n.pitch 0.9, 4 s): +${np} clicks avg ${(sp / np).toFixed(3)}, −${nn} avg ${(sn / nn).toFixed(3)}, DC ${dc.toExponential(2)}`);
    assert.ok(np > 400 && nn > 400 && Math.abs(np - nn) < 0.15 * (np + nn), 'signs balanced: ' + np + ' / ' + nn);
    assert.ok(Math.abs(sp / np - 0.75) < 0.05 && Math.abs(sn / nn - 0.75) < 0.05, 'sizes 0.5…1 in both directions: ' + (sp / np).toFixed(3) + ' / ' + (sn / nn).toFixed(3));
    assert.ok(mx < 1.2, 'no click above 1 (bar overlaps): ' + mx.toFixed(3));
    assert.ok(Math.abs(dc) < 5e-3, 'no DC: ' + dc.toExponential(2));
  }
  // STEREO: correlation 1 at 0, ≈ 0 at 1, 1/√2 at 0.5
  const corr = (r) => { let a = 0, b = 0, c = 0; for (let i = 9600; i < r.L.length; i++) { a += r.L[i] * r.R[i]; b += r.L[i] * r.L[i]; c += r.R[i] * r.R[i]; } return a / Math.sqrt(b * c); };
  assert.ok(corr(white) > 0.999999, 'STEREO 0: mono');
  assert.ok(Math.abs(corr(noise('color:White', { 'n.stereo': 1 }))) < 0.05, 'STEREO 1: decorrelated');
  // the two streams are unrelated at every lag (not one stream shifted by a sample): corr(L[k], R[k + lag]), lag −4…4
  for (const [src, tol] of [['color:White', 0.05], ['color:Pink', 0.3], ['color:Brown', 0.3]]) {
    const r = noise(src, { 'n.stereo': 1 }, 2.5), L = r.L, R = r.R, cs = [];
    for (let lag = -4; lag <= 4; lag++) {
      let a = 0, b = 0, c = 0;
      for (let i = 9600; i < L.length - 4; i++) { const y = R[i + lag]; a += L[i] * y; b += L[i] * L[i]; c += y * y; }
      cs.push(a / Math.sqrt(b * c));
    }
    assert.ok(cs.every((x) => Math.abs(x) < tol), src + ' STEREO 1, lags −4…4: ' + cs.map((x) => x.toFixed(3)).join(' '));
  }
  assert.ok(Math.abs(corr(noise('color:White', { 'n.stereo': 0.5 })) - Math.SQRT1_2) < 0.05, 'STEREO ½: 1/√2');
  // FILTER: c = +½ → one-pole LP at 20000·2^−4.5 Hz, c = −½ → HP at 20·2^4.5 Hz (−3 dB there)
  const lp = psd(noise('color:White', { 'n.stereo': 0, 'n.color': 0.75 }).L), fLp = 20000 * Math.pow(2, -4.5);
  assert.ok(Math.abs(10 * Math.log10(lp(fLp * 0.95, fLp * 1.05) / lp(40, 80)) + 3) < 1, 'LP corner −3 dB');
  const hp = psd(noise('color:White', { 'n.stereo': 0, 'n.color': 0.25 }).L), fHp = 20 * Math.pow(2, 4.5);
  assert.ok(Math.abs(10 * Math.log10(hp(fHp * 0.95, fHp * 1.05) / hp(8000, 12000)) + 3) < 1, 'HP corner −3 dB');
  void OSn;
});

test('M2: colour noises do not depend on the Quality — band levels at OS 1/2/4 within ±1 dB (brown included); the raw noise (warp Noise modulator, `noise` source) has the same RMS at every OS (§6.11.2)', () => {
  // Welch power per band (Hann, 4096·OS points: the same 11.7 Hz resolution at every OS; p_k = 2|X_k|²/(N·Σw²), Σ p_k = mean x²)
  const bands = (x, OS) => {
    const N = 4096 * OS, f = 48000 * OS, w = Float64Array.from({ length: N }, (_, n) => 0.5 - 0.5 * Math.cos(2 * Math.PI * n / N));
    let w2 = 0;
    for (let n = 0; n < N; n++) w2 += w[n] * w[n];
    const acc = new Float64Array(N / 2);
    let k = 0;
    for (let o = Math.round(0.2 * f); o + N <= x.length; o += N / 2, k++) {
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = x[o + i] * w[i];
      fft(re, im, false);
      for (let b = 1; b < N / 2; b++) acc[b] += 2 * (re[b] * re[b] + im[b] * im[b]) / (N * w2);
    }
    const band = (f0, f1) => { let e = 0; for (let b = Math.ceil(f0 * N / f); b <= Math.floor(f1 * N / f); b++) e += acc[b]; return 10 * Math.log10(e / k); };
    return [band(100, 1000), band(1000, 5000), band(5000, 20000)];
  };
  for (const src of ['color:White', 'color:Pink', 'color:Brown']) {
    const rows = [];
    for (const OS of [1, 2, 4]) {
      const r = play2({ s: st2({ 'a.on': 0, 'n.on': 1, 'n.level': 1, 'n.stereo': 0 }, (st) => { st.noise.src = src; st.noise.route = 1; }), OS }, 57, spansOf(3));
      rows.push(bands(r.L, OS));
    }
    console.log(`  ${src} band levels 0.1–1 / 1–5 / 5–20 kHz at OS 1, 2, 4: ` + rows.map((b) => b.map((x) => x.toFixed(2)).join(' / ')).join(' | ') + ' dB');
    for (let j = 0; j < 3; j++) {
      for (let q = 1; q < 3; q++) assert.ok(Math.abs(rows[q][j] - rows[0][j]) <= 1, src + ' band ' + j + ' at OS ' + (1 << q) + ': ' + rows[q][j].toFixed(2) + ' vs OS 1 ' + rows[0][j].toFixed(2));
    }
  }
  // the raw noise: the voice's nLast (the `noise` matrix source, §5.3) per span, and the raw buffer the Noise warp
  // modulator reads; white at K_WHITE (−12 dBFS RMS per sample) at every OS, not × √OS
  for (const src of ['color:White', 'color:Pink', 'color:Brown']) {
    const row = [];
    for (const OS of [1, 2, 4]) {
      const u = setup2({ s: st2({ 'n.on': 1, 'n.level': 1, 'n.stereo': 0 }, (st) => { st.noise.src = src; st.noise.route = 1; }), OS });
      const v = u.vs[0];
      v.noteOn(57, 1, false, 1);
      let e = 0, n = 0;
      run2(u.S, u.proc, u.vs, 800, { each: (sp) => { if (sp > 20) { e += v.nLast * v.nLast; n++; } } });
      row.push(20 * Math.log10(Math.sqrt(e / n)));
    }
    console.log(`  ${src} raw noise (nLast) RMS at OS 1/2/4: ${row.map((x) => x.toFixed(2)).join(' / ')} dBFS`);
    for (let q = 0; q < 3; q++) assert.ok(Math.abs(row[q] + 12) <= (src === 'color:White' ? 0.6 : 1.5), src + ' raw noise at OS ' + (1 << q) + ': ' + row[q].toFixed(2));
    assert.ok(Math.abs(row[2] - row[0]) <= (src === 'color:White' ? 0.6 : 1.5), src + ' raw noise OS 4 vs OS 1');
  }
});

/* ------------------------------------------------------------------ oscillator types through the voice (§11.8) */

// a 1 s mono sine at 375 Hz (period 128 frames) at 48 kHz: root 69 + 12·log2(375/440); levels 0–2
const ROOT375 = 69 + 12 * Math.log2(375 / 440);
function sineSmp(id, len = 48000) {
  const levels = [];
  for (let l = 0, n = len; l < 3; l++, n = Math.floor(n / 2)) levels.push({ len: n, L: Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 375 * (i << l) / 48000)), R: null });
  return { id, v: 1, kind: 'smp', bytes: 0, rate: 48000, ch: 1, len, root: ROOT375, loop: { start: 0, end: len }, peak: 0.5, levels };
}
// a spectral analysis of a steady 937.5 Hz sine (bin 40 of N 2048, hop 512: the phase advance is a multiple of 2π)
function sineSpec(id, frames = 64) {
  const N = 2048, nb = N / 2 + 1, mag = new Float32Array(frames * nb), ph = new Float32Array(frames * nb);
  for (let f = 0; f < frames; f++) mag[f * nb + 40] = 0.5;
  return { id, v: 1, kind: 'spec', bytes: 0, rate: 48000, ch: 1, len: frames * 512, N, hop: 512, frames, mag, ph, trans: new Uint8Array(frames), peak: 0.5 };
}
test('M2: Sample / Granular / Spectral oscillators through the voice: pitch from ctx.f, missing asset ⇒ silence then sound, X|Y Level, streams back at the end (§11.8)', () => {
  const smp = (p = {}, edit = null) => st2(p, (s) => { s.osc[0].type = 'sample'; s.osc[0].smp = 'smp:sine'; s.osc[0].smpo.loop = 1; s.osc[0].route = 1; if (edit) edit(s); });
  // pitch: note 69 plays the 375 Hz sample at 440 Hz; OSC C (sample) as well
  const u = setup2({ s: smp(), assets: { 'smp:sine': sineSmp('smp:sine') } });
  assert.equal(u.cp.oType[0], 2);
  u.vs[0].noteOn(69, 1, false, 1);
  let r = run2(u.S, u.proc, u.vs, 40);
  assert.ok(Math.abs(st(zcFreq(r.L, u.proc.fs, 4800), 440)) < 0.01, 'Sample: 440 Hz at note 69');
  assert.ok(u.vs[0].ox[0] !== null && u.vs[0].ox[0].sel === 1);
  // Multisample: one looping zone on the same sample (root ROOT375) — 440 Hz at note 69
  const ms = setup2({ s: st2({ 'a.on': 0, 'b.on': 1, 'b.rand': 0 }, (s) => { s.osc[1].type = 'multi'; s.osc[1].multi = 'msmp:one'; }),
    assets: { 'smp:sine': sineSmp('smp:sine'), 'msmp:one': { id: 'msmp:one', v: 1, kind: 'multi', bytes: 0, zones: [{ lo: 0, hi: 127, vlo: 0, vhi: 127,
      root: ROOT375, tune: 0, gain: 0, pan: 0, smp: 'smp:sine', mode: 'loop', ls: 0, le: 48000, off: 0, env: null, rr: [1, 1], vt: 1 }] } } });
  assert.equal(ms.cp.oType[1], 1);
  ms.vs[0].noteOn(69, 1, false, 1);
  r = run2(ms.S, ms.proc, ms.vs, 40);
  assert.ok(Math.abs(st(zcFreq(r.L, ms.proc.fs, 4800), 440)) < 0.01, 'Multisample: 440 Hz at note 69');
  // missing asset: silent; it arrives mid-note and sounds within a chunk
  const w = setup2({ s: smp() });
  w.vs[0].noteOn(69, 1, false, 1);
  r = run2(w.S, w.proc, w.vs, 10);
  assert.equal(maxAbs(r.L), 0, 'missing entry: silence');
  assert.equal(w.B.storeAsset('smp:sine', sineSmp('smp:sine')), true);
  r = run2(w.S, w.proc, w.vs, 4);
  assert.ok(maxAbs(r.L, 0, 2 * r.N) > 0.01, 'audible right after it arrives');
  // Granular: X|Y Y → Level (Replace) applied by the voice: level² scales the output
  const gran = (y) => {
    const g = setup2({ s: st2({ 'a.gy': y, 'a.dens': 0.8 }, (s) => { s.osc[0].type = 'gran'; s.osc[0].smp = 'smp:sine'; s.osc[0].route = 1;
      s.osc[0].xy = { on: 1, y: 1, yMode: 1 }; }), assets: { 'smp:sine': sineSmp('smp:sine') } });
    g.vs[0].noteOn(60, 1, false, 1);
    return run2(g.S, g.proc, g.vs, 60).L;
  };
  const g1 = gran(1), gh = gran(0.5);
  assert.ok(rms(g1) > 0.01, 'granular sounds');
  assert.ok(Math.abs(rms(gh) / rms(g1) - 0.25) < 1e-6, 'X|Y Level (Replace) y ½ → level ½ → ¼: ' + rms(gh) / rms(g1));
  // Spectral: renders, and the voice gives its streams back when it ends (§6.19)
  const sp = setup2({ s: st2({ 'e1.rel': nTime(0.01) }, (s) => { s.osc[0].type = 'spec'; s.osc[0].smp = 'smp:sine'; s.osc[0].route = 1; }),
    assets: { 'spec:smp:sine': sineSpec('spec:smp:sine') } });
  assert.equal(sp.cp.oType[0], 4);
  sp.vs[0].noteOn(60, 1, false, 1);
  r = run2(sp.S, sp.proc, sp.vs, 60);
  assert.ok(r.L.every(Number.isFinite) && rms(r.L, r.L.length / 2) > 0.005, 'Spectral sounds');
  const pool = sp.sc.global('SxSpec').poolOf(sp.proc.sx);
  const held = () => sp.vs[0].ox[0].nS;
  assert.ok(pool && held() >= 1, 'streams held while sounding');
  sp.vs[0].noteOff(0);
  run2(sp.S, sp.proc, sp.vs, 30);
  assert.equal(sp.vs[0].active, false);
  assert.equal(held(), 0, 'streams returned when the voice ended');
});

/* ------------------------------------------------------------------ neutral terms (§0.7, serum-dsp rows) */

// serum-dsp.js with the code of a term removed (each edit must match exactly once, so a refactor fails here loudly)
function withoutTerm(edits) {
  let src = dspSource('serum-dsp.js');
  for (const [a, b] of edits) {
    assert.equal(src.split(a).length - 1, 1, 'transform target found exactly once: ' + a);
    src = src.replace(a, b);
  }
  return dspScope({ overrides: { 'serum-dsp.js': src } });
}
// the patch rendered by the real code and by the code without the term: bit-identical on every output
// (ch: the notes' MPE member channel; differ: the positive control — the term is NOT neutral in this patch, so removing its
// code must change the output: the setup reaches the term and the identity check above can fail)
function neutralSame(name, s, edits, { notes = [[57, 1], [64, 0.7]], spans = 40, cpEdit = null, each = null, tables = TABLES2, ch = 0, differ = false } = {}) {
  const go = (scope) => {
    const u = setup2({ s, scope, n: notes.length, cpEdit, tables });
    notes.forEach(([k, v], i) => u.vs[i].noteOn(k, v, false, 1, ch));
    return run2(u.S, u.proc, u.vs, spans, { outs: true, each: each ? (sp) => each(sp, u) : undefined });
  };
  const a = go(null), b = go(withoutTerm(edits));
  assert.ok(maxAbs(a.L) + maxAbs(a.dL) > 1e-3, name + ': audible');
  if (differ) { assert.ok(OUTS.some((k) => maxDiff(a[k], b[k]) > 1e-6), name + ': the term changes this patch (positive control)'); return; }
  for (const k of OUTS) sameArr(a[k], b[k], name + ' (' + k + ')');
}
test('M2 §0.7: pitch terms at neutral — s.crs, k.hz, k.ratio / harmonics / step modes (mode semi), VC detune, MPE, tuning', () => {
  const s = st2({ 's.on': 1, 'b.on': 1, 'c.on': 1, 'a.uni': nUni(3), 'a.det': 0.3, 'n.on': 1, 'g.bu2': 0.25 }, (st) => { st.noise.src = 'color:Pink'; });
  const each = (sp, u) => { u.proc.bendRaw = sp > 10 ? 0.5 : 0; };
  neutralSame('s.crs n 0.5', s, [['if (!s1) { const c = eff[S_CRS]; if (c !== 0.5) P += 128 * c - 64; }', '']], { each });
  neutralSame('k.hz n 0.5', s, [['this.cHz[o] = hz === 0.5 ? 0 : 100 * hz - 50;', 'this.cHz[o] = 0;']], { each });
  neutralSame('pitch mode semi', s, [['if (mode === PM_RATIO) {', 'if (false) {'], ['if (mode === PM_HARM) {', 'if (false) {'],
    ['} else if (mode === PM_STEP && sx.sclN > 0) {', '} else if (false) {']], { each });
  neutralSame('VC inactive (use & 1024 = 0)', s, [['this.pDet = sx.vcOn !== 0 ? this.vcD / 100 : 0;', 'this.pDet = 0;'],
    ['if (sx.vcOn !== 0 && sx.vcSel[o] !== 0 && this.vcP !== 0) { pan += this.vcP; pan = pan > -1 ? (pan < 1 ? pan : 1) : -1; }', ''],
    ['if (sx.vcOn !== 0 && this.vcC !== 0) { n += this.vcC; n = n > 0 ? (n < 1 ? n : 1) : 0; }', '']], { each });
  // notes on member channel 2 with a per-note bend (proc.mpe[2·4] = 0.3): MPE off ⇒ the term's code removed renders the
  // same; the same notes with MPE on (use & 256, mpeOn) ⇒ removing the term changes the pitch (positive control)
  const mpeEach = (sp, u) => { each(sp, u); u.proc.mpe[8] = 0.3; };
  const noMpe = [['const ms = sx.mpeOn !== 0 ? this.mod.mpeSt : 0;', 'const ms = 0;']];
  neutralSame('MPE off (use & 256 = 0)', s, noMpe, { each: mpeEach, ch: 2, cpEdit: (cp) => { assert.equal(cp.use & 256, 0); assert.equal(cp.mpeOn, 0); } });
  neutralSame('MPE on (positive control)', s, noMpe, { each: mpeEach, ch: 2, differ: true, cpEdit: (cp) => { cp.use |= 256; cp.mpeOn = 1; } });
  neutralSame('tuning off (use & 512 = 0)', st2({ ...FILT('f', T_LOW12), 'a.track': 0, 'b.on': 1 }, (st) => { st.filter[0].keytrack = 1; st.osc[1].map.k = [70, 80]; st.osc[1].map.fold = 1; }),
    [['if (sx.tuned === 0) return nP + d;', 'return nP + d;'],
      ['if (sx.tuned !== 0) { const n = ref | 0, k = sx.tune[n >= 0 ? (n <= 127 ? n : 127) : 0]; if (k === k) ref = k; }', '']],
    { cpEdit: (cp) => { for (let k = 0; k < 128; k++) cp.tune[k] = k + 0.25; } });
});
test('M2 §0.7: mixer terms at neutral — f.level/f2.level n 0.5, bus sends n 0, filter balance n 0 (F2 sum skipped); use bits 1, 2, 4', () => {
  const s = st2({ ...FILT('f', T_MG24), ...FILT('f2', T_HIGH12, 0.6), 'b.on': 1, 's.on': 1, 'n.on': 1, 'a.uni': nUni(2) },
    (st) => { st.filter[0].route = 0; st.osc[1].route = 0; st.sub.route = 0; st.noise.route = 2; });
  neutralSame('filter levels n 0.5', s, [['L1 = eff[F_LEVEL] === 0.5 ? 1 : 4 * eff[F_LEVEL] * eff[F_LEVEL];', 'L1 = 1;'],
    ['const L2 = eff[F2_LEVEL] === 0.5 ? 1 : 4 * eff[F2_LEVEL] * eff[F2_LEVEL];', 'const L2 = 1;'],
    ['g = lvN === 0.5 ? 1 : 4 * lvN * lvN, g0', 'g = 1, g0']]);
  neutralSame('bus sends n 0', s, [['if (sx.anyBus !== 0) {', 'if (false) {']]);
  neutralSame('filter balance n 0', s, [['const bal = eff[FBAL[c]], h1 = bal === 0 ? 1 : 1 - bal, h2 = bal === 0 ? 0 : bal;', 'const h1 = 1, h2 = 0;']]);
  // a use bit set with its feature off changes nothing (cheap bypass): OSC C, Filter 2, warp slot 2
  const base = st2({ ...FILT('f', T_MG24), 'b.on': 1, 'a.w1': nEnum(W2('sync'), 81), 'a.warp': 0.4 });
  const play = (cpEdit) => { const u = setup2({ s: base, cpEdit, n: 2 }); u.vs[0].noteOn(57, 1, false, 1); u.vs[1].noteOn(62, 0.6, false, 1); return run2(u.S, u.proc, u.vs, 40, { outs: true }); };
  const ref = play(null);
  for (const bit of [1, 2, 4]) {
    const r = play((cp) => { cp.use |= bit; });
    for (const k of OUTS) sameArr(r[k], ref[k], 'use bit ' + bit + ' (' + k + ')');
  }
  // S1 mode ignores the phase-memory menu of A/B
  const s1 = (pm) => st2({ 'a.rand': 1, 'a.uni': nUni(3), 'b.on': 1, 'b.rand': 1 }, (st) => { st.global.s1 = 1; st.osc[0].phMem = pm; st.osc[1].phMem = pm; });
  const pa = play2({ s: s1('all') }, 57, 30), pv = play2({ s: s1('voice') }, 57, 30);
  sameArr(pv.L, pa.L, 'S1: phMem of A/B ignored');
});

/* ------------------------------------------------------------------ busy v2 patches: snapshot v2, allocation-free */

// every voice feature at once: 3 oscillators (WT with both warp slots, Sample, WT with PD Self), FM/AM cross-modulation,
// colour noise, S2 sub, F1 → F2 (PZ SVF, modulated type), Direct, buses, ENV toggles, tuning, MPE, VC, a fold map
function busyState() {
  return st2({ 'a.uni': nUni(5), 'a.det': 0.4, 'a.w1': nEnum(W2('fm_o2'), 81), 'a.warp': 0.3, 'a.w2': nEnum(W2('d_tube'), 81), 'a.warp2': 0.5,
    'b.on': 1, 'b.uni': nUni(3), 'b.w1': nEnum(W2('sync'), 81), 'b.warp': 0.4, 'b.w2': nEnum(W2('am_o1'), 81), 'b.warp2': 0.3, 'b.bus1': 0.7,
    'c.on': 1, 'c.uni': nUni(2), 'c.w1': nEnum(W2('pd_self'), 81), 'c.warp': 0.5, 'c.w2': nEnum(W2('lpf'), 81), 'c.warp2': 0.4, 'c.fbal': 0.5,
    'n.on': 1, 'n.level': 0.3, 'n.stereo': 0.6, 'n.color': 0.7, 's.on': 1, 's.shp': 2 / 5, 's.crs': 0.6,
    ...FILT('f', T_MG24, 0.5, { 'f.res': 0.4, 'f.bus2': 0.5 }), ...FILT('f2', 103, 0.6, { 'f2.x': 0.3, 'f2.y': 0.6 }),
    'l1.rate': 0.5, 'l2.rate': 0.6, 'a.hz': 0.55, 'e2.rel': nTime(0.2) },
  (s) => {
    s.osc[1].type = 'sample'; s.osc[1].smp = 'smp:sine'; s.osc[1].smpo.loop = 1; s.osc[1].route = 2;
    s.osc[2].pitch = { mode: 'harm', src: 'note' }; s.osc[2].map = { k: [50, 70], v: [1, 127], fold: 1, warp: 0 };
    s.noise.src = 'color:Pink'; s.noise.route = 1; s.noise.env = 0; s.sub.route = 0; s.filter[0].route = 0; s.filter[1].clean = 1;
    s.vc.steps[0] = [0.3, 0.2, 0.1, 0, 0, 0]; s.vc.len = 1; s.global.mpe = { on: 1, bend: 48, xyz: 1 };
    s.matrix[0] = { ...s.matrix[0], src: 'lfo1', dst: 'f2.type', amt: 0.05 };
    s.matrix[1] = { ...s.matrix[1], src: 'lfo2', dst: 'a.warp2', amt: 0.4 };
    s.matrix[2] = { ...s.matrix[2], src: 'env2', dst: 'c.ratio', amt: 0.2 };
  });
}
const busyTune = (cp) => { cp.use |= 512; for (let k = 0; k < 128; k++) cp.tune[k] = k + 0.1 * Math.sin(k); };

test('M2: snapshot v2 shapes (§6.20) and its taps (Filter 2 tap, channel meters, sample positions)', () => {
  const u = setup2({ s: busyState(), cpEdit: busyTune, n: 3, assets: { 'smp:sine': sineSmp('smp:sine') } });
  u.proc.sx.mon = 1;
  u.vs[0].noteOn(57, 1, false, 1, 2); u.vs[1].noteOn(64, 0.6, false, 1, 3); u.vs[2].noteOn(40, 0.8, false, 1);
  run2(u.S, u.proc, u.vs, 20, { outs: true });
  const sn = u.S.snapshot(u.proc);
  const shape = { eff: ['Float32Array', 429 + 8 + 48 * 24], lfoPh: ['Float32Array', 10], lfoOut: ['Float32Array', 10], lfoY: ['Float32Array', 10],
    env: ['Float32Array', 4], envStage: ['Uint8Array', 4], envT: ['Float32Array', 4], wtPos: ['Float32Array', 3], smpPos: ['Float32Array', 12],
    grains: ['Uint16Array', 3], memNow: ['Float32Array', 48], filtTap: ['Float32Array', 2048], mix: ['Float32Array', 11], mOut: ['Float32Array', 64],
    zone: ['Int16Array', 3], seq: ['Float64Array', 16] };
  for (const [k, [tag, n]] of Object.entries(shape)) {
    assert.equal(sn[k] && sn[k][Symbol.toStringTag], tag, k); assert.equal(sn[k].length, n, k + ' length');
  }
  for (const k of ['specCap', 'oscVoices', 'maxVoices', 'notes', 'tapRate']) assert.equal(typeof sn[k], 'number', k);
  assert.equal(sn.notes, 3);
  assert.equal(sn.maxVoices, 8 * (16 + 16 + 16 + 1 + 1), 'POLY × (A + B + C + sub + noise)');
  assert.ok(sn.oscVoices >= 5 + 3 + 2, 'unison voices counted');
  assert.ok(sn.filtTap.subarray(1024).some((x) => x !== 0), 'Filter 2 tap');
  for (let c = 0; c < 7; c++) assert.ok(sn.mix[c] > -120 && sn.mix[c] < 20, 'meter ' + c + ': ' + sn.mix[c]);
  assert.ok(sn.smpPos[4] > 0 && sn.smpPos[4] <= 1, 'OSC B (sample) playhead: ' + sn.smpPos[4]);
  assert.equal(u.S.snapshot(u.proc), sn, 'one reused object');
});

test('M2: allocation-free — a busy v2 patch (every voice feature) and Granular/Spectral voices through begin / render / fxMods / snapshot', () => {
  for (const variant of ['busy', 'gran+spec']) {
    const s = variant === 'busy' ? busyState()
      : st2({ 'b.on': 1, 'b.uni': nUni(2), 'a.dens': 0.9, 'a.uni': nUni(2), ...FILT('f', 100, 0.5) }, (st) => {
        st.osc[0].type = 'gran'; st.osc[0].smp = 'smp:sine'; st.osc[1].type = 'spec'; st.osc[1].smp = 'smp:sine';
        st.osc[0].xy = { on: 1, y: 2, yMode: 0 };
      });
    const u = setup2({ s, cpEdit: variant === 'busy' ? busyTune : null, n: 3,
      assets: { 'smp:sine': sineSmp('smp:sine'), 'spec:smp:sine': sineSpec('spec:smp:sine') } });
    u.proc.sx.mon = 1;
    const N = 128 * u.proc.OS, O = {};
    for (const k of OUTS) O[k] = new Float64Array(N);
    const span = () => { u.S.begin(u.proc, N); for (const v of u.vs) if (v.active) v.render(O, N); u.S.fxMods(u.proc); u.S.snapshot(u.proc); };
    u.vs[0].noteOn(57, 1, false, 1, 2); u.vs[1].noteOn(64, 0.6, false, 1, 3);
    for (let k = 0; k < 8; k++) span();
    noAlloc2(u.sc, () => {
      for (let sp = 0; sp < spansOf(0.6); sp++) {
        if (sp === 30) u.vs[1].noteOff(0.4);
        if (sp === 60) u.vs[2].noteOn(45, 0.9, false, 1);
        if (sp === 90) u.vs[0].noteOn(59, 0.3, false, 1, 2);    // steal
        for (const k of OUTS) O[k].fill(0);
        span();
        for (const k of OUTS) for (let i = 0; i < N; i++) if (!Number.isFinite(O[k][i])) throw new Error(variant + ': not finite ' + k + ' at span ' + sp);
      }
    });
  }
});

/* ------------------------------------------------------------------ warm-up and CPU (§11.10, §14.1 rows d, i, q) */

// §14.1 node gate: a row's load × k ≤ 1.5 × its target, k = t_ref(calib) / t(calib), calib = row b through tests/ref-p1
// (golden harness, the whole ref-p1 engine) measured in the same run; t_ref(calib) from tests/bench.json (without it k = 1,
// uncalibrated). Through tests/cpu-gate.mjs (pairs in alternating order, median of the per-pair ratios, up to 5 attempts
// while over the gate; RULINGS2 Performance): { load, k, raw, calib, attempt }
const T_REF_CALIB = CPU.T_REF_CALIB, calibRowB = CPU.calibRowB;
const gateLoad = (calib, fn, target) => CPU.gateLoad(fn, target);

test('M2: warmUp exercises the Serum 2 code, leaves no table, asset or counter behind, and costs ≤ 1.5 × the Phase-1 warmUp (§14.1 row q)', () => {
  const mkP = () => makeProc(48000, 2);
  const refSrc = readFileSync(new URL('ref-p1/serum-dsp.js', import.meta.url), 'utf8');
  // each run in a fresh scope (a cold JIT, as in a new AudioWorkletGlobalScope); only the warmUp call is timed
  const timeRef = () => {
    const c = vm.createContext(vm.constants && vm.constants.DONT_CONTEXTIFY !== undefined ? vm.constants.DONT_CONTEXTIFY : {});
    c.console = mkConsole();
    vm.runInContext(refSrc, c, { filename: 'ref-p1/serum-dsp.js' });
    const proc = mkP(), t0 = performance.now(); c.SerumDSP.warmUp(proc); return performance.now() - t0;
  };
  const timeCur = (chk) => {
    const sc = dspScope({ fast: true }), S = sc.global('SerumDSP'), B = sc.global('SxBase'), proc = mkP();
    proc.vcN = 0;
    const t0 = performance.now(); S.warmUp(proc); const t = performance.now() - t0;
    if (chk) {
      assert.deepEqual([...S.tables.keys()], [], 'no warm-up table left');
      assert.equal(B.getAsset('__warmS'), null); assert.equal(B.getAsset('__warmM'), null);
      assert.deepEqual(sc.logs.filter((m) => m.level !== 'log'), [], 'no warnings');
      assert.equal(proc.vcN, 0, 'the Voice Control step counter is back at 0 (the warm-up CP plays VC notes)');
      assert.ok(!proc.sx.msRR || proc.sx.msRR.every((x) => x === 0), 'no round-robin counter advanced');
    }
    return t;
  };
  timeCur(true);
  // medians of 5 interleaved runs (per-pair ratios, alternating order), measured again while above the gate (up to 5
  // attempts: a real regression exceeds it every time); fails above 1.5× (row q). A cold-JIT measurement: it runs with
  // the browsers' normal tiering (Sparkplug on, which tests/v8-guard.mjs switches off for the rest of the process)
  const med = (x) => x.slice().sort((p, q) => p - q)[x.length >> 1];
  let r = null;
  v8.setFlagsFromString('--sparkplug');
  try {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const a = [], b = [], q = [];
      for (let k = 0; k < 5; k++) {
        let x, y;
        if (k & 1) { y = timeCur(false); x = timeRef(); } else { x = timeRef(); y = timeCur(false); }
        a.push(x); b.push(y); q.push(y / x);
      }
      const res = { a: med(a), b: med(b), ratio: med(q), attempts: attempt };
      if (!r || res.ratio < r.ratio) r = res;
      if (r.ratio <= 1.5) break;
    }
  } finally { v8.setFlagsFromString('--no-sparkplug'); }
  console.log(`  warmUp: Phase 1 ${r.a.toFixed(1)} ms, v2 ${r.b.toFixed(1)} ms (${r.ratio.toFixed(2)}×, budget 1.5×, attempt ${r.attempts})`);
  assert.ok(r.ratio <= 1.5, 'warmUp ' + r.ratio.toFixed(2) + '× Phase 1 (row q: ≤ 1.5×)');
});

test('M2: CPU rows d (3 WT oscillators × unison 7, two warp slots, F1 → F2) and i (64 rows: 20 editable curves, 10 slews) — §14.1 node gate (× k, ≤ 1.5 × target)', async () => {
  const calib = await calibRowB();
  const sc = dspScope({ fast: true });
  const bench = (s, notes = 8) => {
    const u = setup2({ s, n: notes, scope: sc });
    u.vs.forEach((v, i) => v.noteOn(48 + 3 * i, 0.8, false, 1));
    const N = 128 * u.proc.OS, L = new Float64Array(N), R = new Float64Array(N), spans = 48000 / 128;
    const go = () => { for (let k = 0; k < spans; k++) { u.S.begin(u.proc, N); for (const v of u.vs) v.render(L, R, N); u.S.fxMods(u.proc); } };
    go();
    return { go, u };
  };
  const osc = (k) => ({ [k + '.on']: 1, [k + '.uni']: nUni(7), [k + '.det']: 0.4, [k + '.w1']: nEnum(W2('bend_p'), 81), [k + '.warp']: 0.5,
    [k + '.w2']: nEnum(W2('d_tube'), 81), [k + '.warp2']: 0.3 });
  const d = bench(st2({ ...osc('a'), ...osc('b'), ...osc('c'), ...FILT('f', T_MG24, 0.6), ...FILT('f2', T_LOW12, 0.7), 'l1.rate': 0.5, 'l2.rate': 0.6 },
    (s) => {
      s.osc[1].route = 0; s.osc[2].route = 0; s.filter[0].route = 0;
      for (const [j, src, dst, amt] of [[0, 'lfo1', 'a.wt', 0.3], [1, 'lfo2', 'f.cutoff', 0.2], [2, 'env2', 'b.warp', 0.3], [3, 'lfo1', 'c.fine', 0.1]]) {
        s.matrix[j] = { ...s.matrix[j], src, dst, amt };
      }
    }));
  const srcs = ['lfo1', 'lfo2', 'lfo3', 'env2', 'env3', 'velo', 'note', 'rand1', 'macro1', 'chaos1'];
  const dsts = ['a.fine', 'a.pan', 'a.wt', 'f.cutoff', 'f.res', 'n.level', 's.level', 'b.fine', 'b.pan', 'a.warp', 'a.blend', 'l1.rate', 'l2.rate',
    'g.amp', 'e1.sus', 'c.fine', 'f2.cutoff', 'a.det', 'b.det', 'c.pan', 'b.wt', 'c.wt', 'f.drive', 'f2.res'];
  const i = bench(st2({ 'a.on': 0 }, (s) => {
    for (let j = 0; j < 64; j++) {
      s.matrix[j] = { ...s.matrix[j], src: srcs[j % srcs.length], dst: dsts[j % dsts.length], amt: 0.1 + 0.01 * (j % 7), bi: j & 1 };
      if (j < 20) s.matrix[j].crv = [[0, 0, 0], [0.4, 0.7, 0.3], [1, 1, -0.2]];        // editable curves (CP.mCrv)
      if (j >= 20 && j < 30) { s.matrix[j].rise = 0.05; s.matrix[j].fall = 0.1; }
    }
  }));
  const cpI = i.u.cp;
  assert.ok((cpI.use & 4096) !== 0 && cpI.mCrv.filter((x) => x >= 0).length === 20, 'row (i): 20 rows with editable curves');
  const rd = await gateLoad(calib, d.go, 0.8), ri = await gateLoad(calib, i.go, 0.1);
  const how = T_REF_CALIB > 0 ? `k = ${rd.k.toFixed(3)} (t_ref(calib) ${T_REF_CALIB} ms, t(calib) ${rd.calib.toFixed(1)} ms)`
    : `uncalibrated: tests/bench.json has no t_ref(calib) (t(calib) here ${rd.calib.toFixed(1)} ms)`;
  console.log(`  CPU (d) ${rd.load.toFixed(3)} (node target 0.8, gate 1.2), (i) ${ri.load.toFixed(3)} (target 0.1, gate 0.15) — OS 2; ${how}`);
  assert.ok(rd.load <= 1.5 * 0.8, '(d) ' + rd.load.toFixed(3) + ' > 1.5 × 0.8');
  assert.ok(ri.load <= 1.5 * 0.1, '(i) ' + ri.load.toFixed(3) + ' > 1.5 × 0.1');
});

test('M2: lifetime rule (b) with live grains: a 2 ms fade, then the voice ends and returns its grains (§6.19)', () => {
  const u = setup2({ s: st2({ 'a.dens': 0.7, 'a.glen': 0.6, 'e1.rel': nTime(0.01), 'e2.rel': nTime(0.01), 'e3.rel': nTime(0.01), 'e4.rel': nTime(0.01) },
    (s) => { s.osc[0].type = 'gran'; s.osc[0].smp = 'smp:sine'; s.osc[0].route = 1; s.osc[0].env = 0; }),
  assets: { 'smp:sine': sineSmp('smp:sine') } });
  const v = u.vs[0];
  v.noteOn(60, 1, false, 1);
  let r = run2(u.S, u.proc, u.vs, 40);
  assert.ok(v.ox[0].grains() > 0 && rms(r.L, r.L.length - r.N) > 1e-3, 'grains sound: ' + v.ox[0].grains() + ' ' + rms(r.L, r.L.length - r.N));
  v.noteOff(0);
  r = run2(u.S, u.proc, u.vs, 20);
  assert.equal(v.active, false, 'ended');
  assert.equal(v.ox[0].grains(), 0, 'grains returned');
  assert.equal(u.proc.sx.grains | 0, 0, 'processor grain count back to 0');
  // the end of the output: a linear fade over ≈ 2 ms, no step
  let last = r.L.length - 1;
  while (last > 0 && r.L[last] === 0) last--;
  const fs = u.proc.fs, K = Math.ceil(0.002 * fs / u.proc.CH) * u.proc.CH;
  assert.ok(maxAbs(r.L, last - 8, last + 1) < 0.1 * maxAbs(r.L, last - 2 * K, last - K), 'faded out');
  assert.ok(maxAbs(r.L, last - K - 16, last - K) > 1e-3, 'still sounding before the fade');
});

test('M2: allocate — inactive, released, sustained, then the Voice Steal Priority (Newest/Oldest/Highest/Lowest/Velocity); One Note reuse (§12.3)', () => {
  const sc = dspScope(), S = sc.global('SerumDSP');
  const proc = makeProc();
  const pick = (steal, vs, n = 70, extra = {}) => {
    proc.voices = vs; proc.sx = null;
    proc.p = { serum: Object.assign(loadFixture('cp2-default.json'), { steal, oneNote: 0 }, extra) };
    const v = S.allocate(proc, n, 0);
    return v ? vs.indexOf(v) : -1;
  };
  const V = (note, vel, stamp, o = {}) => ({ active: true, gate: true, sus: false, note, vel, stamp, ch: 0, ...o });
  const gated = () => [V(60, 0.5, 3), V(72, 0.9, 1), V(48, 0.2, 4), V(67, 0.7, 2)];
  assert.equal(pick(0, gated()), 1, 'Newest: steal the oldest note (lowest stamp)');
  assert.equal(pick(1, gated()), 2, 'Oldest: steal the newest (highest stamp)');
  assert.equal(pick(2, gated()), 2, 'Highest: steal the lowest note');
  assert.equal(pick(3, gated()), 1, 'Lowest: steal the highest note');
  assert.equal(pick(4, gated()), 2, 'Velocity: steal the lowest velocity');
  const vs = gated(); vs[3].active = false;
  assert.equal(pick(2, vs), 3, 'an inactive voice first');
  const vs2 = gated(); vs2[0].gate = false; vs2[2].sus = true;
  assert.equal(pick(4, vs2), 0, 'then a released one');
  const vs3 = gated(); vs3[0].sus = true;
  assert.equal(pick(4, vs3), 0, 'then a sustained one');
  assert.equal(pick(0, gated(), 67, { oneNote: 1 }), 3, 'One Note: the voice already playing the key');
  assert.equal(S.allocate({ voices: [] }, 60), null);
});

test('M2: the wavetable voice path of both WARPS2 slots equals SxWarp.renderWarp2 (P, O and PD Self modes, slot pairs) (§6.6.1, §6.6.9)', () => {
  // a band-limited frame (8 harmonics: mip levels 0–2 identical), 46.875 Hz at 96 kHz = exactly one 2048-sample cycle
  const fr = frame((p) => { let y = 0; for (let k = 1; k <= 8; k++) y += Math.sin(2 * Math.PI * k * p + k) / k; return 0.4 * y; });
  const tbl = { ...TABLES2, 'factory:Default': entryFromFrames([fr]) };
  const f0 = 46.875, n30 = 440 * Math.pow(2, (30 - 69) / 12), hzN = (f0 - n30 + 50) / 100;
  const W = dspScope().global('SxWarp');
  const cases = [
    [['bend_p', 0.5]], [['pd_self', 0.6]], [['oddeven', 0.2]], [['d_tube', 0.7]], [['sync', 0.4, 0.5]], [['mirror', 0.3]],
    [['asym_n', 0.4], ['flip', 0.6]], [['pwm', 0.3], ['pd_self', 0.4]], [['quantize', 0.5], ['oddeven', 0.8]], [['sync', 0.3, 1], ['lpf', 0.4]],
  ];
  for (const slots of cases) {
    const p = { 'a.level': 1, 'a.hz': hzN, 'a.w1': nEnum(W2(slots[0][0]), 81), 'a.warp': slots[0][1], 'a.wvar1': slots[0][2] || 0 };
    if (slots[1]) Object.assign(p, { 'a.w2': nEnum(W2(slots[1][0]), 81), 'a.warp2': slots[1][1], 'a.wvar2': slots[1][2] || 0 });
    // a distortion slot: renderWarp2 removes its DC exactly, the voice runs the 5 Hz blocker (RULINGS2 D3) — compared
    // here with the voice's blocker off and the cycle's mean removed (sx-warp.test.mjs covers the blocker)
    const dist = slots.some(([id]) => W.META.dist[W2(id)] >= 0);
    const r = play2({ s: st2(p, (s) => { s.osc[0].route = 1; }), tables: tbl }, 30, 82,
      { each: (sp, u) => { if (sp === 0 && dist) for (const S of u.vs[0].wsl) if (S) S.dcOn = 0; } });
    // the Float32 data of the mip level the voice reads (PD Self is a feedback map: its orbit depends on the table's rounding)
    const lvData = tbl['factory:Default'].levels[r.u.vs[0].uLv[0]].data;
    assert.equal(lvData.length, 2048);
    const ref = W.renderWarp2(lvData, slots.map(([id, w, v]) => ({ mode: W2(id), w, v: v || 0, fm: 0 })), { over: 1, hz: f0 });
    const c = 9 * 2048;                                         // the 10th cycle (stateful modes: steady state)
    let err = 0, mu = 0;
    if (dist) for (let j = 0; j < 2048; j++) mu += r.L[c + j] / 2048;
    for (let j = 0; j < 2048; j++) err = Math.max(err, Math.abs(r.L[c + j] - mu - ref[j]));
    assert.ok(err < 1e-4, slots.map((x) => x[0]).join(' + ') + ': max |voice − renderWarp2| = ' + err);
  }
});

test('M2: memory — a v2 wavetable voice ≤ 384 KB at 192 kHz; filters: the new types ≤ 1 MiB per filter at fs 384 kHz, types 0–95 at their Phase-1 sizes (8 Hz), the reported deviation measured (§14.2, §6.13.1)', () => {
  const bytesOf = (root) => {
    const seen = new Set(), bufs = new Set();
    let n = 0;
    const walk = (o, key) => {
      if (!o || typeof o !== 'object' || seen.has(o)) return;
      if (['proc', 'lvD', 'sD', 'nLvL', 'nLvR', 'm', 'sx', 'cp', 'eff', 'v', 'e', 'B', 'F2', 'W', 'sb'].includes(key)) return;   // host / shared data
      seen.add(o);
      if (ArrayBuffer.isView(o)) { if (!bufs.has(o.buffer)) { bufs.add(o.buffer); n += o.buffer.byteLength; } return; }
      for (const k of Object.keys(o)) walk(o[k], k);
    };
    walk(root, '');
    return n;
  };
  const MiB = (b) => (b / 1048576).toFixed(3) + ' MiB';
  const s = st2({ 'b.on': 1, 'c.on': 1, 'a.w1': nEnum(W2('sync'), 81), 'a.w2': nEnum(W2('lpf'), 81), 'a.warp2': 0.3, ...FILT('f', T_MG24), ...FILT('f2', T_LOW12) });
  const u = setup2({ s, base: 48000, OS: 4 });
  const v = u.vs[0];
  assert.ok(v.filt2 !== null && v.wsl[2] !== null);
  const KB = bytesOf(v) / 1024;
  console.log(`  v2 voice: ${KB.toFixed(1)} KB at fs 192 kHz (no delay family)`);
  assert.ok(KB <= 384, KB.toFixed(1) + ' KB');
  // Phase-1 line sizes for types 0–95 (§3.5 "unchanged"): ⌈fs·m/8⌉ + 8 per line, as tests/ref-p1 — in every SFilter
  const phase1Len = (fs) => Math.ceil(fs / 8) + 8;
  for (const fs of [192000, 384000]) {
    let worst = 0, at = -1, worstNew = 0, atNew = -1;
    for (let t = 0; t < 108; t++) {
      const f = new u.S.SFilter(fs);
      f.setType(t);
      const b = bytesOf(f);
      if (t < 96 && b > worst) { worst = b; at = t; }
      if (t >= 96 && b > worstNew) { worstNew = b; atNew = t; }
      if (t === 39) assert.equal(f.ln[0], phase1Len(fs), 'comb line at the Phase-1 size');
    }
    console.log(`  fs ${fs / 1000} kHz, one filter: worst new type (${atNew}) ${MiB(worstNew)}; worst type 0–95 (${at}) ${MiB(worst)}`);
    assert.ok(worstNew <= 1048576, 'fs ' + fs + ': new type ' + atNew + ' ≤ 1 MiB per filter: ' + MiB(worstNew));
    if (fs === 192000) assert.ok(worst <= 2 * 1048576, 'Phase-1 budget (one filter ≤ 2 MB at fs 192 kHz): ' + MiB(worst));
    // both filters modulated over 0–107: everything preallocated, type changes allocate nothing
    const m = setup2({ s: st2({ ...FILT('f', T_MG24), ...FILT('f2', T_LOW12), 'f.type2': 0.5, 'f2.type': 0.5 }, (st) => {
      st.matrix[0] = { ...st.matrix[0], src: 'lfo1', dst: 'f.type2', amt: 1, bi: 1 };
      st.matrix[1] = { ...st.matrix[1], src: 'lfo2', dst: 'f2.type', amt: 1, bi: 1 };
    }), base: fs / 2, OS: 2 }).vs[0];
    assert.ok(m.filt.all === 1 && m.filt.aLo === 0 && m.filt.aHi === 107 && m.filt2.aHi === 107, 'every type preallocated');
    const full = bytesOf(m.filt) + bytesOf(m.filt2);
    for (let t = 0; t < 108; t++) { m.filt.setType(t); m.filt2.setType(107 - t); }
    assert.equal(bytesOf(m.filt) + bytesOf(m.filt2), full, 'type changes over 0–107 allocate nothing');
    console.log(`  fs ${fs / 1000} kHz: both filters modulated over 0–107 ${MiB(full)}`);
    assert.ok(full <= 2 * worst + 2 * 65536, 'modulated: the Phase-1 pools plus the small new-family objects: ' + MiB(full));
  }
  // Reported deviation (ARCH2 rule 1 over §14.2): the Phase-1 delay families keep their line sizes in both filters, in S1
  // and S2 mode, so at base 192 kHz (fs 384 kHz) the FDN bank (82) takes 2.13 MiB per filter: S1-mode Filter 1 on 82 with
  // Filter 2 on the Diffusor ≈ 3.1 MiB, both filters on 82 ≈ 4.26 MiB per voice (at base 48 kHz, OS 2: a quarter)
  const dev = (s1, t1, t2) => {
    const st = st2({ 'f.on': 1, 'f.type': t1 / 95, 'f.type2': t1 / 107, ...FILT('f2', t2) }, (x) => { x.global.s1 = s1; });
    const w = setup2({ s: st, base: 192000, OS: 2 }).vs[0];
    assert.ok(w.filt2 !== null && w.filt.type === t1 && w.filt2.type === t2);
    return bytesOf(w.filt) + bytesOf(w.filt2);
  };
  const d1 = dev(1, 82, 98), d2 = dev(1, 82, 82), d3 = dev(0, 82, 82);
  console.log(`  (deviation) fs 384 kHz: S1 mode F1 82 + F2 98 ${MiB(d1)}; S1 mode F1 82 + F2 82 ${MiB(d2)}; S2 mode both 82 ${MiB(d3)}`);
  assert.ok(d1 > 3 * 1048576 && d1 < 3.2 * 1048576, 'S1 mode F1 FDN + F2 Diffusor ≈ 3.1 MiB: ' + MiB(d1));
  assert.ok(d2 === d3 && d3 > 4.2 * 1048576 && d3 < 4.3 * 1048576, 'both filters on the FDN bank ≈ 4.26 MiB, in either mode: ' + MiB(d3));
});

test('M2: types 0–95 tune below 20 Hz in both voice filters and in either mode, as in Phase 1 — no delay floor of their own (§3.5, §6.21 item 8)', () => {
  // a comb (39) and the FDN bank (82) at ≈ 10 Hz, res 0.8: Filter 1 in S2 mode renders exactly as in S1 mode, and its
  // delay lines (and Filter 2's) have the Phase-1 sizes of the FX Filter's SFilter
  const cut = Math.log2(10 / 8.175798915643707) / Math.log2(22050 / 8.175798915643707);
  for (const t of [39, 82]) {
    const p = { 'f.on': 1, 'f.type': t / 95, 'f.type2': t / 107, 'f.cutoff': cut, 'f.res': 0.8, 'f.mix': 1 };
    const a = play2({ s: st2(p, (x) => { x.global.s1 = 1; }), OS: 2 }, 45, 120), b = play2({ s: st2(p), OS: 2 }, 45, 120);
    assert.ok(a.u.vs[0].filt.type === t && b.u.vs[0].filt.type === t);
    assert.ok(maxDiff(a.L, b.L) <= 1e-9 && rms(a.L) > 1e-3, 'type ' + t + ': S2-mode Filter 1 ≡ S1 mode, ' + maxDiff(a.L, b.L));
    const f2 = setup2({ s: st2({ ...FILT('f2', t, cut) }), base: 96000, OS: 2 }).vs[0].filt2, ref = new b.u.S.SFilter(192000);
    ref.setType(t);
    assert.deepEqual([...f2.ln.slice(0, f2.nl)], [...ref.ln.slice(0, ref.nl)], 'type ' + t + ': Filter 2 lines at the Phase-1 sizes');
  }
});

test('M2: SFilter types 96–107 through the FX Filter call sequences — prealloc(true) covers 0–107 (then setType never allocates), an unmodulated setType makes its family, a modulated miss is allocated by the next prealloc; the output equals the SxFilt2 family (§6.13.1, §11.7)', () => {
  const sc = dspScope(), S = sc.global('SerumDSP'), fs = 48000;
  const imp = (f) => { const L = new Float64Array(256), R = new Float64Array(256); L[0] = 0.01; R[0] = 0.01; f.process(L, R, 0, 256); return L.map((x) => x / 0.01); };
  for (let t = 96; t < 108; t++) {
    const ref = S.filterImpulse(t, 800, 0.3, 0, 0.5, fs, 256);               // a fresh SxFilt2 family object (§11.7)
    assert.ok(ref.some((x, i) => i > 0 && Math.abs(x) > 1e-6), 'type ' + t + ' filters');
    // FX Filter S2 with a modulated type: prealloc(true) in apply, setType on the render path
    const a = new S.SFilter(fs);
    a.prealloc(true);
    assert.ok(a.aHi === 107 && a.f2o !== null && a.f2o[t - 96] !== null, 'prealloc(true) covers type ' + t);
    noAlloc2(sc, () => { a.setType(t); a.set(800, 800, 0.3, 0, 0.5); });
    sameArr(imp(a), ref, 'modulated type ' + t);
    // FX Filter S2 with a fixed type: setType alone (an apply path)
    const b = new S.SFilter(fs);
    b.setType(t); b.set(800, 800, 0.3, 0, 0.5);
    assert.ok(b.nx !== null && b.miss === -1);
    sameArr(imp(b), ref, 'fixed type ' + t);
  }
  assert.deepEqual(sc.logs.filter((m) => m.level !== 'log'), [], 'no warning');
  // a modulated range that misses a type (prealloc(true, lo, hi), as the voice computes it): unfiltered with one
  // warning, allocated by the next prealloc (the next apply)
  const c = new S.SFilter(fs);
  c.prealloc(true, 0, 95);
  noAlloc2(sc, () => c.setType(100));
  assert.ok(c.nx === null && c.miss === 100);
  assert.equal(sc.logs.filter((m) => m.level === 'warn').length, 1);
  c.prealloc(true, 0, 95);
  assert.ok(c.nx !== null && c.miss === -1, 'allocated by the next prealloc');
  c.set(800, 800, 0.3, 0, 0.5); c.reset();
  sameArr(imp(c), S.filterImpulse(100, 800, 0.3, 0, 0.5, fs, 256), 'then filters');
  // the S1 variant (types 0–95) keeps its Phase-1 memory by passing hi = 95
  const d = new S.SFilter(fs);
  d.prealloc(true, 0, 95);
  assert.equal(d.f2o, null, 'no SxFilt2 object for 0–95');
});

/* ------------------------------------------------------------------ review round 3 (D1): processor state, taps, levels */

// OSC A: a 3-way round-robin multisample (zone gains 0 / −6 / −12 dB); Voice Control with 4 steps (vmod1 = 0.2·(step + 1))
const RR3 = () => {
  const z = (k, g) => ({ lo: 0, hi: 127, vlo: 0, vhi: 127, root: ROOT375, tune: 0, gain: g, pan: 0, smp: 'smp:sine', mode: 'loop', ls: 0, le: 48000,
    off: 0, env: null, rr: [3, k], vt: 1 });
  return { 'smp:sine': sineSmp('smp:sine'), 'msmp:rr3': { id: 'msmp:rr3', v: 1, kind: 'multi', bytes: 0, zones: [z(1, 0), z(2, -6), z(3, -12)] } };
};
const rrVc = () => st2({}, (s) => {
  s.osc[0].type = 'multi'; s.osc[0].multi = 'msmp:rr3'; s.osc[0].route = 1;
  s.vc.len = 4; for (let j = 0; j < 4; j++) s.vc.steps[j] = [0, 0, 0, 0, 0.2 * (j + 1), 0];
});
// the Voice Control step and the round-robin zone of the next note (voice 0, killed afterwards)
const nextNote = (u) => {
  u.vs[0].noteOn(60, 1, false, 1);
  run2(u.S, u.proc, u.vs, 2);
  const r = { vc: u.vs[0].mod.vK, zone: u.vs[0].ox[0].zone };
  u.vs[0].kill();
  return r;
};

test('M2: warm-ups leave the Voice Control step counter and the round-robin counters as they were (§15.9, §6.2, §6.8)', () => {
  // constructor warmUp on the processor, then the real patch: the first note plays VC step 0 and round-robin zone 0
  const a = setup2({ s: rrVc(), assets: RR3() });
  assert.ok((a.cp.use & 1024) !== 0 && a.proc.vcN === 0, 'a Voice Control patch');
  a.S.warmUp(a.proc);
  assert.equal(a.proc.vcN, 0, 'warmUp: proc.vcN restored');
  assert.deepEqual(nextNote(a), { vc: 0, zone: 0 }, 'warmUp: first note');
  assert.deepEqual(nextNote(a), { vc: 1, zone: 1 }, 'warmUp: second note');
  // first-use warm-up (two hidden voices on the real patch): the same after it ended
  const b = setup2({ s: rrVc(), assets: RR3() }), N = 128 * b.proc.OS;
  b.S.begin(b.proc, N);
  b.S.warmStart(b.proc);
  let left = 1, k = 0;
  for (; k < 200 && left > 0; k++) { b.S.begin(b.proc, N); left = b.S.warmTick(b.proc, N); if (k === 0) assert.equal(b.proc.sx.hw.length, 2); }
  assert.equal(left, 0, 'finished');
  assert.equal(b.proc.vcN, 0, 'first-use warm-up: proc.vcN restored');
  assert.ok(b.proc.sx.msRR.every((x) => x === 0), 'first-use warm-up: round-robin counters restored');
  assert.deepEqual(nextNote(b), { vc: 0, zone: 0 }, 'first-use warm-up: first note');
  // ended early by a real note (warmEnd) while the hidden voices hold advanced counters
  const c = setup2({ s: rrVc(), assets: RR3() });
  nextNote(c);
  c.S.begin(c.proc, N); c.S.warmStart(c.proc);
  for (let j = 0; j < 3; j++) { c.S.begin(c.proc, N); c.S.warmTick(c.proc, N); }   // (made, applied, started: one step each)
  assert.ok(c.proc.sx.hw !== null && c.proc.vcN === 3, 'hidden note-ons advanced the counter');
  c.S.warmEnd(c.proc);
  assert.equal(c.proc.vcN, 1);
  assert.deepEqual(nextNote(c), { vc: 1, zone: 1 }, 'warmEnd: the next real note continues the sequence');
});

test('M2: transport(true) and reset() clear the multisample round-robin counters — a song from a tick plays the zones of a fresh (offline) processor (§7.8, §6.8)', () => {
  const fresh = setup2({ s: rrVc(), assets: RR3() }), live = setup2({ s: rrVc(), assets: RR3() });
  nextNote(live); nextNote(live);                            // earlier live notes
  live.S.transport(live.proc, true);
  const seq = (u) => [0, 1, 2, 3].map(() => nextNote(u));
  assert.deepEqual(seq(live), seq(fresh), 'live after transport(true) ≡ fresh');
  nextNote(live);
  assert.ok(live.proc.sx.msRR.some((x) => x !== 0));
  live.S.reset(live.proc);
  assert.ok(live.proc.sx.msRR.every((x) => x === 0), 'reset: counters back to their attach state');
});

test('M2: lifetime rule (b) — an ENV-off channel ends once every envelope has finished its release, whatever End level ENV 2 holds (§6.19, inv B13)', () => {
  for (const end of [0, 0.5]) {
    const u = setup2({ s: st2({ 'e2.end': end, 'e1.rel': nTime(0.05), 'e2.rel': nTime(0.05), 'e3.rel': nTime(0.05), 'f.on': 0 },
      (st) => { st.osc[0].route = 1; st.osc[0].env = 0; }) });
    const v = u.vs[0];
    v.noteOn(60, 1, false, 1);
    let r = run2(u.S, u.proc, u.vs, 20);
    assert.ok(maxAbs(r.L) > 0.1);
    v.noteOff(0.5);
    r = run2(u.S, u.proc, u.vs, spansOf(0.02));
    assert.equal(v.active, true, 'e2.end ' + end + ': still releasing');
    r = run2(u.S, u.proc, u.vs, spansOf(0.5));
    assert.equal(v.active, false, 'e2.end ' + end + ': ended after the releases');
    assert.equal(maxAbs(r.L, r.L.length - r.N), 0, 'silent');
  }
});

test('M2: lifetime rule (b) ends with the 2 ms fade — an ENV-off wavetable channel is not cut at full level (§6.19)', () => {
  const u = setup2({ s: st2({ 'e1.rel': nTime(0.05), 'e2.rel': nTime(0.05), 'e3.rel': nTime(0.05), 'e4.rel': nTime(0.05), 'f.on': 0 },
    (st) => { st.osc[0].route = 1; st.osc[0].env = 0; }) });
  const v = u.vs[0], CH = u.proc.CH;
  v.noteOn(57, 1, false, 1);
  let endAt = -1;
  const r = run2(u.S, u.proc, u.vs, 120, { each: (sp) => { if (sp === 20) v.noteOff(0.5); if (endAt < 0 && sp > 20 && !v.active) endAt = sp; } });
  assert.ok(endAt > 0, 'ended');
  let last = -1;
  for (let i = r.L.length - 1; i >= 0; i--) if (r.L[i] !== 0) { last = i; break; }
  const K = Math.ceil(0.002 * u.proc.fs / CH), peak = maxAbs(r.L, last - 4 * K * CH, last - K * CH);
  assert.ok(peak > 0.3, 'full level until the fade: ' + peak.toFixed(3));
  assert.ok(maxAbs(r.L, last - CH, last + 1) < 0.05 * peak, 'the last chunk fades to 0: ' + maxAbs(r.L, last - CH, last + 1).toFixed(4));
  // the K fade chunks ramp the gain linearly to 0 (chunk j of the fade at most (K − j)/K of the level before it)
  const c0 = Math.floor(last / CH) - K + 1;
  for (let j = 0; j < K; j++) {
    const m = maxAbs(r.L, (c0 + j) * CH, (c0 + j + 1) * CH);
    assert.ok(m <= peak * (K - j) / K + 1e-9, 'fade chunk ' + j + ': ' + m.toFixed(4) + ' vs ' + (peak * (K - j) / K).toFixed(4));
  }
});

test('M2: PD (Self) crossfades a frame-pair jump over one chunk, as the other wavetable reads do (stepped WT position, §6.5, §6.6.4)', () => {
  // 64 interpolating frames: a sine (0–31) then an inverted sine (32–63); a stepped LFO moves WT POS across that edge
  const fr = [];
  for (let f = 0; f < 64; f++) fr.push(frame((p) => (f < 32 ? 1 : -1) * Math.sin(2 * Math.PI * p)));
  const T = entryFromFrames(fr, 1), steps = {};
  for (const [label, w1, warp] of [['none', 0, 0], ['bend_p', W2('bend_p'), 0.3], ['pd_self', W2('pd_self'), 0.05]]) {
    const s = st2({ 'a.wt': 0.2, 'a.w1': nEnum(w1, 81), 'a.warp': warp, 'l1.rate': 0.5 }, (st) => {
      st.osc[0].route = 1;
      st.lfo[0].pts = [[0, 0, 0], [0.5, 0, 0], [0.5001, 1, 0], [1, 1, 0]]; st.lfo[0].bpm = 0; st.lfo[0].mode = 'free';
      st.matrix[0] = { ...st.matrix[0], src: 'lfo1', dst: 'a.wt', amt: 0.6, bi: 0 };
    });
    const u = setup2({ s, tables: { 'test:jump': T, ...SUBS }, cpEdit: (cp) => { cp.wt[0] = 'test:jump'; } });
    u.vs[0].noteOn(45, 1, false, 1);
    const r = run2(u.S, u.proc, u.vs, 200);
    steps[label] = [maxStep(r.L, 2000, r.L.length), maxStep(r.L, 2000, 6000)];
  }
  console.log('  max sample step at the frame-pair jump (typical): ' + Object.entries(steps).map(([k, [a, b]]) => `${k} ${a.toFixed(4)} (${b.toFixed(4)})`).join(', '));
  assert.ok(steps.none[0] > 10 * steps.none[1], 'the jump happens');
  assert.ok(steps.pd_self[0] <= 1.5 * steps.none[0], 'PD (Self) crossfades like the plain read: ' + steps.pd_self[0].toFixed(4) + ' vs ' + steps.none[0].toFixed(4));
});

test('M2: keys a .kbm leaves unmapped (CP.tune NaN) are ignored: allocate gives no voice, noteOn leaves the voice as it was (§6.18)', () => {
  const u = setup2({ n: 2, cpEdit: (cp) => { cp.use |= 512; for (let k = 0; k < 128; k++) cp.tune[k] = k === 61 ? NaN : k; } });
  assert.equal(u.S.allocate(u.proc, 61), null, 'no voice for key 61');
  assert.ok(u.S.allocate(u.proc, 60) !== null);
  u.vs[0].noteOn(61, 1, false, 1);
  assert.ok(!u.vs[0].active && !u.vs[0].gate, 'unmapped key: no note');
  let r = run2(u.S, u.proc, u.vs, 5);
  assert.equal(maxAbs(r.L), 0, 'silence');
  u.vs[0].noteOn(60, 1, false, 1);
  r = run2(u.S, u.proc, u.vs, 5);
  assert.ok(maxAbs(r.L) > 0.05, 'mapped key sounds');
  u.vs[0].noteOn(61, 1, false, 1);                           // a steal by an unmapped key: ignored, the voice keeps its note
  assert.ok(u.vs[0].active && u.vs[0].gate && u.vs[0].note === 60);
  // without the tuning bit the table is not used (every key plays)
  const w = setup2({ cpEdit: (cp) => { for (let k = 0; k < 128; k++) cp.tune[k] = k === 61 ? NaN : k; } });
  w.vs[0].noteOn(61, 1, false, 1);
  assert.equal(w.vs[0].active, true);
});

// (M4 performance, SxMod advance) S2 mode: a per-voice LFO no row reads is not advanced on the voices other than the
// most recent one; the chunks it owes are replayed op for op when a row starts reading it — bit-identical to a voice on
// which it ran all along (here kept running by a row into the switched-off OSC B)
test('M4: a skipped per-voice LFO (S2, not the monitor voice, read by no row) pays its owed chunks exactly when a row starts reading it mid-note', () => {
  const rowB = (s) => { s.matrix[0] = { ...s.matrix[0], src: 'lfo3', dst: 'b.level', amt: 0.5 }; };
  const rowA = (s) => { s.matrix[1] = { ...s.matrix[1], src: 'lfo3', dst: 'a.pan', amt: 0.8 }; };
  const sKeep = st2({ 'l3.rate': 0.55 }, rowB), sSkip = st2({ 'l3.rate': 0.55 });
  const sAfter = st2({ 'l3.rate': 0.55 }, (s) => { rowB(s); rowA(s); });
  assert.equal(sKeep.p['b.on'], 0, 'OSC B off: its level row is inaudible');
  const go = (s0) => {
    const u = setup2({ s: s0, n: 2 });
    u.vs[0].noteOn(57, 0.9, false, 1); u.vs[1].noteOn(64, 0.8, false, 1);   // voice 1 is the most recent
    let owed = -1;
    const r = run2(u.S, u.proc, u.vs, 70, { each: (sp) => {
      if (sp !== 40) return;
      owed = u.vs[0].mod.lSk[2];
      const P = core.compileSerum(sAfter, {});
      u.proc.p = { serum: P.serum, fxr: null }; u.proc.ct = P.serumT;
      for (const v of u.vs) v.apply(u.proc.p);
    } });
    return { r, owed };
  };
  const keep = go(sKeep), skip = go(sSkip);
  assert.equal(keep.owed, 0, 'read by a row: never skipped');
  assert.ok(skip.owed > 30, 'skipped on the older voice: ' + skip.owed + ' chunks owed');
  const N = keep.r.N, a = 41 * N;
  assert.ok(rms(keep.r.L, a) > 1e-3, 'audible');
  for (let i = a; i < keep.r.L.length; i++) {
    if (keep.r.L[i] !== skip.r.L[i] || keep.r.R[i] !== skip.r.R[i]) assert.fail('sample ' + i + ': ' + keep.r.L[i] + ' vs ' + skip.r.L[i]);
  }
});

test('M2: lazy warm-ups (§11.10) — a Granular oscillator queues its bounded job once per live processor and asset (never offline); it runs after the first-use hidden voices, waits for its asset, plays two hidden notes and leaves the track as it was; warmTick returns 0 only when nothing is left', () => {
  const gran = (id = 'smp:sine') => st2({ 'a.dens': 0.6 }, (s) => { s.osc[0].type = 'gran'; s.osc[0].smp = id; s.osc[0].route = 1; });
  const u = setup2({ s: gran(), assets: { 'smp:sine': sineSmp('smp:sine') } }), N = 128 * u.proc.OS, sx = u.proc.sx;
  const W = u.proc.sxWarm;
  assert.ok(W && W.keys['sx-gran:smp:sine'] === 1 && W.q.length - W.h === 1, 'queued');
  u.vs[0].apply(u.proc.p);
  assert.equal(W.q.length - W.h, 1, 'once per processor and asset');
  sx.mon = 1;
  // the first-use hidden voices run first; they leave the Granular oscillator silent (no grains) and the job waits
  u.S.begin(u.proc, N); u.S.warmStart(u.proc);
  // the hidden voices start over three steps (made, applied, started; §14.1 row q), the job waiting behind them
  for (let j = 0; j < 3; j++) { u.S.begin(u.proc, N); assert.equal(u.S.warmTick(u.proc, N), 80 + 1, 'start step ' + j); assert.equal(sx.hwSt, j + 1); }
  assert.equal(sx.gw, null, 'the Granular job waits for the hidden voices');
  u.S.begin(u.proc, N);
  assert.equal(u.S.warmTick(u.proc, N), 79 + 1, '79 hidden spans left + the waiting Granular job');
  assert.ok(sx.hw !== null && sx.hw[0].ox[0] === null && sx.hw[0].hid === 1 && sx.grains === 0, 'no Granular in the first-use hidden voices');
  let left = 1, k = 0;
  for (; k < 100 && sx.hwN > 0; k++) { u.S.begin(u.proc, N); left = u.S.warmTick(u.proc, N); }
  assert.ok(sx.hwN === 0 && left === 1 && sx.gw !== null && sx.gw[1] === null && sx.gwSt === 1, 'hidden voices done; the job made its first voice in the same tick');
  // the job: the voices are made, applied and started in separate steps, then one voice renders per step
  const rec0 = sx.mod.recent, lp0 = sx.mod.lastPitch, alt0 = sx.alt, rng0 = sx.rng;
  let gr = 0, steps = 0, made = -1, two = -1;
  for (left = 1; steps < 3000 && left > 0; steps++) {
    u.S.begin(u.proc, N); left = u.S.warmTick(u.proc, N);
    const g = sx.gw;
    if (g !== null && made < 0) made = steps;
    if (g !== null && g[1] !== null && two < 0) two = steps;
    if (g !== null) { assert.ok(g[0].hid === 2 && sx.mod.recent === rec0, 'hidden, never the recent voice'); gr = Math.max(gr, sx.grains); }
  }
  assert.ok(left === 0 && sx.gwOk === 1 && sx.gw === null, 'finished: ' + steps + ' steps');
  assert.ok(made === 0 && two === 1, 'apply, then the second voice, in separate steps');
  assert.ok(steps > 600 && steps < 700, 'two voices × 320 chunks, one voice per step: ' + steps);
  assert.ok(gr > 0, 'grains played: ' + gr);
  assert.equal(sx.grains | 0, 0, 'grains returned');
  assert.ok(sx.mod.recent === rec0 && sx.mod.lastPitch === lp0 && sx.alt === alt0 && sx.rng === rng0, 'bookkeeping restored');
  assert.ok(sx.pk.every((x) => x === 0), 'hidden voices write no channel meter');
  assert.ok(u.vs.every((v) => !v.active), 'the processor’s voices untouched');
  // after a complete run another Granular sample queues nothing (the code is warm for any sample)
  const P2 = core.compileSerum(gran('smp:other'), {});
  u.proc.p = { serum: P2.serum, fxr: null }; u.proc.ct = P2.serumT;
  u.vs[0].apply(u.proc.p);
  assert.ok(W.keys['sx-gran:smp:other'] === undefined, 'not queued again');
  u.S.begin(u.proc, N);
  assert.equal(u.S.warmTick(u.proc, N), 0, 'nothing more to warm');
  // offline processors never queue
  const off = setup2({ s: st2() });
  off.proc.offline = true;
  const P = core.compileSerum(gran(), {});
  off.proc.p = { serum: P.serum, fxr: null }; off.proc.ct = P.serumT;
  off.vs[0].apply(off.proc.p);
  assert.equal(off.proc.sxWarm, undefined, 'offline: no warm-up');
  // the Granular asset arrives after the patch: the job waits for it (it is not used up), then plays
  const m = setup2({ s: gran('smp:late') }), ms = m.proc.sx;
  for (let j = 0; j < 20; j++) { m.S.begin(m.proc, N); assert.equal(m.S.warmTick(m.proc, N), 1, 'waiting for the asset'); }
  assert.ok(ms.gw === null && ms.gwOk === 0);
  assert.equal(m.B.storeAsset('smp:late', sineSmp('smp:late')), true);
  let mg = 0;
  for (left = 1, k = 0; k < 3000 && left > 0; k++) { m.S.begin(m.proc, N); left = m.S.warmTick(m.proc, N); mg = Math.max(mg, ms.grains); }
  assert.ok(left === 0 && ms.gwOk === 1 && mg > 0, 'played once the asset was stored');
  // ... and gives up after HW_WAIT steps when it never arrives
  const z = setup2({ s: gran('smp:never') });
  let zk = 0;
  for (left = 1; zk < 2000 && left > 0; zk++) { z.S.begin(z.proc, N); left = z.S.warmTick(z.proc, N); }
  assert.ok(left === 0 && zk === 800 && z.proc.sx.gwOk === 0, 'gave up after 800 steps: ' + zk);
  // a real note ends the job: warmEnd (the host, at the note) gives the grains back and restores the bookkeeping
  const r = setup2({ s: gran(), assets: { 'smp:sine': sineSmp('smp:sine') } }), rs = r.proc.sx;
  for (k = 0; k < 40; k++) { r.S.begin(r.proc, N); r.S.warmTick(r.proc, N); }
  assert.ok(rs.gw !== null && rs.grains > 0, 'mid-job');
  const rr0 = rs.rng;
  r.S.warmEnd(r.proc);
  assert.ok(rs.gw === null && rs.grains === 0 && rs.rng !== rr0, 'ended, grains back, the random sequence restored');
  r.vs[0].noteOn(60, 1, false, 1);
  r.S.begin(r.proc, N);
  assert.equal(r.S.warmTick(r.proc, N), 0, 'a sounding voice drops the job');
  // a job queued while the hidden voices wait for their wavetable: one step per tick; when they give up the job goes on
  const w = setup2({ s: st2(), tables: {} });
  let steps2 = 0;
  assert.equal(w.B.warmAdd(w.proc, 'test', () => ++steps2 < 3), true);
  w.S.begin(w.proc, N); w.S.warmStart(w.proc);
  assert.equal(w.S.warmTick(w.proc, N), 80 + 1, 'waiting: 80 hidden spans + 1 job');
  assert.equal(steps2, 1, 'the lazy job ran while waiting');
  w.proc.sx.hwWait = 1;
  assert.equal(w.S.warmTick(w.proc, N), 1, 'given up: the job is still queued');
  assert.equal(steps2, 2);
  assert.equal(w.S.warmTick(w.proc, N), 0, 'nothing left');
  assert.equal(steps2, 3);
});

test('M2: the first-use hidden voices wait for the Sample, Multisample (with zone samples) and Spectral assets, not only the wavetables (§11.10, §4.5)', () => {
  const N = 256;
  const cases = [
    ['sample', (s) => { s.osc[0].type = 'sample'; s.osc[0].smp = 'smp:a'; }, { 'smp:a': sineSmp('smp:a') }],
    ['multi', (s) => { s.osc[0].type = 'multi'; s.osc[0].multi = 'msmp:rr3'; }, RR3()],
    ['spectral', (s) => { s.osc[0].type = 'spec'; s.osc[0].smp = 'smp:a'; }, { 'spec:smp:a': sineSpec('spec:smp:a') }],
  ];
  for (const [name, edit, assets] of cases) {
    const u = setup2({ s: st2({}, (s) => { edit(s); s.osc[0].route = 1; }) }), sx = u.proc.sx;
    u.S.begin(u.proc, N); u.S.warmStart(u.proc);
    for (let k = 0; k < 5; k++) { u.S.begin(u.proc, N); u.S.warmTick(u.proc, N); }
    // (M4: a patch with a Spectral oscillator plays its hidden voices 240 spans, every other 80)
    assert.ok(sx.hw === null && sx.hwN === (name === 'spectral' ? 240 : 80) && sx.hwN === sx.hwT, name + ': waiting for its asset');
    const ids = Object.keys(assets);
    // a multisample waits for its zone samples as well
    for (let j = ids.length - 1; j >= 0; j--) {
      assert.equal(u.B.storeAsset(ids[j], assets[ids[j]]), true);
      u.S.begin(u.proc, N); u.S.warmTick(u.proc, N);
      assert.equal(sx.hw !== null, j === 0, name + ': started once every asset is stored (' + ids[j] + ')');
    }
  }
});

test('M2: the Granular lazy warm-up is bounded — p95 and max warmTick ≤ 1 ms (× k) for a dense Granular patch at OS 1, 2, 4 (§14.1 row q)', async () => {
  // tests/cpu-gate.mjs stepTimes: the deterministic job runs from a fresh state up to 5 times and each step keeps its
  // minimum (a scheduling burst or GC pause does not hit the same step on every run), × k (bench.json calibration)
  const smp = sineSmp('smp:sine', 96000);
  for (const OS of [1, 2, 4]) {
    let n = 0;
    const run = () => {
      const s = st2({ 'a.dens': 1, 'a.glen': 0.9, 'a.uni': nUni(7), 'a.w1': nEnum(W2('bend_p'), 81), 'a.warp': 0.5 },
        (x) => { x.osc[0].type = 'gran'; x.osc[0].smp = 'smp:sine'; x.osc[0].route = 1; });
      const u = setup2({ s, OS, n: 2, assets: { 'smp:sine': smp }, scope: dspScope({ fast: true }) }), N = 128 * OS;
      u.S.warmUp(Object.assign(makeProc(48000, OS), { vcN: 0, mpe: new Float64Array(68) }));   // the engine's constructor warm-up first
      const t = [];
      let left = 1, gr = 0;
      for (let j = 0; j < 3000 && left > 0; j++) {
        u.S.begin(u.proc, N);
        const t0 = performance.now(); left = u.S.warmTick(u.proc, N); t.push(performance.now() - t0);
        gr = Math.max(gr, u.proc.sx.grains);
      }
      assert.ok(left === 0 && u.proc.sx.gwOk === 1 && gr >= 256, 'the job ran with full grains: ' + gr);
      assert.ok(n === 0 || t.length === n, 'the same steps on every run');
      n = t.length;
      return t;
    };
    const ok = t => t[Math.floor(0.95 * t.length)] <= 1 && t[t.length - 1] <= 1;
    const r = await CPU.stepTimes(run, { tries: 5, min: 2, ok });
    const p95 = r.t[Math.floor(0.95 * r.t.length)], max = r.t[r.t.length - 1];
    console.log(`  OS ${OS}: ${r.t.length} steps, p95 ${p95.toFixed(3)} ms, max ${max.toFixed(3)} ms (k ${r.k.toFixed(3)}, per-step minimum of ${r.runs} runs)`);
    assert.ok(p95 <= 1 && max <= 1, 'OS ' + OS + ': p95 ' + p95.toFixed(3) + ' / max ' + max.toFixed(3) + ' ms');
  }
});

test('M2: audio taps (§5.3) — read from the CP rows (not SxMod internals); a switched-off oscillator reads 0 and is not rendered for its tap', () => {
  assert.ok(!/\.mod\.srcUsed/.test(SRC), 'serum-dsp keeps to the §11.6 sx.mod fields');
  const OSCB = core.SOURCES.findIndex((x) => x.id === 'oscb');
  const tap = (bOn) => {
    const u = setup2({ s: st2({ 'b.on': bOn }, (s) => { s.matrix[0] = { ...s.matrix[0], src: 'oscb', dst: 'a.fine', amt: 0.1 }; }) });
    u.vs[0].noteOn(57, 1, false, 1);
    let m = 0;
    run2(u.S, u.proc, u.vs, 20, { each: () => { m = Math.max(m, Math.abs(u.vs[0].src[OSCB])); } });
    return { m, cap: u.vs[0].oCap[1] };
  };
  const on = tap(1), off = tap(0);
  assert.ok(on.m > 0.5 && on.cap === 1, 'B on: the tap follows the oscillator ' + on.m);
  assert.ok(off.m === 0 && off.cap === 0, 'B off: 0, not rendered');
});

test('M2: Filter-sourced warp buffers (§6.6.7) are the previous chunk’s filter output in every chunk, zeros while the filter is off', () => {
  const mk = (mode, fOn = 1) => st2({ 'a.w1': mode ? nEnum(W2(mode), 81) : 0, 'a.warp': 0.5, ...FILT('f', T_LOW12, 0.5), 'f.on': fOn, 'e1.sus': 1 },
    (st) => { st.osc[0].route = 0; });
  const u = setup2({ s: mk('am_f1') }), v = u.vs[0];
  v.noteOn(57, 1, false, 1);
  run2(u.S, u.proc, u.vs, 10);
  const old = Float64Array.from(v.fp1);
  const PB = core.compileSerum(mk(''), {}), PA = core.compileSerum(mk('am_f1'), {}), P0 = core.compileSerum(mk('', 0), {});
  u.proc.p = { serum: PB.serum, fxr: null }; v.apply(u.proc.p);
  let prev = Float64Array.from(v.fp1), changed = 0;
  run2(u.S, u.proc, u.vs, 30, { each: (sp) => {
    if (sp === 15) v.noteOn(64, 1, true, 1);
    if (sp > 0 && v.fp1.some((x, i) => x !== prev[i])) changed++;
    prev = Float64Array.from(v.fp1);
  } });
  assert.ok(changed >= 28, 'kept current while no slot reads it: ' + changed + ' of 29 spans');
  u.proc.p = { serum: PA.serum, fxr: null }; v.apply(u.proc.p);
  assert.ok(v.fp1.some((x, i) => x !== old[i]) && v.fp1.some((x) => x !== 0), 're-selected: not the buffer of 30 spans ago');
  u.proc.p = { serum: P0.serum, fxr: null }; v.apply(u.proc.p);
  run2(u.S, u.proc, u.vs, 1);
  assert.ok(v.fp1.every((x) => x === 0), 'filter off: zeros');
});

test('M2: filter level, filter balance and bus sends ramp across the chunk — no chunk-rate zipper (§6.12)', () => {
  // 110 Hz sine (OS 1, chunk 4 samples), an LFO at ≈ 13 Hz on the gain: the 6–20 kHz band stays far below the fundamental
  const hf = (dst, out, p = {}, edit = null) => {
    const s = st2({ 'a.level': 0.75, 'f.on': 0, 'l1.rate': 0.6, 'e1.sus': 1, ...p }, (st) => {
      st.lfo[0].bpm = 0; st.lfo[0].mode = 'free'; st.lfo[0].pts = [[0, 0, 0], [0.5, 1, 0], [1, 0, 0]];
      st.matrix[0] = { ...st.matrix[0], src: 'lfo1', dst, amt: 0.4 };
      if (edit) edit(st);
    });
    const u = setup2({ s, OS: 1, tables: TSINE });
    u.vs[0].noteOn(45, 1, false, 1);
    const r = run2(u.S, u.proc, u.vs, 400, { outs: true }), x = r[out], N = 32768, re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) { const a = 2 * Math.PI * i / (N - 1); re[i] = x[x.length - N + i] * (0.35875 - 0.48829 * Math.cos(a) + 0.14128 * Math.cos(2 * a) - 0.01168 * Math.cos(3 * a)); }
    fft(re, im, false);
    const band = (f0, f1) => { let e = 0; for (let k = Math.round(f0 * N / 48000); k <= Math.round(f1 * N / 48000); k++) e += re[k] * re[k] + im[k] * im[k]; return e; };
    return 10 * Math.log10(band(6000, 20000) / band(100, 120));
  };
  const lv = hf('f.level', 'L'), amp = hf('a.level', 'L');
  const bal = hf('a.fbal', 'L', { 'f2.on': 1, 'f2.type': T_LOW12 / 107, 'f2.cutoff': 1 }, (st) => { st.filter[1].route = 3; });
  const bus = hf('a.bus1', 'b1L', { 'a.bus1': 0.5 });
  console.log(`  6–20 kHz re fundamental: f.level ${lv.toFixed(1)}, a.fbal ${bal.toFixed(1)}, a.bus1 ${bus.toFixed(1)}, a.level (reference) ${amp.toFixed(1)} dB`);
  for (const [n, x] of [['f.level', lv], ['a.fbal', bal], ['a.bus1', bus]]) assert.ok(x < -85, n + ': ' + x.toFixed(1) + ' dB');
});

test('M2: a full CT object hands its spectral filter curves to SxSpec (sx.CT.specFilt); a CT v2 parts object merges again afterwards (§4.1)', () => {
  const u = setup2(), P = core.compileSerum(st2(), {});
  const full = core.assembleCT(P.serumT);
  full.specFilt = new Float32Array(3 * 513).fill(0.25);
  u.proc.ct = full; u.S.begin(u.proc, 256);
  assert.ok(u.proc.sx.CT.specFilt.every((x) => x === 0.25), 'full CT curves');
  const bare = core.assembleCT(P.serumT);
  delete bare.specFilt;
  u.proc.ct = bare; u.S.begin(u.proc, 256);
  assert.ok(u.proc.sx.CT.specFilt.every((x) => x === 1), 'full CT without curves: flat');
  u.proc.ct = P.serumT; u.S.begin(u.proc, 256);
  for (let o = 0; o < 3; o++) sameArr(u.proc.sx.CT.specFilt.subarray(o * 513, o * 513 + 513), P.serumT.parts['spec' + o].tab, 'parts merged again: spec' + o);
});

test('M2: one console.warn per missing oscillator-type script (§0.3)', () => {
  const sc = dspScope({ overrides: { 'sx-sample.js': null, 'sx-gran.js': null } });
  const s = st2({ 'b.on': 1, 'c.on': 1 }, (st) => { st.osc[0].type = 'sample'; st.osc[1].type = 'multi'; st.osc[2].type = 'gran'; });
  const u = setup2({ s, scope: sc, n: 2 });
  u.vs[0].apply(u.proc.p);
  const w = sc.logs.filter((m) => m.level === 'warn' && /unavailable, those oscillators are silent/.test(m.text)).map((m) => m.text);
  assert.equal(w.length, 2, w.join(' | '));
  assert.ok(w.some((t) => t.includes('SxSample')) && w.some((t) => t.includes('SxGran')));
});
