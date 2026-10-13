// wt.js unit tests (spec §10.3 items 1–12). Run: node --test tests/wt.test.mjs
import './v8-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../wt.js';

const {
  FRAME, MIP_HARM, MIP_LEN, fft, rfft, irfft, dft, toSpectrum, fromSpectrum, buildMips, buildMipFrame, makeEntry, expandTable,
  FACTORY_TABLES, SUB_TABLES, factoryTable, generateTable, NOISES, makeNoise, generateNoise, noiseLevels, noiseEntry,
  frameToNoise, lfoToNoise, bandlimit, resampleCycle, readWav, writeWav, parseClm, clmText, parseTxtOverride, parseSplitSize,
  tableFromWav, tableToWav, tableTo256, tableToSingles, importImage, importSingles, replaceFrame, parseFormula, evalFormula,
  applyFormula, FORMULA_PRESETS, OPS, applyOp, opEnabled, drawTool, DRAW_TOOLS, fftOp, FFT_OPS, frameToPoints, ptsToFrame,
  encodeEmbedded, decodeEmbedded, uuid, mulberry32,
} = W;

const TAU = 2 * Math.PI;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const peak = a => { let p = 0; for (let i = 0; i < a.length; i++) p = Math.max(p, Math.abs(a[i])); return p; };
const db = x => 20 * Math.log10(x);
const sineFrame = (k = 1, ph = 0) => Float32Array.from({ length: FRAME }, (_, i) => Math.sin(TAU * k * i / FRAME + ph));
const randFrame = seed => { const r = mulberry32(seed); return Float32Array.from({ length: FRAME }, () => r() * 2 - 1); };
const corr = (a, b) => {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return ab / Math.sqrt(aa * bb);
};
const tbl = (frames, morph = 0) => ({ name: 'T', frames, morph, factory: 0 });
const seq = R => tbl(Array.from({ length: R }, (_, f) => new Float32Array(FRAME).fill(f / 1000)));
const ids = t => t.frames.map(f => Math.round(f[0] * 1000));
// band-limited random frame (no DC, no Nyquist): exactly representable in editor units
const blRandom = seed => { const r = mulberry32(seed), mag = new Float64Array(1024), ph = new Float64Array(1024); for (let k = 0; k < 1023; k++) { mag[k] = r() / Math.sqrt(k + 1); ph[k] = r(); } return fromSpectrum(mag, ph); };

/* ---------------------------------------------------------------- 1. FFT */

test('1 FFT: round trip < 1e-12 (2048, 4096), cosine at bin 5 → n/2; rfft/irfft; Bluestein', () => {
  for (const n of [2048, 4096]) {
    const r = mulberry32(n), re = Float64Array.from({ length: n }, () => r() - 0.5), im = Float64Array.from({ length: n }, () => r() - 0.5);
    const re0 = re.slice(), im0 = im.slice();
    fft(re, im, false); fft(re, im, true);
    assert.ok(maxDiff(re, re0) < 1e-12 && maxDiff(im, im0) < 1e-12);
    const c = Float64Array.from({ length: n }, (_, i) => Math.cos(TAU * 5 * i / n)), ci = new Float64Array(n);
    fft(c, ci, false);
    close(Math.hypot(c[5], ci[5]), n / 2, 1e-9);
    close(Math.hypot(c[6], ci[6]), 0, 1e-9);
    // real transforms agree with the complex one and invert exactly
    const x = Float64Array.from({ length: n }, () => r() - 0.5), xr = x.slice(), xi = new Float64Array(n);
    fft(xr, xi, false);
    const X = rfft(x);
    assert.equal(X.re.length, n / 2 + 1);
    for (let k = 0; k <= n / 2; k++) { close(X.re[k], xr[k], 1e-9); close(X.im[k], xi[k], 1e-9); }
    assert.ok(maxDiff(irfft(X.re, X.im, n), x) < 1e-12);
  }
  assert.throws(() => fft(new Float64Array(1000), new Float64Array(1000)));
  // arbitrary-length DFT (Bluestein) against a naive DFT
  const n = 37, r = mulberry32(5), re = Float64Array.from({ length: n }, () => r()), im = new Float64Array(n);
  const ref = Array.from({ length: n }, (_, k) => { let a = 0, b = 0; for (let j = 0; j < n; j++) { a += re[j] * Math.cos(TAU * j * k / n); b -= re[j] * Math.sin(TAU * j * k / n); } return [a, b]; });
  const r2 = re.slice();
  dft(r2, im, false);
  for (let k = 0; k < n; k++) { close(r2[k], ref[k][0], 1e-9); close(im[k], ref[k][1], 1e-9); }
  dft(r2, im, true);
  assert.ok(maxDiff(r2, re) < 1e-12);
});

/* ---------------------------------------------------------------- 2. mip-maps */

test('2 buildMips: 11 levels, exact harm/len, band-limited spectra, DC kept, data length frames·len', () => {
  assert.deepEqual([...MIP_HARM], [1023, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1]);
  assert.deepEqual([...MIP_LEN], [2048, 2048, 2048, 1024, 512, 256, 256, 256, 256, 256, 256]);
  MIP_HARM.forEach((h, l) => {
    let p = 1; while (p < h) p *= 2;
    assert.equal(MIP_LEN[l], Math.min(2048, Math.max(256, 8 * p)));
  });
  const noise = randFrame(77), dcFrame = Float32Array.from(noise, v => v + 0.25);
  const levels = buildMips(tbl([dcFrame, noise]));
  assert.equal(levels.length, 11);
  const X = rfft(Float64Array.from(dcFrame));
  levels.forEach((L, l) => {
    assert.equal(L.harm, MIP_HARM[l]);
    assert.equal(L.len, MIP_LEN[l]);
    assert.ok(L.data instanceof Float32Array);
    assert.equal(L.data.length, 2 * L.len);
    const Y = rfft(Float64Array.from(L.data.subarray(0, L.len))), s = L.len / FRAME;
    let mx = 0;
    for (let k = 0; k <= L.harm; k++) mx = Math.max(mx, Math.hypot(X.re[k], X.im[k]) * s);
    for (let k = 0; k <= L.len / 2; k++) {
      const got = Math.hypot(Y.re[k], Y.im[k]);
      if (k > L.harm) assert.ok(got < 1e-6 * Math.max(1, mx) * L.len / 64, `level ${l} bin ${k} leaks ${got}`);
      else {
        const want = Math.hypot(X.re[k], X.im[k]) * s;
        assert.ok(Math.abs(got - want) <= 1e-5 * want + 1e-4, `level ${l} bin ${k}: ${got} vs ${want}`);
      }
    }
    close(Y.re[0] / L.len, X.re[0] / FRAME, 1e-6, `DC level ${l}`);
  });
  const one = buildMipFrame(noise);
  one.forEach((L, l) => { assert.equal(L.data.length, L.len); assert.ok(maxDiff(L.data, levels[l].data.subarray(L.len, 2 * L.len)) < 1e-7); });
});

/* ---------------------------------------------------------------- 3. aliasing design check */

function blackmanHarris(N) {
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) { const a = TAU * i / (N - 1); w[i] = 0.35875 - 0.48829 * Math.cos(a) + 0.14128 * Math.cos(2 * a) - 0.01168 * Math.cos(3 * a); }
  return w;
}
function play(levels, f0, fs, base, N, frame = 0) { // pure JS reference player: level rule §7.4, 4-point Hermite
  const flim = fs - Math.min(20000, 0.45 * base), H = flim / f0;
  let l = 10;
  if (H >= 1) for (let i = 0; i < 11; i++) if (MIP_HARM[i] <= H) { l = i; break; }
  const { len } = levels[l], data = levels[l].data.subarray(frame * len, (frame + 1) * len), out = new Float64Array(N), inc = f0 * len / fs, mask = len - 1;
  let ph = 0;
  for (let n = 0; n < N; n++) {
    const i = Math.floor(ph), f = ph - i;
    const xm = data[(i - 1) & mask], x0 = data[i & mask], x1 = data[(i + 1) & mask], x2 = data[(i + 2) & mask];
    const c1 = 0.5 * (x1 - xm), c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
    out[n] = ((c3 * f + c2) * f + c1) * f + x0;
    ph += inc; if (ph >= len) ph -= len;
  }
  return { out, level: l };
}
function aliasDb(x, f0, fs, base) {
  const N = x.length, w = blackmanHarris(N), re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = x[i] * w[i];
  fft(re, im, false);
  const bin = fs / N, top = Math.min(20000, 0.45 * base), fund = Math.round(f0 / bin);
  let F = 0;
  for (let k = fund - 3; k <= fund + 3; k++) F = Math.max(F, Math.hypot(re[k], im[k]));
  let A = 0;
  for (let k = 1; k * bin < top; k++) {
    const f = k * bin, h = Math.round(f / f0);
    if (Math.abs(f - h * f0) <= 10 * bin || Math.abs(f - (h + 1) * f0) <= 10 * bin || Math.abs(f - (h - 1) * f0) <= 10 * bin) continue;
    A = Math.max(A, Math.hypot(re[k], im[k]));
  }
  return db(A / F);
}

test('3 aliasing: factory:Default through the mip levels ≤ −70 dBc at 48/96 kHz', () => {
  const levels = makeEntry('factory:Default', factoryTable('factory:Default')).levels;
  for (const fs of [48000, 96000]) {
    for (const f0 of [110, 440, 1046.5, 2093, 4186]) {
      const { out } = play(levels, f0, fs, 48000, 65536);
      const a = aliasDb(out, f0, fs, 48000);
      assert.ok(a <= -70, `f0 ${f0} fs ${fs}: alias ${a.toFixed(1)} dBc`);
    }
  }
});

// Dense regression guard (quarter semitones, saw and 12.5 % pulse) over the top of the level-0 range and the step into
// level 1, where the worst case lies. KNOWN GAP (escalated, §7.3/§7.4): level 0 is critically sampled (1023 harmonics in
// 2048 samples), so 4-point Hermite images of its top harmonics fold to just below 20 kHz: −57.8 dBc worst (12.5 %
// pulse, 72 Hz at 96 kHz; 26.7 Hz at 48 kHz; 167 Hz at 192 kHz), not the ≤ −74 dBc design claim of §7.3. The §10.3.3
// points above stay ≤ −70 dBc. A fix needs a spec change (level rule or a longer level 0); this guards the present data.
test('3b aliasing, dense sweep at the level-0 boundary: worst case stays at the measured −57.8 dBc (guard −56 dBc)', () => {
  const saw = makeEntry('d', factoryTable('factory:Default')).levels, pls = makeEntry('b', factoryTable('factory:Basic Shapes')).levels;
  let worst = -Infinity, at = '';
  for (const [base, OS] of [[44100, 1], [48000, 1], [48000, 2], [48000, 4]]) {
    const fs = base * OS, flim = fs - Math.min(20000, 0.45 * base);
    const m0 = Math.max(15, 69 + 12 * Math.log2(flim / 1300 / 440)), m1 = 69 + 12 * Math.log2(flim / 1000 / 440);
    for (let m = Math.ceil(m0 * 4) / 4; m <= m1; m += 0.25) {
      const f0 = 440 * 2 ** ((m - 69) / 12);
      for (const [lv, fr, nm] of [[saw, 0, 'saw'], [pls, 5, 'pulse']]) {
        const a = aliasDb(play(lv, f0, fs, base, 65536, fr).out, f0, fs, base);
        if (a > worst) { worst = a; at = `${nm} ${f0.toFixed(1)} Hz at ${fs} Hz`; }
      }
    }
  }
  assert.ok(worst <= -56, `worst alias ${worst.toFixed(1)} dBc (${at})`);
  assert.ok(worst > -62, 'the sweep reaches the known worst case (' + worst.toFixed(1) + ' dBc)');
});

/* ---------------------------------------------------------------- 4. factory tables */

test('4 factory and sub tables: counts, finite, peak ≤ 1.0001, deterministic, expansion, entries', () => {
  assert.equal(FACTORY_TABLES.length, 27 + 6, 'Phase 1 + §10.5');
  assert.equal(new Set(FACTORY_TABLES.map(t => t.id)).size, 33);
  assert.deepEqual([...SUB_TABLES], ['sub:Sine', 'sub:RoundRect', 'sub:Saw', 'sub:Square', 'sub:Pulse', 'sub:Triangle']);
  const all = FACTORY_TABLES.map(d => [d.id, d.frames, d.morph]).concat(SUB_TABLES.map(id => [id, 1, 0]));
  for (const [id, R, morph] of all) {
    const t = factoryTable(id), g = generateTable(id);
    assert.equal(t.frames.length, R, id);
    assert.equal(t.morph, morph, id);
    assert.equal(t.factory, 1);
    assert.equal(factoryTable(id), t, 'cached');
    t.frames.forEach((f, i) => {
      assert.equal(f.length, FRAME);
      assert.ok(f.every(Number.isFinite), id);
      assert.ok(peak(f) <= 1.0001, `${id} peak ${peak(f)}`);
      assert.ok(peak(f) > 0.5, `${id} frame ${i} nearly silent`);
      assert.deepEqual(g.frames[i], f, `${id} deterministic`);
    });
  }
  assert.equal(factoryTable('factory:Nope'), null);
  // sub shapes start at 0 and fall (inv A7)
  for (const id of SUB_TABLES.filter(i => i !== 'sub:Pulse')) { const f = factoryTable(id).frames[0]; assert.ok(Math.abs(f[0]) < 0.08 && f[40] < f[0] + 0.02, id); }
  const sp = factoryTable('sub:Pulse').frames[0];
  assert.ok(sp[100] < -0.7 && sp[1000] > 0.15 && Math.abs(sp.reduce((a, b) => a + b, 0)) / FRAME < 1e-6, 'sub pulse: 25 % low, DC-free');
  // Default is a falling ramp
  const d = factoryTable('factory:Default').frames[0];
  assert.ok(d[100] > 0.7 && d[1948] < -0.7 && Math.abs(d[1024]) < 1e-6 && d[100] > d[200] && Math.abs(d[2047] + 1) < 1e-6);
  // spectral morph: 256 slots, real frames unchanged at round(k·255/(R−1))
  for (const id of ['factory:Saw to Square', 'factory:Vowels', 'factory:Choir']) {
    const t = factoryTable(id), ex = expandTable(t), R = t.frames.length;
    assert.equal(ex.length, 256 * FRAME);
    for (let k = 0; k < R; k++) { const s = Math.round(k * 255 / (R - 1)); assert.deepEqual(ex.subarray(s * FRAME, (s + 1) * FRAME), t.frames[k]); }
    assert.ok(ex.every(Number.isFinite));
  }
  // crossfade: slot s = lerp at u = s·(R−1)/255
  const t = factoryTable('factory:Basic Shapes'), ex = expandTable(t), R = t.frames.length;
  for (const s of [0, 1, 37, 128, 200, 255]) {
    const u = s * (R - 1) / 255, i0 = Math.floor(u), i1 = Math.ceil(u), f = u - i0;
    const want = Float64Array.from({ length: FRAME }, (_, i) => t.frames[i0][i] * (1 - f) + t.frames[i1][i] * f);
    assert.ok(maxDiff(ex.subarray(s * FRAME, (s + 1) * FRAME), want) < 1e-6, `slot ${s}`);
  }
  // Choir follows the §7.8 recipe literally: 16 frames cycling a e i o u (frame f and f + 5 are the same vowel)
  const ch = factoryTable('factory:Choir').frames;
  for (let f = 0; f + 5 < 16; f++) assert.deepEqual(ch[f], ch[f + 5], `Choir ${f} / ${f + 5}`);
  assert.equal(expandTable(factoryTable('factory:Harmonic Sweep')).length, 256 * FRAME);
  assert.equal(expandTable(factoryTable('factory:Sine')).length, FRAME);
  // entries
  const e0 = makeEntry('factory:Harmonic Sweep', factoryTable('factory:Harmonic Sweep'));
  assert.deepEqual([e0.t, e0.id, e0.v, e0.kind, e0.frames, e0.interp, e0.morph], ['wt', 'factory:Harmonic Sweep', 1, 'wt', 256, 0, 0]);
  const e1 = makeEntry('a', factoryTable('factory:Analog Ramp'));
  assert.deepEqual([e1.frames, e1.interp, e1.morph], [32, 1, 1]);
  const e2 = makeEntry('b', factoryTable('factory:Saw to Square'));
  assert.deepEqual([e2.frames, e2.interp, e2.morph], [256, 1, 2]);
  const e3 = makeEntry('c', factoryTable('factory:Default'));
  assert.deepEqual([e3.frames, e3.interp], [1, 0]);
  const e4 = makeEntry('a', factoryTable('factory:Analog Ramp'));
  e1.levels.forEach((L, l) => { assert.notEqual(L.data.buffer, e4.levels[l].data.buffer); assert.deepEqual(L.data, e4.levels[l].data); assert.equal(L.data.length, e1.frames * L.len); });
});

/* ---------------------------------------------------------------- 5. noises */

function psdBands(x, sr, lo = 100, hi = 10000) { // Welch PSD (Hann, 8192), mean power density per octave band
  const N = 8192, w = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(TAU * i / N)), P = new Float64Array(N / 2 + 1);
  let segs = 0;
  for (let s = 0; s + N <= x.length; s += N / 2, segs++) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s + i] * w[i];
    fft(re, im, false);
    for (let k = 0; k <= N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
  }
  const bands = [];
  for (let f = lo; f * 2 <= hi * 1.0001; f *= 2) {
    let s = 0, c = 0;
    for (let k = Math.ceil(f * N / sr); k < f * 2 * N / sr; k++) { s += P[k] / segs; c++; }
    bands.push({ f, d: 10 * Math.log10(s / c) });
  }
  return bands;
}
function slope(bands) { // least squares dB per octave
  const n = bands.length, xs = bands.map((b, i) => i), ys = bands.map(b => b.d);
  const mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  return sxy / sxx;
}
const rmsOf = x => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

test('5 noises: catalogue, determinism, colours, slopes, loop seams, one-shot tails, levels', () => {
  assert.equal(NOISES.length, 41);
  assert.equal(NOISES[0].id, 'noise:White');
  assert.equal(new Set(NOISES.map(n => n.id)).size, 41);
  for (const n of NOISES) {
    const e = makeNoise(n.id), g = generateNoise(n.id);
    assert.deepEqual([e.t, e.kind, e.v, e.rate, e.root, e.loopStart, e.loopEnd], ['wt', 'noise', 1, 48000, 60, 0, e.len], n.id);
    assert.deepEqual(e.levels[0].L, g.L, n.id + ' deterministic');
    assert.equal(e.ch, n.id === 'noise:Mono White' ? 1 : 2);
    assert.equal(e.ch === 2, e.levels[0].R instanceof Float32Array);
    close(e.len / 48000, n.seconds, 0.001, n.id);
    assert.ok(e.levels.every(L => L.L.every(Number.isFinite)), n.id + ' finite');
    // levels: halved lengths and loop points (rate/2^ℓ)
    e.levels.forEach((L, l) => {
      if (!l) return;
      const P = e.levels[l - 1];
      assert.ok(Math.abs(L.len - P.len / 2) <= 0.5, `${n.id} level ${l} len`);
      assert.ok(Math.abs(L.loopEnd - P.loopEnd / 2) <= 0.5 && Math.abs(L.loopStart - P.loopStart / 2) <= 0.5);
    });
    assert.ok(e.levels.length >= 1 && e.levels.length <= 6);
    const x = e.levels[0].L;
    if (n.cat === 'Colors') for (const c of [e.levels[0].L, e.levels[0].R].filter(Boolean)) close(db(rmsOf(c)), -12, 0.5, n.id + ' rms');
    else close(db(Math.max(peak(e.levels[0].L), e.levels[0].R ? peak(e.levels[0].R) : 0)), -1, 0.01, n.id + ' peak');
    e.levels.forEach((L, l) => { // every level: loops stay seamless (circular decimation), one-shots end in silence
      for (const y of [L.L, L.R].filter(Boolean)) {
        if (!n.oneshot) {
          let d = 0;
          for (let i = 1; i < y.length; i++) d += (y[i] - y[i - 1]) ** 2;
          const rd = Math.sqrt(d / (y.length - 1));
          assert.ok(Math.abs(y[y.length - 1] - y[0]) < 4 * rd + 1e-9, `${n.id} level ${l} loop seam`);
        } else {
          const pk = peak(y), tail = y.subarray(y.length - Math.max(2, 48 >> l)); // the last 1 ms of the source
          assert.ok(peak(tail) <= pk * 1e-3, `${n.id} level ${l} one-shot tail ${db(peak(tail) / pk).toFixed(1)} dB`);
        }
      }
    });
    if (n.id === 'noise:Mains Hum' || n.id === 'noise:LFSR Short') { // steady tonal loops: no swell at the seam
      const B = 960, r0 = rmsOf(x); // 20 ms blocks from just before the seam through the 4096-sample crossfade zone
      for (let b = 0; b <= 4096; b += B) {
        const seg = Float32Array.from({ length: B }, (_, i) => x[(x.length - B / 2 + b + i) % x.length]);
        close(db(rmsOf(seg) / r0), 0, 0.5, `${n.id} seam level`);
      }
    }
    const f = makeNoise(n.id);
    assert.notEqual(f.levels[0].L.buffer, e.levels[0].L.buffer, 'fresh buffers');
  }
  assert.equal(makeNoise('noise:Nope'), null);
  // Velvet tiles the loop with one impulse per cell (no crossfade): no coincident impulses, peak = one impulse
  const vel = makeNoise('noise:Velvet').levels[0].L, vpk = peak(vel);
  let nz = 0;
  for (let i = 0; i < vel.length; i++) if (vel[i] !== 0) { nz++; close(Math.abs(vel[i]), vpk, 1e-6, 'velvet impulse height'); }
  assert.equal(nz, Math.round(vel.length * 2000 / 48000));
  // spectral slopes (PSD per octave band, 100 Hz–10 kHz)
  const sl = id => slope(psdBands(makeNoise(id).levels[0].L, 48000));
  close(sl('noise:White'), 0, 0.5, 'white');
  close(sl('noise:Pink'), -3, 1, 'pink');
  close(sl('noise:Brown'), -6, 1.5, 'brown');
  close(sl('noise:Blue'), 3, 1, 'blue');
  close(sl('noise:Violet'), 6, 1.5, 'violet');
});

test('5b noise levels: half-band decimation rejects aliases, passes the band, frameToNoise is an exact band-limit', () => {
  // the decimation filter: a tone just inside the passband passes, a tone that would alias is rejected
  const len = 131072, tone = f => Float32Array.from({ length: len }, (_, i) => Math.sin(TAU * f * i / 48000));
  const lvl = (x, l) => noiseLevels(x, null, len, 0, len, false)[l];
  const BH = blackmanHarris(8192), BHS = BH.reduce((a, b) => a + b);
  const amp = (x, f, sr) => { // windowed single-frequency DFT at exactly f: the amplitude of a tone there (no scalloping)
    let re = 0, im = 0;
    for (let i = 0; i < 8192; i++) { const a = TAU * f * i / sr, v = x[2048 + i] * BH[i]; re += v * Math.cos(a); im -= v * Math.sin(a); }
    return Math.hypot(re, im) * 2 / BHS;
  };
  // §10.3.5 as measurable with the mandated 63-tap half-band (any half-band is −6 dB at its own Nyquist): level ℓ is
  // flat ±0.1 dB up to 0.40·rate/2^ℓ, and every component that folds below 0.40·rate/2^ℓ is ≤ −80 dB
  // (0.40–0.50·rate/2^ℓ is the transition band). Swept on levels 1–3.
  for (let l = 1; l <= 3; l++) {
    const rIn = 48000 / 2 ** (l - 1), rOut = rIn / 2;
    for (const f of [0.02, 0.05, 0.1, 0.15, 0.18, 0.2]) close(db(amp(lvl(tone(f * rIn), l).L, f * rIn, rOut)), 0, 0.1, `level ${l} passband ${f}`);
    for (const f of [0.3, 0.32, 0.35, 0.38, 0.41, 0.44, 0.47, 0.49]) {
      const alias = rOut - f * rIn, a = db(amp(lvl(tone(f * rIn), l).L, alias, rOut)); // where f·rIn folds to after decimation
      assert.ok(a < -80, `level ${l} tone ${f}·rate: alias ${a.toFixed(1)} dB`);
    }
  }
  // the half-band itself: symmetric, every other tap zero, unity DC gain
  const h = W.HALFBAND;
  assert.equal(h.length, 63);
  close(h.reduce((a, b) => a + b), 1, 1e-12);
  for (let k = 2; k <= 30; k += 2) assert.equal(h[31 + k], 0);
  for (let k = 1; k <= 31; k++) close(h[31 + k], h[31 - k], 0);
  // frameToNoise: exact FFT band-limits, seamless loops
  const saw = factoryTable('factory:Default').frames[0], rec = frameToNoise(saw, 'Saw');
  assert.equal(rec.len, 2048); assert.equal(rec.ch, 1); assert.equal(rec.root, 60);
  close(rec.rate, 2048 * 261.6255653, 1e-3);
  const e = noiseEntry(Object.assign({ id: 'nzuser:x' }, rec));
  assert.equal(e.id, 'nzuser:x');
  assert.equal(e.levels.length, 6);
  const X = rfft(Float64Array.from(saw));
  e.levels.forEach((L, l) => {
    assert.equal(L.len, 2048 >> l); assert.equal(L.loopStart, 0); assert.equal(L.loopEnd, L.len); assert.equal(L.R, null);
    const Y = rfft(Float64Array.from(L.L)), s = L.len / 2048;
    for (let k = 0; k <= L.len / 2; k++) {
      const want = k < L.len / 2 ? Math.hypot(X.re[k], X.im[k]) * s : 0;
      assert.ok(Math.abs(Math.hypot(Y.re[k], Y.im[k]) - want) < 1e-3 * Math.max(1, want), `level ${l} bin ${k}`);
    }
    // seamless loop: the wrap step is no larger than a typical step
    let d = 0;
    for (let i = 1; i < L.len; i++) d = Math.max(d, Math.abs(L.L[i] - L.L[i - 1]));
    assert.ok(Math.abs(L.L[0] - L.L[L.len - 1]) <= d * 1.5);
  });
  // records with ArrayBuffers (wtstore form) and stereo
  const st = noiseEntry({ id: 'nzuser:s', kind: 'noise', rate: 44100, ch: 2, len: 20000, loopStart: 100, loopEnd: 19000, root: 57,
    L: new Float32Array(20000).fill(0.5).buffer, R: new Float32Array(20000).fill(-0.5).buffer });
  assert.deepEqual([st.ch, st.rate, st.root, st.len, st.loopStart, st.loopEnd], [2, 44100, 57, 20000, 100, 19000]);
  assert.ok(st.levels[1].R instanceof Float32Array && st.levels[1].loopStart === 50 && st.levels[1].loopEnd === 9500);
  const lf = lfoToNoise(Float32Array.from({ length: 1025 }, (_, i) => i / 1024));
  assert.equal(lf.len, 2048); assert.equal(lf.kind, 'noise'); assert.equal(lf.loopWhole, 1);
});

test('5c noise levels: whole-length loops circular at any length, one-shots linear, the loop decision for user records', () => {
  const tailDb = L => { const y = L.L, pk = peak(y); return db(peak(y.subarray(y.length - Math.max(2, Math.round(L.len / 1000)))) / pk); };
  // odd-length whole loops stay seamless at every level (no zero-padded dip): 0.5 + 0.4·sin(3 cycles)
  for (const len of [48001, 44101, 9999]) {
    const L = Float32Array.from({ length: len }, (_, i) => 0.5 + 0.4 * Math.sin(TAU * 3 * i / len));
    const e = noiseEntry({ id: 'nzuser:odd', kind: 'noise', rate: 44100, ch: 1, len, loopStart: 0, loopEnd: len, L: L.buffer });
    assert.equal(e.levels.length, 6);
    e.levels.forEach((lv, l) => {
      assert.ok(Math.abs(lv.len - len / 2 ** l) <= 1, `${len} level ${l} len ${lv.len}`);
      assert.deepEqual([lv.loopStart, lv.loopEnd], [0, lv.len]);
      let err = 0;
      for (let i = 0; i < lv.len; i++) err = Math.max(err, Math.abs(lv.L[i] - (0.5 + 0.4 * Math.sin(TAU * 3 * i / lv.len))));
      assert.ok(err < 1e-4, `${len} level ${l}: max error ${err}`);
    });
  }
  // a user one-shot without loop information (decaying hit, ends at −80 dB without a fade) → linear: no wrapped attack
  const r = mulberry32(21), hit = Float32Array.from({ length: 30001 }, (_, i) => (r() * 2 - 1) * Math.pow(10, -4 * i / 30001));
  const rec = { id: 'nzuser:hit', kind: 'noise', rate: 48000, ch: 1, len: hit.length, loopStart: 0, loopEnd: hit.length, L: hit };
  noiseEntry(rec).levels.forEach((lv, l) => assert.ok(tailDb(lv) < -60, `one-shot level ${l} tail ${tailDb(lv).toFixed(1)} dB`));
  const forced = noiseEntry(Object.assign({ loopWhole: 1 }, rec)); // declared a loop: circular, the attack wraps onto the end
  assert.ok(forced.levels.slice(1).some(lv => tailDb(lv) > -40), 'loopWhole: 1 is honoured');
  // a short hit (< 8192 samples) is not a single-cycle loop: no FFT band-limit, level 1 has ⌈len/2⌉ samples and ends silent
  const sh = Float32Array.from({ length: 5001 }, (_, i) => (r() * 2 - 1) * Math.pow(10, -4 * i / 5001));
  const se = noiseEntry({ kind: 'noise', len: sh.length, L: sh });
  assert.equal(se.levels[1].len, 2501);
  se.levels.forEach((lv, l) => assert.ok(tailDb(lv) < -60, `short hit level ${l}`));
  // loopWhole: 0 on a single cycle → linear decimation (lengths (n + 1) >> 1); a smpl sub-range loop → linear too
  const cyc = frameToNoise(Float32Array.from({ length: FRAME }, (_, i) => 0.5 + 0.3 * Math.sin(TAU * i / FRAME)), 'c');
  assert.equal(noiseEntry(Object.assign({}, cyc, { loopWhole: 0 })).levels[1].len, 1024);
  const lin = noiseEntry(Object.assign({}, cyc, { loopWhole: 0 })).levels[1].L, ex = noiseEntry(cyc).levels[1].L;
  close(ex[0], 0.5, 1e-5, 'exact band-limit keeps the loop start');
  close(lin[0], 0.375, 0.01, 'zero-padded edge (linear decimation) when the record says it does not loop');
  // a white-noise loop without loop information is recognised as a loop (both ends carry the same energy)
  const wn = Float32Array.from({ length: 48001 }, () => r() * 2 - 1), we = noiseEntry({ kind: 'noise', len: wn.length, L: wn });
  we.levels.forEach((lv, l) => {
    let d = 0;
    for (let i = 1; i < lv.len; i++) d += (lv.L[i] - lv.L[i - 1]) ** 2;
    assert.ok(Math.abs(lv.L[0] - lv.L[lv.len - 1]) < 4 * Math.sqrt(d / (lv.len - 1)), `white loop level ${l} seam`);
    close(rmsOf(lv.L.subarray(0, 32)) / rmsOf(lv.L), 1, 0.5, `white loop level ${l}: no edge dip`);
  });
});

test('5d non-finite samples never reach the DSP (readWav, makeEntry, noise levels, embedded records)', () => {
  const sig = Float32Array.from({ length: 4 * FRAME }, (_, i) => Math.sin(TAU * i / FRAME));
  const buf = writeWav({ sr: 44100, ch: [sig], bits: 32, float: true }), dv = new DataView(buf), u8 = new Uint8Array(buf);
  let p = 12;
  while (String.fromCharCode(...u8.subarray(p, p + 4)) !== 'data') p += 8 + dv.getUint32(p + 4, true);
  dv.setFloat32(p + 8 + 4 * 100, NaN, true); dv.setFloat32(p + 8 + 4 * 5000, Infinity, true); dv.setFloat32(p + 8 + 4 * 7000, -Infinity, true);
  const w = readWav(buf);
  assert.ok(w.ch[0].every(Number.isFinite));
  assert.deepEqual([w.ch[0][100], w.ch[0][5000], w.ch[0][7000]], [0, 0, 0]);
  close(w.ch[0][101], sig[101], 1e-7);
  // tables and noise records that carry NaN/Inf anyway (stored data, older imports)
  const bad = Float32Array.from(sig.subarray(0, FRAME));
  bad[3] = NaN; bad[900] = -Infinity;
  for (const morph of [0, 1, 2]) {
    const e = makeEntry('user:x', tbl([bad, sineFrame(2)], morph));
    assert.ok(e.levels.every(L => L.data.every(Number.isFinite)), 'morph ' + morph);
  }
  assert.ok(W.buildMipFrame(bad).every(L => L.data.every(Number.isFinite)));
  const nb = Float32Array.from({ length: 20000 }, (_, i) => Math.sin(i / 10));
  nb[5] = NaN; nb[19999] = Infinity;
  for (const lw of [0, 1]) assert.ok(noiseEntry({ kind: 'noise', len: 20000, L: nb, R: nb, ch: 2, loopWhole: lw }).levels.every(L => L.L.every(Number.isFinite) && L.R.every(Number.isFinite)));
  assert.ok(noiseLevels(bad, null, FRAME, 0, FRAME, true).every(L => L.L.every(Number.isFinite)));
  // embedded records (preset / project files): decoded payloads are cleaned
  const enc = encodeEmbedded({ id: 'user:e', kind: 'wt', name: 'e', frames: 1, morph: 0, data: bad.buffer.slice(0) });
  const dec = decodeEmbedded(enc), arr = new Float32Array(dec.data);
  assert.ok(arr.every(Number.isFinite));
  assert.equal(arr[3], 0);
  close(arr[4], bad[4], 0);
});

/* ---------------------------------------------------------------- 6. WAV */

test('6 WAV: round trips (32f exact, 24, 16, 8 bit), stereo, clm, extensible, padding, errors', () => {
  const r = mulberry32(9), n = 1000;
  const L = Float32Array.from({ length: n }, () => r() * 2 - 1), R = Float32Array.from({ length: n }, () => r() * 2 - 1);
  L[0] = 1; L[1] = -1; R[0] = 0.999999;
  const f = readWav(writeWav({ sr: 48000, ch: [L, R], bits: 32, float: true }));
  assert.deepEqual([f.sr, f.bits, f.float, f.ch.length], [48000, 32, true, 2]);
  assert.deepEqual(f.ch[0], L); assert.deepEqual(f.ch[1], R);
  assert.equal(f.clm, null); assert.equal(f.loop, null);
  for (const [bits, tol] of [[24, 2 ** -23], [16, 2 ** -15], [8, 2 ** -7]]) {
    const w = readWav(writeWav({ sr: 44100, ch: [L, R], bits }));
    assert.deepEqual([w.bits, w.float, w.ch.length, w.ch[0].length], [bits, false, 2, n]);
    assert.ok(maxDiff(w.ch[0], L) <= tol && maxDiff(w.ch[1], R) <= tol, `${bits}-bit ${maxDiff(w.ch[0], L)}`);
  }
  const i32 = readWav(writeWav({ sr: 44100, ch: [L], bits: 32 }));
  assert.ok(maxDiff(i32.ch[0], L) <= 2 ** -31 + 1e-9);
  for (let m = 0; m <= 4; m++) {
    const w = readWav(writeWav({ sr: 44100, ch: [L], bits: 32, float: true, clm: { size: 2048, morph: m, factory: 0 } }));
    assert.deepEqual(w.clm, { size: 2048, morph: m, factory: 0 });
  }
  assert.deepEqual(parseClm('<!>2048 01000000 wavetable (www.xferrecords.com)'), { size: 2048, morph: 0, factory: 1 });
  assert.equal(clmText({ size: 2048, morph: 2, factory: 0 }), '<!>2048 20000000 wavetable (www.xferrecords.com)');
  assert.equal(parseClm('garbage'), null);
  // smpl loop
  const lw = readWav(writeWav({ sr: 48000, ch: [L], bits: 16, loop: { start: 10, end: 900 } }));
  assert.deepEqual(lw.loop, { start: 10, end: 900 });

  // hand-built files: WAVE_FORMAT_EXTENSIBLE float with an odd-sized chunk (padded and unpadded), clm chunk
  const build = (chunks, padOdd = true) => {
    const parts = [];
    for (const [id, body] of chunks) {
      const b = new Uint8Array(body);
      const h = new Uint8Array(8);
      for (let i = 0; i < 4; i++) h[i] = id.charCodeAt(i);
      new DataView(h.buffer).setUint32(4, b.length, true);
      parts.push(h, b);
      if (b.length & 1 && padOdd) parts.push(new Uint8Array(1));
    }
    const len = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(12 + len);
    out.set([82, 73, 70, 70]); new DataView(out.buffer).setUint32(4, 4 + len, true); out.set([87, 65, 86, 69], 8);
    let o = 12;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out.buffer;
  };
  const fmtExt = new ArrayBuffer(40), dv = new DataView(fmtExt);
  dv.setUint16(0, 0xFFFE, true); dv.setUint16(2, 1, true); dv.setUint32(4, 44100, true); dv.setUint32(8, 44100 * 4, true);
  dv.setUint16(12, 4, true); dv.setUint16(14, 32, true); dv.setUint16(16, 22, true); dv.setUint16(18, 32, true); dv.setUint32(20, 4, true);
  dv.setUint16(24, 3, true); // KSDATAFORMAT_SUBTYPE_IEEE_FLOAT (first 2 bytes)
  const data = new Float32Array([0.5, -0.25, 0.125]);
  const clmBytes = Array.from('<!>2048 01000000 wavetable (www.xferrecords.com)', c => c.charCodeAt(0));
  for (const pad of [true, false]) {
    const buf = build([['fmt ', fmtExt], ['junk', new Uint8Array(3)], ['clm ', clmBytes], ['data', data.buffer]], pad);
    const w = readWav(buf);
    assert.deepEqual([w.sr, w.float, w.ch.length], [44100, true, 1]);
    assert.deepEqual(Array.from(w.ch[0]), [0.5, -0.25, 0.125]);
    assert.deepEqual(w.clm, { size: 2048, morph: 0, factory: 1 });
  }
  const fmtBad = new ArrayBuffer(16), d2 = new DataView(fmtBad);
  d2.setUint16(0, 2, true); d2.setUint16(2, 1, true); d2.setUint32(4, 44100, true); d2.setUint16(12, 2, true); d2.setUint16(14, 16, true);
  assert.throws(() => readWav(build([['fmt ', fmtBad], ['data', new Uint8Array(4)]])), /Unsupported WAV format/);
  assert.throws(() => readWav(new ArrayBuffer(100)), /Not a WAV file/);
  assert.throws(() => readWav(new TextEncoder().encode('hello world, not a wave').buffer), /Not a WAV file/);
  // .txt override, split size
  assert.deepEqual(parseTxtOverride('[1024]\n[no interp]'), { size: 1024, interp: 0 });
  assert.deepEqual(parseTxtOverride('600\r\n'), { size: 600, interp: 1 });
  assert.equal(parseTxtOverride('10'), null);
  assert.equal(parseTxtOverride(''), null);
});

/* ---------------------------------------------------------------- 7. formula */

test('7 formula: §8.2.4 cases, errors, applyFormula behaviour', () => {
  const ev = s => evalFormula(s, {});
  const cases = [['1+2*3', 7], ['2^3^2', 512], ['-2^2', -4], ['(1||0)&&0', 0], ['1||0&&0', 0], ['1<2==1', 1], ['5%3', 2], ['-5%3', -2],
    ['0?1:0?2:3', 3], ['min(3,1,2)', 1], ['avg(1,2,3)', 2], ['sum(1)', 1], ['log(100)', 2], ['ln(e)', 1], ['rint(2.5)', 2], ['rint(3.5)', 4],
    ['sign(-3)', -1], ['!0', 1], ['1/0', 0], ['SIN(PI/2)', 1], ['max(1, 2) + Abs(-3)', 5], ['x = 0.5', 0.5], ['2e2', 200], ['.5+.5', 1]];
  for (const [s, v] of cases) close(ev(s), v, 1e-12, s);
  for (const s of ['sum()', 'foo(1)', '(1+2', 'constructor', '__proto__', 'prototype', '', '   ', '1 2', '1)', 'sin(1,2)', '1 & 2', 'pi = 3']) {
    const p = parseFormula(s);
    assert.equal(p.ok, false, s);
    assert.equal(typeof p.msg, 'string');
    assert.ok(Number.isInteger(p.pos), s);
  }
  assert.equal(parseFormula('(1+2').pos, 4);
  assert.equal(parseFormula('').pos, 0);
  assert.throws(() => evalFormula('foo', {}));
  close(evalFormula('x*2+in', { x: 0.25, in: 1 }), 1.5, 1e-12);
  const p = parseFormula('z=(q>1)?in:0');
  assert.ok(p.ok && p.multi && p.usesQ);
  assert.ok(parseFormula('sin(pi*x)').ok && !parseFormula('sin(pi*x)').multi);
  assert.ok(parseFormula('q<y*255+2').multi);
  assert.deepEqual([...parseFormula('in*w').uses].sort(), ['in', 'w']);

  const def = factoryTable('factory:Default');
  const sine = applyFormula(def, { src: 'sin(pi*x)', cur: 0 });
  assert.ok(!sine.error);
  assert.equal(sine.table.frames.length, 1);
  // sin(π·x) with x = 2i/2048 − 1 is a full cycle (phase-shifted by π)
  assert.ok(Math.abs(corr(sine.table.frames[0], sineFrame(1, Math.PI))) > 0.9999);
  const saw = applyFormula(def, { src: '(1/q)^0.5', cur: 0 }).table.frames[0];
  assert.ok(peak(saw) <= 1.0001);
  assert.ok(corr(saw, def.frames[0]) > 0.999, 'spectral saw');
  const q16 = applyFormula(def, { src: 'q<17', cur: 0 }).table.frames[0], S = toSpectrum(q16);
  for (let k = 1; k <= 1023; k++) assert.equal(S.mag[k - 1] > 1e-4, k <= 16, `harmonic ${k}`);
  // bins that were empty (rounding noise only) get sine phase, whatever that noise was
  for (const src of [factoryTable('factory:Sine'), tbl([new Float32Array(FRAME)])]) {
    const Sq = toSpectrum(applyFormula(src, { src: 'q<17', cur: 0 }).table.frames[0]);
    for (let k = 1; k <= 16; k++) close(Sq.ph[k - 1], 0.5, 1e-6, `q<17 phase of harmonic ${k}`);
  }
  // pathological input is an error result, never a stack overflow (fieldInfo parses on every keystroke)
  for (const [src, msg] of [['('.repeat(600) + 'x' + ')'.repeat(600), /nested/], ['-'.repeat(5000) + '1', /nested/],
    [Array(3000).fill('x').join('+'), /long/], ['sin('.repeat(300) + 'x' + ')'.repeat(300), /nested/], ['0?1:'.repeat(5000) + '0', /nested/]]) {
    const P = parseFormula(src);
    assert.equal(P.ok, false);
    assert.match(P.msg, msg);
    const out = applyFormula(def, { src, cur: 0 });
    assert.ok(out.error && out.table === def);
  }
  assert.ok(parseFormula('('.repeat(60) + 'x' + ')'.repeat(60)).ok);
  close(evalFormula(Array(500).fill('1').join('+'), {}), 500, 0);
  const multi = applyFormula(def, { src: 'sin(pi*x*(1+6*y))', cur: 0 });
  assert.equal(multi.table.frames.length, 256);
  assert.equal(multi.table.morph, 0);
  assert.ok(Math.abs(corr(multi.table.frames[0], sineFrame(1, Math.PI))) > 0.9999);
  const mq = applyFormula(def, { src: 'q<y*255+2', cur: 0 }).table;
  assert.equal(mq.frames.length, 256);
  assert.ok(mq.frames.every(f => peak(f) <= 1.0001));
  // errors leave the table untouched
  const bad = applyFormula(def, { src: 'sin(', cur: 0 });
  assert.ok(bad.error);
  assert.equal(bad.table, def);
  // in / sel / rand semantics
  const three = tbl([sineFrame(1), sineFrame(2), sineFrame(3)]);
  const neg = applyFormula(three, { src: '-in', cur: 1 }).table;
  assert.ok(maxDiff(neg.frames[1], sineFrame(2).map(v => -v)) < 1e-6);
  assert.equal(neg.frames[0], three.frames[0]);
  const selT = applyFormula(three, { src: 'sel', cur: 1, sel: 2 }).table;
  assert.ok(maxDiff(selT.frames[1], sineFrame(3)) < 1e-6);
  const rr = applyFormula(three, { src: 'rand*0.5', cur: 0, seed: 7 }).table, rr2 = applyFormula(three, { src: 'rand*0.5', cur: 0, seed: 7 }).table;
  assert.deepEqual(rr.frames[0], rr2.frames[0]);
  const rm = applyFormula(three, { src: 'rand+0*y', seed: 3 }).table, rn = applyFormula(three, { src: 'rrnd+0*y', seed: 3 }).table;
  assert.deepEqual(rm.frames[0], rm.frames[200], 'rand identical per frame');
  assert.notDeepEqual(rn.frames[0], rn.frames[200], 'rrnd reseeded per frame');
  // every preset parses and applies
  for (const pr of [...FORMULA_PRESETS.singles, ...FORMULA_PRESETS.multis]) {
    const P = parseFormula(pr.src);
    assert.ok(P.ok, pr.name);
    const out = applyFormula(def, { src: pr.src, cur: 0 });
    assert.ok(!out.error && out.table.frames.every(f => f.every(Number.isFinite)), pr.name);
    assert.equal(out.table.frames.length, P.multi ? 256 : 1, pr.name);
  }
  assert.equal(FORMULA_PRESETS.singles.length, 12);
  assert.equal(FORMULA_PRESETS.multis.length, 6);
});

/* ---------------------------------------------------------------- 8. editor operations */

test('8b ops: spectral rebuilds never raise the table peak above max(1, previous peak)', () => {
  const ids = ['all.setSpectra', 'all.setPhases', 'all.blurBinsSpectra', 'all.blurBinsPhases', 'all.blurFramesSpectra', 'all.blurFramesPhases',
    'all.removeLowPhases', 'all.spectraFromOther', 'all.phasesFromOther', 'morph.spectralZeroAll'];
  const tp = t => Math.max(...t.frames.map(peak));
  const loud = t => tbl(t.frames.map(f => Float32Array.from(f, v => 2 * v)), t.morph);
  for (const id of ['factory:Basic Shapes', 'factory:PWM Sweep', 'factory:Sync Sweep']) {
    const t = factoryTable(id), other = factoryTable('factory:Default');
    for (const op of ids) {
      const r = applyOp(t, op, { cur: 3, grid: 4, other });
      assert.ok(tp(r) <= 1 + 1e-6, `${id} ${op}: peak ${db(tp(r)).toFixed(1)} dBFS`);
      const r2 = applyOp(loud(t), op, { cur: 3, grid: 4, other });
      assert.ok(tp(r2) <= 2 + 1e-6, `${id} ${op}: a louder table keeps its own peak`);
    }
  }
  // the guard only scales (one factor for all frames): zero-all-phases keeps cosine phases and relative levels
  const z = applyOp(factoryTable('factory:Basic Shapes'), 'morph.spectralZeroAll', {});
  assert.equal(z.morph, 4);
  const Sz = toSpectrum(z.frames[2]), Sx = toSpectrum(factoryTable('factory:Basic Shapes').frames[2]);
  close(Sz.ph[0], 0.75, 1e-6);
  close(Sz.mag[4] / Sz.mag[0], Sx.mag[4] / Sx.mag[0], 1e-6);
});

test('8 ops: every OPS id on 1-, 7- and 256-frame tables; specific semantics', () => {
  const ids8 = Object.keys(OPS);
  assert.ok(ids8.length >= 60);
  const r = mulberry32(1);
  const mkT = R => tbl(Array.from({ length: R }, (_, f) => Float32Array.from({ length: FRAME }, (v, i) => 0.6 * Math.sin(TAU * (1 + (f % 5)) * i / FRAME) + 0.2 * (r() - 0.5) + 0.05)));
  const other = mkT(5);
  for (const R of [1, 7, 256]) {
    const t = mkT(R);
    for (const id of ids8) {
      const ctx = { cur: Math.min(3, R - 1), sel: [0, Math.min(2, R - 1)], to: R, grid: 8, other, seed: 5, n: 2 };
      const out = applyOp(t, id, ctx);
      assert.ok(out && Array.isArray(out.frames) && out.frames.length >= 1 && out.frames.length <= 256, `${id} on ${R}`);
      assert.ok(out.frames.every(f => f.length === FRAME && f.every(Number.isFinite)), `${id} on ${R}: finite`);
      assert.equal(out.factory, 0);
      assert.ok(OPS[id].label && (OPS[id].menu || id === 'add.move' || id === 'add.paste'));
      assert.equal(typeof opEnabled(t, id, ctx), 'boolean');
    }
    assert.equal(t.frames.length, R, 'input untouched');
  }
  assert.throws(() => applyOp(mkT(1), 'nope', {}));
  const t1 = mkT(1);
  close(peak(applyOp(t1, 'single.normalize', { cur: 0 }).frames[0]), 1, 1e-6);
  const dc = applyOp(t1, 'single.removeDC', { cur: 0 }).frames[0];
  assert.ok(Math.abs(dc.reduce((a, b) => a + b, 0) / FRAME) < 1e-7);
  const fh = applyOp(applyOp(t1, 'single.flipH', { cur: 0 }), 'single.flipH', { cur: 0 });
  assert.deepEqual(fh.frames[0], t1.frames[0]);
  const silent = tbl([new Float32Array(FRAME)]);
  assert.deepEqual(applyOp(silent, 'single.normalize', { cur: 0 }).frames[0], silent.frames[0]);
  assert.deepEqual(ids(applyOp(seq(7), 'add.reduce', { n: 2 })), [0, 2, 4, 6]);
  const rev = applyOp(applyOp(seq(7), 'sort.reverse', {}), 'sort.reverse', {});
  assert.deepEqual(ids(rev), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(applyOp(seq(200), 'all.half', {}).frames.length, 256);
  assert.equal(applyOp(seq(7), 'all.double', {}).frames.length, 4);
  // morph crossfade on 2 frames: slot 128 = lerp(A, B, 128/255)
  const A = sineFrame(1), B = sineFrame(3), m = applyOp(tbl([A, B]), 'morph.crossfade', {});
  assert.equal(m.morph, 1);
  const ex = expandTable(m), want = Float64Array.from({ length: FRAME }, (_, i) => A[i] + (B[i] - A[i]) * 128 / 255);
  assert.ok(maxDiff(ex.subarray(128 * FRAME, 129 * FRAME), want) < 1e-6);
  assert.equal(applyOp(tbl([A]), 'morph.crossfade', {}).morph, 0, 'needs R > 1');
  assert.equal(applyOp(m, 'morph.remove', {}).morph, 0);
  // add.move
  const mv = to => ids(applyOp(seq(7), 'add.move', { sel: [1, 2], to }));
  assert.deepEqual(mv(5), [0, 3, 4, 1, 2, 5, 6]);
  assert.deepEqual(mv(0), [1, 2, 0, 3, 4, 5, 6]);
  for (const to of [1, 2, 3]) assert.deepEqual(mv(to), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(mv(7), [0, 3, 4, 5, 6, 1, 2]);
  // nudge fundamental to sine phase
  const nf = applyOp(tbl([sineFrame(1, 1.1), sineFrame(1, -2), randFrame(3)]), 'all.nudgeFund', {});
  for (const f of nf.frames) close(toSpectrum(f).ph[0], 0.5, 1e-6);
  const z3 = applyOp(tbl([sineFrame(1, 1.1), sineFrame(2, 0.3)]), 'morph.spectralZeroFund', {});
  assert.equal(z3.morph, 3);
  close(toSpectrum(z3.frames[0]).ph[0], 0.5, 1e-6);
  const z4 = applyOp(tbl([sineFrame(1, 1.1), sineFrame(2, 0.3)]), 'morph.spectralZeroAll', {});
  assert.equal(z4.morph, 4);
  close(toSpectrum(z4.frames[1]).ph[1], 0.75, 1e-6);
  // add/remove family
  assert.deepEqual(ids(applyOp(seq(7), 'add.insert', { cur: 2 })), [0, 1, 2, 2, 3, 4, 5, 6]);
  assert.deepEqual(ids(applyOp(seq(7), 'add.remove', { cur: 2 })), [0, 1, 3, 4, 5, 6]);
  assert.deepEqual(ids(applyOp(seq(1), 'add.remove', { cur: 0 })), [0]);
  assert.deepEqual(ids(applyOp(seq(7), 'add.removeSel', { sel: [2, 4] })), [0, 1, 5, 6]);
  assert.deepEqual(ids(applyOp(seq(7), 'add.removeSel', { sel: [0, 6] })), [0]);
  assert.deepEqual(ids(applyOp(seq(7), 'add.removeToSel', { sel: [2, 4] })), [2, 3, 4, 5, 6]);
  assert.deepEqual(ids(applyOp(seq(7), 'add.removeFromSel', { sel: [2, 4] })), [0, 1, 2, 3, 4]);
  assert.deepEqual(ids(applyOp(seq(7), 'add.removeOthers', { sel: [2, 4] })), [2, 3, 4]);
  assert.equal(applyOp(seq(256), 'add.insert', { cur: 0 }).frames.length, 256);
  assert.equal(applyOp(seq(3), 'add.initAll', {}).frames.length, 1);
  // sorts: stable, ascending
  const sp = tbl([sineFrame(5), sineFrame(2), sineFrame(9), sineFrame(2).map(v => v * 0.5)]);
  assert.deepEqual(applyOp(sp, 'sort.peakSpect', {}).frames.map(f => toSpectrum(f).mag.indexOf(Math.max(...toSpectrum(f).mag))), [1, 1, 4, 8]);
  const rnd1 = ids(applyOp(seq(20), 'sort.random', { seed: 11 })), rnd2 = ids(applyOp(seq(20), 'sort.random', { seed: 11 }));
  assert.deepEqual(rnd1, rnd2);
  assert.deepEqual(rnd1.slice().sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i));
  // spectra from / to other
  const o2 = tbl([sineFrame(4)]);
  const sfo = applyOp(tbl([sineFrame(1), sineFrame(2)]), 'all.spectraFromOther', { other: o2 });
  for (const f of sfo.frames) close(toSpectrum(f).mag[3], 1, 1e-6);
  const sub = applyOp(tbl([sineFrame(4)]), 'all.subtractOther', { other: o2 });
  assert.ok(peak(sub.frames[0]) < 1e-5);
  assert.equal(opEnabled(sp, 'all.subtractOther', {}), false);
  // single-frame processes
  const g8 = applyOp(tbl([sineFrame(1)]), 'single.fadeEdges', { cur: 0, grid: 8 }).frames[0];
  assert.equal(g8[0], 0); assert.ok(Math.abs(g8[2047]) < 1e-3);
  const xf = applyOp(tbl([Float32Array.from({ length: FRAME }, (_, i) => i / FRAME)]), 'single.xfadeEdges', { cur: 0, grid: 8 }).frames[0];
  close(xf[2047], 0, 1e-6);
  const flt = applyOp(tbl([factoryTable('factory:Default').frames[0]]), 'single.filter', { cur: 0, grid: 4 }).frames[0], FS = toSpectrum(flt);
  assert.ok(FS.mag[3] > 0.1 && FS.mag[4] < 1e-4);
  const rd = applyOp(tbl([Float32Array.from({ length: FRAME }, (_, i) => i / FRAME)]), 'single.redux', { cur: 0, grid: 1 }).frames[0];
  assert.equal(new Set(rd).size, 16);
  assert.equal(rd[127], 0); assert.equal(rd[128], 128 / FRAME);
  const sz = applyOp(tbl([sineFrame(1, 2)]), 'single.shiftZero', { cur: 0 }).frames[0];
  assert.ok(sz[0] >= 0 && sz[2047] < 0);
  const hf = applyOp(tbl([sineFrame(1)]), 'all.removeFund', {}).frames[0];
  assert.ok(peak(hf) < 1e-5);
  const pwm = applyOp(factoryTable('factory:Square'), 'all.pwm', { cur: 0 });
  assert.equal(pwm.frames.length, 256);
  assert.ok(pwm.frames.every(f => f.every(Number.isFinite)));
  const duty = f => f.filter(v => v > 0.5).length / FRAME;
  close(duty(pwm.frames[0]), 0.5, 0.02); close(duty(pwm.frames[128]), 0.25, 0.03); assert.ok(duty(pwm.frames[255]) < 0.01);
  for (let f = 8; f < 256; f += 8) assert.ok(duty(pwm.frames[f]) <= duty(pwm.frames[f - 8]) + 1e-3, 'PWM duty falls with w');
  const ss = applyOp(tbl([sineFrame(1), sineFrame(3)]), 'all.setSpectra', { cur: 1 });
  close(toSpectrum(ss.frames[0]).mag[2], 1, 1e-6);
});

/* ---------------------------------------------------------------- 9. spectrum */

test('9 spectrum: editor units, exact inverse', () => {
  const sq = factoryTable('factory:Square').frames[0], S = toSpectrum(sq);
  assert.ok(S.mag[0] > 1 && S.mag[0] < 1.1, `square fundamental ${S.mag[0]}`);
  assert.ok(maxDiff(fromSpectrum(S.mag, S.ph, S.dc), sq) < 1e-6);
  const rf = blRandom(42);
  const R = toSpectrum(rf);
  assert.ok(maxDiff(fromSpectrum(R.mag, R.ph), rf) < 1e-6);
  const sn = toSpectrum(sineFrame(1));
  close(sn.mag[0], 1, 1e-9); close(sn.ph[0], 0.5, 1e-9);
  close(toSpectrum(sineFrame(1, Math.PI / 2)).ph[0], 0.75, 1e-9);
  assert.equal(S.mag.length, 1024); assert.equal(S.ph.length, 1024);
  const half = toSpectrum(sineFrame(3).map(v => v * 0.25));
  close(half.mag[2], 0.5, 1e-9);
});

/* ---------------------------------------------------------------- 10. FFT area ops */

test('10 fftOp: clearHF / clearLF / randLow / phase-row clear and the rest', () => {
  const S = toSpectrum(factoryTable('factory:Default').frames[0]);
  const hf = fftOp(S, 'mag', 'clearHF', { bin: 10 });
  for (let k = 1; k <= 1024; k++) assert.equal(hf.mag[k - 1] === 0, k >= 10, `clearHF bin ${k}`);
  assert.deepEqual(hf.ph, S.ph);
  const lf = fftOp(S, 'mag', 'clearLF', { bin: 10 });
  for (let k = 1; k <= 1024; k++) assert.equal(lf.mag[k - 1] === 0, k <= 10, `clearLF bin ${k}`);
  const rl = fftOp(S, 'mag', 'randLow', { bin: 5, seed: 3 });
  for (let k = 1; k <= 1024; k++) assert.equal(rl.mag[k - 1] !== S.mag[k - 1], k <= 5, `randLow bin ${k}`);
  const pc = fftOp(S, 'ph', 'clearAll', { bin: 3 });
  assert.ok(pc.ph.every(v => v === 0.5));
  assert.deepEqual(pc.mag, S.mag);
  assert.ok(fftOp(S, 'mag', 'clearAll', {}).mag.every(v => v === 0));
  const saw = fftOp(S, 'mag', 'saw', {});
  close(saw.mag[3], 0.5, 1e-12); assert.ok(saw.ph.every(v => v === 0.5));
  const half = fftOp(S, 'mag', 'randLowHalf', { bin: 50, seed: 1 });
  for (let k = 0; k < 50; k++) assert.ok([0, 0.5, 1].includes(half.mag[k]));
  const up = fftOp(S, 'mag', 'octUp', {}), dn = fftOp(S, 'mag', 'octDown', {});
  close(up.mag[1], S.mag[0], 0); assert.equal(up.mag[0], 0); close(dn.mag[0], S.mag[1], 0);
  const odd = fftOp(S, 'mag', 'odd', {}), even = fftOp(S, 'mag', 'even', {});
  assert.ok(odd.mag[1] === 0 && odd.mag[0] > 0 && even.mag[0] === 0 && even.mag[1] > 0);
  const fd = fftOp(S, 'mag', 'fade', {});
  close(fd.mag[511], S.mag[511] * 0.25, 1e-12);
  const pf = fftOp({ mag: S.mag, ph: new Float64Array(1024).fill(0.9) }, 'ph', 'fade', {});
  close(pf.ph[511], 0.5 + 0.4 * 0.25, 1e-12);
  const gp = fftOp(S, 'mag', 'gaps', { seed: 2 }), cleared = gp.mag.filter(v => v === 0).length;
  assert.ok(cleared > 400 && cleared < 650);
  assert.equal(fftOp(S, 'mag', 'randAll', { seed: 9 }).mag.every(v => v >= 0 && v < 1), true);
  assert.equal(FFT_OPS.length, 14);
  for (const o of FFT_OPS) for (const row of ['mag', 'ph']) fftOp(S, row, o.id, { bin: 7, seed: 1 });
  // a magnitude written into an empty bin starts at sine phase (rounding-noise phases never leak into new harmonics)
  const Ssin = toSpectrum(factoryTable('factory:Sine').frames[0]);
  for (const [id, c] of [['octUp', {}], ['randLow', { bin: 8, seed: 4 }], ['randAll', { seed: 5 }]]) {
    const o = fftOp(Ssin, 'mag', id, c);
    for (let k = 2; k <= 8; k++) if (o.mag[k - 1] > 1e-3) close(o.ph[k - 1], 0.5, 0, `${id} harmonic ${k} phase`);
  }
  assert.equal(fftOp(Ssin, 'mag', 'octUp', {}).ph[1], 0.5);
  close(fftOp(S, 'mag', 'randLow', { bin: 5, seed: 3 }).ph[2], S.ph[2], 0, 'a non-empty bin keeps its phase');
  assert.throws(() => fftOp(S, 'mag', 'nope', {}));
});

/* ---------------------------------------------------------------- 11. imports */

test('11 import: pitchAvg / manual / zeroSnap / pitchFollow / fft / clm / raw, split sizes, PNG, singles', () => {
  const sr = 44100, n = sr;
  const saw = new Float32Array(n);
  for (let i = 0; i < n; i++) saw[i] = 0.8 * (1 - 2 * ((i * 220 / sr) % 1));
  const wav = { sr, ch: [saw], clm: null };
  const pa = tableFromWav(wav, { mode: 'pitchAvg' });
  close(pa.importSize, 44100 / 220, 1);
  assert.ok(pa.frames.length >= 200 && pa.frames.length <= 256, `${pa.frames.length} frames`);
  assert.equal(pa.morph, 0);
  close(peak(pa.frames.reduce((m, f) => (peak(f) > peak(m) ? f : m))), 1, 1e-6, 'normalize same');
  assert.match(pa.importMsg, /^split at: /);
  // every imported cycle looks like the saw (correlates with its neighbour)
  assert.ok(corr(pa.frames[10], pa.frames[11]) > 0.95);
  assert.equal(parseSplitSize('A3'), 200);
  assert.equal(parseSplitSize('0'), null);
  assert.equal(parseSplitSize(''), null);
  assert.equal(parseSplitSize('169'), 169);
  assert.equal(parseSplitSize('C4'), Math.round(44100 / 261.6255653));
  assert.equal(parseSplitSize('C#2'), Math.round(44100 / (440 * 2 ** ((37 - 69) / 12))));
  assert.equal(parseSplitSize('Db3'), Math.round(44100 / (440 * 2 ** ((49 - 69) / 12))));
  assert.equal(parseSplitSize('B0'), Math.round(44100 / (440 * 2 ** ((23 - 69) / 12))));
  assert.equal(parseSplitSize('12000'), null);
  assert.equal(parseSplitSize('sin(x)'), null);
  const man = tableFromWav(wav, { mode: 'manual', size: parseSplitSize('A3') });
  assert.equal(man.frames.length, Math.floor(n / 200));
  assert.match(man.importMsg, /^split at: 200 samples \(220\.50 Hz, A3/);
  const forced = tableFromWav(wav, { mode: 'zeroSnap', size: 'A3' });
  assert.equal(forced.frames.length, Math.floor(n / 200), 'a split size forces manual');
  for (const mode of ['zeroSnap', 'pitchFollow']) {
    const t = tableFromWav(wav, { mode });
    assert.ok(t.frames.length >= 200 && t.frames.length <= 256, `${mode}: ${t.frames.length}`);
    assert.ok(t.frames.every(f => f.every(Number.isFinite)));
    assert.ok(corr(t.frames[20], t.frames[21]) > 0.95, mode);
  }
  for (const N of [256, 512, 1024, 2048]) {
    const t = tableFromWav(wav, { mode: 'fft' + N });
    assert.equal(t.frames.length, Math.min(256, Math.floor((n - N) / (N / 2)) + 1));
    const S = toSpectrum(t.frames[3]);
    assert.ok(S.mag[0] > 0, 'fft import carries the spectrum');
  }
  // clm and raw 2048 imports keep the data (export → re-import identical)
  const table = factoryTable('factory:Basic Shapes');
  const back = tableFromWav(readWav(tableToWav(table, { bits: 32 })), { mode: 'auto' });
  assert.equal(back.frames.length, 6); assert.equal(back.morph, 1);
  back.frames.forEach((f, i) => assert.deepEqual(f, table.frames[i]));
  const sel = readWav(tableToWav(table, { bits: 16, frames: [2, 3] }));
  assert.equal(sel.ch[0].length, 2 * FRAME); assert.equal(sel.bits, 16);
  assert.deepEqual(sel.clm, { size: 2048, morph: 1, factory: 0 });
  const raw = tableFromWav({ sr, ch: [new Float32Array(3 * FRAME).fill(0.25)] }, { mode: 'auto' });
  assert.equal(raw.frames.length, 3); assert.equal(raw.frames[0][7], 0.25);
  // clm with another size → frames resampled to 2048
  const c1024 = Float32Array.from({ length: 2 * 1024 }, (_, i) => Math.sin(TAU * i / 1024));
  const rs = tableFromWav({ sr, ch: [c1024], clm: { size: 1024, morph: 0, factory: 0 } }, { mode: 'pitchAvg' });
  assert.equal(rs.frames.length, 2);
  assert.ok(maxDiff(rs.frames[0], sineFrame(1)) < 1e-5);
  // .txt override
  const tx = tableFromWav({ sr, ch: [Float32Array.from({ length: 3 * 600 }, (_, i) => Math.sin(TAU * i / 600))] }, { mode: 'auto', txt: { size: 600, interp: 1 } });
  assert.equal(tx.frames.length, 3); assert.equal(tx.morph, 1);
  // stereo → right channel for OSC B
  const st = tableFromWav({ sr, ch: [new Float32Array(FRAME), new Float32Array(FRAME).fill(0.5)] }, { mode: 'auto', channel: 1 });
  assert.equal(st.frames[0][5], 0.5);
  // exports
  const b256 = new Uint8Array(tableTo256(factoryTable('factory:Sine')));
  assert.equal(b256.length, 256);
  assert.ok(Math.abs(b256[0] - 128) <= 1 && Math.abs(b256[64] - 255) <= 1 && Math.abs(b256[192] - 1) <= 1);
  const singles = tableToSingles(table);
  assert.equal(singles.length, 6);
  assert.equal(singles[0].name, 'Basic Shapes 001.wav');
  assert.deepEqual(readWav(singles[2].buffer).ch[0], table.frames[2]);
  // PNG: 4×8 image → 4 frames (columns), luminance → amplitude, DC removed
  const W4 = 4, H8 = 8, data = new Uint8ClampedArray(W4 * H8 * 4);
  for (let y = 0; y < H8; y++) for (let x = 0; x < W4; x++) { const o = (y * W4 + x) * 4, v = y < 4 ? 255 : 0; data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255; }
  const img = importImage({ width: W4, height: H8, data });
  assert.equal(img.frames.length, 4);
  for (const f of img.frames) { assert.ok(Math.abs(f.reduce((a, b) => a + b, 0)) < 1e-3); assert.ok(f[10] > 0.9 && f[2040] < -0.9); }
  const wide = importImage({ width: 300, height: 2, data: new Uint8ClampedArray(300 * 2 * 4) });
  assert.equal(wide.frames.length, 256);
  // singles
  const sg = importSingles([{ sr, ch: [Float32Array.from({ length: 100 }, (_, i) => Math.sin(TAU * i / 100))] }, { sr, ch: [sineFrame(2)] }]);
  assert.equal(sg.frames.length, 2);
  assert.ok(maxDiff(sg.frames[0], sineFrame(1)) < 1e-4);
  const rp = replaceFrame(seq(3), 1, { sr, ch: [sineFrame(3)] });
  assert.deepEqual(rp.frames[1], sineFrame(3)); assert.equal(rp.frames.length, 3);
  // resampleCycle / bandlimit
  const odd = Float32Array.from({ length: 333 }, (_, i) => Math.sin(TAU * 2 * i / 333));
  assert.ok(maxDiff(resampleCycle(odd), sineFrame(2)) < 1e-5);
  const over4 = Float64Array.from({ length: 8192 }, (_, i) => Math.sin(TAU * 3 * i / 8192));
  assert.ok(maxDiff(bandlimit(over4, 4), sineFrame(3)) < 1e-6);
  // a clm file shorter than one declared frame → the whole file is the cycle; unknown modes → auto
  const short = tableFromWav({ sr, ch: [Float32Array.from({ length: 1000 }, (_, i) => Math.sin(TAU * i / 1000))], clm: { size: 2048, morph: 1, factory: 0 } }, { mode: 'auto' });
  assert.equal(short.frames.length, 1); assert.ok(maxDiff(short.frames[0], sineFrame(1)) < 1e-4);
  assert.equal(tableFromWav({ sr, ch: [new Float32Array(2 * FRAME)] }, { mode: 'bogus' }).frames.length, 2);
  assert.deepEqual([...W.IMPORT_MODES], ['auto', 'clm', 'zeroSnap', 'pitchFollow', 'pitchAvg', 'manual', 'fft256', 'fft512', 'fft1024', 'fft2048']);
  assert.equal(W.splitMsg(169), 'split at: 169 samples (260.95 Hz, C4 - 4 cents)');
  assert.throws(() => tableFromWav({ sr, ch: [] }, {}));
  assert.throws(() => tableFromWav(wav, { mode: 'manual' }));
});

test('11b import: default 2048 import in every mode, band-limited cycle cutting, split size on thumbnail drops', () => {
  const sr = 44100;
  // §8.2.2: a clm-less file whose length is a multiple of 2048 imports as frames of 2048 whatever mode was picked
  const sweep = factoryTable('factory:Sync Sweep'), src16 = sweep.frames.filter((f, i) => i % 4 === 0);
  const flat = new Float32Array(16 * FRAME);
  src16.forEach((f, i) => flat.set(f, i * FRAME));
  for (const mode of ['pitchAvg', 'zeroSnap', 'pitchFollow', 'auto']) {
    const t = tableFromWav({ sr, ch: [flat], clm: null }, { mode });
    assert.equal(t.frames.length, 16, mode);
    assert.equal(t.importSize, undefined, mode + ': no detected size to hold');
    t.frames.forEach((f, i) => assert.deepEqual(f, src16[i]));
  }
  assert.equal(tableFromWav({ sr, ch: [flat] }, { mode: 'pitchAvg', size: 'A3' }).frames.length, Math.floor(flat.length / 200), 'a held split size still wins');
  assert.ok(tableFromWav({ sr, ch: [flat] }, { mode: 'fft1024' }).frames.length > 16, 'FFT modes are never raw');
  // cycles longer than 2048 samples: harmonics above 1023 are dropped, nothing folds back (harmonic 1500 → 548)
  const P = 4096, long = Float32Array.from({ length: 6 * P }, (_, i) => 0.5 * Math.sin(TAU * 3 * i / P) + 0.5 * Math.sin(TAU * 1500 * i / P));
  const lt = tableFromWav({ sr, ch: [long] }, { mode: 'manual', size: P }), LS = toSpectrum(lt.frames[2]);
  for (let k = 1; k <= 1023; k++) if (k !== 3) assert.ok(LS.mag[k - 1] ** 2 < 1e-5 * LS.mag[2] ** 2, `split ${P}: harmonic ${k} = ${db(LS.mag[k - 1] ** 2 / LS.mag[2] ** 2).toFixed(1)} dB`);
  // the cut is flat up to 0.45·P (no interpolation droop)
  const hs = [5, 25, 50, 70, 85, 90], P2 = 200, x2 = new Float32Array(P2 * 30);
  for (let i = 0; i < x2.length; i++) for (const h of hs) x2[i] += 0.1 * Math.sin(TAU * h * i / P2 + h);
  const S2 = toSpectrum(tableFromWav({ sr, ch: [x2] }, { mode: 'manual', size: P2 }).frames[10]);
  for (const h of hs) close(db(S2.mag[h - 1] ** 2 / S2.mag[4] ** 2), 0, 0.5, `split 200: harmonic ${h}`);
  // a fractional period with strong high partials: YIN takes the deepest point of the dip, the cut stays flat
  const P3 = 200.45, x3 = new Float32Array(sr);
  for (let i = 0; i < sr; i++) { x3[i] = 0.3 * Math.sin(TAU * i / P3); for (const h of [2, 3, 7, 50, 70, 90]) x3[i] += 0.05 * Math.sin(TAU * h * i / P3 + h); }
  const t3 = tableFromWav({ sr, ch: [x3] }, { mode: 'pitchAvg' }), S3 = toSpectrum(t3.frames[100]);
  close(t3.importSize, P3, 0.5, 'detected period');
  for (const h of [3, 7, 50, 70, 90]) close(db(S3.mag[h - 1] ** 2 / S3.mag[1] ** 2), 0, 0.5, `pitchAvg harmonic ${h}`);
  // thumbnail drop with a held split size: the middle cycle cut at that size (clm still wins)
  const sine = Float32Array.from({ length: 200 * 9 + 37 }, (_, i) => Math.sin(TAU * i / 200));
  const c = W.cycleFromWav({ sr, ch: [sine] }, { size: 'A3' });
  assert.ok(maxDiff(c, sineFrame(1)) < 1e-4, 'one 200-sample cycle');
  assert.ok(corr(replaceFrame(seq(3), 2, { sr, ch: [sine] }, { size: 200 }).frames[2], sineFrame(1)) > 0.9999);
  assert.ok(corr(W.cycleFromWav({ sr, ch: [sine] }), sineFrame(1)) < 0.9, 'without a size the whole short file is the cycle');
  const withClm = { sr, ch: [sineFrame(3)], clm: { size: 2048, morph: 0, factory: 0 } };
  assert.deepEqual(W.cycleFromWav(withClm, { size: 200 }), sineFrame(3));
});

/* ---------------------------------------------------------------- 12. embedding, LFO shapes, draw tools */

test('12 embedding round trip, frameToPoints, ptsToFrame, draw tools, uuid', () => {
  const data = new Float32Array(2 * FRAME);
  for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * 0.37) * 1e3;
  const rec = { id: 'user:abc', kind: 'wt', name: 'A', frames: 2, morph: 1, data: data.buffer, created: 1, modified: 2 };
  const enc = encodeEmbedded(rec);
  assert.equal(typeof enc.b64, 'string');
  assert.equal(enc.data, undefined);
  const js = JSON.parse(JSON.stringify(enc));
  const dec = decodeEmbedded(js);
  assert.deepEqual(new Float32Array(dec.data), data);
  assert.deepEqual(Object.assign({}, dec, { data: null }), Object.assign({}, rec, { data: null }));
  for (const len of [0, 1, 2, 3, 4, 5]) {
    const u = Uint8Array.from({ length: len }, (_, i) => (i * 97 + 13) & 255);
    const d2 = decodeEmbedded(encodeEmbedded({ kind: 'noise', L: u.buffer, R: null }));
    assert.deepEqual(new Uint8Array(d2.L), u);
    assert.equal(d2.R, null);
  }
  const nz = { id: 'nzuser:1', kind: 'noise', name: 'n', rate: 48000, ch: 2, len: 3, loopStart: 0, loopEnd: 3, root: 60,
    L: new Float32Array([1, 2, 3]).buffer, R: new Float32Array([4, 5, 6]).buffer };
  const nd = decodeEmbedded(JSON.parse(JSON.stringify(encodeEmbedded(nz))));
  assert.deepEqual(new Float32Array(nd.R), new Float32Array([4, 5, 6]));
  assert.ok(typeof encodeEmbedded(nz).b64L === 'string' && typeof encodeEmbedded(nz).b64R === 'string');

  const tri = factoryTable('factory:Triangle').frames[0], pts = frameToPoints(tri);
  assert.ok(pts.length <= 64 && pts.length >= 3);
  assert.deepEqual(pts[0].slice(0, 1), [0]); assert.equal(pts[pts.length - 1][0], 1);
  assert.ok(pts.every(p => p.length === 3 && p[2] === 0 && p[1] >= 0 && p[1] <= 1));
  let maxErr = 0;
  for (let i = 0; i < FRAME; i++) {
    const x = i / FRAME;
    let j = 0;
    while (j + 1 < pts.length && pts[j + 1][0] <= x) j++;
    const a = pts[j], b = pts[Math.min(pts.length - 1, j + 1)];
    const y = b[0] > a[0] ? a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]) : a[1];
    maxErr = Math.max(maxErr, Math.abs(y - (0.5 + 0.5 * tri[i])));
  }
  assert.ok(maxErr < 0.01, `max error ${maxErr}`);
  assert.ok(frameToPoints(randFrame(4), 16).length <= 16);
  // LFO table → frame
  const tab = Float32Array.from({ length: 1025 }, (_, i) => 0.5 + 0.5 * Math.sin(TAU * i / 1024));
  assert.ok(maxDiff(ptsToFrame(tab), sineFrame(1)) < 1e-3);
  // draw tools
  assert.equal(DRAW_TOOLS.length, 13);
  const zero = new Float32Array(FRAME);
  const flat = drawTool(zero, 'flat', { x1: 0.3, y1: 0.5, grid: 4 });
  assert.ok(flat.subarray(512, 1024).every(v => v === 0.5) && flat[511] === 0 && flat[1024] === 0);
  const free = drawTool(zero, 'flat', { x0: 0, y0: -1, x1: 1, y1: 1, grid: 0 });
  close(free[0], -1, 1e-6); close(free[2047], 1, 1e-6); close(free[1023], 0, 1e-3);
  const up = drawTool(zero, 'slopeUp', { x1: 0.1, y1: 0.8, grid: 2 });
  close(up[0], -0.8, 1e-6); close(up[1023], 0.8, 1e-6); assert.equal(up[1024], 0);
  const sn = drawTool(zero, 'sine', { x1: 0.5, y1: 0.5, grid: 3 });
  close(toSpectrum(sn).mag[2], Math.sqrt(0.5), 1e-6);
  const hp = drawTool(zero, 'halfPeak', { x1: 0.9, y1: -0.6, grid: 1 });
  close(hp[1023], 0.6, 1e-3); assert.ok(hp.every(v => v >= 0));
  const hv = drawTool(zero, 'halfValley', { x1: 0.9, y1: 0.6, grid: 1 });
  assert.ok(hv.every(v => v <= 0));
  const cu = drawTool(zero, 'curveUp', { x1: 0.1, y1: 1, grid: 1 }), cd = drawTool(zero, 'curveDown', { x1: 0.1, y1: 1, grid: 1 });
  close(cu[0], 0, 1e-9); close(cu[2047], 1, 1e-9); close(cd[0], 1, 1e-9); close(cd[2047], 0, 1e-9);
  const ramp = Float32Array.from({ length: FRAME }, (_, i) => (i % 512) / 512);
  const il = drawTool(ramp, 'interpLin', { x1: 0.1, grid: 4 });
  close(il[0], ramp[0], 1e-9); close(il[511], ramp[511], 1e-9);
  const ic = drawTool(ramp, 'interpCurve', { x1: 0.1, grid: 4 });
  close(ic[255], ramp[0] + (ramp[511] - ramp[0]) * (0.5 - 0.5 * Math.cos(Math.PI * 255 / 511)), 1e-6);
  const nu = drawTool(new Float32Array(FRAME).fill(0.9), 'nudge', { x1: 0.1, y0: 0, y1: 0.3, grid: 4 });
  assert.equal(nu[10], 1); assert.ok(Math.abs(nu[600] - 0.9) < 1e-6);
  const no = drawTool(zero, 'noise', { x1: 0.1, y0: 0, y1: 0.2, grid: 4, seed: 4 });
  assert.ok(peak(no.subarray(0, 512)) > 0.05 && peak(no.subarray(512)) === 0);
  const sm = drawTool(randFrame(1), 'noise', { x1: 0.1, y0: 0.2, y1: 0, grid: 4 });
  const rough = f => { let s = 0; for (let i = 1; i < 512; i++) s += Math.abs(f[i] - f[i - 1]); return s; };
  assert.ok(rough(sm) < rough(randFrame(1)) * 0.8, 'noise drag down smooths');
  const span = drawTool(zero, 'halfPeak', { x0: 0.25, x1: 0.5, y1: 1, grid: 0 });
  assert.ok(span[700] > 0.5 && span[100] === 0 && span[1500] === 0);
  assert.throws(() => drawTool(zero, 'nope', { x1: 0 }));
  assert.match(uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

/* ---------------------------------------------------------------- 13–15. Phase 2 (SPEC-serum2 §11.13, §10.5, §9.4.3; inv B11) */

const ampOf = f => toSpectrum(f).mag.map(m => m * m); // editor units: mag = √A_k
const frac1 = x => x - Math.floor(x);

test('13 Phase 2 content: Phase-1 tables first and unchanged, the six §10.5 tables, sub:Triangle', async () => {
  const P1 = await import('./ref-p1/wt.js');
  assert.deepEqual(FACTORY_TABLES.slice(0, 27), P1.FACTORY_TABLES.slice(), 'Phase-1 catalogue is the prefix');
  assert.deepEqual(SUB_TABLES.slice(0, 5), P1.SUB_TABLES.slice());
  for (const id of [...P1.FACTORY_TABLES.map(t => t.id), ...P1.SUB_TABLES]) {
    const a = factoryTable(id), b = P1.factoryTable(id);
    a.frames.forEach((f, i) => assert.deepEqual(f, b.frames[i], `${id} frame ${i} bit-identical`));
  }
  assert.deepEqual(FACTORY_TABLES.slice(27).map(t => [t.id, t.cat, t.frames, t.morph]), [
    ['factory:Default Shapes', 'Basic', 9, 0], ['factory:Spectral Saw', 'Digital', 64, 2], ['factory:Vocal Sweep 2', 'Vocal', 32, 1],
    ['factory:Hollow PWM', 'Analog', 64, 1], ['factory:Metallic FM', 'FM', 64, 1], ['factory:Stepped Partials', 'Digital', 16, 0]]);
  // Default Shapes: saw (= the Phase-1 Default), sine, triangle, square, pulse 25 %, pulse 12.5 %, half-sine, sine-saw, square-sine
  const ds = factoryTable('factory:Default Shapes').frames, bs = factoryTable('factory:Basic Shapes').frames;
  assert.deepEqual(ds[0], factoryTable('factory:Default').frames[0]);
  for (const [d, b] of [[1, 0], [2, 1], [3, 3], [4, 4], [5, 5]]) assert.deepEqual(ds[d], bs[b], `Default Shapes ${d}`);
  const N = FRAME, ph = i => i / N, sawT = p => 1 - 2 * p;
  const refs = {
    6: i => Math.max(0, Math.sin(TAU * ph(i))) - 1 / Math.PI,
    7: i => Math.sin(TAU * ph(i)) + 0.5 * sawT(ph(i)),
    8: i => Math.sin(TAU * ph(i)) + 0.5 * (ph(i) < 0.5 ? 1 : -1),
  };
  for (const k of [6, 7, 8]) {
    assert.ok(corr(ds[k], Float64Array.from({ length: N }, (_, i) => refs[k](i))) > 0.999, `Default Shapes ${k}`);
    close(peak(ds[k]), 1, 1e-6);
  }
  assert.ok(Math.abs(ds[6].reduce((a, b) => a + b, 0)) / N < 1e-6, 'half-sine: DC removed');
  // Spectral Saw: saw harmonics × 1 + 3·exp(−((k − 2 − 1.2f)/4)²): A_k·k peaks at the formant
  const ss = factoryTable('factory:Spectral Saw');
  for (const f of [0, 10, 31, 63]) {
    const a = ampOf(ss.frames[f]);
    let b = 0;
    for (let k = 0; k < 1023; k++) if (a[k] * (k + 1) > a[b] * (b + 1)) b = k;
    assert.ok(Math.abs(b + 1 - (2 + 1.2 * f)) <= 1, `Spectral Saw frame ${f}: peak at harmonic ${b + 1}`);
    close(a[200] * 201 / (a[0] * 1), (1 + 3 * Math.exp(-(((201 - 2 - 1.2 * f) / 4) ** 2))) / (1 + 3 * Math.exp(-(((1 - 2 - 1.2 * f) / 4) ** 2))), 1e-3, 'envelope');
  }
  assert.equal(expandTable(ss).length, 256 * FRAME);
  // Vocal Sweep 2 (110 Hz series, table III a → u): F1 of a (1030 Hz) at frame 0, of u (430 Hz) at frame 31
  const vs = factoryTable('factory:Vocal Sweep 2').frames, top = f => { const a = ampOf(f); let b = 0; for (let k = 1; k < 181; k++) if (a[k] > a[b]) b = k; return b + 1; };
  assert.ok([9, 10].includes(top(vs[0])), 'a: ' + top(vs[0]));
  assert.equal(top(vs[31]), 4, 'u');
  assert.ok(ampOf(vs[0])[190] < 1e-9, 'harmonics above 181 (≈ 20 kHz) are empty');
  // Hollow PWM: duty 50 % (no even harmonics) → 5 % with even harmonics × 0.3^(f/63)
  const hp = factoryTable('factory:Hollow PWM').frames, a0 = ampOf(hp[0]), a63 = ampOf(hp[63]);
  assert.ok(a0[1] < 1e-9 * a0[0] && a0[3] < 1e-9 * a0[0] && a0[2] > 0.3 * a0[0]);
  const pul = k => Math.abs(Math.sin(Math.PI * k * 0.05)) / k;
  close(a63[1] / a63[0], 0.3 * pul(2) / pul(1), 1e-4, 'even harmonic 2 attenuated');
  close(a63[2] / a63[0], pul(3) / pul(1), 1e-4, 'odd harmonic 3 kept');
  // Metallic FM: a sine at frame 0, rich at frame 63, no DC
  const mf = factoryTable('factory:Metallic FM').frames, m0 = ampOf(mf[0]), m63 = ampOf(mf[63]);
  for (let k = 1; k < 64; k++) assert.ok(m0[k] < 1e-6 * m0[0], 'frame 0 is a sine');
  assert.ok(m63.slice(0, 16).filter(v => v > 0.1 * Math.max(...m63)).length >= 6, 'frame 63 is rich');
  assert.ok(Math.abs(toSpectrum(mf[63]).dc) < 1e-6);
  // Stepped Partials: harmonics {1, f + 2, 2f + 3} at equal amplitude, nothing else
  const sp = factoryTable('factory:Stepped Partials').frames;
  for (const f of [0, 7, 15]) {
    const a = ampOf(sp[f]), set = new Set([1, f + 2, 2 * f + 3]);
    for (let k = 1; k <= 1023; k++) {
      if (set.has(k)) close(a[k - 1] / a[0], 1, 1e-5, `Stepped Partials ${f} harmonic ${k}`);
      else assert.ok(a[k - 1] < 1e-6 * a[0], `Stepped Partials ${f}: harmonic ${k} empty`);
    }
  }
  // sub:Triangle = −(1 − 4·|frac(φ + 0.25) − 0.5|), band-limited: 0 at the start, falls to −1 at ¼, +1 at ¾, odd harmonics
  const tri = factoryTable('sub:Triangle').frames[0];
  assert.ok(corr(tri, Float64Array.from({ length: N }, (_, i) => -(1 - 4 * Math.abs(frac1(i / N + 0.25) - 0.5)))) > 0.99999);
  close(tri[0], 0, 1e-6); close(tri[512], -1, 1e-3); close(tri[1536], 1, 1e-3);
  const ta = ampOf(tri);
  for (let k = 2; k <= 64; k += 2) assert.ok(ta[k - 1] < 1e-9, 'even harmonic ' + k);
  const te = makeEntry('sub:Triangle', factoryTable('sub:Triangle'));
  assert.deepEqual([te.frames, te.interp], [1, 0]);
});

test('14 Phase 2 noiseLevels(…, maxLevels): default = Phase 1 bit for bit, up to 8 levels, never below 64 samples', async () => {
  const P1 = await import('./ref-p1/wt.js');
  const r = mulberry32(9), x = Float32Array.from({ length: 48000 }, () => r() * 2 - 1), y = Float32Array.from({ length: 48000 }, () => r() * 2 - 1);
  for (const [len, whole, R] of [[48000, false, null], [48000, true, y], [45001, true, null], [3000, true, y], [3001, false, y]]) {
    const a = noiseLevels(x, R, len, 0, len, whole), b = P1.noiseLevels(x, R, len, 0, len, whole);
    assert.equal(a.length, b.length);
    a.forEach((l, i) => {
      assert.deepEqual([l.len, l.loopStart, l.loopEnd], [b[i].len, b[i].loopStart, b[i].loopEnd]);
      assert.deepEqual(l.L, b[i].L); assert.deepEqual(l.R, b[i].R);
    });
  }
  const l8 = noiseLevels(x, y, 48000, 0, 48000, false, 8);
  assert.deepEqual(l8.map(l => l.len), [48000, 24000, 12000, 6000, 3000, 1500, 750, 375]);
  const d6 = noiseLevels(x, y, 48000, 0, 48000, false);
  d6.forEach((l, i) => { assert.deepEqual(l8[i].L, l.L); assert.deepEqual(l8[i].R, l.R); });
  assert.equal(noiseLevels(x, null, 48000, 0, 48000, false, 2).length, 2);
  assert.equal(noiseLevels(x, null, 48000, 0, 48000, false, 1).length, 1);
  assert.equal(noiseLevels(x, null, 48000, 0, 48000, false, 0).length, 6, 'not positive → the Phase-1 count');
  assert.equal(noiseLevels(x, null, 48000, 0, 48000, false, 99).length, 8, 'at most 8');
  assert.equal(noiseLevels(x, null, 100, 0, 100, false, 8).length, 1, 'the next level would be shorter than 64');
  assert.deepEqual(noiseLevels(x, null, 1000, 0, 1000, true, 3).map(l => l.len), [1000, 500, 250], 'whole-loop (exact) path');
  assert.deepEqual(noiseLevels(x, null, 1000, 0, 1000, true).map(l => l.len), [1000, 500, 250, 125]);
  // whole-length loops with maxLevels step by exactly 2× at every level (§9.4.3; the sample engines read level ℓ at
  // p·2^−ℓ): ⌈len/2^ℓ⌉ samples, sample m = the band-limited loop at level-0 position m·2^ℓ — also when 2^ℓ does not
  // divide len (both the exact FFT path below 8192 samples and the half-band cascade above); levels whose step divides
  // len are the Phase-1 ones, and calls without maxLevels stay Phase 1 bit for bit (above)
  for (const len of [601, 4097, 6000, 8193, 12345, 48001]) {
    const f = t => Math.sin(TAU * t / len + 0.3) + 0.5 * Math.cos(TAU * 3 * t / len) + 0.25 * Math.sin(TAU * 5 * t / len);
    const s = Float32Array.from({ length: len }, (_, i) => f(i)), lv = noiseLevels(s, s, len, 0, len, true, 8);
    lv.forEach((l, i) => {
      assert.deepEqual([l.len, l.loopStart, l.loopEnd], [Math.ceil(len / 2 ** i), 0, Math.ceil(len / 2 ** i)], len + ' level ' + i);
      for (let m = 0; m < l.len; m++) close(l.L[m], f(m * 2 ** i), 2e-5, len + ' level ' + i + ' sample ' + m);
      assert.deepEqual(l.R, l.L);
    });
    const p1 = noiseLevels(s, null, len, 0, len, true);
    for (let i = 0; i < Math.min(lv.length, p1.length) && len % 2 ** i === 0; i++) assert.deepEqual(lv[i].L, p1[i].L, len + ' exact level ' + i);
  }
  const n2 = 3 * 8192 + 1, w2 = Float32Array.from({ length: n2 }, (_, i) => Math.sin(TAU * i / n2)), l2 = noiseLevels(w2, null, n2, 0, n2, true, 8);
  assert.deepEqual(l2.map(l => l.len), [24577, 12289, 6145, 3073, 1537, 769, 385, 193]);
});

test('15 Phase 2 editor operations: mirror, Reduce to, paste, Randomize, Repeat Bin Group, phase nudge, estimatePeriod', () => {
  // draw tool `mirror`: the Flat Line stroke plus y[2047 − i] = −y[i]
  assert.deepEqual(DRAW_TOOLS.at(-1), { id: 'mirror', label: 'Mirror' });
  const base = randFrame(8);
  const mc = drawTool(base, 'mirror', { x1: 0.1, y1: 0.5, grid: 4 });
  assert.ok(mc.subarray(0, 512).every(v => v === 0.5) && mc.subarray(1536).every(v => v === -0.5));
  assert.deepEqual(mc.subarray(512, 1536), base.subarray(512, 1536));
  const ms = drawTool(base, 'mirror', { x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.8, grid: 0 }), fl = drawTool(base, 'flat', { x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.8, grid: 0 });
  const a0 = Math.round(0.1 * 2047), b0 = Math.round(0.3 * 2047);
  for (let i = a0; i <= b0; i++) { assert.equal(ms[i], fl[i]); assert.equal(ms[2047 - i], -ms[i]); }
  assert.equal(ms[1000], base[1000]);
  const cross = drawTool(base, 'mirror', { x0: 0.4, y0: -1, x1: 0.6, y1: 1, grid: 0 }), lo = Math.round(0.4 * 2047), hi = Math.round(0.6 * 2047);
  for (let i = lo; i <= hi; i++) assert.equal(cross[2047 - i], -cross[i], 'antisymmetric across the centre');
  const flc = drawTool(base, 'flat', { x0: 0.4, y0: -1, x1: 0.6, y1: 1, grid: 0 });
  for (let i = lo; i < 1024; i++) assert.equal(cross[i], flc[i], 'the left half defines the crossing');
  // add.reduceTo: n evenly spaced frames round(j·(R − 1)/(n − 1)), ends kept; ≤ n frames unchanged
  assert.deepEqual(ids(applyOp(seq(7), 'add.reduceTo', { n: 4 })), [0, 2, 4, 6]);
  assert.deepEqual(ids(applyOp(seq(256), 'add.reduceTo', { n: 5 })), [0, 64, 128, 191, 255]);
  assert.deepEqual(ids(applyOp(seq(3), 'add.reduceTo', { n: 4 })), [0, 1, 2]);
  assert.deepEqual(ids(applyOp(seq(7), 'add.reduceTo', { n: 1 })), [0, 6], 'n ≥ 2');
  assert.equal(applyOp(seq(256), 'add.reduceTo', { n: 128 }).frames.length, 128);
  assert.deepEqual({ menu: OPS['add.reduceTo'].menu, sub: OPS['add.reduceTo'].sub }, { menu: 'Add/Remove', sub: true });
  assert.equal(opEnabled(seq(1), 'add.reduceTo', {}), false);
  // add.paste: the clipboard after the current frame, ≤ 256 frames in all
  const A = new Float32Array(FRAME).fill(0.5), B = new Float32Array(FRAME).fill(0.7);
  const pt = applyOp(seq(5), 'add.paste', { cur: 1, clip: [A, B] });
  assert.deepEqual(ids(pt), [0, 1, 500, 700, 2, 3, 4]);
  assert.notEqual(pt.frames[2], A, 'pasted frames are copies');
  assert.equal(applyOp(seq(255), 'add.paste', { cur: 0, clip: [A, B, A] }).frames.length, 256);
  assert.deepEqual(ids(applyOp(seq(256), 'add.paste', { cur: 0, clip: [A] })).length, 256);
  assert.deepEqual(ids(applyOp(seq(3), 'add.paste', { cur: 0 })), [0, 1, 2]);
  const odd = applyOp(seq(1), 'add.paste', { cur: 0, clip: [Float32Array.from([NaN, 0.25, Infinity])] }).frames[1];
  assert.equal(odd.length, FRAME); assert.deepEqual([odd[0], odd[1], odd[2], odd[3]], [0, 0.25, 0, 0]);
  assert.equal(OPS['add.paste'].menu, null);
  assert.deepEqual([opEnabled(seq(3), 'add.paste', { clip: [A] }), opEnabled(seq(3), 'add.paste', { clip: [] }), opEnabled(seq(256), 'add.paste', { clip: [A] })], [true, false, false]);
  assert.equal(OPS['sort.random'].label, 'Randomize');
  // FFT: Repeat Bin Group (bins 1…bin repeated up to 1023) and the phase nudge (+1/64, wrapping)
  const S = toSpectrum(factoryTable('factory:Default').frames[0]);
  assert.equal(FFT_OPS.at(-1).id, 'repeatGroup');
  const rg = fftOp(S, 'mag', 'repeatGroup', { bin: 3 });
  for (let k = 1; k <= 1023; k++) assert.equal(rg.mag[k - 1], S.mag[(k - 1) % 3], 'bin ' + k);
  assert.equal(rg.mag[1023], S.mag[1023], 'bin 1024 untouched');
  assert.deepEqual(rg.ph, S.ph);
  const pp = { mag: S.mag, ph: Float64Array.from({ length: 1024 }, (_, k) => (k % 7) / 7), dc: 0 }, rp = fftOp(pp, 'ph', 'repeatGroup', { bin: 5 });
  for (let k = 6; k <= 1023; k++) assert.equal(rp.ph[k - 1], pp.ph[(k - 1) % 5]);
  const sp1 = fftOp(Object.assign({}, S, { ph: Float64Array.from(S.ph).fill(0.99, 4, 5) }), 'ph', 'nudgePhase', { bin: 5 });
  close(sp1.ph[4], 0.99 + 1 / 64 - 1, 1e-12, 'wraps');
  const sp2 = fftOp(S, 'mag', 'nudgePhase', { bin: 2 });
  close(sp2.ph[1], frac1(S.ph[1] + 1 / 64), 1e-12);
  assert.deepEqual(sp2.mag, S.mag);
  for (let k = 0; k < 1024; k++) if (k !== 1) assert.equal(sp2.ph[k], S.ph[k]);
  assert.ok(!FFT_OPS.some(o => o.id === 'nudgePhase'), 'not in FFT_OPS (the editor adds it to the phase row only)');
  // estimatePeriod: YIN on the first channel (FREQUENCY ESTIMATION), periods up to the split field's 9999 samples
  const sr = 44100, saw = Float32Array.from({ length: sr / 2 }, (_, i) => 0.7 * (1 - 2 * ((i * 220 / sr) % 1)));
  close(W.estimatePeriod({ sr, ch: [saw] }), sr / 220, 0.5);
  const blSaw = (P, n, noise = 0) => { const r = mulberry32(P | 0); return Float32Array.from({ length: n }, (_, i) => { let s = 0; for (let k = 1; k < Math.min(30, P / 2); k++) s += Math.sin(TAU * k * i / P) / k; return 0.5 * s + noise * (r() - 0.5); }); };
  for (const P of [1020, 1022, 1030, 1070.4, 1100, 2400, 6996, 7000, 9999]) { // 1022…1100 used to stick at the lag limit
    const n = Math.max(88200, Math.ceil(P * 4));
    close(W.estimatePeriod({ sr, ch: [blSaw(P, n)] }), P, P * 1e-4, 'band-limited saw P ' + P);
    close(W.estimatePeriod({ sr, ch: [Float32Array.from({ length: n }, (_, i) => 0.7 * Math.sin(TAU * i / P))] }), P, P * 1e-4, 'sine P ' + P);
  }
  close(W.estimatePeriod({ sr, ch: [blSaw(3000, 30 * 44100, 0.2)] }), 3000, 1.5, 'a 30 s noisy file (bounded analysis)');
  for (const [P, k] of [[600, 2], [600, 3], [256, 2], [2048, 2], [1100, 2], [7000, 2], [9999, 2]]) { // a few naive cycles
    const x2 = Float32Array.from({ length: P * k }, (_, i) => 1 - 2 * ((i / P) % 1));
    assert.equal(W.estimatePeriod({ sr, ch: [x2] }), P, k + ' cycles of ' + P + ' (exactly periodic: an integer)');
  }
  assert.equal(W.estimatePeriod({ sr, ch: [Float32Array.from({ length: 600 }, (_, i) => 1 - 2 * i / 600)] }), null, 'one cycle: no repetition');
  for (const P of [10500, 14000]) assert.equal(W.estimatePeriod({ sr, ch: [Float32Array.from({ length: P * 4 }, (_, i) => Math.sin(TAU * i / P))] }), null, 'beyond 9999: none (never a value pinned at a lag limit)');
  const r = mulberry32(3), nz = Float32Array.from({ length: sr / 2 }, () => r() - 0.5);
  close(W.estimatePeriod({ sr, ch: [saw, nz] }), sr / 220, 0.5, 'the first channel');
  assert.equal(W.estimatePeriod({ sr, ch: [new Float32Array(20000)] }), null, 'silence');
  assert.equal(W.estimatePeriod({ sr, ch: [new Float32Array(50).fill(0.5)] }), null, 'too short');
  assert.equal(W.estimatePeriod({ sr, ch: [] }), null);
  assert.equal(W.estimatePeriod(null), null);
  // splitMsg: the pitch at the file's rate (default 44.1 kHz, Phase 1)
  assert.equal(W.splitMsg(200), 'split at: 200 samples (220.50 Hz, A3 + 4 cents)');
  assert.equal(W.splitMsg(218.18, 48000), 'split at: 218.18 samples (220.00 Hz, A3 + 0 cents)');
  assert.match(W.splitMsg(436.36, 96000), /\(220\.00 Hz, A3/);
});
