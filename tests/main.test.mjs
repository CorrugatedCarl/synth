// main.js in the page simulation (owner I; SPEC-serum2 §12.6, §11.15, §13.2.5, §14.3, §15.13): the real main.js booted
// by tests/main-sim.mjs against a DOM stub and Web Audio fakes whose worklet nodes run the real engine. Covers the host
// contract additions, CT / seqT part delivery, preference recompiles, the preset preview node, render-last ≡ bounce,
// the CPU safeguard's quality steps, MIDI / MPE routing through midi.js and the IndexedDB app store.
// Run: node --test tests/main.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootMain } from './main-sim.mjs';
import { fakeStorage, fakeIDB } from './fakes.mjs';
import { MODELS } from '../models.js?v=7';
import * as core from '../serum-core.js?v=7';

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
  assert.equal(c.modules.length, 12, '§0.3: 11 DSP scripts + engine.js');
  assert.ok(c.modules[11].startsWith('engine.js'));
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
  assert.equal(JSON.parse(idb.data('synth-app', 'tracks').get('t:' + tr.id).j).notes.length, tr.notes.length);
});

test('§12.6 storage (sign-off item 7): first run migrates a Phase-1 localStorage into IndexedDB and loads its project; autosave rewrites only changed tracks; quota errors show the notice', async () => {
  const proj = JSON.parse(readFileSync(new URL('./ref-p1/project-p1.json', import.meta.url), 'utf8'));
  delete proj.wts;
  const snap = { 'synth.project': JSON.stringify(proj), 'synth.settings': JSON.stringify({ sr: 0, os: 4, drift: 5, master: 0.8, model: 'serum', vel: 100 }), 'synth.tab': '"inst"' };
  const ls = fakeStorage(snap), idb = fakeIDB();
  const s2 = await bootMain({ ls, idb });
  const api = s2.api;
  assert.equal(api.store.mode, 'idb', 'IndexedDB store');
  assert.equal(api.store.info().migrated, true, 'first run: migrated');
  assert.deepEqual(api.project().tracks.map(t => t.id), proj.tracks.map(t => t.id), 'the Phase-1 project loaded from the database');
  const lsApp = () => { const o = Object.fromEntries(ls.m); delete o['synth-app.idb']; return o; }; // (without the verified-database marker)
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
  const s2 = await bootMain({ hash: '#serum', ls: fakeStorage({ 'synth.settings': JSON.stringify({ sr: 48000 }) }) });
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
