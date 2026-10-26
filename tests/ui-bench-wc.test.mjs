import './v8-guard.mjs';
// tests/ui-bench-wc.mjs's pure part (stage WC, IMPL-WC G7; lane C): the frame statistics, the burst analysis and IMPL-3 §1.5's P / P+
// verdict on synthetic recordings; §9's full rig as data (the module counts, 8 canvas mod cords); the page module imports with no DOM
// (its DOM work only inside main()); tests/ui-bench.html routes ?wc=1 to it.
// Run alone: node --max-old-space-size=2048 --test tests/ui-bench-wc.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as B from './ui-bench-wc.mjs';

const rec = (dts, bursts) => { // frames every dt (ms) from t 0; bursts [[s, e]] → movestart / cameraend events
  const R = { f: [], ev: [] };
  let t = 0;
  for (const dt of dts) { t += dt; R.f.push(dt, t); }
  for (const [s, e] of bursts) R.ev.push(1, s, 2, e);
  return R;
};

test('q: n, median, p95, max, frames over 33 ms; not-numbers dropped', () => {
  assert.deepEqual(B.q([16.7, 16.6, 16.8, 40, 'x', NaN, 16.7]), { n: 5, med: 16.7, p95: 40, max: 40, over33: 1 });
  assert.deepEqual(B.q([]), { n: 0, med: 0, p95: 0, max: 0, over33: 0 });
});

test('analyse: burst frames (movestart … cameraend), the first 100 ms of each (firstMove), 800 ms after (settle), the rest; within a window', () => {
  const R = rec(Array(120).fill(16.7), [[500, 1500]]);
  const x = B.analyse(R);
  assert.equal(x.bursts, 1);
  assert.equal(x.first.n, 6, 'the first 100 ms: 6 frames');
  assert.equal(x.burst.n + x.first.n, 60, 'a 1 s burst at 60 Hz');
  assert.equal(x.settle.n, 31, 'after it (the recording ends at 2 004 ms: 31 frames of its 800 ms)');
  assert.equal(x.all.n, 120);
  assert.equal(B.analyse(R, 0, 400).bursts, 0, 'a window before it: none');
});

test('verdict (IMPL-3 §1.5): P+ at 60 Hz; one 40 ms burst frame → P; a 60 ms one → fail; two slow first frames in a burst → not P+; a context loss fails; no bursts said', () => {
  const smooth = rec(Array(120).fill(16.7), [[500, 1500]]);
  assert.equal(B.verdict(B.analyse(smooth)), 'P+');
  const d = Array(120).fill(16.7); d[50] = 40;
  assert.equal(B.verdict(B.analyse(rec(d, [[500, 1500]]))), 'P', 'one frame over 33 ms in the burst');
  const e = Array(120).fill(16.7); e[50] = 60;
  assert.equal(B.verdict(B.analyse(rec(e, [[500, 1500]]))), 'fail');
  const f = Array(120).fill(16.7); f[31] = 34; f[32] = 34;
  const fx = B.analyse(rec(f, [[500, 1500]]));
  assert.deepEqual([fx.first.multi, B.verdict(fx)], [1, 'P'], 'two first-move frames over 33 ms');
  assert.equal(B.verdict(B.analyse(smooth), { lost: true }), 'fail');
  assert.equal(B.verdict(B.analyse(rec(Array(30).fill(16.7), []))), 'no bursts');
  assert.deepEqual([B.BAR.Pp.med, B.BAR.Pp.p95, B.BAR.Pp.max, B.BAR.P.med, B.CORD_BAR.awake, B.DOM_BAR.full, B.DOM_BAR.heavy], [17, 20, 33, 17.5, 40, 5000, 1866]);
});

test('RIGX = §9\'s full WC-1 rig on the starter (Oscillator 1, Filter 1, Envelope 1): 3 Oscillators, Sub, Noise, 2 Filters, 4 Envelopes, 2 LFOs, Macros, 4 effects; 6 canvas modulators with 8 rows; its own rows from its modules', () => {
  const parts = ['oscA', 'filter', 'env1', ...B.RIGX.add.map(x => x[1])];
  const n = re => parts.filter(p => re.test(p)).length;
  assert.deepEqual([n(/^osc/), n(/^sub$/), n(/^noise$/), n(/^filter/), n(/^env/), n(/^lfo/), n(/^macros$/), B.RIGX.effects], [3, 1, 1, 2, 4, 2, 1, 4]);
  assert.deepEqual([B.RIGX.canvas.length, B.RIGX.rows.length], [6, 8]);
  assert.ok(B.RIGX.rows.every(([w]) => B.RIGX.canvas.some(([k]) => k === w)), 'every row from a canvas modulator the scene makes');
  assert.ok(B.RIGX.own.every(([src]) => /^(lfo[12]|env[234]|macro[1-8])$/.test(src)), 'its own rows from its own modules');
  assert.ok(B.RIGX.own.length >= 30 && new Set(B.RIGX.own.map(r => r.join('>'))).size === B.RIGX.own.length, '(fixer B2, review 2 P3-9) ≥ 30 distinct own rows: with the rig\'s ≈ 10 edges ≥ ' + B.CORD_BAR.awake + ' cords, all awake in the sway');
});

test('the page: ?wc=1 in tests/ui-bench.html loads it (not with ?m3 / ?m9, not the 1h run=1); main() is its only DOM work', () => {
  const html = readFileSync(new URL('./ui-bench.html', import.meta.url), 'utf8');
  assert.match(html, /const WC = !M3 && !M9 && \/\[\?&\]wc=1\/\.test\(location\.search\)/);
  assert.match(html, /import\('\.\/ui-bench-wc\.mjs\?t=' \+ Date\.now\(\)\)\.then\(m => m\.main\(\)/);
  assert.match(html, /!M3 && !M9 && !WC\) \$\('#run'\)\.click\(\)/);
  assert.equal(typeof B.main, 'function');
  const src = readFileSync(new URL('./ui-bench-wc.mjs', import.meta.url), 'utf8');
  assert.equal(/cv\.parts\.show|parts\.show\(/.test(src), false, 'never the removed Show parts hook');
});
