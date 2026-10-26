// The instruments' side of the Windows idle-DSP report (review-idle, lane B): fx-denormal.test.mjs pins the racks' Float32
// lines; here the Float64 states an instrument leaves behind after release / ■ that never reach exact 0 — a y ← c·y recursion
// sticks in the subnormal range (c × the value rounds back to it) — so a panel rack behind it never sees exact zeros: its
// idle() stays false, the Inst renders every quantum for ever, its panel's sweep never runs, and with a panel reverb the
// track's float32 output stays at ±1.4e-44, holding MASTER's sweep off too (every one an x86 assist). An empty panel (the
// default) skips 2 s after release and never meets them. #1 the 808 / 606 / 909 output stages (post8 / post6 / post9:
// ±2.65e-321 / 4.6e-321; postV already flushed); #2 the Solina's ensemble (its 2-poles in a ±1e-323 limit cycle) and the
// bypassed Juno chorus line beside it; the Juno's BBD hiss (the lead's call (a): it counts as silence for the idle skip —
// once the voices have been quiet for the skip's 2 s it is exact 0, so a Juno with a panel module stops hissing exactly when
// one without does); #8 Track.outStage's DC blocker (±4.71e-321 on a never-quiet 900 Series track gone silent). Each case: a
// panel EQ, or a panel Reverb (pre-delay 250 ms: its rack sweeps its pool before the host skips it), + a MASTER Reverb; play,
// release / ■, a fixed stretch of silence: the Inst takes the idle skip (the 900 Series: never quiet by design, it renders on)
// and no subnormal is left anywhere (the Track, MASTER). Every loop is a fixed quantum count, with a wall-clock deadline.
// Run alone: node --max-old-space-size=2048 --test tests/inst-denormal.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dspScope } from './dsp-scope.mjs';
import * as C from '../fx-core.js?v=9';
import * as W from '../wt.js?v=9';
import * as core from '../serum-core.js?v=9';
import { patchFor, MODELS } from '../models.js?v=9';
import { lawNorm } from '../laws.js?v=9';
import { drumTrack, DRUM_PATTERNS, patchTrack, presetSet } from './bench-scenarios.mjs';

const SR = 48000, QPS = SR / 128;
const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
const D = dspScope({ engine: true, fast: true, console: quiet });
const Track = D.Proc, Master = D.procs['synth-master'];
const F64 = '[object Float64Array]', F32 = '[object Float32Array]', MIN64 = 2.2250738585072014e-308, MIN32 = 1.1754943508222875e-38;
const isSub = (v, lim) => v !== 0 && v > -lim && v < lim;
// every subnormal reachable from root (typed arrays: f32 below its own threshold, f64 below the double's; plain numbers in
// fields and arrays), by path → count; cycle-safe; the scope-wide registry and the fake port stay out (fx-denormal's walk)
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
const describe = m => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p, k]) => `${k}× ${p}`).join('; ');
// a wall-clock bound checked inside the quantum loops (node:test's { timeout } cannot interrupt a synchronous body)
const deadline = ms => { const t0 = Date.now(); return () => { if (Date.now() - t0 > ms) throw new Error('deadline: over ' + ms + ' ms'); }; };
const nOf = (type, pid, v) => { const T = C.FXP_TAB[type], rows = T[3] || T[2] || T[1], r = rows.find(x => x.pid === pid); return lawNorm(r.law, r.lo, r.hi, v, r.def); };
function inst(fx, type, p) { const id = C.newInstance(fx, type, { rack: 0 }); Object.assign(fx.racks[0].mods.find(x => x.id === id).p, p || {}); }
// the panel: an EQ, a Reverb (pre-delay 250 ms ≥ the rack's ⅛ s sweep period: the pool is swept before idle() lets the host
// skip it — a 0 ms pre-delay idles first and the skip freezes the pool as it stands), or nothing
function panel(kind) {
  const fx = C.defaultFx2();
  if (kind === 'eq') inst(fx, 'eq', {});
  else if (kind === 'rev') inst(fx, 'rev', { mix: 0.3, size: 0.3, decay: 0.3, pre: nOf('rev', 'pre', 250) });
  return fx;
}
const chainOf = fx => ({ fxr: C.compileFx(fx, { bpm: 120, rate: SR }), fxrT: C.compileFxT(fx) });
const defVals = id => Object.fromEntries(MODELS.find(x => x.id === id).controls.map(c => [c.id, c.def]));
function graphTrack(B, trackId) { // a bench-scenarios track (drumTrack / patchTrack)
  const p = new Track({ processorOptions: { os: 4, hostOS: 4, trackId } });
  p.port.postMessage = () => {};
  p.msg(B.graph);
  for (const [id, patch] of Object.entries(B.patches)) p.msg({ t: 'patch', i: id, p: patch });
  for (const [id, c] of Object.entries(B.chains)) p.msg(Object.assign({ t: 'chain', c: id }, c));
  for (const [id, s] of Object.entries(B.seqs || {})) p.msg({ t: 'seq', i: id, s });
  if (B.song) p.msg(B.song);
  return p;
}
function classicTrack(model, fx, trackId) {
  const p = new Track({ processorOptions: { os: 2, hostOS: 4, trackId } }), patch = patchFor(model, defVals(model), fx, { sr: SR, bpm: 120 });
  p.port.postMessage = () => {};
  p.msg({ t: 'patch', p: patch });
  for (const id of patch.needs || []) if (/^(factory|noise):/.test(id)) p.msg(Object.assign({ t: 'wt' }, id.startsWith('noise:') ? W.makeNoise(id) : W.makeEntry(id, W.factoryTable(id))));
  return p;
}
function masterRev() {
  const fx = C.defaultFx2(); inst(fx, 'rev', { mix: 0.15, size: 0.3, decay: 0.3 });
  const M = new Master({ processorOptions: {} }); M.port.postMessage = () => {};
  M.msg(Object.assign({ t: 'chain' }, chainOf(fx)));
  return M;
}
// a Track into MASTER, quantum by quantum: q() → the quantum's index; the Inst's renders logged (skip: renderSpan → 0)
function rig(T, M, dl) {
  const out = [[new Float32Array(128), new Float32Array(128)]], mL = new Float32Array(128), mR = new Float32Array(128);
  const mIn = [[mL, mR]], mOut = [[new Float32Array(128), new Float32Array(128)]], I = T.insts[0], st = { q: 0, last: -1, pk: 0, mCalls: 0 };
  const rs = I.renderSpan;
  I.renderSpan = function (n) { const v = rs.call(this, n); if (v) st.last = st.q; return v; };
  const mr = M.c.rack, mp = mr.process;
  mr.process = function (...a) { st.mCalls++; return mp.apply(this, a); };
  st.run = secs => {
    for (let k = 0; k < Math.round(secs * QPS); k++) {
      dl();
      T.process([], out);
      const L = out[0][0], R = out[0][1];
      for (let i = 0; i < 128; i++) { mL[i] = L[i]; mR[i] = R[i]; const a = L[i] < 0 ? -L[i] : L[i]; if (a > st.pk) st.pk = a; }
      M.process(mIn, mOut);
      D.ctx.currentFrame += 128; st.q++;
    }
  };
  return st;
}
const SIL = 40, SKIP_BY = 20;                                    // the silence; the Inst skips within SKIP_BY s of release / ■
// one case: play (drums: their pattern 4 s, then ■; a classic: a chord 2 s, then key-up), SIL s of silence; → the problems
function idleCase(model, fxKind, dl) {
  D.ctx.currentFrame = 0;
  const fx = panel(fxKind), drums = MODELS.find(x => x.id === model).family === 'drums', M = masterRev();
  let T, B = null;
  if (drums) {
    B = drumTrack(model === 'tr808' ? DRUM_PATTERNS.d8p : model === 'sdsv' ? DRUM_PATTERNS.dvp : 'demo', null, false, model);
    B.chains.fx1 = chainOf(fx);
    T = graphTrack(B, 'trk_' + model);
  } else T = classicTrack(model, fx, 'trk_' + model);
  const I = T.insts[0], s = rig(T, M, dl), tag = `${model} + panel ${fxKind}`, bad = [];
  if (B) { const tp = Object.assign({ t: 'transport' }, B.transport); T.msg(tp); M.msg(tp); s.run(4); T.msg({ t: 'transport', play: false }); M.msg({ t: 'transport', play: false }); }
  else { for (const n of [48, 55, 60, 64]) T.msg({ t: 'on', n, v: 100 }); s.run(2); for (const n of [48, 55, 60, 64]) T.msg({ t: 'off', n }); }
  if (!(s.pk > 1e-3)) bad.push(`${tag}: did not sound (peak ${s.pk})`);
  if (!I.rack || I.rack.calm !== 0) bad.push(`${tag}: the panel rack is not busy`);
  const q0 = s.q; s.mCalls = 0;
  s.run(SIL);
  if (s.mCalls !== SIL * QPS) bad.push(`${tag}: MASTER's rack ran ${s.mCalls} of ${SIL * QPS} quanta`);
  if (s.last >= q0 + SKIP_BY * QPS) bad.push(`${tag}: the Inst still renders ${((s.last - q0) / QPS).toFixed(2)} s after release / ■ (no idle skip)`);
  const mt = subnormals(T), mm = subnormals(M);
  if (total(mt)) bad.push(`${tag}: ${total(mt)} subnormals in the Track (${describe(mt)})`);
  if (total(mm)) bad.push(`${tag}: ${total(mm)} subnormals in MASTER (${describe(mm)})`);
  T.msg({ t: 'bye' }); M.msg({ t: 'bye' });
  return bad;
}

test('#1 the 808 / 606 / 909 (and the SDS-V) with a panel EQ or Reverb + a MASTER Reverb: after ■ the Inst takes the idle skip and no subnormal is left (the output stages\' coupling states flushed)', { timeout: 600000 }, () => {
  const dl = deadline(300000), bad = [];
  for (const m of ['tr808', 'tr606', 'tr909', 'sdsv']) for (const k of ['eq', 'rev']) bad.push(...idleCase(m, k, dl));
  assert.deepEqual(bad, []);
});

test('#2 the Solina at its defaults (ENSEMBLE on) with a panel EQ or Reverb + a MASTER Reverb: after key-up the Inst takes the idle skip and no subnormal is left (the ensemble\'s 2-poles and the bypassed chorus line flushed)', { timeout: 600000 }, () => {
  const dl = deadline(300000), bad = [];
  assert.equal(defVals('solina').en, 1, 'the Solina\'s ENSEMBLE defaults to on');
  for (const k of ['eq', 'rev']) bad.push(...idleCase('solina', k, dl));
  assert.deepEqual(bad, []);
});

// every classic Inst feeds its chorus and ensemble lines while it renders, switched off too (a real BBD is always clocked):
// the bypass path's pre-filter fell into the same ±1e-323 cycle, its line frozen full of subnormals at the skip (2 048 each)
test('#2 the other classics (not the Juno: its hiss below) with a panel EQ or Reverb + a MASTER Reverb: after key-up the Inst takes the idle skip and no subnormal is left (the bypassed chorus / ensemble lines too)', { timeout: 600000 }, () => {
  const dl = deadline(300000), bad = [];
  for (const m of ['modular', 'minimoog', 'arp2600', 'cs80', 'prophet5', 'ms20', 'tb303', 'obxa', 'jupiter8', 'dx7']) for (const k of ['eq', 'rev']) bad.push(...idleCase(m, k, dl));
  assert.deepEqual(bad, []);
});

// the Juno-60 at its defaults (chorus I, HISS on): the BBD hiss (−76 dBFS) is the panel's input for ever — without a panel
// module the Inst skips 2 s after the voices end and the hiss stops; with one the rack never idled, so it hissed on
test('the Juno-60\'s hiss (the lead\'s call (a)): with a panel EQ or Reverb + a MASTER Reverb the Inst takes the idle skip after key-up and no subnormal is left', { timeout: 600000 }, () => {
  const dl = deadline(300000), bad = [];
  assert.equal(defVals('juno60').hs > 0 && defVals('juno60').ch > 0, true, 'the Juno\'s defaults: chorus on, HISS on');
  for (const k of ['eq', 'rev']) bad.push(...idleCase('juno60', k, dl));
  assert.deepEqual(bad, []);
});

test('the Juno-60\'s hiss stops with a panel module exactly when it does without one: the machine\'s output bit-identical until the panel-less Inst skips, exact 0 a few ms later (the chorus\'s output filter rings out)', { timeout: 600000 }, () => {
  const dl = deadline(120000), REL = 2 * QPS, RUN = 12 * QPS;
  // the same track id (the Inst's salt: the same voices, the same hiss stream); the machine's output — Lb / Rb as renderSpan
  // leaves them, before the panel — per quantum from key-up (null: skipped)
  const take = fxKind => {
    D.ctx.currentFrame = 0;
    const T = classicTrack('juno60', panel(fxKind), 'trk_juno'), I = T.insts[0], out = [[new Float32Array(128), new Float32Array(128)]], got = [];
    let q = 0;
    const rs = I.renderSpan;
    I.renderSpan = function (n) { const v = rs.call(this, n); if (q >= REL) got.push(v ? Float64Array.from([...this.Lb.subarray(0, n), ...this.Rb.subarray(0, n)]) : null); return v; };
    for (const n of [48, 55, 60, 64]) T.msg({ t: 'on', n, v: 100 });
    for (; q < REL + RUN; q++) { dl(); if (q === REL) for (const n of [48, 55, 60, 64]) T.msg({ t: 'off', n }); T.process([], out); D.ctx.currentFrame += 128; }
    T.msg({ t: 'bye' });
    return got;
  };
  const pk = a => { let m = 0; for (let i = 0; i < a.length; i++) { const v = a[i] < 0 ? -a[i] : a[i]; if (v > m) m = v; } return m; };
  const A = take('none'), B = take('eq'), qs = A.indexOf(null);
  assert.ok(qs > 0 && qs <= 3 * QPS, 'without a panel module the Inst skips within 3 s of key-up (at ' + qs + ')');
  assert.ok(A.slice(qs).every(x => x === null), 'and stays skipped');
  let diff = -1;
  for (let k = 0; k < qs && diff < 0; k++) { const a = A[k], b = B[k]; if (b === null || b.some((v, i) => !Object.is(v, a[i]))) diff = k; }
  assert.equal(diff, -1, 'with a panel EQ the machine\'s output is bit-identical to the panel-less one until that skip');
  assert.ok(pk(B[qs - 1]) > 1e-5, 'it hisses up to that quantum (peak ' + pk(B[qs - 1]) + ')');
  let late = 0, nz = -1;
  for (let k = qs + 1; k < B.length; k++) if (B[k] !== null) { const p = pk(B[k]); if (p > late) late = p; if (p > 0) nz = k; }
  assert.ok(late < 1e-30, 'from the next quantum on no hiss is left (peak ' + late + ')');
  assert.ok(nz < qs + 8, 'exact 0 within 8 quanta of it (the last non-zero ' + (nz - qs) + ' quanta after)');
});

// lane B's note (IMPL-SC §12) and the tests above, resolved by FXRack.rest: a panel Reverb at its default 0 ms pre-delay is
// idle() before its rack's first ⅛ s sweep, so the host's skip freezes the rack as it stands (the pool now comes out clean: the
// diffusers' flush, lane A's #7), and a feed-forward line — the Reverb's 2.5 s pre-delay, a Delay's 2 s lines — keeps what its
// input wrote on the way to exact 0 (22 float32 subnormals in a Prophet-5's pre-delay, either host). The skip now flushes the
// stopped rack's Float32 lines below FLT_MIN, a share per skipped frame. Every host: the panel its Inst holds (Track.renderSpan's
// skip), a panel no Inst holds — the Inst also patched to OUT: Track.chainSpan stops the rack once idle() —, and a Serum's own FX
// (Inst.renderSpan's skip)
function graphClassic(model, fx, trackId) {
  const p = new Track({ processorOptions: { os: 2, hostOS: 4, trackId } }), patch = patchFor(model, defVals(model), fx, { sr: SR, bpm: 120 });
  p.port.postMessage = () => {};
  p.msg({ t: 'graph', insts: [{ id: 'i1', on: true, zone: { lo: 0, hi: 127, xp: 0 }, salt: 0 }], chains: [{ id: 'fx1' }],
    edges: [['i1', 'fx1', 1], ['i1', 'out', 1], ['fx1', 'out', 1]], out: 'out', key: 'rest' });
  const q = Object.assign({}, patch); delete q.fxr; delete q.fxrT;   // (a classic Inst's patch on a graph node: its panel is a {t: 'chain'})
  p.msg({ t: 'patch', i: 'i1', p: q });
  p.msg(Object.assign({ t: 'chain', c: 'fx1' }, chainOf(fx)));
  for (const id of patch.needs || []) if (/^(factory|noise):/.test(id)) p.msg(Object.assign({ t: 'wt' }, id.startsWith('noise:') ? W.makeNoise(id) : W.makeEntry(id, W.factoryTable(id))));
  return p;
}
function serumTrack(fx, trackId) { // (silenceTails 0: the tails ring out as a live key-up leaves them)
  const p = new Track({ processorOptions: { os: 2, hostOS: 4, trackId } });
  const patch = patchFor('serum', { s: core.normalizeSerum(core.defaultSerum()) }, fx, { sr: SR, bpm: 120, prefs: { smooth: 1, silenceTails: 0 } });
  p.port.postMessage = () => {};
  p.msg({ t: 'patch', p: patch });
  for (const id of patch.needs || []) if (/^(factory|noise):/.test(id)) p.msg(Object.assign({ t: 'wt' }, id.startsWith('noise:') ? W.makeNoise(id) : W.makeEntry(id, W.factoryTable(id))));
  return p;
}
test('a panel Reverb at its default 0 ms pre-delay after a 20 ms Delay, + a MASTER Reverb — the panel held by its Inst, by none (the Inst also to OUT), a Serum\'s own FX: after key-up the rack stops, its rest() pass completes and no subnormal is left (FXRack.rest flushes the lines the skip froze)', { timeout: 600000 }, () => {
  const dl = deadline(300000), bad = [];
  const cases = [...['prophet5', 'juno60', 'solina'].flatMap(m => [[m, 'held'], [m, 'none']]), ['serum', 'own']];
  for (const [model, host] of cases) {
    D.ctx.currentFrame = 0;
    const fx = C.defaultFx2(), M = masterRev(), tag = `${model} (${host === 'none' ? 'no Inst\'s' : host})`, held = host !== 'none';
    inst(fx, 'dly', { feed: 0.6, mix: 0.3, timeL: nOf('dly', 'timeL', 20), timeR: nOf('dly', 'timeR', 30), bpm: 0 });
    inst(fx, 'rev', { mix: 0.3, size: 0.3, decay: 0.3 });
    const id = 'trk_' + model, T = host === 'own' ? serumTrack(fx, id) : held ? classicTrack(model, fx, id) : graphClassic(model, fx, id), s = rig(T, M, dl);
    const r = held ? T.insts[0].rack : T.chains.find(c => c.id === 'fx1').rack;
    if (!r || (T.insts[0].rack === r) !== held) { bad.push(`${tag}: the panel's rack is ${held ? 'not' : ''} the Inst's`); continue; }
    if ((T.insts[0].kind === 'serum') !== (host === 'own')) { bad.push(`${tag}: the Inst is a ${T.insts[0].kind}`); continue; }
    let last = -1;
    const rp = r.process;
    r.process = function (...a) { last = s.q; return rp.apply(this, a); };
    for (const n of [48, 55, 60, 64]) T.msg({ t: 'on', n, v: 100 });
    s.run(2);
    for (const n of [48, 55, 60, 64]) T.msg({ t: 'off', n });
    if (!(s.pk > 1e-3)) bad.push(`${tag}: did not sound (peak ${s.pk})`);
    const q0 = s.q;
    s.run(SIL);
    if (s.last >= q0 + SKIP_BY * QPS) bad.push(`${tag}: the Inst still renders ${((s.last - q0) / QPS).toFixed(2)} s after key-up`);
    if (last >= q0 + SKIP_BY * QPS) bad.push(`${tag}: the panel's rack still runs ${((last - q0) / QPS).toFixed(2)} s after key-up`);
    if (r.rs !== 0) bad.push(`${tag}: the rest() pass did not complete (rs ${r.rs})`);
    const mt = subnormals(T), mm = subnormals(M);
    if (total(mt)) bad.push(`${tag}: ${total(mt)} subnormals in the Track (${describe(mt)})`);
    if (total(mm)) bad.push(`${tag}: ${total(mm)} subnormals in MASTER (${describe(mm)})`);
    T.msg({ t: 'bye' }); M.msg({ t: 'bye' });
  }
  assert.deepEqual(bad, []);
});

// the 900 Series is never quiet while MAIN OUT is patched (IMPL-9 §3.6): its Track runs the output stage every quantum, the DC
// blocker's y ← Rdc·y on the machine's exact zeros sticking at ±4.71e-321 after ~29 s (with it Lb / Rb and the limiter's ring)
test('#8 the 900 Series (Classic bass) with no panel module, a panel EQ or Reverb, + a MASTER Reverb: 60 s after key-up it still renders (never quiet) and no subnormal is left (Track.outStage\'s DC blocker flushed)', { timeout: 600000 }, () => {
  const dl = deadline(300000), bad = [];
  for (const k of ['none', 'eq', 'rev']) {
    D.ctx.currentFrame = 0;
    const B = patchTrack(presetSet('Classic bass')), M = masterRev(), tag = 'Classic bass + panel ' + k;
    B.chains.fx1 = chainOf(panel(k));
    const T = graphTrack(B, 'trk_m9'), s = rig(T, M, dl);
    T.msg({ t: 'on', n: 60, v: 100 }); s.run(1); T.msg({ t: 'off', n: 60 });
    if (!(s.pk > 1e-3)) bad.push(`${tag}: did not sound (peak ${s.pk})`);
    s.run(60);
    if (s.last !== s.q - 1) bad.push(`${tag}: the Inst stopped rendering (never quiet by design)`);
    const mt = subnormals(T), mm = subnormals(M);
    if (total(mt)) bad.push(`${tag}: ${total(mt)} subnormals in the Track (${describe(mt)})`);
    if (total(mm)) bad.push(`${tag}: ${total(mm)} subnormals in MASTER (${describe(mm)})`);
    T.msg({ t: 'bye' }); M.msg({ t: 'bye' });
  }
  assert.deepEqual(bad, []);
});
