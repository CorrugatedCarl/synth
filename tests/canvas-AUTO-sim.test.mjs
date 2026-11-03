import './v8-guard.mjs';
// Stage AUTO (docs/canvas/IMPL-AUTO.md §3, §4, §7, §9 G3 / G4): automation recording and playback in the page simulation with the real
// engine — written in phase 0 (lane P0H) as FAILING tests against §10.2's names (S.normAuto / autoAt / autoWrite / autoThin / autoKeys)
// and __synthTest.cv.auto (§13 "Phase 0 H": its shapes); lane H1 makes the G3 ones pass, H2 the G4 bounce ones. A grab is what the
// faces do: a capture-phase pointerdown on the document from a control's element (data-dest on the widget; data-dev on a classic
// panel, the module's data-cv-mod on a rig / kit face), the release a pointerup / pointercancel on the window by pointerId; the knob's
// value moves through its family's model (the polling, §3.2, reads it there); the fader through its own input. Chromium's clock (o.clock
// 'std', the heard tick exact). 240 BPM, a loop of two beats (half a second a pass), ≤ 2 bars of song a test: the sim stores every
// posted message. One boot; strings, numbers and booleans only into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/canvas-AUTO-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as S from '../song.js?v=9';
import * as C from '../serum-core.js?v=9';
import * as CM from '../cv-mods.js?v=9';
import * as CMG from '../cv-migrate.js?v=9';
import * as CMOD from '../cv-model.js?v=9';
import * as KC from '../kit-core.js?v=9';
import { RIG } from '../rig-core.js?v=9';

const alive = setInterval(() => {}, 50); // (the sim's timers are unref'd: a ref'd one keeps the process up through the top-level setup)
const sim = await bootMain({ ls: fakeStorage({}), clock: 'std', outLat: 0.03 });
const api = sim.api, cv = globalThis.__synthTest.cv, A = cv.auto;
await sim.power(); await sim.settle(20);
sim.$('#modal').hidden = true;
const P = () => api.project(), Tx = () => api.transport(), byId = id => P().tracks.find(t => t.id === id);
const settle = async (n = 3) => { for (let i = 0; i < n; i++) { sim.raf(); await sim.settle(3); } };
const ID = { m: P().tracks[0].id, r: api.addTrack(RIG.ID).id, k: api.addTrack(KC.KIT.ID).id };
await settle();
api.selectTrack(ID.r); await settle();
cv.fx.addEffect('i1/fx', 'rev'); await settle();
api.selectTrack(ID.m); await settle();
clearInterval(alive);
const LOOP = 1920, BAR = 3840;
const dev = id => CMOD.instOf(byId(id), 'i1');
// (P0M lands the real ones: song.js autoAt — linear between points, flat outside, undefined for none)
const autoAt = typeof S.autoAt === 'function' ? S.autoAt : (pts, x) => {
  if (!pts || !pts.length) return undefined;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [a, u] = pts[i - 1], [b, w] = pts[i]; return u + (w - u) * (x - a) / (b - a); }
  return pts[pts.length - 1][1];
};
const ptsOf = (tid, key) => { const t = byId(tid), a = t && t.auto; return a && a[key] && Array.isArray(a[key].pts) ? a[key].pts : null; };
const near = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;

// the transport as canvas-R-sim's: the song on, a frame (rAF) every 6 quanta (16 ms), until the heard tick is past `to` of loop pass `pass`
let wraps = 0, lastT = -Infinity;
function until(pass, to) {
  for (let q = 0; q < 400000; q++) {
    const t = api.curTick();
    if (t < lastT - 1) wraps++;
    lastT = t;
    if (wraps + 1 > pass || (wraps + 1 === pass && t >= to)) return t;
    sim.run(128); if (q % 6 === 5) sim.raf();
  }
  throw new Error('never reached pass ' + pass + ' tick ' + to);
}
// a take on the Minimoog track: record (●) on, 240 BPM, the loop (or none), no count-in, no notes; or (o.play) plain playback
async function take(o = {}) {
  await stopAll();
  const p = P(), t = byId(ID.m);
  t.notes = []; t.cc = [];
  for (const x of p.tracks) x.arm = x === t;
  p.bpm = o.bpm || 240; p.metronome.countIn = 0; p.metronome.on = false; p.rec.mode = 'overdub';
  Object.assign(p.loop, o.loop === false ? { on: false } : { on: true, start: 0, end: o.le || LOOP });
  Tx().pos = 0; wraps = 0; lastT = -Infinity;
  sim.$(o.play ? '#tPlay' : '#tRec').click(); await sim.settle(5);
  assert.deepEqual([Tx().playing, Tx().rec], [true, !o.play], o.play ? 'playing' : 'recording');
  return t;
}
async function stopAll() { if (Tx().rec) sim.$('#tRec').click(); if (Tx().playing) sim.$('#tPlay').click(); await settle(); }
const undoKey = () => { sim.key('KeyZ', true, { key: 'z', ctrlKey: true }); sim.key('KeyZ', false, { key: 'z', ctrlKey: true }); };
const labels = k => cv.hist.u.slice(-k).map(e => e.label);

// a control's element as the faces render it: the widget's data-dest, the classic panel's data-dev or the face module's data-cv-mod
// (rig-ui / kit-ui set no data-dev); closest() answers the [attr] / [attr="v"] selectors (comma lists too) by walking parentNode
function ctlEl(dev0, dest, mod) {
  const D = globalThis.document, root = D.createElement('div'), el = D.createElement('div');
  if (mod) root.setAttribute('data-cv-mod', mod); else root.setAttribute('data-dev', dev0);
  el.setAttribute('data-dest', dest); root.append(el);
  const one = (n, s) => { const m = /^\s*\[([\w-]+)(?:="([^"]*)")?\]\s*$/.exec(s); return !!m && n.getAttribute(m[1]) != null && (m[2] === undefined || n.getAttribute(m[1]) === m[2]); };
  const closest = function (sel) { for (let n = this; n && typeof n.getAttribute === 'function'; n = n.parentNode) if (String(sel).split(',').some(s => one(n, s))) return n; return null; };
  el.closest = closest; root.closest = closest;
  return el;
}
let PID = 40;
const pev = (type, target, pointerId, extra) => Object.assign({ type, target, currentTarget: target, pointerId, button: 0, buttons: type === 'pointerdown' ? 1 : 0, pointerType: 'touch',
  isPrimary: true, clientX: 200, clientY: 200, timeStamp: performance.now(), defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, stopImmediatePropagation() {} }, extra || {});
// a finger on el → its pointerId (the document's capture listeners, then el's own: the mixer's inputs register theirs)
function grab(el) {
  const id = ++PID, e = pev('pointerdown', el, id);
  for (const f of (sim.dom.docL.pointerdown || []).slice()) f(e);
  el.dispatchEvent(e);
  return id;
}
// the finger lifted (o.gesture 'two-finger': gesture.js's synthetic pointercancel — the drop)
function release(el, id, o = {}) {
  const type = o.gesture ? 'pointercancel' : 'pointerup', e = pev(type, el, id, o.gesture ? { gesture: o.gesture } : null);
  for (const f of (sim.dom.winL[type] || []).slice()) f(e);
}
// the knob's value moved as its face moves it — the family's model (classic / kit vals, the rig's s.p, the effect's p)
function setBase(tid, key, v) {
  const d = dev(tid), id = key.slice(key.indexOf(':') + 1);
  if (/^fx\./.test(id)) { const [, inst, pid] = id.split('.'); d.fx.racks.flatMap(r => r.mods).find(m => m.id === inst).p[pid] = v; }
  else if (d.vals && d.vals.s) C.setDestBase(d.vals.s, d.fx, id, v);
  else d.vals[id] = v;
}
// the track head's fader / pan input (renderHeads' .hvol / .hpan) of track tid
function headInput(tid, cls) {
  const walk = n => { if (!n || typeof n !== 'object') return null; if (n.className === cls) return n; for (const c of n.children || []) { const x = walk(c); if (x) return x; } return null; };
  const row = (sim.$('#heads').children || []).find(r => r.dataset && r.dataset.id === tid);
  return walk(row);
}
// a held knob turned between two heard positions: base = f(tick) every frame (pass pa tick a → pass pb tick b)
function turn(tid, key, f, pa, a, pb, b) {
  let t = until(pa, a);
  for (let guard = 0; guard < 4000; guard++) {
    setBase(tid, key, f(t));
    for (let q = 0; q < 6; q++) sim.run(128);
    sim.raf();
    const t1 = api.curTick();
    if (t1 < lastT - 1) wraps++;
    lastT = t1; t = t1;
    if (wraps + 1 > pb || (wraps + 1 === pb && t >= b)) return;
  }
}
// the finger down on el at pass pa tick a, the knob turned by f to pass pb tick b (still held) → its pointerId
function hold(el, tid, key, f, pa, a, pb, b) { until(pa, a); const id = grab(el); turn(tid, key, f, pa, a, pb, b); return id; }
const MOOG_FC = 'i1:fc';
const up1 = x => 2 + x / 400, down2 = x => 9 - x / 300; // (pass 1's move, pass 2's: told apart at any tick)

/* ================================================================================================ G3 */

// G3
test('G3 a take with a classic knob held over two loop passes → points in pass order, one step per pass ("Record pass 1", "Record pass 2"); undo drops the pass\'s points (and Ctrl+Z while held ends the gesture), redo brings them back', async () => {
  A.set(ID.m, MOOG_FC, null);
  await take();
  const el = ctlEl('i1', 'fc'), n0 = cv.hist.u.length;
  until(1, 200);
  const id = grab(el);
  assert.deepEqual(A.held(), [[ID.m, MOOG_FC]], 'held by the track from the grab');
  turn(ID.m, MOOG_FC, up1, 1, 200, 2, 0);
  turn(ID.m, MOOG_FC, down2, 2, 0, 2, 1000);
  release(el, id);
  until(2, 1500);
  await stopAll();
  const pts = ptsOf(ID.m, MOOG_FC);
  assert.ok(pts && pts.length > 2, 'a curve recorded');
  assert.deepEqual([cv.hist.u.length - n0, labels(2)], [2, ['Record pass 1', 'Record pass 2']], 'one step per pass');
  assert.ok(near(autoAt(pts, 500), down2(500), 0.3), 'pass 2 overwrote pass 1 where it moved: ' + autoAt(pts, 500));
  cv.undo(); await settle();
  const p1 = ptsOf(ID.m, MOOG_FC);
  assert.ok(p1 && near(autoAt(p1, 1200), up1(1200), 0.3), 'undo: pass 1\'s points (' + (p1 && autoAt(p1, 1200)) + ')');
  cv.redo(); await settle();
  assert.ok(near(autoAt(ptsOf(ID.m, MOOG_FC), 500), down2(500), 0.3), 'redo: pass 2\'s back');
  await take();
  const id2 = hold(el, ID.m, MOOG_FC, up1, 1, 300, 1, 900);
  undoKey(); await sim.settle(2);
  assert.deepEqual([A.held(), Tx().rec], [[], true], 'Ctrl+Z while held: the gesture ended, recording carries on');
  release(el, id2);
  await stopAll();
});

// G3
test('G3 the latch: after the release the released value holds, flat, to the pass\'s end, closed there by a jump pair back to the old curve ([le − 1, v], [le, old(le)]); the old curve before the grab and in the next pass untouched', async () => {
  const old = [[0, 0], [2 * BAR, 10]]; // (old(t) = t / 768)
  A.set(ID.m, MOOG_FC, old);
  await take();
  const el = ctlEl('i1', 'fc'), id = hold(el, ID.m, MOOG_FC, () => 8, 1, 300, 1, 600);
  release(el, id);
  until(2, 400);
  await stopAll();
  const pts = ptsOf(ID.m, MOOG_FC), o = x => autoAt(old, x);
  assert.ok(pts, 'a curve');
  assert.deepEqual([near(autoAt(pts, 1000), 8, 1e-6), near(autoAt(pts, LOOP - 1), 8, 1e-6)], [true, true], 'flat at the released value to the loop end');
  assert.deepEqual(pts.filter(p => p[0] === LOOP - 1 || p[0] === LOOP).map(p => [p[0], Math.round(p[1] * 1e3) / 1e3]), [[LOOP - 1, 8], [LOOP, Math.round(o(LOOP) * 1e3) / 1e3]], 'the jump pair');
  assert.deepEqual([near(autoAt(pts, 100), o(100), 1e-3), near(autoAt(pts, 3000), o(3000), 1e-3)], [true, true], 'before the grab and past the loop: the old curve');
});

// G3
test('G3 a gesture across the wrap: committed up to the loop end in pass 1\'s step, continued from the loop start in pass 2\'s (as recAdv does for held notes)', async () => {
  A.set(ID.m, MOOG_FC, null);
  await take();
  const el = ctlEl('i1', 'fc'), id = hold(el, ID.m, MOOG_FC, up1, 1, 1500, 2, 0);
  turn(ID.m, MOOG_FC, down2, 2, 0, 2, 400);
  release(el, id);
  until(2, 600);
  await stopAll();
  const pts = ptsOf(ID.m, MOOG_FC);
  assert.ok(pts, 'a curve');
  assert.deepEqual(labels(2), ['Record pass 1', 'Record pass 2']);
  assert.ok(near(autoAt(pts, 200), down2(200), 0.3), 'pass 2 from the loop start');
  cv.undo(); await settle();
  const p1 = ptsOf(ID.m, MOOG_FC);
  assert.ok(p1 && near(autoAt(p1, 1800), up1(1800), 0.3) && near(autoAt(p1, LOOP - 1), up1(LOOP - 1), 0.4), 'undo pass 2: pass 1\'s part, up to the loop end');
});

// G3
test('G3 the two-finger drop: a gesture released by gesture.js\'s two-finger pointercancel leaves the curve as it was at the grab — no latch, no override, no History step', async () => {
  const old = [[0, 3], [LOOP, 6]];
  A.set(ID.m, MOOG_FC, old);
  await take();
  const n0 = cv.hist.u.length, el = ctlEl('i1', 'fc'), id = hold(el, ID.m, MOOG_FC, () => 9, 1, 300, 1, 800);
  assert.notEqual(JSON.stringify(ptsOf(ID.m, MOOG_FC)), JSON.stringify(old), 'written while held');
  release(el, id, { gesture: 'two-finger' });
  until(1, 1600);
  await stopAll();
  assert.deepEqual([JSON.stringify(ptsOf(ID.m, MOOG_FC)) === JSON.stringify(old), cv.hist.u.length - n0, A.override()], [true, 0, []], 'the points back, no step, no override');
});

// G3
test('G3 a press without a move makes nothing: the key is held from the grab to the release, but no point, no step, no latch', async () => {
  A.set(ID.m, MOOG_FC, null);
  await take();
  const n0 = cv.hist.u.length, el = ctlEl('i1', 'fc');
  until(1, 300);
  const id = grab(el);
  assert.deepEqual(A.held(), [[ID.m, MOOG_FC]], 'held');
  until(1, 900);
  release(el, id);
  assert.deepEqual(A.held(), [], 'released');
  until(1, 1500);
  await stopAll();
  assert.deepEqual([ptsOf(ID.m, MOOG_FC), cv.hist.u.length - n0], [null, 0]);
});

// G3
test('G3 a rig knob (f.cutoff), an FX knob (the rig\'s Reverb size), a kit knob (the kick\'s decay) and the fader the same: each its own curve on its own track (no arm needed), the pass\'s step', async () => {
  const keys = [[ID.r, 'i1:f.cutoff', 'i1/filter', x => 0.2 + x / 4000], [ID.r, 'i1:fx.rev.size', 'i1/fx', x => 0.9 - x / 4000], [ID.k, 'i1:kad', 'i1/ka', x => 1 + x / 400]];
  for (const [tid, key] of keys) A.set(tid, key, null);
  A.set(ID.m, 'mix:vol', null);
  await take();
  for (const [tid, key, mod, f] of keys) {
    api.selectTrack(tid); // (H1: a face on the canvas is the shown track's — the grab resolves its key there)
    const el = ctlEl('i1', key.slice(3), mod), id = hold(el, tid, key, f, 1, 200, 1, 700);
    release(el, id);
    await take();
  }
  api.selectTrack(ID.m); await settle();
  const fader = headInput(ID.m, 'hvol');
  assert.ok(fader, 'the Minimoog\'s fader');
  let t = until(1, 200);
  const id = grab(fader);
  while (t < 700) { fader.value = String(0.3 + t / 2000); fader.oninput(); for (let q = 0; q < 6; q++) sim.run(128); sim.raf(); t = api.curTick(); }
  release(fader, id);
  await stopAll();
  for (const [tid, key, , f] of keys) { const pts = ptsOf(tid, key); assert.ok(pts && near(autoAt(pts, 500), f(500), 0.05), key + ': its curve (' + (pts && autoAt(pts, 500)) + ')'); }
  const v = ptsOf(ID.m, 'mix:vol');
  assert.ok(v && near(autoAt(v, 500), 0.55, 0.05), 'mix:vol: the fader\'s curve');
});

// G3
test('G3 AUTO arm off (#tAuto, aria-pressed, remembered in settings.autoArm) → a held knob during a take writes nothing and overrides nothing; on again → the same move writes', async () => {
  A.set(ID.m, MOOG_FC, null);
  const arm = sim.$('#tAuto');
  assert.equal(arm.getAttribute('aria-pressed'), 'true', 'lit by default');
  arm.click(); await settle();
  assert.deepEqual([arm.getAttribute('aria-pressed'), api.settings().autoArm], ['false', false], 'off, remembered');
  await take();
  const el = ctlEl('i1', 'fc'), id = hold(el, ID.m, MOOG_FC, up1, 1, 300, 1, 900);
  release(el, id);
  await stopAll();
  assert.deepEqual([ptsOf(ID.m, MOOG_FC), A.override()], [null, []], 'nothing written, no override');
  arm.click(); await settle();
  await take();
  const id2 = hold(el, ID.m, MOOG_FC, up1, 1, 300, 1, 900);
  release(el, id2);
  await stopAll();
  assert.ok(ptsOf(ID.m, MOOG_FC), 'armed: written');
});

// G3
test('G3 override (record off): a grab, a wheel (a base change without one) and a MIDI-learned CC (a rig base written as midi.js writeCC does) each override their key — playback skips it, the base stays the user\'s —; ↺ (#tAutoRe) re-enables every one, the next frames follow the curves again', async () => {
  const ramp = [[0, 1], [LOOP, 9]];
  A.set(ID.m, MOOG_FC, ramp); A.set(ID.m, 'i1:em', [[0, 2], [LOOP, 8]]); A.set(ID.r, 'i1:f.cutoff', [[0, 0.1], [LOOP, 0.9]]);
  await take({ play: true });
  const el = ctlEl('i1', 'fc'), id = hold(el, ID.m, MOOG_FC, () => 5, 1, 400, 1, 700);
  release(el, id);
  dev(ID.m).vals.em = 0.5; // (a wheel on EMPHASIS)
  setBase(ID.r, 'i1:f.cutoff', 0.33); // (a learned CC)
  until(1, 1400);
  const ov = A.override().map(x => x.join('|')).sort();
  assert.deepEqual(ov, [ID.m + '|i1:em', ID.m + '|i1:fc', ID.r + '|i1:f.cutoff'].sort(), 'three overrides');
  assert.deepEqual([dev(ID.m).vals.fc, dev(ID.m).vals.em, A.get(ID.r, 'i1:f.cutoff')], [5, 0.5, 0.33], 'the user\'s values stay');
  const re = sim.$('#tAutoRe');
  re.click();
  until(1, 1700);
  assert.deepEqual(A.override(), [], 're-enabled');
  assert.ok(near(dev(ID.m).vals.fc, autoAt(ramp, A.renderTick()), 0.6), 'the curve again (' + dev(ID.m).vals.fc + ')');
  await stopAll();
  A.set(ID.m, 'i1:em', null); A.set(ID.r, 'i1:f.cutoff', null);
});

// G3
test('G3 playback: the Minimoog\'s base follows its curve at the render tick and the node\'s posted patch carries it (its vcf field as the model\'s)', async () => {
  const ramp = [[0, 0], [LOOP, 10]];
  A.set(ID.m, MOOG_FC, ramp);
  await take({ play: true });
  const N = sim.nodeOf(ID.m), field = CM.targetsOf('minimoog', 'fc')[0].field.split('.'), get = p => field.reduce((o, k) => (o ? o[k] : undefined), p);
  const seen = [];
  for (const x of [400, 900, 1400]) {
    until(1, x); sim.raf();
    const rt = A.renderTick(), v = dev(ID.m).vals.fc, last = N.posted.map(e => e.m).filter(m => m.t === 'patch').pop();
    seen.push([near(v, autoAt(ramp, rt), 10 / LOOP * (S.PPQ * 4 * (1 / 60 + 128 / sim.ctx().sampleRate)) + 1e-6), !!last && near(get(last.p), get(CM.patchOf('minimoog', dev(ID.m).vals)), 1e-9)]);
  }
  await stopAll();
  assert.deepEqual(seen, [[true, true], [true, true], [true, true]], 'base on the curve; the patch posted with it');
  A.set(ID.m, MOOG_FC, null);
});

// G3
test('G3 save → load: every track\'s auto identical (the classic, the rig, the FX knob, the kit, the mixer)', () => {
  const want = { [ID.m]: { 'i1:fc': [[0, 1], [960, 7.5]], 'mix:vol': [[0, 0.8], [1920, 0.2]], 'mix:pan': [[100, -1], [101, 1]] }, [ID.r]: { 'i1:f.cutoff': [[0, 0.25]], 'i1:fx.rev.size': [[0, 0.5], [3840, 1]] }, [ID.k]: { 'i1:kad': [[480, 2], [960, 8]] } };
  for (const [tid, o] of Object.entries(want)) for (const [k, pts] of Object.entries(o)) A.set(tid, k, pts);
  const p2 = cv.loadProject(JSON.stringify(P()));
  for (const tid of Object.keys(want)) {
    const t2 = p2.tracks.find(x => x.id === tid);
    assert.equal(JSON.stringify(t2 && t2.auto), JSON.stringify(byId(tid).auto), tid + ': its auto');
  }
  for (const [tid, o] of Object.entries(want)) for (const k of Object.keys(o)) A.set(tid, k, null);
});

// G3
test('G3 schema 19 (§2.4): SCHEMA 19, one more STEPS entry; an 18 file opens (no auto added), a 20 file opens read-only (the "19 in an 18 build" rule, one schema on)', () => {
  assert.deepEqual([CMG.SCHEMA, CMG.STEPS.length], [19, 19]);
  const u = CMG.upgrade({ name: 'A', schema: 18, uid: 'p_auto000001', perf: { wheel: null }, tracks: [] });
  assert.deepEqual([u.p.schema, u.readOnly], [19, false]);
  const n = CMG.upgrade({ name: 'newer', schema: 20, tracks: [] });
  assert.deepEqual([n.readOnly, n.p.schema], [true, 20], 'a newer file: read-only');
});

// G3
test('G3 a project without automation posts exactly ⟨B⟩\'s messages: S.autoKeys of every track empty, and a pass of plain playback posts no patch to any node', async () => {
  assert.equal(typeof S.autoKeys, 'function', 'song.js autoKeys (§10.2)');
  for (const t of P().tracks) assert.deepEqual(S.autoKeys(t), [], t.name + ': no keys');
  await take({ play: true });
  until(1, 100);
  const n0 = sim.posted.length;
  until(1, 1800);
  const patches = sim.posted.slice(n0).filter(x => x.m && x.m.t === 'patch').length;
  await stopAll();
  assert.equal(patches, 0, 'no automation patch');
});

/* ================================================================================================ G4 */

// G4
test('G4 timing at 120 and 240 BPM: every frame the base (and so the posted patch) is on the curve at the render tick within one automation tick (16.7 ms) and one quantum', async () => {
  const ramp = [[0, 0], [BAR, 10]], slope = 10 / BAR;
  for (const bpm of [120, 240]) {
    A.set(ID.m, MOOG_FC, ramp);
    await take({ play: true, bpm, le: BAR });
    const tps = bpm * S.PPQ / 60, tol = slope * tps * (1 / 60 + 128 / sim.ctx().sampleRate) + 1e-6, bad = [];
    for (let f = 0; f < 50; f++) { // (50 frames: 0.8 s — inside one bar at either tempo)
      for (let q = 0; q < 6; q++) sim.run(128);
      sim.raf();
      const rt = A.renderTick(), v = dev(ID.m).vals.fc;
      if (rt > 200 && rt < BAR - 200 && !near(v, autoAt(ramp, rt), tol)) bad.push(Math.round(rt) + ':' + (Math.round(v * 1e3) / 1e3));
    }
    await stopAll();
    assert.deepEqual(bad, [], bpm + ' BPM: off the curve (tick:value), tolerance ' + tol.toFixed(4));
  }
  A.set(ID.m, MOOG_FC, null);
});

// a bounce through the page's dialog (canvas-M-sim's): its fields set explicitly, the render's offline context kept (sim.lastOffline)
async function bounce(set = {}) {
  const st = Object.assign({ range: 'song', sr: '48000', bits: '32', os: '1', tail: '0', norm: 'off' }, set), real = URL.createObjectURL;
  URL.createObjectURL = () => 'blob:sim/1';
  try {
    sim.$('#fBounce').click();
    for (const [k, v] of [['#bRange', st.range], ['#bSr', st.sr], ['#bBits', st.bits], ['#bOs', st.os], ['#bTail', st.tail], ['#bNorm', st.norm]]) sim.$(k).value = v;
    sim.$('#bNorm').checked = false;
    sim.lastOffline = null;
    await sim.$('#bGo').onclick();
    for (let i = 0; i < 40 && !sim.lastOffline; i++) await sim.settle(5);
    return sim.lastOffline;
  } finally { URL.createObjectURL = real; sim.$('#bCancel').onclick(); }
}
// the bounces' song: 2 bars at 240 BPM, the Minimoog alone heard (the rig and the kit muted: the render short), one held note
const song2 = () => { const p = P(); p.bpm = 240; p.bars = 2; p.loop.on = false; for (const t of p.tracks) { t.notes = t.id === ID.m ? [{ id: 'b1', t: 0, d: 2 * BAR - 10, n: 48, v: 100 }] : []; t.mute = t.id !== ID.m; } };
const unsong2 = () => { for (const t of P().tracks) t.mute = false; };

// G4
test('G4 a 2-bar bounce of an automated cutoff: the render suspends at the curve\'s change ticks (the fake\'s ctx.suspends, §7.2) and the Minimoog\'s patch posted at each equals the curve there', async () => {
  song2();
  const ramp = [[0, 1], [BAR, 9], [2 * BAR, 3]];
  A.set(ID.m, MOOG_FC, ramp);
  const off = await bounce();
  A.set(ID.m, MOOG_FC, null); unsong2();
  assert.ok(off, 'rendered');
  const node = off.nodes.find(n => n.po && n.po.trackId === ID.m), sus = off.ctx.suspends || [];
  assert.ok(sus.length >= 2, 'suspends (' + sus.length + ')');
  const field = CM.targetsOf('minimoog', 'fc')[0].field.split('.'), get = p => field.reduce((o, k) => (o ? o[k] : undefined), p);
  const pats = node.posted.map(e => e.m).filter(m => m.t === 'patch'), tps = P().bpm * S.PPQ / 60, bad = [];
  assert.equal(pats.length, sus.length, 'one patch a suspend');
  sus.forEach((s, i) => { const want = get(CM.patchOf('minimoog', Object.assign({}, dev(ID.m).vals, { fc: autoAt(ramp, s * tps) }))); if (!near(get(pats[i].p), want, 1e-9)) bad.push(i); });
  assert.deepEqual(bad, [], 'the patch at every suspend on the curve');
});

// G4
test('G4 the mixer in a bounce: mix:vol as linearRampToValueAtTime on the track\'s gain at the breakpoints — exact in the fake\'s Param timeline (§7.2: param.events [kind, value, time])', async () => {
  song2();
  const vol = [[0, 0.2], [LOOP, 1], [BAR, 0.4]];
  A.set(ID.m, 'mix:vol', vol);
  const off = await bounce();
  A.set(ID.m, 'mix:vol', null); byId(ID.m).vol = 0.8; unsong2();
  const node = off && off.nodes.find(n => n.po && n.po.trackId === ID.m), g = node ? [...node.outs].find(n => n.kind === 'gain') : null;
  const ev = g && Array.isArray(g.gain.events) ? g.gain.events : [], spt = 60 / (240 * S.PPQ);
  assert.deepEqual(ev.filter(e => e[0] === 'ramp').map(e => [Math.round(e[1] * 1e4) / 1e4, Math.round(e[2] * 1e6) / 1e6]), [[1, Math.round(LOOP * spt * 1e6) / 1e6], [0.4, Math.round(BAR * spt * 1e6) / 1e6]], 'the ramps');
});

// G4
test('G4 the bounce probe\'s result (§7.0) recorded in IMPL-AUTO §13: a line of its own, "Probe (§7.0): holds …" or "Probe (§7.0): fallback …"', () => {
  const doc = readFileSync(new URL('../docs/canvas/IMPL-AUTO.md', import.meta.url), 'utf8'), s13 = doc.slice(doc.indexOf('## 13.'), doc.indexOf('## 14.'));
  assert.equal(/^(?:- )?Probe \(§7\.0\): (?:holds|fallback)\b/m.test(s13), true, 'the probe\'s line');
});

/* ================================================================================================ the fix round (§13 "Fix round") */

// audio only, no frame, until the heard tick wraps (the gap between the heard wrap and the frame whose recAdv sees it)
function audioWrap() {
  let last = api.curTick();
  for (let q = 0; q < 400; q++) { sim.run(128); const x = api.curTick(); if (x < last - 1) { wraps++; lastT = x; return x; } last = x; }
  throw new Error('no wrap');
}
const frames = n => { for (let i = 0; i < n; i++) { for (let q = 0; q < 6; q++) sim.run(128); sim.raf(); } };

// fix 1 (R1 P1-1)
test('fix 1: undo / redo, a seek and AUTO off pressed after the heard wrap but before its frame keep the finished pass\'s recording (recAdv first)', async () => {
  const el = ctlEl('i1', 'fc'), res = [];
  for (const act of ['undo', 'seek', 'auto']) {
    A.set(ID.m, MOOG_FC, null);
    await take();
    const id = hold(el, ID.m, MOOG_FC, up1, 1, 600, 1, 1500);
    release(el, id);
    until(1, 1800);
    audioWrap();
    if (act === 'undo') { undoKey(); await sim.settle(1); sim.key('KeyZ', true, { key: 'z', ctrlKey: true, shiftKey: true }); sim.key('KeyZ', false, { key: 'z', ctrlKey: true, shiftKey: true }); await sim.settle(1); }
    else if (act === 'seek') api.roll().host.setPlayhead(100);
    else sim.$('#tAuto').click();
    frames(6);
    await stopAll();
    if (act === 'auto') { sim.$('#tAuto').click(); await settle(); }
    const p = ptsOf(ID.m, MOOG_FC);
    res.push(act + ':' + (p ? Math.round(autoAt(p, 1000) * 100) / 100 : null));
  }
  A.set(ID.m, MOOG_FC, null);
  assert.deepEqual(res, ['undo:' + up1(1000), 'seek:' + up1(1000), 'auto:' + up1(1000)], 'the pass\'s gesture kept (value at 1000)');
});

// fix 2 (R1 P1-2)
test('fix 2: an undo during playback (record off and on) keeps the mixer\'s automated vol / pan live — no override, the fader on its curve', async () => {
  const res = [];
  for (const rec of [false, true]) {
    A.set(ID.m, 'mix:vol', [[0, 0.2], [LOOP, 1.2]]); A.set(ID.m, 'mix:pan', [[0, -0.8], [LOOP, 0.8]]);
    await take({ play: !rec });
    until(1, 300);
    A.edit(ID.m, 'i1:em', 'Automation: Emphasis', () => [[0, 3], [LOOP, 6]]);
    until(1, 700);
    undoKey(); await sim.settle(1);
    until(1, 1200);
    const t = byId(ID.m), rt = A.renderTick(), tol = 1 / LOOP * (S.PPQ * 4 * (1 / 30 + 128 / sim.ctx().sampleRate)) + 1e-6;
    res.push([rec, A.override().length, near(t.vol, autoAt(ptsOf(ID.m, 'mix:vol'), rt), tol), near(t.pan, autoAt(ptsOf(ID.m, 'mix:pan'), rt), 1.6 * tol)]);
    await stopAll();
    sim.$('#tAutoRe').click(); await settle();
    A.set(ID.m, 'i1:em', null);
  }
  A.set(ID.m, 'mix:vol', null); A.set(ID.m, 'mix:pan', null); byId(ID.m).vol = 0.8; byId(ID.m).pan = 0;
  assert.deepEqual(res, [[false, 0, true, true], [true, 0, true, true]], '[record, overrides, vol on its curve, pan on its curve]');
});

// fix 4 (R1 P2-1)
test('fix 4: a lane edit / the arrangement\'s Delete bars on a key a take is writing (its latch, or the knob held) is kept — the track\'s spans end first', async () => {
  const old = [[0, 0], [2 * BAR, 10]], el = ctlEl('i1', 'fc'), res = [];
  const at = (k, x) => { const p = ptsOf(ID.m, k); return p ? Math.round(autoAt(p, x) * 1e3) / 1e3 : null; };
  for (const what of ['lane', 'delete']) for (const held of [false, true]) {
    A.set(ID.m, MOOG_FC, old); A.set(ID.m, 'i1:em', old);
    await take();
    P().bars = 2;
    const id = hold(el, ID.m, MOOG_FC, () => 8, 1, 300, 1, 800);
    if (!held) release(el, id);
    until(1, 1000);
    if (what === 'lane') { for (const k of [MOOG_FC, 'i1:em']) A.edit(ID.m, k, 'Automation: x', p => p.concat([[6000, 1]]).sort((a, b) => a[0] - b[0])); }
    else { api.arr().host.setRange(BAR, 2 * BAR); sim.$('#aDel').click(); }
    until(1, 1500);
    const kept = () => (what === 'lane' ? [at(MOOG_FC, 6000), at('i1:em', 6000)] : [at(MOOG_FC, 5000) === at('i1:em', 5000) || at(MOOG_FC, 5000) + ' vs ' + at('i1:em', 5000), true]), later = kept();
    if (held) { turn(ID.m, MOOG_FC, () => 3, 1, 1500, 1, 1700); release(el, id); }
    await stopAll();
    res.push([what, held, ...later, ...kept()]);
  }
  A.set(ID.m, MOOG_FC, null); A.set(ID.m, 'i1:em', null);
  assert.deepEqual(res, [['lane', false, 1, 1, 1, 1], ['lane', true, 1, 1, 1, 1], ['delete', false, true, true, true, true], ['delete', true, true, true, true, true]], '[op, held, fc kept, em; after the stop]');
});

// fix 5 (R1 P2-2)
test('fix 5: a take over a 20 000-point key stays within the cap by thinning, its end kept — save → load keeps every point', async () => {
  const big = []; for (let i = 0; i < 20000; i++) big.push([i * 100, Math.round((5 + Math.sin(i) * 3) * 1e4) / 1e4]);
  A.set(ID.m, MOOG_FC, big);
  await take({ loop: false });
  const el = ctlEl('i1', 'fc'); let z = 0;
  const id = hold(el, ID.m, MOOG_FC, () => ((z++ & 1) ? 2 : 8), 1, 300, 1, 6000);
  release(el, id);
  frames(4);
  await stopAll();
  const p = ptsOf(ID.m, MOOG_FC), p2 = cv.loadProject(JSON.stringify(P())).tracks.find(x => x.id === ID.m).auto[MOOG_FC].pts;
  A.set(ID.m, MOOG_FC, null);
  assert.deepEqual([p.length <= S.AUTO_MAX, p[p.length - 1][0], p2.length === p.length, p2[p2.length - 1][0]], [true, 1999900, true, 1999900], 'capped (' + p.length + '), the end kept, load identical');
});

// fix 6 (R1 P2-3)
test('fix 6: a 2-bar bounce at 120 BPM steps as finely as live playback where the curve moves — suspends ≥ 0.8 × the live patch posts over the same 2 bars', async () => {
  const ramp = [[0, 0.5], [BAR, 9.5], [2 * BAR, 2]];
  A.set(ID.m, MOOG_FC, ramp);
  await take({ play: true, bpm: 120, le: 2 * BAR });
  const N = sim.nodeOf(ID.m), n0 = N.posted.length;
  until(1, 2 * BAR - 30);
  const live = N.posted.slice(n0).filter(e => e.m && e.m.t === 'patch').length;
  await stopAll();
  song2(); P().bpm = 120;
  const off = await bounce();
  A.set(ID.m, MOOG_FC, null); unsong2();
  const sus = off && off.ctx.suspends ? off.ctx.suspends.length : 0;
  assert.ok(live > 150 && sus >= 0.8 * live, 'live ' + live + ' posts, the bounce ' + sus + ' suspends');
});

// fix 7 (R1 P2-4)
test('fix 7: with the loop off the latch closes at the song\'s end + 1 bar (as at the release) and never grows project.bars', async () => {
  A.set(ID.m, MOOG_FC, [[0, 2], [100, 2.5]]);
  await take({ loop: false });
  P().bars = 1;
  const el = ctlEl('i1', 'fc'), id = hold(el, ID.m, MOOG_FC, () => 8, 1, 300, 1, 1000);
  release(el, id);
  const end = S.songEnd(P()) + BAR;
  let t = api.curTick();
  while (t < 9 * BAR) { for (let q = 0; q < 6; q++) sim.run(128); sim.raf(); t = api.curTick(); }
  const bars = P().bars, run = ptsOf(ID.m, MOOG_FC), open = A.spans().length;
  await stopAll();
  const p = ptsOf(ID.m, MOOG_FC);
  A.set(ID.m, MOOG_FC, null);
  assert.deepEqual([end, bars, open, run[run.length - 1][0] <= end, autoAt(p, end - 1), p[p.length - 1][0] <= end], [2 * BAR, 1, 0, true, 8, true], '[the close, bars while running, spans still open past it, the latch\'s last point ≤ the close, the value before it, after the stop]');
});

// fix 8 (R1 P2-5)
test('fix 8: a latch over a flat or short old curve (its last point before the close) gives the old curve back from the close', async () => {
  const el = ctlEl('i1', 'fc'), res = [];
  for (const old of [[[0, 2]], [[0, 2], [200, 3]], [[0, 2], [5000, 3]]]) {
    A.set(ID.m, MOOG_FC, old);
    await take();
    const id = hold(el, ID.m, MOOG_FC, () => 8, 1, 300, 1, 800);
    release(el, id);
    until(2, 300); await stopAll();
    const p = ptsOf(ID.m, MOOG_FC);
    res.push([autoAt(p, LOOP - 1), Math.round(autoAt(p, 3000) * 1e3) / 1e3]);
  }
  A.set(ID.m, MOOG_FC, null);
  assert.deepEqual(res, [[8, 2], [8, 3], [8, Math.round(autoAt([[0, 2], [5000, 3]], 3000) * 1e3) / 1e3]], '[the latch, the old curve past the close]');
});

// fix 12 (R2 P2-2): a take writes the curve's last-known label and range
test('fix 12: a recorded curve carries n (the label the user sees) and r (its range)', async () => {
  A.set(ID.m, MOOG_FC, null);
  await take();
  const el = ctlEl('i1', 'fc'), id = hold(el, ID.m, MOOG_FC, up1, 1, 300, 1, 900);
  release(el, id);
  await stopAll();
  const c = byId(ID.m).auto[MOOG_FC], g = A.range(ID.m, MOOG_FC);
  A.set(ID.m, MOOG_FC, null);
  assert.deepEqual([c.n, c.r], ['Minimoog · Cutoff', [g.lo, g.hi]]);
});

// fix 15 (H1 deviation 5): a knob turned while stopped overrides its curve at ▶ (§4.3 "any base change") — a wheel-like write or a
// grab; one left alone follows its curve
test('fix 15: a base changed while stopped (a write, a grab and move) is an override at ▶; an untouched key follows its curve', async () => {
  const ramp = [[0, 1], [LOOP, 9]], res = [];
  for (const how of ['write', 'grab', 'none']) {
    A.set(ID.m, MOOG_FC, ramp);
    await stopAll(); api.roll().host.setPlayhead(0); await settle();
    if (how === 'write') dev(ID.m).vals.fc = 5;
    else if (how === 'grab') { const el = ctlEl('i1', 'fc'), id = grab(el); setBase(ID.m, MOOG_FC, 5); release(el, id); }
    await settle();
    await take({ play: true });
    until(1, 900);
    res.push([how, A.override().map(x => x[1]).join(), how === 'none' ? near(dev(ID.m).vals.fc, autoAt(ramp, A.renderTick()), 0.6) : dev(ID.m).vals.fc === 5]);
    await stopAll();
    sim.$('#tAutoRe').click(); await settle();
  }
  A.set(ID.m, MOOG_FC, null);
  assert.deepEqual(res, [['write', MOOG_FC, true], ['grab', MOOG_FC, true], ['none', '', true]], '[how, overridden, the base the user\'s / on the curve]');
});
