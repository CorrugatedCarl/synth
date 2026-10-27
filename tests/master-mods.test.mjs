// Stage MM (docs/canvas/IMPL-MM.md §3, §6, §9 G2 / G3 / G4; lane E): MASTER's ModCore — the master's modulators on the engine side,
// in a node:vm worklet scope with the whole DSP list and engine.js (as tests/master-proc). The payloads are the host's: a
// track-shaped record (what MREC is to main.js: `{ id: 'master', dev: { mfx: { kind: 'panel', fx }, l1, h1, m1, c1 … }, mods }`),
// its cables through cv-model.addMod, cv-graph.compileMods + `bpm` (§4.2) — never a hand-built CP.
// G2 one system (MM3): MASTER with a 5-unit rack and a payload (4 GLOBAL LFOs, a mono chaos, a macro module, a CC; 8 fx rows, 140
// BPM) against a graph Track built with trackId 'master' (the seed salt, P2-9) whose panel holds the same rack and the same rows
// (the same record compiled with the panel as 'fx1'): MC.fxv and MC.live bit for bit per span over 10 s through a transport start
// and a seek on 128-frame boundaries; MASTER's output ≡ a bare FXRack fed its recorded transport / setMods / modsJump sequence;
// mval moves a macro row's offset; modsErr on a bad CP (the previous rows keep running); {off} → setMods(null) once, every md /
// mdT 0 after the next call, mc null; a loop wrap re-bases the clock at the first part after le — within one quantum of the Track's
// (its frame the same float), songBeat() equal from the next quantum on; a start past le with loop on wraps nothing (tp.wrap false
// as the Track); the song end stops the clock on tp.play (never this.play) and tells the ModCore.
// G3 export = playback (MM2) at 140 BPM: the live MASTER (rows posted, ≥ 0.5 s of exact zeros, a quantum-aligned transport with
// tick / fpt / loop) ≡ the offline MASTER (processorOptions.mods, the pre-roll with the ModCore, the snap at frame 0) bit for bit
// for the §6.1 rack and cables (a BPM-synced anchored LFO on a Filter cutoff, a mono chaos on a Delay feedback, a macro on a Reverb
// mix, a CC on a Utility level; rise / fall 0); with a FREE unsynced Hz LFO added (G3 decides: exact, or the difference recorded);
// a moving source on a knob with unit-internal smoothing (dly.mix, util.level, rev.pre) exact too (the unit-side snap; the rack-level
// snap alone measured and recorded: rev.pre, the loudest — tests/master-mods-snap covers every knob); with one row at rise / fall 0.3
// (measured and recorded: the first second's level and its decay, not gated); without the snap the first part's ramp difference
// is shown (why FXRack.modsJump exists); unaligned starts (F mod 128 = 4 / 60 / 124) measured, ≤ −80 dB (IMPL-M G2 (b)'s class).
// G4 (node part): no allocation per quantum with rows, the start's snap part included.
// Run: node --max-old-space-size=2048 --test tests/master-mods.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dspScope, source, noAlloc } from './dsp-scope.mjs';
import { mulberry32, fnv1a32 } from '../wt.js?v=9';
import * as C from '../fx-core.js?v=9';
import * as CG from '../cv-graph.js?v=9';
import * as MO from '../cv-model.js?v=9';
import { normModDev } from '../song.js?v=9';
import { LFO_LADDER } from '../serum-core.js?v=9';

const quiet = { log() {}, info() {}, debug() {}, warn() {}, error() {} };
const ENGINE = source('engine.js');
const SR = 48000, Q = 128, BPM = 140, FPT = SR * 60 / (BPM * 960);        // (140, not 120: ModCore's default would hide a tempo path)
const dB = x => 20 * Math.log10(x);
const P140 = { bpm: BPM, perf: { wheel: null }, tracks: [], pads: [] };

// a worklet scope: the DSP list, engine.js; every registration recorded (synth-master, synth-safe, synth-engine)
function scope() {
  const D = dspScope({ fast: true, sampleRate: SR, console: quiet });
  D.run('(function () { globalThis.AudioWorkletProcessor = class AudioWorkletProcessor { constructor() { this.port = { msgs: [], postMessage(m) { this.msgs.push(m); }, onmessage: null }; } };'
    + ' globalThis.__reg = []; globalThis.registerProcessor = function registerProcessor(n, c) { globalThis.__reg.push([n, c]); }; })()', 'master-worklet.js');
  D.run(ENGINE, 'engine.js');
  const reg = D.run('globalThis.__reg', 'reg.js'), by = {};
  for (const [n, c] of reg) by[n] = c;
  return { D, ctx: D.ctx, Master: by['synth-master'], Track: by['synth-engine'] };
}
const SC = scope();
const mk = (S, po = {}) => { S.ctx.currentFrame = 0; return new S.Master({ processorOptions: po }); };
const posted = (p, t) => Array.from(p.port.msgs).filter(m => m.t === t);

// FX v2 states: instances [type, {pid: n}] on MAIN, ids <type><k>
function rack(list) {
  const inst = ([type, p], k) => {
    const T = C.FXP_TAB[type], v = T[2] ? 2 : 1, rows = T[v];
    for (const pid of Object.keys(p)) if (!rows.some(r => r.pid === pid)) throw new Error(type + ': no ' + pid);
    return { id: type + k, type, v, p: Object.assign({ on: 1 }, p) };
  };
  return C.normalizeFx2({ v: 2, racks: [{ mods: list.map(inst), byp: 0 }, { mods: [] }, { mods: [] }] });
}
const chain = fx => CG.chainPatch(fx, { sr: SR, bpm: BPM, prefs: {}, seed: false, qr: null });
// §6.1's rack: Filter → synced Delay → Reverb → Utility → Chorus (fil0, dly1, rev2, util3, cho4)
const RACK5 = () => rack([['fil', { cutoff: 0.45, res: 0.3 }], ['dly', { bpm: 1, feed: 0.35, mix: 0.3 }], ['rev', { mix: 0.3 }], ['util', {}], ['cho', { mix: 0.3 }]]);
const ladN = label => LFO_LADDER.findIndex(x => x.label === label) / (LFO_LADDER.length - 1);
// the master's modulator modules (song.normModDev's records; lfo.mono / chaos.mono 1 as normMaster forces them, §1.1)
const MODS = {
  l1: { kind: 'lfo', lfo: { mono: 1, mode: 'free', bpm: 1, anchor: 1 }, rate: ladN('1/4') },  // BPM-synced, anchored to the song
  l2: { kind: 'lfo', lfo: { mono: 1, mode: 'free', bpm: 1, anchor: 0 }, rate: ladN('1/8') },  // BPM-synced, not anchored (the payload's bpm)
  l3: { kind: 'lfo', lfo: { mono: 1, mode: 'retrig', bpm: 0, anchor: 0 }, rate: 0.35 },       // Hz, RETRIG (GLOBAL: the processor LFO, from ▶)
  l4: { kind: 'lfo', lfo: { mono: 1, mode: 'free', bpm: 0, anchor: 0 }, rate: 0.6 },          // Hz, FREE unsynced
  h1: { kind: 'chaos', chaos: { mono: 1, sh: 0 }, rate: 0.5 },
  m1: { kind: 'macro', v: [0.5, 0.25, 0.75, 0, 0, 0, 0, 0] },
  c1: { kind: 'cc', cc: 74, ch: 0, v: 0.6 },
};
// a track-shaped record over a fresh rack state, its cables through cv-model.addMod (the host's path); `panel` names the rack
// device ('mfx' on the master, 'fx1' on G2's Track) → { t, fx, pay }: the payload the host posts (compileMods + bpm, §4.2)
function build(panel, mods, rows) {
  const fx = RACK5(), t = { id: 'master', name: 'Master', dev: { [panel]: { kind: 'panel', fx } }, mods: [], mid: 1 };
  for (const id of mods) t.dev[id] = normModDev(MODS[id]);
  for (const [src, dst, o] of rows) { const r = MO.addMod(t, src, panel + ':' + dst, Object.assign({ project: P140 }, o || {})); if (!r.ok) throw new Error(src + ' → ' + dst + ': ' + r.why); }
  const pay = CG.compileMods(t, P140, { smooth: 1, qr: null, ultra: 0 });
  if (!pay || pay.rows.length !== rows.length) throw new Error('compile: ' + (pay ? pay.rows.length + ' rows, left ' + JSON.stringify(pay.left) : 'null'));
  pay.bpm = P140.bpm;
  return { t, fx, pay };
}
const ROWS4 = [['l1.out', 'fx.fil0.cutoff', { amt: 0.3, bi: 1 }], ['h1.out', 'fx.dly1.feed', { amt: 0.2 }], ['m1.k1', 'fx.rev2.mix', { amt: 0.4 }], ['c1.out', 'fx.util3.level', { amt: 0.25 }]];
const ROWS8 = ROWS4.concat([['l2.out', 'fx.fil0.res', { amt: 0.3 }], ['l3.out', 'fx.cho4.depth', { amt: 0.5 }], ['l4.out', 'fx.dly1.mix', { amt: 0.2 }], ['m1.k2', 'fx.rev2.size', { amt: 0.3 }]]);
const ALL7 = ['l1', 'l2', 'l3', 'l4', 'h1', 'm1', 'c1'], FOUR = ['l1', 'h1', 'm1', 'c1'];
const TR = (F, tick, o) => Object.assign({ t: 'transport', play: true, seek: true, fresh: true, frame: F, tick, fpt: FPT, loop: false, ls: 0, le: 0, end: null, wrap: false }, o || {});

// a deterministic program (stereo, ≈ −14 dBFS): three tones under slow envelopes, a noise burst every 0.5 s (master-proc's)
function program(N, sr = SR, seed = 'prog') {
  const r = mulberry32(fnv1a32(seed)), L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / sr, e = Math.min(1, t * 8) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.7 * t));
    const x = 0.12 * Math.sin(2 * Math.PI * 110 * t) + 0.08 * Math.sin(2 * Math.PI * 277.2 * t + 1) + 0.05 * Math.sin(2 * Math.PI * 1661 * t);
    const b = (t % 0.5) < 0.03 ? 0.2 * (2 * r() - 1) : 0;
    L[i] = e * x + b; R[i] = e * (0.9 * x - 0.03 * Math.sin(2 * Math.PI * 3300 * t)) - 0.7 * b;
  }
  return { L, R };
}
function render(S, p, N, input, before) {
  const L = new Float32Array(N), R = new Float32Array(N), oL = new Float32Array(Q), oR = new Float32Array(Q), out = [[oL, oR]];
  for (let o = 0; o < N; o += Q) {
    if (before) before(o);
    p.process(input ? input(o) : [], out);
    L.set(oL.subarray(0, Math.min(Q, N - o)), o); R.set(oR.subarray(0, Math.min(Q, N - o)), o);
    S.ctx.currentFrame += Q;
  }
  return { L, R };
}
function feedAt(sig, F) {
  const a = new Float32Array(Q), b = new Float32Array(Q);
  return o => {
    for (let i = 0; i < Q; i++) { const k = o + i - F; a[i] = k >= 0 && k < sig.L.length ? sig.L[k] : 0; b[i] = k >= 0 && k < sig.R.length ? sig.R[k] : 0; }
    return [[a, b]];
  };
}
function sameBits(a, b, off = 0) { for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[off + i])) return i; return -1; }
const peak = a => { let m = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } return m; };
const allZero = a => { for (let i = 0; i < a.length; i++) if (a[i] !== 0) return false; return true; };
const graph = { t: 'graph', insts: [{ id: 'i1', on: true, zone: { lo: 0, hi: 127, xp: 0 }, salt: 0 }], chains: [{ id: 'fx1' }], edges: [['i1', 'fx1', 1], ['fx1', 'out', 1]], out: 'out', key: 'g2' };
// G2's pair: MASTER (the rack, the payload) and a graph Track with trackId 'master' holding the same rack on panel fx1 and the
// same rows — the same record compiled with the panel as 'fx1' (the CP, vi and sources identical: the chain name alone differs)
function pair(S, mods, rows) {
  const M = build('mfx', mods, rows), X = build('fx1', mods, rows), ch = chain(M.fx);
  const p = mk(S);
  p.msg(Object.assign({ t: 'chain' }, ch)); p.msg(M.pay);
  const T = new S.Track({ processorOptions: { os: 4, hostOS: 4, trackId: 'master' } });
  T.msg(graph); T.msg({ t: 'chain', c: 'fx1', fxr: ch.fxr, fxrT: ch.fxrT }); T.msg(X.pay);
  return { M, X, ch, p, T };
}

test('G2 (MM3) one system: MASTER with the 5-unit rack and a payload (4 GLOBAL LFOs, chaos, a macro module, a CC; 8 fx rows, 140 BPM) vs a Track built with trackId master holding the same rack and rows — MC.fxv / MC.live bit for bit per span over 10 s through ▶ and a seek on 128-frame boundaries; the output ≡ a bare FXRack fed the recorded transport / setMods / modsJump sequence; mval moves the macro row; modsErr keeps the rows; {off} → setMods(null) once, md / mdT 0', (t) => {
  const S = SC, { M, X, ch, p, T } = pair(S, ALL7, ROWS8);
  assert.ok(p.mc !== null && p.mc.ok === 1 && T.mc !== null && T.mc.ok === 1, 'both ModCores built');
  assert.equal(p.trackId, 'master'); assert.equal(T.mc.shim.seedSalt, p.mc.shim.seedSalt, 'the seed salt fnv1a32(master) on both');
  assert.equal(p.mc.shim.bpm, BPM, 'the payload\'s bpm reaches the shim'); assert.equal(T.mc.shim.bpm, BPM);
  assert.deepEqual([p.mc.fxKey.mfx, T.mc.fxKey.fx1, p.c.rack.key], [C.fxLayout(M.fx).key, C.fxLayout(X.fx).key, C.fxLayout(M.fx).key], 'the rows\' layout key = the rack\'s');
  assert.equal(p.mc.rows.length, 8); assert.equal(M.pay.rows.filter(r => r.dst.kind === 'fx' && r.dst.chain === 'mfx').length, 8, 'every row an fx row on mfx');
  // the run: 10 s of program in; ▶ at quantum 100, a seek to beat 8 at quantum 400, mval at 600, a bad CP at 800, {off} at 1000 —
  // MASTER's rack calls recorded for the bare-rack replay
  const N = Math.round(10 * SR / Q), N1 = 1000, sig = program(N * Q), inp = feedAt(sig, 0);
  const oM = [[new Float32Array(Q), new Float32Array(Q)]], oT = [[new Float32Array(Q), new Float32Array(Q)]], mL = new Float32Array(N * Q), mR = new Float32Array(N * Q);
  const r = p.c.rack, ev = [], sm = r.setMods, mj = r.modsJump, rt = r.transport;
  let qi = 0;
  r.setMods = function (v, k) { ev.push({ q: qi, t: 'm', v: v ? Float64Array.from(v) : null, k }); return sm.call(this, v, k); };
  r.modsJump = function () { ev.push({ q: qi, t: 'j' }); return mj.call(this); };
  r.transport = function () { ev.push({ q: qi, t: 't' }); return rt.call(this); };
  const rowM = M.t.mods[2], ixM = M.pay.rows.find(x => x.id === rowM.id).dst.fx;      // m1.k1 → rev2.mix
  assert.equal(rowM.src, 'm1.k1');
  let badFx = -1, badLive = -1, mvBefore = NaN, mvAfter = NaN, errAt = -1;
  for (qi = 0; qi < N; qi++) {
    if (qi === 99) { p.msg(TR(100 * Q, 0)); T.msg(TR(100 * Q, 0)); }
    if (qi === 399) { p.msg(TR(400 * Q, 8 * 960)); T.msg(TR(400 * Q, 8 * 960)); }
    if (qi === 600) { mvBefore = p.mc.fxv.mfx[ixM]; p.msg({ t: 'mval', k: 0, v: 0.9 }); T.msg({ t: 'mval', k: 0, v: 0.9 }); }
    if (qi === 700) mvAfter = p.mc.fxv.mfx[ixM];
    if (qi === 800) { // a payload the ModCore rejects: reported, the previous rows keep running
      const n0 = posted(p, 'modsErr').length, mc0 = p.mc;
      p.msg({ t: 'mods', i: 'master', key: 'badkey00', cp: { ver: 99 }, rows: [{ id: 'x', src: 5, dst: { kind: 'fx', chain: 'mfx', fx: 8 } }] }); // (serum-dsp cpOk: the version)
      const e = posted(p, 'modsErr');
      assert.equal(e.length, n0 + 1); assert.deepEqual([e.at(-1).i, e.at(-1).key], ['master', 'badkey00']);
      assert.equal(p.mc, mc0, 'the ModCore kept'); assert.equal(p.mc.ok, 1); errAt = qi;
    }
    if (qi === N1) { p.msg({ t: 'mods', i: 'master', off: true }); T.msg({ t: 'mods', i: 'master', off: true }); assert.equal(p.mc, null); assert.equal(T.mc, null); }
    T.process([], oT);
    p.process(inp(qi * Q), oM);
    mL.set(oM[0][0], qi * Q); mR.set(oM[0][1], qi * Q);
    S.ctx.currentFrame += Q;
    if (qi < N1) {
      const a = p.mc.fxv.mfx, b = T.mc.fxv.fx1;
      if (badFx < 0 && (a.length !== b.length || sameBits(a, b) !== -1)) badFx = qi;
      if (badLive < 0 && sameBits(p.mc.live, T.mc.live) !== -1) badLive = qi;
      if (qi === 150) assert.ok(a.subarray(0, p.mc.fxHi.mfx).some(x => x !== 0), 'the rows move the vector');
    }
  }
  assert.equal(badFx, -1, 'MC.fxv per span bit for bit (first differing quantum ' + badFx + ')');
  assert.equal(badLive, -1, 'MC.live per span bit for bit (first differing quantum ' + badLive + ')');
  assert.ok(errAt === 800 && Number.isFinite(mvBefore) && Number.isFinite(mvAfter) && Math.abs(mvAfter - mvBefore) > 0.05, `mval moved the macro row's offset ${mvBefore} → ${mvAfter}`);
  assert.ok(p.tp.play === true && typeof p.songBeat() === 'number', 'the clock runs on without a ModCore (nothing reads it)');
  // {off}: setMods(null) once, c.mcOn 0, every md / mdT 0 after the next call; the rack path left to the calm rule
  const nulls = ev.filter(e => e.t === 'm' && e.v === null);
  assert.equal(nulls.length, 1); assert.equal(nulls[0].q, N1); assert.equal(p.c.mcOn, 0); assert.equal(p.snap, 0);
  assert.ok(allZero(r.gm) && allZero(r.gmT) && r.U.every(u => allZero(u.md) && allZero(u.mdT)), 'every md / mdT back to 0');
  assert.deepEqual(ev.filter(e => e.t === 't').map(e => e.q), [100, 400], 'rack.transport() at ▶ and the seek');
  assert.deepEqual(ev.filter(e => e.t === 'j').map(e => e.q), [100, 400], 'the snap once per start, in its first part');
  assert.ok(ev.filter(e => e.t === 'm').length >= N1, 'a setMods per part');
  // the bare rack fed the same input and the recorded sequence (transport → setMods → modsJump → process, as MASTER's part): the
  // same float32 output bit for bit over [0, N1) — MASTER adds nothing of its own to the rack's sound
  const F = S.D.global('FXDSP'), r2 = new F.FXRack(SR), L = new Float64Array(Q), R = new Float64Array(Q), bL = new Float32Array(N1 * Q), bR = new Float32Array(N1 * Q);
  r2.set(ch.fxr, ch.fxrT);
  let e = 0;
  for (let k = 0; k < N1; k++) {
    const x = inp(k * Q);
    for (let i = 0; i < Q; i++) { L[i] = x[0][0][i]; R[i] = x[0][1][i]; }
    while (e < ev.length && ev[e].q === k) { const v = ev[e++]; if (v.t === 'm') r2.setMods(v.v, v.k); else if (v.t === 'j') r2.modsJump(); else r2.transport(); }
    r2.process(L, R, Q);
    for (let i = 0; i < Q; i++) { bL[k * Q + i] = L[i]; bR[k * Q + i] = R[i]; }
  }
  assert.ok(peak(bL) > 0.05, 'audible');
  assert.equal(sameBits(bL, mL), -1, 'L ≡ the bare rack'); assert.equal(sameBits(bR, mR), -1, 'R ≡ the bare rack');
  t.diagnostic(`G2: ${N} quanta, fxv / live equal every span; ${ev.length} rack calls replayed; mval ${mvBefore.toFixed(4)} → ${mvAfter.toFixed(4)}`);
});

test('G2 clock: a loop wrap re-bases the clock at the first part after le — within one quantum of the Track\'s (tp.frame the same float), songBeat() equal from the next quantum on, the fxv back in step; a start past le with loop on wraps nothing (tp.wrap false, as the Track); the song end stops the clock on tp.play — never this.play — and tells the ModCore', (t) => {
  const S = SC, oM = [[new Float32Array(Q), new Float32Array(Q)]], oT = [[new Float32Array(Q), new Float32Array(Q)]];
  const run = (p, T, n, each) => { for (let k = 0; k < n; k++) { T.process([], oT); p.process([], oM); S.ctx.currentFrame += Q; if (each) each(k); } };
  { // the wrap: a 4-beat loop from quantum 10 — the wrap frame 1280 + 4 · 960 · fpt (a float inside quantum 652)
    const { p, T } = pair(S, FOUR, ROWS4), le = 4 * 960, Fw = 10 * Q + le * FPT;
    p.msg(TR(10 * Q, 0, { loop: true, ls: 0, le, wrap: true })); T.msg(TR(10 * Q, 0, { loop: true, ls: 0, le, wrap: true }));
    let wM = -1, wT = -1, diff = 0, after = 0;
    run(p, T, 700, k => {
      if (wT < 0 && k > 10 && T.tp.frame > 10 * Q) wT = k;
      if (wM < 0 && k > 10 && p.tp.frame > 10 * Q) wM = k;
      if (wM >= 0 && k > wM) { after++; if (p.songBeat() !== T.songBeat()) diff++; }
    });
    assert.ok(p.tp.wrap === true && T.tp.wrap === true);
    assert.equal(wT, Math.floor(Fw / Q), 'the Track wraps in the quantum holding the wrap frame');
    assert.ok(wM === wT || wM === wT + 1, `MASTER re-bases at the first part after le: quantum ${wM} (the Track ${wT})`);
    assert.equal(p.tp.frame, T.tp.frame, 'the re-based frame: the same float (the Track\'s formula)'); assert.equal(p.tp.tick, 0);
    assert.equal(diff, 0, `songBeat() equal on every quantum after the wrap (${after} quanta)`);
    let fxd = 0, fxLast = -1;
    run(p, T, 300, k => { if (sameBits(p.mc.fxv.mfx, T.mc.fxv.fx1) !== -1) { fxd++; fxLast = k; } });
    t.diagnostic(`wrap: MASTER re-based at quantum ${wM} (wrap frame ${Fw.toFixed(1)}, the Track at ${wT}); fxv differing quanta over the 300 after: ${fxd}` + (fxd ? ` (last at +${fxLast})` : ''));
    assert.ok(fxd === 0 || fxLast < 3, 'the fxv back in step within a few quanta of the wrap (the Track split a span at the wrap frame; MASTER did not)');
  }
  { // a start past le with loop on: no wrap (engine.js's tp.wrap rule), the clock runs on
    const { p, T } = pair(S, FOUR, ROWS4);
    p.msg(TR(10 * Q, 2000, { loop: true, ls: 0, le: 960, wrap: false })); T.msg(TR(10 * Q, 2000, { loop: true, ls: 0, le: 960, wrap: false }));
    run(p, T, 400);
    assert.deepEqual([p.tp.wrap, T.tp.wrap, p.tp.tick, T.tp.tick, p.tp.frame, T.tp.frame], [false, false, 2000, 2000, 10 * Q, 10 * Q]);
    assert.ok(p.songBeat() > 2000 / 960 + 0.5 && p.songBeat() === T.songBeat(), 'past le, no wrap: ' + p.songBeat());
  }
  { // the song end at beat 2: tp.play false on both, songBeat() null, MASTER's this.play still true (the meters' flag), SxMod told
    const { p, T } = pair(S, FOUR, ROWS4), end = 2 * 960;
    p.msg(TR(10 * Q, 0, { end })); T.msg(TR(10 * Q, 0, { end }));
    run(p, T, 100);
    assert.ok(p.tp.play === true && p.songBeat() > 0 && p.mc.sx.mod.playing === 1, 'playing before the end');
    run(p, T, 400);
    assert.deepEqual([p.tp.play, T.tp.play, p.songBeat(), T.songBeat(), p.play, p.mc.sx.mod.playing, T.mc.sx.mod.playing], [false, false, null, null, true, 0, 0]);
    // a play transport without seek after the end (a re-anchor): the Track's `P.seek || !tp.play` restarts its ModCore — MASTER's too
    const F2 = S.ctx.currentFrame + 10 * Q;
    p.msg(TR(F2, 0, { seek: false, end: null })); T.msg(TR(F2, 0, { seek: false, end: null }));
    let snapped = -1;
    run(p, T, 20, k => { if (snapped < 0 && p.snap === 1) snapped = k; });
    assert.deepEqual([p.tp.play, T.tp.play, p.mc.sx.mod.playing, T.mc.sx.mod.playing, p.songBeat() === T.songBeat(), p.snap], [true, true, 1, 1, true, 0]);
    assert.equal(snapped, -1, 'the snap flag is consumed inside the quantum of the start (set by start(), cleared by its first part)');
    p.msg({ t: 'transport', play: false });
    assert.deepEqual([p.play, p.tp.play, p.tp.pend], [false, false, null]);
    run(p, T, 10);
    assert.equal(p.songBeat(), null);
  }
});

// G3: offline (processorOptions: the rack, the payload, a transport at frame offF — 0, the bounce's; m for the same-partition
// check of (d) —, the pre-roll with the ModCore, the snap) vs live (the warm-up, the chain, the payload, ≥ 0.5 s of exact zeros,
// the transport posted 1024 frames ahead at F); snap false: both racks' modsJump made a no-op (the ramp difference the snap
// removes, §3.4); snap 'rack': both racks' modsJump the rack-level snap alone (md ← mdT, 8eb271c's body: the units' own
// interpolators start from the pre-▶ value — the difference the unit-side snap removes). Compared: offline [offF, offF + T) against
// live [F, F + T)
function rackSnap() { const gm = this.gm, gT = this.gmT; for (let g = 0; g < gm.length; g++) gm[g] = gT[g]; for (const u of this.U) for (let p = 0; p < u.n; p++) u.md[p] = u.mdT[p]; }
function g3(fx, pay, F, { sec = 2.5, tail = 1.5, snap = true, offF = 0 } = {}) {
  const sig = program(Math.round(sec * SR)), T = Math.ceil((sec + tail) * SR / Q) * Q, ch = chain(fx);
  const off = mk(SC, { offline: true, fxr: ch.fxr, fxrT: ch.fxrT, mods: pay, transport: { play: true, frame: offF, tick: 0, fpt: FPT, loop: false, seek: true, fresh: true }, frames: T });
  assert.ok(off.mc !== null && off.mc.ok === 1, 'the offline ModCore from the options');
  if (!snap) off.c.rack.modsJump = function () {}; else if (snap === 'rack') off.c.rack.modsJump = rackSnap;
  const A = render(SC, off, offF + T + Q, feedAt(sig, offF));
  const live = mk(SC);
  live.msg(Object.assign({ t: 'chain' }, ch)); live.msg(pay);
  if (!snap) live.c.rack.modsJump = function () {}; else if (snap === 'rack') live.c.rack.modsJump = rackSnap;
  const at = Math.max(0, Math.floor((F - 1024) / Q) * Q);
  const B = render(SC, live, F + T + Q, feedAt(sig, F), o => { if (o === at) live.msg(TR(F, 0)); });
  let d = 0, last = -1, first = -1;
  for (let i = 0; i < T; i++) { const e = Math.max(Math.abs(A.L[offF + i] - B.L[F + i]), Math.abs(A.R[offF + i] - B.R[F + i])); if (e > d) d = e; if (e > 0) { last = i; if (first < 0) first = i; } }
  const AL = A.L.subarray(offF, offF + T), AR = A.R.subarray(offF, offF + T);
  return { A: { L: AL, R: AR }, B, T, F, d, last, first, ref: Math.max(peak(AL), peak(AR)), exact: sameBits(AL, B.L, F) === -1 && sameBits(AR, B.R, F) === -1, off, live };
}
// the difference per 0.25 s window of the first 2 s (dB re the offline peak; −Infinity: none)
function windows(r) {
  const out = [];
  for (let w = 0; w < 8; w++) {
    let d = 0;
    for (let i = w * SR / 4; i < (w + 1) * SR / 4; i++) d = Math.max(d, Math.abs(r.A.L[i] - r.B.L[r.F + i]), Math.abs(r.A.R[i] - r.B.R[r.F + i]));
    out.push(d === 0 ? 'none' : +dB(d / r.ref).toFixed(1));
  }
  return out;
}
const dBof = r => (r.exact ? 'EXACT' : dB(r.d / r.ref).toFixed(1) + ' dB re peak, samples ' + r.first + '…' + r.last + ' (' + (r.last / SR).toFixed(2) + ' s)');

test('G3 (MM2) export = playback at 140 BPM: the §6.1 rack with a BPM-synced anchored LFO on the Filter cutoff, a mono chaos on the Delay feedback, a macro on the Reverb mix, a CC on the Utility level (rise / fall 0) — the live MASTER after ≥ 0.5 s of exact zeros from a quantum-aligned start ≡ the offline MASTER (options, the pre-roll with the ModCore, the snap at frame 0) bit for bit', (t) => {
  const { fx, pay } = build('mfx', FOUR, ROWS4);
  assert.deepEqual([pay.rows.length, pay.bpm, pay.rows.every(r => r.dst.kind === 'fx' && r.dst.chain === 'mfx')], [4, BPM, true]);
  for (const F of [187 * Q, 250 * Q]) {
    const r = g3(fx, pay, F);
    assert.ok(r.ref > 0.05, 'audible');
    assert.ok(r.off.mc.spans > r.T / Q, 'the pre-roll ran the ModCore too (spans ' + r.off.mc.spans + ' > ' + r.T / Q + ')');
    assert.ok(r.exact, `F ${F}: max |live − offline| ${r.d} (${dB(r.d / r.ref).toFixed(1)} dB), last at ${r.last}`);
  }
  t.diagnostic('G3 the four kinds, no slew: exact at two aligned starts');
});

test('G3 (b): a FREE unsynced Hz LFO added (G3 decides: exact — SxMod.transport(true) resets every processor LFO, FREE included) on a coefficient knob; a moving source on a knob with unit-internal smoothing (the Delay\'s MIX, the Utility\'s LEVEL, the Reverb\'s PRE-DELAY) exact too — the unit-side snap in modsJump; the rack-level snap alone measured and recorded on rev.pre (a moving source\'s pre-▶ trajectory leaves the unit\'s smoother elsewhere: why the unit-side snap exists); and the four cables with the snap made a no-op: the first part ramps from a history-dependent start, the difference shown (why FXRack.modsJump exists)', (t) => {
  const r = (() => { const { fx, pay } = build('mfx', ['l1', 'l4', 'h1', 'm1', 'c1'], ROWS4.concat([['l4.out', 'fx.fil0.res', { amt: 0.3 }]])); return g3(fx, pay, 187 * Q); })();
  t.diagnostic(`G3 (b) FREE unsynced Hz LFO on fil.res: ${dBof(r)}`);
  assert.ok(r.exact, 'a FREE unsynced LFO is exact too');
  // the smoothed-knob class: the FREE LFO on the Delay's MIX (beside the four cables) and on the Reverb's PRE-DELAY, the BPM-anchored
  // one on the Utility's LEVEL — exact; rev.pre with the rack-level snap alone (8eb271c: −21.3 dB, carried the whole window) recorded
  const s1 = (() => { const { fx, pay } = build('mfx', ['l1', 'l4', 'h1', 'm1', 'c1'], ROWS4.concat([['l4.out', 'fx.dly1.mix', { amt: 0.2 }]])); return g3(fx, pay, 187 * Q); })();
  const s2 = (() => { const { fx, pay } = build('mfx', ['l1', 'h1', 'm1', 'c1'], [['l1.out', 'fx.util3.level', { amt: 0.3, bi: 1 }]]); return g3(fx, pay, 187 * Q); })();
  const pre = build('mfx', ['l4'], [['l4.out', 'fx.rev2.pre', { amt: 0.3 }]]), s3 = g3(pre.fx, pre.pay, 187 * Q), s3r = g3(pre.fx, pre.pay, 187 * Q, { snap: 'rack' });
  t.diagnostic(`G3 (b) a moving source on a smoothed knob — FREE LFO on dly.mix: ${dBof(s1)}; BPM LFO on util.level: ${dBof(s2)}; FREE LFO on rev.pre: ${dBof(s3)}; with the rack-level snap alone: ${dBof(s3r)}, windows ${JSON.stringify(windows(s3r))}`);
  assert.ok(s1.ref > 0.05 && s2.ref > 0.05 && s3.ref > 0.05);
  assert.deepEqual([s1.exact, s2.exact, s3.exact], [true, true, true], 'a moving source on dly.mix / util.level / rev.pre: exact (the unit-side snap)');
  assert.equal(s3r.exact, false, 'the rack-level snap alone leaves the pre-delay\'s slew on its pre-▶ trajectory: not bit-identical');
  const u = (() => { const { fx, pay } = build('mfx', FOUR, ROWS4); return g3(fx, pay, 187 * Q, { snap: false }); })();
  t.diagnostic(`without the snap (the four cables): ${dBof(u)}, windows ${JSON.stringify(windows(u))}`);
  assert.equal(u.exact, false, 'without modsJump the first rack call after ▶ ramps from the pre-▶ offsets: not bit-identical');
  assert.ok(u.d > 0 && u.first === 0, 'the difference starts at the first sample (the first part\'s ramp)');
});

test('G3 (c): one row at rise / fall 0.3 — the pseudo-voice\'s slews are not reset by transport, so the master\'s cable glides from its pre-▶ value for SLEW_T after ▶: measured and recorded (level per 0.25 s window and the decay), not gated', (t) => {
  const { fx, pay } = build('mfx', FOUR, [['l1.out', 'fx.fil0.cutoff', { amt: 0.3, bi: 1, rise: 0.3, fall: 0.3 }]].concat(ROWS4.slice(1)));
  const r = g3(fx, pay, 187 * Q, { sec: 3, tail: 1 }), w = windows(r);
  t.diagnostic(`G3 (c) slewed row: ${r.exact ? 'EXACT' : 'max |live − offline| ' + dB(r.d / r.ref).toFixed(1) + ' dB re peak, last differing sample ' + r.last + ' (' + (r.last / SR).toFixed(2) + ' s)'}; windows (dB) ${JSON.stringify(w)}`);
  assert.ok(r.ref > 0.05);
  assert.ok(r.exact || w.at(-1) < w[0] || w.at(-1) === -Infinity, 'the difference decays');
});

test('G3 (d) unaligned starts (F mod 128 = 4 / 60 / 124) with the four cables: against an offline render with the same unaligned start (the same parts, hence the same spans and ramps) bit for bit — the partition is the only difference; against the bounce\'s frame-0 render measured and recorded (the per-call linear ramps of a moving knob differ by one quantum\'s modulation step: IMPL-M G2 (b)\'s class, larger than its −80 dB because the modulation moves faster than the base smoothing; never reached — mAlign)', (t) => {
  const { fx, pay } = build('mfx', FOUR, ROWS4), rec = {}, same = {};
  for (const m of [4, 60, 124]) {
    const s = g3(fx, pay, 187 * Q + m, { offF: m });
    same[m] = dBof(s);
    assert.ok(s.exact, `F mod 128 = ${m} vs the same partition offline: ${dBof(s)}`);
    const r = g3(fx, pay, 187 * Q + m), v = r.d === 0 ? -Infinity : dB(r.d / r.ref);
    rec[m] = r.d === 0 ? 'exact' : +v.toFixed(1);
    assert.ok(r.d === 0 || v <= -40, `F mod 128 = ${m} vs the frame-0 render: ${v.toFixed(1)} dB (the tripwire: the modulation's one-quantum step)`);
  }
  t.diagnostic('G3 (d) vs the same unaligned partition offline: ' + JSON.stringify(same) + '; vs the frame-0 render, max |live − offline| re peak (dB): ' + JSON.stringify(rec));
});

test('G4 (node): no allocation per quantum with rows — 80 quanta of the four-cable rack playing, then a transport start inside the window (the snap part), then a seek (monitors off, between two stats posts)', () => {
  const { fx, pay } = build('mfx', FOUR, ROWS4), ch = chain(fx), p = mk(SC), sig = program(2 * SR), inp = feedAt(sig, 0), out = [[new Float32Array(Q), new Float32Array(Q)]];
  p.msg(Object.assign({ t: 'chain' }, ch)); p.msg(pay);
  const go = (k, f) => { for (let i = 0; i < k; i++) { if (f) f(i); p.process(inp(i * Q), out); SC.ctx.currentFrame += Q; } };
  go(10);
  p.statN = 0;
  noAlloc(SC.D, () => go(80));
  p.msg(TR(SC.ctx.currentFrame + 10 * Q, 0));
  p.statN = 0;
  noAlloc(SC.D, () => go(80, i => { if (i === 40) p.msg(TR(SC.ctx.currentFrame + 5 * Q, 4 * 960)); }));
  assert.ok(p.play === true && p.tp.play === true && p.mc !== null && p.snap === 0);
});
