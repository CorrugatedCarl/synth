import './v8-guard.mjs';
// The safety limiter in the page simulation with the real engine (tests/main-sim.mjs, clock 'std'): 'synth-safe' as the last stage
// before the browser's output — MASTER → Mono → Volume → the limiter → destination, the metronome bus into it too (one per context,
// made after MASTER, before every track node; its options {on}). A mix under −1 dBFS: its output is today's (Float32(MASTER ×
// Volume)) L − 1 frames late, bit for bit. The investigation's heavy scene (two Wavecrafts at 3 oscillators, unison 4, 2 kHz, res 0.3,
// drive 100 %, an 808 loop; faders 0.8, Volume 0.8 — over 0 dBFS at the destination today): on, nothing at the destination over
// −1 dBFS; off, today's output (no delay, over 0 dBFS). The switch (the master OUT's "Safety limiter"; settings.safe — this device's,
// never in a project): {t: 'on', v} to the limiter, saved, the clock's compensation (outLatency, the playhead's / recording's heard
// tick) moved by L − 1 frames, a new context built as the setting says. The report {t: 'safe', gr}: the Master row shows it ("−2.5
// LIM" in the LUFS number's place) and the OUT ("Limiting −2.5 dB"); the notice once per session (from 1 dB). The bounce is not
// changed by it (the same bytes on and off; no limiter offline).
// Accessor-free (a guard build); strings, numbers and booleans only into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/safe-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as SC from '../serum-core.js?v=9';
import * as CMOD from '../cv-model.js?v=9';
import { MODELS } from '../models.js?v=9';

for (const g of ['SxBase', 'SxFilt2', 'SxWarp', 'SxMod', 'SxSample', 'SxGran', 'SxSpec', 'SxSeq', 'SerumDSP', 'FXMods2', 'FXDSP', 'Dr808', 'DrSeq', 'ModCore', 'PatchDSP', 'PatchMoog', 'MASTERDSP']) globalThis[g] = null;
// canvas-M-sim's scripted world: the master canvas mounts its OUT
function scriptedWorld(root) {
  const L = {};
  const W = {
    el: root, k: 1, cam: { tx: 0, ty: 0, k: 1 }, items: new Map(), selected: null, mode: 'always',
    setCamera(c) { W.cam = { tx: c.tx, ty: c.ty, k: c.k }; W.k = c.k; W.emit('cameraend', { cam: W.cam, zoomed: true }); },
    band: () => ({ left: 44, top: 48, right: 1500, bottom: 1300 }),
    toClient: (wx, wy) => ({ x: wx * W.k + W.cam.tx, y: 48 + wy * W.k + W.cam.ty }),
    toWorld: (x, y) => ({ x: (x - W.cam.tx) / W.k, y: (y - 48 - W.cam.ty) / W.k }),
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
const sim = await bootMain({ ls: fakeStorage({}), hash: '#minimoog', clock: 'std', synthTest: { cvWorld: root => scriptedWorld(root) } });
const api = sim.api, M = globalThis.__synthTest.master, cv = globalThis.__synthTest.cv;
await sim.power(); sim.raf(); await sim.settle(10); sim.raf();

const THR = Math.pow(10, -1 / 20), THR32 = Math.fround(THR);
const SAFE_TXT = 'The mix is too loud — the safety limiter is catching it; pull some faders down';
const P = () => api.project(), SN = () => M.safe(), MN = () => M.rec().node;
const settle = async (n = 2) => { for (let i = 0; i < n; i++) { sim.raf(); await sim.settle(3); } };
const sgot = t => SN().got.filter(m => !t || m.t === t);
const kid = (el, c) => el.children.find(x => String(x.className).split(' ').includes(c)) || null;
const tap = el => el.dispatchEvent({ type: 'click', target: el, currentTarget: el, preventDefault() {}, stopPropagation() {} });
// the row's indicator [hidden, its value] and the OUT's switch (the master canvas opened for it)
const ind = () => { const e = kid(M.row().el, 'mr-lim'); return [e.hidden, kid(e, 'mr-limv').textContent]; };
// (never a stub element through a promise: its proxy answers `then` — an await would wait for ever)
const openOut = async () => { if (!M.out()) { M.open(); await settle(3); } };
const SW = () => kid(M.out().el, 'mo-safe');
const peakOf = (a, from = 0) => { let m = 0; for (let i = from; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); return m; };
const SR = sim.ctx().sampleRate, D = M.safeLat(SR);

test('the live graph: MASTER → Mono → Volume → the safety limiter (synth-safe) → destination, the metronome bus into it; one per context, made after MASTER and before every track node; {on: true}; L − 1 frames late (the engine\'s Limiter)', () => {
  const c = sim.ctx(), ws = c.nodes.filter(n => n.kind === 'worklet'), G = M.graph(), s = SN();
  assert.deepEqual([ws[0].name, ws[1].name, ws.filter(n => n.name === 'synth-safe').length, ws.slice(2).every(n => n.name === 'synth-engine')], ['synth-master', 'synth-safe', 1, true]);
  assert.equal(s === ws[1] && G.safe === s, true);
  assert.deepEqual([s.nIn, s.channelCount, s.channelCountMode, s.channelInterpretation, JSON.stringify(s.po)], [1, 2, 'explicit', 'speakers', '{"on":true}']);
  assert.deepEqual([[...G.level.outs].length, [...G.level.outs][0] === s, [...s.outs].map(n => n.kind).join()], [1, true, 'dest'], 'the Volume → the limiter → destination');
  assert.deepEqual([[...G.metro.outs].length, [...G.metro.outs][0] === s], [1, true], 'the metronome bus → the limiter');
  assert.deepEqual([[...MN().outs].map(n => n.kind).sort().join(), [...G.mono.outs][0] === G.level], ['an,gain,split', true], 'MASTER\'s own outputs as before');
  assert.deepEqual([SR, D, s.proc.lat, M.safeLat(44100), M.safeLat(96000)], [48000, 47, 47, 43, 95]);
  assert.equal(api.settings().safe, true, 'on by default');
});

test('a mix under −1 dBFS: the limiter\'s output is today\'s — Float32(MASTER × Volume) — 47 frames late, bit for bit; nothing reported', async () => {
  sim.key('KeyA', true); await settle(2);
  const out = sim.run(8192);
  sim.key('KeyA', false); await settle(1);
  const mo = out.get(MN()), so = out.get(SN()), v = api.settings().master;
  let diff = 0;
  for (let i = D; i < so.L.length; i++) if (!Object.is(so.L[i], Math.fround(mo.L[i - D] * v)) || !Object.is(so.R[i], Math.fround(mo.R[i - D] * v))) diff++;
  assert.ok(peakOf(mo.L) > 0.05, 'it sounds: ' + peakOf(mo.L));
  assert.ok(peakOf(so.L) * 1 < THR, 'under −1 dBFS');
  assert.equal(diff, 0, 'every sample: today\'s output, ' + D + ' frames late');
  assert.deepEqual(sgot('safe'), []);
});

test('the report: {t: safe, gr} shows on the Master row ("−2.5 LIM" in the LUFS number\'s place) and the OUT, held a second after the last; the notice once per session from 1 dB, never again; off: nothing shows', async () => {
  await openOut();
  const row = M.row(), b = SW(), out = M.out();
  out.setLive(true);
  sim.$('#notice').textContent = ''; api.notice('', 0);
  SN()._fromProc({ t: 'safe', gr: 0.4 });
  assert.deepEqual([...ind(), row.state().limiting, b.textContent], [false, '−0.4', true, 'Limiting −0.4 dB'], 'shown at once');
  assert.notEqual(sim.$('#notice').textContent, SAFE_TXT, 'under 1 dB: no notice');
  SN()._fromProc({ t: 'safe', gr: 2.46 });
  assert.deepEqual([ind()[1], sim.$('#notice').textContent, sim.$('#notice').hidden], ['−2.5', SAFE_TXT, false], 'the notice');
  api.notice('', 0);
  SN()._fromProc({ t: 'safe', gr: 3.1 });
  assert.deepEqual([ind()[1], sim.$('#notice').textContent === SAFE_TXT], ['−3.1', false], 'once per session');
  sim.advance(1100); row.update({ s: -20, pk: [-6, -6], tp: [-6, -6] }); out.draw();
  assert.deepEqual([ind()[0], row.state().limiting, b.textContent], [true, false, 'Safety limiter'], 'a second after the last report');
  M.safeSet(false);
  SN()._fromProc({ t: 'safe', gr: 2 });
  assert.deepEqual([ind()[0], out.state().limiting], [true, false], 'off: nothing to show');
  M.safeSet(true); await settle(1);
  M.off(); await settle(2);
});

test('the switch: "Safety limiter" on the master OUT — a tap posts {t: on, v} to the limiter, saves settings.safe (this device), relabels; the clock\'s compensation moves by 47 frames (outLatency, the playhead\'s heard tick); a new context is built as the setting says', async () => {
  await openOut();
  const b = SW();
  assert.deepEqual([b.getAttribute('aria-pressed'), api.clock().pipe, api.settings().safe], ['true', D / SR, true]);
  sim.$('#tPlay').onclick(); await settle(2);
  sim.run(48000);
  const l1 = api.outLatency(), t1 = api.curTick(performance.now());
  SN().posted.length = 0;
  tap(b); await settle(1);
  const l0 = api.outLatency(), t0 = api.curTick(performance.now()), fpt = api.transport().a.fpt;
  assert.deepEqual([b.getAttribute('aria-pressed'), api.settings().safe, api.clock().pipe, JSON.stringify(SN().posted.map(x => x.m))], ['false', false, 0, '[{"t":"on","v":false}]']);
  assert.ok(Math.abs((l1 - l0) - D / SR) < 1e-12, 'outLatency: ' + l1 + ' − ' + l0);
  assert.ok(Math.abs((t0 - t1) - D / fpt) < 1e-9, 'the heard tick: ' + (t0 - t1) + ' vs ' + D / fpt);
  sim.$('#tPlay').onclick(); await settle(1);
  api.save(); await settle(1);
  assert.equal(api.store.get('synth.settings', {}).safe, false, 'saved (synth.settings)');
  assert.equal(P().master === undefined || !('safe' in P().master), true, 'not in the project');
  sim.$('#power').onclick(); await sim.settle(30); await sim.power(); await settle(4);
  await openOut();
  assert.deepEqual([JSON.stringify(SN().po), api.clock().pipe, SW().getAttribute('aria-pressed')], ['{"on":false}', 0, 'false'], 'a new context: built off');
  tap(SW()); await settle(1);
  assert.deepEqual([api.settings().safe, api.clock().pipe, JSON.stringify(SN().posted.map(x => x.m)), M.row().state().safe], [true, D / SR, '[{"t":"on","v":true}]', true]);
  M.off(); await settle(2);
});

// the investigation's heavy scene: two Wavecrafts (3 oscillators, unison 4 each, 2 kHz, res 0.3, drive 100 %) — chords and a bassline —
// and a TR-808 loop, faders 0.8, Volume 0.8, two bars at 120 bpm looping
async function heavy() {
  const Mo = id => MODELS.find(m => m.id === id), N = SC.lawNorm;
  const wa = api.addTrack(Mo('rig')); await settle(4);
  const wb = api.addTrack(Mo('rig')); await settle(4);
  const dr = api.addTrack(Mo('tr808')); await settle(4);
  for (const t of [wa, wb]) {
    Object.assign(CMOD.instOf(t).vals.s.p, { 'b.on': 1, 'c.on': 1, 'a.uni': N('a.uni', 4), 'b.uni': N('b.uni', 4), 'c.uni': N('c.uni', 4), 'f.cutoff': N('f.cutoff', 2000), 'f.res': 0.3, 'f.drive': 1 });
  }
  const p = P(), PPQ = p.snap * 4, bar = PPQ * 4, q = PPQ / 4;
  let id = 1; const nt = (t, d, n, v = 100) => ({ id: 'hv' + id++, t, d, n, v });
  wa.notes = [[60, 63, 67, 70], [56, 60, 63, 67]].flatMap((ch, b) => ch.map(n => nt(b * bar, bar - q / 2, n)));
  wb.notes = [36, 36, 48, 36, 36, 39, 36, 43, 32, 32, 44, 32, 32, 36, 32, 39].map((n, i) => nt(i * PPQ / 2, PPQ / 2 - q / 4, n));
  const dn = [];
  for (let b = 0; b < 2; b++) {
    for (const s of [0, 6, 8]) dn.push(nt(b * bar + s * q, q, 36, 110));
    for (const s of [4, 12]) dn.push(nt(b * bar + s * q, q, 38, 110));
    for (let s = 0; s < 16; s += 2) dn.push(nt(b * bar + s * q, q, 42, 100));
    dn.push(nt(b * bar + 12 * q, q, 39, 100));
  }
  dr.notes = dn;
  p.loop.on = true; p.loop.start = 0; p.loop.end = 2 * bar; p.metronome.on = false;
  cv.mix();
  for (const t of p.tracks) { api.sendPatch(t); api.postTo(t, Object.assign({ t: 'song' }, api.songData(t))); }
  await settle(4);
  return [wa, wb, dr];
}

test('the heavy scene: today over 0 dBFS at the destination; on, nothing there over −1 dBFS (and the row says it is limiting); off, today\'s output — Float32(MASTER × Volume), no delay, over 0 dBFS', async () => {
  const tr = await heavy();
  assert.deepEqual(tr.map(t => [CMOD.instOf(t).model, t.vol]), [['rig', 0.8], ['rig', 0.8], ['tr808', 0.8]]);
  assert.equal(api.settings().master, 0.8);
  sim.run(4096);
  sim.$('#tPlay').onclick(); await settle(2);
  const out = sim.run(48000 * 2), mo = out.get(MN()), so = out.get(SN()), v = api.settings().master;
  let today = 0, over = 0;
  for (let i = 0; i < mo.L.length; i++) for (const x of [mo.L[i], mo.R[i]]) { const y = Math.abs(Math.fround(x * v)); if (y > today) today = y; if (y > 1) over++; }
  assert.ok(today > 1 && over > 0, 'today: over 0 dBFS at the destination (' + (20 * Math.log10(today)).toFixed(2) + ' dBFS, ' + over + ' samples over 1)');
  assert.ok(peakOf(so.L) <= THR32 && peakOf(so.R) <= THR32, 'on: nothing over −1 dBFS (' + (20 * Math.log10(Math.max(peakOf(so.L), peakOf(so.R)))).toFixed(3) + ' dBFS)');
  assert.ok(peakOf(so.L) > 0.85, 'limited, not silenced');
  const rep = sgot('safe');
  assert.ok(rep.length >= 3 && rep.every(m => m.gr > 0), 'reported: ' + rep.length);
  assert.ok(Math.max(...rep.map(m => m.gr)) > 1, 'over 1 dB of reduction: ' + Math.max(...rep.map(m => m.gr)));
  await settle(1);
  assert.equal(M.row().state().limiting, true, 'the row shows it');
  assert.notEqual(sim.$('#notice').textContent, SAFE_TXT, 'the notice came once already this session');
  M.safeSet(false); await settle(1);
  const o2 = sim.run(48000), m2 = o2.get(MN()), s2 = o2.get(SN());
  let diff = 0;
  for (let i = 256; i < s2.L.length; i++) if (!Object.is(s2.L[i], Math.fround(m2.L[i] * v)) || !Object.is(s2.R[i], Math.fround(m2.R[i] * v))) diff++;
  assert.equal(diff, 0, 'off: Float32(MASTER × Volume) itself, no delay');
  assert.ok(peakOf(s2.L, 256) > 1 || peakOf(s2.R, 256) > 1, 'over 0 dBFS, as today');
  sim.$('#tPlay').onclick(); await settle(1);
  M.safeSet(true); await settle(1);
});

test('the bounce is not changed by it: the same WAV bytes with the limiter on and off, no synth-safe node offline', async () => {
  const run = async () => {
    const blobs = [], real = URL.createObjectURL;
    URL.createObjectURL = b => { blobs.push(b); return 'blob:sim/' + blobs.length; };
    try {
      sim.$('#fBounce').click();
      for (const [k, x] of [['#bRange', 'loop'], ['#bSr', '48000'], ['#bBits', '32'], ['#bOs', '2'], ['#bTail', '0'], ['#bNorm', 'off']]) sim.$(k).value = x;
      sim.$('#bNorm').checked = false;
      sim.lastOffline = null;
      await sim.$('#bGo').onclick();
      for (let i = 0; i < 40 && !sim.lastOffline; i++) await sim.settle(5);
      return { note: sim.$('#bNote').textContent, nodes: sim.lastOffline.nodes.map(n => n.name), wav: Buffer.from(await blobs[0].arrayBuffer()).toString('base64') };
    } finally { URL.createObjectURL = real; sim.$('#bCancel').onclick(); }
  };
  const a = await run();
  M.safeSet(false); await settle(1);
  const b = await run();
  M.safeSet(true); await settle(1);
  assert.match(a.note, /^Done: /);
  assert.equal(a.nodes.includes('synth-safe'), false);
  assert.equal(a.wav === b.wav, true, 'the same bytes');
});
