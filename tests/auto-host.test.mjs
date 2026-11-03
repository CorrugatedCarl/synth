import './v8-guard.mjs';
// Stage AUTO phase 0 (docs/canvas/IMPL-AUTO.md §2.2, §4.1, §5.2, §10.0, §10.2; lane P0H) in the page simulation with the real main.js:
// the automation host's pure functions through __synthTest.cv.auto, by track id — autoOk (by family, as cv-mods destOk dispatches:
// laws excluded; the DOM side okEl: [data-nomod] / [data-twin] refused, the device by cv-cables' devAt rule), autoGet, autoApply (the
// model's own path: one {t: 'patch'} with the field changed and nothing else — no History step, the preset kept, no autosave; the
// mixer: its nodes only, no patch), autoRange, autoFmt (the family's own formatter), autoLabel ({ short, long }) on a Minimoog, a rig
// (Wavecraft), an FX knob (the rig's Reverb), a kit voice and the mixer; renderTick (the render tick, once a frame); set / held /
// override. One boot; strings, numbers and booleans only into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/auto-host.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as C from '../serum-core.js?v=9';
import * as CM from '../cv-mods.js?v=9';
import * as CMOD from '../cv-model.js?v=9';
import * as KC from '../kit-core.js?v=9';
import * as KUI from '../kit-ui.js?v=9';
import * as AC from '../audioclock.js?v=9';
import { fmtCore } from '../laws.js?v=9';
import { MODELS } from '../models.js?v=9';
import { RIG } from '../rig-core.js?v=9';
import * as WK from '../wk.js?v=9';

const alive = setInterval(() => {}, 50); // (the sim's timers are unref'd: a ref'd one keeps the process up through the top-level setup)
const ls = fakeStorage({});
const sim = await bootMain({ ls, clock: 'std', outLat: 0.03 });
const api = sim.api, cv = globalThis.__synthTest.cv, acc = globalThis.__synthTest.acc, A = cv.auto;
await sim.power(); await sim.settle(20);
sim.$('#modal').hidden = true;
const P = () => api.project(), byId = id => P().tracks.find(t => t.id === id);
const settle = async (n = 3) => { for (let i = 0; i < n; i++) { sim.raf(); await sim.settle(3); } };
// the tracks: the project's Minimoog, a rig with a Reverb in its own effects, a kit (the Starter's voices)
const ID = { m: P().tracks[0].id, r: api.addTrack(RIG.ID).id, k: api.addTrack(KC.KIT.ID).id };
await settle();
api.selectTrack(ID.r); await settle();
const REV = cv.fx.addEffect('i1/fx', 'rev'); await settle();
api.selectTrack(ID.m); await settle();
clearInterval(alive);
const dev = id => CMOD.instOf(byId(id), 'i1');
const MOOG = MODELS.find(m => m.id === 'minimoog'), FC = MOOG.controls.find(c => c.id === 'fc');
const posted = id => sim.nodeOf(id).posted.map(x => x.m);
// a patch without its tables (postPatch sends serumT / seqT / fxrT only when their keys moved) as one string — compared as a boolean (a
// rig's patch is ≈ 34 KB: never into an assertion's message)
const bare = p => { const o = Object.assign({}, p); delete o.serumT; delete o.seqT; delete o.fxrT; return JSON.stringify(o); };
// a value written by autoApply: the messages it posts at the next frame, the History length, the autosave writes and the stored project
// before / after (the autosave's 400 ms timer let run)
async function applied(tid, key, v) {
  await sim.settle(450); await settle();
  const n0 = posted(tid).length, h0 = cv.hist.u.length, w0 = ls.writes.length;
  const ok = A.apply(tid, key, v);
  await settle(); await sim.settle(450);
  return { ok, msgs: posted(tid).slice(n0), hist: cv.hist.u.length - h0, writes: ls.writes.slice(w0) };
}

test('autoOk by family (§2.2): the mixer\'s two; a classic knob of class sm / apply / proc / chunk — not none, not a selector or a toggle; a rig DESTS id — not enum / int / bool, not a plain switch, not arp / clip, no placeholder; an FX row that exists — not bool / enum; a present kit voice\'s u d l 1–4 — not t, not c, not an empty slot; the master\'s and unknown keys never', () => {
  const ok = (tid, keys) => keys.map(k => A.ok(tid, k));
  assert.deepEqual(ok(ID.m, ['mix:vol', 'mix:pan', 'mix:foo']), [true, true, false], 'the mixer');
  assert.deepEqual([CM.classOf('minimoog', 'fc'), CM.classOf('minimoog', 'fa'), CM.classOf('minimoog', 'gl'), CM.classOf('minimoog', 'w1'), CM.classOf('minimoog', 'mm')], ['sm', 'apply', 'proc', 'chunk', 'none']);
  assert.deepEqual(ok(ID.m, ['i1:fc', 'i1:fa', 'i1:gl', 'i1:tune', 'i1:mm', 'i1:w1', 'i1:m1', 'i1:zz', 'i9:fc', 'mfx:fx.cmp.thr']), [true, true, true, true, false, false, false, false, false, false], 'the Minimoog');
  assert.deepEqual(ok(ID.r, ['i1:f.cutoff', 'i1:f.res', 'i1:e1.att', 'i1:f.type', 'i1:a.uni', 'i1:f.on', 'i1:f.routeA', 'i1:arp.rate', 'i1:clip.trans', 'i1:bus3', 'i1:g.wheel', 'i1:nope']),
    [true, true, true, false, false, false, false, false, false, false, false, false], 'the rig');
  assert.equal(REV, 'rev', 'the Reverb instance');
  assert.deepEqual(ok(ID.r, ['i1:fx.rev.size', 'i1:fx.rev.mix', 'i1:fx.rev.type', 'i1:fx.rev.prebpm', 'i1:fx.nope.size', 'i1:fx.rev.nope']), [true, true, false, false, false, false], 'the rig\'s Reverb');
  assert.deepEqual(ok(ID.k, ['i1:kad', 'i1:kau', 'i1:kal', 'i1:ka1', 'i1:ka4', 'i1:kat', 'i1:kac', 'i1:kpd', 'i1:kaz']), [true, true, true, true, true, false, false, false, false], 'the kit (slot p empty)');
  assert.deepEqual(ok(ID.m, ['i1:kad', 'fx1:fx.rev.size']), [false, false], 'another family\'s ids on a classic; an empty panel');
});

test('okEl (§3.1): the closest [data-dest], the device by the closest [data-dev] else the module\'s data-cv-mod; [data-nomod] and a [data-twin] refused; an element without a control null', async () => {
  const D = globalThis.document, mk = (attrs, kids = []) => { const e = D.createElement('div'); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); for (const c of kids) e.append(c); return e; };
  const ring = mk({}), knob = mk({ 'data-dest': 'fc' }, [ring]); mk({ 'data-dev': 'i1' }, [knob]);
  assert.equal(A.okEl(ring), 'i1:fc', 'a classic knob\'s inner element: its control, its panel\'s data-dev');
  const sel = mk({ 'data-dest': 'w1' }); mk({ 'data-dev': 'i1' }, [sel]);
  assert.equal(A.okEl(sel), null, 'a selector: no');
  api.selectTrack(ID.r); await settle();
  const cut = mk({ 'data-dest': 'f.cutoff' }); mk({ 'data-cv-mod': 'i1/filter' }, [cut]);
  assert.equal(A.okEl(cut), 'i1:f.cutoff', 'a rig face: no data-dev, the module\'s data-cv-mod device');
  const nm = mk({ 'data-dest': 'f.res', 'data-nomod': '1' }); mk({ 'data-cv-mod': 'i1/filter' }, [nm]);
  const tw = mk({ 'data-dest': 'f.res' }); mk({ 'data-twin': '1', 'data-cv-mod': 'i1/filter' }, [tw]);
  assert.deepEqual([A.okEl(nm), A.okEl(tw), A.okEl(mk({})), A.okEl(null)], [null, null, null, null], 'data-nomod, a twin, nothing');
  api.selectTrack(ID.m); await settle();
});

test('get / range / fmt / label (§5.1, §5.2): each family\'s base, its domain, its own readout and the names the user sees', () => {
  const mo = dev(ID.m), ri = dev(ID.r), ki = dev(ID.k), tm = byId(ID.m);
  assert.deepEqual([A.get(ID.m, 'i1:fc'), A.range(ID.m, 'i1:fc'), A.fmt(ID.m, 'i1:fc', 6.5), A.label(ID.m, 'i1:fc')], [mo.vals.fc, { lo: 0, hi: 10 }, FC.fmt(6.5), { short: 'Cutoff', long: 'Minimoog · Cutoff' }], 'the Minimoog\'s cutoff (classic-panel fmt)');
  assert.deepEqual([A.range(ID.m, 'i1:tune'), A.range(ID.m, 'i1:w1')], [{ lo: -1, hi: 1 }, null], 'a centred knob; a selector has no lane');
  assert.deepEqual([A.get(ID.r, 'i1:f.cutoff'), A.range(ID.r, 'i1:f.cutoff'), A.fmt(ID.r, 'i1:f.cutoff', 0.75), A.label(ID.r, 'i1:f.cutoff')],
    [C.destBase(ri.vals.s, ri.fx, 'f.cutoff'), { lo: 0, hi: 1 }, C.fmtParam('f.cutoff', 0.75, { s: ri.vals.s, fx: ri.fx, bpm: P().bpm }), { short: 'Cutoff', long: 'Filter 1 · Cutoff' }], 'the rig\'s cutoff (serum-core fmtParam; the module\'s bar title)');
  assert.deepEqual(A.label(ID.r, 'i1:e2.att'), { short: 'Attack', long: 'Envelope 2 · Attack' });
  assert.deepEqual([A.label(ID.m, 'i1:fa'), A.label(ID.m, 'i1:la')], [{ short: 'Filter Attack', long: 'Minimoog · Filter Attack' }, { short: 'Loudness Contour Attack', long: 'Minimoog · Loudness Contour Attack' }], 'a label two controls share is named by its section (the lead, after the fix round)');
  assert.deepEqual(A.label(ID.r, 'i1:g.porta').long.split(' · ')[0], 'Amplifier', 'an instrument-wide id: the Amplifier');
  // the Reverb row: fx-ui's own readout (fmtV: fmtParam on a one-instance view whose instance carries its type id)
  const I = ri.fx.racks.flatMap(r => r.mods).find(m => m.id === 'rev'), E = () => ({ mods: [], byp: 0, lock: 0, route: 0 });
  const fview = { v: 2, racks: [{ mods: [Object.assign({}, I, { id: I.type })], byp: 0, lock: 0, route: 0 }, E(), E()], ui: {} };
  assert.deepEqual([A.get(ID.r, 'i1:fx.rev.size'), A.range(ID.r, 'i1:fx.rev.size'), A.fmt(ID.r, 'i1:fx.rev.size', 0.3), A.label(ID.r, 'i1:fx.rev.size')],
    [C.destBase(null, ri.fx, 'fx.rev.size'), { lo: 0, hi: 1 }, C.fmtParam('fx.rev.size', 0.3, { fx: fview, bpm: P().bpm }), { short: 'Size', long: 'Reverb · Size' }], 'the Reverb\'s size (as fx-ui prints it)');
  const kick = KC.KIT.TYPES[ki.vals.kat];
  assert.deepEqual([kick.label, A.get(ID.k, 'i1:kad'), A.range(ID.k, 'i1:kad'), A.fmt(ID.k, 'i1:kad', 4), A.label(ID.k, 'i1:kad')], ['Kick', ki.vals.kad, { lo: 0, hi: 10 }, KUI.fmtKnob(kick.d, 0.4), { short: 'Decay', long: 'Kick · Decay' }], 'the kick\'s decay (kit-ui fmtKnob over the position)');
  assert.deepEqual([A.fmt(ID.k, 'i1:kal', 7), A.label(ID.k, 'i1:kal'), A.label(ID.k, 'i1:kdl').long], [KUI.fmtLevel(0.7), { short: 'Level', long: 'Kick · Level' }, 'Closed hat · Level'], 'LEVEL: fmtLevel; a named voice');
  assert.deepEqual([A.get(ID.m, 'mix:vol'), A.get(ID.m, 'mix:pan'), A.range(ID.m, 'mix:vol'), A.range(ID.m, 'mix:pan')], [tm.vol, tm.pan, { lo: 0, hi: 1.25 }, { lo: -1, hi: 1 }], 'the mixer (t.vol 0…1.25 as the fader)');
  assert.deepEqual([A.fmt(ID.m, 'mix:vol', 0.5), A.fmt(ID.m, 'mix:vol', 0), A.fmt(ID.m, 'mix:pan', -0.5), A.fmt(ID.m, 'mix:pan', 0)], [fmtCore('db', 0.5, 0.5, {}), fmtCore('db', 0, 0, {}), 'L25', 'C'], 'dB; L / C / R');
  assert.deepEqual([A.label(ID.m, 'mix:vol'), A.label(ID.m, 'mix:pan')], [{ short: 'Volume', long: 'Volume' }, { short: 'Pan', long: 'Pan' }]);
  assert.deepEqual([A.get(ID.m, 'i9:fc'), A.range(ID.m, 'i9:fc'), A.fmt(ID.m, 'i9:fc', 1), A.label(ID.m, 'i9:fc'), A.apply(ID.m, 'i9:fc', 1)], [undefined, null, '', null, false], 'a key that resolves to nothing');
});

test('apply on the Minimoog: vals.fc ← v (clamped), ONE {t: \'patch\'} whose changed fields are fc\'s targets only (= buildPatch now); no History step, the preset name kept, no autosave', async () => {
  const d = dev(ID.m), t = byId(ID.m);
  d.preset = 'Keep me';
  const before = JSON.parse(bare(api.buildPatch(t))), v0 = d.vals.fc, rest = JSON.stringify(Object.assign({}, d.vals, { fc: 0 }));
  const R = await applied(ID.m, 'i1:fc', v0 > 5 ? 2.5 : 7.5);
  assert.deepEqual([R.ok, R.msgs.map(m => m.t), R.hist, R.writes.length], [true, ['patch'], 0, 0], 'one patch; no step; no autosave write');
  assert.deepEqual([d.vals.fc, d.preset, JSON.stringify(Object.assign({}, d.vals, { fc: 0 })) === rest], [v0 > 5 ? 2.5 : 7.5, 'Keep me', true], 'fc alone moved; the preset kept');
  const p = JSON.parse(bare(R.msgs[0].p)), diff = [...CM.fieldDiff(before, p)], fields = CM.targetsOf('minimoog', 'fc').map(x => x.field);
  assert.ok(diff.length > 0, 'the patch moved');
  assert.deepEqual(diff.filter(x => !fields.some(f => x === f || x.indexOf(f + '.') === 0)), [], 'nothing but fc\'s fields (' + fields.join(', ') + ') changed: ' + diff.join(', '));
  assert.equal(bare(R.msgs[0].p) === bare(api.buildPatch(t)), true, 'the patch is the model\'s');
  const C2 = await applied(ID.m, 'i1:fc', 99);
  assert.deepEqual([C2.ok, d.vals.fc, C2.hist], [true, 10, 0], 'clamped to the knob\'s range');
  d.preset = null;
});

test('apply on the rig: s.p[\'f.cutoff\'] through setDestBase + syncS1 — one patch, the state otherwise identical, no History step, no sxDirty, no autosave', async () => {
  const d = dev(ID.r), t = byId(ID.r), dirty0 = acc.sxDirty.size;
  d.preset = 'Rig keep';
  const s0 = JSON.parse(JSON.stringify(d.vals.s)), v = A.get(ID.r, 'i1:f.cutoff') > 0.5 ? 0.25 : 0.8;
  const R = await applied(ID.r, 'i1:f.cutoff', v);
  assert.deepEqual([R.ok, R.msgs.map(m => m.t), R.hist, R.writes.length], [true, ['patch'], 0, 0], 'one patch; no step; no autosave write');
  assert.deepEqual([A.get(ID.r, 'i1:f.cutoff'), d.preset, acc.sxDirty.size], [v, 'Rig keep', dirty0], 'the base; the preset kept; not marked edited');
  s0.p['f.cutoff'] = v;
  assert.equal(JSON.stringify(d.vals.s) === JSON.stringify(s0), true, 'f.cutoff alone moved');
  assert.equal(bare(R.msgs[0].p) === bare(api.buildPatch(t)), true, 'the patch is the model\'s');
  d.preset = null;
});

test('apply on the rig\'s Reverb: the instance\'s p.size (fxSet) — one patch, the rack otherwise identical, no History step, no autosave', async () => {
  const d = dev(ID.r), f0 = JSON.parse(JSON.stringify(d.fx)), v = A.get(ID.r, 'i1:fx.rev.size') > 0.5 ? 0.2 : 0.9;
  const R = await applied(ID.r, 'i1:fx.rev.size', v);
  assert.deepEqual([R.ok, R.msgs.map(m => m.t), R.hist, R.writes.length], [true, ['patch'], 0, 0]);
  f0.racks.flatMap(r => r.mods).find(m => m.id === 'rev').p.size = v;
  assert.deepEqual([A.get(ID.r, 'i1:fx.rev.size'), JSON.stringify(d.fx) === JSON.stringify(f0)], [v, true], 'size alone moved');
});

test('apply on a kit voice: vals.kad (0…10) — one patch (no 15 Hz throttle), the vals otherwise identical, the kit\'s name kept, no History step, no autosave', async () => {
  const d = dev(ID.k), v0 = JSON.stringify(Object.assign({}, d.vals, { kad: 0 })), pr = d.preset, v = d.vals.kad > 5 ? 2.25 : 8.5;
  const R = await applied(ID.k, 'i1:kad', v);
  assert.deepEqual([R.ok, R.msgs.map(m => m.t), R.hist, R.writes.length], [true, ['patch'], 0, 0]);
  assert.deepEqual([d.vals.kad, JSON.stringify(Object.assign({}, d.vals, { kad: 0 })) === v0, d.preset], [v, true, pr], 'kad alone moved; the preset as it was');
  assert.deepEqual([A.apply(ID.k, 'i1:kat', 3), d.vals.kat], [false, 1], 'TYPE is no automation target: never written');
  const w0 = ls.writes.length; // (the probe's control: the face's own writer, kitKnob, autosaves — the "no autosave" above is a real 0)
  cv.kit.knob(ID.k, 'kad', 5, 'end'); await settle(); await sim.settle(450);
  assert.equal(ls.writes.length > w0, true, 'the voice knob\'s own writer autosaves');
});

test('apply on the mixer: t.vol / t.pan and that track\'s gain / pan nodes (mixOne) — no patch, no other track\'s node touched, no History step, no autosave', async () => {
  const t = byId(ID.m), N = api.nodes.get(ID.m), O = api.nodes.get(ID.r), o0 = [O.gain.gain.value, O.pan.pan.value];
  const R = await applied(ID.m, 'mix:vol', 0.5);
  assert.deepEqual([R.ok, R.msgs.length, R.hist, R.writes.length, t.vol, N.gain.gain.value], [true, 0, 0, 0, 0.5, 0.5], 'the fader');
  const Q = await applied(ID.m, 'mix:pan', -2);
  assert.deepEqual([Q.ok, Q.msgs.length, t.pan, N.pan.pan.value], [true, 0, -1, -1], 'the pan, clamped');
  assert.deepEqual([O.gain.gain.value, O.pan.pan.value], o0, 'the other track\'s nodes untouched');
  t.mute = true; A.mixOne(ID.m);
  assert.equal(N.gain.gain.value, 0, 'mixOne honours mute (audible) as mix() does');
  t.mute = false; A.apply(ID.m, 'mix:vol', 0.8); A.apply(ID.m, 'mix:pan', 0);
});

test('renderTick (§4.1): stopped the position; playing AC.heardTick(currentTime × sr, T.as) — ahead of the heard tick by the output path —, read once a frame (the same value until the next frame)', async () => {
  const Tx = api.transport();
  Tx.pos = 480;
  assert.equal(A.renderTick(), 480, 'stopped: T.pos');
  sim.$('#tPlay').click(); await sim.settle(5);
  for (let i = 0; i < 60; i++) { sim.run(128); if (i % 6 === 5) sim.raf(); }
  sim.raf();
  const c = sim.ctx(), want = AC.heardTick(c.currentTime * c.sampleRate, Tx.as), got = A.renderTick();
  assert.equal(got, want, 'the render frame on the anchors');
  assert.ok(got > api.curTick(), 'ahead of the heard tick (' + got.toFixed(1) + ' > ' + api.curTick().toFixed(1) + ')');
  sim.run(128 * 6);
  assert.equal(A.renderTick(), got, 'memoised on the frame');
  sim.raf();
  assert.ok(A.renderTick() > got, 'the next frame reads afresh');
  sim.$('#tPlay').click(); await settle();
  assert.equal(A.renderTick(), Tx.pos, 'stopped again');
});

test('set (§10.0): track.auto[key] written (sorted; through song.js normAuto once it is in), removed with no points — the track without keys has no auto field; held() / override() empty until lane H1', () => {
  const t = byId(ID.m);
  assert.equal('auto' in t, false, 'a track without automation: no field');
  const pts = A.set(ID.m, 'i1:fc', [[960, 7], [0, 2]]);
  assert.deepEqual([pts, Object.keys(t.auto)], [[[0, 2], [960, 7]], ['i1:fc']]);
  A.set(ID.m, 'mix:vol', [[0, 1]]);
  assert.deepEqual(Object.keys(t.auto).sort(), ['i1:fc', 'mix:vol']);
  assert.deepEqual([A.set(ID.m, 'i1:fc', []), A.set(ID.m, 'mix:vol', null), 'auto' in t], [null, null, false], 'removed: no field left');
  assert.deepEqual([A.held(), A.override()], [[], []]);
  assert.deepEqual([A.set('nope', 'i1:fc', [[0, 1]]), A.set(ID.m, 7, [[0, 1]])], [null, null]);
});

/* ================================================================ lane H1: the host's session (§3.1, §4.3, §5.2, §6, §6.3) */
const Tx = () => api.transport();
// plain playback from 0 (240 BPM, the loop off), q quanta a frame (6: 16 ms, a 60 Hz display; 3: 8 ms, 120 Hz), n frames
async function playFor(n, q = 6) {
  const p = P(); p.bpm = 240; p.loop.on = false;
  if (!Tx().playing) { Tx().pos = 0; sim.$('#tPlay').click(); await sim.settle(5); }
  for (let f = 0; f < n; f++) { for (let i = 0; i < q; i++) sim.run(128); sim.raf(); }
}
async function stopPlay() { if (Tx().playing) sim.$('#tPlay').click(); await frames(2); }
// frames with time passing (the frame clock gates a rAF that comes too soon: settle()'s alone may paint nothing)
async function frames(n) { for (let f = 0; f < n; f++) { for (let i = 0; i < 6; i++) sim.run(128); sim.raf(); } await sim.settle(2); }
const panel = () => cv.classicPanels.get(ID.m + '/i1');
const dotOf = id => { const P0 = panel(), w = P0 && P0.wrapOf(id); return w ? w.getAttribute('data-auto') : 'no wrap'; };
const patches = id => posted(id).filter(m => m.t === 'patch').length;

test('H1 the transport (§6.3): AUTO lit by default (aria-pressed, settings.autoArm); ↺ disabled until a knob overrides its curve, then "Re-enable automation · 1 control", a tap clears it (the curve plays again)', async () => {
  const arm = sim.$('#tAuto'), re = sim.$('#tAutoRe');
  assert.deepEqual([arm.getAttribute('aria-pressed'), api.settings().autoArm, re.disabled], ['true', true, true]);
  A.set(ID.m, 'i1:fc', [[0, 1], [3840, 9]]);
  await playFor(10);
  dev(ID.m).vals.fc = 0.5; // (a wheel)
  await playFor(3);
  assert.deepEqual([A.override(), re.disabled, re.getAttribute('aria-label')], [[[ID.m, 'i1:fc']], false, 'Re-enable automation · 1 control']);
  assert.equal(dev(ID.m).vals.fc, 0.5, 'the user\'s value stays');
  re.click(); await playFor(3);
  assert.deepEqual([A.override(), re.disabled, dev(ID.m).vals.fc > 1], [[], true, true], 're-enabled: the curve again');
  await stopPlay();
  A.set(ID.m, 'i1:fc', null);
});

test('H1 the faces follow the heard value while playing (§6.1: the classic panel\'s P.follow — no write) and the dots (§6.2: data-auto on / off / none); stop: follow(null), the knob rests on the curve at the start', async () => {
  const ramp = [[0, 2], [3840, 8]];
  A.set(ID.m, 'i1:fc', ramp); await frames(2);
  assert.equal(dotOf('fc'), 'on', 'a curve: on');
  await playFor(20);
  const P0 = panel(), f = P0.fol.get('fc');
  assert.ok(typeof f === 'number' && f > 2 && f < 8, 'followed: ' + f);
  dev(ID.m).vals.fc = 9; await playFor(3);
  assert.deepEqual([dotOf('fc'), P0.fol.has('fc')], ['off', false], 'overridden: amber, the base shows');
  sim.$('#tAutoRe').click(); await playFor(3);
  assert.equal(dotOf('fc'), 'on');
  await stopPlay();
  assert.deepEqual([P0.fol.has('fc'), dev(ID.m).vals.fc], [false, 2], 'stopped: the base, on the curve at the start');
  A.set(ID.m, 'i1:fc', null); await frames(2);
  assert.equal(dotOf('fc'), null, 'no curve: no dot');
});

test('H1 the faders (§4.4): the head\'s volume input shows the heard value while playing, its base after stop; a two-finger drop with record off overrides nothing', async () => {
  A.set(ID.m, 'mix:vol', [[0, 0.2], [3840, 1.2]]);
  const vol = (sim.$('#heads').children || []).find(r => r.dataset && r.dataset.id === ID.m);
  const walk = n => (!n || typeof n !== 'object' ? null : n.className === 'hvol' ? n : (n.children || []).map(walk).find(Boolean) || null), el = walk(vol);
  assert.ok(el, 'the fader');
  await playFor(30);
  const shown = +el.value;
  assert.ok(shown > 0.2 && shown < 1.2 && Math.abs(shown - byId(ID.m).vol) < 0.2, 'heard ≈ base: ' + shown);
  A.grab(ID.m, 'mix:vol', 901); el.value = '0.3'; el.oninput(); await playFor(2);
  assert.deepEqual(A.override(), [[ID.m, 'mix:vol']], 'moved, record off: an override');
  A.release(901, true); await playFor(2);
  assert.deepEqual(A.override(), [], 'the drop: none');
  await stopPlay();
  assert.equal(el.value, String(byId(ID.m).vol), 'stopped: the base');
  A.set(ID.m, 'mix:vol', null); byId(ID.m).vol = 0.8;
});

test('H1 the automation tick is 60 Hz (§4.1): a 120 Hz display posts no more patches than a 60 Hz one over the same time', async () => {
  A.set(ID.m, 'i1:fc', [[0, 0], [7680, 10]]);
  const n0 = patches(ID.m); await playFor(30, 6); await stopPlay();
  const n60 = patches(ID.m) - n0;
  const n1 = patches(ID.m); await playFor(60, 3); await stopPlay();
  const n120 = patches(ID.m) - n1;
  A.set(ID.m, 'i1:fc', null);
  assert.ok(n60 >= 25 && n120 <= n60 + 2, '60 Hz ' + n60 + ', 120 Hz ' + n120);
});

test('H1 the roll host (§5.2): lanes with labels (an inert key greyed), autoEdit one History step named, the points rounded to 1e-4 of the range and normalised, [] removes the key; the lane per track; Add… lists every automatable control by module, the mixer last', async () => {
  A.set(ID.m, 'i1:fc', [[0, 1]]); A.set(ID.m, 'i7:fc', [[0, 1]]);
  assert.deepEqual(A.lanes(ID.m), [{ key: 'i1:fc', short: 'Cutoff', long: 'Minimoog · Cutoff', inert: false }, { key: 'i7:fc', short: 'fc', long: 'i7:fc', inert: true }]);
  const h0 = cv.hist.u.length;
  A.edit(ID.m, 'i1:fc', 'Automation: Cutoff', pts => pts.concat([[960, 5.123456], [480, 3]]));
  assert.deepEqual([cv.hist.u.length - h0, cv.hist.u[cv.hist.u.length - 1].label, byId(ID.m).auto['i1:fc'].pts], [1, 'Automation: Cutoff', [[0, 1], [480, 3], [960, 5.123]]]);
  A.edit(ID.m, 'i1:fc', 'Automation: Cutoff', () => []);
  A.edit(ID.m, 'i7:fc', 'x', () => []);
  assert.deepEqual(['auto' in byId(ID.m), A.lane(ID.m)], [false, 'vel']);
  const L = A.okList(ID.m), keys = L.map(x => x.key);
  assert.deepEqual([keys.includes('i1:fc'), keys.includes('i1:mm'), keys.slice(-2), L.find(x => x.key === 'i1:fc').group], [true, false, ['mix:vol', 'mix:pan'], 'Minimoog']);
  const R = A.okList(ID.r).map(x => x.key), K = A.okList(ID.k).map(x => x.key);
  assert.deepEqual([R.includes('i1:f.cutoff'), R.includes('i1:fx.' + REV + '.size'), R.includes('i1:f.type'), K.includes('i1:kad'), K.includes('i1:kat')], [true, true, false, true, false]);
});

test('H1 the faces resolved per family (§6.1): the Minimoog\'s panel, the kick\'s DECAY (kit-ui\'s face widgets, through the voice view\'s widgets) — the rig\'s (its SerumHost\'s bound widgets) and an effect\'s (fx-ui\'s knobs) are not mounted in the sim: none, no throw', async () => {
  const n = [A.faces(ID.m, 'i1:fc')];
  api.selectTrack(ID.r); await frames(3);
  n.push(A.faces(ID.r, 'i1:f.cutoff'), A.faces(ID.r, 'i1:fx.' + REV + '.size'));
  api.selectTrack(ID.k); await frames(3);
  n.push(A.faces(ID.k, 'i1:kad'), A.faces(ID.k, 'i1:kat'));
  api.selectTrack(ID.m); await frames(2);
  assert.deepEqual(n, [1, 0, 0, 1, 0], 'faces');
});

// fix 3 (R2 P1-1): the faces redrawn where a stopped write moved the base — the classic panel's knob (cv-panel's hardware face, through
// P.update) and a kit voice's wk knob (W.update): aria-valuenow is the base after ■, a stopped seek, a stopped lane edit, ↺ while stopped
test('fix 3: after ■ / a stopped seek / a stopped lane edit / ↺ stopped, every face draws the base the stopped write put on the curve', async () => {
  const ariaNow = el => (el ? +el.getAttribute('aria-valuenow') : NaN);
  const fcEl = () => { const P0 = panel(); return P0 ? P0.els.get('fc') : null; };
  const kadEl = () => { const F = cv.kit.faces().voices.get('i1/ka'), w = F && F.V && F.V.widgets ? F.V.widgets.find(x => x && x.el && x.el.getAttribute('data-dest') === 'kad') : null; return w ? w.el : null; };
  const res = [], rows = [[ID.m, 'i1:fc', [[0, 1], [3840, 9], [7680, 1]], () => ariaNow(fcEl()), () => dev(ID.m).vals.fc],
    [ID.k, 'i1:kad', [[0, 1], [3840, 9], [7680, 1]], () => ariaNow(kadEl()) / 10, () => dev(ID.k).vals.kad]];
  for (const [tid, key, pts, face, base] of rows) {
    api.selectTrack(tid); await frames(3);
    A.set(tid, key, pts); await frames(2);
    await playFor(40); await stopPlay();
    res.push([key, 'stop', Math.abs(face() - base()) < 0.02, base(), face()]);
    api.roll().host.setPlayhead(3840); await frames(2);
    res.push([key, 'seek', Math.abs(face() - base()) < 0.02, base(), face()]);
    A.edit(tid, key, 'Automation: x', () => [[0, 2], [7680, 6]]); await frames(2);
    res.push([key, 'edit', Math.abs(face() - base()) < 0.02, base(), face()]);
    await playFor(10); A.apply(tid, key, 0.5); dev(tid).vals[key.slice(3)] = 0.5; await playFor(4); await stopPlay();
    sim.$('#tAutoRe').click(); await frames(2);
    res.push([key, '↺', Math.abs(face() - base()) < 0.02, base(), face()]);
    A.set(tid, key, null); api.roll().host.setPlayhead(0); await frames(2);
  }
  api.selectTrack(ID.m); await frames(2);
  assert.deepEqual(res.map(r => r.slice(0, 3).join(' ')), ['i1:fc stop true', 'i1:fc seek true', 'i1:fc edit true', 'i1:fc ↺ true', 'i1:kad stop true', 'i1:kad seek true', 'i1:kad edit true', 'i1:kad ↺ true'], JSON.stringify(res));
});

// fix 9 (lane G 1 + 2, R1 P3): the tick posts its own patches (no queuePatch: no rAF armed for nothing); a 60 Hz deadline (a fast display
// ticks as a 60 Hz one); a deleted track's overrides and grabs go
test('fix 9: the automation tick arms no rAF (no request from inside autoTick); a fast display (gate off, a frame every 2 quanta) posts no more patches than 60 Hz frames over the same time', async () => {
  const reqs = async (n, q) => { for (let f = 0; f < n; f++) { for (let i = 0; i < q; i++) sim.run(128); sim.raf(); } };
  const raf0 = globalThis.requestAnimationFrame; let inTick = 0;
  globalThis.requestAnimationFrame = f => { if (/autoTick/.test(new Error().stack)) inTick++; return raf0(f); };
  A.set(ID.m, 'i1:fc', [[0, 0], [7680, 10]]);
  await playFor(5); const n0 = patches(ID.m); await reqs(30, 6); const n60 = patches(ID.m) - n0; await stopPlay();
  globalThis.requestAnimationFrame = raf0;
  WK.clock.config({ gate: false });
  try {
    await playFor(5); const n1 = patches(ID.m); await reqs(90, 2); const n180 = patches(ID.m) - n1; await stopPlay();
    await playFor(5); const n2 = patches(ID.m); await reqs(180, 1); const n360 = patches(ID.m) - n2; await stopPlay();
    assert.deepEqual([inTick, n60 >= 25, n180 <= n60 + 2, n360 <= n60 + 2], [0, true, true, true], 'rAF requests from the tick ' + inTick + '; patches 60 Hz ' + n60 + ', every 2 quanta ' + n180 + ', every quantum ' + n360);
  } finally { WK.clock.config({ gate: true }); A.set(ID.m, 'i1:fc', null); }
});

test('fix 9: a deleted track takes its overrides (↺\'s count) and its held keys with it', async () => {
  const t2 = api.addTrack('minimoog'); await settle();
  A.set(t2.id, 'i1:fc', [[0, 1], [3840, 9]]);
  await playFor(10); dev(t2.id).vals.fc = 0.5; await playFor(3); await stopPlay();
  A.grab(t2.id, 'i1:em', 977);
  const before = [A.override().length, A.held().length];
  api.deleteTrack(byId(t2.id)); await settle();
  assert.deepEqual([before, A.override(), A.held(), sim.$('#tAutoRe').disabled], [[1, 1], [], [], true]);
});

// fix 12 (R2 P2-2 + P3): the curve record carries its last-known label n and range r (written on an edit / a take); an inert key's
// lane names and maps itself by them
test('fix 12: an edit writes n / r on the curve; an inert key shows its last-known label and range, never a raw id', async () => {
  A.edit(ID.m, 'i1:fc', 'Automation: Cutoff', () => [[0, 3], [960, 5]]);
  const c = byId(ID.m).auto['i1:fc'];
  assert.deepEqual([c.n, c.r], ['Minimoog · Cutoff', [FC.min, FC.max]], 'written by the edit');
  const t = byId(ID.m); t.auto = Object.assign({}, t.auto, { 'i7:fc': { pts: [[0, 4]], n: 'Minimoog · Cutoff', r: [0, 10] } });
  const h = api.roll().host, L = A.lanes(ID.m).find(x => x.key === 'i7:fc');
  assert.deepEqual([L, h.autoLabel(t, 'i7:fc'), h.autoRange(t, 'i7:fc')], [{ key: 'i7:fc', short: 'Cutoff', long: 'Minimoog · Cutoff', inert: true }, { short: 'Cutoff', long: 'Minimoog · Cutoff' }, { lo: 0, hi: 10 }]);
  A.set(ID.m, 'i1:fc', null); A.set(ID.m, 'i7:fc', null);
});

// fix 14 (R2 P3): the rig's labels carry no stray ordinal ("Filter 1 · Level", never "Filter 1 · 1 Level")
test('fix 14: a rig control\'s label is the module\'s name · the control (no leading ordinal in the short label)', () => {
  const L = A.okList(ID.r), bad = L.filter(x => /^\d/.test(x.short)).map(x => x.key + ' ' + x.long);
  assert.deepEqual([bad, A.label(ID.r, 'i1:f.cutoff').long], [[], 'Filter 1 · Cutoff']);
});
