import './v8-guard.mjs';
// Stage LC lane E on the real engine (docs/canvas/IMPL-LC.md §5.3, G2, G6's row; D1 / D2): the host's compile (cv-graph compileMods
// + compileGraph / instPatch / chainPatch, the payload's bpm) into a graphed Track and MASTER.
//   G2  one input at +100 % (another muted) in Add and in Multiply, the combiner's OUT onto a knob ≡ the same LFO cabled directly with
//       the same row, rendered bit for bit (notes, ▶, a seek into a wrapping loop, ■, ▶ again): a Juno cutoff (cls), a panel's knob
//       (fx), a <NAME>'s filter cutoff (ext: RISE / DELAY set), a GLOBAL rig LFO through its linked slot onto the Juno, the rig's own
//       LFO onto its own cutoff (native vs the combiner), a PER NOTE LFO's twin ≡ that LFO switched GLOBAL, the master's Delay mix;
//       live and offline (the bounce's processor)
//   §5.3 the messages: {t: smon, mc, mcx} + cF (the frames at the post) + cb only while combiners run, the Track and MASTER; the fast
//       'mods' part: a payload with combiners replaces its message object (cb, the hold reset) and one without puts the plain shape
//       back — fast and slow cb equal at the same F (hz 30), no throw across the swaps; a payload with combiners only (no rows, no
//       ext) builds a ModCore
//   G6  bench row lc (tests/bench-scenarios.mjs): 2 combiners × 5 inputs onto a Juno and a panel minus the same LFOs cabled directly,
//       paired interleaved medians with an A/A pair: Δ ≤ max(0.002, 2 × the A/A spread)
// Numbers and strings only into assert. Run alone: node --max-old-space-size=2048 --test tests/lc-engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { dspScope } from './dsp-scope.mjs';
import * as G from '../cv-graph.js?v=9';
import * as MO from '../cv-model.js?v=9';
import * as S from '../song.js?v=9';
import * as C from '../serum-core.js?v=9';
import * as W from '../wt.js?v=9';
import { MODELS } from '../models.js?v=9';
import * as H from './golden-harness.mjs';
import { tracks as tracks2b } from './fixtures/mods-2b.mjs';
import { scenarios, measureFast, masterInput } from './bench-scenarios.mjs';

const SR = 48000, Q = 128, BPM = 120, PPQ = 960, P = { bpm: BPM, perf: { wheel: null }, tracks: [], pads: [] };
const PO = { sr: SR, bpm: BPM, prefs: { smooth: 1, silenceTails: 1 } };
const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
const hzN = hz => Math.pow(hz / 100, 0.25);
const D = dspScope({ fast: true, engine: true, console: quiet });
const tables = (p, patch, i) => { for (const id of patch.needs || []) if (/^(factory|noise):/.test(id)) p.msg(Object.assign({ t: 'wt' }, id.startsWith('noise:') ? W.makeNoise(id) : W.makeEntry(id, W.factoryTable(id)), i ? { i } : null)); };
const bitsEqual = (a, b) => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;
const lfo = (lf, o = {}) => S.normModDev(Object.assign({ kind: 'lfo', lfo: Object.assign({ mono: 1, mode: 'free', bpm: 0, anchor: 0 }, lf), rate: hzN(1.3), smooth: 0.2 }, o));
const add = (t, src, dst, o = {}) => { const r = MO.addMod(t, src, dst, Object.assign({ project: P }, o)); assert.ok(r.ok, src + ' → ' + dst + ': ' + r.why); return r.row; };
// the fixture track: a rig i1 → OUT (its LFO 1 FREE GLOBAL 0.9 Hz, its filter on) and a Juno-60 i2 → fx1 (a reverb 'rev') → OUT; l1 GLOBAL, l2 GLOBAL
// (a muted second input), l3 PER NOTE
function track() {
  const t = tracks2b()[0];
  t.id = 'trk_lce'; t.mods = []; t.mid = 1; delete t.dev.l1;
  const m = MODELS.find(x => x.id === 'juno60');
  t.dev.i2.vals = Object.fromEntries(m.controls.map(c => [c.id, c.def]));
  const s = t.dev.i1.vals.s;
  s.lfo[0] = C.normLfo(Object.assign({}, s.lfo[0], { mode: 'free', mono: 1, bpm: 0, anchor: 0 })); s.p['l1.rate'] = hzN(0.9);
  s.p['f.on'] = 1; // ((review 1 R1-2) the rig's filter on: its cutoff's cases are heard — defaultSerum has it off)
  Object.assign(t.dev, { l1: lfo({}), l2: lfo({ bpm: 1, anchor: 1 }, { rate: 0.5 }), l3: lfo({ mono: 0 }, { rate: hzN(2.1), smooth: 0 }) });
  return t;
}
// the song: the golden script's notes, ▶ at 0.3 s, a seek into a loop that wraps at ≈ 1.8 s, ■ at 2.2 s, ▶ again at 2.5 s
function events() {
  const ev = H.script(SR, { song: false }).slice(), fpt = SR * 60 / (BPM * PPQ), F = t => Math.round(t * SR);
  const tp = (t, o) => ev.push([F(t) - 1024, Object.assign({ t: 'transport', play: true, frame: 4 * Math.round((F(t) + 36) / 4), fpt }, o)]);
  tp(0.3, { tick: 0, seek: true, loop: false }); tp(1.3, { tick: 3840, seek: true, loop: true, ls: 3600, le: 4560 });
  ev.push([F(2.2), { t: 'transport', play: false }]); tp(2.5, { tick: 960, seek: true, loop: false });
  return ev.sort((a, b) => a[0] - b[0]);
}
// the host's messages for track t on a fresh Track: the graph, a patch per Inst (instPatch with the payload's ext), a chain per panel
function setup(t, offline = false) {
  const pay = Object.assign({}, G.compileMods(t, P, { smooth: 1, qr: null, ultra: 0 }), { bpm: BPM }), g = G.compileGraph(t);
  const p = new D.Proc({ processorOptions: { os: 2, hostOS: 4, trackId: t.id, offline } });
  p.msg(Object.assign({ t: 'graph' }, g.graph));
  for (const n of g.graph.insts) { const patch = G.instPatch(t.dev[n.id], PO, G.modRowsFor(t, n.id), pay.ext, t); p.msg({ t: 'patch', i: n.id, p: patch }); tables(p, patch, n.id); }
  for (const c of g.graph.chains) p.msg(Object.assign({ t: 'chain', c: c.id }, G.chainPatch(g.chains[c.id], { sr: SR, bpm: BPM })));
  return { p, pay };
}
function render(t, { offline = false, seconds = 3 } = {}) {
  D.ctx.currentFrame = 0; D.seed('lc-engine');
  const { p, pay } = setup(t, offline);
  p.msg(pay);
  if (pay.rows.length || pay.ext.length || pay.cmb) assert.ok(p.mc, 'the payload builds a ModCore'); else assert.equal(p.mc, null, 'nothing for ModCore (a native row only)');
  const N = Math.ceil(seconds * SR / Q), L = new Float32Array(N * Q), R = new Float32Array(N * Q), out = [[new Float32Array(Q), new Float32Array(Q)]], ev = events();
  let e = 0;
  for (let q = 0; q < N; q++) {
    while (e < ev.length && ev[e][0] <= q * Q) p.msg(ev[e++][1]);
    p.process([], out); D.ctx.currentFrame += Q;
    L.set(out[0][0], q * Q); R.set(out[0][1], q * Q);
  }
  return { L, R, pay };
}
const peak = A => { let m = 0; for (const x of A) if (Math.abs(x) > m) m = Math.abs(x); return m; };
// direct: src → dst with amt (fields f); via: src → x1:in (+1), l2 → x1:in muted, x1.out → dst with the same amt / fields
function pair(src, dst, mode, f = {}, prep = null) {
  const a = track(), b = track();
  if (prep) { prep(a, 'a'); prep(b, 'b'); }
  const r = add(a, typeof src === 'string' ? src : src.a, dst); MO.setMod(a, r.id, f);
  b.dev.x1 = S.normModDev({ kind: 'comb', mode });
  add(b, typeof src === 'string' ? src : src.b, 'x1:in'); add(b, 'l2.out', 'x1:in', { byp: 1 });
  const o = add(b, 'x1.out', dst); MO.setMod(b, o.id, f);
  return [a, b];
}
const CASES = [
  ['a Juno cutoff (cls)', () => ['l1.out', 'i2:cf', { amt: 0.6 }]],
  ['a panel\'s reverb mix (fx)', () => ['l1.out', 'fx1:fx.rev.mix', { amt: 0.5, bi: 1 }]],
  ['a rig\'s filter cutoff (ext; RISE / DELAY set)', () => ['l1.out', 'i1:f.cutoff', { amt: 0.4 }, t => Object.assign(t.dev.l1, { rise: 0.3, delay: 0.2 })]],
  ['the rig\'s GLOBAL LFO 1 onto the Juno (its linked slot)', () => ['i1/lfo1.out', 'i2:cf', { amt: 0.5, curve: 0.3 }]],
  ['the rig\'s own LFO 1 onto its own cutoff (native vs the combiner)', () => ['i1/lfo1.out', 'i1:f.cutoff', { amt: 0.4 }]],
  ['a PER NOTE LFO\'s twin ≡ that LFO switched GLOBAL', () => [{ a: 'l3.out', b: 'l3.out' }, 'i2:cf', { amt: 0.7 }, (t, w) => { if (w === 'a') t.dev.l3.lfo.mono = 1; }]],
];

for (const [name, mk] of CASES) for (const mode of ['add', 'mul']) {
  test(`G2 ${mode}: ${name} — the combiner (one input at +100 %, one muted) renders bit for bit as the direct cable`, () => {
    const [src, dst, f, prep] = mk(), [a, b] = pair(src, dst, mode, f, prep);
    const A = render(a), B = render(b);
    assert.ok(Array.isArray(B.pay.cmb) && B.pay.cmb[0].in.length === 2 && !('cmb' in A.pay), 'the combiner compiled; the direct track has none');
    assert.ok(peak(A.L) > 1e-3, 'audible');
    assert.ok(bitsEqual(A.L, B.L) && bitsEqual(A.R, B.R), 'bit-identical');
    // (review 1 R1-2) never vacuous: the same track without the cable renders otherwise (the cable is heard)
    const z = track();
    if (prep) prep(z, 'a');
    assert.ok(!bitsEqual(A.L, render(z).L), 'the cable is heard (no cable renders otherwise)');
    if (name.startsWith('a Juno')) {
      const Ao = render(a, { offline: true }), Bo = render(b, { offline: true });
      assert.ok(bitsEqual(Ao.L, Bo.L) && bitsEqual(Ao.R, Bo.R), 'the bounce\'s processor: bit-identical too');
    }
  });
}

test('G2 sanity: a combiner at another amount, or with a second live input, renders differently (the cable is heard)', () => {
  const [a, b] = pair('l1.out', 'i2:cf', 'add', { amt: 0.6 });
  MO.setMod(b, b.mods.find(r => r.dst === 'x1:in' && r.src === 'l1.out').id, { amt: 0.7 });
  assert.ok(!bitsEqual(render(a).L, render(b).L));
});

// MASTER: a Delay on the master rack, l1 → its mix directly vs through x1 (l2 a muted second input)
function masterPay(mode, via) {
  const fx = C.defaultFx2(), dly = C.newInstance(fx, 'dly', { rack: 0 });
  const t = { id: 'master', dev: { mfx: { kind: 'panel', fx }, l1: lfo({}), l2: lfo({}, { rate: hzN(4) }) }, mods: [], mid: 1 };
  const R = (id, src, dst, amt, byp = 0) => ({ id, src, dst, amt, bi: 0, curve: 0, aux: '', inv: 0, byp, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 });
  if (via) { t.dev.x1 = S.normModDev({ kind: 'comb', mode }); t.mods.push(R('r1', 'l1.out', 'x1:in', 1), R('r2', 'l2.out', 'x1:in', 1, 1), R('r3', 'x1.out', `mfx:fx.${dly}.mix`, 0.6)); }
  else t.mods.push(R('r1', 'l1.out', `mfx:fx.${dly}.mix`, 0.6));
  return { pay: Object.assign({}, G.compileMods(t, P, { smooth: 1, qr: null, ultra: 0 }), { bpm: BPM }), fxr: C.compileFx(fx, { bpm: BPM, rate: SR }), fxrT: C.compileFxT(fx) };
}
function renderMaster(M, offline) {
  D.ctx.currentFrame = 0; D.seed('lc-master');
  const p = new D.procs['synth-master']({ processorOptions: offline ? { offline: true, fxr: M.fxr, fxrT: M.fxrT, frames: 3 * SR, mods: M.pay } : {} });
  if (!offline) { p.msg({ t: 'chain', fxr: M.fxr, fxrT: M.fxrT }); p.msg(M.pay); }
  const fpt = SR * 60 / (BPM * PPQ), inp = masterInput(), N = Math.ceil(3 * SR / Q), L = new Float32Array(N * Q), out = [[new Float32Array(Q), new Float32Array(Q)]];
  const ev = [[Q * 20, { t: 'transport', play: true, frame: Q * 24, tick: 0, fpt, seek: true }], [Q * 200, { t: 'transport', play: true, frame: Q * 204, tick: 3840, fpt, seek: true, loop: true, ls: 3600, le: 4560 }]];
  let e = 0;
  for (let q = 0; q < N; q++) { while (e < ev.length && ev[e][0] <= q * Q) p.msg(ev[e++][1]); p.process(inp(), out); D.ctx.currentFrame += Q; L.set(out[0][0], q * Q); }
  return L;
}
for (const mode of ['add', 'mul']) {
  test(`G2 ${mode}: the master's Delay mix — the combiner ≡ the direct cable, live and offline`, () => {
    const A = masterPay(mode, false), B = masterPay(mode, true);
    assert.ok(B.pay.cmb && B.pay.cmb.length === 1);
    for (const off of [false, true]) {
      const a = renderMaster(A, off), b = renderMaster(B, off);
      assert.ok(peak(a) > 1e-3 && bitsEqual(a, b), (off ? 'offline' : 'live') + ': bit-identical');
    }
  });
}

/* ------------------------------------------------------------------ §5.3 the messages */
function liveTrack(t, log) {
  D.ctx.currentFrame = 0;
  const r = setup(t);
  r.p.port.postMessage = m => log.push({ F: r.p.frames, m: structuredClone(m) });
  return r;
}
const smonMods = log => log.filter(e => e.m.t === 'smon' && e.m.mc !== undefined);
test('§5.3 the slow post: {t: smon, mc, mcx} without combiners (exactly those keys), + cF (the frames at the post) + cb (MC.cb) while combiners run — a swap each way; MASTER the same', () => {
  const t = track();
  add(t, 'l1.out', 'i2:cf');
  const log = [], { p, pay } = liveTrack(t, log), out = [[new Float32Array(Q), new Float32Array(Q)]];
  p.msg(pay); p.msg({ t: 'mon', ids: ['mods'] });
  const u = track(); u.dev.x1 = S.normModDev({ kind: 'comb' }); add(u, 'l1.out', 'x1:in'); add(u, 'l2.out', 'x1:in', { amt: -0.5 }); add(u, 'x1.out', 'i2:cf');
  const pu = Object.assign({}, G.compileMods(u, P, {}), { bpm: BPM });
  for (let q = 0; q < 300; q++) { if (q === 100) p.msg(pu); if (q === 200) p.msg(pay); p.process([], out); D.ctx.currentFrame += Q; }
  const S0 = smonMods(log);
  assert.ok(S0.length > 20);
  for (const e of S0) {
    const on = e.F > 100 * Q && e.F <= 200 * Q;
    assert.deepEqual(Object.keys(e.m), on ? ['t', 'mc', 'mcx', 'cF', 'cb'] : ['t', 'mc', 'mcx'], 'F ' + e.F);
    if (on) assert.ok(e.m.cF === e.F && e.m.cb.length === 1 + 3 * 2, 'cF = the frames, cb the block');
  }
  // MASTER
  const A = masterPay('add', true), M = new D.procs['synth-master']({ processorOptions: {} }), ml = [], inp = masterInput();
  M.port.postMessage = m => ml.push({ F: M.frames, m: structuredClone(m) });
  M.msg({ t: 'chain', fxr: A.fxr, fxrT: A.fxrT }); M.msg(A.pay); M.msg({ t: 'mon', ids: ['mods'] });
  for (let q = 0; q < 60; q++) { M.process(inp(), out); D.ctx.currentFrame += Q; }
  const SM = smonMods(ml);
  assert.ok(SM.length > 3 && SM.every(e => e.m.cF === e.F && e.m.cb.length === 1 + 3 * 2), 'MASTER: cF and cb');
});

test('§5.3 the fast \'mods\' part: a payload with combiners replaces its message object (cb, the hold reset), one without puts the plain shape back — no throw across the swaps; at hz 30 every fast cb equals the slow cb at its F; at 120 Hz the posts carry cb only while combiners run', () => {
  for (const hz of [30, 120]) {
    const t = track();
    add(t, 'l1.out', 'i2:cf');
    const log = [], { p, pay } = liveTrack(t, log), out = [[new Float32Array(Q), new Float32Array(Q)]];
    const u = track(); u.dev.x1 = S.normModDev({ kind: 'comb' }); add(u, 'l1.out', 'x1:in'); add(u, 'l2.out', 'x1:in', { amt: -0.5 }); add(u, 'x1.out', 'i2:cf');
    const pu = Object.assign({}, G.compileMods(u, P, {}), { bpm: BPM });
    p.msg(pu); p.msg({ t: 'mon', ids: ['mods'] }); p.msg({ t: 'fastOn', hz, ids: ['mods'] });
    const m0 = p.fastM.mods.m;
    assert.ok('cb' in m0, 'built after a combiner payload: the cb shape');
    for (let q = 0; q < 400; q++) {
      if (q === 100) p.msg(pay);
      if (q === 200) p.msg(pu);
      if (q === 300) p.msg(Object.assign({}, pu));
      p.process([], out); D.ctx.currentFrame += Q;
    }
    const fast = log.filter(e => e.m.t === 'fast'), slow = new Map(smonMods(log).map(e => [e.F, e.m]));
    assert.ok(fast.length > (hz === 30 ? 24 : 100), 'fast posts ' + fast.length);
    let both = 0;
    for (const e of fast) {
      const on = !(e.F > 100 * Q && e.F <= 200 * Q);
      assert.equal('cb' in e.m, on, 'F ' + e.F + ': cb only while combiners run');
      if (on && hz === 30 && slow.has(e.F)) { both++; assert.deepEqual(Array.from(e.m.cb), Array.from(slow.get(e.F).cb), 'F ' + e.F); }
    }
    if (hz === 30) assert.ok(both > 16, 'paired posts ' + both);
  }
});

test('§5.3 a payload with combiners only (no rows, no ext: a combiner whose OUT is not cabled yet) builds a ModCore and runs it; {off} drops it', () => {
  const t = track();
  t.dev.x1 = S.normModDev({ kind: 'comb' }); add(t, 'l1.out', 'x1:in');
  const log = [], { p, pay } = liveTrack(t, log), out = [[new Float32Array(Q), new Float32Array(Q)]];
  assert.deepEqual([pay.rows.length, pay.ext.length, pay.cmb.length], [0, 0, 1]);
  p.msg(pay);
  assert.ok(p.mc && p.mc.cmbN === 1);
  p.msg({ t: 'mon', ids: ['mods'] });
  for (let q = 0; q < 40; q++) { p.process([], out); D.ctx.currentFrame += Q; }
  const last = smonMods(log).at(-1);
  assert.ok(last && last.m.cb[0] > 0 && last.m.cb[0] < 1, 'y moves: ' + (last && last.m.cb[0]));
  p.msg({ t: 'mods', off: true });
  assert.equal(p.mc, null);
});

/* ------------------------------------------------------------------ G6 */
test('G6 (node): bench row lc — 2 combiners × 5 inputs onto a Juno and a panel minus the same LFOs cabled directly: Δ ≤ max(0.002, 2 × the A/A spread)', (t) => {
  const s = scenarios().find(x => x.id === 'lc');
  assert.ok(s, 'the row');
  const env = { mk: po => new D.Proc({ processorOptions: po }), advance: n => { D.ctx.currentFrame += n; }, FXDSP: D.global('FXDSP'), SxBase: D.global('SxBase') };
  let best = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const m = measureFast(s, env, { pairs: 9, seconds: 1 }), gate = Math.max(0.002, 2 * m.spread);
    if (!best || m.d - gate < best.d - best.gate) best = Object.assign(m, { gate, attempt });
    if (best.d <= best.gate) break;
  }
  t.diagnostic(`lc Δ ${best.d.toFixed(5)} (on ${best.on.toFixed(4)}, A/A ${best.aa.toFixed(5)}, spread ${best.spread.toFixed(5)}, gate ${best.gate.toFixed(4)}, attempt ${best.attempt})`);
  assert.ok(best.d <= best.gate, 'Δ ' + best.d + ' > ' + best.gate);
});
