import './v8-guard.mjs';
// The CPU safeguard (main.js statsText / lowerOS; idle-DSP review #9, IMPL-SC §12 "Windows idle-DSP fixes (lane C)") in the page
// simulation with the real engine. Armed only while an instrument sounds or did within 2.5 s — the engine's {t: 'stats'} snd: a
// voice sounded in the report's window (any quantum of it, not only the last) — so a summed load above 85 % in silence (MASTER's
// rack, a sidechain panel on zeros, a starved audio thread: the Windows idle cascade) lowers nothing, while a real overload while
// playing still does: voices, a drum machine's short hits between two reports, a held note, a 900 Series patch, the tail right
// after the playing stops. And a lowering of ⚙ Oversampling (the other models' broadcast step) is the session's: the user's
// setting, its select and what is saved stay as chosen (the cascade used to save it: the next session started lowered).
// Loads are forced (wall-clock loads in node are meaningless): every report's load rewritten on its way to main.js. Bounded: fixed
// frame and report counts, no wait-until loop. Strings, numbers and booleans only into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/safeguard-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as CMOD from '../cv-model.js?v=9';
import { MODELS } from '../models.js?v=9';

const SR = 48000, Q = Math.ceil(SR / 4 / 128); // (quanta per stats report: the engine posts every ≥ 0.25 s of audio)
const sim = await bootMain({ ls: fakeStorage({}), hash: '#serum', clock: 'std' });
await sim.power(); await sim.settle(30); sim.raf();
const api = sim.api, P = () => api.project(), MODEL = id => MODELS.find(m => m.id === id);
for (const id of ['minimoog', 'tr808']) { api.addTrack(MODEL(id)); sim.raf(); await sim.settle(10); sim.raf(); }
const byModel = m => P().tracks.find(t => CMOD.instOf(t).model === m);
const SX = byModel('serum'), MM = byModel('minimoog'), DR = byModel('tr808');
const OS0 = api.settings().os; // (4: the sim's ⚙ select has no options — main.js falls back to 4×)
const master = () => sim.ctx().nodes.find(n => n.name === 'synth-master');
// forced loads: every track node's report → F.track, MASTER's → F.master (the summed load: 3 × F.track + F.master)
const F = { track: 0.01, master: 0.01 };
const force = (n, key) => { const f = n._fromProc.bind(n); n._fromProc = m => f(m && m.t === 'stats' && !m.fed ? Object.assign({}, m, { load: F[key] }) : m); };
const forced = new Set();
const forceAll = () => {
  for (const t of P().tracks) { const n = sim.nodeOf(t.id); if (n && !forced.has(n)) { force(n, 'track'); forced.add(n); } }
  const M = master(); if (M && !forced.has(M)) { force(M, 'master'); forced.add(M); }
};
forceAll();
// the safeguard's steps: its notices (each lowerOS branch names what it lowered)
const steps = [];
{
  const el = sim.$('#notice');
  let txt = String(el.textContent || '');
  Object.defineProperty(el, 'textContent', { configurable: true, get: () => txt, set: v => { txt = String(v); if (/^DSP load stayed above 85%/.test(txt)) steps.push(txt); } });
}
const real = n => n.got.filter(m => m.t === 'stats' && !m.fed);
sim.run(SR); // every node reports (the fed reports below copy their shape)
// k fed reports, 250 ms apart (no audio rendered): each track's (its last real report's shape) and MASTER's; tl / ml the loads,
// v(i) the voices and s(i) the snd flag of report i
function feed(k, { tl = 0.01, ml = 0.01, v = () => 0, s = () => 0 } = {}) {
  for (let i = 0; i < k; i++) {
    sim.advance(250);
    for (const t of P().tracks) {
      const n = sim.nodeOf(t.id), r = real(n).at(-1);
      n._fromProc(Object.assign({}, r, { fed: 1, load: tl, voices: v(i), snd: s(i), per: (r.per || []).map(e => Object.assign({}, e, { load: 'voices' in e ? tl : 0 }, 'voices' in e ? { voices: v(i) } : {})) }));
    }
    master()._fromProc({ t: 'stats', fed: 1, load: ml, lat: 0, per: [{ id: 'mfx', load: ml }] });
  }
}
// every step lifted (a Quality choice), then 3 s of quiet reports: the arm's window and the hot timer run out
function reset() { api.liftCaps(); feed(12); F.track = 0.01; F.master = 0.01; steps.length = 0; }
// the summed load above 85 % (MASTER's), nothing sounding: 15 s of reports
const SILENT = { tl: 0.02, ml: 0.85 };

test('silence (fed reports): 15 s at a summed 91 % with no instrument sounding (snd 0, voices 0) lowers nothing — oversampling, the Serum cap, the quality steps, the app setting', () => {
  reset();
  const before = JSON.stringify([api.caps(), api.settings().os]);
  feed(60, SILENT);
  assert.deepEqual([steps.length, JSON.stringify([api.caps(), api.settings().os])], [0, before], steps.join(' | '));
});

test('playing (fed): 3 s at 91 % with voices sounding (snd 1) takes one step after 2 s', () => {
  reset();
  feed(12, { tl: 0.02, ml: 0.85, v: () => 4, s: () => 1 });
  assert.equal(steps.length, 1, steps.join(' | '));
});

test('short notes between reports (fed): voices 0 at every report but a voice sounded inside each window (snd 1) — still a step (the report\'s snapshot alone misses them)', () => {
  reset();
  feed(12, { tl: 0.02, ml: 0.85, v: () => 0, s: () => 1 });
  assert.equal(steps.length, 1, steps.join(' | '));
});

test('staccato with gaps (fed): a voice in every other window — the 2.5 s hold bridges the gaps; still a step', () => {
  reset();
  feed(12, { tl: 0.02, ml: 0.85, s: i => (i & 1 ? 0 : 1) });
  assert.equal(steps.length, 1, steps.join(' | '));
});

test('silence after playing (real engine: a Serum, a Minimoog, an 808, MASTER): a note, its release, then 12 s at a forced 90 % — no step; every track reports snd 0', () => {
  reset();
  api.selectTrack(SX.id); sim.raf();
  api.noteOn(60, 0.8); sim.raf(); sim.run(SR / 2); api.noteOff(60); sim.raf();
  sim.run(SR * 3); // (the release, the 2 s quiet rule, the 2.5 s window: at a low load)
  const n0 = P().tracks.map(t => real(sim.nodeOf(t.id)).length);
  F.master = 0.9;
  sim.run(SR * 12);
  const snd = P().tracks.map((t, i) => real(sim.nodeOf(t.id)).slice(n0[i]).map(m => m.snd).join(''));
  assert.deepEqual([steps.length, snd.every(s => s.length >= 40 && /^0+$/.test(s))], [0, true], steps.join(' | ') + ' · snd ' + snd.join(' '));
});

test('a drum machine\'s short hits between reports (real engine: 808 maracas, 27 ms, right after each of its reports) at a forced 90 %: the reports\' voices miss them, snd does not — a step', () => {
  reset();
  api.selectTrack(DR.id); sim.raf();
  const n = sim.nodeOf(DR.id), n0 = real(n).length;
  F.master = 0.9;
  let seen = n.got.length, on = false;
  for (let q = 0; q < 16 * Q; q++) { // 16 reports
    sim.run(128);
    if (on) { api.noteOff(70); sim.raf(); on = false; }
    if (n.got.length > seen) { const fresh = n.got.slice(seen).some(m => m.t === 'stats'); seen = n.got.length; if (fresh) { api.noteOn(70, 0.8); sim.raf(); on = true; } }
  }
  const r = real(n).slice(n0), missed = r.filter(m => m.voices === 0 && m.snd === 1).length;
  assert.deepEqual([steps.length >= 1, missed >= 12], [true, true], `steps ${steps.length}, reports ${r.length}, voices 0 / snd 1 in ${missed}: ` + r.map(m => m.voices + '/' + m.snd).join(' '));
});

test('a held note (real engine: Minimoog) at a forced 90 %: a step; its reports say snd 1', () => {
  reset();
  api.selectTrack(MM.id); sim.raf();
  const n = sim.nodeOf(MM.id), n0 = real(n).length;
  F.master = 0.9;
  api.noteOn(48, 0.8); sim.raf();
  sim.run(SR * 3);
  api.noteOff(48); sim.raf();
  const r = real(n).slice(n0);
  assert.deepEqual([steps.length >= 1, r.length >= 10 && r.every(m => m.snd === 1 && m.voices >= 1)], [true, true], `steps ${steps.length}: ` + r.map(m => m.voices + '/' + m.snd).join(' '));
  sim.run(SR * 3);
});

test('right after the playing stops (real engine: a Serum note 0.5 s, then its tail) at a forced 90 % from the note on: one step inside the 2.5 s after the last voice, none in the 12 s after', () => {
  reset();
  api.selectTrack(SX.id); sim.raf();
  F.master = 0.9;
  api.noteOn(60, 0.8); sim.raf(); sim.run(SR / 2); api.noteOff(60); sim.raf();
  sim.run(SR * 12);
  assert.equal(steps.length, 1, steps.join(' | '));
});

test('a 900 Series patch (real engine: the Model 15 tile\'s Classic bass, powered, MAIN OUT patched — never quiet by design, IMPL-9 §3.6) at a forced 90 %: it sounds (snd 1), a step', async () => {
  reset();
  const ce = console.error;
  console.error = () => {}; // (the sim's DOM has no WebGL: the cord layer's shader error is logged and caught)
  try { api.addTrack(MODEL('m900')); sim.raf(); await sim.settle(10); sim.raf(); } finally { console.error = ce; }
  forceAll();
  const t = byModel('m900'), n = sim.nodeOf(t.id);
  sim.run(SR);
  const n0 = real(n).length;
  F.master = 0.9;
  sim.run(SR * 3);
  const r = real(n).slice(n0);
  assert.deepEqual([steps.length >= 1, r.length >= 10 && r.every(m => m.snd === 1)], [true, true], `steps ${steps.length}: ` + r.map(m => m.voices + '/' + m.snd).join(' '));
  api.deleteTrack(t); sim.raf(); await sim.settle(10);
  F.master = 0.01; sim.run(SR / 2);
});

test('session only: the broadcast step (the other models\' ⚙ Oversampling) lowers this session\'s oversampling — the engine, the rate line, a track added now — never the user\'s setting, its select or what is saved; a Quality choice lifts it', async () => {
  reset();
  const os0 = api.settings().os, node = sim.nodeOf(MM.id), k0 = node.posted.length;
  assert.deepEqual([OS0, os0], [4, 4], 'the setting as at boot: no earlier step was saved into it');
  const bcast = () => node.posted.slice(k0).map(x => x.m).filter(m => m.t === 'os' && !('i' in m));
  for (let s = 0; s < 6 && bcast().length === 0; s++) { // (a graphed node's instruments are lowered alone first)
    for (const N of api.nodes.values()) { N.load = 0; N.cpu = null; }
    api.nodes.get(MM.id).load = 1.2;
    api.lowerOS();
  }
  assert.deepEqual(bcast().map(m => m.v), [os0 / 2], 'the broadcast: the other models at half');
  api.save(); await sim.settle(5);
  const saved = api.store.get('synth.settings', {});
  assert.deepEqual([api.settings().os, sim.$('#os').value, saved.os], [os0, String(os0), os0], 'the setting, its select and what is saved: as the user chose');
  const rate = sim.$('#rate').textContent;
  assert.equal(rate.includes(` × ${os0 / 2} = `) && rate.includes(`(${os0}× · CPU cap)`), true, rate);
  api.addTrack(MODEL('juno60')); sim.raf(); await sim.settle(10); sim.raf();
  const J = byModel('juno60'), po = sim.nodeOf(J.id).po;
  assert.deepEqual([po.os, po.hostOS], [os0 / 2, os0 / 2], 'a track added this session: at the session\'s oversampling');
  api.deleteTrack(J); sim.raf(); await sim.settle(10);
  const k1 = node.posted.length;
  api.liftCaps(); // (a Quality choice: Serum's GLOBAL page or ⚙ Oversampling)
  const up = node.posted.slice(k1).map(x => x.m).filter(m => m.t === 'os');
  assert.deepEqual([up.filter(m => !('i' in m)).map(m => m.v), up.every(m => m.v === os0)], [[os0], true], 'lifted: the setting again');
  assert.equal(sim.$('#rate').textContent.includes('CPU cap'), false, sim.$('#rate').textContent);
  api.save(); await sim.settle(5);
  assert.equal(api.store.get('synth.settings', {}).os, os0);
});
