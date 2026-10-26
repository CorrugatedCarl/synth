import './v8-guard.mjs';
// Stage R (docs/canvas/IMPL-R.md): recording and the piano roll's lights in the page simulation with the real engine — a recorded
// note overwrites the same pitch on its track (a note starting inside its span goes, one running into it ends where it starts;
// other pitches untouched; earlier loop passes of the take too; Overdub and Replace; after input quantize); every loop pass of
// a take its own undo step (Ableton: "Record pass N"; none for a pass that recorded nothing; notes, overwrites and CC), Ctrl+Z
// while recording takes the pass in progress back to its loop boundary and recording carries on; a note held across the wrap
// keeps the wrap's cut and belongs to the pass it started in; a take without a loop one step. The lights: the roll's key strip
// lights the held notes that reached its track (the keys, MIDI, a pad) and, while the song plays, the track's notes under the
// heard playhead (not when muted; none once stopped). Chromium's clock (o.clock 'std'): the heard tick is exact. One boot;
// strings, numbers and booleans only into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/canvas-R-sim.test.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as S from '../song.js?v=9';
import { MODELS } from '../models.js?v=9';

const alive = setInterval(() => {}, 50); // (the sim's timers are unref'd: a ref'd one keeps the process up through the top-level setup)
const sim = await bootMain({ ls: fakeStorage({}), clock: 'std', outLat: 0.03 });
const api = sim.api, cv = globalThis.__synthTest.cv;
await sim.power(); await sim.settle(20);
sim.$('#modal').hidden = true;
const P = () => api.project(), TR = () => P().tracks.find(t => t.id === P().selTrack), Tx = () => api.transport();
const settle = async (n = 3) => { for (let i = 0; i < n; i++) { sim.raf(); await sim.settle(3); } };
const LOOP = 1920; // two beats at 240 BPM: half a second a pass

// the song on, a frame (rAF) every 6 quanta (16 ms) as in a browser, until the heard position is past tick `to` of loop pass
// `pass` (1 the first; a wrap is the heard tick stepping back)
let wraps = 0, lastT = -Infinity, acc = null; // (acc: a meter of the selected track's node while it is set — rmsIn)
function until(pass, to) {
  for (let q = 0; q < 400000; q++) {
    const t = api.curTick();
    if (t < lastT - 1) wraps++;
    lastT = t;
    if (wraps + 1 > pass || (wraps + 1 === pass && t >= to)) return t;
    const out = sim.run(128); if (q % 6 === 5) sim.raf();
    if (acc) { const o = out.get(sim.nodeOf(P().selTrack)); if (o) { for (let i = 0; i < 128; i++) acc.s += o.L[i] * o.L[i]; acc.n += 128; } }
  }
  throw new Error('never reached pass ' + pass + ' tick ' + to);
}
// the selected track's output level (rms) from tick a to b of loop pass `pass`
function rmsIn(pass, a, b) { until(pass, a); acc = { s: 0, n: 0 }; until(pass, b); const r = Math.sqrt(acc.s / Math.max(1, acc.n)); acc = null; return r; }
// a fresh take on the selected track: its notes / CC as given, Overdub (or the mode), the loop (or none), 240 BPM, no count-in
async function take(o = {}) {
  if (Tx().playing) { sim.$('#tPlay').click(); await settle(); }
  const p = P(), t = TR();
  t.notes = (o.notes || []).map(x => Object.assign({ v: 100, take: 'old' }, x)); S.sortNotes(t.notes); t.cc = [];
  for (const x of p.tracks) x.arm = x === t;
  p.bpm = 240; p.metronome.countIn = 0; p.metronome.on = false;
  p.rec.mode = o.mode || 'overdub'; p.rec.inputQuantize = !!o.iq;
  Object.assign(p.loop, o.loop === false ? { on: false } : { on: true, start: o.ls || 0, end: o.le || LOOP });
  Tx().pos = o.pos || 0; wraps = 0; lastT = -Infinity;
  sim.$('#tRec').click(); await sim.settle(5);
  assert.deepEqual([Tx().playing, Tx().rec], [true, true], 'recording');
  return t;
}
async function stopAll() { if (Tx().rec) sim.$('#tRec').click(); if (Tx().playing) sim.$('#tPlay').click(); await settle(); }
// one played note: pressed at tick `a` of pass `pa`, released at `b` of pass `pb` (default: the same pass) → its expected
// { t, d } on the heard clock (commitNote: the start rounded, the length rounded, ≥ 1)
function play(n, pa, a, b, pb = pa) {
  const t0 = until(pa, a); api.noteOn(n, 0.8, 0, sim.ms);
  const t1 = until(pb, b); api.noteOff(n, 0, sim.ms);
  return { t: Math.round(t0), d: Math.max(1, Math.round(t1 - t0)), t0, t1 };
}
const undoKey = () => { sim.key('KeyZ', true, { key: 'z', ctrlKey: true }); sim.key('KeyZ', false, { key: 'z', ctrlKey: true }); };
const redoKey = () => { sim.key('KeyZ', true, { key: 'z', ctrlKey: true, shiftKey: true }); sim.key('KeyZ', false, { key: 'z', ctrlKey: true, shiftKey: true }); };
const yKey = () => { sim.key('KeyY', true, { key: 'y', ctrlKey: true }); sim.key('KeyY', false, { key: 'y', ctrlKey: true }); };
// the song the engine holds for track t (its node's processor): [[n, t, d], …]; engHas: the song sounds n (its note-off due)
const engSong = t => { const N = sim.nodeOf(t.id), sn = N && N.proc ? N.proc.sn : []; const L = []; for (let i = 0; i < sn.length; i += 4) L.push([sn[i + 2], sn[i], sn[i + 1]]); return L; };
const engHas = (t, n) => { const N = sim.nodeOf(t.id); return !!(N && N.proc && N.proc.songHas(n)); };
const debounce = async () => { await sim.settle(120); sim.raf(); await sim.settle(5); }; // (sendSong's 60 ms timer fires: the song as the engine has it)
const notesOf = (t = TR()) => t.notes.map(x => [x.n, x.t, x.d]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const labels = k => cv.hist.u.slice(-k).map(e => e.label);

test('R overwrite (Overdub, no loop): a recorded note deletes the same pitch starting inside its span and shortens one running into it (a longer one loses its tail); other pitches, notes before, touching or after it untouched', async () => {
  const t = await take({ loop: false });
  const a = until(1, 1000), A = Math.round(a);
  api.noteOn(60, 0.8, 0, sim.ms);
  // the track meanwhile (the old take): what the note will meet
  t.notes.push(
    { id: 'in', t: A + 200, d: 100, n: 60, v: 100 }, { id: 'same', t: A, d: 10, n: 60, v: 100 },
    { id: 'run', t: A - 300, d: 400, n: 60, v: 100 }, { id: 'over', t: A - 100, d: 5000, n: 60, v: 100 },
    { id: 'before', t: A - 500, d: 100, n: 60, v: 100 }, { id: 'touch', t: A - 50, d: 50, n: 60, v: 100 },
    { id: 'other', t: A + 100, d: 300, n: 62, v: 100 }, { id: 'after', t: A + 3000, d: 100, n: 60, v: 100 });
  S.sortNotes(t.notes);
  const b = until(1, 2000);
  api.noteOff(60, 0, sim.ms);
  const d = Math.max(1, Math.round(b - a));
  await stopAll();
  const T1 = TR(), by = id => T1.notes.find(x => x.id === id);
  assert.deepEqual(['in', 'same'].map(id => !!by(id)), [false, false], 'starting inside the new note (its start included): gone');
  assert.deepEqual([by('run').d, by('over').d], [300, 100], 'running into it: ends where it starts (a longer one loses its tail)');
  assert.deepEqual(['before', 'touch', 'other', 'after'].map(id => [by(id).t, by(id).d]), [[A - 500, 100], [A - 50, 50], [A + 100, 300], [A + 3000, 100]], 'untouched');
  const rec = T1.notes.filter(x => x.take === Tx().take);
  assert.deepEqual(rec.map(x => [x.n, x.t, x.d]), [[60, A, d]], 'the recorded note');
  assert.equal(cv.hist.u[cv.hist.u.length - 1].label, 'Record', 'a take without a loop: one step');
  cv.undo(); await settle();
  assert.deepEqual(notesOf().length, 8, 'its undo: every overwritten note back');
  assert.deepEqual([TR().notes.find(x => x.id === 'over').d, TR().notes.some(x => x.take === Tx().take)], [5000, false], 'whole again; the take gone');
});

test('R overwrite after input quantize: the final (quantized) span is what overwrites', async () => {
  const t = await take({ loop: false, iq: true });
  const a = until(1, 1010), A = Math.round(a), g = P().quantize.grid || S.PPQ / 4;
  const q = S.quantize([{ t: A, d: 100, n: 60 }], { grid: g, strength: 100, swing: P().quantize.swing, starts: true, ends: false })[0].t;
  assert.notEqual(q, A, 'off the grid');
  api.noteOn(64, 0.8, 0, sim.ms);
  t.notes.push({ id: 'q', t: Math.min(q, A) + 1, d: 20, n: 64, v: 100 }, { id: 'r', t: Math.min(q, A) - 100, d: 400, n: 64, v: 100 });
  S.sortNotes(t.notes);
  const b = until(1, 1500);
  api.noteOff(64, 0, sim.ms);
  await stopAll();
  const T1 = TR(), rec = T1.notes.find(x => x.take === Tx().take);
  assert.equal(rec.t, q, 'quantized');
  assert.equal(T1.notes.some(x => x.id === 'q'), false, 'the note inside the quantized span: gone');
  assert.equal(T1.notes.find(x => x.id === 'r').d, q - (Math.min(q, A) - 100), 'the one running in: ends at the quantized start');
  assert.ok(b > a);
});

test('R loop recording: each pass its own undo step ("Record pass N"), none for a pass that recorded nothing; a later pass overwrites an earlier pass\'s note of the take; Ctrl+Z steps back a pass at a time — its notes, the notes it overwrote and shortened, its CC —; redo forward again', async () => {
  const t = await take({ notes: [{ id: 'X', t: 400, d: 200, n: 60 }] });
  const n0 = cv.hist.u.length;
  const c1 = play(60, 1, 300, 700); // overwrites X (starts inside)
  const e1 = play(64, 1, 1000, 1200);
  const d2 = play(62, 2, 200, 400);
  until(2, 900); api.ctl('wheel', 0.5, 0, sim.ms);
  until(3, 1000); // pass 3: nothing
  const c4 = play(60, 4, 500, 800); // shortens pass 1's C4 to end at its start
  until(5, 100);
  await stopAll();
  const T1 = TR();
  assert.deepEqual(notesOf(T1), [[60, c1.t, c4.t - c1.t], [60, c4.t, c4.d], [62, d2.t, d2.d], [64, e1.t, e1.d]].sort((a, b) => a[0] - b[0] || a[1] - b[1]), 'X gone, pass 1\'s C4 shortened by pass 4\'s');
  assert.deepEqual(T1.cc.map(x => x.k), ['wheel'], 'the wheel recorded in pass 2');
  assert.equal(cv.hist.u.length - n0, 3, 'three steps (pass 3 recorded nothing)');
  assert.deepEqual(labels(3), ['Record pass 1', 'Record pass 2', 'Record pass 4']);
  undoKey(); await settle();
  assert.deepEqual(notesOf(), [[60, c1.t, c1.d], [62, d2.t, d2.d], [64, e1.t, e1.d]], 'Ctrl+Z: pass 4 undone — its note gone, pass 1\'s C4 whole again');
  undoKey(); await settle();
  assert.deepEqual([notesOf(), TR().cc.length], [[[60, c1.t, c1.d], [64, e1.t, e1.d]], 0], 'pass 2: its note and its wheel');
  undoKey(); await settle();
  assert.deepEqual(notesOf(), [[60, 400, 200]], 'pass 1: X back');
  for (let i = 0; i < 3; i++) cv.redo();
  await settle();
  assert.deepEqual(notesOf(), [[60, c1.t, c4.t - c1.t], [60, c4.t, c4.d], [62, d2.t, d2.d], [64, e1.t, e1.d]].sort((a, b) => a[0] - b[0] || a[1] - b[1]), 'redo ×3: as recorded');
  assert.ok(t);
});

test('R Ctrl+Z while loop recording: the pass in progress goes back to its loop boundary and recording carries on (a key held through it is not recorded); again on an empty pass: the pass before; the next notes record as a new step', async () => {
  await take();
  const g1 = play(60, 1, 300, 500);
  const g2 = play(62, 2, 300, 500);
  play(64, 2, 900, 1100);
  until(2, 1300); api.noteOn(67, 0.8, 0, sim.ms);
  undoKey(); await sim.settle(2);
  assert.deepEqual([Tx().rec, Tx().playing], [true, true], 'still recording');
  assert.deepEqual(notesOf(), [[60, g1.t, g1.d]], 'pass 2 back to its boundary');
  until(2, 1500); api.noteOff(67, 0, sim.ms);
  const f2 = play(65, 2, 1600, 1800);
  assert.deepEqual(notesOf(), [[60, g1.t, g1.d], [65, f2.t, f2.d]], 'the held key not recorded; a new note is');
  assert.equal(labels(1)[0], 'Record pass 2', 'pass 2 again');
  play(69, 3, 300, 500);
  undoKey(); await sim.settle(2);
  assert.deepEqual(notesOf(), [[60, g1.t, g1.d], [65, f2.t, f2.d]], 'pass 3 undone');
  undoKey(); await sim.settle(2);
  assert.deepEqual(notesOf(), [[60, g1.t, g1.d]], 'an empty pass in progress: the pass before');
  undoKey(); await sim.settle(2);
  assert.deepEqual([notesOf(), Tx().rec], [[], true], 'pass 1 too — still recording');
  const h3 = play(71, 3, 1000, 1200);
  await stopAll();
  assert.deepEqual(notesOf(), [[71, h3.t, h3.d]], 'recording carried on');
  assert.ok(g2.d > 0);
});

test('R a note held across the loop wrap: cut at the loop end (the wrap\'s cut, unchanged) and in the pass it started in — its undo step, and the overwrite up to the loop end', async () => {
  await take({ notes: [{ id: 'Y', t: 1700, d: 100, n: 60 }] });
  const h = play(60, 1, 1500, 300, 2);
  const d2 = play(62, 2, 600, 800);
  await stopAll();
  const exp = Math.max(1, Math.round(LOOP - h.t0));
  assert.deepEqual(notesOf(), [[60, h.t, exp], [62, d2.t, d2.d]], 'held into pass 2: ends at the loop end; Y (inside it) gone');
  assert.deepEqual(labels(2), ['Record pass 1', 'Record pass 2']);
  cv.undo(); await settle();
  assert.deepEqual(notesOf(), [[60, h.t, exp]], 'undo pass 2: the held note stays (it is pass 1\'s)');
  cv.undo(); await settle();
  assert.deepEqual(notesOf(), [[60, 1700, 100]], 'undo pass 1: Y back');
});

test('R Replace mode: the sweep wipes the other takes as before, inside the pass\'s step; a later pass overwrites the take\'s own earlier note of the same pitch (the sweep keeps the take); undo per pass', async () => {
  await take({ mode: 'replace', notes: [{ id: 'Z', t: 1000, d: 100, n: 50 }, { id: 'W', t: 1500, d: 100, n: 52 }] });
  const c1 = play(60, 1, 300, 700);
  until(1, 1800);
  assert.deepEqual(notesOf(), [[60, c1.t, c1.d]], 'Z and W wiped as the playhead passed them');
  const e2 = play(64, 2, 200, 300);
  const c2 = play(60, 2, 500, 900);
  await stopAll();
  assert.deepEqual(notesOf(), [[60, c1.t, c2.t - c1.t], [60, c2.t, c2.d], [64, e2.t, e2.d]], 'pass 1\'s C4 shortened');
  cv.undo(); await settle();
  assert.deepEqual(notesOf(), [[60, c1.t, c1.d]], 'pass 2 undone');
  cv.undo(); await settle();
  assert.deepEqual(notesOf(), [[50, 1000, 100], [52, 1500, 100]], 'pass 1 undone: the wiped notes back');
});

test('R an edit in the middle of a pass (the roll): the pass\'s later notes get a step of their own — undo follows what happened (the later notes, the edit, the earlier notes)', async () => {
  await take({ notes: [{ id: 'V', t: 1800, d: 60, n: 40, v: 50 }] });
  const a = play(60, 1, 200, 400);
  api.roll().host.edit('Velocity', () => { TR().notes.find(x => x.id === 'V').v = 90; });
  const b = play(62, 1, 800, 1000);
  await stopAll();
  assert.deepEqual(labels(3), ['Record pass 1', '', 'Record pass 1'], 'the pass split around the edit');
  const vel = () => TR().notes.find(x => x.id === 'V').v;
  cv.undo(); await settle();
  assert.deepEqual([notesOf(), vel()], [[[40, 1800, 60], [60, a.t, a.d]], 90], 'the later note');
  cv.undo(); await settle();
  assert.deepEqual([notesOf().length, vel()], [2, 50], 'the edit');
  cv.undo(); await settle();
  assert.deepEqual(notesOf(), [[40, 1800, 60]], 'the earlier note');
  assert.ok(b.d > 0);
});

test('R a seek while loop recording (⏮ to the loop start) starts a new pass, its own step; without a loop the take stays one step across a seek', async () => {
  await take();
  play(60, 1, 300, 500);
  sim.$('#tStart').click();
  play(62, 2, 300, 500); // (the helper counts the jump back as a pass)
  await stopAll();
  assert.deepEqual(labels(2), ['Record pass 1', 'Record pass 2']);
  await take({ loop: false });
  const n0 = cv.hist.u.length;
  play(60, 1, 300, 500);
  sim.$('#tStart').click();
  play(62, 2, 300, 500);
  await stopAll();
  assert.deepEqual([cv.hist.u.length - n0, labels(1)[0], notesOf().length], [1, 'Record', 2], 'one step');
});

test('R lights in the page: the roll\'s key strip lights the held notes that reached its track — the keyboard\'s, a MIDI channel\'s routed to it, a pad\'s on it (not another track\'s) —, its notes under the heard playhead while the song plays (not muted), none once stopped', async () => {
  await stopAll();
  const roll = api.roll(), A = TR();
  A.notes = [{ id: 'p', t: 0, d: 960, n: 72, v: 100 }, { id: 'q', t: 480, d: 960, n: 76, v: 100 }]; A.cc = [];
  const B = api.addTrack(); await settle();
  api.selectTrack(A.id); await settle();
  B.ch = 5; A.ch = 1; A.arm = false; B.arm = false; // (A on channel 1: not omni)
  assert.deepEqual(roll.litKeys(), [], 'nothing held');
  api.noteOn(60, 0.8, 0, sim.ms);
  assert.deepEqual(roll.litKeys(), [60], 'the keyboard\'s note');
  api.noteOn(62, 0.8, 5, sim.ms);
  assert.deepEqual(roll.litKeys(), [60], 'MIDI channel 5 goes to B only: not on A\'s roll');
  api.noteOn(64, 0.8, 'pd9', sim.ms, [B], { rec: 'target' });
  api.noteOn(65, 0.8, 'pd8', sim.ms, [A], { rec: 'target' });
  assert.deepEqual(roll.litKeys(), [60, 65], 'a pad\'s note on A lit, on B not');
  api.noteOff(60, 0, sim.ms);
  assert.deepEqual(roll.litKeys(), [65], 'released');
  api.selectTrack(B.id); await settle();
  assert.deepEqual(roll.litKeys(), [64], 'B selected: its pad\'s note (the switch releases the keyboard\'s and MIDI\'s, as before)');
  api.noteOff(62, 5, sim.ms); api.noteOff(64, 'pd9', sim.ms); api.noteOff(65, 'pd8', sim.ms);
  api.selectTrack(A.id); await settle();
  assert.deepEqual(roll.litKeys(), [], 'all released');
  // playback: the heard playhead
  P().loop.on = false; P().bpm = 120; Tx().pos = 0; wraps = 0; lastT = -Infinity;
  sim.$('#tPlay').click(); await sim.settle(5);
  const t1 = until(1, 600); sim.raf();
  assert.ok(Math.abs(roll.ph - t1) < 1e-6, 'the roll follows the heard tick');
  assert.deepEqual([roll.sounding().map(x => x.id).sort().join(), roll.litKeys().join()], ['p,q', '72,76'], 'both notes under the playhead');
  A.mute = true; sim.raf();
  assert.deepEqual(roll.sounding().length, 0, 'muted: unlit');
  A.mute = false; until(1, 1000); sim.raf();
  assert.deepEqual(roll.litKeys(), [76], 'the first ended');
  sim.$('#tPlay').click(); await settle();
  assert.deepEqual([roll.sounding().length, roll.litKeys().length], [0, 0], 'stopped: none');
});

/* ---- the review's fixes (review-R, lane A: R-1 … R-10, R-15) ---- */

// R-1: a key held for more than one loop pass while recording — its note is committed at the loop end into its own pass (as
// before) but kept out of the engine while the key is down: the song's copy took the live voice over in the next pass and
// its note-off at the loop end silenced the held key. The control: the same hold while only playing
async function longHold(rec) {
  if (Tx().playing) { if (Tx().rec) sim.$('#tRec').click(); sim.$('#tPlay').click(); await settle(); }
  const p = P(), t = TR();
  t.notes = []; t.cc = [];
  for (const x of p.tracks) x.arm = x === t;
  p.bpm = 240; p.metronome.countIn = 0; p.metronome.on = false; p.rec.mode = 'overdub'; p.rec.inputQuantize = false;
  Object.assign(p.loop, { on: true, start: 0, end: LOOP });
  Tx().pos = 0; wraps = 0; lastT = -Infinity;
  sim.$(rec ? '#tRec' : '#tPlay').click(); await sim.settle(5);
  const t0 = until(1, 1000); api.noteOn(60, 0.8, 0, sim.ms);
  until(2, 50); await debounce();
  const r = { t0, notes2: notesOf(t), held: engSong(t).length };
  r.p2 = rmsIn(2, 300, 900); r.p3 = rmsIn(3, 200, 900);
  until(3, 1200); api.noteOff(60, 0, sim.ms); await debounce();
  r.after = engSong(t);
  if (Tx().rec) sim.$('#tRec').click();
  sim.$('#tPlay').click(); await settle();
  r.notes = notesOf(t);
  return r;
}
test('R-1 a key held for more than a loop pass while recording sounds until its release (sendSong\'s debounce allowed to fire): its note, committed at the loop end into its pass, reaches the engine only once the key is up; the recorded note as before', async () => {
  const ctl = await longHold(false), rec = await longHold(true);
  assert.ok(ctl.p3 > 0.01, 'the control (playing only) sounds in pass 3: ' + ctl.p3);
  const T0 = Math.round(rec.t0), D = Math.max(1, Math.round(LOOP - rec.t0));
  assert.deepEqual(rec.notes2, [[60, T0, D]], 'committed at the 1 → 2 wrap, cut at the loop end');
  assert.ok(rec.p2 > ctl.p2 * 0.5, 'pass 2 sounds: ' + rec.p2 + ' vs ' + ctl.p2);
  assert.ok(rec.p3 > ctl.p3 * 0.5, 'pass 3 still sounds while the key is held: ' + rec.p3 + ' vs ' + ctl.p3);
  assert.equal(rec.held, 0, 'while its key is down the engine\'s song does not hold it');
  assert.deepEqual(rec.after, [[60, T0, D]], 'released: the note reaches the engine');
  assert.deepEqual(rec.notes, [[60, T0, D]], 'the recorded note unchanged');
});

// R-2: Ctrl+Z while the pass in progress holds only a note still down (nothing released yet): that note is the pass's whole
// content — it is dropped, and the pass before stays
test('R-2 Ctrl+Z in a pass whose only content is a held note drops that note and leaves the pass before; a second Ctrl+Z (an empty pass, nothing held) undoes the pass before', async () => {
  await take();
  const a = play(60, 1, 300, 500);
  until(2, 300); api.noteOn(62, 0.8, 0, sim.ms);
  until(2, 600); undoKey(); await sim.settle(2);
  assert.deepEqual([notesOf(), labels(1), cv.hist.r.length, Tx().rec], [[[60, a.t, a.d]], ['Record pass 1'], 0, true], 'pass 1 kept, nothing undone');
  until(2, 800); api.noteOff(62, 0, sim.ms);
  assert.deepEqual(notesOf(), [[60, a.t, a.d]], 'the held D4 (pass 2\'s only content) not recorded');
  undoKey(); await sim.settle(2);
  assert.deepEqual([notesOf(), Tx().rec], [[], true], 'an empty pass, nothing held: the pass before undone, still recording');
  await stopAll();
  // a "tap to undo" (a notice's own step, the newest: undo(true)) undoes that step, never the pass's held notes instead
  await take({ notes: [{ id: 'V', t: 1800, d: 60, n: 40, v: 50 }] });
  const b = play(60, 1, 300, 500);
  until(2, 300); api.noteOn(62, 0.8, 0, sim.ms);
  api.roll().host.edit('Velocity', () => { TR().notes.find(x => x.id === 'V').v = 90; });
  cv.undo(true); await sim.settle(2);
  assert.equal(TR().notes.find(x => x.id === 'V').v, 50, 'the tap undid its edit');
  until(2, 600); api.noteOff(62, 0, sim.ms);
  assert.deepEqual(notesOf(), [[40, 1800, 60], [60, b.t, b.d]], 'the restore dropped the held D4 (IMPL-R §2), pass 1 kept');
  await stopAll();
});

// R-3: with input quantize a hit snapped to the loop end lands on the loop start (Ableton) — never outside the loop, where it
// overwrote the notes the bar after the loop plays; one snapped before an off-grid loop start is clamped to it
test('R-3 input quantize while looping: a hit snapped to the loop end wraps to the loop start and replaces the downbeat there (notes after the loop untouched), held across the wrap too; one snapped before an off-grid loop start is clamped to it; a lead-in note before the loop keeps its placement', async () => {
  await take({ iq: true, notes: [{ id: 'S', t: 0, d: 100, n: 36 }, { id: 'E', t: 1920, d: 100, n: 36 }, { id: 'F', t: 1960, d: 100, n: 36 }] });
  const h = play(36, 1, 1880, 1900);
  await stopAll();
  const by = id => TR().notes.some(x => x.id === id), mine = () => TR().notes.filter(x => x.take !== 'old').map(x => [x.n, x.t, x.d]);
  assert.deepEqual(['S', 'E', 'F'].map(by), [false, true, true], 'S replaced; E and F (after the loop) untouched');
  assert.deepEqual(mine(), [[36, 0, h.d]], 'the hit on the loop start');
  // held across the wrap: committed at the loop end, [≈1850, 1920) snapped to 1920 → the loop start
  await take({ iq: true, notes: [{ id: 'S', t: 0, d: 100, n: 36 }, { id: 'E', t: 1920, d: 300, n: 36 }] });
  const a = until(1, 1850); api.noteOn(36, 0.8, 0, sim.ms);
  until(2, 200); api.noteOff(36, 0, sim.ms);
  await stopAll();
  assert.deepEqual([by('S'), by('E')], [false, true], 'held across the wrap: S replaced, E untouched');
  assert.deepEqual(mine(), [[36, 0, Math.round(LOOP - a)]], 'on the loop start');
  // an off-grid loop start (100–2020): a hit at ≈ 110 of pass 2 snaps to 0 — clamped to 100; Z before the loop untouched
  await take({ iq: true, ls: 100, le: 2020, notes: [{ id: 'Z', t: 0, d: 60, n: 48 }] });
  until(1, 1000);
  play(48, 2, 110, 130);
  await stopAll();
  assert.equal(by('Z'), true, 'Z (before the loop) untouched');
  assert.deepEqual(mine().map(x => x[1]), [100], 'clamped to the loop start');
  // a lead-in (played before the loop, from an earlier start): quantized as before
  await take({ iq: true, ls: 960, le: 2880 });
  play(50, 1, 500, 560);
  await stopAll();
  assert.deepEqual(mine().map(x => x[1]), [480], 'the lead-in note on its grid line');
});

// R-4: Replace mode — the sweep of a pass's last frame belongs to that pass's step (the old pass's tail is swept before the
// pass moves on), so a pass that changes nothing has no step; a seek is never such a wrap
test('R-4 Replace: the old notes in the last frame slice before the loop end are swept in that pass\'s own step — one step for pass 1 (pass 2 changed nothing), one undo restores them all; a forward seek while recording does not sweep the rest of the loop', async () => {
  const tail = [1, 3, 7, 12, 20, 30, 45].map((k, i) => ({ id: 'z' + i, t: LOOP - k, d: 1, n: 40 + i }));
  await take({ mode: 'replace', notes: tail });
  const n0 = cv.hist.u.length;
  play(60, 1, 300, 700);
  until(1, LOOP - 1);
  until(2, 1000); // pass 2: nothing played
  await stopAll();
  assert.deepEqual(cv.hist.u.slice(n0).map(e => e.label), ['Record pass 1'], 'one step');
  assert.deepEqual(notesOf().map(x => x[0]), [60], 'the tail swept');
  cv.undo(); await settle();
  assert.deepEqual(notesOf(), tail.map(x => [x.n, x.t, x.d]), 'one undo: every tail note back, the take gone');
  // a forward seek (the ruler) in pass 1: B, after the seek target, is wiped only once the playhead passes it
  await take({ mode: 'replace', notes: [{ id: 'B', t: 1700, d: 50, n: 52 }] });
  play(60, 1, 200, 300);
  until(1, 400);
  api.roll().host.setPlayhead(1200);
  until(1, 1300);
  await stopAll();
  assert.equal(TR().notes.some(x => x.id === 'B'), true, 'B (not passed yet) kept');
});

// R-5: an undo / redo that finds nothing changes nothing — the held notes stay, the pass stays one step
test('R-5 a redo shortcut with nothing to redo while recording (Ctrl+Y, Ctrl+Shift+Z) keeps the held note and the pass\'s one step', async () => {
  await take();
  play(60, 1, 200, 300);
  until(1, 500); api.noteOn(64, 0.8, 0, sim.ms);
  until(1, 600); yKey(); await sim.settle(2);
  until(1, 900); api.noteOff(64, 0, sim.ms);
  await stopAll();
  assert.deepEqual(notesOf().map(x => x[0]), [60, 64], 'Ctrl+Y redid nothing: the held E4 recorded');
  await take();
  const n0 = cv.hist.u.length;
  play(60, 1, 300, 500);
  until(1, 700); api.noteOn(64, 0.8, 0, sim.ms);
  redoKey(); await sim.settle(2);
  until(1, 900); api.noteOff(64, 0, sim.ms);
  play(67, 1, 1000, 1100);
  assert.deepEqual([notesOf().map(x => x[0]), cv.hist.u.slice(n0).map(e => e.label)], [[60, 64, 67], ['Record pass 1']], 'E4 recorded; pass 1 one step');
  undoKey(); await sim.settle(2);
  assert.deepEqual(notesOf(), [], 'one Ctrl+Z: the whole pass');
  await stopAll();
});

// R-6: a pass's step is never taken in the middle of a piano-roll gesture: what is recorded during it joins the gesture's step
test('R-6 a note recorded during a roll drag joins the drag\'s step: the first undo takes back the drag with it (never a half-dragged position), the next the pass before', async () => {
  const t = await take({ notes: [{ id: 'x', t: 100, d: 100, n: 64 }] });
  const c = play(60, 1, 200, 400);
  until(2, 100);
  const roll = api.roll(), x = t.notes.find(o => o.id === 'x');
  roll.host.beginEdit(); // the drag's press: its step
  x.t = 700; roll.host.changed();
  play(62, 2, 300, 500); // released mid-drag: pass 2's first change
  x.t = 1300; roll.host.changed();
  roll.host.endEdit();
  await stopAll();
  const xs = () => { const o = TR().notes.find(o => o.id === 'x'); return o ? o.t : null; };
  undoKey(); await settle();
  assert.deepEqual([xs(), notesOf()], [100, [[60, c.t, c.d], [64, 100, 100]]], 'undo 1: the drag and the note played during it');
  undoKey(); await settle();
  assert.deepEqual(notesOf(), [[64, 100, 100]], 'undo 2: pass 1');
});

// R-7: a key pressed right after ⏮ while looping (the old audio still heard): its start is the seek's — never before the loop
test('R-7 a key pressed within the render lead after ⏮ while looping starts at the loop start: nothing before the loop is overwritten', async () => {
  await take({ ls: 960, le: 2880, pos: 960, notes: [{ id: 'O', t: 900, d: 50, n: 60 }] });
  until(1, 2000);
  sim.$('#tStart').click(); sim.run(128); sim.run(128);
  api.noteOn(60, 0.8, 0, sim.ms);
  for (let i = 0; i < 40; i++) { sim.run(128); if (i % 6 === 5) sim.raf(); }
  api.noteOff(60, 0, sim.ms);
  await stopAll();
  assert.equal(TR().notes.some(x => x.id === 'O'), true, 'O (before the loop) survives');
  assert.deepEqual(TR().notes.filter(x => x.take !== 'old').map(x => x.t), [960], 'the note starts at the seek (the loop start)');
});

// R-8: undoing an edit made in the middle of a pass while recording: the pass's own step is the newest again — the pass's
// later notes join it (one step), and the undone edit is no longer redoable once they do
test('R-8 Ctrl+Z of a mid-pass edit while recording: the pass carries on in its own step (one step, one undo takes the pass back), the undone edit dropped from redo', async () => {
  await take({ notes: [{ id: 'V', t: 1800, d: 60, n: 40, v: 50 }] });
  const n0 = cv.hist.u.length;
  play(60, 1, 200, 400);
  api.roll().host.edit('Velocity', () => { TR().notes.find(x => x.id === 'V').v = 90; });
  undoKey(); await sim.settle(2);
  assert.equal(TR().notes.find(x => x.id === 'V').v, 50, 'the edit undone');
  play(62, 1, 800, 1000);
  assert.equal(cv.hist.r.length, 0, 'the undone edit no longer redoable');
  await stopAll();
  assert.deepEqual(cv.hist.u.slice(n0).map(e => e.label), ['Record pass 1'], 'one step');
  cv.undo(); await settle();
  assert.deepEqual(notesOf(), [[40, 1800, 60]], 'one undo: pass 1 gone');
});

// R-9: a recorded note that overwrites exactly one same-pitch note leaves the track a new notes array (as the Replace sweep
// does): the pads following the track (cv-pads rollOf) and the other caches keyed on the array and its length see the change
test('R-9 a recorded note that deletes exactly one same-pitch note gives the track a new notes array (same length: the identity is what tells)', async () => {
  await take({ loop: false, notes: [{ id: 'n1', t: 960, d: 480, n: 60 }] });
  const before = TR().notes;
  play(60, 1, 900, 1000);
  await stopAll();
  assert.deepEqual([notesOf().length, TR().notes.some(x => x.id === 'n1')], [1, false], 'n1 overwritten');
  assert.equal(TR().notes === before, false, 'a new array');
});

// R-10: arming is not undoable (Ableton): Ctrl+Z while recording back past the take's start keeps the armed tracks armed
test('R-10 Ctrl+Z while recording that goes back past the take\'s first pass keeps the track armed: recording carries on', async () => {
  await stopAll();
  const p = P();
  TR().notes = []; TR().cc = [];
  for (const x of p.tracks) x.arm = false;
  p.bpm = 240; p.metronome.countIn = 0; p.metronome.on = false; p.rec.mode = 'overdub'; p.rec.inputQuantize = false;
  Object.assign(p.loop, { on: true, start: 0, end: LOOP });
  api.roll().host.edit('Add note', () => { TR().notes.push({ id: 'E', t: 1000, d: 200, n: 50, v: 100 }); }); // (a step with the track unarmed)
  Tx().pos = 0; wraps = 0; lastT = -Infinity;
  sim.$('#tRec').click(); await sim.settle(5); // (● arms the selected track)
  assert.equal(TR().arm, true, 'armed by ●');
  play(60, 1, 300, 500);
  until(2, 300); undoKey(); await sim.settle(2);
  until(2, 900); undoKey(); await sim.settle(2);
  assert.deepEqual([notesOf(), TR().arm, Tx().rec], [[], true, true], 'pass 1 and the edit undone; still armed, still recording');
  const c = play(64, 3, 300, 500);
  await stopAll();
  assert.deepEqual(notesOf(), [[64, c.t, c.d]], 'the pass-3 note recorded');
});

// R-15: a song update while playing ends the song's sounding notes it no longer has (an undone pass, a deleted note: the
// engine played them on to their old end) — never a voice the player holds live on that pitch
test('R-15 Ctrl+Z of a pass while its long note sounds ends that note in the engine; a deleted song note the player holds live keeps sounding until its key is up', async () => {
  const t = await take();
  play(60, 1, 100, 1700); await debounce();
  const on = rmsIn(2, 300, 400);
  assert.equal(engHas(t, 60), true, 'the song\'s C4 sounds in pass 2');
  assert.ok(on > 0.02, 'audible: ' + on);
  undoKey(); await sim.settle(2);
  assert.deepEqual([notesOf(), Tx().rec], [[], true], 'pass 1 undone, still recording');
  assert.equal(engHas(TR(), 60), false, 'the engine let it go');
  const off = rmsIn(2, 800, 1200);
  assert.ok(off < on * 0.02, 'silent after its release: ' + off + ' (was ' + on + ')');
  await stopAll();
  // playing only: a long song C4, the player presses C4 too, the song's note is deleted — the key's voice carries on
  const T1 = TR();
  T1.notes = [{ id: 'L', t: 0, d: 3000, n: 60, v: 100 }]; T1.cc = [];
  api.roll().host.changed(); await debounce();
  P().loop.on = false; Tx().pos = 0; wraps = 0; lastT = -Infinity;
  sim.$('#tPlay').click(); await sim.settle(5);
  until(1, 500); api.noteOn(60, 0.8, 0, sim.ms);
  until(1, 700); api.roll().host.edit('Delete', () => { TR().notes = []; }); await debounce();
  const live = rmsIn(1, 1000, 1400);
  assert.ok(live > 0.02, 'the held key still sounds: ' + live);
  api.noteOff(60, 0, sim.ms);
  sim.$('#tPlay').click(); await settle();
});

/* ---- the skeptics' follow-ups (lane A, round 2) ---- */

// R-1 (follow-up): a restore while a key held across the wrap is still down — an undo of a later pass, an undo of the note's
// own pass and its redo, an undone edit — brings new note objects: the held key's note (found again by its id) stays out of
// the engine until the key is up; the key sounds on through pass 3
async function holdThrough(mid, notes) {
  await take({ notes });
  api.roll().host.changed(); await debounce(); // (take() sets the notes in place: the engine's song as the take's — an earlier run's recorded C4 gone)
  const t0 = until(1, 1000); api.noteOn(60, 0.8, 0, sim.ms);
  until(2, 50); await debounce();
  await mid();
  await debounce();
  const r = { t0, eng: engSong(TR()).filter(x => x[0] === 60), p3: rmsIn(3, 300, 900) };
  until(3, 1200); api.noteOff(60, 0, sim.ms); await debounce();
  r.after = engSong(TR()).filter(x => x[0] === 60); r.notes = notesOf().filter(x => x[0] === 60);
  await stopAll();
  return r;
}
test('R-1 (follow-up) an undo, a redo or an undone edit while a key held across the wrap is still down: its note stays out of the engine until the key is up (the key sounds on in pass 3), then reaches it', async () => {
  const ctl = await holdThrough(async () => {});
  assert.ok(ctl.p3 > 0.01, 'the control sounds in pass 3: ' + ctl.p3);
  const V = [{ id: 'V', t: 1800, d: 60, n: 40, v: 50 }];
  const cases = {
    undo: () => { play(64, 2, 100, 200); until(2, 400); undoKey(); },                    // pass 2 (its E4) undone
    redo: () => { until(2, 200); undoKey(); until(2, 400); redoKey(); },                 // pass 1 (the held C4's) undone, redone
    edit: () => { until(2, 100); api.roll().host.edit('Velocity', () => { TR().notes.find(x => x.id === 'V').v = 90; }); until(2, 300); undoKey(); },
  };
  for (const [k, f] of Object.entries(cases)) {
    const r = await holdThrough(async () => { f(); await sim.settle(2); }, k === 'edit' ? V : undefined);
    const c = [60, Math.round(r.t0), Math.max(1, Math.round(LOOP - r.t0))];
    assert.deepEqual(r.eng, [], k + ': while its key is down the engine\'s song does not hold it');
    assert.ok(r.p3 > ctl.p3 * 0.5, k + ': pass 3 still sounds while the key is held: ' + r.p3 + ' vs ' + ctl.p3);
    assert.deepEqual([r.after, r.notes], [[c], [c]], k + ': released — the note reaches the engine, recorded as before');
  }
});

// R-2 (follow-up): R-2's branch only when nothing was recorded after the held keys went down — undo follows what happened:
// a step recorded after the key went down (a roll edit) is undone first, by Ctrl+Z and the toolbar alike (the held note goes
// with the restore, IMPL-R §2); a step from before the key went down: the held note alone first, then the step
test('R-2 (follow-up) Ctrl+Z / the toolbar Undo in a stepless pass with a key held: an edit made after the key went down is undone on the first press; one made before it: the held note first, the edit on the next press', async () => {
  const V = [{ id: 'V', t: 1800, d: 60, n: 40, v: 50 }], vOf = () => TR().notes.find(x => x.id === 'V').v;
  const edit = () => api.roll().host.edit('Velocity', () => { TR().notes.find(x => x.id === 'V').v = 90; });
  for (const how of ['key', 'bar']) {
    await take({ notes: V });
    const a = play(60, 1, 300, 500);
    until(2, 300); api.noteOn(62, 0.8, 0, sim.ms);
    until(2, 400); edit();
    until(2, 600); if (how === 'key') undoKey(); else sim.$('#tUndo').onclick({ type: 'click' }); await sim.settle(2);
    assert.equal(vOf(), 50, how + ': the first press undid the edit (the newest step)');
    until(2, 800); api.noteOff(62, 0, sim.ms);
    assert.deepEqual([notesOf(), Tx().rec], [[[40, 1800, 60], [60, a.t, a.d]], true], how + ': the held D4 went with the restore, pass 1 kept');
    await stopAll();
  }
  await take({ notes: V });
  const b = play(60, 1, 300, 500);
  until(2, 200); edit();
  until(2, 300); api.noteOn(62, 0.8, 0, sim.ms);
  until(2, 600); undoKey(); await sim.settle(2);
  assert.equal(vOf(), 90, 'the key went down after the edit: the first press drops the held note only');
  until(2, 800); api.noteOff(62, 0, sim.ms);
  assert.deepEqual(notesOf(), [[40, 1800, 60], [60, b.t, b.d]], 'D4 not recorded');
  undoKey(); await sim.settle(2);
  assert.deepEqual([vOf(), notesOf()], [50, [[40, 1800, 60], [60, b.t, b.d]]], 'the next press: the edit');
  await stopAll();
});

// R-4 (follow-up): a re-anchor in the last moments of a pass (its anchor made ≈ 50 ms ahead — already in the next pass —
// while the old line is still heard: a tempo set again, the restore of a Ctrl+Z) is no seek: the wrap still sweeps the
// tail in the old pass's step
test('R-4 (follow-up) Replace: a tempo change or an undo just before the loop end still sweeps the tail into that pass\'s own step (one step, one undo restores it)', async () => {
  const tail = [1, 3, 7, 12, 20, 30, 45].map((k, i) => ({ id: 'z' + i, t: LOOP - k, d: 1, n: 40 + i }));
  for (const how of ['early', 'tempo', 'undo']) {
    await take({ mode: 'replace', notes: tail.concat([{ id: 'V', t: 1000, d: 1, n: 70, take: 'mine' }]) });
    TR().notes.find(x => x.id === 'V').take = Tx().take; // (the take's own: never swept)
    const n0 = cv.hist.u.length;
    play(60, 1, 300, 700);
    if (how === 'undo') { until(1, 1750); api.roll().host.edit('Velocity', () => { TR().notes.find(x => x.id === 'V').v = 90; }); }
    until(1, how === 'early' ? 1000 : 1800);
    if (how === 'undo') undoKey(); else cv.setProjectBpm(240);
    until(2, 1000);
    await stopAll();
    assert.deepEqual(cv.hist.u.slice(n0).map(e => e.label), ['Record pass 1'], how + ': one step');
    cv.undo(); await settle();
    assert.deepEqual(notesOf().filter(x => x[0] !== 70), tail.map(x => [x.n, x.t, x.d]), how + ': one undo — every tail note back, the take gone');
  }
});

// R-8 (follow-up): the pass resumes its own step whenever that step is the newest again by identity — after an undo, a redo
// and an undo of a mid-pass edit, after two mid-pass edits both undone (T.step was left −1 by the first), and after a roll
// gesture's step undone (R-6: a note recorded during it had cleared T.step)
test('R-8 (follow-up) Ctrl+Z, Ctrl+Shift+Z, Ctrl+Z of a mid-pass edit, two mid-pass edits both undone, a roll drag (a note recorded during it) undone: the pass carries on in its one step', async () => {
  const V = [{ id: 'V', t: 1800, d: 60, n: 40, v: 50 }], setV = v => api.roll().host.edit('Velocity', () => { TR().notes.find(x => x.id === 'V').v = v; });
  const drag = () => {
    const h = api.roll().host, x = TR().notes.find(o => o.id === 'V');
    h.beginEdit(); x.t = 1500; h.changed();
    play(61, 1, 500, 600); // (joins the drag's step)
    x.t = 1200; h.changed(); h.endEdit();
    undoKey();
  };
  const cases = { urU: () => { setV(90); undoKey(); redoKey(); undoKey(); }, two: () => { setV(90); setV(110); undoKey(); undoKey(); }, drag };
  for (const [k, f] of Object.entries(cases)) {
    await take({ notes: V });
    const n0 = cv.hist.u.length;
    play(60, 1, 200, 400);
    f(); await sim.settle(2);
    assert.equal(TR().notes.find(x => x.id === 'V').v, 50, k + ': the edits undone');
    play(62, 1, 800, 1000);
    assert.equal(cv.hist.r.length, 0, k + ': the undone edit no longer redoable');
    await stopAll();
    assert.deepEqual(cv.hist.u.slice(n0).map(e => e.label), ['Record pass 1'], k + ': one step');
    cv.undo(); await settle();
    assert.deepEqual(notesOf(), [[40, 1800, 60]], k + ': one undo — pass 1 gone');
  }
});

// R-15 (follow-up): an MPE track — a live key on another channel holds a voice of its own (the engine keys it by channel and
// pitch): a song note of that pitch deleted while both sound ends the song's voice; the key's voice ends with the key
test('R-15 (follow-up) MPE: a song note deleted while a live MPE key (channel 2) holds its pitch ends the song\'s voice; nothing left sounding after the key is up', async () => {
  await stopAll();
  const t = api.addTrack(MODELS.find(m => m.id === 'serum')); sim.raf(); await sim.settle(10); sim.raf();
  api.selectTrack(t.id); sim.raf(); await sim.settle(5);
  api.sxHost(t).edit(st => { st.global.mpe.on = 1; }, { label: 'mpe' }); sim.raf(); await sim.settle(5); sim.run(4096);
  const pr = sim.nodeOf(t.id).proc, vs = () => (pr.insts && pr.insts[0] && pr.insts[0].voices) || [];
  const gated = () => JSON.stringify(Array.from(vs()).filter(v => v.gate).map(v => [v.note, v.ch | 0]).sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  const T1 = TR();
  T1.notes = [{ id: 'L', t: 0, d: 6000, n: 62, v: 100 }]; T1.cc = [];
  for (const x of P().tracks) x.arm = false;
  P().bpm = 240; P().metronome.countIn = 0; P().metronome.on = false; P().loop.on = false;
  api.roll().host.changed(); await debounce();
  Tx().pos = 0; wraps = 0; lastT = -Infinity;
  sim.$('#tPlay').click(); await sim.settle(5);
  until(1, 500); api.noteOn(62, 0.8, 2, sim.ms); // (a MIDI key on channel 2: {t: 'on', n: 62, ch: 2})
  until(1, 700);
  assert.equal(gated(), '[[62,0],[62,2]]', 'the song\'s voice and the key\'s');
  api.roll().host.edit('Delete', () => { TR().notes = []; }); await debounce();
  const held = rmsIn(1, 800, 950);
  assert.ok(held > 0.01, 'the key sounds on: ' + held);
  assert.equal(gated(), '[[62,2]]', 'the song\'s voice ended, the key\'s kept');
  until(1, 1000); api.noteOff(62, 2, sim.ms);
  until(1, 1600);
  assert.equal(gated(), '[]', 'the key up: nothing gated');
  const late = rmsIn(1, 2000, 2600);
  assert.ok(late < held * 0.02, 'silent: ' + late);
  sim.$('#tPlay').click(); await settle();
});

/* ---- the fix check's residuals (lane A, round 3) ---- */

// R-15 (residual): with input quantize every pass's C4 starts on the downbeat — pass 2's long C4 replaced pass 1's short one at
// the same (pitch, start): Ctrl+Z of pass 2 while it sounds restores the short one, and the sounding note ends at its end
// (already passed: at once; still ahead: there, sounding until then) — the control without input quantize (other starts)
test('R-15 (residual) input quantize: Ctrl+Z of a pass whose long note took over the same pitch and start ends the sounding note at the restored note\'s end — at once when passed, else there', async () => {
  api.selectTrack(P().tracks[0].id); sim.raf(); await sim.settle(5); // (the track before the MPE test's Serum)
  for (const [iq, at] of [[false, 1000], [true, 1000], [true, 300]]) {
    const k = (iq ? 'IQ' : 'control') + ' @' + at;
    await take({ iq });
    play(60, 1, 30, 600); await debounce();
    const n1 = notesOf();
    play(60, 2, 90, 1700); await debounce();
    if (iq) assert.deepEqual(notesOf().map(x => x.slice(0, 2)), [[60, 0]], k + ': pass 2\'s C4 on the downbeat (pass 1\'s deleted)');
    const on = rmsIn(3, 200, 280);
    assert.ok(on > 0.02, k + ': pass 2\'s C4 sounds in pass 3: ' + on);
    until(3, at); undoKey(); await sim.settle(2);
    assert.deepEqual([notesOf(), Tx().rec], [n1, true], k + ': pass 2 undone (pass 1\'s C4 back), still recording');
    const end = n1[0][1] + n1[0][2];
    if (at < end) { const mid = rmsIn(3, at + 50, end - 50); assert.ok(mid > on * 0.5, k + ': the restored C4 sounds on until its end: ' + mid + ' vs ' + on); }
    const off = rmsIn(3, Math.max(at, end) + 300, Math.max(at, end) + 550);
    assert.ok(off < on * 0.02, k + ': silent after the restored C4\'s end (' + end + '): ' + off + ' vs ' + on);
    await stopAll();
  }
  // playing only: a long song C4 shortened under the playhead — to an end still ahead: it ends there; to one already passed
  // while the player holds C4 live: a note gone (R-15's rule) — the key's voice carries on until the key is up
  for (const [to, live] of [[1200, false], [600, true]]) {
    const k = 'shortened to ' + to + (live ? ', the key held' : '');
    TR().notes = [{ id: 'L', t: 0, d: 3000, n: 60, v: 100 }]; TR().cc = [];
    api.roll().host.changed(); await debounce();
    P().loop.on = false; Tx().pos = 0; wraps = 0; lastT = -Infinity;
    sim.$('#tPlay').click(); await sim.settle(5);
    until(1, 500); if (live) api.noteOn(60, 0.8, 0, sim.ms);
    until(1, 700); api.roll().host.edit('Length', () => { TR().notes[0].d = to; }); await debounce();
    const on = rmsIn(1, 800, 1100);
    assert.ok(on > 0.02, k + ': sounds on: ' + on);
    if (live) { const held = rmsIn(1, 1500, 1800); assert.ok(held > on * 0.5, k + ': the key\'s voice carries on: ' + held + ' vs ' + on); until(1, 1900); api.noteOff(60, 0, sim.ms); }
    const off = live ? rmsIn(1, 2300, 2600) : rmsIn(1, 1500, 1800);
    assert.ok(off < on * 0.02, k + ': silent after its end' + (live ? ' and the key' : '') + ': ' + off + ' vs ' + on);
    sim.$('#tPlay').click(); await settle();
  }
});

// R-8 (residual): a pass whose later notes recorded a second "Record pass N" on top of an edit (or of a roll drag that took a
// note) — Ctrl+Z twice (that step, the edit) makes the pass's first step the newest again: the pass carries on in it, as after
// any undone edit (IMPL-R §2); the undone steps leave redo
test('R-8 (residual) a pass with a second step (a roll edit, or a drag recording a note, between its notes): Ctrl+Z twice back to its first step — the pass carries on in it (one step, one undo takes the pass back)', async () => {
  const V = [{ id: 'V', t: 1800, d: 60, n: 40, v: 50 }], x = () => TR().notes.find(o => o.id === 'V');
  const cases = {
    edit: () => api.roll().host.edit('Velocity', () => { x().v = 90; }),
    drag: () => { const h = api.roll().host; h.beginEdit(); x().t = 1500; h.changed(); play(61, 1, 400, 450); x().t = 1200; h.changed(); h.endEdit(); },
  };
  for (const [k, f] of Object.entries(cases)) {
    await take({ notes: V });
    const n0 = cv.hist.u.length;
    const c = play(60, 1, 200, 300);
    f();
    play(64, 1, 600, 700);
    const L = cv.hist.u.slice(n0).map(e => e.label);
    assert.deepEqual([L.length, L[0], L[2]], [3, 'Record pass 1', 'Record pass 1'], k + ': the pass\'s two steps, the edit between');
    undoKey(); await sim.settle(2); undoKey(); await sim.settle(2);
    assert.deepEqual([x().v, x().t, notesOf()], [50, 1800, [[40, 1800, 60], [60, c.t, c.d]]], k + ': back to the pass\'s first step');
    play(62, 1, 1000, 1100);
    assert.equal(cv.hist.r.length, 0, k + ': the undone steps no longer redoable');
    await stopAll();
    assert.deepEqual(cv.hist.u.slice(n0).map(e => e.label), ['Record pass 1'], k + ': one step');
    cv.undo(); await settle();
    assert.deepEqual(notesOf(), [[40, 1800, 60]], k + ': one undo — pass 1 gone');
  }
});

// R-2 (residual): a step that changed nothing (an edit with no change, the roll's Q on notes already on the grid) recorded
// after the held key went down is no step for undo — History.undo skips it —: Ctrl+Z / the toolbar still drop the held note
// alone (pass 1 kept, nothing restored), the next notes are pass 2's own step, and the undo after skips the no-op step too
test('R-2 (residual) a no-op step after the held key went down (an edit that changed nothing, the roll\'s Q with nothing to move): Ctrl+Z / the toolbar drop the held note alone, the pass before kept', async () => {
  const V = [{ id: 'V', t: 1800, d: 60, n: 40, v: 50 }];
  for (const how of ['key', 'bar']) {
    await take({ notes: V });
    const a = play(60, 1, 300, 500);
    until(2, 300); api.noteOn(62, 0.8, 0, sim.ms);
    until(2, 400); api.roll().host.edit('Quantize', () => {}); // (changed nothing)
    until(2, 600); if (how === 'key') undoKey(); else sim.$('#tUndo').onclick({ type: 'click' }); await sim.settle(2);
    assert.deepEqual([notesOf(), cv.hist.r.length, Tx().rec], [[[40, 1800, 60], [60, a.t, a.d]], 0, true], how + ': the held D4 dropped alone — pass 1 kept, nothing restored');
    until(2, 800); api.noteOff(62, 0, sim.ms);
    const b = play(64, 2, 1000, 1100);
    await stopAll();
    assert.deepEqual(notesOf(), [[40, 1800, 60], [60, a.t, a.d], [64, b.t, b.d]], how + ': D4 not recorded, E4 recorded');
    undoKey(); await settle();
    assert.deepEqual(notesOf(), [[40, 1800, 60], [60, a.t, a.d]], how + ': undo 1 — pass 2');
    undoKey(); await settle();
    assert.deepEqual(notesOf(), [[40, 1800, 60]], how + ': undo 2 — pass 1 (the no-op step skipped)');
  }
  // the real path: the roll open, input quantize on (the recorded starts on the grid), its Q (Quantize all) while a MIDI key
  // (channel 1) is held
  cv.openTab('roll'); await settle();
  await take({ iq: true });
  Object.assign(P().quantize, { grid: 240, strength: 100, starts: true, ends: false, swing: 0 });
  play(60, 1, 300, 500);
  const n1 = notesOf();
  until(2, 300); api.noteOn(62, 0.8, 1, sim.ms);
  const h0 = cv.hist.u.length;
  until(2, 400); sim.key('KeyQ', true, { key: 'q' }); sim.key('KeyQ', false, { key: 'q' });
  assert.deepEqual([cv.hist.u.length - h0, notesOf()], [1, n1], 'Q: a step that moved nothing');
  until(2, 600); undoKey(); await sim.settle(2);
  assert.deepEqual([notesOf(), cv.hist.r.length], [n1, 0], 'Ctrl+Z: the held MIDI D4 dropped alone, pass 1 kept');
  until(2, 800); api.noteOff(62, 1, sim.ms);
  const b = play(64, 2, 1000, 1100);
  await stopAll();
  assert.deepEqual(notesOf().map(x => x[0]), [60, 64], 'D4 not recorded, E4 recorded');
  assert.equal(b.d > 0, true);
  undoKey(); await settle(); undoKey(); await settle();
  assert.deepEqual(notesOf(), [], 'two undos: pass 2, then pass 1');
});

after(() => clearInterval(alive));
