import './v8-guard.mjs';
// moog-core.js (IMPL-9 §2.2, §2.4, §2.6, §8.2; lane K9): the 900-series family's tables — a leaf (no import); every type's
// params (ids ≤ 3 chars, defaults inside their ranges, ≤ 16), jacks (ids, directions, plugs, roles, sections, normals) and sizes
// (§2.2: 1 MU → 128 × 512, 2 → 224 × 512, 3 → 352 × 512, the console 864 × 352); the jack counts of §2.2 (97 in the Model 15 set
// with the controller); the controller's controls (CTL_SECTIONS, CTL_IDS) and pvOf; the tray order and Tidy's rows; the presets'
// shape and their headroom on the real circuits (patch-dsp.js + moog-dsp.js: every preset peaks −12 … −3 dBFS at 48 kHz × 4);
// the three tables of a type (moog-core = PatchMoog = panels/m900.js's ports).
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
const JACKS = { ctl: 27, 921: 13, '921a': 5, '921b': 7, 923: 7, '904a': 5, '907a': 2, 911: 2, 902: 7, 995: 6 };
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

test('params: ids ≤ 3 chars, unique, K inside its range, S an option index, ≤ 16 per type', () => {
  for (const id of MG.ORDER_ALL) {
    const P = T[id].params, ids = P.map(c => c.id);
    assert.ok(P.length >= 1 && P.length <= 16, id);
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

test('jacks: ids, directions, plugs, roles, sections, normals, AC coupling', () => {
  for (const id of MG.ORDER_ALL) {
    const t = T[id], ids = t.jacks.map(j => j.id);
    assert.equal(new Set(ids).size, ids.length, id + ' unique');
    assert.ok(Array.isArray(t.secs) && t.secs.length >= 1 && t.secs.length <= 8, id);
    for (const j of t.jacks) {
      assert.match(j.id, /^[a-z][a-z0-9]{0,7}$/, id + '.' + j.id);
      assert.ok(['in', 'out', 'any'].includes(j.dir) && ['v', 's'].includes(j.sig) && ['au', 'cv', 'tr'].includes(j.role), id + '.' + j.id);
      assert.ok(Number.isInteger(j.sec) && j.sec >= 0 && j.sec < t.secs.length, id + '.' + j.id + ' sec');
      assert.ok(typeof j.label === 'string' && j.label.length > 0 && j.label === j.label.toUpperCase());
      if (j.norm !== undefined) { const n = t.jacks.find(k => k.id === j.norm); assert.ok(j.dir === 'in' && n && n.dir === 'in' && n.id !== j.id, id + '.' + j.id + ' norm'); }
      if (j.ac !== undefined) assert.equal(j.ac, 1);
      if (j.sig === 's') assert.equal(j.role, 'tr');
      if (j.dir === 'any') assert.equal(id, 'ctl');
    }
    const labels = t.jacks.map(j => j.label);
    assert.equal(new Set(labels).size, labels.length, id + ' labels unique (Connect to… names a jack by its label)');
  }
  const sig = (t, s) => T[t].jacks.filter(j => j.sig === 's').map(j => j.id).join(' ');
  assert.equal(sig('921'), 'cs'); assert.equal(sig('911'), 'trg'); assert.equal(sig('ctl'), 'ks1 ks2 vo si');
  for (const t of ['921a', '921b', '923', '904a', '907a', '902', '995']) assert.equal(sig(t), '');
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
  for (const id of MG.ORDER_ALL) {
    const t = T[id];
    assert.equal(t.face, id === 'ctl' ? 'console' : 'module');
    assert.equal(t.layout, id === 'ctl' ? 'm900' : id);
    assert.deepEqual([t.w, t.h], MG.sizeOf(t.mu * MG.MU_MM, id === 'ctl' ? MG.CONSOLE_H_MM : MG.FACE_H_MM));
    assert.ok(t.w % 32 === 0 && t.h % 32 === 0 && t.cost > 0 && t.cost < 0.01, id);
  }
  assert.deepEqual(M15.filter(t => T[t].mu !== 1), ['907a', '921']);
});

test('the tray order, the groups and Tidy\'s rows cover every module type once', () => {
  assert.deepEqual(MG.ORDER, ['921', '921a', '921b', '923', '904a', '907a', '902', '911', '995']);
  assert.deepEqual(MG.ORDER.map(t => T[t].group), ['src', 'src', 'src', 'src', 'mod', 'mod', 'mod', 'ctl', 'ctl']);
  assert.deepEqual(Object.keys(MG.GROUPS), ['src', 'mod', 'ctl']);
  assert.deepEqual(MG.ROWS.flat().sort(), [...MG.ORDER].sort());
  assert.deepEqual(MG.ORDER.map(t => T[t].tile), ['921 Oscillator', '921A Driver', '921B Oscillator', '923 Noise', '904A Low-pass',
    '907A Filter bank', '902 Amplifier', '911 Envelope', '995 Attenuators']);
  assert.deepEqual(MG.ORDER.map(t => T[t].short), ['921', '921A', '921B', '923', '904A', '907A', '902', '911', '995']);
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

test('the Model 15 set, FAMILY\'s fields, the presets\' shape (roles, types, ports, values in range)', () => {
  assert.deepEqual([...MG.M15].sort(), [...M15].sort());
  assert.equal(MG.FAMILY.set, MG.M15); assert.equal(MG.FAMILY.starter, 'Classic bass'); assert.equal(MG.FAMILY.sink, 'out');
  assert.equal(MG.FAMILY.rackW, 1024); assert.equal(MG.FAMILY.PRESETS, MG.PRESETS);
  assert.deepEqual(Object.keys(MG.FAMILY.plugs).sort(), ['s', 'v']);
  assert.ok(T.ctl.jacks.some(j => j.id === MG.FAMILY.sink && j.dir === 'in'));
  assert.deepEqual(MG.PRESETS.map(p => p.name), ['Classic bass', 'Filter sweep', 'Drone', 'Sync lead', 'Wind', 'Bells']);
  const m15n = t => M15.filter(x => x === t).length;
  for (const p of MG.PRESETS) {
    assert.ok(typeof p.about === 'string' && p.about.length > 10 && p.name.length <= 40, p.name);
    const roles = p.mods.map(([r]) => r), typeOf = Object.fromEntries(p.mods);
    assert.equal(new Set(roles).size, roles.length, p.name + ' roles unique');
    for (const [r, t] of p.mods) { assert.match(r, /^[a-z][a-z0-9]{0,3}$/); assert.notEqual(r, 'c'); assert.ok(MG.ORDER.includes(t), p.name + ' ' + t); }
    for (const t of new Set(Object.values(typeOf))) assert.ok(p.mods.filter(([, x]) => x === t).length <= m15n(t), p.name + ': within the Model 15 set');
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
});

// The three tables of one module type agree (§2.6, §7.4): moog-core's, PatchMoog's (moog-dsp.js, lane V9b) and panels/m900.js's
// ports (lane P9). Each check runs once its file is on the branch; until then it is skipped and says so (IMPL-9 §12, lane K9).
const DSP = new URL('../moog-dsp.js', import.meta.url), PANEL = new URL('../panels/m900.js', import.meta.url);
test('moog-core = PatchMoog (T, JACKS, SECS, PARAMS)', t => {
  if (!existsSync(DSP)) { t.skip('moog-dsp.js not on this branch yet (V9b)'); return; }
  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(DSP, 'utf8'), ctx, { filename: 'moog-dsp.js' });
  const G = ctx.PatchMoog;
  assert.ok(G && typeof G === 'object', 'PatchMoog published');
  const PM = JSON.parse(JSON.stringify({ JACKS: G.JACKS, SECS: G.SECS, PARAMS: G.PARAMS, T: Object.keys(G.T || {}) }));
  assert.deepEqual([...PM.T].sort(), [...MG.ORDER_ALL].sort(), 'PatchMoog.T registers every type');
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
  }
});
test('moog-core = panels/m900.js (every face\'s live jacks are its type\'s jacks)', async t => {
  if (!existsSync(PANEL)) { t.skip('panels/m900.js not on this branch yet (P9)'); return; }
  const mod = await import('../panels/m900.js?v=9');
  const ports = L => (L && Array.isArray(L.controls) ? L.controls.filter(c => c && typeof c.port === 'string').map(c => c.port).sort() : null);
  const found = {};
  if (ports(mod.default)) found.ctl = ports(mod.default);
  for (const v of Object.values(mod)) if (v && typeof v === 'object' && !Array.isArray(v)) for (const id of MG.ORDER) if (ports(v[id])) found[id] = ports(v[id]);
  if (!Object.keys(found).length) { t.skip('panels/m900.js: no layout with live `port` jacks found (expected: the console as its default export, the modules as a { <type>: layout } export)'); return; }
  for (const id of Object.keys(found)) assert.deepEqual(found[id], T[id].jacks.map(j => j.id).sort(), id + ' ports');
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
  const LINE = { 'Classic bass': 'bass', 'Filter sweep': 'lead', Drone: 'none', 'Sync lead': 'lead', Wind: 'none', Bells: 'lead' };
  const H = 95, c = 20000 / (base * os), h = new Float64Array(H);
  let hs = 0;
  for (let k = 0; k < H; k++) { const x = k - (H - 1) / 2; h[k] = (x === 0 ? 2 * c : Math.sin(2 * Math.PI * c * x) / (Math.PI * x)) * (0.42 - 0.5 * Math.cos(2 * Math.PI * k / (H - 1)) + 0.08 * Math.cos(4 * Math.PI * k / (H - 1))); hs += h[k]; }
  const bad = [], rep = [];
  for (const P of MG.PRESETS) {
    const r = PT.loadPreset(PT.fresh('moog'), {}, P.name), { pg } = PT.payload(r.rec), errs = [];
    const inst = { OS: os, fs: base * os, salt: 0, bend: 0, wheel: 0, at: 0, sustain: false, ptFail(w) { errs.push(String(w)); } };
    const mc = PD.create(inst, 'moog');
    mc.set(MG.pvOf(r.vals)); mc.graph(pg);
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
  assert.deepEqual(bad, []);
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
