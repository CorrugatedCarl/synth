// graph.js — shared curve editors (SPEC-serum §8.6, §9.3, inv A6/A12/A13/A14/A20.4.2).
//   CurveEditor  — LFO graphs (loop/start markers, point modulation, tied ends), Remap, X-Shaper and VELO/NOTE curves
//   EnvEditor    — ENV 1–3 A-H-D-S-R display with draggable corners and curve handles
//   pts          — pure point helpers (node-testable; every result satisfies §2.3)
//   shapeLib     — the shared JSON shape library (`synth.sx.shapes`) behind the editors' Load / Save Shape menus
// Browser ES module: nothing touches document / window at module top level, so node can import it (§0.1, §10.6).
import { contextMenu, injectStyles, menuSource, theme, fitCanvas, frame, reducedMotion, saveFile, pickFile, ask } from './wk.js?v=5';
import { evalPts, bend, CURVE_K, ENV_K, MAX_PTS, N_BUS } from './serum-core.js?v=5';

const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const fin = x => typeof x === 'number' && isFinite(x);
const r5 = x => Math.round(x * 1e5) / 1e5 + 0;
const busOf = v => (fin(v) ? clamp(Math.round(v), 0, N_BUS) : 0);
const D = () => globalThis.document || null;
const isMac = () => { const n = globalThis.navigator; return !!n && /Mac|iPhone|iPad|iPod/.test(n.platform || ''); };
const modKey = e => (isMac() ? e.metaKey : e.ctrlKey); // Cmd on macOS, Ctrl elsewhere
const DIAG = [[0, 0, 0], [1, 1, 0]];

/* ================================================================ pts — pure helpers */

// Valid point list (§2.3): numeric points only, clamped, sorted by x (stable), ≤ MAX_PTS, first x = 0, last x = 1,
// x/y/c rounded to 5 decimals, bus links mx/my ints 0–16 (first/last mx = 0, omitted when both 0). Mirrors
// serum-core's normalisation, so normalize(normalizeSerum output) is the identity. opts.links = false drops links.
function normalize(p, opts) {
  const links = !opts || opts.links !== false;
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
  if (out.length > MAX_PTS) out = out.slice(0, MAX_PTS);
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
// old → new indices, opts.index the new point's index (−1 when the list is full).
function insert(p, x, y, opts) {
  const a = normalize(p);
  if (a.length >= MAX_PTS) { fillMap(opts, a.length, i => i); if (opts) opts.index = -1; return a; }
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
// opts = { tie, map } (map: old → new index, −1 for replaced points). A result longer than MAX_PTS leaves the
// points unchanged.
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
  if (out.length > MAX_PTS) { fillMap(o, n, i => i); return a; }
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

export const pts = Object.freeze({ insert, remove, move, moveMany, setCurve, stepDraw, flipH, flipV, normalize, handle, SHAPES, SEG_SHAPES });

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
// rAF loop while the element is connected; draws only while it is rendered and the page visible (reduced motion: 10 fps).
function animator(el, fn) {
  let stop = null, last = 0, running = false;
  const tick = t => {
    stop = null;
    if (!running || !el.isConnected) { running = false; return; }
    const d = D(), hidden = (d && d.visibilityState === 'hidden') || (typeof el.getClientRects === 'function' && el.getClientRects().length === 0);
    if (!hidden && (!reducedMotion() || t - last >= 100)) { last = t; fn(); }
    stop = frame(tick);
  };
  return {
    start() { if (running) return; running = true; stop = frame(tick); },
    stop() { running = false; if (stop) stop(); stop = null; },
  };
}
// The canvases fill the editor's padding box (position: absolute; 100 % inside a 1 px border-box frame), so bitmaps
// are sized from clientWidth / clientHeight and pointer positions are measured from the padding-box origin.
// `hgt` = the nominal (border-box) height, used when layout has not happened yet.
function boxSize(el, minW, hgt) {
  const r = el.getBoundingClientRect(), bw = el.clientLeft || 0, bh = el.clientTop || 0;
  return { w: Math.max(minW, el.clientWidth || (r.width ? r.width - 2 * bw : 300)), h: Math.max(16, el.clientHeight || hgt - 2 * bh) };
}
function boxOrigin(el) {
  const r = el.getBoundingClientRect();
  return { left: r.left + (el.clientLeft || 0), top: r.top + (el.clientTop || 0) };
}
function observeSize(el, fn) {
  const RO = globalThis.ResizeObserver;
  if (typeof RO !== 'function') return () => {};
  const ro = new RO(() => fn());
  ro.observe(el);
  return () => ro.disconnect();
}
const fmt3 = v => (Math.round(v * 1000) / 1000).toFixed(3);

/* ================================================================ CurveEditor */
export class CurveEditor {
  constructor(container, o) {
    injectStyles();
    this.o = o || {};
    this.kind = ['lfo', 'remap', 'xshape', 'curve'].includes(this.o.kind) ? this.o.kind : 'curve';
    this.lfo = this.kind === 'lfo';
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
    root.setAttribute('aria-label', this.o.label || { lfo: 'LFO shape', remap: 'Remap curve', xshape: 'X-Shaper curve', curve: 'Curve' }[this.kind]);
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
    this.offs.push(menuSource(root, { keys: false }), observeSize(root, () => this.draw()));
    this.anim = animator(root, () => this.drawOverlay());
    if (this.o.playhead) this.anim.start();
    this.draw();
  }

  /* data */
  get pts() { const p = this.o.get ? this.o.get() : null; return Array.isArray(p) && p.length >= 2 ? p : DIAG; }
  grid() { const g = this.o.grid ? this.o.grid() : null; return { x: g && g.x > 0 ? g.x | 0 : 0, y: g && g.y > 0 ? g.y | 0 : 0 }; }
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

  /* geometry (CSS px inside the canvas) */
  size() { return boxSize(this.root, 40, this.height); }
  X(x, s) { return PAD + x * (s.w - 2 * PAD); }
  Y(y, s) { return PAD + (1 - y) * (s.h - 2 * PAD); }
  pos(e) {
    const r = boxOrigin(this.root), s = this.size();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    return { px, py, x: (px - PAD) / (s.w - 2 * PAD), y: 1 - (py - PAD) / (s.h - 2 * PAD), s };
  }
  hitPoint(p, P, touch) {
    const R = touch ? 14 : 8;
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
    const R = touch ? 12 : 6;
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
    if (e.button !== 0 || this.g) return;
    if (e.ctrlKey && !e.metaKey && isMac()) return; // macOS Ctrl-click = context menu
    this.root.focus({ preventScroll: true });
    if (this.o.readOnly) return;
    const P = this.pos(e), p = this.pts, touch = this.lastType === 'touch', mod = modKey(e);
    const hit = this.hitPoint(p, P, touch), hh = hit < 0 ? this.hitHandle(p, P, touch) : -1;
    const base = { id: e.pointerId, orig: normalize(p), started: false, P0: P, moved: false, touch };
    if (hit >= 0) {
      if (e.shiftKey && mod) { if (this.lfo && this.o.setLoop) this.o.setLoop(hit); this.act = hit; this.refresh(); return; }
      if (e.shiftKey) { if (this.sel.has(hit)) this.sel.delete(hit); else this.sel.add(hit); this.act = hit; this.announce(); this.draw(); return; }
      if (!this.sel.has(hit)) this.sel = new Set([hit]);
      this.act = hit;
      const q = p[hit];
      this.g = Object.assign(base, { mode: mod && this.sel.size > 1 ? 'rainbow' : 'move', i: hit, gx: q[0] - P.x, gy: q[1] - P.y, idxs: [...this.sel].sort((a, b) => a - b) });
    } else if (hh >= 0) {
      this.g = Object.assign(base, { mode: 'curve', i: hh, all: e.altKey });
    } else if (e.shiftKey) {
      this.g = Object.assign(base, { mode: 'draw', lastX: P.x });
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
    if (Math.hypot(P.px - g.P0.px, P.py - g.P0.py) > 3) g.moved = true;
    if (!g.moved) return;
    const grid = this.grid(), tie = this.tie();
    if (g.mode === 'move' || g.mode === 'rainbow') {
      const lead = g.orig[g.i];
      let tx = P.x + g.gx, ty = P.y + g.gy;
      if (e.altKey) { tx = snapTo(tx, grid.x); ty = snapTo(ty, grid.y); }
      if (g.idxs.length <= 1) { this.change(move(g.orig, g.i, tx, ty, { tie })); return; }
      const ws = g.mode === 'rainbow' ? g.idxs.map(j => 1 / (1 + Math.abs(g.orig[j][0] - lead[0]) * 8)) : null;
      this.change(moveMany(g.orig, g.idxs, tx - lead[0], ty - lead[1], { weights: ws, tie, lead: g.i }));
    } else if (g.mode === 'curve') {
      const dc = (g.P0.py - P.py) / 100 * (e.shiftKey ? 0.1 : 1);
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
    const p = stepDraw(this.pts, clamp(fromX, 0, 1), clamp(P.x, 0, 1), y, grid.x || 16, this.shape, { tie: this.tie(), map });
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
      if (L && t - L.t < 350 && Math.hypot(P.px - L.px, P.py - L.py) < 24) { this.lastTap = null; this.dbl(P); }
      else this.lastTap = { t, px: P.px, py: P.py };
    }
  }
  cancel(e) { if (this.g && (!e || e.pointerId === this.g.id)) this.finish(); }
  finish() {
    const g = this.g;
    if (!g) return;
    this.g = null;
    try { this.root.releasePointerCapture(g.id); } catch (err) { /* released */ }
    if (g.started) this.emit(normalize(this.pts), 'end');
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
    const o = { map: [] }, q = insert(p, x, y, o);
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
    if (this.lfo) {
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
    const items = SHAPES.map(s => ({ label: s.name, action: () => this.loadShape(s.pts) }));
    if (user.length) items.push({ sep: true }, ...user.map(s => ({ label: s.name, action: () => this.loadShape(s.pts) })));
    if (S && (S.importFile || S.exportFile || S.del)) items.push({ sep: true });
    if (S && S.del && user.length) items.push({ label: 'Delete Shape', sub: user.map(s => ({ label: s.name, action: () => { S.del(s.name); } })) });
    if (S && S.importFile) items.push({ label: 'Import Library…', action: () => this.importLib() });
    if (S && S.exportFile) items.push({ label: 'Export Library…', action: () => S.exportFile() });
    return items;
  }
  loadShape(src) {
    const p = normalize(src, { links: false });
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
      const r = boxOrigin(this.root), s = this.size(), q = p[this.act];
      const x = q ? r.left + this.X(q[0], s) : r.left + s.w / 2, y = q ? r.top + this.Y(q[1], s) : r.top + s.h / 2;
      contextMenu(x, y, this.menuItems(this.act), { anchor: this.root });
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
      const x = (p[i][0] + p[i + 1][0]) / 2, o = { map: [] }, q = insert(p, x, evalPts(p, x), o);
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
    this.draw();
  }
  draw() {
    if (!this.root.isConnected) return;
    const s = this.size(), ctx = fitCanvas(this.cv, s.w, s.h);
    if (!ctx) return;
    const T = this.T = theme(this.root), p = this.pts, n = p.length, grid = this.grid(), ro = !!this.o.readOnly;
    const X = x => this.X(x, s), Y = y => this.Y(y, s);
    ctx.clearRect(0, 0, s.w, s.h);
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, s.w, s.h);
    // grid
    ctx.lineWidth = 1;
    ctx.strokeStyle = T.line;
    ctx.beginPath();
    const gx = grid.x || 4, gy = grid.y || 4;
    if (gx <= 128) for (let i = 0; i <= gx; i++) { const x = Math.round(X(i / gx)) + 0.5; ctx.moveTo(x, PAD); ctx.lineTo(x, s.h - PAD); }
    if (gy <= 128) for (let i = 0; i <= gy; i++) { const y = Math.round(Y(i / gy)) + 0.5; ctx.moveTo(PAD, y); ctx.lineTo(s.w - PAD, y); }
    ctx.stroke();
    if (this.o.bipolar) { ctx.strokeStyle = T.mute; ctx.beginPath(); ctx.moveTo(PAD, Y(0.5)); ctx.lineTo(s.w - PAD, Y(0.5)); ctx.stroke(); }
    if (this.kind === 'remap' || this.kind === 'curve' || this.kind === 'xshape') { // identity reference
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
        const m = Math.max(2, Math.ceil(dx * (s.w - 2 * PAD) / 3));
        for (let j = 1; j <= m; j++) { const t = j / m; ctx.lineTo(X(a[0] + dx * t), Y(a[1] + (b[1] - a[1]) * bend(t, k))); }
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
    this.drawOverlay(true);
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
  drawOverlay(force) {
    if (!this.root.isConnected) return;
    const ph = this.o.playhead ? this.o.playhead() : null, v = ph == null || !isFinite(ph) ? null : clamp(ph, 0, 1);
    if (!force && v === this.ph) return;
    this.ph = v;
    const s = this.size(), ctx = fitCanvas(this.ov, s.w, s.h);
    if (!ctx) return;
    ctx.clearRect(0, 0, s.w, s.h);
    if (v == null) return;
    const T = this.T || theme(this.root), x = this.X(v, s), y = this.Y(evalPts(this.pts, v), s);
    ctx.globalAlpha = 0.55; ctx.strokeStyle = T.ink; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, PAD); ctx.lineTo(x, s.h - PAD); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = T.on; ctx.fill();
  }
  destroy() {
    if (this.g) this.finish();
    this.anim.stop();
    for (const f of this.offs) f();
    this.offs = [];
    this.root.remove();
  }
}

/* ================================================================ EnvEditor */
// Corner targets: 0 attack end (a), 1 hold end (h), 2 decay end (d, s), 3 sustain end (s), 4 release end (r);
// curve handles: 5 attack (ca), 6 decay (cd), 7 release (cr). Corners of zero-length stages stack on one spot: the
// first move decides (left → the earlier corner, right → the earliest stacked corner, Alt + right → the later one).
const ENV_NAMES = ['Attack', 'Hold', 'Decay', 'Sustain', 'Release', 'Attack curve', 'Decay curve', 'Release curve'];
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
    this.lastPh = null;
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
    on(root, 'pointerup', e => { if (this.g && e.pointerId === this.g.id) this.finish(); });
    on(root, 'pointercancel', e => { if (this.g && e.pointerId === this.g.id) this.finish(); });
    on(root, 'lostpointercapture', e => { if (this.g && e.pointerId === this.g.id) this.finish(); });
    on(root, 'dblclick', e => { const t = this.hit(this.pos(e)); if (t >= 5) this.resetCurve(t); });
    on(root, 'contextmenu', e => { const t = this.hit(this.pos(e)); if (t >= 5) { e.preventDefault(); this.resetCurve(t); } });
    on(root, 'keydown', e => this.key(e));
    on(root, 'focus', () => this.draw());
    on(root, 'blur', () => this.draw());
    this.offs.push(observeSize(root, () => this.draw()));
    this.anim = animator(root, () => this.drawOverlay());
    if (this.o.playhead) this.anim.start();
    this.draw();
  }
  env(e) {
    const v = e || (this.o.env ? this.o.env() : null) || {};
    const t = x => (fin(x) ? clamp(x, 0, T_MAX) : 0), u = (x, d) => (fin(x) ? clamp(x, 0, 1) : d);
    return { a: t(v.a), h: t(v.h), d: t(v.d), s: u(v.s, 1), r: t(v.r), ca: u(v.ca, 0.5), cd: u(v.cd, 0.5), cr: u(v.cr, 0.5) };
  }
  size() { return boxSize(this.root, 60, this.height); }
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
    return {
      x0, xA, xH, xD, xS, xR, Y, kA, kD, kR,
      corners: [[xA, Y(1)], [xH, Y(1)], [xD, Y(e.s)], [xS, Y(e.s)], [xR, Y(0)]],
      handles: [[(x0 + xA) / 2, Y(bend(0.5, kA))], [(xH + xD) / 2, Y(1 + (e.s - 1) * bend(0.5, kD))], [(xS + xR) / 2, Y(e.s * (1 - bend(0.5, kR)))]],
    };
  }
  pos(e) { const r = boxOrigin(this.root); return { px: e.clientX - r.left, py: e.clientY - r.top }; }
  hit(P, touch) {
    const s = this.size(), e = this.env(), G = this.geo(s, e, this.scale(s, e)), R = touch ? 14 : 8;
    const pts = G.corners.concat(G.handles), wid = [G.xA - G.x0, G.xD - G.xH, G.xR - G.xS];
    let best = -1, bd = R * R + 1e-9;
    // later corners first on ties (zero-length stages stack up; moveEv re-targets on the first move); the curve
    // handle of a stage narrower than 2 px is not a target (it would sit on the stacked corners and steal them)
    for (let i = pts.length - 1; i >= 0; i--) {
      if (i >= 5 && wid[i - 5] < 2) continue;
      const dx = pts[i][0] - P.px, dy = pts[i][1] - P.py, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  emit(patch, phase) { if (this.o.set) this.o.set(patch, phase); }
  down(e) {
    if (e.button !== 0 || this.g) return;
    this.root.focus({ preventScroll: true });
    const P = this.pos(e), t = this.hit(P, e.pointerType === 'touch');
    if (t < 0) return;
    e.preventDefault();
    const s = this.size(), env = this.env(), sc = this.scale(s, env);
    this.act = t;
    this.g = { id: e.pointerId, t, P0: P, env, sc, started: false, c0: this.geo(s, env, sc).corners };
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
    const P = this.pos(e), f = e.shiftKey ? 0.1 : 1, E = g.env;
    const dt = (P.px - g.P0.px) * f / g.sc.px, dv = (g.P0.py - P.py) * f / Math.max(1, g.sc.bottom - PAD);
    if (!g.started && dt !== 0 && g.t <= 2) {
      // Stacked zero-length stages (hit() prefers the later corner on ties). Dragging left grabs the earlier corner
      // (the later stage cannot shrink); dragging right grabs the earliest corner stacked on the same spot, so the
      // peak of a hold-0 envelope (the default) lengthens the ATTACK. Alt-drag right keeps the later corner (pulls
      // HOLD / DECAY out of the stack; the knobs and Tab + arrows reach them too).
      const len = [E.a, E.h, E.d], c = g.c0;
      if (dt < 0) while (g.t > 0 && len[g.t] <= 0) g.t--;
      else if (!e.altKey) while (g.t > 0 && len[g.t] <= 0 && c && Math.abs(c[g.t - 1][1] - c[g.t][1]) < 0.5) g.t--;
      this.act = g.t;
    }
    const tm = x => clamp(x, 0, T_MAX);
    let patch;
    switch (g.t) {
      case 0: patch = { a: tm(E.a + dt) }; break;
      case 1: patch = { h: tm(E.h + dt) }; break;
      case 2: patch = { d: tm(E.d + dt), s: clamp(E.s + dv, 0, 1) }; break;
      case 3: patch = { s: clamp(E.s + dv, 0, 1) }; break;
      case 4: patch = { r: tm(E.r + dt) }; break;
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
  finish() {
    const g = this.g;
    if (!g) return;
    this.g = null;
    try { this.root.releasePointerCapture(g.id); } catch (err) { /* released */ }
    if (g.started) {
      const E = this.env(), keys = [['a'], ['h'], ['d', 's'], ['s'], ['r'], ['ca'], ['cd'], ['cr']][g.t], patch = {};
      for (const k of keys) patch[k] = E[k];
      this.emit(patch, 'end');
    }
    this.announce();
    this.draw();
  }
  resetCurve(t) { this.emit(t === 5 ? { ca: 0.5 } : t === 6 ? { cd: 0.5 } : { cr: 0.5 }, 'set'); this.draw(); }
  key(e) {
    if (e.target !== this.root) return;
    const k = e.key;
    if (k === 'Tab') {
      const j = this.act + (e.shiftKey ? -1 : 1);
      if ((e.shiftKey && this.act < 0) || j < 0 || j > 7) { this.act = -1; this.draw(); return; }
      e.preventDefault(); this.act = j; this.announce(); this.draw(); return;
    }
    if (this.act < 0 || !/^Arrow/.test(k)) return;
    e.preventDefault();
    const E = this.env(), up = k === 'ArrowUp' || k === 'ArrowRight' ? 1 : -1, vert = k === 'ArrowUp' || k === 'ArrowDown';
    const tStep = x => tmStep(x, up, e.shiftKey), sv = (e.shiftKey ? 0.001 : 0.01) * up, cv = (e.shiftKey ? 0.005 : 0.02) * up;
    let patch = null;
    switch (this.act) {
      case 0: patch = { a: tStep(E.a) }; break;
      case 1: patch = { h: tStep(E.h) }; break;
      case 2: patch = vert ? { s: clamp(E.s + sv, 0, 1) } : { d: tStep(E.d) }; break;
      case 3: patch = { s: clamp(E.s + sv, 0, 1) }; break;
      case 4: patch = { r: tStep(E.r) }; break;
      case 5: patch = { ca: clamp(E.ca + cv, 0, 1) }; break;
      case 6: patch = { cd: clamp(E.cd - cv, 0, 1) }; break;
      default: patch = { cr: clamp(E.cr - cv, 0, 1) };
    }
    this.emit(patch, 'set');
    this.announce();
    this.draw();
  }
  announce() {
    if (this.act < 0) return;
    const E = this.env(), v = [E.a, E.h, E.d, E.s, E.r, E.ca, E.cd, E.cr][this.act];
    const txt = ENV_NAMES[this.act] + ': ' + (this.act === 3 || this.act >= 5 ? Math.round(v * 100) + '%' : fmtT(v));
    if (this.sr.textContent !== txt) this.sr.textContent = txt;
  }
  refresh() { if (this.o.playhead) this.anim.start(); this.draw(); }
  curve(ctx, E, G, sc) { // the A-H-D-S-R polyline
    const Y = G.Y, seg = (x0, x1, f) => {
      const m = Math.max(1, Math.ceil((x1 - x0) / 3));
      for (let j = 1; j <= m; j++) ctx.lineTo(x0 + (x1 - x0) * j / m, Y(f(j / m)));
    };
    ctx.moveTo(G.x0, Y(0));
    seg(G.x0, G.xA, q => bend(q, G.kA));
    ctx.lineTo(G.xH, Y(1));
    seg(G.xH, G.xD, q => 1 + (E.s - 1) * bend(q, G.kD));
    ctx.lineTo(G.xS, Y(E.s));
    seg(G.xS, G.xR, q => E.s * (1 - bend(q, G.kR)));
    return sc;
  }
  draw() {
    if (!this.root.isConnected) return;
    const s = this.size(), ctx = fitCanvas(this.cv, s.w, s.h);
    if (!ctx) return;
    const T = this.T = theme(this.root), E = this.env(), sc = this.scale(s, E), G = this.geo(s, E, sc);
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
    const tick = (x, t) => { ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, PAD); ctx.lineTo(Math.round(x) + 0.5, sc.bottom); ctx.stroke(); if (ctx.fillText) ctx.fillText(fmtT(t), x + 2, s.h - 3); };
    for (let t = st, x = G.x0 + st * sc.px; x < G.xD - 4 && t < 1e3; t += st, x = G.x0 + t * sc.px) tick(x, t);
    for (let t = st, x = G.xS + st * sc.px; x < s.w - PAD - 4 && t < 1e3; t += st, x = G.xS + t * sc.px) tick(x, t);
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
    this.drawOverlay(true);
  }
  drawOverlay(force) {
    if (!this.root.isConnected) return;
    const ph = this.o.playhead ? this.o.playhead() : null, key = ph && ph.stage ? ph.stage + ':' + (+ph.t).toFixed(4) : '';
    if (!force && key === this.lastPh) return;
    this.lastPh = key;
    const s = this.size(), ctx = fitCanvas(this.ov, s.w, s.h);
    if (!ctx) return;
    ctx.clearRect(0, 0, s.w, s.h);
    if (!key) return;
    const E = this.env(), sc = this.scale(s, E), G = this.geo(s, E, sc), t = Math.max(0, +ph.t || 0);
    let x, v;
    switch (ph.stage) {
      case 1: x = G.x0 + Math.min(t, E.a) * sc.px; v = E.a > 0 ? bend(Math.min(1, t / E.a), G.kA) : 1; break;
      case 2: x = G.xA + Math.min(t, E.h) * sc.px; v = 1; break;
      case 3: x = G.xH + Math.min(t, E.d) * sc.px; v = 1 + (E.s - 1) * (E.d > 0 ? bend(Math.min(1, t / E.d), G.kD) : 1); break;
      case 4: x = (G.xD + G.xS) / 2; v = E.s; break;
      case 5: x = G.xS + Math.min(t, E.r) * sc.px; v = E.s * (1 - (E.r > 0 ? bend(Math.min(1, t / E.r), G.kR) : 1)); break;
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
