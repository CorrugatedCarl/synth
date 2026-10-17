// Factory content through the real DSP (SPEC-serum §0.5 M3, §10.2.19): every migrated Phase-1 FACTORY_PRESETS entry is rendered by
// engine.js in a node:vm worklet scope (the SPEC-serum2 §0.3 script list, then engine.js: tests/dsp-scope.mjs) with a
// typical phrase of its category at velocity 0.8 and 2x oversampling; the level is read before the output stage's
// DC blocker / limiter. Every FACTORY_CHAINS rack is rendered on a plain model and on a Serum chord. Run:
//   node --test 'tests/*.test.mjs'
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../serum-core.js?v=9';
import * as W from '../wt.js?v=9';
import { MODELS, patchFor } from '../models.js?v=9';
import { dspScope } from './dsp-scope.mjs';
import * as A from '../assets.js?v=9';
import * as wtstore from '../wtstore.js?v=9';
import * as smpstore from '../smpstore.js?v=9';

const SR = 48000, BPM = 120;

function scope() {
  const D = dspScope({ sampleRate: SR, engine: true, console: { log() {}, warn() {}, error() {}, info() {}, debug() {} } });
  return { ctx: D.ctx, mk: po => new D.Proc({ processorOptions: po || {} }) };
}
const ENT = new Map();
const isWt = id => id.startsWith('noise:') || !!W.factoryTable(id);           // wavetables, sub tables, noises ({t: 'wt'})
const entryOf = id => {
  if (!ENT.has(id)) ENT.set(id, id.startsWith('noise:') ? W.makeNoise(id) : W.makeEntry(id, W.factoryTable(id)));
  return ENT.get(id);
};
// sample-like assets of a patch (§4.5: factory IRs of Convolve instances, …) built as a bounce builds them (assets.js
// entries(ids, rate, {s, fx}): generated on demand, prepared for the rate), posted as {t: 'smp', …entry}
const AM = A.createAssetManager({ ctxOf: () => null, post: () => false, tracks: () => [], worker: () => null,
  stores: { wt: () => wtstore.memoryStore(), smp: () => smpstore.memoryStore() }, wt: () => Promise.resolve(W), persist: () => Promise.resolve(true) });
const assetsOf = (pt, s, fx) => { const ids = (pt.needs || []).filter(id => !isWt(id)); return ids.length ? AM.entries(ids, SR, { s, fx }) : Promise.resolve([]); };
// the patch main.js sends for a track (models.js patchFor: model map with the track's FX state + its rack, seeded as
// after a preset load, + tempo)
const serumPatch = (s, fx) => patchFor('serum', { s }, fx, { sr: SR, bpm: BPM, seed: true });
function plainPatch(id, fx) {
  const m = MODELS.find(x => x.id === id), v = {};
  for (const c of m.controls) v[c.id] = c.def;
  return patchFor(m, v, fx, { sr: SR, bpm: BPM, seed: true });
}
// events [t (s), on, note]; returns the output and the pre-limiter signal (post rack, master and bypass)
function render(S, pt, ev, secs, smps) {
  const p = S.mk({ os: 2 });
  for (const id of pt.needs || []) if (isWt(id)) p.msg(Object.assign({ t: 'wt' }, entryOf(id)));
  for (const e of smps || []) p.msg(Object.assign({ t: 'smp' }, e));
  p.msg({ t: 'patch', p: pt });
  const n = Math.ceil(secs * SR / 128) * 128, L = new Float32Array(n), R = new Float32Array(n), PL = new Float64Array(n), PR = new Float64Array(n);
  const a = new Float32Array(128), b = new Float32Array(128), out = p.outStage;
  let at = 0, k = 0;
  p.outStage = function (Lo, Ro, off, m) { PL.set(this.Lb.subarray(0, m), at + off); PR.set(this.Rb.subarray(0, m), at + off); return out.call(this, Lo, Ro, off, m); };
  ev = ev.slice().sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  for (let o = 0; o < n; o += 128) {
    while (k < ev.length && ev[k][0] * SR <= o) { const e = ev[k++]; p.msg(e[1] ? { t: 'on', n: e[2], v: 0.8 } : { t: 'off', n: e[2] }); }
    at = o;
    p.process([], [[a, b]]);
    L.set(a, o); R.set(b, o);
    S.ctx.currentFrame += 128;
  }
  return { L, R, PL, PR };
}
const peak = (x, a = 0, b = x.length) => { let m = 0; for (let i = a; i < b; i++) { const v = Math.abs(x[i]); if (v > m) m = v; } return m; };
const rms = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
const dB = x => 20 * Math.log10(Math.max(1e-30, x));

// a typical phrase per category (the one the factory levels were set with): [events, seconds]
function phrase(cat, mono) {
  const ev = [], on = (t, n, d) => { ev.push([t, 1, n], [t + d, 0, n]); };
  const B = 60 / BPM;
  switch (cat) {
    case 'Bass':
      if (mono) { on(0, 36, 1); on(1, 36, 0.24); on(1.25, 43, 0.5); on(1.75, 39, 0.3); on(2, 41, 1); on(2.9, 36, 1); return [ev, 5]; }
      on(0, 36, 1); on(1.25, 43, 0.5); on(2, 41, 1); return [ev, 4.5];
    case 'Lead': on(0, 72, 0.95); on(0.9, 67, 0.55); on(1.4, 69, 0.55); on(1.9, 74, 1.6); on(3.6, 72, 1); return [ev, 6.5];
    case 'Pad': for (const n of [48, 55, 60, 64]) on(0, n, 4); return [ev, 8];
    case 'Keys': for (const n of [57, 60, 64, 67]) on(0, n, 1.5); for (const n of [53, 57, 60, 64]) on(2, n, 1.5); return [ev, 5.5];
    case 'Chord': on(0, 60, 1.5); on(2, 65, 1.5); return [ev, 5.5];
    case 'Pluck': { const a = [60, 64, 67, 72, 67, 64, 60, 55]; for (let i = 0; i < 16; i++) on(i * B / 2, a[i % 8], 0.2); return [ev, 6]; }
    case 'Arp': for (const n of [57, 60, 64]) on(0, n, 4); return [ev, 6];
    case 'Seq': on(0, 48, 4); return [ev, 6];
    case 'Drum': for (let i = 0; i < 8; i++) on(i * B, 48, 0.1); return [ev, 5];
    default: on(0, 60, 4); return [ev, 7];                                       // FX
  }
}

test('M3: every factory preset peaks between −9 and −3 dBFS on its category phrase (velocity 0.8, 2x), finite, no DC', () => {
  const S = scope();
  // the migrated Phase-1 presets (S1 mode); the Serum 2 presets render with their assets in tests/presets2.test.mjs
  const list = core.FACTORY_PRESETS.filter(p => p.v.s.global.s1 === 1);
  assert.equal(list.length, core.FACTORY_PRESETS_V1.length);
  for (const pr of list) {
    if (pr.cat === 'Init') continue;
    const s = core.applyPreset(core.defaultSerum(), pr), fx = core.applyPresetFx(core.defaultFx(), pr.fx, []);
    const [ev, secs] = phrase(pr.cat, s.voicing.mono);
    const o = render(S, serumPatch(s, fx), ev, secs);
    assert.ok(o.PL.every(Number.isFinite) && o.PR.every(Number.isFinite), pr.name + ' finite');
    const pk = dB(Math.max(peak(o.PL), peak(o.PR)));
    assert.ok(pk >= -9 && pk <= -3, `${pr.name}: peak ${pk.toFixed(1)} dBFS`);
    // no subnormal samples reach the output; steady-state DC of the first held note ≤ −30 dB re its RMS
    assert.ok(!o.L.some(x => x !== 0 && Math.abs(x) < 1.2e-38), pr.name + ' subnormal output');
    const a = Math.round(0.25 * SR), b = Math.round(0.95 * SR), r = rms(o.PL, a, b);
    let m = 0;
    for (let i = a; i < b; i++) m += (o.PL[i] + o.PR[i]) / 2;
    if (r > 1e-3) assert.ok(dB(Math.abs(m / (b - a)) / r) <= -30, `${pr.name}: DC ${dB(Math.abs(m / (b - a)) / r).toFixed(1)} dB re RMS`);
    // releases, echoes and reverb tails decay (no runaway feedback): the last quarter second is silent or quieter than
    // the quarter second 1.5 s before it
    const n = o.PL.length, q = SR / 4, late = dB(peak(o.PL, n - q)), early = dB(peak(o.PL, n - 7 * q, n - 6 * q));
    assert.ok(late < -60 || late < early - 3, `${pr.name}: tail ${late.toFixed(1)} dBFS after ${early.toFixed(1)} dBFS`);
  }
});

test('M3: factory effect chains on a plain model and a Serum chord — finite, level within reach of the dry signal, tails decay', async () => {
  const S = scope(), line = [], chord = [];
  [48, 51, 55, 58, 60, 58, 55, 51].forEach((n, i) => { line.push([i * 0.25, 1, n], [i * 0.25 + 0.2, 0, n]); });
  for (const n of [48, 55, 60, 64]) chord.push([0, 1, n], [2, 0, n]);
  const s = core.normalizeSerum(core.defaultSerum());
  const srcs = [[fx => plainPatch('juno60', fx), line], [fx => serumPatch(s, fx), chord]];
  const dry = srcs.map(([mk, ev]) => render(S, mk(core.defaultFx()), ev, 7));
  assert.ok(core.FACTORY_CHAINS.chains.some(c => c.fx.racks[0].mods.some(I => I.type === 'conv')), 'a chain with a factory IR (Convolve)');
  for (const c of core.FACTORY_CHAINS.chains) {
    const fx = core.applyPresetFx(core.defaultFx(), c.fx, []);
    for (const [i, [mk, ev]] of srcs.entries()) {
      const pt = mk(fx), smps = await assetsOf(pt, i ? s : null, fx);
      assert.equal(smps.length, (pt.needs || []).filter(id => !isWt(id)).length, c.name + ': every asset built');
      const o = render(S, pt, ev, 7, smps), d = dry[i];
      assert.ok(o.PL.every(Number.isFinite) && o.PR.every(Number.isFinite), c.name + ' finite');
      const dp = dB(Math.max(peak(o.PL), peak(o.PR))) - dB(Math.max(peak(d.PL), peak(d.PR)));
      assert.ok(dp > -12 && dp < 9, `${c.name} on source ${i}: peak ${dp.toFixed(1)} dB re dry`);
      assert.ok(dB(peak(o.PL, o.PL.length - SR / 2)) < -40, `${c.name} on source ${i}: tail decays`);
    }
  }
});
