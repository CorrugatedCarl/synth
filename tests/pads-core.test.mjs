import './v8-guard.mjs';
// pads-core.js (IMPL-8 §7.4, §15.6; lane K): the pad controller's pure model — normPads (idempotent, every bound, hostile input:
// wrong types, 9 modules, 70 pads, 5 targets, duplicate hardware bindings, unknown fields, throwing getters; never throws), the
// footprints of §1.3 on the dots, padAt (cells, gaps, hidden rows; through screen px at three zooms), the numbering (pad 1
// bottom-left), chordNotes (every quality × inversion × spread × octave; the range edges), the velocity laws (= cv-drum padVel;
// fixed; a pad's own v wins), modValue (every mode × press / pressure / release; toggles), resolve (a missing track, a Replace,
// a machine without the sound, an unmapped sound → nothing and a warning; notes shared by targets once), defaultsFor (808 / 606
// / 909 / SDS-V / a synth, the orders passed top row first), fill, bindOf / rebind (moves, never duplicates), echo('gen').
// Pure: no DOM; only numbers / strings / plain records go into assert.
// Run alone: node --max-old-space-size=2048 --test tests/pads-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../pads-core.js?v=9';
import * as DC from '../drum-core.js?v=9';
import * as CD from '../cv-drum.js?v=9';
import * as K from '../cv-keys.js?v=9';
import { BAR_H } from '../cv-module.js?v=9';

const range = n => Array.from({ length: n }, (_, i) => i);
const M44 = () => P.newModule('pd1');
// a project: an 808, a Juno, a 606, a 909, a track without instrument; the 808's record by drum-core
const dev = (model, more) => Object.assign({ kind: 'synth', model }, more || {});
function project() {
  return { tracks: [
    { id: 'trk_1', name: 'Drums', prim: 'i1', dev: { i1: dev('tr808', { drum: DC.normDrum(undefined) }), o1: { kind: 'out' } } },
    { id: 'trk_2', name: 'Juno', prim: 'i1', dev: { i1: dev('juno60') } },
    { id: 'trk_3', name: 'Six', prim: 'i1', dev: { i1: dev('tr606', { drum: DC.normDrum(undefined, 'tr606') }) } },
    { id: 'trk_4', name: 'Nine', prim: 'i1', dev: { i1: dev('tr909', { drum: DC.normDrum(undefined, 'tr909') }) } },
    { id: 'trk_5', name: '', dev: {} },
  ] };
}

/* ---------------------------------------------------------------- normPads */
test('normPads: anything not an array → []; a module → every field at its default; ids pd1…pd8 (a bad / duplicate id the lowest free); ≤ 8 modules', () => {
  for (const x of [undefined, null, 0, 'pads', {}, { length: 3 }, true]) assert.deepEqual(P.normPads(x), []);
  const [M] = P.normPads([{}]);
  assert.deepEqual(Object.keys(M), ['id', 'name', 'rows', 'cols', 'size', 'vel', 'fv', 'light', 'shape', 'out', 'pads']);
  assert.deepEqual([M.id, M.name, M.rows, M.cols, M.size, M.vel, M.fv, M.light, M.shape, M.out], ['pd1', 'Pads 1', 4, 4, 1, 'pos', 100, 'both', 'sq', { prof: 'off', port: '' }]);
  assert.deepEqual([M.pads.length, M.pads.every(p => p === null)], [64, true]);
  const nine = P.normPads(range(9).map(i => ({ id: 'pd' + (i + 1), name: 'M' + i })));
  assert.deepEqual(nine.map(m => m.id), ['pd1', 'pd2', 'pd3', 'pd4', 'pd5', 'pd6', 'pd7', 'pd8'], '9 modules: the first 8');
  const ids = P.normPads([{ id: 'pd3' }, { id: 'pd3' }, { id: 'pd9' }, { id: 'x' }, 7, null, [], { id: 'pd1' }, { id: 'PD2' }]);
  assert.deepEqual(ids.map(m => m.id), ['pd3', 'pd2', 'pd4', 'pd5', 'pd1', 'pd6'], 'valid unique ids kept; others the lowest free; non-objects dropped');
  assert.deepEqual(ids.map(m => m.name), ['Pads 3', 'Pads 2', 'Pads 4', 'Pads 5', 'Pads 1', 'Pads 6']);
  assert.equal(P.freeId(ids), 'pd7');
  assert.equal(P.freeId(nine), null);
  assert.deepEqual([P.newModule('pd4').id, P.newModule('pd4').name, P.newModule('bad').id], ['pd4', 'Pads 4', 'pd1']);
});

test('normPads: every module field bounded (rows / cols 1–8, size 0–2, fv 1–127, the enums, name ≤ 24, port ≤ 64), unknown fields dropped', () => {
  const [M] = P.normPads([{ id: 'pd2', name: 'x'.repeat(40), rows: 12, cols: 0, size: 7, vel: 'loud', fv: 300, light: 'on', shape: 'tri', out: { prof: 'apc', port: 'p'.repeat(90), x: 1 }, extra: 5, pads: 'no' }]);
  assert.deepEqual([M.name.length, M.rows, M.cols, M.size, M.vel, M.fv, M.light, M.shape, M.out.prof, M.out.port.length, 'extra' in M, Object.keys(M.out).join()],
    [24, 8, 1, 2, 'pos', 127, 'both', 'sq', 'off', 64, false, 'prof,port']);
  const [N] = P.normPads([{ id: 'pd1', name: '', rows: 2.6, cols: -3, size: -1, vel: 'fixed', fv: 0.2, light: 'follow', shape: 'hex', out: { prof: 'gen', port: 5 } }]);
  assert.deepEqual([N.name, N.rows, N.cols, N.size, N.vel, N.fv, N.light, N.shape, N.out], ['Pads 1', 3, 1, 0, 'fixed', 1, 'follow', 'hex', { prof: 'gen', port: '' }]);
  const [S] = P.normPads([{ rows: '4', cols: NaN, size: Infinity, fv: '90' }]);
  assert.deepEqual([S.rows, S.cols, S.size, S.fv], [4, 4, 1, 100], 'non-numbers: the defaults');
});

test('normPads: pads — exactly 64 (70 → 64, a short list padded with null), each record bounded: colour 0–15 (default by its first target), label ≤ 12, ≤ 4 valid targets, mod, v, latch, hw', () => {
  const tg = { k: 'note', tr: 'trk_2', n: 60 };
  const raw = range(70).map(i => (i % 2 ? null : { t: [tg] }));
  const [M] = P.normPads([{ pads: raw }]);
  assert.equal(M.pads.length, 64);
  assert.deepEqual(M.pads.filter(Boolean).length, 32);
  const [S] = P.normPads([{ pads: [{ t: [tg] }] }]);
  assert.deepEqual([S.pads.length, S.pads.slice(1).every(p => p === null)], [64, true]);
  const p = P.normPad({ c: 3, l: 'Kick drum long name', t: [tg, tg, tg, tg, tg], mod: { m: 'gate', lo: -1, hi: 2, z: 1 }, v: 300, latch: 1, hw: { port: 'MPC', ch: 10, n: 36, cc: 0, z: 1 }, junk: 1 });
  assert.deepEqual(Object.keys(p), ['c', 'l', 't', 'mod', 'v', 'latch', 'hw']);
  assert.deepEqual([p.c, p.l, p.t.length, p.mod, p.v, p.latch, p.hw], [3, 'Kick drum lo', 4, { m: 'gate', lo: 0, hi: 1 }, 127, 1, { port: 'MPC', ch: 10, n: 36, cc: 0 }], '5 targets → 4');
  const q = P.normPad({ c: 16, l: 5, t: 'x', mod: { m: 'wobble', lo: 0.7, hi: 0.2 }, v: 0, latch: 2, hw: { ch: 0, n: 36 } });
  assert.deepEqual([q.c, q.l, q.t, q.mod, q.v, q.latch, q.hw], [P.C_TEAL, '', [], { m: 'vel', lo: 0.7, hi: 0.2 }, null, 0, null], 'mod-only: teal; an inverted range kept');
  for (const hw of [{ ch: 17, n: 1 }, { ch: 1, n: 128 }, { ch: 1.5, n: 3 }, { ch: '1', n: 3 }, 'x']) assert.equal(P.normPad({ hw }).hw, null, JSON.stringify(hw));
  assert.deepEqual(P.normPad({ hw: { port: 7, ch: 16, n: 0, cc: true } }).hw, { port: '', ch: 16, n: 0, cc: 1 });
  assert.deepEqual([P.normPad(5), P.normPad('x'), P.normPad([]), P.normPad({}).c], [null, null, null, P.C_GREY]);
  assert.deepEqual([P.normPad({ v: 64.4 }).v, P.normPad({ v: 0.9 }).v, P.normPad({ v: '64' }).v], [64, null, null]);
});

test('normPads: targets — the four shapes (fields bounded and ordered), invalid ones dropped (track id, kind, note, sound key, empty list)', () => {
  const T = ts => P.normPad({ t: ts }).t;
  assert.deepEqual(T([{ k: 'note', tr: 'trk_1', n: 200.4, x: 1 }, { k: 'note', tr: 'trk_1', n: -3 }, { k: 'note', tr: 'trk_1', n: 'C' }]),
    [{ k: 'note', tr: 'trk_1', n: 127 }, { k: 'note', tr: 'trk_1', n: 0 }]);
  assert.deepEqual(T([{ k: 'chord', tr: 'trk_2', root: 60, q: 'm7', inv: 9, oct: -5, spread: 'open', y: 2 }, { k: 'chord', tr: 'trk_2', root: 61, q: 'toString' }]),
    [{ k: 'chord', tr: 'trk_2', root: 60, q: 'm7', inv: 3, oct: -2, spread: 'open' }, { k: 'chord', tr: 'trk_2', root: 61, q: 'maj', inv: 0, oct: 0, spread: 'close' }]);
  assert.deepEqual(T([{ k: 'notes', tr: 'trk_2', ns: [64, 60, 60, 300, 'x', 61, 62, 63, 65, 66, 67, 68] }]), [{ k: 'notes', tr: 'trk_2', ns: [60, 61, 62, 63, 64, 65, 66, 127] }], 'unique, ≤ 8, sorted');
  assert.deepEqual(T([{ k: 'drum', tr: 'trk_1', s: 'bd' }, { k: 'drum', tr: 'trk_1', s: 'BD' }, { k: 'drum', tr: 'trk_1', s: 'bdx' }, { k: 'drum', tr: 'trk_1' }]), [{ k: 'drum', tr: 'trk_1', s: 'bd' }]);
  assert.deepEqual(T([{ k: 'note', tr: '__proto__', n: 1 }, { k: 'note', tr: 'a b', n: 1 }, { k: 'note', tr: 'x'.repeat(65), n: 1 }, { k: 'note', n: 1 }, { k: 'clip', tr: 'trk_1' },
    { k: 'notes', tr: 'trk_1', ns: [] }, { k: 'notes', tr: 'trk_1' }, null, 5]), [], 'bad tracks, unknown kinds, empty lists');
  assert.deepEqual(T([{ k: 'note', tr: 'trk_9', n: 5 }]), [{ k: 'note', tr: 'trk_9', n: 5 }], 'a track that does not exist: kept (Undo may bring it back)');
});

test('normPads: a hardware binding unique across the project — later duplicates (module, then slot order) dropped; another port or ch / n / cc is another binding', () => {
  const hw = (port, ch, n, cc) => ({ hw: { port, ch, n, cc } });
  const pads = P.normPads([
    { id: 'pd2', pads: [hw('A', 10, 36, 0), hw('A', 10, 36, 0), hw('B', 10, 36, 0), hw('A', 10, 36, 1), hw('A', 9, 36, 0), hw('', 10, 36, 0)] },
    { id: 'pd1', pads: [null, null, null, null, null, null, hw('A', 10, 36, 0), hw('B', 10, 37, 0)] },
  ]);
  assert.deepEqual(pads[0].pads.slice(0, 6).map(p => (p.hw ? [p.hw.port, p.hw.ch, p.hw.n, p.hw.cc].join() : null)), ['A,10,36,0', null, 'B,10,36,0', 'A,10,36,1', 'A,9,36,0', ',10,36,0']);
  assert.deepEqual([pads[1].pads[6].hw, pads[1].pads[7].hw], [null, { port: 'B', ch: 10, n: 37, cc: 0 }], 'the second module\'s duplicate dropped (its pad kept)');
});

test('normPads: idempotent over hostile and random input; never throws (getters that throw, a revoked proxy, cycles, huge arrays)', () => {
  const bad = { get id() { throw new Error('x'); }, pads: [{ get t() { throw new Error('y'); } }] };
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const cyc = { id: 'pd1' }; cyc.pads = [cyc]; cyc.out = cyc;
  const big = new Array(1e5).fill(3); big.push({ id: 'pd5' });
  const throwsArr = new Proxy([], { get(t, k) { if (k === 'length') return 3; throw new Error('z'); } });
  const inputs = [[bad], [revoked.proxy, { id: 'pd2' }], [cyc], big, throwsArr, [{ pads: throwsArr }], [{ pads: [{ t: throwsArr, hw: revoked.proxy, mod: revoked.proxy }] }]];
  for (const x of inputs) {
    let a;
    assert.doesNotThrow(() => { a = P.normPads(x); });
    assert.ok(Array.isArray(a));
    assert.deepEqual(P.normPads(JSON.parse(JSON.stringify(a))), a, 'idempotent');
  }
  assert.deepEqual(P.normPads([bad]).map(m => m.id), ['pd1']);
  assert.deepEqual(P.normPads([cyc])[0].pads[0].t, [], 'a cycle: a plain pad');
  assert.deepEqual(P.normPads(big).map(m => m.id), ['pd5']);
  // random records: idempotent, JSON-stable, every bound
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const junk = () => pick([undefined, null, -1, 0, 0.5, 1, 3, 8, 9, 127, 128, 1e9, NaN, 'x', 'pd1', true, [], {}]);
  const target = () => ({ k: pick(['note', 'chord', 'notes', 'drum', 'x']), tr: pick(['trk_1', 'trk_2', '', 5, 'a b']), n: junk(), root: junk(), q: pick(['m7', 'dim', 'zz', 7, '5']),
    inv: junk(), oct: junk(), spread: pick(['open', 'close', 1]), ns: pick([[60, 64], [junk(), junk()], 'x']), s: pick(['bd', 'rd', 'xx', 'ac', 'B']) });
  for (let r = 0; r < 300; r++) {
    const x = range(Math.floor(rnd() * 11)).map(() => (rnd() < 0.1 ? junk() : { id: pick(['pd1', 'pd2', 'pd8', 'pd9', junk()]), name: pick(['', 'Kit', junk()]), rows: junk(), cols: junk(), size: junk(),
      vel: pick(['pos', 'fixed', junk()]), fv: junk(), light: pick(['hit', 'x']), shape: pick(['hex', junk()]), out: pick([{ prof: 'gen', port: 'A' }, junk()]),
      pads: range(Math.floor(rnd() * 70)).map(() => (rnd() < 0.3 ? junk() : { c: junk(), l: pick(['', 'Snare', junk()]), t: range(Math.floor(rnd() * 6)).map(target),
        mod: pick([null, { m: pick(MODES), lo: junk(), hi: junk() }, junk()]), v: junk(), latch: junk(), hw: pick([null, { port: pick(['A', '']), ch: pick([1, 10, 17]), n: pick([36, 37]), cc: pick([0, 1]) }]) })) }));
    const a = P.normPads(x), b = P.normPads(a);
    assert.deepEqual(b, a, 'idempotent, run ' + r);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), a, 'JSON-stable, run ' + r);
    assert.ok(a.length <= 8 && new Set(a.map(m => m.id)).size === a.length && a.every(m => P.PAD_ID.test(m.id)));
    const keys = new Set();
    for (const m of a) {
      assert.ok(m.rows >= 1 && m.rows <= 8 && m.cols >= 1 && m.cols <= 8 && [0, 1, 2].includes(m.size) && m.fv >= 1 && m.fv <= 127 && m.pads.length === 64);
      for (const p of m.pads) {
        if (p === null) continue;
        assert.ok(Number.isInteger(p.c) && p.c >= 0 && p.c < 16 && p.l.length <= 12 && p.t.length <= 4 && (p.v === null || (p.v >= 1 && p.v <= 127)) && (p.latch === 0 || p.latch === 1));
        for (const t of p.t) assert.ok(['note', 'chord', 'notes', 'drum'].includes(t.k) && P.validId(t.tr));
        if (p.mod) assert.ok(MODES.includes(p.mod.m) && p.mod.lo >= 0 && p.mod.lo <= 1 && p.mod.hi >= 0 && p.mod.hi <= 1);
        if (p.hw) { const k = [p.hw.port, p.hw.ch, p.hw.n, p.hw.cc].join(); assert.ok(!keys.has(k), 'binding unique'); keys.add(k); }
      }
    }
  }
});
const MODES = ['gate', 'vel', 'press', 'tog'];

/* ---------------------------------------------------------------- geometry and numbering */
test('footprint (§1.3): ceil32 of the padding, pads, gaps (+ the bar and footer) — 4 × 4 M 352 × 416, 8 × 8 M 672 × 736, 8 × 8 L 864 × 928, 1 × 1 S 96 × 160; the grid centred under the bar', () => {
  const f = (r, c, s) => { const F = P.footprint(r, c, s); return [F.w, F.h]; };
  assert.deepEqual([f(4, 4, 1), f(8, 8, 1), f(8, 8, 2), f(1, 1, 0)], [[352, 416], [672, 736], [864, 928], [96, 160]]);
  assert.deepEqual([P.PAD_PX.join(), P.GAP, P.PADDING, P.FOOTER, P.BAR_H], ['56,72,96', 8, 16, 32, BAR_H], 'BAR_H = cv-module\'s');
  for (let r = 1; r <= 8; r++) for (let c = 1; c <= 8; c++) for (const s of [0, 1, 2]) {
    const F = P.footprint(r, c, s), G = P.gridOf(r, c, s);
    assert.ok(F.w % 32 === 0 && F.h % 32 === 0 && F.w >= 2 * 16 + G.w && F.h >= 40 + 32 + G.h + 32, `${r}×${c} ${s}`);
    assert.ok(Math.abs(F.gx - (F.w - G.w - F.gx)) <= 1 && F.gy === 56 && F.fy === F.h - 32 && F.gy + G.h + 16 <= F.fy);
  }
  assert.deepEqual(P.gridOf(4, 4, 1), { rows: 4, cols: 4, size: 1, P: 72, gap: 8, w: 312, h: 312 });
  assert.deepEqual(P.gridOf(99, -1, 'L'), { rows: 8, cols: 1, size: 1, P: 72, gap: 8, w: 72, h: 632 });
});

test('the numbering (§1.3): slot r · 8 + c from the bottom row; pad 1 bottom-left, left → right then up; hidden slots no number', () => {
  const M = M44();
  assert.deepEqual([P.padNo(M, 0), P.padNo(M, 3), P.padNo(M, 8), P.padNo(M, 27), P.padNo(M, 4), P.padNo(M, 32), P.padNo(M, 64)], [1, 4, 5, 16, 0, 0, 0]);
  const W = Object.assign({}, M, { rows: 2, cols: 8 });
  assert.deepEqual([P.padNo(W, 7), P.padNo(W, 8), P.padNo(W, 15), P.padNo(W, 16)], [8, 9, 16, 0]);
  for (const X of [M, W, Object.assign({}, M, { rows: 8, cols: 8 }), Object.assign({}, M, { rows: 1, cols: 5 })]) {
    const sl = P.visibleSlots(X);
    assert.deepEqual(sl.map(i => P.padNo(X, i)), range(X.rows * X.cols).map(k => k + 1), 'visibleSlots in numbering order');
    assert.deepEqual(sl.map(i => P.slotOfNo(X, P.padNo(X, i))), sl);
  }
  assert.deepEqual([P.slotOfNo(M, 0), P.slotOfNo(M, 17), P.slotOfNo(M, 1.5)], [-1, -1, -1]);
  assert.deepEqual([P.rcOf(27), P.slotOf(3, 3)], [{ r: 3, c: 3 }, 27]);
});

test('padAt (§1.3, §2.1): every point of grids 1 × 1 … 8 × 8 at S / M / L — a pad cell → its slot (bottom row = r 0) and f from its top; a gap or outside → null; never a hidden slot; through screen px at s 0.5 / 1 / 2', () => {
  let pts = 0;
  for (const [r, c, s] of [[1, 1, 0], [4, 4, 1], [3, 5, 2], [8, 8, 1], [2, 7, 0]]) {
    const G = P.gridOf(r, c, s), M = { rows: r, cols: c }, step = G.P + 8;
    for (let y = -3; y < G.h + 3; y += 2.5) for (let x = -3; x < G.w + 3; x += 2.5) {
      pts++;
      const h = P.padAt(G, x, y), inX = x >= 0 && x < G.w && x % step < G.P, inY = y >= 0 && y < G.h && y % step < G.P;
      if (!(inX && inY)) { assert.equal(h, null, `${r}×${c} (${x}, ${y})`); continue; }
      const cc = Math.floor(x / step), rr = r - 1 - Math.floor(y / step);
      assert.deepEqual([h.i, h.r, h.c], [rr * 8 + cc, rr, cc], `${r}×${c} (${x}, ${y})`);
      assert.ok(P.visible(M, h.i) && Math.abs(h.f - (y % step) / G.P) < 1e-12 && h.f >= 0 && h.f < 1);
      const R = P.padRect(G, h.i);
      assert.ok(x >= R.x && x < R.x + R.w && y >= R.y && y < R.y + R.h, 'padRect holds the point');
    }
  }
  assert.ok(pts > 10000);
  const G = P.gridOf(4, 4, 1);
  assert.deepEqual([P.padAt(G, 0, 240), P.padAt(G, 72, 300), P.padAt(G, 312, 10), P.padAt(G, 10, 312), P.padAt(G, NaN, 1)], [{ i: 0, r: 0, c: 0, f: 0 }, null, null, null, null], 'the bottom-left pad\'s top edge; a gap; outside');
  assert.deepEqual([P.padAt(G, 0, 311).i, P.padAt(G, 311, 0).i, P.padRect(G, 4), P.padRect(G, 32)], [0, 27, null, null], 'hidden slots have no box');
  // the bed's frame: screen px / s → the same pad at every zoom (the grid element at (100, 50))
  const hit = P.padHit(G, M44());
  for (const s of [0.5, 1, 2]) for (const [wx, wy, want] of [[36, 300, 0], [120, 230, 9], [300, 2, 27], [76, 100, null]]) {
    const sx = 100 + wx * s, sy = 50 + wy * s, h = hit((sx - 100) / s, (sy - 50) / s, s);
    assert.equal(h ? h.note : null, want, `s ${s} (${wx}, ${wy})`);
  }
});

/* ---------------------------------------------------------------- velocity */
test('velocity (§2.2): padVel = cv-drum padVel (the 1i curve, = cv-keys KEY_VEL); hitVel — the pad\'s own v wins for every source; hardware as sent; the module\'s fixed fv; a key 100 / 127; a pointer by height', () => {
  assert.deepEqual([K.KEY_VEL.lo, K.KEY_VEL.span, CD.KEY_PAD_V, P.CHROM_FROM], [0.3, 0.75, P.KEY_PAD_V, 48]);
  for (const f of [-1, 0, 0.1, 0.33, 0.5, 0.9, 0.93, 1, 2, NaN, undefined]) assert.equal(P.padVel(f), CD.padVel(f), 'f ' + f);
  assert.deepEqual([P.padVel(0), P.padVel(1), P.padVel(0.5)], [0.3, 1, 0.675]);
  const M = M44(), F = Object.assign({}, M, { vel: 'fixed', fv: 64 }), pad = { v: 20 };
  assert.deepEqual([P.hitVel(M, null, { f: 0.5 }), P.hitVel(M, null, { key: true }), P.hitVel(M, null, { hw: 90 }), P.hitVel(M, {}, { hw: 300 })], [0.675, 100 / 127, 90 / 127, 1]);
  assert.deepEqual([P.hitVel(F, null, { f: 0 }), P.hitVel(F, null, { key: true }), P.hitVel(F, null, { hw: 90 })], [64 / 127, 64 / 127, 90 / 127], 'fixed: canvas and keys; hardware as sent');
  assert.deepEqual([P.hitVel(M, pad, { f: 1 }), P.hitVel(F, pad, { key: true }), P.hitVel(F, pad, { hw: 127 })], [20 / 127, 20 / 127, 20 / 127], 'the pad\'s own v wins');
  assert.deepEqual([P.hitVel(null, null, null), P.hitVel(undefined, { v: null }, { f: 0 })], [1, 0.3]);
  // the bed's hit: the module's rule and the pad's v, live through a getter
  const G = P.gridOf(4, 4, 1);
  let cur = M44();
  cur.pads[0] = P.normPad({ v: 33 });
  const hit = P.padHit(G, () => cur);
  assert.deepEqual([hit(10, 240 + 36, 1), hit(90, 240, 1)], [{ note: 0, v: 33 / 127 }, { note: 1, v: 0.3 }]);
  cur = Object.assign({}, cur, { vel: 'fixed', fv: 127 });
  assert.deepEqual(hit(90, 240, 1), { note: 1, v: 1 }, 'an edit applies at the next hit');
});

/* ---------------------------------------------------------------- chords and targets */
test('chordNotes (§3.2): every quality × inversion × spread × octave — the quality\'s pitch classes, sorted, unique, inverted from the bottom, open = the third an octave up; the range edges dropped', () => {
  const pcs = a => [...new Set(a.map(n => n % 12))].sort((x, y) => x - y);
  assert.deepEqual(P.Q_ORDER.slice().sort(), Object.keys(P.QUALITIES).sort());
  for (const q of P.Q_ORDER) for (let inv = 0; inv <= 3; inv++) for (const spread of ['close', 'open']) for (let oct = -2; oct <= 2; oct++) {
    const root = 60, ns = P.chordNotes({ k: 'chord', root, q, inv, oct, spread }), iv = P.QUALITIES[q], m = `${q} inv ${inv} ${spread} oct ${oct}`;
    assert.deepEqual(pcs(ns), pcs(iv.map(d => root + d)), m + ': its pitch classes');
    assert.equal(ns.length, iv.length, m);
    assert.ok(ns.every((n, i) => i === 0 || n > ns[i - 1]), m + ': sorted unique');
    const base = root + 12 * oct;
    const inv1 = Math.min(inv, iv.length - 1);
    if (spread === 'close') {
      // the lowest note: the inv1-th chord tone (close voicing; add9's ninth sits above the octave: its cases below)
      if (iv.every(d => d < 12)) assert.equal(ns[0], iv[inv1] + base, m + ': the bass');
      assert.ok(ns.at(-1) - ns[0] < 24, m + ': close');
    } else if (iv.length >= 3) assert.ok(ns.includes(base + iv[1] + 12) || ns.includes(base + iv[1] + 24), m + ': the third raised');
  }
  assert.deepEqual(P.chordNotes({ root: 60, q: 'maj' }), [60, 64, 67]);
  assert.deepEqual(P.chordNotes({ root: 60, q: 'maj', inv: 1 }), [64, 67, 72]);
  assert.deepEqual(P.chordNotes({ root: 60, q: 'maj', inv: 2 }), [67, 72, 76]);
  assert.deepEqual(P.chordNotes({ root: 60, q: 'maj', inv: 3 }), [67, 72, 76], 'past the triad: its last inversion');
  assert.deepEqual(P.chordNotes({ root: 60, q: 'maj', spread: 'open' }), [60, 67, 76]);
  assert.deepEqual(P.chordNotes({ root: 57, q: 'm7', oct: -1 }), [45, 48, 52, 55]);
  assert.deepEqual(P.chordNotes({ root: 48, q: '5' }), [48, 55]);
  assert.deepEqual(P.chordNotes({ root: 60, q: 'add9', spread: 'open', inv: 1 }), [67, 72, 74, 76]);
  assert.deepEqual(P.chordNotes({ root: 120, q: 'maj7' }), [120, 124, 127], 'the top edge: notes past 127 dropped');
  assert.deepEqual(P.chordNotes({ root: 2, q: 'min', oct: -2 }), [], 'below 0: none');
  assert.deepEqual(P.chordNotes({ root: 22, q: 'dim7', oct: -2 }), [1, 4, 7], 'the bottom edge: −2 dropped');
  assert.deepEqual(P.chordNotes({ root: 60, q: 'nope' }), [60, 64, 67], 'an unknown quality: maj');
  assert.deepEqual([P.chordNotes(null), P.targetNotes({ k: 'drum', s: 'bd' }), P.targetNotes({ k: 'note', n: 61 }), P.targetNotes({ k: 'notes', ns: [3, 1, 3] })], [[], [], [61], [1, 3]]);
});

test('labels (§3.1): its own l, else its first target ("Kick" by the track\'s machine, "C3", "Cm7", "C3 +2"), "Mod", ""; isOff', () => {
  const p = project(), L = (pad) => P.padLabel(P.normPad(pad), p);
  assert.deepEqual([L({ l: 'Boom', t: [{ k: 'note', tr: 'trk_2', n: 48 }] }), L({ t: [{ k: 'note', tr: 'trk_2', n: 48 }] }), L({ t: [{ k: 'chord', tr: 'trk_2', root: 60, q: 'm7' }] }),
    L({ t: [{ k: 'chord', tr: 'trk_2', root: 61, q: 'maj' }] }), L({ t: [{ k: 'notes', tr: 'trk_2', ns: [60, 64, 67] }] }), L({ mod: { m: 'gate' } }), L({})],
  ['Boom', 'C3', 'Cm7', 'C#', 'C4 +2', 'Mod', '']);
  assert.deepEqual([L({ t: [{ k: 'drum', tr: 'trk_1', s: 'bd' }] }), L({ t: [{ k: 'drum', tr: 'trk_4', s: 'rd' }] }), L({ t: [{ k: 'drum', tr: 'trk_9', s: 'cr' }] }), L({ t: [{ k: 'drum', tr: 'trk_2', s: 'ch' }] })],
    ['Kick', 'Ride', 'Crash', 'Closed hat'], 'by the machine; a gone track or a synth: the sound\'s name anywhere');
  assert.deepEqual([P.isOff(null), P.isOff(P.normPad({})), P.isOff(P.normPad({ mod: {} })), P.isOff(P.normPad({ t: [{ k: 'note', tr: 'x', n: 1 }] }))], [true, true, false, false]);
  assert.deepEqual([P.noteName(48), P.noteName(60), P.noteName(0), P.noteName(127)], [K.noteName(48), 'C4', 'C-1', 'G9']);
});

test('resolve (§3.3, §4.1): per target track its notes (sorted, a note two targets share once), at for note / chord targets; a missing track, a Replace, a machine without the sound, an unmapped sound → nothing and a warning', () => {
  const p = project(), R = pad => P.resolve(P.normPad(pad), p);
  const T = (k, tr, more) => Object.assign({ k, tr }, more);
  assert.deepEqual(R({ t: [T('drum', 'trk_1', { s: 'bd' })] }), { hits: [{ tr: 'trk_1', ns: [36], at: false }], warn: [] }, 'the 808\'s kick: its primary 36');
  assert.deepEqual(R({ t: [T('drum', 'trk_1', { s: 'bd' }), T('note', 'trk_2', { n: 40 }), T('chord', 'trk_2', { root: 36, q: 'maj' }), T('note', 'trk_1', { n: 36 })] }),
    { hits: [{ tr: 'trk_1', ns: [36], at: true }, { tr: 'trk_2', ns: [36, 40, 43], at: true }], warn: [] }, 'layers: per track, shared notes once');
  assert.deepEqual(R({ t: [T('drum', 'trk_4', { s: 'rd' }), T('drum', 'trk_4', { s: 'cr' }), T('drum', 'trk_3', { s: 'ch' })] }).hits,
    [{ tr: 'trk_4', ns: [49, 51], at: false }, { tr: 'trk_3', ns: [42], at: false }], 'the 909\'s ride / crash, the 606\'s closed hat');
  const w = R({ t: [T('note', 'trk_9', { n: 60 }), T('drum', 'trk_3', { s: 'mt' }), T('drum', 'trk_2', { s: 'bd' }), T('drum', 'trk_1', { s: 'rd' }), T('drum', 'trk_5', { s: 'sd' })] });
  assert.deepEqual(w.hits, []);
  assert.deepEqual(w.warn.map(x => [x.i, x.tr, x.why, x.text]), [[0, 'trk_9', 'track', 'Its track was deleted'], [1, 'trk_3', 'sound', 'No Mid tom on “Six” any more'],
    [2, 'trk_2', 'sound', 'No Kick on “Juno” any more'], [3, 'trk_1', 'sound', 'No Ride on “Drums” any more']], 'five targets: the first four (normPad)');
  assert.deepEqual(R({ t: [T('drum', 'trk_5', { s: 'sd' })] }).warn.map(x => x.text), ['No Snare on “this track” any more'], 'a track without an instrument (and a name)');
  // a Replace: the 808's track now holds a 909 (same id): bd still plays (the 909's 36), cb no more
  const q = project(); q.tracks[0].dev.i1 = dev('tr909', { drum: DC.normDrum(undefined, 'tr909') });
  assert.deepEqual(P.resolve(P.normPad({ t: [T('drum', 'trk_1', { s: 'bd' }), T('drum', 'trk_1', { s: 'cb' })] }), q).warn.map(x => x.text), ['No Cowbell on “Drums” any more']);
  // MAP… left the kick no note; a remapped snare plays its new primary; the record by the host's drumOf
  const r = project(); r.tracks[0].dev.i1.drum = DC.normDrum(Object.assign({}, DC.normDrum(undefined), { map: Object.assign({}, DC.DEFAULT_MAP, { bd: [], sd: [77, 38] }) }));
  assert.deepEqual(P.resolve(P.normPad({ t: [T('drum', 'trk_1', { s: 'bd' }), T('drum', 'trk_1', { s: 'sd' })] }), r), { hits: [{ tr: 'trk_1', ns: [77], at: false }],
    warn: [{ i: 0, tr: 'trk_1', why: 'unmapped', text: 'Kick has no note on “Drums”' }] });
  const seen = [];
  P.resolve(P.normPad({ t: [T('drum', 'trk_1', { s: 'sd' })] }), r, (t, k) => { seen.push([t.id, k]); return DC.normDrum(undefined); });
  assert.deepEqual(seen, [['trk_1', 'i1']], 'drumOf(t, devId): the host\'s');
  // the primaries agree with drum-core's
  for (const [tr, m] of [['trk_1', 'tr808'], ['trk_3', 'tr606'], ['trk_4', 'tr909']]) {
    const t = p.tracks.find(x => x.id === tr), pr = DC.primaries(t.dev.i1.drum.map, m);
    for (const j of DC.PERS[m].sids) assert.equal(P.drumNote(t, DC.PERS[m].sounds[j]).n, pr[j], `${m} ${DC.PERS[m].sounds[j]}`);
  }
  // the primary first among several instruments; a non-drum primary skipped
  const two = { id: 'trk_7', name: 'Two', prim: 'i2', dev: { i1: dev('tr606', { drum: DC.normDrum(undefined, 'tr606') }), i2: dev('juno60'), i3: dev('tr909', { drum: DC.normDrum(undefined, 'tr909') }) } };
  assert.deepEqual([P.drumNote(two, 'lt').dev, P.drumNote(two, 'mt').dev, P.drumNote(two, 'xx').why], ['i1', 'i3', 'sound']);
  assert.deepEqual([P.resolve(null, p), P.resolve({ t: 'x' }, p), P.resolve(P.normPad({ t: [T('note', 'trk_2', { n: 1 })] }), null)], [{ hits: [], warn: [] }, { hits: [], warn: [] },
    { hits: [], warn: [{ i: 0, tr: 'trk_2', why: 'track', text: 'Its track was deleted' }] }]);
});

test('resolve: an SDS-V (PERS.sdsv, lane S5) — its five by their GM primaries, nothing else', { skip: DC.PERS.sdsv ? false : 'PERS.sdsv arrives with lane S5' }, () => {
  const p = { tracks: [{ id: 'trk_1', name: 'Kit', prim: 'i1', dev: { i1: dev('sdsv', { drum: DC.normDrum(undefined, 'sdsv') }) } }] };
  const R = s => P.resolve(P.normPad({ t: [{ k: 'drum', tr: 'trk_1', s }] }), p);
  assert.deepEqual(['bd', 'sd', 'lt', 'mt', 'ht'].map(s => R(s).hits[0].ns[0]), [36, 38, 41, 45, 48]);
  assert.deepEqual([R('ch').hits, R('ch').warn[0].why, P.padLabel(P.normPad({ t: [{ k: 'drum', tr: 'trk_1', s: 'bd' }] }), p)], [[], 'sound', 'Bass drum']);
});

/* ---------------------------------------------------------------- defaults, fill */
test('defaultsFor (§3.5; Q3): each drum machine\'s pad order (top row first) → kick bottom-left, its shape; ac an empty pad; the SDS-V 1 × 5; a synth chromatic from C3, 4 × 4; colours by family', () => {
  const tr = { id: 'trk_1' }, D8 = DC.normDrum(undefined), shape = R => { const out = []; for (let r = R.rows - 1; r >= 0; r--) out.push(range(R.cols).map(c => { const p = R.pads[r * 8 + c]; return p ? p.t[0].s : '--'; }).join(' ')); return out; };
  const a = P.defaultsFor(tr, D8, CD.UI.tr808.pads, 4);
  assert.deepEqual([a.rows, a.cols], [4, 4]);
  assert.deepEqual(shape(a), ['lc mc hc cl', 'rs cb cy ma', 'lt mt ht oh', 'bd sd cp ch'], '808: as its panel, the kick bottom-left');
  assert.deepEqual([a.pads[0].t[0], a.pads[0].c, a.pads[1].c, a.pads[8].c, a.pads[11].c, a.pads[2].c, a.pads[24].c], [{ k: 'drum', tr: 'trk_1', s: 'bd' }, P.C_RED, P.C_ORANGE, P.C_AMBER, P.C_CYAN, P.C_GREEN, P.C_GREEN]);
  assert.equal(a.pads.slice(32).every(p => p === null) && a.pads.filter(Boolean).length === 16, true);
  const b = P.defaultsFor(tr, DC.normDrum(undefined, 'tr606'), CD.UI.tr606.pads, 4);
  assert.deepEqual([b.rows, b.cols, shape(b)], [2, 4, ['cy oh ch --', 'bd sd lt ht']], '606: 2 × 4, AC an empty pad');
  assert.equal(b.pads[11], null);
  const c = P.defaultsFor(tr, DC.normDrum(undefined, 'tr909'), CD.UI.tr909.pads, 4);
  assert.deepEqual([c.rows, c.cols, shape(c)], [3, 4, ['cr rd oh ch', 'lt mt ht --', 'bd sd rs cp']], '909: 4 × 3 as its panel');
  const v = P.defaultsFor(tr, { v: 1, m: 'sdsv', keys: [] }, ['bd', 'sd', 'ht', 'mt', 'lt'], 5); // (its panel's order: Bass · Snare · Tom 1 · Tom 2 · Tom 3 = bd sd ht mt lt; the host passes cv-drum UI.sdsv.pads)
  assert.deepEqual([v.rows, v.cols, shape(v)], [1, 5, ['bd sd ht mt lt']], 'SDS-V: bass drum, snare, toms 1 · 2 · 3 on one row, as its panel');
  assert.deepEqual(v.pads.slice(0, 5).map(p => p.c), [P.C_RED, P.C_ORANGE, P.C_AMBER, P.C_AMBER, P.C_AMBER]);
  // no order passed: the machine's sounds by id, kick first, bottom-left
  const d = P.defaultsFor(tr, DC.normDrum(undefined, 'tr606'), null, 4);
  assert.deepEqual([d.rows, shape(d)], [2, ['cy oh ch --', 'bd sd lt ht']]);
  assert.deepEqual(shape(P.defaultsFor(tr, D8, undefined, 8)), ['bd sd lt mt ht rs cp cb', 'cy oh ch lc mc hc cl ma'].reverse(), 'the 808 by id, 8 wide');
  // a synth: chromatic from C3
  const s = P.defaultsFor({ id: 'trk_2' }, null);
  assert.deepEqual([s.rows, s.cols], [4, 4]);
  assert.deepEqual(P.visibleSlots({ rows: 4, cols: 4 }).map(i => s.pads[i].t[0].n), range(16).map(k => 48 + k), 'pad 1 = C3 … pad 16 = D#4');
  assert.deepEqual([s.pads[0].t[0].tr, s.pads[0].c, s.pads.filter(Boolean).length], ['trk_2', P.C_VIOLET, 16]);
  assert.deepEqual(P.defaultsFor(null, D8, CD.UI.tr808.pads, 4), { rows: 4, cols: 4, pads: new Array(64).fill(null) });
  // records normPads keeps as they are
  for (const R of [a, b, c, v, s]) assert.deepEqual(P.normPads([Object.assign({ id: 'pd1' }, R)])[0].pads, R.pads);
  const n = P.newModule('pd1', a);
  assert.deepEqual([n.rows, n.cols, n.name, n.pads[0].t[0].s], [4, 4, 'Pads 1', 'bd']);
});

test('fill (§3.5): onto the visible pads in numbering order (hidden ones kept, the rest emptied) — a machine\'s sounds kick first (ac skipped), a scale from a root (past 127 empty)', () => {
  const M = Object.assign(M44(), { rows: 2, cols: 3 }), hid = P.normPad({ l: 'hidden', t: [{ k: 'note', tr: 'trk_2', n: 1 }] });
  M.pads = M.pads.slice(); M.pads[63] = hid; M.pads[0] = P.normPad({ l: 'old' });
  const vis = P.visibleSlots(M);
  const a = P.fill(M, { k: 'drum', tr: 'trk_3', order: CD.UI.tr606.pads, cols: 4 });
  assert.deepEqual(vis.map(i => a[i] && a[i].t[0].s), ['bd', 'sd', 'lt', 'ht', 'cy', 'oh']);
  assert.deepEqual([a[63], a.length, M.pads[0].l], [hid, 64, 'old'], 'hidden kept; M untouched');
  const b = P.fill(M, { k: 'drum', tr: 'trk_1', order: ['bd'], cols: 4 });
  assert.deepEqual(vis.map(i => (b[i] ? b[i].t[0].s : null)), ['bd', null, null, null, null, null], 'the rest emptied');
  const ex = (scale, root) => vis.map(i => { const p = P.fill(M, { k: 'scale', tr: 'trk_2', scale, root })[i]; return p ? p.t[0].n : null; });
  assert.deepEqual(ex('chrom', 60), [60, 61, 62, 63, 64, 65]);
  assert.deepEqual(ex('major', 60), [60, 62, 64, 65, 67, 69]);
  assert.deepEqual(ex('minor', 57), [57, 59, 60, 62, 64, 65]);
  assert.deepEqual(ex('penta', 60), [60, 62, 64, 67, 69, 72]);
  assert.deepEqual(ex('penta', 124), [124, 126, null, null, null, null], 'past 127: empty');
  assert.deepEqual(ex('nope', undefined), [48, 49, 50, 51, 52, 53], 'defaults: chromatic from C3');
  assert.deepEqual(vis.map(i => P.fill(M, { k: 'scale', tr: 'a b' })[i]), vis.map(() => null), 'a bad track: cleared only');
  const W = Object.assign(M44(), { rows: 8, cols: 8 });
  assert.equal(P.fill(W, { k: 'drum', tr: 'trk_1', order: CD.UI.tr808.pads, cols: 4 }).filter(Boolean).length, 16);
  assert.deepEqual(P.fill(W, { k: 'drum', tr: 'trk_1', order: CD.UI.tr808.pads, cols: 4 }).slice(0, 8).map(p => p && p.t[0].s), ['bd', 'sd', 'cp', 'ch', 'lt', 'mt', 'ht', 'oh']);
});

/* ---------------------------------------------------------------- modulation */
test('modValue (§5.2): every mode × press / pressure / release — gate hi / hi / lo, vel lo + (hi − lo) · v / — / lo, press lo / by pressure / lo, tog flips at each press and keeps at the release', () => {
  const run = (m, evs) => { let st = null; return evs.map(ev => (st = P.modValue(m, ev, st))).map(s => [+s.v.toFixed(4), s.on]); };
  const ev = [{ e: 'press', v: 0.5 }, { e: 'at', at: 0.75 }, { e: 'release' }];
  const mk = (m, lo = 0, hi = 1) => P.normPad({ mod: { m, lo, hi } }).mod;
  assert.deepEqual(run(mk('gate'), ev), [[1, true], [1, true], [0, false]]);
  assert.deepEqual(run(mk('vel'), ev), [[0.5, true], [0.5, true], [0, false]]);
  assert.deepEqual(run(mk('press'), ev), [[0, true], [0.75, true], [0, false]]);
  assert.deepEqual(run(mk('tog'), [...ev, ...ev, ev[0]]), [[1, true], [1, true], [1, true], [0, false], [0, false], [0, false], [1, true]], 'tog: on, kept, off, kept, on');
  assert.deepEqual(run(mk('vel', 0.2, 0.6), ev), [[0.4, true], [0.4, true], [0.2, false]], 'lo / hi');
  assert.deepEqual(run(mk('press', 0.9, 0.1), ev), [[0.9, true], [0.3, true], [0.9, false]], 'an inverted range');
  assert.deepEqual(run(mk('gate', 0.3, 0.8), [{ e: 'at', at: 1 }, { e: 'release' }]), [[0.3, false], [0.3, false]], 'pressure at rest: nothing');
  assert.deepEqual(run(mk('press'), [{ e: 'at', at: 1 }]), [[0, false]], 'pressure without a press: nothing');
  assert.deepEqual(run(mk('vel'), [{ e: 'press', v: 2 }, { e: 'press', v: NaN }]), [[1, true], [0, true]], 'v clamped; a second press re-strikes');
  assert.deepEqual(run(mk('tog', 0.25, 0.5), [{ e: 'press' }, { e: 'press' }]), [[0.5, true], [0.25, false]]);
  assert.deepEqual(P.modValue(mk('gate'), { e: 'nope' }, { v: 0.4, on: true }), { v: 0.4, on: true });
  assert.deepEqual([P.modBright(mk('vel'), 0), P.modBright(mk('vel'), 1), +P.modBright(mk('vel', 0.2, 0.6), 0.4).toFixed(6), P.modBright(mk('vel', 0.5, 0.5), 0.5)], [0.22, 1, 0.61, 0.22]);
  assert.deepEqual([P.padSrc('pd1', 12), P.padOfSrc('pd1.p12'), P.padOfSrc('pd8.p63'), P.padOfSrc('pd9.p1'), P.padOfSrc('pd1.p64'), P.padOfSrc('pd1.p07'), P.padOfSrc('pd1.k1')],
    ['pd1.p12', { id: 'pd1', i: 12 }, { id: 'pd8', i: 63 }, null, null, null, null]);
});

/* ---------------------------------------------------------------- colours */
test('COLORS (§6.4): 16 of our own, unique ids, each lit tone ≥ 3:1 on the pad well, idle = 22 % over the well (dimmer, distinct); colorFor by target', () => {
  const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  assert.equal(P.COLORS.length, 16);
  assert.equal(new Set(P.COLORS.map(c => c.id)).size, 16);
  assert.deepEqual(P.COLORS.map(c => c.id), ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'magenta', 'pink', 'white', 'grey']);
  for (const c of P.COLORS) {
    assert.ok(/^#[0-9a-f]{6}$/.test(c.lit) && /^#[0-9a-f]{6}$/.test(c.idle), c.id);
    assert.ok(ratio(c.lit, P.WELL) >= 3, `${c.id}: lit ${ratio(c.lit, P.WELL).toFixed(2)}:1 on the well`);
    assert.ok(lum(c.idle) < lum(c.lit) && c.idle !== P.WELL && ratio(c.lit, c.idle) >= 2, `${c.id}: idle dimmer, lit ≥ 2:1 over it`);
  }
  const d = s => P.colorFor({ k: 'drum', s });
  assert.deepEqual(['bd', 'sd', 'lt', 'mt', 'ht', 'cy', 'oh', 'ch', 'rd', 'cr', 'rs', 'cp', 'cb', 'lc', 'ma'].map(d), [0, 1, 2, 2, 2, 7, 7, 7, 7, 7, 5, 5, 5, 5, 5]);
  assert.deepEqual([P.colorFor({ k: 'note' }), P.colorFor({ k: 'chord' }), P.colorFor({ k: 'notes' }), P.colorFor(null, { m: 'vel' }), P.colorFor(null)], [11, 12, 12, 6, 15]);
  assert.deepEqual([P.COLORS[P.C_RED].id, P.COLORS[P.C_TEAL].id, P.COLORS[P.C_VIOLET].id, P.COLORS[P.C_MAGENTA].id, P.COLORS[P.C_GREY].id], ['red', 'teal', 'violet', 'magenta', 'grey']);
});

/* ---------------------------------------------------------------- hardware */
test('bindOf / rebind (§8.3): a binding per (port, ch, n, cc) — this port first, then port "" (any); learning one bound elsewhere moves it (never duplicates); Forget; immutable; hidden pads flagged', () => {
  const hw = (port, ch, n, cc = 0) => ({ port, ch, n, cc });
  let pads = P.normPads([{ id: 'pd1', rows: 2, cols: 2 }, { id: 'pd2' }]);
  const before = JSON.stringify(pads);
  let r = P.rebind(pads, 'pd1', 0, hw('MPC', 10, 36));
  assert.deepEqual([r.moved, r.pads[0].pads[0].hw, r.pads[1] === pads[1], JSON.stringify(pads) === before], [null, hw('MPC', 10, 36), true, true], 'an empty slot gets an off pad with the binding; untouched modules shared; the input unchanged');
  pads = r.pads;
  r = P.rebind(pads, 'pd2', 3, hw('MPC', 10, 36));
  assert.deepEqual([r.moved, r.pads[0].pads[0].hw, r.pads[1].pads[3].hw], [{ id: 'pd1', i: 0 }, null, hw('MPC', 10, 36)], 'moved, not duplicated');
  pads = r.pads;
  pads = P.rebind(pads, 'pd1', 1, hw('', 10, 36)).pads;
  pads = P.rebind(pads, 'pd1', 9, hw('MPC', 1, 64, 1)).pads;
  assert.deepEqual([P.bindOf(pads, 'MPC', 10, 36, 0), P.bindOf(pads, 'Other', 10, 36, 0), P.bindOf(pads, 'MPC', 10, 36, 1), P.bindOf(pads, 'MPC', 1, 64, 1), P.bindOf(pads, 'MPC', 1, 64, 0)],
    [{ id: 'pd2', i: 3, hidden: false }, { id: 'pd1', i: 1, hidden: false }, null, { id: 'pd1', i: 9, hidden: false }, null], 'this port first, then any; cc apart');
  const N = P.normPads(pads);
  assert.deepEqual(N, pads, 'rebind keeps normPads\' records');
  let all = 0;
  for (const M of pads) for (const p of M.pads) if (p && p.hw) all++;
  assert.equal(all, 3);
  // a hidden pad (outside pd1's 2 × 2) is flagged
  pads = P.rebind(pads, 'pd1', 2, hw('MPC', 10, 40)).pads;
  assert.deepEqual(P.bindOf(pads, 'MPC', 10, 40, 0), { id: 'pd1', i: 2, hidden: true });
  // Forget; forgetting an empty slot creates nothing
  r = P.rebind(pads, 'pd2', 3, null);
  assert.deepEqual([r.pads[1].pads[3].hw, P.bindOf(r.pads, 'MPC', 10, 36, 0), r.moved], [null, { id: 'pd1', i: 1, hidden: false }, null]);
  assert.equal(P.rebind(pads, 'pd2', 7, null).pads[1], pads[1], 'forget on an empty slot: nothing');
  assert.equal(P.rebind(pads, 'pd2', 7, { ch: 99, n: 1 }).pads[1], pads[1], 'an invalid binding: forget');
  assert.deepEqual([P.bindOf(null, 'A', 1, 1, 0), P.rebind(null, 'pd1', 0, hw('A', 1, 1)).pads], [null, []]);
});

test('echo (§8.4): \'gen\' — a note-on on the learned channel and note, velocity 127 lit / held, 0 idle / off; nothing for \'off\', no binding or a CC-learned pad', () => {
  const pad = P.normPad({ hw: { port: 'MPC', ch: 10, n: 36 } });
  assert.deepEqual(['lit', 'held', 'idle', 'off'].map(s => P.echo('gen', pad, s)), [[0x99, 36, 127], [0x99, 36, 127], [0x99, 36, 0], [0x99, 36, 0]]);
  assert.deepEqual(P.echo('gen', P.normPad({ hw: { port: '', ch: 1, n: 127 } }), 'lit'), [0x90, 127, 127]);
  assert.deepEqual(P.echo('gen', P.normPad({ hw: { port: '', ch: 16, n: 0 } }), 'off'), [0x9f, 0, 0]);
  assert.deepEqual([P.echo('off', pad, 'lit'), P.echo('gen', P.normPad({}), 'lit'), P.echo('gen', P.normPad({ hw: { port: 'A', ch: 1, n: 20, cc: 1 } }), 'lit'), P.echo('gen', null, 'lit'), P.echo('apc', pad, 'lit')],
    [null, null, null, null, null]);
});

/* ---------------------------------------------------------------- stage 7d + 8 fixes (fixer A: R1-E one name, R1-F the SDS-V's look) */
test('R1-E padSourceName: one wording for a mod pad everywhere — "<module name> · <own label | first target\'s label | Pad k>", k the shown number, a hidden slot its place on the full 8 × 8 (i + 1)', () => {
  const p = project(), M = P.newModule('pd1');
  M.pads = M.pads.slice();
  M.pads[0] = P.normPad({ t: [{ k: 'drum', tr: 'trk_1', s: 'bd' }], mod: { m: 'gate' } });
  M.pads[1] = P.normPad({ l: 'Duck', t: [{ k: 'drum', tr: 'trk_1', s: 'sd' }], mod: {} });
  M.pads[2] = P.normPad({ mod: { m: 'tog' } });
  M.pads[3] = P.normPad({ t: [{ k: 'chord', tr: 'trk_2', root: 60, q: 'm7' }], mod: {} });
  M.pads[40] = P.normPad({ mod: {} });
  assert.deepEqual([0, 1, 2, 3, 40].map(i => P.padSourceName(p, M, i)), ['Pads 1 · Kick', 'Pads 1 · Duck', 'Pads 1 · Pad 3', 'Pads 1 · Cm7', 'Pads 1 · Pad 41']);
  assert.equal(P.padSourceName(null, M, 0), 'Pads 1 · Kick', 'no project: the first machine with the sound names it');
  assert.equal(P.padSourceName(p, Object.assign({}, M, { name: '' }), 2), 'Pads 1 · Pad 3', 'an unnamed module: Pads n');
  const sp = { tracks: [{ id: 'trk_8', name: 'Kit', prim: 'i1', dev: { i1: dev('sdsv', { drum: DC.normDrum(undefined, 'sdsv') }) } }] };
  M.pads[5] = P.normPad({ t: [{ k: 'drum', tr: 'trk_8', s: 'ht' }], mod: {} });
  assert.equal(P.padSourceName(sp, M, 5), 'Pads 1 · Tom 1', 'the short sound name on the SDS-V (a hidden pad with a target is named by it too)');
});

test('R1-F the SDS-V\'s pads: a drum pad\'s label is the sound\'s SHORT name ("Bass drum", "Snare drum", "Tom 1" … — no parenthetical); the long names stay for warnings and the roll', () => {
  const sp = { tracks: [{ id: 'trk_8', name: 'Kit', prim: 'i1', dev: { i1: dev('sdsv', { drum: DC.normDrum(undefined, 'sdsv') }) } }].concat(project().tracks) };
  const L = s => P.padLabel(P.normPad({ t: [{ k: 'drum', tr: 'trk_8', s }] }), sp);
  assert.deepEqual(['bd', 'sd', 'ht', 'mt', 'lt'].map(L), ['Bass drum', 'Snare drum', 'Tom 1', 'Tom 2', 'Tom 3']);
  assert.deepEqual([P.soundName('ht', 'sdsv'), P.soundName('lt', 'sdsv')], ['Tom 1 (high)', 'Tom 3 (low)'], 'the roll keeps the long names');
  const w = P.resolve(P.normPad({ t: [{ k: 'drum', tr: 'trk_8', s: 'cr' }] }), sp);
  assert.deepEqual(w.warn.map(x => x.text), ['No Crash on “Kit” any more'], 'a warning names the sound by its full name');
  assert.equal(P.padLabel(P.normPad({ t: [{ k: 'drum', tr: 'trk_1', s: 'ht' }] }), sp), 'Hi tom', 'the 808\'s names have no parenthetical: unchanged');
});

test('R1-F nearestColor(hex): the palette entry nearest in RGB; defaultsFor / fill take a look { c: { sound: colour } } (a machine\'s own colours) by sound id — without one the family colours stay', () => {
  assert.deepEqual(P.COLORS.map((c, k) => P.nearestColor(c.lit) === k), P.COLORS.map(() => true), 'a palette colour: itself');
  assert.deepEqual([P.nearestColor('#d8462f'), P.nearestColor('#e3a72a'), P.nearestColor('#46ae6c'), P.nearestColor('nope'), P.nearestColor(null), P.nearestColor('#abc')], [P.C_RED, P.C_AMBER, P.C_GREEN, P.C_GREY, P.C_GREY, P.C_GREY]);
  const tr = { id: 'trk_1' }, ord = ['bd', 'sd', 'ht', 'mt', 'lt'], look = { c: { bd: 8, sd: 4, ht: 13, mt: 14, lt: 10 } }, D = { v: 1, m: 'sdsv', keys: [] };
  const a = P.defaultsFor(tr, D, ord, 5, look);
  assert.deepEqual([a.rows, a.cols], [1, 5]);
  assert.deepEqual(a.pads.slice(0, 5).map(p => [p.t[0].s, p.c]), ord.map(s => [s, look.c[s]]), 'each pad in its sound\'s colour, by sound id');
  assert.deepEqual(P.defaultsFor(tr, D, ord, 5).pads.slice(0, 5).map(p => p.c), [P.C_RED, P.C_ORANGE, P.C_AMBER, P.C_AMBER, P.C_AMBER], 'no look: the family colours');
  assert.deepEqual(P.normPads([Object.assign({ id: 'pd1' }, a)])[0].pads, a.pads, 'normPads keeps them');
  const M = Object.assign(M44(), { rows: 1, cols: 5 }), f = P.fill(M, { k: 'drum', tr: 'trk_1', order: ord, cols: 5, look });
  assert.deepEqual(f.slice(0, 5).map(p => [p.t[0].s, p.c]), ord.map(s => [s, look.c[s]]), 'Fill from… the same');
  assert.deepEqual(P.fill(M, { k: 'drum', tr: 'trk_1', order: ord, cols: 5 }).slice(0, 5).map(p => p.c), [P.C_RED, P.C_ORANGE, P.C_AMBER, P.C_AMBER, P.C_AMBER]);
  assert.deepEqual(P.defaultsFor(tr, D, ord, 5, { c: { bd: 99, sd: 'x' } }).pads.slice(0, 2).map(p => p.c), [P.C_RED, P.C_ORANGE], 'a bad colour in a look: the family\'s');
});
