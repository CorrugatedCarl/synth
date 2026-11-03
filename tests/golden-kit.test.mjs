// Stage DM golden refs (IMPL-DM §8 G5, D1 / D4; lane V). tests/ref-DM/ holds verbatim copies of kit-dsp.js, dr-seq.js and engine.js
// frozen by the lead at cut 1's acceptance, with MANIFEST.json { note, commit, files: { f: { sha256 } } } (ref-7d's format). Side A =
// the current tree with those three files replaced by the frozen copies (every other module current); side B = the current tree.
// Every case renders the kit on both through the golden harness and must be bit-identical: max |A − B| === 0. From the freeze on,
// ref-DM guards our drum machine's sound as ref-7a…7d guard the four (a retune is a lead's re-freeze with a note, §12).
// NOT FROZEN YET (no tests/ref-DM/MANIFEST.json): the first test FAILS with the instruction — the lead records the refs ONCE at
// integration, on the merged tree (lane S's DrSeq `vl` branch and kit-core's plan in), after the reviewers:
//   GOLDEN_FREEZE_DM=1 node --max-old-space-size=2048 --test tests/golden-kit.test.mjs
// writes tests/ref-DM/ from the working tree (the commit: git HEAD); then set PIN below to the manifest's hashes. Until then side A
// is the current tree in a scope of its own: the cases check determinism (B against itself) and say so in a diagnostic.
// Cases (the Starter kit's model, its notes through the record's map): each type on slot 0 × TUNE / DECAY at 0 / 0.5 / 1 × each
// character knob at 0 / 1 × v 32 / 100 / 127 (one long render a type: a {t: patch} before each hit — a hit reads its slot's panel at
// its chunk); retrigger trains; chokes (the closed hat cutting the open one; a group of four); the fixture groove (tests/kit-fixtures
// GROOVE, never shipped) as roll notes, synced at 120 and 128 BPM, and as steps through DrSeq (the kit's plan, swing 62 — silent and
// skipped by the sound check while kit-core's compilePlan is phase 0's stub); OS 1 / 2 / 4; 44.1 kHz × 1.
// Run: node --max-old-space-size=2048 --test tests/golden-kit.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as H from './golden-harness.mjs';
import * as DC from '../drum-core.js?v=9';
import * as KC from '../kit-core.js?v=9';
import { GROOVE } from './kit-fixtures.mjs';

const KIT = KC.KIT;
const REF = new URL('./ref-DM/', import.meta.url), FILES = ['kit-dsp.js', 'dr-seq.js', 'engine.js'];
// the frozen hashes, pinned by the lead at the freeze (null until then: the manifest alone is checked)
const PIN = {'kit-dsp.js': 'd5e8f6050af2697d57d52d1f4e7b8736d2b0b92c3a6bc2b14c731a7702522b37', 'dr-seq.js': 'a63c61047c1797dd7d40a8b531afc432fe3c5dfc873e8e40119c073a066ff8cf', 'engine.js': '05dce3500d72c082895547b27bd17f092e42610a1deee067e4b7db73dc075e85'}; // (the lead, 2026-11-03: the freeze at the fix round's end)
const FREEZE = process.env.GOLDEN_FREEZE_DM === '1';
if (FREEZE) {
  mkdirSync(REF, { recursive: true });
  const files = {};
  for (const f of FILES) { const src = readFileSync(new URL(f, H.ROOT), 'utf8'); writeFileSync(new URL(f, REF), src); files[f] = { sha256: H.sha256(src) }; }
  let commit = '';
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' }).trim(); } catch { /* no git */ }
  writeFileSync(new URL('MANIFEST.json', REF), JSON.stringify({
    note: 'Frozen kit sound (IMPL-DM §8 G5, D1 / D4): verbatim copies of kit-dsp.js (our six voice types), dr-seq.js (the kit\'s vl branch) and engine.js at cut 1\'s acceptance commit. Never edit: tests/golden-kit.test.mjs renders them (side A, every other module current) against the current files, bit for bit.',
    commit, files }, null, 2) + '\n');
}
const FROZEN = existsSync(new URL('MANIFEST.json', REF));

const [, B] = await H.sides();
const frozen = f => (FROZEN ? readFileSync(new URL(f, REF), 'utf8') : null);
const A = Object.assign({}, B, {
  name: FROZEN ? 'ref-DM' : 'self', engine: frozen('engine.js') || B.engine,
  dsp: B.dsp.map(([f, c]) => [f, FILES.includes(f) ? frozen(f) || c : c]),
  entries: new Map(), user: new Map(), scopes: new Map(),
});
const SR = H.SR, FPT = (sr, bpm) => sr * 60 / (bpm * H.PPQ);
const MK = B.models.MODELS.find(m => m.id === 'kit');
// the panel values (knobs 0–10, TYPE / CHOKE indices): the Starter kit (the model's defaults) with o over it
const vals = o => Object.assign(Object.fromEntries(MK.controls.map(c => [c.id, c.def])), o || {});
// slot j's nine as values: { t, u, d, l, c, k: [4] } in positions → the model's units
const slot = (j, e) => { const s = KIT.CODES[j], o = { [s + 't']: e.t, [s + 'u']: 10 * e.u, [s + 'd']: 10 * e.d, [s + 'l']: 10 * (e.l ?? 0.7), [s + 'c']: e.c || 0 }; e.k.forEach((x, i) => { o[s + (i + 1)] = 10 * x; }); return o; };
const typeDef = t => ({ t, u: KIT.TYPES[t].u.def, d: KIT.TYPES[t].d.def, k: KIT.TYPES[t].k.map(q => q.def) });

// the Starter's record: its notes, its types, the fixture groove in pattern A
const NOTES = KIT.STARTER.map(e => e.n);
const REC = KC.normKit({ ty: KIT.STARTER.map(e => e.t).concat(new Array(8).fill(0)), map: Object.fromEntries(KIT.CODES.map((c, j) => [c, j < 8 ? [NOTES[j]] : []])), pat: [GROOVE] });
// the record's {t: seq} payload; (while lane S's payload is phase 0's stub — no map — the record's map and primaries by hand: the
// notes must reach their slots either way)
function payload(d, x) {
  const D = Object.assign({}, d, { x: Object.assign({}, d.x, x || {}) }), p = DC.payload(D, DC.initState('kit'), 'now');
  if (p.map && Array.prototype.some.call(p.map, v => v >= 0)) return p;
  const map = new Int8Array(128).fill(-1), prim = new Int8Array(16).fill(-1);
  KIT.CODES.forEach((c, j) => { const a = D.map[c] || []; a.forEach(n => { map[n] = j; }); if (a.length) prim[j] = a[0]; });
  return Object.assign({}, p, { map, prim });
}
const STEPS = (() => { try { return KC.compilePlan(REC, KC.initState()).n > 0; } catch { return false; } })(); // (lane S's plan in)
// the groove as roll notes: a one-bar song [tick, length, note, v] (a sixteenth 240 ticks, the notes 120 long)
const SONG = { t: 'song', notes: GROOVE.cells.flatMap(c => [240 * c.s, 120, NOTES[c.l], c.v]), cc: [] };
const on = (n, v) => ({ t: 'on', n, v }), F = (t, sr = SR) => Math.round(t * sr);
const tp = (frame, bpm, o, sr = SR) => [Math.max(0, frame - 1024), Object.assign({ t: 'transport', play: true, frame, fpt: FPT(sr, bpm) }, o)];

function renderK(X, { id, v = vals(), os = 4, sr = SR, events = [], seconds = 4, seq = payload(REC) }) {
  const S = H.scope(X, sr);
  return H.render(S, {
    id, seconds, events, po: { os, hostOS: os },
    setup(p) {
      p.msg({ t: 'patch', p: H.trackPatch(X, 'kit', v, X.fxm.defaultFx2(), { sr }) });
      if (seq) p.msg({ t: 'seq', s: structuredClone(seq) });
    },
  });
}
const patchMsg = (X, v, sr = SR) => ({ t: 'patch', p: H.trackPatch(X, 'kit', v, X.fxm.defaultFx2(), { sr }) });

// each type on slot 0: every panel variant (TUNE / DECAY 0 / 0.5 / 1; each k at 0 and at 1) × v 32 / 100 / 127, 0.3 s apart
const VARS = t => {
  const d = typeDef(t), out = [];
  for (const u of [0, 0.5, 1]) for (const dd of [0, 0.5, 1]) out.push(Object.assign({}, d, { u, d: dd }));
  for (let i = 0; i < 4; i++) for (const x of [0, 1]) out.push(Object.assign({}, d, { k: d.k.map((q, j) => (j === i ? x : q)) }));
  return out;
};
const sweepOf = t => VARS(t).flatMap((e, k) => [32, 100, 127].map((vv, j) => ({ f: F(0.3 * (3 * k + j)), mk: slot(0, e), n: 36, v: vv / 127 })));
const SWEEP_S = t => 0.3 * 3 * VARS(t).length + 2.5;
const CASES = [
  ...[1, 2, 3, 4, 5, 6].map(t => ({ id: `type ${t} on slot 0: TUNE / DECAY 0 · 0.5 · 1, each character knob 0 / 1, v 32 / 100 / 127`, sweep: sweepOf(t), seconds: SWEEP_S(t) })),
  { id: 'retrigger trains: every Starter voice, 12 hits 35 ms apart at v 32…127', seconds: 4,
    events: NOTES.flatMap((n, k) => Array.from({ length: 12 }, (_, j) => [F(0.45 * k + 0.035 * j), on(n, (32 + ((7 * j) % 96)) / 127)])) },
  { id: 'chokes: the closed hat cutting the open one; a group of four (kick, snare, clap, rim) hit in turn and two in one chunk', seconds: 3,
    v: vals(Object.assign({ kac: 2, kbc: 2, kcc: 2, khc: 2 })),
    events: [[F(0), on(46, 1)], [F(0.12), on(42, 0.8)], [F(0.4), on(46, 0.7)], [F(0.43), on(46, 1)], [F(0.6), on(42, 0.5)], [F(0.8), on(36, 1)], [F(0.9), on(38, 1)],
      [F(1.0), on(39, 1)], [F(1.1), on(37, 1)], [F(1.3), on(36, 1)], [F(1.3), on(38, 0.6)], [F(1.6), on(46, 1)], [F(1.6), on(42, 1)]] },
  { id: 'the fixture groove as roll notes, 120 BPM, synced from tick 0, 4 bars', seconds: 8.3, events: [[0, structuredClone(SONG)], tp(1024, 120, { tick: 0, seek: true, loop: true, ls: 0, le: 3840 })] },
  { id: 'the fixture groove as roll notes, 128 BPM, synced from tick 0, 4 bars', seconds: 7.8, events: [[0, structuredClone(SONG)], tp(1024, 128, { tick: 0, seek: true, loop: true, ls: 0, le: 3840 })] },
  { id: 'the fixture groove as steps (the kit\'s plan through DrSeq), 120 BPM, synced', seq: payload(REC), steps: true, seconds: 8.3, events: [tp(1024, 120, { tick: 0, seek: true })] },
  { id: 'the fixture groove as steps, 128 BPM, swing 62', seq: payload(REC, { swing: 62 }), steps: true, seconds: 7.8, events: [tp(1024, 128, { tick: 0, seek: true })] },
  { id: 'the groove as roll notes at OS 1', os: 1, seconds: 4.3, events: [[0, structuredClone(SONG)], tp(1024, 120, { tick: 0, seek: true, loop: true, ls: 0, le: 3840 })] },
  { id: 'the groove as roll notes at OS 2', os: 2, seconds: 4.3, events: [[0, structuredClone(SONG)], tp(1024, 120, { tick: 0, seek: true, loop: true, ls: 0, le: 3840 })] },
  { id: 'the groove as roll notes at 44.1 kHz × 1', sr: 44100, os: 1, seconds: 4.3, events: [[0, structuredClone(SONG)], tp(1024, 120, { tick: 0, seek: true, loop: true, ls: 0, le: 3840 }, 44100)] },
  { id: 'the Crunch kit (the drives) and the Deep kit, every voice in turn', seconds: 5, v: vals(KIT.KITS[3].v),
    events: NOTES.map((n, k) => [F(0.3 * k), on(n, 1)]).concat([[F(2.6), { mk: KIT.KITS[1].v }]], NOTES.map((n, k) => [F(2.6 + 0.3 * k), on(n, 0.8)])) },
];
// a case's events for side X: a sweep's { mk } = a {t: patch} with those panel values before its hit
const eventsOf = (X, c) => (c.sweep ? c.sweep.flatMap(h => [[h.f, patchMsg(X, vals(h.mk), c.sr || SR)], [h.f, on(h.n, h.v)]]) : c.events.map(([f, m]) => [f, m.mk ? patchMsg(X, vals(m.mk), c.sr || SR) : m]));

test('tests/ref-DM: the frozen files match their manifest (and the pinned hashes once set)' + (FROZEN ? '' : ' — NOT RECORDED YET: the lead records them at integration'), () => {
  assert.ok(FROZEN, 'tests/ref-DM/MANIFEST.json is not recorded yet — the lead records it ONCE at integration, on the merged tree: GOLDEN_FREEZE_DM=1 node --max-old-space-size=2048 --test tests/golden-kit.test.mjs (then set PIN in this file to the manifest\'s hashes)');
  const m = JSON.parse(readFileSync(new URL('MANIFEST.json', REF), 'utf8'));
  assert.deepEqual(Object.keys(m.files).sort(), [...FILES].sort());
  for (const f of FILES) assert.equal(H.sha256(readFileSync(new URL(f, REF), 'utf8')), m.files[f].sha256, 'tests/ref-DM/' + f + ' was edited');
  if (PIN) assert.deepEqual(Object.fromEntries(FILES.map(f => [f, m.files[f].sha256])), PIN, 'the manifest is the pinned freeze');
});

test(`G5: every type × panel × velocity, trains, chokes, the groove as roll notes and as steps, OS 1 / 2 / 4, 44.1 kHz, two kits — ${FROZEN ? 'ref-DM vs current' : 'current vs current (not frozen yet)'}, bit-identical`, (t) => {
  if (!FROZEN) t.diagnostic('NOT FROZEN: side A is the current tree — these renders check determinism only');
  if (!STEPS) t.diagnostic('kit-core\'s compilePlan is phase 0\'s stub: the step cases render the empty plan (silent; their sound check skipped)');
  const bad = [];
  for (const c of CASES) {
    const r = [A, B].map(X => renderK(X, Object.assign({}, c, { id: 'kit:' + c.id, events: eventsOf(X, c) })));
    if (!H.finite(r[1])) bad.push(`${c.id}: not finite`);
    else if ((!c.steps || STEPS) && !(H.peak(r[1]) > 0.01)) bad.push(`${c.id}: silent (${H.peak(r[1])})`);
    const d = H.compare(r[0], r[1]);
    if (d.max !== 0) bad.push(`${c.id}: ${H.describe(d, c.sr || SR)}`);
  }
  assert.deepEqual(bad, []);
});

test('the cases differ where they should (side B): the six types, TUNE, DECAY, a character knob, the velocity, the kits', () => {
  const r = (ev, o) => renderK(B, Object.assign({ id: 'kit:diff', seconds: 1.2, events: ev }, o)), hit = [[0, on(36, 100 / 127)]];
  const ty = [1, 2, 3, 4, 5, 6].map(t => r(hit, { v: vals(slot(0, typeDef(t))) }));
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) assert.ok(H.compare(ty[i], ty[j]).max > 1e-3, `type ${i + 1} ≠ type ${j + 1}`);
  const k = typeDef(1), x = r(hit, { v: vals(slot(0, k)) });
  for (const o of [{ u: 0.9 }, { d: 0.9 }, { k: [0.9, k.k[1], k.k[2], k.k[3]] }]) assert.ok(H.compare(x, r(hit, { v: vals(slot(0, Object.assign({}, k, o))) })).max > 1e-3, JSON.stringify(o));
  assert.ok(H.compare(x, r([[0, on(36, 1)]], { v: vals(slot(0, k)) })).max > 1e-3, 'velocity');
  assert.ok(H.compare(r(hit), r(hit, { v: vals(KIT.KITS[1].v) })).max > 1e-3, 'the Deep kit\'s kick');
});
