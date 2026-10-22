// patch-dsp.js — the generic patch evaluator (IMPL-9 §3.2 / §3.3 / §8.1 / §12 spike (a), lane V9a), tested over stub modules
// of the base shape: a family `PatchStub` defined below and evaluated in the script's own vm context (DONT_CONTEXTIFY: the
// worklet's speed, noAlloc's stubs). The schedule (hand cases, the sections that keep a patch loop-free, 500 random graphs);
// a loop step = an independent per-sample interpreter with the same back-edges, bit for bit; block = per-sample outside
// loops; span invariance (D7); multiples, normals, links, gains; the output mask; ctl once a chunk, the flush on the
// absolute chunk; values (ids, _t, glide, snap); ramps (click-free, an S input switching at the midpoint); retiring;
// live(); reset() = a fresh machine; hostile payloads (one ptErr); finite under fuzzed feedback; no allocation in render,
// the end of a transition included. The Moog presets' schedule (no loop step) runs once K9's tables and V9b's script exist.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { noAlloc } from './dsp-scope.mjs';

const ROOT = new URL('../', import.meta.url);
const SRC = readFileSync(new URL('patch-dsp.js', ROOT), 'utf8');

// The stub family: small circuits of the base shape ({ ins, outs, p, t, mv, om, ctl(cc), run(sec, i0, n), flush(), setOS(fs),
// reset(), setSalt(s) }; module 0: note(), og). Each run is per sample (n-independent), computes the outputs of `om` only,
// and counts what the tests read (nc ctl calls, nf flushes, comp the outputs it ever computed, mvN chunks with mv).
const STUB = String.raw`(function () {
  'use strict';
  const rail = x => (x > 12 ? 12 : x < -12 ? -12 : x === x ? x : 0);
  const made = globalThis.STUBS = [];
  function init(m, h, nOut) {
    m.h = h; m.n = h.n; m.fs = h.fs; m.salt = h.salt; m.outs = [];
    for (let k = 0; k < nOut; k++) m.outs.push(new Float64Array(32));
    m.nc = 0; m.nf = 0; m.comp = 0; m.cc = -1; m.mvN = 0; m.resets = 0; m.b = 0;
    made.push(m);
  }
  function tick(m, cc) { m.nc++; m.cc = cc; if (m.mv) m.mvN++; }
  class Ctl { // 0 KBD (kp, ks S, kg) · 1 MIX (m1, m2 → mo) · 2 / 3 multiples · 4 S→V (si → so) · 5 OUT (the sink)
    constructor(h) { init(this, h, 5); this.held = new Uint8Array(128); this.gate = 0; this.pit = 0; this.og = 0; this.notes = 0; }
    note(n, v, on) { this.held[n] = on ? 1 : 0; this.notes++; }
    ctl(cc) {
      tick(this, cc);
      let lo = -1;
      for (let k = 0; k < 128; k++) if (this.held[k]) { lo = k; break; }
      this.gate = lo >= 0 ? 1 : 0;
      if (lo >= 0) this.pit = (lo - 60) / 12;
      this.og = 0.1 * this.p[0] / 10;
    }
    flush() { this.nf++; }
    run(sec, i0, n) {
      const e = i0 + n, om = this.om, O = this.outs, I = this.ins;
      this.comp |= om;
      if (sec === 0) { const g = this.gate, pt = this.pit; for (let i = i0; i < e; i++) { if (om & 1) O[0][i] = pt; if (om & 2) O[1][i] = g; if (om & 4) O[2][i] = 5 * g; } }
      else if (sec === 1) { const a = I[0], b = I[1], mo = O[3], x1 = this.p[1] / 10, x2 = this.p[2] / 10; if (om & 8) for (let i = i0; i < e; i++) mo[i] = rail(x1 * a[i] + x2 * b[i]); }
      else if (sec === 4) { const s = I[2], so = O[4]; if (om & 16) for (let i = i0; i < e; i++) so[i] = s[i] > 0.5 ? 4 : 0; }
      else throw new Error('ctl: section ' + sec + ' run');
    }
    setOS(fs) { this.fs = fs; }
    reset() { this.held.fill(0); this.gate = 0; this.pit = 0; this.resets++; }
    setSalt(s) { this.salt = s; }
  }
  class Osc { // f1 + f2 (1 V/oct about 110 Hz · 2^(fq + rg − 2)), sy (S: a closure resets the phase) → saw, sq (±5 V)
    constructor(h) { init(this, h, 2); this.ph = 0; this.sp = 0; this.k = 0; }
    ctl(cc) { tick(this, cc); this.k = 110 / this.fs; this.b = this.p[0] + this.p[1] - 2; }
    flush() { this.nf++; }
    run(sec, i0, n) {
      const I = this.ins, f1 = I[0], f2 = I[1], sy = I[2], saw = this.outs[0], sq = this.outs[1], om = this.om, k = this.k, b = this.b;
      this.comp |= om;
      let ph = this.ph, sp = this.sp;
      for (let i = i0, e = i0 + n; i < e; i++) {
        let dt = k * Math.pow(2, rail(f1[i] + f2[i]) + b);
        if (!(dt < 0.45)) dt = 0.45;
        ph += dt; if (ph >= 1) ph -= 1;
        const s = sy[i] > 0.5 ? 1 : 0;
        if (s > sp) ph = 0;
        sp = s;
        if (om & 1) saw[i] = 5 * (2 * ph - 1);
        if (om & 2) sq[i] = ph < 0.5 ? 5 : -5;
      }
      this.ph = ph; this.sp = sp;
    }
    setOS(fs) { this.fs = fs; }
    reset() { this.ph = 0; this.sp = 0; this.resets++; }
    setSalt(s) { this.salt = s; }
  }
  class Vcf { // in, c1 → lp: one pole, a = 0.05 · 2^(c1 + fc) per sample
    constructor(h) { init(this, h, 1); this.y = 0; }
    ctl(cc) { tick(this, cc); this.b = this.p[0]; }
    flush() { this.nf++; if (Math.abs(this.y) < 1e-30) this.y = 0; }
    run(sec, i0, n) {
      const x = this.ins[0], c = this.ins[1], o = this.outs[0], b = this.b, om = this.om;
      this.comp |= om;
      let y = this.y;
      for (let i = i0, e = i0 + n; i < e; i++) { let a = 0.05 * Math.pow(2, rail(c[i]) + b); if (!(a < 1)) a = 1; y += (rail(x[i]) - y) * a; if (om & 1) o[i] = y; }
      this.y = y;
    }
    setOS(fs) { this.fs = fs; }
    reset() { this.y = 0; this.resets++; }
    setSalt(s) { this.salt = s; }
  }
  class Vca { // (i1 − i2) · clamp(c1 + fc, 0, 10) / 5 → o2, o1 = −o2
    constructor(h) { init(this, h, 2); }
    ctl(cc) { tick(this, cc); this.b = this.p[0]; }
    flush() { this.nf++; }
    run(sec, i0, n) {
      const I = this.ins, i1 = I[0], i2 = I[1], c = I[2], o1 = this.outs[0], o2 = this.outs[1], b = this.b, om = this.om;
      this.comp |= om;
      for (let i = i0, e = i0 + n; i < e; i++) {
        let v = c[i] + b; v = v < 0 ? 0 : v > 10 ? 10 : v;
        const y = v / 5 * (i1[i] - i2[i]);
        if (om & 2) o2[i] = rail(y);
        if (om & 1) o1[i] = rail(-y);
      }
    }
    setOS(fs) { this.fs = fs; }
    reset() { this.resets++; }
    setSalt(s) { this.salt = s; }
  }
  class Gn { // x1 + x2 → a leaky state s ← 0.5 s + k (x1 + x2) → y = rail(s + 0.1), yn = −y (a loop's member)
    constructor(h) { init(this, h, 2); this.s = 0; }
    ctl(cc) { tick(this, cc); this.b = this.p[0]; }
    flush() { this.nf++; if (Math.abs(this.s) < 1e-30) this.s = 0; }
    run(sec, i0, n) {
      const x1 = this.ins[0], x2 = this.ins[1], y = this.outs[0], yn = this.outs[1], k = this.b, om = this.om;
      this.comp |= om;
      let s = this.s;
      for (let i = i0, e = i0 + n; i < e; i++) {
        s = 0.5 * s + k * (x1[i] + x2[i]);
        if (!(s === s)) s = 0;
        const v = rail(s + 0.1);
        if (om & 1) y[i] = v;
        if (om & 2) yn[i] = -v;
      }
      this.s = s;
    }
    setOS(fs) { this.fs = fs; }
    reset() { this.s = 0; this.resets++; }
    setSalt(s) { this.salt = s; }
  }
  class Nz { // 0 NOISE (wh1 = wh2: one source) · 1 LP (li → lo) · 2 HP (hi → ho): three sections, one ctl
    constructor(h) { init(this, h, 4); this.outs[1] = this.outs[0]; this.r = 1; this.l = 0; this.hh = 0; this.seed(); }
    seed() { this.r = ((0x9E3779B9 ^ this.salt ^ Math.imul(this.n + 1, 2654435761)) >>> 0) || 1; }
    ctl(cc) { tick(this, cc); this.b = this.p[0]; }
    flush() { this.nf++; }
    run(sec, i0, n) {
      const e = i0 + n, om = this.om;
      this.comp |= om;
      if (sec === 0) {
        const w = this.outs[0];
        let r = this.r;
        for (let i = i0; i < e; i++) { r ^= r << 13; r ^= r >>> 17; r ^= r << 5; r >>>= 0; if (om & 3) w[i] = r / 4294967296 * 2 - 1; }
        this.r = r;
      } else if (sec === 1) {
        const x = this.ins[0], o = this.outs[2], a = this.p[0];
        let l = this.l;
        for (let i = i0; i < e; i++) { l += (x[i] - l) * a; if (om & 4) o[i] = rail(l); }
        this.l = l;
      } else {
        const x = this.ins[1], o = this.outs[3], a = this.p[1];
        let hh = this.hh;
        for (let i = i0; i < e; i++) { const v = x[i]; hh += (v - hh) * a; if (om & 8) o[i] = rail(v - hh); }
        this.hh = hh;
      }
    }
    setOS(fs) { this.fs = fs; }
    reset() { this.l = this.hh = 0; this.seed(); this.resets++; }
    setSalt(s) { this.salt = s; }
  }
  class Att { // three passive attenuators o_k = i_k · a_k / 10 (i2 ← i1, i3 ← i2 when unpatched): a section each
    constructor(h) { init(this, h, 3); }
    ctl(cc) { tick(this, cc); }
    flush() { this.nf++; }
    run(sec, i0, n) {
      const x = this.ins[sec], o = this.outs[sec], a = this.p[sec] / 10;
      this.comp |= this.om;
      if (this.om & (1 << sec)) for (let i = i0, e = i0 + n; i < e; i++) o[i] = x[i] * a;
    }
    setOS(fs) { this.fs = fs; }
    reset() { this.resets++; }
    setSalt(s) { this.salt = s; }
  }
  class Drv { // f1, f2 → the rear link only: dv = f1 + f2 + fq, dw = 0.5 + 0.1 f2
    constructor(h) { init(this, h, 2); }
    ctl(cc) { tick(this, cc); this.b = this.p[0]; }
    flush() { this.nf++; }
    run(sec, i0, n) {
      const f1 = this.ins[0], f2 = this.ins[1], dv = this.outs[0], dw = this.outs[1], b = this.b, om = this.om;
      this.comp |= om;
      for (let i = i0, e = i0 + n; i < e; i++) { if (om & 1) dv[i] = f1[i] + f2[i] + b; if (om & 2) dw[i] = 0.5 + 0.1 * f2[i]; }
    }
    setOS(fs) { this.fs = fs; }
    reset() { this.resets++; }
    setSalt(s) { this.salt = s; }
  }
  class Slv { // dc + the link's dv (1 V/oct) → saw; pw = the link's dw (what the link carries)
    constructor(h) { init(this, h, 2); this.ph = 0; }
    ctl(cc) { tick(this, cc); this.b = this.p[0]; }
    flush() { this.nf++; }
    run(sec, i0, n) {
      const dc = this.ins[0], dv = this.ins[1], dw = this.ins[2], saw = this.outs[0], pw = this.outs[1], k = 110 / this.fs, om = this.om;
      this.comp |= om;
      let ph = this.ph;
      for (let i = i0, e = i0 + n; i < e; i++) {
        let dt = k * Math.pow(2, rail(dv[i] + dc[i]) + this.b);
        if (!(dt < 0.45)) dt = 0.45;
        ph += dt; if (ph >= 1) ph -= 1;
        if (om & 1) saw[i] = 5 * (2 * ph - 1);
        if (om & 2) pw[i] = dw[i];
      }
      this.ph = ph;
    }
    setOS(fs) { this.fs = fs; }
    reset() { this.ph = 0; this.resets++; }
    setSalt(s) { this.salt = s; }
  }
  class Env { // trg (S): closed → toward 5 V, open → toward 0
    constructor(h) { init(this, h, 1); this.v = 0; }
    ctl(cc) { tick(this, cc); this.b = 0.01 * this.p[0]; }
    flush() { this.nf++; if (this.v < 1e-30) this.v = 0; }
    run(sec, i0, n) {
      const tg = this.ins[0], o = this.outs[0], a = this.b, om = this.om;
      this.comp |= om;
      let v = this.v;
      for (let i = i0, e = i0 + n; i < e; i++) { if (tg[i] > 0.5) v += (5 - v) * a; else v -= v * a * 0.5; if (om & 1) o[i] = v; }
      this.v = v;
    }
    setOS(fs) { this.fs = fs; }
    reset() { this.v = 0; this.resets++; }
    setSalt(s) { this.salt = s; }
  }
  class Pr { // a probe: x → y, s → ys (exactly what the inputs carry)
    constructor(h) { init(this, h, 2); }
    ctl(cc) { tick(this, cc); }
    flush() { this.nf++; }
    run(sec, i0, n) {
      const x = this.ins[0], s = this.ins[1], y = this.outs[0], ys = this.outs[1], om = this.om;
      this.comp |= om;
      for (let i = i0, e = i0 + n; i < e; i++) { if (om & 1) y[i] = x[i]; if (om & 2) ys[i] = s[i]; }
    }
    setOS(fs) { this.fs = fs; }
    reset() { this.resets++; }
    setSalt(s) { this.salt = s; }
  }
  class Sq { // (9b) events and lamps: ev(k) waits in its own ring for the next ctl (k 0 counts up, 1 zeroes the count); y = count + x; lamp = count & 7
    constructor(h) { init(this, h, 1); this.cnt = 0; this.lamp = 0; this.R = new Int32Array(8); this.en = 0; this.evs = 0; this.at = -1; }
    ev(k) { this.evs++; if (this.en < 8) this.R[this.en++] = k; }
    ctl(cc) { tick(this, cc); for (let j = 0; j < this.en; j++) { if (this.R[j] === 0) this.cnt++; else this.cnt = 0; this.at = cc; } this.en = 0; this.lamp = this.cnt & 7; }
    flush() { this.nf++; }
    run(sec, i0, n) { const x = this.ins[0], y = this.outs[0], c = this.cnt; this.comp |= this.om; for (let i = i0, e = i0 + n; i < e; i++) y[i] = c + x[i]; }
    setOS(fs) { this.fs = fs; }
    reset() { this.cnt = 0; this.en = 0; this.lamp = 0; this.resets++; }
    setSalt(s) { this.salt = s; }
  }
  const J = (id, dir, sig, sec, norm) => (norm ? { id, dir, sig, sec, norm } : { id, dir, sig, sec });
  const mult = (g, sec) => [1, 2, 3, 4].map(k => J(g + k, 'any', 'v', sec));
  globalThis.PatchStub = Object.freeze({
    id: 'stub',
    T: { ctl: Ctl, osc: Osc, vcf: Vcf, vca: Vca, gn: Gn, nz: Nz, att: Att, drv: Drv, slv: Slv, env: Env, pr: Pr, sq: Sq },
    EV: { sq: ['inc', 'zero'] }, LAMPS: { sq: ['l1', 'l2', 'l3'] },
    JACKS: {
      ctl: [J('kp', 'out', 'v', 0), J('ks', 'out', 's', 0), J('kg', 'out', 'v', 0), J('m1', 'in', 'v', 1), J('m2', 'in', 'v', 1), J('mo', 'out', 'v', 1),
        ...mult('a', 2), ...mult('b', 3), J('si', 'in', 's', 4), J('so', 'out', 'v', 4), J('out', 'in', 'v', 5)],
      osc: [J('f1', 'in', 'v', 0), J('f2', 'in', 'v', 0), J('sy', 'in', 's', 0), J('saw', 'out', 'v', 0), J('sq', 'out', 'v', 0)],
      vcf: [J('in', 'in', 'v', 0), J('c1', 'in', 'v', 0), J('lp', 'out', 'v', 0)],
      vca: [J('i1', 'in', 'v', 0), J('i2', 'in', 'v', 0), J('c1', 'in', 'v', 0), J('o1', 'out', 'v', 0), J('o2', 'out', 'v', 0)],
      gn: [J('x1', 'in', 'v', 0), J('x2', 'in', 'v', 0), J('y', 'out', 'v', 0), J('yn', 'out', 'v', 0)],
      nz: [J('wh1', 'out', 'v', 0), J('wh2', 'out', 'v', 0), J('li', 'in', 'v', 1), J('lo', 'out', 'v', 1), J('hi', 'in', 'v', 2), J('ho', 'out', 'v', 2)],
      att: [J('i1', 'in', 'v', 0), J('o1', 'out', 'v', 0), J('i2', 'in', 'v', 1, 'i1'), J('o2', 'out', 'v', 1), J('i3', 'in', 'v', 2, 'i2'), J('o3', 'out', 'v', 2)],
      drv: [J('f1', 'in', 'v', 0), J('f2', 'in', 'v', 0)],
      slv: [J('dc', 'in', 'v', 0), J('saw', 'out', 'v', 0), J('pw', 'out', 'v', 0)],
      env: [J('trg', 'in', 's', 0), J('out', 'out', 'v', 0)],
      pr: [J('x', 'in', 'v', 0), J('s', 'in', 's', 0), J('y', 'out', 'v', 0), J('ys', 'out', 'v', 0)],
      sq: [J('x', 'in', 'v', 0), J('y', 'out', 'v', 0)],
    },
    PARAMS: {
      ctl: [['ov', 7], ['x1', 10], ['x2', 10], ['pr', 0, 1]], osc: [['fq', 0], ['rg', 2, 1]], vcf: [['fc', 0]], vca: [['fc', 0]], gn: [['k', 0.9]],
      nz: [['lp', 0.2], ['hp', 0.05]], att: [['a1', 10], ['a2', 10], ['a3', 10]], drv: [['fq', 0]], slv: [['fq', 0]], env: [['t', 1]], pr: [], sq: [],
    },
    SINK: 'out',
    LINK: { slv: { from: 'drv', def: [0, 0.5] } },
  });
})();`;

/* ------------------------------------------------------------------ helpers */
// (results built in the vm context carry its Array.prototype: plain() copies them for deepStrictEqual)
const plain = x => JSON.parse(JSON.stringify(x));
function scope() {
  const ctx = vm.createContext(vm.constants.DONT_CONTEXTIFY);
  vm.runInContext(SRC, ctx, { filename: 'patch-dsp.js' });
  vm.runInContext(STUB, ctx, { filename: 'patch-stub.js' });
  return { ctx, PD: ctx.PatchDSP, F: ctx.PatchStub, made: () => ctx.STUBS, sched: (pg, F) => plain(ctx.PatchDSP.schedule(pg, F)) };
}
const mon = M => plain(M.mon());
const SC = scope(); // the shared scope (tests that count or stub constructors make their own)
const port = (F, type, id) => { const k = F.JACKS[type].findIndex(j => j.id === id); if (k < 0) throw new Error('no jack ' + type + '.' + id); return k; };
// [[n, type, drv?]], [[aN, 'jack', bN, 'jack', g?]] → a payload
function pgOf(F, mods, cords) {
  const ty = new Map(mods.map(m => [m[0], m[1]]));
  return { v: 1, f: 'stub', mods: mods.map(m => [m[0], m[1], m[2] === undefined ? -1 : m[2]]),
    cords: cords.map(c => [c[0], port(F, ty.get(c[0]), c[1]), c[2], port(F, ty.get(c[2]), c[3]), c[4] === undefined ? 1 : c[4]]) };
}
function machine(S, os = 4, sr = 48000, salt = 0) {
  const errs = [], inst = { OS: os, fs: sr * os, salt, bend: 0, wheel: 0, at: 0, sustain: 0, ptFail(why) { errs.push(why); } };
  const M = S.PD.create(inst, 'stub');
  assert.ok(M, 'a machine');
  return { M, inst, errs };
}
// frames from F0 at the OS rate: events [[frame, fn(M)]] at span starts (frames multiples of 4), spans from span(F)
function play(M, os, F0, frames, ev = [], span = () => 128) {
  const out = new Float64Array(frames * os), buf = new Float64Array(128 * os), E = ev.slice().sort((a, b) => a[0] - b[0]);
  let ei = 0;
  for (let F = F0; F < F0 + frames;) {
    while (ei < E.length && E[ei][0] <= F) E[ei++][1](M);
    let n = Math.min(span(F), F0 + frames - F, 128);
    if (ei < E.length && F + n > E[ei][0]) n = E[ei][0] - F;
    buf.fill(0, 0, n * os);
    M.render(buf, n * os, F);
    out.set(buf.subarray(0, n * os), (F - F0) * os);
    F += n;
  }
  return out;
}
const bytes = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
function firstDiff(a, b) {
  if (a.length !== b.length) return -2;
  if (bytes(a).equals(bytes(b))) return -1;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return i;
  return -3;
}
const sameBits = (a, b, what) => { const d = firstDiff(a, b); assert.equal(d, -1, `${what}: first difference at ${d} (${a[d]} vs ${b[d]})`); };
const peak = a => { let m = 0; for (const x of a) if (Math.abs(x) > m) m = Math.abs(x); return m; };
const finite = a => a.every(Number.isFinite);
const db = x => (20 * Math.log10(x)).toFixed(1);
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const stubOf = (S, n) => { const L = S.made().filter(m => m.n === n); return L[L.length - 1]; };
const note = (n, on = 1) => M => M.note(n, on ? 0.8 : 0, on);
const nodeIx = (sch, n, s) => sch.nodes.findIndex(([a, b]) => a === n && b === s);
const stepOfNode = (sch, v) => sch.steps.findIndex(st => st.nodes.includes(v));

// The independent per-sample interpreter (direct cords only; inputs summed g · source in (source n, slot) order): the whole
// schedule each sample, a back-edge (PatchDSP.schedule's) read one sample late (bounded as the evaluator's), MAIN OUT × og
function reference(S, pg, os, frames, ev = []) {
  const { F } = S, sch = S.sched(pg, F), fs = 48000 * os, CH = 4 * os, LATE = 1e4;
  const ty = new Map(pg.mods.map(m => [m[0], m[1]]));
  const slotOf = (type, k) => { const J = F.JACKS[type]; let s = 0; for (let i = 0; i < k; i++) if (J[i].dir === J[k].dir) s++; return s; };
  const mods = new Map();
  for (const [n, type] of pg.mods) {
    const m = new F.T[type]({ fs, OS: os, n, salt: 0, inst: null, type }), nIn = F.JACKS[type].filter(j => j.dir === 'in').length;
    m.ins = []; for (let k = 0; k < nIn + (type === 'slv' ? 2 : 0); k++) m.ins.push(new Float64Array(32));
    m.p = Float64Array.from(F.PARAMS[type], e => e[1]); m.t = m.p.slice(); m.mv = 1; m.om = (1 << m.outs.length) - 1;
    mods.set(n, m);
  }
  const src = new Map();
  for (const [aN, aP, bN, bP, g] of pg.cords) { const k = bN + ':' + slotOf(ty.get(bN), bP); if (!src.has(k)) src.set(k, []); src.get(k).push([aN, slotOf(ty.get(aN), aP), g]); }
  for (const L of src.values()) L.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const back = new Set(sch.back.map(([u, v]) => u + ',' + v)), nix = new Map(sch.nodes.map(([n, s], v) => [n + ':' + s, v]));
  const secOfOut = (n, o) => { let s = 0; for (const j of F.JACKS[ty.get(n)]) if (j.dir === 'out') { if (s === o) return j.sec || 0; s++; } return 0; };
  const inSlots = (n, sec) => { const r = []; let s = 0; for (const j of F.JACKS[ty.get(n)]) if (j.dir === 'in') { if ((j.sec || 0) === sec) r.push(s); s++; } return r; };
  const live = [...new Set(sch.nodes.filter((_, v) => sch.live[v]).map(([n]) => n))].sort((a, b) => a - b);
  const last = new Map(), out = new Float64Array(frames * os), m0 = mods.get(0), sinkSlot = slotOf('ctl', port(F, 'ctl', 'out'));
  const val = (n, k, v, i) => {
    const L = src.get(n + ':' + k) || [];
    let x = 0;
    L.forEach(([a, o, g], j) => {
      const late = back.has(nix.get(a + ':' + secOfOut(a, o)) + ',' + v);
      let y = mods.get(a).outs[o][i];
      if (late) { y = i > 0 ? mods.get(a).outs[o][i - 1] : (last.get(a + ':' + o) || 0); y = y > LATE ? LATE : y < -LATE ? -LATE : y === y ? y : 0; }
      x = j === 0 ? g * y : x + g * y;
    });
    return x;
  };
  for (let c = 0; c < frames / 4; c++) {
    for (const [f, n, vel, on] of ev) if (f === c * 4) m0.note(n, vel, on);
    for (const n of live) { const m = mods.get(n); if (c % 32 === 0) m.flush(); m.ctl(c); m.mv = 0; }
    const g = m0.og;
    for (let i = 0; i < CH; i++) {
      for (const st of sch.steps) for (const v of st.nodes) {
        const [n, sec] = sch.nodes[v], m = mods.get(n);
        if (st.sink) { if ((src.get('0:' + sinkSlot) || []).length) out[c * CH + i] += val(0, sinkSlot, v, i) * g; continue; }
        for (const k of inSlots(n, sec)) m.ins[k][i] = val(n, k, v, i);
        m.run(sec, i, 1);
      }
    }
    for (const [n, m] of mods) m.outs.forEach((b, o) => last.set(n + ':' + o, b[CH - 1]));
  }
  return out;
}

/* ------------------------------------------------------------------ loading */
test('PatchDSP: a frozen global; create() → null without the family (looked up at create), never a throw', () => {
  const { PD, ctx } = SC;
  assert.ok(Object.isFrozen(PD));
  for (const k of ['create', 'schedule']) assert.equal(typeof PD[k], 'function', k);
  assert.equal(PD.CHMAX, 32);
  assert.equal(PD.create({ OS: 4, fs: 192000 }, 'moog'), ctx.PatchMoog ? PD.create({ OS: 4, fs: 192000 }, 'moog') : null, 'no PatchMoog in this scope → null');
  for (const f of [undefined, null, '', 'Stub', 'DSP', 'dsp', 7, {}, '__proto__', 'x y']) assert.equal(PD.create({ OS: 4 }, f), null, String(f));
  assert.ok(PD.create(null, 'stub'), 'a missing inst: defaults (OS 1, 48 kHz)');
  // a scope where the family arrives after patch-dsp.js (the scripts load in parallel)
  const c2 = vm.createContext(vm.constants.DONT_CONTEXTIFY);
  vm.runInContext(SRC, c2);
  assert.equal(c2.PatchDSP.create({ OS: 2 }, 'stub'), null);
  vm.runInContext(STUB, c2);
  assert.ok(c2.PatchDSP.create({ OS: 2 }, 'stub'), 'found at create');
  // a broken script never throws out of its load
  const c3 = vm.createContext(vm.constants.DONT_CONTEXTIFY);
  c3.console = { error() {} };
  c3.WeakMap = undefined;
  vm.runInContext(SRC, c3);
  assert.equal(c3.PatchDSP, null);
});

/* ------------------------------------------------------------------ the schedule */
test('schedule: a chain, its order and live set; idle modules; a mixer with mo unpatched is idle; the KBD → osc → MIX → OUT patch is no loop', () => {
  const { sched, F } = SC;
  const pg = pgOf(F, [[0, 'ctl'], [1, 'osc'], [2, 'vcf'], [3, 'vca'], [4, 'osc'], [5, 'pr']], [
    [0, 'kp', 1, 'f1'], [1, 'saw', 2, 'in'], [2, 'lp', 3, 'i1'], [0, 'kg', 3, 'c1'], [3, 'o2', 0, 'out'], [4, 'saw', 5, 'x']]);
  const s = sched(pg, F);
  assert.deepEqual(s.why, []);
  const liveN = s.nodes.filter((_, v) => s.live[v]);
  assert.deepEqual(liveN, [[0, 0], [0, 5], [1, 0], [2, 0], [3, 0]], 'KBD, OUT and the chain; the second osc and the probe idle, MIX / S→V idle');
  assert.deepEqual(s.steps.map(st => st.nodes.map(v => s.nodes[v])), [[[0, 0]], [[1, 0]], [[2, 0]], [[3, 0]], [[0, 5]]], 'topological, the sink last');
  assert.ok(s.steps.every(st => st.loop === 0) && s.steps.at(-1).sink === 1 && s.back.length === 0);
  // the controller's keyboard → an oscillator → its mixer → MAIN OUT: sections keep it a chain
  const p2 = pgOf(F, [[0, 'ctl'], [1, 'osc']], [[0, 'kp', 1, 'f1'], [1, 'saw', 0, 'm1'], [0, 'mo', 0, 'out']]), s2 = sched(p2, F);
  assert.deepEqual(s2.steps.map(st => [st.loop, st.nodes.map(v => s2.nodes[v].join('.'))]), [[0, ['0.0']], [0, ['1.0']], [0, ['0.1']], [0, ['0.5']]]);
  // the mixer fed but its mo going nowhere: idle (and so are its sources)
  const s3 = sched(pgOf(F, [[0, 'ctl'], [1, 'osc']], [[0, 'kp', 1, 'f1'], [1, 'saw', 0, 'm1']]), F);
  assert.deepEqual(s3.nodes.filter((_, v) => s3.live[v]), [[0, 5]], 'only MAIN OUT (unpatched)');
  assert.deepEqual(s3.steps.map(st => st.sink), [1]);
});

test('schedule: loops — a loop of 3 (one back-edge, sources-first), a self-cord, two loops sharing a node (one component), a 923-like module fed through itself is no loop', () => {
  const { sched, F } = SC;
  // g1 → g2 → g3 → g1, g3 → OUT
  const s = sched(pgOf(F, [[0, 'ctl'], [1, 'gn'], [2, 'gn'], [3, 'gn']], [[1, 'y', 2, 'x1'], [2, 'y', 3, 'x1'], [3, 'y', 1, 'x1'], [3, 'yn', 0, 'out']]), F);
  const L = s.steps.filter(st => st.loop === 1);
  assert.equal(L.length, 1);
  assert.deepEqual(L[0].nodes.map(v => s.nodes[v][0]), [1, 2, 3], 'the farthest from MAIN OUT first');
  assert.deepEqual(s.back.map(([u, v]) => [s.nodes[u][0], s.nodes[v][0]]), [[3, 1]], 'one back-edge: 3 → 1');
  // a self-cord: a loop of one member, its own output late
  const s2 = sched(pgOf(F, [[0, 'ctl'], [1, 'gn']], [[1, 'y', 1, 'x1'], [1, 'yn', 0, 'out']]), F);
  assert.deepEqual(s2.steps.map(st => st.loop), [1, 0]);
  assert.deepEqual(s2.back.map(([u, v]) => [s2.nodes[u][0], s2.nodes[v][0]]), [[1, 1]]);
  // two loops sharing g2: g1 ↔ g2, g2 ↔ g3 → one component of three
  const s3 = sched(pgOf(F, [[0, 'ctl'], [1, 'gn'], [2, 'gn'], [3, 'gn']], [[1, 'y', 2, 'x1'], [2, 'y', 1, 'x1'], [2, 'yn', 3, 'x1'], [3, 'y', 2, 'x2'],
    [1, 'yn', 0, 'out']]), F);
  const L3 = s3.steps.filter(st => st.loop === 1);
  assert.equal(L3.length, 1);
  assert.deepEqual(L3[0].nodes.map(v => s3.nodes[v][0]).sort(), [1, 2, 3]);
  assert.equal(s3.back.length, 2, 'two back-edges (one per cycle)');
  // a 923-like module: its LP feeds a module that feeds its HP — sections, no loop; and its noise into its own LP
  const s4 = sched(pgOf(F, [[0, 'ctl'], [1, 'nz'], [2, 'vcf']], [[1, 'wh1', 1, 'li'], [1, 'lo', 2, 'in'], [2, 'lp', 1, 'hi'], [1, 'ho', 0, 'out']]), F);
  assert.ok(s4.steps.every(st => st.loop === 0), 'no loop step');
  assert.deepEqual(s4.steps.map(st => s4.nodes[st.nodes[0]].join('.')), ['1.0', '1.1', '2.0', '1.2', '0.5']);
});

test('schedule: multiples (fan-out, a sum, one driving another), the normals (995-like chain), a driven module after its driver', () => {
  const { sched, F } = SC;
  // kp → a1; a2 → osc1.f1, a3 → osc2.f1; both → MIX → OUT: a fan-out, no loop, the multiple resolved to edges
  const s = sched(pgOf(F, [[0, 'ctl'], [1, 'osc'], [2, 'osc']], [[0, 'kp', 0, 'a1'], [0, 'a2', 1, 'f1'], [0, 'a3', 2, 'f1'], [1, 'saw', 0, 'm1'],
    [2, 'sq', 0, 'm2'], [0, 'mo', 0, 'out']]), F);
  const e = s.edges.map(([u, v]) => s.nodes[u].join('.') + '>' + s.nodes[v].join('.'));
  assert.ok(e.includes('0.0>1.0') && e.includes('0.0>2.0'), 'KBD → each oscillator (through MULT A)');
  assert.ok(!s.nodes.some(([n, sec]) => n === 0 && (sec === 2 || sec === 3)), 'no node for a multiple');
  assert.ok(s.steps.every(st => st.loop === 0));
  // a multiple driving another (kp → a1, a4 → b1, b2 → osc): KBD → osc; the passive loop back (b3 → a2) refused
  const s2 = sched(pgOf(F, [[0, 'ctl'], [1, 'osc']], [[0, 'kp', 0, 'a1'], [0, 'a4', 0, 'b1'], [0, 'b2', 1, 'f1'], [0, 'b3', 0, 'a2'], [1, 'saw', 0, 'out']]), F);
  assert.deepEqual(s2.why, ['loop']);
  assert.ok(s2.edges.some(([u, v]) => s2.nodes[u].join('.') === '0.0' && s2.nodes[v].join('.') === '1.0'));
  // the normals: att i1 ← osc; i2, i3 unpatched → its sections 1 and 2 read the oscillator; patching i2 breaks the chain there
  const p3 = pgOf(F, [[0, 'ctl'], [1, 'osc'], [2, 'att'], [3, 'gn']], [[1, 'saw', 2, 'i1'], [2, 'o3', 0, 'out']]), s3 = sched(p3, F);
  assert.deepEqual(s3.nodes.filter((_, v) => s3.live[v]).map(x => x.join('.')), ['0.5', '1.0', '2.2'], 'att section 2 (i3 ← i2 ← i1) live, sections 0 / 1 not');
  const s4 = sched(pgOf(F, [[0, 'ctl'], [1, 'osc'], [2, 'att'], [3, 'gn']], [[1, 'saw', 2, 'i1'], [3, 'y', 2, 'i2'], [2, 'o3', 0, 'out']]), F);
  assert.deepEqual(s4.nodes.filter((_, v) => s4.live[v]).map(x => x.join('.')), ['0.5', '2.2', '3.0'], 'i2 patched: i3 follows it, not the osc');
  // the rear link: drv → slv (an edge), the driven module after its driver; drv idle once undriven
  const s5 = sched(pgOf(F, [[0, 'ctl'], [1, 'drv'], [2, 'slv', 1]], [[0, 'kp', 1, 'f1'], [2, 'saw', 0, 'out']]), F);
  assert.deepEqual(s5.steps.map(st => s5.nodes[st.nodes[0]].join('.')), ['0.0', '1.0', '2.0', '0.5']);
  const s6 = sched(pgOf(F, [[0, 'ctl'], [1, 'drv'], [2, 'slv']], [[0, 'kp', 1, 'f1'], [2, 'saw', 0, 'out']]), F);
  assert.deepEqual(s6.nodes.filter((_, v) => s6.live[v]).map(x => x.join('.')), ['0.5', '2.0'], 'undriven: the driver idle');
});

// a random graph of stub modules: random jacks of the right direction and plug (multiples, self-cords, loops, the
// controller's sections, links), MAIN OUT patched mostly
const TYPES = ['osc', 'vcf', 'vca', 'gn', 'nz', 'att', 'pr', 'env', 'drv', 'slv', 'gn', 'vca'];
function randGraph(F, rnd, nMods, nCords) {
  const mods = [[0, 'ctl', -1]];
  for (let k = 1; k <= nMods; k++) mods.push([k, TYPES[Math.floor(rnd() * TYPES.length)], -1]);
  for (const m of mods) if (m[1] === 'slv' && rnd() < 0.7) { const d = mods.filter(x => x[1] === 'drv'); if (d.length) m[2] = d[Math.floor(rnd() * d.length)][0]; }
  const jacks = (dirs) => { const L = []; for (const [n, type] of mods) F.JACKS[type].forEach((j, k) => { if (dirs.includes(j.dir)) L.push([n, k, j]); }); return L; };
  const A = jacks(['out', 'any']), B = jacks(['in', 'any']), cords = [];
  for (let c = 0; c < nCords; c++) {
    const a = A[Math.floor(rnd() * A.length)], bs = B.filter(b => b[2].sig === a[2].sig), b = bs[Math.floor(rnd() * bs.length)];
    if (!b) continue;
    cords.push([a[0], a[1], b[0], b[1], rnd() < 0.15 ? Math.round(rnd() * 40) / 10 : 1]);
  }
  if (rnd() < 0.85) { const o = A.filter(a => a[2].sig === 'v' && a[2].dir === 'out'), a = o[Math.floor(rnd() * o.length)]; cords.push([a[0], a[1], 0, port(F, 'ctl', 'out'), 1]); }
  return { v: 1, f: 'stub', mods, cords };
}
test('schedule: 500 random graphs — every live node once, forward edges after their source, back-edges only inside loop steps, loops strongly connected, live = MAIN OUT\'s ancestors', () => {
  const { sched, F } = SC, rnd = mulberry(0x9a1);
  let loops = 0, backs = 0;
  for (let g = 0; g < 500; g++) {
    const pg = randGraph(F, rnd, 2 + Math.floor(rnd() * 14), 2 + Math.floor(rnd() * 30)), s = sched(pg, F), N = s.nodes.length;
    const tag = `graph ${g}`;
    // live: the reverse closure of the sink over the edges
    const sink = nodeIx(s, 0, 5), want = new Uint8Array(N), q = [sink];
    want[sink] = 1;
    for (let h = 0; h < q.length; h++) for (const [u, v] of s.edges) if (v === q[h] && !want[u]) { want[u] = 1; q.push(u); }
    assert.deepEqual(s.live, Array.from(want), tag + ': live = MAIN OUT\'s ancestors');
    const seen = new Int32Array(N).fill(-1), pos = new Int32Array(N);
    s.steps.forEach((st, k) => st.nodes.forEach((v, p) => { assert.equal(seen[v], -1, tag + ': a node twice'); seen[v] = k; pos[v] = p; }));
    for (let v = 0; v < N; v++) assert.equal(seen[v] >= 0, !!s.live[v], tag + ': scheduled iff live');
    assert.equal(s.steps.at(-1).sink, 1, tag + ': the sink last');
    const back = new Set(s.back.map(([u, v]) => u * N + v));
    for (const [u, v] of s.edges) {
      if (!s.live[v]) continue;
      assert.ok(s.live[u], tag + ': a live node\'s source is live');
      if (seen[u] !== seen[v]) { assert.ok(seen[u] < seen[v], tag + ': a forward edge after its source'); assert.ok(!back.has(u * N + v)); }
      else { assert.equal(s.steps[seen[u]].loop, 1, tag + ': an edge inside a step → a loop step'); assert.equal(back.has(u * N + v), pos[u] >= pos[v], tag + ': late iff to an earlier or the same member'); }
    }
    for (const [u, v] of s.back) assert.equal(seen[u], seen[v], tag + ': back-edges only inside loop steps');
    for (const st of s.steps) {
      if (st.loop === 0) { assert.ok(!s.edges.some(([u, v]) => u === st.nodes[0] && v === u), tag + ': a block step has no self-edge'); continue; }
      loops++; backs += s.back.filter(([u]) => st.nodes.includes(u)).length;
      const M = new Set(st.nodes);
      for (const a of st.nodes) { // every member reaches every other inside the step
        const r = new Set([a]), qq = [a];
        for (let h = 0; h < qq.length; h++) for (const [u, v] of s.edges) if (u === qq[h] && M.has(v) && !r.has(v)) { r.add(v); qq.push(v); }
        assert.ok(st.nodes.every(b => r.has(b)), tag + ': a loop step is strongly connected');
      }
    }
  }
  assert.ok(loops > 100 && backs >= loops, `the fuzz exercised loops (${loops} loop steps, ${backs} back-edges)`);
});

test('the machine runs what schedule() compiles: 100 random graphs, the same steps in the same order (MAIN OUT the evaluator\'s)', () => {
  const S = SC, rnd = mulberry(0x51ed);
  for (let g = 0; g < 100; g++) {
    const pg = randGraph(S.F, rnd, 2 + Math.floor(rnd() * 12), 2 + Math.floor(rnd() * 24)), s = S.sched(pg, S.F), { M } = machine(S, 2);
    M.graph(pg);
    const want = s.steps.filter(st => !st.sink).map(st => ({ loop: st.loop, nodes: st.nodes.map(v => s.nodes[v]) }));
    assert.deepEqual(mon(M).steps, want, `graph ${g}`);
  }
});

test('schedule: hostile payloads — each offending item dropped with its reason, the rest kept; never a throw', () => {
  const { sched, F } = SC;
  const P = port.bind(null, F);
  for (const bad of [null, 7, 'x', {}, { mods: 3, cords: [] }, { mods: [], cords: null }]) assert.deepEqual(sched(bad, F).why, ['graph']);
  const pg = { v: 1, f: 'stub', mods: [[0, 'ctl', -1], [1, 'osc', -1], [1, 'vcf', -1], [2, 'nope', -1], 'x', [-1, 'osc'], [5000, 'osc'], [3, 'gn', 7], [4, 'slv', 1], [5, 'vca', -1]],
    cords: [[1, P('osc', 'saw'), 5, P('vca', 'i1'), 1], [9, 0, 5, 0, 1], [2, 0, 5, 0, 1], [1, 99, 5, 0, 1], [1, P('osc', 'f1'), 5, P('vca', 'i1'), 1],
      [1, P('osc', 'saw'), 5, P('vca', 'o1'), 1], [0, P('ctl', 'ks'), 5, P('vca', 'c1'), 1], [1, P('osc', 'saw'), 5, P('vca', 'c1'), NaN], 'c',
      [1, P('osc', 'sq'), 5, P('vca', 'c1'), 9], [5, P('vca', 'o2'), 0, P('ctl', 'out')], [0, P('ctl', 'a1'), 0, P('ctl', 'a2'), 1]] };
  const s = sched(pg, F);
  // a missing module, an input as a source, into an output, S ↔ 1/4", a NaN gain, a non-array: 'cord' (a cord to the unknown
  // type's module: silent); a bad port; a multiple into itself: 'loop'; a duplicate n and three bad entries: 'mod'; a drv on a
  // type without a link and one naming a module of the wrong type: 'drv'
  assert.deepEqual(s.why.slice().sort(), ['cord', 'cord', 'cord', 'cord', 'cord', 'cord', 'drv', 'drv', 'loop', 'mod', 'mod', 'mod', 'mod', 'port', 'type']);
  assert.deepEqual([...new Set(s.nodes.map(x => x[0]))], [0, 1, 3, 4, 5], 'the duplicate n, the unknown type and the bad entries dropped');
  const e = s.edges.map(([u, v]) => s.nodes[u].join('.') + '>' + s.nodes[v].join('.')).sort();
  assert.deepEqual(e, ['1.0>5.0', '5.0>0.5'], 'saw → i1 and sq → c1 (g 9 → 4) kept, the rest dropped');
  // limits: 64 modules, 256 connections
  const big = { mods: [[0, 'ctl', -1]], cords: [] };
  for (let k = 1; k < 80; k++) big.mods.push([k, 'gn', -1]);
  for (let k = 0; k < 300; k++) big.cords.push([1 + (k % 60), P('gn', 'y'), 1 + ((k * 7) % 60), P('gn', 'x1'), 1]);
  const sb = sched(big, F);
  assert.equal(new Set(sb.nodes.map(x => x[0])).size, 64);
  assert.equal(sb.why.filter(w => w === 'limit').length, 16 + 44);
});

/* ------------------------------------------------------------------ the chunk loop */
test('a loop step = the per-sample interpreter with the same back-edges, bit for bit (a loop of 3 with sums and gains, a self-cord, a loop fed by an oscillator)', () => {
  const S = SC;
  const graphs = [
    pgOf(S.F, [[0, 'ctl'], [1, 'gn'], [2, 'gn'], [3, 'gn'], [4, 'osc']], [[0, 'kp', 4, 'f1'], [4, 'saw', 1, 'x1', 0.3], [1, 'y', 2, 'x1'], [2, 'y', 3, 'x1', 0.7],
      [3, 'yn', 1, 'x2', 0.5], [2, 'yn', 1, 'x2', 0.25], [3, 'y', 0, 'out']]),
    pgOf(S.F, [[0, 'ctl'], [1, 'gn'], [2, 'vcf']], [[0, 'kg', 1, 'x2'], [1, 'y', 1, 'x1', 0.6], [1, 'yn', 2, 'in'], [2, 'lp', 2, 'c1'], [2, 'lp', 0, 'out']]),
    pgOf(S.F, [[0, 'ctl'], [1, 'osc'], [2, 'vca'], [3, 'osc'], [4, 'vcf']], [[0, 'kp', 1, 'f1'], [1, 'sq', 2, 'i1'], [2, 'o2', 3, 'f2', 0.1], [3, 'saw', 1, 'f2', 0.05],
      [3, 'saw', 4, 'in'], [0, 'kg', 2, 'c1'], [4, 'lp', 0, 'out'], [2, 'o1', 0, 'out', 0.5]]),
  ];
  for (const [g, pg] of graphs.entries()) for (const os of [1, 4]) {
    const sch = S.sched(pg, S.F);
    assert.ok(sch.steps.some(st => st.loop === 1), `graph ${g} has a loop`);
    const ev = [[0, 48, 0.8, 1], [400, 48, 0, 0], [480, 55, 0.8, 1], [960, 40, 0.8, 1]], frames = 1280;
    const want = reference(S, pg, os, frames, ev);
    const { M } = machine(S, os);
    M.graph(pg);
    const got = play(M, os, 0, frames, ev.map(([f, n, v, on]) => [f, Mm => Mm.note(n, v, on)]));
    assert.ok(peak(want) > 0.01, `graph ${g} OS ${os}: audible`);
    sameBits(got, want, `graph ${g} OS ${os}`);
  }
});

test('block steps = the whole schedule per sample, bit for bit (chains, sums, gains, multiples, normals, links, loops, ramps); and = the interpreter on direct cords', () => {
  const S = SC;
  const pgs = [
    pgOf(S.F, [[0, 'ctl'], [1, 'osc'], [2, 'osc'], [3, 'vcf'], [4, 'vca'], [5, 'env']], [[0, 'kp', 0, 'a1'], [0, 'a2', 1, 'f1'], [0, 'a3', 2, 'f1'], [1, 'saw', 0, 'm1'],
      [2, 'sq', 0, 'm2'], [0, 'mo', 3, 'in'], [3, 'lp', 4, 'i1'], [0, 'ks', 5, 'trg'], [5, 'out', 4, 'c1'], [5, 'out', 3, 'c1', 0.4], [4, 'o2', 0, 'out']]),
    pgOf(S.F, [[0, 'ctl'], [1, 'drv'], [2, 'slv', 1], [3, 'slv', 1], [4, 'att'], [5, 'nz']], [[0, 'kp', 1, 'f1'], [2, 'saw', 4, 'i1'], [5, 'wh2', 5, 'li'], [5, 'lo', 3, 'dc', 2],
      [3, 'saw', 0, 'm1'], [4, 'o3', 0, 'm2'], [0, 'mo', 0, 'out'], [3, 'pw', 0, 'out', 0.5]]),
    pgOf(S.F, [[0, 'ctl'], [1, 'gn'], [2, 'gn'], [3, 'osc']], [[3, 'saw', 1, 'x1', 0.2], [1, 'y', 2, 'x1'], [2, 'y', 1, 'x2', 0.9], [2, 'yn', 0, 'out']]),
  ];
  const re = pgOf(S.F, [[0, 'ctl'], [1, 'osc'], [2, 'vcf'], [3, 'gn']], [[0, 'kp', 1, 'f1'], [1, 'saw', 3, 'x1'], [3, 'y', 3, 'x2', 0.5], [3, 'y', 2, 'in'], [2, 'lp', 0, 'out']]);
  for (const [g, pg] of pgs.entries()) {
    const ev = [[0, M => M.note(50, 0.9, 1)], [320, M => M.note(50, 0, 0)], [400, M => M.note(62, 0.9, 1)], [800, M => M.graph(re)], [1000, M => M.set({ '0': [9, 6, 4, 0] })]];
    const a = machine(S, 4), b = machine(S, 4);
    a.M.graph(pg); b.M.graph(pg); b.M.ps = 1;
    const A = play(a.M, 4, 0, 1600, ev), B = play(b.M, 4, 0, 1600, ev);
    assert.ok(peak(A) > 0.01, `graph ${g}: audible`);
    sameBits(A, B, `graph ${g}: block vs per sample`);
  }
  // direct cords, no loop: the evaluator = the interpreter
  const pd = pgOf(S.F, [[0, 'ctl'], [1, 'osc'], [2, 'vcf'], [3, 'vca']], [[0, 'kp', 1, 'f1'], [1, 'saw', 2, 'in'], [1, 'sq', 2, 'in', 0.25], [2, 'lp', 3, 'i1'],
    [0, 'kg', 3, 'c1'], [1, 'saw', 3, 'i2', 0.5], [3, 'o2', 0, 'out']]);
  const ev = [[0, 52, 0.8, 1], [600, 52, 0, 0]], { M } = machine(S, 2);
  M.graph(pd);
  sameBits(play(M, 2, 0, 800, ev.map(([f, n, v, on]) => [f, Mm => Mm.note(n, v, on)])), reference(S, pd, 2, 800, ev), 'the interpreter');
});

test('D7: the same render whatever the span splits (4, 128, random multiples of 4) — notes, values gliding, a graph change with ramps and a retiring module, a loop', () => {
  const S = SC, rnd = mulberry(77);
  const p1 = pgOf(S.F, [[0, 'ctl'], [1, 'osc'], [2, 'osc'], [3, 'vcf'], [4, 'gn'], [5, 'vca']], [[0, 'kp', 1, 'f1'], [0, 'kp', 2, 'f1'], [1, 'saw', 0, 'm1'],
    [2, 'sq', 0, 'm2'], [0, 'mo', 3, 'in'], [3, 'lp', 4, 'x1'], [4, 'y', 4, 'x2', 0.4], [4, 'y', 5, 'i1'], [0, 'kg', 5, 'c1'], [5, 'o2', 0, 'out']]);
  const p2 = pgOf(S.F, [[0, 'ctl'], [1, 'osc'], [3, 'vcf'], [4, 'gn'], [5, 'vca'], [6, 'nz']], [[0, 'kp', 1, 'f1'], [1, 'saw', 0, 'm1'], [6, 'wh1', 0, 'm2'],
    [0, 'mo', 3, 'in'], [3, 'lp', 4, 'x1'], [4, 'y', 5, 'i1'], [0, 'kg', 5, 'c1'], [5, 'o2', 0, 'out']]);
  const ev = [[0, M => M.graph(p1)], [0, M => M.set({ '0': [7, 10, 10, 0], m3: { _t: 'vcf', fc: 1 } })], [8, note(48)], [204, M => M.set({ m3: { _t: 'vcf', fc: -2 } })],
    [600, note(48, 0)], [604, note(55)], [1000, M => M.graph(p2)], [1404, note(60)], [1500, M => M.set({ '0': [3, 10, 10, 0] })], [2000, note(60, 0)]];
  const run = span => { const { M } = machine(S, 4); return play(M, 4, 4096, 2400, ev.map(([f, fn]) => [4096 + f, fn]), span); };
  const A = run(() => 128), B = run(() => 4), C = run(() => 4 * (1 + Math.floor(rnd() * 32)));
  assert.ok(peak(A) > 0.05);
  sameBits(B, A, 'spans of 4');
  sameBits(C, A, 'random spans');
});

test('wiring: multiples (two driven jacks average, one drives another), gains, normals (and a plug breaking them), the rear link (driven / undriven), MAIN OUT × og', () => {
  const S = SC, os = 1, at = (o, f) => o[f * os];
  const probe = (pg, f = 40, ev = [[0, note(72)]]) => { const { M } = machine(S, os); M.graph(pg); return at(play(M, os, 0, f + 4, ev), f); };
  const og = 0.07; // ov 7 → 0.1 · 7 / 10
  // kp (1 V at C5) → a1, kg (5 V) → a3: a2 → probe → OUT = the average, 3 V (review 1 F2: outputs tied together, as a passive multiple
  // behaves — not their 6 V sum); one driver alone is unchanged (1 V); the cords' gains weigh the average
  const avg = cords => probe(pgOf(S.F, [[0, 'ctl'], [1, 'pr']], [...cords, [0, 'a2', 1, 'x'], [1, 'y', 0, 'out']]));
  assert.ok(Math.abs(avg([[0, 'kp', 0, 'a1'], [0, 'kg', 0, 'a3']]) - 3 * og) < 1e-12, 'a multiple averages its driven jacks');
  assert.ok(Math.abs(avg([[0, 'kp', 0, 'a1']]) - 1 * og) < 1e-12, 'one driver: unchanged');
  assert.ok(Math.abs(avg([[0, 'kp', 0, 'a1', 0.5], [0, 'kg', 0, 'a3', 2]]) - 5.25 * og) < 1e-12, 'Σ g · driver / n');
  assert.ok(Math.abs(avg([[0, 'kp', 0, 'a1'], [0, 'kg', 0, 'a3'], [0, 'kp', 0, 'a4']]) - (7 / 3) * og) < 1e-12, 'three drivers');
  assert.ok(Math.abs(avg([[0, 'kg', 0, 'a1'], [0, 'kg', 0, 'a3']]) - 5 * og) < 1e-12, 'one source on two jacks is itself');
  // a chain: A (kp, kg → 3 V) drives B (gain 2) beside kp on B's own jack: B = (3 · 2 + 1) / 2; an undriven A beside kg does not halve it
  const bAvg = (cords) => probe(pgOf(S.F, [[0, 'ctl'], [1, 'pr']], [...cords, [0, 'b1', 1, 'x'], [1, 'y', 0, 'out']]));
  assert.ok(Math.abs(bAvg([[0, 'kp', 0, 'a1'], [0, 'kg', 0, 'a3'], [0, 'a4', 0, 'b2', 2], [0, 'kp', 0, 'b3']]) - 3.5 * og) < 1e-12, 'a chain: A\'s average is one driver of B');
  assert.ok(Math.abs(bAvg([[0, 'a4', 0, 'b2'], [0, 'kg', 0, 'b3']]) - 5 * og) < 1e-12, 'an undriven multiple beside one driver: unchanged');
  // A drives B (gain 0.5 into A's jack, 2 on the cord A → B, 0.25 out of B): 1 V · 0.5 · 2 · 0.25
  assert.ok(Math.abs(probe(pgOf(S.F, [[0, 'ctl'], [1, 'pr']], [[0, 'kp', 0, 'a1', 0.5], [0, 'a4', 0, 'b2', 2], [0, 'b1', 1, 'x', 0.25], [1, 'y', 0, 'out']])) - 0.25 * og) < 1e-12, 'gains along a chain of multiples');
  // an input with two cords sums them (g each)
  assert.ok(Math.abs(probe(pgOf(S.F, [[0, 'ctl'], [1, 'pr']], [[0, 'kp', 1, 'x', 3], [0, 'kg', 1, 'x', 0.1], [1, 'y', 0, 'out']])) - 3.5 * og) < 1e-12, 'Σ g · source');
  // the normals: i1 ← kp (1 V); o2 (i2 ← i1) at a2 5 → 0.5 V; o3 (i3 ← i2 ← i1) at a3 2 → 0.2 V; i2 patched with kg → o3 = 5 · 0.2
  const att = (extra, out) => pgOf(S.F, [[0, 'ctl'], [1, 'att']], [[0, 'kp', 1, 'i1'], ...extra, [1, out, 0, 'out']]);
  const withVals = (pg, f = 40) => { const { M } = machine(S, os); M.set({ m1: { _t: 'att', a2: 5, a3: 2 } }); M.graph(pg); return at(play(M, os, 0, f + 4, [[0, note(72)]]), f); };
  assert.ok(Math.abs(withVals(att([], 'o2')) - 0.5 * og) < 1e-12, 'o2 reads i1 (normal)');
  assert.ok(Math.abs(withVals(att([], 'o3')) - 0.2 * og) < 1e-12, 'o3 reads i2 ← i1 (normal chain)');
  assert.ok(Math.abs(withVals(att([[0, 'kg', 1, 'i2']], 'o3')) - 1 * og) < 1e-12, 'i2 patched: o3 follows it');
  assert.equal(withVals(att([[0, 'mo', 1, 'i2']], 'o2')), 0, 'a plug breaks the normal even when its source is silent');
  // the rear link: drv (kp + f2 + fq) → slv.dv; pw = dw = 0.5 + 0.1 f2 (f2 ← kg = 5): 1; undriven: the default 0.5
  assert.ok(Math.abs(probe(pgOf(S.F, [[0, 'ctl'], [1, 'drv'], [2, 'slv', 1]], [[0, 'kp', 1, 'f1'], [0, 'kg', 1, 'f2'], [2, 'pw', 0, 'out']])) - 1 * og) < 1e-12, 'driven: the link');
  assert.ok(Math.abs(probe(pgOf(S.F, [[0, 'ctl'], [1, 'drv'], [2, 'slv']], [[0, 'kp', 1, 'f1'], [2, 'pw', 0, 'out']])) - 0.5 * og) < 1e-12, 'undriven: def');
  // MAIN OUT × og, read each chunk after the controller's ctl: OUTPUT 7 → 3 glides (6 ms per chunk), og linear across each chunk
  const { M } = machine(S, os), k = 1 - Math.exp(-4 / (48000 * 0.006));
  M.graph(pgOf(S.F, [[0, 'ctl'], [1, 'pr']], [[0, 'kg', 1, 'x'], [1, 'y', 0, 'out']]));
  const o = play(M, os, 0, 64, [[0, note(60)], [32, Mm => Mm.set({ '0': [3, 10, 10, 0] })]]);
  assert.ok(Math.abs(o[31] - 5 * og) < 1e-12 && Math.abs(o[63] - 5 * 0.01 * (3 + 4 * (1 - k) ** 8)) < 1e-12, `og glides (${o[31]}, ${o[63]})`);
  for (let i = 33; i < 64; i++) assert.ok(o[i] < o[i - 1], 'no step: falling sample by sample');
  assert.ok(Math.abs((o[32] - o[31]) - (o[33] - o[32])) < 1e-15, 'linear within the chunk');
});

// review 1 F2 (r1/passive.mjs): a canPlug-valid passive loop — two attenuator outputs and a source into ONE multiple, the multiple back into the
// attenuator — summed to a loop gain of 2 and ran to the late reads' ±1e4 clamp (74 dBFS at MAIN OUT); tied outputs average, gain ≤ 1
test('a passive loop through a multiple with several drivers is bounded: the tied outputs average (no gain), the loop settles on its source', () => {
  const S = SC, os = 4, og = 0.07;
  const { M } = machine(S, os);
  M.graph(pgOf(S.F, [[0, 'ctl'], [1, 'att']], [[0, 'kg', 0, 'a4'], [1, 'o1', 0, 'a1'], [1, 'o2', 0, 'a2'], [0, 'a3', 1, 'i1'], [1, 'o3', 0, 'out']]));
  const o = play(M, os, 0, 1200, [[0, note(60)]]), at = stubOf(S, 1);
  let pk = 0; for (let k = 0; k < 3; k++) pk = Math.max(pk, peak(at.outs[k].subarray(0, 16)));
  assert.ok(finite(o) && peak(o) < 1.3 * 5 * og, `MAIN OUT ${db(peak(o) / og)} dB re 1 V peak (the 5 V gate is the whole input)`);
  assert.ok(pk <= 5 + 1e-9, `the attenuators' outputs stay at the source's 5 V (${pk})`);
  assert.ok(Math.abs(o[o.length - 1] - 5 * og) < 1e-9, `and settle on it: ${o[o.length - 1]} vs ${5 * og}`);
  // and the loop gain stays under 1 with the sum of four tied outputs too (three attenuators + the source): 3 / 4
  const { M: M2 } = machine(S, os);
  M2.graph(pgOf(S.F, [[0, 'ctl'], [1, 'att']], [[0, 'kg', 0, 'a4'], [1, 'o1', 0, 'a1'], [1, 'o2', 0, 'a2'], [1, 'o3', 0, 'a3'], [0, 'a4', 1, 'i1'], [1, 'o3', 0, 'out']]));
  const o2 = play(M2, os, 0, 1200, [[0, note(60)]]);
  assert.ok(finite(o2) && Math.abs(o2[o2.length - 1] - 5 * og) < 1e-9, `four tied: ${o2[o2.length - 1]}`);
});

test('the output mask: om = the outputs some input reads (normals, links, multiples, MAIN OUT); a module computes only those', () => {
  const S = scope();
  const pg = pgOf(S.F, [[0, 'ctl'], [1, 'osc'], [2, 'nz'], [3, 'drv'], [4, 'slv', 3], [5, 'att'], [6, 'vca']], [[0, 'kp', 0, 'a1'], [0, 'a2', 1, 'f1'], [0, 'a3', 3, 'f1'],
    [1, 'sq', 5, 'i1'], [2, 'wh2', 2, 'hi'], [2, 'ho', 0, 'm2'], [4, 'saw', 0, 'm1'], [0, 'mo', 6, 'i1'], [5, 'o3', 6, 'c1'], [6, 'o2', 0, 'out']]);
  const { M } = machine(S, 2);
  M.graph(pg);
  play(M, 2, 0, 64, [[0, note(60)]]);
  const om = new Map(mon(M).om);
  assert.deepEqual([om.get(0), om.get(1), om.get(2), om.get(3), om.get(4), om.get(5), om.get(6)],
    [1 | 8, 2, 2 | 8, 3, 1, 4, 2], 'ctl kp + mo · osc sq · nz wh2 (alias) + ho · drv both link outputs · slv saw · att o3 · vca o2');
  for (const n of [0, 1, 2, 3, 4, 5, 6]) assert.equal(stubOf(S, n).comp, om.get(n), `module ${n} computed its mask only`);
});

test('ctl once per module per chunk (a module of three live sections too), flush every 32nd absolute chunk, idle modules frozen (no ctl, no run)', () => {
  const S = scope();
  const pg = pgOf(S.F, [[0, 'ctl'], [1, 'nz'], [2, 'osc'], [3, 'osc']], [[1, 'wh1', 1, 'li'], [1, 'lo', 0, 'm1'], [0, 'ks', 0, 'si'], [0, 'so', 1, 'hi'],
    [1, 'ho', 0, 'm2'], [0, 'mo', 0, 'out'], [2, 'saw', 3, 'f1']]);
  const { M } = machine(S, 4);
  M.graph(pg);
  play(M, 4, 4 * 20, 4 * 20, [[80, note(60)]]); // absolute chunks 20 … 39: the flush at 32
  for (const n of [0, 1]) { const m = stubOf(S, n); assert.deepEqual([m.nc, m.nf, m.cc], [20, 1, 39], `module ${n}: 20 ctl, 1 flush, the last cc 39`); }
  for (const n of [2, 3]) { const m = stubOf(S, n); assert.deepEqual([m.nc, m.nf, m.comp], [0, 0, 0], `module ${n} idle`); }
  assert.equal(stubOf(S, 0).mvN, 1, 'mv on the first chunk only (no value moved since)');
  play(M, 4, 4 * 40, 4 * 25);
  assert.deepEqual([stubOf(S, 1).nc, stubOf(S, 1).nf], [45, 2], 'chunks 40 … 64: the next flush at 64');
});

test('values: ids → slots, an unknown id ignored, a _t mismatch → the defaults, values kept for modules that arrive later, fresh modules and snap params jump, the rest glide 6 ms per chunk', () => {
  const S = scope();
  const { M } = machine(S, 4);
  M.set({ '0': [5, 9, 8, 1, 99], m1: { _t: 'osc', fq: 0.5, rg: 3, zz: 7 }, m2: { _t: 'vca', fc: 4 }, m3: { _t: 'vcf', fc: -1 } });
  M.graph(pgOf(S.F, [[0, 'ctl'], [1, 'osc'], [2, 'vcf']], [[1, 'saw', 2, 'in'], [2, 'lp', 0, 'out']]));
  const p = n => Array.from(stubOf(S, n).p), t = n => Array.from(stubOf(S, n).t);
  assert.deepEqual(p(0), [5, 9, 8, 1], 'the controller\'s array in PARAMS order (extra entries ignored)');
  assert.deepEqual(p(1), [0.5, 3], 'ids → slots; zz ignored');
  assert.deepEqual(p(2), [0], 'm2 is a vcf: the vca entry (_t) → defaults');
  play(M, 4, 0, 16);
  // a module arriving later takes the stored values at once
  M.graph(pgOf(S.F, [[0, 'ctl'], [1, 'osc'], [2, 'vcf'], [3, 'vcf']], [[1, 'saw', 2, 'in'], [2, 'lp', 3, 'in'], [3, 'lp', 0, 'out']]));
  assert.deepEqual(p(3), [-1]);
  // an existing module glides: one-pole per chunk, k = 1 − exp(−4 / (48000 · 0.006))
  M.set({ '0': [5, 9, 8, 0], m1: { _t: 'osc', fq: 1.5, rg: 1 }, m3: { _t: 'vcf', fc: -1 } });
  assert.deepEqual([p(1), t(1)], [[0.5, 1], [1.5, 1]], 'rg (snap) jumps, fq waits for the chunk');
  assert.deepEqual(p(0), [5, 9, 8, 0], 'the controller\'s snap param jumps');
  const k = 1 - Math.exp(-4 / (48000 * 0.006));
  play(M, 4, 16, 4);
  assert.ok(Math.abs(p(1)[0] - (0.5 + k)) < 1e-15, 'one chunk of glide');
  play(M, 4, 20, 4 * 1200);
  assert.equal(p(1)[0], 1.5, 'settled exactly');
  const mv = stubOf(S, 1).mvN;
  play(M, 4, 4820, 16);
  assert.equal(stubOf(S, 1).mvN, mv, 'mv stays 0 once settled');
  // a _t mismatch on an existing module glides it back to its defaults
  M.set({ m1: { _t: 'vcf', fq: 3 } });
  assert.deepEqual(t(1), [0, 2]);
  // nothing reads a value in render: set() between quanta only binds
  M.set(null); M.set(7);
  assert.deepEqual(t(1), [0, 2]);
});

test('ramps: a pulled / plugged / re-patched cord crossfades over ≈ 2 ms (whole chunks) with no second-difference step above −60 dB re the signal, at OS 1 / 4, 48 / 44.1 kHz', (t) => {
  const S = SC;
  const pg0 = pgOf(S.F, [[0, 'ctl'], [1, 'pr']], [[0, 'kg', 1, 'x'], [1, 'y', 0, 'out']]);
  const pg1 = pgOf(S.F, [[0, 'ctl'], [1, 'pr']], [[1, 'y', 0, 'out']]);
  const pg2 = pgOf(S.F, [[0, 'ctl'], [1, 'pr']], [[0, 'kp', 1, 'x', 4], [1, 'y', 0, 'out']]);
  const d2 = (a, i0, i1) => { let m = 0; for (let i = Math.max(2, i0); i < i1; i++) m = Math.max(m, Math.abs(a[i] - 2 * a[i - 1] + a[i - 2])); return m; };
  const rows = [];
  for (const [sr, os] of [[48000, 1], [48000, 4], [44100, 1], [44100, 2]]) {
    const { M } = machine(S, os, sr), A = 5 * 0.07;
    M.graph(pg0);
    const ch = mon(M).rampCh;
    assert.equal(ch, Math.round(0.002 * sr / 4), 'whole chunks: ' + ch);
    const ev = [[0, note(72)], [256, M2 => M2.graph(pg1)], [512, M2 => M2.graph(pg0)], [768, M2 => M2.graph(pg2)]];
    const o = play(M, os, 0, 1024, ev), L = ch * 4 * os;
    // the pull: 5 V → 0 over exactly L samples, a raised cosine
    assert.ok(Math.abs(o[256 * os - 1] - A) < 1e-15 && o[256 * os + L - 1] === 0 && o[256 * os + L - 2] > 0, 'the fade spans the ramp exactly');
    const k = [d2(o, 256 * os - 2, 256 * os + L + 2), d2(o, 512 * os - 2, 512 * os + L + 2), d2(o, 768 * os - 2, 768 * os + L + 2)].map(x => x / A);
    rows.push(`${sr / 1000} kHz × ${os}: pull ${db(k[0])} dB, plug ${db(k[1])} dB, re-patch ${db(k[2])} dB (L ${L})`);
    for (const x of k) assert.ok(x < 1e-3, `second difference ${db(x)} dB ≥ −60 dB at ${sr} × ${os}`);
    assert.ok(Math.abs(o[1023 * os] - 4 * 1 * 0.07) < 1e-12, 're-patched: 4 · kp');
  }
  t.diagnostic(rows.join(' · '));
});

test('ramps: an S input switches at the ramp\'s midpoint (never a 0.5), pulled and plugged; live() holds through a pulled MAIN OUT\'s ramp', () => {
  const S = SC, os = 4;
  const on = pgOf(S.F, [[0, 'ctl'], [1, 'pr']], [[0, 'ks', 1, 's'], [1, 'ys', 0, 'out']]), off = pgOf(S.F, [[0, 'ctl'], [1, 'pr']], [[1, 'ys', 0, 'out']]);
  const { M } = machine(S, os);
  M.graph(on);
  const o = play(M, os, 0, 512, [[0, note(60)], [128, M2 => M2.graph(off)], [256, M2 => M2.graph(on)]]);
  const L = mon(M).rampCh * 4 * os, vals = new Set(o.map(x => Math.round(x / 0.07 * 1e9) / 1e9));
  assert.deepEqual([...vals].sort(), [0, 1], 'only closed / open');
  const firstOpen = o.indexOf(0, 128 * os), firstClosed = o.indexOf(0.07, 256 * os);
  assert.deepEqual([firstOpen - 128 * os, firstClosed - 256 * os], [L / 2 - 1, L / 2 - 1], 'the switch at the midpoint');
  // live(): MAIN OUT unpatched → false; patched → true; a pull: true until the ramp ends
  const m2 = machine(S, os).M;
  assert.equal(m2.live(), false, 'no graph');
  m2.graph(off);
  assert.equal(m2.live(), true, 'ys → OUT');
  m2.graph(pgOf(S.F, [[0, 'ctl'], [1, 'pr']], [[0, 'a1', 0, 'out']]));
  assert.equal(m2.live(), true, 'during the pull');
  play(m2, os, 0, 128);
  assert.equal(m2.live(), false, 'MAIN OUT from an undriven multiple: not live');
  m2.graph(pgOf(S.F, [[0, 'ctl']], []));
  assert.equal(m2.live(), false);
});

test('retiring: a module leaving the live set runs on its inputs as they were through the ramp, then freezes; one leaving the graph ends; patched again it resumes from its frozen state', () => {
  const S = scope(), os = 4;
  const mk = pull => pgOf(S.F, [[0, 'ctl'], [1, 'osc'], [2, 'vca'], [3, 'osc']], [...(pull === 2 ? [] : [[0, 'kp', 1, 'f1']]), ...(pull ? [] : [[1, 'saw', 2, 'i1']]),
    [3, 'saw', 2, 'i2'], [2, 'o2', 0, 'out']]);
  const run = pull => {
    const { M } = machine(S, os);
    M.set({ m2: { _t: 'vca', fc: 5 } });
    M.graph(mk(0));
    const o = play(M, os, 0, 256, [[0, note(67)], [128, M2 => M2.graph(mk(pull))]]);
    return { M, o, osc: S.made().filter(m => m.n === 1).at(-1) };
  };
  const a = run(1), b = run(2);
  sameBits(a.o, b.o, 'the retiring oscillator kept its pitch cord through the ramp (its inputs as they were)');
  const L = mon(a.M).rampCh * 4;
  assert.ok(mon(a.M).run.indexOf(1) < 0 && !mon(a.M).pend, 'after the ramp the oscillator is out of the running plan');
  const ph = a.osc.ph, nc = a.osc.nc;
  assert.equal(nc, (128 + L) / 4, 'it ran (ctl a chunk) until its ramp ended');
  play(a.M, os, 256, 128);
  assert.deepEqual([a.osc.ph, a.osc.nc], [ph, nc], 'frozen');
  // patched again: resumes from the frozen phase (the cord ramps in)
  a.M.graph(mk(0));
  play(a.M, os, 384, 4);
  assert.ok(a.osc.nc === nc + 1 && a.osc.ph !== ph, 'resumed');
  // a module leaving the graph: runs through the ramp, then gone
  const { M } = machine(S, os);
  M.graph(mk(0));
  play(M, os, 0, 64, [[0, note(60)]]);
  M.graph(pgOf(S.F, [[0, 'ctl'], [2, 'vca'], [3, 'osc']], [[3, 'saw', 2, 'i2'], [2, 'o2', 0, 'out']]));
  assert.ok(mon(M).run.includes(1) && mon(M).pend, 'scheduled while its ramp runs');
  assert.ok(!mon(M).mods.some(([n]) => n === 1), 'already out of the graph');
  play(M, os, 64, 128);
  assert.ok(!mon(M).run.includes(1) && !mon(M).pend, 'ended');
});

test('transitions: a second graph() before the first rendered drops it (ramps from the heard plan); one under way completes first; a cord reversed makes a loop while the ramps run; setOS completes one', () => {
  const S = SC, os = 4;
  const A = pgOf(S.F, [[0, 'ctl'], [1, 'pr']], [[0, 'kg', 1, 'x'], [1, 'y', 0, 'out']]), B = pgOf(S.F, [[0, 'ctl'], [1, 'pr']], [[1, 'y', 0, 'out']]);
  const C = pgOf(S.F, [[0, 'ctl'], [1, 'pr']], [[0, 'kp', 1, 'x', 4], [1, 'y', 0, 'out']]);
  const m1 = machine(S, os).M, m2 = machine(S, os).M;
  m1.graph(A); m2.graph(A);
  const o1 = play(m1, os, 0, 256, [[0, note(72)], [64, M => { M.graph(B); M.graph(C); }]]), o2 = play(m2, os, 0, 256, [[0, note(72)], [64, M => M.graph(C)]]);
  sameBits(o1, o2, 'A → (B unheard) → C = A → C');
  // under way: 4 frames of B's ramp heard, then C: B completes at once, C ramps from it
  const m3 = machine(S, os).M;
  m3.graph(A);
  const o3 = play(m3, os, 0, 256, [[0, note(72)], [64, M => M.graph(B)], [68, M => { M.graph(C); assert.ok(mon(M).pend, 'C ramps'); }]]);
  assert.ok(o3[68 * os - 1] > 0.3 && o3[68 * os] < 1e-3 && Math.abs(o3[255 * os] - 0.28) < 1e-12, 'B completed, then 0 → C');
  // a cord reversed (g1 → g2 becomes g2 → g1): a loop in the transition plan only
  const P1 = pgOf(S.F, [[0, 'ctl'], [1, 'gn'], [2, 'gn'], [3, 'osc']], [[3, 'saw', 1, 'x1'], [1, 'y', 2, 'x1'], [2, 'y', 0, 'out']]);
  const P2 = pgOf(S.F, [[0, 'ctl'], [1, 'gn'], [2, 'gn'], [3, 'osc']], [[3, 'saw', 2, 'x1'], [2, 'y', 1, 'x1'], [1, 'y', 0, 'out']]);
  const run = span => {
    const { M } = machine(S, os), seen = [];
    M.graph(P1);
    const o = play(M, os, 0, 384, [[0, note(60)], [128, Mm => { Mm.graph(P2); seen.push(mon(Mm)); }]], span);
    seen.push(mon(M));
    return { o, seen };
  };
  const r = run(() => 128), r4 = run(() => 4);
  assert.deepEqual(r.seen.map(m => [m.pend, m.steps.filter(s => s.loop === 1).length]), [[true, 1], [false, 0]], 'the loop while the ramps run, then none');
  assert.ok(finite(r.o) && peak(r.o.subarray(300 * os)) > 0.01);
  sameBits(r4.o, r.o, 'span invariant through it');
  // setOS while a transition runs: it completes first (a non-payload meanwhile changes nothing)
  const m5 = machine(S, os).M;
  m5.graph(A); play(m5, os, 0, 16); m5.graph(B);
  assert.ok(mon(m5).pend);
  assert.equal(m5.graph({ mods: 'x' }), null);
  assert.ok(mon(m5).pend && mon(m5).left === mon(m5).rampCh, 'still pending, untouched');
  m5.setOS(2, 96000);
  assert.ok(!mon(m5).pend && finite(play(m5, 2, 16, 64)));
});

test('graph() reuses state by id: an unrelated change leaves a module bit-identical (phase kept, no glitch); a type change at the same number starts fresh', () => {
  const S = scope(), os = 2;
  const base = [[0, 'kp', 1, 'f1'], [1, 'saw', 2, 'in'], [2, 'lp', 0, 'out']], mods = [[0, 'ctl'], [1, 'osc'], [2, 'vcf'], [3, 'pr'], [4, 'gn']];
  const p1 = pgOf(S.F, mods, base), p2 = pgOf(S.F, mods, [...base, [0, 'kg', 3, 'x'], [4, 'y', 4, 'x1']]);
  const a = machine(S, os).M, b = machine(S, os).M;
  a.graph(p1); b.graph(p1);
  const ev = [[0, note(57)]], A = play(a, os, 0, 200, ev), B = play(b, os, 0, 200, [...ev, [100, M => M.graph(p2)]]);
  sameBits(B, A, 'an unrelated cord added mid-note');
  assert.ok(!mon(b).pend, 'no ramp for inputs whose sources did not change');
  const osc = stubOf(S, 1);
  b.graph(pgOf(S.F, [[0, 'ctl'], [1, 'vcf'], [2, 'vcf']], [[1, 'lp', 2, 'in'], [2, 'lp', 0, 'out']]));
  assert.notEqual(stubOf(S, 1), osc, 'osc → vcf at n 1: a new object');
});

test('reset() = a fresh machine (state, values snapped, back-edges, a transition in progress); panic leaves the graph and the values', () => {
  const S = SC, os = 4;
  const pg = pgOf(S.F, [[0, 'ctl'], [1, 'osc'], [2, 'gn'], [3, 'vcf'], [4, 'nz']], [[0, 'kp', 1, 'f1'], [1, 'saw', 2, 'x1', 0.4], [2, 'y', 2, 'x2', 0.6],
    [2, 'yn', 3, 'in'], [4, 'wh1', 3, 'c1', 0.5], [3, 'lp', 0, 'out']]);
  const pv = { '0': [8, 10, 10, 0], m3: { _t: 'vcf', fc: 0.5 } };
  const ev = [[0, note(45)], [200, note(45, 0)], [204, note(52)]];
  const a = machine(S, os).M;
  a.set(pv); a.graph(pg);
  play(a, os, 0, 300, [[0, note(60)], [40, M => M.set({ m3: { _t: 'vcf', fc: -2 } })], [100, M => M.graph(pgOf(S.F, [[0, 'ctl'], [1, 'osc'], [3, 'vcf']], [[1, 'saw', 3, 'in'], [3, 'lp', 0, 'out']]))],
    [200, M => M.graph(pg)]]);
  a.set(pv);
  a.graph(pg);
  a.reset();
  const A = play(a, os, 512, 400, ev.map(([f, fn]) => [512 + f, fn]));
  const b = machine(S, os).M;
  b.set(pv); b.graph(pg);
  const B = play(b, os, 512, 400, ev.map(([f, fn]) => [512 + f, fn]));
  assert.ok(peak(B) > 0.01);
  sameBits(A, B, 'reset() then render = a fresh machine');
  assert.ok(a.live() && mon(a).steps.length > 0, 'the graph stays');
});

test('hostile payloads to the machine: offending items dropped, one ptFail per machine (the first reason), the rest plays; a non-payload keeps the graph; a class breaking the base shape is dropped', () => {
  const S = scope(), { M, errs } = machine(S, 2);
  M.graph(pgOf(S.F, [[0, 'ctl'], [1, 'pr']], [[0, 'kg', 1, 'x'], [1, 'y', 0, 'out']]));
  assert.deepEqual(errs, []);
  const P = port.bind(null, S.F), r = M.graph({ mods: [[0, 'ctl', -1], [1, 'pr', -1], [2, 'xx', -1]], cords: [[0, P('ctl', 'kg'), 1, P('pr', 'x'), 1], [1, 9, 0, 0, 1],
    [1, P('pr', 'y'), 0, P('ctl', 'out'), 1], [2, 0, 1, 0, 1], [0, P('ctl', 'ks'), 1, P('pr', 'x'), 1]] });
  assert.deepEqual(plain(r.why), ['type', 'port', 'cord']);
  assert.deepEqual(errs, ['type'], 'one report, the first reason');
  M.graph({ mods: [[0, 'ctl']], cords: [[0, 99, 0, 0]] });
  assert.equal(errs.length, 1, 'never a second');
  assert.equal(M.graph(null), null);
  M.graph(pgOf(S.F, [[0, 'ctl'], [1, 'pr']], [[0, 'kg', 1, 'x'], [1, 'y', 0, 'out']]));
  assert.equal(M.graph('garbage'), null, 'no throw');
  const o = play(M, 2, 0, 64, [[0, note(60)]]);
  assert.ok(Math.abs(o[127] - 0.35) < 1e-12, 'the last good graph plays');
  // inst.port fallback, and a family class that breaks the base shape (short outs) or throws
  const c = scope();
  c.ctx.PatchBad = Object.freeze({ T: { ctl: c.F.T.ctl, a: class { constructor() { this.outs = [new Float64Array(8)]; } ctl() {} run() {} }, b: class { constructor() { throw new Error('x'); } } },
    JACKS: { ctl: c.F.JACKS.ctl, a: [{ id: 'o', dir: 'out', sig: 'v' }], b: [{ id: 'o', dir: 'out', sig: 'v' }] }, PARAMS: c.F.PARAMS, SINK: 'out' });
  const posted = [], Mb = c.PD.create({ OS: 1, fs: 48000, port: { postMessage: x => posted.push(x) } }, 'bad');
  const rb = Mb.graph({ mods: [[0, 'ctl', -1], [1, 'a', -1], [2, 'b', -1]], cords: [[1, 0, 0, port(c.F, 'ctl', 'out'), 1], [2, 0, 0, port(c.F, 'ctl', 'm1'), 1]] });
  assert.deepEqual(plain(rb.why), ['type', 'type']);
  assert.deepEqual(plain(posted), [{ t: 'ptErr', why: 'type' }]);
  assert.equal(Mb.live(), false, 'their cords dropped with them');
});

test('finite under fuzzed graphs with feedback (gains to 4, passive loops through the attenuators, random notes and values) at OS 1 and 4', () => {
  const S = SC, rnd = mulberry(0x5eed);
  let loops = 0, loud = 0;
  for (let g = 0; g < 60; g++) {
    const os = g % 2 ? 4 : 1, pg = randGraph(S.F, rnd, 4 + Math.floor(rnd() * 10), 10 + Math.floor(rnd() * 24)), { M } = machine(S, os);
    for (const c of pg.cords) if (rnd() < 0.3) c[4] = 4;
    const pv = {};
    for (const [n, type] of pg.mods) if (n > 0) { const e = { _t: type }; for (const [id] of S.F.PARAMS[type]) e[id] = (rnd() * 2 - 0.5) * 10; pv['m' + n] = e; }
    M.set(pv);
    const r = M.graph(pg);
    loops += r.loops;
    const ev = [];
    for (let k = 0; k < 12; k++) ev.push([4 * Math.floor(rnd() * 400), note(30 + Math.floor(rnd() * 60), rnd() < 0.6)]);
    const o = play(M, os, 0, 1600, ev);
    assert.ok(finite(o), `graph ${g}: finite output`);
    for (const m of S.made()) for (const b of m.outs) assert.ok(finite(b), `graph ${g}: finite module outputs`);
    if (peak(o) > 0.01) loud++;
  }
  assert.ok(loops > 20 && loud > 20, `exercised (${loops} loop steps, ${loud} audible)`);
});

test('no allocation in render: 200 spans with note storms, a loop, values gliding, and the quanta carrying a graph change\'s ramps, its retiring module and the switch to the final plan', () => {
  const S = SC, os = 4;
  const p1 = pgOf(S.F, [[0, 'ctl'], [1, 'osc'], [2, 'gn'], [3, 'vcf'], [4, 'nz'], [5, 'att'], [6, 'drv'], [7, 'slv', 6]], [[0, 'kp', 0, 'a1'], [0, 'a2', 1, 'f1'],
    [0, 'a3', 6, 'f1'], [1, 'saw', 2, 'x1', 0.5], [2, 'y', 2, 'x2', 0.5], [2, 'yn', 3, 'in'], [4, 'wh1', 3, 'c1'], [3, 'lp', 5, 'i1'], [5, 'o3', 0, 'm1'],
    [7, 'saw', 0, 'm2'], [0, 'mo', 0, 'out'], [0, 'ks', 0, 'si'], [0, 'so', 4, 'hi']]);
  const p2 = pgOf(S.F, [[0, 'ctl'], [1, 'osc'], [2, 'gn'], [3, 'vcf'], [4, 'nz'], [7, 'slv', -1]], [[0, 'kp', 1, 'f1'], [1, 'saw', 2, 'x1', 0.5], [2, 'y', 3, 'in'],
    [3, 'lp', 2, 'x2', 0.3], [4, 'lo', 3, 'c1'], [3, 'lp', 0, 'm1'], [7, 'saw', 0, 'm2'], [0, 'mo', 0, 'out']]);
  const { M } = machine(S, os), buf = new Float64Array(128 * os), rnd = mulberry(5);
  M.graph(p1);
  M.set({ '0': [6, 10, 9, 0] });
  let F = 0;
  const span = () => { const n = 4 * (1 + Math.floor(rnd() * 32)); buf.fill(0); M.render(buf, n * os, F); F += n; };
  for (let k = 0; k < 20; k++) span(); // warm (first-call paths)
  noAlloc(S.ctx, () => { for (let k = 0; k < 200; k++) { M.note(36 + (k % 40), 0.7, k % 3 !== 2); span(); } });
  M.graph(p2); M.set({ '0': [3, 10, 9, 0], m3: { _t: 'vcf', fc: -1 } });
  assert.ok(mon(M).pend && mon(M).ramps > 0, 'a transition with ramps');
  noAlloc(S.ctx, () => { for (let k = 0; k < 40; k++) { M.note(60, 0.7, k & 1); span(); } });
  assert.ok(!mon(M).pend, 'the final plan installed inside the noAlloc window');
  assert.ok(finite(buf));
});

test('setOS: the chunk follows (CH = 4 · OS), every module is told, the ramp stays ≈ 2 ms; setSalt reaches every module; note() reaches module 0', () => {
  const S = scope(), { M } = machine(S, 4);
  M.graph(pgOf(S.F, [[0, 'ctl'], [1, 'osc'], [2, 'nz']], [[0, 'kp', 1, 'f1'], [1, 'saw', 0, 'out']]));
  play(M, 4, 0, 64, [[0, note(60)]]);
  M.setOS(2, 96000);
  assert.deepEqual([mon(M).ch, mon(M).os, mon(M).rampCh], [8, 2, 24]);
  for (const n of [0, 1, 2]) assert.equal(stubOf(S, n).fs, 96000, `module ${n} at 96 kHz`);
  const o = play(M, 2, 64, 128);
  assert.ok(finite(o) && peak(o) > 0.01);
  M.setSalt(1234);
  for (const n of [0, 1, 2]) assert.equal(stubOf(S, n).salt, 1234);
  const c0 = stubOf(S, 0).notes;
  M.note(64, 0.5, 1); M.note(64, 0, 0);
  assert.equal(stubOf(S, 0).notes, c0 + 2);
  // a new module takes the machine's rate and salt
  M.graph(pgOf(S.F, [[0, 'ctl'], [1, 'osc'], [2, 'nz'], [3, 'vcf']], [[0, 'kp', 1, 'f1'], [1, 'saw', 3, 'in'], [3, 'lp', 0, 'out']]));
  assert.deepEqual([stubOf(S, 3).fs, stubOf(S, 3).salt], [96000, 1234]);
});

/* ------------------------------------------------------------------ events and lamps (stage 9b, IMPL-9b §1.5 / §1.6 / §3.2) */
test('events: ev(n, k) hands k to module n\'s ev at once (→ 1) — dropped (→ 0) for no graph, an unknown module, one outside the live plan (review 1 F2), k outside its type\'s EV row, a class without ev; the class applies it at its next ctl: the next chunk whatever the span split (4, 128, random); reset() clears what waits', () => {
  const S = scope(), os = 2;
  const pg = pgOf(S.F, [[0, 'ctl'], [1, 'sq'], [2, 'osc'], [3, 'sq']], [[1, 'y', 0, 'out']]);
  const { M } = machine(S, os);
  assert.equal(M.ev(1, 0), 0, 'no graph yet');
  M.graph(pg);
  assert.deepEqual([M.ev(1, 0), M.ev(3, 1), M.ev(9, 0), M.ev(1, 2), M.ev(1, -1), M.ev(1, 0.5), M.ev(2, 0)], [1, 0, 0, 0, 0, 0, 0], 'module 3 (nothing reads it: outside the plan) hears nothing');
  assert.deepEqual([stubOf(S, 1).evs, stubOf(S, 3).evs, stubOf(S, 1).en, stubOf(S, 3).en], [1, 0, 1, 0], 'held by the class until its ctl; never by a module that is not live');
  // a cord makes module 3 live: nothing waits for it (a stale press would jump it); its own events work from then on
  M.graph(pgOf(S.F, [[0, 'ctl'], [1, 'sq'], [2, 'osc'], [3, 'sq']], [[1, 'y', 0, 'out'], [3, 'y', 0, 'm1'], [0, 'mo', 0, 'out']]));
  assert.deepEqual([stubOf(S, 3).en, M.ev(3, 1), stubOf(S, 3).en], [0, 1, 1], 'made live: no stale event; a new one is heard');
  M.reset();
  assert.deepEqual([stubOf(S, 1).en, stubOf(S, 3).en], [0, 0], 'reset() clears them');
  // posted between spans at frames 0, 256, 512 (inc, inc, zero): the output steps at exactly those chunks, whatever the split
  let seed = 3; const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  const outs = [() => 128, () => 4, () => 4 * (1 + Math.floor(rnd() * 32))].map(span => {
    const T = scope(), { M: m } = machine(T, os);
    m.graph(pgOf(T.F, [[0, 'ctl'], [1, 'sq']], [[1, 'y', 0, 'out']]));
    return play(m, os, 0, 768, [[0, x => x.ev(1, 0)], [256, x => x.ev(1, 0)], [512, x => x.ev(1, 1)]], span);
  });
  sameBits(outs[1], outs[0], 'spans of 4 vs 128'); sameBits(outs[2], outs[0], 'random spans vs 128');
  const g = 0.1 * 7 / 10, at = F => Math.round(outs[0][F * os] / g);
  assert.deepEqual([at(0), at(252), at(256), at(508), at(512), at(767)], [1, 1, 2, 2, 0, 0], 'each event at its chunk');
});

test('lamps: lamps(F) → { F, l: [n, bits, …] } for the live modules whose type declares lamps (a frozen one left out: the host keeps its last), lampN their count (set by graph()), l a copy; the stage-9 shape unchanged for a family without EV / LAMPS', () => {
  const S = scope(), os = 2, { M } = machine(S, os);
  M.graph(pgOf(S.F, [[0, 'ctl'], [1, 'sq'], [2, 'sq'], [3, 'osc']], [[1, 'y', 0, 'out'], [3, 'saw', 2, 'x']]));
  assert.equal(M.lampN, 1);
  M.ev(1, 0); M.ev(1, 0); M.ev(1, 0); assert.equal(M.ev(2, 0), 0, 'module 2 is frozen: its event is dropped (review 1 F2)');
  play(M, os, 0, 64);
  const a = plain(M.lamps(64)), b = M.lamps(64);
  assert.deepEqual(a, { F: 64, l: [1, 3] }, 'module 1 live (3 counts), module 2 frozen (no ctl yet: not listed)');
  assert.ok(b.l !== M.lamps(64).l, 'a copy each call');
  M.graph(pgOf(S.F, [[0, 'ctl'], [1, 'sq'], [2, 'sq'], [3, 'osc']], [[1, 'y', 0, 'out'], [3, 'saw', 2, 'x'], [2, 'y', 0, 'm1'], [0, 'mo', 0, 'out']]));
  assert.equal(M.lampN, 2);
  play(M, os, 64, 64);
  assert.deepEqual(plain(M.lamps(128)), { F: 128, l: [1, 3, 2, 0] }, 'both live: module 2 heard nothing of the event sent while it was frozen');
  assert.equal(M.ev(2, 0), 1); play(M, os, 128, 64);
  assert.deepEqual(plain(M.lamps(192)), { F: 192, l: [1, 3, 2, 1] }, 'its own event, sent live, applied at its next ctl');
  // a family without the 9b tables: no ev, no lamps
  const c = scope(); c.ctx.PatchOld = Object.freeze({ T: c.F.T, JACKS: c.F.JACKS, PARAMS: c.F.PARAMS, SINK: 'out' });
  const m = c.PD.create({ OS: 1, fs: 48000 }, 'old');
  m.graph(pgOf(c.F, [[0, 'ctl'], [1, 'sq']], [[1, 'y', 0, 'out']]));
  assert.deepEqual([m.lampN, m.ev(1, 0), plain(m.lamps(0)).l], [0, 0, []]);
});

test('no allocation in render with events posted between the spans (200 spans, a lamp module live, a loop): ev() and the class\'s ring allocate nothing either', () => {
  const S = scope(), os = 4, { M } = machine(S, os), buf = new Float64Array(128 * os), rnd = mulberry(9);
  M.graph(pgOf(S.F, [[0, 'ctl'], [1, 'sq'], [2, 'gn'], [3, 'osc']], [[3, 'saw', 1, 'x'], [1, 'y', 2, 'x1', 0.2], [2, 'y', 2, 'x2', 0.5], [2, 'yn', 0, 'out']]));
  let F = 0;
  const span = () => { const n = 4 * (1 + Math.floor(rnd() * 32)); buf.fill(0); M.render(buf, n * os, F); F += n; };
  for (let k = 0; k < 20; k++) { M.ev(1, k & 1); span(); }
  noAlloc(S.ctx, () => { for (let k = 0; k < 200; k++) { M.ev(1, k % 3 === 2 ? 1 : 0); span(); } });
  assert.ok(finite(buf) && stubOf(S, 1).evs === 220);
});

// The Moog family's presets (§2.5: none patches a feedback loop) schedule with no loop step — once K9's tables
// (patch-core.js, moog-core.js) and V9b's script (moog-dsp.js) are on the branch; until then a diagnostic
test('the Moog presets schedule with no loop step (K9 + V9b, when present)', async (t) => {
  const need = ['patch-core.js', 'moog-core.js', 'moog-dsp.js'].filter(f => !existsSync(new URL(f, ROOT)));
  if (need.length) { t.diagnostic('waiting for ' + need.join(', ')); return; }
  const ctx = vm.createContext(vm.constants.DONT_CONTEXTIFY);
  vm.runInContext(SRC, ctx);
  vm.runInContext(readFileSync(new URL('moog-dsp.js', ROOT), 'utf8'), ctx);
  const PT = await import('../patch-core.js?v=9'), MG = await import('../moog-core.js?v=9');
  const FAM = MG.FAMILY, PR = FAM && FAM.PRESETS;
  if (!ctx.PatchMoog || !PR || typeof PT.payload !== 'function' || typeof PT.loadPreset !== 'function' || typeof PT.fresh !== 'function') {
    t.diagnostic('the tables\' API differs from IMPL-9 §7.4: this check needs updating'); return;
  }
  const names = Array.isArray(PR) ? PR.map(p => p.name || p.id) : Object.keys(PR);
  assert.ok(names.length >= 6);
  for (const name of names) {
    const r = PT.loadPreset(PT.fresh('moog'), {}, name, 'moog'), rec = r && r.rec ? r.rec : r, { pg } = PT.payload(rec, 'moog');
    const s = plain(ctx.PatchDSP.schedule(pg, ctx.PatchMoog));
    assert.deepEqual(s.why, [], name);
    assert.ok(s.steps.length > 1 && s.steps.every(st => st.loop === 0), name + ': no loop step');
  }
});
