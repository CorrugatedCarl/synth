// fx-core.js unit tests (owner F1; SPEC-serum2 §15.3, the parts that exist at M1a step 3). Run: node --test tests/fx-core.test.mjs
// Catalogue (FXTYPES, FXP_TAB, enumerations; S1 tables = the v1 DEST rows of tests/fixtures/dests.json), v2 state
// normalisation (caps, ids, splitter rules, bus route loop, idempotence), migrateFx1 keep / drop rule, order and refs,
// fxLayout order / offsets / key incl. branches, compileFx v2 fields (v2 states and v1 states read as all ten S1
// instances; ctx.modded in both layouts; Convolve iIr ids), compileFxT v2 (several Distortion instances, memoisation),
// fxDest (incl. RENAME1 ids and nomod), instLabel, storePhases, and the moved v1 constants / functions against the frozen
// Phase-1 serum-core (tests/ref-p1). M2: instance operations (ids, caps, rows of a Serum state), upgradeInstance
// mappings, module / rack presets and the rack clipboard, chain libraries (migrateChains1), factory content, applyPresetFx
// v2, the version-preserving normalizeFx / applyPresetFx entry points, nomod in fxModded2 (serum-core).
import './v8-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from '../fx-core.js?v=9';
import * as P1 from './ref-p1/serum-core.js';

const DESTS = JSON.parse(readFileSync(new URL('./fixtures/dests.json', import.meta.url), 'utf8')).DESTS;
const FXD = DESTS.slice(148, 248);
const MODS = ['hyper', 'dist', 'flg', 'phs', 'cho', 'dly', 'cmp', 'rev', 'eq', 'fil'];
const clone = (x) => JSON.parse(JSON.stringify(x));
const isFrozenDeep = (o) => !o || typeof o !== 'object' || (Object.isFrozen(o) && Object.values(o).every(isFrozenDeep));
// a v2 state from racks = [[inst…] × 3] (inst objects as stored) and options
const st = (racks, o = {}) => C.normalizeFx2({ v: 2, racks: racks.map((mods, k) => ({ mods, route: (o.route || [])[k], byp: (o.byp || [])[k], lock: (o.lock || [])[k] })), ui: o.ui });

test('catalogue: FXTYPES, FXP_TAB, enumerations (§3.16)', () => {
  assert.equal(C.FXP_VER, 2);
  assert.equal(C.MAX_INST, 48);
  assert.deepEqual(C.FXTYPES.map((t) => t.id), ['dist', 'flg', 'phs', 'cho', 'dly', 'cmp', 'rev', 'eq', 'fil', 'hyper', 'bode', 'conv', 'util', 'split2', 'split3', 'splitms']);
  assert.deepEqual(C.FXTYPES.filter((t) => t.split).map((t) => [t.id, t.split]), [['split2', 2], ['split3', 3], ['splitms', 2]]);
  assert.deepEqual(C.FXTYPES.filter((t) => t.variants.length === 1 && t.variants[0] === 1).map((t) => t.id), ['flg', 'hyper']);
  for (const t of C.FXTYPES) assert.deepEqual(Object.keys(C.FXP_TAB[t.id]).map(Number), t.variants, t.id);
  const len = (t, v) => C.FXP_TAB[t][v].length;
  assert.deepEqual(MODS.map((m) => len(m, 1)), [10, 9, 8, 9, 10, 13, 12, 9, 9, 9]);
  assert.deepEqual([len('dist', 2), len('phs', 2), len('cho', 2), len('dly', 2), len('cmp', 2), len('rev', 2), len('eq', 2), len('fil', 2)],
    [11, 11, 11, 14, 18, 23, 10, 11]);
  assert.deepEqual([len('bode', 2), len('conv', 2), len('util', 2), len('split2', 2), len('split3', 2), len('splitms', 2)], [15, 13, 11, 3, 4, 2]);
  for (const t of Object.keys(C.FXP_TAB)) {
    for (const v of Object.keys(C.FXP_TAB[t])) {
      const tab = C.FXP_TAB[t][v], pids = tab.map((r) => r.pid);
      assert.equal(tab[0].pid, 'on', t + v + ' enable first');
      assert.equal(new Set(pids).size, pids.length, t + v + ' unique pids');
      for (const r of tab) {
        assert.match(r.pid, /^[A-Za-z][A-Za-z0-9]{0,15}$/);
        assert.ok(r.def >= 0 && r.def <= 1 && r.lo < r.hi && typeof r.label === 'string' && r.label && typeof r.fmt === 'string', t + v + ' ' + r.pid);
      }
      if (+v === 2) assert.equal(tab[0].def, 1, t + ' S2 enable default 1');
      assert.ok(tab.length <= 24);
    }
  }
  // S1 tables: the Phase-1 FX rows of the module in fx idx order (law, range, default, format, centre), pids per §3.16.2
  const S1_PIDS = {
    hyper: 'on rate detune unison mix level dsize dmix dlevel retrig', dist: 'on drive lbh freq q mix level mode filt',
    flg: 'on rate depth feed phase mix level bpm', phs: 'on rate depth freq feed phase mix level bpm',
    cho: 'on rate dly1 dly2 depth feed lpf mix level bpm', dly: 'on feed timeL timeR offL offR freq q mix level bpm link mode',
    cmp: 'on thr ratio att rel gain mbL mbM mbH mix level mb', rev: 'on size t locut c hicut w mix level',
    eq: 'on freqL qL gainL freqH qH gainH typeL typeH', fil: 'on cutoff res drive var pan mix level type',
  };
  for (const m of MODS) {
    assert.deepEqual(C.FXP_TAB[m][1].map((r) => r.pid).join(' '), S1_PIDS[m], m);
    C.FXP_TAB[m][1].forEach((r, p) => {
      const k = C.FX_S1_IDX[m][p], d = FXD[k];
      assert.equal(C.RENAME1[d.id] || d.id, 'fx.' + m + '.' + r.pid);
      for (const f of ['law', 'lo', 'hi', 'def', 'fmt', 'ctr']) assert.equal(r[f], d[f], m + '.' + r.pid + ' ' + f);
      assert.ok(!d.label.includes(r.label) || d.label.endsWith(r.label), m + '.' + r.pid + ' short label of ' + d.label);
    });
  }
  // S2 deltas (spot values from §3.16.2)
  const row = (t, v, pid) => C.FXP_TAB[t][v].find((r) => r.pid === pid);
  assert.deepEqual([row('dist', 2, 'mode').hi, row('dist', 2, 'mode').fmt, C.FXP_TAB.dist[2].indexOf(row('dist', 2, 'mode'))], [17, 'enum:DIST_MODES2', 7]);
  assert.equal(row('dist', 2, 'stages').def, 3 / 15);
  assert.deepEqual([row('fil', 2, 'type').hi, C.FXP_TAB.fil[2].indexOf(row('fil', 2, 'type'))], [107, 8]);
  assert.deepEqual([row('cmp', 2, 'xlo').def, row('cmp', 2, 'below').law, row('dly', 2, 'hq').def], [0.4751, 'ratio', 1]);
  assert.deepEqual(C.FXP_TAB.rev[2].map((r) => r.pid).slice(0, 4), ['on', 'type', 'size', 'pre']);
  assert.deepEqual(C.FXP_TAB.conv[2].filter((r) => r.nomod).map((r) => r.pid), ['size', 'tone', 'minph', 'att', 'dec', 'damp']);
  assert.deepEqual([C.DIST_MODES2.length, C.DIST_MODES2[16], C.DIST_MODES2[17]], [18, 'Overdrive', 'Soft Sat.']);
  assert.deepEqual(C.REV_TYPES2, ['Plate', 'Hall', 'Vintage', 'Nitrous', 'Basin']);
  assert.deepEqual(C.NITROUS_MODES, ['Space', 'Marble', 'Rectangle', 'Hexagon', 'Box']);
  assert.equal(C.REV_LABELS2.length, 5);
  for (const L of C.REV_LABELS2) for (const pid of L) assert.ok(row('rev', 2, pid), pid);
  for (const k of ['FXTYPES', 'FXP_TAB', 'FX_S1_IDX', 'DIST_MODES2', 'REV_TYPES2', 'NITROUS_MODES', 'REV_LABELS2']) assert.ok(isFrozenDeep(C[k]), k);
});

test('moved v1 constants and functions equal the Phase-1 serum-core ones (§11.2, deep-equal against tests/ref-p1)', () => {
  for (const k of ['MODFX_LADDER', 'DLY_LADDER', 'FX_MODULES', 'FX_ORDER_DEFAULT', 'DIST_MODES', 'DIST_FILTER', 'DLY_MODES', 'REV_TYPES',
    'REV_LABELS', 'EQ_TYPES_L', 'EQ_TYPES_H', 'CMP_RATIO_DETENTS']) assert.deepEqual(C[k], P1[k], k);
  assert.deepEqual(C.FX_ROWS_V1.map(({ group, ...r }) => r), P1.DESTS.slice(148, 248).map(({ group, idx, ...r }) => r));
  assert.deepEqual(C.FACTORY_CHAINS_V1, P1.FACTORY_CHAINS);
  assert.deepEqual(C.defaultFxV1(), P1.defaultFx());
  assert.equal(C.defaultFx, C.defaultFx2);                      // RULINGS2 F1: FX state v2 everywhere
  assert.equal(C.FACTORY_CHAINS, C.FACTORY_CHAINS2);
  for (let t = 0; t < 30; t++) {
    const fx = P1.defaultFx(), g = (t * 7919 % 101) / 101;
    for (const [i, k] of Object.keys(fx.p).entries()) if ((i + t) % 3 === 0) fx.p[k] = ((i * 37 + t * 11) % 140) / 100 - 0.2;
    if (t & 1) fx.order = fx.order.slice().reverse();
    fx.dist.xb = [[0, g, 0.3], [0.5, 1 - g, 0], [1, g, 0]];
    const md = new Uint8Array(100).map((_, k) => ((k + t) % 9 === 0 ? 1 : 0)), ctx = { bpm: 90 + t, master: g, bypass: t & 2, modded: md, seed: t & 1, smooth: 2 * g };
    assert.deepEqual(C.normalizeFxV1(fx), P1.normalizeFx(fx));
    assert.deepEqual(C.normalizeFx(fx), C.migrateFx1(C.normalizeFxV1(fx)), 'normalizeFx of a v1 state = its §2.6.3 migration (v2)');
    assert.deepEqual(C.compileFxV1(fx, ctx), P1.compileFx(fx, ctx));
    assert.deepEqual(C.compileFxTV1(fx), P1.compileFxT(fx));
    assert.deepEqual(C.applyPresetFxV1(fx, P1.defaultFx(), ['fx.dly.mix']), P1.applyPresetFx(fx, P1.defaultFx(), ['fx.dly.mix']));
    // the Phase-1 call form (locked ids) through the v2 entry point: a v2 state that compiles to what the Phase-1
    // result compiles to (the locked value kept)
    const c2 = { bpm: 90 + t, master: g, bypass: t & 2, smooth: 2 * g };
    const ap = C.applyPresetFx(fx, P1.defaultFx(), ['fx.dly.mix']), want = P1.applyPresetFx(fx, P1.defaultFx(), ['fx.dly.mix']);
    assert.equal(ap.v, 2, 'v2 result');
    assert.deepEqual(C.compileFx(ap, c2), C.compileFx(want, c2), 'compiles as the Phase-1 result');
    // no preset rack: the default rack — v2 empty racks (the Phase-1 default: ten modules, all off)
    const ap0 = C.applyPresetFx(fx, undefined), want0 = P1.applyPresetFx(fx, undefined);
    assert.ok(ap0.v === 2 && ap0.racks.every(R => R.mods.length === 0));
    assert.ok(Object.keys(want0.p).filter(k => /\.on$/.test(k)).every(k => want0.p[k] === 0));
  }
});

test('defaultFx2 / normalizeFx2: shape, ids, caps, splitter rules, bus route loop, idempotent, never mutates (§2.5)', () => {
  const d = C.defaultFx2();
  assert.deepEqual(d, { v: 2, racks: [0, 1, 2].map(() => ({ mods: [], byp: 0, lock: 0, route: 0 })), ui: { rack: 0, sel: '', expand: 0, br: {} } });
  for (const x of [null, undefined, 3, 'x', []]) assert.deepEqual(C.normalizeFx2(x), d);
  assert.deepEqual(C.normalizeFx2({}), d, 'v absent: a v1 (default) state migrates to empty racks');
  assert.deepEqual(C.normalizeFx2(d), d);
  // instance normalisation: unknown types dropped, variants, values snapped, defaults, sub-states
  const s = st([[{ type: 'nope' }, { type: 'dly', v: 7, p: { feed: 2, mode: 0.4 } }, { type: 'flg', v: 2 }, { type: 'dist', v: 1, p: { on: 1 }, sub: { xa: 'x' } },
    { type: 'conv', sub: { ir: 'http://x' } }, { type: 'rev', v: 1, sub: { type: 0 } }, { type: 'rev', sub: { type: 0 } }]]);
  const M = s.racks[0].mods;
  assert.deepEqual(M.map((I) => [I.id, I.type, I.v]), [['dly', 'dly', 2], ['flg', 'flg', 1], ['dist', 'dist', 1], ['conv', 'conv', 2], ['rev', 'rev', 1], ['rev2', 'rev', 2]]);
  assert.deepEqual([M[0].p.feed, M[0].p.mode, M[0].p.on, M[0].p.hq], [1, 0.5, 1, 1], 'clamped, snapped, S2 defaults');
  assert.deepEqual(M[2].sub, { xa: [[0, 0, 0], [1, 1, 0]], xb: [[0, 0, 0], [1, 1, 0]] });
  assert.deepEqual([M[3].sub, M[4].sub, M[5].sub], [{ ir: C.CONV_IR_DEFAULT }, { type: 0 }, {}]);
  assert.deepEqual(Object.keys(M[0]), ['id', 'type', 'v', 'byp', 'p', 'sub', 'ph', 'ui']);
  // ids: first valid occurrence keeps it; invalid / duplicate → <type> or <type><k>, never an id used elsewhere
  const ids = st([[{ id: 'Bad!', type: 'dly' }, { id: 'dly', type: 'eq' }, { id: 'eq', type: 'eq' }, { id: 'eq', type: 'cmp' }]]).racks[0].mods.map((I) => I.id);
  assert.deepEqual(ids, ['dly2', 'dly', 'eq', 'cmp']);
  // caps: 16 top-level per rack, 8 per branch, 48 per track; no splitters inside branches
  const many = Array.from({ length: 20 }, () => ({ type: 'eq' }));
  const c1 = st([many, many, many]);
  assert.deepEqual(c1.racks.map((R) => R.mods.length), [16, 16, 16]);
  const br = { type: 'split3', br: [Array.from({ length: 12 }, () => ({ type: 'util' })), [{ type: 'split2' }, { type: 'eq' }], []] };
  const c2 = st([[br, { type: 'splitms' }], [], []]);
  const S = c2.racks[0].mods[0];
  assert.deepEqual([S.br.length, S.br[0].length, S.br[1].map((I) => I.type), S.br[2].length, S.bb], [3, 8, ['eq'], 0, [0, 0, 0]]);
  assert.deepEqual(c2.racks[0].mods[1].br, [[], []]);
  const c3 = st([[{ type: 'split3', br: [many.slice(0, 8), many.slice(0, 8), many.slice(0, 8)] }, { type: 'split3', br: [many.slice(0, 8), many.slice(0, 8), many.slice(0, 8)] }], many, []]);
  assert.equal(C.fxLayout(c3).inst.length, 48, '48 per track');
  // bus routing: rack 0 ignores it; both buses into each other ⇒ BUS 2 → Main
  assert.deepEqual(st([[], [], []], { route: [2, 2, 2] }).racks.map((R) => R.route), [0, 2, 0]);
  assert.deepEqual(st([[], [], []], { route: [0, 1, 2], byp: [1, 0, 1], lock: [0, 1, 0] }).racks.map((R) => [R.route, R.byp, R.lock]), [[0, 1, 0], [1, 0, 1], [2, 1, 0]]);
  // ui: sel must name an instance, br only splitters
  const u = st([[{ id: 'sp', type: 'split2' }, { id: 'e', type: 'eq' }], [], []], { ui: { rack: 9, sel: 'e', expand: 1, br: { sp: 5, e: 1, x: 0 } } }).ui;
  assert.deepEqual(u, { rack: 2, sel: 'e', expand: 1, br: { sp: 1 } });
  // idempotent, JSON-stable, input never mutated
  for (const x of [s, c1, c2, c3]) { assert.deepEqual(C.normalizeFx2(x), x); assert.deepEqual(clone(x), x); }
  const raw = { v: 2, racks: [{ mods: [{ type: 'dist', p: { drive: 5 } }] }] }, before = clone(raw);
  C.normalizeFx2(Object.freeze(raw));
  assert.deepEqual(raw, before);
});

test('migrateFx1 (§2.6.3): keep / drop rule, v1 order, refs, Dimension ids, sub-states, lock; normalizeFx2 of v1 input', () => {
  const v1 = P1.defaultFx();
  assert.deepEqual(C.migrateFx1(v1), C.defaultFx2(), 'a pristine v1 rack migrates to empty racks');
  v1.order = ['eq', 'rev', 'hyper', 'dist', 'flg', 'phs', 'cho', 'dly', 'cmp', 'fil'];
  v1.p['fx.rev.on'] = 1;                 // enabled
  v1.p['fx.dim.mix'] = 0.3;              // a Dimension parameter edited: Hyper kept
  v1.byp.fil = 1;                        // bypassed
  v1.cho.mono = 1;                       // sub-state edited
  v1.phase = [0.1, 0.2, 0.3, 0.4];
  v1.lock = 1;
  v1.ui = { lvl: { hyper: 1, dim: 1, dist: 0, flg: 0, phs: 0, cho: 0, dly: 0, cmp: 1, rev: 0, fil: 0 }, sel: 'cmp' };
  const refs = { matrix: [{ src: 'lfo1', dst: 'fx.dist.drive', amt: 1 }], locks: { p: ['fx.eq.gainL'] }, midi: { 7: 'fx.cmp.thr' } };
  const m = C.migrateFx1(v1, refs), M = m.racks[0].mods;
  assert.deepEqual(M.map((I) => I.id), ['eq', 'rev', 'hyper', 'dist', 'cho', 'cmp', 'fil'], 'kept instances in v1 order');
  assert.deepEqual(C.migrateFx1(v1).racks[0].mods.map((I) => I.id), ['rev', 'hyper', 'cho', 'fil'], 'without refs');
  const H = M[2];
  assert.deepEqual([H.type, H.v, H.p.dmix, H.p.dsize, H.ph, H.ui], ['hyper', 1, 0.3, 0.5, 0.1, { lvl: 1, lvl2: 1 }]);
  assert.deepEqual([M[4].sub, M[4].ph, M[1].sub, M[6].byp], [{ mono: 1 }, 0.4, { type: 1 }, 1]);
  assert.deepEqual([m.racks[0].lock, m.ui.sel, m.racks[1].mods.length, m.racks[2].mods.length], [1, 'cmp', 0, 0]);
  assert.deepEqual(C.normalizeFx2(v1, refs), m, 'normalizeFx2 migrates v1 input');
  assert.deepEqual(C.normalizeFx2(m), m, 'the migrated state is normalised');
  for (const I of M) for (const r of C.FXP_TAB[I.type][1]) assert.equal(I.p[r.pid], v1.p['fx.' + (I.type === 'hyper' && r.pid[0] === 'd' && r.pid !== 'detune' ? 'dim.' + r.pid.slice(1) : I.type + '.' + r.pid)]);
  // a referenced id of the v1 Dimension rows keeps Hyper; an X-Shaper curve keeps Distortion
  assert.deepEqual(C.migrateFx1(P1.defaultFx(), { matrix: [{ dst: 'fx.dim.size' }] }).racks[0].mods.map((I) => I.id), ['hyper']);
  const xs = P1.defaultFx();
  xs.dist.xa = [[0, 0, 0], [0.5, 0.8, 0], [1, 1, 0]];
  assert.deepEqual(C.migrateFx1(xs).racks[0].mods.map((I) => [I.id, I.sub.xa.length]), [['dist', 3]]);
});

test('fxLayout (§4.2): processing order (racks, list, splitter branches depth-first), offsets, NP, key; v1 states as ten S1 instances', () => {
  const s = st([[{ id: 'a', type: 'dist' }, { id: 'sp', type: 'split3', br: [[{ id: 'b', type: 'eq', v: 1 }], [], [{ id: 'c', type: 'util' }, { id: 'd', type: 'fil' }]] }],
    [{ id: 'e', type: 'cho' }], [{ id: 'f', type: 'rev' }]]);
  const L = C.fxLayout(s);
  assert.deepEqual(L.inst.map((e) => [e.id, e.rack, e.parent, e.branch]), [['a', 0, -1, 0], ['sp', 0, -1, 0], ['b', 0, 1, 0], ['c', 0, 1, 2], ['d', 0, 1, 2], ['e', 1, -1, 0], ['f', 2, -1, 0]]);
  let off = 0;
  for (const e of L.inst) { assert.equal(e.off, off); assert.equal(e.n, C.FXP_TAB[e.type][e.v].length); off += e.n; }
  assert.equal(L.NP, off);
  assert.ok(Object.isFrozen(L) && Object.isFrozen(L.inst[0]));
  assert.match(L.key, /^[0-9a-f]{8}$/);
  assert.equal(C.fxLayout(clone(s)), L, 'memoised by structure');
  const s2 = clone(s);
  s2.racks[0].mods[0].p.drive = 0.9;
  assert.equal(C.fxLayout(s2).key, L.key, 'values do not change the layout');
  s2.racks[0].mods.reverse();
  assert.notEqual(C.fxLayout(s2).key, L.key);
  const v = C.fxLayout(P1.defaultFx());
  assert.deepEqual(v.inst.map((e) => [e.id, e.type, e.v, e.n]), MODS.map((m, i) => [m, m, 1, C.FXP_TAB[m][1].length]));
  assert.equal(v.NP, 98);
  const v2 = P1.defaultFx();
  v2.order = MODS.slice().reverse();
  assert.deepEqual(C.fxLayout(v2).inst.map((e) => e.id), MODS.slice().reverse());
  assert.deepEqual(C.fxLayout('junk').inst.map((e) => e.id), MODS, 'anything else: the repaired (default) v1 rack');
});

test('compileFx (§4.3): FXP v2 fields, v1 states (Phase-1 values, all ten S1 instances), modded in both layouts, Convolve ids', () => {
  const s = st([[{ id: 'd', type: 'dist', v: 1, p: { on: 1, drive: 0.4 }, ph: 0.3 }, { id: 'sp', type: 'split2', bb: [1, 0], br: [[{ id: 'c', type: 'cho', v: 1, sub: { mono: 1 } }], []] }],
    [{ id: 'cv', type: 'conv', p: { size: 0.25, irgain: 0.75 }, sub: { ir: 'fir:Large/Hall' } }, { id: 'cv2', type: 'conv', sub: { ir: '' } }], [{ id: 'r', type: 'rev', v: 1, sub: { type: 0 } }, { id: 'f', type: 'fil' }]],
  { route: [0, 2, 1], byp: [0, 1, 0] });
  const L = C.fxLayout(s), P = C.compileFx(s, { bpm: 97, rate: 44100, master: 0.6, bypass: 1, direct: 0.25, bus1v: 0.1, seed: true, smooth: 0.5, silence: 0, convMax: 2 });
  const keys = ['ver', 'NFX', 'NP', 'key', 'base', 'nI', 'iType', 'iVar', 'iRack', 'iBr', 'iN', 'iByp', 'iAlloc', 'iPar', 'iOff', 'iBB', 'iPh', 'iId', 'iRev', 'iCho', 'iIr',
    'rByp', 'rRoute', 'needs', 'filTypeAll', 'seed', 'any', 'bpm', 'smooth', 'silence', 'convMax', 'xsKey'];
  assert.deepEqual(Object.keys(P), keys);
  const nI = 7;
  assert.deepEqual([P.ver, P.NFX, P.NP, P.key, P.nI], [2, 8 + L.NP, L.NP, L.key, nI]);
  const T = { iType: Uint8Array, iVar: Uint8Array, iRack: Uint8Array, iBr: Uint8Array, iN: Uint8Array, iByp: Uint8Array, iAlloc: Uint8Array, iPar: Int16Array,
    iOff: Int32Array, iPh: Float64Array, iRev: Uint8Array, iCho: Uint8Array, filTypeAll: Uint8Array };
  for (const [k, Ty] of Object.entries(T)) assert.ok(P[k] instanceof Ty && P[k].length === nI, k);
  assert.ok(P.base instanceof Float64Array && P.base.length === P.NFX && P.iBB instanceof Uint8Array && P.iBB.length === 3 * nI);
  assert.deepEqual(Array.from(P.base.subarray(0, 8)), [0.6, 1, 0.25, 0.1, 0.5, 0, 0, 0]);
  assert.deepEqual(P.iId, ['d', 'sp', 'c', 'cv', 'cv2', 'r', 'f']);
  assert.deepEqual(Array.from(P.iType), ['dist', 'split2', 'cho', 'conv', 'conv', 'rev', 'fil'].map((t) => C.FXTYPES.findIndex((x) => x.id === t)));
  assert.deepEqual(Array.from(P.iPar), [-1, -1, 1, -1, -1, -1, -1]);
  assert.deepEqual([Array.from(P.iRack), Array.from(P.iBB.subarray(3, 6)), Array.from(P.iAlloc)], [[0, 0, 0, 1, 1, 2, 2], [1, 0, 0], [1, 1, 0, 1, 1, 0, 1]]);   // S1 variants keep the v1 enable default 0
  assert.deepEqual([P.iPh[0], P.iRev[5], P.iCho[2], Array.from(P.rByp), Array.from(P.rRoute)], [0.3, 0, 1, [0, 1, 0], [0, 2, 1]]);
  assert.equal(P.base[8 + L.inst[0].off + 1], 0.4);
  assert.equal(P.base[8 + L.inst[3].off + 10], 0.75, 'irgain');
  assert.match(P.iIr[3], /^fir:Large\/Hall@44100~[0-9a-f]{8}$/);
  assert.deepEqual([P.iIr[4], P.needs], ['', [P.iIr[3]]]);
  const s2 = clone(s);
  s2.racks[1].mods[0].p.irgain = 0.2; s2.racks[1].mods[0].p.mix = 0.9;
  assert.equal(C.compileFx(s2, { rate: 44100 }).iIr[3], P.iIr[3], 'live parameters do not change the shaped IR');
  s2.racks[1].mods[0].p.tone = 0.6;
  assert.notEqual(C.compileFx(s2, { rate: 44100 }).iIr[3], P.iIr[3], 'a shaping parameter does');
  assert.notEqual(C.compileFx(s, { rate: 48000 }).iIr[3], P.iIr[3], 'the rate names the entry');
  assert.deepEqual([P.seed, P.any, P.bpm, P.smooth, P.silence, P.convMax, P.xsKey], [1, 1, 97, 0.5, 0, 2, C.compileFxT(s).key]);
  const D = C.compileFx(s);
  assert.deepEqual([...D.base.subarray(0, 5), D.bpm, D.smooth, D.silence, D.seed, D.convMax], [1, 0, 0.5, 0.5, 0.5, 120, 1, 1, 0, 10]);
  // modded: FX-context layout (NFX long) → iAlloc of disabled instances and filTypeAll
  const md = new Uint8Array(D.NFX);
  md[8 + L.inst[2].off] = 1; md[8 + L.inst[6].off + 8] = 1;
  const Dm = C.compileFx(s, { modded: md, buses: 1 });
  assert.deepEqual([Dm.iAlloc[2], Dm.filTypeAll[6], Dm.iAlloc[6]], [1, 1, 1]);
  // §2.5 non-Serum tracks (no Serum gain in ctx, or ctx.buses 0): BUS 1 / BUS 2 instances compile disabled and
  // unallocated (the rack never runs them); MAIN unchanged; a Serum gain (or ctx.buses 1) keeps the buses
  const on = (P2, i) => P2.base[8 + L.inst[i].off];
  const lit = st([[{ id: 'd', type: 'dist', p: { on: 1 } }], [{ id: 'b1', type: 'dly', p: { on: 1 } }], [{ id: 'b2', type: 'eq', p: { on: 1 } }]]);
  const LL = C.fxLayout(lit), onL = (P2, i) => P2.base[8 + LL.inst[i].off];
  for (const [ctx, bus] of [[{}, 0], [{ buses: 0, master: 1 }, 0], [{ master: 1 }, 1], [{ bus2v: 0.5 }, 1], [{ buses: 1 }, 1], [{ buses: true }, 1]]) {
    const Q = C.compileFx(lit, Object.assign({ modded: Uint8Array.from({ length: 8 + LL.NP }, () => 1) }, ctx));
    assert.deepEqual([onL(Q, 0), onL(Q, 1), onL(Q, 2), Array.from(Q.iAlloc)], [1, bus, bus, [1, bus, bus]], JSON.stringify(ctx));
    assert.equal(Q.key, LL.key, 'the layout keeps every instance');
  }
  assert.equal(on(C.compileFx(s, { modded: md }), 6), 0);
  // §14.3 Q3: FXP.convMax from ctx.qr (ctx.convMax an alias), clamped to [0.1, 10]
  assert.deepEqual([C.compileFx(s, { qr: { convMax: 2 } }).convMax, C.compileFx(s, { qr: { uniMax: 4 } }).convMax, C.compileFx(s, { convMax: 3 }).convMax,
    C.compileFx(s, { qr: { convMax: 0.01 } }).convMax, C.compileFx(s, { qr: { convMax: 2 }, convMax: 5 }).convMax], [2, 10, 3, 0.1, 2]);
  // v1 state: the ten S1 instances in the v1 order with the Phase-1 values (raw when structurally sound); v1 modded
  const v1 = P1.defaultFx();
  v1.p['fx.dly.on'] = 1; v1.p['fx.dly.feed'] = 0.123456789; v1.p['fx.dist.mode'] = 0.5; v1.order = MODS.slice().reverse(); v1.rev.type = 0; v1.phase = [0.9, 0.8, 0.7, 0.6];
  const V = C.compileFx(v1, { master: 0.3 }), P1x = P1.compileFx(v1, { master: 0.3 });
  assert.deepEqual(V.iId, MODS.slice().reverse());
  for (let k = 1; k < 100; k++) {
    if (k === 86) continue;
    const e = C.fxDest(FXD[k].id, v1);
    assert.equal(V.base[8 + e.flat], P1x.base[k], FXD[k].id);
  }
  assert.deepEqual([V.base[0], V.base[1], V.iRev[V.iId.indexOf('rev')], V.iPh[V.iId.indexOf('phs')], V.any], [0.3, 0, 0, 0.7, 1]);
  const m1 = new Uint8Array(100);
  m1[C.FX_S1_IDX.fil[8]] = 1; m1[C.FX_S1_IDX.rev[0]] = 1; m1[86] = 1;
  const Vm = C.compileFx(v1, { modded: m1 }), fi = Vm.iId.indexOf('fil');
  assert.deepEqual([Vm.filTypeAll[fi], Vm.iAlloc[Vm.iId.indexOf('rev')], Vm.iAlloc[fi]], [1, 1, 0]);
  // a modulated S2 Reverb TYPE: filTypeAll prepares the tank pool for every type (IMPL extension, §4.3); S1 reverbs: never
  const RV = st([[{ id: 'r2', type: 'rev', v: 2 }, { id: 'r1', type: 'rev', v: 1 }], [], []]), LR = C.fxLayout(RV), mr = new Uint8Array(8 + LR.NP);
  mr[8 + LR.inst[0].off + 1] = 1; mr[8 + LR.inst[1].off + 1] = 1;
  assert.deepEqual(Array.from(C.compileFx(RV, { modded: mr }).filTypeAll), [1, 0]);
  assert.deepEqual(Array.from(C.compileFx(RV).filTypeAll), [0, 0]);
  assert.deepEqual(Array.from(Vm.iAlloc), Array.from(Vm.iId, (m) => (m === 'rev' || m === 'dly' ? 1 : 0)));
  // repairs: garbage and malformed v1 states compile like Phase 1 (normalizeFxV1), malformed v2 through normalizeFx2
  // (the FXP v2 layout follows the instance order: a corrupt v1 order compiles as its repaired order, dist first here)
  for (const x of [null, undefined, {}, 'x', { ...P1.defaultFx(), order: ['dist', 'dist'] }, { ...P1.defaultFx(), phase: [1] }]) {
    assert.deepEqual(C.compileFx(x), C.compileFx(C.normalizeFxV1(x)));
  }
  assert.deepEqual(C.compileFx({ ...P1.defaultFx(), order: ['dist', 'dist'] }).iId, ['dist', ...MODS.filter((m) => m !== 'dist')]);
  const bad = clone(s);
  bad.racks[0].mods[0].sub.xa = [[0, 'x', 0], [1, 1, 0]];
  bad.racks[2].mods.push({ id: 'd', type: 'eq' });
  const B = C.compileFx(bad);
  assert.deepEqual(B.iId, ['d', 'sp', 'c', 'cv', 'cv2', 'r', 'f', 'eq']);
  assert.ok(B.base.every(Number.isFinite));
  assert.equal(B.xsKey, C.compileFxT(C.normalizeFx2(bad)).key);
  const fz = Object.freeze(clone(s));
  assert.doesNotThrow(() => { C.compileFx(fz); C.compileFxT(fz); C.fxLayout(fz); });
});

test('compileFxT (§4.3): one entry per Distortion instance (any variant), memoised by content; Phase-1 fields from the first', () => {
  const xa = [[0, 0, 0], [0.5, 0.9, 0], [1, 1, 0]];
  const s = st([[{ id: 'a', type: 'dist', v: 1, sub: { xa } }, { id: 'b', type: 'dist', v: 2 }], [], [{ id: 'c', type: 'dist', v: 2, sub: { xb: xa } }]]);
  const T = C.compileFxT(s);
  assert.deepEqual(T.xs.map((e) => e.id), ['a', 'b', 'c']);
  for (const e of T.xs) assert.ok(e.xsA instanceof Float32Array && e.xsA.length === 1025 && e.xsB.length === 1025);
  assert.ok(Math.abs(T.xs[0].xsA[512] - 0.9) < 1e-6 && T.xs[1].xsA[512] === 0.5 && Math.abs(T.xs[2].xsB[512] - 0.9) < 1e-6);
  assert.equal(T.xsA, T.xs[0].xsA);
  assert.equal(C.compileFxT(clone(s)), T, 'memoised');
  assert.equal(T.key, C.compileFx(s).xsKey);
  const s2 = clone(s);
  s2.racks[0].mods[1].id = 'z';
  assert.notEqual(C.compileFxT(s2).key, T.key, 'ids are part of the key');
  const none = C.compileFxT(C.defaultFx2());
  assert.deepEqual([none.xs.length, none.xsA.length, none.xsA[1024]], [0, 1025, 1]);
  const v1 = C.compileFxT(P1.defaultFx());
  assert.deepEqual(v1.xs.map((e) => e.id), ['dist']);
  assert.equal(v1.xsA[512], 0.5);
});

test('fxDest / instLabel / storePhases (§3.16.4, §8.1)', () => {
  const s = st([[{ id: 'dly', type: 'dly' }, { id: 'sp', type: 'split2', br: [[{ id: 'dly2', type: 'dly', v: 1 }], [{ id: 'cv', type: 'conv' }]] }],
    [{ id: 'eq', type: 'eq' }, { id: 'dly3', type: 'dly' }], [{ id: 'h', type: 'hyper', ph: 0.5 }]]);
  const L = C.fxLayout(s), d = C.fxDest('fx.dly2.feed', s);
  assert.deepEqual([d.inst, d.type, d.v, d.pid, d.row, d.flat, d.nomod, d.index], [s.racks[0].mods[1].br[0][0], 'dly', 1, 'feed', C.FXP_TAB.dly[1][1], L.inst[2].off + 1, false, 2]);
  assert.equal(C.fxDest('fx.cv.size', s).nomod, true);
  assert.equal(C.fxDest('fx.cv.irgain', s).nomod, false);
  for (const id of ['fx.dly.nope', 'fx.zz.on', 'g.master', 'fx.dly', 3, null]) assert.equal(C.fxDest(id, s), null, String(id));
  // v1 states: every v1 row id (RENAME1 ids and the v1 Dimension ids) resolves to its instance, values as stored
  const v1 = P1.defaultFx();
  v1.p['fx.dim.size'] = 0.25;
  for (const D of FXD.slice(1)) if (D.id !== 'g.bypass') assert.ok(C.fxDest(D.id, v1), D.id);
  const h = C.fxDest('fx.dim.size', v1), h2 = C.fxDest('fx.hyper.dsize', v1);
  assert.deepEqual([h.pid, h.inst.p.dsize, h.flat], ['dsize', 0.25, h2.flat]);
  assert.deepEqual(['dly', 'dly2', 'cv', 'eq', 'dly3', 'h', 'nope'].map((id) => C.instLabel(s, id)),
    ['Delay', 'Delay 2', 'Convolve', 'Equalizer (Bus 1)', 'Delay 3 (Bus 1)', 'Hyper/Dimension (Bus 2)', '']);
  assert.equal(C.instLabel(v1, 'fil'), 'Filter');
  // storePhases: v2 inst.ph by instance (NaN skipped); v1 fx.phase by module
  const ph = new Float64Array(48).fill(NaN);
  ph[L.inst.findIndex((e) => e.id === 'h')] = 1.25;
  const s2 = clone(s);
  assert.equal(C.storePhases(s2, ph), s2);
  assert.deepEqual([s2.racks[2].mods[0].ph, s2.racks[0].mods[0].ph], [0.25, 0]);
  const v = P1.defaultFx(), q = new Float64Array(48).fill(NaN);
  v.order = MODS.slice().reverse();
  const LV = C.fxLayout(v);
  q[LV.inst.findIndex((e) => e.id === 'phs')] = 0.4; q[LV.inst.findIndex((e) => e.id === 'hyper')] = 0.7; q[LV.inst.findIndex((e) => e.id === 'dist')] = 0.9;
  C.storePhases(v, q);
  assert.deepEqual(v.phase, [0.7, 0, 0.4, 0]);
  assert.doesNotThrow(() => { C.storePhases(null, q); C.storePhases(s2, null); });
});

/* ------------------------------------------------------------------ M2: §11.2 state operations, presets, factory content */

const ids = (fx) => { const o = []; for (const R of fx.racks) for (const I of R.mods) { o.push(I.id); if (I.br) for (const B of I.br) for (const c of B) o.push(c.id); } return o; };
const stable = (fx, msg) => { assert.deepEqual(C.normalizeFx2(fx), fx, (msg || '') + ' normalised and idempotent'); assert.equal(new Set(ids(fx)).size, ids(fx).length, 'ids unique'); };
const row = (t, v, pid) => C.FXP_TAB[t][v].find((r) => r.pid === pid);
async function serum() { return (await import('../serum-core.js?v=9')); }
function sState(SC, rows, o = {}) {
  const s = SC.defaultSerum();
  rows.forEach((r, i) => { s.matrix[i] = Object.assign(s.matrix[i], r); });
  if (o.locks) s.locks.p = o.locks.slice();
  if (o.unp) s.locks.unp = o.unp.slice();
  if (o.midi) s.midi = Object.assign({}, o.midi);
  return s;
}

test('§11.2 newInstance: ids (type, then <type><k>), variant, defaults, positions, branches, caps, default module preset payload', () => {
  const fx = C.defaultFx2();
  assert.equal(C.newInstance(fx, 'dly'), 'dly');
  assert.equal(C.newInstance(fx, 'dly', { at: 0 }), 'dly2');
  assert.equal(C.newInstance(fx, 'dly', { rack: 1 }), 'dly3');
  assert.deepEqual(fx.racks[0].mods.map((I) => I.id), ['dly2', 'dly']);
  const I = fx.racks[0].mods[1];
  assert.deepEqual([I.type, I.v, I.byp, I.ph, I.p.on, I.p.hq], ['dly', 2, 0, 0, 1, 1]);
  assert.deepEqual(I.p, Object.fromEntries(C.FXP_TAB.dly[2].map((r) => [r.pid, r.def])));
  assert.equal(C.newInstance(fx, 'flg'), 'flg');
  assert.deepEqual([fx.racks[0].mods[2].v, fx.racks[0].mods[2].p.on], [1, 1], 'Flanger has only the S1 variant; created enabled');
  assert.equal(C.newInstance(fx, 'conv'), 'conv');
  assert.deepEqual(fx.racks[0].mods[3].sub, { ir: C.CONV_IR_DEFAULT });
  const sp = C.newInstance(fx, 'split3', { rack: 2 });
  assert.deepEqual([sp, fx.racks[2].mods[0].br, fx.racks[2].mods[0].bb], ['split3', [[], [], []], [0, 0, 0]]);
  assert.equal(C.newInstance(fx, 'eq', { splitter: 'split3', branch: 2 }), 'eq');
  assert.equal(C.newInstance(fx, 'eq', { splitter: 'split3', branch: 2, at: 0 }), 'eq2');
  assert.deepEqual(fx.racks[2].mods[0].br[2].map((x) => x.id), ['eq2', 'eq']);
  assert.equal(C.newInstance(fx, 'split2', { splitter: 'split3', branch: 0 }), null, 'no splitter inside a branch');
  assert.equal(C.newInstance(fx, 'eq', { splitter: 'split3', branch: 3 }), null, 'L/M/H has 3 branches');
  assert.equal(C.newInstance(fx, 'eq', { splitter: 'dly' }), null, 'not a splitter');
  assert.equal(C.newInstance(fx, 'nope'), null);
  assert.equal(C.newInstance(P1.defaultFx(), 'dly'), null, 'v1 states are not edited');
  stable(fx);
  // caps: 8 per branch, 16 per rack, 48 per track
  for (let i = 0; i < 6; i++) assert.ok(C.newInstance(fx, 'util', { splitter: 'split3', branch: 2 }));
  assert.equal(C.newInstance(fx, 'util', { splitter: 'split3', branch: 2 }), null, '8 per branch');
  while (fx.racks[1].mods.length < 16) assert.ok(C.newInstance(fx, 'eq', { rack: 1 }));
  assert.equal(C.newInstance(fx, 'eq', { rack: 1 }), null, '16 per rack');
  while (ids(fx).length < 48) assert.ok(C.newInstance(fx, ids(fx).length % 2 ? 'util' : 'eq', { rack: fx.racks[0].mods.length < 16 ? 0 : 2 }));
  assert.equal(C.newInstance(fx, 'util', { rack: 2 }), null, '48 per track');
  stable(fx, 'full track');
  // default module preset payload: its p and sub on a variant-2 instance; an S1 payload is upgraded; another type ignored
  const g = C.defaultFx2(), pre = { type: 'synth.fxmod', v: 2, name: 'x', ftype: 'dist', fv: 2, p: { drive: 0.8, mode: 16 / 17, stages: 1 }, sub: { xa: [[0, 0.2, 0], [1, 0.9, 0]] } };
  const d = C.newInstance(g, 'dist', { preset: Object.assign({}, pre, { p: Object.assign({ on: 0 }, pre.p) }) }), D = g.racks[0].mods[0];
  assert.deepEqual([d, D.v, D.p.drive, D.p.mode, D.p.stages, D.p.on, D.sub.xa], ['dist', 2, 0.8, 16 / 17, 1, 1, [[0, 0.2, 0], [1, 0.9, 0]]]);
  C.newInstance(g, 'phs', { preset: { ftype: 'phs', fv: 1, p: { depth: 0.9 } } });
  assert.deepEqual([g.racks[0].mods[1].v, g.racks[0].mods[1].p.depth, g.racks[0].mods[1].p.poles], [2, 0.9, 5 / 17], 'S1 payload upgraded (poles 6)');
  C.newInstance(g, 'eq', { preset: pre });
  assert.deepEqual(g.racks[0].mods[2].p, Object.fromEntries(C.FXP_TAB.eq[2].map((r) => [r.pid, r.def])), 'payload of another type: defaults');
  stable(g);
});

test('§11.2 removeInstance / moveInstance / duplicateInstance: lists, branches, caps, ui, and the rows / locks / MIDI of a Serum state', async () => {
  const SC = await serum();
  const mk = () => st([[{ id: 'dly', type: 'dly', v: 2 }, { id: 'sp', type: 'split2', br: [[{ id: 'e1', type: 'eq' }], [{ id: 'b', type: 'bode' }]] }, { id: 'hyper', type: 'hyper' }],
    [{ id: 'rv', type: 'rev' }], []], { ui: { sel: 'b', br: { sp: 1 } } });
  // remove: a splitter takes its branch instances (and their rows) with it
  let fx = mk(), s = sState(SC, [{ src: 'lfo1', amt: 0.5, dst: 'fx.b.shift' }, { src: 'env2', amt: 0.3, dst: 'fx.dly.feed' }, { src: 'lfo2', amt: 0.2, dst: 'fx.e1.gainL' },
    { src: 'lfo3', amt: 0.1, dst: 'fx.hyper.dsize' }], { locks: ['fx.b.mix', 'fx.dly.mix'], unp: ['fx.e1.qL'], midi: { 20: 'fx.b.feed', 21: 'fx.rv.size' } });
  assert.equal(C.removeInstance(fx, 'sp', s), true);
  assert.deepEqual(ids(fx), ['dly', 'hyper', 'rv']);
  assert.deepEqual([fx.ui.sel, fx.ui.br], ['', {}]);
  assert.deepEqual(s.matrix.slice(0, 4).map((r) => r.dst), ['', 'fx.dly.feed', '', 'fx.hyper.dsize']);
  assert.deepEqual(s.matrix[0], SC.defaultSerum().matrix[0], 'cleared rows are empty v2 rows');
  assert.deepEqual([s.locks.p, s.locks.unp, s.midi], [['fx.dly.mix'], [], { 21: 'fx.rv.size' }]);
  assert.equal(C.removeInstance(fx, 'sp', s), false);
  // v1 Dimension ids belong to instance hyper; v1 matrices (32 rows) get v1 empty rows
  const s1 = { matrix: [{ src: 'lfo1', amt: 1, dst: 'fx.dim.mix', bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1 }], locks: { p: ['fx.dim.size'] }, midi: {} };
  assert.equal(C.removeInstance(fx, 'hyper', s1), true);
  assert.deepEqual([s1.matrix[0], s1.locks.p], [{ src: '', amt: 0, dst: '', bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1 }, []]);
  stable(fx);
  // move: across racks, into / out of branches, final index; splitters stay out of branches; caps
  fx = mk();
  assert.equal(C.moveInstance(fx, 'dly', { rack: 0, at: 2 }), true);
  assert.deepEqual(fx.racks[0].mods.map((I) => I.id), ['sp', 'hyper', 'dly']);
  assert.equal(C.moveInstance(fx, 'rv', { splitter: 'sp', branch: 1, at: 0 }), true);
  assert.deepEqual(fx.racks[0].mods[0].br[1].map((I) => I.id), ['rv', 'b']);
  assert.equal(C.moveInstance(fx, 'e1', { rack: 2 }), true);
  assert.deepEqual([fx.racks[0].mods[0].br[0], fx.racks[2].mods.map((I) => I.id)], [[], ['e1']]);
  assert.equal(C.moveInstance(fx, 'sp', { rack: 1 }), true, 'a splitter moves with its branches');
  assert.deepEqual(ids(fx), ['hyper', 'dly', 'sp', 'rv', 'b', 'e1']);
  assert.equal(C.moveInstance(fx, 'sp', { splitter: 'sp', branch: 0 }), false);
  C.newInstance(fx, 'split3', { rack: 2 });
  assert.equal(C.moveInstance(fx, 'split3', { splitter: 'sp', branch: 0 }), false, 'no splitter inside a branch');
  assert.equal(C.moveInstance(fx, 'nope', { rack: 1 }), false);
  for (let i = 0; i < 8; i++) C.newInstance(fx, 'util', { splitter: 'sp', branch: 0 });
  assert.equal(C.moveInstance(fx, 'dly', { splitter: 'sp', branch: 0 }), false, 'full branch');
  assert.equal(C.moveInstance(fx, 'util', { splitter: 'sp', branch: 0, at: 3 }), true, 'reorder inside a full list');
  stable(fx);
  // duplicate: new ids for the copy and its branch instances, right after the original; with mods: rows copied
  fx = mk(); s = sState(SC, [{ src: 'lfo1', amt: 0.5, dst: 'fx.b.shift' }, { src: 'env2', amt: 0.3, dst: 'fx.dly.feed', bi: 1 }, { src: '', amt: 0, dst: 'fx.e1.qL' }]);
  const n = C.duplicateInstance(fx, 'sp', s, { mods: true });
  assert.equal(n, 'split2');
  assert.deepEqual(ids(fx), ['dly', 'sp', 'e1', 'b', 'split2', 'eq', 'bode', 'hyper', 'rv']);
  assert.equal(fx.ui.br.split2, 1, 'branch view copied');
  assert.deepEqual(s.matrix.slice(0, 5).map((r) => r.dst), ['fx.b.shift', 'fx.dly.feed', 'fx.e1.qL', 'fx.bode.shift', '']);
  assert.deepEqual([s.matrix[3].src, s.matrix[3].amt], ['lfo1', 0.5]);
  assert.equal(C.duplicateInstance(fx, 'dly', s), 'dly2');
  assert.equal(s.matrix[4].dst, '', 'without {mods} no rows are copied');
  assert.equal(C.duplicateInstance(fx, 'dly', s, { mods: true, to: { rack: 2 } }), 'dly3');
  assert.deepEqual([fx.racks[2].mods.map((I) => I.id), s.matrix[4].dst, s.matrix[4].bi], [['dly3'], 'fx.dly3.feed', 1]);
  assert.equal(C.duplicateInstance(fx, 'sp', null, { to: { splitter: 'split2', branch: 0 } }), null, 'no splitter inside a branch');
  stable(fx);
  const big = C.defaultFx2();
  while (ids(big).length < 48) C.newInstance(big, 'eq', { rack: Math.floor(ids(big).length / 16) });
  assert.equal(C.duplicateInstance(big, 'eq'), null, '48 per track');
});

test('§11.2 upgradeInstance: same pids keep n (enums re-gridded), Phase-1-equivalent new values, Reverb mapping', () => {
  const v1 = C.migrateFx1(P1.defaultFx());
  assert.equal(v1.racks[0].mods.length, 0);
  const s1 = (type, p, sub) => ({ id: type, type, v: 1, byp: 1, p: Object.assign(Object.fromEntries(C.FXP_TAB[type][1].map((r) => [r.pid, r.def])), p), sub: sub || {}, ph: 0.25, ui: { lvl: 1, lvl2: 0 } });
  const up = (I) => { const U = C.upgradeInstance(I); assert.ok(U && U !== I && U.v === 2 && U.id === I.id && U.byp === I.byp && U.ph === I.ph); for (const r of C.FXP_TAB[I.type][2]) assert.ok(Number.isFinite(U.p[r.pid]), r.pid); return U; };
  let U = up(s1('dist', { mode: 15 / 15, drive: 0.7, on: 1 }, { xa: [[0, 0, 0], [1, 0.5, 0]], xb: [[0, 0, 0], [1, 1, 0]] }));
  assert.deepEqual([U.p.mode, U.p.drive, U.p.on, U.p.kt, U.sub.xa], [15 / 17, 0.7, 1, 0, [[0, 0, 0], [1, 0.5, 0]]]);
  U = up(s1('fil', { type: 95 / 95, cutoff: 0.3 }));
  assert.deepEqual([U.p.type, U.p.cutoff, U.p.kt, U.p.clean], [95 / 107, 0.3, 0, 0]);
  U = up(s1('phs', { depth: 0.6 }));
  assert.deepEqual([U.p.poles, U.p.depth2, U.p.depth], [5 / 17, 0, 0.6], 'Phaser: 6 poles, DEPTH 2 0 = Phase 1');
  assert.equal(up(s1('dly', {})).p.hq, 0, 'Delay: HQ off = Phase 1');
  U = up(s1('cmp', { ratio: 0.9 }));
  assert.deepEqual([U.p.below, U.p.gL, U.p.gM, U.p.gH, U.p.xlo, U.p.xhi], [0.9, 0.5, 0.5, 0.5, row('cmp', 2, 'xlo').def, row('cmp', 2, 'xhi').def]);
  assert.deepEqual([up(s1('cho', {}, { mono: 1 })).sub, up(s1('cho', {})).p.hp, up(s1('eq', {})).p.level], [{ mono: 1 }, 0, 0.5]);
  // Reverb: Plate t → PRE-DELAY 200·t ms, c → DAMP, w → WIDTH; Hall t → DECAY, c → SPIN RATE, w → SPIN DEPTH
  const R = { size: 0.6, t: 0.3, locut: 0.1, c: 0.4, hicut: 0.7, w: 0.8, mix: 0.25, level: 0.45, on: 1 };
  U = up(s1('rev', R, { type: 0 }));
  const pre = row('rev', 2, 'pre');
  assert.ok(Math.abs(Math.pow(U.p.pre, 3) * pre.hi - 60) < 1e-9, 'Plate PRE-DELAY 60 ms');
  assert.deepEqual([U.p.type, U.p.damp, U.p.width, U.p.size, U.p.locut, U.p.hicut, U.p.mix, U.p.level, U.p.on, U.sub], [0, 0.4, 0.8, 0.6, 0.1, 0.7, 0.25, 0.45, 1, {}]);
  U = up(s1('rev', R, { type: 1 }));
  assert.deepEqual([U.p.type, U.p.decay, U.p.spinr, U.p.spind, U.p.pre], [0.25, 0.3, 0.4, 0.8, 0]);
  // no upgrade: S2 instances, S1-only types, unknown types
  for (const I of [{ type: 'dly', v: 2, p: {} }, s1('flg', {}), s1('hyper', {}), { type: 'zz', v: 1 }, null]) assert.equal(C.upgradeInstance(I), null);
  // the result is a valid instance: a state holding it normalises to itself
  const fx = st([[C.upgradeInstance(s1('rev', R, { type: 0 }))], [], []]);
  stable(fx);
});

test('§11.2 module presets, rack presets, rack clipboard, chain libraries (round trips, locked parameters, id collisions)', async () => {
  const SC = await serum();
  const fx = st([[{ id: 'a', type: 'dist', v: 2, p: { drive: 0.9, mode: 1 }, sub: { xa: [[0, 0.1, 0], [1, 0.8, 0]] } }, { id: 'b', type: 'dist', v: 2 }, { id: 'c', type: 'dist', v: 1 }],
    [{ id: 'sp', type: 'split2', p: { freq: 0.2 }, br: [[{ id: 'u', type: 'util', p: { width: 0.4 } }], []] }], []], { route: [0, 2, 0] });
  const pay = C.modulePresetPayload(fx, 'a', 'Hot');
  const { on, ...noEnable } = fx.racks[0].mods[0].p;
  assert.deepEqual([pay.type, pay.v, pay.name, pay.ftype, pay.fv, pay.p, pay.sub], ['synth.fxmod', 2, 'Hot', 'dist', 2, noEnable, fx.racks[0].mods[0].sub]);
  assert.equal(on, 1);
  fx.racks[0].mods[1].p.on = 0;
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(pay))), JSON.stringify(pay), 'JSON round trip');
  assert.equal(C.applyModulePreset(fx, 'b', pay, ['fx.b.drive']), true);
  assert.deepEqual([fx.racks[0].mods[1].p.drive, fx.racks[0].mods[1].p.mode, fx.racks[0].mods[1].sub, fx.racks[0].mods[1].p.on], [0.25, 1, pay.sub, 0],
    'locked DRIVE and the enable kept');
  assert.equal(C.applyModulePreset(fx, 'c', pay), true, 'an S1 instance receiving an S2 payload is upgraded');
  assert.deepEqual([fx.racks[0].mods[2].v, fx.racks[0].mods[2].p.drive], [2, 0.9]);
  assert.equal(C.applyModulePreset(fx, 'u', pay), false, 'another type');
  assert.equal(C.applyModulePreset(fx, 'zz', pay), false);
  assert.equal(C.modulePresetPayload(fx, 'zz', 'x'), null);
  const v1pay = C.modulePresetPayload(P1.defaultFx(), 'rev', 'Old');
  assert.deepEqual([v1pay.ftype, v1pay.fv, v1pay.sub], ['rev', 1, { type: 1 }], 'v1 states are read as their S1 instances');
  const g = st([[{ id: 'rv', type: 'rev', v: 2 }], [], []]);
  assert.equal(C.applyModulePreset(g, 'rv', v1pay), true);
  assert.equal(g.racks[0].mods[0].p.type, 0.25, 'S1 payload upgraded for an S2 instance (Hall)');
  // rack presets: payload, apply onto another rack (colliding ids renamed, caps), byp / lock / route of the target kept
  const rp = C.rackPresetPayload(fx, 1, 'Wide');
  assert.deepEqual([rp.type, rp.v, rp.name, rp.rack.mods.length, rp.rack.lock], ['synth.fxrack', 1, 'Wide', 1, 0]);
  const h = st([[{ id: 'sp', type: 'eq' }, { id: 'u', type: 'eq' }], [], []], { byp: [0, 0, 1], route: [0, 0, 1] });
  assert.equal(C.applyRackPreset(h, 2, rp), true);
  assert.deepEqual(ids(h), ['sp', 'u', 'split2', 'util']);
  assert.deepEqual([h.racks[2].byp, h.racks[2].route, h.racks[2].mods[0].p.freq], [1, 1, 0.2]);
  assert.equal(C.applyRackPreset(h, 0, { rack: { mods: 'x' } }), false);
  assert.equal(C.applyRackPreset(h, 0, { rack: { mods: [{ type: 'zz' }, { type: 'dly', id: 'BAD' }] } }), true);
  assert.deepEqual(h.racks[0].mods.map((I) => [I.id, I.type]), [['dly', 'dly']], 'invalid entries dropped, ids repaired');
  stable(h);
  // clipboard: copy / cut / paste / clear (cut and clear drop the rows of a Serum state)
  const k = st([[{ id: 'd', type: 'dly' }], [{ id: 'e', type: 'eq' }], []]), s = sState(SC, [{ src: 'lfo1', amt: 1, dst: 'fx.e.gainL' }, { src: 'lfo1', amt: 1, dst: 'fx.d.feed' }]);
  const clip = C.cutRack(k, 1, s);
  assert.deepEqual([clip.rack.mods.map((I) => I.id), k.racks[1].mods, s.matrix[0].dst, s.matrix[1].dst], [['e'], [], '', 'fx.d.feed']);
  assert.equal(C.pasteRack(k, 2, clip), true);
  assert.deepEqual(ids(k), ['d', 'eq'], 'paste assigns new ids (§2.5: the type id when unused)');
  assert.equal(C.pasteRack(k, 0, C.copyRack(k, 2)), true);
  assert.deepEqual(ids(k), ['eq2', 'eq'], 'paste replaces the rack: new ids, never one of the replaced instances (d)');
  assert.equal(s.matrix[1].dst, 'fx.d.feed', 'without a Serum state the row of the replaced instance dangles (inactive)');
  assert.equal(C.clearRack(k, 2, s), true);
  assert.deepEqual(ids(k), ['eq2']);
  // a pasted / loaded rack never inherits the ids of the instances it replaces: their rows cannot drive the newcomers;
  // with a Serum state those rows, locks and MIDI entries are removed
  const q = st([[{ id: 'dly', type: 'dly' }, { id: 'eq', type: 'eq' }], [{ id: 'x', type: 'util' }], []]);
  const sq = sState(SC, [{ src: 'lfo1', amt: 1, dst: 'fx.dly.mix' }, { src: 'lfo1', amt: 1, dst: 'fx.x.width' }], { locks: ['fx.eq.gainL'], midi: { 3: 'fx.dly.feed', 4: 'fx.x.pan' } });
  const rpay = { rack: { mods: [{ id: 'dly', type: 'dly', v: 2 }, { id: 'zz', type: 'eq', v: 2 }] } };
  assert.equal(C.pasteRack(q, 0, rpay, sq), true);
  assert.deepEqual(ids(q), ['dly2', 'eq2', 'x']);
  assert.deepEqual([sq.matrix[0].dst, sq.matrix[1].dst, sq.locks.p, sq.midi], ['', 'fx.x.width', [], { 4: 'fx.x.pan' }]);
  const q2 = st([[{ id: 'dly', type: 'dly' }], [], []]);
  assert.equal(C.applyRackPreset(q2, 0, rpay), true);
  assert.deepEqual(ids(q2), ['dly2', 'eq'], 'rack preset load: the same rule');
  stable(q); stable(q2);
  assert.equal(C.cutRack(P1.defaultFx(), 0), null);
  stable(k);
  // chain libraries: v1 chains migrate (keep / drop rule), v2 chains normalised, ui removed, racks unlocked, bad entries dropped
  const lib = C.migrateChains1({ type: 'synth.fxchains', v: 1, chains: [...C.FACTORY_CHAINS_V1.chains, { name: 'v2', fx: Object.assign(st([[{ id: 'q', type: 'util' }], [], []], { ui: { sel: 'q' } }), { racks: [{ mods: [{ id: 'q', type: 'util' }], lock: 1 }] }) }, { name: '', fx: {} }, { name: 'x' }] });
  assert.deepEqual([lib.type, lib.v, lib.chains.length], ['synth.fxchains', 2, C.FACTORY_CHAINS_V1.chains.length + 1]);
  for (const c of lib.chains) {
    assert.ok(!('ui' in c.fx) && c.fx.racks.every((R) => R.lock === 0), c.name);
    assert.deepEqual(C.normalizeFx2(c.fx), Object.assign(clone(c.fx), { ui: C.defaultFx2().ui }));
  }
  const dub = lib.chains.find((c) => c.name === 'Dub Delay').fx.racks[0].mods;
  assert.deepEqual(dub.map((I) => [I.id, I.v]), [['dly', 1], ['rev', 1]], 'only the edited / enabled v1 modules survive');
  assert.deepEqual(C.migrateChains1([{ name: 'a', fx: P1.defaultFx() }]).chains[0].fx.racks[0].mods, []);
  assert.deepEqual(C.migrateChains1(null).chains, []);
  // factoryChainFx: a Phase-1 factory chain loads from its v1 state (migrated by the loader with the Serum state as refs:
  // the modules the state addresses are kept), a Serum 2 chain as it is
  for (const c of C.FACTORY_CHAINS2.chains) {
    const v1 = C.FACTORY_CHAINS_V1.chains.find((x) => x.name === c.name);
    assert.equal(C.factoryChainFx(c), v1 ? v1.fx : c.fx, c.name);
  }
  assert.equal(C.factoryChainFx(null), null);
  const wide = C.factoryChainFx(C.FACTORY_CHAINS2.chains.find((c) => c.name === 'Wide Chorus'));
  assert.deepEqual(C.normalizeFx2(wide).racks[0].mods.map((I) => I.id), ['cho']);
  assert.deepEqual(C.normalizeFx2(wide, { matrix: [{ dst: 'fx.dist.drive' }], locks: { p: ['fx.rev.mix'] }, midi: { 20: 'fx.dly.mix' } }).racks[0].mods.map((I) => I.id).sort(),
    ['cho', 'dist', 'dly', 'rev'], 'refs keep the addressed modules');
});

test('§11.2 factory content: FACTORY_FX_PRESETS, FACTORY_RACKS, FACTORY_CHAINS2 are valid, frozen and apply', () => {
  for (const k of ['FACTORY_FX_PRESETS', 'FACTORY_RACKS', 'FACTORY_CHAINS2']) assert.ok(isFrozenDeep(C[k]), k);
  let n = 0;
  for (const type of Object.keys(C.FACTORY_FX_PRESETS)) {
    for (const p of C.FACTORY_FX_PRESETS[type]) {
      n++;
      assert.deepEqual([p.type, p.v, p.ftype], ['synth.fxmod', 2, type]);
      assert.ok(p.name && C.FXTYPES.find((t) => t.id === type).variants.includes(p.fv), p.name);
      assert.deepEqual(Object.keys(p.p), C.FXP_TAB[type][p.fv].map((r) => r.pid).filter((x) => x !== 'on'), p.name + ' full table but the enable');
      const fx = C.defaultFx2(), id = C.newInstance(fx, type, { preset: p });
      assert.deepEqual(fx.racks[0].mods[0].p, Object.assign({ on: 1 }, p.p), p.name + ' newInstance applies it (enabled)');
      assert.equal(C.applyModulePreset(fx, id, p), true);
    }
  }
  assert.ok(n >= 30);
  for (const T of C.FXTYPES) assert.ok((C.FACTORY_FX_PRESETS[T.id] || []).length >= 3, `§10.10: ≥ 3 factory presets for ${T.id}`);
  assert.equal(C.FACTORY_FX_PRESETS.dist.find((p) => p.name === 'Overdrive Stack').p.mode, 16 / 17);
  assert.ok(C.FACTORY_RACKS.length >= 4);
  // §10.10 named rack presets: Main Shimmer Hall and Parallel Crush (Splitter L/H, Distortion on the highs), Bus Send
  // Plate and Send Delay; no mono-summing module in an M/S side branch (it receives (s, −s): silent)
  const rk = (name) => C.FACTORY_RACKS.find((p) => p.name === name);
  for (const name of ['Shimmer Hall', 'Parallel Crush', 'Send Plate', 'Send Delay']) assert.ok(rk(name), name);
  const pc = rk('Parallel Crush').rack.mods;
  assert.deepEqual([pc.length, pc[0].type, pc[0].br[0].length, pc[0].br[1][0].type], [1, 'split2', 0, 'dist']);
  for (const p of C.FACTORY_RACKS) for (const I of p.rack.mods) if (I.type === 'splitms') assert.ok(I.br[1].every((x) => x.type !== 'rev' && !(x.type === 'bode' && x.p.mono >= 0.5)), p.name);
  for (const p of C.FACTORY_RACKS) {
    const fx = C.defaultFx2();
    assert.deepEqual([p.type, p.v], ['synth.fxrack', 1]);
    assert.equal(C.applyRackPreset(fx, 1, p), true, p.name);
    stable(fx, p.name);
    assert.deepEqual(clone(fx.racks[1].mods), clone(p.rack.mods), p.name + ' applies unchanged to an empty track');
  }
  const names = C.FACTORY_CHAINS2.chains.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  for (const c of C.FACTORY_CHAINS_V1.chains) assert.ok(names.includes(c.name), c.name + ' migrated');
  for (const c of C.FACTORY_CHAINS2.chains) {
    assert.deepEqual(C.normalizeFx2(c.fx), Object.assign(clone(c.fx), { ui: C.defaultFx2().ui }), c.name);
    assert.ok(C.compileFx(c.fx).nI > 0, c.name);
  }
  assert.ok(C.FACTORY_CHAINS2.chains.some((c) => c.fx.racks[0].mods.some((I) => I.type === 'split2')));
  for (const c of C.FACTORY_CHAINS2.chains) assert.ok(c.fx.racks[1].mods.length === 0 && c.fx.racks[2].mods.length === 0, c.name + ': MAIN only (chains serve every model)');
});

test('§11.2 applyPresetFx v2: locked racks kept, collisions renamed, rows of s rewritten / dropped, locked dynamic ids, ui', async () => {
  const SC = await serum();
  const cur = st([[{ id: 'dly', type: 'dly', v: 2, p: { feed: 0.9 } }, { id: 'eq', type: 'eq', p: { gainL: 0.8 } }],
    [{ id: 'rev', type: 'rev', v: 2, p: { size: 0.9 } }, { id: 'b', type: 'bode' }], [{ id: 'x', type: 'util' }]], { lock: [0, 1, 0], route: [0, 1, 0], ui: { sel: 'b', rack: 1 } });
  const pre = st([[{ id: 'rev', type: 'rev', v: 2, p: { size: 0.1 } }, { id: 'dly', type: 'dly', v: 2, p: { feed: 0.2 } }],
    [{ id: 'cho', type: 'cho' }], [{ id: 'b', type: 'util', p: { width: 0.5 } }]], { route: [0, 2, 0] });
  const s = sState(SC, [{ src: 'lfo1', amt: 1, dst: 'fx.rev.size' }, { src: 'lfo2', amt: 1, dst: 'fx.cho.rate' }, { src: 'lfo3', amt: 1, dst: 'fx.b.width' },
    { src: 'lfo4', amt: 1, dst: 'fx.dly.feed' }, { src: 'lfo5', amt: 1, dst: 'fx.b.shift' }], { locks: ['fx.dly.feed', 'fx.eq.gainL'], midi: { 7: 'fx.rev.mix', 8: 'fx.dly.mix' } });
  const before = [clone(cur), clone(pre)];
  const out = C.applyPresetFx(cur, pre, s);
  assert.deepEqual([clone(cur), clone(pre)], before, 'inputs untouched');
  // BUS 1 (locked) kept from cur; MAIN / BUS 2 from the preset; colliding incoming ids renamed (rev → rev2, b → util)
  assert.deepEqual(out.racks.map((R) => R.mods.map((I) => I.id)), [['rev2', 'dly'], ['rev', 'b'], ['util']]);
  assert.deepEqual([out.racks[1].lock, out.racks[1].route, out.racks[1].mods[0].p.size, out.racks[0].mods[0].p.size], [1, 1, 0.9, 0.1]);
  assert.deepEqual([out.racks[0].lock, out.racks[2].lock], [0, 0]);
  assert.deepEqual(out.ui, cur.ui, 'ui from cur (selection still exists)');
  // rows: renamed instances followed (rev → rev2, b → util), rows to ids absent from the result stay (inactive), rows to
  // instances of the locked rack that were not renamed would be dropped (none here: both collided)
  assert.deepEqual(s.matrix.slice(0, 5).map((r) => r.dst), ['fx.rev2.size', 'fx.cho.rate', 'fx.util.width', 'fx.dly.feed', 'fx.util.shift']);
  assert.deepEqual(s.midi, { 7: 'fx.rev2.mix', 8: 'fx.dly.mix' });
  // locked dynamic ids: the result's instance of the same id and type keeps the current value
  assert.equal(out.racks[0].mods[1].p.feed, 0.9, 'fx.dly.feed locked');
  stable(out);
  // a row addressing an instance of a locked rack (not in the preset) is dropped
  const s2 = sState(SC, [{ src: 'lfo1', amt: 1, dst: 'fx.b.dir' }, { src: 'lfo1', amt: 1, dst: 'fx.zz.on' }]);
  const pre2 = st([[{ id: 'eq', type: 'eq' }], [], []]);
  const o2 = C.applyPresetFx(cur, pre2, s2);
  assert.deepEqual([s2.matrix[0].dst, s2.matrix[1].dst, o2.racks[1].mods.map((I) => I.id)], ['', 'fx.zz.on', ['rev', 'b']]);
  // no lock: the preset's racks; absent preset FX ⇒ default; v1 preset FX migrates with s as refs
  const c0 = st([[{ id: 'eq', type: 'eq' }], [], []]);
  assert.deepEqual(C.applyPresetFx(c0, null, SC.defaultSerum()).racks.map((R) => R.mods.length), [0, 0, 0]);
  const v1p = P1.defaultFx();
  const o3 = C.applyPresetFx(c0, v1p, sState(SC, [{ src: 'lfo1', amt: 1, dst: 'fx.flg.rate' }]));
  assert.deepEqual(o3.racks[0].mods.map((I) => I.id), ['flg'], 'pristine v1 modules dropped unless referenced');
  // Phase-1 call form with a v2 current state: locked ids as an array
  const o4 = C.applyPresetFx(cur, pre, ['fx.dly.feed']);
  assert.equal(o4.racks[0].mods.find((I) => I.id === 'dly').p.feed, 0.9);
  // … and a v1 preset: without a Serum state every v1 module is kept (the drop rule needs the rows: a row switching a
  // pristine module on must find it)
  const o5 = C.applyPresetFx(C.defaultFx2(), P1.defaultFx(), []);
  assert.deepEqual(o5.racks[0].mods.map((I) => I.id), C.FX_ORDER_DEFAULT.slice());
  assert.ok(C.fxDest('fx.dly.on', o5) !== null);
  // §2.7 cap: a full locked rack plus a full incoming state stays ≤ 48 instances; the locked side is never cut
  const many = (type, n, pre2) => Array.from({ length: n }, (_, k) => ({ id: pre2 + k, type }));
  const lockedCur = st([[], many('eq', 16, 'q'), many('util', 14, 'u')], { lock: [0, 1, 1] });
  const full = st([many('dly', 16, 'd'), many('eq', 16, 'e'), many('cmp', 16, 'c')]);
  const o6 = C.applyPresetFx(lockedCur, full, SC.defaultSerum());
  assert.deepEqual(o6.racks.map((R) => R.mods.length), [16, 16, 14], 'incoming MAIN admitted up to the cap; both locked racks whole');
  assert.equal(ids(o6).length, 46);
  const big = st([[{ id: 'sp', type: 'split3', br: [many('eq', 8, 'a'), many('eq', 8, 'b'), many('eq', 8, 'c')] }, ...many('dly', 4, 'd')], [], []]);
  const o7 = C.applyPresetFx(st([[], many('eq', 16, 'q'), many('util', 16, 'u')], { lock: [0, 1, 1] }), big, SC.defaultSerum());
  assert.deepEqual(o7.racks[0].mods.map((I) => I.id), ['d0', 'd1', 'd2', 'd3'], 'a splitter with its branches that does not fit is left out');
  assert.equal(C.newInstance(o7, 'eq', { rack: 0 }), 'eq', 'the result is a valid state (edits work, the locked racks survive)');
  assert.deepEqual([o7.racks[1].mods.length, o7.racks[2].mods.length], [16, 16]);
  // Lock Matrix ('matrix' in s.locks.mod): the rows are the current ones — rows to instances of a locked rack are
  // dropped even when an incoming instance was renamed from that id; other rows keep their ids
  const lc = st([[{ id: 'dly', type: 'dly' }], [{ id: 'rev', type: 'rev', v: 2 }], []], { lock: [0, 1, 0] });
  const lp = st([[{ id: 'rev', type: 'rev', v: 2 }, { id: 'dly', type: 'dly' }], [], []]);
  const lm = sState(SC, [{ src: 'lfo1', amt: 1, dst: 'fx.rev.mix' }, { src: 'lfo1', amt: 1, dst: 'fx.dly.mix' }]);
  lm.locks.mod = ['matrix'];
  const o8 = C.applyPresetFx(lc, lp, lm);
  assert.deepEqual([lm.matrix[0].dst, lm.matrix[1].dst, ids(o8)], ['', 'fx.dly.mix', ['rev2', 'dly', 'rev']]);
  const pm = sState(SC, [{ src: 'lfo1', amt: 1, dst: 'fx.rev.mix' }]);
  C.applyPresetFx(lc, lp, pm);
  assert.equal(pm.matrix[0].dst, 'fx.rev2.mix', 'without Lock Matrix the rows are the preset\'s: they follow the renamed instance');
  // locked FX controls across the S1 / S2 variants of one type (same id and type): same law and range → the value;
  // enums of another range by value; no counterpart → the incoming value
  const vc = st([[{ id: 'dly', type: 'dly', v: 1, p: { feed: 0.9 } }, { id: 'dist', type: 'dist', v: 1, p: { mode: 7 / 15 } }, { id: 'fil', type: 'fil', v: 2, p: { type: 100 / 107 } }], [], []]);
  const vp = st([[{ id: 'dly', type: 'dly', v: 2, p: { feed: 0.2 } }, { id: 'dist', type: 'dist', v: 2, p: { mode: 16 / 17 } }, { id: 'fil', type: 'fil', v: 1, p: { type: 3 / 95 } }], [], []]);
  const o9 = C.applyPresetFx(vc, vp, sState(SC, [], { locks: ['fx.dly.feed', 'fx.dist.mode', 'fx.fil.type'] }));
  const pv = (id) => o9.racks[0].mods.find((I) => I.id === id).p;
  assert.deepEqual([pv('dly').feed, pv('dist').mode, pv('fil').type], [0.9, 7 / 17, 3 / 95], 'S1 → S2 kept, enum re-gridded; S2 type 100 has no S1 counterpart');
  stable(o6); stable(o7); stable(o8); stable(o9);
});

test('§3.16.1 addable(where[, type]): every type in a rack, the 13 effects (no splitters) inside a branch', () => {
  const all = C.FXTYPES.map((t) => t.id), fx13 = all.filter((t) => !t.startsWith('split'));
  assert.deepEqual([C.addable({ rack: 1 }), C.addable(), C.addable(false)].map((a) => a.slice()), [all, all, all]);
  assert.deepEqual([C.addable({ rack: 0, splitter: 'sp', branch: 1 }).slice(), C.addable(true).slice(), C.addable('branch').slice()], [fx13, fx13, fx13]);
  assert.equal(fx13.length, 13);
  assert.deepEqual([C.addable({ splitter: 'x' }, 'split2'), C.addable({ splitter: 'x' }, 'conv'), C.addable({ rack: 2 }, 'splitms'), C.addable({}, 'zz')], [false, true, true, false]);
  assert.ok(Object.isFrozen(C.addable()));
  // newInstance follows the same rule
  for (const t of all) {
    const fx = st([[{ id: 'sp', type: 'split2' }], [], []]);
    assert.equal(C.newInstance(fx, t, { splitter: 'sp', branch: 0 }) !== null, C.addable({ splitter: 'sp' }, t), t);
  }
});

test('§15.3 fxDest reports nomod for the six Convolve shaping pids and fxModded2 never marks them', async () => {
  const SC = await serum();
  const fx = st([[{ id: 'cv', type: 'conv' }], [], []]);
  const shaping = C.FXP_TAB.conv[2].filter((r) => r.nomod).map((r) => r.pid);
  assert.deepEqual(shaping, ['size', 'tone', 'minph', 'att', 'dec', 'damp']);
  const s = sState(SC, C.FXP_TAB.conv[2].map((r) => ({ src: 'lfo1', amt: 0.5, dst: 'fx.cv.' + r.pid })));
  const md = SC.fxModded2(s, fx), L = C.fxLayout(fx);
  C.FXP_TAB.conv[2].forEach((r, p) => {
    assert.equal(C.fxDest('fx.cv.' + r.pid, fx).nomod, !!r.nomod, r.pid);
    assert.equal(md[8 + L.inst[0].off + p], r.nomod ? 0 : 1, r.pid);
  });
  // compileFx iIr: <ir id>@<rate>~<8-hex FNV-1a of the six shaping n quantised to 1/256>; IR GAIN / MIX do not change it
  const a = C.compileFx(fx, { rate: 44100 }).iIr[0];
  assert.match(a, /^fir:Medium\/Chamber@44100~[0-9a-f]{8}$/);
  const f2 = clone(fx);
  f2.racks[0].mods[0].p.irgain = 0.1; f2.racks[0].mods[0].p.mix = 0.9;
  assert.equal(C.compileFx(f2, { rate: 44100 }).iIr[0], a);
  f2.racks[0].mods[0].p.dec = 0.5;
  assert.notEqual(C.compileFx(f2, { rate: 44100 }).iIr[0], a);
});
