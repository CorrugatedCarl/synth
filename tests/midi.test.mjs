// midi.js tests (SPEC-serum2 §0.2 role I2, §12.6, §6.17; M1b: extracted from main.js with no behaviour change).
//  - the pure routing core: decode, targets (Phase-1 rule + MPE zones), noteMsg, exprX, mpeExpr, learn-map edits, writeCC;
//  - the router against a verbatim reference of the Phase-1 main.js dispatch (onMIDI, MIDI Learn, midiMapCC, targets):
//    a seeded random message stream must produce the same host calls, in the same order, with the same arguments, and
//    the same final states;
//  - MPE zone routing (member/master channels, mixed MPE and Phase-1 targets);
//  - the Web MIDI adapter (button texts, permission auto-connect, retry, hot-plug) on a stub navigator.
// Run: node --test tests/midi.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../serum-core.js?v=8';
import * as fxc from '../fx-core.js?v=8';
import * as Q from '../seq-core.js?v=8';
import * as M from '../midi.js?v=8';

const SRC = readFileSync(new URL('../midi.js', import.meta.url), 'utf8');
const N = (/const VERSION = '(\d+)'/.exec(readFileSync(new URL('../main.js', import.meta.url), 'utf8')) || [])[1];

/* ---------------------------------------------------------------- fixtures */
const prng = seed => { let r = seed >>> 0 || 1; return () => { r ^= r << 13; r >>>= 0; r ^= r >>> 17; r ^= r << 5; r >>>= 0; return r / 4294967296; }; };
const sxState = (midi = {}, mpe = 0) => {
  const s = core.defaultSerum();
  s.midi = Object.assign({}, midi);
  s.global.mpe.on = mpe;
  return s;
};
const sxTrack = (id, ch, o = {}) => ({ id, ch, arm: !!o.arm, model: 'serum', vals: { s: sxState(o.midi, o.mpe ? 1 : 0) }, fx: { p: {} } });
const plainTrack = (id, ch, o = {}) => ({ id, ch, arm: !!o.arm, model: 'juno60', vals: { cutoff: 50 }, fx: { p: {} } });

// Phase-1 main.js targets(src), verbatim over an explicit project
function targetsP1(project, src) {
  const sel = project.selTrack;
  if (!src) return project.tracks.filter(t => t.id === sel || t.arm);
  const r = project.tracks.filter(t => t.ch === src || (t.ch === 0 && (t.id === sel || t.arm)));
  return r.length ? r : project.tracks.filter(t => t.id === sel);
}

// Fake timers (the host's setTimeout / clearTimeout)
function timers() {
  let id = 0, now = 0;
  const q = new Map();
  return {
    setTimeout: (f, ms) => { q.set(++id, { f, at: now + ms }); return id; },
    clearTimeout: k => { q.delete(k); },
    tick(ms) { now += ms; for (const [k, e] of [...q]) if (e.at <= now) { q.delete(k); e.f(); } },
    get size() { return q.size; },
  };
}

// The environment main.js gives both implementations: live input routing with a held-note map (src:n → track ids),
// worklet posts, the wheels, program change, Serum state edits — every effect appended to one log
function world(project, log, T) {
  const held = new Map();
  const env = {
    project, held, log,
    targets: src => targetsP1(project, src),
    noteOn(n, v, src, ts) { log.push(['noteOn', n, v, src, ts]); const key = src + ':' + n; held.set(key, env.targets(src).map(t => t.id)); },
    noteOff(...a) { log.push(['noteOff', a.length, ...a]); held.delete(a[1] + ':' + a[0]); },
    ctl: (kind, v, src, ts, trs) => log.push(['ctl', kind, v, src, ts, trs ? trs.map(t => t.id) : null]),
    postTo: (t, m) => log.push(['post', t.id, m]),
    programChange: (trs, n) => log.push(['pc', trs.map(t => t.id), n]),
    setModUI: (v, cb) => log.push(['modUI', v, cb]),
    setBendUI: (v, cb) => log.push(['bendUI', v, cb]),
    isSx: t => !!t && t.model === 'serum',
    sxDirty: { add: id => log.push(['dirty', id]) },
    persist: () => log.push(['persist']),
    queuePatch: t => log.push(['queuePatch', t.id]),
    sxRefresh: () => log.push(['refresh']),
    notice: (txt, ms) => log.push(['notice', txt, ms]),
    fxOf: t => t.fx,
    fxStateId: id => (id === 'fx.dim.size' ? 'fx.hyper.size' : id), // stands for main.js's RENAME1 inverse
    T,
  };
  return env;
}

// Verbatim Phase-1 main.js MIDI code (onMIDI, MIDI Learn, midiMapCC), its free names bound to the environment
function phase1(E) {
  const { held, project, isSx, sxDirty, notice, fxOf, fxStateId } = E;
  const targets = E.targets, noteOn = E.noteOn, noteOff = E.noteOff, ctl = E.ctl, postTo = E.postTo;
  const programChange = E.programChange, setModUI = E.setModUI, setBendUI = E.setBendUI;
  const persist = E.persist, queuePatch = E.queuePatch, sxRefresh = E.sxRefresh;
  const setTimeout = E.T.setTimeout, clearTimeout = E.T.clearTimeout;
  let midiInit = false;
  let learn = null;
  function midiLearn(id, dest) {
    cancelLearn(false);
    if (!midiInit) notice('MIDI Learn: enable MIDI (the MIDI button by the keyboard), then move a controller — Esc cancels', 6000);
    else notice('MIDI Learn: move a controller — Esc cancels', 6000);
    return new Promise(res => { learn = { id, dest, res, t: setTimeout(() => cancelLearn(true), midiInit ? 15000 : 30000) }; });
  }
  function cancelLearn(say) {
    const L = learn;
    if (!L) return false;
    learn = null; clearTimeout(L.t);
    L.res(null);
    if (say) notice('MIDI Learn cancelled', 3000);
    return true;
  }
  function learnCC(cc) {
    const L = learn;
    learn = null; clearTimeout(L.t);
    const t = project.tracks.find(x => x.id === L.id);
    if (t && isSx(t)) {
      const m = t.vals.s.midi;
      for (const k of Object.keys(m)) if (m[k] === L.dest) delete m[k];
      m[String(cc)] = L.dest;
      sxDirty.add(t.id); persist();
    }
    L.res(t ? cc : null);
  }
  function midiForget(t, dest) {
    if (!isSx(t)) return;
    const m = t.vals.s.midi;
    for (const k of Object.keys(m)) if (m[k] === dest) delete m[k];
    sxDirty.add(t.id); persist(); sxRefresh();
  }
  function midiMapCC(trs, cc, v) {
    for (const t of trs) {
      if (!isSx(t)) continue;
      const s = t.vals.s, dest = s.midi && s.midi[String(cc)];
      if (!dest) continue;
      const n = core.midiValue(dest, v), mac = /^macro([1-4])$/.exec(dest);
      if (mac) s.macros[+mac[1] - 1].v = n;
      else if (core.isFxId(dest) && dest !== 'g.master' && dest !== 'g.bypass') fxOf(t).p[fxStateId(dest)] = n; // §3.11.1
      else s.p[dest] = n;
      sxDirty.add(t.id);
      queuePatch(t); persist(); sxRefresh();
    }
  }
  function onMIDI(e) {
    const [st0, d1, d2] = e.data, cmd = st0 & 0xf0, ch = (st0 & 0x0f) + 1, ts = e.timeStamp;
    if (cmd === 0x90 && d2 > 0) noteOn(d1, d2 / 127, ch, ts);
    else if (cmd === 0x80) noteOff(d1, ch, ts, d2 / 127); // release velocity (Serum's Release Velocity source)
    else if (cmd === 0x90 && d2 === 0) noteOff(d1, ch, ts);
    else if (cmd === 0xa0) { for (const t of targets(ch)) postTo(t, { t: 'pat', n: d1, v: d2 / 127 }); } // poly aftertouch
    else if (cmd === 0xb0) {
      if (d1 < 120 && learn) learnCC(d1); // Serum MIDI Learn takes the next controller 0–119 (§11.8)
      if (d1 === 1) { ctl('wheel', d2 / 127, ch, ts); setModUI(d2 / 127, false); }
      else if (d1 === 64) { ctl('sus', d2 >= 64 ? 1 : 0, ch, ts); }
      else if (d1 === 120 || d1 === 123) { for (const k of [...held.keys()]) if (k.startsWith(ch + ':')) noteOff(+k.split(':')[1], ch, ts); }
      if (d1 < 120) midiMapCC(targets(ch), d1, d2); // learned controllers of the targeted Serum tracks
    } else if (cmd === 0xe0) {
      const v = ((d2 << 7) | d1) / 8192 - 1;
      ctl('bend', v, ch, ts); setBendUI((v + 1) / 2, false);
    } else if (cmd === 0xd0) ctl('at', d1 / 127, ch, ts);
    else if (cmd === 0xc0) programChange(targets(ch), d1);
  }
  return {
    message: (data, ts) => onMIDI({ data, timeStamp: ts }), learn: midiLearn, cancelLearn, forget: midiForget,
    get learning() { return learn; }, setEnabled: on => { midiInit = on; },
  };
}

// midi.js wired the way main.js wires it (the host of createMidi over the same environment)
function v2(E, extra = {}) {
  const r = M.createMidi(Object.assign({
    targets: E.targets, noteOn: E.noteOn, noteOff: E.noteOff, ctl: E.ctl, post: E.postTo, programChange: E.programChange,
    heldNotes: src => [...E.held.keys()].filter(k => k.startsWith(src + ':')).map(k => +k.split(':')[1]),
    modUI: v => E.setModUI(v, false), bendUI: v => E.setBendUI(v, false),
    track: id => E.project.tracks.find(x => x.id === id), isSx: E.isSx,
    fxSet: (t, id, n) => { E.fxOf(t).p[E.fxStateId(id)] = n; },
    changed: (t, patch, refresh) => { E.sxDirty.add(t.id); if (patch) E.queuePatch(t); E.persist(); if (refresh) E.sxRefresh(); },
    notice: E.notice, button: () => null, nav: null, setTimeout: E.T.setTimeout, clearTimeout: E.T.clearTimeout,
  }, extra));
  return { message: r.message, learn: r.learn, cancelLearn: r.cancelLearn, forget: r.forget, get learning() { return r.learning; }, r };
}

function project0() {
  return {
    selTrack: 2,
    tracks: [
      sxTrack(1, 0, { midi: { 21: 'f.cutoff', 22: 'macro2', 23: 'fx.dist.drive', 24: 'a.semi', 74: 'f.res', 10: 'a.pan', 7: 'g.master' } }),
      sxTrack(2, 2, { midi: { 21: 'b.wt', 25: 'macro4', 26: 'fx.dim.size', 27: 'g.bypass' } }),
      plainTrack(3, 3),
      sxTrack(4, 0, { arm: true, midi: { 22: 'macro1', 119: 'fx.dist.mix' } }),
      plainTrack(5, 0),
      sxTrack(6, 16, { midi: { 1: 'f.var', 64: 'a.level' } }),
    ],
  };
}

/* ---------------------------------------------------------------- tests */
test('module: imports only serum-core (with the shared ?v= suffix); no environment access at import', () => {
  const specs = [...SRC.matchAll(/\bimport\s[^'"]*?(['"])([^'"]+)\1/g)].map(m => m[2]);
  assert.deepEqual(specs, ['./serum-core.js?v=' + N]);
  assert.doesNotMatch(SRC, /^\s*import\(/m);
  // top level: only declarations (functions, constants); the adapter reads navigator lazily
  for (const l of SRC.split('\n')) {
    if (/^(\/\/|\s|$|import |export (function|const) |\}|\/\*| \*)/.test(l)) continue;
    assert.fail('unexpected top-level statement: ' + l);
  }
  for (const k of ['decode', 'isMpe', 'targets', 'noteCh', 'noteMsg', 'exprX', 'mpeExpr', 'learnTo', 'forgetIn', 'macroOf', 'seqWrite', 's1Paired', 'writeCC', 'createMidi']) assert.equal(typeof M[k], 'function', k);
  assert.equal(M.LEARN_CCS, 120); assert.equal(M.LEARN_MS, 15000); assert.equal(M.LEARN_MS_OFF, 30000); assert.equal(M.MPE_MASTER, 1);
  assert.deepEqual({ ...M.MPE_K }, { b: 0, y: 1, z: 2, x: 3 });
  assert.ok(Object.isFrozen(M.MPE_K));
});

test('decode: channel voice messages; system / real-time messages are ignored', () => {
  assert.deepEqual(M.decode([0x90, 60, 127]), { k: 'on', ch: 1, n: 60, v: 1 });
  assert.deepEqual(M.decode([0x9f, 61, 64]), { k: 'on', ch: 16, n: 61, v: 64 / 127 });
  assert.deepEqual(M.decode([0x93, 62, 0]), { k: 'off', ch: 4, n: 62 }); // velocity 0: no release velocity
  assert.ok(!('rv' in M.decode([0x93, 62, 0])));
  assert.deepEqual(M.decode([0x81, 63, 32]), { k: 'off', ch: 2, n: 63, rv: 32 / 127 });
  assert.deepEqual(M.decode([0xa0, 60, 100]), { k: 'pat', ch: 1, n: 60, v: 100 / 127 });
  assert.deepEqual(M.decode([0xb5, 74, 99]), { k: 'cc', ch: 6, cc: 74, val: 99 });
  assert.deepEqual(M.decode([0xe0, 0, 64]), { k: 'bend', ch: 1, v: 0 });
  assert.deepEqual(M.decode([0xe1, 0, 0]), { k: 'bend', ch: 2, v: -1 });
  assert.deepEqual(M.decode([0xe1, 127, 127]), { k: 'bend', ch: 2, v: 8191 / 8192 });
  assert.deepEqual(M.decode([0xd2, 50]), { k: 'at', ch: 3, v: 50 / 127 });
  assert.deepEqual(M.decode(Uint8Array.from([0xcf, 7])), { k: 'pc', ch: 16, n: 7 });
  for (const d of [[0xf8], [0xfe], [0xf0, 1, 2, 3, 0xf7], [0xf2, 0, 0], [], [0x90, 60]]) assert.equal(M.decode(d), null, JSON.stringify(d));
});

test('targets: identical to the Phase-1 rule for every project without MPE tracks', () => {
  const rnd = prng(7);
  for (let k = 0; k < 400; k++) {
    const n = 1 + Math.floor(rnd() * 6), tracks = [];
    for (let i = 0; i < n; i++) {
      const ch = rnd() < 0.4 ? 0 : 1 + Math.floor(rnd() * 16), o = { arm: rnd() < 0.3 };
      tracks.push(rnd() < 0.5 ? sxTrack(i + 1, ch, o) : plainTrack(i + 1, ch, o));
    }
    const project = { tracks, selTrack: 1 + Math.floor(rnd() * (n + 1)) };
    for (let src = 0; src <= 16; src++) assert.deepEqual(M.targets(tracks, project.selTrack, src), targetsP1(project, src), `case ${k} src ${src}`);
  }
});

test('targets: MPE zone — an MPE track listening on a channel receives every channel; Omni and src 0 keep Phase 1', () => {
  const a = sxTrack(1, 1, { mpe: true }), b = plainTrack(2, 5), c = sxTrack(3, 0, { mpe: true }), d = sxTrack(4, 9);
  const tracks = [a, b, c, d];
  for (let src = 1; src <= 16; src++) {
    const ids = M.targets(tracks, 4, src).map(t => t.id);
    assert.ok(ids.includes(1), 'MPE track on ch 1 receives ch ' + src);
    assert.equal(ids.includes(2), src === 5);
    assert.ok(!ids.includes(3), 'MPE on Omni, not selected / armed: Phase-1 rule');
    assert.equal(ids.includes(4), src === 9);
  }
  assert.deepEqual(M.targets(tracks, 2, 0).map(t => t.id), [2]); // keyboard: selected + armed only
  c.arm = true;
  assert.deepEqual(M.targets(tracks, 2, 7).map(t => t.id), [1, 3]);
  // MPE needs a Serum state with global.mpe.on
  assert.equal(M.isMpe(a), true); assert.equal(M.isMpe(d), false); assert.equal(M.isMpe(b), false);
  assert.equal(M.isMpe({ model: 'juno60', vals: { s: { global: { mpe: { on: 1 } } } } }), false);
  assert.equal(M.isMpe({ model: 'serum', vals: {} }), false); assert.equal(M.isMpe(null), false);
});

test('noteMsg: MIDI notes to MPE tracks carry ch; everything else is the Phase-1 message object', () => {
  const a = sxTrack(1, 1, { mpe: true }), d = sxTrack(4, 9), m = { t: 'on', n: 60, v: 0.5 }, off = { t: 'off', n: 60, rv: 0.2 };
  assert.equal(M.noteMsg(d, m, 3), m);
  assert.equal(M.noteMsg(a, m, 0), m); // on-screen / computer keyboard: ch 0 (no channel)
  assert.deepEqual(M.noteMsg(a, m, 3), { t: 'on', n: 60, v: 0.5, ch: 3 });
  assert.deepEqual(M.noteMsg(a, off, 1), { t: 'off', n: 60, rv: 0.2, ch: 1 });
  assert.deepEqual(m, { t: 'on', n: 60, v: 0.5 }, 'input not mutated');
});

test('noteCh / noteMsg: a note-off carries the channel its note-on carried (MPE switched while the key is down)', () => {
  const a = sxTrack(1, 1, { mpe: true }), d = sxTrack(4, 9), p = plainTrack(5, 2);
  assert.equal(M.noteCh(a, 3), 3); assert.equal(M.noteCh(a, 1), 1); assert.equal(M.noteCh(a, 0), 0);
  assert.equal(M.noteCh(d, 3), 0); assert.equal(M.noteCh(p, 3), 0); assert.equal(M.noteCh(null, 3), 0);
  const on = { t: 'on', n: 60, v: 0.5 }, off = { t: 'off', n: 60, rv: 0.25 }, off0 = { t: 'off', n: 60 };
  // the host keeps noteCh(t, src) of the note-on with the held note …
  const ch = M.noteCh(a, 3);
  assert.deepEqual(M.noteMsg(a, on, 3, ch), { t: 'on', n: 60, v: 0.5, ch: 3 });
  // … MPE is switched off (or another preset loaded) while the key is down: the note-off still matches its voice
  a.vals.s.global.mpe.on = 0;
  assert.equal(M.noteMsg(a, off, 3), off, 'without the stored channel: the Phase-1 message');
  assert.deepEqual(M.noteMsg(a, off, 3, ch), { t: 'off', n: 60, rv: 0.25, ch: 3 });
  // the other way round: the note-on had no channel, MPE switched on before the note-off
  const ch0 = M.noteCh(d, 7);
  d.vals.s.global.mpe.on = 1;
  assert.deepEqual(M.noteMsg(d, off0, 7), { t: 'off', n: 60, ch: 7 });
  assert.equal(M.noteMsg(d, off0, 7, ch0), off0, 'stored channel 0: the Phase-1 message object');
  assert.deepEqual(off, { t: 'off', n: 60, rv: 0.25 }, 'input not mutated');
});

test('exprX / mpeExpr: §6.17 expression mapping, master vs member channels', () => {
  assert.equal(M.exprX(0), -1); assert.equal(M.exprX(64), 0); assert.equal(M.exprX(127), 1);
  for (let c = 1; c < 128; c++) assert.ok(M.exprX(c) > M.exprX(c - 1));
  const E = d => M.mpeExpr(M.decode(d));
  assert.deepEqual(E([0xe2, 0, 0]), { k: 'b', v: -1 });
  assert.equal(E([0xe0, 0, 0]), null, 'master bend: Phase-1 global bend');
  assert.deepEqual(E([0xd1, 127]), { k: 'z', v: 1 });
  assert.equal(E([0xd0, 127]), null, 'master pressure: Phase-1 aftertouch');
  assert.deepEqual(E([0xb3, 74, 127]), { k: 'y', v: 1 });
  assert.deepEqual(E([0xb0, 74, 0]), { k: 'y', v: 0 });
  assert.deepEqual(E([0xb3, 10, 0]), { k: 'x', v: -1 });
  assert.equal(E([0xb0, 10, 0]), null, 'CC10 on channel 1 is not MPE');
  for (const d of [[0x93, 60, 1], [0xa3, 60, 1], [0xb3, 1, 1], [0xb3, 11, 1], [0xc3, 1], [0xf8]]) assert.equal(E(d), null, JSON.stringify(d));
});

test('learn map edits and macroOf', () => {
  const m = { 1: 'f.cutoff', 7: 'a.level', 9: 'f.cutoff' };
  assert.equal(M.learnTo(m, 21, 'f.cutoff'), m);
  assert.deepEqual(m, { 7: 'a.level', 21: 'f.cutoff' });
  M.learnTo(m, 7, 'macro1');
  assert.deepEqual(m, { 7: 'macro1', 21: 'f.cutoff' });
  assert.deepEqual(M.forgetIn(m, 'f.cutoff'), { 7: 'macro1' });
  assert.deepEqual(M.forgetIn(m, 'nothing'), { 7: 'macro1' });
  assert.deepEqual(['macro1', 'macro4', 'macro8', 'm1', 'm8', 'macro9', 'm0', 'm9', 'f.cutoff', 'macro', 'mm1'].map(M.macroOf), [0, 3, 7, 0, 7, -1, -1, -1, -1, -1, -1]);
});

test('writeCC: macros, macro destinations, FX ids through fxSet, master/bypass and synth ids in s.p', () => {
  const s = sxState(), fx = [], set = (id, n) => fx.push([id, n]);
  assert.equal(M.writeCC(s, 'macro3', 127, set), true); assert.equal(s.macros[2].v, 1);
  assert.equal(M.writeCC(s, 'macro7', 0, set), true); assert.equal(s.macros[6].v, 0);
  assert.equal(M.writeCC(s, 'm2', 127, set), true); assert.equal(s.macros[1].v, 1, 'virtual macro destination → its macro');
  assert.ok(!('m2' in s.p) && !('macro3' in s.p));
  assert.equal(M.writeCC(s, 'fx.dist.drive', 64, set), true);
  assert.deepEqual(fx, [['fx.dist.drive', 64 / 127]]);
  M.writeCC(s, 'g.master', 100, set); M.writeCC(s, 'g.bypass', 127, set);
  assert.equal(s.p['g.master'], core.midiValue('g.master', 100)); assert.equal(s.p['g.bypass'], core.midiValue('g.bypass', 127));
  assert.equal(fx.length, 1, 'master / bypass are Serum state values');
  M.writeCC(s, 'a.semi', 67, set);
  assert.equal(s.p['a.semi'], core.midiValue('a.semi', 67), 'stepped destination: grid-exact (§8.1)');
  M.writeCC(s, 'f.cutoff', 32, set);
  assert.equal(s.p['f.cutoff'], 32 / 127);
  const before = JSON.stringify(s);
  assert.equal(M.writeCC(s, 'no.such', 10, set), false);
  assert.equal(JSON.stringify(s), before);
});

test('writeCC / seqWrite: the virtual arp / clip destinations write the selected slot (EDIT ALL: every slot), grid-exact', () => {
  const s = sxState(), set = () => assert.fail('no FX write');
  assert.ok(core.VIRTUAL.includes('arp.shift') && core.VIRTUAL.includes('clip.trans') && !core.VIRTUAL.includes('arp.on'));
  s.arp.sel = 3;
  const before = s.arp.slots.map(x => ({ ...x.n }));
  assert.equal(M.writeCC(s, 'arp.rate', 127, set), true);
  assert.equal(s.arp.slots[3].n.rate, 1);
  assert.equal(M.writeCC(s, 'arp.shift', 50, set), true);
  assert.equal(s.arp.slots[3].n.shift, core.midiValue('arp.shift', 50), 'stepped: grid-exact (§8.1)');
  assert.equal(Math.round(s.arp.slots[3].n.shift * 48), s.arp.slots[3].n.shift * 48);
  s.arp.slots.forEach((x, j) => { if (j !== 3) assert.deepEqual(x.n, before[j], 'other slots untouched'); });
  for (const id of ['arp.rate', 'arp.shift']) assert.ok(!(id in s.p), id + ' is never stored in s.p (§3.11.3)');
  s.arp.editAll = 1;
  M.writeCC(s, 'arp.gate', 0, set);
  assert.ok(s.arp.slots.every(x => x.n.gate === 0), 'EDIT ALL: every slot');
  s.clip.sel = 11;
  assert.equal(M.writeCC(s, 'clip.trans', 127, set), true);
  assert.equal(s.clip.clips[11].n.trans, core.midiValue('clip.trans', 127));
  assert.ok(s.clip.clips.slice(0, 11).every(x => x.n.trans === 0.5));
  // arp.on / clip.on are stored destinations (s.p)
  M.writeCC(s, 'arp.on', 127, set); M.writeCC(s, 'clip.on', 0, set);
  assert.equal(s.p['arp.on'], 1); assert.equal(s.p['clip.on'], 0);
  // seqWrite alone: only virtual ids; a state without slots writes nothing
  assert.equal(M.seqWrite(s, 'arp.on', 1), false); assert.equal(M.seqWrite(s, 'f.cutoff', 1), false);
  assert.equal(M.seqWrite({ p: {} }, 'arp.rate', 1), false);
  assert.equal(M.writeCC({ p: {}, macros: [] }, 'clip.rate', 64, set), false);
  assert.equal(M.writeCC({ p: {}, macros: [] }, 'macro2', 64, set), false, 'a missing macro: nothing (not s.p)');
  // the result is what serum-core reads back as the destination's base (destBase), and survives normalisation
  s.arp.editAll = 0; s.arp.sel = 5;
  M.writeCC(s, 'arp.range', 127, set);
  assert.equal(core.destBase(s, null, 'arp.range'), 1);
  const N = core.normalizeSerum(JSON.parse(JSON.stringify(s)));
  assert.equal(N.arp.slots[5].n.range, 1); assert.equal(N.clip.clips[11].n.trans, s.clip.clips[11].n.trans);
});

test('seqWrite: arp.rate writes n.hz in HZ mode (each slot by its own mode under EDIT ALL); writes mark the bank modified', () => {
  const s = sxState(), set = () => assert.fail('no FX write'), row = st => Q.compileSeq(st, { bpm: 120 }).seqT.parts.arp2.row;
  s.p['arp.on'] = 1;
  s.arp.sel = 2; s.arp.slots[2].bpm = 0;                 // the BPM / HZ switch on HZ
  assert.equal(s.arp.dirty | 0, 0); assert.equal(s.clip.dirty | 0, 0);
  const rate0 = s.arp.slots[2].n.rate, r0 = row(s);
  for (const cc of [0, 64, 127]) {
    assert.equal(M.writeCC(s, 'arp.rate', cc, set), true);
    assert.equal(s.arp.slots[2].n.hz, cc / 127, 'HZ mode: the Hz rate the sequencer reads (bpm = 0) — cc ' + cc);
    assert.equal(s.arp.slots[2].n.rate, rate0, 'the hidden BPM rate is left alone');
    assert.equal(row(s)[5], cc / 127, 'seqT carries the new Hz rate');
    assert.equal(row(s)[4], r0[4]);
  }
  assert.equal(s.arp.dirty, 1, 'bank modified, as after a knob edit');
  assert.equal(s.clip.dirty | 0, 0, 'the clip bank is untouched');
  // EDIT ALL over a mixed bank: BPM slots write n.rate, HZ slots n.hz
  const t = sxState();
  t.arp.editAll = 1;
  t.arp.slots.forEach((x, j) => { x.bpm = j % 3 ? 1 : 0; });
  const before = t.arp.slots.map(x => ({ ...x.n }));
  M.writeCC(t, 'arp.rate', 32, set);
  t.arp.slots.forEach((x, j) => {
    const k = j % 3 ? 'rate' : 'hz', o = k === 'rate' ? 'hz' : 'rate';
    assert.equal(x.n[k], 32 / 127, `slot ${j} (${k})`);
    assert.equal(x.n[o], before[j][o], `slot ${j}: ${o} untouched`);
  });
  // the other arp destinations do not depend on the mode
  M.writeCC(t, 'arp.gate', 127, set);
  assert.ok(t.arp.slots.every(x => x.n.gate === 1));
  // clips: a learned clip destination marks the clip bank modified; nothing written → nothing marked
  const c = sxState();
  assert.equal(M.writeCC(c, 'clip.offset', 127, set), true);
  assert.equal(c.clip.dirty, 1); assert.equal(c.arp.dirty | 0, 0);
  const e = sxState();
  e.arp.slots = e.arp.slots.map(() => null);
  assert.equal(M.seqWrite(e, 'arp.rate', 1), false);
  assert.equal(e.arp.dirty | 0, 0);
  // the knob's own key choice (sx-ui-seq arpKnob) — the two agree for every slot
  const k = sxState();
  k.arp.slots.forEach((x, j) => { x.bpm = j & 1; });
  for (let j = 0; j < k.arp.slots.length; j++) {
    k.arp.sel = j;
    const sl = k.arp.slots[j], key = sl.bpm ? 'rate' : 'hz';
    M.seqWrite(k, 'arp.rate', 0.125);
    assert.equal(sl.n[key], 0.125, 'slot ' + j);
  }
});

test('writeCC: a learned write of an S1-paired field keeps the pair in sync (§2.6.4) exactly as a panel edit does', () => {
  const ids = core.S1_PAIRS.flatMap(p => p.v1.concat(p.s2));
  assert.deepEqual(ids.filter(M.s1Paired), ids);
  for (const id of ['f.cutoff', 'a.wt', 'a.w2', 'g.master', 'arp.rate', 'macro1', '', null]) assert.equal(M.s1Paired(id), false, String(id));
  const set = () => assert.fail('no FX write'), J = x => JSON.parse(JSON.stringify(x));
  for (const s1 of [0, 1]) {
    for (const id of ids) {
      for (const cc of [0, 1, 17, 40, 64, 90, 126, 127]) {
        const s = core.normalizeSerum(core.defaultSerum()); s.global.s1 = s1;
        const u = J(s);
        assert.equal(M.writeCC(s, id, cc, set), true);
        u.p[id] = core.midiValue(id, cc); core.syncS1(u, id);     // the panel: s.p[id] = v, then core.syncS1 (serum-ui)
        assert.deepEqual(J(s), u, `S1 ${s1}: ${id} cc ${cc}`);
      }
    }
  }
  // the reviewers' cases: S2 mode — Filter Type / Bend Up learned on the S2 ids move the v1 fields by the inverse map …
  const s = core.normalizeSerum(core.defaultSerum()); s.global.s1 = 0;
  M.writeCC(s, 'f.type2', 20, set); M.writeCC(s, 'g.bu2', 12, set);
  assert.equal(s.p['f.type'], Math.round(107 * s.p['f.type2']) / 95);
  assert.equal(s.p['g.bendup'], (core.lawValue('g.bu2', s.p['g.bu2']) + 24) / 48);
  assert.deepEqual(core.syncS1(J(s), '-'), [], 'no "S1 rendition differs"');
  // … a Phase-1 map on a v1 id still moves the active S2 field after S1 is switched off (forward map) …
  const t = core.normalizeSerum(core.defaultSerum()); t.global.s1 = 0;
  M.writeCC(t, 'f.type', 127, set);
  assert.equal(t.p['f.type2'], 95 / 107);
  M.writeCC(t, 'g.bendup', 127, set);
  assert.equal(t.p['g.bu2'], 24 / 48);
  // … S1 mode: a learned Osc A warp mode writes its S2 rendition (a.w1, a.wvar1); PHASE at a knob end sets phase memory
  const w = core.normalizeSerum(core.defaultSerum()); w.global.s1 = 1;
  const w1 = w.p['a.w1'];
  M.writeCC(w, 'a.warpMode', 127, set);
  assert.notEqual(w.p['a.w1'], w1);
  assert.deepEqual(core.syncS1(J(w), '-'), [], 'S1 mode: consistent');
  const ph = core.normalizeSerum(core.defaultSerum()); ph.global.s1 = 1;
  assert.equal(ph.osc[0].phMem, 'all');
  M.writeCC(ph, 'a.phase', 127, set);
  assert.equal(ph.osc[0].phMem, 'voice', 'S1 mode: PHASE at its upper end = per-voice phase memory');
  const p2 = core.normalizeSerum(core.defaultSerum()); p2.global.s1 = 0;
  M.writeCC(p2, 'a.phase', 127, set);
  assert.equal(p2.osc[0].phMem, 'all', 'S2 mode: PHASE is a plain knob');
});

test('writeCC with the track\'s FX state: FX ids grid-exact for the instance they address (B26); no instance → nothing', () => {
  const fx = fxc.normalizeFx({ v: 2, racks: [{ mods: [{ id: 'dist2', type: 'dist', v: 2, p: {} }, { id: 'dst1', type: 'dist', v: 1, p: {} }] }, { mods: [] }, { mods: [] }] });
  const s = sxState(), w = [], set = (id, n) => w.push([id, n]);
  const r2 = fxc.fxDest('fx.dist2.mode', fx).row, r1 = fxc.fxDest('fx.dst1.mode', fx).row;
  assert.ok(r2.hi !== r1.hi, 'S2 and S1 distortion have different mode counts');
  for (const cc of [0, 1, 37, 64, 100, 126, 127]) {
    w.length = 0;
    assert.equal(M.writeCC(s, 'fx.dist2.mode', cc, set, fx), true);
    assert.equal(M.writeCC(s, 'fx.dst1.mode', cc, set, fx), true);
    const [[, a], [, b]] = w;
    assert.equal(a, core.midiValue('fx.dist2.mode', cc, fx)); assert.equal(b, core.midiValue('fx.dst1.mode', cc, fx));
    assert.equal(Math.round(a * r2.hi), a * r2.hi, 'S2 mode on its grid: cc ' + cc);
    assert.equal(Math.round(b * r1.hi), b * r1.hi, 'S1 mode on its grid: cc ' + cc);
  }
  w.length = 0;
  assert.equal(M.writeCC(s, 'fx.gone.mode', 64, set, fx), false, 'an instance the rack no longer has');
  assert.equal(M.writeCC(s, 'fx.dist.drive', 64, set, fx), false, 'a static v1 id with no matching instance in a v2 state');
  assert.deepEqual(w, []);
  // a migrated Phase-1 rack: static ids address the migrated instances, with the Phase-1 values
  const v1 = fxc.defaultFxV1();
  for (const k of Object.keys(v1.p)) if (/\.on$/.test(k)) v1.p[k] = 1;
  const mig = fxc.migrateFx1(v1, null);
  for (const id of ['fx.dist.drive', 'fx.dist.mode', 'fx.dist.on', 'fx.dim.size']) {
    for (const cc of [0, 33, 64, 127]) {
      w.length = 0;
      assert.equal(M.writeCC(s, id, cc, set, mig), true, id);
      assert.deepEqual(w, [[id, core.midiValue(id, cc)]], id + ' ' + cc);
    }
  }
  // without an FX state (or a v1 one): the Phase-1 static rows
  w.length = 0;
  M.writeCC(s, 'fx.dist.mode', 64, set); M.writeCC(s, 'fx.dist.mode', 64, set, v1);
  assert.deepEqual(w, [['fx.dist.mode', core.midiValue('fx.dist.mode', 64)], ['fx.dist.mode', core.midiValue('fx.dist.mode', 64)]]);
});

test('router ≡ Phase-1 main.js dispatch: seeded random streams with learn / cancel / forget (calls, order, states)', async () => {
  const DESTS = ['f.cutoff', 'f.res', 'a.semi', 'a.level', 'macro1', 'macro3', 'fx.dist.drive', 'fx.dim.size', 'g.master', 'g.bypass', 'l1.rate', 'b.wt'];
  const CCS = [1, 64, 120, 123, 21, 22, 23, 24, 25, 26, 27, 74, 10, 7, 0, 119, 121, 127];
  for (let seed = 1; seed <= 12; seed++) {
    const runs = [];
    for (const impl of [phase1, v2]) {
      const rnd = prng(seed), pick = a => a[Math.floor(rnd() * a.length)], ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
      const log = [], T = timers(), project = project0(), E = world(project, log, T), learns = [], on = seed % 3 === 0;
      const btn = { textContent: '', title: '', classList: { add() {} } };
      const R = impl === phase1 ? phase1(E) : v2(E, { nav: { requestMIDIAccess: async () => ({ inputs: new Map() }) }, button: () => btn });
      if (on) { if (impl === phase1) R.setEnabled(true); else await R.r.enable(); } // learn texts / timeouts with MIDI on
      for (let i = 0; i < 1500; i++) {
        const ch = ri(0, 15), x = rnd();
        let data = null;
        if (x < 0.25) data = [0x90 | ch, ri(36, 84), rnd() < 0.15 ? 0 : ri(1, 127)];
        else if (x < 0.42) data = [0x80 | ch, ri(36, 84), ri(0, 127)];
        else if (x < 0.47) data = [0xa0 | ch, ri(36, 84), ri(0, 127)];
        else if (x < 0.7) data = [0xb0 | ch, pick(CCS), ri(0, 127)];
        else if (x < 0.78) data = [0xe0 | ch, ri(0, 127), ri(0, 127)];
        else if (x < 0.83) data = [0xd0 | ch, ri(0, 127)];
        else if (x < 0.85) data = [0xc0 | ch, ri(0, 127)];
        else if (x < 0.86) data = pick([[0xf8], [0xfe], [0xf0, 1, 0xf7]]);
        else if (x < 0.9) learns.push(R.learn(pick([1, 2, 3, 4, 6, 99]), pick(DESTS)).then(v => ['learned', i, v]));
        else if (x < 0.92) log.push(['cancel', R.cancelLearn(rnd() < 0.5)]);
        else if (x < 0.94) R.forget(pick(project.tracks), pick(DESTS));
        else if (x < 0.95) T.tick(ri(1000, 31000));
        else data = [0xb0 | ch, ri(0, 127), ri(0, 127)];
        if (data) R.message(Uint8Array.from(data), i);
        log.push(['learning', R.learning ? [R.learning.id, R.learning.dest] : null]);
      }
      R.cancelLearn(false);
      for (const l of await Promise.all(learns)) log.push(l);
      log.push(['held', [...E.held]], ['tracks', JSON.parse(JSON.stringify(project.tracks))], ['timers', T.size]);
      runs.push(log);
    }
    assert.equal(runs[1].length, runs[0].length, 'seed ' + seed);
    for (let i = 0; i < runs[0].length; i++) assert.deepEqual(runs[1][i], runs[0][i], `seed ${seed}, log entry ${i}`);
  }
});

test('router: learn lifecycle (texts, timeouts, cancel, a second learn, controllers 120–127, non-Serum tracks)', async () => {
  const log = [], T = timers(), project = project0(), E = world(project, log, T), R = v2(E);
  project.selTrack = 1; // channel 1 reaches track 1 (Omni, selected) and track 4 (Omni, armed)
  // MIDI not enabled: 30 s timeout and the "enable MIDI" text
  let p = R.learn(1, 'f.var');
  assert.deepEqual(log.pop(), ['notice', 'MIDI Learn: enable MIDI (the MIDI button by the keyboard), then move a controller — Esc cancels', 6000]);
  assert.deepEqual(R.learning, { id: 1, dest: 'f.var' });
  T.tick(29999); assert.ok(R.learning);
  T.tick(1);
  assert.equal(await p, null); assert.equal(R.learning, null);
  assert.deepEqual(log.pop(), ['notice', 'MIDI Learn cancelled', 3000]);
  // a second learn cancels the first silently
  p = R.learn(1, 'f.var');
  const p2 = R.learn(1, 'f.res');
  assert.equal(await p, null);
  assert.ok(!log.some(e => e[1] === 'MIDI Learn cancelled'));
  // controllers ≥ 120 never complete a learn; the next 0–119 does (and is then applied at once, Phase 1)
  log.length = 0;
  R.message([0xb0, 123, 0], 0); R.message([0xb0, 121, 0], 0);
  assert.ok(R.learning);
  R.message([0xb0, 30, 127], 5);
  assert.equal(await p2, 30);
  assert.equal(project.tracks[0].vals.s.midi['30'], 'f.res');
  assert.equal(project.tracks[0].vals.s.p['f.res'], 1);
  assert.deepEqual(log.filter(e => e[0] !== 'ctl' && e[0] !== 'noteOff'), [['dirty', 1], ['persist'], ['dirty', 1], ['queuePatch', 1], ['persist'], ['refresh']]);
  assert.equal(T.size, 0, 'timeout cleared');
  // a learn for a classic track resolves with the controller but maps nothing; an unknown track → null
  const p3 = R.learn(3, 'f.cutoff'); R.message([0xb2, 40, 1], 0);
  assert.equal(await p3, 40);
  assert.ok(!('vals' in project.tracks[2] && project.tracks[2].vals.s));
  const p4 = R.learn(99, 'f.cutoff'); R.message([0xb2, 41, 1], 0);
  assert.equal(await p4, null);
  // cancel returns whether a learn was pending
  assert.equal(R.cancelLearn(true), false);
  R.learn(1, 'a.level');
  assert.equal(R.cancelLearn(false), true);
  // MIDI enabled (the adapter connected): 15 s and the short text
  const nav = { requestMIDIAccess: async () => ({ inputs: new Map() }) };
  const btn = { textContent: '', title: '', classList: { add() {} } };
  const R2 = v2(E, { nav, button: () => btn });
  await R2.r.enable();
  assert.equal(R2.r.enabled, true);
  log.length = 0;
  p = R2.learn(1, 'f.var');
  assert.deepEqual(log.pop(), ['notice', 'MIDI Learn: move a controller — Esc cancels', 6000]);
  T.tick(15000);
  assert.equal(await p, null);
  // forget: Serum tracks only, with a repaint
  log.length = 0;
  R.forget(project.tracks[0], 'f.cutoff'); R.forget(project.tracks[2], 'f.cutoff');
  assert.ok(!Object.values(project.tracks[0].vals.s.midi).includes('f.cutoff'));
  assert.deepEqual(log, [['dirty', 1], ['persist'], ['refresh']]);
});

test('router: learned controllers — macros 1–8 and m1–m8, FX ids through the host, every targeted Serum track', () => {
  const log = [], T = timers(), project = project0(), E = world(project, log, T), R = v2(E);
  const [a, b, , d] = project.tracks;
  a.vals.s.midi = { 40: 'macro6', 41: 'm8', 42: 'fx.dist.drive' };
  d.vals.s.midi = { 40: 'macro2' };
  project.selTrack = 1;
  R.message([0xb0, 40, 127], 0); // channel 1: track 1 (Omni, selected) and track 4 (Omni, armed)
  assert.equal(a.vals.s.macros[5].v, 1); assert.equal(d.vals.s.macros[1].v, 1);
  R.message([0xb0, 41, 127], 0);
  assert.equal(a.vals.s.macros[7].v, 1);
  R.message([0xb0, 42, 127], 0);
  assert.equal(a.fx.p['fx.dist.drive'], 1);
  assert.ok(!('macro6' in a.vals.s.p) && !('m8' in a.vals.s.p));
  project.selTrack = 3;
  R.message([0xb1, 42, 0], 0); // channel 2: tracks 2 (ch 2) and 4 (Omni, armed), whose maps have no 42; not track 1
  assert.equal(a.fx.p['fx.dist.drive'], 1);
  assert.deepEqual(b.fx.p, {});
});

test('router: learned controllers read the track\'s FX state and write the virtual sequencer destinations', () => {
  const log = [], T = timers(), project = project0(), E = world(project, log, T);
  const fx = fxc.normalizeFx({ v: 2, racks: [{ mods: [{ id: 'dist2', type: 'dist', v: 2, p: {} }] }, { mods: [] }, { mods: [] }] });
  const writes = [];
  const R = v2(E, { fxSet: (t, id, n) => { writes.push([t.id, id, n]); const d = fxc.fxDest(id, t.fx); if (d) d.inst.p[d.pid] = n; } });
  const a = project.tracks[0];
  a.fx = fx;
  a.vals.s.midi = { 50: 'fx.dist2.mode', 51: 'arp.trans', 52: 'fx.gone.mix', 53: 'clip.offset' };
  project.selTrack = 1;
  log.length = 0;
  R.message([0xb0, 50, 64], 0);
  const n = core.midiValue('fx.dist2.mode', 64, fx), row = fxc.fxDest('fx.dist2.mode', fx).row;
  assert.deepEqual(writes, [[1, 'fx.dist2.mode', n]]);
  assert.equal(Math.round(n * row.hi), n * row.hi, 'grid-exact for the S2 instance');
  assert.equal(fx.racks[0].mods[0].p.mode, n);
  assert.deepEqual(log.filter(e => e[0] !== 'ctl'), [['dirty', 1], ['queuePatch', 1], ['persist'], ['refresh']]);
  log.length = 0;
  R.message([0xb0, 51, 127], 0);
  assert.equal(a.vals.s.arp.slots[a.vals.s.arp.sel].n.trans, 1); assert.ok(!('arp.trans' in a.vals.s.p));
  R.message([0xb0, 53, 127], 0);
  assert.equal(a.vals.s.clip.clips[a.vals.s.clip.sel].n.offset, 1);
  assert.equal(log.filter(e => e[0] === 'queuePatch').length, 2);
  // a learned destination with nothing to write: no state change, no patch, no repaint
  log.length = 0; writes.length = 0;
  R.message([0xb0, 52, 99], 0);
  assert.deepEqual(writes, []); assert.deepEqual(log.filter(e => e[0] !== 'ctl'), []);
});

test('router: MPE zone routing (§12.6) — member expressions to MPE tracks, Phase-1 controls to the others', () => {
  const log = [], T = timers();
  const mp = sxTrack(1, 1, { mpe: true, midi: { 74: 'f.res' } }), other = plainTrack(2, 3), sel = sxTrack(3, 16);
  const project = { selTrack: 3, tracks: [mp, other, sel] };
  const E = world(project, log, T);
  E.targets = src => M.targets(project.tracks, project.selTrack, src);
  const R = v2(E);
  const run = d => { log.length = 0; R.message(d, 7); return log.slice(); };
  // member-channel bend: per-note bend of the MPE track; the other ch-3 target keeps the Phase-1 bend (+ the wheel UI)
  assert.deepEqual(run([0xe2, 0, 0]), [['post', 1, { t: 'mpe', ch: 3, k: 'b', v: -1 }], ['ctl', 'bend', -1, 3, 7, [2]], ['bendUI', 0, false]]);
  // member channel with only the MPE track: no Phase-1 bend, no wheel UI
  assert.deepEqual(run([0xe4, 0, 64]), [['post', 1, { t: 'mpe', ch: 5, k: 'b', v: 0 }]]);
  // master channel 1: Phase-1 global bend and aftertouch (the selected Omni track and the MPE track)
  assert.deepEqual(run([0xe0, 0, 0]), [['ctl', 'bend', -1, 1, 7, null], ['bendUI', 0, false]]);
  assert.deepEqual(run([0xd0, 127]), [['ctl', 'at', 1, 1, 7, null]]);
  // member pressure → z; CC74 → y on any channel (learned CC74 still applies); CC10 → x on members only
  assert.deepEqual(run([0xd5, 127]), [['post', 1, { t: 'mpe', ch: 6, k: 'z', v: 1 }]]);
  const y = run([0xb0, 74, 127]);
  assert.deepEqual(y.slice(0, 1), [['post', 1, { t: 'mpe', ch: 1, k: 'y', v: 1 }]]);
  assert.equal(mp.vals.s.p['f.res'], 1);
  assert.deepEqual(run([0xb7, 10, 127]), [['post', 1, { t: 'mpe', ch: 8, k: 'x', v: 1 }]]);
  assert.deepEqual(run([0xb0, 10, 127]), [], 'CC10 on channel 1: not MPE (no learned controller either)');
  // notes and other messages: Phase-1 dispatch (main.js adds ch through noteMsg)
  assert.deepEqual(run([0x93, 60, 127]), [['noteOn', 60, 1, 4, 7]]);
  assert.deepEqual(run([0xa3, 60, 127]), [['post', 1, { t: 'pat', n: 60, v: 1 }]]);
  // the same messages with MPE off: Phase-1 routing exactly
  mp.vals.s.global.mpe.on = 0;
  assert.deepEqual(run([0xe2, 0, 0]), [['ctl', 'bend', -1, 3, 7, null], ['bendUI', 0, false]]);
  assert.deepEqual(run([0xd5, 127]), [['ctl', 'at', 1, 6, 7, null]]);
  assert.deepEqual(run([0xb7, 10, 127]), []);
});

test('router: CC120 / CC123 release the channel\'s held notes; on the MPE master channel of an MPE target, every channel', () => {
  const log = [], T = timers();
  const mp = sxTrack(1, 2, { mpe: true }), other = plainTrack(2, 3), sel = sxTrack(3, 16);
  const project = { selTrack: 3, tracks: [mp, other, sel] };
  const E = world(project, log, T);
  E.targets = src => M.targets(project.tracks, project.selTrack, src);
  const R = v2(E);
  const offs = () => log.filter(e => e[0] === 'noteOff').map(e => [e[2], e[3]]);
  const hold = () => { for (const [ch, n] of [[1, 60], [3, 62], [5, 64], [16, 65], [5, 66]]) R.message([0x90 | (ch - 1), n, 100], 0); };
  for (const cc of [120, 123]) {
    // a member channel: the Phase-1 rule (that channel's notes only)
    hold(); log.length = 0;
    R.message([0xb4, cc, 0], 1);
    assert.deepEqual(offs(), [[64, 5], [66, 5]], 'CC' + cc + ' on channel 5');
    // the master channel with an MPE target: the zone (every channel)
    log.length = 0;
    R.message([0xb0, cc, 0], 2);
    assert.deepEqual(offs(), [[60, 1], [62, 3], [65, 16]], 'CC' + cc + ' on the master channel');
    assert.equal(E.held.size, 0);
    // MPE off: Phase 1 exactly (channel 1's notes only)
    mp.vals.s.global.mpe.on = 0;
    hold(); log.length = 0;
    R.message([0xb0, cc, 0], 3);
    assert.deepEqual(offs(), [[60, 1]], 'CC' + cc + ' on channel 1 without MPE');
    for (const ch of [3, 5, 16]) R.message([0xb0 | (ch - 1), 123, 0], 4);
    assert.equal(E.held.size, 0);
    mp.vals.s.global.mpe.on = 1;
  }
  // an MPE track on Omni, neither selected nor armed, is no target of channel 1: no zone
  mp.ch = 0; hold(); log.length = 0;
  R.message([0xb0, 123, 0], 5);
  assert.deepEqual(offs(), [[60, 1]]);
});

test('adapter: Enable MIDI button, permission auto-connect, retry, hot-plug, unsupported browsers', async () => {
  const mkBtn = () => ({ textContent: 'Enable MIDI', title: '', disabled: false, cls: [], classList: { add(c) { this.owner.cls.push(c); } } });
  const host = (nav, btn, sink) => {
    const b = btn; b.classList.owner = b;
    return M.createMidi({ nav, button: () => b, notice() {}, targets: () => [], noteOn: (...a) => sink.push(['on', ...a]), noteOff() {}, ctl() {}, post() {}, heldNotes: () => [], programChange() {}, modUI() {}, bendUI() {}, track() {}, isSx: () => false, fxSet() {}, changed() {} });
  };
  // unsupported: wire() marks the button at once
  let b = mkBtn(), R = host({}, b, []);
  R.wire();
  await 0;
  assert.equal(b.textContent, 'MIDI: not supported in this browser'); assert.equal(b.disabled, true); assert.deepEqual(b.cls, ['unsup']);
  assert.equal(R.enabled, false);
  b = mkBtn(); R = host(undefined, b, []); // no navigator at all
  await R.enable();
  assert.equal(b.textContent, 'MIDI: not supported in this browser');
  // permission 'prompt': wire() requests nothing; the click does; a denial offers a retry, which works
  let calls = 0, reject = true, state = 'prompt', access = null;
  const inputs = new Map([[1, { name: 'KeyStep' }]]);
  const nav = {
    requestMIDIAccess: () => { calls++; return reject ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve(access = { inputs }); },
    permissions: { query: async () => ({ state, onchange: null }) },
  };
  const sink = [];
  b = mkBtn(); R = host(nav, b, sink);
  R.wire();
  await new Promise(r => setTimeout(r, 5));
  assert.equal(calls, 0); assert.equal(b.textContent, 'Enable MIDI'); assert.equal(typeof b.onclick, 'function');
  b.onclick(); assert.equal(b.textContent, 'MIDI: connecting…');
  await new Promise(r => setTimeout(r, 5));
  assert.equal(calls, 1); assert.equal(b.textContent, 'MIDI blocked — click to retry');
  assert.equal(b.title, 'If no prompt appears, allow MIDI for this site in the browser’s site settings');
  assert.equal(R.enabled, false);
  reject = false; b.onclick();
  await new Promise(r => setTimeout(r, 5));
  assert.equal(calls, 2); assert.equal(b.textContent, 'MIDI: KeyStep'); assert.equal(b.title, 'Connected MIDI inputs');
  assert.equal(R.enabled, true);
  b.onclick(); await 0; assert.equal(calls, 2, 'connected: no second request');
  // the input delivers to the router
  inputs.get(1).onmidimessage({ data: Uint8Array.from([0x91, 60, 127]), timeStamp: 12 });
  assert.deepEqual(sink, [['on', 60, 1, 2, 12]]);
  // hot-plug: statechange re-hooks every input; no inputs → the plug-in hint
  inputs.set(2, { name: 'Seaboard' }); access.onstatechange();
  assert.equal(b.textContent, 'MIDI: KeyStep, Seaboard'); assert.equal(inputs.get(2).onmidimessage, inputs.get(1).onmidimessage);
  inputs.clear(); access.onstatechange();
  assert.equal(b.textContent, 'MIDI: no devices'); assert.equal(b.title, 'Plug in a MIDI controller — it is picked up automatically');
  // permission already granted: wire() connects by itself; a later grant (onchange) too
  calls = 0; state = 'granted'; inputs.set(1, { name: 'KeyStep' });
  b = mkBtn(); R = host(nav, b, []);
  R.wire(); await new Promise(r => setTimeout(r, 5));
  assert.equal(calls, 1); assert.equal(b.textContent, 'MIDI: KeyStep');
  let perm = null; state = 'prompt'; calls = 0;
  const nav2 = Object.assign({}, nav, { permissions: { query: async () => (perm = { state }) } });
  b = mkBtn(); R = host(nav2, b, []);
  R.wire(); await new Promise(r => setTimeout(r, 5));
  assert.equal(calls, 0);
  perm.state = 'granted'; perm.onchange(); await new Promise(r => setTimeout(r, 5));
  assert.equal(calls, 1); assert.equal(b.textContent, 'MIDI: KeyStep');
  // 'midi' unsupported as a permission name: query throws or rejects — the button still works
  for (const q of [() => { throw new TypeError('midi'); }, () => Promise.reject(new TypeError('midi'))]) {
    b = mkBtn(); R = host(Object.assign({}, nav, { permissions: { query: q } }), b, []);
    assert.doesNotThrow(() => R.wire());
    await new Promise(r => setTimeout(r, 5));
    assert.equal(typeof b.onclick, 'function');
  }
});
