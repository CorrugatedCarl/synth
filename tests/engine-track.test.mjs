// The Track / Inst / Chain engine (SPEC-canvas §6.2–6.4, §6.8, §10 1d): the structure every path builds, the
// compatibility facade (fields, methods, overrides through it), the hosts the voice code sees (only Inst objects), the
// stats per Inst / Chain, the monitor subscriptions by id ({t: 'mon', ids}), the idle skip per Inst and per Track, and
// the warm-up's restore. Bit-exactness against the pre-split engine: tests/golden-graph.test.mjs.
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dspScope } from './dsp-scope.mjs';
import * as core from '../serum-core.js?v=9';
import * as W from '../wt.js?v=9';
import { patchFor, MODELS } from '../models.js?v=9';
import * as CPU from './cpu-gate.mjs';

const SR = 48000;
const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
const tables = (p, patch) => { for (const id of patch.needs || []) if (/^(factory|noise):/.test(id)) p.msg(Object.assign({ t: 'wt' }, id.startsWith('noise:') ? W.makeNoise(id) : W.makeEntry(id, W.factoryTable(id)))); };
const classic = (id, fx) => { const m = MODELS.find(x => x.id === id); return patchFor(m, Object.fromEntries(m.controls.map(c => [c.id, c.def])), fx || core.defaultFx2(), { sr: SR, bpm: 120 }); };
const serum = (edit, fx) => { const s = core.defaultSerum(); if (edit) edit(s); return patchFor('serum', { s: core.normalizeSerum(s) }, fx || core.defaultFx2(), { sr: SR, bpm: 120, prefs: { smooth: 1, silenceTails: 1 } }); };
// a reverb on the track's rack (the FX scenarios' recipe)
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
