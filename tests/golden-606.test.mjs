// Stage 7b golden refs (IMPL-7b §12.2, D2 / D5 / §3.8; lane E6). tests/ref-7b/ holds verbatim copies of dr-808.js, dr-seq.js and
// engine.js frozen by the lead at the acceptance commit, with MANIFEST.json { note, commit, files: { f: { sha256 } } } (ref-7a's
// format). Side A = the current tree with those three files replaced by the frozen copies (every other module current); side
// B = the current tree. Every case renders the TR-606 on both through the golden harness and must be bit-identical: max |A −
// B| === 0. From the freeze on, ref-7a guards the 808 (golden-drums) and ref-7b the 606 (D2): a later stage's change to the
// shared files keeps both.
// BEFORE THE FREEZE (no tests/ref-7b/MANIFEST.json yet) side A is the current tree in a scope of its own: the test then checks
// B against itself — determinism, not the frozen sound — and says so in a diagnostic. The freeze (the lead, after the fix
// round): GOLDEN_FREEZE_7B=1 node --max-old-space-size=2048 --test tests/golden-606.test.mjs writes tests/ref-7b/ from the
// working tree (the commit: git HEAD); then set PIN below to the manifest's hashes.
// Cases: every sound at V_N then V_A 0.12 s later (a retrigger) at ACCENT 5 and 10 on three panels (the defaults; every TUNE /
// DECAY extra at 0; at 10) and the levels at 10 with VOLUME 3; OH + CH on one step and the CH choke; the open hat ringing on
// the tempo clock at 60 and 240 BPM (the song's ticks: the cut); the DEMO chain (I-1 → I-2) synced from tick 0, then from bar
// 2 with a loop, a stop and a restart; STEP RESET synced and free (swing 58 %); a track with its D.C. bar and a D.S. jump;
// retrigger trains; OS 2; 44.1 kHz × 1; two sample slots (the test's own fixture). Then D5 (side B only): the DEMO chain
// through the 606's sequencer vs drum-core toNotes of its plan (the 606's primaries) through the song path — bit-identical over
// 8 bars at 120 BPM / 48 kHz, swing 50 and 62 %, open hats included, without a payload and with the SYNC-off payload → Piano
// roll leaves; one chain whose accented open hat rings unchoked for two bars, so both paths cross the tempo cut (review #12);
// at 97 BPM every hit on the same 4-frame grid point or the next. And the acid pair (§3.8, side B): a synced TB-303 (its
// default pattern) and the synced 606 (its DEMO) from the same transport (a start at bar 3, a seek, a loop wrap): every 606
// sixteenth on the 303's step of the same index, on its 4-frame grid point or the next — straight, and at 62 % against the
// 303's 4 · (62 − 50) within half a tick more.
// Run: node --max-old-space-size=2048 --test tests/golden-606.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as H from './golden-harness.mjs';
import * as DC from '../drum-core.js?v=9';
import { SEQ_DEF } from '../classic-panel.js?v=9';
import { playbackEntry } from '../smpwork.js?v=9';
import { mulberry32, fnv1a32 } from '../wt.js?v=9';

const REF = new URL('./ref-7b/', import.meta.url), FILES = ['dr-808.js', 'dr-seq.js', 'engine.js'];
// the frozen hashes, pinned by the lead at the freeze (null until then: the manifest alone is checked)
const PIN = { 'dr-808.js': '7588143ff373211d1322f43176dd23c9018fe4e11c2c18eb8d8df4140228cbf2', 'dr-seq.js': 'c2b40e5009c2beff4339fae3d12dd26ff86bfabc159519b23ead5b4e190648e5', 'engine.js': '4da58744a7fa6aea9071c816ab1292678252a7f3a8383be3bfc9b10b843c1e66' }; // (frozen 2026-10-20 at e697387, the 7b acceptance commit)
const FREEZE = process.env.GOLDEN_FREEZE_7B === '1';
if (FREEZE) {
  mkdirSync(REF, { recursive: true });
  const files = {};
  for (const f of FILES) { const src = readFileSync(new URL(f, H.ROOT), 'utf8'); writeFileSync(new URL(f, REF), src); files[f] = { sha256: H.sha256(src) }; }
  let commit = '';
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' }).trim(); } catch { /* no git */ }
  writeFileSync(new URL('MANIFEST.json', REF), JSON.stringify({
    note: 'Frozen TR-606 sound (IMPL-7b §12.2, D2): verbatim copies of dr-808.js, dr-seq.js and engine.js at the 7b acceptance commit. Never edit: tests/golden-606.test.mjs renders them (side A, every other module current) against the current files, bit for bit.',
    commit, files }, null, 2) + '\n');
}
const FROZEN = existsSync(new URL('MANIFEST.json', REF));

const [, B] = await H.sides();
// side A: B's modules and DSP list with the three frozen files (before the freeze: B's own sources, a scope of its own)
const frozen = f => (FROZEN ? readFileSync(new URL(f, REF), 'utf8') : null);
const A = Object.assign({}, B, {
  name: FROZEN ? 'ref-7b' : 'self', engine: frozen('engine.js') || B.engine,
  dsp: B.dsp.map(([f, c]) => [f, FILES.includes(f) ? frozen(f) || c : c]),
  entries: new Map(), user: new Map(), scopes: new Map(),
});
const SR = H.SR, FPT = (sr, bpm) => sr * 60 / (bpm * H.PPQ);
const M606 = B.models.MODELS.find(m => m.id === 'tr606');
const EXTRAS = ['bdu', 'bdd', 'sdu', 'sdd', 'ltu', 'ltd', 'htu', 'htd', 'cyd', 'ohd', 'chd'], LEVELS = ['bdl', 'sdl', 'tml', 'cyl', 'hhl'];
const vals = o => Object.assign(Object.fromEntries(M606.controls.map(c => [c.id, c.def])), o || {});
const extras = (x, o) => vals(Object.assign(Object.fromEntries(EXTRAS.map(k => [k, x])), o));
const PRIM = Array.from(DC.primaries(DC.MAP606, 'tr606')); // by sound id (−1: a sound the 606 lacks)
const PRIM6 = DC.SIDS606.map(s => PRIM[s]); // bd sd lt ht cy oh ch: 36 38 41 48 49 46 42

// the test's own sample fixture (a decaying tone and noise burst, 0.4 s, deterministic)
const SMP_ID = 'smp:7b7b7b7b7b7b7b7b';
const SMP = (() => {
  const n = Math.round(0.4 * SR), r = mulberry32(fnv1a32('golden-606')), L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.6 * Math.exp(-i / (0.07 * SR)) * Math.sin(2 * Math.PI * 160 * i / SR) + 0.25 * Math.exp(-i / (0.02 * SR)) * (2 * r() - 1);
  return playbackEntry(SMP_ID, { rate: SR, ch: 1, len: n, L, R: null, root: 60, loop: null }, null, 2);
})();

// a 606 record: patterns I-1 / I-2 (step masks; I-2 given: the chain 1–2), PATTERN PLAY; ui / x / extra fields over a new machine's
function mem({ a = DC.DEMO606.a, b = DC.DEMO606.b, ui = {}, x = {}, smp = null, edit = null } = {}) {
  const d = DC.normDrum(undefined, 'tr606');
  d.st[0] = a.slice();
  if (b) d.st[1] = b.slice();
  Object.assign(d.ui, { mode: DC.M6_PP, grp: 0, sel: 0, cl: b ? 1 : 0 }, ui); Object.assign(d.x, x);
  if (smp) d.smp = smp;
  if (edit) edit(d);
  return d;
}
const payload = (d, S) => DC.payload(d, Object.assign(DC.initState('tr606'), S || {}), (S && S.at) || 'now');
const seqMsg = (d, S) => ({ t: 'seq', s: payload(d, S) });

// renders the 606 on side X: the panel `v`, the payload, events [[frame, msg]] (the harness posts them before the quantum at
// or after their frame); hits: the machine's hit / trig calls as [spanF, sound, v]; posts: the steps posted
function render606(X, { id, v = vals(), os = 4, sr = SR, events = [], seconds = 4, seq = null, smp = false, hits = null, posts = null }) {
  const S = H.scope(X, sr);
  return H.render(S, {
    id, seconds, events, po: { os, hostOS: os },
    setup(p) {
      if (smp) S.g.SxBase.storeAsset(SMP_ID, SMP);
      p.msg({ t: 'patch', p: H.trackPatch(X, 'tr606', v, X.fxm.defaultFx2(), { sr }) });
      if (seq) p.msg({ t: 'seq', s: structuredClone(seq) });
      if (posts) p.port.postMessage = m => { if (m && m.t === 'step') posts.push(m); };
      if (hits) {
        const dm = p.i0.dm, h = dm.hit, tr = dm.trig;
        dm.hit = function (s, v127) { hits.push([p.spanF, s, v127]); return h.call(this, s, v127); };
        dm.trig = function (m) { for (let l = 1; l < 12; l++) if (m & (1 << l) & DC.MASK606) hits.push([p.spanF, DC.LANE_SOUND[l][0], m & 1 ? 127 : 100]); return tr.call(this, m); };
      }
    },
  });
}
const on = (n, v) => ({ t: 'on', n, v }), off = n => ({ t: 'off', n });
const F = (t, sr = SR) => Math.round(t * sr);
// every sound in turn at V_N (v 100), then at V_A 0.12 s later (v 127: a retrigger of the ringing circuit)
const sweep = (sr = SR, dt = 0.3) => PRIM6.flatMap((n, k) => [[F(k * dt, sr), on(n, 100 / 127)], [F(k * dt + 0.12, sr), on(n, 1)], [F(k * dt + 0.13, sr), off(n)]]);
const tp = (frame, o, sr = SR, bpm = 120) => [Math.max(0, frame - 1024), Object.assign({ t: 'transport', play: true, frame, fpt: FPT(sr, bpm) }, o)];
const SWEEP_S = 7 * 0.3 + 0.8;

// a track: bars 0–4 of track 1 (I-1, I-2, I-2, I-1, I-2), its D.C. on bar 3, its segno on bar 1 — TRACK PLAY (not periodic:
// the D.S. cycle I-2 I-2 I-1 I-1 differs from the plain one wherever it enters)
const trackMem = x => mem({ ui: { mode: DC.M6_TP, inst: 0 }, x, edit: d => { [0, 1, 1, 0, 1].forEach((k, j) => { d.rt[j] = k; }); d.dc[0] = 3; d.sg[0] = 1; } });

const CASES = [
  ...[['defaults', {}], ['extras 0', { x: 0 }], ['extras 10', { x: 10 }], ['levels 10, VOLUME 3', { lv: true }]].flatMap(([name, o]) => [5, 10].map(ac => {
    const v = o.lv ? vals(Object.assign(Object.fromEntries(LEVELS.map(k => [k, 10])), { vol: 3, ac })) : o.x !== undefined ? extras(o.x, { ac }) : vals({ ac });
    return { id: `sounds:${name}:ac${ac}`, v, events: sweep(), seconds: SWEEP_S };
  })),
  { id: 'hats: OH + CH on one chunk, the choke', v: vals({ ohd: 8, ac: 8 }), seconds: 2.6,
    events: [[0, on(46, 0.8)], [0, on(42, 0.8)], [F(0.3), on(46, 1)], [F(0.36), on(42, 0.8)], [F(0.6), on(46, 0.8)], [F(0.9), on(42, 1)], [F(0.92), on(46, 1)],
      [F(1.2), on(46, 1)], [F(1.25), on(42, 100 / 127)]] },
  ...[60, 240].map(bpm => ({ id: `the open hat on the tempo clock at ${bpm} BPM`, v: vals({ ac: 10 }), seconds: 4.5,
    events: [tp(1024, { tick: 0, seek: true }, SR, bpm), [F(0.1), on(46, 1)], [F(2.6), on(46, 1)]] })),
  { id: 'pattern: the DEMO chain synced, bar 2 loop, stop, restart', seq: payload(mem()), seconds: 9,
    events: [tp(1024, { tick: 0, seek: true, loop: false }), tp(F(3.2), { tick: 3840, seek: true, loop: true, ls: 3840, le: 11520 }),
      [F(6.6), { t: 'transport', play: false }], tp(F(7.1), { tick: 0, seek: true, loop: false }), [F(8.0), on(38, 0.9)]].sort((a, b) => a[0] - b[0]) },
  { id: 'STEP RESET synced', seq: payload(mem()), seconds: 5,
    events: [tp(1024, { tick: 0, seek: true }), [F(1.3), seqMsg(mem(), { rst: 1 })], [F(2.95), seqMsg(mem(), { rst: 2 })]] },
  { id: 'STEP RESET free, swing 58 %', seq: payload(mem({ x: { sync: false, swing: 58 }, ui: { tempo: 137.5 } }), { run: true }), seconds: 4,
    events: [[F(1.1), seqMsg(mem({ x: { sync: false, swing: 58 }, ui: { tempo: 137.5 } }), { run: true, rst: 1 })]] },
  { id: 'track: D.C. bar, a D.S. jump', seq: payload(trackMem()), seconds: 10,
    events: [tp(1024, { tick: 0, seek: true }), [F(4.3), seqMsg(trackMem(), { ds: 1, at: 'bar' })]] },
  { id: 'retrigger trains', v: vals({ ac: 7 }), seconds: 3, events: [36, 38, 41, 48, 46].flatMap((n, k) => Array.from({ length: 12 }, (_, j) => [F(0.55 * k + 0.035 * j), on(n, j & 1 ? 1 : 0.8)])) },
  { id: 'pattern: OS 2', os: 2, seq: payload(mem({ x: { swing: 58 } })), seconds: 5, events: [tp(1024, { tick: 0, seek: true })] },
  { id: 'pattern: 44.1 kHz × 1', sr: 44100, os: 1, seq: payload(mem()), seconds: 5, events: [tp(1024, { tick: 0, seek: true }, 44100)] },
  { id: 'samples: BD, SD', smp: true, seconds: 3.5, seq: payload(mem({ smp: { bd: { id: SMP_ID, name: 'kick', on: true }, sd: { id: SMP_ID, name: 'snare', on: true } } })),
    v: vals({ bdd: 3, sdu: 7 }), events: [tp(1024, { tick: 0, seek: true }), [F(0.3), on(36, 1)], [F(0.31), on(42, 0.9)]] },
];

test('tests/ref-7b: the frozen files match their manifest (and the pinned hashes once set)' + (FROZEN ? '' : ' — NOT FROZEN YET: side A is the current tree (determinism only)'), (t) => {
  if (!FROZEN) { t.diagnostic('tests/ref-7b/MANIFEST.json missing: the lead freezes the refs at the acceptance commit (GOLDEN_FREEZE_7B=1)'); return; }
  const m = JSON.parse(readFileSync(new URL('MANIFEST.json', REF), 'utf8'));
  assert.deepEqual(Object.keys(m.files).sort(), [...FILES].sort());
  for (const f of FILES) assert.equal(H.sha256(readFileSync(new URL(f, REF), 'utf8')), m.files[f].sha256, 'tests/ref-7b/' + f + ' was edited');
  if (PIN) assert.deepEqual(Object.fromEntries(FILES.map(f => [f, m.files[f].sha256])), PIN, 'the manifest is the pinned freeze');
});

test(`D2: every sound, panel, hat, clock, pattern, STEP RESET, track, train, OS 2, 44.1 kHz and sample case — ${FROZEN ? 'ref-7b vs current' : 'current vs current (not frozen yet)'}, bit-identical`, (t) => {
  if (!FROZEN) t.diagnostic('NOT FROZEN: side A is the current tree — these renders check determinism only');
  const bad = [];
  for (const c of CASES) {
    const r = [A, B].map(X => render606(X, Object.assign({}, c, { id: 'tr606:' + c.id })));
    if (!H.finite(r[1]) || !(H.peak(r[1]) > 0.01)) bad.push(`${c.id}: silent or not finite (${H.peak(r[1])})`);
    const d = H.compare(r[0], r[1]);
    if (d.max !== 0) bad.push(`${c.id}: ${H.describe(d, c.sr || SR)}`);
  }
  assert.deepEqual(bad, []);
});

test('the cases differ where they should: STEP RESET moves the pattern, the D.S. jumps, the tempo moves the open hat\'s cut (side B)', () => {
  const C = id => CASES.find(c => c.id === id), r = (c, o) => render606(B, Object.assign({}, c, { id: 'tr606:diff:' + c.id }, o));
  const rs = C('STEP RESET synced'), plain = r(rs, { events: rs.events.slice(0, 1) });
  assert.ok(H.compare(r(rs), plain).max > 0.01, 'STEP RESET changes the render');
  const tr = C('track: D.C. bar, a D.S. jump');
  assert.ok(H.compare(r(tr), r(tr, { events: tr.events.slice(0, 1) })).max > 0.01, 'the D.S. changes the render');
  // the same open hat, the clock at 60 vs 240 BPM: the cut differs after its onset (≈ 0.9 s at 240 BPM; before it, Q24's
  // junction draws a trace from C41's first pulses, −100 dB and less)
  const a = r(C('the open hat on the tempo clock at 60 BPM')), b = r(C('the open hat on the tempo clock at 240 BPM'));
  let early = 0, late = 0;
  for (let i = F(0.1); i < F(0.5); i++) early = Math.max(early, Math.abs(a.L[i] - b.L[i]));
  for (let i = F(1.0); i < F(2.5); i++) late = Math.max(late, Math.abs(a.L[i] - b.L[i]));
  assert.ok(early < 1e-5 && late > 1e-3, `the clock acts through the cut: Q24's junction, from C41's first pulses (before the onset ${early}, after ${late})`);
});

/* ------------------------------------------------------------------ D5: both ways are one sound (side B) */
// the DEMO chain (I-1 → I-2; or rows a / b), sync on, swing sw, panel v: the sequencer path vs toNotes of its plan (the 606's
// primaries) through the song path — without a payload (the default map) and with the SYNC-off payload → Piano roll leaves
function both(bpm, sw, bars, { a, b, v = vals(), notesSeq = false, sr = SR } = {}) {
  const d = mem({ a, b, x: { swing: sw } }), seq = payload(d), plan = seq.plan, T = bars * 4 * H.PPQ;
  const notes = DC.toNotes(plan, { t0: 0, t1: T + 4 * H.PPQ, swing: sw, sw: {}, prim: DC.primaries(d.map, 'tr606') });
  const song = { t: 'song', notes: notes.flatMap(x => [x.t, x.d, x.n, x.v]), cc: [] };
  const fpt = FPT(sr, bpm), F0 = 1024, seconds = (F0 + T * fpt) / sr + 0.25;
  const off = notesSeq ? payload(mem({ a, b, x: { swing: sw, sync: false } })) : null;
  const hs = [], hn = [];
  const x = render606(B, { id: 'd5:seq', sr, v, seq: Object.assign({}, seq, { bpm }), seconds, hits: hs, events: [tp(F0, { tick: 0, seek: true }, sr, bpm)] });
  const y = render606(B, { id: 'd5:notes', sr, v, seq: off, seconds, hits: hn, events: [[0, song], tp(F0, { tick: 0, seek: true }, sr, bpm)] });
  const key = h => h.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return { a: x, b: y, hs: key(hs), hn: key(hn), n: notes.length, oh: notes.filter(z => z.n === 46).length };
}

for (const sw of [50, 62]) {
  for (const notesSeq of [false, true]) {
    test(`D5: the DEMO chain through the sequencer = its notes through the song path (${notesSeq ? 'the SYNC-off payload' : 'no payload'}), 8 bars at 120 BPM / 48 kHz, swing ${sw} % — bit-identical`, (t) => {
      const r = both(120, sw, 8, { notesSeq });
      t.diagnostic(`${r.n} notes (${r.oh} open hats), ${r.hs.length} sequencer hits, peak ${H.peak(r.a).toFixed(3)}`);
      assert.ok(r.n > 100 && r.oh >= 8 && H.peak(r.a) > 0.1, 'a full pattern, open hats');
      assert.deepEqual(r.hn, r.hs, 'the same hits at the same frames, the same velocities');
      const d = H.compare(r.a, r.b);
      assert.equal(d.max, 0, H.describe(d));
    });
  }
}

// review #12: an accented open hat on beat 1 of I-1 and none in I-2, no closed hat — it rings two bars unchoked, past the cut's
// onset (3.5 beats at its default DECAY), so the clock's pulses and Q24's drain are in both paths' bytes
test('D5 through the open hat\'s tempo cut: an accented OH ringing unchoked for two bars, sequencer = notes, 8 bars at 120 BPM — bit-identical', (t) => {
  const rows = o => { const st = new Array(16).fill(0); for (const [l, r] of Object.entries(o)) for (let s = 0; s < 16; s++) if (r[s] === 'x') st[s] |= 1 << DC.LANES.indexOf(l); return st; };
  const a = rows({ ac: 'x...............', bd: 'x...x...x...x...', oh: 'x...............' }), b = rows({ bd: 'x...x...x...x...', sd: '....x.......x...' });
  const r = both(120, 50, 8, { a, b, v: vals({ ac: 10 }) });
  // the cut is in the render: the same OH without the clock's pulses would sound longer — measured on side B with the transport
  // at 30 BPM (onset 7 s): the first OH's tail at 2.0–3.0 s is quieter at 120 BPM
  const slow = render606(B, { id: 'd5:cut:30', v: vals({ ac: 10 }), seconds: 3.2, events: [tp(1024, { tick: 0, seek: true }, SR, 30), [1024, on(46, 1)]] });
  const fast = render606(B, { id: 'd5:cut:120', v: vals({ ac: 10 }), seconds: 3.2, events: [tp(1024, { tick: 0, seek: true }, SR, 120), [1024, on(46, 1)]] });
  const rms = (R, t0, t1) => { let e = 0; for (let i = F(t0); i < F(t1); i++) e += R.L[i] * R.L[i]; return Math.sqrt(e / (F(t1) - F(t0))); };
  t.diagnostic(`${r.n} notes (${r.oh} open hats), ${r.hs.length} hits; the OH's tail 1.9–2.9 s: ${H.dB(rms(fast, 1.9, 2.9)).toFixed(1)} dB at 120 BPM vs ${H.dB(rms(slow, 1.9, 2.9)).toFixed(1)} dB at 30`);
  assert.ok(rms(fast, 1.9, 2.9) < 0.7 * rms(slow, 1.9, 2.9), 'the cut acts inside the window');
  assert.ok(r.oh >= 4, 'an open hat every second bar');
  assert.deepEqual(r.hn, r.hs, 'the same hits at the same frames, the same velocities');
  const d = H.compare(r.a, r.b);
  assert.equal(d.max, 0, H.describe(d));
});

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

/* ------------------------------------------------------------------ the acid pair (§3.8, side B) */
// the TB-303's default pattern synced (its swing s = 4 · (P − 50) as SYNC 303s writes it) and the 606's DEMO synced at P, from
// the same transport messages: a start at bar 3, a seek, a loop wrap; the 303's steps (seqFire: its absolute step syncStep)
// and the 606's step posts (M · 16 + s) at their span starts
function pair(P) {
  const sw = DC.swing303(P), bpm = 120, fpt = FPT(SR, bpm), seconds = 9;
  const events = [tp(F(0.2), { tick: 7680, seek: true, loop: false }), tp(F(3.3), { tick: 960 * 5 + 240, seek: true, loop: true, ls: 3840, le: 11520 })];
  const S303 = H.scope(B, SR), s3 = [];
  H.render(S303, {
    id: 'pair:303', seconds, events, po: { os: 4, hostOS: 4 },
    setup(p) {
      const m = B.models.MODELS.find(x => x.id === 'tb303'), v = Object.fromEntries(m.controls.map(c => [c.id, c.def]));
      p.msg({ t: 'patch', p: H.trackPatch(B, 'tb303', v, B.fxm.defaultFx2(), { sr: SR }) });
      p.msg({ t: 'seq', s: { pat: structuredClone(SEQ_DEF.pat), len: 16, bpm: SEQ_DEF.bpm, swing: sw / 100 * 0.5, root: 48, sync: true, run: false } });
      const f = p.i0.seqFire;
      p.i0.seqFire = function (step) { s3.push([p.spanF, this.sq.syncStep]); return f.call(this, step); };
    },
  });
  const s6 = [];
  render606(B, { id: 'pair:606', seq: payload(mem({ x: { swing: P } })), seconds, events, posts: s6 });
  return { s3, s6: s6.map(m => [m.F, m.M * 16 + m.s]), tol: 4 + (P === 50 ? 0 : 0.5 / (1 / fpt)) };
}
for (const P of [50, 62]) {
  test(`the acid pair at ${P} % (the 303 at ${DC.swing303(P)}): every 606 sixteenth lands on the 303's step of the same index — its 4-frame grid point or the next${P === 50 ? '' : ', half a tick more'}`, (t) => {
    const r = pair(P), by = new Map();
    for (const [f, k] of r.s3) { if (!by.has(k)) by.set(k, []); by.get(k).push(f); }
    const bad = [];
    let n = 0, worst = 0;
    for (const [f, k] of r.s6) {
      const L = by.get(k);
      if (!L) { bad.push(`606 step ${k} at ${f}: no 303 step`); continue; }
      const d = Math.min(...L.map(g => Math.abs(f - g)));
      n++; if (d > worst) worst = d;
      if (d > r.tol) bad.push(`step ${k}: ${d} frames apart`);
    }
    let back = 0;
    for (let i = 1; i < r.s6.length; i++) if (r.s6[i][1] < r.s6[i - 1][1]) back++;
    t.diagnostic(`${n} 606 sixteenths paired with the 303's (${r.s3.length} 303 steps), worst ${worst} frames (bound ${r.tol.toFixed(1)}), ${back} jumps back`);
    assert.ok(n > 60 && r.s6[0][1] === 32 && back === 2, 'a start at bar 3, a seek back, a loop wrap');
    assert.deepEqual(bad, []);
  });
}
