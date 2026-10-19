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
