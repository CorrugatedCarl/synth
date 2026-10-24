import './v8-guard.mjs';
// Sidechain stage lane H (docs/canvas/IMPL-SC.md §1, §6.1, §7; §8 G5 / G6): the host in the page simulation with the real engine —
// every Track node one stereo input (live + offline, processorOptions unchanged), the key edges src.node → kg (a GainNode: 1 when a
// v3 compressor of the keyed track names the source, 0 when only Duckers do) → keyed.node, N.scIn, their sync from every FX path
// (sendPatch) and syncNodes, cycles and self-keys refused with a notice (no connect), a deleted keyed track's edges cut (its processor
// let go), a deleted / reused source id, the 900 Series' ghost-kick power rule, the bounce (the keying closure — muted sources at gain
// 0, transitively, with the power off, MIDI-OUT-driven and the master's Ducker's — the items' sc, renderOffline's edges), export =
// playback per node bit for bit (live from a quantum-aligned ▶ after silence ≡ the bounce), mAlign with a unit, scSources (the panels'
// host member) and the outbound presets' blank sources.
// Lane D (engine.js SCREG / the Ducker / the keyed compressor) lands in parallel: until it is merged a 'duck' or a cmp v3 instance passes
// its input (fx-dsp kindOf −1), so every equality here holds by the graph alone; the checks that need the DSP to act (the bass dips at
// the kick's hits — live, muted, bounced) are marked todo while engine.js has no SCREG and run for real once it does.
// Accessor-free like the other canvas sims (a guard build); one boot; strings, numbers and booleans only into assert (never a stub
// DOM node). Run alone: node --max-old-space-size=2048 --test tests/canvas-SC-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootMain } from './main-sim.mjs';
import { fakeStorage, fakeIDB } from './fakes.mjs';
import * as CMOD from '../cv-model.js?v=9';
import * as FC from '../fx-core.js?v=9';
import * as DC from '../drum-core.js?v=9';
import { MODELS } from '../models.js?v=9';

const LANE_D = /\bSCREG\b/.test(readFileSync(new URL('../engine.js', import.meta.url), 'utf8'));
const TODO_D = LANE_D ? false : 'lane D (engine.js SCREG, the Ducker / keyed compressor DSP) not merged in this tree';
const alive = setInterval(() => {}, 50); // (the sim's timers are unref'd: a ref'd one keeps the process up through the top-level setup)
const sim = await bootMain({ ls: fakeStorage({}), idb: fakeIDB(), clock: 'std' });
const api = sim.api, cv = globalThis.__synthTest.cv, SC = globalThis.__synthTest.sc, MS = globalThis.__synthTest.master;
await sim.power(); await sim.settle(20);
const P = () => api.project(), byId = id => P().tracks.find(t => t.id === id);
const settle = async (n = 3) => { for (let i = 0; i < n; i++) { sim.raf(); await sim.settle(3); } };
const model = id => MODELS.find(m => m.id === id);
const nodeOf = t => api.nodes.get(t.id);
const note = () => sim.$('#notice').textContent;
const outsTo = (src, dst) => [...src.outs].filter(g => g.kind === 'gain' && g.outs.has(dst)).length; // (key edges src → kg → dst)
const fxOf = t => api.fxHost(t).fx();
const mods = t => fxOf(t).racks[0].mods;
// a sidechain unit into a track's primary FX rack (a classic's panel / a Serum's own): a Ducker, or a keyed (v3) compressor —
// a new compressor is a v2 (`nv`) made v3 as the panels' from ▾ does (upgradeInstance, then sub.src and KEY EXT)
function addUnit(t, type, src, o = {}) {
  let id = null;
  api.fxHost(t).editFx(fx => {
    id = FC.newInstance(fx, type, { rack: 0 });
    const L = fx.racks[0].mods, i = L.findIndex(I => I.id === id);
    if (type === 'cmp') { const U = FC.upgradeInstance(L[i]); U.p.ext = 1; L[i] = U; }
    L[i].sub.src = src;
    if (o.on === 0) L[i].p.on = 0;
  });
  return id;
}
const setSrc = (t, id, src) => api.fxHost(t).editFx(fx => { const I = fx.racks[0].mods.find(x => x.id === id); I.sub.src = src; });
const drop = (t, id) => api.fxHost(t).editFx(fx => { FC.removeInstance(fx, id); });
const clearUnits = t => api.fxHost(t).editFx(fx => { for (const I of fx.racks[0].mods.slice()) if (I.type === 'duck' || I.type === 'cmp') FC.removeInstance(fx, I.id); });
const f32eq = (a, b) => { if (a.length !== b.length) return -2; for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return i; return -1; };
const peak = a => { let p = 0; for (const x of a) p = Math.max(p, Math.abs(x)); return p; };

// the scene: K a TR-808 playing its demo pattern (SYNC), B a Juno-60 bass, C a Minimoog lead — 1 bar at 120 bpm
// the scene: K a TR-808 playing its demo pattern (SYNC) with its bass drum alone (its other lanes' noise is free-running: a live
// node's differs from a fresh offline one's, with or without a sidechain), B a Minimoog bass, C a Minimoog lead; the analog drift
// off (the classic engines' drift and tolerance terms run from the node's birth — the same reason: measured, a Juno-60's hiss and
// a drifting Minimoog differ live vs bounce in the base build too) — 1 bar at 120 bpm
api.settings().drift = 0;
const K = P().tracks[0], kd = () => CMOD.primId(K);
api.selectTrack(K.id); api.setTrackModel(K, 'tr808'); await settle(4);
cv.drum.api(cv.view1e(kd())).demo(); await settle(2);
{
  const d = structuredClone(cv.drumOf(K, kd()));
  for (const pat of d.st) if (Array.isArray(pat)) for (let s = 0; s < pat.length; s++) pat[s] &= 3; // (AC and BD: the kick lane alone)
  K.dev[kd()].drum = DC.normDrum(d); cv.drum.changed(cv.view1e(kd())); cv.drumSend(K, kd()); await settle(2);
}
const B = api.addTrack(model('minimoog')); await settle(4);
const C = api.addTrack(model('minimoog')); await settle(4);
B.notes = [[0, 900, 36], [960, 400, 36], [1440, 400, 43], [1920, 900, 39], [2880, 900, 41]].map(([t, d, n], i) => ({ id: 'b' + i, t, d, n, v: 100 }));
C.notes = [[0, 1800, 60], [1920, 1800, 67]].map(([t, d, n], i) => ({ id: 'c' + i, t, d, n, v: 90 }));
const songs = () => { for (const t of P().tracks) api.postTo(t, Object.assign({ t: 'song' }, api.songData(t))); };
songs();
api.selectTrack(B.id); await settle(4);
P().loop.on = true; P().loop.start = 0; P().loop.end = 3840;
const BAR = 96000; // (1 bar at 120 bpm, 48 kHz)
clearInterval(alive);

test('§1.1 every Track node has one stereo input (MASTER\'s options), live; processorOptions gain no key', () => {
  for (const t of P().tracks) {
    const n = nodeOf(t).node;
    assert.deepEqual([n.name, n.nIn, n.channelCount, n.channelCountMode, n.channelInterpretation], ['synth-engine', 1, 2, 'explicit', 'speakers'], t.id);
    assert.deepEqual(Object.keys(n.po).filter(k => /sc|key|side/i.test(k)), [], t.id + ': no sidechain key in its options');
    assert.equal(nodeOf(t).scIn instanceof Map && nodeOf(t).scIn.size, 0, t.id + ': no edge without a unit');
    assert.equal(nodeOf(t).sc.kind, 'an', t.id + ': N.sc is still the OUT scope\'s analyser');
  }
  assert.equal(SC.any(), false, 'no sidechain unit');
  assert.equal(SC.mAlign(1000), 1000, 'mAlign moves nothing without a unit (and an empty master)');
});

// a live take from fresh nodes (a power cycle: a classic voice keeps its oscillator phases from note to note, so only a node that
// has played nothing renders as a fresh offline one — with or without a sidechain): half a second of silence, ▶ (an anchor on a
// quantum boundary while a unit exists), n frames from the anchor → each track's node output {L, R} over [anchor, anchor + n)
async function liveTake(n = BAR) {
  if (api.transport().playing) sim.$('#tPlay').onclick();
  sim.$('#power').onclick(); await sim.settle(5); await sim.power(); await settle(4);
  sim.run(24000); await settle(2);
  const c = sim.ctx(), f0 = c.frames;
  await sim.$('#tPlay').onclick();
  const F = api.transport().a.frame, out = sim.run(F - f0 + n);
  sim.$('#tPlay').onclick(); await settle(2);
  const take = { F };
  for (const t of P().tracks) { const o = out.get(nodeOf(t).node); take[t.id] = { L: o.L.slice(F - f0, F - f0 + n), R: o.R.slice(F - f0, F - f0 + n) }; }
  return take;
}
// a bounce through the page's dialog (the loop: bar 1; Same as playback; 32-bit float, no tail, no normalising), each node's own
// output recorded (sim.offOut) → { note, off (sim.lastOffline), [track id]: {L, R} of its node }
async function bounceTake() {
  const blobs = [], real = URL.createObjectURL;
  URL.createObjectURL = b => { blobs.push(b); return 'blob:sim/' + blobs.length; };
  try {
    sim.$('#fBounce').click();
    for (const [k, v] of [['#bRange', 'loop'], ['#bSr', '0'], ['#bBits', '32'], ['#bOs', '0'], ['#bTail', '0'], ['#bNorm', 'off']]) sim.$(k).value = v;
    sim.$('#bNorm').checked = false;
    sim.offOut = true; sim.lastOffline = null;
    await sim.$('#bGo').onclick();
    for (let i = 0; i < 40 && !sim.lastOffline; i++) await sim.settle(5);
    const off = sim.lastOffline, r = { note: sim.$('#bNote').textContent, off };
    if (off) for (const n of off.nodes) if (n.po && n.po.trackId) r[n.po.trackId] = off.out.get(n);
    return r;
  } finally { sim.offOut = false; URL.createObjectURL = real; sim.$('#bCancel').onclick(); }
}
const setOf = () => api.bounceSet(48000).map(x => [x.tr.id, x.gain, x.sc ? x.sc.map(e => e.join(':')).join() : '']);

test('§1.1 the key edges: a Ducker → src.node → kg (gain 0, order only) → node; a keyed compressor of the same source → gain 1; N.scIn; the keyed node after its source, its input [L, R]', async () => {
  const d = addUnit(B, 'duck', K.id); await settle(2);
  const NB = nodeOf(B), NK = nodeOf(K);
  assert.deepEqual(SC.edges(B), [[K.id, 0]], 'a Ducker alone: gain 0');
  assert.deepEqual([NB.scIn.size, NB.scIn.get(K.id).s === NK.node, NB.scIn.get(K.id).kg.kind, [...NB.scIn.get(K.id).kg.outs].length, NB.scIn.get(K.id).kg.outs.has(NB.node)], [1, true, 'gain', 1, true]);
  assert.equal(outsTo(NK.node, NB.node), 1, 'K → kg → B');
  assert.deepEqual([SC.want(B), SC.srcs(B), SC.any(), SC.mAlign(1000)], [[[K.id, 0]], [[K.id, 0]], true, 1024]);
  const cm = addUnit(B, 'cmp', K.id); await settle(2);
  assert.deepEqual(SC.edges(B), [[K.id, 1]], 'a v3 compressor names it: gain 1 (one edge, the same GainNode)');
  assert.equal(outsTo(NK.node, NB.node), 1);
  assert.deepEqual(mods(B).filter(I => I.type === 'cmp').map(I => [I.v, I.sub.src]), [[3, K.id]]);
  // the sim's processing order and the key on B's input: K's output × 1 (one Float32 rounding of a Float64 sum: exact for one source)
  const order = [], kOut = [], bIn = [];
  const wrap = (n, tag) => {
    const f = n.proc.process;
    n.proc.process = function (i, o) {
      order.push(tag);
      if (tag === 'B') bIn.push(i[0] && i[0].length === 2 ? [i[0][0].slice(), i[0][1].slice()] : null);
      const r = f.call(this, i, o);
      if (tag === 'K') kOut.push(o[0][0].slice());
      return r;
    };
    return f;
  };
  const fB = wrap(NB.node, 'B'), fK = wrap(NK.node, 'K');
  try { sim.run(256); } finally { NB.node.proc.process = fB; NK.node.proc.process = fK; }
  assert.deepEqual(order, ['K', 'B', 'K', 'B'], 'the source first in every quantum');
  assert.deepEqual([bIn.length, bIn.every(x => !!x)], [2, true], 'B\'s inputs[0] is [L, R]');
  assert.equal(f32eq(bIn[0][0], kOut[0]), -1, 'B\'s key L = K\'s output L');
  drop(B, cm); await settle(2);
  assert.deepEqual(SC.edges(B), [[K.id, 0]], 'the compressor removed: back to 0');
  drop(B, d); await settle(2);
  assert.deepEqual([SC.edges(B), outsTo(NK.node, NB.node), SC.any()], [[], 0, false], 'the Ducker removed: the edge cut (src → kg and kg → node)');
});

test('G5 export = playback: the 808 keys the bass (a Ducker and a keyed compressor) — live from an aligned ▶ after silence ≡ the bounce, per node, bit for bit; the ghost kick (muted, soloed out, fader 0) keys alike', async () => {
  addUnit(B, 'duck', K.id); addUnit(B, 'cmp', K.id); await settle(2);
  assert.deepEqual(setOf(), [[K.id, K.vol, ''], [B.id, B.vol, K.id + ':1'], [C.id, C.vol, '']], 'bounceSet: B\'s item carries its edge');
  const L1 = await liveTake();
  assert.equal(L1.F % 128, 0, 'the anchor on a quantum boundary (a unit exists)');
  const B1 = await bounceTake();
  assert.match(B1.note, /^Done: /);
  assert.ok(peak(B1[K.id].L) > 0.05 && peak(B1[B.id].L) > 0.01, 'both sound');
  const kb = B1.off.nodes.filter(n => n.po && n.po.trackId), nk = kb.find(n => n.po.trackId === K.id), nb = kb.find(n => n.po.trackId === B.id);
  assert.deepEqual([nb.nIn, nb.channelCount, nb.channelCountMode, nk.nIn, outsTo(nk, nb)], [1, 2, 'explicit', 1, 1], 'offline: the same options and edge');
  for (const t of [K, B, C]) {
    assert.equal(f32eq(L1[t.id].L, B1[t.id].L.subarray(0, BAR)), -1, t.id + ' L: live ≡ bounce');
    assert.equal(f32eq(L1[t.id].R, B1[t.id].R.subarray(0, BAR)), -1, t.id + ' R: live ≡ bounce');
  }
  // the ghost kick: K muted — live its node runs on at gain 0 and keys B; the bounce renders it at gain 0
  K.mute = true; cv.mix(); await settle(2);
  assert.deepEqual(setOf(), [[K.id, 0, ''], [B.id, B.vol, K.id + ':1'], [C.id, C.vol, '']], 'muted: K at gain 0');
  const L2 = await liveTake(), B2 = await bounceTake();
  for (const [x, y, w] of [[L2, L1, 'live muted ≡ live'], [B2, B1, 'bounce muted ≡ bounce'], [L2, B2, 'live muted ≡ bounce muted']]) {
    assert.equal(f32eq(x[B.id].L, y[B.id].L.subarray(0, BAR)), -1, 'B L: ' + w);
    assert.equal(f32eq(x[K.id].L, y[K.id].L.subarray(0, BAR)), -1, 'K L: ' + w);
  }
  // the mix: the unmuted one minus the kick's own audio (gain K.vol through a centred panner), within one float32 rounding
  let worst = 0;
  for (let i = 0; i < BAR; i++) {
    const want = B1.off.L[i] - K.vol * B1[K.id].L[i], got = B2.off.L[i], tol = 2 * Math.pow(2, -24) * Math.max(Math.abs(B1.off.L[i]), Math.abs(got)) + 1e-12;
    worst = Math.max(worst, Math.abs(got - want) / tol);
  }
  assert.ok(worst <= 1, 'the muted bounce = unmuted − the kick, within a rounding (worst ' + worst.toFixed(3) + ' of the tolerance)');
  K.mute = false; B.solo = true; cv.mix(); await settle(2);
  assert.deepEqual(setOf(), [[K.id, 0, ''], [B.id, B.vol, K.id + ':1']], 'B soloed: K (soloed out) at gain 0, C not rendered');
  const B3 = await bounceTake();
  assert.equal(f32eq(B3[B.id].L, B1[B.id].L), -1, 'soloed out: the bass as before');
  B.solo = false; const v = K.vol; K.vol = 0; cv.mix(); await settle(2);
  assert.deepEqual(setOf()[0], [K.id, 0, ''], 'fader 0: K at gain 0');
  const B4 = await bounceTake();
  assert.equal(f32eq(B4[B.id].L, B1[B.id].L), -1, 'fader 0: the bass as before');
  K.vol = v; cv.mix(); clearUnits(B); await settle(2);
});

// (lane D) what the units do with the key — the same test runs here once engine.js has its registry
test('G5 (with lane D) the bass dips at the kick\'s hits — and identically with the kick muted, live and bounced', { todo: TODO_D }, async () => {
  const r0 = await bounceTake();
  const d = addUnit(B, 'duck', K.id); await settle(2);
  const r1 = await bounceTake();
  K.mute = true; cv.mix(); await settle(2);
  const r2 = await bounceTake(), l2 = await liveTake();
  K.mute = false; cv.mix(); drop(B, d); await settle(2);
  const rms = (a, i, j) => { let s = 0; for (let k = i; k < j; k++) s += a[k] * a[k]; return Math.sqrt(s / (j - i)); };
  // the first hit (the song's frame 0, the kick sounding from frame 47): the bass held down 5–20 ms after it (the Classic dip sits at
  // 4 % until 8 % of its 1/8-note length, 20 ms at 120 bpm; ATTACK 1 ms and SMOOTH 2 ms settled by 5 ms), depth 100 %
  assert.ok(rms(r1[B.id].L, 240, 960) < 0.25 * rms(r0[B.id].L, 240, 960), 'ducked after the hit (' + rms(r1[B.id].L, 240, 960).toFixed(4) + ' vs ' + rms(r0[B.id].L, 240, 960).toFixed(4) + ')');
  assert.equal(f32eq(r2[B.id].L, r1[B.id].L), -1, 'the ghost kick ducks the bass identically (bounce)');
  assert.equal(f32eq(l2[B.id].L, r1[B.id].L.subarray(0, BAR)), -1, 'and live (export = playback)');
});

test('G6 / S5 a loop and a self-key are refused — no edge, a notice once, scSources().ok says why; K → B → C allowed and ordered', async () => {
  const d1 = addUnit(B, 'duck', K.id); await settle(2); // B ducks with K: K → B
  const okK = api.fxHost(K).scSources().ok(B.id);
  assert.match(okK, /already ducks with .* a loop would need a delay\. Pick another source\.$/, 'K\'s menu: B disabled with the reason');
  assert.deepEqual([SC.cycle(K, B.id), SC.cycle(B, K.id), SC.cycle(B, B.id)], [true, false, true]);
  // a pasted unit closes the loop: the fixed order (project order — K first) keeps K's edge, B's is refused and said once
  const d2 = addUnit(K, 'duck', B.id); await settle(2);
  assert.deepEqual([SC.edges(K), SC.edges(B), outsTo(nodeOf(K).node, nodeOf(B).node), outsTo(nodeOf(B).node, nodeOf(K).node)], [[[B.id, 0]], [], 0, 1], 'one edge of the loop, never both');
  assert.match(note(), /^Not connected: “.*” already ducks with “.*” — a loop would need a delay$/);
  const was = note(); sim.$('#notice').textContent = ''; SC.all(); api.sendPatch(B); await settle(2);
  assert.equal(sim.$('#notice').textContent, '', 'said once a session'); void was;
  assert.deepEqual(SC.graph().bad, [[B.id, K.id]]);
  drop(K, d2); await settle(2);
  assert.deepEqual([SC.edges(K), SC.edges(B)], [[], [[K.id, 0]]], 'the loop gone: the refused edge is made (every track re-synced)');
  // a self-key
  const d3 = addUnit(B, 'duck', B.id); await settle(2);
  assert.deepEqual(SC.edges(B), [[K.id, 0]]);
  assert.match(note(), /^Not connected: “.*” can't duck with itself$/);
  assert.match(api.fxHost(B).scSources().ok(B.id), /itself/);
  drop(B, d3); await settle(2);
  // K → B → C: C keyed by B (a compressor), B by K
  const c1 = addUnit(C, 'cmp', B.id); await settle(2);
  assert.deepEqual([SC.edges(B), SC.edges(C)], [[[K.id, 0]], [[B.id, 1]]]);
  const order = [], fs = [K, B, C].map(t => { const n = nodeOf(t).node, f = n.proc.process; n.proc.process = function (i, o) { order.push(t.id); return f.call(this, i, o); }; return [n, f]; });
  try { sim.run(128); } finally { for (const [n, f] of fs) n.proc.process = f; }
  assert.deepEqual(order, [K.id, B.id, C.id], 'processed in key order');
  drop(C, c1); drop(B, d1); await settle(2);
  assert.deepEqual([SC.edges(B), SC.edges(C), SC.any()], [[], [], false]);
});

test('G6 main-sim: disconnect(n, 0, 0) removes that edge alone (none there: an InvalidAccessError); disconnect() every edge', () => {
  const c = sim.ctx(), a = c.createGain(), b = c.createGain(), d = c.createGain();
  a.connect(b, 0, 0); a.connect(d);
  a.disconnect(b, 0, 0);
  assert.deepEqual([a.outs.has(b), a.outs.has(d)], [false, true]);
  let err = '';
  try { a.disconnect(b); } catch (e) { err = e.name; }
  assert.equal(err, 'InvalidAccessError');
  a.disconnect();
  assert.equal(a.outs.size, 0);
});

test('G6 / §1.3 a Ducker-only edge has gain 0: a compressor on the same track hears its own source alone (the key = C\'s output)', async () => {
  const d = addUnit(B, 'duck', K.id), cm = addUnit(B, 'cmp', C.id); await settle(2);
  assert.deepEqual(SC.edges(B).sort(), [[C.id, 1], [K.id, 0]].sort());
  const NB = nodeOf(B), NC = nodeOf(C), bIn = [], cOut = [];
  const fB = NB.node.proc.process, fC = NC.node.proc.process;
  NB.node.proc.process = function (i, o) { bIn.push(i[0] && i[0].length === 2 ? i[0][0].slice() : null); return fB.call(this, i, o); };
  NC.node.proc.process = function (i, o) { const r = fC.call(this, i, o); cOut.push(o[0][0].slice()); return r; };
  api.postTo(K, { t: 'on', n: 36, v: 1 }); api.postTo(C, { t: 'on', n: 64, v: 0.8 }); // (K hits, C holds a note: the key must carry C's alone)
  try { sim.run(24000); } finally { NB.node.proc.process = fB; NC.node.proc.process = fC; api.postTo(C, { t: 'off', n: 64 }); }
  assert.ok(cOut.some(x => peak(x) > 1e-3), 'C sounds');
  for (let q = 0; q < bIn.length; q++) assert.equal(f32eq(bIn[q], cOut[q]), -1, 'quantum ' + q + ': B\'s key = C alone (K\'s edge at 0)');
  drop(B, cm); drop(B, d); await settle(2); sim.run(96000);
});
// (from here on a delete / undo rebuilds the track objects: by id)
const tK = () => byId(K.id), tB = () => byId(B.id), tC = () => byId(C.id);

test('G6 / §1.1 a deleted keyed track: its incoming edges are cut first (the source feeds nothing more), its processor let go; undo brings the edge back', async () => {
  addUnit(tB(), 'duck', K.id); await settle(2);
  const NK = nodeOf(tK()), old = nodeOf(tB()).node;
  assert.equal(outsTo(NK.node, old), 1);
  api.deleteTrack(tB()); await settle(3);
  assert.equal(outsTo(NK.node, old), 0, 'K\'s node feeds no GainNode into the dropped node');
  sim.run(256); const r0 = old.runs; sim.run(256);
  assert.deepEqual([old.ended, old.runs === r0], [true, true], 'its processor ended (bye) and is not called again: nothing feeds it');
  cv.undo(); await settle(3);
  assert.deepEqual([!!tB(), SC.edges(tB())], [true, [[K.id, 0]]], 'undo: the track, its Ducker and the edge back (a new node)');
  assert.equal(nodeOf(tB()).node === old, false);
  // the source deleted: the edge goes with its node (no throw), the unit keeps the id; undo re-binds it
  const okNode = nodeOf(tB()).node;
  api.deleteTrack(tK()); await settle(3);
  assert.deepEqual([SC.edges(tB()), SC.want(tB()), mods(tB()).find(I => I.type === 'duck').sub.src, nodeOf(tB()).node === okNode], [[], [], K.id, true], 'the edge gone, the source kept (dangling) — the keyed node untouched');
  cv.undo(); await settle(3);
  assert.deepEqual([!!tK(), SC.edges(tB()), outsTo(nodeOf(tK()).node, nodeOf(tB()).node)], [true, [[K.id, 0]], 1], 'undo: K back, the edge re-made to its new node');
  clearUnits(tB()); await settle(2);
});

test('§1.3 track ids are reused: a source gone, a new track takes an id past it (never re-binding a kept unit); undo brings the source back under its id', async () => {
  const cm = addUnit(tB(), 'cmp', C.id); await settle(2);
  assert.deepEqual(SC.edges(tB()), [[C.id, 1]]);
  const n0 = Math.max(...P().tracks.map(t => +t.id.replace('trk_', '')));
  assert.equal(C.id, 'trk_' + n0, 'C holds the highest id');
  assert.equal(SC.freshId(), undefined, 'no source past the tracks: song.js\'s own pick');
  api.deleteTrack(tC()); await settle(3);
  assert.deepEqual([SC.edges(tB()), mods(tB()).find(I => I.id === cm).sub.src], [[], C.id]);
  assert.equal(SC.freshId(), 'trk_' + (n0 + 1));
  const X = api.addTrack(model('minimoog')); await settle(3);
  assert.deepEqual([X.id === C.id, X.id, SC.edges(tB())], [false, 'trk_' + (n0 + 1), []], 'the newcomer: a fresh id, nothing keys from it');
  const D = cv.duplicateTrack(X); await settle(3); void D;
  assert.equal(P().tracks.some(t => t.id === C.id), false, 'a duplicate neither');
  cv.undo(); await settle(3); cv.undo(); await settle(3); cv.undo(); await settle(3);
  assert.deepEqual([!!tC(), SC.edges(tB())], [true, [[C.id, 1]]], 'undo: C back under its id, the edge re-made');
  clearUnits(tB()); await settle(2);
});

test('§1.1 (skeptic #10) the edge exists before the FXP naming its source lands: sendPatch syncs first; a power cycle re-wires every edge', async () => {
  const NB = nodeOf(tB()), seen = [], post = NB.node.port.postMessage;
  NB.node.port.postMessage = function (m, tr) {
    const x = m && (m.fxr || (m.p && m.p.fxr));
    if (x && Array.isArray(x.iSrc)) seen.push([x.iSrc.join(), NB.scIn.has(K.id)]);
    return post.call(this, m, tr);
  };
  try { addUnit(tB(), 'duck', K.id); await settle(3); } finally { NB.node.port.postMessage = post; }
  assert.deepEqual(seen, [[K.id, true]], 'the chain naming K was posted with the edge already made');
  sim.$('#power').onclick(); await sim.settle(5);
  assert.equal(api.nodes.size, 0);
  await sim.power(); await settle(4);
  assert.deepEqual([SC.edges(tB()), outsTo(nodeOf(tK()).node, nodeOf(tB()).node)], [[[K.id, 0]], 1], 'power on: the new nodes keyed again (syncNodes → scAll)');
  clearUnits(tB()); await settle(2);
});

test('§1.1 every FX path re-syncs the edges (sendPatch): a Serum\'s own rack, a Serum preset load, a model change', async () => {
  const S = api.addTrack(model('serum')); await settle(4);
  addUnit(S, 'duck', K.id); await settle(2);
  assert.deepEqual(SC.edges(S), [[K.id, 0]], 'a Ducker in a Serum\'s own FX');
  assert.equal(api.sxLoad(S, 'f:' + model('serum').presets[3].name), true); await settle(3);
  assert.deepEqual([mods(S).some(I => I.type === 'duck'), SC.edges(S)], [false, []], 'a Serum preset replaces the rack: the edge goes');
  addUnit(S, 'cmp', K.id); await settle(2);
  assert.deepEqual(SC.edges(S), [[K.id, 1]]);
  api.setTrackModel(S, 'minimoog'); await settle(4);
  const S2 = byId(S.id), pan = CMOD.destOf(S2, CMOD.primId(S2));
  assert.deepEqual([S2.dev[pan].kind, SC.edges(S2)], ['panel', [[K.id, 1]]], 'a model change: the Serum\'s own FX unfolds into a panel — its keyed compressor and the edge with it');
  clearUnits(S2); await settle(2);
  assert.deepEqual(SC.edges(S2), [], 'the panel\'s compressor removed: the edge goes');
  api.deleteTrack(S2); await settle(3);
});

test('§1.3 the 900 Series as a source (skeptic #4): muted it is powered off live — unless it keys a heard track or the master (the ghost kick)', async () => {
  const U = api.addTrack(model('minimoog')); await settle(3);
  api.selectTrack(tB().id); api.setTrackModel(U, 'm900'); await settle(4); // (shown elsewhere: a shown 900's cord layer is WebGL)
  const on = () => [...nodeOf(byId(U.id)).gon.values()].every(Boolean), u = () => byId(U.id);
  assert.equal(on(), true, 'heard: on');
  u().mute = true; cv.mix(); await settle(3);
  assert.equal(on(), false, 'muted: off (ptPower)');
  const d = addUnit(tB(), 'duck', U.id); await settle(4);
  assert.deepEqual([SC.keyed(u()), on()], [true, true], 'keying the heard bass: back on at gain 0');
  tB().mute = true; cv.mix(); await settle(3);
  assert.deepEqual([SC.keyed(u()), on()], [false, false], 'the bass muted too: nothing heard needs it — off');
  tB().mute = false; cv.mix(); await settle(3);
  assert.equal(on(), true);
  { // it sounds live at gain 0 as in the bounce
    u().notes = [[0, 480, 36], [960, 480, 36], [1920, 480, 43]].map(([t, d, n], i) => ({ id: 'u' + i, t, d, n, v: 110 }));
    const L = await liveTake(), R = await bounceTake();
    assert.deepEqual([on(), peak(L[U.id].L) > 1e-3, setOf().filter(x => x[0] === U.id)], [true, true, [[U.id, 0, '']]], 'muted and keyed: its node renders live, the bounce renders it at gain 0');
    // (not bit for bit: a 900 Series' live node and a fresh offline one differ from their first sample — ≈ 1e-23, growing to
    // 0.025 within 3 ms — heard or not, keyed or not: the Moog's own state, not the sidechain's; lane H's notes, IMPL-SC §12)
    assert.ok(peak(R[U.id].L) > 1e-3);
  }
  drop(tB(), d); await settle(4);
  assert.deepEqual([SC.keyed(u()), on(), setOf().filter(x => x[0] === U.id)], [false, false, []], 'the Ducker gone: off again, not bounced');
  // one frame's patch queue holding the 900 before the bass that starts to key it: its power follows in that frame (ptPower reads the
  // project, not the edges — the 900's own post already sees the bass's new Ducker)
  api.queuePatch(u());
  const d2 = addUnit(tB(), 'duck', U.id); sim.raf();
  assert.deepEqual([SC.keyed(u()), on()], [true, true], 'on in the same frame');
  drop(tB(), d2); await settle(4);
  assert.equal(on(), false);
  MS.edit(fx => { const id = FC.newInstance(fx, 'duck', { rack: 0 }); fx.racks[0].mods.find(I => I.id === id).sub.src = U.id; }); await settle(4);
  assert.deepEqual([SC.keyed(u()), on(), SC.any(), SC.mAlign(1000)], [true, true, true, 1024], 'the master\'s Ducker names it: on');
  assert.deepEqual(setOf().filter(x => x[0] === U.id), [[U.id, 0, '']], 'the bounce renders the muted 900 (its patch sounds by itself) for the master\'s Ducker, at gain 0');
  MS.edit(fx => { for (const I of fx.racks[0].mods.slice()) FC.removeInstance(fx, I.id); }); await settle(4);
  assert.deepEqual([SC.keyed(u()), on(), SC.any()], [false, false, false]);
  api.deleteTrack(u()); await settle(3);
});

test('§7.2 the bounce\'s closure: a keying chain of muted sources at gain 0 — with the power off too —; a muted source driven only by a MIDI OUT brings its driver', async () => {
  // X (heard, notes) keyed by Y (muted) keyed by Z (muted): both at gain 0, each item with its edge
  const X = tC(), Y = tB(), Z = tK();
  Y.mute = true; Z.mute = true; cv.mix();
  addUnit(X, 'cmp', Y.id); addUnit(Y, 'duck', Z.id); await settle(3);
  const want = [[Z.id, 0, ''], [Y.id, 0, Z.id + ':0'], [X.id, X.vol, Y.id + ':1']];
  assert.deepEqual(setOf(), want);
  sim.$('#power').onclick(); await sim.settle(5);
  assert.deepEqual([api.nodes.size, setOf()], [0, want], 'the power off: the same (scWant is the project\'s, never the nodes\')');
  await sim.power(); await settle(4);
  clearUnits(X); clearUnits(Y); Y.mute = false; Z.mute = false; cv.mix(); await settle(3);
  // a muted kick with no notes of its own, played by a Serum's arpeggiator through MIDI OUT: keyed by the heard bass
  const S = api.addTrack(model('serum')), G = api.addTrack(model('tr808')); await settle(4);
  S.notes = [{ id: 's0', t: 0, d: 1800, n: 60, v: 100 }];
  api.sxHost(S).edit(st => { st.p['arp.on'] = 1; st.arp.midiOut = 2; st.arp.outTrack = G.id; }, { label: 'arp out' }); await settle(3);
  G.mute = true; cv.mix();
  const others = [tK(), tB(), tC()];
  for (const t of others) t.mute = t !== tB();
  addUnit(tB(), 'duck', G.id); await settle(3);
  assert.deepEqual(setOf(), [[tB().id, tB().vol, G.id + ':0'], [S.id, S.vol, ''], [G.id, 0, '']], 'the ghost and its driver (heard: its fader)');
  S.mute = true; cv.mix();
  assert.deepEqual(setOf(), [[tB().id, tB().vol, G.id + ':0'], [S.id, 0, ''], [G.id, 0, '']], 'the driver muted: at gain 0 too');
  clearUnits(tB()); for (const t of others) t.mute = false;
  api.deleteTrack(byId(G.id)); await settle(3); api.deleteTrack(byId(S.id)); await settle(3); cv.mix();
});

test('§6.1 scSources: self, the project\'s uid, the list in project order (a shared name told apart by its number), drum sources and their lanes, ok', () => {
  const s = api.fxHost(tB()).scSources();
  assert.deepEqual([s.self, s.uid === P().uid, s.list.map(x => x.id)], [B.id, true, P().tracks.map(t => t.id)]);
  assert.deepEqual(s.list.map(x => x.drum), P().tracks.map(t => t.id === K.id), 'the 808 is a drum source');
  const rows = s.notes(K.id);
  assert.deepEqual([Array.isArray(rows), rows[0].n, typeof rows[0].name, s.notes(C.id)], [true, 36, 'string', null], 'its lanes (the kick\'s primary 36 first); a synth: null (the 128 notes)');
  assert.deepEqual([s.ok(K.id), s.ok(C.id), s.ok(B.id) !== ''], ['', '', true]);
  const was = tC().name; tC().name = tB().name;
  const s2 = api.fxHost(tB()).scSources(), iB = P().tracks.indexOf(tB()), iC = P().tracks.indexOf(tC());
  assert.deepEqual([s2.list[iB].name, s2.list[iC].name], [was === tB().name ? s2.list[iB].name : tB().name + ' · ' + (iB + 1), tB().name + ' · ' + (iC + 1)], 'two of one name: "Bass · 2"');
  tC().name = was;
  const m = MS.host().scSources();
  assert.deepEqual([m.self, m.list.length, m.list.every(x => m.ok(x.id) === '')], [null, P().tracks.length, true], 'the master: self null, nothing refused');
  const x = api.sxHost(tB()).scSources(); // (a Serum panel's FX page: serum-ui's adapter forwards the sxHost's)
  assert.deepEqual([x.self, x.list.map(e => e.id)], [B.id, P().tracks.map(t => t.id)]);
});

test('§1.3 (skeptic #14) payloads that leave the project carry no track id: a Serum user preset and its exported file blank the sources; the track keeps its own', async () => {
  const S = api.addTrack(model('serum')); await settle(4);
  addUnit(S, 'duck', K.id); await settle(2);
  assert.ok(api.sxSave(S, 'SC keyed', 'User'));
  const e = api.store.get('synth.user.serum', []).find(p => p.name === 'SC keyed');
  assert.deepEqual([e.fx.racks[0].mods.filter(I => I.type === 'duck').map(I => I.sub.src), mods(S).filter(I => I.type === 'duck').map(I => I.sub.src)], [[''], [K.id]]);
  const blobs = [], real = URL.createObjectURL;
  URL.createObjectURL = b => { blobs.push(b); return 'blob:sim/' + blobs.length; };
  try { await api.renderLast(S, { shift: true }); } finally { URL.createObjectURL = real; }
  const j = JSON.parse(await blobs[0].text());
  assert.deepEqual(j.fx.racks[0].mods.filter(I => I.type === 'duck').map(I => I.sub.src), [''], 'the exported .serum.json');
  api.deleteTrack(byId(S.id)); await settle(3);
});

