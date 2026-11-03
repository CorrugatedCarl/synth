import './v8-guard.mjs';
// tests/ui-bench-fps.mjs's pure parts (stage FR, IMPL-FR §9 G7; lane S): the statistics, the expected-rate classes and the expect judge, the
// clock's cadence rule (effOf = wk.js clkK), the budgets and the gates of a cell, the CDP metrics delta, the matrix, the argument parser, the
// summary / bench row / clients audit; the expected-live lists' shape; the page module imports with no DOM and no browser (its work only inside
// buildScene / prepare / main and the driver); tests/ui-bench.html routes ?fps=1 to it; the hooks are one self-contained function.
// No browser here: the CDP run is `node tests/ui-bench-fps.mjs` (Chrome for Testing).
// Run alone: node --max-old-space-size=2048 --test tests/ui-bench-fps.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as B from './ui-bench-fps.mjs';
import { clock, DISPLAY_RATES } from '../wk.js?v=9';

const cell = (o = {}) => Object.assign({ scene: 'tutorial', throttle: 1, cap: 240, display: 240, size: 'd', frames: { delivered: 240, missed: 0 }, frameCost: { n: 960, med: 0.4, p95: 1.2, max: 3, mean: 0.5 },
  cdp: { layoutMs: 0.2, styleMs: 0.1 }, heapBytesPerS: 40000, errors: [], expect: [], clock: { measured: true, display: 240, eff: 240, expectEff: 240 } }, o);
const gate = (v, id) => v.gates.find(g => g.id === id);

test('q: n, min, median, p95, max, mean of a list (as ui-bench-wc\'s q: the element at p·n); not-numbers dropped; typed arrays', () => {
  assert.deepEqual(B.q([0.2, 0.3, 0.1, 5, 'x', NaN, 0.2]), { n: 5, min: 0.1, med: 0.2, p95: 5, max: 5, mean: 1.16 });
  assert.deepEqual(B.q([]), { n: 0, min: 0, med: 0, p95: 0, max: 0, mean: 0 });
  assert.equal(B.q(Float64Array.from([1, 2, 3, 4])).med, 3);
  const a = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.deepEqual([B.q(a).med, B.q(a).p95, B.q(a).max], [51, 96, 100]);
});

test('effOf = the clock\'s cadence rule (wk.js clkK / clkEff): the §1.3 pairs, the 25 % rule, the 60 floor on the global cap', () => {
  const pairs = [[60, 60, 60], [120, 120, 120], [144, 120, 144], [165, 120, 82.5], [240, 240, 240], [240, 120, 120], [240, 144, 120], [240, 165, 120], [360, 120, 120], [120, 60, 60], [240, 60, 60], [90, 60, 90], [60, 120, 60], [30, 120, 30], [72, 60, 72], [1000, 240, 250]];
  for (const [D, C, E] of pairs) assert.equal(Math.round(B.effOf(D, C) * 100) / 100, E, D + ' Hz at cap ' + C);
  assert.equal(B.effOf(240, Infinity), 240, 'an unlimited cap = the ceiling 240');
  assert.equal(B.effOf(0, 120), 60, 'no display measured: the clock\'s 60');
  assert.ok(DISPLAY_RATES.includes(60) && DISPLAY_RATES.includes(240), 'the clock module it follows');
});

test('effOf agrees with the real clock\'s eff() on every pair (config({ display }) + setCap), so the harness\'s expectation cannot drift from wk.js', () => {
  try {
    for (const D of [30, 60, 72, 90, 120, 144, 165, 240, 360]) for (const C of [60, 120, 144, 165, 240, Infinity]) {
      clock._reset(); clock.config({ display: D }); clock.setCap(C);
      assert.equal(Math.round(clock.eff() * 1000) / 1000, Math.round(B.effOf(D, C) * 1000) / 1000, D + ' Hz at cap ' + C);
    }
  } finally { clock._reset(); }
});

test('rateOf: the classes — eff / snap (the worklets\' 29 Hz) / gr (30) / heavy (min(60, data)) / an absolute number; never above eff; the data rate overridable (Cut B)', () => {
  assert.deepEqual([B.rateOf('eff', 120), B.rateOf('snap', 120), B.rateOf('gr', 120), B.rateOf('heavy', 120), B.rateOf(10, 120), B.rateOf(undefined, 90)], [120, 29, 30, 29, 10, 90]);
  assert.equal(B.rateOf('heavy', 240, { snap: 100 }), 60, 'a fast data lane: the heavy displays at 60');
  assert.equal(B.rateOf('heavy', 30, { snap: 100 }), 30, 'never above the clock');
  assert.equal(B.rateOf('gr', 25), 25);
  assert.deepEqual([B.HZ.snap, B.HZ.gr, B.HZ.heavyMax], [29, 30, 60]);
});

test('(FR Cut B §5.6) rateOf under o.fast: snap and gr → eff (the view moves every frame); heavy → min(o.snap ?? eff, E / max(1, floor(E / 60))) (its Cut B comment: 82.5 at 165, 72 at 144, 60 at 120 / 240, E itself at 60–119); the new curve class (the filter display\'s curve, the user\'s QB) → min(eff, 60) on High, min(eff, 30) on Medium / Low; without o.fast every class as before (curve as snap)', () => {
  const F = { fast: true };
  assert.deepEqual([60, 90, 120, 144, 165, 240].map(e => B.rateOf('snap', e, F)), [60, 90, 120, 144, 165, 240], 'snap: every frame');
  assert.deepEqual([60, 120, 240].map(e => B.rateOf('gr', e, F)), [60, 120, 240], 'gr: every frame');
  assert.deepEqual([60, 90, 120, 144, 165, 240].map(e => B.rateOf('heavy', e, F)), [60, 90, 60, 72, 82.5, 60], 'heavy: E / floor(E / 60)');
  assert.deepEqual([B.rateOf('heavy', 240, { fast: true, snap: 30 }), B.rateOf('heavy', 90, { fast: true, snap: 120 })], [30, 90], 'heavy: never above the data');
  assert.equal(B.rateOf('heavy', 119.8, { fast: true, eff: 120 }), 60, 'heavy: its cadence k from the clock\'s E (o.eff, evalExpect\'s ctx), not from the frames delivered (119.8 → k 1 would ask 119.8)');
  assert.equal(B.evalExpect({ name: 'x', rate: 'heavy' }, { found: 1, rates: [59.9] }, { eff: 120, delivered: 119.84, fast: true }).pass, true, 'a 120 Hz cell delivering 119.84: the heavy class at 60');
  assert.deepEqual([60, 120, 240, 30].map(e => B.rateOf('curve', e, F)), [60, 60, 60, 30], 'curve: ≤ 60 on High');
  assert.deepEqual([60, 120, 240].map(e => B.rateOf('curve', e, { fast: true, perf: 'medium' })), [30, 30, 30], 'curve: ≤ 30 on Medium');
  assert.deepEqual([60, 120].map(e => B.rateOf('curve', e, { fast: true, perf: 'low' })), [30, 30], 'curve: ≤ 30 on Low');
  assert.deepEqual([B.rateOf('curve', 120), B.rateOf('snap', 120, { fast: false }), B.rateOf('gr', 120, { fast: false }), B.rateOf('heavy', 120, { fast: false })], [29, 29, 30, 29], 'fast off: today\'s classes');
  assert.deepEqual([B.rateOf('eff', 120, F), B.rateOf(10, 120, F)], [120, 10]);
});

test('(FR Cut B §5.6) evalExpect under fast: a snap display at 0.8 × eff, the curve judged from above too (> 1.25 × its cap fails: the filter curve redraws at most 60 / 30 a second)', () => {
  assert.equal(B.evalExpect({ name: 'x', rate: 'snap' }, { found: 1, rates: [100] }, { eff: 120, fast: true }).pass, true, '0.8 × 120 = 96');
  assert.equal(B.evalExpect({ name: 'x', rate: 'snap' }, { found: 1, rates: [90] }, { eff: 120, fast: true }).pass, false);
  assert.equal(B.evalExpect({ name: 'x', rate: 'curve' }, { found: 1, rates: [58] }, { eff: 120, fast: true }).pass, true);
  const over = B.evalExpect({ name: 'x', rate: 'curve' }, { found: 1, rates: [110] }, { eff: 120, fast: true });
  assert.deepEqual([over.pass, /above/.test(over.why)], [false, true], 'a curve at the display\'s rate: the cap ignored — ' + over.why);
  assert.equal(B.evalExpect({ name: 'x', rate: 'curve' }, { found: 1, rates: [36] }, { eff: 120, fast: true, perf: 'medium' }).pass, true, 'Medium: 30, ≤ 37.5');
  assert.equal(B.evalExpect({ name: 'x', rate: 'curve' }, { found: 1, rates: [55] }, { eff: 120, fast: true, perf: 'medium' }).pass, false, 'Medium: above 1.25 × 30');
  assert.equal(B.evalExpect({ name: 'x', rate: 'curve' }, { found: 1, rates: [26] }, { eff: 120 }).pass, true, 'fast off: the curve is a snap display (29)');
});

test('(FR Cut B review 2, P1-1) rateOf: on Medium / Low every heavy display ≤ 30 a second (a ceiling: E / ceil(E / 30)); the frame clock\'s drop level o.drop halves the heavy and curve classes per level (k doubled), never below 15 a second, fast off too (under the data\'s 29); evalExpect judges from below at the window\'s highest level (ctx.drop) and the curve from above at its lowest (ctx.dropLo); --perf high|medium|low', () => {
  assert.deepEqual([60, 120, 144, 240].map(e => B.rateOf('heavy', e, { fast: true, perf: 'medium' })), [30, 30, 28.8, 30], 'heavy on Medium: ≤ 30');
  assert.deepEqual([60, 120].map(e => B.rateOf('heavy', e, { fast: true, perf: 'low' })), [30, 30], 'heavy on Low: ≤ 30');
  assert.deepEqual([0, 1, 2, 3].map(L => B.rateOf('heavy', 120, { fast: true, drop: L })), [60, 30, 15, 15], 'heavy on High at 120: halved per level, ≥ 15');
  assert.deepEqual([0, 1, 2].map(L => B.rateOf('heavy', 240, { fast: true, drop: L })), [60, 30, 15]);
  assert.deepEqual([0, 1, 2].map(L => B.rateOf('heavy', 60, { fast: true, perf: 'medium', drop: L })), [30, 15, 15], 'Medium: 30 → 15');
  assert.deepEqual([0, 1, 2].map(L => B.rateOf('curve', 120, { fast: true, drop: L })), [60, 30, 15], 'the curve the same');
  assert.deepEqual([B.rateOf('heavy', 120, { drop: 2 }), B.rateOf('heavy', 120, { drop: 1 }), B.rateOf('curve', 60, { drop: 2 }), B.rateOf('heavy', 120)], [15, 29, 15, 29], 'fast off: the data\'s 29, a level below it');
  assert.equal(B.evalExpect({ name: 'x', rate: 'heavy' }, { found: 1, rates: [25] }, { eff: 120, fast: true, drop: 1, dropLo: 0 }).pass, true, '25 ≥ 0.8 × 30 at level 1');
  assert.equal(B.evalExpect({ name: 'x', rate: 'heavy' }, { found: 1, rates: [25] }, { eff: 120, fast: true, drop: 0, dropLo: 0 }).pass, false, '25 < 0.8 × 60 at level 0');
  assert.equal(B.evalExpect({ name: 'x', rate: 'curve', tol: 0.4 }, { found: 1, rates: [58] }, { eff: 120, fast: true, drop: 1, dropLo: 0 }).pass, true, 'a window begun at level 0: 60 allowed from above');
  assert.equal(B.evalExpect({ name: 'x', rate: 'curve', tol: 0.4 }, { found: 1, rates: [58] }, { eff: 120, fast: true, drop: 2, dropLo: 2 }).pass, false, 'all of it at level 2: > 1.25 × 15');
  assert.deepEqual([B.parseArgs([]).perf, B.parseArgs(['--perf', 'medium']).perf, B.parseArgs(['--perf', 'fast']).errors.length], [null, 'medium', 1], '--perf: the app\'s preset for every cell (default: the app\'s own, High)');
  // from level 2 the fast lane's motion sheds (wk.clock `shed` clients: every other frame, ≥ 30 a second): snap / gr under fast
  assert.deepEqual([0, 1, 2, 3].map(L => B.rateOf('snap', 60, { fast: true, drop: L })), [60, 60, 30, 30], 'snap at 60: shed from level 2');
  assert.deepEqual([B.rateOf('snap', 240, { fast: true, drop: 2 }), B.rateOf('snap', 240, { fast: true, drop: 3 }), B.rateOf('gr', 120, { fast: true, drop: 3 }), B.rateOf('snap', 30, { fast: true, drop: 3 }), B.rateOf('snap', 120, { drop: 2 })], [120, 30, 30, 30, 29], 'half the cadence at level 2, the floor (30) at 3; fast off: the data\'s 29');
  // each cell its own condition: prepare starts the clock's drop level afresh (a 6 × cell must not leave a 1 × one shedding); the
  // smooth probe judged by the cell's own lane (the touch sizes read as iPadOS: WebKit, the lane off — recorded, not judged)
  const src = readFileSync(new URL('./ui-bench-fps.mjs', import.meta.url), 'utf8');
  assert.ok(/wk\.clock\.dropReset\(\)/.test(src.slice(src.indexOf('export async function prepare'), src.indexOf('export async function smoothProbe'))), 'prepare: dropReset');
  assert.ok(/pass: !pre\.fast \|\| !!r\.pass/.test(src), 'the probe by the cell\'s lane');
});

test('(FR Cut B §5.6) the EXPECT changes: the filter display\'s curve is the curve class, its cutoff marker a snap entry of its own; the LFO-driven knob dots tol 0.5, the master OUT meters tol 0.4; the GR bars keep gr and their tol; every other class as it was', () => {
  const fd = B.EXPECT.tutorial.find(e => e.name === 'filter display');
  assert.deepEqual(fd && [fd.rate, fd.kind], ['curve', 'canvas']);
  const mk = B.EXPECT.tutorial.find(e => e.name === 'filter cutoff marker');
  assert.deepEqual(mk && [mk.rate, mk.kind, mk.fast, /sxo-fmark/.test(mk.sel)], ['snap', 'canvas', true, true], 'the marker overlay (lane M-B\'s canvas.sxo-fmark): every frame under fast; it exists only then');
  const off = B.evalExpect(mk, { found: 0, rates: [] }, { eff: 120 });
  assert.deepEqual([off.pass, off.skipped], [true, true], 'fast off: the marker is not asked for (no overlay)');
  assert.equal(B.evalExpect(mk, { found: 0, rates: [] }, { eff: 120, fast: true }).pass, false, 'fast on: it must be there');
  // ((SX0) the serum scene's "LFO-driven knob dots" (tol 0.5) left with it; the knob dots of the tutorial and master scenes are below)
  assert.equal(B.EXPECT.master.find(e => e.name === 'OUT meters').tol, 0.4);
  assert.deepEqual(B.EXPECT.tutorial.find(e => e.name === 'Ducker GR bar').rate + '/' + B.EXPECT.tutorial.find(e => e.name === 'Ducker GR bar').tol, 'gr/0.4');
  assert.equal(B.EXPECT.master.find(e => e.name === 'rack GR bars + Ducker position').rate, 'gr');
});

test('(FR Cut B §5.6) parseArgs: --fast on|off (default on), --load, --serve --port N; nonsense rejected', () => {
  const d = B.parseArgs([]);
  assert.deepEqual([d.fast, d.load, d.serve, d.port], [true, false, false, 0]);
  const o = B.parseArgs(['--fast', 'off', '--load', '--serve', '--port', '9123', '--out', 'r.json']);
  assert.deepEqual([o.fast, o.load, o.serve, o.port, o.out, o.errors], [false, true, true, 9123, 'r.json', []]);
  assert.equal(B.parseArgs(['--fast', 'on']).fast, true);
  assert.equal(B.parseArgs(['--fast', 'maybe']).errors.length, 1);
  assert.equal(B.parseArgs(['--port', '80']).errors.length, 1, 'not a privileged port');
  assert.equal(B.parseArgs(['--port', '8817']).errors.length, 1, 'never the preview server\'s port');
});

test('(FR Cut B §7 G7) smoothOf: the probe\'s x per painted frame → moved (the share of frames whose x differs from the previous), cv (the coefficient of variation of |Δx|, wrap frames excluded), pass at moved ≥ 0.9 and cv ≤ 0.3; a 29 Hz probe on a 240 Hz display fails', () => {
  const lin = Array.from({ length: 240 }, (_, i) => (i * 3.1) % 200);
  const s = B.smoothOf(lin);
  assert.deepEqual([s.n, s.moved >= 0.99, s.cv < 0.01, s.wraps >= 3, s.pass], [240, true, true, true, true], JSON.stringify(s));
  const steps = Array.from({ length: 240 }, (_, i) => Math.floor(i * 29 / 240) * 25 % 200); // (a 29 Hz data rate on 240 frames)
  const t = B.smoothOf(steps);
  assert.deepEqual([t.moved < 0.2, t.pass], [true, false], JSON.stringify(t));
  const jit = Array.from({ length: 240 }, (_, i) => (i * 3 + (i % 2 ? 2 : 0)) % 200);
  assert.equal(B.smoothOf(jit).pass, false, 'uneven steps: cv > 0.3 — ' + JSON.stringify(B.smoothOf(jit)));
  const back = Array.from({ length: 120 }, (_, i) => 200 - ((i * 2.5) % 200));
  assert.equal(B.smoothOf(back).pass, true, 'a backward LFO: its own direction');
  assert.deepEqual([B.smoothOf([]).pass, B.smoothOf([NaN, NaN, NaN]).moved], [false, 0]);
});

test('(FR Cut B §7 G8) the --load protocol: loadPlan = 10 cycles of [fast on 5 s, off 5 s] interleaved with A/A [off 5 s, off 5 s]; loadVerdict → Δ (median on − median off), the A/A spread, the gate Δ ≤ max(0.005, 2 × spread)', () => {
  const P = B.loadPlan();
  assert.equal(P.length, 40);
  assert.deepEqual(P.slice(0, 4).map(x => x.arm + ':' + x.fast + ':' + x.ms), ['ab:true:5000', 'ab:false:5000', 'aa:false:5000', 'aa:false:5000']);
  assert.equal(P.filter(x => x.arm === 'ab' && x.fast).length, 10);
  assert.deepEqual(B.loadPlan(2, 1000).map(x => x.arm + ':' + (x.fast ? 1 : 0) + ':' + x.ms + ':' + x.pair), ['ab:1:1000:0', 'ab:0:1000:0', 'aa:0:1000:0', 'aa:0:1000:0', 'ab:1:1000:1', 'ab:0:1000:1', 'aa:0:1000:1', 'aa:0:1000:1']);
  const res = [];
  for (let k = 0; k < 10; k++) res.push({ arm: 'ab', fast: true, pair: k, load: 0.102 + 0.001 * (k % 3) }, { arm: 'ab', fast: false, pair: k, load: 0.1 + 0.001 * (k % 3) }, { arm: 'aa', fast: false, pair: k, load: 0.1 }, { arm: 'aa', fast: false, pair: k, load: 0.1 + 0.0005 * (k % 2) });
  const v = B.loadVerdict(res);
  assert.ok(Math.abs(v.delta - 0.002) < 1e-9 && v.spread >= 0 && v.spread <= 0.0006 && Math.abs(v.limit - 0.005) < 1e-12 && v.pass, JSON.stringify(v));
  const bad = B.loadVerdict(res.map(r => (r.arm === 'ab' && r.fast ? Object.assign({}, r, { load: r.load + 0.01 }) : r)));
  assert.equal(bad.pass, false, JSON.stringify(bad));
});

test('(FR Cut B §5.6) the harness\'s Cut B source: the cells pass --fast through __synthTest.fr.force; the smooth probe hooks arc on the LFO 1 overlay (.gx-lfo canvas.gx-ov); --serve has COOP / COEP and POST /result (≤ 1 MB) → --out; ui-bench.html?fps=1&load=1&post=1 runs the load protocol and posts it', () => {
  const src = readFileSync(new URL('./ui-bench-fps.mjs', import.meta.url), 'utf8');
  assert.ok(/fr\.force\(/.test(src), '__synthTest.fr.force');
  assert.ok(/\.gx-lfo canvas\.gx-ov/.test(src) && /'arc'/.test(src), 'the probe on the LFO overlay\'s arc');
  assert.ok(/POST/.test(src) && /\/result/.test(src) && /1048576|1 << 20/.test(src), 'POST /result, 1 MB');
  assert.ok(/Cross-Origin-Opener-Policy/.test(src) && /Cross-Origin-Embedder-Policy/.test(src));
  assert.ok(/load=1/.test(src) && /post=1/.test(src), 'the device page\'s load / post switches');
  for (const f of ['smoothOf', 'loadPlan', 'loadVerdict', 'smoothProbe', 'loadRun']) assert.equal(typeof B[f], 'function', f);
});

test('evalExpect: each element ≥ tol × the expected rate; found ≥ min; `any` needs min of them; the verdict says why', () => {
  const e = { name: 'x', rate: 'eff' };
  assert.equal(B.evalExpect(e, { found: 2, rates: [118, 119.5] }, { eff: 120 }).pass, true);
  const lo = B.evalExpect(e, { found: 2, rates: [118, 30] }, { eff: 120 });
  assert.deepEqual([lo.pass, lo.limit, lo.expected, lo.min], [false, 96, 120, 30]);
  assert.match(lo.why, /1 of 2 below at ≥ 96 Hz \(min 30/);
  assert.equal(B.evalExpect({ name: 'x', rate: 'eff', any: true }, { found: 2, rates: [118, 30] }, { eff: 120 }).pass, true, 'any: one painting is enough');
  assert.equal(B.evalExpect({ name: 'x', rate: 'eff', any: true, min: 2 }, { found: 2, rates: [118, 30] }, { eff: 120 }).pass, false, 'any with min 2');
  const none = B.evalExpect({ name: 'x', rate: 'eff', min: 5 }, { found: 3, rates: [120, 120, 120] }, { eff: 120 });
  assert.deepEqual([none.pass, none.why], [false, 'found 3 on screen, need 5']);
  assert.equal(B.evalExpect({ name: 'x', rate: 'snap' }, { found: 1, rates: [23.5] }, { eff: 60 }).pass, true, '0.8 × 29 = 23.2');
  assert.equal(B.evalExpect({ name: 'x', rate: 'snap' }, { found: 1, rates: [23] }, { eff: 60 }).pass, false);
  assert.equal(B.evalExpect({ name: 'x', rate: 'eff', tol: 0.5 }, { found: 1, rates: [61] }, { eff: 120 }).pass, true, 'a change-gated writer: tol 0.5');
  assert.equal(B.evalExpect(e, { found: 0, rates: [] }, { eff: 120 }).pass, false, 'an expected display that is not there fails — it does not vanish');
  assert.equal(B.evalExpect({ name: 'x', rate: 'eff', min: 0 }, { found: 0, rates: [] }, { eff: 120 }).pass, true, 'min 0: the OUT scope the camera left off screen is not asked for');
  assert.equal(B.evalExpect({ name: 'x', rate: 'eff', min: 0 }, { found: 1, rates: [10] }, { eff: 120 }).pass, false, 'min 0: but if it is on screen it must paint');
});

test('evalExpect on a display faster than the cap (240 Hz at 120 / 60): a clock-class display above 1.25 × the effective rate is a loop that ignores the cap; the other classes are not judged from above', () => {
  const e = { name: 'x', rate: 'eff' };
  assert.equal(B.evalExpect(e, { found: 1, rates: [119] }, { eff: 120, display: 240 }).pass, true, 'at the cap');
  const hi = B.evalExpect(e, { found: 2, rates: [119, 238] }, { eff: 120, display: 240 });
  assert.deepEqual([hi.pass, hi.over, hi.max], [false, 1, 238]);
  assert.match(hi.why, /1 of 2 above the cap: > 150 Hz on a 240 Hz display \(max 238\)/);
  assert.equal(B.evalExpect(e, { found: 1, rates: [238] }, { eff: 120, display: 120 }).pass, true, 'display = cap: nothing above to judge (the display itself is the limit)');
  assert.equal(B.evalExpect({ name: 'x', rate: 'snap' }, { found: 1, rates: [58] }, { eff: 60, display: 240 }).pass, true, 'a 29 Hz class is not judged from above (a dot written twice a post)');
  assert.equal(B.evalExpect(e, { found: 1, rates: [74] }, { eff: 60, display: 240 }).pass, true, '1.25 × 60 = 75');
  assert.equal(B.evalExpect(e, { found: 1, rates: [76] }, { eff: 60, display: 240 }).pass, false);
});

test('evalExpect (review 2, P3-6a): liveness is judged against min(eff, the frames delivered) — a starved window asks 0.8 × what was delivered, not 0.8 × the clock\'s rate (a display cannot paint on a frame that never came); the cap from above stays against eff', () => {
  const e = { name: 'x', rate: 'eff' };
  const r = B.evalExpect(e, { found: 1, rates: [47] }, { eff: 60, delivered: 48 });
  assert.deepEqual([r.pass, r.expected, r.limit], [true, 48, 38.4]);
  assert.equal(B.evalExpect(e, { found: 1, rates: [47] }, { eff: 60 }).pass, false, 'without `delivered`: against eff, as before');
  assert.equal(B.evalExpect(e, { found: 1, rates: [30] }, { eff: 60, delivered: 48 }).pass, false, 'still a floor');
  assert.equal(B.evalExpect(e, { found: 1, rates: [59] }, { eff: 60, delivered: 59.9 }).pass, true);
  assert.equal(B.evalExpect({ name: 'x', rate: 'snap' }, { found: 1, rates: [21] }, { eff: 60, delivered: 25 }).pass, true, 'snap: min(29, 25) × 0.8 = 20');
  assert.equal(B.evalExpect({ name: 'x', rate: 'snap' }, { found: 1, rates: [21] }, { eff: 60, delivered: 60 }).pass, false);
  assert.equal(B.evalExpect(e, { found: 1, rates: [149] }, { eff: 120, display: 240, delivered: 100 }).pass, true, 'from above: 1.25 × eff (150), not × delivered');
  assert.equal(B.evalExpect(e, { found: 1, rates: [160] }, { eff: 120, display: 240, delivered: 230 }).pass, false);
});

test('the CLIP scene (review 2, P3-6b): the Serum CLIP part\'s roll playhead is expected at the clock\'s rate; clipJumps finds a stale anchor shown (a jump and another within 8 frames — reviewer 2\'s seek: 6.39 → 4.02 → 6.52) and lets a lone wrap or seek through', () => {
  assert.ok(B.SCENE_IDS.includes('clip') && B.EXPECT.clip.some(x => /sx-rollov/.test(x.sel) && x.rate === 'eff'), 'the roll\'s overlay: a clock client (IMPL-FR §3 B6)');
  const roll = B.EXPECT.clip.find(x => /sx-rollov/.test(x.sel));
  // (max: its pixel columns, ≈ 137 a second measured at 240 Hz — at 60 / 120 every frame, at 240 most)
  assert.deepEqual([60, 120, 240].map(eff => B.evalExpect(roll, { found: 1, rates: [0.8 * Math.min(eff, 120) + 0.1] }, { eff, display: eff }).pass), [true, true, true]);
  assert.deepEqual([B.evalExpect(roll, { found: 1, rates: [136.7] }, { eff: 240, display: 240 }).expected, B.evalExpect(roll, { found: 1, rates: [29] }, { eff: 60, display: 60 }).pass], [120, false], 'a 29 Hz playhead (the posted value) fails at every rate');
  assert.equal(B.evalExpect(roll, { found: 1, rates: [238] }, { eff: 120, display: 240 }).pass, false, 'from above: still the cap (1.25 × eff)');
  const run = (vals, dt = 8.333) => vals.map((v, i) => [i * dt, v]);
  const smooth = []; for (let i = 0; i < 60; i++) smooth.push((i * 0.071) % 16);
  assert.deepEqual([B.clipJumps(run(smooth)).glitches.length, B.clipJumps(run(smooth)).moved], [0, 100], 'a clean run, a new playhead every frame (%)');
  const wrap = B.clipJumps(run([15.8, 15.87, 15.94, 0.01, 0.08, 0.15]));
  assert.deepEqual([wrap.jumps.length, wrap.glitches.length], [1, 0], 'a lone wrap');
  const stale = B.clipJumps(run([6.249, 6.345, 6.392, 4.018, 6.516, 6.588, 6.643, 6.428, 6.428]));
  assert.deepEqual([stale.jumps.length, stale.glitches.length], [3, 2], 'reviewer 2\'s seek at b9b8912');
  const held = B.clipJumps(run([6.249, 6.345, 6.392, 6.428, 6.428, 6.428, 6.428]));
  assert.deepEqual([held.jumps.length, held.glitches.length, held.moved], [0, 0, 50], 'a held clip after the seek: still');
  assert.deepEqual(B.clipJumps(run([3, -1, -1, 2])).jumps.length, 0, 'not playing (−1) is no jump');
  assert.equal(typeof B.clipCheck, 'function', 'the page side: the playhead sampled every frame through a seek back');
  const src = readFileSync(new URL('./ui-bench-fps.mjs', import.meta.url), 'utf8');
  assert.ok(/id: 'clip playhead'/.test(src) && /scene === 'clip'/.test(src), 'the driver\'s per-scene check');
});

test('the budgets of G7: 2 / 4 ms per frame at 1 × (every cap), 8 ms at 4 × / 60, 12 ms at 6 × / 60, nothing elsewhere; rate / heap / frames gates at 1 × and at the 60 cap', () => {
  assert.deepEqual([B.costBudget(1, 240).med, B.costBudget(1, 240).p95, B.costBudget(1, 60).med], [2, 4, 2]);
  assert.deepEqual([B.costBudget(4, 60).med, B.costBudget(6, 60).med, B.costBudget(4, 120), B.costBudget(6, 240)], [8, 12, null, null]);
  assert.deepEqual([B.gatedCell(1, 240), B.gatedCell(4, 60), B.gatedCell(6, 60), B.gatedCell(4, 240), B.gatedCell(6, 120)], [true, true, true, false, false]);
  assert.deepEqual([B.BUDGET.rate, B.BUDGET.heapBytesPerS, B.BUDGET.layoutStyleMsPerS], [0.8, 1048576, 1]);
});

test('evalCell: a clean cell passes; cost over budget fails; a throttled cell above the 60 cap is recorded, never gated; heap / frames / errors / the clock\'s display fail when gated', () => {
  const ok = B.evalCell(cell());
  assert.deepEqual([ok.pass, ok.gates.filter(g => g.gated && !g.pass).length], [true, 0]);
  assert.deepEqual(['cost.med', 'cost.p95', 'layout+style', 'heap', 'frames', 'clock.display', 'clock.eff', 'errors'].map(id => !!gate(ok, id)), Array(8).fill(true));
  const slow = B.evalCell(cell({ frameCost: { med: 2.4, p95: 3, max: 6 } }));
  assert.deepEqual([slow.pass, gate(slow, 'cost.med').pass, gate(slow, 'cost.p95').pass], [false, false, true]);
  const p95 = B.evalCell(cell({ frameCost: { med: 1, p95: 4.5, max: 9 } }));
  assert.deepEqual([p95.pass, gate(p95, 'cost.p95').pass], [false, false]);
  const t4 = B.evalCell(cell({ throttle: 4, cap: 60, display: 60, frameCost: { med: 7.9, p95: 20, max: 40 }, clock: { measured: true, display: 60, eff: 60, expectEff: 60 }, frames: { delivered: 60 } }));
  assert.deepEqual([t4.pass, gate(t4, 'cost.med').limit], [true, 8], '4 ×, Medium (60): med ≤ 8, no p95 budget');
  assert.equal(B.evalCell(cell({ throttle: 4, cap: 60, display: 60, frameCost: { med: 8.1, p95: 9, max: 9 }, clock: { measured: false }, frames: { delivered: 60 } })).pass, false);
  const t6 = B.evalCell(cell({ throttle: 6, cap: 240, frameCost: { med: 30, p95: 60, max: 90 }, frames: { delivered: 90 }, heapBytesPerS: 5e6, expect: [{ name: 'a', pass: false, found: 1, min: 3, limit: 96, expected: 120, why: 'slow' }] }));
  assert.deepEqual([t6.pass, gate(t6, 'cost.med').gated, gate(t6, 'frames').gated, gate(t6, 'heap').gated, gate(t6, 'live: a').gated], [true, false, false, false, false], '6 × at cap 240: all recorded');
  assert.equal(B.evalCell(cell({ heapBytesPerS: 2e6 })).pass, false, 'heap > 1 MB / s');
  assert.equal(B.evalCell(cell({ frames: { delivered: 150 } })).pass, false, 'frames delivered < 0.8 × the display');
  assert.equal(B.evalCell(cell({ errors: ['console.error: boom'] })).pass, false, 'a console error');
  assert.equal(B.evalCell(cell({ clock: { measured: true, display: 60, eff: 60, expectEff: 240 } })).pass, false, 'the clock read 60 on a 240 Hz display');
  assert.equal(B.evalCell(cell({ clock: { measured: false, display: 1000, eff: 142 } })).pass, true, 'a scene with no clock client leaves it unmeasured: nothing to judge');
  const live = B.evalCell(cell({ expect: [{ name: 'OUT scope', pass: false, found: 1, min: 30, limit: 192, expected: 240, why: '1 of 1 below' }] }));
  assert.deepEqual([live.pass, gate(live, 'live: OUT scope').note], [false, '1 of 1 below']);
});

test('the layout + style budget: gated at 1 × on the scenes in LAYOUT_SCENES (idle) — the playing ones record it —, or on every scene with layoutGate', () => {
  assert.deepEqual(B.LAYOUT_SCENES.slice(), ['idle']);
  const bad = { cdp: { layoutMs: 0.9, styleMs: 0.4 } };
  assert.equal(B.evalCell(cell(Object.assign({ scene: 'idle' }, bad))).pass, false, 'idle: 1.3 ms / s');
  const play = B.evalCell(cell(Object.assign({ scene: 'tutorial' }, bad)));
  assert.deepEqual([play.pass, gate(play, 'layout+style').gated, gate(play, 'layout+style').value], [true, false, 1.3]);
  assert.equal(B.evalCell(cell(Object.assign({ scene: 'tutorial', layoutGate: true }, bad))).pass, false, '--layout-gate all');
  assert.equal(B.evalCell(cell({ scene: 'idle', layoutGate: false, cdp: { layoutMs: 5, styleMs: 5 } })).pass, true, '--layout-gate none');
  assert.equal(B.evalCell(cell({ scene: 'idle', throttle: 4, cap: 60, display: 60, cdp: { layoutMs: 5, styleMs: 5 }, frameCost: { med: 1 }, frames: { delivered: 60 }, clock: { measured: false } })).pass, true, 'never gated under throttle');
  assert.equal(gate(B.evalCell(cell({ cdp: null })), 'layout+style'), undefined, 'a device run has no CDP: no layout gate');
});

test('SOFT_GATES: the two a stalled window or one slow layout can fail alone (the driver measures such a cell once more); nothing that is a real cost or liveness failure', () => {
  assert.deepEqual(B.SOFT_GATES.slice(), ['frames', 'layout+style']);
  const gates = B.evalCell(cell({ frames: { delivered: 150 }, cdp: { layoutMs: 2, styleMs: 0 }, scene: 'idle', frameCost: { med: 3, p95: 3, max: 3 } })).gates.filter(g => g.gated && !g.pass).map(g => g.id);
  assert.deepEqual(gates.slice().sort(), ['cost.med', 'frames', 'layout+style']);
  assert.deepEqual(gates.filter(id => B.SOFT_GATES.includes(id)).sort(), ['frames', 'layout+style'], 'the soft ones among them; cost.med is not re-rolled');
  assert.ok(!B.SOFT_GATES.includes('cost.med') && !B.SOFT_GATES.includes('heap') && !B.SOFT_GATES.includes('errors'));
});

test('compareReports: full reports or bench rows, per cell the cost / layout / live / gate verdicts; the noise margins (NOISE); a live display that stopped; missing cells', () => {
  const mk = (cells, build) => ({ build, cells });
  const c = (o = {}) => { const x = cell(o); const v = B.evalCell(x); x.pass = v.pass; x.gates = v.gates; return x; };
  const base = mk([c({ scene: 'master', expect: [{ name: 'OUT scope', pass: false, found: 1, min: 30, limit: 192, expected: 240, why: 'low' }, { name: 'meters', pass: true, found: 1, min: 29, limit: 23, expected: 29 }] }), c({ scene: 'idle', cap: 60, display: 60, clock: { measured: false }, frames: { delivered: 60 } })], 'aaa');
  const cur = mk([c({ scene: 'master', expect: [{ name: 'OUT scope', pass: true, found: 1, min: 230, limit: 192, expected: 240 }, { name: 'meters', pass: false, found: 1, min: 0, limit: 23, expected: 29, why: 'dead' }], frameCost: { med: 0.2, p95: 0.6, max: 2 } })], 'bbb');
  const r = B.compareReports(base, cur);
  assert.equal(r.rows.length, 1);
  assert.ok(r.better.some(t => /live: OUT scope now as expected/.test(t)) && r.better.some(t => /cost med 0.4 → 0.2/.test(t)), r.better.join('|'));
  assert.ok(r.worse.some(t => /live: meters no longer as expected/.test(t)) && r.pass === false, r.worse.join('|'));
  assert.deepEqual(r.missing, ['d/idle/1x/60: not in the new report']);
  const same = B.compareReports(base, base);
  assert.deepEqual([same.worse.length, same.better.length, same.pass], [0, 0, true], 'a report against itself');
  assert.deepEqual(B.compareReports(B.benchRow(base), B.benchRow(base)).rows.length, 2, 'bench rows compare as well (tests/bench.json\'s "ui-fps-mac" is one)');
  assert.equal(B.compareReports(B.benchRow(base), cur).worse.length, r.worse.length, 'a row against a full report: the same verdicts');
  const slow = B.compareReports(mk([c()]), mk([c({ frameCost: { med: 0.7, p95: 2.2, max: 3 }, cdp: { layoutMs: 12, styleMs: 0 } })]));
  assert.ok(slow.worse.some(t => /cost med 0.4 → 0.7/.test(t)) && slow.worse.some(t => /cost p95 1.2 → 2.2/.test(t)) && slow.worse.some(t => /layout\+style 0.3 → 12 ms\/s/.test(t)), slow.worse.join('|'));
  assert.equal(B.compareReports(mk([c()]), mk([c({ frameCost: { med: 0.49, p95: 1.7, max: 3 }, cdp: { layoutMs: 8, styleMs: 0 } })])).pass, true, 'within the noise of a cell between runs of one build (NOISE: ≤ 0.1 ms median, 0.5 p95, 8 ms / s)');
  const idle = B.compareReports(mk([c({ scene: 'idle' })]), mk([c({ scene: 'idle', cdp: { layoutMs: 2.5, styleMs: 0 } })]));
  assert.ok(idle.worse.some(t => /layout\+style 0.3 → 2.5/.test(t)), 'idle: 1.5 ms / s of noise, not 8: ' + idle.worse.join('|'));
  const th = (m, p, l) => mk([c({ throttle: 4, cap: 60, display: 60, frameCost: { med: m, p95: p, max: 9 }, cdp: { layoutMs: l, styleMs: 0 }, clock: { measured: false }, frames: { delivered: 60 } })]);
  assert.equal(B.compareReports(th(0.25, 1, 20), th(0.98, 1.6, 73)).pass, true, 'a throttled cell: ×4 on the median between two runs of one build (4 × / 120, play8) is the throttle\'s slices, not a regression');
  assert.equal(B.compareReports(th(0.25, 1, 20), th(4, 1, 20)).pass, false, '… but 4 ms is');
  assert.deepEqual([Object.keys(B.NOISE), B.NOISE.one.med, B.NOISE.thr.med], [['one', 'thr'], [0.25, 0.1], [1.5, 1]]);
  assert.equal(B.compareReports(mk([c()]), mk([c({ frameCost: { med: 0.7, p95: 1.2, max: 3 } })]), { noise: 3 }).pass, true, '`noise` scales the margins');
  const gate = B.compareReports(mk([c()]), mk([c({ frames: { delivered: 100 } })]));
  assert.deepEqual(gate.worse, ['d/tutorial/1x/240 · gate frames now fails'], 'a gate that passed and fails');
  assert.deepEqual(B.compareReports(mk([c({ frames: { delivered: 100 } })]), mk([c()])).better, ['d/tutorial/1x/240 · gate frames now passes']);
  const cross = B.compareReports(mk([c({ cap: 120, display: 240 })]), mk([c({ cap: 120, display: 240, frameCost: { med: 1, p95: 2, max: 3 } })]));
  assert.ok(/d\/tutorial\/1x\/120@240 · cost med/.test(cross.worse[0]), 'a cap on a faster display is its own cell: ' + cross.worse[0]);
  assert.equal(B.parseArgs(['--compare', 'a.json', 'b.json']).compare.join(), 'a.json,b.json');
  assert.equal(B.parseArgs(['--compare', 'bench', 'cur.json']).compare.join(), 'bench,cur.json');
  assert.equal(B.parseArgs(['--compare', 'a.json']).errors.length, 1);
});

test('metricsDelta: CDP Performance.getMetrics (seconds, cumulative) → ms / s and counts / s over the Timestamp delta', () => {
  const m = (t, s, l, r, k, lc, rc) => [{ name: 'Timestamp', value: t }, { name: 'ScriptDuration', value: s }, { name: 'LayoutDuration', value: l }, { name: 'RecalcStyleDuration', value: r }, { name: 'TaskDuration', value: k }, { name: 'LayoutCount', value: lc }, { name: 'RecalcStyleCount', value: rc }, { name: 'JSHeapUsedSize', value: 5e6 }];
  assert.deepEqual(B.metricsDelta(m(100, 1, 0.5, 0.25, 2, 10, 20), m(104, 1.8, 0.504, 0.254, 3.2, 90, 100)), { s: 4, scriptMs: 200, layoutMs: 1, styleMs: 1, taskMs: 300, layouts: 20, styles: 20 });
  assert.equal(B.metricsDelta(m(100, 0, 0, 0, 0, 0, 0), m(100, 1, 1, 1, 1, 1, 1)).scriptMs, 0, 'no time passed: zeros');
  assert.equal(B.metricsDelta([], null).s, 0);
});

test('matrix: sizes × scenes × throttles × caps (throttle outer, the display = the cap unless --display); parseArgs reads the CLI and rejects nonsense', () => {
  const m = B.matrix({ sizes: ['d', 'l'], scenes: ['idle', 'mods'], caps: [60, 240], throttles: [1, 6], cross: false }); // ((SX0) two scenes: the serum one went
  assert.equal(m.length, 2 * 2 * 2 * 2);
  assert.deepEqual(m.slice(0, 4).map(c => c.throttle + '/' + c.cap + '/' + c.display), ['1/60/60', '1/240/240', '6/60/60', '6/240/240']);
  assert.deepEqual(B.matrix({ caps: [60], throttles: [1], scenes: ['idle'], display: 240 }), [{ size: 'd', scene: 'idle', throttle: 1, cap: 60, display: 240 }], 'a forced display: no cross cells');
  const x = B.matrix({ caps: [60, 120], throttles: [1, 4], scenes: ['idle'] });
  assert.deepEqual(x.map(c => c.throttle + '/' + c.cap + '/' + c.display), ['1/60/60', '1/120/120', '1/120/240', '1/60/240', '4/60/60', '4/120/120'], 'the cross cells (a 240 Hz display under the caps 120 and 60) follow the 1 × group, never under throttle');
  assert.equal(B.matrix({ throttles: [4, 6], scenes: ['idle'] }).length, 6, 'no 1 × in the throttles: no cross cells');
  assert.equal(B.matrix().length, 1 * 9 * (3 * 3 + 2), 'the defaults: the Mac window, 9 scenes (review 2: + clip; MOD1: + mods; SX0: − serum; LC: + comb), 3 throttles × 3 caps + 2 cross cells');
  const o = B.parseArgs(['--scenes', 'idle,master', '--sizes', 'd,p', '--caps', '60,144', '--throttle', '1,6', '--display', '240', '--warm', '1000', '--measure', '2500', '--out', 'r.json', '--no-gate', '--no-cross', '--layout-gate', 'all', '--list', '--quiet']);
  assert.deepEqual([o.scenes, o.sizes, o.caps, o.throttles, o.display, o.warm, o.measure, o.out, o.gate, o.cross, o.layoutGate, o.list, o.quiet, o.errors], [['idle', 'master'], ['d', 'p'], [60, 144], [1, 6], 240, 1000, 2500, 'r.json', false, false, 'all', true, true, []]);
  const d = B.parseArgs([]);
  assert.deepEqual([d.sizes, d.caps, d.throttles, d.scenes.length, d.gate, d.cross, d.layoutGate, d.warm >= 3000, d.measure >= 3000], [['d'], [60, 120, 240], [1, 4, 6], 9, true, true, 'idle', true, true]); // ((SX0) 8 scenes; (LC G6) + comb: 9
  assert.equal(B.parseArgs(['--scenes', 'nope']).errors.length, 1);
  assert.equal(B.parseArgs(['--sizes', 'x']).errors.length, 1);
  assert.equal(B.parseArgs(['--caps', '5']).errors.length, 1);
  assert.equal(B.parseArgs(['--warm', '1']).errors.length, 1);
  assert.equal(B.parseArgs(['--layout-gate', 'maybe']).errors.length, 1);
});

test('the expected-live lists: every scene has one, entries are well formed (kind, selector, a known rate class, a name once), the sizes / caps / scenes are the contract\'s', () => {
  assert.deepEqual(B.SCENE_IDS.slice(), ['idle', 'play8', 'roll8', 'tutorial', 'mods', 'master', 'busy', 'clip', 'comb']); // ((MOD1 G6) + mods: a Juno's modulators; (SX0) the serum scene went with Serum complete (ROADMAP 28); (LC G6) + comb: two Combiners
  assert.deepEqual([B.CAPS.slice(), B.THROTTLES.slice(), Object.keys(B.SIZES)], [[60, 120, 240], [1, 4, 6], ['d', 'l', 'p']]);
  assert.deepEqual(['d', 'l', 'p'].map(k => [B.SIZES[k].w, B.SIZES[k].h, B.SIZES[k].dpr, B.SIZES[k].touch]), [[1440, 900, 2, false], [1366, 1024, 2, true], [1024, 1366, 2, true]]);
  for (const id of B.SCENE_IDS) {
    const list = B.EXPECT[id];
    assert.ok(Array.isArray(list), id + ': a list');
    assert.equal(new Set(list.map(e => e.name)).size, list.length, id + ': names are unique');
    for (const e of list) {
      assert.ok(['canvas', 'attr'].includes(e.kind), id + ' / ' + e.name + ': kind');
      assert.ok(typeof e.sel === 'string' && e.sel.length > 3, id + ' / ' + e.name + ': a selector');
      assert.ok(['eff', 'snap', 'gr', 'heavy', 'curve'].includes(e.rate) || e.rate > 0, id + ' / ' + e.name + ': a rate class'); // ((FR Cut B §5.6) + curve: the filter display's curve
      if (e.kind === 'attr') assert.ok(typeof e.attr === 'string', id + ' / ' + e.name + ': the attribute whose writes count');
      assert.ok(e.tol == null || (e.tol > 0 && e.tol <= 1), id + ' / ' + e.name + ': tol');
      assert.ok(e.box == null || (typeof e.box === 'string' && e.kind === 'attr'), id + ' / ' + e.name + ': a box (the ancestor that says "on screen") only for the attribute writers');
      assert.ok(e.min == null || e.min >= 0, id + ' / ' + e.name + ': min');
      assert.ok(e.max == null || e.max > 0, id + ' / ' + e.name + ': max');
    }
  }
  assert.ok(B.EXPECT.master.some(e => e.sel === 'canvas.mo-sc' && e.rate === 'eff'), 'the master scope is expected at the clock\'s rate (Cut A: 30 → eff)');
  assert.ok(B.EXPECT.tutorial.some(e => /sx-disp/.test(e.sel) && e.rate === 'heavy'), 'the 3D wavetable display is a heavy display');
  assert.ok(B.EXPECT.tutorial.some(e => e.rate === 'gr'), 'the GR loop: 30'); // ((SX0) the tutorial's Ducker GR where the serum scene's compressor was
  assert.ok(['tutorial', 'master'].every(id => B.EXPECT[id].some(e => e.kind === 'attr' && e.attr === 'cx' && e.box === '[data-dest]')), 'the knob dots are judged by their knob\'s box (a dot is hidden between notes)');
  assert.equal(B.EXPECT.busy.find(e => e.name === 'OUT scope').min, 0, 'busy: the portrait fit leaves the OUT module off screen: not asked for when it is');
  assert.deepEqual(B.EXPECT.idle.slice(), [], 'idle: the floor — nothing to animate');
});

test('(MOD1 G6, lane H) the mods scene: a Juno with 4 LFOs, 2 Envelopes, 1 Macros, a CC, a Chaos and the wheel (two rows, framed) — every LFO cabled onto a Juno knob, the Envelopes too — playing; its expected-live list: the six LFO / Envelope faces\' playheads (the donors\' .gx-lfo / .gx-env overlays) at the snapshot rate; the smooth probe (the arc hook on the first LFO overlay) at 120 and 240 as the tutorial\'s', () => {
  assert.ok(B.SCENE_IDS.includes('mods') && Array.isArray(B.EXPECT.mods));
  const ph = B.EXPECT.mods.find(e => e.name === 'LFO / ENV playheads');
  assert.deepEqual(ph && [B.EXPECT.mods.length, ph.kind, ph.rate, ph.min, /\.gx-lfo canvas\.gx-ov/.test(ph.sel), /\.gx-env canvas\.gx-ov/.test(ph.sel)], [1, 'canvas', 'snap', 6, true, true], 'the six faces\' playheads (the camera frames the modulators: the OUT off screen)');
  const src = readFileSync(new URL('./ui-bench-fps.mjs', import.meta.url), 'utf8'), at = src.indexOf('async mods(A)'), body = src.slice(at, src.indexOf('\n  },', at));
  assert.ok(at > 0, 'BUILD.mods');
  assert.ok(/srcPick\('juno60', 'track'\)/.test(body), 'a Juno, made as the user makes it');
  for (const k of ['lfo', 'env', 'macro', 'cc', 'chaos', 'wheel']) assert.ok(new RegExp("'" + k + "'").test(body), k);
  assert.ok(/mod\.connect\(/.test(body) && /startPlay\(A\)/.test(body) && /clipToTrack/.test(body), 'cabled and playing');
  assert.ok(/scene === 'tutorial' \|\| scene === 'mods'/.test(src.slice(src.indexOf('the smooth probe at 120 and 240') - 200)), 'the smooth probe runs on the mods scene too');
  assert.deepEqual(['serum' in B.EXPECT, B.SCENE_IDS.includes('serum'), /async serum\(A\)/.test(src)], [false, false, false], '(SX0) the serum scene went with Serum complete (ROADMAP 28): the mods scene is the modulators\' one');
});

test('(LC G6) the comb scene: a Juno with 8 track LFOs (GLOBAL, FREE: BPM-anchored and Hz, one SMOOTHed) into 2 Combiners × 4 (Add, Multiply), each OUT on a Juno knob, framed with the Juno, playing at 128 BPM; its expected-live list: the two faces\' overlays at the clock\'s rate; combProbe (per-frame work, the overlay moving, a recompute, an amount move, ■ / ⏻ idle) at 1 × and 6 ×', () => {
  assert.ok(B.SCENE_IDS.includes('comb') && Array.isArray(B.EXPECT.comb));
  const ov = B.EXPECT.comb.find(e => e.name === 'Combiner overlays');
  assert.deepEqual(ov && [B.EXPECT.comb.length, ov.kind, ov.rate, ov.min, /canvas\.rig-cov/.test(ov.sel), /rig-ccv/.test(ov.sel)], [1, 'canvas', 'eff', 2, true, false], 'the overlays (lc-view paintOverlay: a new playhead x every painted frame), never the curves (on a change only)');
  const src = readFileSync(new URL('./ui-bench-fps.mjs', import.meta.url), 'utf8'), at = src.indexOf('async comb(A)'), body = src.slice(at, src.indexOf('\n  },', at));
  assert.ok(at > 0, 'BUILD.comb');
  assert.ok(/srcPick\('juno60', 'track'\)/.test(body) && /mod\.add\('lfo'/.test(body) && /mod\.add\('comb'/.test(body), 'a Juno, its LFOs and Combiners, made as the user makes them');
  assert.ok(/connect\(l \+ '\.out', x \+ ':in'\)/.test(body) && /connect\(x \+ '\.out', dev \+ ':'/.test(body), 'the LFOs onto IN, each OUT onto a Juno knob');
  assert.ok(/mono: 1/.test(body) && /mode: 'free'/.test(body) && /smooth: 0\.3/.test(body) && /anchor/.test(body) && /mode: 'mul'/.test(body), 'GLOBAL FREE inputs, anchored and not, one SMOOTHed; both modes');
  assert.ok(/setProjectBpm\(128\)/.test(body) && /startPlay\(A\)/.test(body) && /fit\(\{ ids: X\.concat\(dev\)/.test(body), 'playing at 128 BPM, the combiners and the Juno framed');
  assert.equal(typeof B.combProbe, 'function');
  const drv = src.slice(src.indexOf("if (scene === 'comb') {"));
  assert.ok(/for \(const th of \[1, 6\]\)/.test(drv) && /id: 'comb probe '/.test(drv) && /id: 'comb stopped'/.test(drv) && /combProbe\(window, \{ stop: true/.test(drv), 'the probe at 1 × and 6 ×, then the stopped check');
  for (const k of ['frame med ≤ 0.1 ms', 'overlay moved ≥ 0.98', 'recompute med ≤ 4 ms', 'window edit ≤ 4 ms', 'amount move re-combine med ≤ 0.5 ms']) assert.ok(drv.includes(k), 'G6: ' + k);
});

test('summarize / benchRow / auditScene on a synthetic report', () => {
  const c1 = Object.assign(cell({ scene: 'master', cap: 240 }), { size: 'd', clock: { measured: true, display: 240, eff: 240, expectEff: 240 }, expect: [{ name: 'OUT scope', pass: false, found: 1, min: 30, limit: 192, expected: 240, why: '1 of 1 below' }] });
  const v1 = B.evalCell(c1); c1.pass = v1.pass; c1.gates = v1.gates;
  const c2 = Object.assign(cell({ scene: 'idle', cap: 60, display: 60, frames: { delivered: 60 }, clock: { measured: false } }), { size: 'd' });
  const v2 = B.evalCell(c2); c2.pass = v2.pass; c2.gates = v2.gates;
  const c3 = Object.assign(cell({ scene: 'master', cap: 120, display: 240, frameCost: { med: 0.3, p95: 0.9, max: 2 } }), { size: 'd', clock: { measured: true, display: 240, eff: 120, expectEff: 120 }, expect: [{ name: 'OUT scope', pass: false, found: 1, min: 240, limit: 96, expected: 120, why: 'above the cap' }] });
  const v3 = B.evalCell(c3); c3.pass = v3.pass; c3.gates = v3.gates;
  const rep = { when: '2026-10-27T10:00:00Z', build: 'abc1234', machine: 'M4', cells: [c1, c2, c3], checks: [{ id: 'gear fits', size: 'l', pass: false, note: 'clipped' }], aborted: ['d/serum: timeout'] };
  const L = B.summarize(rep);
  assert.equal(L.filter(x => /^d /.test(x)).length, 3);
  assert.ok(L.some(x => /live: OUT scope.*1 of 1 below/.test(x)) && L.some(x => /check gear fits/.test(x)) && L.some(x => /ABORTED d\/serum/.test(x)), L.join('\n'));
  const row = B.benchRow(rep, { about: 'x' });
  assert.deepEqual([row.date, row.build, row.about, row.cols.length, row.cols[7]], ['2026-10-27', 'abc1234', 'x', 8, 'gatesFailed']);
  assert.deepEqual(row.cells['d/master/1x'][240], [0.4, 1.2, 0.3, 39, 240, 1, 240, 'live'], 'the last column: the gated checks that failed (every live one as "live")');
  assert.deepEqual(row.cells['d/master/1x']['120@240'], [0.3, 0.9, 0.3, 39, 240, 1, 120, 'live'], 'a cap on a faster display is its own column: it never overwrites the display = cap one');
  assert.deepEqual(Object.keys(row.cells['d/master/1x']).sort(), ['120@240', '240']);
  assert.deepEqual(row.liveFailed, { 'd/master/1x/240': ['OUT scope'], 'd/master/1x/120@240': ['OUT scope'] });
  assert.deepEqual([B.auditScene({ clients: [7, 7, 7], callbacks: [2, 2, 2] }).pass, B.auditScene({ clients: [7, 8], callbacks: [2, 2] }).pass, B.auditScene({ clients: [7, 7], callbacks: [2, 4] }).pass, B.auditScene({}).pass], [true, false, false, true]);
  assert.match(B.auditScene({ clients: [7, 9], callbacks: [2, 2] }).note, /GREW/);
});

test('the hooks are one self-contained function (they are stringified into the page before its scripts) and install into a fake window', () => {
  const src = B.hooksScript({ x: 1 });
  assert.match(src, /^window\.__synthTest = window\.__synthTest \|\| \{\};/);
  assert.ok(src.includes('function installHooks(win, o)') && src.endsWith('(window, {"x":1});'));
  // self-contained: it parses and runs with nothing but `win` (a stub window with the pieces it reads)
  const mk = () => {
    const proto = { x: 0 }, w = { performance: { now: () => 5, timeOrigin: 0 }, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, console: { error() {} }, addEventListener() {}, document: {}, MutationObserver: class { observe() {} disconnect() {} },
      MessagePort: function () {}, CanvasRenderingContext2D: function () {}, Worker: undefined, SharedArrayBuffer: undefined, WeakRef };
    w.MessagePort.prototype = proto; Object.defineProperty(proto, 'onmessage', { configurable: true, get() { return this._f; }, set(f) { this._f = f; } });
    w.CanvasRenderingContext2D.prototype.clearRect = function () {}; w.CanvasRenderingContext2D.prototype.fillRect = function () {};
    return w;
  };
  const w = mk(), F = B.installHooks(w, { y: 2 });
  assert.equal(w.__fps, F);
  assert.equal(B.installHooks(w), F, 'idempotent');
  assert.deepEqual([F.vsOk, F.on, F.hz, F.opt], [false, false, 0, { y: 2 }]);
  assert.equal(F.setHz(120), false, 'no SharedArrayBuffer: no virtual display (the browser\'s own frames)');
  assert.equal(F.setHz(0), true);
  const id = w.requestAnimationFrame(() => {}); assert.equal(typeof id, 'number', 'the wrapped requestAnimationFrame returns an id');
  // the canvas hooks count paints per canvas once per frame, only while recording
  const cv = {}, ctx = new w.CanvasRenderingContext2D(); ctx.canvas = cv;
  ctx.clearRect(0, 0, 1, 1);
  assert.deepEqual(F.cv(cv), { n: 0, ops: 0 }, 'not recording: not counted');
  F.begin(); ctx.clearRect(0, 0, 1, 1); ctx.fillRect(0, 0, 1, 1);
  assert.deepEqual(F.cv(cv), { n: 1, ops: 2 }, 'two ops in one frame = one painted frame');
  const d = F.end();
  assert.deepEqual([d.delivered, d.missed, d.raf.length, Object.keys(d.byType).length], [0, 0, 0, 0]);
  // a worklet port's onmessage is wrapped: its time is counted, the original comes back from the getter
  const port = new w.MessagePort(), h = e => e;
  port.onmessage = h;
  assert.equal(port.onmessage, h, 'the getter returns the app\'s own function');
  F.begin(); port._f({ data: { t: 'smon' } }); const d2 = F.end();
  assert.deepEqual([d2.msgN, Object.keys(d2.byType)], [1, ['smon']]);
});

test('(FR Cut B review 2, the lead\'s P2-3) the device protocol runs in the app\'s own top-level page, never a srcdoc / iframe: main.js under ?fpsdev=1 imports the harness and calls devBoot(window) before its store opens; ui-bench.html?fps=1 (main) is the launcher; devUrl keeps the protocol\'s query (never ?fps=, cv-world\'s frame-rate setting) and steps i', () => {
  for (const f of ['devBoot', 'devRun', 'devUrl', 'main']) assert.equal(typeof B[f], 'function', f);
  const M = readFileSync(new URL('../main.js', import.meta.url), 'utf8'), gate = M.indexOf("/[?&]fpsdev=1(?:&|$)/.test("), store = M.indexOf('await openAppStore(');
  assert.ok(gate > 0 && store > gate, 'the ?fpsdev=1 gate before the store opens');
  const G = M.slice(gate, store);
  assert.ok(/globalThis\.__synthTest = globalThis\.__synthTest \|\| \{\}/.test(G) && /tests\/ui-bench-fps\.mjs/.test(G) && /\.devBoot\(window\)/.test(G), 'the test hooks object, the harness, devBoot(window)');
  assert.equal(B.devUrl('http://h:1/index.html', '?fps=1&scenes=tutorial,master&load=1&post=1&x=9&cycles=3&auto=1', 0), 'http://h:1/index.html?fpsdev=1&scenes=tutorial%2Cmaster&load=1&post=1&cycles=3&auto=1&i=0');
  assert.equal(B.devUrl('http://h:1/index.html?fpsdev=1&scenes=idle&i=0', '?fpsdev=1&scenes=idle&i=0', 1), 'http://h:1/index.html?fpsdev=1&scenes=idle&i=1', 'step to step on the app page');
  const src = readFileSync(new URL('./ui-bench-fps.mjs', import.meta.url), 'utf8'), dev = src.slice(src.indexOf('on a device: index.html?fpsdev=1'), src.indexOf('the driver (node)'));
  assert.ok(dev.length > 2000 && !/srcdoc|<iframe|mountFrame|contentWindow/.test(dev.replace(/never in a\s*(?:\/\/\s*)?srcdoc or an iframe|in a srcdoc or an iframe|a srcdoc \/ iframe/g, '')), 'the device section: no frame');
  assert.ok(/location\.replace\(devUrl\(/.test(dev) && /sessionStorage/.test(dev) && /powerOn/.test(dev), 'one scene a page load, the report carried, the audio started (a tap where WebKit wants one)');
  // &fast: off | on (the preset's rate — 0 in WebKit, where the lane ships off) | a rate forced (G8i: &fast=60 measures the lane WebKit would run)
  assert.deepEqual(['off', 'on', null, '', '60', '120', '0', 'x'].map(B.devFast), [false, true, true, true, 60, 120, true, true]);
  assert.ok(/fr\.force\(cfg\.fast === false \? 0 : typeof cfg\.fast === 'number' \? cfg\.fast : null\)/.test(src), 'prepare forces a numeric rate');
  assert.ok(/fr\.force\(ph\.fast \? on : 0\)/.test(src), 'loadRun\'s on arm at the rate asked');
});

test('the page module: imports with no DOM and no node (its work only in buildScene / prepare / begin / finish / gearCheck / main and the driver), ui-bench.html routes ?fps=1 to it, ?run=1 does not start the 1h bench with it', () => {
  for (const f of ['buildScene', 'prepare', 'begin', 'finish', 'gearCheck', 'main', 'drive', 'appOf', 'installHooks']) assert.equal(typeof B[f], 'function', f);
  const html = readFileSync(new URL('./ui-bench.html', import.meta.url), 'utf8');
  assert.match(html, /const FPS = !M3 && !M9 && !WC && \/\[\?&\]fps=1\/\.test\(location\.search\)/);
  assert.match(html, /import\('\.\/ui-bench-fps\.mjs\?t=' \+ Date\.now\(\)\)\.then\(m => m\.main\(\)/);
  assert.match(html, /!FPS && !M3 && !M9 && !WC\) \$\('#run'\)\.click\(\)/);
  assert.match(html, /!M3 && !M9 && !WC\) \$\('#run'\)\.click\(\)/, 'ui-bench-wc.test\'s pin still holds');
  const src = readFileSync(new URL('./ui-bench-fps.mjs', import.meta.url), 'utf8');
  // ((FR Cut B review 2, the lead's P2-3) the device protocol runs in the app's own top-level page: no frame at all — below)
  assert.equal(/\.srcdoc\s*=|<iframe|mountFrame\(/.test(src), false, 'no srcdoc, no iframe, no mounted frame');
  assert.ok(/id: 'build errors'/.test(src) && /id: 'gear fits'/.test(src) && /id: 'clients audit'/.test(src), 'the per-scene checks: build errors, the ⚙ popover, the clients audit');
  assert.ok(/x\.id === 'gear fits' && x\.size === sk/.test(src), 'the ⚙ check once per size, whatever other checks came first');
  assert.equal(/8817/.test(src.replace(/never 8817|never port 8817/g, '')), false, 'never the preview server\'s port');
  assert.ok(/Browser\.setDownloadBehavior/.test(src) && /behavior: 'deny'/.test(src), 'downloads denied in every session');
  assert.ok(/--user-data-dir=/.test(src) && /Google Chrome for Testing/.test(src) && !/\/Applications\/Google Chrome\.app/.test(src.replace(/never the user's[^\n]*/g, '')), 'Chrome for Testing with its own profile, never the user\'s Chrome');
});
