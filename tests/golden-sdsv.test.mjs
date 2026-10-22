// Stage 7d + 8 golden refs (IMPL-8 §15.2, D2 / D5 / D7; lane E5). tests/ref-7d/ holds verbatim copies of dr-808.js, dr-seq.js
// and engine.js frozen by the lead at the acceptance commit (after the listening gate, §14.3), with MANIFEST.json { note,
// commit, files: { f: { sha256 } } } (ref-7a's format). Side A = the current tree with those three files replaced by the
// frozen copies (every other module current); side B = the current tree. Every case renders the SDS-V on both through the
// golden harness and must be bit-identical: max |A − B| === 0. From the freeze on, ref-7a guards the 808 (golden-drums),
// ref-7b the 606, ref-7c the 909 and ref-7d the SDS-V (D2): a later stage's change to the shared files keeps all four.
// BEFORE THE FREEZE (no tests/ref-7d/MANIFEST.json yet) side A is the current tree in a scope of its own: the test then checks
// B against itself — determinism, not the frozen sound — and says so in a diagnostic. The freeze (the lead, after the fix
// round and the user's listening): GOLDEN_FREEZE_7D=1 node --max-old-space-size=2048 --test tests/golden-sdsv.test.mjs writes
// tests/ref-7d/ from the working tree (the commit: git HEAD); then set PIN below to the manifest's hashes.
// Cases (no sequencer: hits are notes — through the Inst's message path or the song's roll notes): every card × memories 1–4
// (3 and 4 under two trim settings: the record's defaults and ours) × v 20 / 64 / 100 / 127 × SENSITIVITY 0 / 5 / 10 (v 20 at
// SENSITIVITY 0 is the comparator's silence, §11.4: kept, it pins the threshold); every card knob at 0 and at 10, the LEVELs
// and SENSITIVITYs at 10; retrigger trains; the dvp groove as roll notes with its payload (trims, the toms on memories 3 / 4)
// and without one (DEF_MAP); memory switches and a knob glide mid-ring; OS 2; 44.1 kHz × 1; two sample slots. Then (side B
// only) D7: the groove with trims bounced offline (processorOptions) = live, bit for bit; D5: notes posted to the Inst (the
// pads, the keyboard, MIDI) = the same notes as roll notes through the song path, on the same frames — bit for bit.
// Run: node --max-old-space-size=2048 --test tests/golden-sdsv.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as H from './golden-harness.mjs';
import * as DC from '../drum-core.js?v=9';
import { playbackEntry } from '../smpwork.js?v=9';
import { mulberry32, fnv1a32 } from '../wt.js?v=9';
import { songV, DRUM_PATTERNS } from './bench-scenarios.mjs';

const REF = new URL('./ref-7d/', import.meta.url), FILES = ['dr-808.js', 'dr-seq.js', 'engine.js'];
// the frozen hashes, pinned by the lead at the freeze (null until then: the manifest alone is checked)
const PIN = { 'dr-808.js': '3e10935d67bb74ad7afe5220c8d8275b17b6194dba86e0542bea0878d154bd2e', 'dr-seq.js': 'ff9675265d371e216d34ca0589aaaa9baee70507e81d92ae40c7e6380af9878b', 'engine.js': 'ae5f57537dba4d1c123d31844ec76db011d83dfbd5b175634040a10ac1a1a312' }; // (frozen 2026-10-21 at 0443a98, the 7d + 8 acceptance commit)
const FREEZE = process.env.GOLDEN_FREEZE_7D === '1';
if (FREEZE) {
  mkdirSync(REF, { recursive: true });
  const files = {};
  for (const f of FILES) { const src = readFileSync(new URL(f, H.ROOT), 'utf8'); writeFileSync(new URL(f, REF), src); files[f] = { sha256: H.sha256(src) }; }
  let commit = '';
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' }).trim(); } catch { /* no git */ }
  writeFileSync(new URL('MANIFEST.json', REF), JSON.stringify({
    note: 'Frozen SDS-V sound (IMPL-8 §15.2, D2): verbatim copies of dr-808.js (its five voice cards, the factory sounds and default trims), dr-seq.js and engine.js at the 7d + 8 acceptance commit. Never edit: tests/golden-sdsv.test.mjs renders them (side A, every other module current) against the current files, bit for bit.',
    commit, files }, null, 2) + '\n');
}
const FROZEN = existsSync(new URL('MANIFEST.json', REF));

const [, B] = await H.sides();
// side A: B's modules and DSP list with the three frozen files (before the freeze: B's own sources, a scope of its own)
const frozen = f => (FROZEN ? readFileSync(new URL(f, REF), 'utf8') : null);
const A = Object.assign({}, B, {
  name: FROZEN ? 'ref-7d' : 'self', engine: frozen('engine.js') || B.engine,
  dsp: B.dsp.map(([f, c]) => [f, FILES.includes(f) ? frozen(f) || c : c]),
  entries: new Map(), user: new Map(), scopes: new Map(),
});
const SR = H.SR, FPT = (sr, bpm) => sr * 60 / (bpm * H.PPQ);
const MV = B.models.MODELS.find(m => m.id === 'sdsv');
const CH = ['b', 's', '1', '2', '3'], SIX = ['n', 't', 'b', 'd', 'm', 'c'];
const vals = o => Object.assign(Object.fromEntries(MV.controls.map(c => [c.id, c.def])), o || {});
const every = (f, x) => Object.fromEntries(CH.map(c => ['x' + c + f, x]));
const shape = x => Object.assign({}, ...SIX.map(f => every(f, x)));
const NV = Array.from(DC.primaries(DC.PERS.sdsv.map, 'sdsv')).slice(0, 5); // by sound id: bass 36, snare 38, tom 3 41, tom 2 45, tom 1 48
const VV = [20, 64, 100, 127];

// the trims: the record's defaults (= the machine's TRIMV) and ours (every value distinct, off them)
const TR_OURS = [0, 1, 2, 3, 4].map(c => [0, 1].map(j => [0, 1, 2, 3, 4, 5].map(f => 0.05 + 0.9 * (((5 * c + 3 * j + 7 * f) % 11) / 10))));
const mem = tr => DC.normDrum(tr ? { m: 'sdsv', trim: tr } : undefined, 'sdsv');
const payload = d => DC.payload(d, DC.initState('sdsv'), 'now');
const DEF = payload(mem()), OURS = payload(mem(TR_OURS));

// the test's own sample fixture (a decaying tone and noise burst, 0.4 s, deterministic)
const SMP_ID = 'smp:7d7d7d7d7d7d7d7d';
const SMP = (() => {
  const n = Math.round(0.4 * SR), r = mulberry32(fnv1a32('golden-sdsv')), L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.6 * Math.exp(-i / (0.07 * SR)) * Math.sin(2 * Math.PI * 120 * i / SR) + 0.25 * Math.exp(-i / (0.02 * SR)) * (2 * r() - 1);
  return playbackEntry(SMP_ID, { rate: SR, ch: 1, len: n, L, R: null, root: 60, loop: null }, null, 2);
})();

// renders the SDS-V on side X: the panel `v`, the payload (or none), events [[frame, msg]] (the harness posts them before the
// quantum at or after their frame); hits: the machine's hit calls [frame, sound, v127]; po: processorOptions over { os }
function renderV(X, { id, v = vals(), os = 4, sr = SR, events = [], seconds = 4, seq = DEF, smp = false, hits = null, po = null }) {
  const S = H.scope(X, sr);
  return H.render(S, {
    id, seconds, events, po: Object.assign({ os, hostOS: os }, po ? po(S) : null),
    setup(p) {
      if (smp) S.g.SxBase.storeAsset(SMP_ID, SMP);
      if (!po) {
        p.msg({ t: 'patch', p: H.trackPatch(X, 'sdsv', v, X.fxm.defaultFx2(), { sr }) });
        if (seq) p.msg({ t: 'seq', s: structuredClone(seq) });
      }
      if (hits) { const dm = p.i0.dm, h = dm.hit; dm.hit = function (s, v127) { hits.push([p.nowF(), s, v127]); return h.call(this, s, v127); }; } // (the frame it belongs to: a posted note's next quantum)
    },
  });
}
const on = (n, v) => ({ t: 'on', n, v }), off = n => ({ t: 'off', n });
const F = (t, sr = SR) => Math.round(t * sr);
const patchMsg = (X, v, sr = SR) => ({ t: 'patch', p: H.trackPatch(X, 'sdsv', v, X.fxm.defaultFx2(), { sr }) });
// every card in turn: its four velocities 0.25 s apart (a retrigger train of v 20 → 127), the next card 1.2 s later
const DT = 1.2, SWEEP_S = 5 * DT + 1.6;
const sweep = (sr = SR) => [0, 1, 4, 3, 2].flatMap((s, k) => VV.map((v, j) => [F(k * DT + 0.25 * j, sr), on(NV[s], v / 127)]).concat([[F(k * DT + 0.9, sr), off(NV[s])]]));
const tp = (frame, o, sr = SR) => [Math.max(0, frame - 1024), Object.assign({ t: 'transport', play: true, frame, fpt: FPT(sr, 120) }, o)];
// the dvp groove as roll notes: its one-bar song, looping from tick 0 (4 bars = 8 s at 120 BPM)
const SONG = songV(DRUM_PATTERNS.dvp);
const groove = (sr = SR) => [[0, structuredClone(SONG)], tp(1024, { tick: 0, seek: true, loop: true, ls: 0, le: 3840 }, sr)];
const MEM34 = { xbp: 2, xsp: 3, x1p: 2, x2p: 3, x3p: 2 };

const CASES = [
  // each card × memories 1–4 × v × SENSITIVITY; memories 3 / 4 under both trim settings
  ...[0, 5, 10].flatMap(sens => [[0, DEF], [1, DEF], [2, DEF], [3, DEF], [2, OURS], [3, OURS]].map(([m, seq]) => ({
    id: `cards: memory ${m + 1}${m > 1 ? (seq === OURS ? ' (our trims)' : ' (default trims)') : ''}, SENSITIVITY ${sens}`,
    v: vals(Object.assign(every('p', m), every('s', sens))), seq, events: sweep(), seconds: SWEEP_S }))),
  { id: 'every card knob at 0', v: vals(shape(0)), events: sweep(), seconds: SWEEP_S },
  { id: 'every card knob at 10', v: vals(shape(10)), events: sweep(), seconds: SWEEP_S },
  { id: 'LEVELs and SENSITIVITYs at 10', v: vals(Object.assign(every('l', 10), every('s', 10))), events: sweep(), seconds: SWEEP_S },
  { id: 'retrigger trains', v: vals(every('d', 8)), seconds: 3.6,
    events: [0, 1, 4, 3, 2].flatMap((s, k) => Array.from({ length: 12 }, (_, j) => [F(0.6 * k + 0.035 * j), on(NV[s], VV[j & 3] / 127)])) },
  { id: 'groove: dvp as roll notes, its payload (our trims), the cards on memories 3 / 4', v: vals(MEM34), seq: OURS, events: groove(), seconds: 8.4 },
  { id: 'groove: dvp as roll notes without a payload (DEF_MAP)', seq: null, events: groove(), seconds: 8.4 },
  { id: 'memory switches and a knob glide mid-ring', v: vals({ x3d: 9, x1d: 8 }), seconds: 3,
    events: [[0, on(41, 1)], [F(0.05), on(48, 0.8)], [F(0.3), { mk: { x3p: 0, x1p: 2 } }], [F(0.6), { mk: { x3p: 2, x1p: 3 } }], [F(0.9), { mk: { x3p: 3, x1p: 0, x3t: 8, x1n: 1 } }],
      [F(1.4), on(41, 0.6)], [F(1.6), { mk: { x3p: 1, x1p: 1 } }]] },
  { id: 'groove: OS 2 (our trims, memories 3 / 4)', os: 2, v: vals(MEM34), seq: OURS, events: groove(), seconds: 4.4 },
  { id: 'groove: 44.1 kHz × 1', sr: 44100, os: 1, events: groove(44100), seconds: 4.4 },
  { id: 'samples: the bass drum and tom 1 slots (instead of their cards)', smp: true, seconds: 2.5,
    seq: payload(Object.assign(mem(), { smp: { bd: { id: SMP_ID, name: 'kick', on: true }, ht: { id: SMP_ID, name: 'tom', on: true } } })),
    events: [[F(0.1), on(36, 1)], [F(0.3), on(48, 0.5)], [F(0.31), on(38, 1)], [F(1.2), on(36, 64 / 127)], [F(1.25), on(41, 0.9)]] },
];
// a case's events for side X: { mk } = a {t: patch} with those panel values over the case's (a memory key, a knob)
const eventsOf = (X, c) => c.events.map(([f, m]) => [f, m.mk ? patchMsg(X, Object.assign({}, c.v || vals(), m.mk), c.sr || SR) : m]);

test('tests/ref-7d: the frozen files match their manifest (and the pinned hashes once set)' + (FROZEN ? '' : ' — NOT FROZEN YET: side A is the current tree (determinism only)'), (t) => {
  if (!FROZEN) { t.diagnostic('tests/ref-7d/MANIFEST.json missing: the lead freezes the refs at the acceptance commit (GOLDEN_FREEZE_7D=1)'); return; }
  const m = JSON.parse(readFileSync(new URL('MANIFEST.json', REF), 'utf8'));
  assert.deepEqual(Object.keys(m.files).sort(), [...FILES].sort());
  for (const f of FILES) assert.equal(H.sha256(readFileSync(new URL(f, REF), 'utf8')), m.files[f].sha256, 'tests/ref-7d/' + f + ' was edited');
  if (PIN) assert.deepEqual(Object.fromEntries(FILES.map(f => [f, m.files[f].sha256])), PIN, 'the manifest is the pinned freeze');
});

test(`D2: every card × memory × velocity × SENSITIVITY, knobs at 0 / 10, levels, trains, grooves (roll notes, with and without a payload), memory switches, OS 2, 44.1 kHz and sample case — ${FROZEN ? 'ref-7d vs current' : 'current vs current (not frozen yet)'}, bit-identical`, (t) => {
  if (!FROZEN) t.diagnostic('NOT FROZEN: side A is the current tree — these renders check determinism only');
  const bad = [];
  for (const c of CASES) {
    const r = [A, B].map(X => renderV(X, Object.assign({}, c, { id: 'sdsv:' + c.id, events: eventsOf(X, c) })));
    if (!H.finite(r[1]) || !(H.peak(r[1]) > 0.01)) bad.push(`${c.id}: silent or not finite (${H.peak(r[1])})`);
    const d = H.compare(r[0], r[1]);
    if (d.max !== 0) bad.push(`${c.id}: ${H.describe(d, c.sr || SR)}`);
  }
  assert.deepEqual(bad, []);
});

test('the cases differ where they should (side B): the four memories, the two trim settings, SENSITIVITY; v 20 at SENSITIVITY 0 fires nothing (the threshold) and at 5 it does; the slots play their sample', () => {
  const C = id => CASES.find(c => c.id === id), r = (c, o) => renderV(B, Object.assign({}, c, { id: 'sdsv:diff:' + c.id, events: eventsOf(B, c) }, o));
  const m = [0, 1, 2, 3].map(k => r(C(`cards: memory ${k + 1}${k > 1 ? ' (default trims)' : ''}, SENSITIVITY 5`)));
  // memories 1 and 2 at the default knobs: the same sound but for the knobs' one-ulp patch values (models.js: v / 10)
  for (const [i, j] of [[0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]) assert.ok(H.compare(m[i], m[j]).max > 1e-3, `memory ${i + 1} ≠ memory ${j + 1}`);
  assert.ok(H.compare(m[0], m[1]).max < 1e-6, 'memory 1 (factory) ≈ memory 2 at the default knobs (their patch values one ulp apart)');
  const ours = r(C('cards: memory 3 (our trims), SENSITIVITY 5'));
  assert.ok(H.compare(ours, m[2]).max > 1e-3, 'the trims change memory 3');
  const s0 = r(C('cards: memory 2, SENSITIVITY 0')), s10 = r(C('cards: memory 2, SENSITIVITY 10'));
  assert.ok(H.compare(s0, m[1]).max > 1e-3 && H.compare(s10, m[1]).max > 1e-3, 'SENSITIVITY changes the hits');
  // the threshold: the bass's first hit is v 20 (0.25 s alone) — silent at SENSITIVITY 0, sounding at 5
  const win = (R, t0, t1) => { let x = 0; for (let i = F(t0); i < F(t1); i++) x = Math.max(x, Math.abs(R.L[i])); return x; };
  assert.deepEqual([win(s0, 0, 0.24) === 0, win(m[1], 0, 0.24) > 0.01], [true, true], 'v 20: nothing at SENSITIVITY 0 (the comparator), a hit at 5');
  const sm = C('samples: the bass drum and tom 1 slots (instead of their cards)');
  assert.ok(H.compare(r(sm), r(sm, { seq: DEF })).max > 0.01, 'the slots change the render');
});

/* ------------------------------------------------------------------ D7, D5 (side B) */
// D7: the groove with its trims bounced offline — the node built from processorOptions (patch, seq, song, transport) as the
// bounce builds it — = the live node built by messages, bit for bit
test('D7: the dvp groove with our trims, the cards on memories 3 / 4 — offline (processorOptions) = live (messages), bit-identical', () => {
  const v = vals(MEM34), live = renderV(B, { id: 'd7', v, seq: OURS, events: groove(), seconds: 8.4 });
  const patch = H.trackPatch(B, 'sdsv', v, B.fxm.defaultFx2(), { sr: SR });
  const tr = groove()[1][1];
  const bounce = renderV(B, { id: 'd7', seconds: 8.4, po: () => ({ offline: true, patch, seq: structuredClone(OURS), song: structuredClone(SONG), transport: Object.assign({}, tr, { frame: 1024 }) }) });
  assert.ok(H.peak(live) > 0.1, 'the groove sounds');
  const d = H.compare(live, bounce);
  assert.equal(d.max, 0, H.describe(d));
});

// D5: the same hits two ways — {t: on} notes posted to the Inst (a pad, the keyboard, MIDI: before the quantum they belong to)
// and roll notes through the song path — on frames where both land: ticks on a 128-tick grid (3200 frames at 120 BPM / 48 kHz,
// 25 quanta) from the transport's frame 1024; every card, every velocity, retriggers, memories 3 / 4 with our trims
test('D5: notes posted to the Inst = the same notes as roll notes (the song path), every card and velocity, retriggers, our trims — the same hits on the same frames, bit-identical', (t) => {
  const v = vals(MEM34), notes = [], ev = [], r = mulberry32(fnv1a32('golden-sdsv-d5'));
  for (let k = 0; k < 48; k++) {
    const s = Math.floor(r() * 5), vel = 1 + Math.floor(r() * 127), tick = 128 * k;
    notes.push(tick, 60, NV[s], vel);
    ev.push([1024 + Math.round(tick * FPT(SR, 120)), on(NV[s], vel / 127)]);
    if (k % 7 === 3) { notes.push(tick, 60, NV[(s + 2) % 5], 127); ev.push([1024 + Math.round(tick * FPT(SR, 120)), on(NV[(s + 2) % 5], 1)]); }
  }
  const seconds = (1024 + 48 * 128 * FPT(SR, 120)) / SR + 1.5, hn = [], hs = [];
  const a = renderV(B, { id: 'd5:notes', v, seq: OURS, events: ev, seconds, hits: hn });
  const b = renderV(B, { id: 'd5:song', v, seq: OURS, seconds, hits: hs, events: [[0, { t: 'song', notes, cc: [] }], tp(1024, { tick: 0, seek: true })] });
  t.diagnostic(`${hn.length} hits, peak ${H.peak(a).toFixed(3)}`);
  assert.ok(hn.length >= 48 && H.peak(a) > 0.1, 'every note a hit');
  const key = h => h.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  assert.deepEqual(key(hs), key(hn), 'the same hits at the same frames, the same velocities');
  const d = H.compare(a, b);
  assert.equal(d.max, 0, H.describe(d));
});
