// wt.js — wavetable data for the Serum-style instrument (SPEC-serum §7, §8.2): FFT, mip-maps, factory wavetables,
// procedural noise sources, WAV/clm I/O, imports, the formula interpreter and every wavetable-editor operation.
// Pure ES module: no imports, no DOM, no timers, no eval — importable from node, module Workers and the main thread.
//
// Conventions
//   · A Table is { name, frames: [Float32Array(2048) × R], morph: 0–4, factory: 0|1 } (§7.1). Frames are treated as
//     immutable: every operation returns a new Table and new frame arrays (unchanged frames may be shared).
//   · Spectra in "editor units" (§8.2.1): index k−1 = harmonic k; mag = √A_k (A_k = 2|X_k|/2048), ph ∈ [0,1) with
//     sine phase = 0.5 and cosine phase = 0.75.
//   · Deterministic content uses mulberry32(fnv1a32(id)); nothing here calls Math.random except uuid()'s fallback.
//   · Non-finite samples (NaN/Inf from float WAVs or corrupt embedded data) are replaced by 0 at every entry point that
//     can feed the DSP (readWav, decodeEmbedded, makeEntry/buildMips/buildMipFrame, noiseLevels).
//
// Additions to the spec text (reported to the lead)
//   · Noise records may carry an optional `loopWhole` (1/0): whether the sample loops over its whole length. It selects
//     circular vs linear decimation (§7.9); frameToNoise/lfoToNoise set 1; without it noiseEntry compares the energy
//     at both ends. Factory one-shots are decimated linearly, so an attack never wraps onto the end of a level.
//   · Seam crossfades are skipped for sources that are seamless by construction (Velvet on a loop-periodic grid, Mains
//     Hum = whole hum cycles + white hiss); Air Vent's periodic hum is added after its noise crossfade.
//   · Spectral Process ops that recombine magnitudes and phases scale the result back to max(1, previous peak).
//
// Phase 2 (SPEC-serum2 §11.13, §10.5, §9.4.3; inv B11) — appended only, every Phase-1 table, noise and sub entry stays
// bit-identical: SUB_TABLES + `sub:Triangle`; FACTORY_TABLES + the six §10.5 tables; noiseLevels(…, maxLevels) (7th
// argument, default 6 = Phase 1, at most 8; with it, whole-length loops step by exactly 2× per level); draw tool
// `mirror`; ops `add.reduceTo` and `add.paste` (frame PASTE, menu-less like `add.move`); FFT ops `repeatGroup` (menu)
// and `nudgePhase` (Shift-Cmd/Ctrl-click; not in FFT_OPS — the editor offers it on the phase row's menu);
// estimatePeriod(wav) (periods up to 9999 samples); splitMsg(N, sr). IMPL choices where §10.5 leaves details open: Vocal Sweep 2 interpolates the formant
// frequencies linearly in Hz between the five vowels (frame f at vowel position 4f/31); Metallic FM removes DC with the
// band limit; Default Shapes' half-sine is the half-wave rectified sine max(0, sin).

/* ================================================================== constants */

export const FRAME = 2048;
export const MAX_FRAMES = 256;
export const MIP_HARM = Object.freeze([1023, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1]);
export const MIP_LEN = Object.freeze([2048, 2048, 2048, 1024, 512, 256, 256, 256, 256, 256, 256]);
export const NOISE_RATE = 48000;
export const MIDI60_HZ = 440 * Math.pow(2, -9 / 12); // 261.6255653005986 Hz (C4 in this app's naming)

const TAU = 2 * Math.PI;
const HALF_PI = Math.PI / 2;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const isPow2 = n => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
const frac = x => x - Math.floor(x);
const fin = v => (Number.isFinite(v) ? v : 0);
const idx = (v, n) => clamp(Math.round(+v || 0), 0, Math.max(0, n - 1));

/* ================================================================== PRNG / hashing */

export function fnv1a32(s) {
  s = String(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// mulberry32: returns a generator of uniform numbers in [0, 1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function uuid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hx = Array.from(b, v => v.toString(16).padStart(2, '0')).join('');
  return `${hx.slice(0, 8)}-${hx.slice(8, 12)}-${hx.slice(12, 16)}-${hx.slice(16, 20)}-${hx.slice(20)}`;
}

/* ================================================================== FFT */

const FT = new Map(); // n → { rev, cos, sin }
function ftab(n) {
  let t = FT.get(n);
  if (t) return t;
  const rev = new Uint32Array(n), cos = new Float64Array(Math.max(1, n >> 1)), sin = new Float64Array(Math.max(1, n >> 1));
  let bits = 0;
  while ((1 << bits) < n) bits++;
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0, v = i; b < bits; b++, v >>= 1) r = (r << 1) | (v & 1);
    rev[i] = r;
  }
  for (let k = 0; k < n >> 1; k++) { cos[k] = Math.cos(TAU * k / n); sin[k] = Math.sin(TAU * k / n); }
  t = { rev, cos, sin };
  FT.set(n, t);
  return t;
}

function fftCore(re, im, inverse) {
  const n = re.length;
  if (n <= 1) return;
  const { rev, cos, sin } = ftab(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  const sg = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const wr = cos[k], wi = sg * sin[k];
        const a = i + j, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
  if (inverse) {
    const s = 1 / n;
    for (let i = 0; i < n; i++) { re[i] *= s; im[i] *= s; }
  }
}

// In-place radix-2 complex FFT (Float64Array, power-of-two n ≤ 65536); inverse scales by 1/n.
export function fft(re, im, inverse) {
  const n = re.length;
  if (!isPow2(n) || n > 65536 || !im || im.length !== n) throw new Error('fft: size must be a power of two ≤ 65536');
  fftCore(re, im, !!inverse);
}

// Bluestein chirp-z for any length (cached per n).
const BL = new Map();
function blue(n) {
  let b = BL.get(n);
  if (b) return b;
  let m = 1;
  while (m < 2 * n - 1) m <<= 1;
  const wr = new Float64Array(n), wi = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const a = Math.PI * ((k * k) % (2 * n)) / n;
    wr[k] = Math.cos(a); wi[k] = -Math.sin(a); // w_k = e^{−iπk²/n}
  }
  const br = new Float64Array(m), bi = new Float64Array(m);
  br[0] = wr[0]; bi[0] = -wi[0];
  for (let k = 1; k < n; k++) { br[k] = br[m - k] = wr[k]; bi[k] = bi[m - k] = -wi[k]; }
  fftCore(br, bi, false);
  b = { m, wr, wi, br, bi };
  if (BL.size > 64) BL.clear();
  BL.set(n, b);
  return b;
}

// In-place complex DFT of any length (power of two → fft, else Bluestein); inverse scales by 1/n.
export function dft(re, im, inverse) {
  const n = re.length;
  if (n <= 1) return;
  if (isPow2(n)) { fftCore(re, im, !!inverse); return; }
  const { m, wr, wi, br, bi } = blue(n);
  const ar = new Float64Array(m), ai = new Float64Array(m);
  const sg = inverse ? -1 : 1; // inverse via conjugation
  for (let k = 0; k < n; k++) {
    const xr = re[k], xi = sg * im[k];
    ar[k] = xr * wr[k] - xi * wi[k];
    ai[k] = xr * wi[k] + xi * wr[k];
  }
  fftCore(ar, ai, false);
  for (let k = 0; k < m; k++) {
    const xr = ar[k] * br[k] - ai[k] * bi[k], xi = ar[k] * bi[k] + ai[k] * br[k];
    ar[k] = xr; ai[k] = xi;
  }
  fftCore(ar, ai, true);
  const s = inverse ? 1 / n : 1;
  for (let k = 0; k < n; k++) {
    const xr = ar[k] * wr[k] - ai[k] * wi[k], xi = ar[k] * wi[k] + ai[k] * wr[k];
    re[k] = xr * s; im[k] = sg * xi * s;
  }
}

function rfftPow2(x, n, oRe, oIm) {
  if (n < 4) {
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = x[i];
    fftCore(re, im, false);
    for (let k = 0; k <= n >> 1; k++) { oRe[k] = re[k]; oIm[k] = im[k]; }
    return;
  }
  const h = n >> 1;
  const zr = new Float64Array(h), zi = new Float64Array(h);
  for (let m = 0; m < h; m++) { zr[m] = x[2 * m]; zi[m] = x[2 * m + 1]; }
  fftCore(zr, zi, false);
  const { cos, sin } = ftab(n);
  for (let k = 0; k <= h; k++) {
    const k1 = k === h ? 0 : k, k2 = (h - k) % h;
    const ar = zr[k1], ai = zi[k1], br = zr[k2], bi = -zi[k2];
    const er = 0.5 * (ar + br), ei = 0.5 * (ai + bi);
    const or = 0.5 * (ai - bi), oi = -0.5 * (ar - br);
    const c = k === h ? -1 : cos[k], s = k === h ? 0 : sin[k];
    oRe[k] = er + c * or + s * oi;
    oIm[k] = ei + c * oi - s * or;
  }
}

function irfftPow2(re, im, n, out) {
  if (n < 4) {
    const r = new Float64Array(n), i2 = new Float64Array(n);
    for (let k = 0; k <= n >> 1; k++) { r[k] = re[k] || 0; i2[k] = im[k] || 0; }
    for (let k = 1; k < n - (n >> 1); k++) { r[n - k] = r[k]; i2[n - k] = -i2[k]; }
    fftCore(r, i2, true);
    for (let i = 0; i < n; i++) out[i] = r[i];
    return;
  }
  const h = n >> 1;
  const zr = new Float64Array(h), zi = new Float64Array(h);
  const { cos, sin } = ftab(n);
  for (let k = 0; k < h; k++) {
    const ar = re[k], ai = im[k], br = re[h - k], bi = -im[h - k];
    const er = 0.5 * (ar + br), ei = 0.5 * (ai + bi);
    const dr = 0.5 * (ar - br), di = 0.5 * (ai - bi);
    const c = cos[k], s = sin[k];
    const or = dr * c - di * s, oi = dr * s + di * c;
    zr[k] = er - oi; zi[k] = ei + or;
  }
  fftCore(zr, zi, true);
  for (let m = 0; m < h; m++) { out[2 * m] = zr[m]; out[2 * m + 1] = zi[m]; }
}

// Real FFT: n/2 + 1 bins (any n; power-of-two sizes use the half-size complex transform).
export function rfft(x) {
  const n = x.length, nb = (n >> 1) + 1;
  const re = new Float64Array(nb), im = new Float64Array(nb);
  if (n === 0) return { re, im };
  if (isPow2(n)) { rfftPow2(x, n, re, im); return { re, im }; }
  const r = new Float64Array(n), i2 = new Float64Array(n);
  for (let i = 0; i < n; i++) r[i] = x[i];
  dft(r, i2, false);
  for (let k = 0; k < nb; k++) { re[k] = r[k]; im[k] = i2[k]; }
  return { re, im };
}

// Inverse real FFT from bins 0…n/2 (missing bins = 0) → Float64Array(n). im[0] (and im[n/2] for even n) ignored.
export function irfft(re, im, n) {
  const nb = (n >> 1) + 1;
  const R = new Float64Array(nb), I = new Float64Array(nb);
  const m = Math.min(nb, re.length);
  for (let k = 0; k < m; k++) { R[k] = re[k]; I[k] = im ? im[k] || 0 : 0; }
  I[0] = 0;
  if (n % 2 === 0) I[nb - 1] = 0;
  const out = new Float64Array(n);
  if (n === 0) return out;
  if (isPow2(n)) { irfftPow2(R, I, n, out); return out; }
  const r = new Float64Array(n), i2 = new Float64Array(n);
  for (let k = 0; k < nb; k++) { r[k] = R[k]; i2[k] = I[k]; }
  for (let k = 1; k < n - k; k++) { r[n - k] = R[k]; i2[n - k] = -I[k]; }
  dft(r, i2, true);
  for (let i = 0; i < n; i++) out[i] = r[i];
  return out;
}

/* ================================================================== spectra (editor units) */

function spec2048(frame) { return rfft(frame.length === FRAME ? frame : fitLen(frame)); }
function fitLen(f) { const o = new Float64Array(FRAME); for (let i = 0; i < FRAME && i < f.length; i++) o[i] = f[i]; return o; }
function fromRI(re, im) { return Float32Array.from(irfft(re, im, FRAME)); }

export function toSpectrum(frame) {
  const X = spec2048(frame);
  const mag = new Float64Array(1024), ph = new Float64Array(1024);
  for (let k = 1; k <= 1024; k++) {
    const r = X.re[k], i = X.im[k];
    mag[k - 1] = Math.sqrt(2 * Math.hypot(r, i) / FRAME);
    ph[k - 1] = frac((Math.atan2(i, r) + HALF_PI) / TAU + 0.5);
  }
  return { mag, ph, dc: X.re[0] / FRAME };
}

export function fromSpectrum(mag, ph, dc = 0) {
  const re = new Float64Array(1025), im = new Float64Array(1025);
  re[0] = fin(dc) * FRAME;
  const n = Math.min(1023, mag.length);
  for (let k = 1; k <= n; k++) {
    const m = mag[k - 1] > 0 ? mag[k - 1] : 0;
    if (!(m > 0) || !Number.isFinite(m)) continue;
    const a = TAU * (fin(ph[k - 1]) - 0.5) - HALF_PI, amp = m * m * 1024;
    re[k] = amp * Math.cos(a); im[k] = amp * Math.sin(a);
  }
  return fromRI(re, im);
}

/* ================================================================== mip-maps (§7.3) */

const allFinite = a => { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; };
const cleanFrame = f => (allFinite(f) ? f : Float32Array.from(f, fin)); // NaN/Inf would spread over the whole frame

function mipInto(frame, levels, f) {
  const X = spec2048(cleanFrame(frame));
  for (let l = 0; l < levels.length; l++) {
    const L = levels[l], len = L.len, harm = Math.min(L.harm, (len >> 1) - 1), s = len / FRAME;
    const re = new Float64Array((len >> 1) + 1), im = new Float64Array((len >> 1) + 1);
    for (let k = 0; k <= harm; k++) { re[k] = X.re[k] * s; im[k] = X.im[k] * s; }
    L.data.set(irfft(re, im, len), f * len);
  }
}

// Frames as the DSP plays them (§7.5): R real frames for morph 0/1, the 256-slot expansion for spectral morphs.
function playFrames(table) {
  const fr = table.frames, R = fr.length;
  if ((table.morph | 0) >= 2 && R > 1 && R < MAX_FRAMES) {
    const ex = expandTable(fr.every(allFinite) ? table : { frames: fr.map(cleanFrame), morph: table.morph }), out = [];
    for (let s = 0; s < MAX_FRAMES; s++) out.push(ex.subarray(s * FRAME, (s + 1) * FRAME));
    return out;
  }
  return fr;
}

export function buildMips(table) {
  const pf = playFrames(table), F = pf.length;
  const levels = MIP_HARM.map((harm, l) => ({ len: MIP_LEN[l], harm, data: new Float32Array(F * MIP_LEN[l]) }));
  for (let f = 0; f < F; f++) mipInto(pf[f], levels, f);
  return levels;
}

export function buildMipFrame(frame) {
  const levels = MIP_HARM.map((harm, l) => ({ len: MIP_LEN[l], harm, data: new Float32Array(MIP_LEN[l]) }));
  mipInto(frame, levels, 0);
  return levels;
}

export function makeEntry(id, table) {
  const R = table.frames.length, morph = clamp(table.morph | 0, 0, 4);
  const levels = buildMips(table);
  return { t: 'wt', id, v: 1, kind: 'wt', frames: levels[0].data.length / FRAME, interp: morph !== 0 && R > 1 ? 1 : 0, morph, levels };
}

/* ================================================================== morph expansion (§7.1) */

function wrapPi(d) { return d - TAU * Math.ceil((d - Math.PI) / TAU); } // → (−π, π]

export function expandTable(table) {
  const fr = table.frames, R = fr.length, morph = table.morph | 0;
  if (!(morph !== 0 && R > 1 && R < MAX_FRAMES)) {
    const out = new Float32Array(R * FRAME);
    for (let f = 0; f < R; f++) out.set(fr[f], f * FRAME);
    return out;
  }
  const out = new Float32Array(MAX_FRAMES * FRAME);
  if (morph === 1) {
    for (let s = 0; s < MAX_FRAMES; s++) {
      const u = s * (R - 1) / 255, i0 = Math.floor(u), i1 = Math.min(R - 1, Math.ceil(u)), t = u - i0;
      const a = fr[i0], b = fr[i1], o = s * FRAME;
      if (t === 0) out.set(a, o);
      else for (let i = 0; i < FRAME; i++) out[o + i] = a[i] + (b[i] - a[i]) * t;
    }
    return out;
  }
  // spectral: per bin magnitude lerp + shortest-arc phase interpolation (inv A10.7)
  const S = fr.map(f => {
    const X = spec2048(f), m = new Float64Array(1024), p = new Float64Array(1024);
    for (let k = 1; k < 1024; k++) { m[k] = Math.hypot(X.re[k], X.im[k]); p[k] = Math.atan2(X.im[k], X.re[k]); }
    return { dc: X.re[0], m, p };
  });
  const slot = k => Math.round(k * 255 / (R - 1));
  for (let k = 0; k < R; k++) out.set(fr[k], slot(k) * FRAME);
  const re = new Float64Array(1025), im = new Float64Array(1025);
  for (let k = 0; k < R - 1; k++) {
    const s0 = slot(k), s1 = slot(k + 1), A = S[k], B = S[k + 1];
    for (let s = s0 + 1; s < s1; s++) {
      const t = (s - s0) / (s1 - s0);
      re[0] = A.dc + (B.dc - A.dc) * t; im[0] = 0;
      for (let j = 1; j < 1024; j++) {
        const m = A.m[j] + (B.m[j] - A.m[j]) * t, p = A.p[j] + t * wrapPi(B.p[j] - A.p[j]);
        re[j] = m * Math.cos(p); im[j] = m * Math.sin(p);
      }
      re[1024] = 0; im[1024] = 0;
      out.set(irfft(re, im, FRAME), s * FRAME);
    }
  }
  return out;
}

/* ================================================================== generic cycle helpers */

// One cycle rendered at 2048·over points → FFT → harmonics 1…1023 (+DC) → 2048 samples (Render OSC Warp, PWM op).
export function bandlimit(x, over) {
  const N = x.length;
  if (!N) return new Float32Array(FRAME);
  const X = rfft(x), s = FRAME / N, H = Math.min(1023, Math.ceil(N / 2) - 1);
  const re = new Float64Array(1025), im = new Float64Array(1025);
  for (let k = 0; k <= H; k++) { re[k] = X.re[k] * s; im[k] = X.im[k] * s; }
  return fromRI(re, im);
}

// Any-length single cycle → 2048 samples by FFT resampling (band-limited, Nyquist bin of the source dropped).
export function resampleCycle(x) {
  const n = x.length;
  if (n === 0) return new Float32Array(FRAME);
  if (n === 1) return new Float32Array(FRAME).fill(fin(x[0]));
  return bandlimit(x, n / FRAME);
}

function hermiteWrap(x, pos) { // periodic read
  const n = x.length, i = Math.floor(pos), f = pos - i;
  const i0 = ((i % n) + n) % n, im = i0 === 0 ? n - 1 : i0 - 1, i1 = i0 + 1 === n ? 0 : i0 + 1, i2 = i1 + 1 === n ? 0 : i1 + 1;
  const xm = x[im], x0 = x[i0], x1 = x[i1], x2 = x[i2];
  const c1 = 0.5 * (x1 - xm), c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
}

// Band-limited interpolation kernel for cycle extraction: Kaiser-windowed sinc (β 9, half-width 24 source samples),
// cutoff 0.575 cycles/sample: flat (±0.001 dB) up to the source Nyquist, ≤ −85 dB from 0.65 cycles/sample on.
// Tabulated at 1/1024 sample (linear interpolation), built on first use.
const CK_HW = 24, CK_RES = 1024, CK_FC = 0.575;
let CK = null;
function cycKernel() {
  if (CK) return CK;
  const n = CK_HW * CK_RES, t = new Float64Array(n + 2), i0 = besselI0(9);
  for (let j = 0; j <= n; j++) {
    const x = j / CK_RES, u = x / CK_HW;
    t[j] = (x === 0 ? 2 * CK_FC : Math.sin(TAU * CK_FC * x) / (Math.PI * x)) * besselI0(9 * Math.sqrt(Math.max(0, 1 - u * u))) / i0;
  }
  return (CK = t);
}
function bliRead(x, pos, K) { // band-limited read of x at fractional pos (edge samples held)
  const n = x.length, last = n - 1, i = Math.floor(pos), d = pos - i, lim = CK_HW * CK_RES;
  let acc = 0;
  for (let k = 1 - CK_HW; k <= CK_HW; k++) {
    const t = Math.abs(k - d) * CK_RES, j = Math.floor(t);
    if (j >= lim) continue;
    const ix = i + k;
    acc += (K[j] + (K[j + 1] - K[j]) * (t - j)) * x[ix < 0 ? 0 : ix > last ? last : ix];
  }
  return acc;
}
// A cycle of (fractional) length P starting at (fractional) s, read from the continuing signal → Float32Array(2048).
// The cycle is read at M ≥ 1.4·P points with the kernel above (so its images stay below harmonic M/2), then only the
// harmonics the source rate can carry (≤ P/2, ≤ 1023) are kept: flat to the source Nyquist and free of folding for
// any P (also P > 2048).
function cycleAt(x, s, P) {
  let M = FRAME;
  while (M < 1.4 * P) M <<= 1;
  const K = cycKernel(), tmp = new Float64Array(M), d = P / M;
  for (let j = 0; j < M; j++) tmp[j] = bliRead(x, s + j * d, K);
  const X = rfft(tmp), H = Math.min(1023, Math.floor(P / 2 - 1e-9)), sc = FRAME / M;
  const re = new Float64Array(1025), im = new Float64Array(1025);
  for (let k = 0; k <= H; k++) { re[k] = X.re[k] * sc; im[k] = X.im[k] * sc; }
  return fromRI(re, im);
}

function peakOf(a) { let p = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > p) p = v; } return p; }
function scaled(a, g) { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] * g; return o; }
function normPeak(a) { const p = peakOf(a); return p > 0 ? scaled(a, 1 / p) : Float32Array.from(a); }

/* ================================================================== factory wavetables (§7.8) */

const FORMANT_I = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]];
const FORMANT_II = [[850, 1220, 2810], [610, 2330, 2990], [310, 2790, 3310], [590, 920, 2710], [370, 950, 2670]];
const FORMANT_G = [1, 0.7, 0.5];
const FORMANT_III = [[1030, 1370, 3170], [690, 2610, 3570], [370, 3200, 3730], [680, 1060, 3180], [430, 1170, 3260]]; // serum-core FORMANTS[2]

// Additive frame: coef(k) → [cosine amplitude, sine amplitude] for k = 1…H, peak-normalised.
function additive(coef, H = 1023, norm = true) {
  const re = new Float64Array(1025), im = new Float64Array(1025);
  for (let k = 1; k <= H; k++) {
    const c = coef(k);
    if (!c) continue;
    re[k] = c[0] * 1024; im[k] = -c[1] * 1024;
  }
  const f = fromRI(re, im);
  return norm ? normPeak(f) : f;
}
// Time-domain frame at 4× (8192 points), band-limited to 1023 harmonics, optional DC removal, peak-normalised.
function timeDomain(fn, dcRemove) {
  const N = 8192, x = new Float64Array(N);
  for (let j = 0; j < N; j++) x[j] = fin(fn(j / N));
  const X = rfft(x), s = FRAME / N;
  const re = new Float64Array(1025), im = new Float64Array(1025);
  for (let k = dcRemove ? 1 : 0; k <= 1023; k++) { re[k] = X.re[k] * s; im[k] = X.im[k] * s; }
  return normPeak(fromRI(re, im));
}
// Amplitude/phase spectrum (sine-phase reference: phase φ adds to sin(2πkt + φ)).
function harmonics(amp, phase, H = 1023) {
  return additive(k => { const a = amp(k); if (!a) return null; const p = phase ? phase(k) : 0; return [a * Math.sin(p), a * Math.cos(p)]; }, H);
}

const sawC = k => [0, 2 / (Math.PI * k)];
const sqrC = k => (k & 1 ? [0, 4 / (Math.PI * k)] : null);
const triC = k => (k & 1 ? [0, (8 / (Math.PI * Math.PI)) * ((k - 1) / 2 % 2 ? -1 : 1) / (k * k)] : null);
// band-limited pulse 2·[φ < d] − 1 without DC: (2/πk)[sin θ · cos + (1 − cos θ) · sin], θ = 2πkd
const pulseC = d => k => { const t = TAU * k * d; return [2 / (Math.PI * k) * Math.sin(t), 2 / (Math.PI * k) * (1 - Math.cos(t))]; };
const sawT = p => 1 - 2 * p; // falling ramp
const sqrT = p => (p < 0.5 ? 1 : -1);

function vowelFrame(table, vowel) {
  const f0 = 110, F = table[vowel];
  return harmonics(k => {
    const fk = k * f0;
    if (fk > 20000) return 0;
    let a = 0;
    for (let j = 0; j < 3; j++) { const d = (fk - F[j]) / (F[j] / 8); a += FORMANT_G[j] / (1 + d * d); }
    return a;
  }, null, 181);
}

// Phase 2 (§10.5): formants F = [F1, F2, F3] (Hz) on a 110 Hz harmonic series, as vowelFrame.
function formantFrame(F) {
  return harmonics(k => {
    const fk = k * 110;
    if (fk > 20000) return 0;
    let a = 0;
    for (let j = 0; j < 3; j++) { const d = (fk - F[j]) / (F[j] / 8); a += FORMANT_G[j] / (1 + d * d); }
    return a;
  }, null, 181);
}
// half-wave rectified sine max(0, sin) without its DC 1/π: ½ sin θ − (2/π) Σ_{k even} cos kθ / (k² − 1)
const halfSineC = k => (k === 1 ? [0, 0.5] : k & 1 ? null : [-2 / (Math.PI * (k * k - 1)), 0]);
// Default Shapes (§10.5): saw (= the Phase-1 Default frame), sine, triangle, square, pulse 25 %, pulse 12.5 %, half-sine,
// sine-saw (sin + 0.5·saw), square-sine (0.5·square + sin); every frame peak-normalised
const DEFAULT_SHAPES = [
  () => additive(sawC), () => additive(k => (k === 1 ? [0, 1] : null), 1), () => additive(triC), () => additive(sqrC),
  () => additive(pulseC(0.25)), () => additive(pulseC(0.125)), () => additive(halfSineC),
  () => additive(k => [0, (k === 1 ? 1 : 0) + 1 / (Math.PI * k)]),
  () => additive(k => (k & 1 ? [0, (k === 1 ? 1 : 0) + 2 / (Math.PI * k)] : null)),
];

const FRAMES = n => Array.from({ length: n }, (_, f) => f);
const FACTORY_DEF = [
  // [name, cat, R, morph, generator(f, R, rnd) → frame]
  ['Default', 'Basic', 1, 0, () => additive(sawC)],
  ['Basic Shapes', 'Basic', 6, 1, f => [() => additive(k => (k === 1 ? [0, 1] : null), 1), () => additive(triC), () => additive(sawC),
    () => additive(sqrC), () => additive(pulseC(0.25)), () => additive(pulseC(0.125))][f]()],
  ['Sine', 'Basic', 1, 0, () => additive(k => (k === 1 ? [0, 1] : null), 1)],
  ['Triangle', 'Basic', 1, 0, () => additive(triC)],
  ['Square', 'Basic', 1, 0, () => additive(sqrC)],
  ['Pulse 25', 'Basic', 1, 0, () => additive(pulseC(0.25))],
  ['PWM Sweep', 'Analog', 64, 1, f => additive(pulseC(0.5 - 0.48 * f / 63))],
  // hard-synced cycles and the RC ramp carry a DC offset by construction (bin 0 is dropped: harmonics 1…1023 only)
  ['Sync Sweep', 'Analog', 64, 1, f => { const r = 1 + 7 * f / 63; return timeDomain(p => sawT(frac(p * r)), true); }],
  ['Sync Square', 'Analog', 64, 1, f => { const r = 1 + 5 * f / 63; return timeDomain(p => sqrT(frac(p * r)), true); }],
  ['Analog Ramp', 'Analog', 32, 1, f => { const a = 0.01 + 6 * f / 31; return timeDomain(p => (1 - Math.exp(-a * p)) / (1 - Math.exp(-a)) * 2 - 1, true); }],
  ['Saw to Square', 'Analog', 2, 2, f => additive(f ? sqrC : sawC)],
  ['Harmonic Sweep', 'Digital', 256, 0, f => additive(k => (k <= f + 1 ? [0, 1 / k] : null), f + 1)],
  ['Odd Sweep', 'Digital', 64, 1, f => additive(k => (k & 1 && k <= 2 * f + 1 ? [0, 1 / k] : null), 2 * f + 1)],
  ['Bit Steps', 'Digital', 32, 1, f => {
    const L = Math.max(2, Math.round(Math.pow(2, 8 - 7 * f / 31)));
    return timeDomain(p => { const x = Math.sin(TAU * p), k = Math.min(L - 1, Math.floor((x + 1) / 2 * L)); return (2 * k + 1) / L - 1; });
  }],
  ['Fold Sweep', 'Digital', 64, 1, f => { const g = 1 + 11 * f / 63; return timeDomain(p => Math.sin(HALF_PI * g * Math.sin(TAU * p))); }],
  ['Random Spectra', 'Digital', 64, 2, (f, R, rnd) => {
    const u = 0.4 + 1.2 * rnd(), ph = Float64Array.from({ length: 257 }, () => TAU * rnd());
    return harmonics(k => Math.pow(k, -u), k => ph[k], 256);
  }],
  ['FM Ratio 1', 'FM', 64, 1, f => { const I = 10 * f / 63; return timeDomain(p => Math.sin(TAU * p + I * Math.sin(TAU * p))); }],
  ['FM Ratio 2', 'FM', 64, 1, f => { const I = 8 * f / 63; return timeDomain(p => Math.sin(TAU * p + I * Math.sin(2 * TAU * p))); }],
  ['FM Bell', 'FM', 64, 1, f => { const I = 6 * f / 63; return timeDomain(p => Math.sin(2 * TAU * p + I * Math.sin(3 * TAU * p))); }],
  ['Phase Distortion', 'FM', 64, 1, f => { const r = 1 + 15 * f / 63; return timeDomain(p => (1 - p) * Math.cos(TAU * r * p), true); }],
  ['Vowels', 'Vocal', 5, 2, f => vowelFrame(FORMANT_I, f)],
  ['Formant Sweep', 'Vocal', 64, 1, f => {
    const F = 200 * Math.pow(16, f / 63), bw = F / 6;
    return harmonics(k => { const fk = k * 110; if (fk > 20000) return 0; const d = (fk - F) / (bw / 2); return 1 / (1 + d * d); }, null, 181);
  }],
  ['Reed', 'Organic', 16, 1, f => { const p = 1.6 - f / 15; return harmonics(k => (k & 1 ? 1 : 0.2) / Math.pow(k, p)); }],
  ['Bowed', 'Organic', 16, 1, (f, R, rnd, shared) => harmonics(k => Math.pow(k, -1 - f / 30), k => shared.jit[k])],
  ['Glass', 'Organic', 32, 1, (f, R, rnd, shared) => {
    const set = [1, 3, 7, 12, 19, 27, 38, 52], lim = 8 + 1.5 * f;
    return harmonics(k => (set.includes(k) && k <= lim ? Math.pow(k, -0.5) : 0), k => shared.gph[k], 52);
  }],
  ['Choir', 'Organic', 16, 2, f => vowelFrame(FORMANT_II, f % 5)],
  ['Granular Grit', 'Digital', 32, 0, (f, R, rnd) => {
    const H = 64 + 6 * f;
    return additive(k => (k <= H ? [rnd() * 2 - 1, rnd() * 2 - 1] : null), H);
  }],
  // ---- Phase 2 (§10.5), appended: the Phase-1 ids and their order stay
  ['Default Shapes', 'Basic', 9, 0, f => DEFAULT_SHAPES[f]()],
  ['Spectral Saw', 'Digital', 64, 2, f => additive(k => {
    const d = (k - 2 - 1.2 * f) / 4;
    return [0, 2 / (Math.PI * k) * (1 + 3 * Math.exp(-d * d))];
  })],
  ['Vocal Sweep 2', 'Vocal', 32, 1, f => { // a → e → i → o → u (table III), linear in Hz between neighbouring vowels
    const u = 4 * f / 31, i0 = Math.min(3, Math.floor(u)), t = u - i0, A = FORMANT_III[i0], B = FORMANT_III[i0 + 1];
    return formantFrame([0, 1, 2].map(j => A[j] + (B[j] - A[j]) * t));
  }],
  ['Hollow PWM', 'Analog', 64, 1, f => {
    const P = pulseC(0.5 - 0.45 * f / 63), g = Math.pow(0.3, f / 63);
    return additive(k => { const c = P(k); return k & 1 ? c : [c[0] * g, c[1] * g]; });
  }],
  ['Metallic FM', 'FM', 64, 1, f => { const I = 6 * f / 63; return timeDomain(p => Math.sin(TAU * p + I * Math.sin(TAU * 3.5 * p)), true); }],
  ['Stepped Partials', 'Digital', 16, 0, f => additive(k => (k === 1 || k === f + 2 || k === 2 * f + 3 ? [0, 1] : null), 2 * f + 3)],
];

function factoryShared(name, rnd) {
  if (name === 'Bowed') return { jit: Float64Array.from({ length: 1024 }, () => (rnd() * 2 - 1) * 0.2) };
  if (name === 'Glass') return { gph: Float64Array.from({ length: 64 }, () => TAU * rnd()) };
  return null;
}

const SUB_DEF = [
  ['Sine', () => additive(k => (k === 1 ? [0, -1] : null), 1)],
  ['RoundRect', () => timeDomain(p => -Math.tanh(4 * Math.sin(TAU * p)) / Math.tanh(4))],
  ['Saw', () => additive(k => [0, (k & 1 ? -2 : 2) / (Math.PI * k)])],
  ['Square', () => additive(k => (k & 1 ? [0, -4 / (Math.PI * k)] : null))],
  ['Pulse', () => additive(k => { const c = pulseC(0.25)(k); return [-2 / 3 * c[0], -2 / 3 * c[1]]; })],
  // Phase 2 (§3.6 SUB_SHAPES2, appended): x(φ) = −(1 − 4·|frac(φ + 0.25) − 0.5|), the negated triangle (starts at 0, falls)
  ['Triangle', () => additive(k => { const c = triC(k); return c ? [0, -c[1]] : null; })],
];

export const FACTORY_TABLES = Object.freeze(FACTORY_DEF.map(([name, cat, frames, morph]) =>
  Object.freeze({ id: 'factory:' + name, name, cat, frames, morph })));
export const SUB_TABLES = Object.freeze(SUB_DEF.map(d => 'sub:' + d[0]));

// Builds a factory or sub table without caching (deterministic; used by factoryTable and the tests).
export function generateTable(id) {
  id = String(id);
  if (id.startsWith('sub:')) {
    const d = SUB_DEF.find(s => 'sub:' + s[0] === id);
    return d ? { name: d[0], frames: [d[1]()], morph: 0, factory: 1 } : null;
  }
  const d = FACTORY_DEF.find(s => 'factory:' + s[0] === id);
  if (!d) return null;
  const [name, , R, morph, gen] = d;
  const rnd = mulberry32(fnv1a32(id)), shared = factoryShared(name, rnd);
  return { name, frames: FRAMES(R).map(f => gen(f, R, rnd, shared)), morph, factory: 1 };
}

const TABLE_CACHE = new Map();
export function factoryTable(id) {
  if (TABLE_CACHE.has(id)) return TABLE_CACHE.get(id);
  const t = generateTable(id);
  if (t) { Object.freeze(t.frames); TABLE_CACHE.set(id, Object.freeze(t)); }
  return t;
}

/* ================================================================== noise sources (§7.9) */

const SR = NOISE_RATE;
const XFADE = 4096;
const dBg = db => Math.pow(10, db / 20);

function biquad() { return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0 }; }
function bqSet(q, type, fc, Q, gainDb) {
  const w = TAU * clamp(fc, 1, SR * 0.49) / SR, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * Q);
  const A = Math.pow(10, (gainDb || 0) / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'ls') {
    const s = 2 * Math.sqrt(A) * al;
    b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
    a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s;
  } else { // 'hs'
    const s = 2 * Math.sqrt(A) * al;
    b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
    a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s;
  }
  q.b0 = b0 / a0; q.b1 = b1 / a0; q.b2 = b2 / a0; q.a1 = a1 / a0; q.a2 = a2 / a0;
  return q;
}
function bq(q, x) {
  const y = q.b0 * x + q.b1 * q.x1 + q.b2 * q.x2 - q.a1 * q.y1 - q.a2 * q.y2;
  q.x2 = q.x1; q.x1 = x; q.y2 = q.y1; q.y1 = Math.abs(y) < 1e-30 ? 0 : y;
  return q.y1;
}
function filt(x, type, fc, Q, gain) { const q = bqSet(biquad(), type, fc, Q, gain); for (let i = 0; i < x.length; i++) x[i] = bq(q, x[i]); return x; }
// time-varying filter: fcAt(i) re-evaluated every 16 samples
function sweep(x, type, fcAt, Q) { const q = biquad(); for (let i = 0; i < x.length; i++) { if ((i & 15) === 0) bqSet(q, type, fcAt(i), Q); x[i] = bq(q, x[i]); } return x; }

const white = rnd => rnd() * 2 - 1;
function whiteN(n, rnd) { const o = new Float64Array(n); for (let i = 0; i < n; i++) o[i] = rnd() * 2 - 1; return o; }
function pinkN(n, rnd) { // Voss–McCartney, 16 rows + one per-sample white row
  const rows = new Float64Array(16);
  let sum = 0;
  for (let r = 0; r < 16; r++) { rows[r] = white(rnd); sum += rows[r]; }
  const o = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let c = i + 1, tz = 0;
    while ((c & 1) === 0 && tz < 15) { c >>= 1; tz++; }
    sum -= rows[tz]; rows[tz] = white(rnd); sum += rows[tz];
    o[i] = (sum + white(rnd)) / 17;
  }
  return o;
}
function brownN(n, rnd, pole = 0.998) { const o = new Float64Array(n); let y = 0; for (let i = 0; i < n; i++) { y = pole * y + white(rnd) * 0.05; o[i] = y; } return demean(o); }
function demean(o) { let m = 0; for (let i = 0; i < o.length; i++) m += o[i]; m /= o.length || 1; for (let i = 0; i < o.length; i++) o[i] -= m; return o; }
function diff(x) { const o = new Float64Array(x.length); for (let i = 0; i < x.length; i++) o[i] = x[i] - (i ? x[i - 1] : 0); return o; }
const t60 = (t, T) => Math.pow(10, -3 * t / T); // exponential decay reaching −60 dB at T seconds
function rms(x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / (x.length || 1)); }
// slow smoothed random walk in [lo, hi], one control value every `step` samples, cosine-interpolated
function walk(n, rnd, step, lo, hi, speed = 0.25) {
  const K = Math.ceil(n / step) + 2, pts = new Float64Array(K);
  let v = rnd();
  for (let k = 0; k < K; k++) { v = clamp(v + (rnd() - 0.5) * speed, 0, 1); pts[k] = v; }
  const o = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = i / step, k = Math.floor(p), t = 0.5 - 0.5 * Math.cos(Math.PI * (p - k));
    o[i] = lo + (hi - lo) * (pts[k] + (pts[k + 1] - pts[k]) * t);
  }
  return o;
}
function decaySine(o, at, f, T, amp, ph = 0) { // add amp·sin(2πft + ph)·T60 decay starting at `at`
  const n = Math.min(o.length - at, Math.ceil(T * SR));
  for (let j = 0; j < n; j++) o[at + j] += amp * Math.sin(TAU * f * j / SR + ph) * t60(j / SR, T);
}
function tones(n, parts, f0, T, sh, attack = 0.002) {
  const o = new Float64Array(n);
  parts.forEach(([r, a], j) => {
    const f = f0 * r, ph = TAU * sh(), Tj = T / (1 + 0.35 * j);
    if (f >= SR / 2) return;
    for (let i = 0; i < n; i++) { const t = i / SR; o[i] += a * Math.sin(TAU * f * t + ph) * t60(t, Tj) * Math.min(1, t / attack); }
  });
  return o;
}
function lfsr(n, bits, clockHz, seed) {
  const o = new Float64Array(n), mask = (1 << bits) - 1;
  let s = (seed & mask) || 1, ph = 0;
  const inc = clockHz / SR;
  for (let i = 0; i < n; i++) {
    ph += inc;
    while (ph >= 1) { ph -= 1; const b = (s ^ (s >> 1)) & 1; s = (s >> 1) | (b << (bits - 1)); }
    o[i] = s & 1 ? 1 : -1;
  }
  return o;
}
function harmonicBank(n, rnd, f0, kMax, gainOf, Q) {
  const o = new Float64Array(n), src = whiteN(n, rnd);
  for (let k = 1; k <= kMax; k++) {
    const g = gainOf(k), f = k * f0;
    if (!(g > 0) || f >= SR * 0.45) continue;
    const q = bqSet(biquad(), 'bp', f, Q);
    for (let i = 0; i < n; i++) o[i] += g * bq(q, src[i]);
  }
  return o;
}
function riser(n, rnd) {
  const x = whiteN(n, rnd), T = n / SR;
  sweep(x, 'bp', i => 200 * Math.pow(50, i / n), 3);
  for (let i = 0; i < n; i++) { const t = i / SR / T; x[i] *= t * t; }
  return x;
}

// [name, cat, samples, oneshot, colour, mono, gen(n, rnd, sh) → Float64Array(n), opts?]
// Loopable sources are generated with XFADE extra samples and equal-power crossfaded into the start (uncorrelated
// content). opts.seamless: gen(len) is already a seamless loop (periodic content / independent samples), so no
// crossfade (an equal-power fade of correlated content would swell by up to +3 dB at the seam).
// opts.post(x, sh): adds periodic content after the crossfade.
const N273 = 131072;
const sec = s => Math.round(s * SR);
const NOISE_DEF = [
  ['White', 'Colors', N273, 0, 1, 0, (n, r) => whiteN(n, r)],
  ['Pink', 'Colors', N273, 0, 1, 0, (n, r) => pinkN(n, r)],
  ['Brown', 'Colors', N273, 0, 1, 0, (n, r) => brownN(n, r)],
  ['Blue', 'Colors', N273, 0, 1, 0, (n, r) => diff(pinkN(n, r))],
  ['Violet', 'Colors', N273, 0, 1, 0, (n, r) => diff(whiteN(n, r))],
  ['Grey', 'Colors', N273, 0, 1, 0, (n, r) => filt(filt(whiteN(n, r), 'ls', 300, 0.707, 14), 'hs', 8000, 0.707, 8)],
  ['Velvet', 'Colors', N273, 0, 1, 0, (n, r) => { // one ±1 impulse per cell, cells tile the loop exactly (seamless)
    const o = new Float64Array(n), K = Math.max(1, Math.round(n * 2000 / SR));
    for (let m = 0; m < K; m++) { const a = Math.floor(m * n / K), b = Math.floor((m + 1) * n / K); o[a + Math.floor(r() * (b - a))] = r() < 0.5 ? -1 : 1; }
    return o;
  }, { seamless: 1 }],
  ['Mono White', 'Colors', N273, 0, 1, 1, (n, r) => whiteN(n, r)],
  ['Tape Hiss', 'Analog', sec(4), 0, 0, 0, (n, r, sh) => {
    const x = filt(pinkN(n, r), 'hs', 6000, 0.707, 6), ph = TAU * sh();
    for (let i = 0; i < n; i++) x[i] *= dBg(Math.sin(TAU * 0.3 * i / SR + ph));
    return x;
  }],
  ['Vinyl Crackle', 'Analog', sec(4), 0, 0, 0, (n, r) => {
    const x = filt(brownN(n, r, 0.999), 'lp', 40, 0.707);
    const g = 0.05 / (rms(x) || 1);
    for (let i = 0; i < n; i++) x[i] *= g;
    for (let i = 0; i < n; i++) {
      if (r() >= 8 / SR) continue;
      const a = (0.2 + 0.8 * r() * r()) * (r() < 0.5 ? -1 : 1), T = (0.3 + 1.7 * r()) * 1e-3, L = Math.ceil(T * SR);
      for (let j = 0; j < L && i + j < n; j++) x[i + j] += a * t60(j / SR, T) * (j ? white(r) : 1);
    }
    return x;
  }],
  ['Mains Hum', 'Analog', sec(2), 0, 0, 0, (n, r, sh) => { // 100 whole cycles of 50 Hz + white hiss: seamless as is
    const x = new Float64Array(n), ph = Float64Array.from({ length: 21 }, () => TAU * sh());
    for (let k = 1; k <= 20; k++) for (let i = 0; i < n; i++) x[i] += Math.sin(TAU * 50 * k * i / SR + ph[k]) / k;
    const h = whiteN(n, r), g = rms(x) * dBg(-30) / (rms(h) || 1);
    for (let i = 0; i < n; i++) x[i] += h[i] * g;
    return x;
  }, { seamless: 1 }],
  ['Radio Static', 'Analog', sec(4), 0, 0, 0, (n, r) => {
    const x = filt(filt(whiteN(n, r), 'hp', 1000, 0.707), 'lp', 4000, 0.707);
    let on = 1, left = 0, g = 0;
    const a = 1 - Math.exp(-1 / (0.003 * SR));
    for (let i = 0; i < n; i++) {
      if (left-- <= 0) { on = 1 - on; left = Math.floor((on ? 0.02 + 0.18 * r() : 0.005 + 0.075 * r()) * SR); }
      g += a * ((on ? 1 : 0.12) - g);
      x[i] *= g;
    }
    return x;
  }],
  ['Circuit Bend', 'Analog', sec(4), 0, 0, 0, (n, r) => {
    const x = new Float64Array(n), lo = Math.log2(200), hi = Math.log2(4000);
    let lr = lo + (hi - lo) * r(), ph = 0, held = white(r);
    for (let i = 0; i < n; i++) {
      lr += (r() - 0.5) * 0.004;
      if (lr < lo) lr = 2 * lo - lr; else if (lr > hi) lr = 2 * hi - lr;
      ph += Math.pow(2, lr) / SR;
      if (ph >= 1) { ph -= 1; held = white(r); }
      x[i] = held;
    }
    return x;
  }],
  ['Analog Drift', 'Analog', sec(4), 0, 0, 0, (n, r) => {
    const x = walk(n, r, 2400, -1, 1, 0.35);
    filt(x, 'lp', 3, 0.707);
    return demean(x);
  }],
  ['Bitcrush', 'Digital', N273, 0, 0, 0, (n, r) => {
    const x = new Float64Array(n);
    let v = 0;
    for (let i = 0; i < n; i++) {
      if (i % 8 === 0) { const k = Math.min(15, Math.floor(r() * 16)); v = (2 * k + 1) / 16 - 1; }
      x[i] = v;
    }
    return x;
  }],
  ['LFSR Long', 'Digital', N273, 0, 0, 0, (n, r) => lfsr(n, 15, 32000, 1 + Math.floor(r() * 32766))],
  ['LFSR Short', 'Digital', sec(1), 0, 0, 0, (n, r) => lfsr(n, 7, 127 * MIDI60_HZ, 1 + Math.floor(r() * 126))],
  ['Digital Grit', 'Digital', N273, 0, 0, 0, (n, r) => {
    const x = new Float64Array(n);
    for (let i = 0; i < n;) { const v = white(r), L = 1 + Math.floor(r() * 64); for (let j = 0; j < L && i < n; j++) x[i++] = v; }
    return x;
  }],
  ['Data Stream', 'Digital', sec(4), 0, 0, 0, (n, r) => {
    const x = new Float64Array(n);
    let gap = 0;
    for (let i = 0; i < n; i++) {
      if (gap > 0) { gap--; continue; }
      if (r() < 1 / (0.25 * SR)) { gap = Math.floor((0.02 + 0.13 * r()) * SR); continue; }
      const b = Math.floor(r() * 256);
      x[i] = (b < 128 ? b : b - 256) / 128;
    }
    return x;
  }],
  ['Modem', 'Digital', sec(4), 0, 0, 0, (n, r) => {
    const x = new Float64Array(n), spb = SR / 1200;
    let ph = 0, bit = 1;
    for (let i = 0; i < n; i++) {
      if (i % spb < 1) bit = r() < 0.5 ? 1 : 0;
      ph = frac(ph + (bit ? 1200 : 2200) / SR);
      x[i] = Math.sin(TAU * ph);
    }
    return x;
  }],
  ['Wind', 'Atmos', sec(6), 0, 0, 0, (n, r) => {
    const fc = walk(n, r, 4800, Math.log(300), Math.log(1500), 0.4), am = walk(n, r, 7200, 0.3, 1, 0.5);
    const x = sweep(whiteN(n, r), 'bp', i => Math.exp(fc[i]), 2);
    for (let i = 0; i < n; i++) x[i] *= am[i];
    return x;
  }],
  ['Rain', 'Atmos', sec(6), 0, 0, 0, (n, r) => {
    const x = pinkN(n, r), g = 0.15 / (rms(x) || 1);
    for (let i = 0; i < n; i++) x[i] *= g;
    for (let i = 0; i < n; i++) {
      if (r() >= 2000 / SR) continue;
      const f = 2000 + 6000 * r(), T = (1 + 2 * r()) * 1e-3, a = 0.1 + 0.9 * r() * r() * r();
      decaySine(x, i, f, T, a, TAU * r());
    }
    return x;
  }],
  ['Surf', 'Atmos', sec(8), 0, 0, 0, (n, r) => { // swells at 1/8 Hz (≈ 0.12 Hz): one whole swell per loop, seam at the trough
    const x = pinkN(n, r);
    const env = i => { const e = 0.5 - 0.5 * Math.cos(TAU * 0.125 * i / SR); return e * e; };
    sweep(x, 'lp', i => 400 + 5600 * env(i), 0.7);
    for (let i = 0; i < n; i++) x[i] *= 0.15 + 0.85 * env(i);
    return x;
  }],
  ['Fire', 'Atmos', sec(6), 0, 0, 0, (n, r) => {
    const x = filt(brownN(n, r, 0.999), 'lp', 300, 0.707), g = 0.25 / (rms(x) || 1);
    for (let i = 0; i < n; i++) x[i] = x[i] * g + white(r) * 0.01;
    for (let i = 0; i < n; i++) {
      if (r() >= 30 / SR) continue;
      const a = 0.3 + 0.7 * r(), T = (1 + 5 * r()) * 1e-3, L = Math.ceil(T * SR);
      let prev = 0;
      for (let j = 0; j < L && i + j < n; j++) { const w = white(r); x[i + j] += a * (w - prev) * 0.5 * t60(j / SR, T); prev = w; }
    }
    return x;
  }],
  ['Air Vent', 'Atmos', sec(4), 0, 0, 0, (n, r) => filt(whiteN(n, r), 'bp', 600, 0.7), { post: x => { // + 120 Hz hum (480 whole cycles)
    const g = rms(x) * dBg(-20) / 0.79;
    for (let i = 0; i < x.length; i++) x[i] += g * (Math.sin(TAU * 120 * i / SR) + 0.5 * Math.sin(TAU * 240 * i / SR));
    return x;
  } }],
  ['Breath', 'Tonal', sec(2), 0, 0, 0, (n, r) => harmonicBank(n, r, MIDI60_HZ, 8, k => 1 / k, 30)],
  ['Choir Air', 'Tonal', sec(2), 0, 0, 0, (n, r) => harmonicBank(n, r, MIDI60_HZ, 45, k => {
    const f = k * MIDI60_HZ, F = FORMANT_II[0];
    let a = 0.02;
    for (let j = 0; j < 3; j++) { const d = (f - F[j]) / (F[j] / 8); a += FORMANT_G[j] / (1 + d * d); }
    return a;
  }, 30)],
  ['Metal Ring', 'Tonal', sec(2), 1, 0, 0, (n, r, sh) => {
    const x = tones(n, [[1, 1], [2.76, 0.6], [5.40, 0.45], [8.93, 0.3], [13.34, 0.2]], MIDI60_HZ, 1.5, sh);
    for (let j = 0; j < sec(0.005); j++) x[j] += white(r) * 0.3 * (1 - j / sec(0.005));
    return x;
  }],
  ['Glass Tone', 'Tonal', sec(2), 1, 0, 0, (n, r, sh) => tones(n, [[1, 1], [2.32, 0.5], [4.25, 0.3], [6.63, 0.2]], 2 * MIDI60_HZ, 1, sh)],
  ['Hollow Pipe', 'Tonal', sec(2), 0, 0, 0, (n, r) => {
    const x = whiteN(n, r), D = SR / MIDI60_HZ, buf = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = i - D, k = Math.floor(p), t = p - k;
      const d = k >= 0 ? buf[k] + (k + 1 < i ? (buf[k + 1] - buf[k]) * t : 0) : 0;
      buf[i] = 0.1 * x[i] + 0.97 * d;
    }
    return buf;
  }],
  ['Click', 'Transient', sec(0.05), 1, 0, 0, () => { const x = new Float64Array(sec(0.05)); x[0] = 1; decaySine(x, 1, 3000, 0.002, 0.6); return x; }],
  ['Tick', 'Transient', sec(0.05), 1, 0, 0, () => { const x = new Float64Array(sec(0.05)); decaySine(x, 0, 6000, 0.005, 1); return x; }],
  ['Snap', 'Transient', sec(0.2), 1, 0, 0, (n, r) => {
    const x = whiteN(n, r);
    for (let i = 0; i < n; i++) x[i] *= t60(i / SR, 0.025);
    return filt(x, 'hp', 1000, 0.707);
  }],
  ['Thump', 'Transient', sec(0.3), 1, 0, 0, n => {
    const x = new Float64Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      ph += (60 + 120 * Math.exp(-t / 0.03)) / SR;
      x[i] = Math.sin(TAU * ph) * Math.exp(-t / 0.12) * Math.min(1, t / 0.001);
    }
    return x;
  }],
  ['Hat Burst', 'Transient', sec(0.3), 1, 0, 0, (n, r) => {
    const x = filt(filt(whiteN(n, r), 'hp', 7000, 0.707), 'hp', 7000, 0.707);
    for (let i = 0; i < n; i++) x[i] *= t60(i / SR, 0.06);
    return x;
  }],
  ['Pluck Noise', 'Transient', sec(0.4), 1, 0, 0, (n, r) => {
    const x = sweep(whiteN(n, r), 'lp', i => 8000 * Math.pow(500 / 8000, Math.min(1, i / SR / 0.2)), 0.7);
    for (let i = 0; i < n; i++) x[i] *= t60(i / SR, 0.4);
    return x;
  }],
  ['Riser', 'FX', sec(4), 1, 0, 0, (n, r) => riser(n, r)],
  ['Downlifter', 'FX', sec(4), 1, 0, 0, (n, r) => riser(n, r).reverse()],
  ['Whoosh', 'FX', sec(2), 1, 0, 0, (n, r) => {
    const x = pinkN(n, r);
    sweep(x, 'bp', i => 300 * Math.pow(4000 / 300, Math.sin(Math.PI * i / n)), 1.5);
    for (let i = 0; i < n; i++) { const s = Math.sin(Math.PI * i / n); x[i] *= s * s; }
    return x;
  }],
  ['Impact Tail', 'FX', sec(3), 1, 0, 0, (n, r) => {
    const x = brownN(n, r, 0.995), w = whiteN(sec(0.01), r);
    for (let i = 0; i < w.length; i++) x[i] += w[i] * 0.5 * (1 - i / w.length);
    sweep(x, 'lp', i => 8000 * Math.pow(200 / 8000, i / n), 0.707);
    for (let i = 0; i < n; i++) x[i] *= t60(i / SR, 2.5);
    return x;
  }],
  ['Laser Zap', 'FX', sec(0.5), 1, 0, 0, (n, r) => {
    const x = new Float64Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR, a = Math.exp(-t / 0.15) * Math.min(1, t / 0.001);
      ph += 4000 * Math.pow(80 / 4000, t / 0.5) / SR;
      x[i] = a * (Math.sin(TAU * ph) + 0.03 * white(r));
    }
    return x;
  }],
];

export const NOISES = Object.freeze(NOISE_DEF.map(([name, cat, len, oneshot]) =>
  Object.freeze({ id: 'noise:' + name, name, cat, oneshot, seconds: Math.round(len / SR * 1000) / 1000 })));

function loopXfade(x, len) { // x has len + XFADE samples → seamless loop of len samples
  const o = new Float64Array(len);
  o.set(x.subarray(0, len));
  for (let i = 0; i < XFADE && i < len; i++) {
    const t = i / XFADE;
    o[i] = x[i] * Math.sin(HALF_PI * t) + x[len + i] * Math.cos(HALF_PI * t);
  }
  return o;
}
function endFade(x) {
  const F = Math.min(sec(0.03), Math.floor(x.length / 10));
  for (let j = 0; j < F; j++) { const g = 0.5 - 0.5 * Math.cos(Math.PI * j / F); x[x.length - 1 - j] *= g * g; }
}

// Generates a factory noise source without caching: { name, ch, len, rate, root, oneshot, L, R } (Float32Array data).
export function generateNoise(id) {
  id = String(id);
  const d = NOISE_DEF.find(s => 'noise:' + s[0] === id);
  if (!d) return null;
  const [name, , len, oneshot, colour, mono, gen, opt = {}] = d;
  const seed = fnv1a32(id), ch = mono ? 1 : 2, chans = [], plain = oneshot || opt.seamless;
  for (let c = 0; c < ch; c++) {
    const rnd = mulberry32(c ? seed ^ 0x9E3779B9 : seed), sh = mulberry32(seed ^ 0x85EBCA6B);
    const n = plain ? len : len + XFADE;
    let x = gen(n, rnd, sh);
    if (x.length !== n) { const y = new Float64Array(n); y.set(x.subarray(0, n)); x = y; }
    if (!plain) x = loopXfade(x, len);
    if (opt.post) x = opt.post(x, sh);
    if (oneshot) endFade(x);
    chans.push(x);
  }
  let pk = 0;
  for (const x of chans) pk = Math.max(pk, peakOf(x));
  // colours: RMS −12 dBFS per channel; everything else: joint peak −1 dBFS
  const out = chans.map(x => scaled(x, colour ? dBg(-12) / (rms(x) || 1) : dBg(-1) / (pk || 1)));
  return { name, ch, len, rate: SR, root: 60, oneshot, loopStart: 0, loopEnd: len, L: out[0], R: ch === 2 ? out[1] : null };
}

const NOISE_CACHE = new Map(); // id → { src, levels }
export function makeNoise(id) {
  let c = NOISE_CACHE.get(id);
  if (!c) {
    const src = generateNoise(id);
    if (!src) return null;
    c = { src, levels: noiseLevels(src.L, src.R, src.len, 0, src.len, !src.oneshot) }; // one-shots: linear (no wrap)
    NOISE_CACHE.set(id, c);
  }
  const s = c.src;
  return {
    t: 'wt', id, v: 1, kind: 'noise', rate: s.rate, ch: s.ch, root: s.root, len: s.len, loopStart: 0, loopEnd: s.len,
    levels: c.levels.map(l => ({ len: l.len, loopStart: l.loopStart, loopEnd: l.loopEnd, L: l.L.slice(), R: l.R ? l.R.slice() : null })),
  };
}

/* ------------------------------------------------------------ noise levels (§7.9) */

function besselI0(x) { let s = 1, t = 1; for (let k = 1; k < 50; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; if (t < 1e-17 * s) break; } return s; }
const HB = (() => { // 63-tap half-band, Kaiser β = 9, unity DC gain
  const M = 31, h = new Float64Array(2 * M + 1), i0 = besselI0(9);
  for (let n = -M; n <= M; n++) {
    const w = besselI0(9 * Math.sqrt(1 - (n / M) * (n / M))) / i0;
    h[n + M] = n === 0 ? 0.5 : n % 2 ? Math.sin(HALF_PI * n) / (Math.PI * n) * w : 0;
  }
  let s = 0;
  for (let i = 0; i < h.length; i++) s += h[i];
  for (let i = 0; i < h.length; i++) h[i] /= s;
  return h;
})();
export const HALFBAND = HB;

// Kaiser half-band evaluated between its taps (circular decimation of odd-length loops), tabulated at 1/256 sample.
let HBC = null;
function hbCont() {
  if (HBC) return HBC;
  const M = 31, RES = 256, n = (M + 1) * RES, t = new Float64Array(n + 2), i0 = besselI0(9);
  for (let j = 0; j <= n; j++) {
    const x = j / RES, u = x / M;
    t[j] = u >= 1 ? 0 : x === 0 ? 0.5 : Math.sin(HALF_PI * x) / (Math.PI * x) * besselI0(9 * Math.sqrt(1 - u * u)) / i0;
  }
  return (HBC = t);
}
// Circular decimation of an odd-length loop: n = round(len/2) outputs spread evenly over the loop (spacing len/n
// input samples), so the level stays seamless; its loop is ≤ ½ sample (of that level) longer than len/2.
function halfDownOdd(x, len) {
  const n = Math.round(len / 2), step = len / n, T = hbCont(), RES = 256, lim = 32 * RES, y = new Float32Array(n);
  for (let m = 0; m < n; m++) {
    const pos = m * step, i = Math.floor(pos), d = pos - i;
    let acc = 0, ws = 0;
    for (let k = -31; k <= 32; k++) {
      const t = Math.abs(k - d) * RES, j = Math.floor(t);
      if (j >= lim) continue;
      const w = T[j] + (T[j + 1] - T[j]) * (t - j);
      let ix = (i + k) % len;
      if (ix < 0) ix += len;
      acc += w * x[ix]; ws += w;
    }
    y[m] = ws !== 0 ? acc / ws : 0;
  }
  return y;
}
function halfDown(x, len, circ) {
  const n2 = circ ? len >> 1 : (len + 1) >> 1, y = new Float32Array(n2), c0 = HB[31];
  for (let m = 0; m < n2; m++) {
    const c = 2 * m;
    let acc = c0 * x[c];
    for (let k = 1; k <= 31; k += 2) {
      let a = c - k, b = c + k, xa, xb;
      if (circ) { xa = x[a < 0 ? a + len : a]; xb = x[b >= len ? b - len : b]; }
      else { xa = a >= 0 ? x[a] : 0; xb = b < len ? x[b] : 0; }
      acc += HB[31 + k] * (xa + xb);
    }
    y[m] = acc;
  }
  return y;
}
// exact2 (Phase 2, a maxLevels call): a level ℓ whose step 2^ℓ does not divide len holds ⌈len/2^ℓ⌉ samples of the
// band-limited loop at level-0 positions m·2^ℓ (every level steps by exactly 2×, as the sample engines read it,
// §9.4.3); levels with an exact step are the Phase-1 ones.
function exactLevels(chs, len, maxL, exact2) { // single-cycle loop: exact FFT band-limit per level
  const specs = chs.map(x => (x ? rfft(Float64Array.from(x)) : null)), out = [];
  for (let l = 0; l < maxL; l++) {
    const step = Math.pow(2, l), off = exact2 && len % step !== 0;
    const n = l === 0 ? len : off ? Math.ceil(len / step) : Math.round(len / step);
    if (l > 0 && n < 64) break;
    const lv = { len: n, loopStart: 0, loopEnd: n, L: null, R: null };
    chs.forEach((x, c) => {
      if (!x) return;
      let data;
      if (l === 0) data = Float32Array.from(x);
      else if (off) { // harmonics below the level's Nyquist (len/2^(ℓ+1) per loop), sampled every 2^ℓ level-0 samples
        const S = specs[c], H = Math.ceil(len / (2 * step)) - 1, nb = (len >> 1) + 1;
        const re = new Float64Array(nb), im = new Float64Array(nb);
        for (let k = 0; k <= H; k++) { re[k] = S.re[k]; im[k] = S.im[k]; }
        const full = irfft(re, im, len);
        data = new Float32Array(n);
        for (let m = 0; m < n; m++) data[m] = full[m * step];
      } else {
        const S = specs[c], H = Math.ceil(n / 2) - 1, s = n / len;
        const re = new Float64Array((n >> 1) + 1), im = new Float64Array((n >> 1) + 1);
        for (let k = 0; k <= H; k++) { re[k] = S.re[k] * s; im[k] = S.im[k] * s; }
        data = Float32Array.from(irfft(re, im, n));
      }
      if (c === 0) lv.L = data; else lv.R = data;
    });
    out.push(lv);
  }
  return out;
}
// Phase 2 whole-loop levels above a level x of odd length N (one exact period; §9.4.3): level j (1…J above x) holds
// ⌈N/2^j⌉ samples at positions m·2^j of x's periodic continuation — the Phase-1 half-band cascade run over that
// continuation with margins wide enough that no output sees an edge, so every level steps by exactly 2×.
function wholeCascade(x, N, J) {
  const M = new Array(J + 1);
  M[J] = 0;
  for (let j = J - 1; j >= 0; j--) M[j] = 2 * M[j + 1] + 32;
  let prev = new Float32Array(N + 2 * M[0]);
  for (let i = 0; i < prev.length; i++) { let k = (i - M[0]) % N; if (k < 0) k += N; prev[i] = x[k]; }
  const out = [], c0 = HB[31];
  for (let j = 1, nj = N; j <= J; j++) {
    nj = Math.ceil(nj / 2);
    const Mj = M[j], Mp = M[j - 1], cur = new Float32Array(nj + 2 * Mj);
    for (let i = 0; i < cur.length; i++) {
      const c = 2 * (i - Mj) + Mp;
      let acc = c0 * prev[c];
      for (let k = 1; k <= 31; k += 2) acc += HB[31 + k] * (prev[c - k] + prev[c + k]);
      cur[i] = acc;
    }
    out.push(cur.slice(Mj, Mj + nj));
    prev = cur;
  }
  return out;
}

function finiteCopy(x, len) { // Float32 copy of the first len samples, non-finite samples → 0
  const o = Float32Array.from(x.subarray ? x.subarray(0, len) : x.slice(0, len));
  for (let i = 0; i < o.length; i++) if (!Number.isFinite(o[i])) o[i] = 0;
  return o;
}

// §7.9 level builder. L/R: level-0 samples (R may be null), loop points in samples, loopsWhole = the source loops over
// its whole length (circular filtering, any length); otherwise linear (zero-padded) filtering, so a one-shot's attack
// never wraps onto its end. Non-finite samples are replaced by 0. maxLevels (Phase 2, §9.4.3/§11.13): the number of
// levels at most (1–8; absent / not positive = 6, the Phase-1 count); levels also stop before one would be shorter
// than 64 samples. With maxLevels, a whole-length loop's level ℓ always holds ⌈len/2^ℓ⌉ samples at level-0 positions
// m·2^ℓ (exactly 2× per level, also for loop lengths not divisible by 2^ℓ); without it, Phase 1 bit for bit.
export function noiseLevels(L, R, len, loopStart, loopEnd, loopsWhole, maxLevels) {
  len = len | 0;
  const p2 = maxLevels > 0, maxL = p2 ? Math.min(8, Math.floor(maxLevels)) || 1 : 6;
  const ls0 = clamp(Math.round(fin(loopStart)), 0, Math.max(0, len - 1)), le0 = clamp(Math.round(fin(loopEnd) || len), ls0 + 1, len);
  const L0 = finiteCopy(L, len), R0 = R ? finiteCopy(R, len) : null;
  if (loopsWhole && len < 8192) return exactLevels([L0, R0], len, maxL, p2);
  const out = [{ len, loopStart: ls0, loopEnd: le0, L: L0, R: R0 }];
  const dec = (x, n, circ) => (circ && (n & 1) ? halfDownOdd(x, n) : halfDown(x, n, circ));
  while (out.length < maxL) {
    const p = out[out.length - 1];
    if ((p.len >> 1) < 64) break;
    const circ = !!loopsWhole;
    if (circ && p2 && (p.len & 1)) { // Phase 2: an odd loop length → exact 2× steps over its periodic continuation
      let J = 0;
      for (let k = p.len; out.length + J < maxL && (k >> 1) >= 64; k = Math.ceil(k / 2)) J++;
      const lv = wholeCascade(p.L, p.len, J), rv = p.R ? wholeCascade(p.R, p.len, J) : null;
      lv.forEach((d, j) => out.push({ len: d.length, loopStart: 0, loopEnd: d.length, L: d, R: rv ? rv[j] : null }));
      break;
    }
    const nl = dec(p.L, p.len, circ), nr = p.R ? dec(p.R, p.len, circ) : null, n = nl.length;
    let ls = Math.round(p.loopStart / 2), le = Math.min(n, Math.round(p.loopEnd / 2));
    if (ls >= le) ls = Math.max(0, le - 1);
    out.push({ len: n, loopStart: ls, loopEnd: le, L: nl, R: nr });
  }
  return out;
}

const asF32 = b => (b == null ? null : ArrayBuffer.isView(b) ? Float32Array.from(b) : b instanceof ArrayBuffer || (b && typeof b.byteLength === 'number' && !ArrayBuffer.isView(b)) ? new Float32Array(b.slice(0)) : Float32Array.from(b));

// Whether a record without loop information most likely loops over its whole length: both ends carry comparable
// energy (within 20 dB). A one-shot that fades or decays (or swells into a cut) fails this and is decimated linearly.
function edgesMatch(L, R, len) {
  const W = Math.max(1, Math.min(4096, Math.floor(len / 8)));
  let a = 0, b = 0, pk = 0;
  for (const x of [L, R]) {
    if (!x) continue;
    for (let i = 0; i < W; i++) { a += x[i] * x[i]; b += x[len - 1 - i] * x[len - 1 - i]; }
    for (let i = 0; i < len; i++) { const v = Math.abs(x[i]); if (v > pk) pk = v; }
  }
  const quiet = 1e-8 * pk * pk * W; // both ends silent → nothing to wrap either way
  if (!(a > quiet) && !(b > quiet)) return false;
  return a > 0 && b > 0 && a / b < 100 && b / a < 100;
}

// Builds a §7.5 noise entry from a wtstore record (ArrayBuffers), a frameToNoise/lfoToNoise result or an entry.
// Whole-length loop decision: an explicit `loopWhole` (1 = loops over the whole file, as frameToNoise/lfoToNoise
// results; 0 = does not) wins; a loop that is a proper sub-range is not whole; otherwise (no loop information, e.g.
// a WAV without a smpl loop) the ends are compared (edgesMatch).
export function noiseEntry(rec) {
  if (!rec) return null;
  let L, R;
  if (Array.isArray(rec.levels) && rec.levels[0]) { L = asF32(rec.levels[0].L); R = asF32(rec.levels[0].R); }
  else { L = asF32(rec.L); R = asF32(rec.R); }
  if (!L || !L.length) return null;
  const ch = rec.ch === 2 && R ? 2 : 1, len = L.length;
  if (ch === 1) R = null;
  const ls = clamp(Math.round(fin(rec.loopStart)), 0, len - 1), le = clamp(Math.round(fin(rec.loopEnd) || len), ls + 1, len);
  const lw = rec.loopWhole, whole = ls === 0 && le === len;
  const loopsWhole = whole && (lw === 1 || lw === true ? true : lw === 0 || lw === false ? false : edgesMatch(L, R, len));
  return {
    t: 'wt', id: rec.id, v: 1, kind: 'noise', rate: rec.rate > 0 ? +rec.rate : SR, ch, root: Number.isFinite(rec.root) ? rec.root : 60,
    len, loopStart: ls, loopEnd: le, levels: noiseLevels(L, R, len, ls, le, loopsWhole),
  };
}

// "Send to Noise Oscillator" (inv A10.5): a 1-cycle loop playing at MIDI 60 with keytrack on and PITCH 50 %.
export function frameToNoise(frame, name) {
  const L = Float32Array.from(frame.length === FRAME ? frame : resampleCycle(frame));
  return { kind: 'noise', name: name || 'Single Cycle', rate: FRAME * MIDI60_HZ, ch: 1, root: 60, len: FRAME, loopStart: 0, loopEnd: FRAME, loopWhole: 1, L, R: null };
}
export function lfoToNoise(tab, name) { return frameToNoise(ptsToFrame(tab), name || 'LFO Shape'); }

/* ================================================================== WAV I/O (§8.2.1, §8.2.2) */

const CLM_RE = /<!>(\d+)\s+(\d)(\d)/;
export function parseClm(text) {
  const m = CLM_RE.exec(String(text == null ? '' : text));
  if (!m) return null;
  const size = parseInt(m[1], 10);
  if (!(size > 0)) return null;
  return { size, morph: +m[2], factory: +m[3] };
}
export function clmText(o) {
  const size = Math.max(1, Math.round(+(o && o.size) || FRAME)), morph = clamp((o && o.morph) | 0, 0, 9), factory = clamp((o && o.factory) | 0, 0, 9);
  return `<!>${size} ${morph}${factory}000000 wavetable (www.xferrecords.com)`;
}

export function parseTxtOverride(text) {
  const lines = String(text == null ? '' : text).split(/\r?\n/).map(s => s.trim()).filter(s => s.length);
  if (!lines.length) return null;
  const m = /^\[?\s*(\d+)\s*\]?$/.exec(lines[0]);
  if (!m) return null;
  const size = parseInt(m[1], 10);
  if (size < 32 || size > 9999) return null;
  const interp = lines[1] && /no\s*interp/i.test(lines[1]) ? 0 : 1;
  return { size, interp };
}

const NOTE_SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
export function noteHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
export function parseSplitSize(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return null;
  let m = /^(\d+(?:\.\d+)?)$/.exec(t);
  if (m) { const v = parseFloat(m[1]); return v >= 1 && v <= 9999 ? (Number.isInteger(v) ? v : Math.round(v * 100) / 100) : null; }
  m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(t);
  if (!m) return null;
  const midi = 12 * (parseInt(m[3], 10) + 1) + NOTE_SEMI[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const v = Math.round(44100 / noteHz(midi));
  return v >= 1 && v <= 9999 ? v : null;
}
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// sr (Phase 2, FREQUENCY ESTIMATION): the rate the N samples are counted at (default 44100 Hz, Phase 1).
export function splitMsg(N, sr) {
  const hz = (sr > 0 ? +sr : 44100) / N, m = 69 + 12 * Math.log2(hz / 440), r = Math.round(m), ct = Math.round((m - r) * 100);
  return `split at: ${+(+N).toFixed(2)} samples (${hz.toFixed(2)} Hz, ${NOTE_NAMES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1} ${ct >= 0 ? '+' : '-'} ${Math.abs(ct)} cents)`;
}

function str4(dv, o) { return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3)); }
const okId = (dv, o) => { // a plausible chunk header at o: printable id and a length that fits (data may be truncated)
  if (o + 8 > dv.byteLength) return false;
  for (let i = 0; i < 4; i++) { const c = dv.getUint8(o + i); if (c < 32 || c > 126) return false; }
  return dv.getUint32(o + 4, true) <= dv.byteLength - o - 8 || str4(dv, o) === 'data';
};

export function readWav(buf) {
  if (ArrayBuffer.isView(buf)) buf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  if (!buf || typeof buf.byteLength !== 'number' || buf.byteLength < 12) throw new Error('Not a WAV file');
  const dv = new DataView(buf), size = buf.byteLength;
  if (str4(dv, 0) !== 'RIFF' || str4(dv, 8) !== 'WAVE') throw new Error('Not a WAV file');
  let fmt = null, data = null, clm = null, loop = null, pos = 12;
  while (pos + 8 <= size) {
    const id = str4(dv, pos), len = dv.getUint32(pos + 4, true), body = pos + 8;
    const end = Math.min(size, body + len);
    if (id === 'fmt ' && end - body >= 16) {
      fmt = { tag: dv.getUint16(body, true), nch: dv.getUint16(body + 2, true), sr: dv.getUint32(body + 4, true), align: dv.getUint16(body + 12, true), bits: dv.getUint16(body + 14, true) };
      if (fmt.tag === 0xFFFE && end - body >= 26) fmt.tag = dv.getUint16(body + 24, true);
    } else if (id === 'data') {
      data = { off: body, len: end - body };
    } else if (id === 'clm ') {
      let t = '';
      for (let i = body; i < end; i++) t += String.fromCharCode(dv.getUint8(i));
      clm = parseClm(t);
    } else if (id === 'smpl' && end - body >= 36) {
      const n = dv.getUint32(body + 28, true);
      if (n > 0 && end - body >= 36 + 24) {
        const s = dv.getUint32(body + 36 + 8, true), e = dv.getUint32(body + 36 + 12, true);
        if (e >= s) loop = { start: s, end: e + 1 };
      }
    }
    if (id === 'data' && len === 0xFFFFFFFF) break;
    let next = body + len + (len & 1);
    if ((len & 1) && !okId(dv, next) && okId(dv, next - 1)) next--; // writer omitted the pad byte
    if (next <= pos) break;
    pos = next;
  }
  if (!fmt || !data) throw new Error('Not a WAV file');
  const nch = fmt.nch, bps = nch ? Math.floor(fmt.align / nch) : 0;
  const float = fmt.tag === 3;
  if (!nch || !(fmt.tag === 1 || float) || !(float ? bps === 4 || bps === 8 : bps >= 1 && bps <= 4)) throw new Error('Unsupported WAV format');
  const frames = Math.floor(data.len / fmt.align), ch = [];
  for (let c = 0; c < nch; c++) ch.push(new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const o = data.off + i * fmt.align + c * bps;
      let v;
      if (float) { v = bps === 4 ? dv.getFloat32(o, true) : dv.getFloat64(o, true); if (!Number.isFinite(v)) v = 0; } // NaN/Inf → 0
      else if (bps === 1) v = (dv.getUint8(o) - 128) / 128;
      else if (bps === 2) v = dv.getInt16(o, true) / 32768;
      else if (bps === 3) { let x = dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getUint8(o + 2) << 16); if (x & 0x800000) x -= 0x1000000; v = x / 8388608; }
      else v = dv.getInt32(o, true) / 2147483648;
      ch[c][i] = v;
    }
  }
  if (loop && (loop.start >= frames || loop.end > frames)) loop = loop.start < frames ? { start: loop.start, end: frames } : null;
  return { sr: fmt.sr, bits: fmt.bits || bps * 8, float, ch, clm, loop };
}

export function writeWav(o) {
  const chs = (o && o.ch) || [], nch = Math.max(1, chs.length), n = chs.reduce((m, c) => Math.max(m, c ? c.length : 0), 0);
  const float = !!o.float, bits = float ? (o.bits === 64 ? 64 : 32) : [8, 16, 24, 32].includes(o.bits) ? o.bits : 16;
  const bps = bits / 8, align = nch * bps, dataLen = n * align, sr = Math.round(o.sr || 44100);
  const clmStr = o.clm ? clmText(o.clm) : null, loop = o.loop && o.loop.end > o.loop.start ? o.loop : null;
  const fmtLen = float ? 18 : 16;
  const chunk = l => 8 + l + (l & 1);
  const total = 12 + chunk(fmtLen) + (float ? chunk(4) : 0) + (clmStr ? chunk(clmStr.length) : 0) + (loop ? chunk(60) : 0) + chunk(dataLen);
  const buf = new ArrayBuffer(total), dv = new DataView(buf);
  let p = 0;
  const id = s => { for (let i = 0; i < 4; i++) dv.setUint8(p++, s.charCodeAt(i)); };
  const u32 = v => { dv.setUint32(p, v >>> 0, true); p += 4; }, u16 = v => { dv.setUint16(p, v, true); p += 2; };
  id('RIFF'); u32(total - 8); id('WAVE');
  id('fmt '); u32(fmtLen); u16(float ? 3 : 1); u16(nch); u32(sr); u32(sr * align); u16(align); u16(bits);
  if (float) { u16(0); id('fact'); u32(4); u32(n); }
  if (clmStr) {
    id('clm '); u32(clmStr.length);
    for (let i = 0; i < clmStr.length; i++) dv.setUint8(p++, clmStr.charCodeAt(i) & 255);
    if (clmStr.length & 1) dv.setUint8(p++, 0);
  }
  if (loop) {
    id('smpl'); u32(60);
    u32(0); u32(0); u32(Math.round(1e9 / sr)); u32(60); u32(0); u32(0); u32(0); u32(1); u32(0);
    u32(0); u32(0); u32(loop.start); u32(loop.end - 1); u32(0); u32(0);
  }
  id('data'); u32(dataLen);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const src = chs[c], v = src && i < src.length ? fin(+src[i]) : 0;
      if (float) { if (bits === 32) dv.setFloat32(p, v, true); else dv.setFloat64(p, v, true); }
      else if (bits === 8) dv.setUint8(p, clamp(Math.round(v * 128 + 128), 0, 255));
      else if (bits === 16) dv.setInt16(p, clamp(Math.round(v * 32768), -32768, 32767), true);
      else if (bits === 24) { const x = clamp(Math.round(v * 8388608), -8388608, 8388607) & 0xFFFFFF; dv.setUint8(p, x & 255); dv.setUint8(p + 1, (x >> 8) & 255); dv.setUint8(p + 2, (x >> 16) & 255); }
      else dv.setInt32(p, clamp(Math.round(v * 2147483648), -2147483648, 2147483647), true);
      p += bps;
    }
  }
  return buf;
}

/* ================================================================== imports (§8.2.5) */

function yinTrack(x) {
  const n = x.length, W = Math.min(2048, n >> 1), tauMax = Math.min(1024, W), out = [];
  if (W < 32) return out;
  let N = 1;
  while (N < W + tauMax) N <<= 1;
  const sq = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sq[i + 1] = sq[i] + x[i] * x[i];
  const hop = 512, d = new Float64Array(tauMax), dn = new Float64Array(tauMax);
  for (let pos = 0; pos + W + tauMax <= n; pos += hop) {
    const e0 = sq[pos + W] - sq[pos];
    if (e0 < 1e-9 * W) { out.push({ c: pos + W / 2, P: 0 }); continue; }
    const ar = new Float64Array(N), ai = new Float64Array(N), br = new Float64Array(N), bi = new Float64Array(N);
    for (let j = 0; j < W; j++) ar[j] = x[pos + j];
    for (let j = 0; j < W + tauMax; j++) br[j] = x[pos + j];
    fftCore(ar, ai, false); fftCore(br, bi, false);
    for (let k = 0; k < N; k++) { const r = ar[k] * br[k] + ai[k] * bi[k], i = ar[k] * bi[k] - ai[k] * br[k]; ar[k] = r; ai[k] = i; }
    fftCore(ar, ai, true);
    let run = 0;
    dn[0] = 1;
    for (let t = 1; t < tauMax; t++) {
      d[t] = e0 + (sq[pos + t + W] - sq[pos + t]) - 2 * ar[t];
      run += d[t];
      dn[t] = run > 0 ? d[t] * t / run : 1;
    }
    let tau = -1;
    for (let t = 2; t < tauMax - 1; t++) {
      if (dn[t] < 0.15) { // deepest point within 20 % above the first dip (strong high partials make the dip ripple)
        tau = t;
        for (let u = t + 1, e = Math.min(tauMax - 2, Math.floor(t * 1.2)); u <= e; u++) if (dn[u] < dn[tau]) tau = u;
        break;
      }
    }
    if (tau < 0) { out.push({ c: pos + W / 2, P: 0 }); continue; }
    const a = dn[tau - 1], b = dn[tau], c = dn[tau + 1], den = a - 2 * b + c;
    const P = tau + (Math.abs(den) > 1e-12 ? clamp(0.5 * (a - c) / den, -1, 1) : 0);
    out.push({ c: pos + W / 2, P });
  }
  return out;
}
function median(a) { const s = a.slice().sort((p, q) => p - q), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m])) : 0; }
function periodMap(track) { // → P(t): linear between voiced analysis centres, held at the ends; null if nothing voiced
  const v = track.filter(f => f.P > 0);
  if (!v.length) return null;
  return t => {
    if (t <= v[0].c) return v[0].P;
    if (t >= v[v.length - 1].c) return v[v.length - 1].P;
    let lo = 0, hi = v.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (v[m].c <= t) lo = m; else hi = m; }
    return v[lo].P + (v[hi].P - v[lo].P) * (t - v[lo].c) / (v[hi].c - v[lo].c);
  };
}
function upZero(x, from, to) { // nearest upward zero crossing to `target` handled by caller; returns all in range
  const out = [];
  for (let i = Math.max(1, Math.ceil(from)); i <= Math.min(x.length - 1, Math.floor(to)); i++) {
    if (x[i - 1] < 0 && x[i] >= 0) out.push(i - 1 + x[i - 1] / (x[i - 1] - x[i]));
  }
  return out;
}
function pickEven(list, max = MAX_FRAMES) {
  if (list.length <= max) return list;
  const out = [];
  for (let j = 0; j < max; j++) out.push(list[Math.round(j * (list.length - 1) / (max - 1))]);
  return out;
}
function normSame(frames) {
  let p = 0;
  for (const f of frames) p = Math.max(p, peakOf(f));
  return p > 0 ? frames.map(f => scaled(f, 1 / p)) : frames;
}
function stft(x, N) {
  const hop = N / 2, w = new Float64Array(N);
  let ws = 0;
  for (let i = 0; i < N; i++) { w[i] = 0.5 - 0.5 * Math.cos(TAU * i / N); ws += w[i]; }
  const count = Math.max(1, Math.floor((x.length - N) / hop) + 1), starts = pickEven(FRAMES(count).map(k => k * hop));
  return starts.map(s => {
    const seg = new Float64Array(N);
    for (let i = 0; i < N; i++) seg[i] = (s + i < x.length ? x[s + i] : 0) * w[i];
    const X = rfft(seg), H = Math.min(1023, N / 2);
    const mag = new Float64Array(1024), ph = new Float64Array(1024);
    for (let k = 1; k <= H; k++) {
      mag[k - 1] = Math.sqrt(2 * Math.hypot(X.re[k], X.im[k]) / ws);
      ph[k - 1] = frac((Math.atan2(X.im[k], X.re[k]) + HALF_PI) / TAU + 0.5);
    }
    return fromSpectrum(mag, ph);
  });
}

function rawFrames(x, size) {
  const K = Math.floor(x.length / size), out = [];
  if (K < 1) return [resampleCycle(x)]; // shorter than one declared frame: the whole file is the cycle
  for (const k of pickEven(FRAMES(K))) {
    const seg = x.subarray(k * size, (k + 1) * size);
    out.push(size === FRAME ? Float32Array.from(seg) : resampleCycle(seg));
  }
  return out;
}

export const IMPORT_MODES = Object.freeze(['auto', 'clm', 'zeroSnap', 'pitchFollow', 'pitchAvg', 'manual', 'fft256', 'fft512', 'fft1024', 'fft2048']);
// §8.2.5. opts = { mode: 'auto'|'clm'|'zeroSnap'|'pitchFollow'|'pitchAvg'|'manual'|'fft256'…'fft2048', size (split size),
// channel (0 = first, 1 = right), txt ({size, interp} from parseTxtOverride), name }.
export function tableFromWav(wav, opts = {}) {
  const chs = (wav && wav.ch) || [];
  if (!chs.length || !chs[0].length) throw new Error('Empty audio file');
  const x = chs[opts.channel === 1 && chs.length > 1 ? 1 : 0];
  const name = opts.name || 'Import';
  let mode = IMPORT_MODES.includes(opts.mode) ? opts.mode : 'auto';
  const fftN = /^fft(256|512|1024|2048)$/.exec(mode);
  const done = (frames, morph, extra) => Object.assign({ name, frames: frames.length ? frames : [new Float32Array(FRAME)], morph, factory: 0 }, extra);
  if (fftN) return done(normSame(stft(x, +fftN[1])), 0);
  if (wav.clm && wav.clm.size > 0) return done(rawFrames(x, wav.clm.size), clamp(wav.clm.morph | 0, 0, 4));
  if (opts.txt && opts.txt.size >= 1) return done(rawFrames(x, opts.txt.size), opts.txt.interp ? 1 : 0);
  const split = opts.size != null ? parseSplitSize(opts.size) : null;
  if (split) mode = 'manual';
  // §8.2.2 default import: without clm / .txt / split size, a whole multiple of 2048 (≤ 256 frames) is raw 2048-frames
  // in every (non-FFT) mode; only otherwise the chosen mode applies
  else if (x.length % FRAME === 0 && x.length <= MAX_FRAMES * FRAME) return done(rawFrames(x, FRAME), 0);
  if (mode === 'auto' || mode === 'clm') mode = 'pitchAvg';
  if (mode === 'manual') {
    const P = split || parseSplitSize(opts.size);
    if (!P) throw new Error('Enter a split size (1–9999 samples or a note name)');
    const K = Math.floor(x.length / P);
    if (K < 1) return done([cycleAt(x, 0, x.length)], 0, { importMsg: splitMsg(P) });
    return done(normSame(pickEven(FRAMES(K)).map(k => cycleAt(x, k * P, P))), 0, { importMsg: splitMsg(P) });
  }
  const track = yinTrack(x), Pm = periodMap(track);
  if (!Pm) { // nothing voiced: plain 2048 frames
    return done(normSame(x.length >= FRAME ? rawFrames(x, FRAME) : [resampleCycle(x)]), 0, { importMsg: 'no pitch detected' });
  }
  if (mode === 'pitchAvg') {
    const P = median(track.filter(f => f.P > 0).map(f => f.P)), K = Math.floor(x.length / P);
    const frames = K >= 1 ? pickEven(FRAMES(K)).map(k => cycleAt(x, k * P, P)) : [cycleAt(x, 0, P)];
    return done(normSame(frames), 0, { importSize: P, importMsg: splitMsg(P) });
  }
  // zeroSnap / pitchFollow: variable cycles from the pitch map
  const snap = mode === 'zeroSnap', segs = [];
  let t = 0;
  if (snap) { const z = upZero(x, 1, Math.min(x.length - 1, Pm(0) * 1.5)); if (z.length) t = z[0]; }
  while (segs.length < 100000) {
    const P = Pm(t);
    let nx = t + P;
    if (snap) {
      const z = upZero(x, nx - 0.1 * P, nx + 0.1 * P);
      if (z.length) nx = z.reduce((b, v) => (Math.abs(v - (t + P)) < Math.abs(b - (t + P)) ? v : b), z[0]);
    }
    if (nx + 2 > x.length || nx <= t + 1) break;
    segs.push([t, nx - t]);
    t = nx;
  }
  if (!segs.length) segs.push([0, Math.min(x.length, Pm(0))]);
  return done(normSame(pickEven(segs).map(([s, P]) => cycleAt(x, s, P))), 0);
}

// FREQUENCY ESTIMATION (§11.13, inv B11): the period (samples of the file, fractional) of the first channel, or null
// when no period of 2–9999 samples (the split-size field's range) is found: silence, noise, a single cycle, < 64
// samples. YIN (difference function through an FFT cross-correlation, cumulative-mean normalisation, threshold 0.15;
// the deepest point within 20 % above the first dip, followed to its bottom; an exactly periodic dip — d = 0 at an
// integer lag — is that integer):
//   (A) full rate, ≤ 48 evenly spaced windows of 2048 samples, lags < 1024 (the pitchAvg analysis' range);
//   (B) only when A is voiced in fewer than half of its windows and longer periods fit the file, lags up to 10 032:
//       files ≤ 32 768 samples at full rate (≤ 4 windows of up to 10 240 samples; two cycles are enough); longer files
//       decimated by 8 (three Phase-1 half-band stages, ≤ 24 windows of 1280, away from the file's ends), each coarse
//       period refined at full rate (raw difference-function minimum within ±20 lags, parabolic interpolation).
// A dip still falling at a pass's lag limit is unvoiced, never a period. The pass voiced in the larger share of its
// windows gives the median (ties: A). Every buffer is allocated once per call; the work is bounded whatever the
// file's length.
const EST_THR = 0.15, EST_MAXP = 9999, EST_EXACT = 1e-9;
function yinWindow(x, pos, W, T, B) { // → the period at x[pos…] (fractional lags) or 0 (unvoiced)
  const N = B.N, ar = B.ar, ai = B.ai, br = B.br, bi = B.bi, dn = B.dn;
  let e0 = 0;
  for (let j = 0; j < W; j++) { const v = x[pos + j]; e0 += v * v; }
  if (!(e0 >= 1e-9 * W)) return 0;
  for (let j = 0; j < N; j++) { ar[j] = j < W ? x[pos + j] : 0; br[j] = j < W + T ? x[pos + j] : 0; ai[j] = 0; bi[j] = 0; }
  fftCore(ar, ai, false); fftCore(br, bi, false);
  for (let k = 0; k < N; k++) { const r = ar[k] * br[k] + ai[k] * bi[k], i = ar[k] * bi[k] - ai[k] * br[k]; ar[k] = r; ai[k] = i; }
  fftCore(ar, ai, true);
  let et = e0, run = 0;
  dn[0] = 1;
  for (let t = 1; t < T; t++) { // d(t) = Σ (x[j] − x[j + t])² over the window = e0 + e_t − 2 r(t)
    const a = x[pos + t - 1], b = x[pos + t + W - 1];
    et += b * b - a * a;
    const d = Math.max(0, e0 + et - 2 * ar[t]);
    run += d;
    dn[t] = run > 0 ? d * t / run : 1;
  }
  let tau = -1;
  for (let t = 2; t < T - 2; t++) {
    if (dn[t] < EST_THR) {
      tau = t;
      for (let u = t + 1, e = Math.min(T - 2, Math.floor(t * 1.2)); u <= e; u++) if (dn[u] < dn[tau]) tau = u;
      while (tau < T - 2 && dn[tau + 1] < dn[tau]) tau++;
      break;
    }
  }
  if (tau < 0 || tau >= T - 2) return 0; // nothing below the threshold, or a dip that runs into the lag limit
  return vertex(dn[tau - 1], dn[tau], dn[tau + 1], tau);
}
function vertex(a, b, c, t) { // parabolic interpolation of a minimum b at t (exactly periodic: t itself)
  if (b <= EST_EXACT * Math.max(a, c)) return t;
  const den = a - 2 * b + c;
  return t + (Math.abs(den) > 1e-12 ? clamp(0.5 * (a - c) / den, -1, 1) : 0);
}
function dec8(x, n, s, L, B) { // B.z[i] = x decimated by 8 at position s + 8i (i < L); zero outside [0, n)
  const y1 = B.y1, y2 = B.y2, z = B.z, c0 = HB[31], n1 = 4 * L + 183, n2 = 2 * L + 61;
  for (let i = 0; i < n1; i++) { // y1[i] ↔ x position s + 2(i − 93)
    const c = s + 2 * (i - 93);
    let acc = c >= 0 && c < n ? c0 * x[c] : 0;
    for (let k = 1; k <= 31; k += 2) {
      const p = c - k, q = c + k;
      acc += HB[31 + k] * ((p >= 0 && p < n ? x[p] : 0) + (q >= 0 && q < n ? x[q] : 0));
    }
    y1[i] = acc;
  }
  for (let j = 0; j < n2; j++) { // y2[j] ↔ x position s + 4(j − 31)
    const c = 2 * j + 31;
    let acc = c0 * y1[c];
    for (let k = 1; k <= 31; k += 2) acc += HB[31 + k] * (y1[c - k] + y1[c + k]);
    y2[j] = acc;
  }
  for (let i = 0; i < L; i++) { // z[i] ↔ x position s + 8i
    const c = 2 * i + 31;
    let acc = c0 * y2[c];
    for (let k = 1; k <= 31; k += 2) acc += HB[31 + k] * (y2[c - k] + y2[c + k]);
    z[i] = acc;
  }
}
function refinePeriod(x, n, s, P, Wmax, dd) { // full-rate refinement of a coarse period P at x[s…]; 0 = rejected
  const lo = Math.max(2, Math.floor(P) - 20), hi = Math.ceil(P) + 20, W = Math.min(Wmax, n - s - hi - 1);
  if (W < 16) return P;
  let best = lo;
  for (let t = lo; t <= hi; t++) {
    let d = 0;
    for (let j = s, e = s + W; j < e; j++) { const v = x[j] - x[j + t]; d += v * v; }
    dd[t - lo] = d;
    if (d < dd[best - lo]) best = t;
  }
  if (best === lo || best === hi) return 0; // the coarse estimate was off by more than the search range
  return vertex(dd[best - lo - 1], dd[best - lo], dd[best - lo + 1], best);
}
function estDims(m, Wd, Td) { // [window, lags] for m samples: the defaults, or a window of about half the signal
  if (m >= Wd + Td) return [Wd, Td];
  const W = Math.max(16, (m >> 1) - 4);
  return [W, Math.min(Td, m - W)];
}
function estSpots(span, K, hop) { // ≤ K evenly spaced window starts in [0, span], at least `hop` apart
  if (span < 0) return [];
  const k = Math.min(K, Math.floor(span / hop) + 1), out = [];
  for (let i = 0; i < k; i++) out.push(k > 1 ? Math.round(i * span / (k - 1)) : 0);
  return out;
}
export function estimatePeriod(wav) {
  const x = wav && wav.ch && wav.ch[0], n = x ? x.length : 0;
  if (n < 64) return null;
  const [WA, TA] = estDims(n, 2048, 1024), short = n <= 32768, D = 8, m = Math.floor(n / D);
  const runB = n - WA > TA && m >= 16; // pass A's lag range was capped: longer periods fit the file
  const [WB, TB] = short ? estDims(n, 10240, 10032) : estDims(m, 1280, 1254), LB = WB + TB;
  let N = 1;
  while (N < Math.max(WA + TA, runB ? LB : 0)) N <<= 1;
  const B = { N, ar: new Float64Array(N), ai: new Float64Array(N), br: new Float64Array(N), bi: new Float64Array(N), dn: new Float64Array(Math.max(TA, TB)) };
  const sA = estSpots(n - WA - TA, 48, 512), vA = [];
  for (const p of sA) { const P = yinWindow(x, p, WA, TA, B); if (P > 0) vA.push(P); }
  const fA = sA.length ? vA.length / sA.length : 0;
  if (fA >= 0.5 || !runB) return vA.length ? median(vA) : null;
  const vB = [];
  let nB = 0;
  if (short) {
    for (const p of estSpots(n - LB, 4, 2048)) { nB++; const P = yinWindow(x, p, WB, TB, B); if (P > 0 && P <= EST_MAXP) vB.push(P); }
  } else {
    B.y1 = new Float64Array(4 * LB + 183); B.y2 = new Float64Array(2 * LB + 61); B.z = new Float64Array(LB);
    const dd = new Float64Array(64), mg = m - LB >= 56 ? 28 : 0; // margin: no window sees the zeros beyond the ends
    for (const p of estSpots(m - LB - 2 * mg, 24, 64)) {
      nB++;
      dec8(x, n, D * (p + mg), LB, B);
      const Pc = yinWindow(B.z, 0, WB, TB, B);
      if (!(Pc > 0)) continue;
      const P = refinePeriod(x, n, D * (p + mg), D * Pc, D * WB, dd);
      if (P > 0 && P <= EST_MAXP) vB.push(P);
    }
  }
  const fB = nB ? vB.length / nB : 0;
  return vB.length && fB > fA ? median(vB) : vA.length ? median(vA) : null;
}

export function tableToWav(table, o = {}) {
  const R = table.frames.length, bits = o.bits === 16 ? 16 : 32;
  const list = Array.isArray(o.frames) && o.frames.length ? o.frames.map(f => idx(f, R)) : FRAMES(R);
  const data = new Float32Array(list.length * FRAME);
  list.forEach((f, j) => data.set(table.frames[f], j * FRAME));
  return writeWav({ sr: 44100, ch: [data], bits, float: bits === 32, clm: { size: FRAME, morph: table.morph | 0, factory: 0 } });
}

export function tableTo256(table) {
  const R = table.frames.length, out = new Uint8Array(R * 256);
  table.frames.forEach((f, j) => {
    const X = spec2048(f), s = 256 / FRAME, re = new Float64Array(129), im = new Float64Array(129);
    for (let k = 0; k <= 127; k++) { re[k] = X.re[k] * s; im[k] = X.im[k] * s; }
    const y = irfft(re, im, 256);
    for (let i = 0; i < 256; i++) out[j * 256 + i] = clamp(Math.round(128 + 127 * y[i]), 0, 255);
  });
  return out.buffer;
}

export function tableToSingles(table) {
  const base = String(table.name || 'Wavetable').replace(/[\\/:*?"<>|]+/g, '_');
  return table.frames.map((f, j) => ({
    name: `${base} ${String(j + 1).padStart(3, '0')}.wav`,
    buffer: writeWav({ sr: 44100, ch: [f], bits: 32, float: true, clm: { size: FRAME, morph: 0, factory: 0 } }),
  }));
}

// PNG import (inv A10.10, S2M orientation): columns → frames, rows top → bottom → samples, luminance → amplitude.
export function importImage(img) {
  const W = img.width | 0, H = img.height | 0, d = img.data;
  if (W < 1 || H < 1 || !d || d.length < W * H * 4) throw new Error('Unsupported image');
  const F = Math.min(W, MAX_FRAMES), lum = (x, y) => { const o = (y * W + x) * 4; return (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255; };
  const frames = [];
  for (let f = 0; f < F; f++) {
    const sx = W === F ? f : clamp((f + 0.5) * W / F - 0.5, 0, W - 1), x0 = Math.floor(sx), x1 = Math.min(W - 1, x0 + 1), tx = sx - x0;
    const fr = new Float32Array(FRAME);
    let m = 0;
    for (let i = 0; i < FRAME; i++) {
      const sy = clamp((i + 0.5) * H / FRAME - 0.5, 0, H - 1), y0 = Math.floor(sy), y1 = Math.min(H - 1, y0 + 1), ty = sy - y0;
      const a = lum(x0, y0) + (lum(x1, y0) - lum(x0, y0)) * tx, b = lum(x0, y1) + (lum(x1, y1) - lum(x0, y1)) * tx;
      fr[i] = 2 * (a + (b - a) * ty) - 1;
      m += fr[i];
    }
    m /= FRAME;
    for (let i = 0; i < FRAME; i++) fr[i] -= m;
    frames.push(fr);
  }
  return { name: img.name || 'Image', frames, morph: 0, factory: 0 };
}

export function importSingles(list, name) {
  const frames = (list || []).slice(0, MAX_FRAMES).map(w => {
    const x = w && w.ch && w.ch[0];
    if (!x || !x.length) return new Float32Array(FRAME);
    if (w.clm && w.clm.size > 0 && x.length >= w.clm.size) return rawFrames(x, w.clm.size)[0];
    return resampleCycle(x);
  });
  if (!frames.length) frames.push(new Float32Array(FRAME));
  return { name: name || 'Single Cycles', frames, morph: 0, factory: 0 };
}

// A single cycle out of any audio file (thumbnail drop, inv A10.2). opts.size = the held split size (§9.9: samples
// or a note name): without a clm chunk it cuts the file at that size and takes the middle cycle.
export function cycleFromWav(wav, opts) {
  const x = wav && wav.ch && wav.ch[0];
  if (!x || !x.length) return new Float32Array(FRAME);
  if (wav.clm && wav.clm.size > 0 && x.length >= wav.clm.size) return rawFrames(x.subarray(0, wav.clm.size), wav.clm.size)[0];
  const P = opts && opts.size != null ? parseSplitSize(opts.size) : null;
  if (P) { const K = Math.floor(x.length / P); return K >= 1 ? cycleAt(x, (K >> 1) * P, P) : resampleCycle(x); }
  if (x.length % FRAME === 0) return Float32Array.from(x.subarray(0, FRAME));
  if (x.length <= 9999) return resampleCycle(x);
  const t = tableFromWav(wav, { mode: 'pitchAvg' });
  return t.frames[t.frames.length >> 1];
}
export function replaceFrame(table, f, wav, opts) {
  const R = table.frames.length, frames = table.frames.slice();
  frames[idx(f, R)] = cycleFromWav(wav, opts);
  return mk(table, frames);
}

/* ================================================================== LFO shapes ↔ frames */

export function frameToPoints(frame, maxPts = 64) {
  const n = FRAME, ys = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) ys[i] = clamp(0.5 + 0.5 * frame[i], 0, 1);
  ys[n] = ys[0];
  const keep = [0, n], cap = Math.max(2, Math.min(480, maxPts | 0 || 64));
  const err = (a, b) => { let w = -1, wi = -1; for (let i = a + 1; i < b; i++) { const y = ys[a] + (ys[b] - ys[a]) * (i - a) / (b - a), e = Math.abs(ys[i] - y); if (e > w) { w = e; wi = i; } } return [w, wi]; };
  while (keep.length < cap) {
    let best = 0, at = -1;
    for (let s = 0; s + 1 < keep.length; s++) { const [e, i] = err(keep[s], keep[s + 1]); if (e > best) { best = e; at = i; } }
    if (at < 0 || best < 1e-4) break;
    keep.push(at);
    keep.sort((a, b) => a - b);
  }
  const r5 = v => Math.round(v * 1e5) / 1e5;
  return keep.map(i => [r5(i / n), r5(ys[i]), 0]);
}

export function ptsToFrame(tab) {
  const m = tab.length - 1, x = new Float64Array(FRAME);
  if (m < 1) return new Float32Array(FRAME).fill(m === 0 ? 2 * tab[0] - 1 : 0);
  for (let i = 0; i < FRAME; i++) {
    const p = i * m / FRAME, k = Math.floor(p), t = p - k;
    x[i] = 2 * (tab[k] + (tab[Math.min(m, k + 1)] - tab[k]) * t) - 1;
  }
  return bandlimit(x, 1);
}

/* ================================================================== embedding (§7.10) */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64I = (() => { const t = new Int16Array(128).fill(-1); for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i; return t; })();
function toB64(buf) {
  const u = ArrayBuffer.isView(buf) ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : new Uint8Array(buf);
  let s = '';
  const parts = [];
  for (let i = 0; i < u.length; i += 3) {
    const a = u[i], b = i + 1 < u.length ? u[i + 1] : 0, c = i + 2 < u.length ? u[i + 2] : 0, v = (a << 16) | (b << 8) | c;
    s += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + (i + 1 < u.length ? B64[(v >> 6) & 63] : '=') + (i + 2 < u.length ? B64[v & 63] : '=');
    if (s.length >= 8192) { parts.push(s); s = ''; }
  }
  parts.push(s);
  return parts.join('');
}
function fromB64(str) {
  const s = String(str).replace(/[^A-Za-z0-9+/]/g, '');
  const n = Math.floor(s.length * 3 / 4), out = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const a = B64I[s.charCodeAt(i)], b = B64I[s.charCodeAt(i + 1)], c = i + 2 < s.length ? B64I[s.charCodeAt(i + 2)] : 0, d = i + 3 < s.length ? B64I[s.charCodeAt(i + 3)] : 0;
    const v = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    if (o < n) out[o++] = (v >> 16) & 255;
    if (o < n && i + 2 < s.length) out[o++] = (v >> 8) & 255;
    if (o < n && i + 3 < s.length) out[o++] = v & 255;
  }
  return out.buffer.slice(0, o);
}
const BUF_KEYS = [['data', 'b64'], ['L', 'b64L'], ['R', 'b64R']];
const isBuf = v => v instanceof ArrayBuffer || ArrayBuffer.isView(v) || (v && typeof v.byteLength === 'number' && typeof v.slice === 'function' && !Array.isArray(v));
export function encodeEmbedded(rec) {
  const o = {};
  for (const k of Object.keys(rec || {})) {
    const m = BUF_KEYS.find(b => b[0] === k);
    if (m && (isBuf(rec[k]) || rec[k] === null)) o[m[1]] = rec[k] === null ? null : toB64(rec[k]);
    else o[k] = rec[k];
  }
  return o;
}
export function decodeEmbedded(obj) {
  const o = {};
  for (const k of Object.keys(obj || {})) {
    const m = BUF_KEYS.find(b => b[1] === k);
    if (m) o[m[0]] = obj[k] == null ? null : finiteF32(fromB64(obj[k]));
    else o[k] = obj[k];
  }
  return o;
}
function finiteF32(buf) { // little-endian Float32 payload: NaN/Inf samples → 0 (corrupt or crafted files), in place
  const dv = new DataView(buf);
  for (let o = 0; o + 4 <= buf.byteLength; o += 4) if (!Number.isFinite(dv.getFloat32(o, true))) dv.setFloat32(o, 0, true);
  return buf;
}

/* ================================================================== formula parser (§8.2.3) */

const VAR_LIST = ['x', 'w', 'y', 'z', 'q', 'in', 'sel', 'rand', 'rrnd'];
const VI = new Map(VAR_LIST.map((v, i) => [v, i]));
const CONSTS = new Map([['pi', Math.PI], ['e', Math.E]]);
function rint(v) { const r = Math.round(v); return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; }
const FN1 = new Map([
  ['sin', Math.sin], ['cos', Math.cos], ['tan', Math.tan], ['asin', Math.asin], ['acos', Math.acos], ['atan', Math.atan],
  ['sinh', Math.sinh], ['cosh', Math.cosh], ['tanh', Math.tanh], ['asinh', Math.asinh], ['acosh', Math.acosh], ['atanh', Math.atanh],
  ['log2', Math.log2], ['log10', Math.log10], ['log', Math.log10], ['ln', Math.log], ['exp', Math.exp], ['sqrt', Math.sqrt],
  ['sign', Math.sign], ['rint', rint], ['abs', Math.abs],
]);
const FNV = new Map([
  ['min', a => Math.min(...a)], ['max', a => Math.max(...a)],
  ['sum', a => a.reduce((s, v) => s + v, 0)], ['avg', a => a.reduce((s, v) => s + v, 0) / a.length],
]);
const OPS2 = ['&&', '||', '<=', '>=', '!=', '=='];
const OPS1 = '<>+-*/%^!?:(),=';

function ferr(pos, msg) { const e = new Error(msg); e.fpos = pos; throw e; }
function lex(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const m = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (m && (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] || '')))) { toks.push({ t: 'num', v: parseFloat(m[0]), pos: i }); i += m[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) { toks.push({ t: 'id', v: id[0], pos: i }); i += id[0].length; continue; }
    const two = src.slice(i, i + 2);
    if (OPS2.includes(two)) { toks.push({ t: 'op', v: two, pos: i }); i += 2; continue; }
    if (OPS1.includes(c)) { toks.push({ t: 'op', v: c, pos: i }); i++; continue; }
    ferr(i, `Unexpected character '${c}'`);
  }
  toks.push({ t: 'end', v: '', pos: src.length });
  return toks;
}

const F_DEPTH = 100, F_NODES = 1000; // nesting (parentheses, prefix operators, exponents, assignments) and AST size caps

export function parseFormula(src) {
  src = String(src == null ? '' : src);
  try {
    const toks = lex(src);
    let p = 0, depth = 0, nodes = 0;
    const uses = new Set();
    let multiAssign = false;
    const nest = (fn, pos) => { // bounded recursion: deep input becomes an error result, never a stack overflow
      if (++depth > F_DEPTH) ferr(pos, 'Formula too deeply nested');
      const r = fn();
      depth--;
      if (++nodes > F_NODES) ferr(pos, 'Formula too long');
      return r;
    };
    const peek = () => toks[p], isOp = v => toks[p].t === 'op' && toks[p].v === v;
    const expect = (v, what) => { if (!isOp(v)) ferr(toks[p].pos, what || `Expected '${v}'`); p++; };
    if (toks[0].t === 'end') ferr(0, 'Empty formula');
    function assign() {
      const t = peek();
      if (t.t === 'id' && toks[p + 1].t === 'op' && toks[p + 1].v === '=') {
        const name = t.v.toLowerCase();
        if (!VI.has(name)) ferr(t.pos, `Cannot assign to '${t.v}'`);
        p += 2;
        if (name === 'y' || name === 'z') multiAssign = true;
        return nest(assign, t.pos);
      }
      return ternary();
    }
    function ternary() {
      const c = land();
      if (isOp('?')) {
        const pos = toks[p++].pos;
        const a = nest(ternary, pos);
        expect(':', "Expected ':'");
        const b = nest(ternary, pos);
        return { t: '?', c, a, b };
      }
      return c;
    }
    function chain(next, ops) {
      let a = next();
      while (toks[p].t === 'op' && ops.includes(toks[p].v)) {
        const op = toks[p].v, pos = toks[p++].pos;
        a = { t: 'b', op, a, b: next() };
        if (++nodes > F_NODES) ferr(pos, 'Formula too long');
      }
      return a;
    }
    const land = () => chain(lor, ['&&']);
    const lor = () => chain(cmp, ['||']);
    const cmp = () => chain(add, ['<=', '>=', '!=', '==', '<', '>']);
    const add = () => chain(mul, ['+', '-']);
    const mul = () => chain(unary, ['*', '/', '%']);
    function unary() {
      if (isOp('-') || isOp('+') || isOp('!')) { const op = toks[p].v, pos = toks[p++].pos; const a = nest(unary, pos); return op === '+' ? a : { t: 'u', op, a }; }
      return power();
    }
    function power() {
      const a = primary();
      if (isOp('^')) { const pos = toks[p++].pos; return { t: 'b', op: '^', a, b: nest(unary, pos) }; }
      return a;
    }
    function primary() {
      const t = peek();
      if (t.t === 'num') { p++; return { t: 'n', v: t.v }; }
      if (t.t === 'op' && t.v === '(') {
        p++;
        const e = nest(assign, t.pos);
        if (!isOp(')')) ferr(toks[p].pos, toks[p].t === 'end' ? 'Unbalanced parentheses' : "Expected ')'");
        p++;
        return e;
      }
      if (t.t === 'id') {
        const name = t.v.toLowerCase();
        p++;
        if (isOp('(')) {
          p++;
          const args = [];
          if (!isOp(')')) {
            for (;;) { args.push(nest(ternary, t.pos)); if (isOp(',')) { p++; continue; } break; }
          }
          if (!isOp(')')) ferr(toks[p].pos, toks[p].t === 'end' ? 'Unbalanced parentheses' : "Expected ')'");
          p++;
          if (FN1.has(name)) { if (args.length !== 1) ferr(t.pos, `${name}() takes 1 argument`); return { t: 'f', fn: FN1.get(name), a: args[0] }; }
          if (FNV.has(name)) { if (!args.length) ferr(t.pos, `${name}() needs at least 1 argument`); return { t: 'fv', fn: FNV.get(name), args }; }
          ferr(t.pos, `Unknown function '${t.v}'`);
        }
        if (VI.has(name)) { uses.add(name); return { t: 'v', i: VI.get(name) }; }
        if (CONSTS.has(name)) return { t: 'n', v: CONSTS.get(name) };
        ferr(t.pos, `Unknown identifier '${t.v}'`);
      }
      if (t.t === 'end') ferr(t.pos, 'Unexpected end of formula');
      if (t.t === 'op' && t.v === ')') ferr(t.pos, 'Unbalanced parentheses');
      ferr(t.pos, `Unexpected '${t.v}'`);
    }
    const ast = assign();
    if (toks[p].t !== 'end') ferr(toks[p].pos, toks[p].t === 'op' && toks[p].v === ')' ? 'Unbalanced parentheses' : 'Unexpected input after the formula');
    return { ok: true, ast, usesQ: uses.has('q'), multi: multiAssign || uses.has('y') || uses.has('z'), uses };
  } catch (e) {
    if (e && e.fpos != null) return { ok: false, pos: e.fpos, msg: e.message };
    if (e instanceof RangeError) return { ok: false, pos: 0, msg: 'Formula too complex' }; // safety net
    throw e;
  }
}

// AST → closure tree (no string-to-code); V = Float64Array of the variables in VAR_LIST order.
function compile(n) {
  switch (n.t) {
    case 'n': { const v = n.v; return () => v; }
    case 'v': { const i = n.i; return V => V[i]; }
    case 'u': { const a = compile(n.a); return n.op === '-' ? V => -a(V) : V => (a(V) !== 0 ? 0 : 1); }
    case '?': { const c = compile(n.c), a = compile(n.a), b = compile(n.b); return V => (c(V) !== 0 ? a(V) : b(V)); }
    case 'f': { const f = n.fn, a = compile(n.a); return V => f(a(V)); }
    case 'fv': { const f = n.fn, args = n.args.map(compile); return V => f(args.map(g => g(V))); }
    case 'b': {
      const a = compile(n.a), b = compile(n.b);
      switch (n.op) {
        case '+': return V => a(V) + b(V);
        case '-': return V => a(V) - b(V);
        case '*': return V => a(V) * b(V);
        case '/': return V => a(V) / b(V);
        case '%': return V => a(V) % b(V);
        case '^': return V => Math.pow(a(V), b(V));
        case '<': return V => (a(V) < b(V) ? 1 : 0);
        case '>': return V => (a(V) > b(V) ? 1 : 0);
        case '<=': return V => (a(V) <= b(V) ? 1 : 0);
        case '>=': return V => (a(V) >= b(V) ? 1 : 0);
        case '==': return V => (a(V) === b(V) ? 1 : 0);
        case '!=': return V => (a(V) !== b(V) ? 1 : 0);
        case '&&': return V => (a(V) !== 0 && b(V) !== 0 ? 1 : 0);
        case '||': return V => (a(V) !== 0 || b(V) !== 0 ? 1 : 0);
      }
    }
  }
  throw new Error('formula: bad node');
}

export function evalFormula(src, vars = {}) {
  const P = parseFormula(src);
  if (!P.ok) throw new Error(P.msg);
  const V = new Float64Array(VAR_LIST.length);
  VAR_LIST.forEach((k, i) => { V[i] = fin(+vars[k]); });
  return fin(compile(P.ast)(V));
}

// Editor-unit magnitude below which a harmonic counts as empty (its phase is rounding noise): −60 dB in A_k relative
// to the strongest harmonic (mag = √A), so the result never depends on invisible Float32 noise.
export function emptyThreshold(mag) {
  let m = 0;
  for (let k = 0; k < mag.length; k++) if (mag[k] > m) m = mag[k];
  return Math.max(1e-9, 1e-3 * m);
}

const randArr = (seed, n) => { const r = mulberry32(seed), a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = r() * 2 - 1; return a; };

export function applyFormula(table, o = {}) {
  const P = parseFormula(o.src);
  if (!P.ok) return { table, error: `${P.msg} (at ${P.pos + 1})` };
  try { return runFormula(table, o, P); } catch (e) {
    if (e instanceof RangeError) return { table, error: 'Formula too complex' };
    throw e;
  }
}
function runFormula(table, o, P) {
  const fn = compile(P.ast), R = table.frames.length, cur = idx(o.cur, R), selF = idx(o.sel == null ? cur : o.sel, R);
  const seed = (o.seed >>> 0) || 0x5EED, V = new Float64Array(VAR_LIST.length);
  const [X, Wv, Y, Z, Q, IN, SEL, RAND, RRND] = VAR_LIST.map((v, i) => i);
  const ex = P.multi ? expandTable(table) : null, F = ex ? ex.length / FRAME : R;
  const srcFrame = f => (ex ? ex.subarray(f * FRAME, (f + 1) * FRAME) : table.frames[f]);
  const outIdx = P.multi ? FRAMES(MAX_FRAMES) : [cur];
  const srcOf = f => (P.multi ? Math.round(f * (F - 1) / 255) : cur);
  let frames;
  if (!P.usesQ) {
    const rand = randArr(seed, FRAME), sel = table.frames[selF];
    frames = outIdx.map(f => {
      const inF = srcFrame(srcOf(f)), rr = randArr((seed + Math.imul(f + 1, 0x9E3779B9)) >>> 0, FRAME), out = new Float32Array(FRAME);
      V[Y] = P.multi ? f / 255 : 0; V[Z] = 2 * V[Y] - 1; V[Q] = 0;
      for (let i = 0; i < FRAME; i++) {
        V[X] = 2 * i / FRAME - 1; V[Wv] = i / FRAME; V[IN] = inF[i]; V[SEL] = sel[i]; V[RAND] = rand[i]; V[RRND] = rr[i];
        out[i] = clamp(fin(fn(V)), -1, 1);
      }
      return out;
    });
  } else {
    const rand = randArr(seed, 512), selS = toSpectrum(table.frames[selF]);
    frames = outIdx.map(f => {
      const S = toSpectrum(srcFrame(srcOf(f))), rr = randArr((seed + Math.imul(f + 1, 0x9E3779B9)) >>> 0, 512);
      const mag = new Float64Array(1024), ph = new Float64Array(1024), thr = emptyThreshold(S.mag);
      V[X] = 0; V[Wv] = 0; V[Y] = P.multi ? f / 255 : 0; V[Z] = 2 * V[Y] - 1;
      for (let q = 1; q <= 1024; q++) {
        ph[q - 1] = S.mag[q - 1] >= thr ? S.ph[q - 1] : 0.5; // empty bins (rounding noise only) get sine phase
        if (q > 512) continue;
        V[Q] = q; V[IN] = S.mag[q - 1]; V[SEL] = selS.mag[q - 1]; V[RAND] = rand[q - 1]; V[RRND] = rr[q - 1];
        mag[q - 1] = Math.max(0, fin(fn(V)));
      }
      const fr = fromSpectrum(mag, ph, 0), pk = peakOf(fr);
      return pk > 1 ? scaled(fr, 1 / pk) : fr;
    });
  }
  if (!P.multi) { const fr = table.frames.slice(); fr[cur] = frames[0]; return { table: mk(table, fr) }; }
  return { table: mk(table, frames, 0) };
}

export const FORMULA_PRESETS = Object.freeze({
  singles: Object.freeze([
    ['Saw (spectral)', '(1/q)^0.5'], ['Bright Saw', '(1/q)^0.25'], ['Dull Saw', '(1/q)^0.75'], ['Square (spectral)', '(q%2==1)?(1/q)^0.5:0'],
    ['Triangle (spectral)', '(q%2==1)?1/q:0'], ['Sine', 'sin(pi*x)'], ['Squarify', '(q%2==1)?in:0'], ['Remove Fundamental', '(q>1)?in:0'],
    ['First 16', 'q<17'], ['Pulse 25', '(w<0.25)?1:-1'], ['Half Rectify', 'max(in,0)*2-1'], ['Soft Clip', 'tanh(3*in)'],
  ].map(([name, src]) => Object.freeze({ name, src }))),
  multis: Object.freeze([
    ['Harmonic Build', 'q<y*255+2'], ['Slope Sweep', '(1/q)^(0.25+y)'], ['PWM', '(w<0.5-0.48*y)?1:-1'], ['Fold Sweep', 'sin(pi*x*(1+6*y))'],
    ['Sync Sweep', 'sin(pi*(w*(1+7*y))*2)'], ['Odd to Even', '(q%2==1)?(1-y)*(1/q)^0.5:y*(1/q)^0.5'],
  ].map(([name, src]) => Object.freeze({ name, src }))),
});

/* ================================================================== editor operations (§8.2.6) */

function mk(t, frames, morph) {
  return { name: t.name, frames: frames.length ? frames.slice(0, MAX_FRAMES) : [new Float32Array(FRAME)], morph: morph == null ? t.morph | 0 : morph, factory: 0 };
}
const cellLen = g => (g > 0 ? Math.round(FRAME / g) : 64);
function selRange(ctx, R) {
  const s = ctx && Array.isArray(ctx.sel) ? ctx.sel : [ctx && ctx.cur, ctx && ctx.cur];
  let a = idx(s[0], R), b = idx(s[1] == null ? s[0] : s[1], R);
  if (a > b) { const t = a; a = b; b = t; }
  return [a, b];
}

// single-frame processes
const fNormalize = f => { const p = peakOf(f); return p > 0 ? scaled(f, 1 / p) : Float32Array.from(f); };
const fRemoveDC = f => { let m = 0; for (let i = 0; i < FRAME; i++) m += f[i]; m /= FRAME; const o = new Float32Array(FRAME); for (let i = 0; i < FRAME; i++) o[i] = f[i] - m; return o; };
const fFlipV = f => scaled(f, -1);
const fFlipH = f => { const o = new Float32Array(FRAME); for (let i = 0; i < FRAME; i++) o[i] = f[FRAME - 1 - i]; return o; };
function fShiftZero(f) {
  let z = -1;
  for (let i = 1; i < FRAME && z < 0; i++) if (f[i - 1] < 0 && f[i] >= 0) z = i;
  if (z < 0) return Float32Array.from(f);
  const o = new Float32Array(FRAME);
  for (let j = 0; j < FRAME; j++) o[j] = f[(j + z) % FRAME];
  return o;
}
function fFade(f, L) {
  L = clamp(L, 1, FRAME >> 1);
  const o = Float32Array.from(f);
  for (let j = 0; j < L; j++) { const g = 0.5 - 0.5 * Math.cos(Math.PI * j / L); o[j] *= g; o[FRAME - 1 - j] *= g; }
  return o;
}
function fXfade(f, L) {
  L = clamp(L, 1, FRAME);
  const o = Float32Array.from(f), step = f[0] - f[FRAME - 1];
  for (let j = 0; j < L; j++) o[FRAME - L + j] = f[FRAME - L + j] + ((j + 1) / L) * step;
  return o;
}
function fKeep(f, lo, hi, dc) { // keep harmonics lo…hi (and DC if dc)
  const X = spec2048(f);
  for (let k = 0; k <= 1024; k++) if ((k === 0 && !dc) || (k > 0 && (k < lo || k > hi))) { X.re[k] = 0; X.im[k] = 0; }
  return fromRI(X.re, X.im);
}
function fRedux(f, g) {
  const M = clamp(g > 0 ? 16 * g : 64, 1, FRAME), o = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) o[i] = f[Math.floor(Math.floor(i * M / FRAME) * FRAME / M)];
  return o;
}
function fRotate(f, delta) { // circular shift by `delta` cycles (fractional, via FFT): y(φ) = x(φ + delta)
  const X = spec2048(f);
  for (let k = 1; k <= 1024; k++) {
    const a = TAU * k * delta, c = Math.cos(a), s = Math.sin(a), r = X.re[k], i = X.im[k];
    if (k === 1024) { X.re[k] = r * c; X.im[k] = 0; continue; }
    X.re[k] = r * c - i * s; X.im[k] = r * s + i * c;
  }
  return fromRI(X.re, X.im);
}
function fNudgeFund(f) {
  const X = spec2048(f);
  if (Math.hypot(X.re[1], X.im[1]) < 1e-9) return Float32Array.from(f);
  return fRotate(f, (-HALF_PI - Math.atan2(X.im[1], X.re[1])) / TAU);
}
function fZeroPhase(f) {
  const X = spec2048(f);
  for (let k = 1; k <= 1024; k++) { X.re[k] = Math.hypot(X.re[k], X.im[k]); X.im[k] = 0; }
  return fromRI(X.re, X.im);
}
const otherIdx = (f, R, Ro) => (R > 1 ? Math.round(f * (Ro - 1) / (R - 1)) : 0);
function boxBlur(arr, rad, circ) {
  const n = arr.length, o = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0, sx = 0, sy = 0;
    for (let j = Math.max(0, i - rad); j <= Math.min(n - 1, i + rad); j++) {
      if (circ) { sx += Math.cos(TAU * arr[j]); sy += Math.sin(TAU * arr[j]); } else s += arr[j];
      c++;
    }
    o[i] = circ ? (sx === 0 && sy === 0 ? arr[i] : frac(Math.atan2(sy, sx) / TAU)) : s / c;
  }
  return o;
}
// spectral per-frame op on editor-unit spectra
function specMap(t, fn) {
  return mk(t, t.frames.map((f, j) => { const S = toSpectrum(f); fn(S, j); return fromSpectrum(S.mag, S.ph, S.dc); }));
}
function blurFrames(t, rad, key) {
  const S = t.frames.map(toSpectrum), R = S.length;
  const out = S.map(s => ({ mag: Float64Array.from(s.mag), ph: Float64Array.from(s.ph), dc: s.dc }));
  const col = new Float64Array(R);
  for (let k = 0; k < 1023; k++) {
    for (let f = 0; f < R; f++) col[f] = S[f][key][k];
    const b = boxBlur(col, rad, key === 'ph');
    for (let f = 0; f < R; f++) out[f][key][k] = b[f];
  }
  return mk(t, out.map(s => fromSpectrum(s.mag, s.ph, s.dc)));
}
const sortKeys = {
  peakSpect: m => { let b = 0; for (let k = 1; k < 1023; k++) if (m[k] > m[b]) b = k; return b; },
  avgSpect: m => { let s = 0, w = 0; for (let k = 0; k < 1023; k++) { s += (k + 1) * m[k]; w += m[k]; } return w > 0 ? s / w : 0; },
  peakAmt: m => { let b = 0; for (let k = 0; k < 1023; k++) b = Math.max(b, m[k]); return b; },
  numSpect: m => { const mx = sortKeys.peakAmt(m); let c = 0; if (mx > 0) for (let k = 0; k < 1023; k++) if (m[k] > 1e-3 * mx) c++; return c; },
  highSpect: m => { const mx = sortKeys.peakAmt(m); let h = 0; if (mx > 0) for (let k = 0; k < 1023; k++) if (m[k] > 1e-3 * mx) h = k + 1; return h; },
  fund: m => m[0],
};
function sortBy(t, key) {
  const keyed = t.frames.map((f, i) => ({ f, i, k: key(toSpectrum(f).mag) }));
  keyed.sort((a, b) => a.k - b.k || a.i - b.i);
  return mk(t, keyed.map(e => e.f));
}
const perCur = fn => (t, c) => { const R = t.frames.length, cur = idx(c.cur, R), fr = t.frames.slice(); fr[cur] = fn(t.frames[cur], c); return mk(t, fr); };
const perAll = fn => (t, c) => mk(t, t.frames.map(f => fn(f, c)));
const morphOk = t => t.frames.length > 1 && t.frames.length < MAX_FRAMES;
const setMorph = (m, pre) => (t, c) => (morphOk(t) ? mk(t, pre ? t.frames.map(pre) : t.frames, m) : mk(t, t.frames));
const keepIdx = (t, keep) => mk(t, t.frames.filter((f, i) => keep(i)));
const FADE = (f, c) => fFade(f, cellLen(c.grid | 0)), XF = (f, c) => fXfade(f, cellLen(c.grid | 0));
const FILT = (f, c) => fKeep(f, 1, (c.grid | 0) > 0 ? c.grid | 0 : 1023, false), RDX = (f, c) => fRedux(f, c.grid | 0);
function fromOther(t, c, key) {
  const o = c.other;
  if (!o || !o.frames || !o.frames.length) return mk(t, t.frames);
  const R = t.frames.length, Ro = o.frames.length, OS = new Map();
  const os = f => { const i = otherIdx(f, R, Ro); if (!OS.has(i)) OS.set(i, toSpectrum(o.frames[i])); return OS.get(i); };
  return specMap(t, (S, f) => {
    const B = os(f);
    if (key === 'sub') for (let k = 0; k < 1024; k++) S.mag[k] = Math.max(0, S.mag[k] - B.mag[k]);
    else S[key].set(B[key]);
  });
}

// Spectral rebuilds that combine magnitudes and phases from different sources (set / blur / from other osc, zero
// phases) can raise peaks by 10–15 dB; like q-formulas, the result is scaled
// back (one factor for the whole table, Normalize Same) when its peak exceeds max(1, the table's previous peak).
const tablePeak = t => t.frames.reduce((m, f) => Math.max(m, peakOf(f)), 0);
const keepPeak = fn => (t, c) => {
  const r = fn(t, c), lim = Math.max(1, tablePeak(t)), p = tablePeak(r);
  return p > lim ? mk(r, r.frames.map(f => scaled(f, lim / p)), r.morph) : r;
};

const OP_DEF = [
  ['single.normalize', 'Single', 'Normalize', perCur(fNormalize)],
  ['single.removeDC', 'Single', 'Remove DC Offset', perCur(fRemoveDC)],
  ['single.flipV', 'Single', 'Flip Vertical', perCur(fFlipV)],
  ['single.flipH', 'Single', 'Flip Horizontal', perCur(fFlipH)],
  ['single.shiftZero', 'Single', 'Shift Horizontal to Zero Crossing', perCur(fShiftZero)],
  ['single.init', 'Single', 'Init (silence)', perCur(() => new Float32Array(FRAME))],
  ['single.fadeEdges', 'Single', 'Fade Edges (grid size)', perCur(FADE)],
  ['single.xfadeEdges', 'Single', 'X-fade Edges (grid size)', perCur(XF)],
  ['single.filter', 'Single', 'Filter (grid size)', perCur(FILT)],
  ['single.redux', 'Single', 'Sample Redux at grid size', perCur(RDX)],
  ['single.toNoise', 'Single', 'Send to Noise Oscillator', t => mk(t, t.frames), { host: true }],
  ['all.normalizeEach', 'Process', 'Normalize Each', perAll(fNormalize)],
  ['all.normalizeSame', 'Process', 'Normalize Same', t => mk(t, normSame(t.frames))],
  ['all.removeDC', 'Process', 'Remove DC Offset', perAll(fRemoveDC)],
  ['all.flipV', 'Process', 'Flip Vertical', perAll(fFlipV)],
  ['all.flipH', 'Process', 'Flip Horizontal', perAll(fFlipH)],
  ['all.fadeEdges', 'Process', 'Fade Edges (grid size)', perAll(FADE)],
  ['all.xfadeEdges', 'Process', 'X-fade Edges (grid size)', perAll(XF)],
  ['all.xfade16', 'Process', 'X-fade Edges (16 samples)', perAll(f => fXfade(f, 16))],
  ['all.filter', 'Process', 'Filter (grid size)', perAll(FILT)],
  ['all.removeFund', 'Process', 'Remove Fundamental (HPF)', perAll(f => fKeep(f, 2, 1024, false))],
  ['all.redux', 'Process', 'Sample Redux at grid size', perAll(RDX)],
  ['all.shiftZero', 'Process', 'Shift Horizontal to Zero Crossing', perAll(fShiftZero)],
  ['all.half', 'Process', 'Resize Tables to be Half', t => mk(t, t.frames.flatMap(f => [resampleCycle(f.subarray(0, 1024)), resampleCycle(f.subarray(1024))]))],
  ['all.double', 'Process', 'Resize Tables to be Double', t => {
    const out = [];
    for (let i = 0; i < t.frames.length; i += 2) {
      const a = t.frames[i], b = t.frames[i + 1] || a, c = new Float64Array(2 * FRAME);
      c.set(a); c.set(b, FRAME);
      out.push(resampleCycle(c));
    }
    return mk(t, out);
  }],
  ['all.pwm', 'Process', 'Create PWM from this table to all', (t, c) => {
    const src = t.frames[idx(c.cur, t.frames.length)];
    return mk(t, FRAMES(MAX_FRAMES).map(f => {
      const w = f / 255, d = 1 - 0.995 * w, N = 4 * FRAME, x = new Float64Array(N);
      for (let j = 0; j < N; j++) x[j] = hermiteWrap(src, Math.min(1 - Math.pow(2, -24), (j / N) / d) * FRAME);
      return bandlimit(x, 4);
    }), 0);
  }],
  ['all.nudgeFund', 'Process', 'Nudge all phases for fundamental to 50%', perAll(fNudgeFund)],
  ['all.setSpectra', 'Process', 'Set Spectra same for all frames', keepPeak((t, c) => { const S = toSpectrum(t.frames[idx(c.cur, t.frames.length)]); return specMap(t, X => X.mag.set(S.mag)); })],
  ['all.setPhases', 'Process', 'Set Phases same for all frames', keepPeak((t, c) => { const S = toSpectrum(t.frames[idx(c.cur, t.frames.length)]); return specMap(t, X => X.ph.set(S.ph)); })],
  ['all.subtractOther', 'Process', 'Subtract Spectra from other Osc', (t, c) => fromOther(t, c, 'sub'), { needsOther: true }],
  ['all.blurBinsSpectra', 'Process', 'Bins: Blur Spectra', keepPeak((t, c) => specMap(t, S => S.mag.set(boxBlur(S.mag.subarray(0, 1023), Math.max(1, c.grid | 0), false))))],
  ['all.blurBinsPhases', 'Process', 'Bins: Blur Phases', keepPeak((t, c) => specMap(t, S => S.ph.set(boxBlur(S.ph.subarray(0, 1023), Math.max(1, c.grid | 0), true))))],
  ['all.blurFramesSpectra', 'Process', 'Frames: Blur Spectra', keepPeak((t, c) => blurFrames(t, Math.max(1, c.grid | 0), 'mag'))],
  ['all.blurFramesPhases', 'Process', 'Frames: Blur Phases', keepPeak((t, c) => blurFrames(t, Math.max(1, c.grid | 0), 'ph'))],
  ['all.removeLowSpectra', 'Process', 'Remove Low Spectra (grid size)', (t, c) => specMap(t, S => S.mag.fill(0, 0, clamp(c.grid | 0, 0, 1024)))],
  ['all.removeLowPhases', 'Process', 'Remove Low Phases (grid size)', keepPeak((t, c) => specMap(t, S => S.ph.fill(0.5, 0, clamp(c.grid | 0, 0, 1024))))],
  ['all.spectraFromOther', 'Process', 'Set Spectra from Other Osc', keepPeak((t, c) => fromOther(t, c, 'mag')), { needsOther: true }],
  ['all.phasesFromOther', 'Process', 'Set Phases from Other Osc', keepPeak((t, c) => fromOther(t, c, 'ph')), { needsOther: true }],
  ['morph.crossfade', 'Morph', 'Morph – Crossfade', setMorph(1), { needsMorph: true }],
  ['morph.spectral', 'Morph', 'Morph – Spectral', setMorph(2), { needsMorph: true }],
  ['morph.spectralZeroFund', 'Morph', 'Morph – Spectral (zero fundamental phase)', setMorph(3, fNudgeFund), { needsMorph: true }],
  ['morph.spectralZeroAll', 'Morph', 'Morph – Spectral (zero all phases)', keepPeak(setMorph(4, fZeroPhase)), { needsMorph: true }],
  ['morph.remove', 'Morph', 'Remove Morph Tables', t => mk(t, t.frames, 0)],
  ['add.initAll', 'Add/Remove', 'Init All', t => ({ name: t.name, frames: [factoryTable('factory:Default').frames[0].slice()], morph: 0, factory: 0 })],
  ['add.insert', 'Add/Remove', 'Insert at current index', (t, c) => {
    const R = t.frames.length, cur = idx(c.cur, R);
    if (R >= MAX_FRAMES) return mk(t, t.frames);
    const fr = t.frames.slice();
    fr.splice(cur + 1, 0, Float32Array.from(t.frames[cur]));
    return mk(t, fr);
  }],
  ['add.remove', 'Add/Remove', 'Remove current index', (t, c) => { const R = t.frames.length, cur = idx(c.cur, R); return R > 1 ? keepIdx(t, i => i !== cur) : mk(t, t.frames); }, { needsMany: true }],
  ['add.removeSel', 'Add/Remove', 'Remove: multiselection', (t, c) => {
    const R = t.frames.length, [a, b] = selRange(c, R);
    return a === 0 && b === R - 1 ? keepIdx(t, i => i === 0) : keepIdx(t, i => i < a || i > b);
  }, { needsMany: true }],
  ['add.removeToSel', 'Add/Remove', 'Remove: beginning→selected', (t, c) => { const [a] = selRange(c, t.frames.length); return keepIdx(t, i => i >= a); }],
  ['add.removeFromSel', 'Add/Remove', 'Remove: selected→end', (t, c) => { const [, b] = selRange(c, t.frames.length); return keepIdx(t, i => i <= b); }],
  ['add.removeOthers', 'Add/Remove', 'Remove: All (except selected)', (t, c) => { const [a, b] = selRange(c, t.frames.length); return keepIdx(t, i => i >= a && i <= b); }],
  ['add.reduce', 'Add/Remove', 'Reduce', (t, c) => { const n = clamp(c.n | 0, 2, 16); return keepIdx(t, i => i % n === 0); }, { sub: true }],
  // Phase 2 (inv B11 "Reduce to"): keep n evenly spaced frames round(j·(R − 1)/(n − 1)), j = 0…n − 1 (first and last
  // kept); n = ctx.n ∈ 2–256; a table of ≤ n frames is unchanged
  ['add.reduceTo', 'Add/Remove', 'Reduce to', (t, c) => {
    const R = t.frames.length, n = clamp(c.n | 0, 2, MAX_FRAMES);
    if (R <= n) return mk(t, t.frames);
    return mk(t, FRAMES(n).map(j => t.frames[Math.round(j * (R - 1) / (n - 1))]));
  }, { sub: true, needsMany: true }],
  // Phase 2 (frame PASTE, §13.13b): ctx.clip (frames copied by COPY, a contiguous range) inserted after the current
  // frame; at most as many as fit into 256. No menu entry (the editor's PASTE button / Cmd-V).
  ['add.paste', null, 'Paste frames', (t, c) => {
    const R = t.frames.length, cur = idx(c.cur, R), clip = Array.isArray(c.clip) ? c.clip : [];
    const n = Math.min(clip.length, MAX_FRAMES - R);
    if (n <= 0) return mk(t, t.frames);
    const fr = t.frames.slice();
    fr.splice(cur + 1, 0, ...clip.slice(0, n).map(f => cleanFrame(Float32Array.from(f && f.length === FRAME ? f : fitLen(f || [])))));
    return mk(t, fr);
  }],
  ['add.move', null, 'Move frames', (t, c) => {
    const R = t.frames.length, [a, b] = selRange(c, R), to = clamp(Math.round(+c.to || 0), 0, R);
    if (to >= a && to <= b + 1) return mk(t, t.frames);
    const fr = t.frames.slice(), moved = fr.splice(a, b - a + 1);
    fr.splice(to > b ? to - (b - a + 1) : to, 0, ...moved);
    return mk(t, fr);
  }],
  ['sort.peakSpect', 'Sort', 'Peak Spect', t => sortBy(t, sortKeys.peakSpect)],
  ['sort.avgSpect', 'Sort', 'Average Spect', t => sortBy(t, sortKeys.avgSpect)],
  ['sort.peakAmt', 'Sort', 'Peak Amount', t => sortBy(t, sortKeys.peakAmt)],
  ['sort.numSpect', 'Sort', 'Num w/ Spect', t => sortBy(t, sortKeys.numSpect)],
  ['sort.highSpect', 'Sort', 'Highest w/ Spect', t => sortBy(t, sortKeys.highSpect)],
  ['sort.fund', 'Sort', 'Fundamental amt.', t => sortBy(t, sortKeys.fund)],
  ['sort.random', 'Sort', 'Randomize', (t, c) => {
    const fr = t.frames.slice(), r = mulberry32((c.seed >>> 0) || 1);
    for (let i = fr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)), x = fr[i]; fr[i] = fr[j]; fr[j] = x; }
    return mk(t, fr);
  }],
  ['sort.reverse', 'Sort', 'Reverse entire table order', t => mk(t, t.frames.slice().reverse())],
];

// Registry: id → { id, menu, label, host?, needsOther?, needsMorph?, needsMany?, sub? } (menu order = insertion order).
export const OPS = Object.freeze(Object.fromEntries(OP_DEF.map(([id, menu, label, , flags]) => [id, Object.freeze(Object.assign({ id, menu, label }, flags || {}))])));
const OP_FN = new Map(OP_DEF.map(d => [d[0], d[3]]));

// Whether an op does something for this table/ctx (menus disable the rest).
export function opEnabled(table, id, ctx = {}) {
  const o = OPS[id], R = table.frames.length;
  if (!o) return false;
  if (o.needsOther) return !!(ctx.other && ctx.other.frames && ctx.other.frames.length);
  if (o.needsMorph) return R > 1 && R < MAX_FRAMES;
  if (o.needsMany) return R > 1;
  if (id === 'add.insert') return R < MAX_FRAMES;
  if (id === 'add.paste') return R < MAX_FRAMES && Array.isArray(ctx.clip) && ctx.clip.length > 0;
  return true;
}

export function applyOp(table, id, ctx = {}) {
  const fn = OP_FN.get(id);
  if (!fn) throw new Error('Unknown wavetable operation: ' + id);
  return fn(table, ctx || {});
}

/* ================================================================== draw tools (§8.2.7) */

export const DRAW_TOOLS = Object.freeze([
  ['flat', 'Flat Line'], ['slopeUp', 'Slope Up'], ['slopeDown', 'Slope Down'], ['sine', 'Sine'], ['halfValley', 'Half sine (valley)'],
  ['halfPeak', 'Half sine (peak)'], ['curveUp', 'Curve up (¼ sine)'], ['curveDown', 'Curve down (¼ sine)'], ['interpLin', 'Interpolate linear'],
  ['interpCurve', 'Interpolate curved'], ['nudge', 'Nudge'], ['noise', 'Noise'],
  ['mirror', 'Mirror'], // Phase 2 (inv B11): the Flat Line stroke plus its point mirror about the frame centre
].map(([id, label]) => Object.freeze({ id, label })));

// Sample range [i0, i1) of the grid cell containing x (grid > 0).
export function cellOf(x, grid) {
  const g = Math.max(1, grid | 0), k = Math.min(g - 1, Math.max(0, Math.floor(clamp(x, 0, 1) * g)));
  return [Math.round(k * FRAME / g), Math.round((k + 1) * FRAME / g)];
}

// ctx = { x0, y0 (previous / drag-start pointer), x1, y1 (pointer), grid, cell?, seed? } — x ∈ [0,1], y ∈ [−1,1].
// grid > 0: the tool acts on the cell under the pointer; grid 0: `flat` draws a line from (x0,y0) to (x1,y1),
// the shaped tools act on the dragged span [x0, x1]. `mirror` draws as `flat`, then writes y[2047 − i] = −y[i] for
// every drawn sample i (where the stroke covers both i and 2047 − i, the left half i < 1024 defines both).
export function drawTool(frame, tool, c = {}) {
  const out = Float32Array.from(frame), g = c.grid | 0;
  const x1 = clamp(fin(c.x1), 0, 1), x0 = clamp(c.x0 == null ? x1 : fin(c.x0), 0, 1);
  const y1 = clamp(fin(c.y1), -1, 1), y0 = clamp(c.y0 == null ? y1 : fin(c.y0), -1, 1), dy = y1 - y0;
  let i0, i1;
  if (Array.isArray(c.cell)) { i0 = clamp(c.cell[0] | 0, 0, FRAME - 1); i1 = clamp(c.cell[1] | 0, i0 + 1, FRAME); }
  else if (g > 0) [i0, i1] = cellOf(x1, g);
  else { i0 = Math.min(FRAME - 1, Math.floor(Math.min(x0, x1) * FRAME)); i1 = Math.min(FRAME, Math.floor(Math.max(x0, x1) * FRAME) + 1); }
  const n = i1 - i0, u = i => (n > 1 ? (i - i0) / (n - 1) : 0);
  const fill = fn => { for (let i = i0; i < i1; i++) out[i] = fn(u(i), i); };
  switch (tool) {
    case 'flat': case 'mirror': {
      let lo = i0, hi = i1 - 1;
      if (g > 0 || Array.isArray(c.cell)) fill(() => y1);
      else {
        const a = Math.round(x0 * (FRAME - 1)), b = Math.round(x1 * (FRAME - 1));
        lo = Math.min(a, b); hi = Math.max(a, b);
        for (let i = lo; i <= hi; i++) out[i] = hi === lo ? y1 : a <= b ? y0 + (y1 - y0) * (i - a) / (b - a) : y1 + (y0 - y1) * (i - b) / (a - b);
      }
      if (tool === 'mirror') {
        for (let i = lo; i <= hi; i++) {
          const j = FRAME - 1 - i;
          if (j >= lo && j <= hi && i >= FRAME >> 1) continue;
          out[j] = -out[i];
        }
      }
      break;
    }
    case 'slopeUp': fill(t => -y1 + 2 * y1 * t); break;
    case 'slopeDown': fill(t => y1 - 2 * y1 * t); break;
    case 'sine': { const h = g > 0 ? g : 1; for (let i = 0; i < FRAME; i++) out[i] = frame[i] + y1 * Math.sin(TAU * h * i / FRAME); break; }
    case 'halfValley': fill(t => -Math.abs(y1) * Math.sin(Math.PI * t)); break;
    case 'halfPeak': fill(t => Math.abs(y1) * Math.sin(Math.PI * t)); break;
    case 'curveUp': fill(t => y1 * Math.sin(HALF_PI * t)); break;
    case 'curveDown': fill(t => y1 * Math.cos(HALF_PI * t)); break;
    case 'interpLin': { const a = frame[i0], b = frame[i1 - 1]; fill(t => a + (b - a) * t); break; }
    case 'interpCurve': { const a = frame[i0], b = frame[i1 - 1]; fill(t => a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * t))); break; }
    case 'nudge': fill((t, i) => clamp(frame[i] + dy, -1, 1)); break;
    case 'noise':
      if (dy > 0) { const r = mulberry32((c.seed >>> 0) || 1); fill((t, i) => clamp(frame[i] + dy * (r() * 2 - 1), -1, 1)); }
      else if (dy < 0) {
        const a = clamp(1 - 4 * Math.abs(dy), 0.05, 1);
        let y = frame[i0];
        for (let i = i0; i < i1; i++) { y += a * (frame[i] - y); out[i] = y; }
        y = out[i1 - 1];
        for (let i = i1 - 1; i >= i0; i--) { y += a * (out[i] - y); out[i] = y; }
      }
      break;
    default: throw new Error('Unknown draw tool: ' + tool);
  }
  return out;
}

/* ================================================================== FFT area menu (§8.2.8) */

export const FFT_OPS = Object.freeze([
  ['clearAll', 'Clear All'], ['clearHF', 'Clear HF (bin X to end)'], ['clearLF', 'Clear LF (start to bin X)'], ['saw', 'Generate Saw'],
  ['randLow', 'Randomize Low X bins'], ['randLowHalf', 'Randomize Low X bins (with half)'], ['randAll', 'Randomize All'],
  ['gaps', 'Create random series gaps'], ['fade', 'Progressive Fade'], ['octUp', 'Shift Octave Up'], ['octDown', 'Shift Octave Down'],
  ['odd', 'Draw Odd Harmonics Only'], ['even', 'Draw Even Harmonics Only'],
  ['repeatGroup', 'Repeat Bin Group (Start to Cursor Pos)'], // Phase 2 (inv B11)
].map(([id, label]) => Object.freeze({ id, label })));

// c = { bin (the bin under the pointer, 1-based), seed }. Phase 2: `repeatGroup` copies the row's bins 1…bin
// periodically up to bin 1023 (v[k] = v[(k − 1) mod bin + 1]; unscaled — the editor scales the frame back to its peak);
// `nudgePhase` (not in FFT_OPS: Shift-Cmd/Ctrl-click on a phase bar, or the editor's phase-row menu item) adds 1/64 to
// that bin's phase (wrapping), whatever `row` says.
export function fftOp(spec, row, id, c = {}) {
  const mag = Float64Array.from(spec.mag), ph = Float64Array.from(spec.ph), isPh = row === 'ph';
  const v = isPh ? ph : mag, clr = isPh ? 0.5 : 0, n = v.length, bin = clamp(Math.round(+c.bin || 1), 1, n);
  const r = mulberry32((c.seed >>> 0) || 1);
  switch (id) {
    case 'clearAll': v.fill(clr); break;
    case 'clearHF': v.fill(clr, bin - 1); break;
    case 'clearLF': v.fill(clr, 0, bin); break;
    case 'saw':
      ph.fill(0.5);
      if (!isPh) for (let k = 1; k <= n; k++) mag[k - 1] = Math.sqrt(1 / k);
      break;
    case 'randLow': for (let k = 0; k < bin; k++) v[k] = r(); break;
    case 'randLowHalf': for (let k = 0; k < bin; k++) v[k] = Math.floor(r() * 3) / 2; break;
    case 'randAll': for (let k = 0; k < n; k++) v[k] = r(); break;
    case 'gaps': for (let k = 0; k < n; k++) if (r() < 0.5) v[k] = clr; break;
    case 'fade': for (let k = 1; k <= n; k++) { const g = (1 - k / 1024) * (1 - k / 1024); v[k - 1] = isPh ? 0.5 + (v[k - 1] - 0.5) * g : v[k - 1] * g; } break;
    case 'octUp': { const o = new Float64Array(n).fill(clr); for (let k = 1; 2 * k <= n; k++) o[2 * k - 1] = v[k - 1]; v.set(o); break; }
    case 'octDown': { const o = new Float64Array(n).fill(clr); for (let k = 1; 2 * k <= n; k++) o[k - 1] = v[2 * k - 1]; v.set(o); break; }
    case 'odd': for (let k = 2; k <= n; k += 2) v[k - 1] = clr; break;
    case 'even': for (let k = 1; k <= n; k += 2) v[k - 1] = clr; break;
    case 'repeatGroup': for (let k = bin + 1; k <= Math.min(1023, n); k++) v[k - 1] = v[(k - 1) % bin]; break;
    case 'nudgePhase': ph[bin - 1] = frac(ph[bin - 1] + 1 / 64); break;
    default: throw new Error('Unknown FFT operation: ' + id);
  }
  if (!isPh) { // a magnitude written into an empty bin starts at sine phase (as q-formulas do)
    const thr = emptyThreshold(spec.mag);
    for (let k = 0; k < n; k++) if (!(spec.mag[k] >= thr) && mag[k] >= thr) ph[k] = 0.5;
  }
  return { mag, ph, dc: spec.dc || 0 };
}
