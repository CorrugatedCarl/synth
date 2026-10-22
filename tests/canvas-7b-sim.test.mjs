import './v8-guard.mjs';
// Stage 7b lane H1 (docs/canvas/IMPL-7b.md §10, §12.6): the TR-606 in the page simulation with the real engine — main.js's
// drum sites read the record's machine (drumOf, normDevs, setTrackModel, drumEdit: normDrum(·, model); drumPayload's
// offline session), → Piano roll on the 606's primaries (review #5), STEP RESET's payload (rst, review #3), the 808 ↔ 606
// Replace and its undo / redo (a payload before its patch waits in the engine's drPend, review #2), SYNC 303s (the host's
// link303 / n303, the one-time offer, the swing in the 303's scale), the sample slots, a project with both machines saved
// and reopened, the bounce. First the lead's fixture check (§11 phase 2): a 606 from the Drums view plays its DEMO synced
// from bar 3 beside a synced TB-303 — the 606's step posts are the plan's, F on the 4-frame grid at its ticks' frames, and
// the 303's steps land on the same grid points. Accessor-free: the app runs as a guard build (a track's v1 keys throw) —
// instruments read as devices (cv-model instOf), the panels through their device views and the __synthTest hooks.
// canvas-sim's scripted world; one boot; strings, numbers and booleans only into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/canvas-7b-sim.test.mjs
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

// (a Chromium audio clock with 200 ms of output latency — what is heard trails what is rendered)
const sim = await bootMain({ ls: fakeStorage({}), hash: '#minimoog', clock: 'std', outLat: 0.2, synthTest: { cvWorld: root => scriptedWorld(root) } });
const api = sim.api, cv = globalThis.__synthTest.cv, sh = globalThis.__synthTest.shell, acc = globalThis.__synthTest.acc;
await sim.power(); sim.raf(); await sim.settle(10); sim.raf();

const P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack), I = (t, dev) => CMOD.instOf(t, dev);
const byId = id => P().tracks.find(t => t.id === id);
const view = (t = T(), dev = CMOD.primId(t)) => (t === T() ? cv.view1e(dev) : acc.instView(t, dev)); // (the device view a panel is built for: 'trackId/dev')
const DR = (t = T()) => cv.drum.api(view(t));
const D = (t = T(), dev = CMOD.primId(t)) => cv.drumOf(t, dev);
const node = (t = T()) => sim.nodeOf(t.id);
const got = (t, k) => node(t).got.filter(m => m.t === k);
const sent = (t, k) => node(t).posted.map(x => x.m).filter(m => m.t === k);
const note = () => sim.$('#notice').textContent;
const settle = async (n = 2) => { for (let i = 0; i < n; i++) { sim.raf(); await sim.settle(3); } };
const walk = (n, f, out = []) => { for (const c of n.children || []) { if (f(c)) out.push(c); walk(c, f, out); } return out; };
const attr = (n, k) => (n && n.attrs ? n.attrs[k] : undefined);
const BAR = 3840;
const MOOG = MODELS.find(m => m.id === 'minimoog'), TB303 = MODELS.find(m => m.id === 'tb303'), TR808 = MODELS.find(m => m.id === 'tr808'), TR606 = MODELS.find(m => m.id === 'tr606');
const heardF = () => sim.ctx().frames - api.outLatency() * sim.ctx().sampleRate; // (the frame leaving the speakers now)
const ID = {};

test('the lead\'s fixture check (§11 phase 2): a 606 from the Sources tray\'s Drums view; its DEMO synced from bar 3 beside a synced TB-303 — the 606\'s step posts are the plan\'s steps at the frames its ticks say, and the 303\'s steps land on the same 4-frame grid points', async () => {
  // a TB-303 track on SYNC (its own panel's button: q.sync, then its payload)
  const moog = T(), t3 = api.addTrack(TB303); sim.raf(); await settle();
  t3.name = 'Bass';
  api.seqOf(t3).sync = true; api.seqSend(t3);
  api.selectTrack(moog.id); sim.raf(); await settle();
  const tiles = sh.shell.tiles;
  tiles.setView('drums');
  const shown = tiles.tiles().filter(b => !b.hidden).map(b => b.getAttribute('data-model'));
  assert.deepEqual(shown, ['tr808', 'tr606', 'tr909', 'sdsv'], 'the Drums view lists the four machines (7c: the TR-909 too; 8: the SDS-V)');
  sh.srcPick('tr606', 'replace'); sim.raf(); await settle();
  const t = T(), d = I(t);
  assert.equal(d.model, 'tr606');
  assert.match(note(), /^Replaced Minimoog with TR-606 · tap to undo$/, 'the 303 is synced: no offer');
  assert.deepEqual([cv.instUi(t), cv.layFlow(t, CMOD.primId(t)), cv.srcUi('tr606')], ['hw', false, 'hw'], 'Hardware only');
  assert.deepEqual([D(t).m, JSON.stringify(D(t)) === JSON.stringify(DC.normDrum(undefined, 'tr606'))], ['tr606', true], 'a new 606: its own empty record (m tr606), the defaults (SYNC on)');
  assert.equal(DR().state().S.held !== undefined, true, 'the panel\'s session is a 606\'s');
  // the face renders with api.drum: the 16 live step keys, the 8 pads
  const root = cv.panel().root;
  assert.equal(!!cv.hw(), true, 'its Hardware panel');
  const keys = walk(root, n => attr(n, 'data-n') && /\bdr-key\b/.test(n.className || ''));
  assert.deepEqual([keys.length, keys.filter(k => attr(k, 'aria-disabled') === 'true').length], [16, 0], 'the 16 step keys, live');
  assert.equal(walk(root, n => attr(n, 'data-sound')).length, 8, 'the 8 pads (AC + the seven sounds)');
  // DEMO (its targets empty: no confirm) — I-1, I-2 chained in PATTERN PLAY
  DR().demo();
  assert.deepEqual([D().st[0].join(), D().st[1].join(), D().ui.mode, D().ui.sel, D().ui.cl], [DC.DEMO606.a.join(), DC.DEMO606.b.join(), DC.M6_PP, 0, 1]);
  assert.match(note(), /^Demo loaded into patterns I-1 and I-2 · tap to undo$/);
  const seqs = sent(t, 'seq');
  assert.deepEqual([!!seqs.at(-1).s.plan, seqs.at(-1).s.m, seqs.at(-1).s.plan.key], [true, 'tr606', DC.compilePlan(D(), D().ui, D().x, DR().state().S).key], 'the payload: the plan the panel compiles, the 606\'s');
  // START synced = the project's ▶ from bar 3; the 606's trig and the 303's steps logged at the span they fire in
  api.transport().pos = 2 * BAR;
  node(t).got.length = 0; node(t3).got.length = 0;
  const p6 = node(t).proc, p3 = node(t3).proc, dm = p6.i0.dm, i3 = p3.i0, log6 = [], log3 = [];
  const trig = dm.trig, fire = i3.seqFire;
  dm.trig = function (m) { log6.push({ F: p6.spanF, m }); return trig.call(this, m); };
  i3.seqFire = function (s) { log3.push({ F: p3.spanF, s }); return fire.call(this, s); };
  try {
    DR().press({ k: 'start' });
    await sim.settle(5);
    const Tr = api.transport();
    assert.deepEqual([Tr.playing, Tr.a.tick, DR().state().run], [true, 2 * BAR, true], 'RUN/STOP is the project\'s play; the session follows');
    const plan = DC.compilePlan(D(), D().ui, D().x, DR().state().S);
    const fr = tick => Tr.a.frame + (tick - Tr.a.tick) * Tr.a.fpt;
    sim.run(Math.ceil(fr(4 * BAR) - sim.ctx().frames) - 128); // (bars 3 and 4: the last step's quantum, not bar 5's first)
    const posts = got(t, 'step');
    assert.equal(posts.length, 32, 'every step of two measures');
    posts.forEach((q, i) => {
      const M = 2 + (i >> 4), s = i & 15, m = M & 1, tick = M * BAR + s * 240;
      assert.deepEqual([q.M, q.s, q.m, q.k, q.v, q.p, q.f, q.o], [M, s, m, plan.mKey[m], plan.mVar[m], 0, 0, s * 240], 'post ' + i + ': I-' + (m + 1));
      const dF = q.F - fr(tick);
      assert.ok(dF >= -1e-6 && dF < 8, `post ${i}: F ${q.F} on the 4-frame grid at its tick's frame (+${dF.toFixed(2)})`);
      assert.equal(q.F % 4, 0, 'a span start');
    });
    assert.deepEqual([plan.mKey[0], plan.mKey[1]], [0, 1], 'the chain I-1 → I-2');
    // the machine fired each sounding step at its post's frame (the plan's masks, the 606's lanes)
    const hits = log6.filter(x => x.F >= posts[0].F && x.F <= posts.at(-1).F);
    const want = posts.filter(q => plan.st[plan.mOff[q.m] + q.s] & 0xE2F);
    assert.deepEqual(hits.map(x => x.F).join(), want.map(q => q.F).join(), 'every sounding step triggered at its post\'s frame');
    assert.equal(hits.every(x => (x.m & ~0xE2F) === 0), true, 'the 606\'s lanes only');
    // the TB-303 (synced): its 32 sixteenths of bars 3–4 on the 606's grid points (the same, or the next: 4 frames)
    const s3 = log3.filter(x => x.F >= posts[0].F - 4 && x.F <= posts.at(-1).F + 4);
    assert.equal(s3.length, 32, 'the 303\'s 32 steps over the same two bars');
    s3.forEach((x, i) => {
      assert.equal(x.s, i & 15, '303 step ' + i);
      const dF = x.F - posts[i].F;
      assert.ok(dF === 0 || dF === 4 || dF === -4, `303 step ${i}: F ${x.F} vs the 606's ${posts[i].F} (${dF})`);
    });
    ID.lock = s3.filter((x, i) => x.F === posts[i].F).length;
  } finally {
    dm.trig = trig; i3.seqFire = fire;
  }
  // the heard time: the panel shows the post heard by now; the RUN LED lit, the chase on the heard step
  await settle(2);
  const S = DR().state().S, heard = heardF(), sr = sim.ctx().sampleRate, posts = got(t, 'step');
  const last = posts.filter(q => q.F <= heard + sr / 60).at(-1);
  assert.deepEqual([S.pos.M, S.pos.s], [last.M, last.s], 'the panel at the heard post');
  const L = DC.leds(S, D());
  assert.deepEqual([L.run, L.step[last.s]], [1, 1], 'RUN lit; PATTERN PLAY\'s chase on the heard step');
  DR().press({ k: 'start' }); await sim.settle(5); // (stop)
  assert.equal(api.transport().playing, false);
  ID.t = t.id; ID.t3 = t3.id;
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
const key = (n, o) => { DR().press(Object.assign({ k: 'key', n, down: true }, o)); DR().press({ k: 'key', n, down: false }); }; // (a step key's press and release)
const fnKey = n => { DR().press({ k: 'fn', down: true }); key(n); DR().press({ k: 'fn', down: false }); }; // (FUNCTION + a key)
const noLoop = () => { const L0 = P().loop; P().loop = Object.assign({}, L0, { on: false }); return () => { P().loop = L0; }; };

test('PATTERN WRITE running (§3.3): a step key toggles the instrument in place (the plan replaced, its shape kept); FUNCTION + 7 sets LAST STEP 7 (at the bar); FUNCTION latches the SCALE switch (32nds, at the bar); the LEDs show the instrument\'s steps, the heard playhead inverted', async () => {
  const t = T(), back = noLoop();
  try {
    key(1); // (stopped, PATTERN PLAY: I-1 alone — the demo's chain 1–2 undone)
    assert.deepEqual([D().ui.sel, D().ui.cl], [0, 0]);
    DR().press({ k: 'mode', v: DC.M6_PW }); DR().press({ k: 'inst', v: 2 }); // (SD)
    api.transport().pos = 0;
    await start();
    await play(1);
    const n0 = sent(t, 'seq').length, p0 = sent(t, 'seq').at(-1).s, had = (D().st[0][2] >> 2) & 1;
    key(3);
    const q = sent(t, 'seq').slice(n0);
    assert.equal(q.length, 1, 'one payload');
    assert.deepEqual([q[0].s.at, q[0].s.plan.shape === p0.plan.shape, q[0].s.plan.key !== p0.plan.key, (D().st[0][2] >> 2) & 1], ['now', true, true, had ^ 1], 'the step toggled, the plan replaced in place');
    node(t).got.length = 0;
    await play(1);
    const S = DR().state().S, L = DC.leds(S, D());
    assert.deepEqual(L.step.map(c => (c === 1 || c === 4 ? 1 : 0)).join(), [...Array(16)].map((_, j) => (D().st[0][j] >> 2) & 1).join(), 'the SD steps of I-1');
    assert.equal(L.step[S.pos.s] >= 3, true, 'the heard playhead inverted');
    // FUNCTION + 7: LAST STEP 7 of the pattern edited — it shortens the bar under the playhead: at the bar
    fnKey(7);
    assert.deepEqual([D().keys[0].l1, sent(t, 'seq').at(-1).s.at], [7, 'bar']);
    node(t).got.length = 0;
    await play(2.5);
    let ps = stepPosts(t), b = ps.findIndex((x, i) => i && x.M !== ps[i - 1].M);
    let late = ps.slice(ps.findIndex((x, i) => i > b && x.s === 0));
    assert.equal(late.slice(0, 15).map(x => x.s).join(), '0,1,2,3,4,5,6,0,1,2,3,4,5,6,0', 'seven-step measures after the boundary');
    // the SCALE switch alone sets nothing; FUNCTION's press (running PATTERN WRITE) latches it into I-1
    DR().press({ k: 'sc', v: 2 });
    assert.equal(D().keys[0].sc, 1, 'the switch alone');
    DR().press({ k: 'fn', down: true }); DR().press({ k: 'fn', down: false });
    const s2 = sent(t, 'seq').at(-1).s;
    assert.deepEqual([D().keys[0].sc, s2.at, s2.plan.mPre[0]], [2, 'bar', DC.SC_CODE[2]], 'SCALE 2 latched: 32nds');
    node(t).got.length = 0;
    await play(1.5);
    ps = stepPosts(t); b = ps.findIndex((x, i) => i && x.M !== ps[i - 1].M);
    late = ps.slice(ps.findIndex((x, i) => i > b && x.s === 0));
    assert.equal(late.slice(0, 8).map(x => x.s + ':' + x.o).join(), '0:0,1:120,2:240,3:360,4:480,5:600,6:720,0:0', 'seven 32nds a measure (120 ticks)');
    fnKey(16); DR().press({ k: 'sc', v: 1 }); DR().press({ k: 'fn', down: true }); DR().press({ k: 'fn', down: false });
    assert.deepEqual([D().keys[0].l1, D().keys[0].sc], [16, 1]);
    await start(); // (stop)
  } finally { back(); }
});

test('PATTERN PLAY (§3.3): two held keys of one block chain them (first → last); a key while running is queued to the pattern\'s end; TAP = STEP RESET — its payload (rst + 1) reaches the worklet and the pattern restarts at step 1 on the next even step', async () => {
  const t = T(), back = noLoop();
  try {
    DR().press({ k: 'mode', v: DC.M6_PP });
    DR().press({ k: 'key', n: 2, down: true }); DR().press({ k: 'key', n: 4, down: true }); DR().press({ k: 'key', n: 4, down: false }); DR().press({ k: 'key', n: 2, down: false });
    assert.deepEqual([D().ui.sel, D().ui.cl], [1, 2], 'the chain I-2 … I-4');
    const L = DC.leds(DR().state().S, D());
    assert.deepEqual(L.step.slice(0, 5).join(), '0,2,1,1,0', 'stopped: the first flashing, the rest steady');
    node(t).got.length = 0; api.transport().pos = 0;
    await start();
    await play(4.25);
    assert.deepEqual(firsts(t).slice(0, 5).map(q => q.k).join(), '1,2,3,1,2', 'I-2, I-3, I-4, round again');
    // key 1 while running: queued — the chain plays to the current pattern's end, then I-1
    const n0 = sent(t, 'seq').length;
    key(1);
    assert.deepEqual([sent(t, 'seq').length - n0, sent(t, 'seq').at(-1).s.at, D().ui.sel, D().ui.cl], [1, 'bar', 0, 0]);
    node(t).got.length = 0;
    await play(2.25);
    const pq = stepPosts(t), j0 = pq.findIndex(q => q.s === 0);
    assert.equal(j0 > 0 && pq.slice(0, j0).every(q => q.k !== 0), true, 'the pattern playing finished: ' + pq.slice(0, j0).map(q => q.k + ':' + q.s).join());
    assert.equal(firsts(t).length >= 2 && firsts(t).every(q => q.k === 0), true, 'then I-1: ' + firsts(t).map(q => q.k).join());
    // TAP = STEP RESET: the payload's counter (its pk changes with rst alone, review #3), the restart on the straight grid
    const rst0 = sent(t, 'seq').at(-1).s.rst, pk0 = sent(t, 'seq').at(-1).s.pk;
    node(t).got.length = 0;
    await play(0.25); // (mid-measure: a request at a measure's end is consumed by its step 1)
    DR().tap(performance.now());
    const sr = sent(t, 'seq').at(-1).s;
    assert.deepEqual([sr.rst, sr.at, sr.pk !== pk0, sr.plan.key === sent(t, 'seq').at(-2).s.plan.key], [rst0 + 1, 'now', true, true], 'one payload: rst + 1, the plan unchanged');
    await play(1);
    const ps = stepPosts(t), j = ps.findIndex((q, i) => i && q.s === 0 && ps[i - 1].s !== 15);
    assert.equal(j > 0, true, 'a restart inside the measure: ' + ps.map(q => q.s).join());
    assert.deepEqual([ps[j - 1].s & 1, ps[j].F - ps[j - 1].F], [1, 6000], 'at the next even step (after an odd one), one sixteenth on (120 BPM, 48 kHz)');
    assert.equal(ps.slice(0, j).every((q, i) => !i || q.s === ps[i - 1].s + 1), true, 'nothing skipped before it');
    await start(); // (stop)
  } finally { back(); }
});

test('review 2 #3 (the lead\'s decision): STEP RESET with 200 ms of output latency — a TAP heard on a bar\'s step 16 never restarts the pattern twice (the bar line heard next is its restart): the payload carries the heard frame (rstF) and the worklet drops the request', async () => {
  const t = T(), back = noLoop();
  try {
    DR().press({ k: 'mode', v: DC.M6_PP }); key(1); // (I-1 alone)
    node(t).got.length = 0; api.transport().pos = 0;
    await start(); await play(1.5);
    const heardPost = () => stepPosts(t).filter(q => q.F <= heardF()).at(-1);
    for (let i = 0; i < 400 && !(heardPost() && heardPost().s === 15); i++) { sim.run(256); sim.raf(); }
    const h = heardPost(), n0 = stepPosts(t).length;
    assert.equal(h.s, 15, 'heard: step 16');
    assert.equal(stepPosts(t).some(q => q.F > h.F && q.s === 0), true, 'the cursor already past the bar line');
    DR().tap(performance.now());
    const sr = sent(t, 'seq').at(-1).s;
    assert.deepEqual([sr.rst > 0, sr.rstF >= h.F && sr.rstF < h.F + 6000], [true, true], 'the payload: rst + 1, the heard frame inside step 16');
    await play(1.25);
    const ps = stepPosts(t), j = ps.findIndex(q => q.F > h.F && q.s === 0);
    assert.equal(ps.slice(j, j + 8).map(q => q.s).join(' '), '0 1 2 3 4 5 6 7', 'one restart (the bar line): ' + ps.slice(n0 - 2, n0 + 10).map(q => q.s).join(' '));
    await start(); // (stop)
  } finally { back(); }
});

test('TRACK WRITE (§3.3): three bars written by TAP while running (the key heard from the next bar, a D.C. armed by CLEAR) — then TRACK PLAY loops them; FUNCTION held shows the bar number', async () => {
  const t = T(), back = noLoop();
  try {
    DR().press({ k: 'mode', v: DC.M6_TW }); DR().press({ k: 'inst', v: 0 }); // (track 1)
    DR().press({ k: 'clr', down: true }); DR().press({ k: 'clr', down: false }); // (stopped: BAR RESET)
    assert.equal(DR().state().S.bar, 0);
    api.transport().pos = 0;
    await start();
    await play(0.25);
    key(1); DR().tap(performance.now());
    key(2); DR().tap(performance.now());
    DR().press({ k: 'clr', down: true }); DR().press({ k: 'clr', down: false }); // (D.C. armed)
    key(1); DR().tap(performance.now());
    await start(); // (stop)
    assert.deepEqual([D().rt.slice(0, 4).join(), D().dc[0], DC.track606(D(), 0).end], ['0,1,0,-1', 2, 2], 'bars 1–3: I-1, I-2, I-1; the D.C. on bar 3');
    // stopped TRACK WRITE, FUNCTION held: typing 2 shows bar 2 (the units flashing); its release locates the pointer there
    DR().press({ k: 'fn', down: true }); key(2);
    assert.equal(DC.leds(DR().state().S, D()).step[1], 2, 'the bar number 2');
    DR().press({ k: 'fn', down: false });
    assert.equal(DR().state().S.bar, 1, 'located on bar 2');
    // TRACK PLAY: the three bars, looping (synced: anchored at song tick 0)
    DR().press({ k: 'mode', v: DC.M6_TP });
    node(t).got.length = 0; api.transport().pos = 0;
    await start();
    await play(6.25);
    await start();
    assert.deepEqual(firsts(t).slice(0, 6).map(q => q.k).join(), '0,1,0,0,1,0', 'the track, round again');
  } finally { back(); }
  DR().press({ k: 'mode', v: DC.M6_PP }); key(1); key(2, { shift: true });
  assert.deepEqual([D().ui.sel, D().ui.cl], [0, 1], 'Shift + a key: the chain I-1 … I-2 again');
});

// 7c review 1 F2 (the 606's TRACK WRITE, the same class as the 909's): the synced plan reads the session's bar pointer and the
// key heard (bar6 / tw6); the bounce's fresh session and → Piano roll (no session) played the track's first bar
test('7c review 1 F2: a synced 606 in TRACK WRITE — the bounce plays the bar the pointer is on (as live), → Piano roll writes it, not bar 1', async () => {
  const t = T(), L0 = P().loop, ui0 = D().ui;
  assert.equal(D().rt.slice(0, 3).join(), '0,1,0', '(the TRACK WRITE test\'s track 1: I-1, I-2, I-1)');
  DR().press({ k: 'mode', v: DC.M6_TW }); DR().press({ k: 'inst', v: 0 });
  DR().press({ k: 'fn', down: true }); key(2); DR().press({ k: 'fn', down: false }); await settle(); // (located on bar 2: I-2)
  P().loop = Object.assign({}, L0, { on: true, start: 0, end: BAR });
  try {
    const S = DR().state().S, live = sent(t, 'seq').at(-1).s;
    assert.deepEqual([S.bar, [...live.plan.mKey].join()], [1, '1'], 'live: bar 2 (I-2)');
    api.transport().pos = 0;
    await bounceL();
    const po = sim.lastOffline.nodes[0].po.seq;
    assert.deepEqual([[...po.plan.mKey].join(), po.plan.key], ['1', live.plan.key], 'the bounce\'s plan = the live one (its STEP RESET counter a fresh session\'s)');
    const want = DC.toNotes(DC.compilePlan(D(), D().ui, D().x, S), { t0: 0, t1: BAR, swing: D().x.swing, sw: I(t).vals, prim: DC.primaries(D().map, 'tr606') });
    DR().toRoll(1); await settle();
    assert.equal(T().notes.slice().sort((a, b) => a.t - b.t || a.n - b.n).map(x => [x.t, x.n, x.v].join(':')).join(), want.map(x => [x.t, x.n, x.v].join(':')).join(), '→ Piano roll: bar 2\'s I-2');
    assert.notEqual(want.map(x => x.n).join(), DC.toNotes(DC.compilePlan(D(), D().ui, D().x), { t0: 0, t1: BAR, prim: DC.primaries(D().map, 'tr606') }).map(x => x.n).join(), '(I-2 ≠ I-1)');
    sim.$('#notice').onclick(); await settle();
    assert.deepEqual([T().notes.length, D().x.sync], [0, true]);
  } finally { P().loop = L0; }
  DR().press({ k: 'mode', v: ui0.mode }); DR().press({ k: 'inst', v: ui0.inst });
});

test('review 1 #1: ■ / ▶ and a seek end a synced 606\'s D.S. and TRACK WRITE\'s heard key in the worklet too — the host carries the transport press\'s payload, main\'s seek reaches the drum host', async () => {
  const t = T(), back = noLoop(), ui0 = D().ui;
  try {
    // track 3 written running in TRACK WRITE: I-1, I-2, the segno on bar 3 (PATTERN GROUP, then TAP), I-3, I-4 the D.C. bar
    DR().press({ k: 'mode', v: DC.M6_TW }); DR().press({ k: 'inst', v: 2 });
    DR().press({ k: 'clr', down: true }); DR().press({ k: 'clr', down: false }); // (stopped: BAR RESET)
    api.transport().pos = 0; await start(); await play(0.25);
    key(1); DR().tap(performance.now()); key(2); DR().tap(performance.now());
    DR().press({ k: 'grp' }); DR().tap(performance.now());
    key(3); DR().tap(performance.now());
    DR().press({ k: 'clr', down: true }); DR().press({ k: 'clr', down: false }); key(4); DR().tap(performance.now());
    await start(); // (stop)
    const s3 = DC.track606(D(), 2).start;
    assert.deepEqual([D().rt.slice(s3, s3 + 5).join(), D().sg[2] - s3, D().dc[2] - s3], ['0,1,2,3,-1', 2, 3]);
    // TRACK PLAY: TAP = D.S. in bar 1 (from bar 2 the rotated cycle: I-3, I-4, I-1 …); ■, then ▶ from bar 1: the plain track
    DR().press({ k: 'mode', v: DC.M6_TP });
    node(t).got.length = 0; api.transport().pos = 0;
    await start(); await play(0.5);
    DR().tap(performance.now());
    await play(3.5);
    assert.equal(firsts(t).slice(0, 4).map(q => q.k).join(), '0,2,3,0', 'the D.S.');
    let n0 = sent(t, 'seq').length;
    await start(); // (■)
    assert.deepEqual([DR().state().S.ds, sent(t, 'seq').slice(n0).map(m => m.s.plan.key === DC.compilePlan(D(), D().ui, D().x, DR().state().S).key).join()], [0, 'true'], '■: the plain plan posted');
    node(t).got.length = 0; api.transport().pos = 0;
    await start(); await play(4.5); await start();
    assert.equal(firsts(t).slice(0, 5).map(q => q.k).join(), '0,1,2,3,0', '■ ▶ from bar 1: the plain track');
    // the D.S., then a seek to bar 1 while playing (the transport's ⏮)
    node(t).got.length = 0; api.transport().pos = 0;
    await start(); await play(0.5);
    DR().tap(performance.now());
    await play(2);
    node(t).got.length = 0; n0 = sent(t, 'seq').length;
    sim.$('#tStart').onclick(); await settle();
    assert.deepEqual([api.transport().playing, DR().state().S.ds, sent(t, 'seq').length - n0], [true, 0, 1], 'the seek: one plain payload');
    await play(4.25); await start();
    assert.equal(firsts(t).slice(0, 4).map(q => q.k).join(), '0,1,2,3', 'after the seek: the plain track from bar 1');
    // TRACK WRITE: key 3 heard (twSel) from bar 2, ■, ▶ — the bar's own pattern again (I-1), as the session says
    DR().press({ k: 'mode', v: DC.M6_TW });
    DR().press({ k: 'clr', down: true }); DR().press({ k: 'clr', down: false }); // (BAR RESET)
    api.transport().pos = 0; await start(); await play(0.25);
    key(3); await play(1.5); await start();
    assert.equal(DR().state().S.twSel, null);
    node(t).got.length = 0; api.transport().pos = 0;
    await start(); await play(2.25); await start();
    assert.equal(firsts(t).slice(0, 2).map(q => q.k).join(), '0,0', 'bar 1\'s own pattern');
  } finally { back(); }
  DR().press({ k: 'mode', v: ui0.mode }); DR().press({ k: 'inst', v: ui0.inst });
  assert.deepEqual([D().ui.mode, D().ui.inst, D().ui.sel, D().ui.cl], [ui0.mode, ui0.inst, ui0.sel, ui0.cl]);
});

const peak = x => { let m = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; } return m; };
const padsOf = () => walk(cv.panel().root, n => /\bdr-pads\b/.test(n.className || ''))[0];
const padOf = s => walk(cv.panel().root, n => attr(n, 'data-sound') === s)[0];
const ptr = (el, type, target, id, y) => el.dispatchEvent({ type, target, currentTarget: el, button: 0, buttons: 1, pointerId: id, pointerType: 'touch', isPrimary: false,
  clientX: 10, clientY: y, timeStamp: performance.now(), shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} });

test('the pads (2 × 4: CY OH CH AC / BD SD LT HT): two fingers are two hits on the primaries at the touch velocity; the AC pad held plays nothing and makes every hit full accent (v 127); MIDI 36 plays the kick through the 606\'s map', async () => {
  const t = T(), g = padsOf();
  assert.equal(!!g && !!padOf('ac') && !padOf('cb'), true, 'the 606\'s pads: AC, no cowbell');
  sim.run(Math.round(2.5 * sim.ctx().sampleRate)); // (what rang out)
  let n0 = node(t).posted.length;
  ptr(g, 'pointerdown', padOf('sd'), 51, 50); // (the middle: f 0.5)
  ptr(g, 'pointerdown', padOf('bd'), 52, 100); // (the front edge: f 1)
  let on = node(t).posted.slice(n0).map(x => x.m).filter(m => m.t === 'on');
  assert.deepEqual(on.map(m => [m.n, m.v].join(':')), ['38:0.675', '36:1'], 'two hits');
  ptr(g, 'pointerup', padOf('sd'), 51, 50); ptr(g, 'pointerup', padOf('bd'), 52, 100);
  // AC held: no note of its own; a snare at the back edge then plays at full accent
  n0 = node(t).posted.length;
  ptr(g, 'pointerdown', padOf('ac'), 53, 50);
  ptr(g, 'pointerdown', padOf('sd'), 54, 0);
  on = node(t).posted.slice(n0).map(x => x.m).filter(m => m.t === 'on');
  assert.deepEqual([on.map(m => [m.n, m.v].join(':')).join(), attr(padOf('ac'), 'aria-pressed')], ['38:1', 'true'], 'the accent hold: v 1 (127)');
  ptr(g, 'pointerup', padOf('sd'), 54, 0); ptr(g, 'pointerup', padOf('ac'), 53, 50);
  const off = node(t).posted.slice(n0).map(x => x.m).filter(m => m.t === 'off');
  assert.deepEqual([off.map(m => m.n).join(), attr(padOf('ac'), 'aria-pressed')], ['38', 'false'], 'one off (the snare\'s)');
  sim.run(Math.round(1.5 * sim.ctx().sampleRate));
  api.noteOn(36, 100 / 127, 1);
  const out = sim.run(Math.round(0.25 * sim.ctx().sampleRate)).get(node(t));
  api.noteOff(36, 1);
  assert.ok(peak(out.L) > 0.05, 'the kick sounds (' + peak(out.L).toFixed(3) + ')');
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
const maxDiff = (A, B) => { let d = 0; for (let i = 0; i < A.length; i++) d = Math.max(d, Math.abs(A[i] - B[i])); return d; };

test('→ Piano roll (§4, review #5): MAP… moves HT to 45 (the low tom gives 45 up); the chain\'s four bars as notes on the 606\'s primaries (HT kept on 45), v 100 / 127, SYNC off — and they bounce bit-identically to the synced pattern (D5); the roll\'s seven named rows; the notice\'s undo and ↶ / ↷', async () => {
  const t = T(), L0 = P().loop;
  P().loop = Object.assign({}, L0, { on: true, start: 0, end: 4 * BAR });
  try {
    DR().press({ k: 'map', sound: 'ht', notes: [45] });
    assert.deepEqual([D().map.ht.join(), D().map.lt.join(), sent(t, 'seq').at(-1).s.prim[4], sent(t, 'seq').at(-1).s.map[45]], ['45', '41,43', 45, 4], 'HT on 45: the payload\'s note map and primary');
    const R = api.roll().drumRows();
    assert.deepEqual(R.rows.map(r => r.name + ' ' + r.n).join(), 'Kick 36,Snare 38,Low tom 41,Hi tom 45,Cymbal 49,Open hat 46,Closed hat 42', 'the roll: the 606\'s seven rows');
    assert.deepEqual([api.transport().playing, D().x.sync, T().notes.length], [false, true, 0]);
    api.transport().pos = 0;
    const A = await bounceL();
    assert.ok(A && peak(A) > 0.05, 'a synced 606 with no notes bounces (audible)');
    const plan = DC.compilePlan(D(), D().ui, D().x);
    DR().toRoll(4);
    const notes = T().notes.slice().sort((a, b) => a.t - b.t || a.n - b.n);
    const want = DC.toNotes(plan, { t0: 0, t1: 4 * BAR, prim: DC.primaries(D().map, 'tr606') });
    assert.deepEqual(notes.map(x => [x.t, x.d, x.n, x.v].join(':')).join(), want.map(x => [x.t, x.d, x.n, x.v].join(':')).join(), 'four bars of the chain as notes');
    assert.deepEqual([[...new Set(notes.map(x => x.v))].sort().join(), [...new Set(notes.map(x => x.n))].sort((a, b) => a - b).join()], ['100,127', '36,38,41,42,45,46,49'], 'kick, snare, the toms (HT on 45), the cymbal, the hats');
    assert.equal(notes.filter(x => x.n === 45).length, 2, 'I-2\'s HT, twice');
    assert.deepEqual([D().x.sync, DR().state().run, cv.hist.undoLabel, sent(t, 'seq').at(-1).s.sync], [false, false, 'Pattern to notes', false]);
    assert.match(note(), /^Written to the piano roll · the 606’s own sequencer is off so it isn’t heard twice · tap to undo$/);
    const B = await bounceL();
    const po = sim.lastOffline.nodes[0].po.seq;
    assert.deepEqual([po.m, po.sync, po.run], ['tr606', false, false], 'the bounce carries the 606\'s payload (SYNC off, never running)');
    assert.equal(maxDiff(A, B), 0, 'the notes bounce bit-identically to the synced pattern (120 BPM, 48 kHz: D5, the open hats\' clock included)');
    sim.$('#notice').onclick();
    assert.deepEqual([T().notes.length, D().x.sync, sent(T(), 'seq').at(-1).s.sync], [0, true, true], 'the notice: the notes gone, SYNC on');
    cv.redo();
    assert.deepEqual([T().notes.length, D().x.sync], [want.length, false], '↷: the notes and SYNC off again');
    cv.undo();
    assert.deepEqual([T().notes.length, D().x.sync, sent(T(), 'seq').at(-1).s.sync], [0, true, true], 'the project\'s ↶: both');
  } finally { P().loop = L0; }
});

test('review 1 #4 (the lead\'s decision): → Piano roll writes the project tempo into the 606\'s own TEMPO — the SYNC-off machine\'s stopped clock (the open hat\'s cut after ■) is the synced pattern\'s; one undo with the rest (the notice, ↶ / ↷, the notice under a later step)', async () => {
  const t = T(), L0 = P().loop, bpm0 = P().bpm;
  P().loop = Object.assign({}, L0, { on: true, start: 0, end: 4 * BAR });
  try {
    cv.setProjectBpm(100);
    assert.deepEqual([D().x.sync, D().ui.tempo, sent(t, 'seq').at(-1).s.bpm], [true, 120, 120], 'synced: its own TEMPO untouched');
    const n0 = sent(t, 'seq').length;
    DR().toRoll(2);
    assert.deepEqual([D().x.sync, D().ui.tempo, sent(t, 'seq').length - n0, sent(t, 'seq').at(-1).s.sync, sent(t, 'seq').at(-1).s.bpm], [false, 100, 1, false, 100], 'SYNC off at the project\'s tempo: one payload');
    sim.$('#notice').onclick();
    assert.deepEqual([T().notes.length, D().x.sync, D().ui.tempo, sent(t, 'seq').at(-1).s.sync, sent(t, 'seq').at(-1).s.bpm], [0, true, 120, true, 120], 'the notice: the notes gone, SYNC on, its TEMPO back');
    cv.redo();
    assert.deepEqual([D().x.sync, D().ui.tempo, sent(T(), 'seq').at(-1).s.bpm], [false, 100, 100], '↷');
    cv.undo();
    assert.deepEqual([D().x.sync, D().ui.tempo, sent(T(), 'seq').at(-1).s.bpm], [true, 120, 120], '↶');
    // a later History step on top: the notice's tap puts the notes, SYNC and TEMPO back as a step of its own
    DR().toRoll(1);
    cv.hist.record(P(), 'Later');
    sim.$('#notice').onclick();
    assert.deepEqual([T().notes.length, D().x.sync, D().ui.tempo, sent(T(), 'seq').at(-1).s.sync, sent(T(), 'seq').at(-1).s.bpm], [0, true, 120, true, 120]);
    // the project at 120 (= its TEMPO): nothing to write
    cv.setProjectBpm(120); const D0 = D();
    DR().toRoll(1);
    assert.deepEqual([D().x.sync, D().ui.tempo, D().ui === D0.ui], [false, 120, true]);
    cv.undo();
  } finally { P().loop = L0; cv.setProjectBpm(bpm0); }
  assert.deepEqual([D().x.sync, T().notes.length, P().bpm], [true, 0, bpm0]);
});

const ping = f => { const sr = sim.ctx().sampleRate, L = new Float32Array(4800); for (let i = 0; i < L.length; i++) L[i] = Math.sin(2 * Math.PI * f * i / sr) * Math.exp(-i / 1200) * 0.9; return L; };
const slotOn = async (t, s, id) => { // (a slot switched on: its entry first, then the payload naming it)
  for (let i = 0; i < 40 && !sent(t, 'seq').some(m => m.s.smp && m.s.smp[s] && m.s.smp[s].id === id && m.s.smp[s].on); i++) await sim.settle(5);
};

test('your own sound in the 606\'s SD slot (§5): its entry (2 levels) before the payload naming it, and it plays; relinked through the asset manager (tables.relink → drumEdit) the record stays a 606\'s — its patterns, chains and tracks kept (review #4); a project with an 808 and a 606 saved and reopened is the same two machines; the saved schema is the build\'s (an older build opens it read-only)', async () => {
  const t = T(), sr = sim.ctx().sampleRate;
  const r = await cv.drumLoad(view(), 'sd', [{ name: 'my snare.wav', data: wavFile({ ch: [ping(900)], rate: sr }) }]);
  assert.equal(!!r && /^smp:[0-9a-f]{16}$/.test(r.id), true, 'imported');
  const k0 = node(t).posted.length;
  DR().press({ k: 'smp', sound: 'sd', slot: { id: r.id, name: r.name, on: true } });
  await slotOn(t, 1, r.id);
  const ms = node(t).posted.slice(k0).map(x => x.m), iE = ms.findIndex(m => m.t === 'smp' && m.id === r.id), iP = ms.findIndex(m => m.t === 'seq' && m.s.smp && m.s.smp[1] && m.s.smp[1].on);
  assert.equal(iE >= 0 && iP > iE, true, `the {t: 'smp'} entry (${iE}) before the payload naming it (${iP})`);
  assert.deepEqual([ms[iE].levels.length, ms[iP].s.m, api.tables.needs.get(t.id).join()], [2, 'tr606', r.id], 'two playback levels (TUNE ± 1 octave); the track needs it');
  sim.run(2 * sr); api.noteOn(38, 1, 1);
  const out = sim.run(Math.round(0.05 * sr)).get(node(t)); api.noteOff(38, 1);
  assert.ok(peak(out.L) > 0.05, 'the sample plays');
  // the asset manager's relink (a missing file replaced): the slot's id moves, nothing else does
  const r2 = await cv.drumLoad(view(), 'sd', [{ name: 'other snare.wav', data: wavFile({ ch: [ping(600)], rate: sr }) }]);
  DR().press({ k: 'mode', v: DC.M6_TW }); DR().press({ k: 'mode', v: DC.M6_PP }); // (a mode turned and back: the record's ui as it is)
  const was = JSON.stringify(Object.assign({}, D(), { smp: null }));
  await api.tables.relink(r.id, r2.id); await settle();
  assert.deepEqual([D().m, D().smp.sd.id, JSON.stringify(Object.assign({}, D(), { smp: null })) === was], ['tr606', r2.id, true], 'a 606\'s record, the slot relinked, the rest kept');
  assert.deepEqual([D().rt.slice(0, 3).join(), D().dc[0], D().st[1].join()], ['0,1,0', 2, DC.DEMO606.b.join()], 'the track and the patterns');
  await slotOn(t, 1, r2.id);
  assert.equal(sent(t, 'seq').at(-1).s.m, 'tr606', 'its payload a 606\'s');
  ID.smp = r2.id;
  // a project with an 808 beside it: Save, reopen — both machines, both records
  const t8 = api.addTrack(TR808); sim.raf(); await settle();
  DR().demo(); await settle();
  const txt = await cv.projectFile(), o = JSON.parse(txt);
  assert.deepEqual([o.schema, CM.SCHEMA, !!(o.smps && o.smps[r2.id])], [CM.SCHEMA, CM.SCHEMA, true], 'the saved schema follows this build\'s (7c: 10); the sample embedded');
  const p = acc.loadProject(JSON.parse(txt), { file: true });
  const a = p.tracks.find(x => x.id === t.id), b = p.tracks.find(x => x.id === t8.id);
  assert.deepEqual([CMOD.instOf(a).model, CMOD.instOf(b).model], ['tr606', 'tr808']);
  assert.deepEqual([JSON.stringify(CMOD.instOf(a).drum) === JSON.stringify(D(byId(t.id))), JSON.stringify(CMOD.instOf(b).drum) === JSON.stringify(D(byId(t8.id)))], [true, true], 'both records round-trip');
  assert.equal(CMOD.instOf(b).drum.m, undefined, 'the 808\'s record: no m (7a\'s shape)');
  // a schema-8 build's gate (schema > its SCHEMA: read-only) is the one this build applies to SCHEMA + 1
  assert.equal(o.schema > 8, true);
  const p10 = acc.loadProject(Object.assign(JSON.parse(txt), { schema: CM.SCHEMA + 1 }), { file: true });
  assert.equal(p10.newerSchema, CM.SCHEMA + 1, 'a newer file opens read-only');
  api.deleteTrack(byId(t8.id)); sim.raf(); await settle();
  api.selectTrack(ID.t); sim.raf(); await settle();
});

// an asset wait (tables.ready false: an entry being built) held open until release() — graph-host's holdAssets: the patch
// (and a graphed node's whole post) waits for it, a drum payload does not
function holdAssets() {
  const Tb = api.tables, r0 = Tb.ready, e0 = Tb.ensure, res = [];
  Tb.ready = () => false;
  Tb.ensure = () => new Promise(r => res.push(r));
  return async () => { Tb.ready = r0; Tb.ensure = e0; for (const r of res.splice(0)) r(); await sim.settle(5); };
}
const steps = async id => { // (1.2 s from bar 1: the machine's step posts)
  const sr = sim.ctx().sampleRate;
  node(T()).got.length = 0; api.transport().pos = 0;
  sim.$('#tPlay').onclick(); await sim.settle(5);
  sim.run(Math.round(1.2 * sr));
  sim.$('#tPlay').onclick(); await sim.settle(5);
  sim.run(Math.round(0.3 * sr));
  return got(T(), 'step').filter(q => (id == null ? q.i == null : q.i === id)).length;
};
const instOfNode = (t, id) => { const pr = node(t).proc; return id == null ? pr.i0 : pr.insts.find(x => x.id === id); };
const isPatchOf = (m, mach, id) => m.t === 'patch' && (id == null ? m.i === undefined : m.i === id) && m.p.engine === 'drums' && (m.p.machine === undefined ? 'tr808' : m.p.machine) === mach;

test('808 ↔ 606 (§1.5, §6, review #2): Replace with the other machine and its ↶ / ↷ twice — plain and as a graphed node\'s second instrument, each time with an asset still building so the patch waits: the new machine\'s payload (m names it) goes first, waits in the engine, and its synced steps play every time; the record and the panel\'s session are that machine\'s', async () => {
  for (const how of ['plain', 'graphed']) {
    api.addTrack(MOOG); sim.raf(); await settle();
    let id = null;
    if (how === 'plain') { sh.shell.tiles.setView('drums'); sh.srcPick('tr606', 'replace'); sim.raf(); await settle(); } else { id = cv.add('tr606', { x: 0, y: 1400 }); sim.raf(); await settle(); }
    const v = () => (id == null ? view() : cv.view1e(id)), dev = () => (id == null ? CMOD.primId(T()) : id), A = () => cv.drum.api(v()), rec = () => cv.drumOf(T(), dev());
    const mach = () => I(T(), dev()).model, sess = () => (Array.isArray(A().state().S.held) ? 'tr606' : 'tr808');
    // each machine with its demo and a sample slot on (the slot: the track's patch has needs, so a held asset makes it wait)
    const prep = async () => { A().demo(); A().press({ k: 'smp', sound: 'sd', slot: { id: ID.smp, name: 'snare', on: true } }); await settle(); };
    await prep();
    const n6 = await steps(id);
    assert.deepEqual([mach(), rec().m, sess(), n6 > 0, instOfNode(T(), id).dm._mach], ['tr606', 'tr606', 'tr606', true, 'tr606'], how + ': the 606 plays');
    if (how === 'plain') { sh.srcPick('tr808', 'replace'); sim.raf(); await settle(); assert.match(note(), /^Replaced TR-606 with TR-808 · tap to undo$/); } else { cv.setTrackModel(v(), 'tr808'); sim.raf(); await settle(); }
    assert.deepEqual([mach(), rec().m, JSON.stringify(rec()) === JSON.stringify(DC.normDrum(undefined))], ['tr808', undefined, true], how + ': the 808 arrives with its own empty record');
    await prep();
    const n8 = await steps(id);
    assert.deepEqual([sess(), n8 > 0, instOfNode(T(), id).dm._mach], ['tr808', true, 'tr808'], how + ': the 808 plays');
    for (const k of [1, 2]) {
      for (const [dir, want, n] of [['undo', 'tr606', n6], ['redo', 'tr808', n8]]) {
        const k0 = node(T()).posted.length, release = holdAssets();
        try { if (dir === 'undo') cv.undo(); else cv.redo(); sim.raf(); await sim.settle(3); } finally {
          const ms = node(T()).posted.slice(k0).map(x => x.m);
          assert.deepEqual([ms.some(m => m.t === 'seq' && (m.s.m || 'tr808') === want), ms.some(m => isPatchOf(m, want, id))], [true, false], `${how} ${dir} ${k}: the payload posted, the patch waiting`);
          await release();
        }
        sim.raf(); await settle();
        const ms = node(T()).posted.slice(k0).map(x => x.m), iS = ms.findIndex(m => m.t === 'seq' && (m.s.m || 'tr808') === want), iP = ms.findIndex(m => isPatchOf(m, want, id));
        assert.equal(iS >= 0 && iP > iS, true, `${how} ${dir} ${k}: the ${want}'s payload (${iS}) before its patch (${iP})`);
        assert.deepEqual([mach(), rec().m || 'tr808', sess(), await steps(id), instOfNode(T(), id).dm._mach], [want, want, want, n, want], `${how} ${dir} ${k}: the ${want}'s record and session; its synced steps play`);
      }
    }
    api.deleteTrack(T()); sim.raf(); await settle();
  }
  api.selectTrack(ID.t); sim.raf(); await settle();
});

const linkBtn = () => walk(cv.panel().root, n => /\bdr-link\b/.test(n.className || ''))[0];
const q3 = () => api.seqOf(byId(ID.t3));

test('SYNC 303s (§3.8, §13 Q1): the button follows the project\'s TB-303s — "303s synced" (disabled) while all are, "Sync 303s" once a 303\'s own SYNC goes off (the host\'s link303(): repainted, nothing pressed on the 606); a tap switches every 303 to SYNC, stops its free run, sets its swing to 4 · (P − 50) — clamped at 50 (62.5 %) and said; the notice puts sync, run and swing back; an open TB-303 panel shows what it wrote', async () => {
  sim.raf();
  let b = linkBtn();
  assert.deepEqual([!!b, b.hidden, b.textContent, attr(b, 'aria-disabled')], [true, false, '303s synced', 'true'], 'the Bass 303 synced (the fixture)');
  assert.deepEqual([DR().n303().n, DR().n303().synced], [1, true]);
  // the 303's own SYNC off (its panel's button: q.sync, then its payload) and its Run on, swing 0
  q3().sync = false; q3().swing = 0; api.seqRun.add(ID.t3); api.seqSend(byId(ID.t3));
  sim.raf(); sim.raf();
  b = linkBtn();
  assert.deepEqual([b.textContent, attr(b, 'aria-disabled'), DR().n303().synced], ['Sync 303s', undefined, false], 'repainted: a 303 on its own clock');
  DR().press({ k: 'swing', v: 58 });
  const t3 = byId(ID.t3), n3 = node(t3).posted.length;
  DR().link();
  const p3 = node(t3).posted.slice(n3).map(x => x.m).filter(m => m.t === 'seq');
  assert.deepEqual([q3().sync, q3().swing, api.seqRun.has(ID.t3), p3.length, p3.at(-1).s.sync, p3.at(-1).s.run, p3.at(-1).s.swing], [true, 32, false, 1, true, false, 0.16], 'SYNC on, its run stopped, swing 32 (the 606\'s 58 %): one payload');
  assert.equal(note(), '1 TB-303 now follows the song · tap to undo');
  sim.raf();
  assert.deepEqual([linkBtn().textContent, attr(linkBtn(), 'aria-disabled')], ['303s synced', 'true']);
  sim.$('#notice').onclick();
  assert.deepEqual([q3().sync, q3().swing, api.seqRun.has(ID.t3), sent(t3, 'seq').at(-1).s.run, sent(t3, 'seq').at(-1).s.sync], [false, 0, true, true, false], 'the notice: sync, swing and run back');
  sim.raf();
  assert.equal(linkBtn().textContent, 'Sync 303s');
  // above 62.5 %: the 303's most (50), said
  DR().press({ k: 'swing', v: 70 });
  DR().link();
  assert.deepEqual([q3().swing, note()], [50, '1 TB-303 now follows the song, swung as far as the TB-303 swings · tap to undo']);
  sim.$('#notice').onclick();
  // an open TB-303 panel reads its SYNC / Run / SWING when built: the Bass track shown, the 606's SYNC 303s from its api
  const t606 = byId(ID.t);
  api.selectTrack(ID.t3); sim.raf(); await settle();
  let S3 = cv.panel().seq;
  assert.deepEqual([S3.sync.textContent, S3.run.disabled], ['Sync to song', false]);
  DR(t606).press({ k: 'swing', v: 54 }); DR(t606).link();
  S3 = cv.panel().seq;
  const sw = walk(S3.swing, n => /\bnum\b/.test(n.className || ''))[0];
  assert.deepEqual([S3.sync.textContent, S3.run.disabled, sw.textContent], ['⛓ Synced to song', true, '16%'], 'its panel shows SYNC, Run off, SWING 16 (54 %)');
  sim.$('#notice').onclick();
  assert.deepEqual([cv.panel().seq.sync.textContent, cv.panel().seq.run.disabled, q3().swing], ['Sync to song', false, 0], 'and the undo');
  api.seqRun.delete(ID.t3); api.seqSend(byId(ID.t3)); // (its free run off for the rest)
  DR(t606).press({ k: 'swing', v: 50 });
  api.selectTrack(ID.t); sim.raf(); await settle();
});

test('the offer (§3.8): a 606 arriving beside a TB-303 on its own clock — after the Replace\'s own notice, once per project in a session; its tap is SYNC 303s', async () => {
  assert.equal(q3().sync, false, '(the Bass 303 on its own clock)');
  api.addTrack(MOOG); sim.raf(); await settle();
  sh.shell.tiles.setView('drums'); sh.srcPick('tr606', 'replace'); sim.raf(); await settle();
  const a = T();
  assert.deepEqual([I(a).model, note()], ['tr606', 'The TB-303 on “Bass” runs on its own clock — sync it to the song so the two play locked? · Sync']);
  sim.$('#notice').onclick();
  assert.deepEqual([q3().sync, q3().swing, note()], [true, 0, '1 TB-303 now follows the song · tap to undo'], 'its tap: SYNC 303s (this 606 at 50 %: swing 0)');
  // once: the 303 on its own clock again, another 606 (+ Track from the Drums view) — no offer
  q3().sync = false; api.seqSend(byId(ID.t3));
  sh.srcPick('tr606', 'track'); sim.raf(); await settle();
  assert.deepEqual([I(T()).model, /own clock/.test(note())], ['tr606', false], 'no second offer');
  api.deleteTrack(T()); sim.raf(); await settle();
  api.deleteTrack(byId(a.id)); sim.raf(); await settle();
  q3().sync = true; api.seqSend(byId(ID.t3));
  api.selectTrack(ID.t); sim.raf(); await settle();
});

const setNotes = q => { T().notes = q.map(([t, n], k) => ({ id: 'rv' + k, t, d: 120, n, v: 100 })); api.postTo(T(), Object.assign({ t: 'song' }, api.songData(T()))); };

test('bounce = live with SYNC off (§4.4, 7a review 1 F1 on the 606): a graphed node\'s 606 (a second instrument) plays its roll notes through its payload — HT mapped to 60, which only the 606\'s map knows — and a synced 606 with no notes bounces', async () => {
  const t = api.addTrack(MOOG); sim.raf(); await settle();
  const L0 = P().loop;
  t.solo = true; P().loop = Object.assign({}, L0, { on: false, start: 0, end: BAR });
  try {
    const id = cv.add('tr606', { x: 0, y: 1400 }); sim.raf(); await settle();
    cv.power(CMOD.primId(T()), false); sim.raf(); await settle(); // (the Minimoog silent)
    const A = cv.drum.api(cv.view1e(id));
    A.demo(); await settle();
    let B = await bounceL();
    assert.deepEqual([!!sim.lastOffline.nodes[0].po.graph, sim.lastOffline.nodes[0].po.seqs[id].m, sim.lastOffline.nodes[0].po.seqs[id].sync], [true, 'tr606', true]);
    assert.ok(peak(B) > 0.05, 'the synced 606, no notes: audible (' + peak(B).toFixed(3) + ')');
    A.press({ k: 'sync', v: false }); A.press({ k: 'map', sound: 'ht', notes: [60] });
    setNotes([]); await settle();
    B = await bounceL();
    assert.deepEqual([B, sim.$('#bNote').textContent], [null, 'No audible tracks with notes in that range.'], 'SYNC off, no notes: nothing to bounce');
    setNotes([[0, 60]]); await settle();
    B = await bounceL();
    const po = sim.lastOffline.nodes[0].po.seqs[id];
    assert.deepEqual([po.m, po.sync, po.run, po.map[60]], ['tr606', false, false, 4], 'the payload rides the bounce: the 606\'s map (60 → HT), never running');
    assert.ok(peak(B) > 0.05, 'note 60 plays the high tom (' + peak(B).toFixed(3) + ')');
  } finally {
    P().loop = L0;
    api.deleteTrack(T()); sim.raf(); await settle();
    api.selectTrack(ID.t); sim.raf(); await settle();
  }
});
