// Golden shard 2 (owner I; SPEC-serum2 §15.1 item 2): seeded random v1 Serum states (random destinations, matrix rows,
// LFO graphs, FX racks, voicing; the Phase-1 normalisation of random JSON) — (A) tests/ref-p1 vs (B) the current code with
// the migrated state, max |A − B| ≤ 1e-6 per sample and channel. 60 states per run rotating through OS 1/2/4; the run
// index (GOLDEN_SEED, default the UTC day) picks them, so different runs cover different states.
// GOLDEN_FULL=1: 200 states × OS 1, 2 and 4.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from './golden-harness.mjs';

const [A, B] = await H.sides();
const TOL = 1e-6;
const COUNT = H.FULL ? 200 : 60;
const seedOf = i => (Math.imul(H.RUN, 0x9E3779B1) ^ Math.imul(i + 1, 0x85EBCA77)) >>> 0;

test(`${COUNT} random v1 Serum states${H.FULL ? ' × OS 1/2/4' : ' (OS 1/2/4 rotating)'} (run ${H.RUN}): (A) vs (B) ≤ 1e-6`, (t) => {
  const bad = [];
  let silent = 0, renders = 0;
  for (let i = 0; i < COUNT; i++) {
    for (const os of H.FULL ? [1, 2, 4] : [[1, 2, 4][i % 3]]) {
      const seed = seedOf(i), s1 = H.randomSerumV1(A.core, A.wt, seed, os), fx1 = H.randomFxV1(A.core, seed ^ 0x5EED);
      const id = `random:${seed}:${os}`, r = [];
      for (const X of [A, B]) {
        const s = H.serumState(X, s1);
        r.push(H.renderTrack(X, { id, model: 'serum', vals: { s }, fx: H.fxState(X, fx1, s), os }));
      }
      renders++;
      if (!H.finite(r[0])) bad.push(`state ${i} (seed ${seed}, OS ${os}): reference not finite`);
      if (!(H.peak(r[0]) > 1e-4)) silent++;
      const d = H.compare(r[0], r[1]);
      if (!(d.max <= TOL)) bad.push(`state ${i} (seed ${seed}, OS ${os}): ${H.describe(d)}`);
    }
  }
  t.diagnostic(`${renders} renders, ${silent} silent reference renders; reproduce with GOLDEN_SEED=${H.RUN}`);
  assert.ok(silent <= renders / 4, `too many silent states (${silent}/${renders}): the generator no longer exercises the voice`);
  assert.deepEqual(bad, []);
});
