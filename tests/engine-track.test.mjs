// The Track / Inst / Chain engine (SPEC-canvas §6.2–6.4, §6.8, §10 1d): the structure every path builds, the
// compatibility facade (fields, methods, overrides through it), the hosts the voice code sees (only Inst objects), the
// stats per Inst / Chain, the monitor subscriptions by id ({t: 'mon', ids}), the idle skip per Inst and per Track, and
// the warm-up's restore. Stage 1e (IMPL-1e §2, §7): several Insts per track — adoption of i0 / c0 by the first graph,
// the copy-first sum, the co-resident sequencer bound, salts, power (sequencers, clicks, load, controller state, restrike),
// zones, MIDI OUT into a graph node, stats.per / smon / fxph / fxtap / fxover per part, removal, processorOptions = messages,
// the warmed graph paths, row r. Bit-exactness against the pre-split engine: tests/golden-graph.test.mjs. Stage 7a (IMPL-7a
// §12.5, lane E): the drum family — Inst kind 'drums' (patch / processorOptions, the warm-up's restore, a graph node, power,
// the co-resident span grid, the OS fade, a cable on drum.bdd, kind changes and their sequencers, panic, #34, no allocation)
// and the bench rows d8p / d8x / d8m / d8s and d8i through the CPU gate. Stage 7b (IMPL-7b §12.5, lane E6): the TR-606 —
// patch / processorOptions / the warm-up's restore, the 808 ↔ 606 machine change (each machine kept, a fresh DrSeq, a payload
// before its patch waiting in drPend, the tail's level), drClock, a graph node, the OS fade, a cable on drum.tml, panic, no
// allocation, and the bench rows d6p / d6x / d6m and d6i. Stage 7c (IMPL-7c §12.5, lane E9): the TR-909 — patch /
// processorOptions / the warm-up's restore (its chip swap's stand-in gone, the ROM images shared), 808 → 606 → 909 → 808 on
// one Inst, the tail's level across every pair with the 909, a graph node (#34's state velocity, a flam's own hook), the OS
// fade, a cable on drum.cru (the crash's clock), panic, no allocation (a chip swap converted inside), and the bench rows
// d9p / d9x / d9m and d9i. Stage 9 (IMPL-9 §3.1, §8.3, lane E9): the patch family — Inst kind 'patch' over patch-dsp.js and
// moog-dsp.js: {t: patch} + the graph payload, live = offline, the warm-up's machine left fresh and what it covered, pmPend, kind
// changes and their tails, the OS fade, panic, power (P-1), Play from a stop (P-2), the restart's fade-in, idle, zones, drift,
// the presets' headroom, the scripts missing, no allocation, and the bench rows m9p / m9x / m9d.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dspScope, noAlloc } from './dsp-scope.mjs';
import * as core from '../serum-core.js?v=9';
import * as W from '../wt.js?v=9';
import { patchFor, MODELS } from '../models.js?v=9';
import * as CPU from './cpu-gate.mjs';
import * as DC from '../drum-core.js?v=9';
import { songV, DRUM_PATTERNS } from './bench-scenarios.mjs';
import * as MG from '../moog-core.js?v=9';
import * as PT from '../patch-core.js?v=9';

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

test('stats per Inst / Chain: {t: stats, load, voices, snd, os, per: [{id: i0, load, voices, os}, {id: c0, load}]} — the Chain its own processing time, the Inst the rest; snd 1 while a voice sounded in the window (idle-DSP review #9)', () => {
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
      assert.deepEqual(Object.keys(m).sort(), ['load', 'os', 'per', 'snd', 't', 'voices'], name);
      assert.equal(m.snd, 1, name + ': the chord sounds through both windows');
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

/* ------------------------------------------------------------------ stage 7b: the TR-606 (IMPL-7b §1.5, §12.5, lane E6) */
const dr6Patch = (o, fx, bpm = 120) => { const m = MODELS.find(x => x.id === 'tr606'); return patchFor(m, Object.assign(Object.fromEntries(m.controls.map(c => [c.id, c.def])), o || {}), fx || core.defaultFx2(), { sr: SR, bpm }); };
// a 606 record playing pattern I-1 = rows (a new machine: PATTERN PLAY, SYNC on; x over it) and its {t: 'seq'} payload
const dr6Mem = (rows, x) => { const d = DC.normDrum(undefined, 'tr606'); d.st[0] = rows.slice(); Object.assign(d.x, x || {}); return d; };
const dr6Pay = (d, run) => DC.payload(d, Object.assign(DC.initState('tr606'), { run: !!run }), 'now');
const machOf = I => (I.dm ? I.dm._mach : null), keyOf = I => (isDrSeq(I.sq) && I.sq.pl ? I.sq.pl.key : null);

test('7b: a 606 Inst from {t: patch} + {t: seq} on the warmed first Track, on a later Track and from processorOptions offline — bit for bit, its own machine', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), P = dr6Patch({ bdd: 7, ohd: 8 }), S = dr6Pay(dr6Mem(DC.DEMO606.a));
  const ev = [[30, { t: 'on', n: 38, v: 0.9 }], [31, { t: 'off', n: 38 }], [90, { t: 'on', n: 46, v: 1 }], [92, { t: 'on', n: 39, v: 1 }], [120, { t: 'on', n: 41, v: 0.5 }]];
  const live = () => { D.ctx.currentFrame = 0; const { p } = mk(D, { os: 4, hostOS: 4 }, P); p.msg({ t: 'seq', s: S }); p.msg(tpPlay(0)); return { p, o: play(D, p, 300, ev) }; };
  const a = live(), b = live();
  D.ctx.currentFrame = 0;
  const { p: c } = mk(D, { os: 4, hostOS: 4, offline: true, patch: P, seq: S, transport: tpPlay(0) });
  const z = play(D, c, 300, ev);
  assert.deepEqual([a.p.i0.kind, machOf(a.p.i0), isDrSeq(a.p.i0.sq), b.p.i0.drPend === null, machOf(c.i0), isDrSeq(c.i0.sq)], ['drums', 'tr606', true, true, 'tr606', true]);
  assert.equal(P.machine, 'tr606');
  assert.ok(peakOf(a.o.L) > 0.05, 'the pattern sounds');
  assert.ok(sameBits(a.o.L, b.o.L) && sameBits(a.o.R, b.o.R), 'the warmed-up first Track = a later one (restore leaves a fresh 606)');
  assert.ok(sameBits(a.o.L, z.L) && sameBits(a.o.R, z.R), 'live = offline (processorOptions)');
});

// review #1 / #2: an 808 ↔ 606 switch (the kind stays 'drums') is a machine change — each machine its own (built once per Inst,
// kept), a fresh DrSeq each time; the new machine's payload may overtake its patch (sendPatch waits for assets, drumSend posts at
// once): it waits in drPend while the old machine plays on, and the patch adopts it
test('7b machine change (§1.5, review #1 / #2): 808 → 606 → 808 on one Inst — its own machine each, a fresh DrSeq; a payload before its patch waits in drPend and plays, one after it too', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p, sent } = mk(D, { os: 4, hostOS: 4, offline: true }, drPatch());
  const I = p.i0;
  p.msg({ t: 'seq', s: drPay(drMem(DC.DEMO.a)) }); p.msg(tpPlay(D.ctx.currentFrame));
  run(D, p, 60);
  const m8 = I.dm, q8 = I.sq;
  assert.deepEqual([machOf(I), isDrSeq(q8), steps(sent).length > 0], ['tr808', true, true]);
  const S6 = dr6Pay(dr6Mem(DC.DEMO606.a));
  assert.equal(S6.m, 'tr606');
  p.msg({ t: 'seq', s: S6 }); // (the payload first: the 808 still plays)
  const pend = I.drPend;
  assert.ok(isDrSeq(pend) && I.sq === q8 && I.dm === m8, 'kept apart: the 808 keeps its sequencer');
  assert.ok(pend.pl && pend.pl.key === S6.plan.key, 'the waiting DrSeq holds the 606\'s plan');
  sent.length = 0; run(D, p, 60);
  assert.ok(steps(sent).length > 0, 'the 808 plays on meanwhile');
  p.msg({ t: 'patch', p: dr6Patch() });
  assert.deepEqual([I.kind, machOf(I), I.sq === pend, I.drPend === null, I.dm !== m8], ['drums', 'tr606', true, true, true], 'the patch adopts the waiting payload');
  sent.length = 0;
  const o6 = play(D, p, 200);
  assert.ok(steps(sent).length >= 4 && steps(sent).every(m => m.k === 0), 'the 606 plays its synced pattern (I-1)');
  assert.ok(peakOf(o6.L.subarray(40 * 128)) > 0.05, 'audible');
  const m6 = I.dm, q6 = I.sq;
  // back to the 808, its payload after the patch this time
  p.msg({ t: 'patch', p: drPatch() });
  assert.deepEqual([machOf(I), I.dm === m8, I.sq === null, I.drPend === null], ['tr808', true, true, true], 'the 808\'s own machine again (kept), no sequencer yet');
  p.msg({ t: 'seq', s: drPay(drMem(DC.DEMO.b)) });
  assert.ok(isDrSeq(I.sq) && I.sq !== q8 && I.sq !== q6, 'a fresh DrSeq');
  sent.length = 0; run(D, p, 200);
  assert.ok(steps(sent).length >= 4, 'the 808 plays again');
  p.msg({ t: 'patch', p: dr6Patch({ ac: 3 }) });
  assert.deepEqual([I.dm === m6, I.sq === null], [true, true], 'and the 606\'s, kept');
});

test('7b machine change (§1.5): drOn adopts a waiting payload only for its own machine; a payload for the playing machine is its own; 303 → 606 keeps one too', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p } = mk(D, { os: 4, hostOS: 4, offline: true }, dr6Patch());
  const I = p.i0;
  p.msg({ t: 'seq', s: drPay(drMem(DC.DEMO.a)) }); // an 808 payload (no m) on a 606: waits
  assert.deepEqual([I.sq === null, isDrSeq(I.drPend)], [true, true]);
  const S6 = dr6Pay(dr6Mem(DC.DEMO606.b));
  p.msg({ t: 'seq', s: S6 }); // the 606's own: its sequencer; the 808's still waits
  assert.ok(isDrSeq(I.sq) && I.sq.pl.key === S6.plan.key && isDrSeq(I.drPend));
  p.msg({ t: 'patch', p: dr6Patch({ ac: 9 }) }); // (the same machine: no boundary)
  assert.ok(isDrSeq(I.drPend) && I.sq.pl.key === S6.plan.key, 'a knob turn changes nothing');
  const S8b = drPay(drMem(DC.DEMO.b));
  p.msg({ t: 'seq', s: S8b }); // a newer 808 payload replaces the waiting one
  p.msg({ t: 'patch', p: drPatch() });
  assert.deepEqual([machOf(I), I.drPend === null, keyOf(I)], ['tr808', true, S8b.plan.key], 'the newest waiting payload adopted');
  // a waiting payload for another machine than the patch that arrives: dropped
  p.msg({ t: 'patch', p: classic('tb303') });
  p.msg({ t: 'seq', s: S6 });
  assert.ok(isDrSeq(I.drPend));
  p.msg({ t: 'patch', p: drPatch() });
  assert.deepEqual([machOf(I), I.sq === null, I.drPend === null], ['tr808', true, true], 'a 606 payload never drives the 808');
  // 303 → 606 with the payload first (7a's order, the 606's machine)
  p.msg({ t: 'patch', p: classic('tb303') });
  p.msg({ t: 'seq', s: S6 });
  p.msg({ t: 'patch', p: dr6Patch() });
  assert.deepEqual([machOf(I), I.drPend === null, keyOf(I)], ['tr606', true, S6.plan.key]);
  // an unknown machine: no machine (the drumsErr notice), silent, nothing thrown ('tr999': since 7c the 909 is a machine)
  const { p: q, sent } = mk(D, { os: 4, hostOS: 4, offline: true }, Object.assign(dr6Patch(), { machine: 'tr999' }));
  q.msg({ t: 'on', n: 36, v: 1 });
  const o = play(D, q, 20);
  assert.deepEqual([q.i0.kind, q.i0.dm === null, peakOf(o.L), sent.filter(m => m.t === 'drumsErr').length], ['drums', true, 0, 1]);
});

// the tail of a sounding machine crossing the switch keeps its level through each machine's own output stage (Dr808.gain):
// the 808 at its default VOLUME into a 606 at 5 and back (gains 0.69 / 0.16 FS a bus volt: a step the conversion must hide).
// Measured on the Inst's output (before the Track's DC block and look-ahead limiter). (The tail passes the new machine's
// stage, rails included: the 606's summing amplifier clips at −6 / +7.5 V before its VOLUME, so a tail above 6 V × its gain —
// 2.6 FS at its default VOLUME, 0.35 FS at 3 — is clipped there, as that stage would.) Not gated, a diagnostic: a machine's
// post starts its 220 p low-passes from rest after reset(), so the first samples of a tail entering it (analog → 808 as in 7a,
// 808 ↔ 606) dip and ring for ≈ 4 samples — dr-808.js's, recorded in IMPL-7b §14 lane E6
test('7b machine change (§1.5): the de-click tail crossing 808 → 606 and 606 → 808 keeps its level (each machine\'s gain) — no click above −60 dB past the post\'s first samples', (t) => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), G = D.global('Dr808');
  const d2 = (a, i0, i1) => { let m = 0; for (let i = Math.max(2, i0); i < i1; i++) m = Math.max(m, Math.abs(a[i] - 2 * a[i - 1] + a[i - 2])); return m; };
  const dB = x => (20 * Math.log10(x)).toFixed(1);
  for (const [A, B, n, ma, mb] of [[drPatch({ bdd: 10 }), dr6Patch({ vol: 5 }), 36, 'tr808', 'tr606'], [dr6Patch({ ltd: 10, vol: 5 }), drPatch(), 41, 'tr606', 'tr808']]) {
    const { p } = mk(D, { os: 4, hostOS: 4, offline: true }, A), I = p.i0, rs = I.renderSpan, L = new Float64Array(60 * 128);
    let at = 0;
    I.renderSpan = function (k) { const v = rs.call(this, k); L.set(this.Lb.subarray(0, k), at); at += k; return v; };
    p.msg({ t: 'on', n, v: 0.8 });
    play(D, p, 60, [[40, { t: 'patch', p: B }]]);
    const S = 40 * 128, ga = G.gain(ma, A.drum), gb = G.gain(mb, B.drum);
    const before = d2(L, 20 * 128, S), first = d2(L, S, S + 8), change = d2(L, S + 8, S + 256), pre = Math.abs(L[S - 1]), post = Math.abs(L[S + 8]);
    t.diagnostic(`${ma} → ${mb}: gains ${ga.toFixed(4)} / ${gb.toFixed(4)}; second difference before ${dB(before)} dB, the post's first 8 samples ${dB(first)} dB, then ${dB(change)} dB; |sample 8 after| / |last before| ${(post / pre).toFixed(3)}`);
    assert.equal(machOf(I), mb);
    assert.ok(Math.max(ga / gb, gb / ga) > 4, 'the two stages differ');
    assert.ok(pre > 0.05 && post / pre > 0.8 && post / pre < 1.25, `the level kept (${pre} → ${post})`);
    assert.ok(change < 1e-3, `second difference over the change ${dB(change)} dB ≥ −60 dB`);
  }
});

// review 1 #3 (7b fixes): a loud 808 (driving the Track's limiter) replaced by a 606 — its de-click tail used to enter the
// 606's bus and clip at IC14A's rails (−0.760 → −0.177 in one sample at the default VOLUME); now it is mixed after the new
// machine's output stage, so the Track's output is the same whatever the 606's VOLUME, and continues as a switch to an
// analog model's does (7a's path, unchanged); the tail drains (its chain left empty) and the Inst goes quiet
test('7b review 1 #3: an 808 ↔ 606 switch mixes the old machine\'s tail after the new output stage — the Track output continues at its level at any VOLUME (as 808 → Minimoog), drains, leaves its chain empty; 606 → 808 too', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const BD = { bdl: 10, vol: 10, bdd: 10 }, S = 40 * 128;
  const go = (A, B, n) => { const { p } = mk(D, { os: 4, hostOS: 4, offline: true }, A); p.msg({ t: 'on', n, v: 1 }); const r = play(D, p, 80, [[40, { t: 'patch', p: B }]]); return { p, L: r.L }; };
  const moog = go(drPatch(BD), classic('minimoog'), 36), runs = [7.5, 2, 10].map(vol => go(drPatch(BD), dr6Patch({ vol }), 36));
  const pre = Math.abs(moog.L[S - 1]);
  assert.ok(pre > 0.5, 'the 808 drives the limiter (' + pre + ')');
  for (const [j, r] of runs.entries()) {
    const ratio = Math.abs(r.L[S]) / Math.abs(r.L[S - 1]);
    assert.ok(ratio > 0.8 && ratio < 1.25, `VOLUME ${[7.5, 2, 10][j]}: the level kept at the switch (${r.L[S - 1]} → ${r.L[S]})`);
    let d = 0; for (let i = S; i < S + 8 * 128; i++) d = Math.max(d, Math.abs(r.L[i] - moog.L[i]));
    assert.ok(d < 0.05, `VOLUME ${[7.5, 2, 10][j]}: as the switch to an analog model (max |Δ| ${d.toFixed(4)} over 8 quanta)`);
    let e = 0; for (let i = S; i < S + 8 * 128; i++) e = Math.max(e, Math.abs(r.L[i] - runs[0].L[i]));
    assert.equal(e, 0, 'the tail never meets the new machine\'s VOLUME');
    const I = r.p.i0;
    assert.deepEqual([machOf(I), I.tailON, I.decO.every(h => h.buf.every(x => x === 0))], ['tr606', 0, true], 'drained, its chain empty');
  }
  // 606 → 808: the toms ringing at VOLUME 10 into an 808 at MASTER VOLUME 0.5 — kept, as 606 → Minimoog
  const a = go(dr6Patch({ ltd: 10, vol: 10, tml: 10 }), drPatch({ vol: 0.5 }), 41), b = go(dr6Patch({ ltd: 10, vol: 10, tml: 10 }), classic('minimoog'), 41);
  let d = 0; for (let i = S; i < S + 8 * 128; i++) d = Math.max(d, Math.abs(a.L[i] - b.L[i]));
  assert.ok(Math.abs(a.L[S - 1]) > 0.05 && d < 0.05, `606 → 808: as 606 → an analog model (max |Δ| ${d.toFixed(4)})`);
});

// review #6: the clock a 606 reads without a transport — a fresh node's tp.fpt is 1 frame a tick until the first {t:
// 'transport'}: the Inst's bpm (the patch's, the project's) instead; a stopped synced DrSeq the same; playing, the song's ticks
test('7b drClock (§1.5, review #6): before any transport the Inst\'s bpm, not tp.fpt = 1; a stopped synced DrSeq reads the same; playing, the song\'s ticks; free and running, the machine\'s own', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p } = mk(D, { os: 4, hostOS: 4, offline: true }, dr6Patch(null, null, 97));
  const I = p.i0, fpt = SR * 60 / (97 * 960), F = 123457;
  assert.equal(p.tp.fpt, 1, 'a fresh node: 1 frame a tick');
  const a = Object.assign({}, I.drClock(F));
  assert.deepEqual(a, { t: F / fpt, tpf: 1 / fpt }, 'no DrSeq: the patch\'s 97 BPM');
  p.msg({ t: 'seq', s: dr6Pay(dr6Mem(DC.DEMO606.a)) });
  assert.deepEqual(Object.assign({}, I.drClock(F)), a, 'a synced DrSeq, stopped: the same clock');
  const F0 = D.ctx.currentFrame;
  p.msg(Object.assign(tpPlay(F0), { tick: 480 })); run(D, p, 1);
  assert.deepEqual(Object.assign({}, I.drClock(F)), { t: p.tp.tick + (F - p.tp.frame) / FPT8, tpf: 1 / FPT8 }, 'playing: the song\'s ticks');
  const { p: q } = mk(D, { os: 4, hostOS: 4, offline: true }, dr6Patch());
  q.msg(Object.assign(tpPlay(D.ctx.currentFrame), { tick: 480 })); run(D, q, 1);
  assert.deepEqual(Object.assign({}, q.i0.drClock(F)), { t: q.tp.tick + (F - q.tp.frame) / FPT8, tpf: 1 / FPT8 }, 'no DrSeq, playing: the same expression (D5: the roll path)');
  assert.ok(Math.abs(q.i0.drClock(F).t - (480 + (F - D.ctx.currentFrame + 128) / FPT8)) < 1e-6);
  const fr = dr6Mem(DC.DEMO606.a, { sync: false }); fr.ui.tempo = 150;
  q.msg({ t: 'seq', s: dr6Pay(fr, true) });
  run(D, q, 3);
  const c = q.i0.drClock(D.ctx.currentFrame + 64);
  assert.ok(Math.abs(c.tpf - 150 * 960 / (60 * SR)) < 1e-15, 'free and running: its TEMPO');
});

test('7b: the 606 on a graph node — {t: seq, i}, steps posted with i, audible through its panel; #34 as the 808 (lastNote, ModCore gated)', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const { p, sent } = gnode(D, graph(['i1'], ['fx1'], [['i1', 'fx1', 1], ['fx1', 'out', 1]]), { i1: dr6Patch() }, { fx1: fxOf() });
  const x = p.insts[0], mc = [];
  p.mc = { span() {}, extN: 0, fxv: {}, fxHi: {}, has: {}, transport() {}, noteOn(n, v, h) { mc.push(['on', n, v, h]); }, noteOff(n, h) { mc.push(['off', n, h]); } };
  p.msg({ t: 'seq', i: 'i1', s: dr6Pay(dr6Mem(DC.DEMO606.a)) });
  p.msg(tpPlay(D.ctx.currentFrame));
  const o = play(D, p, 120);
  const st = steps(sent);
  assert.deepEqual([x.kind, machOf(x), isDrSeq(x.sq), st.length, st.every(m => m.i === 'i1' && m.k === 0)], ['drums', 'tr606', true, 3, true]);
  assert.ok(peakOf(o.L) > 0.05, 'audible through the panel');
  assert.deepEqual(mc[0], ['on', 36, 1, 0], 'step 1 (AC + BD + CH): its lowest primary, accented');
  assert.equal(x.lastNote, 46, 'step 3: OH alone');
  p.mc = null;
});

test('7b OS change (§2.4): {t: os} while the toms ring goes through osFade — the 606 follows (setOS), no click above −60 dB, they ring on; a kept machine catches up', (t) => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p } = mk(D, { os: 4, hostOS: 4, offline: true }, dr6Patch({ ltd: 10, htd: 10 }));
  const I = p.i0;
  p.msg({ t: 'on', n: 41, v: 0.8 });
  const o = play(D, p, 120, [[40, { t: 'os', v: 2 }]]);
  assert.deepEqual([I.OS, I.dmOS, I.osPend, machOf(I)], [2, 2, 0, 'tr606']);
  const d2 = (a, q0, q1) => { let m = 0; for (let i = Math.max(2, q0 * 128); i < q1 * 128; i++) m = Math.max(m, Math.abs(a[i] - 2 * a[i - 1] + a[i - 2])); return m; };
  const before = d2(o.L, 20, 40), change = d2(o.L, 40, 50);
  t.diagnostic(`second difference: before ${(20 * Math.log10(before)).toFixed(1)} dB, over the change ${(20 * Math.log10(change)).toFixed(1)} dB`);
  assert.ok(change < 1e-3, `second difference over the change ${(20 * Math.log10(change)).toFixed(1)} dB ≥ −60 dB`);
  assert.ok(peakOf(o.L.subarray(60 * 128, 120 * 128)) > 0.01, 'they ring on');
  // a machine kept across an OS change made while the other one played catches up when it comes back
  p.msg({ t: 'patch', p: drPatch() }); run(D, p, 4); p.msg({ t: 'os', v: 4 }); run(D, p, 10);
  p.msg({ t: 'patch', p: dr6Patch() });
  assert.deepEqual([I.OS, I.dmOS, I.dm._M.OS, machOf(I)], [4, 4, 4, 'tr606'], 'the cached 606 at the Inst\'s OS');
});

test('7b modulation (§9, §12.5): a modRows row on drum.tml (the toms\' shared LEVEL) through the real moRec moves both toms', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const toms = v => {
    const { p } = mk(D, { os: 4, hostOS: 4, offline: true }, dr6Patch());
    const I = p.i0, rs = I.renderSpan, sv = [{ field: 'drum.tml', v }];
    if (v !== null) { I.modRows([{ field: 'drum.tml' }]); assert.deepEqual([I.moFN, I.moN], [1, 0]); I.renderSpan = function (n) { this.modSpan(null, null, sv); return rs.call(this, n); }; }
    p.msg({ t: 'on', n: 41, v: 0.8 }); p.msg({ t: 'on', n: 48, v: 0.8 });
    const o = play(D, p, 60);
    let e = 0; for (let i = 10 * 128; i < 60 * 128; i++) e += o.L[i] * o.L[i];
    return { e, tml: I.p.drum.tml };
  };
  const base = toms(null), up = toms(1), down = toms(0.1);
  assert.deepEqual([base.tml, up.tml, down.tml], [0.7, 1, 0.1]);
  assert.ok(up.e > 1.2 * base.e && down.e < base.e / 4, `the level follows the cable (${down.e.toExponential(2)} < ${base.e.toExponential(2)} < ${up.e.toExponential(2)})`);
});

test('7b panic (§1.1): a panic while the toms ring is silent after the fade (the 606 reset, no tail resumes)', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p } = mk(D, { os: 4, hostOS: 4, offline: true }, dr6Patch({ ltd: 10, htd: 10 }));
  p.msg({ t: 'on', n: 41, v: 1 }); p.msg({ t: 'on', n: 48, v: 1 });
  const a = play(D, p, 20);
  assert.ok(peakOf(a.L.subarray(10 * 128)) > 0.05, 'ringing');
  p.msg({ t: 'panic' });
  const os = p.outStage;
  let after = 0, k = 0;
  p.outStage = function (Lo, Ro, off, n) { if (k >= 3) for (let i = 0; i < n; i++) after = Math.max(after, Math.abs(this.Lb[i]), Math.abs(this.Rb[i])); return os.call(this, Lo, Ro, off, n); };
  for (; k < 40; k++) run(D, p, 1);
  assert.ok(!p.i0.dm.live() && p.pnN === 0 && p.i0.tailN === 0, 'cleared');
  assert.ok(after < 1e-6, `silent after the fade (${after})`);
});

test('7b: a 606 renders without allocating — the synced pattern, an open hat ringing on the tempo clock, notes', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p } = mk(D, { os: 4, hostOS: 4, offline: true }, dr6Patch({ ohd: 10 }));
  p.msg({ t: 'seq', s: dr6Pay(dr6Mem(DC.DEMO606.b)) }); p.msg(tpPlay(D.ctx.currentFrame));
  const o = out();
  run(D, p, 200, o);
  let pk = 0;
  noAlloc(D, () => { for (let k = 0; k < 400; k++) { if (k === 100) p.noteOn(46, 1); if (k === 101) p.noteOff(46); p.process([], o); D.ctx.currentFrame += 128; for (const v of o[0][0]) if (Math.abs(v) > pk) pk = Math.abs(v); } });
  assert.ok(pk > 0.05, 'it played');
});

// IMPL-7b §2.6 / §12.5: the 606's bench rows through the CPU gate (calibrated, ≤ 1.5 × the node target) and d6i — the machine
// powered, synced, the transport stopped, nothing sounding, past the 2 s quiet window — gated as row p is (7a's method)
test('7b bench rows (node gate): d6p, d6x, d6m ≤ 1.5 × their targets; d6i (an idle synced 606) ≤ 1.5 × 0.0005', async (t) => {
  const { scenarios, drumTrack, DRUM_PATTERNS } = await import('./bench-scenarios.mjs');
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const node = B => {
    const p = new D.Proc({ processorOptions: { os: 4, hostOS: 4, offline: true } });
    p.msg(B.graph);
    for (const [id, patch] of Object.entries(B.patches)) p.msg({ t: 'patch', i: id, p: patch });
    for (const [id, c] of Object.entries(B.chains)) p.msg(Object.assign({ t: 'chain', c: id }, c));
    for (const [id, s] of Object.entries(B.seqs)) p.msg({ t: 'seq', i: id, s });
    return p;
  };
  const rows = scenarios().filter(s => s.id.startsWith('d6'));
  assert.deepEqual(rows.map(s => s.id), ['d6p', 'd6x', 'd6m']);
  for (const S of rows) {
    const B = S.build(), p = node(B);
    p.msg(Object.assign({ t: 'transport' }, B.transport, { frame: D.ctx.currentFrame }));
    const o = out(), sec = () => run(D, p, SR / 128, o);
    sec();
    assert.ok(peakOf(o[0][0]) > 0.01 && machOf(p.insts[0]) === 'tr606', S.id + ': audible, the 606');
    assert.equal(CPU.BENCH.targets[S.id].node, S.node);
    const best = await CPU.gateLoad(sec, S.node);
    t.diagnostic(`row ${S.id}: ${best.load.toFixed(4)} calibrated (raw ${best.raw.toFixed(4)}, t(calib) ${best.calib.toFixed(0)} ms, attempt ${best.attempt})`);
    assert.ok(best.load <= 1.5 * S.node, `row ${S.id}: ${best.load.toFixed(4)} > 1.5 × ${S.node}`);
  }
  // d6i: d6p's machine with the transport stopped
  const p = node(drumTrack(DRUM_PATTERNS.d6p, null, false, 'tr606')), o = out(), sec = () => run(D, p, SR / 128, o);
  sec(); sec(); sec();
  const x = p.insts[0];
  assert.ok(x.quietF > 2 * SR && x.act === 0 && isDrSeq(x.sq) && x.sq.sync && machOf(x) === 'tr606' && o[0][0].every(v => v === 0), 'd6i: the skip path, silent');
  const target = CPU.BENCH.targets.d6i.node, best = await CPU.gateLoad(sec, target);
  t.diagnostic(`row d6i: ${best.load.toFixed(5)} calibrated (raw ${best.raw.toFixed(5)}, attempt ${best.attempt})`);
  assert.ok(best.load <= 1.5 * target, `row d6i: ${best.load.toFixed(5)} > 1.5 × ${target}`);
});

/* ------------------------------------------------------------------ stage 7c: the TR-909 (IMPL-7c §1.5, §12.5, lane E9) */
const dr9Patch = (o, fx, bpm = 120) => { const m = MODELS.find(x => x.id === 'tr909'); return patchFor(m, Object.assign(Object.fromEntries(m.controls.map(c => [c.id, c.def])), o || {}), fx || core.defaultFx2(), { sr: SR, bpm }); };
// a 909 record playing pattern I-1-1 = rows by its codes ('X' a per-voice accent, 'f' a flam, 'F' both; a new machine:
// PATTERN PLAY, SYNC on), its key's fields over the cleared ones, x over the extras; its DEMO (I-1-1 / I-1-2 block-played,
// SHUFFLE 3, a snare flam); the payload
const dr9Mem = (rows, key, x) => {
  const d = DC.normDrum(undefined, 'tr909'), st = new Array(16).fill(0), ac = st.slice(), fm = st.slice(), keys = d.keys.slice();
  for (const [code, r] of Object.entries(rows)) {
    const b = 1 << DC.LANES909[DC.CODES909.indexOf(code.toUpperCase())];
    for (let k = 0; k < r.length; k++) if (r[k] !== '.') { st[k] |= b; if ('XF'.includes(r[k])) ac[k] |= b & DC.AC909; if ('fF'.includes(r[k])) fm[k] |= b & DC.FL909; }
  }
  keys[0] = Object.assign({}, keys[0], key || {});
  return Object.assign({}, d, { keys, st: [st].concat(d.st.slice(1)), ac: [ac].concat(d.ac.slice(1)), fm: [fm].concat(d.fm.slice(1)), x: Object.assign({}, d.x, x || {}) });
};
const dr9Demo = () => DC.press(DC.initState('tr909'), DC.normDrum(undefined, 'tr909'), { k: 'demo' }).mem;
const dr9Pay = (d, run) => DC.payload(d, Object.assign(DC.initState('tr909'), { run: !!run }), 'now');
// a valid one-level sample entry (the chip swap's: 0.3 s of a decaying LCG noise)
const smpEntry = id => {
  const n = Math.round(0.3 * SR), L = new Float32Array(n);
  let x = 12345, pk = 0;
  for (let i = 0; i < n; i++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; L[i] = (x / 4294967296 - 0.5) * Math.exp(-i / (0.08 * SR)); pk = Math.max(pk, Math.abs(L[i])); }
  return { id, v: 1, kind: 'smp', rate: SR, ch: 1, len: n, root: 60, loop: null, peak: pk, bytes: 4 * n, levels: [{ len: n, L, R: null }] };
};

test('7c: a 909 Inst from {t: patch} + {t: seq} on the warmed first Track, on a later Track and from processorOptions offline — bit for bit, its own machine; the warm-up left no slot or asset behind; one decode of the ROM images per scope (every 909 shares them)', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), P = dr9Patch({ bdd: 7, ohd: 8, cru: 3 }), S = dr9Pay(dr9Demo());
  const ev = [[30, { t: 'on', n: 38, v: 0.9 }], [31, { t: 'off', n: 38 }], [90, { t: 'on', n: 46, v: 1 }], [92, { t: 'on', n: 39, v: 1 }], [120, { t: 'on', n: 49, v: 0.5 }], [140, { t: 'on', n: 51, v: 110 / 127 }]];
  const live = () => { D.ctx.currentFrame = 0; const { p } = mk(D, { os: 4, hostOS: 4 }, P); p.msg({ t: 'seq', s: S }); p.msg(tpPlay(0)); return { p, o: play(D, p, 300, ev) }; };
  const a = live(), b = live();
  D.ctx.currentFrame = 0;
  const { p: c } = mk(D, { os: 4, hostOS: 4, offline: true, patch: P, seq: S, transport: tpPlay(0) });
  const z = play(D, c, 300, ev);
  assert.deepEqual([a.p.i0.kind, machOf(a.p.i0), isDrSeq(a.p.i0.sq), b.p.i0.drPend === null, machOf(c.i0), isDrSeq(c.i0.sq)], ['drums', 'tr909', true, true, 'tr909', true]);
  assert.deepEqual([P.machine, S.m], ['tr909', 'tr909']);
  assert.equal(a.p.i0.dmL.map(r => r.id).join(), 'tr808,tr606,tr909,sdsv', 'the warm-up built every machine on Inst 0 (kept, reset; 8: the SDS-V\'s round after the 909\'s)');
  assert.ok(peakOf(a.o.L) > 0.05, 'the pattern sounds');
  assert.ok(sameBits(a.o.L, b.o.L) && sameBits(a.o.R, b.o.R), 'the warmed-up first Track = a later one (restore leaves a fresh 909)');
  assert.ok(sameBits(a.o.L, z.L) && sameBits(a.o.R, z.R), 'live = offline (processorOptions)');
  const SB = D.global('SxBase'), sw = a.p.i0.dm._sw;
  assert.deepEqual([SB.assets.size, SB.getAsset('smp:~warm909'), sw.id.join(), sw.pend], [0, null, ',,,', false], 'the chip swap\'s stand-in gone: no asset, no slot');
  const R = D.global('Dr808').proto.tr909.rom9();
  for (const q of [a.p.i0.dm, b.p.i0.dm, c.i0.dm]) assert.deepEqual([q._v.hh.img === R.hh, q._v.cr.img === R.cr, q._v.rd.img === R.rd], [true, true, true], 'the scope\'s images, shared');
});

// §12.5: 808 → 606 → 909 → 808 on one Inst — each machine its own (built once, kept), a fresh DrSeq each time; the 909's payload
// overtaking its patch waits in drPend while the 606 plays on, and the patch adopts it; one after its patch too
test('7c machine change (§1.5, §12.5): 808 → 606 → 909 → 808 on one Inst — its own machine each (kept), a fresh DrSeq; a 909 payload before its patch waits in drPend and plays, one after it too', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p, sent } = mk(D, { os: 4, hostOS: 4, offline: true }, drPatch());
  const I = p.i0;
  p.msg({ t: 'seq', s: drPay(drMem(DC.DEMO.a)) }); p.msg(tpPlay(D.ctx.currentFrame));
  run(D, p, 40);
  const m8 = I.dm;
  p.msg({ t: 'patch', p: dr6Patch() }); p.msg({ t: 'seq', s: dr6Pay(dr6Mem(DC.DEMO606.a)) });
  sent.length = 0; run(D, p, 100);
  assert.deepEqual([machOf(I), steps(sent).length > 0], ['tr606', true]);
  const m6 = I.dm, q6 = I.sq, S9 = dr9Pay(dr9Demo());
  p.msg({ t: 'seq', s: S9 }); // (the payload first: the 606 still plays)
  const pend = I.drPend;
  assert.ok(isDrSeq(pend) && pend.pl.key === S9.plan.key && I.sq === q6 && I.dm === m6, 'kept apart: the 606 keeps its sequencer');
  sent.length = 0; run(D, p, 40);
  assert.ok(steps(sent).length > 0, 'the 606 plays on meanwhile');
  p.msg({ t: 'patch', p: dr9Patch() });
  assert.deepEqual([I.kind, machOf(I), I.sq === pend, I.drPend === null, I.dm !== m6 && I.dm !== m8], ['drums', 'tr909', true, true, true], 'the patch adopts the waiting payload');
  sent.length = 0;
  const o9 = play(D, p, 200);
  assert.ok(steps(sent).length >= 4 && steps(sent).every(m => m.k === 0), 'the 909 plays its synced DEMO (I-1-1)');
  assert.ok(peakOf(o9.L.subarray(40 * 128)) > 0.05, 'audible');
  const m9 = I.dm, q9 = I.sq;
  p.msg({ t: 'patch', p: drPatch() });
  assert.deepEqual([machOf(I), I.dm === m8, I.sq === null, I.drPend === null], ['tr808', true, true, true], 'the 808\'s own machine again (kept), no sequencer yet');
  p.msg({ t: 'patch', p: dr9Patch({ ac: 3 }) });
  assert.deepEqual([machOf(I), I.dm === m9, I.sq === null], ['tr909', true, true], 'and the 909\'s, kept');
  p.msg({ t: 'seq', s: dr9Pay(dr9Demo()) }); // (after its patch this time)
  assert.ok(isDrSeq(I.sq) && I.sq !== q9 && I.sq !== q6, 'a fresh DrSeq');
  sent.length = 0; run(D, p, 200);
  assert.ok(steps(sent).length >= 4, 'the 909 plays again');
  p.msg({ t: 'patch', p: drPatch() }); p.msg({ t: 'seq', s: drPay(drMem(DC.DEMO.b)) });
  sent.length = 0; run(D, p, 100);
  assert.deepEqual([machOf(I), I.dm === m8, steps(sent).length > 0], ['tr808', true, true], 'and back to the 808');
});

// 7b's level rule for every pair with the 909: the old machine's de-click tail keeps its level through each machine's own
// output stage (Dr808.gain) and drains on its own chain (drPost); measured on the Inst's output; the post's first 8 samples
// excluded (7b §14 lane E6: a post's 220 p low-passes start from rest after reset())
test('7c machine change (§1.5): the de-click tail crossing 808 → 909, 909 → 606, 606 → 909 and 909 → 808 keeps its level (each machine\'s gain), no click above −60 dB past the post\'s first samples, drained on its own chain', (t) => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), G = D.global('Dr808');
  const d2 = (a, i0, i1) => { let m = 0; for (let i = Math.max(2, i0); i < i1; i++) m = Math.max(m, Math.abs(a[i] - 2 * a[i - 1] + a[i - 2])); return m; };
  const dB = x => (20 * Math.log10(x)).toFixed(1);
  for (const [A, B, n, ma, mb] of [[drPatch({ bdd: 10 }), dr9Patch({ vol: 5 }), 36, 'tr808', 'tr909'], [dr9Patch({ ltd: 10, vol: 5 }), dr6Patch(), 41, 'tr909', 'tr606'],
    [dr6Patch({ ltd: 10, vol: 5 }), dr9Patch(), 41, 'tr606', 'tr909'], [dr9Patch({ ltd: 10 }), drPatch({ vol: 0.5 }), 41, 'tr909', 'tr808']]) {
    const { p } = mk(D, { os: 4, hostOS: 4, offline: true }, A), I = p.i0, rs = I.renderSpan, L = new Float64Array(80 * 128);
    let at = 0;
    I.renderSpan = function (k) { const v = rs.call(this, k); L.set(this.Lb.subarray(0, k), at); at += k; return v; };
    p.msg({ t: 'on', n, v: 0.8 });
    play(D, p, 80, [[40, { t: 'patch', p: B }]]);
    const S = 40 * 128, ga = G.gain(ma, A.drum), gb = G.gain(mb, B.drum);
    const first = d2(L, S, S + 8), change = d2(L, S + 8, S + 256), pre = Math.abs(L[S - 1]), post = Math.abs(L[S + 8]);
    t.diagnostic(`${ma} → ${mb}: gains ${ga.toFixed(4)} / ${gb.toFixed(4)}; second difference: the post's first 8 samples ${dB(first)} dB, then ${dB(change)} dB; |sample 8 after| / |last before| ${(post / pre).toFixed(3)}`);
    assert.equal(machOf(I), mb);
    assert.ok(pre > 0.02 && post / pre > 0.8 && post / pre < 1.25, `${ma} → ${mb}: the level kept (${pre} → ${post})`);
    assert.ok(change < 1e-3, `${ma} → ${mb}: second difference over the change ${dB(change)} dB ≥ −60 dB`);
    assert.deepEqual([I.tailON, I.decO.every(h => h.buf.every(x => x === 0))], [0, true], `${ma} → ${mb}: drained, its chain empty`);
  }
});

test('7c: the 909 on a graph node — {t: seq, i}, steps posted with i, audible; #34: a step\'s v the highest of its sounds\' state velocities; a flam\'s second hit a drStep of its own at its tick, no post', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const { p, sent } = gnode(D, graph(['i1'], ['fx1'], [['i1', 'fx1', 1], ['fx1', 'out', 1]]), { i1: dr9Patch() }, { fx1: fxOf() });
  const x = p.insts[0], mc = [], ds = [], hk = x.drStep;
  x.drStep = function (n, v) { if (v > 0) ds.push([p.spanF, n, v]); return hk.call(this, n, v); };
  p.mc = { span() {}, extN: 0, fxv: {}, fxHi: {}, has: {}, transport() {}, noteOn(n, v, h) { mc.push(['on', n, v, h]); }, noteOff(n, h) { mc.push(['off', n, h]); } };
  // step 1: TOTAL ACCENT + BD accented (both: 127) + CH (total: 119); step 2: SD flammed (FLAM 16: 38 ms = 73 ticks); step 3: OH
  const d = dr9Mem({ ac: 'x...............', bd: 'X...............', ch: 'x...............', sd: '.f..............', oh: '..x.............' }, { fl: 16 });
  const S = dr9Pay(d);
  assert.deepEqual([[...S.plan.mFl], [...S.plan.mSh]], [[73], [0]]);
  p.msg({ t: 'seq', i: 'i1', s: S });
  p.msg(tpPlay(D.ctx.currentFrame));
  const o = play(D, p, 120); // (steps 1–3: 6000 frames apart at 120 BPM)
  const st = steps(sent);
  assert.deepEqual([x.kind, machOf(x), isDrSeq(x.sq), st.length, st.every(m => m.i === 'i1' && m.k === 0)], ['drums', 'tr909', true, 3, true]);
  assert.ok(peakOf(o.L) > 0.05, 'audible through the panel');
  assert.deepEqual(ds.map(([, n, v]) => [n, v]), [[36, 1], [38, 100 / 127], [38, 100 / 127], [46, 100 / 127]], 'three steps and the flam: four hooks');
  assert.ok(Math.abs(ds[2][0] - ds[1][0] - 73 * FPT8) <= 4, `the flam's hook at its tick (${ds[2][0] - ds[1][0]} frames after its step)`);
  assert.deepEqual(mc[0], ['on', 36, 1, 0], 'step 1: its lowest primary, both accents');
  assert.equal(x.lastNote, 46, 'step 3: OH alone');
  p.mc = null;
});

test('7c OS change (§2.7, §12.5): {t: os} while a tom rings goes through osFade — the 909 follows (setOS), no click above −60 dB; an open hat ringing crosses it with no step beyond its own content and rings on', (t) => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const d2 = (a, q0, q1) => { let m = 0; for (let i = Math.max(2, q0 * 128); i < q1 * 128; i++) m = Math.max(m, Math.abs(a[i] - 2 * a[i - 1] + a[i - 2])); return m; };
  const go = (P, n) => { const { p } = mk(D, { os: 4, hostOS: 4, offline: true }, P); p.msg({ t: 'on', n, v: 0.8 }); return { p, o: play(D, p, 120, [[40, { t: 'os', v: 2 }]]) }; };
  const tom = go(dr9Patch({ ltd: 10 }), 41), I = tom.p.i0;
  assert.deepEqual([I.OS, I.dmOS, I.osPend, machOf(I)], [2, 2, 0, 'tr909']);
  const before = d2(tom.o.L, 20, 40), change = d2(tom.o.L, 40, 50);
  t.diagnostic(`the tom: second difference before ${(20 * Math.log10(before)).toFixed(1)} dB, over the change ${(20 * Math.log10(change)).toFixed(1)} dB`);
  assert.ok(change < 1e-3, `second difference over the change ${(20 * Math.log10(change)).toFixed(1)} dB ≥ −60 dB`);
  assert.ok(peakOf(tom.o.L.subarray(60 * 128, 120 * 128)) > 0.01, 'it rings on');
  const hat = go(dr9Patch({ ohd: 10 }), 46), hb = d2(hat.o.L, 30, 40), hc = d2(hat.o.L, 40, 50);
  t.diagnostic(`the open hat: second difference ${(20 * Math.log10(hb)).toFixed(1)} dB before, ${(20 * Math.log10(hc)).toFixed(1)} dB over the change`);
  assert.ok(hc <= 1.25 * hb, 'no step beyond the hat\'s own content');
  assert.ok(peakOf(hat.o.L.subarray(60 * 128, 120 * 128)) > 0.01, 'the hat rings on');
});

test('7c modulation (§9, §12.5): a modRows row on drum.cru through the real moRec moves the crash\'s word clock — its counter runs ahead of the panel\'s, or behind', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const crash = v => {
    const { p } = mk(D, { os: 4, hostOS: 4, offline: true }, dr9Patch());
    const I = p.i0, rs = I.renderSpan, sv = [{ field: 'drum.cru', v }];
    if (v !== null) { I.modRows([{ field: 'drum.cru' }]); assert.deepEqual([I.moFN, I.moN], [1, 0]); I.renderSpan = function (n) { this.modSpan(null, null, sv); return rs.call(this, n); }; }
    p.msg({ t: 'on', n: 49, v: 0.8 });
    const o = play(D, p, 40), c = I.dm._v.cr;
    return { nx: c.nx, dw: c.dw, cru: I.p.drum.cru, pk: peakOf(o.L) };
  };
  const base = crash(null), up = crash(0.9), down = crash(0.1);
  assert.deepEqual([base.cru, up.cru, down.cru], [0.5, 0.9, 0.1]);
  assert.ok(base.pk > 0.02, 'the crash sounds');
  assert.ok(up.dw > 1.2 * base.dw && down.dw < base.dw / 1.1, `the clock follows the cable (${down.dw.toFixed(4)} < ${base.dw.toFixed(4)} < ${up.dw.toFixed(4)} words a sample)`);
  assert.ok(up.nx > base.nx && base.nx > down.nx, `the counter (${down.nx} < ${base.nx} < ${up.nx})`);
});

test('7c panic (§1.1): a panic while the crash and a tom ring is silent after the fade (the 909 reset, no tail resumes)', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p } = mk(D, { os: 4, hostOS: 4, offline: true }, dr9Patch({ cru: 0, crl: 10, ltd: 10 }));
  p.msg({ t: 'on', n: 49, v: 1 }); p.msg({ t: 'on', n: 41, v: 1 });
  const a = play(D, p, 20);
  assert.ok(peakOf(a.L.subarray(10 * 128)) > 0.05, 'ringing');
  p.msg({ t: 'panic' });
  const os = p.outStage;
  let after = 0, k = 0;
  p.outStage = function (Lo, Ro, off, n) { if (k >= 3) for (let i = 0; i < n; i++) after = Math.max(after, Math.abs(this.Lb[i]), Math.abs(this.Rb[i])); return os.call(this, Lo, Ro, off, n); };
  for (; k < 40; k++) run(D, p, 1);
  assert.ok(!p.i0.dm.live() && p.pnN === 0 && p.i0.tailN === 0, 'cleared');
  assert.ok(after < 1e-6, `silent after the fade (${after})`);
});

test('7c: a 909 renders without allocating — its synced DEMO (shuffle, a flam, both accents), a crash on a chip-swapped image converted inside, notes', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p } = mk(D, { os: 4, hostOS: 4, offline: true }, dr9Patch({ ohd: 10 }));
  const SB = D.global('SxBase'), id = 'smp:9090909090909090';
  p.msg({ t: 'seq', s: dr9Pay(dr9Demo()) }); p.msg(tpPlay(D.ctx.currentFrame));
  const o = out();
  run(D, p, 200, o);
  SB.storeAsset(id, smpEntry(id));
  p.msg({ t: 'seq', s: dr9Pay(Object.assign(dr9Demo(), { smp: { cr: { id, name: 'mine', on: true } } })) }); // (pending until the next span)
  const sw = p.i0.dm._sw;
  assert.deepEqual([sw.pend, sw.id[1]], [true, '']);
  let pk = 0;
  noAlloc(D, () => { for (let k = 0; k < 400; k++) { if (k === 100) p.noteOn(49, 1); if (k === 101) p.noteOff(49); p.process([], o); D.ctx.currentFrame += 128; for (const v of o[0][0]) if (Math.abs(v) > pk) pk = Math.abs(v); } });
  assert.deepEqual([sw.pend, sw.id[1], p.i0.dm._v.cr.img === sw.cr], [false, id, true], 'converted in the worklet, the crash playing it');
  assert.ok(pk > 0.05, 'it played');
});

// review 1 F3: a payload naming four ROM slots (their entries stored: a project open, a power-on, an undone Replace) reaches
// an idle 909 — the Inst's idle skip renders nothing, so before the fix the four conversions waited for the first hit and ran
// in its quantum. Now the idle skip polls the machine: converted while it waits, one image a quantum (none in the hit's)
test('7c chip swaps on an idle 909 (review 1 F3): converted while it waits — the idle skip polls the machine, one image a quantum; the first hit\'s quantum converts nothing', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p } = mk(D, { os: 4, hostOS: 4, offline: true }, dr9Patch());
  const SB = D.global('SxBase'), ids = ['rd', 'cr', 'oh', 'ch'].map((s, j) => 'smp:909090909090909' + j);
  run(D, p, Math.ceil(2.5 * SR / 128));
  const I = p.i0, sw = I.dm._sw, rs = I.dm.render;
  assert.ok(I.quietF > 2 * SR && I.act === 0, 'idle: the skip path');
  ids.forEach(id => SB.storeAsset(id, smpEntry(id)));
  p.msg({ t: 'seq', s: dr9Pay(Object.assign(DC.normDrum(undefined, 'tr909'), { smp: Object.fromEntries(['rd', 'cr', 'oh', 'ch'].map((s, j) => [s, { id: ids[j], name: s, on: true }])) })) });
  let rendered = 0;
  I.dm.render = function (...a) { rendered++; return rs.apply(this, a); };
  const per = [];
  for (let k = 0; k < 6; k++) { const n0 = sw.id.filter(Boolean).length; run(D, p, 1); per.push(sw.id.filter(Boolean).length - n0); }
  assert.deepEqual([per, rendered, sw.pend], [[1, 1, 1, 1, 0, 0], 0, false], 'four quanta, one image each, nothing rendered');
  assert.deepEqual([...sw.id], ids, 'every slot converted');
  p.msg({ t: 'on', n: 49, v: 1 });
  const o = play(D, p, 20);
  assert.ok(peakOf(o.L) > 0.05 && I.dm._v.cr.img === sw.cr, 'the first hit plays the swapped chip');
});

// IMPL-7c §2.6, review 1 F1 (the lead: every drum machine at about the same loudness, the circuit's mix weights kept, the
// balance in the default LEVEL knobs): measured as the app plays it — the shipped ROM images, the Track's decimators, its
// output stage and limiter (the pre-limiter peak read at the limiter's input). The default panels' groove (BD on the beats,
// SD + clap on 2 and 4, closed hat on the eighths, 120 BPM, v 100): the 909's RMS within ± 1 dB of the 808's and below the
// limiter's threshold (no gain reduction: no pumping); each 909 sound alone at its default panel: unaccented ≤ 0.8 FS,
// accented (per-voice, total, both: v 110 / 119 / 127) ≤ 1.0 FS before the limiter
test('7c §2.6 level through the whole Track (review 1 F1): the default groove\'s RMS within ± 1 dB of the 808\'s, the limiter untouched; each 909 sound alone ≤ 0.8 FS unaccented, ≤ 1.0 accented (pre-limiter, the shipped images)', (t) => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), thr = Math.pow(10, -1 / 20);
  const go = (patch, ev, quanta, seq) => {
    D.ctx.currentFrame = 0;
    const { p } = mk(D, { os: 4, hostOS: 4, offline: true }, patch), lim = p.lim, lp = lim.process;
    if (seq) p.msg({ t: 'seq', s: seq });
    let pre = 0, gmin = 1;
    lim.process = function (A, B, n) { for (let i = 0; i < n; i++) pre = Math.max(pre, Math.abs(A[i]), Math.abs(B[i])); lp.call(this, A, B, n); gmin = Math.min(gmin, this.env); };
    return Object.assign(play(D, p, quanta, ev), { pre, gmin });
  };
  const groove = [];
  for (let k = 0; k < 64; k++) {
    const q = Math.floor((8 + k * 6000) / 128), on = n => groove.push([q, { t: 'on', n, v: 100 / 127 }]);
    if (k % 4 === 0) on(36);
    if (k % 16 === 4 || k % 16 === 12) { on(38); on(39); }
    if (k % 2 === 0) on(42);
  }
  const Q = Math.ceil(8.2 * SR / 128), rmsDb = L => { let e = 0; const a = Math.round(0.1 * SR); for (let i = a; i < L.length; i++) e += L[i] * L[i]; return 10 * Math.log10(e / (L.length - a)); };
  const g9 = go(dr9Patch(), groove, Q), g8 = go(drPatch(), groove, Q), r9 = rmsDb(g9.L), r8 = rmsDb(g8.L);
  t.diagnostic(`groove RMS 909 ${r9.toFixed(2)} dBFS, 808 ${r8.toFixed(2)} → ${(r9 - r8).toFixed(2)} dB; pre-limiter peaks ${g9.pre.toFixed(3)} / ${g8.pre.toFixed(3)} (threshold ${thr.toFixed(3)}); the limiter's deepest gain ${(20 * Math.log10(g9.gmin)).toFixed(2)} dB`);
  assert.ok(Math.abs(r9 - r8) <= 1, `the groove's RMS ${(r9 - r8).toFixed(2)} dB re the 808's`);
  assert.ok(g9.pre < thr && g9.gmin === 1, `the groove reaches the limiter (${g9.pre.toFixed(3)}, ${g9.gmin})`);
  // each sound alone (the 909's payload: its own map — the ride 51, the crash 49)
  const S9 = dr9Pay(DC.normDrum(undefined, 'tr909')), notes = [['bd', 36], ['sd', 38], ['lt', 41], ['mt', 45], ['ht', 48], ['rs', 37], ['cp', 39], ['rd', 51], ['cr', 49], ['oh', 46], ['ch', 42]];
  const bad = [], rep = [];
  for (const v of [100, 110, 119, 127]) {
    const row = notes.map(([s, n]) => { const r = go(dr9Patch(), [[2, { t: 'on', n, v: v / 127 }]], 450, S9); return [s, r.pre]; });
    rep.push(`v ${v}: ` + row.map(([s, x]) => `${s} ${x.toFixed(3)}`).join(' '));
    for (const [s, x] of row) if (!(x > 0.05 && x <= (v === 100 ? 0.8 : 1))) bad.push(`${s} at v ${v}: ${x.toFixed(3)}`);
  }
  t.diagnostic('pre-limiter peaks alone (default panel): ' + rep.join(' · '));
  assert.deepEqual(bad, []);
});

// IMPL-7c §2.7 / §12.5: the 909's bench rows through the CPU gate (calibrated, ≤ 1.5 × the node target) and d9i — the machine
// powered, synced, the transport stopped, nothing sounding, past the 2 s quiet window — gated as row p is (7a's method)
test('7c bench rows (node gate): d9p, d9x, d9m ≤ 1.5 × their targets; d9i (an idle synced 909) ≤ 1.5 × 0.0005', async (t) => {
  const { scenarios, drumTrack, DRUM_PATTERNS } = await import('./bench-scenarios.mjs');
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const node = B => {
    const p = new D.Proc({ processorOptions: { os: 4, hostOS: 4, offline: true } });
    p.msg(B.graph);
    for (const [id, patch] of Object.entries(B.patches)) p.msg({ t: 'patch', i: id, p: patch });
    for (const [id, c] of Object.entries(B.chains)) p.msg(Object.assign({ t: 'chain', c: id }, c));
    for (const [id, s] of Object.entries(B.seqs)) p.msg({ t: 'seq', i: id, s });
    return p;
  };
  const rows = scenarios().filter(s => s.id.startsWith('d9'));
  assert.deepEqual(rows.map(s => s.id), ['d9p', 'd9x', 'd9m']);
  for (const S of rows) {
    const B = S.build(), p = node(B), pl = B.seqs.i1.plan;
    assert.deepEqual([pl.mSh[0], pl.mFl[0] > 0 || S.id === 'd9m'], [40, true], S.id + ': SHUFFLE 3, its flams');
    p.msg(Object.assign({ t: 'transport' }, B.transport, { frame: D.ctx.currentFrame }));
    const o = out(), sec = () => run(D, p, SR / 128, o);
    sec();
    assert.ok(peakOf(o[0][0]) > 0.01 && machOf(p.insts[0]) === 'tr909', S.id + ': audible, the 909');
    assert.equal(CPU.BENCH.targets[S.id].node, S.node);
    const best = await CPU.gateLoad(sec, S.node);
    t.diagnostic(`row ${S.id}: ${best.load.toFixed(4)} calibrated (raw ${best.raw.toFixed(4)}, t(calib) ${best.calib.toFixed(0)} ms, attempt ${best.attempt})`);
    assert.ok(best.load <= 1.5 * S.node, `row ${S.id}: ${best.load.toFixed(4)} > 1.5 × ${S.node}`);
  }
  // d9i: d9p's machine with the transport stopped
  const p = node(drumTrack(DRUM_PATTERNS.d9p, null, false, 'tr909')), o = out(), sec = () => run(D, p, SR / 128, o);
  sec(); sec(); sec();
  const x = p.insts[0];
  assert.ok(x.quietF > 2 * SR && x.act === 0 && isDrSeq(x.sq) && x.sq.sync && machOf(x) === 'tr909' && o[0][0].every(v => v === 0), 'd9i: the skip path, silent');
  const target = CPU.BENCH.targets.d9i.node, best = await CPU.gateLoad(sec, target);
  t.diagnostic(`row d9i: ${best.load.toFixed(5)} calibrated (raw ${best.raw.toFixed(5)}, attempt ${best.attempt})`);
  assert.ok(best.load <= 1.5 * target, `row d9i: ${best.load.toFixed(5)} > 1.5 × ${target}`);
});

/* ------------------------------------------------------------------ stage 7d + 8: the SDS-V (IMPL-8 §11, §15.5, lane E5) */
const drvPatch = (o, fx, sr = SR) => { const m = MODELS.find(x => x.id === 'sdsv'); return patchFor(m, Object.assign(Object.fromEntries(m.controls.map(c => [c.id, c.def])), o || {}), fx || core.defaultFx2(), { sr, bpm: 120 }); };
// an SDS-V record (no sequencer: keys [], the empty plan) with trims `tr` (5 × 2 × 6, else the defaults) and its payload
const drvMem = tr => DC.normDrum(tr ? { m: 'sdsv', trim: tr } : undefined, 'sdsv');
const drvPay = d => DC.payload(d, DC.initState('sdsv'), 'now');
// our own trims off the defaults (every value distinct), their flat form (the machine's _trv: 12 c + 6 j + f)
const TRV1 = [0, 1, 2, 3, 4].map(c => [0, 1].map(j => [0, 1, 2, 3, 4, 5].map(f => 0.05 + 0.9 * (((5 * c + 3 * j + 7 * f) % 11) / 10))));
const flatTr = tr => tr.flatMap(c => c.flatMap(j => j));
const NV = [36, 38, 48, 45, 41]; // bass, snare, tom 1, tom 2, tom 3 (GM, = DrSeq.DEF_MAP)

test('8: an SDS-V Inst from {t: patch} + {t: seq} (trims, cards on memories 3 / 4) on the warmed first Track, on a later Track and from processorOptions offline — bit for bit; the warm-up built four machines on Inst 0 and left no asset; the trims are heard', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), P = drvPatch({ xbp: 2, x1p: 3, x2p: 2, x3d: 8 }), S = drvPay(drvMem(TRV1));
  const ev = NV.map((n, k) => [10 + 25 * k, { t: 'on', n, v: (60 + 15 * k) / 127 }]).concat([[160, { t: 'on', n: 41, v: 1 }], [170, { t: 'on', n: 36, v: 0.5 }]]);
  const live = () => { D.ctx.currentFrame = 0; const { p } = mk(D, { os: 4, hostOS: 4 }, P); p.msg({ t: 'seq', s: S }); return { p, o: play(D, p, 300, ev) }; };
  const a = live(), b = live();
  D.ctx.currentFrame = 0;
  const { p: c } = mk(D, { os: 4, hostOS: 4, offline: true, patch: P, seq: S });
  const z = play(D, c, 300, ev);
  assert.deepEqual([a.p.i0.kind, machOf(a.p.i0), isDrSeq(a.p.i0.sq), machOf(c.i0), isDrSeq(c.i0.sq), S.m, S.plan.n, P.machine], ['drums', 'sdsv', true, 'sdsv', true, 'sdsv', 0, 'sdsv']);
  assert.equal(a.p.i0.dmL.map(r => r.id).join(), 'tr808,tr606,tr909,sdsv', 'the warm-up built every machine on Inst 0 (kept, reset)');
  assert.equal(D.global('SxBase').assets.size, 0, 'the warm-up\'s stand-in sample dropped');
  for (const I of [a.p.i0, b.p.i0, c.i0]) assert.deepEqual([...I.dm._trv], flatTr(TRV1), 'the payload\'s trims in the machine');
  assert.ok(peakOf(a.o.L) > 0.05, 'it sounds');
  assert.ok(sameBits(a.o.L, b.o.L) && sameBits(a.o.R, b.o.R), 'the warmed-up first Track = a later one (restore leaves a fresh SDS-V: its default trims)');
  assert.ok(sameBits(a.o.L, z.L) && sameBits(a.o.R, z.R), 'live = offline (processorOptions: the trims reach the bounce, D7)');
  D.ctx.currentFrame = 0;
  const { p: d } = mk(D, { os: 4, hostOS: 4, offline: true, patch: P, seq: drvPay(drvMem()) }), y = play(D, d, 300, ev);
  assert.deepEqual([...d.i0.dm._trv], [...D.global('Dr808').proto.sdsv.TRIMV], 'the record\'s default trims = the machine\'s');
  assert.ok(!sameBits(y.L, z.L), 'other trims, another sound (memories 3 / 4)');
});

// §15.5: 808 → SDS-V → 909 → SDS-V → 606 on one Inst — each machine its own (built once, kept), a fresh DrSeq each time; the
// SDS-V's payload overtaking its patch waits in drPend while the 808 plays on, and drOn adopts it — its trims reach the machine
// there; back on the SDS-V without a payload: the default trims (drOn's dm.trim(null)), then a payload's after its patch
test('8 machine change (§11.3, §15.5): 808 → SDS-V → 909 → SDS-V → 606 on one Inst — its own machine each (kept), a fresh DrSeq; an SDS-V payload before its patch waits in drPend and its trims reach the machine at drOn; one after it too', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p, sent } = mk(D, { os: 4, hostOS: 4, offline: true }, drPatch());
  const I = p.i0, G = D.global('Dr808').proto.sdsv;
  p.msg({ t: 'seq', s: drPay(drMem(DC.DEMO.a)) }); p.msg(tpPlay(D.ctx.currentFrame));
  run(D, p, 40);
  const m8 = I.dm, q8 = I.sq, SV = drvPay(drvMem(TRV1));
  p.msg({ t: 'seq', s: SV }); // (the payload first: the 808 still plays)
  const pend = I.drPend;
  assert.ok(isDrSeq(pend) && I.drPendM === 'sdsv' && pend.trim === SV.trim && I.sq === q8 && I.dm === m8, 'kept apart: the 808 keeps its sequencer');
  sent.length = 0; run(D, p, 40);
  assert.ok(steps(sent).length > 0, 'the 808 plays on meanwhile');
  p.msg({ t: 'patch', p: drvPatch({ x1p: 2 }) });
  assert.deepEqual([I.kind, machOf(I), I.sq === pend, I.drPend === null, I.dm !== m8], ['drums', 'sdsv', true, true, true], 'the patch adopts the waiting payload');
  assert.deepEqual([...I.dm._trv], flatTr(TRV1), 'its trims handed to the machine at drOn');
  sent.length = 0;
  const ov = play(D, p, 60, NV.map((n, k) => [5 * k, { t: 'on', n, v: 0.8 }]));
  assert.ok(peakOf(ov.L) > 0.05 && steps(sent).length === 0, 'the notes play the five; the empty plan steps nothing');
  const mv = I.dm, qv = I.sq;
  p.msg({ t: 'patch', p: dr9Patch() }); p.msg({ t: 'seq', s: dr9Pay(dr9Demo()) });
  sent.length = 0; run(D, p, 200);
  assert.deepEqual([machOf(I), steps(sent).length >= 4, I.sq !== qv], ['tr909', true, true], 'the 909 plays its DEMO');
  p.msg({ t: 'patch', p: drvPatch() });
  assert.deepEqual([machOf(I), I.dm === mv, I.sq === null, I.drPend === null], ['sdsv', true, true, true], 'the SDS-V\'s own machine again (kept), no payload yet');
  assert.deepEqual([...I.dm._trv], [...G.TRIMV], 'no payload: the default trims');
  const o0 = play(D, p, 40, [[1, { t: 'on', n: 41, v: 0.9 }]]);
  assert.ok(peakOf(o0.L) > 0.05, 'a note before any payload plays (DEF_MAP)');
  const T2 = TRV1.map(c => c.map(j => j.map(x => 1 - x)));
  p.msg({ t: 'seq', s: drvPay(drvMem(T2)) }); // (after its patch this time)
  assert.ok(isDrSeq(I.sq) && I.sq !== qv, 'a fresh DrSeq');
  assert.deepEqual([...I.dm._trv], flatTr(T2), 'drSeqMsg hands the trims over');
  p.msg({ t: 'patch', p: dr6Patch() }); p.msg({ t: 'seq', s: dr6Pay(dr6Mem(DC.DEMO606.a)) });
  sent.length = 0; run(D, p, 100);
  assert.deepEqual([machOf(I), steps(sent).length > 0, 'trim' in I.dm], ['tr606', true, false], 'and on to the 606 (no trim on its machine)');
  assert.equal(I.dmL.map(r => r.id).join(), 'tr808,sdsv,tr909,tr606', 'four machines on the Inst, each built once');
});

// 7b's level rule for every pair with the SDS-V: the old machine's de-click tail keeps its level through each machine's own
// output stage (Dr808.gain: OUT_KV for the SDS-V) and drains on its own chain; the post's first 8 samples excluded (7b §14)
test('8 machine change (§15.5): the de-click tail crossing 808 → SDS-V, SDS-V → 909, 909 → SDS-V and SDS-V → 606 keeps its level (each machine\'s gain), no click above −60 dB past the post\'s first samples, drained on its own chain', (t) => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), G = D.global('Dr808');
  const d2 = (a, i0, i1) => { let m = 0; for (let i = Math.max(2, i0); i < i1; i++) m = Math.max(m, Math.abs(a[i] - 2 * a[i - 1] + a[i - 2])); return m; };
  const dB = x => (20 * Math.log10(x)).toFixed(1);
  for (const [A, B, n, ma, mb] of [[drPatch({ bdd: 10 }), drvPatch(), 36, 'tr808', 'sdsv'], [drvPatch({ x3d: 9 }), dr9Patch(), 41, 'sdsv', 'tr909'],
    [dr9Patch({ ltd: 10 }), drvPatch(), 41, 'tr909', 'sdsv'], [drvPatch({ x3d: 9 }), dr6Patch(), 41, 'sdsv', 'tr606']]) {
    const { p } = mk(D, { os: 4, hostOS: 4, offline: true }, A), I = p.i0, rs = I.renderSpan, L = new Float64Array(80 * 128);
    let at = 0;
    I.renderSpan = function (k) { const v = rs.call(this, k); L.set(this.Lb.subarray(0, k), at); at += k; return v; };
    p.msg({ t: 'on', n, v: 0.8 });
    play(D, p, 80, [[40, { t: 'patch', p: B }]]);
    const S = 40 * 128, ga = G.gain(ma, A.drum), gb = G.gain(mb, B.drum);
    const first = d2(L, S, S + 8), change = d2(L, S + 8, S + 256), pre = Math.abs(L[S - 1]), post = Math.abs(L[S + 8]);
    t.diagnostic(`${ma} → ${mb}: gains ${ga.toFixed(4)} / ${gb.toFixed(4)}; second difference: the post's first 8 samples ${dB(first)} dB, then ${dB(change)} dB; |sample 8 after| / |last before| ${(post / pre).toFixed(3)}`);
    assert.equal(machOf(I), mb);
    assert.ok(pre > 0.02 && post / pre > 0.8 && post / pre < 1.25, `${ma} → ${mb}: the level kept (${pre} → ${post})`);
    assert.ok(change < 1e-3, `${ma} → ${mb}: second difference over the change ${dB(change)} dB ≥ −60 dB`);
    assert.deepEqual([I.tailON, I.decO.every(h => h.buf.every(x => x === 0))], [0, true], `${ma} → ${mb}: drained, its chain empty`);
  }
});

// §11.2 / §15.5: before any payload a note plays through DrSeq.DEF_MAP (= PERS.sdsv.map for its five): each GM note its card,
// the 808's other notes nothing (ids 5–15 inert); a payload's map then rules (a remap moves the bass to 60)
test('8 notes (§11.2, §15.5): before any payload the five GM notes play their five cards (DEF_MAP), the other drum notes nothing; a payload\'s map rules after it', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), card = ['bd', 'sd', 'ht', 'mt', 'lt'];
  NV.forEach((n, k) => {
    const { p } = mk(D, { os: 4, hostOS: 4, offline: true }, drvPatch()), I = p.i0;
    const o = play(D, p, 20, [[1, { t: 'on', n, v: 0.8 }]]);
    assert.deepEqual([I.sq, card.filter(c => I.dm._v[c].on)], [null, [card[k]]], n + ': its card alone');
    assert.ok(peakOf(o.L) > 0.02, n + ' sounds');
  });
  const { p } = mk(D, { os: 4, hostOS: 4, offline: true }, drvPatch());
  const o = play(D, p, 20, [37, 39, 42, 46, 49, 51, 56, 64, 75].map(n => [1, { t: 'on', n, v: 1 }]));
  assert.deepEqual([peakOf(o.L), p.i0.dm.live()], [0, false], 'ids 5–15: nothing');
  const d = drvMem(), map = Object.assign({}, d.map, { bd: [60] });
  p.msg({ t: 'seq', s: drvPay(Object.assign({}, d, { map })) });
  play(D, p, 4, [[1, { t: 'on', n: 36, v: 1 }]]);
  assert.equal(p.i0.dm._v.bd.on, false, 'the payload\'s map: 36 is no longer the bass');
  play(D, p, 4, [[1, { t: 'on', n: 60, v: 1 }]]);
  assert.equal(p.i0.dm._v.bd.on, true, '60 is');
});

// §11.5 / §15.5: a cable on a card's knob is heard while that channel is on memory 2 (the knobs) — not on memory 1 (the
// factory sound): a modRows row on drum.x1t through the real moRec moves tom 1's sound on 2, changes nothing on 1
test('8 modulation (§11.5, §15.5): a modRows row on drum.x1t through the real moRec moves tom 1 while it is on memory 2 (the knobs), not on memory 1 (the factory sound)', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const tom = (mem, v) => {
    const { p } = mk(D, { os: 4, hostOS: 4, offline: true }, drvPatch({ x1p: mem })), I = p.i0, rs = I.renderSpan, sv = [{ field: 'drum.x1t', v }];
    if (v !== null) { I.modRows([{ field: 'drum.x1t' }]); assert.deepEqual([I.moFN, I.moN], [1, 0]); I.renderSpan = function (n) { this.modSpan(null, null, sv); return rs.call(this, n); }; }
    D.ctx.currentFrame = 0;
    const o = play(D, p, 60, [[1, { t: 'on', n: 48, v: 0.8 }]]);
    return { L: o.L, x1t: I.p.drum.x1t };
  };
  const k0 = tom(1, null), k1 = tom(1, 0.9), f0 = tom(0, null), f1 = tom(0, 0.9);
  assert.deepEqual([k0.x1t, k1.x1t, f1.x1t], [4.2 / 10, 0.9, 0.9], 'the effective value is in p.drum');
  assert.ok(peakOf(k0.L) > 0.02 && peakOf(f0.L) > 0.02, 'tom 1 sounds');
  assert.ok(!sameBits(k0.L, k1.L), 'memory 2: the cable moves tom 1');
  assert.ok(sameBits(f0.L, f1.L), 'memory 1: the factory sound, the cable changes nothing');
});

test('8 OS change (§12.7, §15.5): {t: os} while tom 3 rings goes through osFade — the SDS-V follows (setOS), no click above −60 dB, it rings on', (t) => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p } = mk(D, { os: 4, hostOS: 4, offline: true }, drvPatch({ x3d: 9 }));
  const I = p.i0;
  p.msg({ t: 'on', n: 41, v: 0.8 });
  const o = play(D, p, 120, [[40, { t: 'os', v: 2 }]]);
  assert.deepEqual([I.OS, I.dmOS, I.osPend, machOf(I)], [2, 2, 0, 'sdsv']);
  const d2 = (a, q0, q1) => { let m = 0; for (let i = Math.max(2, q0 * 128); i < q1 * 128; i++) m = Math.max(m, Math.abs(a[i] - 2 * a[i - 1] + a[i - 2])); return m; };
  const before = d2(o.L, 20, 40), change = d2(o.L, 40, 50);
  t.diagnostic(`tom 3: second difference before ${(20 * Math.log10(before)).toFixed(1)} dB, over the change ${(20 * Math.log10(change)).toFixed(1)} dB`);
  assert.ok(change < 1e-3, `second difference over the change ${(20 * Math.log10(change)).toFixed(1)} dB ≥ −60 dB`);
  assert.ok(peakOf(o.L.subarray(60 * 128, 120 * 128)) > 0.01, 'it rings on');
});

test('8 panic (§15.5): a panic while a long tom rings is silent after the fade (the SDS-V reset, no tail resumes)', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p } = mk(D, { os: 4, hostOS: 4, offline: true }, drvPatch({ x3d: 10, x2d: 10 }));
  p.msg({ t: 'on', n: 41, v: 1 }); p.msg({ t: 'on', n: 45, v: 1 });
  const a = play(D, p, 20);
  assert.ok(peakOf(a.L.subarray(10 * 128)) > 0.05, 'ringing');
  p.msg({ t: 'panic' });
  const os = p.outStage;
  let after = 0, k = 0;
  p.outStage = function (Lo, Ro, off, n) { if (k >= 3) for (let i = 0; i < n; i++) after = Math.max(after, Math.abs(this.Lb[i]), Math.abs(this.Rb[i])); return os.call(this, Lo, Ro, off, n); };
  for (; k < 40; k++) run(D, p, 1);
  assert.ok(!p.i0.dm.live() && p.pnN === 0 && p.i0.tailN === 0, 'cleared');
  assert.ok(after < 1e-6, `silent after the fade (${after})`);
});

test('8: an SDS-V renders without allocating — its groove as roll notes with the payload\'s trims, memories 1–4, a trim hand-over and notes inside', () => {
  const D = dspScope({ engine: true, fast: true, console: quiet }), { p } = mk(D, { os: 4, hostOS: 4, offline: true }, drvPatch({ xbp: 0, xsp: 2, x1p: 3, x3d: 9 }));
  p.msg({ t: 'seq', s: drvPay(drvMem(TRV1)) });
  p.msg(songV(DRUM_PATTERNS.dvp)); p.msg(Object.assign(tpPlay(D.ctx.currentFrame), { loop: true, ls: 0, le: 3840 }));
  const o = out(), T2 = TRV1.map(c => c.map(j => j.map(x => 1 - x)));
  run(D, p, 200, o);
  let pk = 0;
  noAlloc(D, () => { for (let k = 0; k < 1000; k++) { if (k === 300) p.i0.dm.trim(T2); if (k === 500) p.noteOn(41, 1); if (k === 501) p.noteOff(41); p.process([], o); D.ctx.currentFrame += 128; for (const v of o[0][0]) if (Math.abs(v) > pk) pk = Math.abs(v); } });
  assert.ok(pk > 0.05, 'it played');
});

// IMPL-8 §12.4 (7c review 1 F1's gate), the lead's groove-headroom check (V5: dvp's peak sat 0.35 dB under the limiter):
// measured as the app plays it — the song path (roll notes, the one-bar dvp groove looping), the Track's decimators, its
// output stage and limiter (the pre-limiter peak read at the limiter's input). The dvp groove at the defaults: its RMS within
// ± 1 dB of the 808's default groove (7c's: BD on the beats, SD + clap on 2 / 4, CH on the eighths, v 100) and the limiter
// never engaged (no gain reduction) over 8 bars at 48 / 44.1 kHz × 4 / 2 / 1 (review R1-H: 44.1 × 1 was skipped); the bass drum's memory 1 at v 100 alone
// within ± 1 dB of the 808's BD; each card alone ≤ 0.8 FS at v 100, ≤ 1.0 at v 127 (SENS 5); the same groove on memories 3 / 4
// (the default trims) reported (no gate: the listening gate's)
test('8 §12.4 level and headroom through the whole Track: the dvp groove\'s RMS within ± 1 dB of the 808\'s default groove and the limiter never engaged (48 / 44.1 kHz × 4 / 2 / 1); the bass at memory 1 = the 808\'s BD ± 1 dB; each card alone ≤ 0.8 / 1.0 FS', (t) => {
  const thr = Math.pow(10, -1 / 20);
  const go = (sr, os, patch, ev, quanta, seq, song) => {
    const D = dspScope({ engine: true, fast: true, console: quiet, sampleRate: sr });
    const { p } = mk(D, { os, hostOS: os, offline: true }, patch), lim = p.lim, lp = lim.process;
    if (seq) p.msg({ t: 'seq', s: seq });
    if (song) { p.msg(song); p.msg({ t: 'transport', play: true, frame: D.ctx.currentFrame, tick: 0, fpt: sr * 60 / (120 * 960), seek: true, loop: true, ls: 0, le: 3840 }); }
    let pre = 0, gmin = 1;
    lim.process = function (A, B, n) { for (let i = 0; i < n; i++) pre = Math.max(pre, Math.abs(A[i]), Math.abs(B[i])); lp.call(this, A, B, n); gmin = Math.min(gmin, this.env); };
    return Object.assign(play(D, p, quanta, ev), { pre, gmin });
  };
  const rmsDb = (L, sr) => { let e = 0; const a = Math.round(0.1 * sr); for (let i = a; i < L.length; i++) e += L[i] * L[i]; return 10 * Math.log10(e / (L.length - a)); };
  const g808 = [];
  for (let k = 0; k < 64; k++) {
    const q = Math.floor((8 + k * 6000) / 128), on = n => g808.push([q, { t: 'on', n, v: 100 / 127 }]);
    if (k % 4 === 0) on(36);
    if (k % 16 === 4 || k % 16 === 12) { on(38); on(39); }
    if (k % 2 === 0) on(42);
  }
  const Q = Math.ceil(16.2 * SR / 128), r8 = rmsDb(go(SR, 4, drPatch(), g808, Math.ceil(8.2 * SR / 128)).L, SR), song = songV(DRUM_PATTERNS.dvp), S = drvPay(drvMem());
  const rep = [];
  for (const [sr, os] of [[SR, 4], [SR, 2], [SR, 1], [44100, 4], [44100, 2], [44100, 1]]) {
    const g = go(sr, os, drvPatch(null, null, sr), [], Math.ceil(16.2 * sr / 128), S, song), r = rmsDb(g.L, sr);
    rep.push(`${sr / 1000} kHz × ${os}: RMS ${r.toFixed(2)} dBFS (${(r - r8).toFixed(2)} dB re the 808's ${r8.toFixed(2)}), pre-limiter peak ${g.pre.toFixed(3)} (${(20 * Math.log10(g.pre / thr)).toFixed(2)} dB re the threshold ${thr.toFixed(3)}), the limiter's deepest gain ${(20 * Math.log10(g.gmin)).toFixed(2)} dB`);
    assert.ok(Math.abs(r - r8) <= 1, `${sr} × ${os}: the groove's RMS ${(r - r8).toFixed(2)} dB re the 808's`);
    assert.ok(g.pre < thr && g.gmin === 1, `${sr} × ${os}: the groove reaches the limiter (${g.pre.toFixed(4)}, ${g.gmin})`);
  }
  t.diagnostic('dvp groove, 8 bars: ' + rep.join(' · '));
  const m34 = go(SR, 4, drvPatch({ xbp: 2, xsp: 3, x1p: 2, x2p: 3, x3p: 2 }), [], Q, S, song), m43 = go(SR, 4, drvPatch({ xbp: 3, xsp: 2, x1p: 3, x2p: 2, x3p: 3 }), [], Q, S, song);
  t.diagnostic(`the groove on memories 3 / 4 (default trims; no gate): pre-limiter peaks ${m34.pre.toFixed(3)} / ${m43.pre.toFixed(3)}, the limiter's deepest gain ${(20 * Math.log10(m34.gmin)).toFixed(2)} / ${(20 * Math.log10(m43.gmin)).toFixed(2)} dB`);
  // each card alone at the defaults (memory 2 = memory 1 there); the bass against the 808's BD (its default panel, v 100)
  const one = (patch, n, v) => go(SR, 4, patch, [[2, { t: 'on', n, v: v / 127 }]], 450).pre;
  const bd8 = one(drPatch(), 36, 100), bdv = one(drvPatch({ xbp: 0 }), 36, 100), bad = [], al = [];
  for (const v of [100, 127]) for (const [c, n] of [['bass', 36], ['snare', 38], ['tom 1', 48], ['tom 2', 45], ['tom 3', 41]]) {
    const x = one(drvPatch(), n, v);
    al.push(`${c} v ${v} ${x.toFixed(3)}`);
    if (!(x > 0.05 && x <= (v === 100 ? 0.8 : 1))) bad.push(`${c} at v ${v}: ${x.toFixed(3)}`);
  }
  t.diagnostic(`the bass (memory 1, v 100) ${bdv.toFixed(4)} vs the 808's BD ${bd8.toFixed(4)} (${(20 * Math.log10(bdv / bd8)).toFixed(2)} dB); alone: ${al.join(' · ')}`);
  assert.ok(Math.abs(20 * Math.log10(bdv / bd8)) <= 1, 'the bass at memory 1 within ± 1 dB of the 808\'s BD');
  assert.deepEqual(bad, []);
});

// IMPL-8 §12.7 / §15.5: the SDS-V's bench rows through the CPU gate (calibrated, ≤ 1.5 × the node target) and dvi — the machine
// powered with its payload, nothing sounding, past the 2 s quiet window — gated as row p is (7a's method)
test('8 bench rows (node gate): dvp, dvx, dvm ≤ 1.5 × their targets; dvi (an idle SDS-V with its payload) ≤ 1.5 × 0.0005', async (t) => {
  const { scenarios, drumTrack } = await import('./bench-scenarios.mjs');
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const node = B => {
    const p = new D.Proc({ processorOptions: { os: 4, hostOS: 4, offline: true } });
    p.msg(B.graph);
    for (const [id, patch] of Object.entries(B.patches)) p.msg({ t: 'patch', i: id, p: patch });
    for (const [id, c] of Object.entries(B.chains)) p.msg(Object.assign({ t: 'chain', c: id }, c));
    for (const [id, s] of Object.entries(B.seqs)) p.msg({ t: 'seq', i: id, s });
    if (B.song) p.msg(B.song);
    return p;
  };
  const rows = scenarios().filter(s => s.id.startsWith('dv'));
  assert.deepEqual(rows.map(s => s.id), ['dvp', 'dvx', 'dvm']);
  for (const S of rows) {
    const B = S.build(), p = node(B), cyc = B.cycle;
    assert.deepEqual([B.seqs.i1.m, B.seqs.i1.plan.n, B.song.notes.length > 0, !!cyc === (S.id === 'dvm')], ['sdsv', 0, true, true], S.id + ': roll notes, the empty plan');
    p.msg(Object.assign({ t: 'transport' }, B.transport, { frame: D.ctx.currentFrame }));
    const o = out();
    let cf = 0, ck = 0, pk = 0;
    const sec = () => { for (let k = 0; k < SR / 128; k++) { if (cyc && (cf += 128) > cyc.frames) { cf -= cyc.frames; p.msg(cyc.msgs[ck++ % cyc.msgs.length]); } p.process([], o); D.ctx.currentFrame += 128; } };
    for (let k = 0; k < SR / 128; k++) { p.process([], o); D.ctx.currentFrame += 128; pk = Math.max(pk, peakOf(o[0][0])); cf += 128; }
    assert.ok(pk > 0.01 && machOf(p.insts[0]) === 'sdsv', S.id + ': audible, the SDS-V');
    assert.equal(CPU.BENCH.targets[S.id].node, S.node);
    const best = await CPU.gateLoad(sec, S.node);
    t.diagnostic(`row ${S.id}: ${best.load.toFixed(4)} calibrated (raw ${best.raw.toFixed(4)}, t(calib) ${best.calib.toFixed(0)} ms, attempt ${best.attempt})`);
    assert.ok(best.load <= 1.5 * S.node, `row ${S.id}: ${best.load.toFixed(4)} > 1.5 × ${S.node}`);
  }
  // dvi: dvp's machine and payload, the transport stopped (no notes)
  const B = drumTrack(DRUM_PATTERNS.dvp, null, false, 'sdsv'), p = node(Object.assign(B, { song: null })), o = out(), sec = () => run(D, p, SR / 128, o);
  sec(); sec(); sec();
  const x = p.insts[0];
  assert.ok(x.quietF > 2 * SR && x.act === 0 && isDrSeq(x.sq) && machOf(x) === 'sdsv' && o[0][0].every(v => v === 0), 'dvi: the skip path, silent');
  const target = CPU.BENCH.targets.dvi.node, best = await CPU.gateLoad(sec, target);
  t.diagnostic(`row dvi: ${best.load.toFixed(5)} calibrated (raw ${best.raw.toFixed(5)}, attempt ${best.attempt})`);
  assert.ok(best.load <= 1.5 * target, `row dvi: ${best.load.toFixed(5)} > 1.5 × ${target}`);
});

/* ------------------------------------------------------------------ stage 9: the patch family (IMPL-9 §3.1, §3.5, §3.6, §8.3, lane E9) */
// Over the real scripts (patch-dsp.js, moog-dsp.js). The machine's controller is pm.m0 (its held keys, the key it sounds: tgt while
// gon); a reset is counted by a spy on that object. Click measures (the second difference) need smooth content: SINEP is a 921B at
// 32′ alone, its sine on MAIN OUT (≈ 0.074 FS, free-running: never quiet); Classic bass (the Model 15 tile's) where notes matter.
const M15 = MG.model15(), PAY15 = PT.payload(M15.rec), UNPATCHED = PT.payload(PT.fresh('moog'));
const SINEP = (() => {
  const x = PT.addModule(PT.fresh('moog'), {}, '921b'), r = PT.plug(x.rec, x.mid + '.sin', 'c.out').rec;
  return { rec: r, vals: PT.setKnob({}, r, x.mid, 'rg', 1) };
})(), SINEPAY = PT.payload(SINEP.rec);
const ptPatch = (vals = M15.vals, o) => patchFor('m900', vals, core.defaultFx2(), Object.assign({ sr: SR, bpm: 120 }, o));
const p9Scope = (o = {}) => dspScope(Object.assign({ engine: true, fast: true, console: quiet }, o));
const ctlOf = x => x.pm.m0;
const ptKey = C => (C.gon ? Math.round(C.tgt * 12 + 60) : -1);
const resetSpy = C => { const r = C.reset, c = { n: 0 }; C.reset = function () { c.n++; return r.call(this); }; return c; };
const d2max = (a, i0, i1) => { let m = 0; for (let i = Math.max(2, i0); i < i1; i++) m = Math.max(m, Math.abs(a[i] - 2 * a[i - 1] + a[i - 2])); return m; };
const ptDB = x => (20 * Math.log10(x || 1e-30)).toFixed(1);
const G1 = () => graph(['i1'], ['fx1'], [['i1', 'fx1', 1], ['fx1', 'out', 1]]);
// the Inst's own output, span by span (before the panel and the output stage: their DC block and limiter keep their own memory)
// (a skipped span — renderSpan returns 0 — wrote nothing: Lb is the last rendered span's, so it records silence: review 1 F7)
const ownOut = (I, n) => { const rs = I.renderSpan, L = new Float64Array(n * 128); let at = 0; I.renderSpan = function (k) { const v = rs.call(this, k); if (at + k <= L.length && v !== 0) L.set(this.Lb.subarray(0, k), at); at += k; return v; }; return L; };

test('9: a patch Inst from {t: patch} + {t: seq, s: {pg, pk}} on the warmed first Track, on a later Track and from processorOptions offline — bit for bit; the warm-up left its machine kept, fresh, with no graph, payload or ptErr', () => {
  const D = p9Scope(), P = ptPatch();
  const ev = [[20, { t: 'on', n: 48, v: 0.8 }], [60, { t: 'off', n: 48 }], [80, { t: 'on', n: 55, v: 0.6 }], [100, { t: 'wheel', v: 0.5 }], [120, { t: 'bend', v: 0.4 }], [150, { t: 'off', n: 55 }]];
  const go = p => { p.msg({ t: 'patch', p: P }); p.msg({ t: 'seq', s: PAY15 }); return play(D, p, 200, ev); };
  D.ctx.currentFrame = 0;
  const { p: first } = mk(D, { os: 4, hostOS: 4 }), I = first.i0;
  assert.ok(I.pm !== null && I.pmF === 'moog', 'the warm-up built the machine');
  assert.deepEqual([I.kind, I.pm.mon().mods.length, I.pm.live(), I.pmPend, I.pmErr, I.pmRun], ['analog', 0, false, null, 0, 0], 'kept: no graph, fresh');
  const a = go(first);
  assert.deepEqual([I.kind, I.pm.mon().mods.length, I.pm.live()], ['patch', 13, true], 'the Model 15 set and the controller, MAIN OUT patched');
  D.ctx.currentFrame = 0; const b = go(mk(D, { os: 4, hostOS: 4 }).p);
  D.ctx.currentFrame = 0;
  const { p: c } = mk(D, { os: 4, hostOS: 4, offline: true, patch: P, seq: PAY15 }), z = play(D, c, 200, ev);
  assert.ok(peakOf(a.L) > 0.05, 'Classic bass sounds');
  assert.ok(sameBits(a.L, b.L) && sameBits(a.R, b.R), 'the warmed-up first Track = a later one');
  assert.ok(sameBits(a.L, z.L) && sameBits(a.R, z.R), 'live = offline (processorOptions)');
  assert.ok(sameBits(a.L, a.R), 'mono');
});

test('9 routing (§3.1): a graph before its patch waits in pmPend (the newest) and is adopted at ptOn; another family\'s waits for its own; re-entered, the kept machine has no graph until its payload (an old one never sounds); a TB-303 payload builds no sq on a patch', () => {
  const D = p9Scope(), { p } = mk(D, NODE, classic('juno60')), I = p.i0, own = ownOut(I, 400);
  p.msg({ t: 'seq', s: UNPATCHED }); p.msg({ t: 'seq', s: SINEPAY });
  assert.deepEqual([I.kind, I.pmPend && I.pmPend.pk], ['analog', SINEPAY.pk], 'waiting: the newest');
  p.msg({ t: 'patch', p: ptPatch(SINEP.vals) });
  assert.deepEqual([I.kind, I.pmPend, I.pm.mon().mods.length, I.pm.live(), I.anyActive()], ['patch', null, 2, true, true], 'adopted at ptOn');
  const pm = I.pm, other = { pg: Object.assign({}, UNPATCHED.pg, { f: 'arp' }), pk: 'arp' };
  p.msg({ t: 'seq', s: other });
  assert.ok(I.pmPend === other && pm.mon().mods.length === 2, 'another family\'s graph waits; the patch plays on');
  p.msg({ t: 'seq', s: Object.assign({}, SEQ) });
  assert.deepEqual([I.sq, I.kind], [null, 'patch'], 'a TB-303 payload: no sq on a patch');
  play(D, p, 40);
  assert.ok(peakOf(own.subarray(10 * 128, 40 * 128)) > 0.05, 'it sounds');
  p.msg({ t: 'patch', p: classic('juno60') }); play(D, p, 10);
  assert.deepEqual([I.kind, pm.live()], ['analog', true], 'left: the machine as it was (reset)');
  p.msg({ t: 'patch', p: ptPatch(SINEP.vals) });
  assert.ok(I.pm === pm && I.pmPend === null, 'the machine kept; the other family\'s graph dropped');
  assert.deepEqual([pm.mon().mods.length, pm.live(), I.anyActive()], [0, false, false], 're-entered: no graph until its payload');
  play(D, p, 20);
  assert.equal(peakOf(own.subarray(54 * 128, 70 * 128)), 0, 'the old graph never sounds (past the Juno\'s 3 ms tail)');
  p.msg({ t: 'seq', s: SINEPAY });
  play(D, p, 20);
  assert.ok(peakOf(own.subarray(80 * 128, 90 * 128)) > 0.05, 'its payload: it plays');
});

test('9 kind changes (§3.1, §8.3): a classic → 900 Series → TR-808 → 900 Series on one Inst — every tail click-free (second difference under −60 dB), the machine kept', (t) => {
  const D = p9Scope(), { p } = mk(D, { os: 4, hostOS: 4, offline: true }, Object.assign({}, SINE, { level: 0.02 })), I = p.i0, L = ownOut(I, 200);
  p.msg({ t: 'on', n: 48, v: 0.8 });
  play(D, p, 200, [[40, { t: 'patch', p: ptPatch(SINEP.vals) }], [40, { t: 'seq', s: SINEPAY }], [90, { t: 'patch', p: drPatch({ bdd: 10 }) }], [100, { t: 'on', n: 36, v: 0.8 }],
    [140, { t: 'patch', p: ptPatch(SINEP.vals) }], [140, { t: 'seq', s: SINEPAY }]]);
  // (a switch into or out of the TR-808 steps once in its first samples whatever is on the other side — 7a's classic ↔ drums path:
  // a sine → 808 the same, 808 → a silent Minimoog the same step as 808 → a silent 900 Series, IMPL-9 §12 lane E9 — so those two
  // are measured past their first 8 samples, as 7b's tests measure the drum machines' switches)
  const rep = [];
  for (const s of [40, 90, 140].map(q => q * 128)) {
    const k = s !== 40 * 128 ? 8 : 0, pre = d2max(L, s - 2048, s), ch = d2max(L, s + k, s + 512);
    rep.push(`q${s / 128}: before ${ptDB(pre)} dB, across ${ptDB(ch)} dB${k ? ` (the first samples ${ptDB(d2max(L, s, s + k))} dB)` : ''}`);
    assert.ok(ch < 1e-3, `second difference across the switch at quantum ${s / 128}: ${ptDB(ch)} dB ≥ −60 dB`);
  }
  t.diagnostic(rep.join(' · '));
  assert.ok(peakOf(L.subarray(20 * 128, 40 * 128)) > 0.005 && peakOf(L.subarray(60 * 128, 90 * 128)) > 0.05 && peakOf(L.subarray(110 * 128, 140 * 128)) > 0.02 &&
    peakOf(L.subarray(160 * 128)) > 0.05, 'each sounds in its turn');
  assert.deepEqual([I.kind, I.pm.live()], ['patch', true]);
});

test('9 OS change (§3.6): {t: os} while the patch sounds goes through osFade — the machine follows (setOS), no click above −60 dB, it sounds on', (t) => {
  const D = p9Scope(), { p } = mk(D, { os: 4, hostOS: 4, offline: true }, ptPatch(SINEP.vals)), I = p.i0;
  p.msg({ t: 'seq', s: SINEPAY });
  const o = play(D, p, 120, [[40, { t: 'os', v: 2 }]]);
  assert.deepEqual([I.OS, I.osPend, I.pm.mon().os, I.pm.mon().ch], [2, 0, 2, 8], 'the machine at OS 2 (chunks of 8)');
  const before = d2max(o.L, 20 * 128, 40 * 128), change = d2max(o.L, 40 * 128, 50 * 128);
  t.diagnostic(`second difference: before ${ptDB(before)} dB, over the change ${ptDB(change)} dB`);
  assert.ok(change < 1e-3, `${ptDB(change)} dB ≥ −60 dB`);
  assert.ok(peakOf(o.L.subarray(60 * 128)) > 0.05, 'it sounds on after the change');
});

test('9 panic (§3.6): the machine reset with its held keys, the output faded; a patched patch is live, so it sounds again right after — fresh, faded in, click-free, its graph and values kept (a note then plays)', (t) => {
  const D = p9Scope(), { p } = mk(D, { os: 4, hostOS: 4, offline: true }, ptPatch(SINEP.vals)), I = p.i0;
  p.msg({ t: 'seq', s: SINEPAY }); p.msg({ t: 'on', n: 60, v: 0.9 });
  play(D, p, 30);
  const C0 = ctlOf(I), R = resetSpy(C0);
  assert.deepEqual([C0.held[60], ptKey(C0)], [1, 60]);
  const os = p.outStage, Q = [];
  p.outStage = function (Lo, Ro, off, n) { Q.push(Float64Array.from(this.Lb.subarray(0, n))); return os.call(this, Lo, Ro, off, n); };
  p.msg({ t: 'panic' });
  assert.ok(R.n === 1 && C0.held[60] === 0 && C0.nh === 0, 'reset: the held key gone');
  run(D, p, 30);
  assert.ok(R.n === 2 && p.pnN === 0, 'panicClear reset it again after the fade');
  const L = new Float64Array(Q.length * 128); Q.forEach((q, k) => L.set(q, k * 128));
  let low = Infinity; for (let k = 0; k < 32; k++) low = Math.min(low, peakOf(L.subarray(k * 16, k * 16 + 16)));
  t.diagnostic(`the fade's floor ${ptDB(low)} dB, the restart's second difference ${ptDB(d2max(L, 0, L.length))} dB`);
  assert.ok(low < 1e-3, 'the output faded out');
  assert.ok(d2max(L, 0, L.length) < 1e-3 && peakOf(L.subarray(10 * 128)) > 0.05, 'then it sounds again, click-free');
  assert.equal(I.pm.mon().mods.length, 2, 'the graph kept');
  p.msg({ t: 'on', n: 60, v: 0.9 }); run(D, p, 2);
  assert.equal(ptKey(C0), 60, 'a note plays');
});

test('9 scripts missing (§3.1): no PatchDSP, or no family table — {t: ptErr, why: load} once, silence, no throw; a hostile payload — the machine\'s first offending item once, with the Inst\'s id on a graph node; a good one then plays', () => {
  for (const ov of [{ 'patch-dsp.js': null }, { 'moog-dsp.js': null }]) {
    const D = p9Scope({ overrides: ov }), { p, sent } = mk(D, NODE, ptPatch()), I = p.i0;
    p.msg({ t: 'seq', s: PAY15 }); p.msg({ t: 'patch', p: ptPatch() }); p.msg({ t: 'on', n: 48, v: 0.8 });
    const o = play(D, p, 40);
    assert.equal(JSON.stringify(sent.filter(m => m.t === 'ptErr')), '[{"t":"ptErr","why":"load"}]', Object.keys(ov).join());
    assert.deepEqual([I.kind, I.pm], ['patch', null]);
    assert.ok(o.L.every(x => x === 0) && o.R.every(x => x === 0), 'silent');
  }
  const D = p9Scope(), { p, sent } = gnode(D, G1(), { i1: ptPatch(SINEP.vals) }, { fx1: fxOf() }), x = p.insts[0], own = ownOut(x, 40);
  const bad = { pg: { v: 1, f: 'moog', mods: [[0, 'ctl', -1], [1, 'nope', -1]], cords: [[0, 99, 1, 0, 1]] }, pk: 'bad' };
  p.msg({ t: 'seq', i: 'i1', s: bad }); p.msg({ t: 'seq', i: 'i1', s: bad });
  const E = sent.filter(m => m.t === 'ptErr');
  assert.ok(E.length === 1 && E[0].i === 'i1' && typeof E[0].why === 'string' && E[0].why !== 'load', JSON.stringify(E));
  p.msg({ t: 'seq', i: 'i1', s: SINEPAY });
  play(D, p, 20);
  assert.ok(peakOf(own.subarray(5 * 128, 20 * 128)) > 0.05, 'a good payload plays');
});

// IMPL-P review F1: a graph() that throws (the evaluator's RangeError on a deep chain in a small stack; here a stand-in, `boom` on the payload)
// never escapes the message handler silently — the machine keeps its previous graph, the host gets the one ptErr (why 'graph'), and
// setPatch (ptOn adopting a payload that waited in pmPend) still finishes: the values bound, the Inst on the patch kind
test('9 a graph() that throws (IMPL-P review F1): caught on both paths — ptMsg and ptOn — one {t: ptErr, why: graph}, the previous graph keeps playing, setPatch finishes (its values bound), a good payload then lands', () => {
  const wrap = src => src + `;(function () {
    const PD = globalThis.PatchDSP, cr = PD.create;
    globalThis.SETN = 0;
    globalThis.PatchDSP = Object.freeze(Object.assign({}, PD, { create(inst, f) {
      const m = cr(inst, f);
      if (m !== null) {
        const g = m.graph, st = m.set;
        m.graph = function (pg) { if (pg && pg.boom === 1) throw new RangeError('Maximum call stack size exceeded'); return g.call(this, pg); };
        m.set = function (pv) { globalThis.SETN++; return st.call(this, pv); };
      }
      return m;
    } }));
  })();`;
  const boom = { pg: Object.assign({}, PAY15.pg, { boom: 1 }), pk: 'boom' }, errs = sent => JSON.stringify(sent.filter(m => m.t === 'ptErr')), ONE = '[{"t":"ptErr","why":"graph"}]';
  // ptMsg: a sine playing on the kept machine, then the throwing payload (twice: one report)
  {
    const D = p9Scope({ overrides: { 'patch-dsp.js': wrap } }), { p, sent } = mk(D, NODE, ptPatch(SINEP.vals)), I = p.i0, own = ownOut(I, 80);
    p.msg({ t: 'seq', s: SINEPAY }); play(D, p, 20);
    assert.deepEqual([I.kind, I.pm.mon().mods.length], ['patch', 2]);
    assert.doesNotThrow(() => { p.msg({ t: 'seq', s: boom }); p.msg({ t: 'seq', s: boom }); });
    assert.equal(errs(sent), ONE, 'one report');
    assert.equal(I.pm.mon().mods.length, 2, 'the previous graph kept');
    play(D, p, 30);
    assert.ok(peakOf(own.subarray(40 * 128, 50 * 128)) > 0.05, 'it plays on');
    p.msg({ t: 'seq', s: UNPATCHED });
    assert.equal(I.pm.mon().mods.length, 1, 'a good payload lands after it');
  }
  // ptOn: the throwing payload waits in pmPend, the patch kind arrives
  {
    const D = p9Scope({ overrides: { 'patch-dsp.js': wrap } }), { p, sent } = mk(D, NODE, classic('juno60')), I = p.i0, own = ownOut(I, 80);
    p.msg({ t: 'seq', s: boom });
    assert.ok(I.pmPend !== null && I.kind === 'analog', 'waiting');
    const n0 = D.global('SETN');
    assert.doesNotThrow(() => p.msg({ t: 'patch', p: ptPatch(SINEP.vals) }));
    assert.equal(errs(sent), ONE, 'one report');
    assert.deepEqual([I.kind, I.pmPend, I.pm.mon().mods.length, D.global('SETN') - n0], ['patch', null, 0, 1], 'setPatch finished: the kind, the values bound; no graph');
    p.msg({ t: 'seq', s: SINEPAY }); play(D, p, 40);
    assert.ok(I.pm.live() && peakOf(own.subarray(20 * 128, 40 * 128)) > 0.05, 'its good payload plays');
  }
});

test('9 idle and power (§3.6, P-1): MAIN OUT unpatched → the 2 s idle skip; patched → never quiet, stats voices 1; powered off (a muted track) → its tail, the machine reset, skipped at once; on again → the held key restruck, faded in', () => {
  const D = p9Scope(), { p, sent } = gnode(D, G1(), { i1: ptPatch(SINEP.vals) }, { fx1: fxOf() }, Object.assign({}, NODE, { trackId: 'm9' })), x = p.insts[0];
  const rs = x.renderSpan;
  let last = -1;
  x.renderSpan = function (n) { return (last = rs.call(this, n)); };
  p.msg({ t: 'seq', i: 'i1', s: UNPATCHED });
  run(D, p, Math.ceil(2.2 * SR / 128));
  assert.deepEqual([last, x.anyActive(), x.quietF > 2 * SR], [0, false, true], 'unpatched: skipped after 2 s');
  p.msg({ t: 'seq', i: 'i1', s: SINEPAY });
  run(D, p, Math.ceil(2.5 * SR / 128));
  assert.deepEqual([last, x.anyActive(), x.act, x.quietF], [1, true, 1, 0], 'patched: never quiet');
  const st = sent.filter(m => m.t === 'stats').at(-1);
  assert.equal(st.per.find(e => e.id === 'i1').voices, 1, 'stats: one voice while live');
  p.msg({ t: 'on', n: 50, v: 0.8 }); run(D, p, 4);
  const C0 = ctlOf(x), R = resetSpy(C0);
  assert.equal(ptKey(C0), 50);
  p.msg({ t: 'power', i: 'i1', on: false });
  assert.ok(x.on === 0 && R.n === 1 && C0.held[50] === 0 && !x.anyActive() && x.pmIn === x.fadeN, 'off: its tail, the machine reset, its restart armed');
  run(D, p, 3);
  const o = out(); run(D, p, 20, o);
  assert.ok(last === 0 && o[0][0].every(v => v === 0) && x.act === 0, 'off: skipped, silent');
  p.msg({ t: 'power', i: 'i1', on: true });
  assert.ok(C0.held[50] === 1, 'on: the held key restruck');
  run(D, p, 2);
  assert.deepEqual([last, ptKey(C0), x.pmIn], [1, 50, 0], 'and it plays, faded in');
});

// review 1 F1: P-1's power-off leaves the machine fresh with its restart's fade-in armed; Play from a stop while it is off (P-2's
// ptFresh) must keep that fade-in — only a machine never rendered since it was built (the bounce's first frame) has none. A 921 at
// SUB-AUDIO, its triangle on MAIN OUT: smooth content that starts at −0.565 V (an unfaded start steps ≈ 0.06 FS: −26 dB)
const TRI = (() => {
  const x = PT.addModule(PT.fresh('moog'), {}, '921'), r = PT.plug(x.rec, x.mid + '.tri', 'c.out').rec;
  return { rec: r, vals: PT.setKnob({}, r, x.mid, 'cr', 0) };
})(), TRIPAY = PT.payload(TRI.rec);

test('9 P-1 × P-2 (review 1 F1): a powered-off patch, Play from a stop (before the power-on, or in its quantum), then on — the restart is still faded in, click-free like off → on alone', (t) => {
  const rep = [];
  for (const how of ['off → on', 'off → Play → on', 'on + Play, one quantum']) {
    const D = p9Scope(), { p } = gnode(D, G1(), { i1: ptPatch(TRI.vals) }, { fx1: fxOf() }, Object.assign({}, NODE, { trackId: 'm9' })), x = p.insts[0], own = ownOut(x, 160);
    p.msg({ t: 'seq', i: 'i1', s: TRIPAY });
    const F0 = D.ctx.currentFrame, tp = q => ({ t: 'transport', play: true, frame: F0 + q * 128, tick: 0, fpt: SR * 60 / (120 * 960), seek: true });
    const ev = [[40, { t: 'power', i: 'i1', on: false }]];
    if (how === 'off → Play → on') ev.push([60, tp(60)]);
    ev.push([100, { t: 'power', i: 'i1', on: true }]);
    if (how === 'on + Play, one quantum') ev.push([100, tp(100)]);
    play(D, p, 160, ev);
    const s = 100 * 128, steady = d2max(own, 20 * 128, 40 * 128), on = d2max(own, s - 4, s + 512);
    rep.push(`${how}: ${ptDB(on)} dB (steady ${ptDB(steady)})`);
    assert.ok(peakOf(own.subarray(20 * 128, 40 * 128)) > 0.05 && peakOf(own.subarray(43 * 128, 100 * 128)) === 0 && peakOf(own.subarray(120 * 128)) > 0.05, how + ': sounds, silent while off, sounds again');
    assert.ok(on < 1e-3, `${how}: second difference at the power-on ${ptDB(on)} dB ≥ −60 dB`);
  }
  t.diagnostic(rep.join(' · '));
  // the bounce's first frame (a machine built, never rendered or reset; Play from a stop at once) keeps no fade-in: D7, live = bounce
  const D = p9Scope(); D.ctx.currentFrame = 0;
  const { p } = mk(D, NODE, ptPatch(TRI.vals)), I = p.i0;
  p.msg({ t: 'seq', s: TRIPAY }); p.msg({ t: 'transport', play: true, frame: 0, tick: 0, fpt: SR * 60 / (120 * 960), seek: true });
  assert.deepEqual([I.pmNew, I.pmIn], [1, I.fadeN], 'built: armed, never rendered');
  run(D, p, 1);
  assert.deepEqual([I.pmNew, I.pmRun, I.pmIn], [0, 1, 0], 'Play from a stop on it: no tail, no fade-in');
});

test('9 notes (§3.5): a graph node\'s zone and transposition reach the controller — a key outside it never; a note-off reaches the key it struck; a preview plays as a note', () => {
  const D = p9Scope(), { p } = gnode(D, graph([gi('i1', { zone: { lo: 40, hi: 80, xp: 12 } })], ['fx1'], [['i1', 'fx1', 1], ['fx1', 'out', 1]]), { i1: ptPatch() }, { fx1: fxOf() });
  const x = p.insts[0];
  p.msg({ t: 'seq', i: 'i1', s: PAY15 });
  const C0 = ctlOf(x);
  p.msg({ t: 'on', n: 48, v: 0.8 }); p.msg({ t: 'on', n: 90, v: 0.8 });
  assert.deepEqual([C0.held[60], C0.held[48], C0.held[90], C0.held[102]], [1, 0, 0, 0], 'in zone, transposed; out of zone: never');
  p.msg({ t: 'off', n: 48 });
  assert.equal(C0.held[60], 0, 'the note-off reaches the key it struck');
  p.msg({ t: 'on', n: 52, v: 0.5, aud: 1, i: 'i1' });
  assert.equal(C0.held[52], 1, 'a preview: a note');
  p.msg({ t: 'off', n: 52, aud: 1, i: 'i1' });
  assert.equal(C0.held[52], 0);
});

test('9 P-2 (the lead\'s decision): Play from a stop restarts the patch fresh under the 3 ms tail, faded in — click-free; a seek while playing, a loop wrap and a stop do not', (t) => {
  const D = p9Scope(), { p } = mk(D, { os: 4, hostOS: 4, offline: true }, ptPatch(SINEP.vals)), I = p.i0;
  p.msg({ t: 'seq', s: SINEPAY });
  play(D, p, 40);
  const R = resetSpy(ctlOf(I)), F = D.ctx.currentFrame;
  const o = play(D, p, 80, [[0, { t: 'transport', play: true, frame: F + 1000, tick: 0, fpt: 25, seek: true, loop: true, ls: 0, le: 240 }]]);
  assert.equal(R.n, 1, 'one restart, at the start (the loop wraps every 6000 frames: none there)');
  const d = d2max(o.L, 0, o.L.length);
  t.diagnostic(`second difference across the restart ${ptDB(d)} dB`);
  assert.ok(d < 1e-3 && peakOf(o.L.subarray(20 * 128)) > 0.05, 'click-free, and it sounds on');
  p.msg({ t: 'transport', play: true, frame: D.ctx.currentFrame + 300, tick: 120, fpt: 25, seek: true }); play(D, p, 10);
  assert.equal(R.n, 1, 'a seek while playing: no restart');
  p.msg({ t: 'transport', play: false }); play(D, p, 10);
  assert.equal(R.n, 1, 'a stop: none');
  p.msg({ t: 'transport', play: true, frame: D.ctx.currentFrame + 300, tick: 0, fpt: 25, seek: true }); play(D, p, 10);
  assert.equal(R.n, 2, 'Play from the stop: a restart');
});

test('9 drift (§3.4): the app\'s analog drift reaches the oscillators through m900\'s map (p.drift) — a patch drifts when it is above 0, never at 0 (the goldens\')', () => {
  const D = p9Scope();
  const go = drift => { D.ctx.currentFrame = 0; const { p } = mk(D, { os: 4, hostOS: 4, offline: true }, ptPatch(SINEP.vals, { drift })); p.msg({ t: 'seq', s: SINEPAY }); return { p, o: play(D, p, 600) }; };
  const a = go(0), b = go(0), c = go(1);
  assert.deepEqual([a.p.i0.p.drift, c.p.i0.p.drift], [0, 1], 'p.drift');
  assert.ok(sameBits(a.o.L, b.o.L), 'drift 0: no walk, deterministic');
  let d = 0; for (let i = 500 * 128; i < 600 * 128; i++) d = Math.max(d, Math.abs(a.o.L[i] - c.o.L[i]));
  assert.ok(d > 1e-3, `drift 1: the pitch wanders (${d.toExponential(2)} apart after 1.3 s)`);
});

// §8.1's headroom through the whole Track (V9b: OUT_K 0.15 a volt): every starting patch with a note line at 48 kHz × 4 and
// 44.1 kHz × 2 — the pre-limiter peak (the limiter's input) never reaches the limiter's threshold (−1 dBFS); Classic bass
// peaks between −12 and −3 dBFS (the 808 groove's gate, 8 §12.4: measured as the app plays it). IMPL-9b §8.8: all thirteen — the
// six on the Model 15 set, the seven on their own modules, the payload with the vals (Routed's bus rows) —, IMPL-9c: sixteen with the three
// 1960s ones (Drift choir, Follower wah, Spring pluck: on their own modules too); the clocked pair
// (Sequence, Twenty-four steps) built while stopped, then ▶ from a stop at 120 BPM (the song's transport into the Song clock) — each
// sounds (above −30 dBFS)
test('9 headroom (§3.2, §8.1; 9b §8.8; 9c §2): the sixteen starting patches through the whole Track never reach the limiter (48 kHz × 4, 44.1 kHz × 2) and sound — the clocked pair from ▶; Classic bass peaks −12 … −3 dBFS', (t) => {
  const rep = [], CLK = new Set(['Sequence', 'Twenty-four steps']), S9 = new Set(['Classic bass', 'Filter sweep', 'Drone', 'Sync lead', 'Wind', 'Bells']);
  assert.equal(MG.PRESETS.length, 16);
  for (const [sr, os] of [[48000, 4], [44100, 2]]) {
    const D = p9Scope({ sampleRate: sr });
    for (const P of MG.PRESETS) {
      const r = PT.loadPreset(PT.fresh('moog'), {}, P.name, S9.has(P.name) ? { ensure: MG.M15 } : undefined);
      const { p } = mk(D, { os, hostOS: os, offline: true }, patchFor('m900', r.vals, core.defaultFx2(), { sr, bpm: 120 }));
      p.msg({ t: 'seq', s: PT.payload(r.rec, 'moog', r.vals) });
      let pk = 0;
      const lp = p.lim.process;
      p.lim.process = function (A, B, n) { for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(A[i]), Math.abs(B[i])); return lp.call(this, A, B, n); };
      const q = Math.round(0.25 * sr / 128), ev = [];
      for (const [k, n] of [[0, 48], [1, 55], [2, 43], [3, 60], [4, 36]]) ev.push([2 + k * 2 * q, { t: 'on', n, v: 1 }], [2 + (k * 2 + 1) * q, { t: 'off', n }]);
      if (CLK.has(P.name)) ev.push([1, { t: 'transport', play: true, frame: D.ctx.currentFrame + 128 + 40, tick: 0, fpt: sr * 60 / (120 * 960), seek: true, fresh: true }]);
      play(D, p, 12 * q, ev);
      rep.push(`${P.name} ${ptDB(pk)}`);
      assert.ok(pk < Math.pow(10, -1 / 20), `${P.name} at ${sr} × ${os}: ${ptDB(pk)} dBFS reaches the limiter`);
      assert.ok(pk > Math.pow(10, -30 / 20), `${P.name} at ${sr} × ${os}: ${ptDB(pk)} dBFS — silent`);
      if (P.name === 'Classic bass') assert.ok(pk > Math.pow(10, -12 / 20) && pk < Math.pow(10, -3 / 20), `Classic bass at ${sr} × ${os}: ${ptDB(pk)} dBFS`);
    }
    rep.push('|');
  }
  t.diagnostic('pre-limiter peaks (dBFS): ' + rep.join(' · '));
});

test('9: a patch Inst renders without allocating — notes, bend, wheel, a held chord', () => {
  const D = p9Scope(), { p } = mk(D, { os: 4, hostOS: 4, offline: true }, ptPatch());
  p.msg({ t: 'seq', s: PAY15 });
  const o = out();
  run(D, p, 50, o);
  let pk = 0;
  noAlloc(D, () => {
    for (let k = 0; k < 400; k++) {
      if (k === 100) p.noteOn(48, 0.9); if (k === 150) p.noteOn(55, 0.7); if (k === 200) p.noteOff(48); if (k === 300) p.noteOff(55);
      if (k === 120) p.msg({ t: 'bend', v: 0.5 }); if (k === 180) p.msg({ t: 'wheel', v: 0.7 });
      p.process([], o); D.ctx.currentFrame += 128;
      for (const v of o[0][0]) if (Math.abs(v) > pk) pk = Math.abs(v);
    }
  });
  assert.ok(pk > 0.05, 'it played');
});

// IMPL-9b §3.1 / §8.3 (skeptic #7, spike (a2) decision 1): the warm graphs are split into parts once the table outgrows the
// evaluator's 256 connections — every payload analyses with no offending item and fits; across the parts every type, every jack,
// the loop steps (a lone late source: the pre feed), the 921Bs' sync paths, normals read under a ramp; every event, a lamp read; a
// playing transport with a loop wrap (and one with an end) during graph b; the whole table in one payload ≈ 100 times (the GC pre-warm)
test('9 warmPatch (§3.1, spike (a) decision 4; 9b §3.1): the first Track\'s warm-up ran every class of the family\'s table (a linked one driven and undriven), every jack patched, loop steps with their ramps and a lone late source, the sync paths, normals, a module retired, both value sets (STRONG sync, LAST, MULTIPLE), notes, resets (Play from a stop, a power-off), setOS there and back, every event, a lamp read, a playing transport with a wrap and with an end, the whole table ≈ 100 times — every payload within 256 connections, no offending item; restore() left the machine fresh', () => {
  const wrap = src => src + `;(function () {
    const PD = globalThis.PatchDSP, cr = PD.create, L = globalThis.GLOG = [];
    let id = 0;
    globalThis.PatchDSP = Object.freeze(Object.assign({}, PD, { create(inst, f) {
      const m = cr(inst, f), me = ++id;
      if (m !== null) {
        const g = m.graph, so = m.setOS, st = m.set, no = m.note, re = m.reset, ev = m.ev, la = m.lamps, rd = m.render;
        m.graph = function (pg) { const r = g.call(this, pg), M = this.mon(); L.push(JSON.stringify({ me, pg, r: r && { steps: r.steps, loops: r.loops, live: r.live, ramps: r.ramps, why: r.why }, mods: M.mods, run: M.run })); return r; };
        m.setOS = function (os, fs) { L.push(JSON.stringify({ os })); return so.call(this, os, fs); };
        m.set = function (pv) { L.push(JSON.stringify({ pv })); return st.call(this, pv); };
        m.note = function (n, v, on) { L.push(JSON.stringify({ note: on })); return no.call(this, n, v, on); };
        m.reset = function () { L.push(JSON.stringify({ reset: 1 })); return re.call(this); };
        m.ev = function (n, k) { const r = ev.call(this, n, k); L.push(JSON.stringify({ ev: [n, k, r] })); return r; };
        m.lamps = function (F) { const r = la.call(this, F); L.push(JSON.stringify({ lamps: r.l.length })); return r; };
        m.render = function (b, N, F0) { const tp = inst.tp; if (tp && tp.play) L.push(JSON.stringify({ play: [tp.wrap ? 1 : 0, tp.end != null ? 1 : 0, tp.tick + (4 * Math.floor(F0 / 4) - tp.frame) / tp.fpt] })); return rd.call(this, b, N, F0); };
      }
      return m;
    } }));
  })();`;
  const D = p9Scope({ overrides: { 'patch-dsp.js': wrap } });
  D.ctx.currentFrame = 0;
  const { p } = mk(D, { os: 4, hostOS: 4 }), I = p.i0, E = [...D.global('GLOG')].map(s => JSON.parse(s)), MAXC = D.global('PatchDSP').MAXC;
  const LINKED = MG.ORDER_ALL.filter(t => MG.TYPES[t].link), gs = E.filter(e => e.pg && e.pg.mods.length > 0 && e.me === 1), big = gs.filter(e => e.pg.mods.length === MG.ORDER_ALL.length + LINKED.length);   // (each linked type twice: driven, undriven)
  const parts = gs.filter(e => e.pg.mods.length < MG.ORDER_ALL.length);
  assert.ok(parts.length >= 6 && big.length >= 100, `the warm graphs (${parts.length} of the parts, ${big.length} of the whole table)`);
  assert.deepEqual(E.filter(e => e.r && e.r.why.length).map(e => e.r.why), [], 'no offending item');
  // IMPL-P §3.2 (skeptic #16): the evaluator's MAXC / MAXM are lifted (8192 / 1024) but the warm-up keeps the old shapes: engine.js's
  // WARM_C (a script-scope const of the worklet file: pinned here as a literal) splits the table by 256 connections, and every warm
  // payload holds ≤ 64 modules (the old MAXM: the table's types + the controller) — so the warm payload list is the 9dde7e6 one
  // byte for byte (hashed on that base before lane B's first edit: 119 payloads). IMPL-9c G4 (a): re-pinned to the 36-type table (the
  // ten 1960s types: still two parts, 17 and 22 modules, 119 payloads; PatchMoog.T lists the 901B before the 921B, so the undriven
  // 921B stays the loop module — the 901B, no input of its own, last would take the loop steps away — lane V, on wt-9c with K's tables).
  // IMPL-9c fix E: re-pinned again — graphs b and c now carry a ring through every loop-capable module of the part (a unchanged;
  // still 119 payloads, the same calls; the loop no longer hangs on the table's order): was 87b16aac…
  assert.equal(gs.filter(e => e.pg.cords.length > 256).length, 0, 'every payload within 256 connections (WARM_C)');
  assert.equal(gs.filter(e => e.pg.mods.length > 64).length, 0, 'every payload within 64 modules (the old MAXM)');
  assert.ok(MAXC >= 256, 'the evaluator\'s bound is at least the warm-up\'s');
  assert.equal(E.filter(e => e.pg).length, 119);
  assert.equal(createHash('sha256').update(E.filter(e => e.pg).map(e => JSON.stringify(e.pg)).join('\n')).digest('hex'), '5e1aad3904700410a9e2ecd0273c830ef234dfe056c791964a7931fdfaba1dcd', 'the warm payload list: the 9c table\'s, fix E\'s ring');
  assert.ok(new Set(parts.map(e => e.pg.mods.map(m => m[1]).join())).size >= 2, 'the table in parts');
  // each part's graph a: the first payload of each module list that no other list contains (c is a's less a module)
  const key = e => JSON.stringify(e.pg.mods), sub = (x, y) => x.pg.mods.length < y.pg.mods.length && x.pg.mods.every(m => y.pg.mods.some(q => q.join() === m.join()));
  const A = parts.filter((e, k) => parts.findIndex(x => key(x) === key(e)) === k && !parts.some(y => sub(e, y)));
  assert.ok(A.length >= 2, 'graph a of each part');
  assert.deepEqual([...new Set(A.flatMap(e => e.pg.mods.map(m => m[1])))].sort(), [...MG.ORDER_ALL].sort(), 'every type across the parts');
  assert.deepEqual([...new Set(A.flatMap(e => e.mods.map(m => m[1])))].sort(), [...MG.ORDER_ALL].sort(), 'every class built');
  // (a type with no output — the 993, 994, CP8A: no slots, the evaluator's multiples — is built, never scheduled)
  for (const e of A) assert.deepEqual(e.mods.filter(([n, ty]) => !e.run.includes(n) && MG.TYPES[ty].jacks.some(j => j.dir === 'out')), [], 'every module with an output live: each one runs');
  for (const ty of LINKED) assert.deepEqual(A.flatMap(e => e.pg.mods.filter(m => m[1] === ty).map(m => m[2] >= 0)), [true, false], ty + ': the linked type driven and undriven');
  // IMPL-9c G4 (a): the 9c keys reorder the parts (the integer-like 901 first, the 901A among the last) — warmPatchOn's part (the first with
  // a driven module: a new Track's first patch) still holds the 921B (Classic bass's first quanta), its driver beside it
  const WP = D.run('ptWarms(globalThis.PatchMoog, "moog", 256)').parts.find(Q => Q.a.mods.some(m => m[2] >= 0));
  assert.ok(WP.a.mods.some(m => m[1] === '921b' && m[2] >= 0) && WP.a.mods.some(m => m[1] === '921a'), 'warmPatchOn\'s part holds the driven 921B');
  for (const e of A) for (const [n, ty] of e.pg.mods) MG.TYPES[ty].jacks.forEach((j, k) => {
    if (j.dir === 'in') assert.ok(e.pg.cords.some(c => c[2] === n && c[3] === k), `${ty} ${j.id} fed`);
    if (j.dir === 'out') assert.ok(e.pg.cords.some(c => c[0] === n && c[1] === k), `${ty} ${j.id} read`);
    if (j.dir === 'any') assert.ok(e.pg.cords.some(c => (c[0] === n && c[1] === k) || (c[2] === n && c[3] === k)), `${ty} ${j.id} patched`);
  });
  assert.ok(gs.some(e => e.r.loops > 0) && gs.some(e => e.r.ramps > 0), 'a loop step, ramps');
  // a lone late source (an input fed only by its own module: the loop's pre feed); the 921Bs' sync driven by a module (not the keys)
  assert.ok(parts.some(e => e.pg.cords.some(c => c[0] === c[2] && e.pg.cords.filter(d => d[2] === c[2] && d[3] === c[3]).length === 1)), 'a lone self cord');
  const syncOf = e => { const b = e.pg.mods.filter(m => m[1] === '921b').map(m => m[0]), sy = MG.TYPES['921b'].jacks.findIndex(j => j.id === 'sy'); return e.pg.cords.some(c => b.includes(c[2]) && c[3] === sy && c[0] !== 0); };
  assert.ok(parts.some(e => e.r.loops > 0 && syncOf(e)), 'the 921Bs\' sync driven by a module, in a graph with a loop step');
  const nm = e => e.pg.mods.some(([n, ty]) => MG.TYPES[ty].jacks.some((j, k) => j.norm && !e.pg.cords.some(c => c[2] === n && c[3] === k)));
  assert.ok(parts.some(e => nm(e) && e.r.ramps > 0), 'normalled inputs left to their normals, under a ramp');
  assert.ok(parts.some((e, k) => k > 0 && e.pg.mods.length === parts[k - 1].pg.mods.length - 1), 'a module retired');
  const pvs = E.filter(e => e.pv).map(e => e.pv), oss = E.filter(e => e.os).map(e => e.os);
  const sw = id => new Set(pvs.map(v => { const e = A.find(x => x.pg.mods.some(m => m[1] === '921b')), [n] = e.pg.mods.find(m => m[1] === '921b'); return v['m' + n] ? v['m' + n][id] : undefined; }));
  assert.ok(new Set(pvs.map(v => JSON.stringify(v))).size >= 2 && sw('ss').has(2), 'both value sets, STRONG sync among them');
  assert.ok(new Set(pvs.map(v => v['0'][1])).has(1) && new Set(pvs.map(v => v['0'][2])).has(1), 'LAST, MULTIPLE');
  assert.ok(new Set(pvs.map(v => Object.keys(v).length)).size >= 5, 'the values in five or more shapes');
  assert.ok(oss.length >= 4 && oss.includes(2) && oss.includes(4) && oss[1] === oss[3], `setOS there and back each round (${oss})`);
  assert.ok(E.filter(e => e.note === 1).length >= 4 && E.filter(e => e.reset).length >= 4, 'notes, resets (P-2, power)');
  // every event of every evented type, delivered; a lamp read
  for (const ty of MG.ORDER_ALL.filter(t => (MG.TYPES[t].ev || []).length)) {
    const ns = A.flatMap(e => e.pg.mods.filter(m => m[1] === ty).map(m => m[0])), got = new Set(E.filter(e => e.ev && e.ev[2] === 1).map(e => e.ev[1]));
    assert.ok(ns.length > 0 && MG.TYPES[ty].ev.every((x, k) => got.has(k)), ty + ': every event delivered');
  }
  assert.ok(E.some(e => e.lamps > 0), 'a lamp read');
  // the playing stand-in transport: a count-in (t < 0) and past tick 0, a wrap folded, a song with an end
  const pl = E.filter(e => e.play).map(e => e.play);
  assert.ok(pl.some(x => x[0] === 1) && pl.some(x => x[1] === 1) && pl.some(x => x[2] < 0), 'a playing transport: a wrap, an end, a count-in');
  assert.deepEqual([I.kind, I.pm.mon().mods.length, I.pmPend, I.pmErr, I.on, I.tp === p.tp], ['analog', 0, null, 0, 1, true], 'restore: fresh, the Track\'s transport back');
});

// IMPL-9c fix E (lane V's open finding): 9b's loop was a back cord from the last module to module 1, a loop only where the chain ran
// unbroken between them — the table's order decided it. The 9c table's integer-like ids moved the part boundary: part 0 ended on
// the 994 (no 1/4" output) with no loop step, and loopRun's per-sample call (patch-dsp.js `ms[k].run`) met three classes in the
// warm-up (9b's seven: generic past V8's four maps) — m9x's loop deopted it on a new Track. Now a ring through every loop-capable
// module of each part (a section with a 1/4" input and a 1/4" output — read from the table's jacks here, not from engine.js): each
// part's graph b holds one loop step with all of them, and the call site meets every loop-capable class of the table (≥ 9b's seven)
test('9c warm-up loops (fix E): each warm part\'s graph b holds one loop step with every loop-capable module of the part (≥ 2 members); loopRun\'s per-sample call meets every loop-capable class of the table — at least 9b\'s seven', () => {
  const wrap = src => src + `;(function () {
    const PD = globalThis.PatchDSP, cr = PD.create, S = globalThis.GLR = new Set();
    globalThis.PatchDSP = Object.freeze(Object.assign({}, PD, { create(inst, f) {
      const m = cr(inst, f);
      if (m !== null) { const lr = m.loopRun; m.loopRun = function (st, i0, i1) { for (let k = 0; k < st.nm; k++) S.add(st.ms[k].constructor.name); return lr.call(this, st, i0, i1); }; }
      return m;
    } }));
  })();`;
  const D = p9Scope({ overrides: { 'patch-dsp.js': wrap } });
  D.ctx.currentFrame = 0;
  mk(D, { os: 4, hostOS: 4 });                                                   // (the first live Track: the warm-up)
  const PM = D.global('PatchMoog'), PD = D.global('PatchDSP'), WS = D.run('ptWarms(globalThis.PatchMoog, "moog", 256)');
  const lc = t => { const J = MG.TYPES[t].jacks, q = (j, d) => j.dir === d && j.sig !== 's'; return J.some(j => q(j, 'out') && J.some(i => q(i, 'in') && (i.sec | 0) === (j.sec | 0))); };
  const LCT = MG.ORDER_ALL.filter(t => t !== PM.CTL && lc(t));
  assert.ok(WS.parts.length >= 2 && LCT.length >= 7, `the table in parts (${WS.parts.length}), its loop-capable types (${LCT.length})`);
  WS.parts.forEach((W, i) => {
    const S = PD.schedule(W.b, 'moog'), mine = W.b.mods.filter(([n, t]) => n !== 0 && lc(t)).map(m => m[0]);
    const loops = S.steps.filter(s => s.loop === 1).map(s => [...new Set(s.nodes.map(v => S.nodes[v][0]))]);
    assert.deepEqual([...S.why], [], `part ${i}: graph b analyses with no offending item`);
    assert.ok(mine.length >= 2, `part ${i}: ${mine.length} loop-capable modules`);
    assert.ok(loops.some(L => L.length >= 2 && mine.every(n => L.includes(n))), `part ${i}: one loop step holds its ${mine.length} loop-capable modules (loops: ${JSON.stringify(loops)})`);
  });
  const seen = [...D.global('GLR')], want = [...new Set(LCT.map(t => PM.T[t].name))];
  assert.deepEqual(want.filter(x => !seen.includes(x)), [], 'every loop-capable class met at loopRun\'s call site');
  assert.ok(seen.length >= 7, `loopRun's call site met ${seen.length} classes (9b's seven)`);
});

// IMPL-9 §3.8 / §12 spike (a): the 900 Series' rows through the CPU gate (calibrated, ≤ 1.5 × the node target); IMPL-9b §3.7: the
// System 55 set's m9q (Sequence, the Song clock on ALWAYS) and m9s (the classic voice, three 911s by the 993's bus rows); IMPL-9c G3:
// the System IIIc set's m9c (the classic voice: ten oscillators, the 984, the three filters, the 905)
test('9 bench rows (node gate): m9p, m9x, m9d, m9q, m9s, m9c ≤ 1.5 × their targets', async (t) => {
  const D = dspScope({ engine: true, fast: true, console: quiet });
  const { scenarios } = await import('./bench-scenarios.mjs');
  const rows = scenarios().filter(s => s.id.startsWith('m9'));
  assert.deepEqual(rows.map(s => s.id), ['m9p', 'm9x', 'm9d', 'm9q', 'm9s', 'm9c']);
  for (const S of rows) assert.equal(CPU.BENCH.targets[S.id].jsc, S.jsc, S.id + ': the jsc target (9b rows)');
  for (const S of rows) {
    const B = S.build(), p = new D.Proc({ processorOptions: { os: 4, hostOS: 4, offline: true } });
    p.msg(B.graph);
    for (const [id, patch] of Object.entries(B.patches)) p.msg({ t: 'patch', i: id, p: patch });
    for (const [id, c] of Object.entries(B.chains)) p.msg(Object.assign({ t: 'chain', c: id }, c));
    for (const [id, s] of Object.entries(B.seqs)) p.msg({ t: 'seq', i: id, s });
    if (B.song) p.msg(B.song);
    if (B.transport) p.msg(Object.assign({ t: 'transport' }, B.transport, { frame: D.ctx.currentFrame }));
    for (const [n, v] of B.notes) p.msg({ t: 'on', n, v });
    const o = out(), sec = () => run(D, p, SR / 128, o);
    let pk = 0;
    for (let k = 0; k < SR / 128; k++) { p.process([], o); D.ctx.currentFrame += 128; pk = Math.max(pk, peakOf(o[0][0])); }
    assert.ok(pk > 0.01 && p.insts[0].kind === 'patch' && p.insts[0].pm.live(), S.id + ': audible, live');
    assert.equal(CPU.BENCH.targets[S.id].node, S.node);
    const best = await CPU.gateLoad(sec, S.node);
    t.diagnostic(`row ${S.id}: ${best.load.toFixed(4)} calibrated (raw ${best.raw.toFixed(4)}, t(calib) ${best.calib.toFixed(0)} ms, attempt ${best.attempt})`);
    assert.ok(best.load <= 1.5 * S.node, `row ${S.id}: ${best.load.toFixed(4)} > 1.5 × ${S.node}`);
  }
});

// spike (a) decision 4 (warmPatch mandatory): a cold patch's first quantum took 2.0–2.7 ms of the 2.67 ms deadline and a cold
// graph() 1.3–1.6 ms; in a warmed scope (a fresh isolate: the first live Track warmed it) a new Track's patch — Classic bass's
// payload, its first note, then m9x's patch arriving mid-note (a loop step, sync, an audio-rate clamp, the 907A, every module) —
// renders each first quantum within a quarter of the deadline (0.67 ms) and its graph() within 0.5 ms. Not yet 1.5 × the steady
// state as the classics' (§9.2 above): the ratios are in the diagnostics, and the next test gates the scripts' own cold start (no
// deopt in patch-dsp / moog-dsp, fixed in the fjit round: "wrong map" on fields that changed representation on a new instance, IMPL-9
// §12 lane E9) and a first-quantum ratio (single-quantum timings are noisy: the best of up to 5 scopes)
test('9 warm-up (spike (a) decision 4): in a warmed scope the first quanta of a patch — Classic bass\'s payload and first note, then m9x\'s patch arriving mid-note — each ≤ a quarter of the deadline, its graph() ≤ 0.5 ms (fresh isolate)', async (t) => {
  const { spawnSync } = await import('node:child_process');
  const here = new URL('./', import.meta.url).href, V = '?v=9';
  const code = `
    import '${here}v8-guard.mjs';
    import { dspScope } from '${here}dsp-scope.mjs';
    import * as core from '${here}../serum-core.js${V}';
    import { patchFor } from '${here}../models.js${V}';
    import * as MG from '${here}../moog-core.js${V}';
    import * as PT from '${here}../patch-core.js${V}';
    import { m9xPatch } from '${here}bench-scenarios.mjs';
    const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} }, out = [], DL = 0.25 * 128 / 48;
    const m = MG.model15(), x = m9xPatch(), P1 = PT.payload(m.rec), P2 = PT.payload(x.rec);
    const patch = v => patchFor('m900', v, core.defaultFx2(), { sr: 48000, bpm: 120 });
    for (let k = 0; k < 5; k++) {
      const D = dspScope({ engine: true, fast: true, console: quiet });
      new D.Proc({ processorOptions: { os: 4, hostOS: 4 } }); // (the first live Track of the scope: the warm-up)
      const p = new D.Proc({ processorOptions: { os: 4, hostOS: 4 } });
      const o = [[new Float32Array(128), new Float32Array(128)]], q = () => { const t0 = performance.now(); p.process([], o); D.ctx.currentFrame += 128; return performance.now() - t0; };
      const steady = n => { const a = []; for (let j = 0; j < n; j++) a.push(q()); return a.slice(n >> 2).sort((y, z) => y - z)[(n - (n >> 2)) >> 1]; };
      p.msg({ t: 'patch', p: patch(m.vals) });
      let t0 = performance.now(); p.msg({ t: 'seq', s: P1 }); const g1 = performance.now() - t0;
      const f0 = q();
      steady(200);
      p.msg({ t: 'on', n: 36, v: 0.8 });
      const f1 = q(), m1 = steady(300);
      p.msg({ t: 'patch', p: patch(x.vals) });
      t0 = performance.now(); p.msg({ t: 'seq', s: P2 }); const g2 = performance.now() - t0;
      p.msg({ t: 'on', n: 43, v: 0.7 });
      const f2 = q(), m2 = steady(300);
      out.push([Math.max(f0, f1), m1, f2, m2, g1, g2]);
      if (Math.max(f0, f1, f2) <= DL && g1 <= 0.5 && g2 <= 0.5) break;
    }
    console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--max-old-space-size=2048', '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout.trim().split('\n').pop());
  const DL = 0.25 * 128 / 48;
  let best = [Infinity, Infinity, Infinity, Infinity];
  for (const [f1, m1, f2, m2, g1, g2] of got) {
    if (Math.max(f1, f2) < Math.max(best[0], best[1])) best = [f1, f2, best[2], best[3]];
    best[2] = Math.min(best[2], g1); best[3] = Math.min(best[3], g2);
    t.diagnostic(`Classic bass's first quanta ≤ ${f1.toFixed(3)} ms / steady ${m1.toFixed(3)} (× ${(f1 / m1).toFixed(2)}), m9x's patch ${f2.toFixed(3)} / ${m2.toFixed(3)} (× ${(f2 / m2).toFixed(2)}); graph() ${g1.toFixed(3)} / ${g2.toFixed(3)} ms`);
  }
  assert.ok(best[0] <= DL && best[1] <= DL, `first quanta ${best.slice(0, 2).map(y => y.toFixed(3)).join(' / ')} ms > ${DL.toFixed(3)}`);
  assert.ok(best[2] <= 0.5 && best[3] <= 0.5, `graph() ${best.slice(2).map(y => y.toFixed(3)).join(' / ')} ms`);
});

// IMPL-9 §12 lane E9 "what stays cold" → the scripts' own cold start (the fixer fjit). In a warmed scope (a fresh isolate: the first
// live Track warmed it) a NEW Track's patch — Classic bass's payload, its first note, then m9x's patch arriving mid-note — runs
// patch-dsp.js and moog-dsp.js with no deopt at all (V8's --trace-deopt-verbose, the child's phase markers between the warm-up and
// the end; before the fix 14: "wrong map" in the classes' run / ctl / render / loopRun / feedRun — fields that start a small integer
// and later take a double, a constant field first changed by the new Track's first ctl —, "lost precision", comparisons and branches
// the warm-up never reached), and its first quantum costs ≤ 4 × (the payload's; was 6.0–6.6, now 2.7) / 1.8 × (the first note's; was
// 2.1–2.2, now 1.3) / 2.5 × (m9x arriving; was 4.7–5.1, now 1.4) the steady state — what is left of the payload's quantum (≈ 2.7 ×)
// is the engine's (a CPU profile of the first three quanta): its fade-in (ptRamp), outStage, renderPatch and renderSpan are still
// interpreted at the end of the warm-up. A deopt anywhere else in the window is only reported. Timings: the best of up to 5 scopes;
// the trace: a clean one of up to 3.
test('9 warm-up (the scripts\' own): a new patch Track\'s first quanta run no deopt in patch-dsp.js / moog-dsp.js and cost ≤ 4 × / 1.8 × / 2.5 × the steady state (warmed scope, fresh isolates)', async (t) => {
  const { spawnSync } = await import('node:child_process');
  const here = new URL('./', import.meta.url).href, V = '?v=9', R = [4, 1.8, 2.5];
  const child = scopes => `
    import '${here}v8-guard.mjs';
    import { dspScope } from '${here}dsp-scope.mjs';
    import * as core from '${here}../serum-core.js${V}';
    import { patchFor } from '${here}../models.js${V}';
    import * as MG from '${here}../moog-core.js${V}';
    import * as PT from '${here}../patch-core.js${V}';
    import { m9xPatch } from '${here}bench-scenarios.mjs';
    const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} }, out = [];
    const m = MG.model15(), x = m9xPatch(), P1 = PT.payload(m.rec), P2 = PT.payload(x.rec);
    const patch = v => patchFor('m900', v, core.defaultFx2(), { sr: 48000, bpm: 120 });
    for (let k = 0; k < ${scopes}; k++) {
      const D = dspScope({ engine: true, fast: true, console: quiet });
      new D.Proc({ processorOptions: { os: 4, hostOS: 4 } }); // (the first live Track of the scope: the warm-up)
      console.log('### warmed');
      const p = new D.Proc({ processorOptions: { os: 4, hostOS: 4 } });
      const o = [[new Float32Array(128), new Float32Array(128)]], q = () => { const t0 = performance.now(); p.process([], o); D.ctx.currentFrame += 128; return performance.now() - t0; };
      const steady = n => { const a = []; for (let j = 0; j < n; j++) a.push(q()); return a.slice(n >> 2).sort((y, z) => y - z)[(n - (n >> 2)) >> 1]; };
      p.msg({ t: 'patch', p: patch(m.vals) }); p.msg({ t: 'seq', s: P1 });
      const f0 = q(), s0 = steady(200);
      p.msg({ t: 'on', n: 36, v: 0.8 });
      const f1 = q(), m1 = steady(300);
      p.msg({ t: 'patch', p: patch(x.vals) }); p.msg({ t: 'seq', s: P2 }); p.msg({ t: 'on', n: 43, v: 0.7 });
      const f2 = q(), m2 = steady(300);
      console.log('### end');
      out.push([f0, s0, f1, m1, f2, m2]);
      if (f0 / s0 <= ${R[0]} && f1 / m1 <= ${R[1]} && f2 / m2 <= ${R[2]}) break;
    }
    console.log(JSON.stringify(out));`;
  const spawn = (code, flags = []) => spawnSync(process.execPath, ['--max-old-space-size=2048', ...flags, '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 120000, maxBuffer: 1 << 28 });
  // the timings
  const r = spawn(child(5));
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout.trim().split('\n').pop());
  let best = [Infinity, Infinity, Infinity];
  for (const [f0, s0, f1, m1, f2, m2] of got) {
    best = [Math.min(best[0], f0 / s0), Math.min(best[1], f1 / m1), Math.min(best[2], f2 / m2)];
    t.diagnostic(`payload's first quantum ${f0.toFixed(3)} ms / steady ${s0.toFixed(3)} (× ${(f0 / s0).toFixed(2)}), first note ${f1.toFixed(3)} / ${m1.toFixed(3)} (× ${(f1 / m1).toFixed(2)}), m9x arriving ${f2.toFixed(3)} / ${m2.toFixed(3)} (× ${(f2 / m2).toFixed(2)})`);
  }
  // the deopts: --trace-deopt-verbose names each bailout and the source position it left from; the window = after the warm-up
  const scan = text => {
    const mine = [], other = new Map();
    let on = false, cur = null;
    for (const l of text.split('\n')) {
      if (l === '### warmed') { on = true; continue; }
      if (l === '### end') break;
      if (!on) continue;
      let q = /^\[bailout \(kind: [a-z-]+, reason: ([^)]*)\)/.exec(l);
      if (q) { cur = q[1]; continue; }
      q = /;;; deoptimize at <([^>:]+):(\d+):(\d+)>/.exec(l);
      if (q && cur !== null) {
        if (/^(moog|patch)-dsp\.js$/.test(q[1])) mine.push(`${q[1]}:${q[2]}:${q[3]} ${cur}`);
        else { const k = q[1].replace(/.*\//, '').replace(/\?v=\d+/, '') + ' ' + cur; other.set(k, 1 + (other.get(k) || 0)); }
        cur = null;
      }
    }
    return { mine, other };
  };
  let clean = null;
  for (let k = 0; k < 3 && !(clean && clean.mine.length === 0); k++) {
    const d = spawn(child(1), ['--trace-deopt-verbose']);
    assert.equal(d.status, 0, d.stderr);
    const s = scan(d.stdout);
    if (!clean || s.mine.length < clean.mine.length) clean = s;
  }
  t.diagnostic(`deopts after the warm-up: ${clean.mine.length} in patch-dsp.js / moog-dsp.js${clean.mine.length ? ' (' + clean.mine.join('; ') + ')' : ''}; elsewhere: ${[...clean.other].map(([k, n]) => k + (n > 1 ? ' ×' + n : '')).join('; ') || 'none'}`);
  assert.deepEqual(clean.mine, [], 'a deopt in patch-dsp.js / moog-dsp.js in the new Track\'s first quanta (file:line:column reason)');
  assert.ok(best[0] <= R[0] && best[1] <= R[1] && best[2] <= R[2], `first quantum × ${best.map(y => y.toFixed(2)).join(' / ')} of steady state, gates ${R.join(' / ')}`);
});

/* ------------------------------------------------------------------ stage 9b: events, lamps, the Song clock's transport (IMPL-9b §3.1, §8.3, lane E9b) */
// A 960 alone: ROW A's first jack on MAIN OUT (the 960 live), its clock stopped at start (os 0) so a stage holds until an event
// moves it; the dials 1 … 8 on row A. lamps(F).l = [n, bits]: bit k = stage k + 1, bit 9 the clock (the flip-flop).
const SEQ960 = (() => {
  const x = PT.addModule(PT.fresh('moog'), {}, '960'), rec = PT.plug(x.rec, x.mid + '.ra1', 'c.out').rec;
  let vals = PT.setKnob({}, rec, x.mid, 'os', 0);
  for (let k = 1; k <= 8; k++) vals = PT.setKnob(vals, rec, x.mid, 'a' + k, k);
  return { rec, vals, n: +x.mid.slice(1), pay: PT.payload(rec) };
})();
const EV960 = id => MG.TYPES['960'].ev.findIndex(e => e.id === id);
test('9b events (§1.5, §3.1): {t: seq, s: {pe: [n, k]}} reaches the machine — the module applies it at its next chunk (SET 3, SHIFT, OSC ON); one for a module gone, an index past its list or a malformed one is dropped; on a classic Inst it is dropped (never the TB-303\'s payload, never pmPend)', () => {
  const D = p9Scope(), { p } = mk(D, { os: 4, hostOS: 4, offline: true }, ptPatch(SEQ960.vals)), I = p.i0, n = SEQ960.n;
  p.msg({ t: 'seq', s: SEQ960.pay });
  const lamp = () => { const L = I.pm.lamps(0).l; assert.equal(L.length, 2); assert.equal(L[0], n); return L[1]; }, ev = k => p.msg({ t: 'seq', s: { pe: [n, k] } });
  play(D, p, 4);
  assert.equal(lamp(), 1, 'fresh: stage 1, the clock stopped (CLOCK AT START: Stopped)');
  ev(EV960('e3')); assert.equal(lamp(), 1, 'held until the next chunk');
  play(D, p, 1); assert.equal(lamp(), 1 << 2, 'SET 3: stage 3');
  ev(EV960('sh')); play(D, p, 1); assert.equal(lamp(), 1 << 3, 'SHIFT: stage 4');
  assert.ok(peakOf(play(D, p, 2).L) > 0, 'row A sounds');
  ev(99); p.msg({ t: 'seq', s: { pe: [n + 7, 0] } }); p.msg({ t: 'seq', s: { pe: 'x' } }); play(D, p, 1);
  assert.equal(lamp(), 1 << 3, 'an index past its list, a module gone, a malformed event: dropped');
  ev(EV960('on')); play(D, p, 1); assert.equal(lamp() >> 9, 1, 'OSC ON: the clock runs');
  assert.deepEqual([I.pmPend, I.pmErr], [null, 0]);
  // a classic Inst running the TB-303's sequencer: an event changes nothing there
  const { p: q } = mk(D, { os: 2, hostOS: 4, offline: true }, classic('tb303')), J = q.i0;
  q.msg({ t: 'seq', s: Object.assign({}, SEQ) });
  run(D, q, 4);
  const sq = J.sq, pos = sq && sq.pos;
  q.msg({ t: 'seq', s: { pe: [1, 0] } });
  assert.ok(sq !== null && J.sq === sq && sq.run === true && sq.pos === pos && J.pmPend === null && J.pm === null, 'the TB-303 sequencer untouched, nothing waits');
});

test('9b lamps (§1.6, §3.1): a graph node\'s patch Inst whose machine holds a lamp module posts pt: {F, l} beside its smon (F the frame of the post); a patch without lamps and a classic Inst post today\'s message', () => {
  const D = p9Scope(), { p, sent } = gnode(D, graph(['i1', 'i2', 'i3'], ['fx1'], [['i1', 'fx1', 1], ['i2', 'fx1', 1], ['i3', 'fx1', 1], ['fx1', 'out', 1]]),
    { i1: ptPatch(SEQ960.vals), i2: ptPatch(SINEP.vals), i3: classic('juno60') }, { fx1: fxOf() });
  p.msg({ t: 'seq', i: 'i1', s: SEQ960.pay }); p.msg({ t: 'seq', i: 'i2', s: SINEPAY });
  p.msg({ t: 'mon', ids: ['i1', 'i2', 'i3'] });
  const at = new Map(), pm = p.port.postMessage;
  p.port.postMessage = m => { at.set(m, p.frames); pm(m); };
  sent.length = 0; run(D, p, 60);
  p.msg({ t: 'seq', i: 'i1', s: { pe: [SEQ960.n, EV960('e5')] } });
  run(D, p, 60);
  const of = id => sent.filter(m => m.t === 'smon' && m.i === id);
  assert.ok(of('i1').length >= 4 && of('i1').every(m => m.pt && Array.isArray(m.pt.l) && m.pt.l.length === 2 && m.pt.l[0] === SEQ960.n && Number.isFinite(m.pt.F)), 'the 960\'s lamps');
  assert.ok(of('i1').every(m => m.pt.F === at.get(m)), 'F: the frame of each post');
  assert.equal(of('i1').at(-1).pt.l[1], 1 << 4, 'SET 5 lit stage 5');
  assert.equal(of('i1')[0].pt.l[1], 1, 'stage 1 before it');
  for (const id of ['i2', 'i3']) assert.ok(of(id).length >= 4 && of(id).every(m => !('pt' in m)), id + ': no pt');
});

// IMPL-9b §3.4 (D7; skeptic #2–#4, P-2 (b)): the Song clock reads the Track's transport (inst.tp) per absolute chunk — through the
// whole Track, Sequence's 960 (CLOCK → SHIFT, RESTART → IN 1, LENGTH 8) steps on the song's sixteenths from stage 1: nothing while
// stopped or during a count-in (t < 0: RUN dark, stage 1), stage 1 at tick 0 with an anchor off the 4-frame grid, a tempo change's
// late re-anchor no restart (the stage goes on), a seek a restart (stage 1 at the seek), a loop wrap a restart, every 8 steps a
// restart from tick 0. The 960's stage and the RUN lamp read at each quantum's end, away from the edges (±12 ticks)
test('9b the Song clock through the Track (§3.4): Sequence steps on the song\'s sixteenths — silent stopped and in a count-in, stage 1 at tick 0 off the grid, no restart at a tempo change, one at a seek and at a loop wrap, every 8 steps', () => {
  const D = p9Scope(), r = PT.loadPreset(PT.fresh('moog'), {}, 'Sequence'), num = t => +Object.keys(r.rec.mods).find(k => r.rec.mods[k].t === t).slice(1);
  const n960 = num('960'), nck = num('clk'), STEP = 240;
  const go = (tps) => {
    D.ctx.currentFrame = 0;
    const { p } = mk(D, { os: 4, hostOS: 4, offline: true }, ptPatch(r.vals)), I = p.i0;
    p.msg({ t: 'seq', s: PT.payload(r.rec, 'moog', r.vals) });
    const lamp = n => { const L = I.pm.lamps(0).l; return L[L.indexOf(n) + 1]; }, stage = () => 32 - Math.clz32(lamp(n960) & 511);
    const out = [];
    for (let k = 0; k < tps.length; k++) {
      const [q, m] = tps[k];
      while (D.ctx.currentFrame < q * 128) { p.process([], out.o || (out.o = [[new Float32Array(128), new Float32Array(128)]])); D.ctx.currentFrame += 128; out.push([D.ctx.currentFrame, stage(), lamp(nck) & 1]); }
      if (m) p.msg(m);
    }
    return out;
  };
  // the expected stage at tick t: 1 + the CLOCK rises since the last restart (the start / seek / wrap tick r, or a LENGTH step)
  const want = (t, r0) => { const r = Math.max(r0, Math.floor(t / (8 * STEP)) * 8 * STEP); return 1 + Math.floor(t / STEP) - Math.floor(r / STEP); };
  const near = t => { const x = ((t % STEP) + STEP) % STEP; return x < 12 || x > STEP - 12; };
  // seg(F) → [the tick at frame F, the tick of the last start / seek / wrap] or null (not playing); quanta near a change skipped
  const check = (rows, seg, what) => {
    let n = 0;
    for (const [F, st, run] of rows) {
      const s = seg(F - 1);
      if (s === null || near(s[0])) continue;
      const w = s[0] < 0 ? 1 : want(s[0], s[1]);
      assert.deepEqual([st, run], [w, s[0] < 0 ? 0 : 1], `${what}: frame ${F}, tick ${s[0].toFixed(1)}`);
      n++;
    }
    assert.ok(n > 20, what + ': checked ' + n);
    return n;
  };
  // stopped, then ▶ from a stop with a one-beat count-in, its anchor 3 frames off the grid; fpt 6.25 (480 BPM: a sixteenth 1 500 frames)
  const A0 = 40 * 128 + 3, f0 = 6.25, T1 = 300 * 128 + 1, t1 = -960 + (T1 - A0) / f0, f1 = 5, S = 520 * 128 + 2;
  const rows = go([[40, { t: 'transport', play: true, frame: A0, tick: -960, fpt: f0, seek: true, fresh: true }],
    [300, { t: 'transport', play: true, frame: T1, tick: t1, fpt: f1, seek: false }],   // a tempo change (main.js reanchor: the tick at its frame)
    [520, { t: 'transport', play: true, frame: S, tick: 1300, fpt: f1, seek: true, fresh: true }], [700, null]]);
  assert.ok(rows.slice(0, 40).every(([, st, run]) => st === 1 && run === 0), 'stopped: stage 1, RUN dark');
  // restarts: tick 0 (the count-in's end) and the seek at 1300 — the tempo change is none (its stage goes on)
  const seg = F => (F < A0 + 4 ? null : F < T1 ? [-960 + (F - A0) / f0, 0] : F < S ? [t1 + (F - T1) / f1, 0] : [1300 + (F - S) / f1, 1300]);
  check(rows, seg, 'a count-in, ▶ off the grid, a tempo change, a seek');
  assert.ok(rows.some(([F]) => { const s = seg(F - 1); return s && s[0] < 0; }) && rows.some(([F]) => F > T1 && F < S) && rows.some(([F]) => F > S + 2000), 'every segment sampled');
  // a loop of six sixteenths from tick 0: a restart at each wrap (without it the 960 would go on to stage 7)
  const L0 = 20 * 128 + 1, le = 6 * STEP;
  const rows2 = go([[20, { t: 'transport', play: true, frame: L0, tick: 0, fpt: f0, seek: true, fresh: true, loop: true, ls: 0, le }], [400, null]]);
  check(rows2, F => (F < L0 + 4 ? null : [((F - L0) / f0) % le, 0]), 'a loop of six steps');
  assert.ok(rows2.some(([F, st]) => (F - L0) / f0 > le + 300 && st === 2), 'after a wrap: stage 2 again, not 8');
});

// IMPL-9b P-2 × P-3 (the user's decision; review 1 F1): Play from a stop restarts the patch fresh (P-2) but the keys the Track still
// holds carry through — hold a key, press ▶: Sequence plays transposed from its first step (the 902 that gates the keyboard pitch,
// P-3 (b), needs the controller's gate). Restruck after the reset from the Track's own record (the receivers and the pitch stored at
// the press), as P-1's power-on does; a bounce has no held keys (D7), a powered-off patch gets its keys at its power-on, once.
const SQ = (() => {
  const r = PT.loadPreset(PT.fresh('moog'), {}, 'Sequence'), n960 = +Object.keys(r.rec.mods).find(k => r.rec.mods[k].t === '960').slice(1);
  return { rec: r.rec, vals: r.vals, pay: PT.payload(r.rec, 'moog', r.vals), n960 };
})();
const SQ_T0 = 40 * 128, SQ_PLAY = { t: 'transport', play: true, frame: SQ_T0, tick: 0, fpt: 25, seek: true, fresh: true }; // (a step: 240 ticks = 6 000 frames)
const lampOf = (x, n) => { const L = x.pm.lamps(0).l; return L[L.indexOf(n) + 1]; };
// the heard period (frames) of L over [a, b) by autocorrelation, lags 40 … 1 200
function periodOf(L, a, b) {
  let best = 0, bl = 0;
  for (let lag = 40; lag < 1200; lag++) {
    let s = 0, e0 = 0, e1 = 0;
    for (let i = a; i < b - lag; i++) { s += L[i] * L[i + lag]; e0 += L[i] * L[i]; e1 += L[i + lag] * L[i + lag]; }
    const c = s / Math.sqrt(e0 * e1 + 1e-30);
    if (c > best) { best = c; bl = lag; }
  }
  return bl;
}
// quanta with events [[quantum, message | function → a value for the log]] → { L (the output), log }
function held9(D, p, quanta, ev) {
  const o = out(), L = new Float64Array(quanta * 128), log = [];
  for (let k = 0; k < quanta; k++) {
    for (const [q, m] of ev) if (q === k) { if (typeof m === 'function') log.push(m()); else p.msg(m); }
    p.process([], o); D.ctx.currentFrame += 128; L.set(o[0][0], k * 128);
  }
  return { L, log };
}
// a spy on the controller: every note-on / -off it hears (the reset spy's sibling)
const noteSpy = C => { const f = C.note, c = { on: 0, off: 0 }; C.note = function (n, v, on) { if (on) c.on++; else c.off++; return f.call(this, n, v, on); }; return c; };

test('9b P-2 × P-3 (review 1 F1, the user\'s decision): a key held before ▶, or pressed in the anchor\'s quantum, carries through Play from a stop — the riff transposed from its first step; everything else still restarts (one machine reset, stage 1, the Song clock fresh); a release returns it to the written pitch', (t) => {
  const D = p9Scope(), n960 = SQ.n960, on72 = { t: 'on', n: 72, v: 0.8 }, off72 = { t: 'off', n: 72 };
  const go = (ev, quanta = 150) => {
    D.ctx.currentFrame = 0;
    const { p } = mk(D, NODE, ptPatch(SQ.vals, { drift: 0 })), I = p.i0;
    p.msg({ t: 'seq', s: SQ.pay });
    const R = resetSpy(ctlOf(I)), M = resetSpy(I.pm), N = noteSpy(ctlOf(I));
    const snap = () => { const C = ctlOf(I); return [C.held[72], C.nh, +C.tgt.toFixed(3), C.gon, lampOf(I, n960)]; };
    const r = held9(D, p, quanta, ev.map(([q, m]) => [q, m === 'snap' ? snap : m]));
    return Object.assign(r, { R: R.n, M: M.n, N });
  };
  const SN = 'snap', W1 = [SQ_T0 + 1000, SQ_T0 + 5000], W2 = [SQ_T0 + 7000, SQ_T0 + 11000]; // (windows inside stage 1 and stage 2)
  const none = go([[40, SQ_PLAY], [44, SN], [60, SN], [90, SN]]);
  const early = go([[10, on72], [20, SN], [40, SQ_PLAY], [44, SN], [60, SN], [90, SN]]);
  const inQ = go([[40, SQ_PLAY], [40, on72], [44, SN], [60, SN], [90, SN]]);
  const ahead = go([[18, SQ_PLAY], [30, on72], [44, SN], [60, SN], [90, SN]]); // (Play posts its anchor ahead: the key lands between the message and the anchor)
  const late = go([[40, SQ_PLAY], [41, on72], [44, SN], [60, SN], [90, SN]]);
  const p0 = periodOf(none.L, W1[0], W1[1]);
  assert.deepEqual(none.log[0].slice(0, 4), [0, 0, 0, 0], 'no key: the controller after ▶ holds nothing');
  assert.ok(p0 > 300 && p0 < 440, 'as written: ' + p0 + ' frames');
  assert.deepEqual([none.R, none.M, none.N.on], [1, 1, 0], 'no key: one reset of the machine and of its controller, no note struck (the bounce\'s case: D7)');
  const rep = [`as written ${p0}`];
  for (const [what, r] of [['held before ▶', early], ['pressed in the anchor\'s quantum', inQ], ['posted between ▶ and its anchor', ahead]]) {
    const L = r.log;
    assert.deepEqual(L[L.length - 3].slice(0, 4), [1, 1, 1, 1], what + ': the controller holds the key, its pitch 1 V, the gate open');
    const p1 = periodOf(r.L, W1[0], W1[1]);
    rep.push(`${what} ${p1}`);
    assert.ok(Math.abs(2 * p1 - p0) <= 2, `${what}: stage 1 an octave up — ${p1} frames, as written ${p0}`);
    assert.deepEqual([r.R, r.M], [1, 1], what + ': P-2 still resets once — the machine and its controller');
    // everything else restarted exactly as with no key: the 960's lamps (stage 1 through the first step, its flip-flop, stage 2 after it)
    assert.deepEqual(L.slice(-3).map(x => x[4]), none.log.slice(-3).map(x => x[4]), what + ': the 960\'s stage and clock as a restart with no key');
    assert.equal(L[L.length - 3][4] & 511, 1, what + ': stage 1 a few chunks after tick 0 (the RESTART)');
    assert.equal(L[L.length - 1][4] & 511, 2, what + ': stage 2 after the first step');
  }
  assert.equal(early.N.on, 2, 'the press and one restrike — struck once at Play');
  // a key pressed after the anchor is an ordinary note-on (it worked before, too): nothing restruck
  assert.ok(Math.abs(2 * periodOf(late.L, W1[0], W1[1]) - p0) <= 2 && late.R === 1 && late.N.on === 1, 'pressed after the anchor: transposed, nothing restruck');
  // the release after ▶: the controller lets go, and the riff is back at its written pitch from the next step
  const rel = go([[10, on72], [40, SQ_PLAY], [60, off72], [64, SN]]);
  assert.deepEqual(rel.log[0].slice(0, 2), [0, 0], 'released: nothing held');
  assert.ok(Math.abs(periodOf(rel.L, W2[0], W2[1]) - periodOf(none.L, W2[0], W2[1])) <= 1, 'stage 2 at its written pitch after the release');
  t.diagnostic(rep.join(' · '));
});

test('9b P-2 × P-3 (review 1 F1): on a graph node the restrike takes the receivers and the pitch the press recorded — a zone\'s transposition, a key the zone refused never struck; a powered-off patch gets its keys at its power-on, once', () => {
  const D = p9Scope(), Z1 = { lo: 40, hi: 80, xp: 12 }, ALL = { lo: 0, hi: 127, xp: 0 };
  const G = zone => graph([gi('i1', { zone })], ['fx1'], [['i1', 'fx1', 1], ['fx1', 'out', 1]]);
  const mkNode = zone => { D.ctx.currentFrame = 0; const { p } = gnode(D, G(zone), { i1: ptPatch(SQ.vals, { drift: 0 }) }, { fx1: fxOf() }); p.msg({ t: 'seq', i: 'i1', s: SQ.pay }); return p; };
  const keys = C => [48, 60, 90, 102].map(n => C.held[n]).concat([C.nh]);
  const q = (p, n) => held9(D, p, n, []), play4 = p => p.msg(Object.assign({}, SQ_PLAY, { frame: D.ctx.currentFrame + 4 * 128 }));
  // the zone: 48 → 60 struck at the press, 90 outside it never; the zone changes (the key stays as struck); ▶ from a stop
  let p = mkNode(Z1), x = p.insts[0], C = ctlOf(x), N = noteSpy(C), R = resetSpy(C);
  p.msg({ t: 'on', n: 48, v: 0.8 }); p.msg({ t: 'on', n: 90, v: 0.8 }); q(p, 4);
  assert.deepEqual(keys(C), [0, 1, 0, 0, 1], 'at the press: 48 → 60; 90 outside the zone: never');
  p.msg(G(ALL)); q(p, 2);
  assert.deepEqual(keys(C), [0, 1, 0, 0, 1], 'a zone change moves no held key');
  play4(p); q(p, 8);
  assert.equal(R.n, 1, 'P-2: one reset');
  assert.deepEqual(keys(C), [0, 1, 0, 0, 1], 'Play from a stop: restruck at the pitch the press stored (60); nothing at 48, 90 or 102');
  assert.equal(N.on, 2, 'the press and one restrike — the refused key never struck');
  p.msg({ t: 'off', n: 48 }); q(p, 2);
  assert.deepEqual(keys(C), [0, 0, 0, 0, 0], 'the note-off reaches the key it struck');
  // powered off at the press: no note through Play; the power-on strikes it once
  p = mkNode(ALL); x = p.insts[0]; C = ctlOf(x); N = noteSpy(C);
  p.msg({ t: 'power', i: 'i1', on: false }); q(p, 4);
  p.msg({ t: 'on', n: 48, v: 0.8 }); play4(p); q(p, 8);
  assert.deepEqual([N.on, C.nh], [0, 0], 'powered off: no note reaches the controller, at the press or through Play');
  p.msg({ t: 'power', i: 'i1', on: true }); q(p, 2);
  assert.deepEqual([N.on, C.held[48], C.nh], [1, 1, 1], 'powered on: restruck once');
  // held, then powered off (its keys forgotten), ▶ while off, on again
  p = mkNode(ALL); x = p.insts[0]; C = ctlOf(x); N = noteSpy(C);
  p.msg({ t: 'on', n: 48, v: 0.8 }); q(p, 4);
  p.msg({ t: 'power', i: 'i1', on: false }); q(p, 4);
  const n0 = N.on;
  play4(p); q(p, 8);
  assert.deepEqual([N.on - n0, C.nh], [0, 0], 'held, powered off, ▶: nothing struck while it is off');
  p.msg({ t: 'power', i: 'i1', on: true }); q(p, 2);
  assert.deepEqual([N.on - n0, C.held[48], C.nh], [1, 1, 1], 'powered on: restruck once, not twice');
});

// review 1 F2: a momentary event is live only — sent to a powered-off patch (a muted / soloed-out / ⏻ track, nothing renders) or
// to a module outside the live plan (its outputs reach nothing: no ctl runs) it is dropped, never kept in the module's ring to
// fire at the unmute or when a cord makes the module live. P-1: an unmuted sequence restarts at stage 1
test('9b events (review 1 F2): an event sent while the patch is powered off, or to a module that is not live, is dropped — the unmute starts at stage 1, a cord making the 960 live moves nothing', () => {
  const D = p9Scope(), n = SQ.n960;
  D.ctx.currentFrame = 0;
  const { p } = gnode(D, G1(), { i1: ptPatch(SQ.vals, { drift: 0 }) }, { fx1: fxOf() }), x = p.insts[0];
  p.msg({ t: 'seq', i: 'i1', s: SQ.pay });
  const stage = () => 32 - Math.clz32(lampOf(x, n) & 511), SET = k => p.msg({ t: 'seq', i: 'i1', s: { pe: [n, EV960('e' + k)] } });
  const go = k => held9(D, p, k, []);
  go(10); assert.equal(stage(), 1, 'fresh: stage 1');
  SET(3); go(2); assert.equal(stage(), 3, 'SET 3 while on: stage 3');
  p.msg({ t: 'power', i: 'i1', on: false }); go(4);
  assert.equal(stage(), 1, 'powered off: the reset');
  SET(6); go(10);
  p.msg({ t: 'power', i: 'i1', on: true }); go(4);
  assert.equal(stage(), 1, 'powered on: stage 1 — the SET 6 sent while it was off is gone');
  SET(2); go(2); assert.equal(stage(), 2, 'and an event sent while it is on works');
  // the 960 not live (its row and stage outputs unpatched: it reaches nothing, no ctl runs), two SETs sent, the cords back
  const sq = 'm' + n, cut = SQ.rec.cords.filter(c => c.a.startsWith(sq + '.') && /\.(ra|rb|rc|o)\d/.test(c.a));
  assert.equal(cut.length, 3, 'the 960\'s rows A and B are patched in Sequence');
  let r2 = SQ.rec; for (const c of cut) r2 = PT.pull(r2, c.id).rec;
  p.msg({ t: 'seq', i: 'i1', s: PT.payload(r2, 'moog', SQ.vals) }); go(4);
  assert.ok(!x.pm.lamps(0).l.includes(n), 'its lamps are not posted while it is not live');
  SET(4); SET(7); go(10);
  p.msg({ t: 'seq', i: 'i1', s: SQ.pay }); go(4);
  assert.equal(stage(), 2, 'a cord makes it live: still stage 2 — the stale SETs are not applied');
  SET(5); go(2); assert.equal(stage(), 5, 'live again: an event works');
});

// IMPL-9b §8.3 (I9's gate extended; spike (a2) decision 1, §3.8): in a warmed scope (a fresh isolate: the first live Track warmed
// it) a new Track takes the System 55 tile — Sequence on the 37-module set: its graph() (every module built: a Replace's one-off,
// reported), its first quanta, then ▶ from a stop (the patch reset) — each quantum within a quarter of the deadline; then m9s's
// patch and 40 flips of a 993 routing switch (a bus row in and out of the payload, 4 quanta apart): graph() median ≤ 0.5 ms, none
// over 1 ms (the first eden-sized collection lands in the warm-up), the flip's quantum within a quarter of the deadline. Best of 3
test('9b warm-up at System 55 scale: the System 55 tile on a new Track — its first quanta and ▶\'s ≤ a quarter of the deadline; 40 bus-switch flips: graph() median ≤ 0.5 ms, max ≤ 1 ms (warmed scope, fresh isolate)', async (t) => {
  const { spawnSync } = await import('node:child_process');
  const here = new URL('./', import.meta.url).href, V = '?v=9';
  const code = `
    import '${here}v8-guard.mjs';
    import { dspScope } from '${here}dsp-scope.mjs';
    import * as core from '${here}../serum-core.js${V}';
    import { patchFor } from '${here}../models.js${V}';
    import * as MG from '${here}../moog-core.js${V}';
    import * as PT from '${here}../patch-core.js${V}';
    import { m9sPatch } from '${here}bench-scenarios.mjs';
    const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} }, out = [], DL = 0.25 * 128 / 48;
    const s = MG.makeSet('s55', {}), P3 = PT.payload(s.rec, 'moog', s.vals), x = m9sPatch(), [tg] = Object.keys(x.rec.mods).filter(k => x.rec.mods[k].t === '993');
    const on = PT.payload(x.rec, 'moog', x.vals), off = PT.payload(x.rec, 'moog', PT.setKnob(x.vals, x.rec, tg, 'e3', 0));
    const patch = v => patchFor('m900', v, core.defaultFx2(), { sr: 48000, bpm: 120 }), now = () => performance.now();
    for (let k = 0; k < 3; k++) {
      const D = dspScope({ engine: true, fast: true, console: quiet });
      new D.Proc({ processorOptions: { os: 4, hostOS: 4 } }); // (the first live Track of the scope: the warm-up)
      const p = new D.Proc({ processorOptions: { os: 4, hostOS: 4 } });
      const o = [[new Float32Array(128), new Float32Array(128)]], q = () => { const t0 = now(); p.process([], o); D.ctx.currentFrame += 128; return now() - t0; };
      const steady = n => { const a = []; for (let j = 0; j < n; j++) a.push(q()); return a.slice(n >> 2).sort((y, z) => y - z)[(n - (n >> 2)) >> 1]; };
      p.msg({ t: 'patch', p: patch(s.vals) });
      let t0 = now(); p.msg({ t: 'seq', s: P3 }); const g = now() - t0;
      const f0 = Math.max(q(), q()), s0 = steady(200);
      p.msg({ t: 'transport', play: true, frame: D.ctx.currentFrame + 64, tick: 0, fpt: 25, seek: true, fresh: true });
      const f1 = Math.max(q(), q(), q()), s1 = steady(300);
      p.msg({ t: 'patch', p: patch(x.vals) }); p.msg({ t: 'seq', s: on }); p.msg({ t: 'on', n: 36, v: 0.8 });
      steady(100);
      const G = [], F = [];
      for (let j = 0; j < 40; j++) { for (let i = 0; i < 4; i++) q(); t0 = now(); p.msg({ t: 'seq', s: j & 1 ? on : off }); G.push(now() - t0); F.push(q()); }
      const srt = G.slice().sort((y, z) => y - z);
      out.push([g, f0, s0, f1, s1, srt[20], srt[39], Math.max(...F)]);
      if (Math.max(f0, f1, Math.max(...F)) <= DL && srt[20] <= 0.5 && srt[39] <= 1) break;
    }
    console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--max-old-space-size=2048', '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 180000 });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout.trim().split('\n').pop()), DL = 0.25 * 128 / 48;
  for (const [g, f0, s0, f1, s1, gm, gx, ff] of got) t.diagnostic(`the System 55 tile: graph() ${g.toFixed(3)} ms (37 built), first quanta ${f0.toFixed(3)} / steady ${s0.toFixed(3)}, ▶ ${f1.toFixed(3)} / ${s1.toFixed(3)}; flips: graph() median ${gm.toFixed(3)} max ${gx.toFixed(3)} ms, the flip's quantum ≤ ${ff.toFixed(3)} ms`);
  const ok = got.find(([, f0, , f1, , gm, gx, ff]) => Math.max(f0, f1, ff) <= DL && gm <= 0.5 && gx <= 1);
  assert.ok(ok, 'no scope within the gates (first quanta ≤ ' + DL.toFixed(3) + ' ms, graph() median ≤ 0.5, max ≤ 1 ms)');
});

// IMPL-9c §3 G4 (c) (review 1 F2: measured in scratch only until now): the same in a warmed scope for the System IIIc tile — its
// graph() (36 modules built, ≤ 1 ms), its first quanta, then a key (the starter is keyboard-played) — each quantum within a quarter
// of the deadline; then m9c's patch and 40 flips of CP3 1's KEYBOARD switch (a bus row to the 901As in and out of the payload, the
// payload re-posted with the values, 4 quanta apart): graph() median ≤ 0.5 ms, none over 1 ms, the flip's quantum within a quarter
// of the deadline. Best of 3
test('9c warm-up at System IIIc scale (G4 c): the System IIIc tile on a new Track — graph() ≤ 1 ms, its first quanta and the first key\'s ≤ a quarter of the deadline; 40 CP3 routing-switch flips: graph() median ≤ 0.5 ms, max ≤ 1 ms (warmed scope, fresh isolate)', async (t) => {
  const { spawnSync } = await import('node:child_process');
  const here = new URL('./', import.meta.url).href, V = '?v=9';
  const code = `
    import '${here}v8-guard.mjs';
    import { dspScope } from '${here}dsp-scope.mjs';
    import * as core from '${here}../serum-core.js${V}';
    import { patchFor } from '${here}../models.js${V}';
    import * as MG from '${here}../moog-core.js${V}';
    import * as PT from '${here}../patch-core.js${V}';
    import { m9cPatch } from '${here}bench-scenarios.mjs';
    const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} }, out = [], DL = 0.25 * 128 / 48;
    const s = MG.makeSet('s3c', {}), P3 = PT.payload(s.rec, 'moog', s.vals), x = m9cPatch(), [c1] = Object.keys(x.rec.mods).filter(k => x.rec.mods[k].t === 'cp3');
    const v1 = PT.setKnob(x.vals, x.rec, c1, 'r1', 1), v0 = PT.setKnob(x.vals, x.rec, c1, 'r1', 0);
    const on = PT.payload(x.rec, 'moog', v1), off = PT.payload(x.rec, 'moog', v0);
    if (JSON.stringify(on) === JSON.stringify(off)) throw new Error('the CP3 switch changed no payload');
    const patch = v => patchFor('m900', v, core.defaultFx2(), { sr: 48000, bpm: 120 }), now = () => performance.now();
    for (let k = 0; k < 3; k++) {
      const D = dspScope({ engine: true, fast: true, console: quiet });
      new D.Proc({ processorOptions: { os: 4, hostOS: 4 } }); // (the first live Track of the scope: the warm-up)
      const p = new D.Proc({ processorOptions: { os: 4, hostOS: 4 } });
      const o = [[new Float32Array(128), new Float32Array(128)]], q = () => { const t0 = now(); p.process([], o); D.ctx.currentFrame += 128; return now() - t0; };
      const steady = n => { const a = []; for (let j = 0; j < n; j++) a.push(q()); return a.slice(n >> 2).sort((y, z) => y - z)[(n - (n >> 2)) >> 1]; };
      p.msg({ t: 'patch', p: patch(s.vals) });
      let t0 = now(); p.msg({ t: 'seq', s: P3 }); const g = now() - t0;
      const f0 = Math.max(q(), q()), s0 = steady(200);
      p.msg({ t: 'on', n: 48, v: 0.8 });
      const f1 = Math.max(q(), q(), q()), s1 = steady(300);
      p.msg({ t: 'off', n: 48 });
      p.msg({ t: 'patch', p: patch(v0) }); p.msg({ t: 'seq', s: off }); p.msg({ t: 'on', n: 36, v: 0.8 });
      steady(100);
      const G = [], F = [];
      for (let j = 0; j < 40; j++) { for (let i = 0; i < 4; i++) q(); p.msg({ t: 'patch', p: patch(j & 1 ? v0 : v1) }); t0 = now(); p.msg({ t: 'seq', s: j & 1 ? off : on }); G.push(now() - t0); F.push(q()); }
      const srt = G.slice().sort((y, z) => y - z);
      out.push([g, f0, s0, f1, s1, srt[20], srt[39], Math.max(...F), Object.keys(s.rec.mods).length]);
      if (g <= 1 && Math.max(f0, f1, Math.max(...F)) <= DL && srt[20] <= 0.5 && srt[39] <= 1) break;
    }
    console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--max-old-space-size=2048', '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 180000 });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout.trim().split('\n').pop()), DL = 0.25 * 128 / 48;
  for (const [g, f0, s0, f1, s1, gm, gx, ff, n] of got) t.diagnostic(`the System IIIc tile: graph() ${g.toFixed(3)} ms (${n} modules), first quanta ${f0.toFixed(3)} / steady ${s0.toFixed(3)}, a key ${f1.toFixed(3)} / ${s1.toFixed(3)}; CP3 flips: graph() median ${gm.toFixed(3)} max ${gx.toFixed(3)} ms, the flip's quantum ≤ ${ff.toFixed(3)} ms`);
  const ok = got.find(([g, f0, , f1, , gm, gx, ff]) => g <= 1 && Math.max(f0, f1, ff) <= DL && gm <= 0.5 && gx <= 1);
  assert.ok(ok, 'no scope within the gates (graph() ≤ 1 ms, first quanta ≤ ' + DL.toFixed(3) + ' ms, flips: graph() median ≤ 0.5, max ≤ 1 ms)');
});

// IMPL-9b §8.3 / §12 spike (a2) decision 1: the scope's warm-up (the first live Track's) at most 1.25 × stage 9's — tests/ref-9's
// engine.js, patch-dsp.js and moog-dsp.js (the Model 15 family) against the current files, every other script current; each in a
// fresh process (the JIT's state is per isolate), alternating, the median ratio of 5 pairs (measured again once when above).
// IMPL-9c §13 (the user's answer to §10's extra, 2026-10-23: "Allow the longer start" — every type stays pre-warmed): 1.35
test('9b warm-up time: the scope\'s warm-up ≤ 1.35 × stage 9\'s (ref-9, alternating fresh processes)', async (t) => {
  const { spawnSync } = await import('node:child_process');
  const root = new URL('../', import.meta.url), here = new URL('./', import.meta.url).href;
  const child = side => `
    import '${here}v8-guard.mjs';
    import vm from 'node:vm';
    import { readFileSync } from 'node:fs';
    import { DSP_FILES } from '${here}dsp-scope.mjs';
    const R9 = ['patch-dsp.js', 'moog-dsp.js', 'engine.js'], src = f => readFileSync(new URL(${JSON.stringify(side)} === 'ref9' && R9.includes(f) ? 'tests/ref-9/' + f : f, ${JSON.stringify(root.href)}), 'utf8');
    const g = vm.createContext(vm.constants.DONT_CONTEXTIFY);
    let Proc = null;
    Object.assign(g, { console: { log() {}, info() {}, debug() {}, warn() {}, error() {} }, sampleRate: 48000, currentFrame: 0 });
    g.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {}, onmessage: null }; } };
    g.registerProcessor = (n, c) => { Proc = c; };
    for (const f of DSP_FILES) vm.runInContext(src(f), g, { filename: f });
    vm.runInContext(src('engine.js'), g, { filename: 'engine.js' });
    const t0 = performance.now(); new Proc({ processorOptions: { os: 4, hostOS: 4 } }); console.log(performance.now() - t0);`;
  const one = side => { const r = spawnSync(process.execPath, ['--max-old-space-size=2048', '--input-type=module', '-e', child(side)], { encoding: 'utf8', timeout: 60000 }); assert.equal(r.status, 0, r.stderr); return +r.stdout.trim(); };
  let best = null;
  for (let a = 0; a < 2 && !(best && best.ratio <= 1.35); a++) {
    const A = [], B = [], Q = [];
    for (let k = 0; k < 5; k++) { let x, y; if (k & 1) { y = one('cur'); x = one('ref9'); } else { x = one('ref9'); y = one('cur'); } A.push(x); B.push(y); Q.push(y / x); }
    const med = v => v.slice().sort((p, q) => p - q)[2], r = { a: med(A), b: med(B), ratio: med(Q) };
    t.diagnostic(`warm-up: stage 9 ${r.a.toFixed(0)} ms, now ${r.b.toFixed(0)} ms (× ${r.ratio.toFixed(3)})`);
    if (!best || r.ratio < best.ratio) best = r;
  }
  assert.ok(best.ratio <= 1.35, `warm-up × ${best.ratio.toFixed(3)} of stage 9's (cap 1.35)`);
});

// IMPL-9c G4 (b) (skeptic #3): the stage's own growth — the scope's warm-up at most 1.10 × stage 9b's (tests/ref-9b's engine.js,
// patch-dsp.js and moog-dsp.js: the 26-type family, every other script current), the same harness (alternating fresh processes, the
// median ratio of 5 pairs, measured again once when above); IMPL-9c §13 (the user's answer to §10's extra, 2026-10-23): 1.22 — the
// same bound as the 1.35 × stage 9 cap above (1.35 / 1.109, lane V's ref-9b over ref-9)
test('9c warm-up time: the scope\'s warm-up ≤ 1.22 × stage 9b\'s (ref-9b, alternating fresh processes)', async (t) => {
  const { spawnSync } = await import('node:child_process');
  const root = new URL('../', import.meta.url), here = new URL('./', import.meta.url).href;
  const child = side => `
    import '${here}v8-guard.mjs';
    import vm from 'node:vm';
    import { readFileSync } from 'node:fs';
    import { DSP_FILES } from '${here}dsp-scope.mjs';
    const R9 = ['patch-dsp.js', 'moog-dsp.js', 'engine.js'], src = f => readFileSync(new URL(${JSON.stringify(side)} === 'ref9b' && R9.includes(f) ? 'tests/ref-9b/' + f : f, ${JSON.stringify(root.href)}), 'utf8');
    const g = vm.createContext(vm.constants.DONT_CONTEXTIFY);
    let Proc = null;
    Object.assign(g, { console: { log() {}, info() {}, debug() {}, warn() {}, error() {} }, sampleRate: 48000, currentFrame: 0 });
    g.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {}, onmessage: null }; } };
    g.registerProcessor = (n, c) => { Proc = c; };
    for (const f of DSP_FILES) vm.runInContext(src(f), g, { filename: f });
    vm.runInContext(src('engine.js'), g, { filename: 'engine.js' });
    const t0 = performance.now(); new Proc({ processorOptions: { os: 4, hostOS: 4 } }); console.log(performance.now() - t0);`;
  const one = side => { const r = spawnSync(process.execPath, ['--max-old-space-size=2048', '--input-type=module', '-e', child(side)], { encoding: 'utf8', timeout: 60000 }); assert.equal(r.status, 0, r.stderr); return +r.stdout.trim(); };
  let best = null;
  for (let a = 0; a < 2 && !(best && best.ratio <= 1.22); a++) {
    const A = [], B = [], Q = [];
    for (let k = 0; k < 5; k++) { let x, y; if (k & 1) { y = one('cur'); x = one('ref9b'); } else { x = one('ref9b'); y = one('cur'); } A.push(x); B.push(y); Q.push(y / x); }
    const med = v => v.slice().sort((p, q) => p - q)[2], r = { a: med(A), b: med(B), ratio: med(Q) };
    t.diagnostic(`warm-up: stage 9b ${r.a.toFixed(0)} ms, now ${r.b.toFixed(0)} ms (× ${r.ratio.toFixed(3)})`);
    if (!best || r.ratio < best.ratio) best = r;
  }
  assert.ok(best.ratio <= 1.22, `warm-up × ${best.ratio.toFixed(3)} of stage 9b's (cap 1.22)`);
});
