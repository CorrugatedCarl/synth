// The iPad app's Web MIDI shim (lane S; IMPL-B §1, §3.1, §7 B1 / B2): app/ios/SYNTH/MidiShim.js — the classic script the app
// injects at document start after the marker — evaluated (node:vm) against a fake window: a navigator without permissions,
// a settable performance.now, node's EventTarget / Event / DOMException, SYNTH_SHELL with a recording post (the 'midi' reply
// { ok, ports, gen, h } a timer later, the host clock HOST ms ahead of the page's). B1 the shim alone: the access (one post per page, a new
// MIDIAccess per call with its own ports — Chrome's, review 2 N4 —, a refusal never kept, no SysEx), the port Maps and lists (gen, absent = disconnected, the same object back), connection (the
// implicit open, pending, close, the queued statechange; midi.js's hook shape runs 1 + inputs times), midiIn (bytes by status,
// delivery by connection, unknown ids, dropped), the timestamps (§1.3 as amended after review 2 F1: the one-way minimum kept
// across silence, reseeded by a > 2 s jump, stamps within [recv − 2 000, recv] — a batch the page made wait is stamped at its arrival), send (the spec's checks, several messages, delay), permissions.query, the file's own rules. B2 midi.js
// unchanged on it: its hash; wire() → auto-enable, notes / hot-plug / send, the IMPL-8 rig cases on the shim. Strings, numbers
// and booleans into assert (the vm realm's arrays and objects → plain JSON first).
// Run: node --max-old-space-size=2048 --test tests/app-midi.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as M from '../midi.js?v=9';

const SRC = readFileSync(new URL('../app/ios/SYNTH/MidiShim.js', import.meta.url), 'utf8');
const MIDI = readFileSync(new URL('../midi.js', import.meta.url));
const MIDI_D461 = '3b1664edf2ac26c516348a19b4621dd57d099bf5b6849b50206d86e682a30919'; // sha-256 of midi.js at d461f7d (B1)
const HOST = 4000; // the fake host clock (mach_absolute_time in ms) runs this far ahead of the page's performance.now()
const J = x => JSON.parse(JSON.stringify(x));
const later = (ms = 3) => new Promise(r => setTimeout(r, ms));
const rec = (id, name, type, man = '') => ({ id: String(id), name, manufacturer: man, type, state: 'connected' });

// the page with the shim: o.list the native port list (the reply's), o.nav a navigator, o.marker false: no SYNTH_SHELL, o.post a
// replacement native (after the recording), o.reply(m) the answer to a non-'midi' post; nat.refuse: refusals before an ok
function shim(o = {}) {
  const clock = { t: 1000 }, posts = [], raw = [], warns = [];
  const nat = { list: o.list || [], gen: 1, refuse: 0, error: 'no MIDI server' };
  const SHELL = { os: 'ipados', idiom: 'pad', post(m) {
    raw.push(m); posts.push(J(m));
    if (o.post) return o.post(m);
    if (!m || m.t !== 'midi') return o.reply ? o.reply(m) : Promise.resolve({ ok: true });
    // (o.replyLag: the reply waited that long for a busy page — its h that much before the page reads it)
    return new Promise(res => setTimeout(() => res(nat.refuse > 0 ? (nat.refuse--, { ok: false, error: nat.error }) : { ok: true, ports: nat.list, gen: nat.gen, h: clock.t + HOST - (o.replyLag || 0) }), 1));
  } };
  const nav = o.nav || { userAgent: 'WKWebView' };
  const win = { navigator: nav, performance: { now: () => clock.t }, EventTarget, Event, DOMException, queueMicrotask,
    console: { warn: (...a) => warns.push(a.join(' ')), log() {}, error() {} } };
  if (o.marker !== false) win.SYNTH_SHELL = SHELL;
  win.window = win;
  vm.createContext(win);
  vm.runInContext(SRC, win, { filename: 'MidiShim.js' });
  return { win, nav, SHELL, posts, raw, warns, clock, nat, host: () => clock.t + HOST, sends: () => posts.filter(m => m.t === 'midi-send') };
}
// node's EventTarget reports a listener's error as an uncaught exception on the next tick (a browser: to the console) — for
// that one case the harness's listeners are set aside and the errors collected
async function caught(f) {
  const saved = process.listeners('uncaughtException'), errs = [], h = e => errs.push(e && e.message);
  process.removeAllListeners('uncaughtException');
  process.on('uncaughtException', h);
  try { f(); await later(5); } finally { process.removeListener('uncaughtException', h); for (const l of saved) process.on('uncaughtException', l); }
  return errs;
}
// createMidi as main.js wires it, over a recording host and a fake button
function host(nav, extra = {}) {
  const log = [], btn = { textContent: 'Enable MIDI', title: '', disabled: false, cls: [], onclick: null };
  btn.classList = { add: c => btn.cls.push(c) };
  const R = M.createMidi(Object.assign({ nav, button: () => btn, notice: t => log.push(['notice', t]), targets: () => [],
    noteOn: (n, v, src, ts) => log.push(['on', n, v, src, ts]), noteOff: (n, src, ts) => log.push(['off', n, src, ts]),
    ctl: (k, v, src, ts) => log.push(['ctl', k, v, src, ts]), post() {}, heldNotes: () => [], programChange() {}, modUI() {}, bendUI() {},
    track() {}, fxSet() {}, changed() {} }, extra));
  return { R, log, btn };
}

/* ------------------------------------------------------------------ B1: the shim alone */
test('B1 the file: a classic script (an IIFE, \'use strict\', no import / export), no network on the page side (no fetch / XMLHttpRequest / WebSocket / EventSource / sendBeacon), ≤ 300 lines (§9); nothing without the marker; a WebKit with Web MIDI of its own is left alone', () => {
  const code = SRC.replace(/\/\/.*$/gm, '');
  assert.match(code, /^\s*\(function \(\) \{\s*'use strict';/);
  assert.match(code, /\}\)\(\);\s*$/);
  assert.doesNotMatch(code, /\bimport\b|\bexport\b/);
  assert.doesNotMatch(code, /\bfetch\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\beval\b|new Function|setTimeout|setInterval/);
  assert.ok(SRC.split('\n').length <= 300, `${SRC.split('\n').length} lines`);
  const a = shim({ marker: false });
  assert.deepEqual([typeof a.nav.requestMIDIAccess, 'permissions' in a.nav], ['undefined', false], 'no marker: not the app');
  const own = async () => 'own', b = shim({ nav: { requestMIDIAccess: own } });
  assert.deepEqual([b.nav.requestMIDIAccess === own, typeof b.SHELL.midiIn, typeof b.SHELL.midiPorts, 'permissions' in b.nav], [true, 'undefined', 'undefined', false]);
  const c = shim();
  assert.deepEqual([typeof c.nav.requestMIDIAccess, typeof c.SHELL.midiIn, typeof c.SHELL.midiPorts, typeof c.nav.permissions.query], ['function', 'function', 'function', 'function']);
  assert.equal(Object.keys(c.nav).includes('requestMIDIAccess'), false, 'not enumerable, like a Navigator method');
  assert.equal(c.posts.length, 0, 'nothing posted until the page asks (a page that never opens MIDI costs native nothing)');
});

test('B1 requestMIDIAccess: the first call posts { t: \'midi\', on: true } once and resolves on its reply; calls in flight share that post, later ones post nothing — each call resolves its OWN access (Chrome\'s, N4: the contract\'s old "one shared access" amended); { sysex: true } → SecurityError without asking native; sysexEnabled false', async () => {
  const E = shim({ list: [rec(101, 'KeyStep', 'input')] });
  const [a1, a2] = await Promise.all([E.nav.requestMIDIAccess(), E.nav.requestMIDIAccess()]);
  const a3 = await E.nav.requestMIDIAccess({ software: true });
  assert.deepEqual(E.posts, [{ t: 'midi', on: true }]);
  assert.deepEqual([a1 !== a2, a2 !== a3, a1 !== a3], [true, true, true], 'a new MIDIAccess per call (Chrome: MIDIAccessInitializer → a new MIDIAccess)');
  for (const a of [a1, a2, a3]) assert.deepEqual([a.sysexEnabled, a.inputs.size, a.outputs.size, a.onstatechange, a.inputs.get('101').name], [false, 1, 0, null, 'KeyStep']);
  await assert.rejects(E.nav.requestMIDIAccess({ sysex: true }), { name: 'SecurityError' });
  assert.equal(E.posts.length, 1);
});

test('B1 a refused reply rejects (midi.js: "MIDI blocked — click to retry") and is never kept: the next call posts again and resolves; a post that throws or rejects (no bridge message) is refused the same way', async () => {
  const E = shim({ list: [rec(101, 'KeyStep', 'input')] });
  E.nat.refuse = 1;
  await assert.rejects(E.nav.requestMIDIAccess(), e => e.name === 'InvalidStateError' && /no MIDI server/.test(e.message));
  const A = await E.nav.requestMIDIAccess();
  assert.deepEqual([E.posts.length, A.inputs.size], [2, 1]);
  let mode = 'throw';
  const F = shim({ post: () => { if (mode === 'throw') throw new Error('no handler'); if (mode === 'reject') return Promise.reject(new Error('gone')); return Promise.resolve({ ok: true, ports: [], gen: 1, h: 0 }); } });
  await assert.rejects(F.nav.requestMIDIAccess(), { name: 'NotSupportedError' });
  mode = 'reject';
  await assert.rejects(F.nav.requestMIDIAccess(), { name: 'NotSupportedError' });
  mode = 'ok';
  assert.equal((await F.nav.requestMIDIAccess()).inputs.size, 0);
  assert.equal(F.posts.length, 3, 'each try asked again');
});

test('B1 the port Maps: keyed by String(uniqueID) (negative ids too), the record\'s fields, first-seen order; an input record is never an output ("From other apps" is an input only); malformed records skipped; the attributes are read-only', async () => {
  const E = shim({ list: [rec(101, 'KeyStep 37', 'input', 'Arturia'), rec(-7, 'Pad Box', 'input', 'Akai'), rec(900, 'From other apps', 'input'), rec(-8, 'Pad Box', 'output', 'Akai'),
    { id: null, name: 'x', type: 'input' }, { id: 5, name: 'y', type: 'thru' }, null, 7] });
  const A = await E.nav.requestMIDIAccess();
  assert.deepEqual([[...A.inputs.keys()].join(), [...A.outputs.keys()].join()], ['101,-7,900', '-8']);
  const p = A.inputs.get('101'), o = A.outputs.get('-8');
  assert.deepEqual([p.id, p.name, p.manufacturer, p.version, p.type, p.state, p.connection, p.onmidimessage, p.onstatechange], ['101', 'KeyStep 37', 'Arturia', '', 'input', 'connected', 'closed', null, null]);
  assert.deepEqual([o.id, o.name, o.type, o.state, typeof o.send, typeof o.clear, typeof p.send, 'onmidimessage' in o], ['-8', 'Pad Box', 'output', 'connected', 'function', 'function', 'undefined', false]);
  assert.deepEqual([[...A.inputs.values()].map(x => x.name).join(), [...A.outputs.values()].some(x => x.name === 'From other apps')], ['KeyStep 37,Pad Box,From other apps', false]);
  assert.throws(() => { p.state = 'x'; }, { name: 'TypeError' }); // (a module: strict — a getter-only attribute)
  assert.deepEqual([p.state, p.name], ['connected', 'KeyStep 37']);
});

test('B1 midiPorts(list, gen): the list is the whole truth — one statechange per changed port, on the port then the access (event.port), queued; an absent port turns \'disconnected\' and stays in its Map; the same id back flips the same object (renamed by the list); an older gen is ignored; a list landing before the reply is applied silently and the reply\'s older list then ignored', async () => {
  const E = shim({ list: [rec(1, 'A', 'input'), rec(2, 'B', 'input'), rec(3, 'A', 'output')] });
  const ask = E.nav.requestMIDIAccess();
  E.SHELL.midiPorts([rec(1, 'A', 'input'), rec(4, 'C', 'input'), rec(3, 'A', 'output')], 2); // (a hot-plug overtook the reply)
  const A = await ask;
  assert.deepEqual([...A.inputs.keys()].join(), '1,4', 'the newer list stands; the reply\'s (gen 1) never applied');
  const ev = [], a = A.inputs.get('1'), c = A.inputs.get('4');
  A.onstatechange = e => ev.push('A:' + e.port.id + ':' + e.port.state + ':' + e.port.connection + ':' + e.type);
  A.addEventListener('statechange', e => ev.push('L:' + e.port.id));
  a.onstatechange = e => ev.push('a:' + e.port.id);
  E.SHELL.midiPorts([rec(1, 'A', 'input'), rec(5, 'D', 'input'), rec(3, 'A', 'output')], 3);
  assert.deepEqual([ev.length, c.state, A.inputs.get('5').state, A.inputs.has('4')], [0, 'disconnected', 'connected', true], 'the Maps at once, the events queued');
  await 0;
  assert.deepEqual(ev, ['A:5:connected:closed:statechange', 'L:5', 'A:4:disconnected:closed:statechange', 'L:4'], 'a microtask later: the new port, the gone one');
  ev.length = 0;
  E.SHELL.midiPorts([rec(1, 'A', 'input')], 2); await 0;
  E.SHELL.midiPorts([rec(1, 'A', 'input')], 3); await 0;
  assert.deepEqual([ev.length, A.inputs.get('5').state], [0, 'connected'], 'a stale or repeated gen changes nothing');
  E.SHELL.midiPorts([rec(4, 'C2', 'input'), rec(5, 'D', 'input'), rec(3, 'A', 'output')], 4);
  await 0;
  assert.deepEqual([A.inputs.get('4') === c, c.state, c.name, a.state], [true, 'connected', 'C2', 'disconnected'], 'the same object per id');
  assert.deepEqual(ev, ['A:4:connected:closed:statechange', 'L:4', 'a:1', 'A:1:disconnected:closed:statechange', 'L:1'], 'the port\'s own handler before the access\'s');
  ev.length = 0;
  E.SHELL.midiPorts([], 5); await 0;
  assert.deepEqual([[...A.inputs.values()].map(p => p.state).join(), A.outputs.get('3').state, ev.filter(x => x.startsWith('A:')).length], ['disconnected,disconnected,disconnected', 'disconnected', 3], 'an empty list: every port gone (an already gone one: no event)');
  E.SHELL.midiPorts([rec(1, 'A', 'input'), rec(3, 'A', 'output')]); // (no gen: applied)
  assert.deepEqual([a.state, A.outputs.get('3').state], ['connected', 'connected']);
});

test('B1 connection (the spec\'s): onmidimessage set on a connected input → \'open\' at once, its statechange after the setter returns (a microtask); on a disconnected one → \'pending\', \'open\' when it comes back; an open port that goes → \'pending\'; addEventListener(\'midimessage\') and open() open; close() → \'closed\'; midi.js\'s hook shape runs 1 + inputs times and stops', async () => {
  const E = shim({ list: [rec(1, 'A', 'input'), rec(2, 'B', 'input'), rec(9, 'Out', 'output')] });
  const A = await E.nav.requestMIDIAccess(), a = A.inputs.get('1'), b = A.inputs.get('2');
  E.SHELL.midiPorts([rec(1, 'A', 'input'), rec(9, 'Out', 'output')], 2); await 0; // (B unplugged before anyone listens)
  let n = 0;
  A.onstatechange = () => n++;
  a.onmidimessage = () => {};
  assert.deepEqual([n, a.connection], [0, 'open'], 'never inside the setter');
  await 0;
  assert.equal(n, 1);
  b.onmidimessage = () => {};
  assert.deepEqual([b.state, b.connection], ['disconnected', 'pending']);
  E.SHELL.midiPorts([rec(1, 'A', 'input'), rec(2, 'B', 'input'), rec(9, 'Out', 'output')], 3);
  assert.deepEqual([b.state, b.connection], ['connected', 'open'], 'a pending port back: open');
  E.SHELL.midiPorts([rec(2, 'B', 'input'), rec(9, 'Out', 'output')], 4);
  assert.deepEqual([a.state, a.connection], ['disconnected', 'pending'], 'an open port gone: pending');
  await 0;
  let k = n;
  b.onmidimessage = () => {}; a.onmidimessage = () => {};
  await 0;
  assert.equal(n, k, 'a handler set again on an open / pending port: no event');
  assert.equal(await b.close(), b);
  assert.equal(b.connection, 'closed');
  await 0; k = n;
  b.addEventListener('midimessage', () => {});
  assert.equal(b.connection, 'open', 'a listener opens it again');
  assert.equal(await b.open(), b);
  await 0;
  assert.equal(n, k + 1, 'open() on an open port: nothing more');
  const o = A.outputs.get('9');
  assert.equal(o.connection, 'closed');
  await o.open();
  assert.equal(o.connection, 'open');
  b.onmidimessage = null;
  assert.deepEqual([b.onmidimessage, b.connection], [null, 'open'], 'a null handler closes nothing');
  // midi.js's hook(): every input's handler set on each statechange — 1 + (inputs) runs, then quiet (a disconnected one included)
  const F = shim({ list: [rec(1, 'A', 'input'), rec(2, 'B', 'input'), rec(3, 'C', 'input')] });
  const B = await F.nav.requestMIDIAccess();
  F.SHELL.midiPorts([rec(1, 'A', 'input'), rec(2, 'B', 'input')], 2); await 0;
  let runs = 0;
  const hook = () => { runs++; for (const inp of B.inputs.values()) inp.onmidimessage = () => {}; };
  hook(); B.onstatechange = hook;
  await later(5);
  assert.deepEqual([runs, [...B.inputs.values()].map(p => p.connection).join()], [4, 'open,open,pending']);
});

test('B1 several accesses (review 2 N4 — Chrome\'s: a new MIDIAccess and new port objects per call, "open" kept per access): each its own ports (the same object per id within it), connection, onstatechange and listeners; a second caller\'s onmidimessage never replaces the first\'s — both get every message; a hot-plug reaches every access\'s port, a new port appears in each, a later access lists the known ports in first-seen order', async () => {
  const E = shim({ list: [rec(1, 'A', 'input'), rec(2, 'B', 'output')] });
  const [a1, a2] = await Promise.all([E.nav.requestMIDIAccess(), E.nav.requestMIDIAccess()]);
  const p1 = a1.inputs.get('1'), p2 = a2.inputs.get('1');
  assert.deepEqual([p1 !== p2, a1.inputs !== a2.inputs, a1.inputs.get('1') === p1, a1.outputs.get('2') !== a2.outputs.get('2'), p2.name, p2.state, p2.connection], [true, true, true, true, 'A', 'connected', 'closed']);
  const ev = [], got = [];
  a1.onstatechange = e => ev.push('1:' + e.port.id + ':' + e.port.state + ':' + e.port.connection + (a1.inputs.get(e.port.id) === e.port || a1.outputs.get(e.port.id) === e.port ? '' : ':foreign'));
  a2.addEventListener('statechange', e => ev.push('2:' + e.port.id + ':' + e.port.state + ':' + e.port.connection + (a2.inputs.get(e.port.id) === e.port || a2.outputs.get(e.port.id) === e.port ? '' : ':foreign')));
  const h1 = e => got.push('1:' + Array.from(e.data).join(' ') + '@' + e.timeStamp);
  p1.onmidimessage = h1;
  await 0;
  assert.deepEqual([ev.join(), p1.connection, p2.connection, p2.onmidimessage], ['1:1:connected:open', 'open', 'closed', null], 'one access\'s handler opens its own port only, the event on its own access only');
  ev.length = 0;
  p2.onmidimessage = e => got.push('2:' + Array.from(e.data).join(' ') + '@' + e.timeStamp); // (a second caller — the smoke, a future module)
  await 0;
  assert.deepEqual([ev.join(), p1.onmidimessage === h1], ['2:1:connected:open', true], 'the first caller\'s handler untouched');
  E.clock.t = 1100;
  E.SHELL.midiIn([E.host(), 0, 1, 3, 0x90, 60, 100, 1, 0, 0x80, 60, 0]);
  assert.deepEqual(got, ['1:144 60 100@1097', '2:144 60 100@1097', '1:128 60 0@1100', '2:128 60 0@1100'], 'every message to each open port, in order, one stamp');
  ev.length = 0; got.length = 0;
  E.SHELL.midiPorts([rec(2, 'B', 'output'), rec(3, 'C', 'input')], 2);
  await 0;
  assert.deepEqual(ev, ['1:3:connected:closed', '2:3:connected:closed', '1:1:disconnected:pending', '2:1:disconnected:pending'], 'the new port in each access, then the gone one, each access its own port');
  assert.deepEqual([a1.inputs.get('3') !== a2.inputs.get('3'), [...a1.inputs.keys()].join(), [...a2.inputs.keys()].join()], [true, '1,3', '1,3']);
  await p2.close();
  E.SHELL.midiIn([E.host(), 0, 1, 0, 0xb0, 123, 0]);
  assert.deepEqual(got, ['1:176 123 0@1100'], 'a closed port in one access, still pending in the other: delivered there only');
  const a3 = await E.nav.requestMIDIAccess();
  assert.deepEqual([E.posts.length, [...a3.inputs.keys()].join(), [...a3.inputs.values()].map(p => p.state + ':' + p.connection).join(), a3.outputs.get('2').name],
    [1, '1,3', 'disconnected:closed,connected:closed', 'B'], 'a later access: no post, every known port (a gone one disconnected, as in the older accesses), all closed');
});

test('B1 midiIn: one midimessage per message, data a Uint8Array sized by its status (3, 2, 1 bytes), in order; SysEx, reserved statuses, a data byte as status and a short tail dropped', async () => {
  const E = shim({ list: [rec(5, 'K', 'input')] });
  const A = await E.nav.requestMIDIAccess(), got = [];
  A.inputs.get('5').onmidimessage = e => got.push([Object.prototype.toString.call(e.data), Array.from(e.data).join(' '), e.type]);
  E.SHELL.midiIn([E.host(), 0, 5, 0, 0x91, 60, 100, 5, 0, 0xd1, 7, 0, 5, 0, 0xf6, 0, 0]);
  assert.deepEqual(got.map(g => g[1]), ['145 60 100', '209 7', '246']);
  assert.deepEqual(got.map(g => g[0] + ' ' + g[2]), Array(3).fill('[object Uint8Array] midimessage'));
  got.length = 0;
  E.SHELL.midiIn([E.host(), 0, 5, 0, 0xc3, 9, 0, 5, 0, 0xe0, 0, 0x40, 5, 0, 0xf1, 0x21, 0, 5, 0, 0xf2, 1, 2, 5, 0, 0xf3, 4, 0, 5, 0, 0xff, 0, 0, 5, 0, 0xa2, 60, 90,
    5, 0, 0xf0, 1, 2, 5, 0, 0xf7, 0, 0, 5, 0, 0xf4, 0, 0, 5, 0, 0xf5, 0, 0, 5, 0, 0xf9, 0, 0, 5, 0, 0xfd, 0, 0, 5, 0, 0x40, 1, 2, 5, 0, 0x300, 1, 2, 5, 0, 0x90]);
  assert.deepEqual(got.map(g => g[1]), ['195 9', '224 0 64', '241 33', '242 1 2', '243 4', '255', '162 60 90']);
  for (const bad of [undefined, null, [], [1], 'abc', [E.host()]]) assert.doesNotThrow(() => E.SHELL.midiIn(bad));
});

test('B1 timestamps (§1.3): timeStamp = h − age + off within [recv − 2 000, recv], off the minimum of recv − h — a batch the page made wait 150 ms is stamped at its arrival (error 0, not 150); ages clamped 0…2 000; a batch without h at recv; a slower sample never lifts the offset, however old the minimum', async () => {
  const E = shim({ list: [rec(5, 'K', 'input')] });
  const A = await E.nav.requestMIDIAccess(), ts = []; // the reply: recv 1000, h 5000 → off −4000
  A.inputs.get('5').onmidimessage = e => ts.push(e.timeStamp);
  const at = (t, h, ages) => { E.clock.t = t; ts.length = 0; E.SHELL.midiIn([h, 0, ...ages.flatMap(g => [5, g, 0xb0, 1, 0])]); return ts.join(' '); };
  assert.equal(at(1100, 5100, [0, 2.5]), '1100 1097.5', 'a fast batch: dispatched at host 5100 (page 1100), here at once');
  assert.equal(at(1300, 5150, [0, 4]), '1150 1146', 'dispatched at page 1150, delivered at 1300 (the page busy 150 ms): stamped at the arrival');
  assert.equal(at(1400, 5400, [-50, 9000]), '1400 -600', 'a future stamp → age 0, never after recv; an absurd past one → 2 000');
  assert.equal(at(1500, NaN, [3]), '1500', 'no h: recv');
  assert.equal(at(2000, 5990, [0]), '1990', 'a slower sample (−3990) does not lift the offset (−4000)');
  // (the deliberate amendment of review 2's F1 — §1.3 as the lead decided: the minimum is KEPT across silence; the old rule let this
  // one sample, 2 s after the last −4000 one, lift the offset to −3990 and stamped it at 3401 — indistinguishable from a 10 ms stall)
  assert.equal(at(3401, 7391, [0]), '3391', 'the −4000 minimum is kept 2 s on: −3990 is a 10 ms wait, corrected');
  assert.equal(at(3500, 7480, [0]), '3480', 'and the next one too');
});

test('B1 timestamps after silence, at the access, under a stall, across a clock jump (review 2 F1; §1.3 as amended): the minimum is kept for good and moves down at once; a sample more than 2 s above it reseeds the estimate (that batch still stamped against the kept minimum); every stamp within [recv − 2 000, recv]', async () => {
  // dispatched at page time d (host d + HOST − jump: the page clock `jump` ms ahead of where it was), delivered `late` ms later
  async function mk(o = {}) {
    const E = shim(Object.assign({ list: [rec(5, 'K', 'input')] }, o)), A = await E.nav.requestMIDIAccess(), ts = [];
    A.inputs.get('5').onmidimessage = e => ts.push(e.timeStamp);
    return (d, late = 0, ages = [0], jump = 0) => { E.clock.t = d + late; ts.length = 0; E.SHELL.midiIn([d + HOST - jump, 0, ...ages.flatMap(g => [5, g, 0x90, 60, 100])]); return ts.join(' '); };
  }
  let at = await mk();   // (the reply at page 1000, h 5000: −4000, the true offset)
  assert.equal(at(1100), '1100');
  assert.equal(at(7000, 150), '7000', '5 s without MIDI, then a batch the busy page held 150 ms: stamped at its dispatch (was 7150)');
  assert.deepEqual([at(7200), at(7300, 40), at(9000, 1900)], ['7200', '7300', '9000'], 'later ones too; a 1.9 s wait is still a wait');
  at = await mk();
  assert.equal(at(3300, 200), '3300', 'the first note 2.3 s after the access, held 200 ms: the reply\'s sample stamps it (was 3500)');
  at = await mk({ replyLag: 120 });   // the reply itself waited 120 ms (a cold boot): its sample −3880, 120 ms above the truth
  assert.deepEqual([at(1500, 50), at(1600), at(1700, 80)], ['1550', '1600', '1700'], 'a slow reply: the first note from the better of its own sample and the reply\'s (50 ms late, both were slow), the first fast one corrects the rest');
  at = await mk({ replyLag: 20 });
  assert.equal(at(1500, 50), '1520', 'a reply faster than the first note: the reply\'s 20 ms is the whole error');
  at = await mk();
  assert.equal(at(1050), '1050');
  assert.equal(at(1100, 3000), '2100', 'a note held 3 s by a dialog: stamped against the kept minimum, clamped to recv − 2 000 — never 3 s late (was 4100)');
  assert.deepEqual([at(4110), at(4200, 150)], ['4110', '4200'], 'the reseed (+3 s) undone by the next fast sample: the minimum again');
  at = await mk();
  assert.equal(at(1100), '1100');
  assert.equal(at(20000, 0, [0], 10000), '18000', 'the clocks 10 s apart (a sleep, performance.now() counting on): the first batch against the kept minimum, clamped (2 s early at most, once)');
  assert.deepEqual([at(20100, 0, [0], 10000), at(20200, 150, [0], 10000)], ['20100', '20200'], 'reseeded: exact, and a wait corrected on the new offset');
  at = await mk();
  assert.equal(at(1100), '1100');
  assert.deepEqual([at(5000, 0, [0], -10000), at(5100, 150, [0], -10000)], ['5000', '5100'], 'the clocks 10 s apart the other way: a new minimum, taken at once');
  at = await mk();
  assert.equal(at(1100), '1100');
  assert.equal(at(1200, 1500, [0, 1000, 2000]), '1200 700 700', 'held 1.5 s with ages 1 000 / 2 000: never before recv − 2 000');
  assert.equal(at(1400, 0, [-5]), '1400', 'never after recv');
});

test('B1 delivery: onmidimessage and addEventListener both fire, in order; a throwing listener is reported and never cuts the batch short; a closed port and an unknown id get nothing; a \'disconnected\' input still open (pending) gets its messages (the releases native orders before its list); dropped > 0 warns once', async () => {
  const E = shim({ list: [rec(5, 'K', 'input'), rec(6, 'L', 'input')] });
  const A = await E.nav.requestMIDIAccess(), k = A.inputs.get('5'), got = [];
  k.onmidimessage = e => got.push('h' + e.data[1]);
  k.addEventListener('midimessage', e => got.push('l' + e.data[1]));
  const two = () => E.SHELL.midiIn([E.host(), 0, 5, 0, 0x90, 1, 1, 5, 0, 0x90, 2, 1]);
  two();
  assert.deepEqual(got, ['h1', 'l1', 'h2', 'l2']);
  got.length = 0;
  const errs = await caught(() => { k.onmidimessage = e => { if (e.data[1] === 1) throw new Error('boom'); got.push('h' + e.data[1]); }; two(); });
  assert.deepEqual([got.join(), errs.join()], ['l1,h2,l2', 'boom'], 'the handler kept its place before the listener; the batch went on');
  got.length = 0;
  E.SHELL.midiIn([E.host(), 0, 6, 0, 0x90, 9, 1, 77, 0, 0x90, 9, 1, -77, 0, 0x90, 9, 1]);
  assert.deepEqual(got, [], 'no handler on L, unknown ids: nothing (no throw)');
  E.SHELL.midiPorts([rec(6, 'L', 'input')], 2);
  assert.deepEqual([k.state, k.connection], ['disconnected', 'pending']);
  E.SHELL.midiIn([E.host(), 0, 5, 0, 0xb0, 123, 0]);
  assert.deepEqual(got, ['h123', 'l123'], 'still delivered by its handlers');
  await k.close(); got.length = 0;
  two();
  assert.deepEqual(got, [], 'closed: nothing');
  E.SHELL.midiIn([E.host(), 3, 6, 0, 0x90, 9, 1]);
  E.SHELL.midiIn([E.host(), 5, 6, 0, 0x90, 9, 1]);
  assert.deepEqual([E.warns.length, /3 MIDI messages/.test(E.warns[0])], [1, true], 'warned once per run');
});

test('B1 MIDIOutput.send: { t: \'midi-send\', id, b, delay } with b a plain Array; several messages → one post each; a timestamp → delay (0 absent or past); the spec\'s errors before anything is sent (TypeError, InvalidAccessError for SysEx, InvalidStateError disconnected); the implicit open; a refused reply swallowed; clear() a no-op', async () => {
  let answer = { ok: true };
  const E = shim({ list: [rec(-8, 'Pad Box', 'output')], reply: () => (answer === 'reject' ? Promise.reject(new Error('unknown output')) : Promise.resolve(answer)) });
  const A = await E.nav.requestMIDIAccess(), o = A.outputs.get('-8');
  let n = 0;
  A.onstatechange = () => n++;
  o.send([0x90, 36, 127]);
  assert.deepEqual(E.sends(), [{ t: 'midi-send', id: '-8', b: [144, 36, 127], delay: 0 }]);
  const r = E.raw.find(m => m.t === 'midi-send');
  assert.deepEqual([Array.isArray(r.b), ArrayBuffer.isView(r.b), o.connection], [true, false, 'open'], 'a plain Array; the port opened by the send');
  await 0;
  assert.equal(n, 1, 'one statechange for the implicit open');
  E.posts.length = 0;
  o.send(Uint8Array.of(0x90, 36, 127, 0x80, 36, 0, 0xc0, 5, 0xf8));
  assert.deepEqual(E.sends().map(m => m.b.join(' ')), ['144 36 127', '128 36 0', '192 5', '248']);
  E.posts.length = 0; E.clock.t = 2000;
  o.send([0xb0, 1, 2], 2020); o.send([0xb0, 1, 2], 1500); o.send([0xb0, 1, 2], 0); o.send([0xb0, 1, 2.9], undefined);
  assert.deepEqual(E.sends().map(m => m.delay + ':' + m.b.join(' ')), ['20:176 1 2', '0:176 1 2', '0:176 1 2', '0:176 1 2']);
  E.posts.length = 0;
  for (const [bad, name] of [[[0x90, 300, 1], 'TypeError'], [[], 'TypeError'], [[36, 1], 'TypeError'], [[0x90, 36], 'TypeError'], [[0x90, 0x80, 1], 'TypeError'],
    [[0xf4], 'TypeError'], [[-1], 'TypeError'], ['abc', 'TypeError'], [5, 'TypeError'], [null, 'TypeError'], [undefined, 'TypeError'],
    [[0xf0, 0x7e, 0x01, 0xf7], 'InvalidAccessError'], [[0xf7], 'InvalidAccessError'], [[0x90, 36, 1, 0xf0, 1], 'InvalidAccessError'], [[0x90, 36, 1, 0x80], 'TypeError']]) {
    assert.throws(() => o.send(bad), { name }, JSON.stringify(bad));
  }
  assert.equal(E.sends().length, 0, 'nothing sent from a refused call (not even its valid first message)');
  answer = { ok: false, error: 'unknown output' }; o.send([0x90, 1, 1]);
  answer = 'reject'; o.send([0x90, 1, 2]);
  await later(2);
  assert.deepEqual([E.sends().length, typeof o.clear(), A.outputs.size], [2, 'undefined', 1], 'refusals swallowed: a light is only a light');
  E.SHELL.midiPorts([], 2);
  assert.throws(() => o.send([0x90, 36, 127]), { name: 'InvalidStateError' });
});

test('B1 permissions.query: { name: \'midi\' } → granted (sysex: denied) — midi.js connects at boot with no tap; every other name → the original query (its own this); without navigator.permissions (the node sim) one is made, other names a TypeError', async () => {
  const seen = [], P = { query(d) { seen.push([d.name, this === P]); return Promise.resolve({ state: 'prompt' }); } };
  const E = shim({ nav: { permissions: P } });
  const s = await P.query({ name: 'midi' });
  assert.deepEqual([s.state, s.name, s.onchange, typeof s.addEventListener], ['granted', 'midi', null, 'function']);
  assert.equal((await P.query({ name: 'midi', sysex: true })).state, 'denied');
  assert.equal((await P.query({ name: 'geolocation' })).state, 'prompt');
  assert.deepEqual(seen, [['geolocation', true]]);
  const F = shim();
  assert.equal((await F.nav.permissions.query({ name: 'midi' })).state, 'granted');
  await assert.rejects(F.nav.permissions.query({ name: 'geolocation' }), { name: 'TypeError' });
  assert.deepEqual([E.posts.length, F.posts.length], [0, 0], 'asking about the permission opens nothing');
});

/* ------------------------------------------------------------------ B2: midi.js unchanged on the shim */
test('B2 midi.js is byte-identical to d461f7d\'s (the shim lives in the app bundle, never in the site) and still asks for no options', () => {
  assert.equal(createHash('sha256').update(MIDI).digest('hex'), MIDI_D461);
  const code = MIDI.toString().replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /SYNTH_SHELL|MidiShim|requestMIDIAccess\([^)]/);
});

test('B2 midi.js on the shim: wire() → the permission granted → enable() with no tap → "MIDI: KeyStep, From other apps"; the hook ran 1 + inputs times; a note-on batch → noteOn(60, 100 / 127, 1, ts) with the shim\'s stamp; a hot-plug list → ports(names) and the button; send(name) → one midi-send per output of that name', async () => {
  const outs = [rec(201, 'Pad A', 'output'), rec(202, 'Pad A', 'output'), rec(203, 'Other', 'output')];
  const E = shim({ list: [rec(101, 'KeyStep', 'input', 'Arturia'), rec(900, 'From other apps', 'input'), ...outs] });
  const portsLog = [], X = host(E.nav, { ports: names => portsLog.push(names.join()) });
  X.R.wire();
  await later(10);
  assert.deepEqual([X.btn.textContent, X.btn.title, X.btn.disabled, X.btn.cls.join(), X.R.enabled], ['MIDI: KeyStep, From other apps', 'Connected MIDI inputs', false, '', true]);
  assert.deepEqual(E.posts, [{ t: 'midi', on: true }]);
  assert.deepEqual(portsLog, Array(3).fill('KeyStep,From other apps'), 'hook() at enable, then once per input\'s implicit open — then quiet');
  E.clock.t = 1200; X.log.length = 0;
  E.SHELL.midiIn([1200 + HOST, 0, 101, 3, 0x90, 60, 100, 900, 0, 0x91, 62, 64, 101, 0, 0x80, 60, 0]);
  assert.deepEqual(J(X.log), [['on', 60, 100 / 127, 1, 1197], ['on', 62, 64 / 127, 2, 1200], ['off', 60, 1, 1200]]);
  E.SHELL.midiPorts([rec(101, 'KeyStep', 'input'), rec(900, 'From other apps', 'input'), rec(301, 'Pad A', 'input'), ...outs], 2);
  await later(2);
  assert.deepEqual([X.btn.textContent, portsLog.at(-1)], ['MIDI: KeyStep, From other apps, Pad A', 'KeyStep,From other apps,Pad A']);
  E.SHELL.midiPorts([rec(900, 'From other apps', 'input'), rec(301, 'Pad A', 'input'), ...outs], 3);
  await later(2);
  assert.deepEqual([X.btn.textContent, portsLog.at(-1), X.R.inputs().join()], ['MIDI: From other apps, Pad A', 'From other apps,Pad A', 'From other apps,Pad A'], 'KeyStep unplugged: gone from the button, the host, inputs()');
  E.posts.length = 0;
  assert.equal(X.R.send('Pad A', [0x99, 36, 127]), true);
  assert.deepEqual(E.sends(), [{ t: 'midi-send', id: '201', b: [0x99, 36, 127], delay: 0 }, { t: 'midi-send', id: '202', b: [0x99, 36, 127], delay: 0 }]);
  assert.deepEqual([X.R.outputs().join(), X.R.send('Nobody', [0x90, 1, 1]), X.R.send('Pad A', [0xf0, 1, 2])], ['Pad A,Pad A,Other', false, false]);
  E.SHELL.midiPorts([rec(900, 'From other apps', 'input'), rec(203, 'Other', 'output')], 4);
  await later(2);
  assert.deepEqual([X.R.outputs().join(), X.R.send('Pad A', [0x90, 1, 1])], ['Other', false], 'unplugged outputs: no longer listed nor sent to');
});

test('B2 the IMPL-8 rig cases on the shim: each input its own handler, its name reaching padIn; pad learn from a batch → { port, ch, n, cc }; an unplugged port leaves inputs() / ports() and the button, its pending handler still delivering what native ordered before the list; a refusal then a retry from the button', async () => {
  const E = shim({ list: [rec(1, 'Pad A', 'input'), rec(2, 'Pad B', 'input'), rec(3, 'Pad A', 'output')] });
  E.nat.refuse = 1;
  const seen = [], portsLog = [];
  // (midi.js's own access, seen through a recording navigator: N4 — another caller's requestMIDIAccess() gets its own)
  const mine = [], nav = { permissions: E.nav.permissions, requestMIDIAccess: o => E.nav.requestMIDIAccess(o).then(A => (mine.push(A), A)) };
  const X = host(nav, { padIn: (e, port, ts) => { seen.push([e.k, e.ch, e.k === 'cc' ? e.cc : e.n, port, ts].join(' ')); return false; }, ports: n => portsLog.push(n.join()) });
  X.R.wire();
  await later(10);
  assert.deepEqual([X.btn.textContent, X.R.enabled], ['MIDI blocked — click to retry', false]);
  X.btn.onclick();
  await later(10);
  assert.deepEqual([X.btn.textContent, E.posts.length], ['MIDI: Pad A, Pad B', 2], 'the retry asked again and connected');
  const A = mine[0], a = A.inputs.get('1'), b = A.inputs.get('2'), other = await E.nav.requestMIDIAccess();
  assert.equal(mine.length === 1 && typeof a.onmidimessage === 'function' && a.onmidimessage !== b.onmidimessage, true, 'each input its own handler');
  assert.deepEqual([other !== A, other.inputs.get('1').onmidimessage, other.inputs.get('1').connection], [true, null, 'closed'], 'another caller\'s access: none of midi.js\'s handlers');
  E.clock.t = 1100;
  E.SHELL.midiIn([5100, 0, 1, 0, 0x99, 36, 100, 2, 0, 0x80, 40, 0]);
  assert.deepEqual(seen, ['on 10 36 Pad A 1100', 'off 1 40 Pad B 1100']);
  const p = X.R.learnPad();
  E.SHELL.midiIn([5100, 0, 2, 0, 0x89, 30, 0, 2, 0, 0x99, 38, 101]);
  assert.deepEqual(await p, { port: 'Pad B', ch: 10, n: 38, cc: 0 });
  E.SHELL.midiPorts([rec(1, 'Pad A', 'input'), rec(3, 'Pad A', 'output')], 2);
  await later(2);
  assert.deepEqual([b.state, b.connection, X.R.inputs().join(), portsLog.at(-1), X.btn.textContent], ['disconnected', 'pending', 'Pad A', 'Pad A', 'MIDI: Pad A']);
  seen.length = 0;
  E.SHELL.midiIn([5100, 0, 2, 0, 0xb0, 123, 0]);
  assert.deepEqual(seen, ['cc 1 123 Pad B 1100'], 'a pending input\'s handler still delivers');
  E.SHELL.midiPorts([], 3);
  await later(2);
  assert.deepEqual([X.btn.textContent, X.btn.title, portsLog.at(-1), X.R.outputs().length], ['MIDI: no devices', 'Plug in a MIDI controller — it is picked up automatically', '', 0]);
});
