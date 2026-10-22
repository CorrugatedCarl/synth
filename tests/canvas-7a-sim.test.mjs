import './v8-guard.mjs';
// Stage 7a lane H1 (docs/canvas/IMPL-7a.md §10.1, §12.6): the TR-808 in the page simulation with the real engine — main.js
// wires cv-drum's drumHost (DRUM) to the transport, the tempo, the step posts at their heard time, the pads, → Piano roll
// (its History meta), the sample slots (tables.ensure before the payload naming them), the project file and the bounce.
// First the lead's fixture check (§11 phase 2): an 808 from the Sources tray's Drums view plays the demo synced from bar 3
// and the plan the panel shows is what the worklet clocks. Accessor-free: the app runs as a guard build (a track's v1 keys
// throw) — instruments read as devices (cv-model instOf), the panel through its device view and the __synthTest hooks.
// canvas-sim's scripted world; one boot; strings, numbers and booleans only into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/canvas-7a-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as CMOD from '../cv-model.js?v=9';
import * as DC from '../drum-core.js?v=9';
import * as CM from '../cv-migrate.js?v=9';
import { wavFile } from './smp-files.mjs';
import { MODELS } from '../models.js?v=9';

// every DSP global wk.loadDSP waits for, defined (null): a host's load resolves at once (canvas-3-sim's rule)
for (const g of ['SxBase', 'SxFilt2', 'SxWarp', 'SxMod', 'SxSample', 'SxGran', 'SxSpec', 'SxSeq', 'SerumDSP', 'FXMods2', 'FXDSP', 'Dr808', 'DrSeq', 'ModCore', 'PatchDSP', 'PatchMoog']) globalThis[g] = null;
const VP = { left: 0, top: 48 }, BAND = { left: 44, top: 48, right: 1500, bottom: 1300 };
function scriptedWorld(root) {
  const L = {};
  const W = {
    el: root, k: 1, cam: { tx: 0, ty: 0, k: 1 }, items: new Map(), selected: null, mode: 'always',
    setCamera(c) { W.cam = { tx: c.tx, ty: c.ty, k: c.k }; W.k = c.k; W.emit('cameraend', { cam: W.cam, zoomed: true }); },
    band: () => Object.assign({}, BAND),
    toClient: (wx, wy) => ({ x: VP.left + wx * W.k + W.cam.tx, y: VP.top + wy * W.k + W.cam.ty }),
    toWorld: (x, y) => ({ x: (x - VP.left - W.cam.tx) / W.k, y: (y - VP.top - W.cam.ty) / W.k }),
    add(it) { W.items.set(it.id, it); return () => W.remove(it.id); },
    remove(id) { W.items.delete(id); },
    update() {}, clear() { W.items.clear(); },
    select(id) { W.selected = id; W.emit('select', { id }); },
    focusItem() {}, dragPointer() {}, ghost: g => (g ? { x: 0, y: 0, w: g.w, h: g.h } : null), setDragging() {},
    modsMode: () => W.mode, setModsMode(m) { W.mode = m; W.emit('mods', m); },
    on(t, fn) { (L[t] || (L[t] = [])).push(fn); return () => { L[t] = L[t].filter(f => f !== fn); }; },
    emit(t, d) { for (const f of (L[t] || []).slice()) f(d); },
  };
  return W;
}

// (a Chromium audio clock with 200 ms of output latency — Bluetooth-like: what is heard trails what is rendered)
const sim = await bootMain({ ls: fakeStorage({}), hash: '#minimoog', clock: 'std', outLat: 0.2, synthTest: { cvWorld: root => scriptedWorld(root) } });
const api = sim.api, cv = globalThis.__synthTest.cv, sh = globalThis.__synthTest.shell, acc = globalThis.__synthTest.acc;
await sim.power(); sim.raf(); await sim.settle(10); sim.raf();

const P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack), I = (t, dev) => CMOD.instOf(t, dev);
const view = (t = T()) => cv.view1e(CMOD.primId(t)); // (the device view a panel is built for: id 'trackId/dev')
const DR = (t = T()) => cv.drum.api(view(t));
const D = (t = T()) => cv.drumOf(t, CMOD.primId(t));
const node = (t = T()) => sim.nodeOf(t.id);
const got = (t, k) => node(t).got.filter(m => m.t === k);
const sent = (t, k) => node(t).posted.map(x => x.m).filter(m => m.t === k);
const note = () => sim.$('#notice').textContent;
const settle = async (n = 2) => { for (let i = 0; i < n; i++) { sim.raf(); await sim.settle(3); } };
const walk = (n, f, out = []) => { for (const c of n.children || []) { if (f(c)) out.push(c); walk(c, f, out); } return out; };
const attr = (n, k) => (n && n.attrs ? n.attrs[k] : undefined);
const BAR = 3840;
const MOOG = MODELS.find(m => m.id === 'minimoog');
const heardF = () => sim.ctx().frames - api.outLatency() * sim.ctx().sampleRate; // (the frame leaving the speakers now)
const ID = {};

test('the lead\'s fixture check (§11 phase 2): an 808 from the Sources tray\'s Drums view; the demo synced from bar 3 — the posts are the plan\'s steps at the frames its ticks say, and the panel shows each at its heard time', async () => {
  const tiles = sh.shell.tiles;
  tiles.setView('drums');
  const shown = tiles.tiles().filter(b => !b.hidden).map(b => b.getAttribute('data-model'));
  assert.deepEqual(shown, ['tr808', 'tr606', 'tr909', 'sdsv'], 'the Drums view lists the drum machines (7b: the TR-606 beside the TR-808; 7c: the TR-909; 8: the SDS-V)');
  sh.srcPick('tr808', 'replace'); sim.raf(); await settle();
  const t = T(), d = I(t);
  assert.equal(d.model, 'tr808');
  assert.match(note(), /^Replaced Minimoog with TR-808 · tap to undo$/);
  assert.deepEqual([cv.instUi(t), cv.layFlow(t, CMOD.primId(t)), cv.srcUi('tr808')], ['hw', false, 'hw'], 'Hardware only');
  assert.equal(JSON.stringify(D(t)) === JSON.stringify(DC.normDrum(undefined)), true, 'a new machine: an empty memory, the defaults (SYNC on)');
  // the face renders with api.drum: live step keys, START, the pads
  const hw = cv.hw(), root = cv.panel().root;
  assert.equal(!!hw, true, 'its Hardware panel');
  const keys = walk(root, n => attr(n, 'data-n') && /\bdr-key\b/.test(n.className || ''));
  assert.deepEqual([keys.length, keys.filter(k => attr(k, 'aria-disabled') === 'true').length], [16, 0], 'the 16 step keys, live');
  assert.equal(walk(root, n => attr(n, 'data-sound')).length, 16, 'the 16 pads');
  // DEMO (its targets empty: no confirm), then START synced = the project's ▶ from bar 3
  DR().demo();
  assert.deepEqual([D().st[0].join(), D().st[1].join(), D().st[24].join()], [DC.DEMO.a.join(), DC.DEMO.b.join(), DC.DEMO.f.join()]);
  assert.match(note(), /^Demo loaded into pattern 1 A \/ B and fill 1 · tap to undo$/);
  const seqs = sent(t, 'seq');
  assert.equal(seqs.length > 0 && !!seqs.at(-1).s.plan, true, 'the payload posted');
  assert.equal(seqs.at(-1).s.plan.key, DC.compilePlan(D(), D().ui, D().x).key, 'the plan the panel compiles');
  api.transport().pos = 2 * BAR;
  node(t).got.length = 0;
  DR().press({ k: 'start' });
  await sim.settle(5);
  const Tr = api.transport();
  assert.deepEqual([Tr.playing, Tr.a.tick, DR().state().run], [true, 2 * BAR, true], 'START is the project\'s play; the session follows');
  const plan = DC.compilePlan(D(), D().ui, D().x), sr = sim.ctx().sampleRate;
  const fr = tick => Tr.a.frame + (tick - Tr.a.tick) * Tr.a.fpt;
  sim.run(Math.ceil(fr(4 * BAR) - sim.ctx().frames) - 128); // (bars 3 and 4: the last step's quantum, not bar 5's first)
  const posts = got(t, 'step');
  assert.equal(posts.length, 32, 'every step of two measures');
  posts.forEach((q, i) => {
    const M = 2 + (i >> 4), s = i & 15, m = 0, tick = M * BAR + s * 240;
    assert.deepEqual([q.M, q.s, q.m, q.k, q.v, q.p, q.f, q.o], [M, s, m, plan.mKey[m], plan.mVar[m], 0, 0, s * 240], 'post ' + i);
    const dF = q.F - fr(tick);
    assert.ok(dF >= -1e-6 && dF < 8, `post ${i}: F ${q.F} on the 4-frame grid at its tick's frame (+${dF.toFixed(2)})`);
    assert.equal(q.F % 4, 0, 'a span start');
  });
  ID.posts = posts;
  // the heard time: what the panel shows is the post heard by now (the last whose F ≤ heard + a frame's lead), 200 ms
  // behind the last one rendered
  await settle(2);
  const S = DR().state().S, heard = heardF();
  assert.ok(Math.abs(sim.ctx().frames - heard - 0.2 * sr) < 2, 'the clock: 200 ms heard behind render');
  const last = posts.filter(q => q.F <= heard + sr / 60).at(-1);
  assert.equal(!!S.pos && posts.at(-1).F > heard + sr / 60, true, 'a post shown, the newest still ahead of the ear');
  assert.deepEqual([S.pos.M, S.pos.s], [last.M, last.s], 'the panel at the heard post');
  const L = DC.leds(S, D());
  assert.deepEqual([L.step[0], L.vari.join()], [1, '1,0'], 'MANUAL PLAY running: key 1 steady, variation A');
  ID.t = t.id;
});

// renders `bars` bars in quarter-bar slices, a frame (raf) after each: the posts reach the panel at their heard time
async function play(bars) {
  const Tr = api.transport(), n = Math.round(bars * 4);
  for (let i = 0; i < n; i++) { sim.run(Math.round(BAR / 4 * Tr.a.fpt)); sim.raf(); }
  await sim.settle(2); sim.raf();
}
const stepPosts = (t = T()) => got(t, 'step');
const firsts = (t = T()) => stepPosts(t).filter(q => q.s === 0); // (each measure's first step)
const start = async () => { DR().press({ k: 'start' }); await sim.settle(5); }; // (synced: the project's ▶ / ■)

test('a step key in PATTERN WRITE 1st PART while running toggles its step — the posted plan changes in place (same shape, the position kept); CLEAR + 4 sets the 1st part\'s length (at the next measure); the LEDs show the instrument\'s steps, the heard playhead inverted', async () => {
  const t = T();
  DR().press({ k: 'mode', v: DC.M_W1 });
  DR().press({ k: 'inst', v: 2 }); // (SD)
  await play(1);
  const n0 = sent(t, 'seq').length, p0 = sent(t, 'seq').at(-1).s, M0 = stepPosts(t).at(-1).M;
  const had = (D().st[0][2] >> 2) & 1;
  DR().press({ k: 'step', n: 3 });
  const q = sent(t, 'seq').slice(n0);
  assert.equal(q.length, 1, 'one payload');
  assert.deepEqual([q[0].s.at, q[0].s.plan.shape === p0.plan.shape, q[0].s.plan.key !== p0.plan.key, (D().st[0][2] >> 2) & 1], ['now', true, true, had ^ 1], 'the step toggled, the plan replaced in place');
  node(t).got.length = 0;
  await play(1);
  const Ms = stepPosts(t).map(x => x.M);
  assert.equal(Ms[0] === M0 || Ms[0] === M0 + 1, true, 'the position kept (no re-anchor): the measure count goes on');
  const S = DR().state().S, L = DC.leds(S, D());
  const want = [...Array(16)].map((_, j) => (D().st[0][j] >> 2) & 1);
  const shown = L.step.map(c => (c === 1 || c === 4 ? 1 : 0));
  assert.deepEqual(shown, want, 'the SD steps of pattern 1 A');
  assert.equal(L.step[S.pos.s] >= 3, true, 'the heard playhead inverted');
  // CLEAR + 4: the 1st part ends at step 4 — a measure-boundary change
  DR().press({ k: 'clear+step', n: 4 });
  assert.deepEqual([D().keys[0].l1, sent(t, 'seq').at(-1).s.at], [4, 'bar']);
  node(t).got.length = 0;
  await play(2.5);
  const ps = stepPosts(t), b = ps.findIndex((x, i) => i && x.M !== ps[i - 1].M);
  const late = ps.slice(ps.findIndex((x, i) => i > b && x.s === 0));
  assert.deepEqual(late.slice(0, 9).map(x => x.s).join(), '0,1,2,3,0,1,2,3,0', 'four-step measures after the boundary');
  DR().press({ k: 'clear+step', n: 16 });
});

test('the LEDs follow {t:\'step\'} at the heard time (200 ms of output latency): a post is shown once its frame is heard, never before', async () => {
  const t = T(), sr = sim.ctx().sampleRate;
  DR().press({ k: 'mode', v: DC.M_MAN });
  await play(0.5);
  node(t).got.length = 0;
  sim.run(Math.round(0.1 * sr)); sim.raf();
  const ps = stepPosts(t), h = heardF(), S = DR().state().S;
  assert.equal(ps.length > 0, true);
  assert.equal(ps.every(q => q.F > h + sr / 60), true, '100 ms of new posts: none heard yet');
  assert.equal(ps.some(q => q.M === S.pos.M && q.s === S.pos.s), false, 'so none shown');
  sim.run(Math.round(0.35 * sr)); sim.raf();
  const h2 = heardF(), S2 = DR().state().S, last = stepPosts(t).filter(q => q.F <= h2 + sr / 60).at(-1);
  assert.deepEqual([S2.pos.M, S2.pos.s], [last.M, last.s], 'heard now: shown');
});

test('COMPOSE records three measures (synced: the song\'s measure index, a play from bar 1) — a key pressed takes effect, and is recorded, at the next measure; PLAY then loops the rhythm track', async () => {
  const t = T();
  await start(); // (stop)
  assert.equal(api.transport().playing, false);
  DR().press({ k: 'mode', v: DC.M_COMP }); DR().press({ k: 'inst', v: 0 }); // (track 1)
  DR().press({ k: 'clear' }); // (TRACK CLEAR: a new composition)
  assert.equal(D().rtEnd[0], -1);
  api.transport().pos = 0;
  await start();
  assert.equal(api.transport().playing, true);
  await play(0.5);
  DR().press({ k: 'step', n: 2 }); // (key 2 from measure 2)
  await play(1);
  DR().press({ k: 'step', n: 3 }); // (key 3 from measure 3)
  await play(1.5); // (to the end of measure 3: measure 4's first step not heard yet)
  await start(); // (stop)
  assert.deepEqual([D().rt.slice(0, 4).join(), D().rtEnd[0]], ['0,1,2,-1', 2], 'measures 1–3 recorded: keys 1, 2, 3');
  // PLAY: the track from its measure 1, looping
  DR().press({ k: 'mode', v: DC.M_PLAY });
  node(t).got.length = 0;
  api.transport().pos = 0;
  await start();
  await play(4.25);
  await start();
  assert.deepEqual([P().loop.on, P().loop.end], [true, 4 * BAR], 'the project\'s 4-bar loop');
  assert.deepEqual(firsts(t).slice(0, 5).map(q => [q.M, q.k, q.m].join(':')).join(), '0:0:0,1:1:1,2:2:2,3:0:0,0:0:0', 'keys 1, 2, 3, round again — and the song\'s loop wrap re-anchors it at measure 1 (tick 0)');
});

test('TAP in MANUAL PLAY while running: one fill at the next measure (the payload\'s tap counter), then the cycle resumes', async () => {
  const t = T();
  DR().press({ k: 'mode', v: DC.M_MAN }); DR().press({ k: 'step', n: 1 });
  api.transport().pos = 0;
  await start();
  await play(0.5);
  const tap0 = sent(t, 'seq').at(-1).s.tap;
  node(t).got.length = 0;
  DR().tap(performance.now());
  assert.equal(sent(t, 'seq').at(-1).s.tap, tap0 + 1);
  await play(2);
  await start();
  assert.deepEqual(firsts(t).slice(0, 2).map(q => [q.f, q.k, q.m].join(':')).join(), '1:12:-1,0:0:0', 'fill 1 (key 13) in place of the next measure, then pattern 1');
});

const peak = x => { let m = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; } return m; };
const padsOf = () => walk(cv.panel().root, n => /\bdr-pads\b/.test(n.className || ''))[0];
const padOf = s => walk(cv.panel().root, n => attr(n, 'data-sound') === s)[0];
const ptr = (el, type, target, id, y) => el.dispatchEvent({ type, target, currentTarget: el, button: 0, buttons: 1, pointerId: id, pointerType: 'touch', isPrimary: false,
  clientX: 10, clientY: y, timeStamp: performance.now(), shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} });

test('the pads: two fingers are two hits — {t:\'on\'} of the sounds\' primaries (snare 38, kick 36) at the touch velocity (0.3 + 0.75 · f from the back edge) on the selected track, each lit while held and again when the monitor hears its sound', async () => {
  const t = T(), g = padsOf(), sd = padOf('sd'), bd = padOf('bd');
  assert.equal(!!g && !!sd && !!bd, true);
  sim.run(256); sim.raf(); await sim.settle(3); sim.raf();
  assert.equal(sent(t, 'mon').at(-1).ids.includes('i0'), true, 'the pads mounted: the drum monitor subscribed (the instrument part)');
  const n0 = node(t).posted.length;
  ptr(g, 'pointerdown', sd, 51, 50); // (the middle: f 0.5)
  ptr(g, 'pointerdown', bd, 52, 100); // (the front edge: f 1)
  const on = node(t).posted.slice(n0).map(x => x.m).filter(m => m.t === 'on');
  assert.deepEqual(on.map(m => [m.n, m.v].join(':')), ['38:0.675', '36:1'], 'two hits');
  assert.deepEqual([attr(sd, 'data-held'), attr(bd, 'data-held')], ['', '']);
  const hit0 = attr(sd, 'data-hit');
  sim.run(Math.round(0.3 * sim.ctx().sampleRate)); sim.raf(); await sim.settle(3); sim.raf(); sim.raf();
  assert.equal(got(t, 'smon').some(m => m.dr && (m.dr.lit >> 1) & 1), true, 'the monitor heard the snare');
  assert.notEqual(attr(sd, 'data-hit'), hit0, 'the pad lit again at the heard hit');
  ptr(g, 'pointerup', sd, 51, 50); ptr(g, 'pointerup', bd, 52, 100);
  const off = node(t).posted.slice(n0).map(x => x.m).filter(m => m.t === 'off');
  assert.deepEqual([off.map(m => m.n).join(), attr(sd, 'data-held'), attr(bd, 'data-held')], ['38,36', undefined, undefined]);
});

test('MIDI in on the GM numbers: note 36 plays the kick through the worklet\'s note map (a drum track stays omni); noteOn(NaN) posts nothing', async () => {
  const t = T();
  assert.equal(t.ch, 0, 'omni');
  sim.run(Math.round(2.5 * sim.ctx().sampleRate)); // (the earlier hits rung out)
  api.noteOn(36, 100 / 127, 1); // (MIDI channel 1)
  const out = sim.run(Math.round(0.25 * sim.ctx().sampleRate)).get(node(t));
  api.noteOff(36, 1);
  assert.ok(peak(out.L) > 0.05, 'the kick sounds (' + peak(out.L).toFixed(3) + ')');
  const n0 = node(t).posted.length;
  api.noteOn(NaN, 1, 0);
  assert.equal(node(t).posted.length, n0, 'nothing for a NaN note');
});

// the real bounce (the dialog's range: the loop; 48 kHz, OS 4): the rendered left channel
async function bounceL() {
  for (const [k, v] of [['#bRange', 'loop'], ['#bSr', '48000'], ['#bBits', '24'], ['#bTail', '0'], ['#bOs', '4']]) sim.$(k).value = v;
  sim.$('#bNorm').checked = false;
  sim.lastOffline = null;
  await sim.$('#bGo').onclick();
  for (let i = 0; i < 20 && !sim.lastOffline; i++) await sim.settle(5);
  return sim.lastOffline ? sim.lastOffline.L : null;
}

test('both ways (§4): the pattern synced and its "→ Piano roll" notes bounce the same; → Piano roll writes v 100 / 127 on the primaries, turns SYNC off — its notice\'s undo restores both, so does the project\'s ↶ (meta.drumSync), and ↷ turns it off again', async () => {
  const t = T(), n0 = t.notes.length;
  DR().press({ k: 'mode', v: DC.M_MAN }); DR().press({ k: 'step', n: 1 });
  assert.deepEqual([api.transport().playing, D().x.sync, n0], [false, true, 0]);
  api.transport().pos = 0;
  const A = await bounceL();
  assert.ok(A && peak(A) > 0.05, 'a synced machine with no notes bounces (audible)');
  DR().toRoll(4);
  const notes = T().notes.slice().sort((a, b) => a.t - b.t || a.n - b.n), plan = DC.compilePlan(D(), D().ui, D().x);
  const want = DC.toNotes(plan, { t0: 0, t1: 4 * BAR, map: D().map });
  assert.deepEqual(notes.map(x => [x.t, x.d, x.n, x.v].join(':')), want.map(x => [x.t, x.d, x.n, x.v].join(':')), 'four bars of the pattern as notes');
  assert.deepEqual([...new Set(notes.map(x => x.v))].sort().join(), '100,127');
  assert.deepEqual([...new Set(notes.map(x => x.n))].sort().join(), '36,38,39,42,46', 'kick, snare, clap, the hats: their primaries');
  assert.deepEqual([D().x.sync, DR().state().run, cv.hist.undoLabel], [false, false, 'Pattern to notes']);
  assert.match(note(), /^Written to the piano roll · the 808’s own sequencer is off so it isn’t heard twice · tap to undo$/);
  assert.equal(sent(t, 'seq').at(-1).s.sync, false, 'the machine told');
  const B = await bounceL();
  let dmax = 0;
  for (let i = 0; i < A.length; i++) dmax = Math.max(dmax, Math.abs(A[i] - B[i]));
  assert.equal(dmax, 0, 'the notes bounce bit-identically to the synced pattern (120 BPM, 48 kHz: D5)');
  // the notice's tap: both back
  sim.$('#notice').onclick();
  assert.deepEqual([T().notes.length, D().x.sync, sent(T(), 'seq').at(-1).s.sync], [0, true, true], 'the notice: the notes gone, SYNC on');
  cv.redo();
  assert.deepEqual([T().notes.length, D().x.sync], [want.length, false], '↷: the notes and SYNC off again');
  cv.undo();
  assert.deepEqual([T().notes.length, D().x.sync, sent(T(), 'seq').at(-1).s.sync], [0, true, true], 'the project\'s ↶: both');
});

test('7b review 1 #4 (the lead\'s decision): → Piano roll writes the project tempo into the 808\'s own TEMPO + FINE (the machine left SYNC off reads what the synced pattern read); one undo with the rest', async () => {
  const t = T(), bpm0 = P().bpm, ui0 = D().ui, k = DC.bpmTempo(100);
  try {
    cv.setProjectBpm(100);
    assert.deepEqual([D().x.sync, D().ui.tempo, D().ui.fine], [true, ui0.tempo, ui0.fine], 'synced: its own knobs untouched');
    DR().toRoll(1);
    const s = sent(t, 'seq').at(-1).s;
    assert.deepEqual([D().x.sync, D().ui.tempo, D().ui.fine, s.sync, s.bpm], [false, k.tempo, k.fine, false, DC.tempoBpm(k.tempo, k.fine)]);
    assert.equal(Math.abs(s.bpm - 100) < 0.01, true, 'its TEMPO + FINE show 100 BPM (' + s.bpm + ')');
    sim.$('#notice').onclick();
    assert.deepEqual([T().notes.length, D().x.sync, D().ui.tempo, D().ui.fine, sent(T(), 'seq').at(-1).s.bpm], [0, true, ui0.tempo, ui0.fine, DC.tempoBpm(ui0.tempo, ui0.fine)], 'the notice: all back');
    cv.redo();
    assert.deepEqual([D().x.sync, D().ui.tempo, D().ui.fine], [false, k.tempo, k.fine], '↷');
    cv.undo();
    assert.deepEqual([D().x.sync, D().ui.tempo, D().ui.fine], [true, ui0.tempo, ui0.fine], '↶');
  } finally { cv.setProjectBpm(bpm0); }
});

test('MAP… re-maps the snare to 40: the payload\'s note map (the worklet plays 40 as the snare, 38 nothing) and the roll\'s drum rows', async () => {
  const t = T();
  DR().press({ k: 'map', sound: 'sd', notes: [40] });
  const s = sent(t, 'seq').at(-1).s;
  assert.deepEqual([s.map[40], s.map[38], s.prim[1]], [1, -1, 40]);
  const R = api.roll().drumRows();
  assert.equal(!!R && R.on, true, 'the roll shows the drum rows');
  assert.equal(R.rows.find(r => r.name === 'Snare').n, 40);
  DR().press({ k: 'mapReset' });
  assert.deepEqual([sent(t, 'seq').at(-1).s.map[38], api.roll().drumRows().rows.find(r => r.name === 'Snare').n], [1, 38]);
});

test('your own sound in a slot (§5): loaded into the snare, its worklet entry (2 playback levels) is posted before the payload naming it, and it plays; Save embeds it; the bounce builds it; a project with an 808 saved and reopened is the same machine', async () => {
  const t = T(), sr = sim.ctx().sampleRate, n = 4800, L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = Math.sin(2 * Math.PI * 900 * i / sr) * Math.exp(-i / 1200) * 0.9;
  const r = await cv.drumLoad(view(), 'sd', [{ name: 'my snare.wav', data: wavFile({ ch: [L], rate: sr }) }]);
  assert.equal(!!r && /^smp:[0-9a-f]{16}$/.test(r.id) && r.name === 'my snare', true, 'imported: ' + JSON.stringify(r));
  const k0 = node(t).posted.length;
  DR().press({ k: 'smp', sound: 'sd', slot: { id: r.id, name: r.name, on: true } }); // (api.drum.sample's step after the picker)
  for (let i = 0; i < 40 && !sent(t, 'seq').some(m => m.s.smp && m.s.smp[1] && m.s.smp[1].id === r.id); i++) await sim.settle(5);
  const ms = node(t).posted.slice(k0).map(x => x.m), iE = ms.findIndex(m => m.t === 'smp' && m.id === r.id), iP = ms.findIndex(m => m.t === 'seq' && m.s.smp && m.s.smp[1] && m.s.smp[1].on);
  assert.equal(iE >= 0 && iP > iE, true, `the {t: 'smp'} entry (${iE}) before the payload naming it (${iP})`);
  assert.equal(ms[iE].levels.length, 2, 'two playback levels (TUNING\'s ± 1 octave)');
  assert.deepEqual(api.tables.needs.get(t.id), [r.id], 'the track needs it');
  sim.raf();
  assert.equal(walk(cv.panel().root, x => attr(x, 'data-sound') === 'sd' && attr(x, 'data-smp') === '').length, 1, 'the pad shows its dot (the next frame)');
  sim.run(sr); api.noteOn(38, 1, 1);
  const out = sim.run(Math.round(0.05 * sr)).get(node(t)); api.noteOff(38, 1);
  assert.ok(peak(out.L) > 0.05, 'the sample plays');
  // Save: the project file embeds it (pcm24, §9.8), the drum record with its slot
  const txt = await cv.projectFile(), o = JSON.parse(txt);
  assert.deepEqual([o.schema, !!(o.smps && o.smps[r.id])], [CM.SCHEMA, true], 'schema 8, the sample embedded');
  ID.file = txt;
  // the bounce builds every slot that is on
  const B = await bounceL();
  assert.equal(!!B && sim.lastOffline.nodes[0].po.smps.some(e => e.id === r.id), true, 'the bounce\'s entries hold the slot');
  // reopened: the same machine (record, model, values), its payload the same content
  const p = acc.loadProject(JSON.parse(txt), { file: true }), t2 = p.tracks.find(x => x.id === t.id);
  assert.equal(JSON.stringify(CMOD.instOf(t2).drum), JSON.stringify(D(t)), 'the drum record round-trips');
  assert.deepEqual([CMOD.instOf(t2).model, JSON.stringify(CMOD.instOf(t2).vals) === JSON.stringify(I(t).vals)], ['tr808', true]);
  const pk0 = sent(t, 'seq').at(-1).s.pk;
  api.applyRestore(p); await settle();
  const N2 = node(T());
  assert.equal((N2.po.seq && N2.po.seq.pk) || sent(T(), 'seq').at(-1).s.pk, pk0, 'the reopened machine gets the same payload');
  // a newer build's file opens read-only here — the gate a schema-7 build applies to this one (SPEC §5.8)
  const p9 = acc.loadProject(Object.assign(JSON.parse(txt), { schema: CM.SCHEMA + 1 }), { file: true });
  assert.equal(p9.newerSchema, CM.SCHEMA + 1);
  DR().press({ k: 'smp', sound: 'sd', slot: null });
  await settle();
  assert.deepEqual([D().smp.sd === undefined, (api.tables.needs.get(T().id) || []).length], [true, 0], 'removed: the track needs nothing');
});

test('History (§6): an unrelated undo keeps the pattern memory (the 303\'s policy); Replace with… deletes the record and its notice\'s undo brings it back', async () => {
  const t = T(), mem = JSON.stringify(D());
  api.addTrack(); sim.raf(); // (an unrelated step: a new track)
  api.selectTrack(t.id); sim.raf();
  DR().press({ k: 'grid', lane: 11, s: 15 }); // (a pattern edit: no History step)
  const mem2 = JSON.stringify(D());
  assert.notEqual(mem2, mem);
  cv.undo(); await settle(); // (the new track goes)
  assert.equal(JSON.stringify(D(T())), mem2, 'the edit stays');
  // Replace with… (the Sources tray, Hardware view)
  sh.shell.tiles.setView('hw');
  sh.srcPick('juno60', 'replace'); sim.raf(); await settle();
  const d = I(T());
  assert.deepEqual([d.model, 'drum' in d], ['juno60', false], 'the drum record deleted with the model');
  assert.match(note(), /^Replaced TR-808 with Juno-60 · tap to undo$/);
  sim.$('#notice').onclick(); await settle();
  assert.deepEqual([I(T()).model, JSON.stringify(D(T()))], ['tr808', mem2], 'the undo brings it back');
  assert.deepEqual([cv.instUi(T()), cv.hw() ? 'hw' : 'none'], ['hw', 'hw']);
  sh.shell.tiles.setView('drums');
});

test('Save as classic project lists the drum track (the live site has no drum machine: its notes kept); the Simple layout is never offered — not in ⋯, not by setLayout, not from the tray\'s Simple view', async () => {
  const msgs = [], c0 = globalThis.confirm;
  globalThis.confirm = m => { msgs.push(String(m)); return true; };
  try { await cv.classicFile(); } finally { globalThis.confirm = c0; }
  assert.equal(msgs.some(m => m.includes('TR-808 track') && m.includes('“' + T().name + '”')), true, msgs.join(' | '));
  const items = cv.menu('inst', CMOD.primId(T())), labels = (items || []).map(x => x.label || '');
  assert.equal(labels.some(l => /layout/i.test(l)), false, 'no layout items: ' + labels.join(', '));
  assert.equal(labels.includes('Init sound') && labels.includes('Replace with…'), true);
  cv.setLayout('flow');
  assert.deepEqual([cv.instUi(T()), cv.layFlow(T(), CMOD.primId(T()))], ['hw', false], 'setLayout refuses');
  sh.shell.tiles.setView('flow');
  assert.equal(cv.srcUi('tr808'), 'hw', 'the 808 comes Hardware whatever the tray\'s layout');
  sh.shell.tiles.setView('drums');
});

test('SYNC off: START runs the machine alone at its own TEMPO while the transport is stopped; panic stops it — its START state and LEDs follow (the selected key flashing), its payload says so, no step after', async () => {
  const t = T(), sr = sim.ctx().sampleRate;
  assert.equal(api.transport().playing, false);
  DR().press({ k: 'sync', v: false });
  assert.equal(sent(t, 'seq').at(-1).s.sync, false);
  const k = DC.bpmTempo(150);
  DR().press({ k: 'tempo', v: k.tempo }); DR().press({ k: 'fine', v: k.fine });
  const bpm = DC.tempoBpm(D().ui.tempo, D().ui.fine);
  assert.equal(Math.abs(bpm - 150) < 0.01, true, 'its own TEMPO (' + bpm + ')');
  assert.equal(P().bpm, 120, 'the project tempo untouched');
  node(t).got.length = 0;
  await start();
  assert.deepEqual([api.transport().playing, DR().state().run, sent(t, 'seq').at(-1).s.run], [false, true, true], 'running alone, the song stopped');
  for (let i = 0; i < 8; i++) { sim.run(Math.round(sr / 8)); sim.raf(); }
  const ps = stepPosts(t), dF = ps.slice(1).map((q, i) => q.F - ps[i].F), want = sr * 60 / (bpm * 960) * 240;
  assert.equal(ps.length >= 8 && ps[0].s === 0 && ps[0].M === 0, true, 'from step 1 of the pattern');
  assert.equal(dF.every(d => Math.abs(d - want) <= 4), true, `its sixteenths ${want.toFixed(1)} frames apart: ${dF.join()}`);
  // panic: the free machine stops — its session, its payload, its LEDs
  cv.panic(); sim.raf();
  assert.deepEqual([DR().state().run, sent(t, 'seq').at(-1).s.run], [false, false], 'stopped, the machine told');
  const L = DC.leds(DR().state().S, D());
  assert.equal(L.step[D().ui.sel], 2, 'the selected key flashes again');
  node(t).got.length = 0;
  const out = sim.run(sr).get(node(t));
  assert.equal(stepPosts(t).length, 0, 'no step after the panic');
  assert.ok(peak(out.L.subarray(Math.round(0.1 * sr))) < 1e-3, 'nothing sounding (' + peak(out.L.subarray(Math.round(0.1 * sr))) + ')');
  await start(); // (START again: a fresh run from step 1)
  node(t).got.length = 0;
  sim.run(Math.round(sr / 4));
  assert.deepEqual([stepPosts(t)[0].s, stepPosts(t)[0].M], [0, 0]);
  await start(); // (stop)
  DR().press({ k: 'sync', v: true });
});

test('TEMPO / FINE while synced set the project tempo — the tempo box\'s path (its field, every node) — one History step for a whole drag', async () => {
  const n0 = cv.hist.u.length, c0 = DC.bpmTempo(P().bpm).tempo, own = D().ui.tempo;
  DR().press({ k: 'tempo', v: c0 + 1 }, 'move');
  DR().press({ k: 'tempo', v: c0 + 2 }, 'move');
  DR().press({ k: 'tempo', v: c0 + 3 }, 'move');
  DR().end();
  const bpm = DC.tempoBpm(c0 + 3, DC.bpmTempo(120).fine);
  assert.deepEqual([cv.hist.u.length, cv.hist.undoLabel, P().bpm, +sim.$('#tBpm').value], [n0 + 1, 'Tempo', bpm, bpm], 'one step, the project tempo');
  assert.equal(DR().state().S.bpm, bpm, 'the knobs show it');
  assert.equal(D().ui.tempo, own, 'the machine\'s own TEMPO untouched');
  cv.undo(); await settle();
  assert.deepEqual([P().bpm, DR().state().S.bpm], [120, 120], 'its undo');
});

test('recording: an armed drum track records the pads as notes (on the primaries, the touch velocity) while the synced pattern plays — the 808\'s own sequencer is never recorded', async () => {
  const t = T(), sr = sim.ctx().sampleRate, g = padsOf();
  t.arm = true; P().metronome.countIn = 0; api.transport().pos = 0;
  const n0 = t.notes.length;
  sim.$('#tRec').onclick(); await sim.settle(5);
  assert.deepEqual([api.transport().playing, api.transport().rec], [true, true]);
  sim.run(Math.round(0.5 * sr));
  ptr(g, 'pointerdown', padOf('sd'), 61, 100); sim.run(Math.round(0.1 * sr)); ptr(g, 'pointerup', padOf('sd'), 61, 100);
  sim.run(Math.round(0.4 * sr));
  ptr(g, 'pointerdown', padOf('cp'), 62, 0); sim.run(Math.round(0.1 * sr)); ptr(g, 'pointerup', padOf('cp'), 62, 0);
  sim.run(Math.round(0.5 * sr));
  sim.$('#tPlay').onclick(); await sim.settle(3); // (stop)
  const add = T().notes.slice(n0).sort((a, b) => a.t - b.t);
  assert.deepEqual(add.map(x => x.n + ':' + x.v), ['38:127', '39:38'], 'two notes: the snare (front edge: v 1) and the clap (back edge: 0.3)');
  assert.equal(add[0].t > 0 && add[1].t > add[0].t, true);
  T().arm = false;
  cv.undo(); // (the take)
});

test('nothing left sounding or lit: a held pad lets go on a hidden page, a track switch, a panic and power off', async () => {
  const t = T(), g = () => padsOf();
  const hold = id => { ptr(g(), 'pointerdown', padOf('bd'), id, 50); return attr(padOf('bd'), 'data-held'); };
  const offs = () => sent(t, 'off').filter(m => m.n === 36).length;
  let o = offs();
  assert.equal(hold(71), '', 'held');
  globalThis.document.hidden = true;
  for (const f of sim.dom.docL.visibilitychange || []) f({ type: 'visibilitychange' });
  globalThis.document.hidden = false;
  for (const f of sim.dom.docL.visibilitychange || []) f({ type: 'visibilitychange' });
  assert.deepEqual([offs(), attr(padOf('bd'), 'data-held')], [o + 1, undefined], 'a hidden page');
  o = offs();
  hold(72);
  api.addTrack(); sim.raf(); // (selects the new track)
  assert.equal(offs(), o + 1, 'a track switch');
  api.selectTrack(t.id); sim.raf(); await settle();
  o = offs();
  hold(73);
  cv.panic();
  assert.deepEqual([offs(), attr(padOf('bd'), 'data-held')], [o + 1, undefined], 'a panic');
  o = offs();
  hold(74);
  sim.$('#power').onclick(); await sim.settle(5); // (power off)
  assert.deepEqual([api.ctx(), attr(padOf('bd'), 'data-held'), DR().state().run], [null, undefined, false], 'power off');
  await sim.power(); sim.raf(); await settle();
  assert.equal(!!node(T()), true, 'back on');
});

const btnOf = (root, text) => walk(root, n => n.tagName === 'BUTTON' && n.textContent === text)[0] || null;

test('the roll (§4.2): a drum track\'s named rows and the "Drum rows" toggle (shown on drum tracks only, kept on this device); Transpose asks first ("changes which drums play"); MAP… learn takes the next note played into the track', async () => {
  const t = T(), roll = api.roll(), bar = sim.$('#rolltools'), tog = walk(bar, n => n.id === 'rollDrums')[0];
  assert.equal(!!tog, true);
  assert.deepEqual([roll.isDrum(), tog.hidden, roll.drumRows().on], [true, false, true]);
  t.notes.push({ id: 'n_x1', t: 0, d: 120, n: 36, v: 100 }); api.selectTrack(t.id);
  const asked = [], c0 = globalThis.confirm;
  globalThis.confirm = m => { asked.push(String(m)); return false; };
  try { btnOf(bar, '+1').onclick(); } finally { globalThis.confirm = c0; }
  assert.deepEqual([asked.length, /changes which drums play/.test(asked[0]), T().notes.find(x => x.id === 'n_x1').n], [1, true, 36], 'asked, declined: unchanged');
  T().notes = T().notes.filter(x => x.id !== 'n_x1');
  // the toggle: the whole keyboard, kept
  tog.children[0].checked = false; tog.children[0].onchange();
  assert.deepEqual([roll.drumRows().on, api.store.get('synth.roll.drumRows', true)], [false, false]);
  tog.children[0].checked = true; tog.children[0].onchange();
  assert.equal(roll.drumRows().on, true);
  // a synth track: no toggle
  const syn = api.addTrack(MOOG); sim.raf();
  assert.deepEqual([api.roll().isDrum(), tog.hidden], [false, true]);
  api.deleteTrack(syn); api.selectTrack(t.id); sim.raf();
  assert.deepEqual([api.roll().isDrum(), tog.hidden], [true, false]);
  // MAP… learn: the next note into the track (a key, a pad, MIDI) is the cowbell's primary
  const off = DR().learn('cb');
  api.noteOn(60, 0.8, 0); api.noteOff(60, 0);
  assert.deepEqual([D().map.cb[0], sent(t, 'seq').at(-1).s.map[60]], [60, 7], 'cowbell on 60');
  if (off) off();
  DR().press({ k: 'mapReset' });
});

test('MIDI files (§4.5): an 808 track exports on channel 10; a channel-10 track imports as a TR-808 track — its notes as they are, a notice counting the notes on keys its map leaves silent', async () => {
  const t = T();
  t.notes.push({ id: 'n_m1', t: 0, d: 120, n: 36, v: 127 }, { id: 'n_m2', t: 480, d: 120, n: 38, v: 100 }, { id: 'n_m3', t: 960, d: 120, n: 60, v: 100 });
  const bytes = (await import('../song.js?v=9')).exportMIDI(P(), { trackIds: [t.id] });
  T().notes = T().notes.filter(x => !/^n_m/.test(x.id));
  cv.importMidiFile(bytes, 'drums.mid'); await settle(); // (no notes in the project: the file's tracks replace its tracks)
  const nt = P().tracks.find(x => I(x).model === 'tr808' && x.notes.length === 3);
  assert.equal(!!nt, true, 'a TR-808 track');
  assert.deepEqual(nt.notes.map(x => [x.t, x.n, x.v].join(':')), ['0:36:127', '480:38:100', '960:60:100']);
  assert.equal(JSON.stringify(cv.drumOf(nt, CMOD.primId(nt))), JSON.stringify(DC.normDrum(undefined)), 'its record: a fresh machine');
  assert.match(note(), /^1 drum note on keys the TR-808 doesn’t map/);
  assert.equal(nt.ch, 0, 'omni');
  cv.undo(); await settle();
  api.selectTrack(t.id); sim.raf(); await settle();
});

test('an 808 on a graphed node (a second instrument): its Inst gets its payload with its graph ({t:\'seq\', i}); its posts ({t:\'step\', i}) reach its own panel session — never a 303 pattern on the drum device', async () => {
  const syn = api.addTrack(MOOG); sim.raf(); await settle();
  const t = T(), id = cv.add('tr808', { x: 0, y: 1400 }); sim.raf(); await settle();
  assert.equal(I(t, id).model, 'tr808');
  const q = sent(t, 'seq').filter(m => m.i === id);
  assert.equal(q.length >= 1 && !!q.at(-1).s.plan, true, 'its payload, named');
  assert.equal(JSON.stringify(cv.drumOf(t, id)), JSON.stringify(DC.normDrum(undefined)));
  const S0 = cv.drum.api(cv.view1e(id)).state();
  sim.run(sim.ctx().sampleRate / 2);
  node(t)._fromProc({ t: 'step', s: 3, m: 0, k: 0, v: 0, p: 0, o: 720, M: 0, f: 0, F: Math.floor(heardF()), i: id }); sim.raf(); sim.raf();
  const S1 = cv.drum.api(cv.view1e(id)).state().S;
  assert.deepEqual([S1.pos && S1.pos.s, 'seq' in t.dev[id], S0.D === cv.drumOf(t, id)], [3, false, true], 'its session heard it; no 303 pattern written');
  api.deleteTrack(syn); sim.raf(); await settle();
  api.selectTrack(ID.t); sim.raf(); await settle();
});

/* ---------------------------------------------------------------- review 1 (the fixes; each test failed before its fix) */
const TR808 = MODELS.find(m => m.id === 'tr808');
const zc20 = (x, sr) => { let i0 = 0; while (i0 < x.length && Math.abs(x[i0]) <= 1e-3) i0++; let z = 0; for (let i = i0 + 1; i < Math.min(x.length, i0 + Math.round(0.02 * sr)); i++) if ((x[i - 1] < 0) !== (x[i] < 0)) z++; return z; };
const setNotes = q => { T().notes = q.map(([t, n], k) => ({ id: 'rv' + k, t, d: 120, n, v: 100 })); api.postTo(T(), Object.assign({ t: 'song' }, api.songData(T()))); };

test('review 1 F1 — SYNC off, the bounce is what is heard: roll notes bounce through the machine\'s payload (its note map, a muted lane, its sample slot), on a plain node and on a graphed one', async () => {
  const t = api.addTrack(TR808); sim.raf(); await settle();
  t.solo = true; // (the bounce: this track alone)
  const L0 = P().loop, sr = sim.ctx().sampleRate, pd = CMOD.primId(t);
  P().loop = Object.assign({}, L0, { on: false, start: 0, end: BAR });
  // → Piano roll turns SYNC off: the cowbell (mapped to 60) on step 1, written as a note 60
  DR().press({ k: 'mode', v: DC.M_W1 }); DR().press({ k: 'map', sound: 'cb', notes: [60] }); DR().press({ k: 'grid', lane: 8, s: 0 }); DR().press({ k: 'mode', v: DC.M_MAN });
  DR().toRoll(1); await settle();
  assert.deepEqual([T().notes.map(x => x.n).join(), D().x.sync], ['60', false]);
  const ping = Float32Array.from({ length: 4800 }, (_, i) => Math.sin(2 * Math.PI * 900 * i / sr) * Math.exp(-i / 1200) * 0.9);
  const r = await cv.drumLoad(view(), 'sd', [{ name: 'ping.wav', data: wavFile({ ch: [ping], rate: sr }) }]);
  for (const how of ['plain', 'graphed']) {
    const pay = () => { const po = sim.lastOffline.nodes[0].po; return how === 'plain' ? po.seq : po.seqs && po.seqs[pd]; };
    if (how === 'graphed') { const j = cv.add('juno60', { x: 0, y: 1400 }); sim.raf(); await settle(); cv.power(j, false); sim.raf(); await settle(); api.selectTrack(t.id); sim.raf(); await settle(); }
    // (a) the note map: note 60 plays the cowbell
    DR().press({ k: 'map', sound: 'cb', notes: [60] }); setNotes([[0, 60]]); await settle();
    let B = await bounceL();
    assert.equal(how === 'graphed', !!sim.lastOffline.nodes[0].po.graph, how);
    assert.deepEqual([!!pay(), pay() && pay().map[60], pay() && pay().run, pay() && pay().sync], [true, DC.SOUNDS.indexOf('cb'), false, false], how + ': the payload rides the bounce (its map; never running)');
    assert.ok(peak(B) > 0.05, `${how}: note 60 plays the cowbell (${peak(B).toFixed(4)})`);
    // (b) a muted lane: the kick's note is silent, as live
    DR().press({ k: 'mapReset' }); setNotes([[0, 36]]); await settle();
    B = await bounceL();
    assert.ok(peak(B) > 0.05, how + ': the kick sounds');
    DR().press({ k: 'mute', lane: 1 }); await settle();
    B = await bounceL();
    assert.equal(peak(B) < 1e-6, true, `${how}: the muted kick is silent (${peak(B)})`);
    DR().press({ k: 'mute', lane: 1 }); await settle();
    // (c) your own snare (a 900 Hz ping) in the SD slot: the bounce plays the sample, not the circuit
    setNotes([[0, 38]]);
    DR().press({ k: 'smp', sound: 'sd', slot: { id: r.id, name: r.name, on: true } });
    for (let i = 0; i < 40 && !sent(T(), 'seq').some(m => m.s.smp && m.s.smp[1] && m.s.smp[1].on); i++) await sim.settle(5);
    B = await bounceL();
    const z = zc20(B, sr);
    assert.equal(z >= 30 && z <= 42, true, `${how}: the ping plays (${z} zero crossings in 20 ms; 900 Hz ≈ 36, the circuit's snare ≈ 167)`);
    DR().press({ k: 'smp', sound: 'sd', slot: null }); await settle();
  }
  P().loop = L0;
  T().solo = false; T().notes.length = 0;
  api.deleteTrack(T()); sim.raf(); await settle();
  api.selectTrack(ID.t); sim.raf(); await settle();
});

test('review 1 F2 — ↶ / ↷ of "Replace … with TR-808" (and back again): the machine gets its payload every time it comes back — the synced pattern plays — on a plain node and as a graphed node\'s second instrument', async () => {
  const sr = sim.ctx().sampleRate;
  const steps = async id => { // (1.2 s from bar 1: the machine's step posts)
    node(T()).got.length = 0; api.transport().pos = 0;
    sim.$('#tPlay').onclick(); await sim.settle(5);
    sim.run(Math.round(1.2 * sr));
    sim.$('#tPlay').onclick(); await sim.settle(5);
    sim.run(Math.round(0.3 * sr));
    return got(T(), 'step').filter(q => (id == null ? q.i == null : q.i === id)).length;
  };
  // plain: Minimoog → TR-808 (the demo, synced), ↶, ↷, ↶, ↷
  api.addTrack(MOOG); sim.raf(); await settle();
  sh.shell.tiles.setView('drums'); sh.srcPick('tr808', 'replace'); sim.raf(); await settle();
  DR().demo(); await settle();
  const n = await steps();
  assert.equal(n > 0, true, 'the demo plays');
  for (const k of [1, 2]) {
    cv.undo(); sim.raf(); await settle();
    assert.deepEqual([I(T()).model, await steps()], ['minimoog', 0], '↶ ' + k);
    cv.redo(); sim.raf(); await settle();
    assert.deepEqual([I(T()).model, await steps()], ['tr808', n], '↷ ' + k + ': the 808 plays its synced pattern again');
  }
  api.deleteTrack(T()); sim.raf(); await settle();
  // graphed: an 808 beside a Minimoog, replaced by a Juno-60 (its device view), ↶ (the 808), ↷ (the Juno), ↶ (the 808)
  api.addTrack(MOOG); sim.raf(); await settle();
  const id = cv.add('tr808', { x: 0, y: 1400 }); sim.raf(); await settle();
  cv.drum.api(cv.view1e(id)).demo(); await settle();
  const ng = await steps(id);
  assert.equal(ng > 0, true, 'the second instrument plays the demo');
  cv.setTrackModel(cv.view1e(id), 'juno60'); sim.raf(); await settle();
  for (const k of [1, 2]) {
    cv.undo(); sim.raf(); await settle();
    assert.deepEqual([I(T(), id).model, await steps(id)], ['tr808', ng], '↶ ' + k + ': the 808 back, playing');
    if (k === 2) break;
    cv.redo(); sim.raf(); await settle();
    assert.deepEqual([I(T(), id).model, await steps(id)], ['juno60', 0], '↷ ' + k);
  }
  api.deleteTrack(T()); sim.raf(); await settle();
  api.selectTrack(ID.t); sim.raf(); await settle();
});

test('review 1 F5 — → Piano roll while the song plays: the notes reach the worklet with the SYNC-off payload (one task), so no hit is dropped or doubled', async () => {
  const t = api.addTrack(TR808); sim.raf(); await settle();
  const pd = CMOD.primId(t);
  DR().demo(); await settle();
  // (CH on every 16th of pattern 1 A: a gap between the two paths swallows a hit)
  const d = structuredClone(D()); for (let s = 0; s < 16; s++) d.st[0][s] |= 1 << 11;
  T().dev[pd].drum = DC.normDrum(d); cv.drum.changed(view()); cv.drumSend(T(), pd);
  const L0 = P().loop;
  P().loop = Object.assign({}, L0, { on: false });
  api.transport().pos = 0;
  DR().press({ k: 'start' }); await sim.settle(5);
  const pr = node(T()).proc, dm = pr.i0.dm, log = [];
  const tickOf = F => pr.tp.tick + (F - pr.tp.frame) / pr.tp.fpt;
  const h = dm.hit, tg = dm.trig;
  dm.hit = function (s, v) { if (s === 10) log.push(Math.round(tickOf(pr.spanF))); return h.call(this, s, v); };
  dm.trig = function (m) { if (m & (1 << 11)) log.push(Math.round(tickOf(pr.spanF))); return tg.call(this, m); };
  const runTo = tick => { while (tickOf(sim.ctx().frames) < tick) sim.run(128); };
  try {
    runTo(5040 - 40); // (bar 2, just before the CH at 5040)
    const n0 = node(T()).posted.length;
    DR().toRoll(4);
    const ms = node(T()).posted.slice(n0).map(x => x.m), iS = ms.findIndex(m => m.t === 'song' && m.notes.length > 0), iQ = ms.findIndex(m => m.t === 'seq' && m.s.sync === false);
    assert.equal(iS >= 0 && iQ >= 0 && iS < iQ, true, `the notes (${iS}) posted before the SYNC-off payload (${iQ})`);
    for (let k = 0; k < 40; k++) { sim.run(128); await sim.settle(3); } // (real time passes: a 60 ms song timer fires meanwhile)
    runTo(3 * BAR);
    const want = []; for (let x = BAR; x < 3 * BAR; x += 240) want.push(x);
    assert.deepEqual(log.filter(x => x >= BAR && x < 3 * BAR).join(), want.join(), 'every CH of bars 2–3 once (the steps, then the notes)');
  } finally {
    dm.hit = h; dm.trig = tg;
    if (api.transport().playing) sim.$('#tPlay').onclick();
    await sim.settle(5);
    P().loop = L0;
    T().notes.length = 0;
    api.deleteTrack(T()); sim.raf(); await settle();
    api.selectTrack(ID.t); sim.raf(); await settle();
  }
});
