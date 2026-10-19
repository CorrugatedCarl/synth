// cv-mods.js — what each knob of SYNTH Canvas is, and when it can be modulated (SPEC-canvas §7.2, §7.4, §7.8; stage 1a
// skeleton). Pure ES module: no DOM, nothing at module top level but tables (node-tested: tests/cv-mods.test.mjs).
//
// Destination descriptors (§7.2), one shape for every module: { id, label, law, lo, hi, def, fmt, scope, cls, nomod }
//   descs(dev)              dev = a device of track.dev (§5.1): { kind: 'synth', model, vals } | { kind: 'panel', fx } (1c:
//                           the panel's whole FX state) | { kind: 'panel', rack } (§5.1's single rack)
//   classicDescs(modelId)   models.js controls: knobs 'lin' over [min, max], selectors 'enum' (opts), toggles 'bool'; cls from
//                           CLASS_TABLE; nomod for 'struct' and 'none'
//   serumDescs()            serum-core DESTS (529 rows, scopes V / V* / V*M / G / M; the FX rows of a Serum's own FX are
//                           its rack's, below)
//   rackDescs(rack)         a rack's effects (splitter branches included): fx-core FXP_TAB rows as `fx.<inst>.<pid>`, nomod
//                           where the effect defines it
//
// Classic control classes (§7.8): how the engine consumes what a control changes, the most demanding of
//   none < sm < apply ≈ proc < chunk < struct
//   sm      a smoothed slot (engine.js smTargets: filter / HP / dual cutoffs and resonances, env amount and offset, drive,
//           oscillator level (and its on gate), PW, tune; sub, noise, ring, ext, ring-mod depth; level). DX7 (fm) and
//           Solina (divide): level only (smTargets returns before the other slots)        → tier-1 slot offsets, 2b
//   apply   a per-voice setter of AVoice.apply / noteOn (Env.set: envelope times and levels; cfgLP: ladder compensation,
//           feedback saturation, 2-pole tap, SVF mode / morph / saturation, clip; the 303 accent / latch / slew; the
//           CS-80 IL / AL envelope)                                                         → span setters, 2b
//   proc    the processor (glide, unison detune, bend range, priority / legato, LFO rate and wave, chorus / ensemble /
//           hiss, bandwidth, the DX7 DAC, the Solina's Divide: registers, attack, release, tone) → span setters, 2b
//   chunk   read by the voices from the patch while they render (waveform mix, key / env / LFO / wheel amounts, sync,
//           cross-mod, velocity and aftertouch amounts, LFO delay, ring-mod speed, DX7 operators, feedback, transpose)
//                                                                                           → AVoice.mo / FVoice, stage 5
//   struct  voice structure or the filter path itself (engine, mode, poly, unison, filter / HP type, dual presence, DX7
//           algorithm)                                                                      → never ('nomod')
//   none    the control changed nothing over every base (re-checked against the live patch when dropped on)
// A control's class comes from a sweep: each of its values (knobs: min, max, default and 11 steps between; selectors:
// every option; toggles: both) mapped through the model's map() on the default patch and on every factory preset, the
// changed patch fields classed by FIELD_CLASS, the most demanding class kept. classTable() runs the sweep; CLASS_TABLE
// is its checked-in result (regenerate: node tools/cv-classes.mjs --write; tests/cv-mods.test.mjs compares the two).
// Counts (425 classic controls): sm 129, apply 70, proc 37, chunk 180, struct 7, none 2. (The spec's estimate had proc 38
// / chunk 179: the CS-80 ring-modulator speed reads per span in the voice, AVoice.render, so it is chunk here.)
//
//   classOf(modelId, ctlId) → class | null      counts(table) → { none, sm, apply, proc, chunk, struct }
//   fieldClass(path, engine)                     classTable() → { modelId: { ctlId: class } }
//   sweepControl(model, ctl) → { cls, fields }   the fields: normalised patch paths ('osc.lev', 'ops.R', 'mod3?' = presence)
import { MODELS } from './models.js?v=9';
import { DESTS, FXP_TAB } from './serum-core.js?v=9';

export const CLASSES = ['none', 'sm', 'apply', 'proc', 'chunk', 'struct'];
export const RANK = { none: 0, sm: 1, apply: 2, proc: 2, chunk: 3, struct: 4 };

// patch field (normalised: no indices; 'x?' = the object x present or null) → class (engine.js readers in comments)
const F = (cls, list) => list.split(' ').map(k => [k, cls]);
export const FIELD_CLASS = Object.freeze(Object.fromEntries([
  // smTargets slots (analog engine; level on every engine)
  ...F('sm', 'level sub noise ring ext vcf.oct vcf.res vcf.env vcf.envOff vcf.drive hpf.oct hpf.res dual.oct dual.res dual.hoct dual.hres ' +
    'osc.on osc.lev osc.oct osc.fine osc.pw rm.depth'),
  // AVoice.apply (Env.set, cfgLP, SKHigh clip), noteOn (tb, fenvIL), Env.set's overshoot
  ...F('apply', 'fenv.a fenv.d fenv.s fenv.r aenv.a aenv.d aenv.s aenv.r envOv vcf.comp vcf.fbSat vcf.poles vcf.mode vcf.morph vcf.sat ' +
    'vcf.clip hpf.clip tb.accent tb.latch tb.chg tb.dis fenvIL.il fenvIL.al'),
  // SynthProcessor (setPatch, recalc, runLFO, glide coefficient, note priority, chorus / ensemble, the DAC) and Divide
  ...F('proc', 'glide glideLegato prio legato unisonDetune bendRange bw lfo.rate lfo.wave fx.chorus fx.ensemble fx.hiss dac ' +
    'reg.bass reg.cello reg.viola reg.violin reg.trumpet reg.horn attack release tone bpm osCap'),
  // AVoice.render / FVoice.render, straight from the patch
  ...F('chunk', 'drift sawBow pink sync fm01 fm10 polyOscPw polyOscFilt velAmp atPitch fb transpose osc.saw osc.pulse osc.tri osc.sine ' +
    'osc.pwLfo osc.pwEnv osc.kbd osc.envPitch osc.lfoPitch osc.wheelPitch osc.wheelPw hpf.env hpf.kbd hpf.lfo vcf.kbd vcf.lfo vcf.vel vcf.at ' +
    'lfo.delay lfo.pitch lfo.amp lfo.wheelPitch lfo.wheelFilter mod3? mod3.mix mod3.osc mod3.filt tb? rm? rm.rate fenvIL? ' +
    'ops.ratio ops.det ops.fixed ops.hz ops.out ops.vel ops.rs ops.R ops.L'),
  // voice structure and filter paths (setPatch rebuild; makeLP / makeHP; ALGS)
  ...F('struct', 'engine mode poly unison vcf.type hpf.type dual? alg ops?'),
]));
// the slots smTargets fills on the analog engine only
const SM_ANALOG = new Set(Object.keys(FIELD_CLASS).filter(k => FIELD_CLASS[k] === 'sm' && k !== 'level'));

// the class of patch field `path` on `engine` (undefined: a field this table does not know)
export function fieldClass(path, engine) {
  const c = FIELD_CLASS[path];
  if (c === 'sm' && engine !== 'analog' && SM_ANALOG.has(path)) return 'none';
  return c;
}

/* ------------------------------------------------------------------ the sweep */
const G = { drift: 0.5, hiss: 0, sr: 48000, bpm: 120, smooth: 1, fx: null, qr: null, ultra: 0, mpeBendX: 0, mpeYBi: 0 };
const modelOf = m => (typeof m === 'string' ? MODELS.find(x => x.id === m) : m);
const isObj = x => x !== null && typeof x === 'object';
// the model's map of panel values v (as patchFor: P = each control's converted value)
export function patchOf(model, v) {
  const m = modelOf(model), P = {};
  for (const c of m.controls) P[c.id] = c.conv ? c.conv(v[c.id]) : v[c.id];
  return m.map(P, v, G);
}
const z = x => (x === undefined || x === null || x === false ? 0 : x === true ? 1 : x);
// the normalised paths of every field that differs between patches a and b (missing ≡ 0 ≡ false)
export function fieldDiff(a, b, path = '', out = new Set()) {
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) fieldDiff(a[k], b[k], Array.isArray(a) || Array.isArray(b) ? path : path ? path + '.' + k : k, out);
    return out;
  }
  if (isObj(a) !== isObj(b)) { out.add(path + '?'); return out; }
  if (z(a) !== z(b) && !(a !== a && b !== b)) out.add(path); // (NaN ≡ NaN)
  return out;
}
// the values a control is swept through
export function sweepPoints(c) {
  if (c.t === 'b') return [0, 1];
  if (c.t === 's') return c.opts.map((_, i) => i);
  const out = [c.min, c.max, c.def];
  for (let i = 1; i < 12; i++) out.push(c.min + (c.max - c.min) * i / 12);
  return out.map(x => (c.step ? Math.round(x / c.step) * c.step : x));
}
// the bases: the default panel and every factory preset over it
export function basesOf(model) {
  const m = modelOf(model), def = {};
  for (const c of m.controls) def[c.id] = c.def;
  return [def, ...(m.presets || []).map(p => Object.assign({}, def, p.v))];
}
export function sweepControl(model, c, bases = basesOf(model)) {
  const m = modelOf(model), fields = new Set();
  let cls = 'none';
  for (const b of bases) {
    const p0 = patchOf(m, b);
    for (const x of sweepPoints(c)) {
      if (x === b[c.id]) continue;
      const p1 = patchOf(m, Object.assign({}, b, { [c.id]: x }));
      for (const f of fieldDiff(p0, p1)) {
        fields.add(f);
        const k = fieldClass(f, p1.engine || 'analog');
        if (k === undefined) throw new Error(`cv-mods: patch field ${f} (${m.id}.${c.id}) has no class in FIELD_CLASS`);
        if (RANK[k] > RANK[cls]) cls = k;
      }
    }
  }
  return { cls, fields: [...fields].sort() };
}
// every classic model's controls → class (the sweep; CLASS_TABLE is its checked-in result)
export function classTable() {
  const out = {};
  for (const m of MODELS) {
    if (m.custom) continue;
    const bases = basesOf(m), t = out[m.id] = {};
    for (const c of m.controls) t[c.id] = sweepControl(m, c, bases).cls;
  }
  return out;
}
export function counts(table = CLASS_TABLE) {
  const n = Object.fromEntries(CLASSES.map(c => [c, 0]));
  for (const t of Object.values(table)) for (const c of Object.values(t)) n[c]++;
  return n;
}

/* ------------------------------------------------------------------ the checked-in table */
// (generated by tools/cv-classes.mjs --write from classTable(); do not edit by hand)
// <cv-classes>
export const CLASS_TABLE = Object.freeze({
  modular: { r1: 'sm', t1: 'sm', w1: 'chunk', pw1: 'sm', l1: 'sm', r2: 'sm', t2: 'sm', w2: 'chunk', pw2: 'sm', l2: 'sm', r3: 'sm', t3: 'sm', w3: 'chunk', pw3: 'sm', l3: 'sm', nz: 'sm', nc: 'chunk', fc: 'sm', rg: 'sm', ea: 'sm', kb: 'chunk', hp: 'struct', a1: 'apply', b1: 'apply', s1: 'apply', c1: 'apply', a2: 'apply', b2: 'apply', s2: 'apply', c2: 'apply', gl: 'proc', vol: 'sm' },
  minimoog: { tune: 'sm', gl: 'proc', mm: 'none', r1: 'sm', w1: 'chunk', r2: 'sm', f2: 'sm', w2: 'chunk', r3: 'sm', f3: 'sm', w3: 'chunk', om: 'chunk', o3k: 'chunk', v1: 'sm', m1: 'sm', v2: 'sm', m2: 'sm', v3: 'sm', m3: 'sm', ext: 'sm', me: 'sm', nz: 'sm', mn: 'sm', nc: 'chunk', fc: 'sm', em: 'sm', ca: 'sm', fm: 'chunk', k1: 'chunk', k2: 'chunk', fa: 'apply', fd: 'apply', fs: 'apply', la: 'apply', ld: 'apply', ls: 'apply', dk: 'apply', vol: 'sm' },
  arp2600: { c1: 'sm', f1: 'sm', w1: 'chunk', l1: 'sm', c2: 'sm', f2: 'sm', w2: 'chunk', pw2: 'sm', fm: 'chunk', fe2: 'chunk', sy: 'chunk', l2: 'sm', c3: 'sm', f3: 'sm', w3: 'chunk', l3: 'sm', nz: 'sm', nc: 'chunk', rm: 'sm', fc: 'sm', rs: 'sm', ea: 'sm', lf: 'chunk', kb: 'chunk', lr: 'proc', lw: 'proc', lp: 'chunk', a: 'apply', d: 'apply', s: 'apply', r: 'apply', ara: 'apply', arr: 'apply', src: 'apply', gl: 'proc', vol: 'sm' },
  solina: { cb: 'proc', ce: 'proc', va: 'proc', vn: 'proc', tp: 'proc', hn: 'proc', cr: 'proc', su: 'proc', en: 'proc', tn: 'proc', vol: 'sm' },
  cs80: { ft1: 'sm', sw1: 'chunk', sq1: 'chunk', pw1: 'sm', sn1: 'chunk', hp1: 'sm', hr1: 'sm', lp1: 'sm', lr1: 'sm', lv1: 'sm', ft2: 'sm', sw2: 'chunk', sq2: 'chunk', pw2: 'sm', sn2: 'chunk', hp2: 'sm', hr2: 'sm', lp2: 'sm', lr2: 'sm', lv2: 'sm', dt: 'sm', nz: 'sm', rms: 'chunk', rmd: 'chunk', il: 'apply', al: 'apply', fa: 'apply', fd: 'apply', fr: 'apply', aa: 'apply', ad: 'apply', as: 'apply', ar: 'apply', br: 'sm', tv: 'chunk', ta: 'chunk', at: 'chunk', ss: 'proc', sf: 'proc', sv: 'chunk', sfl: 'chunk', sa: 'chunk', gl: 'proc', vol: 'sm' },
  prophet5: { pmf: 'chunk', pmo: 'chunk', pdf: 'chunk', pdp: 'chunk', pdl: 'chunk', lr: 'proc', lw: 'proc', li: 'chunk', wfa: 'chunk', wfb: 'chunk', wpa: 'chunk', wpb: 'chunk', wfl: 'chunk', fa: 'sm', asw: 'chunk', asq: 'chunk', apw: 'sm', sy: 'chunk', fb: 'sm', fbf: 'sm', bsw: 'chunk', btr: 'chunk', bsq: 'chunk', bpw: 'sm', blo: 'sm', bkb: 'chunk', ma: 'sm', mb: 'sm', mn: 'sm', cf: 'sm', rs: 'sm', fe: 'sm', fk: 'chunk', rev: 'apply', eA: 'apply', eD: 'apply', eS: 'apply', eR: 'apply', aA: 'apply', aD: 'apply', aS: 'apply', aR: 'apply', gl: 'proc', un: 'struct', ud: 'proc', vol: 'sm' },
  ms20: { w1: 'chunk', pw1: 'sm', sc1: 'sm', w2: 'chunk', sc2: 'sm', pt: 'sm', l1: 'sm', l2: 'sm', hc: 'sm', hpk: 'sm', lc: 'sm', lpk: 'sm', mr: 'proc', mw: 'proc', mp: 'chunk', mc: 'chunk', ec: 'sm', eh: 'chunk', a: 'apply', d: 'apply', s: 'apply', r: 'apply', pr: 'proc', mt: 'sm', vol: 'sm' },
  tb303: { tu: 'sm', wf: 'chunk', cf: 'sm', rs: 'apply', em: 'sm', dc: 'apply', ac: 'apply', al: 'apply', vol: 'sm' },
  obxa: { lr: 'proc', lw: 'proc', lf: 'chunk', lp: 'chunk', lc: 'chunk', o1f: 'sm', o1s: 'chunk', o1p: 'chunk', o2f: 'sm', o2d: 'sm', o2s: 'chunk', o2p: 'chunk', sy: 'chunk', pw: 'sm', cf: 'sm', rs: 'sm', fm: 'sm', kb: 'chunk', pl: 'struct', fA: 'apply', fD: 'apply', fS: 'apply', fR: 'apply', aA: 'apply', aD: 'apply', aS: 'apply', aR: 'apply', gl: 'proc', un: 'struct', ud: 'proc', vol: 'sm' },
  jupiter8: { lr: 'proc', ld: 'chunk', lw: 'proc', vl: 'chunk', ve: 'chunk', vd: 'chunk', xm: 'chunk', r1: 'sm', w1: 'chunk', sy: 'chunk', r2: 'sm', ft: 'sm', w2: 'chunk', lo: 'chunk', pw: 'sm', pwm: 'chunk', pws: 'none', mx: 'sm', hp: 'struct', cf: 'sm', rs: 'sm', sl: 'apply', fe: 'sm', fl: 'chunk', fk: 'chunk', vlf: 'chunk', lvl: 'sm', e1a: 'apply', e1d: 'apply', e1s: 'apply', e1r: 'apply', e2a: 'apply', e2d: 'apply', e2s: 'apply', e2r: 'apply', as: 'struct', gl: 'proc' },
  juno60: { lr: 'proc', ld: 'chunk', dl: 'chunk', pwm: 'chunk', pm: 'chunk', rg: 'sm', pu: 'chunk', sw: 'chunk', sb: 'sm', nz: 'sm', hp: 'sm', cf: 'sm', rs: 'sm', ep: 'sm', en: 'sm', fl: 'chunk', fk: 'chunk', vm: 'apply', lv: 'sm', a: 'apply', d: 'apply', s: 'apply', r: 'apply', ch: 'proc', hs: 'proc' },
  dx7: { alg: 'struct', fb: 'chunk', tr: 'chunk', dac: 'proc', ls: 'proc', pmd: 'chunk', vol: 'sm', r1: 'chunk', f1: 'chunk', d1: 'chunk', l1: 'chunk', R1_1: 'chunk', R2_1: 'chunk', R3_1: 'chunk', R4_1: 'chunk', L1_1: 'chunk', L2_1: 'chunk', L3_1: 'chunk', L4_1: 'chunk', v1: 'chunk', s1: 'chunk', r2: 'chunk', f2: 'chunk', d2: 'chunk', l2: 'chunk', R1_2: 'chunk', R2_2: 'chunk', R3_2: 'chunk', R4_2: 'chunk', L1_2: 'chunk', L2_2: 'chunk', L3_2: 'chunk', L4_2: 'chunk', v2: 'chunk', s2: 'chunk', r3: 'chunk', f3: 'chunk', d3: 'chunk', l3: 'chunk', R1_3: 'chunk', R2_3: 'chunk', R3_3: 'chunk', R4_3: 'chunk', L1_3: 'chunk', L2_3: 'chunk', L3_3: 'chunk', L4_3: 'chunk', v3: 'chunk', s3: 'chunk', r4: 'chunk', f4: 'chunk', d4: 'chunk', l4: 'chunk', R1_4: 'chunk', R2_4: 'chunk', R3_4: 'chunk', R4_4: 'chunk', L1_4: 'chunk', L2_4: 'chunk', L3_4: 'chunk', L4_4: 'chunk', v4: 'chunk', s4: 'chunk', r5: 'chunk', f5: 'chunk', d5: 'chunk', l5: 'chunk', R1_5: 'chunk', R2_5: 'chunk', R3_5: 'chunk', R4_5: 'chunk', L1_5: 'chunk', L2_5: 'chunk', L3_5: 'chunk', L4_5: 'chunk', v5: 'chunk', s5: 'chunk', r6: 'chunk', f6: 'chunk', d6: 'chunk', l6: 'chunk', R1_6: 'chunk', R2_6: 'chunk', R3_6: 'chunk', R4_6: 'chunk', L1_6: 'chunk', L2_6: 'chunk', L3_6: 'chunk', L4_6: 'chunk', v6: 'chunk', s6: 'chunk' },
});
// </cv-classes>

export const classOf = (modelId, ctlId) => (CLASS_TABLE[modelId] && CLASS_TABLE[modelId][ctlId]) || null;

/* ------------------------------------------------------------------ stage 2b: transfer tables (IMPL-2b §5.3, SPEC §7.8) */
// A cable on a classic knob reaches the engine as an offset in the units of what the knob changes: a smoothed slot
// (sm knobs: engine.js S_* below — SLOT mirrors its numbering, tests/classic-mod.test.mjs pins it) or a patch field (apply /
// proc knobs: the FIELD_CLASS path, 'lfo.rate', 'fenv.a', 'reg.bass', …; the Inst's span setter writes it). The knob's
// modulation space is x ∈ 0…1 over [lo, hi] (a selector: its options rounded; a toggle: 0 / 1).
//   SLOT                            { VO, VE, VN, VR, DRV, HO, HR, DO, DR, DH, DHR, LEV, OL, PW, TU, SUB, NZ, RING, EXT, RM, BEND, WHEEL, AT, N }
//   targetsOf(model, ctlId)         [{ kind: 'slot', slot, field } | { kind: 'field', field }] everything the knob lands on
//                                   (its class sweep over the default panel and the factory presets, so a knob inert at the
//                                   current values still has its targets); several for a knob that moves several (a master
//                                   tune: three TU slots; a filter type switch: character fields and the drive slot)
//   slotOf(model, ctlId)            the first of them (null: none)
//   xferOf(model, vals, ctlId, t?)  the transfer of target t (default: the first) at the current panel values: map() swept
//                                   over the knob (129 points, the neighbours as they are) → { a, b, x0 } when linear within
//                                   1e-9 (slot = a + b·x), else { tab: Float64Array(129), x0 } (linear interpolation; the
//                                   exponential laws are within 0.1 % of the table's range between points); x0 = the knob's
//                                   position in modulation space. The engine adds T(clamp(x0 + Σ)) − T(x0).
//   xferInv(xf, s) → x              the inverse (a table: its first crossing; outside it: the nearer end)
//   knobOf(model, vals, ctlId, s, t?)  the knob value (panel units) of engine value s: the classic eff snapshot's halos
//   slotValue(p, slot)              a slot's value in patch p as engine.js smTargets computes it
export const SLOT = Object.freeze({ VO: 0, VE: 1, VN: 2, VR: 3, DRV: 4, HO: 5, HR: 6, DO: 7, DR: 8, DH: 9, DHR: 10, LEV: 11, OL: 12, PW: 15, TU: 18,
  SUB: 21, NZ: 22, RING: 23, EXT: 24, RM: 25, BEND: 26, WHEEL: 27, AT: 28, N: 29 });
const SLOT_FIELD = Object.freeze({ level: SLOT.LEV, 'vcf.oct': SLOT.VO, 'vcf.envOff': SLOT.VE, 'vcf.env': SLOT.VN, 'vcf.res': SLOT.VR, 'vcf.drive': SLOT.DRV,
  'hpf.oct': SLOT.HO, 'hpf.res': SLOT.HR, 'dual.oct': SLOT.DO, 'dual.res': SLOT.DR, 'dual.hoct': SLOT.DH, 'dual.hres': SLOT.DHR,
  sub: SLOT.SUB, noise: SLOT.NZ, ring: SLOT.RING, ext: SLOT.EXT, 'rm.depth': SLOT.RM });
const OSC_SLOT = Object.freeze({ on: SLOT.OL, lev: SLOT.OL, oct: SLOT.TU, fine: SLOT.TU, pw: SLOT.PW });
export function slotValue(p, i) {
  if (i === SLOT.LEV) return p.level || 0;
  const v = p.vcf || {}, h = p.hpf || {}, d = p.dual;
  switch (i) {
    case SLOT.VO: return v.oct || 0; case SLOT.VE: return v.envOff || 0; case SLOT.VN: return v.env || 0; case SLOT.VR: return v.res || 0;
    case SLOT.DRV: return v.drive || 1; case SLOT.HO: return h.oct || 0; case SLOT.HR: return h.res || 0;
    case SLOT.DO: return d ? d.oct || 0 : 0; case SLOT.DR: return d ? d.res || 0 : 0; case SLOT.DH: return d ? d.hoct || 0 : 0; case SLOT.DHR: return d ? d.hres || 0 : 0;
    case SLOT.SUB: return p.sub || 0; case SLOT.NZ: return p.noise || 0; case SLOT.RING: return p.ring || 0; case SLOT.EXT: return p.ext || 0;
    case SLOT.RM: return p.rm ? p.rm.depth || 0 : 0;
  }
  const k = i >= SLOT.OL && i < SLOT.OL + 3 ? i - SLOT.OL : i >= SLOT.PW && i < SLOT.PW + 3 ? i - SLOT.PW : i >= SLOT.TU && i < SLOT.TU + 3 ? i - SLOT.TU : -1;
  if (k < 0) return 0;
  const o = (p.osc && p.osc[k]) || {};
  if (i < SLOT.PW) return o.on ? o.lev || 0 : 0;
  if (i < SLOT.TU) return o.pw || 0.5;
  return (o.oct || 0) + (o.fine || 0) * 0.01;
}
const ctlOf = (m, id) => m.controls.find(c => c.id === id) || null;
const rangeOf = c => (c.t === 'k' ? [c.min, c.max] : [0, c.t === 's' ? c.opts.length - 1 : 1]);
const knobAt = (c, lo, hi, x) => (c.t === 'k' ? lo + (hi - lo) * x : Math.round(lo + (hi - lo) * x));
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
// the paths of every field that differs between patches a and b, with the index of an array element ('osc.1.lev')
function diffIx(a, b, path = '', out = new Set()) {
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffIx(a[k], b[k], path ? path + '.' + k : k, out);
    return out;
  }
  if (isObj(a) !== isObj(b)) { out.add(path + '?'); return out; }
  if (z(a) !== z(b) && !(a !== a && b !== b)) out.add(path);
  return out;
}
// the target of an indexed field path on `engine` (null: a chunk / struct / presence field, or not a slot there)
function targetOfField(path, engine) {
  const s = path.split('.');
  if (s[0] === 'osc' && s.length === 3) {
    const slot = OSC_SLOT[s[2]], k = +s[1];
    return slot !== undefined && engine === 'analog' && k >= 0 && k < 3 ? { kind: 'slot', slot: slot + k, field: 'osc.' + s[2] } : null;
  }
  if (path.endsWith('?')) return null;
  const cls = fieldClass(path, engine);
  if (cls === 'sm') { const slot = SLOT_FIELD[path]; return slot === undefined ? null : { kind: 'slot', slot, field: path }; }
  if (cls === 'apply' || cls === 'proc') return { kind: 'field', field: path };
  return null;
}
const sameT = (a, b) => a.kind === b.kind && (a.kind === 'slot' ? a.slot === b.slot : a.field === b.field);
export function targetsOf(model, ctlId) {
  const m = modelOf(model), c = m && ctlOf(m, ctlId), out = [];
  if (!c || m.custom) return out;
  for (const b of basesOf(m)) {
    const p0 = patchOf(m, b);
    for (const x of sweepPoints(c)) {
      if (x === b[c.id]) continue;
      const p1 = patchOf(m, Object.assign({}, b, { [c.id]: x }));
      for (const f of diffIx(p0, p1)) { const t = targetOfField(f, p1.engine || 'analog'); if (t && !out.some(y => sameT(y, t))) out.push(t); }
    }
  }
  return out;
}
export const slotOf = (model, ctlId) => targetsOf(model, ctlId)[0] || null;
const valueAt = (p, t) => (t.kind === 'slot' ? slotValue(p, t.slot) : z(t.field.split('.').reduce((o, k) => (isObj(o) ? o[k] : undefined), p)));
export function xferOf(model, vals, ctlId, target) {
  const m = modelOf(model), c = m && ctlOf(m, ctlId);
  if (!c || m.custom) return null;
  const t = target || slotOf(m, ctlId);
  if (!t) return null;
  const [lo, hi] = rangeOf(c), v = Object.assign({}, vals || {});
  const cur = v[ctlId] == null ? c.def : +v[ctlId], x0 = clamp01((cur - lo) / (hi - lo));
  const tab = new Float64Array(129);
  for (let k = 0; k <= 128; k++) { v[ctlId] = knobAt(c, lo, hi, k / 128); tab[k] = +valueAt(patchOf(m, v), t) || 0; }
  const a = tab[0], b = tab[128] - a;
  let lin = true;
  for (let k = 1; k < 128 && lin; k++) if (Math.abs(tab[k] - (a + b * k / 128)) > 1e-9) lin = false;
  return lin ? { a, b, x0 } : { tab, x0 };
}
export function xferInv(xf, s) {
  if (!xf) return 0;
  const t = xf.tab;
  if (t) {
    for (let k = 0; k < 128; k++) {
      const y0 = t[k], y1 = t[k + 1];
      if (s === y0) return k / 128;
      if ((s - y0) * (s - y1) < 0) return (k + (s - y0) / (y1 - y0)) / 128;
    }
    if (s === t[128]) return 1;
    return Math.abs(s - t[0]) <= Math.abs(s - t[128]) ? 0 : 1;
  }
  if (xf.b === 0) return xf.x0;
  return clamp01((s - xf.a) / xf.b);
}
export function knobOf(model, vals, ctlId, s, target) {
  const m = modelOf(model), c = m && ctlOf(m, ctlId);
  if (!c) return 0;
  const [lo, hi] = rangeOf(c), x = xferInv(xferOf(m, vals, ctlId, target), s);
  return c.t === 'k' ? lo + (hi - lo) * x : Math.round(lo + (hi - lo) * x);
}

/* ------------------------------------------------------------------ descriptors */
const LAW = { k: 'lin', s: 'enum', b: 'bool' };
export function classicDescs(modelId) {
  const m = modelOf(modelId);
  if (!m || m.custom) return [];
  return m.controls.map(c => {
    const cls = classOf(m.id, c.id);
    return { id: c.id, label: c.label, law: LAW[c.t], lo: c.t === 'k' ? c.min : 0, hi: c.t === 'k' ? c.max : c.t === 's' ? c.opts.length - 1 : 1,
      def: c.def, fmt: c.fmt || null, opts: c.t === 's' ? c.opts.slice() : null, scope: null, cls, nomod: cls === 'struct' || cls === 'none' };
  });
}
export function serumDescs() {
  return DESTS.map(d => ({ id: d.id, label: d.label, law: d.law, lo: d.lo, hi: d.hi, def: d.def, fmt: d.fmt, scope: d.scope, cls: null, nomod: false }));
}
// a rack ({mods}) or a v2 FX state ({racks}) → its effects' rows, splitter branches included
export function rackDescs(rack) {
  const out = [];
  const walk = list => {
    for (const I of list || []) {
      if (!isObj(I)) continue;
      const tab = FXP_TAB[I.type], rows = tab ? tab[String(I.v)] || tab['2'] || tab['1'] || [] : [];
      for (const r of rows) out.push({ id: `fx.${I.id}.${r.pid}`, label: r.label, law: r.law, lo: r.lo, hi: r.hi, def: r.def, fmt: r.fmt, scope: 'G', cls: null, nomod: !!r.nomod });
      if (Array.isArray(I.br)) for (const b of I.br) walk(b);
    }
  };
  if (isObj(rack) && Array.isArray(rack.racks)) for (const r of rack.racks) walk(r && r.mods);
  else walk(isObj(rack) ? rack.mods : null);
  return out;
}
// (a panel: its FX state whole, as stage 1c keeps it, else §5.1's single-rack form)
export function descs(dev) {
  if (!isObj(dev)) return [];
  if (dev.kind === 'synth') return dev.model === 'serum' ? serumDescs().concat(rackDescs(dev.fx)) : classicDescs(dev.model);
  if (dev.kind === 'panel') return rackDescs(isObj(dev.fx) ? dev.fx : dev.rack);
  return [];
}

/* ------------------------------------------------------------------ performance modulators (stage 2a, IMPL-2a §1, §2.2) */
// A mod cable is a row of track.mods (§5.1): { id: 'r<n>', src, dst: '<dev>:<param>', …the matrix row's fields }. In 2a
// its source is the project Mod Wheel ('wheel') or a track's Velocity / Aftertouch / Bend module ('ve.out' / 'at.out' /
// 'bd.out'), its destination a Serum's knob (a DESTS id) or one of that Serum's own FX knobs (fx.<inst>.<pid>); the
// compile injects it as a native row (§7.7 items 1–2, cv-graph injectMods: no DSP change).
//   MOD_SRC / SRC_MOD        canvas source ↔ the Serum source its row compiles to (wheel / velo / at / bend)
//   MOD_DEV                  the per-track singletons: kind → device id (velo → 've', at → 'at', bend → 'bd')
//   destOk(dev, paramId)     { ok, why, stage }: a Serum's DESTS id or own-FX id (not nomod); classic / panel knobs:
//                            stage '2b' (struct / none classic knobs: never); anything else refused
//   sourcesOf(track, p)      [{ id, label, scope: 'project' | 'track', kind }] the sources a cable may start from on track
//   wheelTracks(p)           the tracks holding at least one 'wheel' row while the project's wheel is placed (§7.10: the
//                            live wheel reaches them too)
export const MOD_SRC = Object.freeze({ wheel: 'wheel', 've.out': 'velo', 'at.out': 'at', 'bd.out': 'bend' });
export const SRC_MOD = Object.freeze({ wheel: 'wheel', velo: 've.out', at: 'at.out', bend: 'bd.out' });
export const MOD_DEV = Object.freeze({ velo: 've', at: 'at', bend: 'bd' });
export const MOD_LABEL = Object.freeze({ wheel: 'Mod Wheel', velo: 'Velocity', at: 'Aftertouch', bend: 'Bend' });
const SERUM_IDS = new Set(DESTS.filter(d => !/^fx\./.test(d.id)).map(d => d.id)); // (FX ids: the Serum's own rack, dynamic)
const NOMOD = 'This knob can’t be modulated';
export function destOk(dev, id) {
  const no = (why, stage = null) => ({ ok: false, why, stage });
  if (!isObj(dev) || typeof id !== 'string' || !id) return no(NOMOD);
  if (dev.kind === 'panel') return no('FX panel knobs take modulation from stage 2b', '2b');
  if (dev.kind !== 'synth') return no(NOMOD);
  if (dev.model !== 'serum') {
    const c = classOf(dev.model, id);
    return c === null || c === 'struct' || c === 'none' ? no(NOMOD) : no('Classic knobs take modulation from stage 2b', '2b');
  }
  if (/^fx\./.test(id)) { const d = rackDescs(dev.fx).find(x => x.id === id); return d && !d.nomod ? { ok: true, why: '', stage: null } : no(NOMOD); }
  return SERUM_IDS.has(id) ? { ok: true, why: '', stage: null } : no(NOMOD);
}
const wheelOn = p => isObj(p) && isObj(p.perf) && isObj(p.perf.wheel);
export function sourcesOf(t, p) {
  const out = [];
  if (wheelOn(p)) out.push({ id: 'wheel', label: MOD_LABEL.wheel, scope: 'project', kind: 'wheel' });
  const dev = isObj(t) && isObj(t.dev) ? t.dev : {};
  for (const kind of Object.keys(MOD_DEV)) {
    const id = MOD_DEV[kind];
    if (isObj(dev[id]) && dev[id].kind === kind) out.push({ id: id + '.out', label: MOD_LABEL[kind], scope: 'track', kind });
  }
  return out;
}
export function wheelTracks(p) {
  if (!wheelOn(p) || !Array.isArray(p.tracks)) return [];
  return p.tracks.filter(t => isObj(t) && Array.isArray(t.mods) && t.mods.some(r => isObj(r) && r.src === 'wheel'));
}
