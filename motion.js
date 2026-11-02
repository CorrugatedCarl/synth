// motion.js — the heard-time anchor ring (FR Cut B, docs/canvas/IMPL-FR-B.md §3; phase 0, then lane M-B's). The engine's fast posts
// are outputs at an audio frame F, ahead of the frame heard now (Fh = the audio clock's outFrame) by the output delay: a part keeps
// its last RING_N posts here, keyed by F, and every frame reads them AT Fh — interpolated between the two anchors that bracket it
// (almost always there: the delay exceeds the post interval), extrapolated a little past the newest, never ahead of the sound. A
// retrigger, a seek, a stage change shows when it is heard. Pure: no DOM, no clock, no audio; allocation at construction only.
//
//   ring(w, kinds, o?) → R      w values an anchor; kinds[w] (K below); o: { n = RING_N, groups?: [w] (a TIME field's HOLD key
//                               index, −1 none), lo?, hi?: [w] (the LIN / POS extrapolation clamp; default ∓Infinity) }
//   R.push(F, src, off = 0, sr?) copies w values from src[off…]: F below the newest → the ring flushes first (a new F axis: a power
//                               cycle, a sample-rate change); F equal to the newest → replaces it; a non-finite F is ignored; with
//                               sr (the gap rule, review 1 R1-B) F more than EXTRA_S past the newest flushes too — a part that left
//                               the fast ids and came back starts afresh, never bracketing across the gap
//   R.at(Fh, out, sr) → ST      the values at Fh into out[0 … w) (out untouched on NONE / BEFORE):
//     BRACKET / EXACT  F0 ≤ Fh < F1, α = (Fh − F0) / (F1 − F0) — LIN linear (a non-finite end: HOLD); PH the shortest way round
//                      (d − round(d)), wrapped to [0, 1), HOLD when |d| > PH_STEP (an LFO above a quarter of the data rate, a
//                      retrigger's jump: a step at the anchor, never a sweep the wrong way); HOLD the anchor at F0; TIME linear
//                      when its group key is the same at both ends and t1 ≥ t0, else HOLD; POS linear when 0 ≤ p0 ≤ p1, else HOLD
//                      (a Ducker's −1, a dip restarting, a loop's wrap back); PEAK the max of the anchors with F in (the last
//                      read's frame, Fh] — each anchor drained once (cv-drum's heard queue rule); none: the previous result
//     EXTRA            past the newest by ≤ EXTRA_S: LIN / POS by the last pair's slope for ≤ EXTRA_N of its intervals, clamped to
//                      [lo, hi] (POS only when that pair interpolates), then the newest; PH by the last pair's slope while that
//                      pair's |d| ≤ PH_STEP (the data rate decides), else the newest; TIME t1 + (Fh − F1) / sr; HOLD / PEAK the newest
//     HELD             past EXTRA_S: every field the newest       BEFORE  Fh before the oldest anchor (the caller keeps its slow values)
//     NONE             empty, or Fh not a number
//   R.newest() / R.oldest() (F, NaN when empty), R.size, R.w, R.drained (the last read drained a new anchor into its PEAK fields:
//   a consumer that folds peaks folds only then), R.age(Fh, sr) (s since the newest, negative while the anchors lead; Infinity when
//   empty), R.live(Fh, sr) (an anchor younger than STALE_S), R.flush()
//
// The fast layouts (identical to the engine's SerumDSP.FAST — lane E's test pins it): SXF (a Serum part's 70 fixed floats; its
// requested eff values ride after them, in a ring of their own — an ix change never flushes the 70), SLOT_K (a canvas / master
// modulator body's ring: LFO v, ph, y, out · ENV v, stage, t · Chaos v), MASTER_K (the master's meters: tp L / R, pk L / R as dB
// peaks, corr, momentary, short-term), grKinds (a rack's GR block: a Ducker's position POS, the rest LIN).

export const K = Object.freeze({ LIN: 0, PH: 1, HOLD: 2, PEAK: 3, TIME: 4, POS: 5 });
export const ST = Object.freeze({ NONE: 0, BEFORE: 1, EXACT: 2, BRACKET: 3, EXTRA: 4, HELD: 5 });
export const RING_N = 128, EXTRA_S = 0.25, EXTRA_N = 2, STALE_S = 0.5, PH_STEP = 0.25;

const { LIN, PH, HOLD, PEAK, TIME, POS } = K;
const fin = x => typeof x === 'number' && x - x === 0;

/* ---------------------------------------------------------------- the layouts */
export const SXF = Object.freeze({ mix: 0, wtPos: 11, smpPos: 14, noisePos: 26, notes: 27, lfoPh: 28, lfoOut: 38, lfoY: 48, env: 58, envStage: 62, envT: 66, N: 70 });
function sxLayout() {
  const k = new Array(SXF.N).fill(LIN), g = new Array(SXF.N).fill(-1), lo = new Array(SXF.N).fill(0), hi = new Array(SXF.N).fill(1);
  const set = (o, n, kind) => { for (let j = 0; j < n; j++) k[o + j] = kind; };
  set(SXF.mix, 11, PEAK);
  for (let o = 0; o < 3; o++) { k[SXF.smpPos + 4 * o] = POS; set(SXF.smpPos + 4 * o + 1, 3, HOLD); }
  k[SXF.noisePos] = PH; k[SXF.notes] = HOLD;
  set(SXF.lfoPh, 10, PH); set(SXF.envStage, 4, HOLD); set(SXF.envT, 4, TIME);
  for (let j = 0; j < 4; j++) g[SXF.envT + j] = SXF.envStage + j;
  for (let j = 0; j < SXF.N; j++) if (k[j] !== LIN && k[j] !== POS) { lo[j] = -Infinity; hi[j] = Infinity; }
  return { k: Object.freeze(k), g: Object.freeze(g), lo: Object.freeze(lo), hi: Object.freeze(hi) };
}
const SXL = sxLayout();
export const SXF_K = SXL.k, SXF_G = SXL.g, SXF_LO = SXL.lo, SXF_HI = SXL.hi;
export const SLOT_K = Object.freeze({ lfo: Object.freeze([LIN, PH, LIN, LIN]), env: Object.freeze([LIN, HOLD, TIME]), chaos: Object.freeze([LIN]) });
export const SLOT_G = Object.freeze({ lfo: Object.freeze([-1, -1, -1, -1]), env: Object.freeze([-1, -1, 1]), chaos: Object.freeze([-1]) });
export const MASTER_K = Object.freeze([PEAK, PEAK, PEAK, PEAK, LIN, LIN, LIN]);
export const MASTER_LO = Object.freeze([-Infinity, -Infinity, -Infinity, -Infinity, -1, -Infinity, -Infinity]);
export const MASTER_HI = Object.freeze([Infinity, Infinity, Infinity, Infinity, 1, Infinity, Infinity]);
// a rack's GR block (its gr() slots [4i … 4i + 3] for FXP instance i): LIN, a Ducker's position ([4i + 1]) POS; out reused when it
// has the length
export function grKinds(units, out) {
  let hi = -1;
  const L = Array.isArray(units) ? units : [];
  for (let j = 0; j < L.length; j++) { const u = L[j]; if (u && u.idx >= 0 && u.idx > hi) hi = u.idx | 0; }
  const len = 4 * (hi + 1), k = out && out.length === len ? out : new Uint8Array(len);
  k.fill(LIN);
  for (let j = 0; j < L.length; j++) { const u = L[j]; if (u && u.type === 'duck' && u.idx >= 0) k[4 * (u.idx | 0) + 1] = POS; }
  return k;
}

/* ---------------------------------------------------------------- the ring */
export function ring(w, kinds, o) {
  const O = o || {}, W = Math.max(0, w | 0), n = O.n > 1 ? O.n | 0 : RING_N;
  const kd = new Uint8Array(W), gp = new Int16Array(W).fill(-1), lo = new Float64Array(W).fill(-Infinity), hi = new Float64Array(W).fill(Infinity);
  let anyPk = false;
  for (let j = 0; j < W; j++) {
    const x = kinds && kinds[j] >= 0 && kinds[j] <= POS ? kinds[j] | 0 : LIN;
    kd[j] = x; if (x === PEAK) anyPk = true;
    if (O.groups && O.groups[j] >= 0 && O.groups[j] < W) gp[j] = O.groups[j] | 0;
    if (O.lo && fin(O.lo[j])) lo[j] = O.lo[j];
    if (O.hi && fin(O.hi[j])) hi[j] = O.hi[j];
  }
  const V = new Float64Array(n * W), Fs = new Float64Array(n), pk = new Float64Array(W).fill(-Infinity);
  let head = 0, size = 0, drainF = -Infinity, fresh = false; // (fresh: the last read drained an anchor)
  const slot = j => (head + j) % n;                         // the j-th anchor, oldest first
  const flush = () => { head = 0; size = 0; drainF = -Infinity; fresh = false; pk.fill(-Infinity); };

  function push(F, src, off, sr) {
    if (!fin(F) || !src) return;
    const o0 = off | 0;
    let s;
    if (size > 0) {
      const Fn = Fs[slot(size - 1)];
      if (F < Fn || (sr > 0 && F - Fn > EXTRA_S * sr)) flush();
      else if (F === Fn) s = slot(size - 1);
    }
    if (s === undefined) {
      if (size === n) { head = (head + 1) % n; size--; }
      s = slot(size); size++;
    }
    Fs[s] = F;
    const b = s * W;
    for (let j = 0; j < W; j++) { const v = src[o0 + j]; V[b + j] = typeof v === 'number' ? v : NaN; }
  }
  // PEAK: the anchors up to index i (oldest first) with F > drainF, each once; none → the previous result
  function drain(i) {
    if (!anyPk) return;
    let got = false;
    for (let j = i; j >= 0; j--) {
      const s = slot(j), F = Fs[s];
      if (!(F > drainF)) break;
      if (!got) { got = true; for (let q = 0; q < W; q++) if (kd[q] === PEAK) pk[q] = -Infinity; }
      const b = s * W;
      for (let q = 0; q < W; q++) if (kd[q] === PEAK && V[b + q] > pk[q]) pk[q] = V[b + q];
    }
    if (got) { drainF = Fs[slot(i)]; fresh = true; }
  }
  function at(Fh, out, sr) {
    fresh = false;
    if (size === 0 || !(Fh === Fh) || !out) return ST.NONE;
    if (Fh < Fs[head]) return ST.BEFORE;
    let i0 = size - 1;
    while (i0 > 0 && Fs[slot(i0)] > Fh) i0--;
    drain(i0);
    const s0 = slot(i0), F0 = Fs[s0], b0 = s0 * W;
    if (Fh === F0) {
      for (let q = 0; q < W; q++) out[q] = kd[q] === PEAK ? pk[q] : V[b0 + q];
      return ST.EXACT;
    }
    if (i0 < size - 1) {                                     // bracketed
      const s1 = slot(i0 + 1), F1 = Fs[s1], b1 = s1 * W, a = (Fh - F0) / (F1 - F0);
      for (let q = 0; q < W; q++) {
        const v0 = V[b0 + q], v1 = V[b1 + q];
        let v = v0;
        switch (kd[q]) {
          case LIN: if (fin(v0) && fin(v1)) v = v0 + (v1 - v0) * a; break;
          case PH: if (fin(v0) && fin(v1)) { let d = v1 - v0; d -= Math.round(d); if (Math.abs(d) <= PH_STEP) { v = v0 + d * a; v -= Math.floor(v); } } break;
          case TIME: { const g = gp[q]; if (fin(v0) && fin(v1) && v1 >= v0 && (g < 0 || V[b0 + g] === V[b1 + g])) v = v0 + (v1 - v0) * a; break; }
          case POS: if (fin(v0) && fin(v1) && v0 >= 0 && v1 >= v0) v = v0 + (v1 - v0) * a; break;
          case PEAK: v = pk[q]; break;
          default: break;                                    // HOLD
        }
        out[q] = v;
      }
      return ST.BRACKET;
    }
    // past the newest
    const r = sr > 0 ? +sr : 48000, dt = Fh - F0, held = dt > EXTRA_S * r;
    const two = size >= 2, sp = two ? slot(size - 2) : s0, Fp = Fs[sp], bp = sp * W, I = two ? F0 - Fp : 0;
    for (let q = 0; q < W; q++) {
      const vn = V[b0 + q];
      let v = vn;
      if (kd[q] === PEAK) v = pk[q];
      else if (!held) {
        const vp = V[bp + q];
        switch (kd[q]) {
          case LIN: case POS:
            if (two && I > 0 && dt <= EXTRA_N * I && fin(vn) && fin(vp) && (kd[q] === LIN || (vp >= 0 && vn >= vp))) {
              v = vn + (vn - vp) / I * dt;
              if (v < lo[q]) v = lo[q]; else if (v > hi[q]) v = hi[q];
            }
            break;
          case PH:
            if (two && I > 0 && fin(vn) && fin(vp)) { let d = vn - vp; d -= Math.round(d); if (Math.abs(d) <= PH_STEP) { v = vn + d / I * dt; v -= Math.floor(v); } }
            break;
          case TIME: if (fin(vn)) v = vn + dt / r; break;
          default: break;                                    // HOLD
        }
      }
      out[q] = v;
    }
    return held ? ST.HELD : ST.EXTRA;
  }
  const R = {
    w: W, n,
    push(F, src, off = 0, sr) { push(F, src, off, sr); },
    at,
    newest: () => (size ? Fs[slot(size - 1)] : NaN),
    oldest: () => (size ? Fs[head] : NaN),
    get size() { return size; },
    get drained() { return fresh; },                         // (the last read's PEAK values are new peaks, not the previous result)
    age(Fh, sr) { return size ? (Fh - Fs[slot(size - 1)]) / (sr > 0 ? +sr : 48000) : Infinity; },
    live(Fh, sr) { return size > 0 && (Fh - Fs[slot(size - 1)]) / (sr > 0 ? +sr : 48000) < STALE_S; },
    flush,
  };
  return R;
}
