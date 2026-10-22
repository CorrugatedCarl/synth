// cv-mods.js tests (SPEC-canvas §7.2, §7.8, §10 stage 1a): the checked-in classic class table equals a fresh sweep over
// the default patch and every factory preset; every patch field the engine knows has a class; descriptors.
// Run: node --max-old-space-size=2048 --test tests/cv-mods.test.mjs
import './v8-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as V from '../cv-mods.js?v=9';
import { MODELS } from '../models.js?v=9';
import * as C from '../serum-core.js?v=9';

// (stage 9, IMPL-9 §8.9) the classic-modulation models: not Serum, not the 900 Series (a patch has no classic modulation, §4.8); the drums stay in
const CLASSIC = MODELS.filter(m => !m.custom && m.family !== 'patch');

test('the checked-in CLASS_TABLE equals a fresh sweep (regenerate: node tools/cv-classes.mjs --write)', () => {
  const fresh = V.classTable(), diff = [];
  for (const [m, c] of Object.entries(fresh)) for (const [k, v] of Object.entries(c)) if (!V.CLASS_TABLE[m] || V.CLASS_TABLE[m][k] !== v) diff.push(`${m}.${k}: ${V.CLASS_TABLE[m] && V.CLASS_TABLE[m][k]} → ${v}`);
  assert.deepEqual(diff, []);
  assert.deepEqual(Object.keys(V.CLASS_TABLE), Object.keys(fresh));
  for (const m of Object.keys(fresh)) assert.deepEqual(Object.keys(V.CLASS_TABLE[m]), Object.keys(fresh[m]), m);
});

test('every classic control is classed; the counts (§7.8)', () => {
  assert.deepEqual(Object.keys(V.CLASS_TABLE), CLASSIC.map(m => m.id));
  for (const m of CLASSIC) assert.deepEqual(Object.keys(V.CLASS_TABLE[m.id]), m.controls.map(c => c.id), m.id);
  const n = V.counts();
  assert.equal(Object.values(n).reduce((a, b) => a + b, 0), 544);
  assert.deepEqual(n, { none: 2, sm: 129, apply: 70, proc: 146, chunk: 180, struct: 17 });
  const of = cls => Object.entries(V.CLASS_TABLE).flatMap(([m, t]) => Object.keys(t).filter(k => t[k] === cls).map(k => m + '.' + k));
  // voice structure / filter path: P-5 and OB-Xa Unison, JP-8 Assign, OB-Xa filter slope, DX7 algorithm, the two HPF
  // cutoffs that switch the HP type; the TR-808's five sound switches (a circuit's components, IMPL-7a §2.3); the SDS-V's five
  // memory keys (which six a card plays, IMPL-8 §11.5)
  assert.deepEqual(of('struct').sort(), ['dx7.alg', 'jupiter8.as', 'jupiter8.hp', 'modular.hp', 'obxa.pl', 'obxa.un', 'prophet5.un',
    'sdsv.x1p', 'sdsv.x2p', 'sdsv.x3p', 'sdsv.xbp', 'sdsv.xsp', 'tr808.cps', 'tr808.hts', 'tr808.lts', 'tr808.mts', 'tr808.rss']);
  // the 808's 23 knobs are proc: one-level drum.<id> fields (IMPL-7a §2.3, §9)
  const k808 = MODELS.find(m => m.id === 'tr808').controls.filter(c => c.t === 'k');
  assert.equal(k808.length, 23);
  for (const c of k808) { assert.equal(V.classOf('tr808', c.id), 'proc', c.id); assert.deepEqual(V.sweepControl('tr808', c).fields, ['drum.' + c.id], c.id); }
  // the TR-606's 18 knobs, no switches (IMPL-7b §1.1, §9): proc, each its one-level drum.<id> field; the ids the 808 also
  // has are one FIELD_CLASS entry each, the ten new ones proc; the patch's machine a kind boundary (struct, review #19)
  const m606 = MODELS.find(m => m.id === 'tr606');
  assert.deepEqual([m606.controls.length, m606.controls.every(c => c.t === 'k')], [18, true]);
  for (const c of m606.controls) { assert.equal(V.classOf('tr606', c.id), 'proc', c.id); assert.deepEqual(V.sweepControl('tr606', c).fields, ['drum.' + c.id], c.id); }
  assert.deepEqual(m606.controls.map(c => c.id).filter(id => !k808.some(c => c.id === id)), ['tml', 'hhl', 'bdu', 'sdu', 'sdd', 'ltu', 'ltd', 'htu', 'htd', 'chd']);
  assert.deepEqual([V.FIELD_CLASS.machine, V.fieldClass('machine', 'drums'), V.patchOf('tr606', {}).machine, 'machine' in V.patchOf('tr808', {})], ['struct', 'struct', 'tr606', false]);
  // the TR-909's 28 knobs, no switches (IMPL-7c §1.1, §9): proc, each its one-level drum.<id> field; the ids the 808 / 606
  // also have are their entries, the seven new ones proc; its patch names its machine
  const m909 = MODELS.find(m => m.id === 'tr909');
  assert.deepEqual([m909.controls.length, m909.controls.every(c => c.t === 'k')], [28, true]);
  for (const c of m909.controls) { assert.equal(V.classOf('tr909', c.id), 'proc', c.id); assert.deepEqual(V.sweepControl('tr909', c).fields, ['drum.' + c.id], c.id); }
  assert.deepEqual(m909.controls.map(c => c.id).filter(id => !k808.some(c => c.id === id) && !m606.controls.some(c => c.id === id)), ['bda', 'mtu', 'mtd', 'crl', 'rdl', 'cru', 'rdu']);
  assert.deepEqual([V.patchOf('tr909', {}).machine, V.fieldClass('drum.cru', 'drums')], ['tr909', 'proc']);
  // the SDS-V's 40 knobs + 5 memory switches (IMPL-8 §11.2, §13.4): 'x' + channel b s 1 2 3 + field, five sections (one per
  // channel: the card's six, SENSITIVITY, LEVEL, the memory key); every knob proc, its one-level drum.<id> field; the switches
  // struct (a memory index 0…3 — nothing else moves); no id shared with the other machines; its patch names its machine
  const mV = MODELS.find(m => m.id === 'sdsv'), kV = mV.controls.filter(c => c.t === 'k'), sV = mV.controls.filter(c => c.t === 's');
  assert.deepEqual([mV.controls.length, kV.length, sV.length, mV.sections.map(s => s.title)], [45, 40, 5, ['Bass Drum', 'Snare Drum', 'Tom 1', 'Tom 2', 'Tom 3']]);
  assert.deepEqual(mV.controls.map(c => c.id), ['b', 's', '1', '2', '3'].flatMap(ch => [...'ntbdmcslp'].map(f => 'x' + ch + f)));
  for (const c of kV) { assert.equal(V.classOf('sdsv', c.id), 'proc', c.id); assert.deepEqual(V.sweepControl('sdsv', c).fields, ['drum.' + c.id], c.id); }
  for (const c of sV) {
    assert.deepEqual([V.classOf('sdsv', c.id), c.opts, c.def], ['struct', ['1', '2', '3', '4'], 1], c.id);
    assert.deepEqual(V.sweepControl('sdsv', c).fields, ['drum.' + c.id], c.id);
    assert.deepEqual([0, 1, 2, 3].map(i => V.patchOf('sdsv', { [c.id]: i }).drum[c.id]), [0, 1, 2, 3], c.id + ': the memory\'s index');
  }
  assert.deepEqual(mV.controls.filter(c => CLASSIC.some(m => m.family === 'drums' && m.id !== 'sdsv' && m.controls.some(x => x.id === c.id))), []);
  assert.deepEqual([V.patchOf('sdsv', {}).machine, V.patchOf('sdsv', {}).engine, V.fieldClass('drum.x1t', 'drums'), V.fieldClass('drum.x1p', 'drums')], ['sdsv', 'drums', 'proc', 'struct']);
  assert.deepEqual(of('none').sort(), ['jupiter8.pws', 'minimoog.mm']);
  const spot = { 'minimoog.fc': 'sm', 'minimoog.em': 'sm', 'minimoog.fa': 'apply', 'minimoog.gl': 'proc', 'minimoog.w1': 'chunk', 'minimoog.m1': 'sm',
    'tb303.dc': 'apply', 'tb303.ac': 'apply', 'dx7.vol': 'sm', 'dx7.dac': 'proc', 'dx7.R1_1': 'chunk', 'solina.cb': 'proc', 'solina.vol': 'sm',
    'jupiter8.sl': 'apply', 'cs80.rms': 'chunk', 'juno60.ch': 'proc' };
  for (const [k, c] of Object.entries(spot)) { const [m, id] = k.split('.'); assert.equal(V.classOf(m, id), c, k); }
  assert.equal(V.classOf('serum', 'f.cutoff'), null);
  assert.equal(V.classOf('minimoog', 'nope'), null);
});

test('stage 9: the 900 Series (family \'patch\') has no classic modulation — no class table row, no targets, deps, transfer, descriptors or target; the drums stay in (IMPL-9 §4.8, §8.9)', () => {
  const m = MODELS.find(x => x.id === 'm900');
  assert.equal(m.family, 'patch');
  assert.ok(m.controls.length > 0, 'it has controls (the controller\'s): they are not classic knobs');
  assert.equal(V.CLASS_TABLE.m900, undefined);
  assert.equal(V.classTable().m900, undefined);
  for (const c of m.controls) {
    assert.equal(V.classOf('m900', c.id), null, c.id);
    assert.deepEqual(V.targetsOf('m900', c.id), [], c.id);
    assert.deepEqual(V.targetsOf(m, c.id), [], c.id + ' (by model object)');
    assert.deepEqual(V.depsOf('m900', c.id), [], c.id);
    assert.equal(V.xferOf('m900', {}, c.id), null, c.id);
    assert.equal(V.classicTarget('m900', {}, c.id), null, c.id);
    assert.equal(V.slotOf('m900', c.id), null, c.id);
  }
  assert.deepEqual(V.classicDescs('m900'), []);
  assert.deepEqual(V.descs({ kind: 'synth', model: 'm900', vals: {} }), []);
  for (const c of m.controls) assert.equal(V.destOk({ kind: 'synth', model: 'm900', vals: {} }, c.id).ok, false, c.id + ': never a cable\'s end');
  // the drums are classic here (their knobs are proc fields): still classed and described
  assert.equal(V.classOf('tr808', 'bdl'), 'proc');
  assert.ok(V.classicDescs('tr808').length > 0 && V.classicDescs('sdsv').length === 45);
  assert.equal(V.classicTarget('tr808', {}, 'bdl').cls, 'proc');
});

test('FIELD_CLASS knows every patch field of the engine (engine.js patch tables)', () => {
  const src = readFileSync(new URL('../engine.js', import.meta.url), 'utf8');
  const PRE = { OscP: ['osc.'], HpfP: ['hpf.'], VcfP: ['vcf.'], EnvP: ['fenv.', 'aenv.'], LfoP: ['lfo.'], FxP: ['fx.'], DualP: ['dual.'], Mod3P: ['mod3.'],
    TbP: ['tb.'], RmP: ['rm.'], IlP: ['fenvIL.'], RegP: ['reg.'], OpP: ['ops.'], DrumP: ['drum.'], PatchP: [''] };
  // PatchP members that are not classic panel fields: sub-objects (classed through their own tables), the Serum / FX / sequencer passthroughs
  const SKIP = new Set(['osc', 'hpf', 'vcf', 'fenv', 'aenv', 'lfo', 'fx', 'reg', 'dual', 'mod3', 'tb', 'rm', 'fenvIL', 'ops', 'drum', 'serum', 'serumT', 'fxr', 'fxrT', 'seq', 'seqT', 'needs', 'pv']);
  const missing = [];
  let seen = 0;
  for (const [cls, pres] of Object.entries(PRE)) {
    const m = new RegExp('class ' + cls + ' \\{\\n  constructor\\(o\\) \\{([\\s\\S]*?)\\n  \\}\\n\\}').exec(src);
    assert.ok(m, cls);
    const names = new Set([...m[1].matchAll(/this\.(\w+) =/g)].map(x => x[1]));
    for (const n of names) if (!SKIP.has(n)) for (const p of pres) { seen++; if (!(p + n in V.FIELD_CLASS)) missing.push(p + n); }
  }
  assert.ok(seen > 100, 'parsed the tables (' + seen + ' fields)');
  assert.deepEqual(missing, []);
  for (const k of ['dual?', 'mod3?', 'tb?', 'rm?', 'fenvIL?', 'ops?']) assert.ok(k in V.FIELD_CLASS, k);
  for (const c of Object.values(V.FIELD_CLASS)) assert.ok(V.CLASSES.includes(c) && c !== 'none');
});

test('fieldClass on each engine; fieldDiff; sweep points', () => {
  assert.deepEqual(['level', 'vcf.oct', 'osc.lev', 'vcf.kbd', 'fenv.a'].map(f => V.fieldClass(f, 'analog')), ['sm', 'sm', 'sm', 'chunk', 'apply']);
  assert.deepEqual(['level', 'vcf.oct', 'osc.lev', 'ops.R', 'reg.bass'].map(f => V.fieldClass(f, 'fm')), ['sm', 'none', 'none', 'chunk', 'proc'], 'DX7 / Solina: level is their only slot');
  assert.equal(V.fieldClass('nope', 'analog'), undefined);
  const d = V.fieldDiff({ a: 1, o: { x: 0, y: [1, 2] }, osc: [{ lev: 1 }, { lev: 2 }], m: null, s: 'a', b: false },
    { a: 1, o: { y: [1, 3] }, osc: [{ lev: 1 }, { lev: 3 }], m: { mix: 1 }, s: 'b', b: 0, extra: 0 });
  assert.deepEqual([...d].sort(), ['m?', 'o.y', 'osc.lev', 's']);
  assert.deepEqual(V.sweepPoints({ t: 'b' }), [0, 1]);
  assert.deepEqual(V.sweepPoints({ t: 's', opts: ['a', 'b', 'c'] }), [0, 1, 2]);
  const k = V.sweepPoints({ t: 'k', min: -24, max: 24, def: 0, step: 1 });
  assert.equal(k.length, 14);
  assert.ok(k.includes(-24) && k.includes(24) && k.every(Number.isInteger));
});

test('a sweep names the fields a control changes (the evidence for its class)', () => {
  const mm = MODELS.find(m => m.id === 'minimoog');
  assert.deepEqual(V.sweepControl(mm, mm.controls.find(c => c.id === 'mm')), { cls: 'none', fields: [] });
  const fc = V.sweepControl(mm, mm.controls.find(c => c.id === 'fc'));
  assert.deepEqual(fc, { cls: 'sm', fields: ['vcf.oct'] });
  const hp = MODELS.find(m => m.id === 'modular');
  assert.deepEqual(V.sweepControl(hp, hp.controls.find(c => c.id === 'hp')), { cls: 'struct', fields: ['hpf.oct', 'hpf.type'] });
});

test('descriptors: classic, Serum, FX racks, by device', () => {
  for (const m of CLASSIC) {
    const D = V.classicDescs(m.id);
    assert.equal(D.length, m.controls.length, m.id);
    for (const [i, d] of D.entries()) {
      const c = m.controls[i];
      assert.equal(d.id, c.id);
      assert.equal(d.law, { k: 'lin', s: 'enum', b: 'bool' }[c.t]);
      assert.equal(d.cls, V.CLASS_TABLE[m.id][c.id]);
      assert.equal(d.nomod, d.cls === 'struct' || d.cls === 'none');
      if (c.t === 'k') assert.deepEqual([d.lo, d.hi, d.def], [c.min, c.max, c.def]);
      if (c.t === 's') assert.deepEqual([d.lo, d.hi, d.opts.length], [0, c.opts.length - 1, c.opts.length]);
    }
  }
  assert.deepEqual(V.classicDescs('serum'), []);
  const S = V.serumDescs();
  assert.equal(S.length, C.DESTS.length);
  assert.ok(S.length >= 529);
  assert.deepEqual(Object.keys(S[0]), ['id', 'label', 'law', 'lo', 'hi', 'def', 'fmt', 'scope', 'cls', 'nomod', 'ctr']); // (ctr: 2b, the centred flag on every descriptor)
  // a rack: reverb, a 3-band splitter with an EQ in its middle branch, a Convolve (its non-modulatable rows marked)
  const fx = C.defaultFx2(), rev = C.newInstance(fx, 'rev', { rack: 0 }), sp = C.newInstance(fx, 'split3', { rack: 0 });
  const eq = C.newInstance(fx, 'eq', { rack: 0, splitter: sp, branch: 1 }), cv = C.newInstance(fx, 'conv', { rack: 0 });
  const R = V.rackDescs(fx.racks[0]);
  for (const id of [`fx.${rev}.mix`, `fx.${sp}.freq1`, `fx.${eq}.freqL`, `fx.${cv}.mix`]) assert.ok(R.some(d => d.id === id), id);
  assert.ok(R.filter(d => d.id.startsWith(`fx.${cv}.`)).some(d => d.nomod), 'Convolve has rows that cannot be modulated');
  assert.deepEqual(V.rackDescs(fx).map(d => d.id), R.map(d => d.id), 'a whole v2 FX state: its racks');
  assert.equal(V.descs({ kind: 'panel', rack: fx.racks[0] }).length, R.length);
  assert.equal(V.descs({ kind: 'synth', model: 'juno60' }).length, 25);
  assert.deepEqual(V.descs({ kind: 'synth', model: 'tr606' }).map(d => d.cls + (d.nomod ? '!' : '')), Array(18).fill('proc'), 'TR-606: 18 proc destinations');
  assert.deepEqual(V.descs({ kind: 'synth', model: 'tr909' }).map(d => d.cls + (d.nomod ? '!' : '')), Array(28).fill('proc'), 'TR-909: 28 proc destinations');
  assert.deepEqual(V.descs({ kind: 'synth', model: 'sdsv' }).map(d => d.cls + (d.nomod ? '!' : '')),
    Array(5).fill([...Array(8).fill('proc'), 'struct!']).flat(), 'SDS-V: 40 proc destinations, 5 memory keys never modulated');
  assert.equal(V.descs({ kind: 'synth', model: 'serum', fx }).length, S.length + R.length);
  assert.deepEqual([V.descs(null), V.descs({ kind: 'out' })], [[], []]);
});

/* ------------------------------------------------------------------ stage 2a: performance modulators (IMPL-2a §2.2) */
test('2a descs: a 1c panel holds its whole FX state (fx) — every rack read; the single-rack form still', () => {
  const fx = C.defaultFx2(), a = C.newInstance(fx, 'rev', { rack: 0 }), b = C.newInstance(fx, 'dly', { rack: 1 });
  const D = V.descs({ kind: 'panel', fx }).map(d => d.id);
  assert.ok(D.includes(`fx.${a}.mix`) && D.includes(`fx.${b}.mix`), 'the main rack and a bus rack');
  assert.deepEqual(D, V.rackDescs(fx).map(d => d.id));
  assert.deepEqual(V.descs({ kind: 'panel', rack: fx.racks[0] }).map(d => d.id), V.rackDescs(fx.racks[0]).map(d => d.id));
});

test('2a / 2b destOk: Serum DESTS and own-FX ids (not nomod); classic sm / apply / proc and panel knobs open (2b), chunk from stage 5; structural never', () => {
  const fx = C.defaultFx2(), rev = C.newInstance(fx, 'rev', { rack: 0 }), cv = C.newInstance(fx, 'conv', { rack: 0 });
  const sx = { kind: 'synth', model: 'serum', vals: { s: C.defaultSerum() }, fx }, ok = { ok: true, why: '', stage: null }, NO = { ok: false, why: 'This knob can’t be modulated', stage: null };
  for (const id of ['f.cutoff', 'a.level', 'g.master', 'm1', `fx.${rev}.mix`]) assert.deepEqual(V.destOk(sx, id), ok, id);
  const nomodId = V.rackDescs(fx).find(d => d.id.startsWith(`fx.${cv}.`) && d.nomod).id;
  for (const id of ['nope', 'fx.zz.mix', nomodId, '', null]) assert.deepEqual(V.destOk(sx, id), NO, String(id));
  const mm = { kind: 'synth', model: 'minimoog', vals: {} };
  assert.deepEqual(V.destOk(mm, 'fc'), ok, 'sm: the cutoff');
  assert.deepEqual(V.destOk(mm, 'mm').stage, null, 'a knob that changes nothing: never');
  assert.deepEqual(V.destOk({ kind: 'synth', model: 'prophet5', vals: {} }, 'un').ok, false, 'Unison: structural');
  assert.deepEqual(V.destOk({ kind: 'panel', fx }, `fx.${rev}.mix`), ok, 'a panel knob (2b)');
  assert.deepEqual(V.destOk({ kind: 'panel', fx }, nomodId), NO);
  assert.deepEqual(V.destOk({ kind: 'panel', rack: fx.racks[0] }, `fx.${rev}.mix`), ok, 'the single-rack form');
  assert.equal(V.destOk({ kind: 'velo' }, 'x').ok, false);
  assert.equal(V.destOk(null, 'f.cutoff').ok, false);
});

test('(canvas 2b) the Serum filter\'s routing switches S A B C N (f.route<X> / f2.route<X>) are plain input switches, not modulation targets: destOk refuses a NEW cable; a row that exists (keep) still validates; the sources\' filter-balance destinations and the rest stay open', () => {
  const sx = { kind: 'synth', model: 'serum', vals: { s: C.defaultSerum() }, fx: C.defaultFx2() };
  for (const k of ['f', 'f2']) for (const X of 'ABCNS') {
    const id = k + '.route' + X;
    assert.equal(V.destOk(sx, id).ok, false, id);
    assert.deepEqual(V.destOk(sx, id).stage, null, id);
    assert.equal(V.destOk(sx, id, true).ok, true, id + ' (an existing row keeps working)');
    assert.equal(V.plainSwitch(id), true, id);
  }
  for (const id of ['a.fbal', 'b.fbal', 'c.fbal', 's.fbal', 'n.fbal', 'f.cutoff', 'f2.cutoff', 'f.on', 'f2.on', 'f.mix']) { assert.equal(V.destOk(sx, id).ok, true, id); assert.equal(V.plainSwitch(id), false, id); }
});

/* ------------------------------------------------------------------ stage 2b: every class, every source (IMPL-2b §1.1, §1.2, §7.5) */
test('2b destOk per class (the §7.5 matrix): sm / apply / proc ok; chunk → stage 5; struct / none → never; a switched-off oscillator\'s level', () => {
  const ok = { ok: true, why: '', stage: null }, NO = { ok: false, why: 'This knob can’t be modulated', stage: null }, S5 = { ok: false, why: 'This knob takes modulation from stage 5', stage: '5' };
  const by = cls => Object.entries(V.CLASS_TABLE).flatMap(([m, t]) => Object.keys(t).filter(k => t[k] === cls).map(k => [m, k]));
  const dev = m => ({ kind: 'synth', model: m, vals: {} });
  const n = { ok: 0, no: 0 };
  for (const cls of ['sm', 'apply', 'proc']) for (const [m, k] of by(cls)) { const r = V.destOk(dev(m), k); if (r.ok) n.ok++; else { n.no++; assert.equal(r.stage, null, m + '.' + k); } }
  assert.ok(n.ok > 220 && n.no < 12, JSON.stringify(n) + ' (a handful of knobs move nothing at the default panel: a mixer switch off, no pulse wave)');
  for (const [m, k] of by('chunk')) assert.deepEqual(V.destOk(dev(m), k), S5, m + '.' + k);
  for (const [m, k] of [...by('struct'), ...by('none')]) assert.deepEqual(V.destOk(dev(m), k), NO, m + '.' + k);
  // the level of a switched-off oscillator: the Minimoog's mixer switch, the Modular's level at 0
  const OFF = { ok: false, why: 'Switch the oscillator on to modulate its level', stage: null };
  assert.deepEqual([V.destOk({ kind: 'synth', model: 'minimoog', vals: { m1: 0 } }, 'v1'), V.destOk({ kind: 'synth', model: 'minimoog', vals: { m1: 1 } }, 'v1')], [OFF, ok]);
  assert.deepEqual([V.destOk({ kind: 'synth', model: 'modular', vals: { l1: 0 } }, 'l1'), V.destOk({ kind: 'synth', model: 'modular', vals: { l1: 5 } }, 'l1')], [OFF, ok]);
  assert.deepEqual(V.destOk({ kind: 'synth', model: 'juno60', vals: {} }, 'pwm'), S5);
  assert.deepEqual(V.destOk({ kind: 'synth', model: 'juno60', vals: {} }, 'nope'), NO);
});

test('2b classicTarget: the engine-side target of a classic knob — smTargets slots (the oscillator resolved), apply / proc fields; SM_SLOT mirrors engine.js', () => {
  const tg = (m, k, v) => V.classicTarget(m, v || {}, k);
  assert.deepEqual([tg('juno60', 'cf').slot, tg('juno60', 'rs').slot, tg('juno60', 'lv').slot, tg('juno60', 'hp').slot, tg('juno60', 'nz').slot, tg('juno60', 'sb').slot], [0, 3, 11, 5, 22, 21]);
  assert.deepEqual([tg('minimoog', 'v1').slot, tg('minimoog', 'v2').slot, tg('minimoog', 'v3').slot, tg('minimoog', 'tune').slot, tg('minimoog', 'r1').slot], [12, 13, 14, 18, 18]);
  assert.deepEqual([tg('cs80', 'br').slot, tg('cs80', 'pw1').slot, tg('cs80', 'lp2').slot, tg('cs80', 'hp1').slot], [0, 15, 7, 5]);
  assert.deepEqual([tg('juno60', 'lr'), tg('juno60', 'a').field, tg('juno60', 'ch').field, tg('prophet5', 'ud').field], [{ cls: 'proc', slot: -1, field: 'lfo.rate', fields: ['lfo.rate'], on: true }, 'fenv.a', 'fx.chorus', 'unisonDetune']);
  assert.deepEqual(tg('minimoog', 'v1', { m1: 0 }), { cls: 'sm', slot: -1, field: null, fields: ['osc.lev', 'osc.on'], on: false }, 'the switch off: the evidence over the bases, on false');
  assert.deepEqual([tg('juno60', 'nope'), tg('serum', 'f.cutoff'), tg('juno60', 'pwm').cls], [null, null, 'chunk']);
  assert.deepEqual(V.SM_SLOT, { 'vcf.oct': 0, 'vcf.envOff': 1, 'vcf.env': 2, 'vcf.res': 3, 'vcf.drive': 4, 'hpf.oct': 5, 'hpf.res': 6, 'dual.oct': 7, 'dual.res': 8, 'dual.hoct': 9, 'dual.hres': 10, level: 11, 'osc.lev': 12, 'osc.on': 12, 'osc.pw': 15, 'osc.oct': 18, 'osc.fine': 18, sub: 21, noise: 22, ring: 23, ext: 24, 'rm.depth': 25 });
  for (const m of CLASSIC) for (const c of m.controls) { // every sm / apply / proc knob resolves on the default panel, bar the few that move nothing there
    const cls = V.classOf(m.id, c.id);
    if (cls !== 'sm' && cls !== 'apply' && cls !== 'proc') continue;
    const r = tg(m.id, c.id);
    assert.ok(r && (cls === 'sm' ? r.slot >= 0 && r.slot < 26 : typeof r.field === 'string') || !r.fields.some(x => x.includes('.')) || r.on === false || ['minimoog.ext', 'minimoog.me', 'minimoog.nz', 'minimoog.mn', 'arp2600.ara', 'arp2600.arr', 'ms20.pw1'].includes(m.id + '.' + c.id), m.id + '.' + c.id);
  }
});

test('2b descriptors carry the centred flag and the class: classic (law / lo / hi / def / fmt / cls / ctr from models.js), a panel from its fx', () => {
  const J = V.descs({ kind: 'synth', model: 'juno60', vals: {} }), cf = J.find(d => d.id === 'cf'), ch = J.find(d => d.id === 'ch');
  assert.deepEqual([cf.law, cf.lo, cf.hi, cf.def, cf.cls, cf.nomod, cf.ctr, typeof cf.fmt], ['lin', 0, 10, 6, 'sm', false, 0, 'function']);
  assert.deepEqual([ch.law, ch.opts, ch.cls, ch.lo, ch.hi], ['enum', ['Off', 'I', 'II', 'I+II'], 'proc', 0, 3]);
  const M = V.descs({ kind: 'synth', model: 'minimoog', vals: {} });
  assert.deepEqual([M.find(d => d.id === 'tune').ctr, M.find(d => d.id === 'f2').ctr, M.find(d => d.id === 'v1').ctr], [1, 1, 0], 'a −x…x knob is centred');
  const fx = C.defaultFx2(), rev = C.newInstance(fx, 'rev', { rack: 0 }), P = V.descs({ kind: 'panel', fx }), mix = P.find(d => d.id === `fx.${rev}.mix`);
  assert.deepEqual([mix.law, mix.lo, mix.hi, mix.scope, mix.cls, mix.nomod, mix.ctr], ['lin', 0, 1, 'G', null, false, 0]);
  assert.equal(V.descs({ kind: 'synth', model: 'serum', fx }).find(d => d.id === 'a.pan').ctr, 1, 'Serum\'s ctr flag');
});

test('2b modulator ids, labels, sources: kindOfId / modLabelOf / modDevs / srcOf / perNoteOf; sourcesOf over every module (a macro: 8 knobs); linkSources', () => {
  assert.deepEqual(['l1', 'e12', 'm1', 'c3', 'h2', 'nt', 've', 'at', 'bd', 'i1', 'fx1', 'l0', 'x', null].map(V.kindOfId), ['lfo', 'env', 'macro', 'cc', 'chaos', 'note', 'velo', 'at', 'bend', null, null, null, null, null]);
  assert.deepEqual([V.modLabelOf('l3'), V.modLabelOf('m1', { kind: 'macro' }), V.modLabelOf('ve'), V.modLabelOf('h2', { kind: 'chaos' }), V.modLabelOf('i1')], ['LFO 3', 'Macro 1', 'Velocity', 'Chaos 2', 'i1']);
  assert.deepEqual(V.MOD_LABEL, { wheel: 'Mod Wheel', velo: 'Velocity', at: 'Aftertouch', bend: 'Bend', note: 'Note', lfo: 'LFO', env: 'ENV', macro: 'Macro', cc: 'CC', chaos: 'Chaos' });
  assert.deepEqual([V.srcOf('wheel'), V.srcOf('m1.k3'), V.srcOf('i2/lfo10.out'), V.srcOf('i2/env2.out'), V.srcOf('i2/lfo11.out'), V.srcOf('x'), V.srcOf(null)],
    [{ dev: 'wheel', port: '', link: '' }, { dev: 'm1', port: 'k3', link: '' }, { dev: 'i2', port: 'out', link: 'lfo10' }, { dev: 'i2', port: 'out', link: 'env2' }, null, null, null]);
  const s = C.normalizeSerum(C.defaultSerum());
  s.lfo[0].mono = 1; s.matrix[0] = C.normRow({ src: 'lfo1', amt: 0.1, dst: 'a.pan' }); s.matrix[1] = C.normRow({ src: 'env3', amt: 0.1, dst: 'a.pan' });
  const t = { dev: { i1: { kind: 'synth', model: 'serum', name: 'Lead', vals: { s } }, i2: { kind: 'synth', model: 'juno60', vals: {} }, l1: { kind: 'lfo', lfo: { mono: 1 } }, l3: { kind: 'lfo', lfo: { mono: 0 } }, e1: { kind: 'env', env: {} },
    m1: { kind: 'macro', v: [], names: ['Cut', '', 'Mix'] }, m2: { kind: 'macro', v: [], names: [] }, c1: { kind: 'cc' }, h1: { kind: 'chaos', chaos: { mono: 1 } }, h2: { kind: 'chaos', chaos: { mono: 0 } }, nt: { kind: 'note' }, ve: { kind: 'velo' }, at: { kind: 'at' }, bd: { kind: 'bend' },
    x9: { kind: 'lfo', lfo: {} }, l2: { kind: 'env', env: {} } } };
  assert.deepEqual(V.modDevs(t).map(x => x.id), ['ve', 'at', 'bd', 'nt', 'l1', 'l3', 'e1', 'm1', 'm2', 'c1', 'h1', 'h2'], 'Tidy order; an id of the wrong kind is no module');
  const S = V.sourcesOf(t, { perf: { wheel: { v: 1 } } });
  assert.deepEqual(S.map(x => x.id + (x.perNote ? '*' : '')), ['wheel', 've.out*', 'at.out', 'bd.out', 'nt.out*', 'l1.out', 'l3.out*', 'e1.out*', 'm1.k1', 'm1.k2', 'm1.k3', 'm1.k4', 'm1.k5', 'm1.k6', 'm1.k7', 'm1.k8',
    'm2.k1', 'm2.k2', 'm2.k3', 'm2.k4', 'm2.k5', 'm2.k6', 'm2.k7', 'm2.k8', 'c1.out', 'h1.out', 'h2.out*']);
  assert.deepEqual(S.filter(x => x.dev === 'm1').slice(0, 3).map(x => [x.label, x.port, x.kind]), [['Cut', 'k1', 'macro'], ['Macro 1 · 2', 'k2', 'macro'], ['Mix', 'k3', 'macro']]);
  assert.deepEqual(S[0], { id: 'wheel', label: 'Mod Wheel', scope: 'project', kind: 'wheel', dev: 'wheel', port: '', perNote: false });
  assert.deepEqual(S[5], { id: 'l1.out', label: 'LFO 1', scope: 'track', kind: 'lfo', dev: 'l1', port: 'out', perNote: false });
  assert.deepEqual(V.sourcesOf(t, {}).length, S.length - 1, 'no wheel');
  assert.deepEqual([V.perNoteOf(t, 'l1.out'), V.perNoteOf(t, 'l3.out'), V.perNoteOf(t, 'e1.out'), V.perNoteOf(t, 'm1.k2'), V.perNoteOf(t, 'c1.out'), V.perNoteOf(t, 'h1.out'), V.perNoteOf(t, 'h2.out'), V.perNoteOf(t, 'nt.out'), V.perNoteOf(t, 'wheel')],
    [false, true, true, false, false, false, true, true, false]);
  assert.deepEqual([V.perNoteOf(t, 'i1/lfo1.out'), V.perNoteOf(t, 'i1/lfo2.out'), V.perNoteOf(t, 'i1/env3.out'), V.perNoteOf(t, 'i2/lfo1.out'), V.perNoteOf(t, 'l1.k2'), V.perNoteOf(t, 'm1.out'), V.perNoteOf(t, 'x9.out'), V.perNoteOf(t, 'l2.out')],
    [false, true, true, null, null, null, null, null], 'a MONO Serum LFO is global; only a Serum links; the right port of the right kind');
  const L = V.linkSources(t);
  assert.deepEqual([L.length, L[0], L.filter(x => x.used).map(x => x.link)], [14, { id: 'i1/lfo1.out', label: 'Lead LFO 1', scope: 'track', kind: 'link', dev: 'i1', port: 'out', link: 'lfo1', perNote: false, used: true }, ['lfo1', 'env1', 'env3']]);
  assert.deepEqual(V.srcDev(t, 'm1.k3'), { q: { dev: 'm1', port: 'k3', link: '' }, dev: t.dev.m1, kind: 'macro' });
  assert.deepEqual([V.MOD_SRC['nt.out'], V.SRC_MOD.note, V.MOD_DEV.note, V.MOD_PREFIX.chaos, V.MOD_MULTI, V.MOD_ORDER[4]], ['note', 'nt.out', 'nt', 'h', ['lfo', 'env', 'macro', 'cc', 'chaos'], 'note']);
});

test('2a sourcesOf / wheelTracks: the project wheel when placed, the track\'s modulators; the tracks the live wheel reaches', () => {
  const t = { dev: { i1: { kind: 'synth', model: 'serum' }, ve: { kind: 'velo' }, bd: { kind: 'bend' }, at: { kind: 'velo' } }, mods: [{ id: 'r1', src: 'wheel', dst: 'i1:f.cutoff' }] };
  const p = { perf: { wheel: { v: 1 } }, tracks: [t, { dev: {}, mods: [{ id: 'r1', src: 've.out', dst: 'i1:a.level' }] }, { dev: {} }] };
  assert.deepEqual(V.sourcesOf(t, p), [
    { id: 'wheel', label: 'Mod Wheel', scope: 'project', kind: 'wheel', dev: 'wheel', port: '', perNote: false },
    { id: 've.out', label: 'Velocity', scope: 'track', kind: 'velo', dev: 've', port: 'out', perNote: true },
    { id: 'bd.out', label: 'Bend', scope: 'track', kind: 'bend', dev: 'bd', port: 'out', perNote: false }, // ('at' holding another kind is not Aftertouch)
  ]);
  assert.deepEqual(V.sourcesOf(t, { perf: { wheel: null } }).map(x => x.id), ['ve.out', 'bd.out']);
  assert.deepEqual(V.wheelTracks(p), [t]);
  assert.deepEqual(V.wheelTracks({ perf: { wheel: null }, tracks: p.tracks }), [], 'no module: today\'s routing');
  assert.deepEqual(V.wheelTracks({ tracks: p.tracks }), []);
  assert.deepEqual([V.MOD_SRC['ve.out'], V.SRC_MOD.bend, V.MOD_DEV.at], ['velo', 'bd.out', 'at']);
  for (const k of Object.keys(V.MOD_SRC)) assert.equal(V.SRC_MOD[V.MOD_SRC[k]], k, 'a round trip');
  for (const k of Object.values(V.MOD_SRC)) assert.ok(C.SRC_INDEX[k] > 0, k + ' is a Serum source');
});

test('2b fixer B (C3 / C13): targetsOf memoised per (model, ctl); depsOf names the neighbours a transfer depends on; xferOf cached per (model, ctl, target) on those values; SM_SLOT is SLOT', () => {
  const T = V.targetsOf('juno60', 'cf');
  assert.equal(V.targetsOf('juno60', 'cf'), T, 'the same array (pure: a static memo)');
  assert.equal(V.targetsOf(MODELS.find(m => m.id === 'juno60'), 'cf'), T, 'by model object too');
  assert.equal(V.depsOf('juno60', 'cf', T[0]).includes('cf'), true, 'the knob itself');
  const dv2 = V.depsOf('minimoog', 'v2', V.targetsOf('minimoog', 'v2')[0]);
  assert.ok(dv2.includes('v2') && dv2.includes('m2'), 'the Minimoog level knob depends on its mixer switch: ' + dv2.join(','));
  assert.ok(!dv2.includes('fc') && !dv2.includes('vol'), 'not on the filter cutoff or the master volume: ' + dv2.join(','));
  assert.equal(V.depsOf('minimoog', 'v2', V.targetsOf('minimoog', 'v2')[0]), dv2, 'memoised');
  assert.deepEqual(V.depsOf('serum', 'f.cutoff'), []);
  const x1 = V.xferOf('juno60', { cf: 3, rs: 2 }, 'cf', T[0]);
  assert.equal(V.xferOf('juno60', { cf: 3, rs: 9 }, 'cf', T[0]), x1, 'an uncabled neighbour (not a dependency): the same transfer object');
  const x2 = V.xferOf('juno60', { cf: 4, rs: 9 }, 'cf', T[0]);
  assert.notEqual(x2, x1, 'the knob moved: a new transfer');
  assert.equal(x2.x0 > x1.x0, true);
  assert.equal(V.xferOf('juno60', { cf: 4 }, 'cf', T[0]), x2, 'cached by the dependency values, not the vals object');
  const m2on = V.xferOf('minimoog', { v2: 5, m2: 1 }, 'v2'), m2off = V.xferOf('minimoog', { v2: 5, m2: 0 }, 'v2');
  assert.notEqual(m2on, m2off, 'a dependency changed: recomputed');
  assert.deepEqual([m2off.a, m2off.b], [0, 0], 'the switch off: inert');
  assert.equal(V.SM_SLOT['vcf.oct'], V.SLOT.VO);
  assert.equal(V.SM_SLOT['osc.pw'], V.SLOT.PW);
  assert.equal(V.SM_SLOT['rm.depth'], V.SLOT.RM);
});

test('milestone 3 destOk: a modulator\'s own knobs (its body a Serum panel on a slot host: Serum ids) are never a cable\'s end, kept rows too; a Serum part\'s knobs are its Serum\'s', () => {
  // the four Serum-faithful kinds carry the ids their slot uses (LFO 1 / ENV 2 / chaos 1 / the macros), the rest their own
  const ids = { lfo: ['l1.rate', 'l1.rise'], env: ['e2.att', 'e2.ca'], macro: ['m1', 'm8'], chaos: ['c1.rate', 'c1.bpm'], cc: ['x'], velo: ['x'], at: ['x'], bend: ['x'], note: ['x'], wheel: ['x'] };
  for (const kind of Object.keys(ids)) for (const id of ids[kind]) {
    for (const keep of [false, true]) assert.deepEqual(V.destOk({ kind, lfo: {}, env: {} }, id, keep), { ok: false, why: V.NOMOD_MOD, stage: null }, kind + ' ' + id);
  }
  assert.equal(Object.keys(ids).sort().join(), Object.keys(V.MOD_LABEL).sort().join(), 'every modulator kind');
  // a part's controls share their Serum's [data-dev]: the Serum device answers (OSC B's level, its ⏻ — the bar's x.on end)
  const sx = { kind: 'synth', model: 'serum', vals: { s: C.normalizeSerum(C.defaultSerum()) }, fx: null };
  for (const id of ['b.level', 'b.on', 'f2.cutoff', 'l3.rate', 'e2.att', 'm3', 'arp.on']) assert.equal(V.destOk(sx, id).ok, true, id);
});

/* ------------------------------------------------------------------ IMPL-8 §5.1 (lane Q): a mod pad of a Pads module as a source */
import * as PC from '../pads-core.js?v=9';
// two Pads modules (pd2 first in the list): pd1 2 × 3 — slot 0 'Duck' (vel), 1 a note without mod (not a source), 2 mod only,
// 9 a note C4 + mod (gate), 12 hidden at 3 columns (mod); pd2 'Kit' 4 × 4 — slot 0 'Kick' (mod), 63 hidden (mod)
function padsProject() {
  const note = n => ({ k: 'note', tr: 'trk_1', n }), pads1 = new Array(64).fill(null), pads2 = new Array(64).fill(null);
  pads1[0] = { l: 'Duck', mod: { m: 'vel', lo: 0, hi: 1 } }; pads1[1] = { t: [note(48)] }; pads1[2] = { mod: { m: 'tog', lo: 0.2, hi: 0.8 } };
  pads1[9] = { t: [note(60)], mod: { m: 'gate' } }; pads1[12] = { mod: {} };
  pads2[0] = { l: 'Kick', t: [{ k: 'drum', tr: 'trk_1', s: 'bd' }], mod: { m: 'press' } }; pads2[63] = { mod: { lo: 1, hi: 0 } };
  return { perf: { wheel: { v: 1 } }, pads: PC.normPads([{ id: 'pd2', name: 'Kit', pads: pads2 }, { id: 'pd1', rows: 2, cols: 3, pads: pads1 }]), tracks: [] };
}
test('IMPL-8 §5.1 pad sources: srcOf / srcDev / perNoteOf of pd<n>.p<i> (kind pad, GLOBAL, the track never read); malformed ids are no source', () => {
  assert.deepEqual(V.srcOf('pd1.p12'), { dev: 'pd1', port: 'p12', link: '' });
  for (const t of [{ dev: {} }, null, undefined, { dev: { pd1: { kind: 'lfo' } } }]) {
    assert.deepEqual(V.srcDev(t, 'pd1.p12'), { q: { dev: 'pd1', port: 'p12', link: '' }, dev: null, kind: 'pad' }, 'the wheel\'s pattern: no track lookup');
    assert.equal(V.perNoteOf(t, 'pd8.p63'), false, 'GLOBAL');
  }
  for (const s of ['pd0.p1', 'pd9.p1', 'pd1.p64', 'pd1.p07', 'pd1.out', 'pd1.k1', 'pd1/lfo1.p1', 'pd12.p1', 'pd.p1', 'Pd1.p1'])
    assert.deepEqual([V.srcDev({ dev: {} }, s), V.perNoteOf({ dev: {} }, s), V.isPadSrc(s)], [null, null, false], s);
  assert.deepEqual(['pd1.p0', 'pd8.p63', 'pd3.p9'].map(V.isPadSrc), [true, true, true]);
  assert.deepEqual([V.kindOfId('pd1'), V.MOD_LABEL.pad, V.MOD_LABEL.pads, V.MOD_ORDER.includes('pads')], [null, undefined, undefined, false], 'the track-device tables stay (IMPL-8 §1.1)');
  assert.deepEqual(V.destOk({ kind: 'pads' }, 'x'), { ok: false, why: 'This knob can’t be modulated', stage: null }, 'a Pads module has no [data-dest]');
});
test('IMPL-8 §5.1 sourcesOf lists the project\'s mod pads after the wheel (modules by id, slots in order; labels; scope project; hidden flagged); none without p.pads', () => {
  const p = padsProject(), t = { dev: { l1: { kind: 'lfo', lfo: { mono: 1 } } } }, S = V.sourcesOf(t, p);
  assert.deepEqual(S.map(x => x.id), ['wheel', 'pd1.p0', 'pd1.p2', 'pd1.p9', 'pd1.p12', 'pd2.p0', 'pd2.p63', 'l1.out']);
  assert.deepEqual(S.filter(x => x.kind === 'pad').map(x => [x.label, x.hidden]), [['Pads 1 · Duck', false], ['Pads 1 · Pad 3', false], ['Pads 1 · C4', false], ['Pads 1 · Pad 13', true],
    ['Kit · Kick', false], ['Kit · Pad 64', true]], 'own label, else its first target\'s, else "Pad k" (k: the shown number; hidden: its number on the full 8 × 8)');
  assert.deepEqual(S[3], { id: 'pd1.p9', label: 'Pads 1 · C4', scope: 'project', kind: 'pad', dev: 'pd1', port: 'p9', perNote: false, hidden: false });
  assert.deepEqual(V.sourcesOf(t, { perf: { wheel: null } }).map(x => x.id), ['l1.out'], 'no p.pads: today\'s list');
  assert.deepEqual(V.sourcesOf(t, { pads: 'x' }).map(x => x.id), ['l1.out']);
  assert.deepEqual(V.sourcesOf(t, { pads: [] }).map(x => x.id), ['l1.out']);
  assert.deepEqual([V.padSrcLabel(p, 'pd1.p9'), V.padSrcLabel(p, 'pd1.p1'), V.padSrcLabel(p, 'pd3.p0'), V.padSrcLabel(p, 'x'), V.padSrcLabel(null, 'pd1.p0')], ['Pads 1 · C4', 'Pads 1 · C3', '', '', ''],
    'the label of any slot of a module (a row\'s label after its pad\'s mod went: the host prunes it)');
});
test('R1-E cv-mods\' pad names are pads-core\' padSourceName (one wording everywhere): sourcesOf, padSrcLabel — the module\'s name, the pad\'s label / first target / "Pad k", a hidden slot its place on the 8 × 8', () => {
  const p = padsProject();
  for (const M of p.pads) for (let i = 0; i < 64; i++) {
    const pad = M.pads[i];
    if (!pad || !pad.mod) continue;
    assert.equal(V.padSrcLabel(p, 'pd' + M.id.slice(2) + '.p' + i), PC.padSourceName(p, M, i), M.id + ' ' + i);
    assert.equal(V.sourcesOf({ dev: {} }, p).find(x => x.id === M.id + '.p' + i).label, PC.padSourceName(p, M, i));
  }
});
test('IMPL-8 §5.3 padTracks: the tracks holding rows of a mod pad (the wheelTracks pattern); none for a pad without mod, a missing module, a non-pad source', () => {
  const p = padsProject(), r = (id, src) => ({ id, src, dst: 'i1:f.cutoff' });
  const a = { id: 'trk_1', dev: {}, mods: [r('r1', 'pd1.p0'), r('r2', 'wheel')] }, b = { id: 'trk_2', dev: {}, mods: [r('r1', 'pd1.p9')] }, c = { id: 'trk_3', dev: {}, mods: [r('r1', 'pd1.p0'), r('r2', 'pd1.p1')] }, d = { id: 'trk_4', dev: {} };
  p.tracks = [a, b, c, d, null];
  assert.deepEqual([V.padTracks(p, 'pd1.p0'), V.padTracks(p, 'pd1.p9'), V.padTracks(p, 'pd2.p0')], [[a, c], [b], []]);
  assert.deepEqual([V.padTracks(p, 'pd1.p1'), V.padTracks(p, 'pd3.p0'), V.padTracks(p, 'wheel'), V.padTracks(p, 'pd1'), V.padTracks({ tracks: p.tracks }, 'pd1.p0'), V.padTracks(null, 'pd1.p0')], [[], [], [], [], [], []],
    'a slot without mod (its rows went with it), a missing module, the wheel, a module id, no p.pads');
  assert.deepEqual(V.wheelTracks(p), [a], 'the wheel\'s own list unchanged');
});
