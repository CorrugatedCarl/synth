// tests/lc-stub.mjs — a stand-in for lane E's ModCore.combine / ModCore.preview (docs/canvas/IMPL-LC.md §3, §5.4) until E lands, and
// the worklet's model the view is held to (G4's node half; G4 proper runs lc-view on E's code at integration). Not a test file.
//   combine(mode, n, a, x, ax, xx)   §3 as written: c = a·x (a ≥ 0) | −a·(1 − x); Add clamp01(Σ c) (from 0: "Clip flat"), Multiply
//                                    clamp01(Π (1 − |a| + c)) (from 1); no input or every one muted → 0
//   cpOf(lfos, key) → a stub CP: lfos[l] = { lock: 'song' | 'time' | 'note' | 'rand', beats? (BPM: a cycle's beats), hz?, start, shape:
//                                    'sine' | 'tri' | 'square' | 'saw' | 'step' (hard-edged), sm (SMOOTH 0…1: τ = 0.5·sm³) }
//   preview(pay, sr) → P             lock / playX / read / rate / tau / destroy over those laws (P.destroyed counts)
//   sim(o) → { qF, qy, posts }       the processor: chunks of 4 frames from ▶ at frame Fp (a quantum boundary) and beat b0, a loop
//                                    [ls, le) wrapping, 'song' a closed form of the chunk's song beat, 'time' integrated from ▶, S&H
//                                    'rand', SMOOTH s += (y − s)·k (s = y at ▶'s chunk: oInit), the combine per chunk; qy[q] the
//                                    output at quantum q's last chunk (its end frame qF[q]); a post every o.post frames: { F (the frame
//                                    after the span), cb [y, (x, r, v)·n] — x / v the last chunk's (the chunk at F − 4) }
// Plain module: no DOM; the page side of tests/ui-layout-wc.mjs imports it too (a stand-in there while ModCore has no preview).
export const CH = 4, QN = 128;
const clamp01 = v => (v > 0 ? (v < 1 ? v : 1) : 0);
export function combine(mode, n, a, x, ax, xx) {
  let any = false;
  if (mode === 1) {
    let p = 1;
    for (let k = 0; k < n; k++) { const ak = a[ax + k], xk = x[xx + k]; if (ak !== 0) any = true; p *= 1 - Math.abs(ak) + (ak >= 0 ? ak * xk : -ak * (1 - xk)); }
    return any ? clamp01(p) : 0;
  }
  let s = 0;
  for (let k = 0; k < n; k++) { const ak = a[ax + k], xk = x[xx + k]; if (ak !== 0) any = true; s += ak >= 0 ? ak * xk : -ak * (1 - xk); }
  return any ? clamp01(s) : 0;
}
// (the square as the DSP reads a shape: a 1024-point table, linearly interpolated — an edge is a steep ramp, never a step a rounding
// of 1e-16 in the phase could flip)
const sq = i => (i % 1024 < 512 ? 1 : 0);
export const SHAPES = {
  sine: p => 0.5 - 0.5 * Math.cos(2 * Math.PI * p),
  tri: p => (p < 0.5 ? 2 * p : 2 - 2 * p),
  square: p => { const u = p * 1024, i = Math.floor(u); return sq(i) + (sq(i + 1) - sq(i)) * (u - i); },
  saw: p => p,
  step: p => (p < 0.5 ? 1 : 0),   // (R1-1) a hard edge, as a points LFO's vertical step reads: a 1e-13 rounding of the clock flips it
};
const frac = x => x - Math.floor(x);
const hash = c => { const s = Math.sin(c * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
export function cpOf(lfos, key) { return { cpKey: key || 'cp' + lfos.length, lfos }; }
export function preview(pay, sr) {
  const L = pay.cp.lfos, bpm = pay.bpm > 0 ? +pay.bpm : 120, fs = sr > 0 ? sr : 48000;
  const hz = s => (s.beats > 0 ? bpm / 60 / s.beats : s.hz);
  const P = {
    lock: l => L[l].lock,
    playX: (l, b, b0) => { const s = L[l]; return s.lock === 'song' ? s.start + b / s.beats : s.start + (b - b0) * 60 / bpm * hz(s); },
    read: (l, x) => { const s = L[l]; return s.lock === 'rand' ? hash(Math.floor(x)) : SHAPES[s.shape](frac(x)); },
    rate: l => hz(L[l]) / fs,
    tau: l => (L[l].sm > 0 ? 0.5 * L[l].sm ** 3 : 0),
    destroy() { P.destroyed++; },
    destroyed: 0,
  };
  preview.made++;
  return P;
}
preview.made = 0;
export const MC = { combine, preview };

export function sim(o) {
  const sr = o.sr || 48000, bpm = o.bpm || 120, fpb = 60 * sr / bpm, L = o.lfos, ins = o.ins, n = ins.length, mode = o.mode || 0;
  const Fp = o.Fp | 0, b0 = o.b0 || 0, lp = o.loop || null, post = o.post || 12 * QN, frames = o.frames;
  const a = Float64Array.from(ins.map(i => i.a)), vals = new Float64Array(n), xs = new Float64Array(n), sm = new Float64Array(n);
  const xt = ins.map(i => L[i.l].start), hz = s => (s.beats > 0 ? bpm / 60 / s.beats : s.hz);
  const nq = Math.floor(frames / QN), qF = new Float64Array(nq), qy = new Float64Array(nq), posts = [];
  let y = 0;
  for (let q = 0; q < nq; q++) {
    for (let c = 0; c < QN / CH; c++) {
      const Fc = Fp + q * QN + c * CH, k = q * (QN / CH) + c;
      let b = b0 + (Fc - Fp) / fpb;
      if (lp && b >= lp.le) b = lp.ls + ((b - lp.le) % (lp.le - lp.ls));
      for (let j = 0; j < n; j++) {
        const s = L[ins[j].l];
        let x;
        if (s.lock === 'song') x = s.start + b / s.beats;
        else { x = xt[j]; xt[j] += CH * hz(s) / sr; }
        const raw = s.lock === 'rand' ? hash(Math.floor(x)) : SHAPES[s.shape](frac(x)), tau = s.sm > 0 ? 0.5 * s.sm ** 3 : 0;
        if (k === 0 || !(tau > 0)) sm[j] = raw; else sm[j] += (raw - sm[j]) * (1 - Math.exp(-(CH / sr) / tau));
        vals[j] = sm[j]; xs[j] = x;
      }
      y = combine(mode, n, a, vals, 0, 0);
    }
    const F = Fp + (q + 1) * QN;
    qF[q] = F; qy[q] = y;
    if ((F - Fp) % post === 0) {
      const cb = new Float64Array(1 + 3 * n);
      cb[0] = y;
      for (let j = 0; j < n; j++) { const s = L[ins[j].l]; cb[1 + 3 * j] = xs[j]; cb[2 + 3 * j] = hz(s) / sr; cb[3 + 3 * j] = vals[j]; }
      posts.push({ F, cb });
    }
  }
  // the song beat at frame F (wrapped) and the loop pass it is in
  const beatAt = F => { const b = b0 + (F - Fp) / fpb; return lp && b >= lp.le ? lp.ls + ((b - lp.le) % (lp.le - lp.ls)) : b; };
  const passAt = F => { const b = b0 + (F - Fp) / fpb; return lp && b >= lp.le ? 1 + Math.floor((b - lp.le) / (lp.le - lp.ls)) : 0; };
  return { qF, qy, posts, fpb, beatAt, passAt };
}
