import './v8-guard.mjs';
// Stage WC phase 0, the model commit (docs/canvas/IMPL-WC.md §2, §3.1, §3.3, §3.5, §5.1, §11.0): rig-core's data — RIG (the display
// name and every flippable constant), GATE / isGate (the key gate as a state), the three named states rigBlank / rigStarter / rigInit,
// adopt, MODULES, AUTOPLUG, SKINS, normRig / pruneRig —, models.js's `rig` entry and the three model predicates, W2 at the patchFor
// level (G2's node part: a rig holding S compiles exactly as a Serum holding S), cv-model PARTS with env1, cv-cost's and cv-art's
// entries, the Serum tray section without the rig, and G4's name rule (the literal appears nowhere in the site's code but rig-core.js).
// Lane K's tests/rig-core.test.mjs covers edges / can / plug / the slot moves; tests/cv-migrate.test.mjs the schema-16 block.
// Run alone: node --max-old-space-size=2048 --test tests/rig-model.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { readFileSync, readdirSync } from 'node:fs';
import * as R from '../rig-core.js?v=9';
import { MODELS, classicOf, isSxModel, isSxId, isRigModel, isSerumModel, patchFor } from '../models.js?v=9';
import * as C from '../serum-core.js?v=9';
import * as CMOD from '../cv-model.js?v=9';
import * as S from '../song.js?v=9';
import { COST, estimate } from '../cv-cost.js?v=9';
import * as A from '../cv-art.js?v=9';
import { SRC_VIEWS } from '../cv-tray.js?v=9';
import { POWER, PARTS as SX_PARTS } from '../sx-edges.js?v=9';

const ROOT = new URL('../', import.meta.url);
const J = x => JSON.stringify(x);
const clone = x => JSON.parse(J(x));
const serum = MODELS.find(m => m.id === 'serum'), rig = MODELS.find(m => m.id === 'rig');
const N3 = Math.pow(0.003 / 32, 0.2);

test('RIG: the display name and the flippable constants (the header of IMPL-WC), frozen; the id, the family and the view say `rig`', () => {
  assert.deepEqual([R.RIG.NAME, R.RIG.ID, R.RIG.VIEW, R.RIG.WIRES, R.RIG.GATE_MS, R.RIG.HUB_OPEN], ['Wavecraft', 'rig', 'rig', 'cords', 3, true]);
  assert.deepEqual(R.RIG.STARTER, { on: ['oscA', 'filter'], cords: [['oscA.out', 'filter.in'], ['filter.out', 'voice.main'], ['env1.out', 'voice.level']] }, 'Q7 (a): Oscillator → Filter → Amplifier, an Envelope on LEVEL, no LFO');
  assert.ok(Object.isFrozen(R.RIG) && Object.isFrozen(R.RIG.STARTER) && Object.isFrozen(R.GATE) && Object.isFrozen(R.GATE.p) && Object.isFrozen(R.MODULES) && Object.isFrozen(R.AUTOPLUG) && Object.isFrozen(R.SKINS));
  assert.deepEqual([R.SKINS, R.SKIN_DEFAULT], [[{ id: 'charcoal', label: 'Charcoal', font: 'narrow' }], 'charcoal'], 'WC-1 ships one skin (ivory is WC-2)');
});

test('G4 the name rule: the literal RIG.NAME appears nowhere in the site\'s code (root *.js, panels/*.js, style.css, index.html, sw.js) but rig-core.js — every label, notice and tile reads the constant, so a rename is one line', () => {
  const files = readdirSync(ROOT).filter(f => /\.(js|css|html|webmanifest)$/.test(f)).concat(readdirSync(new URL('panels/', ROOT)).filter(f => f.endsWith('.js')).map(f => 'panels/' + f));
  const hits = files.filter(f => f !== 'rig-core.js' && readFileSync(new URL(f, ROOT), 'utf8').includes(R.RIG.NAME));
  assert.deepEqual(hits, []);
  assert.ok(readFileSync(new URL('rig-core.js', ROOT), 'utf8').includes(`NAME: '${R.RIG.NAME}'`), 'the one definition');
});

test('GATE (§3.3): ENV 1 at 3.00 ms linear attack / release by laws.js pow5 (t = 32·n⁵), sustain 1, hold 0, Serum\'s decay, linear curves, the three flags off; isGate reads s.p within 1e-9 AND s.env[0]\'s flags', () => {
  assert.deepEqual(Object.keys(R.GATE.p), ['e1.att', 'e1.hold', 'e1.dec', 'e1.sus', 'e1.rel', 'e1.ca', 'e1.cd', 'e1.cr'], 'serum-core MODULE_FIELDS.env1.p');
  assert.deepEqual(Object.keys(R.GATE.p).sort(), C.MODULE_FIELDS.env1.p.slice().sort());
  assert.deepEqual([R.GATE.p['e1.att'], R.GATE.p['e1.rel']], [N3, N3]);
  for (const id of ['e1.att', 'e1.rel']) assert.ok(Math.abs(C.lawValue(id, R.GATE.p[id]) - R.RIG.GATE_MS / 1000) < 1e-15, id + ' = 3.00 ms by the law');
  assert.deepEqual([R.GATE.p['e1.hold'], R.GATE.p['e1.sus'], R.GATE.p['e1.dec'], R.GATE.p['e1.ca'], R.GATE.p['e1.cd'], R.GATE.p['e1.cr']], [0, 1, 0.5, 0.5, 0.666, 0.5]);
  assert.deepEqual(R.GATE.env, { bpm: 0, legInv: 0, stealRe: 0 });
  const s = R.rigBlank();
  assert.equal(R.isGate(s), true);
  const t = clone(s); t.p['e1.att'] += 1e-12; assert.equal(R.isGate(t), true, 'within 1e-9');
  t.p['e1.att'] = N3 + 1e-6; assert.equal(R.isGate(t), false, 'a knob moved');
  const f = clone(s); f.env[0].bpm = 1; assert.equal(R.isGate(f), false, 'BPM on: the times would come from the beat ladder (skeptic P2-3)');
  const g = clone(s); g.env[0].stealRe = 1; assert.equal(R.isGate(g), false, 'Voice Steal Retrigger on: a 1 → 0 step at a re-press');
  assert.deepEqual([R.isGate(C.normalizeSerum(C.defaultSerum())), R.isGate(null), R.isGate({}), R.isGate({ p: {} })], [false, false, false, false], 'Serum\'s default ENV 1 (0.5 ms / 14.7 ms) is an envelope, not the gate');
  for (const p of C.FACTORY_PRESETS) assert.equal(R.isGate(C.normalizeSerum(clone(p.v.s))), false, p.name + ': a preset\'s ENV 1 is a real envelope');
  assert.deepEqual(C.normalizeSerum(s), s, 'GATE round-trips through normalizeSerum unchanged');
});

test('rigBlank (§2.2): a default Serum with every source AND filter off (the first Oscillator dropped becomes OSC A), every AMP ENV switch on, ENV 1 the gate; fresh objects each call; normalised already', () => {
  const a = R.rigBlank(), b = R.rigBlank(), d = C.normalizeSerum(C.defaultSerum());
  assert.deepEqual(['a.on', 'b.on', 'c.on', 's.on', 'n.on', 'f.on', 'f2.on'].map(k => a.p[k]), [0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([a.osc[0].env, a.osc[1].env, a.osc[2].env, a.sub.env, a.noise.env, a.filter[0].env, a.filter[1].env], [1, 1, 1, 1, 1, 1, 1]);
  assert.equal(R.isGate(a), true);
  assert.deepEqual(a, b); assert.notEqual(a, b); assert.notEqual(a.p, b.p); assert.notEqual(a.env[0], b.env[0]);
  // everything else Serum's default: the routes (A → Filter, the rest Main), the matrix empty, the voicing, the filters' switches
  const strip = s => { const x = clone(s); for (const k of ['a.on', ...Object.keys(R.GATE.p)]) delete x.p[k]; return x; };
  assert.deepEqual(strip(a), strip(d), 'only a.on and ENV 1 differ from the default Serum');
  assert.deepEqual(C.normalizeSerum(a), a);
});

test('rigInit (§2.2, §3.7 ⋯ → Init): the blank + Oscillator 1 into the Amplifier (route 1, Main — no "→ Filter (off)" stub), the gate kept; rigStarter: RIG.STARTER on the blank, { s } as defaults() — Oscillator 1 → Filter 1 (route 0, the balance all to F1, its A switch on) → Main, ENV 1 at Serum\'s envelope defaults (an Envelope on LEVEL: not the gate), the GLOBAL preferences applied as serum.defaults applies them', () => {
  const i = R.rigInit(), b = R.rigBlank();
  assert.deepEqual([i.p['a.on'], i.osc[0].route, R.isGate(i)], [1, 1, true]);
  const bi = clone(b); bi.p['a.on'] = 1; bi.osc[0].route = 1;
  assert.deepEqual(i, bi, 'nothing else');
  assert.deepEqual(C.normalizeSerum(i), i);
  const st = R.rigStarter();
  assert.deepEqual(Object.keys(st), ['s']);
  const s = st.s;
  assert.deepEqual([s.p['a.on'], s.p['f.on'], s.p['b.on'], s.p['f2.on'], s.osc[0].route, s.p['a.fbal'], s.p['f.routeA'], s.filter[0].route], [1, 1, 0, 0, 0, 0, 1, 1]);
  assert.equal(C.filterFeeds(s, 0, 'A'), true, 'Filter 1 takes OSC A');
  assert.equal(R.isGate(s), false, 'Envelope 1 is plugged into LEVEL at Serum\'s defaults');
  for (const id of Object.keys(R.GATE.p)) assert.equal(s.p[id], C.DESTS[C.DEST_INDEX[id]].def, id + ' at Serum\'s default');
  assert.deepEqual(s.env[0], { bpm: 0, legInv: 0, stealRe: 0 });
  assert.deepEqual(C.normalizeSerum(s), s);
  assert.deepEqual(rig.defaults(), st, 'the model\'s defaults() is the starter');
  // the preferences, as serum.defaults applies them (rig-core applyPrefs: one function for both) — but "MPE on by default": a Serum's only
  // (review 1 P2-3, the lead: midi.js stays byte-identical in WC-1, so a rig is no MPE zone — §13; pin moved)
  const prefs = { defOs: 4, author: 'x'.repeat(80), view3d: 1, mpeDefault: 1 }, sx = serum.defaults(prefs).s, rs = R.rigStarter(prefs).s;
  assert.deepEqual([rs.global.os, rs.author, rs.ui.view3d], [sx.global.os, sx.author, sx.ui.view3d]);
  assert.deepEqual([rs.global.os, rs.author.length, rs.ui.view3d, rs.global.mpe.on, sx.global.mpe.on], [4, 64, [1, 1, 1], 0, 1]);
  assert.deepEqual(serum.defaults({ defOs: 3 }).s.global.os, C.defaultSerum().global.os, 'an invalid OS preference is ignored, as before');
  assert.deepEqual(serum.defaults(), { s: C.defaultSerum() }, 'the Serum\'s defaults are what they were');
});

test('W2 / G2 (node): patchFor(\'rig\', { s }, fx) deep-equals patchFor(\'serum\', { s }, fx) — the blank, the starter, Init, 20 factory presets, random states; the same engine kind; the MODELS loop wrapped both maps', () => {
  const states = [R.rigBlank(), R.rigStarter().s, R.rigInit(), ...C.FACTORY_PRESETS.slice(0, 20).map(p => C.normalizeSerum(clone(p.v.s)))];
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let k = 0; k < 8; k++) { const s = C.normalizeSerum(C.defaultSerum()); for (const id of Object.keys(s.p)) if (rnd() < 0.3) s.p[id] = rnd(); s.osc[1].route = k % 4; s.p['b.on'] = k & 1; states.push(C.normalizeSerum(s)); }
  const fx = C.defaultFx2(); C.newInstance(fx, 'rev', { rack: 0 });
  for (const [i, s] of states.entries()) {
    const a = patchFor('rig', { s }, fx, { sr: 48000, bpm: 120 }), b = patchFor('serum', { s }, fx, { sr: 48000, bpm: 120 });
    assert.ok(isDeepStrictEqual(a, b), 'state ' + i);
    assert.equal(a.engine, 'serum');
  }
  assert.equal(rig.controls.length, 0);
});

test('adopt (§2.5): ONLY the AMP ENV switches change — every osc / sub / noise / filter `env` := 1 with a note per switch that was off (the module\'s name); routes, forks, the filters\' switches and power, the matrix, ENV 1 untouched; a copy; idempotent; 0 of the 86 factory presets have one (the skeptic\'s count)', () => {
  const s = C.normalizeSerum(clone(C.FACTORY_PRESETS[3].v.s));
  s.osc[1].env = 0; s.filter[0].env = 0; s.noise.env = 0;
  const frozen = JSON.parse(J(s)), r = R.adopt(s);
  assert.deepEqual(r.notes, ['Oscillator 2’s AMP ENV switch was off — it is on', 'Noise’s AMP ENV switch was off — it is on', 'Filter 1’s AMP ENV switch was off — it is on']);
  assert.deepEqual(s, frozen, 'the input untouched');
  assert.notEqual(r.s, s);
  const back = clone(r.s); back.osc[1].env = 0; back.filter[0].env = 0; back.noise.env = 0;
  assert.deepEqual(back, s, 'nothing but the three switches');
  assert.deepEqual([r.s.osc[1].env, r.s.filter[0].env, r.s.noise.env], [1, 1, 1]);
  assert.deepEqual(R.adopt(r.s), { s: r.s, notes: [] }, 'idempotent');
  for (const p of C.FACTORY_PRESETS) { const x = C.normalizeSerum(clone(p.v.s)), a = R.adopt(x); assert.deepEqual(a.notes, [], p.name); assert.deepEqual(a.s, x, p.name); }
  assert.deepEqual(R.adopt(null), { s: C.normalizeSerum(null), notes: [] }, 'not a state: a default');
});

test('MODULES (§3.1): the eight WC-1 kinds + the two WC-2 ones, generic names, numbered labels, grid columns 3 / 4 / 5 / 8, max = the engine slots, every slot a cv-model PART (the Amplifier the device itself), the jack rows (the Amplifier\'s IN Σ · DIRECT Σ · LEVEL (normal KEYS) · NOTE Σ ‖ OUT; env / lfo OUT mod; macros eight inline; the Oscillator\'s WARP read-only); AUTOPLUG (§3.5) one rule per kind, data', () => {
  const M = R.MODULES;
  assert.deepEqual(Object.keys(M), ['amp', 'osc', 'sub', 'noise', 'filter', 'env', 'lfo', 'macros', 'arp', 'clip']);
  assert.deepEqual(Object.values(M).map(m => m.label), ['Amplifier', 'Oscillator', 'Sub oscillator', 'Noise', 'Filter', 'Envelope', 'LFO', 'Macros', 'Arpeggiator', 'Clip sequencer']);
  assert.deepEqual([M.osc.labelN(2), M.filter.labelN(1), M.env.labelN(4), M.lfo.labelN(10)], ['Oscillator 2', 'Filter 1', 'Envelope 4', 'LFO 10']);
  assert.deepEqual(Object.values(M).map(m => m.cols), [4, 5, 3, 3, 5, 5, 5, 4, 8, 8]);
  assert.deepEqual(Object.values(M).map(m => m.cut), [1, 1, 1, 1, 1, 1, 1, 1, 2, 2]);
  for (const [k, m] of Object.entries(M)) {
    assert.equal(m.max, m.slots.length, k + ': max = its slots');
    for (const sl of m.slots) assert.ok(sl === 'voice' || CMOD.PARTS.includes(sl), k + ': ' + sl + ' is a module key');
    assert.equal(m.power, m.slots.every(sl => sl === 'voice' ? false : !!POWER[sl]), k + ': a ⏻ iff sx-edges has its power field');
    assert.ok(m.rows[0] === 'head', k + ': a head first');
    assert.ok(k === 'macros' ? !m.rows.includes('jacks') : m.rows[m.rows.length - 1] === 'jacks', k + ': the jack row last (the Macros\' tiles are its jacks)');
  }
  assert.deepEqual(M.amp.jacks.in.map(j => [j.id, j.label, !!j.sum, j.kind, j.normal || null]), [['main', 'IN', true, 'audio', null], ['direct', 'DIRECT', true, 'audio', null], ['level', 'LEVEL', false, 'mod', 'KEYS'], ['note', 'NOTE', true, 'note', null]]);
  assert.deepEqual(M.amp.jacks.out.map(j => [j.id, j.label, !!j.ro]), [['out', 'OUT', true]]);
  assert.deepEqual(M.osc.jacks.in.map(j => [j.id, j.kind, !!j.ro]), [['warp', 'warp', true]]);
  assert.deepEqual([M.env.jacks.out[0].kind, M.lfo.jacks.out[0].kind, M.arp.jacks.out[0].kind, M.filter.jacks.in[0].sum], ['mod', 'mod', 'note', true]);
  assert.deepEqual(M.macros.jacks.out.map(j => j.id), ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8']);
  assert.ok(M.macros.jacks.out.every(j => j.inline && j.kind === 'mod'));
  assert.deepEqual(Object.keys(R.AUTOPLUG), Object.keys(M).filter(k => k !== 'amp'));
  assert.deepEqual(R.AUTOPLUG, { osc: ['filter.in', 'voice.main'], sub: ['filter.in', 'voice.main'], noise: ['filter.in', 'voice.main'], filter: ['voice.main'], env: ['voice.level'], lfo: [], macros: [], arp: ['voice.note'], clip: ['voice.note'] });
  assert.deepEqual(SX_PARTS.filter(p => !CMOD.PARTS.includes(p)), [], 'cv-model knows every sx-edges part');
});

test('normRig (§2.1): { v: 1, cc, n } — cc ≤ 512 entries keyed /^[a-z][a-zA-Z0-9.#]{1,40}$/ → 0…7, n ≤ 64 entries keyed by a part name → 1…99, integers only, anything else dropped; never throws; idempotent; pruneRig is the identity for a non-state (lane K\'s GC needs a state)', () => {
  const r = R.normRig({ v: 9, cc: { 'oscA.out': 3, 'lfo3.out#2': 7, 'filter.out': 0, bad: 9, X: 1, 'oscB.out': 2.5, 'oscC.out': '1', __proto__: { 'z.out': 1 } }, n: { env2: 2, env3: 100, 'i1/env2': 1, env4: 0, lfo1: 99, lfo2: 1.5 }, junk: 1 });
  assert.deepEqual(r, { v: 1, cc: { 'oscA.out': 3, 'lfo3.out#2': 7, 'filter.out': 0 }, n: { env2: 2, lfo1: 99 } });
  assert.deepEqual(R.normRig(r), r, 'idempotent');
  for (const x of [null, 1, 'x', [], { cc: 5, n: 'a' }, { cc: [1, 2] }, { cc: { a: {} } }, Object.create(null)]) assert.deepEqual(R.normRig(x), { v: 1, cc: {}, n: {} }, J(x));
  const big = { cc: {}, n: {} };
  for (let i = 0; i < 600; i++) big.cc['e' + i + '.out'] = i % 8;
  for (let i = 0; i < 80; i++) big.n['p' + i] = 1 + (i % 99);
  const b = R.normRig(big);
  assert.deepEqual([Object.keys(b.cc).length, Object.keys(b.n).length], [512, 64], 'the bounds');
  assert.equal(R.pruneRig(r, {}, {}, 'i1'), r);
});

test('models.js: `rig` appended last (every earlier index unchanged), custom AND family rig, named RIG.NAME, no maker, Serum\'s presets, no sections; isSxModel / isSerumModel / isRigModel over every model; classicOf false; the tray\'s Serum section lists the Serum alone', () => {
  assert.equal(MODELS.length, 19);
  assert.deepEqual(MODELS.slice(0, 18).map(m => m.id), ['modular', 'minimoog', 'arp2600', 'solina', 'cs80', 'prophet5', 'ms20', 'tb303', 'obxa', 'jupiter8', 'juno60', 'dx7', 'serum', 'tr808', 'tr606', 'tr909', 'sdsv', 'm900']);
  assert.equal(MODELS[18], rig);
  assert.deepEqual([rig.id, rig.name, rig.custom, rig.family, 'maker' in rig, rig.year, rig.sections, rig.presets === C.FACTORY_PRESETS, typeof rig.about, typeof rig.tag], ['rig', R.RIG.NAME, true, 'rig', false, 2026, [], true, 'string', 'string']);
  assert.ok(rig.about.includes(R.RIG.NAME) && !/serum/i.test(rig.name) && !/xfer/i.test(rig.about + rig.tag), 'our own words; the engine named plainly');
  assert.deepEqual(MODELS.filter(isSxModel).map(m => m.id), ['serum', 'rig']);
  assert.deepEqual(MODELS.filter(isSerumModel).map(m => m.id), ['serum']);
  assert.deepEqual(MODELS.filter(isRigModel).map(m => m.id), ['rig']);
  assert.deepEqual(MODELS.filter(classicOf).length, 12);
  assert.deepEqual([isSxModel(null), isRigModel(undefined), isSerumModel({}), isRigModel({ family: 'rig' })], [false, false, false, true]);
  // (lane S) isSxId: isSxModel for a model id — what a device record holds (the cv-* modules and main.js's isSxRec read it)
  assert.deepEqual(MODELS.filter(m => isSxId(m.id) !== isSxModel(m)).map(m => m.id), []);
  assert.deepEqual([isSxId('serum'), isSxId('rig'), isSxId('minimoog'), isSxId('m900'), isSxId(undefined), isSxId('')], [true, true, false, false, false, false]);
  const sx = SRC_VIEWS.find(v => v.id === 'serum').sections[0].models;
  assert.deepEqual([sx(serum), sx(rig)], [true, false], 'the Serum view: the Serum tile; the rig\'s view is lane U\'s');
});

test('cv-model PARTS gains env1 (after filter2); song.normDev keeps `rig` on a rig device through normRig and drops it elsewhere; cv-cost COST.synth.rig is the Serum\'s row; cv-art SIL.rig + a drawing of its own, tileMeta from RIG.NAME', () => {
  assert.deepEqual(CMOD.PARTS.slice(5, 11), ['filter', 'filter2', 'env1', 'env2', 'env3', 'env4']);
  assert.equal(CMOD.PARTS.length, 24);
  assert.deepEqual(CMOD.partOf('i3/env1'), { dev: 'i3', part: 'env1' });
  const s = R.rigInit(), rec = { v: 1, cc: { 'oscA.out': 2, bad: 9 }, n: { env2: 1, oscA: 3 } };
  const d = S.normDev({ dev: { i1: { kind: 'synth', model: 'rig', vals: { s }, preset: null, rig: rec }, i2: { kind: 'synth', model: 'serum', vals: { s }, rig: rec }, i3: { kind: 'synth', model: 'juno60', vals: {}, rig: rec }, i4: { kind: 'synth', model: 'rig', vals: { s } }, out: { kind: 'out' } }, wires: [] }).dev;
  assert.deepEqual(d.i1.rig, { v: 1, cc: { 'oscA.out': 2 }, n: { oscA: 3 } }, 'normRig then lane K\'s pruneRig: the orphan ordinal (Envelope 2 is no module of Init) goes, Oscillator 1\'s stays');
  assert.deepEqual(['rig' in d.i2, 'rig' in d.i3, 'rig' in d.i4], [false, false, false], 'a Serum\'s and a classic\'s dropped; absent stays absent');
  assert.deepEqual(S.normDev({ dev: d, wires: [] }).dev, d, 'round trips');
  for (const bad of [1, 'x', [], { cc: { __proto__: null } }]) assert.doesNotThrow(() => S.normDev({ dev: { i1: { kind: 'synth', model: 'rig', vals: {}, rig: bad } }, wires: [] }));
  assert.equal(COST.synth.rig, COST.synth.serum);
  assert.ok(estimate('rig') > 0 && estimate({ kind: 'synth', model: 'rig', vals: { s } }) > 0);
  assert.deepEqual([A.SIL.rig.body, Object.isFrozen(A.SIL.rig)], ['cabinet', true]);
  assert.match(A.art('rig'), /data-art="rig"/);
  assert.deepEqual([A.tileMeta('rig').label, A.tileMeta('rig').name, A.tileMeta('rig').maker], [R.RIG.NAME, R.RIG.NAME, undefined]);
});
