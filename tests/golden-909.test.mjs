// Stage 7c golden refs (IMPL-7c §12.6, D2 / D5; lane E9). tests/ref-7c/ holds verbatim copies of dr-808.js, dr-seq.js and
// engine.js frozen by the lead at the acceptance commit, with MANIFEST.json { note, commit, files: { f: { sha256 } } } (ref-7a's
// format). Side A = the current tree with those three files replaced by the frozen copies (every other module current); side
// B = the current tree. Every case renders the TR-909 on both through the golden harness and must be bit-identical: max |A −
// B| === 0. From the freeze on, ref-7a guards the 808 (golden-drums), ref-7b the 606 (golden-606) and ref-7c the 909 (D2): a
// later stage's change to the shared files keeps all three. The 909's source material (the ROM909 block) lives in dr-808.js,
// so ref-7c freezes it with the circuits.
// BEFORE THE FREEZE (no tests/ref-7c/MANIFEST.json yet) side A is the current tree in a scope of its own: the test then checks
// B against itself — determinism, not the frozen sound — and says so in a diagnostic. The freeze (the lead, after the fix
// round and the user's listening, §2.4): GOLDEN_FREEZE_7C=1 node --max-old-space-size=2048 --test tests/golden-909.test.mjs
// writes tests/ref-7c/ from the working tree (the commit: git HEAD); then set PIN below to the manifest's hashes.
// Cases: every sound × { normal, per-voice accent, total accent, both } (v 100 / 110 / 119 / 127, a retrigger train of the
// four) at TOTAL ACCENT 5 and 10 on three panels (the defaults; every TUNE / DECAY / ATTACK / TONE / SNAPPY knob at 0, at 10 —
// the LEVELs and VOLUME at their defaults: at 0 they would test silence) and the levels at 10 with VOLUME 3; OH + CH together
// and a CH during a ringing OH; a ride during a ringing crash (the shared accent DAC) and an RS during a clap; the crash and
// the ride at TUNE 0 and 10 (the word clocks); the DEMO synced from tick 0, then from bar 2 with a loop, a stop and a restart;
// a track of ten patterns (TRACK PLAY, CYCLE) — every SHUFFLE level on 16ths, then 32nds at SHUFFLE 7, 8T and 16T; FLAM at its
// smallest (10 ms) and largest (38 ms) spacing, on the last step of a measure (its second hit in the next one); retrigger
// trains; OS 2; 44.1 kHz × 1; two sample slots (the kick's: a sample instead of the circuit; the crash's: a chip swap). Then
// D5 (side B only): the DEMO through the 909's sequencer vs drum-core toNotes(rollPlan, rollOpts) of it through the song path
// — bit-identical over 8 bars at 120 BPM / 48 kHz at SHUFFLE 1 (off), 3 and 7, with flams and every accent state, with the
// SYNC-off payload "→ Piano roll" leaves; without a payload (DEF_MAP: the ride's 51 plays nothing before a payload, §1.4 — its
// lane muted on both paths); at 97 BPM every hit (flams' included) on the same 4-frame grid point or the next.
// Run: node --max-old-space-size=2048 --test tests/golden-909.test.mjs
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as H from './golden-harness.mjs';
import * as DC from '../drum-core.js?v=9';
import { playbackEntry } from '../smpwork.js?v=9';
import { mulberry32, fnv1a32 } from '../wt.js?v=9';

const REF = new URL('./ref-7c/', import.meta.url), FILES = ['dr-808.js', 'dr-seq.js', 'engine.js'];
// the frozen hashes, pinned by the lead at the freeze (null until then: the manifest alone is checked)
const PIN = { 'dr-808.js': 'e95df2d5fbce84e9b2cd65fb47ccd6baaec705c8306ef4186a7bd6a5eb34f9fa', 'dr-seq.js': '40d28b7d6584ddc2fc5983d07b1a25c8c0a57020a4d9f5004b3a84fb124050d3', 'engine.js': '8035d9f71b63e99b891f620ddccce4e666c106f1e64ced9737e3d8dbf0db33c9' }; // (frozen 2026-10-21 at 31bb09a, the 7c acceptance commit)
const FREEZE = process.env.GOLDEN_FREEZE_7C === '1';
if (FREEZE) {
  mkdirSync(REF, { recursive: true });
  const files = {};
  for (const f of FILES) { const src = readFileSync(new URL(f, H.ROOT), 'utf8'); writeFileSync(new URL(f, REF), src); files[f] = { sha256: H.sha256(src) }; }
  let commit = '';
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' }).trim(); } catch { /* no git */ }
  writeFileSync(new URL('MANIFEST.json', REF), JSON.stringify({
    note: 'Frozen TR-909 sound (IMPL-7c §12.6, D2): verbatim copies of dr-808.js (its circuits and the ROM909 block), dr-seq.js and engine.js at the 7c acceptance commit. Never edit: tests/golden-909.test.mjs renders them (side A, every other module current) against the current files, bit for bit.',
    commit, files }, null, 2) + '\n');
}
const FROZEN = existsSync(new URL('MANIFEST.json', REF));

const [, B] = await H.sides();
// side A: B's modules and DSP list with the three frozen files (before the freeze: B's own sources, a scope of its own)
const frozen = f => (FROZEN ? readFileSync(new URL(f, REF), 'utf8') : null);
const A = Object.assign({}, B, {
  name: FROZEN ? 'ref-7c' : 'self', engine: frozen('engine.js') || B.engine,
  dsp: B.dsp.map(([f, c]) => [f, FILES.includes(f) ? frozen(f) || c : c]),
  entries: new Map(), user: new Map(), scopes: new Map(),
});
const SR = H.SR, FPT = (sr, bpm) => sr * 60 / (bpm * H.PPQ);
const M909 = B.models.MODELS.find(m => m.id === 'tr909');
const LEVELS = new Set(['bdl', 'sdl', 'ltl', 'mtl', 'htl', 'rsl', 'cpl', 'hhl', 'crl', 'rdl', 'vol']);
const SHAPE = M909.controls.filter(c => !LEVELS.has(c.id) && c.id !== 'ac').map(c => c.id); // TUNE / DECAY / ATTACK / TONE / SNAPPY
const vals = o => Object.assign(Object.fromEntries(M909.controls.map(c => [c.id, c.def])), o || {});
const shape = (x, o) => vals(Object.assign(Object.fromEntries(SHAPE.map(k => [k, x])), o));
const PRIM = Array.from(DC.primaries(DC.MAP909, 'tr909')); // by sound id (−1: ids 11–15, sounds the 909 lacks)
const PRIM9 = DC.SIDS909.map(s => PRIM[s]); // bd sd lt mt ht rs cp rd cr oh ch: 36 38 41 45 48 37 39 51 49 46 42
const VS = [100, 110, 119, 127];            // normal, per-voice accent, total accent, both (P-1's fixed velocities)

// the test's own sample fixture (a decaying tone and noise burst, 0.4 s, deterministic)
const SMP_ID = 'smp:7c7c7c7c7c7c7c7c';
const SMP = (() => {
  const n = Math.round(0.4 * SR), r = mulberry32(fnv1a32('golden-909')), L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.6 * Math.exp(-i / (0.07 * SR)) * Math.sin(2 * Math.PI * 160 * i / SR) + 0.25 * Math.exp(-i / (0.02 * SR)) * (2 * r() - 1);
  return playbackEntry(SMP_ID, { rate: SR, ch: 1, len: n, L, R: null, root: 60, loop: null }, null, 2);
})();

// a pattern's three rows of masks from rows by the 909's codes ('x' a hit, 'X' per-voice accented, 'f' flammed, 'F' both)
function rows9(o, n = 16) {
  const st = new Array(16).fill(0), ac = st.slice(), fm = st.slice();
  for (const [code, r] of Object.entries(o)) {
    const b = 1 << DC.LANES909[DC.CODES909.indexOf(code.toUpperCase())];
    for (let k = 0; k < n && k < r.length; k++) {
      const c = r[k];
      if (c === '.') continue;
      st[k] |= b;
      if (c === 'X' || c === 'F') ac[k] |= b & DC.AC909;
      if (c === 'f' || c === 'F') fm[k] |= b & DC.FL909;
    }
  }
  return { st, ac, fm };
}
// a 909 record: patterns { p: { rows, key } } over a new machine's (PATTERN PLAY on I-1-1, SYNC on), its ui / x / tk / smp
function mem({ pats = {}, ui = {}, x = {}, tk = null, smp = null } = {}) {
  let d = DC.normDrum(undefined, 'tr909');
  const keys = d.keys.slice(), st = d.st.slice(), ac = d.ac.slice(), fm = d.fm.slice();
  for (const [p, P] of Object.entries(pats)) {
    keys[p] = Object.assign({}, keys[p], P.key || {});
    const r = rows9(P.rows, keys[p].l1);
    st[p] = r.st; ac[p] = r.ac; fm[p] = r.fm;
  }
  d = Object.assign({}, d, { keys, st, ac, fm, ui: Object.assign({}, d.ui, ui), x: Object.assign({}, d.x, x) });
  if (tk) { const t = d.tk.slice(); t[0] = tk.slice(); d.tk = t; }
  if (smp) d.smp = smp;
  return DC.normDrum(d, 'tr909');
}
// the DEMO (I-1-1 / I-1-2 block-played; its own SHUFFLE 3) at SHUFFLE sh, the lanes `mute` muted
function demo(sh, mute = 0) {
  const d = DC.press(DC.initState('tr909'), DC.normDrum(undefined, 'tr909'), { k: 'demo' }).mem, keys = d.keys.slice();
  if (sh) for (const p of [0, 1]) keys[p] = Object.assign({}, keys[p], { sh });
  return DC.normDrum(Object.assign({}, d, { keys, x: Object.assign({}, d.x, { mute }) }), 'tr909');
}
const payload = (d, S) => DC.payload(d, Object.assign(DC.initState('tr909'), S || {}), (S && S.at) || 'now');
const seqMsg = (d, S) => ({ t: 'seq', s: payload(d, S) });
const EMPTY = payload(mem()); // (a stopped, synced machine: its map for the notes)

// the 909's hits as [spanF, sound, the state's velocity] — the notes' v127 as given; a sequencer trigger's (mask, acc) per lane
// as its state (AC bit, per-voice bit: VEL9), so both paths compare as the same list
const stateV = (m, a, l) => DC.VEL9[(DC.AC909 >> l) & 1 ? (m & 1) * 2 + ((a >> l) & 1) : (m & 1) * 3];
// renders the 909 on side X: the panel `v`, the payload, events [[frame, msg]] (the harness posts them before the quantum at
// or after their frame); hits: the machine's hit / trig calls; posts: the steps posted
function render909(X, { id, v = vals(), os = 4, sr = SR, events = [], seconds = 4, seq = EMPTY, smp = false, hits = null, posts = null }) {
  const S = H.scope(X, sr);
  return H.render(S, {
    id, seconds, events, po: { os, hostOS: os },
    setup(p) {
      if (smp) S.g.SxBase.storeAsset(SMP_ID, SMP);
      p.msg({ t: 'patch', p: H.trackPatch(X, 'tr909', v, X.fxm.defaultFx2(), { sr }) });
      if (seq) p.msg({ t: 'seq', s: structuredClone(seq) });
      if (posts) p.port.postMessage = m => { if (m && m.t === 'step') posts.push(m); };
      if (hits) {
        const dm = p.i0.dm, h = dm.hit, tr = dm.trig;
        dm.hit = function (s, v127) { hits.push([p.spanF, s, v127]); return h.call(this, s, v127); };
        dm.trig = function (m, a) { for (let l = 1; l < 12; l++) if (m & (1 << l)) hits.push([p.spanF, l - 1, stateV(m, a | 0, l)]); return tr.call(this, m, a); };
      }
    },
  });
}
const on = (n, v) => ({ t: 'on', n, v }), off = n => ({ t: 'off', n });
const F = (t, sr = SR) => Math.round(t * sr);
// every sound in turn: its four states 0.08 s apart (a retrigger train), the next sound 0.4 s later
const DT = 0.4, SWEEP_S = 11 * DT + 1.4;
const sweep = (sr = SR) => PRIM9.flatMap((n, k) => VS.map((v, j) => [F(k * DT + 0.08 * j, sr), on(n, v / 127)]).concat([[F(k * DT + 0.3, sr), off(n)]]));
const tp = (frame, o, sr = SR, bpm = 120) => [Math.max(0, frame - 1024), Object.assign({ t: 'transport', play: true, frame, fpt: FPT(sr, bpm) }, o)];
const P = n => PRIM9[n];                    // a sound's note

// the track: ten patterns (I-1-1 … I-1-10) as its measures in TRACK PLAY with CYCLE — SHUFFLE 1 … 7 on 16ths (FLAM 9 … 16:
// the spacing's ends at 1 and 7), then 32nds at SHUFFLE 7 (FLAM 16, clamped below its 60-tick gap), 8T and 16T; a flam on the
// kick's last step (its second hit in the next measure), on the snare and the high tom
const BASE = { ac: 'x.......x.......', bd: 'X...x...X...x..f', sd: '....x.......f...', hc: '....x...........', ch: 'xX.xxX.xxX.xxX.x',
  oh: '..x...x...x...x.', rd: 'x.x.x.x.x.x.x.x.', lt: '..............x.', mt: '.............X..', ht: '...........F....' };
const TRACK = Object.fromEntries([...Array.from({ length: 7 }, (_, k) => ({ key: { sh: k + 1, fl: [9, 10, 11, 12, 13, 15, 16][k] }, rows: k ? BASE : Object.assign({ cr: 'x...............' }, BASE) })),
  { key: { sc: 2, sh: 7, fl: 16 }, rows: BASE }, { key: { sc: 3, l1: 12 }, rows: BASE }, { key: { sc: 4, l1: 12, fl: 14 }, rows: BASE }].map((P, k) => [k, P]));
const trackMem = () => mem({ pats: TRACK, tk: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], ui: { mode: DC.M9_TP, trk: 0, cyc: 1 } });
const TRACK_S = 7 * 2 + 1 + 2 + 1 + 0.6;

const CASES = [
  ...[['defaults', {}], ['shape 0', { x: 0 }], ['shape 10', { x: 10 }], ['levels 10, VOLUME 3', { lv: true }]].flatMap(([name, o]) => [5, 10].map(ac => {
    const v = o.lv ? vals(Object.assign(Object.fromEntries([...LEVELS].map(k => [k, 10])), { vol: 3, ac })) : o.x !== undefined ? shape(o.x, { ac }) : vals({ ac });
    return { id: `sounds:${name}:ac${ac}`, v, events: sweep(), seconds: SWEEP_S };
  })),
  { id: 'hats: OH + CH together, a CH into a ringing OH', v: vals({ ohd: 9, chd: 6, ac: 8 }), seconds: 2.6,
    events: [[0, on(46, 0.8)], [0, on(42, 0.8)], [F(0.3), on(46, 1)], [F(0.42), on(42, 110 / 127)], [F(0.7), on(46, 119 / 127)], [F(0.95), on(42, 1)], [F(0.96), on(46, 1)],
      [F(1.3), on(46, 1)], [F(1.55), on(42, 100 / 127)]] },
  { id: 'the shared DACs: a ride into a ringing crash, an RS into a clap', v: vals({ ac: 10, cru: 2 }), seconds: 3,
    events: [[0, on(49, 100 / 127)], [F(0.25), on(51, 1)], [F(0.5), on(51, 100 / 127)], [F(1.2), on(39, 100 / 127)], [F(1.205), on(37, 1)], [F(1.6), on(39, 1)], [F(1.62), on(37, 100 / 127)]] },
  ...[0, 10].map(u => ({ id: `cymbals at TUNE ${u}`, v: vals({ cru: u, rdu: u }), seconds: 3.2, events: [[0, on(49, 1)], [F(1.6), on(51, 1)]] })),
  { id: 'pattern: the DEMO synced, bar 2 loop, stop, restart', seq: payload(demo(0)), seconds: 9,
    events: [tp(1024, { tick: 0, seek: true, loop: false }), tp(F(3.2), { tick: 3840, seek: true, loop: true, ls: 3840, le: 11520 }),
      [F(6.6), { t: 'transport', play: false }], tp(F(7.1), { tick: 0, seek: true, loop: false }), [F(8.0), on(38, 0.9)]].sort((a, b) => a[0] - b[0]) },
  { id: 'track: every SHUFFLE, 32nds, 8T, 16T; FLAM 10 … 38 ms, on the last step', seq: payload(trackMem()), seconds: TRACK_S, v: vals({ ac: 7 }),
    events: [tp(1024, { tick: 0, seek: true })] },
  { id: 'retrigger trains', v: vals({ ac: 7 }), seconds: 3.5, events: [36, 38, 41, 45, 48, 37, 39].flatMap((n, k) => Array.from({ length: 12 }, (_, j) => [F(0.45 * k + 0.035 * j), on(n, VS[j & 3] / 127)])) },
  { id: 'pattern: OS 2', os: 2, seq: payload(demo(5)), seconds: 5, events: [tp(1024, { tick: 0, seek: true })] },
  { id: 'pattern: 44.1 kHz × 1', sr: 44100, os: 1, seq: payload(demo(0)), seconds: 5, events: [tp(1024, { tick: 0, seek: true }, 44100)] },
  { id: 'samples: the kick (instead of the circuit), the crash (a chip swap)', smp: true, seconds: 3.5, v: vals({ bdd: 3, bdu: 7, cru: 7 }),
    seq: payload(mem({ smp: { bd: { id: SMP_ID, name: 'kick', on: true }, cr: { id: SMP_ID, name: 'crash', on: true } } })),
    events: [[F(0.1), on(36, 1)], [F(0.3), on(49, 1)], [F(0.31), on(36, 110 / 127)], [F(1.2), on(49, 100 / 127)], [F(1.25), on(42, 0.9)]] },
];

test('tests/ref-7c: the frozen files match their manifest (and the pinned hashes once set)' + (FROZEN ? '' : ' — NOT FROZEN YET: side A is the current tree (determinism only)'), (t) => {
  if (!FROZEN) { t.diagnostic('tests/ref-7c/MANIFEST.json missing: the lead freezes the refs at the acceptance commit (GOLDEN_FREEZE_7C=1)'); return; }
  const m = JSON.parse(readFileSync(new URL('MANIFEST.json', REF), 'utf8'));
  assert.deepEqual(Object.keys(m.files).sort(), [...FILES].sort());
  for (const f of FILES) assert.equal(H.sha256(readFileSync(new URL(f, REF), 'utf8')), m.files[f].sha256, 'tests/ref-7c/' + f + ' was edited');
  if (PIN) assert.deepEqual(Object.fromEntries(FILES.map(f => [f, m.files[f].sha256])), PIN, 'the manifest is the pinned freeze');
});

test(`D2: every sound and state, panel, hat, shared DAC, cymbal clock, pattern, track (shuffle, flam), train, OS 2, 44.1 kHz and sample case — ${FROZEN ? 'ref-7c vs current' : 'current vs current (not frozen yet)'}, bit-identical`, (t) => {
  if (!FROZEN) t.diagnostic('NOT FROZEN: side A is the current tree — these renders check determinism only');
  const bad = [];
  for (const c of CASES) {
    const r = [A, B].map(X => render909(X, Object.assign({}, c, { id: 'tr909:' + c.id })));
    if (!H.finite(r[1]) || !(H.peak(r[1]) > 0.01)) bad.push(`${c.id}: silent or not finite (${H.peak(r[1])})`);
    const d = H.compare(r[0], r[1]);
    if (d.max !== 0) bad.push(`${c.id}: ${H.describe(d, c.sr || SR)}`);
  }
  assert.deepEqual(bad, []);
});

test('the cases differ where they should (side B): the shuffle moves the steps, the flams sound, the four states differ, the ride lifts a ringing crash, the chip swap plays the sample', () => {
  const C = id => CASES.find(c => c.id === id), r = (c, o) => render909(B, Object.assign({}, c, { id: 'tr909:diff:' + c.id }, o));
  // the track's posts: SHUFFLE moves the even steps by 20 · (sh − 1) ticks (1250 frames a SHUFFLE step at 120 BPM / 48 kHz)
  const posts = [], hits = [];
  r(C('track: every SHUFFLE, 32nds, 8T, 16T; FLAM 10 … 38 ms, on the last step'), { posts, hits });
  const off = posts.filter(m => m.s === 1).map(m => [m.M, m.o]);
  assert.deepEqual(off.slice(0, 8), [[0, 240], [1, 260], [2, 280], [3, 300], [4, 320], [5, 340], [6, 360], [7, 180]], 'step 2\'s tick in each measure (16ths: 240 + 20 (sh − 1); 32nds: 120 + 60)');
  // a flam's second hit: its lanes at the flam's own frame — the kick's last-step flam lands in the next measure
  const byF = new Map(); for (const [f, s] of hits) { if (!byF.has(f)) byF.set(f, []); byF.get(f).push(s); }
  const pf = new Set(posts.map(m => m.F)), lone = [...byF.entries()].filter(([f]) => !pf.has(f));
  assert.ok(lone.length >= 20 && lone.every(([, s]) => s.every(x => x <= 4)), `flams: ${lone.length} hits off the step frames, every one a kick, snare or tom`);
  // the four states: four different hits of one sound (at TOTAL ACCENT 10: at 5 the total accent's T(u) = 11 equals the
  // per-voice L, one code)
  const st = VS.map(v => r({ id: 'state', v: vals({ ac: 10 }), events: [[0, on(38, v / 127)]], seconds: 0.5 }));
  for (let i = 1; i < 4; i++) assert.ok(H.compare(st[i], st[i - 1]).max > 1e-3, `state ${VS[i]} ≠ ${VS[i - 1]}`);
  // the shared DAC: a ride hit (v 127) lifts the ringing crash (v 100) — its tail louder than the crash without it, the ride
  // itself subtracted
  const cr = r({ id: 'cr', v: vals({ ac: 10, cru: 2, rdl: 0 }), events: [[0, on(49, 100 / 127)]], seconds: 1.5 });
  const both = r({ id: 'cr+rd', v: vals({ ac: 10, cru: 2, rdl: 0 }), events: [[0, on(49, 100 / 127)], [F(0.25), on(51, 1)]], seconds: 1.5 });
  const rms = (R, t0, t1) => { let e = 0; for (let i = F(t0); i < F(t1); i++) e += R.L[i] * R.L[i]; return Math.sqrt(e / (F(t1) - F(t0))); };
  assert.ok(rms(both, 0.3, 1.2) > 1.3 * rms(cr, 0.3, 1.2), 'the ride\'s level, written to the shared DAC, lifts the crash (its own LEVEL at 0)');
  const sm = C('samples: the kick (instead of the circuit), the crash (a chip swap)');
  assert.ok(H.compare(r(sm), r(sm, { seq: EMPTY })).max > 0.01, 'the slots change the render');
});

/* ------------------------------------------------------------------ D5: both ways are one sound (side B) */
// the DEMO at SHUFFLE sh, sync on, at bpm: the sequencer path (its session's tempo = the project's: the flams' ticks) vs
// toNotes(rollPlan(D, bpm), rollOpts) through the song path — with the SYNC-off payload → Piano roll leaves, or none
function both(bpm, sh, bars, { notesSeq = true, mute = 0, sr = SR, rec = null } = {}) {
  const d = rec || demo(sh, mute), seq = payload(d, { bpm }), T = bars * 4 * H.PPQ;
  const notes = DC.toNotes(DC.rollPlan(d, bpm), Object.assign({ t0: 0, t1: T + 4 * H.PPQ }, DC.rollOpts(d, { model: 'tr909', vals: vals() })));
  const song = { t: 'song', notes: notes.flatMap(x => [x.t, x.d, x.n, x.v]), cc: [] };
  const fpt = FPT(sr, bpm), F0 = 1024, seconds = (F0 + T * fpt) / sr + 0.25;
  const off = notesSeq ? payload(DC.normDrum(Object.assign({}, d, { x: Object.assign({}, d.x, { sync: false }) }), 'tr909'), { bpm }) : null;
  const hs = [], hn = [];
  const x = render909(B, { id: 'd5:seq', sr, seq: Object.assign({}, seq, { bpm }), seconds, hits: hs, events: [tp(F0, { tick: 0, seek: true }, sr, bpm)] });
  const y = render909(B, { id: 'd5:notes', sr, seq: off, seconds, hits: hn, events: [[0, song], tp(F0, { tick: 0, seek: true }, sr, bpm)] });
  const key = h => h.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const vel = notes.reduce((o, z) => { o[z.v] = (o[z.v] || 0) + 1; return o; }, {});
  return { a: x, b: y, hs: key(hs), hn: key(hn), n: notes.length, vel, fl: plFlams(seq.plan) };
}
const plFlams = pl => Array.from(pl.fl).reduce((k, m) => k + (m ? 1 : 0), 0);

for (const sh of [1, 3, 7]) {
  test(`D5: the DEMO through the sequencer = its notes through the song path (the SYNC-off payload), 8 bars at 120 BPM / 48 kHz, SHUFFLE ${sh}, flams and every accent state — bit-identical`, (t) => {
    const r = both(120, sh, 8);
    t.diagnostic(`${r.n} notes (velocities ${JSON.stringify(r.vel)}), ${r.fl} flammed steps a cycle, ${r.hs.length} sequencer hits, peak ${H.peak(r.a).toFixed(3)}`);
    assert.ok(r.n > 150 && r.fl >= 1 && H.peak(r.a) > 0.1, 'a full pattern with its flam');
    assert.deepEqual(VS.map(v => r.vel[v] > 0), [true, true, true, true], 'every accent state written');
    assert.deepEqual(r.hn, r.hs, 'the same hits at the same frames, the same states');
    const d = H.compare(r.a, r.b);
    assert.equal(d.max, 0, H.describe(d));
  });
}

// the track: every SHUFFLE on 16ths, 32nds at SHUFFLE 7 (its flam clamped), 8T, 16T; flams at 10 … 38 ms, the kick's on the
// last step (its second note in the next measure) — 9 bars of 4 beats = the track's 18 s
test('D5 through the track: every SHUFFLE, 32nds, triplets, flams at both ends of their spacing and across a measure — sequencer = notes, 120 BPM / 48 kHz, bit-identical', (t) => {
  const r = both(120, 0, 9, { rec: trackMem() });
  t.diagnostic(`${r.n} notes (velocities ${JSON.stringify(r.vel)}), ${r.fl} flammed steps, ${r.hs.length} sequencer hits`);
  assert.ok(r.n > 250 && r.fl >= 25, 'the whole track, its flams');
  assert.deepEqual(r.hn, r.hs, 'the same hits at the same frames, the same states');
  const d = H.compare(r.a, r.b);
  assert.equal(d.max, 0, H.describe(d));
});

test('D5 without a payload (DEF_MAP; the ride\'s 51 unmapped before a payload, §1.4: its lane muted on both paths), SHUFFLE 3, 8 bars at 120 BPM — bit-identical', (t) => {
  const r = both(120, 3, 8, { notesSeq: false, mute: 1 << DC.LANES909[DC.CODES909.indexOf('RD')] });
  t.diagnostic(`${r.n} notes, ${r.hs.length} hits`);
  assert.ok(r.n > 100 && r.hs.every(h => h[1] !== 7), 'no ride on either path');
  assert.deepEqual(r.hn, r.hs, 'the same hits at the same frames, the same states');
  const d = H.compare(r.a, r.b);
  assert.equal(d.max, 0, H.describe(d));
});

test('D5 at 97 BPM: every hit of the notes path (the flams\' second hits included) fires on the sequencer\'s 4-frame grid point or the next', (t) => {
  const r = both(97, 3, 4);
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
