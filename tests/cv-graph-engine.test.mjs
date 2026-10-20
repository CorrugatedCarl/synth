// cv-graph compileMods on the real engine (stage 2b review fix C1, fixer B; the compile reviewer's probe3 rig): a track
// whose GLOBAL LFO feeds a Serum knob (an ext row) and a classic knob — with the classic row bypassed / at amount 0 /
// at output 0 the Serum's ext feed must still move (the synthetic CP keeps the source alive: serum-core's rowActive
// ignores such rows, and SxMod skips an LFO no active row reads).
// Run: node --max-old-space-size=2048 --test tests/cv-graph-engine.test.mjs
import './v8-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../cv-graph.js?v=9';
import * as MO from '../cv-model.js?v=9';
import * as C from '../serum-core.js?v=9';
import * as S from '../song.js?v=9';
import { patchFor, MODELS } from '../models.js?v=9';
import { dspScope } from './dsp-scope.mjs';
import * as H from './golden-harness.mjs';

const SR = 48000, Q = 128;
const sx = () => ({ kind: 'synth', model: 'serum', vals: { s: C.normalizeSerum(C.defaultSerum()) }, preset: null, fx: C.defaultFx2() });
const juno = () => ({ kind: 'synth', model: 'juno60', vals: {}, preset: null });
function mkTrack() {
  const fx = C.defaultFx2(); C.newInstance(fx, 'rev', { rack: 0 });
  const t = { id: 'trk_e', name: 'E', notes: [], cc: [], prim: 'i1', nid: 4,
    dev: { i1: sx(), i2: juno(), fx1: { kind: 'panel', fx }, out: { kind: 'out' } },
    wires: [{ id: 'w1', a: 'i1.out', b: 'out.in' }, { id: 'w2', a: 'i2.out', b: 'fx1.in' }, { id: 'w3', a: 'fx1.out', b: 'out.in' }], mods: [] };
  t.dev.l1 = S.normModDev({ kind: 'lfo', lfo: { mono: 1, mode: 'free', bpm: 0, anchor: 0 }, rate: Math.pow(3 / 100, 0.25) }); // (a 3 Hz GLOBAL LFO)
  return t;
}
const P = { bpm: 120, perf: { wheel: null }, tracks: [] };
const D = dspScope({ fast: true, engine: true });
const Z = { lo: 0, hi: 127, xp: 0 };
function junoPatch() { const m = MODELS.find(x => x.id === 'juno60'), v = Object.fromEntries(m.controls.map(c => [c.id, c.def])); const p = patchFor(m, v, C.defaultFx2(), { sr: SR, bpm: 120 }); delete p.fxr; delete p.fxrT; return p; }
const fx = C.defaultFx2(), chainMsg = { fxr: C.compileFx(fx, { bpm: 120, rate: SR }), fxrT: C.compileFxT(fx) };
// the chunks of ext slot 1 that differ from its first one after 30 quanta
function extMoves(t) {
  const pay = G.compileMods(t, P, {});
  const p = new D.Proc({ processorOptions: { os: 4, hostOS: 4 } });
  p.msg({ t: 'graph', insts: [{ id: 'i2', on: true, zone: Z, salt: 0 }], chains: [{ id: 'fx1' }], edges: [['i2', 'fx1', 1], ['fx1', 'out', 1]], out: 'out', key: 'k' });
  p.msg({ t: 'patch', i: 'i2', p: junoPatch() });
  p.msg(Object.assign({ t: 'chain', c: 'fx1' }, chainMsg));
  p.msg(pay);
  const o = [[new Float32Array(Q), new Float32Array(Q)]];
  for (let q = 0; q < 30; q++) { p.process([], o); D.ctx.currentFrame += Q; }
  let moved = 0;
  for (let c = 1; c < 32; c++) if (p.mc.ext[c] !== p.mc.ext[0]) moved++;
  return { moved, pay, stats: p.mc.stats() };
}

test('C1 on the engine: a bypassed / amt-0 / out-0 classic row of the source that also feeds a Serum ext row leaves the ext slot moving (keep-alive), as with no classic row or a live one', () => {
  const a = mkTrack(); MO.addMod(a, 'l1.out', 'i1:f.cutoff', { project: P });
  const A = extMoves(a);
  assert.deepEqual([A.pay.ext.length, A.pay.keep, A.stats.lfos], [1, [C.SRC_INDEX.lfo1], 1], 'the Serum alone: a keep-alive, the LFO evaluated');
  assert.ok(A.moved >= 28, 'ext1 moves: ' + A.moved + '/31');
  for (const f of [{ byp: 1 }, { amt: 0 }, { out: 0 }, { amt: 0.3 }]) {
    const t = mkTrack(); MO.addMod(t, 'l1.out', 'i1:f.cutoff', { project: P }); MO.addMod(t, 'l1.out', 'i2:cf', Object.assign({ project: P }, f));
    const R = extMoves(t);
    assert.deepEqual([R.pay.ext.length, R.pay.rows.length, R.stats.lfos, R.stats.ext], [1, 1, 1, 1], JSON.stringify(f));
    assert.equal(R.moved, A.moved, JSON.stringify(f) + ': ext1 moves ' + R.moved + '/31 (the Serum alone: ' + A.moved + ')');
  }
});

/* ------------------------------------------------------------------ a canvas LFO on the Serum's own LFO 1 Rate (bug 2, stage 2b) */
// The Serum's LFO 1 drives its level (so the rate matters), a canvas LFO module cabled to "LFO 1 Rate" must render exactly as
// the same modulation written inside the Serum (a matrix row LFO 2 → LFO 1 rate, LFO 2 holding the module's definition):
// GLOBAL through ext, PER NOTE through slot injection. LFO 1 itself is the Serum's own either through a preset row or through
// a canvas row (the "Serum LFO 1" link source): the injected module must never land in LFO 1 (it would replace what the
// level row reads and modulate its own rate).
const row = (src, dst, amt = 1, x = {}) => ({ src, dst, amt, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0, ...x });
const hzN = hz => Math.pow(hz / 100, 0.25);
const [, Bv2] = await H.sides();
const HS = H.scope(Bv2, SR);
const LV = { amt: 0.9, bi: 1 }, RATE_AMT = 0.5;
function ownLfo1(s) { s.p['f.on'] = 0; } // (LFO 1 stays the Serum's default one: BPM-synced, retriggered — the state a slot injection takes first)
const modDef = mono => ({ lfo: { mono, mode: 'retrig', bpm: 0, anchor: 0 }, rate: hzN(0.7) });
// the track: l1 = the canvas module; the LFO 1 → level row either in the Serum's matrix ('preset') or a canvas link row ('link')
function rateTrack(mono, own) {
  const s = C.normalizeSerum(C.defaultSerum());
  ownLfo1(s);
  if (own === 'preset') s.matrix[0] = row('lfo1', 'a.level', LV.amt, { bi: LV.bi });
  const t = { id: 'trk_r', name: 'R', notes: [], cc: [], prim: 'i1', nid: 4, dev: { i1: { kind: 'synth', model: 'serum', vals: { s }, preset: null, fx: C.defaultFx2() }, out: { kind: 'out' } },
    wires: [{ id: 'w1', a: 'i1.out', b: 'out.in' }], mods: [] };
  t.dev.l1 = S.normModDev(Object.assign({ kind: 'lfo' }, modDef(mono)));
  const add = (src, dst, f) => { const r = MO.addMod(t, src, dst, { project: P }); assert.ok(r.ok, r.why); MO.setMod(t, r.row.id, f); };
  if (own === 'link') add('i1/lfo1.out', 'i1:a.level', LV);
  add('l1.out', 'i1:l1.rate', { amt: RATE_AMT });
  return t;
}
// the same written inside the Serum: LFO 2 = the module's definition (MONO for a GLOBAL one), row lfo2 → l1.rate
function nativeOf(mono) {
  const s = C.normalizeSerum(C.defaultSerum());
  ownLfo1(s);
  s.matrix[0] = row('lfo1', 'a.level', LV.amt, { bi: LV.bi });
  s.lfo[1] = C.normLfo(modDef(mono).lfo); s.p['l2.rate'] = modDef(mono).rate;
  s.matrix[1] = row('lfo2', 'l1.rate', RATE_AMT);
  return s;
}
const PO = { sr: SR, bpm: 120, prefs: { smooth: 1, silenceTails: 1 } };
const nativePatch = s => Object.assign(patchFor('serum', { s }, C.defaultFx2(), PO), C.compileSerum(s, { bpm: 120, smooth: 1, fx: C.defaultFx2(), qr: null, ultra: 0, mpeBendX: 0, mpeYBi: 0, ext: false }));
const renderSide = (id, patch, mods) => H.render(HS, { id, seconds: 3, events: H.script(SR, { song: false }), po: { os: 2, hostOS: 2 },
  setup(p) { H.postTables(Bv2, p, patch.needs); p.msg({ t: 'patch', p: patch }); if (mods) p.msg(mods); } });

for (const [mono, own] of [[1, 'preset'], [0, 'preset'], [1, 'link'], [0, 'link']]) {
  test(`a ${mono ? 'GLOBAL' : 'PER NOTE'} canvas LFO on the Serum's LFO 1 Rate (LFO 1 → level through a ${own} row) renders as the same modulation written inside the Serum`, () => {
    const t = rateTrack(mono, own), pay = G.compileMods(t, P, {});
    const patch = G.instPatch(t.dev.i1, PO, G.modRowsFor(t, 'i1'), pay.ext, t);
    assert.equal(pay.ext.length, mono ? 1 : 0, mono ? 'GLOBAL: ext' : 'PER NOTE: injected, no ext');
    const A = renderSide('rate:native', nativePatch(nativeOf(mono)), null), B = renderSide('rate:canvas', patch, mono ? pay : null);
    assert.ok(H.peak(A) > 0.05, 'audible');
    const d = H.compare(A, B);
    assert.equal(d.at, -1, 'bit-identical to the native modulation: ' + H.describe(d));
    // and the rate row matters: without it the render differs
    const s0 = nativeOf(mono); s0.matrix[1] = row('', '');
    assert.notEqual(H.compare(A, renderSide('rate:none', nativePatch(s0), null)).at, -1, 'the rate modulation is audible');
  });
}
