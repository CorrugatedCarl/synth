/*
 * master-dsp.js — the master meters (IMPL-M §1.3, §9 O3; lane D). Classic script, last of the DSP list (after moog-dsp.js;
 * engine.js reads it at use: the master processor 'synth-master' builds its Meters in its constructor — a scope without
 * this file passes audio and posts no meters). No imports / exports: one IIFE that publishes `globalThis.MASTERDSP`; a
 * failure inside leaves MASTERDSP = null without throwing. Pure: no worklet globals, no allocation in push().
 *
 * - K-weighting (ITU-R BS.1770-4 Annex 1): the two published 48 kHz biquads (pre-filter shelf, RLB high-pass) carried to
 *   the context rate through their analog prototypes — each stage's inverse bilinear transform, prewarped at its own
 *   analog pole frequency (K48 = √((1 + a1 + a2) / (1 − a1 + a2)) = tan(π f0 / 48000): ≈ 1681.97 Hz for the shelf,
 *   ≈ 38.135 Hz for the high-pass, derived from the published numbers, nothing fitted), re-discretised at fs with
 *   K = tan(π f0 / fs). At 48 kHz the round trip returns the published coefficients (to rounding). The high-pass keeps the
 *   published numerator [1, −2, 1] (+0.043 dB in its passband, inside the −0.691 calibration).
 * - Loudness (BS.1770-4 / EBU R128): channel weights 1 / 1; 100 ms sub-blocks (0.1·fs samples: whole at every offered
 *   rate) into a ring of their mean squares → momentary (4 sub-blocks, 400 ms) and short-term (30, 3 s), updated at each
 *   sub-block end; integrated from 400 ms blocks with a 100 ms hop (4 sub-blocks), absolute gate −70 LUFS, relative gate
 *   −10 LU, kept in a preallocated histogram: 0.01 LU bins from −70 to +30 LUFS (review R1-6: +10 clamped LRA and the
 *   relative gate on hot float mixes), each its block count and the blocks' exact mean-square sum (any length, no
 *   allocation; a block above +30 LUFS lands in the top bin with its exact energy;
 *   the relative gate's error is confined to the blocks in the threshold's bin, kept when their mean is above it).
 *   Computed in summary(), never per block.
 * - LRA (EBU Tech 3342, O3): the short-term loudness at every sub-block end (10 Hz) once 3 s have passed since the
 *   restart, absolute gate −70 LUFS into a second histogram of the same shape, relative gate −20 LU below the power
 *   mean of the absolute-gated values, LRA = the 95th − the 10th percentile (bin centres).
 * - True peak (BS.1770-4 Annex 2's method, our own interpolator): 4× at ≤ 48 kHz, 2× at ≤ 96 kHz, 1× above; an L-th-band
 *   Kaiser-windowed sinc (β 5, 16·L + 1 taps): the phase-0 branch is a pure delay (the sample itself), so the true peak
 *   is never below the sample peak; the other L − 1 phases 16 taps each. Per-phase gain −0.04 … +0.014 dB up to 0.4·fs,
 *   images ≤ −53 dB above 0.6·fs. Per channel, since the last summary and held until a restart.
 * - Sample peak per channel (gap-free, since the last summary; the hold since the restart); correlation
 *   E[LR] / √(E[L²]·E[R²]) from one-pole averages (τ 300 ms) of the unweighted signal, NaN while either mean square is
 *   below 1e-20. Filter states and averages flushed to 0 below 1e-30 once per push (denormals on silence).
 *
 * API (MASTERDSP, frozen):
 *   K48                    the published 48 kHz stages { shelf, hp }: [b0, b1, b2, a1, a2] (a0 = 1)
 *   proto(c)               a 48 kHz stage's analog prototype in S = s / ω0: { f0, n: [n0, n1, n2], d: [d0, d1, d2] }
 *   carry(c, fs)           that stage re-discretised at fs → Float64Array [b0, b1, b2, a1, a2]
 *   kWeight(fs)            { shelf, hp, f0: [shelf f0, hp f0] } at fs
 *   TruePeak(fs)           one channel's interpolator: .L, .T (Float64Array((L − 1)·16), phase-major, oldest tap first),
 *                          run(X, n, o = 0) → the largest |x| or interpolated |y| of X[o, o + n) (state kept), reset()
 *   Meters(fs, { lite })   push(L, R, n, o = 0) (R may be L); summary(out?) → { m, s, i, lra, tp: [l, r], tpMax,
 *                          pk: [l, r], pkMax, corr } (LUFS / LU / dBTP / dBFS numbers, −Infinity for silence, corr NaN
 *                          for "—"; tp / pk since the previous summary, which restarts them); short() → the short-term
 *                          LUFS now; peak3() → the sample peak (linear) of the short-term window and the sub-block in
 *                          progress (lite too); integrate(on) — whether I and LRA accumulate (default on; MASTER: only
 *                          while the transport plays, review 2 F4); restart() — the integrated value, LRA and the
 *                          holds (a transport start from a stop, the OUT's reset tap: the sub-block phase restarts
 *                          there); reset() — everything (filters, rings, averages) as constructed. lite: K-weighting
 *                          and the rings only (the A/B match's input meter: short(), peak3() and summary().m / .s).
 */
(function () {
  'use strict';
  try {
    const log10 = Math.log10, sqrt = Math.sqrt, sin = Math.sin, tan = Math.tan, atan = Math.atan, exp = Math.exp,
      floor = Math.floor, round = Math.round, PI = Math.PI;

    // ITU-R BS.1770-4 Annex 1, Tables 1 and 2: the K-weighting stages at 48 kHz (a0 = 1)
    const K48 = Object.freeze({
      shelf: Object.freeze([1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585]),
      hp: Object.freeze([1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621]),
    });
    // the analog prototype of a 48 kHz biquad: z⁻¹ = (1 − K·S) / (1 + K·S) at K = tan(π f0 / 48000), f0 its analog pole
    // frequency (the prewarp that leaves the prototype's denominator with d0 = d2: unit natural frequency in S)
    function proto(c) {
      const b0 = +c[0], b1 = +c[1], b2 = +c[2], a1 = +c[3], a2 = +c[4];
      const K = sqrt((1 + a1 + a2) / (1 - a1 + a2)), K2 = K * K;
      return {
        f0: 48000 * atan(K) / PI,
        n: [b0 + b1 + b2, 2 * K * (b0 - b2), K2 * (b0 - b1 + b2)],
        d: [1 + a1 + a2, 2 * K * (1 - a2), K2 * (1 - a1 + a2)],
      };
    }
    // the prototype re-discretised at fs, prewarped at the same f0: S = (1 − z⁻¹) / (K·(1 + z⁻¹)), K = tan(π f0 / fs)
    function carry(c, fs) {
      const P = proto(c), n = P.n, d = P.d, K = tan(PI * P.f0 / fs), K2 = K * K;
      const A0 = d[0] * K2 + d[1] * K + d[2];
      return Float64Array.from([(n[0] * K2 + n[1] * K + n[2]) / A0, 2 * (n[0] * K2 - n[2]) / A0, (n[0] * K2 - n[1] * K + n[2]) / A0,
        2 * (d[0] * K2 - d[2]) / A0, (d[0] * K2 - d[1] * K + d[2]) / A0]);
    }
    function kWeight(fs) {
      const r = +fs > 0 ? +fs : 48000;
      return { shelf: carry(K48.shelf, r), hp: carry(K48.hp, r), f0: [proto(K48.shelf).f0, proto(K48.hp).f0] };
    }

    // the true-peak interpolator: L-th-band Kaiser-windowed sinc, 16 taps per phase (IMPL-M §1.3)
    const TPH = 16, BETA = 5;
    function bessel0(x) { let s = 1, t = 1; for (let k = 1; k < 60; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; if (t < 1e-17 * s) break; } return s; }
    const tpL = fs => (fs <= 48000 ? 4 : fs <= 96000 ? 2 : 1);
    // phases 1 … L − 1, each 16 taps h[p + L·k] stored oldest input first (T[(p − 1)·16 + i] = h[p + L·(15 − i)])
    function tpTaps(L) {
      const c = TPH * L / 2, N = TPH * L + 1, h = new Float64Array(N), w0 = bessel0(BETA);
      for (let j = 0; j < N; j++) {
        const x = (j - c) / L, r = (j - c) / c;
        h[j] = (x === 0 ? 1 : sin(PI * x) / (PI * x)) * bessel0(BETA * sqrt(r < 1 && r > -1 ? 1 - r * r : 0)) / w0;
      }
      const T = new Float64Array((L - 1) * TPH);
      for (let p = 1; p < L; p++) for (let i = 0; i < TPH; i++) T[(p - 1) * TPH + i] = h[p + L * (TPH - 1 - i)];
      return T;
    }
    class TruePeak {
      constructor(fs) {
        const r = +fs > 0 ? +fs : 48000;
        this.L = tpL(r); this.T = tpTaps(this.L); this.np = this.L - 1;
        this.B = new Float64Array(2 * TPH); this.w = 0;
      }
      reset() { this.B.fill(0); this.w = 0; }
      run(X, n, o) {
        const B = this.B, T = this.T, np = this.np, o0 = o | 0;
        let w = this.w, m = 0;
        for (let j = o0, e = o0 + (n | 0); j < e; j++) {
          const x = +X[j];
          B[w] = x; B[w + TPH] = x;
          w = (w + 1) & (TPH - 1);
          let a = x < 0 ? -x : x;
          for (let p = 0; p < np; p++) {
            let y = 0;
            const t = p * TPH;
            for (let i = 0; i < TPH; i++) y += T[t + i] * B[w + i];
            if (y < 0) y = -y;
            if (y > a) a = y;
          }
          if (a > m) m = a;
        }
        this.w = w;
        return m;
      }
    }

    const NB = 10000;                                        // 0.01 LU bins, −70 … +30 LUFS (the top bin takes the rest; R1-6)
    const LG = -0.691;                                        // BS.1770: L = −0.691 + 10·log10(Σ mean squares)
    const lufs = z => (z > 0 ? LG + 10 * log10(z) : -Infinity);
    const dbOf = a => (a > 0 ? 20 * log10(a) : -Infinity);
    const binOf = l => { const k = floor((l + 70) * 100); return k < 0 ? 0 : k >= NB ? NB - 1 : k; };
    // the gated mean square of a histogram (counts C, sums E, totals n / e) with the relative gate g LU below the
    // absolute-gated mean; the threshold's bin is kept when its blocks' mean is above the threshold. → [count, sum, bin]
    function gated(C, E, n, e, g, out) {
      const zr = e / n, tr = lufs(zr) + g;
      let k0 = tr <= -70 ? 0 : binOf(tr), N = 0, S = 0;
      if (tr > -70 && C[k0] > 0 && !(lufs(E[k0] / C[k0]) > tr)) k0++;
      for (let k = k0; k < NB; k++) { const c = C[k]; if (c > 0) { N += c; S += E[k]; } }
      out[0] = N; out[1] = S; out[2] = k0;
      return out;
    }

    class Meters {
      constructor(fs, opt) {
        const r = +fs > 0 && +fs < 1e7 ? +fs : 48000;
        this.fs = r; this.lite = !!(opt && opt.lite);
        const K = kWeight(r), a = K.shelf, b = K.hp;
        this.a0 = a[0]; this.a1 = a[1]; this.a2 = a[2]; this.a3 = a[3]; this.a4 = a[4];
        this.b0 = b[0]; this.b1 = b[1]; this.b2 = b[2]; this.b3 = b[3]; this.b4 = b[4];
        this.sub = round(0.1 * r);                            // 100 ms sub-block (samples)
        this.ring = new Float64Array(30); this.rw = 0;         // sub-block mean squares (L + R), the next slot
        this.pr = new Float64Array(30); this.pq = 0;           // their sample peaks (max |L|, |R|); the current one's
        this.hc = this.lite ? null : new Float64Array(NB); this.he = this.lite ? null : new Float64Array(NB);
        this.lc = this.lite ? null : new Float64Array(NB); this.le = this.lite ? null : new Float64Array(NB);
        this.g3 = new Float64Array(3);
        // true peak: the interpolator's taps and one double-length ring per channel
        this.L = tpL(r); this.np = this.L - 1; this.T = tpTaps(this.L);
        this.BL = new Float64Array(2 * TPH); this.BR = new Float64Array(2 * TPH);
        this.ca = 1 - exp(-1 / (0.3 * r));                    // correlation one-pole (τ 300 ms)
        this.reset();
      }
      // everything as constructed (an engine restart, the warm-up)
      reset() {
        this.sl1 = 0; this.sl2 = 0; this.hl1 = 0; this.hl2 = 0; this.sr1 = 0; this.sr2 = 0; this.hr1 = 0; this.hr2 = 0;
        this.ring.fill(0); this.rw = 0; this.zm = 0; this.zs = 0; this.pr.fill(0); this.pq = 0; this.ig = 1;
        this.cLR = 0; this.cLL = 0; this.cRR = 0;
        this.BL.fill(0); this.BR.fill(0); this.tw = 0;
        this.restart();
      }
      // the integrated value, LRA and the holds (with the peaks since the last summary: none from before the restart reach
      // the hold); the sub-block phase restarts here (a gating block never straddles a restart)
      restart() {
        this.se = 0; this.sn = 0; this.nSub = 0;
        if (!this.lite) { this.hc.fill(0); this.he.fill(0); this.lc.fill(0); this.le.fill(0); }
        this.iN = 0; this.iE = 0; this.lN = 0; this.lE = 0;
        this.tL = 0; this.tR = 0; this.pL = 0; this.pR = 0; this.tH = 0; this.pH = 0;
      }
      push(L, R, n, o) {
        const o0 = o | 0, e = o0 + (n | 0), sub = this.sub;
        const a0 = this.a0, a1 = this.a1, a2 = this.a2, a3 = this.a3, a4 = this.a4, b0 = this.b0, b1 = this.b1, b2 = this.b2, b3 = this.b3, b4 = this.b4;
        let sl1 = this.sl1, sl2 = this.sl2, hl1 = this.hl1, hl2 = this.hl2, sr1 = this.sr1, sr2 = this.sr2, hr1 = this.hr1, hr2 = this.hr2;
        let se = this.se, sn = this.sn, pq = this.pq;
        if (this.lite) {
          for (let j = o0; j < e; j++) {
            const x = +L[j], y = +R[j];
            let u = a0 * x + sl1; sl1 = a1 * x - a3 * u + sl2; sl2 = a2 * x - a4 * u;
            let v = b0 * u + hl1; hl1 = b1 * u - b3 * v + hl2; hl2 = b2 * u - b4 * v;
            se += v * v;
            u = a0 * y + sr1; sr1 = a1 * y - a3 * u + sr2; sr2 = a2 * y - a4 * u;
            v = b0 * u + hr1; hr1 = b1 * u - b3 * v + hr2; hr2 = b2 * u - b4 * v;
            se += v * v;
            const ax = x < 0 ? -x : x, ay = y < 0 ? -y : y;
            if (ax > pq) pq = ax;
            if (ay > pq) pq = ay;
            if (++sn === sub) { this.se = se; this.pq = pq; this.subEnd(); se = 0; sn = 0; pq = 0; }
          }
        } else {
          const BL = this.BL, BR = this.BR, T = this.T, np = this.np, ca = this.ca;
          let w = this.tw, tL = this.tL, tR = this.tR, pL = this.pL, pR = this.pR, cLR = this.cLR, cLL = this.cLL, cRR = this.cRR;
          for (let j = o0; j < e; j++) {
            const x = +L[j], y = +R[j];
            // K-weighting (DF2T shelf → high-pass), the sub-block energy
            let u = a0 * x + sl1; sl1 = a1 * x - a3 * u + sl2; sl2 = a2 * x - a4 * u;
            let v = b0 * u + hl1; hl1 = b1 * u - b3 * v + hl2; hl2 = b2 * u - b4 * v;
            se += v * v;
            u = a0 * y + sr1; sr1 = a1 * y - a3 * u + sr2; sr2 = a2 * y - a4 * u;
            v = b0 * u + hr1; hr1 = b1 * u - b3 * v + hr2; hr2 = b2 * u - b4 * v;
            se += v * v;
            // correlation (unweighted)
            cLR += ca * (x * y - cLR); cLL += ca * (x * x - cLL); cRR += ca * (y * y - cRR);
            // sample peak and true peak
            BL[w] = x; BL[w + TPH] = x; BR[w] = y; BR[w + TPH] = y;
            w = (w + 1) & (TPH - 1);
            let ax = x < 0 ? -x : x, ay = y < 0 ? -y : y;
            if (ax > pL) pL = ax;
            if (ay > pR) pR = ay;
            if (ax > pq) pq = ax;
            if (ay > pq) pq = ay;
            for (let p = 0; p < np; p++) {
              let qx = 0, qy = 0;
              const t = p * TPH;
              for (let i = 0; i < TPH; i++) { const c = T[t + i]; qx += c * BL[w + i]; qy += c * BR[w + i]; }
              if (qx < 0) qx = -qx;
              if (qy < 0) qy = -qy;
              if (qx > ax) ax = qx;
              if (qy > ay) ay = qy;
            }
            if (ax > tL) tL = ax;
            if (ay > tR) tR = ay;
            if (++sn === sub) { this.se = se; this.pq = pq; this.subEnd(); se = 0; sn = 0; pq = 0; }
          }
          if (cLL < 1e-30) cLL = 0; if (cRR < 1e-30) cRR = 0; if (cLR < 1e-30 && cLR > -1e-30) cLR = 0;
          this.tw = w; this.tL = tL; this.tR = tR; this.pL = pL; this.pR = pR; this.cLR = cLR; this.cLL = cLL; this.cRR = cRR;
        }
        const F = 1e-30;
        if (sl1 < F && sl1 > -F) sl1 = 0; if (sl2 < F && sl2 > -F) sl2 = 0; if (hl1 < F && hl1 > -F) hl1 = 0; if (hl2 < F && hl2 > -F) hl2 = 0;
        if (sr1 < F && sr1 > -F) sr1 = 0; if (sr2 < F && sr2 > -F) sr2 = 0; if (hr1 < F && hr1 > -F) hr1 = 0; if (hr2 < F && hr2 > -F) hr2 = 0;
        this.sl1 = sl1; this.sl2 = sl2; this.hl1 = hl1; this.hl2 = hl2; this.sr1 = sr1; this.sr2 = sr2; this.hr1 = hr1; this.hr2 = hr2;
        this.se = se; this.sn = sn; this.pq = pq;
      }
      // a sub-block ended (its energy in se): the ring, momentary / short-term, a gating block, an LRA value (10 Hz)
      subEnd() {
        const R = this.ring, z = this.se / this.sub;
        R[this.rw] = z; this.pr[this.rw] = this.pq;
        this.rw = this.rw === 29 ? 0 : this.rw + 1;
        let s4 = 0, s30 = 0;
        for (let k = 1; k <= 30; k++) { const v = R[(this.rw + 30 - k) % 30]; if (k <= 4) s4 += v; s30 += v; }
        this.zm = s4 / 4; this.zs = s30 / 30;
        const ns = this.nSub < 1e9 ? ++this.nSub : this.nSub;
        if (this.lite || this.ig === 0) return;
        if (ns >= 4) {
          const l = lufs(this.zm);
          if (l > -70) { const k = binOf(l); this.hc[k]++; this.he[k] += this.zm; this.iN++; this.iE += this.zm; }
        }
        if (ns >= 30) {
          const l = lufs(this.zs);
          if (l > -70) { const k = binOf(l); this.lc[k]++; this.le[k] += this.zs; this.lN++; this.lE += this.zs; }
        }
      }
      short() { return lufs(this.zs); }
      // whether the integrated value and LRA accumulate (review 2 F4: only while the transport plays; M, S, the peaks and
      // the correlation stay live); on by default and after reset(), unchanged by restart()
      integrate(on) { this.ig = on ? 1 : 0; }
      // the sample peak (linear, max |L|, |R|) of the short-term window and the sub-block in progress (review 2 F1: the
      // A/B match's headroom); a restart keeps it (as the ring)
      peak3() { const P = this.pr; let m = this.pq; for (let k = 0; k < 30; k++) if (P[k] > m) m = P[k]; return m; }
      integrated() {
        if (this.lite || this.iN === 0) return -Infinity;
        const g = gated(this.hc, this.he, this.iN, this.iE, -10, this.g3);
        return g[0] > 0 ? lufs(g[1] / g[0]) : -Infinity;
      }
      lra() {
        if (this.lite || this.lN === 0) return 0;
        const g = gated(this.lc, this.le, this.lN, this.lE, -20, this.g3), N = g[0], C = this.lc;
        if (!(N > 0)) return 0;
        let k = g[2], c = 0, lo = NaN;
        for (; k < NB; k++) {
          c += C[k];
          if (lo !== lo && c >= 0.1 * N) lo = -70 + (k + 0.5) / 100;
          if (c >= 0.95 * N) break;
        }
        const hi = -70 + ((k < NB ? k : NB - 1) + 0.5) / 100;
        return hi - lo;
      }
      summary(out) {
        const o = out || { m: 0, s: 0, i: 0, lra: 0, tp: [0, 0], tpMax: 0, pk: [0, 0], pkMax: 0, corr: 0 };
        o.m = lufs(this.zm); o.s = lufs(this.zs);
        if (this.lite) return o;
        o.i = this.integrated(); o.lra = this.lra();
        const tL = this.tL, tR = this.tR, pL = this.pL, pR = this.pR;
        if (tL > this.tH) this.tH = tL;
        if (tR > this.tH) this.tH = tR;
        if (pL > this.pH) this.pH = pL;
        if (pR > this.pH) this.pH = pR;
        o.tp[0] = dbOf(tL); o.tp[1] = dbOf(tR); o.tpMax = dbOf(this.tH);
        o.pk[0] = dbOf(pL); o.pk[1] = dbOf(pR); o.pkMax = dbOf(this.pH);
        o.corr = this.cLL < 1e-20 || this.cRR < 1e-20 ? NaN : Math.max(-1, Math.min(1, this.cLR / sqrt(this.cLL * this.cRR)));
        this.tL = 0; this.tR = 0; this.pL = 0; this.pR = 0;
        return o;
      }
    }

    globalThis.MASTERDSP = Object.freeze({ K48, proto, carry, kWeight, TruePeak, Meters });
  } catch (err) {
    globalThis.MASTERDSP = null;                               // a load failure never throws out of the script
    if (typeof console !== 'undefined') console.error('master-dsp: load failed', err);
  }
})();
