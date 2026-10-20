// Stage 7a golden refs (IMPL-7a §12.2, D2 / D5; lane E). tests/ref-7a/ holds verbatim copies of dr-808.js, dr-seq.js and
// engine.js frozen by the lead at the acceptance commit, with MANIFEST.json { note, commit, files: { f: { sha256 } } }
// (ref-1c's format). Side A = the current tree with those three files replaced by the frozen copies (the rest of the DSP
// list and every module current, as ref-1c's side); side B = the current tree. Every case renders on both through the
// golden harness (its scopes, render, trackPatch) and must be bit-identical: max |A − B| === 0.
// BEFORE THE FREEZE (no tests/ref-7a/MANIFEST.json yet) side A is the current tree in a scope of its own: the test then
// checks B against itself twice — determinism, not the frozen sound — and says so in a diagnostic. The freeze (the lead,
// after the fix round): GOLDEN_FREEZE_7A=1 node --max-old-space-size=2048 --test tests/golden-drums.test.mjs writes
// tests/ref-7a/ from the working tree (the commit: git HEAD); then set PIN below to the manifest's hashes.
// Cases: every sound unaccented / accented (ACCENT 5 and 10) on three panels (the defaults; every TONE / DECAY / SNAPPY /
// TUNING knob at 0, at 10 — the LEVEL knobs and MASTER at their defaults: at 0 they would test silence — and the levels
// at 10, master at 3) and both switch settings; a 2-bar pattern (A / B alternating) synced from tick 0, then from bar 2
// with a loop, a stop and a restart; retrigger trains; the CH / OH choke; per-hit tom / conga and RS / CL flips; OS 2;
// 44.1 kHz × 1; two sample slots (the test's own fixture). Then D5 (side B only): the demo pattern with AB and a fill
// every 4 through the 808's sequencer vs drum-core toNotes of its plan through the song path — bit-identical over 8 bars
// at 120 BPM / 48 kHz, swing 50 and 62 %; at 97 BPM every hit on the same 4-frame grid point or the next.
// Run: node --max-old-space-size=2048 --test tests/golden-drums.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as H from './golden-harness.mjs';
import * as DC from '../drum-core.js?v=9';
import { playbackEntry } from '../smpwork.js?v=9';
import { mulberry32, fnv1a32 } from '../wt.js?v=9';

const REF = new URL('./ref-7a/', import.meta.url), FILES = ['dr-808.js', 'dr-seq.js', 'engine.js'];
// the frozen hashes, pinned by the lead at the freeze (null until then: the manifest alone is checked)
const PIN = { 'dr-808.js': 'a4098888d30d836778dc567c54aba0e9a5dc87a9b98ad37cf1c7cbcfd219c3a8', 'dr-seq.js': '20f6d3b7a208bff855beedc5e8f4ee0d3e50fa2142e5b0853cc2d9215f5ed5c9', 'engine.js': 'da710f7eaa49c46c0f6437206a97fb2a18c844fa2d229cbb442a0e62ce5c7b0e' }; // (frozen 2026-10-20 at 8f82f4b, the 7a acceptance commit)
const FREEZE = process.env.GOLDEN_FREEZE_7A === '1';
if (FREEZE) {
  mkdirSync(REF, { recursive: true });
  const files = {};
  for (const f of FILES) { const src = readFileSync(new URL(f, H.ROOT), 'utf8'); writeFileSync(new URL(f, REF), src); files[f] = { sha256: H.sha256(src) }; }
  let commit = '';
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' }).trim(); } catch { /* no git */ }
  writeFileSync(new URL('MANIFEST.json', REF), JSON.stringify({
    note: 'Frozen TR-808 sound (IMPL-7a §12.2, D2): verbatim copies of dr-808.js, dr-seq.js and engine.js at the 7a acceptance commit. Never edit: tests/golden-drums.test.mjs renders them (side A, every other module current) against the current files, bit for bit.',
    commit, files }, null, 2) + '\n');
}
const FROZEN = existsSync(new URL('MANIFEST.json', REF));

const [, B] = await H.sides();
// side A: B's modules and DSP list with the three frozen files (before the freeze: B's own sources, a scope of its own)
const frozen = f => (FROZEN ? readFileSync(new URL(f, REF), 'utf8') : null);
const A = Object.assign({}, B, {
  name: FROZEN ? 'ref-7a' : 'self', engine: frozen('engine.js') || B.engine,
  dsp: B.dsp.map(([f, c]) => [f, FILES.includes(f) ? frozen(f) || c : c]),
  entries: new Map(), user: new Map(), scopes: new Map(),
});
const SR = H.SR, FPT = (sr, bpm) => sr * 60 / (bpm * H.PPQ);
const M808 = B.models.MODELS.find(m => m.id === 'tr808');
const KNOBS = M808.controls.filter(c => c.t === 'k'), LEVELS = new Set(['bdl', 'sdl', 'ltl', 'mtl', 'htl', 'rsl', 'cpl', 'cbl', 'cyl', 'ohl', 'chl', 'vol']);
const vals = o => Object.assign(Object.fromEntries(M808.controls.map(c => [c.id, c.def])), o || {});
const allKnobs = (x, o) => vals(Object.assign(Object.fromEntries(KNOBS.filter(c => !LEVELS.has(c.id) && c.id !== 'ac').map(c => [c.id, x])), o));
const PRIM = Array.from(DC.primaries(DC.DEFAULT_MAP)); // the 16 sounds' primary notes (bd sd lt mt ht rs cp cb cy oh ch lc mc hc cl ma)

// the test's own sample fixture (a decaying tone and noise burst, 0.4 s, deterministic)
const SMP_ID = 'smp:7a7a7a7a7a7a7a7a';
const SMP = (() => {
  const n = Math.round(0.4 * SR), r = mulberry32(fnv1a32('golden-drums')), L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.6 * Math.exp(-i / (0.08 * SR)) * Math.sin(2 * Math.PI * 180 * i / SR) + 0.25 * Math.exp(-i / (0.02 * SR)) * (2 * r() - 1);
  return playbackEntry(SMP_ID, { rate: SR, ch: 1, len: n, L, R: null, root: 60, loop: null }, null, 2);
})();

// a dev.drum: key 1 A / B rows (step masks), the fill (key 13 A), panel ui / extras over a new machine's
function mem({ a = DC.DEMO.a, b = DC.DEMO.b, f = DC.DEMO.f, ui = {}, x = {}, smp = null } = {}) {
  const d = DC.normDrum(undefined);
  d.st[0] = a.slice(); d.st[1] = b.slice(); d.st[24] = f.slice();
  Object.assign(d.ui, { mode: DC.M_MAN }, ui); Object.assign(d.x, x);
  if (smp) d.smp = smp;
  return d;
}
const payload = (d, run) => DC.payload(d, Object.assign(DC.initState(), { run: !!run }), 'now');

// renders the 808 on side X: the panel `v`, the payload, events [[frame, msg]] (the harness posts them before the quantum
// at or after their frame); hits: log the machine's hit / trig calls as [spanF, sound]
function render808(X, { id, v = vals(), os = 4, sr = SR, events = [], seconds = 4, seq = null, smp = false, hits = null }) {
  const S = H.scope(X, sr);
  return H.render(S, {
    id, seconds, events, po: { os, hostOS: os },
    setup(p) {
      if (smp) S.g.SxBase.storeAsset(SMP_ID, SMP);
      p.msg({ t: 'patch', p: H.trackPatch(X, 'tr808', v, X.fxm.defaultFx2(), { sr }) });
      if (seq) p.msg({ t: 'seq', s: structuredClone(seq) });
      if (hits) {
        const dm = p.i0.dm, h = dm.hit, tr = dm.trig, sw = l => (p.i0.p.drum[DC.LANE_SW[l]] ? 1 : 0);
        dm.hit = function (s, v127) { hits.push([p.spanF, s, v127]); return h.call(this, s, v127); };
        dm.trig = function (m) { for (let l = 1; l < 12; l++) if (m & (1 << l)) hits.push([p.spanF, DC.LANE_SOUND[l][sw(l)], m & 1 ? 127 : 100]); return tr.call(this, m); };
      }
    },
  });
}
const on = (n, v) => ({ t: 'on', n, v }), off = n => ({ t: 'off', n });
const F = (t, sr = SR) => Math.round(t * sr);
// every sound in turn, unaccented then accented 0.12 s later (a retrigger of the ringing circuit)
const sweep = (sr = SR, dt = 0.24) => PRIM.flatMap((n, k) => [[F(k * dt, sr), on(n, 100 / 127)], [F(k * dt + 0.12, sr), on(n, 1)], [F(k * dt + 0.13, sr), off(n)]]);
const tp = (frame, o, sr = SR, bpm = 120) => [Math.max(0, frame - 1024), Object.assign({ t: 'transport', play: true, frame, fpt: FPT(sr, bpm) }, o)];

const CASES = [
  ...[['defaults', {}], ['knobs 0', { x: 0 }], ['knobs 10', { x: 10 }], ['levels 10', { lv: true }]].flatMap(([name, o]) => [5, 10].map(ac => {
    const v = o.lv ? vals(Object.assign(Object.fromEntries([...LEVELS].map(k => [k, 10])), { vol: 3, ac })) : o.x !== undefined ? allKnobs(o.x, { ac }) : vals({ ac });
    return { id: `sounds:${name}:ac${ac}`, v, events: sweep(), seconds: 16 * 0.24 + 0.6 };
  })),
  { id: 'sounds:switches 1', v: vals({ lts: 1, mts: 1, hts: 1, rss: 1, cps: 1, ac: 7 }), events: sweep(), seconds: 16 * 0.24 + 0.6 },
  { id: 'pattern:synced, bar 2 loop, stop, restart', seq: payload(mem({ ui: { bvar: 1 } })), seconds: 9,
    events: [tp(1024, { tick: 0, seek: true, loop: false }), tp(F(3.2), { tick: 3840, seek: true, loop: true, ls: 3840, le: 7680 }),
      [F(6.6), { t: 'transport', play: false }], tp(F(7.1), { tick: 0, seek: true, loop: false }), [F(8.0), on(38, 0.9)]].sort((a, b) => a[0] - b[0]) },
  { id: 'retrigger trains', seconds: 2.5, events: [36, 38, 49, 39].flatMap((n, k) => Array.from({ length: 12 }, (_, j) => [F(0.6 * k + 0.035 * j), on(n, j & 1 ? 1 : 0.8)])) },
  { id: 'choke', v: vals({ ohd: 10, ac: 8 }), seconds: 2.5,
    events: [[0, on(46, 0.8)], [F(0.06), on(42, 0.8)], [F(0.3), on(46, 1)], [F(0.33), on(46, 0.8)], [F(0.36), on(42, 1)], [F(0.6), on(46, 0.8)],
      [F(0.6), on(42, 0.8)], [F(1.0), on(42, 1)], [F(1.02), on(46, 0.9)], [F(1.5), on(46, 0.8)]] },
  ...[0, 1].map(sw => ({ id: `flips:switches ${sw}`, v: vals({ lts: sw, mts: sw, hts: sw, rss: sw }), seconds: 2.4,
    events: [41, 64, 45, 63, 48, 62, 37, 75].flatMap((n, k) => [[F(0.25 * k), on(n, 0.9)], [F(0.25 * k + 0.1), on(PRIM[[2, 11, 3, 12, 4, 13, 5, 14][k ^ 1]], 0.8)]]) })),
  { id: 'pattern:OS 2', os: 2, seq: payload(mem({ ui: { bvar: 1, fill: 4 }, x: { swing: 58 } })), seconds: 5, events: [tp(1024, { tick: 0, seek: true })] },
  { id: 'pattern:44.1 kHz × 1', sr: 44100, os: 1, seq: payload(mem({ ui: { bvar: 1 } })), seconds: 5, events: [tp(1024, { tick: 0, seek: true }, 44100)] },
  { id: 'samples:BD, SD', smp: true, seconds: 3.5, seq: payload(mem({ smp: { bd: { id: SMP_ID, name: 'kick', on: true }, sd: { id: SMP_ID, name: 'snare', on: true } } })),
    v: vals({ bdd: 3 }), events: [tp(1024, { tick: 0, seek: true }), [F(0.3), on(36, 1)], [F(0.31), on(42, 0.9)]] },
];

test('tests/ref-7a: the frozen files match their manifest (and the pinned hashes once set)' + (FROZEN ? '' : ' — NOT FROZEN YET: side A is the current tree (determinism only)'), (t) => {
  if (!FROZEN) { t.diagnostic('tests/ref-7a/MANIFEST.json missing: the lead freezes the refs at the acceptance commit (GOLDEN_FREEZE_7A=1)'); return; }
  const m = JSON.parse(readFileSync(new URL('MANIFEST.json', REF), 'utf8'));
  assert.deepEqual(Object.keys(m.files).sort(), [...FILES].sort());
  for (const f of FILES) assert.equal(H.sha256(readFileSync(new URL(f, REF), 'utf8')), m.files[f].sha256, 'tests/ref-7a/' + f + ' was edited');
  if (PIN) assert.deepEqual(Object.fromEntries(FILES.map(f => [f, m.files[f].sha256])), PIN, 'the manifest is the pinned freeze');
});

test(`D2: every sound, panel, pattern, choke, flip, OS 2, 44.1 kHz and sample case — ${FROZEN ? 'ref-7a vs current' : 'current vs current (not frozen yet)'}, bit-identical`, (t) => {
  if (!FROZEN) t.diagnostic('NOT FROZEN: side A is the current tree — these renders check determinism only');
  const bad = [];
  for (const c of CASES) {
    const r = [A, B].map(X => render808(X, Object.assign({}, c, { id: 'drums:' + c.id })));
    if (!H.finite(r[1]) || !(H.peak(r[1]) > 0.01)) bad.push(`${c.id}: silent or not finite (${H.peak(r[1])})`);
    const d = H.compare(r[0], r[1]);
    if (d.max !== 0) bad.push(`${c.id}: ${H.describe(d, c.sr || SR)}`);
  }
  assert.deepEqual(bad, []);
});

/* ------------------------------------------------------------------ D5: both ways are one sound (side B) */
// the plan: DEMO a / b, AB, the fill every 4 measures (the intro off); sync on, swing `sw`
const d5mem = sw => mem({ ui: { bvar: 1, fill: 4 }, x: { swing: sw } });
function both(bpm, sw, bars, sr = SR) {
  const d = d5mem(sw), seq = Object.assign(payload(d), { bpm }), plan = seq.plan, T = bars * 4 * H.PPQ;
  const notes = DC.toNotes(plan, { t0: 0, t1: T + 4 * H.PPQ, swing: sw, sw: {}, prim: PRIM }); // (default switches; a bar past the render's end)
  const song = { t: 'song', notes: notes.flatMap(x => [x.t, x.d, x.n, x.v]), cc: [] };
  const fpt = FPT(sr, bpm), F0 = 1024, seconds = (F0 + T * fpt) / sr + 0.25;
  const hs = [], hn = [];
  const a = render808(B, { id: 'd5:seq', sr, seq, seconds, hits: hs, events: [tp(F0, { tick: 0, seek: true }, sr, bpm)] });
  const b = render808(B, { id: 'd5:notes', sr, seconds, hits: hn, events: [[0, song], tp(F0, { tick: 0, seek: true }, sr, bpm)] });
  const key = h => h.slice().sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return { a, b, hs: key(hs), hn: key(hn), n: notes.length };
}

for (const sw of [50, 62]) {
  test(`D5: the demo pattern (AB, a fill every 4) through the sequencer = its notes through the song path, 8 bars at 120 BPM / 48 kHz, swing ${sw} % — bit-identical`, (t) => {
    const r = both(120, sw, 8);
    t.diagnostic(`${r.n} notes, ${r.hs.length} sequencer hits, peak ${H.peak(r.a).toFixed(3)}`);
    assert.ok(r.n > 100 && H.peak(r.a) > 0.1, 'a full pattern');
    assert.deepEqual(r.hn, r.hs, 'the same hits at the same frames, the same velocities');
    const d = H.compare(r.a, r.b);
    assert.equal(d.max, 0, H.describe(d));
  });
}

test('D5 at 97 BPM: every hit of the notes path fires on the sequencer\'s 4-frame grid point or the next', (t) => {
  const r = both(97, 62, 4);
  assert.equal(r.hn.length, r.hs.length, 'the same number of hits');
  let same = 0, late = 0;
  const bad = [];
  for (let i = 0; i < r.hs.length; i++) {
    const [fs, s, v] = r.hs[i], [fn, s2, v2] = r.hn[i], d = fn - fs;
    if (s !== s2 || v !== v2) bad.push(`hit ${i}: sound ${s}/${s2}, v ${v}/${v2}`);
    else if (d === 0) same++; else if (Math.abs(d) <= 4) late++; else bad.push(`hit ${i}: ${d} frames apart`);
  }
  t.diagnostic(`${r.hs.length} hits: ${same} on the same frame, ${late} one grid point apart`);
  assert.deepEqual(bad, []);
  if (late === 0) assert.equal(H.compare(r.a, r.b).max, 0, 'every hit aligned: bit-identical');
});
