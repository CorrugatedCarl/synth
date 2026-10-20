// cv-mods.js — what each knob of SYNTH Canvas is, and when it can be modulated (SPEC-canvas §7.2, §7.4, §7.8; stage 1a
// skeleton). Pure ES module: no DOM, nothing at module top level but tables (node-tested: tests/cv-mods.test.mjs).
//
// Destination descriptors (§7.2), one shape for every module: { id, label, law, lo, hi, def, fmt, scope, cls, nomod, ctr }
//   (ctr: a centred knob — Serum's ctr flag, a classic −x…x knob, an FX row's ctr — bipolar drop defaults, 2b)
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
//                                   tune: three TU slots; a filter type switch: character fields and the drive slot).
//                                   Pure: memoised per (model, ctl) — the same array every call (never mutate it)
//   slotOf(model, ctlId)            the first of them (null: none)
//   depsOf(model, ctlId, t?)        the controls the transfer of target t depends on: the knob itself and every neighbour
//                                   whose change moves the knob's sweep (measured once per (model, ctl, target) over the
//                                   default panel: each neighbour at its other values, a 7-point sweep compared; a mixer
//                                   switch for an oscillator level, a filter revision for its character…); memoised
//   xferOf(model, vals, ctlId, t?)  the transfer of target t (default: the first) at the current panel values: map() swept
//                                   over the knob (129 points, the neighbours as they are) → { a, b, x0 } when linear within
//                                   1e-9 (slot = a + b·x), else { tab: Float64Array(129), x0 } (linear interpolation; the
//                                   exponential laws are within 0.1 % of the table's range between points); x0 = the knob's
//                                   position in modulation space. The engine adds T(clamp(x0 + Σ)) − T(x0). Cached per
//                                   (model, ctl, target) on the depsOf values: the same object while none of them moved
//                                   (never mutate it; 2b review C3 / P1 — a knob turn costs no sweep unless it is a
//                                   dependency of a cabled knob)
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
const tKey = t => (t.kind === 'slot' ? 's' + t.slot : 'f' + t.field);
const TARGETS = new Map(), DEPS = new Map(), XFER = new Map(); // (static: pure functions of the models; XFER per (model, ctl, target) on the dependency values)
export function targetsOf(model, ctlId) {
  const m = modelOf(model), c = m && ctlOf(m, ctlId);
  if (!c || m.custom) return [];
  const key = m.id + '|' + ctlId, hit = TARGETS.get(key);
  if (hit) return hit;
  const out = [];
  for (const b of basesOf(m)) {
    const p0 = patchOf(m, b);
    for (const x of sweepPoints(c)) {
      if (x === b[c.id]) continue;
      const p1 = patchOf(m, Object.assign({}, b, { [c.id]: x }));
      for (const f of diffIx(p0, p1)) { const t = targetOfField(f, p1.engine || 'analog'); if (t && !out.some(y => sameT(y, t))) out.push(t); }
    }
  }
  TARGETS.set(key, out);
  return out;
}
export const slotOf = (model, ctlId) => targetsOf(model, ctlId)[0] || null;
const valueAt = (p, t) => (t.kind === 'slot' ? slotValue(p, t.slot) : z(t.field.split('.').reduce((o, k) => (isObj(o) ? o[k] : undefined), p)));
// the other values a neighbour is probed at (a toggle flipped, a selector's other options, a knob's ends)
const probesOf = (c, v) => (c.t === 'b' ? [v ? 0 : 1] : c.t === 's' ? c.opts.map((_, i) => i).filter(i => i !== v) : [c.min, c.max].filter(x => x !== v));
export function depsOf(model, ctlId, target) {
  const m = modelOf(model), c = m && ctlOf(m, ctlId);
  if (!c || m.custom) return [];
  const t = target || slotOf(m, ctlId);
  if (!t) return [ctlId];
  const key = m.id + '|' + ctlId + '|' + tKey(t), hit = DEPS.get(key);
  if (hit) return hit;
  const [lo, hi] = rangeOf(c), base = basesOf(m)[0], N = 7;
  const sweep = v => { const o = new Float64Array(N); for (let k = 0; k < N; k++) { v[ctlId] = knobAt(c, lo, hi, k / (N - 1)); o[k] = +valueAt(patchOf(m, v), t) || 0; } return o; };
  const ref = sweep(Object.assign({}, base)), out = [ctlId];
  for (const n of m.controls) {
    if (n.id === ctlId) continue;
    for (const x of probesOf(n, base[n.id])) {
      const s = sweep(Object.assign({}, base, { [n.id]: x }));
      let diff = false;
      for (let k = 0; k < N && !diff; k++) if (s[k] !== ref[k] && !(s[k] !== s[k] && ref[k] !== ref[k])) diff = true;
      if (diff) { out.push(n.id); break; }
    }
  }
  DEPS.set(key, out);
  return out;
}
export function xferOf(model, vals, ctlId, target) {
  const m = modelOf(model), c = m && ctlOf(m, ctlId);
  if (!c || m.custom) return null;
  const t = target || slotOf(m, ctlId);
  if (!t) return null;
  const V = isObj(vals) ? vals : {}, deps = depsOf(m, ctlId, t);
  let dk = m.id + '|' + ctlId + '|' + tKey(t);
  for (const id of deps) { const x = V[id]; dk += '|' + (x === undefined || x === null ? '' : x); }
  const hit = XFER.get(dk);
  if (hit) return hit;
  const [lo, hi] = rangeOf(c), v = Object.assign({}, V);
  const cur = v[ctlId] == null ? c.def : +v[ctlId], x0 = clamp01((cur - lo) / (hi - lo));
  const tab = new Float64Array(129);
  for (let k = 0; k <= 128; k++) { v[ctlId] = knobAt(c, lo, hi, k / 128); tab[k] = +valueAt(patchOf(m, v), t) || 0; }
  const a = tab[0], b = tab[128] - a;
  let lin = true;
  for (let k = 1; k < 128 && lin; k++) if (Math.abs(tab[k] - (a + b * k / 128)) > 1e-9) lin = false;
  const xf = lin ? { a, b, x0 } : { tab, x0 };
  if (XFER.size >= 4096) XFER.clear(); // (bounded: a drag through 129 values of each cabled knob fits many times over)
  XFER.set(dk, xf);
  return xf;
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
    const lo = c.t === 'k' ? c.min : 0, hi = c.t === 'k' ? c.max : c.t === 's' ? c.opts.length - 1 : 1;
    return { id: c.id, label: c.label, law: LAW[c.t], lo, hi, def: c.def, fmt: c.fmt || null, opts: c.t === 's' ? c.opts.slice() : null, scope: null, cls,
      nomod: cls === 'struct' || cls === 'none', ctr: c.t === 'k' && lo < 0 && hi > 0 && lo === -hi ? 1 : 0 }; // (ctr: a centred knob, −x…x: bipolar drops)
  });
}
export function serumDescs() {
  return DESTS.map(d => ({ id: d.id, label: d.label, law: d.law, lo: d.lo, hi: d.hi, def: d.def, fmt: d.fmt, scope: d.scope, cls: null, nomod: false, ctr: d.ctr }));
}
// a rack ({mods}) or a v2 FX state ({racks}) → its effects' rows, splitter branches included
export function rackDescs(rack) {
  const out = [];
  const walk = list => {
    for (const I of list || []) {
      if (!isObj(I)) continue;
      const tab = FXP_TAB[I.type], rows = tab ? tab[String(I.v)] || tab['2'] || tab['1'] || [] : [];
      for (const r of rows) out.push({ id: `fx.${I.id}.${r.pid}`, label: r.label, law: r.law, lo: r.lo, hi: r.hi, def: r.def, fmt: r.fmt, scope: 'G', cls: null, nomod: !!r.nomod, ctr: r.ctr ? 1 : 0 });
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

/* ------------------------------------------------------------------ modulators (stage 2a IMPL-2a §1, §2.2; stage 2b IMPL-2b §1) */
// A mod cable is a row of track.mods (§5.1): { id: 'r<n>', src, dst: '<dev>:<param>', …the matrix row's fields }. Its source
// is the project Mod Wheel ('wheel'), a modulator module's jack ('<devId>.out'; a macro's '<devId>.k1'…'k8') or a Serum's
// own LFO / ENV ('<serumId>/lfo3.out', '<serumId>/env2.out': a linked modulator, §7.7.5); its destination a Serum knob
// (a DESTS id or one of that Serum's own FX knobs), a classic knob (2b: the sm / apply / proc classes) or a shared panel's
// knob. The compile (cv-graph compileMods / injectMods) turns them into native Serum rows, ext rows, injected slots and
// ModCore rows.
//   MOD_SRC / SRC_MOD        canvas source ↔ the native Serum source a row compiles to as it is (wheel / velo / at / bend / note)
//   MOD_DEV                  the per-track singletons: kind → device id (velo 've', at 'at', bend 'bd', note 'nt')
//   MOD_LABEL                kind → label; MOD_PREFIX kind → id prefix ('l', 'e', 'm', 'c', 'h' numbered; the singletons'
//                            ids); MOD_MULTI the kinds a track may hold several of; MOD_ORDER the Tidy order of kinds
//   kindOfId(id)             the kind an id spells ('l3' → 'lfo', 'nt' → 'note'); null for anything else
//   modLabelOf(id, dev)      'LFO 3', 'Macro 1', 'Velocity' (dev: the device, its kind; no kind: the id)
//   modDevs(track)           [{ id, dev, kind }] the modulator devices of a track in Tidy order (by kind, then by number)
//   srcOf(src)               'wheel' → { dev: 'wheel', port: '', link: '' }; '<dev>.<port>' → { dev, port, link: '' };
//                            '<serum>/lfo3.out' → { dev: serum, port: 'out', link: 'lfo3' }; null for anything else
//   srcDev(track, src)       { q: srcOf(src), dev, kind } the device the source names on this track (kind 'wheel' / 'link'
//                            / the module's); null when nothing of that kind is there
//   perNoteOf(track, src)    true for a source that follows the note: velo, note, a PER NOTE lfo (mono 0), an env, a poly
//                            chaos, a linked POLY Serum LFO / ENV; false for the globals; null for an unknown source
//   sourcesOf(track, p)      [{ id, label, scope: 'project' | 'track', kind, dev, port, perNote }] the sources a cable may
//                            start from on this track: the wheel when placed, then every module (a macro: 8 entries k1…k8)
//   linkSources(track)       the linked sources: every Serum's LFO 1–10 and ENV 1–4 ({ id, label, scope: 'track', kind:
//                            'link', dev, port: 'out', link, perNote, used }; used: the Serum's own rows read it)
//   destOk(dev, paramId, keep) { ok, why, stage }: (3) a modulator device (any MOD_LABEL kind): never (NOMOD_MOD) — its
//                            panel's knobs carry Serum ids on a slot host; a Serum's DESTS / own-FX id (not nomod; the filter's routing switches
//                            f.route<X> / f2.route<X> are plain switches: refused unless `keep`, a row that exists); a classic sm / apply / proc knob
//                            (chunk: stage '5'; struct / none: never; a switched-off oscillator's level: "Switch the
//                            oscillator on…"); a panel's effect knob (not nomod)
//   classicTarget(model, vals, ctlId) → { cls, slot, field, fields, on } | null   the engine-side target of a classic knob
//                            on the live panel values: sm → smTargets' slot index (SM_SLOT; the oscillator resolved by a
//                            two-point sweep of the live patch), apply / proc → the patch field ('lfo.rate'); fields: every
//                            changed path; on: false for the level of a switched-off oscillator
//   wheelTracks(p)           the tracks holding at least one 'wheel' row while the project's wheel is placed (§7.10)
export const MOD_SRC = Object.freeze({ wheel: 'wheel', 've.out': 'velo', 'at.out': 'at', 'bd.out': 'bend', 'nt.out': 'note' });
export const SRC_MOD = Object.freeze({ wheel: 'wheel', velo: 've.out', at: 'at.out', bend: 'bd.out', note: 'nt.out' });
export const MOD_DEV = Object.freeze({ velo: 've', at: 'at', bend: 'bd', note: 'nt' });
export const MOD_LABEL = Object.freeze({ wheel: 'Mod Wheel', velo: 'Velocity', at: 'Aftertouch', bend: 'Bend', note: 'Note', lfo: 'LFO', env: 'ENV', macro: 'Macro', cc: 'CC', chaos: 'Chaos' });
export const MOD_PREFIX = Object.freeze({ lfo: 'l', env: 'e', macro: 'm', cc: 'c', chaos: 'h', velo: 've', at: 'at', bend: 'bd', note: 'nt' });
export const MOD_MULTI = Object.freeze(['lfo', 'env', 'macro', 'cc', 'chaos']);
export const MOD_ORDER = Object.freeze(['wheel', 'velo', 'at', 'bend', 'note', 'lfo', 'env', 'macro', 'cc', 'chaos']);
const ID_KIND = { l: 'lfo', e: 'env', m: 'macro', c: 'cc', h: 'chaos' };
export function kindOfId(id) {
  if (typeof id !== 'string') return null;
  const m = /^([lemch])([1-9]\d{0,5})$/.exec(id);
  if (m) return ID_KIND[m[1]];
  for (const k of Object.keys(MOD_DEV)) if (MOD_DEV[k] === id) return k;
  return null;
}
const numOf = id => { const m = /(\d+)$/.exec(id); return m ? +m[1] : 0; };
export function modLabelOf(id, dev) {
  const kind = isObj(dev) && typeof dev.kind === 'string' ? dev.kind : kindOfId(id), L = MOD_LABEL[kind];
  if (!L) return String(id);
  return MOD_MULTI.includes(kind) ? L + ' ' + (numOf(id) || 1) : L;
}
export function modDevs(t) {
  const D = isObj(t) && isObj(t.dev) ? t.dev : {}, out = [];
  for (const id of Object.keys(D)) { const d = D[id]; if (isObj(d) && MOD_LABEL[d.kind] && d.kind !== 'wheel' && kindOfId(id) === d.kind) out.push({ id, dev: d, kind: d.kind }); }
  return out.sort((a, b) => MOD_ORDER.indexOf(a.kind) - MOD_ORDER.indexOf(b.kind) || numOf(a.id) - numOf(b.id));
}
export function srcOf(src) {
  if (src === 'wheel') return { dev: 'wheel', port: '', link: '' };
  const m = typeof src === 'string' ? /^([a-z][a-z0-9]{0,15})(?:\/(lfo(?:[1-9]|10)|env[1-4]))?\.([a-z][a-z0-9]{0,7})$/.exec(src) : null;
  return m ? { dev: m[1], port: m[3], link: m[2] || '' } : null;
}
export function srcDev(t, src) {
  const q = srcOf(src), D = isObj(t) && isObj(t.dev) ? t.dev : {};
  if (!q) return null;
  if (q.dev === 'wheel') return { q, dev: null, kind: 'wheel' };
  const d = D[q.dev];
  if (!isObj(d)) return null;
  if (q.link) return d.kind === 'synth' && d.model === 'serum' && q.port === 'out' ? { q, dev: d, kind: 'link' } : null;
  if (d.kind === 'macro') return /^k[1-8]$/.test(q.port) && kindOfId(q.dev) === 'macro' ? { q, dev: d, kind: 'macro' } : null;
  return MOD_LABEL[d.kind] && d.kind !== 'wheel' && kindOfId(q.dev) === d.kind && q.port === 'out' ? { q, dev: d, kind: d.kind } : null;
}
export function perNoteOf(t, src) {
  const x = srcDev(t, src);
  if (!x) return null;
  if (x.kind === 'link') {
    const s = isObj(x.dev.vals) ? x.dev.vals.s : null, m = /^lfo(\d+)$/.exec(x.q.link);
    if (!m) return true; // (an envelope)
    const L = isObj(s) && Array.isArray(s.lfo) ? s.lfo[+m[1] - 1] : null;
    return !(isObj(L) && L.mono);
  }
  if (x.kind === 'lfo') return !(isObj(x.dev.lfo) && x.dev.lfo.mono);
  if (x.kind === 'chaos') return !(isObj(x.dev.chaos) && x.dev.chaos.mono);
  return x.kind === 'velo' || x.kind === 'note' || x.kind === 'env';
}
const wheelOn = p => isObj(p) && isObj(p.perf) && isObj(p.perf.wheel);
export function sourcesOf(t, p) {
  const out = [];
  if (wheelOn(p)) out.push({ id: 'wheel', label: MOD_LABEL.wheel, scope: 'project', kind: 'wheel', dev: 'wheel', port: '', perNote: false });
  for (const { id, dev, kind } of modDevs(t)) {
    const label = modLabelOf(id, dev);
    if (kind === 'macro') {
      const names = Array.isArray(dev.names) ? dev.names : [];
      for (let k = 1; k <= 8; k++) out.push({ id: id + '.k' + k, label: (typeof names[k - 1] === 'string' && names[k - 1]) || label + ' · ' + k, scope: 'track', kind, dev: id, port: 'k' + k, perNote: false });
    } else out.push({ id: id + '.out', label, scope: 'track', kind, dev: id, port: 'out', perNote: !!perNoteOf(t, id + '.out') });
  }
  return out;
}
export function linkSources(t) {
  const D = isObj(t) && isObj(t.dev) ? t.dev : {}, out = [];
  for (const id of Object.keys(D)) {
    const d = D[id];
    if (!isObj(d) || d.kind !== 'synth' || d.model !== 'serum') continue;
    const s = isObj(d.vals) ? d.vals.s : null, M = isObj(s) && Array.isArray(s.matrix) ? s.matrix : [], name = d.name || 'Serum';
    const used = x => M.some(r => isObj(r) && r.dst && (r.src === x || r.src === x + 'y' || r.aux === x));
    for (let l = 1; l <= 10; l++) out.push({ id: `${id}/lfo${l}.out`, label: `${name} LFO ${l}`, scope: 'track', kind: 'link', dev: id, port: 'out', link: 'lfo' + l, perNote: !!perNoteOf(t, `${id}/lfo${l}.out`), used: used('lfo' + l) });
    for (let e = 1; e <= 4; e++) out.push({ id: `${id}/env${e}.out`, label: `${name} ENV ${e}`, scope: 'track', kind: 'link', dev: id, port: 'out', link: 'env' + e, perNote: true, used: e === 1 || used('env' + e) });
  }
  return out;
}
// engine.js smTargets slots (S_*): the field a classic knob changes → the smoothed slot an sm row offsets (per-oscillator
// fields: + the oscillator index) — SLOT's numbering by field path (one table: review C13)
export const SM_SLOT = Object.freeze(Object.assign({}, SLOT_FIELD, { 'osc.lev': SLOT.OL, 'osc.on': SLOT.OL, 'osc.pw': SLOT.PW, 'osc.oct': SLOT.TU, 'osc.fine': SLOT.TU }));
const SM_PRIO = ['osc.lev', 'osc.pw', 'osc.oct', 'osc.fine', 'vcf.oct', 'vcf.res', 'vcf.env', 'vcf.envOff', 'vcf.drive', 'hpf.oct', 'hpf.res', 'dual.oct', 'dual.res', 'dual.hoct', 'dual.hres',
  'sub', 'noise', 'ring', 'ext', 'rm.depth', 'level', 'osc.on'];
// every path that differs between patches a and b, array indices kept ('osc.1.lev'); missing ≡ 0 ≡ false
function diffIdx(a, b, path = '', out = []) {
  if (isObj(a) && isObj(b)) { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffIdx(a[k], b[k], path ? path + '.' + k : k, out); return out; }
  if (isObj(a) !== isObj(b)) { out.push(path + '?'); return out; }
  if (z(a) !== z(b) && !(a !== a && b !== b)) out.push(path);
  return out;
}
const fullVals = (m, vals) => { const v = {}; for (const c of m.controls) v[c.id] = isObj(vals) && vals[c.id] !== undefined ? vals[c.id] : c.def; return v; };
// the other value a control is swept to from its live one (the far end; a selector: the next option; a toggle: flipped)
const altOf = (c, v) => (c.t === 'b' ? (v ? 0 : 1) : c.t === 's' ? (v + 1) % c.opts.length : v !== c.max ? c.max : c.min);
const normPath = f => f.replace(/\.\d+(?=\.|$)/g, '');
export function classicTarget(model, vals, ctlId) {
  const m = modelOf(model), c = m && !m.custom ? m.controls.find(x => x.id === ctlId) : null;
  if (!c) return null;
  const cls = classOf(m.id, c.id), v0 = fullVals(m, vals), p0 = patchOf(m, v0), p1 = patchOf(m, Object.assign({}, v0, { [c.id]: altOf(c, v0[c.id]) }));
  const fields = diffIdx(p0, p1), engine = p0.engine || 'analog', out = { cls, slot: -1, field: null, fields, on: true };
  if ((cls === 'sm' || cls === 'apply' || cls === 'proc') && !fields.some(x => fieldClass(normPath(x), engine) === cls)) {
    // the live patch does not move (a mixer switch off, a wave that has no PW…): the class's evidence over the factory
    // bases says what it would move — an oscillator level behind its switch: "Switch the oscillator on…"
    const ev = sweepControl(m, c).fields;
    out.fields = ev;
    out.on = !(ev.includes('osc.lev') || ev.includes('osc.on'));
    return out;
  }
  if (cls === 'sm') {
    const f = fields.filter(x => fieldClass(normPath(x), engine) === 'sm').sort((a, b) => SM_PRIO.indexOf(normPath(a)) - SM_PRIO.indexOf(normPath(b)))[0];
    if (f !== undefined) {
      const k = /^osc\.(\d)\./.exec(f), n = normPath(f);
      out.slot = SM_SLOT[n] + (k ? +k[1] : 0);
      if (k && (n === 'osc.lev' || n === 'osc.on')) out.on = !!(p0.osc && p0.osc[+k[1]] && p0.osc[+k[1]].on);
    }
  } else if (cls === 'apply' || cls === 'proc') {
    const f = fields.map(normPath).find(x => fieldClass(x, engine) === cls);
    if (f !== undefined) out.field = f;
  }
  return out;
}
const SERUM_IDS = new Set(DESTS.filter(d => !/^fx\./.test(d.id)).map(d => d.id)); // (FX ids: the Serum's own rack, dynamic)
const NOMOD = 'This knob can’t be modulated';
// (canvas 2b) the Serum filter's routing switches S A B C N (sx-ui-osc FilterPanel: f.route<X> / f2.route<X>) are plain input
// switches in Serum, not modulation targets: no NEW cable ends on them (destOk without `keep`: the drop, the marks, the
// parameter list); a row that already points there (a project, a preset) still compiles and edits (keep = true). The sources'
// filter-balance destinations (x.fbal: the routing popover's BALANCE knob, the MIX page's) stay open.
const PLAIN_SW = /^f2?\.route[A-Z]$/;
export const plainSwitch = id => typeof id === 'string' && PLAIN_SW.test(id);
// (milestone 3, IMPL-3 §2.3 nomod) a modulator module's own knobs — its body is a Serum panel on a slot host since stage 3, so
// its controls carry data-dest ids like a Serum's — are never a cable's end: Serum lets an LFO modulate another LFO's rate,
// the canvas keeps 2b's refusal (an allowed difference, told to the user)
export const NOMOD_MOD = 'A modulator’s own knobs can’t be modulated';
export function destOk(dev, id, keep) {
  const no = (why, stage = null) => ({ ok: false, why, stage }), ok = { ok: true, why: '', stage: null };
  if (!isObj(dev) || typeof id !== 'string' || !id) return no(NOMOD);
  if (MOD_LABEL[dev.kind]) return no(NOMOD_MOD);
  if (dev.kind === 'panel') { const d = rackDescs(isObj(dev.fx) ? dev.fx : dev.rack).find(x => x.id === id); return d && !d.nomod ? ok : no(NOMOD); }
  if (dev.kind !== 'synth') return no(NOMOD);
  if (dev.model !== 'serum') {
    const c = classOf(dev.model, id);
    if (c === null || c === 'struct' || c === 'none') return no(NOMOD);
    if (c === 'chunk') return no('This knob takes modulation from stage 5', '5');
    const tg = classicTarget(dev.model, dev.vals, id);
    if (tg && !tg.on) return no('Switch the oscillator on to modulate its level');
    if (!tg || (c === 'sm' ? tg.slot < 0 : tg.field === null)) return no(NOMOD); // (the live patch does not move: nothing to offset)
    return ok;
  }
  if (/^fx\./.test(id)) { const d = rackDescs(dev.fx).find(x => x.id === id); return d && !d.nomod ? ok : no(NOMOD); }
  return SERUM_IDS.has(id) ? (!keep && PLAIN_SW.test(id) ? no('That is a plain switch, not a modulation target') : ok) : no(NOMOD);
}
export function wheelTracks(p) {
  if (!wheelOn(p) || !Array.isArray(p.tracks)) return [];
  return p.tracks.filter(t => isObj(t) && Array.isArray(t.mods) && t.mods.some(r => isObj(r) && r.src === 'wheel'));
}

