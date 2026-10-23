import './v8-guard.mjs';
// cv-cords.js (stage 9, lane C9; docs/canvas/IMPL-9.md §4.3, §8.5, §12 the user's rule): the Studio physics against the cord lab
// (LAB = docs/canvas/ref/cord-lab.html: its Cord and frame ported here verbatim as the reference — the same polyline after 1,
// 30 and 240 steps / frames, ≤ 1e-9 px), sleep after 31 quiet steps, the wake rule, L's easing, the parabola seed and shown,
// anchors swept across a frame's steps, the jump rule, the frame budget, the hold rule, smooth / along / pluck / shade; the
// layer on a fake WebGL2 context (made at the first need, its attributes, the buffer only while allocated or cords exist, ≤ 3
// draws, no upload on a camera-only frame, the S-trigger plug, selection, dim, the live rope taken over by its cord, a pulled
// plug, context loss → SVG after three), the SVG fallback's paths, reduced motion (no ticker, parabolas), 'under' (cv-gl's
// context, no clear). The cord body takes no press (no hit / pull API). Never a fake-DOM node or the fake gl into assert.*.
// Stage P (docs/canvas/IMPL-P.md §1.2, §7 C; the lead's P-1 (c)): CORD_Q (full / light / still), the light rope = LAB's at 6
// points bit for bit, still never steps, setPerf mid-sway re-seeds asleep (the parabola at the next draw, no jump), reduced
// motion still at every preset; the fixed vertex ranges — a scripted scene's drawn GPU bytes hashed: at High equal to the base
// (4cc0936, before P-1: every frame rebuilt and uploaded whole), and at every preset equal to the whole-rebuild twin (o.full);
// 4 096 cords: one swaying cord uploads its own range; the rebuild timed at 128 … 4 096 cords per preset (recorded).
// Run alone: node --max-old-space-size=2048 --test tests/cv-cords.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as dom from './wk-dom.mjs';
import * as C from '../cv-cords.js?v=9';
import * as PT from '../patch-core.js?v=9';

const safe = v => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
const eq = (a, b, m) => assert.equal(safe(a), safe(b), m);
const ok = (v, m) => assert.ok(!!v, m);
const near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, (m || '') + ': ' + a + ' vs ' + b + ' (±' + tol + ')');
const nearPt = (a, b, m) => { assert.ok(!!a && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6, (m || '') + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b)); };
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/* ------------------------------------------------------------------ LAB, ported verbatim (cord-lab.html:132–204, 286–301, 368–372) */
const LS = { slack: 0.10, wobble: 62, weight: 6000, stiff: 5, segs: 10 }; // (PRESETS.studio)
const damping = () => 0.90 + 0.095 * (LS.wobble / 100);
const DT = 1 / 120, EXTRA = 24;
class LabCord {
  constructor(A, B) { this.A = A; this.B = B; this.grab = null; this.seed(); }
  seed() {
    const A = this.A(), B = this.B(), n = LS.segs, D = Math.hypot(B.x - A.x, B.y - A.y);
    this.L = (1 + LS.slack) * D + EXTRA;
    const sag = Math.sqrt(Math.max(0, 3 * Math.max(D, 1) * (this.L - D) / 8));
    this.p = []; for (let i = 0; i < n; i++) {
      const t = i / (n - 1), x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t + sag * 4 * t * (1 - t);
      this.p.push({ x, y, px: x, py: y });
    }
    this.A0 = A; this.B0 = B; this.awake = true; this.quiet = 0;
  }
  step(A, B, dt) {
    const p = this.p, n = p.length, D = Math.hypot(B.x - A.x, B.y - A.y);
    this.L += ((1 + LS.slack) * D + EXTRA - this.L) * Math.min(1, dt * 5);
    const seg = this.L / (n - 1), k = damping(), g = LS.weight * dt * dt;
    let moved = 0;
    for (let i = 1; i < n - 1; i++) {
      const q = p[i], vx = (q.x - q.px) * k, vy = (q.y - q.py) * k;
      q.px = q.x; q.py = q.y; q.x += vx; q.y += vy + g;
    }
    const pin = () => { p[0].x = A.x; p[0].y = A.y; p[n - 1].x = B.x; p[n - 1].y = B.y; if (this.grab) { const q = p[this.grab.i]; q.x = this.grab.x; q.y = this.grab.y; } };
    pin();
    for (let it = 0; it < LS.stiff; it++) {
      for (let i = 0; i < n - 1; i++) {
        const u = p[i], v = p[i + 1], dx = v.x - u.x, dy = v.y - u.y, d = Math.hypot(dx, dy) || 1e-6;
        if (d <= seg) continue;
        const f = (d - seg) / d, wu = i === 0 ? 0 : 0.5, wv = i + 1 === n - 1 ? 0 : 0.5, s = wu + wv;
        if (!s) continue;
        u.x += dx * f * wu / s; u.y += dy * f * wu / s; v.x -= dx * f * wv / s; v.y -= dy * f * wv / s;
      }
      pin();
    }
    for (let i = 1; i < n - 1; i++) moved = Math.max(moved, Math.abs(p[i].x - p[i].px) + Math.abs(p[i].y - p[i].py));
    if (moved < 0.02 && !this.grab) { if (++this.quiet > 30) this.awake = false; } else this.quiet = 0;
  }
}
function labFrame(L, cords, t) { // LAB:289–301 (the draw and the HUD left out)
  const dt = Math.min(0.05, (t - L.last) / 1000); L.last = t; L.acc += dt;
  const steps = Math.min(8, Math.floor(L.acc / DT)); L.acc -= steps * DT; if (L.acc > DT) L.acc = 0;
  for (const c of cords) {
    const A1 = c.A(), B1 = c.B(), A0 = c.A0 || A1, B0 = c.B0 || B1;
    if (Math.abs(A1.x - A0.x) + Math.abs(A1.y - A0.y) + Math.abs(B1.x - B0.x) + Math.abs(B1.y - B0.y) > 0.01 || c.grab) c.awake = true;
    if (c.awake) for (let s = 0; s < steps; s++) {
      const f = (s + 1) / steps;
      c.step({ x: A0.x + (A1.x - A0.x) * f, y: A0.y + (A1.y - A0.y) * f }, { x: B0.x + (B1.x - B0.x) * f, y: B0.y + (B1.y - B0.y) * f }, DT);
    }
    c.A0 = A1; c.B0 = B1;
  }
  return steps;
}
function labPluck(c, rnd) { const n = c.p.length; for (let i = 1; i < n - 1; i++) { const t = i / (n - 1), a = Math.sin(Math.PI * t) * (6 + rnd() * 6); c.p[i].py += a; c.p[i].px += (rnd() - 0.5) * a; } c.awake = true; }
function ourPluck(r, rnd) { const n = r.n; for (let i = 1; i < n - 1; i++) { const t = i / (n - 1), a = Math.sin(Math.PI * t) * (6 + rnd() * 6); r.PY[i] += a; r.PX[i] += (rnd() - 0.5) * a; } r.awake = true; }
const maxDiff = (c, r) => { let m = 0; for (let i = 0; i < r.n; i++) m = Math.max(m, Math.abs(c.p[i].x - r.X[i]), Math.abs(c.p[i].y - r.Y[i]), Math.abs(c.p[i].px - r.PX[i]), Math.abs(c.p[i].py - r.PY[i])); return m; };

/* ------------------------------------------------------------------ the pure physics */
test('STUDIO = the lab\'s Studio preset (damping by LAB\'s own expression, bit for bit); the palette = patch-core\'s; LOOK = the lab ×1.4', () => {
  eq([C.STUDIO.N, C.STUDIO.DT, C.STUDIO.SLACK, C.STUDIO.EXTRA, C.STUDIO.G, C.STUDIO.PASSES, C.STUDIO.EASE, C.STUDIO.QUIET_N, C.STUDIO.QUIET_PX, C.STUDIO.WAKE_PX, C.STUDIO.MAX_STEPS, C.STUDIO.DT_MAX, C.STUDIO.BUDGET],
    [10, 1 / 120, 0.10, 24, 6000, 5, 5, 30, 0.02, 0.01, 8, 0.05, 160]);
  ok(Object.is(C.STUDIO.DAMP, damping()), 'damping: 0.90 + 0.095 · 0.62 exactly as LAB computes it');
  near(C.STUDIO.DAMP, 0.959, 1e-3, '≈ 0.959');
  eq(C.PALETTE, PT.PALETTE.map(p => p.hex), 'the eight colours, patch-core\'s order (a cord stores the index)');
  eq([C.LOOK.W, C.LOOK.BODY, C.LOOK.HI, C.LOOK.SH_DX, C.LOOK.SH_DY, C.LOOK.SH_A, C.LOOK.PLUG_R, C.LOOK.PLUG_B, C.LOOK.PLUG_H, C.LOOK.MIN_DPX], [11.2, 7.8, 2.2, 4, 8, 0.32, 14, 9.8, 3.4, 2.5]);
  near(C.LOOK.W, 8 * 1.4, 1e-9, 'the lab\'s 8 px rim ×1.4'); near(C.LOOK.BODY, 5.6 * 1.4, 0.05, 'its 5.6 body (the contract\'s 7.8)'); near(C.LOOK.HI, 1.6 * 1.4, 0.05); near(C.LOOK.PLUG_B, 7 * 1.4, 1e-9);
  eq([C.shade('#d8432f', -0.45), C.shade('#d8432f', 0.45), C.shade('#2f3033', -0.35)], [[119, 37, 26], [234, 152, 141], [31, 31, 33]], 'LAB\'s shade (rounded channels)');
  const T = C.colourTables();
  eq([T.body.length, T.rim.length, T.hi.length, T.ring.length], [24, 24, 24, 24]);
  near(T.rim[0], 119 / 255, 1e-7); near(T.ring[3 * 7 + 2], 33 / 255, 1e-7);
});

test('the rope = LAB\'s Cord.step bit for bit: a plucked cord, its ends moving, after 1, 30 and 240 steps (≤ 1e-9 px, in fact 0)', () => {
  for (const [A0, B0] of [[{ x: 100, y: 200 }, { x: 420, y: 260 }], [{ x: -50, y: 0 }, { x: -40, y: 300 }], [{ x: 0, y: 0 }, { x: 0, y: 0 }]]) {
    let a = { x: A0.x, y: A0.y }, b = { x: B0.x, y: B0.y };
    const lab = new LabCord(() => ({ x: a.x, y: a.y }), () => ({ x: b.x, y: b.y })), r = C.seed(C.makeRope(), a.x, a.y, b.x, b.y, true);
    eq(maxDiff(lab, r), 0, 'the seed');
    labPluck(lab, rng(5)); ourPluck(r, rng(5));
    for (let s = 1; s <= 240; s++) {
      a = { x: A0.x + 30 * Math.sin(s / 17), y: A0.y + 12 * Math.cos(s / 9) }; b = { x: B0.x - s * 0.4, y: B0.y + (s % 40) };
      lab.step(a, b, DT); C.step(r, a.x, a.y, b.x, b.y, DT);
      if (s === 1 || s === 30 || s === 240) { ok(maxDiff(lab, r) <= 1e-9, 'step ' + s + ': ' + maxDiff(lab, r)); eq([r.L, r.quiet, r.awake], [lab.L, lab.quiet, lab.awake], 'L, quiet, awake at ' + s); }
    }
  }
});

test('advance = LAB\'s frame loop bit for bit (jittered frames, a 50 ms one, three cords, slow anchors), after 1, 30 and 240 frames', () => {
  const R = rng(9), ends = [[{ x: 0, y: 0 }, { x: 300, y: 40 }], [{ x: 50, y: 400 }, { x: 60, y: 90 }], [{ x: -200, y: 10 }, { x: 900, y: 10 }]];
  const pos = ends.map(([a, b]) => ({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }));
  const labs = pos.map(p => new LabCord(() => ({ x: p.a.x, y: p.a.y }), () => ({ x: p.b.x, y: p.b.y }))); // (fresh points, as LAB's endPos)
  const ropes = pos.map(p => { const r = C.seed(C.makeRope(), p.a.x, p.a.y, p.b.x, p.b.y, true); r.p = p; return r; });
  labPluck(labs[1], rng(3)); ourPluck(ropes[1], rng(3));
  const L = { acc: 0, last: 1000 }, sim = { acc: 0, last: 1000 }, E = (r, o) => { o[0] = r.p.a.x; o[1] = r.p.a.y; o[2] = r.p.b.x; o[3] = r.p.b.y; return true; };
  let t = 1000;
  for (let f = 1; f <= 240; f++) {
    t += f === 70 ? 50 : 16.7 + (R() - 0.5) * 4;
    if (f > 20 && f < 120) { pos[0].b.x += 3; pos[2].a.y -= 1.5; } // (≤ 16 px a frame: LAB's sweep, no jump rule)
    const ls = labFrame(L, labs, t), res = C.advance(sim, ropes, t, E, { budget: 1e9 });
    eq(res.steps, ls, 'steps at frame ' + f);
    if (f === 1 || f === 30 || f === 240) for (let i = 0; i < 3; i++) { ok(maxDiff(labs[i], ropes[i]) <= 1e-9, 'frame ' + f + ' cord ' + i + ': ' + maxDiff(labs[i], ropes[i])); eq(ropes[i].awake, labs[i].awake); }
  }
  eq(ropes.map(r => r.awake), [false, false, false], 'all settled by 240 frames');
});

test('sleep: 31 consecutive quiet steps (LAB\'s ++quiet > 30), never 30; the wake rule Σ|Δ| of both ends > 0.01 px (0.009 does not); seeded asleep (ours), LAB seeds awake', () => {
  const r = C.seed(C.makeRope(), 0, 0, 200, 0);
  eq([r.awake, r.quiet], [false, 0], 'seeded asleep: a project opens still');
  ok(C.seed(C.makeRope(), 0, 0, 200, 0, true).awake, 'awake on request (a live cord)');
  // settle it, then count the quiet steps to sleep from a fresh quiet counter
  r.awake = true;
  for (let i = 0; i < 2000 && r.awake; i++) C.step(r, 0, 0, 200, 0, DT);
  eq(r.awake, false, 'settles');
  r.awake = true; r.quiet = 0;
  let n = 0;
  while (r.awake) { C.step(r, 0, 0, 200, 0, DT); n++; }
  eq(n, 31, 'asleep after the 31st quiet step');
  // the frame's wake rule
  const sim = { acc: 0, last: 0 }, at = { a: [0, 0], b: [200, 0] }, E = (q, o) => { o[0] = at.a[0]; o[1] = at.a[1]; o[2] = at.b[0]; o[3] = at.b[1]; return true; };
  C.advance(sim, [r], 16.7, E);
  at.b[0] += 0.005; at.a[1] += 0.004; // Σ 0.009: not > 0.01
  let res = C.advance(sim, [r], 33.4, E);
  eq([res.awake, r.awake, res.moved], [0, false, true], 'Σ|Δ| ≤ 0.01 does not wake (the plugs moved: a draw)');
  at.b[0] += 0.0101;
  res = C.advance(sim, [r], 50.1, E);
  eq([res.awake, res.ropeSteps > 0], [1, true], 'Σ|Δ| > 0.01 wakes and steps');
});

test('L eases toward 1.10·D + 24 at 5 / s (one step: L += (target − L)·min(1, DT·5)); the parabola seed (sag √(3·max(D,1)·(L − D)/8)) = shown()', () => {
  const r = C.seed(C.makeRope(), 0, 0, 100, 0), L0 = r.L;
  eq(L0, 1.1 * 100 + 24);
  C.step(r, 0, 0, 300, 0, DT);
  near(r.L, L0 + (1.1 * 300 + 24 - L0) * Math.min(1, DT * 5), 1e-12, 'eased');
  const s = C.seed(C.makeRope(), 10, 20, 410, 120), D = Math.hypot(400, 100), L = 1.1 * D + 24, sag = Math.sqrt(3 * D * (L - D) / 8);
  const X = new Float64Array(10), Y = new Float64Array(10);
  C.shown(10, 10, 20, 410, 120, X, Y);
  for (let i = 0; i < 10; i++) { eq([s.X[i], s.Y[i], s.PX[i], s.PY[i]], [X[i], Y[i], X[i], Y[i]]); const t = i / 9; near(Y[i], 20 + 100 * t + sag * 4 * t * (1 - t), 1e-9); }
  eq([X[0], Y[0], X[9], Y[9]], [10, 20, 410, 120], 'the ends on the anchors');
  C.shown(10, 5, 5, 5, 5, X, Y);
  near(Y[5] - 5, Math.sqrt(3 * 1 * 24 / 8) * 4 * (5 / 9) * (4 / 9), 1e-9, 'D = 0: max(D, 1) keeps a sag');
});

test('advance: the anchors swept across the frame\'s steps (step s of n at A0 + (A1 − A0)·(s + 1)/n), A0 ← A1 every frame; unknown ends leave a rope as it is', () => {
  const r = C.seed(C.makeRope(), 0, 0, 200, 0, true), ref = C.seed(C.makeRope(), 0, 0, 200, 0, true);
  const sim = { acc: 0, last: 0 }, E = (q, o) => { o[0] = 12; o[1] = -8; o[2] = 214; o[3] = 6; return true; };
  const res = C.advance(sim, [r], 25, E); // 25 ms: 3 steps (acc 0.025 → 3 × DT, the rest kept)
  eq([res.steps, res.ropeSteps], [3, 3]);
  for (let s = 0; s < 3; s++) { const f = (s + 1) / 3; C.step(ref, 12 * f, -8 * f, 200 + 14 * f, 6 * f, DT); }
  for (let i = 0; i < 10; i++) eq([r.X[i], r.Y[i]], [ref.X[i], ref.Y[i]], 'point ' + i);
  eq([r.A0x, r.A0y, r.B0x, r.B0y], [12, -8, 214, 6], 'A0 ← A1');
  const q = C.seed(C.makeRope(), 0, 0, 50, 0, true), X0 = Array.from(q.X);
  const res2 = C.advance(sim, [q], 50, () => false);
  eq([res2.ropeSteps, Array.from(q.X)], [0, X0], 'ends unknown: untouched');
});

test('[C] the jump rule: an end jumping Δ > 16 px in a frame takes ⌈Δ / 16⌉ steps (≤ 8, within the budget\'s share) — a 32 px snap step at 60 Hz (2 steps anyway), 64 px → 4, 40 px in a 0-step frame → 3, 400 px → 8', () => {
  const at = { b: 200 }, E = (q, o) => { o[0] = 0; o[1] = 0; o[2] = at.b; o[3] = 0; return true; };
  const run = (dtMs, jump) => { const r = C.seed(C.makeRope(), 0, 0, 200, 0, true), sim = { acc: 0, last: 0 }; at.b = 200 + jump; return C.advance(sim, [r], dtMs, E).ropeSteps; };
  eq([run(16.7, 10), run(16.7, 32), run(16.7, 64), run(4, 40), run(4, 10), run(16.7, 400), run(4, 16)], [2, 2, 4, 3, 0, 8, 0]);
  // within the budget's share: 160 awake ropes jumping 200 px take 1 step each
  const ropes = Array.from({ length: 160 }, () => C.seed(C.makeRope(), 0, 0, 200, 0, true));
  at.b = 400;
  eq(C.advance({ acc: 0, last: 0 }, ropes, 16.7, E).ropeSteps, 160);
});

test('the frame budget: ≤ 160 rope-steps (128 awake cords after a 50 ms frame: 1 step each; 40: 4; 20: all 6); the hold rule freezes a frame (its time dropped)', () => {
  const E = (q, o) => { o[0] = 0; o[1] = 0; o[2] = 300; o[3] = 0; return true; };
  const run = n => C.advance({ acc: 0, last: 0 }, Array.from({ length: n }, () => C.seed(C.makeRope(), 0, 0, 300, 0, true)), 50, E);
  const a = run(128), b = run(40), c = run(20);
  eq([a.steps, a.per, a.ropeSteps, b.per, b.ropeSteps, c.per, c.ropeSteps], [6, 1, 128, 4, 160, 6, 120]);
  ok(a.ropeSteps <= 160 && b.ropeSteps <= 160 && c.ropeSteps <= 160);
  const sim = { acc: 0, last: 0 }, r = C.seed(C.makeRope(), 0, 0, 300, 0, true), X0 = Array.from(r.Y);
  const h = C.advance(sim, [r], 30, E, { hold: true });
  eq([h.steps, h.ropeSteps, Array.from(r.Y), sim.acc < C.STUDIO.DT], [0, 0, X0, true], 'held: no step, the time dropped');
});

test('smooth: LAB\'s quadratics through the midpoints as a polyline of SUB points each (2 + (n − 2)·SUB), through every midpoint; along / pluck', () => {
  const X = Float64Array.from([0, 10, 30, 60, 70]), Y = Float64Array.from([0, 20, 25, 10, 0]), out = new Float64Array(64);
  const m = C.smooth(X, Y, 5, 4, out);
  eq(m, 2 + 3 * 4);
  eq([out[0], out[1], out[2 * (m - 1)], out[2 * (m - 1) + 1]], [0, 0, 70, 0], 'from the first point, a line to the last');
  for (let i = 1; i <= 3; i++) { const k = 1 + i * 4 - 1; eq([out[2 * k], out[2 * k + 1]], [(X[i] + X[i + 1]) / 2, (Y[i] + Y[i + 1]) / 2], 'quadratic ' + i + ' ends on the midpoint'); }
  // the first quadratic's middle sample: B(0.5) of (P0, P1, mid(P1, P2))
  eq([out[4], out[5]], [0.25 * 0 + 0.5 * 10 + 0.25 * 20, 0.25 * 0 + 0.5 * 20 + 0.25 * 22.5]);
  const P = Float64Array.from([0, 0, 10, 0, 10, 10]);
  eq([C.along(P, 3, 0), C.along(P, 3, 0.5), C.along(P, 3, 1), C.along(P, 3, 0.75)], [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 5 }]);
  const r = C.seed(C.makeRope(), 0, 0, 200, 0), PY = Array.from(r.PY);
  C.pluck(r, 4.5, 9);
  ok(r.awake && r.quiet === 0, 'woken');
  eq([r.PY[0] - PY[0], r.PY[9] - PY[9]], [0, 0], 'the ends untouched');
  near(Math.max(...Array.from(r.PY).map((v, i) => v - PY[i])), 9 * Math.sin(Math.PI * (4 / 9) / (2 * 0.5)), 1e-9, 'the impulse at its point');
});

/* ------------------------------------------------------------------ the layer on a fake WebGL2 context */
const ENUMS = ['COMPILE_STATUS', 'LINK_STATUS', 'VERTEX_SHADER', 'FRAGMENT_SHADER', 'ARRAY_BUFFER', 'STATIC_DRAW', 'DYNAMIC_DRAW', 'FLOAT', 'TRIANGLE_STRIP',
  'BLEND', 'ONE', 'ONE_MINUS_SRC_ALPHA', 'COLOR_BUFFER_BIT', 'DEPTH_TEST'];
function fakeGL() {
  const calls = [], gl = { calls, n: { program: 0 }, ext: null, attrs: null, src: [] };
  ENUMS.forEach((k, i) => { gl[k] = 2000 + i; });
  const rec = (k, a) => { calls.push([k, ...a.map(x => (x && typeof x === 'object' && !ArrayBuffer.isView(x) ? x.tag || '[obj]' : ArrayBuffer.isView(x) ? Array.from(x) : x))]); };
  const fn = (k, r) => { gl[k] = (...a) => { rec(k, a); return typeof r === 'function' ? r(...a) : r; }; };
  for (const k of ['compileShader', 'attachShader', 'linkProgram', 'deleteShader', 'deleteProgram', 'useProgram', 'bindVertexArray', 'bindBuffer', 'bufferData', 'bufferSubData',
    'enableVertexAttribArray', 'vertexAttribPointer', 'vertexAttribDivisor', 'uniform3fv', 'uniform4fv', 'disable', 'enable', 'blendFunc', 'clearColor', 'viewport', 'clear',
    'drawArrays', 'drawArraysInstanced']) fn(k);
  fn('shaderSource', (s, src) => { gl.src.push(src); });
  fn('createShader', () => ({ tag: 'shader' }));
  fn('createProgram', () => ({ tag: 'program' + (++gl.n.program) }));
  fn('createBuffer', () => ({ tag: 'buf' }));
  fn('createVertexArray', () => ({ tag: 'vao' }));
  fn('getUniformLocation', (p, name) => ({ tag: 'u:' + name }));
  fn('getShaderParameter', () => true); fn('getProgramParameter', () => true);
  fn('getExtension', name => (name === 'WEBGL_lose_context' ? (gl.ext = gl.ext || { lost: 0, loseContext() { this.lost++; } }) : null));
  gl.count = k => calls.filter(c => c[0] === k).length;
  gl.since = i => calls.slice(i).map(c => c[0]);
  gl.last = k => calls.filter(c => c[0] === k).pop();
  return gl;
}
// a viewport with #world in it (and a sibling after it); canvases answer getContext('webgl2') with the fake (or null)
function setup(o = {}) {
  const d = dom.fresh(), win = d.defaultView, vp = d.createElement('div'), w = d.createElement('div'), ov = d.createElement('div');
  vp.id = 'viewport'; w.id = 'world'; ov.id = 'overlay'; vp.append(w); d.body.append(vp, ov);
  const gl = o.gl === null ? null : o.gl || fakeGL(), made = [];
  const doc = { createElement: tag => { const el = d.createElement(tag); if (tag === 'canvas') { made.push(el); el.getContext = (kind, attrs) => { if (kind !== 'webgl2') return null; if (gl) gl.attrs = attrs; return gl; }; } return el; },
    createElementNS: (ns, t) => d.createElementNS(ns, t) };
  let T = 1000;
  const wakes = { n: 0 };
  const L = C.createCords(vp, Object.assign({ world: w, doc, win, now: () => T, onWake: () => wakes.n++ }, o.opts || {}));
  return { d, win, vp, w, gl, made, L, wakes, tick: ms => { T += ms; return T; }, get T() { return T; } };
}
const cam = { tx: 0, ty: 0, k: 1 };
// two cords between four jacks, an S-trigger one second
const LIST = [{ id: 'c1', a: 'i1/m1.j-saw', b: 'i1/m2.j-in', c: 2, s: 0 }, { id: 'c2', a: 'i1.j-ks1', b: 'i1/m3.j-trg', c: 5, s: 1 }];
const PORTS = () => new Map([['i1/m1.j-saw', { x: 100, y: 100 }], ['i1/m2.j-in', { x: 400, y: 140 }], ['i1.j-ks1', { x: 120, y: 500 }], ['i1/m3.j-trg', { x: 300, y: 300 }], ['i1/m9.j-x', { x: 0, y: 0 }]]);

test('the layer: nothing at construction, set([]) or alloc(false) — the context and its canvas at the first need (alloc(true) / a cord), after #world, pointer-events none, cv-gl\'s attributes; the programs once', () => {
  const S = setup();
  S.L.set([]); S.L.alloc(false); S.L.anchors(PORTS());
  eq([S.made.length, S.L.mode, S.vp.childNodes.length], [0, 'gl', 1], 'no canvas, no context');
  S.L.alloc(true);
  const cv = S.made[0];
  eq([S.made.length, S.vp.childNodes[1] === cv, cv.className, cv.getAttribute('aria-hidden')], [1, true, 'cv-cords', 'true'], 'after #world');
  ok(/pointer-events:none/.test(cv.style.cssText) && /position:absolute/.test(cv.style.cssText) && !/transform/.test(cv.style.cssText), 'styled inline: ' + cv.style.cssText);
  eq(S.gl.attrs, { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }, 'cv-gl\'s attributes; antialias off (fwidth)');
  eq([S.gl.count('createProgram'), S.gl.count('linkProgram')], [2, 2], 'two programs');
  S.L.set(LIST); S.L.alloc(true);
  eq(S.gl.count('createProgram'), 2, 'built once');
  const T = setup({ opts: { test: true } });
  T.L.alloc(true);
  eq(T.gl.attrs.preserveDrawingBuffer, true, '?gltest keeps the buffer');
  const N = setup({ gl: null });
  N.L.alloc(true);
  eq([N.L.mode, N.made.length, N.w.childNodes.length, N.w.childNodes[0] && N.w.childNodes[0].getAttribute('class')], ['svg', 1, 1, 'cv-cords-svg'], 'no WebGL2: the SVG in #world');
});

test('the buffer: the viewport in device px while allocated or cords exist, 0 × 0 otherwise; one draw = ≤ 3 draw calls; a camera-only frame uploads nothing', () => {
  const S = setup(), gl = S.gl;
  S.L.anchors(PORTS()); S.L.set(LIST);
  const cv = S.made[0];
  S.L.draw(cam, 1000, 600, 2);
  eq([cv.width, cv.height, cv.style.width, cv.style.height], [2000, 1200, '1000px', '600px']);
  eq([gl.count('drawArrays'), gl.count('drawArraysInstanced'), gl.count('bufferSubData'), gl.count('clear')], [2, 1, 2, 1], 'the shadows, the cords, the plugs; one upload (strip + plugs)');
  eq(gl.last('drawArraysInstanced').slice(-1), [4], '4 plugs (two cords)');
  const nStrip = gl.last('drawArrays')[3];
  eq(nStrip, 2 * (2 * (2 + 8 * 4)) + 2, 'two smoothed cords (34 points × 2 sides) + the degenerate join');
  const i0 = gl.calls.length;
  S.L.draw({ tx: 33, ty: -20, k: 0.6 }, 1000, 600, 2);
  const since = gl.since(i0);
  eq([since.filter(k => k === 'bufferSubData').length, since.filter(k => k === 'bufferData').length, since.filter(k => k === 'drawArrays').length, since.filter(k => k === 'drawArraysInstanced').length], [0, 0, 2, 1], 'camera only: no geometry upload, 3 draws');
  ok(gl.calls.some(c => c[0] === 'uniform4fv' && c[1] === 'u:cam' && c[2][0] === 33 && c[2][1] === -20 && Math.abs(c[2][2] - 0.6) < 1e-6 && c[2][3] === 2), 'the camera as given (tx, ty, k, d)');
  // no cords and no allocation → 0 × 0 at the next draw; the host's allocation keeps it
  S.L.set([]); S.L.draw(cam, 1000, 600, 2);
  eq([cv.width, cv.height], [0, 0], 'freed: no cords, not allocated');
  S.L.alloc(true); S.L.draw(cam, 1000, 600, 2);
  eq([cv.width, cv.height], [2000, 1200], 'allocated (a patched instrument shown), no cords');
  S.L.alloc(false);
  eq([cv.width, cv.height], [0, 0], 'alloc(false) frees it at once');
  const s = S.L.stats();
  for (const k of ['mode', 'cords', 'awake', 'steps', 'stepMs', 'uploadBytes', 'drawMs', 'holds', 'bytes', 'draws', 'lost', 'buffer']) ok(k in s, 'stats: ' + k);
});

test('the S-trigger cord\'s Cinch-Jones plug (shape 1, a rounded rectangle) vs the round 1/4" plug (shape 0); the colour index per cord; a selected cord\'s outline flag', () => {
  const S = setup(), gl = S.gl;
  S.L.anchors(PORTS()); S.L.set(LIST); S.L.sel('c2'); S.L.draw(cam, 800, 600, 1);
  const subs = gl.calls.filter(c => c[0] === 'bufferSubData'), plugs = subs[subs.length - 1][3].slice(0, 4 * 5), strip = subs[subs.length - 2][3].slice(0, subs[subs.length - 2][5]);
  eq([plugs.slice(0, 5), plugs.slice(5, 10), plugs.slice(10, 15), plugs.slice(15, 20)], [[100, 100, 2, 0, 0], [400, 140, 2, 0, 0], [120, 500, 5, 1, 1], [300, 300, 5, 1, 1]], 'x, y, colour, shape (S: 1), selected');
  eq([strip[5], strip[6], strip[strip.length - 2], strip[strip.length - 1]], [2, 0, 5, 1], 'the strip: colour and selection per vertex');
  const fs = gl.src.find(x => /rb\(vec2 p,vec2 b,float r\)/.test(x));
  ok(fs && /float sR=s\?rb\(lp,SB,4\.0\):length\(lp\)-14\.0/.test(fs) && /vec2 SB=vec2\(13\.0,10\.0\)/.test(fs), 'the plug shader: a 26 × 20 rounded rectangle for an S plug, r 14 round otherwise');
  ok(/abs\(lp\.y\)-0\.6/.test(fs), 'the S plug\'s parting line');
});

test('set diffs by id: a new cord placed asleep once its ends are known (anchors after set too), a gone one removed, a changed end woken (its jump swept), a colour change redrawn; all asleep → no frames', () => {
  const S = setup();
  S.L.set(LIST);
  eq(S.L.stats().cords, 2);
  eq(S.L.pointAt('c1', 0), null, 'ends unknown: not placed');
  S.L.anchors(PORTS());
  const p0 = S.L.pointAt('c1', 0), p1 = S.L.pointAt('c1', 1);
  nearPt(p0, { x: 100, y: 100 }, 'placed on its jacks'); nearPt(p1, { x: 400, y: 140 });
  eq([S.L.stats().awake, S.L.stats().running], [0, false], 'seeded asleep');
  S.L.draw(cam, 800, 600, 1);
  eq([S.L.wants(), S.L.owed()], [false, false], 'drawn, asleep: no frames wanted');
  S.L.set([LIST[0]]);
  eq([S.L.stats().cords, S.L.wants()], [1, true], 'c2 gone: a redraw owed');
  S.L.draw(cam, 800, 600, 1);
  // re-patched: its b end to another jack → woken
  const w0 = S.wakes.n;
  S.L.set([Object.assign({}, LIST[0], { b: 'i1/m3.j-trg' })]);
  ok(S.wakes.n > w0 && S.L.stats().running, 'woken');
  let frames = 0;
  while (S.L.wants() && frames < 2000) { S.L.step(S.tick(16.7), false); S.L.draw(cam, 800, 600, 1); frames++; }
  nearPt(S.L.pointAt('c1', 1), { x: 300, y: 300 }, 'swung to the new jack'); eq([S.L.stats().awake, S.L.wants()], [0, false], 'asleep: no frames');
  ok(frames > 31 && frames < 600, 'settled in ' + frames + ' frames');
  const st = S.L.stats(true);
  ok(st.steps > 0 && st.frames === frames, JSON.stringify([st.steps, st.frames]));
});

test('a module drag: its anchors moved (a relay a pointer move) wake its cords only; the layer steps them at the frame (swept), draws once a frame; LAB\'s settle, then nothing', () => {
  const S = setup();
  S.L.anchors(PORTS()); S.L.set(LIST); S.L.draw(cam, 800, 600, 1);
  const P = PORTS();
  for (let i = 1; i <= 10; i++) { // a 32 px snap a frame: the module m2 (c1's b end)
    P.set('i1/m2.j-in', { x: 400 + 32 * i, y: 140 });
    S.L.anchors(new Map(P));
    S.L.step(S.tick(16.7), false);
    S.L.draw(cam, 800, 600, 1);
  }
  const st = S.L.stats();
  eq([st.awakeMax, st.awake], [1, 1], 'only c1 woke');
  nearPt(S.L.pointAt('c1', 1), { x: 720, y: 140 }, 'its end on the jack');
  let n = 0;
  while (S.L.wants() && n < 2000) { S.L.step(S.tick(16.7), false); S.L.draw(cam, 800, 600, 1); n++; }
  eq([S.L.wants(), S.L.stats().awake], [false, 0]);
});

test('the hold rule in the layer: step(T, true) (the world says: a burst after a long frame) steps nothing and counts a hold; o.hold === false switches it off', () => {
  for (const [opts, want] of [[{}, [0, 1]], [{ hold: false }, [true, 0]]]) {
    const S = setup({ opts });
    S.L.anchors(PORTS()); S.L.set([LIST[0]]); S.L.draw(cam, 800, 600, 1);
    S.L.pluck('c1');
    const s0 = S.L.stats().steps;
    S.L.step(S.tick(16.7), true);
    const s = S.L.stats();
    eq([opts.hold === false ? s.steps > s0 : s.steps - s0, s.holds], want, JSON.stringify(opts));
  }
});

test('the live cord: live({a, b}) seeds it awake and follows the finger; the commit\'s set takes that rope over (its fixed end on the cord\'s — either end), live(null) after it; a cancelled one vanishes', () => {
  const S = setup();
  S.L.anchors(PORTS()); S.L.set([]);
  S.L.live({ a: { x: 100, y: 100 }, b: { x: 150, y: 160 }, c: 3, s: 0 });
  eq([S.L.stats().live, S.L.stats().running, S.made.length], [true, true, 1], 'awake; the context made');
  for (let i = 0; i < 20; i++) { S.L.live({ a: { x: 100, y: 100 }, b: { x: 150 + 12 * i, y: 160 }, c: 3, s: 0 }); S.L.step(S.tick(16.7), false); S.L.draw(cam, 800, 600, 1); }
  // released over m2's jack (400, 140): the commit's set names the new cord; its a = the fixed jack (live.a)
  S.L.set([{ id: 'c9', a: 'i1/m1.j-saw', b: 'i1/m2.j-in', c: 3, s: 0 }]);
  const st = S.L.stats();
  eq([st.cords, st.awake, st.running], [1, 1, true], 'taken over, swinging');
  S.L.live(null);
  eq(S.L.stats().live, false);
  let n = 0;
  while (S.L.wants() && n < 2000) { S.L.step(S.tick(16.7), false); S.L.draw(cam, 800, 600, 1); n++; }
  nearPt(S.L.pointAt('c9', 0), { x: 100, y: 100 }, 'settled on its jacks'); nearPt(S.L.pointAt('c9', 1), { x: 400, y: 140 });
  // reversed: the fixed jack is the cord's b
  const R = setup();
  R.L.anchors(PORTS()); R.L.live({ a: { x: 400, y: 140 }, b: { x: 200, y: 200 }, c: 1 });
  R.L.step(R.tick(16.7), false);
  R.L.set([{ id: 'c3', a: 'i1/m1.j-saw', b: 'i1/m2.j-in', c: 1 }]);
  eq(R.L.stats().awake, 1, 'reversed: taken over too');
  // cancelled
  const X = setup();
  X.L.anchors(PORTS()); X.L.live({ a: { x: 100, y: 100 }, b: { x: 200, y: 200 }, c: 1 });
  X.L.live(null);
  X.L.draw(cam, 800, 600, 1);
  eq([X.L.stats().live, X.L.stats().verts, X.L.stats().plugs], [false, 0, 0], 'gone, nothing drawn');
});

test('a pulled plug: grab(id, end, p) puts that end in the finger, move(p) follows, drop() springs it to its jack (a re-patch\'s set: the new one); only the plug ends move — no hit / pull / pluck by touch in the API', () => {
  const S = setup();
  S.L.anchors(PORTS()); S.L.set(LIST); S.L.draw(cam, 800, 600, 1);
  S.L.grab('c1', 'b', { x: 420, y: 150 });
  eq(S.L.stats().held, true);
  for (let i = 0; i < 10; i++) { S.L.move({ x: 420 + 20 * i, y: 150 + 10 * i }); S.L.step(S.tick(16.7), false); S.L.draw(cam, 800, 600, 1); }
  nearPt(S.L.pointAt('c1', 1), { x: 600, y: 240 }, 'the end in the finger');
  S.L.drop();
  let n = 0;
  while (S.L.wants() && n < 3000) { S.L.step(S.tick(16.7), false); S.L.draw(cam, 800, 600, 1); n++; }
  nearPt(S.L.pointAt('c1', 1), { x: 400, y: 140 }, 'sprang back to its jack'); eq(S.L.stats().held, false);
  eq(['hit', 'pull', 'release', 'cordtap'].filter(k => k in S.L), [], 'the body takes no press (the user\'s rule): no hit test, no body pull');
  S.L.grab('nope', 'a', { x: 0, y: 0 }); S.L.grab('c1', 'x', { x: 0, y: 0 });
  eq(S.L.stats().held, false, 'an unknown cord or end: nothing');
});

test('reduced motion: no ticker (an anchor change asks one frame for the redraw, nothing steps), the cords drawn as the parabola from their ends', () => {
  const S = setup({ opts: { reduced: () => true } }), gl = S.gl;
  S.L.anchors(PORTS()); S.L.set([LIST[0]]); S.L.draw(cam, 800, 600, 1);
  const P = PORTS(); P.set('i1/m2.j-in', { x: 500, y: 300 });
  const w0 = S.wakes.n;
  S.L.anchors(P);
  eq([S.wakes.n > w0, S.L.stats().running, S.L.owed()], [true, false, true], 'a redraw, no ticker');
  S.L.step(S.tick(16.7), false);
  eq(S.L.stats().steps, 0, 'nothing steps');
  S.L.draw(cam, 800, 600, 1);
  eq(S.L.wants(), false);
  const sb = gl.calls.filter(c => c[0] === 'bufferSubData').at(-2), strip = sb[3].slice(0, sb[5]);
  const X = new Float64Array(10), Y = new Float64Array(10), out = new Float64Array(80);
  C.shown(10, 100, 100, 500, 300, X, Y);
  const m = C.smooth(X, Y, 10, 4, out);
  for (const i of [0, 9, 17, m - 1]) { near(strip[i * 14], out[2 * i], 1e-3, 'x ' + i); near(strip[i * 14 + 1], out[2 * i + 1], 1e-3, 'y ' + i); }
  S.L.pluck();
  eq(S.L.stats().running, false, 'no pluck either');
});

test('context loss: preventDefault, nothing drawn until restored (programs rebuilt, the geometry re-uploaded); three in a minute → the SVG in #world, the canvas gone', () => {
  const S = setup(), gl = S.gl;
  S.L.anchors(PORTS()); S.L.set(LIST); S.L.draw(cam, 800, 600, 1);
  const cv = S.made[0], fire = t => { const e = new dom.Ev(t); let prevented = false; e.preventDefault = () => { prevented = true; }; cv.dispatchEvent(e); return prevented; };
  eq(fire('webglcontextlost'), true, 'prevented');
  const d0 = gl.count('drawArraysInstanced');
  S.L.draw(cam, 800, 600, 1);
  eq(gl.count('drawArraysInstanced'), d0, 'lost: no draw');
  fire('webglcontextrestored');
  eq(S.L.owed(), true, 'restored: a redraw owed');
  const u0 = gl.count('bufferSubData');
  S.L.draw(cam, 800, 600, 1);
  eq([gl.count('drawArraysInstanced') - d0, gl.count('bufferSubData') - u0, gl.count('createProgram')], [1, 2, 4], 'rebuilt, re-uploaded, drawn');
  fire('webglcontextlost'); S.tick(1000); fire('webglcontextrestored'); fire('webglcontextlost');
  eq([S.L.mode, S.vp.childNodes.includes(cv), dom.byCls(S.w, 'cv-cords-svg').length, S.L.stats().lost], ['svg', false, 1, 3], 'the third: the SVG, live');
  eq(dom.all(S.w).filter(n => n.localName === 'path').length, 8, 'two cords × four strokes');
});

test('the SVG fallback (?nogl): per cord the lab\'s four strokes over the motion-off parabola + two plugs (an S cord\'s rounded rectangles), re-pathed on anchor changes only; no draw, no frames', () => {
  const S = setup({ opts: { mode: 'svg' } });
  eq(S.L.mode, 'svg');
  const root = dom.one(S.w, 'cv-cords-svg');
  ok(root && /pointer-events:none/.test(root.style.cssText) && /z-index:10001/.test(root.style.cssText), 'in #world above the modules, no pointer events');
  // (found in headless Chrome: an outer <svg> 0 wide or high renders nothing — "a value of zero disables rendering") a 1 px box,
  // its cords overflowing it
  ok(/width:1px/.test(root.style.cssText) && /height:1px/.test(root.style.cssText) && /overflow:visible/.test(root.style.cssText), 'a 1 × 1 px box, overflow visible: ' + root.style.cssText);
  S.L.anchors(PORTS()); S.L.set(LIST);
  const groups = root.children;
  eq(groups.length, 2);
  const paths = groups[0].children.filter(n => n.localName === 'path');
  eq(paths.map(p => p.getAttribute('stroke-width')), ['11.2', '11.2', '7.8', '2.2'], 'shadow, rim, body, highlight');
  eq([paths[0].getAttribute('transform'), paths[3].getAttribute('transform'), paths[3].getAttribute('stroke-opacity')], ['translate(4 8)', 'translate(-1.68 -1.96)', '0.55']);
  const X = new Float64Array(10), Y = new Float64Array(10), out = new Float64Array(80);
  C.shown(10, 100, 100, 400, 140, X, Y);
  const m = C.smooth(X, Y, 10, 4, out);
  let want = 'M' + out[0].toFixed(1) + ' ' + out[1].toFixed(1);
  for (let i = 1; i < m; i++) want += 'L' + out[2 * i].toFixed(1) + ' ' + out[2 * i + 1].toFixed(1);
  eq(paths[1].getAttribute('d'), want, 'the parabola, smoothed');
  const plugs = groups[1].children.filter(n => n.localName === 'g');
  eq([plugs.length, plugs[0].children.map(n => n.localName), plugs[1].getAttribute('transform')], [2, ['rect', 'rect', 'rect', 'rect'], 'translate(300.0 300.0)'], 'the S cord: Cinch-Jones rectangles at its jacks');
  eq(groups[0].children.filter(n => n.localName === 'g')[0].children.map(n => n.localName), ['circle', 'circle', 'circle', 'circle']);
  const n0 = S.L.stats().svgPaths, P = PORTS();
  S.L.anchors(new Map(P));
  eq(S.L.stats().svgPaths, n0, 'same anchors: nothing re-pathed');
  P.set('i1/m2.j-in', { x: 450, y: 200 }); S.L.anchors(P);
  eq(S.L.stats().svgPaths, n0 + 1, 'one cord re-pathed');
  eq([S.L.draw(cam, 800, 600, 1), S.L.wants(), S.L.stats().running], [false, false, false], 'no GL draw, no ticker');
  S.L.set([]);
  eq(root.children.length, 0, 'gone');
});

test('dim: a powered-off instrument\'s cords at 0.45 alpha (vp.w); \'under\': drawn into the host\'s context after its faces — no clear, no viewport, its buffer\'s size', () => {
  const S = setup();
  S.L.anchors(PORTS()); S.L.set(LIST); S.L.dim(true); S.L.draw(cam, 800, 600, 1);
  ok(S.gl.calls.some(c => c[0] === 'uniform4fv' && c[1] === 'u:vp' && Math.abs(c[2][3] - 0.45) < 1e-6), 'alpha 0.45');
  const host = fakeGL(), H = setup({ gl: null, opts: { mode: 'under', under: () => host } });
  H.L.anchors(PORTS()); H.L.set(LIST);
  eq([H.made.length, H.L.mode], [0, 'under'], 'no canvas of its own');
  H.L.draw(cam, 800, 600, 2);
  eq([host.count('createProgram'), host.count('clear'), host.count('viewport'), host.count('drawArrays'), host.count('drawArraysInstanced')], [2, 0, 0, 2, 1]);
  ok(host.calls.some(c => c[0] === 'uniform4fv' && c[1] === 'u:vp' && c[2][0] === 1600 && c[2][1] === 1200), 'the host buffer: round(vw·d) × round(vh·d)');
  H.L.reset(); H.L.draw(cam, 800, 600, 2);
  eq(host.count('createProgram'), 4, 'reset (cv-gl lost / restored): rebuilt at the next draw');
  H.L.svg();
  eq(H.L.mode, 'svg', 'cv-gl given up: the SVG');
});

test('a stub DOM (no createElementNS, no WebGL2): nothing throws, mode none, every call a no-op', () => {
  const vp = { insertBefore() {}, append() {} }, L = C.createCords(vp, { doc: { createElement: () => ({}) }, world: null, now: () => 0 });
  L.set(LIST); L.anchors(PORTS()); L.alloc(true); L.live({ a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }); L.live(null); L.grab('c1', 'a', { x: 0, y: 0 }); L.drop(); L.step(16, false);
  eq([L.mode, L.draw(cam, 100, 100, 1), L.wants()], ['none', false, false]);
  L.destroy(); L.set(LIST);
});

/* ------------------------------------------------------------------ (R2b F6) stats() truthful in every mode */
test('(R2b F6) stats() after the SVG fallback (three losses; cv-gl given up under \'under\'): no buffer, bytes, vertices or awake ropes — the ropes cannot move there; reduced motion: nothing awake either', () => {
  const S = setup();
  S.L.anchors(PORTS()); S.L.set(LIST); S.L.pluck(); S.L.draw(cam, 1000, 600, 2);
  const s0 = S.L.stats(), pick = s => [s.mode, s.buffer, s.bytes, s.awake, s.running, s.verts, s.plugs];
  eq([s0.buffer, s0.awake, s0.running, s0.verts > 0, s0.plugs, s0.bytes > 2000 * 1200 * 4], ['2000×1200', 2, true, true, 4, true], 'in GL: the buffer, two ropes awake, the geometry');
  const cv = S.made[0], fire = t => { const e = new dom.Ev(t); e.preventDefault = () => {}; cv.dispatchEvent(e); };
  fire('webglcontextlost'); S.tick(1000); fire('webglcontextrestored'); S.L.draw(cam, 1000, 600, 2);
  fire('webglcontextlost'); S.tick(1000); fire('webglcontextrestored'); S.L.draw(cam, 1000, 600, 2);
  ok(S.L.stats().bytes > 2000 * 1200 * 4 && S.L.stats().buffer === '2000×1200', 'restored twice and drawn: the buffers back');
  fire('webglcontextlost');
  eq(pick(S.L.stats()), ['svg', '0×0', 0, 0, false, 0, 0], 'the SVG: the canvas is gone and so is every figure of it');
  // 'under': the host's context holds the vertex buffers; given up → the SVG, the same
  const host = fakeGL(), H = setup({ gl: null, opts: { mode: 'under', under: () => host } });
  H.L.anchors(PORTS()); H.L.set(LIST); H.L.pluck(); H.L.draw(cam, 800, 600, 2);
  ok(H.L.stats().bytes > 0 && H.L.stats().awake === 2, 'under: the vertex buffers, two awake');
  H.L.svg();
  eq(pick(H.L.stats()), ['svg', '0×0', 0, 0, false, 0, 0], 'cv-gl given up: the same');
  // reduced motion: nothing steps, so nothing is awake (a live rope seeds awake)
  const R = setup({ opts: { reduced: () => true } });
  R.L.anchors(PORTS()); R.L.set(LIST); R.L.live({ a: { x: 0, y: 0 }, b: { x: 60, y: 40 }, c: 0, s: 0 });
  eq([R.L.stats().awake, R.L.stats().running], [0, false], 'reduced motion: the ropes do not move');
});

test('(R2b F6) alloc(false) with no cords frees the vertex buffers (bufferData to 0, the counts zeroed, in GL and \'under\'), and so does the draw that finds the last cord gone; the next cords grow them again', () => {
  const S = setup(), g = S.gl, empty = () => g.calls.filter(c => c[0] === 'bufferData' && c[2] === 0).length;
  S.L.anchors(PORTS()); S.L.set(LIST); S.L.draw(cam, 1000, 600, 2);
  const grown = S.L.stats().bytes - 2000 * 1200 * 4;
  ok(grown > 0, 'the vertex buffers: ' + grown + ' B');
  S.L.set([]); S.L.alloc(false); // (the host's ptShow: the cords gone, then the allocation)
  const s = S.L.stats();
  eq([s.bytes, s.buffer, s.verts, s.plugs, empty()], [0, '0×0', 0, 0, 2], 'the strip and the plug buffers emptied, nothing kept');
  S.L.alloc(true); S.L.set(LIST); S.L.draw(cam, 1000, 600, 2);
  const s2 = S.L.stats(), i0 = g.calls.length;
  eq([s2.bytes - 2000 * 1200 * 4 > 0, s2.verts > 0, s2.plugs, s2.uploads], [true, true, 4, 2], 'regrown and re-uploaded');
  S.L.draw(cam, 1000, 600, 2);
  eq(g.since(i0).filter(k => k === 'bufferSubData').length, 0, 'a camera-only frame again uploads nothing');
  // no allocation: the draw after the last cord left frees the buffer and its vertex buffers
  S.L.alloc(false); S.L.set(LIST); S.L.draw(cam, 1000, 600, 2); S.L.set([]); S.L.draw(cam, 1000, 600, 2);
  const s3 = S.L.stats();
  eq([s3.bytes, s3.buffer, s3.verts, s3.plugs], [0, '0×0', 0, 0], 'the last cord gone, not allocated: all freed at the next draw');
  const host = fakeGL(), H = setup({ gl: null, opts: { mode: 'under', under: () => host } });
  H.L.anchors(PORTS()); H.L.set(LIST); H.L.draw(cam, 800, 600, 2);
  ok(H.L.stats().bytes > 0, 'under: grown');
  H.L.set([]); H.L.alloc(false);
  eq([H.L.stats().bytes, H.L.stats().verts, host.calls.filter(c => c[0] === 'bufferData' && c[2] === 0).length], [0, 0, 2], 'under: the host\'s buffers emptied');
});

/* ------------------------------------------------------------------ (P) the presets' cords and the fixed vertex ranges (P-1 (c)) */
test('(P) CORD_Q: high \'full\' = STUDIO (10 points, SUB 4: 34 drawn), medium \'light\' = 6 / 3 (14 drawn), low \'still\' = 6 / 3 with no simulation; perfOf: anything else is high', () => {
  eq(Object.keys(C.CORD_Q), ['high', 'medium', 'low']);
  eq([C.CORD_Q.high, C.CORD_Q.medium, C.CORD_Q.low], [{ q: 'full', N: 10, SUB: 4, still: false }, { q: 'light', N: 6, SUB: 3, still: false }, { q: 'still', N: 6, SUB: 3, still: true }]);
  eq([C.CORD_Q.high.N, C.CORD_Q.high.SUB], [C.STUDIO.N, C.STUDIO.SUB], 'High = the Studio');
  eq(Object.values(C.CORD_Q).map(q => 2 + (q.N - 2) * q.SUB), [34, 14, 14], 'drawn points a cord (× 0.4 the strip below High)');
  eq(['high', 'medium', 'low', 'Low', '', null, undefined, 'toString', '__proto__', 7].map(C.perfOf), ['high', 'medium', 'low', 'high', 'high', 'high', 'high', 'high', 'high', 'high']);
  ok(Object.isFrozen(C.CORD_Q) && Object.isFrozen(C.CORD_Q.medium));
});

test('(P) medium\'s rope = LAB\'s Cord with "Points per cord" 6, bit for bit (the physics reads the rope\'s n): plucked, ends moving, after 1, 30 and 240 steps', () => {
  LS.segs = 6;
  try {
    let a = { x: 80, y: 120 }, b = { x: 520, y: 200 };
    const lab = new LabCord(() => ({ x: a.x, y: a.y }), () => ({ x: b.x, y: b.y })), r = C.seed(C.makeRope(6), a.x, a.y, b.x, b.y, true);
    eq([lab.p.length, r.n, maxDiff(lab, r)], [6, 6, 0], 'the seed');
    labPluck(lab, rng(11)); ourPluck(r, rng(11));
    for (let s = 1; s <= 240; s++) {
      a = { x: 80 + 25 * Math.sin(s / 11), y: 120 }; b = { x: 520 - s * 0.3, y: 200 + (s % 30) };
      lab.step(a, b, DT); C.step(r, a.x, a.y, b.x, b.y, DT);
      if (s === 1 || s === 30 || s === 240) { ok(maxDiff(lab, r) <= 1e-9, 'step ' + s + ': ' + maxDiff(lab, r)); eq([r.L, r.quiet, r.awake], [lab.L, lab.quiet, lab.awake]); }
    }
  } finally { LS.segs = 10; }
});

test('(P) the layer at each preset: stats().perf / quality / pts, the strip\'s vertices (two cords: 2·(2·34) + 2 at High, 2·(2·14) + 2 below); o.perf unknown → high', () => {
  for (const [perf, q, pts] of [['high', 'full', 34], ['medium', 'light', 14], ['low', 'still', 14], ['fast', 'full', 34], [undefined, 'full', 34]]) {
    const S = setup(perf === undefined ? {} : { opts: { perf } }), gl = S.gl;
    S.L.anchors(PORTS()); S.L.set(LIST); S.L.draw(cam, 800, 600, 1);
    const s = S.L.stats();
    eq([S.L.perf, s.perf, s.quality, s.pts, s.verts, gl.last('drawArrays')[3]], [C.perfOf(perf), C.perfOf(perf), q, pts, 2 * 2 * pts + 2, 2 * 2 * pts + 2], String(perf));
  }
});

// the worst distance of the last whole strip upload's vertices from the cords' parabolas (motion off) at n / sub
function parabolaStrip(gl, ends, n, sub) {
  const sb = gl.calls.filter(c => c[0] === 'bufferSubData' && c[2] === 0).at(-2), strip = sb[3];
  const X = new Float64Array(n), Y = new Float64Array(n), out = new Float64Array(80);
  let k = 0, worst = 0;
  ends.forEach(([ax, ay, bx, by], j) => {
    C.shown(n, ax, ay, bx, by, X, Y);
    const m = C.smooth(X, Y, n, sub, out);
    if (j) k++; // (the trail join of the cord before, then this cord's lead)
    for (let i = 0; i < m; i++) {
      if (j && i === 0) k++;
      for (let side = 0; side < 2; side++, k++) worst = Math.max(worst, Math.abs(strip[k * 7] - out[2 * i]), Math.abs(strip[k * 7 + 1] - out[2 * i + 1]));
    }
  });
  return worst;
}
const ENDS = [[100, 100, 400, 140], [120, 500, 300, 300]];

test('(P) low = still: never steps, no ticker, wants() false at rest; a moved end re-paths (the 6 / 3 parabola); pluck a no-op; a live rope drawn, never stepped; nothing awake', () => {
  const S = setup({ opts: { perf: 'low' } }), gl = S.gl;
  S.L.anchors(PORTS()); S.L.set(LIST); S.L.draw(cam, 800, 600, 1);
  ok(parabolaStrip(gl, ENDS, 6, 3) < 1e-3, 'the parabolas at 6 / 3');
  eq([S.L.wants(), S.L.stats().running, S.L.stats().awake], [false, false, 0], 'at rest: nothing');
  S.L.pluck();
  eq([S.L.stats().running, S.L.wants()], [false, false], 'pluck: nothing (no motion)');
  const P = PORTS(); P.set('i1/m2.j-in', { x: 500, y: 300 });
  const w0 = S.wakes.n;
  S.L.anchors(P);
  eq([S.wakes.n > w0, S.L.stats().running, S.L.owed()], [true, false, true], 'an end moved: one redraw, no ticker');
  S.L.step(S.tick(16.7), false); S.L.draw(cam, 800, 600, 1);
  const sb = gl.calls.filter(c => c[0] === 'bufferSubData').at(-2), strip = sb[3];
  const X = new Float64Array(6), Y = new Float64Array(6), out = new Float64Array(40);
  C.shown(6, 100, 100, 500, 300, X, Y);
  const m = C.smooth(X, Y, 6, 3, out);
  eq([sb[2], sb[5], m], [0, (2 * 14 + 1) * 7, 14], 'only the moved cord\'s range went up (its 28 vertices + its trail join)');
  for (const i of [0, 5, m - 1]) { near(strip[2 * i * 7], out[2 * i], 1e-3, 'x ' + i); near(strip[2 * i * 7 + 1], out[2 * i + 1], 1e-3, 'y ' + i); }
  eq([S.L.stats().steps, S.L.wants()], [0, false], 'no step, no frames');
  S.L.live({ a: { x: 0, y: 0 }, b: { x: 60, y: 40 }, c: 0, s: 0 });
  eq([S.L.stats().live, S.L.stats().awake, S.L.stats().running], [true, 0, false], 'a live rope: drawn, never stepped');
});

test('(P) setPerf with every cord swinging: each rope re-seeded asleep — the next draw is every cord\'s parabola at the new quality, no rope moves after it (no jump), no frames; the same id again does nothing; a live rope re-seeded awake; reduced motion is still at every preset', () => {
  const S = setup(), gl = S.gl;
  S.L.anchors(PORTS()); S.L.set(LIST); S.L.draw(cam, 800, 600, 1);
  S.L.pluck();
  for (let i = 0; i < 10; i++) { S.L.step(S.tick(16.7), false); S.L.draw(cam, 800, 600, 1); }
  eq(S.L.stats().awake, 2, 'swinging');
  ok(parabolaStrip(gl, ENDS, 10, 4) > 1, 'mid-sway: not the parabola');
  for (const [perf, n, sub] of [['medium', 6, 3], ['low', 6, 3], ['high', 10, 4], ['medium', 6, 3]]) {
    const w0 = S.wakes.n;
    S.L.setPerf(perf);
    const s = S.L.stats();
    eq([s.perf, s.awake, s.running, S.L.owed(), S.wakes.n > w0], [perf, 0, false, true, true], perf + ': asleep, a draw asked for');
    S.L.draw(cam, 800, 600, 1);
    ok(parabolaStrip(gl, ENDS, n, sub) < 1e-3, perf + ': the parabola at ' + n + ' / ' + sub);
    const st0 = S.L.stats().steps;
    for (let i = 0; i < 5; i++) { S.L.step(S.tick(16.7), false); S.L.draw(cam, 800, 600, 1); }
    eq([S.L.stats().steps - st0, S.L.stats().awake, S.L.wants()], [0, 0, false], perf + ': nothing moves after the switch');
    if (perf !== 'low') {
      S.L.pluck('c1');
      for (let i = 0; i < 3; i++) { S.L.step(S.tick(16.7), false); S.L.draw(cam, 800, 600, 1); }
      eq(S.L.stats().awake, 1, perf + ': a rope at its N swings');
    }
  }
  const b0 = S.L.stats().builds;
  S.L.setPerf('medium');
  eq([S.L.owed(), S.L.stats().builds], [false, b0], 'the same preset: nothing');
  S.L.setPerf('nope');
  eq(S.L.perf, 'high', 'unknown: high');
  // a live rope mid-drag: seeded awake at the new quality, taken over by its cord as before
  S.L.live({ a: { x: 100, y: 100 }, b: { x: 200, y: 200 }, c: 2 });
  S.L.setPerf('medium');
  eq([S.L.stats().live, S.L.stats().running], [true, true], 'the live rope awake at 6 points');
  S.L.step(S.tick(16.7), false);
  S.L.set(LIST.concat([{ id: 'c9', a: 'i1/m1.j-saw', b: 'i1/m9.j-x', c: 2 }]));
  eq([S.L.stats().cords, S.L.stats().awake >= 1], [3, true], 'taken over, swinging');
  // reduced motion: still at every preset, at that preset's geometry
  for (const [perf, n, sub] of [['high', 10, 4], ['medium', 6, 3], ['low', 6, 3]]) {
    const R = setup({ opts: { perf, reduced: () => true } });
    R.L.anchors(PORTS()); R.L.set(LIST); R.L.pluck(); R.L.draw(cam, 800, 600, 1);
    eq([R.L.stats().running, R.L.stats().awake], [false, 0], perf + ' reduced: no motion');
    ok(parabolaStrip(R.gl, ENDS, n, sub) < 1e-3, perf + ' reduced: the parabola at ' + n + ' / ' + sub);
  }
});

/* the scripted scene: its drawn GPU bytes hashed — a fake WebGL2 context that models its buffers (bufferData / bufferSubData
   land in byte arrays; every draw call hashes the bytes it would read with its uniforms). Frozen on the base (4cc0936: every
   frame rebuilt and uploaded whole) by the same code; `extra` reaches every layer (perf, full), sw switches presets mid-scene */
const BASE_SCENE = '26d33782a661190f23112097efa920e52518383662913a1fdfbb8120cd56ab2b';
function gpuGL(H, acc) {
  const g = { ext: null };
  ['COMPILE_STATUS', 'LINK_STATUS', 'VERTEX_SHADER', 'FRAGMENT_SHADER', 'ARRAY_BUFFER', 'STATIC_DRAW', 'DYNAMIC_DRAW', 'FLOAT', 'TRIANGLE_STRIP',
    'BLEND', 'ONE', 'ONE_MINUS_SRC_ALPHA', 'COLOR_BUFFER_BIT', 'DEPTH_TEST'].forEach((k, i) => { g[k] = 3000 + i; });
  let arr = null, vao = null, prog = null;
  const nop = () => {};
  for (const k of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'deleteShader', 'deleteProgram', 'enableVertexAttribArray', 'vertexAttribDivisor',
    'uniform3fv', 'disable', 'enable', 'blendFunc', 'clearColor', 'viewport', 'clear']) g[k] = nop;
  g.createShader = () => ({}); g.createProgram = () => ({ u: new Map() }); g.createBuffer = () => ({ data: new Uint8Array(0) }); g.createVertexArray = () => ({ at: [] });
  g.getUniformLocation = (p, name) => ({ p, name }); g.getShaderParameter = () => true; g.getProgramParameter = () => true;
  g.getExtension = n => (n === 'WEBGL_lose_context' ? (g.ext = g.ext || { loseContext() {} }) : null);
  g.useProgram = p => { prog = p; }; g.bindVertexArray = v => { vao = v; }; g.bindBuffer = (t, b) => { arr = b; };
  g.vertexAttribPointer = (loc, size, type, norm, stride, off) => { vao.at[loc] = { b: arr, stride, off }; };
  g.uniform4fv = (l, a) => { l.p.u.set(l.name, Array.from(a)); };
  g.bufferData = (t, x, u) => { if (typeof x === 'number') arr.data = new Uint8Array(x); else arr.data = new Uint8Array(x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength)); };
  g.bufferSubData = (t, dst, src, so = 0, n) => {
    const e = src.BYTES_PER_ELEMENT, len = n == null ? src.length - so : n, B = new Uint8Array(src.buffer, src.byteOffset + so * e, len * e);
    if (dst + B.length > arr.data.length) throw new Error('bufferSubData past the buffer: ' + (dst + B.length) + ' > ' + arr.data.length);
    arr.data.set(B, dst); acc.ups++; acc.bytes += B.length;
  };
  const uni = () => JSON.stringify([prog.u.get('cam'), prog.u.get('vp')]);
  g.drawArrays = (m, first, count) => { const a = vao.at[0]; if (H) { H.update('S' + first + ':' + count + uni()); H.update(a.b.data.subarray(first * a.stride, (first + count) * a.stride)); } acc.draws++; };
  g.drawArraysInstanced = (m, first, count, inst) => { const a = vao.at[1]; if (H) { H.update('P' + inst + uni()); H.update(a.b.data.subarray(0, inst * a.stride)); } acc.draws++; };
  return g;
}
function cordScene(extra = {}, sw = false) {
  const H = createHash('sha256'), acc = { ups: 0, bytes: 0, draws: 0 };
  let T = 1000;
  const mk = (opts, gl) => {
    const d = dom.fresh(), win = d.defaultView, vp = d.createElement('div'), w = d.createElement('div');
    vp.append(w); d.body.append(vp);
    const made = [];
    const doc = { createElement: t => { const el = d.createElement(t); if (t === 'canvas') { made.push(el); el.getContext = k => (k === 'webgl2' ? gl : null); } return el; }, createElementNS: (ns, t) => d.createElementNS(ns, t) };
    return { L: C.createCords(vp, Object.assign({ world: w, doc, win, now: () => T, onWake: () => {} }, opts, extra)), made };
  };
  // 24 cords between 48 jacks (a 6 × 8 grid of jacks, 'mX' modules of 4 jacks), colours and S plugs mixed
  const P = new Map();
  for (let i = 0; i < 48; i++) P.set('m' + (i >> 2) + '.j' + (i & 3), { x: 60 + (i % 8) * 130 + (i >> 3) * 7, y: 80 + (i >> 3) * 90 });
  const J = [...P.keys()], list = [];
  for (let i = 0; i < 24; i++) list.push({ id: 'c' + i, a: J[i], b: J[47 - ((i * 7) % 24)], c: i % 8, s: i % 5 === 0 ? 1 : 0 });
  const camAt = f => ({ tx: Math.round(Math.sin(f / 13) * 40), ty: Math.round(Math.cos(f / 17) * 30), k: 0.6 + 0.05 * (f % 7) });
  let f = 0;
  const frame = (L, still) => { T += 16.7; f++; L.step(T, false); L.draw(still ? { tx: 0, ty: 0, k: 1 } : camAt(f), 1000, 600, 2); };
  const drag = (L, mod, dx, dy) => { for (const k of J) if (k.startsWith(mod + '.')) { const p = P.get(k); P.set(k, { x: p.x + dx, y: p.y + dy }); } L.anchors(new Map(P)); };
  const swap = (L, p) => { if (sw) L.setPerf(p); };

  // A: the GL layer, the Studio motion
  const A = mk({}, gpuGL(H, acc)), L = A.L;
  L.anchors(new Map(P)); L.set(list); L.draw({ tx: 0, ty: 0, k: 1 }, 1000, 600, 2);
  L.pluck();
  for (let i = 0; i < 90; i++) { if (i === 40) swap(L, 'medium'); if (i === 60 && sw) { swap(L, 'high'); L.pluck(); } frame(L, i % 10 !== 0); }
  for (let i = 0; i < 15; i++) { drag(L, 'm3', 32, i % 3 === 0 ? 32 : 0); frame(L, true); } // (a module drag: a 32 px snap a frame)
  L.sel('c5'); frame(L, true); L.sel('c9'); L.draw({ tx: 0, ty: 0, k: 1 }, 1000, 600, 2);
  const l2 = list.filter(c => c.id !== 'c7').map(c => (c.id === 'c2' ? Object.assign({}, c, { c: 6 }) : c)).concat([{ id: 'c30', a: J[30], b: J[31], c: 3, s: 0 }]);
  L.set(l2); for (let i = 0; i < 5; i++) frame(L, false);
  L.probe(J[0]); frame(L, true); for (let i = 0; i < 5; i++) { drag(L, 'm0', -32, 0); frame(L, true); } L.probe(null); frame(L, true);
  const a1 = P.get(J[1]);
  for (let i = 0; i < 12; i++) { if (i === 6) swap(L, 'low'); L.live({ a: { x: a1.x, y: a1.y }, b: { x: a1.x + 20 * i, y: a1.y + 140 - 6 * i }, c: 4, s: 0 }); frame(L, i % 2 === 0); }
  const l3 = l2.concat([{ id: 'c31', a: J[1], b: J[40], c: 4, s: 0 }]);
  L.set(l3); L.live(null); for (let i = 0; i < 20; i++) frame(L, false);
  swap(L, 'medium');
  const pb = P.get(list[3].b);
  L.grab('c3', 'b', { x: pb.x + 5, y: pb.y + 5 });
  for (let i = 0; i < 10; i++) { L.move({ x: pb.x + 5 + 25 * i, y: pb.y + 5 + 9 * i }); frame(L, true); }
  L.drop(); for (let i = 0; i < 10; i++) frame(L, true);
  const cv = A.made[0], fire = t => { const e = new dom.Ev(t); e.preventDefault = () => {}; cv.dispatchEvent(e); };
  fire('webglcontextlost'); frame(L, true); fire('webglcontextrestored'); for (let i = 0; i < 3; i++) frame(L, true);
  const P2 = new Map(P); P2.delete(J[4]); L.anchors(P2); for (let i = 0; i < 3; i++) frame(L, true);
  L.anchors(new Map(P)); for (let i = 0; i < 3; i++) frame(L, true);
  let n = 0; while (L.wants() && n++ < 1500) frame(L, true);
  for (let i = 0; i < 3; i++) L.draw(camAt(i), 1000, 600, 2);
  L.set([]); L.draw({ tx: 0, ty: 0, k: 1 }, 1000, 600, 2); L.alloc(false); L.alloc(true); L.set(list); L.anchors(new Map(P)); frame(L, true);
  L.pluck('c11'); for (let i = 0; i < 30; i++) frame(L, i % 4 === 0);

  // B: reduced motion — the parabolas re-pathed as their ends move
  const B = mk({ reduced: () => true }, gpuGL(H, acc)), R = B.L;
  R.anchors(new Map(P)); R.set(list); R.draw({ tx: 0, ty: 0, k: 1 }, 1000, 600, 2);
  for (let i = 0; i < 10; i++) { drag(R, 'm5', 32, -32 * (i & 1)); frame(R, true); }
  R.sel('c1'); frame(R, true);

  // C: 'under' — drawn into the host's context
  const host = gpuGL(H, acc), U = mk({ mode: 'under', under: () => host }, null).L;
  U.anchors(new Map(P)); U.set(list); U.pluck();
  for (let i = 0; i < 30; i++) { if (i > 10 && i < 20) drag(U, 'm7', 0, 32); if (i === 15) swap(U, 'low'); frame(U, i % 3 === 0); }
  U.reset(); for (let i = 0; i < 3; i++) frame(U, true);
  return { hash: H.digest('hex'), ...acc };
}

test('(P-1 (c)) High = today, byte for byte: the scripted scene (a sway with the camera moving, a module drag, selection, a recolour, a cord removed and one added, the probe, a live rope taken over, a pulled plug, a context loss, an end unknown, alloc, reduced motion, \'under\') draws exactly the bytes the base drew rebuilding and uploading every cord every frame — with far fewer bytes uploaded', () => {
  const now = cordScene(), whole = cordScene({ full: true });
  eq(now.hash, BASE_SCENE, 'the base\'s hash (4cc0936)');
  eq([whole.hash, whole.draws], [BASE_SCENE, now.draws], 'o.full (the pre-P-1 path) too');
  ok(now.bytes < 0.7 * whole.bytes, 'uploaded ' + now.bytes + ' B vs ' + whole.bytes + ' B whole');
});

test('(P-1 (c)) the fixed ranges at every preset: the scene\'s drawn bytes equal the whole-rebuild twin\'s (o.full) at medium and low, and through live preset switches (high → medium → high → low → medium; \'under\' → low)', () => {
  for (const [extra, sw] of [[{ perf: 'medium' }, false], [{ perf: 'low' }, false], [{}, true], [{ perf: 'low' }, true]]) {
    const a = cordScene(extra, sw), b = cordScene(Object.assign({ full: true }, extra), sw), tag = JSON.stringify([extra, sw]);
    eq([a.hash, a.draws], [b.hash, b.draws], tag);
    ok(a.hash !== BASE_SCENE, tag + ': not High\'s scene');
    ok(a.bytes <= b.bytes, tag + ': ' + a.bytes + ' ≤ ' + b.bytes);
  }
});

// a big rack: n cords, each between its own two jacks on a grid, on the buffer-modelling fake gl (no call log: the arrays are MBs)
function bigRack(n, opts = {}) {
  const acc = { ups: 0, bytes: 0, draws: 0, subs: 0 };
  const g = gpuGL(null, acc), bsd = g.bufferSubData;
  g.bufferSubData = (...a) => { acc.subs++; bsd(...a); };
  const S = setup({ gl: g, opts: Object.assign({ hold: false }, opts) });
  const P = new Map(), list = [];
  for (let i = 0; i < n; i++) { P.set('a' + i, { x: (i % 64) * 40, y: Math.floor(i / 64) * 50 }); P.set('b' + i, { x: (i % 64) * 40 + 300, y: Math.floor(i / 64) * 50 + 120 }); list.push({ id: 'c' + i, a: 'a' + i, b: 'b' + i, c: i & 7 }); }
  S.L.alloc(true); S.L.set(list); S.L.anchors(P); S.L.draw(cam, 1440, 900, 2);
  // a module drag: 8 cords' a ends (one every n / 8) a 32 px snap a frame
  const drag = () => { for (let i = 0; i < 8; i++) { const k = 'a' + Math.floor(i * n / 8), p = P.get(k); P.set(k, { x: p.x + 32, y: p.y }); } S.L.anchors(P); };
  return { S, P, acc, drag };
}

test('(P-1 (c)) 4 096 cords: one swaying cord uploads its own range a frame (High 70 vertices + 2 plugs = 2 000 B, medium 30 + 2 = 880 B) — not every cord (7.3 MB a frame before); a module drag of 8 cords uploads 8 ranges (low too: 8 parabolas, no step)', () => {
  for (const [perf, want] of [['high', (2 * 34 + 2) * 28 + 2 * 20], ['medium', (2 * 14 + 2) * 28 + 2 * 20]]) {
    const { S, acc } = bigRack(4096, { perf });
    S.L.pluck('c2000');
    acc.bytes = 0; acc.subs = 0;
    for (let f = 0; f < 60; f++) { S.L.step(S.tick(16.7), false); S.L.draw(cam, 1440, 900, 2); }
    const s = S.L.stats();
    eq([s.awake, acc.bytes / 60, acc.subs / 60, s.fulls], [1, want, 2, 1], perf + ': one range a frame (strip + plugs), one whole build (the first)');
  }
  for (const [perf, want] of [['high', 2000], ['low', 880]]) {
    const { S, acc, drag } = bigRack(4096, { perf });
    acc.bytes = 0;
    for (let f = 1; f <= 10; f++) { drag(); S.L.step(S.tick(16.7), false); S.L.draw(cam, 1440, 900, 2); }
    const s = S.L.stats();
    eq([perf === 'low' ? s.steps : s.awakeMax, acc.bytes / 10], [perf === 'low' ? 0 : 8, 8 * want - 28], perf + ': the drag\'s 8 cords\' ranges a frame (cord 0 has no lead join: one vertex less)');
  }
});

test('(P-1 (c)) every cord swaying: the dirty ranges go up in ≤ RUN_MAX runs a buffer (neighbours within RUN_GAP merged, past RUN_MAX the gap doubled)', () => {
  eq([C.RUN_GAP, C.RUN_MAX], [4, 16]);
  const { S, acc } = bigRack(512);
  S.L.pluck();
  acc.subs = 0;
  for (let f = 0; f < 20; f++) { S.L.step(S.tick(16.7), false); S.L.draw(cam, 1440, 900, 2); }
  ok(acc.subs / 20 <= 2, 'all 512 dirty: one run a buffer (' + acc.subs / 20 + ' calls a frame)');
  const B = bigRack(480);
  for (let i = 0; i < 480; i += 12) B.S.L.pluck('c' + i); // (40 scattered ropes)
  B.acc.subs = 0; B.acc.bytes = 0;
  B.S.L.step(B.S.tick(16.7), false); B.S.L.draw(cam, 1440, 900, 2);
  ok(B.acc.subs <= 2 * C.RUN_MAX && B.acc.subs >= 2, 'scattered: ' + B.acc.subs + ' calls');
  ok(B.acc.bytes < 480 * 2000, B.acc.bytes + ' B');
});

test('(P-1 (c), recorded) the cord layer a frame at 128 / 512 / 2 048 / 4 096 cords per preset — one rope swaying, and a module drag (8 cords) — the whole rebuild (o.full: before) vs the fixed ranges (now): frame ms, build ms, step ms, upload KB (node, this machine)', t => {
  const run = (n, perf, full, kind) => {
    const { S, acc, drag } = bigRack(n, { perf, full, now: () => performance.now() });
    if (kind === 'sway') S.L.pluck('c' + (n >> 1));
    S.L.stats(true); acc.bytes = 0;
    const F = 40, t0 = performance.now();
    for (let f = 0; f < F; f++) { if (kind === 'drag') drag(); S.L.step(t0 + 16.7 * (f + 1), false); S.L.draw(cam, 1440, 900, 2); }
    const ms = (performance.now() - t0) / F, s = S.L.stats();
    return { frameMs: +ms.toFixed(3), buildMs: +s.buildMs.toFixed(3), stepMs: +s.stepMs.toFixed(3), KB: +(acc.bytes / F / 1024).toFixed(1) };
  };
  let rows = 0;
  for (const kind of ['sway', 'drag']) for (const perf of ['high', 'medium', 'low']) for (const n of [128, 512, 2048, 4096]) {
    if (kind === 'sway' && perf === 'low') continue; // (still: nothing sways)
    t.diagnostic(JSON.stringify({ kind, perf, cords: n, before: run(n, perf, true, kind), now: run(n, perf, false, kind) }));
    rows++;
  }
  eq(rows, 20);
});
