// graph.js — shared curve editors (SPEC-serum §8.6, §9.3, inv A6/A12/A13/A14/A20.4.2; SPEC-serum2 §11.14, §13).
//   CurveEditor  — LFO graphs (loop/start markers, point modulation, tied ends, drawing tools), Remap, X-Shaper,
//                  VELO/NOTE curves, matrix editable curves (kind 'mcurve': RISE / FALL / link / Init) and the
//                  spectral filter (kind 'spec': log-frequency axis, GRID field, presets menu)
//   EnvEditor    — ENV 1–4 A-H-D-S-R display with draggable corners and curve handles, Start/End levels (ENV 2–4),
//                  beat grid and BPM-unit time steps
//   PathEditor   — 2-D LFO paths (Path-type LFOs): points anywhere, closed/open, curvature handles
//   PZEditor     — PZ SVF corners (4 mini-editors) around an X/Y pad
//   lfoEditorLarge — the LFO Editor overlay (full-size editor + drawing tools)
//   pts          — pure point helpers (node-testable; every result satisfies §2.3), `pts.path` for 2-D paths
//   shapeLib     — the shared JSON shape library (`synth.sx.shapes`) behind the editors' Load / Save Shape menus
// Browser ES module: nothing touches document / window at module top level, so node can import it (§0.1, §10.6).
import { contextMenu, injectStyles, menuSource, theme, fitCanvas, ticker, saveFile, pickFile, ask,
  numBox, toggle, seg, slider, xyPad, modifierBar, zoomPan, localPoint, localScale, layer, onRescale } from './wk.js?v=9';
import { evalPts, bend, CURVE_K, ENV_K, MAX_PTS, N_BUS, MAX_CRV_PTS, MAX_SPEC_PTS, PATH_DEFAULT, PZ_DEFAULT, LFO_TOOLS,
  SLEW_T, fmtTime, parseCore } from './serum-core.js?v=9';

const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const fin = x => typeof x === 'number' && isFinite(x);
const r5 = x => Math.round(x * 1e5) / 1e5 + 0;
const busOf = v => (fin(v) ? clamp(Math.round(v), 0, N_BUS) : 0);
const D = () => globalThis.document || null;
const isMac = () => { const n = globalThis.navigator; return !!n && /Mac|iPhone|iPad|iPod/.test(n.platform || ''); };
const modKey = e => (isMac() ? e.metaKey : e.ctrlKey); // Cmd on macOS, Ctrl elsewhere
const DIAG = [[0, 0, 0], [1, 1, 0]];
const maxOf = o => (o && o.max >= 2 ? Math.min(MAX_PTS, Math.floor(o.max)) : MAX_PTS); // point limit (kinds: §2.3, §2.2.4)
const mods = e => modifierBar.mods(e); // event keys or the touch modifier latches (§13.1)

/* ================================================================ pts — pure helpers */

// Valid point list (§2.3): numeric points only, clamped, sorted by x (stable), ≤ MAX_PTS, first x = 0, last x = 1,
// x/y/c rounded to 5 decimals, bus links mx/my ints 0–16 (first/last mx = 0, omitted when both 0). Mirrors
// serum-core's normalisation, so normalize(normalizeSerum output) is the identity. opts.links = false drops links;
// opts.max = point limit (default MAX_PTS; matrix curves MAX_CRV_PTS, spectral filters MAX_SPEC_PTS).
function normalize(p, opts) {
  const links = !opts || opts.links !== false, max = maxOf(opts);
  if (!Array.isArray(p)) return DIAG.map(q => q.slice());
  let out = [];
  for (const raw of p) {
    if (!Array.isArray(raw) || !fin(raw[0]) || !fin(raw[1])) continue;
    const q = [r5(clamp(raw[0], 0, 1)), r5(clamp(raw[1], 0, 1)), fin(raw[2]) ? r5(clamp(raw[2], -1, 1)) : 0];
    if (links) { const mx = busOf(raw[3]), my = busOf(raw[4]); if (mx || my) q.push(mx, my); }
    out.push(q);
  }
  if (!out.length) return DIAG.map(q => q.slice());
  out.sort((a, b) => a[0] - b[0]);
  if (out.length > max) out = out.slice(0, max);
  if (out.length === 1) out.push([1, out[0][1], 0]);
  const first = out[0], last = out[out.length - 1];
  first[0] = 0;
  last[0] = 1;
  for (const q of [first, last]) if (q.length > 3) { q[3] = 0; if (!q[4]) q.length = 3; }
  return out;
}
function setY(q, y) { q[1] = r5(clamp(y, 0, 1)); }
function tieEnds(a, fromLast) { // tied ends: both get the y of the first point (or of the last one)
  const y = fromLast ? a[a.length - 1][1] : a[0][1];
  a[0][1] = y;
  a[a.length - 1][1] = y;
}
function fillMap(opts, n, f) { if (opts && Array.isArray(opts.map)) { opts.map.length = 0; for (let i = 0; i < n; i++) opts.map.push(f(i)); } }

// Exact split of a bend segment at fraction u ∈ [0,1] of its width: bend(t, k) restricted to [0, u] is
// bend(·, k·u) and restricted to [u, 1] is bend(·, k·(1 − u)), so the two pieces get c·u and c·(1 − u) and the
// drawn curve is unchanged (up to the 5-decimal rounding of §2.3).
function splitC(c, u) { c = c || 0; u = clamp(u, 0, 1); return [r5(c * u), r5(c * (1 - u))]; }

// Insert a point at (x, y) after every point with a smaller or equal x (never before the first or after the last
// point). The segment it splits is divided exactly (splitC): with y on the curve (keyboard '+') the shape is
// unchanged; with another y (double-click) the left piece keeps the old shape's character. opts.map receives
// old → new indices, opts.index the new point's index (−1 when the list is full: opts.max, default MAX_PTS).
function insert(p, x, y, opts) {
  const a = normalize(p);
  if (a.length >= maxOf(opts)) { fillMap(opts, a.length, i => i); if (opts) opts.index = -1; return a; }
  x = r5(clamp(+x || 0, 0, 1));
  y = r5(clamp(+y || 0, 0, 1));
  let i = 1;
  while (i < a.length - 1 && a[i][0] <= x) i++;
  const L = a[i - 1], dx = a[i][0] - L[0];
  let c = L[2] || 0;
  if (dx > 1e-9) { const s = splitC(c, (x - L[0]) / dx); L[2] = s[0]; c = s[1]; }
  a.splice(i, 0, [x, y, c]);
  fillMap(opts, a.length - 1, j => (j < i ? j : j + 1));
  if (opts) opts.index = i;
  return a;
}

// Remove points (never the first or the last). opts.map: old → new index, −1 for removed points.
function remove(p, idxs, opts) {
  const a = normalize(p), n = a.length, del = new Set();
  for (const i of idxs || []) if (Number.isInteger(i) && i > 0 && i < n - 1) del.add(i);
  const out = [], map = [];
  for (let i = 0; i < n; i++) { if (del.has(i)) map.push(-1); else { map.push(out.length); out.push(a[i]); } }
  fillMap(opts, n, i => map[i]);
  return out;
}

const snapTo = (v, g) => (g > 0 ? Math.round(v * g) / g : v);
// Move point i to (x, y): the first/last point keeps its x; others stay between their neighbours (order and indices
// never change). opts = { snap, grid: {x, y}, tie }.
function move(p, i, x, y, opts) {
  const a = normalize(p), n = a.length, o = opts || {};
  if (!Number.isInteger(i) || i < 0 || i >= n) return a;
  if (o.snap && o.grid) { x = snapTo(+x, o.grid.x | 0); y = snapTo(+y, o.grid.y | 0); }
  if (i > 0 && i < n - 1 && fin(+x)) a[i][0] = r5(clamp(+x, a[i - 1][0], a[i + 1][0]));
  if (fin(+y)) setY(a[i], +y);
  if (o.tie && (i === 0 || i === n - 1)) tieEnds(a, i === n - 1);
  return a;
}

// Group move of the points `idxs` by (dx, dy) from `p` (the positions at the start of the gesture). Without weights
// the group moves rigidly (dx clamped so it stops as a block at its unselected neighbours); with opts.weights[k]
// (the "rainbow" move passes 1 / (1 + distance·8)) each point moves by its share and stops at its neighbour.
// opts = { weights, tie, lead } (lead = the dragged point, whose y wins for tied ends).
function moveMany(p, idxs, dx, dy, opts) {
  const a = normalize(p), n = a.length, o = opts || {};
  const list = [...new Set(idxs || [])].filter(i => Number.isInteger(i) && i >= 0 && i < n).sort((u, v) => u - v);
  const w = new Map();
  list.forEach((i, k) => w.set(i, o.weights && fin(o.weights[k]) ? o.weights[k] : 1));
  dx = fin(+dx) ? +dx : 0;
  dy = fin(+dy) ? +dy : 0;
  if (!o.weights) { // rigid group: clamp the shared dx so no selected point passes an unselected one (spacing kept)
    const mov = i => i > 0 && i < n - 1 && w.has(i);
    for (const i of list) {
      if (!mov(i)) continue;
      let r = i + 1; while (mov(r)) r++;
      let l = i - 1; while (mov(l)) l--;
      dx = clamp(dx, a[l][0] - a[i][0], a[r][0] - a[i][0]);
    }
  }
  const nx = a.map(q => q[0]);
  // moving right: right to left, so each point stops at its (already moved) right neighbour; left: the reverse
  const step = i => { if (i > 0 && i < n - 1 && w.has(i)) nx[i] = clamp(a[i][0] + dx * w.get(i), nx[i - 1], nx[i + 1]); };
  if (dx > 0) for (let i = n - 2; i > 0; i--) step(i); else for (let i = 1; i < n - 1; i++) step(i);
  for (const i of list) { a[i][0] = r5(nx[i]); setY(a[i], a[i][1] + dy * w.get(i)); }
  if (o.tie && (w.has(0) || w.has(n - 1))) tieEnds(a, o.lead === n - 1 || (!w.has(0) && w.has(n - 1)));
  return a;
}

// Curvature of the segment from point i to i + 1.
function setCurve(p, i, c) {
  const a = normalize(p);
  if (Number.isInteger(i) && i >= 0 && i < a.length - 1 && fin(+c)) a[i][2] = r5(clamp(+c, -1, 1));
  return a;
}

const SEG_SHAPES = Object.freeze([
  Object.freeze({ id: 'step', label: 'Step' }), Object.freeze({ id: 'rampUp', label: 'Ramp Up' }),
  Object.freeze({ id: 'rampDown', label: 'Ramp Down' }), Object.freeze({ id: 'curve', label: 'Curve' }),
]);
function shapeId(s) {
  if (typeof s === 'number') return (SEG_SHAPES[s] || SEG_SHAPES[0]).id;
  const k = String(s || '').toLowerCase().replace(/[\s_-]/g, '');
  return k === 'rampup' ? 'rampUp' : k === 'rampdown' ? 'rampDown' : k === 'curve' ? 'curve' : 'step';
}
function cellPts(shape, a, b, y) {
  switch (shape) {
    case 'rampUp': return [[a, 0, 0], [b, y, 0]];
    case 'rampDown': return [[a, y, 0], [b, 0, 0]];
    case 'curve': return [[a, y, 0.6], [b, 0, 0]]; // fast fall, slow tail
    default: return [[a, y, 0], [b, y, 0]];
  }
}
// Value arriving at x from the left / leaving x to the right (vertical steps at x resolved).
function limitL(a, x) { for (const q of a) if (q[0] === x) return q[1]; return evalPts(a, x); }
function limitR(a, x) { for (let i = a.length - 1; i >= 0; i--) if (a[i][0] === x) return a[i][1]; return evalPts(a, x); }
// Segment covering x+ : index j of the last point with x_j ≤ x and the fraction u of x inside j → j + 1 (u = 0 when
// x sits on a point or j is the last point).
function segAt(a, x) {
  let j = 0;
  for (let i = 0; i < a.length; i++) { if (a[i][0] <= x) j = i; else break; }
  const b = a[j + 1], dx = b ? b[0] - a[j][0] : 0;
  return { j, u: dx > 1e-9 ? (x - a[j][0]) / dx : 0 };
}

// Step-draw (Shift-click/drag): every grid cell (1/gridX wide, gridX ≤ 0 → 16 cells) touched by [x0, x1] is
// replaced by the segment shape ('step' | 'rampUp' | 'rampDown' | 'curve') at level y; the curve outside keeps its
// values exactly (segments cut at the cell edges are split with splitC; vertical steps join the cells to it).
// opts = { tie, map, max } (map: old → new index, −1 for replaced points). A result longer than opts.max (default
// MAX_PTS) leaves the points unchanged.
function stepDraw(p, x0, x1, y, gridX, shape, opts) {
  const a = normalize(p), n = a.length, o = opts || {}, G = gridX > 0 ? Math.round(gridX) : 16, sh = shapeId(shape);
  const lo = clamp(Math.min(+x0 || 0, +x1 || 0), 0, 1), hi = clamp(Math.max(+x0 || 0, +x1 || 0), 0, 1);
  const k0 = Math.min(Math.floor(lo * G), G - 1), k1 = Math.min(Math.floor(hi * G), G - 1);
  const A = r5(k0 / G), B = r5((k1 + 1) / G);
  y = r5(clamp(+y || 0, 0, 1));
  const ent = []; // { q, src }
  for (let i = 0; i < n; i++) if (a[i][0] < A) ent.push({ q: a[i].slice(), src: i });
  if (A > 0) {
    const last = ent[ent.length - 1], nx = a[last.src + 1]; // the segment the left cell edge cuts (or ends at A)
    if (nx && nx[0] > last.q[0]) last.q[2] = splitC(last.q[2], (A - last.q[0]) / (nx[0] - last.q[0]))[0];
    ent.push({ q: [A, limitL(a, A), 0], src: -1 });
  }
  for (let k = k0; k <= k1; k++) for (const q of cellPts(sh, r5(k / G), r5((k + 1) / G), y)) ent.push({ q, src: -1 });
  if (B < 1) { const s = segAt(a, B); ent.push({ q: [B, limitR(a, B), splitC(a[s.j][2], s.u)[1]], src: -1 }); }
  for (let i = 0; i < n; i++) if (a[i][0] > B) ent.push({ q: a[i].slice(), src: i });
  // drop exact duplicates (keep the later point: its curvature starts the next segment) and the inner points of
  // runs of three or more points at the same x (only the first and the last of a run shape the curve)
  let out = [];
  for (let i = 0; i < ent.length; i++) {
    const e = ent[i], nx = ent[i + 1];
    if (nx && nx.q[0] === e.q[0] && nx.q[1] === e.q[1] && e.src < 0) continue;
    out.push(e);
  }
  out = out.filter((e, i) => !(e.src < 0 && i > 0 && i < out.length - 1 && out[i - 1].q[0] === e.q[0] && out[i + 1].q[0] === e.q[0]));
  if (out.length > maxOf(o)) { fillMap(o, n, i => i); return a; }
  const res = out.map(e => e.q);
  res[0][0] = 0;
  res[res.length - 1][0] = 1;
  if (o.tie && (A <= 0 || B >= 1)) tieEnds(res, A > 0);
  const map = new Array(n).fill(-1);
  out.forEach((e, j) => { if (e.src >= 0) map[e.src] = j; });
  fillMap(o, n, i => map[i]);
  return normalize(res);
}

// Mirror in time: x → 1 − x, order reversed, curvatures negated (bend(1 − s, k) = 1 − bend(s, −k)), so the drawn
// curve is exactly mirrored. opts = { tie, map }.
function flipH(p, opts) {
  const a = normalize(p), n = a.length, out = [];
  for (let i = n - 1; i >= 0; i--) {
    const q = a[i], r = [r5(1 - q[0]), q[1], i > 0 ? r5(-(a[i - 1][2] || 0)) : 0];
    if (q.length > 3) r.push(q[3], q[4]);
    out.push(r);
  }
  if (opts && opts.tie) tieEnds(out, false);
  fillMap(opts, n, i => n - 1 - i);
  return normalize(out);
}
// Mirror in value: y → 1 − y (curvatures unchanged). opts = { tie } (ends that differ get the first point's y).
function flipV(p, opts) {
  const a = normalize(p);
  for (const q of a) q[1] = r5(1 - q[1]);
  if (opts && opts.tie) tieEnds(a, false);
  return a;
}

// Curve-handle position of segment i (midpoint in x, on the curve) or null for vertical steps.
function handle(p, i) {
  const a = p[i], b = p[i + 1];
  if (!a || !b || b[0] - a[0] <= 1e-9) return null;
  return [(a[0] + b[0]) / 2, a[1] + (b[1] - a[1]) * bend(0.5, CURVE_K * (a[2] || 0))];
}

/* ---------------------------------------------------------------- factory shapes */
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function stairs(k) {
  const out = [];
  for (let i = 0; i < k; i++) { const v = i / (k - 1); out.push([i / k, v, 0], [(i + 1) / k, v, 0]); }
  out.push([1, 0, 0]);
  return out;
}
function sh() { // S&H-ish: 16 seeded random steps, ends tied by a vertical step at x = 1
  const r = mulberry32(0x5EED5), out = [];
  let first = 0;
  for (let i = 0; i < 16; i++) { const v = r5(0.05 + 0.9 * r()); if (!i) first = v; out.push([i / 16, v, 0], [(i + 1) / 16, v, 0]); }
  out.push([1, first, 0]);
  return out;
}
// Sine: 9 points at x = k/8 with fitted curvatures (max error 0.006 against 0.5 + 0.5·sin 2πx). Deliberate
// deviation from §8.6's "8 points, c ±0.45": with CURVE_K = 10 that is k = 4.5 and bend(0.5, 4.5) ≈ 0.90 where a
// sine needs sin 45° ≈ 0.71, so no 8-point layout with that curvature is a sine (spec amendment requested).
const SINE = [[0, 0.5, 0.033], [0.125, 0.85355, 0.202], [0.25, 1, -0.202], [0.375, 0.85355, -0.033], [0.5, 0.5, 0.033],
  [0.625, 0.14645, 0.202], [0.75, 0, -0.202], [0.875, 0.14645, -0.033], [1, 0.5, 0]];
const SHAPES = Object.freeze([
  ['Triangle', [[0, 0, 0], [0.5, 1, 0], [1, 0, 0]]],
  ['Sine', SINE],
  ['Saw Up', [[0, 0, 0], [1, 1, 0], [1, 0, 0]]],
  ['Saw Down', [[0, 1, 0], [1, 0, 0], [1, 1, 0]]],
  ['Square', [[0, 1, 0], [0.5, 1, 0], [0.5, 0, 0], [1, 0, 0], [1, 1, 0]]],
  ['Pulse 25', [[0, 1, 0], [0.25, 1, 0], [0.25, 0, 0], [1, 0, 0], [1, 1, 0]]],
  ['Ramp Exp', [[0, 0, -0.6], [1, 1, 0], [1, 0, 0]]],
  ['Stairs 4', stairs(4)],
  ['Stairs 8', stairs(8)],
  ['Bounce', [[0, 1, -0.35], [0.36, 0, 0.35], [0.6, 0.5, -0.35], [0.78, 0, 0.35], [0.88, 0.2, -0.35], [0.96, 0, 0], [1, 0, 0], [1, 1, 0]]],
  ['S&H-ish', sh()],
  ['Sidechain', [[0, 1, 0], [0.03, 0, 0.55], [0.5, 1, 0], [1, 1, 0]]],
].map(([name, p]) => Object.freeze({ name, pts: Object.freeze(normalize(p).map(q => Object.freeze(q))) })));

/* ---------------------------------------------------------------- kinds: limits and axes */
// Point limits per editor kind (§2.3 Phase 1; matrix editable curves §2.3, spectral filter curves §2.2.4).
const KIND_MAX = Object.freeze({ lfo: MAX_PTS, remap: MAX_PTS, xshape: MAX_PTS, curve: MAX_PTS, mcurve: MAX_CRV_PTS, spec: MAX_SPEC_PTS, path: MAX_PTS });
// Spectral filter axis (kind 'spec', §2.2.4): x = log-frequency 20 Hz … 20 kHz.
const hzOfX = x => 20 * Math.pow(1000, clamp(fin(+x) ? +x : 0, 0, 1));
const xOfHz = f => (f > 0 ? clamp(Math.log(f / 20) / Math.log(1000), 0, 1) : 0);

/* ---------------------------------------------------------------- pts.path — 2-D LFO paths */
// Paths (Path-type LFOs, §2.2.2, §6.15.3): 2–MAX_PTS points [x, y, c] in drawing order (not sorted), x / y ∈ [0,1],
// c ∈ [−1,1] = curvature of the segment to the next point — x runs linearly, y is bent (serum-core's resampling:
// y = a.y + (b.y − a.y)·bend(t, CURVE_K·c)). A path is closed when it has ≥ 3 points and its last point equals its
// first (x and y); every op keeps that closing copy in sync with the first point (it is never a separate target).
// Results are new arrays rounded to 5 decimals (serum-core normPath is the identity on them).
function pathNorm(p, opts) {
  const max = maxOf(opts);
  if (!Array.isArray(p)) return PATH_DEFAULT.map(q => q.slice());
  const out = [];
  for (const raw of p) {
    if (out.length >= max) break;
    if (!Array.isArray(raw) || !fin(raw[0]) || !fin(raw[1])) continue;
    out.push([r5(clamp(raw[0], 0, 1)), r5(clamp(raw[1], 0, 1)), fin(raw[2]) ? r5(clamp(raw[2], -1, 1)) : 0]);
  }
  return out.length >= 2 ? out : PATH_DEFAULT.map(q => q.slice());
}
function pathClosed(p) {
  const n = Array.isArray(p) ? p.length : 0;
  return n >= 3 && Array.isArray(p[0]) && Array.isArray(p[n - 1]) && p[0][0] === p[n - 1][0] && p[0][1] === p[n - 1][1];
}
// Point of segment i at parameter t ∈ [0,1] (and the segment's own curvature).
function pathAt(p, i, t) {
  const a = p[i], b = p[i + 1] || a, k = CURVE_K * (a[2] || 0);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * bend(t, k)];
}
// Curve handle of segment i (its point at t = ½) or null for a zero-length segment.
function pathHandle(p, i) {
  const a = p[i], b = p[i + 1];
  if (!a || !b || (Math.abs(b[0] - a[0]) < 1e-9 && Math.abs(b[1] - a[1]) < 1e-9)) return null;
  return pathAt(p, i, 0.5);
}
// Nearest point of the drawn path to (x, y): { i (segment), t, d (distance) }; sx / sy scale the axes (pixel space).
function pathNearest(p, x, y, sx, sy) {
  const kx = sx > 0 ? sx : 1, ky = sy > 0 ? sy : 1, N = 24;
  let best = { i: -1, t: 0, d: Infinity };
  for (let i = 0; i < p.length - 1; i++) {
    for (let j = 0; j <= N; j++) {
      const q = pathAt(p, i, j / N), d = Math.hypot((q[0] - x) * kx, (q[1] - y) * ky);
      if (d < best.d) best = { i, t: j / N, d };
    }
  }
  return best;
}
// Runs fn on the distinct points (closing copy removed) and re-closes the result; idx maps through `alias`.
function pathOpen(a) { return pathClosed(a) ? a.slice(0, -1) : a; }
// An open path never closes as a side effect of an edit (closing is setClosed's job): when an insert, remove or move
// lands its last point exactly on its first, the last point is nudged by 1e-5 in x (the 5-decimal grid) inwards —
// otherwise the point would turn into a hidden closing copy and Open Path would delete it.
function keepOpen(a, was) {
  if (was || !pathClosed(a)) return a;
  const q = a[a.length - 1];
  q[0] = r5(q[0] < 1 ? q[0] + 1e-5 : q[0] - 1e-5);
  return a;
}
function pathReclose(body, closed) {
  if (!closed) return body;
  const f = body[0];
  return body.concat([[f[0], f[1], 0]]);
}
// Insert a point at (x, y): opts.at = segment index (the point goes between at and at + 1; opts.t = the split
// parameter, default from x), else — unless opts.append — the segment nearest to (x, y) when it lies within
// opts.near (content units, default 0.04), else appended (open: after the last point; closed: before the closing
// copy). The split segment's curvature is divided exactly (splitC); with opts.onCurve the point is placed on the
// curve at t (the drawn path is unchanged). opts.map: old → new index; opts.index: the new point (−1 when full).
function pathInsert(p, x, y, opts) {
  const a = pathNorm(p), n = a.length, o = opts || {}, closed = pathClosed(a);
  if (n >= maxOf(o)) { fillMap(o, n, i => i); o.index = -1; return a; }
  x = r5(clamp(fin(+x) ? +x : 0, 0, 1));
  y = r5(clamp(fin(+y) ? +y : 0, 0, 1));
  let seg = Number.isInteger(o.at) && o.at >= 0 && o.at < n - 1 ? o.at : -1, t = 0.5;
  if (seg < 0 && !o.append) {
    const near = pathNearest(a, x, y);
    if (near.i >= 0 && near.d <= (o.near > 0 ? o.near : 0.04)) { seg = near.i; t = near.t; }
  } else if (seg >= 0) {
    const A = a[seg], B = a[seg + 1], dx = B[0] - A[0];
    t = fin(o.t) ? clamp(o.t, 0, 1) : Math.abs(dx) > 1e-9 ? clamp((x - A[0]) / dx, 0, 1) : 0.5;
  }
  let at, c = 0;
  if (seg >= 0) {
    const s = splitC(a[seg][2], t);
    a[seg][2] = s[0];
    c = s[1];
    at = seg + 1;
    if (o.onCurve) { const q = pathAt(pathNorm(p), seg, t); x = r5(q[0]); y = r5(q[1]); }
  } else if (closed) {
    const s = splitC(a[n - 2][2], 0.5);
    a[n - 2][2] = s[0];
    c = s[1];
    at = n - 1;
  } else at = n;
  a.splice(at, 0, [x, y, c]);
  fillMap(o, n, j => (j < at ? j : j + 1));
  o.index = at;
  return keepOpen(a, closed);
}
// Remove points (a closed path's closing copy stands for its first point). At least two distinct points remain
// (the call is ignored otherwise). opts.map: old → new index (−1 removed).
function pathRemove(p, idxs, opts) {
  const a = pathNorm(p), n = a.length, closed = pathClosed(a), body = pathOpen(a), m = body.length, del = new Set();
  for (const i of idxs || []) if (Number.isInteger(i) && i >= 0 && i < n) del.add(closed && i === n - 1 ? 0 : i);
  if (!del.size || m - del.size < 2) { fillMap(opts, n, i => i); return a; }
  const out = [], map = [];
  for (let i = 0; i < m; i++) { if (del.has(i)) map.push(-1); else { map.push(out.length); out.push(body[i]); } }
  const res = pathReclose(out, closed);
  if (closed) map.push(map[0] >= 0 ? res.length - 1 : -1);
  fillMap(opts, n, i => map[i]);
  return keepOpen(res, closed);
}
// Move point i to (x, y) (clamped to the square; opts = { snap, grid: {x, y} }). Closed: the first point and its
// closing copy move together.
function pathMove(p, i, x, y, opts) {
  const a = pathNorm(p), n = a.length, o = opts || {}, closed = pathClosed(a);
  if (!Number.isInteger(i) || i < 0 || i >= n) return a;
  if (o.snap && o.grid) { x = snapTo(+x, o.grid.x | 0); y = snapTo(+y, o.grid.y | 0); }
  const q = a[i];
  if (fin(+x)) q[0] = r5(clamp(+x, 0, 1));
  if (fin(+y)) q[1] = r5(clamp(+y, 0, 1));
  if (closed && (i === 0 || i === n - 1)) { const r = a[i === 0 ? n - 1 : 0]; r[0] = q[0]; r[1] = q[1]; }
  return keepOpen(a, closed);
}
// Rigid move of the points idxs by (dx, dy), clamped so that every moved point stays inside the square.
function pathMoveMany(p, idxs, dx, dy) {
  const a = pathNorm(p), n = a.length, closed = pathClosed(a), sel = new Set();
  for (const i of idxs || []) if (Number.isInteger(i) && i >= 0 && i < n) { sel.add(i); if (closed && (i === 0 || i === n - 1)) { sel.add(0); sel.add(n - 1); } }
  if (!sel.size) return a;
  dx = fin(+dx) ? +dx : 0;
  dy = fin(+dy) ? +dy : 0;
  for (const i of sel) { dx = clamp(dx, -a[i][0], 1 - a[i][0]); dy = clamp(dy, -a[i][1], 1 - a[i][1]); }
  for (const i of sel) { a[i][0] = r5(clamp(a[i][0] + dx, 0, 1)); a[i][1] = r5(clamp(a[i][1] + dy, 0, 1)); }
  return keepOpen(a, closed);
}
function pathSetCurve(p, i, c) {
  const a = pathNorm(p);
  if (Number.isInteger(i) && i >= 0 && i < a.length - 1 && fin(+c)) a[i][2] = r5(clamp(+c, -1, 1));
  return a;
}
// Close (append a copy of the first point; the new closing segment is straight) or open (drop the closing copy).
function pathSetClosed(p, on, opts) {
  const a = pathNorm(p), closed = pathClosed(a);
  if (!!on === closed) return a;
  if (!on) return a.slice(0, -1);
  if (a.length >= maxOf(opts) || a.length < 2) return a;
  a[a.length - 1][2] = 0;
  return pathReclose(a, true);
}
// Reverse the drawing direction; the drawn path is unchanged (segment curvature negated: bend(1 − s, k) = 1 − bend(s, −k)).
function pathReverse(p) {
  const a = pathNorm(p), n = a.length, out = [];
  for (let i = n - 1; i >= 0; i--) out.push([a[i][0], a[i][1], i > 0 ? r5(-(a[i - 1][2] || 0)) : 0]);
  return out;
}
// Mirror: 'h' x → 1 − x, 'v' y → 1 − y (curvatures unchanged: x is linear, y keeps its bend).
function pathFlip(p, dir) {
  const a = pathNorm(p);
  for (const q of a) { if (dir === 'v') q[1] = r5(1 - q[1]); else q[0] = r5(1 - q[0]); }
  return a;
}
const path = Object.freeze({ normalize: pathNorm, isClosed: pathClosed, at: pathAt, handle: pathHandle, nearest: pathNearest,
  insert: pathInsert, remove: pathRemove, move: pathMove, moveMany: pathMoveMany, setCurve: pathSetCurve,
  setClosed: pathSetClosed, reverse: pathReverse, flip: pathFlip, DEFAULT: PATH_DEFAULT });

export const pts = Object.freeze({ insert, remove, move, moveMany, setCurve, stepDraw, flipH, flipV, normalize, handle, SHAPES, SEG_SHAPES,
  path, MAX: KIND_MAX, hzOfX, xOfHz });

/* ---------------------------------------------------------------- shape library */
// The shared library `synth.sx.shapes` = [{ name, pts }] through host.storage ({ get(k, def), set(k, v) }), in the
// shape CurveEditor's `shapes` option expects: list() = factory shapes (factory: true) + user shapes.
export function shapeLib(storage, key) {
  const K = key || 'synth.sx.shapes';
  const read = () => {
    let v = [];
    try { v = storage && storage.get ? storage.get(K, []) : []; } catch (err) { v = []; }
    return Array.isArray(v) ? v.filter(s => s && typeof s.name === 'string' && s.name && Array.isArray(s.pts)) : [];
  };
  const write = list => { try { if (storage && storage.set) storage.set(K, list); } catch (err) { /* storage full */ } };
  const merge = (list, add) => {
    const m = new Map(list.map(s => [s.name, s]));
    for (const s of add) if (s && typeof s.name === 'string' && s.name.trim() && Array.isArray(s.pts)) {
      const name = s.name.trim().slice(0, 48);
      m.set(name, { name, pts: normalize(s.pts, { links: false }) });
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  };
  return {
    list: () => SHAPES.map(s => ({ name: s.name, pts: s.pts, factory: true }))
      .concat(read().map(s => ({ name: s.name, pts: normalize(s.pts, { links: false }), factory: false }))),
    save(name, p) { const nm = String(name || '').trim(); if (nm) write(merge(read(), [{ name: nm, pts: p }])); },
    del(name) { write(read().filter(s => s.name !== name)); },
    exportFile() { return saveFile('shapes.json', JSON.stringify({ type: 'synth.sx.shapes', v: 1, shapes: read() })); },
    importFile(file) {
      if (!file || typeof file.text !== 'function') return Promise.resolve(0);
      return file.text().then(t => {
        const j = JSON.parse(t), list = Array.isArray(j) ? j : j && Array.isArray(j.shapes) ? j.shapes : [];
        const ok = list.filter(s => s && typeof s.name === 'string' && Array.isArray(s.pts));
        write(merge(read(), ok));
        return ok.length;
      }).catch(() => 0);
    },
  };
}

/* ================================================================ shared editor plumbing */
const PAD = 7;
function mkCanvas(cls) {
  const c = D().createElement('canvas');
  c.className = cls;
  c.setAttribute('aria-hidden', 'true');
  return c;
}
function liveRegion() {
  const s = D().createElement('span');
  s.className = 'gx-sr';
  s.setAttribute('aria-live', 'polite');
  return s;
}
// Playhead loop while the element is connected: a wk.ticker — a client of the frame clock at its global rate (IMPL-FR §3
// B1a: no cap — the dot moves whenever its provider's value does), 10 fps with reduced motion, nothing while hidden or off
// screen (the clock's IntersectionObserver).
function animator(el, fn) { return ticker(el, () => fn(), { fps: Infinity }); }
// Touch hit radii (§13.1: 44 px targets): points, curve handles and curves 22 px; mouse 8 / 6 px — screen px: P.k (layout
// px per screen px, 1/k under the canvas world's zoom) turns them into the editor's layout px
const hk = P => (P && P.k > 0 ? P.k : 1);
const R_PT = (touch, P) => (touch ? 22 : 8) * hk(P), R_HD = (touch, P) => (touch ? 22 : 6) * hk(P);
// The canvases fill the editor's padding box (position: absolute; 100 % inside a 1 px border-box frame), so bitmaps
// are sized from clientWidth / clientHeight and pointer positions are measured from the padding-box origin.
// `hgt` = the nominal (border-box) height, used when layout has not happened yet.
function boxSize(el, minW, hgt) {
  const r = el.getBoundingClientRect(), bw = el.clientLeft || 0, bh = el.clientTop || 0;
  return { w: Math.max(minW, el.clientWidth || (r.width ? r.width - 2 * bw : 300)), h: Math.max(16, el.clientHeight || hgt - 2 * bh) };
}
function boxOrigin(el) { // the padding box's top-left, client px
  const r = el.getBoundingClientRect(), k = localScale(el);
  return { left: r.left + (el.clientLeft || 0) / k, top: r.top + (el.clientTop || 0) / k };
}
// SPEC-canvas §4.7: an editor may sit under the canvas world's CSS scale, where client px are screen px and the
// geometry (clientWidth, X(), Y()) layout px. boxPoint(el, e): the pointer in the padding box's layout px (wk.localPoint
// less the border) with k = layout px per screen px; boxClient(el, lx, ly): a layout point of the padding box in client px
function boxPoint(el, e) {
  const p = localPoint(el, e);
  return { px: p.x - (el.clientLeft || 0), py: p.y - (el.clientTop || 0), k: localScale(el) };
}
function boxClient(el, lx, ly) { const r = boxOrigin(el), k = localScale(el); return { x: r.left + lx / k, y: r.top + ly / k }; }
// §13.1: hidden pages are not painted — an editor that is detached or not rendered (on a display: none page) skips
// drawing; its ResizeObserver fires when the page is shown again (0 × 0 → its size) and redraws it.
const unrendered = el => {
  if (!el.isConnected) return true;
  const r = typeof el.getClientRects === 'function' ? el.getClientRects() : null;
  return !!r && r.length === 0;   // (a host without rect lists — a page simulation's DOM — counts as rendered)
};
function observeSize(el, fn) {
  const RO = globalThis.ResizeObserver;
  if (typeof RO !== 'function') return null;
  const ro = new RO(entries => fn(entries));
  ro.observe(el);
  return () => ro.disconnect();
}
// (IMPL-FR §7.3) an editor's box size, cached while a ResizeObserver watches its root — the callback drops the cache and
// redraws; a 0 × 0 box (display: none) marks it hidden for the playhead path (ed.hid) — so a playhead frame reads no layout;
// without an observer (node) measured on every call, as before. ed: { root, height, draw() }; returns the remover
function watchSize(ed) {
  ed.sz = null; ed.hid = false;
  const off = observeSize(ed.root, entries => {
    ed.sz = null;
    const e = entries && entries.length ? entries[entries.length - 1] : null, r = e && e.contentRect;
    ed.hid = !!r && !(r.width > 0 || r.height > 0);
    ed.draw();
  });
  ed.ro = !!off;
  return off || (() => {});
}
const sizeOf = (ed, minW) => (ed.ro ? ed.sz || (ed.sz = boxSize(ed.root, minW, ed.height)) : boxSize(ed.root, minW, ed.height));
// the playhead path's "not drawn" test: an explicit call reads the layout (unrendered), the clock's frames and a host that
// knows the editor is shown (live) only check the connection and the observer's hidden flag
const offScreen = (ed, live) => (live ? !ed.root.isConnected || ed.hid : unrendered(ed.root));
const fmt3 = v => (Math.round(v * 1000) / 1000).toFixed(3);
// Zoomable editors (o.zoom, §13.1: pinch zoom and two-finger pan on the LFO editor): the visible window of the unit
// square in wk.zoomPan's form { x0, x1, y0, y1 } (fractions, y from the top); FULL = no zoom.
const FULL = Object.freeze({ x0: 0, x1: 1, y0: 0, y1: 1 });
const ZOOM_MIN = 1 / 128; // smallest visible span
const isFull = v => v.x0 === 0 && v.x1 === 1 && v.y0 === 0 && v.y1 === 1;
// spans a rounding error below ZOOM_MIN (zoomPan's clamped x0 + span − x0) are valid: a pinch held at the maximum
// zoom must not flip back to the full view
function viewOf(v) {
  const n = (x, d) => (fin(x) ? clamp(x, 0, 1) : d), MIN = ZOOM_MIN * (1 - 1e-9);
  const q = v || FULL, a = { x0: n(q.x0, 0), x1: n(q.x1, 1), y0: n(q.y0, 0), y1: n(q.y1, 1) };
  if (!(a.x1 - a.x0 >= MIN)) { a.x0 = 0; a.x1 = 1; }
  if (!(a.y1 - a.y0 >= MIN)) { a.y0 = 0; a.y1 = 1; }
  return a;
}
// Hooks an editor (CurveEditor / PathEditor: fields root, view, offs, g; methods abort(), draw(), size()) to
// wk.zoomPan: a second finger cancels the one-finger gesture in progress and pinches / pans; Ctrl-wheel zooms at the
// pointer. The view maps onto the plot (the padding box inset by PAD), so that is the rect zoomPan anchors to.
function attachZoom(ed, mode) {
  ed.view = FULL;
  if (!mode) return;
  const axis = mode === 'x' || mode === 'y' ? mode : 'xy';
  const rect = () => { // the plot in client px (zoomPan's ratios: right under the world's zoom too)
    const r = boxOrigin(ed.root), s = ed.size(), k = localScale(ed.root);
    return { left: r.left + PAD / k, top: r.top + PAD / k, width: Math.max(1, (s.w - 2 * PAD) / k), height: Math.max(1, (s.h - 2 * PAD) / k) };
  };
  ed.zp = zoomPan(ed.root, { axis, min: ZOOM_MIN, rect, get: () => ed.view, set: (v, ph) => { if (ph === 'start') ed.abort(); ed.setView(v); } });
  ed.offs.push(() => ed.zp.destroy());
}
// The zoom badge (top right of the plot) and the clip of a zoomed plot.
function zoomBadge(ctx, v, s, T) {
  const f = Math.max(1 / (v.x1 - v.x0), 1 / (v.y1 - v.y0));
  if (!ctx.fillText) return;
  ctx.save();
  ctx.font = '600 9px ' + T.mono; ctx.fillStyle = T.mute; ctx.textAlign = 'right';
  ctx.fillText('\u00d7' + (f < 10 ? f.toFixed(1) : Math.round(f)), s.w - PAD - 2, PAD + 9);
  ctx.restore();
}

// Typed RISE / FALL (kind 'mcurve'): the shared time parser over the SLEW_T law (4·n³ s = pow3 over 0…4 s): '1 s',
// '250 ms', '1/16' (at 120 BPM), a bare number in the unit the field shows; 'off' = 0. → n ∈ [0,1] or null.
function slewParse(text, base) {
  const t = String(text).trim();
  if (/^off$/i.test(t)) return 0;
  return parseCore('time', t, { law: 'pow3', lo: 0, hi: 4, base });
}

/* ================================================================ CurveEditor */
// Options (Phase 1): { kind: 'lfo' | 'remap' | 'xshape' | 'curve', get, set(pts, phase), grid?, label?, height?,
// readOnly?, bipolar?, playhead?, shapes?, and for kind 'lfo' loop / setLoop / start / setStart / pointMenu /
// removePointMods / fromWavetable, links? (false: no Modulate X / Y and no Remove Point Modulations items — an LFO
// whose points take no modulation: SYNTH Canvas milestone 3's canvas LFO modules) }. Phase 2 (SPEC-serum2 §11.14):
//   tool?: () => 'point' | 'flat' | 'rampUp' | 'rampDown' (LFO_TOOLS; any kind) — with a drawing tool a press on the
//          background draws that shape per grid cell (as Shift-draw with Step / Ramp Up / Ramp Down); 'point' (default)
//          keeps the point gestures. setTool(t) is the same for editors without the option.
//   kind 'mcurve' (matrix Editable Curve, ≤ MAX_CRV_PTS points, identity reference): a bar under the graph with RISE /
//          FALL fields, the SmoothLink toggle and Init — slew: { get: () => ({ rise, fall, slink }), set: (patch,
//          phase) } (patch ⊆ { rise, fall, slink }; with the link on an edit of either field writes both, switching it
//          on copies RISE to FALL), fmtSlew?: n → text (default SLEW_T time), parseSlew?: text → n | null (typed
//          entry; default: seconds / ms / beat divisions, bare numbers in the shown unit, 'off'), init?: () => void
//          (default: set(DIAG)).
//   kind 'spec' (spectral filter, ≤ MAX_SPEC_PTS points, x = log-frequency 20 Hz … 20 kHz, y = gain): frequency
//          labels, a bar with the GRID field (gridField: { get: () => 0–64, set: (g, phase) }, also the snap grid
//          when o.grid is absent) and a Presets button (presets: () => contextMenu items).
export class CurveEditor {
  constructor(container, o) {
    injectStyles();
    this.o = o || {};
    this.kind = ['lfo', 'remap', 'xshape', 'curve', 'mcurve', 'spec'].includes(this.o.kind) ? this.o.kind : 'curve';
    this.lfo = this.kind === 'lfo';
    this.max = KIND_MAX[this.kind];
    this.toolSel = 'point';
    this.height = this.o.height > 0 ? this.o.height : 160;
    this.sel = new Set();
    this.act = -1;
    this.shape = 'step';
    this.g = null;
    this.hover = null;
    this.lastTap = null;
    this.ph = null;
    const d = D();
    const root = this.root = d.createElement('div');
    root.className = 'gx-root gx-curve gx-' + this.kind + (this.o.readOnly ? ' gx-ro' : '');
    root.tabIndex = 0;
    root.setAttribute('role', 'group');
    root.setAttribute('aria-roledescription', 'curve editor');
    root.setAttribute('aria-label', this.o.label || { lfo: 'LFO shape', remap: 'Remap curve', xshape: 'X-Shaper curve', curve: 'Curve', mcurve: 'Matrix curve', spec: 'Spectral filter' }[this.kind]);
    root.style.height = this.height + 'px';
    this.cv = mkCanvas('gx-cv');
    this.ov = mkCanvas('gx-ov');
    this.sr = liveRegion();
    root.append(this.cv, this.ov, this.sr);
    if (container) container.appendChild(root);
    this.offs = [];
    const on = (t, type, fn, opt) => { t.addEventListener(type, fn, opt); this.offs.push(() => t.removeEventListener(type, fn, opt)); };
    on(root, 'pointerdown', e => this.down(e));
    on(root, 'pointermove', e => this.moveEv(e));
    on(root, 'pointerup', e => this.up(e));
    on(root, 'pointercancel', e => this.cancel(e));
    on(root, 'lostpointercapture', e => this.cancel(e));
    on(root, 'pointerleave', () => { if (!this.g && this.hover) { this.hover = null; this.draw(); } });
    on(root, 'dblclick', e => { if (this.lastType !== 'touch') this.dbl(this.pos(e)); });
    on(root, 'contextmenu', e => this.ctx(e));
    on(root, 'keydown', e => this.key(e));
    on(root, 'focus', () => this.draw());
    on(root, 'blur', () => this.draw());
    this.offs.push(menuSource(root, { keys: false }), watchSize(this), onRescale(root, () => this.draw()));
    attachZoom(this, this.o.zoom);
    this.anim = animator(root, () => this.drawOverlay(false, true));
    if (this.o.playhead) this.anim.start();
    this.bar = null;
    this.parts = [];
    if (this.kind === 'mcurve' || this.kind === 'spec') this.buildBar(container);
    this.draw();
  }

  /* data */
  get pts() { const p = this.o.get ? this.o.get() : null; return Array.isArray(p) && p.length >= 2 ? p : DIAG; }
  grid() {
    let g = this.o.grid ? this.o.grid() : null;
    if (!this.o.grid && this.o.gridField) { const n = +this.o.gridField.get(); g = { x: n, y: n }; }
    return { x: g && g.x > 0 ? g.x | 0 : 0, y: g && g.y > 0 ? g.y | 0 : 0 };
  }
  // drawing tool (§13.13): 'point' (point gestures) or the segment shape a background press draws
  tool() { const t = this.o.tool ? this.o.tool() : this.toolSel; return LFO_TOOLS.includes(t) ? t : 'point'; }
  setTool(t) { this.toolSel = LFO_TOOLS.includes(t) ? t : 'point'; }
  toolShape() { return { flat: 'step', rampUp: 'rampUp', rampDown: 'rampDown' }[this.tool()] || null; }
  loopIdx() { return this.lfo && this.o.loop ? this.o.loop() : -1; }
  startIdx() { return this.lfo && this.o.start ? this.o.start() : 0; }
  emit(p, phase) { if (this.o.set) this.o.set(p, phase); }
  // index-changing edits: carry selection, the active point and the LFO loop/start points through `map`
  remapIdx(map) {
    const m = i => (i >= 0 && i < map.length ? map[i] : -1);
    this.sel = new Set([...this.sel].map(m).filter(i => i >= 0));
    this.act = m(this.act);
    if (!this.lfo) return;
    const L = this.loopIdx(), S = this.startIdx();
    if (L >= 0 && m(L) !== L && this.o.setLoop) this.o.setLoop(m(L));
    if (m(S) !== S && this.o.setStart) this.o.setStart(Math.max(0, m(S)));
  }
  commit(p, map) { // one discrete edit
    this.emit(p, 'set');
    if (map) this.remapIdx(map);
    this.refresh();
  }
  tie() { return this.lfo; }

  /* geometry (CSS px inside the canvas; the zoom window `view` maps the unit square onto the plot) */
  size() { return sizeOf(this, 40); }
  X(x, s) { const v = this.view; return PAD + (x - v.x0) / (v.x1 - v.x0) * (s.w - 2 * PAD); }
  Y(y, s) { const v = this.view; return PAD + ((1 - y) - v.y0) / (v.y1 - v.y0) * (s.h - 2 * PAD); }
  pos(e) {
    const B = boxPoint(this.root, e), s = this.size(), v = this.view, px = B.px, py = B.py;
    return { px, py, k: B.k, x: v.x0 + (px - PAD) / (s.w - 2 * PAD) * (v.x1 - v.x0), y: 1 - (v.y0 + (py - PAD) / (s.h - 2 * PAD) * (v.y1 - v.y0)), s };
  }
  /* zoom (o.zoom: true | 'x' | 'y' | 'xy'): pinch / two-finger pan, Ctrl-wheel; menu Reset Zoom, key 0 */
  zoomed() { return !isFull(this.view); }
  setView(v) { this.view = viewOf(v); this.draw(); }
  resetView() { this.setView(FULL); }
  abort() { // a second finger: the one-finger gesture is undone and ends
    const g = this.g;
    this.lastTap = null;
    if (!g) return;
    if (g.started) this.emit(g.orig, 'move');
    if (g.mode === 'marquee') this.sel = new Set(g.keep);
    if (g.mode === 'draw') { // a drawing tool's press already drew: its index remapping is undone with the points
      this.sel = new Set(g.sel0);
      this.act = g.act0;
      if (this.lfo) {
        if (this.o.setLoop && this.loopIdx() !== g.loop0) this.o.setLoop(g.loop0);
        if (this.o.setStart && this.startIdx() !== g.start0) this.o.setStart(g.start0);
      }
    }
    this.finish();
  }
  hitPoint(p, P, touch) {
    const R = R_PT(touch, P);
    let best = -1, bd = R * R + 1e-9;
    for (let i = 0; i < p.length; i++) {
      const dx = this.X(p[i][0], P.s) - P.px, dy = this.Y(p[i][1], P.s) - P.py, d = dx * dx + dy * dy;
      if (d < bd - 0.25) { bd = d; best = i; }
      else if (Math.abs(d - bd) <= 0.25 && best >= 0) {
        // overlapping points: at the right edge the left one (inv A13), elsewhere the later one (it can move right)
        if (p[i][0] >= 1 && p[best][0] >= 1) continue;
        best = i;
      }
    }
    return best;
  }
  hitHandle(p, P, touch) {
    if (this.o.readOnly) return -1;
    const R = R_HD(touch, P);
    let best = -1, bd = R * R + 1e-9;
    for (let i = 0; i < p.length - 1; i++) {
      const hh = handle(p, i);
      if (!hh) continue;
      const dx = this.X(hh[0], P.s) - P.px, dy = this.Y(hh[1], P.s) - P.py, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /* pointer gestures */
  down(e) {
    this.lastType = e.pointerType || 'mouse';
    if (e.button !== 0 || this.g || (this.zp && this.zp.active())) return;
    if (e.ctrlKey && !e.metaKey && isMac()) return; // macOS Ctrl-click = context menu
    this.root.focus({ preventScroll: true });
    if (this.o.readOnly) return;
    const P = this.pos(e), p = this.pts, touch = this.lastType === 'touch', mod = modKey(e), M = mods(e), ts = this.toolShape();
    const hit = this.hitPoint(p, P, touch), hh = hit < 0 ? this.hitHandle(p, P, touch) : -1;
    const base = { id: e.pointerId, orig: normalize(p), started: false, P0: P, moved: false, touch,
      sel0: new Set(this.sel), act0: this.act, loop0: this.loopIdx(), start0: this.startIdx() };
    if (hit >= 0) {
      if (M.shift && mod) { if (this.lfo && this.o.setLoop) this.o.setLoop(hit); this.act = hit; modifierBar.consume(); this.refresh(); return; }
      if (M.shift) { if (this.sel.has(hit)) this.sel.delete(hit); else this.sel.add(hit); this.act = hit; modifierBar.consume(); this.announce(); this.draw(); return; }
      if (!this.sel.has(hit)) this.sel = new Set([hit]);
      this.act = hit;
      const q = p[hit];
      this.g = Object.assign(base, { mode: mod && this.sel.size > 1 ? 'rainbow' : 'move', i: hit, gx: q[0] - P.x, gy: q[1] - P.y, idxs: [...this.sel].sort((a, b) => a - b) });
    } else if (hh >= 0) {
      this.g = Object.assign(base, { mode: 'curve', i: hh, all: M.alt });
    } else if (M.shift || ts) { // Shift-draw with the menu's segment shape, or a drawing tool's shape
      this.g = Object.assign(base, { mode: 'draw', lastX: P.x, shape: ts || this.shape });
      this.paint(P, P.x);
    } else {
      this.g = Object.assign(base, { mode: 'marquee', add: mod, keep: mod ? new Set(this.sel) : new Set(), rect: null });
    }
    e.preventDefault();
    try { this.root.setPointerCapture(e.pointerId); } catch (err) { /* pointer gone */ }
    this.draw();
  }
  change(p) { // an edit inside a drag
    if (!this.g.started) { this.g.started = true; this.emit(this.g.orig, 'start'); }
    this.emit(p, 'move');
    this.draw();
  }
  moveEv(e) {
    const g = this.g;
    if (!g) {
      if (e.pointerType === 'mouse' && !this.o.readOnly) { // hover feedback
        const P = this.pos(e), p = this.pts, i = this.hitPoint(p, P, false);
        const hv = i >= 0 ? 'p' + i : (this.hitHandle(p, P, false) >= 0 ? 'h' + this.hitHandle(p, P, false) : null);
        if (hv !== this.hover) { this.hover = hv; this.root.style.cursor = hv ? (hv[0] === 'h' ? 'ns-resize' : 'grab') : ''; this.draw(); }
      }
      return;
    }
    if (e.pointerId !== g.id) return;
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) { this.finish(); return; }
    const P = this.pos(e);
    if (Math.hypot(P.px - g.P0.px, P.py - g.P0.py) > 3 * hk(P)) g.moved = true;
    if (!g.moved) return;
    const grid = this.grid(), tie = this.tie();
    if (g.mode === 'move' || g.mode === 'rainbow') {
      const lead = g.orig[g.i];
      let tx = P.x + g.gx, ty = P.y + g.gy;
      if (mods(e).alt) { tx = snapTo(tx, grid.x); ty = snapTo(ty, grid.y); }
      if (g.idxs.length <= 1) { this.change(move(g.orig, g.i, tx, ty, { tie })); return; }
      const ws = g.mode === 'rainbow' ? g.idxs.map(j => 1 / (1 + Math.abs(g.orig[j][0] - lead[0]) * 8)) : null;
      this.change(moveMany(g.orig, g.idxs, tx - lead[0], ty - lead[1], { weights: ws, tie, lead: g.i }));
    } else if (g.mode === 'curve') {
      const dc = (g.P0.py - P.py) / 100 * (mods(e).fine ? 0.1 : 1);
      let p = g.orig;
      const segs = g.all ? p.map((q, j) => j).slice(0, -1) : [g.i];
      for (const j of segs) {
        const a = g.orig[j], b = g.orig[j + 1], dir = b[1] < a[1] ? -1 : 1;
        p = setCurve(p, j, (a[2] || 0) + dc * dir);
      }
      this.change(p);
    } else if (g.mode === 'draw') {
      this.paint(P, g.lastX);
      g.lastX = P.x;
    } else if (g.mode === 'marquee') {
      const x0 = Math.min(g.P0.x, P.x), x1 = Math.max(g.P0.x, P.x), y0 = Math.min(g.P0.y, P.y), y1 = Math.max(g.P0.y, P.y);
      g.rect = [x0, y0, x1, y1];
      const sel = new Set(g.keep), p = this.pts;
      p.forEach((q, i) => { if (q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1) sel.add(i); });
      this.sel = sel;
      this.draw();
    }
  }
  paint(P, fromX) {
    const g = this.g, grid = this.grid();
    let y = clamp(P.y, 0, 1);
    if (grid.y) y = snapTo(y, grid.y);
    const map = [];
    const p = stepDraw(this.pts, clamp(fromX, 0, 1), clamp(P.x, 0, 1), y, grid.x || 16, g.shape || this.shape, { tie: this.tie(), map, max: this.max });
    if (!g.started) { g.started = true; this.emit(g.orig, 'start'); }
    this.emit(p, 'move');
    this.remapIdx(map);
    this.draw();
  }
  up(e) {
    const g = this.g;
    if (!g || e.pointerId !== g.id) return;
    const P = this.pos(e);
    this.finish();
    if (g.mode === 'marquee' && !g.moved && !g.add) { this.sel.clear(); this.act = -1; this.draw(); }
    if (g.touch && !g.moved) { // double-tap = double-click
      const t = e.timeStamp, L = this.lastTap;
      if (L && t - L.t < 350 && Math.hypot(P.px - L.px, P.py - L.py) < 24 * hk(P)) { this.lastTap = null; this.dbl(P); }
      else this.lastTap = { t, px: P.px, py: P.py };
    }
  }
  // a pointercancel / lost capture ends the gesture keeping its edit — except gesture.js's two-finger cancel (a second
  // finger made it a pan / pinch): undone, as by the editor's own pinch (abort)
  cancel(e) { if (this.g && (!e || e.pointerId === this.g.id)) { if (e && e.type === 'pointercancel' && e.gesture === 'two-finger') this.abort(); else this.finish(); } }
  finish() {
    const g = this.g;
    if (!g) return;
    this.g = null;
    try { this.root.releasePointerCapture(g.id); } catch (err) { /* released */ }
    if (g.started) this.emit(normalize(this.pts), 'end');
    modifierBar.consume();
    this.announce();
    this.draw();
  }
  dbl(P) {
    if (this.o.readOnly) return;
    const p = this.pts, hit = this.hitPoint(p, P, this.lastType === 'touch');
    if (hit >= 0) {
      if (hit === 0 || hit === p.length - 1) return;
      this.removeIdx([hit]);
      return;
    }
    const hh = this.hitHandle(p, P, this.lastType === 'touch');
    if (hh >= 0) { this.commit(setCurve(p, hh, 0)); return; }
    const grid = this.grid();
    const x = grid.x ? snapTo(clamp(P.x, 0, 1), grid.x) : clamp(P.x, 0, 1), y = grid.y ? snapTo(clamp(P.y, 0, 1), grid.y) : clamp(P.y, 0, 1);
    const o = { map: [], max: this.max }, q = insert(p, x, y, o);
    if (o.index < 0) { this.say('Point limit reached'); return; }
    this.commit(q, o.map);
    this.sel = new Set([o.index]);
    this.act = o.index;
    this.announce();
    this.draw();
  }
  removeIdx(idxs) {
    const map = [], p = remove(this.pts, idxs, { map });
    if (p.length === this.pts.length) return;
    this.emit(p, 'set');
    const L = this.loopIdx(), S = this.startIdx();
    this.sel.clear();
    this.act = clamp(this.act >= 0 && map[this.act] >= 0 ? map[this.act] : Math.min(...idxs) - 1, -1, p.length - 1);
    if (this.lfo) {
      if (L >= 0 && this.o.setLoop && map[L] !== L) this.o.setLoop(map[L] >= 0 ? map[L] : -1);
      if (this.o.setStart && map[S] !== S) this.o.setStart(map[S] >= 0 ? map[S] : 0);
    }
    this.refresh();
  }
  flip(dir) {
    if (dir === 'h') { const map = []; this.commit(flipH(this.pts, { tie: this.tie(), map }), map); }
    else this.commit(flipV(this.pts, { tie: this.tie() }));
  }

  /* context menu */
  ctx(e) {
    e.preventDefault();
    if (this.zp && this.zp.active()) return; // never in the middle of a pinch
    if (this.g) this.finish();
    const P = this.pos(e), p = this.pts, hit = this.hitPoint(p, P, this.lastType === 'touch');
    if (hit >= 0 && !this.sel.has(hit)) { this.sel = new Set([hit]); this.act = hit; }
    this.draw();
    contextMenu(e.clientX, e.clientY, this.menuItems(hit >= 0 ? hit : this.act), { anchor: this.root });
  }
  menuItems(target) {
    const o = this.o, p = this.pts, n = p.length, ro = !!o.readOnly;
    const sel = [...this.sel].filter(i => i < n).sort((a, b) => a - b);
    const idxs = sel.length ? sel : target >= 0 ? [target] : [];
    const del = idxs.filter(i => i > 0 && i < n - 1);
    const items = [
      { label: 'Segment shape', disabled: ro, sub: SEG_SHAPES.map(s => ({ label: s.label, checked: this.shape === s.id, action: () => { this.shape = s.id; } })) },
      { label: 'Delete Selected', disabled: ro || !del.length, action: () => this.removeIdx(del) },
    ];
    if (this.lfo) {
      const t = target >= 0 ? target : idxs[0] != null ? idxs[0] : -1;
      items.push({ sep: true },
        { label: 'Set Start Point', disabled: ro || t < 0 || !o.setStart, action: () => { o.setStart(t); this.refresh(); } },
        { label: 'Set Loopback Point', disabled: ro || t < 0 || !o.setLoop, action: () => { o.setLoop(t); this.refresh(); } },
        { label: 'Clear Loopback', disabled: ro || !o.setLoop || !(this.loopIdx() >= 0), action: () => { o.setLoop(-1); this.refresh(); } });
    }
    items.push({ sep: true },
      { label: 'Flip Horizontal', disabled: ro, action: () => this.flip('h') },
      { label: 'Flip Vertical', disabled: ro, action: () => this.flip('v') });
    if (this.lfo && o.links !== false) {   // (links false: an LFO without point links — a canvas LFO module, IMPL-3 §2.3)
      const sub = (axis, list) => {
        if (ro || !o.pointMenu || !list.length) return null;
        const it = (o.pointMenu(list, axis) || []).map(x => ({ label: x.label, action: () => { x.action(); this.refresh(); }, checked: x.checked, disabled: x.disabled }));
        return it.length ? it : null;
      };
      const sx = sub('x', idxs.filter(i => i > 0 && i < n - 1)), sy = sub('y', idxs);
      const linkedSel = idxs.filter(i => p[i][3] || p[i][4]);
      const linked = linkedSel.length ? linkedSel : p.map((q, i) => (q[3] || q[4] ? i : -1)).filter(i => i >= 0);
      items.push({ sep: true },
        { label: 'Modulate X', disabled: !sx, sub: sx || undefined },
        { label: 'Modulate Y', disabled: !sy, sub: sy || undefined },
        { label: 'Remove Point Modulations', disabled: ro || !o.removePointMods || !linked.length, action: () => { o.removePointMods(linked); this.refresh(); } });
    }
    if (this.zp) items.push({ sep: true }, { label: 'Reset Zoom', disabled: !this.zoomed(), action: () => this.resetView() });
    const S = o.shapes || null;
    items.push({ sep: true },
      { label: 'Load Shape', disabled: ro, sub: this.shapeItems() },
      { label: 'Save Shape…', disabled: !(S && S.save), action: () => this.saveShape() });
    if (this.lfo && o.fromWavetable) {
      const w = (o.fromWavetable() || []).map(x => ({ label: x.label, disabled: x.disabled, action: () => { x.action(); this.refresh(); } }));
      items.push({ label: 'Wavetable to LFO Shape', disabled: ro || !w.length, sub: w.length ? w : undefined });
    }
    return items;
  }
  shapeItems() {
    const S = this.o.shapes || null;
    let user = [];
    try { user = S && S.list ? (S.list() || []).filter(s => s && !s.factory && Array.isArray(s.pts)) : []; } catch (err) { user = []; }
    // a shape with more points than this kind allows (mcurve 64, spec 128) is shown disabled: loading it would cut it
    const item = s => { const ok = this.fits(s.pts); return { label: ok ? s.name : s.name + ' (over ' + this.max + ' points)', disabled: !ok, action: () => this.loadShape(s.pts) }; };
    const items = SHAPES.map(item);
    if (user.length) items.push({ sep: true }, ...user.map(item));
    if (S && (S.importFile || S.exportFile || S.del)) items.push({ sep: true });
    if (S && S.del && user.length) items.push({ label: 'Delete Shape', sub: user.map(s => ({ label: s.name, action: () => { S.del(s.name); } })) });
    if (S && S.importFile) items.push({ label: 'Import Library…', action: () => this.importLib() });
    if (S && S.exportFile) items.push({ label: 'Export Library…', action: () => S.exportFile() });
    return items;
  }
  fits(src) { return normalize(src, { links: false }).length <= this.max; }
  loadShape(src) {
    const p = normalize(src, { links: false });
    if (p.length > this.max) { this.say('Shape has more than ' + this.max + ' points'); return; }
    const cur = this.pts;
    if (this.lfo && this.o.removePointMods) {
      const linked = cur.map((q, i) => (q[3] || q[4] ? i : -1)).filter(i => i >= 0);
      if (linked.length) this.o.removePointMods(linked);
    }
    this.sel.clear();
    this.act = -1;
    this.emit(p, 'set');
    if (this.lfo) {
      if (this.loopIdx() >= 0 && this.o.setLoop) this.o.setLoop(-1);
      if (this.startIdx() !== 0 && this.o.setStart) this.o.setStart(0);
    }
    this.refresh();
  }
  saveShape() {
    const S = this.o.shapes;
    if (!S || !S.save) return;
    const name = ask('Save shape as', '');
    if (name && name.trim()) S.save(name.trim().slice(0, 48), normalize(this.pts, { links: false }));
  }
  importLib() {
    const S = this.o.shapes;
    pickFile('.json,application/json').then(f => (f ? S.importFile(f) : null)).catch(() => null);
  }

  /* keyboard */
  key(e) {
    if (e.target !== this.root) return;
    const p = this.pts, n = p.length, k = e.key, ro = !!this.o.readOnly;
    if (k === 'ContextMenu' || (k === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const s = this.size(), q = p[this.act], c = boxClient(this.root, q ? this.X(q[0], s) : s.w / 2, q ? this.Y(q[1], s) : s.h / 2);
      contextMenu(c.x, c.y, this.menuItems(this.act), { anchor: this.root });
      return;
    }
    if (k === 'Tab') {
      const j = this.act + (e.shiftKey ? -1 : 1);
      if ((e.shiftKey && this.act < 0) || j < 0 || j >= n) { this.act = -1; this.draw(); return; } // leave the editor
      e.preventDefault();
      this.act = j;
      this.sel = new Set([j]);
      this.announce();
      this.draw();
      return;
    }
    if (k === 'Home' || k === 'End') { e.preventDefault(); this.act = k === 'Home' ? 0 : n - 1; this.sel = new Set([this.act]); this.announce(); this.draw(); return; }
    if ((k === 'a' || k === 'A') && modKey(e)) { e.preventDefault(); this.sel = new Set(p.map((q, i) => i)); this.draw(); return; }
    if (k === '0' && this.zoomed()) { e.preventDefault(); this.resetView(); return; }
    if (k === 'Escape') { if (this.sel.size) { e.preventDefault(); this.sel.clear(); this.draw(); } return; }
    if (ro) return;
    const grid = this.grid(), fine = e.shiftKey;
    const sx = fine ? 0.001 : grid.x ? 1 / grid.x : 0.01, sy = fine ? 0.001 : grid.y ? 1 / grid.y : 0.01;
    let dx = 0, dy = 0;
    if (k === 'ArrowLeft') dx = -sx; else if (k === 'ArrowRight') dx = sx; else if (k === 'ArrowUp') dy = sy; else if (k === 'ArrowDown') dy = -sy;
    if (dx || dy) {
      e.preventDefault();
      if (this.act < 0) { this.act = 0; this.sel = new Set([0]); }
      const idxs = this.sel.has(this.act) && this.sel.size > 1 ? [...this.sel] : [this.act];
      const q = idxs.length > 1 ? moveMany(p, idxs, dx, dy, { tie: this.tie(), lead: this.act }) : move(p, this.act, p[this.act][0] + dx, p[this.act][1] + dy, { tie: this.tie() });
      this.commit(q);
      this.announce();
      return;
    }
    if (k === '+' || k === '=') {
      e.preventDefault();
      const i = this.act >= 0 && this.act < n - 1 ? this.act : Math.max(0, Math.floor((n - 1) / 2));
      const x = (p[i][0] + p[i + 1][0]) / 2, o = { map: [], max: this.max }, q = insert(p, x, evalPts(p, x), o);
      if (o.index < 0) { this.say('Point limit reached'); return; }
      this.commit(q, o.map);
      this.act = o.index;
      this.sel = new Set([o.index]);
      this.announce();
      this.draw();
      return;
    }
    if (k === '-' || k === '_' || k === 'Delete' || k === 'Backspace') {
      const idxs = (this.sel.size ? [...this.sel] : [this.act]).filter(i => i > 0 && i < n - 1);
      if (!idxs.length) return;
      e.preventDefault();
      this.removeIdx(idxs);
      this.announce();
    }
  }
  say(t) { if (this.sr.textContent !== t) this.sr.textContent = t; }
  announce() {
    const p = this.pts, q = p[this.act];
    if (!q) return;
    this.say(`Point ${this.act + 1} of ${p.length}: x ${fmt3(q[0])}, y ${fmt3(q[1])}` + (q[3] ? `, X bus ${q[3]}` : '') + (q[4] ? `, Y bus ${q[4]}` : ''));
  }

  /* drawing */
  refresh() {
    const n = this.pts.length;
    this.sel = new Set([...this.sel].filter(i => i < n));
    if (this.act >= n) this.act = n - 1;
    if (this.o.playhead) this.anim.start();
    if (this.parts && this.parts.length) this.refreshBar();
    this.draw();
  }
  draw() {
    if (unrendered(this.root)) return;
    const s = this.size(), ctx = fitCanvas(this.cv, s.w, s.h);
    if (!ctx) return;
    const T = this.T = theme(this.root), p = this.pts, n = p.length, grid = this.grid(), ro = !!this.o.readOnly;
    const X = x => this.X(x, s), Y = y => this.Y(y, s), v = this.view, zoomed = !isFull(v), zx = v.x1 - v.x0;
    ctx.clearRect(0, 0, s.w, s.h);
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, s.w, s.h);
    if (zoomed) { ctx.save(); ctx.beginPath(); ctx.rect(PAD - 6, PAD - 6, s.w - 2 * PAD + 12, s.h - 2 * PAD + 12); ctx.clip(); }
    // grid
    ctx.lineWidth = 1;
    ctx.strokeStyle = T.line;
    ctx.beginPath();
    const gx = grid.x || 4, gy = grid.y || 4;
    if (gx <= 128) for (let i = 0; i <= gx; i++) { const x = Math.round(X(i / gx)) + 0.5; ctx.moveTo(x, PAD); ctx.lineTo(x, s.h - PAD); }
    if (gy <= 128) for (let i = 0; i <= gy; i++) { const y = Math.round(Y(i / gy)) + 0.5; ctx.moveTo(PAD, y); ctx.lineTo(s.w - PAD, y); }
    ctx.stroke();
    if (this.o.bipolar) { ctx.strokeStyle = T.mute; ctx.beginPath(); ctx.moveTo(PAD, Y(0.5)); ctx.lineTo(s.w - PAD, Y(0.5)); ctx.stroke(); }
    if (this.kind === 'spec') { // log-frequency decades (20 Hz … 20 kHz)
      ctx.save();
      ctx.strokeStyle = T.mute; ctx.globalAlpha = 0.5; ctx.fillStyle = T.mute;
      ctx.font = '500 8px ' + T.mono;
      for (const [f, t] of [[100, '100'], [1000, '1k'], [10000, '10k']]) {
        const x = Math.round(X(xOfHz(f))) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, PAD); ctx.lineTo(x, s.h - PAD); ctx.stroke();
        if (ctx.fillText) ctx.fillText(t, x + 2, s.h - PAD - 2);
      }
      ctx.restore();
    }
    if (this.kind === 'remap' || this.kind === 'curve' || this.kind === 'xshape' || this.kind === 'mcurve') { // identity reference
      ctx.save();
      if (ctx.setLineDash) ctx.setLineDash([3, 3]);
      ctx.strokeStyle = T.line;
      ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(1), Y(1)); ctx.stroke();
      ctx.restore();
    }
    // loop / start markers (lfo)
    if (this.lfo) {
      const S = this.startIdx(), L = this.loopIdx();
      if (S > 0 && p[S]) this.marker(ctx, X(p[S][0]), s, T.on, 'S');
      if (L >= 0 && p[L]) this.marker(ctx, X(p[L][0]), s, T.neg, 'L');
    }
    // curve + fill
    const path = () => {
      ctx.moveTo(X(p[0][0]), Y(p[0][1]));
      for (let i = 0; i < n - 1; i++) {
        const a = p[i], b = p[i + 1], dx = b[0] - a[0], k = CURVE_K * (a[2] || 0);
        if (dx <= 1e-9 || Math.abs(k) < 1e-4 || a[1] === b[1]) { ctx.lineTo(X(b[0]), Y(b[1])); continue; }
        // zoomed: the steps cover the visible part of the segment only (straight lines to its ends outside)
        const t0 = zoomed ? clamp((v.x0 - a[0]) / dx, 0, 1) : 0, t1 = zoomed ? clamp((v.x1 - a[0]) / dx, 0, 1) : 1;
        const at = t => ctx.lineTo(X(a[0] + dx * t), Y(a[1] + (b[1] - a[1]) * bend(t, k)));
        if (t0 > 0) at(t0);
        const m = Math.max(2, Math.ceil((t1 - t0) * dx * (s.w - 2 * PAD) / zx / 3));
        for (let j = 1; j <= m; j++) at(t0 + (t1 - t0) * (j / m));
        if (t1 < 1) at(1);
      }
    };
    const base = this.o.bipolar ? Y(0.5) : Y(0);
    ctx.beginPath(); path(); ctx.lineTo(X(1), base); ctx.lineTo(X(0), base); ctx.closePath();
    ctx.globalAlpha = 0.16; ctx.fillStyle = T.graph; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath(); path();
    ctx.lineWidth = 2; ctx.strokeStyle = T.graph; ctx.lineJoin = 'round'; ctx.stroke();
    // handles
    if (!ro) {
      ctx.lineWidth = 1.5;
      for (let i = 0; i < n - 1; i++) {
        const hh = handle(p, i);
        if (!hh) continue;
        const hot = this.hover === 'h' + i || (this.g && this.g.mode === 'curve' && (this.g.all || this.g.i === i));
        ctx.beginPath(); ctx.arc(X(hh[0]), Y(hh[1]), hot ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = T.bg; ctx.fill();
        ctx.strokeStyle = hot ? T.accent : T.mute; ctx.stroke();
      }
    }
    // points
    const focused = D() && D().activeElement === this.root;
    for (let i = 0; i < n; i++) {
      const q = p[i], x = X(q[0]), y = Y(q[1]), sel = this.sel.has(i), hot = this.hover === 'p' + i;
      if (q[3] || q[4]) { // bus-linked point: diamond outline
        ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x + 8, y); ctx.lineTo(x, y + 8); ctx.lineTo(x - 8, y); ctx.closePath();
        ctx.lineWidth = 1.5; ctx.strokeStyle = T.neg; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(x, y, sel || hot ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = sel ? T.accent : T.ink; ctx.fill();
      if (focused && i === this.act) { ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.lineWidth = 1.5; ctx.strokeStyle = T.accent; ctx.stroke(); }
    }
    // marquee
    const g = this.g;
    if (g && g.mode === 'marquee' && g.rect) {
      const [x0, y0, x1, y1] = g.rect;
      ctx.save();
      if (ctx.setLineDash) ctx.setLineDash([4, 3]);
      ctx.strokeStyle = T.accent; ctx.lineWidth = 1;
      ctx.strokeRect(X(x0), Y(y1), X(x1) - X(x0), Y(y0) - Y(y1));
      ctx.restore();
    }
    if (zoomed) { ctx.restore(); zoomBadge(ctx, v, s, T); }
    this.drawOverlay(true, true);
  }
  marker(ctx, x, s, col, txt) {
    ctx.save();
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.5;
    if (ctx.setLineDash) ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x, PAD); ctx.lineTo(x, s.h - PAD); ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x, 1); ctx.lineTo(x + 9, 1); ctx.lineTo(x, 10); ctx.closePath(); ctx.fill();
    ctx.font = '600 8px ' + (this.T ? this.T.ui : 'sans-serif');
    ctx.fillStyle = this.T ? this.T.bg : '#000';
    if (ctx.fillText) ctx.fillText(txt, x + 1, 7);
    ctx.restore();
  }
  // the playhead dot (force: redraw whatever it shows; live: the caller knows the editor is shown — the clock's frame, draw())
  drawOverlay(force, live) {
    if (offScreen(this, live)) return;
    const ph = this.o.playhead ? this.o.playhead() : null, v = ph == null || !isFinite(ph) ? null : clamp(ph, 0, 1);
    if (!force && v === this.ph) return;
    this.ph = v;
    const s = this.size(), ctx = fitCanvas(this.ov, s.w, s.h);
    if (!ctx) return;
    ctx.clearRect(0, 0, s.w, s.h);
    if (v == null) return;
    const T = this.T || theme(this.root), x = this.X(v, s), y = this.Y(evalPts(this.pts, v), s);
    if (x < PAD - 1 || x > s.w - PAD + 1) return; // outside the zoom window
    ctx.globalAlpha = 0.55; ctx.strokeStyle = T.ink; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, PAD); ctx.lineTo(x, s.h - PAD); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = T.on; ctx.fill();
  }
  /* the kind bar (mcurve: RISE / FALL / link / Init; spec: GRID / Presets) */
  buildBar(container) {
    const d = D(), o = this.o, bar = this.bar = d.createElement('div');
    bar.className = 'gx-bar gx-bar-' + this.kind;
    const add = w => { this.parts.push(w); bar.appendChild(w.el); return w; };
    if (this.kind === 'mcurve') {
      const fs = o.fmtSlew || (n => (n > 0 ? fmtTime(SLEW_T(n)) : 'Off'));
      const ps = k => o.parseSlew || (t => slewParse(t, this.slew()[k]));
      add(numBox({ label: 'RISE', get: () => this.slew().rise, set: (n, ph) => this.setSlew('rise', n, ph), def: 0, steps: 1000, fmt: fs, parse: ps('rise'), disabled: () => !!o.readOnly || !o.slew }));
      add(numBox({ label: 'FALL', get: () => this.slew().fall, set: (n, ph) => this.setSlew('fall', n, ph), def: 0, steps: 1000, fmt: fs, parse: ps('fall'), disabled: () => !!o.readOnly || !o.slew }));
      add(toggle({ label: 'Link rise and fall', text: 'LINK', kind: 'btn', get: () => this.slew().slink, set: v => this.setLink(v), disabled: () => !!o.readOnly || !o.slew }));
      const init = d.createElement('button');
      init.type = 'button';
      init.className = 'gx-btn';
      init.textContent = 'INIT';
      init.setAttribute('aria-label', 'Init curve');
      init.addEventListener('click', () => this.initCurve());
      bar.appendChild(init);
      this.initBtn = init;
    } else {
      const gf = o.gridField;
      add(numBox({ label: 'GRID', get: () => (gf ? clamp(+gf.get() || 0, 0, 64) / 64 : 0), set: (n, ph) => { if (gf) gf.set(Math.round(n * 64), ph); this.draw(); },
        def: 8 / 64, steps: 64, fmt: n => String(Math.round(n * 64)), disabled: () => !gf }));
      const pre = d.createElement('button');
      pre.type = 'button';
      pre.className = 'gx-btn';
      pre.textContent = 'PRESETS \u25be';
      pre.setAttribute('aria-haspopup', 'menu');
      pre.addEventListener('click', () => {
        const items = o.presets ? o.presets() || [] : [];
        const r = pre.getBoundingClientRect();
        contextMenu(r.left, r.bottom + 2, items.length ? items : [{ label: 'No presets', disabled: true }], { anchor: pre });
      });
      bar.appendChild(pre);
      this.presetBtn = pre;
    }
    if (container) container.appendChild(bar);
  }
  slew() {
    const v = this.o.slew && this.o.slew.get ? this.o.slew.get() || {} : {};
    const u = x => (fin(+x) ? clamp(+x, 0, 1) : 0);
    return { rise: u(v.rise), fall: u(v.fall), slink: v.slink ? 1 : 0 };
  }
  // RISE / FALL edits: with SmoothLink on, either field writes both (fall = rise, §2.3)
  setSlew(which, n, ph) {
    const S = this.o.slew;
    if (!S || !S.set || this.o.readOnly) return;
    const v = r5(clamp(fin(+n) ? +n : 0, 0, 1)), patch = {};
    if (this.slew().slink) { patch.rise = v; patch.fall = v; } else patch[which] = v;
    S.set(patch, ph || 'set');
    this.refreshBar();
  }
  setLink(on) {
    const S = this.o.slew;
    if (!S || !S.set || this.o.readOnly) return;
    const c = this.slew();
    S.set(on ? { slink: 1, fall: c.rise } : { slink: 0 }, 'set');
    this.refreshBar();
  }
  initCurve() {
    if (this.o.readOnly) return;
    this.sel.clear();
    this.act = -1;
    if (this.o.init) this.o.init(); else this.emit(DIAG.map(q => q.slice()), 'set');
    this.refresh();
  }
  refreshBar() { for (const w of this.parts) w.update(); }
  destroy() {
    if (this.g) this.finish();
    this.anim.stop();
    for (const f of this.offs) f();
    this.offs = [];
    for (const w of this.parts) w.destroy();
    this.parts = [];
    if (this.bar) { this.bar.remove(); this.bar = null; }
    this.root.remove();
  }
}

/* ================================================================ EnvEditor */
// Corner targets: 0 attack end (a), 1 hold end (h), 2 decay end (d, s), 3 sustain end (s), 4 release end (r);
// curve handles: 5 attack (ca), 6 decay (cd), 7 release (cr); with o.startEnd (ENV 2–4, §6.14): 8 Start level (st,
// at the attack's start) and 9 End level (en, at the release's end; on the release corner a vertical first move
// takes the End level, a horizontal one the release time). Corners of zero-length stages stack on one spot: the first
// move decides (left → the earlier corner, right → the earliest stacked corner, Alt + right → the later one).
// Options: { env: () => { a, h, d, s, r (seconds), ca, cd, cr, st?, en? (n ∈ [0,1]) }, set: (patch, phase), ghosts?,
// lock?, zoom?, playhead?, label?, height? } and (Phase 2) menu?: (x, y) => void (the graph menu, inv B15 / §13.13:
// opened by a right-click or touch long-press off the curve handles and by ContextMenu / Shift+F10 on the editor),
// startEnd?: bool | () => bool, fmtLevel?: n → text (Start /
// End readout; default dB of the linear level, 0 = −inf), grid?: () => ({ beats: 0 | 1, spb: seconds per beat }) —
// beats: grid lines at beat subdivisions and dragged times snap to them within 6 px (ui.envGrid, §6.14), steps?: () =>
// [seconds] | null — BPM units: times are restricted to these values (ENV_LADDER at the current tempo; drags and
// keys move between entries).
const ENV_NAMES = ['Attack', 'Hold', 'Decay', 'Sustain', 'Release', 'Attack curve', 'Decay curve', 'Release curve', 'Start level', 'End level'];
const BEAT_STEPS = [1 / 64, 1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16, 32, 64, 128];
const fmtBeats = b => (b < 1 ? '1/' + Math.round(1 / b) : String(b));
const fmtLvl = n => (n <= 1e-6 ? '-inf dB' : (20 * Math.log10(n)).toFixed(1) + ' dB');
const T_MAX = 32;
const fmtT = t => (t < 1 ? (t * 1000).toFixed(t < 0.01 ? 2 : t < 0.1 ? 1 : 0) + ' ms' : t.toFixed(t < 10 ? 2 : 1) + ' s');
export class EnvEditor {
  constructor(container, o) {
    injectStyles();
    this.o = o || {};
    this.height = this.o.height > 0 ? this.o.height : 140;
    this.act = -1;
    this.g = null;
    this.hover = -1;
    this.phS = NaN; this.phT = NaN; // the overlay's key: the playhead's stage and t to 1e-4 (numbers, IMPL-FR §7.3)
    this.gm = null;                 // the last draw's geometry { w, h, E, sc, G } (geoOf)
    const d = D(), root = this.root = d.createElement('div');
    root.className = 'gx-root gx-env';
    root.tabIndex = 0;
    root.setAttribute('role', 'group');
    root.setAttribute('aria-roledescription', 'envelope editor');
    root.setAttribute('aria-label', this.o.label || 'Envelope');
    root.style.height = this.height + 'px';
    this.cv = mkCanvas('gx-cv');
    this.ov = mkCanvas('gx-ov');
    this.sr = liveRegion();
    root.append(this.cv, this.ov, this.sr);
    if (container) container.appendChild(root);
    this.offs = [];
    const on = (t, type, fn) => { t.addEventListener(type, fn); this.offs.push(() => t.removeEventListener(type, fn)); };
    on(root, 'pointerdown', e => this.down(e));
    on(root, 'pointermove', e => this.moveEv(e));
    on(root, 'pointerup', e => { if (this.g && e.pointerId === this.g.id) { const g = this.g; this.finish(); this.tap(e, g); } });
    on(root, 'pointercancel', e => { if (this.g && e.pointerId === this.g.id) this.finish(e.gesture === 'two-finger'); });
    on(root, 'lostpointercapture', e => { if (this.g && e.pointerId === this.g.id) this.finish(); });
    on(root, 'dblclick', e => { if (this.lastType === 'touch') return; const t = this.hit(this.pos(e)); if (t >= 5) this.resetCurve(t); });
    // right-click / long-press: on a curve handle or a Start / End handle it resets that (to 0.5 / 0 = −inf dB),
    // elsewhere it opens the graph menu (o.menu, inv B15: Legato Inverted, Grid ▸, Voice Steal Retrigger, Lock Module)
    on(root, 'contextmenu', e => {
      if (this.g) this.finish();
      const t = this.hit(this.pos(e), this.lastType === 'touch');
      if (t >= 5) { e.preventDefault(); this.resetCurve(t); return; }
      if (this.o.menu) { e.preventDefault(); this.o.menu(e.clientX, e.clientY); }
    });
    on(root, 'keydown', e => this.key(e));
    on(root, 'focus', () => this.draw());
    on(root, 'blur', () => this.draw());
    this.offs.push(menuSource(root, { keys: false }), watchSize(this), onRescale(root, () => this.draw()));
    this.anim = animator(root, () => this.drawOverlay(false, true));
    if (this.o.playhead) this.anim.start();
    this.draw();
  }
  env(e) {
    const v = e || (this.o.env ? this.o.env() : null) || {};
    const t = x => (fin(x) ? clamp(x, 0, T_MAX) : 0), u = (x, d) => (fin(x) ? clamp(x, 0, 1) : d);
    return { a: t(v.a), h: t(v.h), d: t(v.d), s: u(v.s, 1), r: t(v.r), ca: u(v.ca, 0.5), cd: u(v.cd, 0.5), cr: u(v.cr, 0.5), st: u(v.st, 0), en: u(v.en, 0) };
  }
  se() { const f = this.o.startEnd; return !!(typeof f === 'function' ? f() : f); }
  // the beat grid (seconds per grid step at the drawing scale) or null
  beatGrid(sc) {
    const g = this.o.grid ? this.o.grid() : null;
    if (!g || !g.beats || !(g.spb > 0)) return null;
    const b = BEAT_STEPS.find(v => v * g.spb * sc.px >= 48) || BEAT_STEPS[BEAT_STEPS.length - 1];
    return { beats: b, sec: b * g.spb };
  }
  timeSteps() { const v = this.o.steps ? this.o.steps() : null; return Array.isArray(v) && v.length ? v.filter(fin).sort((a, b) => a - b) : null; }
  // dragged time → BPM-unit entry (nearest), or the beat grid within 6 px, else unchanged
  quant(t, sc) {
    const st = this.timeSteps();
    if (st) { let best = st[0]; for (const v of st) if (Math.abs(v - t) < Math.abs(best - t)) best = v; return clamp(best, 0, T_MAX); }
    const bg = this.beatGrid(sc);
    if (bg) { const q = Math.round(t / bg.sec) * bg.sec; if (Math.abs(q - t) * sc.px <= 6) return clamp(q, 0, T_MAX); }
    return t;
  }
  size() { return sizeOf(this, 60); }
  // the geometry the overlay draws on: the last draw()'s envelope, scale and corners while the size is the same (IMPL-FR §7.3:
  // an overlay frame builds no env object, no corner arrays; the dot sits on the curve as drawn), else computed and kept
  geoOf(s) {
    const M = this.gm;
    if (M && M.w === s.w && M.h === s.h) return M;
    const E = this.env(), sc = this.scale(s, E);
    return (this.gm = { w: s.w, h: s.h, E, sc, G: this.geo(s, E, sc) });
  }
  // time scale (px per second) and the sustain plateau width; frozen while dragging
  scale(s, e) {
    if (this.g) return this.g.sc;
    const SW = clamp(0.16 * (s.w - 2 * PAD), 20, 120), span = s.w - 2 * PAD - SW;
    const locked = this.o.lock ? !!this.o.lock() : true;
    const T = locked ? Math.max(e.a + e.h + e.d + e.r, 0.002) : Math.max(this.o.zoom ? +this.o.zoom() || 1 : 1, 0.002);
    return { px: span / T, SW, bottom: s.h - PAD - 12 };
  }
  geo(s, e, sc) {
    const x0 = PAD, xA = x0 + e.a * sc.px, xH = xA + e.h * sc.px, xD = xH + e.d * sc.px, xS = xD + sc.SW, xR = xS + e.r * sc.px;
    const top = PAD, bot = sc.bottom, Y = v => top + (1 - v) * (bot - top);
    const kA = ENV_K * (2 * e.ca - 1), kD = ENV_K * (2 * e.cd - 1), kR = ENV_K * (2 * e.cr - 1);
    const st = e.st || 0, en = e.en || 0;
    return {
      x0, xA, xH, xD, xS, xR, Y, kA, kD, kR,
      corners: [[xA, Y(1)], [xH, Y(1)], [xD, Y(e.s)], [xS, Y(e.s)], [xR, Y(en)]],
      handles: [[(x0 + xA) / 2, Y(st + (1 - st) * bend(0.5, kA))], [(xH + xD) / 2, Y(1 + (e.s - 1) * bend(0.5, kD))], [(xS + xR) / 2, Y(en + (e.s - en) * (1 - bend(0.5, kR)))]],
      se: [[x0, Y(st)], [xR, Y(en)]],
    };
  }
  pos(e) { return boxPoint(this.root, e); }
  hit(P, touch) {
    const s = this.size(), e = this.env(), G = this.geo(s, e, this.scale(s, e)), R = R_PT(touch, P);
    const pts = G.corners.concat(G.handles), wid = [G.xA - G.x0, G.xD - G.xH, G.xR - G.xS];
    let best = -1, bd = R * R + 1e-9;
    // later corners first on ties (zero-length stages stack up; moveEv re-targets on the first move); the curve
    // handle of a stage narrower than 2 px is not a target (it would sit on the stacked corners and steal them)
    for (let i = pts.length - 1; i >= 0; i--) {
      if (i >= 5 && wid[i - 5] < 2) continue;
      const dx = pts[i][0] - P.px, dy = pts[i][1] - P.py, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    if (this.se()) G.se.forEach((q, j) => { // Start / End levels: lower priority than the corners on ties
      const dx = q[0] - P.px, dy = q[1] - P.py, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = 8 + j; }
    });
    return best;
  }
  near(P, t, touch) { // is target t (8 / 9) within reach of P?
    const s = this.size(), e = this.env(), G = this.geo(s, e, this.scale(s, e)), R = R_PT(touch, P), q = G.se[t - 8];
    return !!q && Math.hypot(q[0] - P.px, q[1] - P.py) <= R;
  }
  emit(patch, phase) { if (this.o.set) this.o.set(patch, phase); }
  down(e) {
    this.lastType = e.pointerType || 'mouse';
    if (e.button !== 0 || this.g) return;
    this.root.focus({ preventScroll: true });
    const P = this.pos(e), t = this.hit(P, e.pointerType === 'touch');
    if (t < 0) { this.lastTap = null; return; }
    e.preventDefault();
    const s = this.size(), env = this.env(), sc = this.scale(s, env);
    this.act = t;
    this.g = { id: e.pointerId, t, P0: P, env, sc, started: false, c0: this.geo(s, env, sc).corners,
      endNear: t === 4 && this.se() && this.near(P, 9, e.pointerType === 'touch') };
    try { this.root.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    this.draw();
  }
  moveEv(e) {
    const g = this.g;
    if (!g) {
      if (e.pointerType === 'mouse') { const t = this.hit(this.pos(e), false); if (t !== this.hover) { this.hover = t; this.root.style.cursor = t < 0 ? '' : t >= 5 ? 'ns-resize' : t === 3 ? 'ns-resize' : 'grab'; this.draw(); } }
      return;
    }
    if (e.pointerId !== g.id) return;
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) { this.finish(); return; }
    const P = this.pos(e), M = mods(e), f = M.fine ? 0.1 : 1, E = g.env;
    const dt = (P.px - g.P0.px) * f / g.sc.px, dv = (g.P0.py - P.py) * f / Math.max(1, g.sc.bottom - PAD);
    if (!g.started && g.endNear && Math.abs(P.py - g.P0.py) > Math.abs(P.px - g.P0.px)) { g.t = 9; this.act = 9; } // End level
    if (!g.started && dt !== 0 && g.t <= 2) {
      // Stacked zero-length stages (hit() prefers the later corner on ties). Dragging left grabs the earlier corner
      // (the later stage cannot shrink); dragging right grabs the earliest corner stacked on the same spot, so the
      // peak of a hold-0 envelope (the default) lengthens the ATTACK. Alt-drag right keeps the later corner (pulls
      // HOLD / DECAY out of the stack; the knobs and Tab + arrows reach them too).
      const len = [E.a, E.h, E.d], c = g.c0;
      if (dt < 0) while (g.t > 0 && len[g.t] <= 0) g.t--;
      else if (!M.alt) while (g.t > 0 && len[g.t] <= 0 && c && Math.abs(c[g.t - 1][1] - c[g.t][1]) < 0.5) g.t--;
      this.act = g.t;
    }
    const tm = x => this.quant(clamp(x, 0, T_MAX), g.sc);
    let patch;
    switch (g.t) {
      case 0: patch = { a: tm(E.a + dt) }; break;
      case 1: patch = { h: tm(E.h + dt) }; break;
      case 2: patch = { d: tm(E.d + dt), s: clamp(E.s + dv, 0, 1) }; break;
      case 3: patch = { s: clamp(E.s + dv, 0, 1) }; break;
      case 4: patch = { r: tm(E.r + dt) }; break;
      case 8: patch = { st: clamp(E.st + dv, 0, 1) }; break;
      case 9: patch = { en: clamp(E.en + dv, 0, 1) }; break;
      default: {
        const dc = (g.P0.py - P.py) * f / 150;
        patch = g.t === 5 ? { ca: clamp(E.ca + dc, 0, 1) } : g.t === 6 ? { cd: clamp(E.cd - dc, 0, 1) } : { cr: clamp(E.cr - dc, 0, 1) };
      }
    }
    if (!g.started) { g.started = true; this.emit(Object.assign({}, patch, this.pick(E, patch)), 'start'); }
    this.emit(patch, 'move');
    this.draw();
  }
  pick(E, patch) { const o = {}; for (const k in patch) o[k] = E[k]; return o; } // the gesture's start values
  finish(back) { // back: gesture.js's two-finger rollback — the dragged stage's values from before the press
    const g = this.g;
    if (!g) return;
    this.g = null;
    try { this.root.releasePointerCapture(g.id); } catch (err) { /* released */ }
    if (g.started) {
      const E = back === true ? g.env : this.env(), keys = [['a'], ['h'], ['d', 's'], ['s'], ['r'], ['ca'], ['cd'], ['cr'], ['st'], ['en']][g.t], patch = {};
      for (const k of keys) patch[k] = E[k];
      if (back === true) this.emit(Object.assign({}, patch), 'move');
      this.emit(patch, 'end');
    }
    if (back !== true) modifierBar.consume();
    this.announce();
    this.draw();
  }
  resetCurve(t) {
    this.emit(t === 5 ? { ca: 0.5 } : t === 6 ? { cd: 0.5 } : t === 7 ? { cr: 0.5 } : t === 8 ? { st: 0 } : { en: 0 }, 'set');
    this.draw();
  }
  // touch: a double-tap on a curve handle or a Start / End handle resets it (the mouse double-click)
  tap(e, g) {
    if (e.pointerType !== 'touch' || g.started) { this.lastTap = null; return; }
    const P = this.pos(e), L = this.lastTap;
    if (L && L.t0 === g.t && e.timeStamp - L.t < 350 && Math.hypot(P.px - L.px, P.py - L.py) < 24 * hk(P)) { // (24 screen px)
      this.lastTap = null;
      if (g.t >= 5) this.resetCurve(g.t);
    } else this.lastTap = { t: e.timeStamp, px: P.px, py: P.py, t0: g.t };
  }
  key(e) {
    if (e.target !== this.root) return;
    const k = e.key;
    if ((k === 'ContextMenu' || (k === 'F10' && e.shiftKey)) && this.o.menu) {
      e.preventDefault();
      const s = this.size(), c = boxClient(this.root, s.w / 2, s.h / 2);
      this.o.menu(c.x, c.y);
      return;
    }
    if (k === 'Tab') {
      const j = this.act + (e.shiftKey ? -1 : 1);
      if ((e.shiftKey && this.act < 0) || j < 0 || j > (this.se() ? 9 : 7)) { this.act = -1; this.draw(); return; }
      e.preventDefault(); this.act = j; this.announce(); this.draw(); return;
    }
    if (this.act < 0 || !/^Arrow/.test(k)) return;
    e.preventDefault();
    const E = this.env(), up = k === 'ArrowUp' || k === 'ArrowRight' ? 1 : -1, vert = k === 'ArrowUp' || k === 'ArrowDown';
    const ts = this.timeSteps(), sv = (e.shiftKey ? 0.001 : 0.01) * up, cv = (e.shiftKey ? 0.005 : 0.02) * up;
    const tStep = ts ? x => { // BPM units: the next / previous entry
      if (up > 0) { for (const v of ts) if (v > x + 1e-9) return clamp(v, 0, T_MAX); return clamp(ts[ts.length - 1], 0, T_MAX); }
      for (let i = ts.length - 1; i >= 0; i--) if (ts[i] < x - 1e-9) return clamp(ts[i], 0, T_MAX);
      return clamp(ts[0], 0, T_MAX);
    } : x => tmStep(x, up, e.shiftKey);
    let patch = null;
    switch (this.act) {
      case 0: patch = { a: tStep(E.a) }; break;
      case 1: patch = { h: tStep(E.h) }; break;
      case 2: patch = vert ? { s: clamp(E.s + sv, 0, 1) } : { d: tStep(E.d) }; break;
      case 3: patch = { s: clamp(E.s + sv, 0, 1) }; break;
      case 4: patch = { r: tStep(E.r) }; break;
      case 5: patch = { ca: clamp(E.ca + cv, 0, 1) }; break;
      case 6: patch = { cd: clamp(E.cd - cv, 0, 1) }; break;
      case 8: patch = { st: clamp(E.st + sv, 0, 1) }; break;
      case 9: patch = { en: clamp(E.en + sv, 0, 1) }; break;
      default: patch = { cr: clamp(E.cr - cv, 0, 1) };
    }
    this.emit(patch, 'set');
    this.announce();
    this.draw();
  }
  announce() {
    if (this.act < 0) return;
    const E = this.env(), v = [E.a, E.h, E.d, E.s, E.r, E.ca, E.cd, E.cr, E.st, E.en][this.act];
    const txt = ENV_NAMES[this.act] + ': ' + (this.act >= 8 ? String((this.o.fmtLevel || fmtLvl)(v))
      : this.act === 3 || this.act >= 5 ? Math.round(v * 100) + '%' : fmtT(v));
    if (this.sr.textContent !== txt) this.sr.textContent = txt;
  }
  refresh() { if (this.o.playhead) this.anim.start(); this.draw(); }
  curve(ctx, E, G, sc) { // the A-H-D-S-R polyline
    const Y = G.Y, seg = (x0, x1, f) => {
      const m = Math.max(1, Math.ceil((x1 - x0) / 3));
      for (let j = 1; j <= m; j++) ctx.lineTo(x0 + (x1 - x0) * j / m, Y(f(j / m)));
    };
    const st = E.st || 0, en = E.en || 0; // Start / End levels (§6.14; 0 = the Phase-1 shape)
    ctx.moveTo(G.x0, Y(st));
    seg(G.x0, G.xA, q => st + (1 - st) * bend(q, G.kA));
    ctx.lineTo(G.xH, Y(1));
    seg(G.xH, G.xD, q => 1 + (E.s - 1) * bend(q, G.kD));
    ctx.lineTo(G.xS, Y(E.s));
    seg(G.xS, G.xR, q => en + (E.s - en) * (1 - bend(q, G.kR)));
    return sc;
  }
  draw() {
    if (unrendered(this.root)) return;
    const s = this.size(), ctx = fitCanvas(this.cv, s.w, s.h);
    if (!ctx) return;
    const T = this.T = theme(this.root), E = this.env(), sc = this.scale(s, E), G = this.geo(s, E, sc);
    this.gm = { w: s.w, h: s.h, E, sc, G };
    ctx.clearRect(0, 0, s.w, s.h);
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, s.w, s.h);
    // time grid (1-2-5 steps ≥ 48 px apart)
    const steps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
    const st = steps.find(v => v * sc.px >= 48) || 50;
    ctx.strokeStyle = T.line; ctx.lineWidth = 1; ctx.fillStyle = T.mute;
    ctx.font = '500 9px ' + T.mono;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) { const y = Math.round(G.Y(i / 4)) + 0.5; ctx.moveTo(PAD, y); ctx.lineTo(s.w - PAD, y); }
    ctx.stroke();
    const bg = this.beatGrid(sc), gs = bg ? bg.sec : st, lbl = bg ? t => fmtBeats(Math.round(t / bg.sec) * bg.beats) : fmtT;
    const tick = (x, t) => { ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, PAD); ctx.lineTo(Math.round(x) + 0.5, sc.bottom); ctx.stroke(); if (ctx.fillText) ctx.fillText(lbl(t), x + 2, s.h - 3); };
    for (let t = gs, x = G.x0 + gs * sc.px; x < G.xD - 4 && t < 1e3; t += gs, x = G.x0 + t * sc.px) tick(x, t);
    for (let t = gs, x = G.xS + gs * sc.px; x < s.w - PAD - 4 && t < 1e3; t += gs, x = G.xS + t * sc.px) tick(x, t);
    // ghosts (other envelopes in use)
    const ghosts = this.o.ghosts ? this.o.ghosts() || [] : [];
    for (const gh of ghosts) {
      const Eg = this.env(gh), Gg = this.geo(s, Eg, sc);
      ctx.beginPath(); this.curve(ctx, Eg, Gg, sc);
      ctx.strokeStyle = T.mute; ctx.globalAlpha = 0.45; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1;
    }
    // envelope
    ctx.beginPath(); this.curve(ctx, E, G, sc); ctx.lineTo(G.xR, G.Y(0)); ctx.closePath();
    ctx.globalAlpha = 0.16; ctx.fillStyle = T.accent; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath(); this.curve(ctx, E, G, sc);
    ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.strokeStyle = T.accent; ctx.stroke();
    // sustain plateau guide
    ctx.save();
    if (ctx.setLineDash) ctx.setLineDash([3, 3]);
    ctx.strokeStyle = T.mute; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(G.xD, PAD); ctx.lineTo(G.xD, sc.bottom); ctx.moveTo(G.xS, PAD); ctx.lineTo(G.xS, sc.bottom); ctx.stroke();
    ctx.restore();
    const focused = D() && D().activeElement === this.root;
    G.corners.forEach((c, i) => {
      const hot = this.hover === i || (this.g && this.g.t === i);
      ctx.beginPath(); ctx.arc(c[0], c[1], hot ? 5 : 4, 0, Math.PI * 2); ctx.fillStyle = hot ? T.accent : T.ink; ctx.fill();
      if (focused && this.act === i) { ctx.beginPath(); ctx.arc(c[0], c[1], 8, 0, Math.PI * 2); ctx.lineWidth = 1.5; ctx.strokeStyle = T.accent; ctx.stroke(); }
    });
    G.handles.forEach((c, j) => {
      const i = 5 + j, hot = this.hover === i || (this.g && this.g.t === i);
      ctx.beginPath(); ctx.arc(c[0], c[1], hot ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = T.bg; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = hot ? T.accent : T.mute; ctx.stroke();
      if (focused && this.act === i) { ctx.beginPath(); ctx.arc(c[0], c[1], 7, 0, Math.PI * 2); ctx.strokeStyle = T.accent; ctx.stroke(); }
    });
    if (this.se()) G.se.forEach((c, j) => { // Start / End level handles (squares)
      const i = 8 + j, hot = this.hover === i || (this.g && this.g.t === i);
      ctx.fillStyle = hot ? T.accent : T.on;
      ctx.fillRect(c[0] - (hot ? 4.5 : 3.5), c[1] - (hot ? 4.5 : 3.5), hot ? 9 : 7, hot ? 9 : 7);
      if (focused && this.act === i) { ctx.lineWidth = 1.5; ctx.strokeStyle = T.accent; ctx.strokeRect(c[0] - 7, c[1] - 7, 14, 14); }
    });
    this.drawOverlay(true, true);
  }
  // the playhead dot (force / live as CurveEditor's); keyed on numbers — the stage and t to 1e-4 —, drawn on geoOf
  drawOverlay(force, live) {
    if (offScreen(this, live)) return;
    const ph = this.o.playhead ? this.o.playhead() : null, on = !!(ph && ph.stage), tv = on ? +ph.t : 0;
    const st = on ? +ph.stage : 0, tk = tv === tv ? Math.round(tv * 1e4) : -1;
    if (!force && st === this.phS && tk === this.phT) return;
    this.phS = st; this.phT = tk;
    const s = this.size(), ctx = fitCanvas(this.ov, s.w, s.h);
    if (!ctx) return;
    ctx.clearRect(0, 0, s.w, s.h);
    if (!on) return;
    const M = this.geoOf(s), E = M.E, sc = M.sc, G = M.G, t = Math.max(0, +ph.t || 0);
    let x, v;
    switch (ph.stage) {
      case 1: x = G.x0 + Math.min(t, E.a) * sc.px; v = E.a > 0 ? E.st + (1 - E.st) * bend(Math.min(1, t / E.a), G.kA) : 1; break;
      case 2: x = G.xA + Math.min(t, E.h) * sc.px; v = 1; break;
      case 3: x = G.xH + Math.min(t, E.d) * sc.px; v = 1 + (E.s - 1) * (E.d > 0 ? bend(Math.min(1, t / E.d), G.kD) : 1); break;
      case 4: x = (G.xD + G.xS) / 2; v = E.s; break;
      case 5: x = G.xS + Math.min(t, E.r) * sc.px; v = E.en + (E.s - E.en) * (1 - (E.r > 0 ? bend(Math.min(1, t / E.r), G.kR) : 1)); break;
      default: return;
    }
    const T = this.T || theme(this.root);
    x = clamp(x, PAD, s.w - PAD);
    ctx.beginPath(); ctx.arc(x, G.Y(v), 4, 0, Math.PI * 2); ctx.fillStyle = T.on; ctx.fill();
  }
  destroy() {
    if (this.g) this.finish();
    this.anim.stop();
    for (const f of this.offs) f();
    this.offs = [];
    this.root.remove();
  }
}
// keyboard time step: ×/÷ 1.1 (Shift 1.01), at least 1 ms (Shift 0.1 ms)
function tmStep(x, dir, fine) {
  const f = fine ? 1.01 : 1.1, minStep = fine ? 0.0001 : 0.001;
  const y = dir > 0 ? Math.max(x * f, x + minStep) : Math.min(x / f, x - minStep);
  return clamp(y, 0, T_MAX);
}

/* ================================================================ PathEditor */
// 2-D LFO path editor (Path-type LFOs, inv B16, §6.15.3): points anywhere, drawn in order; closed / open toggle;
// curvature handles (y bent per segment, as serum-core resamples it). o = { get: () => path, set: (path, phase),
// grid?: () => { x, y }, label?, height = 160, readOnly?, playhead?: () => [x, y] | null (the live output dot) }.
// Gestures: drag a point (Alt / Alt latch: snap to the grid; a closed path's first point carries its closing copy);
// Shift-click toggles the selection (a selected group moves rigidly); drag on the background = marquee (Cmd/Ctrl
// adds); drag a handle vertically = curvature (Alt: every segment; Shift fine); double-click (double-tap) a point
// removes it, on the curve inserts a point there (exact split), elsewhere appends one (closed: before the closing
// copy). Keys: Tab cycles points, arrows move (grid step, Shift fine), + inserts after the active point, − / Delete
// remove, Home / End, Cmd/Ctrl-A, Escape. Context menu: Close / Open Path, Reverse Direction, Delete Selected,
// Flip Horizontal / Vertical, Init Path.
export class PathEditor {
  constructor(container, o) {
    injectStyles();
    this.o = o || {};
    this.height = this.o.height > 0 ? this.o.height : 160;
    this.sel = new Set();
    this.act = -1;
    this.g = null;
    this.hover = null;
    this.lastTap = null;
    this.phX = NaN; this.phY = NaN; // the overlay's key (numbers, IMPL-FR §7.3)
    const d = D(), root = this.root = d.createElement('div');
    root.className = 'gx-root gx-path' + (this.o.readOnly ? ' gx-ro' : '');
    root.tabIndex = 0;
    root.setAttribute('role', 'group');
    root.setAttribute('aria-roledescription', 'path editor');
    root.setAttribute('aria-label', this.o.label || 'LFO path');
    root.style.height = this.height + 'px';
    this.cv = mkCanvas('gx-cv');
    this.ov = mkCanvas('gx-ov');
    this.sr = liveRegion();
    root.append(this.cv, this.ov, this.sr);
    if (container) container.appendChild(root);
    this.offs = [];
    const on = (t, type, fn) => { t.addEventListener(type, fn); this.offs.push(() => t.removeEventListener(type, fn)); };
    on(root, 'pointerdown', e => this.down(e));
    on(root, 'pointermove', e => this.moveEv(e));
    on(root, 'pointerup', e => this.up(e));
    // (gesture.js's two-finger cancel undoes the gesture, as the editor's own pinch does: abort)
    on(root, 'pointercancel', e => { if (this.g && e.pointerId === this.g.id) { if (e.gesture === 'two-finger') this.abort(); else this.finish(); } });
    on(root, 'lostpointercapture', e => { if (this.g && e.pointerId === this.g.id) this.finish(); });
    on(root, 'pointerleave', () => { if (!this.g && this.hover) { this.hover = null; this.draw(); } });
    on(root, 'dblclick', e => { if (this.lastType !== 'touch') this.dbl(this.pos(e)); });
    on(root, 'contextmenu', e => this.ctx(e));
    on(root, 'keydown', e => this.key(e));
    on(root, 'focus', () => this.draw());
    on(root, 'blur', () => this.draw());
    this.offs.push(menuSource(root, { keys: false }), watchSize(this), onRescale(root, () => this.draw()));
    attachZoom(this, this.o.zoom);
    this.anim = animator(root, () => this.drawOverlay(false, true));
    if (this.o.playhead) this.anim.start();
    this.draw();
  }

  /* data */
  get path() { const p = this.o.get ? this.o.get() : null; return Array.isArray(p) && p.length >= 2 ? p : PATH_DEFAULT; }
  closed() { return pathClosed(this.path); }
  grid() { const g = this.o.grid ? this.o.grid() : null; return { x: g && g.x > 0 ? g.x | 0 : 0, y: g && g.y > 0 ? g.y | 0 : 0 }; }
  count() { const p = this.path; return pathClosed(p) ? p.length - 1 : p.length; } // distinct points
  emit(p, phase) { if (this.o.set) this.o.set(p, phase); }
  remapIdx(map) {
    const m = i => (i >= 0 && i < map.length ? map[i] : -1);
    this.sel = new Set([...this.sel].map(m).filter(i => i >= 0));
    this.act = m(this.act);
  }
  commit(p, map) { this.emit(p, 'set'); if (map) this.remapIdx(map); this.refresh(); }

  /* geometry (the zoom window `view` as CurveEditor) */
  size() { return sizeOf(this, 40); }
  X(x, s) { const v = this.view; return PAD + (x - v.x0) / (v.x1 - v.x0) * (s.w - 2 * PAD); }
  Y(y, s) { const v = this.view; return PAD + ((1 - y) - v.y0) / (v.y1 - v.y0) * (s.h - 2 * PAD); }
  pos(e) {
    const B = boxPoint(this.root, e), s = this.size(), v = this.view, px = B.px, py = B.py;
    return { px, py, k: B.k, x: v.x0 + (px - PAD) / (s.w - 2 * PAD) * (v.x1 - v.x0), y: 1 - (v.y0 + (py - PAD) / (s.h - 2 * PAD) * (v.y1 - v.y0)), s };
  }
  zoomed() { return !isFull(this.view); }
  setView(v) { this.view = viewOf(v); this.draw(); }
  resetView() { this.setView(FULL); }
  abort() {
    const g = this.g;
    this.lastTap = null;
    if (!g) return;
    if (g.started) this.emit(g.orig, 'move');
    if (g.mode === 'marquee') this.sel = new Set(g.keep);
    this.finish();
  }
  hitPoint(p, P, touch) {
    const R = R_PT(touch, P), n = pathClosed(p) ? p.length - 1 : p.length;
    let best = -1, bd = R * R + 1e-9;
    for (let i = 0; i < n; i++) {
      const dx = this.X(p[i][0], P.s) - P.px, dy = this.Y(p[i][1], P.s) - P.py, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  hitHandle(p, P, touch) {
    if (this.o.readOnly) return -1;
    const R = R_HD(touch, P);
    let best = -1, bd = R * R + 1e-9;
    for (let i = 0; i < p.length - 1; i++) {
      const hh = pathHandle(p, i);
      if (!hh) continue;
      const dx = this.X(hh[0], P.s) - P.px, dy = this.Y(hh[1], P.s) - P.py, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  hitCurve(p, P, touch) { // { i, t } of the curve within reach, else null
    const s = P.s, v = this.view, w = (s.w - 2 * PAD) / (v.x1 - v.x0), hh = (s.h - 2 * PAD) / (v.y1 - v.y0), nr = pathNearest(p, P.x, P.y, w, hh);
    return nr.i >= 0 && nr.d <= R_HD(touch, P) ? nr : null;
  }

  /* pointer gestures */
  down(e) {
    this.lastType = e.pointerType || 'mouse';
    if (e.button !== 0 || this.g || (this.zp && this.zp.active())) return;
    if (e.ctrlKey && !e.metaKey && isMac()) return;
    this.root.focus({ preventScroll: true });
    if (this.o.readOnly) return;
    const P = this.pos(e), p = this.path, touch = this.lastType === 'touch', mod = modKey(e), M = mods(e);
    const hit = this.hitPoint(p, P, touch), hh = hit < 0 ? this.hitHandle(p, P, touch) : -1;
    const base = { id: e.pointerId, orig: pathNorm(p), started: false, P0: P, moved: false, touch };
    if (hit >= 0) {
      if (M.shift) { if (this.sel.has(hit)) this.sel.delete(hit); else this.sel.add(hit); this.act = hit; modifierBar.consume(); this.announce(); this.draw(); return; }
      if (!this.sel.has(hit)) this.sel = new Set([hit]);
      this.act = hit;
      const q = p[hit];
      this.g = Object.assign(base, { mode: 'move', i: hit, gx: q[0] - P.x, gy: q[1] - P.y, idxs: [...this.sel].sort((a, b) => a - b) });
    } else if (hh >= 0) {
      this.g = Object.assign(base, { mode: 'curve', i: hh, all: M.alt });
    } else {
      this.g = Object.assign(base, { mode: 'marquee', add: mod, keep: mod ? new Set(this.sel) : new Set(), rect: null });
    }
    e.preventDefault();
    try { this.root.setPointerCapture(e.pointerId); } catch (err) { /* pointer gone */ }
    this.draw();
  }
  change(p) {
    if (!this.g.started) { this.g.started = true; this.emit(this.g.orig, 'start'); }
    this.emit(p, 'move');
    this.draw();
  }
  moveEv(e) {
    const g = this.g;
    if (!g) {
      if (e.pointerType === 'mouse' && !this.o.readOnly) {
        const P = this.pos(e), p = this.path, i = this.hitPoint(p, P, false), j = i < 0 ? this.hitHandle(p, P, false) : -1;
        const hv = i >= 0 ? 'p' + i : j >= 0 ? 'h' + j : null;
        if (hv !== this.hover) { this.hover = hv; this.root.style.cursor = hv ? (hv[0] === 'h' ? 'ns-resize' : 'grab') : ''; this.draw(); }
      }
      return;
    }
    if (e.pointerId !== g.id) return;
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) { this.finish(); return; }
    const P = this.pos(e), M = mods(e);
    if (Math.hypot(P.px - g.P0.px, P.py - g.P0.py) > 3 * hk(P)) g.moved = true;
    if (!g.moved) return;
    const grid = this.grid();
    if (g.mode === 'move') {
      const lead = g.orig[g.i];
      let tx = P.x + g.gx, ty = P.y + g.gy;
      if (M.alt) { tx = snapTo(tx, grid.x); ty = snapTo(ty, grid.y); }
      if (g.idxs.length <= 1) this.change(pathMove(g.orig, g.i, tx, ty));
      else this.change(pathMoveMany(g.orig, g.idxs, tx - lead[0], ty - lead[1]));
    } else if (g.mode === 'curve') {
      const dc = (g.P0.py - P.py) / 100 * (M.fine ? 0.1 : 1);
      let p = g.orig;
      const segs = g.all ? p.map((q, j) => j).slice(0, -1) : [g.i];
      for (const j of segs) {
        const a = g.orig[j], b = g.orig[j + 1], dir = b[1] < a[1] ? -1 : 1;
        p = pathSetCurve(p, j, (a[2] || 0) + dc * dir);
      }
      this.change(p);
    } else if (g.mode === 'marquee') {
      const x0 = Math.min(g.P0.x, P.x), x1 = Math.max(g.P0.x, P.x), y0 = Math.min(g.P0.y, P.y), y1 = Math.max(g.P0.y, P.y);
      g.rect = [x0, y0, x1, y1];
      const sel = new Set(g.keep), p = this.path, n = this.count();
      for (let i = 0; i < n; i++) { const q = p[i]; if (q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1) sel.add(i); }
      this.sel = sel;
      this.draw();
    }
  }
  up(e) {
    const g = this.g;
    if (!g || e.pointerId !== g.id) return;
    const P = this.pos(e);
    this.finish();
    if (g.mode === 'marquee' && !g.moved && !g.add) { this.sel.clear(); this.act = -1; this.draw(); }
    if (g.touch && !g.moved) {
      const t = e.timeStamp, L = this.lastTap;
      if (L && t - L.t < 350 && Math.hypot(P.px - L.px, P.py - L.py) < 24 * hk(P)) { this.lastTap = null; this.dbl(P); }
      else this.lastTap = { t, px: P.px, py: P.py };
    }
  }
  finish() {
    const g = this.g;
    if (!g) return;
    this.g = null;
    try { this.root.releasePointerCapture(g.id); } catch (err) { /* released */ }
    if (g.started) this.emit(pathNorm(this.path), 'end');
    modifierBar.consume();
    this.announce();
    this.draw();
  }
  dbl(P) {
    if (this.o.readOnly) return;
    const p = this.path, touch = this.lastType === 'touch', hit = this.hitPoint(p, P, touch);
    if (hit >= 0) { this.removeIdx([hit]); return; }
    const hh = this.hitHandle(p, P, touch);
    if (hh >= 0) { this.commit(pathSetCurve(p, hh, 0)); return; }
    const grid = this.grid(), c = this.hitCurve(p, P, touch);
    const x = grid.x ? snapTo(clamp(P.x, 0, 1), grid.x) : clamp(P.x, 0, 1), y = grid.y ? snapTo(clamp(P.y, 0, 1), grid.y) : clamp(P.y, 0, 1);
    const o = c ? { map: [], at: c.i, t: c.t, onCurve: true } : { map: [], append: true }, q = pathInsert(p, x, y, o);
    if (o.index < 0) { this.say('Point limit reached'); return; }
    this.commit(q, o.map);
    this.sel = new Set([o.index]);
    this.act = o.index;
    this.announce();
    this.draw();
  }
  removeIdx(idxs) {
    const map = [], p = pathRemove(this.path, idxs, { map });
    if (p.length === this.path.length) { this.say('A path keeps at least two points'); return; }
    this.sel.clear();
    this.act = clamp(this.act >= 0 && map[this.act] >= 0 ? map[this.act] : Math.min(...idxs) - 1, -1, p.length - 1);
    this.emit(p, 'set');
    this.refresh();
  }

  /* context menu */
  ctx(e) {
    e.preventDefault();
    if (this.zp && this.zp.active()) return; // never in the middle of a pinch
    if (this.g) this.finish();
    const P = this.pos(e), p = this.path, hit = this.hitPoint(p, P, this.lastType === 'touch');
    if (hit >= 0 && !this.sel.has(hit)) { this.sel = new Set([hit]); this.act = hit; }
    this.draw();
    contextMenu(e.clientX, e.clientY, this.menuItems(), { anchor: this.root });
  }
  menuItems() {
    const ro = !!this.o.readOnly, p = this.path, closed = pathClosed(p), n = this.count();
    const del = [...this.sel].filter(i => i < n);
    return [
      { label: closed ? 'Open Path' : 'Close Path', disabled: ro || (!closed && p.length >= MAX_PTS), action: () => this.setClosed(!closed) },
      { label: 'Reverse Direction', disabled: ro, action: () => this.commit(pathReverse(this.path)) },
      { label: 'Delete Selected', disabled: ro || !del.length || n - del.length < 2, action: () => this.removeIdx(del) },
      { sep: true },
      { label: 'Flip Horizontal', disabled: ro, action: () => this.commit(pathFlip(this.path, 'h')) },
      { label: 'Flip Vertical', disabled: ro, action: () => this.commit(pathFlip(this.path, 'v')) },
      { sep: true },
      { label: 'Init Path', disabled: ro, action: () => { this.sel.clear(); this.act = -1; this.commit(PATH_DEFAULT.map(q => q.slice())); } },
    ].concat(this.zp ? [{ sep: true }, { label: 'Reset Zoom', disabled: !this.zoomed(), action: () => this.resetView() }] : []);
  }
  setClosed(on) {
    if (this.o.readOnly) return;
    const p = pathSetClosed(this.path, on);
    this.commit(p);
  }

  /* keyboard */
  key(e) {
    if (e.target !== this.root) return;
    const p = this.path, n = this.count(), k = e.key, ro = !!this.o.readOnly;
    if (k === 'ContextMenu' || (k === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const s = this.size(), q = p[this.act], c = boxClient(this.root, q ? this.X(q[0], s) : s.w / 2, q ? this.Y(q[1], s) : s.h / 2);
      contextMenu(c.x, c.y, this.menuItems(), { anchor: this.root });
      return;
    }
    if (k === 'Tab') {
      const j = this.act + (e.shiftKey ? -1 : 1);
      if ((e.shiftKey && this.act < 0) || j < 0 || j >= n) { this.act = -1; this.draw(); return; }
      e.preventDefault();
      this.act = j;
      this.sel = new Set([j]);
      this.announce();
      this.draw();
      return;
    }
    if (k === 'Home' || k === 'End') { e.preventDefault(); this.act = k === 'Home' ? 0 : n - 1; this.sel = new Set([this.act]); this.announce(); this.draw(); return; }
    if ((k === 'a' || k === 'A') && modKey(e)) { e.preventDefault(); this.sel = new Set(Array.from({ length: n }, (_, i) => i)); this.draw(); return; }
    if (k === '0' && this.zoomed()) { e.preventDefault(); this.resetView(); return; }
    if (k === 'Escape') { if (this.sel.size) { e.preventDefault(); this.sel.clear(); this.draw(); } return; }
    if (ro) return;
    const grid = this.grid(), fine = e.shiftKey;
    const sx = fine ? 0.001 : grid.x ? 1 / grid.x : 0.01, sy = fine ? 0.001 : grid.y ? 1 / grid.y : 0.01;
    let dx = 0, dy = 0;
    if (k === 'ArrowLeft') dx = -sx; else if (k === 'ArrowRight') dx = sx; else if (k === 'ArrowUp') dy = sy; else if (k === 'ArrowDown') dy = -sy;
    if (dx || dy) {
      e.preventDefault();
      if (this.act < 0) { this.act = 0; this.sel = new Set([0]); }
      const idxs = this.sel.has(this.act) && this.sel.size > 1 ? [...this.sel] : [this.act];
      const q = idxs.length > 1 ? pathMoveMany(p, idxs, dx, dy) : pathMove(p, this.act, p[this.act][0] + dx, p[this.act][1] + dy);
      this.commit(q);
      this.announce();
      return;
    }
    if (k === '+' || k === '=') {
      e.preventDefault();
      const i = this.act >= 0 && this.act < p.length - 1 ? this.act : 0, m = pathAt(p, i, 0.5);
      const o = { map: [], at: i, t: 0.5, onCurve: true }, q = pathInsert(p, m[0], m[1], o);
      if (o.index < 0) { this.say('Point limit reached'); return; }
      this.commit(q, o.map);
      this.act = o.index;
      this.sel = new Set([o.index]);
      this.announce();
      this.draw();
      return;
    }
    if (k === '-' || k === '_' || k === 'Delete' || k === 'Backspace') {
      const idxs = this.sel.size ? [...this.sel] : this.act >= 0 ? [this.act] : [];
      if (!idxs.length) return;
      e.preventDefault();
      this.removeIdx(idxs);
      this.announce();
    }
  }
  say(t) { if (this.sr.textContent !== t) this.sr.textContent = t; }
  announce() {
    const p = this.path, q = p[this.act];
    if (!q) return;
    this.say(`Point ${this.act + 1} of ${this.count()}: x ${fmt3(q[0])}, y ${fmt3(q[1])}` + (this.closed() ? ', closed path' : ''));
  }

  /* drawing */
  refresh() {
    const n = this.count();
    this.sel = new Set([...this.sel].filter(i => i < n));
    if (this.act >= n) this.act = n - 1;
    if (this.o.playhead) this.anim.start();
    this.draw();
  }
  draw() {
    if (unrendered(this.root)) return;
    const s = this.size(), ctx = fitCanvas(this.cv, s.w, s.h);
    if (!ctx) return;
    const T = this.T = theme(this.root), p = this.path, n = p.length, grid = this.grid(), ro = !!this.o.readOnly;
    const X = x => this.X(x, s), Y = y => this.Y(y, s), zoomed = this.zoomed();
    ctx.clearRect(0, 0, s.w, s.h);
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, s.w, s.h);
    if (zoomed) { ctx.save(); ctx.beginPath(); ctx.rect(PAD - 6, PAD - 6, s.w - 2 * PAD + 12, s.h - 2 * PAD + 12); ctx.clip(); }
    ctx.lineWidth = 1;
    ctx.strokeStyle = T.line;
    ctx.beginPath();
    const gx = grid.x || 4, gy = grid.y || 4;
    if (gx <= 128) for (let i = 0; i <= gx; i++) { const x = Math.round(X(i / gx)) + 0.5; ctx.moveTo(x, PAD); ctx.lineTo(x, s.h - PAD); }
    if (gy <= 128) for (let i = 0; i <= gy; i++) { const y = Math.round(Y(i / gy)) + 0.5; ctx.moveTo(PAD, y); ctx.lineTo(s.w - PAD, y); }
    ctx.stroke();
    // the path
    ctx.beginPath();
    ctx.moveTo(X(p[0][0]), Y(p[0][1]));
    for (let i = 0; i < n - 1; i++) {
      const a = p[i], b = p[i + 1], k = CURVE_K * (a[2] || 0);
      if (Math.abs(k) < 1e-4 || a[1] === b[1]) { ctx.lineTo(X(b[0]), Y(b[1])); continue; }
      const m = Math.min(1024, Math.max(4, Math.ceil(Math.hypot(X(b[0]) - X(a[0]), Y(b[1]) - Y(a[1])) / 3)));
      for (let j = 1; j <= m; j++) { const q = pathAt(p, i, j / m); ctx.lineTo(X(q[0]), Y(q[1])); }
    }
    if (pathClosed(p)) { ctx.globalAlpha = 0.16; ctx.fillStyle = T.graph; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.lineWidth = 2; ctx.strokeStyle = T.graph; ctx.lineJoin = 'round'; ctx.stroke();
    // direction: a small arrow at the middle of the first segment
    const h0 = pathHandle(p, 0);
    if (h0) {
      const q1 = pathAt(p, 0, 0.55), ang = Math.atan2(Y(q1[1]) - Y(h0[1]), X(q1[0]) - X(h0[0])), ax = X(h0[0]), ay = Y(h0[1]);
      ctx.beginPath();
      ctx.moveTo(ax + 7 * Math.cos(ang), ay + 7 * Math.sin(ang));
      ctx.lineTo(ax + 7 * Math.cos(ang + 2.5), ay + 7 * Math.sin(ang + 2.5));
      ctx.lineTo(ax + 7 * Math.cos(ang - 2.5), ay + 7 * Math.sin(ang - 2.5));
      ctx.closePath();
      ctx.fillStyle = T.mute; ctx.fill();
    }
    if (!ro) {
      ctx.lineWidth = 1.5;
      for (let i = 0; i < n - 1; i++) {
        const hh = pathHandle(p, i);
        if (!hh || i === 0) continue; // segment 0 shows the direction arrow; its handle is still a target
        const hot = this.hover === 'h' + i || (this.g && this.g.mode === 'curve' && (this.g.all || this.g.i === i));
        ctx.beginPath(); ctx.arc(X(hh[0]), Y(hh[1]), hot ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = T.bg; ctx.fill();
        ctx.strokeStyle = hot ? T.accent : T.mute; ctx.stroke();
      }
    }
    const focused = D() && D().activeElement === this.root, cnt = this.count();
    for (let i = 0; i < cnt; i++) {
      const q = p[i], x = X(q[0]), y = Y(q[1]), sel = this.sel.has(i), hot = this.hover === 'p' + i;
      ctx.beginPath(); ctx.arc(x, y, sel || hot ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = sel ? T.accent : i === 0 ? T.on : T.ink; ctx.fill();
      if (focused && i === this.act) { ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.lineWidth = 1.5; ctx.strokeStyle = T.accent; ctx.stroke(); }
    }
    const g = this.g;
    if (g && g.mode === 'marquee' && g.rect) {
      const [x0, y0, x1, y1] = g.rect;
      ctx.save();
      if (ctx.setLineDash) ctx.setLineDash([4, 3]);
      ctx.strokeStyle = T.accent; ctx.lineWidth = 1;
      ctx.strokeRect(X(x0), Y(y1), X(x1) - X(x0), Y(y0) - Y(y1));
      ctx.restore();
    }
    if (zoomed) { ctx.restore(); zoomBadge(ctx, this.view, s, T); }
    this.drawOverlay(true, true);
  }
  // the live output dot (force / live as CurveEditor's); keyed on numbers — x and y to 1e-4 (IMPL-FR §7.3: no string, no
  // array a frame)
  drawOverlay(force, live) {
    if (offScreen(this, live)) return;
    const ph = this.o.playhead ? this.o.playhead() : null, on = Array.isArray(ph) && fin(ph[0]) && fin(ph[1]);
    const x = on ? clamp(ph[0], 0, 1) : 0, y = on ? clamp(ph[1], 0, 1) : 0, kx = on ? Math.round(x * 1e4) : -1, ky = on ? Math.round(y * 1e4) : -1;
    if (!force && kx === this.phX && ky === this.phY) return;
    this.phX = kx; this.phY = ky;
    const s = this.size(), ctx = fitCanvas(this.ov, s.w, s.h);
    if (!ctx) return;
    ctx.clearRect(0, 0, s.w, s.h);
    if (!on) return;
    const T = this.T || theme(this.root);
    ctx.beginPath(); ctx.arc(this.X(x, s), this.Y(y, s), 4, 0, Math.PI * 2); ctx.fillStyle = T.on; ctx.fill();
  }
  destroy() {
    if (this.g) this.finish();
    this.anim.stop();
    for (const f of this.offs) f();
    this.offs = [];
    this.root.remove();
  }
}

/* ================================================================ PZEditor */
// PZ SVF editor (§6.13.4, inv B12): four corner mini-editors — TL, TR, BL, BR, each the LP / BP / HP gains ∈ [−1, 1]
// as three bipolar vertical sliders — around an X/Y pad (wk.xyPad, Y = 0 at the top so the corners sit where their
// weight is 1) bound to the filter's X / Y destinations. o = { get: () => pz (4 × [lp, bp, hp]), set: (pz, phase),
// x?: { dest, get, set, def, fmt }, y?: { … } (the pad is omitted without them), label?, size? (pad px), readOnly? }.
// A slider edit replaces the whole pz (rounded to 5 decimals); double-click / Cmd-click resets a gain to PZ_DEFAULT.
// PZEditor.mix(pz, X, Y) → [cl, cb, ch] = TL·(1−X)(1−Y) + TR·X(1−Y) + BL·(1−X)Y + BR·XY (the DSP's blend; pure).
const PZ_CORNERS = ['TL', 'TR', 'BL', 'BR'], PZ_BANDS = ['LP', 'BP', 'HP'];
function pzNorm(pz) {
  const a = Array.isArray(pz) ? pz : [];
  return PZ_DEFAULT.map((c, k) => { const q = Array.isArray(a[k]) ? a[k] : []; return c.map((v, j) => (fin(q[j]) ? r5(clamp(q[j], -1, 1)) : v)); });
}
export class PZEditor {
  constructor(container, o) {
    injectStyles();
    this.o = o || {};
    const d = D(), root = this.root = d.createElement('div');
    root.className = 'gx-pz' + (this.o.readOnly ? ' gx-ro' : '');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', this.o.label || 'PZ SVF');
    this.parts = [];
    const ro = () => !!this.o.readOnly;
    PZ_CORNERS.forEach((name, c) => {
      const box = d.createElement('div');
      box.className = 'gx-pzc gx-pz-' + name.toLowerCase();
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', 'Corner ' + name);
      const lab = d.createElement('span');
      lab.className = 'gx-pzl';
      lab.textContent = name;
      lab.setAttribute('aria-hidden', 'true');
      box.appendChild(lab);
      PZ_BANDS.forEach((band, j) => {
        const w = slider({
          orient: 'v', bipolar: true, label: band, def: (PZ_DEFAULT[c][j] + 1) / 2,
          get: () => (this.pz()[c][j] + 1) / 2,
          set: (n, ph) => this.setGain(c, j, 2 * n - 1, ph),
          fmt: n => (2 * n - 1).toFixed(2),
          parse: t => { const v = parseFloat(String(t).replace(',', '.').replace('−', '-')); return isFinite(v) ? (clamp(v, -1, 1) + 1) / 2 : null; },
          disabled: ro,
        });
        this.parts.push(w);
        box.appendChild(w.el);
      });
      root.appendChild(box);
    });
    if (this.o.x && this.o.y) {
      const pad = xyPad({ x: this.o.x, y: this.o.y, yDown: true, size: this.o.size > 0 ? this.o.size : 96, disabled: ro, label: '' });
      pad.el.classList.add('gx-pzxy');
      this.parts.push(pad);
      this.pad = pad;
      root.appendChild(pad.el);
    }
    if (container) container.appendChild(root);
  }
  pz() { return pzNorm(this.o.get ? this.o.get() : null); }
  setGain(c, j, v, ph) {
    if (this.o.readOnly || !this.o.set) return;
    const p = this.pz();
    p[c][j] = r5(clamp(fin(+v) ? +v : 0, -1, 1));
    this.o.set(p, ph || 'set');
  }
  refresh() { for (const w of this.parts) w.update(); }
  destroy() { for (const w of this.parts) w.destroy(); this.parts = []; this.root.remove(); }
  static mix(pz, X, Y) {
    const p = pzNorm(pz), x = clamp(fin(+X) ? +X : 0, 0, 1), y = clamp(fin(+Y) ? +Y : 0, 0, 1);
    const w = [(1 - x) * (1 - y), x * (1 - y), (1 - x) * y, x * y];
    return [0, 1, 2].map(j => w[0] * p[0][j] + w[1] * p[1][j] + w[2] * p[2][j] + w[3] * p[3][j]);
  }
}

/* ================================================================ lfoEditorLarge */
// lfoEditorLarge(container, o): the LFO Editor overlay (§13.13, inv B16) — the same editor at full size plus the
// drawing tools Point / Flat / Ramp Up / Ramp Down (LFO_TOOLS). o = the editor's options (a CurveEditor of kind 'lfo',
// or with path: true a PathEditor for Path-type LFOs) plus { title?, tool?: { get: () => tool, set: tool => void }
// (shared with the panel's own tool buttons; default: local state), height? (default 60 % of the window, ≥ 240 px),
// zoom? (default true: pinch zoom, two-finger pan, Ctrl-wheel; menu Reset Zoom, key 0), onClose?: () => void }.
// role=dialog (aria-modal); Escape (unless the editor used it) and ✕ close; full screen below
// 1100 px (CSS); focus moves into the editor and returns on close. Returns { el, editor, setTool(t), refresh(),
// close() (runs onClose once), destroy() (removes without it) } — or null without a document.
export function lfoEditorLarge(container, o) {
  o = o || {};
  const d = D();
  if (!d) return null;
  injectStyles();
  // under the canvas world (a CSS transform: position: fixed would be the world's) it opens in the top layer (wk.layer)
  const prevFocus = d.activeElement, host = layer(container) || d.body;
  const el = d.createElement('div');
  el.className = 'gx-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', o.title || 'LFO Editor');
  el.tabIndex = -1;
  const head = d.createElement('div'), title = d.createElement('span'), body = d.createElement('div'), x = d.createElement('button');
  head.className = 'gx-ovh';
  title.className = 'gx-ovt';
  title.textContent = o.title || 'LFO Editor';
  body.className = 'gx-ovb';
  x.type = 'button';
  x.className = 'gx-btn gx-ovx';
  x.textContent = '✕';
  x.setAttribute('aria-label', 'Close');
  head.appendChild(title);
  let local = 'point', toolSeg = null, closed = false;
  const tool = () => { const t = o.tool && o.tool.get ? o.tool.get() : local; return LFO_TOOLS.includes(t) ? t : 'point'; };
  const setTool = t => {
    const v = LFO_TOOLS.includes(t) ? t : 'point';
    if (o.tool && o.tool.set) o.tool.set(v); else local = v;
    if (toolSeg) toolSeg.update();
  };
  if (!o.path) {
    toolSeg = seg({ label: 'Tool', items: ['Point', 'Flat', 'Ramp Up', 'Ramp Down'], get: () => LFO_TOOLS.indexOf(tool()), set: i => setTool(LFO_TOOLS[i]) });
    toolSeg.el.classList.add('gx-tools');
    head.appendChild(toolSeg.el);
  }
  head.appendChild(x);
  el.append(head, body);
  host.appendChild(el);
  const win = d.defaultView || globalThis;
  const height = o.height > 0 ? o.height : Math.max(240, Math.round((win.innerHeight || 800) * 0.6));
  const opts = Object.assign({}, o, { height });
  delete opts.tool;
  if (opts.zoom == null) opts.zoom = true; // pinch zoom / two-finger pan (§13.1); o.zoom = false turns it off
  const editor = o.path ? new PathEditor(body, opts) : new CurveEditor(body, Object.assign(opts, { kind: o.kind || 'lfo', tool }));
  function finish(run) {
    if (closed) return;
    closed = true;
    editor.destroy();
    if (toolSeg) toolSeg.destroy();
    el.remove();
    if (prevFocus && prevFocus.focus && prevFocus !== d.body && prevFocus.isConnected) prevFocus.focus({ preventScroll: true });
    if (run && o.onClose) o.onClose();
  }
  x.addEventListener('click', () => finish(true));
  el.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); finish(true); } });
  // opened outside its container (the top layer): the container's hardware keys (a panel's ⌘Z undo …) still see the
  // modified keys the editor left alone — a copy goes to the container, and what it takes stops here
  if (container && host !== container) {
    el.addEventListener('keydown', e => {
      if (e.defaultPrevented || e.key === 'Escape' || !(e.metaKey || e.ctrlKey || e.altKey)) return;
      const E = win.KeyboardEvent || globalThis.KeyboardEvent || win.Event || globalThis.Event;
      let c;
      try { c = new E('keydown', { key: e.key, code: e.code, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, bubbles: true, cancelable: true }); } catch (err) { return; }
      for (const k of ['key', 'code', 'metaKey', 'ctrlKey', 'shiftKey', 'altKey']) if (c[k] !== e[k]) try { Object.defineProperty(c, k, { value: e[k] }); } catch (err) { /* read-only */ }
      container.dispatchEvent(c);
      if (c.defaultPrevented) { e.preventDefault(); e.stopPropagation(); }
    });
  }
  editor.root.focus({ preventScroll: true });
  return {
    el, editor, setTool,
    refresh() { if (!closed) { editor.refresh(); if (toolSeg) toolSeg.update(); } },
    close: () => finish(true),
    destroy: () => finish(false),
  };
}
