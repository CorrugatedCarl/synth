import './v8-guard.mjs';
// Stage DM phase 0 (docs/canvas/IMPL-DM.md §9.0, §2.2, §5, §9.2): our drum machine's data and stubs — kit-core's KIT (every law of
// §2.2 as data, the starter, the kits, the notes, the tints), normKit's full record (§5.3: exact lengths, bounded, unknown fields
// dropped, idempotent, never throws), models.js's `kit` (MODELS[18], named RIG.NAME + ' ' + KIT.WORD) and isKitModel, drum-core's
// five-way dispatch (mach / isKit / PERS.kit / MAPS.kit, drumRows(map, model, D)), cv-mods' skip and refusal, schema 18, the stub
// kit-dsp.js (DrKit: VER, create → null) on every DSP list after dr-808.js, the fixture groove. Lane S grows the kit-core part
// (press, plan, payload, notes, names, reconcile): the stubs are checked by shape only, so its bodies pass these as they stand.
// Run alone: node --max-old-space-size=2048 --test tests/kit-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as K from '../kit-core.js?v=9';
import * as DC from '../drum-core.js?v=9';
import * as S from '../song.js?v=9';
import * as M from '../cv-migrate.js?v=9';
import * as C from '../serum-core.js?v=9';
import { MODELS, isKitModel, isRigModel, isSxId, classicOf, patchFor } from '../models.js?v=9';
import { RIG } from '../rig-core.js?v=9';
import { CLASS_TABLE, classicDescs, classicTarget, destOk, NOMOD_KIT } from '../cv-mods.js?v=9';
import { COST } from '../cv-cost.js?v=9';
import { SIL } from '../cv-art.js?v=9';
import { dspScope, DSP_TABLE, DSP_FILES } from './dsp-scope.mjs';
import { DSP_V2 } from './golden-harness.mjs';
import { GROOVE } from './kit-fixtures.mjs';

const ROOT = new URL('../', import.meta.url);
const read = f => readFileSync(new URL(f, ROOT), 'utf8');
const J = x => JSON.stringify(x);
const clone = x => JSON.parse(J(x));
const { KIT } = K;
// a v2 track holding a kit (cv-migrate's drumTrack idiom)
const drumTrackK = () => Object.assign(M.trackToV2({ id: 'trk_k', name: 'Beat', color: '#17181a', model: 'kit', vals: {}, preset: null, fx: C.defaultFx2(),
  notes: [{ id: 1, t: 0, d: 120, n: 36, v: 100 }], cc: [] }), {});

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${msg}: ${a} vs ${b}`);

/* ------------------------------------------------------------------ KIT: the data (§2.2, §3.5, §4.8, §5.2, §5.7) */

test('KIT: WORD, ID, SLOTS, CODES ka…kp, the 9 fields per slot and their ids, VEL, CHOKE_MS, DEMO null; deep-frozen', () => {
  assert.deepEqual([KIT.WORD, KIT.ID, KIT.SLOTS, KIT.CHOKE_MS, KIT.DEMO], ['Drums', 'kit', 16, 3, null]);
  assert.deepEqual(KIT.CODES, 'abcdefghijklmnop'.split('').map(c => 'k' + c));
  assert.deepEqual(KIT.FIELDS, ['t', 'u', 'd', 'l', 'c', '1', '2', '3', '4'], 'TYPE TUNE DECAY LEVEL CHOKE k1–k4 (§5.2)');
  assert.deepEqual(KIT.IDS, KIT.CODES.flatMap(s => KIT.FIELDS.map(f => s + f)), 'slot-major, the fields in order');
  assert.equal(new Set(KIT.IDS).size, 144);
  assert.deepEqual(KIT.VEL, { soft: 64, normal: 100, accent: 127 });
  const frozen = o => !o || typeof o !== 'object' || (Object.isFrozen(o) && Object.values(o).every(frozen));
  assert.ok(frozen(KIT), 'deep-frozen');
});

test('KIT.TYPES: the six types of §2.2 by TYPE value (0 empty), each TUNE / DECAY / four character knobs as laws with their defaults, the bright knob', () => {
  const T = KIT.TYPES;
  assert.equal(T.length, 7);
  assert.equal(T[0], null, 'TYPE 0: an empty slot');
  assert.deepEqual(T.slice(1).map(t => [t.n, t.id, t.label]), [[1, 'kick', 'Kick'], [2, 'snare', 'Snare'], [3, 'hat', 'Hi-hat'], [4, 'clap', 'Clap'], [5, 'tom', 'Tom'], [6, 'perc', 'Perc']]);
  assert.deepEqual(T.slice(1).map(t => t.k.map(k => k.label)), [['Punch', 'Sweep', 'Click', 'Drive'], ['Tone', 'Color', 'Snap', 'Body'], ['Tone', 'Metal', 'Ring', 'Spread'],
    ['Spread', 'Count', 'Tone', 'Tail'], ['Bend', 'Sweep', 'Noise', 'Drive'], ['Ratio', 'Tone', 'Click', 'Bend']], 'four character knobs each: one face shape (§4.3)');
  assert.deepEqual(T.slice(1).map(t => t.k[t.bright].label), ['Click', 'Color', 'Tone', 'Tone', 'Noise', 'Click'], 'the bright knob (§2.1 velocity)');
  for (const t of T.slice(1)) for (const L of [t.u, t.d, ...t.k]) {
    assert.ok(['exp', 'lin', 'int', 'bal', 'drive'].includes(L.law), t.id + ' ' + L.label);
    assert.ok(L.def >= 0 && L.def <= 1, t.id + ' ' + L.label + ' default');
    if (L.law === 'exp') assert.ok(L.lo > 0 && L.hi > L.lo, t.id + ' ' + L.label);
  }
  const v = (t, key, x) => K.lawVal(key === 'u' || key === 'd' ? T[t][key] : T[t].k[key], x);
  // §2.2's worked values (lo · (hi / lo)^x; the knob's default in parentheses there)
  const rows = [
    [1, 'u', 0.5, 60], [1, 'u', 0, 30], [1, 'u', 1, 120], [1, 'd', 0.45, 0.3697], [1, 0, 0.5, 4], [1, 0, 1, 16], [1, 1, 0.4, 0.00874], [1, 2, 1, 0.6],
    [2, 'u', 0.5, 207.8], [2, 'd', 0.4, 0.1674], [2, 1, 0.5, 2828], [2, 2, 0.45, 0.1530], [2, 3, 0.5, 0.5],
    [3, 'u', 0.5, 400], [3, 'd', 0.3, 0.0730], [3, 0, 0.5, 6000], [3, 2, 1, 8], [3, 2, 0, 0.7], [3, 3, 0.5, 1], [3, 3, 0, 0.5], [3, 3, 1, 1.5],
    [4, 'u', 0.5, 1200], [4, 'd', 0.4, 0.2009], [4, 0, 0.5, 0.008], [4, 1, 0.5, 4], [4, 1, 0, 2], [4, 1, 1, 6], [4, 2, 0.6, 6964],
    [5, 'u', 0.4, 137.8], [5, 'd', 0.5, 0.3578], [5, 0, 0.3, 3.6], [5, 1, 0.4, 0.0270], [5, 2, 1, 0.4],
    [6, 'u', 0.6, 1200], [6, 'd', 0.3, 0.0245], [6, 0, 0.4, 1.8], [6, 3, 1, 7],
  ];
  for (const [t, key, x, want] of rows) near(v(t, key, x), want, 0.002, `${T[t].label} ${key} at ${x}`);
  assert.deepEqual(T.slice(1).map(t => [t.u.def, t.d.def]), [[0.5, 0.55], [0.5, 0.4], [0.5, 0.3], [0.5, 0.4], [0.4, 0.5], [0.6, 0.3]]);
  assert.deepEqual(T.slice(1).map(t => t.k.map(k => k.def)), [[0.5, 0.4, 0.3, 0], [0.55, 0.5, 0.45, 0.5], [0.5, 0.6, 0.3, 0.5], [0.5, 0.5, 0.6, 0.6], [0.3, 0.4, 0.2, 0], [0.4, 0.5, 0.3, 0]]);
  // the drive block (§2.1): g = 0.01 + 6·k², A = 0.8; the Snare's TONE a cos / sin balance (k · π/2)
  near(v(1, 3, 0), 0.01, 1e-12, 'drive g at 0'); near(v(1, 3, 1), 6.01, 1e-12, 'drive g at 1'); near(v(5, 3, 0.5), 1.51, 1e-12, 'tom drive');
  assert.equal(KIT.LAW.drive.A, 0.8);
  near(v(2, 0, 1), Math.PI / 2, 1e-12, 'snare TONE: all noise at 1');
  // our hi-hat ratio set (D7) and the blocks' constants
  assert.deepEqual(T[3].blk.ratios, [1, 1.4471, 1.6170, 1.9265, 2.5028, 2.6637]);
  assert.deepEqual([T[2].blk.ratio, T[2].blk.drop, T[2].blk.dropS, T[3].blk.bp, T[4].blk.q, T[4].blk.upS, T[4].blk.tauS], [1.594, 0.12, 0.008, 1.5, 1.4, 0.0002, 0.0025]);
  // hostile positions clamp (never NaN)
  for (const x of [NaN, -1, 2, Infinity, undefined, '0.5']) assert.ok(Number.isFinite(v(1, 'u', x)), 'lawVal(' + x + ')');
  assert.equal(v(1, 'u', -1), 30); assert.equal(v(1, 'u', 9), 120);
});

test('KIT.NOTES (§3.5), KIT.TINT (§4.8: ≥ 3 : 1 on the three skins\' screens), KIT.STARTER (§5.7) and KIT.KITS (four, full sets)', () => {
  assert.deepEqual(KIT.NOTES, [[], [36, 35], [38, 40], [42, 44, 46], [39], [45, 41, 48, 43, 47, 50], [37, 56, 75, 76, 77]]);
  assert.equal(KIT.NOTE_FREE, 60);
  assert.equal(new Set(KIT.NOTES.flat()).size, KIT.NOTES.flat().length, 'no note in two lists');
  assert.equal(KIT.TINT.length, 7); assert.equal(KIT.TINT[0], null);
  const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const css = read('style.css'), screens = [...css.matchAll(/--rig-screen:\s*(#[0-9a-f]{6})/gi)].map(m => m[1]);
  assert.ok(screens.length >= 3, 'the skins\' screens');
  for (const t of KIT.TINT.slice(1)) for (const s of screens) assert.ok(cr(t, s) >= 3, `${t} on ${s}: ${cr(t, s).toFixed(2)}`);
  // the starter: Kick, Snare, Clap, Closed hat, Open hat (choke 1 with the closed hat), Low tom, High tom, Rim (a Perc)
  const ST = KIT.STARTER;
  assert.deepEqual(ST.map(e => e.t), [1, 2, 4, 3, 3, 5, 5, 6]);
  assert.deepEqual(ST.map(e => e.nm), ['', '', '', 'Closed hat', 'Open hat', 'Low tom', 'High tom', 'Rim']);
  assert.deepEqual(ST.map(e => e.n), [36, 38, 39, 42, 46, 45, 50, 37]);
  assert.deepEqual(ST.map(e => e.c), [0, 0, 0, 1, 1, 0, 0, 0]);
  for (const e of ST) assert.ok([e.u, e.d, e.l, ...e.k].every(x => x >= 0 && x <= 1) && e.k.length === 4, 'positions 0…1');
  assert.ok(ST[4].d > ST[3].d, 'the open hat rings longer');
  assert.ok(ST.every((e, i) => KIT.NOTES[e.t].includes(e.n) || e.n >= KIT.NOTE_FREE), 'each note from its type\'s list');
  assert.deepEqual(KIT.KITS.map(k => k.name), ['Starter', 'Deep', 'Tight', 'Crunch']);
  for (const k of KIT.KITS) assert.deepEqual(Object.keys(k.v).sort(), KIT.IDS.slice().sort(), k.name + ': the full set, empty slots included');
  for (const k of KIT.KITS) for (let s = 0; s < 16; s++) assert.equal(k.v[KIT.CODES[s] + 't'], s < 8 ? ST[s].t : 0, k.name + ': the starter\'s voices exist, the rest are empty');
  assert.notDeepEqual(KIT.KITS[1].v, KIT.KITS[0].v); assert.notDeepEqual(KIT.KITS[2].v, KIT.KITS[0].v); assert.notDeepEqual(KIT.KITS[3].v, KIT.KITS[0].v);
  for (const k of KIT.KITS) for (const id of KIT.IDS) {
    const f = id[2], x = k.v[id];
    assert.ok(f === 't' ? Number.isInteger(x) && x >= 0 && x <= 6 : f === 'c' ? Number.isInteger(x) && x >= 0 && x <= 4 : x >= 0 && x <= 10, `${k.name} ${id} = ${x}`);
  }
});

/* ------------------------------------------------------------------ normKit (§5.3) */

const EMPTY = () => ({
  v: 1, m: 'kit', pat: Array.from({ length: 8 }, () => ({ len: 16, sc: 3, cells: [] })), ui: { pat: 0 },
  x: { sync: true, swing: 50, mute: 0, solo: 0, rec: false }, keys: [], ty: new Array(16).fill(0),
  map: Object.fromEntries(KIT.CODES.map(s => [s, []])), nm: new Array(16).fill(''), tr: Array.from({ length: 16 }, (_, j) => 1 << j), smp: {},
});

test('normKit: the full empty record (keys [], ty) from nothing; exact lengths; the field order of §5.3', () => {
  for (const d of [undefined, null, 7, 'x', [], {}, { m: 'tr808' }]) assert.deepEqual(K.normKit(d), EMPTY(), J(d));
  assert.deepEqual(Object.keys(K.normKit()), ['v', 'm', 'pat', 'ui', 'x', 'keys', 'ty', 'map', 'nm', 'tr', 'smp']);
  assert.ok(Array.isArray(K.normKit().keys) && K.normKit().keys.length === 0, 'keys: [] (main\'s drumOf and the drum host\'s mem gate)');
});

test('normKit: every field bounded, unknown fields dropped, cells sparse / sorted by (s, l) / unique, idempotent, never throws', () => {
  const raw = {
    v: 9, m: 'tr909', junk: 1, keys: [1, 2], st: [[1]],
    pat: [{ len: 12, sc: 1, cells: [{ l: 3, s: 2, v: 90 }, { l: 0, s: 2, v: 127, c: 50, r: 2, n: -30, p: 7 }, { l: 0, s: 0, v: 300 }, { l: 0, s: 0, v: 5 }, { l: 16, s: 1, v: 9 },
      { l: 1, s: 1, v: 0 }, { l: 2, s: 3, v: 64, c: 100, r: 1, n: 0, p: 0 }, { l: 4, s: 4, v: 1.6, c: 900, r: 9, n: 999, p: -99, q: 1 }, 'x', null] },
    { len: 0 }, { len: 99, cells: 'no' }, 5],
    ui: { pat: 11, mode: 3 }, x: { sync: false, swing: 80, mute: 0x1FFFF, solo: -1, rec: true, part: 1 },
    ty: [1, 2, 9, -1, 3.4, 'x'], map: { ka: [36, 35, 36], kb: [36, 38], kc: [200, -1, 1.5, 40], zz: [1], kd: 'x' },
    nm: ['Kick', 'A name far longer than sixteen', 7, ''], tr: [3, -1, 0x1FFFF, 1.5], smp: { ka: { id: 'smp:0123456789abcdef', name: 'k', on: true, x: 1 }, kb: { id: 'bad' }, zz: {} },
  };
  const d = K.normKit(raw);
  assert.deepEqual(Object.keys(d), ['v', 'm', 'pat', 'ui', 'x', 'keys', 'ty', 'map', 'nm', 'tr', 'smp']);
  assert.deepEqual([d.v, d.m, d.keys], [1, 'kit', []]);
  assert.equal(d.pat.length, 8);
  assert.deepEqual(d.pat[0], { len: 12, sc: 3, cells: [{ l: 0, s: 0, v: 127 }, { l: 0, s: 2, v: 127, c: 50, r: 2, n: -30, p: 7 }, { l: 3, s: 2, v: 90 }, { l: 2, s: 3, v: 64 }, { l: 4, s: 4, v: 2, r: 4, n: 120, p: -24 }] },
    'sorted by (s, l); the first of a duplicate kept; v 0 / off-grid / junk dropped; c r n p bounded, neutral ones absent; sc 3 (cut 1)');
  assert.deepEqual([d.pat[1].len, d.pat[2].len, d.pat[2].cells, d.pat[3], d.pat[7]], [1, 16, [], { len: 16, sc: 3, cells: [] }, { len: 16, sc: 3, cells: [] }]);
  assert.deepEqual(d.ui, { pat: 7 });
  assert.deepEqual(d.x, { sync: true, swing: 75, mute: 0xFFFF, solo: 0, rec: false }, 'always synced, rec off in cut 1; 16-bit masks');
  assert.deepEqual(d.ty, [1, 2, 6, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([d.map.ka, d.map.kb, d.map.kc, d.map.kd, 'zz' in d.map, Object.keys(d.map)], [[36, 35], [38], [40], [], false, KIT.CODES], 'notes 0–127, unique across the map');
  assert.deepEqual(d.nm.slice(0, 4), ['Kick', 'A name far longe', '', '']);
  assert.equal(d.nm.length, 16);
  assert.deepEqual(d.tr.slice(0, 5), [3, 2, 0xFFFF, 8, 16], 'a bad mask: the identity');
  assert.deepEqual(d.smp, { ka: { id: 'smp:0123456789abcdef', name: 'k', on: true } });
  assert.deepEqual(K.normKit(d), d, 'idempotent');
  assert.deepEqual(K.normKit(clone(d)), d, 'through JSON');
  const full = { pat: [{ cells: Array.from({ length: 400 }, (_, i) => ({ l: i % 16, s: (i >> 4) % 16, v: 100 })) }] };
  assert.equal(K.normKit(full).pat[0].cells.length, 256, 'at most 16 × 16');
  const g = {}; Object.defineProperty(g, 'pat', { enumerable: true, get() { throw new Error('hostile'); } });
  assert.deepEqual(K.normKit(g), EMPTY(), 'a hostile getter: the empty record');
  // a fuzz: never throws, always idempotent, every bound
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const junk = depth => { const r = rnd(); if (depth > 3 || r < 0.2) return [NaN, -5, 1e9, 0.5, 'x', null, true, 300, 15][Math.floor(rnd() * 9)];
    if (r < 0.5) return Array.from({ length: Math.floor(rnd() * 20) }, () => junk(depth + 1));
    const o = {}; for (const k of ['pat', 'ui', 'x', 'ty', 'map', 'nm', 'tr', 'smp', 'len', 'cells', 'l', 's', 'v', 'c', 'r', 'n', 'p', 'ka', 'swing', 'mute']) if (rnd() < 0.4) o[k] = junk(depth + 1); return o; };
  for (let i = 0; i < 300; i++) {
    const x = junk(0), a = K.normKit(x);
    assert.deepEqual(K.normKit(a), a, 'idempotent ' + i);
    assert.ok(a.pat.length === 8 && a.pat.every(p => p.len >= 1 && p.len <= 16 && p.cells.every(c => c.l >= 0 && c.l < 16 && c.s >= 0 && c.s < 16 && c.v >= 1 && c.v <= 127)), 'bounds ' + i);
    assert.ok(a.ty.length === 16 && a.nm.length === 16 && a.tr.length === 16 && a.x.swing >= 50 && a.x.swing <= 75, 'lengths ' + i);
  }
});

test('the fixture groove (tests/kit-fixtures.mjs, §5.7; never shipped): a valid 16-step pattern on the starter\'s slots, normKit leaves it as it is', () => {
  assert.equal(GROOVE.len, 16);
  const d = K.normKit({ pat: [GROOVE] });
  assert.deepEqual(d.pat[0], { len: 16, sc: 3, cells: GROOVE.cells });
  const at = l => GROOVE.cells.filter(c => c.l === l).map(c => [c.s + 1, c.v]);
  assert.deepEqual(at(0), [[1, 100], [5, 100], [9, 100], [13, 100]], 'kick 1 · 5 · 9 · 13');
  assert.deepEqual(at(2), [[5, 100], [13, 100]], 'clap 5 · 13');
  assert.deepEqual(at(3), [[1, 64], [3, 100], [5, 64], [7, 100], [9, 64], [11, 100], [13, 64]], 'closed hat');
  assert.deepEqual(at(4), [[15, 100]], 'open hat');
  assert.deepEqual(at(7), [[12, 64]], 'rim');
  assert.deepEqual(at(1), [], 'no snare');
  assert.equal(KIT.DEMO, null, 'the groove is not the demo (the user: an empty grid)');
});

test('kit-core: lane S\'s functions exist (stubs in phase 0) and return their shapes; kit-core imports nothing', () => {
  const D = K.normKit(), S0 = K.initState();
  assert.equal(S0.m, 'kit');
  const r = K.press(S0, D, { k: 'cell', lane: 0, step: 0, v: 100 });
  assert.ok(r && typeof r.state === 'object' && typeof r.mem === 'object' && Array.isArray(r.cmds));
  const L = K.leds(S0, D); assert.ok(typeof L.step === 'number' && typeof L.lit === 'number');
  const plan = K.compilePlan(D, S0); assert.ok(plan && typeof plan.n === 'number' && typeof plan.key === 'string');
  const pl = K.payload(D, S0, 'now'); assert.deepEqual([pl.m, pl.sync, pl.at, typeof pl.pk], ['kit', true, 'now', 'string']);
  assert.ok(Array.isArray(K.toNotes(plan, { t0: 0, t1: 3840 })));
  assert.equal(K.names(D).length, 16);
  assert.ok(Array.isArray(K.rows(D)));
  assert.equal(typeof K.reconcile({}, D), 'object');
  assert.equal(typeof K.noteFor(1, D.map), 'number');
  assert.equal(K.typesOf({}).length, 16);
  assert.equal(typeof K.audible(D), 'number');
  assert.deepEqual([...read('kit-core.js').matchAll(/^\s*import\b/gm)], [], 'a leaf (D6)');
  assert.ok(!/Wavecraft|Serum/.test(read('kit-core.js')), 'no Serum / Wavecraft literal (G11)');
});

/* ------------------------------------------------------------------ models.js (§5.1) */

test('models.js: `kit` appended after the rig (MODELS[18], 19 models), named RIG.NAME + \' \' + KIT.WORD, family drums, no maker; isKitModel; map → the drums patch', () => {
  assert.equal(MODELS.length, 19);
  const m = MODELS[18];
  assert.equal(m.id, 'kit'); assert.ok(isRigModel(MODELS[17]));
  assert.deepEqual([m.name, m.family, 'maker' in m, m.year, m.model, typeof m.about, typeof m.tag], [RIG.NAME + ' ' + KIT.WORD, 'drums', false, 2026, 'Drum machine', 'string', 'string']);
  assert.ok(!/serum|xfer/i.test(m.about + m.tag + m.name), 'our own words');
  assert.equal(read('models.js').split('\n').filter(l => l.includes('KIT.WORD')).length, 1, 'the display name is one line');
  assert.deepEqual(MODELS.filter(isKitModel).map(x => x.id), ['kit']);
  assert.deepEqual([isKitModel(null), isKitModel({ id: 'tr808' }), isKitModel(undefined), classicOf(m), isSxId('kit')], [false, false, false, false, false]);
  assert.equal(m.sections.length, 16);
  assert.deepEqual(m.sections.map(s => s.title), Array.from({ length: 16 }, (_, i) => 'Drum ' + (i + 1)));
  assert.deepEqual(m.controls.map(c => c.id), KIT.IDS, 'the controls in KIT.IDS order');
  assert.ok(m.sections.every(s => s.c.length === 9));
  const def = Object.fromEntries(m.controls.map(c => [c.id, c.def]));
  assert.deepEqual(def, KIT.KITS[0].v, 'the defaults are the Starter kit');
  assert.equal(m.presets, KIT.KITS);
  const p = patchFor('kit', def, C.defaultFx2());
  assert.deepEqual([p.engine, p.machine, p.level], ['drums', 'kit', 1]);
  assert.deepEqual(Object.keys(p.drum), KIT.IDS);
  assert.equal(p.drum.kat, 1); assert.equal(p.drum.kac, 0); assert.equal(p.drum.kau, def.kau / 10); assert.equal(p.drum.kit, 0);
  assert.deepEqual(Object.keys(patchFor('kit', {}, C.defaultFx2()).drum), KIT.IDS, 'missing vals at their defaults');
});

/* ------------------------------------------------------------------ drum-core's five-way dispatch (§9.2) */

test('drum-core: mach() five-way, isKit, PERS.kit (ka…kp, sids 0–15, mask 0xFFFF, neutral names), MAPS.kit through mapTable / primaries', () => {
  assert.deepEqual(Object.keys(DC.PERS), ['tr808', 'tr606', 'tr909', 'sdsv', 'kit']);
  const P = DC.PERS.kit;
  assert.deepEqual([P.id, P.sounds, P.sids, P.mask, P.names], ['kit', KIT.CODES, Array.from({ length: 16 }, (_, s) => s), 0xFFFF, Array.from({ length: 16 }, (_, i) => 'Drum ' + (i + 1))]);
  assert.ok(Object.isFrozen(P) && Object.isFrozen(P.sounds));
  assert.deepEqual([DC.isKit(K.normKit()), DC.isKit({ m: 'kit' }), DC.isKit(DC.normDrum()), DC.isKit(null), DC.isKit(DC.normDrum(undefined, 'sdsv'))], [true, true, false, false, false]);
  assert.deepEqual(DC.normDrum(undefined, 'kit'), K.normKit(undefined));
  assert.deepEqual(DC.normDrum({ m: 'kit', ty: [1] }), K.normKit({ ty: [1] }), 'the record\'s own m');
  assert.deepEqual(DC.normDrum(K.normKit(), 'tr808'), DC.normDrum(undefined), 'the model wins: an 808 record under the 808');
  assert.deepEqual(DC.normDrum(DC.normDrum(), 'kit'), K.normKit(), 'an 808 record under the kit: the kit\'s empty record');
  assert.deepEqual(DC.normDrum(undefined, 'kitx'), DC.normDrum(undefined), 'only the exact string');
  const map = { ka: [36, 35], kb: [38], kp: [77] }, t = DC.mapTable(map, 'kit'), pr = DC.primaries(map, 'kit');
  assert.deepEqual([t[36], t[35], t[38], t[77], t[60]], [0, 0, 1, 15, -1]);
  assert.deepEqual([...pr], [36, 38, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 77]);
  assert.deepEqual([...DC.primaries(undefined, 'kit')], new Array(16).fill(-1), 'no default notes: the record holds them');
  assert.deepEqual(S.isDrum('kit'), true);
});

test('drum-core: every exported function dispatches a kit record to kit-core (drumRows(map, model, D); toNotes by plan.vl); the four ignore D', () => {
  const D = K.normKit({ ty: [1, 2], map: { ka: [36], kb: [38] }, x: { swing: 60 } }), S0 = K.initState();
  assert.deepEqual(DC.drumRows(D.map, 'kit', D), K.rows(D));
  assert.deepEqual(DC.drumRows(DC.DEFAULT_MAP, 'tr808', D), DC.drumRows(DC.DEFAULT_MAP, 'tr808'), 'the 808 ignores D');
  assert.deepEqual(DC.drumRows(DC.MAP909, 'tr909', D), DC.drumRows(DC.MAP909, 'tr909'));
  assert.deepEqual(DC.initState('kit'), S0);
  assert.deepEqual(DC.compilePlan(D, D.ui, D.x, S0), K.compilePlan(D, S0));
  assert.deepEqual(DC.payload(D, S0, 'bar'), K.payload(D, S0, 'bar'));
  assert.deepEqual(DC.press(S0, D, { k: 'clear' }), K.press(S0, D, { k: 'clear' }));
  assert.deepEqual(DC.leds(S0, D), K.leds(S0, D));
  assert.deepEqual(DC.rollPlan(D, 120, S0), K.compilePlan(D, S0));
  assert.deepEqual(DC.rollOpts(D, { model: 'kit', vals: { kau: 3 } }), { swing: 60, prim: DC.primaries(D.map, 'kit') });
  const vplan = { key: 'x', n: 1, loopFrom: 0, mPre: [3], mL1: [16], mOff: [0, 16], mT: [0, 3840], st: new Uint16Array(16).fill(1), vl: new Uint8Array(256).fill(100) };
  assert.deepEqual(DC.toNotes(vplan, { t0: 0, t1: 3840 }), K.toNotes(vplan, { t0: 0, t1: 3840 }), 'a plan with vl: the kit\'s reader');
  assert.deepEqual([DC.freeBpm(D), DC.withTempo(D, 90) === D, DC.gridPat(S0, D), typeof DC.stepLen(D, null), DC.demoFree(D), DC.planSess(D, S0)], [120, true, 0, 'number', true, null]);
  assert.equal(DC.gridPat(S0, K.normKit({ ui: { pat: 5 } })), 5);
  assert.equal(DC.demoFree(K.normKit({ pat: [GROOVE] })), false);
});

test('song.js: a kit device keeps its record (normDev → normKit; another model\'s record on a kit is the kit\'s); a 909 record on a kit, a kit record on an 808', () => {
  const tr = drumTrackK();
  tr.dev.i1.drum = K.normKit({ pat: [GROOVE], ty: [1, 2, 4, 3, 3, 5, 5, 6] });
  assert.deepEqual(S.normDev(tr).dev.i1.drum, tr.dev.i1.drum);
  tr.dev.i1.drum = DC.normDrum(undefined, 'tr909');
  assert.deepEqual(S.normDev(tr).dev.i1.drum, K.normKit());
  const t8 = drumTrackK(); t8.dev.i1.model = 'tr808'; t8.dev.i1.drum = K.normKit({ ty: [1] });
  assert.deepEqual(S.normDev(t8).dev.i1.drum, DC.normDrum(undefined));
});

/* ------------------------------------------------------------------ cv-mods (§10: no modulation onto a kit in cut 1) */

test('cv-mods: noClassic skips the kit (no class table row, no descriptors, no target); destOk refuses its knobs with the contract\'s words', () => {
  assert.equal('kit' in CLASS_TABLE, false);
  assert.deepEqual(classicDescs('kit'), []);
  assert.equal(classicTarget('kit', {}, 'kau'), null);
  assert.equal(NOMOD_KIT, 'The drum machine’s knobs take modulation in its next update');
  const dev = { kind: 'synth', model: 'kit', vals: {} };
  for (const id of ['kau', 'kat', 'kp4', 'nope']) assert.deepEqual(destOk(dev, id), { ok: false, why: NOMOD_KIT, stage: null }, id);
  assert.equal(destOk({ kind: 'synth', model: 'tr808', vals: {} }, 'bdd').why === NOMOD_KIT, false, 'the 808 keeps its own rule');
});

/* ------------------------------------------------------------------ schema 18 (§5.6) */

test('cv-migrate 18: SCHEMA 18, STEPS[17] the identity; a 17 opens as before, an 18 kit project round-trips byte for byte, a 20 opens read-only (AUTO: 19 is this build\'s)', () => {
  assert.deepEqual([M.SCHEMA, M.STEPS.length], [19, 19]);
  const p17 = { name: 'K', schema: 17, uid: 'p_kitkit0001', perf: { wheel: null }, tracks: [] };
  assert.deepEqual(M.STEPS[17](p17, []), Object.assign(clone(p17), { schema: 18 }), 'nothing converted');
  const up = M.upgrade(p17);
  assert.deepEqual([up.p.schema, up.readOnly, up.notes], [19, false, []]); // ((AUTO) through STEPS[18] too
  const t = drumTrackK(); t.dev.i1.drum = K.normKit({ pat: [GROOVE], ty: [1, 2, 4, 3, 3, 5, 5, 6], map: { ka: [36], kb: [38] }, nm: ['', '', '', 'Closed hat'] });
  const p18 = { name: 'K', bpm: 120, sig: [4, 4], bars: 4, schema: 18, uid: 'p_kitkit0001', tracks: [t] };
  const u18 = M.upgrade(clone(p18));
  assert.equal(u18.readOnly, false);
  assert.equal(J(u18.p.tracks[0].dev.i1.drum), J(t.dev.i1.drum), 'an 18 opens with its kit');
  const back = S.deserialize(S.serialize(u18.p));
  assert.equal(J(back.tracks[0].dev.i1.drum), J(t.dev.i1.drum), 'serialize → deserialize keeps the kit byte for byte');
  assert.equal(back.tracks[0].dev.i1.model, 'kit');
  const n = M.upgrade({ name: 'newer', schema: 20, tracks: [] });
  assert.deepEqual([n.readOnly, n.p.schema], [true, 20], 'a newer file: read-only');
  assert.match(read('cv-migrate.js'), /17 → 18/);
});

/* ------------------------------------------------------------------ cost, art (placeholders: lanes V, U) */

test('cv-cost: the kit\'s placeholder row dkp (drums, mono) at the §7.2 budget; cv-art: its silhouette and its own drawing', () => {
  const c = COST.synth.kit;
  assert.deepEqual([c.row, c.family, c.poly], ['dkp', 'drums', 1]);
  assert.ok(c.base + c.voice > 0 && c.base + c.voice <= 0.012, 'within dkp\'s node budget');
  assert.equal(SIL.kit.body, 'box');
});

/* ------------------------------------------------------------------ the stub kit-dsp.js on every DSP list (§7.1, P1-7) */

const after808 = (list, what) => {
  const i = list.indexOf('dr-808.js');
  assert.ok(i >= 0, what + ': dr-808.js');
  assert.equal(list[i + 1], 'kit-dsp.js', what + ': kit-dsp.js right after dr-808.js');
  assert.equal(list[i + 2], 'dr-seq.js', what + ': then dr-seq.js (modcore\'s pin: dr-seq.js before mod-core.js)');
  assert.equal(list.filter(f => f === 'kit-dsp.js').length, 1, what + ': once');
};
const strList = (src, re) => { const m = re.exec(src); assert.ok(m, String(re)); return [...m[1].matchAll(/'([^']+\.js)'/g)].map(x => x[1]); };

test('kit-dsp.js on every DSP list after dr-808.js: main DSP_FILES, cv-cost\'s bench worker, smprender.js, wk.js DSP_GLOBALS, the golden harness, dsp-scope, tests/bench.html', () => {
  after808(strList(read('main.js'), /const DSP_FILES = \[([^\]]*)\]/), 'main.js DSP_FILES');
  after808(strList(read('cv-cost.js'), /const DSP = \[([^\]]*)\]/), 'cv-cost.js workerMain');
  after808(strList(read('smprender.js'), /const DSP = \[([^\]]*)\]/), 'smprender.js');
  const wk = /const DSP_GLOBALS = \{([^}]*)\}/.exec(read('wk.js'))[1];
  after808([...wk.matchAll(/'([^']+\.js)':/g)].map(x => x[1]), 'wk.js DSP_GLOBALS');
  assert.match(wk, /'kit-dsp\.js': 'DrKit'/);
  after808(DSP_V2, 'golden-harness DSP_V2');
  after808(DSP_FILES, 'dsp-scope DSP_FILES');
  assert.deepEqual(DSP_TABLE.find(e => e[0] === 'kit-dsp.js'), ['kit-dsp.js', 'DrKit']);
  after808([...read('tests/bench.html').matchAll(/<script src="\.\.\/([^"?]+)\?v=\d+"><\/script>/g)].map(m => m[1]), 'tests/bench.html');
});

test('kit-dsp.js: a classic script publishing the frozen DrKit { VER, create, gain, TYPES } (phase 0\'s stub, lane V\'s body); reads no other global', () => {
  const sc = dspScope({ files: ['kit-dsp.js'] }), D = sc.global('DrKit');
  assert.ok(D && Object.isFrozen(D), 'DrKit published, frozen');
  assert.equal(D.VER, 1);
  assert.deepEqual([typeof D.create, typeof D.gain, Array.isArray(D.TYPES)], ['function', 'function', true], 'the machine factory (lane V; its body: tests/kit-dsp.test.mjs)');
  assert.deepEqual(sc.logs.filter(l => l.level === 'error'), []);
  const src = read('kit-dsp.js');
  assert.ok(!/\b(Dr808|DrSeq|SxBase|SerumDSP|FXDSP|ModCore)\b/.test(src.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')), 'no other script\'s global (D6)');
  assert.ok(!/^\s*(import|export)\b/m.test(src), 'a classic script');
});

/* ================================================================== lane S: the sequencer (§3, §5.2–§5.4, §9.2; G4) */

// the Starter machine (KIT.STARTER: its types, notes and names on an empty grid) with the fixture groove in pattern A
const ST = () => K.starter();
const GR = (o = {}) => K.normKit({ ...clone(ST()), pat: [GROOVE], ...o });
const playingS = () => ({ ...K.initState(), play: true });
const arr = a => Array.from(a);
const sends = r => r.cmds.filter(c => c.c === 'send').map(c => c.at);
const cellsOf = (D, p = 0) => D.pat[p].cells.map(c => [c.l, c.s, c.v]);
// the reference plan of one pattern (independent of kit-core): st / vl by step from the cells, present (ty) and audible voices
function refPlan(D) {
  const p = D.ui.pat, L = D.pat[p].len, st = new Array(L).fill(0), vl = new Array(16 * L).fill(0);
  const any = D.x.solo & 0xFFFF, A = D.ty.reduce((m, t, j) => (t > 0 && !(D.x.mute >> j & 1) && (!any || D.x.solo >> j & 1) ? m | 1 << j : m), 0);
  for (const c of D.pat[p].cells) if (c.s < L && A >> c.l & 1) { st[c.s] |= 1 << c.l; vl[16 * c.s + c.l] = c.v; }
  return { st, vl, A };
}

test('S starter() (§1.2, §5.7): the tile\'s machine — KIT.STARTER\'s types, notes and names, every pattern empty, pattern A; a normKit record, fresh each call', () => {
  const D = ST();
  assert.deepEqual(K.normKit(D), D);
  assert.deepEqual(D.ty, [1, 2, 4, 3, 3, 5, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(KIT.CODES.map(s => D.map[s]), [[36], [38], [39], [42], [46], [45], [50], [37], [], [], [], [], [], [], [], []]);
  assert.deepEqual(D.nm.slice(0, 9), ['', '', '', 'Closed hat', 'Open hat', 'Low tom', 'High tom', 'Rim', '']);
  assert.ok(D.pat.every(p => p.len === 16 && !p.cells.length) && D.ui.pat === 0, 'an empty grid (the user)');
  assert.notEqual(K.starter(), K.starter());
  assert.deepEqual(K.reconcile(KIT.KITS[0].v, D), D, 'the Starter kit\'s vals agree with it');
});

test('S typesOf (§5.2): the 16 TYPEs of vals — rounded, clamped 0–6; a missing / bad one the model\'s default (the Starter kit\'s)', () => {
  assert.deepEqual(K.typesOf(KIT.KITS[0].v), [1, 2, 4, 3, 3, 5, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0]);
  for (const v of [{}, null, undefined, 7, []]) assert.deepEqual(K.typesOf(v), K.typesOf(KIT.KITS[0].v), J(v));
  assert.deepEqual(K.typesOf({ kat: 3, kbt: 0, kct: 9, kdt: 'x', ket: 2.6, kft: -4, kpt: 6, kit: NaN }), [3, 0, 6, 3, 3, 0, 5, 6, 0, 0, 0, 0, 0, 0, 0, 6]);
});

test('S noteFor (§3.5): its type\'s first free note (Kick 36 35 · Snare 38 40 · Hi-hat 42 44 46 · Clap 39 · Tom 45 41 48 43 47 50 · Perc 37 56 75 76 77), else the first free from 60 up, then down; −1 none / no type', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(t => K.noteFor(t, {})), [36, 38, 42, 39, 45, 37]);
  assert.equal(K.noteFor(1, { ka: [36] }), 35);
  assert.equal(K.noteFor(1, { ka: [36, 35] }), 60);
  assert.equal(K.noteFor(4, { ka: [39], kb: [60, 61] }), 62);
  assert.equal(K.noteFor(5, ST().map), 41, 'the starter holds 45 and 50');
  assert.equal(K.noteFor(3, ST().map), 44);
  const full = {}; KIT.CODES.forEach((s, j) => { full[s] = Array.from({ length: 8 }, (_, i) => j * 8 + i); });
  assert.equal(K.noteFor(1, full), -1, 'all 128 notes held');
  const hi = { ka: Array.from({ length: 8 }, (_, i) => 60 + i), kb: Array.from({ length: 8 }, (_, i) => 68 + i) }, all60 = {};
  KIT.CODES.forEach((s, j) => { all60[s] = j < 9 ? Array.from({ length: 8 }, (_, i) => 56 + j * 8 + i).filter(n => n <= 127) : []; });
  assert.equal(K.noteFor(4, { ...hi, kc: [39] }), 76);
  assert.equal(K.noteFor(4, { ...all60, kj: [39] }), 55, '60…127 held: down from 59');
  for (const t of [0, 7, -1, 1.5, 'x', null]) assert.equal(K.noteFor(t, {}), -1, String(t));
  assert.equal(K.noteFor(1, null), 36); assert.equal(K.noteFor(1, { ka: 'x', kb: [36.5, 300] }), 36, 'a junk map holds nothing');
});

test('S names (§5.2, from the record alone): nm when set, else the type\'s label + an ordinal among the same type\'s automatic names; \'\' for an empty slot; rows → the roll\'s { n, s, name } of the present, mapped voices in slot order', () => {
  assert.deepEqual(K.names(ST()), ['Kick', 'Snare', 'Clap', 'Closed hat', 'Open hat', 'Low tom', 'High tom', 'Rim', '', '', '', '', '', '', '', '']);
  const D = K.normKit({ ty: [5, 5, 5, 1, 0, 3, 1], nm: ['', 'Floor', '', '', 'Ghost', '', ''] });
  assert.deepEqual(K.names(D).slice(0, 7), ['Tom', 'Floor', 'Tom 2', 'Kick', '', 'Hi-hat', 'Kick 2']);
  assert.deepEqual(K.names(undefined), new Array(16).fill(''));
  assert.deepEqual(K.names({ ty: [6, 'x', 2], nm: [7] }).slice(0, 3), ['Perc', '', 'Snare'], 'a raw record read with bounds (no normKit)');
  assert.deepEqual(K.rows(ST()), [{ n: 36, s: 0, name: 'Kick' }, { n: 38, s: 1, name: 'Snare' }, { n: 39, s: 2, name: 'Clap' }, { n: 42, s: 3, name: 'Closed hat' },
    { n: 46, s: 4, name: 'Open hat' }, { n: 45, s: 5, name: 'Low tom' }, { n: 50, s: 6, name: 'High tom' }, { n: 37, s: 7, name: 'Rim' }]);
  const R = K.normKit({ ...clone(ST()), ty: [1, 0, 4], map: { ka: [36, 35], kb: [38], kc: [], kp: [77] } });
  assert.deepEqual(K.rows(R), [{ n: 36, s: 0, name: 'Kick' }], 'an empty slot\'s note and an unmapped voice: no row');
  assert.deepEqual(DC.drumRows(R.map, 'kit', R), K.rows(R));
  assert.deepEqual(DC.drumRows(R.map, 'kit'), [{ n: 36, s: 0, name: 'Drum 1' }, { n: 38, s: 1, name: 'Drum 2' }, { n: 77, s: 15, name: 'Drum 16' }],
    'without the record: every mapped slot, PERS.kit\'s neutral names');
});

test('S audible (§3.4): the present voices, unmuted, the soloed ones when any solo — a muted voice stays muted when soloed (mute | ~solo)', () => {
  const x = o => K.normKit({ ...clone(ST()), x: { ...ST().x, ...o } });
  assert.deepEqual([K.audible(ST()), K.audible(x({ mute: 1 })), K.audible(x({ solo: 4 })), K.audible(x({ solo: 3, mute: 1 })), K.audible(x({ solo: 0x300 })), K.audible(K.normKit())],
    [0xFF, 0xFE, 4, 2, 0, 0]);
});

test('S reconcile (§5.4): vals → the record — ty = the vals\' TYPEs, a voice made present without a note gets noteFor\'s, one made empty keeps its cells and note; the same object when nothing changes; idempotent', () => {
  const D = GR(), v = clone(KIT.KITS[0].v);
  assert.equal(K.reconcile(v, D), D, 'unchanged: the same object (no persist, no repost)');
  v.kit = 5; const a = K.reconcile(v, D);
  assert.deepEqual([a.ty[8], a.map.ki, a.nm[8]], [5, [41], ''], 'a Tom in slot 9: the first free of its list');
  assert.equal(K.reconcile(v, a), a, 'idempotent');
  assert.equal(a.pat, D.pat, 'the patterns shared');
  v.kat = 0; const b = K.reconcile(v, a);
  assert.deepEqual([b.ty[0], b.map.ka, cellsOf(b).filter(c => c[0] === 0).length], [0, [36], 4], 'the kick made empty: its note and cells kept (inert)');
  assert.deepEqual(K.compilePlan(b).st[0] & 1, 0, 'its cells compile to nothing');
  v.kat = 1; const c = K.reconcile(v, b);
  assert.deepEqual([c.ty[0], c.map.ka, cellsOf(c).length], [1, [36], GROOVE.cells.length], '…back: as it was');
  assert.deepEqual(K.reconcile(KIT.KITS[1].v, D).ty, D.ty, 'another kit of the same voices: no change of types');
  const fresh = K.reconcile(KIT.KITS[0].v, undefined);
  assert.deepEqual([fresh.ty, KIT.CODES.slice(0, 8).map(s => fresh.map[s][0])], [ST().ty, [36, 38, 39, 42, 44, 45, 41, 37]], 'a bare record: normKit, then noteFor in slot order');
  assert.deepEqual(K.normKit(fresh), fresh);
});

test('S compilePlan (§3.6): one measure of the selected pattern — n 1, mPre [3], mL1 [len], st 16-bit lane masks of the present, audible voices (no accent bit), vl 16 velocities a step; the family\'s shape and key; memoised', () => {
  const D = GR(), p = K.compilePlan(D, K.initState());
  assert.deepEqual([p.n, p.intro, p.loopFrom, arr(p.mKey), arr(p.mVar), arr(p.mPre), arr(p.mL1), arr(p.mOff), arr(p.mT), p.fill], [1, 0, 0, [0], [0], [3], [16], [0, 16], [0, 3840], null]);
  assert.ok(p.st instanceof Uint16Array && p.vl instanceof Uint8Array && p.mKey instanceof Int8Array && p.mOff instanceof Int32Array);
  assert.deepEqual([p.st.length, p.vl.length], [16, 256]);
  const R = refPlan(D);
  assert.deepEqual([arr(p.st), arr(p.vl)], [R.st, R.vl]);
  assert.deepEqual(arr(p.st).slice(0, 5), [0b1001, 0, 0b1000, 0, 0b1101], 'kick + closed hat 64 on step 1 (slot 0 = bit 0: no accent bit)');
  assert.deepEqual([p.vl[0], p.vl[3], p.vl[16 * 2 + 3], p.vl[16 * 11 + 7], p.vl[16 * 14 + 4]], [100, 64, 100, 64, 100]);
  assert.match(p.key, /^[0-9a-f]{8}$/); assert.match(p.shape, /^[0-9a-f]{8}$/);
  assert.equal(K.compilePlan(D), p, 'memoised: the same record, the same plan');
  assert.deepEqual(K.compilePlan(clone(D)), p, 'a copy: an equal plan');
  // mute / solo, an empty slot's cells, LENGTH, the selected pattern, a velocity — what moves the key and the shape
  const mu = K.normKit({ ...clone(D), x: { ...D.x, mute: 1 } }), pm = K.compilePlan(mu);
  assert.deepEqual([pm.st[0], pm.vl[0], pm.shape === p.shape, pm.key === p.key], [0b1000, 0, true, false], 'a mute recompiles: the same shape (DrSeq swaps in place)');
  const so = K.compilePlan(K.normKit({ ...clone(D), x: { ...D.x, solo: 0b10001 } }));
  assert.deepEqual(arr(so.st).filter(m => m).map(m => m & ~0b10001), [0, 0, 0, 0, 0], 'solo: only the soloed voices');
  const em = K.normKit({ ...clone(D), pat: [{ len: 16, cells: [...GROOVE.cells, { l: 9, s: 1, v: 100 }] }] });
  assert.deepEqual(arr(K.compilePlan(em).st), arr(p.st), 'a cell on an empty slot: inert');
  const L12 = K.compilePlan(K.normKit({ ...clone(D), pat: [{ ...GROOVE, len: 12 }] }));
  assert.deepEqual([arr(L12.mL1), arr(L12.mOff), arr(L12.mT), L12.st.length, L12.vl.length, L12.shape === p.shape], [[12], [0, 12], [0, 2880], 12, 192, false], 'LENGTH 12: a 12-sixteenth measure (a new shape)');
  assert.deepEqual(arr(L12.st), arr(p.st).slice(0, 12), 'the open hat on 15 past it: not played');
  const B = K.compilePlan(K.normKit({ ...clone(D), ui: { pat: 1 } }));
  assert.deepEqual([arr(B.mKey), arr(B.st).every(m => !m), B.shape === p.shape], [[1], true, true], 'pattern B (empty): mKey 1');
  const v2 = K.compilePlan(K.normKit({ ...clone(D), pat: [{ ...GROOVE, cells: GROOVE.cells.map(c => (c.l === 7 ? { ...c, v: 65 } : c)) }] }));
  assert.deepEqual([arr(v2.st), v2.key === p.key], [arr(p.st), false], 'a velocity alone moves the key (vl is content)');
  // the trigger matrix (cut 1: the identity) maps rows → voices inside the plan
  const tr = K.normKit({ ...clone(D), ty: [...D.ty.slice(0, 8), 1, ...D.ty.slice(9)], tr: [1 | 1 << 8, ...D.tr.slice(1)] }), pt = K.compilePlan(tr);
  assert.deepEqual([pt.st[0], pt.vl[8], pt.st[1]], [0b1001 | 1 << 8, 100, 0], 'row 0 → voices 0 and 8');
  // hostile records: normKit first; always valid shape
  for (const x of [undefined, null, 5, { m: 'tr808' }]) { const q = K.compilePlan(x); assert.deepEqual([q.n, arr(q.mL1), q.st.length, arr(q.st).every(m => !m)], [1, [16], 16, true], J(x)); }
});

test('S payload (§3.7): { plan, sync: true, run: false, bpm 120, swing, at, tap 0, map, prim, mute, smp null, m \'kit\', pk } — the tables of the present voices only, mute = mute | ~solo; pk the content, not at or the session', () => {
  const D = GR(), S0 = K.initState(), s = K.payload(D, S0, 'bar');
  assert.deepEqual(Object.keys(s), ['plan', 'sync', 'run', 'bpm', 'swing', 'at', 'tap', 'map', 'prim', 'mute', 'smp', 'm', 'pk']);
  assert.deepEqual([s.sync, s.run, s.bpm, s.swing, s.at, s.tap, s.mute, s.smp, s.m], [true, false, 120, 50, 'bar', 0, 0, null, 'kit']);
  assert.equal(s.plan, K.compilePlan(D, S0));
  assert.ok(s.map instanceof Int8Array && s.map.length === 128 && s.prim instanceof Int8Array && s.prim.length === 16);
  assert.deepEqual(arr(s.prim), [36, 38, 39, 42, 46, 45, 50, 37, -1, -1, -1, -1, -1, -1, -1, -1]);
  assert.deepEqual([s.map[36], s.map[38], s.map[46], s.map[37], s.map[35], s.map[60]], [0, 1, 4, 7, -1, -1]);
  assert.equal(K.payload(D).at, 'now');
  const E = K.normKit({ ...clone(D), ty: [0, ...D.ty.slice(1)] }), se = K.payload(E);
  assert.deepEqual([se.map[36], se.prim[0]], [-1, -1], 'an empty slot\'s kept note plays nothing');
  const mx = o => K.payload(K.normKit({ ...clone(D), x: { ...D.x, ...o } })).mute;
  assert.deepEqual([mx({ mute: 1 }), mx({ solo: 2 }), mx({ solo: 1, mute: 1 }), mx({ mute: 0xFFFF })], [1, 0xFFFD, 0xFFFF, 0xFFFF]);
  assert.equal(K.payload(D, playingS(), 'now').pk, K.payload(D, { bpm: 77 }, 'bar').pk, 'not the session, not at');
  assert.equal(K.payload(clone(D)).pk, s.pk, 'equal content, equal pk');
  const cell = K.press(S0, D, { k: 'cell', lane: 1, step: 3, v: 100 }).mem;
  for (const [what, X] of [['a cell', cell], ['swing', K.normKit({ ...clone(D), x: { ...D.x, swing: 62 } })], ['a mute', K.normKit({ ...clone(D), x: { ...D.x, mute: 2 } })],
    ['a note', K.normKit({ ...clone(D), map: { ...D.map, ka: [35] } })], ['a voice made empty', K.normKit({ ...clone(D), ty: [0, ...D.ty.slice(1)] })]]) assert.notEqual(K.payload(X).pk, s.pk, what);
  assert.equal(K.payload(K.normKit({ ...clone(D), ty: [2, ...D.ty.slice(1)] })).pk, s.pk, 'a voice\'s TYPE is the patch\'s (vals), not the sequencer\'s');
  assert.equal(K.payload(K.normKit({ ...clone(D), nm: ['Boom'] })).pk, s.pk, 'a name is not the machine\'s');
  assert.equal(K.payload(undefined).m, 'kit');
});

test('S toNotes (§3.6, D3): a kit plan\'s hits in [t0, t1) as { t, d: 120, n: prim[j], v: vl } at the family\'s whole-tick swung positions, sorted by t then n — the window, the loop, LENGTH, an unmapped lane', () => {
  const D = GR(), p = K.compilePlan(D), prim = K.payload(D).prim;
  const want = (pct, t0, t1, plan = p, Dx = D) => {
    const L = Dx.pat[Dx.ui.pat].len, w = Math.round((2 * pct - 100) * 240 / 100), out = [];
    for (let b = 0; b * L * 240 < t1; b++) for (const c of Dx.pat[Dx.ui.pat].cells) {
      if (c.s >= L || !(Dx.ty[c.l] > 0)) continue;
      const t = b * L * 240 + c.s * 240 + (c.s & 1 ? w : 0);
      if (t >= t0 && t < t1) out.push({ t, d: 120, n: prim[c.l], v: c.v });
    }
    return out.sort((a, b) => a.t - b.t || a.n - b.n);
  };
  for (const pct of [50, 62, 75]) assert.deepEqual(K.toNotes(p, { t0: 0, t1: 7680, swing: pct, prim }), want(pct, 0, 7680), 'swing ' + pct);
  assert.deepEqual(K.toNotes(p, { t0: 0, t1: 3840, swing: 62, prim }).find(n => n.n === 37), { t: 11 * 240 + 58, d: 120, n: 37, v: 64 }, 'the rim on 12: odd, +58 ticks at 62 %');
  assert.deepEqual(K.toNotes(p, { t0: 100, t1: 3940, prim }), want(50, 100, 3940), 'a window inside the bar');
  assert.deepEqual(K.toNotes(p, { t0: 3840 * 5, t1: 3840 * 6, prim }), want(50, 3840 * 5, 3840 * 6), 'bar 6');
  const D12 = K.normKit({ ...clone(D), pat: [{ ...GROOVE, len: 12 }] }), p12 = K.compilePlan(D12);
  assert.deepEqual(K.toNotes(p12, { t0: 0, t1: 3840 * 3, prim }), want(50, 0, 3840 * 3, p12, D12), 'a 12-step pattern loops every 2880 ticks');
  assert.deepEqual(K.toNotes(p, { t0: 0, t1: 3840, map: D.map }), K.toNotes(p, { t0: 0, t1: 3840, prim }), 'opts.map: its primaries');
  const pr = Int8Array.from(prim); pr[3] = -1;
  assert.ok(!K.toNotes(p, { t0: 0, t1: 3840, prim: pr }).some(n => n.n === 42) && K.toNotes(p, { t0: 0, t1: 3840, prim: pr }).length === want(50, 0, 3840).length - 7, 'an unmapped lane: skipped');
  assert.deepEqual([K.toNotes(null), K.toNotes({ n: 0 }), K.toNotes(p, { t0: 3840, t1: 3840, prim })], [[], [], []]);
  assert.deepEqual(DC.toNotes(p, { t0: 0, t1: 3840, ...DC.rollOpts(D, { model: 'kit', vals: {} }) }), want(50, 0, 3840), 'drum-core: rollOpts + toNotes (LC\'s marks) = the kit\'s');
  assert.deepEqual(DC.toNotes(DC.rollPlan(D, 120, K.initState()), { t0: 0, t1: 3840, ...DC.rollOpts(D) }), want(50, 0, 3840));
});

test('S initState / leds (§3.8): the session { m, run, play, pos, bpm, hits }; leds → { step: the heard step while playing | −1, lit: the heard step\'s audible voices }', () => {
  assert.deepEqual(K.initState(), { m: 'kit', run: false, play: false, pos: null, bpm: 120, hits: [] });
  assert.notEqual(K.initState(), K.initState());
  const D = GR(), post = { s: 4, m: 0, k: 0, v: 0, p: 0, o: 960, M: 3, f: 0, F: 9600 };
  assert.deepEqual(K.leds(K.initState(), D), { step: -1, lit: 0 });
  let S = K.press(playingS(), D, { k: 'heard', post }).state;
  assert.deepEqual(S.pos, { s: 4, m: 0, k: 0, o: 960, M: 3, F: 9600 });
  assert.deepEqual(K.leds(S, D), { step: 4, lit: 0b1101 });
  assert.deepEqual(K.leds(S, K.normKit({ ...clone(D), x: { ...D.x, mute: 1 } })), { step: 4, lit: 0b1100 });
  assert.deepEqual(K.leds(K.press(S, D, { k: 'transport', play: false }).state, D), { step: -1, lit: 0 }, 'stopped: nothing lit');
  assert.deepEqual(K.leds(S, K.normKit({ ...clone(D), ui: { pat: 3 } })), { step: 4, lit: 0b1101 }, 'the heard pattern\'s lanes (A), whichever is selected');
  assert.deepEqual(K.leds(null, null), { step: -1, lit: 0 });
});

test('S press (§3.8): cell { lane, step, v } — on / off / velocity in the selected pattern, \'send now\' (at the same shape: in place, playing or not); the same value, an empty slot\'s lane, a step past LENGTH or junk: no change', () => {
  const D = ST(), S0 = K.initState();
  let r = K.press(S0, D, { k: 'cell', lane: 0, step: 4, v: 100 });
  assert.deepEqual([cellsOf(r.mem), sends(r), r.state === S0], [[[0, 4, 100]], ['now'], true]);
  assert.equal(r.mem.pat[1], D.pat[1], 'the other patterns shared');
  const r2 = K.press(S0, r.mem, { k: 'cell', lane: 0, step: 4, v: 100 });
  assert.deepEqual([r2.mem === r.mem, r2.cmds], [true, []], 'the same value: the same record, no command');
  assert.deepEqual(cellsOf(K.press(S0, r.mem, { k: 'cell', lane: 0, step: 4, v: 127 }).mem), [[0, 4, 127]], 'a velocity');
  assert.deepEqual(cellsOf(K.press(S0, r.mem, { k: 'cell', lane: 0, step: 4, v: 0 }).mem), [], 'v 0: off');
  assert.deepEqual(cellsOf(K.press(S0, D, { k: 'cell', lane: 2, step: 1, v: 300 }).mem), [[2, 1, 127]], 'clamped');
  assert.deepEqual(sends(K.press(playingS(), D, { k: 'cell', lane: 0, step: 0, v: 64 })), ['now'], 'playing: now (in place)');
  const L12 = K.normKit({ ...clone(D), pat: [{ len: 12 }] });
  for (const [d, i] of [[D, { k: 'cell', lane: 9, step: 0, v: 100 }], [L12, { k: 'cell', lane: 0, step: 12, v: 100 }], [D, { k: 'cell', lane: 16, step: 0, v: 100 }], [D, { k: 'cell', lane: 0, step: -1, v: 100 }],
    [D, { k: 'cell', lane: 0, step: 0, v: NaN }], [D, { k: 'cell', lane: '0', step: 0, v: 100 }], [D, { k: 'cell', lane: 1.5, step: 0, v: 100 }], [D, { k: 'cell' }], [D, { k: 'zzz' }], [D, null], [D, 7]]) {
    const q = K.press(S0, d, i);
    assert.deepEqual([q.mem === d, q.state === S0, q.cmds], [true, true, []], J(i));
  }
  const in2 = K.press(S0, K.normKit({ ...clone(D), ui: { pat: 2 } }), { k: 'cell', lane: 1, step: 2, v: 90 }).mem;
  assert.deepEqual([cellsOf(in2, 2), cellsOf(in2, 0)], [[[1, 2, 90]], []], 'the selected pattern');
  assert.deepEqual(K.normKit(r.mem), r.mem, 'a valid record');
});

test('S press: paint { lane, steps[], v } (one gesture: one send) · clear (the selected pattern) · clearAll · demo (inert: KIT.DEMO null)', () => {
  const D = GR(), S0 = K.initState();
  let r = K.press(S0, D, { k: 'paint', lane: 1, steps: [0, 2, 4, 4, 6, 99, -1, 'x'], v: 64 });
  assert.deepEqual([cellsOf(r.mem).filter(c => c[0] === 1), sends(r)], [[[1, 0, 64], [1, 2, 64], [1, 4, 64], [1, 6, 64]], ['now']]);
  r = K.press(S0, r.mem, { k: 'paint', lane: 1, steps: [2, 4], v: 0 });
  assert.deepEqual(cellsOf(r.mem).filter(c => c[0] === 1), [[1, 0, 64], [1, 6, 64]], 'v 0 paints off');
  assert.deepEqual(K.press(S0, D, { k: 'paint', lane: 3, steps: [0, 2], v: 0 }).mem.pat[0].cells.filter(c => c.l === 3).map(c => c.s), [4, 6, 8, 10, 12]);
  for (const i of [{ k: 'paint', lane: 1, steps: [] }, { k: 'paint', lane: 1, steps: 'x', v: 100 }, { k: 'paint', lane: 12, steps: [0], v: 100 }, { k: 'paint', lane: 0, steps: [0], v: 100 }]) {
    const q = K.press(S0, D, i); assert.deepEqual([q.mem === D, q.cmds], [true, []], J(i));
  }
  r = K.press(S0, D, { k: 'clear' });
  assert.deepEqual([r.mem.pat[0].cells, r.mem.pat[0].len, sends(r)], [[], 16, ['now']]);
  const E = K.press(S0, r.mem, { k: 'clear' }); assert.deepEqual([E.mem === r.mem, E.cmds], [true, []], 'an empty pattern: nothing');
  const two = K.normKit({ ...clone(D), pat: [GROOVE, { len: 12, cells: [{ l: 0, s: 0, v: 9 }] }] });
  r = K.press(S0, two, { k: 'clearAll' });
  assert.deepEqual([r.mem.pat.every(p => !p.cells.length), r.mem.pat[1].len, sends(r)], [true, 12, ['now']], 'every pattern\'s cells; the lengths kept');
  const d0 = ST(), dm = K.press(S0, d0, { k: 'demo' }); assert.deepEqual([dm.mem === d0, dm.cmds, dm.state === S0], [true, [], true], 'demo: nothing while KIT.DEMO is null');
});

test('S press: pat { p } (stopped now, playing at the measure\'s end) · len { n } (likewise) · swing { v } (50–75, now) · mute / solo { lane } (now: the plan recompiles)', () => {
  const D = GR(), S0 = K.initState();
  let r = K.press(S0, D, { k: 'pat', p: 2 });
  assert.deepEqual([r.mem.ui.pat, sends(r), r.mem.pat, r.mem.x], [2, ['now'], D.pat, D.x]);
  assert.deepEqual(sends(K.press(playingS(), D, { k: 'pat', p: 7 })), ['bar']);
  for (const p of [0, 8, -1, 'x', 1.5]) { const q = K.press(S0, D, { k: 'pat', p }); assert.deepEqual([q.mem === D, q.cmds], [true, []], String(p)); }
  r = K.press(S0, D, { k: 'len', n: 12 });
  assert.deepEqual([r.mem.pat[0].len, r.mem.pat[0].cells, sends(r)], [12, D.pat[0].cells, ['now']], 'the cells past it kept (inert)');
  assert.deepEqual([K.press(playingS(), D, { k: 'len', n: 8 }).cmds, K.press(S0, D, { k: 'len', n: 99 }).mem.pat[0].len, K.press(S0, D, { k: 'len', n: 0 }).mem.pat[0].len], [[{ c: 'send', at: 'bar' }], 16, 1]);
  assert.deepEqual(K.press(S0, D, { k: 'len', n: 16 }).cmds, [], 'the same length');
  assert.deepEqual(K.press(S0, D, { k: 'len', n: 'x' }).cmds, []);
  r = K.press(S0, D, { k: 'swing', v: 62 }); assert.deepEqual([r.mem.x.swing, sends(r)], [62, ['now']]);
  assert.deepEqual([K.press(S0, D, { k: 'swing', v: 80 }).mem.x.swing, K.press(S0, D, { k: 'swing', v: 61.6 }).mem.x.swing, K.press(S0, D, { k: 'swing', v: 50 }).cmds, K.press(S0, D, { k: 'swing', v: NaN }).cmds], [75, 62, [], []]);
  r = K.press(S0, D, { k: 'mute', lane: 0 }); assert.deepEqual([r.mem.x.mute, sends(r)], [1, ['now']]);
  assert.equal(K.press(S0, r.mem, { k: 'mute', lane: 0 }).mem.x.mute, 0, 'a toggle');
  r = K.press(playingS(), D, { k: 'solo', lane: 15 }); assert.deepEqual([r.mem.x.solo, sends(r)], [0x8000, ['now']], 'a lane past 12 (16 bits)');
  assert.notEqual(K.compilePlan(K.press(S0, D, { k: 'mute', lane: 3 }).mem).key, K.compilePlan(D).key, 'muting recompiles the plan');
  for (const lane of [16, -1, 'x', 0.5]) for (const k of ['mute', 'solo']) assert.deepEqual(K.press(S0, D, { k, lane }).cmds, [], k + ' ' + lane);
});

test('S press: hit { lane, v } — an audition through the note path ({ c: \'hit\', sound, v }; the 909\'s idiom), held in the session until its off; a voice without a note or an empty slot: nothing; panic / release let go', () => {
  const D = ST(), S0 = K.initState();
  let r = K.press(S0, D, { k: 'hit', lane: 2, v: 127 });
  assert.deepEqual([r.cmds, r.state.hits, r.mem === D], [[{ c: 'hit', sound: 2, v: 127 }], [[2, 2]], true]);
  assert.deepEqual(K.press(S0, D, { k: 'hit', lane: 0 }).cmds, [{ c: 'hit', sound: 0, v: 100 }], 'no v: normal (100)');
  assert.deepEqual(K.press(S0, D, { k: 'hit', lane: 0, v: 0.4 }).cmds, [{ c: 'hit', sound: 0, v: 1 }], 'clamped 1–127');
  const r2 = K.press(r.state, D, { k: 'hit', lane: 2, off: true });
  assert.deepEqual([r2.cmds, r2.state.hits], [[{ c: 'hit', sound: 2, off: true }], []]);
  assert.deepEqual(K.press(S0, D, { k: 'hit', lane: 2, off: true }).cmds, [], 'an off with nothing held');
  const nn = K.normKit({ ...clone(D), map: { ...D.map, kb: [] } });
  for (const [d, lane] of [[D, 9], [nn, 1], [D, 16], [D, 'x']]) assert.deepEqual(K.press(S0, d, { k: 'hit', lane, v: 100 }).cmds, [], 'lane ' + lane);
  const h2 = K.press(K.press(r.state, D, { k: 'hit', lane: 0, v: 100 }).state, D, { k: 'hit', lane: 2, v: 60 }).state;
  assert.deepEqual(h2.hits, [[0, 0], [2, 2]], 'a lane re-hit moves to the end');
  assert.deepEqual([K.press(h2, D, { k: 'panic' }).state.hits, K.press(h2, D, { k: 'release' }).state.hits, K.press(h2, D, { k: 'panic' }).cmds], [[], [], []]);
});

test('S press: voice { slot, op: \'add\' | \'remove\', type } — the record\'s half: add (ty, the first free note of its type, its lane cleared everywhere, its name automatic, its mute / solo off); remove (ty 0, the note freed, the lane cleared, the name reset); one send', () => {
  const D = K.normKit({ ...clone(GR()), pat: [GROOVE, { len: 16, cells: [{ l: 8, s: 3, v: 80 }, { l: 1, s: 0, v: 50 }] }], x: { ...GR().x, mute: 1 << 8 | 2, solo: 1 << 8 } });
  const S0 = K.initState();
  let r = K.press(S0, D, { k: 'voice', slot: 8, op: 'add', type: 5 });
  assert.deepEqual([r.mem.ty[8], r.mem.map.ki, r.mem.nm[8], cellsOf(r.mem, 1), r.mem.x.mute, r.mem.x.solo, sends(r)], [5, [41], '', [[1, 0, 50]], 2, 0, ['now']]);
  assert.deepEqual(K.names(r.mem)[8], 'Tom', 'an automatic name (the toms are named)');
  assert.deepEqual(K.normKit(r.mem), r.mem);
  for (const i of [{ slot: 0, type: 1 }, { slot: 8, type: 0 }, { slot: 8, type: 7 }, { slot: 16, type: 1 }, { slot: 8 }, { slot: 'x', type: 1 }]) {
    const q = K.press(S0, D, { k: 'voice', op: 'add', ...i }); assert.deepEqual([q.mem === D, q.cmds], [true, []], J(i));
  }
  r = K.press(S0, D, { k: 'voice', slot: 1, op: 'remove' });
  assert.deepEqual([r.mem.ty[1], r.mem.map.kb, cellsOf(r.mem, 1), cellsOf(r.mem).some(c => c[0] === 1), r.mem.x.mute, sends(r)], [0, [], [[8, 3, 80]], false, 1 << 8, ['now']]);
  r = K.press(S0, D, { k: 'voice', slot: 3, op: 'remove' });
  assert.deepEqual([r.mem.ty[3], r.mem.map.kd, r.mem.nm[3], cellsOf(r.mem).some(c => c[0] === 3)], [0, [], '', false], 'the closed hat: name reset, cells gone');
  const q = K.press(S0, r.mem, { k: 'voice', slot: 3, op: 'remove' }); assert.deepEqual([q.mem === r.mem, q.cmds], [true, []], 'nothing left to remove');
  const inert = K.normKit({ ...clone(D), ty: [0, ...D.ty.slice(1)] });
  r = K.press(S0, inert, { k: 'voice', slot: 0, op: 'remove' });
  assert.deepEqual([r.mem.map.ka, cellsOf(r.mem).some(c => c[0] === 0), sends(r)], [[], false, ['now']], 'a slot made empty by its TYPE: Remove frees its note and cells');
  assert.deepEqual(K.press(S0, D, { k: 'voice', slot: 9, op: 'nope', type: 1 }).cmds, []);
});

test('S press: the host\'s notifications — transport { play } (a start forgets the heard step), heard { post }, bpm { v }, panic, release, start (the song\'s ▶ / ■) — the session only; a foreign session (another machine\'s) becomes the kit\'s, its transport and tempo kept', () => {
  const D = GR(), S0 = K.initState();
  let r = K.press(S0, D, { k: 'transport', play: true });
  assert.deepEqual([r.state, r.mem === D, r.cmds], [{ ...S0, play: true }, true, []]);
  const P1 = K.press(r.state, D, { k: 'heard', post: { s: 3, m: 0, k: 0, v: 0, p: 0, o: 720, M: 0, f: 0, F: 1e4 } }).state;
  assert.deepEqual(K.press(P1, D, { k: 'transport', play: true }).state.pos, null, 'a (re)start forgets the heard step');
  assert.deepEqual(K.press(P1, D, { k: 'transport', play: false }).state, { ...P1, play: false });
  assert.deepEqual(K.press(S0, D, { k: 'bpm', v: 97.5 }).state.bpm, 97.5);
  assert.equal(K.press(S0, D, { k: 'bpm', v: 'x' }).state, S0);
  for (const k of ['heard', 'release']) assert.equal(K.press(S0, D, { k }).state, S0, k + ' with nothing: the same session');
  assert.deepEqual(K.press(S0, D, { k: 'heard', post: 5 }).state, S0);
  assert.deepEqual(K.press(S0, D, { k: 'start' }).cmds, [{ c: 'play' }]);
  assert.deepEqual(K.press(playingS(), D, { k: 'start' }).cmds, [{ c: 'stop' }]);
  const foreign = { ...DC.initState(), play: true, bpm: 133, pos: { s: 1 }, cmp: null };
  for (const F of [foreign, DC.initState('tr909'), DC.initState('sdsv'), { ...DC.initState('tr606'), play: true }, null, 7]) {
    const q = K.press(F, D, { k: 'bpm', v: 140 }).state;
    assert.deepEqual(Object.keys(q), Object.keys(S0), J(F));
    assert.deepEqual([q.m, q.play, q.bpm, q.hits], ['kit', !!(F && F.play), 140, []]);
  }
  assert.deepEqual(DC.press(foreign, D, { k: 'transport', play: false }).state.m, 'kit', 'through drum-core');
});

test('S property: random kit records through random presses — the record stays normKit\'s, `send` exactly when the record changed, the plan valid for the family\'s shape, pk equal exactly when the payload\'s content is', () => {
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff, pick = a => a[Math.floor(rnd() * a.length)];
  const lanes = () => Math.floor(rnd() * 17), steps = () => Math.floor(rnd() * 17), vv = () => pick([0, 1, 64, 100, 127, 200, NaN]);
  const input = () => pick([
    () => ({ k: 'cell', lane: lanes(), step: steps(), v: vv() }), () => ({ k: 'paint', lane: lanes(), steps: [steps(), steps(), steps()], v: vv() }),
    () => ({ k: 'pat', p: Math.floor(rnd() * 9) }), () => ({ k: 'len', n: Math.floor(rnd() * 18) }), () => ({ k: 'swing', v: 45 + Math.floor(rnd() * 35) }),
    () => ({ k: 'clear' }), () => ({ k: 'clearAll' }), () => ({ k: 'mute', lane: lanes() }), () => ({ k: 'solo', lane: lanes() }),
    () => ({ k: 'voice', slot: lanes(), op: pick(['add', 'remove']), type: Math.floor(rnd() * 8) }), () => ({ k: 'hit', lane: lanes(), v: vv() }),
    () => ({ k: 'transport', play: rnd() < 0.5 }), () => ({ k: 'demo' }), () => ({ k: 'junk' }),
  ])();
  let D = GR(), S = K.initState();
  for (let i = 0; i < 1500; i++) {
    const inp = input(), q = K.press(S, D, inp), changed = q.mem !== D;
    assert.deepEqual(K.normKit(q.mem), q.mem, 'valid after ' + J(inp));
    assert.equal(q.cmds.some(c => c.c === 'send'), changed, 'send ⇔ changed: ' + J(inp));
    if (changed) assert.notEqual(J(q.mem), J(D), 'a changed record differs: ' + J(inp));
    const a = K.payload(q.mem, q.state), b = K.payload(clone(q.mem));
    assert.equal(a.pk, b.pk);
    const p = a.plan, L = q.mem.pat[q.mem.ui.pat].len;
    assert.ok(p.n === 1 && p.mL1[0] === L && p.mOff[1] === L && p.mT[1] === L * 240 && p.st.length === L && p.vl.length === 16 * L, 'the plan\'s shape');
    for (let s = 0; s < L; s++) for (let j = 0; j < 16; j++) assert.equal(p.st[s] >> j & 1, p.vl[16 * s + j] > 0 ? 1 : 0, 'st ⇔ vl');
    assert.equal(arr(p.st).reduce((m, x) => m | x, 0) & ~K.audible(q.mem), 0, 'only audible voices');
    D = q.mem; S = q.state;
  }
});
