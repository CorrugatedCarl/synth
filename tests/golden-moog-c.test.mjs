// Stage 9c golden refs (IMPL-9c D2; lane V). tests/ref-9c/ holds verbatim copies of patch-dsp.js, moog-dsp.js and engine.js frozen by
// the lead at 9c's acceptance (after the listening renders), with MANIFEST.json { note, commit, files: { f: { sha256 } } } (ref-9 /
// ref-9b's format). Side A = the current tree with those three files replaced by the frozen copies (every other module current:
// models.js's map, patch-core's payload and bus rows, moog-core's presets and sets); side B = the current tree. Every case renders a
// 900 Series on both through the golden harness and must be bit-identical: max |A − B| === 0. From the freeze on, ref-9 guards the
// Model 15 cases (tests/golden-moog.test.mjs), ref-9b the 9b cases (tests/golden-moog-b.test.mjs) and ref-9c these: the ten 1960s
// types, the CP3's bus rows, the three 1960s presets and the System IIIc tile's starting sound.
// BEFORE THE FREEZE (no tests/ref-9c/MANIFEST.json) side A is the current tree in a scope of its own: the test then checks B against
// itself — determinism, not the frozen sound — and says so in a diagnostic. The freeze (the lead):
// GOLDEN_FREEZE_9C=1 node --max-old-space-size=2048 --test tests/golden-moog-c.test.mjs writes tests/ref-9c/ from the working tree
// (the commit: git HEAD); then set PIN below to the manifest's hashes.
// The case lists are literal (C_TYPES, C_PRESETS: never the live table less the older lists — the derived form IMPL-9c D3 had to pin
// in golden-moog-b). Cases (the controller's keys as {t: on} notes, knob changes as {t: patch} — a routing switch's also re-posts the
// graph payload —, re-patches as the payload, all on the 128-frame grid): the 901 at three settings (its footages, Lo as an LFO, the
// width, the variable outputs); the 901A driving three 901Bs at three vernier spreads, an undriven 901B, a 901B stalling below its
// driver; the 901C as a control source; the 904C BAND PASS / BAND REJECT / OFF with its CV and bandwidth inputs; the 905 at three MIX
// settings on a pluck and patched into a loop; the 912 at its three responses (its control out on a cutoff, its comparator on a 911,
// patched and on its normal); the 984's matrix and tone; the 991 at three settings; the four CP3s' routing rows (KEYBOARD / WHEEL /
// PRESSURE / EXT → the 901As by number and the 901) and their mixers; the three presets with their note lines; the System IIIc tile
// (makeSet('s3c')) as it leaves its starter; a graph change and a routing switch mid-note; OS 2; 44.1 kHz × 1.
// Run: node --max-old-space-size=2048 --test tests/golden-moog-c.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as H from './golden-harness.mjs';
import * as MG from '../moog-core.js?v=9';
import * as PT from '../patch-core.js?v=9';

// ref-9c guards 9c's sound: the ten types and the three presets 9c added (stage 9's are ref-9's, 9b's ref-9b's)
const C_TYPES = ['901', '901a', '901b', '901c', '904c', '905', '912', '984', '991', 'cp3'];
const C_PRESETS = ['Drift choir', 'Follower wah', 'Spring pluck'];
const REF = new URL('./ref-9c/', import.meta.url), FILES = ['patch-dsp.js', 'moog-dsp.js', 'engine.js'];
// the frozen hashes, pinned by the lead at the freeze (null until then: the manifest alone is checked)
const PIN = { // frozen at 9c's acceptance (e7babd5, 2026-10-23)
  'patch-dsp.js': '96a54628aec65df3437a901a4e3df22a1dd0fe4f1dea43cb3a1ae0c19415e9e2',
  'moog-dsp.js': 'f08f4186e701748feaebd6f191527ba77a6beaf535d3ab4eb27c606c0d06f639',
  'engine.js': 'ef15c45e81782a5d24f52b5c6d13042b08f44bfd1e44796cd29cf3a20b849554' };
const FREEZE = process.env.GOLDEN_FREEZE_9C === '1';
if (FREEZE) {
  mkdirSync(REF, { recursive: true });
  const files = {};
  for (const f of FILES) { const src = readFileSync(new URL(f, H.ROOT), 'utf8'); writeFileSync(new URL(f, REF), src); files[f] = { sha256: H.sha256(src) }; }
  let commit = '';
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' }).trim(); } catch { /* no git */ }
  writeFileSync(new URL('MANIFEST.json', REF), JSON.stringify({
    note: 'Frozen 1960s sound (IMPL-9c D2): verbatim copies of patch-dsp.js, moog-dsp.js (the ten 1960s circuits: the 901 family, the 904C, the 905, the 912, the 984, the 991, the CP3) and engine.js at the stage 9c acceptance commit. Never edit: tests/golden-moog-c.test.mjs renders them (side A, every other module current) against the current files, bit for bit.',
    commit, files }, null, 2) + '\n');
}
const FROZEN = existsSync(new URL('MANIFEST.json', REF));

const [, B] = await H.sides();
const frozen = f => (FROZEN ? readFileSync(new URL(f, REF), 'utf8') : null);
const A = Object.assign({}, B, {
  name: FROZEN ? 'ref-9c' : 'self', engine: frozen('engine.js') || B.engine,
  dsp: B.dsp.map(([f, c]) => [f, FILES.includes(f) ? frozen(f) || c : c]),
  entries: new Map(), user: new Map(), scopes: new Map(),
});
const SR = H.SR, S0 = H.scope(B), READY = !!S0.g.PatchDSP && !!S0.g.PatchMoog && C_TYPES.every(t => S0.g.PatchMoog.T[t] && MG.TYPES[t]);
const WAIT = 'the 9c circuits (lane V) or tables (lane K) are not on the branch yet: nothing to render';

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
const C = (name, r, o) => Object.assign(r, { name, events: line(LINE), seconds: 1.5 }, o);
// a 902 opened by a 911 from S-TRIG 1 — most cases' voice; a 901A driving one 901B on the keys — the 1960s source
const VCA = [['a', '902'], ['e', '911']], VCAC = [['c.ks1', 'e.trg'], ['e.out', 'a.c1']], VCAK = { e: { t1: 0.5, t2: 4, es: 6, t3: 3 } };
const OSC = [['d', '901a'], ['o', '901b', 'd']], OSCC = [['c.kp1', 'd.f1']];

const CASES = [
  // 901: its footages and FINE on the keys (a saw), Lo as an LFO on a second 901's pitch, the width and the variable outputs mixed
  ...[[{ rg: 2, fq: 1.5, pw: 30 }, 'saw'], [{ rg: 4, fv: -0.5, pw: 70, v3: 6 }, 'vtri'], [{ rg: 5, pw: 12, v4: 4 }, 'vpls']].map(([k, out], i) => C(`901: ${['16′, FINE +1.5', '4′, FIXED −0.5, variable triangle', '2′, a 12 % pulse at LEVEL 4'][i]}`, rig({
    mods: [['o', '901'], ...VCA], cords: [['c.kp1', 'o.f1'], ['o.' + out, 'a.i1'], ['o.sin', 'c.m2'], ['a.o2', 'c.m1'], ['c.mo', 'c.out'], ...VCAC],
    knobs: Object.assign({ o: k }, VCAK), ctl: { x2: 1 } }))),
  C('901 on Lo as an LFO (1 Hz) on a second 901\'s pitch, its sine through a 901C', rig({
    mods: [['l', '901'], ['cv', '901c'], ['o', '901'], ...VCA], cords: [['l.tri', 'cv.in'], ['cv.p', 'o.f2'], ['c.kp1', 'o.f1'], ['o.saw', 'a.i1'], ['a.o2', 'c.out'], ...VCAC],
    knobs: Object.assign({ l: { rg: 0, fv: 0 }, cv: { am: 3 }, o: { rg: 3 } }, VCAK) })),
  // 901A → three 901Bs at three vernier spreads (beats), one more undriven; then a stall: vernier −6 below its driver on low keys
  ...[[0.05, 0.1], [0.3, -0.4], [2, -3]].map(([u, w], i) => C(`901A → three 901Bs (verniers 0, ${u}, ${w}) and an undriven 901B`, rig({
    mods: [['d', '901a'], ['o1', '901b', 'd'], ['o2', '901b', 'd'], ['o3', '901b', 'd'], ['u', '901b'], ['mx', 'cp3'], ...VCA],
    cords: [['c.kp1', 'd.f1'], ['c.kw', 'd.f2'], ['o1.saw', 'mx.m1'], ['o2.saw', 'mx.m2'], ['o3.pls', 'mx.m3'], ['u.sin', 'mx.m4'], ['mx.mo', 'a.i1'], ['a.o2', 'c.out'], ...VCAC],
    knobs: Object.assign({ d: { pw: 35 + 10 * i, fq: i }, o2: { vn: u }, o3: { vn: w, rg: 2 }, u: { vn: 1 - i, rg: 4 }, mx: { x1: 5, x2: 5, x3: 4, x4: 3 } }, VCAK) }),
  { events: line(LINE).concat([[Q(0.7), { t: 'wheel', v: 0.4 }]]) })),
  C('901B stalling below its driver (vernier −6, low keys), its outputs held', rig({
    mods: [...OSC, ...VCA], cords: [...OSCC, ['o.saw', 'a.i1'], ['o.vtri', 'c.m2'], ['a.o2', 'c.m1'], ['c.mo', 'c.out'], ...VCAC],
    knobs: Object.assign({ o: { vn: -6, rg: 4, v3: 7 } }, VCAK) }), { events: line([[36, 0.05, 0.4], [72, 0.5, 0.3], [24, 0.85, 0.4]]) }),
  // the 904C: BAND PASS / REJECT at settings, the keys on c1, a 911 on b1, OFF (the input as it is)
  ...[[2, 1, 0], [2, -2, 2.5], [0, 0, 1], [0, 3, 3], [1, 0, 1]].map(([md, fc, bw]) => C(`904C: ${['BAND REJECT', 'OFF', 'BAND PASS'][md]}, CENTER ${fc}, BANDWIDTH ${bw}`, rig({
    mods: [...OSC, ['f', '904c'], ['e2', '911'], ...VCA], cords: [...OSCC, ['o.saw', 'f.in'], ['c.kp2', 'f.c1'], ['c.ks2', 'e2.trg'], ['e2.out', 'f.b1'], ['f.out', 'a.i1'], ['a.o2', 'c.out'], ...VCAC],
    knobs: Object.assign({ f: { md, fc, bw }, e2: { t1: 2, t2: 6, es: 0, t3: 5 }, o: { rg: 3 } }, VCAK) }))),
  // the 905: MIX 0 / 4 / 10 on a pluck; then in a loop with a 902 (the spring fed back)
  ...[0, 4, 10].map(mx => C(`905: MIX ${mx} on a pluck`, rig({
    mods: [...OSC, ['r', '905'], ...VCA], cords: [...OSCC, ['o.saw', 'a.i1'], ['a.o2', 'r.in'], ['r.out', 'c.out'], ...VCAC],
    knobs: { r: { mx }, e: { t1: 0, t2: 3, es: 0, t3: 3 } } }), { seconds: 2.2 })),
  C('905 in a loop with a 902 (the spring fed back at the lower input, MAIN OUT its upper output)', rig({
    mods: [...OSC, ['r', '905'], ['g', '902'], ...VCA], cords: [...OSCC, ['o.saw', 'a.i1'], ['a.o2', 'g.i1'], ['g.o2', 'r.in'], ['r.out', 'g.i2'], ['g.o1', 'c.out'], ...VCAC],
    knobs: { r: { mx: 8 }, g: { fc: 2 }, e: { t1: 0, t2: 3, es: 0, t3: 3 } } }), { seconds: 2 }),
  // the 912 at its three responses: following the 902's upper output, its control out on a 904A, its comparator → a 911 → the 904C's
  // bandwidth (on its normal); then patched (the keys' VELOCITY on COMPARATOR IN)
  ...[[0, 3], [1, 5], [2, 8]].map(([rs, th]) => C(`912: ${['SHORT', 'MEDIUM', 'LONG'][rs]}, THRESHOLD ${th} (on its normal)`, rig({
    mods: [...OSC, ['fl', '912'], ['f', '904a'], ['e2', '911'], ['bp', '904c'], ...VCA],
    cords: [...OSCC, ['o.saw', 'a.i1'], ['a.o1', 'fl.in'], ['a.o2', 'f.in'], ['fl.co', 'f.c1'], ['fl.st', 'e2.trg'], ['e2.out', 'bp.b1'], ['f.out', 'bp.in'], ['bp.out', 'c.out'], ...VCAC],
    knobs: Object.assign({ fl: { rs, th }, f: { fc: -4, re: 4 }, e2: { t1: 1, t2: 5, es: 0, t3: 4 }, bp: { fc: 1, bw: 2 } }, VCAK) }))),
  C('912: COMPARATOR IN patched (VELOCITY), the follower on the 904A', rig({
    mods: [...OSC, ['fl', '912'], ['f', '904a'], ['e2', '911'], ...VCA],
    cords: [...OSCC, ['o.saw', 'a.i1'], ['a.o1', 'fl.in'], ['a.o2', 'f.in'], ['fl.co', 'f.c1'], ['c.kv', 'fl.ci'], ['fl.st', 'e2.trg'], ['e2.out', 'f.c2'], ['f.out', 'c.out'], ...VCAC],
    knobs: Object.assign({ fl: { rs: 1, th: 6 }, f: { fc: -3, re: 3 }, e2: { t1: 1, t2: 4, es: 0, t3: 3 } }, VCAK) })),
  // the 984: four sources into its four inputs, a matrix, three settings of masters and tone, its four buses mixed
  ...[[{}, 'the defaults (four unity channels)'], [{ l12: 7, l23: 5, l34: 6, l41: 3, m2: 10, bs: 9, tb: 2 }, 'a matrix, bass up, treble down'], [{ l11: 0, l21: 10, l31: 10, l41: 10, m1: 10, bs: 1, tb: 9 }, 'every input into bus 1, bass down, treble up']].map(([k, nm]) => C(`984: ${nm}`, rig({
    mods: [...OSC, ['o2', '901b', 'd'], ['n', '903a'], ['l', '901'], ['mx', '984'], ...VCA],
    cords: [...OSCC, ['o.saw', 'mx.i1'], ['o2.pls', 'mx.i2'], ['n.pk1', 'mx.i3'], ['l.tri', 'mx.i4'], ['mx.o1', 'a.i1'], ['mx.o2', 'c.m2'], ['mx.o3', 'c.m3'], ['mx.o4', 'c.m4'], ['a.o2', 'c.m1'], ['c.mo', 'c.out'], ...VCAC],
    knobs: Object.assign({ mx: k, o2: { vn: 0.4, rg: 2 }, l: { rg: 1 } }, VCAK), ctl: { x2: 4, x3: 3, x4: 3 } }))),
  // the 991 at three settings on noise and a saw
  ...[[10, 0, 10], [4, 3, 8], [7, 6, 5]].map(([lp, hp, at]) => C(`991: LOW PASS ${lp}, HIGH PASS ${hp}, ATTENUATOR ${at}`, rig({
    mods: [...OSC, ['n', '903a'], ['fl', '991'], ...VCA], cords: [...OSCC, ['n.wh1', 'c.m2'], ['o.saw', 'c.m3'], ['c.mo', 'fl.in'], ['fl.out', 'a.i1'], ['a.o2', 'c.out'], ...VCAC],
    knobs: Object.assign({ fl: { lp, hp, at }, o: { rg: 3 } }, VCAK), ctl: { x2: 3, x3: 6 } }), { events: line(LEGATO) })),
  // the CP3s' routing: CP3 1 KEYBOARD → 901A 1, CP3 2 WHEEL → 901A 2, CP3 3 PRESSURE → 901A 3, CP3 4 EXT (its attenuator) → the 901; their mixers
  C('CP3 × 4: KEYBOARD / WHEEL / PRESSURE / EXT rows → the 901As and the 901, the mixers', rig({
    mods: [['d1', '901a'], ['d2', '901a'], ['d3', '901a'], ['o1', '901b', 'd1'], ['o2', '901b', 'd2'], ['o3', '901b', 'd3'], ['l', '901'], ['m1', 'cp3'], ['m2', 'cp3'], ['m3', 'cp3'], ['m4', 'cp3'], ...VCA],
    cords: [['c.kp2', 'm4.x4'], ['o1.saw', 'm1.m1'], ['o2.pls', 'm1.m2'], ['o3.tri', 'm2.m1'], ['l.saw', 'm2.m2'], ['m1.mo', 'm3.m1'], ['m2.mn', 'm3.m2'], ['m3.mo', 'a.i1'], ['a.o2', 'c.out'], ...VCAC],
    knobs: Object.assign({ m1: { r1: 1, x1: 6, x2: 5, ms: 6 }, m2: { r2: 1, x1: 4, x2: 7 }, m3: { r3: 1, x1: 8, x2: 6, ms: 4 }, m4: { r4: 1, ra: 7 }, o2: { rg: 2 }, l: { rg: 2 } }, VCAK) }),
  { events: line(LINE).concat([[Q(0.5), { t: 'wheel', v: 0.5 }], [Q(0.8), { t: 'at', v: 0.6 }]]) }),
  // the three presets with a note line; the System IIIc tile as it leaves its starter
  ...C_PRESETS.map(n => C(`preset: ${n}`, preset(n), { seconds: 2 })),
  C('the System IIIc tile (makeSet s3c: Drift choir on the 36 modules)', MG.makeSet('s3c', {}), { seconds: 2 }),
  // a graph change mid-note (the 904C pulled, the 984 straight into the 902) and a routing switch (CP3 1's KEYBOARD off)
  (() => {
    const p = preset('Drift choir', MG.SETS.s3c.set), id = t => Object.keys(p.rec.mods).filter(k => p.rec.mods[k].t === t).sort((a, b) => +a.slice(1) - +b.slice(1));
    const [f] = id('904c'), [mx] = id('984'), [a] = id('902'), [m1] = id('cp3'), cIn = p.rec.cords.find(x => x.b === f + '.in'), cOut = p.rec.cords.find(x => x.a === f + '.out');
    const r1 = PT.plug(PT.pull(PT.pull(p.rec, cIn.id).rec, cOut.id).rec, mx + '.o1', a + '.i1').rec;
    return C('a graph change mid-note (the 904C pulled), then a CP3 routing switch', p, { seconds: 2,
      events: line(LEGATO).concat([[Q(0.5), { rec: r1 }], [Q(0.9), { knob: [m1, 'r1', 1] }], [Q(1.3), { knob: [m1, 'r1', 0] }]]) });
  })(),
  // OS 2; 44.1 kHz × 1
  C('Spring pluck at OS 2', preset('Spring pluck'), { os: 2 }),
  C('Drift choir at 44.1 kHz × 1', preset('Drift choir'), { os: 1, sr: 44100, events: line(LINE, 44100) }),
];

/* ------------------------------------------------------------------ rendering (golden-moog-b's) */
function renderP(X, c, { quanta = null } = {}) {
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
  const id = 'moog-c:' + c.name;
  S.g.currentFrame = 0; S.seed(id);
  const ev = (c.events || []).slice().sort((a, b) => a[0] - b[0]);
  const p = new S.Proc({ processorOptions: { os, hostOS: os } });
  S.seed(id);
  p.msg({ t: 'patch', p: patchOf(vals) }); p.msg({ t: 'seq', s: pay() });
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
  }
  return { L, R };
}

test('tests/ref-9c: the frozen files match their manifest (and the pinned hashes once set)' + (FROZEN ? '' : ' — NOT FROZEN YET: side A is the current tree (determinism only)'), (t) => {
  if (!FROZEN) { t.diagnostic('tests/ref-9c/MANIFEST.json missing: the lead freezes the refs at 9c\'s acceptance (GOLDEN_FREEZE_9C=1)'); return; }
  const m = JSON.parse(readFileSync(new URL('MANIFEST.json', REF), 'utf8'));
  assert.deepEqual(Object.keys(m.files).sort(), [...FILES].sort());
  for (const f of FILES) assert.equal(H.sha256(readFileSync(new URL(f, REF), 'utf8')), m.files[f].sha256, 'tests/ref-9c/' + f + ' was edited');
  if (PIN) assert.deepEqual(Object.fromEntries(FILES.map(f => [f, m.files[f].sha256])), PIN, 'the manifest is the pinned freeze');
});

test('the cases are patches a player can make (normPatch-stable, MAIN OUT patched), each of the ten 9c types in one, the CP3\'s four rows lit in one, each 9c preset once, the System IIIc tile', (t) => {
  if (!READY) { t.diagnostic(WAIT); return; }
  for (const c of CASES) {
    assert.deepEqual(PT.normPatch(H.clone(c.rec), MG.FAMILY.id), c.rec, c.name + ': normPatch-stable');
    for (const [, m] of (c.events || [])) if (m.rec) assert.deepEqual(PT.normPatch(H.clone(m.rec), MG.FAMILY.id), m.rec, c.name + ': its re-patch');
    assert.ok(PT.live(c.rec, MG.FAMILY.id, c.vals), c.name + ': MAIN OUT patched');
  }
  const types = new Set(CASES.flatMap(c => Object.values(c.rec.mods).map(m => m.t)));
  for (const t of C_TYPES) assert.ok(types.has(t), 'a case holds a ' + t);
  const lit = new Set();
  for (const c of CASES) for (const r of PT.busRows(c.rec, MG.FAMILY.id, c.vals)) if (c.rec.mods[r.panel] && c.rec.mods[r.panel].t === 'cp3') lit.add(r.i);
  for (const i of [0, 1, 2, 3]) assert.ok(lit.has(i), `cp3 row ${i} lit in a case`);
  assert.deepEqual(CASES.filter(c => c.name.startsWith('preset: ')).map(c => c.name.slice(8)), C_PRESETS);
  for (const n of C_PRESETS) assert.ok(MG.PRESETS.some(P => P.name === n), 'a 9c preset shipped: ' + n);
  for (const c of CASES) assert.equal(CASES.filter(x => x.name === c.name).length, 1, 'one case per name: ' + c.name);
});

test(`D2: the ten types at their settings, the CP3's rows, the three presets and the System IIIc tile, changes mid-note, OS 2, 44.1 kHz — ${FROZEN ? 'ref-9c vs current' : 'current vs current (not frozen yet)'}, bit-identical`, (t) => {
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

test('the cases differ where they should (side B): the 901\'s settings, the vernier spreads, the 904C\'s modes, the 905\'s MIX, the 912\'s responses, the 984\'s, the 991\'s, the presets; a CP3 routing switch is heard; span invariance (quanta of 4 and random) on the System IIIc tile', (t) => {
  if (!READY) { t.diagnostic(WAIT); return; }
  const by = p => CASES.filter(c => c.name.startsWith(p)), R = new Map(), get = c => { if (!R.has(c)) R.set(c, renderP(B, c)); return R.get(c); };
  for (const p of ['901: ', '901A → three', '904C:', '905: MIX', '912: ', '984:', '991:', 'preset:']) {
    const L = by(p);
    assert.ok(L.length >= 2, p);
    for (let i = 1; i < L.length; i++) assert.ok(H.compare(get(L[i - 1]), get(L[i])).max > 1e-3, `${L[i - 1].name} ≠ ${L[i].name}`);
  }
  const c = by('CP3 × 4')[0], d = Object.assign({}, c, { name: c.name + ' (KEYBOARD off)', vals: PT.setKnob(c.vals, c.rec, c.mid.m1, 'r1', 0) });
  assert.ok(H.compare(get(c), renderP(B, d)).max > 1e-3, 'the CP3\'s rows are heard');
  let s = 0x9c; const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return 4 * (1 + (s >>> 27)); };
  const iiic = by('the System IIIc tile')[0], q128 = get(iiic);
  for (const [w, x] of [['4', renderP(B, iiic, { quanta: () => 4 })], ['random', renderP(B, iiic, { quanta: rnd })]]) { const dd = H.compare(q128, x); assert.equal(dd.max, 0, `quanta of ${w}: ${H.describe(dd)}`); }
});
