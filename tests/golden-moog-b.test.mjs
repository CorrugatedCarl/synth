// Stage 9b golden refs (IMPL-9b §8.3, D2 / D7; lane E9b). tests/ref-9b/ holds verbatim copies of patch-dsp.js, moog-dsp.js and
// engine.js frozen by the lead at 9b's acceptance (after the listening renders), with MANIFEST.json { note, commit, files: { f: {
// sha256 } } } (ref-9's format). Side A = the current tree with those three files replaced by the frozen copies (every other module
// current: models.js's map, patch-core's payload and bus rows, moog-core's presets); side B = the current tree. Every case renders a
// 900 Series on both through the golden harness and must be bit-identical: max |A − B| === 0. From the freeze on, ref-9 guards the
// Model 15 cases (tests/golden-moog.test.mjs) and ref-9b the 9b cases: the sixteen new types, the bus rows, the seven new presets.
// BEFORE THE FREEZE (no tests/ref-9b/MANIFEST.json) side A is the current tree in a scope of its own: the test then checks B against
// itself — determinism, not the frozen sound — and says so in a diagnostic. The freeze (the lead):
// GOLDEN_FREEZE_9B=1 node --max-old-space-size=2048 --test tests/golden-moog-b.test.mjs writes tests/ref-9b/ from the working tree
// (the commit: git HEAD); then set PIN below to the manifest's hashes.
// Cases (the controller's keys as {t: on} notes, knob changes as {t: patch} — a routing switch's also re-posts the graph payload, as
// H9b's ptKnob —, re-patches as the payload, the song's transport as {t: transport}, all on the 128-frame grid): each new type alone
// or with what it needs at its settings — the 904B at three cutoffs and both ranges, the 914 at three band settings (one input and
// the averaged pair), the 911A OFF / PARALLEL / SERIES, the 903A's white and pink, the 960 free (SKIP / STOP, ROW C → CLOCK, at
// audio rate on its CONTROL INPUT), song-clocked (the presets) and patched into itself, the 962 2 : 1 and 3 : 1, the 961's four
// circuits at three settings, the 994's multiples (the CP8A beside it: built, silent), the CP35's sources and attenuators, the CP2's
// filters and keyboard copies; every bus row — the 992's four, the 993's seven (FROM 1 and FROM 2), the three CP3As' routing to
// their drivers, the CP4A's CV and trigger rows; the Song clock SONG (a loop wrap, LENGTH) and ALWAYS (stopped, the project tempo);
// the seven presets with their note lines (the clocked pair from ▶); a graph change and a routing switch mid-sequence; OS 2; 44.1
// kHz × 1. Then (side B only) D7: Sequence bounced offline = live (the anchor on the 4-frame grid), live with anchors 1–3 frames
// off the grid (stage 1 on the first step); span invariance: Sequence with a loop wrap inside a 128-frame span and a tempo change's
// late re-anchor in quanta of 128, 4 and random multiples of 4 frames, bit for bit.
// Run: node --max-old-space-size=2048 --test tests/golden-moog-b.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as H from './golden-harness.mjs';
import * as MG from '../moog-core.js?v=9';
import * as PT from '../patch-core.js?v=9';
import { mulberry32, fnv1a32 } from '../wt.js?v=9';

// ref-9b guards 9b's sound: the sixteen types and the seven presets 9b added (stage 9's are ref-9's: tests/golden-moog.test.mjs)
const S9_TYPES = ['921', '921a', '921b', '923', '904a', '907a', '902', '911', '995'];
// the sixteen, literal (IMPL-9c D3: never derived from the live table, which 9c grows — ref-9b's circuits cannot render a 9c type)
const B_TYPES = ['903a', '904b', '914', '911a', '994', '960', '961', '962', 'clk', 'cp2', 'cp3a', 'cp4a', 'cp35', 'cp8a', '992', '993'];
const B_PRESETS = ['Swept band', 'Sequence', 'Twenty-four steps', 'Echo strikes', 'Vowel', 'Step bass', 'Routed'];
const REF = new URL('./ref-9b/', import.meta.url), FILES = ['patch-dsp.js', 'moog-dsp.js', 'engine.js'];
// the frozen hashes, pinned by the lead at the freeze (null until then: the manifest alone is checked)
const PIN = { 'patch-dsp.js': '9d88b661044ab32285af526e5bcf14c9b6f74e6989ad949deaffc7e9667a4f5a', 'moog-dsp.js': 'b21aa8d84aa751f628cd7f32320667954f5137b5f2acf4d0b11d32dbf93bf661', 'engine.js': 'f5cf7fecc0b9cbdc809e0746fab93451ef6cd5df8208df1ab93a8fa0017adecb' }; // (frozen 2026-10-22 at 9c3d323, the stage 9b acceptance commit)
const FREEZE = process.env.GOLDEN_FREEZE_9B === '1';
if (FREEZE) {
  mkdirSync(REF, { recursive: true });
  const files = {};
  for (const f of FILES) { const src = readFileSync(new URL(f, H.ROOT), 'utf8'); writeFileSync(new URL(f, REF), src); files[f] = { sha256: H.sha256(src) }; }
  let commit = '';
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' }).trim(); } catch { /* no git */ }
  writeFileSync(new URL('MANIFEST.json', REF), JSON.stringify({
    note: 'Frozen System 35 / 55 sound (IMPL-9b §8.3, D2): verbatim copies of patch-dsp.js (the evaluator with events and lamps), moog-dsp.js (the 9b circuits, the Song clock) and engine.js (events, lamps, the warm-up) at the stage 9b acceptance commit. Never edit: tests/golden-moog-b.test.mjs renders them (side A, every other module current) against the current files, bit for bit.',
    commit, files }, null, 2) + '\n');
}
const FROZEN = existsSync(new URL('MANIFEST.json', REF));

const [, B] = await H.sides();
const frozen = f => (FROZEN ? readFileSync(new URL(f, REF), 'utf8') : null);
const A = Object.assign({}, B, {
  name: FROZEN ? 'ref-9b' : 'self', engine: frozen('engine.js') || B.engine,
  dsp: B.dsp.map(([f, c]) => [f, FILES.includes(f) ? frozen(f) || c : c]),
  entries: new Map(), user: new Map(), scopes: new Map(),
});
const SR = H.SR, S0 = H.scope(B), READY = !!S0.g.PatchDSP && !!S0.g.PatchMoog && B_TYPES.every(t => S0.g.PatchMoog.T[t]);
const WAIT = 'the 9b circuits (lane V9c) are not on the branch yet: nothing to render';

/* ------------------------------------------------------------------ patches */
// a patch from a spec: mods [[name, type, driver name?]], cords [['name.port', 'name.port']] ('c' the controller), knobs { name:
// { id: v } } (a routing panel's switches too: its bus rows), ctl { id: v } → { rec, vals, mid: name → module id }
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
const preset = (name, set) => { const r = PT.loadPreset(PT.fresh(MG.FAMILY.id), {}, name, set ? { ensure: set } : undefined); if (r.why) throw new Error(name + ': ' + r.why); return { rec: r.rec, vals: r.vals }; };
const Q = (t, sr = SR) => 128 * Math.round(t * sr / 128);    // (every event on the 128-frame grid: the quanta never straddle one)
const on = (n, v = 0.8) => ({ t: 'on', n, v }), off = n => ({ t: 'off', n });
const line = (L, sr = SR) => L.flatMap(([n, t, d, v]) => [[Q(t, sr), on(n, v || 0.8)], [Q(t + d, sr), off(n)]]);
const LINE = [[48, 0.05, 0.3], [55, 0.4, 0.2], [43, 0.65, 0.5, 0.6], [60, 1.2, 0.25, 1]];
const LEGATO = [[48, 0.05, 0.6], [55, 0.4, 0.6], [43, 0.9, 0.3]];
const FPT = SR * 60 / (120 * H.PPQ);                           // 120 BPM: 25 frames a tick
const PLAY = (o = {}, sr = SR) => Object.assign({ t: 'transport', play: true, frame: 1024, tick: 0, fpt: sr * 60 / (120 * H.PPQ), seek: true, fresh: true }, o);
const C = (name, r, o) => Object.assign(r, { name, events: line(LINE), seconds: 1.5 }, o);
// a 921B saw (1.73 Vpp) on driver d, the keys on its pitch — most cases' audio source
const SAW = [['d', '921a'], ['o', '921b', 'd']], SAWC = [['c.kp1', 'd.f1']];
// an S-trigger from a V-trigger (the 961's V→S 1, its A input) — a 960 / Song clock gate into a 911
const VS = [['iv', '961']];

const CASES = [
  // 904B: three cutoffs, both ranges, keys on c1 and a 911 on c2 (a saw in)
  ...[[-2, 0], [1, 1], [3, 0]].map(([fc, rg]) => C(`904B: fixed ${fc} V, range ${rg ? 'HIGH' : 'LOW'} (keys and a 911 on the cutoff)`, rig({
    mods: [...SAW, ['hp', '904b'], ['e', '911']], cords: [...SAWC, ['o.saw', 'hp.in'], ['c.kp2', 'hp.c1'], ['c.ks1', 'e.trg'], ['e.out', 'hp.c2'], ['hp.out', 'c.out']],
    knobs: { hp: { fc, rg }, o: { rg: 3 } } }))),
  // 914: three band settings on white noise (one input), and the averaged pair (white + a saw)
  ...[{}, { lo: 0, b1: 10, b2: 0, b3: 10, b4: 0, b5: 10, b6: 0, b7: 10, b8: 0, b9: 10, b10: 0, b11: 10, b12: 0, hi: 0 }, { lo: 3, b2: 1, b4: 9, b6: 2, b8: 8, b10: 0, b12: 6, hi: 10 }].map((b, k) =>
    C(`914: bands ${['all at 10', 'alternate', 'mixed'][k]} on white noise`, rig({ mods: [['n', '903a'], ['fb', '914']], cords: [['n.wh1', 'fb.i1'], ['fb.o1', 'c.out']], knobs: { fb: b } }),
      { events: [], seconds: 1 })),
  C('914: both inputs (white and a saw, averaged), both outputs mixed', rig({ mods: [...SAW, ['n', '903a'], ['fb', '914']],
    cords: [...SAWC, ['n.pk1', 'fb.i1'], ['o.saw', 'fb.i2'], ['fb.o1', 'c.m1'], ['fb.o2', 'c.m2'], ['c.mo', 'c.out']], knobs: { fb: { b5: 2, b9: 3 }, o: { rg: 3 } } })),
  // 911A: OFF / PARALLEL / SERIES — S-TRIG 1 → INPUT 1 (INPUT 2 open: OFF strikes once), the outputs strike two 911s on two 902s
  ...[0, 1, 2].map(md => C(`911A: ${['OFF', 'PARALLEL', 'SERIES'][md]} (delays 4 / 5)`, rig({
    mods: [...SAW, ['o2', '921b', 'd'], ['dl', '911a'], ['e1', '911'], ['e2', '911'], ['a1', '902'], ['a2', '902']],
    cords: [...SAWC, ['c.ks1', 'dl.i1'], ['dl.o1', 'e1.trg'], ['dl.o2', 'e2.trg'], ['o.saw', 'a1.i1'], ['o2.rec', 'a2.i1'],
      ['e1.out', 'a1.c1'], ['e2.out', 'a2.c1'], ['a1.o2', 'c.m1'], ['a2.o2', 'c.m2'], ['c.mo', 'c.out']],
    knobs: { dl: { d1: 4, d2: 5, md }, o: { rg: 3 }, o2: { rg: 4 }, e1: { t1: 0, t2: 3, es: 0, t3: 3 }, e2: { t1: 0, t2: 3, es: 0, t3: 3 } } }), { events: line(LEGATO), seconds: 1.8 })),
  // 903A: white 1 / 2 and pink 1 / 2 (one buffer a pair)
  C('903A: white and pink, both jacks each', rig({ mods: [['n', '903a']], cords: [['n.wh1', 'c.m1'], ['n.wh2', 'c.m2'], ['n.pk1', 'c.m3'], ['n.pk2', 'c.m4'], ['c.mo', 'c.out']],
    ctl: { x1: 3, x2: 3, x3: 8, x4: 8 } }), { events: [], seconds: 1 }),
  // 960 free: ROW A → the driver, ROW B → the 904A, its OUTPUT → the 961's V→S → a 911 → the 902; three settings
  ...[{ rg: 3, vn: 4, s3: 2, s9: 1, a1: 2, a2: 4, a3: 6, a4: 1, a5: 7, a6: 3, a7: 9, a8: 5, b2: 6, b5: 9 },
    { rg: 3, vn: 2, s6: 0, cc: 1, c1: 1, c2: 3, c3: 5, c4: 2, a1: 1, a4: 5, a6: 8, ga: 1, b3: 7 },
    { rg: 2, vn: 9, s9: 0, gb: 2, a1: 3, a2: 3, a3: 6, a4: 8, a5: 1, a6: 2, a7: 9, a8: 4, b1: 9, b8: 9 }].map((k, i) => C(`960 free-running: ${['SKIP 3, stage 9 SKIP', 'STOP at 6, ROW C → CLOCK', 'stage 9 STOP, ROW B ×4'][i]}`, rig({
    mods: [...SAW, ['sq', '960'], ...VS, ['f', '904a'], ['e', '911'], ['a', '902']],
    cords: [['sq.ra1', 'd.f1'], ['c.kp1', 'd.f2'], ['o.saw', 'f.in'], ['sq.rb1', 'f.c2'], ['sq.co', 'iv.a11'], ['iv.s1', 'e.trg'], ['e.out', 'a.c1'], ['f.out', 'a.i1'], ['a.o2', 'c.out']],
    knobs: { sq: Object.assign({ os: 1 }, k), o: { rg: 2 }, f: { fc: 0, re: 3 }, e: { t1: 0, t2: 3, es: 3, t3: 2 } } }), { events: [[Q(0.1), on(48)], [Q(1.3), off(48)]], seconds: 1.6 })),
  // 960 at audio rate (410 Hz, CONTROL INPUT from the keys): ROW A ×4 into MAIN OUT through the 904A
  C('960 at audio rate: CONTROL INPUT on the keys, ROW A ×4 → 904A', rig({ mods: [['sq', '960'], ['f', '904a']],
    cords: [['c.kp1', 'sq.ci'], ['sq.ra1', 'f.in'], ['f.out', 'c.out']],
    knobs: { sq: { rg: 6, vn: 1, ga: 2, a1: 10, a2: 7, a3: 4, a4: 2, a5: 0, a6: 2, a7: 4, a8: 7 }, f: { fc: 2, re: 2 } } })),
  // 960 patched into itself (OUT 5 → IN 1: a four-stage cycle; OUT 8 → OSC OFF unused at 5) — a one-member loop step
  C('960 patched into itself: OUT 5 → IN 1 (a four-stage cycle), ROW A → the driver', rig({ mods: [...SAW, ['sq', '960']],
    cords: [['sq.o5', 'sq.i1'], ['sq.ra1', 'd.f1'], ['o.saw', 'c.out']],
    knobs: { sq: { os: 1, rg: 4, vn: 0, a1: 0, a2: 2, a3: 4, a4: 7 }, o: { rg: 3 } } }), { events: [] }),
  // 962: 2 : 1 and 3 : 1 — the 960's rows into its inputs, its clock OUTPUT on SHIFT, its output on the driver; TRIGGER OUT 1 → 961 → 911
  ...[2, 3].map(w => C(`962: ${w} : 1 (rows A / B${w === 3 ? ' / C' : ''}, SHIFT from the 960's clock)`, rig({
    mods: [...SAW, ['sq', '960'], ['sw', '962'], ...VS, ['e', '911'], ['a', '902']],
    cords: [['sq.ra1', 'sw.i1'], ['sq.rb1', 'sw.i2'], ...(w === 3 ? [['sq.rc1', 'sw.i3']] : []), ['sq.co', 'sw.sh'], ['sw.q1', 'd.f1'],
      ['sw.o1', 'iv.a11'], ['iv.s1', 'e.trg'], ['e.out', 'a.c1'], ['o.saw', 'a.i1'], ['a.o2', 'c.out']],
    knobs: { sq: { os: 1, rg: 4, vn: 2, a1: 1, a2: 3, b1: 5, b2: 7, c1: 9, c2: 2 }, o: { rg: 3 }, a: { fc: 2 }, e: { t1: 0, t2: 5, es: 6, t3: 3 } } }), { events: [], seconds: 1.2 })),
  // the 961's four circuits at three settings: AUDIO→V on a slow 921 saw → V→S 2's A → 911 2; the GATE → V→S 1's B (one-shot) →
  // 911 1; S-TRIG 1 / 2 → S→V 1 / 2 → the 902's and the 904A's controls
  ...[[2, 6, 5], [5, 3, 8], [8, 9, 2]].map(([t1, t2, se]) => C(`961: the four circuits (on times ${t1} / ${t2}, sensitivity ${se})`, rig({
    mods: [...SAW, ['lfo', '921'], ['iv', '961'], ['e1', '911'], ['e2', '911'], ['f', '904a'], ['a', '902']],
    cords: [...SAWC, ['lfo.saw', 'iv.ai'], ['iv.ao1', 'iv.a21'], ['iv.s2', 'e2.trg'], ['c.kg', 'iv.b11'], ['iv.s1', 'e1.trg'],
      ['c.ks1', 'iv.v1i'], ['c.ks2', 'iv.v2i'], ['iv.v1o', 'a.c2'], ['iv.v2o', 'f.c2'], ['e1.out', 'f.c1'], ['e2.out', 'a.c1'],
      ['o.saw', 'f.in'], ['f.out', 'a.i1'], ['a.o2', 'c.out']],
    knobs: { iv: { t1, t2, se }, lfo: { cr: 0, rg: 3, fq: 2 }, o: { rg: 3 }, f: { fc: -1, re: 2 }, e1: { t1: 0, t2: 4, es: 2, t3: 2 }, e2: { t1: 0, t2: 2, es: 0, t3: 2 } } }), { seconds: 1.6 })),
  // the 994's multiples (A: the saw to two places; B: the keys to the driver and the 904A) and the CP8A beside it (built, silent)
  C('994: both multiples; the CP8A in the patch (drawn only)', rig({ mods: [...SAW, ['mu', '994'], ['f', '904a'], ['pw', 'cp8a']],
    cords: [['c.kp1', 'mu.b1'], ['mu.b2', 'd.f1'], ['mu.b3', 'f.c1'], ['o.saw', 'mu.a1'], ['mu.a2', 'f.in'], ['mu.a3', 'c.m2'], ['f.out', 'c.m1'], ['c.mo', 'c.out']],
    knobs: { o: { rg: 3 }, f: { fc: -2, re: 5 } } })),
  // the CP35: ±6 V sources into its normalled attenuators (unpatched inputs), one attenuating a patched saw; three settings
  ...[[3, 5, 2, 8], [10, 0, 6, 1], [1, 9, 9, 4]].map(([a1, a2, a3, a4]) => C(`CP35: sources and attenuators (${a1} / ${a2} / ${a3} / ${a4})`, rig({
    mods: [...SAW, ['cp', 'cp35'], ['f', '904a'], ['a', '902']],
    cords: [...SAWC, ['cp.o1', 'f.c2'], ['cp.o3', 'f.c3'], ['o.saw', 'cp.i4'], ['cp.o4', 'f.in'], ['cp.o2', 'a.c2'], ['f.out', 'a.i1'], ['cp.p6', 'cp.u1'], ['cp.u2', 'c.m2'], ['a.o2', 'c.m1'], ['c.mo', 'c.out']],
    knobs: { cp: { a1, a2, a3, a4 }, o: { rg: 3 }, a: { fc: 1 }, f: { fc: -2, re: 1 } }, ctl: { x2: 0.5 } }))),
  // the CP2: its LOW PASS / HIGH PASS on noise, its keyboard copies (always-on rows) driving the oscillator and a 911
  ...[[2, 7], [6, 3]].map(([lp, hp]) => C(`CP2: filters (LP ${lp}, HP ${hp}) and its PITCH / S-TRIG copies`, rig({
    mods: [...SAW, ['n', '903a'], ['cp', 'cp2'], ['e', '911'], ['a', '902']],
    cords: [['cp.po', 'd.f1'], ['cp.so', 'e.trg'], ['n.wh1', 'cp.li'], ['cp.lo', 'cp.hi'], ['cp.ho', 'c.m2'], ['o.saw', 'a.i1'], ['e.out', 'a.c1'], ['a.o2', 'c.m1'], ['c.mo', 'c.out']],
    knobs: { cp: { lp, hp }, o: { rg: 3 } }, ctl: { x2: 4 } }))),
  // the 992's four rows into the 904B's third input (keyboard, wheel, pressure, the reversible EXT); then EXT alone, inverted
  ...[[1, 1, 1, 1, 6], [0, 0, 0, 1, -10]].map(([s1, s2, s3, s4, at], k) => C(`992: ${k ? 'EXT alone, inverted' : 'all four rows'} → 904B C3`, rig({
    mods: [...SAW, ['lfo', '921'], ['cv', '992'], ['hp', '904b']],
    cords: [...SAWC, ['lfo.tri', 'cv.x4'], ['o.saw', 'hp.in'], ['hp.out', 'c.out']],
    knobs: { cv: { s1, s2, s3, s4, at }, lfo: { cr: 0, rg: 3, fq: 1 }, hp: { fc: -1 }, o: { rg: 3 } } }),
  { events: line(LINE).concat([[Q(0.5), { t: 'wheel', v: 0.7 }], [Q(0.9), { t: 'at', v: 0.6 }]]), seconds: 1.5 })),
  // the 993: FROM 1 (all its rows) and FROM 2 with TRIGGERS 1 / 3 — the 911A in PARALLEL, three 911s, three 902s on three saws
  ...[{ f1: 1, t1: 1, t2: 1, t3: 1, e1: 1, e2: 1, e3: 1 }, { f2: 1, t1: 1, t3: 1, e1: 1, e3: 1 }].map((sw, k) => C(`993: ${k ? 'FROM 2, TRIGGERS 1 / 3, ENVELOPES 1 / 3' : 'FROM 1 and all six rows'} (bus rows only)`, rig({
    mods: [...SAW, ['o2', '921b', 'd'], ['o3', '921b', 'd'], ['dl', '911a'], ['e1', '911'], ['e2', '911'], ['e3', '911'], ['a1', '902'], ['a2', '902'], ['a3', '902'], ['tg', '993']],
    cords: [...SAWC, ['o.saw', 'a1.i1'], ['o2.saw', 'a2.i1'], ['o3.saw', 'a3.i1'], ['a1.o2', 'c.m1'], ['a2.o2', 'c.m2'], ['a3.o2', 'c.m3'], ['c.mo', 'c.out']],
    knobs: { tg: sw, dl: { d1: 4, d2: 6, md: 1 }, o: { rg: 3 }, o2: { rg: 3, fq: 3.5 }, o3: { rg: 4 }, e1: { t1: 0, t2: 4, es: 2, t3: 3 }, e2: { t1: 0, t2: 4, es: 2, t3: 3 }, e3: { t1: 0, t2: 4, es: 2, t3: 3 } } }),
  { events: line(LEGATO), seconds: 1.6 })),
  // the CP3As' routing: CP3A 1 KEYBOARD → 921A 1, CP3A 2 WHEEL → 921A 2, CP3A 3 EXT (its attenuator) → the 921; their mixers mix
  C('CP3A × 3: routing to the drivers and the 921 (KEYBOARD, WHEEL, EXT), the mixers', rig({
    mods: [['d', '921a'], ['d2', '921a'], ['o', '921b', 'd'], ['o2', '921b', 'd2'], ['osc', '921'], ['m1', 'cp3a'], ['m2', 'cp3a'], ['m3', 'cp3a']],
    cords: [['c.kp2', 'm3.x4'], ['o.saw', 'm1.m1'], ['o2.rec', 'm1.m2'], ['osc.saw', 'm2.m1'], ['m1.mo', 'm2.m2'], ['m2.mn', 'm3.m1'], ['m3.mo', 'c.out']],
    knobs: { m1: { r1: 1, x1: 6, x2: 5, ms: 6 }, m2: { r2: 1, x1: 4, x2: 7 }, m3: { r4: 1, ra: 7, x1: 8, ms: 4 }, o: { rg: 3 }, o2: { rg: 2 }, osc: { rg: 2 } } }),
  { events: line(LINE).concat([[Q(0.6), { t: 'wheel', v: 0.5 }]]) }),
  // the CP4A: KEYBOARD and CV IN to the 904A's C3, TRIGGERS 1 / 2 (the keys' S-TRIG 1 and its TRIGGER IN) to 911 1 / 2
  C('CP4A: CV rows into the 904A, trigger rows into 911 1 / 2', rig({
    mods: [...SAW, ['f', '904a'], ['e1', '911'], ['e2', '911'], ['a', '902'], ['r', 'cp4a']],
    cords: [...SAWC, ['c.ks2', 'r.ti'], ['c.kv', 'r.ci'], ['o.saw', 'f.in'], ['f.out', 'a.i1'], ['e1.out', 'a.c1'], ['e2.out', 'f.c1'], ['a.o2', 'c.out']],
    knobs: { r: { c1: 1, c4: 1, t1: 1, t2: 1 }, o: { rg: 3 }, f: { fc: -2, re: 4 } } })),
  // the Song clock: SONG with a loop wrap (and LENGTH 3) gating a 911 through the 961, RUN on a 902; ALWAYS while stopped, 1/8T
  C('Song clock SONG: 1/16 into the 961 → a 911, RUN opens a 902, RESTART every 3 steps on a second 911 (a loop wrap)', rig({
    mods: [...SAW, ['ck', 'clk'], ...VS, ['e1', '911'], ['e2', '911'], ['a', '902'], ['f', '904a']],
    cords: [...SAWC, ['ck.ck', 'iv.a11'], ['iv.s1', 'e1.trg'], ['ck.rs', 'iv.a21'], ['iv.s2', 'e2.trg'], ['ck.rn', 'a.c2'], ['e1.out', 'a.c1'], ['e2.out', 'f.c1'],
      ['o.saw', 'f.in'], ['f.out', 'a.i1'], ['a.o2', 'c.out']],
    knobs: { ck: { dv: 2, ln: 2 }, o: { rg: 3 }, e1: { t1: 0, t2: 2, es: 0, t3: 2 }, e2: { t1: 0, t2: 5, es: 0, t3: 4 }, f: { fc: -2, re: 3 } } }),
  { events: [[Q(0.02), PLAY({ frame: 1024 + 6, loop: true, ls: 0, le: 1700 })], [Q(0.1), on(48)], [Q(1.7), off(48)]], seconds: 1.9 }),
  C('Song clock ALWAYS (stopped, the project tempo), 1/8T and 1/4 on two 911s', rig({
    mods: [...SAW, ['ck', 'clk'], ...VS, ['e1', '911'], ['a', '902']],
    cords: [...SAWC, ['ck.ck', 'iv.a11'], ['iv.s1', 'e1.trg'], ['e1.out', 'a.c1'], ['o.saw', 'a.i1'], ['a.o2', 'c.out']],
    knobs: { ck: { dv: 4, md: 1 }, o: { rg: 3 }, e1: { t1: 0, t2: 2, es: 0, t3: 2 } } }), { events: [[Q(0.1), on(48)], [Q(1.4), off(48)]] }),
  // the seven presets with a note line (the clocked pair from ▶, transposed by a held key)
  ...B_PRESETS.map(n => C(`preset: ${n}`, preset(n), n === 'Sequence' || n === 'Twenty-four steps'
    ? { events: [[Q(0.02), PLAY()], [Q(0.9), on(55)], [Q(1.3), off(55)]], seconds: 1.8 } : { events: line(LINE), seconds: 1.6 })),
  // a graph change mid-sequence: ROW B pulled from the 904A, ROW C plugged; then a routing switch (the 993's TRIGGER 1 with FROM 1)
  (() => {
    const p = preset('Sequence', MG.S55), id = t => Object.keys(p.rec.mods).filter(k => p.rec.mods[k].t === t);
    const [sq] = id('960'), [f] = id('904a'), [tg] = id('993'), cB = p.rec.cords.find(x => x.a === sq + '.rb1');
    const r1 = PT.plug(PT.pull(p.rec, cB.id).rec, sq + '.rc1', f + '.c2').rec;
    return C('a graph change mid-sequence (ROW B → ROW C on the 904A), then a 993 switch pair (FROM 1, TRIGGER 1)', p, { rec2: r1, seconds: 2,
      events: [[Q(0.02), PLAY()], [Q(0.7), { rec: r1 }], [Q(1.1), { knob: [tg, 'f1', 1] }], [Q(1.1), { knob: [tg, 't1', 1] }], [Q(1.4), { knob: [tg, 't1', 0] }]] });
  })(),
  // OS 2; 44.1 kHz × 1
  C('Sequence at OS 2', preset('Sequence'), { os: 2, events: [[Q(0.02), PLAY()]], seconds: 1.4 }),
  C('Swept band at 44.1 kHz × 1', preset('Swept band'), { os: 1, sr: 44100, events: line(LINE, 44100) }),
];

/* ------------------------------------------------------------------ rendering */
// renders case c on side X: {t: patch} (the vals through side X's models.js) and the graph payload with the vals (the bus rows) — or
// the same as processorOptions: offline, the bounce's form, with the case's transport — then the events: { knob: [name | mid, id, v] }
// a knob turned ({t: patch}, and the payload again when it is a routing switch), { rec } a re-patch, else a message — posted right
// before the quantum at their frame; quanta of 128 frames, or quanta(k) frames (any multiple of 4), never straddling an event;
// probe(p, frame) after each quantum → { L, R } (Float32)
function renderP(X, c, { quanta = null, offline = false, probe = null } = {}) {
  const sr = c.sr || SR, S = H.scope(X, sr), N = Math.ceil((c.seconds || 1.5) * sr / 128) * 128, os = c.os || 4, fx = X.fxm.defaultFx2();
  const patchOf = vals => X.models.patchFor('m900', vals, fx, { sr, bpm: 120, drift: 0, prefs: { smooth: 1, silenceTails: 1 } }); // (drift 0: the goldens')
  let vals = c.vals, rec = c.rec;
  const pay = () => PT.payload(rec, MG.FAMILY.id, vals);
  const msgsOf = m => {
    if (m.rec) { rec = m.rec; return [{ t: 'seq', s: pay() }]; }
    if (m.knob) {
      const [n, k, v] = m.knob, mid = c.mid && c.mid[n] ? c.mid[n] : n;
      vals = PT.setKnob(vals, rec, mid, k, v);
      return PT.isBusKnob(rec, mid, k) ? [{ t: 'patch', p: patchOf(vals) }, { t: 'seq', s: pay() }] : [{ t: 'patch', p: patchOf(vals) }];
    }
    return [m];
  };
  const id = 'moog-b:' + c.name + (offline ? ':offline' : '');
  S.g.currentFrame = 0; S.seed(id);
  const ev = (c.events || []).slice().sort((a, b) => a[0] - b[0]);
  const tp0 = offline && ev.length && ev[0][0] === 0 && ev[0][1].t === 'transport' ? ev.shift()[1] : null;   // (a bounce's transport: processorOptions)
  const po = Object.assign({ os, hostOS: os }, offline ? { offline: true, patch: patchOf(vals), seq: pay(), song: null, transport: tp0 } : null);
  const p = new S.Proc({ processorOptions: po });
  S.seed(id);
  if (!offline) { p.msg({ t: 'patch', p: patchOf(vals) }); p.msg({ t: 'seq', s: pay() }); }
  const L = new Float32Array(N), R = new Float32Array(N), bufs = new Map();
  let e = 0, k = 0;
  for (let f = 0; f < N;) {
    while (e < ev.length && ev[e][0] <= f) for (const m of msgsOf(ev[e++][1])) p.msg(m);
    let q = quanta ? quanta(k++) : 128;
    if (e < ev.length) q = Math.min(q, ev[e][0] - f);
    q = Math.min(q, N - f);
    let o = bufs.get(q);
    if (!o) { o = [[new Float32Array(q), new Float32Array(q)]]; bufs.set(q, o); }
    p.process([], o);
    L.set(o[0][0], f); R.set(o[0][1], f);
    f += q; S.g.currentFrame = f;
    if (probe) probe(p, f);
  }
  return { L, R };
}

test('tests/ref-9b: the frozen files match their manifest (and the pinned hashes once set)' + (FROZEN ? '' : ' — NOT FROZEN YET: side A is the current tree (determinism only)'), (t) => {
  if (!FROZEN) { t.diagnostic('tests/ref-9b/MANIFEST.json missing: the lead freezes the refs at 9b\'s acceptance (GOLDEN_FREEZE_9B=1)'); return; }
  const m = JSON.parse(readFileSync(new URL('MANIFEST.json', REF), 'utf8'));
  assert.deepEqual(Object.keys(m.files).sort(), [...FILES].sort());
  for (const f of FILES) assert.equal(H.sha256(readFileSync(new URL(f, REF), 'utf8')), m.files[f].sha256, 'tests/ref-9b/' + f + ' was edited');
  if (PIN) assert.deepEqual(Object.fromEntries(FILES.map(f => [f, m.files[f].sha256])), PIN, 'the manifest is the pinned freeze');
});

test('the cases are patches a player can make (normPatch-stable, MAIN OUT patched with the routing), each of the sixteen 9b types in one, every bus row of every routing panel lit in one, each 9b preset once', () => {
  for (const c of CASES) {
    assert.deepEqual(PT.normPatch(H.clone(c.rec), MG.FAMILY.id), c.rec, c.name + ': normPatch-stable');
    for (const [, m] of (c.events || [])) if (m.rec) assert.deepEqual(PT.normPatch(H.clone(m.rec), MG.FAMILY.id), m.rec, c.name + ': its re-patch');
    assert.ok(PT.live(c.rec, MG.FAMILY.id, c.vals), c.name + ': MAIN OUT patched');
  }
  const types = new Set(CASES.flatMap(c => Object.values(c.rec.mods).map(m => m.t)));
  for (const t of B_TYPES) assert.ok(types.has(t), 'a case holds a ' + t);
  // every row of every routing type resolved in some case (the 993 with FROM 2 too)
  for (const t of ['992', '993', 'cp2', 'cp3a', 'cp4a']) {
    const rows = MG.TYPES[t].bus.map((x, i) => i), lit = new Set();
    for (const c of CASES) for (const r of PT.busRows(c.rec, MG.FAMILY.id, c.vals)) if (c.rec.mods[r.panel] && c.rec.mods[r.panel].t === t) lit.add(r.i);
    const want = t === 'cp3a' ? [0, 1, 3] : t === 'cp4a' ? [0, 3, 4, 5, 6, 7] : rows;        // (CP3A: KEYBOARD / WHEEL / EXT; CP4A: the rows the case lights)
    for (const i of want) assert.ok(lit.has(i), `${t} row ${i} lit in a case`);
  }
  assert.deepEqual(CASES.filter(c => c.name.startsWith('preset: ')).map(c => c.name.slice(8)), B_PRESETS);
  for (const n of B_PRESETS) assert.ok(MG.PRESETS.some(P => P.name === n), 'a 9b preset shipped: ' + n);
  for (const c of CASES) assert.equal(CASES.filter(x => x.name === c.name).length, 1, 'one case per name: ' + c.name);
});

test(`D2: the sixteen types at their settings, every bus row, the Song clock, the seven presets, changes mid-sequence, OS 2, 44.1 kHz — ${FROZEN ? 'ref-9b vs current' : 'current vs current (not frozen yet)'}, bit-identical`, (t) => {
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

test('the cases differ where they should (side B): the 904B\'s settings, the 914\'s, the 911A\'s modes, the 960\'s, the 962\'s 2 : 1 / 3 : 1, the 961\'s, the CP35\'s, the CP2\'s, the 992\'s, the 993\'s, the presets', (t) => {
  if (!READY) { t.diagnostic(WAIT); return; }
  const by = p => CASES.filter(c => c.name.startsWith(p)), R = new Map(), get = c => { if (!R.has(c)) R.set(c, renderP(B, c)); return R.get(c); };
  for (const p of ['904B:', '914: bands', '911A:', '960 free', '962:', '961:', 'CP35:', 'CP2:', '992:', '993:', 'preset:']) {
    const L = by(p);
    assert.ok(L.length >= 2, p);
    for (let i = 1; i < L.length; i++) assert.ok(H.compare(get(L[i - 1]), get(L[i])).max > 1e-3, `${L[i - 1].name} ≠ ${L[i].name}`);
  }
  // a routing switch matters: the 993 case without its switches is another sound
  const c = by('993: FROM 1')[0], d = Object.assign({}, c, { name: c.name + ' (switches off)', vals: PT.setKnob(PT.setKnob(c.vals, c.rec, c.mid.tg, 'e1', 0), c.rec, c.mid.tg, 'f1', 0) });
  assert.ok(H.compare(get(c), renderP(B, d)).max > 1e-3, 'the 993\'s rows are heard');
});

/* ------------------------------------------------------------------ D7 (side B) */
// D7 (IMPL-9b §3.4): Sequence bounced (processorOptions: the patch, the payload with its vals, the transport anchored on the grid)
// = live (messages, the same anchor), bit for bit; live with the anchor 1–3 frames off the 4-frame grid: the 960 on stage 1 through
// the first step and on stage 2 after it (the Song clock a level of the song position: no first step lost, none doubled)
test('D7: Sequence — offline (processorOptions) = live (messages) with the anchor on the grid, bit-identical; off the grid by 1–3 frames, stage 1 on the first step', (t) => {
  if (!READY) { t.diagnostic(WAIT); return; }
  const base = preset('Sequence', MG.S55), n960 = +Object.keys(base.rec.mods).find(k => base.rec.mods[k].t === '960').slice(1);
  const c = C('d7: Sequence', base, { events: [[0, PLAY({ frame: 1024 })]], seconds: 2 });
  const live = renderP(B, c), bounce = renderP(B, c, { offline: true });
  assert.ok(H.peak(live) > 0.01, 'it sounds');
  const d = H.compare(live, bounce);
  assert.equal(d.max, 0, 'offline = live: ' + H.describe(d));
  for (const off of [1, 2, 3]) {
    const st = [];
    renderP(B, Object.assign({}, c, { name: 'd7: Sequence +' + off, events: [[0, PLAY({ frame: 1024 + off })]], seconds: 0.5 }), { probe: (p, f) => {
      const L = p.i0.pm.lamps(0).l, s = 32 - Math.clz32(L[L.indexOf(n960) + 1] & 511), tk = (f - 1 - (1024 + off)) / FPT;
      if (tk > 8 && tk < 232) st.push(['first', s]); else if (tk > 248 && tk < 472) st.push(['second', s]);
    } });
    assert.ok(st.length > 20 && st.every(([w, s]) => s === (w === 'first' ? 1 : 2)), `anchor +${off} frames: ${JSON.stringify(st.filter(([w, s]) => s !== (w === 'first' ? 1 : 2)).slice(0, 3))}`);
  }
});

// span invariance (D7, IMPL-9b §3.4): Sequence playing in quanta of 128, 4 and random multiples of 4 frames — ▶ on the grid, a loop
// whose end falls inside a 128-frame span (the Track's wrap ≤ 4 frames late, the Song clock's own fold exact), a tempo change whose
// re-anchor lands 37 frames after its posting (main.js's reanchor: the tick at that frame), a held key, a stage knob — bit for bit
test('span invariance (D7): Sequence with a loop wrap inside a span and a tempo change\'s late re-anchor, in quanta of 128, 4 and random — bit-identical', (t) => {
  if (!READY) { t.diagnostic(WAIT); return; }
  const base = preset('Sequence', MG.S55), [sq] = Object.keys(base.rec.mods).filter(k => base.rec.mods[k].t === '960');
  const T0 = Q(0.02), le = 1925, F1 = Q(1.1) + 37, t1 = ((F1 - T0) / FPT) % le, fpt1 = SR * 60 / (131 * H.PPQ);
  const c = C('span invariance: Sequence', base, { seconds: 2.4, events: [[T0, PLAY({ frame: T0, loop: true, ls: 0, le })], [Q(0.5), on(50, 0.7)], [Q(0.8), off(50)],
    [Q(1.1), { t: 'transport', play: true, frame: F1, tick: t1, fpt: fpt1, seek: false, loop: true, ls: 0, le }], [Q(1.6), { knob: [sq, 'a3', 4] }]] });
  assert.ok((T0 + le * FPT) % 128 !== 0, 'the wrap falls inside a span');
  const r = mulberry32(fnv1a32('golden-moog-b-spans')), rnd = () => 4 * (1 + Math.floor(r() * 32));
  const q128 = renderP(B, c), q4 = renderP(B, c, { quanta: () => 4 }), qr = renderP(B, c, { quanta: rnd });
  assert.ok(H.peak(q128) > 0.01, 'it sounds');
  for (const [w, x] of [['4', q4], ['random', qr]]) { const d = H.compare(q128, x); assert.equal(d.max, 0, `quanta of ${w}: ${H.describe(d)}`); }
});
