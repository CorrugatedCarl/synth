// master-dsp.js (IMPL-M §1.3, §6 G3, §9 O3; lane D): the master meters in a node:vm scope. The script's shape (an IIFE,
// environment-neutral: no worklet globals, the fx-dsp rule), the K-weighting derivation (the published 48 kHz stages carried
// through their analog prototypes: exact at 48 kHz, the other rates within 0.05 dB of it from 20 Hz to 16 kHz; the cookbook
// shelf's miss shown), loudness (EBU Tech 3341's cases synthesised from their published descriptions: 1 kHz stereo at −23 and
// −33 dBFS, the gating bursts −36 / −23 / −36 and −72 / −36 / −23 / −36 / −72 dBFS; momentary / short-term windows) at 44.1 /
// 48 / 96 kHz within ±0.1 LU, true peak (synthesised tones within Tech 3341's +0.2 / −0.4 dB of their analytic peak; the
// under-read above 0.4·fs recorded), correlation, the histogram (over-range blocks, restart), LRA (EBU Tech 3342's four tone
// pairs / steps, ±1 LU), no allocation in push() / summary(out). The readings are frozen at acceptance:
// GOLDEN_FREEZE_M=1 node --max-old-space-size=2048 --test tests/master-dsp.test.mjs writes tests/ref-M/master-meters.json
// (the lead, with tests/master-proc.test.mjs's master-out.json); from then on every reading must equal it exactly.
// Run: node --max-old-space-size=2048 --test tests/master-dsp.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dspScope, noAlloc } from './dsp-scope.mjs';

const SRC = readFileSync(new URL('../master-dsp.js', import.meta.url), 'utf8');
const S = dspScope({ files: ['master-dsp.js'], fast: true, bare: true });
const MD = S.global('MASTERDSP');
const RATES = [44100, 48000, 96000];
const dB = x => 20 * Math.log10(x);
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (±${tol})`);
const READ = {};                                                   // every reading, frozen at acceptance (ref-M)

// a stereo signal fed in 128-frame blocks: segments [[dBFS, seconds, hz = 1000, R = 'same' | 'neg' | 'zero' | 'noise']]
function feed(m, fs, segs, onBlock) {
  const B = 128, L = new Float32Array(B), R = new Float32Array(B);
  let t = 0, r = 0x1234567;
  for (const [db, sec, hz = 1000, mode = 'same'] of segs) {
    const A = Math.pow(10, db / 20), n = Math.round(sec * fs);
    for (let o = 0; o < n; o += B) {
      const k = Math.min(B, n - o);
      for (let i = 0; i < k; i++) {
        const x = A * Math.sin(2 * Math.PI * hz * (t + i) / fs);
        L[i] = x;
        if (mode === 'same') R[i] = x; else if (mode === 'neg') R[i] = -x; else if (mode === 'zero') R[i] = 0;
        else { r ^= r << 13; r ^= r >>> 17; r ^= r << 5; R[i] = A * ((r >>> 0) / 4294967296 * 2 - 1); }
      }
      m.push(L, R, k, 0);
      t += k;
      if (onBlock) onBlock(m, t);
    }
  }
  return m;
}

test('master-dsp.js follows the DSP script rules (one IIFE, environment-neutral: no worklet globals, no eval / Math.random); MASTERDSP frozen; a load failure leaves it null', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const body = code.trim();
  assert.ok(body.startsWith('(function () {') && body.endsWith('})();'), 'one IIFE');
  assert.match(body, /^\(function \(\) \{\s*'use strict';/);
  for (const w of ['sampleRate', 'currentTime', 'currentFrame', 'registerProcessor', 'AudioWorkletProcessor', 'window',
    'document', 'self', 'eval', 'instanceof', 'import', 'export', 'with', 'port']) assert.doesNotMatch(code, new RegExp('\\b' + w + '\\b'), w);
  assert.doesNotMatch(code, /new\s+Function/);
  assert.doesNotMatch(code, /Math\.random/);
  assert.ok(Object.isFrozen(MD));
  assert.deepEqual(Object.keys(MD).sort(), ['K48', 'Meters', 'TruePeak', 'carry', 'kWeight', 'proto']);
  const errs = [];
  const B = dspScope({ files: ['master-dsp.js'], bare: true, overrides: { 'master-dsp.js': s => s.replace(/try \{/, "try { throw new Error('injected');") },
    console: { log() {}, info() {}, debug() {}, warn() {}, error: (...a) => errs.push(a.join(' ')) } });
  assert.equal(B.global('MASTERDSP'), null);
  assert.ok(errs.some(e => e.includes('master-dsp: load failed')));
});

test('K-weighting: the published 48 kHz stages carried through their analog prototypes — exact at 48 kHz (≤ 1e-6, here ≤ 1e-15), pole frequencies 1681.97 / 38.135 Hz derived (nothing fitted), the high-pass numerator kept (+0.043 dB), the cookbook shelf cannot reproduce the published one', (t) => {
  const k = MD.kWeight(48000);
  for (let i = 0; i < 5; i++) {
    assert.ok(Math.abs(k.shelf[i] - MD.K48.shelf[i]) <= 1e-15, 'shelf ' + i);
    assert.ok(Math.abs(k.hp[i] - MD.K48.hp[i]) <= 1e-15, 'hp ' + i);
  }
  near(k.f0[0], 1681.97, 0.01, 'shelf f0'); near(k.f0[1], 38.135, 0.001, 'high-pass f0');
  // the analog high-pass passband gain n2 / d2 = 4 / (1 − a1 + a2): +0.043 dB, part of the −0.691 calibration
  const H = MD.proto(MD.K48.hp);
  assert.deepEqual([H.n[0], H.n[1]], [0, 0]);
  near(dB(H.n[2] / H.d[2]), 0.0433, 0.0005, 'high-pass passband');
  // the cookbook (RBJ) high shelf in S normalised to its pole frequency is (A²S² + (A/Q)S + 1) / (S² + S/Q + 1): its middle
  // numerator term is d1·√n2 — the published shelf's is not (the miss the contract names: a cookbook fit stays off)
  const P = MD.proto(MD.K48.shelf), n = P.n.map(x => x / P.d[0]), d1 = P.d[1] / P.d[0];
  near(P.d[2] / P.d[0], 1, 1e-12, 'normalised: d0 = d2');
  near(n[0], 1, 1e-12, 'unity at DC');
  const miss = n[1] / (d1 * Math.sqrt(n[2]));
  t.diagnostic(`shelf prototype: n1 = ${n[1].toFixed(6)}, d1·√n2 = ${(d1 * Math.sqrt(n[2])).toFixed(6)} (ratio ${miss.toFixed(6)}); high-frequency gain ${dB(n[2]).toFixed(5)} dB, Q ${(1 / d1).toFixed(6)}`);
  assert.ok(Math.abs(miss - 1) > 1e-4, 'the published shelf is not of the cookbook form');
  READ.kw = { f0: k.f0, miss };
});

test('K-weighting at 44.1 / 88.2 / 96 / 192 kHz within 0.05 dB of the 48 kHz response from 20 Hz to 16 kHz (measured, recorded)', (t) => {
  const mag = (c, f, fs) => { // |H(e^jw)| of one biquad [b0, b1, b2, a1, a2]
    const w = 2 * Math.PI * f / fs, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = c[0] + c[1] * c1 + c[2] * c2, ni = -(c[1] * s1 + c[2] * s2), dr = 1 + c[3] * c1 + c[4] * c2, di = -(c[3] * s1 + c[4] * s2);
    return Math.hypot(nr, ni) / Math.hypot(dr, di);
  };
  const resp = (fs, f) => { const k = MD.kWeight(fs); return dB(mag(k.shelf, f, fs) * mag(k.hp, f, fs)); };
  const out = {};
  for (const fs of [44100, 88200, 96000, 192000]) {
    let worst = 0, at = 0;
    for (let f = 20; f <= 16000; f *= 1.02) { const e = Math.abs(resp(fs, f) - resp(48000, f)); if (e > worst) { worst = e; at = f; } }
    out[fs] = +worst.toFixed(4);
    t.diagnostic(`${fs} Hz: largest difference from the 48 kHz response ${worst.toFixed(4)} dB at ${at.toFixed(0)} Hz`);
    assert.ok(worst <= 0.05, fs + ': ' + worst);
  }
  near(resp(48000, 1000), 0.691, 0.01, 'the K-weighting gain at 1 kHz (the −0.691 calibration)');
  READ.kwRates = out;
});

test('G3 loudness (EBU Tech 3341 cases, synthesised): 1 kHz stereo −23 / −33 dBFS → M / S / I −23.0 / −33.0; the gating cases −36 / −23 / −36 and −72 / −36 / −23 / −36 / −72 dBFS → I −23.0; at 44.1 / 48 / 96 kHz, ±0.1 LU', (t) => {
  for (const fs of RATES) {
    const cases = [
      ['1: −23 dBFS 20 s', [[-23, 20]], -23, true],
      ['2: −33 dBFS 20 s', [[-33, 20]], -33, true],
      ['3: −36 / −23 / −36 dBFS (10 / 60 / 10 s)', [[-36, 10], [-23, 60], [-36, 10]], -23, false],
      ['4: −72 / −36 / −23 / −36 / −72 dBFS (10 / 10 / 60 / 10 / 10 s)', [[-72, 10], [-36, 10], [-23, 60], [-36, 10], [-72, 10]], -23, false],
    ];
    for (const [name, segs, want, steady] of cases) {
      const m = feed(new MD.Meters(fs), fs, segs), s = m.summary();
      near(s.i, want, 0.1, `${fs} case ${name}: I`);
      if (steady) { near(s.m, want, 0.1, `${fs} ${name}: M`); near(s.s, want, 0.1, `${fs} ${name}: S`); }
      READ[`loud ${fs} ${name}`] = { m: s.m, s: s.s, i: s.i, lra: s.lra };
      t.diagnostic(`${fs} Hz case ${name}: M ${s.m.toFixed(3)} S ${s.s.toFixed(3)} I ${s.i.toFixed(3)}`);
    }
  }
});

test('momentary 400 ms / short-term 3 s windows from the 100 ms ring: a burst of exactly 0.4 s (3 s) reads its level at the sub-block that ends it; a meter that heard only exact zeros reads −Infinity', () => {
  for (const fs of [44100, 48000]) {
    const m = new MD.Meters(fs);
    feed(m, fs, [[-Infinity, 1]]);
    let s = m.summary();
    assert.equal(s.m, -Infinity); assert.equal(s.s, -Infinity); assert.equal(s.i, -Infinity);
    assert.equal(s.tpMax, -Infinity); assert.equal(s.pkMax, -Infinity); assert.ok(Number.isNaN(s.corr), 'silence: correlation "—"');
    let peakM = -Infinity;
    feed(m, fs, [[-23, 0.4]], mm => { const v = mm.summary().m; if (v > peakM) peakM = v; });
    near(peakM, -23, 0.1, fs + ': momentary of a 0.4 s burst');
    feed(m, fs, [[-Infinity, 3]]);
    let peakS = -Infinity;
    feed(m, fs, [[-23, 3]], mm => { const v = mm.short(); if (v > peakS) peakS = v; });
    near(peakS, -23, 0.1, fs + ': short-term of a 3 s burst');
    feed(m, fs, [[-Infinity, 3.1]]);
    s = m.summary();
    assert.ok(s.s < -150, 'the short-term empties after 3 s of silence (the filters\' tails: ' + s.s + ')');
  }
});

test('G3 true peak: synthesised tones (fs/4 at 0° and 45°; 1 / 5 / 10 / 15 kHz; 0.4·fs at 45° and 90°) at 44.1 / 48 / 96 kHz within +0.2 / −0.4 dB of their analytic peak; never below the sample peak; the under-read at 0.4·fs (0°) and above recorded', (t) => {
  const A = 0.5, want = dB(A), rec = {};
  // the steady tone: the holds restart after its first 50 ms (an abrupt onset's reconstruction does overshoot: not the tone's peak)
  const tone = (fs, f, ph, sec = 0.5) => {
    const m = new MD.Meters(fs), B = 128, L = new Float32Array(B), N0 = Math.ceil(0.05 * fs / B) * B;
    for (let o = 0, N = N0 + Math.round(sec * fs); o < N; o += B) {
      if (o === N0) m.restart();
      for (let i = 0; i < B; i++) L[i] = A * Math.sin(2 * Math.PI * f * (o + i) / fs + ph);
      m.push(L, L, B, 0);
    }
    return m.summary();
  };
  for (const fs of RATES) {
    const list = [['fs/4 0°', fs / 4, 0], ['fs/4 45°', fs / 4, Math.PI / 4], ['1 kHz', 1000, 0], ['5 kHz', 5000, 0], ['10 kHz', 10000, 0],
      ['15 kHz', 15000, 0], ['0.4·fs 45°', 0.4 * fs, Math.PI / 4], ['0.4·fs 90°', 0.4 * fs, Math.PI / 2]];
    for (const [name, f, ph] of list) {
      const s = tone(fs, f, ph), e = s.tpMax - want;
      assert.ok(e <= 0.2 && e >= -0.4, `${fs} ${name}: ${e.toFixed(3)} dB`);
      assert.ok(s.tpMax >= s.pkMax, `${fs} ${name}: TP ≥ sample peak`);
      rec[`${fs} ${name}`] = +e.toFixed(4);
    }
    // recorded, not gated: 0.4·fs at its worst phase (0°: the crest midway between two 4× / 2× points — the oversampling's
    // own limit cos(π·0.4·fs / (L·fs)) at 4×; at 2× the same 36° grid), and 0.45 / 0.49·fs
    for (const [name, f] of [['0.4·fs 0°', 0.4 * fs], ['0.45·fs', 0.45 * fs], ['0.49·fs', 0.49 * fs]]) {
      let lo = Infinity;
      for (let q = 0; q < 16; q++) lo = Math.min(lo, tone(fs, f, 2 * Math.PI * q / 16, 0.05).tpMax - want);
      rec[`${fs} ${name} (worst phase)`] = +lo.toFixed(4);
      if (name === '0.4·fs 0°') near(lo, dB(Math.cos(Math.PI * 0.1)), 0.05, fs + ': 0.4·fs worst phase = the 36° grid\'s own limit');
    }
  }
  t.diagnostic('true-peak error (dB) ' + JSON.stringify(rec));
  READ.tp = rec;
});

test('true peak: the inter-sample overshoot of fs/4 at 45° (+3 dB over the sample peak) is found; noise: TP ≥ sample peak per channel; TruePeak.run = the Meters\' interpolator; 4× / 2× / 1× by rate', () => {
  for (const fs of [48000, 96000, 192000]) {
    const m = new MD.Meters(fs), B = 128, L = new Float32Array(B), R = new Float32Array(B);
    let r = 7;
    const P = new MD.TruePeak(fs), Q = new MD.TruePeak(fs);
    let pl = 0, pr = 0;
    for (let k = 0; k < 200; k++) {
      for (let i = 0; i < B; i++) { r ^= r << 13; r ^= r >>> 17; r ^= r << 5; L[i] = ((r >>> 0) / 4294967296 - 0.5) * 1.6; R[i] = Math.sin(i * 0.3) * 0.4; }
      pl = Math.max(pl, P.run(L, B, 0)); pr = Math.max(pr, Q.run(R, B, 0));
      m.push(L, R, B, 0);
    }
    const s = m.summary();
    assert.equal(P.L, fs <= 48000 ? 4 : fs <= 96000 ? 2 : 1);
    assert.ok(s.tp[0] >= s.pk[0] && s.tp[1] >= s.pk[1]);
    assert.equal(s.tp[0], dB(pl)); assert.equal(s.tp[1], dB(pr));
    if (fs === 192000) { assert.equal(s.tp[0], s.pk[0]); assert.equal(s.tp[1], s.pk[1]); }
  }
  // samples ±0.5, the crest 0.707 between them (after the onset: the first 64 samples)
  const T = new MD.TruePeak(48000), x = Float32Array.from({ length: 400 }, (_, i) => Math.SQRT1_2 * Math.sin(Math.PI / 2 * i + Math.PI / 4));
  T.run(x, 64, 0);
  const tp = T.run(x, 336, 64);
  near(dB(tp), 20 * Math.log10(Math.SQRT1_2), 0.02, 'fs/4 at 45°: the crest between the samples');
  assert.ok(dB(tp) - dB(Math.max(...x.map(Math.abs))) > 2.98, 'the inter-sample overshoot +3 dB');
});

test('correlation: +1 (L = R), −1 (L = −R), NaN (R silent, silence), ≈ 0 (independent noise); unweighted, τ 300 ms', () => {
  const fs = 48000, c = mode => feed(new MD.Meters(fs), fs, [[-20, 2, 440, mode]]).summary().corr;
  near(c('same'), 1, 1e-9, 'L = R'); near(c('neg'), -1, 1e-9, 'L = −R');
  assert.ok(Number.isNaN(c('zero')), 'R silent: —');
  // L a 440 Hz tone, R noise: independent
  assert.ok(Math.abs(c('noise')) < 0.05, 'independent: ' + c('noise'));
  READ.corr = { same: c('same'), neg: c('neg'), noise: c('noise') };
});

test('peaks: the sample / true peaks since the previous summary (gap-free), the holds until restart(); restart() resets the integrated value (the sub-block phase with it) but not M / S; reset() everything', () => {
  const fs = 48000, m = new MD.Meters(fs);
  feed(m, fs, [[-6, 0.5]]);
  let s = m.summary();
  near(s.pk[0], -6, 0.01, 'sample peak'); near(s.pkMax, -6, 0.01, 'hold');
  feed(m, fs, [[-20, 0.5]]);
  s = m.summary();
  near(s.pk[0], -20, 0.01, 'since the previous summary'); near(s.pkMax, -6, 0.01, 'held'); near(s.tpMax, -6, 0.01, 'TP held');
  const I = s.i;
  m.restart();
  s = m.summary();
  assert.equal(s.pkMax, -Infinity); assert.equal(s.tpMax, -Infinity); assert.equal(s.i, -Infinity, 'integrated restarted');
  near(s.s, lufsOfSegs([[-6, 0.5], [-20, 0.5]]), 0.5, 'short-term continues');
  assert.ok(I > -21 && I < -6);
  feed(m, fs, [[-30, 1]]);
  near(m.summary().i, -30, 0.1, 'integrated from the restart only');
  m.reset();
  s = m.summary();
  assert.equal(s.m, -Infinity); assert.equal(s.s, -Infinity); assert.equal(s.i, -Infinity); assert.ok(Number.isNaN(s.corr));
  assert.equal(m.sl1 + m.sl2 + m.hl1 + m.hl2 + m.sr1 + m.sr2 + m.hr1 + m.hr2, 0);
});
// the short-term loudness (3 s window incl. silence before) of 1 kHz segments at 48 kHz, approximately (K gain at 1 kHz)
function lufsOfSegs(segs) {
  let e = 0;
  for (const [db, sec] of segs) e += Math.pow(10, db / 10) * Math.pow(10, 0.0691) * sec;
  return -0.691 + 10 * Math.log10(e / 3);
}

test('histogram: a block above +30 LUFS (R1-6; +10 before) lands in the top bin with its exact energy (the integrated value stays exact); counts are doubles; denormals flushed on silence', () => {
  const fs = 48000, m = feed(new MD.Meters(fs), fs, [[40, 5]]);
  const s = m.summary();
  near(s.i, 40, 0.1, '+40 LUFS'); near(s.m, 40, 0.1, 'M');
  assert.equal(m.hc[9999] > 0, true, 'the top bin');
  assert.ok(m.hc instanceof S.ctx.Float64Array);
  feed(m, fs, [[-Infinity, 2]]);
  let f = m.summary();
  assert.equal(m.sl1 + m.sl2 + m.hl1 + m.hl2 + m.sr1 + m.sr2 + m.hr1 + m.hr2, 0, 'filter states flushed to exact 0');
  near(f.corr, 1, 1e-9, 'the correlation of the decaying averages: the last one (τ 300 ms)');
  // the three 400 ms blocks straddling the end (¾, ½, ¼ loud) count: 47 + 1.5 blocks' energy over 50 blocks
  near(f.i, 40 + 10 * Math.log10(48.5 / 50), 0.02, 'the blocks into the silence; silence itself below the absolute gate');
  feed(m, fs, [[-Infinity, 25]]);
  f = m.summary();
  assert.equal(m.cLL, 0); assert.equal(m.cRR, 0); assert.equal(m.cLR, 0);
  assert.ok(Number.isNaN(f.corr), 'below 1e-20: —');
});

test('O3 LRA (EBU Tech 3342 cases, synthesised): 1 kHz stereo −20 / −30 dBFS → 10 LU; −20 / −15 → 5; −40 / −20 → 20; −50 / −35 / −20 / −35 / −50 → 15 (20 s each), ±1 LU at 44.1 / 48 kHz', (t) => {
  for (const fs of [44100, 48000]) {
    for (const [name, segs, want] of [
      ['1', [[-20, 20], [-30, 20]], 10], ['2', [[-20, 20], [-15, 20]], 5], ['3', [[-40, 20], [-20, 20]], 20],
      ['4', [[-50, 20], [-35, 20], [-20, 20], [-35, 20], [-50, 20]], 15]]) {
      const s = feed(new MD.Meters(fs), fs, segs).summary();
      near(s.lra, want, 1, `${fs} case ${name}: LRA`);
      READ[`lra ${fs} ${name}`] = s.lra;
      t.diagnostic(`${fs} Hz Tech 3342 case ${name}: LRA ${s.lra.toFixed(3)} LU (I ${s.i.toFixed(2)})`);
    }
  }
  const s = feed(new MD.Meters(48000), 48000, [[-20, 2.5]]).summary();
  assert.equal(s.lra, 0, 'no short-term value before 3 s: 0');
});

test('review 1 R1-6: the histograms reach +30 LUFS — LRA and the integrated value\'s relative gate stay exact on hot float mixes (1 kHz stereo −20 / +5 / +15 dBFS → LRA 10 LU; +25 / +11 dBFS → I ≈ +25, the +11 blocks gated out)', () => {
  const fs = 48000, a = feed(new MD.Meters(fs), fs, [[-20, 20], [5, 20], [15, 20]]).summary();
  near(a.lra, 10, 0.2, 'LRA: P10 +5, P95 +15 (the −20 dBFS part below the relative gate)');
  const b = feed(new MD.Meters(fs), fs, [[25, 20], [11, 20]]).summary();
  near(b.i, 25, 0.1, 'I: the relative gate (≈ +12.2 LUFS) above +10 LUFS');
});

test('integrate(on) (review 2 F4): off holds the integrated value and LRA exactly while M / S / the peaks run on; restart() keeps the flag; reset() turns it back on', () => {
  const fs = 48000, m = feed(new MD.Meters(fs), fs, [[-23, 4], [-16, 4]]);
  const I = m.integrated(), R = m.lra();
  m.integrate(false);
  feed(m, fs, [[-30, 3], [-10, 3]]);
  assert.ok(Object.is(m.integrated(), I) && Object.is(m.lra(), R), 'held');
  near(m.short(), -10, 0.1, 'S runs on');
  near(m.summary().tpMax, -10, 0.1, 'the true-peak hold runs on');
  m.restart();
  feed(m, fs, [[-20, 4]]);
  assert.equal(m.integrated(), -Infinity, 'restarted, still off');
  m.integrate(true);
  feed(m, fs, [[-20, 4]]);
  near(m.integrated(), -20, 0.1, 'on again');
  m.reset();
  assert.equal(m.ig, 1);
});

test('lite meter (the A/B match\'s input meter): K-weighting and the ring only — the same short-term as a full meter on the same samples, bit for bit', () => {
  const fs = 48000, a = new MD.Meters(fs), b = new MD.Meters(fs, { lite: true });
  const segs = [[-18, 1.3, 220, 'noise'], [-30, 2.2, 3000, 'neg']];
  feed(a, fs, segs); feed(b, fs, segs);
  assert.equal(a.short(), b.short());
  const s = b.summary();
  assert.equal(s.m, a.summary().m);
  assert.equal(b.hc, null);
});

test('peak3() (review 2 F1, the A/B match\'s headroom): the sample peak of the short-term window (30 sub-blocks) and the sub-block in progress, both channels, full and lite alike; it leaves the window after 3 s; a restart keeps it; reset() clears it', () => {
  const fs = 48000;
  for (const lite of [false, true]) {
    const m = new MD.Meters(fs, { lite });
    assert.equal(m.peak3(), 0);
    feed(m, fs, [[-6, 0.05, 1000, 'zero']]);
    near(m.peak3(), Math.pow(10, -6 / 20), 1e-6, lite + ': the sub-block in progress');
    feed(m, fs, [[-20, 1, 1000, 'noise']]);
    near(m.peak3(), Math.pow(10, -6 / 20), 1e-6, lite + ': still in the window');
    m.restart();
    near(m.peak3(), Math.pow(10, -6 / 20), 1e-6, lite + ': a restart keeps it');
    feed(m, fs, [[-20, 2.95, 1000, 'same']]);
    const p = m.peak3();
    assert.ok(p < Math.pow(10, -6 / 20) && p > Math.pow(10, -20.5 / 20) && p <= Math.fround(Math.pow(10, -20 / 20)), lite + ': the −6 dBFS sub-block left after 3 s: ' + dB(p));
    m.reset();
    assert.equal(m.peak3(), 0);
  }
});

test('no allocation per push() (full and lite, across sub-block ends) or in summary(out); restart() and reset() allocate nothing', () => {
  const fs = 48000, a = new MD.Meters(fs), b = new MD.Meters(fs, { lite: true }), out = a.summary();
  const L = new Float32Array(128).map((_, i) => Math.sin(i / 3)), R = L.map(x => -0.5 * x);
  noAlloc(S, () => {
    for (let k = 0; k < 400; k++) { a.push(L, R, 128, 0); b.push(L, R, 128, 0); if (k % 13 === 0) a.summary(out); }
    a.push(L, R, 40, 88); b.summary(out);
    a.restart(); a.reset(); b.reset();
  });
  assert.ok(Number.isFinite(out.m));
});

test('ref-M: the meters\' readings for the G3 / O3 signals (frozen at acceptance; GOLDEN_FREEZE_M=1 writes them)', (t) => {
  const REF = new URL('./ref-M/', import.meta.url), file = new URL('master-meters.json', REF);
  const got = JSON.parse(JSON.stringify(READ));
  if (process.env.GOLDEN_FREEZE_M === '1') {
    mkdirSync(REF, { recursive: true });
    let commit = '';
    try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' }).trim(); } catch { /* no git */ }
    writeFileSync(file, JSON.stringify({ note: 'Frozen master meter readings (IMPL-M §6 G3, O3): tests/master-dsp.test.mjs\'s synthesised Tech 3341 / 3342 signals through master-dsp.js at the stage M acceptance commit. Never edit: the test compares every reading exactly.', commit, read: got }, null, 1) + '\n');
  }
  if (!existsSync(file)) { t.diagnostic('tests/ref-M/master-meters.json missing: NOT FROZEN YET (the lead freezes at acceptance: GOLDEN_FREEZE_M=1)'); return; }
  const ref = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(got, ref.read);
});
