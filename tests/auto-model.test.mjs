import './v8-guard.mjs';
// Stage AUTO phase 0 (IMPL-AUTO §2, §9 G2): the automation model in song.js — S.normAuto / autoAt / autoWrite / autoThin / autoKeys,
// track.auto through deserialize, contentEnd / songEnd and the range ops (copy / clear / delete / insert / paste / duplicate, §2.1's
// per-op rules). Seeded property tests (≥ 20 000 cases in all, counted by the last test): values outside a range unchanged (shifted
// where time moved); copy → paste reproduces the copied values at every tick inside; insert = a flat gap; the jump-pair rule; thinning
// within eps; the cap; normAuto a fixed point that never throws (hostile shapes, cycles). And the other direction: a project without
// automation serialises, copies and edits byte for byte as at ⟨B⟩ (62a7459) — tests/fixtures/auto-noauto.json holds that run's digest
// (recorded from ⟨B⟩'s song.js with AUTO_REC=1; never re-record it from a later build).
// Curves are checked at every breakpoint of both curves (shifted where time moved) plus the range edges: two piecewise-linear curves that
// agree there agree at every tick between.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import * as S from '../song.js?v=9';

const MAXT = 2 ** 28 - 1, r6 = x => Math.round(x * 1e6) / 1e6 + 0;
const ri = (rng, a, b) => a + Math.floor(rng() * (b - a + 1)), pick = (rng, a) => a[Math.floor(rng() * a.length)];
const J = x => JSON.stringify(x), clone = x => JSON.parse(JSON.stringify(x));
let CASES = 0, CHK = 0; // (CHK: curves checked — a range test that saw none fails)

/* ------------------------------------------------------------ a project without automation: byte for byte as at ⟨B⟩ */
const FIX = new URL('./fixtures/auto-noauto.json', import.meta.url);
const KINDS = ['bend', 'wheel', 'sus', 'at'];
function noAutoProject(rng) {
  const bt = 3840, tracks = [], n = ri(rng, 1, 4), edge = () => (rng() < 0.3 ? ri(rng, 0, 12) * 960 : ri(rng, 0, bt * 10));
  for (let k = 1; k <= n; k++) {
    const t = { id: 'trk_' + k, name: 'T' + k, color: '#3b82c4', notes: [], cc: [], vol: rng(), pan: rng() * 2 - 1, mute: rng() < 0.2 };
    if (rng() < 0.5) Object.assign(t, { model: 'minimoog', vals: { cf: r6(rng() * 10) }, preset: null });
    else Object.assign(t, { prim: 'i1', nid: 2, dev: { i1: { kind: 'synth', model: 'juno60', vals: {}, preset: null }, out: { kind: 'out' } }, wires: [{ id: 'w1', a: 'i1.out', b: 'out.in' }] });
    for (let i = ri(rng, 0, 12); i > 0; i--) t.notes.push({ t: edge(), d: ri(rng, 1, 3000), n: ri(rng, 30, 90), v: ri(rng, 1, 127) });
    for (let i = ri(rng, 0, 10); i > 0; i--) { const kk = pick(rng, KINDS); t.cc.push({ t: edge(), k: kk, v: kk === 'bend' ? rng() * 2 - 1 : rng() }); }
    tracks.push(t);
  }
  return { name: 'P', bpm: 120, sig: rng() < 0.8 ? [4, 4] : [3, 4], bars: ri(rng, 1, 12), loop: { on: true, start: 0, end: bt * 4 }, tracks };
}
// the run: deserialize, then every range op (and songEnd after each), the clipboard too; the note ids (a module counter) left out
function noAutoRun(seed, n) {
  const rng = S.mulberry32(seed), out = [], put = x => out.push(JSON.stringify(x, (k, v) => (k === 'id' && typeof v === 'number' ? undefined : v)));
  for (let c = 0; c < n; c++) {
    const raw = noAutoProject(rng), p = S.deserialize(J(raw));
    put(S.serialize(p) === J(p) ? p : null);
    const span = () => { const s = rng() < 0.3 ? ri(rng, 0, 8) * 960 : ri(rng, 0, 30000); return [s, s + (rng() < 0.3 ? ri(rng, 1, 4) * 960 : ri(rng, 1, 9000))]; };
    const ids = () => (rng() < 0.5 ? null : [pick(rng, p.tracks).id]);
    let [s, e] = span();
    const clip = S.copyRange(p, s, e, ids()); put(clip);
    [s, e] = span(); put(S.clearRange(p, s, e, ids())); put(p); put(S.songEnd(p));
    [s, e] = span(); put(S.deleteTime(p, s, e, ids())); put(p); put(S.songEnd(p));
    [s, e] = span(); put(S.insertTime(p, s, e - s, ids())); put(p); put(S.songEnd(p));
    const one = S.copyRange(p, ...span(), [p.tracks[0].id]);
    put(S.pasteRange(p, clip, ri(rng, 0, 40000), { insert: rng() < 0.5 })); put(p);
    put(S.pasteRange(p, one, ri(rng, 0, 40000), { to: pick(rng, p.tracks).id })); put(p); put(S.songEnd(p));
    [s, e] = span(); put(S.duplicateRange(p, s, e, ids())); put(p); put(S.songEnd(p));
    put(S.serialize(S.deserialize(S.serialize(p))));
    CASES++;
  }
  return createHash('sha256').update(out.join('\n')).digest('hex');
}

test('G2 / §2.1: a project without automation — deserialize, serialize, copy / clear / delete / insert / paste / duplicate and songEnd byte for byte as at ⟨B⟩ (500 random projects, the digest recorded from ⟨B⟩\'s song.js); no `auto` key anywhere; newTrack has none', () => {
  const sha = noAutoRun(0xA070, 500);
  if (process.env.AUTO_REC) writeFileSync(FIX, J({ v: 1, from: '62a7459 song.js (⟨B⟩ of stage AUTO), noAutoRun(0xA070, 500)', sha }) + '\n');
  assert.equal(sha, JSON.parse(readFileSync(FIX, 'utf8')).sha, 'the same bytes as ⟨B⟩');
  const p = S.newProject();
  assert.equal('auto' in p.tracks[0], false, 'newProject\'s track: no auto');
  assert.equal('auto' in S.newTrack(p), false, 'newTrack: absent, never {}');
  const q = S.deserialize(J({ tracks: [{ id: 'trk_1', notes: [], cc: [], auto: {} }, { id: 'trk_2', auto: { 'i1:cf': { pts: [] } } }, { id: 'trk_3', auto: { 'mfx:fx.rev.mix': { pts: [[0, 1]] } } }] }));
  assert.deepEqual(q.tracks.map(t => 'auto' in t), [false, false, false], 'an empty / all-invalid auto: absent');
});

/* ------------------------------------------------------------ curves */
// a normalised curve: unique integer ticks, sorted; values rounded to 1e-6; jump pairs (two points one tick apart) now and then
function curve(rng, { n = ri(rng, 0, 20), lo = 0, hi = 1, t0 = ri(rng, 0, 3000), gap = 1500 } = {}) {
  const m = new Map();
  let t = t0;
  for (let i = 0; i < n && t <= MAXT; i++) {
    m.set(t, r6(lo + (hi - lo) * rng()));
    if (rng() < 0.15) m.set(++t, r6(lo + (hi - lo) * rng()));
    t += rng() < 0.25 ? ri(rng, 1, 3) : ri(rng, 1, gap);
  }
  return [...m].sort((a, b) => a[0] - b[0]);
}
const wellFormed = (pts, what) => {
  assert.ok(Array.isArray(pts), what + ': an array');
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i];
    if (!(Array.isArray(q) && q.length === 2 && Number.isInteger(q[0]) && q[0] >= 0 && q[0] <= MAXT && Number.isFinite(q[1]) && (i === 0 || q[0] > pts[i - 1][0]))) assert.fail(what + ': point ' + i + ' ' + J(q) + ' after ' + J(pts[i - 1]));
  }
};
const near = (a, b, tol = 2e-6) => a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol);
// f and g agree at every tick of ticks inside [lo, hi)
function agree(f, g, ticks, lo, hi, what) {
  for (const t of ticks) if (t >= lo && t < hi && !near(f(t), g(t))) assert.fail(`${what}: at ${t} ${f(t)} ≠ ${g(t)}`);
}
const tickSet = (...xs) => { const s = new Set(); for (const x of xs) for (const t of Array.isArray(x) ? x : [x]) if (Number.isFinite(t) && t >= 0) { s.add(t); s.add(t + 1); if (t > 0) s.add(t - 1); } return s; };
const ticksOf = (pts, d = 0) => pts.map(q => q[0] + d);

test('G2 §2.3 autoAt: empty → undefined; flat before the first and after the last; exact at the points; linear between (= a linear scan), 2 000 curves', () => {
  assert.equal(S.autoAt([], 5), undefined);
  assert.equal(S.autoAt(undefined, 5), undefined);
  const P = [[10, 0], [20, 1], [21, 0.5]];
  assert.deepEqual([0, 10, 15, 20, 21, 1e9].map(t => S.autoAt(P, t)), [0, 0, 0.5, 1, 0.5, 0.5]);
  const rng = S.mulberry32(0xA7A7);
  for (let c = 0; c < 2000; c++, CASES++) {
    const pts = curve(rng, { n: ri(rng, 1, 40) });
    const scan = t => { if (t <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]); } return pts[pts.length - 1][1]; };
    for (const t of [...tickSet(ticksOf(pts)), ri(rng, 0, 60000), rng() * 30000]) if (!near(S.autoAt(pts, t), scan(t), 1e-12)) assert.fail(`case ${c} t ${t}`);
    for (const q of pts) assert.equal(S.autoAt(pts, q[0]), q[1], 'exact at a point');
  }
});

test('G2 §2.3 autoWrite + the jump-pair rule (6 000 cases): [t0, t1) replaced by the new points, the old curve kept before t0 and from t1 on (a jump pair at t1: [t1 − 1, the last new value], [t1, the old value]) — past the last old point too (fix round, R1 P2-5: the old curve’s last value returns); an empty curve takes the new points as they are; the inputs untouched', () => {
  const rng = S.mulberry32(0xA0A1);
  for (let c = 0; c < 6000; c++, CASES++) {
    const old = rng() < 0.1 ? [] : curve(rng), t0 = ri(rng, 0, 20000), t1 = t0 + ri(rng, 1, rng() < 0.2 ? 3 : 6000);
    const np = curve(rng, { t0: t0 + (rng() < 0.5 ? 0 : ri(rng, 0, t1 - t0 - 1)), gap: Math.max(1, (t1 - t0) >> 2), n: ri(rng, rng() < 0.1 ? 0 : 1, 12) }).filter(q => q[0] < t1);
    const o0 = J(old), n0 = J(np), out = S.autoWrite(old, t0, t1, np), at = t => S.autoAt(out, t), was = t => S.autoAt(old, t);
    const what = `case ${c} (t0 ${t0}, t1 ${t1})`;
    assert.equal(J(old) + J(np), o0 + n0, what + ': inputs untouched');
    wellFormed(out, what);
    if (!old.length) { assert.deepEqual(out, np, what + ': an empty curve takes the new points'); continue; }
    for (const q of np) if (!out.some(p => p[0] === q[0] && p[1] === q[1])) assert.fail(what + ': new point ' + J(q) + ' missing');
    assert.equal(out.filter(p => p[0] >= t0 && p[0] < t1 && !np.some(q => q[0] === p[0])).length <= (np.length ? 1 : 0), true, what + ': no old point left inside (only the jump pair\'s [t1 − 1])');
    const T = tickSet(ticksOf(old), ticksOf(out), ticksOf(np), [0, t0, t1]);
    agree(at, was, T, 0, t0, what + ' before t0');
    if (np.length) agree(at, t => S.autoAt(np, t), T, np[0][0], np[np.length - 1][0] + 1, what + ' the new points');
    agree(at, was, T, t1, Infinity, what + ' from t1 on');
    if (np.length) assert.ok(near(at(t1 - 1), np[np.length - 1][1]), what + ': the jump pair\'s first point holds the last new value');
  }
  assert.deepEqual(S.autoWrite([[0, 0], [100, 1]], 40, 60, [[40, 0.5], [50, 0.9]]), [[0, 0], [39, 0.39], [40, 0.5], [50, 0.9], [59, 0.9], [60, 0.6], [100, 1]], 'the lead keeps 0…39, the pair at 60');
  assert.deepEqual(S.autoWrite([[0, 0], [100, 1]], 40, 60, [[40, 0.4], [59, 0.6]]), [[0, 0], [40, 0.4], [59, 0.6], [60, 0.6], [100, 1]], 'new points on the old line: no lead, no [t1 − 1]');
  assert.deepEqual(S.autoWrite([[0, 0], [10, 1]], 40, 60, [[40, 0.5]]), [[0, 0], [10, 1], [39, 1], [40, 0.5], [59, 0.5], [60, 1]], 'past the last old point: the pair, the old curve\'s 1 again from 60');
});

/* ------------------------------------------------------------ the range ops */
const KEYS = ['i1:cf', 'fx1:fx.2.mix', 'i1:k3u', 'mix:vol', 'mix:pan', 'i2:oscA.level'];
const dom = k => (k === 'mix:vol' ? [0, 1.25] : k === 'mix:pan' ? [-1, 1] : k === 'i1:cf' || k === 'i1:k3u' ? [0, 10] : [0, 1]);
function autoProject(rng) {
  const tracks = [], n = ri(rng, 1, 3);
  for (let k = 1; k <= n; k++) {
    const t = { id: 'trk_' + k, name: 'T' + k, model: 'minimoog', vals: {}, notes: [], cc: [] };
    for (let i = ri(rng, 0, 6); i > 0; i--) t.notes.push({ t: ri(rng, 0, 30000), d: ri(rng, 1, 2000), n: ri(rng, 30, 90), v: 100 });
    for (let i = ri(rng, 0, 4); i > 0; i--) t.cc.push({ t: ri(rng, 0, 30000), k: pick(rng, KINDS), v: rng() });
    if (rng() < 0.85) { t.auto = {}; for (const key of KEYS) if (rng() < 0.45) { const [lo, hi] = dom(key); t.auto[key] = { pts: curve(rng, { lo, hi, n: ri(rng, 1, 16) }) }; } }
    tracks.push(t);
  }
  return S.deserialize(J({ bpm: 120, sig: [4, 4], bars: 8, tracks }));
}
const ptsOf = (t, k) => (CHK++, t.auto && t.auto[k] ? t.auto[k].pts : []);
const checked = n0 => assert.ok(CHK - n0 > 1000, 'curves checked: ' + (CHK - n0));
const strip = p => { const q = clone(p); for (const t of q.tracks) delete t.auto; return q; };
const evs = p => J(p.tracks.map(t => [t.id, t.notes.map(x => [x.t, x.d, x.n, x.v]), t.cc])) + J(p.loop);
const span = rng => { const s = rng() < 0.3 ? ri(rng, 0, 8) * 960 : ri(rng, 0, 22000); return [s, s + (rng() < 0.3 ? ri(rng, 1, 4) * 960 : ri(rng, 1, 8000))]; };
// every op: the notes / cc / loop exactly as on the same project without automation; every curve well formed
function sameEvents(p, q, op, what) { op(p); op(q); assert.equal(evs(p), evs(q), what + ': notes, cc and the loop as without automation'); for (const t of p.tracks) for (const k of Object.keys(t.auto || {})) { wellFormed(t.auto[k].pts, what + ' ' + k); assert.ok(t.auto[k].pts.length > 0, what + ': no empty key'); } }

test('G2 §2.1 clear [s, e) (1 500 cases): the inner points removed, points at s and e with the old values there — every value outside the range unchanged; nothing inside (s, e); the notes / cc as without automation', () => {
  const rng = S.mulberry32(0xC1EA), n0 = CHK;
  for (let c = 0; c < 1500; c++, CASES++) {
    const p = autoProject(rng), q = strip(p), [s, e] = span(rng), ids = rng() < 0.5 ? null : [pick(rng, p.tracks).id], before = clone(p), what = `case ${c} [${s}, ${e})`;
    sameEvents(p, q, x => S.clearRange(x, s, e, ids), what);
    for (const t0 of before.tracks) {
      const t = S.findTrack(p, t0.id), hit = !ids || ids.includes(t.id);
      for (const k of Object.keys(t0.auto || {})) {
        const old = ptsOf(t0, k), out = ptsOf(t, k);
        if (!hit) { assert.deepEqual(out, old, what + ': another track untouched'); continue; }
        const T = tickSet(ticksOf(old), ticksOf(out), [0, s, e]);
        agree(x => S.autoAt(out, x), x => S.autoAt(old, x), T, 0, s, what + ' ' + k + ' before s');
        agree(x => S.autoAt(out, x), x => S.autoAt(old, x), T, e, Infinity, what + ' ' + k + ' from e');
        assert.equal(out.some(q => q[0] > s && q[0] < e), false, what + ' ' + k + ': nothing inside');
      }
    }
  }
  checked(n0);
});

test('G2 §2.1 insert len at at (1 500 cases): a flat gap — the value at `at` from at to at + len, every value before unchanged, every one after shifted by len', () => {
  const rng = S.mulberry32(0x1235), n0 = CHK;
  for (let c = 0; c < 1500; c++, CASES++) {
    const p = autoProject(rng), q = strip(p), at = ri(rng, 0, 22000), len = ri(rng, 1, 8000), ids = rng() < 0.5 ? null : [pick(rng, p.tracks).id], before = clone(p), what = `case ${c} at ${at} len ${len}`;
    sameEvents(p, q, x => S.insertTime(x, at, len, ids), what);
    for (const t0 of before.tracks) {
      const t = S.findTrack(p, t0.id), hit = !ids || ids.includes(t.id);
      for (const k of Object.keys(t0.auto || {})) {
        const old = ptsOf(t0, k), out = ptsOf(t, k), f = x => S.autoAt(out, x), g = x => S.autoAt(old, x);
        if (!hit) { assert.deepEqual(out, old); continue; }
        const T = tickSet(ticksOf(old), ticksOf(old, len), ticksOf(out), ticksOf(out, -len), [0, at, at + len]);
        agree(f, g, T, 0, at, what + ' ' + k + ' before');
        agree(f, () => g(at), T, at, at + len + 1, what + ' ' + k + ' the flat gap');
        agree(f, x => g(x - len), T, at + len, Infinity, what + ' ' + k + ' shifted');
      }
    }
  }
  checked(n0);
});

test('G2 §2.1 delete [s, e) (1 500 cases): every value before s unchanged, from s on the old value at t + len (a jump pair at s: autoAt(s−) → autoAt(e)); contentEnd counts the last point (project.bars)', () => {
  const rng = S.mulberry32(0xDE1E), n0 = CHK;
  for (let c = 0; c < 1500; c++, CASES++) {
    const p = autoProject(rng), q = strip(p), [s, e] = span(rng), len = e - s, ids = rng() < 0.5 ? null : [pick(rng, p.tracks).id], before = clone(p), what = `case ${c} [${s}, ${e})`;
    sameEvents(p, q, x => S.deleteTime(x, s, e, ids), what);
    let last = 0;
    for (const t0 of before.tracks) {
      const t = S.findTrack(p, t0.id), hit = !ids || ids.includes(t.id);
      for (const k of Object.keys(t0.auto || {})) {
        const old = ptsOf(t0, k), out = ptsOf(t, k), f = x => S.autoAt(out, x), g = x => S.autoAt(old, x);
        last = Math.max(last, out[out.length - 1][0] + 1);
        if (!hit) { assert.deepEqual(out, old); continue; }
        const T = tickSet(ticksOf(old), ticksOf(old, -len), ticksOf(out), ticksOf(out, len), [0, s, e]);
        agree(f, g, T, 0, s, what + ' ' + k + ' before s');
        agree(f, x => g(x + len), T, s, Infinity, what + ' ' + k + ' from s');
      }
    }
    assert.ok(p.bars >= Math.min(9999, Math.ceil(last / S.barTicks(p))), what + ': bars cover the last point');
  }
  checked(n0);
});

test('G2 §2.1 copy → paste (2 000 cases): the clip holds [0, autoAt(s)], the inner points − s and [e − s, autoAt(e)] per key; pasted at `at` (into another project\'s track, `to`) it reproduces the copied values at every tick of [at, at + len), the target\'s own values before and from at + len on (the jump pair back), its other keys untouched; a key the target lacks arrives as is (a cross-track paste leaves keys as they are)', () => {
  const rng = S.mulberry32(0xC0BE), n0 = CHK;
  for (let c = 0; c < 2000; c++, CASES++) {
    const p = autoProject(rng), src = pick(rng, p.tracks), [s, e] = span(rng), len = e - s, what = `case ${c} [${s}, ${e})`;
    const clip = S.copyRange(p, s, e, [src.id]), ca = clip.tracks[src.id].auto;
    assert.deepEqual(Object.keys(ca || {}), Object.keys(src.auto || {}), what + ': one clip key per curve');
    if (!src.auto) assert.equal('auto' in clip.tracks[src.id], false, what + ': no auto on the track, none in the clip');
    for (const k of Object.keys(ca || {})) {
      const cp = ca[k].pts, old = ptsOf(src, k);
      wellFormed(cp, what + ' clip ' + k);
      assert.deepEqual([cp[0], cp[cp.length - 1]], [[0, r6(S.autoAt(old, s))], [len, r6(S.autoAt(old, e))]], what + ': the clip\'s ends');
      agree(x => S.autoAt(cp, x - s), x => S.autoAt(old, x), tickSet(ticksOf(old), ticksOf(cp, s), [s, e]), s, e + 1, what + ' clip ' + k);
    }
    const tgt = autoProject(rng), dst = pick(rng, tgt.tracks), at = ri(rng, 0, 22000), insert = rng() < 0.3, t0 = clone(dst), q = strip(tgt);
    sameEvents(tgt, q, x => S.pasteRange(x, rng() < 0.5 ? clip : clone(clip), at, { insert, to: dst.id }), what);
    const d = S.findTrack(tgt, dst.id), sh = insert ? len : 0;
    for (const k of new Set([...Object.keys(t0.auto || {}), ...Object.keys(ca || {})])) {
      const old = ptsOf(t0, k), out = ptsOf(d, k), f = x => S.autoAt(out, x), g = x => S.autoAt(old, x);
      const T = tickSet(ticksOf(old), ticksOf(old, sh), ticksOf(out), ticksOf(ptsOf(src, k), at - s), [0, at, at + len]);
      if (!ca || !ca[k]) { agree(f, x => (x < at ? g(x) : x < at + sh ? g(at) : g(x - sh)), T, 0, Infinity, what + ' ' + k + ': not in the clip — untouched (an inserted gap flat)'); continue; }
      agree(f, x => S.autoAt(ptsOf(src, k), x - at + s), T, at, at + len, what + ' ' + k + ' inside');
      if (!old.length) continue;
      agree(f, g, T, 0, at, what + ' ' + k + ' before');
      agree(f, x => g(x - sh), T, at + len, Infinity, what + ' ' + k + ' after: the target\'s own values');
    }
  }
  checked(n0);
});

test('G2 §2.1 duplicate [s, e) = copy + insert + paste (1 500 cases): values before e unchanged, [e, e + len) the copy of [s, e), every one after shifted by len', () => {
  const rng = S.mulberry32(0xD0B1), n0 = CHK;
  for (let c = 0; c < 1500; c++, CASES++) {
    const p = autoProject(rng), q = strip(p), [s, e] = span(rng), len = e - s, ids = rng() < 0.5 ? null : [pick(rng, p.tracks).id], before = clone(p), what = `case ${c} [${s}, ${e})`;
    sameEvents(p, q, x => S.duplicateRange(x, s, e, ids), what);
    for (const t0 of before.tracks) {
      const t = S.findTrack(p, t0.id), hit = !ids || ids.includes(t.id);
      for (const k of Object.keys(t0.auto || {})) {
        const old = ptsOf(t0, k), out = ptsOf(t, k), f = x => S.autoAt(out, x), g = x => S.autoAt(old, x);
        if (!hit) { assert.deepEqual(out, old); continue; }
        const T = tickSet(ticksOf(old), ticksOf(old, len), ticksOf(out), [0, s, e, e + len]);
        agree(f, g, T, 0, e, what + ' ' + k + ' before e');
        agree(f, x => g(x - len), T, e, e + len, what + ' ' + k + ' the copy');
        agree(f, x => g(x - len), T, e + len, Infinity, what + ' ' + k + ' after');
      }
    }
  }
  checked(n0);
});

test('§2.1 the range ops by hand: clear, insert, delete, paste and copy on one curve', () => {
  const mk = pts => S.deserialize(J({ tracks: [{ id: 'trk_1', notes: [], cc: [], auto: { 'i1:cf': { pts } } }, { id: 'trk_2', notes: [], cc: [] }] }));
  const A = p => p.tracks[0].auto && p.tracks[0].auto['i1:cf'].pts;
  let p = mk([[0, 0], [100, 10], [200, 0]]);
  S.clearRange(p, 50, 150); assert.deepEqual(A(p), [[0, 0], [50, 5], [150, 5], [200, 0]], 'clear: points at s and e');
  p = mk([[0, 0], [100, 10]]); S.clearRange(p, 20, 80); assert.deepEqual(A(p), [[0, 0], [100, 10]], 'clear with nothing inside: unchanged');
  p = mk([[0, 0], [100, 10]]); S.insertTime(p, 50, 1000); assert.deepEqual(A(p), [[0, 0], [50, 5], [1050, 5], [1100, 10]], 'insert: a flat gap');
  p = mk([[0, 0], [100, 10]]); S.insertTime(p, 100, 10); assert.deepEqual(A(p), [[0, 0], [100, 10], [110, 10]], 'insert at a point');
  p = mk([[100, 3], [200, 4]]); S.insertTime(p, 50, 10); assert.deepEqual(A(p), [[110, 3], [210, 4]], 'insert before the first point: the shift alone');
  p = mk([[0, 0], [100, 10], [200, 0]]); S.deleteTime(p, 50, 150); assert.deepEqual(A(p), [[0, 0], [49, 4.9], [50, 5], [100, 0]], 'delete: the jump pair at s');
  p = mk([[0, 0], [100, 10]]); S.deleteTime(p, 0, 50); assert.deepEqual(A(p), [[0, 5], [50, 10]], 'delete from 0');
  p = mk([[0, 0], [100, 10]]); const clip = S.copyRange(p, 20, 60, ['trk_1']);
  assert.deepEqual(clip.tracks.trk_1.auto, { 'i1:cf': { pts: [[0, 2], [40, 6]] } }, 'copy: [0, autoAt(s)], [len, autoAt(e)]');
  assert.equal('auto' in clip.tracks.trk_1 && !('auto' in S.copyRange(p, 20, 60, ['trk_2']).tracks.trk_2), true, 'a track without curves: no auto in its clip');
  S.pasteRange(p, clip, 200); assert.deepEqual(A(p), [[0, 0], [100, 10], [199, 10], [200, 2], [239, 5.9], [240, 10]], 'paste past the end: the lead, the copied ramp, the jump pair back to 10');
  S.pasteRange(p, clip, 0, { to: 'trk_2' }); assert.deepEqual(p.tracks[1].auto, { 'i1:cf': { pts: [[0, 2], [39, 5.9]] } }, 'a key the target lacks: the copy, its last value held');
  p = mk([[0, 0], [100, 10]]); S.duplicateRange(p, 0, 100); assert.deepEqual(A(p), [[0, 0], [99, 9.9], [100, 0], [199, 9.9], [200, 10]], 'duplicate');
});

test('§2.1 contentEnd / songEnd count the last point; deserialize carries auto (normAuto), serialize → deserialize a fixed point; autoKeys', () => {
  const p = S.deserialize(J({ bars: 2, tracks: [{ id: 'trk_1', notes: [{ t: 0, d: 100, n: 60, v: 100 }], cc: [], auto: { 'i1:cf': { pts: [[30000, 3], [10, 1]], x: 1 }, bad: { pts: [[0, 1]] } } }] }));
  assert.deepEqual(p.tracks[0].auto, { 'i1:cf': { pts: [[10, 1], [30000, 3]] } });
  assert.equal(S.songEnd(p), 30001, 'songEnd: the last point + 1');
  S.deleteTime(p, 0, 960); assert.equal(p.bars, Math.ceil(29041 / S.barTicks(p)), 'contentEnd: the last point bumps bars');
  const s1 = S.serialize(p), s2 = S.serialize(S.deserialize(s1));
  assert.equal(s2, s1, 'a fixed point');
  assert.deepEqual([S.autoKeys(p.tracks[0]), S.autoKeys({}), S.autoKeys(null), S.autoKeys({ auto: { 'i1:a': { pts: [] }, 'i1:b': { pts: [[0, 1]] } } })], [['i1:cf'], [], [], ['i1:b']]);
});

// fix 12 (R2 P2-2 + P3): a curve carries its last-known label and range for the day its control is gone
test('§2.1 n / r (fix round): normAuto keeps a key\'s label n (a string ≤ 64 chars) and range r ([lo, hi] finite, lo < hi), drops a bad one; deserialize, the range ops and a fixed point keep them', () => {
  const a = S.normAuto({ 'i1:fc': { pts: [[0, 1]], n: 'Minimoog · Cutoff', r: [0, 10] }, 'i1:em': { pts: [[0, 1]], n: 'x'.repeat(80), r: [5, 5] }, 'i1:cf': { pts: [[0, 1]], n: 7, r: [0, Infinity] }, 'i2:fc': { pts: [[0, 1]], n: '', r: [1, 0, 2] } });
  assert.deepEqual(a, { 'i1:fc': { pts: [[0, 1]], n: 'Minimoog · Cutoff', r: [0, 10] }, 'i1:em': { pts: [[0, 1]], n: 'x'.repeat(64) }, 'i1:cf': { pts: [[0, 1]] }, 'i2:fc': { pts: [[0, 1]] } });
  assert.deepEqual(S.normAuto(a), a, 'a fixed point');
  const p = S.deserialize(J({ tracks: [{ id: 'trk_1', notes: [], cc: [], auto: { 'i1:fc': { pts: [[0, 1], [3840, 9]], n: 'Minimoog · Cutoff', r: [0, 10] } } }] }));
  assert.deepEqual([p.tracks[0].auto['i1:fc'].n, p.tracks[0].auto['i1:fc'].r], ['Minimoog · Cutoff', [0, 10]], 'deserialize');
  S.insertTime(p, 960, 960); S.deleteTime(p, 0, 480); S.clearRange(p, 100, 200); S.pasteRange(p, S.copyRange(p, 0, 960), 2000);
  assert.deepEqual([p.tracks[0].auto['i1:fc'].n, p.tracks[0].auto['i1:fc'].r], ['Minimoog · Cutoff', [0, 10]], 'the range ops keep them');
  const q = S.deserialize(J({ tracks: [{ id: 'trk_1', notes: [], cc: [] }] }));
  S.pasteRange(q, S.copyRange(p, 0, 960), 0);
  assert.deepEqual([q.tracks[0].auto['i1:fc'].n, q.tracks[0].auto['i1:fc'].r], ['Minimoog · Cutoff', [0, 10]], 'a key pasted onto a track without it arrives with them');
});

/* ------------------------------------------------------------ thinning, the cap, normAuto */
test('G2 §2.3 autoThin (1 500 cases): Ramer–Douglas–Peucker — a subset with the first and last points, every dropped point within eps of the thinned curve; eps 0 drops only points on a line', () => {
  const rng = S.mulberry32(0x7417);
  for (let c = 0; c < 1500; c++, CASES++) {
    const n = ri(rng, 0, rng() < 0.1 ? 3000 : 300), pts = [];
    let t = ri(rng, 0, 100), v = rng();
    for (let i = 0; i < n; i++) { pts.push([t, r6(v)]); t += ri(rng, 1, 40); v = rng() < 0.05 ? rng() : Math.min(1, Math.max(0, v + (rng() - 0.5) * 0.02)); }
    const eps = pick(rng, [0, 1e-4, 1e-3, 0.01, 0.1]), p0 = J(pts), out = S.autoThin(pts, eps), what = `case ${c} n ${n} eps ${eps}`;
    assert.equal(J(pts), p0, what + ': input untouched');
    wellFormed(out, what);
    if (n) assert.deepEqual([out[0], out[out.length - 1]], [pts[0], pts[n - 1]], what + ': the ends kept');
    let j = 0;
    for (const q of out) { while (j < n && pts[j][0] !== q[0]) j++; assert.ok(j < n && pts[j][1] === q[1], what + ': a subset'); }
    for (const q of pts) if (!(Math.abs(S.autoAt(out, q[0]) - q[1]) <= eps)) assert.fail(`${what}: ${J(q)} off by ${Math.abs(S.autoAt(out, q[0]) - q[1])}`);
  }
  assert.deepEqual(S.autoThin([[0, 0], [1, 0.5], [2, 1], [3, 1]], 0), [[0, 0], [2, 1], [3, 1]], 'eps 0: the collinear point goes');
});

test('G2 §2.1 the cap (fix round, R1 P2-2): a key holds at most 20 000 points — thinned harder (RDP, eps doubled from 1e-3 of its span) rather than cut: the ends kept, every point within the eps; at most 4 096 keys; normAuto fixed', () => {
  assert.equal(S.AUTO_MAX, 20000);
  const many = Array.from({ length: 30000 }, (_, i) => [29999 - i, (i % 100) / 100]), a = S.normAuto({ 'i1:cf': { pts: many } }), A0 = a['i1:cf'].pts;
  assert.ok(A0.length <= 20000, 'capped: ' + A0.length);
  assert.deepEqual([A0[0][0], A0[A0.length - 1][0]], [0, 29999], 'the ends kept (never the first 20 000 ticks alone)');
  assert.equal(many.every(q => Math.abs(S.autoAt(A0, q[0]) - q[1]) <= 2e-3 + 1e-9), true, 'every point within the thinning');
  const zz = Array.from({ length: 25000 }, (_, i) => [i * 10, 5 + 3 * Math.sin(i * 0.7) + (i % 2) * 0.01]), z = S.normAuto({ 'i1:cf': { pts: zz } })['i1:cf'].pts;
  assert.deepEqual([z.length <= 20000, z[0][0], z[z.length - 1][0]], [true, 0, 249990], 'a busy curve: thinned to the cap, its end kept');
  const hz = Array.from({ length: 79000 }, (_, i) => [i, i & 1]), t0 = performance.now(), h = S.normAuto({ 'i1:cf': { pts: hz } })['i1:cf'].pts, ms = performance.now() - t0;
  assert.deepEqual([h.length <= 20000, h[h.length - 1][0], ms < 3000], [true, 78999, true], 'a hostile zigzag: bounded (' + Math.round(ms) + ' ms), its end kept');
  assert.deepEqual(S.normAuto(a), a);
  const k = {}; for (let i = 0; i < 5000; i++) k['i' + i + ':cf'] = { pts: [[0, 1]] };
  assert.equal(Object.keys(S.normAuto(k)).length, 4096, 'a safety bound on keys');
  const p = S.deserialize(J({ tracks: [{ id: 'trk_1', auto: { 'i1:cf': { pts: Array.from({ length: 12000 }, (_, i) => [i * 2, i % 2]) } } }] }));
  S.pasteRange(p, S.copyRange(p, 0, 24000), 1, { insert: true });
  const pc = p.tracks[0].auto['i1:cf'].pts;
  assert.deepEqual([pc.length <= 20000, pc[pc.length - 1][0]], [true, 24000 + 23998], 'a range op keeps the cap, the end kept');
  CASES += 3;
});

const HKEYS = ['i1:cf', 'fx1:fx.2.mix', 'i1:k3u', 'mix:vol', 'mix:pan', 'mix:foo', 'mfx:fx.rev.mix', 'bad', '1x:y', 'i1:', ':cf', 'I1:cf', 'a:b c', 'constructor', 'toString', 'hasownproperty:x', 'out:x'];
const ATOMS = [0, -0, 1.5, -3, 0.1234567891, NaN, Infinity, -Infinity, 1e308, -1e308, 5e-7, 2 ** 31, MAXT + 5, -1, 'x', '12', true, false, null, undefined, 12.5, 1.25, 7];
function junk(rng, d = 0) {
  const r = rng();
  if (d > 3 || r < 0.35) return pick(rng, ATOMS);
  if (r < 0.75) return Array.from({ length: ri(rng, 0, 6) }, () => (rng() < 0.5 ? [pick(rng, ATOMS), pick(rng, ATOMS)] : junk(rng, d + 1)));
  const o = {}; for (let i = ri(rng, 0, 4); i > 0; i--) o[rng() < 0.6 ? 'pts' : pick(rng, HKEYS)] = junk(rng, d + 1); return o;
}
function hostile(rng) {
  const r = rng();
  if (r < 0.1) return junk(rng);
  const a = {};
  for (let i = ri(rng, 0, 6); i > 0; i--) {
    const k = pick(rng, HKEYS), e = rng() < 0.15 ? junk(rng) : { pts: rng() < 0.2 ? junk(rng) : Array.from({ length: ri(rng, 0, 30) }, () => (rng() < 0.85 ? [rng() < 0.8 ? ri(rng, -5, 3000) + (rng() < 0.2 ? rng() : 0) : pick(rng, ATOMS), rng() < 0.8 ? rng() * 3 - 1 : pick(rng, ATOMS), 9] : junk(rng, 2))) };
    if (rng() < 0.2 && e && Array.isArray(e.pts)) e.pts.push(e.pts); // a cycle
    if (rng() < 0.1 && e && typeof e === 'object') e.self = a;
    a[k] = e;
  }
  if (rng() < 0.1) a.self = a;
  return a;
}
test('G2 §2.1 normAuto (4 000 hostile cases): never throws; a fixed point; plain data; mfx: / unknown mix: / non-MDST keys dropped; ticks integer 0…MAXT, unique, sorted (the last wins at a tick); values finite, 1e-6 absolute (the range rounding is the host\'s), mix:vol 0…1.25, mix:pan −1…1; no empty key; nothing valid → undefined', () => {
  const rng = S.mulberry32(0x40A0), MD = /^[a-z][a-z0-9]{0,15}:[A-Za-z][\w.]{0,47}$/;
  for (let c = 0; c < 4000; c++, CASES++) {
    const a = hostile(rng), what = 'case ' + c;
    let o;
    assert.doesNotThrow(() => { o = S.normAuto(a); }, what);
    if (o === undefined) continue;
    assert.ok(o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length > 0, what + ': an object with keys');
    assert.equal(J(JSON.parse(J(o))), J(o), what + ': plain data');
    assert.deepEqual(S.normAuto(o), o, what + ': a fixed point');
    assert.deepEqual(S.normAuto(JSON.parse(J(o))), o, what + ': through JSON');
    for (const k of Object.keys(o)) {
      assert.ok(MD.test(k) && !k.startsWith('mfx:') && (!k.startsWith('mix:') || k === 'mix:vol' || k === 'mix:pan'), what + ': key ' + k);
      assert.ok(Object.keys(o[k]).every((x, i, A) => ['pts', 'n', 'r'].includes(x) && A.indexOf(x) === i) && Object.keys(o[k])[0] === 'pts', what + ': pts (then n / r only)');
      if ('n' in o[k]) assert.ok(typeof o[k].n === 'string' && o[k].n.length > 0 && o[k].n.length <= 64, what + ': n');
      if ('r' in o[k]) assert.ok(Array.isArray(o[k].r) && o[k].r.length === 2 && o[k].r.every(Number.isFinite) && o[k].r[0] < o[k].r[1], what + ': r');
      const pts = o[k].pts, [lo, hi] = k === 'mix:vol' ? [0, 1.25] : k === 'mix:pan' ? [-1, 1] : [-1e6, 1e6];
      wellFormed(pts, what + ' ' + k);
      assert.ok(pts.length > 0 && pts.every(q => q[1] >= lo && q[1] <= hi && r6(q[1]) === q[1] && !Object.is(q[1], -0) && !Object.is(q[0], -0)), what + ' ' + k + ': values');
    }
  }
  for (const x of [undefined, null, 3, 'x', [], [[0, 1]], {}, { 'i1:cf': [[0, 1]] }, { 'i1:cf': { pts: [] } }, { 'mfx:fx.a.b': { pts: [[0, 1]] } }]) assert.equal(S.normAuto(x), undefined, J(x));
  assert.equal(S.normAuto(JSON.parse('{"__proto__": {"pts": [[0, 1]]}}')), undefined, 'an own __proto__ key: dropped');
  assert.deepEqual(S.normAuto({ 'i1:cf': { pts: [[5, 1], [3, 2], [5, 3], [4.6, 4], [-2, 5]] } }), { 'i1:cf': { pts: [[0, 5], [3, 2], [5, 4]] } }, 'sorted, the last wins at a tick (4.6 rounds to 5)');
  assert.deepEqual(S.normAuto({ 'mix:vol': { pts: [[0, 2], [1, -1]] }, 'mix:pan': { pts: [[0, -3]] }, 'i1:cf': { pts: [[0, 0.12345678]] } }), { 'mix:vol': { pts: [[0, 1.25], [1, 0]] }, 'mix:pan': { pts: [[0, -1]] }, 'i1:cf': { pts: [[0, 0.123457]] } });
});

test('G2: at least 20 000 property cases ran', () => {
  assert.ok(CASES >= 20000, 'cases: ' + CASES);
});
