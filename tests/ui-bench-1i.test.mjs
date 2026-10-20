import './v8-guard.mjs';
// tests/ui-bench-1i.mjs's unwarmed first burst (review 2 P2-3): the very first pan and pinch of a fresh page are measured as
// their own row (firstBurst → R.firstPan) before anything is warm — informational, never a gate (the Mac showed no
// reproducible first-use hitch; the iPad's WebKit may). Run on a stand-in window / world with a timer for rAF; the app run
// itself is browser-only (tests/ui-bench-1i.html). Numbers and strings only into assert.
// Run alone: node --max-old-space-size=2048 --test tests/ui-bench-1i.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { firstBurst, gates } from './ui-bench-1i.mjs?v=9';

globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || (f => setTimeout(() => f(performance.now()), 4));
const win = { document: { querySelector: () => ({ getBoundingClientRect: () => ({ left: 0, top: 48, width: 1000, height: 700 }) }) } };
const stub = withGl => {
  const calls = [], w = { calls, panBy: (dx, dy) => calls.push(['pan', dx, dy]), zoomAt: (k, x, y) => calls.push(['zoom', k, x, y]) };
  if (withGl) { let n = 0; w.glStats = reset => { if (reset) n = 0; else n++; return { frames: n, ms: 0.01 * n, max: 0.2, bytes: 1e6, faceBytes: 5e5, windows: 0, paints: 1, paintMax: 2 }; }; }
  return w;
};

test('firstBurst: a pan then a pinch, each its own measured phase (frames, median / p95 / max / over 33 ms, its worst three), the GL draws when the world has them', async () => {
  const w = stub(true), R = await firstBurst(win, w, 120);
  assert.deepEqual(Object.keys(R), ['pan', 'zoom']);
  for (const ph of ['pan', 'zoom']) {
    const x = R[ph];
    assert.ok(x.n >= 3 && x.med > 0 && x.max >= x.med && x.p95 <= x.max + 0.05 && x.over33 >= 0, ph + ': ' + JSON.stringify(x));
    assert.ok(x.worst.length > 0 && x.worst.length <= 3 && x.worst[0] === x.max && x.worst.every((v, i, a) => !i || a[i - 1] >= v), ph + ' worst: ' + x.worst);
    assert.deepEqual(Object.keys(x.gl).sort(), ['bytes', 'faceBytes', 'max', 'mean', 'n', 'paintMax', 'paints', 'windows'], ph + ': the GL draws');
  }
  const kinds = w.calls.map(c => c[0]), i = kinds.indexOf('zoom');
  assert.ok(i > 2 && kinds.slice(0, i).every(k => k === 'pan') && kinds.slice(i).every(k => k === 'zoom'), 'the pan first, then the pinch: ' + kinds.join(','));
  const bare = await firstBurst(win, stub(false), 60);
  assert.deepEqual([bare.pan.gl, bare.zoom.gl], [undefined, undefined], 'no glStats: no GL numbers');
});

test('gates: the first burst is a record, not a gate — a 500 ms first pan fails nothing', () => {
  const ok = { scenes: {}, errors: [] }, G = gates(ok), slow = { scenes: {}, errors: [], firstPan: { pan: { n: 40, med: 16.7, p95: 18, max: 500, over33: 3 }, zoom: { n: 40, med: 16.7, p95: 18, max: 400, over33: 2 } } };
  assert.deepEqual(gates(slow), G);
  assert.deepEqual(Object.keys(G), ['errors']);
});
