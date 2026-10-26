// cv-cords.js — the patch cords (stage 9, docs/canvas/IMPL-9.md §4.3, §7.4, §12 "Lane C9"; lane C9): the cords of a patched
// instrument drawn over its modules with the cord lab's approved Studio feel (docs/canvas/ref/cord-lab.html, "LAB") — a
// 10-point verlet rope per cord, 1/120 s fixed steps, its ends pinned to the plugs. Generic (D5): no family's name, number or
// constant; a cord is { id, a, b, c, s } — two jack keys, a colour index, s 1 for an S-trigger (Cinch-Jones) plug.
// The user's rule (2026-10-21, §11): a cord's body is not interactive at all — nothing here takes a press (the layer is
//   pointer-events: none; no pluck by hand, no body grab); only the plug ends move, by cv-patch's drag through
//   grab / move / drop (a plugged end pulled) and live (a new cord's free plug).
// Stage WC (docs/canvas/IMPL-WC.md §4.5, lane C): a rig's cords — o (a cord's alpha, one of ALPHAS) packed into the sel float
//   (sel + 4·index: no new vertex attribute, the P-1 (c) stride and bytes kept), s 2 the KNOB end (fixer B2; the user, 2026-10-26: a
//   cord onto a socket-less knob goes "directly to the back of the knob that it is attached to" — no plug at b: the rope ends at the
//   knob's rim, the host's anchor, in a butt end that goes in behind), top() (a world-space layer above the cords for the badges and
//   the × — never under a rope), c clamped to the eight colours, and hit(p, r) — a pure query over the drawn ropes the world asks through the
//   host on an empty-canvas press (a tap on a rig cord's body selects it: the lead's decision 2; the 900 Series' stays plugs-only,
//   the host leaves its ids out). Records without o and with s 0 / 1 write the bytes they always wrote.
// Where: a second WebGL2 canvas (.cv-cords) after #world in #viewport — above every module, under #overlay / the toolbar / the
//   trays — never transformed, drawn by cv-world in the same write() that moves #world (the faces' proven path, glued
//   mid-pinch), with the same camera, device ratio and viewport; its drawing buffer only while it is allocated (alloc: the host's
//   "a patched instrument is shown") or cords exist — 0 × 0 otherwise, the context made at the first need. 'under' (a switch:
//   cv-world's ?cords=under / the pref synth.cv.cords = 'under', for an iPad that shows the canvas above #world lagging) draws
//   into cv-gl's context after the faces instead (knob caps over the cords: the look's trade). No WebGL2, ?nogl or three
//   context losses in a minute: an SVG in #world above the modules (the motion-off parabola, the lab's strokes; re-pathed
//   on anchor changes only).
// The ticker: none of its own — while a rope is awake the layer asks the world for frames (onWake → request); the world's
//   tick steps the ropes first, then draws once (in write() when the camera moved, else after the step); writes outside
//   the tick (gesture.js's pinch: its own rAF calls the pan and the zoom hook, two writes) step and draw them once at the
//   end of that task, at its last camera, and the tick leaves them while such writes keep coming (one draw a frame, S9's
//   finding (b)). All asleep: no frames. A frame's rope-steps ≤ STUDIO.BUDGET (fewer steps each beyond it); an anchor jump
//   > JUMP_PX in a frame takes ⌈Δ / JUMP_PX⌉ steps (≤ 8, a module dragged with the 32 px snap); the hold rule (§4.3, on
//   unless o.hold === false; the world measures its frames): in a camera burst a frame after one longer than HOLD_MS steps
//   nothing (the ropes freeze and resume). prefers-reduced-motion: the parabola from the ends on every draw, no ticker.
// Stage P (docs/canvas/IMPL-P.md §1.2, §6 lane C; the lead's P-1 (c)): the cord quality follows the device's performance
//   preset (visual only — nothing here reaches the audio): high = the Studio rope above (today, step for step and byte for
//   byte), medium = the same physics at 6 points (SUB 3), low = still (no simulation, no ticker: the reduced-motion path)
//   at medium's geometry — CORD_Q; o.perf at creation, setPerf(id) live (every rope re-seeded asleep from its parabola: a
//   switch never shows a stale rope jump). And each drawn cord owns a fixed vertex range of the strip (its lead and trail
//   joins included: the same vertices in the same order as one strip built whole) — a frame rewrites and uploads
//   (bufferSubData) only the cords whose rope or ends moved, so a drag or a sway costs its own cords, not every cord
//   (4 096 cords: 2.7 ms + 7.3 MB a frame before, one cord's ≈ 2 KB after); a cord added / removed / placed, a quality or
//   motion change, the live rope coming or going rebuild the strip whole, as before.
// Rules: plain ES module, no DOM / window access at module top level (node imports it: tests); imports nothing; every GL and
//   DOM call guarded (a stub DOM, a fake or lost context: the layer degrades, never throws into its caller); no allocation
//   per frame on the GL path (typed arrays kept, grown ×1.5).

/* ---------------------------------------------------------------- the Studio physics (pure, node-tested against LAB) */
/** The approved preset (LAB:132–143 PRESETS.studio, damping(), DT, EXTRA), world px: N points a cord, DT a step, the length
 * (1 + SLACK)·D + EXTRA eased at EASE / s, velocity kept DAMP a step (0.90 + 0.095 · wobble 0.62 — LAB's expression, bit for
 * bit), gravity G px/s², PASSES slack-only constraint passes; asleep after QUIET_N + 1 steps under QUIET_PX (LAB's ++quiet >
 * 30), woken by an end moving > WAKE_PX (Σ|Δ| of both); a frame's dt ≤ DT_MAX, ≤ MAX_STEPS steps; [C] ours: ≤ BUDGET rope-steps
 * a frame (review #17), a jump > JUMP_PX takes ⌈Δ / JUMP_PX⌉ steps (§4.4), HOLD_MS (the hold rule), SUB smoothed points per
 * rope segment drawn. */
export const STUDIO = Object.freeze({ N: 10, DT: 1 / 120, SLACK: 0.10, EXTRA: 24, DAMP: 0.90 + 0.095 * (62 / 100), G: 6000, PASSES: 5, EASE: 5,
  QUIET_N: 30, QUIET_PX: 0.02, WAKE_PX: 0.01, MAX_STEPS: 8, DT_MAX: 0.05, BUDGET: 160, JUMP_PX: 16, HOLD_MS: 24, SUB: 4 });
/** [C] (P, IMPL-P §1.2) the cords of a performance preset: q its name in stats(), N points a rope, SUB smoothed points a
 * segment (2 + (N − 2)·SUB drawn), still = no simulation. high 'full' = STUDIO (today); medium 'light' = the Studio physics at
 * 6 points (the lab's own "Points per cord" trade: slack, wobble, weight, stiffness, DT and the sleep rules unchanged — step()
 * reads the rope's n); low 'still' = the settled parabola (the reduced-motion path) at medium's 6 / 3 (14 drawn points: × 0.4
 * the strip; within ≈ 4.5 % of the sag of the 10 / 4 one). Prefers-reduced-motion is still at every preset; the SVG fallback
 * keeps STUDIO's 10 / 4. */
export const CORD_Q = Object.freeze({ high: Object.freeze({ q: 'full', N: STUDIO.N, SUB: STUDIO.SUB, still: false }),
  medium: Object.freeze({ q: 'light', N: 6, SUB: 3, still: false }), low: Object.freeze({ q: 'still', N: 6, SUB: 3, still: true }) });
/** [C] (P-1 (c)) a frame's partial upload: dirty cords this few ranges apart go up as one bufferSubData (the gap's bytes are
 * cheaper than a call), and past RUN_MAX runs a buffer the smallest gaps merge — so a sway of every cord is a few calls. */
export const RUN_GAP = 4, RUN_MAX = 16;
/** The lab's eight cord colours (LAB:143; patch-core PALETTE's hex, one order): a cord stores its index. */
export const PALETTE = Object.freeze(['#d8432f', '#e6b83a', '#3f80d8', '#41a75c', '#e9e5da', '#e27c2f', '#9060c9', '#2f3033']);
/** The lab's look ×1.4 (its plug covers its r 10 jack; a 900-series jack nut is r 14 world px): the shadow (+SH_DX, +SH_DY,
 * black SH_A, the cord's width), the cord W wide — its rim the colour shaded RIM, the body BODY wide, a highlight HI wide
 * shaded LIGHT at HI_A offset (HI_DX, HI_DY) —, never under MIN_DPX device px; a round plug: shadow (PSH_DX, PSH_DY) PSH_A,
 * the ring PLUG_R shaded RING, the body PLUG_B, a highlight PLUG_H at (PLUG_HD, PLUG_HD) PLUG_HA; [C] an S-trigger cord's
 * Cinch-Jones plug (ours): a rounded rectangle SW × SH (radius SR) over the 20 × 16 socket, its body SBW × SBH (SBR), the two
 * shells' parting line across it, a highlight bar. OFF_ALPHA: a powered-off instrument's cords (cv-face's). SEL: the
 * selected cord's outline (2 device px), its plugs' ring. */
export const LOOK = Object.freeze({ W: 11.2, BODY: 7.8, HI: 2.2, HI_DX: -1.68, HI_DY: -1.96, HI_A: 0.55, RIM: -0.45, LIGHT: 0.45,
  SH_DX: 4, SH_DY: 8, SH_A: 0.32, MIN_DPX: 2.5, PLUG_R: 14, PLUG_B: 9.8, PLUG_H: 3.4, PLUG_HD: -3, PLUG_HA: 0.35, RING: -0.35,
  PSH_DX: 3, PSH_DY: 4, PSH_A: 0.35, SW: 26, SH: 20, SR: 4, SBW: 18.8, SBH: 12.8, SBR: 3, OFF_ALPHA: 0.45, SEL: 0.96 });
/** [C] (WC, IMPL-WC §4.5; skeptic P2-12) a cord's alpha `o`, one of four — packed into the sel float a vertex / plug already
 * carries (sel + 4·index: no new attribute, FPV / FPI and the P-1 (c) bytes kept), decoded in the shaders: 1 · 0.85 a rig's own
 * mod cords (lighter over the panels) · OFF_ALPHA bypassed / from a module that is off · 0.3 the 24+ fade. A record without o
 * (the 900 Series') writes index 0: the bytes it always wrote. */
export const ALPHAS = Object.freeze([1, 0.85, LOOK.OFF_ALPHA, 0.3]);
/** A record's o → its ALPHAS index: the nearest of the four; anything but a finite number 0 (alpha 1). */
export const alphaOf = o => {
  if (typeof o !== 'number' || !isFinite(o)) return 0;
  let k = 0;
  for (let i = 1; i < ALPHAS.length; i++) if (Math.abs(o - ALPHAS[i]) < Math.abs(o - ALPHAS[k])) k = i;
  return k;
};
/** [C] (WC, fixer B2; the user, 2026-10-26, replacing the edge-entry BACK end of 2026-10-25: "the cable going from lfo to filter should
 * be going directly to the back of the knob that it is attached to") the KNOB end (a record's s: 2): no plug, no tip, no grommet at b
 * — b is the knob's rim point facing the cord (the host's anchor) and the rope ends exactly there, a butt end that reads as going in
 * behind the knob: over its last SHADE px the knob's shade darkens it (black, 0 → SHADE_A at the rim) and the knob's ring crosses its
 * end (a RIM px band in the cord's colour — the host rings the knob in it: the ring passes over the rope), and the rope's shadow
 * fades out over its last stretch (its last point's vertices carry FLAG in the sel float: never a shadow cast onto the knob). The
 * rope may cross its own target's face on the way (the user accepts it); nothing keeps it off a panel. In a plug instance the end is
 * shape 3 + its heading as a fraction of a turn (endU: 0 → +x, ¼ → +y, into the knob); 0 round, 1 S-trigger, 2 the glue probe. A
 * round plug at a. */
export const KNOB = Object.freeze({ FLAG: 16, SHADE: 7, SHADE_A: 0.55, RIM: 2, RIM_A: 0.95 });
/** (WC, fixer B2) A drawn polyline's end heading (P: x, y pairs, m points; its last segment, a → b) as a fraction of a turn in
 * [0, 1): 0 → +x, 0.25 → +y (screen y down). ((fixer K) its last segment of any length: points collapsed onto the end — clip —
 * skipped.) */
export function endU(P, m) {
  let k = m - 1;
  while (k > 1 && P[2 * k] === P[2 * k - 2] && P[2 * k + 1] === P[2 * k - 1]) k--;
  const dx = P[2 * k] - P[2 * k - 2], dy = P[2 * k + 1] - P[2 * k - 1], u = Math.atan2(dy, dx) / (2 * Math.PI);
  const v = u < 0 ? u + 1 : u;
  return v >= 1 ? 0 : v;
}
/** [C] (WC, integration fixer K; the go / no-go review's P2-2) a KNOB end's drawn rope cut where it first crosses the knob's rim
 * (disc cx, cy, r: the host's, on the anchor): the polyline P (m points) from a toward b — the first point inside the disc (by more
 * than 0.01 px) and every one after it move onto the rim crossing of the segment that entered, so the strip keeps its vertex count
 * and nothing of the rope lies on the knob's face (a modulator straight above its knob: the rope's slack fold went 9 px in) →
 * the index of the rope's end (m − 1 when it never enters). In place; pure but for P. */
export function clip(P, m, cx, cy, r) {
  const rr = (r - 0.01) * (r - 0.01);
  for (let i = 1; i < m; i++) {
    const x = P[2 * i] - cx, y = P[2 * i + 1] - cy;
    if (x * x + y * y >= rr) continue;
    const px = P[2 * i - 2] - cx, py = P[2 * i - 1] - cy, dx = x - px, dy = y - py, A = dx * dx + dy * dy, B = 2 * (px * dx + py * dy), Q = B * B - 4 * A * (px * px + py * py - r * r);
    const t = A > 0 && Q >= 0 ? Math.max(0, Math.min(1, (-B - Math.sqrt(Q)) / (2 * A))) : 0, ex = P[2 * i - 2] + dx * t, ey = P[2 * i - 1] + dy * t;
    for (let j = i; j < m; j++) { P[2 * j] = ex; P[2 * j + 1] = ey; }
    return i;
  }
  return m - 1;
}
/** [C] (WC, §4.4) a cord body's tap target: the world asks hit(p, HIT_PX / k) — 12 screen px each side of the rope. */
export const HIT_PX = 12;
/** A colour index clamped to the eight colours (8 → 7, −1 → 0, NaN / a word → 0): no uniform read past the arrays (WC, map §2). */
export const colourOf = c => { const n = c | 0; return n < 0 ? 0 : n > 7 ? 7 : n; };
/** A record's plug type: 2 the KNOB end, any other truthy value 1 (an S-trigger), else 0. */
const plugOf = s => (s === 2 ? 2 : s ? 1 : 0);

/** A rope: its points now and a step ago, its length, the anchors of its last frame (A0 / B0) and of this one (A1 / B1), sleep. */
export function makeRope(n = STUDIO.N) {
  return { n, X: new Float64Array(n), Y: new Float64Array(n), PX: new Float64Array(n), PY: new Float64Array(n), L: 0,
    A0x: 0, A0y: 0, B0x: 0, B0y: 0, A1x: 0, A1y: 0, B1x: 0, B1y: 0, awake: false, quiet: 0 };
}
/** r seeded from the parabola of length L = (1 + SLACK)·D + EXTRA between A and B (LAB:170–178), sag = √(3·max(D, 1)·(L − D) / 8)
 * — asleep (IMPL-9 review #23: a project opens still; LAB seeds awake) unless `awake`. */
export function seed(r, ax, ay, bx, by, awake = false) {
  const n = r.n, D = Math.hypot(bx - ax, by - ay);
  r.L = (1 + STUDIO.SLACK) * D + STUDIO.EXTRA;
  const sag = Math.sqrt(Math.max(0, 3 * Math.max(D, 1) * (r.L - D) / 8));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), x = ax + (bx - ax) * t, y = ay + (by - ay) * t + sag * 4 * t * (1 - t);
    r.X[i] = x; r.Y[i] = y; r.PX[i] = x; r.PY[i] = y;
  }
  r.A0x = r.A1x = ax; r.A0y = r.A1y = ay; r.B0x = r.B1x = bx; r.B0y = r.B1y = by; r.awake = !!awake; r.quiet = 0;
  return r;
}
/** One fixed step of LAB's Cord.step (LAB:180–203, its arithmetic in its order) with the ends at A and B. */
export function step(r, ax, ay, bx, by, dt) {
  const n = r.n, X = r.X, Y = r.Y, PX = r.PX, PY = r.PY, S = STUDIO, D = Math.hypot(bx - ax, by - ay);
  r.L += ((1 + S.SLACK) * D + S.EXTRA - r.L) * Math.min(1, dt * S.EASE); // (the cord's length follows the gap, slowly)
  const seg = r.L / (n - 1), k = S.DAMP, g = S.G * dt * dt;
  for (let i = 1; i < n - 1; i++) {
    const vx = (X[i] - PX[i]) * k, vy = (Y[i] - PY[i]) * k;
    PX[i] = X[i]; PY[i] = Y[i]; X[i] += vx; Y[i] += vy + g;
  }
  X[0] = ax; Y[0] = ay; X[n - 1] = bx; Y[n - 1] = by;
  for (let it = 0; it < S.PASSES; it++) {
    for (let i = 0; i < n - 1; i++) {
      const dx = X[i + 1] - X[i], dy = Y[i + 1] - Y[i], d = Math.hypot(dx, dy) || 1e-6;
      if (d <= seg) continue; // (a cord goes slack, never pushes)
      const f = (d - seg) / d, wu = i === 0 ? 0 : 0.5, wv = i + 1 === n - 1 ? 0 : 0.5, s = wu + wv;
      if (!s) continue;
      X[i] += dx * f * wu / s; Y[i] += dy * f * wu / s; X[i + 1] -= dx * f * wv / s; Y[i + 1] -= dy * f * wv / s;
    }
    X[0] = ax; Y[0] = ay; X[n - 1] = bx; Y[n - 1] = by;
  }
  let moved = 0;
  for (let i = 1; i < n - 1; i++) moved = Math.max(moved, Math.abs(X[i] - PX[i]) + Math.abs(Y[i] - PY[i]));
  if (moved < S.QUIET_PX) { if (++r.quiet > S.QUIET_N) r.awake = false; } else r.quiet = 0;
}
/**
 * One frame of LAB's loop (LAB:289–301): 120 Hz fixed steps from the frame's dt (≤ DT_MAX; the remainder dropped past one
 * step), each awake rope stepped with its anchors swept from last frame's (A0, B0) to now's (step s of n at A0 + (A1 − A0)·(s +
 * 1) / n); a rope wakes on an end moving > WAKE_PX (Σ|Δ|). ends(r, E) fills E = [ax, ay, bx, by] → false: unknown (the rope is
 * left as it is). [C] ours: at most `budget` rope-steps (beyond it every awake rope takes ⌊budget / awake⌋, ≥ 1: the ropes slow,
 * the frame does not); a rope whose end jumped Δ > JUMP_PX takes ≥ ⌈Δ / JUMP_PX⌉ steps (≤ MAX_STEPS, within the budget's
 * share); `hold`: no step this frame (its time dropped). sim = { acc, last } (ms). Pure but for the ropes and sim. (P-1) r.mv
 * set on a rope stepped or whose ends moved (its drawn range is stale: the layer rewrites it, then clears the flag); r.skip
 * on one whose ends are unknown. Neither touches the physics.
 * @returns {{steps: number, per: number, awake: number, left: number, ropeSteps: number, moved: boolean}}
 */
export function advance(sim, ropes, t, ends, o) {
  const S = STUDIO, budget = o && o.budget > 0 ? o.budget : S.BUDGET, hold = !!(o && o.hold);
  const dt = Math.min(S.DT_MAX, Math.max(0, (t - sim.last) / 1000));
  sim.last = t; sim.acc += dt;
  let steps = Math.min(S.MAX_STEPS, Math.floor(sim.acc / S.DT));
  sim.acc -= steps * S.DT; if (sim.acc > S.DT) sim.acc = 0;
  if (hold) steps = 0;
  const E = sim.E || (sim.E = new Float64Array(4));
  let awake = 0, moved = false;
  for (let i = 0; i < ropes.length; i++) {
    const r = ropes[i];
    r.skip = !ends(r, E);
    if (r.skip) continue;
    r.A1x = E[0]; r.A1y = E[1]; r.B1x = E[2]; r.B1y = E[3];
    if (Math.abs(r.A1x - r.A0x) + Math.abs(r.A1y - r.A0y) + Math.abs(r.B1x - r.B0x) + Math.abs(r.B1y - r.B0y) > S.WAKE_PX) { r.awake = true; moved = true; r.mv = true; }
    else if (r.A1x !== r.A0x || r.A1y !== r.A0y || r.B1x !== r.B0x || r.B1y !== r.B0y) { moved = true; r.mv = true; }
    if (r.awake) awake++;
  }
  const cap = awake ? Math.max(1, Math.floor(budget / awake)) : 0, per = Math.min(steps, cap);
  let n = 0, left = 0;
  for (let i = 0; i < ropes.length; i++) {
    const r = ropes[i];
    if (r.skip) continue;
    if (r.awake) {
      let m = per;
      if (!hold) { const J = Math.max(Math.hypot(r.A1x - r.A0x, r.A1y - r.A0y), Math.hypot(r.B1x - r.B0x, r.B1y - r.B0y)); if (J > S.JUMP_PX) m = Math.max(m, Math.min(S.MAX_STEPS, cap, Math.ceil(J / S.JUMP_PX))); }
      for (let s = 0; s < m; s++) {
        const f = (s + 1) / m;
        step(r, r.A0x + (r.A1x - r.A0x) * f, r.A0y + (r.A1y - r.A0y) * f, r.B0x + (r.B1x - r.B0x) * f, r.B0y + (r.B1y - r.B0y) * f, S.DT);
        n++;
      }
      if (m > 0) r.mv = true;
      if (r.awake) left++;
    }
    r.A0x = r.A1x; r.A0y = r.A1y; r.B0x = r.B1x; r.B0y = r.B1y;
  }
  return { steps, per, awake, left, ropeSteps: n, moved };
}
/** Motion off: the settled parabola from the ends (LAB:278–284), n points into X / Y. */
export function shown(n, ax, ay, bx, by, X, Y) {
  const D = Math.hypot(bx - ax, by - ay), L = (1 + STUDIO.SLACK) * D + STUDIO.EXTRA, sag = Math.sqrt(Math.max(0, 3 * Math.max(D, 1) * (L - D) / 8));
  for (let i = 0; i < n; i++) { const t = i / (n - 1); X[i] = ax + (bx - ax) * t; Y[i] = ay + (by - ay) * t + sag * 4 * t * (1 - t); }
}
/** LAB's drawn path (LAB:247–251: quadratics through the midpoints, a line to the end) as a polyline of `sub` points a
 * quadratic, into out (x, y pairs) → the point count 2 + (n − 2)·sub. */
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
/** The point at fraction t (0…1) of a polyline's length (P: x, y pairs, m points) → { x, y }. */
export function along(P, m, t) {
  let len = 0;
  for (let i = 0; i < m - 1; i++) len += Math.hypot(P[2 * i + 2] - P[2 * i], P[2 * i + 3] - P[2 * i + 1]);
  let want = Math.max(0, Math.min(1, +t || 0)) * len;
  for (let i = 0; i < m - 1; i++) {
    const l = Math.hypot(P[2 * i + 2] - P[2 * i], P[2 * i + 3] - P[2 * i + 1]);
    if (want <= l || i === m - 2) { const u = l > 0 ? Math.min(1, want / l) : 0; return { x: P[2 * i] + (P[2 * i + 2] - P[2 * i]) * u, y: P[2 * i + 1] + (P[2 * i + 3] - P[2 * i + 1]) * u }; }
    want -= l;
  }
  return { x: P[0], y: P[1] };
}
/** [C] (WC, integration fixer K; the go / no-go review's P2-1) the Studio rope AT REST between A and B, n points into X / Y — where a
 * rig's cord settles, so its badge sits on it and its knob end is aimed along it (the parabola misses it by tens of px on a chord
 * 20–30° off the vertical): the hanging chain of length (1 + SLACK)·D + EXTRA in n − 1 equal links with equal weights at its inner
 * points — the verlet rope's equilibrium, within ≈ 3 px of a settled Studio rope (its links stretch < 1 %). Link j points along
 * (h, c − j) (the tension's horizontal part h, its vertical part a weight less a point): Σ (c − j)/r_j fixes c for h (Newton,
 * bracketed), Σ h/r_j fixes h (bisection on ln h). A chain whose fold must go slack (a near-vertical chord: no taut equilibrium
 * closes within REST_TOL px) from REST_STEPS Studio steps of the seeded rope instead (300 steps settle it to < 0.1 px). Pure. */
export const REST_STEPS = 300, REST_TOL = 0.5;
export function rest(ax, ay, bx, by, X, Y, n = STUDIO.N) {
  const dx = bx - ax, dy = by - ay, D = Math.hypot(dx, dy), m = n - 1, s = ((1 + STUDIO.SLACK) * D + STUDIO.EXTRA) / m;
  const hx = Math.abs(dx) / s, vy = dy / s, sg = dx < 0 ? -1 : 1;
  let c = m / 2;
  const cOf = h => {
    let lo = -(m + 4) * (h + 1) - 4, hi = m + (m + 4) * (h + 1) + 4;
    if (!(c > lo && c < hi)) c = (lo + hi) / 2;
    for (let it = 0; it < 80; it++) {
      let f = -vy, df = 0;
      for (let j = 0; j < m; j++) { const q = c - j, r = Math.sqrt(h * h + q * q) || 1e-300; f += q / r; df += h * h / (r * r * r); }
      if (f > 0) hi = c; else lo = c;
      if (Math.abs(f) < 1e-11 || hi - lo < 1e-12) break;
      const nc = df > 0 ? c - f / df : NaN;
      c = nc > lo && nc < hi ? nc : (lo + hi) / 2;
    }
    return c;
  };
  let lo = -18, hi = 10;
  for (let it = 0; it < 36; it++) { // (ln h to 28 / 2^36: far below a px)
    const t = (lo + hi) / 2, h = Math.exp(t), cc = cOf(h);
    let g = -hx;
    for (let j = 0; j < m; j++) g += h / Math.sqrt(h * h + (cc - j) * (cc - j));
    if (g > 0) hi = t; else lo = t;
  }
  const h = Math.exp((lo + hi) / 2), cc = cOf(h);
  X[0] = ax; Y[0] = ay;
  for (let j = 0; j < m; j++) { const q = cc - j, r = Math.sqrt(h * h + q * q); X[j + 1] = X[j] + sg * s * h / r; Y[j + 1] = Y[j] + s * q / r; }
  const ex = bx - X[m], ey = by - Y[m];
  if (Math.hypot(ex, ey) > REST_TOL) {
    const r = seed(makeRope(n), ax, ay, bx, by, true);
    for (let i = 0; i < REST_STEPS; i++) step(r, ax, ay, bx, by, STUDIO.DT);
    for (let i = 0; i < n; i++) { X[i] = r.X[i]; Y[i] = r.Y[i]; }
  } else for (let j = 1; j < m; j++) { X[j] += ex * j / m; Y[j] += ey * j / m; }
  X[0] = ax; Y[0] = ay; X[m] = bx; Y[m] = by;
}
/** (fixer K) r seeded asleep AT REST (rest): a rig's cord that opens still hangs where it would settle — seed's length, ends and
 * sleep, rest's points. */
export function seedRest(r, ax, ay, bx, by) {
  seed(r, ax, ay, bx, by, false);
  rest(ax, ay, bx, by, r.X, r.Y, r.n);
  r.PX.set(r.X); r.PY.set(r.Y);
  return r;
}
const RX = new Float64Array(STUDIO.N), RY = new Float64Array(STUDIO.N), SVG_Q = Object.freeze({ N: STUDIO.N, SUB: STUDIO.SUB, still: true });
/** (fixer K) the drawn polyline of a cord AT REST between A and B at quality q ({ N, SUB, still }: a CORD_Q entry) into out → its
 * point count: smooth(rest) with motion, smooth(shown) still (the parabola the still / reduced / SVG layers draw). */
export function restPath(ax, ay, bx, by, out, q = CORD_Q.high) {
  const n = q && q.N > 1 ? q.N : STUDIO.N, sub = q && q.SUB > 0 ? q.SUB : STUDIO.SUB;
  if (q && q.still) shown(n, ax, ay, bx, by, RX, RY); else rest(ax, ay, bx, by, RX, RY, n);
  return smooth(RX, RY, n, sub, out);
}
/** (diagnostics: a test's or a bench's way to set cords swinging — no input reaches it, the user's rule) an impulse of `amp` px /
 * step at point i0 with a sine falloff to both ends (the lab's Pluck without its randomness), the rope woken. */
export function pluck(r, i0, amp = 9) {
  const n = r.n, t0 = Math.min(0.95, Math.max(0.05, i0 / (n - 1)));
  for (let i = 1; i < n - 1; i++) { const t = i / (n - 1), u = t <= t0 ? t / (2 * t0) : 1 - (1 - t) / (2 * (1 - t0)); r.PY[i] += amp * Math.sin(Math.PI * u); }
  r.awake = true; r.quiet = 0;
}
/** LAB's shade (LAB:252): f < 0 darker (v·(1 + f)), f > 0 lighter (v + (255 − v)·f), each channel rounded → [r, g, b] 0…255. */
export function shade(hex, f) {
  const n = parseInt(String(hex).slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f))));
}

/* ---------------------------------------------------------------- the GL programs (GLSL ES 3.00; premultiplied, ONE / ONE_MINUS_SRC_ALPHA) */
const f1 = v => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const HW = LOOK.W / 2;
// ((fixer B2) the knob ring's black, lifted to read on a dark face: style.css's [data-rig-cord="7"] #8a8c90 — the KNOB end's ring band)
const KRING7 = [0x8a / 255, 0x8c / 255, 0x90 / 255].map(v => Math.round(v * 1000) / 1000);
// the strip: a vertex = the smoothed polyline's point p, its normal n, a = (side ±1, colour, selected); widened by the half width
// (≥ MIN_DPX / 2 device px) + one device px of ramp; v runs −1…1 across the cord (|v| > 1: the ramp), the bands by |v|: the
// body inside BODY / W, the rim outside; the highlight a band of HI / W around hc (the lab's offset stroke's normal part);
// pass 0 = the shadow (offset, black SH_A), pass 1 = the cord; vp.w the layer's alpha; (WC) a.z = selected + 4·(ALPHAS index): the
// cord's own alpha al (ALPHA_Q); (fixer B2) + KNOB.FLAG on a knob end's last point: ke 1 there, 0 elsewhere (smooth) — its shadow fades out
// over its last stretch (no shadow cast onto the knob it goes behind)
const ALPHA_Q = q => q + '<0.5?' + f1(ALPHAS[0]) + ':' + q + '<1.5?' + f1(ALPHAS[1]) + ':' + q + '<2.5?' + f1(ALPHAS[2]) + ':' + f1(ALPHAS[3]);
const STRIP_VS = '#version 300 es\nlayout(location=0) in vec2 p;layout(location=1) in vec2 n;layout(location=2) in vec3 a;\n'
  + 'uniform vec4 cam;uniform vec4 vp;uniform vec3 body[8];uniform vec3 rim[8];uniform vec3 hi[8];\n'
  + 'out float v;out float hc;out float ke;flat out vec3 cb;flat out vec3 cr;flat out vec3 ch;flat out float sl;flat out float wpx;flat out float al;\n'
  + 'void main(){float kd=cam.z*cam.w;float hw=max(' + f1(HW) + ',' + f1(LOOK.MIN_DPX / 2) + '/kd);float pad=1.0/kd;'
  + 'vec2 w=p+n*a.x*(hw+pad);if(vp.z<0.5)w+=vec2(' + f1(LOOK.SH_DX) + ',' + f1(LOOK.SH_DY) + ');'
  + 'v=a.x*(hw+pad)/hw;hc=dot(vec2(' + f1(LOOK.HI_DX) + ',' + f1(LOOK.HI_DY) + '),n)/' + f1(HW) + ';'
  + 'int i=int(a.y+0.5);cb=body[i];cr=rim[i];ch=hi[i];float e=floor(a.z/' + f1(KNOB.FLAG) + '+0.01);float z=a.z-' + f1(KNOB.FLAG) + '*e;ke=e;'
  + 'float q=floor(z/4.0+0.01);sl=z-4.0*q;al=' + ALPHA_Q('q') + ';wpx=hw*kd;'
  + 'vec2 dv=(w*cam.z+cam.xy)*cam.w;gl_Position=vec4(dv.x/vp.x*2.0-1.0,1.0-dv.y/vp.y*2.0,0.0,1.0);}';
const STRIP_FS = '#version 300 es\nprecision highp float;uniform vec4 vp;\n'
  + 'in float v;in float hc;in float ke;flat in vec3 cb;flat in vec3 cr;flat in vec3 ch;flat in float sl;flat in float wpx;flat in float al;out vec4 o;\n'
  + 'void main(){float a=abs(v),aa=max(fwidth(v),1e-4);float cov=clamp((1.0-a)/aa+0.5,0.0,1.0)*vp.w*al;'
  + 'if(vp.z<0.5){o=vec4(0.0,0.0,0.0,' + f1(LOOK.SH_A) + '*cov*(1.0-ke));return;}'
  + 'vec3 c=mix(cr,cb,clamp((' + (LOOK.BODY / LOOK.W).toFixed(6) + '-a)/aa+0.5,0.0,1.0));'
  + 'c=mix(c,ch,clamp((' + (LOOK.HI / LOOK.W).toFixed(6) + '-abs(v-hc))/aa+0.5,0.0,1.0)*' + f1(LOOK.HI_A) + ');'
  + 'if(sl>0.5)c=mix(c,vec3(' + f1(LOOK.SEL) + '),clamp((a-(1.0-2.0/max(wpx,1.0)))/aa+0.5,0.0,1.0)*0.9);'
  + 'o=vec4(c*cov,cov);}';
// the plugs: one instanced quad an end (ins = x, y, colour, shape: 0 round, 1 S-trigger, 2 the glue probe, (WC, fixer B2) 3 + u the KNOB
// end heading u turns; fl = selected + 4·(ALPHAS index)), an SDF in world px with a one-device-px ramp; layers composited front to back
// over: shadow, ring, body, the S plug's parting line, highlight, the selected ring
const PLUG_EXT = 22;
const PLUG_VS = '#version 300 es\nlayout(location=0) in vec2 q;layout(location=1) in vec4 ins;layout(location=2) in float fl;\n'
  + 'uniform vec4 cam;uniform vec4 vp;uniform vec3 body[8];uniform vec3 ring[8];\n'
  + 'out vec2 lp;flat out vec3 cb;flat out vec3 cr;flat out vec3 ck;flat out float shp;flat out float px;flat out float sl;flat out float al;\n'
  + 'void main(){float kd=cam.z*cam.w;float R=' + f1(PLUG_EXT) + '+2.0/kd;vec2 w=ins.xy+q*R;lp=q*R;int i=int(ins.z+0.5);'
  + 'cb=body[i];cr=ring[i];ck=i==7?vec3(' + KRING7.map(f1).join(',') + '):cb;shp=ins.w;px=1.0/kd;float g=floor(fl/4.0+0.01);sl=fl-4.0*g;'
  + 'al=ins.w<2.5&&g>0.5&&g<1.5?1.0:(' + ALPHA_Q('g') + ');' // ((fixer K, review P3-13) a rig's own row (0.85): its plug opaque, its rope and knob end lighter
  + 'vec2 dv=(w*cam.z+cam.xy)*cam.w;gl_Position=vec4(dv.x/vp.x*2.0-1.0,1.0-dv.y/vp.y*2.0,0.0,1.0);}';
const PLUG_FS = '#version 300 es\nprecision highp float;uniform vec4 vp;\n'
  + 'in vec2 lp;flat in vec3 cb;flat in vec3 cr;flat in vec3 ck;flat in float shp;flat in float px;flat in float sl;flat in float al;out vec4 o;\n'
  + 'float cv(float sd){return clamp(0.5-sd/px,0.0,1.0);}\n'
  + 'float rb(vec2 p,vec2 b,float r){vec2 d=abs(p)-b+r;return length(max(d,0.0))+min(max(d.x,d.y),0.0)-r;}\n'
  + 'vec4 ov(vec4 s,vec4 d){return s+d*(1.0-s.a);}\n'
  + 'void main(){'
  // ((WC, fixer B2) the KNOB end: no plug — at the rim the rope goes in behind the knob: the knob's shade on its last SHADE px (black,
  // 0 → SHADE_A, nothing past the rim), the knob's ring (its colour ck: the cord's, black lifted as the ring's CSS) across its end)
  + 'if(shp>2.5){float an=(shp-3.0)*6.2831853;vec2 d=vec2(cos(an),sin(an));float a=dot(lp,d),cw=abs(dot(lp,vec2(-d.y,d.x)));'
  + 'float sh=' + f1(KNOB.SHADE_A) + '*clamp((a+' + f1(KNOB.SHADE) + ')/' + f1(KNOB.SHADE) + ',0.0,1.0)*cv(a)*cv(cw-' + f1(HW) + ');'
  + 'float rm=cv(abs(a+' + f1(KNOB.RIM / 2) + ')-' + f1(KNOB.RIM / 2) + ')*cv(cw-' + f1(HW + 0.5) + ');'
  + 'vec4 c=vec4(0.0,0.0,0.0,sh);c=ov(vec4(ck,1.0)*' + f1(KNOB.RIM_A) + '*rm,c);o=c*vp.w*al;return;}'
  + 'if(shp>1.5){o=vec4(1.0,0.0,1.0,1.0)*cv(length(lp)-4.0*px);return;}' // (the glue probe: a magenta disc of 4 device px)
  + 'bool s=shp>0.5;vec2 SH=vec2(' + f1(LOOK.PSH_DX) + ',' + f1(LOOK.PSH_DY) + ');'
  + 'vec2 SB=vec2(' + f1(LOOK.SW / 2) + ',' + f1(LOOK.SH / 2) + '),BB=vec2(' + f1(LOOK.SBW / 2) + ',' + f1(LOOK.SBH / 2) + ');'
  + 'float sS=s?rb(lp-SH,SB,' + f1(LOOK.SR) + '):length(lp-SH)-' + f1(LOOK.PLUG_R) + ';'
  + 'float sR=s?rb(lp,SB,' + f1(LOOK.SR) + '):length(lp)-' + f1(LOOK.PLUG_R) + ';'
  + 'float sB=s?rb(lp,BB,' + f1(LOOK.SBR) + '):length(lp)-' + f1(LOOK.PLUG_B) + ';'
  + 'float sH=s?rb(lp-vec2(-3.5,-3.8),vec2(4.6,1.3),1.3):length(lp-vec2(' + f1(LOOK.PLUG_HD) + ',' + f1(LOOK.PLUG_HD) + '))-' + f1(LOOK.PLUG_H) + ';'
  + 'vec4 c=vec4(0.0,0.0,0.0,' + f1(LOOK.PSH_A) + ')*cv(sS);'
  + 'c=ov(vec4(cr,1.0)*cv(sR),c);c=ov(vec4(cb,1.0)*cv(sB),c);'
  + 'if(s)c=ov(vec4(cr,1.0)*cv(max(abs(lp.y)-0.6,sB)),c);'
  + 'c=ov(vec4(1.0)*' + f1(LOOK.PLUG_HA) + '*cv(sH),c);'
  + 'if(sl>0.5)c=ov(vec4(vec3(' + f1(LOOK.SEL) + '),1.0)*0.9*cv(abs(sR-2.0*px)-px),c);'
  + 'o=c*vp.w*al;}';
// floats a strip vertex / a plug instance; points a smoothed Studio cord (the most of any quality: the scratch arrays, the SVG's)
const FPV = 7, FPI = 5, PTS_S = 2 + (STUDIO.N - 2) * STUDIO.SUB;
const ptsOf = Q => 2 + (Q.N - 2) * Q.SUB;
/** (P) a preset id CORD_Q knows ('high' | 'medium' | 'low'), anything else 'high' (every device starts on High). */
export const perfOf = id => (typeof id === 'string' && Object.prototype.hasOwnProperty.call(CORD_Q, id) ? id : 'high');
/** The colour tables (0…1 rgb, 8 × 3 each): body = the palette, rim / hi / ring = LAB's shade of it. */
export function colourTables() {
  const T = { body: new Float32Array(24), rim: new Float32Array(24), hi: new Float32Array(24), ring: new Float32Array(24) };
  PALETTE.forEach((h, i) => {
    const put = (A, c) => { A[i * 3] = c[0] / 255; A[i * 3 + 1] = c[1] / 255; A[i * 3 + 2] = c[2] / 255; };
    put(T.body, shade(h, 0)); put(T.rim, shade(h, LOOK.RIM)); put(T.hi, shade(h, LOOK.LIGHT)); put(T.ring, shade(h, LOOK.RING));
  });
  return T;
}
/** A cord's (x, y) end from an anchors map (a Map or a plain object) of jack key → {x, y}; null unknown. */
const anchorIn = (A, k) => { const p = A ? (typeof A.get === 'function' ? A.get(k) : A[k]) : null; return p && isFinite(p.x) && isFinite(p.y) ? p : null; };
const fin = v => typeof v === 'number' && isFinite(v);

/* ---------------------------------------------------------------- the layer */
/**
 * The cord layer over `viewport` (#viewport; o.world = #world: the canvas goes right after it). o: { world, doc, win, now(),
 * onWake() (asks the world for a frame), mode: 'gl' (default) | 'svg' (?nogl) | 'under', under() → the host's WebGL2 context
 * (mode 'under': cv-gl's), test (preserveDrawingBuffer), reduced() → prefers-reduced-motion, hold (the hold rule; default on),
 * perf: 'high' (default; anything else unknown) | 'medium' | 'low' (P: CORD_Q), full (diagnostics: every build whole and
 * every upload whole — the pre-P path, for the equality tests and the bench) }.
 * @returns {{set: Function, anchors: Function, live: Function, grab: Function, move: Function, drop: Function, sel: Function,
 *   alloc: Function, dim: Function, resize: Function, step: Function, owed: Function, wants: Function, draw: Function,
 *   pointAt: Function, hit: Function, pluck: Function, probe: Function, reset: Function, svg: Function, setPerf: Function, stats: Function,
 *   top: Function, destroy: Function, readonly mode: string, readonly perf: string}}
 */
export function createCords(viewport, o) {
  o = o || {};
  const win = o.win || (typeof window !== 'undefined' ? window : globalThis);
  const doc = o.doc || (win && win.document) || globalThis.document || null;
  const WL = o.world || null;
  const now = typeof o.now === 'function' ? o.now : () => { const p = win && win.performance || globalThis.performance; return p && typeof p.now === 'function' ? p.now() : Date.now(); };
  const wakeW = () => { if (typeof o.onWake === 'function') { try { o.onWake(); } catch (err) { console.error(err); } } };
  let mq = null;
  const reduced = () => {
    if (typeof o.reduced === 'function') { try { return !!o.reduced(); } catch (err) { return false; } }
    if (typeof o.reduced === 'boolean') return o.reduced;
    try { if (!mq && win && typeof win.matchMedia === 'function') mq = win.matchMedia('(prefers-reduced-motion: reduce)'); return !!(mq && mq.matches); } catch (err) { return false; }
  };
  const HOLD = o.hold !== false, FULL = !!o.full;
  let mode = o.mode === 'svg' || o.mode === 'under' ? o.mode : 'gl'; // ('none': nothing can draw — a stub DOM)
  let perf = perfOf(o.perf), CQ = CORD_Q[perf], PTS = ptsOf(CQ); // (P) the preset's cords

  /* ---- state */
  const cords = new Map(); // id → { id, a, b, c, s, r (rope), seeded; (P-1) j its range, lv the layout it is in, e its ends as written, dq queued }
  let ropes = []; // the ropes stepped (the cords' + the live one's), rebuilt on add / remove — never per frame
  let anch = null, LV = null, GB = null, sel = null, probeKey = null, allocOn = false, dimOn = false, dead = false;
  let running = false, owedF = false, geomV = 1;
  const sim = { acc: 0, last: 0 };
  const st = { frames: 0, ropeSteps: 0, stepMs: 0, stepMax: 0, awakeMax: 0, holds: 0, draws: 0, drawMs: 0, drawMax: 0, uploads: 0, uploadBytes: 0,
    builds: 0, lost: 0, restored: 0, svgPaths: 0, fulls: 0, writes: 0, runs: 0, buildMs: 0, buildMax: 0 };
  let VW = 0, VH = 0, VD = 1, lastCam = null;
  // ((WC, fixer B2) the top layer (top()): its element, the transform written, a camera still owed to it
  let TP = null, tpT = '', topOwed = false;
  function placeTop(cam) {
    const t = 'translate(' + cam.tx + 'px, ' + cam.ty + 'px) scale(' + cam.k + ')';
    try { if (t !== tpT) { tpT = t; TP.style.transform = t; } if (topOwed) { topOwed = false; TP.style.visibility = ''; } } catch (err) { /* inert */ }
  }
  const E4 = new Float64Array(4);
  // (P-1 (c)) the strip's layout: lay = the drawn cords in draw order (the cords' Map order, the live rope last: one strip's
  // order), cord j at vertex off(j) — its lead join (j > 0: its first vertex again), its 2·PTS, its trail join (not the last:
  // its last vertex again) — and plug instances 2j, 2j + 1 (the probe after them); layV its version (a cord's lv), layOK
  // false = rebuild whole; layStill / layProbe what it was built with; DQ the cords to rewrite; scanOwed: ends may have
  // moved since advance last read them (an anchors / grab / live / set) — the next partial build compares them; RJ / RS the
  // build's dirty ranges → the upload's runs; upFull: the GPU copy is stale (a context, a growth, a missed upload)
  const lay = [], DQ = [], RJ = [], RS = [];
  let layV = 0, layOK = false, layStill = false, layProbe = false, scanOwed = true, upFull = true, nRun = 0;
  // (P-1) the step's list: while no end can have moved since advance last read every rope (no changed(), relist, pluck —
  // endsDirty false) an asleep rope's advance is a no-op (the same ends: no wake, no step, no flag), so only the awake ones
  // (act: two arrays in turn, no allocation a frame) are advanced — a sway costs its awake ropes, not every cord
  let endsDirty = true, act = [], act2 = [];
  const off = j => (j ? j * (2 * PTS + 2) - 1 : 0);
  const mark = c => { if (c && !c.dq && c.lv === layV) { c.dq = true; DQ.push(c); } };
  // the stepped list: a change of its members or order (a cord added, removed, placed, the live rope come, gone or taken)
  // is a new layout; the same list (a set() that changed colours or ends only) keeps it
  const relist = () => {
    const was = ropes;
    endsDirty = true;
    ropes = []; for (const c of cords.values()) if (c.r && c.seeded) ropes.push(c.r); if (LV && LV.r && !LV.taken) ropes.push(LV.r);
    if (ropes.length !== was.length) layOK = false; else for (let i = 0; i < ropes.length; i++) if (ropes[i] !== was[i]) { layOK = false; break; }
  };
  const motion = () => (mode === 'gl' || mode === 'under') && !CQ.still && !reduced();
  // an end's point: the plug in the finger (grab), a live end, else the jack's anchor
  function endOf(c, which) {
    if (c === LV) return which === 'a' ? LV.a : LV.b;
    if (GB && GB.id === c.id && GB.end === which) return GB.p;
    return anchorIn(anch, c[which]);
  }
  function endsOf(c, E) { const a = endOf(c, 'a'), b = endOf(c, 'b'); if (!a || !b) return false; E[0] = a.x; E[1] = a.y; E[2] = b.x; E[3] = b.y; return true; }
  // ((fixer K, P2-2) a KNOB end on its anchor whose host gave its disc (kx, ky, kr): the rope is cut at the rim (clip) — not the live
  // rope, not an end in the finger
  function discOf(c) {
    if (c.s !== 2 || c === LV || (GB && GB.id === c.id && GB.end === 'b')) return null;
    const K = anchorIn(anch, c.b);
    return K && fin(K.kx) && fin(K.ky) && fin(K.kr) && K.kr > 0 ? K : null;
  }
  const cut = (c, P, m) => { const K = discOf(c); return K ? clip(P, m, K.kx, K.ky, K.kr) : m - 1; };
  const ropeEnds = (r, E) => endsOf(r.cd, E);
  // a cord placed once both its ends are known: seeded asleep from the parabola — or, a new cord the live one just became (a
  // commit's set: its fixed end on the live rope's), that rope taken over awake, so it swings into place
  function place(c) {
    if (c.seeded || !endsOf(c, E4)) return false;
    const r = c.r && c.r.n === CQ.N ? c.r : (c.r = makeRope(CQ.N));
    r.cd = c;
    const L = LV && LV.r && !LV.taken ? LV : null, near = (p, x, y) => Math.abs(p.x - x) + Math.abs(p.y - y) < 1;
    const rev = L && near(L.a, E4[2], E4[3]), same = L && near(L.a, E4[0], E4[1]);
    if (L && (same || rev)) {
      const q = L.r, n = r.n;
      for (let i = 0; i < n; i++) { const j = same ? i : n - 1 - i; r.X[i] = q.X[j]; r.Y[i] = q.Y[j]; r.PX[i] = q.PX[j]; r.PY[i] = q.PY[j]; }
      r.L = q.L; r.quiet = 0; r.awake = true;
      const A = same ? [q.A0x, q.A0y, q.B0x, q.B0y] : [q.B0x, q.B0y, q.A0x, q.A0y];
      r.A0x = r.A1x = A[0]; r.A0y = r.A1y = A[1]; r.B0x = r.B1x = A[2]; r.B0y = r.B1y = A[3];
      L.taken = true; relist();
    } else if (c.rest) seedRest(r, E4[0], E4[1], E4[2], E4[3]); // ((fixer K, P2-1) a rig's cord: asleep where it would settle
    else seed(r, E4[0], E4[1], E4[2], E4[3], false);
    c.seeded = true;
    return true;
  }
  const kick = () => { // a rope may move: frames until every rope sleeps (LAB's kick: the clock restarts here)
    if (dead) return;
    if (motion() && !running) { running = true; sim.last = now(); sim.acc = 0; }
    wakeW();
  };
  const dirty = () => { geomV++; owedF = true; if (SV) SV.dirty = true; };
  // after an anchors / set / grab / live change: a rope whose ends left its last frame's wakes the ticker; motion off, the SVG:
  // a redraw (re-path) owed. (P-1) Which cords moved is found where it is cheapest: advance reads every rope's ends anyway
  // (r.mv), else the next partial build compares them (scanOwed)
  function changed() {
    scanOwed = true; endsDirty = true;
    let any = false;
    for (const r of ropes) {
      if (!endsOf(r.cd, E4)) continue;
      if (Math.abs(E4[0] - r.A0x) + Math.abs(E4[1] - r.A0y) + Math.abs(E4[2] - r.B0x) + Math.abs(E4[3] - r.B0y) > 0) { any = true; break; }
    }
    if (!any) return;
    if (motion()) kick();
    else { dirty(); if (SV) SV.paint(); else wakeW(); }
  }

  /* ---- GL: its own canvas after #world ('gl'), or the host's context ('under') */
  let cv = null, gl = null, P = null, ready = false, loss = [];
  let cap = 0, capP = 0, strip = new Float32Array(0), plugs = new Float32Array(0), nStrip = 0, nPlug = 0, builtV = 0, upV = -1, BW = 0, BH = 0, blank = true;
  const pts = new Float64Array(PTS_S * 2), sX = new Float64Array(STUDIO.N), sY = new Float64Array(STUDIO.N);
  const hP = new Float64Array(PTS_S * 2), hX = new Float64Array(STUDIO.N), hY = new Float64Array(STUDIO.N); // ((WC) hit's own scratch)
  const U = { cam: new Float32Array(4), vp: new Float32Array(4) }, CT = colourTables();
  const ctxOf = () => (mode === 'under' ? (typeof o.under === 'function' ? (() => { try { return o.under() || null; } catch (err) { return null; } })() : null) : gl);
  function glBuild(g) { // the two programs, the strip's VAO / buffer, the plugs' quad + instance buffer (once, after a restore / reset)
    const sh = (t, s) => { const x = g.createShader(t); g.shaderSource(x, s); g.compileShader(x); if (!g.getShaderParameter(x, g.COMPILE_STATUS)) { const l = typeof g.getShaderInfoLog === 'function' ? g.getShaderInfoLog(x) : ''; g.deleteShader(x); throw new Error('cv-cords: shader ' + (l || 'failed')); } return x; };
    const pr = (a, b) => { const p = g.createProgram(), x = sh(g.VERTEX_SHADER, a), y = sh(g.FRAGMENT_SHADER, b); g.attachShader(p, x); g.attachShader(p, y); g.linkProgram(p); g.deleteShader(x); g.deleteShader(y); if (!g.getProgramParameter(p, g.LINK_STATUS)) { const l = typeof g.getProgramInfoLog === 'function' ? g.getProgramInfoLog(p) : ''; g.deleteProgram(p); throw new Error('cv-cords: link ' + (l || 'failed')); } return p; };
    const ps = pr(STRIP_VS, STRIP_FS), pp = pr(PLUG_VS, PLUG_FS), Q = { g, ps, pp };
    for (const [p, k] of [[ps, 's'], [pp, 'p']]) { Q[k + 'Cam'] = g.getUniformLocation(p, 'cam'); Q[k + 'Vp'] = g.getUniformLocation(p, 'vp'); }
    g.useProgram(ps);
    g.uniform3fv(g.getUniformLocation(ps, 'body'), CT.body); g.uniform3fv(g.getUniformLocation(ps, 'rim'), CT.rim); g.uniform3fv(g.getUniformLocation(ps, 'hi'), CT.hi);
    g.useProgram(pp);
    g.uniform3fv(g.getUniformLocation(pp, 'body'), CT.body); g.uniform3fv(g.getUniformLocation(pp, 'ring'), CT.ring);
    Q.sv = g.createVertexArray(); Q.sb = g.createBuffer();
    g.bindVertexArray(Q.sv); g.bindBuffer(g.ARRAY_BUFFER, Q.sb);
    for (const [loc, size, off] of [[0, 2, 0], [1, 2, 8], [2, 3, 16]]) { g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, size, g.FLOAT, false, FPV * 4, off); }
    Q.pv = g.createVertexArray(); Q.qb = g.createBuffer(); Q.ib = g.createBuffer();
    g.bindVertexArray(Q.pv); g.bindBuffer(g.ARRAY_BUFFER, Q.qb); g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
    g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    g.bindBuffer(g.ARRAY_BUFFER, Q.ib);
    g.enableVertexAttribArray(1); g.vertexAttribPointer(1, 4, g.FLOAT, false, FPI * 4, 0); g.vertexAttribDivisor(1, 1);
    g.enableVertexAttribArray(2); g.vertexAttribPointer(2, 1, g.FLOAT, false, FPI * 4, 16); g.vertexAttribDivisor(2, 1);
    g.bindVertexArray(null);
    if (mode === 'gl') { g.disable(g.DEPTH_TEST); g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA); g.clearColor(0, 0, 0, 0); } // ('under': cv-gl's state, the same blend)
    cap = 0; capP = 0; upV = -1; upFull = true;
    return Q;
  }
  const isGL = g => !!g && typeof g.createShader === 'function' && typeof g.getProgramParameter === 'function' && typeof g.createVertexArray === 'function' && typeof g.vertexAttribDivisor === 'function';
  // the canvas and its context, at the first need (an allocation, a cord, a live plug): never at boot for a project without cords
  function ensure() {
    if (dead || mode !== 'gl' || cv) return;
    let c = null, g = null;
    try {
      c = doc && typeof doc.createElement === 'function' ? doc.createElement('canvas') : null;
      g = c && typeof c.getContext === 'function' ? c.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: !!o.test, powerPreference: 'high-performance' }) : null;
    } catch (err) { g = null; }
    if (!isGL(g)) { toSvg(); return; }
    try { P = glBuild(g); } catch (err) { console.error(err); try { const x = g.getExtension && g.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e2) { /* gone */ } toSvg(); return; }
    cv = c; gl = g; ready = true;
    cv.className = 'cv-cords';
    try {
      cv.setAttribute('aria-hidden', 'true');
      cv.style.cssText = 'position:absolute;left:0;top:0;display:block;pointer-events:none;';
      if (WL && WL.parentNode === viewport && typeof viewport.insertBefore === 'function') viewport.insertBefore(cv, TP && TP.parentNode === viewport ? TP : WL.nextSibling || null); else viewport.append(cv); // ((fixer B2) under the top layer
    } catch (err) { console.error(err); }
    if (typeof cv.addEventListener === 'function') {
      cv.addEventListener('webglcontextlost', onLost, false);
      cv.addEventListener('webglcontextrestored', onRestored, false);
    }
  }
  function onLost(e) { // (cv-gl's pattern) every buffer dead; three in a minute: the SVG, live
    if (dead) return;
    try { if (e && typeof e.preventDefault === 'function') e.preventDefault(); } catch (err) { /* inert */ }
    ready = false; P = null; st.lost++;
    const t = now();
    loss.push(t); loss = loss.filter(x => t - x <= 60000);
    if (loss.length >= 3) toSvg();
  }
  function onRestored() {
    if (dead || mode !== 'gl' || !gl) return;
    try { P = glBuild(gl); ready = true; st.restored++; } catch (err) { console.error(err); ready = false; return; }
    BW = BH = -1; dirty(); wakeW();
  }
  const bufOn = () => allocOn || cords.size > 0 || !!LV;
  function bufSize(vw, vh, d) { // the drawing buffer: the viewport in device px while allocated, 0 × 0 otherwise
    if (!cv) return;
    const on = bufOn(), w = on ? Math.max(0, Math.round(vw * d)) : 0, h = on ? Math.max(0, Math.round(vh * d)) : 0;
    if (w === BW && h === BH) return;
    BW = w; BH = h; blank = true;
    try { cv.width = w; cv.height = h; cv.style.width = (on ? vw : 0) + 'px'; cv.style.height = (on ? vh : 0) + 'px'; } catch (err) { /* inert */ }
  }
  // (R2b F6) nothing allocated, no cord: the vertex buffers (the host's context under 'under') back to nothing and their JS
  // mirrors with them — stats() tells the truth, nothing is kept for a project without cords. Idempotent; re-grown by upload()
  function freeGeom() {
    if (!cap && !capP && !nStrip && !nPlug && !strip.length && !plugs.length) return;
    const g = ctxOf();
    if ((cap || capP) && g && P && P.g === g && (mode === 'under' || ready)) {
      try {
        if (cap) { g.bindBuffer(g.ARRAY_BUFFER, P.sb); g.bufferData(g.ARRAY_BUFFER, 0, g.DYNAMIC_DRAW); }
        if (capP) { g.bindBuffer(g.ARRAY_BUFFER, P.ib); g.bufferData(g.ARRAY_BUFFER, 0, g.DYNAMIC_DRAW); }
      } catch (err) { /* lost */ }
    }
    cap = capP = 0; strip = new Float32Array(0); plugs = new Float32Array(0); nStrip = nPlug = 0; builtV = 0; upV = -1;
    lay.length = 0; layOK = false; upFull = true; for (const c of DQ) c.dq = false; DQ.length = 0;
  }
  // the geometry (world px): every placed cord's smoothed polyline (the rope, or motion off its parabola) as one triangle strip
  // with degenerate joins; the plugs as instances (at the ends' points: LAB draws them at endPos). (P-1 (c)) Whole (full) when
  // the layout changed — a cord added, removed, placed or unplaced, the live rope come or gone, the quality, motion or the
  // probe —, else only the queued cords' ranges (part); the same bytes either way (tests: the twin layer with o.full)
  function build() {
    const t0 = now(), still = !motion(), pa = probeKey ? anchorIn(anch, probeKey) : null;
    if (upV !== builtV) upFull = true; // (the last build never went up: the GPU copy is stale)
    RJ.length = 0; RS.length = 0; nRun = 0;
    if (FULL || !layOK || still !== layStill || !!pa !== layProbe) full(still, pa); else part(still, pa);
    builtV = geomV; st.builds++;
    const ms = now() - t0; st.buildMs += ms; if (ms > st.buildMax) st.buildMax = ms;
  }
  // cord c (its ends in E4) into range j: its lead join (j > 0: its first vertex twice), a vertex pair a smoothed point, its
  // trail join (trail: its last vertex again — a whole build writes cord j − 1's when it reaches j, as one strip always did);
  // its plugs at instances 2j, 2j + 1; c remembers its range, its layout and the ends written
  function put(c, j, still, trail) {
    let X = c.r.X, Y = c.r.Y;
    if (still) { shown(CQ.N, E4[0], E4[1], E4[2], E4[3], sX, sY); X = sX; Y = sY; }
    const m = smooth(X, Y, CQ.N, CQ.SUB, pts), s = (c.id != null && c.id === sel ? 1 : 0) + 4 * (c.oi | 0), col = c.c | 0; // ((WC) the alpha rides in sel)
    const kn = c.s === 2; // ((WC, fixer B2) the KNOB end: its last point flagged (the shadow fades), its end instance turned along it
    const ke = kn ? cut(c, pts, m) : m - 1; // ((fixer K, P2-2) cut at the knob's rim: the end there, the points after it collapsed onto it
    let k = off(j) * FPV, kp = 2 * j * FPI;
    for (let i = 0; i < m; i++) {
      const i0 = i > 0 ? i - 1 : 0, i1 = i < m - 1 ? i + 1 : m - 1, f = kn && i >= ke ? s + KNOB.FLAG : s;
      let tx = pts[2 * i1] - pts[2 * i0], ty = pts[2 * i1 + 1] - pts[2 * i0 + 1];
      const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      strip[k++] = pts[2 * i]; strip[k++] = pts[2 * i + 1]; strip[k++] = -ty; strip[k++] = tx; strip[k++] = -1; strip[k++] = col; strip[k++] = f;
      if (j && i === 0) { strip.copyWithin(k, k - FPV, k); k += FPV; } // (the lead join: this vertex twice)
      strip[k++] = pts[2 * i]; strip[k++] = pts[2 * i + 1]; strip[k++] = -ty; strip[k++] = tx; strip[k++] = 1; strip[k++] = col; strip[k++] = f;
    }
    if (trail) strip.copyWithin(k, k - FPV, k);
    for (let e = 0; e < 4; e += 2) { // ((WC) s 2: a plug at a, the knob end where the drawn rope ends (b)
      const bk = kn && e, x = bk ? pts[2 * m - 2] : E4[e], y = bk ? pts[2 * m - 1] : E4[e + 1];
      plugs[kp++] = x; plugs[kp++] = y; plugs[kp++] = col; plugs[kp++] = kn ? (e ? 3 + endU(pts, m) : 0) : c.s ? 1 : 0; plugs[kp++] = s;
    }
    const w = c.e || (c.e = new Float64Array(4));
    w[0] = E4[0]; w[1] = E4[1]; w[2] = E4[2]; w[3] = E4[3];
    c.j = j; c.lv = layV; st.writes++;
  }
  const putProbe = (pa, n) => { let kp = 2 * n * FPI; plugs[kp++] = pa.x; plugs[kp++] = pa.y; plugs[kp++] = 0; plugs[kp++] = 2; plugs[kp++] = 0; };
  function full(still, pa) {
    layV++; lay.length = 0;
    for (const c of DQ) c.dq = false;
    DQ.length = 0;
    const n = cords.size + (LV ? 1 : 0), need = n * (PTS * 2 + 2) * FPV;
    if (strip.length < need) strip = new Float32Array(Math.ceil(need * 1.5));
    const needP = (n * 2 + 1) * FPI;
    if (plugs.length < needP) plugs = new Float32Array(Math.ceil(needP * 1.5));
    const one = c => {
      if (!c.r || (c !== LV && !c.seeded) || !endsOf(c, E4)) return;
      const j = lay.length;
      if (j) { const k = off(j) * FPV; strip.copyWithin(k - FPV, k - 2 * FPV, k - FPV); } // (cord j − 1's trail join: its last vertex again)
      put(c, j, still, false); lay.push(c);
    };
    for (const c of cords.values()) one(c);
    if (LV && !LV.taken) one(LV);
    const L = lay.length;
    if (pa) putProbe(pa, L);
    nStrip = L ? off(L - 1) + (L > 1 ? 1 : 0) + 2 * PTS : 0; nPlug = 2 * L + (pa ? 1 : 0);
    layOK = true; layStill = still; layProbe = !!pa; scanOwed = false; upFull = true; st.fulls++;
  }
  // (P-1) every placed cord's ends against those it was written with (a change no advance has read yet): a moved one queued;
  // one whose ends came or went → false (a new layout)
  function scan() {
    scanOwed = false;
    for (const r of ropes) {
      const c = r.cd, inL = c.lv === layV;
      if (!endsOf(c, E4)) { if (inL) return false; continue; }
      if (!inL) return false;
      const e = c.e;
      if (E4[0] !== e[0] || E4[1] !== e[1] || E4[2] !== e[2] || E4[3] !== e[3]) mark(c);
    }
    return true;
  }
  function part(still, pa) {
    if (scanOwed && !scan()) { full(still, pa); return; }
    const L = lay.length;
    for (const c of DQ) {
      if (!c.dq) continue;
      c.dq = false;
      if (c.lv !== layV) continue;
      if (!endsOf(c, E4)) { full(still, pa); return; }
      put(c, c.j, still, c.j < L - 1); RJ.push(c.j);
    }
    DQ.length = 0;
    if (pa) putProbe(pa, L);
    // the runs: sorted, neighbours within RUN_GAP ranges as one, past RUN_MAX runs the gap doubled
    if (!RJ.length) return;
    RJ.sort((a, b) => a - b);
    for (let gap = RUN_GAP; ; gap *= 2) {
      RS.length = 0;
      let a = RJ[0], b = RJ[0];
      for (let i = 1; i < RJ.length; i++) { const j = RJ[i]; if (j - b <= gap) b = j; else { RS.push(a, b); a = b = j; } }
      RS.push(a, b);
      if (RS.length <= 2 * RUN_MAX) break;
    }
    nRun = RS.length / 2;
  }
  function upload(g) {
    if (upV === builtV) return;
    if (upFull || FULL) { // whole (as every frame did before P-1)
      g.bindBuffer(g.ARRAY_BUFFER, P.sb);
      const bs = nStrip * FPV, bp = nPlug * FPI;
      if (bs > cap) { cap = Math.ceil(bs * 1.5); g.bufferData(g.ARRAY_BUFFER, cap * 4, g.DYNAMIC_DRAW); }
      if (bs) g.bufferSubData(g.ARRAY_BUFFER, 0, strip, 0, bs);
      g.bindBuffer(g.ARRAY_BUFFER, P.ib);
      if (bp > capP) { capP = Math.ceil(bp * 1.5); g.bufferData(g.ARRAY_BUFFER, capP * 4, g.DYNAMIC_DRAW); }
      if (bp) g.bufferSubData(g.ARRAY_BUFFER, 0, plugs, 0, bp);
      st.uploads++; st.uploadBytes += (bs + bp) * 4; st.runs += (bs ? 1 : 0) + (bp ? 1 : 0);
      upFull = false;
    } else if (nRun || layProbe) { // (P-1) the runs' ranges only (the probe's instance after the plugs: its own, or the last run's tail)
      const L = lay.length;
      let b = 0, tail = false;
      if (nRun) {
        g.bindBuffer(g.ARRAY_BUFFER, P.sb);
        for (let i = 0; i < RS.length; i += 2) {
          const v0 = off(RS[i]), v1 = RS[i + 1] < L - 1 ? off(RS[i + 1] + 1) : nStrip;
          g.bufferSubData(g.ARRAY_BUFFER, v0 * FPV * 4, strip, v0 * FPV, (v1 - v0) * FPV); b += (v1 - v0) * FPV; st.runs++;
        }
      }
      g.bindBuffer(g.ARRAY_BUFFER, P.ib);
      for (let i = 0; i < RS.length; i += 2) {
        const p0 = 2 * RS[i], p1 = 2 * RS[i + 1] + 2 + (layProbe && RS[i + 1] === L - 1 ? 1 : 0);
        if (p1 > 2 * L) tail = true;
        g.bufferSubData(g.ARRAY_BUFFER, p0 * FPI * 4, plugs, p0 * FPI, (p1 - p0) * FPI); b += (p1 - p0) * FPI; st.runs++;
      }
      if (layProbe && !tail) { g.bufferSubData(g.ARRAY_BUFFER, 2 * L * FPI * 4, plugs, 2 * L * FPI, FPI); b += FPI; st.runs++; }
      st.uploads++; st.uploadBytes += b * 4;
    }
    upV = builtV;
  }
  // one frame at the camera (≤ 3 draw calls: the shadows, the cords, the plugs); 'under': into cv-gl's frame, no clear
  function glFrame(cam, vw, vh, d) {
    const under = mode === 'under', g = under ? ctxOf() : gl;
    if (!g) return false;
    if (under && (!P || P.g !== g)) { try { P = glBuild(g); } catch (err) { console.error(err); P = null; toSvg(); return false; } }
    if (!under && (!ready || !P)) return false;
    if (!bufOn()) freeGeom(); // (R2b F6: the last cord gone, nothing allocated)
    if (!under) { bufSize(vw, vh, d); if (!(BW > 0 && BH > 0)) return false; }
    const W = under ? Math.max(0, Math.round(vw * d)) : BW, H = under ? Math.max(0, Math.round(vh * d)) : BH;
    if (builtV !== geomV) build();
    if (!under && !nStrip && !nPlug && blank) return true; // (nothing drawn, nothing to clear)
    const t0 = now();
    upload(g);
    if (!under) { g.viewport(0, 0, W, H); g.clear(g.COLOR_BUFFER_BIT); }
    U.cam[0] = cam.tx; U.cam[1] = cam.ty; U.cam[2] = cam.k; U.cam[3] = d;
    U.vp[0] = W; U.vp[1] = H; U.vp[3] = dimOn ? LOOK.OFF_ALPHA : 1;
    if (nStrip) {
      g.useProgram(P.ps); g.bindVertexArray(P.sv); g.uniform4fv(P.sCam, U.cam);
      U.vp[2] = 0; g.uniform4fv(P.sVp, U.vp); g.drawArrays(g.TRIANGLE_STRIP, 0, nStrip);
      U.vp[2] = 1; g.uniform4fv(P.sVp, U.vp); g.drawArrays(g.TRIANGLE_STRIP, 0, nStrip);
    }
    if (nPlug) {
      g.useProgram(P.pp); g.bindVertexArray(P.pv); g.uniform4fv(P.pCam, U.cam); g.uniform4fv(P.pVp, U.vp);
      g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, nPlug);
    }
    g.bindVertexArray(null);
    blank = !nStrip && !nPlug;
    const ms = now() - t0;
    st.draws++; st.drawMs += ms; if (ms > st.drawMax) st.drawMax = ms;
    return true;
  }

  /* ---- the SVG fallback: in #world above the modules (z 10001), the motion-off parabola as the lab's strokes + the plugs */
  let SV = null;
  function toSvg() {
    if (dead) return;
    freeGeom(); // (R2b F6: no canvas, no buffers, no ropes moving — stats() says so)
    BW = BH = 0; running = false;
    if (cv) { try { const x = gl && gl.getExtension && gl.getExtension('WEBGL_lose_context'); if (x && typeof x.loseContext === 'function' && ready) x.loseContext(); } catch (err) { /* gone */ } try { cv.width = 0; cv.height = 0; cv.remove(); } catch (err) { /* gone */ } }
    cv = null; gl = null; P = null; ready = false;
    mode = 'svg';
    buildSvg();
    if (SV) SV.paint(); else mode = 'none';
  }
  function buildSvg() {
    if (SV || !doc || typeof doc.createElementNS !== 'function' || !WL || typeof WL.append !== 'function') return;
    const NS = 'http://www.w3.org/2000/svg';
    let root = null;
    try { root = doc.createElementNS(NS, 'svg'); } catch (err) { root = null; }
    if (!root || typeof root.setAttribute !== 'function') return;
    root.setAttribute('class', 'cv-cords-svg'); root.setAttribute('aria-hidden', 'true');
    // (a 1 px box, the cords overflowing it: an outer <svg> 0 wide or high renders nothing — found in headless Chrome)
    try { root.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none;z-index:10001;'; } catch (err) { /* inert */ }
    WL.append(root);
    const els = new Map(), X = new Float64Array(STUDIO.N), Y = new Float64Array(STUDIO.N), Pp = new Float64Array(PTS_S * 2);
    const mk = (tag, at) => { const e = doc.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, String(at[k])); return e; };
    const rgb = c => 'rgb(' + c.join(',') + ')';
    const plug = (col, s) => (s
      ? [mk('rect', { x: -LOOK.SW / 2 + LOOK.PSH_DX, y: -LOOK.SH / 2 + LOOK.PSH_DY, width: LOOK.SW, height: LOOK.SH, rx: LOOK.SR, fill: 'rgba(0,0,0,' + LOOK.PSH_A + ')' }),
        mk('rect', { x: -LOOK.SW / 2, y: -LOOK.SH / 2, width: LOOK.SW, height: LOOK.SH, rx: LOOK.SR, fill: rgb(shade(col, LOOK.RING)) }),
        mk('rect', { x: -LOOK.SBW / 2, y: -LOOK.SBH / 2, width: LOOK.SBW, height: LOOK.SBH, rx: LOOK.SBR, fill: col }),
        mk('rect', { x: -8.1, y: -5.1, width: 9.2, height: 2.6, rx: 1.3, fill: 'rgba(255,255,255,' + LOOK.PLUG_HA + ')' })]
      : [mk('circle', { cx: LOOK.PSH_DX, cy: LOOK.PSH_DY, r: LOOK.PLUG_R, fill: 'rgba(0,0,0,' + LOOK.PSH_A + ')' }), mk('circle', { r: LOOK.PLUG_R, fill: rgb(shade(col, LOOK.RING)) }),
        mk('circle', { r: LOOK.PLUG_B, fill: col }), mk('circle', { cx: LOOK.PLUG_HD, cy: LOOK.PLUG_HD, r: LOOK.PLUG_H, fill: 'rgba(255,255,255,' + LOOK.PLUG_HA + ')' })]);
    // ((WC, fixer B2) the KNOB end, in the end's own frame (x along its heading, into the knob; the group translated to b and turned): the
    // knob's shade on the rope's last SHADE px, the knob's ring across its end (the GL instance's two bands, flat)
    const knobEnd = col => [mk('path', { d: 'M' + -KNOB.SHADE + ' ' + -HW + 'H0V' + HW + 'H' + -KNOB.SHADE + 'Z', fill: 'rgba(0,0,0,' + (KNOB.SHADE_A / 2) + ')' }),
      mk('path', { d: 'M' + -KNOB.RIM + ' ' + -(HW + 0.5) + 'H0V' + (HW + 0.5) + 'H' + -KNOB.RIM + 'Z', fill: col === PALETTE[7] ? '#8a8c90' : col, 'fill-opacity': KNOB.RIM_A })];
    SV = {
      root, els, dirty: true,
      // one cord's group: shadow, rim, body, highlight (the lab's strokes ×1.4), its two plugs (a <g> each, translated); (WC) s 2:
      // a round plug at a, the grommet at b (its orientation by the box); o (an ALPHAS index > 0): the group's opacity (none
      // otherwise: the 900 Series' bytes)
      add(c) {
        const col = PALETTE[c.c | 0] || PALETTE[0], g = mk('g', {}), ln = { fill: 'none', 'stroke-linecap': c.s === 2 ? 'butt' : 'round', 'stroke-linejoin': 'round' }; // ((fixer B2) a knob end: butt
        const p = [mk('path', Object.assign({ stroke: 'rgba(0,0,0,' + LOOK.SH_A + ')', 'stroke-width': LOOK.W, transform: 'translate(' + LOOK.SH_DX + ' ' + LOOK.SH_DY + ')' }, ln)),
          mk('path', Object.assign({ stroke: rgb(shade(col, LOOK.RIM)), 'stroke-width': LOOK.W }, ln)), mk('path', Object.assign({ stroke: col, 'stroke-width': LOOK.BODY }, ln)),
          mk('path', Object.assign({ stroke: rgb(shade(col, LOOK.LIGHT)), 'stroke-opacity': LOOK.HI_A, 'stroke-width': LOOK.HI, transform: 'translate(' + LOOK.HI_DX + ' ' + LOOK.HI_DY + ')' }, ln))];
        const ga = mk('g', {}), gb = mk('g', {});
        ga.append(...plug(col, c.s === 1)); gb.append(...(c.s === 2 ? knobEnd(col) : plug(col, c.s === 1))); // ((fixer B2) a knob end: no plug at b
        g.append(...p, ga, gb); root.append(g);
        const e = { g, p, ga, gb, c: c.c | 0, s: c.s | 0, o: 0, d: '', sel: false };
        els.set(c, e);
        return e;
      },
      path(c, e) {
        if (!endsOf(c, E4)) { if (e.d !== '') { e.d = ''; for (const q of e.p) q.setAttribute('d', ''); e.ga.setAttribute('transform', 'translate(-99999 -99999)'); e.gb.setAttribute('transform', 'translate(-99999 -99999)'); } return; }
        shown(STUDIO.N, E4[0], E4[1], E4[2], E4[3], X, Y);
        const m = smooth(X, Y, STUDIO.N, STUDIO.SUB, Pp);
        if (c.s === 2) cut(c, Pp, m); // ((fixer K, P2-2) cut at the knob's rim
        let d = 'M' + Pp[0].toFixed(1) + ' ' + Pp[1].toFixed(1);
        for (let i = 1; i < m; i++) d += 'L' + Pp[2 * i].toFixed(1) + ' ' + Pp[2 * i + 1].toFixed(1);
        if (d !== e.d) { e.d = d; for (const q of e.p) q.setAttribute('d', d); st.svgPaths++; }
        e.ga.setAttribute('transform', 'translate(' + E4[0].toFixed(1) + ' ' + E4[1].toFixed(1) + ')');
        e.gb.setAttribute('transform', c.s === 2 ? 'translate(' + Pp[2 * m - 2].toFixed(1) + ' ' + Pp[2 * m - 1].toFixed(1) + ') rotate(' + (endU(Pp, m) * 360).toFixed(1) + ')'
          : 'translate(' + E4[2].toFixed(1) + ' ' + E4[3].toFixed(1) + ')');
        const s = c.id != null && c.id === sel;
        if (s !== e.sel) { e.sel = s; e.p[1].setAttribute('stroke', s ? '#f5f5f5' : rgb(shade(PALETTE[c.c | 0] || PALETTE[0], LOOK.RIM))); }
        const oi = c.oi | 0;
        if (oi !== e.o) { // ((fixer K, P3-13) a rig's own row (index 1, 0.85): its strokes and its knob end lighter, its plug opaque
          e.o = oi;
          if (oi && oi !== 1) e.g.setAttribute('opacity', String(ALPHAS[oi])); else e.g.removeAttribute('opacity');
          for (const q of c.s === 2 ? e.p.concat([e.gb]) : e.p) { if (oi === 1) q.setAttribute('opacity', String(ALPHAS[1])); else q.removeAttribute('opacity'); }
        }
      },
      // the shown set: groups for new cords (a recolour or a plug change makes it again), gone ones removed, every path fresh
      paint() {
        SV.dirty = false;
        const want = new Set(cords.values());
        if (LV && !LV.taken) want.add(LV);
        for (const [c, e] of els) if (!want.has(c) || e.c !== (c.c | 0) || e.s !== (c.s | 0)) { e.g.remove(); els.delete(c); }
        for (const c of want) SV.path(c, els.get(c) || SV.add(c));
        try { root.style.opacity = dimOn ? String(LOOK.OFF_ALPHA) : ''; } catch (err) { /* inert */ }
      },
    };
  }

  /* ---- the API */
  const api = {
    get mode() { return mode; },
    /** The cords [{ id, a, b, c, s, o }] (a / b jack keys; c a colour index, clamped 0…7; s 0 a round plug, 1 S-trigger, (WC, fixer B2)
     * 2 the KNOB end at b (b the knob's rim); (WC) o the alpha, one of ALPHAS — absent 1): diffed by id — a new one placed (seeded asleep)
     * once its ends are known, a gone one removed, a changed end woken (its anchor's jump swept), a colour / plug / alpha change redrawn. */
    set(list) {
      if (dead) return;
      const seen = new Set();
      let n = 0;
      for (const x of Array.isArray(list) ? list : []) {
        if (!x || x.id == null || typeof x.a !== 'string' || typeof x.b !== 'string') continue;
        const id = String(x.id);
        if (seen.has(id)) continue;
        seen.add(id); n++;
        let c = cords.get(id);
        const col = colourOf(x.c), s = plugOf(x.s), oi = alphaOf(x.o); // ((WC) c clamped; s 2 the KNOB end; o an ALPHAS index
        if (!c) { c = { id, a: x.a, b: x.b, c: col, s, oi, r: null, seeded: false, rest: x.rest === true }; cords.set(id, c); } // ((fixer K) rest: seeded at rest
        else { if (c.c !== col || c.s !== s || c.oi !== oi) mark(c); c.a = x.a; c.b = x.b; c.c = col; c.s = s; c.oi = oi; c.rest = x.rest === true; } // ((P-1) a recolour: its range again; new ends: changed()'s)
        place(c);
      }
      for (const id of [...cords.keys()]) if (!seen.has(id)) { cords.delete(id); if (GB && GB.id === id) GB = null; if (sel === id) sel = null; }
      if (n && mode === 'gl') ensure();
      if (mode === 'svg' && !SV) buildSvg();
      relist(); dirty(); changed(); wakeW();
      if (SV) SV.paint();
    },
    /** The jacks' points (world px): a Map (or object) jack key → {x, y} — the track view's whole ports() map, from every
     * relayout; kept by reference, read at each frame (a module drag: a call a pointer move, the work once a frame). */
    anchors(map) {
      if (dead) return;
      anch = map || null;
      let placed = false;
      for (const c of cords.values()) if (!c.seeded && place(c)) placed = true;
      if (placed) { relist(); dirty(); wakeW(); }
      if (probeKey) dirty();
      changed();
      if (SV && SV.dirty) SV.paint();
    },
    /** A new cord's rope in flight: { a: the fixed jack's point, b: the finger's, c, s } (world px) — seeded awake at the first
     * call, its ends moved after; null: gone (a commit's set took it over, or the drag was cancelled). */
    live(x) {
      if (dead) return;
      if (!x || !x.a || !x.b || !fin(x.a.x) || !fin(x.a.y) || !fin(x.b.x) || !fin(x.b.y)) { if (LV) { LV = null; relist(); dirty(); wakeW(); if (SV) SV.paint(); } return; }
      if (LV && LV.taken) LV = null; // (the last one became a cord: a new drag)
      if (!LV) {
        LV = { id: null, a: { x: x.a.x, y: x.a.y }, b: { x: x.b.x, y: x.b.y }, c: colourOf(x.c), s: plugOf(x.s), oi: alphaOf(x.o), r: makeRope(CQ.N), taken: false };
        LV.r.cd = LV;
        seed(LV.r, x.a.x, x.a.y, x.b.x, x.b.y, true);
        if (mode === 'gl') ensure();
        relist(); dirty(); kick();
      } else {
        const col = colourOf(x.c), s = plugOf(x.s), oi = alphaOf(x.o);
        if (col !== LV.c || s !== LV.s || oi !== LV.oi) mark(LV); // ((WC) a look change alone: its range again)
        LV.a.x = x.a.x; LV.a.y = x.a.y; LV.b.x = x.b.x; LV.b.y = x.b.y; LV.c = col; LV.s = s; LV.oi = oi; dirty(); changed();
      }
      if (SV) SV.paint();
    },
    /** A plugged end pulled: cord `id`'s end ('a' | 'b') follows p (world px) until drop(). */
    grab(id, end, p) {
      if (dead || !cords.has(String(id)) || (end !== 'a' && end !== 'b') || !p || !fin(p.x) || !fin(p.y)) return;
      GB = { id: String(id), end, p: { x: p.x, y: p.y } };
      dirty(); changed(); if (SV) SV.paint();
    },
    move(p) { if (dead || !GB || !p || !fin(p.x) || !fin(p.y)) return; GB.p.x = p.x; GB.p.y = p.y; dirty(); changed(); if (SV) SV.paint(); },
    /** The pulled end let go: it springs to its jack's anchor (after a re-patch's set: the new jack; a cancel: its own). */
    drop() { if (dead || !GB) return; GB = null; dirty(); changed(); if (SV) SV.paint(); },
    /** The selected cord (its menu open): a light outline; null none. */
    sel(id) { const v = id == null ? null : String(id); if (v === sel || dead) return; mark(cords.get(sel)); sel = v; mark(cords.get(v)); dirty(); wakeW(); if (SV) SV.paint(); },
    /** The drawing buffer while a patched instrument is shown (the host's; also while any cord exists) — 0 × 0 otherwise. */
    alloc(on) {
      if (dead) return;
      allocOn = !!on;
      if (allocOn && mode === 'gl') ensure();
      if (!bufOn()) { bufSize(0, 0, 1); freeGeom(); } else { owedF = true; wakeW(); }
    },
    /** A powered-off instrument: the cords at OFF_ALPHA (cv-face's). */
    dim(on) { on = !!on; if (on === dimOn || dead) return; dimOn = on; owedF = true; wakeW(); if (SV) SV.paint(); },
    resize(vw, vh, d) { VW = Math.max(0, +vw || 0); VH = Math.max(0, +vh || 0); VD = +d > 0 ? +d : 1; owedF = true; },
    /** The world's frame at time T (ms): the ropes advanced — nothing while all sleep → whether a draw is owed (a step moved
     * them, an end moved, a change since the last draw). hold: the world's hold rule says this frame steps nothing (a camera
     * burst whose last frame took > HOLD_MS — measured by the world, frame to frame). */
    step(T, h) {
      if (dead || !running) return owedF;
      if (!motion()) { running = false; return owedF; }
      const t0 = now(), hold = HOLD && !!h;
      if (hold) st.holds++;
      const all = endsDirty, list = all ? ropes : act;
      endsDirty = false;
      const r = advance(sim, list, T, ropeEnds, { hold });
      st.frames++; st.ropeSteps += r.ropeSteps; if (r.awake > st.awakeMax) st.awakeMax = r.awake;
      if (r.ropeSteps || r.moved) dirty();
      // (P-1) the ropes advance moved (stepped, an end moved) queued for their ranges; one whose ends came or went: a new
      // layout. When it read every rope's ends, nothing is left for a scan. The awake ones are the next step's list
      if (layOK) for (const q of list) { const c = q.cd; if (q.skip ? c.lv === layV : c.lv !== layV) layOK = false; if (q.mv) { q.mv = false; mark(c); } }
      else for (const q of list) q.mv = false;
      if (all) scanOwed = false;
      const nx = list === act ? act2 : act;
      nx.length = 0; for (const q of list) if (q.awake) nx.push(q);
      act2 = nx === act ? act2 : act; act = nx;
      running = r.left > 0;
      const ms = now() - t0; st.stepMs += ms; if (ms > st.stepMax) st.stepMax = ms;
      return owedF;
    },
    owed: () => !dead && ((owedF && mode !== 'svg' && mode !== 'none') || topOwed), // ((fixer B2) the top layer waits for its first camera too
    /** Frames wanted: a rope awake, or a draw owed. */
    wants: () => !dead && (running || api.owed()),
    /** One frame at the camera (the world's: from its write(), or after a step) over a vw × vh viewport at device ratio d. */
    draw(cam, vw, vh, d) {
      if (dead || !cam) return false;
      if (vw != null) { VW = Math.max(0, +vw || 0); VH = Math.max(0, +vh || 0); VD = +d > 0 ? +d : 1; }
      lastCam = cam;
      if (TP) placeTop(cam); // ((fixer B2) the top layer at this camera, every mode
      if (mode === 'svg' || mode === 'none') { owedF = false; return false; }
      const ok = glFrame(cam, VW, VH, VD);
      owedF = false;
      return ok;
    },
    /** (WC, fixer B2; review 2 P2-3) The top layer: a world-space div.cv-cords-top after the canvas (after #world without one) in the
     * viewport, ABOVE the cords — what must never lie under a rope goes there (the host's claimed badges, a cord's ×, a fork's BAL:
     * cv-cables o.top); pointer-events none (its children take their own); moved with the camera at every draw (#world's transform),
     * hidden until a camera is known (a draw asked). Made at the first call only; null without a DOM. */
    top() {
      if (dead) return null;
      if (TP) return TP;
      let e = null;
      try { e = doc && typeof doc.createElement === 'function' ? doc.createElement('div') : null; } catch (err) { e = null; }
      if (!e || typeof e.setAttribute !== 'function') return null;
      TP = e; tpT = '';
      try {
        e.className = 'cv-cords-top';
        e.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0;pointer-events:none;';
        const after = cv && cv.parentNode === viewport ? cv : WL && WL.parentNode === viewport ? WL : null;
        if (after && typeof viewport.insertBefore === 'function') viewport.insertBefore(e, after.nextSibling || null); else viewport.append(e);
      } catch (err) { console.error(err); }
      if (lastCam) placeTop(lastCam); else { topOwed = true; try { e.style.visibility = 'hidden'; } catch (err) { /* inert */ } wakeW(); }
      return TP;
    },
    /** (tests, the harness) a point at fraction t of cord id's drawn path (world px), null unknown. */
    pointAt(id, t) {
      const c = cords.get(String(id));
      if (!c || !c.seeded || !endsOf(c, E4)) return null;
      let X = c.r.X, Y = c.r.Y;
      if (!motion()) { shown(CQ.N, E4[0], E4[1], E4[2], E4[3], sX, sY); X = sX; Y = sY; }
      const m = smooth(X, Y, CQ.N, CQ.SUB, pts), e = c.s === 2 ? cut(c, pts, m) : m - 1; // ((fixer K) a knob end's rope as drawn: cut at the rim
      return along(pts, e + 1, t);
    },
    /** (WC, integration fixer K; review P2-1) the drawn rope AT REST between ends a and b ({x, y} world px) into out (x, y pairs) → its
     * point count: what this layer shows once a cord there has settled — the settled Studio rope (restPath) with motion at its
     * quality, the parabola still (Low, reduced motion) and in the SVG fallback. The host places badges on it and aims knob ends
     * along it. Pure (scratch arrays only). */
    shape(a, b, out) {
      if (!a || !b || !out || !fin(a.x) || !fin(a.y) || !fin(b.x) || !fin(b.y)) return 0;
      const q = mode === 'svg' || mode === 'none' ? SVG_Q : motion() ? CQ : CQ.still ? CQ : { N: CQ.N, SUB: CQ.SUB, still: true };
      return restPath(a.x, a.y, b.x, b.y, out, q);
    },
    /** (WC, IMPL-WC §4.4; the lead's decision 2) the cord whose drawn rope passes nearest p (world px), within r (world px — the
     * host's 12 screen px / k), else null: a pure distance over each placed cord's drawn polyline as it is now (the rope swinging or
     * settled, motion off its parabola, the SVG's 10 / 4 one), never the live rope, never a cord with an end unknown; ok(id) →
     * false skips one (the host leaves patch cords out). The layer still takes no press — the world asks this on an empty-canvas
     * press (a tap there selects the cord: parity with a line). Allocates nothing. */
    hit(p, r, ok) {
      if (dead || !p || !fin(p.x) || !fin(p.y) || !fin(r) || !(r > 0)) return null;
      const svgM = mode === 'svg' || mode === 'none', still = svgM || !motion(), N = svgM ? STUDIO.N : CQ.N, SUB = svgM ? STUDIO.SUB : CQ.SUB, px = p.x, py = p.y;
      let best = null, bd = r * r;
      for (const c of cords.values()) {
        if (!c.seeded || !c.r || !endsOf(c, E4)) continue;
        if (typeof ok === 'function') { let y = false; try { y = !!ok(c.id); } catch (err) { y = false; } if (!y) continue; }
        let X = c.r.X, Y = c.r.Y;
        if (still || c.r.n !== N) { shown(N, E4[0], E4[1], E4[2], E4[3], hX, hY); X = hX; Y = hY; }
        const m = smooth(X, Y, N, SUB, hP);
        if (c.s === 2) cut(c, hP, m); // ((fixer K) a knob end's rope as drawn: cut at the rim
        for (let i = 0; i < m - 1; i++) {
          const ax = hP[2 * i], ay = hP[2 * i + 1], dx = hP[2 * i + 2] - ax, dy = hP[2 * i + 3] - ay, L = dx * dx + dy * dy;
          const u = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0, ex = ax + dx * u - px, ey = ay + dy * u - py, d = ex * ex + ey * ey;
          if (d <= bd) { bd = d; best = c.id; }
        }
      }
      return best;
    },
    /** (diagnostics: the bench / the harness set cords swinging — no input reaches it) pluck cord id, or every cord. */
    pluck(id) {
      if (dead || !motion()) return;
      for (const c of cords.values()) if ((id == null || c.id === String(id)) && c.seeded) pluck(c.r, (c.r.n - 1) / 2);
      endsDirty = true; // (woken outside advance: the next step reads every rope)
      kick();
    },
    /** (diagnostics: the glue probe, IMPL-9 §5 (c)) a magenta 4-device-px disc at a jack key's anchor; null off. */
    probe(key) { probeKey = key == null ? null : String(key); dirty(); wakeW(); },
    /** The host context's programs are gone (cv-gl lost or restored, 'under'): made again at the next draw. */
    reset() { if (mode === 'under') { P = null; dirty(); } },
    /** To the SVG fallback now (cv-gl given up, 'under'). */
    svg() { if (mode !== 'svg') toSvg(); },
    /** (P, IMPL-P §1.2) the device's performance preset: 'high' | 'medium' | 'low' (anything else 'high') → the cords' quality
     * (CORD_Q). Every rope made again at its N and re-seeded asleep from the parabola of its ends — a switch never shows a
     * stale rope's jump (the look of a project just opened; the live rope awake, as live() seeds it); still: no ticker; the
     * strip rebuilt whole at the next draw (one is asked for). */
    setPerf(id) {
      const p = perfOf(id);
      if (dead || p === perf) return;
      perf = p; CQ = CORD_Q[p]; PTS = ptsOf(CQ);
      for (const c of cords.values()) {
        if (!c.r) continue;
        c.r = makeRope(CQ.N); c.r.cd = c;
        if (c.seeded) { if (!endsOf(c, E4)) c.seeded = false; else if (c.rest) seedRest(c.r, E4[0], E4[1], E4[2], E4[3]); else seed(c.r, E4[0], E4[1], E4[2], E4[3], false); } // (ends unknown: placed when known; (fixer K) a rig's cord at rest)
      }
      if (LV && !LV.taken) { LV.r = makeRope(CQ.N); LV.r.cd = LV; seed(LV.r, LV.a.x, LV.a.y, LV.b.x, LV.b.y, true); }
      running = false; sim.acc = 0;
      relist(); layOK = false; dirty();
      if (LV && !LV.taken && motion()) kick(); else wakeW();
      if (SV) SV.paint();
    },
    get perf() { return perf; },
    stats(reset) {
      let awake = 0;
      if (motion()) for (const r of ropes) if (r.awake) awake++; // (R2b F6: the SVG / motion off never move a rope)
      const s = { mode, ready: mode === 'under' ? !!P : ready, cords: cords.size, live: !!LV, held: !!GB, awake, running, frames: st.frames, steps: st.ropeSteps,
        stepMs: st.frames ? st.stepMs / st.frames : 0, stepMax: st.stepMax, awakeMax: st.awakeMax, holds: st.holds, draws: st.draws,
        drawMs: st.draws ? st.drawMs / st.draws : 0, drawMax: st.drawMax, uploads: st.uploads, uploadBytes: st.uploadBytes, builds: st.builds, lost: st.lost,
        restored: st.restored, svgPaths: st.svgPaths, alloc: allocOn, buffer: BW > 0 ? BW + '×' + BH : '0×0',
        bytes: (BW > 0 ? BW * BH * 4 : 0) + (cap + capP) * 4, verts: nStrip, plugs: nPlug,
        // (P) the preset, its quality and drawn points a cord; (P-1) whole builds, cords written, upload calls, build ms
        perf, quality: CQ.q, pts: PTS, fulls: st.fulls, writes: st.writes, runs: st.runs, buildMs: st.builds ? st.buildMs / st.builds : 0, buildMax: st.buildMax };
      if (reset) Object.assign(st, { frames: 0, ropeSteps: 0, stepMs: 0, stepMax: 0, awakeMax: 0, holds: 0, draws: 0, drawMs: 0, drawMax: 0, uploads: 0, uploadBytes: 0, builds: 0, svgPaths: 0,
        fulls: 0, writes: 0, runs: 0, buildMs: 0, buildMax: 0 });
      return s;
    },
    destroy() {
      if (dead) return;
      dead = true; running = false;
      if (cv) {
        try { cv.removeEventListener('webglcontextlost', onLost, false); cv.removeEventListener('webglcontextrestored', onRestored, false); } catch (err) { /* gone */ }
        try { const x = gl && gl.getExtension && gl.getExtension('WEBGL_lose_context'); if (x && typeof x.loseContext === 'function') x.loseContext(); } catch (err) { /* gone */ }
        try { cv.width = 0; cv.height = 0; cv.remove(); } catch (err) { /* gone */ }
      }
      if (SV) { try { SV.root.remove(); } catch (err) { /* gone */ } }
      if (TP) { try { TP.remove(); } catch (err) { /* gone */ } }
      cv = null; gl = null; P = null; SV = null; TP = null; cords.clear(); ropes = []; LV = null; GB = null;
    },
  };
  if (mode === 'svg') buildSvg();
  if (mode === 'svg' && !SV) mode = 'none';
  return api;
}
