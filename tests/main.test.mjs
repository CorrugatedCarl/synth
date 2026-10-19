// main.js in the page simulation (owner I; SPEC-serum2 §12.6, §11.15, §13.2.5, §14.3, §15.13): the real main.js booted
// by tests/main-sim.mjs against a DOM stub and Web Audio fakes whose worklet nodes run the real engine. Covers the host
// contract additions, CT / seqT part delivery, preference recompiles, the preset preview node, render-last ≡ bounce,
// the CPU safeguard's quality steps, MIDI / MPE routing through midi.js and the IndexedDB app store.
// Run: node --test tests/main.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TB_FX, DX_FX } from './fixtures/panels.mjs';
import { bootMain } from './main-sim.mjs';
import { fakeStorage, fakeIDB } from './fakes.mjs';
import { MODELS } from '../models.js?v=9';
import * as core from '../serum-core.js?v=9';
import * as S from '../song.js?v=9';
import * as CMOD from '../cv-model.js?v=9';

const peak = x => { let m = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; } return m; };
const maxDiff = (x, y, n = Math.min(x.length, y.length)) => { let m = 0; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(x[i] - y[i])); return m; };
const KB = 1024;

let sim = null;
async function page() {
  if (!sim) { sim = await bootMain({ hash: '#serum' }); await sim.power(); await sim.settle(30); sim.raf(); }
  return sim;
}
const sxTrack = s => s.api.project().tracks.find(t => t.model === 'serum');
// one edit of the panel (host.edit), the animation frame that posts it, and the messages it posted to the track's node
async function editFrame(s, t, fn, label = 'Edit') {
  const node = s.nodeOf(t.id);
  node.posted.length = 0;
  s.api.sxHost(t).edit(fn, { label, phase: 'move' });
  s.raf(); await s.settle(2);
  return node.posted.slice();
}

test('§12.6: the page boots on the IndexedDB-less fallback, a Serum track plays from the keyboard, new racks are v2', async () => {
  const s = await page(), t = sxTrack(s);
  assert.ok(t, 'a Serum track (#serum)');
  assert.equal(t.fx.v, 2, 'v2 FX state for a new track (§2.5)');
  assert.equal(s.api.store.mode, 'ls', 'no IndexedDB here: the Phase-1 localStorage store');
  const c = s.ctx();
  assert.equal(c.modules.length, 13, '§0.3: 12 DSP scripts (mod-core.js last) + engine.js');
  assert.ok(c.modules[12].startsWith('engine.js'));
  const node = s.nodeOf(t.id);
  assert.equal(node.po.trackId, t.id, 'processorOptions.trackId (§7.9)');
  s.key('KeyA', true); await s.settle(2);
  const out = s.run(24000);
  s.key('KeyA', false);
  assert.ok(peak(out.get(node).L) > 0.02, 'sound');
  const H = s.api.sxHost(t);
  for (const k of ['smp', 'tracks', 'seqCmd', 'onInput', 'preview', 'renderLast', 'clipToTrack', 'download', 'tuningFile', 'resample', 'prefsChanged', 'wt'])
    assert.ok(H[k], '§11.15 host.' + k);
  assert.equal(H.v2Fx, true);
  const F = s.api.fxHost(t);
  assert.equal(F.racks(), 3, 'FXRackUI host: three racks on a Serum track');
  assert.equal(F.irs, H.smp, 'Convolve IRs through host.smp');
});

test('§4.1/§4.4/§12.6: CT and seqT travel by part — one drag frame of an LFO (64 points), a path, a matrix curve and a clip note each posts ≤ 12 KB', async () => {
  const s = await page(), t = sxTrack(s);
  await editFrame(s, t, st => { st.p['clip.on'] = 1; st.lfo[1].type = 'path'; st.matrix[0] = Object.assign({}, st.matrix[0], { src: 'lfo1', dst: 'a.wt', amt: 0.5, crv: [[0, 0, 0], [0.5, 0.8, 0], [1, 1, 0]] }); st.clip.clips[0].notes = [[0, 1, 60, 100, 0, 0.5, 0.5, 0]]; });
  const P = []; for (let i = 0; i < 64; i++) P.push([i / 63, 0.5 + 0.5 * Math.sin(i), 0]);
  await editFrame(s, t, st => { st.lfo[0].pts = P; });
  const frames = {
    lfo: await editFrame(s, t, st => { st.lfo[0].pts[10][1] = 0.123; }),
    path: await editFrame(s, t, st => { st.lfo[1].path[1][1] = 0.4; }),
    curve: await editFrame(s, t, st => { st.matrix[0].crv[1][1] = 0.61; }),
    clip: await editFrame(s, t, st => { st.clip.clips[0].notes[0][2] = 62; }),
  };
  for (const [k, msgs] of Object.entries(frames)) {
    assert.ok(msgs.length >= 1, k + ': posted');
    const bytes = msgs.reduce((a, m) => a + m.bytes, 0);
    assert.ok(bytes <= 12 * KB, `${k}: ${bytes} bytes`);
    assert.ok(msgs.every(m => m.m.t === 'ct' || m.m.t === 'sqt'), k + ': tables only (' + msgs.map(m => m.m.t) + ')');
  }
  assert.deepEqual(Object.keys(frames.lfo[0].m.parts), ['lfo0']);
  assert.deepEqual(Object.keys(frames.path[0].m.parts), ['path1']);
  assert.deepEqual(Object.keys(frames.curve[0].m.parts), ['crv0']);
  assert.deepEqual(Object.keys(frames.clip[0].m.parts), ['clip0']);
  // the worklet's tables equal a node built from scratch with the same state (CT parts merge at the next render)
  s.run(128);
  const node = s.nodeOf(t.id), ref = s.api.buildPatch(t);
  assert.equal(node.proc.sx.CT.key, ref.serumT.key, 'the merged CT is the compiled one');
  const S = s.ctx().scope(), fresh = S.make({ os: 2, patch: ref }, null);
  assert.deepEqual([...node.proc.sxSeq.clipNotes.subarray(0, 8)], [...fresh.sxSeq.clipNotes.subarray(0, 8)]);
});

test('§12.6/§13.10: prefsChanged recompiles every Serum track (MPE preferences reach CP); other tracks only for rack preferences', async () => {
  const s = await page(), api = s.api;
  if (!api.project().tracks.some(t => t.model !== 'serum')) api.addTrack(MODELS.find(m => m.id === 'minimoog'));
  const tracks = api.project().tracks, sx = tracks.filter(t => t.model === 'serum'), other = tracks.filter(t => t.model !== 'serum');
  s.raf(); await s.settle(5);
  for (const t of tracks) s.nodeOf(t.id).posted.length = 0;
  api.store.set('synth.sx.prefs', Object.assign({}, api.store.get('synth.sx.prefs', {}), { mpeBendX: 1, mpeYBi: 1 }));
  api.prefsChanged();
  s.raf(); await s.settle(5);
  for (const t of sx) {
    const m = s.nodeOf(t.id).posted.find(x => x.m.t === 'patch');
    assert.ok(m, 'a patch for every Serum track');
    assert.equal(m.m.p.serum.mpeBendX, 1);
  }
  for (const t of other) assert.equal(s.nodeOf(t.id).posted.length, 0, 'classic tracks unchanged');
  api.store.set('synth.sx.prefs', Object.assign({}, api.store.get('synth.sx.prefs', {}), { mpeBendX: 0, mpeYBi: 0, smooth: 2 }));
  api.prefsChanged();
  s.raf(); await s.settle(5);
  for (const t of tracks) {
    const m = s.nodeOf(t.id).posted.filter(x => x.m.t === 'patch').pop();
    assert.ok(m && m.m.p.fxr.smooth === 2, 'rack smoothing reaches every track');
  }
});

test('§12.6/§9.6/§7.9: the preset preview node — no assets in processorOptions, needs through the asset manager, ≤ 4 s, one at a time; kept for the next preview, then ended (bye: process() returns false)', async () => {
  const s = await page(), t = sxTrack(s), H = s.api.sxHost(t), c = s.ctx();
  // factory presets that play at once in the page simulation: no sample-like assets (it has no Workers, so render-farm
  // multisamples / samples cannot be generated) and no Convolve IR — Serum 2 presets (listed first) and Phase-1 ones alike
  const plain = k => { const p = core.FACTORY_PRESETS.find(x => 'f:' + x.name === k); return !!p && !core.assetNeeds(p.v.s).length && !p.fx.racks.some(R => R.mods.some(I => I.type === 'conv')); };
  const keys = H.presets.list().map(r => r.key).filter(plain);
  assert.ok(keys.length >= 2);
  const before = c.nodes.filter(n => n.kind === 'worklet').length;
  H.preview(keys[0]);
  await s.settle(5);
  const nodes = () => c.nodes.filter(n => n.kind === 'worklet');
  assert.equal(nodes().length, before + 1);
  const pv = nodes().pop();
  assert.equal(pv.po.trackId, undefined, 'not in the MIDI OUT registry');
  assert.equal(pv.proc.procs, null, 'and no registry of its own: its MIDI OUT events go nowhere');
  assert.ok(!pv.po.wts && !pv.po.smps, 'no assets in processorOptions');
  assert.ok(Array.isArray(s.api.tables.needs.get('preview')), "its needs are the asset manager's track 'preview'");
  assert.ok(pv.po.song.notes.length >= 4 && pv.po.transport.play, 'a preview clip on the song clock');
  const out = s.run(48000);
  assert.ok(peak(out.get(pv).L) > 0.01, 'it plays');
  // a second preview replaces the first on the same node: the changed parts, its clip, its transport
  pv.posted.length = 0;
  H.preview(keys[1]);
  await s.settle(5);
  assert.equal(nodes().length, before + 1, 'no new processor');
  assert.equal(s.api.pv.node, pv);
  assert.deepEqual(pv.posted.map(m => m.m.t).filter(x => x !== 'wt' && x !== 'smp'), ['panic', 'transport', 'patch', 'song', 'transport'], '(+ the assets it needs)');
  const o2 = s.run(48000);
  assert.ok(peak(o2.get(pv).L) > 0.01, 'the second preset plays');
  // macro strip: once per animation frame, through the part-keyed delta (no tables)
  pv.posted.length = 0;
  H.previewMacros([1, 0, 0, 0, 0, 0, 0, 0]); H.previewMacros([0.9, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(pv.posted.length, 0, 'nothing before the frame');
  s.raf();
  const pm = pv.posted.filter(m => m.m.t === 'patch');
  assert.equal(pm.length, 1, 'one patch per frame');
  assert.ok(!pm[0].m.p.serumT && !pm[0].m.p.seqT && !pm[0].m.p.fxrT, 'no tables re-sent');
  assert.equal(s.api.pv.s.macros[0].v, 0.9);
  // stop: silent at once, the node is kept, the needs are released
  H.preview(null);
  await s.settle(5);
  assert.equal(s.api.pv.node, pv, 'kept for the next preview');
  assert.equal(s.api.tables.needs.has('preview'), false, 'needs released');
  const o3 = s.run(4800);
  assert.equal(s.api.pv.gain.gain.value, 0, 'its gain closes');
  assert.ok(pv.proc.voices.every(v => !v.active) && peak(o3.get(pv).L.subarray(4320)) < 0.05, 'nothing sounds (the DC blocker decays)');
  // after PV_KEEP: bye — the processor fades out and stops processing; the node is disconnected
  s.api.previewEnd();
  assert.equal(s.api.pv.node, null);
  assert.equal(pv.posted.pop().m.t, 'bye');
  s.run(128 * 4);
  assert.equal(pv.ended, true, 'process() returned false');
  await s.settle(100);
  assert.equal(pv.outs.size, 0, 'disconnected');
  // the next preview builds a new node
  H.preview(keys[0]);
  await s.settle(5);
  assert.notEqual(s.api.pv.node, pv);
  assert.equal(s.api.pv.gain.gain.value, 1);
  H.preview(null); s.api.previewEnd();
});

test('§13.2.5: render-last — the recorded input group renders exactly as a bounce of the same notes (≤ 1e-6)', async () => {
  const s = await page(), api = s.api, t = sxTrack(s);
  api.selectTrack(t.id);
  // a group: 60 at 0 s, 64 at 0.25 s, both released (0.5 s, 0.75 s) — at 120 BPM exact ticks
  const T0 = 1e6;
  api.noteOn(60, 100 / 127, 0, T0); api.noteOn(64, 90 / 127, 0, T0 + 250);
  api.noteOff(60, 0, T0 + 500); api.noteOff(64, 0, T0 + 750);
  const g = api.lastIn.get(t.id);
  assert.deepEqual(g.notes.map(x => [x.n, x.on, x.off]), [[60, 0, 0.5], [64, 0.25, 0.75]]);
  await assert.rejects(api.renderLast(api.project().tracks.find(x => x.model !== 'serum') || { model: 'minimoog' }, {}));
  const r = await api.renderLast(t, {});
  assert.match(r.name, /^.+ C4\.wav$/, 'named after the preset and the lowest note (C4 = 60)');
  const RL = { L: s.lastOffline.L, R: s.lastOffline.R, sr: s.lastOffline.ctx.sampleRate };
  assert.ok(peak(RL.L) > 0.02);
  // the bounce of the same notes: the track's song, rendered by the Bounce dialog (song range, live rate, 32-bit)
  const tr = t;
  tr.notes = [{ id: 'n1', t: 0, d: 960, n: 60, v: 100 }, { id: 'n2', t: 480, d: 960, n: 64, v: 90 }];
  for (const x of api.project().tracks) if (x !== tr) x.mute = true;
  api.project().bars = 1; // the song: 1 bar (2 s)
  Object.assign(s.$('#bRange'), { value: 'song' }); Object.assign(s.$('#bSr'), { value: String(RL.sr) }); Object.assign(s.$('#bBits'), { value: '32' });
  Object.assign(s.$('#bTail'), { value: '0' }); Object.assign(s.$('#bNorm'), { checked: false }); Object.assign(s.$('#bOs'), { value: '2' });
  await s.$('#bGo').onclick();
  for (let k = 0; k < 400 && s.lastOffline.L === RL.L; k++) await s.settle(10);
  const B = s.lastOffline, vol = tr.vol;
  assert.notEqual(B.L, RL.L, 'the bounce rendered');
  const n = Math.round(1.5 * RL.sr); // the notes and their release, well before the song end
  const bL = B.L.subarray(0, n).map(x => x / vol), bR = B.R.subarray(0, n).map(x => x / vol);
  if (process.env.SIM_DEBUG) console.log('render-last', RL.L.length, B.L.length, peak(RL.L), peak(bL), maxDiff(RL.L, bL, n));
  assert.ok(maxDiff(RL.L, bL, n) <= 1e-6 && maxDiff(RL.R, bR, n) <= 1e-6, 'diff ' + maxDiff(RL.L, bL, n));
  for (const x of api.project().tracks) x.mute = false;
  // Shift: the preset as JSON instead of a render
  assert.equal(await api.renderLast(t, { shift: true }), null);
});

test('§14.3: the CPU safeguard — Serum oversampling cap, then quality steps Q1–Q4 in the patches; a Quality choice lifts them', async () => {
  const s = await page(), api = s.api, t = sxTrack(s), N = api.nodes.get(t.id);
  api.liftCaps();
  const seen = [];
  for (let k = 0; k < 8; k++) {
    for (const x of api.nodes.values()) x.load = 0;
    N.load = 1.2;
    api.lowerOS();
    seen.push(Object.assign({}, api.caps()));
  }
  assert.deepEqual(seen.slice(0, 7).map(c => [c.sxCap, c.qrStep]), [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6]],
    'oversampling capped first, then Q1 … Q4 and the IMPL steps Q5, Q6');
  assert.deepEqual(api.caps(), { sxCap: 1, qrStep: 6 });
  const p = api.buildPatch(t);
  assert.deepEqual([...p.serum.qr], [2, 32, 2, 2, 64], 'Q1–Q3 and Q5 caps in CP.qr');
  assert.equal(p.fxr.convMax, 2, 'Q3: Convolve tails ≤ 2 s');
  assert.ok(p.poly <= 4, 'Q6: POLY ≤ 4');
  const off = api.buildPatch(t, 48000, true);
  assert.deepEqual([...off.serum.qr], [16, 256, 1, 32, 512], 'offline renders take no step'); assert.equal(off.fxr.convMax, 10);
  api.sxHost(t).qualityChosen(2);
  assert.deepEqual(api.caps(), { sxCap: 8, qrStep: 0 });
});

test('§12.6: MIDI through midi.js — an MPE track gets channelled notes and CC10 as Expression X; others the Phase-1 messages', async () => {
  const s = await page(), api = s.api, t = sxTrack(s), node = s.nodeOf(t.id);
  api.selectTrack(t.id);
  t.vals.s.global.mpe.on = 1;
  node.posted.length = 0;
  api.midi.message([0x91, 62, 100], 1);          // note-on, channel 2
  api.midi.message([0xb1, 10, 127], 2);           // CC10 on member channel 2
  api.midi.message([0xe1, 0, 96], 3);             // pitch bend on channel 2
  api.midi.message([0x81, 62, 64], 4);            // note-off with release velocity
  const m = node.posted.map(x => x.m);
  assert.deepEqual(m.find(x => x.t === 'on'), { t: 'on', n: 62, v: 100 / 127, ch: 2 });
  assert.deepEqual(m.find(x => x.t === 'mpe' && x.k === 'x'), { t: 'mpe', ch: 2, k: 'x', v: 1 });
  assert.ok(m.some(x => x.t === 'mpe' && x.k === 'b'));
  assert.deepEqual(m.find(x => x.t === 'off'), { t: 'off', n: 62, rv: 64 / 127, ch: 2 });
  t.vals.s.global.mpe.on = 0;
  node.posted.length = 0;
  api.midi.message([0x91, 62, 100], 5);
  assert.deepEqual(node.posted.map(x => x.m).find(x => x.t === 'on'), { t: 'on', n: 62, v: 100 / 127 }, 'MPE off: Phase-1 message');
  api.midi.message([0x81, 62, 0], 6);
});

test('RULINGS2 fix 2: a held MIDI key keeps the channel of its note-on — switching MPE (or a preset with another MPE setting) while it is down still releases its voice', async () => {
  // a fresh Serum track (the shared one carries earlier tests' edits)
  const s = await page(), api = s.api, t = api.addTrack(MODELS.find(m => m.id === 'serum'));
  s.raf(); await s.settle(10); s.raf();
  const node = s.nodeOf(t.id);
  api.selectTrack(t.id); s.raf(); await s.settle(5);
  const gated = () => JSON.stringify(Array.from(node.proc.voices).filter(v => v.gate).map(v => [v.note, v.ch | 0]));
  for (const [mpe0, mpe1] of [[1, 0], [0, 1]]) {
    api.sxHost(t).edit(st => { st.global.mpe.on = mpe0; }, { label: 'mpe' }); s.raf(); await s.settle(5); s.run(4096);
    node.posted.length = 0;
    api.midi.message([0x92, 62, 100], 1);                        // note-on on channel 3
    s.run(4096);
    const on = node.posted.map(x => x.m).find(x => x.t === 'on');
    assert.equal(on.ch, mpe0 ? 3 : undefined, 'the note-on carries the channel only on an MPE track');
    assert.equal(gated(), JSON.stringify([[62, mpe0 ? 3 : 0]]));
    api.sxHost(t).edit(st => { st.global.mpe.on = mpe1; }, { label: 'mpe' }); s.raf(); await s.settle(5); s.run(4096);
    node.posted.length = 0;
    api.midi.message([0x82, 62, 64], 2);                         // its note-off, after the switch
    const off = node.posted.map(x => x.m).find(x => x.t === 'off');
    assert.equal(off.ch, on.ch, `MPE ${mpe0} → ${mpe1}: the note-off carries the note-on's channel`);
    s.run(4096);
    assert.equal(gated(), '[]', `MPE ${mpe0} → ${mpe1}: the voice is released`);
    node.proc.msg({ t: 'panic' }); s.run(48000);
  }
  api.deleteTrack(t); s.raf(); await s.settle(5);
});

// the Bounce dialog over the song range at rate sr (32-bit, no tail, no normalisation); resolves with the offline render
async function bounceSong(s, sr = 48000) {
  const before = s.lastOffline;
  Object.assign(s.$('#bRange'), { value: 'song' }); Object.assign(s.$('#bSr'), { value: String(sr) }); Object.assign(s.$('#bBits'), { value: '32' });
  Object.assign(s.$('#bTail'), { value: '0' }); Object.assign(s.$('#bNorm'), { checked: false }); Object.assign(s.$('#bOs'), { value: '2' });
  await s.$('#bGo').onclick();
  for (let k = 0; k < 400 && s.lastOffline === before; k++) await s.settle(10);
  return s.lastOffline === before ? null : s.lastOffline;
}

test('§7.9/§12.6: a bounce renders the MIDI OUT graph as it plays live — a target without notes plays the source\'s arp; a muted source still drives it (gain 0)', async () => {
  const s = await page(), api = s.api, src = sxTrack(s);
  const tg = api.addTrack(MODELS.find(m => m.id === 'minimoog'));
  s.raf(); await s.settle(5);
  const keep = api.project().tracks.map(x => [x, x.mute, x.notes]);
  for (const x of api.project().tracks) if (x !== src && x !== tg) x.mute = true;
  src.notes = [{ id: 'mo1', t: 0, d: 1800, n: 60, v: 100 }, { id: 'mo2', t: 0, d: 1800, n: 67, v: 100 }];
  tg.notes = [];
  api.project().bars = 1;
  api.sxHost(src).edit(st => { st.p['arp.on'] = 1; st.arp.midiOut = 2; st.arp.outTrack = tg.id; }, { label: 'arp out' });
  s.raf(); await s.settle(5);
  const set = () => api.bounceSet(48000).map(x => [x.tr.id, x.gain]);
  assert.deepEqual(set(), [[src.id, src.vol], [tg.id, tg.vol]], 'the target is rendered although it has no notes');
  const B = await bounceSong(s);
  assert.ok(B, 'rendered');
  assert.deepEqual(B.nodes.map(n => n.po.trackId), [src.id, tg.id]);
  // the source muted: live its node keeps running at gain 0 and drives the target — so in the bounce
  src.mute = true;
  assert.deepEqual(set(), [[src.id, 0], [tg.id, tg.vol]]);
  const M = await bounceSong(s);
  assert.ok(M && peak(M.L) > 0.01, 'the target plays the muted source\'s arpeggio: ' + (M && peak(M.L)));
  // MIDI OUT off: neither is rendered (the source is muted, the target has no notes)
  api.sxHost(src).edit(st => { st.arp.midiOut = 0; }, { label: 'arp out off' });
  assert.deepEqual(set(), []);
  // a muted target is not rendered (it is not heard), nor is a source only it would need
  api.sxHost(src).edit(st => { st.arp.midiOut = 2; }, { label: 'arp out' });
  tg.mute = true;
  assert.deepEqual(set(), []);
  for (const [x, m, n] of keep) { x.mute = m; x.notes = n; }
  api.sxHost(src).edit(st => { st.p['arp.on'] = 0; st.arp.midiOut = 0; st.arp.outTrack = ''; }, { label: 'reset' });
  api.deleteTrack(tg);
  s.raf(); await s.settle(5);
});

test('§13.2.5: the render-last group follows the physical keys — beyond 16 notes, later keys still hold the group open', async () => {
  const s = await page(), api = s.api, t = sxTrack(s);
  api.selectTrack(t.id);
  const T0 = 2e6;
  for (let i = 0; i < 20; i++) api.noteOn(48 + i, 0.8, 0, T0 + i * 10);  // 20 overlapping keys
  for (let i = 0; i < 16; i++) api.noteOff(48 + i, 0, T0 + 300 + i);     // the 16 stored ones released, 4 still down
  const g = api.lastIn.get(t.id);
  assert.equal(g.notes.length, 16, 'at most 16 notes stored');
  assert.equal(g.held.size, 4, 'the later keys are still held');
  api.noteOn(80, 0.8, 0, T0 + 400);
  assert.equal(api.lastIn.get(t.id), g, 'no new group while keys are down');
  for (let i = 16; i < 20; i++) api.noteOff(48 + i, 0, T0 + 500);
  api.noteOff(80, 0, T0 + 500);
  assert.equal(g.held.size, 0);
  api.noteOn(60, 0.8, 0, T0 + 600);
  assert.notEqual(api.lastIn.get(t.id), g, 'a new group after the last note-off');
  api.noteOff(60, 0, T0 + 700);
});

test('§9.1/§12.6: Resample to a Sample / Granular / Spectral / Multisample oscillator imports a user sample (type kept, multi → Sample); a Wavetable oscillator gets a wavetable', async () => {
  const s = await page(), api = s.api, t = sxTrack(s), H = api.sxHost(t);
  H.edit(st => { st.osc[0].type = 'gran'; st.osc[0].smpo.ops.trim = [0.1, 0.9]; st.osc[1].type = 'wt'; }, { label: 'types' });
  s.raf(); await s.settle(5);
  const keepS = JSON.stringify(t.vals.s.osc[0].smpo);
  await api.resampleTo(t, 'AB');
  const [A, B] = t.vals.s.osc;
  assert.equal(A.type, 'gran', 'Granular kept');
  assert.match(A.smp, /^smp:/, 'a user sample');
  assert.equal(A.smpo.ops.trim, null, 'the previous sample\'s trim dropped');
  const o0 = JSON.parse(keepS); o0.ops.trim = null;
  assert.deepEqual(A.smpo, o0, 'other sample options kept');
  assert.equal(B.type, 'wt'); assert.match(B.wt, /^user:/, 'a wavetable for the WT oscillator');
  const row = api.tables.smpRows.find(r => r.id === A.smp);
  assert.ok(row && /^Resample \d+ L$/.test(row.name) && row.folder === 'Renders', 'stored in Renders: ' + JSON.stringify(row && { name: row.name, folder: row.folder }));
  H.edit(st => { st.osc[0].type = 'multi'; }, { label: 'multi' });
  await api.resampleTo(t, 'A');
  assert.equal(t.vals.s.osc[0].type, 'sample', 'Multisample → Sample');
  assert.match(t.vals.s.osc[0].smp, /^smp:/);
  H.edit(st => { st.osc[0].type = 'wt'; st.osc[0].smp = ''; }, { label: 'back' });
  s.raf(); await s.settle(5);
});

test('§9.7: factory-generation progress sits in the notice line\'s idle slot — it keeps the sticky message, and its cancel action stays with its own text', async () => {
  const s = await page(), api = s.api, el = s.$('#notice');
  api.notice('', 0); // (no timed notice of an earlier test)
  api.stickyNotice('Audio is paused — tap a key or Power to start it');
  api.genProgress({ done: 1, total: 4, name: 'Tine' });
  assert.equal(el.textContent, 'Audio is paused — tap a key or Power to start it', 'the sticky message is not erased');
  api.stickyNotice('');
  assert.match(el.textContent, /25 %/); assert.equal(typeof el.onclick, 'function'); assert.equal(el.dataset.gen, '1');
  api.notice('Storage full — the project was not saved', 50);
  assert.equal(el.onclick, null, 'another notice does not carry the cancel action'); assert.equal(el.dataset.gen, undefined);
  api.genProgress({ done: 2, total: 4 });
  assert.match(el.textContent, /^Storage full/, 'progress waits for the timed notice');
  await s.settle(80);
  assert.match(el.textContent, /50 %/, 'then shows again'); assert.equal(typeof el.onclick, 'function');
  api.genProgress(null);
  assert.equal(el.hidden, true); assert.equal(el.onclick, null);
});

test('§14.3 Q4: POLY ≤ 8 reaches CP.poly too (Active Voices scale, snapshot) and the preview patch', async () => {
  const s = await page(), api = s.api, t = sxTrack(s);
  const P = () => ({ mode: 'poly', poly: 16, serum: { poly: 16, x: 1 } });
  const p0 = api.capQ4(P());
  assert.deepEqual([p0.poly, p0.serum.poly], [16, 16], 'below Q4: unchanged');
  const lower = () => { for (const x of api.nodes.values()) x.load = 0; api.nodes.get(t.id).load = 1.2; api.lowerOS(); };
  for (let k = 0; k < 8 && api.caps().qrStep < 4; k++) lower();
  assert.equal(api.caps().qrStep, 4);
  const src = P(), p1 = api.capQ4(src);
  assert.deepEqual([p1.poly, p1.serum.poly, p1.serum.x], [8, 8, 1]);
  const b = api.buildPatch(t);
  assert.ok(b.poly <= 8 && b.serum.poly <= 8);
  // Q6 (IMPL, after Q5): POLY ≤ 4 the same way
  lower(); lower();
  assert.equal(api.caps().qrStep, 6);
  const p6 = api.capQ4(P());
  assert.deepEqual([p6.poly, p6.serum.poly], [4, 4]);
  lower();
  assert.equal(api.caps().qrStep, 6, 'no step after Q6');
  api.sxHost(t).qualityChosen(2);
  assert.equal(api.caps().qrStep, 0);
});

test('§12.6 storage: pagehide / beforeunload / hidden start the IndexedDB write in the handler\'s own task', async () => {
  const idb = fakeIDB(), ls = fakeStorage({});
  const s2 = await bootMain({ ls, idb, hash: '#serum' });
  const api = s2.api;
  assert.equal(api.store.mode, 'idb');
  api.save(); await api.store.flush();
  const tr = api.project().tracks[0];
  tr.notes.push({ id: 'u1', t: 0, d: 240, n: 61, v: 100 });
  idb.resetStats();
  for (const f of s2.dom.winL.pagehide || []) f({ type: 'pagehide' });
  assert.ok(idb.stats.tx >= 1 && idb.stats.put.tracks >= 2, 'the tracks transaction exists before the handler returns: ' + JSON.stringify(idb.stats));
  await api.store.flush(); await s2.settle(20);
  assert.equal(JSON.parse(idb.data('synth-canvas', 'tracks').get('t:' + tr.id).j).notes.length, tr.notes.length);
});

test('§12.6 storage (sign-off item 7): first run migrates a Phase-1 localStorage into IndexedDB and loads its project; autosave rewrites only changed tracks; quota errors show the notice', async () => {
  const proj = JSON.parse(readFileSync(new URL('./ref-p1/project-p1.json', import.meta.url), 'utf8'));
  delete proj.wts;
  const snap = { 'synthc.project': JSON.stringify(proj), 'synthc.settings': JSON.stringify({ sr: 0, os: 4, drift: 5, master: 0.8, model: 'serum', vel: 100 }), 'synthc.tab': '"inst"' };
  const ls = fakeStorage(snap), idb = fakeIDB();
  const s2 = await bootMain({ ls, idb });
  const api = s2.api;
  assert.equal(api.store.mode, 'idb', 'IndexedDB store');
  assert.equal(api.store.info().migrated, true, 'first run: migrated');
  assert.deepEqual(api.project().tracks.map(t => t.id), proj.tracks.map(t => t.id), 'the Phase-1 project loaded from the database');
  const lsApp = () => { const o = Object.fromEntries(ls.m); delete o['synth-canvas.idb']; return o; }; // (without the verified-database marker)
  assert.deepEqual(lsApp(), snap, 'localStorage untouched (read-only fallback)');
  api.save(); await api.store.flush(); // the first autosave stores the loaded project in its v2 form (states migrated)
  idb.resetStats();
  const tr = api.project().tracks[1];
  tr.notes.push({ id: 'zz', t: 0, d: 240, n: 70, v: 100 });
  api.save();
  await api.store.flush();
  assert.equal(idb.stats.put.tracks, 2, 'only the changed track record + the header');
  assert.deepEqual(lsApp(), snap, 'still untouched');
  // quota: the next autosave fails → the notice
  idb.budget = 10;
  tr.notes.push({ id: 'zy', t: 240, d: 240, n: 72, v: 100 });
  api.save();
  await api.store.flush(); await s2.settle(20);
  assert.match(s2.$('#notice').textContent, /Storage full — the project was not saved/);
});

test('§13.5 Delay spectrum overlay: the FX hosts post {t: "fxtap", id} to the track\'s node', async () => {
  const s = await page(), t = sxTrack(s), node = s.nodeOf(t.id);
  node.posted.length = 0;
  s.api.fxHost(t).setTap('dly');
  s.api.sxHost(t).fxTap('');
  assert.deepEqual(node.posted.filter(x => x.m.t === 'fxtap').map(x => x.m.id), ['dly', '']);
  assert.equal(s.api.fxHost(t).tap(), null, 'nothing tapped while the FX tab shows another track');
});

// (boots its own page: after the tests that share page(), as the storage tests do)
test('page simulation: with a fixed sample rate (synth.settings.sr) sim.ctx() is the context main.js plays through, not the closed device-rate probe', async () => {
  const s2 = await bootMain({ hash: '#serum', ls: fakeStorage({ 'synthc.settings': JSON.stringify({ sr: 48000 }) }) });
  await s2.power(); await s2.settle(30); s2.raf();
  assert.equal(s2.live.length, 2, 'the page context and the probe that learns the device rate');
  assert.equal(s2.live[1].state, 'closed');
  const c = s2.ctx(), t = sxTrack(s2), node = s2.nodeOf(t.id);
  assert.equal(c, s2.live[0]);
  assert.equal(c, s2.api.ctx());
  assert.ok(c.nodes.includes(node) && node.proc, 'the track node lives in that context');
  s2.key('KeyA', true); await s2.settle(2);
  const out = s2.run(12000);
  s2.key('KeyA', false);
  assert.ok(peak(out.get(node).L) > 0.02, 'sim.run renders the page context');
});

/* ---------------------------------------------------------- the audible clock (R5) */
// (each boots its own page with a clock personality: a fake performance.now() driven by sim.run / sim.advance)
const IPAD = { ua: 'Mozilla/5.0 (iPad; CPU OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1',
  platform: 'MacIntel', touch: true, vendor: 'Apple Computer, Inc.', clock: 'webkit', baseLat: 128 / 48000 };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
// the tick heard at sim.ms + dms: the stamp less the output path d (s), on the anchor (after its frame)
function heardAt(s, d, dms = 0) {
  const c = s.ctx(), a = s.api.transport().a, o = c.getOutputTimestamp();
  const F = (o.contextTime + (s.ms + dms - o.performanceTime) / 1000 - d) * c.sampleRate;
  assert.ok(F >= a.frame, 'heard after the anchor');
  return a.tick + (F - a.frame) / a.fpt;
}

test('R5 WebKit power-on: the nodes are built with the context suspended (no paused nag, a tap does not resume it), resumed at the engine\'s ready', async () => {
  const s = await bootMain(Object.assign({ readyMs: 600, outLat: 0.18 }, IPAD));
  const p = s.api.powerOn();
  await s.settle(450);
  const c = s.ctx();
  assert.equal(c.state, 'suspended', 'held while the processors are built');
  assert.deepEqual(c.calls, ['resume', 'suspend'], 'resumed in the gesture (unlock), suspended before the nodes');
  const ns = c.nodes.filter(n => n.kind === 'worklet');
  assert.ok(ns.length >= 1);
  assert.deepEqual(ns.map(n => n.state0), ns.map(() => 'suspended'), 'every processor built (warm-up) while suspended');
  assert.equal(s.$('#cpu').textContent, 'Warming up the engine…', 'no "Audio is paused" nag');
  assert.equal(s.$('#notice').hidden, true);
  for (const f of s.dom.winL.pointerdown || []) f({ type: 'pointerdown', target: s.dom.document.body, repeat: false });
  assert.equal(c.state, 'suspended', 'a tap meanwhile leaves it held (wake)');
  await s.settle(300); await p;
  assert.deepEqual(c.calls, ['resume', 'suspend', 'resume'], 'resumed at ready');
  assert.equal(c.state, 'running');
  assert.equal(s.api.clock().webkit, true);
  await s.settle(5);
  assert.match(s.$('#cpu').textContent, /^DSP load/);
});

test('R5 WebKit power-on without the engine\'s ready: resumed after 3 s anyway', async () => {
  const s = await bootMain(Object.assign({ noReady: true }, IPAD));
  const p = s.api.powerOn();
  await s.settle(2500);
  assert.equal(s.ctx().state, 'suspended');
  await s.settle(700); await p;
  assert.deepEqual(s.ctx().calls, ['resume', 'suspend', 'resume']);
});

test('R5 WebKit (Bluetooth): the playhead, a recorded note and host.latency use one audible clock (outputLatency + ring + the Latency setting); play / seek post fresh, a tempo change and a new node do not', async () => {
  const s = await bootMain(Object.assign({ outLat: 0.18 }, IPAD));
  await s.power(); await s.settle(5);
  const api = s.api, c = s.ctx(), T = api.transport(), proj = api.project(), tr = proj.tracks[0], sr = c.sampleRate;
  assert.equal(c.state, 'running');
  proj.metronome.countIn = 0; proj.metronome.on = false;
  const node = s.nodeOf(tr.id);
  node.posted.length = 0;
  s.$('#tPlay').click(); await s.settle(2);
  assert.equal(T.playing, true);
  const tp = () => node.posted.filter(x => x.m.t === 'transport').map(x => x.m);
  assert.deepEqual(tp().map(m => [m.seek, m.fresh]), [[true, true]], 'Play: seek + fresh');
  assert.equal(api.curTick(), 0, 'before the start is heard: the start tick, never one before it');
  s.run(48000); s.raf();
  let d = 0.18 + 256 / sr;
  near(api.curTick(), heardAt(s, d), 1e-6, 'playhead = render stamp − (outputLatency + ring)');
  assert.equal(s.$('#tBBT').textContent, S.fmtBBT(proj, Math.round(heardAt(s, d))), 'the position display');
  near(api.sxHost(tr).latency(), d, 1e-9, 'host.latency: the same delay');
  // the Latency setting moves all three by exactly its amount
  s.$('#latR').value = '120'; s.$('#latR').oninput();
  assert.equal(api.settings().lat, 120);
  d += 0.12;
  near(api.curTick(), heardAt(s, d), 1e-6, '+120 ms');
  near(api.sxHost(tr).latency(), d, 1e-9, 'host.latency +120 ms');
  assert.equal(s.$('#lat').textContent, '+120 ms');
  assert.doesNotMatch(s.$('#rate').textContent, /output/, 'not on the header line (one header row at 1280 px)');
  s.$('#lat').onclick();
  assert.match(s.$('#latInfo').textContent, /heard +30\d\.\d ms after render/, 'the Latency popover\'s readout');
  s.$('#lat').onclick();
  // recording: a note played at a key's timeStamp lands on the tick heard then
  s.$('#tRec').click();
  assert.equal(T.rec, true);
  const m1 = s.ms, t0 = api.curTick(m1);
  near(t0, heardAt(s, d), 1e-6, 'the playhead at the key press');
  s.key('KeyA', true);
  s.run(4800); s.raf();
  const t1 = heardAt(s, d);
  s.key('KeyA', false);
  s.$('#tRec').click();
  const rec = tr.notes.filter(n => n.take === T.take);
  assert.equal(rec.length, 1, 'one recorded note');
  assert.deepEqual([rec[0].t, rec[0].d], [Math.round(t0), Math.max(1, Math.round(t1 - t0))], 'start and length on the heard clock');
  // a seek while playing: the old audio is still heard until the new anchor's frame comes out (no early jump)
  const before = api.curTick();
  node.posted.length = 0;
  s.$('#tStart').click();
  assert.deepEqual(tp().map(m => [m.seek, m.fresh, m.tick]), [[true, true, 0]], 'seek: fresh');
  near(api.curTick(), before, 1e-6, 'still the old position');
  s.run(48000 * 0.05 + (d + 0.01) * sr); s.raf();
  assert.ok(api.curTick() >= 0 && api.curTick() < 960, 'then the seek target: ' + api.curTick());
  // a tempo change re-anchors without fresh; a node created mid-song gets the anchor without fresh
  node.posted.length = 0;
  s.$('#tBpm').value = '100'; s.$('#tBpm').onchange();
  assert.deepEqual(tp().map(m => [m.seek, m.fresh]), [[false, undefined]], 'tempo: no fresh');
  const t2 = api.addTrack();
  const n2 = s.nodeOf(t2.id).posted.filter(x => x.m.t === 'transport').map(x => x.m);
  assert.deepEqual(n2.map(m => [m.seek, m.fresh]), [[true, undefined]], 'a new node: the anchor, no fresh');
  s.$('#tPlay').click();
  assert.equal(T.playing, false);
});

test('R5 Chromium: the speaker-stamped clock is used as it is (only the Latency setting is added); no suspend at power-on', async () => {
  const s = await bootMain({ clock: 'std', outLat: 0.03, baseLat: 0.01 });
  await s.power(); await s.settle(5);
  const api = s.api, c = s.ctx(), T = api.transport(), tr = api.project().tracks[0];
  assert.deepEqual(c.calls, ['resume'], 'no hold');
  assert.equal(api.clock().webkit, false);
  api.project().metronome.countIn = 0;
  s.$('#tPlay').click(); await s.settle(2);
  s.run(48000); s.raf();
  near(api.curTick(), heardAt(s, 0), 1e-6, 'the stamp is the heard time');
  near(api.sxHost(tr).latency(), 0.04, 1e-9, 'host.latency: currentTime − the heard time');
  s.$('#latR').value = '50'; s.$('#latR').oninput();
  near(api.curTick(), heardAt(s, 0.05), 1e-6, '+50 ms');
  near(api.sxHost(tr).latency(), 0.09, 1e-9);
  s.$('#tPlay').click();
  assert.equal(T.playing, false);
});

test('R5 the Latency setting persists per device (synth.settings), clamped to −50 … +400 ms; the presets', async () => {
  const ls = fakeStorage({ 'synthc.settings': JSON.stringify({ sr: 0, os: 4, lat: 9999 }) });
  const s = await bootMain({ ls });
  assert.equal(s.api.settings().lat, 400, 'clamped');
  assert.equal(s.api.clock().user, 400);
  s.$('#latR').value = '-80'; s.$('#latR').oninput();
  assert.equal(s.api.settings().lat, -50);
  s.$('#latR').value = '135'; s.$('#latR').oninput();
  s.api.save();
  assert.equal(JSON.parse(ls.getItem('synthc.settings')).lat, 135);
  const s2 = await bootMain({ ls });
  assert.equal(s2.api.settings().lat, 135, 'read back');
  assert.equal(s2.api.clock().user, 135, 'the clock uses it');
  assert.equal(s2.$('#latR').value, '135');
  assert.deepEqual([s2.$('#lat').textContent, s2.$('#latV').textContent], ['+135 ms', '+135 ms']);
  // the popover: open / close, the readout before the engine runs
  const btn = s2.$('#lat'), pop = s2.$('#latPop');
  assert.equal(pop.hidden, true);
  btn.onclick();
  assert.deepEqual([pop.hidden, btn.getAttribute('aria-expanded')], [false, 'true']);
  assert.match(s2.$('#latInfo').textContent, /^engine +Chromium/);
  btn.onclick();
  assert.equal(pop.hidden, true);
});

test('R5 the Bluetooth preset tops the delay the clock already allows up to about 200 ms (outputLatency includes Bluetooth on iPadOS 18.4+): +20 over 180 ms reported, +200 where none is reported (before 18.4); the slider and Auto clear it', async () => {
  const s = await bootMain(Object.assign({ outLat: 0.18 }, IPAD));
  await s.power(); await s.settle(5);
  s.run(4800); s.raf(); // a running read of outputLatency
  s.api.latPreset('bt');
  assert.deepEqual([s.api.settings().lat, s.api.settings().latBT, s.api.clock().user, s.$('#lat').textContent], [20, true, 20, 'Bluetooth']);
  near(s.api.outLatency(), 0.2 + 256 / 48000, 1e-6, 'about 200 ms in all (+ the ring)');
  s.$('#latR').value = '40'; s.$('#latR').oninput();
  assert.deepEqual([s.api.settings().lat, s.api.settings().latBT, s.$('#lat').textContent], [40, false, '+40 ms']);
  s.api.latPreset('bt'); s.api.latPreset('0');
  assert.deepEqual([s.api.settings().lat, s.api.settings().latBT, s.$('#lat').textContent], [0, false, 'Auto']);
  const s2 = await bootMain(Object.assign({}, IPAD, { outLat: null }));
  await s2.power(); await s2.settle(5);
  s2.run(4800); s2.raf();
  s2.api.latPreset('bt');
  assert.deepEqual([s2.api.settings().lat, s2.$('#lat').textContent], [200, 'Bluetooth']);
});

test('two-finger takeover of a ruler drag: the piano roll\'s host gets the arrangement\'s restoreLoop (the loop as at the press, its on flag too — setLoop turns it on)', async () => {
  const s = await bootMain({ ls: fakeStorage({}) });
  const p = s.api.project(), rh = s.api.roll().host, ah = s.api.arr().host;
  assert.equal(typeof rh.restoreLoop, 'function');
  assert.equal(rh.restoreLoop, ah.restoreLoop, 'one function for both editors');
  rh.setLoop(960, 3840);
  assert.deepEqual([p.loop.start, p.loop.end, p.loop.on], [960, 3840, true]);
  rh.restoreLoop({ start: 0, end: 7680, on: false });
  assert.deepEqual([p.loop.start, p.loop.end, p.loop.on], [0, 7680, false]);
});

test('R5 WebKit stall drift: a render stall caught up later (> 60 ms past the settled start) asks to resync; the resync closes the context before the new one', async () => {
  const s = await bootMain(Object.assign({ outLat: 0.012 }, IPAD));
  await s.power();
  await s.settle(2100); // the start's 5 ms meter has ended: the baseline is taken, animation frames sample now
  const api = s.api, c = s.ctx();
  assert.equal(api.clock().settled, true);
  // the IO sawtooth (currentTime in 128-frame steps), 2 s of it: the meter learns its jitter
  const P = 128 / 48000 * 1000;
  const tick = () => { s.advance(P); s.raf(); s.run(128, false); s.raf(); };
  for (let k = 0; k < 750; k++) tick();
  assert.equal(api.clock().stall, 0, 'no stall');
  assert.equal(s.$('#notice').hidden, true);
  // the audio thread stalls 200 ms (context time stands still), then renders the missed frames at once
  s.advance(100); s.raf(); s.advance(100); s.raf(); s.run(9600, false); s.raf();
  const st = api.clock().stall;
  assert.ok(st > 0.18 && st <= 0.2, 'measured ' + st);
  assert.equal(s.$('#notice').textContent, 'Audio timing drifted — tap to resync');
  assert.equal(s.$('#notice').dataset.act, '1', 'tap to act');
  s.$('#lat').onclick();
  assert.match(s.$('#latInfo').textContent, /heard +2\d\d\.\d ms after render/, 'the readout includes it');
  s.$('#lat').onclick();
  s.$('#notice').onclick();
  await s.settle(30);
  const c2 = s.ctx();
  assert.notEqual(c2, c, 'a new context');
  assert.equal(c.state, 'closed');
  assert.deepEqual(c2.born.slice(s.live.indexOf(c), s.live.indexOf(c) + 1), ['closed'], 'created after the old one closed');
  assert.equal(api.clock().stall, 0, 'the new context starts without the lead');
  assert.equal(s.$('#notice').hidden, true);
});

test('R5 a burst of re-anchors while playing (a loop-end drag, a held BPM spinner: the tempo kept), 50 ms apart on Bluetooth: the playhead stays on the heard line — no freeze ahead of the sound', async () => {
  const s = await bootMain(Object.assign({ outLat: 0.18 }, IPAD));
  await s.power(); await s.settle(5);
  const api = s.api, c = s.ctx(), T = api.transport(), proj = api.project(), sr = c.sampleRate, host = api.roll().host;
  proj.metronome.countIn = 0; proj.metronome.on = false; proj.loop.on = false;
  s.$('#tPlay').click(); await s.settle(2);
  s.run(48000); s.raf();
  const a0 = Object.assign({}, T.a), d = 0.18 + 256 / sr;
  const line = () => { const o = c.getOutputTimestamp(), F = (o.contextTime + (s.ms - o.performanceTime) / 1000 - d) * sr; return a0.tick + (F - a0.frame) / a0.fpt; };
  for (let k = 0; k < 8; k++) {
    host.setLoop(0, 30720 + 960 * k); // (each snapped step of the drag re-anchors)
    for (let j = 0; j < 5; j++) { s.run(480); near(api.curTick(), line(), 1e-6, `step ${k}, +${10 * (j + 1)} ms`); }
  }
  s.$('#tPlay').click();
});

test('R5 recording across a seek: a key pressed just after the jump (the old audio still heard) is a note at the target with its real length — back, back into a loop, forward; desktop too', async () => {
  for (const [name, o] of [['iPad', Object.assign({ outLat: 0.18 }, IPAD)], ['Chromium', { clock: 'std', outLat: 0.03 }]]) {
    for (const dir of ['back', 'loop', 'forward']) {
      const s = await bootMain(o);
      await s.power(); await s.settle(5);
      const api = s.api, c = s.ctx(), T = api.transport(), proj = api.project(), tr = proj.tracks[0], sr = c.sampleRate;
      proj.metronome.countIn = 0; proj.metronome.on = false;
      Object.assign(proj.loop, { on: dir === 'loop', start: 0, end: 7680 });
      s.$('#tPlay').click(); await s.settle(2);
      s.run(48000 * 3); s.raf();
      s.$('#tRec').click();
      const target = dir === 'forward' ? 30720 : 0;
      if (dir === 'forward') api.roll().host.setPlayhead(target); else s.$('#tStart').click();
      s.run(0.04 * sr);
      const before = api.curTick();
      assert.ok(before > 3000, `${name} ${dir}: the old position still heard (${before})`);
      s.key('KeyA', true);
      s.run(0.5 * sr); s.raf();
      const t1 = api.curTick();
      s.key('KeyA', false);
      s.$('#tRec').click();
      const rec = tr.notes.filter(n => n.take === T.take);
      assert.equal(rec.length, 1, `${name} ${dir}: one note`);
      const [t, dd] = [rec[0].t, rec[0].d];
      if (dir === 'forward') {
        assert.ok(t <= target && t > target - 700, `${name} forward: starts just before the target (${t})`);
        assert.equal(t + dd, Math.round(t1), `${name} forward: ends at the release`);
        near(dd, 960, 3, `${name} forward: half a second long`);
      } else assert.deepEqual([t, dd], [0, Math.round(t1)], `${name} ${dir}: from the target to the release`);
      s.$('#tPlay').click();
    }
  }
});

test('R5 a Latency setting past the clock\'s own delay (Chromium, 40 ms stamp lag, −50 ms): the playhead and host.latency stay one clock — host.latency −10 ms, not floored at 0', async () => {
  const s = await bootMain({ clock: 'std', outLat: 0.03, baseLat: 0.01 });
  await s.power(); await s.settle(5);
  const api = s.api, tr = api.project().tracks[0];
  api.project().metronome.countIn = 0;
  s.$('#tPlay').click(); await s.settle(2);
  s.run(48000); s.raf();
  s.$('#latR').value = '-50'; s.$('#latR').oninput();
  near(api.curTick(), heardAt(s, -0.05), 1e-6, 'the playhead: 50 ms later than the stamp');
  near(api.sxHost(tr).latency(), -0.01, 1e-9, 'host.latency: the same delay, signed');
  s.$('#tPlay').click();
});

test('R5 WebKit power-on started at a finger\'s press (no activation yet: the context starts locked): the release unlocks the held context — it runs at the engine\'s ready without another tap', async () => {
  const s = await bootMain(Object.assign({ readyMs: 600, outLat: 0.18 }, IPAD));
  const Base = globalThis.AudioContext;
  let gesture = false;
  // WebKit: a context created outside an activation starts suspended; resume() outside one is refused (left pending)
  globalThis.AudioContext = class extends Base {
    constructor(opt) { super(opt); this.state = 'suspended'; this.locked = true; }
    resume() { if (this.locked && !gesture) { (this.calls || (this.calls = [])).push('resume(refused)'); return new Promise(() => {}); } this.locked = false; return super.resume(); }
  };
  try {
    const p = s.api.powerOn(); // (a key's pointerdown)
    await s.settle(450);
    const c = s.ctx();
    assert.deepEqual([c.calls, c.state], [['resume(refused)', 'suspend'], 'suspended'], 'held, still locked');
    gesture = true;
    for (const f of s.dom.winL.pointerup || []) f({ type: 'pointerup', target: s.dom.document.body, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, buttons: 0, clientX: 0, clientY: 0, timeStamp: 0, preventDefault() {}, stopPropagation() {} });
    gesture = false;
    assert.deepEqual([c.calls, c.state], [['resume(refused)', 'suspend', 'resume', 'suspend'], 'suspended'], 'the release: unlocked, still held');
    assert.equal(s.$('#cpu').textContent, 'Warming up the engine…');
    await s.settle(300); await p;
    assert.deepEqual([c.calls.slice(4), c.state], [['resume'], 'running'], 'resumed at ready, no second tap');
  } finally { globalThis.AudioContext = Base; }
});

/* ---------------------------------------------------------- chords (R6, R7) */
// (each boots its own page: a fresh project on the Minimoog, the default model)
const modelOf = id => MODELS.find(m => m.id === id);
// a track's instrument menu entries, 'id=text' (strings only: never a fake-DOM node into assert): the canvas shell's
// instrument chip menu ("Change instrument", main.js instItems), the track's own entry as its row's chip label shows it
// (voiceOpt: relabelled by voiceSeen)
function menuOf(s, tr) {
  const row = s.$('#heads').children.find(r => r.dataset && r.dataset.id === tr.id);
  const lab = row.children[1].children[0].children[1], text = lab.children.length ? lab.children.map(c => c.textContent).join('') : lab.textContent; // (.hin + .his + .hiv)
  return globalThis.__synthTest.shell.instItems(tr).map(o => o.value + '=' + (o.value === tr.model ? text : o.label));
}
const noteAt = (id, t, n, d = 480) => ({ id, t, d, n, v: 100 });

test('R6: the instrument menu and the track tab name each track\'s voice mode; a chord a track cannot play asks once (tap: a polyphonic model, undoable; Serum: its instrument); legato lines never ask', async () => {
  const s = await bootMain({ hash: '#minimoog' });
  const api = s.api, t = api.project().tracks[0], host = api.roll().host, note = () => s.$('#notice');
  assert.equal(t.model, 'minimoog');
  assert.equal(s.$('#tabTrack').textContent, `Track: ${t.name} · Mono`);
  const menu = menuOf(s, t);
  for (const e of ['minimoog=Minimoog · Mono', 'tb303=TB-303 · Mono', 'prophet5=Prophet-5 · Poly 5', 'juno60=Juno-60 · Poly 6', 'jupiter8=Jupiter-8 · Poly 8',
    'dx7=DX7 · Poly 16', 'solina=Solina · Poly', 'serum=Serum · Poly 8']) assert.ok(menu.includes(e), e + ' in ' + menu.join(' | '));
  // a legato / glide line (overlapping notes that start apart) asks nothing
  host.edit('Draw', () => t.notes.push(noteAt('l1', 0, 48, 600), noteAt('l2', 480, 50, 600), noteAt('l3', 960, 52, 600)));
  assert.equal(note().hidden, true, 'no notice for a legato line');
  // a chord does, once per track
  host.edit('Draw', () => t.notes.push(noteAt('c1', 1920, 60), noteAt('c2', 1920, 64), noteAt('c3', 1920, 67)));
  assert.equal(note().textContent, `“${t.name}” is monophonic — its chords play one note. Tap to switch it to the Prophet-5 (5 voices; Undo restores it)`);
  assert.equal(note().dataset.act, '1', 'tap to act');
  api.notice('', 0);
  host.edit('Draw', () => t.notes.push(noteAt('f1', 3840, 62), noteAt('f2', 3860, 65))); // a played chord (a 20-tick flam)
  assert.equal(note().hidden, true, 'once per track and session');
  // the tap (its action stays with its text): the track becomes a Prophet-5 — an undo step —, the labels follow
  api.notice(`“${t.name}” is monophonic — its chords play one note. Tap to switch it to the Prophet-5 (5 voices; Undo restores it)`, 0);
  note().onclick();
  const t2 = api.project().tracks[0];
  assert.equal(t2.model, 'prophet5');
  assert.equal(s.$('#tabTrack').textContent, `Track: ${t2.name} · Poly 5`);
  assert.ok(menuOf(s, t2).includes('prophet5=Prophet-5 · Poly 5'));
  assert.equal(note().hidden, true);
  s.$('#tUndo').onclick();
  assert.equal(api.project().tracks[0].model, 'minimoog', 'undone');
  assert.equal(s.$('#tabTrack').textContent, `Track: ${api.project().tracks[0].name} · Mono`);
  // a poly track: only a chord beyond its voices asks — the Juno-60 (6): 6 notes no, 8 notes yes → the Jupiter-8 (8)
  const j = api.addTrack(modelOf('juno60'));
  host.edit('Draw', () => { for (let k = 0; k < 6; k++) j.notes.push(noteAt('j' + k, 0, 60 + 2 * k)); });
  assert.equal(note().hidden, true, 'six notes on six voices');
  host.edit('Draw', () => { for (let k = 0; k < 8; k++) j.notes.push(noteAt('k' + k, 1920, 60 + 2 * k)); });
  assert.equal(note().textContent, `“${j.name}” has 6 voices — a chord of 8 notes drops some. Tap to switch it to the Jupiter-8 (8 voices; Undo restores it)`);
  // a mono Serum patch: the tap opens its instrument (the voicing lives in its panel) instead of replacing the sound
  const x = api.addTrack(modelOf('serum'));
  x.vals.s.voicing.mono = 1; // (as the panel's Voicing › Mono sets it)
  host.edit('Draw', () => x.notes.push(noteAt('x1', 0, 60), noteAt('x2', 0, 63)));
  assert.equal(note().textContent, `“${x.name}” is monophonic — its chords play one note. Tap to open its instrument`);
  note().onclick();
  assert.equal(api.project().selTrack, x.id, 'its track selected');
  assert.equal(x.model, 'serum', 'the sound is kept');
  assert.equal(s.$('#tab-inst').hidden, false, 'the CANVAS view (and the Sources tray to replace it)');
});

test('R7: Piano Roll previews post aud (B5); the song is sent sorted mid-gesture (B4); a panic re-sends the anchor without fresh (B1); the CPU cap shows on a capped Serum track until lifted', async () => {
  const s = await bootMain({ hash: '#minimoog' });
  await s.power(); await s.settle(5); s.raf();
  const api = s.api, t = api.project().tracks[0], host = api.roll().host, node = s.nodeOf(t.id);
  node.posted.length = 0;
  host.audition(60, 100); host.auditionOff(60);
  assert.deepEqual(node.posted.map(x => [x.m.t, x.m.n, x.m.aud]), [['on', 60, 1], ['off', 60, 1]]);
  // B4: a gesture appends / moves notes in place (sorted only at its end): songData sends a sorted copy
  t.notes.push(noteAt('b1', 960, 64), noteAt('b2', 0, 67), noteAt('b3', 0, 60));
  const d = api.songData(t);
  assert.deepEqual(d.notes, [0, 480, 60, 100, 0, 480, 67, 100, 960, 480, 64, 100]);
  assert.deepEqual(t.notes.map(n => n.id), ['b1', 'b2', 'b3'], 'the track\'s own array untouched');
  // B1: play posts fresh; a panic's re-send of the same (old) anchor does not
  api.project().metronome.countIn = 0;
  node.posted.length = 0;
  s.$('#tPlay').click(); await s.settle(2);
  s.$('#panic').onclick();
  assert.deepEqual(node.posted.filter(x => x.m.t === 'transport').map(x => [x.m.seek, x.m.fresh]), [[true, true], [true, undefined]]);
  s.$('#tPlay').click();
  // R7 cap display: a Serum track at POLY 16 through Q4 (≤ 8) and Q6 (≤ 4), then a Quality choice
  const x = api.addTrack(modelOf('serum'));
  x.vals.s.voicing.poly = 16;
  api.queuePatch(x); s.raf();
  assert.equal(s.$('#tabTrack').textContent, `Track: ${x.name} · Poly 16`);
  const lower = () => { for (const N of api.nodes.values()) N.load = 0; api.nodes.get(x.id).load = 1.2; api.lowerOS(); s.raf(); };
  for (let k = 0; k < 8 && api.caps().qrStep < 4; k++) lower();
  assert.equal(api.caps().qrStep, 4);
  assert.equal(s.$('#tabTrack').textContent, `Track: ${x.name} · Poly 8 (CPU cap)`, 'the track tab');
  assert.ok(menuOf(s, x).includes('serum=Serum · Poly 8 (CPU cap)'), 'its instrument menu');
  assert.match(s.$('#rate').textContent, / · quality step Q4, polyphony ≤ 8 \(CPU cap\)/);
  lower(); lower();
  assert.equal(api.caps().qrStep, 6);
  assert.equal(s.$('#tabTrack').textContent, `Track: ${x.name} · Poly 4 (CPU cap)`);
  api.liftCaps(); s.raf();
  assert.equal(api.caps().qrStep, 0);
  assert.equal(s.$('#tabTrack').textContent, `Track: ${x.name} · Poly 16`, 'lifted');
});

test('G2 two-finger rollback (gesture.js\'s pointercancel flagged e.gesture === "two-finger"): a classic knob drag puts the value and the preset name back (a plain cancel keeps both); a finger selects a track header and closes the modal backdrop on its tap\'s release only, a mouse at the press', async () => {
  const s = await bootMain({ hash: '#minimoog' });
  const api = s.api, find = (n, f) => { if (f(n)) return n; for (const c of n.children || []) { const r = find(c, f); if (r) return r; } return null; };
  const ev = (type, o) => Object.assign({ type, button: 0, buttons: type === 'pointerup' ? 0 : 1, ctrlKey: false, shiftKey: false, pointerId: 5, pointerType: 'touch',
    clientX: 50, clientY: 300, preventDefault() {}, stopPropagation() {} }, o);
  const fire = (el, type, o) => el.dispatchEvent(ev(type, Object.assign({ target: el }, o)));
  const TWO = { gesture: 'two-finger' };
  // classic knob: the first change made the preset "Custom" (null) — the rollback puts the value and the name back
  const t = api.project().tracks[0], knob = find(s.$('#inst'), n => n.className === 'knob');
  assert.ok(knob, 'a classic knob');
  t.preset = 'Fat Bass';
  const v0 = JSON.stringify(t.vals);
  fire(knob, 'pointerdown'); fire(knob, 'pointermove', { clientY: 200 });
  assert.notEqual(JSON.stringify(t.vals), v0, 'dragged');
  assert.equal(t.preset, null, 'Custom while dragging');
  fire(knob, 'pointercancel', Object.assign({ clientY: 200 }, TWO));
  assert.equal(JSON.stringify(t.vals), v0, 'the value back');
  assert.equal(t.preset, 'Fat Bass', 'the preset name back');
  fire(knob, 'pointermove', { clientY: 100 });
  assert.equal(JSON.stringify(t.vals), v0, 'the drag is over');
  fire(knob, 'pointerdown'); fire(knob, 'pointermove', { clientY: 200 }); fire(knob, 'pointercancel', { clientY: 200 });
  assert.notEqual(JSON.stringify(t.vals), v0, 'a plain cancel keeps the value');
  assert.equal(t.preset, null);
  // track header rows: a finger selects on its tap's release; a two-finger cancel or a 30 px slide selects nothing
  api.addTrack();
  const [t0, t1] = api.project().tracks.map(x => x.id);
  api.selectTrack(t0);
  const row = id => find(s.$('#heads'), n => !!n.dataset && n.dataset.id === id);
  fire(row(t1), 'pointerdown');
  assert.equal(api.project().selTrack, t0, 'not at the press');
  fire(row(t1), 'pointercancel', TWO); fire(row(t1), 'pointerup');
  assert.equal(api.project().selTrack, t0, 'cancelled');
  fire(row(t1), 'pointerdown'); fire(row(t1), 'pointerup', { clientX: 80 });
  assert.equal(api.project().selTrack, t0, 'a slide');
  fire(row(t1), 'pointerdown'); fire(row(t1), 'pointerup', { clientX: 53 });
  assert.equal(api.project().selTrack, t1, 'a tap selects');
  fire(row(t0), 'pointerdown', { pointerType: 'mouse' });
  assert.equal(api.project().selTrack, t0, 'a mouse at the press');
  // the modal dialog's backdrop
  const m = s.$('#modal'), bd = { target: { id: 'modal' } };
  m.hidden = false;
  fire(m, 'pointerdown', bd);
  assert.equal(m.hidden, false, 'not at the press');
  fire(m, 'pointercancel', Object.assign({}, bd, TWO)); fire(m, 'pointerup', bd);
  assert.equal(m.hidden, false, 'cancelled: open');
  fire(m, 'pointerdown', bd); fire(m, 'pointerup', Object.assign({ clientX: 52 }, bd));
  assert.equal(m.hidden, true, 'a tap closes it');
  m.hidden = false;
  fire(m, 'pointerdown', Object.assign({ pointerType: 'mouse' }, bd));
  assert.equal(m.hidden, true, 'a mouse at the press');
  fire(m, 'pointerup', Object.assign({ pointerType: 'mouse' }, bd));
});

test('G2 two-finger rollback: the step sequencer\'s Tempo (a knob in the Hardware layout, a number box in the Resizable one) and step notes (a rest the drag made a note is a rest again) — once per layout', async () => {
  // the Hardware layout from a fixture TB-303 panel (tests/fixtures/panels.mjs, through cv-panel's test hook) until
  // panels/tb303.js lands; the ⋯ toggle gives the Resizable one (today's sequencer DOM)
  const s = await bootMain({ hash: '#tb303', synthTest: { panels: { tb303: TB_FX } } });
  const api = s.api, find = (n, f) => { if (f(n)) return n; for (const c of n.children || []) { const r = find(c, f); if (r) return r; } return null; };
  const ev = (type, o) => Object.assign({ type, button: 0, buttons: 1, ctrlKey: false, shiftKey: false, pointerId: 6, pointerType: 'touch', clientX: 50, clientY: 300,
    preventDefault() {}, stopPropagation() {} }, o);
  const fire = (el, type, o) => el.dispatchEvent(ev(type, Object.assign({ target: el }, o)));
  const t = api.project().tracks[0];
  assert.equal(t.model, 'tb303');
  const cv = globalThis.__synthTest.cv;
  for (const layout of ['hw', 'flow']) {
    if (layout === 'flow') cv.setLayout('flow');
    assert.equal(cv.instUi(api.project().tracks[0]), layout);
    const tempo = find(s.$('#inst'), n => n.attrs && n.attrs.role === 'slider' && n.attrs['aria-label'] === 'Tempo');
    const step = find(s.$('#inst'), n => n.className === 'snote' && n.attrs && n.attrs['aria-label'] === 'Step 2 note');
    assert.ok(tempo && step, layout + ': Tempo and a step note');
    assert.equal(tempo.className, layout === 'hw' ? 'knob hw-tempo' : 'num', layout + ': the hardware TEMPO knob / today\'s number box');
    const tr = api.project().tracks[0], bpm0 = tr.seq.bpm;
    fire(tempo, 'pointerdown'); fire(tempo, 'pointermove', { clientY: 260 });
    assert.notEqual(tr.seq.bpm, bpm0, layout);
    fire(tempo, 'pointercancel', { gesture: 'two-finger' });
    assert.equal(tr.seq.bpm, bpm0, layout);
    tr.seq.pat[1].g = 0;
    const n0 = tr.seq.pat[1].n;
    fire(step, 'pointerdown'); fire(step, 'pointermove', { clientY: 250 });
    assert.deepEqual([tr.seq.pat[1].g, tr.seq.pat[1].n !== n0], [1, true], layout + ': the drag made the rest a note');
    fire(step, 'pointercancel', { gesture: 'two-finger' });
    assert.deepEqual([tr.seq.pat[1].g, tr.seq.pat[1].n], [0, n0], layout + ': a rest again');
    fire(step, 'pointerdown'); fire(step, 'pointermove', { clientY: 250 }); fire(step, 'pointercancel');
    assert.equal(tr.seq.pat[1].g, 1, layout + ': a plain cancel keeps');
  }
});

test('Hardware panels in the page: a DX7 (fixture) — button 18 + OPERATOR SELECT address r2, DATA ENTRY sets it (one value, the preset Custom), the LCD says so; a TB-303 (fixture) key writes the cursor step', async () => {
  const s = await bootMain({ hash: '#dx7', synthTest: { panels: { dx7: DX_FX, tb303: TB_FX } } });
  const api = s.api, find = (n, f) => { if (f(n)) return n; for (const c of n.children || []) { const r = find(c, f); if (r) return r; } return null; };
  const ev = (type, o) => Object.assign({ type, button: 0, buttons: 1, ctrlKey: false, shiftKey: false, pointerId: 7, pointerType: 'mouse', clientX: 50, clientY: 300,
    preventDefault() {}, stopPropagation() {} }, o);
  const fire = (el, type, o) => el.dispatchEvent(ev(type, Object.assign({ target: el }, o)));
  const t = api.project().tracks[0], cv = globalThis.__synthTest.cv;
  assert.equal(t.model, 'dx7');
  assert.ok(cv.hw(), 'the hardware panel rendered');
  const btn = n => find(s.$('#inst'), x => x.attrs && x.attrs['data-n'] === String(n));
  fire(btn(18), 'pointerdown');
  const opsel = find(s.$('#inst'), x => x.attrs && x.attrs['aria-label'] === 'Operator select');
  fire(opsel, 'pointerdown');
  assert.equal(btn(18).parentNode.attrs['data-ctl'], 'r2', 'button 18 addresses operator 2\'s coarse frequency');
  const data = find(s.$('#inst'), x => x.attrs && x.attrs['aria-label'] === 'Data entry'), r0 = t.vals.r2;
  t.preset = 'X';
  fire(data, 'pointerdown', { clientY: 300 }); fire(data, 'pointermove', { clientY: 200 }); fire(data, 'pointerup', { clientY: 200, buttons: 0 });
  assert.ok(t.vals.r2 > r0, 'DATA ENTRY raised r2');
  assert.equal(t.preset, null, 'Custom');
  const lcd = find(s.$('#inst'), x => x.className === 'hw-lcd');
  assert.match(lcd.children[1].textContent, /^OP2 COARSE=/);
  // the TB-303: a key in PITCH mode writes the cursor step (step 1), its grid follows
  api.setTrackModel(t, 'tb303');
  const tb = api.project().tracks[0], key = find(s.$('#inst'), x => x.attrs && x.attrs['aria-label'] === 'Key E');
  tb.seq.pat[0].g = 0;
  fire(key, 'pointerdown');
  assert.deepEqual([tb.seq.pat[0].n, tb.seq.pat[0].g], [4, 1]);
});

test('R6: the chord notice judges a switch on the model\'s last-used values — a saved Unison Prophet-5 is skipped for the Juno-60 (6 voices); the tap gives a polyphonic track', async () => {
  const s = await bootMain({ hash: '#minimoog', ls: fakeStorage({ 'synthc.v.prophet5': JSON.stringify({ un: 1 }) }) });
  const api = s.api, t = api.project().tracks[0], host = api.roll().host, note = () => s.$('#notice');
  host.edit('Draw', () => t.notes.push(noteAt('c1', 1920, 60), noteAt('c2', 1920, 64), noteAt('c3', 1920, 67)));
  const txt = `“${t.name}” is monophonic — its chords play one note. Tap to switch it to the Juno-60 (6 voices; Undo restores it)`;
  assert.equal(note().textContent, txt);
  note().onclick();
  const t2 = api.project().tracks[0];
  assert.equal(t2.model, 'juno60');
  assert.equal(s.$('#tabTrack').textContent, `Track: ${t2.name} · Poly 6`);
});

test('R7 B5: a Piano Roll preview\'s note-off goes to the track its note-on went to — the selection moved in between (a held note, a 170 ms blip); the same pitch on two tracks pairs in order', async () => {
  const s = await bootMain({ hash: '#minimoog' });
  await s.power(); await s.settle(5); s.raf();
  const api = s.api, a = api.project().tracks[0], b = api.addTrack(modelOf('prophet5')), host = api.roll().host;
  api.selectTrack(a.id);
  const na = s.nodeOf(a.id), nb = s.nodeOf(b.id), notes = n => n.posted.filter(x => x.m.t === 'on' || x.m.t === 'off').map(x => x.m.t + x.m.n);
  na.posted.length = 0; nb.posted.length = 0;
  host.audition(63, 100);
  api.selectTrack(b.id);
  host.auditionOff(63);
  assert.deepEqual([notes(na), notes(nb)], [['on63', 'off63'], []], 'the off to the first track');
  na.posted.length = 0; nb.posted.length = 0;
  api.selectTrack(a.id); host.audition(61, 100);
  api.selectTrack(b.id); host.audition(61, 100);
  host.auditionOff(61); host.auditionOff(61);
  assert.deepEqual([notes(na), notes(nb)], [['on61', 'off61'], ['on61', 'off61']], 'one off each, in order');
  host.auditionOff(70); // (an off with no preview: the selected track, as before)
  assert.deepEqual(notes(nb).slice(2), ['off70']);
});

test('2a §7.10: the live wheel also reaches every track with a Mod Wheel cable (unselected, unarmed) and is recorded only into the armed targets; at / bend stay per track; canvas rows reach the patch, halos, the badge', async () => {
  const s = await bootMain({ hash: '#serum' });
  await s.power(); await s.settle(5); s.raf();
  const api = s.api, proj = api.project(), T = api.transport(), a = proj.tracks[0], b = api.addTrack(modelOf('serum'));
  api.selectTrack(a.id);
  a.arm = true;
  await s.settle(2);
  const na = s.nodeOf(a.id), nb = s.nodeOf(b.id), sent = (n, k) => n.posted.filter(x => x.m.t === k).map(x => x.m.v);
  const clear = () => { na.posted.length = 0; nb.posted.length = 0; };
  // no module: today's routing (the selected / armed targets only)
  assert.deepEqual(proj.perf, { wheel: null }, 'loadProject / freshProject: perf normalised');
  clear(); api.ctl('wheel', 0.25, 0);
  assert.deepEqual([sent(na, 'wheel'), sent(nb, 'wheel'), api.wheelTracks()], [[0.25], [], []]);
  // the project wheel, cabled to a knob of b's Serum
  CMOD.placeWheel(proj);
  const bi = CMOD.primId(b), r = CMOD.addMod(b, 'wheel', bi + ':f.cutoff', { project: proj });
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(api.wheelTracks(), [b]);
  clear(); api.ctl('wheel', 0.7, 0);
  assert.deepEqual([sent(na, 'wheel'), sent(nb, 'wheel')], [[0.7], [0.7]], 'the union: targets ∪ wheelTracks');
  clear(); api.midi.message([0xb0, 1, 127], 1); // (CC 1 on channel 1: the router's ctl('wheel'))
  assert.deepEqual([sent(na, 'wheel'), sent(nb, 'wheel')], [[1], [1]]);
  assert.deepEqual([api.perfValue('wheel', a), api.perfValue('wheel', b)], [1, 1]);
  clear(); api.ctl('at', 0.5, 0); api.ctl('bend', -0.25, 0);
  assert.deepEqual([sent(na, 'at'), sent(nb, 'at'), sent(na, 'bend'), sent(nb, 'bend')], [[0.5], [], [-0.25], []], 'aftertouch / bend: per track, unchanged');
  assert.deepEqual([api.perfValue('at', a), api.perfValue('bend', a), api.perfValue('at', b)], [0.5, -0.25, 0]);
  api.noteOn(60, 0.8, 0, s.ms); api.noteOff(60, 0, s.ms);
  assert.deepEqual([api.lastVel(a), api.lastVel(b)], [0.8, 0]);
  // recording: into the armed targets only (a), never into b
  proj.metronome.countIn = 0; proj.metronome.on = false;
  s.$('#tPlay').click(); await s.settle(2);
  s.$('#tRec').click();
  assert.equal(T.rec, true);
  s.run(4800); s.raf();
  const nb0 = b.cc.length;
  clear(); api.ctl('wheel', 0.4, 0, s.ms);
  assert.deepEqual([sent(na, 'wheel'), sent(nb, 'wheel')], [[0.4], [0.4]]);
  assert.ok(a.cc.some(c => c.k === 'wheel' && c.v === 0.4), 'recorded into the armed target');
  assert.equal(b.cc.length, nb0, 'not into the cabled track');
  assert.equal(api.perfValue('wheel', a), 0.4, 'during playback: the lane value at the heard tick');
  s.$('#tRec').click(); s.$('#tPlay').click();
  // the patch: the row compiles into b's Serum exactly as the same row written into its matrix
  const P = api.buildPatch(b);
  b.mods = [];
  const P0 = api.buildPatch(b), sb = b.vals.s;
  assert.equal(P.serum.mN, P0.serum.mN + 1, 'one more active row');
  const k = core.addMod(sb, b.fx, 'wheel', 'f.cutoff', { amt: r.row.amt, bi: r.row.bi });
  assert.deepEqual(api.buildPatch(b), P, 'canvas row ≡ the Serum\'s own row (its WHEEL tile)');
  sb.matrix[k] = core.normRow(null);
  b.mods = [r.row];
  assert.deepEqual(api.buildPatch(b), P);
  // the halo rows, the badge
  assert.deepEqual(api.sxHost(b).extraRows('f.cutoff'), [{ id: r.row.id, src: 'wheel', amt: r.row.amt, bi: r.row.bi, byp: 0, out: 1, label: 'Mod Wheel', pol: 'uni' }]); // (2b fixer C: the host's label and the source's polarity)
  assert.deepEqual(api.sxHost(b).extraRows('f.res'), []);
  const mc = api.modCount(b);
  assert.deepEqual([mc.canvas, mc.left, mc.max, mc.text], [1, [], 64, 'mods ' + (mc.preset + 1) + '/64']);
  assert.equal(api.modCount(a), null, 'no canvas rows: the safeguard\'s badge');
  // the wheel removed: today's routing again
  CMOD.removeWheel(proj);
  clear(); api.ctl('wheel', 0.1, 0);
  assert.deepEqual([sent(na, 'wheel'), sent(nb, 'wheel'), b.mods], [[0.1], [], []]);
});
