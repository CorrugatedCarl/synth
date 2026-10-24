import './v8-guard.mjs';
// The page as the iPad app runs it, with hardware MIDI (lane S; IMPL-B §7 B3, §3.4 B5's page half): main.js booted as the
// WKWebView (a WebKit UA, synth://app, the marker SYNTH_SHELL) with app/ios/SYNTH/MidiShim.js evaluated on the sim's window before
// the import (main-sim's o.beforeImport — the app's document-start user script) and midi.js's REAL code path on it, against a
// fake native half: post replies ({ t: 'midi', on: true } → { ok, ports, gen, h } a timer later), SYNTH_SHELL.midiIn /
// midiPorts called as native's callAsyncJavaScript calls them. At boot: ready then midi on, no tap, the #midi button names the
// ports; notes → the engine's note path (held, the node's on / off); CC 1 → the wheel, bend; a Pads module's hardware learn
// and its light-back (canvas-8-sim's scenario on the real shim); a Serum MIDI learn; the hardware UI there (midiOk()); a
// hot-plug (and a second caller's own access — review 2 N4); the gate's release triple as plain MIDI (sustain up before the
// note's off, nothing held); B6: a MIDI note recorded at the shim's stamp, not its delivery (review 2 F5). Not here (lane W's):
// the ⚙ Bluetooth row and probe().midi. One boot; strings, numbers and booleans into assert (never a stub DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/app-midi-sim.test.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { bootMain } from './main-sim.mjs';
import { fakeStorage } from './fakes.mjs';
import * as CMOD from '../cv-model.js?v=9';
import * as PC from '../pads-core.js?v=9';
import { MODELS } from '../models.js?v=9';

const SHIM = readFileSync(new URL('../app/ios/SYNTH/MidiShim.js', import.meta.url), 'utf8');
const WK = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'; // (a WKWebView: no Version/… Safari/)
// the sim's timers are unref'd: a ref'd beat keeps the process up while the native half answers on a ref'd timer
const realTimeout = globalThis.setTimeout, keep = setInterval(() => {}, 1000);
after(() => clearInterval(keep));
// every DSP global wk.loadDSP waits for, defined (null): a host's load resolves at once (canvas-3-sim's rule)
for (const g of ['SxBase', 'SxFilt2', 'SxWarp', 'SxMod', 'SxSample', 'SxGran', 'SxSpec', 'SxSeq', 'SerumDSP', 'FXMods2', 'FXDSP', 'Dr808', 'DrSeq', 'ModCore', 'PatchDSP', 'PatchMoog', 'MASTERDSP']) globalThis[g] = null;
const VP = { left: 0, top: 48 }, BAND = { left: 44, top: 48, right: 1500, bottom: 1300 };
function scriptedWorld(root) { // (canvas-8-sim's)
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

/* ------------------------------------------------------------------ the native half (fake) */
// every post recorded (plain JSON); the 'midi' reply carries the port list, its gen and h (host ms: the page's clock + HOST);
// native → page as Midi.swift calls it: midiIn([h, dropped, uid, age, st, d1, d2 …]), midiPorts(list, gen)
const HOST = 7000, sent = [];
const PAD_IN = { id: '101', name: 'Pad Box', manufacturer: 'Test', type: 'input', state: 'connected' };
const OTHERS = { id: '-900', name: 'From other apps', manufacturer: '', type: 'input', state: 'connected' };
const PAD_OUT = { id: '201', name: 'Pad Box', manufacturer: 'Test', type: 'output', state: 'connected' };
let gen = 1, list = [PAD_IN, OTHERS, PAD_OUT];
const hostNow = () => performance.now() + HOST;
const SHELL = { os: 'ipados', idiom: 'pad', app: '0.1', build: '412', sha: 'abc1234', site: '9', restarted: false,
  post(m) {
    sent.push(JSON.parse(JSON.stringify(m)));
    if (m && m.t === 'midi') return new Promise(res => realTimeout(() => res({ ok: true, ports: list, gen, h: hostNow() }), 1));
    return Promise.resolve({ ok: true });
  } };
const midiIn = (uid, ...msgs) => SHELL.midiIn([hostNow(), 0, ...msgs.flatMap(b => [Number(uid), 0, b[0], b[1] || 0, b[2] || 0])]);
const ports = l => { list = l; SHELL.midiPorts(l, ++gen); };

const sim = await bootMain({ ua: WK, platform: 'MacIntel', touch: true, ls: fakeStorage({}), hash: '#minimoog',
  location: { protocol: 'synth:', hostname: 'app', host: 'app', href: 'synth://app/index.html' }, win: { SYNTH_SHELL: SHELL },
  synthTest: { cvWorld: root => scriptedWorld(root) },
  beforeImport: () => vm.runInThisContext(SHIM, { filename: 'MidiShim.js' }) }); // (the WKUserScript after the marker, at document start)
await sim.settle(30);
const api = sim.api, cv = globalThis.__synthTest.cv, sh = globalThis.__synthTest.shell;
const P = () => api.project(), T = () => P().tracks.find(t => t.id === P().selTrack);
const node = t => sim.nodeOf(t.id);
const msgs = (t, n0 = 0) => node(t).posted.slice(n0).map(x => x.m);
const settle = async (n = 2) => { for (let i = 0; i < n; i++) { sim.raf(); await sim.settle(3); } };
const H = () => cv.pads;
const mod = id => (P().pads || []).find(M => M.id === id) || null;
const walk = (n, f, out = []) => { for (const c of (n && n.children) || []) { if (f(c)) out.push(c); walk(c, f, out); } return out; };
const cls = n => String((n && (n.className || (n.attrs && n.attrs.class))) || '');

test('B3 boot as the app: the shim before any module (requestMIDIAccess a function, midiOk()), the posts ready THEN { t: \'midi\', on: true } during boot\'s settle with no tap, the #midi button naming the ports ("MIDI: Pad Box, From other apps", enabled, no unsup)', () => {
  const ts = sent.map(m => m.t);
  assert.deepEqual(sent.filter(m => m.t === 'midi'), [{ t: 'midi', on: true }], 'once');
  assert.equal(ts.indexOf('ready') >= 0 && ts.indexOf('ready') < ts.indexOf('midi'), true, `ready first (boot() is synchronous): ${ts.join(' ')}`);
  assert.equal(typeof globalThis.navigator.requestMIDIAccess, 'function');
  const b = sim.$('#midi');
  assert.deepEqual([b.textContent, b.title, b.disabled, b.classList.contains('unsup')], ['MIDI: Pad Box, From other apps', 'Connected MIDI inputs', false, false]);
  assert.deepEqual([api.midi.enabled, api.midi.inputs().join(), api.midi.outputs().join()], [true, 'Pad Box,From other apps', 'Pad Box'], '"From other apps" an input, never an output');
});

test('B3 notes through the shim: a note-on batch → held 1 and the selected track\'s node gets { t: \'on\', n: 60 }; its note-off clears it; "From other apps" plays too; CC 1 → { t: \'wheel\', v: 1 }; bend E0 7F 7F → { t: \'bend\' } ≈ 1, E0 00 40 → 0', async () => {
  await sim.power(); await settle(3);
  const t = T(), n0 = node(t).posted.length;
  midiIn(PAD_IN.id, [0x90, 60, 100]);
  assert.equal(SHELL.probe().held, 1);
  const on = msgs(t, n0).filter(m => m.t === 'on');
  assert.deepEqual([on.length, on[0] && on[0].n, on[0] && Math.round(on[0].v * 127)], [1, 60, 100]);
  midiIn(PAD_IN.id, [0x80, 60, 0]);
  assert.deepEqual([SHELL.probe().held, msgs(t, n0).filter(m => m.t === 'off').map(m => m.n).join()], [0, '60']);
  midiIn(OTHERS.id, [0x90, 64, 90], [0x80, 64, 0]);
  assert.deepEqual([msgs(t, n0).filter(m => m.t === 'on').map(m => m.n).join(), SHELL.probe().held], ['60,64', 0], 'the virtual destination "SYNTH" (another app) plays the same way');
  const n1 = node(t).posted.length;
  midiIn(PAD_IN.id, [0xb0, 1, 0], [0xb0, 1, 127], [0xe0, 0x7f, 0x7f]);
  const w = msgs(t, n1).filter(m => m.t === 'wheel').map(m => m.v), bd = msgs(t, n1).filter(m => m.t === 'bend').map(m => m.v);
  assert.deepEqual([w.join(), bd.length, bd[0] > 0.999], ['0,1', 1, true]);
  midiIn(PAD_IN.id, [0xe0, 0, 0x40]);
  assert.equal(msgs(t, n1).filter(m => m.t === 'bend').at(-1).v, 0);
});

test('B3 B5\'s page half: CC 64 127, a note-on, then the gate\'s release triple as plain MIDI (B0 40 00, E0 00 40, B0 7B 00) → { t: \'sus\', v: false } reaches the node before the note\'s { t: \'off\' }, nothing held', async () => {
  const t = T(), n0 = node(t).posted.length;
  midiIn(PAD_IN.id, [0xb0, 64, 127], [0x90, 62, 110], [0xe0, 0x10, 0x50]);
  assert.equal(SHELL.probe().held, 1);
  midiIn(PAD_IN.id, [0xb0, 64, 0], [0xe0, 0, 0x40], [0xb0, 123, 0]); // (native's closing batch for a sounding channel 1)
  const m = msgs(t, n0).map(x => (x.t === 'sus' ? 'sus:' + x.v : x.t === 'off' || x.t === 'on' ? x.t + ':' + x.n : x.t === 'bend' ? 'bend:' + (x.v === 0 ? 0 : 'x') : null)).filter(Boolean);
  assert.deepEqual(m, ['sus:true', 'on:62', 'bend:x', 'sus:false', 'bend:0', 'off:62']);
  assert.equal(SHELL.probe().held, 0, 'nothing stuck');
});

test('B3 a Pads module on the real shim (canvas-8-sim\'s scenario): midiOk() → the hardware menu item enabled and the inspector\'s learn row; learn → a note from the port named "Pad Box" → hw { port: \'Pad Box\', ch, n, cc: 0 } (one step); a hit plays the pad, nothing by its channel; its light-back → { t: \'midi-send\' } to the "Pad Box" output\'s id', async () => {
  sh.shell.tiles.setView('ctl');
  sh.shell.tiles.ctlTile('pads').dispatchEvent({ type: 'click' }); await settle(3);
  const M = mod('pd1');
  assert.equal(!!M, true, 'a tap placed pd1');
  const B = cv.padsBody('pd1'), item = B.menuItems().find(x => /^Hardware controller/.test(x.label));
  assert.deepEqual([item.label, !!item.disabled], ['Hardware controller…', false], 'Web MIDI present in the app (midiOk())');
  B.inspect(0); await settle();
  const pop = B.popover();
  assert.equal(!!pop && walk(pop, n => /pd-learn/.test(cls(n))).length > 0, true, 'the inspector\'s hardware learn row');
  B.edit(false); await settle();
  const i3 = PC.slotOfNo(M, 3), h0 = cv.hist.u.length;
  const learnt = H().learn('pd1', i3);
  midiIn(PAD_IN.id, [0x99, 100, 90]);
  const b = await learnt; await settle();
  assert.deepEqual([JSON.stringify(b), cv.hist.u.length - h0, cv.hist.undoLabel, JSON.stringify(mod('pd1').pads[i3].hw)],
    ['{"port":"Pad Box","ch":10,"n":100,"cc":0}', 1, 'Learn pad 3', '{"port":"Pad Box","ch":10,"n":100,"cc":0}']);
  H().edit('Pads 1: hardware lights', ps => { ps.find(m => m.id === 'pd1').out = { prof: 'gen', port: '' }; return ps; }, { id: 'pd1' }); await settle();
  const t = T(), n0 = node(t).posted.length, s0 = sent.length;
  const pn = (PC.resolve(mod('pd1').pads[i3], P(), cv.drumOf).hits[0] || {}).ns;
  midiIn(PAD_IN.id, [0x99, 100, 100]); sim.raf();
  const ons = msgs(t, n0).filter(m => m.t === 'on').map(m => m.n);
  assert.deepEqual([ons.join(), ons.includes(100)], [String(pn[0]), false], 'pad 3\'s note, not note 100 by channel 10');
  assert.deepEqual(sent.slice(s0).filter(m => m.t === 'midi-send')[0], { t: 'midi-send', id: PAD_OUT.id, b: [0x99, 100, 127], delay: 0 }, 'lit back through the shim\'s output');
  midiIn(PAD_IN.id, [0x89, 100, 0]); sim.raf();
  assert.equal(msgs(t, n0).some(m => m.t === 'off' && m.n === pn[0]), true, 'its note-off ends it');
});

test('B3 a hot-plug through midiPorts: the pad port unplugged → the button, inputs() and the Pads host\'s ports follow; back → listed again (the same port object, midi.js re-hooked: a note plays again); a second caller (N4) gets its own access — its ports closed, none of midi.js\'s handlers — and its own handler never replaces midi.js\'s', async () => {
  const A = await globalThis.navigator.requestMIDIAccess(), p = A.inputs.get(PAD_IN.id);
  assert.deepEqual([p.connection, p.onmidimessage], ['closed', null], 'another caller\'s access: its own port objects (Chrome\'s), not midi.js\'s');
  ports([OTHERS, PAD_OUT]); await sim.settle(2);
  assert.deepEqual([sim.$('#midi').textContent, api.midi.inputs().join(), p.state], ['MIDI: From other apps', 'From other apps', 'disconnected']);
  ports([PAD_IN, OTHERS, PAD_OUT]); await sim.settle(2);
  assert.deepEqual([sim.$('#midi').textContent, A.inputs.get(PAD_IN.id) === p, p.state], ['MIDI: Pad Box, From other apps', true, 'connected']);
  const mine = [];
  p.onmidimessage = e => mine.push(Array.from(e.data).join(' '));
  midiIn(PAD_IN.id, [0x90, 61, 90]);
  assert.deepEqual([SHELL.probe().held, mine.join()], [1, '144 61 90'], 'midi.js re-hooked the port back (the note held) and the second caller got it too');
  midiIn(PAD_IN.id, [0x80, 61, 0]);
  assert.deepEqual([SHELL.probe().held, mine.length], [0, 2]);
  p.onmidimessage = null; await p.close();
  assert.deepEqual(sent.filter(m => m.t === 'midi').length, 1, 'no second request');
});

test('B3 a Serum MIDI learn through the shim: learn a.wt → CC 74 from the controller → s.midi[\'74\'] = \'a.wt\'; the learned controller then writes the knob\'s value', async () => {
  api.addTrack(MODELS.find(m => m.id === 'serum')); await settle(4);
  const t = T(), s = CMOD.instOf(t).vals.s;
  assert.equal(CMOD.instOf(t).model, 'serum');
  const done = api.midi.learn(t.id, 'a.wt');
  midiIn(PAD_IN.id, [0xb0, 74, 64]);
  assert.equal(await done, 74);
  assert.equal(s.midi['74'], 'a.wt');
  midiIn(PAD_IN.id, [0xb0, 74, 127]);
  assert.equal(s.p['a.wt'] > 0.99, true, `the learned controller wrote a.wt (${s.p['a.wt']})`);
  midiIn(PAD_IN.id, [0xb0, 74, 0]);
  assert.equal(s.p['a.wt'] < 0.01, true);
});

test('B6 a MIDI note recorded through the shim lands at the shim\'s stamp, not at its delivery (review 2 F5 / F1): recording, a fast note (age 30 ms) at curTick(recv − 30); then 5 s without MIDI and a note the busy page delivered 150 ms after native dispatched it → recorded at curTick(dispatch), ≈ 288 ticks before curTick(delivery)', async () => {
  // a settable page clock from here on, continuing the real one (main.js, the shim and this file read performance.now() at call
  // time; the song moves with the rendered frames only: sim.run)
  const P0 = globalThis.performance;
  let ms = P0.now();
  Object.defineProperty(globalThis, 'performance', { value: { now: () => ms, timeOrigin: P0.timeOrigin }, configurable: true, writable: true });
  try {
    const sr = sim.ctx().sampleRate, Tp = api.transport();
    for (const t of P().tracks) t.arm = false;
    P().metronome.countIn = 0; Tp.pos = 0;
    sim.$('#tRec').onclick(); await sim.settle(5);
    assert.deepEqual([Tp.playing, Tp.rec, T().arm], [true, true, true], 'recording, the selected track armed');
    sim.run(2 * sr);
    // a batch native dispatched `late` ms before the page ran it (h: the dispatch on the host clock), its messages `age` ms old
    const batch = (late, age, ...m) => SHELL.midiIn([ms - late + HOST, 0, ...m.flatMap(b => [Number(PAD_IN.id), age, b[0], b[1], b[2]])]);
    batch(0, 30, [0x90, 50, 100]);
    const want50 = api.curTick(ms - 30);
    sim.run(0.2 * sr); batch(0, 0, [0x80, 50, 0]);
    ms += 5000; // (5 s without MIDI: the old 2 s window emptied here)
    batch(150, 0, [0x90, 62, 100]);
    const want62 = api.curTick(ms - 150), late62 = api.curTick(ms);
    sim.run(0.25 * sr); batch(0, 0, [0x80, 62, 0]);
    sim.$('#tPlay').onclick(); await sim.settle(3); // (stop: the take committed)
    const take = Tp.take, got = new Map(T().notes.filter(n => n.take === take).map(n => [n.n, n.t]));
    assert.equal([...got.keys()].sort().join(), '50,62', 'both notes recorded');
    assert.deepEqual([got.get(50), got.get(62)], [Math.round(want50), Math.round(want62)], `recorded at the stamps (the delivery would be ${Math.round(late62)})`);
    assert.equal(Math.round(late62) - got.get(62) > 250, true, 'the late note\'s delivery tick ≈ 288 ticks (150 ms at 120 BPM) after its recorded one');
  } finally {
    Object.defineProperty(globalThis, 'performance', { value: P0, configurable: true, writable: true });
  }
});
