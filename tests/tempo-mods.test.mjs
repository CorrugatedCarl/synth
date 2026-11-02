import './v8-guard.mjs';
// FR Cut B, phase 0 (docs/canvas/IMPL-FR-B.md §1.1, gate G-T; the user, 2026-11-01: "fix all of it, no switch"): a track's canvas
// modulators run at the project tempo in every state. Before the fix a track's {t: 'mods'} carried no bpm, so ModCore ran its
// tempo laws at its default 120 (IMPL-MM §12's measurement): a BPM LFO with ANCHOR off, any BPM LFO while stopped, an Hz LFO with
// ANCHOR on while playing (its phase is a closed form of the song's seconds), BPM ENVs, the chaos snap, rise / delay times.
// T1 the host (main.js in the page simulation): every track payload carries `bpm` and the key suffix `@bpm` (the master's format,
//    IMPL-MM §4.2); a tempo change reposts it at once; during a tempo gesture (a drum TEMPO drag, the tempo box's spinner held) the
//    tempo-only reposts go at most every MODS_MIN_MS, and the gesture's end posts the final tempo at once; the bounce's payload too.
// T2 the sound (the sim's real engine: the payload main.js posted, in the track's own Track): the LFO periods at 140 BPM from the
//    unwrapped phase — BPM 1/4 ANCHOR off stopped / playing, ANCHOR on stopped → 60 / 140 s; ANCHOR on playing unchanged; an Hz 1.5
//    LFO with ANCHOR on, playing → 1 / 1.5 s (0.571 s before the fix).
// T3 a tempo repost keeps the phase (setRows; only the rate changes). T4 an offline Track built with the bounce's payload runs the
//    same tempo (export = playback).
// One boot; numbers, strings and booleans only into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/tempo-mods.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as S from '../song.js?v=9';
import * as CMOD from '../cv-model.js?v=9';
import { LFO_LADDER } from '../serum-core.js?v=9';

const sim = await bootMain({ ls: fakeStorage({}), hash: '#juno60', clock: 'std' });
const api = sim.api, cv = globalThis.__synthTest.cv;
await sim.power(); await sim.settle(10); sim.raf();
sim.$('#modal').hidden = true;
const P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack);
const SR = sim.ctx().sampleRate;
const posted = (t, kind) => sim.nodeOf(t.id).posted.map(x => x.m).filter(m => m.t === kind);
const clearPosted = t => { sim.nodeOf(t.id).posted.length = 0; };
const lastMods = t => { const L = posted(t, 'mods'); return L.length ? L[L.length - 1] : null; };
const frame = () => { sim.raf(); }; // (queuePatch's frame: the patch, the graph, the payload)
const ladN = label => LFO_LADDER.findIndex(x => x.label === label) / (LFO_LADDER.length - 1);
const hzN = hz => Math.pow(hz / 100, 0.25);
// three GLOBAL canvas LFOs on the Juno's knobs: BPM 1/4 ANCHOR off, BPM 1/4 ANCHOR on, Hz 1.5 ANCHOR on
const LFOS = {
  l1: { kind: 'lfo', lfo: { mono: 1, mode: 'free', bpm: 1, anchor: 0 }, rate: ladN('1/4') },
  l2: { kind: 'lfo', lfo: { mono: 1, mode: 'free', bpm: 1, anchor: 1 }, rate: ladN('1/4') },
  l3: { kind: 'lfo', lfo: { mono: 1, mode: 'free', bpm: 0, anchor: 1 }, rate: hzN(1.5) },
};
const CABLES = [['l1.out', 'i1:cf'], ['l2.out', 'i1:rs'], ['l3.out', 'i1:lv']];
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const round = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

// the LFOs' periods (s) over `seconds` of the sim's real engine: each LFO's phase (ModCore's monitor read, mread) every 512 frames,
// unwrapped; the period = the time / the cycles
function periods(seconds) {
  const p = sim.nodeOf(T().id).proc, slots = api.buildMods(T()).slots, keys = Object.keys(LFOS), step = 512;
  const n = Math.round(seconds * SR / step), last = {}, cyc = {};
  for (const k of keys) { last[k] = NaN; cyc[k] = 0; }
  for (let s = 0; s < n; s++) {
    sim.run(step);
    p.mc.mread();
    for (const k of keys) {
      const ph = p.mc.livePh[slots[k].i];
      if (last[k] === last[k]) { let d = ph - last[k]; d -= Math.round(d); cyc[k] += d; }
      last[k] = ph;
    }
  }
  const dur = (n - 1) * step / SR, out = {};
  for (const k of keys) out[k] = cyc[k] > 0 ? dur / cyc[k] : Infinity;
  return out;
}

test('T1 the host: a track payload carries the project tempo (bpm, key@bpm); a tempo change reposts at once; a tempo gesture throttles its tempo-only reposts and its end posts the final tempo at once; the bounce\'s payload carries it', () => {
  const t = T();
  assert.equal(CMOD.instOf(t).model, 'juno60');
  cv.setProjectBpm(140); frame();
  for (const [k, d] of Object.entries(LFOS)) t.dev[k] = S.normModDev(d);
  for (const [src, dst] of CABLES) { const r = CMOD.addMod(t, src, dst, { project: P() }); assert.equal(r.ok, true, src + ' → ' + dst + ': ' + r.why); }
  clearPosted(t);
  api.queuePatch(t); frame();
  const m = lastMods(t);
  assert.ok(m && !m.off, 'a payload posted');
  assert.deepEqual([m.bpm, m.key.endsWith('@140'), m.rows.length], [140, true, 3], 'the payload carries the tempo');
  assert.deepEqual([api.buildMods(t).bpm, api.modsFor(t).bpm, api.modsFor(t).key === m.key], [140, 140, true], 'buildMods and the bounce\'s payload');
  // a tempo change (no gesture): reposted at once
  clearPosted(t);
  cv.setProjectBpm(150); frame();
  assert.deepEqual(posted(t, 'mods').map(x => x.bpm), [150], 'a typed tempo: one repost, at once');
  // a drum TEMPO drag: 20 moves (one frame each, the sim clock still) → the leading edge only; its end → the final tempo at once
  assert.equal(typeof cv.drumSetBpm, 'function', 'the drum TEMPO path (drumSetBpm) is reachable');
  clearPosted(t);
  for (let k = 1; k <= 20; k++) { cv.drumSetBpm(150 + k, 'move'); frame(); }
  const during = posted(t, 'mods').map(x => x.bpm);
  cv.drumSetBpm(171, 'end'); frame();
  const all = posted(t, 'mods').map(x => x.bpm);
  assert.deepEqual([during.length, all.length, all[all.length - 1], P().bpm], [1, 2, 171, 171], 'a drag: the leading edge, then the end at once (' + all.join(',') + ')');
  // the same 20 steps without a gesture: each its own repost
  clearPosted(t);
  for (let k = 1; k <= 20; k++) { cv.setProjectBpm(171 + k); frame(); }
  assert.equal(posted(t, 'mods').length, 20, 'no gesture: every change at once');
  // the tempo box's spinner held: throttled until the pointer is released, then the final tempo at once
  const box = sim.$('#tBpm');
  sim.advance(1000); // (a gesture a second later: the drag's last tempo-only post is long past)
  clearPosted(t);
  box.dispatchEvent({ type: 'pointerdown', target: box, currentTarget: box, button: 0, pointerId: 7, preventDefault() {}, stopPropagation() {} });
  for (let k = 1; k <= 10; k++) { box.value = String(130 + k); box.onchange(); frame(); }
  const held = posted(t, 'mods').length;
  sim.win('pointerup', { pointerId: 7 }); frame();
  const sp = posted(t, 'mods').map(x => x.bpm);
  assert.deepEqual([held, sp.length, sp[sp.length - 1]], [1, 2, 140], 'the spinner held: the leading edge, the release at once (' + sp.join(',') + ')');
  // a 120 project: bpm 120 (the same sound as before the fix)
  clearPosted(t);
  cv.setProjectBpm(120); frame();
  const m120 = lastMods(t);
  assert.deepEqual([m120 && m120.bpm, m120 && m120.key.endsWith('@120')], [120, true]);
});

test('T2 the sound at 140 BPM (the sim\'s real engine, the payload main.js posted): BPM 1/4 ANCHOR off stopped / playing and ANCHOR on stopped → 60 / 140 s; ANCHOR on playing unchanged; an Hz 1.5 LFO with ANCHOR on, playing → 1 / 1.5 s', async () => {
  cv.setProjectBpm(140); frame();
  P().metronome.countIn = 0; P().metronome.on = false;
  const p = sim.nodeOf(T().id).proc;
  assert.ok(p && p.mc, 'the track\'s Track holds a ModCore');
  sim.run(SR * 0.2);
  const st = periods(4);
  await sim.$('#tPlay').onclick(); frame(); // (play() is async: powerOn first)
  assert.equal(api.transport ? !!api.transport().playing : true, true, 'playing');
  sim.run(SR * 0.3);
  const playing = sim.nodeOf(T().id).proc.tp.play;
  const pl = periods(4);
  sim.$('#tPlay').onclick(); frame(); // (stop)
  assert.equal(playing, true, 'the Track\'s transport plays');
  const got = [st.l1, st.l2, pl.l1, pl.l2, pl.l3].map(x => round(x)).join(' / ');
  assert.ok(near(st.l1, 60 / 140, 1e-3), 'BPM 1/4, ANCHOR off, stopped (' + got + ')');
  assert.ok(near(st.l2, 60 / 140, 1e-3), 'BPM 1/4, ANCHOR on, stopped (' + got + ')');
  assert.ok(near(pl.l1, 60 / 140, 1e-3), 'BPM 1/4, ANCHOR off, playing (' + got + ')');
  assert.ok(near(pl.l2, 60 / 140, 1e-3), 'BPM 1/4, ANCHOR on, playing — unchanged by the fix (' + got + ')');
  assert.ok(near(pl.l3, 1 / 1.5, 1e-3), 'Hz 1.5, ANCHOR on, playing — 0.5714 before the fix (' + got + ')');
  assert.equal(p.mc.shim.bpm, 140, 'the payload\'s tempo reached the shim');
});

test('T3 a tempo repost keeps the phase: setRows at 150 BPM mid-run — no jump at the repost, the new rate from the next span (period 0.4 s)', () => {
  const p = sim.nodeOf(T().id).proc, i = api.buildMods(T()).slots.l1.i;
  sim.run(SR * 0.5);
  p.mc.mread(); const a = p.mc.livePh[i];
  cv.setProjectBpm(150); frame();
  assert.equal(p.mc.shim.bpm, 150, 'the repost reached the shim');
  p.mc.mread(); const b = p.mc.livePh[i];
  assert.ok(Math.abs(b - a) < 1e-9, 'no jump at the repost: ' + a + ' → ' + b);
  sim.run(512);
  p.mc.mread(); const c = p.mc.livePh[i];
  let d = c - b; d -= Math.round(d);
  assert.ok(near(d, 512 / SR / 0.4, 1e-6), 'the next 512 frames at the new rate: ' + d);
  const q = periods(3);
  assert.ok(near(q.l1, 0.4, 1e-3), 'the period after the repost: ' + round(q.l1));
});

test('T4 the bounce: an offline Track built with the bounce\'s payload (processorOptions.mods) runs the project tempo — its shim\'s bpm and its stopped ANCHOR-off period', () => {
  cv.setProjectBpm(140); frame();
  const pay = api.modsFor(T());
  assert.equal(pay.bpm, 140);
  const off = sim.ctx().scope().make({ os: 4, hostOS: 4, offline: true, trackId: 'tempo-off', mods: structuredClone(pay) }, null);
  assert.ok(off.mc, 'the offline Track built its ModCore from processorOptions.mods');
  assert.equal(off.mc.shim.bpm, 140, 'the bounce runs the project tempo');
  const i = pay.slots.l1.i, o = [[new Float32Array(128), new Float32Array(128)]], n = Math.round(3 * SR / 128);
  let last = NaN, cyc = 0;
  for (let k = 0; k < n; k++) {
    off.process([], o);
    off.mc.mread();
    const ph = off.mc.livePh[i];
    if (last === last) { let d = ph - last; d -= Math.round(d); cyc += d; }
    last = ph;
  }
  const per = (n - 1) * 128 / SR / cyc;
  assert.ok(near(per, 60 / 140, 1e-3), 'offline, BPM 1/4, ANCHOR off, stopped: ' + round(per));
});
