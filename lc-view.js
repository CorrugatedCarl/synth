// lc-view.js — the Combiner's whole-bar view (docs/canvas/IMPL-LC.md §6; stage LC lane F): one window of the song's beat grid on the
// face's screen (cv-mods-ui combBody) — the grid, each input faint in its cord's colour behind the sum the knob gets (Add clipped flat
// at 1: Q1), the marks, and an overlay of the playhead and the live dot. Loaded on demand beside the face (cv-mods-ui's literal import:
// precached, the boot graph as it was). No LFO law here (D3): a curve is the DSP's own functions on ModCore.preview (P.lock / playX / read /
// rate / tau, §5.4), the sum ModCore.combine (§3); the playhead and the dot read the heard frame (motion.js's ring, fed by every cb —
// slow or fast: the fast lane is off on WebKit, the slow anchors suffice).
//   timeline(st, Fh, sr, T?)   the clock of one recompute: playing — the heard line (frame Fh at the heard beat, fpb frames a beat:
//                               every chunk at a frame ≡ 0 mod 4, ModCore's grid); stopped — ▶ at the cursor (its chunk 0 on the
//                               cursor's beat: the bounce's, Q4 "how it will play from the cursor")
//   inputCurve(P, l, lock, T, A, beats, N, out, stride, off) → 1 drawn | 0 not (a time-locked input before its first anchor)
//                               one input's values at the points: a point's value is its CHUNK's (the chunk holding its frame — the
//                               g value ModCore writes there), 'song' a closed form of the song beat, 'time' / 'note' the newest anchor's
//                               line x(F) = x + (F − (F_a − LAG))·r (playing), stopped every steady one P.playX from the cursor; 'rand'
//                               the anchor's v, flat; SMOOTH: offLfo's recurrence at the chunk rate (k = 1 − e^(−dtC/τ)), from ▶ /
//                               the anchor's v, else warmed WARM·τ before (skipped ahead between points further apart)
//   sumCurve(MC, mode, n, amts, vals, N, out)   ModCore.combine at each point (vals interleaved: [i·n + k])
//   preview(MC, pay, sr) → { P, key } | null · release(h)   one P per CP (cpKey + CT key + bpm + rate + master), shared, counted
//   createView(o) → V           the face's view (below)
// Rules: no DOM at module top level; per-frame paths (V.frame) allocate nothing and read no layout; ?v=9 imports.
import { ring, K as MK, ST } from './motion.js?v=9';
import { PPQ } from './song.js?v=9';
import { fitCanvas } from './wk.js?v=9';
import { dispPalette } from './sx-ui-osc.js?v=9';

/** The display points (≤; the screen's device width if smaller), ModCore's chunk (base frames), the warm-up (τ), the anchor's lag. */
export const W_PTS = 512, CHUNK = 4, WARM = 14, LAG = 4;
/** (G6, §6.2's fallback) The chunks one SMOOTHed input's exact recurrence may walk per recompute: past it the display-step recurrence,
 * dashed. 1 bar at 120 BPM / 48 kHz walks 24 000 + its 14 τ warm-up (2 268 at SMOOTH 0.3) — exact; 2 bars at 120 (48 000), or a long
 * SMOOTH's warm-up (10 500 at 0.5), do not. Measured (IMPL-LC §17, fix round): the walk ≈ 20 ns a chunk in Chrome at 1 × (the DSP's
 * read), × 6 at 6 × — 28 000 ≈ 3.4 ms there, inside G6's 4 ms recompute with the other inputs and the paint. */
export const SM_MAX = 28000;
/** The screen (layout px: the face's inner width × the grid's large screen — rig-grid's numbers, nothing measured). */
export const SCR_W = 384, SCR_H = 128;
/** The plot's band inside the screen (px): the top margin, the foot (the marks' strip). */
export const TOP = 6, FOOT = 10;
const fin = x => typeof x === 'number' && x - x === 0;
const EPS = 1e-7, NONE = Object.freeze({}), NONE_A = Object.freeze([]), MEMO_F = Object.freeze(['K', 'ok', 'line', 'N', 'mt', 'aF', 'ax', 'ar', 'av']);
// the line dashes (made once: a paint allocates nothing): solid, a muted input's dots, a dashed input's, the dashed sum's, the cursor's
const SOLID = Object.freeze([]), DOT = Object.freeze([1, 3]), DASH = Object.freeze([4, 3]), DASH2 = Object.freeze([5, 3]), CURSOR = Object.freeze([3, 3]);

/** Beats a bar (quarter notes): 4·num / den. */
export const barBeatsOf = sig => { const n = Array.isArray(sig) ? +sig[0] : sig ? +sig.num : 4, d = Array.isArray(sig) ? +sig[1] : sig ? +sig.den : 4; return n > 0 && d > 0 ? 4 * n / d : 4; };
/** The window around beat b: [w0, w0 + W), W = win bars. */
export function windowOf(b, win, barBeats, out) {
  const W = (win > 0 ? +win : 1) * (barBeats > 0 ? barBeats : 4), o = out || [0, 0];
  o[0] = Math.floor((fin(b) ? b : 0) / W + EPS) * W; o[1] = W;
  return o;
}

/* ================================================================ the timeline */
/** The clock of one recompute (T reused when given). st: the host's song() — { bpm, sig, playing, tick, cursor, loop: { on, start, end },
 * start?, pass? } (ticks; start: where this run began — ▶ or the last seek —, pass: the loop pass since then, 0 the first). */
export function timeline(st, Fh, sr, T) {
  const t = T || {}, S = st || {}, L = S.loop;
  t.bpm = S.bpm > 0 ? +S.bpm : 120; t.sr = sr > 0 ? +sr : 48000; t.fpb = 60 * t.sr / t.bpm; t.dtC = CHUNK / t.sr;
  t.playing = !!S.playing && fin(Fh);
  t.Fh = t.playing ? Fh : 0;
  t.bh = (t.playing ? (fin(S.tick) ? S.tick : 0) : (fin(S.cursor) ? S.cursor : 0)) / PPQ;
  t.b0 = t.playing ? (fin(S.start) ? S.start / PPQ : NaN) : t.bh;  // (stopped: ▶ at the cursor)
  t.pass = fin(S.pass) ? S.pass : -1;                              // (-1 unknown)
  t.lon = !!(L && L.on && L.end > L.start); t.ls = t.lon ? L.start / PPQ : 0; t.le = t.lon ? L.end / PPQ : 0;
  // the first played frame: ▶'s chunk (stopped: 0; playing in pass 0 with its start known: that tick's frame) — none: −∞
  t.F0 = !t.playing ? 0 : t.pass === 0 && fin(t.b0) ? CHUNK * Math.ceil((t.Fh + (t.b0 - t.bh) * t.fpb) / CHUNK - EPS) : -Infinity;
  return t;
}
/** The frame of beat b on the timeline (playing: the heard line; stopped: frames since ▶). */
export const frameOf = (T, b) => (T.playing ? T.Fh + (b - T.bh) * T.fpb : (b - T.b0) * T.fpb);
/** The chunk holding frame F (its first frame). */
export const chunkOf = F => CHUNK * Math.floor(F / CHUNK + EPS);
// the song beat a chunk at frame F plays: this pass's line; (pass > 0) a frame before the pass's wrap played the loop's end
function beatAt(T, F) {
  if (!T.playing) return T.b0 + F / T.fpb;
  const b = T.bh + (F - T.Fh) / T.fpb;
  return T.lon && T.pass > 0 && T.bh >= T.ls && b < T.ls ? b + (T.le - T.ls) : b;
}

/* ================================================================ one input's curve */
/**
 * One input's values at the points beats[0 … N) (ascending) into out[off + i·stride]. P the preview, l its slot, lock P.lock(l), T a
 * timeline, A its newest anchor { F, x, r, v } (F NaN: none), max the SMOOTH chunk budget (none: exact always). → 1 drawn exact, 2 drawn
 * by the display-step recurrence (a SMOOTHed input past max chunks: dashed — §6.2's fallback, never claimed exact), 0 not drawn (a
 * time-locked or random input with no anchor yet).
 */
export function inputCurve(P, l, lock, T, A, beats, N, out, stride, off, max) {
  const rand = lock === 'rand', anch = T.playing && lock !== 'song' && !rand, hasA = !!A && fin(A.F);
  if (rand || anch) { if (!hasA) { for (let i = 0; i < N; i++) out[off + i * stride] = NaN; return 0; } }
  if (rand) { const v = fin(A.v) ? A.v : NaN; for (let i = 0; i < N; i++) out[off + i * stride] = v; return 1; }
  const Fa = anch ? A.F - LAG : 0, xa = anch ? A.x : 0, ra = anch ? A.r : 0;
  // (R1-1) ▶'s chunk (pass 0, its start known) from the clock's definition — P.playX at b0 itself ('song' its closed form, 'time' its
  // start) — never rebuilt from later data (± 1e-13 puts a hard edge's start on the wrong side, and SMOOTH carries it ≈ 14 τ)
  const F0 = T.F0, b0 = T.b0, x0 = fin(F0) ? +P.playX(l, b0, b0) : NaN;
  const clk = F => (F === F0 ? x0 : anch ? xa + (F - Fa) * ra : P.playX(l, beatAt(T, F), b0));
  const tau = +P.tau(l) || 0;
  if (!(tau > 0)) {
    for (let i = 0; i < N; i++) out[off + i * stride] = P.read(l, clk(chunkOf(frameOf(T, beats[i]))));
    return 1;
  }
  // SMOOTH: offLfo's recurrence chunk by chunk (s += (y − s)·k), sampled at each point's chunk; a point before ▶ reads the raw law
  const k = 1 - Math.exp(-T.dtC / tau), warm = CHUNK * Math.ceil(WARM * tau / T.dtC);
  const Fs = anch && fin(A.v) ? chunkOf(Fa) : NaN, Av = hasA ? A.v : NaN; // (time-locked: the anchor's v is the smoother's own value there)
  // (G6) the chunks the exact recurrence walks (its restarts as below); past max: the display-step recurrence, dashed
  if (max > 0) {
    let c = 0, Fp = NaN;
    for (let i = 0; i < N; i++) { const Fi = chunkOf(frameOf(T, beats[i])); if (Fi < F0) continue; c += !(Fp <= Fi) || Fi - Fp > warm ? Fi - Math.max(Fi - warm, F0) : Fi - Fp; Fp = Fi; }
    if (c / CHUNK > max) return approx(P, l, T, beats, N, out, stride, off, clk, tau, warm);
  }
  // the chunk loop's clock inlined (no closure, no property read per chunk): time-locked the anchor's line; else P.playX at the chunk's
  // beat on this pass's line (a frame before a later pass's wrap played the loop's end) — the very expressions of clk / beatAt
  const pl = T.playing, bh = T.bh, Fh = T.Fh, fpb = T.fpb, wr = pl && T.lon && T.pass > 0 && T.bh >= T.ls, ls = T.ls, lw = T.le - T.ls, rd = P.read, px = P.playX;
  let F = NaN, s = 0;
  for (let i = 0; i < N; i++) {
    const Fi = chunkOf(frameOf(T, beats[i]));
    if (Fi < F0) { out[off + i * stride] = P.read(l, clk(Fi)); continue; }
    if (!(F <= Fi) || Fi - F > warm) {                             // (a fresh start: ▶'s chunk, the anchor's, else a warm-up)
      F = Math.max(Fi - warm, F0);
      if (Fs <= Fi && Fs > F) F = Fs;
      s = F === Fs ? Av : P.read(l, clk(F));
    }
    if (anch) {
      for (let G = F + CHUNK; G <= Fi; G += CHUNK) {
        if (G === Fs) { s = Av; continue; }
        s += (rd(l, xa + (G - Fa) * ra) - s) * k;
      }
    } else if (pl) {
      for (let G = F + CHUNK; G <= Fi; G += CHUNK) {
        let b = bh + (G - Fh) / fpb;
        if (wr && b < ls) b += lw;
        s += (rd(l, px(l, b, b0)) - s) * k;
      }
    } else {
      for (let G = F + CHUNK; G <= Fi; G += CHUNK) s += (rd(l, px(l, b0 + G / fpb, b0)) - s) * k;
    }
    F = Fi;
    out[off + i * stride] = s;
  }
  return 1;
}
// (G6, §6.2's fallback) the one-pole at the display step — y read at each point's chunk, k from the step's own dt — from 14 τ before the
// first point (▶'s chunk at the latest; a point before ▶ the raw law): cheap, not the DSP's (a hard edge inside a step leaves its error)
function approx(P, l, T, beats, N, out, stride, off, clk, tau, warm) {
  const F0 = T.F0, sr = T.sr;
  let F = NaN, s = 0;
  for (let i = 0; i < N; i++) {
    const Fi = chunkOf(frameOf(T, beats[i]));
    if (Fi < F0) { out[off + i * stride] = P.read(l, clk(Fi)); continue; }
    if (!(F <= Fi)) {
      const Fn = N > 1 ? Math.max(CHUNK, chunkOf((frameOf(T, beats[N - 1]) - frameOf(T, beats[0])) / (N - 1))) : CHUNK; // (the display step)
      F = Math.max(Fi - warm, F0); s = P.read(l, clk(F));
      for (let G = F + Fn; G < Fi; G += Fn) s += (P.read(l, clk(G)) - s) * (1 - Math.exp(-Fn / sr / tau)), F = G;
    }
    s += (P.read(l, clk(Fi)) - s) * (1 - Math.exp(-(Fi - F) / sr / tau));
    F = Fi;
    out[off + i * stride] = s;
  }
  return 2;
}
/** The sum at each point: ModCore.combine over the inputs' values (vals[i·n + k]) and amounts (0 muted). */
export function sumCurve(MC, mode, n, amts, vals, N, out) {
  for (let i = 0; i < N; i++) out[i] = n > 0 ? MC.combine(mode, n, amts, vals, 0, i * n) : 0;
  return out;
}

/* ================================================================ the previews (one per CP, shared) */
const PREV = new Map();   // key → { P, n }
/** The preview of a payload's CP (ModCore.preview), shared by key (cpKey + CT key + bpm + rate + the master flag); null without one. */
export function preview(MC, pay, sr) {
  if (!MC || typeof MC.preview !== 'function' || !pay || !pay.cp) return null;
  const key = String(pay.cp.cpKey || '') + '|' + String(pay.ct && pay.ct.key || '') + '|' + (+pay.bpm || 120) + '|' + (+sr || 48000) + (pay.i === 'master' ? '|m' : ''); // ((review 1 R1-7) the master's laws are noteless)
  let e = PREV.get(key);
  if (!e) {
    let P = null;
    try { P = MC.preview(pay, +sr || 48000); } catch (err) { console.error('lc-view: preview', err); P = null; }
    if (!P) return null;
    PREV.set(key, (e = { P, n: 0 }));
  }
  e.n++;
  return { P: e.P, key };
}
/** Drops a preview handle; the last one destroys its P. */
export function release(h) {
  const e = h ? PREV.get(h.key) : null;
  if (!e || --e.n > 0) return;
  PREV.delete(h.key);
  try { if (typeof e.P.destroy === 'function') e.P.destroy(); } catch (err) { /* gone */ }
}
/** (tests) the previews held. */
export const previews = () => PREV.size;

/* ================================================================ the view */
const MODE = { add: 0, mul: 1 };
const hexA = (c, a) => { const m = /^#([0-9a-f]{6})$/i.exec(String(c || '')); if (!m) return c || '#ffffff'; const v = parseInt(m[1], 16); return 'rgba(' + (v >> 16) + ', ' + ((v >> 8) & 255) + ', ' + (v & 255) + ', ' + a + ')'; };
/**
 * The face's view over its two canvases. o = { curves, overlay (canvas elements), el (the screen: the palette's element), devKey,
 * mc: () => ModCore | null, payload: () => the track's last posted payload | null, inputs: () => [{ row, color, amt, byp }] (the list's
 * live rows), dev: () => { mode, win, mark }, song: () => the host's song() (one reused object), heardFrame: () => Fh, sampleRate,
 * marks?: (t0, t1) → ticks }. →
 *   push(F, cb, i)      a monitor block at offset i ([y, (x, r, v)·n]): y into the ring, the newest anchors kept (change-gated, no allocation)
 *   frame()             the clock's: the recompute when a key moved (§6.6), then the overlay; → true while live (playing or the ring live)
 *   dirty(level)        1 the sum (an amount / mute / mode), 2 the curves, 3 the palette too — done at the next frame()
 *   restyle()           the palette read again (a host's sync: a skin switch repaints, nothing recomputes)
 *   curveAt(beats, out) the sum at beats (the current state; G4) → out · state() (tests) · live() · value() (the dot's y) · destroy()
 */
export function createView(o) {
  const O = o || {};
  const R = ring(1, [MK.LIN], { n: 128, lo: [0], hi: [1] }), ybuf = new Float64Array(1);
  const T = timeline(null, NaN, 48000), win = [0, 1];
  let h = null, pay = null, ent = null, n = 0, slotL = [], locks = [], rows = [], A = [], vals = new Float64Array(0), sum = new Float64Array(W_PTS);
  let amts = new Float64Array(0), beats = new Float64Array(W_PTS), N = 0, drawn = [], dash = [], mode = 0, dead = false;
  let inp = null, dash0 = [], lvl = 3, pal = null, line0 = NaN, tick0 = NaN, Fh0 = NaN, mk = [], recomputes = 0, memos = 0, combines = 0, mt = null;
  let ox = NaN, oy = NaN, oPl = null, oBox = null, yLive = NaN;
  const K = new Float64Array(11), K1 = new Float64Array(11).fill(NaN);
  const MC = () => { try { return typeof O.mc === 'function' ? O.mc() : null; } catch (err) { return null; } };
  const sr = () => { const r = typeof O.sampleRate === 'function' ? +O.sampleRate() : 0; return r > 0 ? r : 48000; };
  const call = (f, ...a) => { try { return typeof f === 'function' ? f(...a) : undefined; } catch (err) { console.error(err); return undefined; } };
  const get = f => { try { return typeof f === 'function' ? f() : undefined; } catch (err) { console.error(err); return undefined; } }; // (no rest array: the frame's and a post's reads)
  // the payload's inputs (cmb's own: no left one) → slots, locks, anchors; a new CP → a new preview. → 0 the same; 1 a repost on the same
  // preview and inputs (an amount / mute / mode: the combine only, §6.6); 2 another preview or input set (the curves)
  let mc0 = null;
  function bind() {
    const p = get(O.payload) || null, mc = MC();
    if (p === pay && mc === mc0) return 0;
    pay = p; mc0 = mc;
    const C = p && Array.isArray(p.cmb) ? p.cmb.find(c => c && c.id === O.devKey) : null;
    const nh = C ? preview(mc, p, sr()) : null;
    const L = C && Array.isArray(C.in) ? C.in : [], same = L.length === n && L.every((x, k) => x.row === rows[k] && (x.l | 0) === slotL[k]);
    const keep = same && !!h && !!nh && nh.key === h.key;
    if (h) release(h);
    h = nh; ent = C;
    if (keep) return 1;
    n = L.length; slotL = L.map(x => x.l | 0); rows = L.map(x => x.row);
    locks = h ? slotL.map(l => { try { return String(h.P.lock(l)); } catch (err) { return 'rand'; } }) : slotL.map(() => 'rand');
    if (!same || A.length !== n) A = Array.from({ length: n }, () => ({ F: NaN, x: 0, r: 0, v: NaN, F1: NaN, x1: 0, r1: 0, v1: NaN })); // (another input set: its anchors afresh)
    vals = new Float64Array(W_PTS * Math.max(1, n)); amts = new Float64Array(Math.max(1, n));
    M1.vals = new Float64Array(vals.length); M1.drawn = new Array(n).fill(0); M1.dash = new Array(n).fill(false); M1.ok = M0.ok = false; frc = true;
    for (const m of [M0, M1]) { m.aF = new Float64Array(n); m.ax = new Float64Array(n); m.ar = new Float64Array(n); m.av = new Float64Array(n); }
    drawn = new Array(n).fill(0); dash0 = locks.map(k => k === 'note' || k === 'rand'); dash = dash0.slice();
    return 2;
  }
  // the amounts from the list's live rows (0 muted), the mode from the device
  function amounts() {
    const I = inp = get(O.inputs) || [], D = get(O.dev) || NONE;  // (inp: the list's rows this paint reads too — the host asked once)
    mode = MODE[D.mode] != null ? MODE[D.mode] : ent && ent.mode === 1 ? 1 : 0;
    for (let k = 0; k < n; k++) {
      const r = I.find(x => x && x.row === rows[k]), a = r ? (r.byp ? 0 : +r.amt) : ent && ent.in[k] ? +ent.in[k].a : 0;
      amts[k] = fin(a) ? Math.max(-1, Math.min(1, a)) : 0;
    }
  }
  // (G6) the curves of the keys before, kept one deep (M1; M0 the current's keys and anchors): a window edit there and back — or any key
  // move that comes back — takes them again when the keys, the line, the points and every input's newest anchor are still theirs (§6.6's
  // line check, modulo 1); a forced recompute (dirty 2, new inputs, a restart, a new context) never does
  const M0 = { ok: false, K: new Float64Array(11), line: NaN, N: 0, mt: null, aF: null, ax: null, ar: null, av: null };
  const M1 = { ok: false, K: new Float64Array(11), line: NaN, N: 0, mt: null, aF: null, ax: null, ar: null, av: null, vals: null, drawn: null, dash: null };
  let frc = true;
  function onLine(m) {
    for (let k = 0; k < n; k++) {
      const a = A[k], lk = locks[k];
      if (lk === 'rand') { if (!(a.v === m.av[k] || (a.v !== a.v && m.av[k] !== m.av[k]))) return false; continue; }
      if (!T.playing || lk === 'song') continue;
      if (!fin(a.F) || !fin(m.aF[k])) { if (fin(a.F) !== fin(m.aF[k])) return false; continue; }
      let d = a.x - (m.ax[k] + (a.F - m.aF[k]) * m.ar[k]);
      d -= Math.round(d);
      if (!(Math.abs(d) <= 1e-6)) return false;
    }
    return true;
  }
  function recompute() {
    const st = get(O.song) || NONE, Fh = +get(O.heardFrame);
    timeline(st, Fh, sr(), T);
    const D = get(O.dev) || NONE;
    windowOf(T.bh, D.win, barBeatsOf(st.sig), win);
    const dens = typeof O.density === 'function' ? +O.density() || 1 : 1;
    N = Math.max(2, Math.min(W_PTS, Math.ceil(SCR_W * dens)));
    for (let i = 0; i < N; i++) beats[i] = win[0] + win[1] * i / (N - 1);
    let same = !frc && M1.ok && M1.N === N && M1.line === line0 && M1.mt === mt && !!M1.vals && M1.vals.length === vals.length;
    for (let j = 0; same && j < K1.length; j++) if (M1.K[j] !== K1[j]) same = false;
    if (same) same = onLine(M1);
    // the current curves become the memo (their keys M0's), the memo's buffers the current
    { const v = vals, d0 = drawn, d1 = dash; vals = M1.vals; drawn = M1.drawn; dash = M1.dash; M1.vals = v; M1.drawn = d0; M1.dash = d1; }
    for (const f of MEMO_F) { const t = M1[f]; M1[f] = M0[f]; M0[f] = t; }
    M0.K.set(K1); M0.line = line0; M0.N = N; M0.mt = mt; M0.ok = true;
    for (let k = 0; k < n; k++) {
      const a = A[k];
      if (same) { a.F1 = M0.aF[k]; a.x1 = M0.ax[k]; a.r1 = M0.ar[k]; a.v1 = M0.av[k]; continue; } // (the anchor those curves stand on)
      drawn[k] = h ? inputCurve(h.P, slotL[k], locks[k], T, a, beats, N, vals, n, k, SM_MAX) : 0;
      dash[k] = dash0[k] || drawn[k] === 2;                       // (G6: a SMOOTHed input past the chunk budget: drawn dashed)
      a.F1 = a.F; a.x1 = a.x; a.r1 = a.r; a.v1 = a.v;              // (the anchor this curve stands on: §6.6's check)
      M0.aF[k] = a.F1; M0.ax[k] = a.x1; M0.ar[k] = a.r1; M0.av[k] = a.v1;
    }
    frc = false;
    if (same) memos++; else recomputes++;
    // the marks: the chosen track's hits in the window (page data: the host's)
    mk = D.mark && typeof O.marks === 'function' ? (call(O.marks, win[0] * PPQ, (win[0] + win[1]) * PPQ) || []) : [];
  }
  function combine() {
    amounts();
    const mc = MC();
    let ok = !!(mc && typeof mc.combine === 'function') && n > 0;
    for (let k = 0; k < n; k++) if (!drawn[k] && amts[k] !== 0) ok = false;
    if (ok) sumCurve(mc, mode, n, amts, vals, N, sum); else for (let i = 0; i < N; i++) sum[i] = n ? NaN : 0;
    combines++;
  }
  /* ------------------------------------------------ drawing (on a change only) */
  const yOf = v => TOP + (1 - v) * (SCR_H - TOP - FOOT);
  const xOf = b => (b - win[0]) / win[1] * SCR_W;
  // (G6) the layers an amount / mute / mode change composites instead of drawing again: the screen's ground + grid (one bitmap: redrawn
  // only when its window length, signature, skin or size moves — every window starts on a bar line) and each input's faint curve at full
  // alpha (one bitmap each, drawn at its alpha by |amount|) — offscreen canvases, never in the face's DOM. A recompute's frame draws the
  // inputs straight onto the screen (its layers stale: built at the next amount / mute / mode change, then only composited); after that
  // only the sum's path, the marks and the dims are drawn
  let Lg = null, gW = NaN, gD = NaN, gB = NaN, gP = null, Li = [], Lc = [], Lm = [], Lok = [], ldW = 0, ldH = 0, lP = null;
  const layer = (c, w, hh) => { if (!c) { const d = (O.curves && O.curves.ownerDocument) || globalThis.document; c = d && typeof d.createElement === 'function' ? d.createElement('canvas') : null; } if (c && (c.width !== w || c.height !== hh)) { c.width = w; c.height = hh; } return c; };
  const ctxOf = (c, s) => { const g = c && c.getContext ? c.getContext('2d') : null; if (g && g.setTransform) g.setTransform(s, 0, 0, s, 0, 0); return g; };
  function paintGround(g, Pl, den, bb) {
    const W = win[1], w0 = win[0];
    g.globalAlpha = 1;
    g.fillStyle = Pl.bg; g.fillRect(0, 0, SCR_W, SCR_H);
    // the grid: sixteenths faint, the signature's beats (4 / den quarter notes), the bars
    g.lineWidth = 1;
    for (let j = 0; j < 3; j++) {
      const step = j === 0 ? 0.25 : j === 1 ? 4 / den : bb;
      g.strokeStyle = j === 0 ? Pl.mute_35 : j === 1 ? Pl.grid : Pl.mute;
      g.globalAlpha = j === 0 ? 0.35 : 1;
      g.beginPath();
      for (let b = Math.ceil(w0 / step - EPS) * step; b < w0 + W - EPS; b += step) { const x = Math.round(xOf(b)) + 0.5; g.moveTo(x, 0); g.lineTo(x, SCR_H - FOOT); }
      g.stroke();
    }
    g.globalAlpha = 1;
    g.strokeStyle = Pl.grid; g.beginPath(); g.moveTo(0, yOf(0) + 0.5); g.lineTo(SCR_W, yOf(0) + 0.5); g.moveTo(0, yOf(1) - 0.5); g.lineTo(SCR_W, yOf(1) - 0.5); g.stroke();
  }
  const alphaOf = (k, muted) => (muted ? 0.18 : 0.22 + 0.4 * Math.abs(amts[k]));
  function strokeIn(q, k, c, muted, a) {
    q.lineWidth = 1; q.strokeStyle = hexA(c, a);
    if (q.setLineDash) q.setLineDash(muted ? DOT : dash[k] ? DASH : SOLID);
    path(q, vals, n, k);
    q.stroke();
  }
  function paintCurves(fresh) {
    const cv = O.curves;
    if (!cv) return;
    const g = fitCanvas(cv, SCR_W, SCR_H);
    if (!g) return;
    if (!pal || lvl >= 3) pal = dispPalette(O.el || cv);          // (else restyle()'s: one style read at a host's sync, never per frame)
    const Pl = pal, W = win[1], w0 = win[0], sig = (get(O.song) || NONE).sig, bb = barBeatsOf(sig), den = Array.isArray(sig) ? +sig[1] || 4 : sig && +sig.den || 4;
    const dw = cv.width, dh = cv.height, s = dw / SCR_W, I = inp || NONE_A;
    if (dw !== ldW || dh !== ldH || Pl !== lP) { ldW = dw; ldH = dh; lP = Pl; gP = null; Lok.length = 0; } // (a size, a skin: every layer again)
    if (Li.length !== n) { Li.length = n; Lc.length = n; Lm.length = n; Lok.length = 0; }
    if (fresh) Lok.length = 0;                                     // (new curves: the input layers stale)
    if (!Lg || gP !== Pl || gW !== W || gD !== den || gB !== bb) { Lg = layer(Lg, dw, dh); const q = ctxOf(Lg, s); if (q) { q.clearRect(0, 0, SCR_W, SCR_H); paintGround(q, Pl, den, bb); } gP = Pl; gW = W; gD = den; gB = bb; }
    if (g.setTransform) g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    if (Lg) g.drawImage(Lg, 0, 0); else { g.fillStyle = Pl.bg; g.fillRect(0, 0, dw, dh); }
    // each input faint in its cord's colour (alpha by |amount|; muted dotted at the lowest), dashed where the picture cannot know
    for (let k = 0; k < n; k++) {
      if (!drawn[k]) continue;
      const r = I.find(x => x && x.row === rows[k]), muted = !r || !!r.byp, c = r && typeof r.color === 'string' ? r.color : '';
      if (fresh) { if (g.setTransform) g.setTransform(s, 0, 0, s, 0, 0); strokeIn(g, k, c, muted, alphaOf(k, muted)); if (g.setTransform) g.setTransform(1, 0, 0, 1, 0, 0); continue; }
      if (!Lok[k] || !Li[k] || Lc[k] !== c || Lm[k] !== muted) {   // (its layer: built once after a recompute, again on its colour / mute)
        Li[k] = layer(Li[k], dw, dh);
        const q = ctxOf(Li[k], s);
        if (!q) continue;
        q.clearRect(0, 0, SCR_W, SCR_H); q.globalAlpha = 1;
        strokeIn(q, k, c, muted, 1);
        Lc[k] = c; Lm[k] = muted; Lok[k] = true;
      }
      g.globalAlpha = alphaOf(k, muted);
      g.drawImage(Li[k], 0, 0);
    }
    g.globalAlpha = 1;
    if (g.setTransform) g.setTransform(s, 0, 0, s, 0, 0);
    // the sum: what the knob gets (Add clipped flat at 1), 2 px; dashed when it leans on a dashed input
    let sd = false;
    for (let k = 0; k < n; k++) if (dash[k] && amts[k] !== 0) sd = true;
    if (n) {
      g.strokeStyle = Pl.wave; g.lineWidth = 2;
      if (g.setLineDash) g.setLineDash(sd ? DASH2 : SOLID);
      path(g, sum, 1, 0);
      g.stroke();
      if (g.setLineDash) g.setLineDash(SOLID);
    }
    // the marks at the foot
    if (mk.length) {
      g.fillStyle = Pl.ink_35;
      for (let j = 0; j < mk.length; j++) { const b = mk[j] / PPQ; if (b >= w0 && b < w0 + W) g.fillRect(Math.round(xOf(b)) - 1, SCR_H - FOOT + 2, 2, FOOT - 4); }
    }
    // dimmed: outside the loop while it plays, before ▶ in this pass / the cursor while stopped (not played)
    g.fillStyle = Pl.bg_55;
    if (T.playing && T.lon) { dim(g, w0, T.ls); dim(g, T.le, w0 + W); }
    if (T.playing && T.pass === 0 && fin(T.b0)) dim(g, w0, T.b0);
    if (!T.playing) dim(g, w0, T.b0);
  }
  function dim(g, b0, b1) { const x0 = Math.max(0, xOf(b0)), x1 = Math.min(SCR_W, xOf(b1)); if (x1 > x0) g.fillRect(x0, 0, x1 - x0, SCR_H); }
  function path(g, arr, stride, off) {
    g.beginPath();
    let pen = false;
    for (let i = 0; i < N; i++) {
      const v = arr[off + i * stride];
      if (!fin(v)) { pen = false; continue; }
      const x = i / (N - 1) * SCR_W, y = yOf(v < 0 ? 0 : v > 1 ? 1 : v);
      if (pen) g.lineTo(x, y); else { g.moveTo(x, y); pen = true; }
    }
  }
  // the overlay: the playhead (solid playing, dashed at the cursor stopped) and the live dot (stopped: a level mark at the left edge) —
  // the boxes of the last paint cleared, nothing else
  let og = null;
  function paintOverlay(x, y, pl) {
    const cv = O.overlay;
    if (!cv) return;
    if (!og || lvl > 0) og = fitCanvas(cv, SCR_W, SCR_H);
    const g = og;
    if (!g) return;
    if (oBox) g.clearRect(oBox[0], 0, oBox[1] - oBox[0], SCR_H); else g.clearRect(0, 0, SCR_W, SCR_H);
    const Pl = pal || dispPalette(O.el || cv);
    let x0 = Infinity, x1 = -Infinity;
    if (fin(x) && x >= 0 && x <= SCR_W) {
      g.strokeStyle = Pl.cur; g.lineWidth = 1.5;
      if (g.setLineDash) g.setLineDash(pl ? SOLID : CURSOR);
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, SCR_H); g.stroke();
      if (g.setLineDash) g.setLineDash(SOLID);
      x0 = x - 2; x1 = x + 2;
    }
    if (fin(y)) {
      const yy = yOf(y < 0 ? 0 : y > 1 ? 1 : y);
      g.fillStyle = Pl.wave;
      if (pl && fin(x)) { g.beginPath(); g.arc(x, yy, 3.5, 0, 2 * Math.PI); g.fill(); g.strokeStyle = Pl.bg; g.lineWidth = 1; g.stroke(); x0 = Math.min(x0, x - 5); x1 = Math.max(x1, x + 5); }
      else { g.fillRect(0, yy - 1.5, 8, 3); x0 = Math.min(x0, 0); x1 = Math.max(x1, 9); }
    }
    oBox = x1 > x0 ? (oBox || [0, 0]) : null;
    if (oBox) { oBox[0] = Math.max(0, Math.floor(x0)); oBox[1] = Math.min(SCR_W, Math.ceil(x1)); }
  }
  /* ------------------------------------------------ the per-frame path */
  function frame() {
    if (dead) return false;
    const st = get(O.song) || NONE, Fh = +get(O.heardFrame), r = sr(), D = get(O.dev) || NONE;
    lvl = Math.max(lvl, bind());
    const pl = !!st.playing && fin(Fh), bpm = st.bpm > 0 ? +st.bpm : 120, fpb = 60 * r / bpm;
    const b = (pl ? +st.tick : +st.cursor) / PPQ, sig = st.sig, L = st.loop, M = D.mark;
    const bb = barBeatsOf(sig), W = (D.win > 0 ? +D.win : 1) * bb, w0 = Math.floor((fin(b) ? b : 0) / W + EPS) * W;
    // the keys (§6.6): the window, ▶ / ■, the tempo, the signature, the loop, the pass, the marks — a seek or a wrap moves the line
    K[0] = pl ? 1 : 0; K[1] = w0; K[2] = W; K[3] = bpm; K[4] = bb; K[5] = L && L.on ? 1 : 0; K[6] = L ? +L.start || 0 : 0; K[7] = L ? +L.end || 0 : 0;
    K[8] = fin(st.pass) ? st.pass : -1; K[9] = M ? 1 : 0; K[10] = M && fin(M.n) ? M.n : -2;
    let moved = M ? M.t !== mt : mt !== null;
    for (let j = 0; j < K.length; j++) if (K[j] !== K1[j]) moved = true;
    if (moved) { K1.set(K); mt = M ? M.t : null; lvl = Math.max(lvl, 2); }
    if (pl) {
      const ln = Fh - b * fpb;   // (frame-stamped: while the start is not heard yet the tick holds — no line then)
      if ((st.tick !== tick0 || Fh === Fh0) && !(Math.abs(ln - line0) <= 0.5)) { line0 = ln; lvl = Math.max(lvl, 2); }
      tick0 = st.tick; Fh0 = Fh;
    } else if (line0 !== -b) { line0 = -b; lvl = Math.max(lvl, 2); }
    // a random input's new draw; (playing) a time-locked input whose newest anchor left the line its curve stands on (a restart, a
    // re-assigned slot), compared modulo 1
    if (lvl < 2) for (let k = 0; k < n; k++) {
      const a = A[k], lk = locks[k];
      if (lk === 'rand') { if (fin(a.F) && a.v !== a.v1) { lvl = 2; frc = true; } continue; }
      if (!pl || lk === 'song' || !fin(a.F)) continue;
      if (!fin(a.F1)) { lvl = 2; frc = true; continue; }
      let d = a.x - (a.x1 + (a.F - a.F1) * a.r1);
      d -= Math.round(d);
      if (Math.abs(d) > 1e-6) { lvl = 2; frc = true; }
    }
    if (lvl >= 2) recompute();
    if (lvl >= 1) { combine(); paintCurves(lvl >= 2); }
    // the overlay
    const x = fin(b) ? (b - w0) / W * SCR_W : NaN, rs = R.at(Fh, ybuf, r);
    yLive = rs >= ST.EXACT && R.live(Fh, r) ? ybuf[0] : NaN;   // (the worklet's truth while its anchors are fresh)
    const live = pl || R.live(Fh, r);
    const xx = Math.round(x * 4) / 4, yy = fin(yLive) ? Math.round(yOf(yLive) * 4) / 4 : NaN;
    if (lvl > 0 || xx !== ox || !(yy === oy || (yy !== yy && oy !== oy)) || pl !== oPl) { paintOverlay(x, yLive, pl); ox = xx; oy = yy; oPl = pl; }
    lvl = 0;
    return live;
  }
  return {
    push(F, cb, i) {
      if (!fin(F) || !cb) return;
      lvl = Math.max(lvl, bind());                                // (the payload the block belongs to: its inputs' count and order)
      const o0 = i | 0;
      R.push(F, cb, o0, sr());                                    // (the ring flushes itself on an F below its newest)
      // (R2-1) posts arrive in order from one thread: an F below a stored anchor's is a NEW context (a power cycle: frames from 0) —
      // every anchor reset, this one taken, the curves recomputed on it (§6.6's restart)
      let nu = false;
      for (let k = 0; k < n; k++) if (F < A[k].F) nu = true;
      if (nu) { for (let k = 0; k < n; k++) { const a = A[k]; a.F = a.F1 = NaN; a.v = a.v1 = NaN; } lvl = 2; frc = true; M1.ok = false; }
      for (let k = 0; k < n; k++) {
        const j = o0 + 1 + 3 * k, a = A[k];
        if (j + 2 >= cb.length) break;
        a.F = F; a.x = cb[j]; a.r = cb[j + 1]; a.v = cb[j + 2];
      }
    },
    frame,
    dirty(level) { lvl = Math.max(lvl, level | 0); if (level >= 2) frc = true; },
    restyle() { const p = dispPalette(O.el || O.curves); if (p !== pal) { pal = p; lvl = Math.max(lvl, 1); } }, // (a skin switch: a repaint — its layers too —, no recompute)
    curveAt(bs, out) {
      lvl = Math.max(lvl, bind());
      const st = get(O.song) || NONE, Tq = timeline(st, +get(O.heardFrame), sr()), M = bs.length, V = new Float64Array(M * Math.max(1, n)), y = out || new Float64Array(M);
      amounts();
      for (let k = 0; k < n; k++) if (h) inputCurve(h.P, slotL[k], locks[k], Tq, A[k], bs, M, V, n, k); else for (let i = 0; i < M; i++) V[i * n + k] = NaN;
      const mc = MC();
      return mc && n ? sumCurve(mc, mode, n, amts, V, M, y) : y.fill(n ? NaN : 0);
    },
    live() { const Fh = +get(O.heardFrame); return !!(get(O.song) || NONE).playing || R.live(Fh, sr()); },
    value: () => yLive,
    state: () => ({ n, N, w0: win[0], W: win[1], drawn: drawn.slice(), dash: dash.slice(), locks: locks.slice(), mode, amts: Array.from(amts.subarray(0, n)), sum: Array.from(sum.subarray(0, N)),
      vals: Array.from(vals.subarray(0, N * n)), recomputes, memos, combines, marks: mk.slice(), playing: T.playing, preview: h ? h.key : null, ring: R.size }),
    destroy() { if (dead) return; dead = true; if (h) release(h); h = null; for (const c of [Lg, ...Li]) if (c) { c.width = 0; c.height = 0; } Lg = null; Li = []; }, // (the layers' memory back)
  };
}
