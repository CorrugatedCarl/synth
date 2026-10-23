import './v8-guard.mjs';
// Stage 7c lane H1 (docs/canvas/IMPL-7c.md §10, §12.7): the TR-909 in the page simulation with the real engine — main.js's
// drum sites read the record's machine three ways (drumOf's guard, drumNeeds / drumLoad by PERS[model].sounds — the 909's
// rd / cr on ids 7 / 8 —, drTempoOf / drTempoPut), → Piano roll through drum-core's rollPlan / rollOpts (the flams' ticks
// at the project tempo), and review #1's host half: the offline session at the project tempo (a bounce's flams), the
// restore path's order (the sessions' tempo before the payloads). First the lead's fixture check (§11 phase 2): a 909 from
// the Drums view plays its DEMO synced from bar 3 — the step posts are the plan's, F on the 4-frame grid at its ticks'
// frames (SHUFFLE in whole ticks), each flam's second hit an event of its own at its tick's frame. Accessor-free: the app
// runs as a guard build (a track's v1 keys throw) — instruments read as devices (cv-model instOf), the panels through
// their device views and the __synthTest hooks. canvas-sim's scripted world; one boot; strings, numbers and booleans only
// into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/canvas-7c-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage, fakeIDB } from './fakes.mjs';
import * as CMOD from '../cv-model.js?v=9';
import * as DC from '../drum-core.js?v=9';
import * as CM from '../cv-migrate.js?v=9';
import * as AS from '../appstore.js?v=9';
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
const MOOG = MODELS.find(m => m.id === 'minimoog'), TR808 = MODELS.find(m => m.id === 'tr808'), TR606 = MODELS.find(m => m.id === 'tr606');
const heardF = () => sim.ctx().frames - api.outLatency() * sim.ctx().sampleRate; // (the frame leaving the speakers now)
const fr = (Tr, tick) => Tr.a.frame + (tick - Tr.a.tick) * Tr.a.fpt; // (a song tick's frame on the live clock)
const ID = {};
// the 909's presses (drum-core §3.3 inputs, through the host: the panel's own path)
const hold = (b, down) => DR().press({ k: 'hold', b, down });
const tap = (b, n) => DR().press(n ? { k: 'tap', b, n } : { k: 'tap', b });
const key = (n, o) => { DR().press(Object.assign({ k: 'key', n, down: true }, o)); DR().press({ k: 'key', n, down: false }); }; // (a step key's press and release)
const shift = f => { hold('shift', true); f(); hold('shift', false); };
// the machine's triggers as DrSeq fires them ({ F: the span start, m: the lanes, a: the per-voice accents }) — hooked on the
// live Inst's machine (dm.trig: a step, a flam's second hit, each its own call)
function trigLog(t) {
  const p = node(t).proc, dm = p.i0.dm, tr = dm.trig, log = [];
  dm.trig = function (m, a) { log.push({ F: p.spanF, m, a: a | 0 }); return tr.apply(this, arguments); };
  return { log, off: () => { dm.trig = tr; } };
}

test('the lead\'s fixture check (§11 phase 2): a 909 from the Sources tray\'s Drums view; its DEMO synced from bar 3 — the step posts are the plan\'s steps at the frames its ticks say (SHUFFLE 3: the even-numbered steps 40 whole ticks late), every sounding step one trigger at its post\'s frame with its accents, the snare flam\'s second hit an event of its own 35 ticks after its step; the panel at the heard post', async () => {
  const tiles = sh.shell.tiles;
  tiles.setView('drums');
  assert.deepEqual(tiles.tiles().filter(b => !b.hidden).map(b => b.getAttribute('data-model')), ['tr808', 'tr606', 'tr909', 'sdsv'], 'the Drums view lists the four machines (8: the SDS-V)');
  sh.srcPick('tr909', 'replace'); sim.raf(); await settle();
  const t = T(), d = I(t);
  assert.equal(d.model, 'tr909');
  assert.match(note(), /^Replaced Minimoog with TR-909 · tap to undo$/);
  assert.deepEqual([cv.instUi(t), cv.layFlow(t, CMOD.primId(t)), cv.srcUi('tr909')], ['hw', false, 'hw'], 'Hardware only');
  assert.deepEqual([D(t).m, JSON.stringify(D(t)) === JSON.stringify(DC.normDrum(undefined, 'tr909'))], ['tr909', true], 'a new 909: its own empty record (m tr909), the defaults (SYNC on)');
  assert.equal(DR().state().S.m, 'tr909', 'the panel\'s session is a 909\'s');
  // the face renders with api.drum: the 16 live step keys, the 12 pads, the display showing the tempo
  const root = cv.panel().root;
  assert.equal(!!cv.hw(), true, 'its Hardware panel');
  const keys = walk(root, n => attr(n, 'data-n') && /\bdr-key\b/.test(n.className || ''));
  assert.deepEqual([keys.length, keys.filter(k => attr(k, 'aria-disabled') === 'true').length], [16, 0], 'the 16 step keys, live');
  assert.equal(walk(root, n => attr(n, 'data-sound')).length, 12, 'the 12 pads (AC + the eleven sounds)');
  sim.raf();
  const dsp = walk(root, n => /\bdr-dsp\b/.test(n.className || ''))[0];
  assert.equal(dsp ? dsp.textContent : null, '120', 'the display: the tempo');
  // DEMO (its targets empty: no confirm) — I-1-1, I-1-2 block-played in PATTERN PLAY
  DR().demo();
  assert.deepEqual([D().st[0].join(), D().ac[0].join(), D().st[1].join(), D().fm[1].join(), D().keys[0].sh, D().keys[1].fl, D().ui.mode, D().ui.sel, D().ui.bl],
    [DC.DEMO909.a.st.join(), DC.DEMO909.a.ac.join(), DC.DEMO909.b.st.join(), DC.DEMO909.b.fm.join(), 3, 11, DC.M9_PP, 0, 1]);
  assert.match(note(), /^Demo loaded into patterns I-1-1 and I-1-2 · tap to undo$/);
  const plan = DC.compilePlan(D(), D().ui, D().x, DR().state().S), s0 = sent(t, 'seq').at(-1).s;
  assert.deepEqual([s0.m, s0.plan.key, plan.n, [...plan.mKey].join(), [...plan.mSh].join(), [...plan.mFl].join()], ['tr909', plan.key, 2, '0,1', '40,40', '0,35'],
    'the payload: the plan the panel compiles — SHUFFLE 3 = 40 ticks, the flam 18 ms = 35 ticks at 120 BPM (I-1-1 has none)');
  // START synced = the project's ▶ from bar 3; the machine's triggers logged at the span they fire in
  api.transport().pos = 2 * BAR;
  node(t).got.length = 0;
  const lg = trigLog(t);
  try {
    DR().press({ k: 'start' });
    await sim.settle(5);
    const Tr = api.transport();
    assert.deepEqual([Tr.playing, Tr.a.tick, DR().state().run], [true, 2 * BAR, true], 'START is the project\'s play; the session follows');
    sim.run(Math.ceil(fr(Tr, 4 * BAR) - sim.ctx().frames) - 128); // (bars 3 and 4: the last step's quantum, not bar 5's first)
    const posts = got(t, 'step');
    assert.equal(posts.length, 32, 'every step of two measures');
    posts.forEach((q, i) => {
      const M = 2 + (i >> 4), s = i & 15, m = M & 1, o = s * 240 + (s & 1 ? plan.mSh[m] : 0), tick = M * BAR + o;
      assert.deepEqual([q.M, q.s, q.m, q.k, q.v, q.p, q.f, q.o], [M, s, m, plan.mKey[m], 0, 0, 0, o], 'post ' + i + ': I-1-' + (m + 1) + ', the swung step in whole ticks');
      const dF = q.F - fr(Tr, tick);
      assert.ok(dF >= -1e-6 && dF < 8, `post ${i}: F ${q.F} on the 4-frame grid at its tick's frame (+${dF.toFixed(2)})`);
      assert.equal(q.F % 4, 0, 'a span start');
    });
    // each sounding step: one trigger at its post's frame — the plan's lanes (the AC bit TOTAL ACCENT) and per-voice accents
    const at = new Set(posts.map(q => q.F)), want = posts.filter(q => plan.st[plan.mOff[q.m] + q.s] & 0xFFE);
    const steps = lg.log.filter(x => at.has(x.F));
    assert.deepEqual(steps.map(x => [x.F, x.m, x.a].join(':')).join(), want.map(q => { const o = plan.mOff[q.m] + q.s; return [q.F, plan.st[o], plan.ac[o]].join(':'); }).join(), 'every sounding step triggered at its post\'s frame with its accents');
    assert.equal(want.some(q => plan.ac[plan.mOff[q.m] + q.s]) && want.some(q => plan.st[plan.mOff[q.m] + q.s] & 1), true, '(per-voice and total accents among them)');
    // the flam: I-1-2's snare on step 13 (bar 4) — its second hit 35 ticks later, its own trigger (no post there)
    const fl = posts.filter(q => plan.fl[plan.mOff[q.m] + q.s]);
    assert.deepEqual(fl.map(q => q.M + ':' + q.s).join(), '3:12', 'one flammed step: I-1-2\'s step 13');
    const q = fl[0], o = plan.mOff[q.m] + q.s, tick2 = q.M * BAR + q.o + plan.mFl[q.m];
    const sec = lg.log.filter(x => x.F > q.F && x.F < q.F + 240 * Tr.a.fpt);
    assert.deepEqual(sec.map(x => [x.m, x.a].join(':')).join(), [plan.fl[o] | (plan.st[o] & 1), plan.ac[o] & plan.fl[o]].join(':'), 'the second hit: the flammed lane (+ the step\'s TOTAL ACCENT), its accents');
    const dF = sec[0].F - fr(Tr, tick2);
    assert.ok(dF >= -1e-6 && dF < 8 && sec[0].F % 4 === 0, `the second hit at its tick's frame, on the 4-frame grid (+${dF.toFixed(2)})`);
    assert.equal(at.has(sec[0].F), false, 'no step post at the flam\'s frame');
    assert.equal(lg.log.filter(x => x.F >= posts[0].F && x.F <= posts.at(-1).F).length, want.length + 1, 'nothing else triggered');
  } finally { lg.off(); }
  // the heard time: the panel shows the post heard by now; PATTERN PLAY's chase on the heard step, PATTERN 1 lit
  await settle(2);
  const S = DR().state().S, heard = heardF(), sr = sim.ctx().sampleRate, posts = got(t, 'step');
  const last = posts.filter(x => x.F <= heard + sr / 60).at(-1);
  assert.deepEqual([S.pos.M, S.pos.s], [last.M, last.s], 'the panel at the heard post');
  const L = DC.leds(S, D());
  assert.deepEqual([L.step[last.s], L.step.filter(c => c).length, L.pat[0], L.disp], [1, 1, 1, '120'], 'the chase on the heard step; PATTERN 1 lit; the display the tempo');
  DR().press({ k: 'start' }); await sim.settle(5); // (stop)
  assert.equal(api.transport().playing, false);
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
const noLoop = () => { const L0 = P().loop; P().loop = Object.assign({}, L0, { on: false }); return () => { P().loop = L0; }; };
const peak = x => { let m = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; } return m; };

test('MIDI on the 909\'s receive notes (§1.4): 36 plays the kick, 51 the ride (id 7), 49 the crash (id 8) through the payload\'s map; 56 (the 808\'s cowbell) nothing', async () => {
  const t = T(), sr = sim.ctx().sampleRate, q = sent(t, 'seq').at(-1).s;
  assert.deepEqual([q.map[36], q.map[51], q.map[49], q.map[56], q.map[42], q.map[46]], [0, 7, 8, -1, 10, 9], 'the 909\'s map: the GM numbers');
  const hit = n => { sim.run(Math.round(2 * sr)); api.noteOn(n, 100 / 127, 1); const o = sim.run(Math.round(0.25 * sr)).get(node(t)); api.noteOff(n, 1); return peak(o.L); };
  const pk = [36, 51, 49, 56].map(hit);
  assert.ok(pk[0] > 0.05 && pk[1] > 0.05 && pk[2] > 0.05, 'the kick, the ride and the crash sound: ' + pk.map(x => x.toFixed(3)).join(' '));
  assert.ok(pk[3] < 1e-3, 'the cowbell\'s 56: nothing (' + pk[3].toExponential(2) + ')');
});

test('PATTERN WRITE running (§3.3): INSTRUMENT SELECT + key 3 picks the snare; a step key cycles off → normal → accented → off in place (one \'now\' payload each, the shape kept; the LEDs dim, then bright); SHUFFLE/FLAM + 7 / + 16 and a snare flam (flam write) heard from the next measure — the swung steps 120 ticks late, the flam\'s second hit 73 ticks after its step; LAST STEP + 12 at the bar; SCALE: 32nds; a chain (keys 3 + 4 + ENTER) played as one pattern; TRACK WRITE → TRACK PLAY: three measures written with ENTER, played in order; the display: the tempo, the pointer, the measure heard', async () => {
  const t = T(), back = noLoop();
  try {
    shift(() => tap('pat', 1)); // (PATTERN WRITE, STEP)
    key(3); // (stopped: I-1-3, empty, to edit)
    hold('isel', true); key(3); hold('isel', false);
    assert.deepEqual([D().ui.mode, D().ui.wm, D().ui.sel, D().ui.inst, D().ui.fw], [DC.M9_PW, 0, 2, 2, false], 'PATTERN WRITE on I-1-3, the snare');
    api.transport().pos = 0;
    await start(); await play(1);
    const n0 = sent(t, 'seq').length, sh0 = sent(t, 'seq').at(-1).s.plan.shape, cyc = [], lit = [];
    for (let i = 0; i < 3; i++) {
      key(10);
      cyc.push([(D().st[2][9] >> 2) & 1, (D().ac[2][9] >> 2) & 1].join(''));
      const S = DR().state().S, c = DC.leds(S, D()).step[9], w = [5, 1, 0][i]; // (dim, on, off — under the heard playhead 4 / 3)
      lit.push(c === (S.pos && S.pos.k === 2 && S.pos.s === 9 ? (w ? 4 : 3) : w));
    }
    const q = sent(t, 'seq').slice(n0).map(m => m.s);
    assert.deepEqual([cyc.join(), q.length, q.every(s => s.at === 'now' && s.plan.shape === sh0)], ['10,11,00', 3, true], 'off → normal → accented → off, each one \'now\' payload, in place');
    assert.deepEqual(lit, [true, true, true], 'the LED: dim (normal), bright (accented), off');
    // SHUFFLE/FLAM + 7 and + 16; INSTRUMENT SELECT + 3 + 4 together: flam write on the snare; key 5 its flam
    hold('shuf', true); key(7); key(16); hold('shuf', false);
    assert.deepEqual([D().keys[2].sh, D().keys[2].fl], [7, 16]);
    hold('isel', true);
    DR().press({ k: 'key', n: 3, down: true }); DR().press({ k: 'key', n: 4, down: true }); DR().press({ k: 'key', n: 4, down: false }); DR().press({ k: 'key', n: 3, down: false });
    hold('isel', false);
    assert.equal(D().ui.fw, true, 'flam write on the snare');
    key(5);
    assert.equal((D().fm[2][4] >> 2) & 1, 1, 'a flam on step 5');
    const pl = sent(t, 'seq').at(-1).s.plan;
    assert.deepEqual([pl.mSh[0], pl.mFl[0]], [120, 73], 'SHUFFLE 7 = 120 ticks; FLAM 16 = 38 ms = 73 ticks at 120 BPM');
    node(t).got.length = 0;
    const lg = trigLog(t);
    let Tr = api.transport();
    try { await play(2.25); } finally { lg.off(); }
    let ps = stepPosts(t), j = ps.findIndex(x => x.s === 0 && x.o === 0 && ps.slice(ps.indexOf(x) + 1, ps.indexOf(x) + 2).every(y => y.o === 240 + 120));
    assert.ok(j >= 0, 'a measure heard with the new shuffle: ' + ps.slice(0, 20).map(x => x.s + ':' + x.o).join());
    const mz = ps.slice(j, j + 16);
    assert.equal(mz.map(x => x.o).join(), [...Array(16)].map((_, s) => s * 240 + (s & 1 ? 120 : 0)).join(), 'the even-numbered steps 120 ticks late');
    const p5 = mz[4], f2 = lg.log.filter(x => x.F > p5.F && x.F < p5.F + 240 * Tr.a.fpt);
    assert.deepEqual([f2.length, f2.length && f2[0].m & 4, f2.length && Math.round((f2[0].F - p5.F) / Tr.a.fpt)], [1, 4, 73], 'the flam\'s second hit 73 ticks after step 5');
    // LAST STEP + 12: it shortens the bar under the playhead — at the bar; twelve-step measures after it
    hold('last', true); key(12); hold('last', false);
    assert.deepEqual([D().keys[2].l1, sent(t, 'seq').at(-1).s.at], [12, 'bar']);
    node(t).got.length = 0;
    await play(2.5);
    ps = stepPosts(t);
    const s0 = ps.map((x, i) => (x.s === 0 ? i : -1)).filter(i => i >= 0);
    assert.equal(s0.length >= 2 && s0[s0.length - 1] - s0[s0.length - 2], 12, 'twelve-step measures');
    // SCALE (running PATTERN WRITE): 32nds, LAST STEP 16; SHUFFLE 7 on 32nds is 60 ticks (20 · ⌊6 / 2⌋)
    tap('scale');
    assert.deepEqual([D().keys[2].sc, D().keys[2].l1, sent(t, 'seq').at(-1).s.plan.mPre[0], sent(t, 'seq').at(-1).s.plan.mSh[0]], [2, 16, DC.SC_CODE[2], 60]);
    node(t).got.length = 0;
    await play(2.25);
    ps = stepPosts(t);
    const k32 = ps.findIndex((x, i) => x.s === 0 && i + 3 < ps.length && ps[i + 1].o === 180);
    assert.equal(ps.slice(k32, k32 + 4).map(x => x.o).join(), '0,180,240,420', 'thirty-seconds, the even ones 60 ticks late');
    await start(); // (stop)
    // the display (PATTERN modes: the tempo)
    assert.equal(DC.leds(DR().state().S, D()).disp, '120');
    // a chain (PATTERN WRITE, stopped): keys 3 + 4 held, ENTER — I-1-3 → I-1-4; PATTERN PLAY's key 3 plays the chain as one pattern
    DR().press({ k: 'key', n: 3, down: true }); DR().press({ k: 'key', n: 4, down: true }); tap('enter'); DR().press({ k: 'key', n: 4, down: false }); DR().press({ k: 'key', n: 3, down: false });
    assert.deepEqual([D().keys[2].ch, D().keys[3].ch], [1, 0], 'chained: I-1-3 → I-1-4');
    tap('pat', 1); key(3);
    assert.deepEqual([D().ui.mode, D().ui.sel, D().ui.bl], [DC.M9_PP, 2, 0]);
    node(t).got.length = 0; api.transport().pos = 0;
    await start(); await play(2.25); await start();
    assert.equal(firsts(t).slice(0, 3).map(x => x.k).join(), '2,3,2', 'I-1-3 (32nds: half a bar), I-1-4, round again');
    // TRACK WRITE (SHIFT + TRACK 1): PATTERN 1 + a key, ENTER — three measures; the display the pointer
    shift(() => tap('trk', 1));
    assert.equal(D().ui.mode, DC.M9_TW);
    for (const n of [1, 2, 1]) { tap('pat', 1); key(n); tap('enter'); }
    assert.deepEqual([D().tk[0].join(), DC.leds(DR().state().S, D()).disp], ['0,1,0', '  4'], 'track 1: I-1-1, I-1-2, I-1-1; the pointer past them');
    // TRACK PLAY (TRACK 1): the three measures in order, looping; the display the measure heard
    tap('trk', 1);
    assert.equal(D().ui.mode, DC.M9_TP);
    node(t).got.length = 0; api.transport().pos = 0;
    await start(); await play(4.5);
    assert.equal(firsts(t).slice(0, 4).map(x => x.k).join(), '0,1,0,0', 'I-1-1, I-1-2, I-1-1, then round again');
    const S = DR().state().S;
    assert.equal(DC.leds(S, D()).disp, String(S.pos.m + 1).padStart(3, ' '), 'the display: the measure heard');
    await start(); // (stop)
  } finally { back(); }
  // back to the DEMO's selection (PATTERN PLAY, I-1-1 … I-1-2); flam write off (one key of the pair again)
  hold('isel', true); key(3); hold('isel', false);
  DR().demo(); await settle();
  assert.deepEqual([D().ui.mode, D().ui.sel, D().ui.bl, D().ui.fw], [DC.M9_PP, 0, 1, false]);
});

const kOf = n => walk(cv.panel().root, x => attr(x, 'data-n') === String(n) && /\bdr-key\b/.test(x.className || ''))[0];
const kptr = (el, type, id) => el.dispatchEvent({ type, target: el, currentTarget: el, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: id, pointerType: 'touch', isPrimary: false,
  clientX: 10, clientY: 10, timeStamp: performance.now(), shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} });
const tapWrite = () => { shift(() => tap('pat', 1)); key(4); shift(() => tap('back')); }; // (PATTERN WRITE on I-1-4 — stopped: the key picks it —, TAP)

test('TAP write (§3.3, §7.4): the step keys are drum pads — two fingers on keys 1 and 4 play the kick accented (v 110) and the snare (v 100) through the track\'s note path and write them at the nearest step of the edited pattern; 13 + 14 play the open hat and take the closed hat back off its step; the offs at the lifts', async () => {
  const t = T();
  tapWrite();
  assert.deepEqual([D().ui.mode, D().ui.wm, D().ui.sel], [DC.M9_PW, 1, 3], 'PATTERN WRITE / TAP on I-1-4');
  sim.raf();
  api.transport().pos = 0;
  await start(); await play(0.6);
  let n0 = node(t).posted.length;
  kptr(kOf(1), 'pointerdown', 81); kptr(kOf(4), 'pointerdown', 82);
  let on = node(t).posted.slice(n0).map(x => x.m).filter(m => m.t === 'on');
  assert.deepEqual(on.map(m => m.n + ':' + Math.round(m.v * 127)).join(), '36:110,38:100', 'two hits: the kick accented, the snare');
  kptr(kOf(1), 'pointerup', 81); kptr(kOf(4), 'pointerup', 82);
  assert.equal(node(t).posted.slice(n0).map(x => x.m).filter(m => m.t === 'off').map(m => m.n).join(), '36,38', 'their offs at the lifts');
  const st = D().st[3], ac = D().ac[3], bd = st.map((m, s) => (m & 2 ? s : -1)).filter(s => s >= 0), sd = st.map((m, s) => (m & 4 ? s : -1)).filter(s => s >= 0);
  assert.deepEqual([bd.length, sd.length, bd[0] === sd[0], (ac[bd[0]] >> 1) & 1, (ac[sd[0]] >> 2) & 1], [1, 1, true, 1, 0], 'written at the nearest step: the kick accented, the snare normal');
  // 13 + 14: key 13's down plays and writes an accented closed hat; 14's turns it into the open hat on that step
  n0 = node(t).posted.length;
  kptr(kOf(13), 'pointerdown', 83);
  const ch = D().st[3].findIndex(m => m & 0x800);
  assert.equal(ch >= 0 && ((D().ac[3][ch] >> 11) & 1) === 1, true, 'key 13: an accented closed hat written');
  kptr(kOf(14), 'pointerdown', 84);
  on = node(t).posted.slice(n0).map(x => x.m).filter(m => m.t === 'on');
  assert.deepEqual([on.map(m => m.n + ':' + Math.round(m.v * 127)).join(), D().st[3].some(m => m & 0x800), D().st[3].findIndex(m => m & 0x400)], ['42:110,46:100', false, ch], 'the open hat played and written there, the closed hat taken back');
  kptr(kOf(13), 'pointerup', 83); kptr(kOf(14), 'pointerup', 84);
  const offs = node(t).posted.slice(n0).map(x => x.m).filter(m => m.t === 'off').map(m => m.n);
  assert.deepEqual([offs.includes(42), offs.includes(46), DR().state().S.hits.length], [true, true, 0], 'every note it played let go');
  await start(); // (stop)
  DR().demo(); await settle();
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
const nkey = x => [x.t, x.d, x.n, x.v].join(':');
const sorted = q => q.slice().sort((a, b) => a.t - b.t || a.n - b.n);

test('→ Piano roll (§4, §10): the roll\'s eleven named rows (Ride 51 on id 7, Crash 49 on id 8); at 120 BPM the DEMO\'s four bars as notes — the flams as note pairs, v 100 / 110 / 119 / 127 — that bounce bit-identically to the synced pattern (D5), a synced 909 with no notes bouncing too; at 97 BPM the notes are the synced sequencer\'s (rollPlan at the project tempo: the flam 28 ticks); the notice\'s undo, ↶ / ↷ — the record stays a 909\'s, its TEMPO back; MAP… (the ride on 59) and its reset', async () => {
  const t = T(), L0 = P().loop;
  P().loop = Object.assign({}, L0, { on: true, start: 0, end: 4 * BAR });
  try {
    const R = api.roll().drumRows();
    assert.equal(R.rows.map(r => r.name + ' ' + r.n).join(), 'Kick 36,Snare 38,Low tom 41,Mid tom 45,Hi tom 48,Rim shot 37,Hand clap 39,Ride 51,Crash 49,Open hat 46,Closed hat 42', 'the roll: the 909\'s eleven rows');
    assert.deepEqual(DC.drumRows(D().map, 'tr909').filter(r => r.n === 51 || r.n === 49).map(r => r.name + ' ' + r.s), ['Ride 7', 'Crash 8'], 'ride and crash on sound ids 7 / 8');
    assert.deepEqual([api.transport().playing, D().x.sync, T().notes.length, P().bpm], [false, true, 0, 120]);
    api.transport().pos = 0;
    const A = await bounceL();
    assert.ok(A && peak(A) > 0.05, 'a synced 909 with no notes bounces (audible)');
    const D0 = D(), want = DC.toNotes(DC.rollPlan(D0, 120), Object.assign({ t0: 0, t1: 4 * BAR }, DC.rollOpts(D0, I(t))));
    DR().toRoll(4);
    const notes = sorted(T().notes);
    assert.equal(notes.map(nkey).join(), want.map(nkey).join(), 'four bars of the DEMO as notes (the synced sequencer\'s)');
    assert.deepEqual([[...new Set(notes.map(x => x.v))].sort().join(), notes.filter(x => x.n === 51).length, notes.filter(x => x.n === 49).length],
      ['100,110,119,127', 16, 2], 'every state\'s velocity; the ride\'s eighths on 51 (I-1-2), the crash on 49 (I-1-1)');
    const sd = notes.filter(x => x.n === 38 && x.t % BAR === 2880 || (x.n === 38 && x.t % BAR === 2880 + 35));
    assert.deepEqual(sd.map(x => (x.t % BAR) + ':' + x.d).join(), '2880:35,2915:85,2880:35,2915:85', 'the snare flam (bars 2 and 4): its first note ends where the second starts (35 ticks), the second ends on the step grid');
    assert.match(note(), /^Written to the piano roll · the 909’s own sequencer is off so it isn’t heard twice · tap to undo$/);
    assert.deepEqual([D().x.sync, D().ui.tempo, D().m, DR().state().run, sent(t, 'seq').at(-1).s.sync], [false, 120, 'tr909', false, false]);
    const B = await bounceL();
    const po = sim.lastOffline.nodes[0].po.seq;
    assert.deepEqual([po.m, po.sync, po.run], ['tr909', false, false], 'the bounce carries the 909\'s payload (SYNC off, never running)');
    assert.equal(maxDiff(A, B), 0, 'the notes bounce bit-identically to the synced pattern (120 BPM, 48 kHz: D5 — shuffle, the flam, every accent state)');
    sim.$('#notice').onclick();
    assert.deepEqual([T().notes.length, D().x.sync, D().m, sent(T(), 'seq').at(-1).s.sync], [0, true, 'tr909', true], 'the notice: the notes gone, SYNC on');
    // at 97 BPM: the notes are what the synced sequencer plays there — the flam's ticks at the project tempo
    cv.setProjectBpm(97);
    const D1 = D(), w97 = DC.toNotes(DC.rollPlan(D1, 97), Object.assign({ t0: 0, t1: 4 * BAR }, DC.rollOpts(D1, I(t))));
    assert.deepEqual([...DC.compilePlan(D1, D1.ui, D1.x, DR().state().S).mFl].join(), '0,28', '(the synced plan at 97: 28 ticks)');
    DR().toRoll(4);
    const n97 = sorted(T().notes);
    assert.equal(n97.map(nkey).join(), w97.map(nkey).join(), 'at 97 BPM: the synced sequencer\'s notes');
    assert.deepEqual(n97.filter(x => x.n === 38 && x.t % BAR >= 2880).map(x => x.t % BAR).join(), '2880,2908,2880,2908', 'the flam 28 ticks after its step');
    assert.deepEqual([D().x.sync, D().ui.tempo, D().m, sent(T(), 'seq').at(-1).s.bpm, sent(T(), 'seq').at(-1).s.m], [false, 97, 'tr909', 97, 'tr909'], 'SYNC off at the project\'s tempo: still a 909');
    sim.$('#notice').onclick();
    assert.deepEqual([T().notes.length, D().x.sync, D().ui.tempo, D().m, D().keys.length, sent(T(), 'seq').at(-1).s.m, sent(T(), 'seq').at(-1).s.sync], [0, true, 120, 'tr909', 96, 'tr909', true],
      'the notice\'s undo: the notes gone, SYNC on, its own TEMPO back — the record a 909\'s');
    cv.redo();
    assert.deepEqual([T().notes.length, D().x.sync, D().ui.tempo, D().m], [w97.length, false, 97, 'tr909'], '↷');
    cv.undo();
    assert.deepEqual([T().notes.length, D().x.sync, D().ui.tempo, D().m, sent(T(), 'seq').at(-1).s.m], [0, true, 120, 'tr909', 'tr909'], '↶');
    // MAP…: the ride on 59 alone (51 left silent) — the payload's note map and primary, the roll's row; MAP…'s reset
    DR().press({ k: 'map', sound: 'rd', notes: [59] });
    const s1 = sent(T(), 'seq').at(-1).s;
    assert.deepEqual([D().map.rd.join(), s1.map[59], s1.map[51], s1.prim[7], api.roll().drumRows().rows.find(r => r.name === 'Ride').n], ['59', 7, -1, 59, 59], 'MAP…: the ride on 59');
    DR().press({ k: 'mapReset' });
    assert.deepEqual([D().map.rd.join(), sent(T(), 'seq').at(-1).s.map[51], api.roll().drumRows().rows.find(r => r.name === 'Ride').n], ['51,59', 7, 51], 'reset: the GM numbers');
  } finally { P().loop = L0; cv.setProjectBpm(120); }
  assert.deepEqual([D().x.sync, T().notes.length, P().bpm, D().m], [true, 0, 120, 'tr909']);
});

// review 1 F2: a synced TRACK WRITE plays the session's pointer / chosen key (drum-core reads S.ptr / S.pend); the bounce's
// payload (a fresh session) and → Piano roll (no session) played the track's first measure — now drum-core's planSess carries
// them: the bounce = live, → Piano roll writes the measure heard
test('review 1 F2: a synced 909 in TRACK WRITE — the bounce plays the measure the pointer (or the chosen key) is on, as live; → Piano roll writes that measure, not the track\'s first', async () => {
  const t = T(), L0 = P().loop, ui0 = D().ui;
  // track 4 of bank I: I-1-1 (the DEMO's crash), I-1-2 (its ride) — TRACK WRITE, PATTERN 1 + key, ENTER twice
  shift(() => tap('trk', 4)); await settle();
  tap('pat', 1); key(1); tap('enter'); key(2); tap('enter'); await settle();
  assert.deepEqual([D().ui.mode, D().ui.trk, D().tk[3].join(), DR().state().S.ptr], [DC.M9_TW, 3, '0,1', 2]);
  tap('back'); await settle();                                                   // (the pointer on measure 2: I-1-2)
  P().loop = Object.assign({}, L0, { on: true, start: 0, end: BAR });
  try {
    const live = sent(t, 'seq').at(-1).s;
    assert.deepEqual([DR().state().S.ptr, [...live.plan.mKey].join()], [1, '1'], 'live: I-1-2');
    api.transport().pos = 0;
    await bounceL();
    let po = sim.lastOffline.nodes[0].po.seq;
    assert.deepEqual([[...po.plan.mKey].join(), po.plan.key, po.pk], ['1', live.plan.key, live.pk], 'the bounce\'s payload = the live one (I-1-2)');
    DR().toRoll(1); await settle();
    assert.deepEqual([T().notes.filter(x => x.n === 51).length, T().notes.filter(x => x.n === 49).length], [8, 0], '→ Piano roll: I-1-2 (its ride), not I-1-1 (its crash)');
    sim.$('#notice').onclick(); await settle();
    assert.deepEqual([T().notes.length, D().x.sync], [0, true]);
    // the chosen key: the pointer back on measure 1 (I-1-1), PATTERN 1 + key 2 chosen (I-1-2)
    tap('back'); tap('pat', 1); key(2); await settle();
    const S2 = DR().state().S, live2 = sent(t, 'seq').at(-1).s;
    assert.deepEqual([S2.ptr, S2.pend && S2.pend.sel, [...live2.plan.mKey].join()], [0, 1, '1']);
    await bounceL();
    po = sim.lastOffline.nodes[0].po.seq;
    assert.deepEqual([[...po.plan.mKey].join(), po.pk], ['1', live2.pk], 'the bounce plays the chosen key, as live');
    DR().toRoll(1); await settle();
    assert.deepEqual([T().notes.filter(x => x.n === 51).length, T().notes.filter(x => x.n === 49).length], [8, 0], '→ Piano roll: the chosen I-1-2');
    sim.$('#notice').onclick(); await settle();
  } finally { P().loop = L0; }
  tap('trk', 1); tap('pat', 1); key(ui0.sel + 1); if (ui0.bl) key(ui0.sel + ui0.bl + 1, { shift: true }); await settle();
  assert.deepEqual([D().ui.mode, D().ui.grp, D().ui.sel, D().ui.bl, T().notes.length], [DC.M9_PP, ui0.grp, ui0.sel, ui0.bl, 0], '(back in PATTERN PLAY: the DEMO\'s block)');
});

// review 1 F4: §3.3's [R] STOP/CONT — free, it continues where it stopped (the step after the last one played: those already
// rendered are heard through the output's latency), in a block's later pattern too; TRACK PLAY in its measure, at its step
test('review 1 F4: a free 909\'s STOP/CONT continues where it stopped — the DEMO block in its second pattern, the step after the last played; TRACK PLAY in the measure and at the step it stopped', async () => {
  const t = T(), ui0 = D().ui, runS = async s => { for (let i = 0, n = Math.round(s * 8); i < n; i++) { sim.run(Math.round(sim.ctx().sampleRate / 8)); sim.raf(); } await sim.settle(2); sim.raf(); };
  DR().press({ k: 'sync', v: false }); await settle();
  try {
    assert.deepEqual([D().ui.mode, D().ui.bl, D().x.sync], [DC.M9_PP, 1, false]);
    node(t).got.length = 0;
    tap('start'); await settle(); await runS(3.1);                             // (2 s a bar: in I-1-2)
    tap('stop'); await settle();
    const last = got(t, 'step').at(-1);
    await runS(1);
    assert.equal(got(t, 'step').at(-1), last, 'stopped: no step after');
    node(t).got.length = 0;
    tap('stop'); await settle(); await runS(0.6);
    const c = got(t, 'step');
    assert.deepEqual([c[0].k, c[0].s, c[1].s], [last.k, last.s + 1, last.s + 2], `continued after k${last.k} s${last.s}`);
    tap('stop'); await settle(); await runS(0.5);
    node(t).got.length = 0; tap('start'); await settle(); await runS(0.3);         // (START, stopped: from the top)
    assert.deepEqual([got(t, 'step')[0].k, got(t, 'step')[0].s], [0, 0], 'START: from the top');
    tap('stop'); await settle();
    // TRACK PLAY (track 4: I-1-1, I-1-2)
    tap('trk', 4); await settle();
    node(t).got.length = 0;
    tap('start'); await settle(); await runS(3.1);
    tap('stop'); await settle();
    const lt = got(t, 'step').at(-1);
    await runS(1);
    assert.deepEqual([lt.m, DR().state().S.loc], [1, 1], 'stopped in measure 2');
    node(t).got.length = 0;
    tap('stop'); await settle(); await runS(0.6);
    const ct = got(t, 'step');
    assert.deepEqual([ct[0].k, ct[0].s, ct[0].m], [lt.k, lt.s + 1, 0], 'its measure (a pre-roll from it), the next step');
    tap('stop'); await settle();
  } finally {
    DR().press({ k: 'sync', v: true }); tap('pat', 1); key(ui0.sel + 1); if (ui0.bl) key(ui0.sel + ui0.bl + 1, { shift: true }); await settle();
  }
  assert.deepEqual([D().ui.mode, D().ui.sel, D().ui.bl, D().x.sync], [DC.M9_PP, ui0.sel, ui0.bl, true]);
});

// the next bounce's machine triggers ({ F: its offline frame, m, a }): each offline processor hooked as the render builds it
function offTrigs() {
  const C = globalThis.OfflineAudioContext.prototype, sr0 = C.startRendering, log = [];
  C.startRendering = function () {
    for (const n of this.nodes) {
      if (n.kind !== 'worklet') continue;
      let pr = null;
      Object.defineProperty(n, 'proc', { configurable: true, enumerable: true, get: () => pr, set: v => {
        pr = v;
        if (!v) return;
        const p0 = v.process;
        let done = false;
        v.process = function (...a) {
          const dm = !done && v.i0 ? v.i0.dm : null;
          if (dm) { done = true; const tr = dm.trig; dm.trig = function (m, x) { log.push({ F: v.spanF, m, a: x | 0 }); return tr.apply(this, arguments); }; }
          return p0.apply(v, a);
        };
      } });
    }
    return sr0.call(this);
  };
  return { log, off: () => { C.startRendering = sr0; } };
}
// a synced flam's second hit in ticks after its step, heard live over `bars` from the start
async function flamTicks(t, bars = 2.25) {
  node(t).got.length = 0;
  const lg = trigLog(t), Tr = api.transport();
  try { await play(bars); } finally { lg.off(); }
  const out = [];
  for (const q of stepPosts(t)) {
    const pl = sent(t, 'seq').at(-1).s.plan, o = pl.mOff[q.m] + q.s;
    if (q.m < 0 || !pl.fl[o]) continue;
    const x = lg.log.find(e => e.F > q.F && e.F < q.F + 240 * Tr.a.fpt);
    if (x) out.push(Math.round((x.F - q.F) / Tr.a.fpt));
  }
  return out;
}

test('review #1 (§3.4, §10): a synced 909\'s flams follow the project tempo — its TEMPO knob at 97 (one History step) sends one \'now\' payload, the flam 28 ticks, heard there; ↶ sends the 120 BPM spacing back (35 ticks), heard there; ↷ again; a bounce at 97 BPM is the live render — its offline payload the live one, every trigger (the flams\' second hits included) at the live one\'s frame from the start', async () => {
  const t = T(), L0 = P().loop;
  P().loop = Object.assign({}, L0, { on: true, start: 0, end: 2 * BAR });
  try {
    assert.deepEqual([P().bpm, D().x.sync, [...sent(t, 'seq').at(-1).s.plan.mFl].join()], [120, true, '0,35']);
    api.transport().pos = 0;
    await start(); await play(0.5);
    assert.deepEqual(await flamTicks(t), [35], 'heard at 120: 35 ticks');
    let n0 = sent(t, 'seq').length;
    DR().press({ k: 'tempo', v: 97 }); await settle();
    let q = sent(t, 'seq').slice(n0).map(m => m.s);
    assert.deepEqual([P().bpm, cv.hist.undoLabel, q.length, q[0].at, [...q[0].plan.mFl].join(), q[0].plan.key === DC.compilePlan(D(), D().ui, D().x, DR().state().S).key], [97, 'Tempo', 1, 'now', '0,28', true],
      'the TEMPO knob (synced: the project\'s, one History step): one \'now\' payload — the flam 28 ticks');
    assert.deepEqual(await flamTicks(t), [28], 'heard: 28 ticks');
    n0 = sent(t, 'seq').length;
    cv.undo(); await settle();
    q = sent(t, 'seq').slice(n0).map(m => m.s);
    assert.deepEqual([P().bpm, q.length, q.length && [...q[0].plan.mFl].join()], [120, 1, '0,35'], '↶: one payload, the 120 BPM spacing back');
    assert.deepEqual(await flamTicks(t), [35], 'heard: 35 ticks');
    n0 = sent(t, 'seq').length;
    cv.redo(); await settle();
    q = sent(t, 'seq').slice(n0).map(m => m.s);
    assert.deepEqual([P().bpm, q.length, q.length && [...q[0].plan.mFl].join()], [97, 1, '0,28'], '↷');
    await start(); // (stop)
    // live at 97 from the start: every trigger relative to tick 0's frame
    node(t).got.length = 0; api.transport().pos = 0;
    const lv = trigLog(t);
    let Tr;
    try { await start(); Tr = { a: Object.assign({}, api.transport().a) }; await play(2); } finally { lv.off(); } // (the anchor: ■ clears it)
    await start(); // (stop)
    const live = sent(t, 'seq').at(-1).s, f0 = fr(Tr, 0), end = 2 * BAR * Tr.a.fpt;
    const L = lv.log.map(x => ({ F: x.F - f0, m: x.m, a: x.a })).filter(x => x.F >= 0 && x.F < end);
    // the bounce at 97
    const ot = offTrigs();
    let B;
    try { B = await bounceL(); } finally { ot.off(); }
    const po = sim.lastOffline.nodes[0].po.seq, O = ot.log.filter(x => x.F < end);
    assert.ok(B && peak(B) > 0.05, 'the bounce sounds');
    assert.deepEqual([po.sync, po.run, po.plan.key === live.plan.key, po.pk === live.pk, [...po.plan.mFl].join()], [true, false, true, true, '0,28'], 'the offline payload is the live one (its session at the project tempo)');
    assert.equal(sim.ctx().sampleRate, 48000, '(the live context at the bounce\'s rate)');
    const fl2 = L.filter((x, i) => i && L[i - 1].m & 4 && x.m === 5 && x.F - L[i - 1].F < 240 * Tr.a.fpt).length; // (the snare flam's second hit: SD + TOTAL ACCENT)
    assert.deepEqual([L.length, fl2], [26, 1], '(the live triggers: two bars of the DEMO, its flam\'s second hit among them)');
    assert.deepEqual([O.length, O.map(x => x.m + '/' + x.a).join()], [L.length, L.map(x => x.m + '/' + x.a).join()], 'the same triggers');
    const dF = O.map((x, i) => x.F - L[i].F), worst = Math.max(...dF.map(Math.abs));
    assert.equal(worst, 0, 'every trigger at the live one\'s frame from the start (the flams\' second hits too): ' + dF.filter(x => x).slice(0, 6).join());
  } finally { P().loop = L0; cv.setProjectBpm(120); await settle(); }
  assert.deepEqual([P().bpm, [...sent(t, 'seq').at(-1).s.plan.mFl].join()], [120, '0,35']);
});

test('the restore path\'s order (review #1): a project reopened at another tempo — the sessions\' tempo first, then the payloads: the 909 gets one payload, the file\'s record at the file\'s tempo (never the stale tempo\'s flams first)', async () => {
  const t = T();
  assert.equal(P().bpm, 120);
  const txt = await cv.projectFile();
  cv.setProjectBpm(97); await settle();
  DR().press({ k: 'mute', lane: 6 }); await settle(); // (the rim shot muted: this record now differs from the file's)
  assert.deepEqual([[...sent(t, 'seq').at(-1).s.plan.mFl].join(), sent(t, 'seq').at(-1).s.mute !== 0], ['0,28', true]);
  const n0 = sent(t, 'seq').length;
  api.applyRestore(acc.loadProject(JSON.parse(txt), { file: true })); await settle();
  const q = sent(T(), 'seq').slice(n0).map(m => m.s);
  assert.deepEqual([P().bpm, D().x.mute, q.length, q.map(s => [...s.plan.mFl].join() + '/' + s.mute).join()], [120, 0, 1, '0,35/0'], 'one payload: the file\'s record, its flam at 120 BPM');
  assert.equal(DR().state().S.bpm, 120, 'the session\'s tempo the project\'s');
});

const sw = (n, f, sr) => { const L = new Float32Array(n); for (let i = 0; i < n; i++) L[i] = Math.sin(2 * Math.PI * f * i / sr) * Math.exp(-i / (n / 5)) * 0.9; return L; };
const slotOn = async (t, s, id) => { // (a slot switched on: its entry first, then the payload naming it)
  for (let i = 0; i < 40 && !sent(t, 'seq').some(m => m.s.smp && m.s.smp[s] && m.s.smp[s].id === id && m.s.smp[s].on); i++) await sim.settle(5);
};

test('your own sounds (§5): a crash loaded through SOUNDS… is a chip swap — its entry before the payload naming it (the track needs it: the 909\'s cr key, id 8), heard live and in the bounce (on ≠ off, off the built-in again); an open-hat sample relinked through the asset manager stays a 909\'s record; the slots\' memory counts the ride and the crash', async () => {
  const t = T(), sr = sim.ctx().sampleRate, L0 = P().loop;
  const r = await cv.drumLoad(view(), 'cr', [{ name: 'my crash.wav', data: wavFile({ ch: [sw(12000, 3100, sr)], rate: sr }) }]);
  assert.equal(!!r && /^smp:[0-9a-f]{16}$/.test(r.id), true, 'imported');
  const hit = n => { sim.run(Math.round(2.5 * sr)); api.noteOn(n, 100 / 127, 1); const o = sim.run(Math.round(0.4 * sr)).get(node(t)); api.noteOff(n, 1); return o.L; };
  const A = hit(49);
  const k0 = node(t).posted.length;
  DR().press({ k: 'smp', sound: 'cr', slot: { id: r.id, name: r.name, on: true } });
  await slotOn(t, 8, r.id);
  const ms = node(t).posted.slice(k0).map(x => x.m), iE = ms.findIndex(m => m.t === 'smp' && m.id === r.id), iP = ms.findIndex(m => m.t === 'seq' && m.s.smp && m.s.smp[8] && m.s.smp[8].on);
  assert.equal(iE >= 0 && iP > iE, true, `the {t: 'smp'} entry (${iE}) before the payload naming it (${iP})`);
  assert.deepEqual([ms[iP].s.m, ms[iP].s.smp[8].id, (api.tables.needs.get(t.id) || []).join()], ['tr909', r.id, r.id], 'the 909\'s crash slot (id 8); the track needs it');
  const Bh = hit(49);
  assert.ok(peak(A) > 0.05 && peak(Bh) > 0.05 && maxDiff(A, Bh) > 0.01, `live: the crash plays your sound through the chip (${peak(A).toFixed(3)} → ${peak(Bh).toFixed(3)}, Δ ${maxDiff(A, Bh).toFixed(3)})`);
  // the bounce (the DEMO's crash on I-1-1's step 1): its needs hold the slot, its machine plays it — on ≠ off; off = the built-in
  P().loop = Object.assign({}, L0, { on: true, start: 0, end: BAR });
  try {
    api.transport().pos = 0;
    const On = await bounceL(), po = sim.lastOffline.nodes[0].po;
    assert.deepEqual([po.smps.some(e => e.id === r.id), po.seq.smp[8].id, po.seq.smp[8].on], [true, r.id, true], 'the bounce\'s entries and payload hold it');
    DR().press({ k: 'smp', sound: 'cr', slot: { id: r.id, name: r.name, on: false } }); await settle();
    const Off = await bounceL();
    assert.ok(maxDiff(On, Off) > 0.01, 'the bounce plays your crash (Δ ' + maxDiff(On, Off).toFixed(3) + ')');
    DR().press({ k: 'smp', sound: 'cr', slot: { id: r.id, name: r.name, on: true } }); await slotOn(t, 8, r.id); await settle();
    const On2 = await bounceL();
    assert.equal(maxDiff(On, On2), 0, 'on again: the same render');
  } finally { P().loop = L0; }
  // bounce = live with the swaps: a fresh 909 (an empty pattern, volume 1) playing a crash and an open hat from the roll, each
  // through your sound — its ROM voices (no noise) render bit-identically live (anchored on the 4-frame grid) and offline
  const t2 = api.addTrack(MODELS.find(m => m.id === 'tr909')); sim.raf(); await settle();
  const oh = await cv.drumLoad(view(), 'oh', [{ name: 'my open hat.wav', data: wavFile({ ch: [sw(9000, 5200, sr).map(x => x * 0.5)], rate: sr }) }]);
  for (const [s, e] of [['cr', r], ['oh', oh]]) DR().press({ k: 'smp', sound: s, slot: { id: e.id, name: e.name, on: true } });
  await slotOn(t2, 9, oh.id); await settle();
  t2.vol = 1; t2.solo = true; // (the bounce: this track alone)
  T().notes = [{ id: 'c1', t: 0, d: 120, n: 49, v: 100 }, { id: 'c2', t: 960, d: 120, n: 46, v: 127 }]; api.postTo(T(), Object.assign({ t: 'song' }, api.songData(T())));
  P().loop = Object.assign({}, L0, { on: true, start: 0, end: BAR });
  const liveVsBounce = async () => {
    api.transport().pos = 0; sim.run(Math.round(2.5 * sr));
    const F0 = sim.ctx().frames;
    sim.$('#tPlay').onclick(); await sim.settle(5);
    const a = Object.assign({}, api.transport().a), out = sim.run(Math.ceil(a.frame - F0 + BAR * a.fpt) + 256).get(node(T()));
    sim.$('#tPlay').onclick(); await sim.settle(5);
    const Bn = await bounceL(), k = a.frame - F0, gl = Math.cos(Math.PI / 2); // (the bounce's mix of the node: its pan-0 panner's L + R · cos(π / 2), stored as float32)
    return { a, live: Float32Array.from(Bn, (_, i) => out.L[k + i] + out.R[k + i] * gl), Bn };
  };
  try {
    const x1 = await liveVsBounce();
    assert.deepEqual([x1.a.tick, x1.a.frame % 4, sim.lastOffline.nodes[0].po.smps.map(e => e.id).sort().join()], [0, 0, [r.id, oh.id].sort().join()], '(anchored at tick 0 on the grid; the bounce\'s entries: both)');
    assert.ok(peak(x1.Bn) > 0.05, 'the crash and the open hat sound (' + peak(x1.Bn).toFixed(3) + ')');
    assert.equal(maxDiff(x1.Bn, x1.live), 0, 'bounce = live: your crash and open hat through the chip, bit-identically');
    for (const s of ['cr', 'oh']) DR().press({ k: 'smp', sound: s, slot: { id: (s === 'cr' ? r : oh).id, name: 'x', on: false } });
    await settle();
    const x0 = await liveVsBounce();
    // (the live machine is no longer at rest: its couplings still hold the first round's last ≈ 1e-17 — a bounce starts from rest)
    assert.deepEqual([maxDiff(x0.Bn, x0.live) < 1e-12, maxDiff(x0.Bn, x1.Bn) > 0.01], [true, true], 'our own images (slots off): bounce = live again (≤ −240 dB), and not your sounds');
  } finally { P().loop = L0; t2.solo = false; }
  api.deleteTrack(T()); sim.raf(); await settle();
  api.selectTrack(ID.t); sim.raf(); await settle();
  // an open-hat sample (the hats' open region of the one image), relinked through the asset manager: a 909's record still
  const h1 = await cv.drumLoad(view(), 'oh', [{ name: 'my hat.wav', data: wavFile({ ch: [sw(9000, 5200, sr)], rate: sr }) }]);
  DR().press({ k: 'smp', sound: 'oh', slot: { id: h1.id, name: h1.name, on: true } });
  await slotOn(t, 9, h1.id);
  assert.deepEqual((api.tables.needs.get(t.id) || []).slice().sort().join(), [r.id, h1.id].sort().join(), 'the crash and the open hat');
  const h2 = await cv.drumLoad(view(), 'oh', [{ name: 'other hat.wav', data: wavFile({ ch: [sw(9000, 4100, sr)], rate: sr }) }]);
  const was = JSON.stringify(Object.assign({}, D(), { smp: null }));
  await api.tables.relink(h1.id, h2.id); await settle();
  assert.deepEqual([D().m, D().smp.oh.id, D().smp.cr.id, JSON.stringify(Object.assign({}, D(), { smp: null })) === was], ['tr909', h2.id, r.id, true], 'a 909\'s record, the slot relinked, the rest kept');
  await slotOn(t, 9, h2.id);
  assert.equal(sent(t, 'seq').at(-1).s.m, 'tr909', 'its payload a 909\'s');
  // the machine's memory (touch: 32 MiB): five 10 s stereo slots on — ride and crash among them — leave no room for a sixth
  cv.touch(true);
  try {
    const big = [sw(480000, 200, sr), sw(480000, 300, sr)];
    const x = await cv.drumLoad(view(), 'bd', [{ name: 'long.wav', data: wavFile({ ch: big, rate: sr }) }]);
    assert.equal(!!x, true, 'a 10 s stereo sample fits');
    for (const s of ['bd', 'sd', 'rd', 'cr', 'oh']) DR().press({ k: 'smp', sound: s, slot: { id: x.id, name: x.name, on: true } });
    await settle();
    const y = await cv.drumLoad(view(), 'ch', [{ name: 'long 2.wav', data: wavFile({ ch: [sw(480000, 250, sr), sw(480000, 350, sr)], rate: sr }) }]);
    assert.deepEqual([y, /^Not enough memory for “long 2” in this drum machine \(33 of 32 MB\)$/.test(note())], [null, true], 'six would not fit (the ride\'s and the crash\'s slots counted): ' + note());
  } finally { cv.touch(null); }
  for (const s of ['bd', 'sd', 'rd', 'cr', 'oh']) DR().press({ k: 'smp', sound: s, slot: null });
  await settle();
  assert.deepEqual([Object.keys(D().smp).length, (api.tables.needs.get(T().id) || []).length], [0, 0], 'removed: the track needs nothing');
});

test('a project with all three machines (§6): Save, reopen — each track its machine and record (the 808\'s without m), each machine its payload; the saved schema is 10, which a schema-9 build opens read-only (its store\'s gate), and a newer one is read-only here', async () => {
  const t9 = T(), t8 = api.addTrack(TR808); sim.raf(); await settle();
  DR().demo(); await settle();
  const t6 = api.addTrack(TR606); sim.raf(); await settle();
  DR().demo(); await settle();
  api.selectTrack(t9.id); sim.raf(); await settle();
  const tr = [t9.id, t8.id, t6.id], pk0 = tr.map(id => sent(byId(id), 'seq').at(-1).s.pk);
  const txt = await cv.projectFile(), o = JSON.parse(txt);
  assert.deepEqual([o.schema, CM.SCHEMA], [13, 13], 'schema 13 (stage P: no artificial caps; stage 9 was 12, patchable modules; stage 8 was 11, the pad controller and the SDS-V)');
  const p = acc.loadProject(JSON.parse(txt), { file: true });
  assert.deepEqual(tr.map(id => CMOD.instOf(p.tracks.find(x => x.id === id)).model), ['tr909', 'tr808', 'tr606']);
  assert.deepEqual(tr.map(id => JSON.stringify(CMOD.instOf(p.tracks.find(x => x.id === id)).drum) === JSON.stringify(D(byId(id)))), [true, true, true], 'the three records round-trip');
  assert.deepEqual(tr.map(id => CMOD.instOf(p.tracks.find(x => x.id === id)).drum.m), ['tr909', undefined, 'tr606'], 'the 808\'s record: no m (7a\'s shape)');
  api.applyRestore(p); await settle();
  assert.deepEqual(tr.map(id => sent(byId(id), 'seq').at(-1).s.pk), pk0, 'each reopened machine holds the same payload');
  assert.deepEqual(tr.map(id => { const N = node(byId(id)); return N.proc.i0.dm ? N.proc.i0.dm._mach : null; }), ['tr909', 'tr808', 'tr606'], 'each node its machine');
  // a schema-9 build (its store's gate given 9) opens this project read-only; this build reads a newer file read-only
  const idb = fakeIDB(), seed = await AS.openAppStore({ idb, ls: fakeStorage({}), bc: null, schema: CM.SCHEMA });
  seed.saveProject(o); await seed.flush(); await seed.close();
  const old = await AS.openAppStore({ idb, ls: fakeStorage({}), bc: null, schema: 9 });
  assert.deepEqual([old.info().readOnly, old.info().newer], [true, 13], 'a schema-9 build: read-only');
  await old.close();
  assert.equal(acc.loadProject(Object.assign(JSON.parse(txt), { schema: CM.SCHEMA + 1 }), { file: true }).newerSchema, CM.SCHEMA + 1, 'a newer file opens read-only here');
  api.deleteTrack(byId(t6.id)); sim.raf(); await settle();
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
const NAME = { tr808: 'TR-808', tr606: 'TR-606', tr909: 'TR-909' };

test('808 / 606 / 909 Replace chain (§6, §8): Minimoog → 909 → 808 → 606 and ↶ ↶ ↷ ↷ twice — plain and as a graphed node\'s second instrument, each restore with an asset still building so the patch waits: the arriving machine\'s payload (m names it) goes first, waits in the engine, and its synced steps play every time (never silent); the record, the panel\'s session and the node\'s machine are that machine\'s', async () => {
  const sr = sim.ctx().sampleRate, r = await cv.drumLoad(view(), 'sd', [{ name: 'snare.wav', data: wavFile({ ch: [sw(4800, 900, sr)], rate: sr }) }]);
  for (const how of ['plain', 'graphed']) {
    api.addTrack(MOOG); sim.raf(); await settle();
    let id = null;
    const v = () => (id == null ? view() : cv.view1e(id)), dev = () => (id == null ? CMOD.primId(T()) : id), A = () => cv.drum.api(v()), rec = () => cv.drumOf(T(), dev());
    const mach = () => I(T(), dev()).model, sess = () => { const S = A().state().S; return S && S.m === 'tr909' ? 'tr909' : Array.isArray(S.held) ? 'tr606' : 'tr808'; };
    const prep = async () => { A().demo(); A().press({ k: 'smp', sound: 'sd', slot: { id: r.id, name: 'snare', on: true } }); await settle(); };
    const n = {};
    let prev = 'Minimoog';
    for (const m of ['tr909', 'tr808', 'tr606']) {
      if (how === 'plain') { sh.shell.tiles.setView('drums'); sh.srcPick(m, 'replace'); } else if (id == null) id = cv.add(m, { x: 0, y: 1400 }); else cv.setTrackModel(v(), m);
      sim.raf(); await settle();
      if (how === 'plain') assert.equal(note(), `Replaced ${prev} with ${NAME[m]} · tap to undo`);
      prev = NAME[m];
      assert.deepEqual([mach(), rec().m || 'tr808', JSON.stringify(rec()) === JSON.stringify(DC.normDrum(undefined, m)), sess()], [m, m, true, m], how + ': the ' + m + ' arrives with its own empty record and session');
      await prep();
      n[m] = await steps(id);
      assert.deepEqual([n[m] > 0, instOfNode(T(), id).dm._mach], [true, m], how + ': the ' + m + ' plays');
    }
    for (const k of [1, 2]) {
      for (const [dir, want] of [['undo', 'tr808'], ['undo', 'tr909'], ['redo', 'tr808'], ['redo', 'tr606']]) {
        const k0 = node(T()).posted.length, release = holdAssets();
        try { if (dir === 'undo') cv.undo(); else cv.redo(); sim.raf(); await sim.settle(3); } finally {
          const ms = node(T()).posted.slice(k0).map(x => x.m);
          assert.deepEqual([ms.some(m => m.t === 'seq' && (m.s.m || 'tr808') === want), ms.some(m => isPatchOf(m, want, id))], [true, false], `${how} ${dir} ${k} → ${want}: the payload posted, the patch waiting`);
          await release();
        }
        sim.raf(); await settle();
        const ms = node(T()).posted.slice(k0).map(x => x.m), iS = ms.findIndex(m => m.t === 'seq' && (m.s.m || 'tr808') === want), iP = ms.findIndex(m => isPatchOf(m, want, id));
        assert.equal(iS >= 0 && iP > iS, true, `${how} ${dir} ${k}: the ${want}'s payload (${iS}) before its patch (${iP})`);
        assert.deepEqual([mach(), rec().m || 'tr808', sess(), await steps(id), instOfNode(T(), id).dm._mach], [want, want, want, n[want], want], `${how} ${dir} ${k}: the ${want}'s record and session; its synced steps play`);
      }
    }
    api.deleteTrack(T()); sim.raf(); await settle();
  }
  api.selectTrack(ID.t); sim.raf(); await settle();
});

const padOf = s => walk(cv.panel().root, n => attr(n, 'data-sound') === s)[0];
const padsOf = () => walk(cv.panel().root, n => /\bdr-pads\b/.test(n.className || ''))[0];
const pptr = (el, type, target, id) => el.dispatchEvent({ type, target, currentTarget: el, button: 0, buttons: 1, pointerId: id, pointerType: 'touch', isPrimary: false,
  clientX: 10, clientY: 50, timeStamp: performance.now(), shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} });

test('nothing left sounding (7a §10): a TAP-write step key and a pad held let go on a hidden page, a track switch, a panic and power off; a free-running 909 (SYNC off, START) stops on a panic — its payload says so, no step after', async () => {
  const t = T();
  tapWrite(); sim.raf();
  const offs = n => sent(t, 'off').filter(m => m.n === n).length;
  const both = id => { kptr(kOf(1), 'pointerdown', id); pptr(padsOf(), 'pointerdown', padOf('sd'), id + 1); };
  const held = () => [DR().state().S.hits.length, attr(padOf('sd'), 'data-held')];
  let o = [offs(36), offs(38)];
  both(71);
  assert.deepEqual([held(), sent(t, 'on').slice(-2).map(m => m.n).join()], [[1, ''], '36,38'], 'a key and a pad held: the kick and the snare');
  globalThis.document.hidden = true;
  for (const f of sim.dom.docL.visibilitychange || []) f({ type: 'visibilitychange' });
  globalThis.document.hidden = false;
  for (const f of sim.dom.docL.visibilitychange || []) f({ type: 'visibilitychange' });
  assert.deepEqual([offs(36) - o[0], offs(38) - o[1], held()], [1, 1, [0, undefined]], 'a hidden page');
  o = [offs(36), offs(38)];
  both(73);
  const u = api.addTrack(); sim.raf(); // (selects the new track)
  assert.deepEqual([offs(36) - o[0], offs(38) - o[1]], [1, 1], 'a track switch');
  api.selectTrack(t.id); sim.raf(); await settle();
  api.deleteTrack(byId(u.id)); sim.raf(); await settle();
  api.selectTrack(t.id); sim.raf(); await settle();
  o = [offs(36), offs(38)];
  both(75);
  cv.panic();
  assert.deepEqual([offs(36) - o[0], offs(38) - o[1], held()], [1, 1, [0, undefined]], 'a panic');
  // a free run (SYNC off, START): a panic stops it — its session, its payload (not running), no step after
  DR().demo(); await settle();
  DR().press({ k: 'sync', v: false });
  await start();
  assert.deepEqual([DR().state().run, sent(t, 'seq').at(-1).s.run, api.transport().playing], [true, true, false], 'running on its own');
  sim.run(Math.round(0.5 * sim.ctx().sampleRate)); await settle();
  cv.panic(); await settle();
  assert.deepEqual([DR().state().run, sent(t, 'seq').at(-1).s.run], [false, false], 'a panic stops it');
  node(t).got.length = 0;
  sim.run(Math.round(0.5 * sim.ctx().sampleRate)); await settle();
  assert.equal(got(t, 'step').length, 0, 'no step after');
  // power off with a key and a pad held, and the machine running free
  tapWrite(); sim.raf();
  both(77);
  await start();
  assert.equal(DR().state().run, true);
  sim.$('#power').onclick(); await sim.settle(5); // (power off)
  assert.deepEqual([api.ctx(), held(), DR().state().run, DR().state().S.keys.length], [null, [0, undefined], false, 0], 'power off: nothing held, the machine stopped');
  await sim.power(); sim.raf(); await settle();
  assert.equal(!!node(T()), true, 'back on');
  DR().press({ k: 'sync', v: true }); DR().demo(); await settle();
  assert.deepEqual([D().x.sync, D().ui.mode, node(T()).po.seq ? node(T()).po.seq.m : sent(T(), 'seq').at(-1).s.m], [true, DC.M9_PP, 'tr909']);
});
