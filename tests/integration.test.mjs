// Integration tests (integrator; SPEC-serum §10.7, SPEC-serum2 §15.13): cross-module constants, factory content through
// the real DSP, and the engine harness — engine.js running in a node:vm "worklet scope" after the SPEC-serum2 §0.3 script
// list (tests/dsp-scope.mjs: sx-base … fx-dsp in table order; scripts that do not exist yet, or M1a stubs, define their
// globals as null), with stubs for AudioWorkletProcessor (a port that records what it posts), registerProcessor,
// sampleRate and currentFrame. Run:
//   node --test 'tests/*.test.mjs'
// The main.js-level checks (host contract, part delivery, preview, render-last, storage, MIDI) are in tests/main.test.mjs,
// which boots the real main.js in the page simulation tests/main-sim.mjs.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../serum-core.js?v=7';
import * as W from '../wt.js?v=7';
import { memoryStore } from '../wtstore.js?v=7';
import { MODELS, patchFor } from '../models.js?v=7';
import { loadFixture } from './fixtures/load.mjs';
import { dspScope, DSP_TABLE, DSP_FILES, noAlloc } from './dsp-scope.mjs';

const ROOT = new URL('../', import.meta.url);
const SRC = f => readFileSync(new URL(f, ROOT), 'utf8');
const ENGINE = SRC('engine.js'), SERUM_SRC = SRC('serum-dsp.js'), FX_SRC = SRC('fx-dsp.js');
const SERUM = MODELS.find(m => m.id === 'serum');
const quietConsole = { log() {}, warn() {}, error() {}, info() {}, debug() {} };

/* ------------------------------------------------------------------ harness */
// One AudioWorkletGlobalScope: the §0.3 scripts in table order, then engine.js. serum / fx (and any `overrides` entry,
// keyed by file): null = that script failed to load (its global null), a string replaces its source. Every processor of
// the scope shares currentFrame (advanced by run()).
function scope({ sr = 48000, serum, fx, overrides = {}, console: con = console, fast = false } = {}) {
  const ov = Object.assign({}, overrides);
  if (serum !== undefined) ov['serum-dsp.js'] = serum;
  if (fx !== undefined) ov['fx-dsp.js'] = fx;
  const D = dspScope({ sampleRate: sr, overrides: ov, console: con, fast });
  let Proc = null;
  D.run('(function (reg) { globalThis.AudioWorkletProcessor = class AudioWorkletProcessor { constructor() {'
    + ' this.port = { sent: [], postMessage(m) { this.sent.push(m); }, onmessage: null }; } };'
    + ' globalThis.registerProcessor = function registerProcessor(name, cls) { reg(cls); }; })', 'integration-worklet.js')(c => { Proc = c; });
  D.run(ENGINE, 'engine.js');
  if (!Proc) throw new Error('engine.js registered no processor');
  const ctx = D.ctx;
  return {
    ctx, sr, D, mk: (po = {}) => new Proc({ processorOptions: po }),
    get SD() { return D.global('SerumDSP'); }, get FX() { return D.global('FXDSP'); }, get SB() { return D.global('SxBase'); },
    get PROCS() { return D.run('PROCS', 'integration-procs.js'); },
  };
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

// a Serum state in S1 mode (the v1 field set, which the M1a voice renders; SPEC-serum2 §2.6.4) with edits, normalised
function sState(edit) { const s = core.defaultSerum(); s.global.s1 = 1; if (edit) edit(s); return core.normalizeSerum(s); }
const row = (src, dst, amt = 1, o = {}) => Object.assign({ src, amt, dst, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1 }, o);
// the patch main.js sends for a Serum track (buildPatch = models.js patchFor + live-session fields)
function sxPatch(s, o = {}) {
  const p = patchFor('serum', { s }, o.fx || core.defaultFx(), { sr: o.sr || 48000, bpm: o.bpm || 120, prefs: { smooth: 1, silenceTails: 1 }, seed: !!o.seed });
  if (o.osCap) p.osCap = o.osCap;
  return p;
}
function plainPatch(id, fx, sr = 48000) {
  const m = MODELS.find(x => x.id === id), v = {};
  for (const c of m.controls) v[c.id] = c.def;
  return patchFor(m, v, fx || core.defaultFx(), { sr, bpm: 120, drift: 0, hiss: 0 });
}
const entryOf = id => (id.startsWith('noise:') ? W.makeNoise(id) : W.makeEntry(id, W.factoryTable(id)));
const wtMsg = id => Object.assign({ t: 'wt' }, entryOf(id));
function sendSx(p, s, o) { // patch + the tables it needs, as main.js does
  const pt = sxPatch(s, o);
  p.msg({ t: 'patch', p: pt });
  for (const id of pt.needs) p.msg(wtMsg(id));
  return pt;
}
const fxWith = edit => { const fx = core.defaultFxV1(); edit(fx); return core.normalizeFx(fx); };   // a v1 rack, migrated (RULINGS2 F1)
const plain = x => (ArrayBuffer.isView(x) ? [...x] : x);

/* ------------------------------------------------------------------ constants across modules */
test('§15.13: serum-core constants equal SxBase / SerumDSP / FXDSP tables and the fixtures', () => {
  const S = scope(), SD = S.SD, FX = S.FX, SB = S.SB;
  assert.ok(SD && FX && SB && S.D.global('SxMod'), 'the DSP scripts loaded');
  assert.equal(SD.VER, core.CP_VER);
  assert.equal(FX.VER, core.FXP_VER);
  // v2 tables by voice-vector index (SxBase, §11.5): every destination with a voice slot, every source
  assert.deepEqual({ ...SB.DIDX2 }, { ...core.DIDX });
  assert.deepEqual({ ...SB.SIDX2 }, { ...core.SIDX });
  assert.deepEqual({ ...SB.GIDX }, { ...core.GIDX });
  assert.equal(SB.NSV, core.NSV); assert.equal(SB.ND, core.ND); assert.equal(SB.NV1, core.NV1); assert.equal(SB.NF1, core.NF1);
  assert.equal(SB.LAW_TAB2.law.length, core.NSV);
  core.DESTS.forEach((d, i) => {
    const v = core.vi(i);
    if (v < 0) return;
    const law = core.LAW[d.law], cont = ['int', 'enum', 'bool'].includes(d.law) ? 0 : 1;
    assert.equal(SB.LAW_TAB2.law[v], law, d.id + ' law (vi ' + v + ')');
    assert.equal(SB.LAW_TAB2.lo[v], d.lo, d.id + ' lo');
    assert.equal(SB.LAW_TAB2.hi[v], d.hi, d.id + ' hi');
    assert.equal(SB.LAW_TAB2.cont[v], cont, d.id + ' cont');
  });
  assert.equal(SB.SRC_POL2.length, core.NSRC);
  core.SOURCES.forEach((s, i) => assert.equal(SB.SRC_POL2[i], s.pol === 'bi' ? 1 : 0, 'source ' + s.id));
  // SerumDSP's Phase-1 tables are the v1 prefix (synth rows 0–147 by vi = idx, FX rows 148–247, sources 0–33)
  assert.equal(Object.keys(SD.DIDX).length, core.NS);
  for (const k of Object.keys(SD.DIDX)) assert.equal(SD.DIDX[k], core.DIDX[k], 'DIDX.' + k);
  assert.deepEqual({ ...SD.FIDX }, { ...core.FIDX });
  assert.deepEqual({ ...FX.FIDX }, { ...core.FIDX });
  for (const k of Object.keys(SD.SIDX)) assert.equal(SD.SIDX[k], core.SIDX[k], 'SIDX.' + k);
  assert.equal(SD.LAW_TAB.law.length, core.NV1);
  core.DESTS.slice(0, core.NV1).forEach((d, i) => {
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
  assert.equal(SD.SRC_POL.length, 34);
  for (let i = 0; i < 34; i++) assert.equal(SD.SRC_POL[i], core.SOURCES[i].pol === 'bi' ? 1 : 0, 'source ' + core.SOURCES[i].id);
  assert.deepEqual([...SD.SUB_IDS], [...core.SUB_IDS]);
  assert.deepEqual([...SD.FILTER_FAMILY], core.FILTER_FAMILY.slice(0, SD.FILTER_FAMILY.length));
  core.FILTERS.slice(0, 96).forEach((f, i) => assert.equal(SD.FILTER_FAMILY[SD.FILTER_FAM_OF[i]], f.family, 'filter ' + f.id));
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
  // fixtures (C1, F1) equal the modules: dests.json = the v1 prefix, dests2.json the whole table, filters.json types 0–95
  const fd = JSON.parse(SRC('tests/fixtures/dests.json')), fd2 = JSON.parse(SRC('tests/fixtures/dests2.json')), ff = JSON.parse(SRC('tests/fixtures/filters.json'));
  assert.equal(fd.DESTS.length, core.NV1);
  assert.equal(fd2.DESTS.length, core.ND);
  for (const [tab, what] of [[fd.DESTS, 'dests.json'], [fd2.DESTS, 'dests2.json']]) {
    tab.forEach((d, i) => {
      const c = core.DESTS[i];
      for (const k of ['id', 'label', 'law', 'lo', 'hi', 'fmt', 'scope', 'ctr', 'group']) assert.equal(c[k], d[k], what + ' ' + d.id + '.' + k);
      assert.ok(Math.abs(c.def - d.def) < 1e-12, what + ' ' + d.id + '.def');
    });
  }
  assert.equal(ff.FILTERS.length, 96);
  ff.FILTERS.forEach((f, i) => { for (const k of ['id', 'name', 'cat', 'varLabel', 'family']) assert.equal(core.FILTERS[i][k], f[k], f.id + '.' + k); });
  const cpDef = loadFixture('cp2-default.json'), fxpDef = loadFixture('fxp-default.json'), live = core.compileSerum(core.defaultSerum(), {}).serum;
  assert.deepEqual(Object.keys(live).sort(), Object.keys(cpDef).sort(), 'CP v2 fields');
  for (const k of Object.keys(cpDef)) if (k !== 'ctKey') assert.deepEqual(plain(live[k]), plain(cpDef[k]), 'cp2-default ' + k);
  const fxp = core.compileFx(core.defaultFxV1(), {});
  for (const k of Object.keys(fxpDef)) if (k !== 'xsKey') assert.deepEqual(plain(fxp[k]), plain(fxpDef[k]), 'fxp-default ' + k);
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
  let n = 0;
  for (const pr of core.FACTORY_PRESETS) {
    const s = core.applyPreset(core.defaultSerum(), pr), fx = core.applyPresetFx(core.defaultFx(), pr.fx, []);
    // presets with sample-like assets (Serum 2 factory presets: samples, multisamples, IRs, generated on demand) are
    // rendered at note 60 with their assets by tests/presets2.test.mjs (§15.13)
    if (sxPatch(s, { fx }).needs.some(id => !id.startsWith('noise:') && !W.factoryTable(id))) continue;
    n++;
    const p = S.mk({ os: 2 });
    sendSx(p, s, { fx });
    p.msg({ t: 'on', n: 60, v: 0.8 });
    const [o] = run(S, [p], 48000);
    const pk = Math.max(peak(o.L), peak(o.R));
    assert.ok(finite(o.L) && finite(o.R), pr.name + ' finite');
    assert.ok(dB(pk) > -40 && dB(pk) <= 0, `${pr.name}: peak ${dB(pk).toFixed(1)} dBFS`);
  }
  assert.ok(n >= core.FACTORY_PRESETS_V1.length, n + ' presets rendered here (every migrated Phase-1 preset)');
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
  assert.deepEqual(pt.needs, ['factory:Default Shapes']);
  p.msg({ t: 'patch', p: pt });
  p.msg({ t: 'on', n: 60, v: 0.9 });
  let [o] = run(S, [p], 4800);
  assert.equal(peak(o.L) + peak(o.R), 0, 'silent while the table is missing');
  p.msg(wtMsg('factory:Default Shapes'));
  [o] = run(S, [p], 256);
  // latency of the output stage: the limiter's 1 ms look-ahead (48 frames); the decimator's leading taps add ~1
  const first = o.L.findIndex(x => Math.abs(x) > 1e-6), look = Math.max(4, Math.round(S.sr * 0.001));
  assert.ok(first >= 0 && first <= look + 4 + 2, 'first sample after the table at ' + first + ' (one chunk after the look-ahead)');
});

test('§10.7b: a song note at frame 0 (bounce path: songEvents before the first begin) plays', () => {
  const S = scope(), s = sState(), fpt = 48000 * 60 / (120 * 960);
  const p = S.mk({ os: 2, patch: sxPatch(s), wts: [entryOf('factory:Default Shapes')], song: { notes: [0, 960, 60, 100], cc: [] }, transport: { play: true, frame: 0, tick: 0, fpt, loop: false } });
  const [o] = run(S, [p], 24064);
  assert.ok(finite(o.L) && finite(o.R));
  assert.ok(peak(o.L) > 0.05, 'audible');
  assert.ok(o.L.findIndex(x => Math.abs(x) > 1e-6) < 64, 'starts at once');
});

/* ------------------------------------------------------------------ §11.10 warm-ups of later patches */
// A live processor warms the code up on every patch whose shape (SerumDSP.warmKey) it has not warmed yet while the track
// is silent — not only on the scope's first patch — and ticks the lazy jobs of every patch (one step per quantum).
const s2State = edit => { const s = core.defaultSerum(); Object.assign(s.p, { 'a.rand': 0, 'b.rand': 0 }); if (edit) edit(s); return core.normalizeSerum(s); };
const W2i = id => core.WARPS2.findIndex(w => w.id === id) / (core.WARPS2.length - 1);
test('§11.10: a later patch of another shape re-arms the hidden-voice warm-up while silent; the same shape or sounding voices do not; lazy jobs tick for every patch', () => {
  const S = scope(), p = S.mk({ os: 2, hostOS: 4 });
  sendSx(p, s2State());
  assert.equal(p.sxW, 1, 'the first patch arms the warm-up');
  const k0 = p.sxWK;
  assert.ok(typeof k0 === 'string' && k0.startsWith('S2|'), k0);
  let n = 0;
  while (p.sxW && n < 400) { run(S, [p], 128); n++; }
  assert.ok(p.sxW === 0 && n > 80, 'the hidden voices ran (' + n + ' quanta)');
  // a continuous control (same shape): nothing to warm
  sendSx(p, s2State(s => { s.p['a.level'] = 0.4; }));
  assert.equal(p.sxW, 0);
  // another warp mode and filter type: re-armed while silent
  const shape2 = s => { Object.assign(s.p, { 'a.w1': W2i('bend_p'), 'a.warp': 0.5, 'f.on': 1, 'f.type2': 3 / 107 }); };
  sendSx(p, s2State(shape2));
  assert.equal(p.sxW, 1, 're-armed');
  assert.notEqual(p.sxWK, k0);
  // a note ends it at once; a shape change while voices sound counts as warmed (their code runs)
  p.msg({ t: 'on', n: 60, v: 0.8 });
  assert.equal(p.sxW, 0, 'the real note ends the warm-up');
  run(S, [p], 1280);
  sendSx(p, s2State(s => { shape2(s); s.p['a.w2'] = W2i('d_tube'); s.p['a.warp2'] = 0.3; }));
  assert.equal(p.sxW, 0, 'not armed while a voice sounds');
  const k2 = p.sxWK;
  p.msg({ t: 'off', n: 60 });
  run(S, [p], 48000);
  sendSx(p, s2State(s => { shape2(s); s.p['a.w2'] = W2i('d_tube'); s.p['a.warp2'] = 0.6; }));
  assert.ok(p.sxW === 0 && p.sxWK === k2, 'that shape counts as warmed');
  // lazy jobs (SxBase.warmAdd) of a later patch: one step per quantum whether or not a voice sounds
  let steps = 0;
  assert.equal(S.SB.warmAdd(p, 'test-job', () => ++steps < 3), true);
  run(S, [p], 128);
  assert.equal(steps, 1, 'ticked while silent');
  p.msg({ t: 'on', n: 62, v: 0.8 });
  run(S, [p], 256);
  assert.equal(steps, 3, 'and while a voice sounds');
  assert.equal(p.sxLazy(), 0);
  p.msg({ t: 'off', n: 62 });
  // offline processors never warm up
  const off = S.mk({ os: 2, hostOS: 4, offline: true });
  sendSx(off, s2State(shape2));
  assert.ok(off.sxW === 0 && off.sxWK === '');
});

// The first chord after a silent preset change runs warm code: its slowest quantum stays within 2× the chord's steady
// quantum (V8; calibrated against the same chord, the best of 3 attempts, RULINGS2 Performance). Notes arrive as boxed
// numbers (a double array, as from typed-array reads) — they must not generalise a voice field at the first note.
test('§11.10: the first chord after a silent preset change (WT → another WT shape) costs ≤ 2× the steady quantum', () => {
  const chordNotes = Float64Array.from([48, 52, 55, 59, 62, 65, 69, 72]);
  const heavy = s => {
    for (const k of ['a', 'b']) Object.assign(s.p, { [k + '.on']: 1, [k + '.uni']: 6 / 15, [k + '.det']: 0.3, [k + '.w1']: W2i('bend_p'), [k + '.warp']: 0.5,
      [k + '.w2']: W2i('d_tube'), [k + '.warp2']: 0.3 });
    Object.assign(s.p, { 'f.on': 1, 'f.type2': 12 / 107 });
  };
  let best = Infinity, info = '';
  for (let attempt = 0; attempt < 3 && best > 2; attempt++) {
    const S = scope({ fast: true }), p = S.mk({ os: 2, hostOS: 4 });
    sendSx(p, s2State(s => { s.p['b.on'] = 1; }));
    run(S, [p], 128 * 200);
    for (const n of chordNotes) p.msg({ t: 'on', n, v: 0.8 });
    run(S, [p], 128 * 100);
    for (const n of chordNotes) p.msg({ t: 'off', n });
    run(S, [p], 48000);
    sendSx(p, s2State(heavy));
    run(S, [p], 128 * 200);                                     // browsing: silent, the warm-up runs
    assert.equal(p.sxW, 0, 'warm-up done');
    for (const n of chordNotes) p.msg({ t: 'on', n, v: 0.8 });
    const t = [];
    for (let q = 0; q < 120; q++) { const t0 = performance.now(); run(S, [p], 128); t.push(performance.now() - t0); }
    const first = Math.max(...t.slice(0, 4)), steady = t.slice(60).sort((a, b) => a - b)[30];
    const r = first / steady;
    info += ` [${first.toFixed(2)} / ${steady.toFixed(2)} ms]`;
    if (r < best) best = r;
  }
  assert.ok(best <= 2, 'first chord / steady = ' + best.toFixed(2) + info);
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
    st.lfo[0].mode = 'free'; st.lfo[0].bpm = 1; st.lfo[0].anchor = 1; st.p['l1.rate'] = 0.55;
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
  // the FX filter instance (id 'fil', S1 variant) and its cutoff row in the FX-context layout (§4.2)
  const u = p.rack.byId.get('fil'), k = core.FXP_TAB.fil[1].findIndex(r => r.pid === 'cutoff');
  assert.ok(u && k >= 0 && u.mdT[k] > 0.1, 'Env 1 modulates the FX filter cutoff');
  p.msg({ t: 'patch', p: plainPatch('minimoog', fx) });
  run(S, [p], 256);
  assert.ok(p.rack.U.every(x => x.mdT.every(v => v === 0) && x.md.every(v => v === 0)) && p.rack.gmT.every(v => v === 0), 'offsets cleared');
  assert.equal(p.ct, null, 'curve tables dropped');
  assert.equal(p.kind, 'analog');
});

test('§10.7h: 3 s of silence take the skip path, which keeps an Off LFO in step with a rendered run', () => {
  const s = sState(st => { st.lfo[0].mode = 'free'; st.lfo[0].bpm = 0; st.p['l1.rate'] = 0.31; st.matrix[0] = row('lfo1', 'f.cutoff', 0.5); st.p['a.level'] = 0; });
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
  const broken = SERUM_SRC.replace('const VER = 2;', 'throw new Error("broken build"); const VER = 2;');
  assert.notEqual(broken, SERUM_SRC);
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
  const s1 = sState(st => { st.lfo[0].mode = 'retrig'; st.lfo[0].pts = [[0, 0, 0], [0.3, 1, 0.5], [1, 0, 0]]; st.matrix[0] = row('lfo1', 'a.wt', 0.8); });
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
  sendSx(p, sState(st => { st.p['s.on'] = 1; st.sub.route = 2; st.p['s.level'] = 0.8; }), { fx: fxWith(f => { f.p['fx.rev.on'] = 1; f.p['fx.rev.mix'] = 0.4; }) });
  assert.equal(p.sxDir, 1, 'direct-out pair in use');
  p.port.sent.length = 0;
  p.msg({ t: 'smon', on: true });
  p.msg({ t: 'on', n: 48, v: 0.8 });
  const [o] = run(S, [p], 12800);
  const mons = p.port.sent.filter(m => m.t === 'smon');
  assert.ok(mons.length >= 7 && mons.length <= 9, mons.length + ' snapshots in 0.27 s (~30 Hz)');
  const m = mons[mons.length - 1];
  // FX meters by FXP instance (fxLayout order, §11.11): gain reduction Float32Array(4·48), phases Float64Array(48)
  assert.ok(m.s && m.s.oscVoices >= 1 && m.gr && m.gr.length === 4 * 48 && m.fxph && m.fxph.length === 48);
  assert.equal(m.ftap, null, 'no monitor tap asked for');
  // the rack's monitor tap (§13.5 Delay spectrum overlay): {t: 'fxtap', id} → smon.ftap = Float32Array(1024)
  p.msg({ t: 'fxtap', id: 'rev' });
  run(S, [p], 3200);
  const mt = p.port.sent.filter(x => x.t === 'smon').at(-1);
  assert.ok(mt.ftap && mt.ftap.length === 1024 && mt.ftap.some(x => x !== 0), 'the Reverb instance tapped');
  p.msg({ t: 'fxtap', id: '' });
  run(S, [p], 1280);
  assert.equal(p.port.sent.filter(x => x.t === 'smon').at(-1).ftap, null);
  const stats = p.port.sent.filter(x => x.t === 'stats');
  assert.ok(stats.length && stats[0].os === 2 && stats[0].voices >= 1, 'stats: own OS and oscillator voices');
  p.port.sent.length = 0;
  p.msg({ t: 'fxph' });
  assert.equal(p.port.sent[0].t, 'fxph');
  assert.equal(p.port.sent[0].v.length, 48);
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

/* ------------------------------------------------------------------ SPEC-serum2 M1a step 4: engine, script list, PROCS */
test('§0.3: main.js, the golden harness and dsp-scope load the same 11 scripts in table order; every file exists', async () => {
  const main = SRC('main.js'), m = /const DSP_FILES = \[([^\]]*)\]/.exec(main);
  assert.ok(m, 'main.js DSP_FILES');
  assert.deepEqual(m[1].split(',').map(x => x.trim().replace(/^'|'$/g, '')).filter(Boolean), [...DSP_FILES]);
  assert.match(main, /Promise\.allSettled\(DSP_URLS\.map\(u => addModule\(c, u\)\)\)/, 'requested concurrently');
  assert.match(main, /async function addModule\(c, url\) \{\n  try \{ await c\.audioWorklet\.addModule\(url\); \}/, 'by the worklet (a blob: URL of the cached script only when that fails)');
  assert.match(main, /wk\.loadDSP\(DSP_URLS\)/, 'the same list on the main thread');
  const H = await import('./golden-harness.mjs');
  assert.deepEqual([...H.DSP_V2], [...DSP_FILES]);
  for (const f of DSP_FILES) assert.ok(SRC(f).length > 0, f);
  // a scope with the whole list: every global defined (an object, or null for a script still an M1a stub)
  const S = scope();
  for (const [f, g] of DSP_TABLE) {
    const v = S.D.global(g);
    assert.ok(v === null || (typeof v === 'object' && Object.isFrozen(v)), `${f} → ${g}`);
  }
  for (const g of ['SxBase', 'SxMod', 'SerumDSP', 'FXDSP']) assert.ok(S.D.global(g), g + ' is a real script');
});

test('§0.3: evaluation order does not matter (lazy references): the list in reverse order renders identically', () => {
  const pr = core.FACTORY_PRESETS.find(x => x.name === 'Neuro Snarl'), s = core.applyPreset(core.defaultSerum(), pr);
  const fx = core.applyPresetFx(core.defaultFx(), pr.fx, []);
  const fwd = scope(), D = dspScope({ files: [], console: quietConsole });
  for (const f of [...DSP_FILES].reverse()) D.reload(f);
  let Proc = null;
  D.run('(function (reg) { globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {}, onmessage: null }; } };'
    + ' globalThis.registerProcessor = function (n, c) { reg(c); }; })', 'rev-worklet.js')(c => { Proc = c; });
  D.run(ENGINE, 'engine.js');
  const rev = { ctx: D.ctx, mk: po => new Proc({ processorOptions: po }) };
  const outs = [fwd, rev].map(S => {
    S.ctx.currentFrame = 0;
    const p = S.mk({ os: 2, offline: true });
    sendSx(p, s, { fx });
    p.msg({ t: 'on', n: 48, v: 0.9 }); p.msg({ t: 'on', n: 55, v: 0.7 });
    return run(S, [p], 24064, o => { if (o === 12032) p.msg({ t: 'off', n: 48 }); })[0];
  });
  assert.ok(peak(outs[0].L) > 0.05);
  assert.equal(maxDiff(outs[0].L, outs[1].L) + maxDiff(outs[0].R, outs[1].R), 0);
});

test('§7.9: PROCS registry — track nodes register by trackId, bye unregisters, extNote plays on the target at its frame', () => {
  const S = scope(), PROCS = S.PROCS, mm = () => plainPatch('minimoog');
  const a = S.mk({ os: 2, trackId: 'trk_1', patch: mm() }), b = S.mk({ os: 2, trackId: 'trk_2', patch: mm() });
  const c = S.mk({ os: 2, trackId: 'trk_3', patch: mm() }), r = S.mk({ os: 2, patch: mm() }); // r: preview / render farm, no id
  assert.equal(PROCS.get('trk_1'), a); assert.equal(PROCS.get('trk_2'), b); assert.equal(PROCS.get('trk_3'), c);
  assert.ok(![...PROCS.values()].includes(r), 'nodes without a track id are not registered');
  run(S, [a, b, c, r], 1280);
  // a source's tapped event at frame F arrives for F + 128. At a quantum boundary the target (b) plays exactly like a
  // reference (r) given the same note by message before that quantum; mid-quantum (c, +64) the span is split there.
  const F = S.ctx.currentFrame, Q = F + 128;
  PROCS.get('trk_2').extNote(Q, 1, 60, 0.8); PROCS.get('trk_2').extNote(Q + 4864, 0, 60, 0);
  PROCS.get('trk_3').extNote(Q + 64, 1, 60, 0.8); PROCS.get('trk_3').extNote(Q + 64 + 4864, 0, 60, 0);
  const [, ob, oc, or] = run(S, [a, b, c, r], 12800, o => {
    if (F + o === Q) r.msg({ t: 'on', n: 60, v: 0.8 });
    if (F + o === Q + 4864) r.msg({ t: 'off', n: 60 });
  });
  assert.ok(peak(ob.L) > 0.02, 'the target plays');
  assert.equal(peak(ob.L.subarray(0, 128)), 0, 'silent before its frame');
  assert.equal(maxDiff(ob.L, or.L) + maxDiff(ob.R, or.R), 0, 'note-on and note-off at their frames (quantum boundary)');
  const on = o => o.L.findIndex(x => Math.abs(x) > 1e-9);
  assert.equal(on(oc) - on(or), 64, 'mid-quantum: the span is split at the event frame');
  assert.equal(b.extN + c.extN, 0, 'rings drained');
  assert.equal(b.lastNote, 60);
  assert.ok(!b.voices.some(v => v.gate) && !c.voices.some(v => v.gate), 'the note-offs arrived');
  // overflow: the oldest note-on is dropped, never a note-off
  const F1 = S.ctx.currentFrame + 1e6;
  c.extNote(F1, 0, 1, 0);
  for (let i = 0; i < 300; i++) c.extNote(F1 + 1 + i, 1, i % 128, 0.5);
  assert.equal(c.extN, 256);
  assert.equal(c.ext[0], F1, 'the note-off kept'); assert.equal(c.ext[1], 0);
  assert.equal(c.ext[4], F1 + 1 + 45, 'the 45 oldest note-ons dropped');
  c.msg({ t: 'panic' });
  assert.equal(c.extN, 0, 'panic clears the ring');
  // bye
  b.msg({ t: 'bye' });
  assert.equal(PROCS.has('trk_2'), false);
  assert.equal(PROCS.get('trk_1'), a, 'others stay registered');
  const b2 = S.mk({ os: 2, trackId: 'trk_2', patch: mm() }); // a re-created node takes the id
  b.msg({ t: 'bye' });                                      // a late bye of the old node does not remove the new one
  assert.equal(PROCS.get('trk_2'), b2);
});

test('§4.1/§12.4: CT v2 parts — a patch carrying only the changed parts, or a {t:"ct"} message, equals the full tables', () => {
  const S = scope(), mkS = pts => sState(st => { st.lfo[0].mode = 'retrig'; st.lfo[0].pts = pts; st.matrix[0] = row('lfo1', 'a.wt', 0.8); st.matrix[1] = row('lfo2', 'f.cutoff', 0.4); st.p['f.on'] = 1; });
  const s1 = mkS([[0, 0, 0], [0.3, 1, 0.5], [1, 0, 0]]), s2 = mkS([[0, 0, 0], [0.7, 1, -0.5], [1, 0.2, 0]]);
  const full = S.mk({ os: 2 }), part = S.mk({ os: 2 }), msg = S.mk({ os: 2 });
  for (const p of [full, part, msg]) sendSx(p, s1);
  run(S, [full, part, msg], 1280);
  const pt2 = sxPatch(s2), T = pt2.serumT, old = sxPatch(s1).serumT;
  const changed = Object.keys(T.parts).filter(k => T.parts[k].key !== old.parts[k].key);
  assert.deepEqual(changed, ['lfo0'], 'one part changed');
  full.msg({ t: 'patch', p: pt2 });
  part.msg({ t: 'patch', p: Object.assign({}, pt2, { serumT: { key: T.key, parts: { lfo0: T.parts.lfo0 } } }) });
  const pt2m = Object.assign({}, pt2); delete pt2m.serumT;
  msg.msg({ t: 'patch', p: pt2m });
  msg.msg({ t: 'ct', key: T.key, parts: { lfo0: T.parts.lfo0 } });
  for (const p of [full, part, msg]) p.msg({ t: 'on', n: 60, v: 0.8 });
  const [a, b, c] = run(S, [full, part, msg], 9600);
  assert.ok(peak(a.L) > 0.02);
  assert.equal(maxDiff(a.L, b.L), 0, 'patch with one part');
  assert.equal(maxDiff(a.L, c.L), 0, '{t: "ct"} message');
  assert.equal(full.sx.CT.key, T.key); assert.equal(msg.sx.CT.key, T.key);
});

test('§12.4: smp / smpdel messages and processorOptions.smps reach SxBase; mpe messages reach proc.mpe', () => {
  const S = scope(), SB = S.SB;
  const mkE = id => S.D.run('(function (id) { const L = new Float32Array(64); for (let i = 0; i < 64; i++) L[i] = Math.sin(i / 3);'
    + ' return { id, v: 1, kind: "smp", bytes: 256, rate: 48000, ch: 1, len: 64, root: 60, loop: null, peak: 1, levels: [{ len: 64, L, R: null }] }; })', 'smp-entry.js')(id);
  const p = S.mk({ os: 2, smps: [mkE('user:a')] });
  assert.ok(SB.getAsset('user:a'), 'processorOptions.smps stored');
  p.msg(Object.assign({ t: 'smp' }, mkE('user:b')));
  assert.ok(SB.getAsset('user:b'), '{t: "smp"} stored');
  p.msg({ t: 'smpdel', id: 'user:b' });
  assert.equal(SB.getAsset('user:b'), null, '{t: "smpdel"} dropped');
  // RULINGS2 F1: every store / drop (any kind) is announced to every processor's rack (FXRack.assets())
  const q = S.mk({ os: 2 }), calls = [];
  for (const x of [p, q]) if (x.rack) { const f = x.rack.assets; x.rack.assets = function () { calls.push(x === p ? 'p' : 'q'); return f.call(this); }; }
  p.msg(Object.assign({ t: 'smp' }, mkE('user:c')));
  q.msg({ t: 'smpdel', id: 'user:c' });
  assert.deepEqual(calls.sort(), ['p', 'p', 'q', 'q'], 'both racks, for the store and the drop');
  p.msg({ t: 'mpe', ch: 3, k: 'x', v: -0.5 }); p.msg({ t: 'mpe', ch: 3, k: 'b', v: 0.25 }); p.msg({ t: 'mpe', ch: 17, k: 'y', v: 1 });
  assert.equal(p.mpe[3 * 4 + 3], -0.5); assert.equal(p.mpe[3 * 4], 0.25);
  assert.equal(p.mpe.reduce((x, y) => x + Math.abs(y), 0), 0.75, 'channel 17 ignored');
});

test('§12.7: patchFor — Serum compiles its FX rows against the track rack (CP.fxKey = FXP key), FXP v2 for every model', () => {
  const fx = fxWith(f => { f.p['fx.fil.on'] = 1; });
  const s = sState(st => { st.matrix[0] = row('env1', 'fx.fil.cutoff', 0.5); st.matrix[1] = row('lfo1', 'g.master', 0.2); });
  const p = patchFor('serum', { s }, fx, { bpm: 100, prefs: { smooth: 2, silenceTails: 0 } });
  assert.equal(p.serum.ver, 2); assert.equal(p.fxr.ver, 2);
  assert.equal(p.serum.fxKey, p.fxr.key, 'one layout');
  assert.equal(p.serum.NFX, p.fxr.NFX);
  const dsts = [...p.serum.mDst.slice(0, p.serum.mN)];
  assert.ok(dsts.includes(-1 - 0), 'g.master row → FX-context 0');
  assert.ok(dsts.some(d => d <= -9), 'fx.fil.cutoff row → an FX parameter');
  assert.equal(p.bpm, 100); assert.equal(p.fxr.bpm, 100); assert.equal(p.fxr.smooth, 2); assert.equal(p.fxr.silence, 0);
  assert.equal(p.fxr.base[0], s.p['g.master']);
  assert.equal(patchFor('serum', { s }, fx, { qr: { uniMax: 4 } }).serum.qr[0], 4, 'the unison cap travels as CP.qr[0] (§14.3)');
  // without the FX state the instrument has no FX layout: its FX parameter rows are inactive (§4.1)
  const bare = SERUM.map({}, { s }, { bpm: 120, smooth: 1 }).serum;
  assert.equal(bare.fxKey, '');
  assert.ok(![...bare.mDst.slice(0, bare.mN)].some(d => d <= -9));
  for (const m of MODELS) {
    if (m.custom) continue;
    const q = plainPatch(m.id);
    assert.equal(q.fxr.ver, 2, m.id);
    assert.equal(q.fxr.base[0], 1, m.id + ': master 1'); assert.equal(q.fxr.base[1], 0, m.id + ': not bypassed');
  }
});

/* ------------------------------------------------------------------ M2: engine integration v2 (SPEC-serum2 §12) */
// a Serum 2 state (S2 mode) with edits, normalised
function vState(edit) { const s = core.defaultSerum(); if (edit) edit(s); return core.normalizeSerum(s); }
// logs every allocator call of a processor: [frame, on, note, vel, ch, gen]
function tapNotes(p, log) {
  const o = p.sxNote.bind(p);
  p.sxNote = (on, n, v, ch, x, y, z, gen) => { log.push([p.spanF, on, n, v, ch, gen]); return o(on, n, v, ch, x, y, z, gen); };
  return log;
}
const mmPatch = () => plainPatch('minimoog');

test('§12.3/§12.5: the arpeggiator plays through the allocator at its exact frames (span splitting) — ≡ the same notes at those frames', () => {
  const S = scope(), A = S.mk({ os: 2, offline: true });
  sendSx(A, vState(st => { st.p['arp.on'] = 1; }));
  assert.equal(A.sqOn, 1, 'sequencer active');
  const log = tapNotes(A, []);
  A.msg({ t: 'song', notes: [0, 2400, 60, 100, 0, 2400, 64, 90, 0, 2400, 67, 80], cc: [] });
  A.msg({ t: 'transport', play: true, frame: 0, tick: 0, fpt: 25, loop: false });
  const [oa] = run(S, [A], 72000);
  const gen = log.filter(e => e[5] === 1);
  // Up 1/16 at 120 BPM: a step every 6000 frames, gate 75 % → note-offs 4500 frames later (§15.4)
  assert.deepEqual(gen.slice(0, 6).map(e => [e[0], e[1], e[2]]), [[0, 1, 60], [4500, 0, 60], [6000, 1, 64], [10500, 0, 64], [12000, 1, 67], [16500, 0, 67]]);
  assert.equal(log.filter(e => e[5] === 0).length, 0, 'the held chord feeds the arp only');
  // the same notes given to a processor without a sequencer at the same frames (its event ring: integer frames)
  const S2 = scope(), B = S2.mk({ os: 2, offline: true });
  sendSx(B, vState());
  assert.equal(B.sqOn, 0);
  for (const e of gen) B.extNote(e[0], e[1], e[2], e[3]);
  B.msg({ t: 'transport', play: true, frame: 0, tick: 0, fpt: 25, loop: false });
  const [ob] = run(S2, [B], 72000);
  assert.ok(peak(oa.L) > 0.05);
  assert.equal(maxDiff(oa.L, ob.L) + maxDiff(oa.R, ob.R), 0, 'bit-identical');
});

test('§7.9/§12.2: MIDI OUT through PROCS — an arp\'s notes reach the target track exactly 128 frames later, either processing order, live and offline', () => {
  for (const offline of [false, true]) {
    for (const order of [0, 1]) {
      const S = scope(), src = S.mk({ os: 2, trackId: 'src', offline }), tgt = S.mk({ os: 2, trackId: 'tgt', offline, patch: mmPatch() });
      sendSx(src, vState(st => { st.p['arp.on'] = 1; st.arp.midiOut = 2; st.arp.outTrack = 'tgt'; }));
      assert.equal(src.procs, S.PROCS, 'the registry reaches the sequencer as proc.procs');
      const sl = tapNotes(src, []), tl = [];
      const on = tgt.noteOn.bind(tgt);
      tgt.noteOn = (n, v, ch, ext) => { tl.push([tgt.spanF, n, ext]); return on(n, v, ch, ext); };
      run(S, order ? [tgt, src] : [src, tgt], 30080, f => { if (f === 1280) { src.msg({ t: 'on', n: 60, v: 0.8 }); src.msg({ t: 'on', n: 67, v: 0.8 }); } });
      const so = sl.filter(e => e[1] === 1 && e[5] === 1);
      assert.ok(so.length >= 4, 'the arp ran');
      assert.deepEqual(tl.map(e => [e[0], e[1]]), so.map(e => [e[0] + 128, e[2]]), (offline ? 'offline' : 'live') + ', order ' + order);
      assert.ok(tl.every(e => e[2] === 1), 'delivered as MIDI OUT input (never forwarded again)');
    }
  }
});

test('§7.9/§12.6: bye ends a processor — a deleted MIDI OUT source stops feeding its target, process() returns false after the fade; unregistered nodes have no registry', () => {
  const S = scope({ console: quietConsole });
  const arpOut = vState(st => { st.p['arp.on'] = 1; st.arp.midiOut = 2; st.arp.outTrack = 'tgt'; });
  const song = { t: 'song', notes: [0, 9600, 60, 100, 0, 9600, 67, 100], cc: [] }, tp = { t: 'transport', play: true, frame: 0, tick: 0, fpt: 25, loop: false };
  const src = S.mk({ os: 2, trackId: 'src' }), pv = S.mk({ os: 2 }), tgt = S.mk({ os: 2, trackId: 'tgt', patch: mmPatch() });
  assert.equal(pv.procs, null, 'a node without a track id (preview, render farm) has no registry');
  for (const p of [src, pv]) { sendSx(p, arpOut); p.msg(song); }
  for (const p of [src, pv, tgt]) p.msg(tp);
  const got = [];
  const on = tgt.noteOn.bind(tgt);
  tgt.noteOn = (n, v, ch, ext) => { got.push(ext ? 'ext' : 'in'); return on(n, v, ch, ext); };
  const step = (k, list) => { const L = new Float32Array(128), R = new Float32Array(128), r = []; for (let i = 0; i < k; i++) { for (const p of list) r.push(p.process([], [[L, R]])); S.ctx.currentFrame += 128; } return r; };
  step(375, [src, pv, tgt]);
  const live = got.length;
  assert.ok(live >= 4, 'the source arp plays the target');
  // the preview copy (pv) forwarded nothing: every target note came from the registered source
  // main.js deleting the source track (syncNodes): panic + bye, then disconnect
  src.msg({ t: 'panic' }); src.msg({ t: 'bye' });
  assert.equal(S.PROCS.has('src'), false); assert.equal(src.procs, null);
  got.length = 0;
  const ret = [];
  const L = new Float32Array(128), R = new Float32Array(128);
  for (let i = 0; i < 375 * 3; i++) { ret.push(src.process([], [[L, R]])); pv.process([], [[L, R]]); tgt.process([], [[L, R]]); S.ctx.currentFrame += 128; }
  assert.equal(got.length, 0, 'no note reaches the target after bye');
  const k = ret.indexOf(false);
  assert.ok(k >= 0 && k <= 4, 'process() returns false within a few quanta (the 5 ms fade): ' + k);
  assert.equal(src.tp.play, false, 'its song transport stopped');
  src.msg({ t: 'on', n: 60, v: 1 }); src.msg({ t: 'transport', play: true, frame: S.ctx.currentFrame, tick: 0, fpt: 25 });
  assert.equal(src.process([], [[L, R]]), false); assert.equal(peak(L), 0, 'later messages are ignored');
  // a bye without a preceding panic fades out the same way
  const q = S.mk({ os: 2, trackId: 'q' });
  sendSx(q, vState()); q.msg({ t: 'on', n: 60, v: 0.8 });
  run(S, [q], 2560);
  q.msg({ t: 'bye' });
  const r2 = []; for (let i = 0; i < 8; i++) r2.push(q.process([], [[L, R]]));
  assert.ok(r2.includes(false) && r2.indexOf(false) <= 4);
});

test('§12.3/§6.17: mono ↔ poly while keys are held re-strikes the allocator\'s notes (keyboard transpose, MPE channel) and the keys still release them; mono returns to a held note with its own channel', () => {
  const S = scope({ console: quietConsole });
  const gated = p => [...p.voices].filter(v => v.gate).map(v => v.note + '/' + v.ch); // (this realm's arrays)
  // keyboard transpose +12 (sequencer active): key 60 sounds 72 in both modes and its release ends it
  const tr = mono => vState(s => { s.kbd.trans = 12; s.voicing.mono = mono; });
  for (const [a, b] of [[0, 1], [1, 0]]) {
    const p = S.mk({ os: 2 });
    sendSx(p, tr(a)); run(S, [p], 512);
    p.msg({ t: 'on', n: 60, v: 0.8 }); run(S, [p], 2560);
    assert.deepEqual(gated(p), ['72/0']);
    sendSx(p, tr(b)); run(S, [p], 2560);
    assert.deepEqual(gated(p), ['72/0'], `${a} → ${b}: re-struck once, not transposed again`);
    assert.equal(p.sxSeq.heldN, 1, 'the sequencer still holds one key');
    p.msg({ t: 'off', n: 60 });
    const [o] = run(S, [p], 48000 * 2);
    assert.deepEqual(gated(p), []); assert.equal(p.sxSeq.heldN, 0);
    assert.ok(peak(o.L.subarray(48000)) < 1e-4, 'released');
  }
  // MPE: a channelled note keeps its channel through mono → poly → mono; the channel's note-off releases it
  const mp = mono => vState(s => { s.voicing.mono = mono; s.global.mpe.on = 1; });
  const p = S.mk({ os: 2 });
  sendSx(p, mp(1)); run(S, [p], 512);
  p.msg({ t: 'on', n: 64, v: 0.8, ch: 3 }); run(S, [p], 1280);
  sendSx(p, mp(0)); run(S, [p], 1280);
  assert.deepEqual(gated(p), ['64/3']);
  sendSx(p, mp(1)); run(S, [p], 1280);
  assert.deepEqual(gated(p), ['64/3']);
  p.msg({ t: 'off', n: 64, ch: 3 });
  run(S, [p], 48000 * 2);
  assert.deepEqual(gated(p), [], 'the ch-3 note-off released it');
  // mono MPE: 60/ch 2 held, 64/ch 3 pressed and released → the voice returns to 60 with channel 2
  sendSx(p, mp(1));
  p.msg({ t: 'on', n: 60, v: 0.8, ch: 2 }); run(S, [p], 1280);
  p.msg({ t: 'on', n: 64, v: 0.8, ch: 3 }); run(S, [p], 1280);
  assert.deepEqual([p.voices[0].note, p.voices[0].ch], [64, 3]);
  p.msg({ t: 'off', n: 64, ch: 3 }); run(S, [p], 1280);
  assert.deepEqual([p.voices[0].note, p.voices[0].ch, p.voices[0].gate], [60, 2, true], 'its own channel, not the released one');
  p.msg({ t: 'off', n: 60, ch: 3 }); run(S, [p], 256);
  assert.equal(p.voices[0].gate, true, 'a note-off of another channel does not release it');
  p.msg({ t: 'off', n: 60, ch: 2 }); run(S, [p], 256);
  assert.equal(p.voices[0].gate, false);
});

test('§7.7/§12.4: seqcmd launches a clip; sqt parts merge; CC64 latches the arp instead of holding voices', () => {
  const S = scope(), p = S.mk({ os: 2 });
  const clipState = notes => vState(st => { st.p['clip.on'] = 1; st.clip.clips[0].notes = notes; st.clip.clips[0].len = 16; });
  const s1 = clipState([[0, 2, 60, 100, 0, 0.5, 0.5, 0]]);
  sendSx(p, s1);
  const log = tapNotes(p, []);
  run(S, [p], 12800);
  assert.equal(log.length, 0, 'nothing plays before the launch');
  p.msg({ t: 'seqcmd', cmd: 'clipLaunch', arg: 0 });
  run(S, [p], 48000);
  assert.ok(log.some(e => e[1] === 1 && e[2] === 60 && e[5] === 1), 'the launched clip plays its note');
  // a clip-note edit delivered as a seqT part equals the full patch
  const s2 = clipState([[0, 2, 64, 100, 0, 0.5, 0.5, 0]]), P1 = sxPatch(s1), P2 = sxPatch(s2);
  const parts = Object.fromEntries(Object.keys(P2.seqT.parts).filter(k => P2.seqT.parts[k].key !== P1.seqT.parts[k].key).map(k => [k, P2.seqT.parts[k]]));
  assert.deepEqual(Object.keys(parts), ['clip0']);
  p.msg({ t: 'sqt', parts });
  const q = S.mk({ os: 2 });
  sendSx(q, s2);
  assert.deepEqual(plain(p.sxSeq.clipNotes.subarray(0, 8)), plain(q.sxSeq.clipNotes.subarray(0, 8)));
  // CC64 with the arp on: the arpeggiator latches; the voices are not sustained (§7.4.5, §12.3)
  const a = S.mk({ os: 2 });
  sendSx(a, vState(st => { st.p['arp.on'] = 1; }));
  const al = tapNotes(a, []);
  run(S, [a], 1280);
  a.msg({ t: 'sus', v: true });
  a.msg({ t: 'on', n: 60, v: 0.8 }); a.msg({ t: 'on', n: 64, v: 0.8 });
  run(S, [a], 6400);
  a.msg({ t: 'off', n: 60 }); a.msg({ t: 'off', n: 64 });
  assert.equal(a.sustain, false, 'no voice sustain');
  assert.equal(a.sxSeq.latch, 1, 'latched');
  const n0 = al.filter(e => e[1] === 1).length;
  run(S, [a], 24000);
  assert.ok(al.filter(e => e[1] === 1).length > n0 + 2, 'the latched arp keeps playing after the keys are released');
  a.msg({ t: 'sus', v: false });
  assert.equal(a.sxSeq.latch, 0);
  run(S, [a], 12800);
  const n1 = al.filter(e => e[1] === 1).length;
  run(S, [a], 24000);
  assert.equal(al.filter(e => e[1] === 1).length, n1, 'pedal up: the latched notes stop');
});

test('§12.3: MPE notes carry their channel; a note-off releases only the voice of its channel', () => {
  const S = scope(), p = S.mk({ os: 2 });
  sendSx(p, vState(st => { st.global.mpe.on = 1; }));
  p.msg({ t: 'on', n: 60, v: 0.8, ch: 2 }); p.msg({ t: 'on', n: 60, v: 0.8, ch: 3 });
  run(S, [p], 1280);
  const gated = () => [...p.voices].filter(v => v.gate).map(v => v.ch).sort(); // (this realm's arrays)
  assert.deepEqual(gated(), [2, 3]);
  p.msg({ t: 'mpe', ch: 3, k: 'b', v: 0.5 });
  p.msg({ t: 'off', n: 60, ch: 2 });
  run(S, [p], 1280);
  assert.deepEqual(gated(), [3]);
  assert.equal(p.mpe[3 * 4], 0.5);
});

test('§12.5: the bus pairs are rendered, decimated and handed to the rack only while CP.outMask uses them', () => {
  const S = scope(), calls = [];
  const p = S.mk({ os: 2 });
  const proc = p.rack.process.bind(p.rack);
  p.rack.process = (...a) => { calls.push(a.length > 5 && a[5] !== undefined ? 'bus' : 'main'); return proc(...a); };
  sendSx(p, vState());
  assert.equal(p.sxMask & 12, 0); assert.equal(p.decB1L, null, 'no bus decimators without bus use');
  p.msg({ t: 'on', n: 60, v: 0.8 });
  const [o0] = run(S, [p], 2560);
  assert.ok(calls.length > 0 && calls.every(c => c === 'main'));
  const s2 = vState(st => { st.p['a.bus1'] = 1; });
  const pt = sxPatch(s2);
  assert.ok(pt.serum.outMask & 4, 'outMask bit 4 (bus 1)');
  p.msg({ t: 'patch', p: pt });
  assert.ok(Array.isArray(p.decB1L) && p.decB1L.length > 0, 'built on the patch that needs them');
  assert.equal(p.decB2L, null, 'bus 2 unused');
  calls.length = 0;
  const [o1] = run(S, [p], 2560);
  assert.ok(calls.length > 0 && calls.every(c => c === 'bus'), 'the rack gets the bus pair');
  assert.ok(o1.L.every(Number.isFinite) && peak(o1.L) > 0 && peak(o0.L) > 0);
  // the last send switched off while the note sounds: the pair is released (the sends glide to 0, then it drains), not cut
  p.msg({ t: 'patch', p: sxPatch(vState()) });
  assert.equal(p.sxMask & 4, 4, 'released, still rendered');
  calls.length = 0;
  run(S, [p], 48000);
  assert.equal(p.sxMask & 12, 0, 'dropped within 1 s');
  assert.equal(calls[0], 'bus');
  const k = calls.indexOf('main');
  assert.ok(k > 0 && calls.slice(k).every(c => c === 'main'), 'back to the main pair only');
});

test('§6.20: snapshot mix meters 7–10 come from FXRack.mixPeaks when the rack has it (buses after their FX and faders, Main without Direct), else from the engine\'s taps', () => {
  const S = scope({ console: quietConsole });
  const st = vState(s => { s.p['a.bus1'] = 1; s.osc[0].wt = 'factory:Sine'; });
  const meters = p => p.port.sent.filter(m => m.t === 'smon' && m.s).pop().s.mix;
  const p = S.mk({ os: 2 });
  sendSx(p, st); p.msg({ t: 'smon', on: true }); p.msg({ t: 'on', n: 57, v: 0.9 });
  run(S, [p], 9600);
  const m0 = meters(p);
  assert.ok(m0[7] > -40 && m0[9] > -40, 'fallback taps: bus 1 input and the output');
  // a rack reporting its own peaks: the engine passes them through untouched
  const q = S.mk({ os: 2 }), calls = [];
  q.rack.mixPeaks = pk => { calls.push(1); pk[0] = Math.max(pk[0], 0.5); pk[1] = Math.max(pk[1], 0); pk[2] = Math.max(pk[2], 0.25); pk[3] = Math.max(pk[3], 0.125); };
  sendSx(q, st); q.msg({ t: 'smon', on: true }); q.msg({ t: 'on', n: 57, v: 0.9 });
  run(S, [q], 9600);
  const m1 = meters(q);
  assert.ok(calls.length > 0);
  assert.deepEqual([...m1.subarray(7, 11)].map(x => Math.round(x * 10) / 10), [-6, -120, -12, -18.1]);
});

test('§12.5/§14.1: switching the last bus send off while a note sounds is click-free; with no voice sounding the pair goes at once', () => {
  const S = scope({ console: quietConsole });
  const st = v => vState(s => { s.osc[0].wt = 'factory:Sine'; s.p['a.bus1'] = v; });
  for (const to of [0, 0.02]) {
    const p = S.mk({ os: 2 });
    sendSx(p, st(1)); run(S, [p], 512);
    p.msg({ t: 'on', n: 45, v: 0.9 });
    const [a] = run(S, [p], 24000);
    sendSx(p, st(to));
    const [b] = run(S, [p], 9600);
    const ss = maxStep(a.L, a.L.length - 4800, a.L.length), all = new Float32Array(a.L.length + b.L.length);
    all.set(a.L); all.set(b.L, a.L.length);
    const tr = maxStep(all, a.L.length - 1, all.length);
    assert.ok(tr <= 1.2 * ss, `send 1 → ${to}: max step ${tr.toFixed(4)} vs steady ${ss.toFixed(4)}`);
    assert.ok(peak(b.L.subarray(4800)) > 0.1, 'the main signal continues');
    if (to === 0) assert.equal(p.sxMask & 4, 0, 'the released pair was dropped');
  }
  const p = S.mk({ os: 2 });
  sendSx(p, st(1));
  sendSx(p, st(0));
  assert.equal(p.sxMask & 12, 0, 'nothing sounding: no release');
});

test('§0.3/§7.1: without SxSeq the engine applies the keyboard transpose itself; a model switch clears the sequencer', () => {
  // transpose without SxSeq ≡ the transposed note on a patch without transpose
  const S = scope({ overrides: { 'sx-seq.js': null } }), a = S.mk({ os: 2 }), b = S.mk({ os: 2 });
  sendSx(a, vState(st => { st.kbd.trans = 12; })); sendSx(b, vState());
  assert.equal(a.sxSeq, null); assert.equal(a.sqTr, 12);
  a.msg({ t: 'on', n: 60, v: 0.8 }); b.msg({ t: 'on', n: 72, v: 0.8 });
  const [oa, ob] = run(S, [a, b], 4864, o => { if (o === 2560) { a.msg({ t: 'off', n: 60 }); b.msg({ t: 'off', n: 72 }); } });
  assert.ok(peak(oa.L) > 0.05);
  assert.equal(maxDiff(oa.L, ob.L) + maxDiff(oa.R, ob.R), 0);
  assert.ok(!a.voices.some(v => v.gate), 'the note-off released the transposed note');
  // model switch Serum → Minimoog → Serum: the sequencer stops, then works again
  const T = scope(), p = T.mk({ os: 2 }), log = tapNotes(p, []);
  sendSx(p, vState(st => { st.p['arp.on'] = 1; }));
  p.msg({ t: 'on', n: 60, v: 0.8 });
  run(T, [p], 12800);
  assert.ok(log.length > 0);
  p.msg({ t: 'patch', p: mmPatch() });
  assert.equal(p.sqOn, 0); assert.ok([...p.seqMacro].every(Number.isNaN));
  const n = log.length;
  run(T, [p], 24000);
  assert.equal(log.length, n, 'no sequencer events after the switch');
  sendSx(p, vState(st => { st.p['arp.on'] = 1; }));
  assert.equal(p.sqOn, 1);
});

test('§0.3 failure isolation: each optional script replaced by a throwing copy degrades only its feature', () => {
  const throwing = src => src.replace(/try \{/, "try { throw new Error('injected load failure');");
  const silentSerum = new Set(['sx-base.js', 'sx-mod.js', 'serum-dsp.js']);
  for (const f of DSP_FILES) {
    const S = scope({ overrides: { [f]: throwing }, console: quietConsole });
    assert.equal(S.D.global(DSP_TABLE.find(e => e[0] === f)[1]), null, f + ': its global is null');
    const mm = S.mk({ os: 2, patch: mmPatch() }), sx = S.mk({ os: 2 });
    sendSx(sx, vState());
    mm.msg({ t: 'on', n: 60, v: 0.8 }); sx.msg({ t: 'on', n: 60, v: 0.8 });
    const [om, os] = run(S, [mm, sx], 4864);
    assert.ok(peak(om.L) > 0.01 && om.L.every(Number.isFinite), f + ': the classic model plays');
    if (silentSerum.has(f)) assert.equal(peak(os.L), 0, f + ': Serum tracks silent');
    else assert.ok(peak(os.L) > 0.01, f + ': the default Serum patch still plays');
  }
});

test('§15.13 bounce equivalence (§10.7f) with arp + clip + granular + Convolve: offline from tick T ≡ live after 1 s of pre-roll (−80 dB)', async () => {
  const { playbackEntry, irEntry } = await import('../smpwork.js?v=7');
  const { convShapeOf } = await import('../assets.js?v=7');
  const sr = 48000, bpm = 120, fpt = sr * 60 / (bpm * 960), T0 = 3840, n = sr;
  const tone = (hz, ph) => Float32Array.from({ length: n }, (_, j) => 0.4 * Math.sin(2 * Math.PI * hz * j / sr + ph) + 0.15 * Math.sin(2 * Math.PI * 2.7 * hz * j / sr));
  const smpE = () => playbackEntry('smp:eqv', { rate: sr, ch: 2, len: n, L: tone(220, 0), R: tone(220, 1), root: 57, loop: null }, null);
  const r = W.mulberry32(W.fnv1a32('eqv-ir'));
  const irL = new Float32Array(sr / 2), irR = new Float32Array(sr / 2);
  for (let i = 0; i < irL.length; i++) { const e = Math.exp(-i / 4800); irL[i] = (2 * r() - 1) * e; irR[i] = (2 * r() - 1) * e; }
  const fx = core.defaultFx2(), cid = core.newInstance(fx, 'conv', { rack: 0 });
  const conv = fx.racks[0].mods.find(I => I.id === cid);
  conv.sub = { ir: 'ir:eqv' }; conv.p.mix = 0.4;
  const s = vState(st => {
    st.p['arp.on'] = 1; st.p['clip.on'] = 1; st.clip.trigOct = 1; st.clip.clips[0].kb = 0;
    st.clip.clips[0].notes = [[0, 2, 72, 100, 0, 0.5, 0.5, 0], [4, 2, 76, 90, 0, 0.5, 0.5, 0]]; st.clip.clips[0].len = 16;
    st.osc[1].type = 'gran'; st.osc[1].smp = 'smp:eqv'; st.p['b.on'] = 1; st.p['b.dens'] = 0.6; st.p['b.glen'] = 0.5;
    st.p['a.rand'] = 0; st.p['b.rand'] = 0;
  });
  const pt = () => patchFor('serum', { s }, fx, { sr, bpm, prefs: { smooth: 1, silenceTails: 1 } });
  const P0 = pt(), irId = P0.needs.find(id => /^ir:eqv@/.test(id));
  assert.ok(irId && P0.needs.includes('smp:eqv'), 'needs: the sample and the shaped IR');
  const irE = () => irEntry(irId, { rate: sr, ch: 2, len: irL.length, L: irL, R: irR, hash: 'eqv' }, sr, convShapeOf(conv.p));
  const song = { notes: [3840, 960, 0, 100, 3840, 3840, 60, 100, 4800, 2880, 64, 90, 5760, 1920, 67, 110, 7680, 960, 60, 120], cc: [] };
  const end = 9600, dur = Math.ceil((end - T0) * fpt / 128) * 128 + 24064;
  const wts = P0.needs.filter(id => !/^(smp|ir):/.test(id)).map(entryOf);
  // offline (bounce): processorOptions (patch, wavetables, §9 assets), transport from T0 at frame 0
  const A = scope({ sr });
  const pa = A.mk({ os: 2, offline: true, patch: pt(), wts, smps: [smpE(), irE()], song, transport: { play: true, frame: 0, tick: T0, fpt, loop: false, end } });
  const gl = tapNotes(pa, []);
  const off = run(A, [pa], dur)[0];
  assert.ok(gl.some(e => e[5] === 1 && e[1] === 1 && (e[2] === 72 || e[2] === 76)), 'the clip (launched by its trigger octave) feeds the arp');
  // live: messages ({t: 'smp'} after the patch), 1 s of pre-roll, then play with seek at T0
  const B = scope({ sr }), pb = B.mk({ os: 2 });
  pb.msg({ t: 'patch', p: pt() });
  for (const e of wts) pb.msg(Object.assign({ t: 'wt' }, e));
  pb.msg(Object.assign({ t: 'smp' }, smpE())); pb.msg(Object.assign({ t: 'smp' }, irE()));
  pb.msg(Object.assign({ t: 'song' }, song));
  run(B, [pb], sr);
  pb.msg({ t: 'transport', play: true, seek: true, frame: sr, tick: T0, fpt, loop: false, end });
  const live = run(B, [pb], dur)[0];
  const ref = Math.max(peak(off.L), peak(off.R));
  assert.ok(ref > 0.05, 'audible');
  assert.ok(pa.sqOn === 1 && pa.voices.some(v => v.ox && v.ox[1]), 'sequencer and granular oscillator in use');
  const d = Math.max(maxDiff(off.L, live.L), maxDiff(off.R, live.R));
  if (process.env.EQV_DEBUG) console.log('eqv', ref, dB(d / ref), pa.rack.nConv, pa.sxSeq.snapshot ? 1 : 0);
  assert.ok(dB(d / ref) < -80, `difference ${dB(d / ref).toFixed(1)} dB`);
});

test('§0.3/§12.5: the v2 render path allocates nothing — sequencer, MPE notes, direct and bus pairs, MIDI OUT ring', () => {
  const S = scope(), src = S.mk({ os: 2, trackId: 'a' }), tgt = S.mk({ os: 2, trackId: 'b', patch: mmPatch() });
  sendSx(src, vState(st => { st.p['arp.on'] = 1; st.arp.midiOut = 2; st.arp.outTrack = 'b'; st.p['a.bus1'] = 0.7; st.osc[1].route = 2; st.p['b.on'] = 1; st.global.mpe.on = 1; }));
  assert.ok((src.sxMask & 6) === 6, 'direct and bus 1 in use');
  src.msg({ t: 'on', n: 60, v: 0.8, ch: 2 }); src.msg({ t: 'on', n: 64, v: 0.7, ch: 3 }); src.msg({ t: 'mpe', ch: 2, k: 'b', v: 0.2 });
  run(S, [src, tgt], 48000);                                           // first calls (inline caches, lazy pools)
  const L = new Float32Array(128), R = new Float32Array(128);
  noAlloc(S.D, () => {
    for (let k = 0; k < 375; k++) { src.process([], [[L, R]]); tgt.process([], [[L, R]]); S.ctx.currentFrame += 128; }
  });
  assert.ok(tgt.voices.some(v => v.active), 'MIDI OUT reached the target');
});
