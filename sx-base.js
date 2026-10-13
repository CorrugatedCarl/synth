/*
 * sx-base.js — shared base of the Serum v2 DSP scripts (classic script, no imports/exports; owner D5).
 * Contract: SPEC-serum2 §11.5 (exports), §0.3 (load order, IIFE shape, lazy references, the shared shapers), §0.4 (code
 * rules), §3 (constants), §4.5 (asset entries), §6.2 (PRNG streams), §8.2 (shapers 16/17), §6.10.1/§6.10.5 (resamplers),
 * §11.10 (lazy warm-up), §15.5 (tests), §14.2 (asset budget, enforced by the main-thread manager, not here).
 *
 * Script #1 of the §0.3 list. Evaluated in every AudioWorkletGlobalScope, on the main thread (wk.loadDSP) and in node vm
 * contexts (tests/dsp-scope.mjs). Reads no other script's global. The whole file is one IIFE publishing the frozen
 * `globalThis.SxBase`; it can be evaluated again in the same scope (the asset Map survives, `epoch` keeps counting up),
 * and a failure inside leaves SxBase = null without throwing out of the script.
 *
 * M1a content ("minimal", §0.5): constants, math helpers, PRNG, asset store. M1b (complete, §11.5): FFT, the half-band
 * resamplers, the distortion shapers `shape(mode, x, d)` and the lazy warm-up queue `warmTick(proc)`; the M1a members
 * are unchanged. [+] marks members beyond the §11.5 list.
 *
 * Constants (built by the same normative builders as serum-core §3.10/§3.11.2, integration-tested in tests/sx-base.test.mjs):
 *   NS 148 · NV1 248 · NF1 100 · ND 529 · NSV 429 (voice-vector length) · NSRC 62 · MAXCH 32 · MAXFX 1160 (8 + 48·24, §5.5)
 *   DIDX2      {constant name → vi} for every destination with a voice slot (§3.11.1 naming rule: id upper-cased, '.' → '_')
 *   DIDS2      Array(429) of destination ids by vi; '' at the unused slots 403–405 (scope-M rows g.direct/g.bus1v/g.bus2v)
 *   IDX_OF_VI  Int16Array(429): static DEST index of vi (v < 148 ? v : v + 100), −1 at the unused slots
 *   LAW_TAB2   {law: Uint8Array(429), lo, hi: Float64Array(429), cont: Uint8Array(429)} by vi; law = laws.js LAWS index;
 *              cont = 1 for continuous laws (smoothed). IMPL: the unused slots 403–405 hold law 0, lo = hi = 0, cont 0
 *              (never smoothed, value 0 — their CP.base slots stay 0, §3.11.1)
 *   SIDX2      {SOURCE ID upper-cased → index} (62 sources)   SRC_IDS2 Array(62)   SRC_POL2 Uint8Array(62), 1 = bipolar
 *   GIDX       FX-context indices {MASTER 0, BYPASS 1, DIRECT 2, BUS1V 3, BUS2V 4}
 *   OTYPE      oscillator type codes {WT 0, MULTI 1, SAMPLE 2, GRAN 3, SPEC 4} (= serum-core OSC_TYPES order)
 *   WARP_IDS2  Array(82) of WARPS2 ids   WARP_DOM Uint8Array(82) of WDOM codes {NONE 0 (Off), F 1, P 2, O 3, S 4}
 *   WARP_AVAIL Uint8Array(82): bit t set ⇔ the mode is available on OTYPE t (IMPL encoding of serum-core's 'all' = 31,
 *              'Sp' = 16): available ⇔ (WARP_AVAIL[mode] >> type) & 1
 *   FILTER_FAMILY2 Array(28) family names   FILTER_FAM2 Uint8Array(108): family index of filter type 0–107
 *   WIN_N 1024 · WIN_TAB Float64Array(10·1025): granular window k (GRAIN_WINDOWS order, §3.8) at [k·1025 + j], u = j/1024
 *   LAD        ladders in beats (Float64Array): lfo[v], arp[v], grid[v] with v = (dot ? 1 : 0) + (trip ? 2 : 0) (lfoLadder,
 *              arpLadder, gridLadder of §3.12/§3.15.4), env (16), len (15), rrate (6), time (7), launch (9; Off = 0),
 *              vcRates (11) — CLIP_RATES share the VC_RATES multipliers
 * Math (Phase-1 serum-dsp code, same tolerances): exp2(x) (rel. error < 1e-9), log2(x) (normal x > 0, < 1e-10),
 *   tanh(x) (Padé [7/6], < 1e-4, |tanh| ≤ 1), sin1(p) = sin(2πp) (4096-point table, < 3e-7).
 * Shapers (§0.3, §8.2, §6.6.5; FX distortion modes 0–17, the one copy used by FX Distortion S2 and the distortion warps):
 *   shape(mode, x, d)    y of mode (rounded, clamped 0–17) at drive d ∈ [0, 1] (clamped, NaN → 0). Modes 0–15 are the
 *                        Phase-1 fx-dsp shapers ported verbatim (bit-identical, tests/sx-base.test.mjs against
 *                        tests/ref-p1/fx-dsp.js); 16 Overdrive = the §8.2 single-stage curve without its stage LP,
 *                        0.9·tanh(1.8·G·x)/tanh(1.8), G = 0.5·10^d; 17 Soft Sat. per §8.2. X-Shaper (11, 12) reads the
 *                        linear default tables; Downsample (8) and Stomp Box's filters are the caller's. Keeps the last
 *                        (mode, d) coefficients, so per-sample calls at a constant drive cost two comparisons
 *   [+] Shaper           Phase-1 coefficient object: set(mode, d); fields mode, G, a, b, d, xa, xb (X-Shaper tables,
 *                        Float32Array(NXS) — assign FXT xsA/xsB per instance; default LINXS). Hot loops keep one per
 *                        instance / unison voice and call
 *   [+] shapeS(S, x)     the static curve of a set Shaper (= Phase-1 shape(S, x))
 *   [+] shapeBlock(S, x, off, n)  shapeS in place on x[off … off + n), one monomorphic loop per mode (B18), bit-identical
 *   [+] NXS 1025, LINXS (the linear X-Shaper table j/1024)
 * FFT (§11.5): new FFT(n), n a power of two in [2, 65536]; tables (bit reversal, twiddles) and the real-transform scratch
 *   are shared per size and built on first use (allocation only in the constructor). Forward unscaled with e^{−2πi·jk/n},
 *   inverse scaled 1/n (the wt.js convention). fwd(re, im) / inv(re, im) in place on Float64Array (length ≥ n);
 *   rfwd(x, re, im): real x[0 … n) → bins 0 … n/2 (re/im length ≥ n/2 + 1, im[0] = im[n/2] = 0); rinv(re, im, x): bins
 *   0 … n/2 (im[0], im[n/2] ignored) → x[0 … n). Inputs of rfwd/rinv are not modified. Round trip < 1e-12.
 * Resamplers (§11.5, §6.10.1, §6.10.5): new HBUp(osFactor) / new HBDown(osFactor), osFactor 1, 2, 4, 8, 16, one polyphase
 *   half-band stage per doubling; process(inp, out, n) with n = base-rate samples (HBUp: n in → n·osFactor out; HBDown:
 *   n·osFactor in → n out; any numeric arrays, not overlapping; osFactor 1 copies); reset(); fields os, K (stages),
 *   delay (group delay in base-rate samples: up 31·(os − 1)/os, down 30·(os − 1)/os), bytes. The interpolator passes
 *   the input samples through unchanged (every second output). Response (tests/sx-base.test.mjs, fs_b = base rate):
 *   passband ±0.05 dB to 0.4·fs_b, images / aliases of content ≤ 0.4·fs_b (resp. of input ≥ 0.6·fs_b) ≤ −90 dB.
 *   DEVIATION (IMPL, flagged for the lead): §11.5 names "31 taps per stage, Kaiser β 9", which cannot meet §15.5's
 *   passband/stopband (31 taps: ±0.05 dB only to 0.35·fs_b and −25 dB at 0.6·fs_b; β 9 caps the sidelobes at
 *   −89.98 dB at any length). Stages here are 63 taps (33 non-zero, 16 multiplies per output pair), Kaiser β 9.5:
 *   ±2e-4 dB to 0.4·fs_b, ≤ −94 dB beyond 0.6·fs_b. HB_TAPS / HB_BETA export the design.
 * Warm-up (§11.10, §14.1 row q): [+] warmAdd(proc, key, job) → boolean queues `job` (a function (proc) → truthy while
 *   more steps remain; each step ≤ 1 ms) once per processor and key, never for an offline processor (proc.offline);
 *   warmTick(proc) runs one step of the head job (at most one job per call, called once per render quantum) and returns
 *   the number of queued jobs left; a throwing job is dropped. State lives in `proc.sxWarm` (created by warmAdd).
 * PRNG (§6.2): xorshift(s) = the Phase-1 xorshift32 step (uint32 out; callers map 0 → 1), R2_SALT = 0x85EBCA6B,
 *   r2Seed(seed) = xorshift((seed ^ R2_SALT) >>> 0) || 1 — the initial state of a voice's second stream r2, where `seed`
 *   is the value Phase 1 passes to xorshift for the voice stream r (sx.rng ^ (0x9E3779B9·(i + 1))).
 * Assets (§4.5, §9.5): `assets` (Map id → entry, survives re-evaluation), `epoch` (getter; +1 on every successful
 *   storeAsset and every dropAsset that removed an entry, and on re-evaluation), storeAsset(id, e) → boolean (validates,
 *   then stores the object itself: transferred buffers are adopted, never copied), dropAsset(id) → boolean (whether it
 *   existed), getAsset(id) → entry | null, assetBytes() → Σ byteLength of the typed arrays of every stored entry
 *   (measured, not the declared `bytes`; multisample entries own no buffers: their zone samples are separate entries).
 *   Validation (invalid ⇒ false, one console.warn per id, nothing stored, epoch unchanged) — IMPL details where §4.5 is
 *   silent are marked (*):
 *   common  id non-empty string, e.id === id, e.v === 1, e.kind ∈ smp | spec | multi | ir, e.bytes finite ≥ 0
 *   smp     rate ∈ (0, 48000]; ch 1|2; len integer ≥ 1; root finite; loop null/absent or {start, end} finite with
 *           0 ≤ start < end ≤ len; peak finite ≥ 0; levels 1–8 objects {len, L, R}: level 0 len = len, level ℓ len =
 *           floor or ceil of level ℓ−1 len / 2 (*); L Float32Array(len); R Float32Array(len) when ch 2, null/absent when
 *           ch 1. Wavetable-as-sample entries (`wtsmp:<id>`, §9.4.8) are smp entries
 *   spec    rate ∈ (0, 48000]; ch 1; len integer ≥ 1; N power of two in [64, 65536] (*); hop integer in [1, N]; frames
 *           integer ≥ 1; mag, ph Float32Array(frames·(N/2+1)); trans Uint8Array(frames); peak finite ≥ 0; [+] root absent,
 *           null or finite (*: the analysed sample's root note, so a Spectral oscillator needs no playback entry, §6.3.3)
 *   multi   zones Array of ≤ 512 objects: lo ≤ hi and vlo ≤ vhi integers in [0, 127]; root, tune, gain finite; pan ∈ [−1, 1];
 *           smp non-empty string; mode oneshot | loop | sustain; ls, le finite ≥ 0 with ls ≤ le (ls < le for loop and
 *           sustain) (*); off finite ≥ 0; env null/absent or 6 finite values ≥ 0 with s = env[4] ∈ [0, 1]; rr [seqLen, seqPos]
 *           integers with 1 ≤ seqPos ≤ seqLen (*); vt ∈ [0, 1]
 *   ir      rate finite > 0; ch 1|2; len integer ≥ 1; peak finite ≥ 0; for each channel c < ch: head[c] Float32Array(128);
 *           hp[c] = {n, re, im}: n integer in [0, 63], re/im Float32Array of equal length n·B with B ∈ {128, 129, 256}
 *           (FFT-256 bins per partition in any of the packed / half / full layouts (*)), covering 128 + 128·n ≥
 *           min(len, 8192); tp[c] = {n, re, im}: n integer ≥ 0, re/im of length n·B with B ∈ {4096, 4097, 8192},
 *           covering 8192 + 4096·n ≥ len
 *
 * Hot paths (shape, shapeS, shapeBlock, FFT methods, HBUp/HBDown process, warmTick itself) never allocate. Tables are
 * built at load, FFT tables on the first FFT(n) of a size, resampler state in the constructors. Typed-array
 * constructors are global lookups only there (the allocation-free tests replace them on the context afterwards).
 */
(function () {
  'use strict';
  const prev = globalThis.SxBase;                           // idempotent re-evaluation
  try {
    const assets = (prev && prev.assets) || new Map();       // the asset Map MUST survive re-evaluation (§0.3)
    let epoch = prev && prev.epoch >= 0 ? prev.epoch + 1 : 0;

    const pow = Math.pow, exp = Math.exp, sin = Math.sin, cos = Math.cos, floor = Math.floor, mlog2 = Math.log2,
      PI = Math.PI;

    const VER = 1;
    const NS = 148, NV1 = 248, NF1 = 100, ND = 529, NSV = 429, NSRC = 62, MAXCH = 32, MAXFX = 8 + 48 * 24;
    const MIDI0 = 440 * pow(2, -69 / 12);                   // 8.175798915643707 Hz (MIDI note 0)

    /* ------------------------------------------------------------ destinations by vi (§3.11) */
    // Law indices (laws.js LAWS order)
    const LIN = 0, INT = 1, ENUM = 2, BOOL = 3, EXP = 4, POW2 = 5, POW4 = 7, POW5 = 8, NPITCH = 11;
    // Rows in voice-vector order: static idx 0–147, then 248–528 (vi = idx − 100); scope-M rows keep their slot unused.
    const VIDS = [], VLAW = [], VLO = [], VHI = [], VM = [];
    const dst = (id, law, lo, hi, m) => { VIDS.push(id); VLAW.push(law); VLO.push(lo); VHI.push(hi); VM.push(m ? 1 : 0); };
    const grp = (pre, rows) => { for (let i = 0; i < rows.length; i += 4) dst(pre + rows[i], rows[i + 1], rows[i + 2], rows[i + 3]); };
    const OSC17 = ['level', POW2, 0, 1, 'pan', LIN, -1, 1, 'oct', INT, -4, 4, 'semi', INT, -12, 12, 'fine', LIN, -100, 100,
      'crs', LIN, -64, 64, 'uni', INT, 1, 16, 'det', POW2, 0, 1, 'blend', LIN, 0, 1, 'phase', LIN, 0, 360,
      'rand', LIN, 0, 1, 'wt', LIN, 0, 1, 'warp', LIN, 0, 1, 'uniw', LIN, 0, 1, 'uniwarp', LIN, -1, 1,
      'uniwt', LIN, -1, 1, 'stack', ENUM, 0, 8];
    const LFO4 = ['rate', POW4, 0, 100, 'rise', LIN, 0, 4, 'delay', LIN, 0, 4, 'smooth', LIN, 0, 1];
    // ---- v1 synth rows (idx 0–147), the Phase-1 builder
    for (const o of ['a', 'b']) grp(o + '.', OSC17);
    grp('n.', ['level', POW2, 0, 1, 'pitch', NPITCH, -200, 48, 'fine', LIN, -100, 100, 'pan', LIN, -1, 1,
      'rand', LIN, 0, 1, 'phase', LIN, 0, 1]);
    grp('s.', ['level', LIN, 0, 1, 'pan', LIN, -1, 1]);
    grp('f.', ['cutoff', EXP, MIDI0, 22050, 'res', LIN, 0, 1, 'drive', LIN, 0, 1, 'var', LIN, 0, 1, 'mix', LIN, 0, 1,
      'pan', LIN, 0, 1]);
    for (let e = 1; e <= 3; e++) {
      grp('e' + e + '.', ['att', POW5, 0, 32, 'hold', POW5, 0, 32, 'dec', POW5, 0, 32, 'sus', e === 1 ? POW2 : LIN, 0, 1,
        'rel', POW5, 0, 32]);
    }
    for (let l = 1; l <= 8; l++) grp('l' + l + '.', LFO4);
    grp('', ['c1.rate', POW5, 0, 1000, 'c2.rate', POW5, 0, 1000]);
    grp('g.', ['porta', POW5, 0, 8, 'curve', LIN, -1, 1, 'tune', LIN, -64, 64, 'amp', POW2, 0, 1, 'bendup', INT, -24, 24,
      'benddn', INT, -24, 24]);
    for (let b = 1; b <= 16; b++) dst('bus' + b, LIN, -1, 1);
    grp('', ['a.on', BOOL, 0, 1, 'b.on', BOOL, 0, 1, 'n.on', BOOL, 0, 1, 's.on', BOOL, 0, 1, 'f.on', BOOL, 0, 1,
      'f.routeA', BOOL, 0, 1, 'f.routeB', BOOL, 0, 1, 'f.routeN', BOOL, 0, 1, 'f.routeS', BOOL, 0, 1,
      'a.track', BOOL, 0, 1, 'b.track', BOOL, 0, 1, 'a.warpMode', ENUM, 0, 22, 'b.warpMode', ENUM, 0, 22,
      's.shape', ENUM, 0, 4, 's.oct', INT, -4, 4, 'f.type', ENUM, 0, 95]);
    for (let e = 1; e <= 3; e++) grp('e' + e + '.', ['ca', LIN, 0, 1, 'cd', LIN, 0, 1, 'cr', LIN, 0, 1]);
    grp('', ['c1.bpm', BOOL, 0, 1, 'c2.bpm', BOOL, 0, 1, 'g.wheel', LIN, 0, 1, 'g.bend', LIN, -1, 1]);
    if (VIDS.length !== NS) throw new Error('v1 synth segment has ' + VIDS.length + ' destinations');
    // ---- SYN2 (idx 248–528), §3.11.2 normative builder
    grp('c.', OSC17);                                                              // Block C (248–266)
    grp('c.', ['on', BOOL, 0, 1, 'track', BOOL, 0, 1]);
    const O2 = ['w1', ENUM, 0, 81, 'w2', ENUM, 0, 81, 'warp2', LIN, 0, 1, 'wvar1', LIN, 0, 1, 'wvar2', LIN, 0, 1,
      'uniwarp2', LIN, -1, 1, 'ratio', EXP, 0.0625, 16, 'hz', LIN, -50, 50,
      'sstart', LIN, 0, 1, 'send', LIN, 0, 1, 'lstart', LIN, 0, 1, 'lend', LIN, 0, 1, 'xfade', LIN, 0, 1, 'scan', LIN, -1, 1,
      'scanrev', BOOL, 0, 1, 'pos', LIN, 0, 1, 'slice', INT, 0, 255,
      'gy', LIN, 0, 1, 'dens', LIN, 0, 1, 'glen', LIN, 0, 1, 'wamt', LIN, 0, 1, 'wskew', LIN, -1, 1,
      'roff', LIN, 0, 1, 'rdir', LIN, 0, 1, 'rpitch', LIN, 0, 12, 'rlen', LIN, 0, 1, 'rpan', LIN, 0, 1, 'rlvl', LIN, 0, 1,
      'rwamt', LIN, 0, 1, 'rwskew', LIN, 0, 1, 'rwarp', LIN, 0, 1, 'rwarp2', LIN, 0, 1, 'grev', BOOL, 0, 1,
      'flo', EXP, MIDI0, 22050, 'fhi', EXP, MIDI0, 22050, 'cut', LIN, -1, 1, 'smix', LIN, 0, 1,
      'mdly', POW5, 0, 32, 'matt', POW5, 0, 32, 'mhold', POW5, 0, 32, 'mdec', POW5, 0, 32, 'msus', LIN, 0, 1,
      'mrel', POW5, 0, 32, 'mvel', LIN, 0, 1, 'mrand', LIN, 0, 1, 'timbre', LIN, -64, 64,
      'ustart', LIN, 0, 1, 'uspan', LIN, 0, 1, 'fbal', LIN, -1, 1, 'bus1', POW2, 0, 1, 'bus2', POW2, 0, 1];
    for (const o of ['a', 'b', 'c']) grp(o + '.', O2);                             // Block O2 (267–419)
    grp('s.', ['shp', ENUM, 0, 5, 'crs', LIN, -64, 64, 'phase', LIN, 0, 360, 'track', BOOL, 0, 1, 'fbal', LIN, -1, 1,
      'bus1', POW2, 0, 1, 'bus2', POW2, 0, 1]);                                    // Sub (420–426)
    grp('n.', ['stereo', LIN, 0, 1, 'color', LIN, -1, 1, 'fbal', LIN, -1, 1, 'bus1', POW2, 0, 1, 'bus2', POW2, 0, 1]);
    grp('f.', ['type2', ENUM, 0, 107, 'level', POW2, 0, 4, 'routeC', BOOL, 0, 1, 'x', LIN, 0, 1, 'y', LIN, 0, 1,
      'bus1', POW2, 0, 1, 'bus2', POW2, 0, 1]);                                    // Filter 1 (432–438)
    grp('f2.', ['on', BOOL, 0, 1, 'type', ENUM, 0, 107, 'cutoff', EXP, MIDI0, 22050, 'res', LIN, 0, 1, 'drive', LIN, 0, 1,
      'var', LIN, 0, 1, 'mix', LIN, 0, 1, 'pan', LIN, 0, 1, 'level', POW2, 0, 4, 'routeA', BOOL, 0, 1, 'routeB', BOOL, 0, 1,
      'routeC', BOOL, 0, 1, 'routeN', BOOL, 0, 1, 'routeS', BOOL, 0, 1, 'x', LIN, 0, 1, 'y', LIN, 0, 1,
      'bus1', POW2, 0, 1, 'bus2', POW2, 0, 1]);                                    // Filter 2 (439–456)
    grp('e4.', ['att', POW5, 0, 32, 'hold', POW5, 0, 32, 'dec', POW5, 0, 32, 'sus', LIN, 0, 1, 'rel', POW5, 0, 32,
      'ca', LIN, 0, 1, 'cd', LIN, 0, 1, 'cr', LIN, 0, 1]);                         // ENV 4 (457–464)
    for (let e = 2; e <= 4; e++) grp('e' + e + '.', ['start', LIN, 0, 1, 'end', LIN, 0, 1]);   // 465–470
    for (const l of [9, 10]) grp('l' + l + '.', LFO4);                             // LFO 9, 10 (471–478)
    for (let l = 1; l <= 10; l++) dst('l' + l + '.phase', LIN, 0, 360);            // 479–488
    for (let m = 1; m <= 8; m++) dst('m' + m, LIN, 0, 1);                          // macros (489–496)
    grp('vc.', ['pan', LIN, 0, 1, 'det', LIN, 0, 1, 'cut', LIN, 0, 1, 'env', LIN, 0, 1, 'escale', EXP, 0.25, 4,
      'lscale', EXP, 0.25, 4]);                                                    // Voice Control (497–502)
    for (const id of ['g.direct', 'g.bus1v', 'g.bus2v']) dst(id, POW2, 0, 4, 1);  // scope M (503–505): no voice slot
    grp('arp.', ['on', BOOL, 0, 1, 'rate', LIN, 0, 1, 'shift', INT, -24, 24, 'range', INT, 1, 8, 'offset', INT, 0, 15,
      'repeats', INT, 0, 16, 'gate', LIN, 0, 2, 'chance', LIN, 0, 1, 'rrate', ENUM, 0, 5, 'vdecay', LIN, -1, 1,
      'vtarget', LIN, 0, 1, 'trans', INT, -24, 24, 'wtrans', INT, 0, 24, 'wrange', INT, 0, 8]);   // 506–519
    grp('clip.', ['on', BOOL, 0, 1, 'trans', INT, -24, 24, 'rate', ENUM, 0, 10, 'offset', LIN, 0, 1]);   // 520–523
    for (const o of ['a', 'b', 'c']) dst(o + '.lenrate', ENUM, 0, 14);              // 524–526
    grp('g.', ['bu2', INT, 0, 48, 'bd2', INT, -48, 0]);                             // 527–528
    if (VIDS.length !== NSV) throw new Error('voice vector has ' + VIDS.length + ' destinations');

    const constName = (id) => id.replace(/^fx\./, '').toUpperCase().replace(/\./g, '_');
    const didx = {}, dids = new Array(NSV);
    const IDX_OF_VI = new Int16Array(NSV);
    const LAW_TAB2 = Object.freeze({
      law: new Uint8Array(NSV), lo: new Float64Array(NSV), hi: new Float64Array(NSV), cont: new Uint8Array(NSV),
    });
    for (let v = 0; v < NSV; v++) {
      if (VM[v]) { dids[v] = ''; IDX_OF_VI[v] = -1; continue; }
      const law = VLAW[v];
      LAW_TAB2.law[v] = law; LAW_TAB2.lo[v] = VLO[v]; LAW_TAB2.hi[v] = VHI[v];
      LAW_TAB2.cont[v] = law === INT || law === ENUM || law === BOOL ? 0 : 1;
      IDX_OF_VI[v] = v < NS ? v : v + NF1;
      dids[v] = VIDS[v];
      didx[constName(VIDS[v])] = v;
    }
    const DIDX2 = Object.freeze(didx), DIDS2 = Object.freeze(dids);
    const GIDX = Object.freeze({ MASTER: 0, BYPASS: 1, DIRECT: 2, BUS1V: 3, BUS2V: 4 });

    /* ------------------------------------------------------------ sources (§3.10) */
    const SRC_IDS2 = ['', 'wheel', 'env1', 'env2', 'env3'];
    for (let l = 1; l <= 8; l++) SRC_IDS2.push('lfo' + l);
    SRC_IDS2.push('velo', 'note', 'at', 'pat', 'chaos1', 'chaos2', 'noise', 'rand1', 'rand2', 'alt1', 'alt2',
      'macro1', 'macro2', 'macro3', 'macro4', 'bend', 'mpex', 'mpey', 'mpez', 'relvel', 'fixed', 'env4', 'lfo9', 'lfo10');
    for (let l = 1; l <= 10; l++) SRC_IDS2.push('lfo' + l + 'y');
    SRC_IDS2.push('macro5', 'macro6', 'macro7', 'macro8', 'randd', 'osca', 'oscb', 'oscc', 'sub', 'filt1', 'filt2',
      'actv', 'vidx', 'vmod1', 'vmod2');
    if (SRC_IDS2.length !== NSRC) throw new Error('source table has ' + SRC_IDS2.length + ' entries');
    const sidx = {};
    for (let i = 1; i < NSRC; i++) sidx[SRC_IDS2[i].toUpperCase()] = i;
    const SIDX2 = Object.freeze(sidx);
    const SRC_POL2 = new Uint8Array(NSRC);                    // 1 = bipolar native range [−1, 1]
    for (const id of ['chaos1', 'chaos2', 'noise', 'bend', 'mpex', 'osca', 'oscb', 'oscc', 'sub', 'filt1', 'filt2',
      'vmod1', 'vmod2']) SRC_POL2[sidx[id.toUpperCase()]] = 1;
    Object.freeze(SRC_IDS2);

    /* ------------------------------------------------------------ warps (§3.4), oscillator types, filter families (§3.5) */
    const OTYPE = Object.freeze({ WT: 0, MULTI: 1, SAMPLE: 2, GRAN: 3, SPEC: 4 });
    const WDOM = Object.freeze({ NONE: 0, F: 1, P: 2, O: 3, S: 4 });
    const AV_ALL = 31, AV_SPEC = 1 << OTYPE.SPEC;
    const WIDS = [], WDOMS = [];
    const w = (id, dom) => { WIDS.push(id); WDOMS.push(dom); };
    w('off', WDOM.NONE); w('sync', WDOM.P);
    for (const id of ['bend_p', 'bend_n', 'bend_pn', 'pwm', 'asym_p', 'asym_n', 'asym_pn']) w(id, WDOM.P);
    w('flip', WDOM.O); w('mirror', WDOM.P);
    for (const id of ['remap1', 'remap2', 'remap3', 'remap4', 'quantize']) w(id, WDOM.P);
    for (const id of ['oddeven', 'lpf', 'hpf', 'd_tube', 'd_soft', 'd_hard', 'd_diode1', 'd_diode2', 'd_linfold', 'd_sinfold',
      'd_zerosq', 'd_asym', 'd_rectify', 'd_sinesh', 'd_stomp', 'd_tape', 'd_softsat']) w(id, WDOM.O);
    for (const [pre, dom, self] of [['fm', WDOM.F, 0], ['pd', WDOM.P, 1], ['am', WDOM.O, 0], ['rm', WDOM.O, 0]]) {
      for (const s of ['o1', 'o2', 'noise', 'sub', 'f1', 'f2']) w(pre + '_' + s, dom);
      if (self) w(pre + '_self', dom);
    }
    for (const id of ['s_comb', 's_gate', 's_harm', 's_subh', 's_spread', 's_smear', 's_detune', 's_pkoctu', 's_pkoctd',
      's_pkharmu', 's_pkharmd', 's_shep', 's_shepn', 's_voc_o1', 's_voc_o2', 's_voc_noise', 's_mask_o1', 's_mask_o2',
      's_mask_noise', 's_mirror', 's_pshift', 's_pblend', 's_shift', 's_twist']) w(id, WDOM.S);
    if (WIDS.length !== 82) throw new Error('warp table has ' + WIDS.length + ' entries');
    const WARP_IDS2 = Object.freeze(WIDS);
    const WARP_DOM = Uint8Array.from(WDOMS);
    const WARP_AVAIL = Uint8Array.from(WDOMS, (d) => (d === WDOM.S ? AV_SPEC : AV_ALL));

    const FILTER_FAMILY2 = Object.freeze(['ladder', 'svf', 'dual', 'morph', 'comb', 'flange', 'phaser', 'fphs', 'eq', 'ring',
      'snh', 'bank', 'french', 'german', 'addbass', 'formant', 'breject', 'distcomb', 'scream',
      'wasp', 'djm', 'diffusor', 'ladder2', 'dirty', 'pzsvf', 'comb2', 'expmm', 'k35']);
    // [family, count] runs in type order: Phase-1 types 0–95, then the "New" category 96–107
    const FAM_RUNS = [0, 4, 1, 14, 2, 13, 3, 8, 4, 8, 5, 8, 6, 14, 7, 2, 8, 5, 9, 2, 10, 2, 11, 3, 12, 1, 13, 1, 14, 1, 15, 3,
      16, 1, 17, 4, 18, 2, 19, 1, 20, 1, 21, 1, 22, 3, 23, 1, 24, 1, 25, 1, 26, 2, 27, 1];
    const FILTER_FAM2 = new Uint8Array(108);
    let nType = 0;
    for (let r = 0; r < FAM_RUNS.length; r += 2) for (let j = 0; j < FAM_RUNS[r + 1]; j++) FILTER_FAM2[nType++] = FAM_RUNS[r];
    if (nType !== 108) throw new Error('filter family runs cover ' + nType + ' types');

    /* ------------------------------------------------------------ granular windows (§3.8) */
    const WIN_N = 1024, NWIN = 10;
    function winAt(k, u) {
      switch (k) {
        case 0: return 0.5 - 0.5 * cos(2 * PI * u);                                      // Hann
        case 1: { const t = 2 * u - 1; return 1 - t * t; }                               // Welch
        case 2: { const t = (u - 0.5) / 0.15; return exp(-0.5 * t * t); }                // Gaussian
        case 3: return 0.35875 - 0.48829 * cos(2 * PI * u) + 0.14128 * cos(4 * PI * u) - 0.01168 * cos(6 * PI * u);
        case 4: { const t = 4 * (2 * u - 1), s = t === 0 ? 1 : sin(PI * t) / (PI * t); return s * (0.5 - 0.5 * cos(2 * PI * u)); }
        case 5: {                                                                        // Tukey α = 0.5
          const a = 0.5;
          if (u < a / 2) return 0.5 - 0.5 * cos(2 * PI * u / a);
          if (u > 1 - a / 2) return 0.5 - 0.5 * cos(2 * PI * (1 - u) / a);
          return 1;
        }
        case 6: { const t = 2 * u - 1; return 1 - (t < 0 ? -t : t); }                    // Triangle
        case 7: { const a = 4 * u, b = 4 * (1 - u); return a < b ? (a < 1 ? a : 1) : (b < 1 ? b : 1); }   // Trapezoid
        case 8: { const g = 200 * u; return exp(-6 * u) * (g < 1 ? g : 1); }             // ExpDec
        default: { const g = 200 * (1 - u); return exp(-6 * (1 - u)) * (g < 1 ? g : 1); } // Exp Dec Rev
      }
    }
    const WIN_TAB = new Float64Array(NWIN * (WIN_N + 1));
    for (let k = 0; k < NWIN; k++) for (let j = 0; j <= WIN_N; j++) WIN_TAB[k * (WIN_N + 1) + j] = winAt(k, j / WIN_N);

    /* ------------------------------------------------------------ ladders (§3.12, §3.15; beats, 1 bar = 4 beats) */
    // ladder variants of the first `nd` straight entries (dot × 1.5, trip × 2/3), slowest first (ties: straight, dot, trip)
    function ladders(base, nd) {
      const out = [];
      for (let v = 0; v < 4; v++) {
        const dot = v & 1, trip = v >> 1, L = [];
        for (let i = 0; i < base.length; i++) L.push([base[i], 0]);
        if (dot) for (let i = 0; i < nd; i++) L.push([base[i] * 1.5, 1]);
        if (trip) for (let i = 0; i < nd; i++) L.push([base[i] * 2 / 3, 2]);
        L.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
        out.push(Float64Array.from(L, (e) => e[0]));
      }
      return Object.freeze(out);
    }
    const LFO_STRAIGHT = [];
    for (let i = 0; i < 15; i++) LFO_STRAIGHT.push(128 * pow(2, -i));
    const ARP_STRAIGHT = [16, 8, 4, 2, 1, 0.5, 0.25, 0.125, 0.0625];
    const LAD = Object.freeze({
      lfo: ladders(LFO_STRAIGHT, 14),                                 // lengths 15 / 29 / 29 / 43
      env: Float64Array.from([0].concat(LFO_STRAIGHT.slice().reverse())),
      arp: ladders(ARP_STRAIGHT, 8),                                  // 9 / 17 / 17 / 25
      grid: ladders(ARP_STRAIGHT.concat([1 / 32, 1 / 64]), 8),        // 11 / 19 / 19 / 27
      len: Float64Array.from([0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 128]),
      rrate: Float64Array.from([1, 2, 4, 8, 16, 32]),
      time: Float64Array.from([0.25, 0.5, 1, 2, 4, 8, 16]),
      launch: Float64Array.from([0, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16]),
      vcRates: Float64Array.from([1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1, 4 / 3, 3 / 2, 2, 3, 4]),
    });

    /* ------------------------------------------------------------ fast math (Phase-1 serum-dsp code and tolerances) */
    // tanh(x)/x: [7/6] Padé approximant of tanh, then 1/|x| where it reaches 1 (x·tg(x) monotone, ≤ 1, within 9.7e-5)
    function tg(x) {
      const z = x * x;
      if (z >= 24.7009) return 1 / (x < 0 ? -x : x);
      return (135135 + z * (17325 + z * (378 + z))) / (135135 + z * (62370 + z * (3150 + 28 * z)));
    }
    function tanh(x) { return x * tg(x); }
    // 2^x = 2^i · 2^(j/64) · 2^g with g ∈ [0, 1/64): two tables and a cubic (relative error < 1e-9)
    const P2 = new Float64Array(161), E64 = new Float64Array(64);
    for (let i = 0; i < 161; i++) P2[i] = pow(2, i - 80);
    for (let j = 0; j < 64; j++) E64[j] = pow(2, j / 64);
    function exp2(x) {
      if (x < -79) return 0;
      if (x > 79) x = 79;
      const y = x * 64, k = floor(y), g = (y - k) * 0.015625;
      return P2[(k >> 6) + 80] * E64[k & 63] * (1 + g * (0.6931471805599453 + g * (0.2402265069591007 + g * 0.05550410866482158)));
    }
    // log2(x) for normal x > 0: exponent and top 8 mantissa bits from the IEEE bits, then a cubic in r (|error| < 1e-10)
    const CVF = new Float64Array(1), CVI = new Int32Array(CVF.buffer);
    CVF[0] = 1;
    const HIW = CVI[1] === 0x3FF00000 ? 1 : 0;                  // index of the high word (endianness)
    const LG_T = new Float64Array(256), LG_I = new Float64Array(256);
    for (let j = 0; j < 256; j++) { LG_T[j] = mlog2(1 + j / 256); LG_I[j] = 1 / (1 + j / 256); }
    function log2(x) {
      CVF[0] = x;
      const hi = CVI[HIW], j = (hi >> 12) & 255;
      CVI[HIW] = (hi & 0x000FFFFF) | 0x3FF00000;
      const r = CVF[0] * LG_I[j] - 1;
      return ((hi >> 20) - 1023) + LG_T[j] + r * (1.4426950408889634 - r * (0.7213475204444817 - r * 0.4808983469629878));
    }
    // sin(2πp), p in cycles: 4096-point table with linear interpolation (|error| < 3e-7)
    const SIN_N = 4096;
    const SIN_T = new Float64Array(SIN_N + 1);
    for (let i = 0; i <= SIN_N; i++) SIN_T[i] = sin(2 * PI * i / SIN_N);
    function sin1(p) {
      p -= floor(p);
      const x = p * SIN_N, i = x | 0;
      return SIN_T[i] + (SIN_T[i + 1] - SIN_T[i]) * (x - i);
    }

    /* ------------------------------------------------------------ PRNG (§6.2) */
    const R2_SALT = 0x85EBCA6B;
    function xorshift(s) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s >>> 0; }   // Phase-1 xorshift32 step
    function r2Seed(seed) { return xorshift((seed ^ R2_SALT) >>> 0) || 1; }

    /* ------------------------------------------------------------ FFT (§11.5) */
    // Tables per size, shared by every FFT(n) of the scope (built on the first construction of that size): bit reversal
    // of n, cos/sin(2πk/n) for k < n/2, and the half-size complex scratch of the real transforms. The n/2-point transform
    // inside rfwd/rinv reuses them: rev_{n/2}(i) = rev_n(i) >> 1 for i < n/2, and twiddle index k·(n/size) at any size.
    const FFT_TABS = new Map();
    function fftTabs(n) {
      let T = FFT_TABS.get(n);
      if (T) return T;
      const h = n >> 1, bits = Math.round(mlog2(n));
      const rev = new Uint32Array(n), c = new Float64Array(h > 0 ? h : 1), s = new Float64Array(h > 0 ? h : 1);
      for (let i = 0; i < n; i++) {
        let r = 0;
        for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1);
        rev[i] = r;
      }
      for (let k = 0; k < h; k++) { c[k] = cos(2 * PI * k / n); s[k] = sin(2 * PI * k / n); }
      if (h > 0 && (h & 1) === 0) { c[h >> 1] = 0; s[h >> 1] = 1; }               // exact quarter turn
      c[0] = 1; s[0] = 0;
      T = { n, rev, c, s, zr: new Float64Array(h > 0 ? h : 1), zi: new Float64Array(h > 0 ? h : 1) };
      FFT_TABS.set(n, T);
      return T;
    }
    // in-place radix-2 DIT over re/im [0, m), m = n >> sh; sg = −1 forward (e^{−2πi/m}), +1 inverse (unscaled)
    function fftCore(re, im, m, sh, T, sg) {
      if (m <= 1) return;
      const rev = T.rev, C = T.c, S = T.s, n = T.n;
      for (let i = 1; i < m; i++) {
        const j = rev[i] >>> sh;
        if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
      }
      for (let i = 0; i < m; i += 2) {                                             // size 2: W = 1
        const ar = re[i], ai = im[i], br = re[i + 1], bi = im[i + 1];
        re[i] = ar + br; im[i] = ai + bi; re[i + 1] = ar - br; im[i + 1] = ai - bi;
      }
      if (m >= 4) {
        for (let i = 0; i < m; i += 4) {                                           // size 4: W = 1, sg·i
          let ar = re[i], ai = im[i], br = re[i + 2], bi = im[i + 2];
          re[i] = ar + br; im[i] = ai + bi; re[i + 2] = ar - br; im[i + 2] = ai - bi;
          ar = re[i + 1]; ai = im[i + 1];
          const tr = -sg * im[i + 3], ti = sg * re[i + 3];
          re[i + 1] = ar + tr; im[i + 1] = ai + ti; re[i + 3] = ar - tr; im[i + 3] = ai - ti;
        }
      }
      for (let size = 8; size <= m; size <<= 1) {
        const half = size >> 1, step = n / size;
        for (let i = 0; i < m; i += size) {
          for (let j = 0, k = 0; j < half; j++, k += step) {
            const wr = C[k], wi = sg * S[k], a = i + j, b = a + half;
            const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
            re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          }
        }
      }
    }
    // FFT(n): n a power of two in [2, 65536]. Forward X[k] = Σ x[j]·e^{−2πijk/n} (unscaled), inverse scaled by 1/n (the
    // wt.js convention). fwd/inv: in place on re/im (Float64Array, length ≥ n). rfwd(x, re, im): real x (length ≥ n,
    // any array type, not modified) → bins 0…n/2 of re/im (length ≥ n/2 + 1; im[0] = im[n/2] = 0). rinv(re, im, x):
    // bins 0…n/2 (im[0] and im[n/2] ignored, i.e. the Hermitian-symmetric extension) → x[0…n) (length ≥ n); re/im are
    // not modified. Never allocate; tables and scratch are shared per size (the scope is single-threaded).
    class FFT {
      constructor(n) {
        if (!(Number.isInteger(n) && n >= 2 && n <= 65536 && (n & (n - 1)) === 0)) {
          throw new RangeError('SxBase.FFT: n must be a power of two in [2, 65536], got ' + n);
        }
        this.n = n;
        this.T = fftTabs(n);
      }
      fwd(re, im) { fftCore(re, im, this.n, 0, this.T, -1); }
      inv(re, im) {
        const n = this.n;
        fftCore(re, im, n, 0, this.T, 1);
        const g = 1 / n;
        for (let i = 0; i < n; i++) { re[i] *= g; im[i] *= g; }
      }
      rfwd(x, re, im) {
        const T = this.T, h = this.n >> 1, zr = T.zr, zi = T.zi, C = T.c, S = T.s;
        for (let m = 0; m < h; m++) { zr[m] = x[2 * m]; zi[m] = x[2 * m + 1]; }
        fftCore(zr, zi, h, 1, T, -1);
        const z0r = zr[0], z0i = zi[0];
        for (let k = 1; k < h; k++) {
          const k2 = h - k, ar = zr[k], ai = zi[k], br = zr[k2], bi = -zi[k2];
          const er = 0.5 * (ar + br), ei = 0.5 * (ai + bi), or = 0.5 * (ai - bi), oi = -0.5 * (ar - br);
          const c = C[k], s = S[k];
          re[k] = er + c * or + s * oi; im[k] = ei + c * oi - s * or;
        }
        re[0] = z0r + z0i; im[0] = 0; re[h] = z0r - z0i; im[h] = 0;
      }
      rinv(re, im, x) {
        const T = this.T, h = this.n >> 1, zr = T.zr, zi = T.zi, C = T.c, S = T.s;
        const r0 = re[0], rh = re[h];
        zr[0] = 0.5 * (r0 + rh); zi[0] = 0.5 * (r0 - rh);
        for (let k = 1; k < h; k++) {
          const k2 = h - k, ar = re[k], ai = im[k], br = re[k2], bi = -im[k2];
          const er = 0.5 * (ar + br), ei = 0.5 * (ai + bi), dr = 0.5 * (ar - br), di = 0.5 * (ai - bi);
          const c = C[k], s = S[k], or = dr * c - di * s, oi = dr * s + di * c;
          zr[k] = er - oi; zi[k] = ei + or;
        }
        fftCore(zr, zi, h, 1, T, 1);
        const g = 1 / h;
        for (let m = 0; m < h; m++) { x[2 * m] = zr[m] * g; x[2 * m + 1] = zi[m] * g; }
      }
    }

    /* ------------------------------------------------------------ half-band resamplers (§11.5, §6.10.1, §6.10.5) */
    // One stage = a symmetric half-band FIR of HB_TAPS taps (Kaiser-windowed sinc, β HB_BETA): centre tap exactly 0.5,
    // the HB_NP odd-offset tap pairs g_j (offsets ±(2j + 1)) scaled to Σ = 0.5 (DC gain 1, zero at the half rate), the
    // even-offset taps 0. IMPL (deviation from §11.5's "31 taps, Kaiser β 9", see the header): 63 taps, β 9.5.
    // Interpolator (polyphase, per base input x[m]): z[2m] = Σ 2g_j·(x[m−15+j] + x[m−16−j]), z[2m+1] = x[m−15] (the input
    // samples pass unchanged, delayed); decimator (per output, from the input pair z[2m], z[2m+1]):
    // y[m] = 0.5·z[2m−30] + Σ g_j·(z[2m−29+2j] + z[2m−31−2j]).
    const HB_TAPS = 63, HB_BETA = 9.5, HB_C = (HB_TAPS - 1) >> 1, HB_NP = (HB_C + 1) >> 1, HB_BLK = 64;
    function besselI0(x) {
      let s = 1, t = 1;
      for (let k = 1; k < 60; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; if (t < 1e-17 * s) break; }
      return s;
    }
    const HB_G = new Float64Array(HB_NP), HB_G2 = new Float64Array(HB_NP);
    {
      const i0 = besselI0(HB_BETA);
      let sum = 0;
      for (let j = 0; j < HB_NP; j++) {
        const k = 2 * j + 1, r = k / HB_C;
        HB_G[j] = (sin(0.5 * PI * k) / (PI * k)) * besselI0(HB_BETA * Math.sqrt(r < 1 ? 1 - r * r : 0)) / i0;
        sum += 2 * HB_G[j];
      }
      for (let j = 0; j < HB_NP; j++) { HB_G[j] *= 0.5 / sum; HB_G2[j] = 2 * HB_G[j]; }
    }
    // interpolator stage k: ring R[rb … rb + 64) (32 inputs, double-written), write position P[k]
    function hbUpStage(R, rb, P, k, src, so, dst, d0, cnt) {
      const G = HB_G2;
      let pos = P[k];
      for (let i = 0; i < cnt; i++) {
        pos = (pos + 1) & 31;
        const x = src[so + i];
        R[rb + pos] = x; R[rb + pos + 32] = x;
        const w = rb + pos + 1;                                  // R[w + q] = x[m − 31 + q]
        let acc = 0;
        for (let j = 0; j < HB_NP; j++) acc += G[j] * (R[w + 16 + j] + R[w + 15 - j]);
        dst[d0 + 2 * i] = acc;
        dst[d0 + 2 * i + 1] = R[w + 16];
      }
      P[k] = pos;
    }
    // decimator stage k: odd-sample ring R[rb … rb + 64), even-sample delay R[rb + 64 … rb + 96); positions P[2k], P[2k+1]
    function hbDownStage(R, rb, P, k, src, so, dst, d0, cnt) {
      const G = HB_G, eb = rb + 64;
      let po = P[2 * k], pe = P[2 * k + 1];
      for (let i = 0; i < cnt; i++) {
        const a = src[so + 2 * i], b = src[so + 2 * i + 1];
        po = (po + 1) & 31; R[rb + po] = b; R[rb + po + 32] = b;
        pe = (pe + 1) & 15; R[eb + pe] = a; R[eb + pe + 16] = a;
        const w = rb + po + 1;                                   // R[w + q] = z[2(m − 31 + q) + 1]
        let acc = 0.5 * R[eb + pe + 1];                          // z[2(m − 15)]
        for (let j = 0; j < HB_NP; j++) acc += G[j] * (R[w + 16 + j] + R[w + 15 - j]);
        dst[d0 + i] = acc;
      }
      P[2 * k] = po; P[2 * k + 1] = pe;
    }
    function osStages(osFactor, who) {
      if (!(Number.isInteger(osFactor) && osFactor >= 1 && osFactor <= 16 && (osFactor & (osFactor - 1)) === 0)) {
        throw new RangeError('SxBase.' + who + ': osFactor must be 1, 2, 4, 8 or 16, got ' + osFactor);
      }
      return Math.round(mlog2(osFactor));
    }
    // HBUp(osFactor): base rate → osFactor·base, one stage per doubling. process(inp, out, n): n base-rate inputs →
    // n·osFactor outputs (inp/out any numeric arrays, not overlapping). `delay` = group delay in base-rate samples.
    class HBUp {
      constructor(osFactor) {
        const K = osStages(osFactor, 'HBUp');
        this.os = osFactor; this.K = K;
        this.R = new Float64Array(K * 64 + 1); this.P = new Int32Array(K + 1);
        this.ta = K > 1 ? new Float64Array(HB_BLK * (osFactor >> 1)) : null;
        this.tb = K > 2 ? new Float64Array(HB_BLK * (osFactor >> 1)) : null;
        this.delay = HB_C * (osFactor - 1) / osFactor;
        this.bytes = this.R.byteLength + this.P.byteLength + (this.ta ? this.ta.byteLength : 0) + (this.tb ? this.tb.byteLength : 0);
      }
      reset() { this.R.fill(0); this.P.fill(0); }
      process(inp, out, n) {
        const K = this.K, os = this.os;
        if (K === 0) { for (let i = 0; i < n; i++) out[i] = inp[i]; return; }
        for (let off = 0; off < n; off += HB_BLK) {
          const m = n - off < HB_BLK ? n - off : HB_BLK;
          let src = inp, so = off, cnt = m;
          for (let k = 0; k < K; k++) {
            const last = k === K - 1, dst = last ? out : (k & 1) === 0 ? this.ta : this.tb, d0 = last ? off * os : 0;
            hbUpStage(this.R, k * 64, this.P, k, src, so, dst, d0, cnt);
            src = dst; so = d0; cnt *= 2;
          }
        }
      }
    }
    // HBDown(osFactor): osFactor·base → base. process(inp, out, n): n·osFactor inputs → n base-rate outputs.
    class HBDown {
      constructor(osFactor) {
        const K = osStages(osFactor, 'HBDown');
        this.os = osFactor; this.K = K;
        this.R = new Float64Array(K * 96 + 1); this.P = new Int32Array(2 * K + 1);
        this.ta = K > 1 ? new Float64Array(HB_BLK * (osFactor >> 1)) : null;
        this.tb = K > 2 ? new Float64Array(HB_BLK * (osFactor >> 1)) : null;
        this.delay = (HB_C - 1) * (osFactor - 1) / osFactor;
        this.bytes = this.R.byteLength + this.P.byteLength + (this.ta ? this.ta.byteLength : 0) + (this.tb ? this.tb.byteLength : 0);
      }
      reset() { this.R.fill(0); this.P.fill(0); }
      process(inp, out, n) {
        const K = this.K, os = this.os;
        if (K === 0) { for (let i = 0; i < n; i++) out[i] = inp[i]; return; }
        for (let off = 0; off < n; off += HB_BLK) {
          const m = n - off < HB_BLK ? n - off : HB_BLK;
          let src = inp, so = off * os, cnt = m * os;
          for (let k = 0; k < K; k++) {
            cnt >>= 1;
            const last = k === K - 1, dst = last ? out : (k & 1) === 0 ? this.ta : this.tb, d0 = last ? off : 0;
            hbDownStage(this.R, k * 96, this.P, k, src, so, dst, d0, cnt);
            src = dst; so = d0;
          }
        }
      }
    }

    /* ------------------------------------------------------------ distortion shapers (§0.3, §8.2; FX modes 0–17) */
    // Modes 0–15: the Phase-1 fx-dsp Shaper / shape(S, x) ported verbatim (Math.tanh, the same G laws and expressions,
    // so results are bit-identical; fx-dsp's S1 variants keep their own copy). 16 Overdrive: the single-stage curve of
    // §8.2 without the stage low-pass, y = 0.9·tanh(1.8·G·x)/tanh(1.8), G = 0.5·10^d (fields: a = 1/tanh(1.8), b = 0.9 —
    // FXMods2's staging sets G = 1 / b = 1 on its inner stages); 17 Soft Sat.: G = 0.5·10^(0.6d), u = G·x,
    // y = |u| < 1 ? 1.5u − 0.5u³ : sign(u). Downsample (8) is the identity here (its hold lives in the module).
    const NXS = 1025;
    const LINXS = new Float32Array(NXS);
    for (let j = 0; j < NXS; j++) LINXS[j] = j / 1024;
    const mtanh = Math.tanh, sqrt = Math.sqrt, round = Math.round, HPI = 0.5 * PI, OD_K = 1 / Math.tanh(1.8);
    const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);      // NaN → 0
    class Shaper {
      constructor() { this.mode = 0; this.G = 0.5; this.a = 0; this.b = 0; this.d = 0; this.xa = LINXS; this.xb = LINXS; }
      set(mode, d) {
        mode = mode > 0 ? (mode < 17 ? round(mode) : 17) : 0;
        d = clamp01(+d);
        this.mode = mode; this.d = d; this.a = 0; this.b = 0;
        switch (mode) {
          case 0: this.G = 0.5 * pow(10, 1.2 * d); this.a = 0.2 * d; this.b = mtanh(0.2 * d); break;
          case 1: this.G = 0.5 * pow(10, 0.9 * d); break;
          case 2: this.G = (1 + 4 * d * d * d) / 2; break;
          case 3: this.G = 1 + 9 * d * d; break;
          case 4: this.G = 1.8 * (1 + 3 * d); break;
          case 5: this.G = 0.5 + 14 * d; break;
          case 6: this.G = 0.5 + 6 * d; break;
          case 7: this.G = 0.5 * (1 + 15 * d * d); this.a = 0.1 * d; this.b = 1 + d; break;
          case 8: this.G = 1; this.a = pow(2, 8 * d); break;      // hold length (samples)
          case 9: this.G = 0.5 * (1 + 12 * d * d); break;
          case 10: this.G = 0.5 * (1 + 4 * d * d); this.a = 2 * d < 1 ? 2 * d : 1; break;
          case 11: case 12: this.G = 1; break;
          case 13: this.G = 0.5 * (1 + 3 * d); break;
          case 14: this.G = 0.5 * pow(10, 1.3 * d); break;
          case 15: this.G = 0.5 * pow(10, 0.8 * d); break;
          case 16: this.G = 0.5 * pow(10, d); this.a = OD_K; this.b = 0.9; break;
          default: this.G = 0.5 * pow(10, 0.6 * d); break;
        }
      }
    }
    function xsRd(t, p) {                                      // X-Shaper table at p ∈ [0, 1] (linear interpolation)
      const q = p * 1024;
      let i = q | 0;
      if (i > 1023) i = 1023;
      const a = t[i];
      return a + (t[i + 1] - a) * (q - i);
    }
    // static shaper y(x) of a set Shaper; Stomp Box (14) is its static core (the HP/LP belong to the caller)
    function shapeS(S, x) {
      const G = S.G;
      switch (S.mode) {
        case 0: return mtanh(G * x + S.a) - S.b;
        case 1: { const u = G * x; return u < 1.5 && u > -1.5 ? u - u * u * u / 6.75 : u > 0 ? 1 : -1; }
        case 2: { const u = G * x; return u > 1 ? 1 : u < -1 ? -1 : u; }
        case 3: { const u = G * x; return u >= 0 ? 0.9 * (1 - exp(-2 * u)) : -0.7 * (1 - exp(2 * u)); }
        case 4: { const u = G * x; return sin(u > HPI ? HPI : u < -HPI ? -HPI : u); }
        case 5: { let t = G * x + 1; t -= 4 * floor(0.25 * t); return t < 2 ? t - 1 : 3 - t; }   // (2/π)·asin(sin(π·u/2))
        case 6: return sin(HPI * G * x);
        case 7: {
          const u = G * x, a = u < 0 ? -u : u;
          if (a < S.a) return 0;
          const y = a < 1 ? pow(a, S.b) : 1;
          return u < 0 ? -y : y;
        }
        case 8: return x;
        case 9: { const u = G * x; return u >= 0 ? mtanh(1.2 * u) : mtanh(0.6 * u); }
        case 10: { const u = G * x, y = u >= 0 ? u : -S.a * u; return y > 1 ? 1 : y; }
        case 11: {
          let v = 0.5 * x;
          v = v > 1 ? 1 : v < -1 ? -1 : v;
          const a = v < 0 ? -v : v, A = xsRd(S.xa, a), y = A + S.d * (xsRd(S.xb, a) - A);
          return v < 0 ? -y : y;
        }
        case 12: {
          let v = 0.5 * x;
          v = v > 1 ? 1 : v < -1 ? -1 : v;
          const p = 0.5 * (v + 1), A = xsRd(S.xa, p);
          return 2 * (A + S.d * (xsRd(S.xb, p) - A)) - 1;
        }
        case 13: { const u = G * x; return sin(HPI * (u > 1 ? 1 : u < -1 ? -1 : u)); }
        case 14: { const u = G * x; return mtanh(1.5 * (u + 0.25 * u * u)) * (2 / 3); }
        case 15: { const u = G * x; return u / sqrt(1 + u * u); }
        case 16: { const u = G * x; return S.b * (mtanh(1.8 * u) * S.a); }
        default: { const u = G * x; return u < 1 && u > -1 ? 1.5 * u - 0.5 * u * u * u : u > 0 ? 1 : -1; }
      }
    }
    // the same curves in place on x[off … off + n): one monomorphic loop per mode (B18), bit-identical to shapeS
    function shapeBlock(S, x, off, n) {
      const G = S.G, sa = S.a, sb = S.b, e = off + n;
      switch (S.mode) {
        case 0: for (let i = off; i < e; i++) x[i] = mtanh(G * x[i] + sa) - sb; break;
        case 1: for (let i = off; i < e; i++) { const u = G * x[i]; x[i] = u < 1.5 && u > -1.5 ? u - u * u * u / 6.75 : u > 0 ? 1 : -1; } break;
        case 2: for (let i = off; i < e; i++) { const u = G * x[i]; x[i] = u > 1 ? 1 : u < -1 ? -1 : u; } break;
        case 3: for (let i = off; i < e; i++) { const u = G * x[i]; x[i] = u >= 0 ? 0.9 * (1 - exp(-2 * u)) : -0.7 * (1 - exp(2 * u)); } break;
        case 4: for (let i = off; i < e; i++) { const u = G * x[i]; x[i] = sin(u > HPI ? HPI : u < -HPI ? -HPI : u); } break;
        case 5: for (let i = off; i < e; i++) { let t = G * x[i] + 1; t -= 4 * floor(0.25 * t); x[i] = t < 2 ? t - 1 : 3 - t; } break;
        case 6: for (let i = off; i < e; i++) x[i] = sin(HPI * G * x[i]); break;
        case 7:
          for (let i = off; i < e; i++) {
            const u = G * x[i], a = u < 0 ? -u : u;
            if (a < sa) { x[i] = 0; continue; }
            const y = a < 1 ? pow(a, sb) : 1;
            x[i] = u < 0 ? -y : y;
          }
          break;
        case 8: break;
        case 9: for (let i = off; i < e; i++) { const u = G * x[i]; x[i] = u >= 0 ? mtanh(1.2 * u) : mtanh(0.6 * u); } break;
        case 10: for (let i = off; i < e; i++) { const u = G * x[i], y = u >= 0 ? u : -sa * u; x[i] = y > 1 ? 1 : y; } break;
        case 11: case 12: for (let i = off; i < e; i++) x[i] = shapeS(S, x[i]); break;   // table reads dominate
        case 13: for (let i = off; i < e; i++) { const u = G * x[i]; x[i] = sin(HPI * (u > 1 ? 1 : u < -1 ? -1 : u)); } break;
        case 14: for (let i = off; i < e; i++) { const u = G * x[i]; x[i] = mtanh(1.5 * (u + 0.25 * u * u)) * (2 / 3); } break;
        case 15: for (let i = off; i < e; i++) { const u = G * x[i]; x[i] = u / sqrt(1 + u * u); } break;
        case 16: for (let i = off; i < e; i++) { const u = G * x[i]; x[i] = sb * (mtanh(1.8 * u) * sa); } break;
        default: for (let i = off; i < e; i++) { const u = G * x[i]; x[i] = u < 1 && u > -1 ? 1.5 * u - 0.5 * u * u * u : u > 0 ? 1 : -1; } break;
      }
    }
    // shape(mode, x, d) = shapeS of a Shaper set to (mode, d) with the linear X-Shaper tables; the coefficients of the
    // last (mode, d) pair are kept, so a loop at a constant drive pays two comparisons per call
    const SH = new Shaper();
    let shM = NaN, shD = NaN;
    function shape(mode, x, d) {
      if (mode !== shM || d !== shD) { SH.set(mode, d); shM = mode; shD = d; }
      return shapeS(SH, x);
    }

    /* ------------------------------------------------------------ lazy warm-ups (§11.10, §14.1 row q) */
    // Per processor queue `proc.sxWarm = {q: [jobs], h: head, keys: {key: 1}}`, created by the first warmAdd. A job is
    // a function (proc) → truthy while it has more steps; each step must take ≤ 1 ms (split longer warm-ups into steps).
    // warmAdd(proc, key, job) queues a job once per processor and key ("the first time an apply/set selects it"), never
    // for offline processors (proc.offline: bounces, resample, render farm skip warm-ups, Phase 1) → whether queued.
    // warmTick(proc) runs one step of the head job (at most one job per call; the engine calls it once per render
    // quantum) → the number of jobs left. A throwing job is dropped (one console.warn per scope). Never allocates.
    let warnedJob = false;
    function warmAdd(proc, key, job) {
      if (proc === null || typeof proc !== 'object' || proc.offline || typeof job !== 'function') return false;
      let W = proc.sxWarm;
      if (!W) { W = { q: [], h: 0, keys: Object.create(null) }; proc.sxWarm = W; }
      const k = String(key);
      if (W.keys[k] === 1) return false;
      W.keys[k] = 1;
      W.q.push(job);
      return true;
    }
    function warmTick(proc) {
      const W = proc !== null && typeof proc === 'object' ? proc.sxWarm : null;
      if (!W) return 0;
      const q = W.q;
      if (W.h >= q.length) return 0;
      const job = q[W.h];
      let more = false;
      try { more = !!job(proc); } catch (err) {
        more = false;
        if (!warnedJob) { warnedJob = true; if (typeof console !== 'undefined') console.warn('sx-base: a warm-up job failed', err); }
      }
      if (!more) {
        q[W.h] = null;
        W.h++;
        if (W.h >= q.length) { q.length = 0; W.h = 0; }
      }
      return q.length - W.h;
    }

    /* ------------------------------------------------------------ asset store (§4.5, §9.5) */
    const warned = new Set();
    function warnOnce(id, why) {
      const key = String(id);
      if (warned.has(key)) return;
      warned.add(key);
      if (typeof console !== 'undefined') console.warn('sx-base: invalid asset entry', key, '-', why);
    }
    const tag = (a) => (a !== null && typeof a === 'object' && ArrayBuffer.isView(a) ? a[Symbol.toStringTag] : '');
    const isF32 = (a, n) => tag(a) === 'Float32Array' && (n === undefined || a.length === n);
    const isNum = (x) => typeof x === 'number' && x - x === 0;          // finite number
    const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
    const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
    const MAXI = 0x7FFFFFFF;

    function checkSmp(e) {
      if (!(isNum(e.rate) && e.rate > 0 && e.rate <= 48000)) return 'rate must be in (0, 48000]';
      if (e.ch !== 1 && e.ch !== 2) return 'ch must be 1 or 2';
      if (!isInt(e.len, 1, MAXI)) return 'len must be an integer ≥ 1';
      if (!isNum(e.root)) return 'root must be a finite number';
      if (e.loop != null) {
        const lp = e.loop;
        if (!isObj(lp) || !isNum(lp.start) || !isNum(lp.end) || !(lp.start >= 0 && lp.start < lp.end && lp.end <= e.len)) {
          return 'loop must be null or {start, end} with 0 ≤ start < end ≤ len';
        }
      }
      if (!(isNum(e.peak) && e.peak >= 0)) return 'peak must be finite ≥ 0';
      const lv = e.levels;
      if (!Array.isArray(lv) || lv.length < 1 || lv.length > 8) return 'needs 1–8 levels';
      for (let l = 0; l < lv.length; l++) {
        const x = lv[l];
        if (!isObj(x)) return 'level ' + l + ' missing';
        if (l === 0 ? x.len !== e.len : x.len !== floor(lv[l - 1].len / 2) && x.len !== lv[l - 1].len - floor(lv[l - 1].len / 2)) {
          return 'level ' + l + ' len must be ' + (l === 0 ? 'len' : 'half the previous level (floor or ceil)');
        }
        if (!isInt(x.len, 1, MAXI)) return 'level ' + l + ' len must be an integer ≥ 1';
        if (!isF32(x.L, x.len)) return 'level ' + l + ' L must be a Float32Array of len samples';
        if (e.ch === 2 ? !isF32(x.R, x.len) : x.R != null) {
          return 'level ' + l + (e.ch === 2 ? ' R must be a Float32Array of len samples' : ' R must be null for ch 1');
        }
      }
      return '';
    }
    function checkSpec(e) {
      if (!(isNum(e.rate) && e.rate > 0 && e.rate <= 48000)) return 'rate must be in (0, 48000]';
      if (e.ch !== 1) return 'ch must be 1';
      if (!isInt(e.len, 1, MAXI)) return 'len must be an integer ≥ 1';
      if (!(isInt(e.N, 64, 65536) && (e.N & (e.N - 1)) === 0)) return 'N must be a power of two in [64, 65536]';
      if (!isInt(e.hop, 1, e.N)) return 'hop must be an integer in [1, N]';
      if (!isInt(e.frames, 1, MAXI)) return 'frames must be an integer ≥ 1';
      const n = e.frames * (e.N / 2 + 1);
      if (!isF32(e.mag, n)) return 'mag must be a Float32Array(frames·(N/2+1))';
      if (!isF32(e.ph, n)) return 'ph must be a Float32Array(frames·(N/2+1))';
      if (!(tag(e.trans) === 'Uint8Array' && e.trans.length === e.frames)) return 'trans must be a Uint8Array(frames)';
      if (!(isNum(e.peak) && e.peak >= 0)) return 'peak must be finite ≥ 0';
      if (e.root !== undefined && e.root !== null && !isNum(e.root)) return 'root must be a finite MIDI note when present';
      return '';
    }
    const ZONE_MODES = ['oneshot', 'loop', 'sustain'];
    function checkZone(z) {
      if (!isObj(z)) return 'not an object';
      if (!isInt(z.lo, 0, 127) || !isInt(z.hi, z.lo, 127)) return 'lo ≤ hi must be integers in [0, 127]';
      if (!isInt(z.vlo, 0, 127) || !isInt(z.vhi, z.vlo, 127)) return 'vlo ≤ vhi must be integers in [0, 127]';
      if (!isNum(z.root) || !isNum(z.tune) || !isNum(z.gain)) return 'root, tune, gain must be finite numbers';
      if (!(isNum(z.pan) && z.pan >= -1 && z.pan <= 1)) return 'pan must be in [−1, 1]';
      if (typeof z.smp !== 'string' || z.smp === '') return 'smp must be an entry id';
      const m = ZONE_MODES.indexOf(z.mode);
      if (m < 0) return 'mode must be oneshot, loop or sustain';
      if (!isNum(z.ls) || !isNum(z.le) || !(z.ls >= 0 && (m === 0 ? z.ls <= z.le : z.ls < z.le))) {
        return 'ls, le must be finite ≥ 0 with ls ≤ le (ls < le when looping)';
      }
      if (!(isNum(z.off) && z.off >= 0)) return 'off must be finite ≥ 0';
      if (z.env != null) {                                     // null (or absent) = no override envelope
        const v = z.env;
        if (!Array.isArray(v) || v.length !== 6) return 'env must be null or [delay, a, h, d, s, r]';
        for (let i = 0; i < 6; i++) if (!(isNum(v[i]) && v[i] >= 0)) return 'env values must be finite ≥ 0';
        if (v[4] > 1) return 'env sustain must be in [0, 1]';
      }
      if (!Array.isArray(z.rr) || z.rr.length !== 2 || !isInt(z.rr[0], 1, MAXI) || !isInt(z.rr[1], 1, z.rr[0])) {
        return 'rr must be [seqLen, seqPos] with 1 ≤ seqPos ≤ seqLen';
      }
      if (!(isNum(z.vt) && z.vt >= 0 && z.vt <= 1)) return 'vt must be in [0, 1]';
      return '';
    }
    function checkMulti(e) {
      const Z = e.zones;
      if (!Array.isArray(Z) || Z.length > 512) return 'zones must be an array of ≤ 512 zones';
      for (let i = 0; i < Z.length; i++) {
        const why = checkZone(Z[i]);
        if (why) return 'zone ' + i + ': ' + why;
      }
      return '';
    }
    // partition spectra {n, re, im}: n partitions of B bins each, B one of `bins`
    function checkParts(p, maxN, bins) {
      if (!isObj(p) || !isInt(p.n, 0, maxN)) return false;
      if (tag(p.re) !== 'Float32Array' || tag(p.im) !== 'Float32Array' || p.re.length !== p.im.length) return false;
      if (p.n === 0) return p.re.length === 0;
      const B = p.re.length / p.n;
      return bins.indexOf(B) >= 0;
    }
    function checkIr(e) {
      if (!(isNum(e.rate) && e.rate > 0)) return 'rate must be > 0';
      if (e.ch !== 1 && e.ch !== 2) return 'ch must be 1 or 2';
      if (!isInt(e.len, 1, MAXI)) return 'len must be an integer ≥ 1';
      if (!(isNum(e.peak) && e.peak >= 0)) return 'peak must be finite ≥ 0';
      if (!Array.isArray(e.head) || !Array.isArray(e.hp) || !Array.isArray(e.tp)) return 'head, hp, tp must be arrays per channel';
      const mid = e.len < 8192 ? e.len : 8192;
      for (let c = 0; c < e.ch; c++) {
        if (!isF32(e.head[c], 128)) return 'head[' + c + '] must be a Float32Array(128)';
        const hp = e.hp[c], tp = e.tp[c];
        if (!checkParts(hp, 63, [128, 129, 256])) return 'hp[' + c + '] must be {n ≤ 63, re, im} with n·(128|129|256) bins';
        if (128 + 128 * hp.n < mid) return 'hp[' + c + '] does not cover the IR up to min(len, 8192)';
        if (!checkParts(tp, MAXI, [4096, 4097, 8192])) return 'tp[' + c + '] must be {n, re, im} with n·(4096|4097|8192) bins';
        if (8192 + 4096 * tp.n < e.len) return 'tp[' + c + '] does not cover the IR up to len';
      }
      return '';
    }
    const CHECK = { smp: checkSmp, spec: checkSpec, multi: checkMulti, ir: checkIr };

    function storeAsset(id, e) {
      if (typeof id !== 'string' || id === '') { warnOnce(id, 'id must be a non-empty string'); return false; }
      if (!isObj(e)) { warnOnce(id, 'not an object'); return false; }
      let why = '';
      if (e.id !== id) why = 'entry id differs from the store id';
      else if (e.v !== 1) why = 'v must be 1';
      else if (!(isNum(e.bytes) && e.bytes >= 0)) why = 'bytes must be finite ≥ 0';
      else if (typeof e.kind !== 'string' || !Object.prototype.hasOwnProperty.call(CHECK, e.kind)) why = 'kind must be smp, spec, multi or ir';
      else why = CHECK[e.kind](e);
      if (why) { warnOnce(id, why); return false; }
      assets.set(id, e);
      epoch++;
      return true;
    }
    function dropAsset(id) {
      if (!assets.delete(id)) return false;
      epoch++;
      return true;
    }
    function getAsset(id) {
      const e = assets.get(id);
      return e === undefined ? null : e;
    }
    const bl = (a) => (a && ArrayBuffer.isView(a) ? a.byteLength : 0);
    function entryBytes(e) {
      let n = 0;
      switch (e.kind) {
        case 'smp': for (let l = 0; l < e.levels.length; l++) n += bl(e.levels[l].L) + bl(e.levels[l].R); break;
        case 'spec': n = bl(e.mag) + bl(e.ph) + bl(e.trans); break;
        case 'ir':
          for (let c = 0; c < e.ch; c++) n += bl(e.head[c]) + bl(e.hp[c].re) + bl(e.hp[c].im) + bl(e.tp[c].re) + bl(e.tp[c].im);
          break;
        default: break;                                        // multi: zones only (their samples are separate entries)
      }
      return n;
    }
    function assetBytes() {
      let n = 0;
      for (const e of assets.values()) n += entryBytes(e);
      return n;
    }

    globalThis.SxBase = Object.freeze({
      VER, NS, NV1, NF1, ND, NSV, NSRC, MAXCH, MAXFX, MIDI0,
      DIDX2, DIDS2, IDX_OF_VI, LAW_TAB2, SIDX2, SRC_IDS2, SRC_POL2, GIDX,
      OTYPE, WDOM, WARP_IDS2, WARP_DOM, WARP_AVAIL, FILTER_FAMILY2, FILTER_FAM2, WIN_N, WIN_TAB, LAD,
      exp2, log2, tanh, sin1,
      NXS, LINXS, Shaper, shapeS, shapeBlock, shape,
      FFT, HB_TAPS, HB_BETA, HBUp, HBDown,
      R2_SALT, xorshift, r2Seed,
      warmAdd, warmTick,
      assets, get epoch() { return epoch; }, storeAsset, dropAsset, getAsset, assetBytes,
    });
  } catch (err) {
    globalThis.SxBase = null;                                  // a load failure never throws out of the script
    if (typeof console !== 'undefined') console.error('sx-base: load failed', err);
  }
})();
