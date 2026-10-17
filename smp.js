// smp.js — pure helpers of the sample / IR pipeline (owner S1; SPEC-serum2 §9, §4.5, §11.12). ES module, imports only
// wt.js; node-, worker- and main-thread-importable (no DOM, no storage, no globals touched at load).
//
// Records (in-memory and smpstore, §9.2): sample `{kind: 'smp', name, rate, ch, len, L, R, root, loop: {start, end} |
// null, …}`, multisample `{kind: 'multi', name, zones}`, IR `{kind: 'ir', name, rate, ch, len, L, R}`. Every function
// accepts PCM channels as Float32Array, any numeric array view, or an ArrayBuffer holding little-endian Float32 (the
// smpstore form), and returns fresh Float32Arrays (inputs are never modified).
//
// Extra exports (IMPL, used by smpwork, smpgen, assets and the tests): SPEC_VER, WT_ROOT, FADE_MS, toF32(x), NOTE_RE
// (the file-name root rule), ENOTIMPL, fft(re, im, n, inverse) (radix-2, any power of two up to 2^23), nextPow2,
// mono(L, R), wavChunks(buf), fileRate(bytes), sfzNote(text), yinF0(x, rate, from, to), minPhase(x, n),
// spectrogram(L, R, rate, w, h), overview(L, R, n), irRT60(L, rate).
// IMPL details where §9 is silent (normative for this project, the tests depend on them):
// - resample: output length round(len·to/from); kernel = Kaiser(β 8)-windowed sinc with 32 zero crossings per side at
//   the lower rate, cutoff 0.92 × the lower Nyquist (passband flat to 0.84·Nyquist, ≥ 80 dB stopband from Nyquist on).
// - odf: frame t covers samples [(t+1)·256 − 1024, (t+1)·256) (zero-padded), so odf[t] sits at sample t·256 (the
//   newest hop of frame t); length ceil(len/256). slicesFromOdf: local maxima (> left, ≥ right) above thr, kept
//   strongest first with ≥ 50 ms to every kept mark and to the start, ≤ 256, sorted; marks in (0, 1).
// - specAnalyse: frames = floor(len/hop) + 1, frame t centred at t·hop; mono = (L + R)/2.
// - rootFromWav: smpl → inst (UnshiftedNote + FineTune/100) → acid (root-note flag 0x02); readAiff root = INST base
//   note (detune ignored, §9.3), loop = the INST sustain loop (play mode ≠ 0) through its MARK positions.
// - parseSfz: a region's `tune`/`transpose` become the zone's sample tuning `tune = −(tune + 100·transpose)` cents (the
//   zone ratio is 2^((P − root − tune/100)/12), §6.8); `mode` / `ls` / `le` are null when the SFZ leaves them open
//   (the importer then uses the sample's own loop); loop_end / end are inclusive in SFZ and exclusive here.
// - irShape: neutral values are skipped (size 1, tone 0, att 0, dec 1, damp 0, minph 0); DAMP splits with an LR2
//   low-pass at 2 kHz and its exact complement (high = x − low), so damp 0 is the identity; MIN PHASE floors |X| at
//   −200 dB re its maximum. A tail cut by the length cap (SIZE stretch or convMax) gets a half-cosine fade over its
//   last 10 % (no gate-like stop).
// - loopSearch: crossings and YIN on the mono sum; f0 ≤ 0 ⇒ YIN on the region; seam error = RMS over x[ls + j] −
//   x[le + j], j = −16 … 15, over every channel.
// - sampleLevels(…, loop): loop-aware decimation (see there); odf[0] = 0 (no predecessor frame); specAnalyse cuts a
//   > 48 kHz source to 20 s before resampling; bakeLoop(L, R, ls, le, n) (factory loop crossfades); aiffInfo(buf)
//   (root / loop / rate / frames of an AIFF without decoding, for files the browser decodes).
import { FRAME, noiseLevels, HALFBAND } from './wt.js?v=10';

/** Error code of a not-implemented helper (kept for callers that test for it; every helper is implemented). */
export const ENOTIMPL = 'ENOTIMPL';
const deepFreeze = o => { Object.freeze(o); for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); return o; };

/** Normative limits of §9 (seconds, Hz, counts, bytes). */
export const LIMITS = deepFreeze({
  sampleSec: 60,        // §9.3 step 3: a sample is truncated to 60 s (notice)
  zoneSec: 30,          // multisample zone sample
  irSec: 10,            // impulse response (import and §9.4.7 preparation)
  maxRate: 96000,       // canonical rate cap of stored records (higher rates are resampled to 96 kHz)
  decodeRate: 48000,    // rate of OfflineAudioContext.decodeAudioData (non-WAV/AIFF formats)
  playRate: 48000,      // playback entries and spectral analyses are ≤ 48 kHz (§9.4.3, §9.4.6)
  channels: 2,          // > 2 channels: the first two are kept
  levels: 8,            // playback levels at most (§9.4.3) …
  minLevelLen: 64,      // … or until a level would be shorter than this
  zones: 512,           // multisample zones per entry (§4.5)
  slices: 256,          // auto slices at most (§9.4.5)
  sliceGapMs: 50,       // minimum distance between auto slices
  specSec: 20,          // spectral analysis cap (§9.4.6)
  specN: 2048,          // analysis frame size N_a (hop N_a/4)
  odfN: 1024,           // onset function STFT size …
  odfHop: 256,          // … and hop
  sfzBytes: 65536,      // SFZ text kept in a multisample record (src.sfz)
  resampleTaps: 32,     // windowed-sinc resampler taps per side …
  resampleBeta: 8,      // … Kaiser β
  irHeadDb: -60,        // §9.4.7 leading trim threshold (re peak), 1 ms kept before the first louder sample
  irTailDb: -90,        // trailing trim threshold
});

/** Version of the spectral analysis (§9.4.6): part of its cache key `spec:<playback id>@<SPEC_VER>` (§9.2). */
export const SPEC_VER = 1;
/** Root of a wavetable played as a sample (§9.4.8): one 2048-sample frame = one cycle at 48 kHz. */
export const WT_ROOT = 69 + 12 * Math.log2(48000 / (2048 * 440));
/** §3.9 FADE_MS: `smpo.ops.fade` indexes this list (ms). Equal to serum-core FADE_MS. */
export const FADE_MS = deepFreeze([0, 1, 2, 4, 8, 16, 32, 64, 128]);

// ------------------------------------------------------------------------------------------------ small helpers
const LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const TAU = 2 * Math.PI;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const fin = (v, d) => (Number.isFinite(v) ? +v : d);
/** Float32Array (fresh copy) of PCM given as a Float32Array / numeric view / array / little-endian ArrayBuffer. */
export function toF32(x) {
  if (x == null) return null;
  if (x instanceof Float32Array) return x.slice();
  if (ArrayBuffer.isView(x)) return Float32Array.from(x);
  if (x instanceof ArrayBuffer || (typeof x.byteLength === 'number' && typeof x.slice === 'function' && !Array.isArray(x))) {
    const n = x.byteLength >> 2;
    if (LE) return new Float32Array(x.slice(0, n * 4));
    const dv = new DataView(x), a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = dv.getFloat32(i * 4, true);
    return a;
  }
  return Float32Array.from(x);
}
// read-only view (no copy when already a Float32Array) — internal use where the input is not modified
const view32 = x => (x == null ? null : x instanceof Float32Array ? x : toF32(x));
const u8 = b => (b instanceof Uint8Array ? b : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b));
/** Mono sum (L + R)/2 (or L) as Float64Array of length min(|L|, |R|) — analyses read this. */
export function mono(L, R) {
  const a = view32(L), b = R != null ? view32(R) : null, n = b ? Math.min(a.length, b.length) : a.length, o = new Float64Array(n);
  if (b) for (let i = 0; i < n; i++) o[i] = 0.5 * (a[i] + b[i]);
  else for (let i = 0; i < n; i++) o[i] = a[i];
  for (let i = 0; i < n; i++) if (!Number.isFinite(o[i])) o[i] = 0;
  return o;
}
const peakOf = (...xs) => { let p = 0; for (const x of xs) if (x) for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; } return p; };
const finiteF32 = x => { for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) x[i] = 0; return x; };
function besselI0(x) {
  let s = 1, t = 1;
  for (let k = 1; k < 80; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; if (t < 1e-17 * s) break; }
  return s;
}
/** Smallest power of two ≥ n (≥ 2). */
export function nextPow2(n) { let m = 2; while (m < n) m *= 2; return m; }

// ------------------------------------------------------------------------------------------------ FFT
// In-place radix-2 complex FFT of length n (a power of two, 2 … 2^23) on Float64Arrays; forward e^{−2πijk/n}
// unscaled, inverse scaled 1/n (the wt.js / SxBase convention). Twiddles are cached for n ≤ 65536.
const FFT_TAB = new Map();
function twiddles(n) {
  let t = FFT_TAB.get(n);
  if (t) return t;
  const h = n >> 1, c = new Float64Array(h), s = new Float64Array(h);
  for (let k = 0; k < h; k++) { const a = TAU * k / n; c[k] = Math.cos(a); s[k] = Math.sin(a); }
  t = { c, s };
  if (n <= 65536) { if (FFT_TAB.size > 24) FFT_TAB.clear(); FFT_TAB.set(n, t); }
  return t;
}
export function fft(re, im, n, inverse) {
  if (!(n >= 2 && (n & (n - 1)) === 0 && n <= 8388608)) throw new Error('smp.fft: n must be a power of two in [2, 2^23]');
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  const { c, s } = twiddles(n), sg = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const wr = c[k], wi = sg * s[k], a = i + j, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
  if (inverse) { const g = 1 / n; for (let i = 0; i < n; i++) { re[i] *= g; im[i] *= g; } }
}
// Two real signals at once: re ← a, im ← b (already filled, length n) → their half spectra (bins 0 … n/2) in
// ar/ai and br/bi (X_a[k] = (Z[k] + conj Z[n−k])/2, X_b[k] = (Z[k] − conj Z[n−k])/(2i)).
function fft2real(re, im, n, ar, ai, br, bi) {
  fft(re, im, n, false);
  const h = n >> 1;
  for (let k = 0; k <= h; k++) {
    const k2 = (n - k) & (n - 1), zr = re[k], zi = im[k], wr = re[k2], wi = im[k2];
    ar[k] = 0.5 * (zr + wr); ai[k] = 0.5 * (zi - wi);
    if (br) { br[k] = 0.5 * (zi + wi); bi[k] = -0.5 * (zr - wr); }
  }
}

// ------------------------------------------------------------------------------------------------ §9.3 import
const ascii = (b, o, n) => { let s = ''; for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]); return s; };
const SFZ_RE = /<(region|group|control|global)>/i;
/**
 * §9.3 step 1: the file type by magic bytes → 'wav' | 'aiff' | 'flac' | 'ogg' | 'mp3' | 'm4a' | 'zip' | 'png' |
 * 'sfz' | null. `bytes`: Uint8Array / any view / ArrayBuffer (the first 64 KB suffice).
 */
export function sniff(bytes) {
  if (bytes == null) return null;
  const b = u8(bytes);
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return 'wav';
  if (b.length >= 12 && ascii(b, 0, 4) === 'FORM' && /^AIF[FC]$/.test(ascii(b, 8, 4))) return 'aiff';
  if (b.length >= 4 && ascii(b, 0, 4) === 'fLaC') return 'flac';
  if (b.length >= 4 && ascii(b, 0, 4) === 'OggS') return 'ogg';
  if (b.length >= 8 && ascii(b, 4, 4) === 'ftyp') return 'm4a';
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4) return 'zip';
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && b[4] === 13 && b[5] === 10 && b[6] === 26 && b[7] === 10) return 'png';
  if (b.length >= 3 && ascii(b, 0, 3) === 'ID3') return 'mp3';
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0) return 'mp3'; // MPEG frame sync, layer ≠ 0
  const n = Math.min(b.length, LIMITS.sfzBytes);
  let text = '';
  for (let i = 0; i < n; i++) { const c = b[i]; if (c === 0) return null; text += String.fromCharCode(c); }
  return SFZ_RE.test(text) ? 'sfz' : null;
}

// IEEE 754 80-bit extended (AIFF COMM sample rate), big-endian
function ext80(dv, o) {
  const se = dv.getUint16(o), hi = dv.getUint32(o + 2), lo = dv.getUint32(o + 6), e = se & 0x7fff;
  if (e === 0 && hi === 0 && lo === 0) return 0;
  return (se & 0x8000 ? -1 : 1) * (hi * 4294967296 + lo) * Math.pow(2, e - 16383 - 63);
}
// the chunks of an AIFF / AIFC file: COMM, SSND position, MARKs, INST (no sample data read)
function aiffChunks(buf) {
  if (buf == null) throw new Error('Not an AIFF file');
  const b = u8(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 12 || ascii(b, 0, 4) !== 'FORM') throw new Error('Not an AIFF file');
  const form = ascii(b, 8, 4);
  if (form !== 'AIFF' && form !== 'AIFC') throw new Error('Not an AIFF file');
  let comm = null, ssnd = null, inst = null, pos = 12;
  const marks = new Map();
  while (pos + 8 <= b.length) {
    const id = ascii(b, pos, 4), len = dv.getUint32(pos + 4, false), body = pos + 8, end = Math.min(b.length, body + len);
    if (id === 'COMM' && end - body >= 18) {
      comm = { nch: dv.getInt16(body), frames: dv.getUint32(body + 2), bits: dv.getInt16(body + 6), rate: ext80(dv, body + 8), comp: 'NONE' };
      if (form === 'AIFC' && end - body >= 22) comm.comp = ascii(b, body + 18, 4);
    } else if (id === 'SSND' && end - body >= 8) {
      const off = body + 8 + dv.getUint32(body);
      ssnd = { off, len: Math.max(0, end - off) };
    } else if (id === 'MARK' && end - body >= 2) {
      let n = dv.getUint16(body), p = body + 2;
      while (n-- > 0 && p + 7 <= end) {
        const sl = b[p + 6];
        marks.set(dv.getInt16(p), dv.getUint32(p + 2));
        p += 7 + sl + ((1 + sl) & 1); // pstring padded to an even total length
      }
    } else if (id === 'INST' && end - body >= 14) {
      inst = { base: dv.getInt8(body), mode: dv.getInt16(body + 8), begin: dv.getInt16(body + 10), end: dv.getInt16(body + 12) };
    }
    const next = body + len + (len & 1);
    if (next <= pos) break;
    pos = next;
  }
  return { b, dv, comm, ssnd, inst, marks };
}
const aiffLoop = (inst, marks, frames) => {
  if (!(inst && inst.mode !== 0 && marks.has(inst.begin) && marks.has(inst.end))) return null;
  const s = marks.get(inst.begin), e = Math.min(frames, marks.get(inst.end));
  return s < e ? { start: s, end: e } : null;
};
/**
 * The header facts of an AIFF / AIFC file without decoding its samples (any compression; the import path for files
 * the readers cannot decode, §9.3 steps 4–5) → {rate, ch, frames, comp, root, loop} (root = INST base note or null,
 * loop = the INST sustain loop through its MARKs in the file's frames, or null). Throws 'Not an AIFF file'.
 */
export function aiffInfo(buf) {
  const { comm, inst, marks } = aiffChunks(buf);
  if (!comm) throw new Error('Not an AIFF file');
  return { rate: comm.rate, ch: Math.min(2, Math.max(1, comm.nch)), frames: comm.frames, comp: comm.comp, root: inst ? inst.base : null, loop: aiffLoop(inst, marks, comm.frames) };
}
/**
 * §9.3 step 2: decodes an AIFF / AIFC file (NONE / twos, sowt, fl32, fl64; 8–32-bit, left-justified) → {rate, ch, len,
 * L, R, root, loop}: ch ≤ 2 (the first two channels), root = INST base note (null without INST), loop = the INST
 * sustain loop through its MARKs (null when off or unresolvable). Throws 'Not an AIFF file' / 'Unsupported AIFF …'.
 */
export function readAiff(buf) {
  const { b, dv, comm, ssnd, inst, marks } = aiffChunks(buf);
  if (!comm || !ssnd) throw new Error('Not an AIFF file');
  const comp = comm.comp.toLowerCase(), nch = comm.nch;
  let kind, bps;
  if (comp === 'none' || comp === 'twos') { kind = 'be'; bps = Math.ceil(comm.bits / 8); }
  else if (comp === 'sowt') { kind = 'le'; bps = Math.ceil(comm.bits / 8); }
  else if (comp === 'fl32') { kind = 'f32'; bps = 4; }
  else if (comp === 'fl64') { kind = 'f64'; bps = 8; }
  else throw new Error('Unsupported AIFF compression ' + comm.comp);
  if (!(nch >= 1) || !(bps >= 1 && bps <= 8) || ((kind === 'be' || kind === 'le') && bps > 4) || !(comm.rate > 0)) throw new Error('Unsupported AIFF format');
  const fsz = bps * nch, frames = Math.min(comm.frames, Math.floor(ssnd.len / fsz)), ch = Math.min(2, nch);
  const out = [new Float32Array(frames), ch === 2 ? new Float32Array(frames) : null];
  const scale = 1 / Math.pow(2, 8 * bps - 1);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      const o = ssnd.off + i * fsz + c * bps;
      let v;
      if (kind === 'f32') v = dv.getFloat32(o, false);
      else if (kind === 'f64') v = dv.getFloat64(o, false);
      else {
        let x = 0;
        if (kind === 'be') for (let k = 0; k < bps; k++) x = x * 256 + b[o + k];
        else for (let k = bps - 1; k >= 0; k--) x = x * 256 + b[o + k];
        const full = Math.pow(2, 8 * bps);
        if (x >= full / 2) x -= full;
        v = x * scale;
      }
      out[c][i] = Number.isFinite(v) ? v : 0;
    }
  }
  return { rate: comm.rate, ch, len: frames, L: out[0], R: out[1], root: inst ? inst.base : null, loop: aiffLoop(inst, marks, frames) };
}

// Kaiser-windowed sinc table for the resampler: T(u), u ∈ [0, 32] zero crossings of the lower rate, 1024 steps per unit
const RS_W = 32, RS_RES = 1024, RS_CUT = 0.92;
let RS_T = null;
function rsTable() {
  if (RS_T) return RS_T;
  const n = RS_W * RS_RES, t = new Float64Array(n + 2), i0 = besselI0(LIMITS.resampleBeta);
  for (let j = 0; j <= n; j++) {
    const u = j / RS_RES, r = u / RS_W, x = Math.PI * RS_CUT * u;
    const sinc = u === 0 ? 1 : Math.sin(x) / x;
    t[j] = RS_CUT * sinc * (r >= 1 ? 0 : besselI0(LIMITS.resampleBeta * Math.sqrt(1 - r * r)) / i0);
  }
  return (RS_T = t);
}
function resample1(x, from, to, nOut) {
  const T = rsTable(), m = Math.min(1, to / from), W = RS_W / m, len = x.length, y = new Float32Array(nOut), step = from / to, lim = RS_W * RS_RES;
  for (let i = 0; i < nOut; i++) {
    const t = i * step, j0 = Math.max(0, Math.ceil(t - W)), j1 = Math.min(len - 1, Math.floor(t + W));
    let acc = 0;
    for (let j = j0; j <= j1; j++) {
      const u = Math.abs(t - j) * m * RS_RES, k = u | 0;
      if (k >= lim) continue;
      acc += x[j] * (T[k] + (T[k + 1] - T[k]) * (u - k));
    }
    y[i] = acc * m;
  }
  return y;
}
/**
 * Windowed-sinc resampler (32 taps per side, Kaiser β 8; band-limited to the lower Nyquist) → {L, R} at rate `to`
 * (R null for mono input), length round(len·to/from). Used for > 96 kHz imports, ≤ 48 kHz playback levels and IR
 * preparation. from === to: a copy.
 */
export function resample(L, R, from, to) {
  if (!(from > 0) || !(to > 0)) throw new Error('smp.resample: rates must be > 0');
  const a = finiteF32(toF32(L)), b = R != null ? finiteF32(toF32(R)) : null;
  if (from === to) return { L: a, R: b };
  const n = Math.max(1, Math.round(a.length * to / from));
  return { L: resample1(a, from, to, n), R: b ? resample1(b, from, to, n) : null };
}

// Serum file-name convention (§9.3 step 4): `[ _]<Note><Octave>` right before the extension, C3 = MIDI 60, octave
// −2…8, sharps '#', flats 'b'.
export const NOTE_RE = /[ _]([A-Ga-g])(#|b)?(-[12]|[0-8])$/;
const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
/** The root note encoded in a file name (C3 = 60), or null when the name carries none. */
export function rootFromName(name) {
  if (typeof name !== 'string') return null;
  const base = name.replace(/^.*[\\/]/, '').replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const m = NOTE_RE.exec(base);
  if (!m) return null;
  const n = 60 + (+m[3] - 3) * 12 + PC[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return n >= 0 && n <= 127 ? n : null;
}

/**
 * The sample rate a file's frame positions refer to (SFZ loop / offset / end points, §9.3 step 7), read from its header
 * without decoding: WAV `fmt `, AIFF `COMM`, FLAC STREAMINFO, Ogg Vorbis identification header, Ogg Opus (48 kHz) →
 * Hz, or null (other formats, malformed headers).
 */
export function fileRate(bytes) {
  if (bytes == null) return null;
  const b = u8(bytes), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), t = sniff(b.subarray(0, 64));
  const ok = r => (r > 0 && r <= 768000 ? r : null);
  try {
    if (t === 'wav') { const f = wavChunks(b).find(c => c.id === 'fmt '); return f && f.len >= 8 ? ok(dv.getUint32(f.off + 4, true)) : null; }
    if (t === 'aiff') {
      for (let pos = 12; pos + 8 <= b.length;) {
        const id = ascii(b, pos, 4), len = dv.getUint32(pos + 4, false);
        if (id === 'COMM' && len >= 18) return ok(Math.round(ext80(dv, pos + 8 + 8)));
        const next = pos + 8 + len + (len & 1);
        if (next <= pos) break;
        pos = next;
      }
      return null;
    }
    if (t === 'flac') return b.length >= 21 && (b[4] & 0x7f) === 0 ? ok(((b[18] << 12) | (b[19] << 4) | (b[20] >> 4)) >>> 0) : null;
    if (t === 'ogg' && b.length >= 28 + 16) {
      const p = 27 + b[26]; // first page: header + segment table
      if (b[p] === 1 && ascii(b, p + 1, 6) === 'vorbis') return ok(dv.getUint32(p + 12, true));
      if (ascii(b, p, 8) === 'OpusHead') return 48000;
    }
  } catch { /* truncated header */ }
  return null;
}

/** RIFF chunks of a WAV file → [{id, off, len}] (offsets of the chunk bodies into the bytes). Non-WAV: []. */
export function wavChunks(buf) {
  const b = u8(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), out = [];
  if (b.length < 12 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WAVE') return out;
  let pos = 12;
  while (pos + 8 <= b.length) {
    const id = ascii(b, pos, 4), len = dv.getUint32(pos + 4, true), body = pos + 8;
    out.push({ id, off: body, len: Math.max(0, Math.min(len, b.length - body)) });
    if (id === 'data' && len === 0xFFFFFFFF) break;
    const next = body + len + (len & 1);
    if (next <= pos) break;
    pos = next;
  }
  return out;
}
/**
 * §9.3 step 4–5: root (fractional MIDI) and loop from a WAV's chunks — `smpl` (MIDIUnityNote + MIDIPitchFraction/2³²;
 * first loop start … end + 1), else `inst` (UnshiftedNote + FineTune cents), else `acid` (root note when flag 0x02 is
 * set) → {root: number | null, loop: {start, end} | null}. `wav`: the file bytes (ArrayBuffer / view), an object with
 * them in `buf` / `bytes` (e.g. wt.readWav's result plus its file), or `{chunks: [{id, data}]}` (data: bytes of the body).
 */
export function rootFromWav(wav) {
  let list = [];
  if (wav != null && (wav instanceof ArrayBuffer || ArrayBuffer.isView(wav))) {
    const b = u8(wav);
    list = wavChunks(b).map(c => ({ id: c.id, data: b.subarray(c.off, c.off + c.len) }));
  } else if (wav && Array.isArray(wav.chunks)) {
    list = wav.chunks.filter(c => c && typeof c.id === 'string' && c.data != null).map(c => ({ id: c.id, data: u8(c.data) }));
  } else if (wav && (wav.buf || wav.bytes)) return rootFromWav(wav.buf || wav.bytes);
  const get = id => list.find(c => c.id === id) || null;
  const dvOf = c => new DataView(c.data.buffer, c.data.byteOffset, c.data.byteLength);
  let root = null, loop = null;
  const smpl = get('smpl');
  if (smpl && smpl.data.length >= 36) {
    const dv = dvOf(smpl), unity = dv.getUint32(12, true), frac = dv.getUint32(16, true), n = dv.getUint32(28, true);
    if (unity <= 127) root = unity + frac / 4294967296;
    if (n > 0 && smpl.data.length >= 60) {
      const s = dv.getUint32(44, true), e = dv.getUint32(48, true);
      if (e >= s) loop = { start: s, end: e + 1 };
    }
  }
  const inst = get('inst');
  if (root === null && inst && inst.data.length >= 2) {
    const dv = dvOf(inst), note = dv.getUint8(0), fine = dv.getInt8(1);
    if (note <= 127) root = note + fine / 100;
  }
  const acid = get('acid');
  if (root === null && acid && acid.data.length >= 6) {
    const dv = dvOf(acid), flags = dv.getUint32(0, true), note = dv.getUint16(4, true);
    if ((flags & 2) && note <= 127) root = note;
  }
  return { root, loop };
}

// ------------------------------------------------------------------------------------------------ SFZ (§9.3 step 7)
const SFZ_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
/** An SFZ key value (number or note name, c4 = 60) → MIDI number or null. */
export function sfzNote(text) {
  const s = String(text == null ? '' : text).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Math.round(+s);
  const m = /^([a-gA-G])([#b♯♭]?)(-?\d+)$/.exec(s);
  if (!m) return null;
  return 12 * (+m[3] + 1) + SFZ_PC[m[1].toLowerCase()] + (m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0);
}
const SFZ_KNOWN = new Set(['sample', 'lokey', 'hikey', 'key', 'pitch_keycenter', 'lovel', 'hivel', 'tune', 'transpose', 'volume', 'pan',
  'amp_veltrack', 'loop_mode', 'loopmode', 'loop_start', 'loopstart', 'loop_end', 'loopend', 'offset', 'end', 'ampeg_delay', 'ampeg_attack', 'ampeg_hold',
  'ampeg_decay', 'ampeg_sustain', 'ampeg_release', 'seq_length', 'seq_position', 'trigger', 'default_path', 'note_offset', 'octave_offset']);
const SFZ_HEADERS = ['control', 'global', 'master', 'group', 'region'];
function sfzOpcodes(text) {
  const out = [], re = /([A-Za-z][A-Za-z0-9_]*)\s*=/g, found = [];
  let m;
  while ((m = re.exec(text))) found.push({ k: m[1].toLowerCase(), s: m.index, v: re.lastIndex });
  for (let i = 0; i < found.length; i++) {
    const f = found[i], end = i + 1 < found.length ? found[i + 1].s : text.length;
    out.push([f.k, text.slice(f.v, end).trim()]);
  }
  return out;
}
/**
 * §9.3 step 7: SFZ text → {regions, warnings}. Regions: {sample (path, default_path applied, '/' separators), lo, hi,
 * vlo, vhi, root, tune (cents, the sample's tuning), gain (dB), pan (−1…1), mode ('oneshot' | 'loop' | 'sustain' | null),
 * ls, le (frames, null when open), off, end (frames, exclusive, null), env ([delay, a, h, d, s 0–1, r] s or null), rr
 * ([seq_length, seq_position]), vt (0–1; 1 without amp_veltrack)}. Headers <control> (default_path, note_offset,
 * octave_offset), <global>, <master>, <group>, <region> with inheritance; trigger=release regions, #define, #include,
 * other headers and other opcodes are ignored and listed once in `warnings`.
 */
export function parseSfz(text) {
  const warnings = [], ignored = new Set(), otherHeaders = new Set();
  let src = String(text == null ? '' : text).replace(/\/\*[\s\S]*?\*\//g, ' ');
  let pre = 0;
  src = src.split(/\r?\n/).map(l => {
    const c = l.indexOf('//');
    const s = c >= 0 ? l.slice(0, c) : l;
    if (/^\s*#(define|include)\b/i.test(s)) { pre++; return ''; }
    return s;
  }).join('\n');
  const ctl = { default_path: '', note_offset: 0, octave_offset: 0 };
  let glob = {}, mast = {}, grp = {}, cur = null, release = 0, negVt = false;
  const regions = [], raw = [];
  const re = /<\s*([A-Za-z_]+)\s*>/g;
  const parts = [];
  let m, last = 0, head = null;
  while ((m = re.exec(src))) { parts.push([head, src.slice(last, m.index)]); head = m[1].toLowerCase(); last = re.lastIndex; }
  parts.push([head, src.slice(last)]);
  for (const [h, body] of parts) {
    if (h === null) continue; // text before the first header
    if (!SFZ_HEADERS.includes(h)) { otherHeaders.add(h); cur = null; continue; }
    const ops = sfzOpcodes(body);
    if (h === 'control') {
      for (const [k, v] of ops) {
        if (k === 'default_path') ctl.default_path = v.replace(/\\/g, '/');
        else if (k === 'note_offset') ctl.note_offset = Math.round(fin(+v, 0));
        else if (k === 'octave_offset') ctl.octave_offset = Math.round(fin(+v, 0));
        else ignored.add(k);
      }
      continue;
    }
    if (h === 'global') { glob = {}; mast = {}; grp = {}; cur = glob; }
    else if (h === 'master') { mast = {}; grp = {}; cur = mast; }
    else if (h === 'group') { grp = {}; cur = grp; }
    else { cur = {}; raw.push({ inh: Object.assign({}, glob, mast, grp), own: cur, ctl: Object.assign({}, ctl) }); }
    for (const [k, v] of ops) { if (!SFZ_KNOWN.has(k)) ignored.add(k); else cur[k] = v; }
  }
  for (const r of raw) {
    const o = Object.assign({}, r.inh, r.own), c = r.ctl;
    if (!o.sample) continue;
    const trig = String(o.trigger || 'attack').trim().toLowerCase().split(/\s+/)[0];
    if (trig === 'release' || trig === 'release_key') { release++; continue; }
    const shift = c.note_offset + 12 * c.octave_offset;
    const note = v => { const n = sfzNote(String(v).split(/\s+/)[0]); return n === null ? null : n + shift; };
    const num = (k, d) => { if (o[k] == null) return d; const n = parseFloat(String(o[k]).split(/\s+/)[0]); return Number.isFinite(n) ? n : d; };
    let lo = 0, hi = 127, root = 60;
    if (o.key != null) { const k = note(o.key); if (k !== null) { lo = hi = root = k; } }
    if (o.lokey != null) { const k = note(o.lokey); if (k !== null) lo = k; }
    if (o.hikey != null) { const k = note(o.hikey); if (k !== null) hi = k; }
    if (o.pitch_keycenter != null) { const k = note(o.pitch_keycenter); if (k !== null) root = k; }
    lo = clamp(lo, 0, 127); hi = clamp(hi, 0, 127);
    if (hi < lo) { const t = lo; lo = hi; hi = t; }
    let vlo = clamp(Math.round(num('lovel', 0)), 0, 127), vhi = clamp(Math.round(num('hivel', 127)), 0, 127);
    if (vhi < vlo) { const t = vlo; vlo = vhi; vhi = t; }
    const lm = String(o.loop_mode != null ? o.loop_mode : o.loopmode != null ? o.loopmode : '').trim().toLowerCase().split(/\s+/)[0];
    const mode = lm === 'no_loop' || lm === 'one_shot' ? 'oneshot' : lm === 'loop_continuous' ? 'loop' : lm === 'loop_sustain' ? 'sustain' : null;
    const lsv = o.loop_start != null ? 'loop_start' : 'loopstart', lev = o.loop_end != null ? 'loop_end' : 'loopend';
    const ls = o[lsv] != null ? Math.max(0, Math.round(num(lsv, 0))) : null;
    const le = o[lev] != null ? Math.max(0, Math.round(num(lev, 0)) + 1) : null;
    let vt = 1;
    if (o.amp_veltrack != null) { const v = num('amp_veltrack', 100); if (v < 0) negVt = true; vt = clamp(v / 100, 0, 1); }
    const envKeys = ['ampeg_delay', 'ampeg_attack', 'ampeg_hold', 'ampeg_decay', 'ampeg_sustain', 'ampeg_release'];
    const env = envKeys.some(k => o[k] != null)
      ? [Math.max(0, num('ampeg_delay', 0)), Math.max(0, num('ampeg_attack', 0)), Math.max(0, num('ampeg_hold', 0)), Math.max(0, num('ampeg_decay', 0)),
        clamp(num('ampeg_sustain', 100) / 100, 0, 1), Math.max(0, num('ampeg_release', 0))]
      : null;
    const sl = Math.max(1, Math.round(num('seq_length', 1))), sp = clamp(Math.round(num('seq_position', 1)), 1, sl);
    const path = (c.default_path + String(o.sample).trim()).replace(/\\/g, '/');
    regions.push({
      sample: path, lo, hi, vlo, vhi, root, tune: -(num('tune', 0) + 100 * num('transpose', 0)), gain: num('volume', 0),
      pan: clamp(num('pan', 0) / 100, -1, 1), mode, ls, le, off: Math.max(0, Math.round(num('offset', 0))),
      end: o.end != null ? Math.max(0, Math.round(num('end', 0)) + 1) : null, env, rr: [sl, sp], vt,
    });
  }
  if (ignored.size) warnings.push('Ignored SFZ opcodes: ' + [...ignored].sort().join(', '));
  if (otherHeaders.size) warnings.push('Ignored SFZ headers: ' + [...otherHeaders].sort().map(h => '<' + h + '>').join(', '));
  if (release) warnings.push(release + ' release-trigger region' + (release > 1 ? 's' : '') + ' ignored');
  if (pre) warnings.push('#define / #include are not supported');
  if (negVt) warnings.push('Negative amp_veltrack set to 0');
  return { regions, warnings };
}

// ------------------------------------------------------------------------------------------------ ZIP (§9.3 step 6)
function utf8(b) {
  if (typeof TextDecoder === 'function') { try { return new TextDecoder('utf-8').decode(b); } catch { /* fall through */ } }
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}
/**
 * §9.3 step 6: ZIP central directory → [{name, size, method, data: () => Promise<Uint8Array>}] with `skipped` (names of
 * entries that cannot be read: deflated ones without `inflate`, other methods, encrypted, ZIP64). Stored entries are
 * returned as views; deflated ones through `inflate(bytes) → Promise<Uint8Array>` (DecompressionStream('deflate-raw')
 * on the main thread). Directories, `__MACOSX/` and `._*` entries are left out. Not a ZIP: throws.
 */
export function zipEntries(buf, inflate) {
  const b = u8(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a ZIP file');
  const count = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true);
  const out = [], skipped = [];
  let p = cdOff;
  for (let n = 0; n < count && p + 46 <= b.length; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = utf8(b.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;
    const base = name.replace(/^.*\//, '');
    if (!base || name.endsWith('/') || name.startsWith('__MACOSX/') || base.startsWith('._')) continue;
    if ((flags & 1) || csize === 0xFFFFFFFF || size === 0xFFFFFFFF || lho + 30 > b.length || dv.getUint32(lho, true) !== 0x04034b50) { skipped.push(name); continue; }
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true), end = start + csize;
    if (end > b.length) { skipped.push(name); continue; }
    const raw = b.subarray(start, end);
    if (method === 0) out.push({ name, size, method, data: () => Promise.resolve(raw) });
    else if (method === 8 && typeof inflate === 'function') out.push({ name, size, method, data: () => Promise.resolve(inflate(raw)).then(u8) });
    else skipped.push(name);
  }
  out.skipped = skipped;
  return out;
}

// ------------------------------------------------------------------------------------------------ §9.4 analysis
/**
 * §9.4.2: the non-destructive ops `{trim: [a, b] | null, fade: 0–8, norm, rev}` applied to a record in the order
 * trim → reverse → normalize → fade (loop points mapped through trim and reverse) → a new record (Float32Array
 * channels; `odf`/`marks` dropped when trim or reverse moved the data). The playback entry bakes trim and fade only
 * (smpwork passes `{trim, fade}`); norm and rev are applied by the DSP.
 */
export function applyOps(rec, ops) {
  if (!rec || typeof rec !== 'object') throw new Error('smp.applyOps: no record');
  const o = ops && typeof ops === 'object' ? ops : {};
  let L = finiteF32(toF32(rec.L)), R = rec.R != null && rec.ch !== 1 ? finiteF32(toF32(rec.R)) : null;
  if (!L || !L.length) throw new Error('smp.applyOps: no samples');
  if (R && R.length !== L.length) { const r = new Float32Array(L.length); r.set(R.subarray(0, L.length)); R = r; }
  let len = L.length, loop = rec.loop && Number.isFinite(rec.loop.start) && Number.isFinite(rec.loop.end) ? { start: +rec.loop.start, end: +rec.loop.end } : null;
  const rate = rec.rate > 0 ? +rec.rate : 48000;
  let moved = false;
  if (Array.isArray(o.trim) && o.trim.length === 2 && Number.isFinite(o.trim[0]) && Number.isFinite(o.trim[1])) {
    const a = clamp(o.trim[0], 0, 1), b = clamp(o.trim[1], 0, 1);
    if (a < b && (a > 0 || b < 1)) {
      const s = Math.min(len - 1, Math.round(a * len)), e = Math.max(s + 1, Math.min(len, Math.round(b * len)));
      L = L.slice(s, e); if (R) R = R.slice(s, e);
      len = e - s;
      if (loop) { const ls = clamp(loop.start - s, 0, len), le = clamp(loop.end - s, 0, len); loop = ls < le ? { start: ls, end: le } : null; }
      moved = true;
    }
  }
  if (o.rev) {
    L.reverse(); if (R) R.reverse();
    if (loop) loop = { start: len - loop.end, end: len - loop.start };
    moved = true;
  }
  if (o.norm) {
    const p = peakOf(L, R);
    if (p > 0) { const g = 1 / p; for (let i = 0; i < len; i++) { L[i] *= g; if (R) R[i] *= g; } }
  }
  const fms = FADE_MS[clamp(Math.round(fin(o.fade, 0)), 0, FADE_MS.length - 1)];
  if (fms > 0) {
    const n = Math.min(Math.floor(len / 2), Math.round(fms * rate / 1000));
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos(Math.PI * i / n), j = len - 1 - i;
      L[i] *= w; L[j] *= w;
      if (R) { R[i] *= w; R[j] *= w; }
    }
  }
  const out = Object.assign({}, rec, { len, L, R, ch: R ? 2 : 1, loop });
  if (moved) { out.odf = null; if ('marks' in out) out.marks = null; }
  return out;
}

/**
 * §9.4.3: playback levels of level-0 data (≤ 48 kHz) → [{len, L, R}] (level ℓ+1 = the Phase-1 63-tap half-band of
 * level ℓ, decimated by 2: len ⌈len/2⌉), at most `maxLevels` (≤ 8) or until a level would be shorter than 64. Built by
 * wt.noiseLevels (owner W), which takes `maxLevels` as its 7th argument (§11.13). Non-finite samples become 0.
 * `loop` ({start, end} in level-0 frames, the entry's loop; IMPL): the playhead wraps from the loop end to its start,
 * so the filter must see that continuation — a loop over the whole data (a wavetable played as a sample, the factory
 * Loops, any file looped end to end) is decimated circularly (wt.noiseLevels' whole-loop mode, as Phase-1 noises);
 * an inner loop wraps the taps that leave [start, end) for the outputs inside it (outputs outside the loop: linear
 * convolution, zero-padded at the ends). Without a loop: linear convolution (§9.4.3).
 */
export function sampleLevels(L, R, len, maxLevels, loop = null) {
  const x = toF32(L), n = Math.min(len | 0, x.length);
  if (!(n >= 1)) throw new Error('smp.sampleLevels: no samples');
  const y = R != null ? toF32(R) : null, max = Math.max(1, Math.min(LIMITS.levels, maxLevels | 0 || LIMITS.levels));
  const yy = y && y.length >= n ? y : y ? Float32Array.from({ length: n }, (_, i) => y[i] || 0) : null;
  const ls = loop && Number.isFinite(loop.start) ? Math.max(0, Math.round(loop.start)) : -1, le = loop && Number.isFinite(loop.end) ? Math.min(n, Math.round(loop.end)) : -1;
  const lp = ls >= 0 && le > ls + 1;
  if (lp && ls === 0 && le === n) return noiseLevels(x, yy, n, 0, n, true, max).slice(0, max).map(l => ({ len: l.len, L: l.L, R: l.R || null }));
  if (!lp) return noiseLevels(x, yy, n, 0, n, false, max).slice(0, max).map(l => ({ len: l.len, L: l.L, R: l.R || null }));
  const out = [{ len: n, L: finiteF32(x.length === n ? x : x.slice(0, n)), R: yy ? finiteF32(yy.length === n ? yy : yy.slice(0, n)) : null }];
  let a = ls, b = le;
  while (out.length < max) {
    const p = out[out.length - 1];
    if ((p.len >> 1) < 64) break;
    out.push({ len: (p.len + 1) >> 1, L: loopHalf(p.L, p.len, a, b), R: p.R ? loopHalf(p.R, p.len, a, b) : null });
    a = Math.round(a / 2); b = Math.min((p.len + 1) >> 1, Math.round(b / 2));
    if (!(b > a + 1)) { a = -1; b = -1; } // the loop vanished at this level: linear from here on
  }
  return out;
}
// one half-band decimation step (the Phase-1 63-tap HALFBAND, odd taps + centre) of x[0, n) with loop [a, b): taps of
// an output inside the loop that leave it wrap into it; other taps read x (zero outside [0, n))
function loopHalf(x, n, a, b) {
  const n2 = (n + 1) >> 1, y = new Float32Array(n2), H = HALFBAND, c0 = H[31], P = b - a, loop = a >= 0 && P >= 2;
  const at = (i, inL) => {
    if (inL) {
      if (i >= b) i = a + ((i - b) % P);
      else if (i < a) i = b - 1 - ((a - 1 - i) % P);
      return x[i];
    }
    return i >= 0 && i < n ? x[i] : 0;
  };
  for (let m = 0; m < n2; m++) {
    const c = 2 * m, inL = loop && c >= a && c < b;
    let acc = c0 * x[c];
    for (let k = 1; k <= 31; k += 2) acc += H[31 + k] * (at(c - k, inL) + at(c + k, inL));
    y[m] = acc;
  }
  return y;
}

// Hann window of length n (periodic: w[i] = sin²(πi/n))
const HANN = new Map();
function hann(n) {
  let w = HANN.get(n);
  if (!w) { w = new Float64Array(n); for (let i = 0; i < n; i++) { const s = Math.sin(Math.PI * i / n); w[i] = s * s; } HANN.set(n, w); }
  return w;
}
// log-magnitude flux of consecutive frames: Σ_k max(0, ln(1 + 100|X_t,k|) − ln(1 + 100|X_t−1,k|))
function fluxOf(cur, prev, nb) {
  let f = 0;
  for (let k = 0; k < nb; k++) { const d = cur[k] - prev[k]; if (d > 0) f += d; }
  return f;
}
/**
 * §9.4.5: onset detection function (mono, STFT 1024 / hop 256, Hann, log-magnitude flux, max 1) → Float32Array with
 * one value per hop: odf[t] belongs to sample t·256 (frame t ends at (t + 1)·256). All-silent input: zeros.
 */
export function odf(L, R, rate) {
  const x = mono(L, R), len = x.length, N = LIMITS.odfN, H = LIMITS.odfHop, nb = N / 2 + 1, T = Math.max(1, Math.ceil(len / H));
  const w = hann(N), out = new Float32Array(T);
  const re = new Float64Array(N), im = new Float64Array(N), ar = new Float64Array(nb), ai = new Float64Array(nb), br = new Float64Array(nb), bi = new Float64Array(nb);
  let prev = new Float64Array(nb), cur = new Float64Array(nb), cur2 = new Float64Array(nb);
  const fill = (dst, t) => { const s = (t + 1) * H - N; for (let i = 0; i < N; i++) { const j = s + i; dst[i] = j >= 0 && j < len ? x[j] * w[i] : 0; } };
  for (let t = 0; t < T; t += 2) {
    fill(re, t);
    if (t + 1 < T) fill(im, t + 1); else im.fill(0);
    fft2real(re, im, N, ar, ai, br, bi);
    for (let k = 0; k < nb; k++) cur[k] = Math.log1p(100 * Math.hypot(ar[k], ai[k]));
    out[t] = fluxOf(cur, prev, nb);
    if (t + 1 < T) {
      for (let k = 0; k < nb; k++) cur2[k] = Math.log1p(100 * Math.hypot(br[k], bi[k]));
      out[t + 1] = fluxOf(cur2, cur, nb);
      const s = prev; prev = cur2; cur2 = s;
    } else { const s = prev; prev = cur; cur = s; }
  }
  out[0] = 0; // IMPL: the first frame has no predecessor (its flux would be the whole start of the file); never sliced
  let mx = 0;
  for (let t = 0; t < T; t++) if (out[t] > mx) mx = out[t];
  if (mx > 0) for (let t = 0; t < T; t++) out[t] /= mx;
  return out;
}

/** §9.4.5: auto slices — local maxima of `odf` above `thr`, ≥ 50 ms apart, ≤ 256 → marks (fractions of `len`). */
export function slicesFromOdf(odf, thr, rate, len) {
  const d = odf ? Array.from(odf) : [], H = LIMITS.odfHop, gap = LIMITS.sliceGapMs * 1e-3 * (rate > 0 ? rate : 48000), th = fin(thr, 0.5);
  if (!(len > 0)) return [];
  const peaks = [];
  for (let t = 0; t < d.length; t++) {
    const v = d[t], l = t > 0 ? d[t - 1] : 0, r = t + 1 < d.length ? d[t + 1] : 0;
    if (v > th && v > l && v >= r) peaks.push({ t, v, pos: t * H });
  }
  peaks.sort((a, b) => b.v - a.v || a.t - b.t);
  const kept = [];
  for (const p of peaks) {
    if (kept.length >= LIMITS.slices) break;
    if (p.pos < gap || p.pos >= len) continue;
    if (kept.some(k => Math.abs(k.pos - p.pos) < gap)) continue;
    kept.push(p);
  }
  return kept.map(p => p.pos / len).sort((a, b) => a - b);
}

/**
 * §9.4.6: spectral analysis → {rate, len, N, hop, frames, mag, ph, trans, peak} (mono (L + R)/2, resampled to ≤ 48 kHz,
 * first 20 s; Hann frames centred at t·hop, zero-padded; mag = |X|·2/Σw so a full-scale sine reads 1, ph = arg X,
 * trans = the §9.4.5 flux of the frame > max(0.05, 1.5 × the median of the 15 frames around it)).
 */
export function specAnalyse(L, R, rate) {
  let x = mono(L, R), sr = rate > 0 ? +rate : 48000;
  if (sr > LIMITS.playRate) { // only the first 20 s (+ the resampler's reach) is resampled
    const capSrc = Math.ceil(LIMITS.specSec * sr) + Math.ceil(RS_W * sr / LIMITS.playRate) + 2;
    if (x.length > capSrc) x = x.subarray(0, capSrc);
    x = Float64Array.from(resample(Float32Array.from(x), null, sr, LIMITS.playRate).L); sr = LIMITS.playRate;
  }
  const cap = Math.round(LIMITS.specSec * sr);
  if (x.length > cap) x = x.subarray(0, cap);
  const len = Math.max(1, x.length), N = LIMITS.specN, hop = N / 4, nb = N / 2 + 1, frames = Math.floor(len / hop) + 1;
  const w = hann(N);
  let sw = 0;
  for (let i = 0; i < N; i++) sw += w[i];
  const g = 2 / sw, mag = new Float32Array(frames * nb), ph = new Float32Array(frames * nb), flux = new Float64Array(frames);
  const re = new Float64Array(N), im = new Float64Array(N), ar = new Float64Array(nb), ai = new Float64Array(nb), br = new Float64Array(nb), bi = new Float64Array(nb);
  let prev = new Float64Array(nb), cur = new Float64Array(nb);
  const fill = (dst, t) => { const s = t * hop - N / 2; for (let i = 0; i < N; i++) { const j = s + i; dst[i] = j >= 0 && j < x.length ? x[j] * w[i] : 0; } };
  const store = (t, xr, xi) => {
    const o = t * nb;
    for (let k = 0; k < nb; k++) {
      const m = Math.hypot(xr[k], xi[k]) * g;
      mag[o + k] = m; ph[o + k] = Math.atan2(xi[k], xr[k]);
      cur[k] = Math.log1p(100 * m);
    }
    flux[t] = fluxOf(cur, prev, nb);
    const s = prev; prev = cur; cur = s;
  };
  for (let t = 0; t < frames; t += 2) {
    fill(re, t);
    if (t + 1 < frames) fill(im, t + 1); else im.fill(0);
    fft2real(re, im, N, ar, ai, br, bi);
    store(t, ar, ai);
    if (t + 1 < frames) store(t + 1, br, bi);
  }
  let mx = 0;
  for (let t = 0; t < frames; t++) if (flux[t] > mx) mx = flux[t];
  if (mx > 0) for (let t = 0; t < frames; t++) flux[t] /= mx;
  const trans = new Uint8Array(frames), win = [];
  for (let t = 0; t < frames; t++) {
    win.length = 0;
    for (let j = Math.max(0, t - 7); j <= Math.min(frames - 1, t + 7); j++) win.push(flux[j]);
    win.sort((a, b) => a - b);
    const med = win[win.length >> 1];
    trans[t] = flux[t] > Math.max(0.05, 1.5 * med) ? 1 : 0;
  }
  let peak = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
  return { rate: sr, len, N, hop, frames, mag, ph, trans, peak };
}

/**
 * §9.4.7: IR prepared for `rate` (resampled, leading samples below −60 dB of the peak trimmed keeping 1 ms, trailing
 * below −90 dB trimmed, ≤ 10 s, normalised so the larger channel energy Σx² = 1) → {kind: 'ir', name, rate, ch, len, L,
 * R, peak}.
 */
export function irPrepare(rec, rate) {
  if (!rec || typeof rec !== 'object') throw new Error('smp.irPrepare: no record');
  const to = rate > 0 ? +rate : 48000, from = rec.rate > 0 ? +rec.rate : 48000;
  const src = { L: toF32(rec.L), R: rec.R != null && rec.ch !== 1 ? toF32(rec.R) : null };
  if (!src.L || !src.L.length) throw new Error('smp.irPrepare: no samples');
  if (src.R && src.R.length !== src.L.length) { const r = new Float32Array(src.L.length); r.set(src.R.subarray(0, src.L.length)); src.R = r; }
  // cap the source first (10 s at its rate, plus the resampler's reach) so a long file is not resampled whole
  const capSrc = Math.ceil(LIMITS.irSec * from) + 64;
  if (src.L.length > capSrc) { src.L = src.L.slice(0, capSrc); if (src.R) src.R = src.R.slice(0, capSrc); }
  const r = resample(src.L, src.R, from, to);
  let L = r.L, R = r.R;
  const n = L.length, pk = peakOf(L, R);
  if (!(pk > 0)) throw new Error('smp.irPrepare: silent impulse response');
  const head = pk * Math.pow(10, LIMITS.irHeadDb / 20), tail = pk * Math.pow(10, LIMITS.irTailDb / 20);
  let first = 0, last = n - 1;
  while (first < n && Math.abs(L[first]) <= head && !(R && Math.abs(R[first]) > head)) first++;
  while (last > first && Math.abs(L[last]) <= tail && !(R && Math.abs(R[last]) > tail)) last--;
  const s = Math.max(0, first - Math.round(0.001 * to)), e = Math.min(n, last + 1, s + Math.round(LIMITS.irSec * to));
  L = L.slice(s, e); if (R) R = R.slice(s, e);
  let eL = 0, eR = 0;
  for (let i = 0; i < L.length; i++) { eL += L[i] * L[i]; if (R) eR += R[i] * R[i]; }
  const g = 1 / Math.sqrt(Math.max(eL, eR));
  for (let i = 0; i < L.length; i++) { L[i] *= g; if (R) R[i] *= g; }
  return { kind: 'ir', name: typeof rec.name === 'string' ? rec.name : '', rate: to, ch: R ? 2 : 1, len: L.length, L, R, peak: peakOf(L, R) };
}

/**
 * Real-cepstrum minimum-phase version of x (FFT `n` = nextPow2(2·len) by default) → Float64Array(len): same magnitude
 * response (up to the cepstral aliasing of the FFT size), energy moved to the start.
 */
export function minPhase(x, n) {
  const len = x.length, N = n >= 2 * len ? nextPow2(n) : nextPow2(Math.max(2, 2 * len));
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < len; i++) re[i] = x[i];
  fft(re, im, N, false);
  let mx = 0;
  for (let k = 0; k < N; k++) { const m = Math.hypot(re[k], im[k]); re[k] = m; if (m > mx) mx = m; }
  if (!(mx > 0)) return new Float64Array(len);
  const floor = mx * 1e-10;
  for (let k = 0; k < N; k++) { re[k] = Math.log(Math.max(re[k], floor)); im[k] = 0; }
  fft(re, im, N, true);                      // real cepstrum
  const h = N >> 1;
  for (let i = 1; i < h; i++) { re[i] *= 2; re[N - i] = 0; }
  for (let i = 0; i < N; i++) im[i] = 0;
  fft(re, im, N, false);                     // log spectrum of the minimum-phase signal
  for (let k = 0; k < N; k++) { const a = Math.exp(re[k]), p = im[k]; re[k] = a * Math.cos(p); im[k] = a * Math.sin(p); }
  fft(re, im, N, true);
  return re.slice(0, len);
}

/**
 * §8.4 shaping chain of a prepared IR → {L, R} (Float32Array; R null for mono): SIZE time-stretch by `size` (0.1–10,
 * 1 = unchanged; linear interpolation; length ≤ convMax s) → TONE (−1…1: < 0 one-pole LP at 20000·2^(8·tone) Hz, > 0
 * one-pole HP at 20·2^(8·tone) Hz) → ATTACK (0–1: raised-cosine fade-in over 0.5·att·len) → DECAY (0–1: keep dec·len
 * with a half-cosine fade over its last 30 %) → DAMP (0–1: high band (above an LR2 split at 2 kHz) × exp(−6.9·damp·t/len))
 * → MIN PHASE (minph ≥ 0.5: real-cepstrum minimum phase). IR GAIN is applied live, never here.
 */
export function irShape(rec, shape, convMax) {
  if (!rec || typeof rec !== 'object') throw new Error('smp.irShape: no record');
  const sh = shape && typeof shape === 'object' ? shape : {}, rate = rec.rate > 0 ? +rec.rate : 48000;
  const size = clamp(fin(sh.size, 1), 0.1, 10), tone = clamp(fin(sh.tone, 0), -1, 1), att = clamp(fin(sh.att, 0), 0, 1);
  const dec = clamp(fin(sh.dec, 1), 0, 1), damp = clamp(fin(sh.damp, 0), 0, 1), minph = fin(sh.minph, 0) >= 0.5;
  const maxLen = Math.max(1, Math.round(clamp(fin(convMax, LIMITS.irSec), 0.001, LIMITS.irSec) * rate));
  const chans = [toF32(rec.L), rec.R != null && rec.ch !== 1 ? toF32(rec.R) : null].filter(Boolean).map(finiteF32);
  if (!chans.length || !chans[0].length) throw new Error('smp.irShape: no samples');
  let len = chans[0].length;
  const out = chans.map(src => {
    let x, cut;
    // SIZE
    if (Math.abs(size - 1) > 1e-12) {
      const full = Math.max(1, Math.round(len * size)), n = Math.min(maxLen, full);
      cut = n < full;
      x = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const p = i / size, k = Math.floor(p), t = p - k;
        const a = k < src.length ? src[k] : 0, b = k + 1 < src.length ? src[k + 1] : 0;
        x[i] = a + (b - a) * t;
      }
    } else { cut = src.length > maxLen; x = Float64Array.from(cut ? src.subarray(0, maxLen) : src); }
    // a tail cut by the length cap (convMax, §14.3 Q3, or the 10 s cap) ends with a half-cosine fade over its last 10 %
    if (cut) {
      const F = Math.max(1, Math.round(0.1 * x.length)), f0 = x.length - F;
      for (let i = f0; i < x.length; i++) x[i] *= 0.5 + 0.5 * Math.cos(Math.PI * (i - f0 + 1) / F);
    }
    return x;
  });
  len = out[0].length;
  for (const x of out) {
    // TONE
    if (tone !== 0) {
      const lp = tone < 0, fc = Math.min(0.45 * rate, lp ? 20000 * Math.pow(2, 8 * tone) : 20 * Math.pow(2, 8 * tone));
      const a = 1 - Math.exp(-TAU * fc / rate);
      let y = 0;
      for (let i = 0; i < len; i++) { y += a * (x[i] - y); x[i] = lp ? y : x[i] - y; }
    }
    // ATTACK
    if (att > 0) {
      const A = Math.max(1, Math.round(0.5 * att * len));
      for (let i = 0; i < A && i < len; i++) x[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / A);
    }
  }
  // DECAY (shortens every channel alike)
  if (dec < 1) {
    const D = Math.max(1, Math.round(dec * len)), F = Math.max(1, Math.round(0.3 * D)), f0 = D - F;
    for (let c = 0; c < out.length; c++) {
      const x = out[c].slice(0, D);
      for (let i = f0; i < D; i++) x[i] *= 0.5 + 0.5 * Math.cos(Math.PI * (i - f0) / F);
      out[c] = x;
    }
    len = D;
  }
  for (let c = 0; c < out.length; c++) {
    const x = out[c];
    // DAMP: LR2 low-pass at 2 kHz (two one-poles), high = x − low decays across the IR
    if (damp > 0) {
      const a = 1 - Math.exp(-TAU * Math.min(2000, 0.45 * rate) / rate);
      let y1 = 0, y2 = 0;
      for (let i = 0; i < len; i++) {
        y1 += a * (x[i] - y1); y2 += a * (y1 - y2);
        const hi = x[i] - y2;
        x[i] = y2 + hi * Math.exp(-6.9 * damp * i / len);
      }
    }
    if (minph) out[c] = minPhase(x);
  }
  const f32 = out.map(x => Float32Array.from(x));
  return { L: f32[0], R: f32[1] || null };
}

/**
 * §4.5 shaped-IR entry fields of shaped PCM: {len, ch, head, hp, tp, peak} — head[c] = Float32Array(128) (IR [0, 128),
 * direct-form taps), hp[c] = {n, re, im}: IR [128, 8192) in n ≤ 63 partitions of 128, each zero-padded to 256 and
 * transformed (unscaled forward FFT, bins 0 … 128 = 129 per partition, the SxBase.FFT(256).rfwd layout), tp[c] =
 * {n, re, im}: IR [8192, len) in partitions of 4096 zero-padded to 8192 (4097 bins each). Float32.
 */
export function irPartition(L, R, rate) {
  const chans = [toF32(L), R != null ? toF32(R) : null].filter(Boolean).map(finiteF32);
  if (!chans.length || !chans[0].length) throw new Error('smp.irPartition: no samples');
  const len = chans[0].length;
  if (chans[1] && chans[1].length !== len) { const r = new Float32Array(len); r.set(chans[1].subarray(0, len)); chans[1] = r; }
  const ch = chans.length, head = [], hp = [], tp = [];
  const parts = (from, to, B) => {
    const n = Math.max(0, Math.ceil((Math.min(to, len) - from) / B)), N = 2 * B, nb = B + 1;
    const res = chans.map(() => ({ n, re: new Float32Array(n * nb), im: new Float32Array(n * nb) }));
    const re = new Float64Array(N), im = new Float64Array(N), ar = new Float64Array(nb), ai = new Float64Array(nb), br = new Float64Array(nb), bi = new Float64Array(nb);
    for (let p = 0; p < n; p++) {
      re.fill(0); im.fill(0);
      const s = from + p * B, e = Math.min(len, s + B);
      for (let i = s; i < e; i++) { re[i - s] = chans[0][i]; if (ch === 2) im[i - s] = chans[1][i]; }
      fft2real(re, im, N, ar, ai, br, bi);
      for (let c = 0; c < ch; c++) {
        const xr = c === 0 ? ar : br, xi = c === 0 ? ai : bi, o = p * nb, d = res[c];
        for (let k = 0; k < nb; k++) { d.re[o + k] = xr[k]; d.im[o + k] = xi[k]; }
        d.im[o] = 0; d.im[o + B] = 0;
      }
    }
    return res;
  };
  const H = parts(128, 8192, 128), T = parts(8192, Infinity, 4096);
  for (let c = 0; c < ch; c++) {
    const h = new Float32Array(128);
    h.set(chans[c].subarray(0, Math.min(128, len)));
    head.push(h); hp.push(H[c]); tp.push(T[c]);
  }
  return { len, ch, head, hp, tp, peak: peakOf(...chans), rate: rate > 0 ? +rate : 48000 };
}

/**
 * §9.4.8: a wavetable played as a sample. `frames`: Float32Array(R·2048) (frame 0 first) or an array of R frames →
 * record {kind: 'smp', rate: 48000, ch: 1, len: R·2048, L, R: null, root: WT_ROOT, loop: whole table, marks: frame
 * boundaries (fractions, offered as Auto slices), odf: null}.
 */
export function wtAsSample(frames) {
  let L;
  if (Array.isArray(frames)) {
    L = new Float32Array(frames.length * FRAME);
    frames.forEach((f, i) => L.set(f.length > FRAME ? f.subarray ? f.subarray(0, FRAME) : f.slice(0, FRAME) : f, i * FRAME));
  } else L = toF32(frames);
  const R = Math.floor(L.length / FRAME);
  if (!(R >= 1)) throw new Error('smp.wtAsSample: no frames');
  if (L.length !== R * FRAME) L = L.slice(0, R * FRAME);
  const len = R * FRAME, marks = [];
  for (let f = 1; f < R; f++) marks.push(f / R);
  return { kind: 'smp', rate: 48000, ch: 1, len, L, R: null, root: WT_ROOT, loop: { start: 0, end: len }, marks, odf: null };
}

/**
 * YIN fundamental estimate of x[from, to) (mono numbers) between 30 Hz and 2 kHz → Hz, or 0 when nothing periodic.
 */
export function yinF0(x, rate, from, to) {
  const sr = rate > 0 ? +rate : 48000, a = Math.max(0, from | 0), b = Math.min(x.length, to == null ? x.length : to | 0);
  const tMin = Math.max(2, Math.floor(sr / 2000)), tMax = Math.min(Math.floor(sr / 30), Math.floor((b - a) / 2));
  if (!(tMax > tMin + 2)) return 0;
  const W = Math.min(4096, b - a - tMax);
  if (!(W >= 64)) return 0;
  const d = new Float64Array(tMax + 2);
  for (let t = 1; t <= tMax + 1; t++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const v = x[a + i] - x[a + i + t]; s += v * v; }
    d[t] = s;
  }
  let run = 0, best = -1;
  const cm = new Float64Array(tMax + 2);
  cm[0] = 1;
  for (let t = 1; t <= tMax + 1; t++) { run += d[t]; cm[t] = run > 0 ? d[t] * t / run : 1; }
  for (let t = tMin; t <= tMax; t++) {
    if (cm[t] < 0.15) { while (t + 1 <= tMax && cm[t + 1] < cm[t]) t++; best = t; break; }
  }
  if (best < 0) {
    let m = Infinity;
    for (let t = tMin; t <= tMax; t++) if (cm[t] < m) { m = cm[t]; best = t; }
    if (!(m < 0.5)) return 0;
  }
  const y0 = cm[best - 1], y1 = cm[best], y2 = cm[best + 1], den = y0 - 2 * y1 + y2;
  const tau = best + (den !== 0 && Number.isFinite(den) ? clamp(0.5 * (y0 - y2) / den, -0.5, 0.5) : 0);
  return sr / tau;
}

/**
 * §10.1 loop search inside [from, to) (frames): candidate lengths = integer multiples ≥ 0.25 s of the period 1/f0
 * (f0 ≤ 0 or missing: YIN of the region), both ends at upward zero crossings of the mono sum, minimising the RMS seam
 * error over 32 samples of every channel (IMPL: both channels of a stereo input, so each channel is judged) → {ls, le,
 * err}. A region without two crossings: {ls: from, le: to}.
 */
export function loopSearch(L, R, rate, from, to, f0) {
  const x = mono(L, R), sr = rate > 0 ? +rate : 48000, n = x.length;
  // the seam is judged per channel (a stereo signal whose side part does not repeat clicks in each channel even when
  // the mono sum is seamless): the channels themselves, or the mono sum for mono input
  const chs = R != null ? [view32(L), view32(R)] : [x];
  const a = clamp(Math.round(fin(from, 0)), 0, n), b = clamp(Math.round(fin(to, n)), a, n);
  let f = f0 > 0 ? +f0 : yinF0(x, sr, a, b);
  if (!(f > 0)) f = 100;
  const P = sr / f, cross = [];
  for (let i = Math.max(a, 1); i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) cross.push(i);
  if (cross.length < 2) return { ls: a, le: Math.max(a + 1, b), err: Infinity };
  const span = cross[cross.length - 1] - cross[0], mMax = Math.floor(span / P);
  let mMin = Math.max(1, Math.ceil(0.25 * sr / P));
  if (mMin > mMax) mMin = Math.max(1, mMax);
  if (mMax < 1) return { ls: cross[0], le: cross[cross.length - 1], err: Infinity };
  const lens = [];
  for (let m = mMin; m <= mMax; m++) lens.push(m * P);
  // bound the work (≈ 2·10^5 seam evaluations): stride over the start crossings
  const stride = Math.max(1, Math.ceil(cross.length * lens.length / 200000));
  const seam = (ls, le) => {
    let s = 0;
    for (const c of chs) {
      for (let j = -16; j < 16; j++) {
        const p = ls + j, q = le + j;
        const u = p >= 0 && p < n ? c[p] : 0, v = q >= 0 && q < n ? c[q] : 0;
        s += (u - v) * (u - v);
      }
    }
    return Math.sqrt(s / (32 * chs.length));
  };
  const nearest = target => { // index of the crossing nearest to target
    let lo = 0, hi = cross.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cross[mid] < target) lo = mid + 1; else hi = mid; }
    return lo > 0 && Math.abs(cross[lo - 1] - target) <= Math.abs(cross[lo] - target) ? lo - 1 : lo;
  };
  let best = { ls: cross[0], le: cross[cross.length - 1], err: Infinity };
  for (let i = 0; i < cross.length; i += stride) {
    const ls = cross[i];
    for (const l of lens) {
      if (ls + l > b + P / 2) break;
      const k = nearest(ls + l), le = cross[k];
      if (le <= ls || Math.abs(le - (ls + l)) > P / 2) continue;
      const e = seam(ls, le);
      if (e < best.err) best = { ls, le, err: e };
    }
  }
  return best;
}

/**
 * IMPL (factory loops, §10.1 / §10.2): bakes a crossfade into a looped sample so that both channels continue seamlessly
 * at the wrap whatever the material (a chorus / ensemble side signal or detuned voices do not repeat at the loop
 * length, and zone loops have no crossfade in the DSP) → {L, R, pre, post} (fresh Float32Arrays). The `pre` frames
 * before `le` fade from the data into the frames before `ls` (the last one equals x[ls − 1]), the `post` frames from
 * `le` on fade from the frames after `ls` back into the data (y[le] = x[ls]), so a wrap and a release past `le` are
 * both continuous; pre = min(n, ls, (le − ls)/2), post = min(n, len − le, (le − ls)/2). Gains per channel follow the
 * correlation r ∈ [0, 1] of the two segments: g_old = cos θ, g_new = sin θ, both / √(1 + r·sin 2θ) (equal power for
 * unrelated material, equal amplitude for identical material).
 */
export function bakeLoop(L, R, ls, le, n) {
  const chans = [toF32(L), R != null ? toF32(R) : null], len = chans[0].length;
  const a = Math.round(fin(ls, 0)), b = Math.round(fin(le, len)), X = Math.max(0, Math.round(fin(n, 0)));
  if (!(a >= 0 && b > a && b <= len)) return { L: chans[0], R: chans[1], pre: 0, post: 0 };
  const half = Math.floor((b - a) / 2), pre = Math.min(X, a, half), post = Math.min(X, len - b, half);
  const corr = (x, p, q, m) => {
    let xy = 0, xx = 0, yy = 0;
    for (let i = 0; i < m; i++) { const u = x[p + i], v = x[q + i]; xy += u * v; xx += u * u; yy += v * v; }
    return xx > 0 && yy > 0 ? clamp(xy / Math.sqrt(xx * yy), 0, 1) : 0;
  };
  for (const x of chans) {
    if (!x) continue;
    finiteF32(x);
    if (pre > 0) {
      const s = b - pre, f = a - pre, r = corr(x, s, f, pre), src = x.slice(f, a);
      for (let i = 0; i < pre; i++) {
        const t = (Math.PI / 2) * (i + 1) / pre, g = 1 / Math.sqrt(1 + r * Math.sin(2 * t));
        x[s + i] = g * (Math.cos(t) * x[s + i] + Math.sin(t) * src[i]);
      }
    }
    if (post > 0) {
      const r = corr(x, a, b, post), src = x.slice(a, a + post);
      for (let j = 0; j < post; j++) {
        const t = (Math.PI / 2) * j / post, g = 1 / Math.sqrt(1 + r * Math.sin(2 * t));
        x[b + j] = g * (Math.cos(t) * src[j] + Math.sin(t) * x[b + j]);
      }
    }
  }
  return { L: chans[0], R: chans[1], pre, post };
}

// ------------------------------------------------------------------------------------------------ displays
/** Min/max overview of n columns → Float32Array(2n) [min0, max0, min1, max1, …] over both channels. */
export function overview(L, R, n) {
  const a = view32(L), b = R != null ? view32(R) : null, cols = Math.max(0, n | 0), out = new Float32Array(2 * cols), len = a ? a.length : 0;
  if (!len) return out;
  for (let c = 0; c < cols; c++) {
    const s = Math.floor(c * len / cols), e = Math.max(s + 1, Math.floor((c + 1) * len / cols));
    let mn = Infinity, mx = -Infinity;
    for (let i = s; i < e && i < len; i++) {
      const u = a[i]; if (u < mn) mn = u; if (u > mx) mx = u;
      if (b) { const v = b[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    }
    out[2 * c] = Number.isFinite(mn) ? mn : 0; out[2 * c + 1] = Number.isFinite(mx) ? mx : 0;
  }
  return out;
}
/**
 * Spectrogram image of the mono sum: w time columns × h log-frequency rows (20 Hz … rate/2, row 0 = the highest), one
 * byte per cell at [y·w + x]: 0 ↔ ≤ −96 dB … 255 ↔ 0 dB re full scale (window-normalised magnitude, FFT 2048).
 */
export function spectrogram(L, R, rate, w, h) {
  const W = Math.max(0, w | 0), Hh = Math.max(0, h | 0), data = new Uint8ClampedArray(W * Hh);
  const x = mono(L, R), sr = rate > 0 ? +rate : 48000, N = 2048, nb = N / 2 + 1, win = hann(N);
  if (!W || !Hh || !x.length) return { w: W, h: Hh, data };
  let sw = 0;
  for (let i = 0; i < N; i++) sw += win[i];
  const g = 2 / sw, re = new Float64Array(N), im = new Float64Array(N), ar = new Float64Array(nb), ai = new Float64Array(nb);
  const fLo = 20, fHi = sr / 2, bins = new Int32Array(Hh + 1);
  for (let y = 0; y <= Hh; y++) bins[y] = clamp(Math.round(fLo * Math.pow(fHi / fLo, y / Hh) * N / sr), 0, nb - 1);
  for (let c = 0; c < W; c++) {
    const centre = Math.floor((c + 0.5) * x.length / W), s = centre - N / 2;
    for (let i = 0; i < N; i++) { const j = s + i; re[i] = j >= 0 && j < x.length ? x[j] * win[i] : 0; im[i] = 0; }
    fft2real(re, im, N, ar, ai, null, null);
    for (let y = 0; y < Hh; y++) {
      const k0 = bins[y], k1 = Math.max(k0, bins[y + 1]);
      let m = 0;
      for (let k = k0; k <= k1; k++) { const v = Math.hypot(ar[k], ai[k]); if (v > m) m = v; }
      const db = 20 * Math.log10(Math.max(1e-12, m * g));
      data[(Hh - 1 - y) * W + c] = Math.round(255 * clamp((db + 96) / 96, 0, 1));
    }
  }
  return { w: W, h: Hh, data };
}

/**
 * RT60 of an impulse response by Schroeder backward integration (T20: the −5 … −25 dB line, × 3), optionally of a
 * band-passed copy (`band` [lo, hi] Hz, 2nd-order sections) → seconds (NaN when the decay never reaches −25 dB).
 */
export function irRT60(L, rate, band) {
  let x = Float64Array.from(view32(L) || []);
  const sr = rate > 0 ? +rate : 48000;
  if (Array.isArray(band) && band.length === 2) {
    const bq = (type, fc) => {
      const w0 = TAU * fc / sr, cw = Math.cos(w0), al = Math.sin(w0) / (2 * Math.SQRT1_2);
      const b = type === 'lp' ? [(1 - cw) / 2, 1 - cw, (1 - cw) / 2] : [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2], a0 = 1 + al, a1 = -2 * cw, a2 = 1 - al;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < x.length; i++) {
        const v = x[i], y = (b[0] * v + b[1] * x1 + b[2] * x2 - a1 * y1 - a2 * y2) / a0;
        x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y;
      }
    };
    bq('hp', band[0]); bq('hp', band[0]); bq('lp', band[1]); bq('lp', band[1]);
  }
  const n = x.length, edc = new Float64Array(n);
  let s = 0;
  for (let i = n - 1; i >= 0; i--) { s += x[i] * x[i]; edc[i] = s; }
  if (!(s > 0)) return NaN;
  const db = i => 10 * Math.log10(edc[i] / s);
  let i5 = -1, i25 = -1;
  for (let i = 0; i < n; i++) { const d = db(i); if (i5 < 0 && d <= -5) i5 = i; if (d <= -25) { i25 = i; break; } }
  if (i5 < 0 || i25 < 0) return NaN;
  // least-squares line through the EDC between −5 and −25 dB
  let sx = 0, sy = 0, sxx = 0, sxy = 0, m = 0;
  for (let i = i5; i <= i25; i++) { const t = i / sr, y = db(i); sx += t; sy += y; sxx += t * t; sxy += t * y; m++; }
  const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx);
  return slope < 0 ? -60 / slope : NaN;
}

// ------------------------------------------------------------------------------------------------ §9.8 files
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64I = (() => { const t = new Int16Array(128).fill(-1); for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i; return t; })();
function toB64(b) {
  let s = '';
  const n = b.length, parts = [];
  for (let i = 0; i < n; i += 3) {
    const v = (b[i] << 16) | ((i + 1 < n ? b[i + 1] : 0) << 8) | (i + 2 < n ? b[i + 2] : 0);
    s += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + (i + 1 < n ? B64[(v >> 6) & 63] : '=') + (i + 2 < n ? B64[v & 63] : '=');
    if (s.length >= 65536) { parts.push(s); s = ''; }
  }
  parts.push(s);
  return parts.join('');
}
function fromB64(str) {
  const s = String(str).replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor(s.length * 3 / 4));
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const c = j => (i + j < s.length ? B64I[s.charCodeAt(i + j)] : 0);
    const v = (c(0) << 18) | (c(1) << 12) | (c(2) << 6) | c(3);
    if (o < out.length) out[o++] = (v >> 16) & 255;
    if (o < out.length && i + 2 < s.length) out[o++] = (v >> 8) & 255;
    if (o < out.length && i + 3 < s.length) out[o++] = v & 255;
  }
  return out.subarray(0, o);
}
const P24 = 8388608; // 2^23
function pcm24(x) { // Float32 → 24-bit little-endian PCM bytes (round to nearest, clipped, non-finite → 0)
  const b = new Uint8Array(x.length * 3);
  for (let i = 0, o = 0; i < x.length; i++, o += 3) {
    const v = x[i];
    let q = Number.isFinite(v) ? Math.round(v * P24) : 0;
    if (q > P24 - 1) q = P24 - 1; else if (q < -P24) q = -P24;
    b[o] = q & 255; b[o + 1] = (q >> 8) & 255; b[o + 2] = (q >> 16) & 255;
  }
  return b;
}
function fromPcm24(b, len) {
  const n = Math.min(len >= 0 ? len : Infinity, Math.floor(b.length / 3)), x = new Float32Array(n);
  for (let i = 0, o = 0; i < n; i++, o += 3) x[i] = (((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) << 8) >> 8) / P24;
  return x;
}
const finiteOr = (v, d) => (Number.isFinite(v) ? v : d);
const loopOf = (lp, len) => (lp && Number.isFinite(lp.start) && Number.isFinite(lp.end) && lp.start >= 0 && lp.start < lp.end && lp.end <= len ? { start: lp.start, end: lp.end } : null);

/**
 * §9.8: a user asset record → its embedded file form. Samples and IRs: {kind, name, rate, ch, len, root (samples),
 * loop (samples), enc: 'pcm24', L: base64, R: base64 | null}; multisamples {kind: 'multi', name, zones} (their zone
 * samples are embedded separately under their own ids).
 */
export function encodeAsset(rec) {
  if (!rec || typeof rec !== 'object') throw new Error('smp.encodeAsset: no record');
  const name = typeof rec.name === 'string' ? rec.name : '';
  if (rec.kind === 'multi') return { kind: 'multi', name, zones: Array.isArray(rec.zones) ? rec.zones.map(z => Object.assign({}, z)) : [] };
  if (rec.kind !== 'smp' && rec.kind !== 'ir') throw new Error('smp.encodeAsset: unknown kind ' + rec.kind);
  const L = toF32(rec.L);
  if (!L || !L.length) throw new Error('smp.encodeAsset: no samples');
  const ch = rec.ch === 2 && rec.R != null ? 2 : 1, R = ch === 2 ? toF32(rec.R) : null, len = L.length;
  const o = { kind: rec.kind, name, rate: finiteOr(rec.rate, 48000), ch, len };
  if (rec.kind === 'smp') { o.root = finiteOr(rec.root, 60); o.loop = loopOf(rec.loop, len); }
  o.enc = 'pcm24';
  o.L = toB64(pcm24(L));
  o.R = R ? toB64(pcm24(R.length === len ? R : Float32Array.from({ length: len }, (_, i) => R[i] || 0))) : null;
  return o;
}

/** §9.8: the embedded form → a record with Float32Array channels (24-bit quantised, error ≤ 2⁻²⁴). */
export function decodeAsset(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('smp.decodeAsset: nothing to decode');
  const name = typeof obj.name === 'string' ? obj.name.slice(0, 128) : '';
  if (obj.kind === 'multi') return { kind: 'multi', name, zones: Array.isArray(obj.zones) ? obj.zones.filter(z => z && typeof z === 'object').map(z => Object.assign({}, z)) : [] };
  if (obj.kind !== 'smp' && obj.kind !== 'ir') throw new Error('smp.decodeAsset: unknown kind ' + obj.kind);
  if (obj.enc !== 'pcm24') throw new Error('smp.decodeAsset: unknown encoding ' + obj.enc);
  const L = fromPcm24(fromB64(obj.L || ''), obj.len), len = L.length;
  if (!len) throw new Error('smp.decodeAsset: no samples');
  const ch = obj.ch === 2 && obj.R ? 2 : 1;
  let R = null;
  if (ch === 2) { R = new Float32Array(len); R.set(fromPcm24(fromB64(obj.R), len)); }
  const rate = obj.rate > 0 && obj.rate <= 768000 ? +obj.rate : 48000;
  const rec = { kind: obj.kind, name, rate, ch, len, L, R };
  if (obj.kind === 'smp') { rec.root = finiteOr(obj.root, 60); rec.loop = loopOf(obj.loop, len); }
  return rec;
}

/**
 * §9.3 step 8: content hash of canonical PCM — two FNV-1a-32 (offset bases 0x811c9dc5 and 0x01000193) over the
 * little-endian Float32 bytes of L then R → 16 hex digits.
 */
export function assetHash(L, R) {
  const parts = [toF32(L) || new Float32Array(0)];
  if (R != null) parts.push(toF32(R));
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (const x of parts) {
    if (LE) {
      const b = new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
      for (let i = 0; i < b.length; i++) { const y = b[i]; h1 = Math.imul(h1 ^ y, 0x01000193); h2 = Math.imul(h2 ^ y, 0x01000193); }
    } else {
      const dv = new DataView(new ArrayBuffer(4));
      for (let i = 0; i < x.length; i++) { dv.setFloat32(0, x[i], true); for (let k = 0; k < 4; k++) { const y = dv.getUint8(k); h1 = Math.imul(h1 ^ y, 0x01000193); h2 = Math.imul(h2 ^ y, 0x01000193); } }
    }
  }
  const hx = h => (h >>> 0).toString(16).padStart(8, '0');
  return hx(h1) + hx(h2);
}
