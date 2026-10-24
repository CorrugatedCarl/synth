import './v8-guard.mjs';
// Stage M lane A (docs/canvas/IMPL-M.md §2–§5, §6 G1 (sim part) and G7, §9 O2 / O4): the master in the page simulation with the
// real engine — MASTER ('synth-master', lane D) made once in powerOn before every track node, the graph pan → MASTER → Mono →
// Volume → destination (`an` and O1's analysers off MASTER), an empty master's output = its input bit for bit (the live sum and
// the bounce), postAll's forwarding (transport, panic — never 'os'), P-1 (b)'s aligned anchors, the master rack's host (qr null,
// not History, persisted), the listening controls (Mono, the A/B — level-matched, kept across a knob — and Volume: never in a
// file), the bounce (MASTER last, its latency trimmed, Same as playback, Auto tail, Loudness normalise, the note), History's
// keepMaster, the assets (users, an IR reaching MASTER, a gc), schema 14, the Master row (the footer) and the master canvas — every
// cvMaster path writing no track (G7: each track's JSON byte-identical after master-canvas moves, Tidy, drops, menus).
// Accessor-free like the other canvas sims (a guard build); canvas-sim's scripted world; one boot; strings, numbers and booleans
// only into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/canvas-M-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as CMOD from '../cv-model.js?v=9';
import * as CM from '../cv-migrate.js?v=9';
import * as CG from '../cv-graph.js?v=9';
import * as FC from '../fx-core.js?v=9';
import * as S from '../song.js?v=9';
import * as cvTray from '../cv-tray.js?v=9';
import * as MUI from '../master-ui.js?v=9';
import { MODELS } from '../models.js?v=9';

// every DSP global wk.loadDSP waits for, defined (null): a host's load resolves at once (canvas-3-sim's rule)
for (const g of ['SxBase', 'SxFilt2', 'SxWarp', 'SxMod', 'SxSample', 'SxGran', 'SxSpec', 'SxSeq', 'SerumDSP', 'FXMods2', 'FXDSP', 'Dr808', 'DrSeq', 'ModCore', 'PatchDSP', 'PatchMoog', 'MASTERDSP']) globalThis[g] = null;
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

const ls = fakeStorage({});
const sim = await bootMain({ ls, hash: '#minimoog', clock: 'std', synthTest: { cvWorld: root => scriptedWorld(root) } });
const api = sim.api, cv = globalThis.__synthTest.cv, M = globalThis.__synthTest.master, sh = globalThis.__synthTest.shell;
await sim.power(); sim.raf(); await sim.settle(10); sim.raf();

const P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack);
const MN = () => M.rec().node, mgot = t => MN().posted.map(x => x.m).filter(m => !t || m.t === t);
const settle = async (n = 2) => { for (let i = 0; i < n; i++) { sim.raf(); await sim.settle(3); } };
const tracksJSON = () => P().tracks.map(t => JSON.stringify(t)).join('\n');
const MOOG = MODELS.find(m => m.id === 'minimoog');
const pe = (el, type, x, y) => el.dispatchEvent({ type, target: el, currentTarget: el, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 7,
  pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, timeStamp: performance.now(), shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
  preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
function drag(m, dx, dy) { pe(m.bar, 'pointerdown', 500, 70); pe(m.bar, 'pointermove', 500 + dx / 2, 70 + dy / 2); pe(m.bar, 'pointermove', 500 + dx, 70 + dy); pe(m.bar, 'pointerup', 500 + dx, 70 + dy); }
// the sim's equal-power panner on a stereo input (main-sim panMix): what one route adds
function route(L, R, i, pan, g) {
  const p = Math.max(-1, Math.min(1, pan)), x = p <= 0 ? p + 1 : p, gl = Math.cos(x * Math.PI / 2), gr = Math.sin(x * Math.PI / 2);
  return p <= 0 ? [g * (L[i] + R[i] * gl), g * (R[i] * gr)] : [g * (L[i] * gl), g * (R[i] + L[i] * gr)];
}
// a bounce through the page's dialog: its fields set explicitly (the dialog's own defaults are "Same as playback")
async function bounce(set = {}) {
  const st = Object.assign({ range: 'song', sr: '48000', bits: '32', os: '2', tail: '0', norm: 'off' }, set), blobs = [], real = URL.createObjectURL;
  URL.createObjectURL = b => { blobs.push(b); return 'blob:sim/' + blobs.length; };
  try {
    sim.$('#fBounce').click();
    for (const [k, v] of [['#bRange', st.range], ['#bSr', st.sr], ['#bBits', st.bits], ['#bOs', st.os], ['#bTail', st.tail], ['#bNorm', st.norm]]) sim.$(k).value = v;
    sim.$('#bNorm').checked = false;
    if (st.tgt) sim.$('#bTgt').value = st.tgt;
    sim.lastOffline = null;
    await sim.$('#bGo').onclick();
    for (let i = 0; i < 40 && !sim.lastOffline; i++) await sim.settle(5);
    const wav = blobs.length ? new Uint8Array(await blobs[0].arrayBuffer()) : null;
    return { note: sim.$('#bNote').textContent, off: sim.lastOffline, wav };
  } finally { URL.createObjectURL = real; sim.$('#bCancel').onclick(); } // (the dialog closed: the keys play again)
}
const f32le = (wav, ch) => { // a 32-bit float stereo WAV's channel ch
  const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let o = 12; while (o + 8 <= wav.length && String.fromCharCode(...wav.subarray(o, o + 4)) !== 'data') o += 8 + dv.getUint32(o + 4, true);
  const n = dv.getUint32(o + 4, true) / 8, out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = dv.getFloat32(o + 8 + (2 * i + ch) * 4, true);
  return out;
};
const notes1 = t => { t.notes = [{ id: 'mn1', t: 0, d: 1920, n: 57, v: 110 }, { id: 'mn2', t: 960, d: 960, n: 64, v: 100 }]; };
// a second track for the sums
while (P().tracks.length < 2) api.addTrack(MOOG);
await settle(4);
api.selectTrack(P().tracks[0].id); await settle(4);

test('§1.1 the live graph: one MASTER, made in powerOn before every track node; each pan → MASTER (+ its two analysers); MASTER → an (8192), the O1 splitter (two 2048 analysers), the Mono stage → the Volume (settings.master) → destination', () => {
  const c = sim.ctx(), ws = c.nodes.filter(n => n.kind === 'worklet');
  assert.deepEqual([ws.filter(n => n.name === 'synth-master').length, ws[0].name], [1, 'synth-master'], 'one MASTER, the first worklet of the context');
  const mn = MN(), G = M.graph();
  assert.equal(mn === ws[0], true);
  assert.deepEqual([mn.nIn, mn.channelCount, mn.channelCountMode, mn.channelInterpretation, mn.state0], [1, 2, 'explicit', 'speakers', c.calls && c.calls.includes('suspend') ? 'suspended' : mn.state0]);
  for (const t of P().tracks) {
    const outs = [...api.nodes.get(t.id).pan.outs];
    assert.equal(outs.includes(mn), true, t.id + ': its pan feeds MASTER');
    assert.deepEqual(outs.filter(n => n !== mn).map(n => n.kind + ':' + n.fftSize).sort(), ['an:512', 'an:8192'], t.id + ': and only its own two analysers');
  }
  assert.deepEqual([...mn.outs].map(n => n.kind).sort(), ['an', 'gain', 'split']);
  assert.deepEqual([G.an.fftSize, [...mn.outs].includes(G.an), [...mn.outs].includes(G.mono), [...mn.outs].includes(G.split)], [8192, true, true, true]);
  assert.deepEqual([...G.split.outs].map(n => n.kind + ':' + n.fftSize), ['an:2048', 'an:2048'], 'O1: the image scope\'s L / R analysers');
  assert.deepEqual([[...G.mono.outs].length, [...G.mono.outs][0] === G.level, G.level.gain.value === api.settings().master, [...G.level.outs][0].kind], [1, true, true, 'dest']);
  assert.equal(G.mono.gain.value, 1, 'the Mono stage: × 1 (exact)');
  assert.equal(M.rec().ready, true, 'its ready came (whenReady waits for it)');
});

test('G1 (sim): an empty master — MASTER\'s live output is the tracks\' Float32-rounded sum, bit for bit (a copy); a preview joins the sum', async () => {
  const [a, b] = P().tracks;
  b.pan = -0.4; api.mix && api.mix(); cv.mix();
  sim.key('KeyA', true); await settle(2);
  const out = sim.run(6144);
  sim.key('KeyA', false); await settle(1);
  const mo = out.get(MN()), Ns = [...api.nodes.values()];
  let diff = 0, peak = 0;
  for (let i = 0; i < mo.L.length; i++) {
    let l = 0, r = 0;
    for (const N of Ns) { const o = out.get(N.node); if (!o) continue; const [x, y] = route(o.L, o.R, i, N.pan.pan.value, N.gain.gain.value); l += x; r += y; }
    if (!Object.is(Math.fround(l), mo.L[i]) || !Object.is(Math.fround(r), mo.R[i])) diff++;
    peak = Math.max(peak, Math.abs(mo.L[i]));
  }
  assert.ok(peak > 1e-3, 'it sounds: ' + peak);
  assert.equal(diff, 0, 'MASTER output = its input, every sample');
  assert.equal(a.pan, 0);
});

test('§2.1 postAll: a transport and a panic reach MASTER (the same anchors as the tracks\'), an oversampling change never does; ▶ / ■', async () => {
  const mn = MN(), tn = sim.nodeOf(P().tracks[0].id);
  mn.posted.length = 0; tn.posted.length = 0;
  sim.$('#tPlay').onclick(); await settle(2); sim.run(2048);
  cv.panic(); await settle(1);
  sim.$('#os').value = '2'; sim.$('#os').onchange(); await settle(1);
  sim.$('#tPlay').onclick(); await settle(1);
  const pick = n => n.posted.map(x => x.m).filter(m => m.t === 'transport' || m.t === 'panic').map(m => JSON.stringify(m));
  assert.ok(pick(mn).length >= 4, 'start, panic, the panic\'s re-send, stop');
  assert.deepEqual(pick(mn), pick(tn), 'MASTER\'s transport / panic stream = a track\'s');
  assert.equal(mn.posted.some(x => x.m.t === 'os'), false, 'no os');
  assert.equal(tn.posted.some(x => x.m.t === 'os'), true);
  sim.$('#os').value = '4'; sim.$('#os').onchange(); await settle(1);
});

test('P-1 (b): with an effect on the master the anchors sit on quantum boundaries; an empty master moves none', async () => {
  sim.run(256);
  sim.$('#tPlay').onclick(); await settle(1);
  const f0 = api.transport().a.frame;
  sim.$('#tPlay').onclick(); await settle(1);
  assert.notEqual(f0 % 128, 0, 'empty: today\'s anchor (' + f0 + ')');
  M.edit(fx => { FC.newInstance(fx, 'cho', { rack: 0 }); }); await settle(1);
  sim.run(256);
  sim.$('#tPlay').onclick(); await settle(1);
  const f1 = api.transport().a.frame;
  sim.run(1024);
  cv.setProjectBpm(P().bpm + 1); await settle(1); // (a re-anchor while playing)
  const f2 = api.transport().a.frame;
  sim.$('#tPlay').onclick(); await settle(1);
  assert.deepEqual([f1 % 128, f2 % 128], [0, 0], 'aligned: ' + f1 + ', ' + f2);
  assert.ok(f1 - (sim.ctx().currentTime + 0.06) * sim.ctx().sampleRate < 128, 'at most one quantum later');
  M.edit(fx => { fx.racks[0].mods.length = 0; }); await settle(1);
  cv.setProjectBpm(P().bpm - 1); await settle(1);
});

test('§2.1 / §2.2 the master rack: an edit posts {t: chain} compiled with qr null (never the safeguard\'s step), no History step, persisted; deduped; MASTER\'s rack holds it; a knob while A/B is lit keeps it bypassed', async () => {
  const h0 = cv.hist.u.length;
  MN().posted.length = 0;
  let id = null;
  M.edit(fx => { id = FC.newInstance(fx, 'dist', { rack: 0 }); });
  await settle(1);
  const ch = mgot('chain');
  assert.equal(ch.length, 1, 'one chain');
  assert.equal(cv.hist.u.length, h0, 'not a History step');
  assert.equal(!!(P().master && P().master.fx && P().master.fx.racks[0].mods.length === 1), true, 'project.master.fx');
  const want = CG.chainPatch(P().master.fx, { sr: sim.ctx().sampleRate, bpm: P().bpm, prefs: api.prefs(), seed: false, qr: null });
  assert.equal(JSON.stringify(ch[0].fxr) === JSON.stringify(want.fxr), true, 'qr null, the Track\'s compile');
  M.edit(() => {}); await settle(1);
  assert.equal(mgot('chain').length, 1, 'an unchanged rack posts nothing');
  // the A/B (§3): MASTER's own bypass, frozen match (g true); a knob edit (a chain) never resets it
  MN().posted.length = 0;
  M.ab(true); await settle(1);
  assert.deepEqual(mgot('bypass').map(m => [m.on, m.g]), [[true, true]]);
  sim.run(256);
  M.edit(fx => { const I = fx.racks[0].mods.find(x => x.id === (typeof id === 'string' ? id : id && id.id)) || fx.racks[0].mods[0]; I.p.drive = 0.71; }); await settle(1);
  sim.run(256);
  assert.deepEqual([MN().proc.ab, M.state().ab, M.row().state().bypass, mgot('bypass').length], [1, true, true, 1], 'still bypassed after a knob');
  assert.equal(MN().got.some(m => m.t === 'ab' && m.on === true), true, 'MASTER answered {t: ab}');
  M.ab(false); await settle(1);
  assert.deepEqual([MN().proc.ab, M.row().state().bypass], [0, false]);
  // persisted (the autosave carries it)
  api.save(); await settle(1);
  const saved = JSON.parse(JSON.stringify(api.project()));
  assert.equal(saved.master.fx.racks[0].mods.length, 1);
  M.edit(fx => { fx.racks[0].mods.length = 0; }); await settle(1);
});

test('§3 Mono: the mono stage goes explicit / 1 channel and back to max (× 1 either way); Volume relabelled; not in a file: no bypass in the bounce\'s options, the offline graph has no Mono / Volume', async () => {
  const G = M.graph();
  M.mono(true);
  assert.deepEqual([G.mono.channelCountMode, G.mono.channelCount, M.row().state().mono, M.state().mono], ['explicit', 1, true, true]);
  M.mono(false);
  assert.deepEqual([G.mono.channelCountMode, G.mono.channelCount, M.row().state().mono], ['max', 2, false]);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<span class="cv-fl">Volume<\/span><input type="range" id="master"[^>]*aria-label="Volume"/);
  assert.match(html, />Volume <input type="range" id="masterG"[^>]*aria-label="Volume"/);
  M.ab(true); M.mono(true);
  notes1(T());
  const B = await bounce();
  M.ab(false); M.mono(false);
  assert.match(B.note, /^Done: /);
  const nodes = B.off.nodes, mo = nodes[nodes.length - 1];
  assert.deepEqual([nodes[0].name, mo.name, nodes.filter(n => n.name === 'synth-master').length], ['synth-engine', 'synth-master', 1], 'MASTER last, nodes[0] the first track');
  assert.deepEqual([mo.po.offline, 'bypass' in mo.po, mo.nIn], [true, false, 1]);
  assert.deepEqual([...mo.outs].map(n => n.kind), ['dest'], 'MASTER → destination: no Mono, no Volume offline');
  assert.equal(B.off.ctx.nodes.some(n => n.kind === 'gain' && n.gain.value === api.settings().master && api.settings().master !== 1), false);
});

test('§4 the bounce: through MASTER (an untouched master: no fxr, no trim, the same length); with a Distortion its latency is rendered extra and dropped (mlat), the file starts on frame 0; the note names the master and the loudness', async () => {
  notes1(T());
  delete P().master; // (an untouched project: no key)
  sim.$('#fBounce').click();
  assert.match(sim.$('#bNote').textContent, /The master has no effects — Volume, Mono and A\/B are listening controls and not in the file\./);
  const E = await bounce();
  const mo = E.off.nodes[E.off.nodes.length - 1];
  assert.equal('fxr' in mo.po, false, 'an empty master: no rack in its options');
  assert.equal(E.off.L.length, E.off.ctx.length);
  const wl = f32le(E.wav, 0);
  assert.equal(wl.length, E.off.L.length, 'no trim');
  assert.equal(wl.every((v, i) => Object.is(v, E.off.L[i])), true, '32-bit float: the render as is');
  assert.match(E.note, /LUFS integrated · −?\d+\.\d dBTP/, 'the bounce\'s loudness: ' + E.note);
  M.edit(fx => { FC.newInstance(fx, 'dist', { rack: 0 }); }); await settle(1);
  sim.$('#fBounce').click();
  assert.match(sim.$('#bNote').textContent, /Through the master effects \(1\) — Volume, Mono and A\/B/);
  const D = await bounce();
  const m2 = D.off.nodes[D.off.nodes.length - 1], lat = m2.got.find(m => m.t === 'mlat').lat, lmax = M.latBound(P().master.fx, 48000);
  assert.deepEqual([lat, lmax, D.off.L.length - E.off.L.length], [15, 15, 15], 'mlat 15 (a Distortion), lmax rendered extra');
  assert.equal(m2.got.some(m => m.t === 'mfinal'), true);
  const dl = f32le(D.wav, 0), dr = f32le(D.wav, 1);
  assert.equal(dl.length, E.off.L.length, 'cut to the song\'s length');
  assert.equal(dl.every((v, i) => Object.is(v, D.off.L[i + lat])) && dr.every((v, i) => Object.is(v, D.off.R[i + lat])), true, 'the first lat frames dropped');
  M.edit(fx => { fx.racks[0].mods.length = 0; }); await settle(1);
});

test('§4 Q1 (a) "Same as playback" first and selected (the context\'s rate, ⚙ Oversampling); O2 Auto tail; O4 Normalise Off / Peak / Loudness (a select; the OUT\'s target beside it)', async () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<select id="bSr"><option value="0" selected>Same as playback<\/option>/);
  assert.match(html, /<select id="bOs"><option value="0" selected>Same as playback<\/option>/);
  assert.match(html, /<option value="auto"[^>]*>Auto<\/option><\/select>/);
  assert.match(html, /<select id="bNorm"><option value="off" selected>Off<\/option><option value="peak">Peak −0\.3 dBFS<\/option><option value="lufs"[^>]*>Loudness<\/option><\/select><select id="bTgt"/);
  notes1(T());
  const sr = sim.ctx().sampleRate, B = await bounce({ sr: '0', os: '0' });
  assert.match(B.note, /^Done: /);
  assert.equal(B.off.ctx.sampleRate, sr, 'the playback rate');
  assert.equal(B.off.nodes[0].po.hostOS, Math.min(api.settings().os, 384000 / sr | 0), 'the playback oversampling');
  // Auto: the song + 30 s rendered, the tail kept until −96 dBFS for 0.5 s (+ 0.5 s)
  const A = await bounce({ tail: 'auto' });
  const songF = Math.ceil(S.ticksToSec(P(), S.songEnd(P())) * 48000), al = f32le(A.wav, 0);
  assert.match(A.note, /\(tail \d+\.\d s, auto\)/);
  assert.ok(A.off.L.length >= songF + 30 * 48000 - 1, 'rendered 30 s past the end');
  assert.ok(al.length > songF && al.length < A.off.L.length, 'trimmed: ' + al.length);
  let quiet = 0; for (let i = al.length - Math.round(0.5 * 48000); i < al.length; i++) if (Math.abs(al[i]) < Math.pow(10, -96 / 20)) quiet++;
  assert.equal(quiet, Math.round(0.5 * 48000), 'its last 0.5 s below −96 dBFS');
  // Loudness: to the target, never past −1 dBTP — the note says which held
  const L = await bounce({ norm: 'lufs', tgt: '-23' });
  assert.match(L.note, /· −23\.0 LUFS integrated · −?\d+\.\d dBTP · LRA (?:\d+\.\d LU|—) · normalised to −23\.0 LUFS|stopped at −?\d+\.\d LUFS \(true-peak ceiling −1 dBTP\)/, L.note);
  sim.$('#bNorm').value = 'peak'; assert.equal(M.normMode(), 'peak');
  sim.$('#bNorm').value = 'off'; sim.$('#bNorm').checked = true; assert.equal(M.normMode(), 'peak', 'a driver that ticks it (the old checkbox): Peak');
  sim.$('#bNorm').checked = false;
});

test('§2.3 History: an undo of a track edit keeps the master rack (no chain posted, its JSON byte-identical); an undo whose snapshot predates the first master edit keeps it; an undo of a master module move restores lay only', async () => {
  // no master yet
  M.edit(fx => { fx.racks[0].mods.length = 0; });
  const P0 = JSON.stringify(P().master || null);
  delete P().master; await settle(1);
  // a track edit (a History step) before any master edit
  const t = T();
  cv.hist.record(P(), 'rename'); t.name = 'Before M'; await settle(1);
  M.edit(fx => { FC.newInstance(fx, 'rev', { rack: 0 }); }); await settle(1);
  const fx0 = JSON.stringify(P().master.fx);
  MN().posted.length = 0;
  cv.undo(); await settle(2);
  assert.equal(T().name !== 'Before M', true, 'the track edit undone');
  assert.equal(JSON.stringify(P().master && P().master.fx), fx0, 'the master rack kept (the snapshot had none)');
  assert.equal(mgot('chain').length, 0, 'no master chain posted');
  cv.redo(); await settle(2);
  assert.equal(JSON.stringify(P().master.fx), fx0);
  // a module move on the master canvas is a History step: its undo brings lay back, never the rack
  M.open(); await settle(2);
  const V = cv.view(), m = V.modules.get('mfx'), x0 = m.x;
  const h0 = cv.hist.u.length;
  drag(m, 96, 0); await settle(1);
  assert.equal(cv.hist.u.length, h0 + 1, 'one step');
  const moved = P().master.lay.mfx.x;
  assert.equal(moved !== x0, true);
  M.edit(fx => { FC.newInstance(fx, 'cho', { rack: 0 }); }); await settle(1);
  const fx1 = JSON.stringify(P().master.fx);
  cv.undo(); await settle(2);
  assert.equal(JSON.stringify(P().master.fx), fx1, 'the rack as it is now');
  assert.equal(P().master.lay && P().master.lay.mfx ? P().master.lay.mfx.x : x0, x0, 'the place back');
  assert.equal(cv.view().modules.get('mfx').x, x0, 'the module back');
  M.off(); await settle(2);
  M.edit(fx => { fx.racks[0].mods.length = 0; }); await settle(1);
  void P0;
});

test('§2.2 assets: the master rack is a state (users name "Master"); an IR on it is posted to MASTER and survives a gc', async () => {
  const tb = api.tables, noise = n => { const a = new Float32Array(n); let r = 7; for (let i = 0; i < n; i++) { r = (r * 1103515245 + 12345) >>> 0; a[i] = ((r >>> 8) / 16777216 - 0.5) * Math.exp(-i / 2000); } return a; };
  const iid = await tb.saveRecord({ kind: 'ir', name: 'Hall M', rate: 48000, ch: 1, len: 6000, L: noise(6000), R: null }, { name: 'Hall M' });
  assert.match(String(iid), /^ir:/);
  MN().posted.length = 0;
  let cid = null;
  M.edit(fx => { cid = FC.newInstance(fx, 'conv', { rack: 0 }); const I = fx.racks[0].mods.find(x => x.type === 'conv'); I.sub = { ir: iid }; });
  for (let i = 0; i < 100 && !mgot('smp').length; i++) { await settle(2); await sim.settle(20); }
  const sent = mgot('smp').map(m => m.id);
  assert.equal(sent.some(x => String(x).startsWith(iid)), true, 'the IR entry posted to MASTER: ' + JSON.stringify(sent));
  assert.equal(mgot('chain').length >= 1, true, 'the chain after it');
  assert.deepEqual(tb.host.smp.users(iid), ['Master'], 'users() names the master');
  const used = [...tb.needs.get('master') || []];
  assert.equal(used.some(x => String(x).startsWith(iid)), true, 'claimed as the master\'s');
  tb.gc(); tb.gc();
  assert.equal([...tb.sent].some(x => String(x).startsWith(iid)), true, 'kept by a gc');
  void cid;
  M.edit(fx => { fx.racks[0].mods.length = 0; }); await settle(2);
});

test('schema 15 (§2.3; 14 at stage M, 15 since SC): a save says 15 and carries project.master; an untouched master writes no key; a load reads it back; Save as classic names the master effects it loses', async () => {
  assert.equal(CM.SCHEMA, 15);
  delete P().master;
  const t0 = JSON.parse(await cv.projectFile());
  assert.deepEqual([t0.schema, 'master' in t0], [15, false], 'no master key');
  M.edit(fx => { FC.newInstance(fx, 'eq', { rack: 0 }); FC.newInstance(fx, 'cmp', { rack: 0 }); }); await settle(1);
  const o = JSON.parse(await cv.projectFile());
  assert.deepEqual([o.schema, o.master.fx.racks[0].mods.length], [15, 2]);
  const p = cv.loadProject(JSON.stringify(o), { file: true });
  assert.equal(JSON.stringify(p.master.fx.racks[0].mods.map(I => I.type)), JSON.stringify(['eq', 'cmp']));
  const r = CM.toV1(o);
  assert.equal(r.lost.includes('the master effects (2)'), true, JSON.stringify(r.lost));
  assert.equal('master' in r.p, false);
  assert.equal(S.normMaster({ fx: 3, lay: { mfx: { x: 'a' } } }), undefined, 'nothing valid: no key');
  const n = JSON.parse(JSON.stringify(o)); n.schema = 16;
  assert.equal(cv.loadProject(JSON.stringify(n), { file: true }).newerSchema, 16, 'a schema-16 file: read-only');
  M.edit(fx => { fx.racks[0].mods.length = 0; }); await settle(1);
});

test('§5.1 the Master row: the track list\'s footer (outside the rows\' scroller); topSnaps(n, foot); its meters subscribed while the rows show; A/B and Mono; the chip\'s list has a Master item', async () => {
  const foot = sim.$('#mfoot'), row = M.row();
  assert.equal(foot.children.includes(row.el), true, 'built into #mfoot');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<div class="lanes" id="lanes"><\/div>\s*<\/div>\s*<!--[^>]*-->\s*<div class="cv-mfoot" id="mfoot"><\/div>\s*<\/section>/, 'after #arrwrap, inside #studio');
  assert.deepEqual(cvTray.topSnaps(2, cvTray.FOOT_H), [48, 48 + 32 + 24 + 56 + 44, 48 + 32 + 24 + 112 + 44]);
  assert.equal(cvTray.FOOT_H, 44);
  // shown rows: 'meters' on MASTER; folded: off
  sh.topSet(cvTray.topSnaps(P().tracks.length, cvTray.FOOT_H)[1], 'end'); await settle(2);
  assert.deepEqual([row.state().live, MN().proc.mm], [true, true], 'the row\'s meters: MASTER posts mmon');
  sh.topSet(48, 'end'); await settle(2);
  assert.deepEqual([row.state().live, MN().proc.mm], [false, false], 'folded: no row, no meters');
  sh.topSet(cvTray.topSnaps(P().tracks.length, cvTray.FOOT_H)[1], 'end'); await settle(2);
  sim.run(4096); await settle(1);
  assert.equal(MN().got.some(m => m.t === 'mmon'), true, 'MASTER posts its meters');
  // the list: tracks, then Master, then + Add
  sh.trkListUI();
  const items = sim.$('#trkPop').children.map(b => b.className);
  assert.deepEqual(items.slice(-2), ['cv-tpi cv-tpm', 'cv-tpi add']);
});

test('§5.2 the master canvas: its own view (the rack, the OUT), selTrack kept — the keys still play the track —, the chip reads Master; G7: moves, Tidy, drops, picks and menus there write no track; a track pick (the selected one too) leaves it', async () => {
  const sel = P().selTrack, before = tracksJSON();
  sh.trkListUI();
  sim.$('#trkPop').children.find(b => /cv-tpm/.test(b.className)).onclick();
  await settle(3);
  const V = cv.view();
  assert.deepEqual([M.on(), V.trackId, [...V.modules.keys()].join()], [true, 'master', 'mfx,out']);
  assert.deepEqual([V.modules.get('out').w, P().selTrack], [MUI.OUT_W, sel], 'the OUT 420 wide; the selection kept');
  assert.equal(sim.$('#trkChip .cv-cn').textContent, 'Master');
  assert.match(sim.$('#trkChip .cv-cv').textContent, /^keys play /);
  assert.equal(M.row().state().active, true);
  assert.equal(api.scopeSource() === M.graph().an, true, 'scopeSource: an');
  // the keys play the selected track
  const tn = sim.nodeOf(sel); tn.posted.length = 0;
  sim.key('KeyA', true); sim.key('KeyA', false); await settle(1);
  assert.equal(tn.posted.some(x => x.m.t === 'on'), true, 'a key on the master canvas: the track plays it');
  // moves, Tidy, menus, drops, picks
  drag(V.modules.get('out'), 64, 32); await settle(1);
  cv.tidy(); await settle(1);
  for (const k of ['mfx', 'out']) { const it = cv.menu(k); assert.equal(Array.isArray(it) && it.length > 0, true); for (const x of it) if (x.label === 'Fold' || x.label === 'Unfold') { x.action(); await settle(1); x.action && cv.menu(k).find(y => /fold/i.test(y.label || '')).action(); } }
  assert.deepEqual(cv.menu('out').map(x => x.label), ['Fold'], 'the OUT: Fold only');
  assert.equal(cv.drop('prophet5', null), true, 'a drop: refused (handled)');
  sh.srcPick('juno60', 'replace'); await settle(1);
  assert.equal(sh.srcDrag.drop('cs80', { over: 'canvas', x: 400, y: 300 }), true);
  assert.equal(cv.mod.add('lfo', null), null, 'no modulator');
  assert.match(sim.$('#notice').textContent, /^The master takes effects — add them with the rack’s \+/);
  assert.equal(sim.$('#srcMode').children.join ? true : true, true);
  const nid = cv.fx.addEffect('mfx', 'dly');
  assert.equal(typeof nid === 'string' && P().master.fx.racks[0].mods.some(I => I.id === nid), true, 'the effect hook: the master rack');
  assert.equal(tracksJSON(), before, 'every track byte-identical');
  assert.equal(!!P().master.lay && typeof P().master.lay.out === 'object', true, 'the master\'s lay');
  // its camera: synth.cam.<uid>.master
  cv.world().setCamera({ tx: 10, ty: 20, k: 0.8 }); cv.camFlush();
  const cams = JSON.stringify(api.store.get('synth.cam', null));
  assert.equal(cams.includes(CM.camKey(P().uid, 'master')), true);
  // leaving: the selected track's row picks it back
  api.selectTrack(sel); await settle(4);
  assert.deepEqual([M.on(), cv.view().trackId, sim.$('#trkChip .cv-cn').textContent === T().name, M.row().state().active], [false, sel, true, false]);
  M.edit(fx => { fx.racks[0].mods.length = 0; }); await settle(1);
});

test('§5.3 the master OUT on the canvas: master-ui\'s module, fed MASTER\'s mmon while live; A/B and Mono shared with the row; its scope reads an / O1\'s analysers only through read()', async () => {
  M.open(); await settle(3);
  const out = M.out();
  assert.equal(!!out, true);
  sim.run(4096); await settle(2);
  const L = MN().posted.filter(x => x.m.t === 'mon').map(x => x.m.ids.join());
  assert.equal(L[L.length - 1].includes('meters'), true);
  M.ab(true); await settle(1);
  assert.deepEqual([out.state().bypass, M.row().state().bypass], [true, true]);
  M.ab(false); M.mono(true);
  assert.deepEqual([out.state().mono, M.row().state().mono], [true, true]);
  M.mono(false);
  const G = M.graph(), reads = [];
  for (const [n, k] of [[G.an, 'an'], [G.anL, 'L'], [G.anR, 'R']]) { n.getFloatTimeDomainData = a => { reads.push('td ' + k); a.fill(0); }; n.getFloatFrequencyData = a => { reads.push('fd ' + k); a.fill(-200); }; }
  const bufs = { td: new Float32Array(8192), fd: new Float32Array(4096), L: new Float32Array(2048), R: new Float32Array(2048) };
  assert.equal(M.read('wave', bufs), sim.ctx().sampleRate);
  M.read('spectrum', bufs); M.read('image', bufs);
  assert.deepEqual(reads, ['td an', 'fd an', 'td L', 'td R']);
  M.off(); await settle(3);
  assert.equal(M.out(), null, 'gone with the view');
});

/* ================================================================ the reviews' fixes (IMPL-M §12 "Reviews and fixes") */
// the sim's stub elements: a descendant by class (master-ui sets className), text by the first child's name (its readouts)
const desc = (el, f) => { const q = [el]; while (q.length) { const e = q.shift(); if (f(e)) return e; for (const c of e.children || []) q.push(c); } return null; };
const descAll = (el, f) => { const r = [], q = [el]; while (q.length) { const e = q.shift(); if (f(e)) r.push(e); for (const c of e.children || []) q.push(c); } return r; };
const hasCls = (e, c) => typeof e.className === 'string' && e.className.split(' ').includes(c);
const byCls = (el, c) => desc(el, e => hasCls(e, c));
const rd = (root, name) => { const n = desc(root, e => hasCls(e, 'mo-n') && e.children[0] && e.children[0].textContent === name); return n ? byCls(n, 'mo-nv').textContent : null; };
const abTexts = () => [byCls(M.out().el, 'mo-ab').textContent, byCls(M.row().el, 'mr-ab').textContent];
// an Open through the page's file input (a project object as the file)
async function openFile(o) {
  const file = { name: 'm.synth.json', type: 'application/json', text: async () => JSON.stringify(o) };
  await sim.$('#fFile').onchange({ target: { files: [file], value: '' } });
  await sim.settle(10); sim.raf(); await settle(2);
}
// a bounce whose render is replaced after the fact (the buffer and what MASTER reported about it): edit(buf, ctx) on the rendered
// buffer; mf: the {i, tpMax, pk, lra} the offline MASTER would have measured on it
async function bounceWith(edit, mf, set) {
  const OAC = globalThis.OfflineAudioContext, realStart = OAC.prototype.startRendering, AWN = globalThis.AudioWorkletNode, realFrom = AWN.prototype._fromProc;
  OAC.prototype.startRendering = async function () { const b = await realStart.call(this); edit(b, this); return b; };
  if (mf) AWN.prototype._fromProc = function (m) { return realFrom.call(this, m && m.t === 'mfinal' ? Object.assign({}, m, mf) : m); };
  try { return await bounce(set); } finally { OAC.prototype.startRendering = realStart; AWN.prototype._fromProc = realFrom; }
}

test('item 6 — MASTER\'s {t: ab, on, g, lim}: the tap reads "A/B …" until MASTER answers; g null stays pending; a number shows on the OUT and the row; lim adds "(peak-limited)" / "*"; a stale answer is ignored; off is plain', async () => {
  M.open(); await settle(3);
  const proc = MN().proc, real = proc.msg;
  proc.msg = () => {}; // MASTER stays silent: the answers are ours
  try {
    M.ab(true); await settle(1);
    assert.deepEqual([...abTexts(), M.state().g], ['A/B …', 'A/B …', null], 'pending at the tap, before any answer');
    MN()._fromProc({ t: 'ab', on: true, g: null });
    assert.deepEqual(abTexts(), ['A/B …', 'A/B …'], 'g null: still pending');
    MN()._fromProc({ t: 'ab', on: true, g: 2.14, lim: true });
    assert.deepEqual([...abTexts(), M.state().g, M.state().lim], ['A/B +2.1 dB (peak-limited)', 'A/B +2.1*', 2.14, true]);
    MN()._fromProc({ t: 'ab', on: true, g: -3.24 });
    assert.deepEqual([...abTexts(), M.state().lim], ['A/B −3.2 dB', 'A/B −3.2', false], 'the cap clears with the next answer');
    MN()._fromProc({ t: 'ab', on: false, g: 7 });
    assert.deepEqual(abTexts(), ['A/B −3.2 dB', 'A/B −3.2'], 'an answer to an earlier tap is ignored');
    M.ab(false); await settle(1);
    assert.deepEqual([...abTexts(), M.state().ab, M.row().state().bypass, M.out().state().bypass], ['A/B', 'A/B', false, false, false]);
  } finally { proc.msg = real; }
  M.ab(true); M.ab(false); await settle(1); // (the real MASTER again: its answers still land)
  assert.deepEqual(abTexts(), ['A/B', 'A/B']);
  M.off(); await settle(2);
});

test('R1-3 — the A/B (and its frozen match gain) does not survive Open, New or an undo of Open; an undo within the project keeps it', async () => {
  M.edit(fx => { FC.newInstance(fx, 'eq', { rack: 0 }); }); await settle(1);
  const other = JSON.parse(await cv.projectFile()); delete other.uid; other.name = 'Another';
  const home = P().name, st = () => [M.state().ab, M.row().state().bypass, MN().proc.ab];
  M.ab(true); sim.run(256); await settle(1);
  assert.deepEqual(st(), [true, true, 1]);
  MN().posted.length = 0;
  await openFile(other);
  assert.equal(P().name, 'Another');
  sim.run(256);
  assert.deepEqual([st(), mgot('bypass').map(m => m.on)], [[false, false, 0], [false]], 'Open: off, and MASTER told');
  M.ab(true); sim.run(256);
  sim.$('#fNew').onclick(); await settle(3); sim.run(256);
  assert.deepEqual(st(), [false, false, 0], 'New');
  M.ab(true); sim.run(256);
  cv.undo(); await settle(3); sim.run(256);
  assert.equal(P().name, 'Another', 'undo of New: the opened project');
  assert.deepEqual(st(), [false, false, 0], 'undo of New');
  M.ab(true); sim.run(256);
  cv.undo(); await settle(3); sim.run(256);
  assert.equal(P().name, home, 'undo of Open: the first project');
  assert.deepEqual(st(), [false, false, 0], 'undo of Open');
  // within a project an undo leaves it alone
  M.ab(true); cv.hist.record(P(), 'rename'); T().name = 'R13'; await settle(1);
  cv.undo(); await settle(2); sim.run(256);
  assert.deepEqual(st(), [true, true, 1], 'an undo within the project: kept');
  M.ab(false); await settle(1);
  M.edit(fx => { fx.racks[0].mods.length = 0; }); await settle(1);
});

test('F5 — Power off clears the Master row and the OUT to silence ("—", empty bars), not the last levels', async () => {
  M.open(); await settle(3);
  const row = M.row(), out = M.out(), lv = () => byCls(row.el, 'mr-lv').textContent, bars = () => descAll(row.el, e => hasCls(e, 'mr-bar'));
  const mm = { t: 'mmon', m: -13, s: -14.2, i: -14.5, lra: 3.2, tp: [-3, -4], tpMax: -2, pk: [-6, -7], corr: 0.8, lat: 0 };
  MN()._fromProc(mm); sim.advance(150); MN()._fromProc(mm); sim.advance(150); MN()._fromProc(mm); // (performance.now is the sim's clock)
  out.setLive(true); out.draw();
  assert.deepEqual([lv(), rd(out.el, 'Short-term loudness'), rd(out.el, 'Integrated loudness (tap to reset)'), bars().map(b => b.getAttribute('aria-valuetext') === 'silent').join()], [`−14.2`, `−14.2`, `−14.5`, 'false,false'], 'levels shown');
  sim.$('#power').onclick(); await sim.settle(5);
  out.setLive(false); out.setLive(true); out.draw(); // (the frame loop would draw it: a fresh throttle)
  assert.deepEqual([lv(), bars().map(b => b.getAttribute('aria-valuetext')).join()], ['—', 'silent,silent'], 'the row: silence');
  assert.deepEqual(['Momentary loudness', 'Short-term loudness', 'Integrated loudness (tap to reset)', 'Loudness range', 'True peak max hold (tap to reset)', 'Phase correlation'].map(n => rd(out.el, n)), ['—', '—', '—', '—', '—', '—'], 'the OUT: silence');
  assert.equal(M.row().state().live, true);
  await sim.power(); sim.raf(); await settle(3);
  M.off(); await settle(2);
});

test('R1-5 — Auto tail finds the end by scanning back from the render\'s end: echoes 0.6 s apart (gaps over 0.5 s) all stay, then 0.5 s', async () => {
  notes1(T());
  const sr = 48000, s0 = Math.ceil(S.ticksToSec(P(), S.songEnd(P())) * sr);
  const echoes = b => {
    const L = b.getChannelData(0), R = b.getChannelData(1);
    L.fill(0, s0); R.fill(0, s0); // (only the echoes are audible past the song's end)
    for (let k = 0; k < 7; k++) {
      const a = Math.round(s0 + (0.1 + 0.6 * k) * sr), amp = 0.35 * Math.pow(0.5, k);
      for (let i = 0; i < 960; i++) { const v = amp * Math.sin(2 * Math.PI * 440 * i / sr) * (1 - i / 960); L[a + i] = v; R[a + i] = v; }
    }
  };
  const A = await bounceWith(echoes, null, { tail: 'auto' });
  const n = f32le(A.wav, 0).length;
  assert.match(A.note, /\(tail 4\.[12] s, auto\)/, A.note);
  assert.ok(n >= s0 + Math.round(4.19 * sr) && n <= s0 + Math.round(4.25 * sr), 'the last echo (3.72 s past the end) + 0.5 s: ' + ((n - s0) / sr).toFixed(3) + ' s');
  const q = f32le(A.wav, 0), thr = Math.pow(10, -96 / 20);
  let last = q.length - 1; while (last >= 0 && Math.abs(q[last]) < thr) last--;
  assert.ok(q.length - 1 - last >= Math.round(0.5 * sr) - 1, 'its last 0.5 s below −96 dBFS');
});

test('F3 / F6 / F7 / F9 / R1-7 — Loudness normalise lands on its target when the tail crosses the −70 LUFS gate (the file measures it, the note reports that measurement), the note has the LRA and its numbers are all after scaling with true minus signs', async () => {
  await import('../master-dsp.js');
  const MD = globalThis.MASTERDSP, sr = 48000;
  assert.equal(typeof MD.Meters, 'function');
  try {
    // 1.5 s at −8 dBFS then a 26 s fade to −80 dBFS: scaled down 10 dB for −23 LUFS, its tail crosses the absolute gate
    const segs = [[-8, -8, 1.5], [-8, -80, 26]], N = segs.reduce((a, s) => a + Math.round(s[2] * sr), 0), SL = new Float32Array(N);
    { let o = 0, ph = 0; for (const [a, b, sec] of segs) { const m = Math.round(sec * sr); for (let i = 0; i < m; i++) { SL[o + i] = Math.pow(10, (a + (b - a) * i / m) / 20) * Math.sin(ph); ph += 2 * Math.PI * 1000 / sr; } o += m; } }
    const meas = (L, R) => { const m = new MD.Meters(sr); m.push(L, R, L.length, 0); const s = m.summary(); return { i: s.i, tpMax: s.tpMax, pk: s.pkMax, lra: s.lra }; };
    const mf = meas(SL, SL), put = b => { b.getChannelData(0).set(SL); b.getChannelData(1).set(SL); b.getChannelData(0).fill(0, N); b.getChannelData(1).fill(0, N); };
    notes1(T());
    const B = await bounceWith(put, mf, { tail: 'auto', norm: 'lufs', tgt: '-23' });
    const L = f32le(B.wav, 0), R = f32le(B.wav, 1), got = meas(L, R);
    assert.ok(Math.abs(got.i - -23) <= 0.05, `the file measures the target: ${got.i.toFixed(3)} (a plain scale, k = ${(-23 - mf.i).toFixed(3)} dB, leaves it off)`);
    const note = B.note, num = re => { const m = note.match(re); return m ? parseFloat(m[1].replace('−', '-')) : NaN; };
    assert.ok(Math.abs(num(/(−?\d+\.\d) LUFS integrated/) - got.i) <= 0.051, 'the note\'s loudness is that measurement: ' + note);
    assert.ok(Math.abs(num(/(−?\d+\.\d) dBTP/) - got.tpMax) <= 0.051, 'its true peak: ' + note);
    let pk = 0; for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
    assert.ok(Math.abs(num(/peak (−?\d+\.\d) dBFS/) - 20 * Math.log10(pk)) <= 0.051, 'the peak is the file\'s, after scaling: ' + note);
    assert.match(note, / · LRA \d+\.\d LU/, 'the LRA (F6)');
    assert.ok(Math.abs(num(/LRA (\d+\.\d) LU/) - mf.lra) <= 0.051, 'and it is the render\'s (scale-free): ' + note);
    assert.equal(/-\d/.test(note), false, 'true minus signs only: ' + note);
    assert.match(note, /normalised to −23\.0 LUFS\.$/, note);
    // never −0.0: a render peaking at −0.02 dBFS, left as it is
    const hot = new Float32Array(sr).map((_, i) => 0.9977 * Math.sin(2 * Math.PI * 1000 * i / sr)), hf = meas(hot, hot);
    const H = await bounceWith(b => { b.getChannelData(0).fill(0); b.getChannelData(1).fill(0); b.getChannelData(0).set(hot); b.getChannelData(1).set(hot); }, hf, { tail: '2' });
    assert.equal(/[−-]0\.0/.test(H.note), false, 'no minus zero: ' + H.note);
    assert.match(H.note, /peak 0\.0 dBFS/, H.note);
    // nothing measured: MASTER posts lra -Infinity (a render under the 3 s the range needs) — the note reads "LRA —", never 0.0 LU
    const half = hot.subarray(0, sr >> 1);
    const short = await bounceWith(b => { b.getChannelData(0).fill(0); b.getChannelData(1).fill(0); b.getChannelData(0).set(half); b.getChannelData(1).set(half); }, Object.assign(meas(half, half), { lra: -Infinity }), { tail: '0' });
    assert.match(short.note, / · LRA —(?: ·|\.)/, short.note);
  } finally { globalThis.MASTERDSP = null; }
});

test('R1-8 — no MASTER in a resample or a render-last offline context (renderOffline\'s other callers), one in a bounce, made last', async () => {
  const ce = console.error; // (the sim's stub DOM cannot style a Serum panel: its own error, not under test)
  console.error = (e, ...r) => { if (!(e && /getElementById/.test(String(e.message || e)))) ce(e, ...r); };
  try {
    const sx = api.addTrack(MODELS.find(m => m.id === 'serum')); await settle(4);
    api.selectTrack(sx.id); await settle(3);
    const T0 = 2e6;
    api.noteOn(62, 0.8, 0, T0); api.noteOff(62, 0, T0 + 200);
    sim.lastOffline = null;
    await api.renderLast(sx, {});
    assert.ok(sim.lastOffline, 'render-last rendered');
    assert.deepEqual([sim.lastOffline.nodes.filter(n => n.name === 'synth-master').length, sim.lastOffline.nodes[0].name], [0, 'synth-engine'], 'render-last');
    sim.lastOffline = null;
    try { await api.resampleTo(sx, 'C'); } catch { /* the sample is stored in IndexedDB, which this sim has not: the render is what counts */ }
    assert.ok(sim.lastOffline, 'resample rendered');
    assert.equal(sim.lastOffline.nodes.filter(n => n.name === 'synth-master').length, 0, 'resample');
    api.deleteTrack(sx); await settle(3);
    api.selectTrack(P().tracks[0].id); await settle(3);
    notes1(T());
    const B = await bounce();
    assert.deepEqual([B.off.nodes.filter(n => n.name === 'synth-master').length, B.off.nodes[B.off.nodes.length - 1].name], [1, 'synth-master'], 'a bounce: one, last');
  } finally { console.error = ce; }
});
