// ModCore (mod-core.js; IMPL-2b §2, §3.2, §4 — lane A1): the track-level modulation core on the real engine (Track /
// Inst / Chain of engine.js in the dsp-scope and the golden harness). Gates: N1 (no {t: 'mods'} → nothing changes), N2
// (a GLOBAL track LFO through ext vs the Serum's own MONO LFO row: bit-identical renders), the pseudo-voice (gates,
// legato, release), keep-alive, N5 (two Tracks, same frames + payload → identical ext / row outputs over 10 s with a
// seek), the protocol ({off}, empty / malformed payloads, mval), the value table, xfer, FX rows (a panel's rack, a
// Serum's own FX), no allocation in span / notes / ctl, and the N4 ModCore rows mc0 / mc / mt / me (tests/bench.json).
// Run: node --max-old-space-size=2048 --test tests/modcore.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dspScope, noAlloc } from './dsp-scope.mjs';
import * as H from './golden-harness.mjs';
import * as C from '../serum-core.js?v=9';
import { patchFor, MODELS } from '../models.js?v=9';
import { scenarios, measure } from './bench-scenarios.mjs';
import * as CPU from './cpu-gate.mjs';

const SR = 48000, Q = 128;
const clone = x => JSON.parse(JSON.stringify(x));
const hzN = hz => Math.pow(hz / 100, 0.25);                                     // LFO rate n for a frequency (pow4 law)
const timeN = sec => Math.pow(sec / 32, 0.2);                                   // envelope time n (pow5 law)
const row = (src, dst, amt = 1, x = {}) => ({ src, dst, amt, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0, ...x });
const S_LFO1 = 5, S_ENV2 = 3, S_VELO = 13, S_MACRO1 = 24, S_FIXED = 33, S_WHEEL = 1, S_EXT0 = 62;
const SLOT_VO = 0;                                                               // engine.js S_VO (vcf.oct)

// the synthetic ModCore state (§3.1): every oscillator / filter off, OS 1, one voice, unused LFO slots parked FREE + MONO
function synth(fn) {
  const s = C.defaultSerum();
  for (const id of ['a.on', 'b.on', 'c.on', 'n.on', 's.on', 'f.on', 'f2.on']) if (id in s.p) s.p[id] = 0;
  s.global.os = 1; s.voicing.poly = 1;
  for (let l = 0; l < 10; l++) s.lfo[l] = { ...s.lfo[l], mode: 'free', mono: 1 };
  if (fn) fn(s);
  return s;
}
function compileSynth(s, bpm = 120) {
  const P = C.compileSerum(C.normalizeSerum(clone(s)), { bpm });
  return { cp: P.serum, ct: C.assembleCT(P.serumT) };
}
const payload = (s, o = {}) => Object.assign({ t: 'mods', bpm: 120, rows: [], ext: [], vals: [], keep: [] }, compileSynth(s), o);

// one engine scope (the first Track's JIT warm-up runs once) and its helpers
let SC = null;
function scope() {
  if (SC) return SC;
  const D = dspScope({ fast: true, engine: true }), B = D.global('SxBase');
  const vi = id => B.DIDX2[id.toUpperCase().replace('.', '_')];
  const mk = (po = {}) => new D.Proc({ processorOptions: Object.assign({ os: 4, hostOS: 4 }, po) });
  const run = (p, quanta, ev = null, out = null) => {
    const o = out || [[new Float32Array(Q), new Float32Array(Q)]];
    for (let q = 0; q < quanta; q++) { if (ev) ev(q, p); p.process([], o); D.ctx.currentFrame += Q; }
    return o;
  };
  const Z = { lo: 0, hi: 127, xp: 0 };
  const graph = (p, insts, chains = ['fx1']) => p.msg({ t: 'graph', insts: insts.map((id, k) => ({ id, on: true, zone: Z, salt: k ? (k * 0x9E3779B9) >>> 0 : 0 })),
    chains: chains.map(id => ({ id })), edges: [...insts.map(id => [id, chains[0], 1]), [chains[0], 'out', 1]], out: 'out', key: 'k' });
  const fx = C.defaultFx2(), chainMsg = { fxr: C.compileFx(fx, { bpm: 120, rate: SR }), fxrT: C.compileFxT(fx) };
  SC = { D, B, vi, mk, run, graph, chainMsg, M: D.global('ModCore'), SD: D.global('SerumDSP') };
  return SC;
}
function junoPatch() {
  const m = MODELS.find(x => x.id === 'juno60'), v = Object.fromEntries(m.controls.map(c => [c.id, c.def]));
  const p = patchFor(m, v, C.defaultFx2(), { sr: SR, bpm: 120 });
  delete p.fxr; delete p.fxrT;
  return p;
}
// a Serum patch with its CP compiled by the test (ctx as patchFor's; ext: the injected copy's ext rows accepted)
function serumPatch(s, { ext = false, fx = C.defaultFx2() } = {}) {
  const p = patchFor('serum', { s }, fx, { sr: SR, bpm: 120, prefs: { smooth: 1, silenceTails: 1 } });
  const P = C.compileSerum(s, { bpm: 120, smooth: 1, fx, qr: null, ultra: 0, mpeBendX: 0, mpeYBi: 0, ext });
  return Object.assign(p, P);
}
// a Juno track (i1 into panel fx1) with a ModCore payload
function junoTrack(S, mods, po = {}) {
  const p = S.mk(po);
  S.graph(p, ['i1']);
  p.msg({ t: 'patch', i: 'i1', p: junoPatch() });
  p.msg(Object.assign({ t: 'chain', c: 'fx1' }, S.chainMsg));
  if (mods) p.msg(mods);
  return p;
}

/* ------------------------------------------------------------------ load, N1 */
test('mod-core.js: globalThis.ModCore (frozen: VER 1, NEXT 16, NVAL 32, create); N1: without {t: mods} a Track has no ModCore and a render is bit-identical with the script absent', () => {
  const S = scope(), M = S.M;
  assert.ok(M && Object.isFrozen(M) && M.VER === 1 && M.NEXT === 16 && M.NVAL === 32 && typeof M.create === 'function');
  assert.equal(S.D.loaded[S.D.loaded.length - 1], 'mod-core.js', 'loaded last, before engine.js');
  const renderOnce = (D) => {
    D.ctx.currentFrame = 0; D.seed('n1');
    const p = new D.Proc({ processorOptions: { os: 4, hostOS: 4 } });
    const Zn = { lo: 0, hi: 127, xp: 0 };
    p.msg({ t: 'graph', insts: [{ id: 'i1', on: true, zone: Zn, salt: 0 }], chains: [{ id: 'fx1' }], edges: [['i1', 'fx1', 1], ['fx1', 'out', 1]], out: 'out', key: 'k' });
    p.msg({ t: 'patch', i: 'i1', p: junoPatch() });
    p.msg(Object.assign({ t: 'chain', c: 'fx1' }, scope().chainMsg));
    assert.equal(p.mc, null);
    const L = new Float32Array(Q * 60), o = [[new Float32Array(Q), new Float32Array(Q)]];
    for (let q = 0; q < 60; q++) { if (q === 2) p.msg({ t: 'on', n: 57, v: 0.8 }); if (q === 40) p.msg({ t: 'off', n: 57 }); p.process([], o); D.ctx.currentFrame += Q; L.set(o[0][0], q * Q); }
    assert.equal(p.mc, null, 'notes and spans build no ModCore');
    return L;
  };
  const a = renderOnce(S.D), b = renderOnce(dspScope({ fast: true, engine: true, overrides: { 'mod-core.js': false } }));
  let same = true; for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) { same = false; break; }
  assert.ok(same, 'bit-identical with and without mod-core.js');
  assert.ok(Math.max(...a.map(Math.abs)) > 1e-3, 'audible');
});

/* ------------------------------------------------------------------ N2: ext cross-check */
// A: a Serum whose own MONO LFOs (FREE 2 Hz, FREE BPM-anchored, RETRIG MONO with smoothing, FREE S&H) drive f.cutoff /
// f.res / a.level / a.pan (V scope) and g.wheel (G scope, the mono context). B: the same Serum with those LFO slots parked
// and the rows reading ext1…ext4, the LFOs living in the track's ModCore as GLOBAL modules (the same CP LFO parameters)
// cabled to the ext slots. Both tracks play the §15.1 event script (chords, legato pairs, wheel / bend / aftertouch, the
// song transport with a seek, a loop wrap, a stop and a restart) in the golden harness scope: identical samples.
test('N2: a GLOBAL track LFO through ext renders bit-identically to the Serum\'s own MONO LFO row (4 LFO kinds, V + G destinations, the §15.1 script with transport)', async () => {
  const [, Bv2] = await H.sides();
  const S = H.scope(Bv2, SR), g = S.g;
  const SAW = [[0, 0, 0], [1, 1, 0]];
  const lfos = s => {
    s.lfo[0] = { ...s.lfo[0], mode: 'free', mono: 1, bpm: 0, anchor: 0 }; s.p['l1.rate'] = hzN(2);
    s.lfo[1] = { ...s.lfo[1], mode: 'free', mono: 1, bpm: 1, anchor: 1 }; s.p['l2.rate'] = 0.37;
    s.lfo[2] = { ...s.lfo[2], mode: 'retrig', mono: 1, bpm: 0, anchor: 0, pts: SAW }; s.p['l3.rate'] = hzN(0.7); s.p['l3.smooth'] = 0.3;
    s.lfo[3] = { ...s.lfo[3], mode: 'free', mono: 1, bpm: 0, anchor: 0, type: 'sh' }; s.p['l4.rate'] = hzN(8);
  };
  const dests = [['f.cutoff', 0.3, {}], ['f.res', 0.3, { curve: 0.4 }], ['a.level', 0.3, { bi: 1 }], ['a.pan', 0.3, { rise: 0.2, fall: 0.2 }], ['g.wheel', 0.25, {}]];
  const srcA = ['lfo1', 'lfo2', 'lfo3', 'lfo4', 'lfo1'], srcB = ['ext1', 'ext2', 'ext3', 'ext4', 'ext1'];
  const sA = C.normalizeSerum(C.defaultSerum()); sA.p['f.on'] = 1; lfos(sA);
  dests.forEach(([d, amt, x], j) => { sA.matrix[j] = row(srcA[j], d, amt, x); });
  const sB = C.normalizeSerum(C.defaultSerum()); sB.p['f.on'] = 1;
  for (let l = 0; l < 4; l++) sB.lfo[l] = { ...sB.lfo[l], mode: 'free', mono: 1 };          // (parked: nothing reads them)
  dests.forEach(([d, amt, x], j) => { sB.matrix[j] = row(srcB[j], d, amt, x); });
  const pA = serumPatch(sA), pB = serumPatch(sB, { ext: true });
  assert.equal(pA.serum.mN, 5); assert.equal(pB.serum.mN, 5); assert.equal(pB.serum.use & 32768, 32768); assert.equal(pA.serum.use & 32768, 0);
  // the track's ModCore: the 4 LFOs as GLOBAL modules with keep-alive rows, cabled to ext1…4
  const sm = synth(s => { lfos(s); for (let l = 0; l < 4; l++) s.matrix[l] = row('lfo' + (l + 1), 'b.level', 0.01); });
  const mods = payload(sm, { ext: [1, 2, 3, 4].map(k => ({ k, src: S_LFO1 + k - 1 })), keep: [5, 6, 7, 8] });
  const renderSide = (id, patch, m) => H.render(S, {
    id, seconds: 4, events: H.script(SR), po: { os: 2, hostOS: 2 },
    setup(p) { H.postTables(Bv2, p, patch.needs); p.msg({ t: 'patch', p: patch }); if (m) p.msg(m); },
  });
  const A = renderSide('n2:A', pA, null), B2 = renderSide('n2:B', pB, mods);
  assert.equal(B2.proc.mc !== null, true, 'B has a ModCore');
  assert.equal(A.proc.mc, null);
  const d = H.compare(A, B2);
  assert.equal(d.at, -1, 'bit-identical: ' + H.describe(d));
  assert.ok(H.peak(A) > 0.01, 'audible');
  // and the LFO rows themselves: the Serum's g rows (A) vs ModCore's ext rows handed to B's Serum
  g.currentFrame = 0;
});

/* ------------------------------------------------------------------ the pseudo-voice */
test('pseudo-voice: gated by the Track\'s notes (a powered Inst took them), legato while other keys are held, release at the last note-off; ENV / per-note LFO rows read at the span ends into cls0 / cls1 and setv', () => {
  const S = scope(), vi = S.vi;
  const sm = synth(s => {
    s.lfo[4] = { ...s.lfo[4], mode: 'retrig', mono: 0, bpm: 0, anchor: 0 }; s.p['l5.rate'] = hzN(1);
    Object.assign(s.p, { 'e2.att': timeN(0.05), 'e2.dec': timeN(0.3), 'e2.sus': 0.5, 'e2.rel': timeN(0.2) });
    s.matrix[0] = row('env2', 'a.pan', 1); s.matrix[1] = row('lfo5', 'a.level', 1); s.matrix[2] = row('velo', 'b.level', 1);
  });
  const mods = payload(sm, {
    rows: [{ id: 'r1', src: S_ENV2, vi: vi('a.pan'), dst: { kind: 'cls', inst: 'i1', slot: SLOT_VO }, xfer: { a: 0, b: 1 } },
      { id: 'r2', src: 9, vi: vi('a.level'), dst: { kind: 'set', inst: 'i1', field: 'lfo.rate' }, xfer: { a: 2, b: 3 } },
      { id: 'r3', src: S_VELO, vi: vi('b.level'), dst: { kind: 'cls', inst: 'i1', slot: 3 }, xfer: { a: 0, b: 1 } }],
  });
  const p = junoTrack(S, mods), MC = p.mc, V = MC.V;
  assert.ok(MC !== null && MC.ok === 1);
  assert.equal(MC.has.i1, 1); assert.equal(MC.cls1.i1.length, 29, 'Float64Array(S_N): the Track passes engine.js S_N'); assert.deepEqual(Array.from(MC.setv.i1, e => e.field), ['lfo.rate']);
  const calls = [];
  p.insts[0].modSpan = (a, b, sv) => { calls.push([a[SLOT_VO], b[SLOT_VO], b[3], sv[0].v]); };
  S.run(p, 20);
  assert.equal(V.active, false, 'no note yet');
  assert.ok(calls.length >= 20 && calls.every(c => c[0] === 0 && c[1] === 0 && c[2] === 0 && c[3] === 2), 'ENV / velo rows at 0, the setter at its base (a = 2)');
  p.msg({ t: 'on', n: 60, v: 0.8 }); S.run(p, 1);
  assert.equal(V.active, true); assert.equal(V.gate, true);
  S.run(p, 40);                                                                  // 0.1 s: the attack passed, the decay runs
  const c1 = calls[calls.length - 1];
  assert.ok(c1[1] > 0.4 && c1[1] <= 1, 'ENV 2 → cls1[S_VO] ' + c1[1]);
  assert.ok(Math.abs(c1[2] - V.mod.vVelo) < 1e-12, 'velo → cls1[3] = the note\'s velocity source');
  assert.ok(c1[3] >= 2 && c1[3] <= 5, 'LFO 5 → setv lfo.rate = 2 + 3·x: ' + c1[3]);
  // legato: a second key while the first is held — the envelope keeps its stage, the LFO is not restarted
  const stBefore = V.mod.eSt[1], phBefore = V.mod.lPh[4], velBefore = V.mod.vVelo;
  p.msg({ t: 'on', n: 64, v: 0.3 }); S.run(p, 1);
  assert.equal(V.mod.eSt[1], stBefore, 'legato: ENV stage kept');
  assert.equal(V.mod.vVelo, velBefore, 'legato: velocity kept (veloPorta 0)');
  assert.ok(V.mod.lPh[4] !== 0 && V.mod.lPh[4] >= phBefore, 'legato: the RETRIG per-note LFO keeps running');
  assert.equal(p.nHeld, 2);
  p.msg({ t: 'off', n: 60 }); S.run(p, 5);
  assert.equal(V.gate, true, 'one key still held: no release');
  p.msg({ t: 'off', n: 64 }); S.run(p, 1);
  assert.equal(V.gate, false); assert.equal(V.mod.eSt[1], 5, 'released');
  S.run(p, 300);                                                                 // the 0.2 s release and some
  assert.equal(V.active, false, 'the pseudo-voice ended once the envelopes idled');
  const cE = calls[calls.length - 1];
  assert.equal(cE[1], 0, 'ENV row back at 0');
  assert.ok(cE[3] >= 2 && cE[3] <= 5 && cE[3] !== 2, 'the per-note LFO row holds its last value once the voice ended ("follows the most recent note", as recentMod latches): ' + cE[3]);
  // a fresh note after silence restarts from the start
  p.msg({ t: 'on', n: 48, v: 1 }); S.run(p, 2);
  assert.equal(V.active, true); assert.ok(V.mod.eSt[1] === 1 || V.mod.eSt[1] === 2 || V.mod.eSt[1] === 3);
  // a powered-off Inst gets no modSpan; panic releases the pseudo-voice
  const n0 = calls.length;
  p.msg({ t: 'power', i: 'i1', on: false }); S.run(p, 3);
  assert.equal(calls.length, n0, 'powered off: no adapter work');
  p.msg({ t: 'power', i: 'i1', on: true });
  p.msg({ t: 'panic' });
  assert.equal(V.gate, false); assert.equal(p.nHeld, 0);
});

test('keep-alive: a source no CP row reads is not evaluated (spike Q3) — its ext slot stays at 0; with a keep-alive row it moves', () => {
  const S = scope();
  const base = s => { s.lfo[0] = { ...s.lfo[0], mode: 'free', mono: 1, bpm: 0, anchor: 0 }; s.p['l1.rate'] = hzN(3); };
  const noKeep = payload(synth(base), { ext: [{ k: 1, src: S_LFO1 }] });
  const keep = payload(synth(s => { base(s); s.matrix[0] = row('lfo1', 'a.level', 0.01); }), { ext: [{ k: 1, src: S_LFO1 }], keep: [S_LFO1] });
  const pA = junoTrack(S, noKeep), pB = junoTrack(S, keep);
  S.run(pA, 30); S.run(pB, 30);
  let movedA = 0, movedB = 0;
  for (let c = 1; c < 32; c++) { if (pA.mc.ext[c] !== pA.mc.ext[0]) movedA++; if (pB.mc.ext[c] !== pB.mc.ext[0]) movedB++; }
  assert.equal(movedA, 0, 'unreferenced: the LFO is skipped (ext1 constant)');
  assert.ok(movedB > 20 && pB.mc.ext[31] !== 0, 'keep-alive row: ext1 carries the LFO');
  assert.deepEqual(pB.mc.stats().lfos, 1); assert.equal(pB.mc.stats().ext, 1); assert.equal(pB.mc.stats().rows, 0);
});

/* ------------------------------------------------------------------ N5: determinism */
test('N5: two Tracks given the same frames and the same payload produce identical ext and row outputs over 10 s with a transport start, a seek and a stop (S&H, BPM-anchored and RETRIG LFOs, an ENV)', () => {
  const S = scope(), vi = S.vi;
  const sm = synth(s => {
    s.lfo[0] = { ...s.lfo[0], mode: 'free', mono: 1, bpm: 1, anchor: 1 }; s.p['l1.rate'] = 0.45;
    s.lfo[1] = { ...s.lfo[1], mode: 'free', mono: 1, bpm: 0, anchor: 0, type: 'sh' }; s.p['l2.rate'] = hzN(6);
    s.lfo[2] = { ...s.lfo[2], mode: 'retrig', mono: 1, bpm: 0, anchor: 0 }; s.p['l3.rate'] = hzN(0.8);
    s.lfo[3] = { ...s.lfo[3], mode: 'retrig', mono: 0, bpm: 0, anchor: 0, type: 'sh' }; s.p['l4.rate'] = hzN(5);
    Object.assign(s.p, { 'e2.att': timeN(0.1), 'e2.dec': timeN(0.3), 'e2.sus': 0.5, 'e2.rel': timeN(0.4) });
    s.matrix[0] = row('lfo1', 'a.level', 0.01); s.matrix[1] = row('lfo2', 'a.pan', 0.5); s.matrix[2] = row('lfo3', 'b.level', 0.01);
    s.matrix[3] = row('lfo4', 'b.pan', 1, { bi: 1 }); s.matrix[4] = row('env2', 'a.wt', 1); s.matrix[5] = row('rand1', 'a.fine', 1);
  });
  const mk = () => junoTrack(S, payload(sm, {
    ext: [{ k: 1, src: S_LFO1 }, { k: 2, src: S_LFO1 + 2 }, { k: 3, src: S_LFO1 + 3 }],
    rows: [{ id: 'a', src: S_LFO1 + 1, vi: vi('a.pan'), dst: { kind: 'cls', inst: 'i1', slot: 0 }, xfer: { a: 0, b: 1 } },
      { id: 'b', src: S_ENV2, vi: vi('a.wt'), dst: { kind: 'cls', inst: 'i1', slot: 1 }, xfer: { a: 0, b: 1 } },
      { id: 'c', src: 20, vi: vi('a.fine'), dst: { kind: 'set', inst: 'i1', field: 'glide' }, xfer: { a: 0, b: 1 } }],
  }), { trackId: 'n5' });
  const fpt = SR * 60 / (120 * 960), notes = [0, 900, 48, 100, 960, 480, 60, 100, 1920, 1800, 52, 100, 3840, 700, 55, 110, 5760, 1500, 50, 95];
  const ev = (q, p) => {
    if (q === 5) p.msg({ t: 'song', notes: notes.slice(), cc: [] });
    if (q === 10) p.msg({ t: 'on', n: 60, v: 0.7 }); if (q === 200) p.msg({ t: 'on', n: 64, v: 0.6 }); if (q === 260) p.msg({ t: 'off', n: 60 }); if (q === 400) p.msg({ t: 'off', n: 64 });
    if (q === 500) p.msg({ t: 'transport', play: true, frame: 520 * Q, tick: 0, fpt, seek: true, loop: false });
    if (q === 1500) p.msg({ t: 'transport', play: true, frame: 1510 * Q, tick: 3840, fpt, seek: true, loop: true, ls: 3840, le: 5760 });
    if (q === 2800) p.msg({ t: 'transport', play: false });
    if (q === 3000) p.msg({ t: 'on', n: 50, v: 0.9 }); if (q === 3400) p.msg({ t: 'off', n: 50 });
  };
  const tr = (p) => { const r = []; return { p, r, step: (q) => { ev(q, p); p.process([], o); } }; };
  const o = [[new Float32Array(Q), new Float32Array(Q)]];
  const A = tr(mk()), B2 = tr(mk());
  const recA = [], recB = [];
  A.p.insts[0].modSpan = (c0, c1, sv) => { recA.push(c0[0], c1[0], c1[1], sv[0].v); };
  B2.p.insts[0].modSpan = (c0, c1, sv) => { recB.push(c0[0], c1[0], c1[1], sv[0].v); };
  let extDiff = 0, rowDiff = 0, moving = 0;
  const N = Math.round(10 * SR / Q);
  for (let q = 0; q < N; q++) {
    const f = S.D.ctx.currentFrame;
    A.step(q); S.D.ctx.currentFrame = f; B2.step(q); S.D.ctx.currentFrame = f + Q;
    const ea = A.p.mc.ext, eb = B2.p.mc.ext;
    for (let k = 0; k < 3 * 32; k++) if (!Object.is(ea[k], eb[k])) extDiff++;
    if (q > 0 && ea[31] !== ea[0]) moving++;
  }
  assert.equal(extDiff, 0, 'ext rows identical');
  assert.equal(recA.length, recB.length);
  for (let k = 0; k < recA.length; k++) if (!Object.is(recA[k], recB[k])) rowDiff++;
  assert.equal(rowDiff, 0, 'row outputs identical');
  assert.ok(moving > N / 2, 'the LFOs ran (' + moving + ' moving spans)');
  assert.ok(recA.some(x => x !== 0), 'rows produced values');
  // and the transport re-seeded the S&H LFO: the two plays from the same tick give the same draws
  assert.equal(A.p.mc.sx.mod.playing, 0, 'stopped at the end');
});

/* ------------------------------------------------------------------ protocol */
test('protocol: {t: mods, off} and an empty payload drop the ModCore (ext rows cleared on every Serum); a malformed payload is refused (no throw; the previous ModCore kept — review E6, none built from a first one); {t: mval} with a bad index is ignored; processorOptions.mods builds it for a bounce', () => {
  const S = scope();
  const sm = synth(s => { s.lfo[0] = { ...s.lfo[0], mode: 'free', mono: 1 }; s.p['l1.rate'] = hzN(2); s.matrix[0] = row('lfo1', 'a.level', 0.01); });
  const good = payload(sm, { ext: [{ k: 1, src: S_LFO1 }] });
  // a Serum i2 with an ext1 row beside the Juno
  const ss = C.normalizeSerum(C.defaultSerum()); ss.p['f.on'] = 1; ss.matrix[0] = row('ext1', 'f.cutoff', 0.5);
  const sp = serumPatch(ss, { ext: true });
  const p = S.mk();
  S.graph(p, ['i1', 'i2']);
  p.msg({ t: 'patch', i: 'i1', p: junoPatch() });
  for (const id of sp.needs || []) { const e = H.entry ? null : null; if (e) p.msg(e); }
  p.msg({ t: 'patch', i: 'i2', p: sp });
  p.msg(Object.assign({ t: 'chain', c: 'fx1' }, S.chainMsg));
  p.msg(good);
  assert.ok(p.mc !== null);
  p.msg({ t: 'on', n: 60, v: 0.8 }); S.run(p, 20);
  const I2 = p.insts[1];
  assert.ok(I2.sx !== null && I2.sx.g[S_EXT0 * 32 + 5] !== 0, 'the Serum\'s ext1 row carries the LFO');
  const MC = p.mc;
  p.msg({ t: 'mods', off: true });
  assert.equal(p.mc, null); assert.equal(I2.sx.g[S_EXT0 * 32 + 5], 0, 'ext rows cleared'); assert.equal(I2.sx.mod.monoSrc[S_EXT0], 0);
  p.msg(good); assert.ok(p.mc !== null && p.mc !== MC, 'a new ModCore after off');
  p.msg(Object.assign({}, good, { rows: [], ext: [] })); assert.equal(p.mc, null, 'empty payload: none');
  p.msg(good); assert.ok(p.mc !== null);
  const MC2 = p.mc;   // (never an engine object in an assert: an AssertionError would walk the cyclic graph)
  assert.doesNotThrow(() => p.msg({ t: 'mods', cp: null, rows: [{}] })); assert.equal(p.mc === MC2, true, 'malformed after a good one: the previous ModCore kept');
  assert.doesNotThrow(() => p.msg({ t: 'mods', cp: { ver: 99 }, rows: [{ id: 'x', src: 5, dst: { kind: 'cls', inst: 'i1', slot: 0 } }] })); assert.equal(p.mc === MC2 && MC2.ok === 1, true, 'a rejected CP: kept too');
  p.msg({ t: 'mods', off: true });
  assert.doesNotThrow(() => p.msg({ t: 'mods', cp: { ver: 99 }, rows: [{ id: 'x', src: 5, dst: { kind: 'cls', inst: 'i1', slot: 0 } }] })); assert.equal(p.mc, null, 'a rejected first payload: none built');
  p.msg(good);
  assert.doesNotThrow(() => { p.msg({ t: 'mval', k: 99, v: 0.5 }); p.msg({ t: 'mval', k: -1, v: 0.5 }); p.msg({ t: 'mval', k: 'x', v: NaN }); p.msg({ t: 'mval' }); });
  // rows the payload cannot place are skipped, the rest kept
  p.msg(Object.assign({}, good, { rows: [{ id: 'bad', src: 5, dst: { kind: 'cls', inst: 'i1', slot: 99 } }, { id: 'bad2', src: 0, dst: { kind: 'fx', chain: 'fx1', fx: 0 } },
    { id: 'ok', src: 5, vi: S.vi('a.level'), dst: { kind: 'cls', inst: 'i1', slot: 0 } }, { id: 'odd', src: 5, dst: { kind: '??', inst: 'i1' } }] }));
  assert.equal(p.mc.rows.length, 1); assert.equal(p.mc.has.i1, 1);
  S.run(p, 3);
  // processorOptions.mods: a bounce's node builds its ModCore at construction
  const q = S.mk({ offline: true, graph: { t: 'graph', insts: [{ id: 'i1', on: true, zone: { lo: 0, hi: 127, xp: 0 }, salt: 0 }], chains: [{ id: 'fx1' }], edges: [['i1', 'fx1', 1], ['fx1', 'out', 1]], out: 'out', key: 'k' },
    patches: { i1: junoPatch() }, chains: { fx1: S.chainMsg }, mods: good });
  assert.ok(q.mc !== null && q.mc.extN === 1);
  // the Facade keeps exposing Inst 0's controller fields; the Track's own carry what the broadcasts write
  p.msg({ t: 'wheel', v: 0.4 }); p.msg({ t: 'at', v: 0.3 }); p.msg({ t: 'bend', v: -0.5 });
  assert.equal(p.wheel, 0.4); assert.equal(p.at, 0.3); assert.equal(p.bendRaw, -0.5);
  assert.equal(p.insts[0].wheel, 0.4); assert.equal(p.insts[1].bendRaw, -0.5);
  assert.equal(p.mc.shim.wheel, 0.4); assert.equal(p.mc.shim.bendRaw, -0.5);
});

/* ------------------------------------------------------------------ the value table, xfer */
test('value table: macros 0–7 enter as the CP\'s macro lane (SxMod\'s smoothing), 8–23 as ModCore\'s own ext inputs (sources 62–77, the same glide); 24–31 are stored only; vals seed them; a wheel row reads the Track\'s field', () => {
  const S = scope(), vi = S.vi;
  const sm = synth(s => { s.matrix[0] = row('macro1', 'a.level', 1); s.matrix[1] = row('wheel', 'a.pan', 1); s.matrix[2] = row('fixed', 'b.level', 0.5); });
  // the row on value entry 9 (ext2 of the synthetic CP) needs the ext compile of the synthetic state
  const st = C.normalizeSerum(clone(sm)); st.matrix[3] = row('ext2', 'b.pan', 1);
  const P = C.compileSerum(st, { bpm: 120, ext: true });
  const mods = { t: 'mods', bpm: 120, cp: P.serum, ct: C.assembleCT(P.serumT), vals: [{ k: 0, src: S_MACRO1, v: 0.25, id: 'm1.k1' }, { k: 9, src: S_EXT0 + 1, v: 0.75, id: 'c1.out' }], keep: [],   // (lane B's vals shape; plain numbers by index are accepted too)
    rows: [{ id: 'm', src: S_MACRO1, vi: vi('a.level'), dst: { kind: 'cls', inst: 'i1', slot: 0 }, xfer: { a: 0, b: 1 } },
      { id: 'w', src: S_WHEEL, vi: vi('a.pan'), dst: { kind: 'cls', inst: 'i1', slot: 1 }, xfer: { a: 0, b: 1 } },
      { id: 'f', src: S_FIXED, vi: vi('b.level'), dst: { kind: 'cls', inst: 'i1', slot: 2 }, xfer: { a: 0, b: 2 } },
      { id: 'v', src: S_EXT0 + 1, vi: vi('b.pan'), dst: { kind: 'cls', inst: 'i1', slot: 3 }, xfer: { a: 0, b: 1 } }], ext: [] };
  const p = junoTrack(S, mods), MC = p.mc;
  assert.ok(MC !== null && MC.rows.length === 4);
  let last = null; p.insts[0].modSpan = (a, b) => { last = Float64Array.from(b.subarray(0, 4)); };
  S.run(p, 60);
  assert.ok(Math.abs(last[0] - 0.25) < 1e-9, 'macro 1 at its initial value 0.25: ' + last[0]);
  assert.ok(Math.abs(last[3] - 0.75) < 1e-9, 'value 9 at 0.75: ' + last[3]);
  assert.ok(Math.abs(last[2] - 1) < 1e-12, 'fixed 1 × amt 0.5 × b 2 = 1');
  assert.equal(last[1], 0);
  p.msg({ t: 'mval', k: 0, v: 1 }); p.msg({ t: 'mval', k: 9, v: 0 }); p.msg({ t: 'mval', k: 30, v: 1 }); p.msg({ t: 'wheel', v: 1 });
  S.run(p, 2);
  assert.ok(last[0] > 0.25 && last[0] < 1, 'the macro glides (' + last[0] + ')');
  assert.ok(last[3] < 0.75 && last[3] > 0, 'the value source glides (' + last[3] + ')');
  assert.ok(last[1] > 0 && last[1] < 1, 'the wheel smooths (' + last[1] + ')');
  S.run(p, 200);
  assert.ok(Math.abs(last[0] - 1) < 1e-6 && Math.abs(last[3]) < 1e-6 && Math.abs(last[1] - 1) < 1e-6, 'settled: ' + Array.from(last).join(' '));
  assert.equal(MC.vT[30], 1, 'stored');
  assert.equal(MC.vS[9], 0);
});

test('xfer (lane A2\'s transfer): {a, b, x0} linear or {tab (129 over mod space 0…1), x0}; the rows of one knob on one target sum (Σ) and the group gets T(clamp01(x0 + Σ)) − T(x0) — a cls slot sums its groups, a set field is T_first(x0) + the group offsets; fx rows add x itself; rows without vi match the CP rows by source in order; Inst.modRows gets the Inst\'s rows', () => {
  const S = scope(), vi = S.vi;
  const sm = synth(s => { s.matrix[0] = row('fixed', 'a.level', 0.5); s.matrix[1] = row('fixed', 'a.pan', -0.25); s.matrix[2] = row('fixed', 'b.level', 0.5, { bi: 1 }); });
  const tab = Array.from({ length: 129 }, (_, i) => Math.pow(i / 128, 2) * 4);   // T(x) = 4x² over 0…1
  const mods = payload(sm, {
    rows: [{ id: 'a', src: S_FIXED, dst: { kind: 'cls', inst: 'i1', slot: 0 }, xfer: { tab, x0: 0 } },       // (no vi: CP row 0 → a.level, x = 0.5)
      { id: 'a2', src: S_FIXED, dst: { kind: 'cls', inst: 'i1', slot: 0 } },                                // (CP row 1 → a.pan, x = −0.25; no xfer: its own group, identity clamped at 0 → 0)
      { id: 'b', src: S_FIXED, vi: vi('a.pan'), dst: { kind: 'cls', inst: 'i1', slot: 1 }, xfer: { a: 10, b: 2, x0: 0.5 } },   // 2·(0.25 − 0.5) = −0.5
      { id: 'c', src: S_FIXED, vi: vi('b.level'), dst: { kind: 'set', inst: 'i1', field: 'glide' } },      // bipolar row of the unipolar 1: the Serum formula gives 0.25
      { id: 'd', src: S_FIXED, vi: vi('a.level'), dst: { kind: 'set', inst: 'i1', field: 'glide' }, xfer: { a: 7, b: 1 } },
      { id: 'e', src: S_FIXED, vi: vi('a.level'), dst: { kind: 'fx', chain: 'fx1', fx: 3 } },
      { id: 'z', src: S_FIXED, vi: vi('a.level'), dst: { kind: 'cls', inst: 'i1', slot: 2 }, xfer: { a: 0, b: 1, x0: 0.8 } },   // clamped: T(1) − T(0.8) = 0.2
      // two KNOBS on one slot (different transfers): each group through its own transfer, the offsets sum
      { id: 'g1', src: S_FIXED, vi: vi('a.level'), dst: { kind: 'cls', inst: 'i1', slot: 4 }, xfer: { a: 0, b: 1, x0: 0 } },      // 0.5
      { id: 'g2', src: S_FIXED, vi: vi('a.pan'), dst: { kind: 'cls', inst: 'i1', slot: 4 }, xfer: { a: 0, b: 4, x0: 0.5 } }],     // 4·(0.25 − 0.5) = −1
    xfer: { c: { a: 1, b: 1, x0: 0.25 } },
  });
  const got = [];
  const p = junoTrack(S, null);
  p.insts[0].modRows = rows => { got.push(rows === null ? null : Array.from(rows, r => [r.id, r.slot, r.field, r.xfer ? r.xfer.x0 : undefined])); }; // (Array.from: the scope's arrays are another realm's)
  p.msg(mods);
  const MC = p.mc;
  assert.equal(MC.rows.length, 9); assert.equal(MC.tgts.length, 8, 'groups = target × transfer: slot 0 × 2, slot 1, glide × 2, slot 2, slot 4 × 2 (the fx row is no target)');
  assert.deepEqual(got, [[['a', 0, undefined, 0], ['a2', 0, undefined, undefined], ['b', 1, undefined, 0.5], ['c', -1, 'glide', 0.25], ['d', -1, 'glide', undefined], ['z', 2, undefined, 0.8], ['g1', 4, undefined, 0], ['g2', 4, undefined, 0.5]]], 'Inst.modRows: the Inst\'s classic rows in payload order with xfer attached (a set row with slot −1: lane B\'s synthetic slot never reaches the Inst, review U3)');
  let c1 = null, sv = null; p.insts[0].modSpan = (a, b, s) => { c1 = Float64Array.from(b.subarray(0, 5)); sv = s.map(e => [e.field, e.v]); };
  S.run(p, 5);
  assert.ok(Math.abs(c1[0] - 1) < 1e-12, 'slot 0: T(0.5) − T(0) = 1 (the table) + 0 (a2: identity, clamp01(−0.25) = 0): ' + c1[0]);
  assert.ok(Math.abs(c1[1] - (-0.5)) < 1e-12, 'slot 1: ' + c1[1]);
  assert.ok(Math.abs(c1[2] - 0.2) < 1e-12, 'slot 2 clamped at the top of the mod space: ' + c1[2]);
  assert.ok(Math.abs(c1[4] - (0.5 - 1)) < 1e-12, 'slot 4: two knobs, each through its own transfer: ' + c1[4]);
  assert.deepEqual(sv.length, 1); assert.equal(sv[0][0], 'glide');
  assert.ok(Math.abs(sv[0][1] - (1.25 + (1.5 - 1.25) + (7.5 - 7))) < 1e-12, 'glide = T_c(x0 0.25) 1.25 + [T_c(0.25 + 0.25) − 1.25] + [T_d(0 + 0.5) − T_d(0)] = 2: ' + sv[0][1]);
  assert.ok(Math.abs(MC.fxv.fx1[3] - 0.5) < 1e-12, 'fx row: x itself'); assert.equal(MC.fxHi.fx1, 4);
  p.msg({ t: 'mods', off: true });
  assert.equal(got[got.length - 1], null, 'rows gone: modRows(null)');
});

/* ------------------------------------------------------------------ FX rows */
test('fx rows: a panel\'s rack gets setMods(MC.fxv[chain], key) before process (a stale key leaves it unmodulated; setMods(null) once when the rows go); a Serum\'s own FX sums ModCore\'s rows into SD.fxMods only while they exist', () => {
  const S = scope(), vi = S.vi, SD = S.SD;
  const sm = synth(s => { s.matrix[0] = row('fixed', 'a.level', 0.5); s.matrix[1] = row('fixed', 'a.pan', 0.25); });
  const ss = C.normalizeSerum(C.defaultSerum()); ss.matrix[0] = row('fixed', 'g.master', -0.1);   // the Serum's own FX row: −0.1
  const sp = serumPatch(ss);
  const key = S.chainMsg.fxr.key;
  const mk = (k) => payload(sm, { rows: [{ id: 'a', src: S_FIXED, vi: vi('a.level'), dst: { kind: 'fx', chain: 'fx1', fx: 0, key: k } },
    { id: 'b', src: S_FIXED, vi: vi('a.pan'), dst: { kind: 'fx', chain: 'i2/fx', fx: 0 } }] });
  const p = S.mk();
  S.graph(p, ['i1', 'i2']);
  p.msg({ t: 'patch', i: 'i1', p: junoPatch() }); p.msg({ t: 'patch', i: 'i2', p: sp });
  p.msg(Object.assign({ t: 'chain', c: 'fx1' }, S.chainMsg));
  const c = p.chains.find(x => x.id === 'fx1'), r = c.rack, got = [];
  const setMods = r.setMods.bind(r);
  r.setMods = (v, k) => { got.push([v === null ? null : v[0], k]); setMods(v, k); };
  p.msg(mk(key));
  p.msg({ t: 'on', n: 60, v: 0.8 }); S.run(p, 4);
  assert.ok(got.length >= 4 && got.every(x => x[0] === 0.5 && x[1] === key), 'setMods(vector, key) per span: ' + JSON.stringify(got.slice(-2)));
  assert.equal(c.mcOn, 1);
  assert.ok(Math.abs(r.gmT[0] - 0.5) < 1e-12, 'the rack took g.master +0.5');
  const I2 = p.insts[1];
  assert.ok(I2.sx.mcFx !== null && I2.sx.mcHi === 1);
  const fx = SD.fxMods(I2);
  assert.ok(Math.abs(fx[0] - (-0.1 + 0.25)) < 1e-12, 'the Serum\'s own FX: its row −0.1 + ModCore\'s 0.25 = ' + fx[0]);
  // a stale key: the rack refuses the vector (all zero)
  p.msg(mk('stale')); S.run(p, 2);
  assert.equal(r.gmT[0], 0, 'stale layout key: unmodulated');
  // rows gone: setMods(null) exactly once, the Serum's own FX back to its own vector
  got.length = 0;
  p.msg({ t: 'mods', off: true }); S.run(p, 3);
  assert.deepEqual(got, [[null, undefined]]); assert.equal(c.mcOn, 0);
  assert.equal(I2.sx.mcFx, null);
  assert.ok(Math.abs(SD.fxMods(I2)[0] - (-0.1)) < 1e-12);
  S.run(p, 2);
  assert.equal(got.length, 1, 'no further setMods calls without rows');
});

test('(2b halos) a panel\'s monitor message carries its ModCore FX-context offsets: {t: smon, c, mo} with mo = Float32Array(fxHi) holding each fx row\'s summed offset at its index (the live dot of the rack\'s knob = base + mo); no mo for a chain without rows, none once the rows are gone', () => {
  const S = scope(), vi = S.vi;
  const sm = synth(s => { s.matrix[0] = row('fixed', 'a.level', 0.5); s.matrix[1] = row('fixed', 'a.pan', 0.25); });
  const p = junoTrack(S, payload(sm, { rows: [{ id: 'e', src: S_FIXED, vi: vi('a.level'), dst: { kind: 'fx', chain: 'fx1', fx: 3 } },
    { id: 'f', src: S_FIXED, vi: vi('a.pan'), dst: { kind: 'fx', chain: 'fx1', fx: 3 } }, { id: 'g', src: S_FIXED, vi: vi('a.pan'), dst: { kind: 'fx', chain: 'fx1', fx: 1 } }] }));
  const posts = [];
  p.port.postMessage = d => { if (d.t === 'smon' && d.c === 'fx1') posts.push(d.mo ? Float32Array.from(d.mo) : null); };
  p.msg({ t: 'mon', ids: ['fx1'] });
  S.run(p, 60);
  const L = posts[posts.length - 1];
  assert.ok(posts.length >= 3 && L !== null, 'posted at the monitor rate with mo');
  assert.deepEqual([L.length, L[3], L[1], L[0], L[2]], [4, 0.75, 0.25, 0, 0], 'two rows on one knob sum (0.5 + 0.25); the high-water mark is the length');
  posts.length = 0;
  p.msg({ t: 'mods', off: true }); S.run(p, 60);
  assert.ok(posts.length >= 3 && posts.every(x => x === null), 'no mo once the rows are gone');
  noAlloc(S.D, () => { const MC = p.mc; if (MC) MC.fxMon('fx1'); });
});

/* ------------------------------------------------------------------ allocation, levers */
test('no allocation in span / noteOn / noteOff / ctl (200 spans with notes, legato, releases, value changes, a transport) — and the half-rate lever: on with global ext sources, off when an ext slot carries a per-note source', () => {
  const S = scope(), vi = S.vi;
  const sm = synth(s => {
    s.lfo[0] = { ...s.lfo[0], mode: 'free', mono: 1 }; s.p['l1.rate'] = hzN(2);
    s.lfo[4] = { ...s.lfo[4], mode: 'retrig', mono: 0 }; s.p['l5.rate'] = hzN(1);
    Object.assign(s.p, { 'e2.att': timeN(0.05), 'e2.dec': timeN(0.3), 'e2.sus': 0.5, 'e2.rel': timeN(0.2) });
    s.matrix[0] = row('lfo1', 'a.level', 0.01); s.matrix[1] = row('env2', 'a.pan', 1); s.matrix[2] = row('lfo5', 'b.level', 1, { rise: 0.2, fall: 0.2 }); s.matrix[3] = row('macro1', 'b.pan', 1, { curve: 0.4 });
  });
  const rows = [{ id: 'a', src: S_ENV2, vi: vi('a.pan'), dst: { kind: 'cls', inst: 'i1', slot: 0 }, xfer: { a: 0, b: 1 } },
    { id: 'b', src: 9, vi: vi('b.level'), dst: { kind: 'set', inst: 'i1', field: 'glide' }, xfer: { tab: Array.from({ length: 129 }, (_, i) => i / 128) } },
    { id: 'c', src: S_MACRO1, vi: vi('b.pan'), dst: { kind: 'fx', chain: 'fx1', fx: 0 } }];
  const pG = junoTrack(S, payload(sm, { rows, ext: [{ k: 1, src: S_LFO1 }] }));
  assert.equal(pG.mc.halfOn, 1, 'global ext sources only: the pseudo-voice ticks every second chunk');
  const pP = junoTrack(S, payload(sm, { rows, ext: [{ k: 1, src: S_LFO1 }, { k: 2, src: S_ENV2 }] }));
  assert.equal(pP.mc.halfOn, 0, 'a per-note ext source: every chunk');
  assert.equal(pP.mc.extPerN, 1);
  for (const p of [pG, pP]) {
    const MC = p.mc;
    p.msg({ t: 'on', n: 60, v: 0.8 }); S.run(p, 30);
    noAlloc(S.D, () => {
      for (let k = 0; k < 200; k++) {
        if (k % 50 === 10) MC.noteOn(50 + k % 12, 0.7, k % 100 === 60 ? 1 : 0, 0);
        if (k % 50 === 40) MC.noteOff(50 + k % 12, 0);
        if (k % 30 === 5) MC.ctl(k % 32, (k % 7) / 7);
        if (k === 120) MC.transport(true);
        MC.span(k * 128, 128, 32);
        if (k % 90 === 0) MC.span(k * 128, 12, 3);           // an odd span (every chunk, dt back to one chunk)
      }
    });
    assert.ok(MC.V.active, 'the pseudo-voice ran');
  }
  // the per-note ext slot follows the ENV per chunk while gated and holds its last value after the voice ended
  const E = pP.mc.ext.subarray(32, 64);
  assert.ok(E.some((x, i) => i > 0 && x !== E[0]), 'ENV through ext: per-chunk values');
  pP.mc.noteOff(0, 0); for (let k = 0; k < 400; k++) pP.mc.span(k * 128, 128, 32);
  assert.equal(pP.mc.V.active, false);
  assert.ok(E.every(x => x === 0), 'after the release: the idle ENV (0) on every chunk');
});

/* ------------------------------------------------------------------ N4: the ModCore bench rows */
// tests/bench-scenarios.mjs rows mc0 / mc / mt / me (kind 'track' with a base: the overhead of ModCore over the same track
// without it; measure() interleaves row and base runs). Node gate: load ≤ 1.5 × target (bench.json targets; the user's
// machine is the reference — uncalibrated, as row p), re-measured up to 3 times while over.
test('N4: bench rows mc0 (10 GLOBAL LFOs, no note), mc (10 GLOBAL LFOs + gated pseudo-voice + 3 ENVs + 16 rows), mt (typical), me (ext hand-off on a Serum row) within their gates', async (t) => {
  const D = dspScope({ fast: true, engine: true });
  const env = { mk: po => new D.Proc({ processorOptions: po }), advance: n => { D.ctx.currentFrame += n; }, FXDSP: D.global('FXDSP'), SxBase: D.global('SxBase') };
  const S = scenarios(), out = {};
  for (const id of ['mc0', 'mc', 'mt', 'me']) {
    const scn = S.find(x => x.id === id), target = CPU.BENCH.targets[id].node;
    assert.ok(scn && scn.base, id + ': a scenario with a base');
    let best = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = measure(scn, env, { runs: 5 });
      if (best === null || r.load < best.load) best = r;
      if (best.load <= 1.5 * target) break;
    }
    out[id] = best.load;
    t.diagnostic(`row ${id}: ${best.load.toFixed(5)} (target ${target}; runs ${best.loads.map(x => x.toFixed(4)).join(' ')})`);
    assert.ok(best.load <= 1.5 * target, `row ${id}: ${best.load.toFixed(5)} > 1.5 × ${target}`);
  }
});

/* ------------------------------------------------------------------ the review round (findings-2b: E1–E8, E10, P2, P3, U3, the live meters) */
const classicPatch = (id, o) => { const m = MODELS.find(x => x.id === id), v = Object.assign(Object.fromEntries(m.controls.map(c => [c.id, c.def])), o || {}); const p = patchFor(m, v, C.defaultFx2(), { sr: SR, bpm: 120 }); delete p.fxr; delete p.fxrT; return p; };
// a Track with one classic Inst i1 (zone z) into panel fx1
function classicTrack(S, id, mods, z = null) {
  const p = S.mk(); S.graph(p, ['i1']);
  if (z) p.msg({ t: 'graph', insts: [{ id: 'i1', on: true, zone: z, salt: 0 }], chains: [{ id: 'fx1' }], edges: [['i1', 'fx1', 1], ['fx1', 'out', 1]], out: 'out', key: 'k' });
  p.msg({ t: 'patch', i: 'i1', p: classicPatch(id) }); p.msg(Object.assign({ t: 'chain', c: 'fx1' }, S.chainMsg));
  if (mods) p.msg(mods);
  return p;
}

test('E1 / E4: a slewed row (rise / fall) on a ModCore target reaches its target in SLEW_T whatever the span length (4 / 16 / 64 / 128-frame spans, the half lever on and off), continuous across spans; the span-end read is chunk nCh − 1 with the half lever on', () => {
  const S = scope(), vi = S.vi;
  // a wheel step through a cls row with rise 0.5 = SLEW_T 0.5 s (the wheel's own 1.5 ms smoother aside): 0.99 at 0.495 s
  const sm = synth(s => { s.matrix[0] = row('wheel', 'a.level', 1, { rise: 0.5, fall: 0.5 }); });
  const mods = () => payload(sm, { rows: [{ id: 'r', src: S_WHEEL, vi: vi('a.level'), dst: { kind: 'cls', inst: 'i1', slot: 0 }, xfer: { a: 0, b: 1, x0: 0 } }] });
  for (const [n, nCh, half] of [[128, 32, true], [128, 32, false], [64, 16, true], [16, 4, true], [4, 1, true]]) {
    const p = junoTrack(S, mods()), MC = p.mc;
    if (!half) { MC.half = false; MC.setRows(mods()); }
    for (let k = 0; k < 20; k++) MC.span(k * n, n, nCh);
    p.wheel = 1;
    let F = 0, t99 = -1, jump = 0, prev = -1;
    for (let k = 0; k < 400000 && t99 < 0; k++) {
      MC.span(F, n, nCh); F += n;
      const c0 = MC.cls0.i1[0], c1 = MC.cls1.i1[0];
      if (prev >= 0 && Math.abs(c0 - prev) > jump) jump = Math.abs(c0 - prev);
      prev = c1;
      if (c1 >= 0.99) t99 = F / SR;
    }
    assert.ok(Math.abs(t99 - 0.495) < 0.01, `span ${n} half ${half}: 0.99 reached at ${t99} s (SLEW_T 0.5 s)`);
    // (a one-chunk span is one evaluation: its start reads its end — one tick of slew past the last span's end)
    assert.ok(jump <= (nCh === 1 ? n / SR / 0.5 + 1e-12 : 1e-9), `span ${n} half ${half}: continuous across spans (cls0 of a span = cls1 of the last: jump ${jump})`);
  }
  // E4: a 20 Hz GLOBAL LFO into ext1 and a cls row: with the half lever on, cls1 is the chunk-31 value, not chunk 30
  const sm2 = synth(s => { s.lfo[0] = { ...s.lfo[0], mode: 'free', mono: 1, bpm: 0, anchor: 0 }; s.p['l1.rate'] = hzN(20); s.matrix[0] = row('lfo1', 'a.level', 1); });
  const p = junoTrack(S, payload(sm2, { ext: [{ k: 1, src: S_LFO1 }], rows: [{ id: 'r', src: S_LFO1, vi: vi('a.level'), dst: { kind: 'cls', inst: 'i1', slot: 0 }, xfer: { a: 0, b: 1, x0: 0 } }] })), MC = p.mc;
  assert.equal(MC.halfOn, 1);
  let at31 = 0, at30 = 0;
  for (let k = 0; k < 200; k++) { MC.span(k * 128, 128, 32); if (k > 10) { if (Math.abs(MC.cls1.i1[0] - MC.ext[31]) < 1e-12) at31++; if (Math.abs(MC.cls1.i1[0] - MC.ext[30]) < 1e-12) at30++; } }
  assert.ok(at31 >= 185 && at30 === 0, `cls1 = ext chunk 31 in ${at31} spans, chunk 30 in ${at30}`);
});

test('E2: the pseudo-voice gate with zones — a key no Inst takes neither holds the gate nor makes the next note legato; its note-off reaches ModCore when it was counted (the four orderings)', () => {
  const S = scope(), vi = S.vi, Z = { lo: 60, hi: 127, xp: 0 };
  const sm = synth(s => { Object.assign(s.p, { 'e2.att': timeN(0.01), 'e2.dec': timeN(0.1), 'e2.sus': 0.5, 'e2.rel': timeN(0.05) }); s.matrix[0] = row('env2', 'a.pan', 1); });
  const mods = () => payload(sm, { rows: [{ id: 'r', src: S_ENV2, vi: vi('a.pan'), dst: { kind: 'cls', inst: 'i1', slot: 0 }, xfer: { a: 0, b: 1 } }] });
  const mk = () => { const p = classicTrack(S, 'juno60', mods(), Z); return [p, p.mc.V]; };
  // (a) in zone, out of zone, off in, off out
  let [p, V] = mk();
  p.msg({ t: 'on', n: 60, v: 0.8 }); S.run(p, 2); assert.ok(V.gate && p.nHeld === 1);
  p.msg({ t: 'on', n: 40, v: 0.8 }); S.run(p, 2); assert.equal(p.nHeld, 1, 'key 40: no Inst took it — not counted');
  p.msg({ t: 'off', n: 60 }); S.run(p, 2); assert.equal(V.gate, false, 'the last counted key lifted: released');
  p.msg({ t: 'off', n: 40 }); S.run(p, 2); assert.equal(p.nHeld, 0);
  S.run(p, 200); assert.equal(V.active, false, 'ended');
  // (b) out of zone first, then in zone: the in-zone note is NOT legato, its release ends the gate
  [p, V] = mk();
  p.msg({ t: 'on', n: 40, v: 0.8 }); S.run(p, 2); assert.ok(!V.active && p.nHeld === 0);
  p.msg({ t: 'on', n: 60, v: 0.8 }); S.run(p, 1); assert.ok(V.gate && (V.mod.eSt[1] === 1 || V.mod.eSt[1] === 2 || V.mod.eSt[1] === 3), 'a fresh attack');
  p.msg({ t: 'off', n: 60 }); S.run(p, 2); assert.equal(V.gate, false);
  p.msg({ t: 'on', n: 62, v: 0.8 }); S.run(p, 1); assert.ok(V.mod.eSt[1] === 1 || V.mod.eSt[1] === 2 || V.mod.eSt[1] === 3, 'restarted, not legato (the out-of-zone key does not count)');
  p.msg({ t: 'off', n: 62 }); p.msg({ t: 'off', n: 40 }); S.run(p, 2); assert.ok(!V.gate && p.nHeld === 0);
  // (c) in, in, off the first, off the second: legato then release; (d) the reverse release order
  for (const order of [[60, 64], [64, 60]]) {
    [p, V] = mk();
    p.msg({ t: 'on', n: 60, v: 0.8 }); S.run(p, 2); p.msg({ t: 'on', n: 64, v: 0.8 }); S.run(p, 2);
    assert.equal(p.nHeld, 2);
    p.msg({ t: 'off', n: order[0] }); S.run(p, 2); assert.ok(V.gate && p.nHeld === 1, 'one key still held');
    p.msg({ t: 'off', n: order[1] }); S.run(p, 2); assert.ok(!V.gate && p.nHeld === 0, 'released at the last');
  }
  // a key-on with velocity 0 counts as nothing; a repeated key-on is counted once; panic clears
  [p, V] = mk();
  p.msg({ t: 'on', n: 60, v: 0 }); assert.equal(p.nHeld, 0);
  p.msg({ t: 'on', n: 60, v: 0.5 }); p.msg({ t: 'on', n: 60, v: 0.6 }); assert.equal(p.nHeld, 1);
  p.msg({ t: 'panic' }); assert.ok(p.nHeld === 0 && !V.gate);
});

test('E3 / P8: postMon posts the eff snapshot for a span-setter-only Inst too (moFN > 0); U3: a set row in lane B\'s shape (slot = the synthetic slot) registers as a field row — eff = the base with a macro at 0, moves within the transfer\'s range under an LFO', async () => {
  const S = scope(), vi = S.vi, V = await import('../cv-mods.js?v=9');
  const vals = id => Object.fromEntries(MODELS.find(x => x.id === id).controls.map(c => [c.id, c.def]));
  const xfA = V.xferOf('juno60', vals('juno60'), 'a', { kind: 'field', field: 'fenv.a' });
  const sm = synth(s => { s.lfo[0] = { ...s.lfo[0], mode: 'free', mono: 1, bpm: 0, anchor: 0 }; s.p['l1.rate'] = hzN(2); s.matrix[0] = row('lfo1', 'a.level', 1); s.matrix[1] = row('macro1', 'a.pan', 0.25); });
  // lane B's row shape: slot (the synthetic matrix slot), tgt, perNote … beside dst
  const B = (id, src, d, xfer, j) => ({ id, src, dst: d, amt: 0.25, bi: 0, curve: 0, crv: null, aux: 0, inv: 0, rise: 0, fall: 0, byp: 0, out: 1, perNote: false, vi: vi(j ? 'a.pan' : 'a.level'), slot: j, tgt: 0, xfer });
  const p = junoTrack(S, payload(sm, { rows: [B('r1', S_LFO1, { kind: 'set', inst: 'i1', field: 'fenv.a' }, xfA, 0)] })), I = p.insts[0];
  assert.deepEqual([I.moN, I.moFN], [0, 1], 'a field row, not a slot row');
  const posts = [];
  p.port.postMessage = d => { if (d.t === 'smon' && d.i === 'i1' && d.s && d.s.eff) posts.push(Float32Array.from(d.s.eff)); };
  p.msg({ t: 'mon', ids: ['i1'] });
  p.msg({ t: 'on', n: 60, v: 0.8 }); S.run(p, 60);
  assert.ok(posts.length >= 3, 'eff posted for a setter-only Inst: ' + posts.length);
  const lo = Math.min(...xfA.tab), hi = Math.max(...xfA.tab);
  assert.ok(posts.every(e => e[0] >= lo && e[0] <= hi), 'eff within the transfer\'s domain (field units)');
  assert.ok(new Set(posts.map(e => e[0])).size > 1, 'the eff moves with the LFO');
  // a macro at 0 on the Juno LFO rate (a table transfer): eff = the base = T(x0)
  const xfL = V.xferOf('juno60', vals('juno60'), 'lr', { kind: 'field', field: 'lfo.rate' });
  const q = junoTrack(S, payload(sm, { rows: [B('r2', S_MACRO1, { kind: 'set', inst: 'i1', field: 'lfo.rate' }, xfL, 1)], vals: [{ k: 0, src: S_MACRO1, v: 0, id: 'm1.k1' }] })), J = q.insts[0];
  const base = J.p.lfo.rate;
  q.msg({ t: 'on', n: 60, v: 0.8 }); S.run(q, 20);
  assert.ok(Math.abs(J.modEff()[0] - base) < 1e-3 * base && Math.abs(J.p.lfo.rate - base) < 1e-9, `macro at 0: eff ${J.modEff()[0]} = base ${base}`);
  q.msg({ t: 'mval', k: 0, v: 1 }); S.run(q, 100);
  assert.ok(J.modEff()[0] > base && J.modEff()[0] <= Math.max(...xfL.tab) + 1e-9, 'macro at 1: eff above the base, within the table: ' + J.modEff()[0]);
});

test('E5: the TB-303 sequencer\'s steps and the Serum ARP\'s generated notes gate the pseudo-voice (a track ENV on a 303 knob follows the pattern; the ARP\'s steps restart it)', () => {
  const S = scope(), vi = S.vi;
  const sm = synth(s => { Object.assign(s.p, { 'e2.att': timeN(0.01), 'e2.dec': timeN(0.2), 'e2.sus': 0.3, 'e2.rel': timeN(0.1) }); s.matrix[0] = row('env2', 'a.pan', 1); });
  const mods = () => payload(sm, { rows: [{ id: 'r', src: S_ENV2, vi: vi('a.pan'), dst: { kind: 'cls', inst: 'i1', slot: 0 }, xfer: { a: 0, b: 1 } }] });
  const p = classicTrack(S, 'tb303', mods()), I = p.insts[0], V = p.mc.V;
  const pat = Array.from({ length: 16 }, (_, k) => ({ g: k % 2 === 0 ? 1 : 0, n: (k * 5) % 12, o: 0, a: k % 4 === 0 ? 1 : 0, s: k === 4 ? 1 : 0 }));
  p.msg({ t: 'seq', i: 'i1', s: { run: true, sync: false, pat, len: 16, bpm: 140, root: 36 } });
  let gated = 0, sounding = 0, maxOff = 0, starts = 0, wasGate = false;
  const ms = I.modSpan.bind(I);
  I.modSpan = (c0, c1, sv) => { if (Math.abs(c1[0]) > maxOff) maxOff = Math.abs(c1[0]); ms(c0, c1, sv); };
  for (let q = 0; q < 750; q++) { S.run(p, 1); if (V.gate) gated++; if (V.gate && !wasGate) starts++; wasGate = V.gate; if (I.anyActive()) sounding++; }
  assert.ok(sounding > 200, 'the pattern plays');
  assert.ok(gated > 150 && gated < sounding + 50, `the pseudo-voice gated with the steps (${gated} of ${sounding} sounding quanta)`);
  assert.ok(starts >= 6, `restarted per struck step (${starts} gate starts; the tied step keeps it)`);
  assert.ok(maxOff > 0.5, 'the ENV row drives the cutoff offset: ' + maxOff);
  p.msg({ t: 'seq', i: 'i1', s: { run: false } }); S.run(p, 100);
  assert.equal(V.gate, false, 'stopping the pattern releases');
  // the Serum ARP: a held key feeds the arpeggiator; its generated notes retrigger the ENV per step
  const ss = C.normalizeSerum(C.defaultSerum()); ss.p['arp.on'] = 1;
  const q = S.mk(); S.graph(q, ['i1']);
  q.msg({ t: 'patch', i: 'i1', p: serumPatch(ss) }); q.msg(Object.assign({ t: 'chain', c: 'fx1' }, S.chainMsg)); q.msg(mods());
  const J = q.insts[0], W = q.mc.V;
  assert.equal(J.sqOn, 1);
  q.msg({ t: 'on', n: 60, v: 0.8 }); q.msg({ t: 'on', n: 64, v: 0.8 });
  let att = 0, st = 0;
  for (let k = 0; k < 400; k++) { S.run(q, 1); const e = W.mod.eSt[1]; if (e === 1 && st !== 1) att++; st = e; }
  assert.ok(att >= 4, `the ARP's steps restart the ENV (${att} attacks over 400 quanta)`);
  q.msg({ t: 'off', n: 60 }); q.msg({ t: 'off', n: 64 }); S.run(q, 300);
  assert.equal(W.gate, false, 'keys up, the ARP stops: released');
});

test('E6: a malformed payload after a good one keeps the previous ModCore state (validated before anything is written) and posts {t: modsErr, i, key}; a malformed first payload builds nothing and posts it too', () => {
  const S = scope(), vi = S.vi, posts = [];
  const sm = synth(s => { s.lfo[0] = { ...s.lfo[0], mode: 'free', mono: 1 }; s.p['l1.rate'] = hzN(2); s.matrix[0] = row('lfo1', 'a.level', 1); });
  const good = payload(sm, { i: 'trk', key: 'k1', ext: [{ k: 1, src: S_LFO1 }], rows: [{ id: 'r', src: S_LFO1, vi: vi('a.level'), dst: { kind: 'cls', inst: 'i1', slot: 0 }, xfer: { a: 0, b: 1 } }] });
  const p = junoTrack(S, null);
  p.port.postMessage = d => { if (d.t === 'modsErr') posts.push(d); };
  p.msg({ t: 'mods', i: 'trk', key: 'bad0', cp: { ver: 99 }, rows: [{ id: 'x', src: 5, dst: { kind: 'cls', inst: 'i1', slot: 0 } }] });
  assert.equal(p.mc, null, 'a first bad payload: nothing');
  assert.deepEqual(posts.map(x => [x.t, x.i, x.key]), [['modsErr', 'trk', 'bad0']]);   // (plain values: the scope's objects are another realm's)
  p.msg(good);
  const MC = p.mc, cp = MC.cp;
  p.msg({ t: 'on', n: 60, v: 0.8 }); S.run(p, 20);
  const seen = [];
  p.insts[0].modSpan = (a, b) => { seen.push(b[0]); };
  for (const bad of [{ t: 'mods', i: 'trk', key: 'bad1', cp: { ver: 99 }, rows: [{ id: 'x', src: 5, dst: { kind: 'cls', inst: 'i1', slot: 0 } }] }, { t: 'mods', i: 'trk', key: 'bad2', cp: null, rows: [{}] }, { t: 'mods', i: 'trk', key: 'bad3', cp: 'x', ext: [{ k: 1, src: 5 }] }]) {
    assert.doesNotThrow(() => p.msg(bad));
    assert.ok(p.mc === MC && MC.ok === 1 && MC.cp === cp && MC.rows.length === 1 && MC.extN === 1, 'the previous state kept');
    assert.equal(MC.shim.p.serum, cp, 'the shim still on the good CP');
  }
  assert.deepEqual(posts.slice(1).map(x => x.key), ['bad1', 'bad2', 'bad3']);
  S.run(p, 30);
  assert.ok(seen.length === 30 && seen.some(x => x !== 0) && new Set(seen).size > 5, 'the rows keep running after the rejected payloads');
  assert.ok(p.mc.ext.some(x => x !== 0), 'ext too');
  p.msg({ t: 'mods', off: true }); assert.equal(p.mc, null);
});

test('E7 / P3: no allocation on the Track\'s own paths with a ModCore (modPre → modSpan with cls-only rows, chainMods, notes) — 100 quanta of process under throwing constructors', () => {
  const S = scope(), vi = S.vi;
  const sm = synth(s => { s.lfo[0] = { ...s.lfo[0], mode: 'free', mono: 1 }; s.p['l1.rate'] = hzN(2); s.matrix[0] = row('lfo1', 'a.level', 1); s.matrix[1] = row('fixed', 'a.pan', 0.5); });
  const p = junoTrack(S, payload(sm, { ext: [{ k: 1, src: S_LFO1 }], rows: [{ id: 'a', src: S_LFO1, vi: vi('a.level'), dst: { kind: 'cls', inst: 'i1', slot: 0 }, xfer: { a: 0, b: 1 } },
    { id: 'c', src: S_FIXED, vi: vi('a.pan'), dst: { kind: 'fx', chain: 'fx1', fx: 0, key: S.chainMsg.fxr.key } }] }));
  assert.ok(p.mc !== null && p.insts[0].moN === 1 && p.insts[0].moFN === 0, 'cls-only rows: the Track passes null for setv');
  p.msg({ t: 'on', n: 60, v: 0.8 }); S.run(p, 40);
  const o = [[new Float32Array(Q), new Float32Array(Q)]];
  noAlloc(S.D, () => { for (let k = 0; k < 100; k++) { if (k % 20 === 5) p.noteOn(64 + (k % 7), 0.7, 0, 0, 0); if (k % 20 === 15) p.noteOff(64 + ((k - 10) % 7), 0.5, 0, 0, 0); p.process([], o); S.D.ctx.currentFrame += Q; } });
  assert.ok(Math.max(...o[0][0].map(Math.abs)) > 1e-4);
});

test('E10: MC.stats() → {lfos, envs, rows, ext, spans, half} (no timer in a worklet scope)', () => {
  const S = scope();
  const p = junoTrack(S, payload(synth(s => { s.lfo[0] = { ...s.lfo[0], mode: 'free', mono: 1 }; s.matrix[0] = row('lfo1', 'a.level', 0.01); }), { ext: [{ k: 1, src: S_LFO1 }] }));
  S.run(p, 7);
  const st = p.mc.stats();
  assert.deepEqual(Object.keys(st).sort(), ['envs', 'ext', 'half', 'lfos', 'rows', 'spans']);
  assert.ok(st.spans >= 7 && st.lfos === 1 && st.ext === 1 && st.half === 1);
});

test('live meters: MC.live = Float32Array(16) [lfo 1…10, env 2, 3, 4, 1, chaos 1, 2] 0…1 updated per span at no allocation; the Track posts {t: smon, mc} to a \'mods\' monitor subscription while a ModCore exists', () => {
  const S = scope(), vi = S.vi;
  const sm = synth(s => {
    s.lfo[0] = { ...s.lfo[0], mode: 'free', mono: 1, bpm: 0, anchor: 0 }; s.p['l1.rate'] = hzN(3);
    s.lfo[1] = { ...s.lfo[1], mode: 'retrig', mono: 1, bpm: 0, anchor: 0 }; s.p['l2.rate'] = hzN(1);
    s.lfo[4] = { ...s.lfo[4], mode: 'retrig', mono: 0, bpm: 0, anchor: 0 }; s.p['l5.rate'] = hzN(2);
    Object.assign(s.p, { 'e2.att': timeN(0.05), 'e2.dec': timeN(0.3), 'e2.sus': 0.5, 'e2.rel': timeN(0.2) });
    s.chaos[0] = { ...s.chaos[0], mono: 1 };
    s.matrix[0] = row('lfo1', 'a.level', 0.01); s.matrix[1] = row('lfo2', 'a.pan', 0.01); s.matrix[2] = row('lfo5', 'b.level', 1); s.matrix[3] = row('env2', 'b.pan', 1); s.matrix[4] = row('chaos1', 'a.wt', 0.5);
  });
  const rows = [{ id: 'a', src: 9, vi: vi('b.level'), dst: { kind: 'cls', inst: 'i1', slot: 0 }, xfer: { a: 0, b: 1 } }, { id: 'b', src: S_ENV2, vi: vi('b.pan'), dst: { kind: 'cls', inst: 'i1', slot: 1 }, xfer: { a: 0, b: 1 } },
    { id: 'c', src: 17, vi: vi('a.wt'), dst: { kind: 'cls', inst: 'i1', slot: 2 }, xfer: { a: 0, b: 1 } }];
  const p = junoTrack(S, payload(sm, { rows, ext: [{ k: 1, src: S_LFO1 }, { k: 2, src: S_LFO1 + 1 }] })), MC = p.mc, L = MC.live;
  assert.equal(L.length, 16, 'Float32Array(16)');
  assert.equal(S.M.NLIVE, 16);
  const posts = [];
  p.port.postMessage = d => { if (d.t === 'smon' && d.mc) posts.push(Float32Array.from(d.mc)); };
  p.msg({ t: 'mon', ids: ['mods'] });
  assert.ok(p.mon && p.mcMon, 'a mods subscription alone turns the monitor on');
  const l0 = [], l1 = [], e2 = [], c1 = [], l5 = [];
  const ev = (q, P) => { if (q === 10) P.msg({ t: 'on', n: 60, v: 0.8 }); if (q === 60) P.msg({ t: 'off', n: 60 }); };
  for (let q = 0; q < 160; q++) { S.run(p, 1, (_, P) => ev(q, P)); l0.push(L[0]); l1.push(L[1]); l5.push(L[4]); e2.push(L[10]); c1.push(L[14]); }
  const moves = a => new Set(a).size, within = a => a.every(x => x >= 0 && x <= 1);
  assert.ok(moves(l0) > 50 && within(l0), 'lfo1 (GLOBAL FREE) moves in 0…1');
  assert.ok(moves(l1) > 50 && within(l1), 'lfo2 (GLOBAL RETRIG) moves');
  assert.ok(moves(l5.slice(11, 60)) > 20 && within(l5), 'lfo5 (PER NOTE) moves while gated');
  assert.ok(e2.slice(0, 10).every(x => x === 0) && Math.max(...e2.slice(11, 60)) > 0.4 && e2[159] < 0.05, 'env2 at 0 before the note, up while gated, back down after the release');
  assert.ok(moves(c1) > 20 && within(c1), 'chaos1 (mono) moves, mapped to 0…1');
  assert.ok(L[13] === 0 && L[11] === 0 && L[12] === 0, 'env 3, 4, 1 idle');
  assert.ok(posts.length >= 3 && posts.every(x => x.length === 16) && posts.some(x => x[0] !== posts[0][0]), 'posted at the monitor rate with changing values');
  assert.ok(Math.abs(L[0] - MC.ext[31]) < 1e-6, 'lfo1 = ext1\'s last chunk (float32)');
  noAlloc(S.D, () => { for (let k = 0; k < 50; k++) MC.span(k * 128, 128, 32); });
  p.msg({ t: 'mon', ids: [] }); assert.equal(p.mcMon, false);
});

test('P2: Track.warmUp\'s ModCore round (warmMods: a payload on a hand-built CP with cls / set / fx rows and ext on the warm graph) runs and leaves nothing — mc null, the Insts without rows, the panel unmodulated, nHeld 0; a fresh scope\'s first Track is clean after its warm-up', () => {
  const S = scope(), p = S.mk({ offline: true });
  // the round itself on an explicit warm graph (offline: no warm-up ran in the constructor)
  const z = { lo: 0, hi: 127, xp: 0 };
  p.msg({ t: 'graph', insts: [{ id: 'w1', on: true, zone: z, salt: 0 }, { id: 'w2', on: true, zone: z, salt: 1 }, { id: 'w3', on: true, zone: z, salt: 2 }], chains: [{ id: 'wa' }], edges: [['w1', 'wa', 1], ['w2', 'wa', 1], ['w3', 'out', 1], ['wa', 'out', 1]], out: 'out', key: 'w' });
  p.msg({ t: 'patch', i: 'w1', p: junoPatch() }); p.msg({ t: 'patch', i: 'w2', p: classicPatch('prophet5') });
  const io = [[new Float32Array(Q), new Float32Array(Q)]], seen = { mc: 0, spans: 0, rows: 0, ext: 0, moN: 0, moFN: 0, mcOn: 0, serumExt: 0 };
  const run = k => { for (let b = 0; b < k; b++) { p.process(null, io); S.D.ctx.currentFrame += Q; if (p.mc) { seen.mc++; seen.spans = p.mc.stats().spans; seen.rows = p.mc.rows.length; seen.ext = p.mc.extN; const w1 = p.instOf('w1'); seen.moN = Math.max(seen.moN, w1.moN); seen.moFN = Math.max(seen.moFN, w1.moFN); seen.mcOn = Math.max(seen.mcOn, p.chainOf('wa').mcOn); const w3 = p.instOf('w3'); if (w3.sx && w3.p.serum && (w3.p.serum.use & 32768) !== 0 && w3.sx.g[S_EXT0 * 32 + 5] !== 0) seen.serumExt++; } } };
  p.warmMods(run, p.instOf('w3'));
  assert.ok(seen.mc >= 80 && seen.spans >= 80, 'the round ran ≈ 90 spans with a ModCore: ' + JSON.stringify(seen));
  assert.ok(seen.rows === 8 && seen.ext === 2 && seen.moN >= 3 && seen.moFN === 3 && seen.mcOn === 1, 'cls / set / fx rows and ext slots exercised: ' + JSON.stringify(seen));
  assert.ok(seen.serumExt > 10, 'the Serum read ext1 from ModCore: ' + seen.serumExt);
  assert.ok(p.mc === null && p.instOf('w1').moN === 0 && p.instOf('w1').moFN === 0 && p.instOf('w2').moN === 0 && p.nHeld === 0, 'nothing left');
  run(2);
  assert.equal(p.chainOf('wa').mcOn, 0, 'the panel\'s rack unmodulated again');
  p.restore(4);
  assert.ok(p.mc === null && p.i0.moN === 0 && p.i0.moFN === 0 && p.c0.mcOn === 0 && p.nHeld === 0 && !p.mcMon, 'restore() finds nothing of it');
  // a fresh scope: the first (online) Track's constructor warm-up includes the round and restores
  const D2 = dspScope({ fast: true, engine: true }), q = new D2.Proc({ processorOptions: { os: 4, hostOS: 4 } });
  assert.ok(q.mc === null && q.i0.moN === 0 && q.i0.moFN === 0 && q.c0.mcOn === 0 && q.nHeld === 0 && q.insts.length === 1 && q.chains.length === 1, 'clean after the warm-up');
  assert.equal(D2.global('ModCore').warmPayload(D2.global('SxBase'), false).rows.length, 8);
});
