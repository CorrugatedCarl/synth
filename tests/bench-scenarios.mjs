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
// chord reaching every instrument (full key zones); classic instruments at the app's oversampling (4).
//   const S = scenarios();                          // [{id, label, node, ipad, kind, gran?, build()}]
//   const r = measure(S[0], env, {runs: 5});        // {load, loads, peak, worst}
// env = { mk(processorOptions) → processor, advance(frames), FXDSP, SxBase, now() → ms }.
import * as core from '../serum-core.js?v=9';
import * as W from '../wt.js?v=9';
import { patchFor, MODELS } from '../models.js?v=9';
import * as smp from '../smp.js?v=9';
import { playbackEntry, specEntry, irEntry } from '../smpwork.js?v=9';
import { convShapeOf } from '../assets.js?v=9';
import { lawNorm as lawN } from '../laws.js?v=9';
import { SLOT } from '../cv-mods.js?v=9';
import * as DC from '../drum-core.js?v=9';

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
export const DRUM_PATTERNS = Object.freeze({
  d8p: { ac: 'x...x...x...x...', bd: 'x...x...x...x...', sd: '....x.......x...', cp: '....x.......x...', ch: 'x...x...x...x...', oh: '..x...x...x...x.',
    mt: '......x.........', lt: '..............x.', cb: '...x.......x....' },
  d8x: Object.fromEntries(DC.LANES.map(l => [l, 'x.x.x.x.x.x.x.x.'])),
  d8m: { cy: 'x...x...x...x...', oh: 'x...x...x...x...', cb: 'x...x...x...x...' },
});
const drumSteps = o => { const st = new Array(32).fill(0); for (const [lane, r] of Object.entries(o)) { const l = DC.LANES.indexOf(lane); for (let k = 0; k < r.length; k++) if (r[k] === 'x') st[k] |= 1 << l; } return st; };
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
/** A drum machine track (kind 'track'): pattern rows (DRUM_PATTERNS' form, or 32 step masks), panel values over the
 *  defaults, samples on. */
export function drumTrack(rows, vals, samples) {
  const m = MODELS.find(x => x.id === 'tr808'), v = Object.assign(Object.fromEntries(m.controls.map(c => [c.id, c.def])), vals || {});
  const p = patchFor(m, v, core.defaultFx2(), { sr: SR, bpm: 120 });
  delete p.fxr; delete p.fxrT; // (a classic Inst's patch on a graph node: its panel is a {t: 'chain'})
  const d = DC.normDrum(undefined), fx = core.defaultFx2(), Z = { lo: 0, hi: 127, xp: 0 }, S = samples ? drumSample() : null;
  d.st[0] = Array.isArray(rows) ? rows.slice() : drumSteps(rows); d.ui.mode = DC.M_MAN;
  if (S) d.smp = Object.fromEntries(DC.SOUNDS.map(k => [k, { id: S.id, name: 'bench', on: true }]));
  return { graph: { t: 'graph', insts: [{ id: 'i1', on: true, zone: Z, salt: 0 }], chains: [{ id: 'fx1' }], edges: [['i1', 'fx1', 1], ['fx1', 'out', 1]], out: 'out', key: 'd8' },
    patches: { i1: p }, chains: { fx1: { fxr: core.compileFx(fx, { bpm: 120, rate: SR }), fxrT: core.compileFxT(fx) } }, notes: [],
    seqs: { i1: DC.payload(d, DC.initState(), 'now') }, transport: { play: true, frame: 0, tick: 0, fpt: SR * 60 / (120 * 960), seek: true },
    assets: S ? { [S.id]: S.entry } : null };
}

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
    { id: 'l', label: 'FX: Bode with BLUR and feedback', node: 0.03, ipad: 0.02, kind: 'fx',
      build: () => fxScn(fx => { const I = fxInst(fx, 'bode', {}); I.p.blur = 0.5; I.p.feed = 0.5; I.p.shift = 0.6; I.p.mix = 0.5; }) },
    { id: 'm', label: 'FX: Splitter L/M/H with 3 EQs', node: 0.04, ipad: 0.03, kind: 'fx',
      build: () => fxScn(fx => {
        const sp = fxInst(fx, 'split3', {});
        for (let b = 0; b < 3; b++) fxInst(fx, 'eq', {}, { splitter: sp.id, branch: b });
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
    if (B.transport) p.msg(Object.assign({ t: 'transport' }, B.transport));
    if (B.mods) { // (IMPL-2b: the track's ModCore payload; its rows' scratch destinations resolved through the scope's SxBase)
      const DI = env.SxBase.DIDX2, m = B.mods;
      for (const r of m.rows) if (r.dstId) r.vi = DI[r.dstId.toUpperCase().replace('.', '_')];
      p.msg(m);
      if (!p.mc) throw new Error('bench ' + (B.graph.key || '') + ': the ModCore payload was refused');
    }
    for (const [n, v] of B.notes) p.msg({ t: 'on', n, v });
    const L = new Float32Array(128), R = new Float32Array(128), out = [[L, R]];
    return api(() => { p.process([], out); env.advance(128); track(L, 128); }, () => -1);
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
  const rack = new env.FXDSP.FXRack(SR);
  rack.set(B.fxp, B.fxt);
  if (typeof rack.assets === 'function') rack.assets(); // (the engine's hook after stored assets, §9.5)
  const r = W.mulberry32(W.fnv1a32('bench-noise')), noise = Float64Array.from({ length: 4096 }, () => 0.25 * (2 * r() - 1));
  const L = new Float64Array(128), R = new Float64Array(128);
  let pos = 0;
  return api(() => {
    for (let i = 0; i < 128; i++) { L[i] = noise[(pos + i) & 4095]; R[i] = noise[(pos + 2048 + i) & 4095]; }
    pos = (pos + 128) & 4095;
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
// renders scenario `scn` in env: 0.25 s warm-up, then `runs` × `seconds` of audio timed (interleaved with its base when
// the row measures an overhead); every timed run must be audible (and, for Granular rows, have grains sounding) or it
// throws: a silent run times nothing. → {load (median), loads, peak, worst (slowest quantum / quantum time, timed runs
// of the row itself)}
export function measure(scn, env, o = {}) {
  const runs = o.runs || 5, seconds = o.seconds || 1, now = env.now || (() => performance.now());
  if (scn.kind === 'switch') return measureSwitch(scn, env, now);
  const A = prepare(scn.build(), scn.kind, env, now), Z = scn.base ? prepare(scn.base(), scn.kind, env, now) : null;
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

export { MODELS };
