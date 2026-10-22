import './v8-guard.mjs';
// patch-core.js (IMPL-9 §1, §3.2, §4.5, §8.2; lane K9): the patch record's pure model over the 900-series table — normPatch
// (idempotent, every bound, hostile input: wrong types, 60 modules, 200 cords, duplicate ids and ends, occupied jacks, any ↔ any,
// S ↔ 1/4", reversed cords, unknown types kept, a drv to a non-driver, the driver's ≤ 3, `via: 'pin'` / `g` kept and bounded,
// throwing getters; never throws; a seeded fuzz), canPlug's table (every §1.3 rule with its reason; P-3's chained multiples), the
// edits (pure — frozen inputs —; a new module's number never an orphan's, review #2; delete pulls its cords and undrives; duplicate
// copies values not cords; the driver's ≤ 3; the knob-writing steps' back meta and ptBack's round trip), payload (stable order; pk
// changes with topology only), live, rackLayout (the Model 15 set flush in two rows over the console; on the dots; extras; wraps),
// nextColor, pruneVals, the knob reads / writes, the presets (each normPatch-valid, Model 15 types only, no feedback loop at the
// section level, Classic bass from the keyboard to MAIN OUT) and model15() = loadPreset on a fresh record.
// Pure: no DOM; only numbers / strings / plain records go into assert.
// Run alone: node --max-old-space-size=2048 --test tests/patch-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as PT from '../patch-core.js?v=9';
import * as MG from '../moog-core.js?v=9';

const SRC = readFileSync(new URL('../patch-core.js', import.meta.url), 'utf8');
const T = MG.TYPES;
const J = x => JSON.parse(JSON.stringify(x));
const freeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) freeze(o[k]); } return o; };
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
// a record with these modules (m1… in order), no cords
const recOf = (...types) => { let r = PT.fresh('moog'); for (const t of types) r = PT.addModule(r, {}, t).rec; return r; };
const M15 = () => MG.model15({});
const plugAll = (r, pairs) => { for (const [a, b] of pairs) { const x = PT.plug(r, a, b); assert.equal(x.why, undefined, a + ' → ' + b); r = x.rec; } return r; };

test('D5: patch-core imports only the family table and names no family', () => {
  const imp = SRC.match(/^import .*$/mg);
  assert.deepEqual(imp, ["import * as MG from './moog-core.js?v=9';"]);
  const body = SRC.replace(/^import .*$/mg, '');
  assert.equal(/moog|\b9\d\d[ab]?\b|model 15|900 series|main out|s-trig/i.test(body), false);
  assert.equal(/\b(document|window|localStorage|setTimeout|requestAnimationFrame)\b/.test(body.replace(/^\s*\/\/.*$/mg, '')), false);
});

test('fresh, familyOf, isPatchModel, FAMILIES, PALETTE', () => {
  assert.deepEqual(PT.fresh('moog'), { v: 1, f: 'moog', nid: 1, mods: {}, cid: 1, cords: [] });
  assert.equal(PT.familyOf('m900'), 'moog'); assert.equal(PT.familyOf({ id: 'm900' }), 'moog');
  for (const m of ['modular', 'minimoog', 'tr808', '', null, 5, {}]) assert.equal(PT.familyOf(m), null);
  assert.equal(PT.isPatchModel('m900'), true); assert.equal(PT.isPatchModel('modular'), false);
  assert.deepEqual(Object.keys(PT.FAMILIES), ['moog']); assert.equal(PT.FAMILIES.moog, MG.FAMILY);
  assert.deepEqual(PT.PALETTE.map(c => c.hex), ['#d8432f', '#e6b83a', '#3f80d8', '#41a75c', '#e9e5da', '#e27c2f', '#9060c9', '#2f3033']);
  assert.equal(new Set(PT.PALETTE.map(c => c.name)).size, 8);
});

test('normPatch: valid records unchanged; idempotent; anything else → a fresh record; never throws', () => {
  const m = M15().rec;
  assert.deepEqual(PT.normPatch(m, 'moog'), m);
  assert.deepEqual(PT.normPatch(PT.normPatch(m, 'moog'), 'moog'), m);
  for (const x of [null, undefined, 5, 'x', [], [m], true, { f: 'arp', mods: {} }]) assert.deepEqual(PT.normPatch(x, 'moog'), PT.fresh('moog'), String(x));
  assert.deepEqual(PT.normPatch({}, 'moog'), PT.fresh('moog'));
  assert.deepEqual(PT.normPatch({ v: 7, mods: 5, cords: {}, nid: 'x', cid: -4, name: 9, junk: 1 }, 'moog'), PT.fresh('moog'));
  const evil = { get mods() { throw new Error('boom'); } };
  assert.deepEqual(PT.normPatch(evil, 'moog'), PT.fresh('moog'));
  const evil2 = { mods: { m1: { get t() { throw new Error('boom'); } } } };
  assert.deepEqual(PT.normPatch(evil2, 'moog'), PT.fresh('moog'));
  const cyc = { mods: {} }; cyc.mods.m1 = { t: '902', self: cyc };
  assert.deepEqual(PT.normPatch(cyc, 'moog').mods, { m1: { t: '902' } });
});

test('normPatch: modules — ids, types, the 48 lowest, names, the controller type refused, nid ≥ 1 + every number', () => {
  const mods = {};
  for (let i = 60; i >= 1; i--) mods['m' + i] = { t: '902' };
  Object.assign(mods, { m0: { t: '902' }, m4096: { t: '902' }, m01: { t: '902' }, x1: { t: '902' }, m70: { t: 'ctl' }, m71: { t: 9 }, m72: { t: 'BAD!' }, m73: null });
  const r = PT.normPatch({ mods, nid: 3 }, 'moog');
  assert.deepEqual(Object.keys(r.mods), Array.from({ length: 48 }, (_, i) => 'm' + (i + 1)));
  assert.equal(r.nid, 49);
  assert.equal(PT.normPatch({ mods: { m7: { t: '911' } }, nid: 2 }, 'moog').nid, 8);
  assert.equal(PT.normPatch({ mods: {}, nid: 99999 }, 'moog').nid, 4096);
  assert.equal(PT.normPatch({ mods: {}, nid: 2.5 }, 'moog').nid, 1);
  const n = PT.normPatch({ mods: { m1: { t: '911', name: 'x'.repeat(30), junk: 1 }, m2: { t: '911', name: '' }, m3: { t: '911', name: 5 } }, name: 'y'.repeat(50) }, 'moog');
  assert.deepEqual(n.mods, { m1: { t: '911', name: 'x'.repeat(24) }, m2: { t: '911' }, m3: { t: '911' } });
  assert.equal(n.name, 'y'.repeat(40));
  // an unknown (newer) type is kept as data; its cords too (ports by shape only); payload leaves both out
  const u = PT.normPatch({ mods: { m1: { t: '914' }, m2: { t: '902' } }, cords: [{ id: 'c1', a: 'm1.out', b: 'm2.i1', c: 2 }, { id: 'c2', a: 'm1.Bad', b: 'm2.i2' }] }, 'moog');
  assert.deepEqual(u.mods, { m1: { t: '914' }, m2: { t: '902' } });
  assert.deepEqual(u.cords, [{ id: 'c1', a: 'm1.out', b: 'm2.i1', c: 2 }]);
  assert.deepEqual(PT.payload(u).pg.mods, [[0, 'ctl', -1], [2, '902', -1]]);
  assert.deepEqual(PT.payload(u).pg.cords, []);
});

test('normPatch: drivers — a 921A only, ≤ 3 per driver (number order), a non-linked type\'s drv dropped', () => {
  const mods = { m1: { t: '921a' }, m2: { t: '921b', drv: 'm1' }, m3: { t: '921b', drv: 'm1' }, m4: { t: '921b', drv: 'm1' }, m5: { t: '921b', drv: 'm1' },
    m6: { t: '921b', drv: 'm7' }, m7: { t: '902' }, m8: { t: '902', drv: 'm1' }, m9: { t: '921b', drv: 'm99' }, m10: { t: '921b', drv: 5 } };
  const r = PT.normPatch({ mods }, 'moog');
  assert.deepEqual(Object.keys(r.mods).filter(k => r.mods[k].drv), ['m2', 'm3', 'm4']);
  assert.deepEqual(r.mods.m8, { t: '902' });
});

test('normPatch: connections — ids, ends, one plug per jack, plugs, direction (reversed swapped), multiples, colour, pins, g, ≤ 128', () => {
  const base = { mods: { m1: { t: '921' }, m2: { t: '904a' }, m3: { t: '911' }, m4: { t: '902' } } };
  const N = cords => PT.normPatch(Object.assign({}, base, { cords }), 'moog').cords;
  // ids: canonical, unique (later duplicates dropped), cid ≥ 1 + every number
  assert.deepEqual(N([{ id: 'c1', a: 'm1.saw', b: 'm2.in' }, { id: 'c1', a: 'm1.sin', b: 'm4.i1' }, { id: 'c01', a: 'm1.tri', b: 'm4.i2' },
    { id: 'c0', a: 'm1.tri', b: 'm4.i2' }, { id: 'c65535', a: 'm1.tri', b: 'm4.i2' }, { id: 7, a: 'm1.tri', b: 'm4.i2' }]).map(c => c.id), ['c1']);
  assert.equal(PT.normPatch(Object.assign({}, base, { cords: [{ id: 'c40', a: 'm1.saw', b: 'm2.in' }], cid: 3 }), 'moog').cid, 41);
  // ends: a missing module, a port the type lacks, malformed
  assert.deepEqual(N([{ id: 'c1', a: 'm9.saw', b: 'm2.in' }, { id: 'c2', a: 'm1.zz', b: 'm2.in' }, { id: 'c3', a: 'm1saw', b: 'm2.in' }, { id: 'c4', a: 'c.kp9', b: 'm2.c1' },
    { id: 'c5', a: 'm1.saw', b: 'm1.saw' }]), []);
  // one plug per jack: a second cord into an occupied jack (either end) dropped
  assert.deepEqual(N([{ id: 'c1', a: 'm1.saw', b: 'm2.in' }, { id: 'c2', a: 'm1.sin', b: 'm2.in' }, { id: 'c3', a: 'm1.saw', b: 'm4.i1' }]).map(c => c.id), ['c1']);
  // plugs: S ↔ 1/4" dropped; S ↔ S kept
  assert.deepEqual(N([{ id: 'c1', a: 'm1.saw', b: 'm3.trg' }, { id: 'c2', a: 'c.ks1', b: 'm1.cv' }, { id: 'c3', a: 'c.ks1', b: 'm3.trg' }]).map(c => c.id), ['c3']);
  // direction: out ↔ out and in ↔ in dropped; a reversed cord swapped
  assert.deepEqual(N([{ id: 'c1', a: 'm1.saw', b: 'm2.out' }, { id: 'c2', a: 'm2.in', b: 'm4.i1' }, { id: 'c3', a: 'm2.c1', b: 'm3.out' }]),
    [{ id: 'c3', a: 'm3.out', b: 'm2.c1', c: 0 }]);
  // multiples: out → any, any → in (reversed swapped), any ↔ any across groups kept as given, within one group dropped
  assert.deepEqual(N([{ id: 'c1', a: 'm1.saw', b: 'c.a1' }, { id: 'c2', a: 'm2.in', b: 'c.a2' }, { id: 'c3', a: 'c.a3', b: 'c.b1' }, { id: 'c4', a: 'c.b2', b: 'c.b3' }])
    .map(c => [c.id, c.a, c.b]), [['c1', 'm1.saw', 'c.a1'], ['c2', 'c.a2', 'm2.in'], ['c3', 'c.a3', 'c.b1']]);
  // colour 0…7 (anything else 0); pins: kept without colour and outside the one-plug rule; via other than 'pin' dropped (a cord)
  assert.deepEqual(N([{ id: 'c1', a: 'm1.saw', b: 'm2.in', c: 9 }, { id: 'c2', a: 'm1.sin', b: 'm4.i1', c: 5, x: 1 }, { id: 'c3', a: 'm1.saw', b: 'm4.i2', via: 'pin', c: 3 },
    { id: 'c4', a: 'm1.tri', b: 'm4.c1', via: 'x', c: 2 }]),
  [{ id: 'c1', a: 'm1.saw', b: 'm2.in', c: 0 }, { id: 'c2', a: 'm1.sin', b: 'm4.i1', c: 5 }, { id: 'c3', a: 'm1.saw', b: 'm4.i2', via: 'pin' }, { id: 'c4', a: 'm1.tri', b: 'm4.c1', c: 2 }]);
  // g: 0…4, absent = 1 (omitted), not a number omitted
  assert.deepEqual(N([{ id: 'c1', a: 'm1.saw', b: 'm2.in', g: 7 }, { id: 'c2', a: 'm1.sin', b: 'm4.i1', g: -1 }, { id: 'c3', a: 'm1.tri', b: 'm4.i2', g: 1 },
    { id: 'c4', a: 'm1.rec', b: 'm4.c1', g: NaN }, { id: 'c5', a: 'm1.xp', b: 'm4.c2', g: 0.5, via: 'pin' }, { id: 'c6', a: 'm1.xm', b: 'm4.c3', g: '2' }]).map(c => c.g),
  [4, 0, undefined, undefined, 0.5, undefined]);
  // ≤ 128 connections (48 921s, 200 valid cords out → in)
  const mods = {}, cords = [], outs = ['sin', 'tri', 'saw', 'rec', 'xm', 'xp'], ins = ['f1', 'f2', 'f3', 'w1', 'w2', 'cv'];
  for (let i = 1; i <= 48; i++) mods['m' + i] = { t: '921' };
  for (let k = 0; k < 200; k++) cords.push({ id: 'c' + (k + 1), a: `m${(k % 48) + 1}.${outs[Math.floor(k / 48) % 6]}`, b: `m${((k + 7) % 48) + 1}.${ins[Math.floor(k / 48) % 6]}`, c: k % 8 });
  const big = PT.normPatch({ mods, cords }, 'moog');
  assert.equal(big.cords.length, 128);
  assert.deepEqual(big.cords.map(c => c.id), cords.slice(0, 128).map(c => c.id));
  assert.equal(big.cid, 129);
});

// the invariants every normalised record keeps
function invariants(r) {
  const bad = [], ok = (c, m) => { if (!c) bad.push(m); };
  ok(r.v === 1 && r.f === 'moog', 'v / f');
  const ks = Object.keys(r.mods), nums = ks.map(k => +k.slice(1));
  ok(ks.length <= 48 && ks.every(k => /^m[1-9]\d{0,3}$/.test(k)), 'mods ids / count');
  ok(Number.isInteger(r.nid) && r.nid >= 1 && r.nid <= 4096 && nums.every(n => n < r.nid), 'nid');
  ok(Number.isInteger(r.cid) && r.cid >= 1 && r.cid <= 65535 && r.cords.every(c => +c.id.slice(1) < r.cid), 'cid');
  ok(r.cords.length <= 128 && new Set(r.cords.map(c => c.id)).size === r.cords.length, 'cords ids / count');
  const occ = new Set();
  for (const c of r.cords) {
    // an end on a module of a newer type: kept by shape only (port syntax); else a jack of its type
    const jk = e => { const [m, p] = e.split('.'), t = m === 'c' ? 'ctl' : r.mods[m] && r.mods[m].t; ok(t && /^[a-z][a-z0-9]{0,7}$/.test(p), 'end ' + e); return T[t] ? T[t].jacks.find(j => j.id === p) || 'none' : null; };
    const ja = jk(c.a), jb = jk(c.b);
    ok(ja !== 'none' && jb !== 'none', 'ports ' + c.id);
    if (ja && jb && ja !== 'none' && jb !== 'none') ok(ja.sig === jb.sig && ja.dir !== 'in' && jb.dir !== 'out', 'plug / direction ' + c.id);
    if (!c.via) { ok(!occ.has(c.a) && !occ.has(c.b), 'one plug ' + c.id); occ.add(c.a); occ.add(c.b); ok(Number.isInteger(c.c) && c.c >= 0 && c.c < 8, 'colour'); }
    else ok(c.via === 'pin' && c.c === undefined, 'pin');
    ok(c.g === undefined || (c.g >= 0 && c.g <= 4 && c.g !== 1), 'g');
  }
  for (const k of ks) if (r.mods[k].drv) ok(r.mods[k].t === '921b' && r.mods[r.mods[k].drv] && r.mods[r.mods[k].drv].t === '921a', 'drv ' + k);
  for (const k of ks) ok(ks.filter(j => r.mods[j].drv === k).length <= 3, 'drives ≤ 3');
  return bad;
}

test('normPatch fuzz: 600 hostile records — never throws, idempotent, every invariant', () => {
  const R = rng(9), pick = a => a[Math.floor(R() * a.length)];
  const types = [...MG.ORDER, 'ctl', '914', 'bad!', 7, null];
  const jacksOf = t => (T[t] ? T[t].jacks.map(j => j.id) : ['out', 'in', 'zz']);
  for (let it = 0; it < 600; it++) {
    const mods = {}, nm = Math.floor(R() * 60);
    for (let i = 0; i < nm; i++) mods[R() < 0.95 ? 'm' + Math.floor(R() * 70) : pick(['x', 'm0', 'm01', 'm5000'])] = R() < 0.95 ? { t: pick(types), drv: R() < 0.3 ? 'm' + Math.floor(R() * 70) : undefined, name: R() < 0.1 ? 'n'.repeat(Math.floor(R() * 40)) : undefined } : pick([null, 5, [], 'x']);
    const ms = ['c', ...Object.keys(mods)], cords = [], nc = Math.floor(R() * 220);
    const end = () => { const m = pick(ms), t = m === 'c' ? 'ctl' : mods[m] && mods[m].t; return m + '.' + pick(jacksOf(t)); };
    for (let k = 0; k < nc; k++) cords.push(R() < 0.95 ? { id: R() < 0.9 ? 'c' + Math.floor(R() * 300) : pick([5, 'c0', 'x']), a: R() < 0.97 ? end() : 5, b: end(), c: pick([0, 3, 7, 8, -1, 'x', undefined]), via: R() < 0.1 ? pick(['pin', 'x']) : undefined, g: R() < 0.2 ? pick([0, 0.5, 1, 4, 7, -2, NaN]) : undefined } : pick([null, 1, 'x']));
    const rec = { v: pick([1, 2, undefined]), f: pick(['moog', undefined, 'moog', 'arp']), nid: pick([1, 50, 9999, -1, 'x']), mods, cid: pick([1, 400, 70000, undefined]), cords, name: pick([undefined, 'P', 'q'.repeat(50), 5]) };
    const a = PT.normPatch(rec, 'moog'), b = PT.normPatch(J(a), 'moog');
    assert.deepEqual(b, a, 'idempotent #' + it);
    assert.deepEqual(invariants(a), [], 'invariants #' + it);
    PT.payload(a); PT.live(a); PT.rackLayout(a);
  }
});

test('canPlug (§1.3): every rule with its reason, oriented ends', () => {
  let r = recOf('921', '904a', '911', '902', '921');                       // m1 921 · m2 904A · m3 911 · m4 902 · m5 921
  const C = (a, b) => { const k = PT.canPlug(r, a, b); return k.ok ? [k.a, k.b] : k.why; };
  assert.deepEqual(C('m1.saw', 'm2.in'), ['m1.saw', 'm2.in']);
  assert.deepEqual(C('m2.in', 'm1.saw'), ['m1.saw', 'm2.in']);                 // dragged from the input: oriented
  assert.deepEqual(C('m2.out', 'm2.c1'), ['m2.out', 'm2.c1']);                 // a module into itself (feedback) is legal
  assert.deepEqual(C('m1.saw', 'm1.f1'), ['m1.saw', 'm1.f1']);
  assert.deepEqual(C('m3.out', 'm4.i1'), ['m3.out', 'm4.i1']);                 // CV into an audio input: no refusal by role
  assert.equal(C('m1.saw', 'm5.saw'), 'Two outputs — connect an output to an input');
  assert.equal(C('m2.in', 'm4.i1'), 'Two inputs — connect an output to an input');
  assert.equal(C('m1.saw', 'm3.trg'), 'An S-trigger socket — use the controller’s trigger converter');
  assert.equal(C('c.ks1', 'm1.cv'), 'A 1/4" jack — use the controller’s trigger converter');
  assert.deepEqual(C('c.ks1', 'm1.cs'), ['c.ks1', 'm1.cs']);
  assert.deepEqual(C('m3.trg', 'c.vo'), ['c.vo', 'm3.trg']);
  assert.equal(C('m1.saw', 'm1.saw'), 'Pick another jack');
  assert.equal(C('m1.saw', 'm9.in'), 'No such jack');
  assert.equal(C('m1.zz', 'm2.in'), 'No such jack');
  assert.equal(C('c.out', 'x'), 'No such jack');
  r = PT.plug(r, 'm1.saw', 'm2.in').rec;
  assert.equal(C('m5.saw', 'm2.in'), 'This jack has a cord — pull it first');
  assert.equal(C('m1.saw', 'm4.i1'), 'This jack has a cord — pull it first');
  // multiples: out → a group, a group → in; a group already driven takes a second source (it sums them)
  assert.deepEqual(C('m5.saw', 'c.a1'), ['m5.saw', 'c.a1']);
  assert.deepEqual(C('c.a1', 'm4.i1'), ['c.a1', 'm4.i1']);
  assert.deepEqual(C('m4.i1', 'c.b4'), ['c.b4', 'm4.i1']);
  assert.deepEqual(C('c.a2', 'm5.tri'), ['m5.tri', 'c.a2']);
  // P-3: two multiples — one group the same multiple; neither driven; exactly one driven (from it); both driven
  assert.equal(C('c.a1', 'c.a2'), 'These jacks are one multiple already');
  assert.equal(C('c.a1', 'c.b1'), 'Neither multiple is driven — patch a signal into one first');
  r = PT.plug(r, 'm5.saw', 'c.a1').rec;
  assert.deepEqual(C('c.b1', 'c.a2'), ['c.a2', 'c.b1']);
  assert.deepEqual(C('c.a2', 'c.b1'), ['c.a2', 'c.b1']);
  r = PT.plug(r, 'm3.out', 'c.b2').rec;
  assert.equal(C('c.a2', 'c.b1'), 'Both multiples are driven — pull one’s source first');
  // a newer module type cannot be patched
  const u = PT.normPatch({ mods: { m1: { t: '914' }, m2: { t: '902' } } }, 'moog');
  assert.equal(PT.canPlug(u, 'm1.out', 'm2.i1').why, 'This module needs a newer version of the app');
  // ≤ 128 connections
  let big = PT.normPatch({ mods: Object.fromEntries(Array.from({ length: 48 }, (_, i) => ['m' + (i + 1), { t: '921' }])) }, 'moog');
  const outs = ['sin', 'tri', 'saw'], ins = ['f1', 'f2', 'f3'];
  for (let k = 0; k < 128; k++) big = PT.plug(big, `m${(k % 48) + 1}.${outs[Math.floor(k / 48)]}`, `m${((k + 1) % 48) + 1}.${ins[Math.floor(k / 48)]}`).rec;
  assert.equal(big.cords.length, 128);
  assert.equal(PT.canPlug(big, 'm40.xp', 'm41.w1').why, 'A patch holds at most 128 cords');
  assert.equal(PT.canPlug(null, 'm1.saw', 'm2.in').why, 'No patch');
});

test('jacksOf, targets, cordAt (the drag\'s lists)', () => {
  const r = PT.plug(recOf('911', '902'), 'm1.out', 'm2.c1').rec;
  const js = PT.jacksOf(r);
  assert.equal(js.length, 27 + 2 + 7);
  assert.deepEqual(js.slice(27).map(j => j.end), ['m1.trg', 'm1.out', 'm2.i1', 'm2.i2', 'm2.o1', 'm2.o2', 'm2.c1', 'm2.c2', 'm2.c3']);
  assert.deepEqual(js[0], { end: 'c.kp1', mid: 'c', port: 'kp1', type: 'ctl', dir: 'out', sig: 'v', role: 'cv', label: 'PITCH 1', sec: 0 });
  const tg = PT.targets(r, 'c.ks1');
  assert.deepEqual(tg.filter(x => x.ok).map(x => x.end), ['c.si', 'm1.trg']);
  assert.equal(tg.find(x => x.end === 'm2.c2').why, 'A 1/4" jack — use the controller’s trigger converter');
  assert.deepEqual(PT.cordAt(r, 'm2.c1'), { id: 'c1', which: 'b' });
  assert.deepEqual(PT.cordAt(r, 'm1.out'), { id: 'c1', which: 'a' });
  assert.equal(PT.cordAt(r, 'm1.trg'), null);
});

test('edits are pure: frozen inputs, a new record back; nothing changed → the same record', () => {
  const r0 = freeze(M15().rec), v0 = freeze(M15().vals);
  const add = PT.addModule(r0, v0, '904a');
  assert.ok(add.rec !== r0 && add.mid === 'm13');
  PT.removeModule(r0, 'm7'); PT.duplicateModule(r0, v0, 'm3'); PT.pull(r0, 'c1'); PT.repatch(r0, 'c1', 'a', 'c.kp1');
  PT.setColor(r0, 'c1', 5); PT.setDriver(r0, 'm3', null); PT.loadPreset(r0, v0, 'Drone'); PT.initPatch(r0, v0); PT.loadSet(r0, v0);
  PT.setKnob(v0, r0, 'm7', 'fc', 2); PT.ptBack(v0, { f: [[['gl'], 0, 1]] }, true); PT.pruneVals(v0, r0);
  assert.deepEqual(r0, M15().rec);
  assert.equal(PT.setColor(r0, 'c1', r0.cords[0].c).rec, r0);
  assert.equal(PT.setDriver(r0, 'm3', 'm2').rec, r0);
  const rp = PT.repatch(r0, 'c1', 'b', r0.cords[0].b);
  assert.equal(rp.rec, r0); assert.equal(rp.why, undefined);
  for (const x of [PT.addModule(r0, v0, 'ctl'), PT.addModule(r0, v0, 'zz'), PT.removeModule(r0, 'c'), PT.removeModule(r0, 'm99'), PT.pull(r0, 'c99'),
    PT.plug(r0, 'm1.saw', 'm1.saw'), PT.setColor(r0, 'c1', 8), PT.setDriver(r0, 'm1', 'm2'), PT.loadPreset(r0, v0, 'Nope')]) {
    assert.equal(x.rec, r0); assert.equal(typeof x.why, 'string');
  }
});

test('§1.5 numbering (review #2): a new module never takes an orphan\'s number', () => {
  let rec = recOf('921b', '902'), vals = { p: {} };                         // m1 921B · m2 902
  const before = rec;
  const a = PT.addModule(rec, vals, '904a');                                // add a 904A: m3
  assert.equal(a.mid, 'm3');
  rec = a.rec; vals = PT.setKnob(vals, rec, 'm3', 'fc', 2.5);               // turn its knob
  assert.deepEqual(vals.p.m3, { _t: '904a', fc: 2.5 });
  rec = before;                                                             // undo: the record back, the knobs kept (keepDevs)
  assert.equal(rec.nid, 3);
  const b = PT.addModule(rec, vals, '911');                                 // add a 911: not m3
  assert.equal(b.mid, 'm4');
  assert.equal(PT.getKnob(vals, b.rec, 'm4', 't1'), T['911'].params[0].def);
  assert.equal(PT.nextId(rec, vals), 4);
  assert.equal(PT.nextId(rec, { p: { m77: {} } }), 78);
  assert.equal(PT.nextId(PT.fresh('moog'), null), 1);
  // the cap and the numbers' end
  let full = PT.fresh('moog');
  for (let i = 0; i < 48; i++) full = PT.addModule(full, {}, '995').rec;
  assert.equal(PT.addModule(full, {}, '995').why, 'A patch holds at most 48 modules');
  assert.equal(PT.addModule(PT.fresh('moog'), { p: { m4095: {} } }, '995').why, 'No module numbers left');
  // the duplicate and a preset's added modules take numbers the same way
  assert.equal(PT.duplicateModule(before, vals, 'm2').mid, 'm4');
  assert.deepEqual(PT.loadPreset(before, vals, 'Wind').added, ['m4', 'm5', 'm6', 'm7']);
});

test('add / remove / duplicate / driver: 921Bs driven by the first 921A with room, ≤ 3; delete pulls cords and undrives', () => {
  let r = recOf('921a', '921b', '921b', '921b', '921b', '921a', '921b');
  assert.deepEqual(Object.values(r.mods).map(m => m.drv || ''), ['', 'm1', 'm1', 'm1', '', '', 'm6']);
  assert.equal(PT.setDriver(r, 'm5', 'm1').why, 'A 921A drives at most 3');
  r = PT.setDriver(r, 'm5', 'm6').rec;
  assert.equal(r.mods.m5.drv, 'm6');
  assert.equal(PT.setDriver(r, 'm5', 'm2').why, 'No such driver');
  assert.equal(PT.setDriver(r, 'm1', 'm6').why, 'This module takes no driver');
  r = PT.setDriver(r, 'm5', null).rec;
  assert.equal(r.mods.m5.drv, undefined);
  r = plugAll(r, [['c.kp1', 'm1.f1'], ['m2.saw', 'c.m1'], ['m3.saw', 'c.m2'], ['c.mo', 'm7.ac']]);
  const d = PT.removeModule(r, 'm1');
  assert.deepEqual(d.cords, ['c1']);
  assert.deepEqual(d.undriven, ['m2', 'm3', 'm4']);
  assert.equal(d.rec.mods.m1, undefined);
  assert.deepEqual(d.rec.cords.map(c => c.id), ['c2', 'c3', 'c4']);
  assert.deepEqual(PT.normPatch(d.rec), d.rec);
  // duplicate: values (its own type's entry) copied, no cords, the driver kept while it has room
  const vals = PT.setKnob(PT.setKnob({}, r, 'm2', 'fq', 1.5), r, 'm2', 'rg', 4);
  const u = PT.duplicateModule(r, vals, 'm7');
  assert.equal(u.mid, 'm8'); assert.equal(u.rec.mods.m8.drv, 'm6'); assert.equal(u.vals, vals);
  const w = PT.duplicateModule(r, vals, 'm2');
  assert.deepEqual(w.vals.p.m8, { _t: '921b', fq: 1.5, rg: 4 });
  assert.notEqual(w.vals.p.m8, vals.p.m2);
  assert.equal(w.rec.mods.m8.drv, 'm6');                                    // m1 is full: the first 921A with room
  assert.equal(w.rec.cords.length, r.cords.length);
  assert.equal(PT.duplicateModule(r, vals, 'c').why, 'No such module');
});

test('plug / pull / repatch / setColor', () => {
  let r = recOf('921', '904a', '902');
  const p = PT.plug(r, 'm2.in', 'm1.saw');
  assert.deepEqual([p.id, p.a, p.b, p.rec.cid], ['c1', 'm1.saw', 'm2.in', 2]);
  assert.deepEqual(p.rec.cords[0], { id: 'c1', a: 'm1.saw', b: 'm2.in', c: 0 });
  r = p.rec;
  r = PT.plug(r, 'm2.out', 'm3.i1', 6).rec;
  assert.equal(r.cords[1].c, 6);
  // re-patch: the source end to another output; the destination end to another input; refused onto an occupied jack
  let q = PT.repatch(r, 'c1', 'a', 'm1.tri');
  assert.deepEqual(q.rec.cords[0], { id: 'c1', a: 'm1.tri', b: 'm2.in', c: 0 });
  q = PT.repatch(r, 'c1', 'm2.in', 'm2.c1');
  assert.deepEqual([q.a, q.b], ['m1.saw', 'm2.c1']);
  assert.equal(PT.repatch(r, 'c1', 'b', 'm3.i1').why, 'This jack has a cord — pull it first');
  assert.equal(PT.repatch(r, 'c1', 'b', 'm1.tri').why, 'Two outputs — connect an output to an input');
  assert.equal(PT.repatch(r, 'c1', 'z', 'm3.i2').why, 'No such end');
  // the moving end of a cord into a multiple may flip its direction (the multiple then feeds the new input)
  r = PT.plug(r, 'm1.sin', 'c.a1').rec;
  q = PT.repatch(r, 'c3', 'a', 'm3.i2');
  assert.deepEqual([q.a, q.b], ['c.a1', 'm3.i2']);
  // pull, colour
  const o = PT.pull(r, 'c2');
  assert.deepEqual(o.cord, { id: 'c2', a: 'm2.out', b: 'm3.i1', c: 6 });
  assert.deepEqual(o.rec.cords.map(c => c.id), ['c1', 'c3']);
  assert.equal(PT.setColor(r, 'c1', 7).rec.cords[0].c, 7);
  // cord numbers are never reused (cid)
  assert.equal(PT.plug(o.rec, 'm2.out', 'm3.i1').id, 'c4');
  // names: a module's ≤ 24, the patch's ≤ 40, '' clears, unchanged → the same rec
  const n1 = PT.setName(r, 'm2', 'L'.repeat(30)).rec;
  assert.deepEqual(n1.mods.m2, { t: '904a', name: 'L'.repeat(24) });
  assert.deepEqual(PT.setName(n1, 'm2', '').rec.mods.m2, { t: '904a' });
  assert.equal(PT.setName(n1, null, 'P'.repeat(50)).rec.name, 'P'.repeat(40));
  assert.equal(PT.setName(r, null, '').rec, r);
  assert.equal(PT.setName(r, 'c', 'x').why, 'No such module');
  assert.deepEqual(PT.normPatch(n1), n1);
});

test('nextColor (Q3): the least used of the eight, ties in palette order', () => {
  let r = recOf('921', '921', '902', '902');
  assert.equal(PT.nextColor(r), 0);
  r = PT.plug(r, 'm1.saw', 'm3.i1').rec; r = PT.plug(r, 'm1.sin', 'm3.i2').rec; r = PT.plug(r, 'm1.tri', 'm4.i1').rec;
  assert.deepEqual(r.cords.map(c => c.c), [0, 1, 2]);
  r = PT.setColor(r, 'c1', 4).rec;                                          // 0 free again
  assert.equal(PT.nextColor(r), 0);
  let s = recOf('921', '921', '921', '902', '902', '902');
  const outs = ['sin', 'tri', 'saw', 'rec', 'xm', 'xp'], ins = ['i1', 'i2', 'c1', 'c2', 'c3'];
  for (let k = 0; k < 10; k++) s = PT.plug(s, `m${1 + (k % 3)}.${outs[Math.floor(k / 3)]}`, `m${4 + (k % 3)}.${ins[Math.floor(k / 3)]}`).rec;
  assert.deepEqual(s.cords.map(c => c.c), [0, 1, 2, 3, 4, 5, 6, 7, 0, 1]);
  assert.equal(PT.nextColor({ cords: [{ c: 0, via: 'pin' }] }), 0);
});

test('knobs: getKnob / setKnob (`_t` checked, clamped), pruneVals (orphans, mismatches, unknown ids)', () => {
  const r = recOf('904a', '921');
  let v = {};
  assert.equal(PT.getKnob(v, r, 'm1', 'fc'), 0); assert.equal(PT.getKnob(v, r, 'm1', 'zz'), undefined); assert.equal(PT.getKnob(v, r, 'c', 'ov'), 7);
  v = PT.setKnob(v, r, 'm1', 'fc', 9);
  assert.deepEqual(v.p.m1, { _t: '904a', fc: 6 });
  v = PT.setKnob(v, r, 'm2', 'rg', 4.6); assert.equal(v.p.m2.rg, 5);
  v = PT.setKnob(v, r, 'c', 'tu', -80); assert.equal(v.tu, -50);
  assert.equal(PT.setKnob(v, r, 'm1', 'zz', 1), v); assert.equal(PT.setKnob(v, r, 'm1', 'fc', NaN), v); assert.equal(PT.setKnob(v, r, 'm9', 'fc', 1), v);
  // an entry of another type (an orphan's number reached by a hand-edited file): reads the defaults, a write starts afresh
  const w = { p: { m1: { _t: '911', fc: 3, t1: 2 } } };
  assert.equal(PT.getKnob(w, r, 'm1', 'fc'), 0);
  assert.deepEqual(PT.setKnob(w, r, 'm1', 're', 2).p.m1, { _t: '904a', re: 2 });
  // pruneVals: orphans and mismatches dropped, values clamped, ids the type lacks dropped, a newer type's numbers kept
  const u = PT.normPatch({ mods: { m1: { t: '904a' }, m2: { t: '921' }, m3: { t: '914' } } }, 'moog');
  const pv = PT.pruneVals({ gl: 3, p: { m1: { _t: '904a', fc: 99, re: 2, zz: 1, rg: 'x' }, m2: { _t: '911', t1: 1 }, m3: { _t: '914', q: 2, s: 'x' }, m9: { _t: '902', fc: 1 }, m4: 5 } }, u);
  assert.deepEqual(pv, { gl: 3, p: { m1: { _t: '904a', fc: 6, re: 2 }, m3: { _t: '914', q: 2 } } });
  assert.deepEqual(PT.pruneVals(null, u), { p: {} });
  assert.deepEqual(PT.pruneVals({ p: [1] }, u), { p: {} });
});

test('knob-writing steps: loadPreset / initPatch / loadSet return back = [path, before, after]; ptBack round trip', () => {
  const m = M15();
  let rec = m.rec, vals = PT.setKnob(m.vals, rec, 'm7', 'fc', 3);           // the user turned the 904A since the tile
  const L = PT.loadPreset(rec, vals, 'Sync lead');
  assert.deepEqual(L.added, []);
  assert.equal(L.rec.name, 'Sync lead');
  assert.deepEqual(L.bound, { d: 'm2', o1: 'm3', o2: 'm4', e1: 'm9', e2: 'm10', a: 'm11' });
  const F = L.back.f;
  assert.ok(F.some(([p, b, a]) => p.join('.') === 'pr' && b === 0 && a === 1));
  assert.ok(F.some(([p, b, a]) => p.join('.') === 'p.m4.fq' && b === 0.02 && a === 3));
  assert.ok(F.some(([p, b, a]) => p.join('.') === 'p.m4.ss' && b === 1 && a === 2));
  assert.ok(!F.some(([p]) => p[1] === 'm7'));                                // an unbound module's knobs are not touched
  assert.equal(L.vals.p.m7.fc, 3);
  for (const [p, b, a] of F) assert.ok(Array.isArray(p) && (p.length === 1 || (p.length === 3 && p[0] === 'p')) && b !== a && b !== undefined && a !== undefined);
  assert.deepEqual(J(L.back), L.back);                                       // JSON-safe (History meta)
  // undo (keepDevs kept the preset's knobs): ptBack puts the before-values back; redo the after-values
  const U = PT.ptBack(L.vals, L.back, false);
  assert.ok(U.ok && !U.already);
  assert.deepEqual(U.vals, vals);
  const R = PT.ptBack(U.vals, L.back, true);
  assert.ok(R.ok && !R.already);
  assert.deepEqual(R.vals, L.vals);
  assert.deepEqual(PT.ptBack(R.vals, L.back, true), { vals: R.vals, ok: true, already: true });
  // a knob turned after the load: left as it is (the host's notice)
  const turned = PT.setKnob(L.vals, L.rec, 'm4', 'fq', -2);
  assert.deepEqual(PT.ptBack(turned, L.back, false), { vals: turned, ok: false, already: false });
  // a field that was absent comes back absent (null in the meta); an emptied entry is removed
  const fr = recOf('911'), A = PT.loadPreset(fr, {}, 'Bells');
  assert.ok(A.back.f.some(([p, b]) => p.join('.') === 'p.m1._t' && b === null));
  assert.deepEqual(PT.ptBack(A.vals, A.back, false).vals, { p: {} });              // (an empty p stays: the same as none)
  // Init patch: no cords, no name, every knob at its default (modules and drivers kept)
  const I = PT.initPatch(L.rec, turned);
  assert.deepEqual(I.rec.cords, []); assert.equal(I.rec.name, undefined); assert.equal(I.rec.mods.m3.drv, 'm2');
  assert.equal(PT.getKnob(I.vals, I.rec, 'm7', 'fc'), 0); assert.equal(I.vals.pr, 0); assert.equal(I.vals.p.m4.fq, 0);
  assert.deepEqual(PT.ptBack(I.vals, I.back, false).vals, turned);
  // loadSet: the starter on the full set — the missing modules added, one step
  const S = PT.loadSet(recOf('902', '911'), {});
  assert.deepEqual(S.added, ['m3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12']);
  assert.equal(Object.keys(S.rec.mods).length, 12); assert.equal(S.rec.name, 'Classic bass');
  assert.equal(S.rec.cords.length, 15);
});

test('loadPreset: roles bind to the lowest free numbers; the topology replaced; drivers set, capped; refusals change nothing', () => {
  // a patch with a 921A driving three 921Bs, one of them bound: the preset's two driven ones fit only if an unbound one sheds
  let r = recOf('921a', '921b', '921b', '921b', '902');
  r = PT.plug(r, 'm2.saw', 'm5.i1').rec;
  const x = PT.loadPreset(r, {}, 'Bells');
  assert.deepEqual(x.added, ['m6', 'm7']);                                   // 907A, 911 (the 902 is m5)
  assert.deepEqual(x.bound, { d: 'm1', o1: 'm2', o2: 'm3', fb: 'm6', e: 'm7', a: 'm5' });
  assert.equal(x.rec.mods.m4.drv, 'm1');                                     // three driven: still ≤ 3
  // a bound 921B newly driven pushes its driver past 3: the highest unbound one sheds its driver
  let s = recOf('921a', '921b', '921b', '921b', '921b');                    // m2 m3 m4 on m1, m5 undriven
  s = PT.setDriver(s, 'm2', null).rec; s = PT.setDriver(s, 'm5', 'm1').rec;  // m1 drives m3 m4 m5; m2 undriven
  const sx = PT.loadPreset(s, {}, 'Bells');                                  // binds o1 = m2, o2 = m3, both on m1
  assert.deepEqual(['m2', 'm3', 'm4', 'm5'].map(k => sx.rec.mods[k].drv || ''), ['m1', 'm1', 'm1', '']);
  assert.deepEqual(x.rec.cords.map(c => c.id), ['c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9']);
  assert.deepEqual(x.rec.cords.map(c => c.c), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(PT.normPatch(x.rec), x.rec);
  // Drone: its 921Bs play undriven
  const d = PT.loadPreset(r, {}, 'Drone');
  assert.equal(d.rec.mods.m2.drv, undefined); assert.equal(d.rec.mods.m3.drv, undefined); assert.equal(d.rec.mods.m4.drv, 'm1');
  // no room for the modules a preset needs: nothing changes
  let full = PT.fresh('moog');
  for (let i = 0; i < 48; i++) full = PT.addModule(full, {}, '995').rec;
  const f = PT.loadPreset(full, { a: 1 }, 'Classic bass');
  assert.equal(f.why, 'A patch holds at most 48 modules'); assert.equal(f.rec, full);
});

test('payload (§3.2): numbers, driver links, port indices, g; stable order; pk with topology only', () => {
  const m = M15().rec, P = PT.payload(m);
  assert.deepEqual(P.pg.mods, [[0, 'ctl', -1], [1, '921', -1], [2, '921a', -1], [3, '921b', 2], [4, '921b', 2], [5, '923', -1], [6, '995', -1],
    [7, '904a', -1], [8, '907a', -1], [9, '911', -1], [10, '911', -1], [11, '902', -1], [12, '902', -1]]);
  assert.equal(P.pg.cords.length, 15);
  const ix = (t, id) => T[t].jacks.findIndex(j => j.id === id);
  assert.ok(P.pg.cords.some(c => c.join() === [11, ix('902', 'o2'), 0, ix('ctl', 'out'), 1].join()));
  assert.ok(P.pg.cords.some(c => c.join() === [0, ix('ctl', 'kp1'), 2, ix('921a', 'f1'), 1].join()));
  for (let i = 1; i < P.pg.cords.length; i++) assert.ok(P.pg.cords[i - 1].join(',') < P.pg.cords[i].join(',') || P.pg.cords[i - 1][0] <= P.pg.cords[i][0]);
  assert.match(P.pk, /^[0-9a-f]{8}$/);
  // the same topology, any order / colours / ids / names → the same payload
  const sh = Object.assign({}, m, { cords: m.cords.slice().reverse().map((c, i) => Object.assign({}, c, { id: 'c' + (100 + i), c: (c.c + 3) % 8 })), name: 'Other',
    mods: Object.assign({}, m.mods, { m1: { t: '921', name: 'Bass osc' } }) });
  assert.deepEqual(PT.payload(sh), P);
  // a cord, a driver, a module, a g → another pk
  assert.notEqual(PT.payload(PT.pull(m, 'c3').rec).pk, P.pk);
  assert.notEqual(PT.payload(PT.setDriver(m, 'm4', null).rec).pk, P.pk);
  assert.notEqual(PT.payload(PT.addModule(m, {}, '995').rec).pk, P.pk);
  const g = PT.normPatch(Object.assign({}, m, { cords: m.cords.map((c, i) => (i ? c : Object.assign({}, c, { g: 2 }))) }));
  assert.notEqual(PT.payload(g).pk, P.pk);
  assert.equal(PT.payload(g).pg.cords.filter(c => c[4] === 2).length, 1);
  // a pin is a connection to the engine (g its resistor)
  const pin = PT.normPatch({ mods: { m1: { t: '921' }, m2: { t: '902' } }, cords: [{ id: 'c1', a: 'm1.saw', b: 'm2.i1', via: 'pin', g: 0.25 }] });
  assert.deepEqual(PT.payload(pin).pg.cords, [[1, ix('921', 'saw'), 2, ix('902', 'i1'), 0.25]]);
  assert.deepEqual(PT.payload(PT.fresh('moog')).pg, { v: 1, f: 'moog', mods: [[0, 'ctl', -1]], cords: [] });
});

test('live (§3.6): the controller\'s MAIN OUT patched', () => {
  assert.equal(PT.live(PT.fresh('moog')), false);
  assert.equal(PT.live(M15().rec), true);
  const r = recOf('902');
  assert.equal(PT.live(PT.plug(r, 'm1.o2', 'c.out').rec), true);
  assert.equal(PT.live(PT.plug(r, 'm1.o2', 'c.m1').rec), false);
  assert.equal(PT.live(PT.pull(M15().rec, M15().rec.cords.find(c => c.b === 'c.out').id).rec), false);
  assert.equal(PT.live(null), false);
});

// review 1 F4 (r1/walk.mjs: 104 steps of 7 126 disagreed with the evaluator, every one this): the evaluator resolves a multiple into its
// drivers, so the sink fed from a multiple nothing drives is silent — live() follows it (up a P-3 chain too)
test('live (§3.6, review 1 F4): MAIN OUT from a multiple is live only while an output drives its group — directly or up a chain of multiples', () => {
  const r = recOf('921b');
  const und = PT.plug(PT.fresh('moog'), 'c.a3', 'c.out').rec;
  assert.equal(PT.live(und), false, 'an undriven multiple');
  const d = PT.plug(r, 'c.a3', 'c.out').rec;
  assert.equal(PT.live(d), false, 'still undriven (a module beside it)');
  const dr = PT.plug(d, 'm1.sin', 'c.a1').rec;
  assert.equal(PT.live(dr), true, 'an output on the group');
  assert.equal(PT.live(PT.plug(dr, 'c.a2', 'c.m1').rec), true, 'and a read of it elsewhere changes nothing');
  // a chain: sin → A, A → B, B → MAIN OUT; pull the driver and B is fed by nothing
  let c = plugAll(r, [['m1.sin', 'c.a1'], ['c.a2', 'c.b1'], ['c.b2', 'c.out']]);
  assert.equal(PT.live(c), true, 'a driven multiple through a second');
  assert.equal(PT.live(PT.pull(c, c.cords.find(x => x.a === 'm1.sin').id).rec), false, 'the driver pulled: silent');
  // the other multiple of the pair does not count; an input is no source
  assert.equal(PT.live(plugAll(r, [['m1.sin', 'c.a1'], ['c.b2', 'c.out']])), false, 'a driven A beside an undriven B');
  assert.equal(PT.live({ v: 1, f: 'moog', mods: { m1: { t: '921b' } }, cords: [{ id: 'c1', a: 'm1.f1', b: 'c.out' }] }), false, 'an input as the source');
});

// review 1 F5: what the evaluator runs and what it costs — the live nodes (module, section) and the loop steps' members (cv-cost reads them)
test('liveNodes (§3.3, review 1 F5): the (module, section) nodes MAIN OUT is reachable from through cords, multiples, normals and driver links; the loop members; null while MAIN OUT is silent', () => {
  const sec = L => Object.fromEntries(Object.entries(L.sec).map(([k, v]) => [k, v.slice().sort((a, b) => a - b)]));
  const m = M15().rec, L = PT.liveNodes(m), id = t => Object.keys(m.mods).filter(k => m.mods[k].t === t);
  // Classic bass: the keyboard (0), the mixer (1) and MAIN OUT (6); each patched module; the 995's first attenuator; no 923, 907A, second 902; no loop
  assert.deepEqual(sec(L).c, [0, 1, 6]);
  assert.deepEqual(Object.keys(L.sec).sort(), ['c', ...m.cords.flatMap(c => [c.a, c.b]).map(e => e.split('.')[0]).filter(x => x !== 'c')].filter((x, i, a) => a.indexOf(x) === i).sort(), 'every module with a cord');
  assert.deepEqual([L.sec[id('995')[0]], L.sec[id('923')[0]], L.sec[id('907a')[0]], L.sec[id('902')[1]]], [[0], undefined, undefined, undefined]);
  assert.equal(L.loop, 0);
  assert.equal(PT.liveNodes(PT.fresh('moog')), null); assert.equal(PT.liveNodes(null), null);
  assert.equal(PT.liveNodes(PT.plug(PT.fresh('moog'), 'c.a3', 'c.out').rec), null, 'MAIN OUT from an undriven multiple');
  // an island that never reaches MAIN OUT: idle (the 904A's input on a 921's saw, itself on the 904A's output)
  let r = recOf('902', '921', '904a');
  r = plugAll(r, [['m1.o2', 'c.out'], ['m2.saw', 'm3.in'], ['m3.out', 'm2.f1']]);
  assert.deepEqual(sec(PT.liveNodes(r)), { c: [6], m1: [0] });
  assert.equal(PT.liveNodes(r).loop, 0, 'the island\'s loop is not run');
  // the 995's normals: o2 reads i1's source through its normal (the source is live, the first attenuator's section is not); a patched i2 breaks it
  r = plugAll(recOf('995', '921b'), [['m2.sin', 'm1.i1'], ['m1.o2', 'c.out']]);
  assert.deepEqual(sec(PT.liveNodes(r)), { c: [6], m1: [1], m2: [0] });
  r = plugAll(recOf('995', '921b'), [['m2.sin', 'm1.i1'], ['c.kp1', 'm1.i2'], ['m1.o2', 'c.out']]);
  assert.deepEqual(sec(PT.liveNodes(r)), { c: [0, 6], m1: [1] });
  r = plugAll(recOf('995', '921b'), [['m2.sin', 'm1.i1'], ['m1.o3', 'c.out']]);
  assert.deepEqual(sec(PT.liveNodes(r)), { c: [6], m1: [2], m2: [0] }, 'o3 ← i2 ← i1 (the chain)');
  // a multiple resolved into its drivers (and an undriven one: nothing behind it)
  r = plugAll(recOf('921b', '902'), [['m1.sin', 'c.a1'], ['c.a2', 'm2.i1'], ['m2.o2', 'c.out']]);
  assert.deepEqual(sec(PT.liveNodes(r)), { c: [6], m1: [0], m2: [0] });
  // the rear link: a driven 921B reads its driver (the 921A's section 0)
  r = recOf('921a', '921b', '902'); r = PT.setDriver(r, 'm2', 'm1').rec;
  r = plugAll(r, [['m2.sin', 'm3.i1'], ['m3.o2', 'c.out']]);
  assert.deepEqual(sec(PT.liveNodes(r)), { c: [6], m1: [0], m2: [0], m3: [0] });
  // loop steps: a self-cord is one member; two modules into each other two; a chain none
  r = plugAll(recOf('902'), [['m1.o2', 'c.out'], ['m1.o1', 'm1.i1']]);
  assert.equal(PT.liveNodes(r).loop, 1, 'a self-cord');
  r = plugAll(recOf('902', '902'), [['m1.o2', 'c.out'], ['m1.o1', 'm2.i1'], ['m2.o2', 'm1.i1']]);
  assert.equal(PT.liveNodes(r).loop, 2, 'two modules');
  r = plugAll(recOf('902', '902'), [['m1.o2', 'm2.i1'], ['m2.o2', 'c.out']]);
  assert.equal(PT.liveNodes(r).loop, 0, 'a chain');
  // a 995 into itself across sections is no loop (o1 → i2: section 1 reads section 0); section 0 into itself is one
  r = plugAll(recOf('995'), [['m1.o1', 'm1.i2'], ['m1.o2', 'c.out']]);
  assert.equal(PT.liveNodes(r).loop, 0);
  r = plugAll(recOf('995'), [['m1.o1', 'm1.i1'], ['m1.o2', 'c.out']]);
  assert.deepEqual([PT.liveNodes(r).loop, sec(PT.liveNodes(r)).m1], [1, [0, 1]]);
});

test('rackLayout (§4.5): the Model 15 set flush in two rows above the console, on the dots; extras; wraps', () => {
  const m = M15().rec, L = PT.rackLayout(m);
  assert.deepEqual(L, { m1: { x: 0, y: -1024 }, m2: { x: 224, y: -1024 }, m3: { x: 352, y: -1024 }, m4: { x: 480, y: -1024 }, m5: { x: 608, y: -1024 },
    m6: { x: 736, y: -1024 }, m7: { x: 0, y: -512 }, m8: { x: 128, y: -512 }, m9: { x: 480, y: -512 }, m10: { x: 608, y: -512 }, m11: { x: 736, y: -512 },
    m12: { x: 864, y: -512 } });
  for (const k of Object.keys(L)) assert.ok(L[k].x % 32 === 0 && L[k].y % 32 === 0);
  // flush: each row's modules touch, none overlaps (sizes from the table)
  const w = k => T[m.mods[k].t].w;
  for (const row of [['m1', 'm2', 'm3', 'm4', 'm5', 'm6'], ['m7', 'm8', 'm9', 'm10', 'm11', 'm12']]) for (let i = 1; i < row.length; i++) assert.equal(L[row[i]].x, L[row[i - 1]].x + w(row[i - 1]));
  // a module added later sits in its type's place in its row (the row re-flows); a row past 1 024 wraps upward
  const more = PT.addModule(m, {}, '921b').rec, M = PT.rackLayout(more);
  assert.deepEqual(M.m13, { x: 608, y: -1024 });
  assert.deepEqual([M.m5, M.m6], [{ x: 736, y: -1024 }, { x: 864, y: -1024 }]);
  let wide = m;
  for (let i = 0; i < 2; i++) wide = PT.addModule(wide, {}, '902').rec;     // row 2: 992 + 256 → wraps
  const W = PT.rackLayout(wide);
  assert.deepEqual([W.m13, W.m14], [{ x: 0, y: -1024 }, { x: 128, y: -1024 }]);
  assert.equal(W.m1.y, -1536);                                               // row 1 pushed up by row 2's second line
  // a type no row lists goes to the shorter row (here: a newer type, its size from `sizes` or one MU)
  const u = PT.normPatch(Object.assign({}, m, { mods: Object.assign({}, m.mods, { m20: { t: '914' } }), nid: 21 }));
  assert.deepEqual(PT.rackLayout(u).m20, { x: 864, y: -1024 });
  assert.deepEqual(PT.rackLayout(u, 'moog', { m20: { w: 96, h: 512 } }).m20, { x: 864, y: -1024 });
  assert.deepEqual(PT.rackLayout(u, 'moog', mid => (mid === 'm1' ? { w: 256, h: 512 } : null)).m2, { x: 256, y: -1024 });
  assert.deepEqual(PT.rackLayout(PT.fresh('moog')), {});
});

test('freeSlot: the first free slot of the module\'s row, else above the rack', () => {
  const m = M15().rec, L = PT.rackLayout(m);
  const a = PT.addModule(m, {}, '911');
  assert.deepEqual(PT.freeSlot(a.rec, 'moog', a.mid, L), { x: 0, y: -1536 });            // row 2 is full to 992 + 128 > 1 024
  const b = PT.addModule(m, {}, '995');
  assert.deepEqual(PT.freeSlot(b.rec, 'moog', b.mid, L), { x: 864, y: -1024 });
  const L2 = Object.assign({}, L); delete L2.m8;                                           // the 907A moved away: its gap is free
  assert.deepEqual(PT.freeSlot(a.rec, 'moog', a.mid, L2), { x: 128, y: -512 });
});

test('ordinal, title, presetNames', () => {
  const m = M15().rec;
  assert.deepEqual(['m3', 'm4', 'm9', 'm10', 'm1', 'c', 'm99'].map(k => PT.ordinal(m, k)), [1, 2, 1, 2, 1, 1, 0]);
  assert.deepEqual(['m4', 'c', 'm2', 'm99'].map(k => PT.title(m, k)), ['921B 2', 'Controller', '921A 1', '']);
  assert.deepEqual(PT.presetNames('moog'), ['Classic bass', 'Filter sweep', 'Drone', 'Sync lead', 'Wind', 'Bells']);
  assert.deepEqual(PT.presetNames('x'), []);
});

// the section graph (§3.3): nodes (module, section); edges = connections, the 995's normals while unpatched, driver links
function sectionGraph(rec) {
  const typ = mid => (mid === 'c' ? 'ctl' : rec.mods[mid].t), jk = e => { const [mid, p] = e.split('.'); return [mid, T[typ(mid)].jacks.find(j => j.id === p)]; };
  const E = new Map(), add = (a, b) => { if (!E.has(a)) E.set(a, new Set()); E.get(a).add(b); };
  const patched = new Set(rec.cords.map(c => c.b));
  for (const c of rec.cords) { const [ma, ja] = jk(c.a), [mb, jb] = jk(c.b); add(ma + ':' + ja.sec, mb + ':' + jb.sec); }
  for (const mid of Object.keys(rec.mods)) {
    const t = T[typ(mid)];
    for (const j of t.jacks) if (j.norm && !patched.has(mid + '.' + j.id)) add(mid + ':' + t.jacks.find(k => k.id === j.norm).sec, mid + ':' + j.sec);
    if (rec.mods[mid].drv) add(rec.mods[mid].drv + ':0', mid + ':0');
  }
  return E;
}
const reach = (E, from) => { const seen = new Set([from]), st = [from]; while (st.length) for (const n of E.get(st.pop()) || []) if (!seen.has(n)) { seen.add(n); st.push(n); } return seen; };
const hasCycle = E => [...E.keys()].some(n => [...(E.get(n) || [])].some(m => reach(E, m).has(n)));

test('the presets (§2.5): each normPatch-valid on the Model 15 set, Model 15 types only, no feedback loop, sounding through MAIN OUT', () => {
  for (const p of MG.PRESETS) {
    const x = PT.loadPreset(PT.fresh('moog'), {}, p.name, { ensure: MG.M15 });
    assert.equal(x.why, undefined, p.name);
    assert.deepEqual(x.added.length, 12, p.name);                              // a Model 15 set carries every module it needs
    assert.equal(x.rec.cords.length, p.cords.length, p.name + ': every cord plugged');
    assert.deepEqual(PT.normPatch(x.rec), x.rec, p.name);
    assert.deepEqual(invariants(x.rec), [], p.name);
    assert.equal(PT.live(x.rec), true, p.name);
    const E = sectionGraph(x.rec);
    assert.equal(hasCycle(E), false, p.name + ': no loop step');
    if (p.cords.some(([a]) => a.startsWith('c.k'))) assert.ok(reach(E, 'c:0').has('c:6'), p.name + ': the keyboard reaches MAIN OUT');
    // on a fresh record without the set: only its own modules
    const y = PT.loadPreset(PT.fresh('moog'), {}, p.name);
    assert.equal(Object.keys(y.rec.mods).length, p.mods.length, p.name);
    assert.deepEqual(PT.normPatch(y.rec), y.rec, p.name);
  }
  const cb = MG.PRESETS[0], x = PT.loadPreset(PT.fresh('moog'), {}, cb.name);
  assert.equal(cb.name, 'Classic bass'); assert.equal(x.rec.cords.length, 15);
});

test('model15() = loadPreset(fresh, vals, Classic bass, { ensure: M15 }) — and numbered past vals.p\'s orphans', () => {
  for (const vals of [undefined, {}, { gl: 4, p: {} }, { tu: 9, p: { m3: { _t: '904a', fc: 1 }, m7: { _t: '911', t1: 2 } } }]) {
    const a = MG.model15(vals), b = PT.loadPreset(PT.fresh('moog'), vals || {}, 'Classic bass', { ensure: MG.M15 });
    assert.deepEqual(a.rec, b.rec);
    assert.deepEqual(a.vals, b.vals);
  }
  const o = MG.model15({ p: { m7: { _t: '911', t1: 2 } } });
  assert.deepEqual(Object.keys(o.rec.mods)[0], 'm8');
  assert.deepEqual(o.vals.p.m7, { _t: '911', t1: 2 });                         // an orphan stays (pruneVals drops it at the next load)
  const m = MG.model15();
  assert.equal(m.rec.name, 'Classic bass'); assert.equal(m.rec.nid, 13); assert.equal(m.rec.cid, 16);
  assert.deepEqual(m.vals.p.m4, { _t: '921b', rg: 4, fq: 0.02, ss: 1 });
  assert.deepEqual(MG.CTL_IDS.map(id => m.vals[id]), [0, 0, 0, 0, 5, 5, 5, 7, 7]);
  assert.equal(PT.payload(m.rec).pk, PT.payload(MG.model15({}).rec).pk);
});
