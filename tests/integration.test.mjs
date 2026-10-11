// Integration tests (integrator, SPEC-serum §10.7): cross-module constants, factory content through the real DSP,
// and the engine harness — engine.js running in a node:vm "worklet scope" after serum-dsp.js and fx-dsp.js, with stubs
// for AudioWorkletProcessor, registerProcessor, sampleRate, currentFrame and the port. Run:
//   node --test 'tests/*.test.mjs'
// The main.js-level checks (§10.7 last item: project files, history, duplicate, tempo, program change) run headless in
// the UI simulation (scratchpad repair-ui/sim/t_serum.mjs), which boots the real main.js against a DOM stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as core from '../serum-core.js?v=5';
import * as W from '../wt.js?v=5';
import { memoryStore } from '../wtstore.js?v=5';
import { MODELS } from '../models.js?v=5';
import { loadFixture } from './fixtures/load.mjs';

const ROOT = new URL('../', import.meta.url);
const SRC = f => readFileSync(new URL(f, ROOT), 'utf8');
const ENGINE = SRC('engine.js'), SERUM_SRC = SRC('serum-dsp.js'), FX_SRC = SRC('fx-dsp.js');
const SERUM = MODELS.find(m => m.id === 'serum');
const quietConsole = { log() {}, warn() {}, error() {}, info() {} };

/* ------------------------------------------------------------------ harness */
// One AudioWorkletGlobalScope: the scripts in the browser's load order; serum / fx = null leaves a script out, a
// string replaces its source. Every processor of the scope shares currentFrame (advanced by run()).
function scope({ sr = 48000, serum = SERUM_SRC, fx = FX_SRC, console: con = console } = {}) {
  let Proc = null;
  const sb = { console: con, sampleRate: sr, currentFrame: 0 };
  sb.AudioWorkletProcessor = class { constructor() { this.port = { sent: [], postMessage(m) { this.sent.push(m); }, onmessage: null }; } };
  sb.registerProcessor = (name, c) => { Proc = c; };
  const ctx = vm.createContext(sb);
  if (serum !== null) vm.runInContext(serum, ctx, { filename: 'serum-dsp.js' });
  if (fx !== null) vm.runInContext(fx, ctx, { filename: 'fx-dsp.js' });
  vm.runInContext(ENGINE, ctx, { filename: 'engine.js' });
  return { ctx, sr, mk: (po = {}) => new Proc({ processorOptions: po }), get SD() { return ctx.SerumDSP; }, get FX() { return ctx.FXDSP; } };
}
// renders `frames` (multiple of 128) on every processor in lockstep; at(frame) runs before each block
function run(S, procs, frames, at) {
  frames = Math.ceil(frames / 128) * 128;
  const outs = procs.map(() => ({ L: new Float32Array(frames), R: new Float32Array(frames) }));
  const L = new Float32Array(128), R = new Float32Array(128);
  for (let o = 0; o < frames; o += 128) {
    if (at) at(o);
    procs.forEach((p, k) => { p.process([], [[L, R]]); outs[k].L.set(L, o); outs[k].R.set(R, o); });
    S.ctx.currentFrame += 128;
  }
  return outs;
}
const peak = x => { let m = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; } return m; };
const finite = x => x.every(Number.isFinite);
const maxStep = (x, a, b) => { let m = 0; for (let i = Math.max(1, a); i < b; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m; };
const maxDiff = (x, y) => { let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - y[i])); return m; };
const dB = x => 20 * Math.log10(Math.max(1e-30, x));

function sState(edit) { const s = core.defaultSerum(); if (edit) edit(s); return core.normalizeSerum(s); }
const row = (src, dst, amt = 1, o = {}) => Object.assign({ src, amt, dst, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1 }, o);
// the patch main.js sends for a Serum track (buildPatch): compileSerum + the track's FX rack + tempo
function sxPatch(s, o = {}) {
  const fx = o.fx || core.defaultFx(), bpm = o.bpm || 120;
  const p = SERUM.map({}, { s }, { bpm, smooth: 1 });
  p.fxr = core.compileFx(fx, { bpm, master: s.p['g.master'], bypass: s.p['g.bypass'], modded: core.fxModded(s), seed: !!o.seed });
  p.fxrT = core.compileFxT(fx);
  p.bpm = bpm;
  if (o.osCap) p.osCap = o.osCap;
  return p;
}
function plainPatch(id, fx, sr = 48000) {
  const m = MODELS.find(x => x.id === id), v = {}, P = {};
  for (const c of m.controls) v[c.id] = c.def;
  for (const c of m.controls) P[c.id] = c.conv ? c.conv(v[c.id]) : v[c.id];
  const p = m.map(P, v, { drift: 0, hiss: 0, sr, bpm: 120, smooth: 1 });
  p.fxr = core.compileFx(fx || core.defaultFx(), { bpm: 120 });
  p.fxrT = core.compileFxT(fx || core.defaultFx());
  p.bpm = 120;
  return p;
}
const entryOf = id => (id.startsWith('noise:') ? W.makeNoise(id) : W.makeEntry(id, W.factoryTable(id)));
const wtMsg = id => Object.assign({ t: 'wt' }, entryOf(id));
function sendSx(p, s, o) { // patch + the tables it needs, as main.js does
  const pt = sxPatch(s, o);
  p.msg({ t: 'patch', p: pt });
  for (const id of pt.needs) p.msg(wtMsg(id));
  return pt;
}
const fxWith = edit => { const fx = core.defaultFx(); edit(fx); return core.normalizeFx(fx); };

/* ------------------------------------------------------------------ constants across modules */
test('§10.7: serum-core constants equal SerumDSP / FXDSP tables and the fixtures', () => {
  const S = scope();
  const SD = S.SD, FX = S.FX;
  assert.ok(SD && FX, 'both DSP scripts loaded');
  assert.equal(SD.VER, core.CP_VER);
  assert.equal(FX.VER, core.FXP_VER);
  assert.deepEqual({ ...SD.DIDX }, { ...core.DIDX });
  assert.deepEqual({ ...SD.FIDX }, { ...core.FIDX });
  assert.deepEqual({ ...FX.FIDX }, { ...core.FIDX });
  assert.deepEqual({ ...SD.SIDX }, { ...core.SIDX });
  // laws of every destination (synth 0–147, FX 148–247; LAW_TAB_FX in fx idx order)
  assert.equal(SD.LAW_TAB.law.length, core.ND);
  core.DESTS.forEach((d, i) => {
    const law = core.LAW[d.law], cont = ['int', 'enum', 'bool'].includes(d.law) ? 0 : 1;
    assert.equal(SD.LAW_TAB.law[i], law, d.id + ' law');
    assert.equal(SD.LAW_TAB.lo[i], d.lo, d.id + ' lo');
    assert.equal(SD.LAW_TAB.hi[i], d.hi, d.id + ' hi');
    assert.equal(SD.LAW_TAB.cont[i], cont, d.id + ' cont');
    if (i >= core.NS) {
      const k = i - core.NS;
      assert.equal(FX.LAW_TAB_FX.law[k], law, d.id + ' fx law');
      assert.equal(FX.LAW_TAB_FX.lo[k], d.lo, d.id + ' fx lo');
      assert.equal(FX.LAW_TAB_FX.hi[k], d.hi, d.id + ' fx hi');
      assert.equal(FX.LAW_TAB_FX.cont[k], cont, d.id + ' fx cont');
    }
  });
  assert.equal(SD.SRC_POL.length, core.NSRC);
  core.SOURCES.forEach((s, i) => assert.equal(SD.SRC_POL[i], s.pol === 'bi' ? 1 : 0, 'source ' + s.id));
  assert.deepEqual([...SD.SUB_IDS], [...core.SUB_IDS]);
  assert.deepEqual([...SD.FILTER_FAMILY], [...core.FILTER_FAMILY]);
  core.FILTERS.forEach((f, i) => assert.equal(SD.FILTER_FAMILY[SD.FILTER_FAM_OF[i]], f.family, 'filter ' + f.id));
  const U = core.uniTables();
  for (const k of ['uniShape', 'uniStack', 'uniCenter']) assert.deepEqual([...SD.UNI[k]], [...U[k]], k);
  // ladders: mod-FX rates (Hz at 120 BPM) follow MODFX_LADDER; LFO ladders travel in the CP (compiled from serum-core)
  core.MODFX_LADDER.forEach((e, i) => assert.ok(Math.abs(FX.MODFX_HZ(i / 30, 1, 120) - (i === 0 ? 0 : 2 / e.beats)) < 1e-9, 'modfx ' + e.label));
  const cp = core.compileSerum(sState(s => { s.lfo[0].dot = 1; s.lfo[1].trip = 1; }), {}).serum;
  for (let l = 0; l < 2; l++) {
    const lad = core.lfoLadder(l === 0, l === 1);
    assert.equal(cp.lfoLadN[l], lad.length);
    lad.forEach((e, j) => assert.equal(cp.lfoLad[l * 43 + j], e.beats));
  }
  // fixtures (E1, M1) equal serum-core
  const fd = JSON.parse(SRC('tests/fixtures/dests.json')), ff = JSON.parse(SRC('tests/fixtures/filters.json'));
  assert.equal(fd.DESTS.length, core.DESTS.length);
  fd.DESTS.forEach((d, i) => {
    const c = core.DESTS[i];
    for (const k of ['id', 'label', 'law', 'lo', 'hi', 'fmt', 'scope', 'ctr', 'group']) assert.equal(c[k], d[k], d.id + '.' + k);
    assert.ok(Math.abs(c.def - d.def) < 1e-12, d.id + '.def');
  });
  assert.equal(ff.FILTERS.length, core.FILTERS.length);
  ff.FILTERS.forEach((f, i) => { for (const k of ['id', 'name', 'cat', 'varLabel', 'family']) assert.equal(core.FILTERS[i][k], f[k], f.id + '.' + k); });
  const cpDef = loadFixture('cp-default.json'), fxpDef = loadFixture('fxp-default.json'), live = core.compileSerum(core.defaultSerum(), {}).serum;
  for (const k of Object.keys(cpDef)) if (k !== 'ctKey') assert.deepEqual(ArrayBuffer.isView(live[k]) ? [...live[k]] : live[k], ArrayBuffer.isView(cpDef[k]) ? [...cpDef[k]] : cpDef[k], 'cp-default ' + k);
  const fxp = core.compileFx(core.defaultFx(), {});
  for (const k of Object.keys(fxpDef)) if (k !== 'xsKey') assert.deepEqual(ArrayBuffer.isView(fxp[k]) ? [...fxp[k]] : fxp[k], ArrayBuffer.isView(fxpDef[k]) ? [...fxpDef[k]] : fxpDef[k], 'fxp-default ' + k);
});

test('§10.7: the delay ladder of fx-dsp follows DLY_LADDER (echo times at 240 BPM)', () => {
  const S = scope(), FX = S.FX, sr = 48000, bpm = 240;
  for (let i = 0; i < 10; i++) { // 2 bar and 4 bar exceed the 2 s line at this tempo (clamped)
    const fx = fxWith(f => { f.p['fx.dly.on'] = 1; f.p['fx.dly.bpm'] = 1; f.p['fx.dly.timeL'] = i / 11; f.p['fx.dly.timeR'] = i / 11; f.p['fx.dly.feed'] = 0; f.p['fx.dly.mix'] = 1; f.p['fx.dly.q'] = 1; });
    const rack = new FX.FXRack(sr);
    rack.set(core.compileFx(fx, { bpm }), core.compileFxT(fx));
    const want = core.DLY_LADDER[i].beats * 60 / bpm * sr, n = Math.ceil((want + 2000) / 128) * 128;
    const L = new Float64Array(n), R = new Float64Array(n);
    L[0] = 1; R[0] = 1;
    for (let o = 0; o < n; o += 128) { const a = L.subarray(o, o + 128), b = R.subarray(o, o + 128); rack.process(a, b, 128); }
    let k = 1, m = 0;
    for (let j = 1; j < n; j++) if (Math.abs(L[j]) > m) { m = Math.abs(L[j]); k = j; }
    assert.ok(Math.abs(k - want) <= 2, `${core.DLY_LADDER[i].label}: echo at ${k}, want ${want.toFixed(1)}`);
  }
});

/* ------------------------------------------------------------------ factory content through the DSP */
test('§10.7: every factory preset renders at note 60 through the engine and its FX rack (−40…0 dBFS)', () => {
  const S = scope();
  for (const pr of core.FACTORY_PRESETS) {
    const p = S.mk({ os: 2 }), s = core.applyPreset(core.defaultSerum(), pr);
    sendSx(p, s, { fx: core.applyPresetFx(core.defaultFx(), pr.fx, []) });
    p.msg({ t: 'on', n: 60, v: 0.8 });
    const [o] = run(S, [p], 48000);
    const pk = Math.max(peak(o.L), peak(o.R));
    assert.ok(finite(o.L) && finite(o.R), pr.name + ' finite');
    assert.ok(dB(pk) > -40 && dB(pk) <= 0, `${pr.name}: peak ${dB(pk).toFixed(1)} dBFS`);
  }
});

test('§10.7: wt.makeEntry / makeNoise / noiseEntry output is accepted by storeWT', async () => {
  const S = scope(), SD = S.SD;
  for (const t of W.FACTORY_TABLES) assert.equal(SD.storeWT(t.id, entryOf(t.id)), true, t.id);
  for (const id of W.SUB_TABLES) assert.equal(SD.storeWT(id, entryOf(id)), true, id);
  for (const n of W.NOISES) assert.equal(SD.storeWT(n.id, W.makeNoise(n.id)), true, n.id);
  // user content: a table and noises through wtstore records (what main.js reads back) and frameToNoise
  const st = memoryStore(), saw = W.factoryTable('factory:Basic Shapes');
  const idT = await st.put({ name: 'Mine', frames: saw.frames.slice(0, 3), morph: 1 }, { name: 'Mine' });
  const tb = await st.get(idT);
  assert.equal(SD.storeWT(idT, W.makeEntry(idT, tb)), true, 'user table');
  const idN = await st.put(W.frameToNoise(saw.frames[2], 'Cycle'), { name: 'Cycle' });
  assert.equal(SD.storeWT(idN, W.noiseEntry(Object.assign(await st.get(idN), { id: idN }))), true, 'user noise (record)');
  const L = new Float32Array(30000).map((x, i) => Math.sin(i * 0.05) * 0.5);
  const idW = await st.put({ kind: 'noise', name: 'Wav', rate: 44100, ch: 2, root: 60, len: L.length, loopStart: 100, loopEnd: 20000, L, R: L.slice() }, { name: 'Wav' });
  assert.equal(SD.storeWT(idW, W.noiseEntry(Object.assign(await st.get(idW), { id: idW }))), true, 'user noise (stereo, loop)');
  // the embedded file form round-trips into a playable entry
  const rec = W.decodeEmbedded(W.encodeEmbedded({ id: idT, kind: 'wt', name: 'Mine', frames: 3, morph: 1, data: new Float32Array([...tb.frames[0], ...tb.frames[1], ...tb.frames[2]]).buffer }));
  const st2 = memoryStore();
  await st2.put(rec, { id: idT });
  assert.equal(SD.storeWT(idT + 'x', W.makeEntry(idT + 'x', await st2.get(idT))), true, 'embedded table');
});

test('§10.7: FXDSP.eqResponse (fx-ui EQ display) equals the EQ module’s measured response', () => {
  const S = scope(), FX = S.FX, sr = 48000;
  assert.match(SRC('fx-ui.js'), /\.eqResponse\(/, 'fx-ui draws the EQ with FXDSP.eqResponse');
  const fx = fxWith(f => {
    f.p['fx.eq.on'] = 1; f.p['fx.eq.typeL'] = 0.5; f.p['fx.eq.freqL'] = 0.42; f.p['fx.eq.qL'] = 0.6; f.p['fx.eq.gainL'] = 0.8;
    f.p['fx.eq.typeH'] = 0; f.p['fx.eq.freqH'] = 0.7; f.p['fx.eq.qH'] = 0.4; f.p['fx.eq.gainH'] = 0.25;
  });
  const fxp = core.compileFx(fx, {}), rack = new FX.FXRack(sr);
  rack.set(fxp, core.compileFxT(fx));
  const N = 16384, L = new Float64Array(N), R = new Float64Array(N);
  for (let o = 0; o < N; o += 128) { // settle (5 ms enable crossfade), then measure an impulse
    const a = L.subarray(o, o + 128), b = R.subarray(o, o + 128);
    rack.process(a, b, 128);
  }
  L.fill(0); R.fill(0); L[0] = 1; R[0] = 1;
  for (let o = 0; o < N; o += 128) { const a = L.subarray(o, o + 128), b = R.subarray(o, o + 128); rack.process(a, b, 128); }
  const freqs = [30, 100, 300, 700, 1000, 2000, 3000, 6000, 10000, 16000];
  const want = FX.eqResponse(fxp, null, freqs, sr);
  freqs.forEach((f, i) => {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) { const w = 2 * Math.PI * f * n / sr; re += L[n] * Math.cos(w); im -= L[n] * Math.sin(w); }
    const got = 10 * Math.log10(re * re + im * im);
    assert.ok(Math.abs(got - want[i]) < 0.1, `${f} Hz: module ${got.toFixed(2)} dB, eqResponse ${want[i].toFixed(2)} dB`);
  });
});

/* ------------------------------------------------------------------ engine harness (§10.7 a–l) */
test('§10.7a: a patch before its table is silent; after {t:"wt"} the output starts within one chunk', () => {
  const S = scope(), p = S.mk({ os: 2 }), s = sState();
  const pt = sxPatch(s);
  assert.deepEqual(pt.needs, ['factory:Default']);
  p.msg({ t: 'patch', p: pt });
  p.msg({ t: 'on', n: 60, v: 0.9 });
  let [o] = run(S, [p], 4800);
  assert.equal(peak(o.L) + peak(o.R), 0, 'silent while the table is missing');
  p.msg(wtMsg('factory:Default'));
  [o] = run(S, [p], 256);
  // latency of the output stage: the limiter's 1 ms look-ahead (48 frames); the decimator's leading taps add ~1
  const first = o.L.findIndex(x => Math.abs(x) > 1e-6), look = Math.max(4, Math.round(S.sr * 0.001));
  assert.ok(first >= 0 && first <= look + 4 + 2, 'first sample after the table at ' + first + ' (one chunk after the look-ahead)');
});

test('§10.7b: a song note at frame 0 (bounce path: songEvents before the first begin) plays', () => {
  const S = scope(), s = sState(), fpt = 48000 * 60 / (120 * 960);
  const p = S.mk({ os: 2, patch: sxPatch(s), wts: [entryOf('factory:Default')], song: { notes: [0, 960, 60, 100], cc: [] }, transport: { play: true, frame: 0, tick: 0, fpt, loop: false } });
  const [o] = run(S, [p], 24064);
  assert.ok(finite(o.L) && finite(o.R));
  assert.ok(peak(o.L) > 0.05, 'audible');
  assert.ok(o.L.findIndex(x => Math.abs(x) > 1e-6) < 64, 'starts at once');
});

test('§10.7c: a hard stop while voices sound (fade-out path) is finite and click-free at 48 and 192 kHz', () => {
  for (const sr of [48000, 192000]) {
    for (const how of ['model', 'panic']) {
      const S = scope({ sr }), p = S.mk({ os: 2 }), s = sState(st => { st.p['a.uni'] = 3 / 15; st.p['e1.rel'] = 0.5; });
      sendSx(p, s);
      for (const n of [48, 55, 60, 64]) p.msg({ t: 'on', n, v: 0.8 });
      const pre = run(S, [p], Math.round(sr * 0.3 / 128) * 128)[0];
      const fadeN = p.fadeN;
      if (how === 'model') p.msg({ t: 'patch', p: plainPatch('minimoog', null, sr) }); else p.msg({ t: 'panic' });
      assert.equal(p.tailSN, fadeN, 'the stereo fade was rendered (' + fadeN + ' OS frames)');
      const post = run(S, [p], Math.round(sr * 0.1 / 128) * 128)[0];
      assert.ok(finite(post.L) && finite(post.R), `${sr} ${how}: finite`);
      const steady = Math.max(maxStep(pre.L, pre.L.length - Math.round(sr * 0.05), pre.L.length), 1e-4);
      const jump = Math.max(Math.abs(post.L[0] - pre.L[pre.L.length - 1]), maxStep(post.L, 1, Math.round(sr * 0.02)));
      assert.ok(jump <= 2 * steady, `${sr} ${how}: step ${jump.toExponential(2)} vs steady ${steady.toExponential(2)}`);
      // after the 3 ms fade only the output DC blocker settles (a smooth decay, no new content)
      const rest = post.L.subarray(Math.round(sr * 0.02));
      assert.ok(peak(rest) < 3e-3 && maxStep(rest, 1, rest.length) < 1e-5, `${sr} ${how}: silent after the fade (${peak(rest).toExponential(1)})`);
    }
  }
});

test('§10.7d: POLY 8 → 4 → 32 and mono ↔ poly while notes sound never rebuild the voices (they grow with POLY)', () => {
  const S = scope(), p = S.mk({ os: 2 });
  sendSx(p, sState());
  const vs = p.voices, each = vs.slice();
  assert.equal(vs.length, 8, 'built up to POLY');
  for (let n = 60; n < 68; n++) p.msg({ t: 'on', n, v: 0.7 });
  run(S, [p], 4800);
  assert.equal(p.voices.filter(v => v.gate).length, 8);
  sendSx(p, sState(s => { s.voicing.poly = 4; }));
  assert.equal(p.voices.slice(4).filter(v => v.gate).length, 0, 'voices beyond POLY released');
  assert.deepEqual([...p.voices].map(v => v.spare), [0, 0, 0, 0, 1, 1, 1, 1], 'spare above POLY');
  run(S, [p], 4800);
  sendSx(p, sState(s => { s.voicing.poly = 32; }));
  assert.equal(p.voices.length, 32);
  assert.ok(p.voices.every(v => v.spare === 0));
  for (let n = 70; n < 90; n++) p.msg({ t: 'on', n, v: 0.7 });
  run(S, [p], 4800);
  assert.ok(p.voices.filter(v => v.gate).length >= 20);
  sendSx(p, sState(s => { s.voicing.mono = 1; }));
  const a = run(S, [p], 4800)[0];
  p.msg({ t: 'on', n: 40, v: 0.7 });
  sendSx(p, sState(s => { s.voicing.mono = 0; s.voicing.legato = 1; }));
  const b = run(S, [p], 4800)[0];
  assert.equal(p.voices, vs, 'same array');
  assert.ok(each.every((v, i) => p.voices[i] === v), 'same voice objects');
  assert.ok(finite(a.L) && finite(b.L) && peak(b.L) > 0);
});

test('§10.7e: Global quality 2× → 4× while sounding goes through the oversampling fade; voices continue', () => {
  const S = scope(), p = S.mk({ os: 2 });
  sendSx(p, sState());
  p.msg({ t: 'on', n: 57, v: 0.8 });
  run(S, [p], 9600);
  assert.equal(p.OS, 2);
  sendSx(p, sState(s => { s.global.os = 4; }));
  assert.equal(p.osPend, 4, 'pending behind the fade');
  const [o] = run(S, [p], 19200);
  assert.equal(p.OS, 4);
  assert.ok(finite(o.L) && finite(o.R));
  assert.ok(peak(o.L.subarray(9600)) > 0.05, 'still sounding at 4×');
  p.msg({ t: 'os', v: 1 }); // the app's oversampling does not apply to a Serum track
  run(S, [p], 1280);
  assert.equal(p.OS, 4);
  sendSx(p, sState(s => { s.global.os = 4; }), { osCap: 2 }); // the CPU safeguard's cap does
  run(S, [p], 9600);
  assert.equal(p.OS, 2);
});

test('§10.7f: a song rendered from tick T offline equals the live render after 1 s of pre-roll (−80 dB)', () => {
  const sr = 48000, bpm = 120, fpt = sr * 60 / (bpm * 960), T0 = 3840;
  const s = sState(st => {
    st.lfo[0].mode = 'off'; st.lfo[0].bpm = 1; st.lfo[0].anchor = 1; st.p['l1.rate'] = 0.55;
    st.matrix[0] = row('lfo1', 'f.cutoff', 0.4);
    st.p['f.on'] = 1; st.p['a.uni'] = 2 / 15; st.p['a.rand'] = 0;
    st.matrix[1] = row('lfo1', 'fx.cho.rate', 0.3);
  });
  const fx = fxWith(f => { f.p['fx.cho.on'] = 1; f.p['fx.cho.mix'] = 0.5; f.p['fx.dly.on'] = 1; f.p['fx.dly.mix'] = 0.3; f.p['fx.dly.bpm'] = 1; });
  const song = { notes: [0, 960, 48, 100, 1920, 960, 55, 90, 3840, 1920, 60, 110, 5760, 960, 64, 100, 7680, 1900, 67, 120], cc: [] };
  const end = 9600, dur = Math.ceil((end - T0) * fpt / 128) * 128 + 24064;
  // offline (bounce): everything through processorOptions, transport from T0 at frame 0
  const A = scope({ sr }), pt = sxPatch(s, { fx, bpm });
  const pa = A.mk({ os: 2, patch: pt, wts: pt.needs.map(entryOf), song, transport: { play: true, frame: 0, tick: T0, fpt, loop: false, end } });
  const off = run(A, [pa], dur)[0];
  // live: messages, 1 s of pre-roll, then play with seek at T0
  const B = scope({ sr }), pb = B.mk({ os: 2 });
  sendSx(pb, s, { fx, bpm });
  pb.msg(Object.assign({ t: 'song' }, song));
  run(B, [pb], sr);
  pb.msg({ t: 'transport', play: true, seek: true, frame: sr, tick: T0, fpt, loop: false, end });
  const live = run(B, [pb], dur)[0];
  const ref = Math.max(peak(off.L), peak(off.R));
  assert.ok(ref > 0.05, 'audible');
  const d = Math.max(maxDiff(off.L, live.L), maxDiff(off.R, live.R));
  assert.ok(dB(d / ref) < -80, `difference ${dB(d / ref).toFixed(1)} dB`);
});

test('§10.7g: switching a Serum track to the Minimoog clears the FX modulation (FX dests back at base)', () => {
  const S = scope(), p = S.mk({ os: 2 });
  const fx = fxWith(f => { f.p['fx.fil.on'] = 1; f.p['fx.fil.cutoff'] = 0.3; });
  sendSx(p, sState(st => { st.matrix[0] = row('env1', 'fx.fil.cutoff', 0.5); }), { fx });
  p.msg({ t: 'on', n: 60, v: 0.8 });
  run(S, [p], 4800);
  const k = core.FIDX.FIL_CUTOFF;
  assert.ok(p.rack.mdT[k] > 0.1, 'Env 1 modulates the FX filter cutoff');
  p.msg({ t: 'patch', p: plainPatch('minimoog', fx) });
  run(S, [p], 256);
  assert.ok(p.rack.mdT.every(x => x === 0) && p.rack.md.every(x => x === 0), 'offsets cleared');
  assert.equal(p.ct, null, 'curve tables dropped');
  assert.equal(p.kind, 'analog');
});

test('§10.7h: 3 s of silence take the skip path, which keeps an Off LFO in step with a rendered run', () => {
  const s = sState(st => { st.lfo[0].mode = 'off'; st.lfo[0].bpm = 0; st.p['l1.rate'] = 0.31; st.matrix[0] = row('lfo1', 'f.cutoff', 0.5); st.p['a.level'] = 0; });
  const A = scope(), pa = A.mk({ os: 2 }), B = scope(), pb = B.mk({ os: 2 });
  sendSx(pa, s); sendSx(pb, s);
  pb.msg({ t: 'on', n: 60, v: 0.8 }); // B keeps a (silent) voice sounding: never skips
  run(A, [pa], 3 * 48000 + 64 * 128);
  run(B, [pb], 3 * 48000 + 64 * 128);
  assert.ok(pa.quietF > 2 * 48000, 'A skipped');
  assert.ok(pb.anyActive(), 'B rendered');
  const a = A.SD.snapshot(pa).lfoPh[0], b = B.SD.snapshot(pb).lfoPh[0];
  assert.ok(a > 0 && Math.abs(a - b) < 1e-6, `Off LFO phase ${a} vs ${b}`);
});

test('§10.7i: the warm-up processor and a later processor render identically', () => {
  const S = scope(), p1 = S.mk({ os: 2 }), p2 = S.mk({ os: 2 });
  const s = sState(st => { st.p['a.uni'] = 4 / 15; st.p['a.warpMode'] = 6 / 22; st.p['a.warp'] = 0.4; st.p['f.on'] = 1; st.matrix[0] = row('lfo1', 'a.wt', 0.3); });
  const fx = fxWith(f => { f.p['fx.rev.on'] = 1; f.p['fx.hyper.on'] = 1; f.p['fx.hyper.unison'] = 3 / 7; });
  for (const p of [p1, p2]) sendSx(p, s, { fx });
  for (const p of [p1, p2]) { p.msg({ t: 'on', n: 60, v: 0.8 }); p.msg({ t: 'on', n: 67, v: 0.6 }); }
  const [a, b] = run(S, [p1, p2], 24064, o => { if (o === 12032) for (const p of [p1, p2]) p.msg({ t: 'off', n: 60 }); });
  assert.ok(peak(a.L) > 0.05);
  assert.equal(maxDiff(a.L, b.L) + maxDiff(a.R, b.R), 0, 'bit-identical');
  // and the same for a plain model through its rack
  const q1 = S.mk({ os: 2, patch: plainPatch('juno60', fx) }), q2 = S.mk({ os: 2, patch: plainPatch('juno60', fx) });
  for (const q of [q1, q2]) q.msg({ t: 'on', n: 60, v: 0.8 });
  const [c, d] = run(S, [q1, q2], 12032);
  assert.equal(maxDiff(c.L, d.L), 0);
});

test('§10.7j: without SerumDSP (failed load) other models play, Serum tracks are silent; without FXDSP the rack is bypassed', () => {
  const broken = SERUM_SRC.replace('const VER = 1;', 'throw new Error("broken build"); const VER = 1;');
  const N = scope(), X = scope({ serum: broken, console: quietConsole });
  assert.equal(X.SD, null, 'SerumDSP = null after a failing body');
  assert.ok(X.FX, 'fx-dsp still loads');
  const mm = [N.mk({ os: 2, patch: plainPatch('minimoog') }), X.mk({ os: 2, patch: plainPatch('minimoog') })];
  mm[0].msg({ t: 'on', n: 60, v: 0.8 }); mm[1].msg({ t: 'on', n: 60, v: 0.8 });
  const a = run(N, [mm[0]], 9600)[0], b = run(X, [mm[1]], 9600)[0];
  assert.ok(peak(b.L) > 0.05 && dB(maxDiff(a.L, b.L) / peak(a.L)) < -100, 'Minimoog unaffected');
  const sx = X.mk({ os: 2 });
  sendSx(sx, sState());
  sx.msg({ t: 'on', n: 60, v: 0.8 }); sx.msg({ t: 'pat', n: 60, v: 0.5 }); sx.msg({ t: 'off', n: 60, rv: 0.3 }); sx.msg({ t: 'smon', on: true });
  const o = run(X, [sx], 9600)[0];
  assert.equal(peak(o.L) + peak(o.R), 0, 'the Serum track is silent, nothing throws');
  // neither DSP script: no rack — FX settings are ignored, the dry signal passes
  const Z = scope({ serum: null, fx: null }), fx = fxWith(f => { f.p['fx.dist.on'] = 1; f.p['fx.dist.drive'] = 1; });
  const z1 = Z.mk({ os: 2, patch: plainPatch('minimoog', fx) }), z2 = Z.mk({ os: 2, patch: plainPatch('minimoog') });
  assert.equal(z1.rack, null);
  for (const z of [z1, z2]) z.msg({ t: 'on', n: 60, v: 0.8 });
  const [e, f] = run(Z, [z1, z2], 9600);
  assert.equal(maxDiff(e.L, f.L), 0, 'rack bypassed');
});

test('engine repairs: panic clears effect tails, master / Bypass without fx-dsp, a DX7 DAC fade under Serum, no stale chorus', () => {
  const S = scope(), sr = 48000;
  // panic while a note rings into an infinite reverb: the output fades and stays silent (no re-excited tail)
  const rev = fxWith(f => { f.p['fx.rev.on'] = 1; f.p['fx.rev.mix'] = 0.8; f.p['fx.rev.size'] = 0.8; f.p['fx.rev.t'] = 1; });
  for (const mk of [() => S.mk({ os: 2, patch: plainPatch('minimoog', rev) }), () => { const p = S.mk({ os: 2 }); sendSx(p, sState(), { fx: rev }); return p; }]) {
    const p = mk();
    p.msg({ t: 'on', n: 60, v: 0.9 });
    let done = false;
    const [o] = run(S, [p], sr * 1.5, f => { if (!done && f >= sr / 2) { done = true; p.msg({ t: 'panic' }); } });
    assert.ok(peak(o.L.subarray(sr * 0.3, sr * 0.5)) > 0.01, 'sounding before');
    // (what remains after the 5 ms fade is the output DC blocker settling: sub-audio, −45 dB and falling 0.2 dB/ms)
    assert.ok(dB(peak(o.L.subarray(sr * 0.52))) < -40 && dB(peak(o.L.subarray(sr))) < -100, 'after panic: ' + dB(peak(o.L.subarray(sr * 0.52))).toFixed(1) + ' / ' + dB(peak(o.L.subarray(sr))).toFixed(1));
    assert.ok(maxStep(o.L, sr * 0.5 - 256, sr * 0.52) < 0.2, 'faded, no click');
  }
  // fx-dsp missing: Serum's master volume and Bypass still apply (the rack's output stage, deviation 3)
  const X = scope({ fx: null }), lev = [];
  for (const [m, b] of [[undefined, 0], [0.2, 0], [undefined, 1]]) {
    for (const Z of [S, X]) {
      const p = Z.mk({ os: 2 });
      sendSx(p, sState(st => { if (m !== undefined) st.p['g.master'] = m; st.p['g.bypass'] = b; }));
      p.msg({ t: 'on', n: 60, v: 0.8 });
      lev.push(peak(run(Z, [p], 9600)[0].L));
    }
  }
  assert.ok(Math.abs(dB(lev[0]) - dB(lev[1])) < 0.5 && Math.abs(dB(lev[2]) - dB(lev[3])) < 0.5, 'levels with and without the rack: ' + lev.map(v => dB(v).toFixed(1)));
  assert.equal(lev[4] + lev[5], 0, 'Bypass silences either way');
  // a sounding DX7 (Vintage DAC on) switched to Serum at the same oversampling: its DAC fade drains, the skip engages
  const dx = S.mk({ os: 2, patch: plainPatch('dx7') });
  dx.msg({ t: 'on', n: 60, v: 0.9 });
  run(S, [dx], 4800);
  sendSx(dx, sState());
  assert.ok(dx.tailDN > 0 || dx.OS !== 2, 'a DAC fade pending');
  run(S, [dx], sr * 3);
  assert.equal(dx.tailDN, 0, 'drained');
  assert.ok(dx.quietF > sr * 2, 'silence skip engaged');
  // Juno-60 → Serum → Juno-60 with no note: the chorus lines start empty (no replay of the old notes)
  const ju = S.mk({ os: 2, patch: plainPatch('juno60') });
  ju.msg({ t: 'on', n: 60, v: 1 }); ju.msg({ t: 'on', n: 67, v: 1 });
  run(S, [ju], sr / 2);
  sendSx(ju, sState());
  run(S, [ju], sr);
  ju.msg({ t: 'patch', p: plainPatch('juno60') });
  const [jo] = run(S, [ju], sr * 0.05);
  assert.ok(dB(peak(jo.L)) < -60, 'no stale chorus burst: ' + dB(peak(jo.L)).toFixed(1) + ' dB');
});

test('§10.7k: {t:"pat"} and {t:"off", rv} reach the voices (Poly AT and Release Velocity sources)', () => {
  const S = scope(), p = S.mk({ os: 2 }), C = core.DEST_INDEX['f.cutoff'];
  sendSx(p, sState(st => { st.p['f.cutoff'] = 0; st.matrix[0] = row('pat', 'f.cutoff', 1); }));
  p.msg({ t: 'on', n: 60, v: 0.8 });
  run(S, [p], 2560);
  assert.ok(Math.abs(S.SD.snapshot(p).eff[C]) < 1e-6, 'no poly pressure yet: channel aftertouch (0)');
  p.msg({ t: 'pat', n: 60, v: 0.7 });
  p.msg({ t: 'pat', n: 61, v: 0.2 });
  run(S, [p], 2560);
  assert.ok(Math.abs(S.SD.snapshot(p).eff[C] - 0.7) < 0.01, 'pat of note 60: ' + S.SD.snapshot(p).eff[C]);
  for (const [rv, want] of [[0.2, 0.2], [undefined, 0.5]]) {
    const q = S.mk({ os: 2 });
    sendSx(q, sState(st => { st.p['f.cutoff'] = 0; st.p['e1.rel'] = 0.6; st.matrix[0] = row('relvel', 'f.cutoff', 1); }));
    q.msg({ t: 'on', n: 62, v: 0.8 });
    run(S, [q], 2560);
    q.msg(rv === undefined ? { t: 'off', n: 62 } : { t: 'off', n: 62, rv });
    run(S, [q], 1280);
    const e = S.SD.snapshot(q).eff[C];
    assert.ok(Math.abs(e - want) < 0.01, `release velocity ${rv} → ${e}`);
  }
});

test('§10.7l: a live patch without serumT keeps using the stored curve tables', () => {
  const S = scope(), p = S.mk({ os: 2 }), q = S.mk({ os: 2 });
  const s1 = sState(st => { st.lfo[0].mode = 'trig'; st.lfo[0].pts = [[0, 0, 0], [0.3, 1, 0.5], [1, 0, 0]]; st.matrix[0] = row('lfo1', 'a.wt', 0.8); });
  const pt1 = sendSx(p, s1);
  sendSx(q, s1);
  const key = p.ct.key;
  assert.equal(key, pt1.serumT.key);
  const s2 = core.normalizeSerum(JSON.parse(JSON.stringify(s1)));
  s2.p['a.level'] = 0.6; // a knob move: same curves
  const pt2 = sxPatch(s2), pt2q = sxPatch(s2);
  assert.equal(pt2.serumT.key, key);
  delete pt2.serumT; delete pt2.fxrT; // what sendPatch strips for this node
  p.msg({ t: 'patch', p: pt2 });
  q.msg({ t: 'patch', p: pt2q });
  assert.equal(p.ct.key, key, 'CT kept');
  for (const x of [p, q]) x.msg({ t: 'on', n: 60, v: 0.8 });
  const [a, b] = run(S, [p, q], 9600);
  assert.ok(peak(a.L) > 0.02);
  assert.equal(maxDiff(a.L, b.L), 0, 'same sound as with the tables re-sent');
});

test('engine: smon / fxph messages, every model through the rack, direct out through the rack, transport hooks', () => {
  const S = scope(), p = S.mk({ os: 2 });
  sendSx(p, sState(st => { st.p['s.on'] = 1; st.sub.direct = 1; st.p['s.level'] = 0.8; }), { fx: fxWith(f => { f.p['fx.rev.on'] = 1; f.p['fx.rev.mix'] = 0.4; }) });
  assert.equal(p.sxDir, 1, 'direct-out pair in use');
  p.port.sent.length = 0;
  p.msg({ t: 'smon', on: true });
  p.msg({ t: 'on', n: 48, v: 0.8 });
  const [o] = run(S, [p], 12800);
  const mons = p.port.sent.filter(m => m.t === 'smon');
  assert.ok(mons.length >= 7 && mons.length <= 9, mons.length + ' snapshots in 0.27 s (~30 Hz)');
  const m = mons[mons.length - 1];
  assert.ok(m.s && m.s.oscVoices >= 1 && m.gr && m.gr.length === 4 && m.fxph && m.fxph.length === 4);
  const stats = p.port.sent.filter(x => x.t === 'stats');
  assert.ok(stats.length && stats[0].os === 2 && stats[0].voices >= 1, 'stats: own OS and oscillator voices');
  p.port.sent.length = 0;
  p.msg({ t: 'fxph' });
  assert.equal(p.port.sent[0].t, 'fxph');
  assert.equal(p.port.sent[0].v.length, 4);
  assert.ok(finite(o.L) && peak(o.L) > 0.02);
  // every plain model renders through a rack with modules on
  const fx = fxWith(f => { f.p['fx.cho.on'] = 1; f.p['fx.cmp.on'] = 1; f.p['fx.eq.on'] = 1; });
  for (const md of MODELS) {
    if (md.custom) continue;
    const q = S.mk({ os: 2, patch: plainPatch(md.id, fx) });
    q.msg({ t: 'on', n: 60, v: 0.8 });
    const [r] = run(S, [q], 4864);
    assert.ok(finite(r.L) && finite(r.R) && peak(r.L) > 1e-3, md.id);
  }
  // transport stop with "silence tails" fades the rack out; play with seek re-seeds Serum's host clock
  const t = S.mk({ os: 2 }), fpt = 48000 * 60 / (120 * 960);
  sendSx(t, sState(), { fx: fxWith(f => { f.p['fx.dly.on'] = 1; f.p['fx.dly.mix'] = 1; f.p['fx.dly.feed'] = 0.9; }) });
  t.msg({ t: 'song', notes: [0, 480, 60, 100], cc: [] });
  t.msg({ t: 'transport', play: true, seek: true, frame: S.ctx.currentFrame, tick: 0, fpt, loop: false });
  run(S, [t], 24064);
  assert.ok(t.songBeat() > 0.9 && Math.abs(t.bpm - 120) < 1e-9);
  t.msg({ t: 'transport', play: false });
  assert.equal(t.songBeat(), null);
  const [z] = run(S, [t], 4864);
  const rest = z.L.subarray(1024); // after the 5 ms fade only the output DC blocker settles
  assert.ok(peak(z.L.subarray(0, 256)) > 1e-3 && peak(rest) < 1e-3 && maxStep(rest, 1, rest.length) < 1e-5, 'tails silenced on stop');
});
