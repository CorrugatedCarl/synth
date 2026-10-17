// graph.js (E6) — pure `pts` helpers (§8.6, §2.3 invariants, §10.6 fuzz), factory shapes, the shape library and
// headless CurveEditor / EnvEditor gesture checks on the fake DOM of tests/wk-dom.mjs.
import './v8-guard.mjs';
import test, { mock } from 'node:test';
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

/* ------------------------------------------------- Phase 2 (SPEC-serum2 §11.14, §15.12) */
const { PathEditor, PZEditor, lfoEditorLarge } = G;
const core = await import('../serum-core.js');
const wk = await import('../wk.js?v=10'); // the instance graph.js imports (one set of modifier latches)
const P = pts.path;
function validPath(p, msg = '') {
  assert.ok(Array.isArray(p) && p.length >= 2 && p.length <= MAX_PTS, msg + ' length');
  for (const q of p) {
    assert.equal(q.length, 3, msg + ' shape ' + JSON.stringify(q));
    for (const v of q) assert.ok(typeof v === 'number' && isFinite(v) && !Object.is(v, -0) && r5ok(v), msg + ' number ' + JSON.stringify(q));
    assert.ok(q[0] >= 0 && q[0] <= 1 && q[1] >= 0 && q[1] <= 1 && q[2] >= -1 && q[2] <= 1, msg + ' ranges ' + JSON.stringify(q));
  }
}
// the drawn path (x linear, y bent) sampled per segment
function drawn(p, N = 8) {
  const out = [];
  for (let i = 0; i < p.length - 1; i++) for (let j = 0; j < N; j++) out.push(P.at(p, i, j / N));
  out.push(p[p.length - 1].slice(0, 2));
  return out;
}
const pickItem = (d, name) => { // a context-menu item (the menu arms on a press inside it)
  const it = byCls(d.body, 'wk-ci').find(n => one(n, 'wk-cl') && one(n, 'wk-cl').textContent === name);
  assert.ok(it, 'menu item ' + name);
  fire(it, 'pointerdown');
  fire(it, 'click');
};
function onPath(p, x, y, tol = 2e-4) { return P.nearest(p, x, y).d <= tol || (() => { // fine search
  for (let i = 0; i < p.length - 1; i++) for (let j = 0; j <= 2000; j++) { const q = P.at(p, i, j / 2000); if (Math.hypot(q[0] - x, q[1] - y) <= tol) return true; }
  return false; })(); }

test('§11.14 exports: PathEditor, PZEditor, lfoEditorLarge, pts.path, kind limits, log-frequency axis', () => {
  for (const f of [PathEditor, PZEditor, lfoEditorLarge]) assert.equal(typeof f, 'function');
  for (const f of ['normalize', 'isClosed', 'at', 'handle', 'nearest', 'insert', 'remove', 'move', 'moveMany', 'setCurve', 'setClosed', 'reverse', 'flip']) assert.equal(typeof P[f], 'function', f);
  assert.ok(Object.isFrozen(P) && Object.isFrozen(pts.MAX));
  assert.deepEqual(pts.MAX, { lfo: 480, remap: 480, xshape: 480, curve: 480, mcurve: core.MAX_CRV_PTS, spec: core.MAX_SPEC_PTS, path: 480 });
  assert.equal(pts.hzOfX(0), 20);
  near(pts.hzOfX(1), 20000, 1e-9);
  near(pts.hzOfX(1 / 3), 200, 1e-9);
  near(pts.xOfHz(2000), 2 / 3, 1e-12);
  assert.equal(pts.xOfHz(5), 0);
  assert.equal(pts.xOfHz(1e6), 1);
  assert.equal(PZEditor.mix.length, 3);
});

test('pts limits per kind: normalize / insert / stepDraw honour opts.max; equal to serum-core for matrix and spectral curves', () => {
  const r = mulberry(77);
  const many = Array.from({ length: 150 }, () => [r(), r(), r() * 2 - 1]);
  assert.equal(pts.normalize(many).length, 150);
  assert.equal(pts.normalize(many, { max: 64 }).length, 64);
  valid(pts.normalize(many, { max: 64 }));
  const s = core.defaultSerum();
  s.matrix[0].crv = many; s.matrix[0].src = 'lfo1'; s.matrix[0].dst = 'a.wt'; s.matrix[0].amt = 0.5;
  s.osc[0].spec.filt.pts = many;
  const n = core.normalizeSerum(s);
  assert.deepEqual(pts.normalize(many, { max: core.MAX_CRV_PTS, links: false }), n.matrix[0].crv);
  assert.deepEqual(pts.normalize(many, { max: core.MAX_SPEC_PTS, links: false }), n.osc[0].spec.filt.pts);
  const full = pts.normalize(many, { max: 64 }), o = { map: [], max: 64 };
  assert.equal(pts.insert(full, 0.5, 0.5, o).length, 64);
  assert.equal(o.index, -1);
  const o2 = { map: [] };
  assert.equal(pts.insert(full, 0.5, 0.5, o2).length, 65);
  const flat = pts.normalize(Array.from({ length: 63 }, (_, i) => [i / 62, 0.5, 0]));
  assert.ok(pts.stepDraw(flat, 0.51, 0.51, 1, 128, 'step').length > 64); // a cell between two points adds four
  assert.deepEqual(pts.stepDraw(flat, 0.51, 0.51, 1, 128, 'step', { max: 64 }), flat); // over the limit: unchanged
});

test('pts.path: normalize mirrors serum-core normPath; closed paths; at / handle / nearest', () => {
  const raw = [[0.123456789, 2, -3], [null, 1], [0.5, 0.5], 'x', [1, 1, 0.333333333], [0.2, 0.3, NaN]];
  const s = core.defaultSerum();
  s.lfo[0].path = raw;
  assert.deepEqual(P.normalize(raw), core.normalizeSerum(s).lfo[0].path);
  assert.deepEqual(P.normalize([[0.5, 0.5]]), core.PATH_DEFAULT.map(q => q.slice()));
  assert.deepEqual(P.normalize(null), core.PATH_DEFAULT.map(q => q.slice()));
  assert.equal(P.normalize(Array.from({ length: 600 }, (_, i) => [i / 600, 0.5, 0])).length, 480);
  assert.equal(P.isClosed(core.PATH_DEFAULT), true);
  assert.equal(P.isClosed([[0, 0, 0], [1, 1, 0], [0, 0, 0]]), true);
  assert.equal(P.isClosed([[0, 0, 0], [0, 0, 0]]), false); // two points never close
  assert.equal(P.isClosed([[0, 0, 0], [1, 1, 0], [0, 0.1, 0]]), false);
  const p = [[0, 0, 0.5], [1, 1, 0]];
  assert.deepEqual(P.at(p, 0, 0), [0, 0]);
  assert.deepEqual(P.at(p, 0, 1), [1, 1]);
  near(P.at(p, 0, 0.5)[1], bend(0.5, 5), 1e-12); // y bent, x linear
  assert.equal(P.at(p, 0, 0.5)[0], 0.5);
  assert.deepEqual(P.handle(p, 0), P.at(p, 0, 0.5));
  assert.equal(P.handle([[0.5, 0.5, 0], [0.5, 0.5, 0]], 0), null);
  const nr = P.nearest(p, 0.5, bend(0.5, 5));
  assert.deepEqual([nr.i, nr.t], [0, 0.5]);
  assert.ok(nr.d < 1e-12);
});

test('pts.path: insert (exact split), remove, move, moveMany, setCurve, close / open, reverse, flip', () => {
  const p0 = [[0.1, 0.1, 0.4], [0.9, 0.2, -0.3], [0.5, 0.9, 0]];
  // insert on a segment, on the curve: the drawn path is unchanged
  const o = { map: [], at: 0, t: 0.3, onCurve: true }, q = P.insert(p0, 0, 0, o);
  assert.equal(o.index, 1);
  assert.deepEqual(o.map, [0, 2, 3]);
  validPath(q);
  for (const [x, y] of drawn(q, 16)) assert.ok(onPath(p0, x, y, 3e-4), 'on the old path ' + x + ',' + y);
  // insert near a segment (no `at`): splits that segment; far from it: appended
  const o2 = { map: [] }, q2 = P.insert(p0, 0.5, 0.15, o2);
  assert.equal(o2.index, 1);
  const o3 = { map: [] }, q3 = P.insert(p0, 0.05, 0.95, o3);
  assert.equal(o3.index, 3);
  assert.deepEqual(q3[3], [0.05, 0.95, 0]);
  const closed = P.normalize(core.PATH_DEFAULT);
  const o4 = { map: [], append: true }, q4 = P.insert(closed, 0.9, 0.9, o4);
  assert.equal(o4.index, 4); // before the closing copy
  assert.ok(P.isClosed(q4));
  assert.deepEqual(q4.at(-1).slice(0, 2), q4[0].slice(0, 2));
  const fullP = Array.from({ length: 480 }, (_, i) => [i / 479, 0.5, 0]), o5 = { map: [] };
  assert.equal(P.insert(fullP, 0.5, 0.5, o5).length, 480);
  assert.equal(o5.index, -1);
  // remove: the closing copy stands for the first point; at least two distinct points stay
  const m = [], r1 = P.remove(closed, [0], { map: m });
  assert.equal(r1.length, 4);
  assert.ok(P.isClosed(r1));
  assert.deepEqual(r1[0], closed[1]);
  assert.deepEqual(m, [-1, 0, 1, 2, -1]);
  assert.deepEqual(P.remove(closed, [4]), r1);
  assert.deepEqual(P.remove(p0, [0, 1]), P.normalize(p0)); // would leave one point: ignored
  assert.deepEqual(P.remove(p0, [1]), [[0.1, 0.1, 0.4], [0.5, 0.9, 0]]);
  // move: free in 2-D, clamped; the closing copy follows the first point
  const mv = P.move(closed, 0, 0.7, 1.4);
  assert.deepEqual([mv[0].slice(0, 2), mv[4].slice(0, 2)], [[0.7, 1], [0.7, 1]]);
  const mv2 = P.move(closed, 4, 0.2, 0.3);
  assert.deepEqual([mv2[0].slice(0, 2), mv2[4].slice(0, 2)], [[0.2, 0.3], [0.2, 0.3]]);
  assert.deepEqual(P.move(p0, 1, 0.42, 0.58, { snap: true, grid: { x: 4, y: 4 } })[1].slice(0, 2), [0.5, 0.5]);
  // moveMany: rigid, clamped so every point stays inside
  const mm = P.moveMany(p0, [0, 1], 0.5, -0.5);
  near(mm[1][0], 1, 1e-12); near(mm[0][0], 0.2, 1e-12); // dx clamped to 0.1 by the point at 0.9
  near(mm[0][1], 0, 1e-12); near(mm[1][1], 0.1, 1e-12); // dy clamped to −0.1
  assert.deepEqual(mm[2], [0.5, 0.9, 0]);
  const mc = P.moveMany(closed, [0], 0.1, 0);
  assert.deepEqual(mc[0].slice(0, 2), mc[4].slice(0, 2));
  assert.equal(P.setCurve(p0, 1, 2)[1][2], 1);
  assert.equal(P.setCurve(p0, 2, 0.5)[2][2], 0); // the last point has no segment
  // close / open
  const cl = P.setClosed(p0, true);
  assert.ok(P.isClosed(cl));
  assert.equal(cl.length, 4);
  assert.equal(cl[2][2], 0); // the new closing segment is straight
  assert.deepEqual(P.setClosed(cl, false), P.normalize(p0).map((q, i) => (i === 2 ? [q[0], q[1], 0] : q)));
  assert.deepEqual(P.setClosed(closed, true), closed);
  assert.deepEqual(P.setClosed(fullP, true), P.normalize(fullP)); // full: stays open
  // reverse: same drawing, reversed order; flips mirror
  const rv = P.reverse(p0);
  assert.deepEqual(rv.map(q => q.slice(0, 2)), P.normalize(p0).reverse().map(q => q.slice(0, 2)));
  for (const [x, y] of drawn(rv, 16)) assert.ok(onPath(p0, x, y, 3e-4), 'reversed on the path');
  assert.deepEqual(P.reverse(P.reverse(p0)), P.normalize(p0));
  assert.deepEqual(P.flip(p0, 'h').map(q => q[0]), [0.9, 0.1, 0.5]);
  assert.deepEqual(P.flip(p0, 'v').map(q => q[1]), [0.9, 0.8, 0.1]);
  // inputs are never mutated
  assert.deepEqual(p0, [[0.1, 0.1, 0.4], [0.9, 0.2, -0.3], [0.5, 0.9, 0]]);
});

test('pts.path fuzz: 1500 random operations keep paths valid; closed paths stay closed', () => {
  const r = mulberry(4242);
  let p = P.normalize(core.PATH_DEFAULT);
  for (let k = 0; k < 1500; k++) {
    const n = p.length, i = Math.floor(r() * n), wasClosed = P.isClosed(p), op = Math.floor(r() * 9);
    switch (op) {
      case 0: p = P.insert(p, r(), r(), { map: [], onCurve: r() < 0.5 }); break;
      case 1: p = P.insert(p, r(), r(), { map: [], at: Math.floor(r() * (n - 1)), t: r() }); break;
      case 2: p = P.remove(p, [i, Math.floor(r() * n)]); break;
      case 3: p = P.move(p, i, r() * 1.4 - 0.2, r() * 1.4 - 0.2); break;
      case 4: p = P.moveMany(p, [i, Math.floor(r() * n)], r() - 0.5, r() - 0.5); break;
      case 5: p = P.setCurve(p, i, r() * 3 - 1.5); break;
      case 6: p = P.reverse(p); break;
      case 7: p = P.flip(p, r() < 0.5 ? 'h' : 'v'); break;
      default: p = P.setClosed(p, r() < 0.5);
    }
    validPath(p, 'op ' + op + ' #' + k);
    if (op !== 8) assert.equal(P.isClosed(p), wasClosed, 'closure kept by op ' + op + ' #' + k); // open stays open too
    assert.deepEqual(P.normalize(p), p, 'idempotent');
  }
});

/* ------------------------------------------------------------------ PathEditor */
function mkPath(o = {}) {
  const d = fresh();
  setPlatform('MacIntel');
  const st = { p: (o.p || core.PATH_DEFAULT).map(q => q.slice()), calls: [], grid: o.grid || { x: 0, y: 0 } };
  const host = d.createElement('div');
  d.body.appendChild(host);
  const ed = new PathEditor(host, Object.assign({ get: () => st.p, set: (p, ph) => { st.p = p; st.calls.push([ph, p]); }, grid: () => st.grid }, o.opts || {}));
  place(ed.root, 0, 0, W, H);
  ed.refresh();
  return { d, ed, st, root: ed.root };
}

test('PathEditor: DOM, drag a point (closing copy follows), Alt snap, curvature handle, marquee group move', () => {
  const { root, st, ed } = mkPath({ grid: { x: 4, y: 4 } });
  assert.ok(root.classList.contains('gx-root') && root.classList.contains('gx-path'));
  assert.equal(root.getAttribute('aria-roledescription'), 'path editor');
  assert.equal(root.getAttribute('aria-label'), 'LFO path');
  assert.ok(one(root, 'gx-cv').getContext('2d').calls.some(c => c[0] === 'arc'));
  // the first point (top) of the default diamond: its closing copy moves with it
  at(root, 'pointerdown', X(0.5), Y(1));
  at(root, 'pointermove', X(0.4), Y(0.8));
  assert.deepEqual(st.calls.map(c => c[0]), ['start', 'move']);
  near(st.p[0][0], 0.4, 1e-5); near(st.p[0][1], 0.8, 1e-5);
  assert.deepEqual(st.p[4].slice(0, 2), st.p[0].slice(0, 2));
  at(root, 'pointermove', X(0.26), Y(0.77), { altKey: true });
  assert.deepEqual(st.p[0].slice(0, 2), [0.25, 0.75]);
  at(root, 'pointerup', X(0.26), Y(0.77));
  assert.equal(st.calls.at(-1)[0], 'end');
  assert.ok(P.isClosed(st.p));
  // a curvature handle (segment 1: right → bottom, falling): dragging up = negative curvature
  const h1 = P.handle(st.p, 1);
  at(root, 'pointerdown', X(h1[0]), Y(h1[1]));
  at(root, 'pointermove', X(h1[0]), Y(h1[1]) - 30);
  at(root, 'pointerup', X(h1[0]), Y(h1[1]) - 30);
  near(st.p[1][2], -0.3, 1e-9);
  // marquee selects the lower half; arrows move the group rigidly
  at(root, 'pointerdown', 1, Y(0.6));
  at(root, 'pointermove', W - 1, H - 1);
  at(root, 'pointerup', W - 1, H - 1);
  root.focus();
  ed.act = 1;
  key(root, 'ArrowUp');
  near(st.p[1][1], 0.75, 1e-9); near(st.p[2][1], 0.25, 1e-9); near(st.p[3][1], 0.75, 1e-9);
  near(st.p[0][1], 0.75, 1e-9); // not selected
  ed.destroy();
  assert.equal(root.parentNode, null);
});

test('PathEditor: double-click inserts on the curve / appends / removes; keys; context menu close / open, reverse, init', () => {
  const { root, st, ed, d } = mkPath({ p: [[0.1, 0.1, 0], [0.9, 0.1, 0]] });
  // on the segment: inserted there (on the curve)
  fire(root, 'dblclick', { clientX: X(0.3), clientY: Y(0.1) + 2 });
  assert.equal(st.p.length, 3);
  near(st.p[1][0], 0.3, 0.02); assert.equal(st.p[1][1], 0.1);
  // on the segment's handle: resets its curvature (as the curve editors)
  st.p = P.setCurve(st.p, 0, 0.5); ed.refresh();
  const h0 = P.handle(st.p, 0);
  fire(root, 'dblclick', { clientX: X(h0[0]), clientY: Y(h0[1]) });
  assert.equal(st.p[0][2], 0);
  assert.equal(st.p.length, 3);
  // elsewhere: appended (open path)
  fire(root, 'dblclick', { clientX: X(0.5), clientY: Y(0.9) });
  assert.equal(st.p.length, 4);
  near(st.p[3][1], 0.9, 1e-3);
  // on a point: removed
  fire(root, 'dblclick', { clientX: X(st.p[3][0]), clientY: Y(st.p[3][1]) });
  assert.equal(st.p.length, 3);
  // context menu: Close Path, then the menu offers Open Path
  fire(root, 'contextmenu', { clientX: 5, clientY: 5, button: 2 });
  let labels = byCls(d.body, 'wk-ci').map(e => e.textContent.replace(/^✓/, ''));
  assert.deepEqual(labels.slice(0, 3), ['Close Path', 'Reverse Direction', 'Delete Selected']);
  pickItem(d, 'Close Path');
  assert.ok(P.isClosed(st.p));
  assert.equal(st.p.length, 4);
  fire(root, 'contextmenu', { clientX: 5, clientY: 5, button: 2 });
  labels = byCls(d.body, 'wk-ci').map(e => e.textContent);
  assert.match(labels[0], /Open Path/);
  const before = st.p.map(q => q.slice(0, 2));
  pickItem(d, 'Reverse Direction');
  assert.deepEqual(st.p.map(q => q.slice(0, 2)), before.reverse());
  // keys: Tab cycles distinct points (3, closing copy excluded), + inserts after the active point, Delete removes
  root.focus();
  ed.act = -1;
  key(root, 'Tab'); key(root, 'Tab'); key(root, 'Tab');
  assert.match(one(root, 'gx-sr').textContent, /^Point 3 of 3: .*closed path$/);
  assert.equal(key(root, 'Tab').defaultPrevented, false); // leaves the editor
  key(root, 'Home');
  key(root, '+');
  assert.equal(st.p.length, 5);
  assert.equal(ed.act, 1);
  key(root, 'Delete');
  assert.equal(st.p.length, 4);
  key(root, 'ArrowRight', { shiftKey: true });
  // Init Path
  fire(root, 'contextmenu', { clientX: 5, clientY: 5, button: 2 });
  pickItem(d, 'Init Path');
  assert.deepEqual(st.p, core.PATH_DEFAULT.map(q => q.slice()));
  // a path keeps two points
  const k = mkPath({ p: [[0.1, 0.1, 0], [0.9, 0.9, 0]] });
  fire(k.root, 'dblclick', { clientX: X(0.1), clientY: Y(0.1) });
  assert.equal(k.st.p.length, 2);
  assert.match(one(k.root, 'gx-sr').textContent, /at least two/);
  // readOnly: nothing edits
  const ro = mkPath({ opts: { readOnly: true } });
  fire(ro.root, 'dblclick', { clientX: X(0.7), clientY: Y(0.7) });
  at(ro.root, 'pointerdown', X(0.5), Y(1)); at(ro.root, 'pointermove', X(0.2), Y(0.2)); at(ro.root, 'pointerup', X(0.2), Y(0.2));
  assert.deepEqual(ro.st.calls, []);
});

test('PathEditor: playhead dot, Shift latch toggles selection, touch double-tap', () => {
  raf.install();
  try {
    let ph = [0.25, 0.75];
    const { root, ed, st, d } = mkPath({ opts: { playhead: () => ph } });
    const ctx = one(root, 'gx-ov').getContext('2d');
    assert.ok(ctx.calls.some(c => c[0] === 'arc'));
    ctx.calls.length = 0;
    raf.flush(1);
    assert.equal(ctx.calls.length, 0); // unchanged: no redraw
    ph = [0.5, 0.5];
    raf.flush(1);
    assert.ok(ctx.calls.some(c => c[0] === 'arc'));
    // the Shift latch: a press on a point toggles it into the selection without dragging
    const bar = wk.modifierBar();
    d.body.appendChild(bar.el);
    all(bar.el).find(e => e.getAttribute && e.getAttribute('data-mod') === 'shift').click();
    at(root, 'pointerdown', X(1), Y(0.5));
    assert.ok(ed.sel.has(1));
    assert.equal(bar.state().shift, 0); // consumed
    // touch double-tap on the background appends a point
    for (let i = 0; i < 2; i++) { at(root, 'pointerdown', X(0.8), Y(0.9), { pointerType: 'touch' }); at(root, 'pointerup', X(0.8), Y(0.9), { pointerType: 'touch' }); }
    assert.equal(st.p.length, 6);
    bar.destroy();
    ed.destroy();
    raf.flush(1);
    assert.equal(raf.pending, 0);
  } finally { raf.uninstall(); }
});

/* ------------------------------------------------------------------ PZEditor */
test('PZEditor.mix: the bilinear corner blend (§6.13.4)', () => {
  const pz = core.PZ_DEFAULT;
  assert.deepEqual(PZEditor.mix(pz, 0, 0), [1, 0, 0]); // TL: LP
  assert.deepEqual(PZEditor.mix(pz, 1, 0), [0, 1, 0]); // TR: BP
  assert.deepEqual(PZEditor.mix(pz, 0, 1), [0, 0, 1]); // BL: HP
  assert.deepEqual(PZEditor.mix(pz, 1, 1), [1, 0, 1]); // BR: notch
  assert.deepEqual(PZEditor.mix(pz, 0.5, 0.5), [0.5, 0.25, 0.5]);
  const r = mulberry(9);
  for (let k = 0; k < 50; k++) {
    const q = Array.from({ length: 4 }, () => [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1].map(v => Math.round(v * 1e5) / 1e5)), x = r(), y = r();
    const m = PZEditor.mix(q, x, y);
    for (let j = 0; j < 3; j++) near(m[j], q[0][j] * (1 - x) * (1 - y) + q[1][j] * x * (1 - y) + q[2][j] * (1 - x) * y + q[3][j] * x * y, 1e-12);
  }
  assert.deepEqual(PZEditor.mix(null, 0, 0), [1, 0, 0]); // invalid data: the default corners
});

test('PZEditor: 4 corners × LP/BP/HP sliders edit pz, the X/Y pad (Y down), reset, readOnly', () => {
  const d = fresh();
  const st = { pz: core.PZ_DEFAULT.map(c => c.slice()), x: 0, y: 0, calls: [] };
  const host = d.createElement('div');
  d.body.appendChild(host);
  const ed = new PZEditor(host, {
    get: () => st.pz, set: (pz, ph) => { st.pz = pz; st.calls.push(ph); },
    x: { dest: 'f.x', get: () => st.x, set: n => { st.x = n; }, def: 0 }, y: { dest: 'f.y', get: () => st.y, set: n => { st.y = n; }, def: 0 },
  });
  assert.equal(ed.root.getAttribute('aria-label'), 'PZ SVF');
  const corners = byCls(ed.root, 'gx-pzc');
  assert.deepEqual(corners.map(c => c.getAttribute('aria-label')), ['Corner TL', 'Corner TR', 'Corner BL', 'Corner BR']);
  const sl = byCls(ed.root, 'wk-sl');
  assert.equal(sl.length, 12);
  assert.deepEqual(byCls(corners[0], 'wk-num').map(e => e.textContent), ['1.00', '0.00', '0.00']);
  // drag TR's HP gain up from 0 to +0.5 (a 100 px track: jump to 0.75 → +0.5)
  const trHp = byCls(corners[1], 'wk-sl')[2];
  place(one(trHp, 'wk-slt'), 0, 0, 12, 100);
  ptr(trHp, 'pointerdown', 6, 25);
  ptr(trHp, 'pointerup', 6, 25);
  assert.equal(st.pz[1][2], 0.5);
  assert.deepEqual(st.pz[0], [1, 0, 0]);
  assert.deepEqual(st.calls, ['start', 'move', 'end']);
  // typed entry in gain units; Delete resets to PZ_DEFAULT
  trHp.focus();
  key(trHp, 'Enter');
  one(trHp, 'wk-in').value = '-0.25';
  key(one(trHp, 'wk-in'), 'Enter');
  assert.equal(st.pz[1][2], -0.25);
  key(trHp, 'Delete');
  assert.equal(st.pz[1][2], 0);
  // the X/Y pad: data-dest rails, Y = 0 at the top
  const pad = one(ed.root, 'gx-pzxy');
  assert.equal(one(pad, 'wk-xyrx').getAttribute('data-dest'), 'f.x');
  place(one(pad, 'wk-xyp'), 0, 0, 100, 100);
  ptr(one(pad, 'wk-xyp'), 'pointerdown', 80, 20);
  ptr(one(pad, 'wk-xyp'), 'pointerup', 80, 20);
  near(st.x, 0.8); near(st.y, 0.2);
  ed.refresh();
  ed.destroy();
  assert.equal(ed.root.parentNode, null);
  // readOnly; without x / y no pad
  const ro = new PZEditor(host, { readOnly: true, get: () => st.pz, set: () => assert.fail('set') });
  assert.equal(one(ro.root, 'gx-pzxy'), null);
  const s0 = byCls(ro.root, 'wk-sl')[0];
  key(s0, 'ArrowUp');
  ro.setGain(0, 0, 0.3, 'set');
  ro.destroy();
});

/* ------------------------------------------------------------------ CurveEditor kinds and tools */
test('CurveEditor mcurve: RISE / FALL fields, the link toggle keeps RISE = FALL, Init, 64-point limit', () => {
  const d = fresh();
  const st = { crv: null, row: { rise: 0.2, fall: 0.5, slink: 0 }, patches: [] };
  const host = d.createElement('div');
  d.body.appendChild(host);
  const ed = new CurveEditor(host, {
    kind: 'mcurve', get: () => st.crv, set: p => { st.crv = p; },
    slew: { get: () => st.row, set: (patch, ph) => { Object.assign(st.row, patch); st.patches.push([ph, Object.assign({}, patch)]); } },
  });
  place(ed.root, 0, 0, W, H);
  ed.refresh();
  assert.equal(ed.root.getAttribute('aria-label'), 'Matrix curve');
  const bar = one(host, 'gx-bar');
  assert.ok(bar && bar.classList.contains('gx-bar-mcurve'));
  assert.equal(bar.parentNode, host);
  const [rise, fall] = byCls(bar, 'wk-nb'), link = one(bar, 'wk-tog');
  assert.deepEqual([one(rise, 'wk-lab').textContent, one(fall, 'wk-lab').textContent], ['RISE', 'FALL']);
  assert.equal(one(rise, 'wk-nbt').textContent, core.fmtTime(core.SLEW_T(0.2)));
  // unlinked: RISE alone
  rise.focus();
  key(rise, 'ArrowUp');
  assert.deepEqual(st.patches.at(-1), ['set', { rise: 0.201 }]);
  assert.equal(st.row.fall, 0.5);
  // the link toggle copies RISE to FALL; then either field writes both
  link.click();
  assert.deepEqual(st.patches.at(-1), ['set', { slink: 1, fall: 0.201 }]);
  assert.equal(link.getAttribute('aria-pressed'), 'true');
  key(fall, 'ArrowDown');
  assert.deepEqual(st.patches.at(-1), ['set', { rise: 0.2, fall: 0.2 }]);
  place(rise, 0, 0, 40, 40);
  ptr(rise, 'pointerdown', 20, 20);
  ptr(rise, 'pointermove', 20, 12);
  ptr(rise, 'pointerup', 20, 12);
  assert.equal(st.row.rise, st.row.fall);
  assert.deepEqual(st.patches.slice(-3).map(p => p[0]), ['start', 'move', 'end']);
  assert.ok(st.patches.slice(-3).every(([, p]) => p.rise === p.fall));
  link.click();
  assert.deepEqual(st.patches.at(-1), ['set', { slink: 0 }]);
  key(fall, 'ArrowUp');
  assert.ok(!('rise' in st.patches.at(-1)[1]));
  // a null curve shows the identity; double-click adds points; Init returns to the diagonal (or calls o.init)
  fire(ed.root, 'dblclick', { clientX: X(0.5), clientY: Y(0.8) });
  assert.equal(st.crv.length, 3);
  one(host, 'gx-btn').click();
  assert.deepEqual(st.crv, [[0, 0, 0], [1, 1, 0]]);
  st.crv = pts.normalize(Array.from({ length: 64 }, (_, i) => [i / 63, 0.5, 0]));
  ed.refresh();
  fire(ed.root, 'dblclick', { clientX: X(0.505), clientY: Y(0.9) });
  assert.equal(st.crv.length, 64);
  assert.equal(one(ed.root, 'gx-sr').textContent, 'Point limit reached');
  let inited = 0;
  const ed2 = new CurveEditor(host, { kind: 'mcurve', get: () => null, set() {}, init: () => inited++ });
  byCls(host, 'gx-btn').at(-1).click();
  assert.equal(inited, 1);
  assert.ok(byCls(ed2.bar, 'wk-nb').every(n => n.classList.contains('wk-dis'))); // no slew binding
  ed.destroy(); ed2.destroy();
  assert.equal(byCls(host, 'gx-bar').length, 0);
});

test('CurveEditor spec: log-frequency axis, GRID field (snap grid), presets menu, 128-point limit', () => {
  const d = fresh();
  const st = { p: [[0, 1, 0], [1, 1, 0]], grid: 8, gridCalls: [] };
  const host = d.createElement('div');
  d.body.appendChild(host);
  let presetsAsked = 0;
  const ed = new CurveEditor(host, {
    kind: 'spec', get: () => st.p, set: p => { st.p = p; },
    gridField: { get: () => st.grid, set: (g, ph) => { st.grid = g; st.gridCalls.push([ph, g]); } },
    presets: () => { presetsAsked++; return [{ label: 'Factory', sub: [{ label: 'Comb', action() {} }] }, { label: 'Default', action: () => { st.p = [[0, 1, 0], [1, 1, 0]]; } }]; },
  });
  place(ed.root, 0, 0, W, H);
  ed.refresh();
  assert.equal(ed.root.getAttribute('aria-label'), 'Spectral filter');
  assert.deepEqual(ed.grid(), { x: 8, y: 8 });
  const calls = one(ed.root, 'gx-cv').getContext('2d').calls;
  calls.length = 0;
  ed.draw();
  assert.deepEqual(calls.filter(c => c[0] === 'fillText').map(c => c[1]), ['100', '1k', '10k']);
  // GRID field: 0–64
  const gridBox = one(ed.bar, 'wk-nb');
  assert.equal(one(gridBox, 'wk-nbt').textContent, '8');
  gridBox.focus();
  key(gridBox, 'ArrowUp');
  assert.equal(st.grid, 9);
  assert.deepEqual(ed.grid(), { x: 9, y: 9 });
  // double-click snaps to the GRID
  st.grid = 4; ed.refresh();
  fire(ed.root, 'dblclick', { clientX: X(0.3), clientY: Y(0.6) });
  assert.deepEqual(st.p[1].slice(0, 2), [0.25, 0.5]);
  // presets menu
  one(ed.bar, 'gx-btn').click();
  assert.equal(presetsAsked, 1);
  const items = byCls(d.body, 'wk-ci');
  assert.deepEqual(items.map(e => e.textContent.replace(/[✓▸]/g, '')), ['Factory', 'Default']);
  pickItem(d, 'Default');
  assert.deepEqual(st.p, [[0, 1, 0], [1, 1, 0]]);
  // the 128-point limit
  st.p = pts.normalize(Array.from({ length: 128 }, (_, i) => [i / 127, 0.5, 0]));
  ed.refresh();
  fire(ed.root, 'dblclick', { clientX: X(0.502), clientY: Y(0.9) });
  assert.equal(st.p.length, 128);
  ed.destroy();
});

test('CurveEditor tools (Point / Flat / Ramp Up / Ramp Down): a background press draws the tool shape per grid cell', () => {
  let tool = 'rampUp';
  const { root, st, ed } = mkCurve({ p: [[0, 0.5, 0], [1, 0.5, 0]], grid: { x: 4, y: 4 }, opts: { kind: 'curve', tool: () => tool } });
  at(root, 'pointerdown', X(0.3), Y(1));
  at(root, 'pointerup', X(0.3), Y(1));
  near(evalPts(st.p, 0.25), 0, 1e-9); near(evalPts(st.p, 0.4999), 1, 1e-3); near(evalPts(st.p, 0.75), 0.5, 1e-9);
  tool = 'flat';
  at(root, 'pointerdown', X(0.8), Y(0.25));
  at(root, 'pointerup', X(0.8), Y(0.25));
  near(evalPts(st.p, 0.8), 0.25, 1e-9);
  // a point still drags with a tool selected; 'point' = marquee on the background
  tool = 'point';
  const n = st.p.length;
  at(root, 'pointerdown', X(0.6), Y(0.05));
  at(root, 'pointermove', X(0.9), Y(0.02));
  at(root, 'pointerup', X(0.9), Y(0.02));
  assert.equal(st.p.length, n);
  // setTool for editors without the option
  const k = mkCurve({ p: [[0, 0.5, 0], [1, 0.5, 0]], grid: { x: 2, y: 2 }, opts: { kind: 'curve' } });
  assert.equal(k.ed.tool(), 'point');
  k.ed.setTool('rampDown');
  at(k.root, 'pointerdown', X(0.1), Y(1));
  at(k.root, 'pointerup', X(0.1), Y(1));
  near(evalPts(k.st.p, 0), 1, 1e-9); near(evalPts(k.st.p, 0.49), 0.02, 1e-9);
  k.ed.setTool('bogus');
  assert.equal(k.ed.tool(), 'point');
  ed.destroy(); k.ed.destroy();
});

/* ------------------------------------------------------------------ EnvEditor (Phase 2) */
test('EnvEditor: Start / End levels (ENV 2–4) — handles, drawing, End vs release corner, keys, readout', () => {
  const { root, st, ed } = mkEnv({ e: { st: 0.25, en: 0 }, opts: { startEnd: true } });
  const geo = () => ed.geo(ed.size(), ed.env(), ed.scale(ed.size(), ed.env()));
  let G = geo();
  assert.deepEqual(G.se[0], [EP, EY(0.25)]);
  // the curve starts at the Start level
  const calls = one(root, 'gx-cv').getContext('2d').calls;
  assert.ok(calls.some(c => c[0] === 'moveTo' && Math.abs(c[1] - EP) < 1e-9 && Math.abs(c[2] - EY(0.25)) < 1e-9));
  assert.ok(calls.some(c => c[0] === 'fillRect' && Math.abs(c[1] - (EP - 3.5)) < 1e-9)); // the Start handle
  at(root, 'pointerdown', G.se[0][0], G.se[0][1]);
  at(root, 'pointermove', G.se[0][0], G.se[0][1] - (BOT - EP) / 4);
  at(root, 'pointerup', G.se[0][0], G.se[0][1] - (BOT - EP) / 4);
  near(st.e.st, 0.5, 1e-9);
  assert.deepEqual(st.calls.map(c => c[0]), ['start', 'move', 'end']);
  assert.deepEqual(st.calls[0][1], { st: 0.25 });
  // End sits on the release corner: a vertical first move takes the End level, a horizontal one the release time
  G = geo();
  const [rx, ry] = G.corners[4];
  at(root, 'pointerdown', rx, ry);
  at(root, 'pointermove', rx, ry - (BOT - EP) / 2);
  at(root, 'pointerup', rx, ry - (BOT - EP) / 2);
  near(st.e.en, 0.5, 1e-9);
  assert.equal(st.e.r, 1);
  st.e.en = 0; ed.refresh();
  at(root, 'pointerdown', rx, ry);
  at(root, 'pointermove', rx - PX / 2, ry);
  at(root, 'pointerup', rx - PX / 2, ry);
  near(st.e.r, 0.5, 1e-9);
  assert.equal(st.e.en, 0);
  // keyboard: Tab reaches 8 and 9; arrows move the level; the readout is in dB
  root.focus();
  ed.act = -1;
  for (let i = 0; i < 9; i++) key(root, 'Tab');
  assert.equal(ed.act, 8);
  key(root, 'ArrowUp');
  near(st.e.st, 0.51, 1e-9);
  assert.equal(one(root, 'gx-sr').textContent, 'Start level: ' + (20 * Math.log10(0.51)).toFixed(1) + ' dB');
  key(root, 'Tab');
  assert.equal(ed.act, 9);
  key(root, 'ArrowDown');
  assert.equal(st.e.en, 0);
  assert.equal(one(root, 'gx-sr').textContent, 'End level: -inf dB');
  assert.equal(key(root, 'Tab').defaultPrevented, false);
  // right-click on a level handle resets it
  G = geo();
  fire(root, 'contextmenu', { clientX: G.se[0][0], clientY: G.se[0][1], button: 2 });
  assert.equal(st.e.st, 0);
  ed.destroy();
  // without startEnd: no level targets (Tab stops at 7), ENV 1 unchanged
  const k = mkEnv({ e: { st: 0.5 } });
  k.root.focus();
  for (let i = 0; i < 8; i++) key(k.root, 'Tab');
  assert.equal(k.ed.act, 7);
  assert.equal(key(k.root, 'Tab').defaultPrevented, false);
  const fmt = mkEnv({ e: { st: 0.5 }, opts: { startEnd: () => true, fmtLevel: n => 'L' + n } });
  fmt.root.focus();
  for (let i = 0; i < 9; i++) key(fmt.root, 'Tab');
  assert.equal(one(fmt.root, 'gx-sr').textContent, 'Start level: L0.5');
});

test('EnvEditor: beat grid (lines + snapping within 6 px) and BPM-unit time steps', () => {
  // 120 BPM: 0.5 s per beat; at ~48.5 px/s the first beat step ≥ 48 px is 2 beats (1 s)
  const { root, st, ed } = mkEnv({ opts: { grid: () => ({ beats: 1, spb: 0.5 }) } });
  const sc = ed.scale(ed.size(), ed.env());
  assert.deepEqual(ed.beatGrid(sc), { beats: 2, sec: 1 });
  const texts = one(root, 'gx-cv').getContext('2d').calls.filter(c => c[0] === 'fillText').map(c => c[1]);
  assert.ok(texts.includes('2') && !texts.some(t => / s$| ms$/.test(t)));
  const xA = EP + PX;
  at(root, 'pointerdown', xA, EY(1));
  at(root, 'pointermove', xA + PX * 0.95, EY(1)); // 1.95 s, within 6 px of the 2 s line: snaps
  near(st.e.a, 2, 1e-9);
  at(root, 'pointermove', xA + PX * 0.5, EY(1)); // 1.5 s: free
  near(st.e.a, 1.5, 1e-9);
  at(root, 'pointerup', xA + PX * 0.5, EY(1));
  ed.destroy();
  // BPM units: times restricted to the ladder entries
  const steps = [0, 0.125, 0.25, 0.5, 1, 2, 4];
  const k = mkEnv({ opts: { steps: () => steps } });
  const xA2 = EP + PX;
  at(k.root, 'pointerdown', xA2, EY(1));
  at(k.root, 'pointermove', xA2 + PX * 0.4, EY(1)); // 1.4 s → 1
  assert.equal(k.st.e.a, 1);
  at(k.root, 'pointermove', xA2 + PX * 0.6, EY(1)); // 1.6 s → 2
  assert.equal(k.st.e.a, 2);
  at(k.root, 'pointerup', xA2 + PX * 0.6, EY(1));
  k.root.focus();
  k.ed.act = -1;
  key(k.root, 'Tab'); // attack
  key(k.root, 'ArrowRight');
  assert.equal(k.st.e.a, 4);
  key(k.root, 'ArrowRight');
  assert.equal(k.st.e.a, 4);
  key(k.root, 'ArrowLeft'); key(k.root, 'ArrowLeft');
  assert.equal(k.st.e.a, 1);
  // without grid / steps nothing snaps (Phase 1)
  const p1 = mkEnv();
  at(p1.root, 'pointerdown', xA, EY(1));
  at(p1.root, 'pointermove', xA + PX * 0.95, EY(1));
  near(p1.st.e.a, 1.95, 1e-9);
  at(p1.root, 'pointerup', xA + PX * 0.95, EY(1));
});

/* ------------------------------------------------------------------ lfoEditorLarge */
test('lfoEditorLarge: dialog, tool seg drives the editor, Escape / ✕ close with onClose, focus return, Path type', () => {
  const d = fresh();
  setPlatform('MacIntel');
  const opener = d.createElement('button');
  d.body.appendChild(opener);
  opener.focus();
  const st = { p: [[0, 0.5, 0], [1, 0.5, 0]], tool: 'point' };
  let closed = 0;
  const ov = lfoEditorLarge(d.body, { title: 'LFO 3', get: () => st.p, set: p => { st.p = p; }, grid: () => ({ x: 4, y: 4 }), tool: { get: () => st.tool, set: t => { st.tool = t; } }, onClose: () => closed++, height: 300 });
  assert.equal(ov.el.getAttribute('role'), 'dialog');
  assert.equal(ov.el.getAttribute('aria-modal'), 'true');
  assert.equal(ov.el.getAttribute('aria-label'), 'LFO 3');
  assert.ok(ov.editor instanceof CurveEditor);
  assert.equal(ov.editor.kind, 'lfo');
  assert.equal(ov.editor.root.style.height, '300px');
  assert.equal(d.activeElement, ov.editor.root);
  const seg = one(ov.el, 'gx-tools');
  assert.deepEqual(byCls(seg, 'wk-sb').map(b => b.textContent), ['Point', 'Flat', 'Ramp Up', 'Ramp Down']);
  byCls(seg, 'wk-sb')[3].click();
  assert.equal(st.tool, 'rampDown');
  assert.equal(ov.editor.tool(), 'rampDown');
  place(ov.editor.root, 0, 0, W, H);
  at(ov.editor.root, 'pointerdown', X(0.1), Y(1));
  at(ov.editor.root, 'pointerup', X(0.1), Y(1));
  near(evalPts(st.p, 0), 1, 1e-9);
  ov.setTool('flat');
  assert.equal(st.tool, 'flat');
  assert.equal(byCls(seg, 'wk-sb')[1].getAttribute('aria-checked'), 'true');
  // Escape inside the editor with a selection clears it first; then closes
  ov.editor.sel.add(1);
  key(ov.editor.root, 'Escape');
  assert.equal(closed, 0);
  key(ov.editor.root, 'Escape');
  assert.equal(closed, 1);
  assert.equal(ov.el.parentNode, null);
  assert.equal(d.activeElement, opener);
  ov.close();
  assert.equal(closed, 1);
  // ✕ closes; a Path-type LFO gets the PathEditor (no tools); destroy() skips onClose
  const ov2 = lfoEditorLarge(null, { path: true, get: () => core.PATH_DEFAULT, set() {}, onClose: () => closed++ });
  assert.ok(ov2.editor instanceof PathEditor);
  assert.equal(one(ov2.el, 'gx-tools'), null);
  one(ov2.el, 'gx-ovx').click();
  assert.equal(closed, 2);
  const ov3 = lfoEditorLarge(d.body, { get: () => st.p, set() {}, onClose: () => closed++ });
  ov3.setTool('rampUp');
  assert.equal(ov3.editor.tool(), 'rampUp'); // local tool state
  ov3.destroy();
  assert.equal(closed, 2);
});

/* ------------------------------------------------------------------ M2: touch-first editors (§13.1) */

test('touch hit radii: 22 px for points and curve handles (44 px targets); the mouse keeps 8 / 6 px', () => {
  const { root, st } = mkCurve();
  at(root, 'pointerdown', X(0.5) + 20, Y(1), { pointerType: 'mouse' });
  at(root, 'pointermove', X(0.5) + 20, Y(0.5), { pointerType: 'mouse' });
  at(root, 'pointerup', X(0.5) + 20, Y(0.5), { pointerType: 'mouse' });
  assert.equal(st.p[1][1], 1); // a marquee, not the point
  at(root, 'pointerdown', X(0.5) + 20, Y(1), { pointerType: 'touch' });
  at(root, 'pointermove', X(0.5) + 20, Y(0.5), { pointerType: 'touch' });
  at(root, 'pointerup', X(0.5) + 20, Y(0.5), { pointerType: 'touch' });
  near(st.p[1][1], 0.5, 1e-5);
  // the curve handle of segment 0 sits at (0.25, 0.5): 20 px below it is a handle for touch, a marquee for the mouse
  st.p = [[0, 0, 0], [0.5, 1, 0], [1, 0, 0]];
  at(root, 'pointerdown', X(0.25), Y(0.5) + 20, { pointerType: 'mouse' });
  at(root, 'pointermove', X(0.25), Y(0.5) - 20, { pointerType: 'mouse' });
  at(root, 'pointerup', X(0.25), Y(0.5) - 20, { pointerType: 'mouse' });
  assert.equal(st.p[0][2], 0);
  at(root, 'pointerdown', X(0.25), Y(0.5) + 20, { pointerType: 'touch' });
  at(root, 'pointermove', X(0.25), Y(0.5) - 20, { pointerType: 'touch' });
  at(root, 'pointerup', X(0.25), Y(0.5) - 20, { pointerType: 'touch' });
  assert.ok(st.p[0][2] > 0, 'curved by the touch drag');
  const e = mkEnv();
  const s = e.ed.size(), E = e.ed.env(), Gm = e.ed.geo(s, E, e.ed.scale(s, E));
  assert.equal(e.ed.hit({ px: Gm.corners[2][0], py: Gm.corners[2][1] + 20 }, false), -1);
  assert.equal(e.ed.hit({ px: Gm.corners[2][0], py: Gm.corners[2][1] + 20 }, true), 2);
});

test('CurveEditor zoom: view geometry and inverse, edits in zoomed coordinates, clip + badge, Reset Zoom (menu, key 0)', () => {
  const { root, ed, st } = mkCurve({ opts: { zoom: true } });
  assert.ok(ed.zp && !ed.zoomed());
  const s = ed.size();
  assert.equal(ed.X(0.3, s), X(0.3)); // unzoomed: the Phase-1 mapping, bit for bit
  assert.equal(ed.Y(0.3, s), Y(0.3));
  ed.setView({ x0: 0.25, x1: 0.75, y0: 0, y1: 0.5 });
  assert.ok(ed.zoomed());
  near(ed.X(0.5, s), W / 2); near(ed.X(0.25, s), PAD); near(ed.X(0.75, s), W - PAD);
  near(ed.Y(1, s), PAD); near(ed.Y(0.5, s), H - PAD);
  const P = ed.pos({ clientX: W / 2, clientY: PAD });
  near(P.x, 0.5); near(P.y, 1);
  // drag the peak (0.5, 1): half the plot height is a quarter of the range now
  at(root, 'pointerdown', W / 2, PAD);
  at(root, 'pointermove', W / 2, PAD + (H - 2 * PAD) / 2);
  at(root, 'pointerup', W / 2, PAD + (H - 2 * PAD) / 2);
  near(st.p[1][1], 0.75, 1e-5);
  const ctx = one(root, 'gx-cv').getContext('2d');
  ctx.calls.length = 0;
  ed.draw();
  assert.ok(ctx.calls.some(c => c[0] === 'clip'));
  assert.ok(ctx.calls.some(c => c[0] === 'fillText' && c[1] === '×2.0'));
  // a curved segment is drawn in steps over its visible part only
  st.p = [[0, 0, 0.5], [1, 1, 0]];
  ed.setView({ x0: 0.5, x1: 0.5 + 1 / 128, y0: 0, y1: 1 });
  ctx.calls.length = 0;
  ed.draw();
  assert.ok(ctx.calls.filter(c => c[0] === 'lineTo').length < 2000);
  // Reset Zoom: menu item (disabled when not zoomed), key 0
  fire(root, 'contextmenu', { clientX: 20, clientY: 20 });
  const items = byCls(globalThis.document.body, 'wk-ci');
  const rz = items.find(n => n.textContent.includes('Reset Zoom'));
  assert.ok(rz && rz.getAttribute('aria-disabled') !== 'true');
  ptr(rz, 'pointerdown', 0, 0);
  rz.click();
  assert.ok(!ed.zoomed());
  ed.setView({ x0: 0, x1: 0.5, y0: 0, y1: 1 });
  key(root, '0');
  assert.ok(!ed.zoomed());
  ctx.calls.length = 0;
  ed.draw();
  assert.ok(!ctx.calls.some(c => c[0] === 'clip'));
  // invalid views fall back to the full axis
  ed.setView({ x0: 0.5, x1: 0.5, y0: NaN, y1: 2 });
  assert.deepEqual(ed.view, { x0: 0, x1: 1, y0: 0, y1: 1 });
  // without o.zoom: no zoomPan, no menu item
  const plain = mkCurve();
  assert.equal(plain.ed.zp, undefined);
  assert.ok(!plain.ed.menuItems(-1).some(it => it.label === 'Reset Zoom'));
});

test('CurveEditor zoom: two fingers pinch / pan; the second finger undoes the one-finger drag; Ctrl-wheel zooms', () => {
  const { root, ed, st } = mkCurve({ opts: { zoom: true } });
  const T = (type, id, x, y) => at(root, type, x, y, { pointerType: 'touch', pointerId: id });
  T('pointerdown', 1, X(0.5), Y(1));
  T('pointermove', 1, X(0.5), Y(0.6));
  near(st.p[1][1], 0.6, 1e-5);
  T('pointerdown', 2, X(0.9), Y(0.6)); // second finger: the drag is undone and ends
  assert.equal(st.p[1][1], 1);
  assert.equal(st.calls.at(-1)[0], 'end');
  assert.equal(ed.g, null);
  assert.ok(ed.zp.active());
  T('pointermove', 2, X(0.9) + (X(0.9) - X(0.5)), Y(0.6)); // spread ×2 horizontally and vertically
  T('pointermove', 1, X(0.5), Y(0.6));
  assert.ok(ed.zoomed());
  assert.equal(st.p[1][1], 1); // finger 1's moves belong to the pinch
  T('pointerup', 2, X(1), Y(0.6));
  T('pointerup', 1, X(0.5), Y(0.6));
  assert.ok(!ed.zp.active());
  const n = st.calls.length;
  T('pointermove', 1, X(0.2), Y(0.2));
  assert.equal(st.calls.length, n);
  ed.resetView();
  fire(root, 'wheel', { ctrlKey: true, deltaY: -100, clientX: W / 2, clientY: H / 2 });
  assert.ok(ed.zoomed());
  near((ed.view.x0 + ed.view.x1) / 2, 0.5, 1e-9);
});

test('PathEditor zoom and lfoEditorLarge: zoom on by default in the overlay (o.zoom = false turns it off)', () => {
  const { ed, root } = mkPath({ opts: { zoom: 'xy' } });
  assert.ok(ed.zp);
  const s = ed.size();
  assert.equal(ed.X(0.4, s), X(0.4));
  ed.setView({ x0: 0.5, x1: 1, y0: 0.5, y1: 1 });
  near(ed.X(0.75, s), W / 2); near(ed.Y(0.25, s), H / 2);
  const P = ed.pos({ clientX: W / 2, clientY: H / 2 });
  near(P.x, 0.75); near(P.y, 0.25);
  assert.ok(ed.menuItems().some(it => it.label === 'Reset Zoom' && !it.disabled));
  const ctx = one(root, 'gx-cv').getContext('2d');
  ctx.calls.length = 0;
  ed.draw();
  assert.ok(ctx.calls.some(c => c[0] === 'clip'));
  key(root, '0');
  assert.ok(!ed.zoomed());
  const d = fresh();
  const ov = lfoEditorLarge(d.body, { get: () => [[0, 0, 0], [1, 1, 0]], set() {} });
  assert.ok(ov.editor.zp);
  ov.destroy();
  const ov2 = lfoEditorLarge(d.body, { path: true, get: () => core.PATH_DEFAULT, set() {} });
  assert.ok(ov2.editor.zp);
  ov2.destroy();
  const ov3 = lfoEditorLarge(d.body, { get: () => [[0, 0, 0], [1, 1, 0]], set() {}, zoom: false });
  assert.equal(ov3.editor.zp, undefined);
  ov3.destroy();
});

test('EnvEditor touch: a double-tap on a curve handle resets it; the mouse double-click after a touch is ignored', () => {
  const { root, ed, st } = mkEnv({ e: { ca: 0.8 } });
  const s = ed.size(), E = ed.env(), Gm = ed.geo(s, E, ed.scale(s, E)), [hx, hy] = Gm.handles[0];
  const tap = () => { at(root, 'pointerdown', hx, hy, { pointerType: 'touch' }); at(root, 'pointerup', hx, hy, { pointerType: 'touch' }); };
  tap();
  assert.equal(st.e.ca, 0.8);
  tap();
  assert.equal(st.e.ca, 0.5);
  assert.deepEqual(st.calls.at(-1), ['set', { ca: 0.5 }]);
  const n = st.calls.length;
  st.e.ca = 0.8;
  fire(root, 'dblclick', { clientX: hx, clientY: hy });
  assert.equal(st.calls.length, n); // touch synthesised dblclick: handled by the taps
  // taps on two different targets do not pair; a corner double-tap changes nothing
  const [cx, cy] = Gm.corners[0];
  at(root, 'pointerdown', cx, cy, { pointerType: 'touch' }); at(root, 'pointerup', cx, cy, { pointerType: 'touch' });
  at(root, 'pointerdown', cx, cy, { pointerType: 'touch' }); at(root, 'pointerup', cx, cy, { pointerType: 'touch' });
  assert.equal(st.calls.length, n);
  // the mouse double-click still resets
  at(root, 'pointerdown', 1, 1, { pointerType: 'mouse' });
  fire(root, 'dblclick', { clientX: hx, clientY: Gm.handles[0][1] });
  assert.equal(st.e.ca, 0.5);
});

/* ------------------------------------------------------------------ review fixes (U5, round 2) */
test('CurveEditor mcurve: RISE / FALL typed entry reads units (s, ms, comma), bare numbers in the shown unit, Off', () => {
  const d = fresh();
  const row = { rise: 0, fall: 0, slink: 0 };
  const host = d.createElement('div');
  d.body.appendChild(host);
  const slew = { get: () => row, set: p => Object.assign(row, p) };
  const ed = new CurveEditor(host, { kind: 'mcurve', get: () => null, set() {}, slew });
  place(ed.root, 0, 0, W, H);
  const [rise, fall] = byCls(ed.bar, 'wk-nb');
  const type = (nb, t) => { nb.focus(); key(nb, 'Enter'); const i = one(nb, 'wk-in'); i.value = t; key(i, 'Enter'); return one(nb, 'wk-nbt').textContent; };
  const sec = n => core.SLEW_T(n);
  assert.equal(type(rise, '1 s'), '1.00 s'); // was 1.00 ms: the default parser ignored the unit
  near(sec(row.rise), 1, 2e-3);
  assert.equal(type(rise, '250 ms'), '250 ms');
  near(sec(row.rise), 0.25, 1e-3);
  assert.equal(type(rise, '4 s'), '4.00 s');
  assert.equal(row.rise, 1);
  assert.equal(type(rise, '9 s'), '4.00 s'); // clamped to the law
  assert.equal(type(fall, '0,5 s'), '500 ms');
  near(sec(row.fall), 0.5, 2e-3);
  assert.equal(type(fall, '20'), '20.0 ms'); // bare: the unit shown (ms)
  type(fall, '2 s');
  assert.equal(type(fall, '3'), '3.00 s'); // bare: the unit shown (s)
  assert.equal(type(rise, 'off'), 'Off');
  assert.equal(row.rise, 0);
  type(rise, 'soon');
  assert.ok(rise.classList.contains('wk-bad'));
  assert.equal(row.rise, 0);
  const ed2 = new CurveEditor(host, { kind: 'mcurve', get: () => null, set() {}, slew, parseSlew: t => (t === 'max' ? 1 : null) });
  type(byCls(ed2.bar, 'wk-nb')[0], 'max');
  assert.equal(row.rise, 1);
  ed.destroy(); ed2.destroy();
});

test('Load Shape honours the kind limit: shapes over 64 (mcurve) / 128 (spec) points are disabled and never loaded', () => {
  const d = fresh();
  const host = d.createElement('div');
  d.body.appendChild(host);
  const big = pts.normalize(Array.from({ length: 200 }, (_, i) => [i / 199, (i % 7) / 6, 0]), { links: false });
  const mid = pts.normalize(Array.from({ length: 100 }, (_, i) => [i / 99, (i % 5) / 4, 0]), { links: false });
  const shapes = { list: () => [{ name: 'Big', pts: big }, { name: 'Mid', pts: mid }], save() {} };
  for (const [kind, max] of [['mcurve', 64], ['spec', 128], ['lfo', 480]]) {
    const st = { p: null };
    const ed = new CurveEditor(host, { kind, get: () => st.p, set: p => { st.p = p; }, shapes });
    place(ed.root, 0, 0, W, H);
    const sub = ed.menuItems(-1).find(i => i.label === 'Load Shape').sub;
    const item = nm => sub.find(i => i.label && i.label.startsWith(nm));
    assert.ok(pts.SHAPES.every(sh => !item(sh.name).disabled), kind + ': factory shapes fit');
    assert.equal(!!item('Big').disabled, max < 200, kind);
    assert.equal(!!item('Mid').disabled, max < 100, kind);
    if (max < 200) assert.equal(item('Big').label, 'Big (over ' + max + ' points)');
    item('Big').action(); // a disabled item cannot be picked; the method refuses as well
    if (max < 200) {
      assert.equal(st.p, null, kind);
      assert.match(one(ed.root, 'gx-sr').textContent, new RegExp('more than ' + max));
    } else assert.equal(st.p.length, 200);
    item('Mid').action();
    assert.equal(st.p === null ? 0 : st.p.length, max < 100 ? 0 : 100, kind);
    ed.destroy();
  }
});

test('CurveEditor: a pinch that interrupts a drawing tool restores the points and the LFO loop / start points', () => {
  const p0 = [[0, 0, 0], [0.25, 1, 0], [0.4, 0.2, 0], [0.6, 0.8, 0], [1, 0, 0]];
  const { root, ed, st } = mkCurve({ p: p0, grid: { x: 4, y: 0 }, opts: { zoom: true, tool: () => 'flat' } });
  st.loop = 2; st.start = 3;
  ed.sel = new Set([3]); ed.act = 3;
  const T = (type, id, x, y) => at(root, type, x, y, { pointerType: 'touch', pointerId: id, isPrimary: id === 1 });
  T('pointerdown', 1, X(0.6), Y(0.2)); // the Flat tool draws cell 0.5…0.75 at once: point 3 (the start point) goes
  assert.equal(st.start, 0);
  assert.notDeepEqual(st.p, p0);
  T('pointerdown', 2, X(0.9), Y(0.5)); // second finger: pinch
  assert.ok(ed.zp.active());
  assert.deepEqual(st.p, p0);
  assert.deepEqual([st.loop, st.start, [...ed.sel], ed.act], [2, 3, [3], 3]);
  T('pointerup', 2, X(0.9), Y(0.5)); T('pointerup', 1, X(0.6), Y(0.2));
});

test('zoomable editors: a finger lifted outside is forgotten, no long-press menu mid-pinch, the plot content stays under the fingers', () => {
  const { d, root, ed, st } = mkCurve({ opts: { zoom: true } });
  // isPrimary as browsers set it on the first finger of an interaction (no other touch on the screen) — except finger 3,
  // so that forgetting finger 1 relies on the document-level tracking alone
  const first = new Set([1, 4, 6]);
  const T = (type, id, x, y, tgt = root) => ptr(tgt, type, x, y, { pointerType: 'touch', pointerId: id, isPrimary: first.has(id) });
  // pinch out; finger 1 leaves the editor and lifts outside it (its capture went with the aborted gesture)
  T('pointerdown', 1, 80, 80); T('pointerdown', 2, 120, 80);
  T('pointermove', 1, 20, 80); T('pointermove', 2, 200, 80);
  T('pointerup', 1, -40, 80, d.body);
  T('pointerup', 2, 200, 80);
  assert.ok(!ed.zp.active());
  ed.resetView();
  T('pointerdown', 3, X(0.5), Y(1)); // later, one finger edits again (it used to be taken for a pinch)
  assert.ok(!ed.zp.active() && ed.g);
  T('pointermove', 3, X(0.5), Y(0.5)); T('pointerup', 3, X(0.5), Y(0.5));
  near(st.p[1][1], 0.5, 1e-5);
  // a long pinch opens no context menu; a still single finger still does
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    T('pointerdown', 4, 90, 60); T('pointerdown', 5, 130, 60);
    for (let k = 1; k <= 12; k++) { T('pointermove', 4, 90 - 3 * k, 60); T('pointermove', 5, 130 + 3 * k, 60); mock.timers.tick(50); }
    assert.ok(ed.zp.active() && ed.zoomed());
    assert.equal(byCls(d.body, 'wk-ctx').length, 0);
    T('pointerup', 5, 166, 60); T('pointerup', 4, 54, 60);
    ed.resetView();
    T('pointerdown', 6, 30, 140);
    mock.timers.tick(500);
    assert.equal(byCls(d.body, 'wk-ctx').length, 1);
    T('pointerup', 6, 30, 140);
  } finally { mock.timers.reset(); }
  // pinch anchor: the plot is inset by PAD, the content under the fingers' midpoint stays there at any zoom
  const z = mkCurve({ opts: { zoom: 'x' } });
  for (const cx of [60, 160]) {
    z.ed.resetView();
    const u0 = z.ed.pos({ clientX: cx, clientY: 80 }).x;
    ptr(z.root, 'pointerdown', cx - 10, 80, { pointerType: 'touch', pointerId: 7 });
    ptr(z.root, 'pointerdown', cx + 10, 80, { pointerType: 'touch', pointerId: 8 });
    for (const f of [2, 8, 32]) {
      ptr(z.root, 'pointermove', cx - 10 * f, 80, { pointerType: 'touch', pointerId: 7 });
      ptr(z.root, 'pointermove', cx + 10 * f, 80, { pointerType: 'touch', pointerId: 8 });
      near(z.ed.view.x1 - z.ed.view.x0, 1 / f, 1e-9);
      near(z.ed.pos({ clientX: cx, clientY: 80 }).x, u0, 1e-9);
    }
    ptr(z.root, 'pointerup', cx, 80, { pointerType: 'touch', pointerId: 7 });
    ptr(z.root, 'pointerup', cx, 80, { pointerType: 'touch', pointerId: 8 });
  }
  // the maximum zoom: a span a rounding error under 1/128 (zoomPan's clamped window) is kept, not reset to ×1
  z.ed.setView({ x0: 0.00248046875, x1: 0.01029296875, y0: 0, y1: 1 });
  assert.ok(z.ed.view.x1 - z.ed.view.x0 < 1 / 128);
  assert.equal(z.ed.view.x0, 0.00248046875);
});

test('hidden pages are not painted: Curve / Env / Path editors skip drawing while their box is not rendered', () => {
  for (const mk of [() => mkCurve(), () => mkEnv(), () => mkPath()]) {
    const { ed, root } = mk();
    const cv = one(root, 'gx-cv'), ov = one(root, 'gx-ov');
    root.getClientRects = () => []; // display: none (a hidden page)
    cv.getContext('2d').calls.length = 0;
    ov.getContext('2d').calls.length = 0;
    ed.draw(); ed.drawOverlay(true);
    assert.equal(cv.getContext('2d').calls.length + ov.getContext('2d').calls.length, 0);
    root.getClientRects = () => [{ width: 1 }];
    ed.draw();
    assert.ok(cv.getContext('2d').calls.length > 0);
    ed.destroy();
  }
});

test('EnvEditor: graph menu (o.menu) on right-click / long-press off the handles and on ContextMenu / Shift+F10', () => {
  const menus = [];
  const { root, ed, st } = mkEnv({ opts: { menu: (x, y) => menus.push([x, y]) } });
  const e1 = fire(root, 'contextmenu', { clientX: 100, clientY: 115 });
  assert.ok(e1.defaultPrevented);
  assert.deepEqual(menus, [[100, 115]]);
  // on a curve handle a right-click still resets the curve (no menu)
  st.e.ca = 0.8;
  const s = ed.size(), E = ed.env(), Gm = ed.geo(s, E, ed.scale(s, E)), [hx, hy] = Gm.handles[0];
  fire(root, 'contextmenu', { clientX: hx, clientY: hy });
  assert.equal(st.e.ca, 0.5);
  assert.equal(menus.length, 1);
  root.focus();
  key(root, 'F10', { shiftKey: true });
  key(root, 'ContextMenu');
  assert.equal(menus.length, 3);
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    at(root, 'pointerdown', 100, 115, { pointerType: 'touch' });
    mock.timers.tick(500);
    assert.deepEqual(menus.at(-1), [100, 115]);
    at(root, 'pointerup', 100, 115, { pointerType: 'touch' });
  } finally { mock.timers.reset(); }
  // without o.menu a right-click off the handles is left alone
  const plain = mkEnv();
  assert.ok(!fire(plain.root, 'contextmenu', { clientX: 100, clientY: 115 }).defaultPrevented);
});

test('pts.path: an open path never closes by an edit (the last point landing on the first is nudged 1e-5)', () => {
  const p = [[0.25, 0.25, 0], [0.75, 0.25, 0], [0.75, 0.75, 0], [0.4, 0.6, 0]];
  const m = P.move(p, 3, 0.26, 0.24, { snap: true, grid: { x: 4, y: 4 } }); // Alt-snapped onto the first point
  assert.ok(!P.isClosed(m));
  assert.deepEqual(m[3], [0.25001, 0.25, 0]);
  assert.equal(P.setClosed(m, false).length, 4); // Open Path keeps every point (it was never closed)
  const m0 = P.move(p, 0, 0.4, 0.6); // the first point onto the last
  assert.ok(!P.isClosed(m0));
  assert.deepEqual(m0[0], [0.4, 0.6, 0]);
  near(m0[3][0], 0.40001, 1e-12);
  const mm = P.moveMany(p, [3], -0.15, -0.35);
  assert.ok(!P.isClosed(mm));
  const ins = P.insert([[0.2, 0.2, 0], [0.8, 0.8, 0]], 0.2, 0.2, { map: [], append: true });
  assert.ok(!P.isClosed(ins) && ins.length === 3);
  const rm = P.remove([[0.2, 0.2, 0], [0.5, 0.9, 0], [0.2, 0.2, 0.5], [0.9, 0.1, 0]].map((q, i) => (i === 2 ? [0.2, 0.20001, 0.5] : q)), [3]);
  assert.ok(!P.isClosed(rm));
  // a closed path stays closed under the same moves (the closing copy follows the first point)
  const c = P.normalize(core.PATH_DEFAULT);
  assert.ok(P.isClosed(P.move(c, 0, 0.3, 0.3)));
  assert.ok(P.isClosed(P.setClosed(m, true)));
});

test('two-finger rollback (gesture.js\'s pointercancel flagged e.gesture === "two-finger"): Curve, Env and Path editors undo the drag (the values at the press, then "end"); a plain cancel keeps', () => {
  const TW = { pointerType: 'touch', pointerId: 4, isPrimary: true }, TWO = { pointerType: 'touch', pointerId: 4, isPrimary: true, gesture: 'two-finger' };
  {
    const { root, st } = mkCurve();
    const p0 = JSON.stringify(st.p);
    at(root, 'pointerdown', X(0.5), Y(1), TW); at(root, 'pointermove', X(0.6), Y(0.8), TW);
    assert.notEqual(JSON.stringify(st.p), p0);
    at(root, 'pointercancel', X(0.6), Y(0.8), TWO);
    assert.equal(JSON.stringify(st.p), p0);
    assert.deepEqual(st.calls.map(c => c[0]), ['start', 'move', 'move', 'end']);
    at(root, 'pointerdown', X(0.5), Y(1), TW); at(root, 'pointermove', X(0.6), Y(0.8), TW); at(root, 'pointercancel', X(0.6), Y(0.8), TW);
    assert.notEqual(JSON.stringify(st.p), p0, 'plain cancel keeps');
  }
  {
    const { root, st } = mkEnv();
    const xA = EP + PX;
    at(root, 'pointerdown', xA, EY(1), TW); at(root, 'pointermove', xA + PX / 2, EY(1), TW);
    near(st.e.a, 1.5, 1e-9);
    at(root, 'pointercancel', xA + PX / 2, EY(1), TWO);
    assert.equal(st.e.a, 1);
    assert.deepEqual(st.calls.map(c => c[0]), ['start', 'move', 'move', 'end']);
    assert.deepEqual(st.calls.at(-1)[1], { a: 1 });
    at(root, 'pointerdown', xA, EY(1), TW); at(root, 'pointermove', xA + PX / 2, EY(1), TW); at(root, 'pointercancel', xA + PX / 2, EY(1), TW);
    near(st.e.a, 1.5, 1e-9, 'plain cancel keeps');
  }
  {
    const { root, st } = mkPath();
    const p0 = JSON.stringify(st.p);
    at(root, 'pointerdown', X(0.5), Y(1), TW); at(root, 'pointermove', X(0.4), Y(0.8), TW);
    assert.notEqual(JSON.stringify(st.p), p0);
    at(root, 'pointercancel', X(0.4), Y(0.8), TWO);
    assert.equal(JSON.stringify(st.p), p0);
    assert.equal(st.calls.at(-1)[0], 'end');
  }
});
