import './v8-guard.mjs';
// Stage WC lane K — the rig's sound gates with the real engine (docs/canvas/IMPL-WC.md §3.3, G2, G3):
//   G2 W2  a rig holding state S sounds exactly as a Serum holding S: patchFor deep-equal and a bit-identical 10 s render (keys, wheel,
//          bends, the sustain pedal, a song with transport) through the engine for the starter, Init and a factory preset;
//   G3     the key gate (ENV 1 at GATE): the voice's amplitude read directly — SerumVoice.chunk is wrapped in the worklet scope and logs
//          eV[0] / gAmp per control chunk (CH = 4 base frames) — at 48 kHz × OS 1 and 44.1 kHz × OS 2: from 0 at the note-on chunk to
//          ≥ 0.999 within 3.0 ms + 1 chunk, monotonically; after the note-off to ≤ 1e-5 and the voice freed within 3.0 ms + 2 chunks,
//          the voice count 0 within one more quantum; click-free on the output (max |x[n] − x[n−1]| over the edges ≤ 1.05 × (the steady
//          sine's own max step + peak / (0.003·fs))); a re-press 1 ms into the release restarts from the current level; a preset's
//          ENV 1 flags set then the Envelope pulled: the gate is the gate; a held key stays at 1 for 10 s; legato mono never re-gates;
//          glide leaves the gate alone; 8 simultaneous keys each gate; a steal keeps the level; the release from full level is linear.
//   The oscillator is the one-frame factory table 'factory:Sine' (the lane's pick: a pure sine, no frame position to pin) at 220 Hz
//   (MIDI 57), Oscillator 1 → Amplifier (rigInit), knob levels Serum's (Q3).
// Run alone: node --max-old-space-size=2048 --test tests/rig-sound.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import * as H from './golden-harness.mjs';
import * as R from '../rig-core.js?v=9';
import * as C from '../serum-core.js?v=9';
import { patchFor } from '../models.js?v=9';

const [, B] = await H.sides(); // (the v2 side: this tree)
const clone = x => JSON.parse(JSON.stringify(x));
const SINE = 'factory:Sine', NOTE = 57; // 220 Hz
// the rig under test: Init (Oscillator 1 → Amplifier, the gate) on a pure sine at the given oversampling
function sineRig(os, edit) {
  const s = R.rigInit();
  s.osc[0].wt = SINE; s.global.os = os;
  if (edit) edit(s);
  const S = C.normalizeSerum(s);
  assert.equal(S.osc[0].wt, SINE);
  return S;
}
const RATES = [[48000, 1], [44100, 2]];
const stepOf = sr => 4 / (sr * R.RIG.GATE_MS / 1000); // ENV 1's rise per control chunk: CH = 4·OS samples at sr·OS = 4 base frames, over GATE_MS
const chunksOf = (sr, os, ms) => Math.ceil(ms / 1000 * sr * os / (4 * os)); // control chunks in `ms`
const maxStep = (x, a, b) => { let m = 0; for (let i = Math.max(1, a); i < Math.min(b, x.length); i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m; };
const maxAbs = (x, a, b) => { let m = 0; for (let i = Math.max(0, a); i < Math.min(b, x.length); i++) m = Math.max(m, Math.abs(x[i])); return m; };

/* ---------------------------------------------------------------- the probe: a render with the voices' amplitude logged per chunk */
// Renders `frames` of a rig state with `events` ([frame, msg]; frames multiples of Q) in quanta of Q frames (the engine renders what it
// is given: Q 48 / 44 = 1 ms for the re-press case), SerumVoice.prototype.chunk wrapped to log every real voice's chunk (hidden warm-up
// voices and idle voices skipped): { i, f: the quantum's first frame, n: the chunk's ordinal in it, e: eV[0], g: gAmp, gate, note,
// active }. Returns { L, R, log, voices(f) → the engine's active real voices at the end, ev: the event markers }.
function probe({ sr, os, s, events, frames, Q = 128, id = 'gate' }) {
  const S = H.scope(B, sr), P = S.g.SerumDSP.SerumVoice.prototype, chunk0 = P.chunk, log = [], ev = [];
  let now = 0, cnt = new Map();
  P.chunk = function (o0, gc, fr) {
    const r = chunk0.call(this, o0, gc, fr);
    if (this.hid === 0 && (this.active || !r)) { const n = (cnt.get(this.i) || 0) + 1; cnt.set(this.i, n); log.push({ i: this.i, f: now, n, e: this.eV[0], g: this.gAmp, gate: !!this.gate, note: this.note, active: !!this.active, end: !r }); }
    return r;
  };
  try {
    S.g.currentFrame = 0; S.seed(id);
    const p = new S.Proc({ processorOptions: { os, hostOS: os } });
    S.seed(id);
    const patch = H.trackPatch(B, 'rig', { s }, C.defaultFx2(), { sr });
    H.postTables(B, p, patch.needs);
    p.msg({ t: 'patch', p: patch });
    const N = Math.ceil(frames / Q) * Q, L = new Float32Array(N), Rr = new Float32Array(N), oL = new Float32Array(Q), oR = new Float32Array(Q), out = [[oL, oR]];
    const E = events.slice().sort((a, b) => a[0] - b[0]);
    let e = 0;
    for (let o = 0; o < N; o += Q) {
      while (e < E.length && E[e][0] <= o) { ev.push({ f: o, m: E[e][1] }); p.msg(E[e++][1]); }
      now = o; cnt = new Map();
      p.process([], out);
      L.set(oL, o); Rr.set(oR, o);
      S.g.currentFrame += Q;
    }
    const I = p.insts[0];
    return { L, R: Rr, log, ev, voices: () => I.voices.filter(v => v.active && v.hid === 0 && v.note >= 0).length, proc: p };
  } finally { P.chunk = chunk0; }
}
// the chunks of the voice that took note `note` at the event at frame f0 (its entries from that frame on, in order)
function voiceFrom(log, note, f0) {
  const first = log.find(x => x.f >= f0 && x.note === note && x.gate && x.e < 0.5);
  assert.ok(first, 'a voice took note ' + note + ' at ' + f0);
  return log.filter(x => x.i === first.i && (x.f > first.f || (x.f === first.f && x.n >= first.n)));
}
const upTo = (seq, pred) => { const k = seq.findIndex(pred); return k < 0 ? Infinity : k; };
const monotone = (seq, up) => seq.every((x, k) => k === 0 || (up ? x.e >= seq[k - 1].e - 1e-12 : x.e <= seq[k - 1].e + 1e-12));

/* ================================================================ G2: a rig = its Serum (W2) */
test('G2 / W2: patchFor(rig) ≡ patchFor(serum) and the engine renders a rig track and a Serum track with the same state bit-identically — 10 s of keys, wheel, bends, sustain and a song with transport, for the starter, Init on the sine and a factory preset', () => {
  const states = [['starter', R.rigStarter().s], ['init', sineRig(2)], ['preset', C.normalizeSerum(clone(C.FACTORY_PRESETS[5].v.s))]];
  const fx = C.defaultFx2();
  for (const [name, s] of states) {
    assert.ok(isDeepStrictEqual(patchFor('rig', { s }, fx, { sr: 48000, bpm: 120 }), patchFor('serum', { s }, fx, { sr: 48000, bpm: 120 })), name + ': the same patch');
    const a = H.renderTrack(B, { id: 'W2:' + name, model: 'rig', vals: { s }, fx, os: 2, hostOS: 2, seconds: 10, events: H.script(48000) });
    const b = H.renderTrack(B, { id: 'W2:' + name, model: 'serum', vals: { s }, fx, os: 2, hostOS: 2, seconds: 10, events: H.script(48000) });
    assert.ok(H.finite(a) && H.peak(a) > 0.01, name + ': it plays');
    const d = H.compare(a, b);
    assert.equal(d.max, 0, name + ': ' + H.describe(d));
  }
});

/* ================================================================ G3: the key gate */
for (const [sr, os] of RATES) {
  const Q = 128, q = n => n * Q, A = chunksOf(sr, os, R.RIG.GATE_MS), rig = sineRig(os);
  assert.equal(A, os === 1 ? 36 : 34, 'the chunk count: 36 at 48 kHz, ≈ 33 at 44.1 kHz');

  test(`G3 @ ${sr / 1000} kHz × OS ${os}: note-on → ENV 1 rises from 0 to ≥ 0.999 within ${R.RIG.GATE_MS} ms + 1 chunk (${A + 1} chunks), monotonically, one step per chunk; a held key stays at exactly 1; note-off → falls to ≤ 1e-5 within ${R.RIG.GATE_MS} ms + 2 chunks, the voice freed, the voice count 0 one quantum later; click-free on the output; the sine is a sine`, () => {
    const on = q(100), off = q(400), end = q(440);
    const r = probe({ sr, os, s: rig, frames: end, events: [[on, { t: 'on', n: NOTE, v: 1 }], [off, { t: 'off', n: NOTE }]] });
    const V = voiceFrom(r.log, NOTE, on);
    assert.equal(V[0].f, on, 'the voice is fresh at the note-on quantum');
    assert.equal(V[0].n, 1, '… from its first chunk');
    const step = stepOf(sr);
    assert.ok(V[0].e > 0 && Math.abs(V[0].e - step) < 1e-9, 'the first chunk: one step up from 0, got ' + V[0].e);
    const k1 = upTo(V, x => x.e >= 0.999);
    assert.ok(k1 <= A, `≥ 0.999 after ${k1 + 1} chunks (bound ${A + 1})`);
    assert.ok(monotone(V.slice(0, k1 + 1), true), 'monotonic attack');
    for (let k = 1; k < k1; k++) assert.ok(Math.abs(V[k].e - V[k - 1].e - step) < 1e-9, 'linear: one step per chunk');
    const held = V.filter(x => x.f >= on + q(2) && x.f < off);
    assert.ok(held.length > 1000 && held.every(x => x.e === 1 && x.gate), 'sustain 1: exactly 1 while held (' + held.length + ' chunks)');
    // the release: linear from 1 to exactly 0, the voice freed (end) within A + 2 chunks of the note-off
    const Rl = V.filter(x => x.f >= off);
    assert.ok(Rl.length && !Rl[0].gate && Rl[0].e < 1, 'the first chunk after the key-up releases');
    const k2 = upTo(Rl, x => x.e <= 1e-5);
    assert.ok(k2 < A + 2, `≤ 1e-5 after ${k2 + 1} chunks (bound ${A + 2})`);
    assert.ok(monotone(Rl.slice(0, k2 + 1), false), 'monotonic release');
    for (let k = 1; k < k2 - 1; k++) assert.ok(Math.abs(Rl[k - 1].e - Rl[k].e - step) < 1e-9, 'linear release: one step per chunk');
    assert.equal(Rl[k2].e, 0, 'reaching exactly 0');
    const kEnd = upTo(Rl, x => x.end);
    assert.ok(kEnd <= A + 2, `the voice ends after ${kEnd + 1} chunks (bound ${A + 2}: eV ≤ 1e-5 and gAmp ≤ 1e-5)`);
    assert.ok(Rl.every((x, k) => k <= kEnd), 'nothing rendered after the end');
    const after = r.log.filter(x => x.f >= off + q(2) && x.i === V[0].i); // (the release spans 36 chunks = 144 frames: past the next quantum)
    assert.deepEqual(after.filter(x => x.active && !x.end), [], 'inactive within one quantum of the release\'s end');
    assert.equal(r.voices(), 0, 'the voice count reads 0');
    // the output: click-free at both edges — the ramp's slope bound: the steady sine's own max step + peak / (0.003·fs)
    const pk = maxAbs(r.L, on + q(20), off - q(20)), steady = maxStep(r.L, on + q(20), off - q(20)), bound = 1.05 * (steady + pk / (R.RIG.GATE_MS / 1000 * sr));
    assert.ok(pk > 0.1 && pk < 0.3, 'Serum\'s knob levels: peak ' + pk);
    assert.ok(maxStep(r.L, on - q(1), on + q(4)) <= bound, 'note-on edge: ' + maxStep(r.L, on - q(1), on + q(4)) + ' ≤ ' + bound);
    assert.ok(maxStep(r.L, off - q(1), off + q(4)) <= bound, 'note-off edge: ' + maxStep(r.L, off - q(1), off + q(4)) + ' ≤ ' + bound);
    // (what remains two quanta after the key-up is the engine's output stage's own tail, ≈ −44 dB and decaying slowly — the same for a
    // Serum, W2; the voice itself is gone, above)
    assert.ok(maxAbs(r.L, off + q(2), end) < 0.01 * pk, 'the voice is gone two quanta after the key-up (≤ −40 dB): ' + (20 * Math.log10(maxAbs(r.L, off + q(2), end) / pk)).toFixed(1) + ' dB');
    assert.ok(maxAbs(r.L, 0, on) === 0, 'silent before the key');
    // a sine (Blackman-Harris windowed DTFT: the harmonics ≤ −70 dBc)
    const N = 1 << 14, x = r.L.subarray(on + q(30), on + q(30) + N), w = n => { const a = 2 * Math.PI * n / (N - 1); return 0.35875 - 0.48829 * Math.cos(a) + 0.14128 * Math.cos(2 * a) - 0.01168 * Math.cos(3 * a); };
    const mag = f => { let re = 0, im = 0; for (let n = 0; n < N; n++) { const v = x[n] * w(n); re += v * Math.cos(2 * Math.PI * f * n / sr); im -= v * Math.sin(2 * Math.PI * f * n / sr); } return Math.hypot(re, im); };
    const f0 = mag(220), h = Math.max(mag(440), mag(660), mag(880), mag(1100));
    assert.ok(20 * Math.log10(h / f0) < -70, 'a pure sine: harmonics at ' + (20 * Math.log10(h / f0)).toFixed(1) + ' dBc');
  });

  test(`G3 @ ${sr / 1000} kHz × OS ${os}: a re-press 1 ms into the release restarts the attack from the current level (envRestart keeps it, stealRe 0) — no step above the bound on the voice or the output; a preset's ENV 1 flags (BPM, Voice Steal Retrigger) set, then the Envelope pulled (envFromAmp): the gate is the gate, the same bound holds`, () => {
    const Qm = os === 1 ? 48 : 44, q1 = n => n * Qm, step = stepOf(sr); // (1 ms quanta: the engine renders what it is given)
    const run = s => {
      const on = q1(300), off = q1(600), re = off + Qm, end = q1(800);
      const r = probe({ sr, os, s, Q: Qm, frames: end, events: [[on, { t: 'on', n: NOTE, v: 1 }], [off, { t: 'off', n: NOTE }], [re, { t: 'on', n: NOTE, v: 1 }], [q1(700), { t: 'off', n: NOTE }]], id: 'repress' });
      const V = voiceFrom(r.log, NOTE, on), rel = V.filter(x => x.f >= off && x.f < re), back = r.log.filter(x => x.f >= re && x.note === NOTE && x.gate);
      assert.ok(rel.length >= 10 && rel[rel.length - 1].e > 0.5 && rel[rel.length - 1].e < 0.75, '1 ms into the release: ' + rel[rel.length - 1].e);
      assert.ok(back.length > A, 'the key is down again');
      const last = rel[rel.length - 1].e, first = back[0].e;
      assert.ok(first >= last - 1e-9 && first <= last + step + 1e-9, `restarts from the current level: ${last} → ${first} (the same voice: ${back[0].i === V[0].i})`);
      assert.ok(monotone(back.slice(0, upTo(back, x => x.e >= 0.999) + 1), true), 'and rises');
      const pk = maxAbs(r.L, on + q1(50), off - q1(50)), steady = maxStep(r.L, on + q1(50), off - q1(50)), bound = 1.05 * (steady + pk / (R.RIG.GATE_MS / 1000 * sr));
      assert.ok(maxStep(r.L, off - Qm, re + 4 * Qm) <= bound, 'the re-press edge: ' + maxStep(r.L, off - Qm, re + 4 * Qm) + ' ≤ ' + bound);
      return r;
    };
    run(rig);
    // a preset-like ENV 1 (Serum's envelope with BPM and Voice Steal Retrigger on) pulled off LEVEL: the gate, flags off
    const pre = sineRig(os, s => { for (const id of Object.keys(R.GATE.p)) s.p[id] = C.DESTS[C.DEST_INDEX[id]].def; s.env[0] = { bpm: 1, legInv: 0, stealRe: 1 }; });
    assert.equal(R.isGate(pre), false);
    const pulled = R.apply(clone(pre), R.envFromAmp(pre).f);
    assert.equal(R.isGate(pulled), true);
    assert.deepEqual(pulled.env[0], { bpm: 0, legInv: 0, stealRe: 0 }, 'the flags reset (they travel with the Envelope to its free slot)');
    assert.deepEqual(pulled.env[1], { bpm: 1, legInv: 0, stealRe: 1 });
    assert.deepEqual(C.normalizeSerum(clone(pulled)), pulled);
    run(pulled);
  });
}

test('G3 @ 48 kHz × OS 1: a held key stays at the steady level for 10 s (sustain 1: no decay), the output level constant', () => {
  const sr = 48000, os = 1, Q = 128, on = 100 * Q, end = on + Math.ceil(10 * sr / Q) * Q + 10 * Q;
  const r = probe({ sr, os, s: sineRig(os), frames: end, events: [[on, { t: 'on', n: NOTE, v: 1 }]], id: 'held' });
  const V = voiceFrom(r.log, NOTE, on), held = V.filter(x => x.f >= on + 2 * Q);
  assert.ok(held.length >= 10 * sr / 4 - 64, held.length + ' chunks logged');
  assert.ok(held.every(x => x.e === 1 && x.g > 0 && x.gate), 'exactly 1 for 10 s');
  const a = maxAbs(r.L, on + sr, on + 2 * sr), b = maxAbs(r.L, on + 9 * sr, on + 10 * sr);
  assert.ok(Math.abs(a - b) < 1e-3 * a, 'the output level at 1 s and at 9 s: ' + a + ' / ' + b);
  assert.equal(r.voices(), 1);
});

test('G3 @ 48 kHz × OS 1: legato mono never re-gates (ENV 1 stays at 1 across the second key); glide leaves the gate alone (the same amplitude log with g.porta on); plain mono re-strikes from the current level', () => {
  const sr = 48000, os = 1, Q = 128, on1 = 100 * Q, on2 = 160 * Q, off2 = 220 * Q, off1 = 280 * Q, end = 320 * Q;
  const ev = [[on1, { t: 'on', n: NOTE, v: 1 }], [on2, { t: 'on', n: NOTE + 7, v: 1 }], [off2, { t: 'off', n: NOTE + 7 }], [off1, { t: 'off', n: NOTE }]];
  const seqOf = s => { const r = probe({ sr, os, s, frames: end, events: ev, id: 'mono' }); return { r, V: voiceFrom(r.log, NOTE, on1) }; };
  const leg = seqOf(sineRig(os, s => { s.voicing.mono = 1; s.voicing.legato = 1; }));
  const across = leg.V.filter(x => x.f >= on2 - Q && x.f < on2 + 4 * Q);
  assert.ok(across.length > 100 && across.every(x => x.e === 1 && x.gate), 'legato: no re-gate (eV 1 across the second key)');
  assert.equal(new Set(leg.r.log.filter(x => x.f >= on1).map(x => x.i)).size, 1, 'one voice (mono)');
  const back = leg.V.filter(x => x.f >= off2 && x.f < off1);
  assert.ok(back.every(x => x.e === 1 && x.gate), 'the first key still held after the second lifts');
  const glide = seqOf(sineRig(os, s => { s.voicing.mono = 1; s.voicing.legato = 1; s.p['g.porta'] = 0.5; }));
  assert.deepEqual(glide.V.map(x => [x.f, x.n, x.e]), leg.V.map(x => [x.f, x.n, x.e]), 'glide: the same amplitude, chunk for chunk');
  assert.ok(H.compare({ L: glide.r.L, R: glide.r.R }, { L: leg.r.L, R: leg.r.R }).max > 1e-3, 'but the pitch glides (a different output)');
  const mono = seqOf(sineRig(os, s => { s.voicing.mono = 1; }));
  const re = mono.V.filter(x => x.f >= on2 && x.f < on2 + 2 * Q);
  assert.ok(re.every(x => x.e >= 1 - 1e-9), 'plain mono: a re-strike from the current level (1) stays at 1 — no dip, no click');
});

test('G3 @ 48 kHz × OS 1: 8 simultaneous keys each gate (poly: eight voices, each from 0 to 1 in 36 chunks); a steal (poly 2, a third key) keeps the stolen voice\'s level (stealRe 0): no voice ever steps down while gated or up while released, by more than one gate step', () => {
  const sr = 48000, os = 1, Q = 128, on = 100 * Q, off = 300 * Q, end = 340 * Q, A = 36, step = stepOf(sr);
  const notes = [48, 50, 52, 55, 57, 59, 62, 64];
  const r = probe({ sr, os, s: sineRig(os), frames: end, events: notes.map(n => [on, { t: 'on', n, v: 1 }]).concat(notes.map(n => [off, { t: 'off', n }])), id: 'poly' });
  const vs = notes.map(n => voiceFrom(r.log, n, on));
  assert.equal(new Set(vs.map(V => V[0].i)).size, 8, 'eight voices');
  for (const V of vs) {
    assert.ok(V[0].e > 0 && Math.abs(V[0].e - step) < 1e-9 && upTo(V, x => x.e >= 0.999) <= A, 'each gates from 0 in ' + A + ' chunks');
    const Rl = V.filter(x => x.f >= off);
    assert.ok(upTo(Rl, x => x.end) <= A + 2, 'each ends after its release');
  }
  assert.equal(r.voices(), 0);
  // the steal: poly 2, keys 57 and 60 held, 64 strikes: the oldest voice is re-used from its current level
  const two = sineRig(os, s => { s.voicing.poly = 2; });
  const ev = [[on, { t: 'on', n: 57, v: 1 }], [on, { t: 'on', n: 60, v: 1 }], [on + 50 * Q, { t: 'on', n: 64, v: 1 }], [off, { t: 'off', n: 57 }], [off, { t: 'off', n: 60 }], [off, { t: 'off', n: 64 }]];
  const s2 = probe({ sr, os, s: two, frames: end, events: ev, id: 'steal' });
  const stolen = s2.log.filter(x => x.f >= on + 50 * Q && x.f < on + 52 * Q && x.note === 64);
  assert.ok(stolen.length && stolen.every(x => x.e >= 1 - 1e-9), 'the stolen voice keeps its level (1) under the new key');
  assert.equal(new Set(s2.log.filter(x => x.f >= on).map(x => x.i)).size, 2, 'two voices only');
  for (const L of [r.log, s2.log]) {
    const by = new Map();
    for (const x of L) { if (x.f < on) continue; const k = x.i; if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
    for (const seq of by.values()) for (let k = 1; k < seq.length; k++) {
      const d = seq[k].e - seq[k - 1].e;
      assert.ok(Math.abs(d) <= step + 1e-9, 'one gate step per chunk at most: ' + d);
      if (seq[k].gate && seq[k - 1].gate) assert.ok(d >= -1e-12, 'never down while gated');
      if (!seq[k].gate && !seq[k - 1].gate) assert.ok(d <= 1e-12, 'never up while released');
    }
  }
});

test('G3 the state side: isGate(rigBlank / rigInit) true, isGate(every factory preset) false, GATE round-trips through normalizeSerum, the gate\'s times by the law are 3.00 ms, the engine\'s chunk counts', () => {
  assert.deepEqual([R.isGate(R.rigBlank()), R.isGate(R.rigInit()), R.isGate(R.rigStarter().s)], [true, true, false]);
  for (const p of C.FACTORY_PRESETS) assert.equal(R.isGate(C.normalizeSerum(clone(p.v.s))), false, p.name);
  const s = R.rigBlank();
  assert.deepEqual(C.normalizeSerum(clone(s)), s);
  for (const id of ['e1.att', 'e1.rel']) assert.ok(Math.abs(C.lawValue(id, R.GATE.p[id]) * 1000 - R.RIG.GATE_MS) < 1e-12);
  assert.deepEqual([chunksOf(48000, 1, 3), chunksOf(48000, 2, 3), chunksOf(48000, 4, 3), chunksOf(44100, 2, 3)], [36, 36, 36, 34], '36 control chunks at 48 kHz at every OS, ≈ 33 at 44.1 kHz');
});
