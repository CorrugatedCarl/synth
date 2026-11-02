import './v8-guard.mjs';
// FR Cut B, lane E (docs/canvas/IMPL-FR-B.md §2, gates FR1b, G5′ (node), §2.6, G8 (node)): the engine's fast lane. A display that
// asks sends {t: 'fastOn', hz, ids, ix, ixv}; the Track / MASTER then posts {t: 'fast', F, …} outputs at up to 120 Hz, keyed by the
// audio frame F of the post, from reads of their own — side-effect-free, allocation-free, never stealing the slow lane's peaks.
// FR1b  three scenes (a legacy Serum: an LFO on cutoff, an own-FX compressor and a Ducker; a graphed Track: a Serum, a panel with a
//       compressor, a classic Inst with ModCore rows and 'mods'; MASTER: meters, an mfx compressor, mods), 3 s each, the same
//       {t: 'mon'} and inputs with and without {t: 'fastOn', hz: 120}: the audio bit-identical, every non-fast non-stats message equal
//       in order; every fast field equal to its slow twin in a quantum where both post; the peaks partitioned (exact at hz 30; at
//       120 each fast post's peak = the max of its quanta's block maxima, as each slow post's, and the run maxima equal); the cadence
//       (120 Hz: 4, 3, 3, … quanta from the first quantum after fastOn; 30: one fast post per slow post at its F; 0: none); the
//       shapes (keys, lengths, F === the processor's frames, k === ixv); no allocation per post (the message objects and arrays ===
//       across posts; process under throwing constructors); grF null without a GR unit, sized at the layout only. SXF ≡ FAST.
// G5′   the 120 Hz posts in motion.js rings, read at every quantum end (lagged 8 quanta: the bracketing anchors are there, as at the
//       heard frame) against the truth T.fastRead() (the same reads after every quantum, the peaks left out): HOLD exact; PH / TIME /
//       POS (a FREE LFO's phase, ENV time, the Ducker's position) within 1e-6 between anchors; curved fields (lfoOut, eff, gr, mo,
//       e, mc) within the chord bound computed from the truth, ≤ 2e-3 for the LFOs ≤ 2 Hz; the master's PEAK = a reference meter's
//       per-quantum peaks over the drained anchors' frames; discontinuities and EXTRA counted and recorded.
// §2.6  filterImpulse / SxFilt2.impulse with a scratch {out}: the response bit-identical, the array reused.
// G8    fast-sx / fast-fx / fast-master (tests/bench-scenarios.mjs): on − off as paired interleaved medians with an A/A pair.
// Numbers, strings and booleans only into assert (no fake DOM here; vm-realm objects are cloned or compared by hand).
// Run alone: node --max-old-space-size=2048 --test tests/fast-lane.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { dspScope, noAlloc } from './dsp-scope.mjs';
import * as core from '../serum-core.js?v=9';
import * as W from '../wt.js?v=9';
import { patchFor, MODELS } from '../models.js?v=9';
import * as G from '../cv-graph.js?v=9';
import * as MO from '../cv-model.js?v=9';
import * as S from '../song.js?v=9';
import * as MOT from '../motion.js?v=9';
import { fxInst, master5make, masterPayload, masterInput, scenarios, measureFast } from './bench-scenarios.mjs';

const SR = 48000, Q = 128, TID = 'trk_fast';
const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
const NSV = core.NSV, MAXFX = 8 + 48 * 24, SXN = MOT.SXF.N;
const hzN = hz => Math.pow(hz / 100, 0.25), timeN = sec => Math.pow(sec / 32, 0.2);
const ladN = label => core.LFO_LADDER.findIndex(x => x.label === label) / (core.LFO_LADDER.length - 1);
const VI = id => core.vi(core.DEST_INDEX[id]);
const fr = Math.fround;
const dB120 = p => (p > 1e-6 ? 20 * Math.log10(p) : -120);                     // a Serum mix meter (snapshot's rule)
const dBinf = a => (a > 0 ? 20 * Math.log10(a) : -Infinity);                     // the master's (master-dsp's dbOf)
// one sine cycle, 257 points (a smooth LFO: the chord bound of G5′ is about curvature, not a triangle's corners)
const SINE = Array.from({ length: 257 }, (_, i) => [i / 256, 0.5 + 0.5 * Math.sin(2 * Math.PI * i / 256), 0]);
const mrow = (src, dst, amt, o) => Object.assign({ src, dst, amt, bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1, acurve: 0, crv: null, rise: 0, fall: 0, slink: 0 }, o || {});
const PO = { sr: SR, bpm: 128, prefs: { smooth: 1, silenceTails: 1 } };
const PROJ = { bpm: 128, perf: { wheel: null }, tracks: [], pads: [] };
const tables = (p, patch, i) => { for (const id of patch.needs || []) if (/^(factory|noise):/.test(id)) p.msg(Object.assign({ t: 'wt' }, id.startsWith('noise:') ? W.makeNoise(id) : W.makeEntry(id, W.factoryTable(id)), i ? { i } : null)); };

/* ------------------------------------------------------------------ the scenes */
// a Serum: LFO 1 / 2 / 3 FREE MONO sines at 0.5 / 2 / 8 Hz on cutoff / res / pan A, ENV 2 (A 0.15 s, D 0.3 s, S 0.5, R 0.4 s) on drive
function sxState() {
  const s = core.defaultSerum();
  Object.assign(s.p, { 'a.rand': 0, 'b.rand': 0, 'c.rand': 0, 'f.on': 1 });
  s.global.os = 2; s.voicing.poly = 4;
  [[0.5, 'f.cutoff'], [2, 'f.res'], [8, 'a.pan']].forEach(([hz, dst], l) => {
    s.lfo[l] = Object.assign({}, s.lfo[l], { mode: 'free', mono: 1, bpm: 0, anchor: 0, pts: SINE });
    s.p[`l${l + 1}.rate`] = hzN(hz);
    s.matrix[l] = mrow(`lfo${l + 1}`, dst, 0.3);
  });
  Object.assign(s.p, { 'e2.att': timeN(0.15), 'e2.dec': timeN(0.3), 'e2.sus': 0.5, 'e2.rel': timeN(0.4) });
  s.matrix[3] = mrow('env2', 'f.drive', 0.4);
  return core.normalizeSerum(s);
}
// a Serum's own FX: a compressor (thr −24 dB, ratio 4) and a Ducker keyed by this track's notes (1/8 synced)
function sxFx(duck = true) {
  const fx = core.defaultFx2();
  fxInst(fx, 'cmp', { thr: Math.pow(10, -24 / 20), ratio: 4, att: 2, rel: 80 });
  if (duck) fxInst(fx, 'duck', { depth: 1, bpm: 1, att: 1, smooth: 2 }).sub.src = TID;
  return fx;
}
function junoPatch() {
  const m = MODELS.find(x => x.id === 'juno60'), v = Object.fromEntries(m.controls.map(c => [c.id, c.def]));
  const p = patchFor(m, v, core.defaultFx2(), { sr: SR, bpm: 128 });
  delete p.fxr; delete p.fxrT;
  return p;
}
// notes at 128 BPM (one a beat, 0.7 beats long) → [[quantum, msg]]
function beats(seconds, notes = [48, 55, 60, 52]) {
  const beat = 60 / 128 * SR, ev = [];
  for (let k = 0; k * beat < seconds * SR; k++) {
    const n = notes[k % notes.length];
    ev.push([Math.floor(k * beat / Q), { t: 'on', n, v: 0.8 }], [Math.floor((k + 0.7) * beat / Q), { t: 'off', n }]);
  }
  return ev;
}
const IX0 = () => Int16Array.from([VI('a.pan'), VI('f.cutoff'), VI('f.res'), VI('f.drive'), NSV + 8]);

// scene 1: the legacy Serum (no graph: i0 the Serum, c0 its own FX)
function legacyScene() {
  const patch = patchFor('serum', { s: sxState() }, sxFx(true), PO);
  return {
    id: 'legacy', mon: ['i0', 'c0'], fast: { ids: ['i0', 'c0'], ix: { i0: IX0() }, ixv: 3 }, events: beats(4),
    make(D) {
      const p = new D.Proc({ processorOptions: { os: 2, hostOS: 4, trackId: TID } });
      p.msg({ t: 'patch', p: patch }); tables(p, patch);
      return p;
    },
  };
}
// scene 2: the graphed Track — i1 a Serum (its own FX: a compressor and the Ducker), i2 a Juno-60 into fx1 (a panel: a compressor, or
// an EQ when noGr), a GLOBAL canvas LFO (sine, BPM 1/4) on the Juno's cutoff, the panel's knob and the Serum's res (an ext row); 'mods'
function graphScene(o = {}) {
  const fxS = sxFx(true), fxP = core.defaultFx2();
  const pc = o.noGr ? fxInst(fxP, 'eq', { gainL: 0.6 }) : fxInst(fxP, 'cmp', { thr: Math.pow(10, -30 / 20), ratio: 4, att: 2, rel: 80 });
  const t = { id: TID, name: 'F', notes: [], cc: [], prim: 'i1', nid: 5,
    dev: { i1: { kind: 'synth', model: 'serum', vals: { s: sxState() }, preset: null, fx: fxS }, i2: { kind: 'synth', model: 'juno60', vals: {}, preset: null },
      fx1: { kind: 'panel', fx: fxP }, out: { kind: 'out' } },
    wires: [{ id: 'w1', a: 'i1.out', b: 'out.in' }, { id: 'w2', a: 'i2.out', b: 'fx1.in' }, { id: 'w3', a: 'fx1.out', b: 'out.in' }], mods: [] };
  t.dev.l1 = S.normModDev({ kind: 'lfo', lfo: { mono: 1, mode: 'free', bpm: 1, anchor: 0, pts: SINE }, rate: ladN('1/4') });
  for (const [src, dst] of [['l1.out', 'i2:cf'], ['l1.out', `fx1:fx.${pc.id}.${o.noGr ? 'gainL' : 'thr'}`], ['l1.out', 'i1:f.res']]) {
    const r = MO.addMod(t, src, dst, { project: PROJ });
    if (!r.ok) throw new Error(src + ' → ' + dst + ': ' + r.why);
  }
  const pay = Object.assign(G.compileMods(t, PROJ, { smooth: 1, qr: null, ultra: 0 }), { bpm: 128 });
  const g = G.compileGraph(t), sx = G.instPatch(t.dev.i1, PO, G.modRowsFor(t, 'i1'), pay.ext, t), juno = junoPatch(), chain = G.chainPatch(fxP, { sr: SR, bpm: 128 });
  const ids = ['i1', 'i1/fx', 'i2', 'fx1', 'mods'];
  return {
    id: o.noGr ? 'graph-nogr' : 'graph', mon: ids, fast: { ids, ix: { i1: IX0() }, ixv: 7 }, events: beats(4), fxS, fxP, pay,
    make(D) {
      const p = new D.Proc({ processorOptions: { os: 2, hostOS: 4, trackId: TID } });
      p.msg(Object.assign({ t: 'graph' }, g.graph));
      p.msg({ t: 'patch', i: 'i1', p: sx }); tables(p, sx, 'i1');
      p.msg({ t: 'patch', i: 'i2', p: juno });
      p.msg(Object.assign({ t: 'chain', c: 'fx1' }, chain));
      p.msg(pay);
      if (!p.mc) throw new Error('graph scene: the ModCore payload was refused');
      return p;
    },
  };
}
// scene 3: MASTER — bench rack5 (EQ → multiband compressor → Distortion → Utility → limit compressor), the master-mods payload (4
// GLOBAL LFOs, a chaos, a macro; 8 fx rows), the meters; the bench noise in
function masterScene() {
  const fx = core.defaultFx2();
  master5make(fx);
  const pay = masterPayload(fx), fxr = core.compileFx(fx, { bpm: 120, rate: SR }), fxrT = core.compileFxT(fx), ids = ['meters', 'mfx', 'mods'];
  return {
    id: 'master', master: true, mon: ids, fast: { ids }, events: [], input: () => masterInput(), // (a fresh noise source per render)
    make(D) {
      const p = new D.procs['synth-master']({ processorOptions: {} });
      p.msg({ t: 'chain', fxr, fxrT });
      p.msg(pay);
      return p;
    },
  };
}

// one render: a fresh scope (seeded), the scene's processor, {t: 'mon'} then (fast) {t: 'fastOn'} — or fastFirst: fastOn before mon —,
// `seconds` of quanta with the scene's events; every post recorded {q, F (the processor's frames at the post), ref, c (a clone)}
function render(sc, fast, o = {}) {
  const D = dspScope({ fast: true, engine: true, seed: 'fast-lane:' + sc.id, console: quiet });
  const p = sc.make(D), log = [], seconds = o.seconds || 3, n = Math.round(seconds * SR / Q);
  let q = -1;
  p.port.postMessage = o.refsOnly ? m => log.push({ q, F: p.frames, ref: m }) : m => log.push({ q, F: p.frames, ref: m, c: structuredClone(m) });
  const fo = fast ? Object.assign({ t: 'fastOn' }, sc.fast, fast) : null;
  if (fo && o.fastFirst) p.msg(fo);
  p.msg({ t: 'mon', ids: sc.mon });
  if (fo && !o.fastFirst) p.msg(fo);
  const out = [[new Float32Array(Q), new Float32Array(Q)]], L = new Float32Array(n * Q), R = new Float32Array(n * Q);
  const ev = new Map();
  for (const [k, m] of sc.events) { if (!ev.has(k)) ev.set(k, []); ev.get(k).push(m); }
  const input = sc.input ? sc.input() : () => [];
  for (q = 0; q < n; q++) {
    const e = ev.get(q);
    if (e) for (const m of e) p.msg(m);
    p.process(input(), out);
    D.ctx.currentFrame += Q;
    L.set(out[0][0], q * Q); R.set(out[0][1], q * Q);
    if (o.each) o.each(p, q, D);
  }
  return { D, p, log, L, R, n };
}
const bitsEqual = (a, b) => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;
const slowOf = log => log.filter(e => e.c.t !== 'fast' && e.c.t !== 'stats');
const fastOf = log => log.filter(e => (e.c || e.ref).t === 'fast');
// the part a message is about: fast {i | c | mc | m}; slow smon {i | c | mc} (a legacy smon carrying s / gr: 'leg'), mmon 'meters'
const partF = d => (d.i !== undefined ? d.i : d.c !== undefined ? d.c : d.mc !== undefined ? 'mods' : d.m !== undefined ? 'meters' : '?');
const partS = d => (d.t === 'mmon' ? 'meters' : d.i !== undefined ? d.i : d.c !== undefined ? d.c : d.mc !== undefined ? 'mods' : 'leg');
const same = (a, b) => Object.is(fr(a), fr(b));

// a fast message against the slow messages of the same F (by part) → mismatches; peaks: compare the PEAK fields too (hz 30)
function vsSlow(d, slow, ix, peaks) {
  const bad = [], id = partF(d), chk = (what, a, b) => { if (!same(a, b)) bad.push(`${id} F ${d.F} ${what}: ${a} vs ${b}`); };
  const arr = (what, A, o, B, n) => { for (let j = 0; j < n; j++) chk(what + '[' + j + ']', A[o + j], B[j]); };
  if (d.v !== undefined) {
    const s0 = slow.get(id) || slow.get('leg'), s = s0 && s0.s;
    if (!s) return [`${id} F ${d.F}: no slow snapshot`];
    const X = MOT.SXF;
    arr('wtPos', d.v, X.wtPos, s.wtPos, 3); arr('smpPos', d.v, X.smpPos, s.smpPos, 12);
    chk('noisePos', d.v[X.noisePos], s.noisePos); chk('notes', d.v[X.notes], s.notes);
    arr('lfoPh', d.v, X.lfoPh, s.lfoPh, 10); arr('lfoOut', d.v, X.lfoOut, s.lfoOut, 10); arr('lfoY', d.v, X.lfoY, s.lfoY, 10);
    arr('env', d.v, X.env, s.env, 4); arr('envStage', d.v, X.envStage, s.envStage, 4); arr('envT', d.v, X.envT, s.envT, 4);
    for (let j = 0; j < ix.length; j++) chk('eff@' + ix[j], d.v[SXN + j], s.eff[ix[j]]);
    if (peaks) arr('mix', d.v, X.mix, s.mix, 11);
    if (d.q !== undefined) arr('q', d.q, 0, s.seq, 16);
    if (d.gr !== undefined) { if (!s0.gr) bad.push(id + ': gr without a slow gr'); else arr('gr', d.gr, 0, s0.gr, d.gr.length); }
  } else if (d.e !== undefined) {
    const s0 = slow.get(id);
    if (!s0 || !s0.s || !s0.s.eff) return [`${id} F ${d.F}: no slow eff`];
    if (d.e.length !== s0.s.eff.length) bad.push(id + ': e length');
    arr('e', d.e, 0, s0.s.eff, d.e.length);
  } else if (d.mc !== undefined) {
    const s0 = slow.get('mods');
    if (!s0) return [`mods F ${d.F}: no slow mc`];
    arr('mc', d.mc, 0, s0.mc, 16); arr('x.ph', d.x, 0, s0.mcx.ph, 20); arr('x.env', d.x, 20, s0.mcx.env, 8);
  } else if (d.m !== undefined) {
    const s0 = slow.get('meters');
    if (!s0) return [`meters F ${d.F}: no mmon`];
    chk('corr', d.m[4], s0.corr); chk('m', d.m[5], s0.m); chk('s', d.m[6], s0.s);
    if (peaks) { chk('tpL', d.m[0], s0.tp[0]); chk('tpR', d.m[1], s0.tp[1]); chk('pkL', d.m[2], s0.pk[0]); chk('pkR', d.m[3], s0.pk[1]); }
  } else if (d.c !== undefined) {
    const s0 = slow.get(id) || (id === 'c0' ? slow.get('leg') : undefined);
    if (!s0) return [`${id} F ${d.F}: no slow part`];
    if (d.gr !== null) { if (!s0.gr) bad.push(id + ': gr without a slow gr'); else arr('gr', d.gr, 0, s0.gr, d.gr.length); }
    if (d.mo !== null) { if (!s0.mo) bad.push(id + ': mo without a slow mo'); else arr('mo', d.mo, 0, s0.mo, d.mo.length); }
  }
  return bad;
}
// the slow messages by F (posted inside process: q ≥ 0) → Map F → Map part → message
function slowByF(log) {
  const M = new Map();
  for (const e of slowOf(log)) {
    if (e.q < 0 || (e.c.t !== 'smon' && e.c.t !== 'mmon')) continue;
    if (!M.has(e.F)) M.set(e.F, new Map());
    M.get(e.F).set(partS(e.c), e.c);
  }
  return M;
}

const SCENES = [legacyScene, graphScene, masterScene];
const RUNS = new Map();                                     // (scene id → { off, on }) — the 120 Hz pair, rendered once
function pair(mk) {
  const sc = mk();
  if (!RUNS.has(sc.id)) RUNS.set(sc.id, { sc, off: render(sc, null), on: render(sc, { hz: 120 }) });
  return RUNS.get(sc.id);
}

/* ------------------------------------------------------------------ FR1b */
test('FR1b: with the fast lane on (120 Hz) the audio is bit-identical and every slow message is equal in order (stats left out) — legacy Serum, graphed Track, MASTER; fast off posts no fast message', () => {
  for (const mk of SCENES) {
    const { sc, off, on } = pair(mk);
    assert.equal(fastOf(off.log).length, 0, sc.id + ': fast off → no fast message');
    assert.ok(fastOf(on.log).length > 100, sc.id + ': fast posts (' + fastOf(on.log).length + ')');
    assert.ok(bitsEqual(off.L, on.L) && bitsEqual(off.R, on.R), sc.id + ': the audio bit-identical');
    let peak = 0; for (const x of on.L) if (Math.abs(x) > peak) peak = Math.abs(x);
    assert.ok(peak > 1e-3, sc.id + ': audible (' + peak + ')');
    const A = slowOf(off.log).map(e => e.c), B = slowOf(on.log).map(e => e.c);
    assert.equal(A.length, B.length, sc.id + ': as many slow messages');
    let first = -1;
    for (let k = 0; k < A.length && first < 0; k++) if (!isDeepStrictEqual(A[k], B[k])) first = k;
    assert.equal(first, -1, sc.id + ': slow message ' + first + ' differs (' + (first >= 0 ? A[first].t : '') + ')');
    assert.ok(A.filter(m => m.t === 'smon' || m.t === 'mmon').length > 60, sc.id + ': slow monitor posts');
  }
});

test('FR1b: every fast field equals its slow twin in a quantum where both post (v\'s positions / notes / LFO / ENV and eff at ix, gr, q; e; mc / x; mo; the master\'s corr / momentary / short-term)', () => {
  for (const mk of SCENES) {
    const { sc, on } = pair(mk), S0 = slowByF(on.log), ix = sc.fast.ix ? Object.values(sc.fast.ix)[0] : null;
    let pairs = 0;
    const bad = [], parts = new Set();
    for (const e of fastOf(on.log)) {
      const slow = S0.get(e.F);
      if (!slow) continue;
      const id = partF(e.c);
      if (!(slow.has(id) || (sc.id === 'legacy' && slow.has('leg')))) continue;
      pairs++; parts.add(id);
      bad.push(...vsSlow(e.c, slow, ix, false));
    }
    assert.deepEqual(bad.slice(0, 8), [], sc.id + ': fast ≡ slow');
    // (review 2, P3-1) a legacy Serum's own FX c0 (= the Serum's rack, I.rack = C.rack) posts nothing fast without ModCore offsets:
    // its GR rides i0's post (compared with the legacy smon's gr above)
    const want = sc.id === 'legacy' ? ['i0'] : sc.id === 'graph' ? ['fx1', 'i1', 'i2', 'mods'] : ['meters', 'mfx', 'mods'];
    assert.deepEqual([...parts].sort(), want, sc.id + ': every fast part met its slow twin');
    if (sc.id === 'legacy') {
      assert.equal(fastOf(on.log).filter(e => partF(e.c) === 'c0').length, 0, 'legacy: c0 posts nothing fast (P3-1: no GR twice)');
      assert.ok(fastOf(on.log).filter(e => partF(e.c) === 'i0').every(e => e.c.gr && e.c.gr.length === 8), 'legacy: every i0 post carries the rack\'s GR');
    }
    assert.ok(pairs >= 3 * want.length, sc.id + ': coinciding posts (' + pairs + ')');
  }
});

// A Serum's slow channel peaks (smon s.mix[0…7)) have one more restart than its slow posts, from before Cut B: Track.stats() (every
// 0.25 s) reads the voice count through Inst.sxVoices() → SerumDSP.snapshot(), which zeroes sx.pk. The fast lane's own sx.pkF is
// restarted by its posts alone, so where a stats post fell inside a slow interval the fast peaks are the superset (≥) — the slow lane
// lost that peak to stats, not to the fast lane. → (q0, q1) ↦ the latest stats quantum t with q0 ≤ t < q1, else q0
const statsCut = log => { const S = log.filter(e => e.c && e.c.t === 'stats').map(e => e.q); return (q0, q1) => { let r = q0; for (const t of S) if (t >= q0 && t < q1 && t > r) r = t; return r; }; };
test('FR1b: at hz 30 one fast post follows each slow post at the same F, and every field — the peaks too (mix, tp / pk) — equals its slow twin exactly (a Serum\'s channel peaks: ≥ where stats() restarted the slow ones, pre-Cut-B)', (t) => {
  for (const mk of SCENES) {
    const sc = mk(), r = render(sc, { hz: 30 }, { fastFirst: true, seconds: 2 });
    const slow = slowOf(r.log).filter(e => e.c.t === 'smon' || e.c.t === 'mmon'), fast = fastOf(r.log);
    const Fs = [...new Set(slow.map(e => e.F))], Ff = [...new Set(fast.map(e => e.F))];
    assert.deepEqual(Ff, Fs, sc.id + ': the fast posts at the slow posts\' frames');
    const ix = sc.fast.ix ? Object.values(sc.fast.ix)[0] : null, bad = [], cut = statsCut(r.log);
    const byF = new Map(), prevQ = new Map(), last = new Map();
    for (const e of slow) {
      if (!byF.has(e.F)) byF.set(e.F, new Map());
      const id = partS(e.c);
      byF.get(e.F).set(id, e.c);
      prevQ.set(e.F + ':' + id, last.has(id) ? last.get(id) : -1); last.set(id, e.q);
    }
    let cuts = 0, exact = 0;
    for (const e of fast) {
      const d = e.c, id = partF(d), sid = d.v !== undefined && !byF.get(e.F).has(id) ? 'leg' : id;
      if (d.v !== undefined) {
        const q0 = prevQ.get(e.F + ':' + sid), s = byF.get(e.F).get(sid).s;
        if (cut(q0, e.q) !== q0) {                                // (a stats restart inside: the slow peaks ≤ the fast ones; the rest exact)
          cuts++;
          for (let c = 0; c < 7; c++) if (!(d.v[c] >= s.mix[c])) bad.push(`${id} F ${e.F} mix[${c}] ${d.v[c]} < slow ${s.mix[c]}`);
          const v = Float32Array.from(d.v); for (let c = 0; c < 7; c++) v[c] = s.mix[c];
          bad.push(...vsSlow(Object.assign({}, d, { v }), byF.get(e.F), ix, true));
          continue;
        }
      }
      exact++;
      bad.push(...vsSlow(d, byF.get(e.F), ix, true));
    }
    t.diagnostic(`${sc.id} hz 30: ${exact} fast posts exact, ${cuts} Serum posts after a stats() restart of the slow channel peaks (fast ≥ slow there)`);
    assert.deepEqual(bad.slice(0, 8), [], sc.id + ': hz 30 — exact, peaks included');
    // each fast post right after its slow twins (one quantum, one F)
    for (let k = 0; k < r.log.length; k++) if (r.log[k].c.t === 'fast') assert.ok(k > 0 && r.log[k - 1].F === r.log[k].F, sc.id + ': in the same quantum');
  }
});

// the per-quantum block maxima (a probe render, fast off: after every quantum the test reads and clears the fast accumulators —
// a Serum's sx.pkF and Inst.mixPkF, the master meters' tF / pF; nothing posts from them)
function blockMax(sc) {
  const B = [];
  const r = render(sc, null, { each(p) {
    if (sc.master) { const M = p.M; B.push([M.tFL, M.tFR, M.pFL, M.pFR]); M.tFL = 0; M.tFR = 0; M.pFL = 0; M.pFR = 0; return; }
    const I = p.i0, a = Array.from(I.sx.pkF).concat(Array.from(I.mixPkF));
    I.sx.pkF.fill(0); I.mixPkF.fill(0);
    B.push(a);
  } });
  return { B, r };
}
test('FR1b: the peaks partition (§13 P2-6) — at 120 Hz each fast post\'s peak is the max of its quanta\'s block maxima, each slow post\'s the max of its own (a Serum\'s channel peaks from the last stats() restart, pre-Cut-B), and up to the last common post the fast maxima equal the true maxima — the slow ones too, but where stats() took a Serum channel peak (nothing stolen by the fast lane)', (t) => {
  for (const mk of [legacyScene, masterScene]) {
    const { sc, on } = pair(mk), { B, r } = blockMax(sc);
    assert.ok(bitsEqual(r.L, on.L), sc.id + ': the probe render is the same audio');
    const conv = sc.master ? (k, x) => fr(dBinf(x)) : (k, x) => fr(dB120(x)), W = B[0].length, cut = statsCut(on.log);
    const fastQ = fastOf(on.log).filter(e => partF(e.c) === (sc.master ? 'meters' : 'i0'));
    const slowQ = slowOf(on.log).filter(e => e.q >= 0 && (sc.master ? e.c.t === 'mmon' : e.c.t === 'smon' && e.c.s));
    const span = (q0, q1, k) => { let m = 0; for (let q = q0 + 1; q <= q1; q++) if (B[q][k] > m) m = B[q][k]; return m; };
    const bad = [];
    let prev = -1, cuts = 0;
    for (const e of fastQ) {
      for (let k = 0; k < W; k++) {
        const got = sc.master ? e.c.m[k] : e.c.v[k], want = conv(k, span(prev, e.q, k));
        if (!Object.is(got, want)) bad.push(`fast q ${e.q} [${k}]: ${got} vs ${want}`);
      }
      prev = e.q;
    }
    prev = -1;
    for (const e of slowQ) {
      const q0 = sc.master ? prev : cut(prev, e.q);                // (a Serum's sx.pk: restarted by stats() too)
      if (q0 !== prev) cuts++;
      for (let k = 0; k < W; k++) {
        const got = sc.master ? [e.c.tp[0], e.c.tp[1], e.c.pk[0], e.c.pk[1]][k] : e.c.s.mix[k];
        const want = sc.master ? dBinf(span(prev, e.q, k)) : fr(dB120(span(k < 7 ? q0 : prev, e.q, k)));
        if (!Object.is(got, want)) bad.push(`slow q ${e.q} [${k}]: ${got} vs ${want}`);
      }
      prev = e.q;
    }
    assert.deepEqual(bad.slice(0, 6), [], sc.id + ': each post = the max of its own quanta');
    const common = Math.max(...fastQ.map(e => e.q).filter(q => slowQ.some(s => s.q === q)));
    assert.ok(common > 200, sc.id + ': a common post late in the run (' + common + ')');
    for (let k = 0; k < W; k++) {
      const mf = Math.max(...fastQ.filter(e => e.q <= common).map(e => (sc.master ? e.c.m[k] : e.c.v[k])));
      const ms = Math.max(...slowQ.filter(e => e.q <= common).map(e => fr(sc.master ? [e.c.tp[0], e.c.tp[1], e.c.pk[0], e.c.pk[1]][k] : e.c.s.mix[k])));
      assert.ok(Object.is(mf, conv(k, span(-1, common, k))), `${sc.id} [${k}]: the fast run maximum ${mf} = the true one`);
      if (sc.master || k >= 7) assert.ok(Object.is(mf, ms), `${sc.id} [${k}]: the run maxima ${mf} vs ${ms}`);
      else assert.ok(mf >= ms, `${sc.id} [${k}]: fast ${mf} ≥ slow ${ms}`);
    }
    if (!sc.master) t.diagnostic(`${sc.id}: ${cuts} of ${slowQ.length} slow posts had a stats() restart of the channel peaks inside their interval`);
  }
});

test('FR1b: the cadence — 120 Hz: the first post at the end of the first quantum after fastOn, then the accumulator\'s 4, 3, 3, 3, 3, 3, 3, 3 quanta (48 kHz); hz 0 after a non-zero: none from the next quantum; non-finite hz → 0, > 120 clamped', () => {
  const { sc, on } = pair(graphScene), P = SR / 120, want = [];
  let acc = P;
  for (let q = 0; q < on.n; q++) { acc += Q; if (acc >= P) { acc -= P; want.push((q + 1) * Q); } }
  for (const id of ['i1', 'i2', 'fx1', 'mods']) assert.deepEqual(fastOf(on.log).filter(e => partF(e.c) === id).map(e => e.F), want, sc.id + ' ' + id + ': the 120 Hz posts');
  // (from fastAcc = fastP: the first post at q 0, then 3 × 8, a 4, … — the cycle 4, 3, 3, 3, 3, 3, 3, 3 of 25 quanta, mean 3.125)
  const gaps = want.slice(1).map((F, k) => (F - want[k]) / Q);
  assert.deepEqual([want[0], ...gaps.slice(0, 10)], [Q, 3, 3, 3, 3, 3, 3, 3, 3, 4, 3]);
  for (let k = 8; k + 8 <= gaps.length; k += 8) assert.deepEqual(gaps.slice(k, k + 8), [4, 3, 3, 3, 3, 3, 3, 3], 'the cycle at gap ' + k);
  // off mid-run, and the parameter rules
  const sc2 = legacyScene(), r = render(sc2, { hz: 120 }, { seconds: 1, each(p, q) { if (q === 100) p.msg({ t: 'fastOn', hz: 0, ids: ['i0'], ix: null, ixv: 4 }); } });
  const F = fastOf(r.log).map(e => e.F);
  assert.ok(F.length > 20 && Math.max(...F) <= 101 * Q, 'none after {hz: 0}');
  const T = render(sc2, null, { seconds: 0.01 }).p;
  for (const [h, hz] of [[NaN, 0], [Infinity, 0], [-3, 0], [0, 0], [500, 120], [0.4, 1], [60, 60]]) {
    T.msg({ t: 'fastOn', hz: h, ids: ['i0'], ix: null, ixv: 1 });
    assert.equal(T.fastHz, hz, 'hz ' + h);
  }
});

test('FR1b: the shapes — keys, lengths, F === the processor\'s frames at the post, k === ixv; a Serum\'s own FX id (iN/fx) posts nothing fast; the Serum message carries gr (its own rack has GR units) and q only with a sequencer', () => {
  for (const mk of SCENES) {
    const { sc, on } = pair(mk), bad = [], sq = !sc.master && !!on.p.insts[0].sxSeq;
    for (const e of fastOf(on.log)) {
      const d = e.c, keys = Object.keys(d).sort().join(','), id = partF(d);
      if (d.F !== e.F) bad.push(id + ': F ' + d.F + ' vs frames ' + e.F);
      if (d.v !== undefined) {
        if (keys !== (sq ? 'F,gr,i,k,q,t,v' : 'F,gr,i,k,t,v')) bad.push(id + ': keys ' + keys);
        if (d.v.length !== SXN + sc.fast.ix[id].length || d.k !== sc.fast.ixv) bad.push(id + ': v / k');
      } else if (d.e !== undefined) { if (keys !== 'F,e,i,t') bad.push(id + ': keys ' + keys); }
      else if (d.mc !== undefined) { if (keys !== 'F,mc,t,x' || d.mc.length !== 16 || d.x.length !== 28) bad.push(id + ': ' + keys); }
      else if (d.m !== undefined) { if (keys !== 'F,m,t' || d.m.length !== 7 || !(d.m instanceof Float32Array)) bad.push(id + ': ' + keys); }
      else if (keys !== 'F,c,gr,mo,t' || (d.gr === null && d.mo === null)) bad.push(id + ': ' + keys);
      if (id === 'i1/fx') bad.push('a Serum\'s own FX posted fast');
    }
    assert.deepEqual(bad.slice(0, 6), [], sc.id);
  }
  // the gr lengths: 4 · (the highest GR index + 1) — the legacy Serum's rack (cmp 0, duck 1) → 8; the panel (cmp 0) → 4
  const { on } = pair(legacyScene), { on: g } = pair(graphScene);
  assert.equal(fastOf(on.log).find(e => e.c.i === 'i0').c.gr.length, 8);
  assert.equal(fastOf(g.log).find(e => e.c.c === 'fx1').c.gr.length, 4);
  const mx = fastOf(pair(masterScene).on.log).find(e => e.c.c === 'mfx').c;
  assert.ok(mx.gr.length === 4 * 5 && mx.mo.length > 0, 'mfx: rack5\'s GR block (two compressors, the last at index 4) and its mo');
});

test('FR1b: no allocation per post — the message objects and their arrays are the same objects across posts (re-fetched each post), and 300 quanta of process with the fast lane on run under throwing constructors', () => {
  for (const mk of SCENES) {
    const { sc, on } = pair(mk), by = new Map();
    for (const e of fastOf(on.log)) { const id = partF(e.ref); if (!by.has(id)) by.set(id, []); by.get(id).push(e.ref); }
    for (const [id, L] of by) {
      const f = L[0];
      for (const m of L) {
        assert.ok(m === f, sc.id + ' ' + id + ': one message object');
        for (const k of ['v', 'gr', 'e', 'mc', 'x', 'm', 'mo']) if (m[k] !== undefined && m[k] !== null) assert.ok(m[k] === f[k], sc.id + ' ' + id + ': ' + k + ' the same array');
      }
    }
  }
  for (const mk of SCENES) {
    const sc = mk(), D = dspScope({ fast: true, engine: true, seed: 'fast-lane:alloc', console: quiet }), p = sc.make(D);
    let n = 0;
    p.port.postMessage = m => { if (m.t === 'fast') n++; };
    p.msg({ t: 'mon', ids: sc.mon }); p.msg(Object.assign({ t: 'fastOn', hz: 120 }, sc.fast));
    const out = [[new Float32Array(Q), new Float32Array(Q)]], input = sc.input ? sc.input() : () => [], ev = sc.events.filter(([k]) => k < 100);
    const step = q => { for (const [k, m] of ev) if (k === q) p.msg(m); p.process(input(), out); D.ctx.currentFrame += Q; };
    for (let q = 0; q < 100; q++) step(q);
    const n0 = n;
    noAlloc(D, () => { for (let q = 100; q < 400; q++) step(q); });
    const posting = sc.fast.ids.filter(x => x !== 'i1/fx' && !(sc.id === 'legacy' && x === 'c0')); // ((review 2, P3-1) a legacy Serum's c0: none)
    assert.ok(n - n0 >= 300 / 3.2 * posting.length * 0.9, sc.id + ': fast posts under throwing constructors (' + (n - n0) + ')');
  }
});

/* ------------------------------------------------------------------ review 2: the lane idles (P2-1) */
// a legacy Serum at rest (the default state: nothing moves without a voice) with its own FX compressor; a note at quantum `at`
function restScene(at) {
  const patch = patchFor('serum', { s: core.normalizeSerum(core.defaultSerum()) }, sxFx(false), PO);
  return {
    id: 'rest', mon: ['i0', 'c0'], fast: { ids: ['i0', 'c0'], ix: { i0: Int16Array.from([VI('f.cutoff')]) }, ixv: 2 }, events: at >= 0 ? [[at, { t: 'on', n: 60, v: 0.8 }]] : [],
    make(D) { const p = new D.Proc({ processorOptions: { os: 2, hostOS: 4, trackId: TID } }); p.msg({ t: 'patch', p: patch }); tables(p, patch); return p; },
  };
}
// a silent MASTER (a compressor, the meters, no ModCore payload); the bench noise from quantum `at`
function masterRest(at) {
  const fx = core.defaultFx2();
  fxInst(fx, 'cmp', { thr: Math.pow(10, -30 / 20), ratio: 4, att: 2, rel: 80 });
  const fxr = core.compileFx(fx, { bpm: 120, rate: SR }), fxrT = core.compileFxT(fx), ids = ['meters', 'mfx'];
  return {
    id: 'master-rest', master: true, mon: ids, fast: { ids }, events: [],
    input: () => { const noise = masterInput(), zero = [[new Float32Array(Q), new Float32Array(Q)]]; let q = 0; return () => (q++ >= at ? noise() : zero); },
    make(D) { const p = new D.procs['synth-master']({ processorOptions: {} }); p.msg({ t: 'chain', fxr, fxrT }); return p; },
  };
}
// the 120 Hz grid (the cadence test's accumulator): the frames of the checks
const grid120 = n => { const P = SR / 120, out = []; let acc = P; for (let q = 0; q < n; q++) { acc += Q; if (acc >= P) { acc -= P; out.push((q + 1) * Q); } } return out; };
const arrsOf = d => ['v', 'q', 'gr', 'e', 'mo', 'mc', 'x', 'm'].filter(k => d[k] != null).map(k => Array.from(d[k]));
test('review 2 (P2-1): the lane idles — a part whose payload holds posts once more (a flat last pair), then nothing; on its change the held values come first, stamped at the previous check\'s F, then the new ones at the frames of the post (a legacy Serum at rest until a note, a silent MASTER until noise); FR1b holds', () => {
  for (const [mk, at, parts] of [[restScene, 500, ['i0']], [masterRest, 260, ['meters', 'mfx']]]) {
    const sc = mk(at), off = render(sc, null, { seconds: 2 }), on = render(sc, { hz: 120 }, { seconds: 2 }), G = grid120(on.n);
    assert.ok(bitsEqual(off.L, on.L) && bitsEqual(off.R, on.R), sc.id + ': the audio bit-identical');
    const A = slowOf(off.log).map(e => e.c), B = slowOf(on.log).map(e => e.c);
    assert.ok(A.length === B.length && A.every((m, k) => isDeepStrictEqual(m, B[k])), sc.id + ': the slow messages equal in order');
    for (const id of parts) {
      const L = fastOf(on.log).filter(e => partF(e.c) === id), pre = L.filter(e => e.q < at), post = L.filter(e => e.q >= at);
      // at rest: the first post (the end of quantum 0) and its flat twin at the next check, then nothing
      assert.deepEqual(pre.map(e => e.c.F), G.slice(0, 2), sc.id + ' ' + id + ': two posts at rest, at the first two checks');
      assert.ok(isDeepStrictEqual(arrsOf(pre[0].c), arrsOf(pre[1].c)), sc.id + ' ' + id + ': the second one flat (the same values)');
      // the change: the held values at the previous check's F, posted in the quantum of the change, then the new values
      assert.ok(post.length > 20, sc.id + ' ' + id + ': posting again (' + post.length + ')');
      const h = post[0], nw = post[1], g = G.indexOf(nw.c.F);
      assert.ok(g > 2 && h.F === nw.F && nw.c.F === nw.F, sc.id + ' ' + id + ': the hold and the new post in one quantum, the new at its frames');
      assert.equal(h.c.F, G[g - 1], sc.id + ' ' + id + ': the hold stamped at the previous check (one fast period back)');
      assert.ok(nw.q - at <= 4, sc.id + ' ' + id + ': at the first check after the change (q ' + nw.q + ')');
      assert.ok(isDeepStrictEqual(arrsOf(h.c), arrsOf(pre[1].c)), sc.id + ' ' + id + ': the hold carries the held values');
      assert.ok(!isDeepStrictEqual(arrsOf(nw.c), arrsOf(h.c)), sc.id + ' ' + id + ': the new post differs');
      for (const e of post.slice(1)) assert.ok(e.c.F === e.F && G.includes(e.F), sc.id + ' ' + id + ': then on the 120 Hz grid at its frames');
      // a ring (the gap rule: sr) never brackets the pause: at rest HELD (the held values), across the change one fast period
      const d0 = arrsOf(pre[0].c).flat(), R = MOT.ring(d0.length, new Array(d0.length).fill(MOT.K.HOLD)), out = new Float64Array(d0.length), flat = d => Float64Array.from(arrsOf(d).flat());
      for (const e of pre.concat([h, nw])) R.push(e.c.F, flat(e.c), 0, SR);
      assert.equal(R.oldest(), h.c.F, sc.id + ' ' + id + ': the pause (> EXTRA_S) started the ring afresh at the hold');
      assert.ok(nw.c.F - h.c.F <= 4 * Q, sc.id + ' ' + id + ': the bracket across the change is one fast period');
    }
  }
});

test('FR1b: grF — null without a GR unit (a panel with an EQ and an fx row: {gr: null, mo}); grFast() copies grOut[0, 4·(hi + 1)); sized at the layout change only (a wipe / clear zeroes it, never resizes); SXF ≡ SerumDSP.FAST', () => {
  const sc = graphScene({ noGr: true }), r = render(sc, { hz: 120 }, { seconds: 0.5 }), fx1 = fastOf(r.log).filter(e => partF(e.c) === 'fx1');
  assert.ok(fx1.length > 20 && fx1.every(e => e.c.gr === null && e.c.mo !== null && e.c.mo.length > 0), 'a panel without a GR unit: gr null, mo posted');
  const D = dspScope({ files: ['sx-base.js', 'fx-mods2.js', 'fx-dsp.js'], fast: true, bare: true, console: quiet }), FX = D.global('FXDSP');
  const set = (rack, mk) => { const fx = core.defaultFx2(); mk(fx); rack.set(core.compileFx(fx, { bpm: 120, rate: SR }), core.compileFxT(fx)); };
  const rk = new FX.FXRack(SR);
  set(rk, fx => { fxInst(fx, 'eq', {}); fxInst(fx, 'rev', { mix: 0.3 }); });
  assert.equal(rk.grFast(), null, 'no GR unit: null');
  set(rk, fx => { fxInst(fx, 'eq', {}); fxInst(fx, 'rev', {}); fxInst(fx, 'cmp', { thr: 0.05, ratio: 4 }); });
  const g = rk.grFast();
  assert.ok(g && g.length === 12, 'a compressor at index 2 → 12 (' + (g && g.length) + ')');
  const L = new Float64Array(Q), R = new Float64Array(Q);
  for (let k = 0; k < 200; k++) { for (let i = 0; i < Q; i++) { L[i] = 0.5 * Math.sin((k * Q + i) / 7); R[i] = L[i]; } rk.process(L, R, Q); }
  const G1 = rk.grFast(), go = rk.gr();
  assert.ok(G1 === g && G1[8] !== 0, 'the same array, the compressor reducing');
  for (let j = 0; j < 12; j++) assert.equal(G1[j], go[j], 'a copy of grOut [' + j + ']');
  rk.reset(false);
  assert.ok(rk.grF === g && g.every(x => x === 0), 'clear: zeroed, not resized');
  rk.reset(true);
  assert.ok(rk.grF === g, 'wipe: not resized');
  set(rk, fx => { fxInst(fx, 'eq', {}); fxInst(fx, 'rev', {}); fxInst(fx, 'cmp', { thr: 0.05, ratio: 4 }); fxInst(fx, 'duck', {}); });
  assert.ok(rk.grFast() !== g && rk.grFast().length === 16, 'a layout change: resized (a Ducker at index 3)');
  // the shared layout table
  const SD = render(legacyScene(), null, { seconds: 0.01 }).D.global('SerumDSP');
  assert.ok(SD.FAST, 'SerumDSP.FAST');
  assert.deepEqual(Object.fromEntries(Object.entries(SD.FAST)), Object.fromEntries(Object.entries(MOT.SXF)), 'SXF ≡ FAST');
});

/* ------------------------------------------------------------------ §2.6 the impulse scratch */
test('§2.6 filterImpulse / SxFilt2.impulse with a scratch {out}: bit-identical responses (40 random parameter sets × every type, classic and Serum 2), the out array reused across calls (a new one when the length changes)', () => {
  const D = dspScope({ fast: true, console: quiet }), SD = D.global('SerumDSP'), F2 = D.global('SxFilt2');
  let r = 0x2545F491;
  const rnd = () => { r ^= r << 13; r ^= r >>> 17; r ^= r << 5; return (r >>> 0) / 4294967296; };
  const sc = { out: null }, s2 = { out: null }, NT = core.FILTERS.length;
  let n = 0, first = null;
  for (let type = 0; type < NT; type++) {
    for (let k = 0; k < 40; k++) {
      const fc = 20 * Math.pow(1000, rnd()), res = rnd(), drive = rnd(), vr = rnd(), x = rnd(), y = rnd(), len = k === 0 ? 4096 : 512;
      const pz = k % 3 === 0 ? Float64Array.from({ length: 12 }, () => rnd()) : null;
      const a = SD.filterImpulse(type, fc, res, drive, vr, SR, len, x, y, pz), b = SD.filterImpulse(type, fc, res, drive, vr, SR, len, x, y, pz, sc);
      assert.ok(b === sc.out && b.length === len, 'type ' + type + ': the scratch\'s out returned');
      assert.ok(bitsEqual(a, b), `type ${type} set ${k}: bit-identical`);
      if (k === 1) first = b; else if (k > 1) assert.ok(b === first, 'type ' + type + ': reused');
      n++;
    }
  }
  for (let t = F2.FIRST; t <= F2.LAST; t += 3) {
    const a = F2.impulse(t, 900, 0.5, 0.2, 0.3, SR, 1024, 0.2, 0.7), b = F2.impulse(t, 900, 0.5, 0.2, 0.3, SR, 1024, 0.2, 0.7, null, s2);
    assert.ok(b === s2.out && bitsEqual(a, b), 'SxFilt2 type ' + t);
  }
  assert.equal(n, NT * 40);
});

/* ------------------------------------------------------------------ G5′ the ring ≡ the worklet at Fh */
const LAG = 8;                                                   // quanta (21 ms: the bracketing anchors are there, as at Fh)
// a part's ring layout: kinds, TIME groups, the LIN / POS clamp, and which slots are PEAK (skipped)
function layoutOf(part, d, sc) {
  const K = MOT.K;
  if (part === 'v') {
    const n = d.length - SXN, k = Array.from(MOT.SXF_K).concat(new Array(n).fill(K.LIN));
    return { k, g: Array.from(MOT.SXF_G).concat(new Array(n).fill(-1)), lo: Array.from(MOT.SXF_LO).concat(new Array(n).fill(0)), hi: Array.from(MOT.SXF_HI).concat(new Array(n).fill(1)) };
  }
  if (part === 'gr') return { k: Array.from(MOT.grKinds(sc.units)) };
  if (part === 'x') return { k: [...new Array(10).fill(K.PH), ...new Array(10).fill(K.LIN), ...new Array(4).fill(K.HOLD), ...new Array(4).fill(K.TIME)], g: [...new Array(24).fill(-1), 20, 21, 22, 23] };
  if (part === 'm') return { k: Array.from(MOT.MASTER_K), lo: Array.from(MOT.MASTER_LO), hi: Array.from(MOT.MASTER_HI) };
  return { k: new Array(d.length).fill(K.LIN) };
}
test('G5′ (node): the 120 Hz posts in motion.js rings, read at every quantum end over 4 s against the Track\'s own reads after every quantum — HOLD exact, PH / TIME / POS within 1e-6 between anchors, curved fields within the truth\'s chord bound (≤ 2e-3 for the LFOs ≤ 2 Hz), discontinuities within one anchor interval; EXTRA recorded', (t) => {
  const sc = graphScene(), units = {
    'i1.gr': core.fxLayout(sc.fxS).inst.map((I, idx) => ({ idx, type: I.type })), 'fx1.gr': core.fxLayout(sc.fxP).inst.map((I, idx) => ({ idx, type: I.type })) };
  const truth = new Map(), FIELDS = ['v', 'gr', 'e', 'mo', 'mc', 'x'];
  const r = render(sc, { hz: 120 }, { seconds: 4, each(p, q) {
    const T = p.fastRead();
    for (const id of Object.keys(T)) for (const f of FIELDS) { const a = T[id][f]; if (a && a.length) { const k = id + '.' + f; if (!truth.has(k)) truth.set(k, []); truth.get(k)[q] = Float32Array.from(a); } }
  } });
  assert.deepEqual([...truth.keys()].sort(), ['fx1.gr', 'fx1.mo', 'i1.gr', 'i1.v', 'i2.e', 'mods.mc', 'mods.x'], 'the truth for every part / field');
  const rings = new Map(), anchors = new Map(), K = MOT.K;
  for (const e of fastOf(r.log)) {
    const d = e.c, id = partF(d);
    for (const f of FIELDS) {
      const a = d[f];
      if (!a || !a.length) continue;
      const k = id + '.' + f;
      if (!rings.has(k)) {
        const L = layoutOf(f, a, { units: units[k] });
        rings.set(k, { R: MOT.ring(a.length, L.k, { n: 1024, groups: L.g, lo: L.lo, hi: L.hi }), L, out: new Float64Array(a.length) });
        anchors.set(k, []);
      }
      rings.get(k).R.push(d.F, a);
      anchors.get(k).push(e.q);
      // a post is the read at its own quantum (every field but the peaks)
      const T = truth.get(k)[e.q], Lk = rings.get(k).L.k;
      for (let j = 0; j < a.length; j++) if (Lk[j] !== K.PEAK && !Object.is(fr(a[j]), T[j])) assert.fail(`${k}[${j}] at q ${e.q}: posted ${a[j]} vs read ${T[j]}`);
    }
  }
  // the reads: every quantum end Fh (LAG quanta behind the newest post: bracketed), the ring at Fh against the truth at Fh. The
  // ≤ 2 Hz bound leaves out the brackets with a discontinuity the truth itself shows — an ENV stage or the gate count changing
  // (a note-on / -off; a voice ending: the snapshot reads the recent voice's LFO / eff, frozen once it stops)
  const TV = truth.get('i1.v'), X = MOT.SXF, MARK = [X.envStage, X.envStage + 1, X.envStage + 2, X.envStage + 3, X.notes];
  const nearNote = (qa, qb) => { for (let q = Math.max(1, qa - 1); q <= qb + 1 && q < TV.length; q++) for (const j of MARK) if (TV[q][j] !== TV[q - 1][j]) return true; return false; };
  const st = { hold: 0, lin: 0, curved: 0, disc: 0, linErr: 0, curvedErr: 0, bad: [], b2: 0 };
  // the fields under the LFOs ≤ 2 Hz: lfoOut 1 / 2 (0.5 / 2 Hz) and their rows' eff (cutoff, res: ix positions 1, 2)
  const slow2 = new Set([MOT.SXF.lfoOut, MOT.SXF.lfoOut + 1, SXN + 1, SXN + 2]);
  for (const [k, { R, L, out }] of rings) {
    const A = anchors.get(k), Tq = truth.get(k);
    let ai = 0;
    for (let qh = A[0]; qh < r.n - LAG; qh++) {
      while (ai + 1 < A.length && A[ai + 1] <= qh) ai++;
      if (ai + 1 >= A.length) break;
      const qa = A[ai], qb = A[ai + 1], s = R.at((qh + 1) * Q, out, SR);
      if (s !== MOT.ST.BRACKET && s !== MOT.ST.EXACT) { st.bad.push(k + ': status ' + s + ' at q ' + qh); continue; }
      const T = Tq[qh], kq = qb - qa;
      for (let j = 0; j < out.length; j++) {
        const kind = L.k[j], x = out[j], y = T[j];
        if (kind === K.PEAK) continue;
        if (kind === K.HOLD) { st.hold++; if (!Object.is(fr(x), Tq[qa][j])) st.bad.push(`${k}[${j}] HOLD q ${qh}: ${x} vs ${Tq[qa][j]}`); continue; }
        if (kind === K.LIN) {
          let m2 = 0;
          for (let q = qa + 1; q < qb; q++) { const d2 = Math.abs(Tq[q + 1][j] - 2 * Tq[q][j] + Tq[q - 1][j]); if (d2 > m2) m2 = d2; }
          const bound = m2 * kq * kq / 8, err = Math.abs(x - y);
          st.curved++;
          if (err > bound + 1e-6 * Math.max(1, Math.abs(y))) st.bad.push(`${k}[${j}] LIN q ${qh}: |${x} − ${y}| > ${bound}`);
          if ((k === 'i1.v' || k === 'mods.mc' || k === 'mods.x') && !nearNote(qa, qb) && err > st.curvedErr) st.curvedErr = err; // (normalised, away from a discontinuity)
          if (k === 'i1.v' && slow2.has(j) && !nearNote(qa, qb) && bound > st.b2) st.b2 = bound;
          continue;
        }
        // PH / TIME / POS: linear in F between the anchors, unless the truth has a discontinuity inside the bracket (counted)
        const wrap = kind === K.PH ? z => z - Math.round(z) : z => z;
        let disc = false;
        for (let q = qa + 1; q < qb; q++) if (Math.abs(wrap(wrap(Tq[q + 1][j] - Tq[q][j]) - wrap(Tq[q][j] - Tq[q - 1][j]))) > 1e-5) disc = true;
        if (kind === K.TIME && L.g && L.g[j] >= 0 && Tq[qa][L.g[j]] !== Tq[qb][L.g[j]]) disc = true;
        if (kind === K.POS && !(Tq[qa][j] >= 0 && Tq[qa][j] <= Tq[qb][j])) disc = true;
        if (disc) { st.disc++; continue; }
        st.lin++;
        const err = Math.abs(wrap(x - y));
        if (err > 1e-6) st.bad.push(`${k}[${j}] kind ${kind} q ${qh}: ${x} vs ${y}`);
        if (err > st.linErr) st.linErr = err;
      }
    }
  }
  t.diagnostic(`G5′: ${st.hold} HOLD reads exact, ${st.lin} PH / TIME / POS reads (max err ${st.linErr.toExponential(2)}), ${st.curved} curved reads (the normalised fields' max err away from a discontinuity ${st.curvedErr.toExponential(2)}), ${st.disc} reads in brackets with a discontinuity (one anchor interval each, skipped), the chord bound under the LFOs ≤ 2 Hz ${st.b2.toExponential(2)}`);
  assert.deepEqual(st.bad.slice(0, 8), [], 'G5′ reads');
  assert.ok(st.hold > 5000 && st.lin > 5000 && st.curved > 5000, 'every class checked');
  assert.ok(st.b2 > 0 && st.b2 <= 2e-3, 'the chord bound under the LFOs ≤ 2 Hz (normalised): ' + st.b2);
  assert.ok(st.disc < 0.05 * st.lin, 'discontinuities are rare (' + st.disc + ')');
  // EXTRA past the newest (recorded, not gated): a ring of the anchors up to F_a, read 10 / 50 / 250 ms later, against the truth there
  // — the Serum's LFO outputs (0.5 / 2 / 8 Hz sines) and the canvas LFO (BPM 1/4 at 128: 2.13 Hz), probes without a discontinuity
  const ex = [];
  for (const ms of [10, 50, 250]) {
    const errs = [[], [], [], []];
    for (const [k, J] of [['i1.v', [MOT.SXF.lfoOut, MOT.SXF.lfoOut + 1, MOT.SXF.lfoOut + 2]], ['mods.mc', [0]]]) {
      const A = anchors.get(k), Tq = truth.get(k), L = rings.get(k).L, w = Tq[A[0]].length;
      for (let a = 20; a < A.length - 120; a += 7) {
        const qx = A[a] + Math.round(ms / 1000 * SR / Q);
        if (ms < 250 && nearNote(A[a], qx)) continue;           // (250 ms: every probe — a note event always falls inside)
        const R = MOT.ring(w, L.k, { groups: L.g, lo: L.lo, hi: L.hi }), out = new Float64Array(w);
        for (let b = Math.max(0, a - 8); b <= a; b++) R.push((A[b] + 1) * Q, Tq[A[b]]);
        const s = R.at((qx + 1) * Q, out, SR);
        assert.ok(s === MOT.ST.EXTRA || (ms === 250 && s === MOT.ST.HELD), k + ' ' + ms + ' ms: status ' + s);
        J.forEach((j, n) => errs[k === 'mods.mc' ? 3 : n].push(Math.abs(out[j] - Tq[qx][j])));
      }
    }
    const fmt = e => { const s = e.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1].toExponential(1) + ' / ' + s[s.length - 1].toExponential(1) : '-'; };
    ex.push(`${ms} ms: ${['0.5 Hz', '2 Hz', '8 Hz', 'canvas 2.13 Hz'].map((h, n) => h + ' ' + fmt(errs[n])).join(', ')}`);
  }
  t.diagnostic('G5′ EXTRA (|err| past the newest anchor, median / max): ' + ex.join(' · '));
});

test('G5′ (node): the master\'s meters — PEAK: the max over the anchors drained by F_q equals a reference MASTERDSP.Meters fed MASTER\'s output and peeked every quantum, over the same frames; corr / momentary / short-term within the truth\'s chord bound', (t) => {
  // MASTER's output (what its own meters push: no transport, no restart) into a reference Meters of the same scope, peeked every
  // quantum; the truth (fastRead) every quantum; the 120 Hz posts into a MASTER_K ring read LAG quanta behind
  const sc = masterScene(), D = dspScope({ fast: true, engine: true, seed: 'fast-lane:' + sc.id, console: quiet }), p = sc.make(D), MD = D.global('MASTERDSP');
  const RM = new MD.Meters(SR), pk = new Float32Array(7), log = [];
  p.port.postMessage = m => { if (m.t === 'fast' && m.m) log.push({ q: p.frames / Q - 1, m: Float32Array.from(m.m) }); };
  p.msg({ t: 'mon', ids: sc.mon }); p.msg(Object.assign({ t: 'fastOn', hz: 120 }, sc.fast));
  const out = [[new Float32Array(Q), new Float32Array(Q)]], n = Math.round(4 * SR / Q), B = [], T = [], input = sc.input();
  for (let q = 0; q < n; q++) {
    p.process(input(), out);
    D.ctx.currentFrame += Q;
    RM.push(out[0][0], out[0][1], Q, 0);
    RM.peek(pk); B.push(Array.from(pk.subarray(0, 4)));
    T.push(Float32Array.from(p.fastRead().meters.m));
  }
  const R = MOT.ring(7, MOT.MASTER_K, { n: 1024, lo: MOT.MASTER_LO, hi: MOT.MASTER_HI }), o7 = new Float64Array(7), bad = [];
  let li = 0, drained = 0, curved = 0, lastQ = -1, ai = -1;
  for (let qh = 0; qh < n - LAG; qh++) {
    while (li < log.length && log[li].q <= qh + LAG) { R.push((log[li].q + 1) * Q, log[li].m); li++; }
    while (ai + 1 < log.length && log[ai + 1].q <= qh) ai++;
    const s = R.at((qh + 1) * Q, o7, SR);
    if (s !== MOT.ST.BRACKET && s !== MOT.ST.EXACT) continue;
    const qa = log[ai].q, qb = log[ai + 1].q;
    if (R.drained) {                                            // (drained: the anchor at qa — its frames (the previous drained one, qa])
      for (let k = 0; k < 4; k++) {
        let m = -Infinity; for (let x = lastQ + 1; x <= qa; x++) if (B[x][k] > m) m = B[x][k];
        if (!Object.is(fr(o7[k]), fr(m))) bad.push(`PEAK[${k}] q ${qh}: ${o7[k]} vs ${m}`);
      }
      lastQ = qa; drained++;
    }
    for (let j = 4; j < 7; j++) {                               // (LIN; the LUFS steps at each 100 ms sub-block end: the truth's chord bound)
      const y = T[qh][j];
      if (!Number.isFinite(y) || !Number.isFinite(T[qa][j]) || !Number.isFinite(T[qb][j])) continue;
      let m2 = 0; for (let x = qa + 1; x < qb; x++) { const d2 = Math.abs(T[x + 1][j] - 2 * T[x][j] + T[x - 1][j]); if (d2 > m2) m2 = d2; }
      const bound = m2 * (qb - qa) * (qb - qa) / 8;
      curved++;
      if (Math.abs(o7[j] - y) > bound + 1e-6 * Math.max(1, Math.abs(y))) bad.push(`[${j}] q ${qh}: ${o7[j]} vs ${y} (bound ${bound})`);
    }
  }
  t.diagnostic(`G5′ master: ${drained} PEAK reads drained an anchor (each = the reference meter over its frames), ${curved} corr / M / S reads`);
  assert.deepEqual(bad.slice(0, 8), [], 'the master\'s meters at Fh');
  assert.ok(drained > 400 && curved > 1000, drained + ' / ' + curved);
});

/* ------------------------------------------------------------------ G8 (node) */
test('G8 (node): the fast lane\'s cost — fast-sx / fast-fx / fast-master (tests/bench-scenarios.mjs, the posts cloned as a port would): on − off as paired interleaved medians (≥ 9 pairs) with an A/A pair; Δ ≤ max(0.002, 2 × the A/A spread)', (t) => {
  const D = dspScope({ fast: true, engine: true, console: quiet });
  const mkMaster = (po, bare) => { const m = D.ctx.MASTERDSP; if (bare) D.ctx.MASTERDSP = null; try { return new D.procs['synth-master']({ processorOptions: po }); } finally { D.ctx.MASTERDSP = m; } };
  const env = { mk: po => new D.Proc({ processorOptions: po }), advance: n => { D.ctx.currentFrame += n; }, FXDSP: D.global('FXDSP'), SxBase: D.global('SxBase'), mkMaster };
  const rows = scenarios().filter(s => /^fast-/.test(s.id));
  assert.deepEqual(rows.map(s => s.id), ['fast-sx', 'fast-fx', 'fast-master']);
  const rec = [];
  for (const s of rows) {
    let best = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const m = measureFast(s, env, { pairs: 9, seconds: 1 });
      const gate = Math.max(0.002, 2 * m.spread);
      if (!best || m.d - gate < best.d - best.gate) best = Object.assign(m, { gate, attempt });
      if (best.d <= best.gate) break;
    }
    rec.push(`${s.id} Δ ${best.d.toFixed(5)} (on ${best.on.toFixed(4)}, A/A ${best.aa.toFixed(5)}, spread ${best.spread.toFixed(5)}, gate ${best.gate.toFixed(4)}, posts ${best.posts}/s, attempt ${best.attempt})`);
    assert.ok(best.posts >= 110, s.id + ': the fast lane posts (' + best.posts + ' a second a part)');
    assert.ok(best.d <= best.gate, s.id + ': Δ ' + best.d + ' > ' + best.gate);
  }
  t.diagnostic('G8 node: ' + rec.join(' · '));
});
