import './v8-guard.mjs';
// FR Cut B lane H-B (docs/canvas/IMPL-FR-B.md §5, gates FR1 / G6 in the sims, §13 P1-2 / P2-4 / P2-5 / P2-10) in the page simulation:
// the consumers of the engine's fast lane. The engine posts outputs at up to 120 Hz ({t: 'fast', F, …}, §2.2) only after the page asks
// ({t: 'fastOn', hz, ids, ix, ixv}, §2.1) — main.js's monitors ask for the parts their live fast subscriptions show, at the preset's
// rate (High 120 · Medium 60 · Low 30, WebKit ≤ 60, reduced motion ≤ 30), and say hz 0 once when nothing asks any more (FR1: no
// fastOn while no display asks). The page keys every post by its frame F in a motion.js ring and reads it at the frame heard now
// (Fh = the audio clock's outFrame of the frame's own rAF time, P2-10): the FX racks' GR and dots, the classic panels' dots, the
// master's peak meters (drained once: the bars rise when the peak is heard), the modulator bodies (the slot hosts' rings: B.update
// with F), the canvas ENVs injected into a Serum's ENV slot (P2-5). While a consumer's ring is live its slow deliver only updates the
// fallback values (P2-4); fastOn follows the node's `on` through a new node, a graph change, the master's rebuild and a power cycle
// (P1-2). The engine of this base ignores fastOn (lane E builds it): the fast messages are injected into the nodes' ports, as the
// contract's §8 says. The Serum panel and the FX rack are stubs that record (lane M-B's host is tested in its own files).
// One boot; strings, numbers and booleans only into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/canvas-FR-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as MOTION from '../motion.js?v=9';
import * as S from '../song.js?v=9';
import * as CMOD from '../cv-model.js?v=9';
import * as cvWorld from '../cv-world.js?v=9';
import * as core from '../serum-core.js?v=9';
import * as wk from '../wk.js?v=9';
import { MODELS } from '../models.js?v=9';
import { RIG } from '../rig-core.js?v=9';

const VP = { left: 0, top: 48 }, BAND = { left: 44, top: 48, right: 1520, bottom: 700 };
function scriptedWorld(root) {
  const L = {};
  const W = {
    el: root, k: 1, cam: { tx: 0, ty: 0, k: 1 }, items: new Map(), selected: null, mode: 'always', perf: 'high',
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
    setPerf(p) { W.perf = p; },
    on(t, fn) { (L[t] || (L[t] = [])).push(fn); return () => { L[t] = L[t].filter(f => f !== fn); }; },
    emit(t, d) { for (const f of (L[t] || []).slice()) f(d); },
  };
  return W;
}

await (await import('../cv-mods-ui.js?v=9')).ready();
const sim = await bootMain({ ls: fakeStorage({}), clock: 'std', outLat: 0.02, hash: '#' + RIG.ID, synthTest: { cvWorld: root => scriptedWorld(root) } });
{ // (the panels' graph editors animate through wk.ticker, which asks getClientRects: the stub DOM's elements answer one box)
  const ce = globalThis.document.createElement;
  globalThis.document.createElement = tag => { const e = ce(tag); e.getClientRects = () => [{}]; return e; };
  const cn = globalThis.document.createElementNS;
  globalThis.document.createElementNS = (ns, tag) => { const e = cn(ns, tag); e.getClientRects = () => [{}]; return e; };
}
const api = sim.api, cv = globalThis.__synthTest.cv, acc = globalThis.__synthTest.acc, MS = globalThis.__synthTest.master, U = globalThis.__synthTest.modUI;
// the Serum host and the FX rack: recording stubs (sx-host's SerumHost and the real FXRackUI are tested in their own files) — the host
// surface main.js reads: setSnapshot / setFast / fastIx / fastReset / fastLive; the rack: setLive / moddedIds / paintMods. (SX0) The host is
// createHost's (no box: the record's box is the Amplifier's face, which this loader has none of)
const LOG = [];
const SX = [], FXS = [];
class SxStub {
  constructor(host) { this.host = host; this.el = globalThis.document.createElement('div'); this.snap = null; this.dead = false; this.ix = Int16Array.of(3, 7); this.fast = []; this.resets = 0; SX.push(this); host.monitor(true); }
  refresh() {} paintMods() {}
  destroy() { this.dead = true; this.host.monitor(false); }
  setSnapshot(d) { this.snap = d.s; LOG.push('snap'); }
  setFast(d, ix) { this.fast.push({ F: d.F, i: d.i, k: d.k, n: d.v ? d.v.length : -1, ix: ix ? Array.from(ix).join() : null }); }
  fastIx() { return this.ix; }
  fastReset() { this.resets++; }
  fastLive() { return this.fast.length > 0; }
}
class FXStub {
  constructor(box, host) { this.host = host; this.el = globalThis.document.createElement('div'); box.append(this.el); this.lives = []; this.ids = []; FXS.push(this); }
  refresh() {} destroy() { this.dead = true; } paintMods() {}
  setLive(f) { this.lives.push(f); }
  moddedIds() { return this.ids; }
}
acc.uiLoad(Promise.resolve({ host: { createHost: (h, o) => new SxStub(h) }, fxui: { FXRackUI: FXStub }, wk: await import('../wk.js?v=9'), mod: null }));
await sim.power(); sim.raf();
cv.renderViews(); await sim.settle(10); sim.raf(); await sim.settle(5); sim.raf();
sim.$('#modal').hidden = true;
wk.clock.config({ gate: false }); // (every frame-clock client on every rAF: the frames below are a few ms of audio each)

const FR = globalThis.__synthTest.fr;
const P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack);
const SR = sim.ctx().sampleRate;
const MOD = id => MODELS.find(m => m.id === id);
const nodeOf = t => sim.nodeOf(t.id), mNode = () => MS.rec().node;
const msgs = (n, kind) => n.posted.map(x => x.m).filter(m => !kind || m.t === kind);
const fastOns = n => msgs(n, 'fastOn');
const lastOf = (n, kind) => { const L = msgs(n, kind); return L.length ? L[L.length - 1] : null; };
const clear = n => { n.posted.length = 0; };
const inject = (n, m) => n._fromProc(m); // (a worklet → page message, structured-cloned as a port does)
// the engine's own fast posts stopped on node n before posts are injected (lane E's engine answers the page's fastOn: its posts would
// interleave with the injected ones); straight to the processor — the page's state and the posted log untouched
const quiet = n => { if (n && n.proc && typeof n.proc.msg === 'function') n.proc.msg({ t: 'fastOn', hz: 0, ids: [], ix: null, ixv: 0 }); };
const sxHostOf = () => SX.filter(x => !x.dead).pop();
const fxStubOf = () => FXS.filter(x => !x.dead).pop();
const ixStr = m => (m && m.ix ? Object.keys(m.ix).sort().map(k => k + ':' + Array.from(m.ix[k]).join('.')).join(' ') : 'null');
const Fh = () => FR.heard();
// a frame: n frames of audio rendered (the real engine; the clock's stamp and performance time move with them), then one rAF — the
// heard frame moves only with the render (a stamp is extrapolated ≤ 100 ms)
const frame = (n = 128) => { sim.run(n); sim.raf(); };
const stale = async () => { sim.run(Math.ceil((MOTION.STALE_S + 0.05) * SR)); await settle(2); }; // (STALE_S of heard time with no post)
const settle = async (n = 2) => { for (let i = 0; i < n; i++) { sim.raf(); await sim.settle(3); } };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const SERUM = T().id; // (the boot's Serum track: legacy — its parts i0 / c0 — until the graph change of the last test)

test('FR1 / §5.1: the Serum node is asked for its fast parts after its mon — hz = the preset\'s (High 120), ids ⊆ the watched ids (sorted), ix = the host\'s fastIx per Serum part, ixv a number; MASTER\'s meters (the Master row) too; a node nothing shows is never asked', async () => {
  const t = T(), n = nodeOf(t);
  assert.ok(sxHostOf() && fxStubOf(), 'the stubs are up');
  const all = msgs(n), iMon = all.map(m => m.t).lastIndexOf('mon'), iFast = all.map(m => m.t).indexOf('fastOn');
  const f = lastOf(n, 'fastOn'), mon = lastOf(n, 'mon');
  assert.ok(f, 'a fastOn posted to the Serum node');
  assert.ok(iFast > all.map(m => m.t).indexOf('mon'), 'after its first mon');
  assert.deepEqual([f.hz, f.ids.join(), f.ids.every(x => mon.ids.includes(x)), ixStr(f), typeof f.ixv], [120, 'c0,i0', true, 'i0:3.7', 'number'], JSON.stringify(f));
  assert.ok(iMon >= 0);
  const mf = lastOf(mNode(), 'fastOn');
  assert.deepEqual(mf && [mf.hz, mf.ids.join(), mf.ix], [120, 'meters', null], 'MASTER: the meters');
  // a track shown, then not: asked while its displays are (its FX panel), hz 0 once when they go, then nothing (FR1)
  const was = t.id, j = api.addTrack(MOD('juno60')); await settle();
  api.selectTrack(was); cv.renderViews(); await settle(3);
  const L = fastOns(nodeOf(j)).map(m => m.hz);
  assert.ok(!L.length || L[L.length - 1] === 0, 'not shown any more: off (' + L.join() + ')');
  clear(nodeOf(j)); await settle(3);
  assert.equal(fastOns(nodeOf(j)).length, 0, 'a node no display asks for: nothing posted');
  // nothing new at rest
  clear(n); await settle(3);
  assert.equal(fastOns(n).length, 0, 'unchanged: nothing reposted');
});

test('§5.1: hidden → one hz 0 to each asked node (and nothing more), visible → asked again; ids / ix as before', async () => {
  const t = T(), n = nodeOf(t), m = mNode();
  clear(n); clear(m);
  const D = sim.dom.document;
  D.hidden = true; D.visibilityState = 'hidden';
  for (const f of sim.dom.docL.visibilitychange || []) f({ type: 'visibilitychange' });
  await settle(2);
  assert.deepEqual([fastOns(n).map(x => x.hz).join(), fastOns(m).map(x => x.hz).join()], ['0', '0'], 'one hz 0 each');
  assert.deepEqual([fastOns(n)[0].ids.length, fastOns(n)[0].ix], [0, null]);
  await settle(2);
  assert.deepEqual([fastOns(n).length, fastOns(m).length], [1, 1], 'once');
  D.hidden = false; D.visibilityState = 'visible';
  for (const f of sim.dom.docL.visibilitychange || []) f({ type: 'visibilitychange' });
  await settle(2);
  const f = lastOf(n, 'fastOn');
  assert.deepEqual([f.hz, f.ids.join(), ixStr(f), lastOf(m, 'fastOn').hz], [120, 'c0,i0', 'i0:3.7', 120]);
});

test('§5.2: the rate — High 120, Medium 60, Low 30 (a preset pick posts fastOn and nothing else to the asked nodes), a Frame rate pick posts nothing; reduced motion ≤ 30; fr.force(hz) / force(null); fr.rate(perf, webkit, reduced): WebKit\'s 0 (the lane off there, review 2), the constants cv-world\'s', async () => {
  const t = T(), n = nodeOf(t), sh = globalThis.__synthTest.shell, ps = sh.shell.perfSel, fs = sh.shell.fpsSel;
  const pick = v => { ps.value = v; ps.onchange({ type: 'change', target: ps }); };
  const fpick = v => { fs.value = v; fs.onchange({ type: 'change', target: fs }); };
  const seen = [];
  for (const p of ['medium', 'low', 'high']) {
    const n0 = sim.posted.length;
    pick(p); await settle(2);
    const after = sim.posted.slice(n0).map(x => x.m);
    const h = sxHostOf().host; // ((review 2, P1-1 a) the heavy displays' ceiling: 30 on Medium / Low, none on High; the curve's 30 / 60)
    seen.push([p, lastOf(n, 'fastOn').hz, after.every(m => m.t === 'fastOn'), after.length > 0, h.heavyHz(), h.curveHz()]);
  }
  assert.deepEqual(seen, [['medium', 60, true, true, 30, 30], ['low', 30, true, true, 30, 30], ['high', 120, true, true, 0, 60]]);
  const n1 = sim.posted.length;
  fpick('240'); await settle(2); fpick('120'); await settle(2);
  assert.equal(sim.posted.length, n1, 'a Frame rate pick: no worklet message');
  // the override (the harness's on / off) and back
  FR.force(0); await settle();
  assert.deepEqual([lastOf(n, 'fastOn').hz, FR.hz()], [0, 0], 'force(0): off');
  FR.force(45); await settle();
  assert.deepEqual([lastOf(n, 'fastOn').hz, FR.hz()], [45, 45]);
  FR.force(500); await settle();
  assert.equal(lastOf(n, 'fastOn').hz, cvWorld.FAST_MAX, 'clamped to FAST_MAX');
  FR.force(null); await settle();
  assert.equal(lastOf(n, 'fastOn').hz, 120);
  // reduced motion: ≤ 30 (a media query change re-syncs; here the sync is asked through force(null))
  const mm = globalThis.matchMedia;
  globalThis.matchMedia = q => ({ matches: /reduced-motion/.test(q), addEventListener() {}, removeEventListener() {} });
  try { FR.force(null); await settle(); assert.equal(lastOf(n, 'fastOn').hz, 30, 'reduced motion: 30'); }
  finally { globalThis.matchMedia = mm; FR.force(null); await settle(); }
  assert.equal(lastOf(n, 'fastOn').hz, 120);
  // the rule itself: min(FAST_Q[perf], WebKit ? FAST_WEBKIT : FAST_MAX), min(·, 30) under reduced motion — (review 2, the lead's P2-3)
  // WebKit's 0: the fast lane off there (Safari, the iPad: Cut A's behaviour) until the device harness measures it
  assert.deepEqual(['high', 'medium', 'low'].map(p => [FR.rate(p, false, false), FR.rate(p, true, false), FR.rate(p, false, true), FR.rate(p, true, true)]), [[120, 0, 30, 0], [60, 0, 30, 0], [30, 0, 30, 0]]);
  assert.deepEqual([cvWorld.FAST_Q.high, cvWorld.FAST_WEBKIT], [120, 0]);
});

test('§5.1: ix — the union per Serum part (the host\'s fastIx and the own-FX rack\'s modded knobs at NSV + 8 + flat), sorted, unique; ixv moves only when ix does; a host\'s fastIx() call re-syncs on a microtask; deliverFast hands the ix of d.k (the last two kept, an unknown k → null)', async () => {
  const t = T(), n = nodeOf(t), H = sxHostOf();
  const v0 = lastOf(n, 'fastOn').ixv;
  clear(n);
  H.ix = Int16Array.of(9, 3, 3, 12).sort(); // (a host's own array: sorted, may repeat)
  H.host.fastIx(); await Promise.resolve(); await Promise.resolve();
  const f1 = lastOf(n, 'fastOn');
  assert.ok(f1, 'host.fastIx() re-syncs on a microtask');
  assert.deepEqual([ixStr(f1), f1.ixv > v0, f1.hz, f1.ids.join()], ['i0:3.9.12', true, 120, 'c0,i0'], 'unique, sorted');
  clear(n);
  H.host.fastIx(); await Promise.resolve(); await Promise.resolve();
  assert.equal(fastOns(n).length, 0, 'the same ix: nothing posted, ixv kept');
  // a message carrying the current ixv gets that ix; the previous one still maps; an older one → null
  H.ix = Int16Array.of(5); H.host.fastIx(); await Promise.resolve(); await Promise.resolve();
  const f2 = lastOf(n, 'fastOn');
  assert.deepEqual([ixStr(f2), f2.ixv > f1.ixv], ['i0:5', true]);
  H.fast.length = 0;
  const v = new Float32Array(71), F = Fh() + 2000;
  inject(n, { t: 'fast', F, i: 'i0', k: f2.ixv, v });
  inject(n, { t: 'fast', F: F + 400, i: 'i0', k: f1.ixv, v: new Float32Array(73) });
  inject(n, { t: 'fast', F: F + 800, i: 'i0', k: v0, v });
  inject(n, { t: 'fast', F: F + 1200, i: 'i0', k: 99999, v });
  assert.deepEqual(H.fast.map(x => x.ix), ['5', '3,9,12', null, null], JSON.stringify(H.fast));
  assert.deepEqual(H.fast.map(x => x.F - F), [0, 400, 800, 1200], 'every Inst message reaches the host (setFast)');
  // a c0 message (a legacy node's rack: {c, gr, mo}) never reaches the host's setFast
  inject(n, { t: 'fast', F: F + 1600, c: 'c0', gr: null, mo: null });
  assert.equal(H.fast.length, 4, 'a rack message is the rack\'s');
  H.ix = Int16Array.of(3, 7); H.host.fastIx(); await Promise.resolve(); await Promise.resolve();
});

test('§5.3 the FX rack: host.gr() is the GR ring read at the heard frame while live (fast() true), the slow values otherwise; G6 — a step posted at F shows on the first frame with Fh ≥ F; stale after STALE_S → the slow values again', async () => {
  cv.renderViews(); await settle(4);
  const t = T(), n = nodeOf(t), X = fxStubOf(), H = X.host;
  assert.equal(typeof H.fast, 'function', 'fxHost.fast()');
  sim.run(2048); await settle(2); // (a slow smon: the fallback gr)
  const slow = H.gr();
  assert.equal(H.fast(), false, 'no fast data yet');
  quiet(n);
  const F0 = Fh(), Fa = F0 + 300, Fb = Fa + 400, Fc = Fb + 400;
  const g = v => { const a = new Float32Array(8); a[0] = v; a[5] = 0.25 * v; return a; };
  inject(n, { t: 'fast', F: Fa, c: 'c0', gr: g(3), mo: null });
  inject(n, { t: 'fast', F: Fb, c: 'c0', gr: g(9), mo: null });
  inject(n, { t: 'fast', F: Fc, c: 'c0', gr: g(9), mo: null });
  const rows = [];
  for (let i = 0; i < 60 && Fh() < Fc + 200; i++) { frame(128); rows.push([Fh(), H.gr() ? H.gr()[0] : NaN, H.fast()]); }
  const before = rows.filter(r => r[0] < Fa), mid = rows.filter(r => r[0] >= Fa && r[0] < Fb), first = rows.find(r => r[0] >= Fb);
  assert.ok(before.length && mid.length && first, 'frames on both sides');
  assert.ok(before.every(r => r[1] === (slow ? slow[0] : NaN) || (slow == null && r[1] !== r[1])), 'before the first anchor is heard: the slow values');
  assert.ok(mid.every(r => r[1] >= 3 && r[1] < 9 && r[2] === true), 'between: interpolated at the heard frame, fast() true');
  assert.ok(mid.every(r => near(r[1], 3 + 6 * (r[0] - Fa) / 400, 1e-4)), 'LIN at Fh: ' + mid.map(r => r[1].toFixed(3)).join());
  assert.ok(near(first[1], 9, 1e-6), 'the step shows on the first frame whose Fh reached it: ' + first[1]);
  // stale: no post for STALE_S of heard time → the slow values, fast() false
  await stale();
  assert.equal(H.fast(), false, 'stale: fast() false');
  const s2 = H.gr();
  assert.ok(s2 === null || s2[0] !== 9 || s2 === slow, 'stale: the slow gr');
});

test('§5.3 P2-4: while the rack\'s dots ring is live (the own-FX values from the Serum message\'s v[70 + j], j = the index\'s place in the union ix) a slow deliver only stores the fallback — no setLive, no blanking —; the frame paints them through one liveOf (the knob\'s value at Fh); stale → the slow path again', async () => {
  const t = T(), n = nodeOf(t), X = fxStubOf();
  assert.ok(cv.fx.addEffect('i1/fx', 'cmp'), 'a compressor in the Serum\'s own FX'); await settle(4);
  const X2 = fxStubOf(), fx = CMOD.instOf(T()).vals.fx || null;
  const q = core.fxDest('fx.cmp.thr', CMOD.fxDevOf(T()) ? CMOD.fxDevOf(T()).dev.fx : fx);
  assert.ok(q && Number.isFinite(q.flat), 'the knob\'s FX index');
  const idx = core.NSV + 8 + q.flat;
  X2.ids = ['fx.cmp.thr'];
  const Hs = sxHostOf(); Hs.ix = Int16Array.of(3, 7); Hs.host.fastIx(); await Promise.resolve(); await Promise.resolve(); await settle(1);
  const f = lastOf(nodeOf(T()), 'fastOn');
  assert.equal(ixStr(f), 'i0:3.7.' + idx, 'the own-FX rack\'s index joins the union: ' + ixStr(f));
  const nn = nodeOf(T());
  // the slow path paints (today): a slow smon → setLive
  sim.run(2048); await settle(2);
  const k0 = X2.lives.length;
  assert.ok(k0 > 0, 'slow: setLive per smon');
  // fast: three anchors with the knob's value 0.2 → 0.6
  quiet(nn);
  const F0 = Fh() + 200, mk = x => { const v = new Float32Array(73); v[72] = x; return v; };
  inject(nn, { t: 'fast', F: F0, i: 'i0', k: f.ixv, v: mk(0.2) });
  inject(nn, { t: 'fast', F: F0 + 400, i: 'i0', k: f.ixv, v: mk(0.6) });
  inject(nn, { t: 'fast', F: F0 + 800, i: 'i0', k: f.ixv, v: mk(0.6) });
  for (let i = 0; i < 40 && Fh() < F0 + 200; i++) frame(128);
  const k1 = X2.lives.length;
  frame(128);
  assert.ok(X2.lives.length > k1, 'a frame paints the dots');
  const live = X2.lives[X2.lives.length - 1];
  assert.equal(typeof live, 'function');
  const want = Fh() < F0 + 400 ? 0.2 + 0.4 * (Fh() - F0) / 400 : 0.6;
  assert.ok(near(live('fx.cmp.thr', 0.5), want, 1e-4), 'the knob\'s value at the heard frame: ' + live('fx.cmp.thr', 0.5) + ' (' + want + ')');
  assert.equal(live('fx.cmp.mix', 0.5), null, 'a knob not requested: none');
  // a slow smon while live: no setLive from it (the frame's own paint is the only one)
  const L0 = X2.lives.length;
  inject(nn, { t: 'smon', s: {}, gr: new Float32Array(8) });
  assert.equal(X2.lives.length, L0, 'P2-4: the slow deliver paints nothing while the ring is live');
  // stale → the slow path again
  await stale();
  const L1 = X2.lives.length;
  inject(nn, { t: 'smon', s: {}, gr: new Float32Array(8) });
  assert.equal(X2.lives.length, L1 + 1, 'stale: the slow deliver paints again');
  X2.ids = [];
});

test('(review 1, R1-A) an own-FX knob whose index the 64 cut leaves out of the union ix keeps its dot: the rack\'s values go the slow way (never a blank dot while the lane runs); with a small union the fast value', async () => {
  const X2 = fxStubOf(), Hs = sxHostOf(), fdev = CMOD.fxDevOf(T());
  const q = core.fxDest('fx.cmp.thr', fdev ? fdev.dev.fx : CMOD.instOf(T()).vals.fx), idx = core.NSV + 8 + q.flat;
  X2.ids = ['fx.cmp.thr'];
  Hs.ix = Int16Array.from({ length: 64 }, (_, i) => 100 + i); // (a busy Serum page: 64 requested indices of its own, all below the rack's)
  Hs.host.fastIx(); await Promise.resolve(); await Promise.resolve(); await settle(1);
  const f = lastOf(nodeOf(T()), 'fastOn');
  assert.deepEqual([f.hz, Array.from(f.ix.i0).length, Array.from(f.ix.i0).includes(idx)], [120, 64, false], 'precondition: the own-FX index cut');
  for (let i = 0; i < 30; i++) frame(512);                     // (the real engine's fast and slow posts)
  const last = X2.lives[X2.lives.length - 1], v = last ? last('fx.cmp.thr', 0.5) : 'none';
  assert.equal(typeof v, 'number', 'the knob\'s dot while the lane runs: ' + v);
  Hs.ix = Int16Array.of(3, 7); Hs.host.fastIx(); await Promise.resolve(); await Promise.resolve(); await settle(1);
  assert.equal(Array.from(lastOf(nodeOf(T()), 'fastOn').ix.i0).includes(idx), true, 'a small union holds it');
  for (let i = 0; i < 30; i++) frame(512);
  const last2 = X2.lives[X2.lives.length - 1];
  assert.equal(typeof (last2 ? last2('fx.cmp.thr', 0.5) : 'none'), 'number', 'the fast value');
  X2.ids = [];
});

test('(review 1, R1-C) the heard frame before the oldest anchor (an output delay past the ring\'s span): the master row keeps its summaries — setHeard stays false until the first anchor is heard', async () => {
  const row = MS.row(), m = mNode();
  quiet(m); await stale();
  const F0 = Fh() + Math.round(0.3 * SR), M = (tp, pk) => Float32Array.of(tp, tp - 1, pk, pk - 2, 0.5, -14, -15);
  for (let k = 0; k < 4; k++) inject(m, { t: 'fast', F: F0 + 400 * k, m: M(-3, -6) });
  const seen = [];
  for (let i = 0; i < 10; i++) { frame(128); seen.push([Fh() < F0, row.state().heard]); }
  assert.deepEqual([seen.every(r => r[0]), seen.filter(r => r[1]).length], [true, 0], 'before the first anchor: not heard (the summaries fold the bars)');
  for (let i = 0; i < 300 && Fh() < F0 + 100; i++) frame(128);
  assert.equal(row.state().heard, true, 'heard once the anchor is');
  await stale();
});

test('§5.3 / §5.5 the master\'s meters: a peak posted at F is folded on the first frame whose Fh reached it (the row and the OUT through heard(), drained once), setHeard(true) while the ring is live, false once stale', async () => {
  const row = MS.row(), m = mNode();
  assert.ok(row && typeof row.state === 'function');
  quiet(m);
  const F0 = Fh() + 300, M = (tp, pk) => Float32Array.of(tp, tp - 1, pk, pk - 2, 0.5, -14, -15);
  inject(m, { t: 'fast', F: F0, m: M(-30, -30) });
  inject(m, { t: 'fast', F: F0 + 400, m: M(-3, -6) });
  inject(m, { t: 'fast', F: F0 + 800, m: M(-40, -40) });
  const seen = [];
  for (let i = 0; i < 60 && Fh() < F0 + 900; i++) { frame(128); seen.push([Fh(), row.state().pk[0], row.state().heard]); }
  const pre = seen.filter(r => r[0] < F0 + 400), hit = seen.find(r => r[0] >= F0 + 400);
  assert.ok(pre.length && hit, 'frames on both sides');
  assert.ok(pre.every(r => r[1] < -6 + 1e-9), 'not before it is heard');
  assert.ok(near(hit[1], -6, 1e-6), 'the peak on the first frame with Fh ≥ its F: ' + hit[1]);
  assert.ok(seen.some(r => r[2] === true), 'setHeard(true) while live');
  await stale();
  assert.equal(row.state().heard, false, 'stale: setHeard(false) — the summaries fold again');
});

test('§5.3 P2-10: heardFrame() within a frame is outFrame(the frame\'s rAF time), whoever reads it and when; between frames the last one\'s for ≤ 20 ms, then afresh', async () => {
  await settle(2);
  sim.advance(17); sim.raf();
  const ts = performance.now(), want = FR.outFrame(ts);
  sim.advance(5);
  assert.equal(Fh(), want, 'a read 5 ms into the frame: the frame\'s own heard frame');
  sim.advance(30);
  assert.equal(Fh(), FR.outFrame(performance.now()), '> 20 ms with no frame: read afresh');
});

test('§5.3 P2-5 / mcFast / cpFast: a Juno with a canvas LFO on its cutoff — the classic dot from the fast e at the heard frame (cpSnap through the inverse transfer), the LFO body fed {v, ph, y, out, F}, a slow mcSnap skipped while it is; a canvas ENV injected into a Serum\'s ENV slot fed from the Serum\'s fast v (P2-5)', async () => {
  const j = api.addTrack(MOD('juno60')); await settle(2);
  api.selectTrack(j.id); cv.renderViews(); await settle(3);
  const t = T();
  t.dev.l1 = S.normModDev({ kind: 'lfo', lfo: { mono: 1, mode: 'free', bpm: 0, anchor: 0 } });
  const r = CMOD.addMod(t, 'l1.out', 'i1:cf', { project: P() });
  assert.equal(r.ok, true, r.why);
  api.queuePatch(t); cv.renderViews(); await settle(6);
  const n = nodeOf(t), f = lastOf(n, 'fastOn');
  assert.ok(f && f.hz === 120, 'the Juno node asked: ' + JSON.stringify(f && { hz: f.hz, ids: f.ids }));
  assert.ok(f.ids.includes('mods') && f.ids.includes('i1'), 'its parts: the panel\'s Inst and mods: ' + f.ids.join());
  // the classic dot
  quiet(n);
  const k = t.id + '/i1', pay = api.buildMods(t), xf = pay.xfer[0], TX = x => (xf.tab ? xf.tab[Math.round(x * 128)] : xf.a + xf.b * x);
  const x0 = Math.min(1, xf.x0 + 0.1), x1 = Math.min(1, xf.x0 + 0.3), F0 = Fh() + 300;
  inject(n, { t: 'fast', F: F0, i: 'i1', e: Float32Array.of(TX(x0)) });
  inject(n, { t: 'fast', F: F0 + 400, i: 'i1', e: Float32Array.of(TX(x1)) });
  inject(n, { t: 'fast', F: F0 + 800, i: 'i1', e: Float32Array.of(TX(x1)) });
  for (let i = 0; i < 40 && Fh() < F0 + 400; i++) frame(128);
  const c = MOD('juno60').controls.find(q => q.id === 'cf'), cf = U.live.get(k) && U.live.get(k).cf;
  assert.ok(typeof cf === 'number' && Math.abs(cf - (c.min + (c.max - c.min) * x1)) < 0.03 * (c.max - c.min), 'the dot at the heard value: ' + cf);
  // a slow eff while live: the fallback only (the dot stays the heard one)
  inject(n, { t: 'smon', i: 'i1', s: { eff: Float32Array.of(TX(xf.x0)) } });
  assert.ok(Math.abs(U.live.get(k).cf - cf) < 1e-9, 'P2-4: a slow eff does not overwrite the heard dot');
  // the LFO body: {v, ph, y, out, F}
  const B = cv.mod.bodies.get('l1');
  assert.ok(B && B.kind === 'lfo', 'the LFO body mounted');
  const ups = [], u0 = B.update;
  B.update = v => { ups.push(v && typeof v === 'object' ? { v: v.v, ph: v.ph, y: v.y, out: v.out, F: v.F } : { n: v }); return u0.call(B, v); };
  const slot = pay.slots.l1.i, mc = new Float32Array(16), x = new Float32Array(28);
  mc[slot] = 0.25; x[slot] = 0.5; x[10 + slot] = 0.75;
  inject(n, { t: 'fast', F: F0 + 900, mc, x });
  assert.deepEqual(ups.at(-1), { v: 0.25, ph: 0.5, y: 0.75, out: 0.25, F: F0 + 900 }, 'mcFast: the slot host\'s ring gets F');
  for (let i = 0; i < 60 && Fh() < F0 + 900; i++) frame(128); // ((review 1, R1-C) the skip holds once the ring answers: its anchor heard)
  const nu = ups.length;
  inject(n, { t: 'smon', mc, mcx: { ph: x.slice(0, 20), env: x.slice(20) } });
  assert.equal(ups.length, nu, 'a slow mcSnap skips a body fed fast');
  B.update = u0;
});

test('(review 1, R1-C) before the oldest anchor the consumers keep their slow values: the classic dot paints from a slow eff, the LFO body from a slow mcSnap; (P3) a chaos body is never fed fast (its slow mcSnap moves it while the lane runs); (P3) the node\'s lane off (hz 0) flushes the bodies\' slot-host rings', async () => {
  const t = T(), n = nodeOf(t);
  t.dev.h1 = S.normModDev({ kind: 'chaos' });
  const r = CMOD.addMod(t, 'h1.out', 'i1:rs', { project: P() });
  assert.equal(r.ok, true, r.why);
  api.queuePatch(t); cv.renderViews(); await settle(6);
  quiet(n); await stale();
  const k = t.id + '/i1', pay = api.buildMods(t), xf = pay.xfer[0], TX = x => (xf.tab ? xf.tab[Math.round(x * 128)] : xf.a + xf.b * x);
  const B = cv.mod.bodies.get('l1'), C = cv.mod.bodies.get('h1'), sl = pay.slots.l1.i, sc = pay.slots.h1 && pay.slots.h1.i;
  assert.ok(B && C && C.kind === 'chaos' && sc >= 14, 'the LFO and chaos bodies, the chaos slot: ' + sc);
  const ups = [], cups = [], u0 = B.update, c0 = C.update;
  B.update = v => { ups.push(v && typeof v === 'object' ? { v: v.v, F: v.F } : { n: v }); return u0.call(B, v); };
  C.update = v => { cups.push(v && typeof v === 'object' ? { v: v.v, F: v.F } : { v }); return c0.call(C, v); }; // (mcSnap hands a chaos body its number)
  try {
    // posts that lead the heard frame by 0.3 s: every read BEFORE
    const F0 = Fh() + Math.round(0.3 * SR), mc = new Float32Array(16), x = new Float32Array(28);
    mc[sl] = 0.25; mc[sc] = 0.75; x[sl] = 0.5;
    for (let j = 0; j < 3; j++) {
      inject(n, { t: 'fast', F: F0 + 400 * j, i: 'i1', e: Float32Array.of(TX(Math.min(1, xf.x0 + 0.3))) });
      inject(n, { t: 'fast', F: F0 + 400 * j, mc, x });
    }
    assert.deepEqual(cups.filter(u => u.F !== undefined), [], 'P3: no fast value reaches the chaos body');
    frame(128);
    assert.ok(Fh() < F0, 'still before the first anchor');
    const xs = Math.min(1, xf.x0 + 0.1), c = MOD('juno60').controls.find(q => q.id === 'cf');
    inject(n, { t: 'smon', i: 'i1', s: { eff: Float32Array.of(TX(xs)) } });
    const cf = U.live.get(k) && U.live.get(k).cf;
    assert.ok(typeof cf === 'number' && Math.abs(cf - (c.min + (c.max - c.min) * xs)) < 0.03 * (c.max - c.min), 'the classic dot from the slow eff: ' + cf);
    const nu = ups.length, nc = cups.length, mc2 = new Float32Array(16);
    mc2[sl] = 0.125; mc2[sc] = 0.375;
    inject(n, { t: 'smon', mc: mc2, mcx: { ph: new Float32Array(20), env: new Float32Array(8) } });
    assert.deepEqual([ups.length - nu, ups.at(-1) && ups.at(-1).F], [1, undefined], 'the LFO body from the slow mcSnap');
    assert.deepEqual([cups.length - nc, cups.at(-1) && cups.at(-1).v], [1, 0.375], 'the chaos body from the slow mcSnap');
    // the lane off: the bodies' slot hosts flushed
    const H = B.host();
    assert.equal(H.fastLive(), true, 'the LFO body\'s ring holds the posts');
    FR.force(0); await settle(1);
    assert.equal(H.fastLive(), false, 'hz 0: fastDrop flushes the slot host\'s ring');
  } finally { B.update = u0; C.update = c0; FR.force(null); await settle(1); }
});

test('§5.3 P2-5: a canvas ENV injected into a Serum\'s free ENV slot is fed from the Serum\'s fast message (v[58 + k] / v[62 + k] / v[66 + k] at F); the slow sxInjSnap skips it while it is', async () => {
  api.selectTrack(SERUM); cv.renderViews(); await settle(4);
  const t = T();
  t.dev.e1 = S.normModDev({ kind: 'env' });
  const r = CMOD.addMod(t, 'e1.out', 'i1:f.cutoff', { project: P() });
  assert.equal(r.ok, true, r.why);
  api.queuePatch(t); cv.renderViews(); await settle(6);
  const inj = FR.injEnv(t);
  assert.ok(inj.length === 1 && inj[0].key === 'e1', 'injected: ' + JSON.stringify(inj));
  const k = inj[0].k, B = cv.mod.bodies.get('e1');
  assert.ok(B && B.kind === 'env', 'the ENV body mounted');
  const n = nodeOf(t), f = lastOf(n, 'fastOn'), part = f.ids.find(x => x !== 'c0' && x !== 'mods');
  assert.ok(f.hz === 120 && part, 'asked: ' + f.ids.join());
  quiet(n);
  const ups = [], u0 = B.update;
  B.update = v => { ups.push(v && typeof v === 'object' ? { v: v.v, stage: v.stage, t: v.t, F: v.F } : { n: v }); return u0.call(B, v); };
  const v = new Float32Array(70), F = Fh() + 500;
  v[MOTION.SXF.env + k] = 0.4; v[MOTION.SXF.envStage + k] = 2; v[MOTION.SXF.envT + k] = 0.125;
  inject(n, { t: 'fast', F, i: part, k: f.ixv, v });
  assert.deepEqual(ups.at(-1), { v: Math.fround(0.4), stage: 2, t: 0.125, F }, 'the body gets the fast values with F');
  for (let i = 0; i < 60 && Fh() < F; i++) frame(128); // ((review 1, R1-C) the skip holds once the ring answers: its anchor heard)
  const nu = ups.length;
  const s = { env: new Float32Array(4), envStage: new Float32Array(4), envT: new Float32Array(4) };
  inject(n, { t: 'smon', i: part === 'i0' ? undefined : part, s });
  assert.equal(ups.length, nu, 'the slow snapshot skips a body fed fast');
  B.update = u0;
});

test('§5.3 hooks: __synthTest.fr — rings() (every consumer ring: its kind, size, newest, live), trace(n) (the next n painted frames: t, Fh, newest, status, probe)', async () => {
  const L = FR.rings();
  assert.ok(Array.isArray(L) && L.every(x => typeof x.kind === 'string' && typeof x.size === 'number' && typeof x.live === 'boolean'), JSON.stringify(L.slice(0, 3)));
  const p = FR.trace(3);
  for (let i = 0; i < 5; i++) frame();
  const rec = await p;
  assert.equal(rec.length, 3);
  assert.ok(rec.every(x => typeof x.t === 'number' && typeof x.Fh === 'number' && 'newest' in x && 'status' in x && 'probe' in x), JSON.stringify(rec[0]));
  assert.ok(rec[1].t > rec[0].t && rec[1].Fh > rec[0].Fh, 'frames in order');
});

test('§5.1 P1-2: fastOn follows on — a power cycle (fastReset: the hosts\' rings and the fastOn map; the new nodes asked after their mon), a graph change on the same node (asked again with the new ids), a model change (fast live again)', async () => {
  api.selectTrack(SERUM); cv.renderViews(); await settle(4);
  const H = sxHostOf(), r0 = H.resets;
  await FR.off();
  assert.ok(H.resets > r0, 'powerOff: the hosts\' fastReset');
  assert.equal(FR.fastOn().size, 0, 'the fastOn map cleared');
  await api.powerOn(); await settle(4);
  const n = nodeOf(T()), all = msgs(n).map(m => m.t);
  assert.ok(all.includes('mon') && all.indexOf('fastOn') > all.indexOf('mon'), 'the new node: mon, then fastOn: ' + all.filter(x => /mon|fast/.test(x)).join());
  assert.equal(lastOf(n, 'fastOn').hz, 120, 'fast again after powerOff → powerOn');
  assert.equal(lastOf(mNode(), 'fastOn').hz, 120, 'MASTER too (masterSync)');
  // a graph change on the same node (a second instrument: device ids from now on): asked again
  clear(n);
  cv.add('juno60', null); cv.renderViews(); await settle(6);
  const n2 = nodeOf(T());
  const f2 = lastOf(n2, 'fastOn');
  assert.ok(f2 && f2.hz === 120, 'asked again: ' + msgs(n2).map(m => m.t).filter(x => /mon|fast|graph/.test(x)).join());
  assert.deepEqual([f2.ids.every(x => lastOf(n2, 'mon').ids.includes(x)), f2.ids.includes('i0')], [true, false], 'the new ids (devices), ⊆ the watched: ' + f2.ids.join());
  // a model change: fast live again on whatever node the track has then
  cv.setTrackModel(T(), 'juno60'); cv.renderViews(); await settle(4);
  cv.setTrackModel(T(), RIG.ID); cv.renderViews(); await settle(6);
  const f3 = lastOf(nodeOf(T()), 'fastOn');
  assert.ok(f3 && f3.hz === 120 && f3.ids.length > 0, 'fast live after the model change: ' + JSON.stringify(f3 && { hz: f3.hz, ids: f3.ids }));
});
