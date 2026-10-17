// Serum 2 factory presets (M3; SPEC-serum2 §10.11, §14.1, §15.13; content owner): every FACTORY_PRESETS_V2 entry is
// rendered by engine.js in a node:vm worklet scope (tests/dsp-scope.mjs, the §0.3 script list then engine.js) with its
// assets — procedural factory samples and impulse responses from smpgen, multisamples from the render farm (smprender.js
// in a vm "worker") — built by the asset manager exactly as a bounce builds them (assets.js entries(ids, rate, {s, fx})).
//  1. coverage: the presets showcase every Serum 2 feature §10.11 asks for (oscillator types, each factory multisample,
//     each granular window, each spectral warp, each FM type, dual warps, Filter 2 series / parallel, every new filter
//     type, buses with FX, every new FX module and reverb type, arp patterns, clip banks with macro lanes, MPE rows, Voice
//     Control, an embedded .scl tuning, the new wavetables, categories incl. Texture and Sequence);
//  2. levels: the category phrase at velocity 0.8 and 2x oversampling peaks between −9 and −3 dBFS (read before the
//     output stage's DC blocker / limiter), finite, no subnormals, no DC, tails decay; note 60 alone is audible
//     (−40 … 0 dBFS, the §15.13 rule for the presets with assets);
//  3. CPU: the busiest second of each phrase stays within the preset budget (node load ≤ 0.5 at the reference machine,
//     gate 1.5 × the target, calibrated against row (b) as every §14.1 gate — tests/cpu-gate.mjs — with retries).
// The migrated Phase-1 presets are tested by tests/presets.test.mjs. Run:
//   node --test tests/presets2.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as core from '../serum-core.js?v=8';
import * as W from '../wt.js?v=8';
import * as gen from '../smpgen.js?v=8';
import { patchFor } from '../models.js?v=8';
import { dspScope } from './dsp-scope.mjs';
import * as A from '../assets.js?v=8';
import * as wtstore from '../wtstore.js?v=8';
import * as smpstore from '../smpstore.js?v=8';
import { T_REF_CALIB, calibRowB } from './cpu-gate.mjs';

const ROOT = new URL('../', import.meta.url);
const V = '?v=8', SR = 48000, BPM = 120;
const P2 = core.FACTORY_PRESETS_V2;

/* ------------------------------------------------------------------ harness */
// the render farm as the asset manager's 'render' worker (smprender.js in a vm context, fast intrinsics)
function farmWorker() {
  const g = vm.constants && vm.constants.DONT_CONTEXTIFY !== undefined ? vm.createContext(vm.constants.DONT_CONTEXTIFY) : vm.createContext({});
  Object.assign(g, { console: { log() {}, info() {}, debug() {}, warn() {}, error() {} }, location: { search: V } });
  g.self = g;
  g.importScripts = (...urls) => { for (const u of urls) { const f = u.slice(0, -V.length); vm.runInContext(readFileSync(new URL(f, ROOT), 'utf8'), g, { filename: 'farm/' + f }); } };
  const w = { onmessage: null, onerror: null, terminate() {} };
  g.postMessage = m => setImmediate(() => w.onmessage && w.onmessage({ data: m }));
  vm.runInContext(readFileSync(new URL('smprender.js', ROOT), 'utf8'), g, { filename: 'smprender.js' });
  w.postMessage = m => setImmediate(() => g.onmessage({ data: m }));
  return w;
}
const AM = A.createAssetManager({ ctxOf: () => null, post: () => false, tracks: () => [], worker: k => (k === 'render' ? farmWorker() : null),
  stores: { wt: () => wtstore.memoryStore(), smp: () => smpstore.memoryStore() }, wt: () => Promise.resolve(W), persist: () => Promise.resolve(true) });
const isWt = id => id.startsWith('noise:') || !!W.factoryTable(id);
const ENT = new Map();
const entryOf = id => { if (!ENT.has(id)) ENT.set(id, id.startsWith('noise:') ? W.makeNoise(id) : W.makeEntry(id, W.factoryTable(id))); return ENT.get(id); };
const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
const S = dspScope({ sampleRate: SR, engine: true, fast: true, console: quiet });

// a preset loaded as the app loads it, its patch (main.js buildPatch = patchFor + live fields) and its assets
async function load(pr) {
  const s = core.applyPreset(core.defaultSerum(), pr), fx = core.applyPresetFx(core.defaultFx(), pr.fx, s);
  const pt = patchFor('serum', { s }, fx, { sr: SR, bpm: BPM, seed: true }), ids = (pt.needs || []).filter(id => !isWt(id));
  const smps = ids.length ? await AM.entries(ids, SR, { s, fx }) : [];
  return { s, fx, pt, ids, smps };
}
// events [t (s), on, note] at velocity 0.8; returns the output, the pre-limiter signal and the CPU time of every second
function render(L0, ev, secs) {
  const p = new S.Proc({ processorOptions: { os: 2 } });
  for (const id of L0.pt.needs || []) if (isWt(id)) p.msg(Object.assign({ t: 'wt' }, entryOf(id)));
  for (const e of L0.smps) p.msg(Object.assign({ t: 'smp' }, e));
  p.msg({ t: 'patch', p: L0.pt });
  const n = Math.ceil(secs * SR / 128) * 128, L = new Float32Array(n), R = new Float32Array(n), PL = new Float64Array(n), PR = new Float64Array(n);
  const a = new Float32Array(128), b = new Float32Array(128), out = p.outStage, sec = [];
  let at = 0, k = 0, t0 = performance.now();
  p.outStage = function (Lo, Ro, off, m) { PL.set(this.Lb.subarray(0, m), at + off); PR.set(this.Rb.subarray(0, m), at + off); return out.call(this, Lo, Ro, off, m); };
  ev = ev.slice().sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  for (let o = 0; o < n; o += 128) {
    while (k < ev.length && ev[k][0] * SR <= o) { const e = ev[k++]; p.msg(e[1] ? { t: 'on', n: e[2], v: 0.8 } : { t: 'off', n: e[2] }); }
    at = o;
    p.process([], [[a, b]]);
    L.set(a, o); R.set(b, o);
    S.ctx.currentFrame += 128;
    if ((o + 128) % SR === 0) { const t = performance.now(); sec.push(t - t0); t0 = t; }   // ms per second of audio
  }
  return { L, R, PL, PR, sec };
}
const peak = (x, a = 0, b = x.length) => { let m = 0; for (let i = a; i < b; i++) { const v = Math.abs(x[i]); if (v > m) m = v; } return m; };
const rms = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
const dB = x => 20 * Math.log10(Math.max(1e-30, x));
// the typical phrase of each category (tests/presets.test.mjs, + Texture: a held fifth, Sequence: one held key): [events, s]
function phrase(cat, mono) {
  const ev = [], on = (t, n, d) => { ev.push([t, 1, n], [t + d, 0, n]); };
  const B = 60 / BPM;
  switch (cat) {
    case 'Bass':
      if (mono) { on(0, 36, 1); on(1, 36, 0.24); on(1.25, 43, 0.5); on(1.75, 39, 0.3); on(2, 41, 1); on(2.9, 36, 1); return [ev, 5]; }
      on(0, 36, 1); on(1.25, 43, 0.5); on(2, 41, 1); return [ev, 4.5];
    case 'Lead': on(0, 72, 0.95); on(0.9, 67, 0.55); on(1.4, 69, 0.55); on(1.9, 74, 1.6); on(3.6, 72, 1); return [ev, 6.5];
    case 'Pad': for (const n of [48, 55, 60, 64]) on(0, n, 4); return [ev, 8];
    case 'Keys': for (const n of [57, 60, 64, 67]) on(0, n, 1.5); for (const n of [53, 57, 60, 64]) on(2, n, 1.5); return [ev, 5.5];
    case 'Chord': on(0, 60, 1.5); on(2, 65, 1.5); return [ev, 5.5];
    case 'Pluck': { const a = [60, 64, 67, 72, 67, 64, 60, 55]; for (let i = 0; i < 16; i++) on(i * B / 2, a[i % 8], 0.2); return [ev, 6]; }
    case 'Arp': for (const n of [57, 60, 64]) on(0, n, 4); return [ev, 6];
    case 'Seq': on(0, 48, 4); return [ev, 6];
    case 'Drum': for (let i = 0; i < 8; i++) on(i * B, 48, 0.1); return [ev, 5];
    case 'Texture': for (const n of [48, 55]) on(0, n, 5); return [ev, 9];
    case 'Sequence': on(0, 60, 4); return [ev, 6.5];
    default: on(0, 60, 4); return [ev, 7];                                       // FX
  }
}

/* ------------------------------------------------------------------ 1. coverage (§10.11) */
const oscs = pr => pr.v.s.osc.map((O, o) => ({ O, o, k: 'abc'[o], p: pr.v.s.p, on: o === 0 ? pr.v.s.p['a.on'] >= 0.5 : pr.v.s.p['bc'[o - 1] + '.on'] >= 0.5 }));
const warpOf = (p, k, slot) => Math.round(p[k + '.w' + slot] * 81);
const fxMods = fx => fx.racks.flatMap(R => R.mods.flatMap(I => [I].concat(...(I.br || []))));

test('M3 §10.11: at least 30 original Serum 2 presets (s1 = 0) before the 48 migrated Phase-1 presets; frozen, normalised, factory content only', () => {
  assert.ok(P2.length >= 30, P2.length + ' presets');
  assert.deepEqual(core.FACTORY_PRESETS.slice(0, P2.length).map(p => p.name), P2.map(p => p.name));
  assert.equal(core.FACTORY_PRESETS.length, P2.length + 48);
  const v1 = new Set(core.FACTORY_PRESETS_V1.map(p => p.name));
  for (const pr of P2) {
    assert.ok(!v1.has(pr.name) && Object.isFrozen(pr) && Object.isFrozen(pr.v.s.p), pr.name);
    assert.equal(pr.v.s.global.s1, 0, pr.name + ': Serum 2 mode');
    assert.equal(pr.v.s.v, 2);
    assert.deepEqual(core.normalizeSerum(pr.v.s), pr.v.s, pr.name + ' normalised');
    assert.deepEqual(core.normalizeFx(pr.fx, pr.v.s), pr.fx, pr.name + ' fx normalised');
    // every asset a preset references is factory content (generated on demand on a fresh install, §10)
    for (const id of core.assetNeeds(pr.v.s)) assert.ok(gen.byId(id), pr.name + ': ' + id);
    for (const I of fxMods(pr.fx)) if (I.type === 'conv') assert.ok(gen.byId(I.sub.ir), pr.name + ': IR ' + I.sub.ir);
    for (const O of pr.v.s.osc) {
      assert.ok(W.factoryTable(O.wt), pr.name + ': ' + O.wt);
      if (/^factory:/.test(O.smp)) assert.ok(W.factoryTable(O.smp), pr.name + ': ' + O.smp);
    }
    assert.ok(pr.v.s.notes.length > 40 && pr.v.s.author === 'Factory' && pr.v.s.tags.length > 0, pr.name + ': notes, author, tags');
    for (const r of pr.v.s.matrix.filter(r => r.src)) assert.ok(r.dst && r.amt !== 0, pr.name + ': row ' + r.src + ' → ' + r.dst);
    const cp = core.compileSerum(pr.v.s);
    assert.ok(cp.serum.base.every(Number.isFinite), pr.name + ' finite CP');
    assert.ok(pr.v.s.p['g.master'] > 0 && pr.v.s.p['g.master'] <= 1, pr.name + ' master');
  }
});

test('M3 §10.11: the presets cover the Serum 2 features', () => {
  const all = P2.flatMap(pr => oscs(pr).filter(x => x.on).map(x => Object.assign({ pr }, x)));
  // oscillator types; every factory multisample instrument at least once
  assert.deepEqual(new Set(all.map(x => x.O.type)), new Set(core.OSC_TYPES.map(t => t.id)));
  assert.deepEqual(new Set(all.filter(x => x.O.type === 'multi').map(x => x.O.multi)), new Set(gen.FACTORY_MULTI.map(m => m.id)), 'each FACTORY_MULTI instrument');
  // each granular window shape; each spectral warp; each FM type; dual warps; PD / AM / RM / distortion / filter warps
  assert.deepEqual(new Set(all.filter(x => x.O.type === 'gran').map(x => x.O.smpo.win)), new Set(core.GRAIN_WINDOWS.map((w, i) => i)), 'each window');
  const spec = new Set(all.filter(x => x.O.type === 'spec').flatMap(x => [warpOf(x.p, x.k, 1), warpOf(x.p, x.k, 2)]));
  for (let m = 58; m <= 81; m++) assert.ok(spec.has(m), 'spectral warp ' + core.WARPS2[m].id);
  const fm = new Set(all.flatMap(x => [1, 2].filter(sl => warpOf(x.p, x.k, sl) >= 33 && warpOf(x.p, x.k, sl) <= 38).map(sl => x.O.fm[sl - 1])));
  assert.deepEqual(fm, new Set([0, 1, 2]), 'Thru-Zero, Exp and Linear FM');
  const modes = new Set(all.flatMap(x => [warpOf(x.p, x.k, 1), warpOf(x.p, x.k, 2)]));
  assert.ok(all.some(x => warpOf(x.p, x.k, 1) && warpOf(x.p, x.k, 2) && x.O.type === 'wt'), 'dual warps');
  for (const id of ['sync', 'bend_p', 'bend_pn', 'oddeven', 'lpf', 'hpf', 'd_tube', 'd_hard', 'd_sinfold', 'pd_self', 'rm_o1']) assert.ok(modes.has(core.WARPS2.findIndex(w => w.id === id)), 'warp ' + id);
  // pitch modes, wavetable smoothing, the §10.5 wavetables (as tables or as sample sources)
  assert.ok(all.some(x => x.O.pitch.mode === 'harm') && all.some(x => x.O.pitch.mode === 'ratio'), 'Harmonics and Ratio pitch modes');
  const tables = new Set(all.flatMap(x => [x.O.type === 'wt' ? x.O.wt : '', x.O.smp]));
  for (const t of W.FACTORY_TABLES.slice(-6)) assert.ok(tables.has(t.id), 'wavetable ' + t.id);
  // Filter 2 in series and in parallel; every new filter type (96–107)
  assert.ok(P2.some(pr => pr.v.s.p['f2.on'] >= 0.5 && pr.v.s.filter[0].route === 0), 'Filter 1 → Filter 2 in series');
  assert.ok(P2.some(pr => pr.v.s.p['f2.on'] >= 0.5 && pr.v.s.filter[0].route !== 0 && oscs(pr).some(x => x.on && x.O.route === 0 && x.p[x.k + '.fbal'] > 0.25 && x.p[x.k + '.fbal'] < 0.75)), 'in parallel');
  const ft = new Set(P2.flatMap(pr => [pr.v.s.p['f.on'] >= 0.5 ? Math.round(pr.v.s.p['f.type2'] * 107) : -1, pr.v.s.p['f2.on'] >= 0.5 ? Math.round(pr.v.s.p['f2.type'] * 107) : -1]));
  for (let t = 96; t <= 107; t++) assert.ok(ft.has(t), 'filter ' + core.FILTERS[t].name);
  // buses with FX; every new FX module, every S2 reverb type, the new distortion modes, an S2 FX Filter
  assert.ok(P2.some(pr => pr.fx.racks[1].mods.length && all.some(x => x.pr === pr && x.p[x.k + '.bus1'] > 0)), 'Bus 1 sends with Bus 1 FX');
  assert.ok(P2.some(pr => pr.fx.racks[2].mods.length && all.some(x => x.pr === pr && x.p[x.k + '.bus2'] > 0)), 'Bus 2 sends with Bus 2 FX');
  const inst = P2.flatMap(pr => fxMods(pr.fx));
  for (const t of ['bode', 'conv', 'util', 'split2', 'split3', 'splitms', 'fil', 'phs', 'cmp', 'eq', 'dly', 'cho']) assert.ok(inst.some(I => I.type === t && I.v === 2), 'FX ' + t);
  assert.deepEqual(new Set(inst.filter(I => I.type === 'rev').map(I => Math.round(I.p.type * 4))), new Set([0, 1, 2, 3, 4]), 'every reverb type');
  const dm = new Set(inst.filter(I => I.type === 'dist').map(I => Math.round(I.p.mode * 17)));
  assert.ok(dm.has(16) && dm.has(17), 'Overdrive and Soft Sat.');
  assert.ok(inst.some(I => I.type === 'split2' && I.br.every(B => B.length)) && inst.some(I => I.type === 'splitms' && I.br.every(B => B.length)), 'splitters with branch FX');
  // arpeggiated (factory pattern slots) and clip-sequenced presets (factory clip banks with macro lanes)
  const arp = P2.filter(pr => pr.v.s.p['arp.on'] >= 0.5);
  assert.ok(arp.length >= 3 && arp.every(pr => pr.v.s.arp.bank === 'Patterns' && pr.v.s.arp.slots[pr.v.s.arp.sel].shape === 1), 'arp presets on factory patterns');
  const clip = P2.filter(pr => pr.v.s.p['clip.on'] >= 0.5);
  assert.ok(clip.length >= 3 && clip.every(pr => core.FACTORY_CLIP_BANKS.some(b => b.name === pr.v.s.clip.bank)), 'clip presets on factory banks');
  assert.ok(clip.filter(pr => pr.v.s.clip.clips[pr.v.s.clip.sel].lanes.m1).length >= 3, 'macro lanes');
  // MPE-ready leads (expression rows, MPE on), Voice Control, a 7-limit just .scl, chaos / S&H / Path LFOs, ENV 4 Start,
  // colour noises, a Triangle sub, editable curves and slew, the multisample override envelope, key / scale and swing
  const rows = pr => pr.v.s.matrix.filter(r => r.src && r.dst);
  assert.ok(P2.filter(pr => pr.v.s.global.mpe.on && ['mpex', 'mpey', 'mpez'].every(x => rows(pr).some(r => r.src === x))).length >= 2, 'MPE-ready');
  assert.ok(P2.some(pr => pr.v.s.vc.len > 1) && P2.some(pr => pr.v.s.p['vc.det'] > 0 && rows(pr).some(r => r.src === 'vmod1')), 'Voice Control');
  const tun = P2.filter(pr => pr.v.s.global.tun.kind === 'scl');
  assert.ok(tun.length >= 1 && /7\/4/.test(tun[0].v.s.global.tun.scl) && (core.compileSerum(tun[0].v.s).serum.use & 512), 'an embedded 7-limit just tuning');
  const lt = new Set(P2.flatMap(pr => pr.v.s.lfo.filter((L, l) => rows(pr).some(r => r.src === 'lfo' + (l + 1) || r.src === 'lfo' + (l + 1) + 'y')).map(L => L.type)));
  for (const t of ['normal', 'path', 'lorenz', 'rossler', 'sh']) assert.ok(lt.has(t), 'LFO type ' + t);
  assert.ok(P2.some(pr => pr.v.s.p['e4.start'] > 0 && rows(pr).some(r => r.src === 'env4')), 'ENV 4 with a Start level');
  assert.ok(['color:Pink', 'color:Geiger'].every(id => P2.some(pr => pr.v.s.noise.src === id && pr.v.s.p['n.on'] >= 0.5)), 'colour noises');
  assert.ok(P2.some(pr => pr.v.s.p['s.on'] >= 0.5 && Math.round(pr.v.s.p['s.shp'] * 5) === 2), 'Triangle sub');
  assert.ok(P2.some(pr => rows(pr).some(r => r.crv)) && P2.some(pr => rows(pr).some(r => r.rise > 0 || r.fall > 0)), 'editable curves, slew');
  assert.ok(all.some(x => x.O.type === 'multi' && x.O.msmo.override), 'multisample override envelope');
  assert.ok(P2.some(pr => pr.v.s.kbd.key >= 0) && P2.some(pr => pr.v.s.kbd.swing !== 0), 'key / scale, swing');
  assert.ok(all.some(x => x.O.type === 'gran' && x.O.xy.on), 'granular Manual X|Y');
  assert.ok(all.some(x => x.O.type === 'sample' && x.O.smpo.slice.mode && x.O.smpo.slice.marks.length >= 8), 'sample slices');
  // categories: Phase-1 ones plus Texture and Sequence (≥ 3 each)
  const CATS = ['Bass', 'Lead', 'Pad', 'Pluck', 'Keys', 'Chord', 'Arp', 'Seq', 'Drum', 'FX', 'Texture', 'Sequence'];
  for (const pr of P2) assert.ok(CATS.includes(pr.cat), pr.name + ': ' + pr.cat);
  for (const c of ['Texture', 'Sequence']) assert.ok(P2.filter(pr => pr.cat === c).length >= 3, c);
});

/* ------------------------------------------------------------------ 2. levels, cleanliness, note 60 */
const RUNS = new Map();   // name → {o (phrase render), L0, secs, ev}
test('M3 §10.11: every Serum 2 preset peaks between −9 and −3 dBFS on its category phrase (velocity 0.8, 2x) with its assets; finite, no DC, tails decay; note 60 audible', async () => {
  for (const pr of P2) {
    const L0 = await load(pr);
    for (const id of L0.ids) assert.ok(L0.smps.some(e => e.id === id), pr.name + ': asset ' + id + ' built');
    const [ev, secs] = phrase(pr.cat, L0.s.voicing.mono), o = render(L0, ev, secs);
    RUNS.set(pr.name, { L0, ev, secs, sec: o.sec });
    assert.ok(o.PL.every(Number.isFinite) && o.PR.every(Number.isFinite), pr.name + ' finite');
    const pk = dB(Math.max(peak(o.PL), peak(o.PR)));
    assert.ok(pk >= -9 && pk <= -3, `${pr.name}: peak ${pk.toFixed(1)} dBFS`);
    assert.ok(!o.L.some(x => x !== 0 && Math.abs(x) < 1.2e-38) && !o.R.some(x => x !== 0 && Math.abs(x) < 1.2e-38), pr.name + ' subnormal output');
    // DC of the whole phrase and of its loudest second ≤ −30 dB re their RMS
    let best = 0, bi = 0;
    for (let i = 0; i + SR <= o.PL.length; i += SR / 2) { const v = rms(o.PL, i, i + SR) + rms(o.PR, i, i + SR); if (v > best) { best = v; bi = i; } }
    for (const [a, b] of [[0, o.PL.length], [bi, bi + SR]]) {
      let m = 0;
      for (let i = a; i < b; i++) m += (o.PL[i] + o.PR[i]) / 2;
      const r = 0.5 * (rms(o.PL, a, b) + rms(o.PR, a, b));
      if (r > 1e-3) assert.ok(dB(Math.abs(m / (b - a)) / r) <= -30, `${pr.name}: DC ${dB(Math.abs(m / (b - a)) / r).toFixed(1)} dB re RMS`);
    }
    // releases, echoes and reverb tails decay (no runaway feedback, no sequencer left running after the keys are up)
    const n = o.PL.length, q = SR / 4, late = dB(peak(o.PL, n - q)), early = dB(peak(o.PL, n - 7 * q, n - 6 * q));
    assert.ok(late < -60 || late < early - 3, `${pr.name}: tail ${late.toFixed(1)} dBFS after ${early.toFixed(1)} dBFS`);
    // §15.13: note 60 alone renders non-silent through the engine with the preset's assets
    const o60 = render(L0, [[0, 1, 60], [0.9, 0, 60]], 1), p60 = dB(Math.max(peak(o60.L), peak(o60.R)));
    assert.ok(p60 > -40 && p60 <= 0 && o60.L.every(Number.isFinite), `${pr.name}: note 60 peak ${p60.toFixed(1)} dBFS`);
  }
});

/* ------------------------------------------------------------------ 3. CPU (§14.1 budgets at 2x) */
// Preset budget: the busiest second of the category phrase ≤ 0.5 of real time on the reference machine (the heaviest
// §14.1 voice scenario, row d, is 0.8); gate 1.5 × target. Calibrated like every §14.1 gate (k = t_ref(calib) / t(calib),
// row (b) through tests/ref-p1, measured around the renders); a preset over the gate is rendered again (up to 3 attempts,
// its per-second times keep their minimum: a scheduling burst does not hit the same second every time).
const TARGET = 0.5;
test('M3 §14.1: every Serum 2 preset renders its phrase within the CPU budget at 2x (calibrated, busiest second)', async () => {
  assert.equal(RUNS.size, P2.length, 'the level test rendered every preset');
  const calib = T_REF_CALIB > 0 ? await calibRowB() : null;
  // k (per ms of CPU per second of audio → load): the median of three calibration runs (none: uncalibrated, s/s)
  const kOf = () => { if (!calib) return 1 / 1000; const t = []; for (let i = 0; i < 3; i++) { const t0 = performance.now(); calib(); t.push(performance.now() - t0); } return T_REF_CALIB / t.sort((a, b) => a - b)[1] / 1000; };
  const k0 = kOf(), loads = [];
  for (const pr of P2) {
    const R = RUNS.get(pr.name);
    let k = k0, best = R.sec.slice(), load = Math.max(...best) * k;
    for (let attempt = 2; attempt <= 3 && load > 1.5 * TARGET; attempt++) {
      const o = render(R.L0, R.ev, R.secs);
      best = best.map((t, i) => Math.min(t, o.sec[i]));
      k = kOf();
      load = Math.max(...best) * k;
    }
    loads.push([pr.name, load]);
    assert.ok(load <= 1.5 * TARGET, `${pr.name}: busiest second ${load.toFixed(3)} of real time (gate ${1.5 * TARGET})`);
  }
});
