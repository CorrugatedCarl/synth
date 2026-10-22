// Stage 9 golden refs (IMPL-9 §3.7, D2 / D7; lane E9). tests/ref-9/ holds verbatim copies of patch-dsp.js, moog-dsp.js and engine.js
// frozen by the lead at the acceptance commit (after the listening gate, §7.3), with MANIFEST.json { note, commit, files: { f: {
// sha256 } } } (ref-7d's format). Side A = the current tree with those three files replaced by the frozen copies (every other
// module current: models.js's map, patch-core's payload, moog-core's presets); side B = the current tree. Every case renders a 900
// Series on both through the golden harness and must be bit-identical: max |A − B| === 0. From the freeze on, ref-9 guards the
// patch family as ref-7a…7d guard the drum machines (D2): a later stage's change to the shared files keeps them all.
// BEFORE THE FREEZE (no tests/ref-9/MANIFEST.json yet) side A is the current tree in a scope of its own: the test then checks B
// against itself — determinism, not the frozen sound — and says so in a diagnostic. Until moog-dsp.js (lane V9b) is on the branch
// there is nothing to render: every test says so and returns. The freeze (the lead, after the fix round and the user's listening):
// GOLDEN_FREEZE_9=1 node --max-old-space-size=2048 --test tests/golden-moog.test.mjs writes tests/ref-9/ from the working tree (the
// commit: git HEAD); then set PIN below to the manifest's hashes. GOLDEN_MOOG_FAMILY=<file> renders with that script in place of
// moog-dsp.js on both sides (a stand-in family of PatchDSP's shape: a development aid only, refused with the freeze).
// Cases (the controller's keys as {t: on} notes, knob changes as {t: patch}, re-patches as the graph payload, all on the 128-frame
// grid): every module type alone or with what it needs at three settings — the 921 at its six ranges (its four waveforms through
// the mixer, notes on FREQUENCY CONTROL 1), its AUX at every waveform, the 921B at its six ranges driven by a 921A, the 904A at k 0 /
// 2 / 4.4 on a 1.73 V saw and self-oscillating under the keys (1 V/oct; the GATE's steps kick it), the 902 in LIN and EXP, the 911
// short and long (SINGLE:
// legato; MULTIPLE), the 907A at three band settings on white noise, the 923's three outputs and both sections, the 995's chain of
// normals; sync WEAK / STRONG; a clamp train (S at each key, V at audio rate); a 3-module feedback loop and a self-patched 921B; a
// graph change mid-note (a ramp: the 904A pulled from the VCA, the mixer plugged; then a module removed: it retires); LOW and LAST
// priority with glide; each starting patch with a note line; OS 2; 44.1 kHz × 1. Then (side B only) D7: Classic bass's bass line
// as roll notes and Drone, bounced offline (processorOptions) = live (messages), bit for bit; span invariance: the same events in
// quanta of 128, 4 and random multiples of 4 frames, bit for bit.
// Run: node --max-old-space-size=2048 --test tests/golden-moog.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as H from './golden-harness.mjs';
import * as MG from '../moog-core.js?v=9';
import * as PT from '../patch-core.js?v=9';
import { mulberry32, fnv1a32 } from '../wt.js?v=9';
import { BASS } from './bench-scenarios.mjs';

// ref-9 guards stage 9's sound: its nine module types and its six starting patches, by name (IMPL-9b skeptic #1 — a later stage's
// types and presets are unknown to ref-9's moog-dsp and are guarded by their own golden file)
const S9_TYPES = ['921', '921a', '921b', '923', '904a', '907a', '902', '911', '995'];
const S9_PRESETS = ['Classic bass', 'Filter sweep', 'Drone', 'Sync lead', 'Wind', 'Bells'];
const REF = new URL('./ref-9/', import.meta.url), FILES = ['patch-dsp.js', 'moog-dsp.js', 'engine.js'];
// the frozen hashes, pinned by the lead at the freeze (null until then: the manifest alone is checked)
const PIN = { 'patch-dsp.js': '9755c60bcb24b27a3efd8c0ef313161c64230424a086fa81d8586244dbac7235', 'moog-dsp.js': '9e6ae2f81cd040d17362ef1ca62c8b74514dd20fbaa3600edf71e90d5ebe4826', 'engine.js': '2f2f3baa3427c903fe2f065a09c09aa0e72a091719fd3a14a151ed25d234081c' }; // (frozen 2026-10-22 at 53b7e88, the stage 9 acceptance commit)
const FREEZE = process.env.GOLDEN_FREEZE_9 === '1', FAM = process.env.GOLDEN_MOOG_FAMILY || '';
if (FREEZE && FAM) throw new Error('GOLDEN_MOOG_FAMILY is a development aid: never with the freeze');
if (FREEZE) {
  mkdirSync(REF, { recursive: true });
  const files = {};
  for (const f of FILES) { const src = readFileSync(new URL(f, H.ROOT), 'utf8'); writeFileSync(new URL(f, REF), src); files[f] = { sha256: H.sha256(src) }; }
  let commit = '';
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' }).trim(); } catch { /* no git */ }
  writeFileSync(new URL('MANIFEST.json', REF), JSON.stringify({
    note: 'Frozen 900 Series sound (IMPL-9 §3.7, D2): verbatim copies of patch-dsp.js (the evaluator), moog-dsp.js (the Model 15 set\'s circuits and the controller) and engine.js (the Inst kind \'patch\') at the stage 9 acceptance commit. Never edit: tests/golden-moog.test.mjs renders them (side A, every other module current) against the current files, bit for bit.',
    commit, files }, null, 2) + '\n');
}
const FROZEN = existsSync(new URL('MANIFEST.json', REF));

const [, B0] = await H.sides();
// side B: the current tree (GOLDEN_MOOG_FAMILY: that script as moog-dsp.js); side A: B with the three frozen files (before the
// freeze: B's own sources, a scope of its own)
const famSrc = FAM ? readFileSync(FAM, 'utf8') : null;
const withFam = dsp => (famSrc === null ? dsp : dsp.filter(([f]) => f !== 'moog-dsp.js').concat([['moog-dsp.js', famSrc]]));
const B = famSrc === null ? B0 : Object.assign({}, B0, { name: 'family', dsp: withFam(B0.dsp), entries: new Map(), user: new Map(), scopes: new Map() });
const frozen = f => (FROZEN ? readFileSync(new URL(f, REF), 'utf8') : null);
const A = Object.assign({}, B, {
  name: FROZEN ? 'ref-9' : 'self', engine: frozen('engine.js') || B.engine,
  dsp: B.dsp.map(([f, c]) => [f, FILES.includes(f) ? frozen(f) || c : c]),
  entries: new Map(), user: new Map(), scopes: new Map(),
});
const SR = H.SR, S0 = H.scope(B), READY = !!S0.g.PatchDSP && !!S0.g.PatchMoog;
const WAIT = 'moog-dsp.js (lane V9b) is not on the branch yet: nothing to render';

/* ------------------------------------------------------------------ patches */
// a patch from a spec: mods [[name, type, driver name?]] (a linked type undriven without one), cords [['name.port', 'name.port']]
// ('c' the controller), knobs { name: { id: v } }, ctl { id: v } (the controller's) → { rec, vals, mid: name → module id }
function rig({ mods = [], cords = [], knobs = {}, ctl = {} }) {
  let rec = PT.fresh(MG.FAMILY.id), vals = {};
  const mid = { c: 'c' };
  for (const [name, t, drv] of mods) {
    const x = PT.addModule(rec, vals, t);
    if (!x.mid) throw new Error('rig: ' + t + ': ' + x.why);
    rec = x.rec; mid[name] = x.mid;
    if (MG.TYPES[t].link) rec = PT.setDriver(rec, x.mid, drv ? mid[drv] : null).rec;
  }
  const end = e => { const [n, port] = e.split('.'); return mid[n] + '.' + port; };
  for (const [a, b] of cords) { const r = PT.plug(rec, end(a), end(b)); if (!r.id) throw new Error(`rig: ${a} → ${b}: ${r.why}`); rec = r.rec; }
  for (const n of Object.keys(knobs)) for (const [k, v] of Object.entries(knobs[n])) vals = PT.setKnob(vals, rec, mid[n], k, v);
  for (const [k, v] of Object.entries(ctl)) vals = PT.setKnob(vals, rec, 'c', k, v);
  return { rec, vals, mid };
}
const preset = name => { const r = PT.loadPreset(PT.fresh(MG.FAMILY.id), {}, name, { ensure: MG.M15 }); if (r.why) throw new Error(name + ': ' + r.why); return { rec: r.rec, vals: r.vals }; };
const Q = (t, sr = SR) => 128 * Math.round(t * sr / 128);    // (every event on the 128-frame grid: the quanta never straddle one)
const on = (n, v = 0.8) => ({ t: 'on', n, v }), off = n => ({ t: 'off', n });
// a note line: [key, start s, length s, velocity?] → events
const line = (L, sr = SR) => L.flatMap(([n, t, d, v]) => [[Q(t, sr), on(n, v || 0.8)], [Q(t + d, sr), off(n)]]);
const LINE = [[48, 0.05, 0.3], [55, 0.4, 0.2], [43, 0.65, 0.5, 0.6], [60, 1.2, 0.25, 1]];
const LEGATO = [[48, 0.05, 0.6], [55, 0.4, 0.6], [43, 0.9, 0.3]];     // (overlapping keys: SINGLE plays legato)
const MIX4 = o => [[o + '.sin', 'c.m1'], [o + '.tri', 'c.m2'], [o + '.saw', 'c.m3'], [o + '.rec', 'c.m4'], ['c.mo', 'c.out']];
const C = (name, r, o) => Object.assign(r, { name, events: line(LINE), seconds: 1.5 }, o);
const OSC921 = (name, knobs) => C(name, rig({ mods: [['o', '921']], cords: [['c.kp1', 'o.f1'], ...MIX4('o')], knobs: { o: knobs } }));
const OSC921B = (name, knobs) => C(name, rig({ mods: [['d', '921a'], ['o', '921b', 'd']], cords: [['c.kp1', 'd.f1'], ...MIX4('o')], knobs: { o: knobs } }));
// a 921B saw (1.73 Vpp) into the 904A → MAIN OUT; its cutoff from the keys (c1) and a 911 (c2); saw false: the GATE's steps as
// its only input (a ladder at rest stays at rest: the kick that starts the whistle)
const VCF = (name, knobs, saw = true) => C(name, rig({
  mods: [['d', '921a'], ['o', '921b', 'd'], ['f', '904a'], ['e', '911']],
  cords: (saw ? [['c.kp1', 'd.f1'], ['o.saw', 'f.in']] : [['c.kg', 'f.in']]).concat([['c.kp2', 'f.c1'], ['c.ks1', 'e.trg'], ['e.out', 'f.c2'], ['f.out', 'c.out']]),
  knobs: { f: knobs, o: { rg: 3 } } }));
// a 921B saw through the 902 under a 911 (the VCA path): the 902's mode, the 911's times, the trigger mode, a key line
const VCA = (name, amp, env, ctl, L = LINE) => C(name, rig({
  mods: [['d', '921a'], ['o', '921b', 'd'], ['e', '911'], ['a', '902']],
  cords: [['c.kp1', 'd.f1'], ['o.saw', 'a.i1'], ['c.ks1', 'e.trg'], ['e.out', 'a.c1'], ['a.o2', 'c.out']],
  knobs: { a: amp, e: env, o: { rg: 3 } }, ctl }), { events: line(L), seconds: 1.8 });
const kindOf = (r, t) => Object.keys(r.rec.mods).filter(k => r.rec.mods[k].t === t);

const CASES = [
  // the 921 at its six ranges (its other knobs swept across them), its AUX at every waveform
  ...[0, 1, 2, 3, 4, 5].map(rg => OSC921(`921: range ${rg} (sine, triangle, saw, rectangle mixed)`, { rg, pw: 20 + 12 * rg, fq: rg - 2.5, sp: rg & 1, cr: rg === 0 ? 0 : 1 })),
  C('921: AUX + / − at every waveform (switched each 0.25 s)', rig({ mods: [['o', '921'], ['a', '902']],
    cords: [['c.kp1', 'o.f1'], ['o.xp', 'c.m1'], ['o.xm', 'a.i1'], ['a.o2', 'c.m2'], ['c.mo', 'c.out']], knobs: { o: { ax: 0, al: 7 }, a: { fc: 6 } } }),
  { seconds: 1.6, events: line(LINE).concat([1, 2, 3, 4, 5].map(ax => [Q(0.25 * ax), { knob: ['o', 'ax', ax] }])) }),
  // the 921B at its six ranges, driven by a 921A
  ...[0, 1, 2, 3, 4, 5].map(rg => OSC921B(`921B: range ${rg} driven by a 921A (its four waveforms mixed)`, { rg, fq: 2 - rg })),
  // sync at both strengths: 921B #2 synced to #1's rectangle, #2's saw out
  ...[0, 2].map(ss => C(`sync ${ss ? 'STRONG' : 'WEAK'}: 921B #2 on #1's rectangle`, rig({ mods: [['d', '921a'], ['o1', '921b', 'd'], ['o2', '921b', 'd']],
    cords: [['c.kp1', 'd.f1'], ['o1.rec', 'o2.sy'], ['o2.saw', 'c.m1'], ['c.mo', 'c.out']], knobs: { o1: { rg: 3 }, o2: { rg: 3, fq: 1, ss } } }))),        // (#2 2 semitones up: inside STRONG's window, outside WEAK's)
  // the 904A at k 0 / 2 / 4.4 on a 1.73 V saw; self-oscillating at REGENERATION 10 without input, its cutoff on the keys (1 V/oct)
  ...[0, 4.55, 10].map(re => VCF(`904A: regeneration ${re} on a 921B saw (keys and a 911 on the cutoff)`, { re, fc: -1, rg: 1 })),
  VCF('904A: self-oscillating (regeneration 10, kicked by the GATE), 1 V/oct from the keys', { re: 10, fc: 0, rg: 1 }, false),
  // the 902 in LIN and EXP under a 911
  ...[0, 1].map(md => VCA(`902: ${md ? 'EXP' : 'LIN'} under a 911`, { md, fc: md ? 1 : 0 }, { t1: 1, t2: 5, es: 7, t3: 4 }, {})),
  // the 911 short / long, SINGLE (legato) and MULTIPLE
  VCA('911: short (T1 0, T2 2, E SUS 3, T3 1), SINGLE: legato', {}, { t1: 0, t2: 2, es: 3, t3: 1 }, { rt: 0 }, LEGATO),
  VCA('911: long (T1 6, T2 8, E SUS 9, T3 7), MULTIPLE: a new attack at each key', {}, { t1: 6, t2: 8, es: 9, t3: 7 }, { rt: 1 }, LEGATO),
  // the 907A at three band settings on white noise
  ...[{}, { lo: 0, b1: 10, b2: 0, b3: 10, b4: 0, b5: 10, b6: 0, b7: 10, b8: 0, hi: 0 }, { lo: 3, b1: 6, b2: 2, b3: 8, b4: 1, b5: 9, b6: 4, b7: 7, b8: 5, hi: 10 }].map((b, k) =>
    C(`907A: bands ${['all at 10', 'alternate', 'mixed'][k]} on white noise`, rig({ mods: [['n', '923'], ['fb', '907a']], cords: [['n.wh1', 'fb.in'], ['fb.out', 'c.out']], knobs: { fb: b } }),
      { events: [], seconds: 1 })),
  // the 923: both whites, pink, the low pass and the high pass (the high pass fed from the low pass)
  C('923: white, pink, low pass → high pass', rig({ mods: [['n', '923']], cords: [['n.wh1', 'c.m1'], ['n.pk', 'c.m2'], ['n.wh2', 'n.li'], ['n.lo', 'n.hi'], ['n.ho', 'c.m3'], ['c.mo', 'c.out']],
    knobs: { n: { lp: 6, hp: 3 } } }), { events: [], seconds: 1 }),
  // the 995: one input through its chain of normals, three attenuations
  C('995: i1 normalled to i2 and i3, three levels', rig({ mods: [['d', '921a'], ['o', '921b', 'd'], ['at', '995']],
    cords: [['c.kp1', 'd.f1'], ['o.saw', 'at.i1'], ['at.o1', 'c.m1'], ['at.o2', 'c.m2'], ['at.o3', 'c.m3'], ['c.mo', 'c.out']], knobs: { at: { a1: 10, a2: 5, a3: 2.5 } } })),
  // a clamp train: S at each key (CLAMP TRIG. S), V at audio rate (a 921B's triangle − sine through a 902 at × 2)
  C('clamp: S at each key and V at audio rate', rig({ mods: [['o', '921'], ['d', '921a'], ['o1', '921b', 'd'], ['a', '902']],
    cords: [['c.kp1', 'o.f1'], ['c.ks1', 'o.cs'], ['o1.tri', 'a.i1'], ['o1.sin', 'a.i2'], ['a.o2', 'o.cv'], ['o.saw', 'c.m1'], ['c.mo', 'c.out']],
    knobs: { o: { cl: 30 }, a: { fc: 6 }, o1: { rg: 2, fq: 1.7 } } })),
  // feedback: 921B → 904A → 902 → the 921B's DC MODULATE (a loop of three); a 921B into its own AC MODULATE
  C('feedback: a loop of three (921B → 904A → 902 → 921B)', rig({ mods: [['d', '921a'], ['o', '921b', 'd'], ['f', '904a'], ['a', '902']],
    cords: [['c.kp1', 'd.f1'], ['o.saw', 'f.in'], ['f.out', 'a.i1'], ['a.o1', 'o.dc'], ['a.o2', 'c.out']], knobs: { f: { re: 6, fc: 1 }, a: { fc: 4 } } })),
  C('feedback: a self-patched 921B (its saw on its AC MODULATE)', rig({ mods: [['d', '921a'], ['o', '921b', 'd']],
    cords: [['c.kp1', 'd.f1'], ['o.saw', 'o.ac'], ['o.rec', 'c.m1'], ['c.mo', 'c.out']], knobs: { o: { rg: 3 } } })),
  // a graph change mid-note: Classic bass, the 904A pulled from the VCA and the mixer plugged in its place (ramps), then the 921 removed (retiring)
  (() => {
    const m = MG.model15(), [f] = kindOf(m, '904a'), [o3] = kindOf(m, '921');
    const c = m.rec.cords.find(x => x.a === f + '.out'), mo = m.rec.cords.find(x => x.a === 'c.mo');
    const r1 = PT.plug(PT.pull(PT.pull(m.rec, c.id).rec, mo.id).rec, 'c.mo', c.b).rec, r2 = PT.removeModule(r1, o3).rec;
    return C('a graph change mid-note: the 904A replaced by the mixer at the VCA (ramps), then the 921 removed (retiring)', m,
      { seconds: 2, events: [[Q(0.05), on(43)], [Q(0.6), { rec: r1 }], [Q(1.1), { rec: r2 }], [Q(1.6), off(43)]] });
  })(),
  // LOW and LAST priority with glide
  ...[0, 1].map(pr => { const m = MG.model15(); m.vals = PT.setKnob(PT.setKnob(m.vals, m.rec, 'c', 'pr', pr), m.rec, 'c', 'gl', 6); return C(`priority ${pr ? 'LAST' : 'LOW'} with glide (Classic bass, overlapping keys)`, m, { events: line(LEGATO), seconds: 1.8 }); }),
  // each starting patch with a note line (Drone without: it plays alone)
  ...S9_PRESETS.map(n => C(`preset: ${n}`, preset(n), { events: n === 'Drone' ? [] : line(LINE), seconds: 1.6 })),
  // OS 2; 44.1 kHz × 1
  C('Classic bass at OS 2', MG.model15(), { os: 2 }),
  C('Classic bass at 44.1 kHz × 1', MG.model15(), { os: 1, sr: 44100, events: line(LINE, 44100) }),
];

/* ------------------------------------------------------------------ rendering */
// renders case c on side X: {t: patch} (the vals through side X's models.js) and the graph payload {t: seq, s: {pg, pk}} (or the
// same as processorOptions: offline, the bounce's form, with the case's song and transport), then the events — { knob: [name, id,
// v] } a knob turned, { rec } a re-patch (its payload), else a message — posted right before the quantum at their frame; quanta of
// 128 frames, or quanta(k) frames (any multiple of 4: span invariance), never straddling an event → { L, R } (Float32)
function renderP(X, c, { quanta = null, offline = false } = {}) {
  const sr = c.sr || SR, S = H.scope(X, sr), N = Math.ceil((c.seconds || 1.5) * sr / 128) * 128, os = c.os || 4, fx = X.fxm.defaultFx2();
  const patchOf = vals => X.models.patchFor('m900', vals, fx, { sr, bpm: 120, drift: 0, prefs: { smooth: 1, silenceTails: 1 } }); // (drift 0: the goldens')
  let vals = c.vals;
  const msgOf = m => {
    if (m.rec) return { t: 'seq', s: PT.payload(m.rec) };
    if (m.knob) { const [n, k, v] = m.knob; vals = PT.setKnob(vals, c.rec, c.mid ? c.mid[n] : n, k, v); return { t: 'patch', p: patchOf(vals) }; }
    return m;
  };
  const id = 'moog:' + c.name + (offline ? ':offline' : '');
  S.g.currentFrame = 0; S.seed(id);
  const pay = PT.payload(c.rec), patch = patchOf(vals);
  const po = Object.assign({ os, hostOS: os }, offline ? { offline: true, patch, seq: pay, song: c.song || null, transport: c.transport || null } : null);
  const p = new S.Proc({ processorOptions: po });
  S.seed(id);
  if (!offline) { p.msg({ t: 'patch', p: patch }); p.msg({ t: 'seq', s: pay }); if (c.song) p.msg(H.clone(c.song)); if (c.transport) p.msg(Object.assign({}, c.transport)); }
  const ev = (c.events || []).slice().sort((a, b) => a[0] - b[0]), L = new Float32Array(N), R = new Float32Array(N), bufs = new Map();
  let e = 0, k = 0;
  for (let f = 0; f < N;) {
    while (e < ev.length && ev[e][0] <= f) p.msg(msgOf(ev[e++][1]));
    let q = quanta ? quanta(k++) : 128;
    if (e < ev.length) q = Math.min(q, ev[e][0] - f);
    q = Math.min(q, N - f);
    let o = bufs.get(q);
    if (!o) { o = [[new Float32Array(q), new Float32Array(q)]]; bufs.set(q, o); }
    p.process([], o);
    L.set(o[0][0], f); R.set(o[0][1], f);
    f += q; S.g.currentFrame = f;
  }
  return { L, R };
}

test('tests/ref-9: the frozen files match their manifest (and the pinned hashes once set)' + (FROZEN ? '' : ' — NOT FROZEN YET: side A is the current tree (determinism only)'), (t) => {
  if (!FROZEN) { t.diagnostic('tests/ref-9/MANIFEST.json missing: the lead freezes the refs at the acceptance commit (GOLDEN_FREEZE_9=1)'); return; }
  const m = JSON.parse(readFileSync(new URL('MANIFEST.json', REF), 'utf8'));
  assert.deepEqual(Object.keys(m.files).sort(), [...FILES].sort());
  for (const f of FILES) assert.equal(H.sha256(readFileSync(new URL(f, REF), 'utf8')), m.files[f].sha256, 'tests/ref-9/' + f + ' was edited');
  if (PIN) assert.deepEqual(Object.fromEntries(FILES.map(f => [f, m.files[f].sha256])), PIN, 'the manifest is the pinned freeze');
});

test('the cases are patches a player can make (patch-core: every cord plugged by canPlug, normPatch-stable), each of the nine types in one, each preset once', () => {
  for (const c of CASES) {
    assert.deepEqual(PT.normPatch(H.clone(c.rec), MG.FAMILY.id), c.rec, c.name + ': normPatch-stable');
    for (const [, m] of (c.events || [])) if (m.rec) assert.deepEqual(PT.normPatch(H.clone(m.rec), MG.FAMILY.id), m.rec, c.name + ': its re-patch');
    assert.ok(PT.live(c.rec), c.name + ': MAIN OUT patched');
  }
  const types = new Set(CASES.flatMap(c => Object.values(c.rec.mods).map(m => m.t)));
  assert.deepEqual([...types].sort(), [...S9_TYPES].sort());
  assert.deepEqual(CASES.filter(c => c.name.startsWith('preset: ')).map(c => c.name.slice(8)), S9_PRESETS);
  for (const n of S9_PRESETS) assert.ok(MG.PRESETS.some(P => P.name === n), 'stage 9 preset still shipped: ' + n);
  for (const c of CASES) assert.equal(CASES.filter(x => x.name === c.name).length, 1, 'one case per name: ' + c.name);
});

test(`D2: every module type at its settings, sync, clamps, feedback, a mid-note graph change, priorities with glide, the six presets, OS 2, 44.1 kHz — ${FROZEN ? 'ref-9 vs current' : 'current vs current (not frozen yet)'}, bit-identical`, (t) => {
  if (!READY) { t.diagnostic(WAIT); return; }
  if (!FROZEN) t.diagnostic('NOT FROZEN: side A is the current tree — these renders check determinism only');
  const bad = [], quiet = [];
  for (const c of CASES) {
    const r = [A, B].map(X => renderP(X, c));
    if (!H.finite(r[1])) bad.push(`${c.name}: not finite`);
    if (!(H.peak(r[1]) > 1e-3)) quiet.push(`${c.name} (${H.peak(r[1]).toExponential(2)})`);
    const d = H.compare(r[0], r[1]);
    if (d.max !== 0) bad.push(`${c.name}: ${H.describe(d, c.sr || SR)}`);
  }
  if (quiet.length) bad.push('silent: ' + quiet.join(', '));
  assert.deepEqual(bad, []);
});

test('the cases differ where they should (side B): the six ranges, the three regenerations, LIN / EXP, SINGLE / MULTIPLE, WEAK / STRONG, LOW / LAST, the presets', (t) => {
  if (!READY) { t.diagnostic(WAIT); return; }
  const by = p => CASES.filter(c => c.name.startsWith(p)), R = new Map(), get = c => { if (!R.has(c)) R.set(c, renderP(B, c)); return R.get(c); };
  for (const p of ['921: range', '921B: range', '904A: regeneration', '902:', '911:', 'sync', 'priority', 'preset:']) {
    const L = by(p);
    assert.ok(L.length >= 2, p);
    for (let i = 1; i < L.length; i++) assert.ok(H.compare(get(L[i - 1]), get(L[i])).max > 1e-3, `${L[i - 1].name} ≠ ${L[i].name}`);
  }
});

/* ------------------------------------------------------------------ D7 (side B) */
// D7: the bounce builds the node from processorOptions (patch, the graph payload, song, transport) — the live node from messages
// (its warm-up done: the first Track of the scope) — Classic bass's bass line as roll notes (one bar looping from tick 0, the
// transport 1024 frames in: a pre-roll, then Play from a stop's restart), and Drone (no notes: the free-running case), bit for bit
const FPT = SR * 60 / (120 * H.PPQ);
const SONG = { t: 'song', notes: BASS.flatMap((n, k) => [480 * k, 360, n, k & 1 ? 90 : 110]), cc: [] };
const TRANSPORT = { t: 'transport', play: true, frame: 1024, tick: 0, fpt: FPT, seek: true, loop: true, ls: 0, le: 3840 };
test('D7: Classic bass\'s bass line as roll notes and Drone — offline (processorOptions) = live (messages), bit-identical', (t) => {
  if (!READY) { t.diagnostic(WAIT); return; }
  for (const c of [C('d7: Classic bass, the bass line as roll notes', MG.model15(), { events: [], song: SONG, transport: TRANSPORT, seconds: 3 }),
    C('d7: Drone', preset('Drone'), { events: [], transport: Object.assign({}, TRANSPORT, { loop: false }), seconds: 2 })]) {
    const live = renderP(B, c), bounce = renderP(B, c, { offline: true });
    assert.ok(H.peak(live) > 0.01, c.name + ': it sounds');
    const d = H.compare(live, bounce);
    assert.equal(d.max, 0, c.name + ': ' + H.describe(d));
  }
});

// (notes as messages: a song's notes land on the span grid through tick → frame rounding — 40.0000000000006 frames ahead rounds up a
// whole 4-frame span — the Track's rule for every instrument, not the patch's; IMPL-9 §12 lane E9)
test('span invariance (D7): the same events in quanta of 128, 4 and random multiples of 4 frames — notes, a knob turned, a re-patch, Play from a stop — bit-identical', (t) => {
  if (!READY) { t.diagnostic(WAIT); return; }
  const base = CASES.find(c => c.name.startsWith('a graph change mid-note'));
  const c = Object.assign({}, base, { name: 'span invariance', seconds: 2,
    events: base.events.concat([[Q(0.3), on(50, 0.6)], [Q(0.45), off(50)], [Q(0.8), { t: 'transport', play: true, frame: Q(0.8) + 512, tick: 0, fpt: FPT, seek: true }],
      [Q(0.9), { t: 'bend', v: 0.4 }], [Q(1.3), { t: 'wheel', v: 0.7 }], [Q(1.4), { knob: ['c', 'x1', 8.3] }]]) });
  const r = mulberry32(fnv1a32('golden-moog-spans')), rnd = () => 4 * (1 + Math.floor(r() * 32)); // (≤ 128: a render quantum never exceeds the worklet's)
  const q128 = renderP(B, c), q4 = renderP(B, c, { quanta: () => 4 }), qr = renderP(B, c, { quanta: rnd });
  assert.ok(H.peak(q128) > 0.01, 'it sounds');
  for (const [w, x] of [['4', q4], ['random', qr]]) { const d = H.compare(q128, x); assert.equal(d.max, 0, `quanta of ${w}: ${H.describe(d)}`); }
});
