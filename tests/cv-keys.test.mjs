import './v8-guard.mjs';
// cv-keys.js (lane K1; docs/canvas/IMPL-1i.md §4, §9): the pure bed maths — bedLayout for the 37 / 44 / 49 / 61-key beds
// (the lowest / highest white, whites × pitch = width, the black centres at their five offsets, the black dims), keyAt as a
// property test over every point of a bed and its band at several zooms (exactly one key in [lo, hi], gaps to the left
// key, a black key inside its widened hit, the hit width clamp(20 / s, black.w, 0.8 · pitch), the art at large s, outside
// → null, the band → the white key under x at v 1) and velOf (back 0.30, front 1, the front 7 %, black keys by their own
// length). Phase 2: the pointer engine on fake events (chords, two fingers on one key, glissando, off-bed, lost capture,
// release / destroy and stale events, right / Ctrl clicks, the Pencil's aftertouch per frame), the controllers (each row of
// §5.1: ranges, directions, relative drags, springs, the abort values, the pad's ramp on a fake clock, one finger each,
// keys), perfHost (fan-out, release-all, the echo, sel, bad notes) and the TB-303's seqNote / seqVel. Only numbers / strings /
// booleans go into assert (never a fake-DOM node).
// Run alone: node --max-old-space-size=2048 --test tests/cv-keys.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../cv-keys.js?v=9';
import { fresh, place, fire } from './wk-dom.mjs';

const near = (a, b, e, m) => assert.ok(Math.abs(a - b) <= e, `${m || ''} ${a} ≈ ${b} ± ${e}`);
// the beds of IMPL-1i §1.2 (one per key count) and the JP-8's 834 / 36 pitch
const BEDS = {
  b61: { id: 'perf:keys', kind: 'keys', n: 61, lo: 36, pitch: 23.5, len: 150 },
  b44: { id: 'perf:keys', kind: 'keys', n: 44, lo: 29, pitch: 23, len: 150 },
  b49: { id: 'perf:keys', kind: 'keys', n: 49, lo: 36, pitch: 23.5, len: 150 },
  b37: { id: 'perf:keys', kind: 'keys', n: 37, lo: 48, pitch: 22, len: 130 },
  jp8: { id: 'perf:keys', kind: 'keys', n: 61, lo: 36, pitch: 834 / 36, len: 176 },
};
const OFF = [0.9, 2.1, 3.857, 5.0, 6.143]; // C♯ D♯ F♯ G♯ A♯ in white pitches from the octave's C (§1.1)

test('constants (§4.1, §4.2): the velocity curve, the black hit, the band; the black offsets', () => {
  assert.deepEqual([K.KEY_VEL.lo, K.KEY_VEL.span, K.KEY_VEL.min, K.BLACK_PX, K.BLACK_CAP, K.FRONT_MM, K.KEY_GAP, K.BLACK_W, K.BLACK_L], [0.3, 0.75, 0.05, 20, 0.8, 8, 0.6, 0.583, 0.62]);
  const at = K.BLACK_AT.map((b, i) => (b == null ? null : [i, Math.round(b * 1000) / 1000]));
  assert.deepEqual(at.filter(Boolean), [[1, 0.9], [3, 2.1], [6, 3.857], [8, 5], [10, 6.143]]);
  assert.deepEqual([K.noteName(36), K.noteName(96), K.noteName(29), K.noteName(60), K.noteName(61)], ['C2', 'C7', 'F1', 'C4', 'C#4']);
  assert.deepEqual([36, 37, 41, 42, 84, 96, 127].map(K.isWhite), [true, false, true, false, true, true, true]);
  assert.deepEqual([K.whitesIn(36, 96), K.whitesIn(29, 72), K.whitesIn(36, 84), K.whitesIn(48, 84)], [36, 26, 29, 22]);
});

test('bedLayout: 37 / 44 / 49 / 61 keys — the range, whites × pitch = width, every white key at i · pitch (pitch − 0.6 wide), the black keys centred at their five offsets (± 0.01 mm), 0.583 · pitch × 0.62 · len', () => {
  const want = { b61: [36, 96, 36, 846], b44: [29, 72, 26, 598], b49: [36, 84, 29, 681.5], b37: [48, 84, 22, 484], jp8: [36, 96, 36, 834] };
  for (const [name, c] of Object.entries(BEDS)) {
    const B = K.bedLayout(c);
    assert.deepEqual([B.lo, B.hi, B.whites, B.w], want[name], name);
    assert.equal(B.w, B.whites * c.pitch, name + ': whites × pitch');
    assert.deepEqual([B.n, B.keys.length, B.h, B.front], [c.n, c.n, c.len, 8], name);
    assert.deepEqual(B.keys.map(k => k.note), Array.from({ length: c.n }, (_, i) => c.lo + i), name + ': keys in note order');
    const wk = B.keys.filter(k => !k.black), bk = B.keys.filter(k => k.black);
    assert.deepEqual([wk[0].note, wk.at(-1).note, wk.length, wk.length + bk.length], [B.lo, B.hi, B.whites, c.n], name + ': lowest / highest white');
    assert.deepEqual(B.wn, wk.map(k => k.note));
    wk.forEach((k, i) => { near(k.x, i * c.pitch, 1e-9, name + ' white x'); near(k.w, c.pitch - 0.6, 1e-9); assert.deepEqual([k.y, k.h], [0, c.len]); });
    for (const k of bk) {
      const oct = Math.floor(k.note / 12), cAt = (7 * oct - (7 * Math.floor(B.lo / 12) + [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][B.lo % 12])) * c.pitch; // the octave's C (mm)
      const off = OFF[[1, 3, 6, 8, 10].indexOf(k.note % 12)];
      near(k.x + k.w / 2, cAt + off * c.pitch, 0.01 * c.pitch / 23.5 + 0.005, `${name} black ${k.note}`);
      near(k.w, 0.583 * c.pitch, 1e-9); near(k.h, 0.62 * c.len, 1e-9);
      assert.equal(k.y, 0);
      assert.ok(k.x > 0 && k.x + k.w < B.w, name + ': black keys inside the bed');
    }
  }
  // the JP-8's division: 36 × (834 / 36) is exactly 834 (36 × 23.17 would overrun its area)
  assert.equal(K.bedLayout(BEDS.jp8).w, 834);
  // black overrides; the band: the argument, else c.front, else 8, within 0…8
  const B = K.bedLayout(Object.assign({}, BEDS.b61, { black: { w: 13, len: 95 }, front: 3 }));
  assert.deepEqual([B.bw, B.bl, B.front, B.keys[1].w, B.keys[1].h], [13, 95, 3, 13, 95]);
  assert.deepEqual([K.bedLayout(BEDS.b61, 5).front, K.bedLayout(Object.assign({}, BEDS.b61, { front: 12 })).front, K.bedLayout(BEDS.b61, -1).front, K.bedLayout(BEDS.b61, 0).front], [5, 8, 0, 0]);
});

test('velOf (§4.2): back of a key 0.30, the front edge 1, full over the front 7 % and in the band, linear between; a black key by its own length', () => {
  const B = K.bedLayout(BEDS.b61), L = 150, BL = 0.62 * 150;
  near(K.velOf(B, 36, 0), 0.3, 1e-12, 'back');
  near(K.velOf(B, 36, L), 1, 1e-12, 'front');
  near(K.velOf(B, 36, L / 2), 0.675, 1e-12, 'middle');
  near(K.velOf(B, 36, L * 0.7 / 0.75), 1, 1e-12, 'the front 7 %: full');
  assert.ok(K.velOf(B, 36, L * 0.92) < 1, 'just behind the 7 %: below full');
  near(K.velOf(B, 36, L + 3), 1, 0, 'the band');
  near(K.velOf(B, 37, BL), 1, 1e-12, 'a black key: its front edge');
  near(K.velOf(B, 37, BL / 2), 0.675, 1e-12, 'a black key: by its own length');
  near(K.velOf(B, 36, BL / 2), 0.3 + 0.75 * BL / 2 / L, 1e-12, 'a white key at the same depth: by its length');
  near(K.velOf(B, 36, -5), 0.3, 1e-12); near(K.velOf(B, 36, NaN), 0.3, 1e-12);
  // MIDI 38…127 (round(v · 127))
  assert.deepEqual([Math.round(K.velOf(B, 36, 0) * 127), Math.round(K.velOf(B, 36, L) * 127)], [38, 127]);
});

test('keyAt property test (§4.1, §9): every point of 37 / 44 / 49 / 61-key beds and their bands at s 0.5 / 1.06 / 1.36 / 2 / 3.2 px/mm — exactly one key in [lo, hi]; a black key wins inside clamp(20 / s, black.w, 0.8 · pitch); else the white key whose span holds x (gaps to the left key); the band → that white key at v 1; outside → null', () => {
  const S = [0.5, 1.06, 1.36, 2, 3.2];
  let pts = 0, bad = 0, first = '';
  const miss = (m) => { bad++; if (!first) first = m; };
  for (const [name, c] of Object.entries(BEDS)) {
    for (const s of S) {
      const B = K.bedLayout(c), hw = Math.min(Math.max(20 / s, B.bw), 0.8 * c.pitch) / 2, blacks = B.keys.filter(k => k.black);
      if (s >= 2) assert.equal(hw, B.bw / 2, `${name} s ${s}: the hit equals the art (20 / s ≤ black.w)`);
      const xs = [], ys = [];
      for (let x = -1.3; x < B.w + 1.3; x += 0.47) xs.push(x);
      for (let i = 0; i < B.whites; i++) xs.push(i * c.pitch, i * c.pitch + c.pitch - 0.6, i * c.pitch + c.pitch - 0.3, (i + 1) * c.pitch - 1e-9); // the gaps and the edges
      for (const k of blacks) { const cx = k.x + k.w / 2; xs.push(cx - hw + 1e-7, cx + hw - 1e-7, cx - hw - 1e-7, cx + hw + 1e-7, k.x, k.x + k.w); }
      for (let y = -1.1; y < B.h + B.front + 1.1; y += 2.3) ys.push(y);
      ys.push(0, B.bl, B.bl + 1e-9, B.h, B.h + 1e-9, B.h + B.front, B.h + B.front + 1e-9);
      for (const x of xs) for (const y of ys) {
        pts++;
        const r = K.keyAt(B, x, y, s), out = !(x >= 0 && x < B.w && y >= 0 && y <= B.h + B.front);
        if (out) { if (r !== null) miss(`${name} s ${s} (${x}, ${y}): outside → ${JSON.stringify(r)}`); continue; }
        if (!r || !Number.isInteger(r.note) || r.note < B.lo || r.note > B.hi) { miss(`${name} s ${s} (${x}, ${y}): ${JSON.stringify(r)} not one key in [lo, hi]`); continue; }
        if (!(r.v >= 0.3 - 1e-12 && r.v <= 1)) miss(`${name} (${x}, ${y}): v ${r.v}`);
        const bk = y <= B.bl ? blacks.filter(k => Math.abs(x - (k.x + k.w / 2)) <= hw) : [];
        if (bk.length > 1) miss(`${name} s ${s}: two black hits overlap at x ${x}`);
        if (bk.length) { if (r.note !== bk[0].note) miss(`${name} s ${s} (${x}, ${y}): black ${bk[0].note} expected, got ${r.note}`); continue; }
        const i = Math.min(B.whites - 1, Math.floor(x / c.pitch)), wn = B.wn[i];
        if (r.note !== wn) miss(`${name} s ${s} (${x}, ${y}): white ${wn} (the span holding x) expected, got ${r.note}`);
        if (y > B.h && r.v !== 1) miss(`${name} (${x}, ${y}): the band plays at v 1, got ${r.v}`);
      }
    }
  }
  assert.equal(first, '', 'first mismatch');
  assert.equal(bad, 0);
  assert.ok(pts > 100000, 'points checked: ' + pts);
});

test('keyAt: the black hit width measured on the bed (an F♯ at fit zoom and at k 1), the gap to the left key, the band, a bed without a band', () => {
  const B = K.bedLayout(BEDS.b61), fs = B.keys.find(k => k.note === 42), cx = fs.x + fs.w / 2, y = 40;
  const width = s => { let a = cx, b = cx; while (K.keyAt(B, a - 0.01, y, s).note === 42) a -= 0.01; while (K.keyAt(B, b + 0.01, y, s).note === 42) b += 0.01; return b - a; };
  near(width(1.36), 20 / 1.36, 0.03, 'fit zoom k 0.68 (a Prophet-5 on the iPad): 20 px of hit'); // 14.7 mm > 13.7 art
  near(width(1.06), 0.8 * 23.5, 0.03, 'k 0.53 (a CS-80): 20 px would be 18.9 mm — capped at 0.8 · pitch');
  near(width(0.5), 0.8 * 23.5, 0.03, 'capped at 0.8 · pitch');
  near(width(3.2), 0.583 * 23.5, 0.03, 'k 1.6: the art');
  // between F♯ and G♯ at the cap: ≥ 0.34 pitch of white (G) left
  const gs = B.keys.find(k => k.note === 44), gap = (gs.x + gs.w / 2 - 0.4 * 23.5) - (cx + 0.4 * 23.5);
  assert.ok(gap >= 0.34 * 23.5 - 1e-9, 'white between F♯ and G♯: ' + gap);
  assert.equal(K.keyAt(B, 47 - 0.3, 140, 2).note, 38, 'the 0.6 mm gap after D plays D');
  assert.deepEqual(K.keyAt(B, 30, 154, 2), { note: 38, v: 1 }, 'the band: the white key under x, v 1');
  assert.equal(K.keyAt(B, 30, 158.01, 2), null, 'past the band');
  const B0 = K.bedLayout(BEDS.b61, 0);
  assert.deepEqual([K.keyAt(B0, 30, 150, 2).note, K.keyAt(B0, 30, 150.01, 2)], [38, null], 'no band: the front edge is the last row');
  assert.equal(K.keyAt(B, 846, 10, 2), null, 'x = w is outside');
  assert.equal(K.keyAt(B, NaN, 10, 2), null);
  assert.equal(K.keyAt(B, 845.99, 10, 2).note, 96, 'the last white key to its right edge');
});

/* ---------------------------------------------------------------- phase 2: the TB-303's keys */
test('seqNote / seqVel (§6.4): every cell 0–12 × octave −1 / 0 / 1 × accent = seqToRoll\'s 48 + n + 12 · o and seqFire\'s 1 / 0.62', () => {
  assert.equal(K.SEQ_ROOT, 48);
  let bad = 0;
  for (let n = 0; n <= 12; n++) for (const o of [-1, 0, 1]) for (const a of [0, 1]) {
    const s = { n, o, a, s: 0, g: 1 };
    if (K.seqNote(s) !== 48 + s.n + 12 * s.o || K.seqVel(s) !== (a ? 1 : 0.62)) bad++;
  }
  assert.equal(bad, 0);
  assert.deepEqual([K.seqNote({ n: 0, o: -1 }), K.seqNote({ n: 12, o: 1 }), Number.isInteger(K.seqNote({ n: 3 }))], [36, 72, true], 'a step without an octave: 0 (never NaN)');
});

/* ---------------------------------------------------------------- phase 2: the bed's pointer engine */
// a 61-key bed at s = 2 px / mm, its element at (0, 0); a manual frame queue; on / off / at / shade logs
function rig(o = {}) {
  const doc = fresh(), el = doc.createElement('div'), B = K.bedLayout(BEDS.b61), s = o.s || 2, frames = [];
  doc.body.append(el);
  place(el, 0, 0, B.w * s, (B.h + B.front) * s);
  const log = [], sh = new Map();
  const E = K.bed(el, B, { on: (n, v) => log.push(['on', n, Math.round(v * 1000) / 1000]), off: n => log.push(['off', n]), at: o.at ? v => log.push(['at', Math.round(v * 1000) / 1000]) : null,
    shade: (n, on) => sh.set(n, on), raf: f => frames.push(f) });
  const flush = () => { for (const f of frames.splice(0)) f(); };
  const X = n => { const k = B.keys[n - B.lo]; return (k.x + k.w / 2) * s; }; // a key's centre, screen px
  const ev = (type, id, x, ymm, more) => fire(el, type, Object.assign({ pointerId: id, pointerType: 'touch', clientX: x, clientY: ymm * s, button: 0, buttons: type === 'pointerup' ? 0 : 1, timeStamp: 5 }, more || {}));
  const lit = () => [...sh].filter(([, on]) => on).map(([n]) => n).sort((a, b) => a - b);
  const cap = () => el._cap;
  return { el, B, E, log, sh, lit, flush, frames, X, ev, s, cap };
}

test('bed engine: a chord (one note per pointer, its velocity by depth), two fingers on one key = one on / one off, the shades follow', () => {
  const R = rig();
  R.ev('pointerdown', 1, R.X(60), 140); R.ev('pointerdown', 2, R.X(64), 75); R.ev('pointerdown', 3, R.X(67), 0);
  assert.deepEqual(R.log, [['on', 60, 1], ['on', 64, 0.675], ['on', 67, 0.3]], 'C E G: front loud, middle, back soft');
  assert.deepEqual([R.lit(), R.cap()], [[60, 64, 67], 3], 'shades; captured');
  R.ev('pointerdown', 4, R.X(60), 100);
  assert.equal(R.log.length, 3, 'a second finger on C: no second note');
  R.ev('pointerup', 1, R.X(60), 140);
  assert.equal(R.log.length, 3, 'the first finger lifts: C still held by the other');
  R.ev('pointerup', 4, R.X(60), 100);
  assert.deepEqual(R.log.at(-1), ['off', 60], 'the last finger lifts: off');
  assert.deepEqual(R.lit(), [64, 67]);
  assert.deepEqual(R.E.held().sort(), [64, 67]);
});

test('bed engine: glissando (the old note off, the new on at the entry velocity), off the bed the note stays, within a key nothing, lost capture ends it', () => {
  const R = rig();
  R.ev('pointerdown', 1, R.X(60), 50);
  R.ev('pointermove', 1, R.X(60) + 5, 60);
  assert.equal(R.log.length, 1, 'within the key: nothing');
  R.ev('pointermove', 1, R.X(62), 150);
  assert.deepEqual(R.log.slice(1), [['off', 60], ['on', 62, 1]], 'onto D at its front edge: D at 1');
  R.ev('pointermove', 1, -40, 50); R.ev('pointermove', 1, R.X(62), 400);
  assert.equal(R.log.length, 3, 'off the bed (left, below the band): D keeps sounding');
  R.ev('pointermove', 1, R.X(61), 30);
  assert.deepEqual(R.log.slice(3), [['off', 62], ['on', 61, Math.round(K.velOf(R.B, 61, 30) * 1000) / 1000]], 'onto C♯: its own depth');
  R.ev('lostpointercapture', 1, 0, 0);
  assert.deepEqual([R.log.at(-1), R.lit()], [['off', 61], []]);
});

test('bed engine: release() posts each off once and clears the shades (the host\'s too); a stale event after release() or destroy() posts nothing', () => {
  const R = rig();
  R.ev('pointerdown', 1, R.X(60), 50); R.ev('pointerdown', 2, R.X(60), 60); R.ev('pointerdown', 3, R.X(72), 60);
  R.E.lit(48, true);
  assert.deepEqual(R.lit(), [48, 60, 72]);
  R.E.release();
  assert.deepEqual(R.log.filter(x => x[0] === 'off').map(x => x[1]).sort(), [60, 72], 'one off per sounding note');
  assert.deepEqual(R.lit(), [], 'shades cleared (the host\'s lit 48 too)');
  const n = R.log.length;
  R.ev('pointerup', 1, R.X(60), 50); R.ev('pointermove', 3, R.X(74), 60); R.ev('lostpointercapture', 2, 0, 0);
  assert.equal(R.log.length, n, 'stale events: nothing');
  R.ev('pointerdown', 5, R.X(65), 60);
  R.E.destroy();
  const m = R.log.length;
  R.ev('pointerup', 5, R.X(65), 60); R.ev('pointerdown', 6, R.X(65), 60);
  assert.deepEqual([R.log.at(-1), R.log.length], [['off', 65], m], 'destroy released F; then deaf');
  R.E.lit(60, true);
  assert.deepEqual(R.lit(), [], 'a dead bed lights nothing');
});

test('bed engine: the mouse — button 0 without Ctrl only (a right click and a Ctrl-click play nothing), a drag is a glissando, a move without a button lifts; no context menu', () => {
  const R = rig();
  R.ev('pointerdown', 1, R.X(60), 50, { pointerType: 'mouse', button: 2, buttons: 2 });
  R.ev('pointerdown', 1, R.X(60), 50, { pointerType: 'mouse', ctrlKey: true });
  assert.equal(R.log.length, 0);
  R.ev('pointerdown', 1, R.X(60), 50, { pointerType: 'mouse' });
  R.ev('pointermove', 1, R.X(62), 50, { pointerType: 'mouse' });
  assert.deepEqual(R.log.map(x => x.slice(0, 2)), [['on', 60], ['off', 60], ['on', 62]]);
  R.ev('pointermove', 1, R.X(64), 50, { pointerType: 'mouse', buttons: 0 });
  assert.deepEqual(R.log.at(-1), ['off', 62], 'the button went up unseen: lifted');
  const e = fire(R.el, 'contextmenu');
  assert.equal(e.defaultPrevented, true);
  assert.equal(R.el.listenerCount('wheel'), 0, 'the mouse wheel is the camera\'s');
});

test('bed engine: the Pencil — with `at` its pressure is aftertouch ≤ once a frame and 0 at the last pen lift; without `at` none; a finger never', () => {
  const R = rig({ at: true });
  R.ev('pointerdown', 1, R.X(60), 50, { pointerType: 'pen', pressure: 0.15 });
  R.ev('pointermove', 1, R.X(60), 50, { pointerType: 'pen', pressure: 0.575 });
  R.ev('pointermove', 1, R.X(60), 50, { pointerType: 'pen', pressure: 1 });
  assert.equal(R.log.filter(x => x[0] === 'at').length, 0, 'nothing until the frame');
  R.flush();
  assert.deepEqual(R.log.filter(x => x[0] === 'at'), [['at', 1]], 'one per frame: the last');
  R.ev('pointermove', 1, R.X(60), 50, { pointerType: 'pen', pressure: 0.575 }); R.flush();
  assert.deepEqual(R.log.filter(x => x[0] === 'at').at(-1), ['at', 0.5], '(0.575 − 0.15) / 0.85');
  R.ev('pointermove', 1, R.X(60), 50, { pointerType: 'pen', buttons: 0, pressure: 0 });
  assert.deepEqual(R.log.slice(-2), [['off', 60], ['at', 0]], 'a hover move after an unseen lift: off, then 0');
  R.flush();
  assert.deepEqual(R.log.at(-1), ['at', 0], 'no late frame value after the lift');
  R.ev('pointerdown', 2, R.X(62), 50, { pointerType: 'touch', pressure: 0.9 }); R.ev('pointermove', 2, R.X(62), 60, { pointerType: 'touch', pressure: 1 }); R.flush(); R.ev('pointerup', 2, R.X(62), 60);
  assert.equal(R.log.filter(x => x[0] === 'at').length, 3, 'a finger sends none');
  const N = rig({ at: false });
  N.ev('pointerdown', 1, N.X(60), 50, { pointerType: 'pen', pressure: 1 }); N.flush(); N.ev('pointerup', 1, N.X(60), 50, { pointerType: 'pen' });
  assert.equal(N.log.filter(x => x[0] === 'at').length, 0, 'a bed without at: none');
});

/* ---------------------------------------------------------------- phase 2: the controllers */
// a fake api.perf (value / view / bend / mod), a manual frame queue and clock; the widget at s = 2 px / mm
function ctlRig(c, o = {}) {
  const doc = fresh(), el = doc.createElement('div'), frames = [], posts = [], views = { bend: new Set(), wheel: new Set() }, live = { bend: o.bend || 0, wheel: o.wheel || 0 };
  doc.body.append(el);
  place(el, 100, 100, c.w * 2, c.h * 2);
  const clock = { t: 0 };
  const perf = { value: k => live[k], view: (k, f) => { views[k].add(f); return () => views[k].delete(f); },
    bend: v => { posts.push(['bend', +v.toFixed(4)]); live.bend = v; }, mod: v => { posts.push(['wheel', +v.toFixed(4)]); live.wheel = v; } };
  const shown = [];
  const C = K.controller(el, c, { perf, show: (v, t) => shown.push([+v.toFixed(4), t == null ? null : +t.toFixed(3)]), pressed: on => shown.push(['pressed', on]), raf: f => frames.push(f), now: () => clock.t });
  const flush = () => { for (const f of frames.splice(0)) f(); };
  const ev = (type, x, y, more) => fire(el, type, Object.assign({ pointerId: 1, pointerType: 'touch', clientX: 100 + x * 2, clientY: 100 + y * 2, button: 0, buttons: type === 'pointerup' ? 0 : 1 }, more || {}));
  return { el, C, posts, shown, flush, ev, clock, views, live };
}
const WH = (id, more) => Object.assign({ id, kind: 'wheel', x: 0, y: 0, w: 20, h: 60, orient: 'v' }, more || {});

test('controllers §5.1: a pitch wheel — away from the player raises, Δv = 2Δ / h, relative to the press, ≤ one post a frame, springs to 0 at once', () => {
  const R = ctlRig(WH('perf:bend'));
  R.ev('pointerdown', 10, 40);
  assert.equal(R.posts.length, 0, 'a press: no jump');
  R.ev('pointermove', 10, 34); R.ev('pointermove', 10, 25);
  assert.equal(R.posts.length, 0, 'nothing until the frame');
  R.flush();
  assert.deepEqual(R.posts, [['bend', 0.5]], '15 mm up of 60: +0.5 (one post: the last)');
  R.ev('pointermove', 10, -30); R.flush();
  assert.deepEqual(R.posts.at(-1), ['bend', 1], 'clamped at +1');
  R.ev('pointermove', 10, 100); R.flush();
  assert.deepEqual(R.posts.at(-1), ['bend', -1], 'down: clamped at −1');
  R.ev('pointerup', 10, 100);
  assert.deepEqual(R.posts.at(-1), ['bend', 0], 'the release: 0 at once');
  R.flush();
  assert.deepEqual(R.posts.at(-1), ['bend', 0], 'no late frame post');
});

test('controllers §5.1: a mod wheel — Δv = Δ / h from the value at the press, stays at the release; the two-finger abort puts back the value at the press', () => {
  const R = ctlRig(WH('perf:mod'), { wheel: 0.4 });
  R.ev('pointerdown', 10, 40); R.ev('pointermove', 10, 28); R.flush();
  assert.deepEqual(R.posts, [['wheel', 0.6]], '0.4 + 12 / 60');
  R.ev('pointerup', 10, 28);
  assert.deepEqual(R.posts.at(-1), ['wheel', 0.6], 'stays (its last value posted at once)');
  R.ev('pointerdown', 10, 40); R.ev('pointermove', 10, 10); R.flush();
  assert.deepEqual(R.posts.at(-1), ['wheel', 1]);
  fire(R.el, 'pointercancel', { pointerId: 1, gesture: 'two-finger' });
  assert.deepEqual(R.posts.at(-1), ['wheel', 0.6], 'two fingers: the value at the press');
  const B = ctlRig(WH('perf:bend'));
  B.ev('pointerdown', 10, 40); B.ev('pointermove', 10, 30); B.flush();
  fire(B.el, 'pointercancel', { pointerId: 1, gesture: 'two-finger' });
  assert.deepEqual(B.posts.at(-1), ['bend', 0], 'a bend aborts to 0');
  const H = ctlRig(WH('perf:mod', { orient: 'h', w: 60, h: 20 }));
  H.ev('pointerdown', 10, 10); H.ev('pointermove', 25, 10); H.flush();
  assert.deepEqual(H.posts, [['wheel', 0.25]], 'orient h: right raises, Δ / w');
});

test('controllers §5.1: levers — a bender left–right (+x), the OB-Xa pitch lever away from the player (−y), its mod lever toward the player (+y) springing to 0', () => {
  const X = ctlRig({ id: 'perf:bend', kind: 'lever', x: 0, y: 0, w: 52, h: 16, axis: 'x', up: '+x' });
  X.ev('pointerdown', 26, 8); X.ev('pointermove', 39, 8); X.flush();
  assert.deepEqual(X.posts, [['bend', 0.5]], '13 mm right of 52: 2 · 13 / 52');
  X.ev('pointerup', 39, 8);
  assert.deepEqual(X.posts.at(-1), ['bend', 0]);
  const Y = ctlRig({ id: 'perf:bend', kind: 'lever', x: 0, y: 0, w: 16, h: 52, axis: 'y', up: '-y' });
  Y.ev('pointerdown', 8, 26); Y.ev('pointermove', 8, 13); Y.flush();
  assert.deepEqual(Y.posts, [['bend', 0.5]], 'away from the player raises');
  const M = ctlRig({ id: 'perf:mod', kind: 'lever', x: 0, y: 0, w: 16, h: 52, axis: 'y', up: '+y' });
  M.ev('pointerdown', 8, 10); M.ev('pointermove', 8, 23); M.flush();
  assert.deepEqual(M.posts, [['wheel', 0.25]], 'toward the player = more (13 / 52)');
  M.ev('pointermove', 8, 0); M.flush();
  assert.deepEqual(M.posts.at(-1), ['wheel', 0], 'clamped at 0');
  M.ev('pointermove', 8, 36); M.flush(); M.ev('pointerup', 8, 36);
  assert.deepEqual(M.posts.slice(-2), [['wheel', 0.5], ['wheel', 0]], 'a paddle: back to 0 at the release');
});

test('controllers §5.1: the ribbon — relative to the first touch, 12 st over its length clamped at ±2 st (≈ 82 mm on 490), a touch without moving does nothing, its marker follows the finger', () => {
  const R = ctlRig({ id: 'perf:bend', kind: 'ribbon', x: 0, y: 0, w: 490, h: 12, span: 12, hit: [490, 16] });
  R.ev('pointerdown', 200, 6); R.ev('pointerup', 200, 6); R.flush();
  assert.equal(R.posts.length, 0, 'a touch without moving: nothing');
  assert.deepEqual(R.shown.map(x => x[1]), [200, null], 'the marker at the touch, hidden at the release');
  R.ev('pointerdown', 200, 6); R.ev('pointermove', 200 + 490 / 12, 6); R.flush();
  assert.deepEqual(R.posts, [['bend', 0.5]], 'one semitone (≈ 41 mm): 1 of our 2');
  R.ev('pointermove', 200 + 82, 6); R.flush();
  assert.deepEqual(R.posts.at(-1), ['bend', 1], '82 mm: clamped at +2 st');
  R.ev('pointermove', 100, 6); R.flush();
  assert.deepEqual(R.posts.at(-1), ['bend', -1]);
  R.ev('pointerup', 100, 6);
  assert.deepEqual(R.posts.at(-1), ['bend', 0], 'springs to 0');
});

test('controllers §5.1: the pad ramps from the value at the press to 1 over `rise` (a fake clock), ≤ one post a frame, 0 at once at the release; aborted: the value at the press', () => {
  const R = ctlRig({ id: 'perf:mod', kind: 'pad', x: 0, y: 0, w: 30, h: 22, rise: 0.25 });
  R.ev('pointerdown', 15, 11);
  assert.deepEqual(R.shown[0], ['pressed', true]);
  R.flush(); // t = 0: v 0
  R.clock.t = 125; R.flush();
  assert.deepEqual(R.posts.at(-1), ['wheel', 0.5], 'half the rise: 0.5');
  R.clock.t = 300; R.flush(); R.flush();
  assert.deepEqual(R.posts.at(-1), ['wheel', 1], 'full');
  assert.equal(R.posts.filter(p => p[1] === 1).length, 1);
  R.ev('pointerup', 15, 11);
  assert.deepEqual([R.posts.at(-1), R.shown.at(-2)], [['wheel', 0], ['pressed', false]], 'off at once');
  const A = ctlRig({ id: 'perf:mod', kind: 'pad', x: 0, y: 0, w: 30, h: 22 }, { wheel: 0.2 });
  A.ev('pointerdown', 15, 11); A.clock.t = 125; A.flush();
  assert.deepEqual(A.posts.at(-1), ['wheel', 0.6], '0.2 → 1 over 0.25 s (the default rise): 0.6 at half');
  fire(A.el, 'pointercancel', { pointerId: 1, gesture: 'two-finger' });
  assert.deepEqual(A.posts.at(-1), ['wheel', 0.2], 'aborted: the value at the press');
  A.clock.t = 400; A.flush();
  assert.deepEqual(A.posts.at(-1), ['wheel', 0.2], 'the ramp stopped');
});

test('controllers: one finger per controller; the echo of a ctl is ignored while dragged and followed at rest; keys — arrows ±0.1, Home / End, a spring back at the keyup and the blur; the pad held by Space; release()', () => {
  const R = ctlRig(WH('perf:bend'));
  R.ev('pointerdown', 10, 40); R.ev('pointermove', 10, 25); R.flush();
  R.ev('pointerdown', 10, 40, { pointerId: 2 }); R.ev('pointermove', 10, 0, { pointerId: 2 }); R.flush();
  assert.deepEqual(R.posts, [['bend', 0.5]], 'a second finger: ignored');
  for (const f of R.views.bend) f(-0.3);
  assert.deepEqual(R.shown.at(-1), [0.5, null], 'dragged: the echo ignored');
  R.ev('pointerup', 10, 25);
  for (const f of R.views.bend) f(-0.3);
  assert.deepEqual(R.shown.at(-1), [-0.3, null], 'at rest: the tray / MIDI value shown');
  const M = ctlRig(WH('perf:mod'));
  fire(M.el, 'keydown', { key: 'ArrowUp' }); fire(M.el, 'keydown', { key: 'ArrowUp' }); fire(M.el, 'keyup', { key: 'ArrowUp' });
  assert.deepEqual(M.posts, [['wheel', 0.1], ['wheel', 0.2]], 'the mod wheel stays');
  fire(M.el, 'keydown', { key: 'End' }); fire(M.el, 'keydown', { key: 'Home' });
  assert.deepEqual(M.posts.slice(-2), [['wheel', 1], ['wheel', 0]]);
  const B = ctlRig(WH('perf:bend'));
  fire(B.el, 'keydown', { key: 'ArrowDown' }); fire(B.el, 'keydown', { key: 'ArrowDown' });
  fire(B.el, 'keyup', { key: 'ArrowDown' });
  assert.deepEqual(B.posts, [['bend', -0.1], ['bend', -0.2], ['bend', 0]], 'a spring: back at the keyup');
  fire(B.el, 'keydown', { key: 'Home' }); fire(B.el, 'blur');
  assert.deepEqual(B.posts.slice(-2), [['bend', -1], ['bend', 0]], 'and at the blur');
  const P = ctlRig({ id: 'perf:mod', kind: 'pad', x: 0, y: 0, w: 30, h: 22 });
  fire(P.el, 'keydown', { key: ' ' }); P.clock.t = 500; P.flush(); P.flush();
  fire(P.el, 'keydown', { key: ' ', repeat: true });
  fire(P.el, 'keyup', { key: ' ' });
  assert.deepEqual(P.posts.map(p => p[1]).filter((v, i, a) => a.indexOf(v) === i), [1, 0], 'Space held: touched; released: 0');
  // release(): a drag ended as at its release (a spring posts its rest)
  const Q = ctlRig(WH('perf:bend'));
  Q.ev('pointerdown', 10, 40); Q.ev('pointermove', 10, 30); Q.flush();
  Q.C.release();
  assert.deepEqual(Q.posts.at(-1), ['bend', 0]);
  Q.ev('pointermove', 10, 0); Q.ev('pointerup', 10, 0); Q.flush();
  assert.deepEqual(Q.posts.at(-1), ['bend', 0], 'stale events after release(): nothing');
  Q.C.destroy();
  assert.equal(Q.views.bend.size, 0, 'destroy: the view unhooked');
});

test('controllers (review 1 F6): one a pointer focused gives the page its keys back (Space, Home, End, the arrows: nothing posted, prevented or stopped, so main\'s transport gets them); one focused from the keyboard keeps them, also once pressed; a blur ends the claim', () => {
  const quiet = (R, ks) => { for (const key of ks) { const e = fire(R.el, 'keydown', { key }); assert.deepEqual([key, e.defaultPrevented, e._stop], [key, false, false]); fire(R.el, 'keyup', { key }); } };
  const B = ctlRig(WH('perf:bend')), M = ctlRig(WH('perf:mod'), { wheel: 0.6 }), P = ctlRig({ id: 'perf:mod', kind: 'pad', x: 0, y: 0, w: 30, h: 22 }, { wheel: 0.6 });
  for (const R of [B, M]) { R.ev('pointerdown', 10, 40); R.ev('pointerup', 10, 40); R.flush(); } // (a click focuses it: wk-dom's focus() fires 'focus')
  P.ev('pointerdown', 15, 11); P.flush(); P.ev('pointerup', 15, 11);
  const n = [B, M, P].map(R => R.posts.length);
  quiet(B, ['Home', 'End', 'ArrowUp', 'ArrowDown']); quiet(M, ['Home', 'End', 'ArrowLeft', 'ArrowRight']);
  quiet(P, [' ', 'Enter']); P.clock.t = 500; P.flush();
  assert.deepEqual([B, M, P].map(R => R.posts.length), n, 'a click-focused controller posts nothing for a key');
  // the keyboard: Tab (a focus with no press) — the keys are the controller's again (and stay so when pressed)
  const K2 = ctlRig(WH('perf:bend'));
  K2.el.focus();
  const e = fire(K2.el, 'keydown', { key: 'Home' });
  assert.deepEqual([K2.posts.at(-1), e.defaultPrevented, e._stop], [['bend', -1], true, true], 'Tab-focused: Home bends, the page does not see it');
  fire(K2.el, 'keyup', { key: 'Home' });
  K2.ev('pointerdown', 10, 40); K2.ev('pointerup', 10, 40);
  fire(K2.el, 'keydown', { key: 'ArrowUp' });
  assert.deepEqual(K2.posts.at(-1), ['bend', 0.1], 'pressed while keyboard-focused: still the keyboard\'s');
  fire(K2.el, 'keyup', { key: 'ArrowUp' });
  // a blur ends the pointer's claim: Tab back in and the keys act
  B.el.blur(); B.el.focus();
  fire(B.el, 'keydown', { key: 'End' });
  assert.deepEqual(B.posts.at(-1), ['bend', 1], 'Tab back to a click-focused one: its keys');
  fire(B.el, 'keyup', { key: 'End' });
  assert.deepEqual(B.posts.at(-1), ['bend', 0], 'and its spring at the keyup');
});

/* ---------------------------------------------------------------- phase 2: perfHost */
test('perfHost (§6.1): notes and controllers post only for the selected track, a bad note never; lit fans out to every mounted bed; live to the views; release() reaches every bed and a spring posts its rest', () => {
  const selected = 'A';
  const log = [];
  const H = K.perfHost({ noteOn: (n, v, ts) => log.push(['on', n, v, ts]), noteOff: (n, ts) => log.push(['off', n, ts]), ctl: (k, v) => log.push(['ctl', k, v]),
    live: k => ({ bend: 0.25, wheel: 0.5 })[k], held: () => [60, 64], bendUI: v => log.push(['bendUI', v]), modUI: v => log.push(['modUI', v]), sel: tv => tv.id === selected });
  const A = H.api({ id: 'A' }), Bv = H.api({ id: 'B' });
  A.on(60, 0.8, 12); A.off(60, 13); A.bend(0.5); A.mod(0.3); A.at(0.4);
  assert.deepEqual(log, [['on', 60, 0.8, 12], ['off', 60, 13], ['ctl', 'bend', 0.5], ['bendUI', 0.5], ['ctl', 'wheel', 0.3], ['modUI', 0.3], ['ctl', 'at', 0.4]]);
  log.length = 0;
  Bv.on(62, 1); Bv.off(62); Bv.bend(1); Bv.mod(1); Bv.at(1);
  assert.equal(log.length, 0, 'a stale panel (not the selected track): nothing');
  for (const n of [NaN, 60.5, -1, 128, '60', undefined]) { A.on(n, 1); A.off(n); }
  assert.equal(log.length, 0, 'a NaN / non-integer / out-of-range note: nothing');
  assert.deepEqual([A.value('bend'), A.value('wheel'), A.value('at'), A.held().join()], [0.25, 0.5, 0, '60,64']);
  // lit → every mounted bed; one unhooked
  const L1 = [], L2 = [];
  const off1 = A.lit((n, on) => L1.push([n, on])); A.lit((n, on) => L2.push([n, on]));
  H.lit(67, true); off1(); H.lit(67, false);
  assert.deepEqual([L1, L2], [[[67, true]], [[67, true], [67, false]]]);
  // live → the views of that kind
  const V = [];
  A.view('bend', v => V.push(['b', v])); A.view('wheel', v => V.push(['w', v]));
  H.live('bend', -0.5); H.live('wheel', 0.7); H.live('sus', 1);
  assert.deepEqual(V, [['b', -0.5], ['w', 0.7]]);
  // release(): a real bed and a spring controller mid-drag, through the host
  const doc = fresh(), bedEl = doc.createElement('div'), wEl = doc.createElement('div'), B = K.bedLayout(BEDS.b61);
  doc.body.append(bedEl, wEl); place(bedEl, 0, 0, B.w * 2, (B.h + B.front) * 2); place(wEl, 0, 0, 40, 120);
  log.length = 0;
  const E = K.bed(bedEl, B, { on: (n, v, ts) => A.on(n, v, ts), off: (n, ts) => A.off(n, ts), at: null, shade: () => {} });
  A.bed(() => E.release());
  const Cw = K.controller(wEl, WH('perf:bend'), { perf: A, show: () => {}, raf: f => f(), now: () => 0 });
  A.bed(() => Cw.release());
  fire(bedEl, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 24, clientY: 100, button: 0, buttons: 1 });
  fire(wEl, 'pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 20, clientY: 60, button: 0, buttons: 1 });
  fire(wEl, 'pointermove', { pointerId: 2, pointerType: 'touch', clientX: 20, clientY: 30, button: 0, buttons: 1 });
  H.release();
  assert.deepEqual(log.filter(x => x[0] === 'off').map(x => x[1]), [36], 'the bed: one off');
  assert.deepEqual(log.filter(x => x[0] === 'ctl').map(x => x.slice(1)).at(-1), ['bend', 0], 'the spring: its rest posted');
});

test('ensureCSS: one <style> per document; the widget roots take pointers, a disabled one none; the shades hidden by [hidden]', () => {
  const doc = fresh();
  const s1 = K.ensureCSS(doc), s2 = K.ensureCSS(doc);
  assert.equal(s1 === s2, true);
  assert.equal(doc.head.childNodes.filter(n => n.localName === 'style').length, 1);
  const css = s1.textContent;
  for (const sel of ['.hw-c > .hw-keys', '.hw-c > .hw-wheel', '[aria-disabled="true"]', '.hw-kd[hidden]', 'touch-action: none', '-webkit-touch-callout: none']) assert.ok(css.includes(sel), sel);
});
