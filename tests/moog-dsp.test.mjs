// The 900-series circuits (stage 9 lane V9b; IMPL-9 §3.4, §3.5, §8.1): moog-dsp.js → PatchMoog, every module alone and in small
// graphs at 48 kHz × 4 and 44.1 kHz × 2 against RM's targets (docs/canvas/research-moog-modules.md §5; the values as modelled:
// RM §10) — the converter's 1 V/oct and its sums, the levels, the ranges, the 921B's sync (STRONG / WEAK lock ranges) and linear
// FM, the 921's clamp, the 904A's slope / whistle / ranges / tracking / passband loss, the 911's segments, the 902's laws, the
// 907A's centres / skirts / flatness, the 923's spectra, the 995, the controller (priority, glide, triggers, velocity, the
// converters' one threshold, the mixer, og), the rails — the bandlimiting (a 4 kHz saw, exponential FM, a hard-synced and a
// clamped train) and the module contracts (block = per sample, the output mask, determinism, reset, rates, hostile values, no
// NaN / subnormal). Unit tests run on `rig`, a minimal host doing the evaluator's duties as patch-dsp.js's header defines them;
// the graph-level ones (K9's starting patches, the headroom, multiples, feedback, span invariance, no allocation, the CPU)
// run on lane V9a's evaluator itself (patch-dsp.js → PatchDSP) with lane K9's tables (moog-core.js, patch-core.js).
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dspScope, source, noAlloc } from './dsp-scope.mjs';
import * as MG from '../moog-core.js?v=9';
import * as PT from '../patch-core.js?v=9';

const SRC = source('moog-dsp.js');
const LIBS = new Map();
function lib(src = SRC, key = '') {
  if (!LIBS.has(key)) {
    const sc = dspScope({ files: [], fast: true, sampleRate: 48000 });
    sc.run(src, 'moog-dsp.js');
    LIBS.set(key, { sc, PM: sc.global('PatchMoog') });
  }
  return LIBS.get(key);
}
// the worklet's pair: patch-dsp.js and moog-dsp.js in one scope
function libM() {
  if (!LIBS.has('machine')) {
    const sc = dspScope({ files: [], fast: true, sampleRate: 48000 });
    sc.run(source('patch-dsp.js'), 'patch-dsp.js'); sc.run(SRC, 'moog-dsp.js');
    LIBS.set('machine', { sc, PD: sc.global('PatchDSP'), PM: sc.global('PatchMoog') });
  }
  return LIBS.get('machine');
}
const PM = () => lib().PM;
const dB = x => 20 * Math.log10(Math.max(1e-300, x));
const near = (a, b, rel) => Math.abs(a - b) <= rel * Math.abs(b);
const cents = (f, g) => 1200 * Math.log2(f / g);
const absMax = (a, i0 = 0, i1 = a.length) => { let m = 0; for (let i = i0; i < i1; i++) m = Math.max(m, Math.abs(a[i])); return m; };
const C4 = 261.6255653005986;
const plain = x => JSON.parse(JSON.stringify(x));          // (the scope's arrays and objects are another realm's)
const eq = (a, b, m) => assert.deepEqual(plain(a), plain(b), m);
const INST = () => ({ bend: 0, wheel: 0, at: 0, sustain: false });

/* ---------------------------------------------------------------- a minimal host of the base shape (patch-dsp.js's duties) */
// mods [[n, type, drv?]] (n 0 = the controller), cords [[aN, 'jack', bN, 'jack']] (an output and an input, either order; the
// multiples are the evaluator's: tested over PatchDSP), pv { n: { id: value } }, drive [[n, 'jack', number | fn(sample index
// from 0)]] (a test signal on an input), taps [[n, 'jack']] (outputs recorded), inst (the controller's bend / wheel / at /
// sustain). As patch-dsp.js: the knobs' glide (one-pole 6 ms a chunk, settled at 1e-6; a switch and a fresh module jump) and
// `mv`, flush() every 32nd absolute chunk then ctl once a chunk, normals, the 921A → 921B link, the output mask, MAIN OUT × og
// (linear across a chunk where og moved); nodes (module, section) in topological order — a cycle (or perSample) → every node
// per sample in that order, its back-edges one sample late.
function rig({ base = 48000, os = 4, mods, cords = [], pv = {}, drive = [], taps = [], salt = 0, P = PM(), perSample = false, inst = INST() }) {
  const fs = base * os, CH = 4 * os, kG = 1 - Math.exp(-4 / (base * 0.006));
  const M = new Map(), TY = new Map(), fresh = new Set();
  for (const [n, type] of mods) { M.set(n, new P.T[type]({ fs, OS: os, n, salt, inst, type })); TY.set(n, type); fresh.add(n); }
  const J = (n, id) => { const k = P.JACKS[TY.get(n)].findIndex(j => j.id === id); if (k < 0) throw new Error(`no jack ${id} on ${TY.get(n)}`); return k; };
  const jk = (n, k) => P.JACKS[TY.get(n)][k];
  const setv = (n, id, v) => { const s = P.PARAMS[TY.get(n)].findIndex(p => p[0] === id); if (s < 0) throw new Error(`no param ${id}`); M.get(n).t[s] = v; };
  for (const [n, o] of Object.entries(pv)) for (const [id, v] of Object.entries(o)) setv(+n, id, v);
  const bind = new Map();                                  // 'n:ii' → { n, oi, sec, dsec }
  for (const [aN, aId, bN, bId] of cords) {
    const ka = J(aN, aId), kb = J(bN, bId), da = jk(aN, ka).dir, db = jk(bN, kb).dir;
    let s, d;
    if (da === 'out' && db === 'in') { s = [aN, ka]; d = [bN, kb]; } else if (db === 'out' && da === 'in') { s = [bN, kb]; d = [aN, ka]; } else throw new Error('rig: an output to an input (the multiples are the evaluator\'s)');
    bind.set(d[0] + ':' + P.IO[TY.get(d[0])].ii[d[1]], { n: s[0], oi: P.IO[TY.get(s[0])].oi[s[1]], sec: jk(...s).sec, dsec: jk(...d).sec });
  }
  const dmap = new Map();                                  // 'n:ii' → a test signal's buffer
  const drv = drive.map(([n, id, f]) => { const b = new Float64Array(P.BL); dmap.set(n + ':' + P.IO[TY.get(n)].ii[J(n, id)], b); return { b, f }; });
  for (const [n, type] of TY) P.JACKS[type].forEach((j, k) => {   // an unpatched input reads its normal's source
    if (!j.norm) return;
    const io = P.IO[type], key = n + ':' + io.ii[k], has = x => bind.has(n + ':' + io.ii[x]) || dmap.has(n + ':' + io.ii[x]);
    if (bind.has(key) || dmap.has(key)) return;
    let x = J(n, j.norm); while (x >= 0 && !has(x)) { const nj = P.JACKS[type][x].norm; x = nj ? J(n, nj) : -1; }
    if (x < 0) return;
    const kx = n + ':' + io.ii[x];
    if (dmap.has(kx)) dmap.set(key, dmap.get(kx)); else bind.set(key, Object.assign({}, bind.get(kx), { dsec: j.sec }));
  });
  for (const [n, type, d] of mods) if (P.LINK[type] && d !== undefined && d >= 0) {   // the rear link: after the jacks' slots
    const nIn = P.JACKS[type].filter(j => j.dir === 'in').length, nOut = P.JACKS[P.LINK[type].from].filter(j => j.dir === 'out').length;
    P.LINK[type].def.forEach((_, k) => bind.set(n + ':' + (nIn + k), { n: d, oi: nOut + k, sec: 0, dsec: 0 }));
  }
  for (const m of M.values()) m.om = 0;
  for (const [key, b] of dmap) { const [n, ii] = key.split(':').map(Number); M.get(n).ins[ii] = b; }
  for (const [key, b] of bind) { const [n, ii] = key.split(':').map(Number); M.get(n).ins[ii] = M.get(b.n).outs[b.oi]; M.get(b.n).om |= 2 ** b.oi; }
  const tap = taps.map(([n, id]) => { const oi = P.IO[TY.get(n)].oi[J(n, id)]; M.get(n).om |= 2 ** oi; return { m: M.get(n), oi }; });
  // the schedule: a section is a node when a slot is in it (the controller's OUT: the sink, the host's)
  const nodes = [];
  for (const n of [...M.keys()].sort((a, b) => a - b)) {
    const type = TY.get(n), L = P.LINK[type] ? 1 : Object.values(P.LINK).some(x => x.from === type) ? 1 : 0;
    for (let s = 0; s < P.SECS[type]; s++) if ((s === 0 && L) || P.JACKS[type].some(j => j.sec === s && j.dir !== 'any')) nodes.push(n * 8 + s);
  }
  const E = [];
  for (const [key, b] of bind) E.push([b.n * 8 + b.sec, +key.split(':')[0] * 8 + b.dsec, key, b]);
  const indeg = new Map(nodes.map(v => [v, 0]));
  for (const [a, d] of E) if (a !== d) indeg.set(d, indeg.get(d) + 1);
  const order = [], done = new Set();
  let ready = nodes.filter(v => indeg.get(v) === 0);
  while (ready.length) { ready.sort((a, b) => a - b); const v = ready.shift(); order.push(v); done.add(v); for (const [a, d] of E) if (a === v && a !== d) { indeg.set(d, indeg.get(d) - 1); if (indeg.get(d) === 0) ready.push(d); } }
  const loop = perSample || order.length < nodes.length || E.some(([a, d]) => a === d);
  for (const v of nodes) if (!done.has(v)) order.push(v);
  const pos = new Map(order.map((v, k) => [v, k]));
  const back = [];
  if (loop) for (const [a, d, key, b] of E) if (pos.get(a) >= pos.get(d)) {
    const [n, ii] = key.split(':').map(Number), z = new Float64Array(P.BL), src = M.get(b.n).outs[b.oi];
    M.get(n).ins[ii] = z; back.push({ z, src, last: 0 });
  }
  const ctl = M.get(0) || null, sinkK = ctl ? P.IO.ctl.ii[J(0, P.SINK)] : -1;
  const steps = order.map(v => (ctl && v === 6 ? null : [M.get(v >> 3), v & 7]));
  let F = 0, S = 0, g0 = NaN;
  return {
    M, fs, CH, loop, back, setv, inst,
    // n base frames (a multiple of 4) → { y (MAIN OUT × og at the OS rate), t: [tap arrays] }; notes [[frame, key, v, on]]
    // (absolute frames, applied at their chunk), each(F, M, inst) before every chunk
    render(nF, { notes = [], each } = {}) {
      const N = nF * os, y = new Float64Array(N), t = tap.map(() => new Float64Array(N));
      let e = 0;
      while (e < notes.length && notes[e][0] < F) e++;
      for (let c = 0; c < nF / 4; c++, F += 4) {
        while (e < notes.length && notes[e][0] <= F) { const [, k, v, on] = notes[e++]; ctl.note(k, v, on); }
        if (each) each(F, M, inst);
        for (const d of drv) { if (typeof d.f === 'number') d.b.fill(d.f); else for (let i = 0; i < CH; i++) d.b[i] = d.f(S + i); }
        const cc = F / 4;
        if ((cc & 31) === 0) for (const m of M.values()) m.flush();
        for (const [n, m] of M) {                          // the knobs' glide (the evaluator's): mv = 1 when a value moved
          let mv = 0;
          const p = m.p, tt = m.t, sn = P.PARAMS[TY.get(n)];
          for (let k = 0; k < p.length; k++) {
            if (p[k] === tt[k]) continue;
            if (fresh.has(n) || sn[k][2] === 1) p[k] = tt[k];
            else { let v = p[k] + (tt[k] - p[k]) * kG; if (Math.abs(tt[k] - v) < 1e-6 * (1 + Math.abs(tt[k]))) v = tt[k]; p[k] = v; }
            mv = 1;
          }
          if (fresh.has(n)) { mv = 1; fresh.delete(n); }
          m.mv = mv;
          m.ctl(cc);
        }
        const g1 = ctl ? ctl.og : 0, ga = g0 === g0 ? g0 : g1, c0 = c * CH, x = ctl ? ctl.ins[sinkK] : null;
        if (!loop) for (const st of steps) { if (st === null) { for (let i = 0; i < CH; i++) y[c0 + i] += x[i] * (ga + (g1 - ga) * (i + 1) / CH); } else st[0].run(st[1], 0, CH); }
        else for (let i = 0; i < CH; i++) {
          for (const b of back) b.z[i] = i > 0 ? b.src[i - 1] : b.last;
          for (const st of steps) { if (st === null) y[c0 + i] += x[i] * (ga + (g1 - ga) * (i + 1) / CH); else st[0].run(st[1], i, 1); }
        }
        g0 = g1;
        for (const b of back) b.last = b.src[CH - 1];
        tap.forEach((q, k) => t[k].set(q.m.outs[q.oi].subarray(0, CH), c * CH));
        S += CH;
      }
      return { y, t };
    },
  };
}
// one module alone: its values, test signals on its inputs, its outputs tapped
function solo(type, { pv = {}, drive = [], taps = [], base = 48000, os = 4, P = PM() } = {}) {
  return rig({ base, os, P, mods: [[1, type]], pv: { 1: pv }, drive: drive.map(d => [1, d[0], d[1]]), taps: taps.map(id => [1, id]) });
}
const frames = (sec, base = 48000) => Math.round(sec * base / 4) * 4;

/* ---------------------------------------------------------------- the evaluator (V9a) with K9's tables */
// a machine on a payload: { mc, inst, errs, render(nF, { notes, span(F) → frames, each(F, inst) }) → MAIN OUT at the OS rate }
function machine({ base = 48000, os = 4, pg, pv, salt = 0, F0 = 0 }) {
  const { PD } = libM(), errs = [];
  const inst = { OS: os, fs: base * os, salt, bend: 0, wheel: 0, at: 0, sustain: false, ptFail(w) { errs.push(w); } };
  const mc = PD.create(inst, 'moog');
  mc.set(pv);
  const g = mc.graph(pg);
  let F = F0;
  const buf = new Float64Array(128 * os);
  return {
    mc, inst, errs, g,
    render(nF, { notes = [], span = () => 128, each } = {}) {
      const y = new Float64Array(nF * os), end = F + nF;
      let e = 0, o = 0;
      while (e < notes.length && notes[e][0] < F) e++;
      while (F < end) {
        while (e < notes.length && notes[e][0] <= F) { const [, k, v, on] = notes[e++]; mc.note(k, v, on); }
        if (each) each(F, inst);
        let n = Math.min(128, span(F), end - F);
        if (e < notes.length) n = Math.min(n, notes[e][0] - F);
        n = Math.max(4, n - (n % 4));
        buf.fill(0, 0, n * os); mc.render(buf, n * os, F);
        y.set(buf.subarray(0, n * os), o); o += n * os; F += n;
      }
      return y;
    },
  };
}
// one of K9's starting patches on a fresh 900 Series (patch-core loadPreset → payload; moog-core pvOf)
function presetM(name, o = {}) {
  const r = PT.loadPreset(PT.fresh('moog'), {}, name), { pg } = PT.payload(r.rec, 'moog');
  return Object.assign(machine(Object.assign({ pg, pv: MG.pvOf(r.vals) }, o)), { rec: r.rec, vals: r.vals });
}
// a payload by hand: mods [[n, type, drv?]], cords [[aN, 'jack', bN, 'jack']] → pg (ports by jack id), pv { '0': {…}, 'm<n>': {…} }
function payloadOf(mods, cords, vals = {}) {
  const P = PM(), TY = new Map([[0, 'ctl'], ...mods.map(([n, t]) => [n, t])]), port = (n, id) => P.JACKS[TY.get(n)].findIndex(j => j.id === id);
  const pg = { v: 1, f: 'moog', mods: [[0, 'ctl', -1], ...mods.filter(m => m[0] !== 0).map(([n, t, d]) => [n, t, d === undefined ? -1 : d])],
    cords: cords.map(([a, ai, b, bi]) => [a, port(a, ai), b, port(b, bi), 1]) };
  const pv = { 0: Object.assign({}, vals[0] || {}) };
  for (const [n, t] of mods) if (n !== 0) pv['m' + n] = Object.assign({ _t: t }, vals[n] || {});
  return { pg, pv };
}

/* ---------------------------------------------------------------- analysis */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a), h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < h; j++) {
        const xr = re[i + j + h] * cr - im[i + j + h] * ci, xi = re[i + j + h] * ci + im[i + j + h] * cr;
        re[i + j + h] = re[i + j] - xr; im[i + j + h] = im[i + j] - xi; re[i + j] += xr; im[i + j] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
// magnitude spectrum (dB) of x[off … off + N) with a Blackman–Harris window (N a power of two)
function specDb(x, off, N) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) { const a = 2 * Math.PI * i / (N - 1); re[i] = x[off + i] * (0.35875 - 0.48829 * Math.cos(a) + 0.14128 * Math.cos(2 * a) - 0.01168 * Math.cos(3 * a)); }
  fft(re, im);
  const d = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) d[k] = dB(Math.hypot(re[k], im[k]));
  return d;
}
// the alias measure (serum-dsp's §10.1 form): the largest bin below 20 kHz farther than 8 bins from every harmonic of f0, dB
// re the largest component
function aliasDb(x, off, fs, f0, N = 1 << 17) {
  const d = specDb(x, off, N), bin = fs / N;
  let top = -Infinity; for (let k = 2; k < N / 2; k++) top = Math.max(top, d[k]);
  let worst = -Infinity, at = 0;
  for (let k = 12; k * bin < 20000; k++) {
    const hk = Math.round(k * bin / f0);
    if (Math.abs(k - hk * f0 / bin) <= 8) continue;
    if (d[k] > worst) { worst = d[k]; at = k * bin; }
  }
  return { db: worst - top, at };
}
// rising zero crossings (interpolated) of y over [i0, i1) → the mean frequency
function zcF(y, fs, i0 = 0, i1 = y.length) {
  let first = -1, last = -1, n = 0;
  for (let i = Math.max(1, i0); i < i1; i++) if (y[i - 1] < 0 && y[i] >= 0) { const t = i - 1 - y[i - 1] / (y[i] - y[i - 1]); if (first < 0) first = t; last = t; n++; }
  return (n - 1) / ((last - first) / fs);
}
const rms = (y, i0 = 0, i1 = y.length) => { let s = 0; for (let i = i0; i < i1; i++) s += y[i] * y[i]; return Math.sqrt(s / (i1 - i0)); };
// a sine's amplitude at f (a single-bin DFT over whole cycles of [i0, i1))
function amp(y, fs, f, i0, i1) {
  const L = Math.floor((i1 - i0) * f / fs) * fs / f | 0;
  let re = 0, im = 0;
  for (let i = 0; i < L; i++) { const p = 2 * Math.PI * f * i / fs; re += y[i0 + i] * Math.cos(p); im += y[i0 + i] * Math.sin(p); }
  return 2 * Math.hypot(re, im) / L;
}

/* ---------------------------------------------------------------- the module */
// the contract's tables (§2.2, §2.4: moog-core's ids and order — K9's moog-core.test cross-checks PatchMoog too)
const T_JACKS = {
  ctl: 'kp1 kp2 ks1 ks2 kg kv kw ka m1 m2 m3 m4 mo mn a1 a2 a3 a4 b1 b2 b3 b4 vi vo si so out',
  921: 'f1 f2 f3 w1 w2 cv cs xm xp sin tri saw rec', '921a': 'f1 f2 f3 w1 w2', '921b': 'dc ac sy sin tri saw rec',
  923: 'wh1 wh2 pk li lo hi ho', '904a': 'in c1 c2 c3 out', '907a': 'in out', 911: 'trg out', 902: 'i1 i2 o1 o2 c1 c2 c3',
  995: 'i1 o1 i2 o2 i3 o3',
};
const T_PARAMS = {
  ctl: 'gl:0 pr:0:1 rt:0:1 tu:0 x1:7 x2:7 x3:7 x4:7 ov:7', 921: 'sp:0:1 cr:1:1 fq:0 rg:2:1 pw:50 ax:2:1 cl:0 al:5', '921a': 'sp:0:1 fq:0 pw:50',
  '921b': 'rg:3:1 fq:0 ss:1:1', 923: 'lp:5 hp:5', '904a': 'fc:0 rg:1:1 re:0', '907a': 'lo:10 b1:10 b2:10 b3:10 b4:10 b5:10 b6:10 b7:10 b8:10 hi:10',
  911: 't1:1 t2:5 t3:4 es:7', 902: 'md:0:1 fc:0', 995: 'a1:0 a2:0 a3:0',
};
test('PatchMoog: the frozen global in patch-dsp.js\'s family form — the ten types in moog-core\'s order, JACKS (jack objects), SECS (counts), PARAMS ([id, def, snap?]), SINK, LINK, the evaluator\'s slots (IO); moog-core\'s tables agree; every class has the base shape', () => {
  const P = PM();
  assert.ok(P && Object.isFrozen(P) && Object.isFrozen(P.T) && Object.isFrozen(P.JACKS) && Object.isFrozen(P.JACKS['921']) && Object.isFrozen(P.JACKS['921'][0]));
  assert.equal(P.id, 'moog'); assert.equal(P.CTL, 'ctl'); assert.equal(P.SINK, 'out'); assert.equal(P.OUT_K, 0.15); assert.equal(P.BL, 32);
  eq(P.ORDER, ['ctl', '921', '921a', '921b', '923', '904a', '907a', '911', '902', '995']);
  for (const t of P.ORDER) {
    eq(P.JACKS[t].map(j => j.id), T_JACKS[t].split(' '), t);
    eq(P.PARAMS[t].map(p => p.join(':')), T_PARAMS[t].split(' '), t);
    eq(P.RANGE[t].length, P.PARAMS[t].length);
  }
  eq(P.JACKS.ctl.map(j => j.sec), [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 5, 5, 6]);
  eq(P.JACKS['923'].map(j => j.sec), [0, 0, 0, 1, 1, 2, 2]); eq(P.JACKS['995'].map(j => j.sec), [0, 0, 1, 1, 2, 2]);
  eq(P.ORDER.map(t => P.SECS[t]), [7, 1, 1, 1, 3, 1, 1, 1, 1, 3]);
  eq(P.JACKS['995'].map(j => j.norm || ''), ['', '', 'i1', '', 'i2', '']);
  eq(P.ORDER.flatMap(t => P.JACKS[t].filter(j => j.ac).map(j => t + '.' + j.id)), ['921b.ac']);
  eq(P.ORDER.flatMap(t => P.JACKS[t].filter(j => j.sig === 's').map(j => t + '.' + j.id)), ['ctl.ks1', 'ctl.ks2', 'ctl.vo', 'ctl.si', '921.cs', '911.trg']);
  eq(P.LINK, { '921b': { from: '921a', def: [0, 0] } });
  // the evaluator's slots: 'in' jacks then the link's inputs, 'out' jacks then the link's outputs; the multiples none
  const C = P.IO.ctl;
  eq([C.nIn, C.nOut], [7, 12]);
  eq(['m1', 'm2', 'm3', 'm4', 'vi', 'si', 'out'].map(id => C.ii[P.JACKS.ctl.findIndex(j => j.id === id)]), [0, 1, 2, 3, 4, 5, 6]);
  eq(['vo', 'so', 'a1', 'b4'].map(id => C.oi[P.JACKS.ctl.findIndex(j => j.id === id)]), [10, 11, -1, -1]);
  eq([P.IO['921a'].nOut, P.IO['921a'].nIn, P.IO['921b'].nIn, P.IO['921b'].nOut], [2, 5, 5, 4]);
  for (const t of P.ORDER) {
    const m = new P.T[t]({ fs: 192000, OS: 4, n: 3, salt: 0, inst: null, type: t });
    for (const f of ['flush', 'ctl', 'run', 'setOS', 'reset', 'setSalt']) assert.equal(typeof m[f], 'function', `${t}.${f}`);
    assert.equal(m.ins.length, P.IO[t].nIn); assert.equal(m.outs.length, P.IO[t].nOut);
    assert.ok(m.ins.every(b => b === P.Z) && m.outs.every(b => Object.prototype.toString.call(b) === '[object Float64Array]' && b.length === 32), t);
    eq([...m.t], P.PARAMS[t].map(p => p[1])); eq([...m.p], [...m.t]);
    assert.equal(m.mv, 1); assert.equal(m.om, 2 ** P.IO[t].nOut - 1, `${t}: every output by default`);
  }
  assert.equal(typeof new P.T.ctl({ fs: 192000, OS: 4, n: 0 }).note, 'function');
  // moog-core's tables (K9): ids, sections, defaults, directions, plugs, normals, AC, section counts, CTL_IDS
  for (const t of MG.ORDER_ALL) {
    const T = MG.TYPES[t];
    eq(T.jacks.map(j => [j.id, j.dir, j.sig, j.sec, j.norm || '', j.ac ? 1 : 0]), P.JACKS[t].map(j => [j.id, j.dir, j.sig, j.sec, j.norm || '', j.ac ? 1 : 0]), t);
    eq(T.params.map(c => [c.id, c.def, c.t === 's' ? 1 : 0]), P.PARAMS[t].map(p => [p[0], p[1], p[2] || 0]), t);
    eq(T.params.map(c => (c.t === 's' ? [0, c.opts.length - 1] : [c.min, c.max])), P.RANGE[t], t);
    assert.equal(T.secs.length, P.SECS[t], t);
  }
  eq(MG.CTL_IDS, P.PARAMS.ctl.map(p => p[0]));
  assert.equal(MG.FAMILY.sink, P.SINK);
});

test('the zero buffer: an evaluator\'s whole-array `ins` (every entry one zero buffer) teaches the module what "unpatched" reads — its work skipped, bit-identically; any other array teaches nothing', () => {
  const P = PM(), z = new Float64Array(32), mk = () => new P.T['921']({ fs: 192000, OS: 4, n: 1, type: '921' });
  const a = mk(); a.ins = Array.from({ length: 7 }, () => z); assert.equal(a.zb, z);
  const b = mk(), y = new Float64Array(32).fill(1); b.ins = [y, z, z, z, z, z, z]; assert.equal(b.zb, P.Z, 'mixed: not learned');
  const c = mk(); c.ins = Array.from({ length: 7 }, () => y); assert.equal(c.zb, P.Z, 'not zeros: not learned');
  // the same output whether the module skips (its zero buffer) or reads zeros (another buffer)
  const d = mk(), e = mk(), z2 = new Float64Array(32);
  d.ins = Array.from({ length: 7 }, () => z); e.ins = Array.from({ length: 7 }, () => z); e.ins[0] = z2; e.ins[5] = z2;
  for (let cc = 0; cc < 300; cc++) {
    for (const m of [d, e]) { m.ctl(cc); m.run(0, 0, 16); }
    for (let k = 0; k < 6; k++) for (let i = 0; i < 16; i++) assert.equal(d.outs[k][i], e.outs[k][i]);
  }
});

test('the maths: ex2 within 0.01 cent over ±20 oct (clamped beyond, NaN → 0 V), the rational tan within 4e-5 to 0.46π, the rails (linear −5 … +11, a C¹ knee into −6 / +12, NaN → 0), the sine within 4e-6', () => {
  const P = PM();
  let e = 0; for (let v = -20; v <= 20; v += 0.001) e = Math.max(e, Math.abs(cents(P.ex2(v), 2 ** v)));
  assert.ok(e <= 0.01, `ex2 ${e} cents`);
  assert.equal(P.ex2(45), 2 ** 20); assert.equal(P.ex2(-45), 2 ** -20); assert.equal(P.ex2(NaN), 1);
  let et = 0; for (let x = 0.001; x <= 0.46 * Math.PI; x += 0.0005) et = Math.max(et, Math.abs(P.tanp(x) / Math.tan(x) - 1));
  assert.ok(et <= 4e-5, `tan ${et}`);
  for (const x of [-5, -1, 0, 3.3, 11]) assert.equal(P.rail(x), x);
  assert.equal(P.rail(13), 12); assert.equal(P.rail(50), 12); assert.equal(P.rail(-7), -6); assert.equal(P.rail(-60), -6); assert.equal(P.rail(NaN), 0);
  for (const [a, b] of [[11, 13], [-7, -5]]) for (let x = a; x <= b; x += 0.01) {
    const d = (P.rail(x + 1e-6) - P.rail(x - 1e-6)) / 2e-6;
    assert.ok(d >= -1e-6 && d <= 1 + 1e-6 && (x > 0 ? P.rail(x) <= x : P.rail(x) >= x), `knee ${x}: slope ${d}`);
  }
  assert.ok(Math.abs((P.rail(11 + 1e-7) - P.rail(11)) / 1e-7 - 1) < 1e-4 && Math.abs((P.rail(13) - P.rail(13 - 1e-7)) / 1e-7) < 1e-4, 'C¹ at both ends of the knee');
  let es = 0; for (let p = 0; p < 1.25; p += 1e-4) es = Math.max(es, Math.abs(P.psin(p) - Math.sin(2 * Math.PI * p)));
  assert.ok(es <= 4e-6, `sine ${es}`);
});

/* ---------------------------------------------------------------- oscillators */
// a 921 / a 921B (driven or not) alone: the frequency of its sine
function f921(pv, drive = [], { os = 4, base = 48000, sec = 1 } = {}) {
  const r = solo('921', { pv, drive, taps: ['sin'], os, base }), y = r.render(frames(sec, base)).t[0];
  return zcF(y, r.fs, Math.round(0.05 * r.fs));
}
function f921b(pv, { drv = {}, drive = [], os = 4, base = 48000, sec = 1 } = {}) {
  const r = rig({ base, os, mods: [[1, '921a'], [2, '921b', 1]], pv: { 1: drv, 2: pv }, drive, taps: [[2, 'sin']] });
  const y = r.render(frames(sec, base)).t[0];
  return zcF(y, r.fs, Math.round(0.05 * r.fs));
}
test('T-OSC1: 1 V/oct over ±5 V within 0.1 cent (921 and 921A → 921B, 48 k × 4 and 44.1 k × 2); the three inputs and the knob sum; the 921A\'s span switch; a 921B\'s FREQUENCY is an interval (its own converter)', () => {
  const bad = [];
  for (const [base, os] of [[48000, 4], [44100, 2]]) for (let v = -5; v <= 5; v++) {
    const f = f921({}, [['f1', v]], { base, os, sec: v < -3 ? 2 : 0.5 }), g = f921b({}, { drive: [[1, 'f2', v]], base, os, sec: v < -3 ? 2 : 0.5 });
    if (Math.abs(cents(f, C4 * 2 ** v)) > 0.1) bad.push(`921 ${base}×${os} ${v} V: ${cents(f, C4 * 2 ** v).toFixed(3)} ct`);
    if (Math.abs(cents(g, C4 * 2 ** v)) > 0.1) bad.push(`921B ${base}×${os} ${v} V: ${cents(g, C4 * 2 ** v).toFixed(3)} ct`);
  }
  assert.deepEqual(bad, []);
  // inputs and knobs sum: f1 + f2 + f3 + FREQUENCY (±6 oct span) = one volt per octave
  const s = f921({ sp: 1, fq: -1.5 }, [['f1', 0.25], ['f2', 0.5], ['f3', 1.25]], { sec: 0.5 });
  assert.ok(Math.abs(cents(s, C4 * 2 ** 0.5)) < 0.1, `sum ${cents(s, C4 * 2 ** 0.5)}`);
  // the spans: ±12 st (fq / 6 octaves) and ±6 oct (fq octaves), on the 921 and the 921A
  assert.ok(Math.abs(cents(f921({ fq: 6 }, [], { sec: 0.5 }), 2 * C4)) < 0.1 && Math.abs(cents(f921({ fq: -3, sp: 1 }, [], { sec: 0.5 }), C4 / 8)) < 0.1);
  assert.ok(Math.abs(cents(f921b({}, { drv: { fq: 6 }, sec: 0.5 }), 2 * C4)) < 0.1 && Math.abs(cents(f921b({}, { drv: { fq: 2, sp: 1 }, sec: 0.5 }), 4 * C4)) < 0.1);
  // a 921B detuned by its FREQUENCY (fq 0.5 = +1 semitone) keeps the interval at every driver voltage
  for (const v of [-3, 0, 2]) {
    const a = f921b({}, { drive: [[1, 'f1', v]], sec: v < 0 ? 1 : 0.5 }), b = f921b({ fq: 0.5 }, { drive: [[1, 'f1', v]], sec: v < 0 ? 1 : 0.5 });
    assert.ok(Math.abs(cents(b, a) - 100) < 0.1, `${v} V: ${cents(b, a)}`);
  }
});

test('T-OSC2: the fixed outputs\' levels within 1 % (saw 1.73, sine 1.41, triangle 1.13, rectangle 1.70 Vpp, zero-mean; the saw 0.5 V RMS); the 921\'s AUX ± (the selected waveform × LEVEL / 2, the − jack inverted)', () => {
  for (const type of ['921', '921b']) {
    const r = type === '921' ? solo('921', { pv: { fq: -6 * 2.37 / 6 }, taps: ['sin', 'tri', 'saw', 'rec'] })
      : rig({ mods: [[1, '921a'], [2, '921b', 1]], pv: { 2: { fq: -6 * 2.37 / 6 } }, taps: ['sin', 'tri', 'saw', 'rec'].map(id => [2, id]) });
    const t = r.render(frames(0.5)).t, a = Math.round(0.1 * r.fs), b = t[0].length;   // ≈ 50 Hz: the corrections' share tiny
    const pp = y => { let mx = -1e9, mn = 1e9; for (let i = a; i < b; i++) { mx = Math.max(mx, y[i]); mn = Math.min(mn, y[i]); } return [mx - mn, (mx + mn) / 2]; };
    [[1.41, 'sine'], [1.13, 'triangle'], [1.732, 'saw'], [1.70, 'rectangle']].forEach(([v, nm], k) => {
      const [p, mid] = pp(t[k]);
      assert.ok(near(p, v, 0.01) && Math.abs(mid) < 0.01 * v, `${type} ${nm}: ${p} Vpp, centre ${mid}`);
    });
    const f = zcF(t[0], r.fs, a), L = Math.round(r.fs / f * Math.floor((b - a) * f / r.fs));
    assert.ok(near(rms(t[2], a, a + L), 0.5, 0.01), `${type} saw RMS ${rms(t[2], a, a + L)}`);
  }
  for (const [ax, al, sg] of [[0, 4, 1], [1, 7, 1], [2, 10, 1], [3, 10, -1], [4, 2, 1], [5, 6, -1]]) {
    const r = solo('921', { pv: { ax, al, fq: -2 }, taps: ['xp', 'xm', ['sin', 'tri', 'saw', 'saw', 'rec', 'rec'][ax]] });
    const t = r.render(frames(0.3)).t, a = Math.round(0.05 * r.fs);
    let e = 0, e2 = 0; for (let i = a; i < t[0].length; i++) { e = Math.max(e, Math.abs(t[0][i] - sg * al / 2 * t[2][i])); e2 = Math.max(e2, Math.abs(t[1][i] + t[0][i])); }
    assert.ok(e < 1e-12 && e2 === 0, `AUX ${ax}: ${e} ${e2}`);
  }
  const x = solo('921', { pv: { al: 10 }, taps: ['xp'] }).render(frames(0.1)).t[0];
  assert.ok(near(absMax(x, 2000), 4.33, 0.01), `the saw's AUX at 10: ±${absMax(x, 2000)} V (≈ ±4 V)`);
});

test('T-OSC3: the ranges — 921B LO (2 … 8 Hz over its knob) 32′ 16′ 8′ 4′ 2′, the 921\'s 32′ … 1′, SUB-AUDIO 10 octaves down; the frequency clamped at 0.45·fs (one wrap a sample at most)', () => {
  const bad = [];
  [-6, -2, -1, 0, 1, 2].forEach((o, rg) => {
    const f = f921b({ rg }, { sec: rg === 0 ? 4 : 0.5 });
    if (Math.abs(cents(f, C4 * 2 ** o)) > 0.5) bad.push(`921B range ${rg}: ${f} Hz`);
  });
  const lo = [f921b({ rg: 0, fq: -6 }, { sec: 4 }), f921b({ rg: 0, fq: 6 }, { sec: 4 })];
  if (!near(lo[0], 2.044, 0.003) || !near(lo[1], 8.176, 0.003)) bad.push(`LO ${lo}`);
  [-2, -1, 0, 1, 2, 3].forEach((o, rg) => { const f = f921({ rg }, [], { sec: 0.5 }); if (Math.abs(cents(f, C4 * 2 ** o)) > 0.5) bad.push(`921 range ${rg}: ${f}`); });
  const sub = f921({ cr: 0, rg: 5, sp: 1, fq: 1 }, [], { sec: 2 });                       // 1′ + 1 oct − 10 oct = C4 / 64
  if (Math.abs(cents(sub, C4 / 64)) > 0.5) bad.push(`SUB-AUDIO ${sub}`);
  const top = f921({ rg: 5, sp: 1, fq: 6 }, [['f1', 5]], { sec: 0.1 });                  // asks 4.3 MHz
  if (!near(top, 0.45 * 192000, 0.002)) bad.push(`the clamp ${top}`);
  assert.deepEqual(bad, []);
});

// wraps of a saw (a fall from above +0.2 V to below −0.4 V: a forward reset from past 0.62 of a cycle counts) per second
function wrapRate(y, fs, i0) {
  let hi = y[i0] > 0.2, n = 0, first = -1, last = -1;
  for (let i = i0 + 1; i < y.length; i++) { if (y[i] > 0.2) hi = true; else if (hi && y[i] < -0.4) { hi = false; n++; if (first < 0) first = i; last = i; } }
  return (n - 1) / ((last - first) / fs);
}
// a 921B (8′, undriven) synced to a 921's saw at f / (h · 2^(st / 12)): → the slave's wrap rate / the master's frequency
function syncRatio(ss, h, st, { os = 4, base = 48000 } = {}) {
  const fq = -Math.log2(h) - st / 12;
  const r = rig({ base, os, mods: [[1, '921'], [2, '921b']], pv: { 1: { sp: 1, fq }, 2: { ss } }, cords: [[1, 'saw', 2, 'sy']], taps: [[2, 'saw']] });
  const y = r.render(frames(1, base)).t[0];
  return wrapRate(y, r.fs, Math.round(0.2 * r.fs)) / (C4 * 2 ** fq);
}
test('T-OSC4: the 921B\'s sync — STRONG locks harmonics 1…6 (±0.4 semitone off each), ±6 semitones at harmonic 1 (5.5 locks, 6.5 does not, both ways); WEAK a quarter of the reach (+1.5 / −1.2 lock, +2 / −1.5 do not; harmonic 6 ±0.4 does not); OFF never; 44.1 k × 2 as 48 k × 4', () => {
  const bad = [], lock = (r, h) => Math.abs(r / h - 1) < 2e-3;
  for (let h = 1; h <= 6; h++) for (const st of [-0.4, 0.4]) { const r = syncRatio(2, h, st); if (!lock(r, h)) bad.push(`STRONG h ${h} ${st} st: ${r}`); }
  for (const st of [-5.5, 5.5]) { const r = syncRatio(2, 1, st); if (!lock(r, 1)) bad.push(`STRONG ${st} st: ${r}`); }
  for (const st of [-6.5, 6.5]) { const r = syncRatio(2, 1, st); if (lock(r, 1)) bad.push(`STRONG ${st} st locked`); }
  for (const st of [-1.2, 1.5]) { const r = syncRatio(0, 1, st); if (!lock(r, 1)) bad.push(`WEAK ${st} st: ${r}`); }
  for (const st of [-1.5, 2]) { const r = syncRatio(0, 1, st); if (lock(r, 1)) bad.push(`WEAK ${st} st locked`); }
  for (const st of [-0.4, 0.4]) { if (lock(syncRatio(0, 6, st), 6)) bad.push(`WEAK h 6 ${st} locked`); if (!lock(syncRatio(0, 2, st), 2)) bad.push(`WEAK h 2 ${st}`); }
  for (const st of [0.2, 3]) { const r = syncRatio(1, 1, st); if (!near(r, 2 ** (st / 12), 2e-3)) bad.push(`OFF ${st}: ${r}`); }
  for (const st of [-5.5, 5.5]) { const r = syncRatio(2, 1, st, { base: 44100, os: 2 }); if (!lock(r, 1)) bad.push(`44.1 k × 2 STRONG ${st}: ${r}`); }
  assert.deepEqual(bad, []);
});

test('the 921\'s clamp: a rise through +1.5 V (its sub-sample time) or an S closure resets the phase to CLAMPING POINT; re-armed only below +1.0 V; the outputs one sample late', () => {
  const P = PM(), dt = C4 / 192000, S0 = 1000;
  for (const [cl, how] of [[30, 'v'], [70, 's'], [0, 'v']]) {
    const drive = how === 'v' ? [['cv', i => (i >= S0 ? 4 : 0)]] : [['cs', i => (i >= S0 ? 1 : 0)]];
    const y = solo('921', { pv: { cl }, drive, taps: ['saw'] }).render(400).t[0];
    const u = how === 'v' ? 1.5 / 4 : 1, c = cl / 100;
    for (let k = 1; k < 5; k++) {
      const want = P.K.AS * (2 * (c + (1 - u + k) * dt) - 1);
      assert.ok(Math.abs(y[S0 + 1 + k] - want) < 1e-12, `CL ${cl} (${how}) +${k}: ${y[S0 + 1 + k]} vs ${want}`);
    }
  }
  // hysteresis: 4 → 1.2 → 4 V does not clamp again; 4 → 0.5 → 4 V does
  const seq = (lo) => i => (i < 1000 ? 0 : i < 1600 ? 4 : i < 2200 ? lo : 4);
  const a = solo('921', { pv: { cl: 50 }, drive: [['cv', seq(1.2)]], taps: ['saw'] }).render(800).t[0];
  const b = solo('921', { pv: { cl: 50 }, drive: [['cv', seq(4)]], taps: ['saw'] }).render(800).t[0];
  const c = solo('921', { pv: { cl: 50 }, drive: [['cv', seq(0.5)]], taps: ['saw'] }).render(800).t[0];
  let d1 = 0, d2 = 0; for (let i = 0; i < a.length; i++) { d1 = Math.max(d1, Math.abs(a[i] - b[i])); d2 = Math.max(d2, Math.abs(c[i] - b[i])); }
  assert.equal(d1, 0, 'no re-arm above 1 V');
  assert.ok(d2 > 0.1, 'below 1 V it clamps again');
});

test('the widths: RECTANGULAR WIDTH 10…90 % + 10 % a volt on the knob, clamped 5…95 % (921; a 921A\'s knob and inputs for its 921Bs, 50 % undriven)', () => {
  const duty = y => { let n = 0; for (let i = 0; i < y.length; i++) if (y[i] > 0) n++; return n / y.length; };
  const bad = [];
  for (const [pw, w1, want] of [[30, 0, 0.3], [50, 2, 0.7], [90, 0, 0.9], [50, 8, 0.95], [20, -5, 0.05]]) {
    const d = duty(solo('921', { pv: { pw }, drive: [['w1', w1]], taps: ['rec'] }).render(frames(0.5)).t[0].subarray(9600));
    if (Math.abs(d - want) > 0.004) bad.push(`921 ${pw} % ${w1} V: ${d}`);
  }
  for (const [pw, w2, want, drv] of [[50, 0, 0.5, false], [25, 0, 0.25, true], [50, -3, 0.2, true]]) {
    const r = rig({ mods: [[1, '921a'], [2, '921b', drv ? 1 : -1]], pv: { 1: { pw } }, drive: [[1, 'w2', w2]], taps: [[2, 'rec']] });
    const d = duty(r.render(frames(0.5)).t[0].subarray(9600));
    if (Math.abs(d - want) > 0.004) bad.push(`921B ${pw} % ${w2} V ${drv ? 'driven' : 'undriven'}: ${d}`);
  }
  assert.deepEqual(bad, []);
});

test('the 921B\'s linear FM: DC MODULATE 5 V = +100 % (−2.5 V halves it, −5 V and below stop it: no through-zero); AC MODULATE through a 10 Hz high-pass (a held voltage leaves the pitch)', () => {
  const g = (drive) => { const r = rig({ mods: [[1, '921b']], drive, taps: [[1, 'sin']] }); return zcF(r.render(frames(1)).t[0], r.fs, 96000); };
  assert.ok(near(g([[1, 'dc', 5]]), 2 * C4, 1e-5) && near(g([[1, 'dc', -2.5]]), C4 / 2, 1e-5));
  for (const v of [-5, -8]) {
    const y = rig({ mods: [[1, '921b']], drive: [[1, 'dc', v]], taps: [[1, 'saw']] }).render(frames(0.1)).t[0];
    let d = 0; for (let i = 100; i < y.length; i++) d = Math.max(d, Math.abs(y[i] - y[99]));
    assert.equal(d, 0, `${v} V: stopped`);
  }
  assert.ok(near(g([[1, 'ac', 2]]), C4, 2e-4), 'a held AC voltage: the pitch back within 0.2 %');
  // 1 V at 100 Hz through the coupler: ± 20 % · |H(100)| on the instantaneous frequency → a sideband at C4 ± 100 Hz
  const r = rig({ mods: [[1, '921b']], drive: [[1, 'ac', i => Math.sin(2 * Math.PI * 100 * i / 192000)]], taps: [[1, 'sin']] });
  const y = r.render(frames(1)).t[0];
  const side = amp(y, 192000, C4 + 100, 96000, 192000) / amp(y, 192000, C4, 96000, 192000), beta = 0.2 * C4 / 100 * 100 / Math.hypot(100, 10);
  assert.ok(near(side, beta / 2, 0.05), `the sideband ${side} vs β/2 ${beta / 2}`);
});

test('drift: the Inst\'s p.drift (the app\'s preference) walks each oscillator\'s pitch slowly — ≈ 4 cents RMS × the amount (τ 2 s), seeded by salt and module number; 0 holds the pitch exactly', () => {
  const walk = (drift, salt = 0, n = 1) => {
    const inst = Object.assign(INST(), { p: { drift } }), r = rig({ base: 48000, os: 1, salt, inst, mods: [[n, '921b']], taps: [[n, 'sin']] });
    const y = r.render(frames(60)).t[0], c = [];
    for (let k = 0; k < 120; k++) c.push(cents(zcF(y, 48000, k * 24000, (k + 1) * 24000), C4));
    return c;
  };
  const a = walk(1), b = walk(1), d = walk(1, 5), z = walk(0);
  const rmsC = Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
  assert.ok(rmsC > 2 && rmsC < 6.5, `RMS ${rmsC} cents`);
  assert.ok(a.every((x, k) => x === b[k]) && d.some((x, k) => x !== a[k]), 'seeded');
  assert.ok(z.every(x => Math.abs(x) < 0.05), 'no drift: the pitch');
  let s1 = 0, s0 = 0; for (let k = 1; k < a.length; k++) { s1 += a[k] * a[k - 1]; s0 += a[k] * a[k]; }
  assert.ok(s1 / s0 > 0.6, `slow: half-seconds correlate ${s1 / s0} (e^−¼ ≈ 0.78 for τ 2 s)`);
});

// I0, the modified Bessel function: the mean of 2^(A·sin) = I0(A ln 2)
const I0 = x => { let s = 1, t = 1; for (let k = 1; k < 60; k++) { t *= (x / (2 * k)) ** 2; s += t; } return s; };
const FM_F = 437.3;
// the bandlimiting cases (OS 4 unless asked): every output periodic at a frequency f0 that does not divide fs, so every legal
// component sits on f0's harmonics and the rest is aliasing
const ALIAS = {
  'saw 4 kHz (921B)': (P, os) => ({ f0: 4003.7, r: rig({ P, os, mods: [[1, '921a'], [2, '921b', 1]], drive: [[1, 'f1', Math.log2(4003.7 / C4)]], taps: [[2, 'saw']] }) }),
  'exponential FM ±1 oct (921 → 921A → 921B)': (P, os) => {
    const c = Math.log2(3 * FM_F / (C4 * I0(Math.LN2)));
    return { f0: FM_F, r: rig({ P, os, mods: [[1, '921'], [2, '921a'], [3, '921b', 2]], pv: { 1: { sp: 1, fq: Math.log2(FM_F / C4), ax: 0, al: 2 / P.K.AN } },
      cords: [[1, 'xp', 2, 'f1']], drive: [[2, 'f2', c]], taps: [[3, 'saw']] }) };
  },
  'hard sync (921 → 921B STRONG at 2.3×)': (P, os) => ({ f0: FM_F, r: rig({ P, os, mods: [[1, '921'], [2, '921a'], [3, '921b', 2]],
    pv: { 1: { sp: 1, fq: Math.log2(FM_F / C4) }, 3: { ss: 2 } }, cords: [[1, 'saw', 3, 'sy']], drive: [[2, 'f1', Math.log2(2.3 * FM_F / C4)]], taps: [[3, 'saw']] }) }),
  'clamp train (921 AUX saw → 921 at 2.6×, CL 25)': (P, os) => ({ f0: FM_F, r: rig({ P, os, mods: [[1, '921'], [2, '921']],
    pv: { 1: { sp: 1, fq: Math.log2(FM_F / C4), al: 10 }, 2: { sp: 1, fq: Math.log2(2.6 * FM_F / C4), cl: 25 } }, cords: [[1, 'xp', 2, 'cv']], taps: [[2, 'saw']] }) }),
};
function aliasOf(name, P = PM(), os = 4) {
  const { f0, r } = ALIAS[name](P, os), N = 1 << (os >= 4 ? 17 : 16), y = r.render(frames(0.1 + N / (48000 * os))).t[0];
  return aliasDb(y, y.length - N, r.fs, f0, N);
}
test('bandlimiting at OS 4: a 921B saw at 4 kHz — aliases below 20 kHz ≤ −60 dB re the fundamental; exponential FM at audio rate (±1 oct), a hard-synced and a clamped train ≤ −50 dB; ≥ 15 dB better than the same events uncorrected (the mutation)', () => {
  const naive = SRC.replace('bs(u, h) { const v = 1 - u; this.s0 += 0.5 * h * v * v; this.s1 -= 0.5 * h * u * u; }', 'bs(u, h) {}')
    .replace('this.s0 += hS * a; this.s1 += hS * b;', '');
  assert.notEqual(naive, SRC);
  const PN = lib(naive, 'naive').PM, rep = [], bad = [];
  for (const [name, gate] of [['saw 4 kHz (921B)', -60], ['exponential FM ±1 oct (921 → 921A → 921B)', -50], ['hard sync (921 → 921B STRONG at 2.3×)', -50], ['clamp train (921 AUX saw → 921 at 2.6×, CL 25)', -50]]) {
    const a = aliasOf(name), n = aliasOf(name, PN);
    rep.push(`${name}: ${a.db.toFixed(1)} dB at ${a.at.toFixed(0)} Hz (uncorrected ${n.db.toFixed(1)})`);
    if (!(a.db <= gate)) bad.push(`${name}: ${a.db}`);
    if (!(a.db <= n.db - 15)) bad.push(`${name}: the corrections gain only ${n.db - a.db} dB`);
  }
  console.log('# aliases (OS 4, dB re the largest component):\n# ' + rep.join('\n# '));
  assert.deepEqual(bad, []);
});

/* ---------------------------------------------------------------- 904A */
// the 904A's gain at f for a small sine (0.1 V: the stages linear), its values pv
function g904(pv, f, { base = 48000, os = 4, sec } = {}) {
  const fs = base * os, s = sec || Math.max(0.3, 12 / f);
  const r = solo('904a', { pv, base, os, drive: [['in', i => 0.1 * Math.sin(2 * Math.PI * f * i / fs)]], taps: ['out'] });
  const y = r.render(frames(s, base)).t[0];
  return amp(y, fs, f, Math.round(y.length / 2), y.length) / 0.1;
}
// the 904A whistling (a 1 V kick into its input, then nothing): the frequency and the harmonics (dB re the fundamental)
function whistle(pv, drive = [], { base = 48000, os = 4, sec = 1 } = {}) {
  const r = solo('904a', { pv: Object.assign({ re: 10 }, pv), base, os, drive: [['in', i => (i < 16 ? 1 : 0)], ...drive], taps: ['out'] });
  const y = r.render(frames(sec, base)).t[0], fs = r.fs, a = Math.round(0.6 * y.length), f = zcF(y, fs, a);
  return { f, pk: absMax(y, a), h2: dB(amp(y, fs, 2 * f, a, y.length) / amp(y, fs, f, a, y.length)), h3: dB(amp(y, fs, 3 * f, a, y.length) / amp(y, fs, f, a, y.length)) };
}
test('T-VCF1: the 904A — 24 dB/oct (± 1) two octaves above f_c; −12 dB at f_c at k 0 (the per-stage corner) on the three ranges\' ends (1 Hz … 4.1 kHz, 4 Hz … 16.4 kHz, 16 Hz … 65.5 kHz); the passband falls as 1 / (1 + k)', () => {
  const bad = [];
  for (const [base, os] of [[48000, 4], [44100, 2]]) {
    const fc = 500, v = Math.log2(fc) - 8;                                // range 2: 2^(fc + 6 + 2) Hz
    const s = dB(g904({ fc: v }, 8 * fc, { base, os })) - dB(g904({ fc: v }, 4 * fc, { base, os }));
    if (Math.abs(s + 24) > 1) bad.push(`${base}×${os}: ${s.toFixed(2)} dB/oct`);
  }
  for (const [rg, fc, f, base, os] of [[0, -6, 1, 48000, 1], [0, 6, 4096, 48000, 4], [1, -6, 4, 48000, 1], [1, 6, 16384, 48000, 4], [2, -6, 16, 48000, 1], [2, 6, 65536, 48000, 4], [1, 0, 256, 44100, 2]]) {
    const g = dB(g904({ rg, fc }, f, { base, os, sec: Math.max(0.3, 8 / f) }));
    if (Math.abs(g + 12.04) > 0.1) bad.push(`range ${rg + 1} at ${fc} V (${f} Hz): ${g.toFixed(3)} dB`);
  }
  for (const re of [0, 2.5, 5, 9]) {
    const k = 0.44 * re, g = g904({ rg: 2, re }, 20, { sec: 1 });
    if (Math.abs(dB(g) - dB(1 / (1 + k))) > 0.2) bad.push(`REGENERATION ${re}: ${dB(g).toFixed(2)} vs ${dB(1 / (1 + k)).toFixed(2)} dB`);
  }
  assert.deepEqual(bad, []);
});

test('T-VCF1: REGENERATION 10 (k 4.4) whistles a sine at the per-stage corner ± 2 % on each range (and at 44.1 k × 2), tracks 1 V/oct ± 5 cents over 3 octaves; at 9 (k 3.96, below the threshold) it does not', () => {
  const bad = [], rep = [];
  for (const [rg, f0] of [[0, 64], [1, 256], [2, 1024]]) {
    const w = whistle({ rg }); rep.push(`${f0} Hz: ${cents(w.f, f0).toFixed(2)} ct, ${w.pk.toFixed(2)} V, h2 ${w.h2.toFixed(1)} h3 ${w.h3.toFixed(1)} dB`);
    if (!near(w.f, f0, 0.02)) bad.push(`range ${rg + 1}: ${w.f}`);
    if (!(w.h2 < -30 && w.h3 < -20)) bad.push(`range ${rg + 1} not a sine: ${w.h2} ${w.h3}`);
  }
  const w44 = whistle({ rg: 1 }, [], { base: 44100, os: 2 });
  if (!near(w44.f, 256, 0.02)) bad.push(`44.1 k × 2: ${w44.f}`);
  const f0 = whistle({ rg: 0 }).f;
  for (const v of [1, 2, 3]) { const f = whistle({ rg: 0 }, [['c1', v]]).f; rep.push(`+${v} V ${cents(f, f0 * 2 ** v).toFixed(2)} ct`); if (Math.abs(cents(f, f0 * 2 ** v)) > 5) bad.push(`tracking +${v} V: ${cents(f, f0 * 2 ** v)} ct`); }
  const q = solo('904a', { pv: { rg: 1, re: 9 }, drive: [['in', i => (i < 16 ? 1 : 0)]], taps: ['out'] }).render(frames(1)).t[0];
  const p1 = absMax(q, 0.4 * q.length, 0.6 * q.length), p2 = absMax(q, 0.8 * q.length, q.length);
  if (!(p2 < 0.5 * p1 && p1 < 0.05)) bad.push(`REGENERATION 9 rings on: ${p1} → ${p2} V`);
  console.log('# the whistle: ' + rep.join(' · '));
  assert.deepEqual(bad, []);
});

test('the 904A at its limits: f_c clamped at 0.46·fs (every control input at +12 V, k 4.4) — finite, inside the rails; a loud input (±10 V) saturates softly', () => {
  const r = solo('904a', { pv: { fc: 6, rg: 2, re: 10 }, drive: [['c1', 12], ['c2', 12], ['c3', 12], ['in', i => 10 * Math.sin(i * 0.01)]], taps: ['out'] });
  const y = r.render(frames(0.2)).t[0];
  assert.ok(y.every(Number.isFinite) && absMax(y) <= 12);
  const z = g904({ rg: 2 }, 200);
  const loud = solo('904a', { pv: { rg: 2 }, drive: [['in', i => 10 * Math.sin(2 * Math.PI * 200 * i / 192000)]], taps: ['out'] }).render(frames(0.3)).t[0];
  const gl = amp(loud, 192000, 200, 28800, loud.length) / 10;
  assert.ok(gl < z && gl > 0.3 * z, `the ladder compresses a 10 V input (${gl} vs ${z})`);
});

/* ---------------------------------------------------------------- 911 */
// a 911 alone (48 k × 1 unless asked): its S line from gate(i), its output
function env911(pv, gate, sec, { base = 48000, os = 1 } = {}) {
  const r = solo('911', { pv, base, os, drive: [['trg', gate]], taps: ['out'] });
  return { y: r.render(frames(sec, base)).t[0], fs: r.fs };
}
test('T-EG1: the 911 — T1 / T2 / T3 2 ms … 10 s ± 5 % (LAW: 0.002 · 5000^(v / 10) s; T1 from 0 V to Emax on the log charge curve, T2 / T3 four time constants), Emax 5.5 V, E SUS 0.55 V a step; an opening → T3 from any stage, a closure in T3 → T1 from there (48 k × 1 and × 4)', () => {
  const bad = [], E = 5.5, law = v => 0.002 * 5000 ** (v / 10), S0 = 480;
  for (const v of [0, 5, 10]) {
    const T = law(v), sec = T * 1.3 + 0.05;
    const a = env911({ t1: v, es: 10 }, i => (i >= S0 ? 1 : 0), sec);       // T1
    const i1 = a.y.findIndex(x => x >= E);
    if (!near((i1 - S0) / a.fs, T, 0.05)) bad.push(`T1 ${v}: ${(i1 - S0) / a.fs} s vs ${T}`);
    if (absMax(a.y) !== E) bad.push(`Emax ${absMax(a.y)}`);
    const b = env911({ t1: 0, t2: v, es: 4 }, i => (i >= S0 ? 1 : 0), law(0) + T * 1.3 + 0.05), sus = 2.2;   // T2
    const j0 = b.y.findIndex(x => x >= E), j1 = b.y.findIndex((x, i) => i > j0 && x - sus <= (E - sus) * Math.exp(-4));
    if (!near((j1 - j0) / b.fs, T, 0.05)) bad.push(`T2 ${v}: ${(j1 - j0) / b.fs} vs ${T}`);
    const S1 = Math.round(0.05 * 48000), c = env911({ t1: 0, t3: v, es: 10 }, i => (i >= S0 && i < S1 ? 1 : 0), 0.05 + T * 1.3 + 0.05);   // T3
    const k1 = c.y.findIndex((x, i) => i > S1 && x <= E * Math.exp(-4));
    if (!near((k1 - S1) / c.fs, T, 0.05)) bad.push(`T3 ${v}: ${(k1 - S1) / c.fs} vs ${T}`);
  }
  for (const es of [0, 3, 7, 10]) { const d = env911({ t1: 0, t2: 0, es }, () => 1, 0.1); if (Math.abs(d.y[d.y.length - 1] - 0.55 * es) > 1e-9) bad.push(`E SUS ${es}: ${d.y[d.y.length - 1]}`); }
  // an opening mid-T1 falls from where it was (no step); a closure mid-T3 rises from there
  const f = env911({ t1: 5, t3: 5 }, i => (i < 2400 || (i >= 4800 && i < 7200) ? 1 : 0), 0.25);
  const step = i => Math.abs(f.y[i + 1] - f.y[i]);
  if (!(f.y[2399] > 0.5 && f.y[2399] < 5 && step(2399) < 0.01 && f.y[2420] < f.y[2399])) bad.push('opening in T1');
  if (!(f.y[7199] > f.y[4799] && step(4799) < 0.01 && f.y[4801] > f.y[4800])) bad.push('closure in T3 → T1 from there');
  const g = env911({ t1: 3 }, i => (i >= 4 * S0 ? 1 : 0), 0.1, { os: 4 }), g1 = env911({ t1: 3 }, i => (i >= S0 ? 1 : 0), 0.1);
  if (!near((g.y.findIndex(x => x >= E) - 4 * S0) / g.fs, (g1.y.findIndex(x => x >= E) - S0) / g1.fs, 0.01)) bad.push('OS 4 ≠ OS 1');
  assert.deepEqual(bad, []);
});

/* ---------------------------------------------------------------- 902 */
test('T-VCA1: the 902 — LIN ∝ V (×2 at 6 V, ×2.5 at 7.5 V and above, 0 at and below 0 V); EXP ×2 at 6 V, −12 dB a volt below, 0 below −2 V; the knob and the three inputs sum; differential in (upper − lower), the upper output inverted; the rails', () => {
  const run = (pv, cv, i1 = 1, i2 = 0) => {
    const r = solo('902', { pv, drive: [['i1', i1], ['i2', i2], ['c1', cv[0] || 0], ['c2', cv[1] || 0], ['c3', cv[2] || 0]], taps: ['o1', 'o2'] });
    const t = r.render(8).t; return [t[0][31], t[1][31]];
  };
  const bad = [], chk = (nm, got, want) => { if (Math.abs(got - want) > 1e-6 * Math.abs(want) + 1e-15) bad.push(`${nm}: ${got} vs ${want}`); };   // (ex2: 1e-7)
  for (const [V, g] of [[-3, 0], [0, 0], [1.5, 0.5], [3, 1], [6, 2], [7.5, 2.5], [10, 2.5]]) chk(`LIN ${V} V`, run({}, [V])[1], g);
  chk('LIN knob 6', run({ fc: 6 }, [])[1], 2); chk('LIN 1 + 2 + 3 V', run({}, [1, 2, 3])[1], 2); chk('LIN knob −3 + 9 V', run({ fc: -3 }, [9])[1], 2);
  for (const [V, g] of [[6, 2], [5, 0.5], [4, 0.125], [8, 2], [-1.9, 2 * 4 ** -7.9], [-2.1, 0]]) chk(`EXP ${V} V`, run({ md: 1 }, [V])[1], g);
  const [o1, o2] = run({}, [6], 1, 0.25);
  chk('differential (lower out)', o2, 1.5); chk('the upper out inverted', o1, -1.5);
  chk('the rails', run({}, [7.5], 10)[1], 12); chk('the rails (−)', run({}, [7.5], 10)[0], -6);
  assert.deepEqual(bad, []);
  // EXP at audio rate: a 3 kHz sine on the control input modulates the gain per sample (sidebands at the carrier ± 3 kHz)
  const r = solo('902', { pv: { md: 1, fc: 5 }, drive: [['i1', i => Math.sin(2 * Math.PI * 1000 * i / 192000)], ['c1', i => 0.5 * Math.sin(2 * Math.PI * 3000 * i / 192000)]], taps: ['o2'] });
  const y = r.render(frames(0.2)).t[0];
  assert.ok(amp(y, 192000, 4000, 9600, y.length) > 0.1 * amp(y, 192000, 1000, 9600, y.length), 'audio-rate AM');
});

/* ---------------------------------------------------------------- 907A */
// the 907A's impulse response (1 V), its DTFT magnitude at f (dB)
function ir907(pv, { base = 48000, os = 4, sec = 0.5 } = {}) {
  const r = solo('907a', { pv, base, os, drive: [['in', i => (i === 0 ? 1 : 0)]], taps: ['out'] });
  return { h: r.render(frames(sec, base)).t[0], fs: r.fs };
}
const H907 = (ir, f) => { const w = 2 * Math.PI * f / ir.fs; let re = 0, im = 0; for (let n = 0; n < ir.h.length; n++) { re += ir.h[n] * Math.cos(w * n); im -= ir.h[n] * Math.sin(w * n); } return dB(Math.hypot(re, im)); };
const ONE907 = (k, v = 10) => Object.fromEntries(['lo', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'hi'].map((id, j) => [id, j === k ? v : 0]));
test('T-FFB1: the 907A — all at 10 flat ± 2 dB from 20 Hz to 20 kHz about unity (48 k × 4, 44.1 k × 2); the band centres 250 · √2^k Hz ± 2 %; 24 dB/oct on both skirts of a band and on the shelves (177 Hz, 4 kHz); the audio taper (5 → −18 dB, 0 → off)', () => {
  const bad = [], rep = [];
  for (const [base, os] of [[48000, 4], [44100, 2]]) {
    const ir = ir907({}, { base, os });
    let mn = 1e9, mx = -1e9, sum = 0, n = 0;
    for (let f = 20; f <= 20000; f *= 2 ** (1 / 24)) { const d = H907(ir, f); mn = Math.min(mn, d); mx = Math.max(mx, d); sum += d; n++; }
    rep.push(`${base}×${os}: ${mn.toFixed(2)} … +${mx.toFixed(2)} dB (mean ${(sum / n).toFixed(2)})`);
    if (mn < -2 || mx > 2) bad.push(`flat at ${base}×${os}: ${mn} … ${mx}`);
  }
  const FB = PM().K.FB;
  for (let b = 1; b <= 8; b++) {
    const ir = ir907(ONE907(b)), c = FB[b];
    let lo = c / 1.2, hi = c * 1.2;                                        // golden-section search of the peak in log f
    for (let it = 0; it < 40; it++) { const m1 = lo * (hi / lo) ** 0.382, m2 = lo * (hi / lo) ** 0.618; if (H907(ir, m1) > H907(ir, m2)) hi = m2; else lo = m1; }
    const pk = Math.sqrt(lo * hi);
    if (!near(pk, c, 0.02)) bad.push(`band ${b} peaks at ${pk.toFixed(1)} vs ${c.toFixed(1)}`);
    if (b <= 4) {
      const up = H907(ir, c * 16) - H907(ir, c * 8), dn = H907(ir, c / 16) - H907(ir, c / 8);
      if (Math.abs(up + 24) > 1.5 || Math.abs(dn + 24) > 1.5) bad.push(`band ${b} skirts ${up.toFixed(2)} / ${dn.toFixed(2)} dB/oct`);
    }
  }
  const L = ir907(ONE907(0)), Hh = ir907(ONE907(9));
  const sl = H907(L, 177 * 16) - H907(L, 177 * 8), sh = H907(Hh, 4000 / 16) - H907(Hh, 4000 / 8);
  if (Math.abs(sl + 24) > 1.5 || Math.abs(sh + 24) > 1.5) bad.push(`shelves ${sl.toFixed(2)} / ${sh.toFixed(2)} dB/oct`);
  if (Math.abs(H907(L, 20)) > 0.3 || Math.abs(H907(Hh, 20000)) > 0.3) bad.push(`the shelves pass at unity: ${H907(L, 20)} / ${H907(Hh, 20000)} dB`);
  const d5 = H907(ir907(ONE907(4, 5)), FB[4]) - H907(ir907(ONE907(4)), FB[4]);
  if (Math.abs(d5 - dB(0.125)) > 0.01) bad.push(`taper at 5: ${d5}`);
  if (absMax(ir907(ONE907(4, 0)).h) !== 0) bad.push('0 is off');
  console.log('# 907A at 10: ' + rep.join(' · '));
  assert.deepEqual(bad, []);
});

/* ---------------------------------------------------------------- 923 */
function psd(y, fs, N) {                                    // power spectral density (V² / Hz), Hann, Welch 50 %
  const P = new Float64Array(N / 2), w = new Float64Array(N), re = new Float64Array(N), im = new Float64Array(N);
  let segs = 0, wss = 0;
  for (let i = 0; i < N; i++) { w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); wss += w[i] * w[i]; }
  for (let o = 0; o + N <= y.length; o += N / 2) { im.fill(0); for (let i = 0; i < N; i++) re[i] = y[o + i] * w[i]; fft(re, im); for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k]; segs++; }
  for (let k = 0; k < N / 2; k++) P[k] *= 2 / (segs * wss * fs);
  return P;
}
const bandP = (P, fs, N, f0, f1) => { let s = 0; for (let k = Math.ceil(f0 * N / fs); k * fs / N < f1; k++) s += P[k]; return s * fs / N; };
test('the 923: white 0.5 V RMS at 48 k × 4 (the in-band density the same at every rate), flat ± 1.5 dB; pink −3 dB/oct ± 0.5 (63 Hz … 8 kHz), 0.5 V RMS in band ± 3 %; one source on both WHITE jacks; the LP / HP one-pole corners at 10 · 1000^(v / 10) Hz (−3 dB ± 0.2, 6 dB/oct); the noise seeded by salt and module number', () => {
  const bad = [], rep = [];
  const noise = (os, id, sec = 4, salt = 0, n = 1) => { const r = rig({ os, salt, mods: [[n, '923']], taps: [[n, id]] }); return { y: r.render(frames(sec)).t[0], fs: r.fs }; };
  const w4 = noise(4, 'wh1'), w1 = noise(1, 'wh1'), N = 1 << 15;
  if (!near(rms(w4.y), 0.5, 0.02)) bad.push(`white RMS ${rms(w4.y)}`);
  const P4 = psd(w4.y, w4.fs, N), P1 = psd(w1.y, w1.fs, N / 4);
  const ib4 = Math.sqrt(bandP(P4, w4.fs, N, 20, 20000)), ib1 = Math.sqrt(bandP(P1, w1.fs, N / 4, 20, 20000));
  if (!near(ib1, ib4, 0.03)) bad.push(`in-band white ${ib4} (OS 4) vs ${ib1} (OS 1)`);
  const dens = []; for (let f = 125; f <= 16000; f *= 2) dens.push(10 * Math.log10(bandP(P4, w4.fs, N, f / Math.SQRT2, f * Math.SQRT2) / (f / Math.SQRT2)));
  const md = dens.reduce((a, b) => a + b) / dens.length;
  if (dens.some(d => Math.abs(d - md) > 1.5)) bad.push(`white not flat: ${dens.map(d => (d - md).toFixed(2))}`);
  const pk = noise(4, 'pk'), Pp = psd(pk.y, pk.fs, N);
  const oct = [], fx = []; for (let f = 62.5; f <= 8000; f *= 2) { oct.push(10 * Math.log10(bandP(Pp, pk.fs, N, f / Math.SQRT2, f * Math.SQRT2) / f)); fx.push(Math.log2(f)); }
  const mx = fx.reduce((a, b) => a + b) / fx.length, my = oct.reduce((a, b) => a + b) / oct.length;
  const slope = fx.reduce((s, x, k) => s + (x - mx) * (oct[k] - my), 0) / fx.reduce((s, x) => s + (x - mx) ** 2, 0);
  const pin = Math.sqrt(bandP(Pp, pk.fs, N, 20, 20000));
  rep.push(`white ${rms(w4.y).toFixed(4)} V RMS (in band ${ib4.toFixed(3)}), pink ${slope.toFixed(2)} dB/oct, ${pin.toFixed(4)} V in band`);
  if (Math.abs(slope + 3) > 0.5) bad.push(`pink slope ${slope}`);
  if (!near(pin, 0.5, 0.03)) bad.push(`pink in band ${pin}`);
  const r = rig({ mods: [[1, '923']], taps: [[1, 'wh1'], [1, 'wh2']] }), t = r.render(400).t;
  if (t[0].some((x, i) => x !== t[1][i]) || PM().IO['923'].oi[0] === PM().IO['923'].oi[1]) bad.push('WHITE 1 = WHITE 2 (two slots, one buffer)');
  const a = noise(4, 'wh1', 0.01, 7), b = noise(4, 'wh1', 0.01, 7), c = noise(4, 'wh1', 0.01, 8), d = noise(4, 'wh1', 0.01, 7, 2);
  if (a.y.some((x, i) => x !== b.y[i]) || c.y.every((x, i) => x === a.y[i]) || d.y.every((x, i) => x === a.y[i])) bad.push('the seed');
  for (const [sec, id, inn] of [['lp', 'lo', 'li'], ['hp', 'ho', 'hi']]) for (const v of [0, 5, 10]) {
    const fc = 10 * 1000 ** (v / 10), probe = f => { const q = rig({ mods: [[1, '923']], pv: { 1: { [sec]: v } }, drive: [[1, inn, i => Math.sin(2 * Math.PI * f * i / 192000)]], taps: [[1, id]] }); const y = q.render(frames(Math.max(0.3, 10 / f))).t[0]; return amp(y, 192000, f, y.length >> 1, y.length); };
    const g = dB(probe(fc));
    if (Math.abs(g + 3.01) > 0.2) bad.push(`${sec} ${v}: ${g.toFixed(2)} dB at ${fc.toFixed(1)} Hz`);
    if (v === 5) { const s = sec === 'lp' ? dB(probe(fc * 16)) - dB(probe(fc * 8)) : dB(probe(fc / 16)) - dB(probe(fc / 8)); if (Math.abs(s + 6) > 0.3) bad.push(`${sec} slope ${s}`); }
  }
  console.log('# 923: ' + rep.join(' · '));
  assert.deepEqual(bad, []);
});

/* ---------------------------------------------------------------- 995 */
test('the 995: passive linear pots (o = i · a / 10, 10 = unity, 0 = off); ATTENUATOR 2 normalled to 1, 3 to 2 (the series chain): one source, three levels', () => {
  const r = rig({ mods: [[1, '995']], pv: { 1: { a1: 10, a2: 5, a3: 2.5 } }, drive: [[1, 'i1', i => Math.sin(i * 0.01)]], taps: [[1, 'o1'], [1, 'o2'], [1, 'o3']] });
  const t = r.render(64).t;
  for (let i = 0; i < t[0].length; i++) { assert.equal(t[0][i], Math.sin(i * 0.01)); assert.equal(t[1][i], t[0][i] * 0.5); assert.equal(t[2][i], t[0][i] * 0.25); }
  const q = rig({ mods: [[1, '995']], pv: { 1: { a1: 0, a2: 10, a3: 10 } }, drive: [[1, 'i1', 3], [1, 'i2', -2]], taps: [[1, 'o1'], [1, 'o2'], [1, 'o3']] }).render(8).t;
  assert.deepEqual([q[0][5], q[1][5], q[2][5]], [0, -2, -2], 'i2 patched: i3 follows i2, not i1');
});

/* ---------------------------------------------------------------- the controller */
const KBD = ['kp1', 'ks1', 'kg', 'kv', 'kw', 'ka'];
function kbd(notes, { pv = {}, each, nF = 2400, drive = [], taps = KBD } = {}) {
  const r = rig({ mods: [[0, 'ctl']], pv: { 0: pv }, drive: drive.map(d => [0, d[0], d[1]]), taps: taps.map(id => [0, id]) });
  const t = r.render(nF, { notes, each }).t;
  return Object.fromEntries(taps.map((id, k) => [id, t[k]]));
}
const at = (y, F) => y[F * 4 + 2];                          // a sample inside the chunk at base frame F (OS 4)
test('the controller\'s keyboard (§3.5): LOW priority (the lowest held key; a release falls to the next lowest) and LAST (the most recent; a release falls back); PITCH (key − 60) / 12 + bend / 12 + TUNE / 1200; S-TRIG and GATE while a key is held, the sustain pedal holding them; VELOCITY 5·v latched at each note-on; WHEEL / PRESSURE 5·x (the Inst\'s, per chunk)', () => {
  let k = kbd([[0, 60, 0.5, 1], [400, 64, 1, 1], [800, 60, 0, 0], [1200, 55, 0.25, 1], [1600, 55, 0, 0], [2000, 64, 0, 0]]);
  eq([0, 600, 1000, 1400, 1800, 2200].map(F => at(k.kp1, F)), [0, 0, 4 / 12, -5 / 12, 4 / 12, 4 / 12], 'LOW; the pitch held after the last release');
  eq([0, 600, 1000, 1400, 1800, 2200].map(F => at(k.ks1, F)), [1, 1, 1, 1, 1, 0]);
  eq([0, 600, 1400, 2200].map(F => at(k.kg, F)), [5, 5, 5, 0]);
  eq([0, 600, 1400].map(F => at(k.kv, F)), [2.5, 5, 1.25], 'velocity at every note-on (LOW keeps the pitch)');
  k = kbd([[0, 60, 1, 1], [400, 64, 1, 1], [800, 67, 1, 1], [1200, 67, 0, 0], [1600, 64, 0, 0]], { pv: { pr: 1 } });
  eq([200, 600, 1000, 1400, 1800].map(F => at(k.kp1, F)), [0, 4 / 12, 7 / 12, 4 / 12, 0], 'LAST');
  k = kbd([[0, 72, 1, 1]], { pv: { tu: 50 }, each: (F, M, I) => { I.bend = F >= 400 ? 2 : 0; I.wheel = 0.5; I.at = 0.25; } });
  assert.ok(Math.abs(at(k.kp1, 200) - (1 + 50 / 1200)) < 1e-15 && Math.abs(at(k.kp1, 600) - (1 + 2 / 12 + 50 / 1200)) < 1e-15, 'tune, bend');
  eq([at(k.kw, 200), at(k.ka, 200)], [2.5, 1.25]);
  k = kbd([[0, 60, 1, 1], [400, 60, 0, 0]], { each: (F, M, I) => { I.sustain = F >= 200 && F < 800; } });
  eq([200, 600, 1000].map(F => at(k.ks1, F)), [1, 1, 0], 'the pedal holds S-TRIG, its release opens it');
  k = kbd([[0, 60, 1, 1], [100, 60, 0, 0]], { each: (F, M, I) => { I.sustain = F >= 400; } });
  eq([200, 600].map(F => at(k.ks1, F)), [0, 0], 'the pedal alone closes nothing');
});

test('the controller\'s triggers: SINGLE is legato (no opening at a new key while one is held); MULTIPLE opens S-TRIG (and GATE) for one chunk at a note-on while it was closed (not at the first); the 911 restarts T1 from its level', () => {
  const notes = [[0, 60, 1, 1], [400, 64, 1, 1], [1200, 64, 0, 0], [1200, 60, 0, 0], [1600, 67, 1, 1]];
  const s = kbd(notes).ks1, m = kbd(notes, { pv: { rt: 1 } });
  const opens = y => { const o = []; for (let i = 1; i < y.length; i++) if (y[i] !== y[i - 1]) o.push([i / 4, y[i]]); return o; };
  eq(opens(s), [[1200, 0], [1600, 1]], 'SINGLE');
  eq(opens(m.ks1), [[400, 0], [404, 1], [1200, 0], [1600, 1]], 'MULTIPLE: one chunk open at 400; none at the first note');
  eq([at(m.kg, 400), at(m.kg, 404)], [0, 5]);
  assert.equal(m.ks1[0], 1, 'the first note closes at once');
  const r = rig({ mods: [[0, 'ctl'], [1, '911']], pv: { 0: { rt: 1 }, 1: { t1: 3, t2: 6, es: 4 } }, cords: [[0, 'ks1', 1, 'trg']], taps: [[1, 'out']] });
  const y = r.render(9600, { notes: [[0, 60, 1, 1], [4800, 64, 1, 1]] }).t[0], i = 4800 * 4;
  assert.ok(y[i + 8] < y[i] && y[i + 40] > y[i + 16] && y[i + 16] > 0.5, 'an opening for a chunk, then T1 from the level reached');
});

test('the controller\'s GLIDE: an exponential slew of the pitch, its time constant 0.005 · 1000^(v / 10) s (LAW.glide, ± 2 %), off at 0 … 0.05; the first key after a reset (or ever) lands at once; bend unslewed', () => {
  for (const v of [3, 5, 8]) {
    const tau = 0.005 * 1000 ** (v / 10), nF = Math.ceil((0.1 + 3 * tau) * 48000 / 4) * 4;
    const k = kbd([[0, 60, 1, 1], [4800, 60, 0, 0], [4800, 72, 1, 1]], { pv: { gl: v }, nF, taps: ['kp1'] }).kp1, i0 = 4800 * 4;
    assert.equal(k[i0 - 1], 0, 'the first key at once');
    const i = k.findIndex((x, j) => j >= i0 && x >= 1 - Math.exp(-1));
    assert.ok(near((i - i0) / 192000, tau, 0.02), `GLIDE ${v}: ${(i - i0) / 192000} s vs ${tau}`);
    assert.ok(Math.abs(tau - MG.LAW.glide(v)) < 1e-15, 'moog-core\'s LAW');
  }
  for (const v of [0, 0.05]) { const k = kbd([[0, 60, 1, 1], [400, 60, 0, 0], [400, 72, 1, 1]], { pv: { gl: v }, taps: ['kp1'] }).kp1; assert.equal(k[1600], 1, `GLIDE ${v}: off`); }
  const r = rig({ mods: [[0, 'ctl']], pv: { 0: { gl: 8 } }, taps: [[0, 'kp1']] });
  r.render(800, { notes: [[0, 48, 1, 1]] }); r.M.get(0).reset();
  assert.equal(r.render(400, { notes: [[800, 72, 1, 1]] }).t[0][3], 1, 'after a reset the first key lands');
});

test('the controller\'s mixer, converters and og: LEVEL / 5 (×2 at 10) → MIX + and MIX − (railed); GATE IN closes S-TRIG OUT through +1.5 V and opens it below +1.0 V; S-TRIG IN → GATE OUT 4 V; og = OUT_K × OUTPUT / 10 (MAIN OUT 0.15 a volt at 10)', () => {
  let k = kbd([], { pv: { x1: 7, x2: 10, x3: 5, x4: 0 }, drive: [['m1', 1], ['m2', 0.5], ['m3', -1], ['m4', 2]], taps: ['mo', 'mn'], nF: 8 });
  assert.ok(Math.abs(k.mo[20] - 1.4) < 1e-15 && Math.abs(k.mn[20] + 1.4) < 1e-15, `mix ${k.mo[20]}`);
  k = kbd([], { pv: { x1: 10 }, drive: [['m1', 10]], taps: ['mo', 'mn'], nF: 8 });
  eq([k.mo[20], k.mn[20]], [12, -6], 'the rails');
  const ramp = i => (i < 1000 ? i * 0.002 : (2000 - i) * 0.002);         // 0 → 2 → 0 V over 2000 samples
  k = kbd([], { drive: [['vi', ramp]], taps: ['vo'], nF: 500 });
  const ed = []; for (let i = 1; i < 2000; i++) if (k.vo[i] !== k.vo[i - 1]) ed.push([i, ramp(i)]);
  eq(ed.map(e => e[0]), [751, 1501], `the edges ${JSON.stringify(ed)}`);   // (1.502 V rising; 0.998 V falling)
  k = kbd([], { drive: [['si', i => (i >= 100 && i < 300 ? 1 : 0)]], taps: ['so'], nF: 100 });
  eq([k.so[50], k.so[150], k.so[350]], [0, 4, 0]);
  for (const [ov, want] of [[7, 0.105], [10, 0.15], [0, 0]]) {
    const r = rig({ mods: [[0, 'ctl']], pv: { 0: { ov } }, drive: [[0, 'out', 1]] });
    const y = r.render(40).y;
    assert.ok(Math.abs(r.M.get(0).og - want) < 1e-15 && Math.abs(y[100] - want) < 1e-15, `OUTPUT ${ov}: og ${r.M.get(0).og}, ${y[100]}`);
  }
});

/* ---------------------------------------------------------------- rails, feedback */
test('T-LVL1: active feedback stays inside the rails and finite — a 902 into itself at ×2 (10 s), a mixer → 904A (k 4.4) → 902 → mixer / 921B loop at full gain (10 s, OS 4 and OS 1)', () => {
  const bad = [];
  const chk = (nm, ys) => { for (const y of ys) for (let i = 0; i < y.length; i++) if (!(y[i] >= -6 && y[i] <= 12)) { bad.push(`${nm}: ${y[i]} at ${i}`); return; } };
  let r = rig({ mods: [[1, '902']], pv: { 1: { md: 1, fc: 6 } }, cords: [[1, 'o2', 1, 'i1']], drive: [[1, 'i2', i => (i === 0 ? -1e-3 : 0)]], taps: [[1, 'o2'], [1, 'o1']] });
  assert.ok(r.loop);
  let t = r.render(frames(10)).t; chk('902 ×2 into itself', t);
  if (t[0][t[0].length - 1] !== 12) bad.push(`the 902 loop settles at the rail: ${t[0][t[0].length - 1]}`);
  for (const os of [4, 1]) {
    r = rig({ os, mods: [[0, 'ctl'], [1, '921b'], [2, '904a'], [3, '902']], pv: { 0: { x1: 10, x2: 10 }, 2: { re: 10, fc: 2 }, 3: { fc: 6 } },
      cords: [[1, 'saw', 0, 'm1'], [0, 'mo', 2, 'in'], [2, 'out', 3, 'i1'], [3, 'o2', 0, 'm2'], [3, 'o1', 1, 'dc'], [3, 'o2', 0, 'out']], taps: [[0, 'mo'], [2, 'out'], [3, 'o2'], [1, 'saw']] });
    t = r.render(frames(10)).t; chk(`the loop at OS ${os}`, t);
    if (!(absMax(t[2]) > 1)) bad.push(`the loop sounds: ${absMax(t[2])}`);
  }
  assert.deepEqual(bad, []);
});

/* ---------------------------------------------------------------- the module contracts */
// every module busy: its inputs on signals with edges, FM, gates; [type, pv, drive, taps]
const BUSY = [
  ['921', { pw: 30, cl: 40, ax: 4, al: 7 }, [['f1', i => Math.sin(i * 0.002)], ['w1', i => 2 * Math.sin(i * 0.0007)], ['cv', i => 3 * Math.sin(i * 0.013)], ['cs', i => ((i >> 9) & 1)]], ['sin', 'tri', 'saw', 'rec', 'xp', 'xm']],
  ['921b', { ss: 2, rg: 4 }, [['dc', i => Math.sin(i * 0.004)], ['ac', i => 2 * Math.sin(i * 0.009)], ['sy', i => Math.sin(i * 0.011)]], ['sin', 'tri', 'saw', 'rec']],
  ['923', { lp: 3, hp: 6 }, [['li', i => Math.sin(i * 0.03)], ['hi', i => Math.sin(i * 0.002)]], ['wh1', 'pk', 'lo', 'ho']],
  ['904a', { re: 10, fc: 1 }, [['in', i => 2 * Math.sin(i * 0.01)], ['c1', i => Math.sin(i * 0.0003)], ['c3', i => 0.2 * Math.sin(i * 0.05)]], ['out']],
  ['907a', { b3: 4, hi: 7 }, [['in', i => Math.sin(i * 0.02) + Math.sin(i * 0.31)]], ['out']],
  ['911', { t1: 1, t2: 2, t3: 1, es: 6 }, [['trg', i => ((i >> 11) % 3 === 0 ? 0 : 1)]], ['out']],
  ['902', { md: 1, fc: 2 }, [['i1', i => Math.sin(i * 0.02)], ['i2', i => 0.3 * Math.sin(i * 0.05)], ['c1', i => 3 + 3 * Math.sin(i * 0.001)], ['c2', i => 0.5 * Math.sin(i * 0.07)]], ['o1', 'o2']],
  ['995', { a1: 3, a2: 7, a3: 10 }, [['i1', i => Math.sin(i * 0.02)], ['i3', i => Math.cos(i * 0.01)]], ['o1', 'o2', 'o3']],
  ['921a', { fq: 2, pw: 30 }, [['f1', i => Math.sin(i * 0.01)], ['w2', i => Math.sin(i * 0.02)]], []],
  ['ctl', { gl: 4, rt: 1, x2: 9 }, [['m1', i => Math.sin(i * 0.02)], ['m2', i => Math.sin(i * 0.03)], ['vi', i => 3 * Math.sin(i * 0.004)], ['si', i => ((i >> 10) & 1)], ['out', i => Math.sin(i * 0.05)]],
    ['kp1', 'ks1', 'kg', 'kv', 'mo', 'mn', 'vo', 'so']],
];
const BUSY_NOTES = [[0, 60, 0.7, 1], [200, 64, 0.9, 1], [400, 55, 0.5, 1], [600, 64, 0, 0], [800, 55, 0, 0], [1000, 67, 1, 1], [1400, 60, 0, 0], [1600, 67, 0, 0]];
function busy(k, o = {}) {
  const [type, pv, drive, taps] = BUSY[k];
  const mods = type === 'ctl' ? [[0, 'ctl']] : type === '921a' ? [[1, '921a'], [2, '921b', 1]] : [[1, type]], n = type === 'ctl' ? 0 : 1;
  const tp = type === '921a' ? [[2, 'saw'], [2, 'rec']] : (o.taps || taps).map(id => [n, id]);
  const { taps: _t, nF = 2000, ...ro } = o;
  const r = rig(Object.assign({ mods, pv: { [n]: pv }, drive: drive.map(d => [n, d[0], d[1]]), taps: tp }, ro));
  return r.render(nF, { notes: type === 'ctl' ? BUSY_NOTES : [], each: type === 'ctl' ? (F, M, I) => { I.bend = ((F >> 6) % 5) - 2; I.wheel = 0.3; I.sustain = (F >> 9) & 1; } : undefined });
}
const same = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
test('the module contracts: block steps = per-sample steps (a loop member) bit for bit, for every type; the output mask changes no read output; determinism; 44.1 k × 2', () => {
  const bad = [];
  for (let k = 0; k < BUSY.length; k++) {
    const nm = BUSY[k][0], a = busy(k), b = busy(k, { perSample: true }), c = busy(k);
    a.t.forEach((y, j) => { if (!same(y, b.t[j])) bad.push(`${nm} tap ${j}: block ≠ per sample`); if (!same(y, c.t[j])) bad.push(`${nm} tap ${j}: not deterministic`); });
    if (!same(a.y, b.y)) bad.push(`${nm} MAIN OUT: block ≠ per sample`);
    if (nm !== '921a') BUSY[k][3].forEach((id, j) => { const one = busy(k, { taps: [id] }); if (!same(one.t[0], a.t[j])) bad.push(`${nm}.${id}: the mask changed it`); });
    const d = busy(k, { base: 44100, os: 2 }), e = busy(k, { base: 44100, os: 2, perSample: true });
    d.t.forEach((y, j) => { if (!same(y, e.t[j]) || !y.every(Number.isFinite)) bad.push(`${nm} at 44.1 k × 2`); });
  }
  assert.deepEqual(bad, []);
});

// every own number and typed array of a module (its state): any subnormal?
const SUB = 2.2250738585072014e-308;
const subOf = m => { const s = []; for (const [k, v] of Object.entries(m)) { if (typeof v === 'number' && v !== 0 && Math.abs(v) < SUB) s.push(k); else if (ArrayBuffer.isView(v)) { for (let i = 0; i < v.length; i++) if (v[i] !== 0 && Math.abs(v[i]) < SUB) { s.push(k + '[' + i + ']'); break; } } } return s; };
test('no NaN / Inf / subnormal: every type with every knob at its ends (OS 1 and 4) under ±12 V inputs, then 3 s of silence (the recursive states flushed); values past the ranges (±1e300, ±Infinity) read as the range ends', () => {
  const P = PM(), bad = [];
  for (const os of [1, 4]) for (let k = 0; k < BUSY.length; k++) for (const end of [0, 1]) {
    const [type, , drive, taps] = BUSY[k], pv = Object.fromEntries(P.PARAMS[type].map(([id], j) => [id, P.RANGE[type][j][end]]));
    const n = type === 'ctl' ? 0 : 1, mods = type === 'ctl' ? [[0, 'ctl']] : type === '921a' ? [[1, '921a'], [2, '921b', 1]] : [[1, type]];
    let live = true;
    const r = rig({ os, mods, pv: { [n]: pv }, drive: drive.map(d => [n, d[0], i => (live ? 12 * Math.sign(d[1](i)) * (i % 7 === 0 ? -0.5 : 1) : 0)]),
      taps: (type === '921a' ? ['saw'] : taps).map(id => [type === '921a' ? 2 : n, id]) });
    const a = r.render(frames(0.2), { notes: type === 'ctl' ? BUSY_NOTES : [] });
    live = false;
    const b = r.render(frames(3), { notes: type === 'ctl' ? [[0, 0, 0, 0]] : [] });
    for (const y of [...a.t, ...b.t, a.y, b.y]) for (let i = 0; i < y.length; i++) if (!Number.isFinite(y[i]) || (y[i] !== 0 && Math.abs(y[i]) < SUB)) { bad.push(`${type} ${end ? 'hi' : 'lo'} OS ${os}: ${y[i]} at ${i}`); break; }
    for (const m of r.M.values()) { const s = subOf(m); if (s.length) bad.push(`${type} ${end ? 'hi' : 'lo'} OS ${os}: subnormal state ${s}`); }
  }
  for (const t of P.ORDER) {
    const m = new P.T[t]({ fs: 192000, OS: 4, n: 1, type: t }), wild = [1e300, -1e300, Infinity, -Infinity];
    P.PARAMS[t].forEach((_, j) => { m.p[j] = m.t[j] = wild[j % 4]; });
    m.mv = 1; m.ctl(0);
    for (let s = 0; s < P.SECS[t]; s++) m.run(s, 0, 16);
    if (!m.outs.every(o => o.every(Number.isFinite))) bad.push(`${t}: outputs`);
    for (const f of Object.keys(m)) if (typeof m[f] === 'number' && !Number.isFinite(m[f]) && f !== 'zb') bad.push(`${t}.${f} = ${m[f]}`);
  }
  assert.deepEqual(bad, []);
});

test('reset() = the fresh state, bit for bit (phases, filters, envelopes, keys, the noise re-seeded); setOS re-rates (a 921 at C4 at 48 k × 4 → 44.1 k × 2 → 48 k × 8); the coefficients follow p when mv is 1 (the evaluator glides p) and only then', () => {
  const P = PM(), bad = [];
  for (let k = 0; k < BUSY.length; k++) {
    const [type, pv, drive] = BUSY[k];
    if (type === '921a') continue;
    const mk = () => { const m = new P.T[type]({ fs: 192000, OS: 4, n: 2, salt: 3, inst: INST(), type }); P.PARAMS[type].forEach(([id], j) => { if (pv[id] !== undefined) m.p[j] = m.t[j] = pv[id]; }); m.mv = 1; return m; };
    const a = mk(), b = mk(), bufs = drive.map(() => new Float64Array(32)), io = P.IO[type];
    for (const m of [a, b]) drive.forEach((d, j) => { m.ins[io.ii[P.JACKS[type].findIndex(x => x.id === d[0])]] = bufs[j]; });
    const step = (ms, cc) => {
      drive.forEach((d, j) => { for (let i = 0; i < 16; i++) bufs[j][i] = d[1](cc * 16 + i); });
      for (const m of ms) { if ((cc & 31) === 0) m.flush(); m.ctl(cc); m.mv = 0; for (let s = 0; s < P.SECS[type]; s++) if (!(type === 'ctl' && (s === 2 || s === 3 || s === 6))) m.run(s, 0, 16); }
    };
    if (type === 'ctl') a.note(60, 1, 1);
    for (let cc = 0; cc < 700; cc++) step([a], cc);
    a.reset(); a.mv = 1;
    for (let cc = 700; cc < 1400; cc++) {
      if (type === 'ctl' && cc === 700) { a.note(64, 0.5, 1); b.note(64, 0.5, 1); }
      step([a, b], cc);
      if (!a.outs.every((o, j) => same(o.subarray(0, 16), b.outs[j].subarray(0, 16)))) { bad.push(`${type} at chunk ${cc}`); break; }
    }
  }
  for (const [fs, os] of [[192000, 4], [88200, 2], [384000, 8]]) {
    const m = new P.T['921']({ fs: 192000, OS: 4, n: 1, type: '921' }); m.setOS(fs);
    const y = new Float64Array(Math.floor(0.5 * fs / (4 * os)) * 4 * os);
    for (let c = 0; c < y.length / (4 * os); c++) { m.ctl(c); m.run(0, 0, 4 * os); y.set(m.outs[2].subarray(0, 4 * os), c * 4 * os); }
    if (Math.abs(cents(zcF(y, fs), C4)) > 0.1) bad.push(`setOS ${fs}: ${zcF(y, fs)}`);
  }
  const m = new P.T['902']({ fs: 192000, OS: 4, n: 1, type: '902' }), z = new Float64Array(32).fill(1);
  m.ins[0] = z; m.ins[2] = z;
  m.p[1] = 2; m.mv = 0; m.ctl(0); m.run(0, 0, 16);
  if (m.outs[1][0] !== 1 / 3) bad.push('mv 0: the old coefficients (the fixed CV still 0 V)');
  m.mv = 1; m.ctl(1); m.run(0, 0, 16);
  if (m.outs[1][0] !== 1) bad.push(`mv 1: recomputed (${m.outs[1][0]})`);
  assert.deepEqual(bad, []);
});

/* ---------------------------------------------------------------- over the evaluator (patch-dsp.js) with K9's tables */
// the note lines: an eighth-note bass line at 120 BPM (80 % gates), a slow lead
function line(kind, base) {
  const q = base / 8, o = [], fr = x => Math.round(x / 4) * 4;
  if (kind === 'bass') [48, 48, 60, 48, 51, 53, 55, 58].forEach((n, k) => { o.push([fr(2 * k * q), n, 0.8, 1], [fr((2 * k + 1.6) * q), n, 0, 0]); });
  if (kind === 'lead') [60, 67, 72, 70].forEach((n, k) => { o.push([fr(4 * k * q), n, 0.8, 1], [fr((4 * k + 3.6) * q), n, 0, 0]); });
  return o.sort((a, b) => a[0] - b[0] || a[3] - b[3]);
}
const LINE = { 'Classic bass': 'bass', 'Filter sweep': 'lead', Drone: 'none', 'Sync lead': 'lead', Wind: 'none', Bells: 'lead' };
// the base-rate MAIN OUT (a windowed-sinc low-pass below 20 kHz, then every OS-th sample)
function decim(y, os, base) {
  const H = 95, c = 20000 / (base * os), h = new Float64Array(H);
  let s = 0;
  for (let k = 0; k < H; k++) { const x = k - (H - 1) / 2, w = 0.42 - 0.5 * Math.cos(2 * Math.PI * k / (H - 1)) + 0.08 * Math.cos(4 * Math.PI * k / (H - 1)); h[k] = (x === 0 ? 2 * c : Math.sin(2 * Math.PI * c * x) / (Math.PI * x)) * w; s += h[k]; }
  const n = Math.floor(y.length / os), o = new Float64Array(n);
  for (let i = 0; i < n; i++) { let a = 0; const e = i * os + (H - 1) / 2; for (let k = 0; k < H; k++) { const j = e - k; if (j >= 0 && j < y.length) a += h[k] * y[j]; } o[i] = a / s; }
  return o;
}
test('K9\'s starting patches over the evaluator: each loads, schedules with no loop step and no error, sounds, stays inside the rails (MAIN OUT / og ≤ 12 V); headroom — Classic bass at its defaults peaks −12 … −3 dBFS before the track\'s limiter (48 k × 4 and 44.1 k × 2; OUT_K 0.15 / V)', () => {
  const bad = [], rep = [];
  for (const P of MG.PRESETS) {
    const r = presetM(P.name), y = r.render(frames(2), { notes: line(LINE[P.name], 48000) }), mon = r.mc.mon(), og = 0.15 * (r.vals.ov !== undefined ? r.vals.ov : 7) / 10;
    if (r.errs.length || r.g.why.length) bad.push(`${P.name}: ${r.errs} ${r.g.why}`);
    if (!(mon.steps.length > 1 && mon.steps.every(s => s.loop === 0))) bad.push(`${P.name}: a loop step`);
    const d = decim(y, 4, 48000), pk = dB(absMax(d)), rm = dB(Math.sqrt(d.reduce((a, b) => a + b * b, 0) / d.length));
    rep.push(`${P.name} ${pk.toFixed(1)} dBFS peak, ${rm.toFixed(1)} RMS`);
    if (!(rm > -55)) bad.push(`${P.name} is silent: ${rm}`);
    if (!(absMax(y) / og <= 12) || !y.every(Number.isFinite)) bad.push(`${P.name} leaves the rails`);
  }
  for (const [base, os] of [[48000, 4], [44100, 2]]) {
    const r = presetM('Classic bass', { base, os }), pk = dB(absMax(decim(r.render(frames(2, base), { notes: line('bass', base) }), os, base)));
    rep.push(`Classic bass at ${base}×${os}: ${pk.toFixed(2)} dBFS`);
    if (!(pk >= -12 && pk <= -3)) bad.push(`Classic bass headroom at ${base}×${os}: ${pk}`);
  }
  console.log('# K9\'s presets: ' + rep.join(' · '));
  assert.deepEqual(bad, []);
});

test('over the evaluator: the whole schedule per sample (its ps) = block steps, bit for bit, for every preset and a patch with a loop step; span invariance (4, 128, random multiples of 4 frames); reset() replays a bounce', () => {
  const bad = [];
  const loopPatch = (o = {}) => {
    const { pg, pv } = payloadOf([[1, '921b'], [2, '904a'], [3, '902'], [4, '911']],
      [[0, 'kp1', 1, 'dc'], [1, 'saw', 0, 'm1'], [0, 'mo', 2, 'in'], [2, 'out', 3, 'i1'], [3, 'o2', 0, 'm2'], [3, 'o1', 1, 'ac'], [0, 'ks1', 4, 'trg'], [4, 'out', 3, 'c1'], [3, 'o2', 0, 'out']],
      { 0: { x2: 3 }, 2: { re: 9.5, fc: 1 }, 3: { fc: 1 } });
    return machine(Object.assign({ pg, pv }, o));
  };
  const runs = [...MG.PRESETS.map(P => [P.name, o => presetM(P.name, o), line(LINE[P.name], 48000)]), ['a loop step', loopPatch, line('bass', 48000)]];
  for (const [nm, mk, notes] of runs) {
    const a = mk(), b = mk(), c = mk(), d = mk();
    if (nm === 'a loop step' && !a.mc.mon().steps.some(s => s.loop === 1)) bad.push('the loop patch has no loop step');
    b.mc.ps = 1;
    let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
    const ya = a.render(frames(0.5), { notes }), yb = b.render(frames(0.5), { notes }), yc = c.render(frames(0.5), { notes, span: () => 4 }), yd = d.render(frames(0.5), { notes, span: () => 4 * (1 + Math.floor(rnd() * 40)) });
    if (!same(ya, yb)) bad.push(`${nm}: per sample ≠ block`);
    if (!same(ya, yc) || !same(ya, yd)) bad.push(`${nm}: spans`);
    // a reset machine at frame F renders what a fresh one started at F renders (the notes after F; the absolute chunk clock)
    const F = frames(0.1), after = notes.filter(x => x[0] >= F), e = mk(), f = mk({ F0: F });
    e.render(F, { notes }); e.mc.reset();
    if (!same(e.render(frames(0.15), { notes: after }), f.render(frames(0.15), { notes: after }))) bad.push(`${nm}: reset ≠ a fresh machine`);
  }
  assert.deepEqual(bad, []);
});

test('over the evaluator: the multiples (a driven jack heard on the group\'s others, two driven averaged — tied outputs, review 1 F2 —, passive), a passive loop through a multiple with three drivers bounded (the average cannot gain: it settles on its source), the normals of the 995 (an unpatched i2 reads i1\'s source)', () => {
  let { pg, pv } = payloadOf([[1, '995']], [[0, 'kp1', 0, 'a1'], [0, 'kw', 0, 'a3'], [0, 'a2', 1, 'i1'], [1, 'o2', 0, 'out']], { 1: { a1: 10, a2: 10 } });
  let r = machine({ pg, pv });
  r.inst.wheel = 0.5;
  const y = r.render(400, { notes: [[0, 72, 1, 1]] });
  assert.ok(Math.abs(y[1000] / r.mc.lat.byN.get(0).m.og - (1 + 2.5) / 2) < 1e-12, `kp1 (1 V) and kw (2.5 V) through MULT A averaged, i2 normalled to i1: ${y[1000]}`);
  ({ pg, pv } = payloadOf([[1, '995']], [[1, 'o1', 0, 'a1'], [0, 'a2', 1, 'i1'], [1, 'o2', 0, 'a3'], [0, 'kv', 0, 'a4'], [1, 'o3', 0, 'out']], { 1: { a1: 10, a2: 10, a3: 10 } }));
  r = machine({ pg, pv });
  const z = r.render(4000, { notes: [[0, 60, 1, 1], [8, 60, 0, 0]] });
  assert.ok(z.every(Number.isFinite), 'finite');
  assert.ok(r.errs.length === 0, `errs ${r.errs}`);
  // (o1, o2 and the velocity tied: summed, a loop gain of 2 ran to the late reads' ±1e4 clamp — 74 dBFS at MAIN OUT; averaged, it settles on 5 V)
  const og = r.mc.lat.byN.get(0).m.og, pkV = absMax(z) / og;
  assert.ok(pkV < 5.001 && Math.abs(z[z.length - 1] / og - 5) < 1e-6, `the loop stays at its source: peak ${pkV} V, end ${z[z.length - 1] / og} V`);
});

test('no allocation in the render path over the evaluator: Classic bass plus a loop step, sync, a clamp, the 907A and the 923, 200 chunks with a note storm (a key every chunk), bend / wheel / pressure / the pedal moving', () => {
  const { sc } = libM(), r = PT.loadPreset(PT.fresh('moog'), {}, 'Classic bass'), { pg } = PT.payload(r.rec, 'moog'), P = PM();
  const by = {}; for (const [n, t] of pg.mods) (by[t] = by[t] || []).push(n);
  const port = (t, id) => P.JACKS[t].findIndex(j => j.id === id);
  const n907 = 90, n923 = 91, n902 = 92;
  pg.mods.push([n907, '907a', -1], [n923, '923', -1], [n902, '902', -1]);
  pg.cords.push([by['921b'][0], port('921b', 'saw'), by['921b'][1], port('921b', 'sy'), 1], [n923, port('923', 'pk'), n907, port('907a', 'in'), 1],
    [n907, port('907a', 'out'), 0, port('ctl', 'm4'), 1], [n902, port('902', 'o2'), by['921'][0], port('921', 'cv'), 1],
    [0, port('ctl', 'mn'), n902, port('902', 'i1'), 1], [n902, port('902', 'o1'), 0, port('ctl', 'vi'), 1], [0, port('ctl', 'vo'), by['921'][0], port('921', 'cs'), 1],
    [n902, port('902', 'o1'), by['904a'][0], port('904a', 'c3'), 1], [by['904a'][0], port('904a', 'out'), n902, port('902', 'c2'), 1]);
  const pv = MG.pvOf(r.vals); pv['m' + n902] = { _t: '902', fc: 5 };
  const m = machine({ pg, pv });
  assert.ok(m.mc.mon().steps.some(s => s.loop === 1), 'a loop step');
  m.render(400);
  const notes = []; for (let k = 0; k < 200; k++) notes.push([400 + 4 * k, 40 + (k * 7) % 40, 0.5 + (k % 5) / 10, k % 3 === 2 ? 0 : 1]);
  // (the host's buffers are this realm's: only the scope's constructors are stubbed)
  const y = noAlloc(sc, () => m.render(800, { notes, span: () => 4, each: (F, I) => { I.bend = ((F >> 2) % 9) - 4; I.wheel = 0.3; I.at = 0.2; I.sustain = (F >> 2) & 1; } }));
  assert.ok(y.every(Number.isFinite) && absMax(y) > 0, 'it sounds, finite');
});

/* ---------------------------------------------------------------- CPU */
// a module's ctl + run alone (inputs pointed at pre-filled chunk buffers), OS 4, 48 kHz, s per s; the best of 3
function costOf(type, cfg, secs) {
  const { PM: P } = libM(), os = 4, fs = 192000, CH = 16, NP = 251, sec = 0.5, nCh = Math.round(sec * fs / CH);
  const pool = f => { const a = []; for (let c = 0; c < NP; c++) { const b = new Float64Array(32); for (let i = 0; i < CH; i++) b[i] = f(c * CH + i); a.push(b); } return a; };
  const POOL = { saw: pool(n => 0.866 * (2 * ((n * 110.3 / fs) % 1) - 1)), mix: pool(n => 1.2 * (2 * ((n * 110.3 / fs) % 1) - 1) + 0.8 * (2 * ((n * 165.7 / fs) % 1) - 1)),
    gate: pool(n => ((n / CH) % 200) < 120 ? 1 : 0), env: pool(n => 3 + 3 * Math.sin(n * 2 * Math.PI * 2 / fs)), clk: pool(n => ((n * 2000 / fs) % 1) < 0.5 ? 4 : -4),
    cv1: pool(n => 0.3 * Math.sin(n * 2 * Math.PI * 3 / fs)) };
  const m = new P.T[type]({ fs, OS: os, n: 3, salt: 0, inst: INST(), type });
  const z = new Float64Array(32); m.ins = m.ins.map(() => z);
  const named = cfg(m) || [];
  const S = secs || Array.from({ length: P.SECS[type] }, (_, s) => s), ns = S.length;
  const run = (n0, n1) => { for (let c = n0; c < n1; c++) { const j = c % NP; for (const [k, nm] of named) m.ins[k] = POOL[nm][j]; m.ctl(c); m.mv = 0; for (let s = 0; s < ns; s++) m.run(S[s], 0, CH); } };
  run(0, nCh);
  let best = 1e9;
  for (let r = 1; r <= 5; r++) { const t0 = performance.now(); run(nCh * r, nCh * (r + 1)); best = Math.min(best, (performance.now() - t0) / 1000 / sec); }
  return best;
}
test('CPU per module type at OS 4 (node, reported; gated at three times spike (a)\'s limits — the Mac runs other lanes\' tests too): oscillators ≤ 0.002 masked, 904A ≤ 0.006 (≤ 0.011 resonant and bright), 907A ≤ 0.009, 923 ≤ 0.002, the rest ≤ 0.001; and the starting patches\' machines', () => {
  const C = [
    ['921 saw (masked; f1 patched)', 0.002, () => costOf('921', m => { m.om = 16; return [[0, 'cv1']]; })],
    ['921 every output', 0.004, () => costOf('921', m => { m.om = 63; return [[0, 'cv1']]; })],
    ['921 saw + a V clamp at 2 kHz', 0.002, () => costOf('921', m => { m.om = 16; return [[5, 'clk']]; })],
    ['921B saw (masked; driven)', 0.002, () => costOf('921b', m => { m.om = 4; return [[3, 'cv1']]; })],
    ['921B saw + STRONG sync', 0.002, () => costOf('921b', m => { m.om = 4; m.p[2] = m.t[2] = 2; m.mv = 1; return [[2, 'saw'], [3, 'cv1']]; })],
    ['921A', 0.001, () => costOf('921a', () => [[0, 'cv1']])],
    ['904A k 0 (c1 patched)', 0.006, () => costOf('904a', () => [[0, 'mix'], [1, 'cv1']])],
    ['904A resonant and bright (re 10, fc +5)', 0.011, () => costOf('904a', m => { m.p[2] = m.t[2] = 10; m.p[0] = m.t[0] = 5; m.mv = 1; return [[0, 'mix'], [1, 'cv1']]; })],
    ['907A', 0.009, () => costOf('907a', () => [[0, 'mix']])],
    ['911', 0.001, () => costOf('911', () => [[0, 'gate']])],
    ['902 LIN', 0.001, () => costOf('902', m => { m.om = 2; return [[0, 'mix'], [2, 'env']]; })],
    ['902 EXP', 0.001, () => costOf('902', m => { m.om = 2; m.p[0] = m.t[0] = 1; m.mv = 1; return [[0, 'mix'], [2, 'env']]; })],
    ['923 noise + LP + HP', 0.002, () => costOf('923', () => [[0, 'mix'], [1, 'mix']])],
    ['995 one section', 0.001, () => costOf('995', () => [[0, 'mix']], [0])],
    ['controller KBD (pitch, S-trig)', 0.001, () => costOf('ctl', m => { m.om = 15; m.note(48, 0.8, 1); return []; }, [0])],
    ['controller MIX (3 inputs)', 0.001, () => costOf('ctl', m => { m.om = 256; return [[0, 'mix'], [1, 'mix'], [2, 'mix']]; }, [1])],
  ];
  const rep = [], bad = [];
  for (const [nm, lim, f] of C) { const t = f(); rep.push(`${nm} ${t.toFixed(5)}`); if (!(t <= 3 * lim)) bad.push(`${nm}: ${t} > 3 × ${lim}`); }
  for (const P of MG.PRESETS) {
    const r = presetM(P.name), notes = line(LINE[P.name], 48000);
    r.render(frames(0.5), { notes });
    const t0 = performance.now(); r.render(frames(1)); rep.push(`${P.name} machine ${((performance.now() - t0) / 1000).toFixed(4)}`);
  }
  console.log('# CPU (OS 4, node; s per s): ' + rep.join(' · '));
  assert.deepEqual(bad, []);
});
