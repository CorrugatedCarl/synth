// Denormal (subnormal) state in racks that never stop processing (the Windows idle-load report, 2026-10-25): MASTER's rack runs
// on every quantum while any module is enabled (Master.part bypasses only a calm rack), and a panel holding a live sidechain
// unit runs on zeros through Track.scIdle (IMPL-SC review 1 F1). The FX delay lines are Float32: a tail that decays into the
// float32 subnormal range (|x| < 1.18e-38) never reaches 0 in a recirculating line — g × the smallest subnormal rounds back
// to it — so after ~30 s of silence most of a reverb pool sat at ±1.4e-45 for ever (the sim: 54 499 of 64 103 floats), read
// and written every sample. x86 SSE pays a microcode assist (~100 cycles) per float32 ↔ float64 conversion of a subnormal
// (JS cannot set FTZ / DAZ); Apple Silicon does not — the DSP meter ramping to 100 % on a silent Windows PC and never on the
// Mac / iPad. The fix: once the rack is idle() (≥ 1 s of exact-zero input with every module output < 1e-6, plus the longest
// echo gap) FXRack.sweep flushes |x| < 1e-30 to 0 in one reverb pool every ⅛ s, round robin, each pool whole (not in strides:
// an unswept part of a loop re-infects a swept window) — the S1 Reverb's and the S2 Reverb's, the only lines that keep a
// subnormal: the Delay / Chorus / Flanger write their feedback through sat() (< 1e-25 → 0), the Bode through flush1, the
// rest (Hyper, the Delay's input copy, Convolve's and the S2 Reverb's pre-delays) are feed-forward copies of a zero input.
// It looks only at the installed type's region of the S2 pool and skips a reverb that does not run (a bypassed or stopped
// splitter's branch), stops once a full round finds every pool exact zero with no module output, re-arms with the next audio
// (a pool it finds nonzero, a module output below 1e-6), and restarts its schedule with each silence (live ≡ bounce bit for
// bit, §10.7f). While a tail rings (no sweep) the reverbs' input diffusers flush below FLT_MIN after a block whose input is
// silent (review #7: they stuck at ±the smallest subnormal, for ever at Hall / Basin's infinite settings). Tested here: the S2
// reverb types with the line modules, MASTER, a Serum panel with a Ducker (scIdle), the S1 Reverb (raw and migrated) hold no
// subnormal after 40 s of zeros; the sweep runs only in the idle() regime, touches only the reverb pools, keeps its schedule
// history-free, stops (after a TYPE switch, beside a frozen branch too) and re-arms; no reverb line holds a subnormal while a
// tail rings; the reported scene end to end (page sim); a rack its host stops (the idle skip) gets one pass of FXRack.rest over
// every Float32 line (below FLT_MIN → 0, a share per skipped frame). Every loop is a fixed frame count with a wall-clock deadline()
// (node:test's { timeout } cannot interrupt a synchronous body).
// Run alone: node --max-old-space-size=2048 --test tests/fx-denormal.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dspScope } from './dsp-scope.mjs';
import * as C from '../fx-core.js?v=9';
import * as core from '../serum-core.js?v=9';
import * as W from '../wt.js?v=9';
import { patchFor } from '../models.js?v=9';
import { lawNorm } from '../laws.js?v=9';

const SR = 48000, QPS = SR / 128;
const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
const D = dspScope({ engine: true, fast: true, console: quiet });
const Track = D.Proc, Master = D.procs['synth-master'], FX = D.global('FXDSP');
const F64 = '[object Float64Array]', F32 = '[object Float32Array]', MIN64 = 2.2250738585072014e-308, MIN32 = 1.1754943508222875e-38;
const isSub = (v, lim) => v !== 0 && v > -lim && v < lim;
// every subnormal reachable from root (typed arrays: f32 below its own threshold, f64 below the double's; plain numbers in
// fields and arrays), by path → count; cycle-safe; `skip` keys stay out (the processors' scope-wide registry, the fake port)
function subnormals(root, skip = ['procs', 'port']) {
  const seen = new Set(), stack = [[root, '']], out = new Map();
  const add = (k, n) => out.set(k, (out.get(k) || 0) + n);
  while (stack.length) {
    const [o, path] = stack.pop();
    if (o === null || typeof o !== 'object' || seen.has(o)) continue;
    seen.add(o);
    const tag = Object.prototype.toString.call(o);
    if (tag === F64 || tag === F32) {
      const lim = tag === F64 ? MIN64 : MIN32;
      let k = 0;
      for (let i = 0; i < o.length; i++) if (isSub(o[i], lim)) k++;
      if (k) add(path + (tag === F64 ? ' (f64)' : ' (f32)'), k);
      continue;
    }
    if (ArrayBuffer.isView(o) || tag === '[object ArrayBuffer]') continue;
    if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) { const v = o[i]; if (typeof v === 'number') { if (isSub(v, MIN64)) add(path + '[]', 1); } else if (v && typeof v === 'object') stack.push([v, path + '[' + i + ']']); } continue; }
    if (tag === '[object Map]') { for (const [k, v] of o) if (v && typeof v === 'object') stack.push([v, path + '{' + String(k) + '}']); continue; }
    if (tag === '[object Set]') { for (const v of o) if (v && typeof v === 'object') stack.push([v, path + '{}']); continue; }
    for (const k of Object.getOwnPropertyNames(o)) {
      if (skip.includes(k)) continue;
      let v; try { v = o[k]; } catch (e) { continue; }
      if (typeof v === 'number') { if (isSub(v, MIN64)) add(path + '.' + k, 1); } else if (v && typeof v === 'object') stack.push([v, path + '.' + k]);
    }
  }
  return out;
}
const total = m => { let n = 0; for (const v of m.values()) n += v; return n; };
const describe = m => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([p, k]) => `${k}× ${p}`).join('; ');
const sub32 = (a, lo = 0, hi = a.length) => { let k = 0; for (let i = lo; i < hi; i++) if (isSub(a[i], MIN32)) k++; return k; };
// a wall-clock bound checked inside every quantum loop: node:test's { timeout } cannot interrupt a synchronous body (review #15)
const deadline = (ms = 120000) => { const t0 = Date.now(); return () => { if (Date.now() - t0 > ms) throw new Error('deadline: over ' + ms + ' ms'); }; };
// a parameter's normalised value in engine units (FXP_TAB: rows by variant number — the type's latest)
const nOf = (type, pid, v) => { const T = C.FXP_TAB[type], rows = T[3] || T[2] || T[1], r = rows.find(x => x.pid === pid); return lawNorm(r.law, r.lo, r.hi, v, r.def); };
// a new instance (where: { splitter, branch } puts it in a splitter branch)
function inst(fx, type, p, sub, where) {
  const id = C.newInstance(fx, type, Object.assign({ rack: 0 }, where || {}));
  const find = L => { for (const x of L) { if (x.id === id) return x; for (const b of x.br || []) { const y = find(b); if (y) return y; } } return null; };
  const I = find(fx.racks[0].mods);
  Object.assign(I.p, p || {});
  if (sub) Object.assign(I.sub, sub);
  return I;
}
const rackOf = (fx, fxt, sr = SR, bpm = 120) => { const r = new FX.FXRack(sr); r.set(C.compileFx(fx, { bpm, rate: sr }), fxt || C.compileFxT(fx)); return r; };
const reSet = (r, fx) => r.set(C.compileFx(fx, { bpm: 120, rate: r.fs }), C.compileFxT(fx));   // an edit while running
const nonzero = (a, lo = 0, hi = a.length) => { let k = 0; for (let i = lo; i < hi; i++) if (a[i] !== 0) k++; return k; };
// a rack of the line modules around a reverb of type t (decay / size 0.3: its tail crosses the float32 floor within the test)
function lineFx(t) {
  const fx = C.defaultFx2();
  inst(fx, 'dly', { feed: 0.6, mix: 0.3, timeL: nOf('dly', 'timeL', 20), timeR: nOf('dly', 'timeR', 30), bpm: 0 });
  inst(fx, 'cho', { feed: nOf('cho', 'feed', 0.8), mix: 0.5 });
  inst(fx, 'flg', { on: 1, feed: 0.9, mix: 0.5 });
  inst(fx, 'hyper', { on: 1, dmix: 0.5 });
  inst(fx, 'bode', { feed: 0.8, delay: nOf('bode', 'delay', 100), mix: 0.5 });
  inst(fx, 'cmp', { mb: 1 });
  inst(fx, 'rev', { type: nOf('rev', 'type', t), decay: 0.3, size: 0.3, mix: 0.4 });
  return fx;
}
// an S1 (v1) rack holding the Reverb alone (type 0 Plate, 1 Hall), as an old project (raw v1) or through its v2 migration
function v1Fx(type, migrate, p) {
  const v1 = C.defaultFxV1();
  v1.p['fx.rev.on'] = 1; v1.p['fx.rev.mix'] = 0.4; v1.p['fx.rev.size'] = 0.3; v1.rev.type = type;
  if (p) Object.assign(v1.p, p);
  return migrate ? C.migrateFx1(v1) : v1;
}
const REV_TYPES = ['Plate', 'Hall', 'Vintage', 'Nitrous', 'Basin'];
// seeded noise bursts (0.25 s on, 0.25 s off) for `secs` seconds, then exact zeros: the shape a stopped track's panel and MASTER see
function* feed(secs, seed) {
  const r = W.mulberry32(W.fnv1a32(seed)), n = Math.round(secs * QPS);
  for (let q = 0; q < n; q++) { const on = (q % Math.round(QPS / 2)) < Math.round(QPS / 4); yield on ? () => 0.5 * (2 * r() - 1) : null; }
}
const burst = (r, L, R, g) => { for (let i = 0; i < 128; i++) { const v = 0.5 * (2 * g() - 1); L[i] = v; R[i] = 0.7 * v; } r.process(L, R, 128); };
const zeros = (r, L, R) => { L.fill(0); R.fill(0); r.process(L, R, 128); };
// counts rack.sweep() calls; `bad` the calls outside the idle() regime (input not exact zero, an output ≥ 1e-6, quietT < fs, not idle())
function spy(r) {
  const log = { n: 0, bad: 0 }, sw = r.sweep;
  r.sweep = function () { log.n++; if (!(this.quietT >= this.fs && this.inZero === 1 && this.qmax < 1e-6 && this.idle())) log.bad++; return sw.call(this); };
  return log;
}

test('every S2 reverb type (Plate, Hall, Vintage, Nitrous, Basin) after the line modules (Delay, Chorus, Flanger, Hyper, Bode, multiband Compressor), processed on exact zeros for 40 s: a never-calm rack holds no subnormal state (the sweep clears the Rev2 pool whole; the other lines stay clean by their own flushes)', () => {
  const bad = [], dl = deadline();
  for (let t = 0; t < REV_TYPES.length; t++) {
    const fx = lineFx(t), rack = rackOf(fx), L = new Float64Array(128), R = new Float64Array(128);
    for (const src of feed(1, 'fx-denormal ' + t)) { dl(); for (let i = 0; i < 128; i++) { L[i] = src ? src() : 0; R[i] = src ? 0.7 * src() : 0; } rack.process(L, R, 128); }
    let peak = 0;
    for (let q = 0; q < 40 * QPS; q++) { dl(); L.fill(0); R.fill(0); rack.process(L, R, 128); if (q > 38 * QPS) for (let i = 0; i < 128; i++) { const a = L[i] < 0 ? -L[i] : L[i]; if (a > peak) peak = a; } }
    assert.equal(rack.calm, 0, REV_TYPES[t] + ': the rack stays busy (modules enabled)');
    assert.equal(rack.idle(), true, REV_TYPES[t] + ': the rack reports idle after 40 s of zeros');
    const m = subnormals(rack);
    if (total(m) > 0) bad.push(`${REV_TYPES[t]}: ${total(m)} subnormals (${describe(m)})`);
    assert.ok(!(peak > 1e-30), REV_TYPES[t] + ': the output is silence after 40 s (peak ' + peak + ')');
  }
  assert.deepEqual(bad, []);
});

test('MASTER with a rack (EQ → Compressor → Reverb) fed exact zeros after a burst: the rack runs every quantum and holds no subnormal state after 40 s', () => {
  const fx = C.defaultFx2(), dl = deadline();
  inst(fx, 'eq', {}); inst(fx, 'cmp', {}); inst(fx, 'rev', { mix: 0.15, size: 0.3, decay: 0.3 });
  D.ctx.currentFrame = 0;
  const M = new Master({ processorOptions: {} });
  M.port.postMessage = () => {};
  M.msg({ t: 'chain', fxr: C.compileFx(fx, { bpm: 120, rate: SR }), fxrT: C.compileFxT(fx) });
  const L = new Float32Array(128), R = new Float32Array(128), inp = [[L, R]], out = [[new Float32Array(128), new Float32Array(128)]];
  const r = M.c.rack, o = r.process;
  let calls = 0;
  r.process = function (...a) { calls++; return o.apply(this, a); };
  for (const src of feed(1, 'fx-denormal master')) { dl(); for (let i = 0; i < 128; i++) { L[i] = src ? src() : 0; R[i] = src ? 0.7 * src() : 0; } M.process(inp, out); D.ctx.currentFrame += 128; }
  calls = 0;
  for (let q = 0; q < 40 * QPS; q++) { dl(); L.fill(0); R.fill(0); M.process(inp, out); D.ctx.currentFrame += 128; }
  assert.equal(calls, 40 * QPS, 'the master rack processed every quantum of the silence (not calm: modules enabled)');
  const m = subnormals(M);
  assert.equal(total(m), 0, 'subnormals in MASTER: ' + describe(m));
  M.msg({ t: 'bye' });
});

test('a Serum panel holding a Ducker (a live sidechain unit) + a short Delay + Reverb: after the keys go up the rack keeps running on zeros (scIdle), sweeps, and holds no subnormal state after 40 s', () => {
  const fx = C.defaultFx2(), dl = deadline();
  inst(fx, 'duck', { depth: 1, att: 0, smooth: 0, bpm: 0, len: nOf('duck', 'len', 50) }, { src: 'trk_k' });
  // (review #10: short unsynced echoes — a slow synced Delay kept feeding the reverb above the float32 floor for the whole test)
  inst(fx, 'dly', { feed: 0.6, mix: 0.3, timeL: nOf('dly', 'timeL', 20), timeR: nOf('dly', 'timeR', 30), bpm: 0 });
  inst(fx, 'rev', { mix: 0.4, size: 0.3, decay: 0.3 });
  // (silenceTails 0: the tails ring out as a live keyboard stop leaves them — the transport's stop is not what ended the notes)
  const patch = patchFor('serum', { s: core.normalizeSerum(core.defaultSerum()) }, fx, { sr: SR, bpm: 120, prefs: { smooth: 1, silenceTails: 0 } });
  D.ctx.currentFrame = 0;
  const p = new Track({ processorOptions: { os: 2, hostOS: 4, trackId: 'trk_s' } });
  p.port.postMessage = () => {};
  p.msg({ t: 'patch', p: patch });
  for (const id of patch.needs || []) if (/^(factory|noise):/.test(id)) p.msg(Object.assign({ t: 'wt' }, id.startsWith('noise:') ? W.makeNoise(id) : W.makeEntry(id, W.factoryTable(id))));
  const out = [[new Float32Array(128), new Float32Array(128)]], I = p.insts[0], r = I.rack, o = r.process, log = spy(r);
  let calls = 0, renders = 0;
  r.process = function (...a) { calls++; return o.apply(this, a); };
  const rs = I.renderSpan;
  I.renderSpan = function (n) { const v = rs.call(this, n); if (v) renders++; return v; };
  assert.equal(r.scLive(), true, 'the Ducker with a source is a live sidechain unit');
  const run = secs => { for (let q = 0; q < secs * QPS; q++) { dl(); p.process([], out); D.ctx.currentFrame += 128; } };
  for (const n of [48, 55, 60]) p.msg({ t: 'on', n, v: 100 });
  run(1);
  for (const n of [48, 55, 60]) p.msg({ t: 'off', n });
  run(40);
  calls = 0; renders = 0;
  run(2);
  assert.equal(renders, 0, 'the Inst takes the idle skip');
  assert.equal(calls, 2 * QPS, 'its rack still runs every quantum (scIdle: the Ducker follows the key)');
  const n = log.n, nb = log.bad, m = subnormals(p);
  p.msg({ t: 'bye' });
  assert.equal(total(m), 0, 'subnormals in the Track: ' + describe(m));
  assert.ok(n > 0, 'the rack swept (its reverb tail reached the float32 floor inside the test)');
  assert.equal(nb, 0, 'sweeps outside the idle() regime');
});

test('the S1 Reverb (class Reverb, kind 7: old projects, migrateFx1, the factory chains\' S1 reverbs) — Plate and Hall, raw v1 and migrated — holds no float32 subnormal after 40 s of zeros (its own sweep)', () => {
  const dl = deadline(), bad = [];
  for (const mig of [false, true]) for (const type of [0, 1]) {
    const fx = v1Fx(type, mig), r = rackOf(fx), L = new Float64Array(128), R = new Float64Array(128), g = W.mulberry32(W.fnv1a32('v1 ' + type));
    const u = r.byId.get('rev');
    assert.ok(u && u.k === 7 && u.mod.type === type, `${mig ? 'migrated' : 'raw'} v1 type ${type}: the S1 Reverb unit`);
    for (let q = 0; q < QPS; q++) { dl(); if ((q % 188) < 94) burst(r, L, R, g); else zeros(r, L, R); }
    for (let q = 0; q < 40 * QPS; q++) { dl(); zeros(r, L, R); }
    const k = sub32(u.mod.pool);
    if (k) bad.push(`${mig ? 'migrated' : 'raw'} v1 type ${type}: ${k}`);
  }
  assert.deepEqual(bad, []);
});

test('the sweep runs only in the idle() regime — none during bursts with 0.5 s gaps, none within 1 s of an output ≥ 1e-6, none before a Delay\'s echo gap has passed; every call on exact zeros with quietT ≥ fs and idle()', () => {
  const dl = deadline(), L = new Float64Array(128), R = new Float64Array(128);
  {
    const fx = C.defaultFx2(); inst(fx, 'dly', { feed: 0.6, mix: 0.3 }); inst(fx, 'rev', { mix: 0.4, size: 0.3, decay: 0.3 });
    const r = rackOf(fx), log = spy(r), g = W.mulberry32(W.fnv1a32('gate'));
    for (let q = 0; q < 10 * QPS; q++) { dl(); if ((q % QPS) < QPS / 2) burst(r, L, R, g); else zeros(r, L, R); }
    assert.equal(log.n, 0, 'sweeps during bursts with 0.5 s gaps');
  }
  {
    const fx = C.defaultFx2(); inst(fx, 'rev', { type: nOf('rev', 'type', 1), mix: 0.5, size: 1, decay: 0.9 });
    const r = rackOf(fx), log = spy(r), g = W.mulberry32(W.fnv1a32('tail'));
    for (let q = 0; q < QPS; q++) { dl(); burst(r, L, R, g); }
    let lastLoud = 0, near = 0;
    for (let q = 0; q < 60 * QPS; q++) {
      dl(); const n0 = log.n; zeros(r, L, R);
      for (let i = 0; i < 128; i++) if (L[i] >= 1e-6 || L[i] <= -1e-6 || R[i] >= 1e-6 || R[i] <= -1e-6) { lastLoud = q; break; }
      if (log.n > n0 && q - lastLoud < QPS) near++;
    }
    assert.ok(lastLoud > 5 * QPS, 'the tail is audible for a while');
    assert.ok(log.n > 0, 'it sweeps once quiet');
    assert.equal(log.bad, 0, 'sweeps outside the regime');
    assert.equal(near, 0, 'sweeps within 1 s of an output ≥ 1e-6');
  }
  {
    // (review #3 b: a 0.5 s Delay ahead of the reverb — idle() waits 1 s + its echo gap; an ordinary panel's host skips it from
    // there, so a panel never sweeps before its skip, and MASTER / a sidechain panel only once nothing can sound)
    const fx = C.defaultFx2();
    inst(fx, 'dly', { feed: 0.3, mix: 0.3, timeL: nOf('dly', 'timeL', 500), timeR: nOf('dly', 'timeR', 500), bpm: 0 });
    inst(fx, 'rev', { mix: 0.4, size: 0.3, decay: 0.3 });
    const r = rackOf(fx), log = spy(r), g = W.mulberry32(W.fnv1a32('echo gap'));
    for (let q = 0; q < QPS; q++) { dl(); burst(r, L, R, g); }
    for (let q = 0; q < 30 * QPS; q++) { dl(); zeros(r, L, R); }
    assert.ok(r.U.find(u => u.k === 13).mod.tail() >= 0.45 * SR, 'the Delay\'s echo gap counts in idle()');
    assert.ok(log.n > 0, 'it sweeps once idle');
    assert.equal(log.bad, 0, 'sweeps before idle()');
  }
});

test('the sweep clears only the reverb pools — one pool per sweep, never a Delay / Chorus / Flanger / Hyper / Bode / Convolve line (feedback through sat() / flush1 or feed-forward: no lasting subnormal) nor the S2 Reverb\'s pre-delay line (a copy of the input)', () => {
  const dl = deadline(), L = new Float64Array(128), R = new Float64Array(128);
  const fx = lineFx(0); inst(fx, 'conv', { mix: 0.3 });
  const r = rackOf(fx), kinds = new Set(r.U.map(u => u.k));
  for (const k of [0, 2, 12, 13, 14, 15, 18, 19]) assert.ok(kinds.has(k), 'unit kind ' + k + ' in the rack');
  const has = [...r.U].filter(u => typeof u.mod.sweep === 'function').map(u => u.k);
  assert.deepEqual(has, [15], 'units with a sweep(): the S2 Reverb only (the S1 Reverb, kind 7, below)');
  const v1 = rackOf(v1Fx(0, false));
  assert.equal(typeof v1.byId.get('rev').mod.sweep, 'function', 'the S1 Reverb sweeps its pool');
  // per rack sweep: the units swept (each unit's sweep() wrapped), and a marker 1e-31 planted in the pre-delay line half a lap
  // ahead of its write pointer (restored after): swept → 0
  let cur = 0, multi = 0, other = 0, plHit = 0, n = 0;
  for (const u of r.U) if (typeof u.mod.sweep === 'function') { const s = u.mod.sweep, k = u.k; u.mod.sweep = function () { cur++; if (k !== 15 && k !== 7) other++; return s.call(this); }; }
  const rv = r.U.find(u => u.k === 15).mod, sw = r.sweep;
  r.sweep = function () {
    const i = (rv.pw + (rv.pcap >> 1)) % rv.pcap, v0 = rv.pl[i];
    rv.pl[i] = 1e-31; cur = 0; n++;
    const v = sw.call(this);
    if (rv.pl[i] === 0) plHit++;
    rv.pl[i] = v0;
    if (cur > 1) multi++;
    return v;
  };
  const g = W.mulberry32(W.fnv1a32('only pools'));
  for (let q = 0; q < QPS; q++) { dl(); burst(r, L, R, g); }
  for (let q = 0; q < 40 * QPS; q++) { dl(); zeros(r, L, R); }
  assert.ok(n > 0, 'the rack swept');
  assert.equal(other, 0, 'sweeps of a non-reverb unit');
  assert.equal(multi, 0, 'rack sweeps touching more than one pool');
  assert.equal(plHit, 0, 'sweeps that cleared the pre-delay line');
  assert.equal(total(subnormals(r)), 0, 'no subnormal left anywhere in the rack');
});

test('§10.7f after a long silence — a rack with a longer silent history renders bit-identically to a fresh one through a 30 s gap (the sweep schedule restarts with each silence: it never depends on history)', () => {
  const fx = C.defaultFx2(), dl = deadline();
  inst(fx, 'rev', { mix: 0.3, size: 0.3, decay: 0.3 });
  const A = rackOf(fx), B = rackOf(fx), L = new Float64Array(128), R = new Float64Array(128), L2 = new Float64Array(128), R2 = new Float64Array(128);
  for (let q = 0; q < 20; q++) zeros(B, L, R);                                    // B: 20 quanta more of silent history (a live rack)
  for (let q = 0; q < QPS / 2; q++) { dl(); zeros(A, L, R); zeros(B, L, R); }
  A.transport(); B.transport();
  const g = W.mulberry32(W.fnv1a32('phase'));
  let diff = 0, first = -1, q = 0;
  for (const [secs, on] of [[1, 1], [30, 0], [0.5, 1], [3, 0], [0.5, 1], [12, 0]]) for (let k = 0; k < secs * QPS; k++, q++) {
    dl();
    for (let i = 0; i < 128; i++) { const v = on ? 0.5 * (2 * g() - 1) : 0; L[i] = v; R[i] = 0.7 * v; L2[i] = v; R2[i] = 0.7 * v; }
    A.process(L, R, 128); B.process(L2, R2, 128);
    for (let i = 0; i < 128; i++) if (!Object.is(L[i], L2[i]) || !Object.is(R[i], R2[i])) { diff++; if (first < 0) first = q * 128 + i; }
  }
  assert.equal(diff, 0, `live ≠ fresh in ${diff} samples, the first at ${(first / SR).toFixed(3)} s`);
});

test('the sweep stops once a full round finds every pool exact zero with no module output (no sweeps for ever after), and re-arms with the next audio', () => {
  const dl = deadline(), L = new Float64Array(128), R = new Float64Array(128), bad = [];
  const cases = REV_TYPES.map((name, t) => [name + ' + the line modules', () => rackOf(lineFx(t))]);
  cases.push(['MASTER-like EQ → Compressor → Reverb', () => { const fx = C.defaultFx2(); inst(fx, 'eq', {}); inst(fx, 'cmp', {}); inst(fx, 'rev', { mix: 0.15, size: 0.3, decay: 0.3 }); return rackOf(fx); }]);
  cases.push(['two reverbs in series (Plate → Hall)', () => { const fx = C.defaultFx2(); inst(fx, 'rev', { mix: 0.4, size: 0.3, decay: 0.3 }); inst(fx, 'rev', { type: nOf('rev', 'type', 1), mix: 0.4, size: 0.3, decay: 0.3 }); return rackOf(fx); }]);
  cases.push(['S1 Hall (v1)', () => rackOf(v1Fx(1, false))]);
  for (const [name, mk] of cases) {
    const r = mk(), log = spy(r), g = W.mulberry32(W.fnv1a32('stop ' + name)), pools = r.U.filter(u => u.k === 7 || u.k === 15).map(u => u.mod.pool);
    const zs = secs => { const n0 = log.n; for (let q = 0; q < secs * QPS; q++) { dl(); zeros(r, L, R); } return log.n - n0; };
    for (let q = 0; q < QPS; q++) { dl(); burst(r, L, R, g); }
    const a = zs(40), b = zs(20);
    const dirty = pools.reduce((s, P) => s + P.reduce((k, v) => k + (v !== 0 ? 1 : 0), 0), 0);
    for (let q = 0; q < QPS / 2; q++) { dl(); burst(r, L, R, g); }
    const c = zs(40), d = zs(20);
    if (!(a > 0 && b === 0 && dirty === 0 && c > 0 && d === 0 && log.bad === 0)) bad.push(`${name}: sweeps ${a} in the first 40 s, ${b} in the next 20 s (pools: ${dirty} nonzero floats), after a new burst ${c} then ${d}; outside the regime ${log.bad}`);
  }
  assert.deepEqual(bad, []);
});

// (review #5, the skeptics: a TYPE switched mid-tail left the old type's data beyond the new tank's region — its reset clears
// only that, Plate / Hall clear the whole pool — and the sweep, looking at the whole shared pool, found it nonzero for ever: 8
// sweeps a second on an idle MASTER through clear(), transport() and new bursts; a reverb frozen in a bypassed splitter branch
// or under a stopped splitter (its units do not run) kept its tail, and the sweep with it)
test('the sweep stops after a reverb TYPE switched mid-tail (every pair that left the old type\'s data beyond the new tank\'s region) and beside a reverb frozen in a bypassed splitter branch or under a disabled splitter (a unit that does not run is not swept; its tail kept)', () => {
  const dl = deadline(), L = new Float64Array(128), R = new Float64Array(128), bad = [];
  const zs = (r, log, secs) => { const n0 = log.n; for (let q = 0; q < secs * QPS; q++) { dl(); zeros(r, L, R); } return log.n - n0; };
  for (const [a, b] of [[0, 2], [0, 3], [0, 4], [1, 2], [3, 2], [4, 2], [3, 4], [2, 0]]) {
    const fx = C.defaultFx2(), I = inst(fx, 'rev', { type: nOf('rev', 'type', a), mix: 0.4, size: 0.6, decay: 0.6 });
    const r = rackOf(fx), log = spy(r), g = W.mulberry32(W.fnv1a32('type ' + a + ' ' + b)), M = r.U[0].mod;
    for (let q = 0; q < QPS; q++) { dl(); burst(r, L, R, g); }
    zs(r, log, 0.25);
    I.p.type = nOf('rev', 'type', b); reSet(r, fx);
    const s1 = zs(r, log, 60), s2 = zs(r, log, 20), n = M.nd[M.type], own = nonzero(M.pool, 0, n);
    if (!(M.type === b && s1 > 0 && s2 === 0 && own === 0 && log.bad === 0)) bad.push(`${REV_TYPES[a]} → ${REV_TYPES[b]} (installed ${REV_TYPES[M.type]}): sweeps ${s1} in 60 s, then ${s2} in 20 s; nonzero floats ${own} in its region, ${nonzero(M.pool, n)} beyond; outside the regime ${log.bad}`);
  }
  for (const how of ['a bypassed branch', 'a disabled splitter']) {
    const fx = C.defaultFx2(), sp = inst(fx, 'split2', {});
    inst(fx, 'rev', { mix: 0.5, size: 0.3, decay: 0.3 }, null, { splitter: sp.id, branch: 0 });
    inst(fx, 'rev', { type: nOf('rev', 'type', 1), mix: 0.5, size: 0.3, decay: 0.3 }, null, { splitter: sp.id, branch: 1 });
    inst(fx, 'rev', { mix: 0.3, size: 0.3, decay: 0.3 });   // (after the splitter, on the main chain: keeps running)
    const r = rackOf(fx), log = spy(r), g = W.mulberry32(W.fnv1a32('frozen ' + how)), S = r.U.find(u => u.k === 21);
    const [b0, b1] = [S.br[0][0].mod, S.br[1][0].mod], main = r.U.find(u => u.k === 15 && !S.br.some(c => c.includes(u))).mod;
    for (let q = 0; q < QPS; q++) { dl(); burst(r, L, R, g); }
    zs(r, log, 0.05);
    if (how === 'a bypassed branch') sp.bb[0] = 1; else sp.p.on = 0;
    reSet(r, fx);
    const s1 = zs(r, log, 60), s2 = zs(r, log, 20);
    const frozen = how === 'a bypassed branch' ? [b0] : [b0, b1], running = [b0, b1, main].filter(M => !frozen.includes(M));
    const fz = frozen.map(M => nonzero(M.pool)), rn = running.map(M => nonzero(M.pool));
    if (!(s1 > 0 && s2 === 0 && fz.every(k => k > 0) && rn.every(k => k === 0) && log.bad === 0)) bad.push(`${how}: sweeps ${s1} in 60 s, then ${s2} in 20 s; nonzero floats in the frozen pools ${fz.join(' / ')} (their tail kept), in the running ones ${rn.join(' / ')}; outside the regime ${log.bad}`);
  }
  assert.deepEqual(bad, []);
});

// (review #5, the skeptics: neither re-arm was pinned — a mutant that ignores a dirty pool, or a module output below 1e-6, passed
// this file, and left 22 000 / up to 36 891 float32 subnormals in a probe's pool)
test('a finished sweep re-arms — on a pool it finds nonzero (a reverb at MIX 0: no module output while its pool rings) and on a module output below 1e-6 after the stop (a reverb frozen mid-tail in a bypassed splitter branch, back in silence): no float32 subnormal stays in the pool', () => {
  const dl = deadline(), L = new Float64Array(128), R = new Float64Array(128);
  {
    const fx = C.defaultFx2(); inst(fx, 'rev', { mix: 0, size: 0.3, decay: 0.3 });
    const r = rackOf(fx), log = spy(r), g = W.mulberry32(W.fnv1a32('mix 0')), P = r.U[0].mod.pool;
    for (let q = 0; q < QPS; q++) { dl(); burst(r, L, R, g); }
    let qn = 0;
    for (let q = 0; q < 40 * QPS; q++) { dl(); zeros(r, L, R); if (r.qmax !== 0) qn++; }
    assert.equal(qn, 0, 'MIX 0: no module output while the pool rings');
    assert.deepEqual([sub32(P), nonzero(P), r.swN], [0, 0, -1], 'the pool after 40 s: float32 subnormals, nonzero floats; swN (−1: done)');
    assert.ok(log.n > 1, 'more sweeps than one round of one pool (' + log.n + ')');
    assert.equal(log.bad, 0, 'sweeps outside the regime');
  }
  {
    // (a reverb frozen mid-tail in a bypassed splitter branch: the sweep, skipping it, stops; the branch comes back in silence
    // and its tail, below 1e-6, reaches the output — no quietT reset, only that output can re-arm it; the S2 Plate at SIZE 0.3
    // loops at 0.585 > ½ per pass: a tail left alone sticks)
    const fx = C.defaultFx2(), sp = inst(fx, 'split2', {});
    inst(fx, 'rev', { mix: 0.5, size: 0.3 }, null, { splitter: sp.id, branch: 0 });
    const r = rackOf(fx), log = spy(r), g = W.mulberry32(W.fnv1a32('unfrozen')), P = r.U.find(u => u.k === 15).mod.pool;
    for (let q = 0; q < QPS / 4; q++) { dl(); burst(r, L, R, g); }
    let loud = 0;
    for (let q = 0; q < 6 * QPS; q++) { dl(); zeros(r, L, R); if (r.qmax >= 1e-6) loud = q; }
    sp.bb[0] = 1; reSet(r, fx);
    for (let q = 0; q < 5 * QPS; q++) { dl(); zeros(r, L, R); }
    const stopped = r.swN, held = nonzero(P);
    sp.bb[0] = 0; reSet(r, fx);
    let small = 0, top = 0;
    for (let q = 0; q < 40 * QPS; q++) { dl(); zeros(r, L, R); if (q < QPS) { if (r.qmax !== 0) small++; if (r.qmax > top) top = r.qmax; } }
    assert.ok(loud < 5 * QPS && stopped === -1 && held > 0, `the tail fell below 1e-6 (at ${(loud / QPS).toFixed(1)} s), the sweep stopped beside the frozen pool (swN ${stopped}; ${held} nonzero floats held)`);
    assert.ok(small > 0 && top < 1e-6, `back in silence, its tail reaches the output below 1e-6 (${small} quanta, peak ${top})`);
    assert.deepEqual([sub32(P), nonzero(P), r.swN], [0, 0, -1], '40 s after the branch came back: float32 subnormals, nonzero floats; swN (−1: done)');
    assert.equal(log.bad, 0, 'sweeps outside the regime');
  }
});

// (review #7: the input diffusers — feed-forward allpasses, g > 0.5 — stuck at ±the smallest subnormal 1–3 s after their input
// stopped, while the tail still rang: no sweep before idle(), for ever at Hall / Basin's infinite settings; 600–1 900 floats,
// Basin's sixteen ~9 000. A store flush in the loop cost JavaScriptCore 2–3 %, so they flush below FLT_MIN after a block whose
// input is silent: one compare per block while audio plays)
test('while a tail rings (quietT 0: no sweep yet) no reverb line holds a float32 subnormal — the input diffusers flush below FLT_MIN after a silent-input block (review #7) — Plate, Hall, Vintage, Nitrous, Basin, the S1 Reverb\'s Plate and Hall; infinite Hall (S2, S1) and Basin, for ever audible, at 44.1, 48 and 96 kHz', (t) => {
  const dl = deadline(), L = new Float64Array(128), R = new Float64Array(128), bad = [], seen = [];
  const rev = p => { const fx = C.defaultFx2(); inst(fx, 'rev', Object.assign({ mix: 0.4 }, p, { type: nOf('rev', 'type', p.type) })); return fx; };
  const cfgs = [['Plate, size / decay 1', rev({ type: 0, size: 1, decay: 1 })], ['Hall, defaults', rev({ type: 1 })],
    ['Vintage, size / decay 1', rev({ type: 2, size: 1, decay: 1 })], ['Nitrous, defaults', rev({ type: 3 })], ['Basin, defaults', rev({ type: 4 })],
    ['S1 Plate', v1Fx(0, false)], ['S1 Hall', v1Fx(1, false)]];
  for (const sr of [44100, 48000, 96000]) {
    cfgs.push([`Hall, infinite decay, ${sr / 1000} kHz`, rev({ type: 1, size: 0.5, decay: 1 }), sr, 1]);
    cfgs.push([`Basin, infinite feed, ${sr / 1000} kHz`, rev({ type: 4, size: 0.5, feed: 1 }), sr, 1]);
    cfgs.push([`S1 Hall, infinite, ${sr / 1000} kHz`, v1Fx(1, false, { 'fx.rev.t': 1 }), sr, 1]);
  }
  for (const [name, fx, sr = SR, inf = 0] of cfgs) {
    const r = rackOf(fx, null, sr), u = r.U.find(x => x.k === 7 || x.k === 15), M = u.mod, qps = Math.round(sr / 128), g = W.mulberry32(W.fnv1a32('diffusers ' + name));
    for (let q = 0; q < qps; q++) { dl(); burst(r, L, R, g); }
    let rung = 0, worst = 0, at = '';
    for (let q = 1; q <= 20 * qps; q++) {
      dl(); zeros(r, L, R);
      if (q % Math.round(qps / 5) === 0 && r.quietT === 0) {
        rung++;
        const k = sub32(M.pool) + (M.pl ? sub32(M.pl) : 0);
        if (k > worst) { worst = k; at = (q / qps).toFixed(1) + ' s'; }
      }
    }
    assert.ok(rung >= (inf ? 99 : 4), `${name}: the tail rings (${rung} audible checks, every 0.2 s)`);
    seen.push(`${name} ${worst}`);
    if (worst > 0) bad.push(`${name}: ${worst} float32 subnormals at a check while audible (at ${at})`);
  }
  t.diagnostic('float32 subnormals while audible (most at a check): ' + seen.join(', '));
  assert.deepEqual(bad, []);
});

test('the reported scene end to end (page sim, clock std): project-p1 with a MASTER Reverb — ▶ 4 s, ■, 60 s of nothing — MASTER\'s rack runs every quantum and MASTER holds no subnormal; every rack that ran in the last 2 s holds none', async () => {
  const dl = deadline(240000);
  const { bootMain } = await import('./main-sim.mjs');
  const { fakeStorage, fakeIDB } = await import('./fakes.mjs');
  const p1 = JSON.parse(readFileSync(new URL('./ref-p1/project-p1.json', import.meta.url), 'utf8'));
  const fx = C.defaultFx2();
  inst(fx, 'rev', { mix: 0.2, size: 0.3, decay: 0.3 });
  p1.master = { fx };
  const P1 = JSON.stringify(p1);
  const s = await bootMain({ ls: fakeStorage({}), idb: fakeIDB(), clock: 'std' });
  const $ = s.$, step = async (n) => { dl(); s.raf(2); await s.settle(2); s.raf(); return s.run(n); };
  await $('#fFile').onchange({ target: { files: [{ name: 'p.synth.json', type: 'application/json', text: async () => P1 }], value: '' } });
  await s.settle(30);
  await s.power(); await s.settle(30);
  await step(4096);
  $('#tPlay').onclick();
  for (let k = 0; k < 4; k++) await step(48000);
  $('#tPlay').onclick();                                       // ■
  for (let k = 0; k < 58; k++) await step(48000);
  const nodes = s.ctx().nodes.filter(n => n.kind === 'worklet' && n.proc);
  const racksOf = P => { const r = []; if (P.c && P.c.rack) r.push(P.c.rack); if (P.insts) for (const I of P.insts) if (I && I.rack) r.push(I.rack); return r; };
  const cnt = new Map();
  for (const n of nodes) for (const r of racksOf(n.proc)) { const o = r.process; cnt.set(r, 0); r.process = function (...a) { cnt.set(r, cnt.get(r) + 1); return o.apply(this, a); }; }
  for (let k = 0; k < 2; k++) await step(48000);
  const skip = ['procs', 'port', 'node', 'dom', 'document'], rows = [];
  let master = 0, mrack = -1;
  for (const n of nodes) {
    const P = n.proc;
    if (n.name === 'synth-master') { master++; mrack = cnt.get(P.c.rack); const m = subnormals(P, skip); if (total(m)) rows.push(`MASTER: ${total(m)} (${describe(m)})`); continue; }
    for (const r of racksOf(P)) if (cnt.get(r) > 0) { const m = subnormals(r, skip); if (total(m)) rows.push(`${String(n.po && n.po.trackId)} rack: ${total(m)} (${describe(m)})`); }
  }
  assert.equal(master, 1, 'one MASTER node');
  assert.equal(mrack, 2 * 375, 'MASTER\'s rack ran every quantum of the last 2 s');
  assert.deepEqual(rows, []);
});

// FXRack.rest — the host's idle skip (engine.js: an Inst holding the rack, a panel no source feeds) stops a rack with its lines as
// they stand: a feed-forward line keeps the float32 subnormals its input wrote on the way to exact 0 (a running rack refills it
// with zeros within one ring). Each skipped span calls rest(n): one pass over every unit's Float32 lines, below FLT_MIN → 0,
// REST = 256 floats per frame (no quantum carries a whole rack), then nothing until the rack runs again. Pinned here on the
// line modules of both generations (every Float32Array a module holds is a line it passes over), the budget per frame and
// its split-invariance (live ≡ bounce), the values kept (normal ones, −0), the once-per-skip rule and the restart on set()
// (inst-denormal holds the hosts' end)
const PLANT = [1e-40, -1e-40, 1.4e-45, MIN32, -MIN32, 1e-31, -0];
// the racks: the S2 line modules around a Plate (+ a Convolve: its FDLs / pre-delay) and the S1 rack (Hyper, Flanger, Chorus,
// Delay, the S1 Reverb), each after 0.25 s of bursts (allocated, run); → { r, lines: [[path, Float32Array]] } — every own
// Float32Array field of every allocated unit's module
function restRigs() {
  const L = new Float64Array(128), R = new Float64Array(128), out = [];
  const s2 = lineFx(0); inst(s2, 'conv', { mix: 0.3 });
  const s1 = v1Fx(0, false, { 'fx.hyper.on': 1, 'fx.flg.on': 1, 'fx.cho.on': 1, 'fx.dly.on': 1 });
  for (const [name, fx] of [['S2', s2], ['S1', s1]]) {
    const r = rackOf(fx), g = W.mulberry32(W.fnv1a32('rest ' + name)), lines = [];
    for (let q = 0; q < QPS / 4; q++) burst(r, L, R, g);
    for (const u of r.U) if (u.has === 1) for (const k of Object.keys(u.mod)) { const a = u.mod[k]; if (Object.prototype.toString.call(a) === F32 && a.length > 0) lines.push([`${name} ${u.id} (kind ${u.k}).${k}`, a]); }
    out.push({ name, r, lines });
  }
  return out;
}
test('FXRack.rest — the idle skip\'s pass: every Float32 line of the S2 and S1 line modules (Hyper, Flanger, Chorus, Delay, Bode, Convolve, both Reverbs\' pools, the S2 pre-delay) flushed below FLT_MIN at REST (256) floats per frame, the same state for any split of the frames (live ≡ bounce), normal values and −0 kept; once until the rack runs again; set() restarts a pass under way', () => {
  const dl = deadline(), rigs = restRigs(), twins = restRigs(), Z = new Float64Array(128);
  for (const { name, r, lines } of rigs) {
    const kinds = new Set(lines.map(([p]) => +p.match(/kind (\d+)/)[1]));
    assert.deepEqual([...kinds].sort((a, b) => a - b), name === 'S2' ? [0, 2, 12, 13, 15, 18, 19] : [0, 2, 4, 5, 7], name + ': the kinds holding Float32 lines');
    assert.equal(r.rs, 1, name + ': the rack ran (a pass due)');
    // every float subnormal: each call clears exactly its budget (128 frames × 256) until the pass ends, then nothing
    for (const [, a] of lines) a.fill(1e-40);
    const left = () => { let k = 0; for (const [, a] of lines) k += sub32(a); return k; };
    let k0 = left(), calls = 0;
    while (r.rs !== 0) {
      dl(); r.rest(128); calls++;
      const k = left();
      assert.equal(k0 - k, Math.min(128 * 256, k0), `${name}: call ${calls} cleared ${k0 - k} of ${k0}`);
      k0 = k;
    }
    assert.equal(k0, 0, name + ': no float32 subnormal left in a line');
    assert.ok(calls >= 3, name + ': the pass spread over the skipped spans (' + calls + ' calls)');
    assert.equal(total(subnormals(r)), 0, name + ': none anywhere in the rack');
    // rested: a value planted now stays (nothing runs) until the rack runs again — then the next skip's pass takes it
    const [p0, a0] = lines.find(([p]) => /\.pl$|\.lL$/.test(p));
    const i = a0.length >> 1;
    a0[i] = 1e-40; r.rest(128);
    assert.equal(a0[i], Math.fround(1e-40), name + ': no pass without a run (' + p0 + ')');
    r.process(Z.fill(0), new Float64Array(128), 128);
    assert.equal(r.rs, 1, name + ': process() makes a pass due');
    a0[i] = 1e-40;
    while (r.rs !== 0) { dl(); r.rest(128); }
    assert.equal(a0[i], 0, name + ': the next pass flushed it');
  }
  // kept values and the split: the twin racks, the same pattern, one rested in 128-frame spans, the other in spans of 1, 127,
  // 64, 64, 100, 28 frames: equal at every 128-frame boundary; after the pass only the subnormals are 0
  for (let t = 0; t < 2; t++) {
    const A = rigs[t], B = twins[t];
    A.r.process(new Float64Array(128), new Float64Array(128), 128); B.r.process(new Float64Array(128), new Float64Array(128), 128);
    for (const x of [A, B]) for (const [, a] of x.lines) for (let i = 0; i < a.length; i++) a[i] = PLANT[i % 7];
    const split = [1, 127, 64, 64, 100, 28];
    let diff = 0, rounds = 0;
    while (A.r.rs !== 0 || B.r.rs !== 0) {
      dl(); rounds++;
      A.r.rest(128);
      for (let j = 0; j < 2; j++) B.r.rest(split[rounds % 3 * 2 + j]);
      for (let l = 0; l < A.lines.length; l++) { const a = A.lines[l][1], b = B.lines[l][1]; for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) diff++; }
      assert.ok(rounds < 1000, 'the passes end');
    }
    assert.equal(diff, 0, A.name + ': the split rest() differs from the 128-frame one');
    let wrong = 0;
    for (const [, a] of A.lines) for (let i = 0; i < a.length; i++) { const v = PLANT[i % 7], w = Math.abs(v) < MIN32 && v !== 0 ? 0 : Math.fround(v); if (!Object.is(a[i], w)) wrong++; }
    assert.equal(wrong, 0, A.name + ': a value other than a float32 subnormal changed (or a subnormal kept)');
  }
  // set() mid-pass: the units may move, the pass starts over from the first
  const { r, lines } = rigs[0];
  r.process(new Float64Array(128), new Float64Array(128), 128);
  for (const [, a] of lines) a.fill(1e-40);
  r.rest(128); r.rest(128);
  assert.equal(r.rs, 2, 'a pass under way');
  reSet(r, lineFx(0));
  assert.equal(r.rs, 1, 'set() restarts it');
  while (r.rs !== 0) { dl(); r.rest(128); }
  assert.equal(total(subnormals(r)), 0, 'the restarted pass leaves none');
});
