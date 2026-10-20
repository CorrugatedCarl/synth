// The Track / Inst / Chain engine (SPEC-canvas §6.2–6.4, §6.8, §10 1d): the structure every path builds, the
// compatibility facade (fields, methods, overrides through it), the hosts the voice code sees (only Inst objects), the
// stats per Inst / Chain, the monitor subscriptions by id ({t: 'mon', ids}), the idle skip per Inst and per Track, and
// the warm-up's restore. Stage 1e (IMPL-1e §2, §7): several Insts per track — adoption of i0 / c0 by the first graph,
// the copy-first sum, the co-resident sequencer bound, salts, power (sequencers, clicks, load, controller state, restrike),
// zones, MIDI OUT into a graph node, stats.per / smon / fxph / fxtap / fxover per part, removal, processorOptions = messages,
// the warmed graph paths, row r. Bit-exactness against the pre-split engine: tests/golden-graph.test.mjs. Stage 7a (IMPL-7a
// §12.5, lane E): the drum family — Inst kind 'drums' (patch / processorOptions, the warm-up's restore, a graph node, power,
// the co-resident span grid, the OS fade, a cable on drum.bdd, kind changes and their sequencers, panic, #34, no allocation)
// and the bench rows d8p / d8x / d8m / d8s and d8i through the CPU gate.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dspScope, noAlloc } from './dsp-scope.mjs';
import * as core from '../serum-core.js?v=9';
import * as W from '../wt.js?v=9';
import { patchFor, MODELS } from '../models.js?v=9';
import * as CPU from './cpu-gate.mjs';
import * as DC from '../drum-core.js?v=9';

const SR = 48000;
const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
const tables = (p, patch) => { for (const id of patch.needs || []) if (/^(factory|noise):/.test(id)) p.msg(Object.assign({ t: 'wt' }, id.startsWith('noise:') ? W.makeNoise(id) : W.makeEntry(id, W.factoryTable(id)))); };
const classic = (id, fx) => { const m = MODELS.find(x => x.id === id); return patchFor(m, Object.fromEntries(m.controls.map(c => [c.id, c.def])), fx || core.defaultFx2(), { sr: SR, bpm: 120 }); };
const serum = (edit, fx) => { const s = core.defaultSerum(); if (edit) edit(s); return patchFor('serum', { s: core.normalizeSerum(s) }, fx || core.defaultFx2(), { sr: SR, bpm: 120, prefs: { smooth: 1, silenceTails: 1 } }); };
// a reverb on the track's rack (the FX scenarios' recipe)
// an EQ panel turned down (level 0.1 normalized: ≈ −27 dB)
function quietEq() {
  const fx = core.defaultFx2(), id = core.newInstance(fx, 'eq', { rack: 0 });
  fx.racks[0].mods.find(x => x.id === id).p.level = 0.1;
  return fx;
}
function verb() {
  const fx = core.defaultFx2(), id = core.newInstance(fx, 'rev', { rack: 0 }), I = fx.racks[0].mods.find(x => x.id === id);
  I.p.mix = 0.5;
  return fx;
}
function mk(D, po = {}, patch = null) {
  const p = new D.Proc({ processorOptions: Object.assign({ os: 2, hostOS: 4 }, po) }), sent = [];
  p.port.postMessage = m => sent.push(m);
  if (patch) { p.msg({ t: 'patch', p: patch }); tables(p, patch); }
  return { p, sent };
}
const out = () => [[new Float32Array(128), new Float32Array(128)]];
function run(D, p, quanta, o = out()) { for (let k = 0; k < quanta; k++) { p.process([], o); D.ctx.currentFrame += 128; } return o; }

test('structure: the processor is a Track with one Inst (i0) into one Chain (c0); the Inst shares the rack, the transport and the output buffers', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p } = mk(D, { trackId: 'a', offline: true }, classic('prophet5'));
  assert.equal(p.constructor.name, 'Track');
  assert.equal(p.i0.constructor.name, 'Inst');
  assert.equal(p.c0.constructor.name, 'Chain');
  assert.deepEqual([p.insts.length, p.chains.length, p.insts[0] === p.i0, p.chains[0] === p.c0], [1, 1, true, true]);
  assert.deepEqual([p.i0.id, p.c0.id], ['i0', 'c0']);
  assert.ok(p.c0.rack && p.i0.rack === p.c0.rack && p.i0.fxc === p.c0, 'one rack, shared by reference');
  assert.ok(p.i0.T === p && p.i0.tp === p.tp && p.i0.port === p.port, 'transport and port by reference');
  assert.ok(p.Lb === p.i0.Lb && p.Rb === p.i0.Rb, 'the output stage works on the Inst\'s buffers (one Inst: in place)');
  const PROCS = D.run('PROCS', 'procs.js');
  assert.ok(PROCS.get('a') === p && p.procs === PROCS && p.i0.procs === PROCS, 'the MIDI OUT registry holds the Track; the Inst reads it (SxSeq)');
  p.msg({ t: 'bye' });
  assert.ok(!PROCS.has('a') && p.procs === null && p.i0.procs === null && p.ending === 1);
  // a model change keeps the Chain (and its rack): tails survive, as before the split
  const { p: q } = mk(D, { offline: true }, classic('juno60'));
  const r = q.c0.rack;
  q.msg({ t: 'patch', p: serum() }); q.msg({ t: 'patch', p: classic('minimoog') });
  assert.ok(q.c0.rack === r && q.i0.rack === r);
});

test('the facade: Inst 0\'s fields and methods through the processor (reads, writes, overrides), the first Chain\'s rack; the Track\'s own fields stay its own', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p } = mk(D, { offline: true }, serum());
  const I = p.i0;
  for (const k of ['voices', 'kind', 'sx', 'OS', 'p', 'sxSeq', 'sxMask', 'div', 'act', 'quietF', 'sxW', 'fadeN', 'mpe', 'seqMacro', 'osPend']) assert.ok(p[k] === I[k], k);
  assert.equal(p.kind, 'serum');
  assert.ok(p.rack === p.c0.rack);
  assert.equal(p.bpm, I.bpm, 'getters too');
  p.quietF = 1234; assert.equal(I.quietF, 1234, 'writes reach Inst 0');
  assert.equal(p.anyActive(), I.anyActive());
  assert.equal(p.sxLazy(), I.sxLazy());
  const F = Object.getPrototypeOf(Object.getPrototypeOf(p));
  for (const k of ['spanF', 'tp', 'Lb', 'Rb', 'mon', 'pnN', 'frames', 'msg', 'noteOn', 'noteOff', 'process', 'outStage', 'panic']) assert.ok(!Object.prototype.hasOwnProperty.call(F, k), k + ': the Track\'s own');
  // rack through the facade: both the Chain and the Inst
  const r = p.rack; p.rack = null; assert.ok(p.c0.rack === null && I.rack === null); p.rack = r;
  // an override set through the facade reaches the Inst's own callers (SxSeq calls proc.sxNote): tests/integration's tapNotes
  const { p: A } = mk(D, { offline: true }, serum(s => { s.p['arp.on'] = 1; }));
  assert.equal(A.sqOn, 1);
  const log = [], o = A.sxNote.bind(A);
  A.sxNote = (on, n, v, ch, x, y, z, gen) => { log.push([A.spanF, on, n, gen]); return o(on, n, v, ch, x, y, z, gen); };
  A.msg({ t: 'on', n: 60, v: 0.8 }); A.msg({ t: 'on', n: 64, v: 0.8 });
  run(D, A, 400);
  assert.ok(log.filter(e => e[3] === 1 && e[1] === 1).length >= 4, 'the arpeggiator\'s generated notes pass the override');
  assert.ok(log.every(e => Number.isFinite(e[0])), 'spanF: the Track\'s span frame');
});

test('hosts: only Inst objects reach the voices, the divider, SerumDSP, SxSeq (monomorphic property loads in every path)', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  for (const m of ['prophet5', 'dx7', 'solina']) {
    const { p } = mk(D, { offline: true }, classic(m));
    p.msg({ t: 'on', n: 60, v: 0.8 });
    run(D, p, 4);
    if (p.i0.kind === 'divide') assert.ok(p.i0.div.e === p.i0, m);
    else assert.ok(p.i0.voices.length && p.i0.voices.every(v => v.e === p.i0), m);
  }
  const { p } = mk(D, { offline: true }, serum(s => { s.p['arp.on'] = 1; }));
  p.msg({ t: 'on', n: 60, v: 0.8 });
  run(D, p, 4);
  assert.ok(p.i0.voices.length && p.i0.voices.every(v => v.proc === p.i0), 'SerumVoice.proc');
  assert.ok(p.i0.sxSeq && p.i0.sxSeq.proc === p.i0, 'SxSeq.proc');
});

test('stats per Inst / Chain: {t: stats, load, voices, os, per: [{id: i0, load, voices, os}, {id: c0, load}]} — the Chain its own processing time, the Inst the rest', () => {
  const D = dspScope({ engine: true, console: quiet });
  let clock = 0; // the scope's Date.now: a clock the test advances (1 ms per rack call, 2 per Inst span)
  D.run('(function (f) { Date.now = function now() { return f(); }; })', 'clock.js')(() => clock);
  for (const [name, patch] of [['prophet5', classic('prophet5', verb())], ['serum', serum(null, verb())]]) {
    const { p, sent } = mk(D, { offline: true, os: 2 }, patch);
    const r = p.c0.rack, rp = r.process, IR = Object.getPrototypeOf(p.i0).renderSpan;
    r.process = function (...a) { clock += 1; return rp.apply(this, a); };
    p.i0.renderSpan = function (n) { clock += 2; return IR.call(this, n); };
    for (const n of [48, 52, 55]) p.msg({ t: 'on', n, v: 0.8 });
    run(D, p, 200);
    const st = sent.filter(m => m.t === 'stats');
    assert.equal(st.length, 2, name + ': every 0.25 s of audio');
    for (const m of st) {
      assert.deepEqual(Object.keys(m).sort(), ['load', 'os', 'per', 't', 'voices'], name);
      assert.equal(m.per.length, 2);
      const [i, c] = m.per;
      assert.deepEqual([i.id, c.id, i.os, i.voices, Object.keys(c).sort().join()], ['i0', 'c0', m.os, m.voices, 'id,load'], name);
      assert.ok(Math.abs(c.load - m.load / 3) < 1e-9 && Math.abs(i.load - 2 * m.load / 3) < 1e-9, `${name}: ${i.load} + ${c.load} = ${m.load} (2 : 1)`);
    }
    assert.equal(st[0].voices, name === 'serum' ? p.i0.sxVoices() : 3, name + ': the Inst\'s voices');
    assert.equal(st[0].os, p.i0.OS);
  }
});

test('{t: mon, ids}: snapshots of the parts on screen only — Inst i0 (Serum snapshot, sx.mon), Chain c0 (the rack\'s meters); smon = every part', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p, sent } = mk(D, { offline: true }, serum(null, verb()));
  p.msg({ t: 'on', n: 60, v: 0.8 });
  const mons = (msg, quanta = 40) => { sent.length = 0; if (msg) p.msg(msg); run(D, p, quanta); return sent.filter(m => m.t === 'smon'); };
  let s = mons({ t: 'mon', ids: ['c0'] });
  assert.ok(s.length >= 3 && s.every(m => m.s === null && m.gr !== null && m.fxph != null), 'the FX module alone: meters, no snapshot');
  assert.deepEqual([p.mon, p.i0.mon, p.c0.mon, p.i0.sx.mon], [true, false, true, 0]);
  s = mons({ t: 'mon', ids: ['i0'] });
  assert.ok(s.length >= 3 && s.every(m => m.s && m.gr === null && m.fxph === null), 'the Serum module alone: its snapshot');
  assert.deepEqual([p.i0.mon, p.c0.mon, p.i0.sx.mon], [true, false, 1]);
  s = mons({ t: 'mon', ids: ['i0', 'c0'] });
  assert.ok(s.length >= 3 && s.every(m => m.s && m.gr !== null));
  assert.equal(mons({ t: 'mon', ids: [] }).length, 0, 'none on screen: nothing posted');
  assert.deepEqual([p.mon, p.i0.sx.mon], [false, 0]);
  s = mons({ t: 'smon', on: true });
  assert.ok(s.length >= 3 && s.every(m => m.s && m.gr !== null), 'smon (legacy): every part');
  assert.equal(mons({ t: 'smon', on: false }).length, 0);
  // ~33 ms of audio apart (40 quanta = 107 ms: the first at the subscription, then every 12.4 quanta)
  assert.ok(mons({ t: 'mon', ids: ['c0'] }, 40).length <= 5);
});

test('idle skip (§6.4): per Inst quietF; once the Inst is quiet for 2 s with its FX idle the Track skips the span — no panicFade, no output stage; a panic fade keeps it rendering', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p } = mk(D, { offline: true, os: 4 }, classic('prophet5'));
  let outs = 0;
  const o0 = p.outStage;
  p.outStage = function (...a) { outs++; return o0.apply(this, a); };
  p.msg({ t: 'on', n: 60, v: 0.8 }); run(D, p, 40); p.msg({ t: 'off', n: 60 });
  run(D, p, Math.ceil(5 * SR / 128));
  assert.ok(p.i0.quietF > 2 * SR && p.i0.act === 0);
  outs = 0;
  const dc = Array.from(p.dcy), o = run(D, p, 50);
  assert.equal(outs, 0, 'no output stage while idle');
  assert.ok(o[0][0].every(x => x === 0) && o[0][1].every(x => x === 0), 'silent');
  assert.deepEqual(Array.from(p.dcy), dc, 'the DC block state frozen');
  p.pnN = p.pnM; // (a panic fade in progress: the Track's — the Inst renders on)
  run(D, p, 1);
  assert.equal(outs, 1); assert.equal(p.i0.quietF, 0);
  run(D, p, 4);
  assert.equal(p.pnN, 0, 'the fade ran out and cleared');
  p.msg({ t: 'on', n: 64, v: 0.8 }); outs = 0; run(D, p, 2);
  assert.equal(outs, 2, 'a note: the output stage runs again');
});

test('§9.2: a quiet instrument costs ≤ 0.0005 load once its tails end (the skip path; calibrated, classic and Serum)', async (t) => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  for (const [name, patch] of [['prophet5', classic('prophet5')], ['serum', serum()]]) {
    const { p } = mk(D, { trackId: 'q' + name }, patch), o = out();
    const sec = () => run(D, p, SR / 128, o);
    sec(); sec(); sec();
    assert.ok(p.i0.quietF > 2 * SR && p.i0.act === 0, name + ': skipping');
    const best = await CPU.gateLoad(sec, 0.0005, { limit: 1 }); // (re-measured while above the budget itself)
    t.diagnostic(`${name} quiet: ${best.load.toFixed(5)} calibrated (raw ${best.raw.toFixed(5)}, attempt ${best.attempt})`);
    assert.ok(best.load <= 0.0005, `${name}: ${best.load.toFixed(5)} > 0.0005`);
  }
});

test('warm-up: the first live Track of a scope warms the paths up, then restores itself — it renders exactly as a later Track', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), render = () => {
    D.seed('warm'); D.ctx.currentFrame = 0;
    const { p } = mk(D, { os: 4 }, classic('juno60'));
    p.msg({ t: 'on', n: 48, v: 0.8 }); p.msg({ t: 'on', n: 55, v: 0.8 });
    const L = [];
    for (let k = 0; k < 60; k++) { const o = run(D, p, 1); L.push(...o[0][0]); if (k === 40) { p.msg({ t: 'off', n: 48 }); p.msg({ t: 'off', n: 55 }); } }
    return { p, L };
  };
  const a = render(), b = render();
  assert.deepEqual([a.p.pnN, a.p.c0.mon, a.p.mon, a.p.i0.mon], [0, false, false, false], 'restored');
  assert.ok(a.L.some(x => x !== 0));
  assert.deepEqual(a.L, b.L, 'the warmed-up first Track = a fresh one');
});

test('MIDI OUT (§7.9): a sequencer never forwards to its own track — the registry holds the Track, its SxSeq\'s host is the Inst (proc.T) — and still reaches another track', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const arpTo = id => serum(s => { s.p['arp.on'] = 1; s.arp.midiOut = 2; s.arp.outTrack = id; });
  const count = p => { const o = p.extNote; let n = 0; p.extNote = function (...a) { n++; return o.apply(this, a); }; return () => n; };
  const { p: A } = mk(D, { trackId: 'midi-self' }, arpTo('midi-self'));
  const { p: T } = mk(D, { trackId: 'midi-tgt', offline: true }, classic('minimoog'));
  const { p: B } = mk(D, { trackId: 'midi-src', offline: true }, arpTo('midi-tgt'));
  const nA = count(A), nT = count(T);
  for (const p of [A, B]) { p.msg({ t: 'on', n: 60, v: 0.8 }); p.msg({ t: 'on', n: 64, v: 0.8 }); }
  for (let k = 0; k < 300; k++) for (const p of [A, B, T]) run(D, p, 1);
  assert.equal(nA(), 0, 'its own track: never (the pre-split rule, T === this.proc)');
  assert.ok(nT() >= 4, `another track: its notes (${nT()})`);
  for (const p of [A, B, T]) p.msg({ t: 'bye' });
});

/* ------------------------------------------------------------------ stage 1e: several Insts per track (IMPL-1e §2, §7) */
const Z = { lo: 0, hi: 127, xp: 0 }, NODE = { os: 4, hostOS: 4, offline: true };
const saltOf = id => (id === 'i1' ? 0 : (+id.slice(1) * 0x9E3779B9) >>> 0); // (cv-graph's: 0 for the primary)
const gi = (id, o) => Object.assign({ id, on: true, zone: Z, salt: saltOf(id) }, o || {});
const graph = (insts, chains, edges) => ({ t: 'graph', insts: insts.map(x => (typeof x === 'string' ? gi(x) : x)), chains: chains.map(id => ({ id })),
  edges, out: 'out', key: JSON.stringify([insts, chains, edges]) });
const bare = p => { const q = Object.assign({}, p); delete q.fxr; delete q.fxrT; return q; }; // (main strips a classic Inst's FX on a graph node)
const fxOf = fx => ({ fxr: core.compileFx(fx || core.defaultFx2(), { bpm: 120, rate: SR }), fxrT: core.compileFxT(fx || core.defaultFx2()) });
// a graph node as main.js builds it: the graph, {t: patch, i} per Inst (+ its tables), {t: chain, c} per panel
function gnode(D, g, patches, chains = {}, po = NODE) {
  const { p, sent } = mk(D, po);
  p.msg(g);
  for (const [id, patch] of Object.entries(patches)) { p.msg({ t: 'patch', i: id, p: patch.engine === 'serum' ? patch : bare(patch) }); tables(p, patch); }
  for (const [id, fx] of Object.entries(chains)) p.msg(Object.assign({ t: 'chain', c: id }, fx));
  return { p, sent };
}
// the input of a rack per call (copies), concatenated: L then R
function rackIn(r) {
  const L = [], R = [], rp = r.process;
  r.process = function (a, b, n, ...x) { L.push(Float64Array.from(a.subarray(0, n))); R.push(Float64Array.from(b.subarray(0, n))); return rp.call(this, a, b, n, ...x); };
  const cat = A => { const o = new Float64Array(A.reduce((k, a) => k + a.length, 0)); let k = 0; for (const a of A) { o.set(a, k); k += a.length; } return o; };
  return () => ({ L: cat(L), R: cat(R) });
}
// renders quanta with events [[quantum, msg]] → the output (Float64, L / R)
function play(D, p, quanta, ev = []) {
  const o = out(), L = new Float64Array(quanta * 128), R = new Float64Array(quanta * 128);
  for (let k = 0; k < quanta; k++) {
    for (const [q, m] of ev) if (q === k) p.msg(m);
    p.process([], o); D.ctx.currentFrame += 128; L.set(o[0][0], k * 128); R.set(o[0][1], k * 128);
  }
  return { L, R };
}
const maxStep = (a, q0 = 0, ms = 1e9) => { let m = 0; for (let i = Math.max(1, q0 * 128), e = Math.min(a.length, q0 * 128 + ms * SR / 1000); i < e; i++) { const d = Math.abs(a[i] - a[i - 1]); if (d > m) m = d; } return m; };
const peakOf = a => { let m = 0; for (const x of a) if (Math.abs(x) > m) m = Math.abs(x); return m; };
const sameBits = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
const CHORD = [48, 55, 60, 64];
const chordEv = (q0, q1) => CHORD.map(n => [q0, { t: 'on', n, v: 0.8 }]).concat(CHORD.map(n => [q1, { t: 'off', n }]));
const SEQ = { pat: [0, 3, 7, 12, 0, 5, 10, 3].map((n, k) => ({ n, o: 0, a: k & 1, s: k === 3 ? 1 : 0, g: 1 })), len: 8, bpm: 132, swing: 0.1, root: 36, sync: false, run: true };
// a quiet sine instrument (output ≈ 0.006): a cut would step by ≈ −44 dB; two voices' onset and the 3 ms de-click fade stay
// below −60 dB (measured in the 20 ms after a power / removal event: the key presses themselves are not under test)
const SINE = { engine: 'analog', mode: 'poly', poly: 4, prio: 'last', legato: true, glide: 0, unison: 1, bendRange: 2, drift: 0, envOv: 1, bw: 24000, level: 0.006,
  osc: [{ on: 1, lev: 1, oct: 0, fine: 0, saw: 0, pulse: 0, tri: 0, sine: 1, pw: 0.5, kbd: 1 }, { on: 0, lev: 0 }, { on: 0, lev: 0 }],
  hpf: { type: 'none', oct: 4.3, res: 0 }, vcf: { type: 'moog', oct: 13, res: 0, env: 0, kbd: 0, drive: 1 },
  fenv: { a: 0.01, d: 0.4, s: 1, r: 0.3 }, aenv: { a: 0.02, d: 0.3, s: 1, r: 0.3 }, lfo: { rate: 5, wave: 0 }, fx: { chorus: 0, ensemble: 0, hiss: 0 } };
const EDGES2 = [['i1', 'fx1', 1], ['i2', 'fx1', 1], ['fx1', 'out', 1]];

test('1e structure: the first graph adopts i0 / c0 by position (state kept: a note sounding before it renders on bit for bit), later graphs match by id', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  for (const sx of [false, true]) {
    const patch = sx ? serum(null, verb()) : classic('juno60', verb()), ev = [[0, { t: 'on', n: 48, v: 0.8 }], [0, { t: 'on', n: 55, v: 0.8 }], [60, { t: 'off', n: 48 }], [60, { t: 'off', n: 55 }]];
    const a = mk(D, NODE, patch).p, b = mk(D, NODE, patch).p, I = b.i0, C = b.c0;
    const g = sx ? graph(['i1'], [], [['i1', 'out', 1]]) : graph(['i1'], ['fx1'], [['i1', 'fx1', 1], ['fx1', 'out', 1]]);
    const A = play(D, a, 120, ev), Bo = play(D, b, 120, ev.concat([[30, g]]));
    assert.ok(sameBits(A.L, Bo.L) && sameBits(A.R, Bo.R), (sx ? 'Serum' : 'classic') + ': the graph changes no sample (no re-patch, tails and rack kept)');
    assert.ok(peakOf(A.L) > 1e-3);
    assert.deepEqual([b.graphed, b.simple, b.i0 === I, I.id, b.insts.length], [1, 1, true, 'i1', 1]);
    if (sx) assert.deepEqual([b.chains.length, I.fxc === C, C.id, I.rack === C.rack, b.c0 === C], [0, true, 'i1/fx', true, true], 'a Serum keeps c0 as its own FX');
    else assert.deepEqual([b.chains[0] === C, C.id, C.ownBy, I.rack === C.rack, I.sharedRack, I.fxc !== C, I.fxc.id, I.fxc.ownBy === I], [true, 'fx1', null, true, 1, true, 'i1/fx', true], 'c0 becomes the shared panel fx1');
  }
  // later graphs: by id — a new Inst is built (its private chain, a free slot), a missing one dies, an unknown id is ignored
  const { p } = gnode(D, graph(['i1', 'i2'], ['fx1'], EDGES2), { i1: classic('juno60'), i2: classic('minimoog') }, { fx1: fxOf() });
  const [x1, x2] = p.insts;
  assert.deepEqual([x1.id, x2.id, x2.fxc.id, x2.fxc.ownBy === x2, x1.slot, x2.slot, x2.salt, x2.seedSalt, p.simple, x1.rack, x2.rack, p.chains[0].drive],
    ['i1', 'i2', 'i2/fx', true, 0, 1, saltOf('i2'), saltOf('i2'), 0, null, null, 1]);
  assert.ok(x2.constructor === x1.constructor && x2.voices.every(v => v.e === x2), 'an Inst like any other');
  p.msg(graph(['i2', 'i1'], ['fx1'], EDGES2));
  assert.ok(p.insts[0] === x2 && p.insts[1] === x1 && p.i0 === x2, 'reordered (render order, primary first), same objects');
  p.msg({ t: 'patch', i: 'i9', p: bare(classic('dx7')) });
  assert.equal(x1.kind + x2.kind, 'analoganalog', 'an unknown id changes nothing');
  p.msg(graph(['i3'], ['fx1'], [['i3', 'fx1', 1], ['fx1', 'out', 1]]));
  assert.deepEqual([p.insts.length, p.insts[0].id, p.insts[0].slot, p.dyI.length], [1, 'i3', 0, 2], 'both moved to dying, slot 0 reused');
  p.msg({ t: 'graph', insts: [gi('i3'), gi('i3')], chains: [], edges: [] });
  assert.equal(p.insts[0].id, 'i3', 'a repeated id: the graph is ignored');
});

test('1e sum (§6.3): two sequencer-free Insts into one panel = copy(A) + B rendered alone, bit for bit, before the limiter', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), ev = chordEv(2, 70);
  const A = classic('juno60'), Bp = classic('minimoog');
  const one = (id, patch) => { const { p } = gnode(D, graph([id], ['fx1'], [[id, 'fx1', 1], ['fx1', 'out', 1]]), { [id]: patch }, { fx1: fxOf() }); const get = rackIn(p.chains[0].rack); play(D, p, 110, ev); return get(); };
  const a = one('i1', A), b = one('i2', Bp);
  const { p } = gnode(D, graph(['i1', 'i2'], ['fx1'], EDGES2), { i1: A, i2: Bp }, { fx1: fxOf() });
  const get = rackIn(p.chains[0].rack);
  play(D, p, 110, ev);
  const s = get();
  assert.ok(peakOf(a.L) > 1e-3 && peakOf(b.L) > 1e-3, 'both sound');
  assert.equal(s.L.length, a.L.length);
  let bad = -1;
  for (let i = 0; i < s.L.length && bad < 0; i++) if (!Object.is(s.L[i], a.L[i] + b.L[i]) || !Object.is(s.R[i], a.R[i] + b.R[i])) bad = i;
  assert.equal(bad, -1, 'the panel input is exactly the sum');
});

test('1e co-resident sequencer (§6.3): beside a running TB-303 or a Serum ARP an instrument renders on their span grid — the difference is measured and stays below its recorded bound', (t) => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), A = classic('juno60');
  // (bend / wheel moves while the chord sounds: the smoothing steps per span, so the span grid shows)
  const ev = chordEv(2, 140).concat([[20, { t: 'bend', v: 0.6 }], [40, { t: 'wheel', v: 0.8 }], [70, { t: 'bend', v: -0.3 }], [100, { t: 'wheel', v: 0 }]]);
  const arp = serum(s => { s.p['arp.on'] = 1; });
  // max |difference| / the instrument's peak alone, measured on the M4 Max (IMPL-1e §8): TB-303 9.2e-4 (−60.8 dB), Serum ARP
  // 3.3e-8 (−150 dB): the bounds about 2× / 30× above
  const BOUND = { tb303: 2e-3, serum: 1e-6 };
  for (const [name, B, seq] of [['tb303', classic('tb303'), SEQ], ['serum', arp, null]]) {
    const one = (id, patch, s) => {
      const { p } = gnode(D, graph([id], ['fx1'], [[id, 'fx1', 1], ['fx1', 'out', 1]]), { [id]: patch }, { fx1: fxOf() });
      if (s) p.msg({ t: 'seq', i: id, s: Object.assign({}, s) });
      const get = rackIn(p.chains[0].rack); play(D, p, 150, ev); return get();
    };
    const a = one('i1', A, null), b = one('i2', B, seq);
    const { p } = gnode(D, graph(['i1', 'i2'], ['fx1'], EDGES2), { i1: A, i2: B }, { fx1: fxOf() });
    if (seq) p.msg({ t: 'seq', i: 'i2', s: Object.assign({}, seq) });
    const spans = []; const rs = p.renderSpan; p.renderSpan = function (Lo, Ro, off, n) { spans.push(n); return rs.call(this, Lo, Ro, off, n); };
    const get = rackIn(p.chains[0].rack);
    play(D, p, 150, ev);
    const s = get();
    assert.ok(spans.some(n => n < 128), name + ': its events split the spans');
    let d = 0;
    for (let i = 0; i < s.L.length; i++) d = Math.max(d, Math.abs(s.L[i] - b.L[i] - a.L[i]), Math.abs(s.R[i] - b.R[i] - a.R[i]));
    const rel = d / peakOf(a.L);
    t.diagnostic(`${name}: max |sum − (A + B)| = ${d.toExponential(2)} (${rel.toExponential(2)} of A's peak, ${(20 * Math.log10(rel || 1e-30)).toFixed(1)} dB)`);
    assert.ok(peakOf(b.L) > 1e-3 && peakOf(a.L) > 1e-3, name + ': both sound');
    assert.ok(rel <= BOUND[name], `${name}: ${rel} > ${BOUND[name]}`);
  }
});

test('1e salts (§6.2.1): two identical Junos on one track are not sample-identical; with equal salts they would be; two Solinas depend on build order', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), J = classic('juno60');
  const pair = (s2) => {
    const { p } = gnode(D, graph(['i1', gi('i2', { salt: s2 })], ['fx1'], EDGES2), { i1: J, i2: J }, { fx1: fxOf() });
    const got = { i1: [], i2: [] };
    for (const x of p.insts) { const r = x.renderSpan; x.renderSpan = function (n) { const k = r.call(this, n); got[this.id].push(...this.Lb.subarray(0, n)); return k; }; }
    play(D, p, 60, chordEv(1, 50));
    return got;
  };
  const a = pair(saltOf('i2')), b = pair(0);
  assert.ok(peakOf(a.i1) > 1e-3);
  assert.ok(!sameBits(a.i1, a.i2), 'salted: the second Juno draws its own drift / noise');
  assert.ok(sameBits(b.i1, b.i2), 'salt 0 on both: identical (what the salts prevent)');
  // Solina: Math.random of the scope (the divider phases), drawn when each patch builds its divider
  const sol = classic('solina'), solo = order => {
    D.seed('solina-order');
    const { p } = mk(D, NODE);
    p.msg(graph(['i1', 'i2'], ['fx1'], EDGES2));
    for (const id of order) p.msg({ t: 'patch', i: id, p: bare(sol) });
    p.msg(Object.assign({ t: 'chain', c: 'fx1' }, fxOf()));
    const x = p.insts[0], got = [], r = x.renderSpan;
    x.renderSpan = function (n) { const k = r.call(this, n); got.push(...this.Lb.subarray(0, n)); return k; };
    play(D, p, 40, chordEv(1, 30));
    return got; // (i1's own output: the sum of the two is symmetric)
  };
  const s12 = solo(['i1', 'i2']);
  assert.ok(sameBits(s12, solo(['i1', 'i2'])), 'the same build order: the same render');
  assert.ok(!sameBits(s12, solo(['i2', 'i1'])), 'documented: two Solinas depend on the order their patches arrive');
});

test('1e power (§2.3): a powered-off TB-303 fires nothing and splits no spans; on again it re-anchors and plays', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const { p, sent } = gnode(D, graph(['i1', 'i2'], ['fx1'], EDGES2), { i1: classic('juno60'), i2: classic('tb303') }, { fx1: fxOf() });
  p.msg({ t: 'seq', i: 'i2', s: Object.assign({}, SEQ) });
  const spans = [], fires = []; const rs = p.renderSpan, x2 = p.insts[1], sf = x2.seqFire;
  p.renderSpan = function (Lo, Ro, off, n) { spans.push(n); return rs.call(this, Lo, Ro, off, n); };
  x2.seqFire = function (s) { fires.push(s); return sf.call(this, s); };
  run(D, p, 200);
  assert.ok(fires.length >= 4 && spans.some(n => n < 128) && sent.some(m => m.t === 'step' && m.i === 'i2'), 'running: steps, split spans, {t: step, i}');
  p.msg({ t: 'power', i: 'i2', on: false });
  assert.equal(x2.on, 0);
  run(D, p, 4); // (its 3 ms fade)
  fires.length = 0; spans.length = 0; sent.length = 0;
  run(D, p, 200);
  assert.deepEqual([fires.length, spans.every(n => n === 128), sent.filter(m => m.t === 'step').length, x2.act, x2.voices.some(v => v.active)], [0, true, 0, 0, false], 'off: nothing fires, nothing splits');
  p.msg({ t: 'power', i: 'i2', on: true });
  run(D, p, 200);
  assert.ok(fires.length >= 4 && spans.some(n => n < 128), 'on: it plays again');
});

test('1e power (§2.3): off and on are click-free (largest output step < −60 dB); controller state set while off is current at power-on; held keys are restruck', (t) => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const { p } = gnode(D, graph(['i1', gi('i2', { zone: { lo: 0, hi: 127, xp: 7 } })], ['fx1'], EDGES2), { i1: SINE, i2: SINE }, { fx1: fxOf() });
  const x2 = p.insts[1], log = [], on = x2.noteOn;
  x2.noteOn = function (n, v, ...a) { log.push(n); return on.call(this, n, v, ...a); };
  const ev = [[1, { t: 'on', n: 36, v: 0.8 }], [1, { t: 'on', n: 43, v: 0.8 }], [80, { t: 'power', i: 'i2', on: false }], [100, { t: 'wheel', v: 0.7 }], [100, { t: 'bend', v: 0.5 }],
    [140, { t: 'power', i: 'i2', on: true }], [200, { t: 'off', n: 36 }], [200, { t: 'off', n: 43 }]];
  const o = play(D, p, 260, ev);
  const steps = [80, 140].map(q => Math.max(maxStep(o.L, q, 20), maxStep(o.R, q, 20))), st = Math.max(...steps), pk = peakOf(o.L);
  t.diagnostic(`steps: off ${(20 * Math.log10(steps[0])).toFixed(1)} dB, on ${(20 * Math.log10(steps[1])).toFixed(1)} dB (peak ${pk.toFixed(4)})`);
  assert.ok(pk > 0.004, `audible (${pk})`);
  assert.ok(st < 0.001, `largest step ${(20 * Math.log10(st)).toFixed(1)} dB ≥ −60 dB`);
  assert.deepEqual(log, [43, 50, 43, 50], 'struck in zone (+7), restruck at power-on');
  assert.deepEqual([x2.wheel, x2.bendRaw, x2.bend], [0.7, 0.5, 1], 'wheel and bend sent while off are current');
  assert.ok(!x2.voices.some(v => v.gate), 'the note-offs reached the restruck voices');
});

test('1e power (review E7): the power-on restrike triggers a shared panel no Inst holds, as a note-on does (Hyper RETRIG)', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const { p } = gnode(D, graph(['i1', 'i2'], ['fx1'], EDGES2), { i1: SINE, i2: SINE }, { fx1: fxOf() });
  const r = p.chains[0].rack, tr = r.trigger, log = [];
  r.trigger = function (...a) { log.push(1); return tr.apply(this, a); };
  assert.equal(p.chains[0].drive, 1);
  p.msg({ t: 'on', n: 48, v: 0.8 }); p.msg({ t: 'on', n: 52, v: 0.8 }); run(D, p, 4);
  assert.equal(log.splice(0).length, 4, 'a note-on: once per receiving Inst');
  p.msg({ t: 'power', i: 'i2', on: false }); run(D, p, 4);
  p.msg({ t: 'power', i: 'i2', on: true });
  assert.equal(log.splice(0).length, 2, 'the restrike: once per restruck key');
});

test('1e power: a powered-off instrument costs ≤ 0.0005 load once its fade has ended (two Insts off with keys held: the skip path)', async (t) => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const { p } = gnode(D, graph(['i1', 'i2'], ['fx1'], EDGES2), { i1: classic('prophet5'), i2: serum() }, { fx1: fxOf() }, { os: 2, hostOS: 4, trackId: 'pw' });
  for (const n of CHORD) p.msg({ t: 'on', n, v: 0.8 });
  run(D, p, 20);
  p.msg({ t: 'power', i: 'i1', on: false }); p.msg({ t: 'power', i: 'i2', on: false });
  const o = out(), sec = () => run(D, p, SR / 128, o);
  sec();
  assert.ok(p.insts.every(x => x.live === 0) && o[0][0].every(x => x === 0), 'skipping, silent');
  const best = await CPU.gateLoad(sec, 0.0005, { limit: 1 });
  t.diagnostic(`two powered-off Insts: ${best.load.toFixed(5)} calibrated (raw ${best.raw.toFixed(5)}, attempt ${best.attempt})`);
  assert.ok(best.load <= 0.0005, `${best.load.toFixed(5)} > 0.0005`);
});

test('1e zones (§2.3): notes reach the powered Insts whose zone admits them, transposed; a note-off reaches exactly the recorded receivers at their pitches, whatever the zones are now', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), g = (z1, z2) => graph([gi('i1', { zone: z1 }), gi('i2', { zone: z2 })], ['fx1'], EDGES2);
  const { p } = gnode(D, g({ lo: 0, hi: 59, xp: 0 }, { lo: 60, hi: 127, xp: 12 }), { i1: classic('juno60'), i2: classic('prophet5') }, { fx1: fxOf() });
  const log = [];
  for (const x of p.insts) for (const k of ['noteOn', 'noteOff']) { const f = x[k]; x[k] = function (n, ...a) { log.push(this.id + (k === 'noteOn' ? '+' : '-') + n); return f.call(this, n, ...a); }; }
  p.msg({ t: 'on', n: 48, v: 0.8 }); p.msg({ t: 'on', n: 64, v: 0.8 }); p.msg({ t: 'on', n: 120, v: 0.8 });
  assert.deepEqual(log.splice(0), ['i1+48', 'i2+76'], 'split at 60, the upper zone +12 (120 + 12 is dropped)');
  run(D, p, 10);
  p.msg(g(Z, { lo: 0, hi: 127, xp: -5 })); // zones changed mid-note
  p.msg({ t: 'off', n: 48 }); p.msg({ t: 'off', n: 64 }); p.msg({ t: 'off', n: 120 });
  assert.deepEqual(log.splice(0), ['i1-48', 'i2-76'], 'the recorded receivers, at the recorded pitches (120: none)');
  p.msg({ t: 'on', n: 50, v: 0.8 }); p.msg({ t: 'off', n: 50 });
  assert.deepEqual(log.splice(0), ['i1+50', 'i2+45', 'i1-50', 'i2-45'], 'new notes: the new zones');
  // MPE channels are their own keys; a preview targets one Inst (aud, i)
  p.msg({ t: 'on', n: 50, v: 0.8, ch: 3 }); p.msg({ t: 'on', n: 50, v: 0.8, ch: 4 }); p.msg({ t: 'off', n: 50, ch: 3 });
  assert.deepEqual(log.splice(0), ['i1+50', 'i2+45', 'i1+50', 'i2+45', 'i1-50', 'i2-45']);
  p.msg({ t: 'on', n: 70, v: 0.8, aud: true, i: 'i2' }); p.msg({ t: 'off', n: 70, aud: true, i: 'i2' }); p.msg({ t: 'on', n: 71, v: 0.8, aud: true });
  assert.deepEqual(log.splice(0), ['i2+70', 'i2-70', 'i1+71'], 'previews: the Inst named, else insts[0], untransposed');
  // powered off: no notes; controller state still reaches it
  p.msg({ t: 'power', i: 'i1', on: false }); p.msg({ t: 'on', n: 40, v: 0.8 }); p.msg({ t: 'off', n: 40 });
  assert.deepEqual(log.splice(0).filter(e => e !== 'i2-50'), ['i2+35', 'i2-35']);
});

test('1e zones (review E8): a repeated note-on after a transpose change releases the pitch it recorded first — nothing stays held', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), g = xp => graph(['i1', gi('i2', { zone: { lo: 0, hi: 127, xp } })], ['fx1'], EDGES2);
  const { p } = gnode(D, g(0), { i1: SINE, i2: SINE }, { fx1: fxOf() });
  const log = [], x2 = p.insts[1];
  for (const k of ['noteOn', 'noteOff']) { const f = x2[k]; x2[k] = function (n, ...a) { log.push((k === 'noteOn' ? '+' : '-') + n); return f.call(this, n, ...a); }; }
  p.msg({ t: 'on', n: 60, v: 0.8 }); run(D, p, 4);
  p.msg(g(12));
  p.msg({ t: 'on', n: 60, v: 0.8 }); p.msg({ t: 'on', n: 60, v: 0.8 }); run(D, p, 4);
  p.msg({ t: 'off', n: 60 }); run(D, p, 4);
  assert.deepEqual(log, ['+60', '-60', '+72', '+72', '-72'], 'the old pitch released before the new one; the same pitch retriggers as before');
  assert.ok(!x2.voices.some(v => v.gate), 'no voice left held');
});

test('1e MIDI OUT (§7.9) into a two-Inst track: the ext notes fan out to every Inst by zone; a sequencer of the track never feeds its own track', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const arpTo = id => serum(s => { s.p['arp.on'] = 1; s.arp.midiOut = 2; s.arp.outTrack = id; });
  const { p: T } = gnode(D, graph(['i1', 'i2', 'i3'], ['fx1'], [['i1', 'fx1', 1], ['i2', 'fx1', 1], ['i3', 'fx1', 1], ['fx1', 'out', 1]]),
    { i1: classic('juno60'), i2: classic('minimoog'), i3: arpTo('m-tgt') }, { fx1: fxOf() }, { os: 2, hostOS: 4, trackId: 'm-tgt', offline: true });
  const { p: S } = mk(D, { trackId: 'm-src', offline: true }, arpTo('m-tgt'));
  const n = { i1: 0, i2: 0, i3: 0, ext: 0 };
  for (const x of T.insts) { const f = x.noteOn; x.noteOn = function (k, v, ch, ext, ...a) { n[this.id]++; if (ext) n.ext++; return f.call(this, k, v, ch, ext, ...a); }; }
  S.msg({ t: 'on', n: 60, v: 0.8 }); S.msg({ t: 'on', n: 64, v: 0.8 });
  for (let k = 0; k < 300; k++) for (const p of [S, T]) run(D, p, 1);
  const own = n.i3;
  T.msg({ t: 'on', n: 48, v: 0.8 }); // (i3's arpeggiator: its MIDI OUT names its own track — never forwarded to it)
  for (let k = 0; k < 100; k++) for (const p of [S, T]) run(D, p, 1);
  assert.ok(own >= 5 && n.i1 >= own && n.i2 === n.i1, `the instruments play the ext notes (${n.i1}, ${n.i2}, ${own})`);
  assert.ok(n.ext >= 3 * 5, 'ext notes');
  for (const p of [S, T]) p.msg({ t: 'bye' });
  assert.ok(T.insts.every(x => x.procs === null));
});

test('1e stats.per and smon per part on a graph node: every Inst (its own spans, a Serum\'s own FX excluded), every panel and every Serum\'s own FX', () => {
  const D = dspScope({ engine: true, console: quiet });
  let clock = 0;
  D.run('(function (f) { Date.now = function now() { return f(); }; })', 'clock.js')(() => clock);
  const { p, sent } = gnode(D, graph(['i1', 'i2'], ['fx1'], EDGES2), { i1: classic('prophet5'), i2: serum(null, verb()) }, { fx1: fxOf(verb()) }, { os: 2, hostOS: 4, offline: true });
  const [x1, x2] = p.insts, wrap = (o, k, dt) => { const f = o[k]; o[k] = function (...a) { clock += dt; return f.apply(this, a); }; };
  wrap(x1, 'renderSpan', 2); wrap(x2, 'renderSpan', 3); wrap(p.chains[0].rack, 'process', 1); wrap(x2.rack, 'process', 1);
  for (const n of [48, 52, 55]) p.msg({ t: 'on', n, v: 0.8 });
  run(D, p, 200);
  const st = sent.filter(m => m.t === 'stats');
  assert.equal(st.length, 2);
  for (const m of st) {
    assert.equal(m.per.map(e => e.id).join(), 'i1,i2,fx1,i2/fx');
    const by = Object.fromEntries(m.per.map(e => [e.id, e.load])), u = m.load / 7; // per quantum: 2 + (3 + 1) + 1 = 7 clock ms
    for (const [id, k] of [['i1', 2], ['i2', 3], ['fx1', 1], ['i2/fx', 1]]) assert.ok(Math.abs(by[id] - k * u) < 1e-9, `${id}: ${by[id]} vs ${k * u}`);
    assert.deepEqual([m.per[0].os, m.per[1].os, m.voices, m.os, m.per[0].voices], [x1.OS, x2.OS, x1.act, x1.OS, x1.act], 'voices / os: insts[0]\'s');
    assert.equal(m.per[1].voices, x2.sxVoices());
    assert.equal(Object.keys(m.per[2]).sort().join(), 'id,load');
  }
  const mons = (ids, quanta = 40) => { sent.length = 0; p.msg({ t: 'mon', ids }); run(D, p, quanta); return sent.filter(m => m.t === 'smon'); };
  let s = mons(['i1', 'i2', 'fx1', 'i2/fx']);
  const of = k => s.filter(m => (m.i || m.c) === k);
  assert.ok(of('i1').length >= 3 && of('i1').every(m => m.s === null && m.gr === null && !('c' in m)), 'a classic Inst: no snapshot, no own FX');
  assert.ok(of('i2').every(m => m.s && m.gr !== null && m.fxph !== null) && of('i2').length >= 3, 'a Serum: its snapshot and its own FX\'s meters');
  assert.ok(of('fx1').every(m => m.gr !== null && !('s' in m)) && of('fx1').length >= 3, 'the panel');
  assert.ok(of('i2/fx').length >= 3 && of('i2/fx').every(m => m.gr !== null && !('i' in m)), 'the Serum\'s own FX');
  assert.equal(x2.sx.mon, 1);
  s = mons(['fx1']);
  assert.ok(s.length >= 3 && s.every(m => m.c === 'fx1'), 'only the panel on screen');
  assert.deepEqual([x1.mon, x2.mon, x2.sx.mon], [false, false, 0]);
  assert.equal(mons([]).length, 0);
  // fxph / fxtap name the part
  sent.length = 0; p.msg({ t: 'fxph', c: 'fx1' }); p.msg({ t: 'fxph', i: 'i2' }); p.msg({ t: 'fxph' });
  assert.deepEqual(sent.map(m => [m.t, m.c || m.i, !!m.v]), [['fxph', 'fx1', true], ['fxph', 'i2', true], ['fxph', 'fx1', true]]);
  const id = p.chains[0].rack.U[0].id;
  p.msg({ t: 'fxtap', c: 'fx1', id });
  assert.deepEqual([p.chains[0].rack.tapId, x2.rack.tapId], [id, '']);
});

test('stats under a wall clock that steps backwards (7a review 1 F6: NTP after a wake, inside a rack\'s timing window): every load stays ≥ 0 — the track\'s, an Inst\'s, a panel\'s, a Serum\'s own FX\'s (golden-graph\'s tap asserts it)', () => {
  const D = dspScope({ engine: true, console: quiet });
  let clock = 0;
  D.run('(function (f) { Date.now = function now() { return f(); }; })', 'clock.js')(() => clock);
  // the clock steps back 1 s once, inside the wrapped call's window (call `at`); else 1 ms a call
  const wrap = (o, k, at) => { const f = o[k]; let n = 0; o[k] = function (...a) { clock += ++n === at ? -1000 : 1; return f.apply(this, a); }; };
  const bad = [], check = (name, sent) => {
    const st = sent.filter(m => m.t === 'stats');
    if (st.length !== 2) bad.push(`${name}: ${st.length} stats posts`);
    for (const m of st) for (const e of [{ id: 'track', load: m.load }, ...m.per]) if (!(e.load >= 0 && Number.isFinite(e.load))) bad.push(`${name}: ${e.id} ${e.load}`);
  };
  { // a legacy node (the simple path): the panel's share
    const { p, sent } = mk(D, { offline: true, os: 2 }, classic('prophet5', verb()));
    wrap(p.c0.rack, 'process', 30);
    for (const n of [48, 52, 55]) p.msg({ t: 'on', n, v: 0.8 });
    run(D, p, 200);
    check('legacy', sent);
  }
  { // a graph node: a shared panel and a Serum's own FX
    const { p, sent } = gnode(D, graph(['i1', 'i2'], ['fx1'], EDGES2), { i1: classic('prophet5'), i2: serum(null, verb()) }, { fx1: fxOf(verb()) }, { os: 2, hostOS: 4, offline: true });
    wrap(p.chains[0].rack, 'process', 30); wrap(p.insts[1].rack, 'process', 130);
    for (const n of [48, 52, 55]) p.msg({ t: 'on', n, v: 0.8 });
    run(D, p, 200);
    check('graph', sent);
  }
  assert.deepEqual(bad, []);
});

test('1e removal (§2.5): a removed Inst fades out (click-free) and is dropped; a removed panel\'s tail plays out into OUT, then it is dropped and the track returns to the alias shape', (t) => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const { p } = gnode(D, graph(['i1', 'i2'], ['fx1', 'fx2'], [['i1', 'fx1', 1], ['i2', 'fx2', 1], ['fx1', 'out', 1], ['fx2', 'out', 1]]), { i1: SINE, i2: SINE }, { fx1: fxOf(), fx2: fxOf(verb()) });
  const alone = graph(['i1'], ['fx1'], [['i1', 'fx1', 1], ['fx1', 'out', 1]]);
  const o = play(D, p, 120, [[1, { t: 'on', n: 36, v: 0.8 }], [1, { t: 'on', n: 43, v: 0.8 }], [60, alone]]);
  const st = Math.max(maxStep(o.L, 60, 20), maxStep(o.R, 60, 20));
  assert.ok(peakOf(o.L) > 0.004 && st < 0.001, `largest step ${(20 * Math.log10(st)).toFixed(1)} dB`);
  assert.deepEqual([p.dyI.length, p.dyC.length, p.simple], [0, 1, 0], 'i2 faded and dropped; fx2\'s reverb tail still playing');
  const tail = peakOf(play(D, p, 40, [[0, { t: 'off', n: 36 }], [0, { t: 'off', n: 43 }]]).L.subarray(128 * 20));
  assert.ok(tail > 1e-5, 'the tail reaches OUT');
  run(D, p, Math.ceil(12 * SR / 128));
  assert.deepEqual([p.dyC.length, p.simple, p.Lb === p.i0.Lb], [0, 1, true], 'idle: dropped, the alias shape again');
  // the dying fade keeps its route (review E1): its cable gain, the panel it fed (kept, or removed with it: the panel's OUT
  // gain), nothing for an unconnected instrument — i2 ten times SINE's level, so a fade at gain 1 straight into OUT jumps
  const LOUD = Object.assign({}, SINE, { level: 0.06 }), E = (e2, ch2) => [['i1', 'fx1', 1], ['fx1', 'out', 1]].concat(e2), cases = [
    ['i2 → OUT at 0.1', ['fx1'], E([['i2', 'out', 0.1]]), {}, alone],
    ['i2 → quiet EQ (kept)', ['fx1', 'fx2'], E([['i2', 'fx2', 1], ['fx2', 'out', 1]]), { fx2: fxOf(quietEq()) }, graph(['i1'], ['fx1', 'fx2'], E([['fx2', 'out', 1]]))],
    ['i2 → quiet EQ → OUT at 0.3, both removed', ['fx1', 'fx2'], E([['i2', 'fx2', 1], ['fx2', 'out', 0.3]]), { fx2: fxOf(quietEq()) }, alone],
    ['i2 unconnected', ['fx1'], E([]), {}, alone]];
  for (const [name, ch, edges, cf, after] of cases) {
    const { p: q } = gnode(D, graph(['i1', 'i2'], ch, edges), { i1: SINE, i2: LOUD }, Object.assign({ fx1: fxOf() }, cf));
    const o2 = play(D, q, 90, [[1, { t: 'on', n: 36, v: 0.8 }], [1, { t: 'on', n: 43, v: 0.8 }], [60, after]]);
    const s2 = Math.max(maxStep(o2.L, 60, 20), maxStep(o2.R, 60, 20)), pre = peakOf(o2.L.subarray(40 * 128, 60 * 128)), post = peakOf(o2.L.subarray(60 * 128, 62 * 128));
    t.diagnostic(`${name}: step ${(20 * Math.log10(s2)).toFixed(1)} dB, peak ${pre.toFixed(5)} → ${post.toFixed(5)}`);
    assert.ok(s2 < 0.001, `${name}: largest step ${(20 * Math.log10(s2)).toFixed(1)} dB ≥ −60 dB`);
    assert.ok(post <= pre * 1.05, `${name}: no burst (${pre} → ${post})`);
    assert.equal(q.dyI.length, 0, `${name}: dropped once faded`);
  }
});

test('1e removal routes (review E1): an Inst into a removed panel into a kept one — the fade and the tail follow the cables at their gains; nothing allocates, a panic included', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const E = [['i1', 'fx2', 1], ['fx2', 'out', 1], ['i3', 'fx2', 0.7]];
  const off = id => gi(id, { on: false }); // (i1, i3 silent: fx2 hears only the removed parts below)
  const { p } = gnode(D, graph([off('i1'), 'i2', off('i3')], ['fx1', 'fx2'], [['i2', 'fx1', 0.5], ['fx1', 'fx2', 0.8]].concat(E)), { i1: classic('juno60'), i2: classic('prophet5'), i3: serum(null, verb()) },
    { fx1: fxOf(verb()), fx2: fxOf(quietEq()) });
  const [, x2] = p.insts, [f1, f2] = p.chains;
  for (const n of [48, 55, 60]) p.msg({ t: 'on', n, v: 0.8 });
  run(D, p, 60);
  p.msg(graph([off('i1'), off('i3')], ['fx2'], E)); // i2 and fx1 removed
  assert.deepEqual([x2.dyTo === f1, x2.dyG, x2.dyO, x2.nOut, f1.dyTo === f2, f1.dyG, f1.dyO, f1.nOut], [true, 0.5, 0, 1, true, 0.8, 0, 1], 'their routes');
  // fx2's input peak (no allocation in the probe)
  const rp = f2.rack.process, o = out();
  let pk = 0;
  f2.rack.process = function (a, b, n, ...x) { for (let i = 0; i < n; i++) { const v = Math.abs(a[i]); if (v > pk) pk = v; } return rp.call(this, a, b, n, ...x); };
  noAlloc(D, () => { for (let k = 0; k < 40; k++) { if (k === 30) p.msg({ t: 'panic' }); p.process([], o); D.ctx.currentFrame += 128; } });
  assert.deepEqual([p.dyI.length, p.dyC.length, p.pnN], [0, 0, 0]);
  assert.ok(pk > 1e-3, `the kept panel heard the removed ones (${pk})`);
});

test('1e panic / bye while removed parts die (review E2): the output fade ends in silence — the output stage gets nothing unfaded in the quantum the fade ends in, nor after', (t) => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), res = {};
  const g2 = graph(['i1', 'i2'], ['fx1', 'fx2'], [['i1', 'fx1', 1], ['i2', 'fx2', 1], ['fx1', 'out', 1], ['fx2', 'out', 1]]);
  for (const [rm, end] of [[false, 'panic'], [true, 'panic'], [true, 'bye']]) {
    const { p } = gnode(D, g2, { i1: classic('juno60'), i2: classic('prophet5') }, { fx1: fxOf(verb()), fx2: fxOf(verb()) });
    for (const n of [48, 55, 60]) p.msg({ t: 'on', n, v: 0.9 });
    run(D, p, 150);
    if (rm) p.msg(graph(['i1'], ['fx1'], [['i1', 'fx1', 1], ['fx1', 'out', 1]])); // i2 and fx2 removed: fx2's reverb tail dies into OUT
    run(D, p, 3);
    if (rm) assert.ok(p.dyC.length === 1 && p.simple === 0, 'fx2 dying');
    p.msg({ t: end });
    // the output stage's input (its limiter delays the output by 1 ms: the fade's own tail is still heard after its end)
    const r = { end: -1, rest: 0, after: 0, pre: 0 }, os = p.outStage;
    let pn = 0, k = 0;
    p.outStage = function (Lo, Ro, off, n) {
      for (let i = 0; i < n; i++) {
        const a = Math.max(Math.abs(this.Lb[i]), Math.abs(this.Rb[i]));
        if (r.end < 0) { if (pn > 0 && this.pnN === 0 && i >= pn) r.rest = Math.max(r.rest, a); else r.pre = Math.max(r.pre, a); }
        else r.after = Math.max(r.after, a);
      }
      return os.call(this, Lo, Ro, off, n);
    };
    for (; k < 6; k++) { pn = p.pnN; run(D, p, 1); if (pn > 0 && p.pnN === 0 && r.end < 0) r.end = k; }
    res[(rm ? 'removed ' : 'control ') + end] = r;
    if (rm && end === 'panic') assert.deepEqual([p.dyI.length, p.dyC.length, p.simple, p.Lb === p.i0.Lb], [0, 0, 1, true], 'cleared: the alias shape again');
  }
  t.diagnostic(JSON.stringify(res));
  for (const [k, r] of Object.entries(res)) {
    assert.ok(r.end >= 0 && r.pre > 0.05, k + ': sounding, then the fade ended');
    assert.ok(r.rest === 0 && r.after < 1e-3, `${k}: silent after the fade (${r.rest}, ${r.after})`);
  }
});

// counts a rack's transport() and reset(true) calls (play start, the "silence tails on stop" preference)
function rackCalls(r) {
  const c = { tr: 0, reset: 0 }, rs = r.reset, tr = r.transport;
  r.reset = function (s) { if (s) c.reset++; return rs.call(this, s); }; r.transport = function () { c.tr++; return tr.call(this); };
  return c;
}
const tpMsg = (D, play) => ({ t: 'transport', play, frame: D.ctx.currentFrame, tick: 0, fpt: 25, seek: true, fresh: true });
function playStop(D, p) { p.msg(tpMsg(D, true)); run(D, p, 4); p.msg({ t: 'on', n: 48, v: 0.8 }); run(D, p, 4); p.msg(tpMsg(D, false)); run(D, p, 2); }

test('1e transport (review E3): a shared panel no Inst holds (two sources) re-anchors at play start — rack.transport() once, as a legacy node\'s rack', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), fx = verb();
  const { p: L } = mk(D, NODE, classic('juno60', fx)), cl = rackCalls(L.c0.rack);
  playStop(D, L);
  const { p } = gnode(D, graph(['i1', 'i2'], ['fx1'], EDGES2), { i1: classic('juno60'), i2: classic('minimoog') }, { fx1: fxOf(fx) });
  const c = rackCalls(p.chains[0].rack);
  assert.equal(p.chains[0].drive, 1);
  playStop(D, p);
  assert.deepEqual([cl.tr, c.tr], [1, 1], 'legacy, shared panel: one transport() at play start');
  // a panel fed by a panel (no Inst holds it either)
  const { p: q } = gnode(D, graph(['i1'], ['fx1', 'fx2'], [['i1', 'fx1', 1], ['fx1', 'fx2', 1], ['fx2', 'out', 1]]), { i1: classic('juno60') }, { fx1: fxOf(), fx2: fxOf(fx) });
  const c1 = rackCalls(q.chains[0].rack), c2 = rackCalls(q.chains[1].rack);
  playStop(D, q);
  assert.deepEqual([c1.tr, c2.tr], [1, 1], 'the Inst\'s panel through the Inst, the next one by the Track');
});

test('1e transport (review E4): the adopted panel keeps the legacy FXP — "silence tails on stop" resets it once, as on the legacy node, before any {t: chain}', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), fx = verb();
  const { p: L } = mk(D, NODE, classic('juno60', fx)), cl = rackCalls(L.c0.rack);
  assert.equal(L.i0.p.fxr.silence, 1);
  playStop(D, L);
  const res = [cl.reset];
  for (const g of [graph(['i1'], ['fx1'], [['i1', 'fx1', 1], ['fx1', 'out', 1]]), graph(['i1', 'i2'], ['fx1'], EDGES2)]) {
    const { p } = mk(D, NODE, classic('juno60', fx)), c0 = p.c0, c = rackCalls(c0.rack);
    p.msg(g); // (main's graphCache holds the legacy FXP as the panel's: no {t: chain} follows; the patches come stripped)
    for (const x of g.insts) p.msg({ t: 'patch', i: x.id, p: bare(classic(x.id === 'i1' ? 'juno60' : 'minimoog')) });
    assert.ok(p.chains[0] === c0 && c0.id === 'fx1');
    playStop(D, p);
    res.push(c.reset);
  }
  assert.deepEqual(res, [1, 1, 1], 'legacy, adopted alone, adopted with a second source: one reset(true) at stop');
});

test('1e reshape (review E6): Serum → classic hands its own FX to the new panel even when a quantum renders between the graph and the patch', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), res = [];
  for (const gap of [0, 1, 3]) {
    const sp = serum(null, verb()), { p } = mk(D, NODE, sp);
    p.msg(graph(['i1'], [], [['i1', 'out', 1]]));
    p.msg({ t: 'on', n: 48, v: 0.8 }); run(D, p, 20);
    const own = p.i0.rack;
    p.msg(graph(['i1'], ['fx1'], [['i1', 'fx1', 1], ['fx1', 'out', 1]])); // (setModel: the Serum's FX become the new panel)
    run(D, p, gap);
    p.msg({ t: 'patch', i: 'i1', p: bare(classic('juno60', verb())) });
    res.push([gap, p.chains[0].rack === own, p.i0.rack === own, p.simple]);
    p.msg(graph(['i1'], ['fx1'], [['i1', 'fx1', 1], ['fx1', 'out', 1]])); run(D, p, gap); // (a later graph: the panel is no longer new — Serum and back keeps it)
    p.msg({ t: 'patch', i: 'i1', p: sp }); tables(p, sp); p.msg({ t: 'patch', i: 'i1', p: bare(classic('juno60')) });
    res.push([gap, p.chains[0].rack === own, p.i0.rack === own, p.simple]);
  }
  assert.deepEqual(res.map(e => e.join()), ['0,true,true,1', '0,true,true,1', '1,true,true,1', '1,true,true,1', '3,true,true,1', '3,true,true,1'], 'handed over; a later graph: the panel is not new (no swap back)');
});

test('1e part messages (review E9): fxtap / fxph naming a classic Inst reach the panel it feeds (its private chain never renders); a classic Inst that was a Serum keeps its old sequencer asleep at power-on', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const { p, sent } = gnode(D, graph(['i1', 'i2', 'i3'], ['fx1'], [['i1', 'fx1', 1], ['i2', 'fx1', 1], ['fx1', 'out', 1], ['i3', 'out', 1]]),
    { i1: classic('juno60'), i2: serum(null, verb()), i3: classic('prophet5') }, { fx1: fxOf(verb()) });
  const [x1, x2, x3] = p.insts, r = p.chains[0].rack, id = r.U[0].id;
  p.msg({ t: 'fxtap', i: 'i1', id });
  assert.deepEqual([r.tapId, x1.fxc.rack.tapId, x2.rack.tapId], [id, '', ''], 'the panel i1 feeds');
  p.msg({ t: 'fxtap', i: 'i3', id: 'zz' }); // (i3 feeds no panel: ignored)
  assert.deepEqual([r.tapId, x3.fxc.rack.tapId], [id, '']);
  run(D, p, 20); sent.length = 0;
  p.msg({ t: 'fxph', i: 'i1' }); p.msg({ t: 'fxph', i: 'i3' });
  assert.deepEqual(sent.map(m => [m.i, JSON.stringify(m.v)]), [['i1', JSON.stringify(r.phases())], ['i3', 'null']]);
  // Serum → classic keeps its SxSeq object (made by the first Serum patch); the power-on re-anchors only a Serum's
  const sp = serum(s => { s.p['arp.on'] = 1; });
  p.msg({ t: 'patch', i: 'i3', p: sp }); tables(p, sp); p.msg({ t: 'patch', i: 'i3', p: bare(classic('prophet5')) });
  assert.ok(x3.sxSeq !== null && x3.kind !== 'serum');
  const tr = x3.sxSeq.transport, log = [];
  x3.sxSeq.transport = function (...a) { log.push(a); return tr.apply(this, a); };
  p.msg({ t: 'power', i: 'i3', on: false }); p.msg({ t: 'power', i: 'i3', on: true });
  p.msg({ t: 'power', i: 'i2', on: false }); p.msg({ t: 'power', i: 'i2', on: true });
  assert.equal(log.length, 0, 'not a Serum: its sequencer is not touched');
});

test('1e processorOptions (§2.5): graph / patches / chains / seqs build the track a message build builds — bit for bit (offline bounce = live)', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const g = graph(['i1', 'i2', gi('i3', { zone: { lo: 0, hi: 60, xp: -12 } })], ['fx1', 'fx2'], [['i1', 'fx1', 1], ['i2', 'fx1', 0.5], ['i3', 'fx2', 1], ['fx1', 'out', 1], ['fx2', 'out', 0.8]]);
  const P = { i1: classic('juno60'), i2: serum(null, verb()), i3: classic('tb303') }, C = { fx1: fxOf(verb()), fx2: fxOf() }, S = Object.assign({}, SEQ);
  const ev = chordEv(2, 90), fresh = () => { D.seed('po-vs-msg'); D.ctx.currentFrame = 0; };
  fresh();
  const { p: a } = gnode(D, g, P, C, NODE);
  a.msg({ t: 'seq', i: 'i3', s: S });
  const m = play(D, a, 160, ev);
  fresh();
  const { p: b } = mk(D, Object.assign({}, NODE, { graph: g, patches: Object.fromEntries(Object.entries(P).map(([k, x]) => [k, x.engine === 'serum' ? x : bare(x)])), chains: C, seqs: { i3: S } }));
  assert.deepEqual([b.graphed, b.insts.map(x => x.id).join(), b.chains.map(c => c.id).join(), b.insts[2].sq.run, b.insts[1].kind], [1, 'i1,i2,i3', 'fx1,fx2', true, 'serum']);
  const q = play(D, b, 160, ev);
  assert.ok(peakOf(m.L) > 1e-3);
  assert.ok(sameBits(m.L, q.L) && sameBits(m.R, q.R), 'identical');
});

test('1e: the graph paths are warmed up — the first live Track of a scope ran them, then restored itself to the legacy structure', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p } = mk(D, { os: 4, hostOS: 4 });
  assert.deepEqual([p.graphed, p.simple, p.insts.length, p.chains.length, p.i0.id, p.c0.id, p.i0.fxc === p.c0, p.c0.ownBy === p.i0, p.i0.rack === p.c0.rack,
    p.dyI.length, p.dyC.length, p.wI, p.i0.salt, p.i0.on, p.holdR.every(x => x === 0)], [0, 1, 1, 1, 'i0', 'c0', true, true, true, 0, 0, null, 0, 1, true]);
  assert.ok(p.Lb === p.i0.Lb, 'the output stage on the Inst\'s buffers');
});

test('1e host protocol (lane B): a graph applies on-changes with the power semantics and the {t: power} that follows it is a no-op; {t: chain} without fxrT keeps the tables', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const g = on2 => graph(['i1', gi('i2', { on: on2 })], ['fx1'], EDGES2);
  const { p } = gnode(D, g(true), { i1: SINE, i2: SINE }, { fx1: fxOf() });
  const x2 = p.insts[1], log = [], f = x2.noteOn, a = x2.allOff;
  x2.noteOn = function (n, ...r) { log.push('+' + n); return f.call(this, n, ...r); };
  x2.allOff = function (h) { log.push('allOff' + (h ? '!' : '')); return a.call(this, h); };
  p.msg({ t: 'on', n: 40, v: 0.8 }); run(D, p, 4);
  p.msg(g(false)); p.msg({ t: 'power', i: 'i2', on: false });
  assert.deepEqual([log.splice(0).join(), x2.on], ['+40,allOff!', 0], 'the graph powers off (one fade); the power message changes nothing');
  run(D, p, 4);
  p.msg(g(true)); p.msg({ t: 'power', i: 'i2', on: true });
  assert.deepEqual([log.splice(0).join(), x2.on], ['+40', 1], 'the graph powers on and restrikes once');
  // {t: chain} without fxrT (its tables key unchanged): the rack keeps its tables
  const r = p.chains[0].rack, xs = [];
  const sx = r.setXS; r.setXS = function (t) { xs.push(t); return sx.call(this, t); };
  p.msg(Object.assign({ t: 'chain', c: 'fx1' }, { fxr: fxOf(verb()).fxr }));
  assert.equal(xs.length, 0, 'no fxrT: the previous tables stay');
  p.msg(Object.assign({ t: 'chain', c: 'fx1' }, fxOf(verb())));
  assert.equal(xs.length, 1);
  // fxover (§8.5) names the part on a graph node: {c} a panel, {i} a Serum's own FX
  const { p: q, sent } = gnode(D, graph(['i1', 'i2'], ['fx1'], EDGES2), { i1: SINE, i2: serum() }, { fx1: fxOf() });
  q.chains[0].rack.over = ['m1']; q.insts[1].rack.over = ['m2'];
  sent.length = 0; q.assets();
  assert.deepEqual(sent.filter(m => m.t === 'fxover').map(m => [m.i || m.c, m.ids.join()]), [['i2', 'm2'], ['fx1', 'm1']]);
});

test('1e host protocol (lane B): a classic primary straight to OUT keeps c0 as its private chain (c0 = chains[0] || i0.fxc); {t: fxph} without c answers c0; processorOptions with patch / seq null', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const { p, sent } = mk(D, NODE, classic('juno60'));
  const I = p.i0, C = p.c0;
  p.msg(graph(['i1'], [], [['i1', 'out', 1]]));
  assert.deepEqual([p.chains.length, p.c0 === C, I.fxc === C, C.id, C.ownBy === I, I.rack, I.sharedRack, p.simple], [0, true, true, 'i1/fx', true, null, 0, 0]);
  sent.length = 0; p.msg({ t: 'fxph' });
  assert.deepEqual([sent.length, sent[0].c], [1, 'i1/fx']);
  p.msg({ t: 'on', n: 48, v: 0.8 });
  assert.ok(peakOf(play(D, p, 10).L) > 1e-3, 'it sounds straight into OUT');
  // the first graph adopts the panel the primary feeds as c0
  const { p: q } = mk(D, NODE, classic('juno60'));
  const c0 = q.c0;
  q.msg(graph(['i1', 'i2'], ['fx1', 'fx2'], [['i2', 'fx1', 1], ['i1', 'fx2', 1], ['fx1', 'out', 1], ['fx2', 'out', 1]]));
  assert.deepEqual([c0.id, q.chains[1] === c0, q.i0.rack === c0.rack, q.c0 === q.chains[0]], ['fx2', true, true, true]);
  // processorOptions of a graph node: patch / seq null
  const { p: b } = mk(D, Object.assign({}, NODE, { patch: null, seq: null, graph: graph(['i1'], ['fx1'], [['i1', 'fx1', 1], ['fx1', 'out', 1]]),
    patches: { i1: bare(classic('prophet5')) }, chains: { fx1: fxOf() }, seqs: {} }));
  assert.deepEqual([b.graphed, b.simple, b.i0.id, b.c0.id, b.i0.p.poly], [1, 1, 'i1', 'fx1', b.i0.voices.length]);
});

// §14.1 row r (IMPL-1e §7): tests/bench-scenarios.mjs's graph node — Prophet-5 + Juno-60 + default Serum into one EQ / chorus
// / delay panel, a chord on all three — through the CPU gate (calibrated, ≤ 1.5 × its node target)
test('§14.1 row r (node gate): three instruments into one shared panel ≤ 1.5 × 0.15', async (t) => {
  const { scenarios } = await import('./bench-scenarios.mjs');
  const S = scenarios().find(s => s.id === 'r'), B = S.build(), D = dspScope({ engine: true, fast: true, console: quiet });
  const p = new D.Proc({ processorOptions: { os: 4, hostOS: 4, offline: true } });
  p.msg(B.graph);
  for (const [id, patch] of Object.entries(B.patches)) { p.msg({ t: 'patch', i: id, p: patch }); tables(p, patch); }
  for (const [id, c] of Object.entries(B.chains)) p.msg(Object.assign({ t: 'chain', c: id }, c));
  for (const [n, v] of B.notes) p.msg({ t: 'on', n, v });
  const o = out(), sec = () => run(D, p, SR / 128, o);
  sec();
  assert.deepEqual([p.insts.map(x => x.kind).join(), p.insts.every(x => x.live === 1), peakOf(o[0][0]) > 0.01], ['analog,analog,serum', true, true]);
  assert.equal(CPU.BENCH.targets.r.node, S.node);
  const best = await CPU.gateLoad(sec, S.node);
  t.diagnostic(`row r: ${best.load.toFixed(4)} calibrated (raw ${best.raw.toFixed(4)}, t(calib) ${best.calib.toFixed(0)} ms, attempt ${best.attempt})`);
  assert.ok(best.load <= 1.5 * S.node, `row r: ${best.load.toFixed(4)} > 1.5 × ${S.node}`);
});

// §9.2 / IMPL-1e §7: the warm-up covers the graph paths — on a warmed scope, a graph node that has been running silently
// (as a track does before it is played: the first render after a patch has costs of its own, 1d's as well) plays its first
// chord through the new paths (two classic Insts at a gain into a shared reverb panel, one straight to OUT: copy-first sums,
// the panel keyed by the Track) and later a power-on restrike, each first quantum ≤ 1.5 × steady state. In a child node (a
// worklet starts from a fresh isolate; this file's earlier scopes leave compiled code behind that changes first-call costs);
// single-quantum timings are noisy: the best of up to 5 fresh scopes counts
test('§9.2 warm-up: the first quantum of the graph paths (first chord, power-on restrike) ≤ 1.5 × steady state (warmed scope, fresh isolate)', async (t) => {
  const { spawnSync } = await import('node:child_process');
  const here = new URL('./', import.meta.url).href, V = '?v=9';
  const code = `
    import '${here}v8-guard.mjs';
    import { dspScope } from '${here}dsp-scope.mjs';
    import * as core from '${here}../serum-core.js${V}';
    import { patchFor, MODELS } from '${here}../models.js${V}';
    const SR = 48000, quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} }, Z = { lo: 0, hi: 127, xp: 0 };
    const classic = id => { const m = MODELS.find(x => x.id === id), p = patchFor(m, Object.fromEntries(m.controls.map(c => [c.id, c.def])), core.defaultFx2(), { sr: SR, bpm: 120 }); delete p.fxr; delete p.fxrT; return p; };
    const fx = core.defaultFx2(), id = core.newInstance(fx, 'rev', { rack: 0 }); fx.racks[0].mods.find(x => x.id === id).p.mix = 0.5;
    const out = [], g = { t: 'graph', insts: ['i1', 'i2', 'i3'].map((id, k) => ({ id, on: true, zone: Z, salt: k * 77 })), chains: [{ id: 'fx1' }],
      edges: [['i1', 'fx1', 1], ['i2', 'fx1', 0.7], ['fx1', 'out', 1], ['i3', 'out', 0.5]], out: 'out' };
    for (let k = 0; k < 5; k++) {
      const D = dspScope({ engine: true, fast: true, console: quiet });
      new D.Proc({ processorOptions: { os: 4, hostOS: 4 } }); // (the first live Track of the scope: the warm-up)
      const p = new D.Proc({ processorOptions: { os: 4, hostOS: 4 } });
      p.msg(g);
      for (const [i, m] of [['i1', 'juno60'], ['i2', 'prophet5'], ['i3', 'minimoog']]) p.msg({ t: 'patch', i, p: classic(m) });
      p.msg({ t: 'chain', c: 'fx1', fxr: core.compileFx(fx, { bpm: 120, rate: SR }), fxrT: core.compileFxT(fx) });
      const o = [[new Float32Array(128), new Float32Array(128)]], q = () => { const t0 = performance.now(); p.process([], o); D.ctx.currentFrame += 128; return performance.now() - t0; };
      const steady = n => { const a = []; for (let j = 0; j < n; j++) a.push(q()); return a.slice(n >> 2).sort((x, y) => x - y)[(n - (n >> 2)) >> 1]; };
      steady(200);
      for (const n of [48, 55, 60, 64]) p.msg({ t: 'on', n, v: 0.8 });
      const f1 = q(), m1 = steady(300);
      p.msg({ t: 'power', i: 'i2', on: false }); steady(100);
      p.msg({ t: 'power', i: 'i2', on: true });
      const f2 = q(), m2 = steady(300);
      out.push([f1, m1, f2, m2]);
      if (f1 / m1 <= 1.5 && f2 / m2 <= 1.5) break;
    }
    console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--max-old-space-size=2048', '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout.trim().split('\n').pop());
  let best = [Infinity, Infinity];
  for (const [f1, m1, f2, m2] of got) {
    best = [Math.min(best[0], f1 / m1), Math.min(best[1], f2 / m2)];
    t.diagnostic(`first chord ${f1.toFixed(3)} ms / steady ${m1.toFixed(3)} ms (× ${(f1 / m1).toFixed(2)}), restrike ${f2.toFixed(3)} / ${m2.toFixed(3)} ms (× ${(f2 / m2).toFixed(2)})`);
  }
  assert.ok(best[0] <= 1.5 && best[1] <= 1.5, `first quantum × ${best.map(x => x.toFixed(2)).join(' / ')} of steady state`);
});

/* ------------------------------------------------------------------ stage 7a: the drum machine (IMPL-7a §12.5, lane E) */
const drPatch = (o, fx) => { const m = MODELS.find(x => x.id === 'tr808'); return patchFor(m, Object.assign(Object.fromEntries(m.controls.map(c => [c.id, c.def])), o || {}), fx || core.defaultFx2(), { sr: SR, bpm: 120 }); };
// a dev.drum playing `rows` (key 1 A, MANUAL PLAY; x: the extras over a new machine's — SYNC on) and its {t: 'seq'} payload
const drMem = (rows, x) => { const d = DC.normDrum(undefined); d.st[0] = rows.slice(); d.ui.mode = DC.M_MAN; Object.assign(d.x, x || {}); return d; };
const drPay = (d, run) => DC.payload(d, Object.assign(DC.initState(), { run: !!run }), 'now');
const FPT8 = SR * 60 / (120 * 960);
const tpPlay = F => ({ t: 'transport', play: true, frame: F, tick: 0, fpt: FPT8, seek: true });
const isDrSeq = q => !!q && typeof q.events === 'function' && typeof q.transport === 'function' && !('pat' in q);
const steps = sent => sent.filter(m => m.t === 'step');

test('7a: a drum Inst from {t: patch} + {t: seq} on the warmed first Track, on a later Track and from processorOptions offline — bit for bit (the warm-up restores the machine, live = offline)', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), P = drPatch({ bdd: 7 }), S = drPay(drMem(DC.DEMO.a));
  const ev = [[30, { t: 'on', n: 38, v: 0.9 }], [31, { t: 'off', n: 38 }], [90, { t: 'on', n: 46, v: 1 }], [120, { t: 'on', n: 64, v: 0.5 }]];
  const live = () => { D.ctx.currentFrame = 0; const { p } = mk(D, { os: 4, hostOS: 4 }, P); p.msg({ t: 'seq', s: S }); p.msg(tpPlay(0)); return { p, o: play(D, p, 300, ev) }; };
  const a = live(), b = live();
  D.ctx.currentFrame = 0;
  const { p: c } = mk(D, { os: 4, hostOS: 4, offline: true, patch: P, seq: S, transport: tpPlay(0) });
  const z = play(D, c, 300, ev);
  assert.deepEqual([a.p.i0.kind, isDrSeq(a.p.i0.sq), !!a.p.i0.dm, c.i0.kind, isDrSeq(c.i0.sq)], ['drums', true, true, 'drums', true]);
  assert.ok(peakOf(a.o.L) > 0.05, 'the pattern sounds');
  assert.ok(sameBits(a.o.L, b.o.L) && sameBits(a.o.R, b.o.R), 'the warmed-up first Track = a later one');
  assert.ok(sameBits(a.o.L, z.L) && sameBits(a.o.R, z.R), 'live = offline (processorOptions)');
});

test('7a: the 808 on a graph node — {t: seq, i}, steps posted with i, the machine audible through its panel; #34: a step with sounds triggers the panel, sets lastNote (its lowest primary) and gates ModCore', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const { p, sent } = gnode(D, graph(['i1'], ['fx1'], [['i1', 'fx1', 1], ['fx1', 'out', 1]]), { i1: drPatch() }, { fx1: fxOf() });
  const x = p.insts[0], r = p.chains[0].rack, tr = r.trigger, mc = [];
  let trig = 0;
  r.trigger = function (...a) { trig++; return tr.apply(this, a); };
  // a stand-in ModCore (the Track's calls only: its span, the notes' gate)
  p.mc = { span() {}, extN: 0, fxv: {}, fxHi: {}, has: {}, transport() {}, noteOn(n, v, h) { mc.push(['on', n, v, h]); }, noteOff(n, h) { mc.push(['off', n, h]); } };
  p.msg({ t: 'seq', i: 'i1', s: drPay(drMem(DC.DEMO.a)) });
  p.msg(tpPlay(D.ctx.currentFrame));
  const o = play(D, p, 120); // (steps 1–3: 6000 frames apart at 120 BPM)
  const st = steps(sent);
  assert.deepEqual([x.kind, isDrSeq(x.sq), st.length > 0, st.every(m => m.i === 'i1' && m.m === 0 && m.k === 0)], ['drums', true, true, true]);
  assert.ok(peakOf(o.L) > 0.05, 'audible through the panel');
  // DEMO a's step 1: AC + BD + CH → lowest primary 36, accented (v 1)
  assert.equal(st[0].s, 0);
  assert.deepEqual(mc[0], ['on', 36, 1, 0], 'ModCore gated by the first step: its lowest primary, accented');
  assert.deepEqual([st.length, x.lastNote], [3, 42], 'lastNote: the last step\'s (step 3: CH alone)');
  assert.ok(trig >= 1, 'the panel\'s RETRIG');
  assert.ok(mc.filter(e => e[0] === 'on').length >= 2 && mc.some(e => e[0] === 'off' && e[2] === 0), 'each step restarts the gate (off then on)');
  p.msg({ t: 'transport', play: false });
  run(D, p, 2);
  assert.equal(mc.at(-1)[0], 'off', 'a stop: the gate off');
  p.mc = null;
});

test('7a power: a powered-off drum machine fires nothing and splits no spans; on again it re-anchors and plays', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const { p, sent } = gnode(D, graph(['i1', 'i2'], ['fx1'], EDGES2), { i1: SINE, i2: drPatch() }, { fx1: fxOf() });
  p.msg({ t: 'seq', i: 'i2', s: drPay(drMem(DC.DEMO.a)) });
  p.msg(tpPlay(D.ctx.currentFrame));
  const spans = [], rs = p.renderSpan, x2 = p.insts[1];
  p.renderSpan = function (Lo, Ro, off, n) { spans.push(n); return rs.call(this, Lo, Ro, off, n); };
  run(D, p, 200);
  assert.ok(steps(sent).length >= 4 && spans.some(n => n < 128) && steps(sent).every(m => m.i === 'i2'), 'running: steps, split spans, {t: step, i}');
  p.msg({ t: 'power', i: 'i2', on: false });
  assert.equal(x2.on, 0);
  run(D, p, 4); // (its 3 ms fade)
  spans.length = 0; sent.length = 0;
  run(D, p, 200);
  assert.deepEqual([steps(sent).length, spans.every(n => n === 128), x2.act, x2.dm.live()], [0, true, 0, false], 'off: nothing fires, nothing splits, silent');
  p.msg({ t: 'power', i: 'i2', on: true });
  assert.equal(x2.sq.syncStep, null, 'power on: re-anchor');
  run(D, p, 200);
  assert.ok(steps(sent).length >= 4 && spans.some(n => n < 128), 'on: it plays again');
});

test('7a co-resident (§6.3): beside a running drum machine an instrument renders on its span grid — the difference is measured and stays below its recorded bound', (t) => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), A = classic('juno60');
  const ev = chordEv(2, 140).concat([[20, { t: 'bend', v: 0.6 }], [40, { t: 'wheel', v: 0.8 }], [70, { t: 'bend', v: -0.3 }], [100, { t: 'wheel', v: 0 }]]);
  // max |difference| / the instrument's peak alone, measured on the M4 Max: 3.9e-7 (−128 dB — the 808's steps split the
  // spans only at its steps, 6000 frames apart at 120 BPM; the TB-303's gate-offs and Serum's ARP split more): the bound 25× above
  const BOUND = 1e-5, S = drPay(drMem(DC.DEMO.b));
  const one = (id, patch, seq) => {
    const { p } = gnode(D, graph([id], ['fx1'], [[id, 'fx1', 1], ['fx1', 'out', 1]]), { [id]: patch }, { fx1: fxOf() });
    if (seq) { p.msg({ t: 'seq', i: id, s: S }); p.msg(tpPlay(D.ctx.currentFrame)); }
    const get = rackIn(p.chains[0].rack); play(D, p, 150, ev); return get();
  };
  D.ctx.currentFrame = 0; const a = one('i1', A, false);
  D.ctx.currentFrame = 0; const b = one('i2', drPatch(), true);
  D.ctx.currentFrame = 0;
  const { p } = gnode(D, graph(['i1', 'i2'], ['fx1'], EDGES2), { i1: A, i2: drPatch() }, { fx1: fxOf() });
  p.msg({ t: 'seq', i: 'i2', s: S }); p.msg(tpPlay(D.ctx.currentFrame));
  const spans = []; const rs = p.renderSpan; p.renderSpan = function (Lo, Ro, off, n) { spans.push(n); return rs.call(this, Lo, Ro, off, n); };
  const get = rackIn(p.chains[0].rack);
  play(D, p, 150, ev);
  const s = get();
  assert.ok(spans.some(n => n < 128), 'its steps split the spans');
  let d = 0;
  for (let i = 0; i < s.L.length; i++) d = Math.max(d, Math.abs(s.L[i] - b.L[i] - a.L[i]), Math.abs(s.R[i] - b.R[i] - a.R[i]));
  const rel = d / peakOf(a.L);
  t.diagnostic(`808: max |sum − (A + B)| = ${d.toExponential(2)} (${rel.toExponential(2)} of A's peak, ${(20 * Math.log10(rel || 1e-30)).toFixed(1)} dB)`);
  assert.ok(peakOf(b.L) > 1e-3 && peakOf(a.L) > 1e-3, 'both sound');
  assert.ok(rel <= BOUND, `${rel} > ${BOUND}`);
});

test('7a OS change (§2.4): {t: os} while the bass drum rings goes through osFade — the machine follows (dm.setOS), no click above −60 dB, it rings on', (t) => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p } = mk(D, { os: 4, hostOS: 4, offline: true }, drPatch({ bdd: 10 }));
  const I = p.i0;
  p.msg({ t: 'on', n: 36, v: 0.8 });
  const o = play(D, p, 120, [[40, { t: 'os', v: 2 }]]);
  assert.deepEqual([I.OS, I.dmOS, I.osPend], [2, 2, 0], 'the machine at OS 2');
  // the click measure: the output's second difference (a ringing 50 Hz drum's is ≈ 1e-5; a step is its own height)
  const d2 = (a, q0, q1) => { let m = 0; for (let i = Math.max(2, q0 * 128); i < q1 * 128; i++) m = Math.max(m, Math.abs(a[i] - 2 * a[i - 1] + a[i - 2])); return m; };
  const before = d2(o.L, 20, 40), change = d2(o.L, 40, 50);
  t.diagnostic(`second difference: before ${(20 * Math.log10(before)).toFixed(1)} dB, over the change ${(20 * Math.log10(change)).toFixed(1)} dB`);
  assert.ok(change < 1e-3, `second difference over the change ${(20 * Math.log10(change)).toFixed(1)} dB ≥ −60 dB`);
  assert.ok(peakOf(o.L.subarray(60 * 128, 120 * 128)) > 0.02, 'it rings on after the change');
});

test('7a modulation (§9): a modRows row on drum.bdd through the real moRec moves the bass drum\'s decay; a switch row writes its field too (struct: the host never sends one)', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const tail = v => {
    const { p } = mk(D, { os: 4, hostOS: 4, offline: true }, drPatch());
    const I = p.i0, rs = I.renderSpan, sv = [{ field: 'drum.bdd', v }];
    if (v !== null) { I.modRows([{ field: 'drum.bdd' }]); assert.deepEqual([I.moFN, I.moN], [1, 0]); I.renderSpan = function (n) { this.modSpan(null, null, sv); return rs.call(this, n); }; }
    p.msg({ t: 'on', n: 36, v: 0.8 });
    const o = play(D, p, 200);
    let e = 0; for (let i = 100 * 128; i < 200 * 128; i++) e += o.L[i] * o.L[i];
    return { e, bdd: I.p.drum.bdd };
  };
  const base = tail(null), long = tail(1), short = tail(0);
  assert.deepEqual([base.bdd, long.bdd, short.bdd], [0.5, 1, 0], 'the effective value is in p.drum');
  assert.ok(long.e > 4 * base.e && short.e < base.e / 4, `the decay follows the cable (${short.e.toExponential(2)} < ${base.e.toExponential(2)} < ${long.e.toExponential(2)})`);
});

test('7a kind changes (§1.1, §15 #13): 303 → 808 → 303 each keeps its own sq; a 303 payload never lands in a DrSeq; a drum payload before the drums patch is kept', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p } = mk(D, { os: 4, hostOS: 4, offline: true }, classic('tb303'));
  const I = p.i0, S303 = Object.assign({}, SEQ, { sync: false, run: true });
  p.msg({ t: 'seq', s: Object.assign({}, S303) });
  assert.ok(I.sq && Array.isArray(I.sq.pat) && I.sq.run, 'the TB-303 sequencer');
  run(D, p, 20);
  const S = drPay(drMem(DC.DEMO.a, { sync: false }), true);
  p.msg({ t: 'seq', s: S }); // (before the drums patch: kept)
  assert.ok(!isDrSeq(I.sq) && isDrSeq(I.drPend), 'kept apart from the 303\'s');
  p.msg({ t: 'patch', p: drPatch() });
  assert.deepEqual([I.kind, isDrSeq(I.sq), I.drPend, I.sq.run, I.sq.pl && I.sq.pl.key], ['drums', true, null, true, S.plan.key], 'the waiting payload is the drum sequencer');
  const D0 = I.sq;
  p.msg({ t: 'seq', s: Object.assign({}, S303) }); // a 303 payload reaching a drums Inst: dropped
  assert.ok(I.sq === D0 && !('pat' in D0) && !('root' in D0), 'nothing written into the DrSeq');
  assert.ok(peakOf(play(D, p, 100).L) > 0.05, 'the free-running pattern plays');
  p.msg({ t: 'patch', p: classic('tb303') });
  assert.deepEqual([I.kind, I.sq], ['analog', null], 'back to the 303: the DrSeq dropped');
  p.msg({ t: 'seq', s: Object.assign({}, S303) });
  assert.ok(I.sq && Array.isArray(I.sq.pat) && !isDrSeq(I.sq), 'a fresh TB-303 sequencer');
  assert.ok(peakOf(play(D, p, 100).L) > 1e-3);
});

test('7a panic (§1.1): a panic while the bass drum rings is silent after the 5 ms fade (the machine reset, no tail resumes)', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p } = mk(D, { os: 4, hostOS: 4, offline: true }, drPatch({ bdd: 10 }));
  p.msg({ t: 'on', n: 36, v: 1 });
  const a = play(D, p, 20);
  assert.ok(peakOf(a.L.subarray(10 * 128)) > 0.05, 'ringing');
  p.msg({ t: 'panic' });
  // the output stage's input (as the 1e panic test: its DC block then decays what it held of a 50 Hz drum, its own 4 Hz memory)
  const os = p.outStage;
  let after = 0, k = 0;
  p.outStage = function (Lo, Ro, off, n) { if (k >= 3) for (let i = 0; i < n; i++) after = Math.max(after, Math.abs(this.Lb[i]), Math.abs(this.Rb[i])); return os.call(this, Lo, Ro, off, n); };
  for (; k < 40; k++) run(D, p, 1);
  assert.ok(!p.i0.dm.live() && p.pnN === 0 && p.i0.tailN === 0, 'cleared');
  assert.ok(after < 1e-6, `silent after the fade (${after})`);
});

test('7a: a drums Inst renders without allocating — the synced pattern, notes (DrSeq\'s step-post literal aside)', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p } = mk(D, { os: 4, hostOS: 4, offline: true }, drPatch());
  p.msg({ t: 'seq', s: drPay(drMem(DC.DEMO.b)) }); p.msg(tpPlay(D.ctx.currentFrame));
  const o = out();
  run(D, p, 200, o);
  let pk = 0;
  noAlloc(D, () => { for (let k = 0; k < 400; k++) { if (k === 100) p.noteOn(38, 0.9); if (k === 101) p.noteOff(38); p.process([], o); D.ctx.currentFrame += 128; for (const v of o[0][0]) if (Math.abs(v) > pk) pk = Math.abs(v); } });
  assert.ok(pk > 0.05, 'it played');
});

// IMPL-7a §2.6 / §12.5: the bench rows through the CPU gate (calibrated, ≤ 1.5 × the node target) and d8i — the machine
// powered, synced, the transport stopped, nothing sounding, past the 2 s quiet window — gated as row p is
test('7a bench rows (node gate): d8p, d8x, d8m, d8s ≤ 1.5 × their targets; d8i (an idle synced machine) ≤ 1.5 × 0.0005', async (t) => {
  const { scenarios, drumTrack, DRUM_PATTERNS } = await import('./bench-scenarios.mjs');
  const D = dspScope({ engine: true, fast: true, console: quiet }), SB = D.global('SxBase');
  const node = B => {
    if (B.assets) for (const [id, e] of Object.entries(B.assets)) SB.storeAsset(id, e);
    const p = new D.Proc({ processorOptions: { os: 4, hostOS: 4, offline: true } });
    p.msg(B.graph);
    for (const [id, patch] of Object.entries(B.patches)) p.msg({ t: 'patch', i: id, p: patch });
    for (const [id, c] of Object.entries(B.chains)) p.msg(Object.assign({ t: 'chain', c: id }, c));
    for (const [id, s] of Object.entries(B.seqs)) p.msg({ t: 'seq', i: id, s });
    return p;
  };
  for (const S of scenarios().filter(s => s.id.startsWith('d8'))) {
    const B = S.build(), p = node(B);
    p.msg(Object.assign({ t: 'transport' }, B.transport, { frame: D.ctx.currentFrame }));
    const o = out(), sec = () => run(D, p, SR / 128, o);
    sec();
    assert.ok(peakOf(o[0][0]) > 0.01 && p.insts[0].kind === 'drums', S.id + ': audible');
    assert.equal(CPU.BENCH.targets[S.id].node, S.node);
    const best = await CPU.gateLoad(sec, S.node);
    t.diagnostic(`row ${S.id}: ${best.load.toFixed(4)} calibrated (raw ${best.raw.toFixed(4)}, t(calib) ${best.calib.toFixed(0)} ms, attempt ${best.attempt})`);
    assert.ok(best.load <= 1.5 * S.node, `row ${S.id}: ${best.load.toFixed(4)} > 1.5 × ${S.node}`);
  }
  // d8i: d8p's machine with the transport stopped
  const p = node(drumTrack(DRUM_PATTERNS.d8p)), o = out(), sec = () => run(D, p, SR / 128, o);
  sec(); sec(); sec();
  const x = p.insts[0];
  assert.ok(x.quietF > 2 * SR && x.act === 0 && isDrSeq(x.sq) && x.sq.sync && o[0][0].every(v => v === 0), 'd8i: the skip path, silent');
  const target = CPU.BENCH.targets.d8i.node, best = await CPU.gateLoad(sec, target);
  t.diagnostic(`row d8i: ${best.load.toFixed(5)} calibrated (raw ${best.raw.toFixed(5)}, attempt ${best.attempt})`);
  assert.ok(best.load <= 1.5 * target, `row d8i: ${best.load.toFixed(5)} > 1.5 × ${target}`);
});
