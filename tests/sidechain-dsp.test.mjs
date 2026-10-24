// IMPL-SC lane D (docs/canvas/IMPL-SC.md §1.2, §2, §3.2, §4, §8): the sidechain's engine side, with the real engine in one
// AudioWorkletGlobalScope — two Tracks, the source processed before the keyed one as Web Audio orders them through the key edge
// (tests/main-sim.mjs's procOrder; here the test's loop). G1 (node part): a Track given inputs [], [[]] or [[L, R]] with no unit asking
// renders the same program bit for bit. G2: a v3 compressor's KEY EXT keyed from the source Track's output through the node's input
// (its panel, a Serum's own rack, a shared panel of a graph node). G4: the trigger registry — a song note of the source at frame f
// dips the keyed Ducker at f (both orders of construction), a message-time note at the next quantum's first frame, a reader processed
// before its writer drops the hit (never a quantum late), no trackId → no ring, bye removes it (a node rebuilt under the same id keeps
// its own), 65 note-ons → 64 kept, the leaves (a Serum arp's generated notes, a TB-303 synced step but not a tie, an 808 pattern step
// per sound — BD + SD → 36 and 38, a NOTE filter on the snare lane —, a drum note through its map (35 → 36; a muted lane: nothing),
// a 909 flam's second hit), MASTER's Ducker from any track, a node without trackId idles. Review 1 F1: a Ducker / keyed compressor
// on a track whose Inst takes the idle skip keeps following the key (its state ≡ a never-quiet track's), its output still skipped.
// Run alone: node --max-old-space-size=2048 --test tests/sidechain-dsp.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dspScope } from './dsp-scope.mjs';
import * as core from '../serum-core.js?v=9';
import * as W from '../wt.js?v=9';
import { patchFor, MODELS } from '../models.js?v=9';
import * as DC from '../drum-core.js?v=9';
import * as C from '../fx-core.js?v=9';
import { lawNorm } from '../laws.js?v=9';
import { DRUM_PATTERNS, drumTrack } from './bench-scenarios.mjs';

const SR = 48000, K = 'trk_k', B = 'trk_b';
const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
const tables = (p, patch) => { for (const id of patch.needs || []) if (/^(factory|noise):/.test(id)) p.msg(Object.assign({ t: 'wt' }, id.startsWith('noise:') ? W.makeNoise(id) : W.makeEntry(id, W.factoryTable(id)))); };
const vals = (m, o) => Object.assign(Object.fromEntries(m.controls.map(c => [c.id, c.def])), o || {});
const classic = (id, fx, o) => { const m = MODELS.find(x => x.id === id); return patchFor(m, vals(m, o), fx || core.defaultFx2(), { sr: SR, bpm: 120 }); };
const serum = (edit, fx) => { const s = core.defaultSerum(); if (edit) edit(s); return patchFor('serum', { s: core.normalizeSerum(s) }, fx || core.defaultFx2(), { sr: SR, bpm: 120, prefs: { smooth: 1, silenceTails: 1 } }); };
const nOf = (type, pid, v, var_) => { const r = C.FXP_TAB[type][var_ || 2].find(x => x.pid === pid); return lawNorm(r.law, r.lo, r.hi, v, r.def); };
const DB20 = x => Math.pow(10, x / 20);
// an FX state with one Ducker (depth 1, att 0, smooth 0, LENGTH ms, the Classic curve) keyed from `src`
function duckFx(src, o = {}) {
  const fx = C.defaultFx2(), id = C.newInstance(fx, 'duck', { rack: 0 }), I = fx.racks[0].mods.find(x => x.id === id);
  Object.assign(I.p, { depth: 1, att: 0, smooth: 0, bpm: 0, len: nOf('duck', 'len', o.len || 50) }, o.note !== undefined ? { note: nOf('duck', 'note', o.note) } : {});
  I.sub.src = src;
  return fx;
}
// an FX state with one v3 compressor at KEY EXT keyed from `src` (thr / ratio / att / rel in engine units), added to `fx` (default: a new one)
function cmpFx(src, o = {}, fx = C.defaultFx2()) {
  const id = C.newInstance(fx, 'cmp', { rack: 0 }), R = fx.racks[0].mods, J = R.find(x => x.id === id), U = C.upgradeInstance(J);
  Object.assign(U.p, { ext: 1, thr: nOf('cmp', 'thr', DB20(o.thr === undefined ? -20 : o.thr), 3), ratio: nOf('cmp', 'ratio', o.ratio || 8, 3), att: nOf('cmp', 'att', o.att || 1, 3), rel: nOf('cmp', 'rel', o.rel || 30, 3) });
  U.sub.src = src;
  R[R.indexOf(J)] = U;
  return fx;
}
function mk(D, po = {}, patch = null) {
  const p = new D.Proc({ processorOptions: Object.assign({ os: 2, hostOS: 4 }, po) }), sent = [];
  p.port.postMessage = m => sent.push(m);
  if (patch) { p.msg({ t: 'patch', p: patch }); tables(p, patch); }
  return { p, sent };
}
const out2 = () => [[new Float32Array(128), new Float32Array(128)]];
const peakOf = a => { let m = 0; for (const x of a) if (Math.abs(x) > m) m = Math.abs(x); return m; };
const sameBits = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
// the frames where `a` starts to differ from `b` (a run of differing samples begins)
const dipStarts = (a, b) => { const s = []; for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i]) && (i === 0 || Object.is(a[i - 1], b[i - 1]))) s.push(i); return s; };
const FPT = SR * 60 / (120 * 960);                              // frames per tick at 120 bpm (25)
const tpPlay = F => ({ t: 'transport', play: true, frame: F, tick: 0, fpt: FPT, seek: true });
// a song of notes [tick, len, note, vel] (velocity 0–127) for the Track's {t: 'song'}
const song = notes => ({ t: 'song', notes: notes.flat(), cc: [] });
// the frame a song note at tick t fires (the span boundary at or after its frame: a 4-frame grid)
const fireAt = t => Math.ceil(t * FPT / 4) * 4;
// `quanta` quanta: the nodes processed in `order` each quantum (the first fed nothing, each later one its predecessor's output as
// [[L, R]] unless `feed` says otherwise); → per node the concatenated L (and R) of its output
function runOrder(D, nodes, quanta, { feed = null, before = null } = {}) {
  const N = nodes.length, L = nodes.map(() => new Float64Array(quanta * 128)), R = nodes.map(() => new Float64Array(quanta * 128));
  const o = nodes.map(() => out2());
  for (let q = 0; q < quanta; q++) {
    if (before) before(q);
    for (let k = 0; k < N; k++) {
      const src = feed ? feed(k) : k > 0 ? k - 1 : -1, inp = src >= 0 ? [[o[src][0][0], o[src][0][1]]] : [];
      nodes[k].process(inp, o[k]);
      L[k].set(o[k][0][0], q * 128); R[k].set(o[k][0][1], q * 128);
    }
    D.ctx.currentFrame += 128;
  }
  return { L, R };
}
const reg = D => D.run('SCREG', 'screg.js');

/* ------------------------------------------------------------------ G1 (node part): the inputs change no sample */

test('IMPL-SC G1: a Track given inputs [], [[]] or [[L, R]] (connected, no unit asking) renders the same program bit for bit — a classic, a Serum, a drum machine', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const r = W.mulberry32(0xC0FFEE), notes = [];
  const QN = 30 * SR / 128;                                   // 30 s of random notes
  for (let q = 0; q < QN; q++) if (r() < 0.04) notes.push([q, 36 + Math.floor(r() * 48), 0.3 + 0.7 * r()]);
  const progs = [
    ['juno60', () => mk(D, { trackId: 'trk_g1', offline: true }, classic('juno60'))],
    ['serum', () => { const m = mk(D, { trackId: 'trk_g1', offline: true }, serum()); return m; }],
    ['tr808', () => { const m = mk(D, { trackId: 'trk_g1', offline: true, os: 4 }, classic('tr808')); const d = DC.normDrum(undefined); d.st[0] = DC.DEMO.a.slice(); d.ui.mode = DC.M_MAN; m.p.msg({ t: 'seq', s: DC.payload(d, DC.initState(), 'now') }); m.p.msg(tpPlay(0)); return m; }],
  ];
  const kinds = [() => [], () => [[]], (k) => [[k.L, k.R]]];
  for (const [name, build] of progs) {
    const outs = [];
    for (const inp of kinds) {
      D.ctx.currentFrame = 0;
      const { p } = build(), o = out2(), L = new Float64Array(QN * 128), R = new Float64Array(QN * 128), g = W.mulberry32(99);
      const key = { L: new Float32Array(128), R: new Float32Array(128) };
      for (let q = 0; q < QN; q++) {
        for (const [at, n, v] of notes) { if (at === q) p.msg({ t: 'on', n, v }); if (at + 6 === q) p.msg({ t: 'off', n }); }
        for (let i = 0; i < 128; i++) { key.L[i] = 2 * g() - 1; key.R[i] = -key.L[i]; }
        p.process(inp(key), o); D.ctx.currentFrame += 128;
        L.set(o[0][0], q * 128); R.set(o[0][1], q * 128);
      }
      assert.ok(peakOf(L) > 0.01, name + ' sounds');
      outs.push([L, R]);
      p.msg({ t: 'bye' });
    }
    for (let k = 1; k < 3; k++) assert.ok(sameBits(outs[0][0], outs[k][0]) && sameBits(outs[0][1], outs[k][1]), name + ': inputs kind ' + k + ' ≡ none');
  }
});

/* ------------------------------------------------------------------ G2: the key through the node's input */

test('IMPL-SC G2: a v3 compressor at KEY EXT on the keyed Track hears the source Track\'s output through inputs[0] — the GR follows the 808 kick (≥ 6 dB at the hits, < 0.1 dB before the next); on a classic\'s panel, in a Serum\'s own rack and on a graph node\'s shared panel', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const d = DC.normDrum(undefined); d.st[0] = new Array(32).fill(0); for (const s of [0, 4, 8, 12]) d.st[0][s] = 2; d.ui.mode = DC.M_MAN;   // BD on the quarters
  const kickPay = DC.payload(d, DC.initState(), 'now');
  const cases = [
    ['a classic\'s panel', () => mk(D, { trackId: B }, classic('juno60', cmpFx(K))).p],
    ['a Serum\'s own rack', () => { const { p } = mk(D, { trackId: B }, serum(null, cmpFx(K))); return p; }],
    ['a shared panel (graph node)', () => {
      const { p } = mk(D, { trackId: B }), Z = { lo: 0, hi: 127, xp: 0 }, fx = cmpFx(K);
      p.msg({ t: 'graph', insts: [{ id: 'i1', on: true, zone: Z, salt: 0 }], chains: [{ id: 'fx1' }], edges: [['i1', 'fx1', 1], ['fx1', 'out', 1]], out: 'out', key: 'g2' });
      const q = classic('juno60'); delete q.fxr; delete q.fxrT;
      p.msg({ t: 'patch', i: 'i1', p: q }); tables(p, q);
      p.msg({ t: 'chain', c: 'fx1', fxr: C.compileFx(fx, { bpm: 120, rate: SR }), fxrT: C.compileFxT(fx) });
      return p;
    }],
  ];
  for (const [name, build] of cases) {
    D.ctx.currentFrame = 0;
    const { p: k, sent } = mk(D, { trackId: K, os: 4 }, classic('tr808', null, { bdd: 0 }));
    k.msg({ t: 'seq', s: kickPay }); k.msg(tpPlay(0));
    const b = build();
    b.msg({ t: 'on', n: 48, v: 0.8 });
    const rack = b.graphed === 1 ? b.chains[0].rack : b.i0.kind === 'serum' ? b.i0.fxc.rack : b.c0.rack, gr = [];
    const u = rack.U.find(x => x.k === 14);
    assert.ok(u && u.v === 3 && u.src === K && u.n === 21, name + ': a v3 unit keyed from ' + K);
    runOrder(D, [k, b], 1300, { before: () => gr.push(rack.gr()[4 * u.idx]) });   // (3.5 s: 7 kicks)
    gr.push(rack.gr()[4 * u.idx]);
    const steps = sent.filter(m => m.t === 'step' && m.s % 4 === 0).map(m => Math.floor(m.F / 128));
    assert.ok(steps.length >= 6, name + ': the kick stepped ' + steps.length + ' times');
    for (const q of steps.slice(1, 6)) {
      const peak = Math.max(...gr.slice(q + 1, q + 5));
      assert.ok(peak >= 6, `${name}: GR ${peak} dB after the kick at quantum ${q}`);
      assert.ok(gr[q] < 0.1, `${name}: GR ${gr[q]} dB before it`);
    }
    k.msg({ t: 'bye' }); b.msg({ t: 'bye' });
  }
});

test('IMPL-SC G2 (§1.2): the key copies are call-aligned per span — a steady −6 dBFS key through inputs[0] gives the stated GR (thr −20 dB, ratio 4 → 10.48 dB); unfed ([] / [[]]) → kL null → no GR; the racks\' sc fields', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const { p: b } = mk(D, { trackId: B }, classic('juno60', cmpFx(K, { ratio: 4, rel: 100 })));
  b.msg({ t: 'on', n: 48, v: 0.8 });
  const r = b.c0.rack, o = out2(), key = [[new Float32Array(128).fill(0.5), new Float32Array(128).fill(0.5)]];
  for (let q = 0; q < 200; q++) { b.process(key, o); D.ctx.currentFrame += 128; }
  assert.ok(Math.abs(r.gr()[0] - 10.4845) < 0.1, 'GR ' + r.gr()[0]);
  assert.deepEqual([r.sc.reg === reg(D), r.sc.kL === b.kL, r.sc.kR === b.kR, r.sc.q, r.sc.F, b.kL[0], b.kR[127]], [true, true, true, D.ctx.currentFrame - 128, b.spanF, 0.5, 0.5], 'the rack\'s sc: the registry, the Track\'s key copies, this quantum\'s frames');
  for (const inp of [[], [[]]]) {
    for (let q = 0; q < 200; q++) { b.process(inp, o); D.ctx.currentFrame += 128; }
    assert.ok(r.gr()[0] === 0 && r.sc.kL === null && r.sc.kR === null && b.inK === null, 'unfed: no key, no GR');
  }
  // a mono input ([[L]]): both key channels read it
  for (let q = 0; q < 200; q++) { b.process([[key[0][0]]], o); D.ctx.currentFrame += 128; }
  assert.ok(Math.abs(r.gr()[0] - 10.4845) < 0.1 && b.kR[5] === 0.5, 'mono input: kR = kL');
});

/* ------------------------------------------------------------------ G4: the registry and the ordering */

// the keyed node: a Juno holding a note through a Ducker (depth 1, att 0, smooth 0, 50 ms) keyed from `src`; its rack's output
// tapped per call (p.tap(): the concatenated L — the Track's output stage behind it delays by its 1 ms look-ahead limiter and its DC
// blocker's state keeps a dip's trace, so a dip's exact frame is read at the rack)
const duckNode = (D, src, po = {}, o = {}) => {
  const { p } = mk(D, Object.assign({ trackId: B }, po), classic('juno60', duckFx(src, o)));
  p.msg({ t: 'on', n: 48, v: 0.8 });
  const r = p.c0.rack, rp = r.process, parts = [];
  r.process = function (a, b, n, ...x) { const ret = rp.call(this, a, b, n, ...x); parts.push(Float64Array.from(a.subarray(0, n))); return ret; };
  p.tap = () => { const L = new Float64Array(parts.reduce((s, q) => s + q.length, 0)); let o = 0; for (const q of parts) { L.set(q, o); o += q.length; } return L; };
  return p;
};
// the dip starts of the keyed node's rack output against a reference run of the same node without the source's notes
function dips(D, src, quanta, fire, { order = 'kb', po, dk } = {}) {
  const run = (withNotes) => {
    D.ctx.currentFrame = 0;
    const k = src(withNotes), b = duckNode(D, K, po, dk), nodes = order === 'kb' ? [k, b] : [b, k];
    runOrder(D, nodes, quanta, { feed: i => (nodes[i] === b ? nodes.indexOf(k) : -1), before: q => fire && fire(q, k, b) });
    const L = b.tap();
    assert.ok(peakOf(L) > 0.02 && L.length === quanta * 128, 'the keyed track sounds (every frame through its rack)');
    k.msg({ t: 'bye' }); b.msg({ t: 'bye' });
    return L;
  };
  return dipStarts(run(true), run(false));
}
const junoSong = notes => (withNotes) => { const { p } = mk(D4, { trackId: K }, classic('juno60')); if (withNotes) { p.msg(song(notes)); p.msg(tpPlay(0)); } return p; };
let D4 = null;

test('IMPL-SC G4: a song note of the source at frame f dips the keyed Ducker at f − F0 of the same quantum (source first; both orders of construction); a message-time note at the next quantum\'s first frame; a reader processed before its writer drops the hit — never a quantum late (song and message-time notes alike); the hit\'s velocity does not matter', () => {
  D4 = dspScope({ engine: true, fast: true, console: quiet });
  const ticks = [8, 120, 241], want = ticks.map(fireAt);                 // frames 200, 3000, 6028: three call phases
  assert.deepEqual(want, [200, 3000, 6028]);
  const notes = ticks.map((t, i) => [t, 4, 60 + i, i === 1 ? 10 : 100]);
  assert.deepEqual(dips(D4, junoSong(notes), 60, null), want, 'the source first: dips at the notes\' frames');
  // the keyed node built before the source (construction order is not processing order)
  {
    D4.ctx.currentFrame = 0;
    const b = duckNode(D4, K), { p: k } = mk(D4, { trackId: K }, classic('juno60'));
    k.msg(song(notes)); k.msg(tpPlay(0));
    runOrder(D4, [k, b], 60, { feed: i => (i === 1 ? 0 : -1) });
    const A = b.tap();
    k.msg({ t: 'bye' }); b.msg({ t: 'bye' });
    D4.ctx.currentFrame = 0;
    const b2 = duckNode(D4, K), { p: k2 } = mk(D4, { trackId: K }, classic('juno60'));
    runOrder(D4, [k2, b2], 60, { feed: i => (i === 1 ? 0 : -1) });
    const Z = b2.tap();
    k2.msg({ t: 'bye' }); b2.msg({ t: 'bye' });
    assert.deepEqual(dipStarts(A, Z), want, 'built keyed-first: the same dips');
  }
  // message-time notes on the source (live keys / MIDI): the next quantum's first frame
  const live = (q, k) => { if (q === 7 || q === 31) k.msg({ t: 'on', n: 52, v: 0.9 }); };
  assert.deepEqual(dips(D4, () => mk(D4, { trackId: K }, classic('juno60')).p, 60, (q, k) => live(q, k)), [], '(a control: both runs get the live notes — no dips)');
  {
    const withOnly = (w) => { const { p } = mk(D4, { trackId: K }, classic('juno60')); p.live = w; return p; };
    assert.deepEqual(dips(D4, withOnly, 60, (q, k) => { if (k.live) live(q, k); }), [7 * 128, 31 * 128], 'a message-time note-on (sent before quantum 7 / 31) dips at that quantum\'s offset 0');
  }
  // the reader before its writer: the Ducker trusts a ring only once stamped for its own quantum — song and message-time hits dropped
  assert.deepEqual(dips(D4, junoSong(notes), 60, null, { order: 'bk' }), [], 'processed before its source: no dip, and never one quantum late');
  {
    const withOnly = (w) => { const { p } = mk(D4, { trackId: K }, classic('juno60')); p.live = w; return p; };
    assert.deepEqual(dips(D4, withOnly, 60, (q, k) => { if (k.live) live(q, k); }, { order: 'bk' }), [], 'message-time hits dropped alike');
  }
});

test('IMPL-SC G4: no trackId → no ring (a preview / resample node idles, its Ducker passes the audio); bye removes the ring; a node rebuilt under the same id keeps its own; 65 note-ons in a quantum → 64 kept; the ring compacted and stamped at the top of process', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), R = reg(D);
  const { p: none } = mk(D, { offline: true }, classic('juno60'));
  assert.ok(none.scR === null && R.size === 0, 'no trackId: no ring (the warm-up wrote none)');
  const { p: k } = mk(D, { trackId: K }, classic('juno60'));
  assert.ok(R.get(K) === k.scR && k.scR.q === -1 && k.scR.n === 0, 'a track node owns its ring from birth');
  for (let i = 0; i < 65; i++) k.msg({ t: 'on', n: 36 + (i % 60), v: 0.9 });
  assert.equal(k.scR.n, 64, '65 note-ons at message time: 64 kept');
  assert.ok(Array.from(k.scR.f.subarray(0, 64)).every(f => f === k.frames), 'message-time entries at the next quantum\'s first frame');
  const o = out2();
  k.process([], o); D.ctx.currentFrame += 128;
  assert.deepEqual([k.scR.q, k.scR.n], [0, 64], 'stamped for the quantum, this quantum\'s entries kept');
  k.process([], o); D.ctx.currentFrame += 128;
  assert.deepEqual([k.scR.q, k.scR.n], [128, 0], 'the next quantum: compacted (the previous frames gone), stamped');
  // a node rebuilt under the same id (undo of a delete): built before the old one's bye — the registry keeps the new ring
  const { p: k2 } = mk(D, { trackId: K }, classic('juno60'));
  assert.ok(R.get(K) === k2.scR && k2.scR !== k.scR);
  k.msg({ t: 'bye' });
  assert.ok(R.get(K) === k2.scR && k.scR === null, 'the old node\'s bye leaves the new ring');
  k2.msg({ t: 'bye' });
  assert.ok(!R.has(K), 'bye removes it');
  // a node without trackId: its Ducker idles although the source's ring exists (sc.reg null)
  D.ctx.currentFrame = 0;
  const { p: src } = mk(D, { trackId: K }, classic('juno60')), b = duckNode(D, K, { trackId: '' });
  assert.ok(b.scR === null && b.trackId === '');
  src.msg(song([[8, 4, 60, 100]])); src.msg(tpPlay(0));
  const A = runOrder(D, [src, b], 30, { feed: i => (i === 1 ? 0 : -1) });
  D.ctx.currentFrame = 0;
  const { p: src2 } = mk(D, { trackId: K }, classic('juno60')), b2 = duckNode(D, K, { trackId: '' });
  const Z = runOrder(D, [src2, b2], 30, { feed: i => (i === 1 ? 0 : -1) });
  assert.ok(sameBits(A.L[1], Z.L[1]) && peakOf(A.L[1]) > 0.02 && b.c0.rack.sc.reg === null, 'no registry for a node without trackId: no dip');
});

test('IMPL-SC G4 leaves: a Serum arp\'s generated notes, a TB-303 synced step (not a tied one), an 808 pattern step per sound (BD + SD → 36 and 38; NOTE 38 fires on it), a drum note through its map (35 → 36; a muted lane: nothing), a 909 flam\'s second hit', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), o = out2();
  const log = (p) => { const L = [], f = p.scOn.bind(p); p.scOn = (n, v) => { L.push([p.inSpan === 1 ? p.spanF : p.frames, n, v]); return f(n, v); }; return L; };
  const go = (p, quanta, ev) => { for (let q = 0; q < quanta; q++) { if (ev) ev(q); p.process([], o); D.ctx.currentFrame += 128; } };
  // the Serum arp: one key held, its steps are hits (gen 1 notes through sxNote)
  {
    const { p } = mk(D, { trackId: K }, serum(s => { s.p['arp.on'] = 1; })), L = log(p);
    p.msg({ t: 'on', n: 60, v: 0.8 });
    go(p, 500);
    assert.ok(L.length >= 4 && new Set(L.map(e => e[0])).size >= 4, 'the arp\'s generated notes: ' + L.length + ' hits');
    p.msg({ t: 'bye' });
  }
  // the TB-303: every synced step with a gate is a hit but a tied one (legato: no new note)
  {
    const SEQ = { pat: [0, 3, 7, 12, 0, 5, 10, 3].map((n, k) => ({ n, o: 0, a: k & 1, s: k === 3 ? 1 : 0, g: 1 })), len: 8, bpm: 132, swing: 0.1, root: 36, sync: false, run: true };
    const { p, sent } = mk(D, { trackId: K }, classic('tb303')), L = log(p);
    p.msg({ t: 'seq', s: SEQ });
    go(p, 700);
    const steps = sent.filter(m => m.t === 'step'), tied = steps.filter(m => m.s === 4).length;
    assert.ok(steps.length >= 12 && tied >= 1, steps.length + ' steps, ' + tied + ' after the tie');
    assert.equal(L.length, steps.length - tied, 'hits = the steps less the tied ones');
    assert.ok(L.every(e => e[0] % 4 === 0), 'span events: on the 4-frame grid');
    p.msg({ t: 'bye' });
  }
  // the 808: a step with BD + SD writes 36 and 38 (per lane); a Ducker with NOTE 38 (enum 39) fires on it, NOTE 36 too, NOTE 42 (CH) not
  {
    const d = DC.normDrum(undefined); d.st[0] = new Array(32).fill(0); d.st[0][0] = (1 << 1) | (1 << 2); d.ui.mode = DC.M_MAN;   // step 1: BD + SD
    const pay = DC.payload(d, DC.initState(), 'now');
    const src = (w) => { const { p } = mk(D, { trackId: K, os: 4 }, classic('tr808')); if (w) { p.msg({ t: 'seq', s: pay }); p.msg(tpPlay(0)); } return p; };
    D.ctx.currentFrame = 0;
    const k = src(true), L = log(k);
    go(k, 2);
    assert.deepEqual(L.map(e => [e[0], e[1]]), [[0, 36], [0, 38]], 'one entry per sounding lane, the lanes\' primaries');
    k.msg({ t: 'bye' });
    for (const [note, fires] of [[39, true], [37, true], [43, false]]) {
      const got = dips(D, src, 20, null, { dk: { note } });
      assert.deepEqual(got, fires ? [0] : [], `NOTE ${note}: ${fires ? 'fires' : 'silent'} on the BD + SD step`);
    }
    // a note through the map: 35 (the BD's second note) is stored as the sound's primary 36; a muted BD lane (the machine's own MUTE) writes nothing
    D.ctx.currentFrame = 0;
    const { p } = mk(D, { trackId: K, os: 4 }, classic('tr808')), L2 = log(p);
    p.msg({ t: 'on', n: 35, v: 0.9 }); go(p, 1);
    assert.deepEqual(L2.map(e => e[1]), [36], 'note 35 → the kick lane\'s 36');
    const dm = DC.normDrum(undefined); dm.st[0] = new Array(32).fill(0); dm.x.mute = 1 << 1;   // the BD lane muted
    p.msg({ t: 'seq', s: DC.payload(dm, DC.initState(), 'now') });
    p.msg({ t: 'on', n: 36, v: 0.9 }); p.msg({ t: 'on', n: 38, v: 0.9 }); go(p, 1);
    assert.deepEqual(L2.map(e => e[1]), [36, 38], 'the muted kick lane writes nothing; the snare does');
    p.msg({ t: 'bye' });
  }
  // the 909: a flammed snare fires twice (the flam's second hit ≈ 18 ms later)
  {
    D.ctx.currentFrame = 0;
    const S = drumTrack(DRUM_PATTERNS.d9p, null, false, 'tr909'), { p } = mk(D, { trackId: K, os: 4 });
    p.msg(S.graph);
    for (const [id, patch] of Object.entries(S.patches)) p.msg({ t: 'patch', i: id, p: patch });
    for (const [id, c] of Object.entries(S.chains)) p.msg(Object.assign({ t: 'chain', c: id }, c));
    for (const [id, s] of Object.entries(S.seqs)) p.msg({ t: 'seq', i: id, s });
    p.msg(Object.assign({ t: 'transport' }, S.transport, { frame: 0 }));
    const L = log(p);
    go(p, 400);
    const sd = L.filter(e => e[1] === 38).map(e => e[0]);
    let flams = 0;
    for (let i = 1; i < sd.length; i++) if (sd[i] - sd[i - 1] > 0 && sd[i] - sd[i - 1] < 0.03 * SR) flams++;
    assert.ok(sd.length >= 2 && flams >= 1, `the snare's hits ${JSON.stringify(sd)}: ${flams} flam pair(s)`);
    assert.ok(L.some(e => e[1] === 36) && L.some(e => e[1] === 42), 'kick and hat lanes too');
    p.msg({ t: 'bye' });
  }
});

test('IMPL-SC §4.4: MASTER\'s Ducker fires from any track\'s notes (no key input: its sc.kL null, reg the registry) — the mix dips at the source\'s hits', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), Master = D.procs['synth-master'];
  assert.ok(Master, 'the master processor');
  // the mix the master hears is track b (a held note); the key source k plays the song's notes but is NOT in the mix — the master's
  // output differs between the runs through its Ducker alone
  const run = (withNotes) => {
    D.ctx.currentFrame = 0;
    const { p: k } = mk(D, { trackId: K }, classic('juno60')), { p: b } = mk(D, { trackId: B }, classic('juno60')), m = new Master({ processorOptions: {} });
    m.port.postMessage = () => {};
    const fx = duckFx(K);
    m.msg({ t: 'chain', fxr: C.compileFx(fx, { bpm: 120, rate: SR }), fxrT: C.compileFxT(fx) });
    b.msg({ t: 'on', n: 48, v: 0.8 });
    if (withNotes) { k.msg(song([[8, 4, 72, 100], [120, 4, 74, 100]])); k.msg(tpPlay(0)); }
    const o1 = out2(), o2 = out2(), o3 = out2(), L = new Float64Array(60 * 128);
    for (let q = 0; q < 60; q++) {
      k.process([], o1); b.process([], o2); m.process([[o2[0][0], o2[0][1]]], o3); D.ctx.currentFrame += 128;
      L.set(o3[0][0], q * 128);
    }
    const s = m.c.rack.sc;
    assert.ok(s.kL === null && s.reg === reg(D) && s.q === D.ctx.currentFrame - 128, 'the master\'s sc: no key, the registry, this quantum');
    k.msg({ t: 'bye' }); b.msg({ t: 'bye' }); m.msg({ t: 'bye' });
    return L;
  };
  const A = run(true), Z = run(false);
  assert.ok(peakOf(Z) > 0.02, 'the mix sounds');
  assert.deepEqual(dipStarts(A, Z), [200, 3000], 'the master\'s Ducker dips at the source\'s hits');
});

/* ------------------------------------------------------------------ review 1 F1: the idle skip keeps the sidechain units current */

// K: a Minimoog note every beat for 8 s (drift 0 / hiss 0: a Juno never goes exactly quiet, so it never skips); B: a Ducker (depth 1,
// att 0, smooth 0, 250 ms) and a v3 compressor at KEY EXT, both from K, on a classic's panel / a graph node's shared panel / a Serum's
// own rack. B plays one short note at 0 (its voice dies, its rack idles, its Inst skips after 2 s: engine.js Inst.renderSpan → 0) and
// re-enters 100 ms after the kick at 6.0 s. Both units' state is a function of the key alone (the Ducker's hits, the compressor's
// detector on the key), so a B that skipped must hold, every quantum, the state of a B that never went quiet (one note held through)
const still = (id, fx) => { const m = MODELS.find(x => x.id === id); return patchFor(m, vals(m), fx || core.defaultFx2(), { sr: SR, bpm: 120, drift: 0, hiss: 0 }); };
const scBoth = () => cmpFx(K, {}, duckFx(K, { len: 250 }));
const KICKS = []; for (let b = 0; b < 16; b++) KICKS.push([b * 960, 60, 36, 120]);
const RE = 11520 + 192, KICK6 = fireAt(11520), Q6 = KICK6 / 128, QRE = Math.floor(fireAt(RE) / 128);   // the re-entry tick; the kick at 6.0 s
const SKIP_B = {
  'a classic\'s panel': (D) => { const { p } = mk(D, { trackId: B }, still('minimoog', scBoth())); return { b: p, I: p.i0, rack: p.c0.rack }; },
  'a graph node\'s shared panel': (D) => {
    const { p } = mk(D, { trackId: B }), Z = { lo: 0, hi: 127, xp: 0 }, fx = scBoth();
    p.msg({ t: 'graph', insts: [{ id: 'i1', on: true, zone: Z, salt: 0 }], chains: [{ id: 'fx1' }], edges: [['i1', 'fx1', 1], ['fx1', 'out', 0.5]], out: 'out', key: 'f1' });
    const q = still('minimoog'); delete q.fxr; delete q.fxrT;
    p.msg({ t: 'patch', i: 'i1', p: q }); tables(p, q);
    p.msg({ t: 'chain', c: 'fx1', fxr: C.compileFx(fx, { bpm: 120, rate: SR }), fxrT: C.compileFxT(fx) });
    assert.ok(p.simple === 0 && p.chains.length === 1 && p.insts[0].rack === p.chains[0].rack, 'a graph (spanG / chainSpan), the panel shared');
    return { b: p, I: p.insts[0], rack: p.chains[0].rack };
  },
  'a Serum\'s own rack': (D) => { const { p } = mk(D, { trackId: B }, serum(null, scBoth())); return { b: p, I: p.i0, rack: p.i0.fxc.rack }; },
};
function skipScene(D, mkB, bNotes) {
  D.ctx.currentFrame = 0;
  const { p: k } = mk(D, { trackId: K }, still('minimoog'));
  k.msg(song(KICKS)); k.msg(tpPlay(0));
  const { b, I, rack } = mkB(D);
  b.msg(song(bNotes)); b.msg(tpPlay(0));
  const ud = rack.U.find(x => x.k === 22), uc = rack.U.find(x => x.k === 14);
  assert.ok(ud && uc && ud.src === K && uc.v === 3 && uc.src === K, 'a Ducker and a keyed v3 compressor from ' + K);
  let rendered = 0;
  const rs = I.renderSpan;
  I.renderSpan = function (n) { const r = rs.call(this, n); rendered |= r; return r; };
  const ok = out2(), ob = out2(), QN = 8 * SR / 128, log = [], L = new Float64Array(QN * 128);
  for (let q = 0; q < QN; q++) {
    rendered = 0;
    k.process([], ok); b.process([[ok[0][0], ok[0][1]]], ob);
    L.set(ob[0][0], q * 128);
    log.push([rendered, ud.mod.k, ud.mod.g, uc.mod.gs, uc.mod.pk]);
    D.ctx.currentFrame += 128;
  }
  k.msg({ t: 'bye' }); b.msg({ t: 'bye' });
  return { log, L };
}

test('IMPL-SC review 1 F1: a Ducker and a keyed compressor on a track whose Inst takes the idle skip follow every hit through it — each quantum the state of the same track never quiet (the re-entry 100 ms after the kick at 6.0 s: its dip 4864 samples in, whatever the first note\'s length); the skipped output stays zero — a classic\'s panel, a graph node\'s shared panel, a Serum\'s own rack', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  for (const [site, mkB] of Object.entries(SKIP_B)) {
    const ref = skipScene(D, mkB, [[0, 15360, 48, 100]]).log;            // B held through: never quiet
    assert.ok(ref.every(r => r[0] === 1), site + ': the reference never skips');
    for (const len of site === 'a classic\'s panel' ? [100, 900] : [900]) {
      const { log, L } = skipScene(D, mkB, [[0, len, 48, 100], [RE, 960, 48, 100]]);
      const sk = log.map((r, q) => (r[0] === 0 ? q : -1)).filter(q => q >= 0);
      assert.ok(sk.length > 500 && log[Q6][0] === 0 && log[QRE][0] === 1, `${site} (${len}): the Inst skipped ${sk.length} quanta, the kick at 6.0 s inside the skip, the re-entry rendered`);
      let z = true;
      for (const q of sk) for (let i = 0; i < 128; i++) if (L[q * 128 + i] !== 0) z = false;
      assert.ok(z, `${site} (${len}): the skipped spans' output stays zero`);
      const bad = log.findIndex((r, q) => !(Object.is(r[1], ref[q][1]) && Object.is(r[2], ref[q][2]) && Object.is(r[3], ref[q][3]) && Object.is(r[4], ref[q][4])));
      assert.equal(bad, -1, `${site} (${len}): the units' state ≡ the never-quiet track's every quantum — first differs at quantum ${bad}` +
        (bad >= 0 ? ` (skipped: ${log[bad][0] === 0}): Ducker k ${log[bad][1]} / ${ref[bad][1]}, g ${log[bad][2]} / ${ref[bad][2]}; GR ${log[bad][3]} / ${ref[bad][3]}` : ''));
      assert.equal(log[QRE][1], (QRE + 1) * 128 - KICK6, `${site} (${len}): the re-entry quantum's dip is the kick's at 6.0 s`);
    }
  }
});

test('IMPL-SC review 1 F1 (S1): a skipped track whose rack holds no live sidechain unit — a plain rack, a Ducker without a source, a v3 compressor at KEY INT — runs no rack call while skipping', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const plain = () => { const fx = C.defaultFx2(); C.newInstance(fx, 'eq', { rack: 0 }); return fx; };
  const noSrc = () => duckFx('', { len: 250 });
  const intKey = () => { const fx = cmpFx(K); fx.racks[0].mods.find(x => x.type === 'cmp').p.ext = 0; return fx; };
  for (const [name, fx] of [['a plain rack', plain], ['a Ducker without a source', noSrc], ['a v3 compressor at KEY INT', intKey]]) {
    D.ctx.currentFrame = 0;
    const { p: k } = mk(D, { trackId: K }, still('minimoog'));
    k.msg(song(KICKS)); k.msg(tpPlay(0));
    const { p: b } = mk(D, { trackId: B }, still('minimoog', fx()));
    b.msg(song([[0, 100, 48, 100]])); b.msg(tpPlay(0));
    const r = b.c0.rack, rp = r.process, I = b.i0, rs = I.renderSpan;
    let calls = 0, rendered = 0, skipped = 0;
    r.process = function (...a) { calls++; return rp.apply(this, a); };
    I.renderSpan = function (n) { const x = rs.call(this, n); rendered |= x; return x; };
    const ok = out2(), ob = out2();
    for (let q = 0; q < 4 * SR / 128; q++) {
      rendered = 0;
      const c0 = calls;
      k.process([], ok); b.process([[ok[0][0], ok[0][1]]], ob);
      if (rendered === 0) { skipped++; assert.equal(calls, c0, name + ': no rack call in a skipped quantum (' + q + ')'); }
      D.ctx.currentFrame += 128;
    }
    assert.ok(skipped > 200, name + ': skipped ' + skipped + ' quanta');
    k.msg({ t: 'bye' }); b.msg({ t: 'bye' });
  }
});
