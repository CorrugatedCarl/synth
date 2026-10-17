// sx-filt2.js unit tests (owner D3; SPEC-serum2 §15.7 new filters, §11.7, §3.5, §6.13). Loads the script through
// tests/dsp-scope.mjs. Responses are measured from impulse responses (DFT at single frequencies), the Phase-1 method.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../serum-core.js?v=8';
import { dspScope, DSP_TABLE, noAlloc } from './dsp-scope.mjs';
import { readFileSync } from 'node:fs';

const arr = a => Array.from(a);
const load = (opts = {}) => {
  const S = dspScope({ files: ['sx-filt2.js'], ...opts });
  return { S, F: S.global('SxFilt2') };
};
const warns = S => S.logs.filter(m => m.level === 'warn').map(m => m.text);
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const TYPES = Array.from({ length: 12 }, (_, j) => 96 + j);
const METHODS = { set: 5, setXY: 2, setPZ: 1, tick: 2, process: 4, reset: 0, setRate: 1 };
const mag = (h, f, fs) => {
  let re = 0, im = 0;
  for (let i = 0; i < h.length; i++) { const a = 2 * Math.PI * f * i / fs; re += h[i] * Math.cos(a); im -= h[i] * Math.sin(a); }
  return Math.hypot(re, im);
};
const dB = x => 20 * Math.log10(x);
const maxDiffA = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const MIDI0 = 440 * 2 ** (-69 / 12);
const readRef = () => readFileSync(new URL('./ref-p1/serum-dsp.js', import.meta.url), 'utf8');   // the frozen Phase-1 SFilter
// self-oscillation frequency and peak of a filter excited by a small impulse (second half of 1 s)
function oscillation(F, type, fc, fs, vr = 0) {
  const f = F.make(type, fs);
  f.set(fc, fc, 1, 0, vr);
  const N = fs, y = new Float64Array(N);
  for (let i = 0; i < N; i++) { const x = i === 0 ? 0.01 : 0; f.tick(x, x); y[i] = f.yl; }
  let first = -1, last = -1, zc = 0, pk = 0;
  for (let i = N / 2; i < N; i++) {
    if (y[i - 1] < 0 && y[i] >= 0) { const p = i - 1 - y[i - 1] / (y[i] - y[i - 1]); if (first < 0) first = p; last = p; zc++; }
    pk = Math.max(pk, Math.abs(y[i]));
  }
  return { freq: zc > 1 ? (zc - 1) * fs / (last - first) : 0, pk };
}

/* ------------------------------------------------------------------ loading and shape (§0.3, §11.7) */

test('loads in a bare scope, publishes only the frozen SxFilt2 with the §11.7 API (names, arities)', () => {
  const S = dspScope({ files: [], bare: true });
  const names = () => new Set(S.run('Object.getOwnPropertyNames(globalThis)', 't.js'));
  const before = names();
  S.reload('sx-filt2.js');
  assert.deepEqual([...names()].filter(k => !before.has(k)), ['SxFilt2']);
  const F = S.global('SxFilt2');
  assert.ok(F && Object.isFrozen(F));
  assert.deepEqual(Object.keys(F).sort(), ['FAM', 'FAMILY', 'FIRST', 'IDS', 'LAST', 'LINE_FLOOR_HZ', 'NTYPES', 'PZ_DEFAULT', 'VER', 'impulse',
    'make', 'need'].sort());
  assert.equal(F.VER, 1);
  assert.equal(F.FIRST, 96); assert.equal(F.LAST, 107); assert.equal(F.NTYPES, 12);
  assert.equal(F.LINE_FLOOR_HZ, 20);
  assert.equal(typeof F.make, 'function'); assert.equal(F.make.length, 2, 'make(type, fs, pool = null)');
  assert.equal(typeof F.need, 'function'); assert.equal(F.need.length, 2);
  assert.equal(typeof F.impulse, 'function'); assert.equal(F.impulse.length, 6, 'impulse(type, fc, res, drive, vr, fs, len = 4096, x, y, pz)');
  assert.ok(Object.isFrozen(F.IDS) && Object.isFrozen(F.FAMILY));
  assert.equal(S.logs.length, 0, 'no console output on load');
});

test('reads no other script\'s global at load; re-evaluation works; a failure inside leaves SxFilt2 = null', () => {
  const S = dspScope({ files: [] });
  const others = DSP_TABLE.map(e => e[1]).filter(g => g !== 'SxFilt2');
  S.run('(function (gs) { for (const g of gs) Object.defineProperty(globalThis, g, { configurable: true,'
    + ' get() { throw new Error("read " + g + " at load"); } }); })', 't.js')(others);
  S.reload('sx-filt2.js');
  const F1 = S.global('SxFilt2');
  assert.ok(F1 && F1.VER === 1);
  assert.equal(S.logs.length, 0);
  for (const t of TYPES) assert.ok(F1.make(t, 48000), 'make reads no other global either: ' + t);
  S.reload('sx-filt2.js');
  const F2 = S.global('SxFilt2');
  assert.ok(F2 && F2 !== F1 && Object.isFrozen(F2));
  const B = dspScope({ files: ['sx-filt2.js'], overrides: { 'sx-filt2.js': src => src.replace('const VER = 1,', 'const VER = (() => { throw new Error("boom"); })(),') } });
  assert.equal(B.global('SxFilt2'), null);
  assert.ok(B.logs.some(m => m.level === 'error' && /sx-filt2: load failed/.test(m.text)));
});

/* ------------------------------------------------------------------ constants (§3.5, §6.13.4) */

test('IDS / FAMILY / FAM equal serum-core FILTERS 96–107 and SxBase.FILTER_FAM2; PZ_DEFAULT = serum-core PZ_DEFAULT', () => {
  const S = dspScope({ files: ['sx-base.js', 'sx-filt2.js'] });
  const F = S.global('SxFilt2'), B = S.global('SxBase');
  assert.equal(core.FILTERS.length, 108);
  assert.deepEqual(arr(F.IDS), core.FILTERS.slice(96).map(f => f.id));
  assert.deepEqual(arr(F.FAMILY), core.FILTER_FAMILY.slice(19));
  assert.equal(F.FAM.constructor.name, 'Uint8Array');
  assert.deepEqual(arr(F.FAM), core.FILTERS.slice(96).map(f => core.FILTER_FAMILY.indexOf(f.family)));
  assert.deepEqual(arr(F.FAM), arr(B.FILTER_FAM2).slice(96));
  for (let j = 0; j < 12; j++) assert.equal(F.FAMILY[F.FAM[j] - 19], core.FILTERS[96 + j].family);
  assert.equal(F.PZ_DEFAULT.constructor.name, 'Float64Array');
  assert.deepEqual(arr(F.PZ_DEFAULT), core.PZ_DEFAULT.flat());
  const cp = core.compileSerum(core.defaultSerum(), { bpm: 120 }).serum;
  assert.equal(cp.pz.length, 24);
  assert.deepEqual(arr(cp.pz).slice(0, 12), arr(F.PZ_DEFAULT));
  assert.deepEqual(arr(cp.pz).slice(12), arr(F.PZ_DEFAULT));
});

/* ------------------------------------------------------------------ make and the family object (§11.7) */

test('make(type, fs): a family object for every type 96–107 with the §11.7 members; anything else ⇒ null + one warning', () => {
  const { S, F } = load();
  for (const t of TYPES) {
    const f = F.make(t, 96000);
    assert.ok(f && typeof f === 'object', 'type ' + t);
    assert.equal(f.type, t);
    assert.equal(f.fam, F.FAM[t - 96]);
    assert.equal(f.fs, 96000);
    assert.equal(f.yl, 0); assert.equal(f.yr, 0);
    assert.ok(Number.isFinite(f.bytes) && f.bytes > 0);
    for (const [k, n] of Object.entries(METHODS)) {
      assert.equal(typeof f[k], 'function', k);
      assert.equal(f[k].length, n, k + ' arity');
    }
    assert.deepEqual(arr(f.pz), arr(F.PZ_DEFAULT));
    assert.equal(f.x, 0); assert.equal(f.y, 0);
    assert.notEqual(f.pz, F.PZ_DEFAULT, 'own copy');
    const own = [...new Set(Object.entries(f).filter(([k, v]) => ArrayBuffer.isView(v) && k !== 'pool').map(e => e[1]))].reduce((n, v) => n + v.byteLength, 0);
    assert.equal(f.bytes, own, 'bytes = Σ own typed arrays');
  }
  assert.notEqual(F.make(96, 48000), F.make(96, 48000), 'one object per call');
  assert.equal(warns(S).length, 0);
  for (const t of [95, 108, 0, -1, 96.5, NaN, Infinity, '96', null, undefined]) assert.equal(F.make(t, 48000), null, String(t));
  for (const fs of [0, -48000, NaN, Infinity, '48000', null, undefined]) assert.equal(F.make(100, fs), null, String(fs));
  assert.equal(warns(S).length, 2, 'type, fs: one warning each per scope');
});

test('family object setters: set clamps like SFilter.set, setXY clamps, setPZ copies 12 corners (with offset), validates length', () => {
  const { S, F } = load();
  const f = F.make(103, 48000);
  f.set(5, 30000, 2, -1, NaN);
  assert.equal(f.fcL, 8); assert.equal(f.fcR, 0.45 * 48000);
  assert.equal(f.res, 1); assert.equal(f.drive, 0); assert.equal(f.vr, 0);
  f.set(NaN, 1234.5, 0.25, 0.5, 0.75);
  assert.equal(f.fcL, 8); assert.equal(f.fcR, 1234.5);
  assert.equal(f.res, 0.25); assert.equal(f.drive, 0.5); assert.equal(f.vr, 0.75);
  f.setXY(0.3, 1.7); assert.equal(f.x, 0.3); assert.equal(f.y, 1);
  f.setXY(-2, NaN); assert.equal(f.x, 0); assert.equal(f.y, 0);
  const pz = new Float64Array(24).map((_, j) => (j < 12 ? 0.1 : -0.2) * (1 + (j % 3)));
  f.setPZ(pz, 12);
  assert.deepEqual(arr(f.pz), arr(pz).slice(12));
  f.setPZ(pz);
  assert.deepEqual(arr(f.pz), arr(pz).slice(0, 12));
  f.setPZ([2, -3, NaN, 0.5, 0.5, 0.5, 0, 0, 0, 1, 1, 1]);
  assert.deepEqual(arr(f.pz).slice(0, 3), [1, -1, pz[2]], 'clamped to [−1, 1]; NaN keeps the previous value');
  const before = arr(f.pz);
  f.setPZ(new Float64Array(11)); f.setPZ(pz, 13); f.setPZ(null); f.setPZ(7);
  assert.deepEqual(arr(f.pz), before, 'short or missing corner data is ignored');
  assert.equal(warns(S).length, 1, 'one warning per scope');
  f.setRate(16000);
  assert.equal(f.fs, 16000); assert.equal(f.fcR, 1234.5);
  f.set(9000, 9000, 0, 0, 0); assert.equal(f.fcL, 7200, 'clamp follows the rate');
  f.setRate(0); f.setRate(NaN);
  assert.equal(f.fs, 16000, 'invalid rates ignored');
  assert.equal(warns(S).length, 2);
});

test('tick ≡ process bit for bit for every type (stereo, offsets, chunked sets), process touches only [off, off + n), reset', () => {
  const { F } = load();
  const r = rng(11), n = 600;
  for (const t of TYPES) {
    const a = F.make(t, 48000), b = F.make(t, 48000);
    const L = new Float64Array(n + 20).map(() => 2 * r() - 1), R = L.map(v => 0.7 * v + 0.1);
    const L2 = L.slice(), R2 = R.slice();
    for (let c = 0; c < n; c += 50) {
      const fc = 100 * 2 ** (6 * r()), args = [fc, fc * (0.5 + r()), r(), 0.3 * r(), r()];
      a.set(...args); b.set(...args);
      a.setXY(r(), r()); b.setXY(a.x, a.y);
      a.process(L, R, 10 + c, 50);
      for (let i = 10 + c; i < 60 + c; i++) { b.tick(L2[i], R2[i]); L2[i] = b.yl; R2[i] = b.yr; }
    }
    assert.deepEqual(arr(L), arr(L2), 'L, type ' + t);
    assert.deepEqual(arr(R), arr(R2), 'R, type ' + t);
    assert.equal(a.yl, L[n + 9]); assert.equal(a.yr, R[n + 9]);
    assert.notDeepEqual(arr(L.slice(10, n + 10)), arr(R.slice(10, n + 10)).map(v => (v - 0.1) / 0.7), 'channels independent');
    // outside [off, off + n) untouched
    const X = new Float64Array(64).fill(0.5), Y = X.slice();
    a.process(X, Y, 20, 10);
    for (let i = 0; i < 64; i++) if (i < 20 || i >= 30) { assert.equal(X[i], 0.5); assert.equal(Y[i], 0.5); }
    a.process(X, Y, 5, 0);
    assert.equal(a.yl, X[29], 'n = 0 leaves yl');
    a.reset();
    assert.equal(a.yl, 0); assert.equal(a.yr, 0);
    const Z = new Float64Array(64), Z2 = new Float64Array(64);
    a.process(Z, Z2, 0, 64);
    assert.ok(Z.every(v => v === 0) && Z2.every(v => v === 0), 'reset → silence in, silence out: ' + t);
  }
});

/* ------------------------------------------------------------------ torture and calibration (§15.7) */

test('torture: every type survives 1 s of noise at drive 1, res 1 with random var/cutoff jumps (finite, |y| < 16), also at 192 kHz', () => {
  const { F } = load();
  for (const fs of [48000, 192000]) {
    const B = 64, L = new Float64Array(B), R = new Float64Array(B);
    for (const t of TYPES) {
      const r = rng(100 + t), f = F.make(t, fs);
      let pk = 0;
      const blocks = fs === 48000 ? fs / B : 0.25 * fs / B;
      for (let b = 0; b < blocks; b++) {
        const fc = 8 * Math.pow(22050 / 8, r());
        f.set(fc, fc * (0.5 + r()), 1, 1, r());
        f.setXY(r(), r());
        for (let i = 0; i < B; i++) { L[i] = r() * 2 - 1; R[i] = r() * 2 - 1; }
        f.process(L, R, 0, B);
        for (let i = 0; i < B; i++) {
          assert.ok(Number.isFinite(L[i]) && Number.isFinite(R[i]), `type ${t}: finite`);
          pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
        }
      }
      assert.ok(pk < 16, `type ${t} at ${fs}: |y| < 16 (peak ${pk.toFixed(2)})`);
      f.reset();
      L.fill(0); R.fill(0);
      f.process(L, R, 0, B);
      assert.ok(L.every(v => v === 0) && R.every(v => v === 0), `type ${t}: reset clears the state`);
    }
  }
});

test('after the torture input stops every type rings out — except the self-oscillating settings (MG, MG Dirty, Acid, K35, Comb 2 at res 1)', () => {
  // the torture bound |y| < 16 cannot catch a filter stuck at its output limiter (lim ≤ 12): 1 s of torture, then 2 s of
  // silence at a 1 kHz cutoff; the tail (last 0.25 s) must be quiet unless the setting is a documented self-oscillator
  const { F } = load();
  const fs = 48000, B = 64, L = new Float64Array(B), R = new Float64Array(B);
  const sustains = (t, res) => res === 1 && (t === 99 || t === 100 || t === 102 || t === 104 || t === 107);
  for (const res of [0.8, 1]) {
    for (const t of TYPES) {
      const r = rng(300 + t), f = F.make(t, fs);
      let vr = 0;
      for (let b = 0; b < fs / B; b++) {
        const fc = 8 * Math.pow(22050 / 8, r());
        vr = r();
        f.set(fc, fc * (0.5 + r()), res, 1, vr);
        f.setXY(r(), r());
        for (let i = 0; i < B; i++) { L[i] = 4 * (r() * 2 - 1); R[i] = 4 * (r() * 2 - 1); }
        f.process(L, R, 0, B);
      }
      f.set(1000, 1200, res, 1, vr);
      let early = 0, tail = 0, pk = 0;
      for (let b = 0; b < 2 * fs / B; b++) {
        L.fill(0); R.fill(0);
        f.process(L, R, 0, B);
        for (let i = 0; i < B; i++) {
          assert.ok(Number.isFinite(L[i]) && Number.isFinite(R[i]));
          pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
          const e2 = L[i] * L[i] + R[i] * R[i];
          if (b >= 0.25 * fs / B && b < 0.5 * fs / B) early += e2;
          if (b >= 1.75 * fs / B) tail += e2;
        }
      }
      const rE = Math.sqrt(early / (0.5 * fs)), rT = Math.sqrt(tail / (0.5 * fs));
      if (sustains(t, res)) assert.ok(pk <= 12, `type ${t} res ${res}: self-oscillation bounded (peak ${pk.toFixed(2)})`);
      // quiet, or still decaying (a res-1 SVF at a low cutoff rings for seconds; a filter stuck at its limiter does not decay)
      else assert.ok(rT < 1e-4 || rT < 0.02 * rE, `type ${t} res ${res}: rings out after the input stops (RMS ${rE.toExponential(2)} → ${rT.toExponential(2)})`);
    }
  }
});

test('level calibration (res 0, drive 0): LP / HP / BP passband 1 ± 1 dB for every new type', () => {
  const { F } = load();
  const fs = 96000;
  // [type, var, x, y, kind]; LP measured at fc/16 (Acid: fc/32, its passband edge is 0.26·fc), HP at min(16·fc, 0.4·fs), BP peak at fc
  const cases = [[96, 0, 'lp'], [96, 1, 'hp'], [96, 0.5, 'lp'], [96, 0.5, 'hp'], [99, 0, 'lp'], [99, 1, 'lp'], [100, 0, 'lp'], [101, 0, 'lp'],
    [102, 0, 'lp'], [103, 0, 'lp'], [105, 0, 'lp'], [105, 1, 'hp'], [105, 0.5, 'lp'], [105, 0.5, 'hp'], [106, 0, 'bp'], [107, 0, 'lp'], [107, 1, 'lp']];
  for (const fc of [250, 1000, 3000]) {
    for (const [t, vr, kind] of cases) {
      const h = F.impulse(t, fc, 0, 0, vr, fs, 32768);
      const probe = kind === 'lp' ? fc / (t === 100 ? 32 : 16) : kind === 'hp' ? Math.min(16 * fc, 0.4 * fs) : fc;
      const g = dB(mag(h, probe, fs));
      assert.ok(Math.abs(g) <= 1, `type ${t} var ${vr} ${kind} fc ${fc}: ${g.toFixed(3)} dB at ${probe.toFixed(1)} Hz`);
    }
    // DJ Mixer: LP side / HP side passbands, PZ SVF corners
    const lp = F.impulse(97, 60, 0, 0, 0, fs, 32768), hpp = F.impulse(97, 6000, 0, 0, 0, fs, 32768);
    assert.ok(Math.abs(dB(mag(lp, 10, fs))) < 1 && Math.abs(dB(mag(hpp, 20000, fs))) < 1, 'DJ Mixer passbands');
    for (const [x, y, probe] of [[0, 0, fc / 16], [1, 0, fc], [0, 1, Math.min(16 * fc, 0.4 * fs)]]) {
      assert.ok(Math.abs(dB(mag(F.impulse(103, fc, 0, 0, 0, fs, 32768, x, y), probe, fs))) <= 1, `PZ corner ${x},${y}`);
    }
  }
  // 12 / 24 dB per octave slopes where the recipe fixes them
  const slope = (t, fc, vr = 0) => { const h = F.impulse(t, fc, 0, 0, vr, fs, 65536); return (dB(mag(h, 16 * fc, fs)) - dB(mag(h, 4 * fc, fs))) / 2; };
  assert.ok(Math.abs(slope(107, 500) + 12) < 1.5, 'K35 ≈ −12 dB/oct: ' + slope(107, 500).toFixed(2));
  assert.ok(Math.abs(slope(105, 500) + 12) < 1.5, 'Exp MM LP 12 dB/oct');
  assert.ok(Math.abs(slope(99, 500) + 24) < 2, 'MG Ladder 24 dB/oct: ' + slope(99, 500).toFixed(2));
  assert.ok(Math.abs(slope(101, 500) + 24) < 2, 'EMS 24 dB/oct');
  assert.ok(Math.abs(slope(100, 300) + 24) < 3, 'Acid 24 dB/oct: ' + slope(100, 300).toFixed(2));
});

test('drive law: small-signal input gain 10^(16·√d/20) (families with and without a nonlinearity)', () => {
  const { F } = load();
  const fs = 96000;
  for (const t of [99, 101, 103, 105, 107]) {
    for (const d of [0.25, 1]) {
      const h = F.impulse(t, 1000, 0, d, 0, fs, 16384);
      const g = dB(mag(h, 20, fs));
      assert.ok(Math.abs(g - 16 * Math.sqrt(d)) < 0.2, `type ${t} drive ${d}: ${g.toFixed(3)} dB`);
    }
  }
  // Wsp: the asymmetric bias +0.05·drive acts inside the saturators: even harmonics with drive, silence stays silent
  const h2 = (d) => {
    const f = F.make(96, fs), y = new Float64Array(fs / 2);
    f.set(5000, 5000, 0, d, 0);
    for (let i = 0; i < fs; i++) { const x = 0.3 * Math.sin(2 * Math.PI * 200 * i / fs); f.tick(x, x); if (i >= fs / 2) y[i - fs / 2] = f.yl; }
    return dB(mag(y, 400, fs) / mag(y, 200, fs));
  };
  assert.ok(h2(1) > h2(0) + 20 && h2(1) > -60, `2nd harmonic: drive 0 ${h2(0).toFixed(1)} dB, drive 1 ${h2(1).toFixed(1)} dB`);
  const f = F.make(96, fs);
  f.set(1000, 1000, 0, 1, 0);
  for (let i = 0; i < 2000; i++) f.tick(0, 0);
  assert.equal(f.yl, 0, 'silence in, silence out');
});

test('Wsp: integrator saturation keeps the passband at a −6 dBFS input (≤ 1 dB), compresses a hot one; MORPH LP → Notch → HP', () => {
  const { F } = load();
  const fs = 48000;
  const rmsOut = (fc, a, f0, vr = 0, type = 96) => {
    const f = F.make(type, fs);
    f.set(fc, fc, 0, 0, vr);
    let s = 0, s0 = 0;
    for (let i = 0; i < fs; i++) { const x = a * Math.sin(2 * Math.PI * f0 * i / fs); f.tick(x, x); if (i >= fs / 2) { s += f.yl * f.yl; s0 += x * x; } }
    return dB(Math.sqrt(s / s0));
  };
  for (const fc of [150, 1000, 5000]) assert.ok(Math.abs(rmsOut(fc, 0.5, fc / 10)) < 1, `LP at fc ${fc}: ${rmsOut(fc, 0.5, fc / 10).toFixed(2)} dB`);
  assert.ok(rmsOut(1000, 4, 1000) < rmsOut(1000, 0.05, 1000) - 3, 'a hot signal at fc is compressed');
  const fsI = 96000, n = (vr, f) => dB(mag(F.impulse(96, 1000, 0, 0, vr, fsI, 32768), f, fsI));
  assert.ok(n(0.5, 1000) < -40 && Math.abs(n(0.5, 100)) < 1 && Math.abs(n(0.5, 10000)) < 1, 'MORPH ½ = notch');
  assert.ok(n(0.25, 10000) < -5 && n(0.25, 10000) > -7, 'MORPH ¼: half way LP → notch (HP part 2m)');
});

test('DJ Mixer: flat at the centre (±0.1 dB), crossfade near it, LP on the left and HP on the right of the knob', () => {
  const { F } = load();
  const fs = 48000, cen = Math.sqrt(MIDI0 * 22050);
  const h = F.impulse(97, cen, 0, 0, 0, fs, 4096);
  for (const f of [20, 100, 1000, 10000, 20000]) assert.ok(Math.abs(dB(mag(h, f, fs))) < 0.1, `centre flat at ${f} Hz`);
  const at = c => MIDI0 * (22050 / MIDI0) ** c;
  // c = 0.25: LP at 20·1000^(0.5/0.98); c = 0.75: HP at 20·1000^(0.24/0.49)
  const lp = F.impulse(97, at(0.25), 0, 0, 0, fs, 32768), fl = 20 * 1000 ** (0.5 / 0.98);
  assert.ok(Math.abs(dB(mag(lp, fl, fs)) + 3.01) < 0.2, 'LP −3 dB at its cutoff');
  assert.ok(dB(mag(lp, 8 * fl, fs)) < -30 && Math.abs(dB(mag(lp, fl / 8, fs))) < 0.1, 'LP side');
  const hp = F.impulse(97, at(0.75), 0, 0, 0, fs, 32768), fh = 20 * 1000 ** (0.24 / 0.49);
  assert.ok(Math.abs(dB(mag(hp, fh, fs)) + 3.01) < 0.2, 'HP −3 dB at its cutoff');
  assert.ok(dB(mag(hp, fh / 8, fs)) < -30 && Math.abs(dB(mag(hp, 8 * fh, fs))) < 0.1, 'HP side');
  // 0.495: half the 20 kHz LP blended with the dry signal; 0.505: half the 20 Hz HP
  const x1 = F.impulse(97, at(0.495), 0, 0, 0, fs, 4096), x2 = F.impulse(97, at(0.505), 0, 0, 0, fs, 32768);
  assert.ok(Math.abs(dB(mag(x1, 1000, fs))) < 0.1 && dB(mag(x1, 21000, fs)) < -0.5, 'crossfade to the LP');
  assert.ok(Math.abs(dB(mag(x2, 1000, fs))) < 0.1 && dB(mag(x2, 5, fs)) < -0.5, 'crossfade to the HP');
  // resonance per the SVF law
  const q = F.impulse(97, at(0.25), 0.8, 0, 0, fs, 65536);
  assert.ok(dB(mag(q, fl, fs)) > 6, 'resonant peak');
});

test('DJ Mixer: sweeping or jumping across the centre is click-free (one SVF state, two sides: fade out, reseed, fade in)', () => {
  // the 20 kHz LP state is ≈ x, the wrong steady state for the 20 Hz HP (and vice versa): crossing the centre must not
  // read one side's state as the other's, and the per-chunk weight must not step
  const { F } = load();
  const fs = 96000, CH = 8, at = c => MIDI0 * (22050 / MIDI0) ** c;
  const run = (cOf, chunks, freq) => {
    const f = F.make(97, fs), L = new Float64Array(CH), R = new Float64Array(CH);
    let ph = 0, prev = 0, px = 0, dy = 0, dx = 0;
    for (let k = 0; k < chunks; k++) {
      const fc = at(cOf(k));
      f.set(fc, fc, 0, 0, 0);
      for (let s = 0; s < CH; s++) { L[s] = R[s] = 0.5 * Math.sin(ph); ph += 2 * Math.PI * freq / fs; dx = Math.max(dx, Math.abs(L[s] - px)); px = L[s]; }
      f.process(L, R, 0, CH);
      for (let s = 0; s < CH; s++) { if (k > 400) dy = Math.max(dy, Math.abs(L[s] - prev)); prev = L[s]; assert.ok(Number.isFinite(L[s])); }
    }
    return { dy, dx };
  };
  const ramp = (a, b, ms) => { const n = Math.round(ms / 1000 * fs / CH); return (k) => (k < 600 ? a : a + (b - a) * Math.min(1, (k - 600) / n)); };
  for (const freq of [100, 440]) {
    for (const [a, b, ms] of [[0.45, 0.55, 20], [0.55, 0.45, 20], [0.45, 0.55, 100], [0.55, 0.45, 100], [0.3, 0.7, 100], [0.7, 0.3, 100]]) {
      const { dy, dx } = run(ramp(a, b, ms), 600 + Math.round(ms / 1000 * fs / CH) + 600, freq);
      assert.ok(dy < 1.5 * dx, `${freq} Hz, c ${a} → ${b} over ${ms} ms: max |Δy| ${dy.toFixed(4)} vs the input's ${dx.toFixed(4)}`);
    }
    // an LFO across the centre (±0.06 around it at 5 Hz)
    const lfo = run((k) => 0.5 + 0.06 * Math.sin(2 * Math.PI * 5 * k * CH / fs), 24000, freq);
    assert.ok(lfo.dy < 1.5 * lfo.dx, `${freq} Hz, LFO: max |Δy| ${lfo.dy.toFixed(4)} vs ${lfo.dx.toFixed(4)}`);
  }
  // jumps across the centre (0.49 ↔ 0.52, 0.3 ↔ 0.7): bounded steps, no 8 ms recovery of a wrong state
  for (const [a, b] of [[0.49, 0.52], [0.52, 0.49], [0.3, 0.7], [0.7, 0.3]]) {
    const { dy } = run((k) => (k < 600 ? a : b), 1200, 100);
    assert.ok(dy < 0.03, `jump c ${a} → ${b}: max |Δy| ${dy.toFixed(4)}`);
  }
  // exactly dry at the centre after a crossing, and a static setting is unchanged by the ramps
  const f = F.make(97, fs), L = new Float64Array(CH), R = new Float64Array(CH);
  for (let k = 0; k < 200; k++) { const fc = at(k < 100 ? 0.3 : 0.5); f.set(fc, fc, 0, 0, 0); for (let s = 0; s < CH; s++) L[s] = R[s] = Math.sin(k * CH + s); f.process(L, R, 0, CH); }
  for (let s = 0; s < CH; s++) assert.equal(L[s], Math.sin(199 * CH + s), 'dry at c = 0.5');
});

test('Diffusor: allpass (flat magnitude ±0.1 dB) for every stage count and res; delays scale with fc', () => {
  const { F } = load();
  const fs = 48000;
  for (const vr of [0, 0.3, 1]) {
    for (const res of [0, 0.5, 1]) {
      for (const fc of [30, 300, 3000]) {
        const h = F.impulse(98, fc, res, 0, vr, fs, 1 << 17);
        for (const f of [37, 100, 333, 1000, 4000, 12000, 20000]) {
          const g = dB(mag(h, f, fs));
          assert.ok(Math.abs(g) < 0.1, `vr ${vr} res ${res} fc ${fc} at ${f} Hz: ${g.toFixed(3)} dB`);
        }
      }
    }
  }
  // the group delay at low frequencies grows with the stage count and falls with fc
  const gd = (fc, vr) => { const h = F.impulse(98, fc, 0.5, 0, vr, fs, 1 << 15); let s = 0, e = 0; for (let i = 0; i < h.length; i++) { s += i * h[i] * h[i]; e += h[i] * h[i]; } return s / e; };
  assert.ok(gd(200, 1) > gd(200, 0) && gd(200, 0.5) > gd(800, 0.5));
});

test('Diffusor STAGES changes are click-free: a var sweep / an LFO on var / a jump keep the per-sample step near the signal slope', () => {
  const { F } = load();
  const fs = 96000, CH = 8;
  const run = (fc, varAt, chunks) => {
    const o = F.make(98, fs), L = new Float64Array(CH), R = new Float64Array(CH);
    let prev = 0, sum = 0, n = 0, worst = 0;
    for (let c = 0; c < chunks; c++) {
      o.set(fc, fc, 0.6, 0, varAt(c));
      for (let s = 0; s < CH; s++) { const i = c * CH + s; L[s] = R[s] = 0.5 * Math.sin(2 * Math.PI * 110 * i / fs); }
      o.process(L, R, 0, CH);
      for (let s = 0; s < CH; s++) {
        assert.ok(Number.isFinite(L[s]));
        const d = Math.abs(L[s] - prev); prev = L[s];
        if (c > 1200) { sum += d; n++; worst = Math.max(worst, d); }
      }
    }
    return { mean: sum / n, worst, o };
  };
  for (const fc of [200, 2000]) {
    // a static stage count: the reference slope (a 110 Hz sine at 0.5 through the chain)
    const ref = run(fc, () => 0.5, 6000);
    const sweep = run(fc, (c) => c / 12000, 12000);                             // var 0 → 1 over 1 s: 15 stage changes
    const lfo = run(fc, (c) => 0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * c / 12000), 12000);   // 3 Hz LFO over all stages
    const jump = run(fc, (c) => (c < 3000 ? 0 : c < 6000 ? 1 : c < 9000 ? 0.2 : 0.8), 12000);
    for (const [k, r] of [['sweep', sweep], ['lfo', lfo], ['jump', jump]]) {
      assert.ok(r.worst < 3 * ref.worst, `fc ${fc} ${k}: worst |Δy| ${r.worst.toExponential(2)} vs static ${ref.worst.toExponential(2)}`);
    }
    // after the changes settle the chain runs S stages (the extra ones stay warm until reset) and stays allpass-like
    assert.equal(jump.o.dS, 1 + Math.round(15 * 0.8));
    assert.ok(jump.o.sR >= jump.o.dS && jump.o.sg === jump.o.dS);
    jump.o.reset();
    assert.equal(jump.o.sR, jump.o.dS, 'reset: exactly S stages run again');
  }
  // a stage started mid-stream: its delayed path fades in (no full-scale switch-in once its line fills)
  const o = F.make(98, 48000), L = new Float64Array(8), R = new Float64Array(8);
  o.set(30, 30, 0.9, 0, 0);
  let prev = 0, worst = 0;
  for (let c = 0; c < 6000; c++) {
    if (c === 1000) o.set(30, 30, 0.9, 0, 1 / 15);                                  // S 1 → 2 (a 1.2 k-sample line)
    for (let s = 0; s < 8; s++) L[s] = R[s] = 0.5 * Math.sin(2 * Math.PI * 50 * (c * 8 + s) / 48000);
    o.process(L, R, 0, 8);
    for (let s = 0; s < 8; s++) { if (c > 500) worst = Math.max(worst, Math.abs(L[s] - prev)); prev = L[s]; }
  }
  assert.ok(worst < 0.03, 'worst step ' + worst);                                    // a 50 Hz sine at 0.5 moves ≤ 3.3e-3 per sample
});

test('Diffusor: warm stages above S stop 10 ms after the STAGES glide rests (steady S-stage path again); dropping changes no sample', () => {
  const { F } = load();
  const fs = 48000, CH = 4;
  const drive = (o, varAt, chunks, tick) => {
    const out = new Float64Array(chunks * CH), L = new Float64Array(CH), R = new Float64Array(CH), sR = [];
    for (let c = 0; c < chunks; c++) {
      o.set(400, 400, 0.6, 0, varAt(c));
      for (let s = 0; s < CH; s++) L[s] = R[s] = Math.sin(0.03 * (c * CH + s));
      if (tick) for (let s = 0; s < CH; s++) { o.tick(L[s], R[s]); L[s] = o.yl; }
      else o.process(L, R, 0, CH);
      out.set(L, c * CH);
      sR.push(o.sR);
    }
    return { out, sR };
  };
  // S 16 → 1: the glide takes 15 × 4 ms = 60 ms, then 10 ms at rest, then the 15 warm stages stop
  const varAt = (c) => (c < 1200 ? 1 : 0);
  const a = drive(F.make(98, fs), varAt, 3000, false), b = drive(F.make(98, fs), varAt, 3000, true);
  assert.deepEqual(arr(a.out), arr(b.out), 'tick ≡ process across the drop');
  const restAt = 1200 + Math.ceil(0.06 * fs / CH), dropAt = a.sR.indexOf(1);
  assert.equal(a.sR[1199], 16);
  assert.ok(dropAt > restAt && dropAt <= restAt + Math.ceil(0.01 * fs / CH) + 2, `dropped at chunk ${dropAt} (rest from ≈ ${restAt})`);
  assert.deepEqual(a.sR.slice(0, 3000), b.sR, 'same block boundaries in tick and process');
  // after the drop the output equals a Diffusor that has run S = 1 all along (same input), up to the chain's memory:
  // compare a fresh S 1 object over the last 200 ms (a 1-stage line at 400 Hz is 2.5 ms long)
  const c = drive(F.make(98, fs), () => 0, 3000, false);
  assert.ok(maxDiffA(a.out.subarray(2000 * CH), c.out.subarray(2000 * CH)) < 1e-12, 'S = 1 steady state');
  // an LFO on STAGES never leaves stages running at rest for long: back to S stages within 10 ms of each rest
  const o = F.make(98, fs);
  drive(o, (c) => (c < 4000 ? 0.5 + 0.5 * Math.sin(2 * Math.PI * c / 1200) : 0.2), 6000, false);
  assert.equal(o.sR, o.dS, 'S stages after the LFO stops');
});

test('ladders: MG Ladder, MG Dirty and Acid Ladder self-oscillate at res 1 within ±5 % of fc; EMS does not; MG Dirty has no level jump', () => {
  const { F } = load();
  const fs = 96000;
  for (const [t, fc] of [[99, 500], [99, 2000], [102, 500], [102, 2000], [100, 500], [100, 2000], [100, 6000]]) {
    const { freq, pk } = oscillation(F, t, fc, fs);
    assert.ok(Math.abs(freq / fc - 1) < 0.05, `type ${t} fc ${fc}: oscillates at ${freq.toFixed(1)} Hz`);
    assert.ok(pk > 0.03 && pk < 2, `type ${t}: bounded, audible oscillation (peak ${pk.toFixed(3)})`);
  }
  const ems = oscillation(F, 101, 1000, fs);
  assert.ok(ems.pk < 1e-4, 'EMS (k 3.6 < threshold 5.17) rings out: ' + ems.pk);
  const dirty = oscillation(F, 102, 1000, fs, 0.5), mg = oscillation(F, 99, 1000, fs);
  assert.ok(Math.abs(dB(dirty.pk / mg.pk)) < 3, `MG Dirty's self-oscillation within 3 dB of MG Ladder's (unity-normalised feedback): ${dB(dirty.pk / mg.pk).toFixed(2)} dB`);
  // below the threshold (res 0.9) MG rings out
  const h = F.impulse(99, 500, 0.9, 0, 0, fs, 96000);
  let tail = 0;
  for (let i = 90000; i < 96000; i++) tail = Math.max(tail, Math.abs(h[i]));
  assert.ok(tail < 1e-3, 'res 0.9 decays');
  // resonance raises the peak at fc (Acid: the resonance sits at fc)
  const g = (t, res) => dB(mag(F.impulse(t, 1000, res, 0, 0, fs, 65536), 1000, fs));
  for (const t of [99, 100, 101]) assert.ok(g(t, 0.8) > g(t, 0.4) + 3 && g(t, 0.4) > g(t, 0), `type ${t}: resonance boosts fc`);
});

test('MG Dirty (RULINGS2 D3: "tanh(2·x) in the feedback" unity-normalised, k·tanh(2·y4)/2): the MG Ladder\'s small-signal response and threshold; PAIN drives the input', () => {
  const { F } = load();
  const fs = 96000;
  const tail = (t, res, vr = 0) => {
    const h = F.impulse(t, 1000, res, 0, vr, fs, fs);
    let pk = 0;
    for (let i = 0.9 * fs; i < fs; i++) pk = Math.max(pk, Math.abs(0.01 * h[i]));
    return pk;
  };
  for (const vr of [0, 0.5]) {
    assert.ok(tail(102, 0.55, vr) < 1e-9 && tail(102, 0.9, vr) < 1e-9, 'MG Dirty res 0.55 / 0.9 ring out (var ' + vr + ')');
    assert.ok(tail(102, 1, vr) > 0.03, 'MG Dirty res 1 sustains (var ' + vr + ')');
  }
  assert.ok(tail(99, 0.55) < 1e-9 && tail(99, 0.9) < 1e-9 && tail(99, 1) > 0.03, 'MG Ladder: only res 1');
  // small signals (var 0: no PAIN gain): the MG Ladder's response (the feedback's secant gain tg(2·y) ≈ 1)
  const a = F.impulse(102, 1000, 0.5, 0, 0, fs, 4096), b = F.impulse(99, 1000, 0.5, 0, 0, fs, 4096);
  let d = 0, pk = 0;
  for (let i = 0; i < 4096; i++) { d = Math.max(d, Math.abs(a[i] - b[i])); pk = Math.max(pk, Math.abs(b[i])); }
  assert.ok(d < 1e-6 * pk, 'small-signal response = MG Ladder (' + d + ')');
  // PAIN (var) raises the input gain (1 + 15·var²): a louder impulse response
  const c = F.impulse(102, 1000, 0.5, 0, 1, fs, 4096);
  let pc = 0;
  for (let i = 0; i < 4096; i++) pc = Math.max(pc, Math.abs(c[i]));
  assert.ok(pc > 4 * pk, 'PAIN drives the input');
});

test('SMOOTH (ladder2, PZ SVF): log2 cutoff glides with τ = 0.05·var² inside process, also without further set() calls; var 0 and reset jump', () => {
  const { F } = load();
  const fs = 48000, n = 480;
  for (const t of [99, 100, 101, 103]) {
    const f = F.make(t, fs);
    f.set(200, 200, 0, 0, 1);
    assert.equal(f.ef[0], Math.log2(200), 'first set jumps');
    const L = new Float64Array(n), R = new Float64Array(n);
    f.process(L, R, 0, n);                                                   // 10 ms
    f.set(3200, 3200, 0, 0, 1);                                              // τ = 50 ms: 10 ms move 1 − e^(−0.2) of 4 octaves
    assert.equal(f.ef[0], Math.log2(200), 'set() only takes the target');
    f.process(L, R, 0, n);
    const want = Math.log2(3200) + (Math.log2(200) - Math.log2(3200)) * Math.exp(-n / (fs * 0.05));
    assert.ok(Math.abs(f.ef[0] - want) < 1e-9, `type ${t}: ${f.ef[0]} vs ${want}`);
    // the SFilter way: set() is not called again while the target stays (it skips unchanged values); the glide goes on
    for (let c = 0; c < 200; c++) f.process(L, R, 0, n);
    assert.equal(f.ef[0], Math.log2(3200), 'arrives without further set() calls');
    // a long pause without set() does not turn the next step into a jump
    for (let c = 0; c < 100; c++) f.process(L, R, 0, n);                    // 1 s steady
    f.set(800, 800, 0, 0, 1);
    f.process(L, R, 0, 48);                                                  // 1 ms
    const w1 = Math.log2(800) + (Math.log2(3200) - Math.log2(800)) * Math.exp(-48 / (fs * 0.05));
    assert.ok(Math.abs(f.ef[0] - w1) < 1e-9, 'a step after a pause glides: ' + 2 ** f.ef[0]);
    f.set(800, 800, 0, 0, 0);
    assert.equal(f.ef[0], Math.log2(800), 'var 0: no glide');
    // reset during a glide: snaps to the target at once (no stale glided cutoff on the next note, even without set())
    f.set(100, 100, 0, 0, 1); f.process(L, R, 0, 48);
    assert.ok(f.ef[0] > Math.log2(100) + 1, 'gliding');
    f.reset();
    assert.equal(f.ef[0], Math.log2(100), 'reset snaps the glide');
    f.process(L, R, 0, n);
    assert.equal(f.ef[0], Math.log2(100));
    f.set(6400, 6400, 0, 0, 1);
    assert.equal(f.ef[0], Math.log2(6400), 'reset: the next set jumps');
    // τ scales with var²: var ½ ⇒ τ = 12.5 ms
    const g = F.make(t, fs);
    g.set(200, 200, 0, 0, 0.5); g.set(3200, 3200, 0, 0, 0.5); g.process(L, R, 0, n);
    const w2 = Math.log2(3200) + (Math.log2(200) - Math.log2(3200)) * Math.exp(-n / (fs * 0.0125));
    assert.ok(Math.abs(g.ef[0] - w2) < 1e-9, 'τ = 0.05·var²');
  }
  // the glide steps on a sample grid (gq = round(fs/12000) samples): process and tick give the same samples
  {
    const a = F.make(99, 96000), b = F.make(99, 96000), r = rng(3);
    const X = new Float64Array(1000).map(() => 2 * r() - 1), Y = X.slice(), X2 = X.slice(), Y2 = X.slice();
    a.set(200, 300, 0.5, 0.2, 0.8); b.set(200, 300, 0.5, 0.2, 0.8);
    a.set(4000, 6000, 0.5, 0.2, 0.8); b.set(4000, 6000, 0.5, 0.2, 0.8);
    for (let o = 0; o < 1000; o += 37) a.process(X, Y, o, Math.min(37, 1000 - o));
    for (let i = 0; i < 1000; i++) { b.tick(X2[i], Y2[i]); X2[i] = b.yl; Y2[i] = b.yr; }
    assert.deepEqual(arr(X), arr(X2)); assert.deepEqual(arr(Y), arr(Y2));
    assert.ok(a.ef[0] > Math.log2(200) && a.ef[0] < Math.log2(4000) && a.ef[1] > Math.log2(300), 'still gliding');
  }
  // the glide is audible: a cutoff jump on the smoothed MG Ladder keeps the old response for a while
  const a = F.make(99, fs), b = F.make(99, fs);
  a.set(300, 300, 0, 0, 1); b.set(300, 300, 0, 0, 0);
  a.set(8000, 8000, 0, 0, 1); b.set(8000, 8000, 0, 0, 0);
  const A = new Float64Array(64).fill(1), B = A.slice(), A2 = A.slice(), B2 = A.slice();
  a.process(A, A2, 0, 64); b.process(B, B2, 0, 64);
  assert.ok(A[10] < B[10], 'smoothed step response is slower');
});

test('Comb 2: peaks at k·fc (FRQ2 = fc at var ½), a second comb at fc·2^(4(var − ½)); res 0 is the identity', () => {
  const { F } = load();
  const fs = 48000, fc = 300;
  const h = F.impulse(104, fc, 0.9, 0, 0.5, fs, 1 << 16);
  for (let k = 1; k <= 6; k++) {
    const pk = dB(mag(h, k * fc, fs)), dip = dB(mag(h, (k + 0.5) * fc, fs));
    assert.ok(pk - dip > 20, `peak at ${k}·fc: ${pk.toFixed(1)} vs ${dip.toFixed(1)} dB`);
  }
  const h2 = F.impulse(104, fc, 0.9, 0, 0.75, fs, 1 << 16), f2 = fc * 2;                  // FRQ2 one octave up
  assert.ok(dB(mag(h2, f2, fs)) > dB(mag(h2, 1.5 * fc, fs)) + 20, 'second comb at fc·2');
  // below the 20 Hz floor the FRQ2 ratio stays: fc 10 Hz (comb 1 at 20 Hz), var 1 ⇒ comb 2 at 20·4 = 80 Hz (period 600)
  const h3 = F.impulse(104, 10, 0.9, 0, 1, fs, 4096);
  assert.ok(Math.abs(h3[600]) > 0.1 && arr(h3).slice(1, 600).every(v => v === 0), 'first echo at fs/80: ' + h3[600]);
  const id = F.impulse(104, fc, 0, 0, 0.3, fs, 512);
  assert.equal(id[0], 1);
  assert.ok(arr(id).slice(1).every(v => v === 0), 'res 0: identity');
});

test('cutoff modulation without zipper: Diffusor / Comb 2 delays and the DJ Mixer weight ramp per sample (chunked set() ≈ per-sample set()); Comb 2 ≤ the Phase-1 comb', () => {
  const { F } = load();
  const fs = 96000;
  // a 200 → 2000 Hz cutoff sweep (res 0.5, var 0.5) on a 220 Hz sine at 0.5: max per-sample step after the sweep starts
  const sweep = (make, CH, ms) => {
    const o = make(), L = new Float64Array(CH), R = new Float64Array(CH);
    const pre = 19200, n = Math.round(ms / 1000 * fs), tot = pre + n + 9600;
    let ph = 0, prev = 0, best = 0;
    for (let i0 = 0; i0 < tot; i0 += CH) {
      const u = i0 < pre ? 0 : Math.min(1, (i0 - pre) / n), fc = 200 * 10 ** u;
      o.set(fc, fc, 0.5, 0, 0.5);
      for (let s = 0; s < CH; s++) { L[s] = R[s] = 0.5 * Math.sin(ph); ph += 2 * Math.PI * 220 / fs; }
      o.process(L, R, 0, CH);
      for (let s = 0; s < CH; s++) { if (i0 >= pre) best = Math.max(best, Math.abs(L[s] - prev)); prev = L[s]; assert.ok(Number.isFinite(L[s])); }
    }
    return best;
  };
  for (const t of [98, 104, 97]) {
    for (const ms of [10, 100]) {
      const ideal = sweep(() => F.make(t, fs), 1, ms);                          // set() every sample: a continuous control
      for (const CH of [8, 32]) {
        const got = sweep(() => F.make(t, fs), CH, ms);
        assert.ok(got < 1.25 * ideal, `type ${t}, ${ms} ms sweep, set() every ${CH} samples: max |Δy| ${got.toFixed(4)} vs per-sample ${ideal.toFixed(4)}`);
      }
    }
  }
  // Comb 2 against the Phase-1 comb (cmb_p, tests/ref-p1) on the 10 ms sweep
  const REF = dspScope({ files: ['serum-dsp.js'], overrides: { 'serum-dsp.js': (src) => readRef() } }).global('SerumDSP');
  const tC = core.FILTERS.findIndex(f => f.id === 'cmb_p');
  for (const CH of [8, 32]) {
    const p1 = sweep(() => { const f = new REF.SFilter(fs); f.prealloc(false); f.setType(tC); return f; }, CH, 10);
    const c2 = sweep(() => F.make(104, fs), CH, 10);
    assert.ok(c2 <= p1, `Comb 2 ${c2.toFixed(4)} ≤ Phase-1 comb ${p1.toFixed(4)} (set() every ${CH} samples)`);
  }
});

test('PZ SVF: corners equal LP / BP / HP / Notch; setXY / setPZ drive the bilinear interpolation; the FX path is a low-pass', () => {
  const { F } = load();
  const fs = 48000, fc = 1000, len = 8192;
  const lp = F.impulse(105, fc, 0.3, 0, 0, fs, len), hp = F.impulse(105, fc, 0.3, 0, 1, fs, len);
  const notch = F.impulse(105, fc, 0.3, 0, 0.5, fs, len), bp = F.impulse(106, fc, 0.3, 0, 0, fs, len);
  const eq = (a, b, msg) => assert.ok(Math.max(...arr(a).map((v, i) => Math.abs(v - b[i]))) < 1e-12, msg);
  eq(F.impulse(103, fc, 0.3, 0, 0, fs, len, 0, 0), lp, 'TL = LP');
  eq(F.impulse(103, fc, 0.3, 0, 0, fs, len, 1, 0), bp, 'TR = BP');
  eq(F.impulse(103, fc, 0.3, 0, 0, fs, len, 0, 1), hp, 'BL = HP');
  eq(F.impulse(103, fc, 0.3, 0, 0, fs, len, 1, 1), notch, 'BR = Notch');
  const mid = F.impulse(103, fc, 0.3, 0, 0, fs, len, 0.5, 0.5);
  eq(mid, lp.map((v, i) => 0.25 * (v + bp[i] + hp[i] + notch[i])), 'centre = mean of the corners');
  // custom corners: TL = −HP
  const pz = new Float64Array(12); pz[2] = -1;
  eq(F.impulse(103, fc, 0.3, 0, 0, fs, len, 0, 0, pz), hp.map(v => -v), 'setPZ');
  // a fresh object (FX Filter: no setXY / setPZ) is the TL corner, a low-pass
  const f = F.make(103, fs);
  f.set(fc, fc, 0.3, 0, 0);
  const out = new Float64Array(len);
  for (let i = 0; i < len; i++) { f.tick(i ? 0 : 0.01, 0); out[i] = f.yl / 0.01; }
  eq(out, lp, 'PZ_DEFAULT with X = Y = 0');
  // the XY position is taken per call (chunk), other families ignore it
  eq(F.impulse(105, fc, 0.3, 0, 0, fs, len, 1, 1), lp, 'Exp MM ignores X/Y');
});

/* ------------------------------------------------------------------ memory (§6.13.1, §14.2) */

test('delay lines: Diffusor and Comb 2 sized for the 20 Hz floor, ≤ 1 MiB at 192 kHz, fc below 20 Hz never grows them', () => {
  const { F } = load();
  for (const fs of [44100, 48000, 96000, 192000]) {
    for (const t of TYPES) {
      const f = F.make(t, fs), n = F.need(t, fs);
      if (t === 98 || t === 104) {
        assert.ok(n > 0);
        assert.ok(n * 4 <= 1048576, `type ${t} at ${fs}: ${n * 4} bytes`);
        assert.ok(f.bytes >= n * 4 && f.bytes < n * 4 + 8192);
      } else { assert.equal(n, 0); assert.ok(f.bytes < 4096, `type ${t}: ${f.bytes} bytes`); }
      const b0 = f.bytes;
      const L = new Float64Array(256).map((_, i) => Math.sin(i)), R = L.slice();
      for (const fc of [1, 8, 12, 19.9, 20, 1000]) { f.set(fc, fc, 1, 0.5, 1); f.process(L, R, 0, 256); }
      assert.equal(f.bytes, b0, 'no growth');
      assert.ok(arr(L).every(Number.isFinite));
    }
  }
  assert.ok(F.need(98, 192000) * 4 < 1048576 && F.need(98, 192000) * 4 > 0.9e6, 'Diffusor ≈ 1 MB at 192 kHz: ' + F.need(98, 192000) * 4);
  assert.equal(F.need(104, 192000), 4 * (192000 / 20 + 4));
  // need() counts both channels: Diffusor ≈ 1.32·fs samples (not 0.67·fs)
  for (const fs of [48000, 96000, 192000]) assert.ok(Math.abs(F.need(98, fs) / fs - 1.32) < 0.01, 'need(98) ≈ 1.32·fs at ' + fs);
  // the 384 kHz internal rate (base 192 kHz at OS 2, base 96 kHz at OS 4): a Diffusor keeps its 192 kHz lines (floor
  // 20·fs/192000 = 40 Hz), so both filters of a voice stay ≤ 2 MB; Comb 2 keeps the 20 Hz floor
  for (const fs of [352800, 384000]) {
    assert.equal(F.need(98, fs), F.need(98, 192000), 'Diffusor lines capped at ' + fs);
    const d = F.make(98, fs), c = F.make(104, fs);
    assert.ok(d.bytes <= 1048576 && 2 * d.bytes <= 2 * 1048576, `Diffusor at ${fs}: ${d.bytes} bytes`);
    assert.ok(c.bytes < 320000, `Comb 2 at ${fs}: ${c.bytes} bytes`);
    const L = new Float64Array(512).map((_, i) => Math.sin(i)), R = L.slice();
    for (const fc of [1, 20, 39, 40, 1000]) { d.set(fc, fc, 1, 0.5, 1); d.process(L, R, 0, 512); }
    assert.ok(arr(L).every(Number.isFinite));
  }
  // the raised floor: at 384 kHz a 20 Hz and a 40 Hz Diffusor are the same filter; at 192 kHz they differ
  const same = (fs, a, b) => maxDiffA(F.impulse(98, a, 0.5, 0, 0, fs, 40000), F.impulse(98, b, 0.5, 0, 0, fs, 40000)) === 0;
  assert.ok(same(384000, 20, 40) && !same(384000, 40, 60) && !same(192000, 20, 40));
  assert.ok(F.impulse(98, 300, 0.5, 0, 0, 384000, 8).every(Number.isFinite));
  for (const bad of [[95, 48000], [98, 0], [98, NaN], ['98', 48000]]) assert.equal(F.need(...bad), 0);
  // a Comb 2 tuned below 20 Hz sits at the floor (its period is 1/20 s)
  const h = F.impulse(104, 10, 0.9, 0, 0.5, 48000, 9000);
  assert.ok(Math.abs(h[2400]) > 0.1 && arr(h).slice(1, 2400).every(v => v === 0), 'first echo at fs/20');
});

test('a shared pool: objects use it when large enough (bytes exclude it), output equals an own-buffer object, reset empties the lines', () => {
  const { S, F } = load();
  const fs = 48000, pool = new Float32Array(F.need(98, fs) + 100).fill(0.25);
  const a = F.make(98, fs, pool), b = F.make(98, fs), c = F.make(104, fs, pool);
  assert.ok(a.bytes < 8192 && c.bytes < 8192, 'pool not counted');
  a.reset(); c.reset();                                                      // switching family: the new object is reset (SFilter rule)
  const L = new Float64Array(512).map((_, i) => Math.sin(0.1 * i)), R = L.slice(), L2 = L.slice(), R2 = L.slice();
  a.set(500, 500, 0.6, 0, 0.7); b.set(500, 500, 0.6, 0, 0.7);
  a.process(L, R, 0, 512); b.process(L2, R2, 0, 512);
  assert.deepEqual(arr(L), arr(L2), 'stale pool contents are never read');
  const small = F.make(98, fs, new Float32Array(10));
  assert.ok(small.bytes > F.need(98, fs) * 4, 'too small: own buffer');
  assert.equal(warns(S).length, 1);
  // setRate with a pool that is too small for the new rate falls back to an own buffer
  a.setRate(192000);
  assert.ok(a.bytes > F.need(98, 192000) * 4);
});

/* ------------------------------------------------------------------ allocation-free, impulse (§11.7) */

test('allocation-free: set / setXY / setPZ / tick / process / reset / flush for every type', () => {
  const { S, F } = load();
  const fs = TYPES.map(t => F.make(t, 192000));
  const L = new Float64Array(128).map((_, i) => Math.sin(i)), R = L.slice(), pz = new Float64Array(24).fill(0.5);
  fs[0].setPZ(null);                                                         // warm the warning path
  noAlloc(S, () => {
    for (let b = 0; b < 40; b++) {
      for (const f of fs) {
        f.set(100 + 300 * b, 150 + 200 * b, (b % 10) / 10, (b % 7) / 7, (b % 3) / 3);
        f.setXY((b % 5) / 4, (b % 4) / 3);
        f.setPZ(pz, (b & 1) * 12);
        f.setPZ(null);
        f.process(L, R, 0, 128);
        f.tick(0.1, -0.1);
      }
    }
    for (const f of fs) { f.st[0] = 1e12; f.process(L, R, 0, 16); f.reset(); }  // runaway → reset inside process
  });
  assert.ok(arr(L).every(Number.isFinite));
});

test('runaway or non-finite states reset the object inside process (Phase-1 rule); denormal states are flushed', () => {
  const { F } = load();
  for (const t of TYPES) {
    const f = F.make(t, 48000);
    f.set(1000, 1000, 0.5, 0, 0.5);
    f.st[1] = NaN;
    const L = new Float64Array(32), R = new Float64Array(32);
    f.process(L, R, 0, 32);
    const L2 = new Float64Array(32), R2 = new Float64Array(32);
    f.process(L2, R2, 0, 32);
    assert.ok(L2.every(v => v === 0), 'type ' + t + ' recovered');
    f.st[2] = 1e-35;
    f.process(L2, R2, 0, 1);
    assert.ok(!(Math.abs(f.st[2]) > 0 && Math.abs(f.st[2]) < 1e-30), 'flushed');
  }
  // one non-finite input sample, then a normal signal: every type recovers (Comb 2 keeps its whole state in its lines)
  for (const bad of [NaN, Infinity, -Infinity]) {
    for (const t of TYPES) {
      const f = F.make(t, 96000), L = new Float64Array(8), R = new Float64Array(8);
      f.set(800, 800, 0.7, 0.3, 0.5);
      for (let c = 0; c < 100; c++) { for (let s = 0; s < 8; s++) L[s] = R[s] = Math.sin(c * 8 + s); f.process(L, R, 0, 8); }
      L[3] = bad; R[3] = bad;
      f.process(L, R, 0, 8);
      for (let c = 0; c < 2000; c++) { for (let s = 0; s < 8; s++) L[s] = R[s] = 0.5 * Math.sin(0.05 * (c * 8 + s)); f.process(L, R, 0, 8); }
      assert.ok(L.every(Number.isFinite) && R.every(Number.isFinite), `type ${t} recovers from one ${bad} input sample`);
    }
  }
});

test('impulse: Float64Array(len), the Phase-1 filterImpulse convention, deterministic; type / fs / pz validated', () => {
  const { F } = load();
  for (const t of TYPES) {
    const h = F.impulse(t, 1000, 0.5, 0.2, 0.3, 48000);
    assert.equal(h.constructor.name, 'Float64Array');
    assert.equal(h.length, 4096, 'default len');
    assert.ok(h.every(Number.isFinite));
    assert.deepEqual(arr(h), arr(F.impulse(t, 1000, 0.5, 0.2, 0.3, 48000)));
    // = the left channel of a fresh object's response to 0.01, divided by 0.01
    const f = F.make(t, 48000);
    f.set(1000, 1000, 0.5, 0.2, 0.3);
    for (let i = 0; i < 64; i++) { f.tick(i ? 0 : 0.01, i ? 0 : 0.01); assert.equal(h[i], f.yl / 0.01); }
  }
  assert.equal(F.impulse(103, 500, 0.2, 0, 0, 48000, 64, 0.7, 0.2, new Float64Array(12).fill(0.3)).length, 64);
  assert.equal(F.impulse(103, 500, 0.2, 0, 0, 48000, 10.7).length, 10);
  assert.equal(F.impulse(103, 500, 0.2, 0, 0, 48000, -3).length, 0);
  assert.equal(F.impulse(103, 500, 0.2, 0, 0, 48000, NaN).length, 0);
  for (const t of [95, 108, 100.5, NaN, '100']) assert.throws(() => F.impulse(t, 500, 0, 0, 0, 48000, 16), e => e && e.name === 'RangeError', String(t));
  for (const fs of [0, NaN, -1, Infinity]) assert.throws(() => F.impulse(100, 500, 0, 0, 0, fs, 16), e => e && e.name === 'RangeError', String(fs));
  for (const pz of [new Float64Array(11), 3, 'abc']) assert.throws(() => F.impulse(103, 500, 0, 0, 0, 48000, 16, 0, 0, pz), e => e && e.name === 'TypeError');
});
