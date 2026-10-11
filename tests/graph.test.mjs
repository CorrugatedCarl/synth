// graph.js (E6) — pure `pts` helpers (§8.6, §2.3 invariants, §10.6 fuzz), factory shapes, the shape library and
// headless CurveEditor / EnvEditor gesture checks on the fake DOM of tests/wk-dom.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';

// Imported before any DOM exists (§0.1, §10.6).
const G = await import('../graph.js');
const { pts, CurveEditor, EnvEditor, shapeLib } = G;
import { all, byCls, one, fresh, fire, ptr, key, setPlatform, place, raf } from './wk-dom.mjs';

const MAX_PTS = 480, CURVE_K = 10;
const bend = (t, k) => (Math.abs(k) < 1e-4 ? t : (1 - Math.exp(-k * t)) / (1 - Math.exp(-k)));
function evalPts(p, x) { // §4.4, written out independently
  const last = p.length - 1;
  if (x <= 0) return p[0][1];
  if (x >= 1) return p[last][1];
  let j = 0;
  for (let i = 0; i <= last; i++) if (p[i][0] <= x) j = i;
  if (j === last) return p[last][1];
  const dx = p[j + 1][0] - p[j][0];
  if (dx <= 1e-9) return p[j + 1][1];
  return p[j][1] + (p[j + 1][1] - p[j][1]) * bend((x - p[j][0]) / dx, CURVE_K * p[j][2]);
}
const near = (a, b, tol = 1e-9, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` ${a} != ${b}`);
const r5ok = v => Math.abs(v * 1e5 - Math.round(v * 1e5)) < 1e-6;
function valid(p, msg = '') {
  assert.ok(Array.isArray(p), msg + ' array');
  assert.ok(p.length >= 2 && p.length <= MAX_PTS, msg + ' length ' + p.length);
  assert.equal(p[0][0], 0, msg + ' first x');
  assert.equal(p[p.length - 1][0], 1, msg + ' last x');
  for (let i = 0; i < p.length; i++) {
    const q = p[i];
    assert.ok(q.length === 3 || q.length === 5, msg + ' point shape ' + JSON.stringify(q));
    const [x, y, c] = q;
    assert.ok([x, y, c].every(v => typeof v === 'number' && isFinite(v) && !Object.is(v, -0)), msg + ' numbers ' + JSON.stringify(q));
    assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1 && c >= -1 && c <= 1, msg + ' ranges ' + JSON.stringify(q));
    assert.ok(r5ok(x) && r5ok(y) && r5ok(c), msg + ' 5 decimals ' + JSON.stringify(q));
    if (i) assert.ok(x >= p[i - 1][0], msg + ' non-decreasing x at ' + i);
    if (q.length === 5) {
      assert.ok(Number.isInteger(q[3]) && Number.isInteger(q[4]) && q[3] >= 0 && q[3] <= 16 && q[4] >= 0 && q[4] <= 16, msg + ' links');
      assert.ok(q[3] || q[4], msg + ' links omitted when both 0');
      if (i === 0 || i === p.length - 1) assert.equal(q[3], 0, msg + ' end mx');
    }
  }
}
function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ------------------------------------------------------------------ pts */
test('import in node: no DOM access at module top level; exports', () => {
  assert.equal(typeof CurveEditor, 'function');
  assert.equal(typeof EnvEditor, 'function');
  assert.equal(typeof shapeLib, 'function');
  for (const f of ['insert', 'remove', 'move', 'moveMany', 'setCurve', 'stepDraw', 'flipH', 'flipV', 'normalize', 'handle']) assert.equal(typeof pts[f], 'function', f);
  assert.ok(Object.isFrozen(pts));
});

test('pts.normalize: §2.3 repair, rounding, links, idempotence, no input mutation', () => {
  const raw = [[0.7, 2, 3], [0.2, -1, -9, 3.6, 0], 'junk', [NaN, 0], [0.4, 0.5], [0.1234567, 0.3333333, 0.1111111, 40, -2]];
  const frozen = JSON.stringify(raw);
  const p = pts.normalize(raw);
  valid(p);
  assert.equal(JSON.stringify(raw), frozen);
  assert.deepEqual(p, [[0, 0.33333, 0.11111, 0, 0], [0.2, 0, -1, 4, 0], [0.4, 0.5, 0], [1, 1, 1]].map(q => (q[3] === 0 && q[4] === 0 ? q.slice(0, 3) : q)));
  assert.deepEqual(pts.normalize(p), p);
  assert.deepEqual(pts.normalize(null), [[0, 0, 0], [1, 1, 0]]);
  assert.deepEqual(pts.normalize([[0.5, 0.25]]), [[0, 0.25, 0], [1, 0.25, 0]]);
  assert.deepEqual(pts.normalize([[0, 0, 0, 3, 5], [1, 1, 0, 2, 0]]), [[0, 0, 0, 0, 5], [1, 1, 0]]);
  assert.deepEqual(pts.normalize([[0, 0, 0, 0, 5], [0.5, 1, 0, 2, 0], [1, 0]], { links: false }), [[0, 0, 0], [0.5, 1, 0], [1, 0, 0]]);
  const many = Array.from({ length: 600 }, (_, i) => [i / 599, 0.5, 0]);
  const m = pts.normalize(many);
  valid(m);
  assert.equal(m.length, MAX_PTS);
  assert.equal(Object.is(pts.normalize([[-0, -0, -0], [1, 1, 0]])[0][2], 0), true);
});

test('pts.insert / remove: position, exact curvature split, index maps, limits', () => {
  const p = [[0, 0, 0], [0.5, 1, 0.4], [1, 0, 0]];
  const o = { map: [] };
  const q = pts.insert(p, 0.75, 0.3, o);
  assert.deepEqual(q, [[0, 0, 0], [0.5, 1, 0.2], [0.75, 0.3, 0.2], [1, 0, 0]]); // c·u and c·(1 − u), u = 0.5
  assert.deepEqual(o.map, [0, 1, 3]);
  assert.equal(o.index, 2);
  assert.deepEqual(p[1], [0.5, 1, 0.4]); // input untouched
  assert.equal(pts.insert(p, 1, 0.5, o)[3][0], 1); // x = 1 lands before the last point
  assert.equal(o.index, 2);
  assert.equal(pts.insert(p, 0, 0.5, o)[1][0], 0); // x = 0 lands after the first point
  assert.equal(o.index, 1);
  assert.equal(pts.insert(p, 0.5, 0.2, o)[2][1], 0.2); // after the existing point with the same x
  const full = Array.from({ length: MAX_PTS }, (_, i) => [i / (MAX_PTS - 1), 0, 0]);
  const f = pts.insert(full, 0.5, 0.5, o);
  assert.equal(f.length, MAX_PTS);
  assert.equal(o.index, -1);
  // a point inserted on the curve leaves the curve unchanged (the reviewers' case: + on [[0,0,0.8],[1,1,0]])
  const cv = [[0, 0, 0.8], [1, 1, 0]];
  for (const x of [0.5, 0.1, 0.83]) {
    const ins = pts.insert(cv, x, evalPts(cv, x));
    valid(ins);
    let dev = 0;
    for (let i = 0; i <= 400; i++) dev = Math.max(dev, Math.abs(evalPts(ins, i / 400) - evalPts(cv, i / 400)));
    assert.ok(dev < 1e-4, 'insert at ' + x + ' changed the curve by ' + dev);
  }
  assert.deepEqual(pts.insert(cv, 0.5, 0.5)[0], [0, 0, 0.4]);
  // inside a vertical step (zero-width segment) nothing is split: the new point copies the curvature
  assert.deepEqual(pts.insert([[0, 0, 0.5], [1, 1, 0.3], [1, 0, 0]], 1, 0.5), [[0, 0, 0.5], [1, 1, 0.3], [1, 0.5, 0.3], [1, 0, 0]]);
  const r = pts.remove([[0, 0, 0], [0.2, 1, 0], [0.4, 0, 0], [0.6, 1, 0], [1, 0, 0]], [0, 2, 4, 3, 9], o);
  assert.deepEqual(r, [[0, 0, 0], [0.2, 1, 0], [1, 0, 0]]);
  assert.deepEqual(o.map, [0, 1, -1, -1, 2]);
});

test('pts.move / moveMany / setCurve: neighbour clamps, ends fixed in x, snap, tie, rainbow weights', () => {
  const p = [[0, 0.2, 0], [0.3, 1, 0], [0.6, 0, 0], [1, 0.2, 0]];
  assert.deepEqual(pts.move(p, 1, 0.9, 1.5)[1], [0.6, 1, 0]); // clamped to the right neighbour and to y 1
  assert.deepEqual(pts.move(p, 0, 0.5, 0.7)[0], [0, 0.7, 0]); // first point: y only
  const t = pts.move(p, 3, 0.2, 0.9, { tie: true });
  assert.deepEqual([t[0][1], t[3][1], t[3][0]], [0.9, 0.9, 1]);
  const s = pts.move(p, 2, 0.41, 0.33, { snap: true, grid: { x: 4, y: 3 } });
  assert.deepEqual(s[2], [0.5, 0.33333, 0]);
  assert.deepEqual(pts.move(p, 7, 0, 0), pts.normalize(p));
  // group move: order kept (stops at the unselected neighbour)
  const g = pts.moveMany(p, [1, 2], 0.5, -0.1); // rigid: stops as a block (dx 0.4)
  assert.deepEqual(g.map(q => q[0]), [0, 0.7, 1, 1]);
  assert.deepEqual(g.map(q => q[1]), [0.2, 0.9, 0, 0.2]);
  const g2 = pts.moveMany(p, [1, 2], -0.5, 0);
  assert.deepEqual(g2.map(q => q[0]), [0, 0, 0.3, 1]);
  // rainbow: weights scale the move per point
  const rb = pts.moveMany(p, [1, 2], 0, -0.4, { weights: [1, 0.5] });
  assert.deepEqual([rb[1][1], rb[2][1]], [0.6, 0]);
  // tie: the dragged end decides
  const tl = pts.moveMany(p, [0, 1], 0, 0.3, { tie: true, lead: 0 });
  assert.deepEqual([tl[0][1], tl[3][1]], [0.5, 0.5]);
  const tr = pts.moveMany(p, [2, 3], 0, 0.5, { tie: true, lead: 3 });
  assert.deepEqual([tr[0][1], tr[3][1]], [0.7, 0.7]);
  assert.equal(pts.setCurve(p, 1, 2)[1][2], 1);
  assert.equal(pts.setCurve(p, 1, -0.123456)[1][2], -0.12346);
  assert.deepEqual(pts.setCurve(p, 3, 0.5), pts.normalize(p)); // the last point starts no segment
});

test('pts.stepDraw: cell shapes, untouched outside, vertical joins, tie, map, limit', () => {
  const tri = [[0, 0, 0], [0.5, 1, 0], [1, 0, 0]];
  const o = { map: [] };
  const s = pts.stepDraw(tri, 0.3, 0.45, 0.8, 8, 'step', o); // cells 2–3 = [0.25, 0.5)
  valid(s);
  for (const x of [0.26, 0.3, 0.4, 0.49]) near(evalPts(s, x), 0.8, 1e-9, 'inside ' + x);
  for (const x of [0.1, 0.2, 0.6, 0.9]) near(evalPts(s, x), evalPts(tri, x), 1e-9, 'outside ' + x);
  assert.deepEqual(o.map, [0, -1, s.length - 1]); // the peak at 0.5 was replaced by the cell join
  // the join at the right edge keeps the triangle's value there
  near(evalPts(s, 0.5), 1, 1e-9);
  const up = pts.stepDraw(tri, 0.6, 0.6, 0.5, 4, 'Ramp Up'); // cell [0.5, 0.75): vertical step down to the ramp start
  near(evalPts(up, 0.4999), 0.9998, 1e-6); near(evalPts(up, 0.5), 0, 1e-9); near(evalPts(up, 0.625), 0.25, 1e-9); near(evalPts(up, 0.7499), 0.4998, 1e-9);
  near(evalPts(up, 0.875), 0.25, 1e-9); // the triangle again after the cell
  const dn = pts.stepDraw(tri, 0.6, 0.6, 0.5, 4, 'rampDown');
  near(evalPts(dn, 0.5), 0.5, 1e-9); near(evalPts(dn, 0.625), 0.25, 1e-9);
  const cv = pts.stepDraw(tri, 0.6, 0.6, 1, 4, 3); // curve: fast fall
  assert.ok(evalPts(cv, 0.53) < 0.5);
  // whole range, gridX 0 → 16 cells; tie keeps the ends equal
  const all16 = pts.stepDraw(tri, 0, 1, 0.3, 0, 'step', { tie: true });
  valid(all16);
  assert.equal(all16[0][1], all16[all16.length - 1][1]);
  for (let k = 0; k < 16; k++) near(evalPts(all16, (k + 0.5) / 16), 0.3);
  const lastCell = pts.stepDraw([[0, 0.2, 0], [1, 0.2, 0]], 0.99, 0.99, 0.9, 4, 'step', { tie: true });
  assert.deepEqual([lastCell[0][1], lastCell[lastCell.length - 1][1]], [0.9, 0.9]);
  const noTie = pts.stepDraw([[0, 0.2, 0], [1, 0.2, 0]], 0.99, 0.99, 0.9, 4, 'step');
  assert.deepEqual([noTie[0][1], noTie[noTie.length - 1][1]], [0.2, 0.9]);
  // painting that would exceed MAX_PTS leaves the points unchanged
  const dense = Array.from({ length: 476 }, (_, i) => [0.4 * i / 475, (i % 2) * 0.5, 0]).concat([[1, 0, 0]]);
  const om = { map: [] };
  assert.deepEqual(pts.stepDraw(dense, 0.5, 1, 1, 64, 'rampUp', om), pts.normalize(dense));
  assert.deepEqual(om.map, dense.map((q, i) => i));
  assert.equal(pts.stepDraw(dense, 0.5, 0.5, 1, 64, 'rampUp').length, 477); // 481 points would not fit either
  const fits = dense.slice(0, 469).concat([[1, 0, 0]]);
  assert.equal(pts.stepDraw(fits, 0.5, 0.5, 1, 64, 'rampUp').length, 469 + 2 + 1 + 1); // ramp + right join + last (the left join equals the ramp start: merged)
});

test('pts.stepDraw: curved segments cut by the drawn cells keep their shape outside the cells (exact split)', () => {
  const cv = [[0, 0, 0.8], [1, 1, 0]];
  const s = pts.stepDraw(cv, 0.5, 0.5, 0.2, 4, 'step'); // the reviewers' repro: cell [0.5, 0.75)
  valid(s);
  for (const x of [0.1, 0.25, 0.49, 0.76, 0.9]) near(evalPts(s, x), evalPts(cv, x), 2e-5, 'outside ' + x);
  for (const x of [0.5, 0.6, 0.74]) near(evalPts(s, x), 0.2, 1e-9, 'inside ' + x);
  // fuzz: random curved shapes, random cells and shapes; outside the drawn cells the curve never moves
  const rnd = mulberry(11);
  let worst = 0;
  for (let k = 0; k < 1500; k++) {
    const n = 2 + Math.floor(rnd() * 7), raw = [[0, rnd(), rnd() * 2 - 1]];
    for (let i = 1; i < n - 1; i++) raw.push([rnd(), rnd(), rnd() * 2 - 1]);
    raw.push([1, rnd(), 0]);
    const p = pts.normalize(raw), G = 1 + Math.floor(rnd() * 32), x0 = rnd(), x1 = rnd();
    const q = pts.stepDraw(p, x0, x1, rnd(), G, ['step', 'rampUp', 'rampDown', 'curve'][k & 3]);
    const k0 = Math.min(Math.floor(Math.min(x0, x1) * G), G - 1), k1 = Math.min(Math.floor(Math.max(x0, x1) * G), G - 1);
    const A = k0 / G, B = (k1 + 1) / G;
    for (let i = 0; i < 40; i++) {
      const x = rnd();
      if ((x > A - 1e-4 && x < B + 1e-4) || p.some(r => Math.abs(r[0] - x) < 1e-4)) continue; // cells, joins and steps
      worst = Math.max(worst, Math.abs(evalPts(q, x) - evalPts(p, x)));
    }
  }
  assert.ok(worst < 1e-3, 'max deviation outside the drawn cells ' + worst);
});

test('pts.flipH / flipV: exact mirrors of the drawn curve (curvature negated / kept), tie, map', () => {
  const p = [[0, 0.1, 0.6], [0.3, 0.9, -0.4], [0.3, 0.2, 0.25], [0.8, 0.6, 0], [1, 0.4, 0]];
  const o = { map: [] };
  const h = pts.flipH(p, o);
  valid(h);
  assert.deepEqual(o.map, [4, 3, 2, 1, 0]);
  for (let i = 1; i < 200; i++) { const x = i / 200; if (Math.abs(x - 0.7) > 1e-9) near(evalPts(h, x), evalPts(p, 1 - x), 2e-4, 'x ' + x); }
  assert.deepEqual(pts.flipH(h), pts.normalize(p));
  const v = pts.flipV(p);
  for (let i = 0; i <= 200; i++) near(evalPts(v, i / 200), 1 - evalPts(p, i / 200), 1e-9);
  assert.deepEqual(v.map(q => q[2]), p.map(q => q[2]));
  const ht = pts.flipH(p, { tie: true }), vt = pts.flipV(p, { tie: true });
  assert.equal(ht[0][1], ht[4][1]);
  assert.equal(vt[0][1], vt[4][1]);
  // bus links travel with their points; the new end loses its X link
  const l = pts.flipH([[0, 0, 0], [0.25, 1, 0, 3, 4], [1, 0, 0, 0, 2]]);
  assert.deepEqual(l, [[0, 0, 0, 0, 2], [0.75, 1, 0, 3, 4], [1, 0, 0]]);
});

test('pts fuzz: 1000 random operations keep §2.3 (with and without tie; with tie the ends stay equal)', () => {
  for (const tie of [false, true]) {
    const rnd = mulberry(tie ? 7 : 3);
    let p = tie ? pts.SHAPES[0].pts.map(q => q.slice()) : [[0, 0.3, 0], [1, 0.8, 0]];
    for (let step = 0; step < 1000; step++) {
      const n = p.length, i = Math.floor(rnd() * n), op = Math.floor(rnd() * 9), o = { map: [] };
      const idxs = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => Math.floor(rnd() * n));
      switch (op) {
        case 0: p = pts.insert(p, rnd(), rnd(), o); break;
        case 1: p = n > 12 ? pts.remove(p, idxs, o) : pts.insert(p, rnd() * 1.4 - 0.2, rnd(), o); break;
        case 2: p = pts.move(p, i, rnd() * 1.2 - 0.1, rnd() * 1.2 - 0.1, { tie, snap: rnd() < 0.3, grid: { x: 1 + Math.floor(rnd() * 16), y: Math.floor(rnd() * 8) } }); break;
        case 3: p = pts.moveMany(p, idxs, rnd() - 0.5, rnd() - 0.5, { tie, lead: idxs[0], weights: rnd() < 0.5 ? idxs.map(() => rnd()) : undefined }); break;
        case 4: p = pts.setCurve(p, i, rnd() * 2.4 - 1.2); break;
        case 5: p = pts.stepDraw(p, rnd(), rnd(), rnd(), Math.floor(rnd() * 33), ['step', 'rampUp', 'rampDown', 'curve'][Math.floor(rnd() * 4)], { tie, map: o.map }); break;
        case 6: p = pts.flipH(p, { tie, map: o.map }); break;
        case 7: p = pts.flipV(p, { tie }); break;
        default: p = pts.normalize(p.concat([[rnd(), rnd(), rnd() * 2 - 1]])); if (tie) p[p.length - 1][1] = p[0][1];
      }
      valid(p, `tie=${tie} step ${step} op ${op}`);
      if (o.map.length) assert.ok(o.map.every(j => j === -1 || (Number.isInteger(j) && j >= 0 && j < p.length)), 'map in range');
      if (tie) assert.equal(p[0][1], p[p.length - 1][1], `tied ends at step ${step} op ${op}`);
    }
  }
});

test('pts.SHAPES: the 12 factory shapes are valid, tied, frozen and deterministic', () => {
  assert.deepEqual(pts.SHAPES.map(s => s.name), ['Triangle', 'Sine', 'Saw Up', 'Saw Down', 'Square', 'Pulse 25', 'Ramp Exp', 'Stairs 4', 'Stairs 8', 'Bounce', 'S&H-ish', 'Sidechain']);
  for (const s of pts.SHAPES) {
    valid(s.pts.map(q => q.slice()), s.name);
    assert.equal(s.pts[0][1], s.pts[s.pts.length - 1][1], s.name + ' tied');
    assert.ok(Object.isFrozen(s) && Object.isFrozen(s.pts) && Object.isFrozen(s.pts[0]));
  }
  const by = n => pts.SHAPES.find(s => s.name === n).pts;
  assert.deepEqual(by('Saw Up'), [[0, 0, 0], [1, 1, 0], [1, 0, 0]]);
  assert.deepEqual(by('Saw Down'), [[0, 1, 0], [1, 0, 0], [1, 1, 0]]);
  for (let i = 0; i <= 64; i++) near(evalPts(by('Sine'), i / 64), 0.5 + 0.5 * Math.sin(2 * Math.PI * i / 64), 0.01, 'sine');
  const sh = by('S&H-ish');
  assert.equal(sh.length, 33);
  const lv = new Set(); for (let k = 0; k < 16; k++) lv.add(evalPts(sh, (k + 0.5) / 16));
  assert.ok(lv.size >= 12);
  assert.deepEqual(by('Stairs 4').filter((q, i) => i % 2 === 0).slice(0, 4).map(q => q[1]), [0, 0.33333, 0.66667, 1]);
  assert.deepEqual(pts.SEG_SHAPES.map(s => s.label), ['Step', 'Ramp Up', 'Ramp Down', 'Curve']);
});

test('shapeLib: factory + user list, save/merge/delete, import, export', async () => {
  const mem = new Map();
  const storage = { get: (k, d) => (mem.has(k) ? JSON.parse(mem.get(k)) : d), set: (k, v) => mem.set(k, JSON.stringify(v)) };
  const lib = shapeLib(storage);
  assert.equal(lib.list().length, 12);
  assert.ok(lib.list().every(s => s.factory));
  lib.save('  My Wobble ', [[0, 0.5, 0, 3, 3], [0.5, 1, 0], [1, 0.5, 0]]);
  lib.save('', [[0, 0, 0], [1, 1, 0]]);
  const u = lib.list().filter(s => !s.factory);
  assert.deepEqual(u, [{ name: 'My Wobble', pts: [[0, 0.5, 0], [0.5, 1, 0], [1, 0.5, 0]], factory: false }]); // links dropped
  lib.save('My Wobble', [[0, 1, 0], [1, 1, 0]]); // same name replaces
  assert.equal(lib.list().filter(s => !s.factory).length, 1);
  assert.deepEqual(JSON.parse(mem.get('synth.sx.shapes'))[0].pts, [[0, 1, 0], [1, 1, 0]]);
  const file = { text: () => Promise.resolve(JSON.stringify({ type: 'synth.sx.shapes', shapes: [{ name: 'B', pts: [[0, 0], [1, 1]] }, { name: 'A', pts: [[0, 0.2], [1, 0.2]] }, { bad: 1 }] })) };
  assert.equal(await lib.importFile(file), 2);
  assert.deepEqual(lib.list().filter(s => !s.factory).map(s => s.name), ['A', 'B', 'My Wobble']);
  assert.equal(await lib.importFile({ text: () => Promise.resolve('not json') }), 0);
  assert.equal(await lib.importFile(null), 0);
  lib.del('B');
  assert.deepEqual(lib.list().filter(s => !s.factory).map(s => s.name), ['A', 'My Wobble']);
  const lib2 = shapeLib({ get() { throw new Error('x'); }, set() { throw new Error('y'); } });
  assert.equal(lib2.list().length, 12);
  lib2.save('z', [[0, 0], [1, 1]]);
  // export: a JSON download through an <a download>
  const d = fresh();
  let clicked = null;
  d.body.addEventListener('click', e => { clicked = e.target; });
  assert.equal(lib.exportFile(), true);
  assert.equal(clicked.localName, 'a');
  assert.equal(clicked.download, 'shapes.json');
});

/* ------------------------------------------------------------------ CurveEditor */
const W = 214, H = 160, PAD = 7;
const X = x => PAD + x * (W - 2 * PAD), Y = y => PAD + (1 - y) * (H - 2 * PAD);
function mkCurve(o = {}) {
  const d = fresh();
  setPlatform('MacIntel');
  const st = { p: (o.p || [[0, 0, 0], [0.5, 1, 0], [1, 0, 0]]).map(q => q.slice()), calls: [], loop: -1, start: 0, grid: o.grid || { x: 0, y: 0 } };
  const host = d.createElement('div');
  d.body.appendChild(host);
  const ed = new CurveEditor(host, Object.assign({
    kind: 'lfo', get: () => st.p, set: (p, ph) => { st.p = p; st.calls.push([ph, p]); }, grid: () => st.grid,
    loop: () => st.loop, setLoop: i => { st.loop = i; }, start: () => st.start, setStart: i => { st.start = i; },
  }, o.opts || {}));
  place(ed.root, 0, 0, W, H);
  ed.refresh();
  return { d, ed, st, root: ed.root };
}
const at = (root, type, x, y, o) => ptr(root, type, x, y, o);

test('CurveEditor: DOM, drawing, accessibility', () => {
  const { ed, root } = mkCurve();
  assert.ok(root.classList.contains('gx-root') && root.classList.contains('gx-lfo'));
  assert.equal(root.getAttribute('role'), 'group');
  assert.equal(root.getAttribute('aria-label'), 'LFO shape');
  assert.equal(root.tabIndex, 0);
  assert.equal(root.style.height, '160px');
  const cv = one(root, 'gx-cv');
  assert.equal(cv.width, W);
  const calls = cv.getContext('2d').calls.map(c => c[0]);
  assert.ok(calls.includes('stroke') && calls.includes('fill') && calls.includes('arc'));
  ed.destroy();
  assert.equal(root.parentNode, null);
});

test('CurveEditor: drag a point (phases, tied ends, first point y only), Alt snaps to the grid', () => {
  const { root, st } = mkCurve({ grid: { x: 4, y: 4 } });
  at(root, 'pointerdown', X(0.5), Y(1));
  assert.deepEqual(st.calls, []); // a click alone edits nothing
  at(root, 'pointermove', X(0.6), Y(0.8));
  assert.deepEqual(st.calls.map(c => c[0]), ['start', 'move']);
  assert.deepEqual(st.calls[0][1], [[0, 0, 0], [0.5, 1, 0], [1, 0, 0]]);
  near(st.p[1][0], 0.6, 1e-5); near(st.p[1][1], 0.8, 1e-5);
  at(root, 'pointermove', X(0.62), Y(0.8), { altKey: true });
  assert.deepEqual(st.p[1].slice(0, 2), [0.5, 0.75]);
  at(root, 'pointerup', X(0.62), Y(0.8));
  assert.equal(st.calls.at(-1)[0], 'end');
  // dragging the first point moves it in y only and writes the same y to the last point (LFO tie)
  at(root, 'pointerdown', X(0), Y(0));
  at(root, 'pointermove', X(0.3), Y(0.4));
  at(root, 'pointerup', X(0.3), Y(0.4));
  assert.equal(st.p[0][0], 0);
  near(st.p[0][1], 0.4, 1e-5);
  assert.equal(st.p[2][1], st.p[0][1]);
});

test('CurveEditor: double-click adds / deletes, handle drag curves, Shift-drag step-draws, marquee + Delete', () => {
  const { root, st, ed } = mkCurve({ grid: { x: 8, y: 4 } });
  fire(root, 'dblclick', { clientX: X(0.7), clientY: Y(0.3) });
  assert.equal(st.p.length, 4);
  assert.deepEqual(st.p[2].slice(0, 2), [0.75, 0.25]); // snapped to the grid
  assert.equal(st.calls.at(-1)[0], 'set');
  fire(root, 'dblclick', { clientX: X(0.75), clientY: Y(0.25) });
  assert.equal(st.p.length, 3);
  fire(root, 'dblclick', { clientX: X(0), clientY: Y(0) }); // first point: never deleted
  assert.equal(st.p.length, 3);
  // curve handle of segment 0 (rising): dragging up bends it up (c > 0); Alt bends every segment
  const hx = X(0.25), hy = Y(0.5);
  at(root, 'pointerdown', hx, hy);
  at(root, 'pointermove', hx, hy - 30);
  at(root, 'pointerup', hx, hy - 30);
  near(st.p[0][2], 0.3, 1e-9);
  assert.equal(st.p[1][2], 0);
  const h1 = pts.handle(st.p, 1);
  at(root, 'pointerdown', X(h1[0]), Y(h1[1]), { altKey: true });
  at(root, 'pointermove', X(h1[0]), Y(h1[1]) - 20, { altKey: true });
  at(root, 'pointerup', X(h1[0]), Y(h1[1]) - 20);
  near(st.p[0][2], 0.5, 1e-9); // rising segment: +0.2
  near(st.p[1][2], -0.2, 1e-9); // falling segment: up = slow start
  // Shift-drag on the background paints steps at the grid
  at(root, 'pointerdown', X(0.1), Y(0.9), { shiftKey: true });
  at(root, 'pointermove', X(0.3), Y(0.9), { shiftKey: true });
  at(root, 'pointerup', X(0.3), Y(0.9));
  for (const x of [0.01, 0.15, 0.3, 0.37]) near(evalPts(st.p, x), 1, 1e-9, 'painted ' + x);
  assert.equal(st.p[0][1], st.p[st.p.length - 1][1]); // tied
  // marquee on empty background selects points; Delete removes them
  const n0 = st.p.length;
  at(root, 'pointerdown', X(0.3), 0);
  at(root, 'pointermove', X(0.99), H);
  at(root, 'pointerup', X(0.99), H);
  const inside = st.p.filter((q, i) => i > 0 && i < st.p.length - 1 && q[0] >= 0.3 && q[0] <= 0.99).length;
  assert.ok(inside > 0);
  root.focus();
  key(root, 'Delete');
  assert.equal(st.p.length, n0 - inside);
  ed.destroy();
});

test('CurveEditor: keyboard — Tab cycles points, arrows move by grid (Shift fine), +/− add and remove', () => {
  const { root, st } = mkCurve({ grid: { x: 4, y: 4 } });
  root.focus();
  const t1 = key(root, 'Tab');
  assert.ok(t1.defaultPrevented);
  key(root, 'Tab');
  assert.equal(one(root, 'gx-sr').textContent, 'Point 2 of 3: x 0.500, y 1.000');
  key(root, 'ArrowLeft');
  assert.deepEqual(st.p[1].slice(0, 2), [0.25, 1]);
  key(root, 'ArrowDown', { shiftKey: true });
  assert.equal(st.p[1][1], 0.999);
  key(root, '+');
  assert.equal(st.p.length, 4);
  near(st.p[2][0], (0.25 + 1) / 2, 1e-5);
  key(root, '-');
  assert.equal(st.p.length, 3);
  key(root, 'End');
  key(root, 'ArrowUp');
  assert.equal(st.p[2][1], 0.25);
  assert.equal(st.p[0][1], 0.25); // tied
  const out = key(root, 'Tab'); // past the last point: focus leaves the editor
  assert.equal(out.defaultPrevented, false);
  assert.ok(key(root, 'Tab').defaultPrevented); // (re-entering starts at the first point again)
});

test('CurveEditor: + on a curved segment adds a point without reshaping the curve', () => {
  const { root, st } = mkCurve({ p: [[0, 0, 0.8], [1, 1, 0]], opts: { kind: 'remap' } });
  const before = st.p.map(q => q.slice());
  root.focus();
  key(root, 'Tab');
  key(root, '+');
  assert.equal(st.p.length, 3);
  assert.equal(st.p[1][0], 0.5);
  assert.deepEqual([st.p[0][2], st.p[1][2]], [0.4, 0.4]);
  let dev = 0;
  for (let i = 0; i <= 200; i++) dev = Math.max(dev, Math.abs(evalPts(st.p, i / 200) - evalPts(before, i / 200)));
  assert.ok(dev < 1e-4, 'curve moved by ' + dev);
});

test('CurveEditor / EnvEditor: canvases fill the padding box (bitmap from clientHeight, pointer from the inner origin)', () => {
  const { ed, root, st } = mkCurve({ grid: { x: 0, y: 0 } });
  // emulate a 1 px border: border box W × H at (10, 20), padding box (W − 2) × (H − 2)
  place(root, 10, 20, W, H);
  Object.defineProperty(root, 'clientWidth', { value: W - 2, configurable: true });
  Object.defineProperty(root, 'clientHeight', { value: H - 2, configurable: true });
  Object.defineProperty(root, 'clientLeft', { value: 1, configurable: true });
  Object.defineProperty(root, 'clientTop', { value: 1, configurable: true });
  ed.refresh();
  const cv = one(root, 'gx-cv');
  assert.deepEqual([cv.width, cv.height], [W - 2, H - 2]);
  assert.deepEqual(ed.size(), { w: W - 2, h: H - 2 });
  // the peak (0.5, 1) is drawn at canvas (PAD + 0.5·(w − 2·PAD), PAD) = client (11 + that, 21 + PAD)
  const s = ed.size(), px = 11 + 7 + 0.5 * (s.w - 14), py = 21 + 7;
  at(root, 'pointerdown', px, py);
  at(root, 'pointermove', px, py + (s.h - 14) / 2);
  at(root, 'pointerup', px, py + (s.h - 14) / 2);
  near(st.p[1][1], 0.5, 1e-5);
  near(st.p[1][0], 0.5, 1e-5);
  ed.destroy();
});

test('CurveEditor: context menu items (lfo / remap), loop / start, flips, shapes, point modulation', () => {
  const pm = [];
  const lib = { list: () => [{ name: 'Mine', pts: [[0, 0.5, 0], [1, 0.5, 0]], factory: false }], save() {}, del() {}, exportFile() {}, importFile() {} };
  const { d, root, st } = mkCurve({
    p: [[0, 0, 0], [0.25, 1, 0, 0, 2], [0.5, 0, 0], [1, 0, 0]],
    opts: {
      pointMenu: (idxs, axis) => [{ label: 'Bus 2 (LFO 3)', action: () => pm.push(['bus', axis, idxs]) }, { label: 'New bus', action: () => pm.push(['new', axis, idxs]) }],
      removePointMods: idxs => pm.push(['rm', idxs]), shapes: lib, fromWavetable: () => [{ label: 'From OSC A', action: () => pm.push(['wt']) }],
    },
  });
  fire(root, 'contextmenu', { clientX: X(0.25), clientY: Y(1), button: 2 });
  const menu = byCls(d.body, 'wk-ctx')[0];
  const labels = byCls(menu, 'wk-cl').map(n => n.textContent);
  assert.deepEqual(labels, ['Segment shape', 'Delete Selected', 'Set Start Point', 'Set Loopback Point', 'Clear Loopback', 'Flip Horizontal', 'Flip Vertical',
    'Modulate X', 'Modulate Y', 'Remove Point Modulations', 'Load Shape', 'Save Shape…', 'Wavetable to LFO Shape']);
  const item = name => byCls(menu, 'wk-ci').find(n => one(n, 'wk-cl').textContent === name);
  assert.equal(item('Clear Loopback').getAttribute('aria-disabled'), 'true');
  fire(item('Set Loopback Point'), 'pointerdown');
  fire(item('Set Loopback Point'), 'click');
  assert.equal(st.loop, 1); // the right-clicked point
  // Modulate Y ▸ Bus 2 for the selected point
  fire(root, 'contextmenu', { clientX: X(0.25), clientY: Y(1), button: 2 });
  let m2 = byCls(d.body, 'wk-ctx')[0];
  const my = byCls(m2, 'wk-ci').find(n => one(n, 'wk-cl').textContent === 'Modulate Y');
  fire(my, 'pointerenter', { bubbles: false });
  const sub = byCls(d.body, 'wk-ctx')[1];
  const b2 = byCls(sub, 'wk-ci')[0];
  fire(b2, 'pointerdown'); fire(b2, 'click');
  assert.deepEqual(pm.at(-1), ['bus', 'y', [1]]);
  // Remove Point Modulations on the linked point
  fire(root, 'contextmenu', { clientX: X(0.25), clientY: Y(1), button: 2 });
  m2 = byCls(d.body, 'wk-ctx')[0];
  const rm = byCls(m2, 'wk-ci').find(n => one(n, 'wk-cl').textContent === 'Remove Point Modulations');
  fire(rm, 'pointerdown'); fire(rm, 'click');
  assert.deepEqual(pm.at(-1), ['rm', [1]]);
  // Flip Horizontal carries the loop point with it (index 1 → 2)
  fire(root, 'contextmenu', { clientX: X(0.25), clientY: Y(1), button: 2 });
  m2 = byCls(d.body, 'wk-ctx')[0];
  const fh = byCls(m2, 'wk-ci').find(n => one(n, 'wk-cl').textContent === 'Flip Horizontal');
  fire(fh, 'pointerdown'); fire(fh, 'click');
  assert.equal(st.loop, 2);
  assert.deepEqual(st.p.map(q => q[0]), [0, 0.5, 0.75, 1]);
  // Load Shape ▸ Saw Up: links removed through the host, loop cleared
  fire(root, 'contextmenu', { clientX: 5, clientY: 5, button: 2 });
  m2 = byCls(d.body, 'wk-ctx')[0];
  fire(byCls(m2, 'wk-ci').find(n => one(n, 'wk-cl').textContent === 'Load Shape'), 'pointerenter', { bubbles: false });
  const shapes = byCls(d.body, 'wk-ctx')[1];
  assert.deepEqual(byCls(shapes, 'wk-cl').map(n => n.textContent).slice(0, 3), ['Triangle', 'Sine', 'Saw Up']);
  assert.ok(byCls(shapes, 'wk-cl').map(n => n.textContent).includes('Mine'));
  const saw = byCls(shapes, 'wk-ci').find(n => one(n, 'wk-cl').textContent === 'Saw Up');
  fire(saw, 'pointerdown'); fire(saw, 'click');
  assert.deepEqual(st.p, [[0, 0, 0], [1, 1, 0], [1, 0, 0]]);
  assert.equal(st.loop, -1);
  // Shift+Cmd-click a point sets the loopback (macOS)
  at(root, 'pointerdown', X(1), Y(1), { shiftKey: true, metaKey: true });
  assert.equal(st.loop, 1); // overlapping right-edge points: the left one
  // remap kind: no LFO items
  const r = mkCurve({ opts: { kind: 'remap', shapes: lib } });
  fire(r.root, 'contextmenu', { clientX: 5, clientY: 5, button: 2 });
  const rl = byCls(byCls(r.d.body, 'wk-ctx')[0], 'wk-cl').map(n => n.textContent);
  assert.deepEqual(rl, ['Segment shape', 'Delete Selected', 'Flip Horizontal', 'Flip Vertical', 'Load Shape', 'Save Shape…']);
  // remap ends are independent: dragging the first point leaves the last one
  at(r.root, 'pointerdown', X(0), Y(0));
  at(r.root, 'pointermove', X(0), Y(0.5));
  at(r.root, 'pointerup', X(0), Y(0.5));
  assert.equal(r.st.p.at(-1)[1], 0);
});

test('CurveEditor: segment shape choice drives Shift-draw; readOnly ignores edits; playhead animates', () => {
  const { d, root, st, ed } = mkCurve({ p: [[0, 0, 0], [1, 0, 0]], grid: { x: 2, y: 0 } });
  fire(root, 'contextmenu', { clientX: 5, clientY: 5, button: 2 });
  fire(byCls(byCls(d.body, 'wk-ctx')[0], 'wk-ci')[0], 'pointerenter', { bubbles: false });
  const ru = byCls(byCls(d.body, 'wk-ctx')[1], 'wk-ci')[1];
  fire(ru, 'pointerdown'); fire(ru, 'click');
  assert.equal(ed.shape, 'rampUp');
  at(root, 'pointerdown', X(0.75), Y(1), { shiftKey: true });
  at(root, 'pointerup', X(0.75), Y(1));
  near(evalPts(st.p, 0.75), 0.5, 1e-9);
  ed.destroy();
  const ro = mkCurve({ opts: { readOnly: true } });
  at(ro.root, 'pointerdown', X(0.5), Y(1));
  at(ro.root, 'pointermove', X(0.6), Y(0.2));
  at(ro.root, 'pointerup', X(0.6), Y(0.2));
  fire(ro.root, 'dblclick', { clientX: X(0.3), clientY: Y(0.3) });
  ro.root.focus(); key(ro.root, 'Tab'); key(ro.root, 'ArrowUp');
  assert.deepEqual(ro.st.calls, []);
  ro.ed.destroy();
  raf.install();
  try {
    let ph = 0.25;
    const pl = mkCurve({ opts: { playhead: () => ph } });
    const ov = one(pl.root, 'gx-ov'), ctx = ov.getContext('2d');
    ctx.calls.length = 0;
    ph = 0.5;
    raf.flush(1);
    assert.ok(ctx.calls.some(c => c[0] === 'arc'));
    ctx.calls.length = 0;
    raf.flush(1); // same phase: no redraw
    assert.equal(ctx.calls.length, 0);
    pl.ed.destroy();
    raf.flush(2);
    assert.equal(raf.pending, 0); // the loop stops with the editor
  } finally { raf.uninstall(); }
});

/* ------------------------------------------------------------------ EnvEditor */
function mkEnv(o = {}) {
  const d = fresh();
  const st = { e: Object.assign({ a: 1, h: 0.5, d: 1, s: 0.5, r: 1, ca: 0.5, cd: 0.5, cr: 0.5 }, o.e || {}), calls: [] };
  const host = d.createElement('div');
  d.body.appendChild(host);
  const ed = new EnvEditor(host, Object.assign({ env: () => st.e, set: (p, ph) => { Object.assign(st.e, p); st.calls.push([ph, Object.assign({}, p)]); }, lock: () => true }, o.opts || {}));
  place(ed.root, 0, 0, 216, 140);
  ed.refresh();
  return { d, ed, st, root: ed.root };
}
// geometry of the default env at 216 × 140 (lock = fit): sustain plateau 32.32 px, 169.68 px for 3.5 s
const EP = 7, SW = 0.16 * 202, PX = (202 - SW) / 3.5, BOT = 140 - 7 - 12, EY = v => EP + (1 - v) * (BOT - EP);
test('EnvEditor: corners drag times and sustain (frozen scale, phases), handles curve, right-click resets', () => {
  const { root, st, ed } = mkEnv();
  assert.equal(root.getAttribute('aria-roledescription'), 'envelope editor');
  const xA = EP + PX, xD = EP + 2.5 * PX;
  at(root, 'pointerdown', xA, EY(1));
  at(root, 'pointermove', xA + PX / 2, EY(1));
  near(st.e.a, 1.5, 1e-9);
  at(root, 'pointermove', xA + PX, EY(1)); // the scale stays frozen during the drag
  near(st.e.a, 2, 1e-9);
  at(root, 'pointerup', xA + PX, EY(1));
  assert.deepEqual(st.calls.map(c => c[0]), ['start', 'move', 'move', 'end']);
  assert.deepEqual(st.calls[0][1], { a: 1 });
  st.e.a = 1; st.calls.length = 0; ed.refresh();
  // decay corner: x = decay time, y = sustain
  at(root, 'pointerdown', xD, EY(0.5));
  at(root, 'pointermove', xD - PX / 4, EY(0.75));
  at(root, 'pointerup', xD - PX / 4, EY(0.75));
  near(st.e.d, 0.75, 1e-9); near(st.e.s, 0.75, 1e-9);
  st.e.d = 1; st.e.s = 0.5; ed.refresh();
  // attack curve handle: up = more convex (ca up); release handle: up = cr down
  const G = ed.geo(ed.size(), ed.env(), ed.scale(ed.size(), ed.env()));
  const [hx, hy] = G.handles[0];
  at(root, 'pointerdown', hx, hy);
  at(root, 'pointermove', hx, hy - 30);
  at(root, 'pointerup', hx, hy - 30);
  near(st.e.ca, 0.7, 1e-9);
  const [rx, ry] = G.handles[2];
  at(root, 'pointerdown', rx, ry);
  at(root, 'pointermove', rx, ry - 15);
  at(root, 'pointerup', rx, ry - 15);
  near(st.e.cr, 0.4, 1e-9);
  const G2 = ed.geo(ed.size(), ed.env(), ed.scale(ed.size(), ed.env()));
  const rc = fire(root, 'contextmenu', { clientX: G2.handles[0][0], clientY: G2.handles[0][1], button: 2 });
  assert.ok(rc.defaultPrevented);
  assert.equal(st.e.ca, 0.5);
  const other = fire(root, 'contextmenu', { clientX: 200, clientY: 10, button: 2 });
  assert.equal(other.defaultPrevented, false); // elsewhere: left to the host
  ed.destroy();
});

test('EnvEditor: stacked zero-length stages, keyboard, ghosts, playhead', () => {
  const { root, st, ed } = mkEnv({ e: { a: 1, h: 0, d: 1 } });
  // hold = 0: A and H corners coincide; dragging right grows ATTACK (Alt: hold), dragging left shortens attack
  const T = 3, px = (202 - SW) / T, xA = EP + px;
  at(root, 'pointerdown', xA, EY(1));
  at(root, 'pointermove', xA + px / 2, EY(1));
  at(root, 'pointerup', xA + px / 2, EY(1));
  near(st.e.a, 1.5, 1e-9);
  assert.equal(st.e.h, 0);
  assert.deepEqual(st.calls.map(c => Object.keys(c[1]).join()), ['a', 'a', 'a']);
  st.e.a = 1; ed.refresh();
  at(root, 'pointerdown', xA, EY(1));
  at(root, 'pointermove', xA + px / 2, EY(1), { altKey: true });
  at(root, 'pointerup', xA + px / 2, EY(1));
  near(st.e.h, 0.5, 1e-9);
  assert.equal(st.e.a, 1);
  st.e.h = 0; ed.refresh();
  at(root, 'pointerdown', xA, EY(1));
  at(root, 'pointermove', xA - px / 2, EY(1));
  at(root, 'pointerup', xA - px / 2, EY(1));
  near(st.e.a, 0.5, 1e-9);
  assert.equal(st.e.h, 0);
  assert.equal(ed.act, 0); // the keyboard continues from the last dragged target
  ed.act = -1;
  root.focus();
  key(root, 'Tab');
  assert.equal(one(root, 'gx-sr').textContent, 'Attack: 500 ms');
  key(root, 'ArrowRight');
  near(st.e.a, 0.55, 1e-9);
  key(root, 'Tab'); key(root, 'Tab'); key(root, 'Tab'); // → Sustain
  key(root, 'ArrowUp');
  near(st.e.s, 0.51, 1e-9);
  assert.equal(st.calls.at(-1)[0], 'set');
  ed.destroy();
  // the default ENV 1 shape (attack 0.5 ms, hold 0, sustain 1): dragging the peak right lengthens the attack, and
  // with decay 0 too (A, H and D stacked) it is still the attack
  for (const e0 of [{ a: 0.000515, h: 0, d: 1, s: 1, r: 0.0147 }, { a: 0.000515, h: 0, d: 0, s: 1, r: 0.0147 }]) {
    const k = mkEnv({ e: e0 });
    const G0 = k.ed.geo(k.ed.size(), k.ed.env(), k.ed.scale(k.ed.size(), k.ed.env()));
    const [cx, cy] = G0.corners[0];
    at(k.root, 'pointerdown', cx, cy);
    for (let i = 1; i <= 3; i++) at(k.root, 'pointermove', cx + 20 * i, cy);
    at(k.root, 'pointerup', cx + 60, cy);
    assert.ok(k.st.e.a > 10 * e0.a, 'attack grew to ' + k.st.e.a); // (the lock-to-fit axis spans 15 ms with d = 0)
    assert.deepEqual([k.st.e.h, k.st.e.d], [0, e0.d]);
    k.ed.destroy();
  }
  // decay 0 with sustain < 1: the D corner is not on the peak, dragging it right grows decay
  const k2 = mkEnv({ e: { a: 1, h: 0, d: 0, s: 0.5 } });
  const G2 = k2.ed.geo(k2.ed.size(), k2.ed.env(), k2.ed.scale(k2.ed.size(), k2.ed.env()));
  at(k2.root, 'pointerdown', G2.corners[2][0], G2.corners[2][1]);
  at(k2.root, 'pointermove', G2.corners[2][0] + 20, G2.corners[2][1]);
  at(k2.root, 'pointerup', G2.corners[2][0] + 20, G2.corners[2][1]);
  assert.ok(k2.st.e.d > 0.1);
  assert.equal(k2.st.e.a, 1);
  k2.ed.destroy();
  raf.install();
  try {
    const g = mkEnv({ opts: { ghosts: () => [{ a: 0.1, h: 0, d: 0.2, s: 0.3, r: 0.4 }], playhead: () => ({ stage: 3, t: 0.5 }) } });
    const ctx = one(g.root, 'gx-ov').getContext('2d');
    assert.ok(ctx.calls.some(c => c[0] === 'arc'));
    raf.flush(1);
    g.ed.destroy();
    raf.flush(1);
    assert.equal(raf.pending, 0);
  } finally { raf.uninstall(); }
});
