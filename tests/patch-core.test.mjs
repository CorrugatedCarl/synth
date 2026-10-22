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
// IMPL-9b §8.2 (lane K9b): rear terminals (never a cord's end), bus rows (resolved by ordinals, unresolved / off / past the bound
// skipped, a delete shifts them; payload / live / liveNodes with vals; without vals the stage-9 payload byte for byte — stage 9's
// own code in tests/ref-9-core —; pk changes with a flip only for a bus switch), a preset over lit routing panels it does not bind
// (off, in back), the sets (makeSet = loadPreset; loadSet(id) / setNeeds; over a Model 15 / a System 35), Tidy's console row and
// the wide rack, freeSlot with a console row, the thirteen presets on their sets, an older build (stage 9's normPatch / pruneVals /
// payload keep a 9b record whole and play its Model 15 part) and the frozen Model 15 records (skeptic #1).
// Pure: no DOM; only numbers / strings / plain records go into assert.
// Run alone: node --max-old-space-size=2048 --test tests/patch-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as PT from '../patch-core.js?v=9';
import * as MG from '../moog-core.js?v=9';
import * as OLD from './ref-9-core/patch-core.js?v=9';                  // stage 9's patch core, verbatim (IMPL-9b §1.1, §8.2)

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
  const u = PT.normPatch({ mods: { m1: { t: '999' }, m2: { t: '902' } }, cords: [{ id: 'c1', a: 'm1.out', b: 'm2.i1', c: 2 }, { id: 'c2', a: 'm1.Bad', b: 'm2.i2' }] }, 'moog');
  assert.deepEqual(u.mods, { m1: { t: '999' }, m2: { t: '902' } });
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
  const types = [...MG.ORDER, 'ctl', '999', 'bad!', 7, null];
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
    // with vals (IMPL-9b §1.4): random switch values on random modules; the rows bounded, typed, out → in
    const vp = {};
    for (const k of Object.keys(a.mods)) if (R() < 0.6 && T[a.mods[k].t]) { const e = { _t: R() < 0.9 ? a.mods[k].t : 'x' }; for (const c of T[a.mods[k].t].params) if (R() < 0.5) e[c.id] = pick([0, 1, 1, 0.6, -3, 9]); vp[k] = e; }
    const vals = { p: vp }, P = PT.payload(a, 'moog', vals), rows = PT.busRows(a, 'moog', vals);
    assert.ok(P.pg.cords.length <= 256 && P.pg.cords.length === PT.payload(a).pg.cords.length + rows.length, 'rows bounded #' + it);
    for (const x of rows) { const ja = jackAt(a, x.a), jb = jackAt(a, x.b); assert.ok(ja && jb && ja.dir === 'out' && jb.dir === 'in' && ja.sig === jb.sig && !jb.norm, 'row #' + it); }
    PT.live(a, 'moog', vals); PT.liveNodes(a, 'moog', vals);
  }
});
const jackAt = (r, e) => { const [m, p] = e.split('.'), t = m === 'c' ? 'ctl' : r.mods[m] && r.mods[m].t; return t && T[t] ? T[t].jacks.find(j => j.id === p) : null; };

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
  const u = PT.normPatch({ mods: { m1: { t: '999' }, m2: { t: '902' } } }, 'moog');
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
  const u = PT.normPatch({ mods: { m1: { t: '904a' }, m2: { t: '921' }, m3: { t: '999' } } }, 'moog');
  const pv = PT.pruneVals({ gl: 3, p: { m1: { _t: '904a', fc: 99, re: 2, zz: 1, rg: 'x' }, m2: { _t: '911', t1: 1 }, m3: { _t: '999', q: 2, s: 'x' }, m9: { _t: '902', fc: 1 }, m4: 5 } }, u);
  assert.deepEqual(pv, { gl: 3, p: { m1: { _t: '904a', fc: 6, re: 2 }, m3: { _t: '999', q: 2 } } });
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
  const u = PT.normPatch(Object.assign({}, m, { mods: Object.assign({}, m.mods, { m20: { t: '999' } }), nid: 21 }));
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
  assert.deepEqual(PT.presetNames('moog'), ['Classic bass', 'Filter sweep', 'Drone', 'Sync lead', 'Wind', 'Bells',
    'Swept band', 'Sequence', 'Twenty-four steps', 'Echo strikes', 'Vowel', 'Step bass', 'Routed']);
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

test('the presets (§2.5; IMPL-9b §2.6): each normPatch-valid on its set (stage 9\'s six the Model 15), no feedback loop, sounding through MAIN OUT', () => {
  const setOf = p => [MG.M15, MG.S35, MG.S55].find(set => { const c = {}; for (const t of set) c[t] = (c[t] || 0) + 1; return p.mods.every(([, t]) => (c[t] = (c[t] || 0) - 1) >= 0); });
  for (const p of MG.PRESETS) {
    const set = setOf(p), x = PT.loadPreset(PT.fresh('moog'), {}, p.name, { ensure: set });
    assert.equal(x.why, undefined, p.name);
    assert.deepEqual(x.added.length, set.length, p.name);                      // its set carries every module it needs
    if (MG.PRESETS.indexOf(p) < 6) assert.equal(set, MG.M15, p.name + ': Model 15 types only');
    assert.equal(x.rec.cords.length, p.cords.length, p.name + ': every cord plugged');
    assert.deepEqual(PT.normPatch(x.rec), x.rec, p.name);
    assert.deepEqual(invariants(x.rec), [], p.name);
    assert.equal(PT.live(x.rec), true, p.name);
    const E = sectionGraph(x.rec);
    assert.equal(hasCycle(E), false, p.name + ': no loop step');
    if (p.cords.some(([a]) => a.startsWith('c.k'))) assert.ok(reach(E, 'c:0').has('c:6'), p.name + ': the keyboard reaches MAIN OUT');
    // the evaluator's view with the routing rows (Routed plays from the keyboard through its switches alone)
    const L = PT.liveNodes(x.rec, 'moog', x.vals);
    assert.ok(L && L.loop === 0, p.name + ': live, no loop step');
    if (!['Drone', 'Wind'].includes(p.name)) assert.ok(L.sec.c.includes(0), p.name + ': the keyboard section live');
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

/* ---------------------------------------------------------------- IMPL-9b §8.2 (lane K9b) */
const S9 = ['Classic bass', 'Filter sweep', 'Drone', 'Sync lead', 'Wind', 'Bells'];
const idsOf = (rec, t) => Object.keys(rec.mods).filter(k => rec.mods[k].t === t).sort((a, b) => +a.slice(1) - +b.slice(1));
const lit = (v, rec, mid, ...sw) => sw.reduce((x, id) => PT.setKnob(x, rec, mid, id, 1), v);
const arrow = x => x.a + '→' + x.b;

test('IMPL-9b §1.3: a rear terminal is no cord\'s end — canPlug / jacksOf / targets / normPatch leave it out; the payload\'s port order keeps it', () => {
  const r = recOf('992', '904b', 'cp2');                                    // m1 992 · m2 904B · m3 CP2
  assert.equal(PT.canPlug(r, 'm1.xr', 'm2.c1').why, 'No such jack');
  assert.equal(PT.canPlug(r, 'c.kp1', 'm3.kpr').why, 'No such jack');
  assert.equal(PT.canPlug(r, 'c.ks1', 'm3.ksr').why, 'No such jack');
  assert.deepEqual([PT.canPlug(r, 'm1.x4', 'c.kp1').a, PT.canPlug(r, 'm1.x4', 'c.kp1').b], ['c.kp1', 'm1.x4']);
  assert.deepEqual(PT.jacksOf(r).filter(j => j.mid !== 'c').map(j => j.end), ['m1.x4', 'm2.in', 'm2.c1', 'm2.c2', 'm2.c3', 'm2.out',
    'm3.li', 'm3.lo', 'm3.hi', 'm3.ho', 'm3.u1', 'm3.u2', 'm3.u3', 'm3.u4', 'm3.po', 'm3.so']);
  assert.ok(!PT.targets(r, 'c.kp1').some(x => /\.(xr|kpr|ksr)$/.test(x.end)) && !PT.targets(r, 'm1.xr').some(x => x.ok));
  const n = PT.normPatch({ mods: r.mods, cords: [{ id: 'c1', a: 'm1.xr', b: 'm2.c1' }, { id: 'c2', a: 'c.ks1', b: 'm3.ksr' }, { id: 'c3', a: 'm1.x4', b: 'c.kp1' }] }, 'moog');
  assert.deepEqual(n.cords.map(c => [c.id, c.a, c.b]), [['c3', 'c.kp1', 'm1.x4']]);
  assert.equal(PT.cordAt(n, 'm1.xr'), null);
  assert.equal(PT.plug(r, 'm1.xr', 'm2.c1').why, 'No such jack');
  // the rear terminals stay payload ports: a CP2's always-on rows reach them (kpr / ksr: its jacks 10 and 11)
  const P = PT.payload(r, 'moog', {}).pg;
  assert.deepEqual(P.cords, [[0, T.ctl.jacks.findIndex(j => j.id === 'kp1'), 3, 10, 1], [0, T.ctl.jacks.findIndex(j => j.id === 'ks1'), 3, 11, 1]]);
});

test('IMPL-9b §1.4: bus rows — resolved by ordinals from the switches in vals, a delete moves them, unresolved ones skipped with their reason; isBusKnob', () => {
  const S = MG.makeSet('s55', {}), rec = S.rec, id = t => idsOf(rec, t);
  const [p992] = id('992'), [p993] = id('993'), [cp2] = id('cp2'), cp3 = id('cp3a'), e = id('911'), a = id('902'), [dl] = id('911a'), dr = id('921a'), [o921] = id('921'), [hp] = id('904b');
  // the starter (Sequence) binds no routing panel: nothing lit — the CP2's two always-on rows only; vals absent: none
  assert.deepEqual(PT.busRows(rec, 'moog', S.vals).map(arrow), ['c.kp1→' + cp2 + '.kpr', 'c.ks1→' + cp2 + '.ksr']);
  assert.deepEqual(PT.busRows(rec, 'moog'), []);
  let v = lit(S.vals, rec, p993, 'f1', 't1', 't2', 't3', 'e1', 'e2', 'e3');
  v = lit(lit(lit(v, rec, cp3[0], 'r1'), rec, cp3[2], 'r2'), rec, p992, 's4');
  const R = PT.busRows(rec, 'moog', v);
  assert.deepEqual(R.map(x => x.panel + ' ' + arrow(x)), [                 // by panel number, then row: 992, 993, CP2, CP3A 1, CP3A 3
    `${p992} ${p992}.xr→${hp}.c3`,
    `${p993} c.ks1→${dl}.i1`, `${p993} c.ks1→${e[0]}.trg`, `${p993} ${dl}.o1→${e[1]}.trg`, `${p993} ${dl}.o2→${e[2]}.trg`,
    `${p993} ${e[0]}.out→${a[0]}.c3`, `${p993} ${e[1]}.out→${a[1]}.c3`, `${p993} ${e[2]}.out→${a[2]}.c3`,
    `${cp2} c.kp1→${cp2}.kpr`, `${cp2} c.ks1→${cp2}.ksr`,
    `${cp3[0]} c.kp1→${dr[0]}.f3`, `${cp3[2]} c.kw→${o921}.f3`]);           // CP3A k → the k-th driver: 921As by number, then the 921
  assert.deepEqual(R.find(x => x.panel === p993 && x.i === 2), { a: 'c.ks1', b: e[0] + '.trg', g: 1, panel: p993, i: 2, sw: ['f1', 't1'] });
  // FROM 1 and TRIGGER 1 both needed for the left 911; FROM 2 alone reaches the 911A
  assert.deepEqual(PT.busRows(rec, 'moog', lit(S.vals, rec, p993, 't1', 'f2')).filter(x => x.panel === p993).map(arrow), ['c.ks2→' + dl + '.i1', 'c.ks2→' + e[0] + '.trg']);
  // positions are ordinals: delete 911 1 and the 993's rows move to the next 911s; delete 921A 1 and CP3A 3 finds no third driver
  const d1 = PT.removeModule(rec, e[0]).rec;
  assert.deepEqual(PT.busRows(d1, 'moog', v).filter(x => x.panel === p993).map(arrow), [`c.ks1→${dl}.i1`, `c.ks1→${e[1]}.trg`, `${dl}.o1→${e[2]}.trg`,
    `${dl}.o2→${e[3]}.trg`, `${e[1]}.out→${a[0]}.c3`, `${e[2]}.out→${a[1]}.c3`, `${e[3]}.out→${a[2]}.c3`]);
  const d2 = PT.removeModule(rec, dr[0]).rec;
  assert.deepEqual(PT.busRows(d2, 'moog', v).filter(x => cp3.includes(x.panel)).map(arrow), [`c.kp1→${dr[1]}.f3`]);
  assert.deepEqual(PT.busInfo(d2, 'moog', v, cp3[2]).map(x => [x.sw.join(), x.on, x.ok, x.why]), [['r1', false, false, 'Off'],
    ['r2', true, false, 'No 921A / 921 3 in this patch'], ['r3', false, false, 'Off'], ['r4', false, false, 'Off']]);
  const few = recOf('993', '911', '911', '911a');                          // two 911s: the right 911 is missing
  const fv = lit({}, few, 'm1', 't3');
  assert.deepEqual(PT.busInfo(few, 'moog', fv, 'm1').find(x => x.sw.join() === 't3'), { i: 5, sw: ['t3'], on: true, a: 'm4.o2', b: null, ok: false, why: 'No 911 3 in this patch' });
  assert.deepEqual(PT.busRows(few, 'moog', fv), []);
  assert.deepEqual(PT.busInfo(few, 'moog', null, 'm1').map(x => x.why), Array(9).fill('Off'));
  // isBusKnob: a routing switch of its type — not its other knobs, not the controller's, not another type's
  assert.deepEqual([[p993, 'f1'], [p993, 'e3'], [p992, 's4'], [p992, 'at'], [cp3[1], 'r4'], [cp3[1], 'x1'], [cp3[1], 'ra'], ['c', 'gl'], [hp, 'fc'], ['m99', 'f1']]
    .map(([m, k]) => PT.isBusKnob(rec, m, k)), [true, true, true, false, true, false, false, false, false, false]);
});

test('IMPL-9b §1.4: payload / live / liveNodes with vals — rows after the sorted cords; without vals stage 9\'s payload byte for byte; pk moves with a bus switch only', () => {
  // the Model 15 records: the new code with and without vals = stage 9's own payload (tests/ref-9-core), byte for byte
  const recs = [MG.model15({}), ...S9.map(n => PT.loadPreset(PT.fresh('moog'), {}, n, { ensure: MG.M15 })), ...S9.map(n => PT.loadPreset(PT.fresh('moog'), {}, n))];
  for (const x of recs) {
    const old = JSON.stringify(OLD.payload(x.rec));
    assert.equal(JSON.stringify(PT.payload(x.rec)), old, x.rec.name);
    assert.equal(JSON.stringify(PT.payload(x.rec, 'moog', x.vals)), old, x.rec.name + ' (vals: no routing panel)');
    assert.equal(PT.live(x.rec, 'moog', x.vals), OLD.live(x.rec)); assert.deepEqual(PT.liveNodes(x.rec, 'moog', x.vals), OLD.liveNodes(x.rec));
  }
  // a System 55 with routing lit: the rows follow the cords (each part sorted), the cords part = the payload without vals
  const S = MG.makeSet('s55', {}), rec = S.rec, [p993] = idsOf(rec, '993'), [p992] = idsOf(rec, '992'), [hp] = idsOf(rec, '904b');
  const v = lit(S.vals, rec, p993, 'f1', 't1', 'e1'), P = PT.payload(rec, 'moog', v).pg, P0 = PT.payload(rec).pg, nr = PT.busRows(rec, 'moog', v).length;
  assert.equal(nr, 5);
  assert.deepEqual(P.cords.slice(0, P0.cords.length), P0.cords);
  assert.equal(P.cords.length, P0.cords.length + nr);
  const sorted = L => L.every((x, i) => !i || [0, 1, 2, 3, 4].reduce((c, k) => c || L[i - 1][k] - x[k], 0) <= 0);
  assert.ok(sorted(P.cords.slice(-nr)) && sorted(P0.cords));
  assert.deepEqual(P.mods, P0.mods);
  // pk: a bus switch flips it; any other knob (the 992's attenuator, a filter) leaves it
  const k0 = PT.payload(rec, 'moog', v).pk;
  assert.notEqual(PT.payload(rec, 'moog', PT.setKnob(v, rec, p993, 'f2', 1)).pk, k0);
  assert.notEqual(PT.payload(rec, 'moog', PT.setKnob(v, rec, p992, 's1', 1)).pk, k0);
  assert.notEqual(PT.payload(rec, 'moog', PT.setKnob(v, rec, p993, 't2', 1)).pk, k0, 't2 lit: the 911A\'s OUTPUT 1 reaches 911 2');
  assert.equal(PT.payload(rec, 'moog', PT.setKnob(v, rec, p992, 'at', 5)).pk, k0);
  assert.equal(PT.payload(rec, 'moog', PT.setKnob(v, rec, hp, 'fc', 3)).pk, k0);
  // a routed envelope makes its 911 live; FROM 1 · TRIGGER 1 its trigger's source (the keyboard section)
  let r = recOf('921b', '902', '911', '993');                             // m1 921B · m2 902 · m3 911 · m4 993
  r = plugAll(r, [['m1.saw', 'm2.i1'], ['m2.o2', 'c.out']]);
  const sec = L => Object.fromEntries(Object.entries(L.sec).map(([k, x]) => [k, x.slice().sort((p, q) => p - q)]));
  assert.deepEqual(sec(PT.liveNodes(r)), { c: [6], m1: [0], m2: [0] });
  assert.deepEqual(sec(PT.liveNodes(r, 'moog', lit({}, r, 'm4', 'e1'))), { c: [6], m1: [0], m2: [0], m3: [0] });
  assert.deepEqual(sec(PT.liveNodes(r, 'moog', lit({}, r, 'm4', 'e1', 'f1', 't1'))), { c: [0, 6], m1: [0], m2: [0], m3: [0] });
  assert.deepEqual(sec(PT.liveNodes(r, 'moog', lit({}, r, 'm4', 'f1', 't1'))), { c: [6], m1: [0], m2: [0] }, 'a 911 nothing reads stays idle');
  // MAIN OUT from a CP2's PITCH OUT: its keyboard section reads the controller only through its always-on row (with vals)
  const c2 = PT.plug(recOf('cp2'), 'm1.po', 'c.out').rec;
  assert.deepEqual(sec(PT.liveNodes(c2)), { c: [6], m1: [3] });
  assert.deepEqual(sec(PT.liveNodes(c2, 'moog', {})), { c: [0, 6], m1: [3] });
  assert.equal(PT.live(c2, 'moog', {}), true);
});

test('IMPL-9b §1.4 (skeptic #33; R2a F5): the rows\' bound — cords + merged rows ≤ 256, the rest skipped with their reason, in panel order; never into a normalled input', () => {
  // 44 CP4As (10 rows each: the six through c.kp1 / c.kw / c.ka / c.ks1 are one set for all, each panel's own CV / TRIGGER (REAR) rows 4 of its own — 182
  // connections) after 128 cords (the controller's PITCH 1 / PITCH 2 / WHEEL → the panels' CV INs, built in the record: the bound reads cords, not the one-plug rule)
  let r = recOf('904a', '911', '911', '911');
  for (let i = 0; i < 44; i++) r = PT.addModule(r, {}, 'cp4a').rec;
  const cords = [];
  for (const src of ['c.kp1', 'c.kp2', 'c.kw']) for (let m = 5; m <= 48; m++) if (cords.length < 128) cords.push({ id: 'c' + (cords.length + 1), a: src, b: 'm' + m + '.ci', c: 0 });
  r = Object.assign({}, r, { cords, cid: 129 });
  let v = {};
  for (const k of Object.keys(r.mods)) { const t = T[r.mods[k].t]; if (t.bus) v = lit(v, r, k, ...t.params.filter(c => c.t === 's').map(c => c.id)); }
  const rows = PT.busRows(r, 'moog', v), P = PT.payload(r, 'moog', v).pg;
  assert.equal(rows.length, 128);                                           // 256 − 128 cords
  assert.equal(P.cords.length, 256);
  assert.equal(new Set(P.cords.map(x => x.slice(0, 4).join())).size, 256, 'every connection a distinct pair');
  // m5 takes its 10 rows (the shared six included), each later panel its own 4: 10 + 29 × 4 = 126 (m5 … m34); m35's CV (REAR) and its first TRIGGER (REAR) make 128
  assert.equal(rows.at(-1).panel, 'm35'); assert.deepEqual(rows.filter(x => x.panel === 'm35').map(x => x.i), [3, 5]);
  const dup = 'Already routed by CP4A 1', cap = 'A patch holds at most 256 connections';
  const first = PT.busInfo(r, 'moog', v, 'm5'), mid = PT.busInfo(r, 'moog', v, 'm20'), edge = PT.busInfo(r, 'moog', v, 'm35'), late = PT.busInfo(r, 'moog', v, 'm48');
  assert.ok(first.every(x => x.ok), 'the first panel holds the shared rows');
  assert.deepEqual(mid.map(x => x.ok), [false, false, false, true, false, true, false, true, false, true], 'a later panel: its own rear wires only');
  assert.ok(mid.filter(x => !x.ok).every(x => x.why === dup));
  assert.deepEqual(edge.map(x => x.why), [dup, dup, dup, '', dup, '', dup, cap, dup, cap]);
  assert.deepEqual(late.map(x => x.why), [dup, dup, dup, cap, dup, cap, dup, cap, dup, cap]);
  for (const x of rows) assert.equal(jackAt(r, x.b).norm, undefined);
});

test('IMPL-9b R2a F5: two connections of one source to one input are one — a duplicated lit 993 / 992 adds nothing (the payload, the rows, live unchanged; the copy\'s tips say why); a routing switch closing a cord\'s own pair adds nothing (the cord\'s gain stays)', () => {
  const S = MG.makeSet('s55', {}), [p993] = idsOf(S.rec, '993'), [p992] = idsOf(S.rec, '992');
  // a lit 993 duplicated: the copy carries the lit switches and resolves to the same ends (ordinals are absolute) — one connection each
  for (const [mid, sw] of [[p993, ['f1', 't1', 'e1']], [p993, ['f1', 't1', 't2', 't3', 'e1', 'e2', 'e3']], [p992, ['s1']], [p992, ['s1', 's2', 's3']]]) {
    const v1 = lit(S.vals, S.rec, mid, ...sw), P1 = PT.payload(S.rec, 'moog', v1), R1 = PT.busRows(S.rec, 'moog', v1);
    const D = PT.duplicateModule(S.rec, v1, mid), v2 = D.vals;
    assert.ok(D.mid && D.mid !== mid);
    assert.deepEqual(sw.map(id => PT.getKnob(v2, D.rec, D.mid, id)), sw.map(() => 1), 'the copy is lit too');
    const P2 = PT.payload(D.rec, 'moog', v2), R2 = PT.busRows(D.rec, 'moog', v2);
    assert.deepEqual(P2.pg.cords, P1.pg.cords, mid + ' ' + sw.join(''));                    // (the mods list gains the copy: pk moves with it, not the connections)
    assert.deepEqual(P2.pg.mods.slice(0, -1), P1.pg.mods);
    assert.deepEqual(R2.map(x => [x.panel, x.i]), R1.map(x => [x.panel, x.i]), 'only the first panel\'s rows connect');
    assert.equal(PT.live(D.rec, 'moog', v2), PT.live(S.rec, 'moog', v1));
    assert.deepEqual(new Set(P2.pg.cords.map(x => x.join())).size, P2.pg.cords.length, 'no repeated 5-tuple');
    const ti = PT.busInfo(D.rec, 'moog', v2, D.mid).filter(x => x.on), t1 = PT.busInfo(D.rec, 'moog', v1, mid).filter(x => x.on);
    assert.ok(ti.length && ti.every(x => !x.ok && x.why === 'Already routed by ' + (mid === p993 ? '993' : '992') + ' 1'), JSON.stringify(ti.map(x => x.why)));
    assert.ok(t1.every(x => x.ok), 'the first panel\'s rows stay connections');
  }
  // the copy comes later in the order (numbers only grow); delete the first and the copy takes the rows over
  { const v1 = lit(S.vals, S.rec, p992, 's1'), D = PT.duplicateModule(S.rec, v1, p992), G = PT.removeModule(D.rec, p992).rec;
    assert.deepEqual(PT.busRows(G, 'moog', D.vals).filter(x => x.b.endsWith('.c3')).map(x => x.panel + ' ' + x.i), [D.mid + ' 0']); }
  // a copy's own rear terminal is its own wire (EXT IN · attenuator → the 904B): not a pair of the first's
  { const v1 = lit(S.vals, S.rec, p992, 's1', 's4'), D = PT.duplicateModule(S.rec, v1, p992);
    assert.deepEqual(PT.busRows(D.rec, 'moog', D.vals).filter(x => x.panel === p992 || x.panel === D.mid).map(x => x.panel + ' ' + x.i), [p992 + ' 0', p992 + ' 3', D.mid + ' 3']); }
  // a cord and a row of the same pair: the cord stays (its gain), the row is skipped — whichever was made first
  let r = recOf('992', '904b');                                           // m1 992 · m2 904B
  r = plugAll(r, [['c.kp1', 'm2.c3']]);
  r.cords[0] = Object.assign({}, r.cords[0], { g: 2.5 });
  const v = lit({}, r, 'm1', 's1'), P = PT.payload(r, 'moog', v), P0 = PT.payload(r, 'moog');
  assert.deepEqual(P.pg.cords, P0.pg.cords, 'the switch adds nothing');
  assert.equal(P.pk, P0.pk);
  assert.deepEqual(P.pg.cords.map(x => x[4]), [2.5], 'the cord\'s gain');
  assert.deepEqual(PT.busRows(r, 'moog', v), []);
  assert.deepEqual(PT.busInfo(r, 'moog', v, 'm1').filter(x => x.on).map(x => [x.ok, x.why]), [[false, 'Already patched by a cord']]);
  // another pair of the same panel is still a connection (the keyboard's gate → the same input is a different source)
  const v2 = lit(v, r, 'm1', 's2');
  assert.deepEqual(PT.busRows(r, 'moog', v2).map(arrow), ['c.kw→m2.c3']);
  assert.equal(PT.payload(r, 'moog', v2).pg.cords.length, 2);
  // two rows of one panel with one pair (CP4A: KEYBOARD CV and the trigger rows share c.ks1 → 911 k only through different switches)
  const q = recOf('904a', '911', '911', '911', 'cp4a');
  const vq = lit({}, q, 'm5', 't1');                                      // t1: c.ks1 → 911 1 TRIG, and the panel's own TRIGGER (REAR) → 911 1 TRIG
  assert.deepEqual(PT.busRows(q, 'moog', vq).map(arrow), ['c.ks1→m2.trg', 'm5.tr→m2.trg']);
  const q2 = PT.duplicateModule(q, vq, 'm5'), vq2 = q2.vals;
  assert.deepEqual(PT.busRows(q2.rec, 'moog', vq2).map(x => x.panel + ' ' + arrow(x)), ['m5 c.ks1→m2.trg', 'm5 m5.tr→m2.trg', q2.mid + ' ' + q2.mid + '.tr→m2.trg'], 'the shared pair once; the copy\'s own rear wire is its own');
});

test('IMPL-9b §1.4 (skeptic #6): a preset switches off every routing panel it does not bind (in back: undo puts them back); its own as written', () => {
  const S = MG.makeSet('s55', {}), rec = S.rec, [p993] = idsOf(rec, '993'), [p992] = idsOf(rec, '992'), cp3 = idsOf(rec, 'cp3a'), [cp2] = idsOf(rec, 'cp2');
  const v = lit(lit(lit(S.vals, rec, p993, 'f1', 't1', 'e1'), rec, cp3[1], 'r1', 'r3'), rec, p992, 's2');
  assert.equal(PT.busRows(rec, 'moog', v).length, 3 + 2 + 1 + 2);
  const L = PT.loadPreset(rec, v, 'Classic bass');
  assert.deepEqual(PT.busRows(L.rec, 'moog', L.vals).map(arrow), ['c.kp1→' + cp2 + '.kpr', 'c.ks1→' + cp2 + '.ksr'], 'only the always-on rows');
  assert.deepEqual([L.vals.p[p993].f1, L.vals.p[p993].t1, L.vals.p[p993].e1, L.vals.p[cp3[1]].r1, L.vals.p[cp3[1]].r3, L.vals.p[p992].s2], [0, 0, 0, 0, 0, 0]);
  assert.equal(L.vals.p[cp3[1]].x1, v.p[cp3[1]].x1, 'an unbound panel\'s other knobs untouched');
  for (const [m, k] of [[p993, 'f1'], [p993, 't1'], [p993, 'e1'], [cp3[1], 'r1'], [cp3[1], 'r3'], [p992, 's2']]) assert.ok(L.back.f.some(([p, b, x]) => p.join() === ['p', m, k].join() && b === 1 && x === 0), m + '.' + k);
  assert.ok(!L.back.f.some(([p]) => p[1] === cp3[0] || p[1] === cp3[2]), 'unlit panels: nothing written');
  const U = PT.ptBack(L.vals, L.back, false);
  assert.ok(U.ok); assert.deepEqual(U.vals, v);
  // a preset that binds a routing panel writes its switches as its own (Routed: CP3A 1 KEYBOARD, the 993's FROM 1 · TRIGGER 1 / 2 · ENVELOPE 1)
  const R = PT.loadPreset(rec, v, 'Routed'), rows = PT.busRows(R.rec, 'moog', R.vals);
  assert.deepEqual(rows.filter(x => x.panel !== cp2).map(x => x.panel + ' ' + x.sw.join('+')), [p993 + ' f1', p993 + ' f1+t1', p993 + ' t2', p993 + ' e1', cp3[0] + ' r1']);
  assert.deepEqual([R.vals.p[p992].s2, R.vals.p[cp3[1]].r1, R.rec.cords.length], [0, 0, 6]);
  // Init patch: every switch at its default (off)
  const I = PT.initPatch(rec, v);
  assert.equal(PT.busRows(I.rec, 'moog', I.vals).length, 2);
});

test('IMPL-9b §1.2: the sets — makeSet = loadPreset(fresh, vals, starter, { ensure: set }); loadSet(id); setNeeds; a System 55 over a Model 15 / a System 35', () => {
  for (const id of ['m15', 's35', 's55']) for (const vals of [undefined, {}, { gl: 4, p: {} }, { tu: 9, p: { m3: { _t: '904a', fc: 1 }, m7: { _t: '911', t1: 2 } } }]) {
    const S = MG.FAMILY.sets[id], a = MG.makeSet(id, vals), b = PT.loadPreset(PT.fresh('moog'), vals || {}, S.starter, { ensure: S.set });
    assert.equal(b.why, undefined, id);
    assert.deepEqual(a.rec, b.rec, id); assert.deepEqual(a.vals, b.vals, id);
    assert.deepEqual(PT.normPatch(a.rec), a.rec, id);
    assert.deepEqual(invariants(a.rec), [], id);
  }
  assert.equal(JSON.stringify(MG.makeSet('m15', {})), JSON.stringify(MG.model15({})));
  assert.equal(MG.makeSet('nope', {}), null); assert.equal(MG.makeSet(undefined), null);
  const s35 = MG.makeSet('s35', {}), s55 = MG.makeSet('s55', {});
  assert.deepEqual([Object.keys(s35.rec.mods).length, s35.rec.name, s35.rec.cords.length], [22, 'Swept band', 20]);
  assert.deepEqual([Object.keys(s55.rec.mods).length, s55.rec.name, s55.rec.cords.length], [37, 'Sequence', 24]);
  // the drivers: three 921Bs on each 921A in the 55; two each in the 35 after Swept band rebinds them
  const drives = r => idsOf(r, '921a').map(d => Object.keys(r.mods).filter(k => r.mods[k].drv === d).length);
  assert.deepEqual([drives(s55.rec), drives(s35.rec)], [[3, 3], [2, 2]]);
  // setNeeds / loadSet over a Model 15 (+ 27 = 39) and a System 35 (+ 19 = 41)
  const m = MG.model15({});
  assert.deepEqual([PT.setNeeds(m.rec, 's55'), PT.setNeeds(s35.rec, 's55'), PT.setNeeds(PT.fresh('moog'), 's35'), PT.setNeeds(m.rec, 'm15'), PT.setNeeds(m.rec), PT.setNeeds(m.rec, 'nope')],
    [27, 19, 22, 0, 0, -1]);
  const L1 = PT.loadSet(m.rec, m.vals, 's55'), L2 = PT.loadSet(s35.rec, s35.vals, 's55');
  assert.deepEqual([L1.added.length, Object.keys(L1.rec.mods).length, L1.rec.name, L2.added.length, Object.keys(L2.rec.mods).length], [27, 39, 'Sequence', 19, 41]);
  assert.deepEqual(PT.ptBack(L1.vals, L1.back, false).vals, m.vals);
  assert.deepEqual(PT.loadSet(m.rec, m.vals), PT.loadSet(m.rec, m.vals, 'm15'));
  assert.equal(PT.loadSet(m.rec, m.vals, 'nope').why, 'No such set'); assert.equal(PT.loadSet(m.rec, m.vals, 'nope').rec, m.rec);
  let full = m.rec;
  for (let i = 0; i < 30; i++) full = PT.addModule(full, {}, '995').rec;                 // 42 modules: 27 more would pass 48
  assert.equal(PT.setNeeds(full, 's55'), 27);
  assert.equal(PT.loadSet(full, m.vals, 's55').why, 'A patch holds at most 48 modules');
});

test('IMPL-9b §4.4: Tidy — the console row flush above the controller, the cabinet rows above it, the wide rack; freeSlot on those lines', () => {
  const W = { s35: [1120, 1376, 1920], s55: [2624, 2368, 2496] };
  for (const id of ['s35', 's55']) {
    const { rec } = MG.makeSet(id, {}), L = PT.rackLayout(rec), ks = Object.keys(rec.mods), con = k => MG.CONSOLE.includes(rec.mods[k].t);
    const row = k => (con(k) ? 2 : MG.ROWS.findIndex(r => r.includes(rec.mods[k].t)));
    assert.equal(ks.filter(k => L[k]).length, ks.length);
    for (const k of ks) assert.equal(L[k].y, [-1376, -864, -352][row(k)], id + ' ' + k + ' row');
    for (const k of ks) assert.ok(L[k].x % 32 === 0 && L[k].y % 32 === 0 && L[k].x + T[rec.mods[k].t].w <= 2816, id + ' ' + k);
    for (let r = 0; r < 3; r++) {                                             // flush from x 0, one line each, no overlap
      const line = ks.filter(k => row(k) === r).sort((p, q) => L[p].x - L[q].x);
      line.forEach((k, i) => assert.equal(L[k].x, i ? L[line[i - 1]].x + T[rec.mods[line[i - 1]].t].w : 0));
      assert.equal(line.reduce((w, k) => w + T[rec.mods[k].t].w, 0), W[id][r]);
    }
    const [c960] = idsOf(rec, '960');
    if (c960) assert.deepEqual(L[c960], { x: 1632, y: -1376 });              // after 921 · 921A × 2 · 921B × 6 · 903A · 995 · 994
  }
  // a Model 15 with one console panel: the rack widens (no wrap) and its rows sit above the console row; ≤ 16 modules without: 1 024
  const m = MG.model15({}).rec, w = PT.addModule(m, {}, 'cp8a'), Lw = PT.rackLayout(w.rec);
  assert.deepEqual([Lw[w.mid], Lw.m1, Lw.m7], [{ x: 0, y: -352 }, { x: 0, y: -1376 }, { x: 0, y: -864 }]);
  let big = m;
  for (let i = 0; i < 5; i++) big = PT.addModule(big, {}, '902').rec;     // 17 modules, row 2 at 1 632 px: one line on the wide rack
  assert.ok(Object.values(PT.rackLayout(big)).every(p => p.y === -1024 || p.y === -512));
  let m16 = m;
  for (let i = 0; i < 4; i++) m16 = PT.addModule(m16, {}, '902').rec;      // 16 modules: still 1 024 (row 2 wraps upward)
  assert.equal(PT.rackLayout(m16).m1.y, -1536);
  // freeSlot: a console module on the console row's line; a 5U module on its row's line above it (skeptic #13)
  const s55 = MG.makeSet('s55', {}).rec, L = PT.rackLayout(s55);
  const add = t => { const x = PT.addModule(s55, {}, t); return PT.freeSlot(x.rec, 'moog', x.mid, L); };
  assert.deepEqual([add('clk'), add('921b'), add('914'), add('911')], [{ x: 2496, y: -352 }, { x: 2624, y: -1376 }, { x: 2368, y: -864 }, { x: 2368, y: -864 }]);
  assert.deepEqual(add('cp2'), { x: 0, y: -352 - 3 * 512 }, 'no room left on the console line (2 496 + 352 > 2 816): above the rack');
  const Lm = PT.rackLayout(m), x8 = PT.addModule(m, {}, 'cp8a');             // the Model 15's own places (rows at −1 024 / −512), a console panel tapped in:
  assert.deepEqual(PT.freeSlot(x8.rec, 'moog', x8.mid, Lm), { x: 992, y: -352 });   // its line, clear of row 2 (992 px wide)
  const x9 = PT.addModule(x8.rec, {}, '911');                               // with that console module present: row 2's line at −864
  assert.deepEqual(PT.freeSlot(x9.rec, 'moog', x9.mid, Object.assign({}, Lm, { [x8.mid]: { x: 992, y: -352 } })), { x: 992, y: -864 });
});

test('IMPL-9b §1.1 (skeptic #11): an older build — stage 9\'s normPatch / pruneVals / payload keep a 9b record whole and play its Model 15 part', () => {
  // a System 55 patched as Sequence, plus the System 35's panels, cords to their jacks and their knobs: every type
  const S = MG.makeSet('s55', {});
  let rec = S.rec, vals = S.vals;
  for (const t of ['cp4a', 'cp35', '923', '907a']) rec = PT.addModule(rec, vals, t).rec;
  const [c35] = idsOf(rec, 'cp35'), [c4] = idsOf(rec, 'cp4a');
  rec = plugAll(rec, [['c.kp2', c35 + '.i1'], [c35 + '.o1', idsOf(rec, '904b')[0] + '.c1'], ['c.ks2', c4 + '.ti']]);
  vals = lit(PT.setKnob(vals, rec, c35, 'a1', 6), rec, c4, 't1');
  assert.deepEqual([...new Set(Object.values(rec.mods).map(x => x.t))].sort(), [...MG.ORDER].sort(), 'every type');
  const O = OLD.normPatch(J(rec), 'moog');
  assert.deepEqual(O, rec, 'kept whole: modules, drivers, cords');
  assert.deepEqual(OLD.pruneVals(J(vals), O), PT.pruneVals(vals, rec), 'its knobs kept');
  assert.deepEqual(OLD.pruneVals(J(vals), O).p, vals.p);
  // its payload: the Model 15 types and the cords between them, the same ports (the 9b modules play silent)
  const s9 = new Set(['921', '921a', '921b', '923', '904a', '907a', '902', '911', '995']), P = PT.payload(rec).pg;
  const keep = new Set(P.mods.filter(x => !x[0] || s9.has(x[1])).map(x => x[0]));
  assert.deepEqual(OLD.payload(rec).pg, { v: 1, f: 'moog', mods: P.mods.filter(x => keep.has(x[0])), cords: P.cords.filter(c => keep.has(c[0]) && keep.has(c[2])) });
  assert.ok(OLD.payload(rec).pg.mods.length < P.mods.length && OLD.payload(rec).pg.cords.length < P.cords.length);
});

// skeptic #1: the Model 15 records as stage 9 built them — payload(rec).pk and sha256 of JSON.stringify of pvOf(vals), rec and vals —
// computed by lane K9b from the base tree before its first edit (= tests/ref-9-core/MANIFEST.json's `records`); golden-moog shares
// moog-core / patch-core between its sides, so only this pin sees them. The 9b presets are pinned the same way at ref-9b's freeze.
const FROZEN = {
  model15: { pk: '088e7464', pv: '98efe346c0a951e47f6a557c57be1b1b5472238d79bc6882a46306feaf66a818', rec: '27b60bb419f6043c5e1249ac753460ebdf4cbd26d4cf549f025f75fe3b43e4fa', vals: '61b9d79f19c66ab0da0ddd72745ecfdd14e91a671bbaf9a4bd1499f3d2cfb396' },
  'makeSet m15': { pk: '088e7464', pv: '98efe346c0a951e47f6a557c57be1b1b5472238d79bc6882a46306feaf66a818', rec: '27b60bb419f6043c5e1249ac753460ebdf4cbd26d4cf549f025f75fe3b43e4fa', vals: '61b9d79f19c66ab0da0ddd72745ecfdd14e91a671bbaf9a4bd1499f3d2cfb396' },
  'Classic bass': { pk: '088e7464', pv: '98efe346c0a951e47f6a557c57be1b1b5472238d79bc6882a46306feaf66a818', rec: '27b60bb419f6043c5e1249ac753460ebdf4cbd26d4cf549f025f75fe3b43e4fa', vals: '61b9d79f19c66ab0da0ddd72745ecfdd14e91a671bbaf9a4bd1499f3d2cfb396' },
  'Filter sweep': { pk: '34cd5c57', pv: '63284579610f38bf454dbc262540b84e0e31d76415df377068b8e0f116c1c12f', rec: '8fa390fc7f0e84333552e0f4c68bd57fd004c335b268b73a059503499e9df1fb', vals: '9bfb6220909657e0ab5f8c34cf02be1566df6063cb38b21908a5ed19d8550f8a' },
  Drone: { pk: '1afa66ec', pv: '78bf8341dc8acd610fbd57e71e7c03997516b801f2538071d06b1b263ddbfa18', rec: '3f12cb66840114f8a0af55020365fba532aff2b626c251abbef38e9b92567d9c', vals: '7f2c9bd4137967998990af9dbde28eae41fc897748f122749906251d883305b5' },
  'Sync lead': { pk: '48642403', pv: 'c0ead1dd56f73cf4929a7196e59101b96947e29227265c34d5b124d8ca6c9253', rec: '4136d6c64ef1dad6b49e8574b3fb5dd6e798b8ed1fad858f45ef253a3146b6a1', vals: 'f4ac1ed1321c6a0f7dad555b412a49ff4a978790a85b1bb99c2433a6305bc509' },
  Wind: { pk: 'b36efbc5', pv: '381c51c269a7a97b4bad61354febae330977453f5a125caf0705840382c9102c', rec: 'e3b7d336b2ea500fab1c763bfc621908ed26b4b1eb31eec0673bc51821020768', vals: 'abd0d97442a15a0a13a18d2d48ec05d7f1596d2a97b49943cf1b0d59680d2920' },
  Bells: { pk: '61ec3625', pv: 'e6689a4b1e9fa93679b2603bc563f1de7d0724c2abdf82d41995fcb63ff93d3b', rec: '85fff2b8d1ec3d88ee0048a11b09f0517aed9ae807a8dc2b11972a9489da4d6e', vals: '7e5ae34d33d85b27d601616d615444a454b15f363c5130a5398d4bd7cba969e7' },
};
test('skeptic #1 (IMPL-9b §8.2): the Model 15 records frozen — model15, makeSet(\'m15\') and stage 9\'s six presets: pk, pvOf, rec, vals as at the base', () => {
  const sha = x => createHash('sha256').update(x).digest('hex');
  const row = ({ rec, vals }) => ({ pk: PT.payload(rec).pk, pv: sha(JSON.stringify(MG.pvOf(vals))), rec: sha(JSON.stringify(rec)), vals: sha(JSON.stringify(vals)) });
  const now = { model15: row(MG.model15({})), 'makeSet m15': row(MG.makeSet('m15', {})) };
  for (const n of S9) now[n] = row(PT.loadPreset(PT.fresh('moog'), {}, n, { ensure: MG.M15 }));
  assert.deepEqual(now, FROZEN);
  for (const n of S9) { const x = PT.loadPreset(PT.fresh('moog'), {}, n, { ensure: MG.M15 }); assert.equal(PT.payload(x.rec, 'moog', x.vals).pk, FROZEN[n].pk, n + ' (with vals)'); }
  // the same as the manifest written before the first edit, and the verbatim copies untouched
  const M = JSON.parse(readFileSync(new URL('./ref-9-core/MANIFEST.json', import.meta.url), 'utf8'));
  assert.deepEqual(M.records, FROZEN);
  for (const f of ['patch-core.js', 'moog-core.js']) assert.equal(sha(readFileSync(new URL('./ref-9-core/' + f, import.meta.url), 'utf8')), M.files[f].sha256, f);
});
