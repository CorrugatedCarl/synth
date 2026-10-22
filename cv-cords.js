// cv-cords.js — the patch cords (stage 9, docs/canvas/IMPL-9.md §4.3, §7.4, §12 "Lane C9"; lane C9): the cords of a patched
// instrument drawn over its modules with the cord lab's approved Studio feel (docs/canvas/ref/cord-lab.html, "LAB") — a
// 10-point verlet rope per cord, 1/120 s fixed steps, its ends pinned to the plugs. Generic (D5): no family's name, number or
// constant; a cord is { id, a, b, c, s } — two jack keys, a colour index, s 1 for an S-trigger (Cinch-Jones) plug.
// The user's rule (2026-10-21, §11): a cord's body is not interactive at all — nothing here takes a press (the layer is
//   pointer-events: none; no hit test, no pluck by hand, no body grab); only the plug ends move, by cv-patch's drag through
//   grab / move / drop (a plugged end pulled) and live (a new cord's free plug).
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
 * share); `hold`: no step this frame (its time dropped). sim = { acc, last } (ms). Pure but for the ropes and sim.
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
    if (Math.abs(r.A1x - r.A0x) + Math.abs(r.A1y - r.A0y) + Math.abs(r.B1x - r.B0x) + Math.abs(r.B1y - r.B0y) > S.WAKE_PX) { r.awake = true; moved = true; }
    else if (r.A1x !== r.A0x || r.A1y !== r.A0y || r.B1x !== r.B0x || r.B1y !== r.B0y) moved = true;
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
// the strip: a vertex = the smoothed polyline's point p, its normal n, a = (side ±1, colour, selected); widened by the half width
// (≥ MIN_DPX / 2 device px) + one device px of ramp; v runs −1…1 across the cord (|v| > 1: the ramp), the bands by |v|: the
// body inside BODY / W, the rim outside; the highlight a band of HI / W around hc (the lab's offset stroke's normal part);
// pass 0 = the shadow (offset, black SH_A), pass 1 = the cord; vp.w the layer's alpha
const STRIP_VS = '#version 300 es\nlayout(location=0) in vec2 p;layout(location=1) in vec2 n;layout(location=2) in vec3 a;\n'
  + 'uniform vec4 cam;uniform vec4 vp;uniform vec3 body[8];uniform vec3 rim[8];uniform vec3 hi[8];\n'
  + 'out float v;out float hc;flat out vec3 cb;flat out vec3 cr;flat out vec3 ch;flat out float sl;flat out float wpx;\n'
  + 'void main(){float kd=cam.z*cam.w;float hw=max(' + f1(HW) + ',' + f1(LOOK.MIN_DPX / 2) + '/kd);float pad=1.0/kd;'
  + 'vec2 w=p+n*a.x*(hw+pad);if(vp.z<0.5)w+=vec2(' + f1(LOOK.SH_DX) + ',' + f1(LOOK.SH_DY) + ');'
  + 'v=a.x*(hw+pad)/hw;hc=dot(vec2(' + f1(LOOK.HI_DX) + ',' + f1(LOOK.HI_DY) + '),n)/' + f1(HW) + ';'
  + 'int i=int(a.y+0.5);cb=body[i];cr=rim[i];ch=hi[i];sl=a.z;wpx=hw*kd;'
  + 'vec2 dv=(w*cam.z+cam.xy)*cam.w;gl_Position=vec4(dv.x/vp.x*2.0-1.0,1.0-dv.y/vp.y*2.0,0.0,1.0);}';
const STRIP_FS = '#version 300 es\nprecision highp float;uniform vec4 vp;\n'
  + 'in float v;in float hc;flat in vec3 cb;flat in vec3 cr;flat in vec3 ch;flat in float sl;flat in float wpx;out vec4 o;\n'
  + 'void main(){float a=abs(v),aa=max(fwidth(v),1e-4);float cov=clamp((1.0-a)/aa+0.5,0.0,1.0)*vp.w;'
  + 'if(vp.z<0.5){o=vec4(0.0,0.0,0.0,' + f1(LOOK.SH_A) + '*cov);return;}'
  + 'vec3 c=mix(cr,cb,clamp((' + (LOOK.BODY / LOOK.W).toFixed(6) + '-a)/aa+0.5,0.0,1.0));'
  + 'c=mix(c,ch,clamp((' + (LOOK.HI / LOOK.W).toFixed(6) + '-abs(v-hc))/aa+0.5,0.0,1.0)*' + f1(LOOK.HI_A) + ');'
  + 'if(sl>0.5)c=mix(c,vec3(' + f1(LOOK.SEL) + '),clamp((a-(1.0-2.0/max(wpx,1.0)))/aa+0.5,0.0,1.0)*0.9);'
  + 'o=vec4(c*cov,cov);}';
// the plugs: one instanced quad an end (ins = x, y, colour, shape: 0 round, 1 S-trigger, 2 the glue probe; fl = selected), an
// SDF in world px with a one-device-px ramp; layers composited front to back over: shadow, ring, body, the S plug's parting
// line, highlight, the selected ring
const PLUG_EXT = 22;
const PLUG_VS = '#version 300 es\nlayout(location=0) in vec2 q;layout(location=1) in vec4 ins;layout(location=2) in float fl;\n'
  + 'uniform vec4 cam;uniform vec4 vp;uniform vec3 body[8];uniform vec3 ring[8];\n'
  + 'out vec2 lp;flat out vec3 cb;flat out vec3 cr;flat out float shp;flat out float px;flat out float sl;\n'
  + 'void main(){float kd=cam.z*cam.w;float R=' + f1(PLUG_EXT) + '+2.0/kd;vec2 w=ins.xy+q*R;lp=q*R;int i=int(ins.z+0.5);'
  + 'cb=body[i];cr=ring[i];shp=ins.w;px=1.0/kd;sl=fl;'
  + 'vec2 dv=(w*cam.z+cam.xy)*cam.w;gl_Position=vec4(dv.x/vp.x*2.0-1.0,1.0-dv.y/vp.y*2.0,0.0,1.0);}';
const PLUG_FS = '#version 300 es\nprecision highp float;uniform vec4 vp;\n'
  + 'in vec2 lp;flat in vec3 cb;flat in vec3 cr;flat in float shp;flat in float px;flat in float sl;out vec4 o;\n'
  + 'float cv(float sd){return clamp(0.5-sd/px,0.0,1.0);}\n'
  + 'float rb(vec2 p,vec2 b,float r){vec2 d=abs(p)-b+r;return length(max(d,0.0))+min(max(d.x,d.y),0.0)-r;}\n'
  + 'vec4 ov(vec4 s,vec4 d){return s+d*(1.0-s.a);}\n'
  + 'void main(){'
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
  + 'o=c*vp.w;}';
const FPV = 7, FPI = 5, PTS = 2 + (STUDIO.N - 2) * STUDIO.SUB; // floats a strip vertex / a plug instance; points a smoothed cord
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
 * (mode 'under': cv-gl's), test (preserveDrawingBuffer), reduced() → prefers-reduced-motion, hold (the hold rule; default on) }.
 * @returns {{set: Function, anchors: Function, live: Function, grab: Function, move: Function, drop: Function, sel: Function,
 *   alloc: Function, dim: Function, resize: Function, step: Function, owed: Function, wants: Function, draw: Function,
 *   pointAt: Function, pluck: Function, probe: Function, reset: Function, svg: Function, stats: Function, destroy: Function,
 *   readonly mode: string}}
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
  const HOLD = o.hold !== false;
  let mode = o.mode === 'svg' || o.mode === 'under' ? o.mode : 'gl'; // ('none': nothing can draw — a stub DOM)

  /* ---- state */
  const cords = new Map(); // id → { id, a, b, c, s, r (rope), seeded }
  let ropes = []; // the ropes stepped (the cords' + the live one's), rebuilt on add / remove — never per frame
  let anch = null, LV = null, GB = null, sel = null, probeKey = null, allocOn = false, dimOn = false, dead = false;
  let running = false, owedF = false, geomV = 1;
  const sim = { acc: 0, last: 0 };
  const st = { frames: 0, ropeSteps: 0, stepMs: 0, stepMax: 0, awakeMax: 0, holds: 0, draws: 0, drawMs: 0, drawMax: 0, uploads: 0, uploadBytes: 0,
    builds: 0, lost: 0, restored: 0, svgPaths: 0 };
  let VW = 0, VH = 0, VD = 1, lastCam = null;
  const E4 = new Float64Array(4);
  const relist = () => { ropes = []; for (const c of cords.values()) if (c.r && c.seeded) ropes.push(c.r); if (LV && LV.r && !LV.taken) ropes.push(LV.r); };
  const motion = () => (mode === 'gl' || mode === 'under') && !reduced();
  // an end's point: the plug in the finger (grab), a live end, else the jack's anchor
  function endOf(c, which) {
    if (c === LV) return which === 'a' ? LV.a : LV.b;
    if (GB && GB.id === c.id && GB.end === which) return GB.p;
    return anchorIn(anch, c[which]);
  }
  function endsOf(c, E) { const a = endOf(c, 'a'), b = endOf(c, 'b'); if (!a || !b) return false; E[0] = a.x; E[1] = a.y; E[2] = b.x; E[3] = b.y; return true; }
  const ropeEnds = (r, E) => endsOf(r.cd, E);
  // a cord placed once both its ends are known: seeded asleep from the parabola — or, a new cord the live one just became (a
  // commit's set: its fixed end on the live rope's), that rope taken over awake, so it swings into place
  function place(c) {
    if (c.seeded || !endsOf(c, E4)) return false;
    const r = c.r || (c.r = makeRope());
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
    } else seed(r, E4[0], E4[1], E4[2], E4[3], false);
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
  // a redraw (re-path) owed
  function changed() {
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
  const pts = new Float64Array(PTS * 2), sX = new Float64Array(STUDIO.N), sY = new Float64Array(STUDIO.N);
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
    cap = 0; capP = 0; upV = -1;
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
      if (WL && WL.parentNode === viewport && typeof viewport.insertBefore === 'function') viewport.insertBefore(cv, WL.nextSibling || null); else viewport.append(cv);
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
  }
  // the geometry (world px): every placed cord's smoothed polyline (the rope, or motion off its parabola) as one triangle strip
  // with degenerate joins; the plugs as instances (at the ends' points: LAB draws them at endPos)
  function build() {
    const n = cords.size + (LV ? 1 : 0), need = n * (PTS * 2 + 2) * FPV;
    if (strip.length < need) strip = new Float32Array(Math.ceil(need * 1.5));
    const needP = (n * 2 + 1) * FPI;
    if (plugs.length < needP) plugs = new Float32Array(Math.ceil(needP * 1.5));
    const still = !motion();
    let k = 0, kp = 0, first = true;
    const one = c => {
      if (!c.r || (c !== LV && !c.seeded) || !endsOf(c, E4)) return;
      let X = c.r.X, Y = c.r.Y;
      if (still) { shown(STUDIO.N, E4[0], E4[1], E4[2], E4[3], sX, sY); X = sX; Y = sY; }
      const m = smooth(X, Y, STUDIO.N, STUDIO.SUB, pts), s = c.id != null && c.id === sel ? 1 : 0, col = c.c | 0;
      for (let i = 0; i < m; i++) {
        const i0 = i > 0 ? i - 1 : 0, i1 = i < m - 1 ? i + 1 : m - 1;
        let tx = pts[2 * i1] - pts[2 * i0], ty = pts[2 * i1 + 1] - pts[2 * i0 + 1];
        const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
        if (!first && i === 0) { strip.copyWithin(k, k - FPV, k); k += FPV; } // (the degenerate join: the last vertex again …)
        strip[k++] = pts[2 * i]; strip[k++] = pts[2 * i + 1]; strip[k++] = -ty; strip[k++] = tx; strip[k++] = -1; strip[k++] = col; strip[k++] = s;
        if (!first && i === 0) { strip.copyWithin(k, k - FPV, k); k += FPV; } // (… and this one twice)
        strip[k++] = pts[2 * i]; strip[k++] = pts[2 * i + 1]; strip[k++] = -ty; strip[k++] = tx; strip[k++] = 1; strip[k++] = col; strip[k++] = s;
      }
      first = false;
      for (let e = 0; e < 4; e += 2) { plugs[kp++] = E4[e]; plugs[kp++] = E4[e + 1]; plugs[kp++] = col; plugs[kp++] = c.s ? 1 : 0; plugs[kp++] = s; }
    };
    for (const c of cords.values()) one(c);
    if (LV && !LV.taken) one(LV);
    const pa = probeKey ? anchorIn(anch, probeKey) : null;
    if (pa) { plugs[kp++] = pa.x; plugs[kp++] = pa.y; plugs[kp++] = 0; plugs[kp++] = 2; plugs[kp++] = 0; }
    nStrip = k / FPV; nPlug = kp / FPI; builtV = geomV; st.builds++;
  }
  function upload(g) {
    if (upV === builtV) return;
    g.bindBuffer(g.ARRAY_BUFFER, P.sb);
    const bs = nStrip * FPV, bp = nPlug * FPI;
    if (bs > cap) { cap = Math.ceil(bs * 1.5); g.bufferData(g.ARRAY_BUFFER, cap * 4, g.DYNAMIC_DRAW); }
    if (bs) g.bufferSubData(g.ARRAY_BUFFER, 0, strip, 0, bs);
    g.bindBuffer(g.ARRAY_BUFFER, P.ib);
    if (bp > capP) { capP = Math.ceil(bp * 1.5); g.bufferData(g.ARRAY_BUFFER, capP * 4, g.DYNAMIC_DRAW); }
    if (bp) g.bufferSubData(g.ARRAY_BUFFER, 0, plugs, 0, bp);
    st.uploads++; st.uploadBytes += (bs + bp) * 4;
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
    const els = new Map(), X = new Float64Array(STUDIO.N), Y = new Float64Array(STUDIO.N), Pp = new Float64Array(PTS * 2);
    const mk = (tag, at) => { const e = doc.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, String(at[k])); return e; };
    const rgb = c => 'rgb(' + c.join(',') + ')';
    const plug = (col, s) => (s
      ? [mk('rect', { x: -LOOK.SW / 2 + LOOK.PSH_DX, y: -LOOK.SH / 2 + LOOK.PSH_DY, width: LOOK.SW, height: LOOK.SH, rx: LOOK.SR, fill: 'rgba(0,0,0,' + LOOK.PSH_A + ')' }),
        mk('rect', { x: -LOOK.SW / 2, y: -LOOK.SH / 2, width: LOOK.SW, height: LOOK.SH, rx: LOOK.SR, fill: rgb(shade(col, LOOK.RING)) }),
        mk('rect', { x: -LOOK.SBW / 2, y: -LOOK.SBH / 2, width: LOOK.SBW, height: LOOK.SBH, rx: LOOK.SBR, fill: col }),
        mk('rect', { x: -8.1, y: -5.1, width: 9.2, height: 2.6, rx: 1.3, fill: 'rgba(255,255,255,' + LOOK.PLUG_HA + ')' })]
      : [mk('circle', { cx: LOOK.PSH_DX, cy: LOOK.PSH_DY, r: LOOK.PLUG_R, fill: 'rgba(0,0,0,' + LOOK.PSH_A + ')' }), mk('circle', { r: LOOK.PLUG_R, fill: rgb(shade(col, LOOK.RING)) }),
        mk('circle', { r: LOOK.PLUG_B, fill: col }), mk('circle', { cx: LOOK.PLUG_HD, cy: LOOK.PLUG_HD, r: LOOK.PLUG_H, fill: 'rgba(255,255,255,' + LOOK.PLUG_HA + ')' })]);
    SV = {
      root, els, dirty: true,
      // one cord's group: shadow, rim, body, highlight (the lab's strokes ×1.4), its two plugs (a <g> each, translated)
      add(c) {
        const col = PALETTE[c.c | 0] || PALETTE[0], g = mk('g', {}), ln = { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
        const p = [mk('path', Object.assign({ stroke: 'rgba(0,0,0,' + LOOK.SH_A + ')', 'stroke-width': LOOK.W, transform: 'translate(' + LOOK.SH_DX + ' ' + LOOK.SH_DY + ')' }, ln)),
          mk('path', Object.assign({ stroke: rgb(shade(col, LOOK.RIM)), 'stroke-width': LOOK.W }, ln)), mk('path', Object.assign({ stroke: col, 'stroke-width': LOOK.BODY }, ln)),
          mk('path', Object.assign({ stroke: rgb(shade(col, LOOK.LIGHT)), 'stroke-opacity': LOOK.HI_A, 'stroke-width': LOOK.HI, transform: 'translate(' + LOOK.HI_DX + ' ' + LOOK.HI_DY + ')' }, ln))];
        const ga = mk('g', {}), gb = mk('g', {});
        ga.append(...plug(col, c.s)); gb.append(...plug(col, c.s));
        g.append(...p, ga, gb); root.append(g);
        const e = { g, p, ga, gb, c: c.c | 0, s: !!c.s, d: '', sel: false };
        els.set(c, e);
        return e;
      },
      path(c, e) {
        if (!endsOf(c, E4)) { if (e.d !== '') { e.d = ''; for (const q of e.p) q.setAttribute('d', ''); e.ga.setAttribute('transform', 'translate(-99999 -99999)'); e.gb.setAttribute('transform', 'translate(-99999 -99999)'); } return; }
        shown(STUDIO.N, E4[0], E4[1], E4[2], E4[3], X, Y);
        const m = smooth(X, Y, STUDIO.N, STUDIO.SUB, Pp);
        let d = 'M' + Pp[0].toFixed(1) + ' ' + Pp[1].toFixed(1);
        for (let i = 1; i < m; i++) d += 'L' + Pp[2 * i].toFixed(1) + ' ' + Pp[2 * i + 1].toFixed(1);
        if (d !== e.d) { e.d = d; for (const q of e.p) q.setAttribute('d', d); st.svgPaths++; }
        e.ga.setAttribute('transform', 'translate(' + E4[0].toFixed(1) + ' ' + E4[1].toFixed(1) + ')');
        e.gb.setAttribute('transform', 'translate(' + E4[2].toFixed(1) + ' ' + E4[3].toFixed(1) + ')');
        const s = c.id != null && c.id === sel;
        if (s !== e.sel) { e.sel = s; e.p[1].setAttribute('stroke', s ? '#f5f5f5' : rgb(shade(PALETTE[c.c | 0] || PALETTE[0], LOOK.RIM))); }
      },
      // the shown set: groups for new cords (a recolour or a plug change makes it again), gone ones removed, every path fresh
      paint() {
        SV.dirty = false;
        const want = new Set(cords.values());
        if (LV && !LV.taken) want.add(LV);
        for (const [c, e] of els) if (!want.has(c) || e.c !== (c.c | 0) || e.s !== !!c.s) { e.g.remove(); els.delete(c); }
        for (const c of want) SV.path(c, els.get(c) || SV.add(c));
        try { root.style.opacity = dimOn ? String(LOOK.OFF_ALPHA) : ''; } catch (err) { /* inert */ }
      },
    };
  }

  /* ---- the API */
  const api = {
    get mode() { return mode; },
    /** The cords [{ id, a, b, c, s }] (a / b jack keys): diffed by id — a new one placed (seeded asleep) once its ends are known,
     * a gone one removed, a changed end woken (its anchor's jump swept), a colour / plug change redrawn. */
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
        if (!c) { c = { id, a: x.a, b: x.b, c: x.c | 0, s: x.s ? 1 : 0, r: null, seeded: false }; cords.set(id, c); }
        else { c.a = x.a; c.b = x.b; c.c = x.c | 0; c.s = x.s ? 1 : 0; }
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
        LV = { id: null, a: { x: x.a.x, y: x.a.y }, b: { x: x.b.x, y: x.b.y }, c: x.c | 0, s: x.s ? 1 : 0, r: makeRope(), taken: false };
        LV.r.cd = LV;
        seed(LV.r, x.a.x, x.a.y, x.b.x, x.b.y, true);
        if (mode === 'gl') ensure();
        relist(); dirty(); kick();
      } else { LV.a.x = x.a.x; LV.a.y = x.a.y; LV.b.x = x.b.x; LV.b.y = x.b.y; LV.c = x.c | 0; LV.s = x.s ? 1 : 0; dirty(); changed(); }
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
    sel(id) { const v = id == null ? null : String(id); if (v === sel || dead) return; sel = v; dirty(); wakeW(); if (SV) SV.paint(); },
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
      const r = advance(sim, ropes, T, ropeEnds, { hold });
      st.frames++; st.ropeSteps += r.ropeSteps; if (r.awake > st.awakeMax) st.awakeMax = r.awake;
      if (r.ropeSteps || r.moved) dirty();
      running = r.left > 0;
      const ms = now() - t0; st.stepMs += ms; if (ms > st.stepMax) st.stepMax = ms;
      return owedF;
    },
    owed: () => owedF && !dead && mode !== 'svg' && mode !== 'none',
    /** Frames wanted: a rope awake, or a draw owed. */
    wants: () => !dead && (running || api.owed()),
    /** One frame at the camera (the world's: from its write(), or after a step) over a vw × vh viewport at device ratio d. */
    draw(cam, vw, vh, d) {
      if (dead || !cam) return false;
      if (vw != null) { VW = Math.max(0, +vw || 0); VH = Math.max(0, +vh || 0); VD = +d > 0 ? +d : 1; }
      lastCam = cam;
      if (mode === 'svg' || mode === 'none') { owedF = false; return false; }
      const ok = glFrame(cam, VW, VH, VD);
      owedF = false;
      return ok;
    },
    /** (tests, the harness) a point at fraction t of cord id's drawn path (world px), null unknown. */
    pointAt(id, t) {
      const c = cords.get(String(id));
      if (!c || !c.seeded || !endsOf(c, E4)) return null;
      let X = c.r.X, Y = c.r.Y;
      if (!motion()) { shown(STUDIO.N, E4[0], E4[1], E4[2], E4[3], sX, sY); X = sX; Y = sY; }
      return along(pts, smooth(X, Y, STUDIO.N, STUDIO.SUB, pts), t);
    },
    /** (diagnostics: the bench / the harness set cords swinging — no input reaches it) pluck cord id, or every cord. */
    pluck(id) {
      if (dead || !motion()) return;
      for (const c of cords.values()) if ((id == null || c.id === String(id)) && c.seeded) pluck(c.r, (STUDIO.N - 1) / 2);
      kick();
    },
    /** (diagnostics: the glue probe, IMPL-9 §5 (c)) a magenta 4-device-px disc at a jack key's anchor; null off. */
    probe(key) { probeKey = key == null ? null : String(key); dirty(); wakeW(); },
    /** The host context's programs are gone (cv-gl lost or restored, 'under'): made again at the next draw. */
    reset() { if (mode === 'under') { P = null; dirty(); } },
    /** To the SVG fallback now (cv-gl given up, 'under'). */
    svg() { if (mode !== 'svg') toSvg(); },
    stats(reset) {
      let awake = 0;
      if (motion()) for (const r of ropes) if (r.awake) awake++; // (R2b F6: the SVG / motion off never move a rope)
      const s = { mode, ready: mode === 'under' ? !!P : ready, cords: cords.size, live: !!LV, held: !!GB, awake, running, frames: st.frames, steps: st.ropeSteps,
        stepMs: st.frames ? st.stepMs / st.frames : 0, stepMax: st.stepMax, awakeMax: st.awakeMax, holds: st.holds, draws: st.draws,
        drawMs: st.draws ? st.drawMs / st.draws : 0, drawMax: st.drawMax, uploads: st.uploads, uploadBytes: st.uploadBytes, builds: st.builds, lost: st.lost,
        restored: st.restored, svgPaths: st.svgPaths, alloc: allocOn, buffer: BW > 0 ? BW + '×' + BH : '0×0',
        bytes: (BW > 0 ? BW * BH * 4 : 0) + (cap + capP) * 4, verts: nStrip, plugs: nPlug };
      if (reset) Object.assign(st, { frames: 0, ropeSteps: 0, stepMs: 0, stepMax: 0, awakeMax: 0, holds: 0, draws: 0, drawMs: 0, drawMax: 0, uploads: 0, uploadBytes: 0, builds: 0, svgPaths: 0 });
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
      cv = null; gl = null; P = null; SV = null; cords.clear(); ropes = []; LV = null; GB = null;
    },
  };
  if (mode === 'svg') buildSvg();
  if (mode === 'svg' && !SV) mode = 'none';
  return api;
}
