// serum-dsp.js unit tests (owner E3). Run: node --test tests/
// Covers SPEC-serum §10.4 items 1–29: script shape and loading, constants vs tests/fixtures (§3), table store, curves,
// SFilter (all 96 types) and filterImpulse, then voices (pitch, unison, warps, phase, envelopes, LFOs, chaos, noise,
// matrix, note-on evaluation, performance destinations), hooks, snapshot, warm-up, allocation-free hot paths and CPU,
// plus regressions from the reviews (matrix edits while notes sound, reset/warmUp re-sync, transport bookkeeping, WT
// frame-pair crossfades, unison steals, Env-mode anchored LFOs, point-modulation equivalence, low-note aliasing).
//
// Imports only serum-dsp.js (through node:vm, as the spec's loadDSP) and tests/fixtures/* (E1, M1): the compiled
// default CP/CT (cp-default.json, ct-default.json) and dests.json/filters.json. Wavetables are built here (§7.3).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFixture } from './fixtures/load.mjs';

const SRC = readFileSync(new URL('../serum-dsp.js', import.meta.url), 'utf8');
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
function loadDSP(ctx = vm.createContext({ console: mkConsole() })) {
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
  assert.deepEqual(added, ['SerumDSP'], 'nothing but SerumDSP leaks into the global scope');
  assert.equal(S.VER, 1);
  assert.equal(typeof S.epoch, 'number');
  const fns = { storeWT: 2, storeWTFrame: 3, dropWT: 1, attach: 1, reset: 1, idle: 2, transport: 2, begin: 2, fxMods: 1,
    snapshot: 1, warmUp: 1, bend: 2, evalPts: 4, renderWarp: 4, filterImpulse: 6, SerumVoice: 2, SFilter: 1 };
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
  e.setType(200); assert.equal(e.type, 95);
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

// ---- fixtures and builders (tests import only serum-dsp.js and tests/fixtures/*) ----
const DESTS = DESTS_FX.DESTS;
const DI = {};
DESTS.forEach((d, i) => { DI[d.id] = i; });
const SRC_IDS = ['', 'wheel', 'env1', 'env2', 'env3', 'lfo1', 'lfo2', 'lfo3', 'lfo4', 'lfo5', 'lfo6', 'lfo7', 'lfo8', 'velo',
  'note', 'at', 'pat', 'chaos1', 'chaos2', 'noise', 'rand1', 'rand2', 'alt1', 'alt2', 'macro1', 'macro2', 'macro3',
  'macro4', 'bend', 'mpex', 'mpey', 'mpez', 'relvel', 'fixed'];
const SI = {};
SRC_IDS.forEach((id, i) => { if (id) SI[id] = i; });
const CTX_OF = { V: 1, 'V*': 1, 'V*M': 3, G: 2, M: 4 };
const ON_DESTS = ['a.uni', 'b.uni', 'a.phase', 'b.phase', 'a.rand', 'b.rand', 'n.phase', 'n.rand'];
const BI_SRC = new Set(['chaos1', 'chaos2', 'noise', 'bend', 'mpex']);

// matrix row in CP layout (§4.1): rows = [{src, dst, amt, bi, curve, aux, inv, out}]
function addRow(cp, { src, dst, amt = 1, bi = 0, curve = 0, aux = '', inv = 0, out = 1 }) {
  const r = cp.mN++, si = SI[src], di = DI[dst], ai = aux ? SI[aux] : 0;
  assert.ok(si && di !== undefined && ai !== undefined, 'row ' + src + ' → ' + dst);
  cp.mSrc[r] = si; cp.mDst[r] = di; cp.mAmt[r] = amt * out; cp.mBi[r] = bi; cp.mK[r] = 6 * curve; cp.mAux[r] = ai;
  cp.mInv[r] = inv; cp.mCtx[r] = CTX_OF[DESTS[di].scope]; cp.mOn[r] = ON_DESTS.includes(dst) ? 1 : 0;
  cp.srcUsed[si] = 1;
  if (ai) cp.srcUsed[ai] = 1;
  if (di < 148) cp.modded[di] = 1;
}
// CP = compiled default (fixture) with base values p {id: n}, matrix rows and extra CP fields
function mkCP(p = {}, rows = [], extra = {}) {
  const cp = loadFixture('cp-default.json');
  for (const [id, n] of Object.entries(p)) { assert.ok(DI[id] < 148, id); cp.base[DI[id]] = n; }
  for (const r of rows) addRow(cp, r);
  Object.assign(cp, extra);
  return cp;
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
// CT = default (fixture) with LFO graphs replaced: lfos = {l: {pts: [[x, y, c, mx?, my?]], start?, loop?}}
let ctSeq = 0;
function mkCT(lfos = {}, cp = null) {
  const ct = loadFixture('ct-default.json');
  const graphs = [];
  for (let l = 0; l < 8; l++) {
    const o = ct.lfoPtsOff[l], n = ct.lfoPtsOff[l + 1] - o, pts = [];
    for (let j = 0; j < n; j++) pts.push([ct.lfoPts[3 * (o + j)], ct.lfoPts[3 * (o + j) + 1], ct.lfoPts[3 * (o + j) + 2], 0, 0]);
    graphs.push(lfos[l] ? { start: 0, loop: -1, ...lfos[l] } : { pts, start: 0, loop: -1 });
  }
  const tot = graphs.reduce((a, g) => a + g.pts.length, 0);
  ct.lfoPts = new Float64Array(3 * tot); ct.lfoPm = new Uint8Array(2 * tot); ct.lfoPtsOff = new Uint16Array(9);
  ct.lfoPmAny = new Uint8Array(8); ct.lfoStart = new Float64Array(8); ct.lfoLoop = new Float64Array(8);
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
  ct.lfoPtsOff[8] = o;
  ct.key = 'test' + (++ctSeq);
  if (cp) cp.ctKey = ct.key;
  return ct;
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
      if (['proc', 'lvD', 'sD', 'nLvL', 'nLvR'].includes(key)) return;   // host / shared wavetable data
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
    run(S, proc, [v], spansOf(0.6), { each: (s) => pts.push([s * 128 / 48000, v.nP]) });
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
  assert.equal(v.nP, 67);
  // always: glides from the last pitch even without overlap
  const al = setup({ cp: mkCP({ 'g.porta': 0.5 }, [], { mono: 1, always: 1 }) });
  al.proc.held = [60]; al.vs[0].noteOn(60, 1, false, 1); run(al.S, al.proc, al.vs, 4); al.vs[0].noteOff(); al.proc.held = [];
  run(al.S, al.proc, al.vs, 4);
  al.proc.held = [72]; al.vs[0].noteOn(72, 1, false, 1);
  assert.equal(al.vs[0].nP, 60);
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
  cp.lfoMode[l] = mode; cp.lfoBpm[l] = 0; cp.lfoAnchor[l] = 0;
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
      if (mode === 2) assert.ok(Math.abs(proc.sx.g[5 * 32] - want) < 1e-6, 'Off LFO global value uses the mono bus');
    }
  }
  // X link: the point's x moves (between its neighbours) with the bus value
  const cp = lfoCP(0, 0, { 'l1.rate': 0 }, [{ src: 'fixed', dst: 'bus2', amt: -0.2 }]);
  const ct = mkCT({ 0: { pts: [[0, 0, 0], [0.5, 1, 0, 2, 0], [1, 0, 0]], start: 0 } }, cp);
  const { S, proc, vs: [v] } = setup({ cp, ct });
  proc.sx.mon = 1;
  v.noteOn(60, 1, false, 1);
  v.lPh[0] = 0.3;                                           // bus2 = 2·0.3 − 1 = −0.4 → peak at x 0.1: y(0.3) = 1 − 0.2/0.9
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
    let last = v.lPh[0], t = 0;
    const N = 128 * proc.OS, b = new Float64Array(N);
    for (let s = 0; s < spansOf(2.2); s++) {
      S.begin(proc, N);
      for (let c = 0; c < 32; c++) { v.render(b, b, proc.CH); t += 4 / 48000; if (v.lPh[0] < last) wraps.push(t); last = v.lPh[0]; }
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
      assert.ok(Math.abs(proc.sx.oPh[0] - want) < 1e-9, `beat ${beat}: ${proc.sx.oPh[0]} vs ${want}`);
    }
    proc.songBeat = () => null;                             // stopped: the processor beat clock carries on
    const b0 = proc.sx.beatClk;
    S.begin(proc, 256);
    assert.ok(Math.abs(proc.sx.beatClk - (b0 + 32 * (proc.CH / proc.fs) * 2)) < 1e-9);
  }
  // Env mode: one pass, holds y(1); with a loop point: loops while gated, runs out after note-off
  {
    const cp = lfoCP(0, 1, { 'l1.rate': 0.6 });
    const ct = mkCT({ 0: { pts: [[0, 0, 0], [0.5, 1, 0], [1, 0.3, 0]], loop: -1 } }, cp);
    const { S, proc, vs: [v] } = setup({ cp, ct });
    proc.sx.mon = 1;
    v.noteOn(60, 1, false, 1);
    run(S, proc, [v], spansOf(0.5));
    assert.equal(v.lPh[0], 1);
    assert.ok(Math.abs(S.snapshot(proc).lfoOut[0] - 0.3) < 1e-6, 'holds y(1)');
    const cp2 = lfoCP(0, 1, { 'l1.rate': 0.6 });
    const ct2 = mkCT({ 0: { pts: [[0, 0, 0], [0.5, 1, 0], [1, 0.3, 0]], loop: 1 } }, cp2);
    const q = setup({ cp: cp2, ct: ct2 });
    q.proc.sx.mon = 1;
    q.vs[0].noteOn(60, 1, false, 1);
    let minPh = 1;
    run(q.S, q.proc, q.vs, spansOf(1), { each: (s) => { if (s > spansOf(0.3)) minPh = Math.min(minPh, q.vs[0].lPh[0]); } });
    assert.ok(minPh >= 0.5 && q.vs[0].lPh[0] < 1, 'loops between the loop point and the end while gated');
    q.vs[0].noteOff();
    run(q.S, q.proc, q.vs, spansOf(0.3));
    assert.equal(q.vs[0].lPh[0], 1, 'runs out after note-off');
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
    assert.equal(v.lPh[0], 0.5, 'rate 0 holds the phase');
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
    for (let s = 0; s < spansOf(sec); s++) { S.begin(proc, N); for (let c = 0; c < 32; c++) { tr.push([t, v.eV[0], v.eSt[0], v.eT[0], v.eV[1]]); v.render(b, b, proc.CH); t += 4 / 48000; } }
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
  assert.equal(s.v.eSt[0], 5);
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
      if (s % 50 === 0) out.push(proc.sx.g[17 * 32 + 5], proc.sx.g[18 * 32 + 9]);
      for (let c = 0; c < 32; c++) { const a = proc.sx.g[17 * 32 + c], b = proc.sx.g[18 * 32 + c]; if (!(Math.abs(a) <= 1 && Math.abs(b) <= 1)) assert.fail('chaos out of range'); }
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
    for (let c = 0; c < 32; c++) { const y = q.proc.sx.g[17 * 32 + c]; if (prev !== null && y !== prev) changes.push(t); prev = y; t += 4 / 48000; }
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
  const fxp = loadFixture('fxp-default.json');
  const cp = mkCP({ 'e1.att': 0, 'e1.rel': 0.3 }, [{ src: 'env1', dst: 'fx.fil.cutoff', amt: 0.5 }, { src: 'lfo1', dst: 'f.cutoff', amt: 0.3 }]);
  const { S, proc, vs: [v] } = setup({ cp, fxp });
  assert.equal(S.snapshot({}), null);
  const o0 = S.fxMods(proc);
  assert.equal(o0.length, 100);
  v.noteOn(60, 1, false, 1);
  const effs = [];
  run(S, proc, [v], 40, { each: (s) => { if (s > 1) effs.push(S.snapshot(proc).eff[42]); } });
  const off = S.fxMods(proc);
  assert.equal(off, o0, 'reused array');
  assert.ok(Math.abs(off[79] - 0.5) < 1e-9, 'Env1 (sustain 1) × 0.5 at fx idx 79: ' + off[79]);
  assert.ok(off.every((x, k) => k === 79 || x === 0));
  const sn = S.snapshot(proc);
  assert.ok(Math.abs(sn.eff[148 + 79] - Math.min(1, fxp.base[79] + 0.5)) < 1e-6, 'snapshot FX eff = base + offset');
  assert.ok(Math.max(...effs) - Math.min(...effs) > 0.1, 'eff[42] follows the LFO');
  v.noteOff();
  run(S, proc, [v], 60);
  assert.ok(Math.abs(S.fxMods(proc)[79]) < 1e-4, 'back to 0 after the release');
  // snapshot shape and counters
  assert.equal(sn.envStage.length, 3);
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
  for (let l = 0; l < 8; l++) assert.ok(Math.abs(A.proc.sx.oPh[l] - B.proc.sx.oPh[l]) < 1e-9);
  assert.ok(Math.abs(A.proc.sx.beatClk - B.proc.sx.beatClk) < 1e-9);
  assert.deepEqual(Array.from(A.proc.sx.mch), Array.from(B.proc.sx.mch));
  // reset restores every sx field to its attach state (the host's monitor flag survives)
  proc.sx.mon = 1;
  S.reset(proc);
  const fresh = S.attach(makeProc());
  for (const k of Object.keys(fresh)) {
    if (k === 'snap' || k === 'mon') continue;
    assert.deepEqual(proc.sx[k], fresh[k], 'reset restores ' + k);
  }
  assert.equal(proc.sx.mon, 1);
});

/* ------------------------------------------------------------------ performance destinations, note-on, voices (§10.4.24–28) */

test('performance destinations: Fixed → g.wheel / g.bend add to the host values in the mono context (§10.4.24)', () => {
  const at = (proc, src) => proc.sx.g[src * 32 + proc.sx.nCh - 1];
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
      assert.equal(b.eSt[0], a.eSt[0]);
      assert.ok(Math.abs(b.eV[0] - a.eV[0]) < 1e-12 && b.eV[0] > 0.3, 'starts at the gated voice\'s level');
    } else {
      assert.equal(b.eV[0], 0);
      assert.equal(b.eSt[0], 1);
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
  const g = sx.g;
  S.attach(proc);
  assert.equal(sx.g, g, 'no reallocation');
  assert.equal(g.length, 34 * 32);
  for (const [k, n] of [['monoSrc', 34], ['monoOff', 148], ['monoEff', 148], ['tap', 1024], ['fxOff', 100]]) assert.equal(sx[k].length, n, k);
  const off = S.fxMods(proc);
  assert.equal(off[Symbol.toStringTag], 'Float64Array');
  assert.equal(off.length, 100);
  assert.equal(S.fxMods(proc), off, 'reused');
  assert.ok(off.every((v) => v === 0));
  S.begin(proc, 256);
  assert.equal(sx.span, 1); assert.equal(sx.nCh, 32);
  S.begin(proc, 16);
  assert.equal(sx.span, 2); assert.equal(sx.nCh, 2);
  // a patch: snapshot shows the bases until a note plays; FX eff = FXP base (+ offsets) clamped
  const cp = mkCP({ 'f.cutoff': 0.25 }), fxp = loadFixture('fxp-default.json');
  proc.p = { serum: cp, fxr: fxp };
  S.begin(proc, 256);
  const snap = S.snapshot(proc);
  assert.equal(S.snapshot(proc), snap, 'reused object');
  const lens = { eff: 248, lfoPh: 8, lfoOut: 8, env: 3, envStage: 3, envT: 3, wtPos: 2, memNow: 32, filtTap: 1024 };
  for (const [k, n] of Object.entries(lens)) assert.equal(snap[k].length, n, k);
  for (const k of ['noisePos', 'notes', 'oscVoices', 'maxVoices', 'tapRate']) assert.equal(typeof snap[k], 'number', k);
  assert.equal(snap.eff[42], 0.25);
  for (let k = 0; k < 100; k++) assert.equal(snap.eff[148 + k], Math.fround(fxp.base[k]));
  assert.equal(snap.maxVoices, 8 * 16, 'poly 8 × (16 · A on)');
  // a CP with another major version: begin is bookkeeping only, voices stay silent
  proc.p = { serum: { ...cp, ver: 2 }, fxr: null };
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
  assert.equal(proc.sx.recent, v);
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
  assert.equal(v.gate, false); assert.equal(v.relvel, 0.2);
  v.noteOn(61, 1, false, 1); v.noteOff();
  assert.equal(v.relvel, 0.5);
  v.kill();
  assert.equal(v.active, false);
  // another major version: warn once, stay silent/inactive
  const x = new S.SerumVoice(proc, 4);
  x.apply({ serum: { ...mkCP(), ver: 2 } });
  x.apply({ serum: { ...mkCP(), ver: 2 } });
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

test('CPU budgets (a), (b), (c) at OS 2 (outside node:vm; fail only beyond 3×), OS 1 and 4 informative (§10.4.17)', () => {
  // evaluated in this realm (no vm global interceptor), as in the AudioWorkletGlobalScope
  const had = globalThis.SerumDSP;
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
        cp.lfoMode[0] = 0; cp.lfoBpm[0] = 0; cp.base[D.L1_RATE] = Math.pow(2 / 100, 0.25);
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
    assert.ok(res['2a'][0] <= 3 * 400, '(a) ' + res['2a'][0].toFixed(0) + ' ms (target 400)');
    assert.ok(res['2b'][0] <= 3 * 900, '(b) ' + res['2b'][0].toFixed(0) + ' ms (target 900)');
    assert.ok(res['2a'][1] <= 3 * 0.02 * res['2a'][0], '(c) ' + res['2a'][1].toFixed(2) + ' ms (target 2 % of (a))');
    // 1x quality (and the CPU safeguard's OS cap) must save CPU: OS 1 cheaper than OS 2 (measured ≈ 0.7×)
    console.log(`  CPU OS 1 / OS 2: (a) ${(res['1a'][0] / res['2a'][0]).toFixed(2)}, (b) ${(res['1b'][0] / res['2b'][0]).toFixed(2)}`);
    assert.ok(res['1a'][0] < res['2a'][0] && res['1b'][0] < res['2b'][0], 'OS 1 costs less than OS 2');
  } finally {
    globalThis.SerumDSP = had;
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
  const m = setup({ cp: { ...mkCP(), ver: 1.1 } });
  m.vs[0].noteOn(60, 1, false, 1);
  assert.ok(maxAbs(run(m.S, m.proc, m.vs, 10).L) > 0.3, 'CP ver 1.1 plays');
  const x = setup({ cp: { ...mkCP(), ver: 2 } });
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
        const ph = v.lPh[0];
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
  const b0 = proc.sx.beatClk;
  v.noteOn(60, 1, false, 1);
  run(S, proc, [v], spansOf(0.2));
  assert.ok(Math.abs(v.lPh[0] - (proc.sx.beatClk - b0) / 2) < 1e-9, '2 beats per cycle');
  const cp2 = lfoCP(0, 1, { 'l1.rate': 6 / 14 }, [{ src: 'lfo1', dst: 'f.res', amt: 0.1 }, { src: 'fixed', dst: 'l1.rate', amt: 1 / 14 }]);
  setLfo(cp2, 0, { bpm: 1, anchor: 1 });
  cp2.ctKey = cp.ctKey;
  proc.p = { serum: cp2, fxr: null };
  v.apply(proc.p);
  run(S, proc, [v], spansOf(0.1));
  assert.ok(Math.abs(v.lPh[0] - (proc.sx.beatClk - b0) / 1) < 1e-9, 'jumps to the anchored position of the new rate');
  run(S, proc, [v], spansOf(0.6));
  assert.equal(v.lPh[0], 1, 'holds at the end');
});

test('interpolating tables crossfade a frame-pair jump over one chunk (stepped WT position, §5.6, §6.5)', () => {
  const sine = frame((p) => Math.sin(2 * Math.PI * p));
  const frames = [sine, sine.map((x) => 0.2 * x), sine.map((x) => -x)];
  const worst = (interp) => {
    const cp = mkCP({ 'l1.rate': Math.pow(2 / 100, 0.25) }, [{ src: 'lfo1', dst: 'a.wt', amt: 1 }], { wt: ['t', 't'] });
    cp.lfoMode[0] = 0; cp.lfoBpm[0] = 0;
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
      const L = run(S, proc, vs, 40, { each: () => fx.push(proc.sx.fxOff[79]) }).L;
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
    for (let l = 0; l < 8; l++) { cp.lfoMode[l] = Math.floor(3 * r()); cp.lfoBpm[l] = r() < 0.5 ? 1 : 0; cp.lfoAnchor[l] = r() < 0.5 ? 1 : 0; }
    cp.direct = cp.subDirect;
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
    ph.push(proc.sx.oPh[2]);
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
  const rec0 = proc.sx.recent, lp0 = proc.sx.lastPitch, alt0 = proc.sx.alt, rng0 = proc.sx.rng;
  let left = 1;
  for (let k = 0; k < 200 && left > 0; k++) { S.begin(proc, N); left = S.warmTick(proc, N); if (k === 0) assert.equal(proc.sx.hw.length, 2); }
  assert.equal(left, 0, 'finished');
  assert.equal(proc.sx.hw, null);
  assert.ok(proc.sx.recent === rec0 && proc.sx.lastPitch === lp0 && proc.sx.alt === alt0 && proc.sx.rng === rng0, 'bookkeeping restored');
  assert.ok(proc.voices.length === 1 && !v.active, 'the processor’s voices untouched');
  // a reset ends a warm-up under way
  S.warmStart(proc); S.begin(proc, N); S.warmTick(proc, N);
  assert.ok(proc.sx.hw !== null);
  S.reset(proc);
  assert.ok(proc.sx.hw === null && S.warmTick(proc, N) === 0);
});
