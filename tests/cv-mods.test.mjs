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

const CLASSIC = MODELS.filter(m => !m.custom);

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
  assert.equal(Object.values(n).reduce((a, b) => a + b, 0), 425);
  assert.deepEqual(n, { none: 2, sm: 129, apply: 70, proc: 37, chunk: 180, struct: 7 });
  const of = cls => Object.entries(V.CLASS_TABLE).flatMap(([m, t]) => Object.keys(t).filter(k => t[k] === cls).map(k => m + '.' + k));
  // voice structure / filter path: P-5 and OB-Xa Unison, JP-8 Assign, OB-Xa filter slope, DX7 algorithm, the two HPF
  // cutoffs that switch the HP type
  assert.deepEqual(of('struct').sort(), ['dx7.alg', 'jupiter8.as', 'jupiter8.hp', 'modular.hp', 'obxa.pl', 'obxa.un', 'prophet5.un']);
  assert.deepEqual(of('none').sort(), ['jupiter8.pws', 'minimoog.mm']);
  const spot = { 'minimoog.fc': 'sm', 'minimoog.em': 'sm', 'minimoog.fa': 'apply', 'minimoog.gl': 'proc', 'minimoog.w1': 'chunk', 'minimoog.m1': 'sm',
    'tb303.dc': 'apply', 'tb303.ac': 'apply', 'dx7.vol': 'sm', 'dx7.dac': 'proc', 'dx7.R1_1': 'chunk', 'solina.cb': 'proc', 'solina.vol': 'sm',
    'jupiter8.sl': 'apply', 'cs80.rms': 'chunk', 'juno60.ch': 'proc' };
  for (const [k, c] of Object.entries(spot)) { const [m, id] = k.split('.'); assert.equal(V.classOf(m, id), c, k); }
  assert.equal(V.classOf('serum', 'f.cutoff'), null);
  assert.equal(V.classOf('minimoog', 'nope'), null);
});

test('FIELD_CLASS knows every patch field of the engine (engine.js patch tables)', () => {
  const src = readFileSync(new URL('../engine.js', import.meta.url), 'utf8');
  const PRE = { OscP: ['osc.'], HpfP: ['hpf.'], VcfP: ['vcf.'], EnvP: ['fenv.', 'aenv.'], LfoP: ['lfo.'], FxP: ['fx.'], DualP: ['dual.'], Mod3P: ['mod3.'],
    TbP: ['tb.'], RmP: ['rm.'], IlP: ['fenvIL.'], RegP: ['reg.'], OpP: ['ops.'], PatchP: [''] };
  // PatchP members that are not classic panel fields: sub-objects (classed through their own tables), the Serum / FX / sequencer passthroughs
  const SKIP = new Set(['osc', 'hpf', 'vcf', 'fenv', 'aenv', 'lfo', 'fx', 'reg', 'dual', 'mod3', 'tb', 'rm', 'fenvIL', 'ops', 'serum', 'serumT', 'fxr', 'fxrT', 'seq', 'seqT', 'needs']);
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
  assert.deepEqual(Object.keys(S[0]), ['id', 'label', 'law', 'lo', 'hi', 'def', 'fmt', 'scope', 'cls', 'nomod']);
  // a rack: reverb, a 3-band splitter with an EQ in its middle branch, a Convolve (its non-modulatable rows marked)
  const fx = C.defaultFx2(), rev = C.newInstance(fx, 'rev', { rack: 0 }), sp = C.newInstance(fx, 'split3', { rack: 0 });
  const eq = C.newInstance(fx, 'eq', { rack: 0, splitter: sp, branch: 1 }), cv = C.newInstance(fx, 'conv', { rack: 0 });
  const R = V.rackDescs(fx.racks[0]);
  for (const id of [`fx.${rev}.mix`, `fx.${sp}.freq1`, `fx.${eq}.freqL`, `fx.${cv}.mix`]) assert.ok(R.some(d => d.id === id), id);
  assert.ok(R.filter(d => d.id.startsWith(`fx.${cv}.`)).some(d => d.nomod), 'Convolve has rows that cannot be modulated');
  assert.deepEqual(V.rackDescs(fx).map(d => d.id), R.map(d => d.id), 'a whole v2 FX state: its racks');
  assert.equal(V.descs({ kind: 'panel', rack: fx.racks[0] }).length, R.length);
  assert.equal(V.descs({ kind: 'synth', model: 'juno60' }).length, 25);
  assert.equal(V.descs({ kind: 'synth', model: 'serum', fx }).length, S.length + R.length);
  assert.deepEqual([V.descs(null), V.descs({ kind: 'out' })], [[], []]);
});
