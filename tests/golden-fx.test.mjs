// Golden shard 4 (owner I; SPEC-serum2 §15.1 item 4, §14.1 row n): seeded random v1 FX racks — the Phase-1 FXRack of
// tests/ref-p1 fed the v1 state vs the current FXRack fed (a) the v1 state as the current normalizeFx keeps it and (b)
// the §2.6.3 migrated v2 state (migrateFx1: what a project load and the rack / mixer UIs produce) — on noise input (rack
// level, with a note trigger, a transport re-seed and a parameter edit while running) and on a classic model through
// the whole engine (event script): bit-identical. 100 states per run, picked by the run index (GOLDEN_SEED, default
// the UTC day); GOLDEN_FULL=1: 300 states. Timing row n: a v1-migrated rack with all 10 modules on ≤ 1.3 × ref-p1
// (target 1.05×).
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from './golden-harness.mjs';

const [A, B] = await H.sides();
const COUNT = H.FULL ? 300 : 100;
const MODELS = A.models.MODELS.filter(m => !m.custom).map(m => m.id);
const seedOf = i => (Math.imul(H.RUN ^ 0xF00D, 0x9E3779B1) ^ Math.imul(i + 1, 0x85EBCA77)) >>> 0;
const SECS = 2.5, N = Math.ceil(SECS * H.SR / 128) * 128;

// stereo input: seeded white noise in bursts (attack, sustain, silence) so dynamics and tails are exercised
function noise(seed) {
  const r = H.mulberry32(seed), L = new Float64Array(N), R = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / H.SR, ph = t % 0.6, env = t > 2 ? 0 : ph < 0.01 ? ph / 0.01 : ph < 0.35 ? 1 : 0;
    L[i] = env * (r() - 0.5); R[i] = env * (0.7 * (r() - 0.5) + 0.3 * L[i]);
  }
  return { L, R };
}
// a parameter edit while running: one enabled module toggled off or one of its parameters moved, recompiled from v1
function edited(fx, seed) {
  const r = H.mulberry32(seed), e = H.clone(fx), ids = Object.keys(e.p);
  const id = ids[Math.floor(r() * ids.length)];
  e.p[id] = /\.on$/.test(id) ? 1 - e.p[id] : r();
  return A.core.normalizeFx(e);
}
function rackRun(X, fx1, ed1, input, conv = H.fxState) {
  const FX = H.scope(X).g.FXDSP, rack = new FX.FXRack(H.SR);
  const set = (v1, seed) => { const fx = conv(X, v1); rack.set(X.fxm.compileFx(fx, { bpm: 120, rate: H.SR, seed, smooth: 1, silence: 1 }), X.fxm.compileFxT(fx)); };
  set(fx1, true);
  const L = Float64Array.from(input.L), R = Float64Array.from(input.R);
  for (let o = 0; o < N; o += 128) {
    if (o === 128 * 180) rack.trigger();
    if (o === 128 * 375) rack.transport();
    if (o === 128 * 470) set(ed1, false);
    rack.process(L.subarray(o, o + 128), R.subarray(o, o + 128), 128);
  }
  return { L, R };
}

test(`${COUNT} random v1 FX racks on noise input (run ${H.RUN}): ref-p1 rack vs current rack (v1 state, migrated v2 state), bit-identical`, (t) => {
  const bad = [];
  let quiet = 0, mig = 0;
  for (let i = 0; i < COUNT; i++) {
    const seed = seedOf(i), fx1 = H.randomFxV1(A.core, seed), ed1 = edited(fx1, seed ^ 0xED17), input = noise(seed);
    const a = rackRun(A, fx1, ed1, input), b = rackRun(B, fx1, ed1, input), m = rackRun(B, fx1, ed1, input, H.fxMigrated);
    if (!H.finite(a)) bad.push(`rack ${i} (seed ${seed}): reference not finite`);
    if (!(H.peak(a) > 1e-3)) quiet++;
    if (H.fxMigrated(B, fx1).v >= 2) mig++;
    const d = H.compare(a, b), dm = H.compare(a, m);
    if (d.max !== 0) bad.push(`rack ${i} (seed ${seed}): ${H.describe(d)}`);
    if (dm.max !== 0) bad.push(`rack ${i} (seed ${seed}), migrated: ${H.describe(dm)}`);
  }
  assert.equal(mig, COUNT, 'the migrated side is a v2 state');
  t.diagnostic(`${quiet} near-silent reference racks; reproduce with GOLDEN_SEED=${H.RUN}`);
  assert.ok(quiet <= COUNT / 5, 'the generator still produces audible racks');
  assert.deepEqual(bad, []);
});

test(`${COUNT} random v1 FX racks on a classic model through the engine (event script; v1 state, migrated v2 state): bit-identical`, (t) => {
  const bad = [];
  let quiet = 0; // a random rack may legitimately mute (module LEVEL or EQ gain at 0, a closed filter)
  for (let i = 0; i < COUNT; i++) {
    const seed = seedOf(i), fx1 = H.randomFxV1(A.core, seed), model = MODELS[i % MODELS.length], id = `fx:${seed}:${model}`, r = [];
    for (const X of [A, B]) r.push(H.renderTrack(X, { id, model, vals: H.classicVals(A, model, null), fx: H.fxState(X, fx1), os: 2, hostOS: 2 }));
    r.push(H.renderTrack(B, { id, model, vals: H.classicVals(A, model, null), fx: H.fxMigrated(B, fx1), os: 2, hostOS: 2 }));
    if (!H.finite(r[0])) bad.push(`${id}: reference render not finite`);
    if (!(H.peak(r[0]) > 1e-3)) quiet++;
    const d = H.compare(r[0], r[1]), dm = H.compare(r[0], r[2]);
    if (d.max !== 0) bad.push(`${id}: ${H.describe(d)}`);
    if (dm.max !== 0) bad.push(`${id}, migrated: ${H.describe(dm)}`);
  }
  t.diagnostic(`${quiet} near-silent reference renders`);
  assert.ok(quiet <= COUNT / 5, 'the generator still produces audible racks');
  assert.deepEqual(bad, []);
});

test('timing row n (§14.1): a v1-migrated rack with all 10 S1 modules on ≤ 1.3 × ref-p1 (target 1.05×)', (t) => {
  const fx1 = A.core.defaultFx();
  for (const m of fx1.order) fx1.p['fx.' + m + '.on'] = 1;
  const input = noise(7), run = X => {
    const FX = H.scope(X).g.FXDSP, rack = new FX.FXRack(H.SR), fx = H.fxMigrated(X, fx1);
    rack.set(X.fxm.compileFx(fx, { bpm: 120, rate: H.SR, smooth: 1, silence: 1 }), X.fxm.compileFxT(fx));
    const L = new Float64Array(128), R = new Float64Array(128);
    return () => { for (let o = 0; o < H.SR; o += 128) { L.set(input.L.subarray(o, o + 128)); R.set(input.R.subarray(o, o + 128)); rack.process(L, R, 128); } };
  };
  const r = H.timeInterleaved(run(A), run(B), { limit: 1.3 });
  t.diagnostic(`(n) ref-p1 ${r.a.toFixed(1)} ms, current ${r.b.toFixed(1)} ms per s of audio: ${r.ratio.toFixed(3)}× (attempt ${r.attempts})`);
  assert.ok(r.ratio <= 1.3, `(n) ${r.ratio.toFixed(2)}× ref-p1 (fails above 1.3×)`);
});
