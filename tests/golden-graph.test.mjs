// Golden graph (SPEC-canvas §11.2, §10 1d): the Track / Inst / Chain engine (engine.js) renders bit for bit what the
// single-class engine it was split from renders — tests/ref-1c/engine.js, a frozen copy of engine.js at 1ea3c5b (stage
// 1c, the last commit before the split; SHA-pinned below). Both run in the golden harness's scope with the current DSP
// scripts and modules; only engine.js differs. Every factory preset (the 12 classic models with the default panel, every
// Serum preset, every FX chain on a classic and on a Serum track) through the event script, plus the paths the split
// touched: the idle skip ("note → 3 s silence → note", with and without an FX tail), an oversampling change mid-note,
// model switches mid-note (classic ↔ Serum: tails, the kept rack), panic, {t: 'bye'}, both sequencers, the monitors
// (smon vs {t: 'mon', ids}) and everything the processor posts. Stage 1e (IMPL-1e §7): every render is also made in the
// graph form of the canonical track — {t: 'graph'} + {t: 'patch', i} + {t: 'chain', c} (a model switch: the reshape's
// new graph) — and as processorOptions (graph, patches, chains, seqs), both bit for bit equal to the legacy render, the
// posted messages equal once the part ids (i, c) are dropped. GOLDEN_FULL=1: also 44.1 kHz × 1 and Serum at OS 1 and 4.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import * as H from './golden-harness.mjs';

const [, B] = await H.sides();
const REF_URL = new URL('./ref-1c/engine.js', import.meta.url), REF_SHA = 'd5d0b375735736ed43015ef90671f9bf56208b85d8e12595d33d3bc55efbdd1d';
const L = Object.assign({}, B, { name: 'legacy', engine: readFileSync(REF_URL, 'utf8'), entries: new Map(), user: new Map(), scopes: new Map() });
const core = B.core, fxm = B.fxm, MODELS = B.models.MODELS.filter(m => !m.custom);
const SX_OS = H.FULL ? [1, 2, 4] : [2], CL_RATES = H.FULL ? [[48000, 4], [44100, 1]] : [[48000, 4]];
const st = (n, o, a, s, g = 1) => ({ n, o, a, s, g });
const SEQ303 = { pat: [st(0, 0, 1, 0), st(0, 0, 0, 0), st(12, 0, 0, 1), st(0, 0, 0, 0), st(3, 0, 1, 0), st(0, 0, 0, 1), st(10, 0, 0, 0), st(0, 0, 0, 0, 0),
  st(0, 0, 1, 0), st(7, 0, 0, 1), st(5, 0, 0, 0), st(3, 0, 0, 0), st(12, 0, 1, 1), st(0, 1, 0, 0), st(5, 0, 0, 0), st(6, 0, 1, 0)],
len: 16, bpm: 120, swing: 0.1, root: 48, sync: true, run: false };

// bit for bit: the first 32-bit word where two Float32 renders differ (-1: none) — stricter than compare (±0, NaN payloads)
function bits(a, b) {
  for (const c of ['L', 'R']) {
    const x = new Uint32Array(a[c].buffer, a[c].byteOffset, a[c].length), y = new Uint32Array(b[c].buffer, b[c].byteOffset, b[c].length);
    if (x.length !== y.length) return c + ': length';
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return `${c}[${i}] = ${(i / H.SR).toFixed(4)} s: ${a[c][i]} vs ${b[c][i]}`;
  }
  return '';
}
// the messages a processor posts, timing removed (stats' load and its per-part loads are CPU time)
function tap(p, log) {
  p.port.postMessage = m => {
    let c = m;
    if (m && m.t === 'stats') { c = { t: 'stats', voices: m.voices, os: m.os }; if (m.per) assert.ok(m.per.every(e => e.load >= 0 && Number.isFinite(e.load))); }
    log.push(structuredClone(c)); // (into this realm: the scopes' objects have their own prototypes)
  };
}
/* ---- the graph form of a canonical track (IMPL-1e §2.5, §3.3: what main.js posts for a graphed node) */
const Z = { lo: 0, hi: 127, xp: 0 }, P1 = { id: 'i1', on: true, zone: Z, salt: 0 };
const gClassic = fx => ({ t: 'graph', insts: [P1], chains: [{ id: fx }], edges: [['i1', fx, 1], [fx, 'out', 1]], out: 'out', key: 'i1>' + fx + '>out' });
const gSerum = () => ({ t: 'graph', insts: [P1], chains: [], edges: [['i1', 'out', 1]], out: 'out', key: 'i1>out' });
const strip = p => { const q = Object.assign({}, p); delete q.fxr; delete q.fxrT; return q; };
// a legacy message → its graph-form messages; st: the shape so far (a classic patch → the panel fxN with the patch's FXP,
// a new panel after a Serum: the reshape; a Serum patch → its own FX, OUT); part ids i0 → i1, c0 → the panel (a Serum's
// own FX meters come with its Inst's monitor message)
function gMsg(d, st) {
  if (d.t === 'patch') {
    const p = d.p, o = [];
    if (p.engine === 'serum') { if (st.kind !== 'serum') { o.push(gSerum()); st.kind = 'serum'; } o.push({ t: 'patch', i: 'i1', p }); return o; }
    if (st.kind !== 'classic') { st.fx = 'fx' + ++st.n; o.push(gClassic(st.fx)); st.kind = 'classic'; }
    o.push({ t: 'patch', i: 'i1', p: strip(p) }, { t: 'chain', c: st.fx, fxr: p.fxr, fxrT: p.fxrT });
    return o;
  }
  if (d.t === 'seq' || d.t === 'seqcmd' || d.t === 'sqt' || d.t === 'ct') return [Object.assign({}, d, { i: 'i1' })];
  if (d.t === 'mon') return [{ t: 'mon', ids: d.ids.map(k => (k === 'i0' ? 'i1' : k === 'c0' ? (st.kind === 'serum' ? '' : st.fx) : k)).filter(k => k) }];
  return [d];
}
const gEvents = (ev, st) => { const o = []; for (const [f, d] of ev) for (const m of gMsg(d, st)) o.push([f, m]); return o; };
// renders one case: the legacy engine (ref-1c) and the Track engine from the same id (Math.random), options, setup and
// events, then the Track engine in the graph form (G: the setup's messages, then the events', translated) and as
// processorOptions (P: the setup's tables, assets, patch and sequence gathered into graph / patches / chains / seqs, the
// rest posted after construction) → [legacy, new, G, P]
function forms(c) {
  const sr = c.sr || H.SR, evOf = X => (typeof c.events === 'function' ? c.events(X) : c.events || []);
  const one = (X, form) => {
    const log = [], st = { kind: '', fx: '', n: 0 };
    let po = c.po, ev = evOf(X), setup = p => c.setup(X, p);
    if (form === 'G') { const sent = []; c.setup(X, { msg: d => { sent.push(...gMsg(d, st)); } }); setup = p => { for (const m of sent) p.msg(m); }; }
    if (form === 'P') {
      const rest = [], o = { wts: [], smps: [], patches: {}, chains: {}, seqs: {} };
      c.setup(X, { msg(d) {
        if (d.t === 'wt') o.wts.push(d);
        else if (d.t === 'smp') o.smps.push(d);
        else if (d.t === 'patch' || d.t === 'seq') {
          for (const m of gMsg(d, st)) {
            if (m.t === 'graph') o.graph = m; else if (m.t === 'patch') o.patches[m.i] = m.p; else if (m.t === 'chain') o.chains[m.c] = { fxr: m.fxr, fxrT: m.fxrT };
            else o.seqs[m.i] = m.s;
          }
        } else rest.push(...gMsg(d, st));
      } });
      po = Object.assign({}, c.po, o);
      setup = p => { for (const m of rest) p.msg(m); };
    }
    if (form !== 'legacy') ev = gEvents(ev, st);
    const r = H.render(H.scope(X, sr), { id: c.id, po, seconds: c.seconds, events: ev, setup(p) { tap(p, log); setup(p); } });
    r.log = log;
    return r;
  };
  return [one(L, 'legacy'), one(B, 'legacy'), one(B, 'G'), one(B, 'P')];
}
// the posted messages of a graph form against the legacy ones: the part ids dropped (every one names the track's parts)
const IDS = /^(i1|i1\/fx|fx\d+)$/;
function unId(log, bad, id) {
  return log.map(m => {
    if (!m || typeof m !== 'object' || !('i' in m || 'c' in m)) return m;
    if (('i' in m && !IDS.test(m.i)) || ('c' in m && !IDS.test(m.c))) bad.push(`${id}: part id ${m.i || m.c} in ${m.t}`);
    const o = Object.assign({}, m); delete o.i; delete o.c;
    return o;
  });
}
function check(bad, id, r, { audible = true, msgs = true } = {}) {
  if (audible && !(H.peak(r[0]) > 1e-4)) bad.push(`${id}: silent`);
  for (let k = 1; k < r.length; k++) {
    const tag = id + ['', '', ' (graph)', ' (processorOptions)'][k], d = bits(r[0], r[k]);
    if (d) bad.push(`${tag}: ${d}`);
    if (msgs && !isDeepStrictEqual(r[0].log, k === 1 ? r[1].log : unId(r[k].log, bad, tag))) bad.push(`${tag}: posted messages differ (${r[0].log.length} vs ${r[k].log.length})`);
  }
}
const patchMsg = (X, p, model, vals, fx, o = {}) => {
  const patch = H.trackPatch(X, model, vals, fx, o);
  H.postTables(X, p, patch.needs);
  p.msg({ t: 'patch', p: patch });
};
const classicVals = (m, pr) => H.classicVals(B, m, pr);
const sxOf = (pr, os) => { const s = core.applyPreset(core.defaultSerum(), pr); s.global.os = os; return { s, fx: pr.fx ? fxm.applyPresetFx(fxm.defaultFx2(), pr.fx, s) : fxm.defaultFx2() }; };
const sxDefault = os => { const s = core.defaultSerum(); s.global.os = os; return { s, fx: fxm.defaultFx2() }; };
// the sample-like assets a preset needs (factory samples, spectral data, multisamples from the render farm, IRs), built
// by the asset manager as the app builds them (tests/presets2.test.mjs); a fresh manager per preset (memory stays flat)
const W = B.wt, isWt = id => id.startsWith('noise:') || !!W.factoryTable(id);
async function presetAssets(v) {
  const ids = (H.trackPatch(B, 'serum', { s: v.s }, v.fx).needs || []).filter(id => !isWt(id));
  if (!ids.length) return [];
  const [A, wtstore, smpstore] = await Promise.all(['assets.js', 'wtstore.js', 'smpstore.js'].map(f => import(new URL(f + H.SUFFIX, H.ROOT).href)));
  const farm = () => {
    const g = vm.createContext(vm.constants.DONT_CONTEXTIFY), V = H.SUFFIX;
    Object.assign(g, { console: { log() {}, info() {}, debug() {}, warn() {}, error() {} }, location: { search: V } });
    g.self = g;
    g.importScripts = (...urls) => { for (const u of urls) { const f = u.slice(0, -V.length); vm.runInContext(readFileSync(new URL(f, H.ROOT), 'utf8'), g, { filename: 'farm/' + f }); } };
    const w = { onmessage: null, onerror: null, terminate() {} };
    g.postMessage = m => setImmediate(() => w.onmessage && w.onmessage({ data: m }));
    vm.runInContext(readFileSync(new URL('smprender.js', H.ROOT), 'utf8'), g, { filename: 'smprender.js' });
    w.postMessage = m => setImmediate(() => g.onmessage({ data: m }));
    return w;
  };
  const AM = A.createAssetManager({ ctxOf: () => null, post: () => false, tracks: () => [], worker: k => (k === 'render' ? farm() : null),
    stores: { wt: () => wtstore.memoryStore(), smp: () => smpstore.memoryStore() }, wt: () => Promise.resolve(W), persist: () => Promise.resolve(true) });
  return AM.entries(ids, H.SR, { s: v.s, fx: v.fx });
}

test('tests/ref-1c/engine.js is the frozen pre-split engine (SHA-256 pinned)', () => {
  assert.equal(H.sha256(L.engine), REF_SHA, 'tests/ref-1c/engine.js was edited');
  assert.ok(/class SynthProcessor extends AudioWorkletProcessor/.test(L.engine) && !/class Track\b/.test(L.engine));
  assert.ok(/class Track extends Facade/.test(B.engine) && /class Inst\b/.test(B.engine), 'engine.js is the split engine');
});

for (const [sr, os] of CL_RATES) {
  test(`every classic preset (12 models + default panels) at ${sr / 1000} kHz × ${os}: legacy vs Track engine (legacy messages, graph form, processorOptions), bit for bit (+ posted messages)`, () => {
    const bad = [];
    let n = 0;
    for (const m of MODELS) {
      for (const pr of [null, ...m.presets]) {
        const id = `graph:${m.id}:${pr ? pr.name : '(default)'}:${sr}:${os}`;
        const r = forms({ id, sr, po: { os, hostOS: os }, events: H.script(sr), setup(X, p) {
          patchMsg(X, p, m.id, classicVals(m.id, pr), fxm.defaultFx2(), { sr, seed: true });
          if (m.id === 'tb303') p.msg({ t: 'seq', s: H.clone(SEQ303) });
        } });
        check(bad, id, r);
        n++;
      }
    }
    assert.equal(n, 12 + MODELS.reduce((k, m) => k + m.presets.length, 0));
    assert.deepEqual(bad, []);
  });
}

for (const os of SX_OS) {
  test(`every Serum factory preset (${core.FACTORY_PRESETS.length}) at OS ${os}, with its assets: legacy vs Track engine (legacy messages, graph form, processorOptions), bit for bit (+ posted messages)`, async () => {
    const bad = [];
    let loud = 0;
    for (const pr of core.FACTORY_PRESETS) {
      const id = `graph:serum:${pr.name}:${os}`, v = sxOf(pr, os), smps = await presetAssets(v);
      const r = forms({ id, po: { os, hostOS: 4 }, events: H.script(H.SR), setup(X, p) {
        for (const e of smps) p.msg(Object.assign({ t: 'smp' }, e)); // (into the scope's store: every rack hears of it, Track.assets)
        patchMsg(X, p, 'serum', { s: H.clone(v.s) }, H.clone(v.fx), { seed: true });
      } });
      check(bad, id, r, { audible: false });
      if (H.peak(r[0]) > 1e-4) loud++;
      for (const X of [L, B]) for (const e of smps) H.scope(X).g.SxBase.dropAsset(e.id);
    }
    assert.deepEqual(bad, []);
    assert.ok(loud >= core.FACTORY_PRESETS.length - 2, `every preset audible (${loud} of ${core.FACTORY_PRESETS.length})`);
  });
}

test(`every FX chain (${fxm.FACTORY_CHAINS.chains.length}) on a classic track (the shared panel: Track.renderSpan, {t: 'chain'}) and on a Serum track (its own FX: Inst.renderSerum), in every form`, () => {
  const bad = [];
  for (const ch of fxm.FACTORY_CHAINS.chains) {
    for (const model of ['prophet5', 'serum']) {
      const id = `graph:chain:${ch.name}:${model}`;
      const r = forms({ id, po: { os: model === 'serum' ? 2 : 4, hostOS: 4 }, events: H.script(H.SR), setup(X, p) {
        const fx = fxm.normalizeFx2(H.clone(ch.fx));
        if (model === 'serum') { const v = sxDefault(2); patchMsg(X, p, 'serum', { s: v.s }, fx, { seed: true }); }
        else patchMsg(X, p, model, classicVals(model, null), fx, { seed: true });
      } });
      check(bad, id, r);
    }
  }
  assert.deepEqual(bad, []);
});

/* ------------------------------------------------------------------ the paths the split touched */
const F = t => Math.round(t * H.SR);
const on = (n, v = 0.8) => ({ t: 'on', n, v }), off = n => ({ t: 'off', n });
const CASES = [
  // §6.4: the idle skip (track-level, no output stage once quiet for 2 s and the FX idle), then a note on the frozen state
  ...['prophet5', 'juno60', 'dx7', 'solina', 'serum'].map(model => ({ name: `idle skip: note → 3 s silence → note (${model})`, model, seconds: 5.5,
    events: [[0, on(48)], [F(0.3), off(48)], [F(3.6), on(55)], [F(4.2), off(55)]] })),
  { name: 'idle skip behind a reverb tail (Hall Verb chain, prophet5)', model: 'prophet5', chain: 'Hall Verb', seconds: 7,
    events: [[0, on(48)], [F(0.3), off(48)], [F(5.5), on(55)], [F(6), off(55)]] },
  { name: 'idle skip behind a reverb tail (Hall Verb chain, Serum)', model: 'serum', chain: 'Hall Verb', seconds: 7,
    events: [[0, on(48)], [F(0.3), off(48)], [F(5.5), on(55)], [F(6), off(55)]] },
  // the app's oversampling changed while notes sound (the fade, the switch at zero, the refill)
  { name: 'oversampling 4 → 2 → 8 mid-note (prophet5)', model: 'prophet5', seconds: 2,
    events: [[0, on(48)], [0, on(55)], [F(0.4), { t: 'os', v: 2 }], [F(0.9), { t: 'os', v: 8 }], [F(1.5), off(48)], [F(1.5), off(55)]] },
  { name: 'Serum: the app oversampling message is ignored, its own changes with a patch (quality 2 → 4 mid-note)', model: 'serum', seconds: 2,
    events: X => [[0, on(48)], [F(0.3), { t: 'os', v: 1 }], [F(0.6), { t: 'patch', p: H.trackPatch(X, 'serum', { s: sxDefault(4).s }, fxm.defaultFx2()) }], [F(1.4), off(48)]] },
  // model switches while notes sound: tails, the chorus / ensemble, the kept FX rack (its tails survive)
  { name: 'model switch mid-note: juno60 → Serum → prophet5 (Dub Delay chain kept)', model: 'juno60', chain: 'Dub Delay', seconds: 3,
    events: X => [[0, on(48)], [0, on(60)], [F(0.5), { t: 'patch', p: H.trackPatch(X, 'serum', { s: sxDefault(2).s }, fxm.normalizeFx2(H.clone(chain('Dub Delay')))) }],
      [F(0.7), on(64)], [F(1.4), { t: 'patch', p: H.trackPatch(X, 'prophet5', classicVals('prophet5', null), fxm.normalizeFx2(H.clone(chain('Dub Delay')))) }],
      [F(1.6), on(67)], [F(2.2), off(48)], [F(2.2), off(60)], [F(2.2), off(64)], [F(2.2), off(67)]] },
  { name: 'model switch mid-note: DX7 (Vintage DAC) → Serum (the DAC stream drains)', model: 'dx7', preset: 'Brass Ensemble', seconds: 2,
    events: X => [[0, on(48)], [0, on(55)], [F(0.5), { t: 'patch', p: H.trackPatch(X, 'serum', { s: sxDefault(2).s }, fxm.defaultFx2()) }], [F(0.6), on(60)], [F(1.5), off(60)]] },
  // panic (the 5 ms output fade, then everything cleared) and {t: 'bye'} (the node fades out and ends)
  { name: 'panic mid-chord, then play on (prophet5, Hall Verb)', model: 'prophet5', chain: 'Hall Verb', seconds: 2,
    events: [[0, on(48)], [0, on(52)], [F(0.5), { t: 'panic' }], [F(0.8), on(55)], [F(1.4), off(55)]] },
  { name: 'panic mid-chord (Serum)', model: 'serum', seconds: 1.5, events: [[0, on(48)], [0, on(52)], [F(0.5), { t: 'panic' }], [F(0.8), on(55)], [F(1.2), off(55)]] },
  { name: '{t: bye} mid-note: fades out, then silent (Serum)', model: 'serum', seconds: 1, events: [[0, on(48)], [F(0.4), { t: 'bye' }], [F(0.6), on(55)]] },
  // the sequencers (span splitting at their events): the TB-303 free-running and synced; a Serum arpeggiator
  { name: 'TB-303 step sequencer free-running (run), stopped mid-pattern', model: 'tb303', seconds: 3,
    setup: p => p.msg({ t: 'seq', s: Object.assign(H.clone(SEQ303), { sync: false, run: true }) }), events: [[F(2.2), { t: 'seq', s: { run: false } }]] },
  { name: 'Serum arpeggiator through the song (sqOn: spans split at its steps)', model: 'serum', arp: true, seconds: 3, events: H.script(H.SR) },
  // the monitors: subscribed parts change no sample; the snapshots posted are the same (smon on both; mon on the new one)
  { name: 'monitors: smon on (legacy) vs {t: mon, ids: [i0, c0]} (Track) — same audio, same snapshots (Serum, Hall Verb)', model: 'serum', chain: 'Hall Verb', seconds: 1.5,
    mon: true, events: [[0, on(48)], [0, on(55)], [F(1), off(48)], [F(1), off(55)]] },
];
function chain(name) { const c = fxm.FACTORY_CHAINS.chains.find(x => x.name === name); assert.ok(c, name); return c.fx; }

test('the paths the split touched: idle skip, oversampling and model changes mid-note (graph form: the reshape keeps the rack), panic, bye, sequencers, monitors — bit for bit in every form', () => {
  const bad = [];
  for (const c of CASES) {
    const id = 'graph:case:' + c.name, sx = c.model === 'serum';
    const r = forms({ id, seconds: c.seconds, po: { os: sx ? 2 : 4, hostOS: 4 }, events: c.events, setup(X, p) {
      const fx = c.chain ? fxm.normalizeFx2(H.clone(chain(c.chain))) : fxm.defaultFx2();
      H.postTables(X, p, H.trackPatch(X, 'serum', { s: sxDefault(2).s }, fxm.defaultFx2()).needs); // (the Serum patches of the events)
      if (sx) { const v = sxDefault(2); if (c.arp) v.s.p['arp.on'] = 1; patchMsg(X, p, 'serum', { s: v.s }, fx, { seed: true }); }
      else patchMsg(X, p, c.model, classicVals(c.model, c.preset ? B.models.MODELS.find(m => m.id === c.model).presets.find(q => q.name === c.preset) : null), fx, { seed: true });
      if (c.setup) c.setup(p);
      if (c.mon) p.msg(X === L ? { t: 'smon', on: true } : { t: 'mon', ids: ['i0', 'c0'] });
    } });
    check(bad, id, r);
    for (let k = 1; k < r.length; k++) if (c.mon && !(r[k].log.filter(m => m.t === 'smon' && m.s && m.gr).length > 20)) bad.push(id + ': snapshots posted ' + k);
    if (c.model === 'tb303' && !r[2].log.some(m => m.t === 'step' && m.i === 'i1')) bad.push(id + ': {t: step, i} on the graph node');
  }
  assert.deepEqual(bad, []);
});

test('idle skip: once quiet the Track skips the output stage (its state frozen) exactly where the legacy engine did — outStage calls and the DC block state (legacy messages and graph form)', () => {
  const runs = [[L, 0], [B, 0], [B, 1]].map(([X, g]) => {
    const calls = [], st = { kind: '', fx: '', n: 0 };
    const r = H.render(H.scope(X), { id: 'graph:idle-outstage', seconds: 5.5, po: { os: 4, hostOS: 4 },
      events: [[0, on(48)], [F(0.3), off(48)], [F(3.6), on(55)], [F(4.2), off(55)]],
      setup(p) {
        const send = p.msg.bind(p);
        patchMsg(X, g ? { msg: d => { for (const m of gMsg(d, st)) send(m); } } : p, 'prophet5', classicVals('prophet5', null), fxm.defaultFx2());
        if (g) assert.equal(p.graphed + p.simple, 2, 'a graph node in the alias shape');
        const o = p.outStage;
        p.outStage = function (Lo, Ro, off, n) { calls.push(H.scope(X).g.currentFrame + off); return o.call(this, Lo, Ro, off, n); };
      } });
    return { r, calls, dc: Array.from(r.proc.dcy) };
  });
  for (const k of [1, 2]) {
    assert.equal(bits(runs[0].r, runs[k].r), '');
    assert.deepEqual(runs[k].calls, runs[0].calls, 'the output stage runs in the same spans');
    assert.deepEqual(runs[k].dc, runs[0].dc);
  }
  const seen = new Set(runs[0].calls.map(f => f - (f % 128))), skipped = [];
  for (let f = F(0.3) - (F(0.3) % 128); f < F(3.6); f += 128) if (!seen.has(f)) skipped.push(f);
  assert.ok(skipped.length > F(0.5) / 128, `the silence after the 2 s quiet window skips the output stage (${skipped.length} quanta)`);
  assert.ok(runs[0].calls.some(f => f >= F(3.6)), 'the next note runs it again');
});
