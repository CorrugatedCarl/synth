// tests/ui-bench-m9.mjs — stage 9's phase-0 spikes (b) and (c) (docs/canvas/IMPL-9.md §5; §4.1–§4.4 the faces, the face jacks,
// the cord layer and patching they stand in for), opened as tests/ui-bench.html?m9=1. A test page only: the app runs unchanged in
// an iframe (same origin, the test hooks on), every scene is built by script inside it and nothing the bench does is stored (the
// app's store writes are switched off for the run; the user's project, prefs and cameras stay as they were).
//   Stand-in faces (spike b): sections of our own panels/modular.js cut out as separate module faces — 921 (osc1), 995 (att),
//   903A (noise, standing in for the 923), 904A (lpf), 904B (hpf, for the 907A), 902 (vca), 911 (env1) and the CP3A console (for
//   our controller) — each a layout of one area over the section's mm (real art, real jack positions), rendered by cv-panel through
//   a ClassicPanel over a synthetic model (every knob / rotary / switch live, as stage 9's modules will be), so its face is a GL
//   texture (cv-face, the 1h path) under DOM widgets; the jacks drawn at full contrast (`inert: 'later'`) with a live face-jack span
//   each (span.cv-jack.cv-fjack, data-kind="cord", its hit circle clamp(28px, 44px·--ik, --jp)). Modules are cv-module's, with the
//   compact bar (title and ⋯), flush in Tidy's rows over the controller (§4.5). The scene's own track is today's Moog Modular in its
//   Simple layout, hidden (its sound plays a 2-bar chord loop: the worklet runs as in use).
//   Scenes (§5 b): hw5 (the 1h five, first and last), m13 (the Model 15 set + 20 cords asleep), m13w (the same; a scripted module
//   drag — 6 cords awake — then all 20 plucked, pinching 25–200 % during the sway), m20 (20 modules, 30 cords), m30 (30, 40), m30h
//   (m30 with the hidden face SVGs dropped once rastered), m13s (m13 with the cords on the SVG fallback).
//   The prototype cord layer (spike c; C9 hardens it as cv-cords.js): a second WebGL2 canvas after #world in #viewport,
//   pointer-events none, drawn from the world's write() — its 'camera' event, emitted inside write() right after the GL grid and
//   faces, the same task as the DOM transform —; the Studio physics exactly (LAB = docs/canvas/ref/cord-lab.html: 10 points,
//   1/120 s fixed steps, damping 0.90 + 0.095·0.62, gravity 6000, 5 slack-only passes, L → 1.10·D + 24 at 5/s, anchors swept across
//   a frame's steps, asleep after 31 quiet steps; seeded asleep from the parabola; ≤ 160 rope-steps a frame); 3 draw calls (the
//   shadow strips, the cords as one strip with rim / body / highlight bands anti-aliased by fwidth, ≥ 2.5 device px, the plugs as
//   instanced SDF quads); no geometry upload on a camera-only frame; its own rAF only while a cord is awake, held or in flight (a
//   frame where the camera also moves is drawn by the world's write: one draw). Free play: a plug dragged from an empty jack (a new
//   cord), a plugged one pulled (re-patch, or away: out, "tap to undo"); two fingers cancel a drag; the snapped target named in a
//   chip beside the finger. Only the plug ends take presses (the user, 2026-10-21: "just the ends"): a cord's body is not
//   interactive — a touch there goes to whatever is under it (the canvas pan, a knob, a jack); the page plucks cords by script only.
//   Runs: step 1 (?m9=1) automatic — per scene a self-check, M0's scripted phases (idle / pan / zoom / settle / deep / deepSettle +
//   firstMove / settle), the cords asleep under camera frames, all cords awake (plucked) still and in a deep pinch, the glue probe
//   mid-pan and mid-pinch (a plug's centre vs its jack's DOM centre: the jack span's rect and the GL pixels read in the same
//   frame), a rest counter (the cord layer's rAF requests at rest), m13w's wake script, and M5: a 60 s zoom sweep on m30 with the
//   cords plucked (context losses, GL bytes, a heartbeat for a lost tab); step 2 (&hand=1) the hand protocol per scene (IMPL-3
//   §1.5's M1, P / P+); step 3 (&cords=1) ten plugs at 60 % onto named jacks (the miss count, §4.2), a free play with the cords and
//   the user's word on the feel. One JSON for everything (Copy results) → tests/bench.json "ui-m9". &auto=1: the CDP harness (no
//   taps; window.__m9 holds the state, the steps and the results); &cordhold=1: the hold rule (no rope step in a burst frame after
//   one over 24 ms); &gltest=1: the cord canvas keeps its drawing buffer (readPixels any time).
//   Stage 9b (IMPL-9b §5 b2): ?m9=1&s55=1 is the System 55 set's own pair of pages — step 1 (automatic) and &hand=1 (step 2) — with
//   its own store ('m9b.res', kind "ui-m9b": the stage 9 session's results and steps are untouched; Copy results holds the new part
//   only). Scenes s55c (the tile loading: its 38 faces through the raster queue, cold — the time to every face a texture, the worst
//   frame, the raster work), s55 (37 modules and the controller: stage 9's real faces for the 21 modules of its types and the
//   controller, our stand-ins for the other 16 — 960 8 MU with 40 live controls, 12 event buttons, 10 lamps, 29 jack spans; seven
//   console-height faces —, 40 cords asleep, the sequencer lamps toggling as Sequence runs them: the 960's ten at 8 Hz, the 962's
//   three), s55w (a module drag — the 960's, eight cords — waking its cords, then all 40 swaying through a 25–200 % pinch with the
//   lamps still toggling), s55h (s55 with the hidden face pictures dropped); step 2 the hand protocol on hw5, s55, s55w, hw5 (s55h
//   joins when s55 or s55w is not P+). &lamps=solid: lit lamps without the blurred glow; &lamphold=1: lamp writes held while the
//   camera moves (the decision table's follow-ups for a passing s55 and a failing s55w, to re-measure).
//   Presets (IMPL-P §4, review 2 F6): &perf=high|medium|low, &texmax=N (and &nogl) in this page's URL reach the app frame's own
//   location.search (tests/ui-bench-frame.mjs: the frame is then a real page the app is written into, not a srcdoc), so the app
//   boots at that preset; the results' env.preset says what was asked and what the world runs (a switch that did not reach the
//   app is a validity note). With a preset asked (or &real=1; &real=0 keeps the prototype) step 1's rack scenes draw their cords
//   with the APP's own cord layer (A.W.cords(): cv-cords at the preset's physics) behind the prototype's calls (realCords), so
//   G5 reads cords().stats() — perf, quality, steps, stepMs, uploads, fulls — in every phase's numbers; the glue probe, the hand
//   protocol and the free play stay the prototype's. Nothing changes without a switch: the srcdoc frame, the prototype's cords.
// Node imports the pure part (STUDIO, seed, step, advance, shown, smooth, pluck, nearestOnPolyline, and the System 55's face55 /
// rack55 / SYS55): no DOM at module top level.

// the frame helper beside this file, with this page's own ?t= (a test page: the bench's loader gives each load a fresh URL, and the
// helper must be as fresh as the page)
const { frameOpts, frameQuery, mountFrame, presetInfo, presetNote } = await import('./ui-bench-frame.mjs' + (typeof location !== 'undefined' ? new URL(import.meta.url).search : ''));

/* ------------------------------------------------------------------------------------------------ the Studio physics (pure) */
/** The approved preset (LAB:132–143 `PRESETS.studio`, `damping()`, DT, EXTRA), world px. */
export const STUDIO = Object.freeze({
  N: 10, DT: 1 / 120, SLACK: 0.10, EXTRA: 24, DAMP: 0.90 + 0.095 * (62 / 100), G: 6000, PASSES: 5, EASE: 5,
  QUIET_N: 30, QUIET_PX: 0.02, WAKE_PX: 0.01, MAX_STEPS: 8, DT_MAX: 0.05, BUDGET: 160, SUB: 4,
});
/** A rope: its points (current and previous), length, the anchors of its last frame, sleep state, a grab. */
export function makeRope(n = STUDIO.N) {
  return { n, X: new Float64Array(n), Y: new Float64Array(n), PX: new Float64Array(n), PY: new Float64Array(n), L: 0,
    A0x: 0, A0y: 0, B0x: 0, B0y: 0, awake: false, quiet: 0, grab: null };
}
/** Seeds r from the parabola of length L = (1 + SLACK)·D + EXTRA between A and B (LAB:170–178) — asleep (IMPL-9 §4.3, review
 * #23: a project opens still; LAB seeds awake). */
export function seed(r, ax, ay, bx, by, awake = false) {
  const n = r.n, D = Math.hypot(bx - ax, by - ay);
  r.L = (1 + STUDIO.SLACK) * D + STUDIO.EXTRA;
  const sag = Math.sqrt(Math.max(0, 3 * Math.max(D, 1) * (r.L - D) / 8));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), x = ax + (bx - ax) * t, y = ay + (by - ay) * t + sag * 4 * t * (1 - t);
    r.X[i] = x; r.Y[i] = y; r.PX[i] = x; r.PY[i] = y;
  }
  r.A0x = ax; r.A0y = ay; r.B0x = bx; r.B0y = by; r.awake = awake; r.quiet = 0;
  return r;
}
/** One fixed step of LAB's Cord.step (LAB:180–203) with the ends at A, B (and a grabbed point at its finger). */
export function step(r, ax, ay, bx, by, dt) {
  const n = r.n, X = r.X, Y = r.Y, PX = r.PX, PY = r.PY, D = Math.hypot(bx - ax, by - ay), S = STUDIO;
  r.L += ((1 + S.SLACK) * D + S.EXTRA - r.L) * Math.min(1, dt * S.EASE); // (the cord's length follows the gap, slowly)
  const seg = r.L / (n - 1), k = S.DAMP, g = S.G * dt * dt, G = r.grab;
  for (let i = 1; i < n - 1; i++) {
    const vx = (X[i] - PX[i]) * k, vy = (Y[i] - PY[i]) * k;
    PX[i] = X[i]; PY[i] = Y[i]; X[i] += vx; Y[i] += vy + g;
  }
  const pin = () => { X[0] = ax; Y[0] = ay; X[n - 1] = bx; Y[n - 1] = by; if (G) { X[G.i] = G.x; Y[G.i] = G.y; } };
  pin();
  for (let it = 0; it < S.PASSES; it++) {
    for (let i = 0; i < n - 1; i++) {
      const dx = X[i + 1] - X[i], dy = Y[i + 1] - Y[i], d = Math.hypot(dx, dy) || 1e-6;
      if (d <= seg) continue; // (a cord goes slack, never pushes)
      const f = (d - seg) / d, wu = i === 0 ? 0 : 0.5, wv = i + 1 === n - 1 ? 0 : 0.5, s = wu + wv;
      if (!s) continue;
      X[i] += dx * f * wu / s; Y[i] += dy * f * wu / s; X[i + 1] -= dx * f * wv / s; Y[i + 1] -= dy * f * wv / s;
    }
    pin();
  }
  let moved = 0;
  for (let i = 1; i < n - 1; i++) moved = Math.max(moved, Math.abs(X[i] - PX[i]) + Math.abs(Y[i] - PY[i]));
  if (moved < S.QUIET_PX && !G) { if (++r.quiet > S.QUIET_N) r.awake = false; } else r.quiet = 0;
}
/** One frame of LAB's loop (LAB:289–301): 120 Hz fixed steps from the frame's dt (≤ 50 ms; the remainder dropped past one
 * step), each awake rope stepped with its anchors swept from last frame's to now's; a rope wakes on an anchor moving > 0.01 px
 * (Σ|Δ| of both ends) or a grab. ends(rope, out4) fills [ax, ay, bx, by]. The frame's rope-steps are capped at `budget`:
 * beyond it every awake rope takes fewer steps (the ropes slow, the frame does not; IMPL-9 review #17). sim = { acc, last }.
 * @returns {{steps: number, per: number, awake: number, ropeSteps: number}} */
export function advance(sim, ropes, t, ends, budget = STUDIO.BUDGET, hold = false) {
  const S = STUDIO, dt = Math.min(S.DT_MAX, Math.max(0, (t - sim.last) / 1000));
  sim.last = t; sim.acc += dt;
  let steps = Math.min(S.MAX_STEPS, Math.floor(sim.acc / S.DT));
  sim.acc -= steps * S.DT; if (sim.acc > S.DT) sim.acc = 0;
  if (hold) steps = 0;
  const E = sim.E || (sim.E = new Float64Array(4));
  let awake = 0;
  for (const r of ropes) {
    ends(r, E); r.A1x = E[0]; r.A1y = E[1]; r.B1x = E[2]; r.B1y = E[3];
    if (Math.abs(r.A1x - r.A0x) + Math.abs(r.A1y - r.A0y) + Math.abs(r.B1x - r.B0x) + Math.abs(r.B1y - r.B0y) > S.WAKE_PX || r.grab) r.awake = true;
    if (r.awake) awake++;
  }
  const per = steps && awake * steps > budget ? Math.max(1, Math.floor(budget / awake)) : steps;
  let n = 0;
  for (const r of ropes) {
    if (r.awake) for (let s = 0; s < per; s++) {
      const f = (s + 1) / per;
      step(r, r.A0x + (r.A1x - r.A0x) * f, r.A0y + (r.A1y - r.A0y) * f, r.B0x + (r.B1x - r.B0x) * f, r.B0y + (r.B1y - r.B0y) * f, S.DT);
      n++;
    }
    r.A0x = r.A1x; r.A0y = r.A1y; r.B0x = r.B1x; r.B0y = r.B1y;
  }
  return { steps, per, awake, ropeSteps: n };
}
/** Motion off: the settled parabola from the ends (LAB:278–284), into X / Y. */
export function shown(n, ax, ay, bx, by, X, Y) {
  const D = Math.hypot(bx - ax, by - ay), L = (1 + STUDIO.SLACK) * D + STUDIO.EXTRA, sag = Math.sqrt(Math.max(0, 3 * Math.max(D, 1) * (L - D) / 8));
  for (let i = 0; i < n; i++) { const t = i / (n - 1); X[i] = ax + (bx - ax) * t; Y[i] = ay + (by - ay) * t + sag * 4 * t * (1 - t); }
}
/** LAB's drawn path (LAB:247–251: quadratics through the midpoints, a line to the end) as a polyline of `sub` points per
 * quadratic, into out (x, y pairs) → the point count (2 + (n − 2)·sub). */
export function smooth(X, Y, n, sub, out) {
  let k = 0, sx = X[0], sy = Y[0];
  out[k++] = sx; out[k++] = sy;
  for (let i = 1; i < n - 1; i++) {
    const cx = X[i], cy = Y[i], ex = (X[i] + X[i + 1]) / 2, ey = (Y[i] + Y[i + 1]) / 2;
    for (let s = 1; s <= sub; s++) { const t = s / sub, u = 1 - t; out[k++] = u * u * sx + 2 * u * t * cx + t * t * ex; out[k++] = u * u * sy + 2 * u * t * cy + t * t * ey; }
    sx = ex; sy = ey;
  }
  out[k++] = X[n - 1]; out[k++] = Y[n - 1];
  return k / 2;
}
/** A pluck (IMPL-9 §4.4): an impulse of `amp` px / step at point i0 with a sine falloff to both ends (the lab's "Pluck" without
 * its randomness, LAB:368–372: the previous position pushed down, so the point leaps up), the rope woken. */
export function pluck(r, i0, amp = 9) {
  const n = r.n, t0 = Math.min(0.95, Math.max(0.05, i0 / (n - 1)));
  for (let i = 1; i < n - 1; i++) { const t = i / (n - 1), u = t <= t0 ? t / (2 * t0) : 1 - (1 - t) / (2 * (1 - t0)); r.PY[i] += amp * Math.sin(Math.PI * u); }
  r.awake = true; r.quiet = 0;
}
/** The lab's "Pluck all" (LAB:368–372) with a seeded random (rnd() in [0, 1)). */
export function pluckLab(r, rnd) {
  const n = r.n;
  for (let i = 1; i < n - 1; i++) { const t = i / (n - 1), a = Math.sin(Math.PI * t) * (6 + rnd() * 6); r.PY[i] += a; r.PX[i] += (rnd() - 0.5) * a; }
  r.awake = true; r.quiet = 0;
}
/** The nearest point of a polyline P (x, y pairs, m points) to (x, y): { d, seg, t (along the whole, 0…1) }. */
export function nearestOnPolyline(P, m, x, y) {
  let best = Infinity, bs = 0, bu = 0, len = 0, at = 0;
  const L = [];
  for (let i = 0; i < m - 1; i++) {
    const ax = P[2 * i], ay = P[2 * i + 1], dx = P[2 * i + 2] - ax, dy = P[2 * i + 3] - ay, l2 = dx * dx + dy * dy, l = Math.sqrt(l2);
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0, d = Math.hypot(ax + dx * u - x, ay + dy * u - y);
    L.push(len); len += l;
    if (d < best) { best = d; bs = i; bu = u; }
  }
  if (m > 1) { const l = Math.hypot(P[2 * bs + 2] - P[2 * bs], P[2 * bs + 3] - P[2 * bs + 1]); at = len > 0 ? (L[bs] + bu * l) / len : 0; }
  return { d: best, seg: bs, t: at };
}
export const PALETTE = Object.freeze(['#d8432f', '#e6b83a', '#3f80d8', '#41a75c', '#e9e5da', '#e27c2f', '#9060c9', '#2f3033']);
/** A seeded random in [0, 1) (LCG). */
export function rng(seed0) { let s = seed0 >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/* ------------------------------------------------------------------------------------------------ System 55 (stage 9b: IMPL-9b §5 b2; pure) */
// The System 55 set's stand-in faces for the types stage 9 does not draw (904B, 914, 911A, 903A, 960, 962, 992, 993, 994, CP2,
// CP3A, CP8A, 961, the Song clock): layouts of our own in the house treatment of panels/m900.js (black panel inset in a silver
// frame, cream legends, the number at the foot; no photograph, no maker word), at the 9b sizes (IMPL-9b §2.1: 1 MU 128 · 2 MU 224
// · 3 MU 352 · 4 MU 448 · 8 MU 864 px wide, 512 px tall; a console panel 352) with the control and jack counts of §2.2 / §2.3 —
// every knob, rotary and switch live (a synthetic model, as stage 9's faces), every jack a patch jack (cv-panel's `port` form,
// validated), the 960's and 962's event buttons and the lamps of the 960, 962 and the Song clock drawn in the art with a live
// DOM span each (the page adds them; cv-panel here has no button / lamp control yet). Pure: node validates every layout.
export const MU = 53.975, FACE_H = 222.25, CONS_H = 142.875;
const FRAME = '#a3a39e', PANEL = '#121212', BAT = '#d2d2ce', FIN = { ptrStyle: 'fin', capR: 0.5 };
const D10S = ['0', '', '', '', '', '5', '', '', '', '', '10'], RNG = ['0.1', '0.4', '1.6', '6.4', '26', '100', '410'];
const m2 = x => Math.round(x * 100) / 100;
/** The System 55's set (IMPL-9b §2.5): [type, count, row]; row 1 sources and sequencing, 2 modifiers and envelopes (Tidy's two
 * cabinet rows, §4.4), 3 the console panels (the row above the controller). 21 modules of stage 9's types carry stage 9's real
 * faces (REAL55); the other 16 the stand-ins below; the controller is the real console. */
export const SYS55 = Object.freeze([['921', 1, 1], ['921a', 2, 1], ['921b', 6, 1], ['903a', 1, 1], ['995', 1, 1], ['994', 1, 1], ['960', 1, 1], ['962', 1, 1],
  ['904a', 1, 2], ['904b', 1, 2], ['914', 1, 2], ['911', 5, 2], ['911a', 1, 2], ['902', 5, 2], ['992', 1, 2], ['993', 1, 2],
  ['cp2', 1, 3], ['cp3a', 3, 3], ['961', 1, 3], ['clk', 1, 3], ['cp8a', 1, 3]]);
export const REAL55 = Object.freeze(['921', '921a', '921b', '995', '904a', '911', '902']);
export const NAME55 = Object.freeze({ '921': '921', '921a': '921A', '921b': '921B', '995': '995', '904a': '904A', '911': '911', '902': '902', '903a': '903A', '994': '994',
  '960': '960', '962': '962', '904b': '904B', '914': '914', '911a': '911A', '992': '992', '993': '993', cp2: 'CP2', cp3a: 'CP3A', 961: '961', clk: 'Song clock', cp8a: 'CP8A', ctl: 'Controller' });
/** Tidy's placement of the System 55 as §4.4 sets it (a console row flush above the controller at dy −352, the modifiers row
 * above it, the sources row on top; every row flush left to right from x 0): the list's items { row (0 the controller, 1, 2, 3) }
 * and size(item) → [w, h] give each position, in list order. */
export function rack55(list, size) {
  const pos = [], X = [0, 0, 0, 0], Y = [0, -1376, -864, -352];
  for (const it of list) {
    if (it.row === 0) { pos.push({ x: 0, y: 0 }); continue; }
    pos.push({ x: X[it.row], y: Y[it.row] });
    X[it.row] += size(it)[0];
  }
  return pos;
}
// the stand-ins' data: knobs, switches, rotaries, jacks, event buttons and lamps by mm position on the panel's own frame; each
// draw(f) calls the builder; mu the panel width in MU, cons: console height; title: [legend lines]; num: the number at the foot
const FACES55 = {
  '904b': { name: '904B High Pass Filter', mu: 1, title: ['HIGH PASS', 'FILTER'], num: '904B', draw(f) {
    f.knob('fc', 'FIXED CONTROL VOLTAGE', 27, 52, 22, -6, 6, 0); f.sw('rg', 'FREQUENCY RANGE', 27, 92, ['LOW', 'HIGH']);
    f.jack('c1', 'CONTROL INPUT 1', 10, 130, 'in'); f.jack('c2', 'CONTROL INPUT 2', 27, 130, 'in'); f.jack('c3', 'CONTROL INPUT 3', 44, 130, 'in');
    f.jack('in', 'SIGNAL INPUT', 27, 162, 'in'); f.jack('out', 'SIGNAL OUTPUT', 27, 194, 'out'); } },
  '911a': { name: '911A Dual Trigger Delay', mu: 1, title: ['DUAL TRIGGER', 'DELAY'], num: '911A', draw(f) {
    f.knob('d1', 'DELAY 1', 27, 46, 20, 0, 10, 3); f.knob('d2', 'DELAY 2', 27, 84, 20, 0, 10, 3); f.sw('md', 'MODE', 27, 122, ['OFF', 'PARALLEL', 'SERIES']);
    f.jack('i1', 'INPUT 1', 13, 158, 'in', 's'); f.jack('o1', 'OUTPUT 1', 41, 158, 'out', 's'); f.jack('i2', 'INPUT 2', 13, 188, 'in', 's'); f.jack('o2', 'OUTPUT 2', 41, 188, 'out', 's'); } },
  '903a': { name: '903A Random Signal Generator', mu: 1, title: ['RANDOM', 'SIGNAL'], num: '903A', draw(f) {
    f.jack('wh1', 'WHITE', 13, 66, 'out'); f.jack('wh2', 'WHITE', 41, 66, 'out'); f.jack('pk1', 'PINK', 13, 132, 'out'); f.jack('pk2', 'PINK', 41, 132, 'out'); } },
  '962': { name: '962 Sequential Switch', mu: 1, title: ['SEQUENTIAL', 'SWITCH'], num: '962', draw(f) {
    for (let k = 1; k <= 3; k++) {
      const y = 38 + 38 * (k - 1);
      f.jack('i' + k, 'INPUT ' + k, 13, y, 'in'); f.jack('t' + k, 'TRIG IN ' + k, 41, y, 'in'); f.jack('o' + k, 'TRIG OUT ' + k, 41, y + 19, 'out');
      f.lamp('l' + k, 13, y + 14); f.btn('e' + k, 'SET ' + k, 13, y + 27);
    }
    f.jack('q1', 'OUTPUT', 13, 162, 'out'); f.jack('q2', 'OUTPUT', 41, 162, 'out'); f.jack('sh', 'SHIFT', 27, 190, 'in'); } },
  '992': { name: '992 Control Voltages', mu: 1, title: ['CONTROL', 'VOLTAGES'], num: '992', draw(f) {
    [['s1', 'KEYBOARD'], ['s2', 'WHEEL'], ['s3', 'PRESSURE'], ['s4', 'EXT']].forEach(([id, l], i) => f.sw(id, l, 27, 36 + 25 * i, ['OFF', 'ON']));
    f.knob('at', 'EXT ATTENUATOR', 27, 146, 20, -10, 10, 0); f.jack('x4', 'EXT IN', 27, 186, 'in'); } },
  '993': { name: '993 Trigger and Envelope Voltages', mu: 1, title: ['TRIGGER AND', 'ENVELOPE'], num: '993', draw(f) {
    [['f1', 'FROM 1'], ['f2', 'FROM 2'], ['t1', 'TRIG 1'], ['t2', 'TRIG 2'], ['t3', 'TRIG 3'], ['e1', 'ENV 1'], ['e2', 'ENV 2'], ['e3', 'ENV 3']]
      .forEach(([id, l], i) => f.sw(id, l, i % 2 ? 41 : 13, 46 + 30 * (i >> 1), ['OFF', 'ON'], 0, true)); } },
  '994': { name: '994 Dual Multiples', mu: 1, title: ['DUAL', 'MULTIPLES'], num: '994', draw(f) {
    for (let i = 1; i <= 4; i++) { f.jack('a' + i, 'A ' + i, 13, 40 + 34 * (i - 1), 'any'); f.jack('b' + i, 'B ' + i, 41, 40 + 34 * (i - 1), 'any'); } } },
  '914': { name: '914 Fixed Filter Bank', mu: 4, title: ['FIXED FILTER BANK'], num: '914', draw(f) {
    const B = ['125', '175', '250', '350', '500', '700', '1k', '1.4k', '2k', '2.8k', '4k', '5.6k'];
    const ks = [['lo', 'LOW'], ...B.map((b, i) => ['b' + (i + 1), b]), ['hi', 'HIGH']];
    ks.forEach(([id, l], i) => f.knob(id, l, 22 + 28 * (i % 7), i < 7 ? 56 : 108, 18, 0, 10, 10));
    f.jack('i1', 'SIGNAL INPUT 1', 40, 172, 'in'); f.jack('i2', 'SIGNAL INPUT 2', 68, 172, 'in'); f.jack('o1', 'SIGNAL OUTPUT 1', 148, 172, 'out'); f.jack('o2', 'SIGNAL OUTPUT 2', 176, 172, 'out'); } },
  '960': { name: '960 Sequential Controller', mu: 8, title: ['SEQUENTIAL CONTROLLER'], num: '960', draw(f) {
    // the clock column (x 0…52), nine stage columns of 37.8 mm (52 + 37.8 (k − 1) …), the row column (392…432)
    f.lamp('lo', 26, 19); f.btn('on', 'OSC ON', 14, 35); f.btn('off', 'OSC OFF', 38, 35);
    f.sw('os', 'CLOCK AT START', 26, 60, ['STOPPED', 'RUNNING'], 1); f.rot('rg', 'RANGE', 26, 90, RNG, 2, 24); f.knob('vn', 'VERNIER', 26, 118, 18, 0, 10, 2);
    f.sw('cc', 'ROW C → CLOCK', 26, 142, ['OFF', 'ON']); f.btn('sh', 'SHIFT', 26, 157);
    f.jack('on', 'OSC ON', 10, 172, 'in'); f.jack('off', 'OSC OFF', 26, 172, 'in'); f.jack('sh', 'SHIFT', 42, 172, 'in');
    f.jack('ci', 'CONTROL INPUT', 18, 196, 'in'); f.jack('co', 'OUTPUT', 36, 196, 'out');
    for (let k = 1; k <= 9; k++) {
      const x = 70.9 + 37.8 * (k - 1);
      f.lamp('l' + k, x, 17); f.btn('e' + k, 'SET', x, 33);
      if (k < 9) { f.knob('a' + k, 'A', x, 56, 18, 0, 10, (k * 3) % 11); f.knob('b' + k, 'B', x, 82, 18, 0, 10, (k * 5) % 11); f.knob('c' + k, 'C', x, 108, 18, 0, 10, (k * 7) % 11); }
      if (k < 9) f.sw('s' + k, 'S' + k, x, 134, ['STOP', 'NORMAL', 'SKIP'], 1); else f.sw('s9', 'S9', x, 134, ['STOP', 'SKIP'], 1);
      f.jack('i' + k, 'IN ' + k, x, 172, 'in'); f.jack('o' + k, 'OUT ' + k, x, 196, 'out');
    }
    ['a', 'b', 'c'].forEach((r, i) => { const y = 56 + 26 * i; f.jack('r' + r + '1', 'ROW ' + r.toUpperCase(), 402, y, 'out'); f.jack('r' + r + '2', 'ROW ' + r.toUpperCase(), 422, y, 'out'); });
    ['ga', 'gb', 'gc'].forEach((id, i) => f.sw(id, 'ROW ' + 'ABC'[i], 412, 136 + 22 * i, ['X1', 'X2', 'X4'])); } },
  cp2: { name: 'CP2 Filters, Multiples and Keyboard Outputs', mu: 3, cons: true, title: ['FILTERS · MULTIPLES · OUTPUTS'], num: 'CP2', draw(f) {
    f.knob('lp', 'LOW PASS', 24, 44, 18, 0, 10, 5); f.knob('hp', 'HIGH PASS', 72, 44, 18, 0, 10, 5);
    f.jack('li', 'IN', 14, 86, 'in'); f.jack('lo', 'OUT', 36, 86, 'out'); f.jack('hi', 'IN', 62, 86, 'in'); f.jack('ho', 'OUT', 84, 86, 'out');
    for (let i = 1; i <= 4; i++) f.jack('u' + i, 'MULT ' + i, i % 2 ? 122 : 146, i < 3 ? 40 : 66, 'any');
    f.jack('po', 'PITCH OUT', 122, 100, 'out'); f.jack('so', 'S-TRIG OUT', 146, 100, 'out', 's'); } },
  cp3a: { name: 'CP3A Mixer and Routing', mu: 4, cons: true, title: ['MIXER AND ROUTING'], num: 'CP3A', draw(f) {
    for (let i = 1; i <= 4; i++) { const x = 20 + 26 * (i - 1); f.jack('m' + i, 'IN ' + i, x, 36, 'in'); f.knob('x' + i, 'LEVEL ' + i, x, 66, 18, 0, 10, 7); f.jack('a' + i, 'MULT ' + i, x, 118, 'any'); }
    f.knob('ms', 'MASTER', 134, 66, 18, 0, 10, 5); f.jack('mo', 'MIX +', 122, 106, 'out'); f.jack('mn', 'MIX −', 148, 106, 'out');
    [['r1', 'KBD'], ['r2', 'WHEEL'], ['r3', 'PRESS'], ['r4', 'EXT']].forEach(([id, l], i) => f.sw(id, l, i % 2 ? 196 : 172, i < 2 ? 36 : 62, ['OFF', 'ON']));
    f.knob('ra', 'EXT LEVEL', 172, 98, 18, 0, 10, 10); f.jack('x4', 'EXT IN', 196, 98, 'in'); } },
  cp8a: { name: 'CP8A Power', mu: 2, cons: true, title: ['POWER'], num: 'CP8A', draw(f) { f.plain(); } },
  961: { name: '961 Interface', mu: 3, cons: true, title: ['INTERFACE'], num: '961', draw(f) {
    for (let b = 0; b < 2; b++) {
      const x = 12 + 54 * b;
      for (let i = 1; i <= 6; i++) { const y = 30 + 15.5 * (i - 1); f.jack('a' + (b + 1) + i, 'A' + i, x, y, 'in'); f.jack('b' + (b + 1) + i, 'B' + i, x + 17, y, 'in'); }
      f.jack('s' + (b + 1), 'S-TRIG OUT', x + 8, 126, 'out', 's');
    }
    f.knob('t1', 'ON TIME 1', 110, 32, 18, 0, 10, 5); f.knob('se', 'SENSITIVITY', 130, 32, 18, 0, 10, 5); f.knob('t2', 'ON TIME 2', 150, 32, 18, 0, 10, 5);
    f.jack('v1i', 'S IN', 110, 68, 'in', 's'); f.jack('v1o', 'V OUT', 136, 68, 'out'); f.jack('v2i', 'S IN', 110, 92, 'in', 's'); f.jack('v2o', 'V OUT', 136, 92, 'out');
    f.jack('ai', 'AUDIO IN', 110, 118, 'in'); f.jack('ao1', 'V OUT', 136, 110, 'out'); f.jack('ao2', 'V OUT', 152, 124, 'out'); } },
  clk: { name: 'Song Clock', mu: 2, cons: true, title: ['SONG CLOCK'], num: 'CLOCK', note: ['OURS — THE SONG’S TEMPO', 'AS PULSES'], draw(f) {
    f.rot('dv', 'STEP', 28, 56, ['1/4', '1/8', '1/16', '1/32', '1/8T', '1/16T'], 2, 24); f.sw('md', 'MODE', 80, 56, ['SONG', 'ALWAYS']); f.lamp('lr', 54, 30, 'RUN');
    f.jack('ck', 'CLOCK', 20, 104, 'out'); f.jack('rn', 'RUN', 54, 104, 'out'); f.jack('rs', 'RESTART', 88, 104, 'out'); } },
};
/** The type ids of the stand-ins. */
export const NEW55 = Object.freeze(Object.keys(FACES55));
/** The stand-in face of a System 55 type: { L, model, mcs, ev: [{ id, label, x, y }], lamps: [{ id, x, y }], problems } — layout and
 * synthetic model for cv-panel (PN: cv-panel's exports; theme and scheme: stage 9's, from a real module's model and face);
 * problems = PN.validate (node checks every one is empty). */
export function face55(type, PN, theme, scheme) {
  const S = FACES55[type]; if (!S) return null;
  const W = S.mu * MU, H = S.cons ? CONS_H : FACE_H, ctl = [], dec = [], prm = [], jks = [], evs = [], lamps = [];
  const txt = (x, y, s, size = 1.85, weight = 600, ls = 0.12, anchor = 'middle') => dec.push({ t: 'text', x: m2(x), y: m2(y), s, size, weight, anchor, ls });
  const line = (y, w = 0.35) => dec.push({ t: 'line', x1: 2.6, y1: y, x2: m2(W - 2.6), y2: y, sw: w });
  const F = {
    knob(id, label, x, y, d = 20, lo = 0, hi = 10, def = 5) {
      prm.push({ t: 'k', id, label, min: lo, max: hi, def });
      ctl.push({ id, kind: 'knob', x, y, d, sweep: 300, label, lab: 'none' });
      dec.push({ t: 'scale', x, y, d: d + 1, sweep: 300, n: 11, labels: D10S, size: 1.6 });
      txt(x, y - d / 2 - 4, label.length > 16 ? label.slice(0, 16) : label, 1.75);
    },
    sw(id, label, x, y, opts, def = 0, plain) { // 2 positions: a horizontal bat; 3: a vertical one
      const n = opts.length, v = n > 2;
      prm.push(n === 2 ? { t: 'b', id, label, def } : { t: 's', id, label, opts, def });
      ctl.push({ id, kind: 'switch', style: 'bat', orient: v ? 'v' : 'h', x, y, w: v ? 6 : 10, h: v ? 14 : 6, color: BAT, label, lab: 'none' });
      txt(x, y - 10, label, 1.7);
      if (!plain) opts.forEach((o, i) => v ? txt(x + 6, y + 6.4 - 6.4 * i, o, 1.45, 600, 0.1, 'start') : txt(x + (i ? 9 : -9), y + 0.7, o, 1.45));
    },
    rot(id, label, x, y, opts, def = 0, d = 22) {
      prm.push({ t: 's', id, label, opts, def });
      ctl.push({ id, kind: 'rotary', x, y, d, sweep: 180, label, lab: 'none', legends: opts, skin: FIN });
      txt(x, y - d / 2 - 6, label, 1.85);
    },
    jack(port, label, x, y, dir, sig = 'v') {
      jks.push({ id: port, dir, sig, role: 'au', label, sec: 0 });
      ctl.push(sig === 's' ? { kind: 'strig', port, x, y, w: 10, h: 8, label, lab: 'none' } : { kind: 'jack', port, x, y, d: 14, label, lab: 'none' });
      txt(x, y - 8.6, label.length > 12 ? label.slice(0, 12) : label, 1.55);
    },
    btn(id, label, x, y) { evs.push({ id, label, x, y }); dec.push({ t: 'rect', x: m2(x - 5), y: m2(y - 3.5), w: 10, h: 7, r: 0.8, fill: BAT }); txt(x, y - 5.2, label, 1.5); },
    lamp(id, x, y, label) { lamps.push({ id, x, y }); dec.push({ t: 'rect', x: m2(x - 3), y: m2(y - 3), w: 6, h: 6, r: 3, fill: '#2a2a2a', stroke: '#777', sw: 0.3 }); if (label) txt(x, y - 5, label, 1.5); },
    plain() { // CP8A: drawn only — a power switch, a pilot lamp, two fuse holders (no live control: "not emulated")
      dec.push({ t: 'rect', x: 20, y: 40, w: 20, h: 10, r: 5, fill: '#0c0c0c', stroke: '#555', sw: 0.3 }, { t: 'rect', x: 24, y: 41.5, w: 7, h: 7, r: 3.5, fill: '#cfcfcf' });
      txt(30, 36, 'POWER', 1.9); dec.push({ t: 'rect', x: 66, y: 41, w: 8, h: 8, r: 4, fill: '#2a2a2a', stroke: '#777', sw: 0.3 }, { t: 'rect', x: 67.6, y: 42.6, w: 4.8, h: 4.8, r: 2.4, fill: '#e9a13a' });
      txt(70, 36, 'PILOT', 1.9);
      for (const x of [28, 78]) { dec.push({ t: 'rect', x: x - 7, y: 84, w: 14, h: 9, r: 4.5, fill: '#1a1a1a', stroke: '#888', sw: 0.3 }); txt(x, 80, 'FUSE', 1.7); }
    },
  };
  S.draw(F);
  const T = S.title.length;
  dec.unshift({ t: 'rect', x: 1, y: 0.4, w: m2(W - 2), h: m2(H - 0.8), fill: PANEL }, { t: 'screws', pts: [[9, 4.6], [9, m2(H - 4.6)], [m2(W - 9), 4.6], [m2(W - 9), m2(H - 4.6)]], d: 3.4 });
  S.title.forEach((s, i) => txt(W / 2, (T > 1 ? 9.4 : 12) + 3.6 * i, s, T > 1 || s.length > 22 ? 2.1 : 2.45, 700, 0.2)); line(T > 1 ? 18.2 : 16.4, 0.35);
  txt(W / 2, m2(H - 6.2), S.num, 4, 700, 0.3);
  if (S.note) S.note.forEach((s, i) => txt(W / 2, H - 14 - 2.8 * (S.note.length - 1 - i), s, 1.6));
  const model = { id: 'pm-' + type, name: S.name, type, layout: type, patch: 'moog', theme, sections: [{ title: S.name, c: prm }], controls: prm, jacks: jks };
  const L = { v: 1, id: 'pm-' + type, hw: 'a stand-in for the ' + S.name + ' (ours; stage 9b test page, IMPL-9b §5 b2)', case: PANEL, scheme,
    areas: [{ id: 'main', src: [0, 0, m2(W), m2(H)], at: [0, 0], fill: FRAME }], sections: [{ id: 'p', label: S.name.toUpperCase(), x: 0, y: 0, w: m2(W), h: m2(H), frame: 'none', title: 'none' }],
    controls: ctl, decor: dec, extras: { ids: [] } };
  return { L, model, mcs: prm, ev: evs, lamps, problems: PN.validate(L, model) };
}

/* ------------------------------------------------------------------------------------------------ the page: constants */
const IS_PAGE = typeof window !== 'undefined' && typeof document !== 'undefined' && typeof location !== 'undefined';
const BASE = IS_PAGE ? new URL('../', location.href).href : '';
const Q = new URLSearchParams(IS_PAGE ? location.search : '');
const S55 = Q.get('s55') === '1'; // (stage 9b, IMPL-9b §5 b2: &s55=1 is the System 55 set's own pair of pages and its own store — nothing of the stage 9 session's)
const MODE = Q.get('hand') === '1' ? 'hand' : Q.get('cords') === '1' && !S55 ? 'cords' : 'auto';
const FOPT = frameOpts(IS_PAGE ? location.search : ''), FQ = frameQuery(IS_PAGE ? location.search : ''), KEEP_F = FQ ? '&' + FQ.slice(1) : ''; // (P: the app frame's switches — perf, texmax, nogl — and the link that keeps them)
const REAL = MODE === 'auto' && (Q.get('real') === '1' || (!!FOPT.perf && Q.get('real') !== '0')); // (P: step 1's rack scenes on the app's own cord layer)
const AUTO = Q.get('auto') === '1', ONLY = Q.get('scenes') ? Q.get('scenes').split(',') : null, HOLD = Q.get('cordhold') === '1', GLTEST = Q.get('gltest') === '1';
const LAMP_SOLID = Q.get('lamps') === 'solid', LAMP_HOLD = Q.get('lamphold') === '1', KEEP55 = (LAMP_SOLID ? '&lamps=solid' : '') + (LAMP_HOLD ? '&lamphold=1' : ''); // (the decision table's follow-ups for s55w: lit lamps without the blurred glow; lamp deliveries held while the camera moves)
const MiB = 1024 * 1024, BAR_H = 40, READ_K = 0.5, TAP_TOUCH = 8, TAP_MOUSE = 4, SNAP_PX = 32, HIT_PX = 10;
const RES_KEY = S55 ? 'm9b.res' : 'm9.res', HB_KEY = S55 ? 'm9b.hb' : 'm9.hb', KIND = S55 ? 'ui-m9b' : 'ui-m9';
// the stand-in art: a panels/modular.js section per type (§5 b: 921, 995, 903A, 904A, 902, 911, CP3A; 904B stands in for the
// 907A); the Model 15 set (§2.2) as [module, its art, its row (0 the controller, 1 sources, 2 modifiers)]
const ART = { osc1: '921', att: '995', noise: '903A', lpf: '904A', hpf: '904B', vca: '902', env1: '911', cp3a: 'CP3A' };
const M15 = [['CTL', 'cp3a', 0], ['921', 'osc1', 1], ['921A', 'att', 1], ['921B', 'vca', 1], ['921B', 'vca', 1], ['923', 'noise', 1], ['995', 'att', 1],
  ['904A', 'lpf', 2], ['907A', 'hpf', 2], ['911', 'env1', 2], ['911', 'env1', 2], ['902', 'vca', 2], ['902', 'vca', 2]];
const MORE = [['921', 'osc1', 1], ['921', 'osc1', 1], ['904A', 'lpf', 2], ['911', 'env1', 2], ['911', 'env1', 2], ['902', 'vca', 2], ['995', 'att', 1],
  ['921', 'osc1', 1], ['921B', 'vca', 1], ['921B', 'vca', 1], ['923', 'noise', 1], ['904A', 'lpf', 2], ['907A', 'hpf', 2], ['911', 'env1', 2], ['902', 'vca', 2], ['921', 'osc1', 1], ['995', 'att', 1]];
const SCENES = {
  hw5: { title: 'Five hardware panels (the 1h set)', kind: 'hw', models: ['obxa', 'jupiter8', 'ms20', 'cs80', 'prophet5'] },
  m13: { title: 'The Model 15 set: 13 modules, 20 cords at rest', kind: 'rack', n: 13, cords: 20 },
  m13w: { title: 'The Model 15 set with its cords swinging', kind: 'rack', n: 13, cords: 20, wake: true },
  m20: { title: '20 modules, 30 cords', kind: 'rack', n: 20, cords: 30 },
  m30: { title: '30 modules, 40 cords', kind: 'rack', n: 30, cords: 40 },
  m30h: { title: '30 modules, 40 cords, the hidden face pictures dropped', kind: 'rack', n: 30, cords: 40, dropSvg: true },
  m13s: { title: 'The Model 15 set with flat (SVG) cords', kind: 'rack', n: 13, cords: 20, svg: true },
  // (stage 9b, §5 b2) the System 55: its 37 modules and the controller; the sequencer lamps toggling as Sequence runs them (the 960's ten at 8 Hz, the 962's)
  s55c: { title: 'The System 55 tile loading: its 38 faces, cold', kind: 'rack', set: 55, cords: 0, cold: true },
  s55: { title: 'The System 55 set: 38 faces, 40 cords at rest, the sequencer lamps running', kind: 'rack', set: 55, cords: 40, lamps: true },
  s55w: { title: 'The System 55 set with its cords swinging and the lamps running', kind: 'rack', set: 55, cords: 40, lamps: true, wake: true, dragType: '960', dragCords: 8 },
  s55h: { title: 'The System 55 set, the hidden face pictures dropped', kind: 'rack', set: 55, cords: 40, lamps: true, dropSvg: true },
};
const AUTO_ORDER = S55 ? ['s55c', 's55', 's55w', 's55h'] : ['hw5', 'm13', 'm13w', 'm20', 'm30', 'm30h', 'm13s', 'hw5'];
const HAND_ORDER = S55 ? ['hw5', 's55', 's55w', 'hw5'] : ['hw5', 'm13', 'm13w', 'm20', 'm30', 'hw5'];
const STEPS = S55 ? ['System 55: automatic runs (about 5 minutes, hands off)', 'System 55: hand test (about 5 minutes: pinch and pan as the bar says)'] : ['Automatic runs (about 7 minutes, hands off)', 'Hand test (about 10 minutes: pinch and pan as the bar says)', 'Cords (about 5 minutes: plug, move and pull out cords by their plugs, then tell us how they feel)'];

/* ------------------------------------------------------------------------------------------------ small helpers */
const $ = (s, r = document) => r.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r1 = x => Math.round(x * 10) / 10, r2 = x => Math.round(x * 100) / 100, r3 = x => Math.round(x * 1000) / 1000;
const gup = v => Math.ceil(v / 32 - 1e-9) * 32;
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* no storage */ } },
};
function q(a) { // frame intervals → { n, med, p95, max, over33, over50 }
  if (!a.length) return { n: 0, med: 0, p95: 0, max: 0, over33: 0, over50: 0 };
  const s = a.slice().sort((x, y) => x - y), at = p => r1(s[Math.min(s.length - 1, Math.floor(s.length * p))]);
  return { n: a.length, med: at(0.5), p95: at(0.95), max: r1(s[s.length - 1]), over33: a.filter(x => x > 33).length, over50: a.filter(x => x > 50).length };
}
const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
function shadeHex(hex, f) { // the lab's shade (LAB:252): f < 0 darker, > 0 lighter → [r, g, b] 0…1
  const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f))));
  return c;
}
const rgbStr = c => 'rgb(' + c.join(',') + ')';

/* ------------------------------------------------------------------------------------------------ page chrome */
const CSS = `
  :root { color-scheme: dark; }
  [hidden] { display: none !important; }
  html, body { height: 100%; }
  body { margin: 0; padding: 0; font: 16px/1.45 -apple-system, "Helvetica Neue", Arial, sans-serif; background: #0d0e11; color: #e6e6e6; }
  body.m9-full { overflow: hidden; touch-action: none; overscroll-behavior: none; }
  .m9-steps { margin: 8px 0; padding-left: 22px; color: #cfd3da; } .m9-steps li { margin: 4px 0; } .m9-steps li.now { color: #fff; font-weight: 600; }
  button { font: inherit; padding: 9px 16px; border-radius: 9px; border: 1px solid #4a4f5a; background: #1c1f26; color: #fff; touch-action: manipulation; }
  button.go { background: #2f6fd6; border-color: #2f6fd6; font-weight: 600; } button:disabled { opacity: 0.45; } button.on { background: #2f6fd6; border-color: #2f6fd6; }
  .m9-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 6px 0; }
  .warn { color: #ffb347; } .bad { color: #ff6b5a; font-weight: 600; } .ok { color: #7bd88f; }
  #m9frame { display: block; width: 100%; border: 0; background: #000; }
  .m9-res { padding: 8px 14px 40px; } .m9-res table { border-collapse: collapse; margin: 8px 0; font-variant-numeric: tabular-nums; font-size: 13px; }
  .m9-res th, .m9-res td { border: 1px solid #333; padding: 3px 8px; text-align: right; } .m9-res th:first-child, .m9-res td:first-child { text-align: left; }
  #m9out { width: 100%; height: 110px; background: #111; color: #ccc; border: 1px solid #333; font: 11px monospace; }
  .m9-bar { position: fixed; left: 0; right: 0; bottom: 0; min-height: 112px; box-sizing: border-box; padding: 8px 14px calc(8px + env(safe-area-inset-bottom));
    background: #15171c; border-top: 1px solid #333; display: flex; gap: 14px; align-items: center; z-index: 10; }
  .m9-bar .m9-say { flex: 1; font-size: 17px; line-height: 1.35; } .m9-bar .m9-say b { color: #fff; } .m9-bar .m9-k { font: 600 28px/1 -apple-system, sans-serif; min-width: 92px; text-align: center; }
  .m9-bar .m9-sub { color: #9aa0aa; font-size: 13px; }
  .m9-cover { position: fixed; inset: 0; background: rgba(8,9,12,0.88); display: flex; align-items: center; justify-content: center; z-index: 20; padding: 24px; overflow: auto; }
  .m9-cover > div { max-width: 660px; } .m9-cover button.go { font-size: 20px; padding: 14px 28px; margin-top: 14px; }
  .m9-cover h1 { font-size: 22px; margin: 0 0 8px; } .m9-cover p { color: #c4c8d0; }
  .m9-feel { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 14px; } .m9-feel button { font-size: 17px; }
  .m9-cover textarea { width: 100%; height: 70px; background: #111; color: #eee; border: 1px solid #444; border-radius: 8px; font: inherit; }
`;
function chrome() {
  document.title = S55 ? 'SYNTH Canvas — stage 9b System 55 test' : 'SYNTH Canvas — stage 9 modules and cords test';
  document.body.textContent = '';
  const st = h('style'); st.textContent = CSS; document.head.append(st);
}
let SAY = null;
const say = t => { if (SAY) SAY.textContent = t; if (AUTO) console.log('[m9] ' + t); };

/* ------------------------------------------------------------------------------------------------ build / staleness (as m3) */
async function buildInfo() {
  const b = { files: null, deployed: null, stale: false, note: '' };
  try { const t = await (await fetch('../sw.js', { cache: 'no-store' })).text(); b.deployed = (/const BUILD = '([0-9a-f]+)'/.exec(t) || [])[1] || null; } catch (e) { /* offline */ }
  let shells = [];
  try { if (globalThis.caches) shells = (await caches.keys()).filter(k => /^synth-shell-v\d+-[0-9a-f]+$/.test(k)).map(k => k.replace(/^synth-shell-v\d+-/, '')); } catch (e) { /* none */ }
  const viaSW = !!(navigator.serviceWorker && navigator.serviceWorker.controller) && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (!viaSW) { b.files = b.deployed; b.note = 'the files on the server'; return b; }
  if (shells.length === 1 && (!b.deployed || shells[0] === b.deployed)) { b.files = shells[0]; b.note = 'the app’s current build'; return b; }
  b.files = shells.length === 1 ? shells[0] : null; b.stale = true; b.note = 'an update of the app is installed but not applied';
  return b;
}
async function applyUpdate(btn) { // as bench.html: the waiting worker takes over (the page reloads on the takeover)
  let reg = null;
  try { reg = await navigator.serviceWorker.getRegistration(); if (reg && !reg.waiting) { await reg.update(); await sleep(1500); } } catch (e) { /* none */ }
  const w = reg && (reg.waiting || reg.installing);
  if (!w) { location.reload(); return; }
  btn.disabled = true; btn.textContent = 'Updating…';
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  setTimeout(() => location.reload(), 4000);
  try { w.postMessage({ t: 'skip' }); } catch (e) { location.reload(); }
}
let B = null; // the build this page measures
function envInfo() {
  return { date: new Date().toISOString(), page: location.origin + location.pathname, build: B && B.files, deployed: B && B.deployed, stale: !!(B && B.stale),
    ua: navigator.userAgent, dpr: devicePixelRatio, viewport: innerWidth + '×' + innerHeight, screen: screen.width + '×' + screen.height,
    canvas: A.W ? (r => Math.round(r.width) + '×' + Math.round(r.height))(A.W.viewport.getBoundingClientRect()) : null, gl: A.W && A.W.glStats() ? 'gl' : '2d', hold: HOLD,
    preset: presetInfo(A.W, IS_PAGE ? location.search : ''), cordLayer: REAL ? 'app' : 'prototype' }; // ((P) the preset asked and the one the app frame runs; which cord layer step 1's scenes draw)
}

/* ------------------------------------------------------------------------------------------------ the app in the iframe */
// (runs in the iframe before main.js: its capture listeners come before gesture.js's) the input-to-frame queue, touches down and
// each touch sequence, a press on a control (the knob step), console errors, the rAF requests (all of the frame's)
const HEAD_JS = `window.__synthTest = {};
(function () {
  var I = window.__m9in = { on: false, q: [], touches: 0, maxT: 0, knob: null, errs: [], raf: 0, gest: [] };
  addEventListener('pointermove', function (e) { if (I.on) I.q.push(e.timeStamp, performance.now()); if (I.knob && e.pointerId === I.knob.id) I.knob.moves++; }, { capture: true, passive: true });
  var g = null;
  var tc = function (e) {
    I.touches = e.touches ? e.touches.length : 0; if (I.touches > I.maxT) I.maxT = I.touches;
    if (I.touches && !g) g = { t0: performance.now(), max: 0 };
    if (g && I.touches > g.max) g.max = I.touches;
    if (!I.touches && g) { g.t1 = performance.now(); I.gest.push(g); if (I.gest.length > 200) I.gest.shift(); g = null; }
  };
  addEventListener('touchstart', tc, { capture: true, passive: true }); addEventListener('touchend', tc, { capture: true, passive: true }); addEventListener('touchcancel', tc, { capture: true, passive: true });
  addEventListener('pointerdown', function (e) {
    var t = e.target, k = t && t.closest ? t.closest('.hw-c, [data-dest], .knob') : null;
    if (k && I.on) I.knob = { id: e.pointerId, t0: e.timeStamp, moves: 0 };
  }, { capture: true, passive: true });
  var up = function (e) { if (I.knob && e.pointerId === I.knob.id) { I.knob.t1 = e.timeStamp; I.lastKnob = I.knob; I.knob = null; } };
  addEventListener('pointerup', up, { capture: true, passive: true }); addEventListener('pointercancel', up, { capture: true, passive: true });
  addEventListener('error', function (e) { I.errs.push('error: ' + String(e.message || e.error)); });
  addEventListener('unhandledrejection', function (e) { I.errs.push('unhandled: ' + String(e.reason && e.reason.message || e.reason)); });
  var ce = console.error;
  console.error = function () { try { I.errs.push([].map.call(arguments, function (a) { return a && a.stack ? String(a.stack).split('\\n').slice(0, 2).join(' ') : String(a); }).join(' ').slice(0, 300)); } catch (x) {} return ce.apply(console, arguments); };
  var raf0 = window.requestAnimationFrame;
  window.requestAnimationFrame = function (f) { I.raf++; return raf0.call(window, f); };
})();`;
const A = {}; // the app: { win, doc, api, cv, shell, W, PN, CP, MOD, FACES, MODELS, frame }
async function boot(frame) {
  const html = await (await fetch('../index.html', { cache: 'no-store' })).text();
  await mountFrame(frame, html.replace(/<head>/i, '<head><base href="' + BASE + '"><script>' + HEAD_JS + '<\/script>'), FQ, location.href); // ((P) a real page with the query when a switch is asked: the app reads it; else the srcdoc as ever)
  let win = null;
  for (let i = 0; i < 900 && !win; i++) {
    await sleep(50);
    const w = frame.contentWindow;
    if (w && w.__synthTest && w.__synthTest.cv && w.__synthTest.api && w.__synthTest.shell && w.document.querySelector('#world') && w.__synthTest.cv.world()) win = w;
  }
  if (!win) throw new Error('the app did not start in the frame');
  const T = win.__synthTest;
  Object.assign(A, { win, doc: win.document, api: T.api, cv: T.cv, shell: T.shell, frame, W: T.cv.world() });
  const st = A.api.store; A.blocked = 0; // (nothing the bench changes is stored)
  for (const m of ['set', 'setRaw', 'saveProject', 'saveNow']) if (typeof st[m] === 'function') st[m] = () => { A.blocked++; };
  A.dialogs = [];
  win.confirm = msg => { A.dialogs.push('confirm: ' + String(msg).slice(0, 160)); return true; };
  win.alert = msg => { A.dialogs.push('alert: ' + String(msg).slice(0, 160)); };
  const imp = u => win.Function('u', 'return import(u)')(new URL(u, BASE).href);
  A.PN = await imp('cv-panel.js?v=9'); A.CP = await imp('classic-panel.js?v=9'); A.MOD = await imp('cv-module.js?v=9');
  A.FACES = (await imp('cv-face.js?v=9')).FACES; A.MODELS = (await imp('models.js?v=9')).MODELS;
  try { const kr = A.doc.querySelector('#kbrow'), kh = A.doc.querySelector('#kbHide'); if (kr && !kr.hidden && kh) kh.click(); } catch (e) { console.error(e); }
  try { A.shell.topSet(0, 'end'); } catch (e) { console.error(e); }
  await sleep(300);
  try { if (A.W.lockOn && A.W.lockOn()) A.W.setLock(false); } catch (e) { /* older world */ }
  try { if (A.W.pinchMode !== 'canvas') A.W.setPinchMode('canvas'); } catch (e) { /* older world */ }
  const s = A.doc.createElement('style');
  s.textContent = FRAME_CSS;
  A.doc.head.append(s);
  installInput();
  return A;
}
// the iframe's own rules: the face jacks (transparent; the face shows the jack), their hit circle, the drag's halos, the glue
// probe's ring, the chip beside the finger, the undo notice
const FRAME_CSS = `
  #world .cv-mod > .cv-jack.cv-fjack { width: 28px; height: 28px; margin: -14px 0 0 -14px; background: none; box-shadow: none; }
  #world .cv-mod > .cv-jack.cv-fjack[data-sig="s"] { width: 22px; height: 18px; margin: -9px 0 0 -11px; border-radius: 4px; }
  #world .cv-mod > .cv-jack.cv-fjack::before { width: clamp(28px, calc(44px * var(--ik, 1)), var(--jp, 36px)); height: clamp(28px, calc(44px * var(--ik, 1)), var(--jp, 36px)); }
  #world .cv-mod > .cv-jack.cv-fjack.m9-ok { box-shadow: 0 0 0 calc(2px * var(--ik, 1)) rgba(111, 227, 161, 0.8); }
  #world .cv-mod > .cv-jack.cv-fjack.m9-hot { box-shadow: 0 0 0 calc(3px * var(--ik, 1)) #f2a33a, 0 0 calc(12px * var(--ik, 1)) rgba(242, 163, 58, 0.7); }
  #world .cv-mod > .cv-jack.cv-fjack.m9-name { box-shadow: 0 0 0 calc(3px * var(--ik, 1)) #5fb3ff, 0 0 calc(14px * var(--ik, 1)) rgba(95, 179, 255, 0.8); }
  #world[data-m9-sleep] .cv-fjack { pointer-events: none; }
  #world .cv-mod > .m9-pev { position: absolute; width: 28px; height: 28px; margin: -14px 0 0 -14px; padding: 0; border: 0; background: none; pointer-events: none; }
  #world .cv-mod > .m9-lamp { position: absolute; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%; pointer-events: none; background: rgba(255, 98, 52, 0); }
  #world .cv-mod > .m9-lamp[data-on] { background: #ff6a3a; box-shadow: 0 0 9px 3px rgba(255, 106, 58, 0.85); }
  #world.m9-solid .cv-mod > .m9-lamp[data-on] { box-shadow: none; }
  #world .m9-ring { position: absolute; box-sizing: border-box; border: 3px solid #00ffff; border-radius: 50%; pointer-events: none; z-index: 10002; }
  .m9-chip { position: fixed; left: 0; top: 0; z-index: 9999; pointer-events: none; padding: 5px 10px; border-radius: 8px; background: rgba(20, 22, 27, 0.92);
    border: 1px solid #f2a33a; color: #fff; font: 600 14px/1.2 -apple-system, sans-serif; white-space: nowrap; will-change: transform; }
  .m9-note { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 9999; padding: 10px 18px; border-radius: 10px; background: #1c1f26;
    border: 1px solid #4a4f5a; color: #fff; font: 600 15px/1.2 -apple-system, sans-serif; cursor: pointer; }
`;
const trk = () => { const P = A.api.project(); return P.tracks.find(t => t.id === P.selTrack); };
const raf = () => new Promise(r => A.win.requestAnimationFrame(r));
const now = () => A.win.performance.now();
async function mounted() { await sleep(250); for (let i = 0; i < 80 && A.cv.mount(); i++) await raf(); await sleep(500); }
function audioOn() { try { const p = A.api.powerOn(); if (p && p.catch) p.catch(() => {}); } catch (e) { console.error(e); } }
const audioRunning = () => { const c = A.api.ctx(); return !!c && c.state === 'running'; };
const appMod = k => (A.cv.view() ? A.cv.view().modules.get(k) : null);
const vpRect = () => A.W.viewport.getBoundingClientRect();

/* ------------------------------------------------------------------------------------------------ the stand-in faces */
// a panels/modular.js section as a layout of its own: one area over the section's mm (grown to the module's 32 px multiples, so
// the face fills the body: no transparent margins), the controls and decor whose anchor lies in it (cv-panel maps them through
// the area: no rebasing), every knob / rotary / switch live (a synthetic models.js control each), every jack `inert: 'later'`
// (full contrast) with its span; a 903A WHITE / PINK jack pair as two plain jacks
const cutC = new Map();
function cut(secId) {
  if (cutC.has(secId)) return cutC.get(secId);
  const ML = A.PN.layoutOf('modular'), s = ML.sections.find(x => x.id === secId);
  const inR = (x, y) => x >= s.x - 0.01 && x <= s.x + s.w + 0.01 && y >= s.y - 0.01 && y <= s.y + s.h + 0.01;
  const W = gup(s.w * 2), H = gup(BAR_H + s.h * 2), mx = (W / 2 - s.w) / 2, my = (H - BAR_H) / 2 - s.h;
  const src = [s.x - mx, s.y, s.w + 2 * mx, s.h + my];
  const controls = [], mcs = [], jacks = [], decor = [], seen = new Map();
  let gen = 0;
  const jack = (c, x, y, label, sig) => {
    controls.push(Object.assign({}, c, { kind: sig === 's' ? 'strig' : 'jack', x, y, label, lab: 'none', inert: 'later' }, sig === 's' ? {} : { d: c.d || 14 }));
    const n = (seen.get(label) || 0) + 1; seen.set(label, n);
    jacks.push({ label, x, y, sig, dir: sig === 's' ? 'in' : /MULTIPLE/.test(label) || (/OUTPUT|\bOUT\b/i.test(label) && !/INPUT/i.test(label)) ? 'out' : 'in' });
  };
  for (const c of ML.controls) {
    if (c.a) continue;
    const p = c.kind === 'jacks' ? c.at[0] : c;
    if (!inR(p.x, p.y)) continue;
    if (c.kind === 'jack') { jack(c, c.x, c.y, c.label, 'v'); continue; }
    if (c.kind === 'strig') { jack(c, c.x, c.y, c.label, 's'); continue; }
    if (c.kind === 'jacks') { for (const e of c.at) jack({ d: c.d }, e.x, e.y, (e.v ? 'PINK ' : 'WHITE ') + c.label, 'v'); continue; }
    if (c.kind === 'knob' || c.kind === 'rotary' || c.kind === 'switch') {
      const id = 'x' + gen++, cc = Object.assign({}, c, { id });
      delete cc.inert; delete cc.p;
      controls.push(cc);
      const def = typeof c.p === 'number' ? c.p : 0.5;
      if (c.kind === 'knob') mcs.push({ t: 'k', id, label: c.label, min: 0, max: 10, def: Math.round(def * 100) / 10 });
      else if (Array.isArray(c.map)) { const n = c.map.filter(v => v != null).length; mcs.push({ t: 's', id, label: c.label, opts: Array.from({ length: n }, (_, i) => String(i + 1)), def: 0 }); }
      else mcs.push({ t: 'b', id, label: c.label, def: typeof c.p === 'number' && c.p >= 0.5 ? 1 : 0 });
      continue;
    }
    controls.push(Object.assign({}, c)); // (lamps: art)
  }
  const anchor = d => d.t === 'line' ? [d.x1, d.y1] : d.t === 'path' ? (m => (m ? [+m[1], +m[2]] : null))(/M\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(d.d)) : [d.x, d.y];
  for (const d of ML.decor) {
    if (d.a) continue;
    if (d.t === 'screws') { const pts = d.pts.filter(p => inR(p[0], p[1])); if (pts.length) decor.push(Object.assign({}, d, { pts })); continue; }
    const p = anchor(d);
    if (p && inR(p[0], p[1])) decor.push(d);
  }
  // duplicate labels numbered (FREQUENCY CONTROL INPUT 1 · 2 · 3); the ports j0 … in layout order
  const cnt = new Map(); for (const j of jacks) cnt.set(j.label, (cnt.get(j.label) || 0) + 1);
  const k2 = new Map();
  jacks.forEach((j, i) => { j.id = 'j' + i; if (cnt.get(j.label) > 1) { const n = (k2.get(j.label) || 0) + 1; k2.set(j.label, n); j.label += ' ' + n; } j.bx = (j.x - src[0]) * 2; j.by = BAR_H + (j.y - src[1]) * 2; });
  let pitch = Infinity;
  for (let i = 0; i < jacks.length; i++) for (let k = i + 1; k < jacks.length; k++) pitch = Math.min(pitch, Math.hypot(jacks[i].bx - jacks[k].bx, jacks[i].by - jacks[k].by));
  const L = { v: 1, id: 'm9-' + secId, hw: 'a stand-in cut of panels/modular.js (' + s.label + ')', scheme: ML.scheme,
    areas: [{ id: 'main', src, at: [0, 0], fill: '#1d1d1c' }], sections: [{ id: 'm', label: s.label, x: s.x, y: s.y, w: s.w, h: s.h, frame: 'none', title: 'none' }],
    controls, decor };
  const model = { id: 'm9-' + secId, name: ART[secId], theme: A.MODELS.find(m => m.id === 'modular').theme, sections: [{ title: ART[secId], c: mcs }], controls: mcs };
  const out = { L, model, mcs, jacks, w: W, h: H, jp: Math.floor((isFinite(pitch) ? pitch : 40) - 2), art: ART[secId] };
  cutC.set(secId, out);
  return out;
}
// a stand-in module: cv-module's chrome (the compact bar: title, ⋯), its face through a ClassicPanel over the cut, a span per jack
function standIn(S, key, spec, at) {
  const C = spec.C || cut(spec.art), { doc, W } = A, id = 'm9:' + key; // (spec.C: a System 55 face, pack55's)
  const vals = {}; for (const c of C.mcs) vals[c.id] = c.def;
  const ftrack = { id: 'm9t-' + key, name: spec.title, prim: 'm9x', vals, preset: '' };
  const host = { doc, kit: S.kit, changed() {}, presets: { list: () => [], cur: () => null, load() {}, step() {}, save() {}, del() {}, init() {} } };
  if (spec.C) host.modMenu = { canMod: () => false }; // (a System 55 face, as stage 9's real faces: no canvas modulation into a module's knob)
  const rec = { key, id, spec, C, jacks: new Map(), lamps: new Map(), panel: null };
  const m = A.MOD.createModule({
    id, kind: 'pm', title: spec.title, sub: spec.sub || '', color: '#d9d2bf', x: at.x, y: at.y, fixed: { w: C.w, h: C.h }, jacks: [], cost: 90,
    body: { mount: body => { const root = doc.createElement('div'); body.append(root); rec.panel = new A.CP.ClassicPanel(root, { track: ftrack, model: C.model, layout: C.L, host }); if (spec.C) for (const e of root.querySelectorAll('[data-dest]')) e.setAttribute('data-nomod', '1'); }, unmount() {} },
    menu: () => [{ label: 'A stand-in module (stage 9 test page)', disabled: true }],
    onMove: (x, y, ph) => { if (ph === 'end') { S.modMoved = true; logEv('modmove', { mod: spec.title }); } if (S.cords) S.cords.moved(rec, ph); },
  }, { world: W, doc });
  rec.m = m;
  for (const sel of ['.cv-fold', '.cv-cpu']) { const e = m.el.querySelector(sel); if (e) { e.hidden = true; e.style.display = 'none'; } } // (§4.1: the compact bar; no fold)
  m.el.style.setProperty('--jp', C.jp + 'px');
  C.jacks.forEach((j, i) => {
    const sp = doc.createElement('span');
    sp.className = 'cv-jack cv-fjack';
    sp.setAttribute('data-cv-jack', id + '.' + j.id); sp.setAttribute('data-kind', 'cord'); sp.setAttribute('data-sig', j.sig); sp.setAttribute('data-dir', j.dir); sp.setAttribute('data-side', 'face');
    sp.setAttribute('aria-label', spec.title + ' · ' + j.label); sp.title = spec.title + ' · ' + j.label; sp.setAttribute('role', 'button'); sp.tabIndex = i ? -1 : 0;
    sp.style.left = j.bx + 'px'; sp.style.top = j.by + 'px';
    m.el.append(sp);
    rec.jacks.set(j.id, Object.assign({ el: sp, mod: rec }, j));
  });
  // (a System 55 face) the event buttons — a transparent button over the face, asleep to touches here — and the lamps — a span, lit by the page's timer
  for (const e of C.ev || []) {
    const b = doc.createElement('button'); b.type = 'button'; b.className = 'm9-pev'; b.setAttribute('aria-label', spec.title + ' · ' + e.label); b.tabIndex = -1;
    b.style.left = e.bx + 'px'; b.style.top = e.by + 'px'; m.el.append(b);
  }
  for (const l of C.lamps || []) {
    const sp = doc.createElement('span'); sp.className = 'm9-lamp'; sp.setAttribute('aria-hidden', 'true');
    sp.style.left = l.bx + 'px'; sp.style.top = l.by + 'px'; m.el.append(sp); rec.lamps.set(l.id, sp);
  }
  W.el.append(m.el);
  W.add(m);
  S.mods.push(rec); S.byKey.set(key, rec); S.byId.set(id, rec);
  return rec;
}
// Tidy's rows (§4.5): the controller at (0, 0); row 1 (sources) at y −1 024, row 2 (modifiers) at y −512, flush left to right;
// an extra module goes to its family's shortest row, a row past 1 024 px opens a new one above every row
function rackLayout(list) {
  const pos = [], rows = [{ fam: 2, y: -512, x: 0 }, { fam: 1, y: -1024, x: 0 }];
  for (const it of list) {
    const C = cut(it[1]);
    if (it[2] === 0) { pos.push({ x: 0, y: 0 }); continue; }
    let r = rows.filter(x => x.fam === it[2]).sort((a, b) => a.x - b.x)[0];
    if (r.x + C.w > 1024) { r = { fam: it[2], y: Math.min(...rows.map(x => x.y)) - 512, x: 0 }; rows.push(r); }
    pos.push({ x: r.x, y: r.y }); r.x += C.w;
  }
  return pos;
}

/* ------------------------------------------------------------------------------------------------ System 55 (stage 9b, §5 b2: the page's part) */
// a System 55 type's face as standIn() takes it (cut()'s shape): stage 9's real face (cv-panel moduleLayout / moduleModel, the
// controller's console from layoutOf('m900')) or the stand-in of face55; its jacks from cv-panel's geometry (the face-jack spans
// as stage 9's real build places them), the event buttons and lamps by their mm centres through the face's offset
const c55C = new Map();
function c55(type) {
  if (c55C.has(type)) return c55C.get(type);
  const PN = A.PN, ref = PN.moduleLayout('921');
  let L, model, mcs, ev = [], lamps = [], problems = [], art = 'real';
  if (type === 'ctl') { L = PN.layoutOf('m900'); model = A.MODELS.find(m => m.id === 'm900'); mcs = model && model.controls; }
  else if (NEW55.includes(type)) { const f = face55(type, PN, PN.moduleModel('921').theme, ref.scheme); ({ L, model, mcs, ev, lamps, problems } = f); art = 'stand-in'; }
  else { L = PN.moduleLayout(type); model = PN.moduleModel(type); mcs = model && model.controls; }
  if (!L || !model) throw new Error('no face for the System 55 type ' + type);
  const g = PN.geometry(L, model), sz = PN.sizeOf(L, model), mm = g.mm, at = e => ({ id: e.id, label: e.label, bx: r2(mm.offX + (e.x - mm.x0) * 2), by: r2(BAR_H + (e.y - mm.y0) * 2) });
  const C = { type, art, L, model, mcs, problems, w: sz.w, h: sz.h, ev: ev.map(at), lamps: lamps.map(at),
    jacks: g.jacks.map(j => ({ id: j.port, label: j.label, sig: j.sig, dir: j.dir || 'any', bx: j.x, by: j.y + BAR_H })), jp: Math.floor((g.jackPitch != null ? g.jackPitch : 40) - 2) };
  c55C.set(type, C);
  return C;
}
// the System 55 as the tile loads it: the controller, then the sources row, the modifiers row and the console row in the set's order
function list55() {
  const out = [{ type: 'ctl', row: 0, title: 'Controller' }];
  for (const [type, n, row] of SYS55) for (let i = 1; i <= n; i++) out.push({ type, row, title: NAME55[type] + (n > 1 ? ' ' + i : '') });
  return out;
}
// the patch: eight cords on the module the scene drags (the 960's rows to the oscillators and filter, its shift and its
// inputs arriving), then seeded out → in pairs (a multiple pairs with either) 120 … 1 100 world px apart up to the count
function makePatch55(S, D) {
  const R = rng(5501), cords = [], used = new Set(), J = [];
  for (const r of S.mods) for (const j of r.jacks.values()) J.push(j);
  const wp = j => ({ x: j.mod.m.x + j.bx, y: j.mod.m.y + j.by }), key = j => j.mod.key + '.' + j.id, dist = (a, b) => Math.hypot(wp(a).x - wp(b).x, wp(a).y - wp(b).y);
  const add = (a, b) => {
    if (!a || !b || used.has(key(a)) || used.has(key(b)) || a.sig !== b.sig || a.mod === b.mod || (a.dir === b.dir && a.dir !== 'any') || a.dir === 'in' || b.dir === 'out') return false;
    used.add(key(a)); used.add(key(b));
    cords.push({ id: 'c' + cords.length, a: { m: a.mod.key, j: a.id }, b: { m: b.mod.key, j: b.id }, c: cords.length % PALETTE.length, s: a.sig === 's' });
    return true;
  };
  const dm = D.dragType ? S.mods.find(r => r.spec.type === D.dragType) : null;
  if (dm) {
    let n = 0;
    for (const id of ['ra1', 'sh', 'rb1', 'i1', 'rc1', 'ci', 'o1', 'i2']) {
      const a = dm.jacks.get(id); if (!a || n >= (D.dragCords || 8)) continue;
      for (let tries = 0; tries < 600; tries++) {
        const b = J[Math.floor(R() * J.length)], d = b.mod === dm ? 0 : dist(a, b);
        if (d < 120 || d > 1300) continue;
        if (a.dir === 'out' ? add(a, b) : add(b, a)) { n++; break; }
      }
    }
    for (const j of dm.jacks.values()) used.add(key(j)); // (exactly those on the dragged module)
  }
  for (let tries = 0; cords.length < D.cords && tries < 40000; tries++) {
    const a = J[Math.floor(R() * J.length)], b = J[Math.floor(R() * J.length)], d = a && b ? dist(a, b) : 0;
    if (d < 120 || d > 1100) continue;
    add(a, b);
  }
  return cords;
}
// the sequencer's lamps as Sequence runs them (§5 b2, skeptic #10): the 960's stage lamps stepping at 8 Hz (1/16 at 120 BPM: the
// running step's lit, the one before it dark), its OSC lamp and the Song clock's RUN lamp steady, the 962's three one a step; a lit
// lamp is a span with a glow (&lamps=solid: a solid fill), written from a timer as the real ones are from the monitor's messages;
// &lamphold=1: no write while the camera moves (the world's burst), the last state shown at its end (§5's decision table)
function startLamps(S) {
  const seq = S.mods.find(r => r.spec.type === '960'), sw = S.mods.find(r => r.spec.type === '962'), clk = S.mods.find(r => r.spec.type === 'clk');
  const st = { mode: LAMP_SOLID ? 'solid' : 'glow', hold: LAMP_HOLD, ticks: 0, toggles: 0, held: 0, lamps: S.mods.reduce((n, r) => n + r.lamps.size, 0) };
  let step = 0, held = false;
  const set = (r, id, on) => { const e = r && r.lamps.get(id); if (e && e.hasAttribute('data-on') !== on) { if (on) e.setAttribute('data-on', ''); else e.removeAttribute('data-on'); st.toggles++; } };
  const show = () => {
    for (let i = 1; i <= 9; i++) set(seq, 'l' + i, i - 1 === step % 8);
    for (let i = 1; i <= 3; i++) set(sw, 'l' + i, i - 1 === step % 3);
  };
  A.W.el.classList.toggle('m9-solid', LAMP_SOLID);
  set(seq, 'lo', true); set(clk, 'lr', true); show();
  const iv = A.win.setInterval(() => { st.ticks++; step++; if (LAMP_HOLD && A.W.busy) { st.held++; held = true; return; } held = false; show(); }, 125);
  const off = A.W.on('cameraend', () => { if (held) { held = false; show(); } });
  return { stats: () => Object.assign({}, st), stop() { A.win.clearInterval(iv); off(); A.W.el.classList.remove('m9-solid'); } };
}
// the cold load (s55c): every face a texture and the raster queue empty, polled each frame from the first module — the time, the
// frames in between (the worst one), the raster work (cv-face's paints: count, total, longest ms) and the queue at its start
async function coldWait(S, ms = 90000) {
  const C = S.cold, t0 = C.t0;
  let q0 = null, ok = false;
  while (now() - t0 < ms) {
    await raf();
    const st = A.FACES.stats();
    if (q0 == null) q0 = st.queued;
    if (S.mods.every(r => r.m.el.getAttribute('data-cv-face') === 'gl') && !st.queued) { ok = true; break; }
  }
  C.ms = Math.round(now() - t0);
  const R = C.rec.stop(), ds = [], st = A.FACES.stats();
  for (let i = 0; i < R.f.length; i += 2) if (R.f[i + 1] >= t0) ds.push(R.f[i]);
  C.res = { ok, ms: C.ms, createMs: C.createMs, queued0: q0, frames: q(ds), paints: st.paints, paintMs: r1(st.paintMs), paintMax: r1(st.paintMax), glFaces: st.gl, faces: st.faces, faceMB: r1((st.bytes || 0) / MiB) };
}

/* ------------------------------------------------------------------------------------------------ scenes */
const S0 = { cur: null };
function hideApp(S, keys) {
  const t = S.t; t.lay = Object.assign({}, t.lay);
  keys.forEach((k, i) => { if (k in (t.dev || {}) || k === 'wheel' || k === 'out' || /fx/.test(k)) { t.lay[k] = Object.assign({}, t.lay[k], { x: -64000 - i * 3200, y: -64000 }); S.hide.add(k); } });
}
async function play(S) { // the scene's track loops 2 bars of a chord (the worklet runs as in use)
  const P = A.api.project(), T = A.api.transport();
  if (T.playing) A.doc.querySelector('#tPlay').click();
  const bt = 960 * 4 * P.sig[0] / P.sig[1];
  A.api.clipToTrack(S.t.id, [48, 52, 55, 59].map(n => ({ n, t: 0, d: 2 * bt - 24, v: 100 })));
  P.loop.start = 0; P.loop.end = 2 * bt; P.loop.on = true;
  await sleep(150);
  if (!A.api.transport().playing) A.doc.querySelector('#tPlay').click();
  await sleep(300);
}
function stopPlay() { if (A.api.transport().playing) A.doc.querySelector('#tPlay').click(); }
function kitOf() { for (const p of A.cv.classicPanels.values()) if (p && p.host && p.host.kit) return p.host.kit; return null; }
async function build(id) {
  const D = SCENES[id], S = { id, D, mods: [], byKey: new Map(), byId: new Map(), offs: [], hide: new Set(), t0: now(), info: {}, e0: A.win.__m9in.errs.length, log: [] };
  S0.cur = S;
  say('Building ' + id + ' — ' + D.title + '…');
  const tb = now();
  if (D.kind === 'hw') {
    A.shell.srcPick(D.models[0], 'track'); await mounted(); S.t = trk();
    try { A.cv.touch(false); } catch (e) { /* older hooks */ }
    try { for (const m of D.models.slice(1)) { A.cv.add(m, null); await sleep(300); } } finally { try { A.cv.touch(null); } catch (e) { /* older hooks */ } }
    A.cv.tidy(); await mounted();
  } else {
    A.api.addTrack(A.MODELS.find(m => m.id === 'modular'), null, { ui: 'flow' }); await mounted(); S.t = trk(); // (today's Moog Modular, Simple: no face)
  }
  await play(S);
  const P = A.api.project(), keys = [];
  if (D.kind === 'rack') keys.push(...Object.keys(S.t.dev || {}), 'out');
  if (P.perf && P.perf.wheel) keys.push('wheel');
  hideApp(S, keys);
  A.cv.render(); await raf(); await raf(); await sleep(200);
  for (const k of S.hide) { const m = appMod(k); if (m) { try { m.onScreen(false); } catch (e) { /* gone */ } A.W.remove(k); } }
  S.style = A.doc.createElement('style');
  S.style.textContent = [...S.hide].map(k => '#world > [data-cv-mod="' + k + '"]').concat(['#world > svg.cv-cables', '#world > svg.cv-cable-ends', '#world > .cv-mbadge']).join(',\n') + ' { display: none !important; }\n';
  A.doc.head.append(S.style);
  if (D.kind === 'rack') {
    S.kit = kitOf();
    if (!S.kit) throw new Error('no classic panel kit in the app (the stand-in faces need one)');
    if (D.set === 55) { // (stage 9b) the System 55 as its tile loads it; s55c: the frames and the raster work counted from the first module
      const list = list55(), pos = rack55(list, it => { const C = c55(it.type); return [C.w, C.h]; });
      if (D.cold) { A.FACES.stats(true); S.cold = { t0: now(), rec: recorder() }; }
      const tc = now();
      list.forEach((it, i) => standIn(S, 'k' + i, { C: c55(it.type), title: it.title, sub: c55(it.type).art === 'stand-in' ? 'stand-in' : '', type: it.type, row: it.row }, pos[i]));
      if (S.cold) S.cold.createMs = Math.round(now() - tc);
      S.fit = S.mods.map(r => r.id);
      A.W.fit({ ids: S.fit, animate: false });
      if (!D.cold) { await raf(); await sleep(200); }
      for (const r of S.mods) A.W.update(r.id);
      if (D.cords) { S.patch = makePatch55(S, D); S.cords = mkCords(S, {}); S.cords.set(S.patch); }
    } else {
      const list = M15.concat(MORE).slice(0, D.n), pos = rackLayout(list), num = new Map();
      list.forEach((it, i) => {
        const n = (num.get(it[0]) || 0) + 1; num.set(it[0], n);
        const many = list.filter(x => x[0] === it[0]).length > 1, title = it[0] === 'CTL' ? 'Controller' : it[0] + (many ? ' ' + n : '');
        const art = ART[it[1]], sub = it[0] === 'CTL' ? 'art: CP3A' : art !== it[0] ? 'art: ' + art : '';
        standIn(S, 'k' + i, { art: it[1], title, sub, type: it[0], row: it[2] }, pos[i]);
      });
      await raf(); await sleep(200);
      for (const r of S.mods) A.W.update(r.id);
      S.patch = makePatch(S, D.cords);
      S.cords = mkCords(S, { svg: !!D.svg });
      S.cords.set(S.patch);
      S.fit = S.mods.map(r => r.id);
    }
  } else S.fit = A.W.ids().filter(k => !S.hide.has(k));
  A.W.fit({ ids: S.fit, animate: false });
  if (S.cold) await coldWait(S); else await facesReady(S, D.set ? 40000 : 6000);
  if (D.dropSvg) { S.dropped = 0; for (const r of S.mods) { const s = r.m.el.querySelector('.hw-decor > svg'); if (s && r.m.el.getAttribute('data-cv-face') === 'gl') { s.remove(); S.dropped++; } } }
  sleepState(S);
  S.offs.push(A.W.on('cameraend', () => sleepState(S)));
  if (D.lamps) S.lamps = startLamps(S);
  await sleep(300);
  S.info = sceneInfo(S);
  S.info.buildMs = Math.round(now() - tb);
  S.t0 = now();
  return S;
}
// every stand-in face on the GL path and the raster queue empty (a rest pumps it), within ms
async function facesReady(S, ms) {
  const t0 = now();
  while (now() - t0 < ms) {
    await sleep(200);
    const st = A.FACES.stats(), all = S.mods.every(r => r.m.el.getAttribute('data-cv-face') === 'gl');
    if (all && !st.queued) break;
  }
  await sleep(200);
}
// (§4.2) below READ_K the cord jacks sleep like controls: a press there pans
function sleepState(S) { if (A.W.el) { if (A.W.k < READ_K - 1e-9) A.W.el.setAttribute('data-m9-sleep', ''); else A.W.el.removeAttribute('data-m9-sleep'); } }
async function teardown(S) {
  if (!S) return;
  stopPlay();
  dragEnd(true);
  if (S.lamps) { S.lamps.stop(); S.lamps = null; }
  for (const f of S.offs.splice(0)) { try { f(); } catch (e) { console.error(e); } }
  if (S.cords) { S.cords.destroy(); S.cords = null; }
  for (const r of S.mods) {
    try { A.W.remove(r.id); } catch (e) { /* gone */ }
    try { if (r.panel) r.panel.destroy(); } catch (e) { /* gone */ }
    try { r.m.destroy(); } catch (e) { /* gone */ }
    r.m.el.remove();
  }
  if (S.style) S.style.remove();
  if (A.W.el) A.W.el.removeAttribute('data-m9-sleep');
  const t = A.api.project().tracks.find(x => x.id === S.t.id);
  if (t) { t.notes = []; try { A.api.deleteTrack(t); } catch (e) { console.error(e); } }
  await sleep(300);
  S0.cur = null;
}
// the patch: on the m13 set, six cords on the 921 (its outputs and two control inputs: the scripted drag wakes six), then
// seeded pairs (an output to an input of another module, ≤ 900 world px apart) until the scene's count; each jack holds one plug
function makePatch(S, n) {
  const R = rng(9001), cords = [], used = new Set(), J = [];
  for (const r of S.mods) for (const j of r.jacks.values()) J.push(j);
  const wp = j => ({ x: j.mod.m.x + j.bx, y: j.mod.m.y + j.by });
  const key = j => j.mod.key + '.' + j.id;
  const add = (a, b) => { if (!a || !b || used.has(key(a)) || used.has(key(b)) || a.sig !== b.sig || a.dir === b.dir || a.mod === b.mod) return false; used.add(key(a)); used.add(key(b)); cords.push({ id: 'c' + cords.length, a: { m: a.mod.key, j: a.id }, b: { m: b.mod.key, j: b.id }, c: cords.length % PALETTE.length, s: a.sig === 's' }); return true; };
  const by = (type, re, nth = 1) => { const rs = S.mods.filter(r => r.spec.type === type); const r = rs[nth - 1]; if (!r) return null; return [...r.jacks.values()].find(j => re.test(j.label)) || null; };
  if (S.mods.some(r => r.spec.type === '921')) {
    add(by('921', /^SINE/), by('904A', /^SIGNAL INPUT/)); add(by('921', /^SAWTOOTH/), by('907A', /^SIGNAL INPUT/));
    add(by('921', /^RECTANGULAR output/), by('921B', /^SIGNAL INPUT 1/)); add(by('921', /^TRIANGULAR/), by('995', /^ATTENUATOR 1 IN/));
    add(by('911', /^OUTPUT/), by('921', /^FREQUENCY CONTROL INPUT 1/)); add(by('921A', /^ATTENUATOR 2 OUT/), by('921', /^WIDTH CONTROL IN 1/));
    for (const j of S.mods.find(r => r.spec.type === '921').jacks.values()) used.add(key(j)); // (exactly six on the dragged one)
  }
  for (let tries = 0; cords.length < n && tries < 20000; tries++) {
    const a = J[Math.floor(R() * J.length)], b = J[Math.floor(R() * J.length)];
    if (!a || !b || a.dir !== 'out' || b.dir !== 'in') continue;
    const pa = wp(a), pb = wp(b), d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
    if (d < 120 || d > 900) continue;
    add(a, b);
  }
  return cords;
}
// the scene's modules: elements, painted (a layout box: the S0 rule), painted less the hidden face SVGs, the SVG nodes, per type
function count(el) {
  let n = 0, vis = 0, svg = 0, svgVis = 0;
  for (const e of [el, ...el.getElementsByTagName('*')]) {
    n++;
    const has = e.getClientRects().length > 0, inSvg = !!(e.closest && e.closest('.hw-decor'));
    if (has) vis++;
    if (inSvg && e.namespaceURI === 'http://www.w3.org/2000/svg') { svg++; if (has) svgVis++; }
  }
  return { n, vis, svg, svgVis };
}
function sceneMods(S) {
  if (S.D.kind === 'rack') return S.mods.map(r => ({ key: r.key, el: r.m.el, type: r.spec.type }));
  const out = [];
  for (const m of A.W.el.querySelectorAll(':scope > .cv-mod[data-cv-mod]')) { const k = m.getAttribute('data-cv-mod'); if (!S.hide.has(k)) out.push({ key: k, el: m, type: m.getAttribute('data-cv-kind') }); }
  return out;
}
function sceneInfo(S) {
  const per = {}, mods = sceneMods(S);
  let n = 0, vis = 0, svg = 0, svgVis = 0;
  for (const m of mods) {
    const c = count(m.el);
    n += c.n; vis += c.vis; svg += c.svg; svgVis += c.svgVis;
    const T = per[m.type] || (per[m.type] = { mods: 0, painted: 0, paintedVis: 0, svg: 0 });
    T.mods++; T.painted += c.vis; T.paintedVis += c.vis - c.svgVis; T.svg += c.svg;
  }
  for (const T of Object.values(per)) { T.painted = Math.round(T.painted / T.mods); T.paintedVis = Math.round(T.paintedVis / T.mods); T.svg = Math.round(T.svg / T.mods); } // (per module)
  const g = A.W.glStats(), cs = S.cords ? S.cords.stats() : null;
  const faces = S.D.kind === 'rack' ? S.mods.filter(r => r.m.el.getAttribute('data-cv-face') === 'gl').length : g ? g.glFaces : null;
  const out = { modules: mods.length, elements: n, painted: vis, paintedVis: vis - svgVis, faceSvg: svg, world: A.W.el.getElementsByTagName('*').length,
    perType: per, glFaces: faces, glMB: g ? r1((g.bytes || 0) / MiB) : null, faceMB: g ? r1((g.faceBytes || 0) / MiB) : null,
    cords: cs ? cs.cords : 0, cordMode: cs ? cs.mode : null, cordMB: cs ? r1(cs.bytes / MiB) : 0, k: r3(A.W.k), dropped: S.dropped || 0 };
  if (S.D.set) out.lamps = S.lamps ? S.lamps.stats() : null; // (the System 55 scenes only: the old scenes' results keep their shape)
  if (cs && S.cords.real) Object.assign(out, { cordLayer: 'app', cordPerf: cs.perf, cordQuality: cs.quality, cordPts: cs.pts }); // ((P) the app's own layer: the preset's cords)
  return out;
}

/* ------------------------------------------------------------------------------------------------ the app's own cord layer (P) */
// (IMPL-P §4 G5, review 2 F6) cv-cords through the world — A.W.cords(), at the world's preset (the physics, quality and strip builds
// of High / Medium / Low) — behind the calls step 1 makes of the prototype below: set, all, moved, pluckAll, stats, rafReq, running,
// mode, destroy. The jack keys are 'module.jack', the anchors one Map of world points kept up to date by moved(); the layer is the
// world's (built once, stepped and drawn by its frame): destroy empties it. stats() = cords().stats() plus the prototype's names
// (ropeSteps, ticks, uploadKB, dbl) so every phase's numbers read the same; the layer's own — perf, quality, pts, steps, stepMs,
// uploads, uploadBytes, fulls, writes — ride along. rafReq counts the layer's frames and draws: at rest it must not move.
function realCords(S) {
  const L = A.W.cords();
  if (!L) return null;
  const key = (m, j) => m + '.' + j, anc = new Map();
  let list = [];
  const put = r => { for (const j of r.jacks.values()) anc.set(key(r.key, j.id), { x: r.m.x + j.bx, y: r.m.y + j.by }); };
  return {
    real: true,
    get mode() { return L.mode; },
    set(patch) {
      list = patch.map(c => Object.assign({}, c, { a: Object.assign({}, c.a), b: Object.assign({}, c.b) }));
      for (const r of S.mods) put(r);
      L.set(list.map(c => ({ id: c.id, a: key(c.a.m, c.a.j), b: key(c.b.m, c.b.j), c: c.c, s: c.s ? 1 : 0 })));
      L.anchors(anc);
    },
    all: () => list.slice(),
    moved(r) { put(r); L.anchors(anc); },
    pluckAll() { L.pluck(); },
    stats(reset) { const s = L.stats(reset); return Object.assign({}, s, { ticks: s.frames, ropeSteps: s.steps, perFrame: s.frames ? r1(s.steps / s.frames) : 0, uploadKB: r1(s.uploadBytes / 1024), dbl: 0 }); },
    rafReq: () => { const s = L.stats(); return s.frames + s.draws; },
    running: () => !!L.stats().running,
    destroy() { L.set([]); L.anchors(null); },
  };
}
const mkCords = (S, o) => (REAL && !o.svg ? realCords(S) : null) || createCords(S, o);

/* ------------------------------------------------------------------------------------------------ the prototype cord layer */
// createCords(S, { svg }): the cords of scene S — a rope each (the Studio physics), drawn by a WebGL2 canvas after #world (or the
// SVG fallback inside #world: the motion-off parabola, re-pathed on anchor changes, no dynamics). Drawn from the world's
// 'camera' event (inside write()); its own rAF only while a cord is awake, held or in flight. Ends: { m: module key, j: jack id }
// or { free: { x, y } } (a plug in flight). The API is §4.3's, cut to what the page needs.
const STRIP_VS = `#version 300 es
layout(location=0) in vec2 p;layout(location=1) in vec2 n;layout(location=2) in vec2 sc;layout(location=3) in float sel;
uniform vec4 cam;uniform vec4 vp;uniform vec3 pal[8];
out float v;out float hc;out float hw1;out vec3 col;out float vsel;out float wpx;
void main(){float kd=cam.z*cam.w;float hw=max(5.6,1.25/kd);float pad=1.0/kd;
vec2 w=p+n*sc.x*(hw+pad);if(vp.z<0.5)w+=vec2(4.0,8.0);
v=sc.x*(hw+pad)/hw;hc=dot(vec2(-1.68,-1.96),n)/hw;hw1=1.1/hw;col=pal[int(sc.y+0.5)];vsel=sel;wpx=hw*kd;
vec2 dv=(w*cam.z+cam.xy)*cam.w;gl_Position=vec4(dv.x/vp.x*2.0-1.0,1.0-dv.y/vp.y*2.0,0.0,1.0);}`;
const STRIP_FS = `#version 300 es
precision highp float;uniform vec4 vp;
in float v;in float hc;in float hw1;in vec3 col;in float vsel;in float wpx;out vec4 o;
void main(){float a=abs(v),aa=max(fwidth(v),1e-4);float cov=clamp((1.0-a)/aa+0.5,0.0,1.0);
if(vp.z<0.5){float al=0.32*cov*vp.w;o=vec4(0.0,0.0,0.0,al);return;}
vec3 rim=col*0.55;float body=clamp((0.696-a)/aa+0.5,0.0,1.0);vec3 c=mix(rim,col,body);
vec3 hi=col+(1.0-col)*0.45;float hcov=clamp((hw1-abs(v-hc))/aa+0.5,0.0,1.0)*0.55;c=mix(c,hi,hcov);
if(vsel>0.5){float e=clamp((a-(1.0-2.0/max(wpx,1.0)))/aa+0.5,0.0,1.0);c=mix(c,vec3(0.96),e*0.9);}
float al=cov*vp.w;o=vec4(c*al,al);}`;
const PLUG_VS = `#version 300 es
layout(location=0) in vec2 q;layout(location=1) in vec4 ins;layout(location=2) in float fl;
uniform vec4 cam;uniform vec4 vp;uniform vec3 pal[8];
out vec2 lp;out vec3 col;out float shp;out float pxw;out float fsel;
void main(){float kd=cam.z*cam.w;float R=22.0+2.0/kd;vec2 w=ins.xy+q*R;
lp=q*R;col=pal[int(ins.z+0.5)];shp=ins.w;pxw=1.0/kd;fsel=fl;
vec2 dv=(w*cam.z+cam.xy)*cam.w;gl_Position=vec4(dv.x/vp.x*2.0-1.0,1.0-dv.y/vp.y*2.0,0.0,1.0);}`;
const PLUG_FS = `#version 300 es
precision highp float;uniform vec4 vp;
in vec2 lp;in vec3 col;in float shp;in float pxw;in float fsel;out vec4 o;
float cv(float sd){return clamp(0.5-sd/pxw,0.0,1.0);}
float rb(vec2 p,vec2 b,float r){vec2 d=abs(p)-b+r;return length(max(d,0.0))+min(max(d.x,d.y),0.0)-r;}
vec4 ov(vec4 s,vec4 d){return s+d*(1.0-s.a);}
void main(){
if(shp>2.5){o=vec4(1.0,0.0,1.0,1.0)*cv(length(lp)-max(3.0,3.0*pxw));return;}
if(shp>1.5){o=vec4(0.91,0.64,0.24,1.0)*cv(abs(length(lp)-15.0)-1.0);return;}
bool r=shp>0.5;
float sS=r?rb(lp-vec2(3.0,4.0),vec2(13.0,9.0),4.0):length(lp-vec2(3.0,4.0))-14.0;
float sR=r?rb(lp,vec2(13.0,9.0),4.0):length(lp)-14.0;
float sB=r?rb(lp,vec2(9.0,5.0),3.0):length(lp)-9.8;
float sH=length(lp-vec2(-3.0,-3.0))-3.4;
vec4 c=vec4(0.0,0.0,0.0,0.35)*cv(sS);
c=ov(vec4(col*0.65,1.0)*cv(sR),c);c=ov(vec4(col,1.0)*cv(sB),c);c=ov(vec4(1.0)*0.35*cv(sH),c);
if(fsel>0.5)c=ov(vec4(0.96,0.96,0.96,1.0)*0.9*cv(abs(sR+1.5)-1.0),c);
o=c*vp.w;}`;
const FPV = 7, PTS = 2 + (STUDIO.N - 2) * STUDIO.SUB; // floats a strip vertex; points a smoothed cord
function createCords(S, o) {
  const { win, doc, W } = A, svg = !!o.svg, reduced = (() => { try { return win.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
  const cords = new Map(); // id → { id, a, b, c, s, r (rope), sel }
  let ropes = []; // (the ropes in order: rebuilt on add / remove, never per frame)
  const relist = () => { ropes = [...cords.values()].map(c => c.r); };
  const sim = { acc: 0, last: 0 };
  const st = { draws: 0, drawMs: 0, drawMax: 0, uploads: 0, uploadBytes: 0, frames: 0, ropeSteps: 0, stepMs: 0, stepMax: 0, buildMs: 0, frameMax: 0, awakeMax: 0,
    dbl: 0, longSteps: 0, holds: 0, rafReq: 0, lost: 0, restored: 0, costs: [], perFrame: 0 };
  let running = false, dead = false, sel = null, probe = null, lastCam = null, lastLong = false, geomV = 1, upV = 0, drawnKey = -1, drawsKey = 0, frameDraws = 0;
  let VW = 0, VH = 0, D = 1;
  const view = () => { const r = vpRect(); VW = r.width; VH = r.height; D = Math.max(1, win.devicePixelRatio || 1); };
  view();
  const endPos = (e, out, i) => {
    if (e.free) { out[i] = e.free.x; out[i + 1] = e.free.y; return; }
    const r = S.byKey.get(e.m), j = r && r.jacks.get(e.j);
    if (!j) { out[i] = 0; out[i + 1] = 0; return; }
    out[i] = r.m.x + j.bx; out[i + 1] = r.m.y + j.by;
  };
  const ends = (rope, E) => { const c = rope.cord; endPos(c.a, E, 0); endPos(c.b, E, 2); };
  const E4 = new Float64Array(4);
  function addCord(c, awake) {
    const r = makeRope(); r.cord = c; c.r = r;
    endPos(c.a, E4, 0); endPos(c.b, E4, 2);
    seed(r, E4[0], E4[1], E4[2], E4[3], !!awake);
    cords.set(c.id, c); relist();
    geomV++;
    if (SV) SV.add(c);
    return c;
  }
  /* ---- GL */
  let cv = null, gl = null, P = null, cap = 0, capP = 0, strip = new Float32Array(0), plugs = new Float32Array(0), nStrip = 0, nPlug = 0;
  const pts = new Float64Array(PTS * 2), sX = new Float64Array(STUDIO.N), sY = new Float64Array(STUDIO.N);
  const U = { cam: new Float32Array(4), vp: new Float32Array(4) };
  function glBuild() {
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error('m9 cords: ' + gl.getShaderInfoLog(x)); return x; };
    const pr = (a, b) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, a)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, b)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('m9 cords: ' + gl.getProgramInfoLog(p)); return p; };
    const ps = pr(STRIP_VS, STRIP_FS), pp = pr(PLUG_VS, PLUG_FS), pal = new Float32Array(24);
    PALETTE.forEach((hx, i) => { const n = parseInt(hx.slice(1), 16); pal[i * 3] = (n >> 16) / 255; pal[i * 3 + 1] = ((n >> 8) & 255) / 255; pal[i * 3 + 2] = (n & 255) / 255; });
    P = { ps, pp, sCam: gl.getUniformLocation(ps, 'cam'), sVp: gl.getUniformLocation(ps, 'vp'), pCam: gl.getUniformLocation(pp, 'cam'), pVp: gl.getUniformLocation(pp, 'vp') };
    gl.useProgram(ps); gl.uniform3fv(gl.getUniformLocation(ps, 'pal'), pal);
    gl.useProgram(pp); gl.uniform3fv(gl.getUniformLocation(pp, 'pal'), pal);
    P.sv = gl.createVertexArray(); P.sb = gl.createBuffer();
    gl.bindVertexArray(P.sv); gl.bindBuffer(gl.ARRAY_BUFFER, P.sb);
    for (const [loc, size, off] of [[0, 2, 0], [1, 2, 8], [2, 2, 16], [3, 1, 24]]) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, FPV * 4, off); }
    P.pv = gl.createVertexArray(); P.qb = gl.createBuffer(); P.ib = gl.createBuffer();
    gl.bindVertexArray(P.pv); gl.bindBuffer(gl.ARRAY_BUFFER, P.qb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, P.ib);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 20, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 20, 16); gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.clearColor(0, 0, 0, 0);
    cap = 0; capP = 0; upV = 0;
  }
  if (!svg) {
    cv = doc.createElement('canvas');
    cv.className = 'm9-cords';
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:absolute;left:0;top:0;display:block;pointer-events:none;';
    W.viewport.insertBefore(cv, W.el.nextSibling);
    gl = cv.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: GLTEST, powerPreference: 'high-performance' });
    if (!gl) { cv.remove(); cv = null; } else {
      try { glBuild(); } catch (e) { console.error(e); cv.remove(); cv = null; gl = null; }
      if (cv) {
        cv.addEventListener('webglcontextlost', e => { e.preventDefault(); st.lost++; P = null; }, false);
        cv.addEventListener('webglcontextrestored', () => { st.restored++; try { glBuild(); geomV++; drawNow(); } catch (e) { console.error(e); } }, false);
      }
    }
  }
  const mode = svg ? 'svg' : gl ? 'gl' : 'none';
  function resize() { // the drawing buffer = the viewport in device px (allocated while the scene has cords)
    if (!cv) return;
    const w = Math.round(VW * D), hh = Math.round(VH * D);
    if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; cv.style.width = VW + 'px'; cv.style.height = VH + 'px'; }
  }
  // the geometry: the smoothed polyline of every cord as one triangle strip (degenerate joins), the plugs as instances
  function build() {
    const t0 = now(), n = cords.size, need = n * (PTS * 2 + 2) * FPV;
    if (strip.length < need) strip = new Float32Array(Math.ceil(need * 1.5));
    const needP = (n * 2 + 4) * 5;
    if (plugs.length < needP) plugs = new Float32Array(Math.ceil(needP * 1.5));
    let k = 0, kp = 0, first = true;
    for (const c of cords.values()) {
      const r = c.r;
      let X = r.X, Y = r.Y;
      if (reduced) { endPos(c.a, E4, 0); endPos(c.b, E4, 2); shown(STUDIO.N, E4[0], E4[1], E4[2], E4[3], sX, sY); X = sX; Y = sY; }
      const m = smooth(X, Y, STUDIO.N, STUDIO.SUB, pts), s = c.id === sel ? 1 : 0;
      for (let i = 0; i < m; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(m - 1, i + 1);
        let tx = pts[2 * i1] - pts[2 * i0], ty = pts[2 * i1 + 1] - pts[2 * i0 + 1];
        const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
        if (!first && i === 0) { strip.copyWithin(k, k - FPV, k); k += FPV; } // (the degenerate join: the last vertex again …)
        strip[k++] = pts[2 * i]; strip[k++] = pts[2 * i + 1]; strip[k++] = -ty; strip[k++] = tx; strip[k++] = -1; strip[k++] = c.c; strip[k++] = s;
        if (!first && i === 0) { strip.copyWithin(k, k - FPV, k); k += FPV; } // (… and this one twice)
        strip[k++] = pts[2 * i]; strip[k++] = pts[2 * i + 1]; strip[k++] = -ty; strip[k++] = tx; strip[k++] = 1; strip[k++] = c.c; strip[k++] = s;
      }
      first = false;
      endPos(c.a, E4, 0); endPos(c.b, E4, 2);
      for (let e = 0; e < 4; e += 2) { plugs[kp++] = E4[e]; plugs[kp++] = E4[e + 1]; plugs[kp++] = c.c; plugs[kp++] = c.s ? 1 : 0; plugs[kp++] = s; }
    }
    if (D_.target) { const j = D_.target; plugs[kp++] = j.mod.m.x + j.bx; plugs[kp++] = j.mod.m.y + j.by; plugs[kp++] = 0; plugs[kp++] = 2; plugs[kp++] = 0; }
    if (probe) { const j = probe.j; plugs[kp++] = j.mod.m.x + j.bx; plugs[kp++] = j.mod.m.y + j.by; plugs[kp++] = 0; plugs[kp++] = 3; plugs[kp++] = 0; }
    nStrip = k / FPV; nPlug = kp / 5;
    st.buildMs += now() - t0;
  }
  let builtV = 0;
  const rebuild = () => { build(); builtV = geomV; };
  function upload() {
    if (builtV === upV || !gl || !P) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, P.sb);
    const bs = nStrip * FPV, bp = nPlug * 5;
    if (bs > cap) { cap = Math.ceil(bs * 1.5); gl.bufferData(gl.ARRAY_BUFFER, cap * 4, gl.DYNAMIC_DRAW); }
    if (bs) gl.bufferSubData(gl.ARRAY_BUFFER, 0, strip, 0, bs);
    gl.bindBuffer(gl.ARRAY_BUFFER, P.ib);
    if (bp > capP) { capP = Math.ceil(bp * 1.5); gl.bufferData(gl.ARRAY_BUFFER, capP * 4, gl.DYNAMIC_DRAW); }
    if (bp) gl.bufferSubData(gl.ARRAY_BUFFER, 0, plugs, 0, bp);
    st.uploads++; st.uploadBytes += (bs + bp) * 4;
    upV = builtV;
  }
  function dirty() { // a change outside a step (a set, a drag's end, a selection): rebuilt, drawn at once at the shown camera
    if (mode === 'gl') { geomV++; rebuild(); if (!running) drawNow(); }
  }
  // one frame of the GL layer at the camera (the world's: from its write(), or the last one shown)
  function draw(cam) {
    if (!gl || !P || dead) return;
    const t0 = now();
    resize();
    if (builtV !== geomV) rebuild();
    upload();
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    U.cam[0] = cam.tx; U.cam[1] = cam.ty; U.cam[2] = cam.k; U.cam[3] = D;
    U.vp[0] = cv.width; U.vp[1] = cv.height; U.vp[3] = 1;
    if (nStrip) {
      gl.useProgram(P.ps); gl.bindVertexArray(P.sv);
      gl.uniform4fv(P.sCam, U.cam);
      U.vp[2] = 0; gl.uniform4fv(P.sVp, U.vp); gl.drawArrays(gl.TRIANGLE_STRIP, 0, nStrip);
      U.vp[2] = 1; gl.uniform4fv(P.sVp, U.vp); gl.drawArrays(gl.TRIANGLE_STRIP, 0, nStrip);
    }
    if (nPlug) {
      gl.useProgram(P.pp); gl.bindVertexArray(P.pv);
      gl.uniform4fv(P.pCam, U.cam); gl.uniform4fv(P.pVp, U.vp);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nPlug);
    }
    gl.bindVertexArray(null);
    const ms = now() - t0;
    st.draws++; st.drawMs += ms; if (ms > st.drawMax) st.drawMax = ms;
    lastCam = { tx: cam.tx, ty: cam.ty, k: cam.k };
    const key = frameKey();
    if (key === drawnKey) { frameDraws++; if (frameDraws === 2) st.dbl++; } else { drawnKey = key; frameDraws = 1; }
    if (probe && probe.on) probeRead(cam);
  }
  const frameKey = () => { try { const t = doc.timeline && doc.timeline.currentTime; return t == null ? -1 : t; } catch (e) { return -1; } };
  const drawNow = () => draw(lastCam || W.cam);
  const camOff = W.on('camera', c => { if (mode === 'gl') draw(c); });
  const onResize = () => { view(); if (mode === 'gl') drawNow(); };
  win.addEventListener('resize', onResize);
  /* ---- the ticker: its own rAF only while a cord is awake, held or in flight (§4.3 keeps one loop: the world's) */
  function kick() { if (running || dead || mode !== 'gl' || reduced) return; running = true; sim.last = now(); sim.acc = 0; st.rafReq++; win.requestAnimationFrame(tick); }
  function tick(t) {
    if (dead) { running = false; return; }
    const t0 = now(), dtMs = t - sim.last, busy = W.busy;
    const hold = HOLD && busy && lastLong;
    if (hold) st.holds++;
    lastLong = dtMs > 24;
    const res = advance(sim, ropes, t, ends, STUDIO.BUDGET, hold);
    if (busy && dtMs > 24 && res.ropeSteps) st.longSteps++;
    st.frames++; st.ropeSteps += res.ropeSteps;
    if (res.awake > st.awakeMax) st.awakeMax = res.awake;
    const sm = now() - t0; st.stepMs += sm; if (sm > st.stepMax) st.stepMax = sm;
    if (res.ropeSteps || D_.on) { geomV++; rebuild(); }
    const c = W.cam, moving = lastCam && (c.tx !== lastCam.tx || c.ty !== lastCam.ty || c.k !== lastCam.k);
    if (!moving && builtV !== upV) drawNow(); // (a camera that moved: the world's write() this frame draws — one draw a frame)
    const tot = now() - t0; st.costs.push(tot); if (tot > st.frameMax) st.frameMax = tot;
    if (st.costs.length > 4000) st.costs.splice(0, 2000);
    let more = D_.on;
    for (let i = 0; i < ropes.length && !more; i++) more = ropes[i].awake || !!ropes[i].grab;
    if (more) { st.rafReq++; win.requestAnimationFrame(tick); } else running = false;
  }
  /* ---- the glue probe: the jack span's rect and the GL pixels (the magenta disc at its anchor) read in the same frame */
  const PR = 28;
  function probeRead(cam) {
    const j = probe.j, r = j.el.getBoundingClientRect(), vr = vpRect();
    const dom = [(r.left + r.width / 2 - vr.left) * D, (r.top + r.height / 2 - vr.top) * D];
    const wx = j.mod.m.x + j.bx, wy = j.mod.m.y + j.by, ex = (wx * cam.k + cam.tx) * D, ey = (wy * cam.k + cam.ty) * D;
    const x0 = Math.round(ex) - PR / 2, y0 = Math.round(ey) - PR / 2;
    if (x0 < 0 || y0 < 0 || x0 + PR > cv.width || y0 + PR > cv.height) return;
    const b = new Uint8Array(PR * PR * 4);
    gl.readPixels(x0, cv.height - y0 - PR, PR, PR, gl.RGBA, gl.UNSIGNED_BYTE, b);
    let n = 0, sx = 0, sy = 0;
    for (let yy = 0; yy < PR; yy++) for (let xx = 0; xx < PR; xx++) {
      const i = (yy * PR + xx) * 4;
      if (b[i] > 180 && b[i + 2] > 180 && b[i + 1] < 100) { n++; sx += x0 + xx + 0.5; sy += y0 + (PR - 1 - yy) + 0.5; }
    }
    if (!n) { probe.out.push({ busy: W.busy, k: r3(cam.k), miss: true }); return; }
    const gx = sx / n, gy = sy / n;
    probe.out.push({ busy: W.busy, k: r3(cam.k), err: Math.hypot(gx - dom[0], gy - dom[1]), math: Math.hypot(ex - dom[0], ey - dom[1]), n });
  }
  /* ---- the SVG fallback (m13s): the lab's strokes over the parabola, plugs as circles; re-pathed on anchor changes */
  let SV = null;
  if (svg) {
    const NS = 'http://www.w3.org/2000/svg', root = doc.createElementNS(NS, 'svg');
    root.setAttribute('class', 'm9-cords-svg');
    root.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none;z-index:10001;';
    const g0 = doc.createElementNS(NS, 'g'); root.append(g0); W.el.append(root);
    const els = new Map(), X = new Float64Array(STUDIO.N), Y = new Float64Array(STUDIO.N), Pp = new Float64Array(PTS * 2);
    const mk = (tag, at) => { const e = doc.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, String(at[k])); return e; };
    SV = {
      root,
      add(c) {
        const col = PALETTE[c.c], g = mk('g', {});
        const p = [mk('path', { fill: 'none', stroke: 'rgba(0,0,0,0.32)', 'stroke-width': 11.2, 'stroke-linecap': 'round', transform: 'translate(4 8)' }),
          mk('path', { fill: 'none', stroke: rgbStr(shadeHex(col, -0.45)), 'stroke-width': 11.2, 'stroke-linecap': 'round' }),
          mk('path', { fill: 'none', stroke: col, 'stroke-width': 7.8, 'stroke-linecap': 'round' }),
          mk('path', { fill: 'none', stroke: rgbStr(shadeHex(col, 0.45)), 'stroke-opacity': 0.55, 'stroke-width': 2.2, 'stroke-linecap': 'round', transform: 'translate(-1.68 -1.96)' })];
        const plug = () => [mk('circle', { r: 14, fill: 'rgba(0,0,0,0.35)' }), mk('circle', { r: 14, fill: rgbStr(shadeHex(col, -0.35)) }), mk('circle', { r: 9.8, fill: col }), mk('circle', { r: 3.4, fill: 'rgba(255,255,255,0.35)' })];
        const pa = plug(), pb = plug();
        g.append(...p, ...pa, ...pb); g0.append(g);
        els.set(c.id, { g, p, pa, pb });
        SV.path(c);
      },
      remove(id) { const e = els.get(id); if (e) { e.g.remove(); els.delete(id); } },
      path(c) {
        const e = els.get(c.id); if (!e) return;
        endPos(c.a, E4, 0); endPos(c.b, E4, 2);
        shown(STUDIO.N, E4[0], E4[1], E4[2], E4[3], X, Y);
        const m = smooth(X, Y, STUDIO.N, STUDIO.SUB, Pp);
        let d = 'M' + Pp[0].toFixed(1) + ' ' + Pp[1].toFixed(1);
        for (let i = 1; i < m; i++) d += 'L' + Pp[2 * i].toFixed(1) + ' ' + Pp[2 * i + 1].toFixed(1);
        for (const p of e.p) p.setAttribute('d', d);
        const place = (L, x, y) => { L[0].setAttribute('cx', x + 3); L[0].setAttribute('cy', y + 4); L[1].setAttribute('cx', x); L[1].setAttribute('cy', y); L[2].setAttribute('cx', x); L[2].setAttribute('cy', y); L[3].setAttribute('cx', x - 3); L[3].setAttribute('cy', y - 3); };
        place(e.pa, E4[0], E4[1]); place(e.pb, E4[2], E4[3]);
        e.p[1].setAttribute('stroke', c.id === sel ? '#f4f4f4' : rgbStr(shadeHex(PALETTE[c.c], -0.45)));
      },
    };
  }
  /* ---- the API */
  const api = {
    mode, el: cv || (SV && SV.root),
    set(listIn) { for (const c of listIn) addCord(Object.assign({}, c, { a: Object.assign({}, c.a), b: Object.assign({}, c.b) }), false); dirty(); },
    add(c, awake = true) { addCord(c, awake); dirty(); kick(); return c; },
    remove(id) { const c = cords.get(id); if (!c) return null; cords.delete(id); relist(); if (SV) SV.remove(id); if (sel === id) sel = null; geomV++; dirty(); return c; },
    get: id => cords.get(id) || null, all: () => [...cords.values()],
    plugAt(j) { for (const c of cords.values()) for (const e of ['a', 'b']) if (!c[e].free && c[e].m === j.mod.key && c[e].j === j.id) return { c, end: e }; return null; },
    wake(c) { if (c && c.r) { c.r.awake = true; c.r.quiet = 0; } if (SV && c) SV.path(c); geomV++; kick(); },
    kick, endPos: e => { endPos(e, E4, 0); return { x: E4[0], y: E4[1] }; },
    moved(rec, ph) { // a module moved (a drag's frame, a drop, a nudge): its cords' anchors follow (the next frame sweeps them)
      if (SV) { for (const c of cords.values()) if (c.a.m === rec.key || c.b.m === rec.key) SV.path(c); return; }
      kick();
    },
    pathAll() { if (SV) for (const c of cords.values()) SV.path(c); },
    pluck(id, i0, amp = 9) { const c = cords.get(id); if (!c || SV) return; pluck(c.r, i0, amp); kick(); },
    pluckAll(rnd) { if (SV) return; for (const c of cords.values()) pluckLab(c.r, rnd); kick(); },
    grab(id, i, p) { const c = cords.get(id); if (!c || SV) return; c.r.grab = { i, x: p.x, y: p.y }; c.r.awake = true; kick(); },
    grabMove(id, p) { const c = cords.get(id); if (c && c.r.grab) { c.r.grab.x = p.x; c.r.grab.y = p.y; kick(); } },
    release(id) { const c = cords.get(id); if (c) { c.r.grab = null; kick(); } },
    hit(x, y, rad) { // the top-most cord within rad world px of (x, y): { id, i (the nearest rope point), t }
      let best = null;
      for (const c of [...cords.values()].reverse()) {
        let X = c.r.X, Y = c.r.Y;
        if (SV || reduced) { endPos(c.a, E4, 0); endPos(c.b, E4, 2); shown(STUDIO.N, E4[0], E4[1], E4[2], E4[3], sX, sY); X = sX; Y = sY; }
        const m = smooth(X, Y, STUDIO.N, STUDIO.SUB, pts), nn = nearestOnPolyline(pts, m, x, y);
        if (nn.d <= rad && (!best || nn.d < best.d - 1e-9)) best = { id: c.id, d: nn.d, t: nn.t, i: Math.max(1, Math.min(STUDIO.N - 2, Math.round(nn.t * (STUDIO.N - 1)))) };
      }
      return best;
    },
    sel(id) { sel = id; if (SV) { for (const c of cords.values()) SV.path(c); return; } geomV++; dirty(); },
    get selected() { return sel; },
    probeOn(j, on, shot) { probe = on && j ? { j, on: !shot, out: probe && probe.j === j ? probe.out : [] } : null; geomV++; dirty(); return probe; }, // (shot: the disc only, no readPixels)
    probeTake() { const p = probe; if (!p) return []; const o = p.out.splice(0); return o; },
    redraw: dirty,
    stats(reset) {
      const c = st.costs.slice().sort((a, b) => a - b), at = p => r3(c.length ? c[Math.min(c.length - 1, Math.floor(c.length * p))] : 0);
      const out = { mode, cords: cords.size, awake: [...cords.values()].filter(x => x.r.awake).length, ticks: st.frames, ropeSteps: st.ropeSteps, perFrame: st.frames ? r1(st.ropeSteps / st.frames) : 0,
        stepMs: st.frames ? r3(st.stepMs / st.frames) : 0, stepMax: r3(st.stepMax), buildMs: r3(st.buildMs), frameMed: at(0.5), frameP95: at(0.95), frameMax: r3(st.frameMax),
        awakeMax: st.awakeMax, uploads: st.uploads, uploadKB: r1(st.uploadBytes / 1024), draws: st.draws, drawMs: st.draws ? r3(st.drawMs / st.draws) : 0, drawMax: r3(st.drawMax),
        dbl: st.dbl, longSteps: st.longSteps, holds: st.holds, rafReq: st.rafReq, lost: st.lost, restored: st.restored,
        bytes: (cv ? cv.width * cv.height * 4 : 0) + (cap + capP) * 4, buffer: cv ? cv.width + '×' + cv.height : null };
      if (reset) { Object.assign(st, { draws: 0, drawMs: 0, drawMax: 0, uploads: 0, uploadBytes: 0, frames: 0, ropeSteps: 0, stepMs: 0, stepMax: 0, buildMs: 0, frameMax: 0, awakeMax: 0, dbl: 0, longSteps: 0, holds: 0, costs: [] }); }
      return out;
    },
    rafReq: () => st.rafReq, running: () => running,
    destroy() {
      dead = true; camOff(); win.removeEventListener('resize', onResize);
      if (gl) { try { const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) { /* gone */ } }
      if (cv) { cv.width = 0; cv.height = 0; cv.remove(); }
      if (SV) SV.root.remove();
      cords.clear(); ropes = [];
    },
    lose() { if (gl) { const x = gl.getExtension('WEBGL_lose_context'); if (x) { x.loseContext(); setTimeout(() => x.restoreContext(), 300); } } }, // (a test hook)
  };
  if (mode === 'gl') { resize(); drawNow(); }
  return api;
}

/* ------------------------------------------------------------------------------------------------ patching by hand (the prototype) */
// a press on a cord jack comes through the world's jack hook (cv-world offers [data-cv-jack] presses first; a second finger
// cancels through jackStop): a new cord from an empty jack, a plugged one's plug pulled; the drag's free end follows the finger,
// the nearest compatible empty jack within SNAP_PX screen px is the target (its name in the chip), release there → plug /
// re-patch, elsewhere → a new cord vanishes, a pulled one comes out ("tap to undo"). Below READ_K the jacks sleep (CSS: a press
// pans). A cord's body takes no press at all (the layer is pointer-events: none and nothing listens for it): the ends only
const D_ = { on: false, target: null };
let HOOK = null, CHIP = null, NOTE = null, EVENTS = [];
const logEv = (type, o) => { EVENTS.push(Object.assign({ type, t: Math.round(now()) }, o || {})); if (EVENTS.length > 400) EVENTS.shift(); if (ON_EVENT) ON_EVENT(type, o || {}); };
let ON_EVENT = null;
function installInput() {
  // the world's jack hook, kept: the app (re)installs its cable drag with setJackHook at every track render — that one stays the
  // fallback for every other jack, a cord jack's press is ours (a getter / setter on the hooks object: the page only)
  const H = A.W.hooks, prev = { jack: H.jack, cancel: H.jackCancel };
  const mine = (e, je) => (je && je.getAttribute('data-kind') === 'cord' ? jackPress(e, je) : prev.jack ? prev.jack(e, je) : false);
  const myCancel = () => { if (DRG) dragEnd(true); else if (prev.cancel) prev.cancel(); };
  Object.defineProperty(H, 'jack', { configurable: true, enumerable: true, get: () => mine, set: f => { prev.jack = f; } });
  Object.defineProperty(H, 'jackCancel', { configurable: true, enumerable: true, get: () => myCancel, set: f => { prev.cancel = f; } });
  HOOK = prev;
  CHIP = A.doc.createElement('div'); CHIP.className = 'm9-chip'; CHIP.hidden = true; A.doc.body.append(CHIP);
  NOTE = A.doc.createElement('div'); NOTE.className = 'm9-note'; NOTE.hidden = true; A.doc.body.append(NOTE);
}
const jackOfEl = el => { const S = S0.cur; if (!S || !el) return null; const [mid, jid] = String(el.getAttribute('data-cv-jack')).split(/\.(?=[^.]+$)/); const r = S.byId.get(mid); return r ? r.jacks.get(jid) || null : null; };
const jwp = j => ({ x: j.mod.m.x + j.bx, y: j.mod.m.y + j.by });
const label = j => j.mod.spec.title + ' · ' + j.label;
function canPlug(cords, from, j, self) { // from: the fixed end's jack (or null); j: a candidate; self: the end being moved (its own jack is fine)
  if (!j || (from && (j === from || j.dir === from.dir || j.sig !== from.sig))) return false;
  const p = cords.plugAt(j);
  return !p || (self && p.c === self.c && p.end === self.end);
}
let DRG = null;
function jackPress(e, je) {
  const S = S0.cur, j = jackOfEl(je);
  if (!S || !S.cords || !j || A.W.k < READ_K - 1e-9 || DRG) return false;
  DRG = { id: e.pointerId, type: e.pointerType || 'mouse', x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, j, started: false, S };
  const d = A.doc;
  DRG.offs = [['pointermove', dragMove], ['pointerup', dragUp], ['pointercancel', dragCancelEv]].map(([t, f]) => { d.addEventListener(t, f, true); return () => d.removeEventListener(t, f, true); });
  DRG.offs.push(A.W.on('camera', () => { if (DRG && DRG.started) dragFollow(); }));
  return { cancel: () => dragEnd(true) };
}
function dragMove(e) {
  const G = DRG; if (!G || e.pointerId !== G.id) return;
  G.x = e.clientX; G.y = e.clientY;
  if (!G.started) {
    if (Math.hypot(G.x - G.x0, G.y - G.y0) <= (G.type === 'touch' ? TAP_TOUCH : TAP_MOUSE)) return;
    G.started = true;
    const C = G.S.cords, p = C.plugAt(G.j), w = A.W.toWorld(G.x, G.y);
    if (p) { G.c = p.c; G.end = p.end; G.orig = p.c[p.end]; G.from = otherJack(G.S, p.c, p.end); p.c[p.end] = { free: w }; C.wake(p.c); }
    else { G.isNew = true; G.from = G.j; G.c = C.add({ id: 'u' + Math.round(now()) + Math.floor(Math.random() * 1e3), a: { m: G.j.mod.key, j: G.j.id }, b: { free: w }, c: leastColor(C), s: G.j.sig === 's' }, true); G.end = 'b'; }
    D_.on = true;
    for (const r of G.S.mods) for (const j of r.jacks.values()) if (canPlug(C, G.from, j, { c: G.c, end: G.end })) j.el.classList.add('m9-ok');
  }
  dragFollow();
}
function otherJack(S, c, end) { const o = c[end === 'a' ? 'b' : 'a']; if (o.free) return null; const r = S.byKey.get(o.m); return r ? r.jacks.get(o.j) : null; }
function leastColor(C) { const n = PALETTE.map(() => 0); for (const c of C.all()) n[c.c]++; let b = 0; for (let i = 1; i < n.length; i++) if (n[i] < n[b]) b = i; return b; }
function dragFollow() {
  const G = DRG; if (!G || !G.started) return;
  const w = A.W.toWorld(G.x, G.y), C = G.S.cords;
  G.c[G.end] = { free: w };
  let best = null, bd = SNAP_PX / A.W.k;
  for (const r of G.S.mods) for (const j of r.jacks.values()) {
    const p = jwp(j), d = Math.hypot(p.x - w.x, p.y - w.y);
    if (d < bd && canPlug(C, G.from, j, { c: G.c, end: G.end })) { bd = d; best = j; }
  }
  if (best !== G.target) { if (G.target) G.target.el.classList.remove('m9-hot'); G.target = best; if (best) best.el.classList.add('m9-hot'); }
  D_.target = best;
  CHIP.hidden = !best;
  if (best) { CHIP.textContent = label(best); CHIP.style.transform = 'translate(' + Math.round(G.x + 26) + 'px, ' + Math.round(G.y - 54) + 'px)'; }
  try { A.W.dragPointer({ x: G.x, y: G.y, pointerType: G.type }); } catch (e) { /* older world */ }
  C.wake(G.c);
}
function dragUp(e) {
  const G = DRG; if (!G || e.pointerId !== G.id) return;
  if (!G.started) { // a tap on a jack: nothing here (the real build opens the cord's menu on a plug — colour, remove — or "Connect to…")
    logEv('jacktap', { jack: label(G.j), plugged: !!G.S.cords.plugAt(G.j) });
    dragEnd(false); return;
  }
  const C = G.S.cords, t = G.target, release = { x: G.x, y: G.y };
  if (t) {
    G.c[G.end] = { m: t.mod.key, j: t.id };
    logEv(G.isNew ? 'plug' : t === jackOfOrig(G) ? 'back' : 'repatch', { cord: G.c.id, from: G.from ? label(G.from) : null, to: label(t), start: label(G.j), release, k: r3(A.W.k), snapPx: r1(Math.hypot(jwp(t).x - A.W.toWorld(release.x, release.y).x, jwp(t).y - A.W.toWorld(release.x, release.y).y) * A.W.k) });
    C.wake(G.c);
  } else if (G.isNew) { C.remove(G.c.id); logEv('vanish', { start: label(G.j), k: r3(A.W.k) }); }
  else { const c = G.c, orig = G.orig; G.c[G.end] = orig; C.remove(c.id); logEv('pull', { start: label(G.j), k: r3(A.W.k) }); undoNote('Cord pulled out · tap to undo', () => { C.add(c, true); logEv('undo', {}); }); }
  dragEnd(false);
}
const jackOfOrig = G => (G.orig && !G.orig.free ? (G.S.byKey.get(G.orig.m) || { jacks: new Map() }).jacks.get(G.orig.j) : null);
function dragCancelEv(e) { const G = DRG; if (G && e.pointerId === G.id) dragEnd(true); }
function dragEnd(cancel) { // cancel: a new cord vanishes, a pulled plug springs back (two fingers, Escape, a lost lift)
  const G = DRG; if (!G) return;
  DRG = null; D_.on = false; D_.target = null;
  for (const f of G.offs) f();
  if (cancel && G.started) { if (G.isNew) G.S.cords.remove(G.c.id); else { G.c[G.end] = G.orig; G.S.cords.wake(G.c); } logEv('cancel', {}); }
  for (const r of G.S.mods) for (const j of r.jacks.values()) j.el.classList.remove('m9-ok', 'm9-hot');
  CHIP.hidden = true;
  try { A.W.dragPointer(null); } catch (e) { /* older world */ }
  if (G.S.cords) G.S.cords.redraw();
}
let NOTE_T = 0;
function undoNote(text, fn) {
  NOTE.textContent = text; NOTE.hidden = false;
  NOTE.onclick = () => { NOTE.hidden = true; clearTimeout(NOTE_T); fn(); };
  clearTimeout(NOTE_T); NOTE_T = setTimeout(() => { NOTE.hidden = true; }, 5000);
}

/* ------------------------------------------------------------------------------------------------ frames (as m3) */
function recorder() {
  const { win, W } = A, I = win.__m9in, R = { f: [], ev: [], lat: [], disp: [], cams: [], kMin: W.k, kMax: W.k, vv: [1, 1], t0: now() };
  let last = -1, on = true;
  I.on = true; I.q.length = 0; I.maxT = I.touches;
  const vvOf = w => (w.visualViewport ? w.visualViewport.scale : 1);
  const tick = t => {
    if (last >= 0) R.f.push(t - last, t);
    last = t;
    if (I.q.length) { const n = now(); for (let j = 0; j < I.q.length; j += 2) { R.lat.push(n - I.q[j]); R.disp.push(n - I.q[j + 1]); } I.q.length = 0; }
    const v = Math.max(vvOf(window), vvOf(win)), v0 = Math.min(vvOf(window), vvOf(win));
    if (v > R.vv[1]) R.vv[1] = v; if (v0 < R.vv[0]) R.vv[0] = v0;
    if (on) win.requestAnimationFrame(tick);
  };
  win.requestAnimationFrame(tick);
  const offs = [W.on('movestart', () => { R.ev.push(1, now(), W.k); I.maxT = I.touches; }), W.on('cameraend', () => { R.ev.push(2, now(), W.k, I.maxT); }),
    W.on('camera', c => { R.cams.push(now()); if (c.k < R.kMin) R.kMin = c.k; if (c.k > R.kMax) R.kMax = c.k; })];
  return { R, stop() { on = false; I.on = false; for (const f of offs) f(); R.t1 = now(); return R; } };
}
function analyse(R, a = -Infinity, b = Infinity) {
  const bursts = [];
  for (let i = 0; i < R.ev.length;) {
    const type = R.ev[i], t = R.ev[i + 1], k = R.ev[i + 2];
    if (type === 1) { bursts.push({ s: t, e: Infinity, k0: k, k1: k }); i += 3; } else { const Bu = bursts[bursts.length - 1]; if (Bu && Bu.e === Infinity) { Bu.e = t; Bu.k1 = k; Bu.touches = R.ev[i + 3]; } i += 4; }
  }
  const inB = bursts.filter(Bu => Bu.e > a && Bu.s < b);
  const burst = [], first = [], settle = [], rest = [];
  for (const Bu of inB) { Bu.first = []; Bu.settle = []; }
  for (let i = 0; i < R.f.length; i += 2) {
    const dt = R.f[i], t = R.f[i + 1];
    if (t < a || t > b) continue;
    let cls = 'rest';
    for (const Bu of inB) {
      if (t > Bu.s && t <= Bu.s + 100) { cls = 'first'; Bu.first.push(dt); break; }
      if (t > Bu.s && t <= Bu.e) { cls = 'burst'; break; }
      if (t > Bu.e && t <= Bu.e + 800) { cls = 'settle'; Bu.settle.push(dt); }
    }
    (cls === 'first' ? first : cls === 'burst' ? burst : cls === 'settle' ? settle : rest).push(dt);
  }
  const mx = L => (L.length ? r1(Math.max(...L)) : 0);
  const lat = q(R.lat.filter(x => x >= 0 && x < 1000)), disp = q(R.disp.filter(x => x >= 0 && x < 1000));
  return {
    bursts: inB.length, burst: q(burst), first: { max: mx(first), n: first.length, multi: inB.filter(Bu => Bu.first.filter(x => x > 33).length > 1).length, over33: first.filter(x => x > 33).length },
    settle: { max: mx(settle), n: settle.length, multi: inB.filter(Bu => Bu.settle.filter(x => x > 33).length > 1).length, over33: settle.filter(x => x > 33).length },
    rest: q(rest), all: q([...burst, ...first, ...settle, ...rest]), lat: { n: lat.n, med: lat.med, p95: lat.p95, dispMed: disp.med, dispP95: disp.p95 },
  };
}
// IMPL-3 §1.5's pass criteria: P (opt-in) and P+ (on by default)
function verdict(a, o = {}) {
  const lat = a.lat && a.lat.n ? a.lat.p95 : 0, lost = !!o.lost, nb = a.burst.n > 0;
  const Pv = nb && a.burst.med <= 17.5 && a.burst.p95 <= 25 && a.burst.max <= 50 && a.first.max <= 100 && a.settle.max <= 100 && lat <= 40 && !lost;
  const Pp = Pv && a.burst.med <= 17.0 && a.burst.p95 <= 20 && a.burst.max <= 33 && a.first.max <= 80 && a.settle.max <= 80 && !a.first.multi && !a.settle.multi && lat <= 33;
  return !nb ? 'no bursts' : Pp ? 'P+' : Pv ? 'P' : 'fail';
}
async function drive(kind, ms, F = 1.6, every) { // pan: a 300 px sine sweep; zoom: in to F× and back, about the band's centre
  const { W, doc } = A, vp = doc.querySelector('#viewport').getBoundingClientRect(), cx = vp.left + vp.width / 2, cy = vp.top + vp.height / 2;
  const t0 = now(); let lastX = 0, lastK = 1, n = 0;
  while (now() - t0 < ms) {
    await raf();
    const ph = (now() - t0) / ms * 2 * Math.PI;
    if (kind === 'pan') { const x = 300 * Math.sin(ph); W.panBy(x - lastX, 0); lastX = x; }
    else { const k = Math.pow(F, 0.5 - 0.5 * Math.cos(ph)); W.zoomAt(k / lastK, cx, cy); lastK = k; }
    if (every && ++n % every.n === 0) every.f();
  }
}
// a camera with the scene fitted, then the deep zoom's start (fit → 4×) as m3's M0
async function fitScene(S) { A.W.fit({ ids: S.fit, animate: false }); await sleep(400); }
async function m0(S, short) {
  await fitScene(S);
  const rec = recorder(), win = [], out = {};
  const C = S.cords;
  const phase = async (name, run) => {
    const a = now(); try { A.W.glStats(true); } catch (e) { /* 2D */ }
    if (C) C.stats(true);
    await run(); win.push([name, a, now()]);
    const g = A.W.glStats(); if (g) out['gl:' + name] = { n: g.frames, mean: g.frames ? r3(g.ms / g.frames) : 0, max: r2(g.max) };
    if (C) { const s = C.stats(); out['cords:' + name] = { draws: s.draws, drawMs: s.drawMs, drawMax: s.drawMax, uploads: s.uploads, awake: s.awakeMax, dbl: s.dbl }; }
  };
  if (!short) await phase('idle', () => sleep(1000));
  await phase('pan', () => drive('pan', 2000));
  if (!short) await phase('zoom', () => drive('zoom', 2000));
  await phase('settle', () => sleep(900));
  await phase('deep', () => drive('zoom', 3000, 4));
  await phase('deepSettle', () => sleep(900));
  const R = rec.stop();
  for (const [name, a, b] of win) { const x = analyse(R, a, b); out[name] = Object.assign(x.all, { burstMax: x.burst.max, firstMove: x.first.max, settle: x.settle.max, bursts: x.bursts }); delete out[name].over50; }
  const tot = analyse(R);
  out.total = { burst: tot.burst, first: tot.first, settle: tot.settle, verdict: verdict(tot) };
  return out;
}
// the cords awake: plucked every second, the camera still (the per-frame cost with every cord awake), then plucked during a deep
// zoom (25 → 200 %: sim + camera together; one draw a frame; frames over 24 ms with steps) — frames and the layer's stats
async function cordsAwake(S) {
  const C = S.cords; if (!C || C.mode !== 'gl') return null;
  await fitScene(S);
  const R0 = rng(42), out = {};
  C.stats(true);
  const rec = recorder(), a = now();
  for (let i = 0; i < 4; i++) { C.pluckAll(R0); await sleep(1000); }
  out.still = Object.assign({ frames: analyse(rec.R, a, now()).all }, C.stats(true));
  const b = now();
  C.pluckAll(R0);
  await drive('zoom', 3000, 4, { n: 45, f: () => C.pluckAll(R0) });
  await sleep(900);
  const R = rec.stop(), x = analyse(R, b, now());
  out.pinch = Object.assign({ frames: x.all, burst: x.burst, first: x.first.max, settle: x.settle.max, verdict: verdict(x) }, C.stats(true));
  await waitAsleep(C, 6000);
  return out;
}
async function waitAsleep(C, ms) { const t0 = now(); while (now() - t0 < ms && C.running()) await sleep(100); return !C.running(); }
// the glue probe (§5 c): the jack span's DOM centre vs the GL disc at its anchor, read in the same frame (readPixels), mid-pan
// and mid-pinch (and with every cord swinging); `math` is the camera maths alone (the shader's position vs the DOM's)
function probeJack(S) { // an empty jack clear of every cord (its ring stays visible in a screenshot), near the scene's middle
  const C = S.cords, cands = [];
  for (const r of S.mods) for (const j of r.jacks.values()) {
    if (C.plugAt(j)) continue;
    const p = jwp(j), hit = C.hit(p.x, p.y, 34);
    if (!hit) cands.push({ j, p });
  }
  if (!cands.length) return null;
  const xs = S.mods.map(r => r.m.x + r.C.w / 2), ys = S.mods.map(r => r.m.y + r.C.h / 2), cx = xs.reduce((s, v) => s + v, 0) / xs.length, cy = ys.reduce((s, v) => s + v, 0) / ys.length;
  cands.sort((a, b) => Math.hypot(a.p.x - cx, a.p.y - cy) - Math.hypot(b.p.x - cx, b.p.y - cy));
  return cands[0].j;
}
function glueSum(L) {
  const busy = L.filter(x => x.busy && !x.miss), all = L.filter(x => !x.miss), mx = (a, k) => (a.length ? r3(Math.max(...a.map(x => x[k]))) : null);
  return { n: L.length, busy: busy.length, miss: L.filter(x => x.miss).length, maxErr: mx(all, 'err'), maxErrBusy: mx(busy, 'err'), meanErr: all.length ? r3(all.reduce((s, x) => s + x.err, 0) / all.length) : null, maxMath: mx(all, 'math'), kMin: all.length ? Math.min(...all.map(x => x.k)) : null, kMax: all.length ? Math.max(...all.map(x => x.k)) : null, ok: busy.length > 0 && mx(busy, 'err') <= 1 };
}
async function glue(S) {
  const C = S.cords; if (C && C.real) return { note: 'the app\'s own cord layer: the prototype\'s glue probe does not apply' };
  if (!C || C.mode !== 'gl') return S.cords ? { mode: C.mode, note: 'cords in #world (the same transform as the jacks): glued by construction' } : null;
  const j = probeJack(S); if (!j) return { note: 'no clear empty jack' };
  await fitScene(S);
  A.W.setCamera({ tx: A.W.cam.tx, ty: A.W.cam.ty, k: Math.max(0.6, A.W.k) }); await sleep(300);
  const p = jwp(j), vr = vpRect();
  A.W.setCamera({ tx: vr.width / 2 - p.x * A.W.k, ty: vr.height / 2 - p.y * A.W.k, k: A.W.k }); await sleep(300);
  C.probeOn(j, true);
  const out = { jack: label(j) };
  C.probeTake();
  await drive('pan', 1500); await sleep(300); out.pan = glueSum(C.probeTake());
  await drive('zoom', 1500, 2.5); await sleep(300); out.pinch = glueSum(C.probeTake());
  const R0 = rng(7); C.pluckAll(R0);
  await drive('zoom', 1500, 0.5, { n: 30, f: () => C.pluckAll(R0) }); await sleep(300); out.sway = glueSum(C.probeTake());
  C.probeOn(null, false);
  out.ok = !!(out.pan.ok && out.pinch.ok && out.sway.ok);
  await waitAsleep(C, 6000);
  return out;
}
// at rest, every cord asleep: the cord layer's rAF requests (0 is the rule) and the frame's own (the app's loop: informational)
async function rest(S) {
  const C = S.cords;
  if (C) await waitAsleep(C, 6000);
  await sleep(400);
  const I = A.win.__m9in, r0 = I.raf, c0 = C ? C.rafReq() : 0, t0 = now();
  await sleep(2000);
  const dt = (now() - t0) / 1000;
  return { cordRaf: C ? C.rafReq() - c0 : null, frameRafPerSec: r1((I.raf - r0) / dt), awake: C ? C.stats().awake : null };
}
// m13w (§5 b): a module dragged with Snap's 32 px steps (its six cords awake), then all 20 plucked and a pinch 25 → 200 % during
// the sway — frames and the cord layer's stats (no glue probe here: its readPixels syncs the GPU every frame; glue() measures the
// glue mid-sway on its own)
async function wake(S) {
  const C = S.cords, out = {};
  await fitScene(S);
  const r = S.mods.find(x => x.spec.type === (S.D.dragType || '921')), x0 = r.m.x, y0 = r.m.y;
  const six = C.all().filter(c => c.a.m === r.key || c.b.m === r.key).length;
  C.stats(true);
  let rec = recorder(), a = now();
  const steps = [32, 64, 96, 128, 160, 160, 128, 96, 64, 32, 0];
  for (let i = 0; i < steps.length; i++) { r.m.setPos(x0, y0 - steps[i], true); C.moved(r, 'move'); await sleep(110); }
  r.m.setPos(x0, y0, false); C.moved(r, 'end'); A.W.update(r.id);
  await sleep(900);
  out.drag = Object.assign({ cordsOnModule: six, frames: analyse(rec.R, a, now()).all }, C.stats(true));
  rec.stop();
  await waitAsleep(C, 6000);
  rec = recorder(); a = now();
  A.W.setCamera({ tx: A.W.cam.tx, ty: A.W.cam.ty, k: 0.25 }); await fitScene(S);
  const R0 = rng(15);
  C.pluckAll(R0);
  const vp = A.W.viewport.getBoundingClientRect(), cx = vp.left + vp.width / 2, cy = vp.top + vp.height / 2;
  A.W.zoomAt(0.25 / A.W.k, cx, cy); await raf();
  await drive('zoom', 3000, 8, { n: 60, f: () => C.pluckAll(R0) });
  await sleep(900);
  const R = rec.stop(), xx = analyse(R, a, now());
  out.sway = Object.assign({ frames: xx.all, burst: xx.burst, first: xx.first.max, settle: xx.settle.max, verdict: verdict(xx), kRange: [r3(R.kMin), r3(R.kMax)] }, C.stats(true));
  await waitAsleep(C, 6000);
  return out;
}
// M5 (§5 c): a 60 s k-sweep (0.25 ↔ 2, with a pan) on m30, the cords plucked every 2 s — frames, GL bytes, context losses, the
// heartbeat (a tab the OS killed is reported at the next load)
async function m5(S, ms = 60000) {
  const { W, doc } = A, vp = doc.querySelector('#viewport').getBoundingClientRect(), cx = vp.left + vp.width / 2, cy = vp.top + vp.height / 2, C = S.cords;
  const g0 = W.glStats(), lost0 = g0 ? g0.lost || 0 : 0, rec = recorder(), t0 = now(), R0 = rng(3);
  let lastK = W.k, lastX = 0, glMax = 0, heap = 0, lastPl = 0;
  A.W.setCamera({ tx: W.cam.tx, ty: W.cam.ty, k: 1 }); await sleep(200); lastK = W.k;
  if (C) C.stats(true);
  while (now() - t0 < ms) {
    await raf();
    const t = (now() - t0) / 1000, k = 0.25 * Math.pow(8, 0.5 - 0.5 * Math.cos(2 * Math.PI * t / 7.5)), x = 160 * Math.sin(2 * Math.PI * t / 5);
    W.zoomAt(k / lastK, cx, cy); lastK = k; W.panBy(x - lastX, 0); lastX = x;
    if (C && t - lastPl > 2) { lastPl = t; C.pluckAll(R0); }
    if ((t | 0) !== ((t - 0.02) | 0)) { LS.set(HB_KEY, { phase: 'm5 ' + S.id + ' ' + (t | 0) + ' s', mode: MODE, t: Date.now() }); const g = W.glStats(); if (g) glMax = Math.max(glMax, g.bytes || 0); const pm = A.win.performance.memory; if (pm) heap = Math.max(heap, pm.usedJSHeapSize); }
  }
  await sleep(1200);
  const R = rec.stop(), a = analyse(R), g = W.glStats(), cs = C ? C.stats() : null;
  return { ms, frames: a.all, burst: a.burst, glMB: r1(glMax / MiB), glNowMB: g ? r1((g.bytes || 0) / MiB) : null, faces: g ? g.glFaces : null, glLost: g ? (g.lost || 0) - lost0 : null,
    cords: cs ? { lost: cs.lost, restored: cs.restored, frameP95: cs.frameP95, frameMax: cs.frameMax, ropeSteps: cs.ropeSteps, bufMB: r1(cs.bytes / MiB) } : null, heapMB: heap ? r1(heap / MiB) : null };
}
// the scene's self-check: no console error since it began, every stand-in face on the GL path, the cord layer in its mode, no
// context loss, every cord asleep and the layer's ticker stopped at rest
function selfCheck(S, rs) {
  const I = A.win.__m9in, errors = I.errs.slice(S.e0), why = [];
  const notGl = S.D.kind === 'rack' ? S.mods.filter(r => r.m.el.getAttribute('data-cv-face') !== 'gl').map(r => r.key) : [];
  const cs = S.cords ? S.cords.stats() : null, wantMode = S.D.svg || (S.cords && S.cords.real && FOPT.nogl) ? 'svg' : 'gl';
  if (errors.length) why.push(errors.length + ' console errors');
  if (notGl.length) why.push(notGl.length + ' faces not on the GL path');
  if (cs && cs.mode !== wantMode) why.push('cords on ' + cs.mode);
  if (cs && cs.lost) why.push('cord context lost ' + cs.lost + '×');
  const bad55 = S.D.set ? S.mods.filter(r => r.C.problems && r.C.problems.length).map(r => r.key) : []; // (a stand-in layout cv-panel would refuse)
  if (bad55.length) why.push(bad55.length + ' stand-in layouts with validation problems');
  if (S.D.cold && S.cold && S.cold.res && !S.cold.res.ok) why.push('the faces were not all textures in ' + S.cold.res.ms + ' ms');
  if (rs && rs.cordRaf) why.push('the cord layer asked for ' + rs.cordRaf + ' frames at rest');
  return { ok: !why.length, why: why.join('; '), errors: errors.slice(0, 8), notGl };
}

/* ------------------------------------------------------------------------------------------------ results */
function results() { return LS.get(RES_KEY, null) || {}; }
function saveResult(part, data) { const R = results(); R[part] = data; R.kind = KIND; if (!LS.set(RES_KEY, R)) say('Could not keep the results on this device (storage full?) — copy them now'); return R; }
function merged() {
  const R = results(), last = R.cords || R.hand || R.auto || {};
  const out = Object.assign({ kind: KIND, v: 1 }, last.env || {}, { valid: validity(R) }, R);
  delete out.env;
  if (S55) out.decision = decide55(R);
  return out;
}
// IMPL-9b §5's (b2) decision table applied to what this page measured (the lead decides; rows that need stage 9's `ui-m9` — m20 /
// m30 — are named, not computed)
function decide55(R) {
  const hs = (R.hand && R.hand.scenes) || {}, au = (R.auto && R.auto.scenes) || {}, v = k => (hs[k] ? hs[k].verdict : null), out = [];
  const s = v('s55'), w = v('s55w'), h = v('s55h'), g1 = au.s55 && au.s55.glue, g2 = au.s55w && au.s55w.glue;
  const glueOk = [g1, g2].filter(Boolean).every(g => g.ok !== false), glueBad = [g1, g2].some(g => g && g.ok === false);
  if (s == null || w == null) return ['the hand test did not finish: no decision'];
  const heavy = Math.max(...['s55', 's55w'].filter(k => v(k) === 'P+' && hs[k].info).map(k => hs[k].info.paintedVis || 0), 0);
  if (s === 'P+' && w === 'P+' && glueOk) out.push('as contracted: s55 and s55w P+, glue within 1 device px; PT_HEAVY = the largest P+ scene\'s painted count (' + heavy + ' without the face pictures)');
  if (s === 'P' && h === 'P+') out.push('s55 P, s55h P+: the hidden-SVG hygiene for the pm faces joins P9b / U9b');
  if (s === 'fail' || (s !== 'P+' && s !== 'P')) out.push('s55 ' + s + ': if m30 passed in ui-m9, profile the 960 face\'s live layer (its painted elements) and cut it (lamps as one GL quad set?) before U9b; if m20 / m30 already failed, stop (the many-modules question)');
  if (s === 'P+' && w !== 'P+') out.push('s55 P+, s55w ' + w + ': hold the lamp deliveries while the camera moves and draw them solid — re-measure with &lamps=solid&lamphold=1 (the hold rule of I9 §4.3)');
  if (glueBad) out.push('glue fails: ?cords=under becomes the default (the look trade told to the user)');
  if (!out.length) out.push('s55 ' + s + ', s55w ' + w + (h ? ', s55h ' + h : '') + ': no table row fits as it stands — read the numbers');
  return out;
}
// IMPL-3 §1.5's validity, here: hw5 first and last inside its envelope in the hand test (median ≤ 17.5, firstMove / settle ≤ 80,
// the last burst median within 1.0 ms of the first), visualViewport.scale 1, every automatic scene's self-check, one build, not stale
function validity(R) {
  const v = { notes: [] };
  const env = a => a && a.burst.med <= 17.5 && a.first.max <= 80 && a.settle.max <= 80;
  if (R.hand && R.hand.scenes) {
    const hs = R.hand.scenes, A1 = hs.hw5 && hs.hw5.a, A2 = hs['hw5#2'] && hs['hw5#2'].a;
    v.hw5First = !!env(A1); v.hw5Last = !!env(A2); v.drift = A1 && A2 ? r1(A2.burst.med - A1.burst.med) : null;
    v.vvScale1 = Object.values(hs).every(x => !x.vv || (x.vv[0] > 0.99 && x.vv[1] < 1.01));
    v.hand = v.hw5First && v.hw5Last && v.drift != null && Math.abs(v.drift) <= 1.0 && v.vvScale1;
  }
  if (R.auto && R.auto.scenes) {
    v.selfChecks = Object.values(R.auto.scenes).every(s => s.self && s.self.ok);
    if (!v.selfChecks) v.notes.push('self-check failed: ' + Object.entries(R.auto.scenes).filter(([, s]) => !(s.self && s.self.ok)).map(([k, s]) => k + ' (' + (s.self ? s.self.why : 'none') + ')').join(', '));
  }
  if (R.lost && R.lost.length) v.notes.push('tab lost: ' + R.lost.map(x => x.phase).join(', '));
  const parts = [R.auto, R.hand, R.cords].filter(x => x && x.env);
  v.preset = parts.every(x => !x.env.preset || x.env.preset.ok); // ((P) the switches the page was given reached the app frame)
  for (const x of parts) { const n = presetNote(x.env.preset); if (n && !v.notes.includes(n)) v.notes.push(n); }
  v.stale = parts.some(x => x.env.stale);
  v.builds = [...new Set(parts.map(x => x.env.build))];
  if (v.stale) v.notes.push('a part ran on an older build than the deployed one');
  if (v.builds.length > 1) v.notes.push('the parts ran on different builds: ' + v.builds.join(', '));
  return v;
}

/* ------------------------------------------------------------------------------------------------ the three pages */
function frameEl() {
  const f = h('iframe'); f.id = 'm9frame'; f.title = 'SYNTH Canvas';
  f.style.cssText = 'position:fixed;left:0;top:0;height:calc(100% - 112px)';
  return f;
}
function bottomBar() {
  const bar = h('div', 'm9-bar'), kEl = h('div', 'm9-k', '–'), sayEl = h('div', 'm9-say'), btns = h('div', 'm9-row'), st = h('div', 'm9-sub');
  const box = h('div'); box.style.flex = '1'; box.append(sayEl, st);
  bar.append(kEl, box, btns); document.body.append(bar);
  SAY = st;
  return { bar, kEl, sayEl, btns, st };
}
// the first screen: the three steps, which build this page measures (an update not applied: Apply update), a lost tab
async function intro(stepIdx, extra) {
  const c = h('div', 'm9-cover'), d = h('div');
  d.append(h('h1', '', S55 ? 'Stage 9b test: the System 55 set' : 'Stage 9 test: Moog modules and patch cords'));
  const ol = h('ol', 'm9-steps'); STEPS.forEach((s, i) => ol.append(h('li', i === stepIdx ? 'now' : '', s))); d.append(ol);
  if (extra) { const p = h('p'); p.innerHTML = extra; d.append(p); }
  const bl = h('p', '', 'Checking which app build this page measures…'); d.append(bl);
  const b = h('button', 'go', 'Starting the app…'); b.disabled = true; d.append(b);
  c.append(d); document.body.append(c);
  B = await buildInfo();
  bl.textContent = 'Measuring ' + B.note + (B.files ? ' (build ' + B.files + ')' : '') + '.' + (B.stale ? ' A newer build (' + B.deployed + ') is out — tap Apply update first.' : '');
  if (B.stale) { bl.className = 'bad'; const u = h('button', '', 'Apply update'); u.onclick = () => applyUpdate(u); bl.append(' ', u); }
  const hb = LS.get(HB_KEY, null);
  if (hb && hb.phase) {
    const R = results(); R.lost = (R.lost || []).concat([{ phase: hb.phase, mode: hb.mode, at: new Date(hb.t).toISOString() }]); LS.set(RES_KEY, R); LS.del(HB_KEY);
    d.insertBefore(h('p', 'bad', 'The last run stopped without finishing (during “' + hb.phase + '”): the iPad probably closed the tab. That is noted in the results — just carry on.'), b);
  }
  return { c, b, ready(lbl) { b.textContent = lbl; b.disabled = false; return new Promise(r => { b.onclick = () => { audioOn(); c.remove(); r(); }; if (AUTO) { c.remove(); r(); } }); } };
}
async function ensureAudio() {
  if (AUTO) audioOn();
  for (let i = 0; i < 3 && !audioRunning(); i++) {
    await sleep(1500);
    if (audioRunning()) break;
    if (!AUTO && i < 2) await new Promise(r => { const c = h('div', 'm9-cover'), d = h('div'); d.innerHTML = '<p>The sound did not start yet. Tap the button to start it (the test plays a quiet chord loop).</p>'; const b = h('button', 'go', 'Start sound'); b.onclick = () => { audioOn(); c.remove(); r(); }; d.append(b); c.append(d); document.body.append(c); });
  }
  return audioRunning();
}
function copyBox(parent) {
  const row = h('div', 'm9-row'), b = h('button', 'go', 'Copy results'), out = h('textarea'); out.id = 'm9out'; out.readOnly = true;
  b.onclick = async () => { const t = JSON.stringify(merged()); out.value = t; try { await navigator.clipboard.writeText(t); say('Copied — paste it into the chat'); } catch (e) { out.select(); say('Select the text below and copy it'); } };
  const clr = h('button', '', 'Clear stored results'); clr.onclick = () => { if (confirm('Clear the results kept on this device?')) { LS.del(RES_KEY); say('Cleared'); out.value = ''; } };
  row.append(b, clr); parent.append(row, out);
  out.value = JSON.stringify(merged());
  return out;
}
function resultsPanel(btns) {
  const pan = h('div', 'm9-cover'), box = h('div', 'm9-res'); box.style.cssText = 'max-width:none;width:100%;max-height:100%;overflow:auto;text-align:left;background:#0d0e11;border-radius:12px';
  const tbl = h('div'), close = h('button', '', 'Close'); close.onclick = () => { pan.hidden = true; };
  box.append(close, tbl); copyBox(box); pan.append(box); pan.hidden = true; document.body.append(pan);
  const b = h('button', '', 'Results'); b.onclick = () => { const o = box.querySelector('#m9out'); if (o) o.value = JSON.stringify(merged()); draw(tbl, results()); pan.hidden = false; }; btns.append(b);
  return { tbl, show() { pan.hidden = false; } };
}
function draw(el, R) { // the summary: per scene the scripted frames, the cords, the glue; the hand verdicts; the plugs
  let t = '<table><tr><th>scene</th><th>self-check</th><th>painted · modules · faces</th><th>pan med/p95/max</th><th>deep</th><th>first / settle</th><th>M0</th><th>cords awake: frame ms p95 / max</th><th>glue max px</th></tr>';
  for (const [k, s] of Object.entries((R.auto && R.auto.scenes) || {})) {
    if (s.cold) { // (s55c: the load is the measure)
      const c = s.cold;
      t += '<tr><td>' + k + '</td><td class="' + (s.self.ok ? 'ok' : 'bad') + '">' + (s.self.ok ? 'ok' : s.self.why) + '</td><td>' + s.info.painted + ' · ' + s.info.modules + ' · ' + s.info.glFaces + '</td><td colspan="6">cold load: every face a texture in '
        + c.ms + ' ms · worst frame ' + c.frames.max + ' ms (' + c.frames.over33 + ' over 33) · ' + c.paints + ' paints (' + c.paintMs + ' ms, longest ' + c.paintMax + ' ms)</td><td>–</td></tr>';
      continue;
    }
    const m = s.m0, f = x => (x ? x.med + ' / ' + x.p95 + ' / ' + x.max : '–'), cw = s.awake && s.awake.still, gl = s.glue;
    t += '<tr><td>' + k + '</td><td class="' + (s.self.ok ? 'ok' : 'bad') + '">' + (s.self.ok ? 'ok' : s.self.why) + '</td><td>' + s.info.painted + ' · ' + s.info.modules + ' · ' + s.info.glFaces + '</td><td>' + f(m.pan) + '</td><td>' + f(m.deep)
      + '</td><td>' + Math.max(m.pan.firstMove, m.deep.firstMove) + ' / ' + Math.max(m.settle.settle, m.deepSettle.settle) + '</td><td>' + m.total.verdict + '</td><td>' + (cw ? (cw.frameP95 != null ? cw.frameP95 + ' / ' + cw.frameMax : 'step ' + r3(cw.stepMs) + ' ms · ' + cw.perf + ' (the app\'s layer)') : '–') + '</td><td>' + (gl && gl.pan ? Math.max(gl.pan.maxErr || 0, gl.pinch.maxErr || 0, gl.sway.maxErr || 0) : '–') + '</td></tr>';
  }
  t += '</table>';
  const pe = [R.auto, R.hand, R.cords].map(x => x && x.env && x.env.preset).find(x => x); // ((P) the preset the app frame ran, and a switch that did not reach it)
  if (pe) t += '<p' + (pe.ok ? '' : ' class="bad"') + '>App frame: preset ' + (pe.world || '?') + (pe.asked ? ' (asked ' + pe.asked + ')' : '') + (pe.texSide ? ' · texture side ' + pe.texSide + (pe.texmaxAsked ? ' (texmax ' + pe.texmaxAsked + ')' : '') : '') + (pe.faceBudget ? ' · face budget ' + Math.round(pe.faceBudget / 1e6) + ' MB' : '') + (pe.ok ? '' : ' — ' + presetNote(pe)) + '</p>';
  if (R.hand && R.hand.scenes) t += '<p>Hand test: ' + Object.entries(R.hand.scenes).map(([k, x]) => k + ' <b>' + x.verdict + '</b>').join(' · ') + '</p>';
  if (S55 && R.hand && R.hand.scenes) t += '<p>' + decide55(R).join('<br>') + '</p>';
  if (R.cords && R.cords.plugs) t += '<p>Plugs at 60 %: ' + R.cords.plugs.misses + ' missed of ' + R.cords.plugs.trials.length + '</p>';
  el.innerHTML = t;
}
if (IS_PAGE) window.__m9 = { state: 'loading', result: null, A, S0, merged: () => merged(), STUDIO, glueShot: null };
const FN = () => ({ build, teardown, m0, cordsAwake, glue, rest, wake, m5, sceneInfo, selfCheck, probeJack, label, jwp, audioOn, glueShot, targets, c55, list55 });
// (the Mac's CDP harness) the screenshot glue (G1's method): a cyan ring in #world (the DOM, under the cord canvas) around an
// empty jack and the magenta disc the cord layer draws at its anchor; analyse(png) finds both centroids in one screenshot —
// the composited frame — in device px (the screenshot's)
const glueShot = {
  arm(S) {
    const j = probeJack(S); if (!j) return null;
    const p = jwp(j), d = A.doc.createElement('div');
    d.className = 'm9-ring'; d.style.left = (p.x - 21) + 'px'; d.style.top = (p.y - 21) + 'px'; d.style.width = '42px'; d.style.height = '42px';
    A.W.el.append(d); glueShot.el = d; glueShot.j = j;
    S.cords.probeOn(j, true, true);
    return { jack: label(j), world: p, client: A.W.toClient(p.x, p.y) };
  },
  disarm(S) { if (glueShot.el) glueShot.el.remove(); glueShot.el = null; if (S && S.cords) S.cords.probeOn(null, false); },
  async analyse(b64) {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const D = g.getImageData(0, 0, c.width, c.height).data, cy = [0, 0, 0], mg = [0, 0, 0];
    for (let i = 0, n = c.width * c.height; i < n; i++) {
      const r = D[4 * i], gg = D[4 * i + 1], b = D[4 * i + 2], x = i % c.width + 0.5, y = Math.floor(i / c.width) + 0.5;
      if (r < 90 && gg > 190 && b > 190) { cy[0]++; cy[1] += x; cy[2] += y; }
      else if (r > 180 && gg < 100 && b > 180) { mg[0]++; mg[1] += x; mg[2] += y; }
    }
    const C = cy[0] ? { n: cy[0], x: cy[1] / cy[0], y: cy[2] / cy[0] } : null, M = mg[0] ? { n: mg[0], x: mg[1] / mg[0], y: mg[2] / mg[0] } : null;
    return { cyan: C, magenta: M, err: C && M ? r3(Math.hypot(C.x - M.x, C.y - M.y)) : null, w: c.width, h: c.height };
  },
};
// (the harness) client points for the scripted touches: an empty jack pair on screen, a plugged plug and an empty target near it,
// a spot away from every jack, a point on a cord over a background, a module's bar, a background point, a knob
function targets(S, kind) {
  const W = A.W, vr = vpRect(), on = p => { const c = W.toClient(p.x, p.y); return c.x > vr.left + 30 && c.x < vr.right - 30 && c.y > vr.top + 30 && c.y < vr.bottom - 30 ? c : null; };
  const J = []; if (S && S.mods) for (const r of S.mods) for (const j of r.jacks.values()) J.push(j);
  const bgAt = (x, y) => { const t = A.doc.elementFromPoint(x, y); return !!t && (t === W.viewport || t === W.el || A.MOD.isBackground(t)); };
  if (kind === 'pair') { for (const a of J) { if (a.dir !== 'out' || S.cords.plugAt(a) || !on(jwp(a))) continue; for (const b of J) if (b.dir === 'in' && b.mod !== a.mod && b.sig === a.sig && !S.cords.plugAt(b) && on(jwp(b)) && Math.hypot(jwp(a).x - jwp(b).x, jwp(a).y - jwp(b).y) < 500) return { from: on(jwp(a)), to: on(jwp(b)), a: label(a), b: label(b) }; } return null; }
  if (kind === 'repatch') { for (const j of J) { const p = S.cords.plugAt(j); if (!p || !on(jwp(j))) continue; const other = otherJack(S, p.c, p.end); for (const t of J) if (t !== j && canPlug(S.cords, other, t, p) && on(jwp(t)) && Math.hypot(jwp(t).x - jwp(j).x, jwp(t).y - jwp(j).y) < 400) return { from: on(jwp(j)), to: on(jwp(t)), a: label(j), b: label(t) }; } return null; }
  if (kind === 'pull') { for (const j of J) { if (!S.cords.plugAt(j) || !on(jwp(j))) continue; const c = on(jwp(j)); for (const [dx, dy] of [[0, -160], [160, 0], [-160, 0], [0, 160], [220, -120]]) { const x = c.x + dx, y = c.y + dy, w = W.toWorld(x, y); if (x > vr.left + 20 && x < vr.right - 20 && y > vr.top + 20 && y < vr.bottom - 20 && J.every(t => Math.hypot(jwp(t).x - w.x, jwp(t).y - w.y) * W.k > 60)) return { from: c, to: { x, y }, a: label(j) }; } } return null; }
  if (kind === 'cord') { for (const c of S.cords.all()) for (let t = 0.3; t <= 0.7; t += 0.05) { const r = c.r, i = Math.round(t * (r.n - 1)), p = on({ x: r.X[i], y: r.Y[i] }); if (p && bgAt(p.x, p.y)) { const w = W.toWorld(p.x, p.y), h = S.cords.hit(w.x, w.y, HIT_PX / W.k); if (h && h.id === c.id) return { at: p, id: c.id }; } } return null; }
  if (kind === 'bar') { for (const r of [...(S.mods || [])].sort((x, y) => (x.spec.row === 1 ? 0 : 1) - (y.spec.row === 1 ? 0 : 1))) { const b = r.m.bar.getBoundingClientRect(); const x = b.left + 14, y = b.top + b.height / 2; if (x > vr.left + 20 && x < vr.right - 120 && y > vr.top + 20 && y < vr.bottom - 120) return { at: { x, y }, mod: r.spec.title }; } return null; }
  if (kind === 'bg') { for (let y = vr.top + 60; y < vr.bottom - 60; y += 37) for (let x = vr.left + 60; x < vr.right - 60; x += 41) if (bgAt(x, y) && !(S && S.cords && S.cords.hit(W.toWorld(x, y).x, W.toWorld(x, y).y, 40 / W.k))) return { at: { x, y } }; return null; }
  if (kind === 'knob') { for (const k of A.W.el.querySelectorAll('.hw-c .knob')) { const b = k.getBoundingClientRect(); const x = b.left + b.width / 2, y = b.top + b.height / 2; if (b.width > 8 && x > vr.left + 40 && x < vr.right - 40 && y > vr.top + 80 && y < vr.bottom - 80 && A.doc.elementFromPoint(x, y) && k.contains(A.doc.elementFromPoint(x, y))) return { at: { x, y } }; } return null; }
  return null;
}

/* ---- step 1: the automatic runs */
async function pageAuto() {
  document.body.classList.add('m9-full');
  const frame = frameEl(); document.body.append(frame);
  const ui = bottomBar(), go = h('button', 'go', 'Start'), next = h('a');
  next.href = location.pathname + '?m9=1' + (S55 ? '&s55=1' + KEEP55 : '') + KEEP_F + '&hand=1'; next.textContent = 'Next: step 2 →'; next.style.cssText = 'color:#8cb8ff;font-weight:600;font-size:19px'; next.hidden = true;
  ui.btns.append(go); const RP = resultsPanel(ui.btns); ui.btns.append(next);
  go.disabled = true;
  ui.sayEl.innerHTML = S55 ? 'Step 1 of 2 — <b>System 55: automatic runs</b> (about 5 minutes). Hands off until the bar says Done.' : 'Step 1 of 3 — <b>automatic runs</b> (about 7 minutes). Hands off until the bar says Done.';
  const I0 = await intro(0, S55 ? 'This is the <b>new part only</b> (the System 55 set: its 38 faces loading, then at rest, then with its cords and sequencer lamps moving). Before you start: <b>plug the iPad in</b>, hold it the same way for both steps, close the other apps and keep this tab in front. Your project in the app is not changed: the test works on a copy that is never saved.'
    : 'Before you start: <b>plug the iPad in</b>, hold it the same way for all three steps, close the other apps and keep this tab in front. Your project in the app is not changed: the test works on a copy that is never saved.');
  say('Starting the app…');
  try { await boot(frame); } catch (e) { say('The app did not start: ' + e.message); window.__m9.state = 'error'; return; }
  A.W.on('camera', c => { ui.kEl.textContent = Math.round(c.k * 100) + ' %'; });
  window.__m9.state = 'ready'; window.__m9.fn = FN();
  const run = async () => {
    go.disabled = true;
    audioOn();
    const out = { env: envInfo(), scenes: {}, order: [] };
    const hb = setInterval(() => LS.set(HB_KEY, { phase: 'auto ' + (S0.cur ? S0.cur.id : ''), mode: MODE, t: Date.now() }), 1000);
    window.__m9.state = 'running';
    try {
      if (!(await ensureAudio())) out.audio = 'not running';
      const order = AUTO_ORDER.filter(id => !ONLY || ONLY.includes(id)), seen = {};
      for (let i = 0; i < order.length; i++) {
        const id = order[i], key = seen[id] ? id + '#2' : id; seen[id] = 1;
        ui.sayEl.innerHTML = 'Step 1 of ' + (S55 ? 2 : 3) + ' — automatic runs, hands off. Scene ' + (i + 1) + ' of ' + order.length + ': <b>' + SCENES[id].title + '</b>';
        const S = await build(id);
        out.order.push(key);
        const sc = { title: S.D.title, info: S.info };
        if (S.D.cold) sc.cold = S.cold.res; // (s55c: the load itself was the measure)
        else {
          say(key + ': scripted pan and zoom…'); sc.m0 = await m0(S);
          if (S.cords && S.cords.mode === 'gl') {
            say(key + ': every cord swinging…'); sc.awake = await cordsAwake(S);
            say(key + ': the glue probe…'); sc.glue = await glue(S);
          } else if (S.cords) sc.glue = await glue(S);
          if (S.D.wake) { say(key + ': a module dragged, then every cord plucked during a pinch…'); sc.wake = await wake(S); }
        }
        say(key + ': at rest…'); sc.rest = await rest(S);
        if (id === (S55 ? 's55' : 'm30') && !out.m5) { say('M5: a ' + (S55 ? 30 : 60) + ' s zoom sweep on ' + id + ' with the cords swinging…'); out.m5 = await m5(S, Q.get('m5ms') ? +Q.get('m5ms') : S55 ? 30000 : 60000); }
        if (S.lamps) sc.lamps = S.lamps.stats(); // (the lamps' ticks and writes over the whole scene)
        sc.self = selfCheck(S, sc.rest);
        sc.info.after = sceneInfo(S).cordMB;
        out.scenes[key] = sc;
        await teardown(S);
        saveResult('auto', out);
        draw(RP.tbl, results());
      }
      out.blocked = A.blocked; out.dialogs = A.dialogs.slice(0, 12); out.done = true;
      saveResult('auto', out);
      ui.sayEl.innerHTML = '<b>Step 1 done.</b> Tap <b>Next: step 2</b> (the hand test).';
      say('');
      next.hidden = false;
      window.__m9.result = out; window.__m9.state = 'done';
    } catch (e) {
      console.error(e); say('Stopped: ' + (e && e.message)); out.error = String(e && e.stack || e); saveResult('auto', out); window.__m9.result = out; window.__m9.state = 'error';
      try { await teardown(S0.cur); } catch (x) { /* gone */ }
    } finally { clearInterval(hb); LS.del(HB_KEY); }
  };
  go.onclick = run; go.disabled = false;
  if (AUTO) { I0.c.remove(); if (Q.get('norun') !== '1') run(); return; }
  await I0.ready('Start step 1');
  run();
}

/* ---- step 2: the hand test (IMPL-3 §1.5's M1 protocol, steps ticking themselves off) */
const PROTOCOL = [
  { id: 'slow', say: 'Pinch out to <b>25 %</b> and back to <b>100 %</b> — <b>slowly</b> (about 1.5 s each way)', kind: 'out' },
  { id: 'medium', say: 'Again: <b>25 %</b> and back to <b>100 %</b> — <b>medium</b> (about 0.7 s each way)', kind: 'out' },
  { id: 'fast', say: 'Again: <b>25 %</b> and back to <b>100 %</b> — <b>fast</b> (about 0.3 s each way)', kind: 'out' },
  { id: 'in1', say: 'Pinch in to <b>200 %</b> and back to <b>100 %</b>', kind: 'in' },
  { id: 'in2', say: 'Once more: <b>200 %</b> and back to <b>100 %</b>', kind: 'in' },
  { id: 'pan2', say: 'Pan with <b>two fingers</b>, three times (any direction)', kind: 'pan2', n: 3 },
  { id: 'pan1', say: 'Pan with <b>one finger</b> on a module’s picture or the empty canvas, three times', kind: 'pan1', n: 3 },
  { id: 'knob', say: 'Turn <b>one knob</b> up and down for about 2 seconds', kind: 'knob' },
];
async function pageHand() {
  document.body.classList.add('m9-full');
  const frame = frameEl(); document.body.append(frame);
  const { kEl, sayEl, btns } = bottomBar();
  const bStart = h('button', 'go', 'Start'), bNext = h('button', '', 'Skip step'), bDone = h('button', '', 'Done');
  btns.append(bStart, bNext, bDone); const RP = resultsPanel(btns);
  bStart.disabled = bNext.disabled = bDone.disabled = true;
  sayEl.innerHTML = 'Step 2 of ' + (S55 ? 2 : 3) + ' — <b>the hand test</b>. Starting the app…';
  const I0 = await intro(1, (S55 ? 'Four short scenes (a fifth only if the System 55 stutters). ' : 'Six short scenes (a seventh or eighth only if one stutters). ') + 'For each, the bar at the bottom says what to do — pinch out to 25 % and back, pinch in to 200 % and back, pan with two fingers and with one, turn a knob — with the zoom shown on the left. Steps tick themselves off; tap <b>Skip step</b> if one does not.');
  try { await boot(frame); } catch (e) { sayEl.textContent = 'The app did not start: ' + e.message; return; }
  A.W.on('camera', c => { kEl.textContent = Math.round(c.k * 100) + ' %'; });
  window.__m9.state = 'ready'; window.__m9.fn = FN();
  await I0.ready('Start step 2');
  await ensureAudio();
  const out = { env: envInfo(), scenes: {}, order: [] };
  const order = HAND_ORDER.filter(id => !ONLY || ONLY.includes(id)).slice(), seen = {};
  const hb = setInterval(() => LS.set(HB_KEY, { phase: 'hand ' + (S0.cur ? S0.cur.id : ''), mode: MODE, t: Date.now() }), 1000);
  for (let i = 0; i < order.length; i++) {
    const id = order[i], key = seen[id] ? id + '#2' : id; seen[id] = 1;
    sayEl.innerHTML = 'Scene ' + (i + 1) + ' of ' + order.length + ': building <b>' + SCENES[id].title + '</b>…';
    bStart.disabled = bNext.disabled = bDone.disabled = true;
    const S = await build(id);
    out.order.push(key);
    const r = await handScene(S, i, order.length, { sayEl, bStart, bNext, bDone });
    out.scenes[key] = r;
    // (§5: m30h and m13s are hand-tested only when the others fail P+; the last hw5 stays last)
    const last = order.lastIndexOf('hw5');
    if ((id === 'm20' || id === 'm30') && r.verdict !== 'P+' && !order.includes('m30h')) order.splice(last, 0, 'm30h');
    if ((id === 'm13' || id === 'm13w') && r.verdict !== 'P+' && !order.includes('m13s')) order.splice(order.lastIndexOf('hw5'), 0, 'm13s');
    if ((id === 's55' || id === 's55w') && r.verdict !== 'P+' && !order.includes('s55h')) order.splice(order.lastIndexOf('hw5'), 0, 's55h'); // (stage 9b)
    await teardown(S);
    saveResult('hand', out);
  }
  clearInterval(hb); LS.del(HB_KEY);
  out.done = true; out.dialogs = A.dialogs.slice(0, 12); saveResult('hand', out);
  sayEl.innerHTML = 'Step 2 done. ' + Object.entries(out.scenes).map(([k, x]) => k + ' <b>' + x.verdict + '</b>').join(' · ') + (S55 ? ' — <b>All done — thank you.</b> Tap <b>Results</b>, then <b>Copy results</b> and paste them into the chat.'
    : ' — <a style="color:#8cb8ff;font-size:19px" href="' + location.pathname + '?m9=1&cords=1">Next: step 3, the cords →</a>');
  bStart.hidden = bNext.hidden = bDone.hidden = true;
  if (S55) { RP.show(); draw(RP.tbl, results()); }
  window.__m9.result = out; window.__m9.state = 'done';
}
async function handScene(S, i, n, ui) {
  const { W } = A, vp = W.viewport.getBoundingClientRect();
  const focus = (k = 1) => { // the scene's box, its centre in the middle of the canvas (its top part when tall)
    const rs = S.fit.map(id => W.rectOf(id)).filter(Boolean); if (!rs.length) return;
    const x0 = Math.min(...rs.map(r => r.x)), x1 = Math.max(...rs.map(r => r.x + r.w)), y0 = Math.min(...rs.map(r => r.y)), y1 = Math.max(...rs.map(r => r.y + r.h));
    const cx = (x0 + x1) / 2, cy = Math.min((y0 + y1) / 2, y0 + 400);
    W.setCamera({ tx: vp.width / 2 - cx * k, ty: vp.height / 2 - cy * k, k });
  };
  focus(1);
  await sleep(400);
  ui.sayEl.innerHTML = 'Scene ' + (i + 1) + ' of ' + n + ': <b>' + S.D.title + '</b>. Tap <b>Start</b>, then follow the steps (about 45 s).' + (S.D.wake ? ' The cords keep swinging while you pinch.' : '');
  ui.bStart.disabled = false; ui.bNext.disabled = true; ui.bDone.disabled = true;
  await new Promise(r => { ui.bStart.onclick = r; if (AUTO) r(); });
  ui.bStart.disabled = true; ui.bNext.disabled = false; ui.bDone.disabled = false;
  const rec = recorder(), I = A.win.__m9in, log = [], C = S.cords;
  if (C) C.stats(true);
  let swing = null;
  if (S.D.wake && C) { // (m13w: every cord plucked every 2.5 s, the 921 wiggled up and back every 5 s)
    const R0 = rng(5), r9 = S.mods.find(x => x.spec.type === (S.D.dragType || '921'));
    let k = 0;
    swing = setInterval(() => {
      C.pluckAll(R0);
      if (r9 && ++k % 2 === 0) { const x0 = r9.m.x, y0 = r9.m.y; let s = 0; const st = [32, 64, 96, 64, 32, 0]; const t = setInterval(() => { r9.m.setPos(x0, y0 - st[s], st[s] !== 0); C.moved(r9, 'move'); if (++s >= st.length) { clearInterval(t); A.W.update(r9.id); } }, 100); }
    }, 2500);
    C.pluckAll(R0);
  }
  let step = 0, done = false, st = { kMin: W.k, kMax: W.k, n: 0 }, stepT0 = now();
  const show = () => { const P = PROTOCOL[step]; ui.sayEl.innerHTML = '<span class="m9-sub">Scene ' + (i + 1) + '/' + n + ' · step ' + (step + 1) + '/' + PROTOCOL.length + '</span><br>' + (P ? P.say + (P.n ? ' — ' + st.n + ' of ' + P.n : '') : 'All done — finishing…'); };
  const advance = why => {
    const ev = rec.R.ev, bs = [];
    for (let j = 0, cur = null; j < ev.length;) { if (ev[j] === 1) { cur = [ev[j + 1], ev[j + 2]]; j += 3; } else { if (cur && cur[0] >= stepT0) bs.push([Math.round(ev[j + 1] - cur[0] - 150), r2(cur[1]), r2(ev[j + 2])]); cur = null; j += 4; } }
    log.push({ step: PROTOCOL[step].id, why, t: r1((now() - rec.R.t0) / 1000), kMin: r3(st.kMin), kMax: r3(st.kMax), bursts: bs.slice(0, 8) });
    stepT0 = now();
    step++; st = { kMin: W.k, kMax: W.k, n: 0 };
    if (step < PROTOCOL.length && PROTOCOL[step].kind === 'knob') I.lastKnob = null;
    if (step >= PROTOCOL.length) { done = true; setTimeout(fin, 1500); }
    show();
  };
  const offs = [
    W.on('camera', c => { if (c.k < st.kMin) st.kMin = c.k; if (c.k > st.kMax) st.kMax = c.k; }),
    W.on('cameraend', d => {
      const P = PROTOCOL[step]; if (!P || done) return;
      const k = d.cam.k;
      if (P.kind === 'out' && st.kMin <= 0.3 && k >= 0.9) advance('k');
      else if (P.kind === 'in' && st.kMax >= 1.8 && k <= 1.1) advance('k');
      else if ((P.kind === 'out' || P.kind === 'in') && Math.abs(k - 1) < 0.1) { st.kMin = k; st.kMax = k; }
    }),
  ];
  let gSeen = I.gest.length, kAt = W.k;
  const knobT = setInterval(() => {
    const P = PROTOCOL[step], K = I.lastKnob;
    if (P && P.kind === 'knob' && K && K.moves > 10 && K.t1 - K.t0 > 600) { I.lastKnob = null; advance('knob'); return; }
    while (gSeen < I.gest.length) {
      const G = I.gest[gSeen++], Cs = rec.R.cams;
      let camMoved = false;
      for (let j = Cs.length - 1; j >= 0 && Cs[j] > G.t0; j--) if (Cs[j] <= G.t1 + 100) { camMoved = true; break; }
      if (P && (P.kind === 'pan1' || P.kind === 'pan2') && camMoved && Math.abs(W.k - kAt) < 0.02 && (P.kind === 'pan2' ? G.max === 2 : G.max === 1)) { st.n++; if (st.n >= P.n) advance('pans'); else show(); }
      kAt = W.k;
    }
  }, 200);
  ui.bNext.onclick = () => { if (!done && step < PROTOCOL.length) advance('skipped'); };
  let finish;
  const ended = new Promise(r => { finish = r; });
  function fin() { finish(); }
  ui.bDone.onclick = () => { done = true; fin(); };
  show();
  if (AUTO) window.__m9.hand = { step: () => step, advance, S, n: i + 1 };
  await ended;
  clearInterval(knobT); if (swing) clearInterval(swing); for (const f of offs) f();
  const R = rec.stop(), a = analyse(R), info = sceneInfo(S);
  ui.bNext.disabled = true; ui.bDone.disabled = true;
  return { title: S.D.title, a, verdict: verdict(a), kRange: [r3(R.kMin), r3(R.kMax)], vv: [r3(R.vv[0]), r3(R.vv[1])], steps: log, skipped: log.filter(x => x.why === 'skipped').length,
    secs: r1((R.t1 - R.t0) / 1000), info: { painted: info.painted, paintedVis: info.paintedVis, modules: info.modules, glMB: info.glMB, k: info.k }, cords: C ? C.stats() : null, lamps: S.lamps ? S.lamps.stats() : undefined };
}

/* ---- step 3: the cords (ten named plugs at 60 %, a free play, the feel) */
const PLAY = [
  { id: 'plug', say: '<b>Plug a new cord</b>: press an empty socket and drag to another one, then let go', ev: 'plug' },
  { id: 'repatch', say: '<b>Move a cord</b>: drag a plug from its socket to a different socket', ev: 'repatch' },
  { id: 'pull', say: '<b>Pull a cord out</b>: drag a plug away from the sockets and let go (tap the message to put it back, if you like)', ev: 'pull' },
  { id: 'move', say: '<b>Drag a module</b> by its top bar (the strip with its name) and watch its cords swing', ev: 'modmove' },
  { id: 'pinch', say: '<b>Pinch and pan</b> while the cords swing (the page keeps them swinging): do the plugs stay on their sockets?', ev: 'pinch' },
];
async function pageCords() {
  document.body.classList.add('m9-full');
  const frame = frameEl(); document.body.append(frame);
  const { kEl, sayEl, btns } = bottomBar();
  const bSkip = h('button', '', 'Skip'); btns.append(bSkip); const RP = resultsPanel(btns);
  bSkip.disabled = true;
  sayEl.innerHTML = 'Step 3 of 3 — <b>the cords</b>. Starting the app…';
  const I0 = await intro(2, 'First, ten plugs: the page names two sockets (they glow blue); drag a cord from the first into the second. The zoom stays at 60 %, so the sockets are small — that is the point. Then a short free play, and a question about how the cords feel.');
  try { await boot(frame); } catch (e) { sayEl.textContent = 'The app did not start: ' + e.message; return; }
  A.W.on('camera', c => { kEl.textContent = Math.round(c.k * 100) + ' %'; });
  window.__m9.state = 'ready'; window.__m9.fn = FN();
  await I0.ready('Start step 3');
  await ensureAudio();
  const out = { env: envInfo(), plugs: null, play: null, feel: null };
  const S = await build('m13');
  window.__m9.S = S;
  // part A: ten plugs at k 0.6 onto named jacks (a source and a target near each other: the neighbours a fingertip misses)
  const C = S.cords, R0 = rng(60), trials = [], pairs = [];
  const all = []; for (const r of S.mods) for (const j of r.jacks.values()) all.push(j);
  for (let t = 0; pairs.length < 10 && t < 5000; t++) {
    const a = all[Math.floor(R0() * all.length)], b = all[Math.floor(R0() * all.length)];
    if (a.dir !== 'out' || b.dir !== 'in' || a.mod === b.mod || a.sig !== b.sig || C.plugAt(a) || C.plugAt(b) || pairs.some(p => p[0] === a || p[1] === b)) continue;
    const d = Math.hypot(jwp(a).x - jwp(b).x, jwp(a).y - jwp(b).y);
    if (d < 120 || d > 520) continue;
    pairs.push([a, b]);
  }
  bSkip.disabled = false;
  for (let i = 0; i < pairs.length; i++) {
    const [a, b] = pairs[i], pa = jwp(a), pb = jwp(b), vr = vpRect(), k = 0.6;
    A.W.setCamera({ tx: vr.width / 2 - (pa.x + pb.x) / 2 * k, ty: vr.height / 2 - (pa.y + pb.y) / 2 * k, k }); await sleep(250);
    a.el.classList.add('m9-name'); b.el.classList.add('m9-name');
    sayEl.innerHTML = '<span class="m9-sub">Plug ' + (i + 1) + ' of ' + pairs.length + '</span><br>Drag a cord from <b>' + label(a) + '</b> into <b>' + label(b) + '</b> (both glow blue)';
    const res = await new Promise(r => {
      bSkip.onclick = () => r({ skipped: true });
      ON_EVENT = (type, o) => { if (type === 'plug' || type === 'vanish') r(Object.assign({ type }, o)); };
      if (AUTO) window.__m9.trial = { a, b, i, from: A.W.toClient(pa.x, pa.y), to: A.W.toClient(pb.x, pb.y), k };
    });
    ON_EVENT = null;
    a.el.classList.remove('m9-name'); b.el.classList.remove('m9-name');
    const ends2 = [res.start, res.to].sort().join('|'), ok = !res.skipped && res.type === 'plug' && ends2 === [label(a), label(b)].sort().join('|');
    trials.push({ i, from: label(a), to: label(b), got: res.to || null, start: res.start || null, type: res.skipped ? 'skipped' : res.type, ok, snapPx: res.snapPx, k: res.k });
    // (the cord just made comes out again: the next pair starts on the same patch)
    if (res.type === 'plug' && res.cord) C.remove(res.cord);
    sayEl.innerHTML = ok ? '<b class="ok">Plugged in the right socket.</b>' : res.skipped ? 'Skipped.' : '<b class="warn">That went to ' + (res.to || 'nowhere') + '.</b> No problem — this is what we are measuring.';
    await sleep(900);
  }
  out.plugs = { k: 0.6, trials, misses: trials.filter(x => !x.ok && x.type !== 'skipped').length, skipped: trials.filter(x => x.type === 'skipped').length };
  saveResult('cords', out);
  // part B: the free play (each item ticks itself off; the app's camera is the user's): the rack framed, never below 60 %
  // (below READ_K the jacks sleep)
  await fitScene(S);
  if (A.W.k < 0.6) { const rs = S.mods.map(r => r.m.rect()), x0 = Math.min(...rs.map(r => r.x)), x1 = Math.max(...rs.map(r => r.x + r.w)), y0 = Math.min(...rs.map(r => r.y)), y1 = Math.max(...rs.map(r => r.y + r.h)), vr = vpRect(); A.W.setCamera({ tx: vr.width / 2 - (x0 + x1) / 2 * 0.6, ty: vr.height / 2 - (y0 + y1) / 2 * 0.6, k: 0.6 }); await sleep(300); }
  const done = {}, ev0 = EVENTS.length;
  let pinched = false;
  const offP = A.W.on('cameraend', () => { if (S.cords && S.cords.stats().awake) pinched = true; });
  for (const P of PLAY) {
    sayEl.innerHTML = '<span class="m9-sub">Free play · ' + (PLAY.indexOf(P) + 1) + ' of ' + PLAY.length + '</span><br>' + P.say;
    let iv = 0;
    const got = await new Promise(r => {
      bSkip.onclick = () => r('skipped');
      ON_EVENT = type => { if (type === P.ev) r('done'); };
      if (P.ev === 'modmove') iv = setInterval(() => { if (S.modMoved) r('done'); }, 200);
      if (P.ev === 'pinch') { const R0 = rng(11); S.cords.pluckAll(R0); let n = 0; iv = setInterval(() => { if (pinched) r('done'); else if (++n % 12 === 0) S.cords.pluckAll(R0); }, 200); } // (the cords plucked by script every 2.4 s: the body takes no touch)
      if (AUTO) window.__m9.play = P.id;
    });
    ON_EVENT = null; clearInterval(iv);
    done[P.id] = got;
    await sleep(500);
  }
  offP();
  if (AUTO) window.__m9.play = null;
  out.play = { done, events: EVENTS.slice(ev0).map(e => ({ type: e.type, k: e.k })), counts: EVENTS.slice(ev0).reduce((m, e) => { m[e.type] = (m[e.type] || 0) + 1; return m; }, {}), cords: S.cords.stats() };
  saveResult('cords', out);
  // part C: the feel (the user's word), then Copy results
  bSkip.hidden = true;
  out.feel = await feelCover();
  saveResult('cords', out);
  await teardown(S);
  sayEl.innerHTML = '<b>All done — thank you.</b> Tap <b>Results</b>, then <b>Copy results</b> and paste them into the chat.';
  RP.show(); draw(RP.tbl, results());
  window.__m9.result = out; window.__m9.state = 'done';
}
function feelCover() {
  return new Promise(res => {
    const c = h('div', 'm9-cover'), d = h('div'), ans = { feel: null, glue: null, note: '' };
    d.append(h('h1', '', 'How do the cords feel?'));
    const row = (q2, opts, k) => { d.append(h('p', '', q2)); const r = h('div', 'm9-feel'); for (const o of opts) { const b = h('button', '', o); b.onclick = () => { ans[k] = o; for (const x of r.children) x.classList.toggle('on', x === b); }; r.append(b); } d.append(r); };
    row('The swing and weight:', ['Just right', 'Too floppy', 'Too stiff', 'Too slow to settle', 'Too jittery'], 'feel');
    row('While you pinched and panned, did the plugs stay on their sockets?', ['Yes, always', 'Mostly', 'No, they lagged or slid'], 'glue');
    d.append(h('p', '', 'Anything else? (optional)'));
    const ta = h('textarea'); d.append(ta);
    const b = h('button', 'go', 'Done'); b.onclick = () => { ans.note = ta.value.slice(0, 600); c.remove(); res(ans); };
    d.append(h('br'), b); c.append(d); document.body.append(c);
    if (AUTO) { window.__m9.feel = v => { Object.assign(ans, v); c.remove(); res(ans); }; }
  });
}

/* ------------------------------------------------------------------------------------------------ entry */
export async function main() {
  chrome();
  try {
    if (MODE === 'hand') await pageHand();
    else if (MODE === 'cords' && !S55) await pageCords();
    else await pageAuto();
  } catch (e) { console.error(e); say('Error: ' + (e && e.message)); window.__m9.state = 'error'; window.__m9.error = String(e && e.stack || e); }
}
