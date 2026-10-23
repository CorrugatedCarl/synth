import './v8-guard.mjs';
// moog-core.js (IMPL-9 §2.2, §2.4, §2.6, §8.2; lane K9 — IMPL-9b §1.2–§1.6, §2, §8.2, §8.8; lane K9b): the 900-series family's
// tables — a leaf (no import); every type's params (ids ≤ 3 chars, defaults inside their ranges, 0 … 48: the 960's 40 the one over
// 16), jacks (ids, directions, plugs, roles, sections ≤ 16, normals, outputs ≤ 30, rear terminals) and sizes (§2.2: 1 MU → 128 ×
// 512 … 8 MU 864 × 512, console height 2 / 3 / 4 / 8 MU → 224 / 352 / 448 / 864 × 352); the jack counts (97 in the Model 15 set with
// the controller); events, lamps and bus rows (typed, one plug, out → in, never into a normalled input, their switches the type's
// own Off / On switches); the controller's controls (CTL_SECTIONS, CTL_IDS) and pvOf; the tray order, groups, Tidy's rows and the
// console row; the sets (M15 / S35 / S55, FAMILY.sets; each row fits rackWide); the presets' shape and their headroom on the real
// circuits (patch-dsp.js + moog-dsp.js: every preset peaks −12 … −3 dBFS at 48 kHz × 4); the three tables of a type (moog-core =
// PatchMoog (JACKS, SECS, PARAMS, EV, LAMPS) = the faces' ports, buttons and lamps — rear jacks never placed).
// Pure: no DOM; only numbers / strings / plain records go into assert.
// Run alone: node --max-old-space-size=2048 --test tests/moog-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import * as MG from '../moog-core.js?v=9';
import * as PT from '../patch-core.js?v=9';
import { BAR_H } from '../cv-module.js?v=9';
import { dspScope, source } from './dsp-scope.mjs';

const SRC = readFileSync(new URL('../moog-core.js', import.meta.url), 'utf8');
const T = MG.TYPES;
const JACKS = { ctl: 27, 921: 13, '921a': 5, '921b': 7, 923: 7, '904a': 5, '907a': 2, 911: 2, 902: 7, 995: 6,
  // IMPL-9b §2.2–§2.3 (rear terminals included: the 992 1 + 1, CP3A 11 + 1, CP4A 2 + 2, CP2 10 + 2; the 962's 12, §12 (a2) decision 4)
  '904b': 5, 914: 4, '911a': 4, '903a': 4, 960: 29, 962: 12, 992: 2, 993: 0, 994: 8, cp3a: 12, cp4a: 4, cp35: 14, cp2: 12, cp8a: 0, 961: 33, clk: 3 };
const CONSOLE_T = ['ctl', 'cp2', 'cp3a', 'cp4a', 'cp35', '961', 'clk', 'cp8a'];          // console-height faces (IMPL-9b §2.3)
// the Model 15 set (§2.2 header, RM §2.1): 902 × 2, 904A, 907A, 911 × 2, 921, 921A, 921B × 2, 923, 995 + the controller
const M15 = ['902', '902', '904a', '907a', '911', '911', '921', '921a', '921b', '921b', '923', '995'];

test('a leaf: moog-core imports nothing', () => {
  assert.equal(/^\s*import\s/m.test(SRC) || /\bimport\(/.test(SRC), false);
  assert.equal(/\b(document|window|localStorage|setTimeout)\b/.test(SRC.replace(/^\s*\/\/.*$/mg, '')), false);
});

test('the catalogue: every type, its jacks counted as §2.2 / §2.4, 97 in the Model 15 set', () => {
  assert.deepEqual([...MG.ORDER_ALL].sort(), Object.keys(T).sort());
  for (const id of MG.ORDER_ALL) assert.equal(T[id].jacks.length, JACKS[id], id);
  assert.equal(M15.reduce((n, t) => n + T[t].jacks.length, T.ctl.jacks.length), 97);
  assert.equal(MG.FAMILY.id, 'moog'); assert.equal(MG.FAMILY.model, 'm900'); assert.equal(MG.FAMILY.ctl, 'ctl');
  assert.equal(MG.FAMILY.types, T); assert.ok(Object.isFrozen(MG.FAMILY) && Object.isFrozen(T['921b'].jacks[0]));
});

test('params: ids ≤ 3 chars, unique, K inside its range, S an option index, 0 … 48 per type (IMPL-9b §8.8)', () => {
  for (const id of MG.ORDER_ALL) {
    const P = T[id].params, ids = P.map(c => c.id);
    assert.ok(P.length >= 0 && P.length <= 48, id);
    assert.equal(new Set(ids).size, ids.length, id + ' unique');
    for (const c of P) {
      assert.match(c.id, /^[a-z][a-z0-9]{0,2}$/, id + '.' + c.id);
      assert.equal(typeof c.label, 'string');
      if (c.t === 'k') { assert.ok(c.min < c.max && c.def >= c.min && c.def <= c.max, id + '.' + c.id); }
      else { assert.equal(c.t, 's'); assert.ok(Number.isInteger(c.def) && c.def >= 0 && c.def < c.opts.length, id + '.' + c.id); }
      if (c.fmt) assert.equal(typeof c.fmt(c.def), 'string');
    }
  }
  // the §2.2 table's ids, in its order
  const ids = id => T[id].params.map(c => c.id).join(' ');
  assert.equal(ids('921'), 'sp cr fq rg pw ax cl al');
  assert.equal(ids('921a'), 'sp fq pw');
  assert.equal(ids('921b'), 'rg fq ss');
  assert.equal(ids('923'), 'lp hp');
  assert.equal(ids('904a'), 'fc rg re');
  assert.equal(ids('907a'), 'lo b1 b2 b3 b4 b5 b6 b7 b8 hi');
  assert.equal(ids('911'), 't1 t2 t3 es');
  assert.equal(ids('902'), 'md fc');
  assert.equal(ids('995'), 'a1 a2 a3');
  assert.equal(ids('ctl'), 'gl pr rt tu x1 x2 x3 x4 ov');
  // IMPL-9b §2.2–§2.3 (the 960's: stage knobs by row, stage modes, row ranges, the clock; the Song clock's LENGTH: P-2 (b))
  assert.deepEqual(MG.ORDER_ALL.filter(t => T[t].params.length > 16), ['960']);
  assert.deepEqual(MG.ORDER_ALL.filter(t => !T[t].params.length), ['903a', '994', '962', 'cp8a']);   // (§8.8's list names the 993: it has eight switches, no jack)
  assert.equal(ids('904b'), 'fc rg');
  assert.equal(ids('914'), 'lo b1 b2 b3 b4 b5 b6 b7 b8 b9 b10 b11 b12 hi');
  assert.equal(ids('911a'), 'd1 d2 md');
  assert.equal(ids('960'), [...'abc'].flatMap(r => [1, 2, 3, 4, 5, 6, 7, 8].map(k => r + k)).join(' ') + ' s1 s2 s3 s4 s5 s6 s7 s8 s9 ga gb gc rg vn cc os');
  assert.equal(ids('992'), 's1 s2 s3 s4 at');
  assert.equal(ids('993'), 'f1 f2 t1 t2 t3 e1 e2 e3');
  assert.equal(ids('cp3a'), 'x1 x2 x3 x4 ms r1 r2 r3 r4 ra');
  assert.equal(ids('cp4a'), 'c1 c2 c3 c4 t1 t2 t3');
  assert.equal(ids('cp35'), 'a1 a2 a3 a4');
  assert.equal(ids('cp2'), 'lp hp');
  assert.equal(ids('961'), 't1 t2 se');
  assert.equal(ids('clk'), 'dv md ln');
  const opts = (t, p) => T[t].params.find(c => c.id === p).opts.join(' ');
  assert.equal(opts('960', 's1'), 'Stop Normal Skip'); assert.equal(opts('960', 's9'), 'Stop Skip'); assert.equal(opts('960', 'ga'), '×1 ×2 ×4');
  assert.equal(opts('960', 'rg'), '0.1 Hz 0.4 Hz 1.6 Hz 6.4 Hz 26 Hz 100 Hz 410 Hz'); assert.equal(opts('960', 'os'), 'Stopped Running');
  assert.equal(opts('911a', 'md'), 'Off Parallel Series'); assert.equal(opts('904b', 'rg'), 'Low High');
  assert.equal(opts('clk', 'dv'), '1/4 1/8 1/16 1/32 1/8T 1/16T'); assert.equal(opts('clk', 'md'), 'Song Always');
  assert.deepEqual(T.clk.params[2].opts.map((o, i) => (i ? +o : 0)), Array.from({ length: 32 }, (_, i) => (i ? i + 1 : 0)));   // Off, 2 … 32: index = N − 1
  const d9b = t => T[t].params.map(c => c.def).join(' ');
  assert.equal(d9b('960'), Array(24).fill(0).concat(Array(9).fill(1), [0, 0, 0, 2, 2, 0, 1]).join(' '));
  assert.equal(d9b('914'), Array(14).fill(10).join(' '));
  assert.deepEqual([d9b('904b'), d9b('911a'), d9b('992'), d9b('993'), d9b('cp3a'), d9b('cp4a'), d9b('cp35'), d9b('cp2'), d9b('961'), d9b('clk')],
    ['0 0', '3 3 0', '0 0 0 0 0', '0 0 0 0 0 0 0 0', '7 7 7 7 5 0 0 0 0 10', '0 0 0 0 0 0 0', '0 0 0 0', '5 5', '5 5 5', '2 0 0']);
  // §2.3's defaults: an oscillator at 8', a closed VCA, an open bank, a filter mid-range without regeneration
  const def = (t, p) => T[t].params.find(c => c.id === p).def;
  assert.equal(T['921'].params.find(c => c.id === 'rg').opts[def('921', 'rg')], '8\'');
  assert.equal(T['921b'].params.find(c => c.id === 'rg').opts[def('921b', 'rg')], '8\'');
  assert.deepEqual([def('902', 'md'), def('902', 'fc')], [0, 0]);
  assert.ok(T['907a'].params.every(c => c.def === 10));
  assert.deepEqual([def('904a', 'fc'), def('904a', 'rg'), def('904a', 're')], [0, 1, 0]);
  assert.deepEqual([def('921', 'sp'), def('921', 'cr'), def('921', 'pw'), def('921', 'ax'), def('921', 'cl'), def('921', 'al')], [0, 1, 50, 2, 0, 5]);
  assert.equal(def('921b', 'ss'), 1);
  assert.ok(T['995'].params.every(c => c.def === 0));
});

test('jacks: ids, directions, plugs, roles, sections, normals, AC coupling, rear terminals', () => {
  for (const id of MG.ORDER_ALL) {
    const t = T[id], ids = t.jacks.map(j => j.id);
    assert.equal(new Set(ids).size, ids.length, id + ' unique');
    assert.ok(Array.isArray(t.secs) && t.secs.length >= 1 && t.secs.length <= 16, id);                       // the evaluator's MAXSEC
    assert.ok(t.jacks.filter(j => j.dir === 'out').length <= 30, id + ' ≤ 30 outputs (the evaluator\'s mask)');
    for (const j of t.jacks) {
      assert.match(j.id, /^[a-z][a-z0-9]{0,7}$/, id + '.' + j.id);
      assert.ok(['in', 'out', 'any'].includes(j.dir) && ['v', 's'].includes(j.sig) && ['au', 'cv', 'tr'].includes(j.role), id + '.' + j.id);
      assert.ok(Number.isInteger(j.sec) && j.sec >= 0 && j.sec < t.secs.length, id + '.' + j.id + ' sec');
      assert.ok(typeof j.label === 'string' && j.label.length > 0 && j.label === j.label.toUpperCase());
      // a normal: an input of the type, or an output of another section (the CP35's ±6 V) — never itself
      if (j.norm !== undefined) { const n = t.jacks.find(k => k.id === j.norm); assert.ok(j.dir === 'in' && n && n.id !== j.id && (n.dir === 'in' || (n.dir === 'out' && n.sec !== j.sec)), id + '.' + j.id + ' norm'); }
      if (j.ac !== undefined) assert.equal(j.ac, 1);
      if (j.rear !== undefined) assert.ok(j.rear === 1 && j.dir !== 'any' && !j.norm && !j.ac, id + '.' + j.id + ' rear');
      if (j.sig === 's') assert.equal(j.role, 'tr');
      if (j.dir === 'any') assert.ok(['ctl', '994', 'cp3a', 'cp35', 'cp2'].includes(id), id + '.' + j.id + ': multiples');
    }
    const labels = t.jacks.map(j => j.label);
    assert.equal(new Set(labels).size, labels.length, id + ' labels unique (Connect to… names a jack by its label)');
  }
  const sig = (t, s) => T[t].jacks.filter(j => j.sig === 's').map(j => j.id).join(' ');
  assert.equal(sig('921'), 'cs'); assert.equal(sig('911'), 'trg'); assert.equal(sig('ctl'), 'ks1 ks2 vo si');
  for (const t of ['921a', '921b', '923', '904a', '907a', '902', '995']) assert.equal(sig(t), '');
  // IMPL-9b: the S-trigger sockets, the rear terminals, the new types' jack orders (= the payload's ports)
  assert.deepEqual(MG.ORDER.filter(t => sig(t) && !['921', '911'].includes(t)).map(t => t + ': ' + sig(t)),
    ['911a: i1 o1 i2 o2', '961: s1 s2 v1i v2i', 'cp2: so ksr', 'cp4a: ti tr']);
  assert.deepEqual(MG.ORDER.flatMap(t => T[t].jacks.filter(j => j.rear).map(j => `${t}.${j.id} ${j.dir} ${j.sig}`)),
    ['cp2.kpr in v', 'cp2.ksr in s', 'cp3a.xr out v', 'cp4a.tr out s', 'cp4a.cr out v', '992.xr out v']);
  const jo = t => T[t].jacks.map(j => j.id + (j.sec ? j.sec : '')).join(' ');
  assert.equal(jo('904b'), 'in c1 c2 c3 out');
  assert.equal(jo('914'), 'i1 i2 o1 o2');
  assert.equal(jo('903a'), 'wh1 wh2 pk1 pk2');
  assert.equal(jo('960'), 'on off sh ci co i1 i2 i3 i4 i5 i6 i7 i8 i9 o1 o2 o3 o4 o5 o6 o7 o8 o9 ra1 ra2 rb1 rb2 rc1 rc2');
  assert.equal(jo('962'), 'i1 i2 i3 q1 q2 t1 t2 t3 o1 o2 o3 sh');
  assert.equal(jo('992'), 'x4 xr');
  assert.equal(jo('994'), 'a1 a2 a3 a4 b11 b21 b31 b41');
  assert.equal(jo('cp3a'), 'm1 m2 m3 m4 mo mn x41 xr1 a12 a22 a32 a42');
  assert.equal(jo('cp4a'), 'ti tr ci1 cr1');
  assert.equal(jo('cp35'), 'p6 m6 i11 o11 i22 o22 i33 o33 i44 o44 u15 u25 u35 u45');
  assert.deepEqual(T.cp35.jacks.filter(j => j.norm).map(j => j.id + '←' + j.norm), ['i1←p6', 'i2←p6', 'i3←m6', 'i4←m6']);
  assert.equal(jo('cp2'), 'li lo hi1 ho1 u12 u22 u32 u42 po3 so3 kpr3 ksr3');
  assert.equal(jo('961'), [1, 2].map(c => [...[1, 2, 3, 4, 5, 6].map(k => 'a' + c + k), ...[1, 2, 3, 4, 5, 6].map(k => 'b' + c + k), 's' + c].map(x => x + (c - 1 || '')).join(' ')).join(' ')
    + ' v1i2 v1o2 v2i3 v2o3 ai4 ao14 ao24');
  assert.equal(jo('clk'), 'ck rn rs');
  assert.deepEqual([T['960'].jacks.filter(j => j.dir === 'out').length, T['961'].secs.length, T.cp35.secs.length], [16, 5, 6]);
  assert.deepEqual(T['995'].jacks.map(j => [j.id, j.dir, j.sec, j.norm || '']), [['i1', 'in', 0, ''], ['o1', 'out', 0, ''], ['i2', 'in', 1, 'i1'],
    ['o2', 'out', 1, ''], ['i3', 'in', 2, 'i2'], ['o3', 'out', 2, '']]);
  assert.deepEqual(T['923'].jacks.map(j => j.id + j.sec).join(' '), 'wh10 wh20 pk0 li1 lo1 hi2 ho2');
  assert.deepEqual(T['921b'].jacks.filter(j => j.ac).map(j => j.id), ['ac']);
  assert.deepEqual(T['921b'].link, { to: '921a', max: 3 });
  assert.equal(T['921a'].jacks.some(j => j.dir === 'out'), false);
  // the controller's seven sections (§2.6): KBD outputs only, MIX, MULT A, MULT B, V→S, S→V, OUT (the sink)
  const bySec = T.ctl.secs.map((_, s) => T.ctl.jacks.filter(j => j.sec === s).map(j => j.id).join(' '));
  assert.deepEqual(bySec, ['kp1 kp2 ks1 ks2 kg kv kw ka', 'm1 m2 m3 m4 mo mn', 'a1 a2 a3 a4', 'b1 b2 b3 b4', 'vi vo', 'si so', 'out']);
  assert.ok(T.ctl.jacks.filter(j => j.sec === 0).every(j => j.dir === 'out'));
  assert.ok(T.ctl.jacks.filter(j => j.sec === 2 || j.sec === 3).every(j => j.dir === 'any' && j.sig === 'v'));
  assert.deepEqual(T.ctl.jacks.filter(j => j.sec === 6).map(j => [j.id, j.dir, j.sig]), [['out', 'in', 'v']]);
});

test('sizes (§2.2): px per mm and the bar as cv-panel / cv-module; 1 / 2 / 3 MU and the console', () => {
  assert.equal(MG.BAR_H, BAR_H);
  assert.match(readFileSync(new URL('../cv-panel.js', import.meta.url), 'utf8'), new RegExp('PX_PER_MM = ' + MG.PX_PER_MM + '\\b'));
  const px = id => [T[id].w, T[id].h];
  assert.deepEqual(px('921b'), [128, 512]); assert.deepEqual(px('921'), [224, 512]); assert.deepEqual(px('907a'), [352, 512]);
  assert.deepEqual(px('ctl'), [864, 352]);
  // IMPL-9b §2.1 / §2.5: 4 MU 448, 8 MU 864; console height 2 / 3 / 4 MU → 224 / 352 / 448 × 352
  assert.deepEqual([px('914'), px('960'), px('clk'), px('cp2'), px('961'), px('cp3a'), px('cp35'), px('cp8a')],
    [[448, 512], [864, 512], [224, 352], [352, 352], [352, 352], [448, 352], [448, 352], [224, 352]]);
  for (const id of MG.ORDER_ALL) {
    const t = T[id], con = CONSOLE_T.includes(id);
    assert.equal(t.face, con ? 'console' : 'module', id);
    assert.equal(t.layout, id === 'ctl' ? 'm900' : id);
    assert.deepEqual([t.w, t.h], MG.sizeOf(t.mu * MG.MU_MM, con ? MG.CONSOLE_H_MM : MG.FACE_H_MM));
    assert.ok(t.w % 32 === 0 && t.h % 32 === 0 && t.cost >= 0 && t.cost < 0.01, id);
  }
  assert.deepEqual(MG.ORDER_ALL.filter(t => !T[t].cost), ['994', 'cp8a', '993']);          // never scheduled / the evaluator's multiples
  assert.deepEqual(M15.filter(t => T[t].mu !== 1), ['907a', '921']);
});

test('IMPL-9b §1.4–§1.6: events, lamps and bus rows — typed, one plug, out → in, never into a normalled input', () => {
  const evs = t => (T[t].ev || []).map(e => e.id).join(' '), lps = t => (T[t].lamps || []).map(e => e.id).join(' ');
  assert.deepEqual(MG.ORDER_ALL.filter(t => T[t].ev), ['960', '962']);
  assert.deepEqual(MG.ORDER_ALL.filter(t => T[t].lamps), ['960', '962', 'clk']);
  assert.equal(evs('960'), 'on off sh e1 e2 e3 e4 e5 e6 e7 e8 e9'); assert.equal(evs('962'), 'e1 e2 e3');
  assert.equal(lps('960'), 'l1 l2 l3 l4 l5 l6 l7 l8 l9 lo'); assert.equal(lps('962'), 'l1 l2 l3'); assert.equal(lps('clk'), 'lr');
  for (const t of MG.ORDER) for (const L of [T[t].ev, T[t].lamps]) if (L) {
    assert.ok(L.length >= 1 && L.length <= 30 && new Set(L.map(e => e.id)).size === L.length && new Set(L.map(e => e.label)).size === L.length, t);
    for (const e of L) assert.ok(/^[a-z][a-z0-9]{0,2}$/.test(e.id) && typeof e.label === 'string' && e.label === e.label.toUpperCase(), t + '.' + e.id);
  }
  // a bus end: 'c.<port>' · '.<port>' (this panel) · '<t>|<t>…#<k>.<port>' / '#=' (the k-th module of the listed types by number)
  const end = (t, e) => {
    if (e.startsWith('c.')) return [T.ctl.jacks.find(j => j.id === e.slice(2))];
    if (e.startsWith('.')) return [T[t].jacks.find(j => j.id === e.slice(1))];
    const m = /^([a-z0-9]+(?:\|[a-z0-9]+)*)#([1-9]|=)\.([a-z][a-z0-9]{0,7})$/.exec(e);
    return m ? m[1].split('|').map(x => (T[x] && x !== 'ctl' ? T[x].jacks.find(j => j.id === m[3]) : undefined)) : [undefined];
  };
  const rows = [];
  for (const t of MG.ORDER) for (const r of T[t].bus || []) {
    const A = end(t, r.a), B = end(t, r.b), w = t + ' ' + r.a + ' → ' + r.b;
    assert.ok(A.every(Boolean) && B.every(Boolean), w + ': ends resolve to jacks');
    assert.ok(A.every(j => j.dir === 'out') && B.every(j => j.dir === 'in'), w + ': an output into an input');
    assert.ok([...A, ...B].every(j => j.sig === A[0].sig), w + ': one plug');
    assert.ok(B.every(j => j.norm === undefined), w + ': never a normalled input (skeptic #33)');
    assert.ok(Array.isArray(r.sw) && r.sw.every(s => { const c = T[t].params.find(p => p.id === s); return c && c.t === 's' && c.opts.join() === 'Off,On'; }), w + ': its switches');
    assert.ok(r.g === undefined || (r.g >= 0 && r.g <= 4), w + ': g');
    rows.push(`${t} [${r.sw}] ${r.a} → ${r.b}`);
  }
  assert.deepEqual(MG.ORDER.filter(t => T[t].bus), ['cp2', 'cp3a', 'cp4a', '992', '993']);
  assert.deepEqual(rows, [   // IMPL-9b §2.4
    'cp2 [] c.kp1 → .kpr', 'cp2 [] c.ks1 → .ksr',
    'cp3a [r1] c.kp1 → 921a|921#=.f3', 'cp3a [r2] c.kw → 921a|921#=.f3', 'cp3a [r3] c.ka → 921a|921#=.f3', 'cp3a [r4] .xr → 921a|921#=.f3',
    'cp4a [c1] c.kp1 → 904a#1.c3', 'cp4a [c2] c.kw → 904a#1.c3', 'cp4a [c3] c.ka → 904a#1.c3', 'cp4a [c4] .cr → 904a#1.c3',
    'cp4a [t1] c.ks1 → 911#1.trg', 'cp4a [t1] .tr → 911#1.trg', 'cp4a [t2] c.ks1 → 911#2.trg', 'cp4a [t2] .tr → 911#2.trg',
    'cp4a [t3] c.ks1 → 911#3.trg', 'cp4a [t3] .tr → 911#3.trg',
    '992 [s1] c.kp1 → 904b#1.c3', '992 [s2] c.kw → 904b#1.c3', '992 [s3] c.ka → 904b#1.c3', '992 [s4] .xr → 904b#1.c3',
    '993 [f1] c.ks1 → 911a#1.i1', '993 [f2] c.ks2 → 911a#1.i1', '993 [f1,t1] c.ks1 → 911#1.trg', '993 [f2,t1] c.ks2 → 911#1.trg',
    '993 [t2] 911a#1.o1 → 911#2.trg', '993 [t3] 911a#1.o2 → 911#3.trg',
    '993 [e1] 911#1.out → 902#1.c3', '993 [e2] 911#2.out → 902#2.c3', '993 [e3] 911#3.out → 902#3.c3']);
  // a rear terminal is reached by a bus row of its own panel, and every rear jack is
  for (const t of MG.ORDER) for (const j of T[t].jacks.filter(x => x.rear)) assert.ok((T[t].bus || []).some(r => r.a === '.' + j.id || r.b === '.' + j.id), t + '.' + j.id);
});

test('IMPL-9b §1.2, §2.5, §4.4: the sets (S35 22, S55 37 — in Tidy\'s row order), FAMILY.sets, each row within rackWide', () => {
  const count = s => { const o = {}; for (const t of s) o[t] = (o[t] || 0) + 1; return o; };
  assert.deepEqual(count(MG.S35), { 921: 1, '921a': 2, '921b': 4, 923: 1, '904a': 1, '904b': 1, '907a': 1, 911: 3, 902: 3, cp3a: 2, cp4a: 1, cp35: 1, cp8a: 1 });
  assert.deepEqual(count(MG.S55), { 921: 1, '921a': 2, '921b': 6, '903a': 1, 995: 1, 994: 1, 960: 1, 962: 1, '904a': 1, '904b': 1, 914: 1, 911: 5, '911a': 1,
    902: 5, 992: 1, 993: 1, 961: 1, cp2: 1, cp3a: 3, cp8a: 1, clk: 1 });
  assert.deepEqual([MG.M15.length, MG.S35.length, MG.S55.length], [12, 22, 37]);
  const rows = [...MG.ROWS, MG.CONSOLE], W = l => l.reduce((w, t) => w + T[t].w, 0);
  assert.deepEqual([...MG.ROWS.flat(), ...MG.CONSOLE].sort(), [...MG.ORDER].sort(), 'ROWS + CONSOLE = ORDER');
  assert.ok(MG.CONSOLE.every(t => T[t].face === 'console') && MG.ROWS.flat().every(t => T[t].face === 'module'));
  for (const s of [MG.M15, MG.S35, MG.S55]) assert.deepEqual(rows.flatMap(r => s.filter(t => r.includes(t))), [...s], 'numbered in row order');
  assert.deepEqual(rows.map(r => W(MG.S35.filter(t => r.includes(t)))), [1120, 1376, 1920]);
  assert.deepEqual(rows.map(r => W(MG.S55.filter(t => r.includes(t)))), [2624, 2368, 2496]);
  const over = (a, b) => { const ca = count(a), cb = count(b); return a.length + Object.keys(cb).reduce((n, t) => n + Math.max(0, cb[t] - (ca[t] || 0)), 0); };
  assert.deepEqual([48 - MG.S55.length, over(MG.M15, MG.S55), over(MG.S35, MG.S55), over(MG.M15, MG.S35)], [11, 39, 41, 23], 'the cap (§1.7): 11 spare; a System 55 over a Model 15 / a System 35');
  const F = MG.FAMILY;
  assert.deepEqual(Object.keys(F.sets), ['m15', 's35', 's55']);
  assert.deepEqual(Object.values(F.sets).map(s => [s.name, s.set, s.starter]), [['Model 15', MG.M15, 'Classic bass'], ['System 35', MG.S35, 'Swept band'], ['System 55', MG.S55, 'Sequence']]);
  assert.equal(F.sets.m15.set, F.set); assert.equal(F.sets.m15.starter, F.starter);
  assert.deepEqual([F.console, F.rackW, F.rackWide, F.rackN], [MG.CONSOLE, 1024, 2816, 16]);
  assert.equal(F.rackWide, 22 * 128, 'a 22 MU cabinet row at 128 px a MU');
  assert.ok(Object.isFrozen(F.sets.s55) && Object.isFrozen(MG.S55));
});

test('IMPL-9b display laws: 904B f₀, 914 centres, 911A 2 ms … 2 s, the 960\'s clock and rows, 961 40 ms … 4 s and θ, the Song clock\'s steps', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), a + ' vs ' + b);
  near(MG.LAW.f904b(0), 4); near(MG.LAW.f904b(1) / MG.LAW.f904b(0), Math.pow(2, 1.5));
  near(MG.LAW.f914(0), 125); near(MG.LAW.f914(11), 125 * Math.pow(2, 5.5));
  near(MG.LAW.d911a(0), 0.002); near(MG.LAW.d911a(10), 2);
  near(MG.LAW.clk960(0, 0), 0.1); near(MG.LAW.clk960(6, 0), 409.6); near(MG.LAW.clk960(6, 2), 409.6 * Math.pow(4, 0.2));
  near(MG.LAW.row960(10, 0), 2); near(MG.LAW.row960(10, 2), 8); near(MG.LAW.row960(5, 1), 2);
  near(MG.LAW.on961(0), 0.04); near(MG.LAW.on961(5), 0.4); near(MG.LAW.on961(10), 4);
  near(MG.LAW.th961(0), 5); near(MG.LAW.th961(10), 0.05);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(MG.LAW.ticks), [960, 480, 240, 120, 320, 160]);
  assert.equal(T['911a'].params[0].fmt(3), '16 ms'); assert.equal(T['961'].params[0].fmt(5), '400 ms'); assert.equal(T['960'].params.find(c => c.id === 'vn').fmt(10), '×4.00');
});

test('the tray order, the groups, Tidy\'s rows and the console row cover every module type once (IMPL-9b §4.3, §4.4)', () => {
  assert.deepEqual(MG.ORDER, ['921', '921a', '921b', '923', '903a', '904a', '904b', '907a', '914', '902', '911', '911a', '995', '994',
    '960', '961', '962', 'clk', 'cp2', 'cp3a', 'cp4a', 'cp35', 'cp8a', '992', '993']);
  const by = g => MG.ORDER.filter(t => T[t].group === g).join(' ');
  assert.deepEqual(Object.keys(MG.GROUPS), ['src', 'mod', 'ctl', 'seq', 'cp']);
  assert.deepEqual(Object.values(MG.GROUPS), ['Sources', 'Modifiers', 'Control', 'Sequencing', 'Console & routing']);
  assert.deepEqual(Object.keys(MG.GROUPS).map(by), ['921 921a 921b 923 903a', '904a 904b 907a 914 902', '911 911a 995 994', '960 961 962 clk',
    'cp2 cp3a cp4a cp35 cp8a 992 993']);
  assert.deepEqual(MG.ORDER.map(t => T[t].group), Object.keys(MG.GROUPS).flatMap(g => MG.ORDER.filter(t => T[t].group === g).map(() => g)), 'group by group');
  assert.deepEqual([...MG.ROWS.flat(), ...MG.CONSOLE].sort(), [...MG.ORDER].sort());
  assert.deepEqual(MG.ROWS.map(r => r.join(' ')), ['921 921a 921b 923 903a 995 994 960 962', '904a 904b 907a 914 911 911a 902 992 993']);
  assert.deepEqual([...MG.CONSOLE], ['cp2', 'cp3a', 'cp4a', 'cp35', '961', 'clk', 'cp8a']);
  // a Model 15 Tidy is unchanged: its types keep their stage-9 rows and relative order
  assert.deepEqual(MG.ROWS.map(r => r.filter(t => M15.includes(t)).join(' ')), ['921 921a 921b 923 995', '904a 907a 911 902']);
  assert.deepEqual(MG.ORDER.map(t => T[t].tile), ['921 Oscillator', '921A Driver', '921B Oscillator', '923 Noise', '903A Random signal', '904A Low-pass',
    '904B High-pass', '907A Filter bank', '914 Filter bank', '902 Amplifier', '911 Envelope', '911A Trigger delay', '995 Attenuators', '994 Multiples',
    '960 Sequencer', '961 Interface', '962 Switch', 'Song clock', 'CP2 Filters', 'CP3A Mixer', 'CP4A Routing', 'CP35 Attenuators', 'CP8A Power',
    '992 Control voltages', '993 Trigger routing']);
  assert.deepEqual(MG.ORDER.map(t => T[t].short), ['921', '921A', '921B', '923', '903A', '904A', '904B', '907A', '914', '902', '911', '911A', '995', '994',
    '960', '961', '962', 'SONG CLOCK', 'CP2', 'CP3A', 'CP4A', 'CP35', 'CP8A', '992', '993']);
  for (const t of MG.ORDER) assert.ok(T[t].name.length <= 40 && T[t].tile.length <= 24, t);
});

test('the controller: CTL_SECTIONS (models.js sections), CTL_IDS, the type\'s params; pvOf', () => {
  assert.deepEqual(MG.CTL_SECTIONS.map(s => s.title), ['Keyboard', 'Mixer', 'Output']);
  assert.deepEqual([...MG.CTL_IDS], ['gl', 'pr', 'rt', 'tu', 'x1', 'x2', 'x3', 'x4', 'ov']);
  assert.deepEqual(T.ctl.params.map(c => c.id), [...MG.CTL_IDS]);
  for (const s of MG.CTL_SECTIONS) for (const c of s.c) assert.ok(T.ctl.params.includes(c));
  const c = id => T.ctl.params.find(x => x.id === id);
  assert.deepEqual(c('pr').opts, ['Low', 'Last']); assert.equal(c('pr').def, 0);           // Q1: LOW
  assert.deepEqual(c('rt').opts, ['Single', 'Multiple']); assert.equal(c('rt').def, 0);
  assert.deepEqual([c('tu').min, c('tu').max, c('tu').def], [-50, 50, 0]);
  assert.deepEqual([c('gl').def, c('ov').def, c('x1').def, c('x4').def], [0, 7, 7, 7]);
  assert.equal(c('gl').fmt(0), 'off');
  // pvOf: the controller's values in order (defaults when absent or not finite), vals.p's m<k> entries passed through
  const p = { m3: { _t: '904a', fc: 2 }, m12: { _t: '911', t1: 3 }, junk: { a: 1 }, m4: 7 };
  const pv = MG.pvOf({ gl: 2, tu: -10, x2: 'x', ov: NaN, p });
  assert.deepEqual(pv[0], [2, 0, 0, -10, 7, 7, 7, 7, 7]);
  assert.deepEqual(Object.keys(pv).sort(), ['0', 'm12', 'm3']);
  assert.equal(pv.m3, p.m3);
  assert.deepEqual(MG.pvOf(null)[0], MG.CTL_IDS.map(id => c(id).def));
  assert.deepEqual(MG.pvOf({ p: [1, 2] }), { 0: MG.CTL_IDS.map(id => c(id).def) });
});

test('display laws (§2.2, §2.4): 911 2 ms … 10 s, E SUS 0 … 5.5 V, 923 10 Hz … 10 kHz, GLIDE off / 5 ms … 5 s', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)), a + ' vs ' + b);
  near(MG.LAW.t911(0), 0.002); near(MG.LAW.t911(10), 10);
  near(MG.LAW.es911(10), 5.5); near(MG.LAW.es911(0), 0);
  near(MG.LAW.rc923(0), 10); near(MG.LAW.rc923(10), 10000);
  assert.equal(MG.LAW.glide(0), 0); near(MG.LAW.glide(10), 5);
  assert.equal(T['911'].params[0].fmt(0), '2.0 ms'); assert.equal(T['911'].params[0].fmt(10), '10.00 s');
  assert.equal(T['923'].params[0].fmt(10), '10.0 kHz');
});

test('the Model 15 set, FAMILY\'s fields, the presets\' shape (roles, types, ports, values in range; each within its set — IMPL-9b §2.6)', () => {
  assert.deepEqual([...MG.M15].sort(), [...M15].sort());
  assert.equal(MG.FAMILY.set, MG.M15); assert.equal(MG.FAMILY.starter, 'Classic bass'); assert.equal(MG.FAMILY.sink, 'out');
  assert.equal(MG.FAMILY.rackW, 1024); assert.equal(MG.FAMILY.PRESETS, MG.PRESETS);
  assert.deepEqual(Object.keys(MG.FAMILY.plugs).sort(), ['s', 'v']);
  assert.ok(T.ctl.jacks.some(j => j.id === MG.FAMILY.sink && j.dir === 'in'));
  assert.deepEqual(MG.PRESETS.map(p => p.name), ['Classic bass', 'Filter sweep', 'Drone', 'Sync lead', 'Wind', 'Bells',
    'Swept band', 'Sequence', 'Twenty-four steps', 'Echo strikes', 'Vowel', 'Step bass', 'Routed']);
  // the smallest set that carries each preset's modules: stage 9's six the Model 15, Swept band the System 35, the rest the System 55
  const fits = (p, set) => { const c = {}; for (const t of set) c[t] = (c[t] || 0) + 1; return p.mods.every(([, t]) => (c[t] = (c[t] || 0) - 1) >= 0); };
  assert.deepEqual(MG.PRESETS.map(p => ['m15', 's35', 's55'].find(id => fits(p, MG.FAMILY.sets[id].set))), [...Array(6).fill('m15'), 's35', ...Array(6).fill('s55')]);
  for (const id of ['s35', 's55']) assert.ok(MG.PRESETS.some(p => p.name === MG.FAMILY.sets[id].starter), id + '\'s starter shipped');
  for (const p of MG.PRESETS) {
    assert.ok(typeof p.about === 'string' && p.about.length > 10 && p.name.length <= 40, p.name);
    const roles = p.mods.map(([r]) => r), typeOf = Object.fromEntries(p.mods);
    assert.equal(new Set(roles).size, roles.length, p.name + ' roles unique');
    for (const [r, t] of p.mods) { assert.match(r, /^[a-z][a-z0-9]{0,3}$/); assert.notEqual(r, 'c'); assert.ok(MG.ORDER.includes(t), p.name + ' ' + t); }
    for (const [r, d] of Object.entries(p.drv)) assert.ok(T[typeOf[r]].link && T[typeOf[r]].link.to === typeOf[d], p.name + ' drv ' + r);
    for (const [a, b] of p.cords) for (const e of [a, b]) {
      const [r, port] = e.split('.'), t = r === 'c' ? 'ctl' : typeOf[r];
      assert.ok(t && T[t].jacks.some(j => j.id === port), p.name + ' ' + e);
    }
    for (const [r, vs] of Object.entries(p.v)) {
      const t = r === 'c' ? 'ctl' : typeOf[r];
      assert.ok(t, p.name + ' values of ' + r);
      for (const [id, x] of Object.entries(vs)) {
        const c = T[t].params.find(q => q.id === id);
        assert.ok(c && (c.t === 'k' ? x >= c.min && x <= c.max : Number.isInteger(x) && x >= 0 && x < c.opts.length), p.name + ' ' + r + '.' + id);
      }
    }
  }
  // Classic bass (§2.5, an octave up after the listening renders): 15 cords, the 921Bs at 8' saw and 4' rect detuned 4 cents, the 921 at 16', the 995 at 5
  const cb = MG.PRESETS[0];
  assert.equal(cb.cords.length, 15);
  assert.deepEqual([cb.v.o1.rg, cb.v.o2.rg].map(x => T['921b'].params[0].opts[x]).concat(T['921'].params[3].opts[cb.v.o3.rg]), ['8\'', '4\'', '16\'']);
  assert.ok(Math.abs(cb.v.o2.fq / 6 * 1200 - 4) < 1e-9);
  assert.equal(cb.v.at.a1, 5);
  assert.ok(Math.abs(Math.pow(2, 1 + MG.PRESETS[5].v.o2.fq / 6) - 3.5) < 1e-3);  // Bells: 1 : 3.5
  // IMPL-9b §2.6: the clocked pair — the Song clock's LENGTH 8 / 24 (P-2 (b): index N − 1), CLOCK → 994 A → SHIFT, RESTART → 994 B →
  // IN 1, the 960's clock stopped at start; the keyboard's pitch only through a 902 at −2 V LIN opened by GATE (P-3 (b)) —; the riff;
  // Twenty-four steps' 962 shifted by stage 1's OUT and reset by RESTART; Echo strikes' 150 ms; Step bass's clock at C4 = 523.25 Hz
  // (C2 = clock / 8); Routed's six cords
  const P = n => MG.PRESETS.find(x => x.name === n), sq = P('Sequence'), tf = P('Twenty-four steps');
  assert.deepEqual([sq.v.ck.ln + 1, tf.v.ck.ln + 1], [8, 24]);
  for (const p of [sq, tf]) {
    const has = (x, y) => p.cords.some(c => c[0] === x && c[1] === y);
    assert.ok(has('ck.ck', 'mu.a1') && has('mu.a2', 'sq.sh') && has('ck.rs', 'mu.b1') && has('mu.b2', 'sq.i1'), p.name + ': CLOCK → SHIFT, RESTART → IN 1');
    assert.ok(has('c.kp1', 'gt.i1') && has('c.kg', 'gt.c1') && p.v.gt.md === 0 && p.v.gt.fc === -2, p.name + ': the gated transpose');
    assert.ok(!p.cords.some(c => /^c\.kp/.test(c[0]) && c[1] !== 'gt.i1'), p.name + ': no ungated pitch');
    assert.deepEqual([p.v.sq.os, p.v.ck.md, p.v.ck.dv], [0, 0, 2]);
  }
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(k => Math.round(sq.v.sq['a' + k] * 12 / 5)), [0, 0, 3, 7, 12, 10, 7, 5]);   // C C E♭ G C′ B♭ G F
  assert.ok(tf.cords.some(c => c[0] === 'sq.o1' && c[1] === 'sw.sh') && tf.cords.some(c => c[0] === 'mu.b3' && c[1] === 'sw.t1'));
  assert.ok(Math.abs(MG.LAW.d911a(P('Echo strikes').v.dl.d1) - 0.15) < 0.001 && P('Echo strikes').v.dl.md === 2);
  const sb = P('Step bass').v.sq;
  assert.ok(Math.abs(MG.LAW.clk960(sb.rg, sb.vn) - 2 * 261.6255653005986) < 1e-6 && sb.rg === 6);
  assert.ok(Math.abs([1, 2, 3, 4, 5, 6, 7, 8].reduce((n, k) => n + sb['a' + k], 0) / 8 - sb.b1) < 1e-12 && [2, 3, 4, 5, 6, 7, 8].every(k => sb['b' + k] === sb.b1));   // row B = row A's mean: the 902 takes the offset off
  assert.deepEqual([P('Routed').cords.length, P('Swept band').cords.length, sq.cords.length, tf.cords.length], [6, 20, 24, 28]);
});

// The three tables of one module type agree (§2.6, §7.4; IMPL-9b §2.7): moog-core's, PatchMoog's (moog-dsp.js, lanes V9b / V9c:
// T, JACKS, SECS, PARAMS, and EV / LAMPS as ids in order — a type without either: absent or []) and the faces' (panels/m900.js,
// panels/m900b.js — lanes P9 / P9b: a `{ <type>: layout }` export, the console as m900.js's default; live jacks = controls with a
// `port` (never a rear jack), event buttons = `kind: 'button'` with `ev`, live lamps = `kind: 'lamp'` with `lamp`). Each check
// runs once its file is on the branch; until then it is skipped and says so (IMPL-9 §12, lane K9).
const DSP = new URL('../moog-dsp.js', import.meta.url), PANELS = ['m900.js', 'm900b.js'].map(f => new URL('../panels/' + f, import.meta.url));
test('moog-core = PatchMoog (T, JACKS, SECS, PARAMS, EV, LAMPS)', t => {
  if (!existsSync(DSP)) { t.skip('moog-dsp.js not on this branch yet (V9b)'); return; }
  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(DSP, 'utf8'), ctx, { filename: 'moog-dsp.js' });
  const G = ctx.PatchMoog;
  assert.ok(G && typeof G === 'object', 'PatchMoog published');
  const PM = JSON.parse(JSON.stringify({ JACKS: G.JACKS, SECS: G.SECS, PARAMS: G.PARAMS, EV: G.EV || {}, LAMPS: G.LAMPS || {}, T: Object.keys(G.T || {}) }));
  assert.deepEqual([...PM.T].sort(), [...MG.ORDER_ALL].sort(), 'PatchMoog.T registers every type');
  const idsOf = L => (L || []).map(x => (typeof x === 'string' ? x : x && x.id));
  for (const id of MG.ORDER_ALL) {
    const jk = (PM.JACKS[id] || []).map(x => (typeof x === 'string' ? x : x && x.id));
    assert.deepEqual(jk, T[id].jacks.map(j => j.id), id + ' JACKS');
    const S = PM.SECS[id];
    if (typeof S === 'number') assert.equal(S, T[id].secs.length, id + ' SECS (count)');
    else assert.deepEqual(S, T[id].jacks.map(j => j.sec), id + ' SECS (per jack)');
    const P = PM.PARAMS[id], ids = Array.isArray(P) ? P.map(x => (typeof x === 'string' ? x : Array.isArray(x) ? x[0] : x && x.id))
      : Object.keys(P || {}).sort((a, b) => P[a] - P[b]);
    assert.deepEqual(ids, T[id].params.map(c => c.id), id + ' PARAMS');
    if (Array.isArray(P) && P.length && typeof P[0] !== 'string') assert.deepEqual(P.map(x => (Array.isArray(x) ? x[1] : x.def)), T[id].params.map(c => c.def), id + ' PARAMS defaults');
    assert.deepEqual(idsOf(PM.EV[id]), (T[id].ev || []).map(e => e.id), id + ' EV');
    assert.deepEqual(idsOf(PM.LAMPS[id]), (T[id].lamps || []).map(e => e.id), id + ' LAMPS');
  }
});
test('moog-core = the faces (panels/m900.js, panels/m900b.js: every face\'s live jacks, event buttons and lamps are its type\'s; rear jacks never placed)', async t => {
  const files = PANELS.filter(u => existsSync(u));
  if (!files.length) { t.skip('panels/m900.js not on this branch yet (P9)'); return; }
  const live = (L, f) => (L && Array.isArray(L.controls) ? L.controls.filter(c => c && f(c)) : null);
  const ports = L => { const c = live(L, c => typeof c.port === 'string'); return c && c.map(x => x.port).sort(); };
  const found = {}, evs = {}, lps = {};
  for (const u of files) {
    const mod = await import(u.href + '?v=9');
    if (u === PANELS[0] && ports(mod.default)) found.ctl = ports(mod.default);                    // the controller's console
    for (const v of Object.values(mod)) if (v && typeof v === 'object' && !Array.isArray(v)) for (const id of MG.ORDER) if (ports(v[id]) || (v[id] && Array.isArray(v[id].controls))) {
      found[id] = ports(v[id]);
      evs[id] = live(v[id], c => c.kind === 'button' && typeof c.ev === 'string').map(c => c.ev).sort();
      lps[id] = live(v[id], c => c.kind === 'lamp' && typeof c.lamp === 'string').map(c => c.lamp).sort();
    }
  }
  if (!Object.keys(found).length) { t.skip('panels: no layout with live `port` jacks found (expected: the console as m900.js\'s default export, the modules as a { <type>: layout } export)'); return; }
  for (const id of Object.keys(found)) assert.deepEqual(found[id], T[id].jacks.filter(j => !j.rear).map(j => j.id).sort(), id + ' ports (rear jacks never placed)');
  for (const id of Object.keys(evs)) {
    assert.deepEqual(evs[id], (T[id].ev || []).map(e => e.id).sort(), id + ' event buttons');
    assert.deepEqual(lps[id], (T[id].lamps || []).map(e => e.id).sort(), id + ' lamps');
  }
  assert.deepEqual(Object.keys(found).sort(), [...MG.ORDER_ALL].sort(), 'a face for every type');
});

// Headroom (§3.2, §8.1; OUT_K 0.15 / V, V9b): every preset on a fresh 900 Series over the real circuits (patch-core loadPreset →
// payload, pvOf → PatchDSP.create + PatchMoog), its note line (moog-dsp.test's: an eighth-note bass line at 120 BPM, a slow lead,
// none for the free-running ones), 2 s; MAIN OUT at the base rate (a windowed-sinc low-pass below 20 kHz, every OS-th sample) peaks
// −12 … −3 dBFS before the track's limiter at 48 kHz × 4.
test('every preset peaks −12 … −3 dBFS at 48 kHz × 4 over PatchDSP + PatchMoog', t => {
  if (!source('patch-dsp.js') || !source('moog-dsp.js')) { t.skip('patch-dsp.js / moog-dsp.js not on this branch yet (V9a / V9b)'); return; }
  const sc = dspScope({ files: [], fast: true, sampleRate: 48000 });
  sc.run(source('patch-dsp.js'), 'patch-dsp.js'); sc.run(source('moog-dsp.js'), 'moog-dsp.js');
  const PD = sc.global('PatchDSP'), base = 48000, os = 4, dB = x => 20 * Math.log10(Math.max(1e-300, x));
  const line = kind => {
    const q = base / 8, o = [], fr = x => Math.round(x / 4) * 4;
    if (kind === 'bass') [48, 48, 60, 48, 51, 53, 55, 58].forEach((n, k) => o.push([fr(2 * k * q), n, 0.8, 1], [fr((2 * k + 1.6) * q), n, 0, 0]));
    if (kind === 'lead') [60, 67, 72, 70].forEach((n, k) => o.push([fr(4 * k * q), n, 0.8, 1], [fr((4 * k + 3.6) * q), n, 0, 0]));
    return o.sort((a, b) => a[0] - b[0] || a[3] - b[3]);
  };
  const LINE = { 'Classic bass': 'bass', 'Filter sweep': 'lead', Drone: 'none', 'Sync lead': 'lead', Wind: 'none', Bells: 'lead',
    'Swept band': 'lead', Sequence: 'none', 'Twenty-four steps': 'none', 'Echo strikes': 'lead', Vowel: 'lead', 'Step bass': 'bass', Routed: 'bass' };
  // the clocked ones (IMPL-9b §2.6): built while stopped, then ▶ from a stop (the patch reset) at 120 BPM — fpt 25 frames a tick
  const SONG = new Set(['Sequence', 'Twenty-four steps']), PMT = sc.global('PatchMoog').T, waits = [];
  const H = 95, c = 20000 / (base * os), h = new Float64Array(H);
  let hs = 0;
  for (let k = 0; k < H; k++) { const x = k - (H - 1) / 2; h[k] = (x === 0 ? 2 * c : Math.sin(2 * Math.PI * c * x) / (Math.PI * x)) * (0.42 - 0.5 * Math.cos(2 * Math.PI * k / (H - 1)) + 0.08 * Math.cos(4 * Math.PI * k / (H - 1))); hs += h[k]; }
  const bad = [], rep = [];
  for (const P of MG.PRESETS) {
    if (P.mods.some(([, t]) => !PMT[t])) { waits.push(P.name); continue; }   // a type V9c's circuits do not hold yet
    const r = PT.loadPreset(PT.fresh('moog'), {}, P.name), { pg } = PT.payload(r.rec, 'moog', r.vals), errs = [];
    const tp = { play: false, frame: 0, tick: 0, fpt: 1, loop: false, ls: 0, le: 0, wrap: false };
    const inst = { OS: os, fs: base * os, salt: 0, bend: 0, wheel: 0, at: 0, sustain: false, tp, bpm: 120, ptFail(w) { errs.push(String(w)); } };
    const mc = PD.create(inst, 'moog');
    mc.set(MG.pvOf(r.vals)); mc.graph(pg);
    if (SONG.has(P.name)) { for (let F = 0; F < 2048; F += 128) mc.render(new Float64Array(128 * os), 128 * os, F); mc.reset(); Object.assign(tp, { play: true, frame: 0, tick: 0, fpt: 25, end: Infinity }); }
    const nF = 2 * base, y = new Float64Array(nF * os), buf = new Float64Array(128 * os), notes = line(LINE[P.name]);
    let F = 0, e = 0, at = 0;
    while (F < nF) {
      while (e < notes.length && notes[e][0] <= F) { const [, k, v, on] = notes[e++]; mc.note(k, v, on); }
      let n = Math.min(128, nF - F);
      if (e < notes.length) n = Math.min(n, notes[e][0] - F);
      n = Math.max(4, n - (n % 4));
      buf.fill(0, 0, n * os); mc.render(buf, n * os, F); y.set(buf.subarray(0, n * os), at); at += n * os; F += n;
    }
    let pk = 0, ss = 0;
    for (let i = 0; i < nF; i++) { let a = 0; const m = i * os + (H - 1) / 2; for (let k = 0; k < H; k++) { const j = m - k; if (j >= 0 && j < y.length) a += h[k] * y[j]; } a /= hs; pk = Math.max(pk, Math.abs(a)); ss += a * a; }
    const p = dB(pk), rm = dB(Math.sqrt(ss / nF));
    rep.push(`${P.name} ${p.toFixed(1)} / ${rm.toFixed(1)}`);
    if (errs.length || !(p >= -12 && p <= -3)) bad.push(`${P.name}: ${p.toFixed(2)} dBFS peak${errs.length ? ' · ' + errs.join(' ') : ''}`);
  }
  console.log('# presets, dBFS peak / RMS at 48 k × 4: ' + rep.join(' · '));
  if (waits.length) t.diagnostic('waiting for the 9b circuits (V9c): ' + waits.join(', '));
  assert.deepEqual(bad, []);
  assert.ok(rep.length >= 6, 'stage 9\'s six measured');
});

// IMPL-9b §2.6 (skeptic #2, P-2 (b)): the clocked presets on the real circuits step on the song's sixteenths from stage 1 — Sequence's
// 960 1 … 8 and round, Twenty-four steps' 962 A → B → C as the 960 comes round to stage 1 — read from the lamps (bit k−1 = stage k)
// at each 128-frame chunk's end, the transport playing at 120 BPM from a stop (a sixteenth = 6 000 frames)
test('the clocked presets step on the song\'s sixteenths from stage 1 (Sequence 1…8; Twenty-four steps: the 962 A → B → C)', t => {
  if (!source('patch-dsp.js') || !source('moog-dsp.js')) { t.skip('patch-dsp.js / moog-dsp.js not on this branch yet'); return; }
  const sc = dspScope({ files: [], fast: true, sampleRate: 48000 });
  sc.run(source('patch-dsp.js'), 'patch-dsp.js'); sc.run(source('moog-dsp.js'), 'moog-dsp.js');
  const PD = sc.global('PatchDSP'), PMT = sc.global('PatchMoog').T;
  if (!['960', '962', 'clk', '994', '961', '911a'].every(x => PMT[x])) { t.skip('the 9b circuits (V9c) not on this branch yet'); return; }
  for (const name of ['Sequence', 'Twenty-four steps']) {
    const r = PT.loadPreset(PT.fresh('moog'), {}, name), { pg } = PT.payload(r.rec, 'moog', r.vals), tp = { play: false, frame: 0, tick: 0, fpt: 1, loop: false, ls: 0, le: 0, wrap: false };
    const mc = PD.create({ OS: 4, fs: 192000, salt: 0, bend: 0, wheel: 0, at: 0, sustain: false, tp, bpm: 120, ptFail() {} }, 'moog');
    mc.set(MG.pvOf(r.vals)); mc.graph(pg);
    const buf = new Float64Array(512), num = ty => +Object.keys(r.rec.mods).find(k => r.rec.mods[k].t === ty).slice(1);
    for (let F = 0; F < 2048; F += 128) mc.render(buf.fill(0), 512, F);
    mc.reset(); Object.assign(tp, { play: true, frame: 0, tick: 0, fpt: 25, end: Infinity });
    const n960 = num('960'), n962 = name === 'Sequence' ? -1 : num('962'), got = [], want = [];
    let last = '';
    for (let F = 0; F < 25 * 6000; F += 128) {
      mc.render(buf.fill(0), 512, F);
      const L = mc.lamps(F + 128).l, s = {};
      for (let i = 0; i < L.length; i += 2) s[L[i]] = L[i + 1];
      const st = b => Math.log2(b & 511) + 1, k = st(s[n960]) + (n962 > 0 ? '/' + st(s[n962]) : '');
      if (k !== last) { got.push(k + '@' + (F + 128)); last = k; }
    }
    for (let j = 0; j <= 25; j++) want.push((j % 8 + 1) + (n962 > 0 ? '/' + (Math.floor(j / 8) % 3 + 1) : '') + '@' + (Math.floor(j * 6000 / 128) * 128 + 128));
    assert.deepEqual(got, want, name);
  }
});

// Bells rings like a bell (the lead, after the listening renders): one strike — key 48 / 60 / 72, let go after 0.15 s or held 2 s —
// peaks within 30 ms (a clear attack) and its 10 ms RMS envelope first falls 40 dB below that peak at 1.5 s ± 0.15
test('Bells: each strike rings ≈ 1.5 s to −40 dB, held or not, with a clear attack', t => {
  if (!source('patch-dsp.js') || !source('moog-dsp.js')) { t.skip('patch-dsp.js / moog-dsp.js not on this branch yet (V9a / V9b)'); return; }
  const sc = dspScope({ files: [], fast: true, sampleRate: 48000 });
  sc.run(source('patch-dsp.js'), 'patch-dsp.js'); sc.run(source('moog-dsp.js'), 'moog-dsp.js');
  const PD = sc.global('PatchDSP'), base = 48000, os = 4, dB = x => 20 * Math.log10(Math.max(1e-300, x)), bad = [], rep = [];
  const r = PT.loadPreset(PT.fresh('moog'), {}, 'Bells'), { pg } = PT.payload(r.rec);
  for (const [key, hold] of [[60, 0.15], [60, 2], [48, 0.15], [72, 0.15]]) {
    const inst = { OS: os, fs: base * os, salt: 0, bend: 0, wheel: 0, at: 0, sustain: false, ptFail() {} };
    const mc = PD.create(inst, 'moog');
    mc.set(MG.pvOf(r.vals)); mc.graph(pg);
    const nF = 3 * base, off = Math.round(hold * base / 4) * 4, buf = new Float64Array(128 * os), env = [];
    let F = 0, acc = 0, cnt = 0;
    mc.note(key, 0.8, 1);
    while (F < nF) {
      if (F === off) mc.note(key, 0, 0);
      let n = Math.min(128, nF - F);
      if (F < off) n = Math.min(n, off - F);
      buf.fill(0, 0, n * os); mc.render(buf, n * os, F);
      for (let i = 0; i < n * os; i++) { acc += buf[i] * buf[i]; if (++cnt === base * os / 100) { env.push(Math.sqrt(acc / cnt)); acc = 0; cnt = 0; } }
      F += n;
    }
    let pk = 0, at = 0;
    env.forEach((x, i) => { if (x > pk) { pk = x; at = i; } });
    const i40 = env.findIndex((x, i) => i > at && dB(x) < dB(pk) - 40), t40 = i40 < 0 ? Infinity : i40 / 100;
    rep.push(`key ${key} ${hold === 2 ? 'held' : 'struck'}: peak at ${at * 10} ms, −40 dB at ${t40.toFixed(2)} s`);
    if (at > 2 || !(Math.abs(t40 - 1.5) <= 0.15)) bad.push(rep[rep.length - 1]);
  }
  console.log('# Bells: ' + rep.join(' · '));
  assert.deepEqual(bad, []);
});

// IMPL-P review F2: makeSet numbers its modules past every m<k> of vals.p — and past the id ceiling (m999999) it made ids that isMid
// refuses, so the first normPatch (a save, a load, an undo) dropped half the set without a word. Now null (no room: patch-core's own
// "No module numbers left"); at the last seed that fits, every id is a module id and the record is normal as it stands
test('IMPL-P review F2: makeSet stops at the id ceiling — the last seed that fits makes a normal record of valid ids, the next returns null (no ids past m999999)', () => {
  for (const id of Object.keys(MG.SETS)) {
    const len = MG.SETS[id].set.length, last = 999999 - len;                         // (the highest m<k> in vals.p that still leaves room: k + len ≤ 999999)
    for (const k of [1, 4096, 123456, last - 1, last]) {
      const s = MG.makeSet(id, { p: { ['m' + k]: { _t: '921' } } });
      assert.ok(s !== null, id + ' seeded m' + k);
      const ks = Object.keys(s.rec.mods);
      assert.equal(ks.length, len);
      assert.ok(ks.every(PT.isMid), id + ' seeded m' + k + ': every id a module id');
      assert.ok(s.rec.nid <= 1e6, 'nid within the bound');
      assert.deepEqual(PT.normPatch(JSON.parse(JSON.stringify(s.rec)), 'moog'), s.rec, id + ' seeded m' + k + ': normPatch keeps it whole');
    }
    for (const k of [last + 1, last + 2, 999998, 999999]) assert.equal(MG.makeSet(id, { p: { ['m' + k]: { _t: '921' } } }), null, id + ' seeded m' + k + ': no room');
  }
});
