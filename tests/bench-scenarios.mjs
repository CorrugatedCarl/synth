// §14.1 benchmark scenarios d–m (owner I; SPEC-serum2 §14.1, §0.8 item 10): shared by tests/bench.html (Safari / iPad
// loads, recorded at the end of M2) and the node smoke test in tests/bench.test.mjs. ES module, browser- and node-safe
// (no DOM): every scenario is built from serum-core / fx-core states and synthetic assets (smp.js / smpwork.js — the
// same entry builders the app uses), then rendered through the real engine (a SynthProcessor of the caller's worklet-like
// scope) or, for the FX rows, through FXDSP.FXRack on a noise input. Loads are the fraction of real time for 1 s of
// audio (median of `runs`), base 48 kHz, oversampling 2; `worst` is the slowest 128-frame quantum of the timed runs as
// a fraction of its real time (1 = the 2.67 ms deadline at 48 kHz). Every timed run must be audible (peak > 1e-4;
// Granular rows: grains sounding) — a run past the end of a one-shot source would time silence: the sample rows loop.
// Rows of kind 'switch' (q1, q2: §11.10 lazy warm-ups) measure a LIVE processor: a WT patch is played, then the preset
// changes to the row's patch while the track is silent (0.5 s, the warm-ups' time) and the chord is played again; their
// load is the slowest quantum of the first 1.5 s of that chord (fraction of real time; a JIT-cold voice path is what it
// catches — at the onset, and the paths a note meets only later: grains ending, playheads reaching the region end; M4:
// was the first 50 ms), `steady` the median quantum of the chord after 0.5 s. Rows of kind 'track' (r, IMPL-1e §7) render a
// graph node with several instruments: {t: 'graph'}, {t: 'patch', i} per instrument, {t: 'chain', c} per shared panel, the
// chord reaching every instrument (full key zones); classic instruments at the app's oversampling (4). The row of kind 'sweep'
// (the idle-DSP review #3 d) times a reverb rack on exact zeros after the noise: its load is the slowest quantum holding a
// denormal sweep (fresh racks, median of `runs`).
//   const S = scenarios();                          // [{id, label, node, ipad, kind, gran?, build()}]
//   const r = measure(S[0], env, {runs: 5});        // {load, loads, peak, worst}
// env = { mk(processorOptions) → processor, advance(frames), FXDSP, SxBase, now() → ms, mkMaster(processorOptions, bare) → a
// 'synth-master' processor (bare: built without the meters — MASTERDSP hidden while it is constructed; kind 'master', IMPL-M G4) }.
import * as core from '../serum-core.js?v=9';
import * as W from '../wt.js?v=9';
import { patchFor, MODELS } from '../models.js?v=9';
import * as smp from '../smp.js?v=9';
import { playbackEntry, specEntry, irEntry } from '../smpwork.js?v=9';
import { convShapeOf } from '../assets.js?v=9';
import { lawNorm as lawN } from '../laws.js?v=9';
import { SLOT } from '../cv-mods.js?v=9';
import * as DC from '../drum-core.js?v=9';
import * as MG from '../moog-core.js?v=9';
import * as PT from '../patch-core.js?v=9';
import { compileMods } from '../cv-graph.js?v=9'; // (IMPL-MM §6.3: the master's payload — the host's compile on a track-shaped record)
import { normModDev } from '../song.js?v=9';

export const SR = 48000;
const W2 = id => core.WARPS2.findIndex(w => w.id === id) / (core.WARPS2.length - 1);
const FT = name => core.FILTERS.findIndex(f => (f.name || f) === name) / (core.FILTERS.length - 1);
const row = (src, dst, amt, o) => Object.assign({ src, amt, dst, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 }, o || {});

/* ------------------------------------------------------------------ synthetic assets (deterministic) */
const tone = (n, hz, ph) => Float32Array.from({ length: n }, (_, j) => 0.4 * Math.sin(2 * Math.PI * hz * j / SR + ph) + 0.1 * Math.sin(2 * Math.PI * 3.01 * hz * j / SR));
const fRoot = n => 440 * Math.pow(2, (n - 69) / 12);
const rec = (L, R, root, loop) => ({ rate: SR, ch: R ? 2 : 1, len: L.length, L, R: R || null, root, loop: loop || null });
let ASSETS = null;
function assets() {
  if (ASSETS) return ASSETS;
  const A = {}, n = 2 * SR;
  const st = rec(tone(n, fRoot(57), 0), tone(n, fRoot(57), 1), 57);
  A['smp:bench'] = playbackEntry('smp:bench', st, null);
  A['spec:smp:bench'] = specEntry('spec:smp:bench', st, null);
  // a piano-like multisample: 8 key ranges × 2 velocity layers, sustain loops
  const zones = [];
  for (let k = 0; k < 8; k++) for (let v = 0; v < 2; v++) {
    const id = `smp:benchz${k}${v}`, root = 24 + 12 * k;
    A[id] = playbackEntry(id, rec(tone(SR, fRoot(root), v), null, root), null, 2);
    zones.push({ lo: k ? root - 6 : 0, hi: k < 7 ? root + 5 : 127, vlo: v ? 80 : 1, vhi: v ? 127 : 79, root, tune: 0, gain: 0, pan: 0, smp: id,
      mode: 'sustain', ls: 12000, le: 36000, off: 0, env: [0, 0.002, 0, 2, 0.3, 0.4], rr: [1, 1], vt: 1 });
  }
  A['msmp:bench'] = { id: 'msmp:bench', v: 1, kind: 'multi', bytes: 0, zones };
  ASSETS = A;
  return A;
}
// a 4 s stereo impulse response (noise × exponential decay, deterministic)
function irRecord() {
  const n = 4 * SR, r = W.mulberry32(W.fnv1a32('bench-ir')), L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { const e = Math.exp(-i / (0.6 * SR)); L[i] = (2 * r() - 1) * e; R[i] = (2 * r() - 1) * e; }
  return { rate: SR, ch: 2, len: n, L, R, hash: 'bench-ir' };
}

/* ------------------------------------------------------------------ voice scenarios */
function sx(edit, o) {
  const s = core.defaultSerum();
  Object.assign(s.p, { 'a.rand': 0, 'b.rand': 0, 'c.rand': 0 });
  s.global.os = 2;
  edit(s);
  const st = core.normalizeSerum(s);
  return Object.assign({ patch: patchFor('serum', { s: st }, core.defaultFx2(), { sr: SR, bpm: 120 }), state: st }, o);
}
const chord = (k, base = 48, step = 3) => Array.from({ length: k }, (_, i) => [base + step * i, 0.8]);
function gran(s, o, dens, glen) {
  const O = s.osc[o];
  O.type = 'gran'; O.smp = 'smp:bench'; O.smpo.win = 0; O.smpo.dens.max = 256; O.smpo.loop = 1;   // (2 s source: loop)
  const k = ['a', 'b', 'c'][o];
  s.p[k + '.dens'] = dens; s.p[k + '.glen'] = glen; s.p[k + '.on'] = 1;
}

function spec(s) {
  s.osc[0].type = 'spec'; s.osc[0].smp = 'smp:bench'; s.osc[0].smpo.loop = 1;   // (2 s source: loop)
  Object.assign(s.p, { 'a.w1': W2('s_smear'), 'a.warp': 0.5 });
}
// row d's oscillators and filters (the WT patch the 'switch' rows start from)
function rowD(s) {
  for (const k of ['a', 'b', 'c']) Object.assign(s.p, { [k + '.on']: 1, [k + '.uni']: 6 / 15, [k + '.det']: 0.3, [k + '.w1']: W2('bend_p'), [k + '.warp']: 0.5, [k + '.w2']: W2('d_tube'), [k + '.warp2']: 0.3 });
  Object.assign(s.p, { 'f.on': 1, 'f.type2': FT('MG Low 24'), 'f2.on': 1, 'f2.type': FT('Low 12') });
  s.filter[0].route = 0; // Filter 1 → Filter 2 (series)
  s.voicing.poly = 8;
  s.matrix[0] = row('lfo1', 'a.wt', 0.5); s.matrix[1] = row('lfo2', 'f.cutoff', 0.3); s.matrix[2] = row('lfo1', 'b.wt', 0.4); s.matrix[3] = row('lfo2', 'c.wt', 0.2);
}

/* ------------------------------------------------------------------ FX scenarios */
function fxRow(type, pid) { const r = (core.FXP_TAB[type]['2'] || core.FXP_TAB[type]['1']).find(x => x.pid === pid); return r; }
function setP(I, pid, v) { const r = fxRow(I.type, pid); I.p[pid] = lawN(r.law, r.lo, r.hi, v); }
function fxInst(fx, type, vals, where) {
  const id = core.newInstance(fx, type, Object.assign({ rack: 0 }, where || {}));
  const find = L => { for (const I of L) { if (I.id === id) return I; if (Array.isArray(I.br)) for (const b of I.br) { const x = find(b); if (x) return x; } } return null; };
  const I = find(fx.racks[0].mods);
  for (const [k, v] of Object.entries(vals || {})) setP(I, k, v);
  return I;
}
// row r (IMPL-1e §7): Prophet-5 'Poly Strings' + Juno-60 + default Serum into one shared panel (EQ → chorus → delay) → OUT
function trackR() {
  const cl = (id, preset) => {
    const m = MODELS.find(x => x.id === id), v = Object.fromEntries(m.controls.map(c => [c.id, c.def]));
    if (preset) Object.assign(v, m.presets.find(p => p.name === preset).v);
    const p = patchFor(m, v, core.defaultFx2(), { sr: SR, bpm: 120, drift: 0.5, hiss: 1 });
    delete p.fxr; delete p.fxrT; // (a classic Inst's patch on a graph node: its panel is a {t: 'chain'})
    return p;
  };
  const fx = core.defaultFx2();
  fxInst(fx, 'eq', {}); fxInst(fx, 'cho', { mix: 0.5 }); fxInst(fx, 'dly', { mix: 0.3 });
  const Z = { lo: 0, hi: 127, xp: 0 }, ins = ['i1', 'i2', 'i3'].map((id, k) => ({ id, on: true, zone: Z, salt: k ? ((k + 1) * 0x9E3779B9) >>> 0 : 0 }));
  return { graph: { t: 'graph', insts: ins, chains: [{ id: 'fx1' }], edges: [['i1', 'fx1', 1], ['i2', 'fx1', 1], ['i3', 'fx1', 1], ['fx1', 'out', 1]], out: 'out', key: 'r' },
    patches: { i1: cl('prophet5', 'Poly Strings'), i2: cl('juno60', null), i3: sx(() => {}).patch },
    chains: { fx1: { fxr: core.compileFx(fx, { bpm: 120, rate: SR }), fxrT: core.compileFxT(fx) } }, notes: chord(4, 48, 4) };
}
/* ------------------------------------------------------------------ ModCore rows (IMPL-2b §8 N4, lane A1) */
// mc0 / mc / mt: a Juno-60 (one held note: the cheapest sounding track) with a {t: 'mods'} payload — the row's load minus
// the same track without it (base) = ModCore's cost. The payload's synthetic CP is compiled here as the host does (§3.1:
// every oscillator off, OS 1, one voice, unused LFO slots parked FREE + MONO), its rows into scratch V-scope destinations
// of the Juno's slots (Inst.modSpan: lane A2's adapter — a stub until the merge, so these rows measure ModCore alone;
// row mk measures the Inst side). me: row d's Serum with an ext1 → f.cutoff row fed by one GLOBAL LFO vs the same Serum
// reading `fixed`: the ext hand-off (SerumDSP.extIn + the voices' 16-entry copies) + a one-LFO ModCore.
const hzN = hz => Math.pow(hz / 100, 0.25), timeN = sec => Math.pow(sec / 32, 0.2);
const SCRATCH = ['a.pan', 'a.level', 'b.level', 'a.wt', 'a.warp', 'b.wt', 'a.fine', 'a.crs', 'b.pan', 'b.warp', 'b.fine', 'b.crs', 'a.det', 'b.det', 'a.blend', 'b.blend'];
const SRCI = { lfo1: 5, lfo2: 6, lfo3: 7, lfo4: 8, lfo5: 9, lfo6: 10, lfo7: 11, lfo8: 12, lfo9: 35, lfo10: 36, env2: 3, env3: 4, env4: 34, velo: 13, note: 14, rand1: 20 };
function synthState(fn) {
  const s = core.defaultSerum();
  for (const id of ['a.on', 'b.on', 'c.on', 'n.on', 's.on', 'f.on', 'f2.on']) if (id in s.p) s.p[id] = 0;
  s.global.os = 1; s.voicing.poly = 1;
  for (let l = 0; l < 10; l++) s.lfo[l] = { ...s.lfo[l], mode: 'free', mono: 1 };
  fn(s);
  return core.normalizeSerum(s);
}
const globalLfo = (s, l, hz) => { s.lfo[l] = { ...s.lfo[l], mode: 'free', mono: 1, bpm: 0, anchor: 0 }; s.p[`l${l + 1}.rate`] = hzN(hz); };
function modsOf(fn, rowsFn) {
  const st = synthState(fn), P = core.compileSerum(st, { bpm: 120 }), cp = P.serum, ct = core.assembleCT(P.serumT);
  const r = rowsFn(st);
  return { t: 'mods', bpm: 120, cp, ct, rows: r.rows, ext: r.ext, vals: [], keep: r.keep || [] };   // (rows' vi: resolved at prepare through the scope's SxBase)
}
// the 10 GLOBAL LFOs of spike variant A (7 FREE of every kind + 3 MONO RETRIG), 3 ENVs
function tenLfos(s) {
  for (let l = 0; l < 3; l++) globalLfo(s, l, 0.5 + l);
  s.lfo[3] = { ...s.lfo[3], mode: 'free', mono: 1, bpm: 1, anchor: 1 }; s.p['l4.rate'] = 0.45;
  s.lfo[4] = { ...s.lfo[4], mode: 'free', mono: 1, bpm: 0, anchor: 0, type: 'sh' }; s.p['l5.rate'] = hzN(6);
  s.lfo[5] = { ...s.lfo[5], mode: 'free', mono: 1, bpm: 0, anchor: 0, type: 'path' }; s.p['l6.rate'] = hzN(0.8);
  s.lfo[6] = { ...s.lfo[6], mode: 'free', mono: 1, bpm: 0, anchor: 0, dir: 'pingpong' }; s.p['l7.rate'] = hzN(2.5); s.p['l7.smooth'] = 0.2;
  for (let l = 7; l < 10; l++) { s.lfo[l] = { ...s.lfo[l], mode: 'retrig', mono: 1, bpm: 0, anchor: 0 }; s.p[`l${l + 1}.rate`] = hzN(1 + l); }
}
const envs = s => Object.assign(s.p, { 'e2.att': timeN(0.1), 'e2.dec': timeN(0.3), 'e2.sus': 0.5, 'e2.rel': timeN(0.4), 'e3.att': timeN(0.5), 'e3.rel': timeN(0.2),
  'e4.att': 0, 'e4.dec': timeN(0.2), 'e4.sus': 0, 'e4.rel': timeN(0.1) });
function junoTrack(mods) {
  const m = MODELS.find(x => x.id === 'juno60'), v = Object.fromEntries(m.controls.map(c => [c.id, c.def]));
  const p = patchFor(m, v, core.defaultFx2(), { sr: SR, bpm: 120 });
  delete p.fxr; delete p.fxrT;
  const fx = core.defaultFx2(), Z = { lo: 0, hi: 127, xp: 0 };
  return { graph: { t: 'graph', insts: [{ id: 'i1', on: true, zone: Z, salt: 0 }], chains: [{ id: 'fx1' }], edges: [['i1', 'fx1', 1], ['fx1', 'out', 1]], out: 'out', key: 'mc' },
    patches: { i1: p }, chains: { fx1: { fxr: core.compileFx(fx, { bpm: 120, rate: SR }), fxrT: core.compileFxT(fx) } }, notes: [[48, 0.8]], mods };
}
// rows: every source into its own scratch destination of the synthetic CP (the keep-alive for the ext ones), cls rows on
// the Juno's first slots (vi resolved at prepare through the scope's SxBase)
function rowsTo(st, srcs, kinds) {
  srcs.forEach((src, j) => { st.matrix[j] = row(src, SCRATCH[j], 0.5, j % 4 === 1 ? { curve: 0.4 } : j % 4 === 2 ? { rise: 0.2, fall: 0.2 } : j % 4 === 3 ? { bi: 1 } : {}); });
  return srcs.map((src, j) => ({ id: 'r' + j, src: SRCI[src], dstId: SCRATCH[j], dst: kinds === 'ext' ? null : { kind: 'cls', inst: 'i1', slot: j % 24 }, xfer: { a: 0, b: 1, x0: 0.5 } }));
}
function mcRows(variant) {
  if (variant === 'mc0') return modsOf(tenLfos, st => { const r = rowsTo(st, ['lfo1', 'lfo2', 'lfo3', 'lfo4', 'lfo5', 'lfo6', 'lfo7', 'lfo8', 'lfo9', 'lfo10'], 'ext');
    return { rows: [], ext: r.map((x, k) => ({ k: k + 1, src: x.src })), keep: r.map(x => x.src) }; });
  if (variant === 'mc') return modsOf(s => { tenLfos(s); envs(s); }, st => ({ rows: rowsTo(st, ['lfo1', 'lfo2', 'lfo3', 'lfo4', 'lfo5', 'lfo6', 'lfo7', 'lfo8', 'lfo9', 'lfo10', 'env2', 'env3', 'env4', 'velo', 'note', 'rand1']), ext: [] }));
  return modsOf(s => {                                                                      // mt: the typical track
    globalLfo(s, 0, 1.5);
    s.lfo[1] = { ...s.lfo[1], mode: 'free', mono: 1, bpm: 1, anchor: 1 }; s.p['l2.rate'] = 0.45;
    s.lfo[2] = { ...s.lfo[2], mode: 'retrig', mono: 0, bpm: 0, anchor: 0 }; s.p['l3.rate'] = hzN(4);
    Object.assign(s.p, { 'e2.att': timeN(0.1), 'e2.dec': timeN(0.3), 'e2.sus': 0.5, 'e2.rel': timeN(0.4) });
  }, st => ({ rows: rowsTo(st, ['lfo1', 'lfo2', 'lfo3', 'env2']), ext: [] }));
}
// me: row d's Serum (8 voices) with `ext1 → f.cutoff` (the CP compiled with ctx.ext, as the injected copy is) + a one-LFO
// ModCore feeding ext1; base: the same Serum with the row reading `fixed` (the row itself costs the same)
function extTrack(ext) {
  const s = core.defaultSerum();
  Object.assign(s.p, { 'a.rand': 0, 'b.rand': 0, 'c.rand': 0 });
  s.global.os = 2;
  rowD(s);
  s.matrix[4] = row(ext ? 'ext1' : 'fixed', 'f.cutoff', 0.3);
  const st = core.normalizeSerum(s), fx = core.defaultFx2();
  const patch = patchFor('serum', { s: st }, fx, { sr: SR, bpm: 120 });
  if (ext) Object.assign(patch, core.compileSerum(st, { bpm: 120, smooth: 1, fx, qr: null, ultra: 0, mpeBendX: 0, mpeYBi: 0, ext: true }));
  const Z = { lo: 0, hi: 127, xp: 0 };
  const mods = ext ? modsOf(s2 => { globalLfo(s2, 0, 2); }, st2 => { st2.matrix[0] = row('lfo1', 'a.level', 0.01); return { rows: [], ext: [{ k: 1, src: 5 }], keep: [5] }; }) : null;
  return { graph: { t: 'graph', insts: [{ id: 'i1', on: true, zone: Z, salt: 0 }], chains: [], edges: [['i1', 'out', 1]], out: 'out', key: 'me' },
    patches: { i1: patch }, chains: {}, notes: chord(8), mods };
}

function fxScn(make) {
  const fx = core.defaultFx2(), extra = make(fx) || {};
  const fxp = core.compileFx(fx, { bpm: 120, rate: SR }), fxt = core.compileFxT(fx);
  return Object.assign({ fx, fxp, fxt }, extra);
}
// IMPL-SC G7: the rack's sidechain context per quantum q as the Track writes it (IMPL-SC §1.2) — a registry with one ring for `src`
// holding a hit at sample 5 of every `every`-th quantum (0: no hits), stamped for the quantum; `key`: a noise key buffer (kL / kR)
function scCtx(src, every, key) {
  const ring = { q: -1, n: 0, f: new Float64Array(64), note: new Uint8Array(64), vel: new Float32Array(64) }, reg = new Map([[src, ring]]);
  const r = W.mulberry32(W.fnv1a32('bench-key')), kn = Float64Array.from({ length: 4096 }, () => 0.9 * (2 * r() - 1));
  const kL = new Float64Array(128), kR = new Float64Array(128);
  return (rack, q) => {
    const s = rack.sc, F0 = 128 * q;
    if (!s) return;
    s.q = F0; s.F = F0; s.reg = reg; ring.q = F0;
    if (every > 0 && q % every === 0) { ring.n = 1; ring.f[0] = F0 + 5; ring.note[0] = 36; ring.vel[0] = 1; } else ring.n = 0;
    if (key) { const o = (q * 128) & 4095; for (let i = 0; i < 128; i++) { kL[i] = kn[(o + i) & 4095]; kR[i] = kn[(o + 1024 + i) & 4095]; } s.kL = kL; s.kR = kR; }
  };
}
// rows mk / ms (IMPL-2b §8, lane A2: the classic adapter): an 8-voice Juno-60 (its default patch at poly 8) with the cable
// installed by `prep` on the live processor — the Track's call site of Inst.modSpan is stubbed on the Inst (ModCore is
// lane A1's) — minus the same row without (`base`). mk: one cutoff cable, a ±2-octave LFO at 2 Hz (smMv on every span:
// per-chunk interpolation and setRes in every voice; the gate is ≤ 8 % of the row without, tests/classic-mod.test.mjs);
// ms: four envelope-time fields cabled, their values changing every span (Env.set on every voice per field per span: the
// setters' own cost; ≤ 1 µs per call per voice = a load of 0.012 at 375 spans × 4 fields × 8 voices per second)
function juno8(prep) {
  const m = MODELS.find(x => x.id === 'juno60'), v = Object.fromEntries(m.controls.map(c => [c.id, c.def]));
  const p = patchFor(m, v, core.defaultFx2(), { sr: SR, bpm: 120, drift: 0.5, hiss: 1 });
  p.poly = 8;
  return { patch: p, notes: chord(8), prep };
}
function mkPrep(p) {
  const I = p.i0, c0 = new Float64Array(SLOT.N), c1 = new Float64Array(SLOT.N), rs = I.renderSpan, lfo = F => 2 * Math.sin(2 * Math.PI * 2 * F / SR);
  I.modRows([{ slot: SLOT.VO }]);
  I.renderSpan = function (n) { const F = p.spanF; c0[SLOT.VO] = lfo(F); c1[SLOT.VO] = lfo(F + n); this.modSpan(c0, c1, null); return rs.call(this, n); };
}
function msPrep(p) {
  const I = p.i0, F = ['fenv.a', 'fenv.r', 'aenv.a', 'aenv.r'], sv = F.map(field => ({ field, v: 0.1 })), rs = I.renderSpan;
  let j = 0;
  I.modRows(F.map(field => ({ field, lo: 0.001, hi: 10 })));
  I.renderSpan = function (n) { const v = 0.1 + 0.05 * ((j++) & 1); for (const e of sv) e.v = v; this.modSpan(null, null, sv); return rs.call(this, n); };
}

/* ------------------------------------------------------------------ drum machine rows (IMPL-7a §2.6, lane E) */
// The TR-808 as a track (kind 'track', OS 4): its panel into an empty panel → OUT, its own pattern (basic key 1 A in
// MANUAL PLAY, SYNC on: a new machine's default) clocked by the transport playing at 120 BPM from tick 0 at frame 0 (the
// pattern loops, so every timed run has hits), no notes. d8p a typical pattern, d8x every lane every 250 ms accented with
// every DECAY at 10, d8m the metal voices (the bank and three VCAs), d8s d8p with all 16 sounds as user samples (one 1 s
// fixture, 2 playback levels). Rows as 16-character strings per lane, 'x' = a hit; each pattern's two halves alike (d8p:
// but for its two toms, one a half), so every 1 s run (half a bar at 120 BPM) times the same load.
// IMPL-7b §2.6, the TR-606 the same way (pattern I-1 in PATTERN PLAY, SYNC on: a new machine's default): d6p a typical
// pattern — BD on the quarters, SD on 2 / 4, CH sixteenths with OH on the off-beats, LT / HT (one a half), CY once a bar
// (accented on step 1, it never sleeps inside the bar: both halves keep its circuit awake), accents every fourth step; d6x
// every lane every 250 ms accented, every DECAY at 10; d6m CY + OH every 500 ms (the bank, three VCAs, the tempo cut).
// IMPL-7c §2.7, the TR-909 (pattern I-1-1 in PATTERN PLAY, SYNC on): d9p, d9x, d9m below.
// IMPL-8 §12.7, the SDS-V (no sequencer: roll notes, a one-bar song looping at 120 BPM from tick 0): dvp, dvx below; dvm
// is dvp's groove on memories 3 / 4 (the payload's trims) with every memory key switched each bar (the row's cycle).
export const DRUM_PATTERNS = Object.freeze({
  d8p: { ac: 'x...x...x...x...', bd: 'x...x...x...x...', sd: '....x.......x...', cp: '....x.......x...', ch: 'x...x...x...x...', oh: '..x...x...x...x.',
    mt: '......x.........', lt: '..............x.', cb: '...x.......x....' },
  d8x: Object.fromEntries(DC.LANES.map(l => [l, 'x.x.x.x.x.x.x.x.'])),
  d8m: { cy: 'x...x...x...x...', oh: 'x...x...x...x...', cb: 'x...x...x...x...' },
  d6p: { ac: 'x...x...x...x...', bd: 'x...x...x...x...', sd: '....x.......x...', ch: 'xx.xxx.xxx.xxx.x', oh: '..x...x...x...x.',
    lt: '.....x..........', ht: '.............x..', cy: 'x...............' },
  d6x: Object.fromEntries(['ac', 'bd', 'sd', 'lt', 'ht', 'cy', 'oh', 'ch'].map(l => [l, 'x.x.x.x.x.x.x.x.'])),
  d6m: { cy: 'x...x...x...x...', oh: 'x...x...x...x...' },
  // IMPL-7c §2.7, the TR-909 (pattern I-1-1 in PATTERN PLAY, SYNC on, SHUFFLE 3, FLAM 11 = 18 ms; rows by its codes, 'X' a
  // per-voice accent, 'f' a flam, 'F' both): d9p a house pattern — BD on the quarters, CH sixteenths with OH on the off-beat
  // eighths, HC + SD on 2 / 4 (the SD flammed), the ride in eighths, a crash once a bar, LT / MT / HT once a half, both
  // accents; d9x every lane every 250 ms, both accents, flams on all five (every DECAY / TONE at 10, the cymbals' TUNE at 0:
  // the vals); d9m the ROM voices — crash + ride + OH every 500 ms
  d9p: { ac: 'x.......x.......', bd: 'X...x...X...x...', sd: '....f.......F...', hc: '....x.......x...', ch: 'xX.xxX.xxX.xxX.x',
    oh: '..x...x...x...x.', rd: 'x.x.x.x.x.x.x.x.', cr: 'x...............', lt: '.x.......x......', mt: '...x.......x....', ht: '.....x.......x..' },
  d9x: Object.fromEntries(DC.CODES909.map(c => c.toLowerCase()).map(l => [l, (DC.FL909 >> DC.LANES909[DC.CODES909.indexOf(l.toUpperCase())]) & 1
    ? 'F.F.F.F.F.F.F.F.' : 'X.X.X.X.X.X.X.X.'])),
  d9m: { cr: 'x...x...x...x...', rd: 'x...x...x...x...', oh: 'x...x...x...x...' },
  // (IMPL-8 §12.7) the SDS-V's notes by its sounds (bd bass, sd snare, lt / mt / ht toms 3 / 2 / 1), a character its velocity
  // (VEL_V): dvp a typical groove — the bass on the quarters (v 100), the snare on 2 / 4 (v 110), a tom fill 3 → 1 in
  // sixteenths on the last beat (v 70, 90, 110, 127); dvx all five every sixteenth (125 ms) at v 127 (the vals: every DECAY
  // and SENSITIVITY at 10)
  dvp: { bd: 'x...x...x...x...', sd: '....s.......s...', lt: '............a...', mt: '.............b..', ht: '..............sX' },
  dvx: Object.fromEntries(['bd', 'sd', 'lt', 'mt', 'ht'].map(l => [l, 'XXXXXXXXXXXXXXXX'])),
});
const VEL_V = { a: 70, b: 90, x: 100, s: 110, X: 127 };
// (IMPL-8 §12.7) dvx's panel; dvm's two memory settings (every channel on 3 or 4, the other each bar)
const DVX_VALS = Object.fromEntries(['b', 's', '1', '2', '3'].flatMap(c => [['x' + c + 'd', 10], ['x' + c + 's', 10]]));
export const DVM_MEM = Object.freeze([[2, 3, 2, 3, 2], [3, 2, 3, 2, 3]].map(m => Object.freeze(Object.fromEntries(['b', 's', '1', '2', '3'].map((c, i) => ['x' + c + 'p', m[i]])))));
const drumSteps = o => { const st = new Array(32).fill(0); for (const [lane, r] of Object.entries(o)) { const l = DC.LANES.indexOf(lane); for (let k = 0; k < r.length; k++) if (r[k] === 'x') st[k] |= 1 << l; } return st; };
// (7c) a 909 pattern's three rows of 16 masks: the voices, their per-voice accents (& 0x83E), their flams (& 0x03E)
export const drumSteps9 = o => {
  const st = new Array(16).fill(0), ac = new Array(16).fill(0), fm = new Array(16).fill(0);
  for (const [code, r] of Object.entries(o)) {
    const b = 1 << DC.LANES909[DC.CODES909.indexOf(code.toUpperCase())];
    for (let k = 0; k < 16; k++) {
      const c = r[k];
      if (c === '.' || c === undefined) continue;
      st[k] |= b;
      if (c === 'X' || c === 'F') ac[k] |= b & DC.AC909;
      if (c === 'f' || c === 'F') fm[k] |= b & DC.FL909;
    }
  }
  return { st, ac, fm };
};
let DRUM_SMP = null;
// the bench's own 1 s drum sample (a decaying tone and noise burst, deterministic), its id a content-hash-shaped one
function drumSample() {
  if (DRUM_SMP) return DRUM_SMP;
  const n = SR, r = W.mulberry32(W.fnv1a32('bench-drum')), L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.7 * Math.exp(-i / (0.12 * SR)) * Math.sin(2 * Math.PI * 70 * i / SR) + 0.3 * Math.exp(-i / (0.03 * SR)) * (2 * r() - 1);
  const id = 'smp:0123456789abcdef';
  DRUM_SMP = { id, entry: playbackEntry(id, rec(L, null, 60), null, 2) };
  return DRUM_SMP;
}
// (IMPL-8 §12.7) the SDS-V's rows as roll notes: a one-bar song [tick, length, note, v] (each sound's primary; a sixteenth
// 240 ticks, the notes 120 long)
export const songV = rows => {
  const P = DC.primaries(DC.PERS.sdsv.map, 'sdsv'), S = DC.PERS.sdsv.sounds, notes = [];
  for (let k = 0; k < 16; k++) for (const [l, r] of Object.entries(rows)) if (r[k] in VEL_V) notes.push(240 * k, 120, P[S.indexOf(l)], VEL_V[r[k]]);
  return { t: 'song', notes, cc: [] };
};
/** A drum machine track (kind 'track'): pattern rows (DRUM_PATTERNS' form, or step masks), panel values over the
 *  defaults, samples on; model 'tr808' (key 1 A in MANUAL PLAY), 'tr606' (7b: pattern I-1 in PATTERN PLAY, 16 steps),
 *  'tr909' (7c: pattern I-1-1 in PATTERN PLAY, 16 steps, SHUFFLE 3, FLAM 11) or 'sdsv' (IMPL-8: no pattern — its rows a
 *  one-bar song of roll notes, looped; its payload the record's: the empty plan, the default trims; o.cycle panel values
 *  over vals, one each bar in turn: {t: patch} messages the bench posts between quanta); rows 'demo' = the 606's / 909's
 *  DEMO, as the DEMO button leaves it (606: I-1 → I-2 chained; 909: I-1-1 / I-1-2 block-played). */
export function drumTrack(rows, vals, samples, model = 'tr808', o = {}) {
  const m8 = model === 'tr808', six = model === 'tr606', sv = model === 'sdsv', m = MODELS.find(x => x.id === model);
  const v = Object.assign(Object.fromEntries(m.controls.map(c => [c.id, c.def])), vals || {});
  const pOf = w => { const q = patchFor(m, w, core.defaultFx2(), { sr: SR, bpm: 120 }); delete q.fxr; delete q.fxrT; return q; };
  const p = pOf(v); // (a classic Inst's patch on a graph node: its panel is a {t: 'chain'})
  let d = DC.normDrum(undefined, m8 ? undefined : model);
  const fx = core.defaultFx2(), Z = { lo: 0, hi: 127, xp: 0 }, S = samples ? drumSample() : null;
  if (m8) { d.st[0] = Array.isArray(rows) ? rows.slice() : drumSteps(rows); d.ui.mode = DC.M_MAN; }
  else if (rows === 'demo') d = DC.press(DC.initState(model), d, { k: 'demo' }).mem;
  else if (six) d.st[0] = (Array.isArray(rows) ? rows : drumSteps(rows)).slice(0, DC.N_STEP6);
  else if (sv) { /* (no pattern: the song below) */ }
  else {
    const r = drumSteps9(rows), keys = d.keys.slice();
    keys[0] = Object.assign({}, keys[0], { sh: 3, fl: 11 });
    d = Object.assign({}, d, { keys, st: [r.st].concat(d.st.slice(1)), ac: [r.ac].concat(d.ac.slice(1)), fm: [r.fm].concat(d.fm.slice(1)) });
  }
  if (S) d.smp = Object.fromEntries((m8 ? DC.SOUNDS : DC.PERS[model].sids.map(k => DC.PERS[model].sounds[k])).map(k => [k, { id: S.id, name: 'bench', on: true }]));
  return { graph: { t: 'graph', insts: [{ id: 'i1', on: true, zone: Z, salt: 0 }], chains: [{ id: 'fx1' }], edges: [['i1', 'fx1', 1], ['fx1', 'out', 1]], out: 'out', key: m8 ? 'd8' : six ? 'd6' : sv ? 'dv' : 'd9' },
    patches: { i1: p }, chains: { fx1: { fxr: core.compileFx(fx, { bpm: 120, rate: SR }), fxrT: core.compileFxT(fx) } }, notes: [],
    seqs: { i1: DC.payload(d, DC.initState(m8 ? undefined : model), 'now') },
    transport: Object.assign({ play: true, frame: 0, tick: 0, fpt: SR * 60 / (120 * 960), seek: true }, sv ? { loop: true, ls: 0, le: 3840 } : null),
    song: sv ? songV(rows) : null,
    cycle: sv && o.cycle ? { frames: 4 * SR / 2, msgs: o.cycle.map(w => ({ t: 'patch', i: 'i1', p: pOf(Object.assign({}, v, w)) })) } : null,
    assets: S ? { [S.id]: S.entry } : null };
}

/* ------------------------------------------------------------------ 900 Series rows (IMPL-9 §3.8, §12 spike (a); lane E9) */
// A patch as a track (kind 'track', OS 4): the 900 Series' controller and modules (one Inst, its patch record → the graph
// payload {t: 'seq', s: {pg, pk}}, its knobs → the patch's pv) into an empty panel → OUT. m9p: Classic bass (the Model 15 tile's)
// playing an eighth-note bass line as roll notes (a one-bar song looping at 120 BPM); m9x: every Model 15 module live — Classic
// bass re-patched: audio-rate FM (the 921's sine on the 904A's third control input) at REGENERATION 10 (k 4.4), a 904A → 921B →
// 904A loop (the filter through multiple B into the second 921B's DC MODULATE: the mixer closes it), 921B #2 synced STRONG to
// #1's rectangle, the 921 clamped at audio rate (#1's triangle − sine through the second 902 at ×2 on CLAMP TRIG. V), 923 white
// → 907A → mixer 4, a three-note chord held on the controller (LOW: its lowest sounds); m9d: Drone (no notes: the never-quiet
// cost, §3.6). Every timed run audible.
export const BASS = Object.freeze([36, 36, 48, 36, 39, 36, 43, 41]);   // (eighths: 480 ticks, 360 long)
const bassSong = () => ({ t: 'song', notes: BASS.flatMap((n, k) => [480 * k, 360, n, k & 1 ? 90 : 110]), cc: [] });
/** The m9x patch: Classic bass on the Model 15 set, re-patched so every module runs (above) → { rec, vals }. */
export function m9xPatch() {
  const m = MG.model15();
  let rec = m.rec;
  const vals = structuredClone(m.vals), id = t => Object.keys(rec.mods).filter(k => rec.mods[k].t === t);
  const [o3] = id('921'), [o1, o2] = id('921b'), [nz] = id('923'), [f] = id('904a'), [fb] = id('907a'), [, a2] = id('902');
  const pull = (a, b) => { const c = rec.cords.find(x => x.a === a && x.b === b); if (!c) throw new Error('m9x: no cord ' + a + ' → ' + b); rec = PT.pull(rec, c.id).rec; };
  const plug = (a, b) => { const r = PT.plug(rec, a, b); if (!r.id) throw new Error('m9x: ' + a + ' → ' + b + ': ' + r.why); rec = r.rec; };
  const amp = rec.cords.find(x => x.a === f + '.out').b;            // (the first 902's upper input)
  pull(f + '.out', amp);
  plug(f + '.out', 'c.b1'); plug('c.b2', amp); plug('c.b3', o2 + '.dc');       // 904A → multiple B → the VCA and 921B #2 (the loop)
  plug(o3 + '.sin', f + '.c3');                                                // audio-rate FM into the 904A
  plug(o1 + '.rec', o2 + '.sy');                                               // sync
  plug(o1 + '.tri', a2 + '.i1'); plug(o1 + '.sin', a2 + '.i2'); plug(a2 + '.o2', o3 + '.cv'); // the clamp at audio rate
  plug(nz + '.wh1', fb + '.in'); plug(fb + '.out', 'c.m4');                    // 923 → 907A → mixer 4
  Object.assign(vals.p[f], { re: 10, fc: 1 });
  Object.assign(vals.p[o2], { ss: 2 });
  vals.p[a2] = Object.assign({}, vals.p[a2] || {}, { _t: '902', md: 0, fc: 6 });
  vals.x4 = 5;
  return { rec, vals };
}
// IMPL-9b §3.7 (spike (a2) decision 3): m9q — Sequence on the System 55 set (the tile's: MG.makeSet('s55')), its Song clock on
// ALWAYS at the project's 120 BPM (the same work as the song's steps, no transport in the harness; 15 modules live of 37); m9s —
// the System 55 set re-patched as a classic voice: the six 921Bs (two drivers) and the 921 through two CP3As into the 914 (both
// inputs), the 904B, the 904A at REGENERATION 6 and two 902s; five 911s — two by cords (the keys' S-TRIG 2 / 1 → 911 4 / 5 on
// the 904A and the 904B), three by the 993's bus rows (FROM 1 + TRIGGERS 1…3, ENVELOPES 1…3: 911 1 at once, 911 2 / 3 through the
// 911A in PARALLEL, each into its 902's third control input; 911 3 also into the 904A by a cord) — the bass line as roll notes
const ofType = (rec, t) => Object.keys(rec.mods).filter(k => rec.mods[k].t === t).sort((a, b) => a.slice(1) - b.slice(1));
/** The m9q patch: Sequence as the System 55 tile leaves it, the Song clock on ALWAYS → { rec, vals }. */
export function m9qPatch() {
  const m = MG.makeSet('s55', {}), [ck] = ofType(m.rec, 'clk');
  return { rec: m.rec, vals: PT.setKnob(m.vals, m.rec, ck, 'md', 1) };
}
/** The m9s patch: the System 55 set patched as the classic voice above, the 993's seven switches on → { rec, vals }. */
export function m9sPatch() {
  const m = MG.makeSet('s55', {}), z = PT.initPatch(m.rec, m.vals);
  let rec = z.rec, vals = z.vals;
  const T = t => ofType(rec, t), [osc] = T('921'), [da1, da2] = T('921a'), ob = T('921b'), [fb] = T('914'), [hp] = T('904b'), [lp] = T('904a');
  const en = T('911'), [dl] = T('911a'), am = T('902'), [mx1, mx2] = T('cp3a'), [tg] = T('993');
  const plug = (a, b) => { const r = PT.plug(rec, a, b); if (!r.id) throw new Error('m9s: ' + a + ' → ' + b + ': ' + r.why); rec = r.rec; };
  for (const [a, b] of [['c.kp1', 'c.a1'], ['c.a2', da1 + '.f1'], ['c.a3', da2 + '.f1'], ['c.a4', osc + '.f1'],
    [ob[0] + '.saw', mx1 + '.m1'], [ob[1] + '.rec', mx1 + '.m2'], [ob[2] + '.saw', mx1 + '.m3'], [osc + '.saw', mx1 + '.m4'],
    [ob[3] + '.saw', mx2 + '.m1'], [ob[4] + '.tri', mx2 + '.m2'], [ob[5] + '.rec', mx2 + '.m3'],
    [mx1 + '.mo', fb + '.i1'], [mx2 + '.mo', fb + '.i2'], [fb + '.o1', hp + '.in'], [hp + '.out', lp + '.in'], [lp + '.out', am[0] + '.i1'],
    [am[0] + '.o2', am[1] + '.i1'], [am[1] + '.o2', 'c.out'],
    ['c.ks2', en[3] + '.trg'], ['c.ks1', en[4] + '.trg'], [en[3] + '.out', lp + '.c1'], [en[4] + '.out', hp + '.c1'], [en[2] + '.out', lp + '.c2']]) plug(a, b);
  const set = (mid, o) => { for (const [k, v] of Object.entries(o)) vals = PT.setKnob(vals, rec, mid, k, v); };
  set(hp, { fc: -2, rg: 0 }); set(lp, { fc: 1, rg: 1, re: 6 });
  set(fb, { lo: 6, b1: 3, b2: 3, b3: 4, b4: 4, b5: 10, b6: 5, b7: 10, b8: 5, b9: 5, b10: 10, b11: 4, b12: 3, hi: 5 });
  [[0.5, 4, 3, 7], [1, 5, 4, 6], [2, 4, 3, 5], [1, 4, 3, 7], [3, 5, 4, 6]].forEach(([t1, t2, t3, es], k) => set(en[k], { t1, t2, t3, es }));
  set(dl, { d1: 2, d2: 3.5, md: 1 }); set(am[0], { md: 0, fc: 0 }); set(am[1], { md: 0, fc: 0 });
  set(mx1, { x1: 6, x2: 5, x3: 6, x4: 5 }); set(mx2, { x1: 6, x2: 5, x3: 5 });
  set(tg, { f1: 1, t1: 1, t2: 1, t3: 1, e1: 1, e2: 1, e3: 1 });
  return { rec, vals };
}
// IMPL-9c §3 G3: m9c — the System IIIc set (MG.makeSet('s3c')) re-patched as a classic voice, ≈ 30 modules live: the keys through
// multiple A to the three 901As (each driving three 901Bs at a vernier spread) and PITCH 2 on the 901; the ten oscillators through
// three CP3s' mixers (the 901 with the first three) into the 984 (the 903A's pink on its fourth input), its three buses through the
// 904C (BAND PASS), the 904A and the 904B, each into a 902 on its own 911 (S-TRIG 1 / 2 and the GATE's converter), the 902s mixed
// by the fourth CP3 into the 905 → MAIN OUT; the bass line as roll notes
/** The m9c patch: the System IIIc set patched as the classic voice above → { rec, vals }. */
export function m9cPatch() {
  const m = MG.makeSet('s3c', {}), z = PT.initPatch(m.rec, m.vals);
  let rec = z.rec, vals = z.vals;
  const T = t => ofType(rec, t), [osc] = T('901'), da = T('901a'), ob = T('901b'), [nz] = T('903a'), [mx] = T('984'), [bp] = T('904c'), [lp] = T('904a'), [hp] = T('904b');
  const en = T('911'), am = T('902'), cp = T('cp3'), [rv] = T('905');
  const plug = (a, b) => { const r = PT.plug(rec, a, b); if (!r.id) throw new Error('m9c: ' + a + ' → ' + b + ': ' + r.why); rec = r.rec; };
  for (const [a, b] of [['c.kp1', 'c.a1'], ['c.a2', da[0] + '.f1'], ['c.a3', da[1] + '.f1'], ['c.a4', da[2] + '.f1'], ['c.kp2', osc + '.f1'],
    [ob[0] + '.saw', cp[0] + '.m1'], [ob[1] + '.saw', cp[0] + '.m2'], [ob[2] + '.pls', cp[0] + '.m3'], [osc + '.saw', cp[0] + '.m4'],
    [ob[3] + '.saw', cp[1] + '.m1'], [ob[4] + '.tri', cp[1] + '.m2'], [ob[5] + '.pls', cp[1] + '.m3'],
    [ob[6] + '.saw', cp[2] + '.m1'], [ob[7] + '.sin', cp[2] + '.m2'], [ob[8] + '.saw', cp[2] + '.m3'],
    [cp[0] + '.mo', mx + '.i1'], [cp[1] + '.mo', mx + '.i2'], [cp[2] + '.mo', mx + '.i3'], [nz + '.pk1', mx + '.i4'],
    [mx + '.o1', bp + '.in'], [mx + '.o2', lp + '.in'], [mx + '.o3', hp + '.in'],
    [bp + '.out', am[0] + '.i1'], [lp + '.out', am[1] + '.i1'], [hp + '.out', am[2] + '.i1'],
    ['c.ks1', en[0] + '.trg'], ['c.ks2', en[1] + '.trg'], ['c.kg', 'c.vi'], ['c.vo', en[2] + '.trg'],
    [en[0] + '.out', am[0] + '.c1'], [en[1] + '.out', am[1] + '.c1'], [en[2] + '.out', am[2] + '.c1'],
    [am[0] + '.o2', cp[3] + '.m1'], [am[1] + '.o2', cp[3] + '.m2'], [am[2] + '.o2', cp[3] + '.m3'], [cp[3] + '.mo', rv + '.in'], [rv + '.out', 'c.out']]) plug(a, b);
  const set = (mid, o) => { for (const [k, v] of Object.entries(o)) vals = PT.setKnob(vals, rec, mid, k, v); };
  [0.05, -0.05, 0.1, -0.1, 0.2, -0.2].forEach((vn, k) => set(ob[[1, 2, 4, 5, 7, 8][k]], { vn }));
  set(ob[3], { rg: 2 }); set(ob[6], { rg: 4 }); set(osc, { rg: 2 });
  set(mx, { l12: 0, l22: 6, l32: 0, l33: 8, l13: 4, l41: 2, bs: 6, tb: 4 });
  set(bp, { md: 2, fc: 1, bw: 1.5 }); set(lp, { fc: 0, re: 4 }); set(hp, { fc: -1 });
  [[0.5, 4, 3, 7], [1, 5, 4, 6], [2, 4, 3, 5]].forEach(([t1, t2, t3, es], k) => set(en[k], { t1, t2, t3, es }));
  for (const c of cp.slice(0, 3)) set(c, { x1: 5, x2: 5, x3: 5, x4: 5 });
  set(cp[3], { x1: 6, x2: 6, x3: 6 }); set(rv, { mx: 4 });
  return { rec, vals };
}
/** A 900 Series track (kind 'track'): { rec, vals } (a patch record and the device's vals: the routing panels' bus rows in the
 *  payload); o.notes held from the start, o.song: the bass line as roll notes (one bar looping from tick 0) with the transport playing. */
export function patchTrack({ rec, vals }, o = {}) {
  const p = patchFor('m900', vals, core.defaultFx2(), { sr: SR, bpm: 120 }), fx = core.defaultFx2(), Z = { lo: 0, hi: 127, xp: 0 };
  delete p.fxr; delete p.fxrT; // (a classic Inst's patch on a graph node: its panel is a {t: 'chain'})
  return { graph: { t: 'graph', insts: [{ id: 'i1', on: true, zone: Z, salt: 0 }], chains: [{ id: 'fx1' }], edges: [['i1', 'fx1', 1], ['fx1', 'out', 1]], out: 'out', key: 'm9' },
    patches: { i1: p }, chains: { fx1: { fxr: core.compileFx(fx, { bpm: 120, rate: SR }), fxrT: core.compileFxT(fx) } }, notes: o.notes || [],
    seqs: { i1: PT.payload(rec, MG.FAMILY.id, vals) }, song: o.song ? bassSong() : null,
    transport: o.song ? { play: true, frame: 0, tick: 0, fpt: SR * 60 / (120 * 960), seek: true, loop: true, ls: 0, le: 3840 } : null };
}
/** A starting patch (moog-core PRESETS) on the Model 15 set → { rec, vals }. */
export const presetSet = name => { const r = PT.loadPreset(PT.fresh(MG.FAMILY.id), {}, name, { ensure: MG.M15 }); if (r.why) throw new Error('preset ' + name + ': ' + r.why); return { rec: r.rec, vals: r.vals }; };

/* ------------------------------------------------------------------ IMPL-M §6 G4: the master processor ('synth-master') */
/** The master rows' input: the bench noise (as the FX rows) as one reused stereo Float32 quantum (what the context feeds). */
export function masterInput() {
  const r = W.mulberry32(W.fnv1a32('bench-master')), noise = Float32Array.from({ length: 4096 }, () => 0.25 * (2 * r() - 1));
  const L = new Float32Array(128), R = new Float32Array(128), io = [[L, R]];
  let pos = 0;
  return () => { for (let i = 0; i < 128; i++) { L[i] = noise[(pos + i) & 4095]; R[i] = noise[(pos + 2048 + i) & 4095]; } pos = (pos + 128) & 4095; return io; };
}
// a mastering chain of five: EQ → compressor (multiband) → Distortion (light saturation) → Utility (width) → compressor (Limit)
function master5make(fx) {
  fxInst(fx, 'eq', { gainL: 0.6, gainH: 0.55 });
  fxInst(fx, 'cmp', { mb: 1 });
  fxInst(fx, 'dist', { drive: 0.15, mix: 0.3 });
  fxInst(fx, 'util', { width: 0.15 });
  fxInst(fx, 'cmp', { ratio: 1, att: 0.3 });
}
const master5 = () => fxScn(master5make);
// IMPL-MM §6.3: the master's modulators on rack5 — the host's payload (a track-shaped record as main.js's MREC, cv-graph.compileMods
// + bpm, §4.2; never a hand-built CP): 4 GLOBAL LFOs (BPM 1/4 anchored, BPM 1/8, Hz RETRIG, Hz FREE), a mono chaos, a macro module;
// 8 fx rows onto the five units' knobs (every dst.chain 'mfx'), 140 BPM
const mrow = (id, src, dst, amt, bi) => ({ id, src, dst, amt, bi, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 });
export function masterPayload(fx) {
  const lad = core.LFO_LADDER, ladN = label => lad.findIndex(x => x.label === label) / (lad.length - 1), [eq, cmpM, dist, util] = fx.racks[0].mods.map(I => I.id);
  const lfo = (mode, bpm, anchor, rate) => normModDev({ kind: 'lfo', lfo: { mono: 1, mode, bpm, anchor }, rate });
  const t = { id: 'master', dev: { mfx: { kind: 'panel', fx }, l1: lfo('free', 1, 1, ladN('1/4')), l2: lfo('free', 1, 0, ladN('1/8')), l3: lfo('retrig', 0, 0, 0.35), l4: lfo('free', 0, 0, 0.6),
    h1: normModDev({ kind: 'chaos', chaos: { mono: 1, sh: 0 }, rate: 0.5 }), m1: normModDev({ kind: 'macro', v: [0.5, 0.25, 0.75, 0, 0, 0, 0, 0] }) }, mid: 9,
    mods: [mrow('r1', 'l1.out', `mfx:fx.${eq}.gainL`, 0.3, 1), mrow('r2', 'l2.out', `mfx:fx.${eq}.gainH`, 0.3, 1), mrow('r3', 'l3.out', `mfx:fx.${dist}.drive`, 0.3, 0), mrow('r4', 'l4.out', `mfx:fx.${dist}.freq`, 0.3, 0),
      mrow('r5', 'h1.out', `mfx:fx.${util}.width`, 0.2, 0), mrow('r6', 'm1.k1', `mfx:fx.${cmpM}.thr`, 0.3, 0), mrow('r7', 'm1.k2', `mfx:fx.${dist}.mix`, 0.3, 0), mrow('r8', 'm1.k3', `mfx:fx.${util}.lpf`, 0.3, 0)] };
  const pay = compileMods(t, { bpm: 140, perf: { wheel: null }, tracks: [], pads: [] }, { smooth: 1, qr: null, ultra: 0 });
  if (!pay || pay.rows.length !== 8) throw new Error('bench master-mods: the payload compiles ' + (pay ? pay.rows.length : 'no') + ' rows');
  pay.bpm = 140;
  return pay;
}
function masterMods() { const B = fxScn(master5make); B.mods = masterPayload(B.fx); return B; }

export function scenarios() {
  const A = () => assets();
  const list = [
    { id: 'd', label: '8 voices × 3 WT osc × unison 7, W1 Bend+ 50 %, W2 Tube 30 %, MG Low 24 → Low 12, 2 LFOs, 4 rows', node: 0.8, ipad: 0.45, kind: 'voice',
      build: () => sx(rowD, { notes: chord(8) }) },
    { id: 'e', label: '16 voices Multisample, unison 1', node: 0.12, ipad: 0.08, kind: 'voice',
      build: () => sx(s => { s.osc[0].type = 'multi'; s.osc[0].multi = 'msmp:bench'; s.voicing.poly = 16; }, { notes: chord(16, 36), assets: A() }) },
    { id: 'f', label: '16 voices Sample stereo, unison 4, Fwd loop with X-fade', node: 0.35, ipad: 0.2, kind: 'voice',
      build: () => sx(s => {
        s.osc[0].type = 'sample'; s.osc[0].smp = 'smp:bench'; s.osc[0].smpo.loop = 1; s.voicing.poly = 16;
        Object.assign(s.p, { 'a.uni': 3 / 15, 'a.det': 0.3, 'a.lstart': 0.2, 'a.lend': 0.8, 'a.xfade': 0.5 });
      }, { notes: chord(16, 36), assets: A() }) },
    { id: "f'", label: '8 voices Sample, unison 4, W1 Sync 50 % + W2 Bend+', node: 0.35, ipad: 0.25, kind: 'voice',
      build: () => sx(s => {
        s.osc[0].type = 'sample'; s.osc[0].smp = 'smp:bench'; s.osc[0].smpo.loop = 1; s.voicing.poly = 8;
        Object.assign(s.p, { 'a.uni': 3 / 15, 'a.det': 0.3, 'a.w1': W2('sync'), 'a.warp': 0.5, 'a.w2': W2('bend_p'), 'a.warp2': 0.5 });
      }, { notes: chord(8), assets: A() }) },
    { id: 'g', label: '8 voices Granular: Free 40 Hz, 200 ms, Hann', node: 0.3, ipad: 0.2, kind: 'voice', gran: 1,
      build: () => sx(s => { gran(s, 0, core.parseParam('a.dens', '40 Hz'), core.parseParam('a.glen', '200 ms')); s.voicing.poly = 8; }, { notes: chord(8), assets: A() }) },
    { id: "g'", label: 'one voice at 256 grains', node: 0.35, ipad: 0.25, kind: 'voice', gran: 1,
      build: () => sx(s => { gran(s, 0, core.parseParam('a.dens', '800 Hz'), core.parseParam('a.glen', '320 ms')); }, { notes: chord(1), assets: A() }) },
    { id: 'g"', label: '8 voices × 3 Granular oscillators at max density (processor cap 512)', node: 0.7, ipad: 0.5, kind: 'voice', gran: 1,
      build: () => sx(s => { for (let o = 0; o < 3; o++) gran(s, o, core.parseParam('a.dens', '800 Hz'), core.parseParam('a.glen', '320 ms')); s.voicing.poly = 8; }, { notes: chord(8), assets: A() }) },
    { id: 'h', label: '4 voices Spectral (N 2048, hop 512), one Smear warp', node: 0.25, ipad: 0.18, kind: 'voice',
      build: () => sx(s => { spec(s); s.voicing.poly = 4; }, { notes: chord(4), assets: A() }) },
    { id: "h'", label: '8 voices Spectral, as h', node: 0.5, ipad: 0.35, kind: 'voice',
      build: () => sx(s => { spec(s); s.voicing.poly = 8; }, { notes: chord(8), assets: A() }) },
    { id: 'i', label: '64 rows (20 with curves, 10 with slew), 8 voices — matrix + begin overhead (minus the same voices without rows)',
      node: 0.1, ipad: 0.06, kind: 'voice',
      base: () => sx(s => { Object.assign(s.p, { 'b.on': 1, 'f.on': 1 }); s.voicing.poly = 8; }, { notes: chord(8) }),
      build: () => sx(s => {
        const src = ['lfo1', 'lfo2', 'env2', 'velo', 'note', 'macro1', 'lfo3', 'env3'];
        const dst = ['a.wt', 'a.warp', 'a.level', 'a.pan', 'a.fine', 'f.cutoff', 'f.res', 'f.drive', 'b.wt', 'b.level', 'b.pan', 'b.fine', 'n.level', 's.level', 'g.master', 'e1.att'];
        for (let r = 0; r < 64; r++) {
          s.matrix[r] = row(src[r % src.length], dst[r % dst.length], 0.05 + 0.01 * (r % 7), {
            crv: r < 20 ? [[0, 0, 0], [0.4 + 0.01 * r, 0.7, 0.2], [1, 1, 0]] : null, rise: r >= 20 && r < 30 ? 0.05 : 0, fall: r >= 20 && r < 30 ? 0.1 : 0 });
        }
        Object.assign(s.p, { 'b.on': 1, 'f.on': 1 });
        s.voicing.poly = 8;
      }, { notes: chord(8) }) },
    { id: 'j', label: 'FX: Convolve, 4 s stereo IR', node: 0.08, ipad: 0.05, kind: 'fx',
      build: () => fxScn(fx => {
        const I = fxInst(fx, 'conv', { mix: 0.5 });
        I.sub = { ir: 'ir:bench' };
        const fxp = core.compileFx(fx, { bpm: 120, rate: SR }), id = fxp.needs[0];
        return { assets: { [id]: irEntry(id, irRecord(), SR, convShapeOf(I.p)) } };
      }) },
    ...core.REV_TYPES2.map((name, t) => ({ id: 'k' + t, label: 'FX: Reverb ' + name, node: 0.05, ipad: 0.03, kind: 'fx',
      build: () => fxScn(fx => { fxInst(fx, 'rev', { type: t, mix: 0.5, size: 0.6, decay: 0.6 }); }) })),
    // the Windows idle-DSP review #3 (d): the denormal sweep's slowest quantum — a Plate (the largest pool at 48 kHz, 64 k floats)
    // on exact zeros after the bench noise, swept once idle() every ⅛ s until its pool is clean (MASTER / a sidechain panel)
    { id: 'sweep', label: 'FX: Reverb Plate on silence after the noise — the denormal sweep\'s slowest quantum', node: 0.1, ipad: 0.1, jsc: 0.1, kind: 'sweep',
      build: () => fxScn(fx => { fxInst(fx, 'rev', { type: 0, mix: 0.5, size: 0.6, decay: 0.6 }); }) },
    { id: 'l', label: 'FX: Bode with BLUR and feedback', node: 0.03, ipad: 0.02, kind: 'fx',
      build: () => fxScn(fx => { const I = fxInst(fx, 'bode', {}); I.p.blur = 0.5; I.p.feed = 0.5; I.p.shift = 0.6; I.p.mix = 0.5; }) },
    { id: 'm', label: 'FX: Splitter L/M/H with 3 EQs', node: 0.04, ipad: 0.03, kind: 'fx',
      build: () => fxScn(fx => {
        const sp = fxInst(fx, 'split3', {});
        for (let b = 0; b < 3; b++) fxInst(fx, 'eq', {}, { splitter: sp.id, branch: b });
      }) },
    // IMPL-SC G7 (lane D): the sidechain rows — cmp a v2 compressor on noise (the reference), sc-duck one Ducker triggered every
    // 0.25 s from a hand-filled ring (the registry read per block + the dip), sc-key a v3 compressor at KEY EXT on noise with a key
    // buffer (the key path + its HPF); each writes the rack's sc context per quantum as the Track does (`sc`)
    { id: 'cmp', label: 'FX: Compressor (single band, thr −20 dB, ratio 4) on noise', node: 0.012, ipad: 0.01, kind: 'fx',
      build: () => fxScn(fx => { fxInst(fx, 'cmp', { thr: Math.pow(10, -20 / 20), ratio: 4, att: 2, rel: 80 }); }) },
    { id: 'sc-duck', label: 'FX: Ducker (depth 100 %, 1/8 synced, att 1 ms, smooth 2 ms), a trigger every 0.25 s from a hand-filled ring', node: 0.002, ipad: 0.002, kind: 'fx',
      build: () => fxScn(fx => { const I = fxInst(fx, 'duck', { depth: 1, bpm: 1, att: 1, smooth: 2 }); I.sub.src = 'trk_1'; return { sc: scCtx('trk_1', 94, null) }; }) },
    { id: 'sc-key', label: 'FX: Compressor v3 at KEY EXT (HPF 80 Hz) on noise, keyed by a noise buffer', node: 0.013, ipad: 0.011, kind: 'fx',
      build: () => fxScn(fx => {
        const id = core.newInstance(fx, 'cmp', { rack: 0 }), R = fx.racks[0].mods, J = R.find(x => x.id === id), I = core.upgradeInstance(J);
        R[R.indexOf(J)] = I; I.sub.src = 'trk_1';
        for (const [k, v] of Object.entries({ thr: Math.pow(10, -20 / 20), ratio: 4, att: 2, rel: 80, ext: 1, schp: 80 })) { const r = core.FXP_TAB.cmp[3].find(x => x.pid === k); I.p[k] = lawN(r.law, r.lo, r.hi, v); }
        return { sc: scCtx('trk_1', 0, 'key') };
      }) },
    // live preset switch (§11.10): row d's WT patch, then the preset changes to h' / g" while the track is silent; the
    // load is the slowest quantum of the first chord on the new preset (≤ 1 = within the deadline)
    { id: 'r', label: 'Track: Prophet-5 Poly Strings + Juno-60 + default Serum → one EQ / chorus / delay panel, a 4-note chord on all three',
      node: 0.15, ipad: 0.12, kind: 'track', build: trackR },
    // IMPL-2b §8 N4 (lane A1): ModCore's cost over the same track without it (base)
    { id: 'mc0', label: 'ModCore, begin only: 10 GLOBAL LFOs into 10 ext slots, no rows (a Juno-60 note sounds; minus the same track without ModCore)',
      node: 0.002, ipad: 0.003, kind: 'track', base: () => junoTrack(null), build: () => junoTrack(mcRows('mc0')) },
    { id: 'mc', label: 'ModCore: 10 GLOBAL LFOs + the gated pseudo-voice with 3 ENVs + 16 rows on a Juno-60 (minus the track without)',
      node: 0.004, ipad: 0.006, kind: 'track', base: () => junoTrack(null), build: () => junoTrack(mcRows('mc')) },
    { id: 'mt', label: 'ModCore, the typical track: 2 GLOBAL + 1 PER NOTE LFO + 1 ENV + 4 rows on a Juno-60 (minus the track without)',
      node: 0.0025, ipad: 0.004, kind: 'track', base: () => junoTrack(null), build: () => junoTrack(mcRows('mt')) },
    { id: 'me', label: "ext hand-off: row d's Serum with ext1 → f.cutoff fed by a one-LFO ModCore (minus the same Serum reading `fixed`)",
      node: 0.004, ipad: 0.004, kind: 'track', base: () => extTrack(false), build: () => extTrack(true) },
    // 2b: the classic adapter (minus the same Juno-60 without cables)
    { id: 'mk', label: 'Classic mod: 8-voice Juno-60 + one cutoff cable (±2 oct LFO) — slot-offset overhead (minus the row without)', node: 0.0035, ipad: 0.005, kind: 'voice',
      base: () => juno8(null), build: () => juno8(mkPrep) },
    { id: 'ms', label: 'Classic mod: 8-voice Juno-60 + 4 envelope-time cables changing every span — span-setter overhead (minus the row without)', node: 0.012, ipad: 0.012, kind: 'voice',
      base: () => juno8(null), build: () => juno8(msPrep) },
    // IMPL-7a §2.6: the TR-808 (its own sequencer synced, the whole track; d8i, the idle machine, is gated as row p is)
    { id: 'd8p', label: 'TR-808: a typical pattern (BD on the beats, SD + CP on 2 / 4, CH, OH off-beats, two toms, CB, accents), 120 BPM, synced', node: 0.02, ipad: 0.02,
      kind: 'track', build: () => drumTrack(DRUM_PATTERNS.d8p) },
    { id: 'd8x', label: 'TR-808: every lane every 250 ms, accented, every DECAY at 10 (the worst case)', node: 0.1, ipad: 0.1,
      kind: 'track', build: () => drumTrack(DRUM_PATTERNS.d8x, { bdd: 10, cyd: 10, ohd: 10 }) },
    { id: 'd8m', label: 'TR-808: CY + OH + CB every 500 ms (the metal bank and three VCAs)', node: 0.035, ipad: 0.035,
      kind: 'track', build: () => drumTrack(DRUM_PATTERNS.d8m) },
    { id: 'd8s', label: 'TR-808: d8p with all 16 sounds as user samples (a 1 s fixture)', node: 0.012, ipad: 0.012,
      kind: 'track', build: () => drumTrack(DRUM_PATTERNS.d8p, null, true) },
    // IMPL-7b §2.6: the TR-606 (the same way; d6i, the idle machine, is gated as row p is)
    { id: 'd6p', label: 'TR-606: a typical pattern (BD on the quarters, SD on 2 / 4, CH sixteenths, OH off-beats, LT / HT, CY once a bar, accents), 120 BPM, synced',
      node: 0.025, ipad: 0.025, kind: 'track', build: () => drumTrack(DRUM_PATTERNS.d6p, null, false, 'tr606') },
    { id: 'd6x', label: 'TR-606: every lane every 250 ms, accented, every extras DECAY at 10 (the worst case)', node: 0.06, ipad: 0.06,
      kind: 'track', build: () => drumTrack(DRUM_PATTERNS.d6x, { bdd: 10, sdd: 10, ltd: 10, htd: 10, cyd: 10, ohd: 10, chd: 10 }, false, 'tr606') },
    { id: 'd6m', label: 'TR-606: CY + OH every 500 ms (the metal bank, three VCAs, the tempo-clocked cut)', node: 0.025, ipad: 0.025,
      kind: 'track', build: () => drumTrack(DRUM_PATTERNS.d6m, null, false, 'tr606') },
    // IMPL-7c §2.7: the TR-909 (the same way; d9i, the idle machine, is gated as row p is)
    { id: 'd9p', label: 'TR-909: a house pattern (BD on the quarters, CH sixteenths, OH off-beats, HC + SD on 2 / 4 with a flam, ride eighths, a crash a bar, three toms, both accents, SHUFFLE 3), 120 BPM, synced',
      node: 0.035, ipad: 0.035, kind: 'track', build: () => drumTrack(DRUM_PATTERNS.d9p, null, false, 'tr909') },
    { id: 'd9x', label: 'TR-909: every lane every 250 ms, both accents, flams on all five, every DECAY / TONE at 10, the cymbals\' TUNE at 0 (the worst case)', node: 0.08, ipad: 0.08,
      kind: 'track', build: () => drumTrack(DRUM_PATTERNS.d9x, { bdd: 10, sdt: 10, ltd: 10, mtd: 10, htd: 10, chd: 10, ohd: 10, cru: 0, rdu: 0 }, false, 'tr909') },
    { id: 'd9m', label: 'TR-909: crash + ride + OH every 500 ms (the ROM voices: three staircases, filters, envelopes)', node: 0.025, ipad: 0.025,
      kind: 'track', build: () => drumTrack(DRUM_PATTERNS.d9m, null, false, 'tr909') },
    // IMPL-8 §12.7: the SDS-V (roll notes, no sequencer; dvi, the idle machine, is gated as row p is)
    { id: 'dvp', label: 'SDS-V: a typical groove as roll notes (bass on the quarters, snare on 2 / 4, a tom fill 3 → 1 in sixteenths on the last beat, v 70–127), its defaults, 120 BPM',
      node: 0.03, ipad: 0.035, kind: 'track', build: () => drumTrack(DRUM_PATTERNS.dvp, null, false, 'sdsv') },
    { id: 'dvx', label: 'SDS-V: all five every 125 ms at v 127, every DECAY and SENSITIVITY at 10 (the worst case)', node: 0.05, ipad: 0.06,
      kind: 'track', build: () => drumTrack(DRUM_PATTERNS.dvx, DVX_VALS, false, 'sdsv') },
    { id: 'dvm', label: 'SDS-V: dvp\'s groove on memories 3 / 4 (the payload\'s trims), every memory key switched each bar', node: 0.03, ipad: 0.035,
      kind: 'track', build: () => drumTrack(DRUM_PATTERNS.dvp, DVM_MEM[0], false, 'sdsv', { cycle: [DVM_MEM[1], DVM_MEM[0]] }) },
    // IMPL-9 §3.8 (spike (a)'s rows): the 900 Series (the patch evaluator over the Model 15 set)
    { id: 'm9p', label: '900 Series: Classic bass (the Model 15 set) playing an eighth-note bass line as roll notes, its defaults, 120 BPM', node: 0.025, ipad: 0.02,
      kind: 'track', build: () => patchTrack(MG.model15(), { song: true }) },
    { id: 'm9x', label: '900 Series: every Model 15 module live — audio-rate FM into the 904A at k 4.4, a 904A → 921B → 904A loop, sync STRONG, an audio-rate clamp, 923 → 907A, a chord held', node: 0.05, ipad: 0.045,
      kind: 'track', build: () => patchTrack(m9xPatch(), { notes: [[36, 0.8], [43, 0.7], [48, 0.6]] }) },
    { id: 'm9d', label: '900 Series: Drone (three oscillators in fifths, pink noise, the 907A; no notes — it never goes quiet)', node: 0.03, ipad: 0.025,
      kind: 'track', build: () => patchTrack(presetSet('Drone')) },
    // IMPL-9b §3.7 (spike (a2) decision 3; jsc: the macOS shell's target, the lead's A/B): the System 55 set's rows
    { id: 'm9q', label: '900 Series: Sequence on the System 55 set — the Song clock on ALWAYS at 120 BPM into the 960 (SHIFT, RESTART → stage 1), the 961 and the 911A striking two 911s, three oscillators', node: 0.03, ipad: 0.02, jsc: 0.022,
      kind: 'track', build: () => patchTrack(m9qPatch()) },
    { id: 'm9s', label: '900 Series: the System 55 set as a classic voice — seven oscillators, two CP3As, the 914, the 904B, the 904A (regeneration 6), two 902s; five 911s, three routed by the 993 (two through the 911A); a bass line', node: 0.055, ipad: 0.04, jsc: 0.042,
      kind: 'track', build: () => patchTrack(m9sPatch(), { song: true }) },
    // IMPL-9c §3 G3 (jsc / ipad from m9s's ratios): the System IIIc set's row
    { id: 'm9c', label: '900 Series: the System IIIc set as a classic voice — ten oscillators (nine 901Bs on three 901As, the 901) through three CP3s, the 984, the 904C / 904A / 904B into three 902s on three 911s, the fourth CP3 into the 905; a bass line', node: 0.06, ipad: 0.044, jsc: 0.046,
      kind: 'track', build: () => patchTrack(m9cPatch(), { song: true }) },
    // IMPL-M §6 G4: the master processor per quantum at 48 kHz (env.mkMaster; jsc: the macOS shell's target, × 7 the Low floor)
    { id: 'master-empty', label: 'Master: an empty rack, no meters (the copy path: the processor alone)', node: 0.001, ipad: 0.001, jsc: 0.001,
      kind: 'master', meters: false, build: () => ({}) },
    { id: 'master-meters', label: 'Master: an empty rack + the meters (K-weighting, M / S / I, LRA, true peak 4×, correlation, the A/B match\'s input meter)', node: 0.008, ipad: 0.007, jsc: 0.008,
      kind: 'master', build: () => ({}) },
    { id: 'master-rack5', label: 'Master: EQ → compressor (multiband) → Distortion → Utility → compressor (Limit) + the meters', node: 0.03, ipad: 0.025, jsc: 0.03,
      kind: 'master', build: () => master5() },
    // IMPL-MM §6.3 G4: the master's modulators — rack5 + a ModCore payload (4 GLOBAL LFOs, a mono chaos, a macro module; 8 fx rows onto its
    // knobs, 140 BPM): the row itself, and its cost over rack5 measured interleaved in one process (the row minus its base per block)
    { id: 'master-mods', label: 'Master: master-rack5 + a ModCore payload (4 GLOBAL LFOs, a mono chaos, a macro module; 8 fx rows onto its knobs, 140 BPM) + the meters', node: 0.034, ipad: 0.029, jsc: 0.034,
      kind: 'master', build: () => masterMods() },
    { id: 'master-mods-d', label: 'Master: master-mods minus master-rack5, interleaved (the ModCore\'s cost on MASTER: its span, setMods, the units\' coefficient updates for knobs that move)', node: 0.004, ipad: 0.006, jsc: 0.005,
      kind: 'master', base: () => master5(), build: () => masterMods() },
    { id: 'q1', label: "preset switch d → h' (Spectral), first chord: slowest quantum", node: 0.8, ipad: 0.6, kind: 'switch',
      build: () => ({ from: sx(rowD), to: sx(s => { spec(s); s.voicing.poly = 8; }), notes: chord(8), assets: A() }) },
    { id: 'q2', label: 'preset switch d → g" (3 × Granular), first chord: slowest quantum', node: 0.8, ipad: 0.6, kind: 'switch',
      build: () => ({ from: sx(rowD), to: sx(s => { for (let o = 0; o < 3; o++) gran(s, o, core.parseParam('a.dens', '800 Hz'), core.parseParam('a.glen', '320 ms')); s.voicing.poly = 8; }),
        notes: chord(8), assets: A() }) },
  ];
  return list;
}

/* ------------------------------------------------------------------ measurement */
const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
const Q_MS = 128 / SR * 1000;                     // one render quantum of real time (ms)
// the tables a patch needs (wavetables, noises, sub shapes; sample assets come with the build)
function sendTables(p, patch) {
  for (const id of patch.needs || []) if (!/^(smp|msmp|spec|wtsmp|fsmp|fmsmp):/.test(id)) {
    const e = id.startsWith('noise:') ? W.makeNoise(id) : W.makeEntry(id, W.factoryTable(id) || W.factoryTable('factory:Default'));
    p.msg(Object.assign({ t: 'wt' }, e, { id }));
  }
}
// prepares one build in env → {step(frames, timed?), peak(), runPeak(), grains(), worst()}: step renders whole quanta
// (timed: each quantum timed on its own, the slowest kept, ms)
function prepare(B, kind, env, now) {
  if (B.assets) for (const [id, e] of Object.entries(B.assets)) env.SxBase.storeAsset(id, e);
  let pk = 0, rpk = 0, wq = 0;
  const track = (L, n) => { for (let i = 0; i < n; i++) { const a = L[i] < 0 ? -L[i] : L[i]; if (a > rpk) rpk = a; } if (rpk > pk) pk = rpk; };
  const quanta = (q, frames, timed) => {
    for (let k = 0; k < frames; k += 128) {
      if (timed) { const t0 = now(); q(); const dt = now() - t0; if (dt > wq) wq = dt; } else q();
    }
  };
  const api = (q, gr) => ({ step: (frames, timed) => quanta(q, frames, timed), peak: () => pk, runPeak: () => { const r = rpk; rpk = 0; return r; },
    grains: gr, worst: () => wq });
  if (kind === 'track') {
    const p = env.mk({ os: 4, hostOS: 4, offline: true });
    p.msg(B.graph);
    for (const [id, patch] of Object.entries(B.patches)) { p.msg({ t: 'patch', i: id, p: patch }); sendTables(p, patch); }
    for (const [id, c] of Object.entries(B.chains)) p.msg(Object.assign({ t: 'chain', c: id }, c));
    if (B.seqs) for (const [id, s] of Object.entries(B.seqs)) p.msg({ t: 'seq', i: id, s }); // (a drum machine's payload)
    if (B.song) p.msg(B.song); // ((IMPL-8) roll notes: the SDS-V's rows)
    // (the transport's tick 0 at the row's first frame — the scope's currentFrame has moved on after earlier rows: a sparse
    // drum row anchored at frame 0 could start between its hits and time silence, 7b's d6m in bench.test's 50 ms runs)
    if (B.transport) p.msg(Object.assign({ t: 'transport' }, B.transport, typeof p.nowF === 'function' ? { frame: p.nowF() } : null));
    if (B.mods) { // (IMPL-2b: the track's ModCore payload; its rows' scratch destinations resolved through the scope's SxBase)
      const DI = env.SxBase.DIDX2, m = B.mods;
      for (const r of m.rows) if (r.dstId) r.vi = DI[r.dstId.toUpperCase().replace('.', '_')];
      p.msg(m);
      if (!p.mc) throw new Error('bench ' + (B.graph.key || '') + ': the ModCore payload was refused');
    }
    for (const [n, v] of B.notes) p.msg({ t: 'on', n, v });
    const L = new Float32Array(128), R = new Float32Array(128), out = [[L, R]], cyc = B.cycle || null;
    let cf = 0, ck = 0; // ((IMPL-8) dvm: the next panel of the cycle at each bar, between quanta — the app's {t: patch} on a switch)
    return api(() => {
      if (cyc !== null && (cf += 128) > cyc.frames) { cf -= cyc.frames; p.msg(cyc.msgs[ck++ % cyc.msgs.length]); }
      p.process([], out); env.advance(128); track(L, 128);
    }, () => -1);
  }
  if (kind === 'voice') {
    const p = env.mk({ os: 2, hostOS: 4, offline: true });
    p.msg({ t: 'patch', p: B.patch });
    sendTables(p, B.patch);
    for (const [n, v] of B.notes) p.msg({ t: 'on', n, v });
    if (typeof B.prep === 'function') B.prep(p); // (rows mk / ms: cables on the live processor)
    const L = new Float32Array(128), R = new Float32Array(128), out = [[L, R]];
    return api(() => { p.process([], out); env.advance(128); track(L, 128); }, () => (p.sx && p.sx.grains >= 0 ? p.sx.grains | 0 : -1));
  }
  if (kind === 'master') { // (IMPL-M G4: a live MASTER — its warm-up ran — the rack as a {t: 'chain'}, the bench noise in)
    if (typeof env.mkMaster !== 'function') throw new Error('bench: env.mkMaster (the synth-master class) is missing');
    const p = env.mkMaster({}, B.meters === false), inp = masterInput(), L = new Float32Array(128), R = new Float32Array(128), out = [[L, R]];
    if (B.fxp) p.msg({ t: 'chain', fxr: B.fxp, fxrT: B.fxt });
    if (B.mods) p.msg(B.mods);                    // (IMPL-MM: the master's {t: 'mods'} payload, after its chain as the host posts it)
    return api(() => { p.process(inp(), out); env.advance(128); track(L, 128); }, () => -1);
  }
  const rack = new env.FXDSP.FXRack(SR);
  rack.set(B.fxp, B.fxt);
  if (typeof rack.assets === 'function') rack.assets(); // (the engine's hook after stored assets, §9.5)
  const r = W.mulberry32(W.fnv1a32('bench-noise')), noise = Float64Array.from({ length: 4096 }, () => 0.25 * (2 * r() - 1));
  const L = new Float64Array(128), R = new Float64Array(128), sc = typeof B.sc === 'function' ? B.sc : null;
  let pos = 0, q = 0;
  return api(() => {
    for (let i = 0; i < 128; i++) { L[i] = noise[(pos + i) & 4095]; R[i] = noise[(pos + 2048 + i) & 4095]; }
    pos = (pos + 128) & 4095;
    if (sc !== null) sc(rack, q++);                 // (IMPL-SC G7: the sidechain rows' registry / key per quantum)
    rack.process(L, R, 128);
    track(L, 128);
  }, () => -1);
}
// a 'switch' row: a live processor (warm-ups on) plays `from`, the preset changes to `to` while the track is silent, then
// the chord again → {load: slowest quantum of the first 1.5 s / quantum time, worst (ms), steady (median quantum after
// 0.5 s, ms), peak}
function measureSwitch(scn, env, now) {
  const B = scn.build();
  if (B.assets) for (const [id, e] of Object.entries(B.assets)) env.SxBase.storeAsset(id, e);
  const p = env.mk({ os: 2, hostOS: 4 }), L = new Float32Array(128), R = new Float32Array(128), out = [[L, R]];
  let pk = 0;
  const q = () => { p.process([], out); env.advance(128); for (let i = 0; i < 128; i++) { const a = L[i] < 0 ? -L[i] : L[i]; if (a > pk) pk = a; } };
  const run = (sec, times) => { for (let k = 0; k < Math.round(sec * SR / 128); k++) { if (times) { const t0 = now(); q(); times.push(now() - t0); } else q(); } };
  const chord = on => { for (const [n, v] of B.notes) p.msg(on ? { t: 'on', n, v } : { t: 'off', n }); };
  p.msg({ t: 'patch', p: B.from.patch }); sendTables(p, B.from.patch);
  run(1);                                     // the first-use warm-up of the scope (silent)
  chord(true); run(0.5); chord(false); run(1);  // the WT patch plays and dies away
  p.msg({ t: 'patch', p: B.to.patch }); sendTables(p, B.to.patch);
  run(0.5);                                   // browsing: the new preset's warm-ups run while the track is silent
  pk = 0;
  chord(true);
  const first = [], later = [];
  run(0.5, first); run(1, later);
  for (const t of later) first.push(t);
  chord(false);
  const worst = Math.max(...first);
  return { load: worst / Q_MS, loads: [worst / Q_MS], worst, steady: med(later), peak: pk };
}
// a 'sweep' row (the idle-DSP review #3 d): `runs` fresh racks, each 0.5 s of the bench noise, then 30 s of exact zeros timed
// quantum by quantum — the rack goes idle() and its denormal sweep clears the reverb pool every ⅛ s (rack.sweep counted on the
// instance) until the pool is clean → {load: the slowest sweep quantum / quantum time (median of the runs), loads, worst (the
// slowest quantum of all, same unit), steady (median quantum on zeros without a sweep, ms), sweeps (per run), peak (the
// noise's)}; throws when a run never swept (it would time nothing)
function measureSweep(scn, env, runs, now) {
  const loads = [], st = [], r = W.mulberry32(W.fnv1a32('bench-noise')), noise = Float64Array.from({ length: 4096 }, () => 0.25 * (2 * r() - 1));
  let pk = 0, wq = 0, n = 0;
  for (let k = 0; k < runs; k++) {
    const B = scn.build(), rack = new env.FXDSP.FXRack(SR), L = new Float64Array(128), R = new Float64Array(128), s0 = rack.sweep;
    rack.set(B.fxp, B.fxt);
    let hit = 0, sw = 0, pos = 0;
    rack.sweep = function () { hit = 1; return s0.call(this); };
    for (let q = 0; q < Math.round(0.5 * SR / 128); q++) {
      for (let i = 0; i < 128; i++) { L[i] = noise[(pos + i) & 4095]; R[i] = noise[(pos + 2048 + i) & 4095]; }
      pos = (pos + 128) & 4095;
      rack.process(L, R, 128);
      for (let i = 0; i < 128; i++) { const a = L[i] < 0 ? -L[i] : L[i]; if (a > pk) pk = a; }
    }
    for (let q = 0; q < Math.round(30 * SR / 128); q++) {
      L.fill(0); R.fill(0); hit = 0;
      const t0 = now(); rack.process(L, R, 128); const dt = now() - t0;
      if (dt > wq) wq = dt;
      if (hit === 1) { n++; if (dt > sw) sw = dt; } else st.push(dt);
    }
    if (sw === 0) throw new Error(`bench ${scn.id}: run ${k + 1} never swept — it would time nothing`);
    loads.push(sw / Q_MS);
  }
  return { load: med(loads), loads, worst: wq / Q_MS, steady: med(st), sweeps: n / runs, peak: pk };
}
// renders scenario `scn` in env: 0.25 s warm-up, then `runs` × `seconds` of audio timed (interleaved with its base when
// the row measures an overhead); every timed run must be audible (and, for Granular rows, have grains sounding) or it
// throws: a silent run times nothing. → {load (median), loads, peak, worst (slowest quantum / quantum time, timed runs
// of the row itself)}
export function measure(scn, env, o = {}) {
  const runs = o.runs || 5, seconds = o.seconds || 1, now = env.now || (() => performance.now());
  if (scn.kind === 'switch') return measureSwitch(scn, env, now);
  if (scn.kind === 'sweep') return measureSweep(scn, env, runs, now);
  const bld = () => { const B = scn.build(); if (scn.kind === 'master') B.meters = scn.meters !== false; return B; };
  const A = prepare(bld(), scn.kind, env, now), Z = scn.base ? prepare(scn.base(), scn.kind, env, now) : null;
  const check = (X, what) => {
    const r = X.runPeak(), g = X.grains();
    if (!(r > 1e-4)) throw new Error(`bench ${scn.id}: ${what} run is silent (peak ${r}) — it would time silence`);
    if (scn.gran && g === 0) throw new Error(`bench ${scn.id}: ${what} run has no grains sounding`);
  };
  const time = (X, what) => { X.runPeak(); const t0 = now(); X.step(Math.round(seconds * SR), X === A); const t = (now() - t0) / 1000 / seconds; check(X, what); return t; };
  A.step(Math.round(0.25 * SR)); if (Z) Z.step(Math.round(0.25 * SR));
  const loads = [];
  for (let k = 0; k < runs; k++) loads.push(Z ? (k & 1 ? -time(Z, 'base') + time(A, 'row') : time(A, 'row') - time(Z, 'base')) : time(A, 'row'));
  return { load: Math.max(0, med(loads)), loads, peak: A.peak(), worst: A.worst() / Q_MS };
}
/** Row `scn` prepared in env as measure() prepares it → { step(frames), peak() } (whole quanta; IMPL-SC G7's node gates in
 *  tests/fx-dsp.test.mjs time it through tests/cpu-gate.mjs). */
export function stepper(scn, env) { return prepare(scn.build(), scn.kind, env, env.now || (() => performance.now())); }

export { MODELS };
