// moog-core.js — the 900-series family's tables (IMPL-9 §2.2, §2.4, §2.6; lane K9). A LEAF ES module: no import at all (models.js
// imports it for m900's controls, patch-core for FAMILIES — never the reverse); no DOM / timers / storage; node-tested
// (tests/moog-core.test.mjs). Module numbers and function names are facts; every legend, law and default here is ours.
//
// FAMILY = { id 'moog', name, model 'm900', ctl 'ctl', types: { <type>: TYPE }, order (the tray), rows (Tidy, §4.5), groups,
//            set (the Model 15 set, M15), starter ('Classic bass': the Model 15 tile's), sink ('out': the controller's MAIN OUT),
//            rackW (Tidy's row width, px), plugs / conv (the wrong-plug reason's words), PRESETS }
//   iterate `order` (or ORDER_ALL), never Object.keys(types): integer-like keys ('902', '921' …) enumerate first, ascending.
// TYPE = { id, name, short, tile, mu, face 'module' | 'console', layout, w, h (module px: ceil32(face) × ceil32(BAR_H + face), §2.2),
//          params: [K | S] (≤ 16, the face's live controls; the stored value is the dial position, §2.3),
//          jacks: [{ id, dir 'in' | 'out' | 'any', sig 'v' (1/4") | 's' (S-trigger), role 'au' | 'cv' | 'tr' (a hint only), label,
//                    sec 0…7, norm?: <input id> (unpatched → that jack's signal), ac?: 1 (AC-coupled) }],
//          secs: [section names] (sec n = secs[n]: a section's outputs depend on its own inputs only — the schedule's nodes, §3.3),
//          link?: { to: <type>, max } (a rear connector: the 921B's driver, a schedule edge), group 'src' | 'mod' | 'ctl',
//          cost (load at OS 4, V8: spike (a)'s figures, V9b re-measures) }
//   Jack order = the port index in the payload (§3.2) = PatchMoog.JACKS[type] = panels/m900.js's `port`s (tests compare).
//   A multiple group = the `dir: 'any'` jacks of one section (the controller's MULT A / MULT B).
// The controller (module `c`, type 'ctl', §2.4): its params are m900's flat vals — CTL_SECTIONS (models.js m900.sections),
//   CTL_IDS their order (pv['0'], §3.2); pvOf(vals) builds the engine's pv.
// LAW: the display laws the faces' fmt shows (moog-dsp.js uses the same: 911 times, E SUS, 923 corners, GLIDE).
// PRESETS (§2.5, ours): { name, about, mods: [[role, type], …] (roles bind, in this order, to the lowest-numbered module of the
//   type not yet bound — added when the patch has none), drv: { role: driver role } (a linked role absent here plays undriven),
//   cords: [['<role>.<port>' | 'c.<port>' (source), … (destination)], …], v: { c: { flat controller ids }, role: { param ids } }
//   (a bound module's params and the controller's not named here load at their defaults: a preset is a whole sound) }.
//   patch-core.loadPreset applies one; model15(vals) = the Model 15 set patched as Classic bass on a fresh record (= loadPreset(
//   fresh, vals, 'Classic bass', { ensure: M15 }): tests/patch-core.test.mjs compares the two).

/* ---------------------------------------------------------------- helpers (own K / S: models.js's are not exported) */
const K = (id, label, min, max, def, o) => Object.assign({ t: 'k', id, label, min, max, def }, o);
const S = (id, label, opts, def, o) => Object.assign({ t: 's', id, label, opts, def: def || 0 }, o);
const J = (id, dir, sig, role, label, o) => Object.assign({ id, dir, sig, role, label, sec: 0 }, o);
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; };
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));

const fmtT = s => s < 1 ? (s * 1000).toFixed(s < 0.01 ? 1 : 0) + ' ms' : s.toFixed(2) + ' s';
const fmtHz = f => f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2) + ' kHz' : f.toFixed(f < 100 ? 1 : 0) + ' Hz';
const sg = (v, d) => (v > 0 ? '+' : '') + (+v).toFixed(d);
const DIAL = { fmt: v => sg(v, 2) };                                   // FREQUENCY −6…+6: the dial (its span is the DSP's, §2.2)
const VOLT = { fmt: v => sg(v, 2) + ' V' };                            // FIXED CONTROL VOLTAGE −6…+6 V
const PCT = { fmt: v => Math.round(v) + '%' };
const TEN = { fmt: v => (+v).toFixed(1) };

/** Display laws [C on R RM §3.2, §3.4]: 911 T1 / T2 / T3 2 ms … 10 s exponential, E SUS 0 … Emax 5.5 V, 923 corners 10 Hz … 10 kHz
 *  exponential, GLIDE off below 0.05 then 5 ms … 5 s exponential (the slew's time constant). */
export const LAW = Object.freeze({
  t911: v => 0.002 * Math.pow(5000, v / 10),
  es911: v => 0.55 * v,
  rc923: v => 10 * Math.pow(1000, v / 10),
  glide: v => v > 0.05 ? 0.005 * Math.pow(1000, v / 10) : 0,
});
const F_T = { fmt: v => fmtT(LAW.t911(v)) }, F_ES = { fmt: v => LAW.es911(v).toFixed(2) + ' V' }, F_RC = { fmt: v => fmtHz(LAW.rc923(v)) };
const GLIDE = { fmt: v => v > 0.05 ? fmtT(LAW.glide(v)) : 'off' };
const CENTS = { fmt: v => sg(Math.round(v), 0) + ' ct' };
const MIXL = { fmt: v => '×' + (v / 5).toFixed(2) };                   // MIXER LEVEL 0…10 → 0 … ×2

/* ---------------------------------------------------------------- sizes (§2.2) */
export const MU_MM = 53.975, FACE_H_MM = 222.25, CONSOLE_H_MM = 142.875, PX_PER_MM = 2, BAR_H = 40;   // = cv-panel PX_PER_MM, cv-module BAR_H
const c32 = x => Math.ceil(x / 32 - 1e-9) * 32;
/** Module px of a panel in mm (the 1b+ rule, cv-panel sizeOf): 1 MU → 128 × 512, 2 → 224 × 512, 3 → 352 × 512, the console 864 × 352. */
export const sizeOf = (wmm, hmm) => [c32(wmm * PX_PER_MM), c32(BAR_H + hmm * PX_PER_MM)];

/* ---------------------------------------------------------------- the controller's controls (§2.4; m900's flat vals) */
export const CTL_SECTIONS = deepFreeze([
  { title: 'Keyboard', c: [
    K('gl', 'Glide', 0, 10, 0, GLIDE),
    S('pr', 'Priority', ['Low', 'Last'], 0),                           // Q1: the lowest key sounds
    S('rt', 'Trigger', ['Single', 'Multiple'], 0),                     // SINGLE: legato (S-trig held while any key is down)
    K('tu', 'Tune', -50, 50, 0, CENTS),
  ] },
  { title: 'Mixer', c: range(4, i => K('x' + i, 'Level ' + i, 0, 10, 7, MIXL)) },
  { title: 'Output', c: [K('ov', 'Output', 0, 10, 7, TEN)] },          // MAIN OUT × ov / 10
]);
export const CTL_IDS = Object.freeze(CTL_SECTIONS.flatMap(s => s.c.map(c => c.id)));   // gl pr rt tu x1 x2 x3 x4 ov

/* ---------------------------------------------------------------- the module types (§2.2) */
const FEET921 = ['32\'', '16\'', '8\'', '4\'', '2\'', '1\''];
const FEET921B = ['LO', '32\'', '16\'', '8\'', '4\'', '2\''];
const SCALE = ['±12 st', '±6 oct'];
const OUTS4 = [J('sin', 'out', 'v', 'au', 'SINE OUT'), J('tri', 'out', 'v', 'au', 'TRIANGLE OUT'), J('saw', 'out', 'v', 'au', 'SAWTOOTH OUT'),
  J('rec', 'out', 'v', 'au', 'RECTANGULAR OUT')];
const FCI = range(3, i => J('f' + i, 'in', 'v', 'cv', 'FREQUENCY CONTROL INPUT ' + i));
const WCI = range(2, i => J('w' + i, 'in', 'v', 'cv', 'WIDTH CONTROL IN ' + i));
const CI = range(3, i => J('c' + i, 'in', 'v', 'cv', 'CONTROL INPUT ' + i));
const mod = (id, name, tile, mu, group, cost, params, jacks, o) => {
  const [w, h] = sizeOf(mu * MU_MM, FACE_H_MM);
  return Object.assign({ id, name, short: id.toUpperCase(), tile, mu, face: 'module', layout: id, w, h, params, jacks, secs: ['main'], group, cost }, o);
};

const T921 = mod('921', '921 Oscillator', '921 Oscillator', 2, 'src', 0.003, [
  S('sp', 'Scale', SCALE, 0),                                          // FREQUENCY spans ±1 oct (0) or ±6 oct (1)
  S('cr', 'Coarse Range', ['Sub-audio', 'Audio'], 1),
  K('fq', 'Frequency', -6, 6, 0, DIAL),
  S('rg', 'Range', FEET921, 2),                                        // 8'
  K('pw', 'Rectangular Width', 10, 90, 50, PCT),
  S('ax', 'Aux. Out Waveform', ['Sine', 'Triangle', 'Sawtooth', '−Sawtooth', 'Rectangular', '−Rectangular'], 2),
  K('cl', 'Clamping Point', 0, 100, 0, PCT),
  K('al', 'Aux. Out Level', 0, 10, 5, TEN),
], [...FCI, ...WCI, J('cv', 'in', 'v', 'tr', 'CLAMP TRIG. V'), J('cs', 'in', 's', 'tr', 'CLAMP TRIG. S'),
  J('xm', 'out', 'v', 'cv', 'AUXILIARY OUTPUT −'), J('xp', 'out', 'v', 'cv', 'AUXILIARY OUTPUT +'), ...OUTS4]);

const T921A = mod('921a', '921A Oscillator Driver', '921A Driver', 1, 'src', 0.0004, [
  S('sp', 'Scale', SCALE, 0),
  K('fq', 'Frequency', -6, 6, 0, DIAL),
  K('pw', 'Rectangular Width', 10, 90, 50, PCT),
], [...FCI, ...WCI]);                                                  // no front output: it drives ≤ 3 921Bs over the rear link

const T921B = mod('921b', '921B Oscillator', '921B Oscillator', 1, 'src', 0.0023, [
  S('rg', 'Range', FEET921B, 3),                                       // 8'
  K('fq', 'Frequency', -6, 6, 0, DIAL),                                // ±1 oct
  S('ss', 'Sync', ['Weak', 'Off', 'Strong'], 1),
], [J('dc', 'in', 'v', 'cv', 'DC MODULATE'), J('ac', 'in', 'v', 'cv', 'AC MODULATE', { ac: 1 }), J('sy', 'in', 'v', 'au', 'SYNC IN'), ...OUTS4],
{ link: { to: '921a', max: 3 } });

const T923 = mod('923', '923 Noise + Filters', '923 Noise', 1, 'src', 0.001, [
  K('lp', 'Low Pass', 0, 10, 5, F_RC),
  K('hp', 'High Pass', 0, 10, 5, F_RC),
], [J('wh1', 'out', 'v', 'au', 'WHITE 1'), J('wh2', 'out', 'v', 'au', 'WHITE 2'), J('pk', 'out', 'v', 'au', 'PINK'),
  J('li', 'in', 'v', 'au', 'LOW PASS IN', { sec: 1 }), J('lo', 'out', 'v', 'au', 'LOW PASS OUT', { sec: 1 }),
  J('hi', 'in', 'v', 'au', 'HIGH PASS IN', { sec: 2 }), J('ho', 'out', 'v', 'au', 'HIGH PASS OUT', { sec: 2 })],
{ secs: ['noise', 'lp', 'hp'] });

const T904A = mod('904a', '904A Low Pass Filter', '904A Low-pass', 1, 'mod', 0.0055, [
  K('fc', 'Fixed Control Voltage', -6, 6, 0, VOLT),
  S('rg', 'Frequency Range', ['1', '2', '3'], 1),
  K('re', 'Regeneration', 0, 10, 0, TEN),
], [J('in', 'in', 'v', 'au', 'SIGNAL INPUT'), ...CI, J('out', 'out', 'v', 'au', 'SIGNAL OUTPUT')]);

const BANDS = ['250 Hz', '350 Hz', '500 Hz', '700 Hz', '1 kHz', '1.4 kHz', '2 kHz', '2.8 kHz'];
const T907A = mod('907a', '907A Fixed Filter Bank', '907A Filter bank', 3, 'mod', 0.0078, [
  K('lo', 'Low', 0, 10, 10, TEN), ...BANDS.map((b, i) => K('b' + (i + 1), b, 0, 10, 10, TEN)), K('hi', 'High', 0, 10, 10, TEN),
], [J('in', 'in', 'v', 'au', 'SIGNAL INPUT'), J('out', 'out', 'v', 'au', 'SIGNAL OUTPUT')]);

const T911 = mod('911', '911 Envelope Generator', '911 Envelope', 1, 'ctl', 0.0005, [
  K('t1', 'T1', 0, 10, 1, F_T),                                        // ≈ 5 ms
  K('t2', 'T2', 0, 10, 5, F_T),                                        // ≈ 141 ms
  K('t3', 'T3', 0, 10, 4, F_T),                                        // ≈ 61 ms
  K('es', 'E Sus', 0, 10, 7, F_ES),                                    // 3.85 V
], [J('trg', 'in', 's', 'tr', 'TRIGGER'), J('out', 'out', 'v', 'cv', 'OUTPUT')]);

const T902 = mod('902', '902 Amplifier', '902 Amplifier', 1, 'mod', 0.0008, [
  S('md', 'Control Mode', ['Lin', 'Exp'], 0),
  K('fc', 'Fixed Control Voltage', -6, 6, 0, VOLT),                    // 0 V in LIN: closed
], [J('i1', 'in', 'v', 'au', 'SIGNAL INPUT UPPER'), J('i2', 'in', 'v', 'au', 'SIGNAL INPUT LOWER'),
  J('o1', 'out', 'v', 'au', 'SIGNAL OUTPUT UPPER'), J('o2', 'out', 'v', 'au', 'SIGNAL OUTPUT LOWER'), ...CI]);

const T995 = mod('995', '995 Attenuators', '995 Attenuators', 1, 'ctl', 0.0006,
  range(3, i => K('a' + i, 'Attenuator ' + i, 0, 10, 0, TEN)),
  range(3, i => [J('i' + i, 'in', 'v', 'cv', 'ATTENUATOR ' + i + ' IN', Object.assign({ sec: i - 1 }, i > 1 ? { norm: 'i' + (i - 1) } : {})),
    J('o' + i, 'out', 'v', 'cv', 'ATTENUATOR ' + i + ' OUT', { sec: i - 1 })]).flat(),
  { secs: ['1', '2', '3'] });

// the controller (ours, §2.4): 27 jacks in seven sections — KBD (the keyboard and performance outputs only) · MIX · MULT A ·
// MULT B · V→S · S→V · OUT (MAIN OUT, the sink)
const [CW, CH] = sizeOf(8 * MU_MM, CONSOLE_H_MM);
const TCTL = {
  id: 'ctl', name: 'Controller', short: 'CONTROLLER', tile: 'Controller', mu: 8, face: 'console', layout: 'm900', w: CW, h: CH,
  params: CTL_SECTIONS.flatMap(s => s.c),
  jacks: [
    J('kp1', 'out', 'v', 'cv', 'PITCH 1'), J('kp2', 'out', 'v', 'cv', 'PITCH 2'),
    J('ks1', 'out', 's', 'tr', 'S-TRIG 1'), J('ks2', 'out', 's', 'tr', 'S-TRIG 2'),
    J('kg', 'out', 'v', 'tr', 'GATE'), J('kv', 'out', 'v', 'cv', 'VELOCITY'), J('kw', 'out', 'v', 'cv', 'WHEEL'), J('ka', 'out', 'v', 'cv', 'PRESSURE'),
    ...range(4, i => J('m' + i, 'in', 'v', 'au', 'MIXER INPUT ' + i, { sec: 1 })),
    J('mo', 'out', 'v', 'au', 'MIX +', { sec: 1 }), J('mn', 'out', 'v', 'au', 'MIX −', { sec: 1 }),
    ...range(4, i => J('a' + i, 'any', 'v', 'cv', 'MULTIPLE A ' + i, { sec: 2 })),
    ...range(4, i => J('b' + i, 'any', 'v', 'cv', 'MULTIPLE B ' + i, { sec: 3 })),
    J('vi', 'in', 'v', 'tr', 'GATE IN', { sec: 4 }), J('vo', 'out', 's', 'tr', 'S-TRIG OUT', { sec: 4 }),
    J('si', 'in', 's', 'tr', 'S-TRIG IN', { sec: 5 }), J('so', 'out', 'v', 'tr', 'GATE OUT', { sec: 5 }),
    J('out', 'in', 'v', 'au', 'MAIN OUT', { sec: 6 }),
  ],
  secs: ['kbd', 'mix', 'multA', 'multB', 'v2s', 's2v', 'out'], group: 'ctl', cost: 0.0005,
};

export const GROUPS = Object.freeze({ src: 'Sources', mod: 'Modifiers', ctl: 'Control' });
/** The tray's order (§4.6: Sources, Modifiers, Control); the controller is no tile. */
export const ORDER = Object.freeze(['921', '921a', '921b', '923', '904a', '907a', '902', '911', '995']);
/** Every type, the controller first. */
export const ORDER_ALL = Object.freeze(['ctl', ...ORDER]);
/** Tidy's rows above the controller (§4.5): row 1 sources at dy −1 024, row 2 modifiers at dy −512. */
export const ROWS = Object.freeze([Object.freeze(['921', '921a', '921b', '923', '995']), Object.freeze(['904a', '907a', '911', '902'])]);
export const TYPES = deepFreeze({ ctl: TCTL, 921: T921, '921a': T921A, '921b': T921B, 923: T923, '904a': T904A, '907a': T907A,
  911: T911, 902: T902, 995: T995 });

/* ---------------------------------------------------------------- the Model 15 set and the starting patches (§2.5, ours) */
/** The Model 15 set (RM §2.1), in its numbering order (Tidy's rows, sources first): 921, 921A, 921B × 2, 923, 995, 904A, 907A,
 *  911 × 2, 902 × 2 — with the controller, 97 jacks. */
export const M15 = Object.freeze(['921', '921a', '921b', '921b', '923', '995', '904a', '907a', '911', '911', '902', '902']);
// (a 921B's fq is ±1 oct over its ±6: 6 · semitones / 12; the 921's with SCALE ±12 st likewise; 911 times: LAW.t911)
export const PRESETS = deepFreeze([
  { name: 'Classic bass', about: 'Two driven 921Bs (8′ and 4′) and a 921 an octave below them, mixed into the 904A — its cutoff from the first 911 and half the keyboard, the 902 opened by the second 911',
    mods: [['d', '921a'], ['o1', '921b'], ['o2', '921b'], ['o3', '921'], ['at', '995'], ['f', '904a'], ['e1', '911'], ['e2', '911'], ['a', '902']],
    drv: { o1: 'd', o2: 'd' },
    cords: [['c.kp1', 'd.f1'], ['c.kp2', 'c.a1'], ['c.a2', 'o3.f1'], ['c.a3', 'at.i1'], ['at.o1', 'f.c2'],
      ['o1.saw', 'c.m1'], ['o2.rec', 'c.m2'], ['o3.saw', 'c.m3'], ['c.mo', 'f.in'], ['f.out', 'a.i1'], ['a.o2', 'c.out'],
      ['c.ks1', 'e1.trg'], ['e1.out', 'f.c1'], ['c.ks2', 'e2.trg'], ['e2.out', 'a.c1']],
    v: { c: { x1: 5, x2: 5, x3: 5 }, o1: { rg: 3 }, o2: { rg: 4, fq: 0.02 }, o3: { rg: 1 }, at: { a1: 5 }, f: { fc: -0.5, re: 3 },
      e1: { t1: 0.5, t2: 4.5, es: 2, t3: 3 }, e2: { t1: 0.5, t2: 6, es: 8, t3: 3.5 } } },
  { name: 'Filter sweep', about: 'Two detuned 921B saws through a resonant 904A, swept by a 921 at sub-audio rate; a 911 opens the 902',
    mods: [['d', '921a'], ['o1', '921b'], ['o2', '921b'], ['lfo', '921'], ['f', '904a'], ['e', '911'], ['a', '902']],
    drv: { o1: 'd', o2: 'd' },
    cords: [['c.kp1', 'd.f1'], ['o1.saw', 'c.m1'], ['o2.saw', 'c.m2'], ['c.mo', 'f.in'], ['lfo.xp', 'f.c2'], ['f.out', 'a.i1'],
      ['a.o2', 'c.out'], ['c.ks1', 'e.trg'], ['e.out', 'a.c1']],
    v: { c: { x1: 10, x2: 10, ov: 9 }, o1: { rg: 3 }, o2: { rg: 3, fq: 0.04 }, lfo: { cr: 0, rg: 2, fq: -2, ax: 1, al: 5 }, f: { fc: 1.5, re: 6 },
      e: { t1: 1, t2: 5, es: 10, t3: 4 } } },
  { name: 'Drone', about: 'Three free-running oscillators in fifths and low pink noise through the 907A — no keyboard: it plays until switched off',
    mods: [['o1', '921'], ['o2', '921b'], ['o3', '921b'], ['n', '923'], ['fb', '907a'], ['a', '902']],
    drv: {},
    cords: [['o1.saw', 'c.m1'], ['o2.saw', 'c.m2'], ['o3.saw', 'c.m3'], ['n.pk', 'n.li'], ['n.lo', 'c.m4'], ['c.mo', 'fb.in'],
      ['fb.out', 'a.i1'], ['a.o2', 'c.out']],
    v: { c: { x1: 8, x2: 8, x3: 8, x4: 6 }, o1: { rg: 1 }, o2: { rg: 2, fq: 3.5 }, o3: { rg: 3, fq: 1.01 }, n: { lp: 4 },
      fb: { lo: 6, b1: 8, b2: 10, b3: 7, b4: 5, b5: 6, b6: 4, b7: 3, b8: 2, hi: 1 }, a: { fc: 6 } } },
  { name: 'Sync lead', about: 'A 921B hard-synced to its partner, its pitch swept up by the first 911 at each note; last-key priority and a little glide',
    mods: [['d', '921a'], ['o1', '921b'], ['o2', '921b'], ['e1', '911'], ['e2', '911'], ['a', '902']],
    drv: { o1: 'd', o2: 'd' },
    cords: [['c.kp1', 'd.f1'], ['o1.saw', 'o2.sy'], ['o2.saw', 'c.m1'], ['o1.rec', 'c.m2'], ['c.ks1', 'e1.trg'], ['e1.out', 'o2.dc'],
      ['c.ks2', 'e2.trg'], ['e2.out', 'a.c1'], ['c.mo', 'a.i1'], ['a.o2', 'c.out']],
    v: { c: { pr: 1, gl: 2, x1: 8, x2: 3 }, o1: { rg: 3 }, o2: { rg: 3, fq: 3, ss: 2 }, e1: { t1: 0.5, t2: 6, es: 3, t3: 5 },
      e2: { t1: 0.5, t2: 5, es: 8, t3: 4.5 } } },
  { name: 'Wind', about: 'White noise through the 904A just under its whistle, its cutoff wandering with a slow 921 through the 995, over a bed of low-passed pink noise',
    mods: [['n', '923'], ['f', '904a'], ['lfo', '921'], ['at', '995'], ['a', '902']],
    drv: {},
    cords: [['n.wh1', 'f.in'], ['lfo.xp', 'at.i1'], ['at.o1', 'f.c1'], ['f.out', 'c.m1'], ['n.pk', 'n.li'], ['n.lo', 'c.m2'], ['c.mo', 'a.i1'],
      ['a.o2', 'c.out']],
    v: { c: { x1: 10, x2: 3, ov: 9 }, n: { lp: 4 }, f: { fc: 2.5, re: 9 }, lfo: { cr: 0, rg: 2, fq: 2, ax: 0, al: 6 }, at: { a1: 6 }, a: { fc: 6 } } },
  { name: 'Bells', about: 'Two 921B sines at 1 : 3.5 through three raised bands of the 907A, struck by a fast 911 on the 902 — each strike rings about 1.5 s to −40 dB, held or not',
    mods: [['d', '921a'], ['o1', '921b'], ['o2', '921b'], ['fb', '907a'], ['e', '911'], ['a', '902']],
    drv: { o1: 'd', o2: 'd' },
    cords: [['c.kp1', 'd.f1'], ['o1.sin', 'c.m1'], ['o2.sin', 'c.m2'], ['c.mo', 'fb.in'], ['fb.out', 'a.i1'], ['a.o2', 'c.out'],
      ['c.ks1', 'e.trg'], ['e.out', 'a.c1']],
    v: { c: { x1: 9, x2: 5 }, o1: { rg: 3 }, o2: { rg: 4, fq: 4.844 }, fb: { lo: 3, b1: 3, b2: 10, b3: 3, b4: 3, b5: 10, b6: 3, b7: 10, b8: 3, hi: 3 },
      e: { t1: 0, t2: 7.6, es: 0, t3: 7.6 }, a: { md: 0, fc: 0 } } },
]);

/** The family record patch-core registers (§2.6). */
export const FAMILY = Object.freeze({
  id: 'moog', name: '900 Series', model: 'm900', ctl: 'ctl', types: TYPES, order: ORDER, rows: ROWS, groups: GROUPS,
  set: M15, starter: 'Classic bass', sink: 'out', rackW: 1024,
  plugs: Object.freeze({ v: 'A 1/4" jack', s: 'An S-trigger socket' }), conv: 'use the controller’s trigger converter', PRESETS,
});

const pval = (c, x) => typeof x === 'number' && isFinite(x) ? (c.t === 's' ? Math.max(0, Math.min(c.opts.length - 1, Math.round(x))) : Math.max(c.min, Math.min(c.max, x))) : c.def;
/** The Model 15 set patched as Classic bass on a fresh record (§1.4: the Model 15 tile, a new 900 Series from the instrument menu,
 *  `#m900`, Add track) → { rec, vals }: modules numbered past every `m<k>` of vals.p (§1.5), in M15's order, a 921B driven by the
 *  first 921A with room; the preset's roles bound, its cords c1… coloured by the least-used rule (i % 8 from none); vals = vals +
 *  the controller's and every bound module's values (the preset's, else the defaults). Pure. */
export function model15(vals) {
  const v0 = vals && typeof vals === 'object' && !Array.isArray(vals) ? vals : {};
  const p0 = v0.p && typeof v0.p === 'object' && !Array.isArray(v0.p) ? v0.p : {};
  let n = 1;
  for (const k of Object.keys(p0)) { const m = /^m([1-9]\d{0,3})$/.exec(k); if (m && +m[1] < 4096) n = Math.max(n, +m[1] + 1); }
  const P = PRESETS.find(x => x.name === FAMILY.starter), mods = {}, of = {}, bound = {}, taken = {};
  for (const t of M15) {
    const mid = 'm' + n++, o = { t }, L = TYPES[t].link;
    if (L) { const d = (of[L.to] || []).find(k => Object.keys(mods).filter(j => mods[j].drv === k).length < L.max); if (d) o.drv = d; }
    mods[mid] = o; (of[t] = of[t] || []).push(mid);
  }
  for (const [role, t] of P.mods) { bound[role] = of[t][taken[t] || 0]; taken[t] = (taken[t] || 0) + 1; }
  for (const [role, t] of P.mods) if (TYPES[t].link) { const o = Object.assign({}, mods[bound[role]]); if (P.drv[role]) o.drv = bound[P.drv[role]]; else delete o.drv; mods[bound[role]] = o; }
  const end = e => { const [r, port] = e.split('.'); return (r === 'c' ? 'c' : bound[r]) + '.' + port; };
  const cords = P.cords.map(([a, b], i) => ({ id: 'c' + (i + 1), a: end(a), b: end(b), c: i % 8 }));
  const nv = Object.assign({}, v0), np = Object.assign({}, p0), pc = P.v.c || {};
  for (const c of TCTL.params) nv[c.id] = pval(c, pc[c.id]);
  for (const [role, t] of P.mods) { const e = { _t: t }, pv = P.v[role] || {}; for (const c of TYPES[t].params) e[c.id] = pval(c, pv[c.id]); np[bound[role]] = e; }
  nv.p = np;
  return { rec: { v: 1, f: FAMILY.id, nid: n, mods, cid: cords.length + 1, cords, name: P.name }, vals: nv };
}

/** models.js m900.map's pv (§3.2): { '0': the controller's values in CTL_IDS order (its default when absent), 'm<k>': vals.p's
 *  entries as they are (`_t` and ids: the machine binds them) }. Pure; reads `vals` only (map never sees dev.patch). */
export function pvOf(vals) {
  const o = vals && typeof vals === 'object' ? vals : {}, pv = { 0: [] }, p = o.p;
  for (const c of TCTL.params) { const x = o[c.id]; pv[0].push(typeof x === 'number' && isFinite(x) ? x : c.def); }
  if (p && typeof p === 'object' && !Array.isArray(p)) for (const k of Object.keys(p)) if (/^m\d{1,4}$/.test(k) && p[k] && typeof p[k] === 'object') pv[k] = p[k];
  return pv;
}
