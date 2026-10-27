// Stage MM (docs/canvas/IMPL-MM.md §3.4, §6.1, §11; reviewer 1's P1): MM2 — export = playback, bit for bit — for a MOVING master
// modulator on every knob, not only the coefficient knobs. The rack-level snap (md ← mdT) alone left each unit's own interpolators
// starting from the pre-▶ value — the dry / wet gains (gD0 / gW0), the Delay's read-position slew (dL → tL), the Reverb's pre-delay
// slew, the Utility's w0 / gL0 / gR0, the Chorus' taps, the Bode's delay — and the pre-▶ trajectory differs (live: the payload's
// lifetime; offline: the pre-roll): on 8eb271c rev.pre read −21 dB, dly.timeL −21 dB, util.* / *.mix / *.level −23…−71 dB, bode.delay
// −1.7 dB, util.lpf −7.9 dB. FXRack.modsJump() now applies states()'s unit-on recipe (targets from bs + mdT, modUpd, modSnap, mixUpd,
// gD0 / gW0 ← gD1 / gW1) to the units whose offsets are non-zero. Here: one source on one knob — a FREE unsynced Hz LFO, the
// BPM-anchored LFO, a mono chaos — the live MASTER (rows posted, ≥ 0.5 s of exact zeros, a quantum-aligned transport) ≡ the offline
// MASTER (processorOptions: the bounce's, the pre-roll with the ModCore, the snap at frame 0) at 140 BPM, every sample of 4 s: (1)
// the §6.1 rack (Filter → synced Delay → Reverb → Utility → Chorus), 15 knobs; (2) every modulatable knob of every effect type alone
// (conv / the splitters aside) — exact but for the two stepped topology knobs §11 records (Phaser POLES: the coefficient slots above
// the running pole count; Reverb TYPE: the newly installed tank's glides), measured and held to a transient (< 1 s).
// The payloads are the host's (cv-model.addMod, cv-graph.compileMods + bpm), as tests/master-mods.
// Run: node --max-old-space-size=2048 --test tests/master-mods-snap.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dspScope, source } from './dsp-scope.mjs';
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

function scope() {
  const D = dspScope({ fast: true, sampleRate: SR, console: quiet });
  D.run('(function () { globalThis.AudioWorkletProcessor = class AudioWorkletProcessor { constructor() { this.port = { msgs: [], postMessage(m) { this.msgs.push(m); }, onmessage: null }; } };'
    + ' globalThis.__reg = []; globalThis.registerProcessor = function registerProcessor(n, c) { globalThis.__reg.push([n, c]); }; })()', 'master-worklet.js');
  D.run(ENGINE, 'engine.js');
  const reg = D.run('globalThis.__reg', 'reg.js'), by = {};
  for (const [n, c] of reg) by[n] = c;
  return { D, ctx: D.ctx, Master: by['synth-master'] };
}
const SC = scope();
const mk = (po = {}) => { SC.ctx.currentFrame = 0; return new SC.Master({ processorOptions: po }); };

function rack(list) {
  const inst = ([type, p], k) => {
    const T = C.FXP_TAB[type], v = T[2] ? 2 : 1, rows = T[v];
    for (const pid of Object.keys(p)) if (!rows.some(r => r.pid === pid)) throw new Error(type + ': no ' + pid);
    return { id: type + k, type, v, p: Object.assign({ on: 1 }, p) };
  };
  return C.normalizeFx2({ v: 2, racks: [{ mods: list.map(inst), byp: 0 }, { mods: [] }, { mods: [] }] });
}
const chain = fx => CG.chainPatch(fx, { sr: SR, bpm: BPM, prefs: {}, seed: false, qr: null });
// §6.1's rack: fil0, dly1, rev2, util3, cho4
const RACK5 = () => rack([['fil', { cutoff: 0.45, res: 0.3 }], ['dly', { bpm: 1, feed: 0.35, mix: 0.3 }], ['rev', { mix: 0.3 }], ['util', {}], ['cho', { mix: 0.3 }]]);
const ladN = label => LFO_LADDER.findIndex(x => x.label === label) / (LFO_LADDER.length - 1);
const MODS = {
  l1: { kind: 'lfo', lfo: { mono: 1, mode: 'free', bpm: 1, anchor: 1 }, rate: ladN('1/4') },  // BPM-synced, anchored to the song
  l4: { kind: 'lfo', lfo: { mono: 1, mode: 'free', bpm: 0, anchor: 0 }, rate: 0.6 },          // Hz, FREE unsynced
  h1: { kind: 'chaos', chaos: { mono: 1, sh: 0 }, rate: 0.5 },                                  // mono chaos
};
// one cable src → dst on a track-shaped master record over `fx` → { fx, pay } (the host's payload: compileMods + bpm), or
// { why } when cv-model refuses the knob
function cable(fx, src, dst, o) {
  const t = { id: 'master', name: 'Master', dev: { mfx: { kind: 'panel', fx }, [src]: normModDev(MODS[src]) }, mods: [], mid: 1 };
  const r = MO.addMod(t, src + '.out', 'mfx:' + dst, Object.assign({ project: P140 }, o));
  if (!r.ok) return { why: r.why };
  const pay = CG.compileMods(t, P140, { smooth: 1, qr: null, ultra: 0 });
  if (!pay || pay.rows.length !== 1) throw new Error('compile ' + dst + ': ' + (pay ? JSON.stringify(pay.left) : 'null'));
  pay.bpm = P140.bpm;
  return { fx, pay };
}
const TR = (F, tick) => ({ t: 'transport', play: true, seek: true, fresh: true, frame: F, tick, fpt: FPT, loop: false, ls: 0, le: 0, end: null, wrap: false });

// a deterministic program (stereo, ≈ −14 dBFS): three tones under slow envelopes, a noise burst every 0.5 s (master-proc's)
function program(N, seed = 'prog') {
  const r = mulberry32(fnv1a32(seed)), L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / SR, e = Math.min(1, t * 8) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.7 * t));
    const x = 0.12 * Math.sin(2 * Math.PI * 110 * t) + 0.08 * Math.sin(2 * Math.PI * 277.2 * t + 1) + 0.05 * Math.sin(2 * Math.PI * 1661 * t);
    const b = (t % 0.5) < 0.03 ? 0.2 * (2 * r() - 1) : 0;
    L[i] = e * x + b; R[i] = e * (0.9 * x - 0.03 * Math.sin(2 * Math.PI * 3300 * t)) - 0.7 * b;
  }
  return { L, R };
}
function render(p, N, input, before) {
  const L = new Float32Array(N), R = new Float32Array(N), oL = new Float32Array(Q), oR = new Float32Array(Q), out = [[oL, oR]];
  for (let o = 0; o < N; o += Q) {
    if (before) before(o);
    p.process(input(o), out);
    L.set(oL.subarray(0, Math.min(Q, N - o)), o); R.set(oR.subarray(0, Math.min(Q, N - o)), o);
    SC.ctx.currentFrame += Q;
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
const peak = a => { let m = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } return m; };

// offline [0, T) (the bounce: frame-0 transport, the pre-roll with the ModCore, the snap) vs live [F, F + T) (the chain and the
// payload at once, the transport posted 1024 frames ahead of F); bits compared with Object.is → { exact, d, first, last, ref, mdT }
const SIG = program(Math.round(2.5 * SR)), T = Math.ceil(4 * SR / Q) * Q, F = 187 * Q;
function g3(fx, pay) {
  const ch = chain(fx);
  const off = mk({ offline: true, fxr: ch.fxr, fxrT: ch.fxrT, mods: pay, transport: { play: true, frame: 0, tick: 0, fpt: FPT, loop: false, seek: true, fresh: true }, frames: T });
  const A = render(off, T + Q, feedAt(SIG, 0));
  const live = mk();
  live.msg(Object.assign({ t: 'chain' }, ch)); live.msg(pay);
  const at = Math.floor((F - 1024) / Q) * Q;
  const B = render(live, F + T + Q, feedAt(SIG, F), o => { if (o === at) live.msg(TR(F, 0)); });
  let d = 0, first = -1, last = -1, exact = true;
  for (let i = 0; i < T; i++) {
    if (!Object.is(A.L[i], B.L[F + i]) || !Object.is(A.R[i], B.R[F + i])) { exact = false; if (first < 0) first = i; last = i; }
    const e = Math.max(Math.abs(A.L[i] - B.L[F + i]), Math.abs(A.R[i] - B.R[F + i])); if (e > d) d = e;
  }
  return { exact, d, first, last, ref: Math.max(peak(A.L.subarray(0, T)), peak(A.R.subarray(0, T))), mdT: off.c.rack.U.some(u => u.mdT.some(x => x !== 0)) };
}
const dBof = r => (r.exact ? 'EXACT' : dB(r.d / r.ref).toFixed(1) + ' dB re peak, ' + (r.first / SR).toFixed(3) + '–' + (r.last / SR).toFixed(2) + ' s');

// (1) the reviewer's 13 knobs (8 of them read −21…−71 dB on 8eb271c: rev.pre, dly.timeL, util.width / level / pan, cho.mix,
// dly.mix, rev.mix), + fil.res and cho.rate (lane E's coefficient knobs)
const KNOBS = [['fx.fil0.cutoff', { amt: 0.3, bi: 1 }], ['fx.fil0.res', { amt: 0.3 }], ['fx.fil0.mix', { amt: 0.3 }], ['fx.dly1.feed', { amt: 0.2 }],
  ['fx.dly1.mix', { amt: 0.2 }], ['fx.dly1.timeL', { amt: 0.2 }], ['fx.rev2.size', { amt: 0.3 }], ['fx.rev2.mix', { amt: 0.3 }], ['fx.rev2.pre', { amt: 0.3 }],
  ['fx.util3.level', { amt: 0.3, bi: 1 }], ['fx.util3.width', { amt: 0.3, bi: 1 }], ['fx.util3.pan', { amt: 0.3, bi: 1 }],
  ['fx.cho4.depth', { amt: 0.5 }], ['fx.cho4.rate', { amt: 0.3 }], ['fx.cho4.mix', { amt: 0.3 }]];
const SOURCES = [['l4', 'FREE Hz LFO'], ['l1', 'BPM-anchored LFO'], ['h1', 'mono chaos']];

for (const [src, what] of SOURCES) {
  test(`MM2 export = playback for a moving source — a ${what} (${src}) on each of ${KNOBS.length} knobs of the §6.1 rack, one cable at a time: live ≡ the bounce's offline render bit for bit over 4 s at 140 BPM (the unit-side snap in FXRack.modsJump)`, (t) => {
    const bad = [];
    for (const [dst, o] of KNOBS) {
      const b = cable(RACK5(), src, dst, o);
      assert.equal(b.why, undefined, dst + ': the cable');
      const r = g3(b.fx, b.pay);
      assert.ok(r.ref > 0.05, dst + ': audible');
      assert.ok(r.mdT, dst + ': the rack\'s offsets moved');
      t.diagnostic(`${src} → ${dst}: ${dBof(r)}`);
      if (!r.exact) bad.push(`${dst} ${dBof(r)}`);
    }
    assert.deepEqual(bad, [], 'every knob exact live vs bounce');
  });
}

// (2) every effect type alone (the master's rack may hold any of them; conv needs an IR asset, the splitters are containers)
const TYPES = ['dist', 'flg', 'phs', 'cho', 'dly', 'cmp', 'rev', 'eq', 'fil', 'hyper', 'bode', 'util', 'duck'];
const STEPPED = new Set(['phs.poles', 'rev.type']);                    // §11: a stepped topology knob under a moving source

test(`MM2 for a moving source on every modulatable knob of every effect type alone (${TYPES.join(' / ')}; the three sources, one cable at a time): live ≡ the bounce bit for bit — but the two stepped topology knobs (Phaser POLES, Reverb TYPE), measured and recorded (IMPL-MM §11), their difference over within 1 s`, (t) => {
  const bad = [], rec = [], refused = [], per = {};
  for (const ty of TYPES) {
    const T0 = C.FXP_TAB[ty], rows = T0[T0[2] ? 2 : 1];
    per[ty] = 0;
    for (const { pid } of rows) {
      if (pid === 'on') continue;
      for (const [src] of SOURCES) {
        const b = cable(rack([[ty, {}]]), src, 'fx.' + ty + '0.' + pid, { amt: 0.3, bi: 1 });
        if (b.why) { refused.push(ty + '.' + pid); break; }
        const r = g3(b.fx, b.pay), id = ty + '.' + pid;
        assert.ok(r.ref > 0.05, id + ' ' + src + ': audible');
        per[ty]++;
        if (STEPPED.has(id)) {
          rec.push(`${id} ${src}: ${dBof(r)}`);
          assert.ok(r.exact || r.last < SR, `${id} ${src}: the difference over within 1 s (${dBof(r)})`);
        } else if (!r.exact) bad.push(`${id} ${src}: ${dBof(r)}`);
      }
    }
  }
  t.diagnostic('cases per type ' + JSON.stringify(per) + '; refused by cv-model (not modulatable): ' + refused.join(', '));
  t.diagnostic('the stepped topology knobs (recorded, IMPL-MM §11): ' + rec.join('; '));
  assert.ok(TYPES.every(ty => per[ty] > 0), 'every type contributes');
  assert.deepEqual(bad, [], 'every other knob exact live vs bounce');
});
