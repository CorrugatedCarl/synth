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
function fxScn(make) {
  const fx = core.defaultFx2(), extra = make(fx) || {};
  const fxp = core.compileFx(fx, { bpm: 120, rate: SR }), fxt = core.compileFxT(fx);
  return Object.assign({ fx, fxp, fxt }, extra);
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
    for (const [n, v] of B.notes) p.msg({ t: 'on', n, v });
    const L = new Float32Array(128), R = new Float32Array(128), out = [[L, R]];
    return api(() => { p.process([], out); env.advance(128); track(L, 128); }, () => -1);
  }
  if (kind === 'voice') {
    const p = env.mk({ os: 2, hostOS: 4, offline: true });
    p.msg({ t: 'patch', p: B.patch });
    sendTables(p, B.patch);
    for (const [n, v] of B.notes) p.msg({ t: 'on', n, v });
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
