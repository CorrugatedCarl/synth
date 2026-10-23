// moog-core.js — the 900-series family's tables (IMPL-9 §2.2, §2.4, §2.6; lane K9). A LEAF ES module: no import at all (models.js
// imports it for m900's controls, patch-core for FAMILIES — never the reverse); no DOM / timers / storage; node-tested
// (tests/moog-core.test.mjs). Module numbers and function names are facts; every legend, law and default here is ours.
//
// FAMILY = { id 'moog', name, model 'm900', ctl 'ctl', types: { <type>: TYPE }, order (the tray), rows (Tidy's cabinet rows, §4.5),
//            groups, set (the Model 15 set, M15), starter ('Classic bass': the Model 15 tile's), sink ('out': the controller's MAIN
//            OUT), rackW (Tidy's row width, px), plugs / conv (the wrong-plug reason's words), PRESETS,
//            console (IMPL-9b §4.4: the console-height types' Tidy row, flush above the controller), sets ({ <id>: { name, set,
//            starter } }: m15 = set / starter above, s35, s55 — IMPL-9b §1.2), rackWide (Tidy's width past rackN modules or with a
//            console module: a 22 MU cabinet row) }
//   iterate `order` (or ORDER_ALL), never Object.keys(types): integer-like keys ('902', '921' …) enumerate first, ascending.
// TYPE = { id, name, short, tile, mu, face 'module' (5U) | 'console' (console height: the controller, the CP panels, the 961, the
//          Song clock — the controller is `ctl`, not "the console face"), layout, w, h (module px: ceil32(face) × ceil32(BAR_H +
//          face), §2.2), params: [K | S] (0 … 48, the face's live controls; the stored value is the dial position, §2.3),
//          jacks: [{ id, dir 'in' | 'out' | 'any', sig 'v' (1/4") | 's' (S-trigger), role 'au' | 'cv' | 'tr' (a hint only), label,
//                    sec 0…15, norm?: <jack id> (unpatched → that jack's signal: an input, or an output of another section),
//                    ac?: 1 (AC-coupled), rear?: 1 (IMPL-9b §1.3: an edge-connector terminal — a payload port, never on a face,
//                    never a cord's end; reached by bus rows only) }],
//          secs: [section names] (sec n = secs[n]: a section's outputs depend on its own inputs only — the schedule's nodes, §3.3),
//          link?: { to: <type>, max } (a rear connector: the 921B's driver, a schedule edge), group 'src' | 'mod' | 'ctl' | 'seq' | 'cp',
//          cost (load at OS 4, V8: spike (a) / (a2)'s figures, V9b / V9c re-measure),
//          bus?: [{ sw: [switch param ids] (all on → a connection; [] = always), a, b, g? }] (IMPL-9b §1.4: a routing switch's
//                hidden connection, resolved from vals by patch-core; an end = 'c.<port>' (the controller) · '.<port>' (this
//                panel's own jack) · '<t>|<t>…#<k>.<port>' (the k-th module by number of the listed types, in list order) ·
//                '<t>…#=.<port>' (k = this panel's ordinal among its type); a an output, b an input, one plug, never normalled),
//          ev?: [{ id, label }] (IMPL-9b §1.5: momentary buttons — no value; the engine's event k = the index),
//          lamps?: [{ id, label }] (IMPL-9b §1.6: engine state; bit i of the module's lamp word = lamp i) }
//   Jack order = the port index in the payload (§3.2) = PatchMoog.JACKS[type] = the faces' `port`s (tests compare; rear jacks
//   are in the order, never placed). A multiple group = the `dir: 'any'` jacks of one section (MULT A / B, the 994, CP panels).
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
  // (9b, IMPL-9b §2.2–§2.3, §3.4) — the same laws in moog-dsp
  f904b: rg => rg ? 4 * Math.pow(2, 1.5) : 4,                           // 904B f₀ (Hz): f_c = f₀ · 2^(fc + 6 + ΣV), HIGH = LOW + 1½ oct
  f914: k => 125 * Math.pow(2, k / 2),                                  // 914 band k (0…11) centre: 125 Hz · √2^k (… 5 657 Hz)
  d911a: v => 0.002 * Math.pow(1000, v / 10),                           // 911A DELAY: 2 ms … 2 s
  clk960: (rg, vn) => 0.1 * Math.pow(4, rg) * Math.pow(4, vn / 10),     // 960 clock at 0 V (× 2^V; clamped 0.1 … 1 000 Hz)
  row960: (v, g) => v / 10 * 2 * Math.pow(2, g),                        // 960 row volts: the dial × range ×1 / ×2 / ×4 → 2 / 4 / 8 V at 10
  on961: v => 0.04 * Math.pow(100, v / 10),                             // 961 SWITCH ON TIME: 40 ms … 4 s
  th961: v => 5 * Math.pow(0.01, v / 10),                               // 961 SENSITIVITY: the comparator's θ 5 V … 50 mV (off below θ / 2)
  ticks: dv => [960, 480, 240, 120, 320, 160][dv],                      // Song clock STEP (1/4 1/8 1/16 1/32 1/8T 1/16T) in song ticks (PPQ 960)
});
const F_T = { fmt: v => fmtT(LAW.t911(v)) }, F_ES = { fmt: v => LAW.es911(v).toFixed(2) + ' V' }, F_RC = { fmt: v => fmtHz(LAW.rc923(v)) };
const GLIDE = { fmt: v => v > 0.05 ? fmtT(LAW.glide(v)) : 'off' };
const CENTS = { fmt: v => sg(Math.round(v), 0) + ' ct' };
const MIXL = { fmt: v => '×' + (v / 5).toFixed(2) };                   // MIXER LEVEL 0…10 → 0 … ×2
const F_D = { fmt: v => fmtT(LAW.d911a(v)) }, F_ON = { fmt: v => fmtT(LAW.on961(v)) }, F_TH = { fmt: v => LAW.th961(v).toFixed(2) + ' V' };
const F_VN = { fmt: v => '×' + Math.pow(4, v / 10).toFixed(2) };       // 960 VERNIER: the clock × 1 … 4 (one RANGE step)

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
const typ = (face, id, name, tile, mu, group, cost, params, jacks, o) => {
  const [w, h] = sizeOf(mu * MU_MM, face === 'console' ? CONSOLE_H_MM : FACE_H_MM);
  return Object.assign({ id, name, short: id.toUpperCase(), tile, mu, face, layout: id, w, h, params, jacks, secs: ['main'], group, cost }, o);
};
const mod = (...a) => typ('module', ...a), con = (...a) => typ('console', ...a);     // a 5U module · a console-height panel (IMPL-9b §2.3)

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

/* ---------------------------------------------------------------- the System 35 / 55 types (IMPL-9b §2.2–§2.4) */
// laws and behaviour in IMPL-9b §2 / §3.3–§3.4 (moog-dsp holds them); costs are spike (a2)'s V8 figures (V9c re-measures)
const E = (id, label) => ({ id, label });                              // an event button / a lamp
const OO = ['Off', 'On'], KWP = ['Keyboard', 'Wheel', 'Pressure'], KWPJ = ['c.kp1', 'c.kw', 'c.ka'];   // the routing switches' sources
const ROW = ['A', 'B', 'C'];

const T904B = mod('904b', '904B High Pass Filter', '904B High-pass', 1, 'mod', 0.0021, [
  K('fc', 'Fixed Control Voltage', -6, 6, 0, VOLT),
  S('rg', 'Frequency Range', ['Low', 'High'], 0),                      // HIGH = LOW + 1½ oct (LAW.f904b)
], [J('in', 'in', 'v', 'au', 'SIGNAL INPUT'), ...CI, J('out', 'out', 'v', 'au', 'SIGNAL OUTPUT')]);   // the 904A's order; no regeneration

const BANDS14 = ['125 Hz', '175 Hz', '250 Hz', '350 Hz', '500 Hz', '700 Hz', '1 kHz', '1.4 kHz', '2 kHz', '2.8 kHz', '4 kHz', '5.6 kHz'];
const T914 = mod('914', '914 Fixed Filter Bank', '914 Filter bank', 4, 'mod', 0.0065, [
  K('lo', 'Low', 0, 10, 10, TEN), ...BANDS14.map((b, i) => K('b' + (i + 1), b, 0, 10, 10, TEN)), K('hi', 'High', 0, 10, 10, TEN),
], [J('i1', 'in', 'v', 'au', 'SIGNAL INPUT 1'), J('i2', 'in', 'v', 'au', 'SIGNAL INPUT 2'),          // both patched: averaged
  J('o1', 'out', 'v', 'au', 'SIGNAL OUTPUT 1'), J('o2', 'out', 'v', 'au', 'SIGNAL OUTPUT 2')]);      // one buffer

const T911A = mod('911a', '911A Dual Trigger Delay', '911A Trigger delay', 1, 'ctl', 0.0004, [
  K('d1', 'Delay 1', 0, 10, 3, F_D), K('d2', 'Delay 2', 0, 10, 3, F_D),  // 3 ≈ 16 ms
  S('md', 'Mode', ['Off', 'Parallel', 'Series'], 0),                    // PARALLEL: INPUT 1 starts both · SERIES: OUTPUT 1 starts delay 2
], [J('i1', 'in', 's', 'tr', 'INPUT 1'), J('o1', 'out', 's', 'tr', 'OUTPUT 1'), J('i2', 'in', 's', 'tr', 'INPUT 2'), J('o2', 'out', 's', 'tr', 'OUTPUT 2')]);

const T903A = mod('903a', '903A Random Signal', '903A Random signal', 1, 'src', 0.0004, [],
  [J('wh1', 'out', 'v', 'au', 'WHITE 1'), J('wh2', 'out', 'v', 'au', 'WHITE 2'), J('pk1', 'out', 'v', 'au', 'PINK 1'), J('pk2', 'out', 'v', 'au', 'PINK 2')]);

// the 960 (§3.4): three rows of eight stage knobs, the stages' modes, the row ranges, the clock (RANGE × VERNIER, 1 V/oct), one section
const T960 = mod('960', '960 Sequential Controller', '960 Sequencer', 8, 'seq', 0.001, [
  ...['a', 'b', 'c'].flatMap((r, i) => range(8, k => K(r + k, 'Row ' + ROW[i] + ' ' + k, 0, 10, 0, TEN))),   // volts: LAW.row960
  ...range(8, k => S('s' + k, 'Stage ' + k + ' Mode', ['Stop', 'Normal', 'Skip'], 1)),
  S('s9', 'Stage 9 Mode', ['Stop', 'Skip'], 1),                         // STOP: the clock stops at stage 9 · SKIP: on to stage 1
  ...['a', 'b', 'c'].map((r, i) => S('g' + r, 'Row ' + ROW[i] + ' Range', ['×1', '×2', '×4'], 0)),
  S('rg', 'Range', ['0.1 Hz', '0.4 Hz', '1.6 Hz', '6.4 Hz', '26 Hz', '100 Hz', '410 Hz'], 2),   // LAW.clk960
  K('vn', 'Vernier', 0, 10, 2, F_VN),
  S('cc', 'Row C → Clock', OO, 0),
  S('os', 'Clock At Start', ['Stopped', 'Running'], 1),                 // the flip-flop's fresh state (reset, Play from a stop)
], [J('on', 'in', 'v', 'tr', 'OSC ON'), J('off', 'in', 'v', 'tr', 'OSC OFF'), J('sh', 'in', 'v', 'tr', 'SHIFT'), J('ci', 'in', 'v', 'cv', 'CONTROL INPUT'),
  J('co', 'out', 'v', 'tr', 'OUTPUT'), ...range(9, k => J('i' + k, 'in', 'v', 'tr', 'STAGE ' + k + ' IN')),
  ...range(9, k => J('o' + k, 'out', 'v', 'tr', 'STAGE ' + k + ' OUT')),
  ...['a', 'b', 'c'].flatMap((r, i) => range(2, k => J('r' + r + k, 'out', 'v', 'cv', 'ROW ' + ROW[i] + ' ' + k)))],   // a row's two: one buffer
{ ev: [E('on', 'OSC ON'), E('off', 'OSC OFF'), E('sh', 'SHIFT'), ...range(9, k => E('e' + k, 'SET ' + k))],
  lamps: [...range(9, k => E('l' + k, 'STAGE ' + k)), E('lo', 'OSC')] });

const T962 = mod('962', '962 Sequential Switch', '962 Switch', 1, 'seq', 0.0006, [], [
  ...range(3, k => J('i' + k, 'in', 'v', 'cv', 'SIGNAL INPUT ' + k)),  // INPUT 3 patched: a 3-step cycle
  J('q1', 'out', 'v', 'cv', 'OUTPUT 1'), J('q2', 'out', 'v', 'cv', 'OUTPUT 2'),                    // one buffer
  ...range(3, k => J('t' + k, 'in', 'v', 'tr', 'TRIGGER IN ' + k)), ...range(3, k => J('o' + k, 'out', 'v', 'tr', 'TRIGGER OUT ' + k)),
  J('sh', 'in', 'v', 'tr', 'SHIFT'),
], { ev: range(3, k => E('e' + k, 'SET ' + k)), lamps: range(3, k => E('l' + k, 'STAGE ' + k)) });

// the routing panels (§1.4, §2.4): lit switches are bus rows behind the panel, no cord
const T992 = mod('992', '992 Control Voltages', '992 Control voltages', 1, 'cp', 0.0001, [
  ...KWP.map((l, i) => S('s' + (i + 1), l, OO, 0)), S('s4', 'Ext', OO, 0),
  K('at', 'Ext Attenuator', -10, 10, 0, TEN),                           // reversible: xr = EXT IN · at / 10
], [J('x4', 'in', 'v', 'cv', 'EXT IN'), J('xr', 'out', 'v', 'cv', 'EXT (REAR)', { rear: 1 })],
{ bus: [...KWPJ, '.xr'].map((a, i) => ({ sw: ['s' + (i + 1)], a, b: '904b#1.c3' })) });

const T993 = mod('993', '993 Trigger and Envelope Voltages', '993 Trigger routing', 1, 'cp', 0, [
  S('f1', 'From 1', OO, 0), S('f2', 'From 2', OO, 0), ...range(3, k => S('t' + k, 'Trigger ' + k, OO, 0)), ...range(3, k => S('e' + k, 'Envelope ' + k, OO, 0)),
], [], { bus: [                                                        // positions are ordinals: the left / centre / right 911 = 911 1 / 2 / 3
  { sw: ['f1'], a: 'c.ks1', b: '911a#1.i1' }, { sw: ['f2'], a: 'c.ks2', b: '911a#1.i1' },
  { sw: ['f1', 't1'], a: 'c.ks1', b: '911#1.trg' }, { sw: ['f2', 't1'], a: 'c.ks2', b: '911#1.trg' },
  { sw: ['t2'], a: '911a#1.o1', b: '911#2.trg' }, { sw: ['t3'], a: '911a#1.o2', b: '911#3.trg' },
  ...range(3, k => ({ sw: ['e' + k], a: '911#' + k + '.out', b: '902#' + k + '.c3' })),
] });

const T994 = mod('994', '994 Dual Multiples', '994 Multiples', 1, 'ctl', 0, [],
  [...range(4, k => J('a' + k, 'any', 'v', 'cv', 'MULTIPLE A ' + k)), ...range(4, k => J('b' + k, 'any', 'v', 'cv', 'MULTIPLE B ' + k, { sec: 1 }))],
  { secs: ['multA', 'multB'] });                                        // passive: the evaluator's multiples

// the console panels (console height; trunks drawn, not emulated) and our Song clock
const T_CP3A = con('cp3a', 'CP3A Mixer and Routing', 'CP3A Mixer', 4, 'cp', 0.0005, [
  ...range(4, k => K('x' + k, 'Level ' + k, 0, 10, 7, TEN)), K('ms', 'Master', 0, 10, 5, MIXL),   // mix = Σ m_k · x_k / 10 × ms / 5
  ...KWP.map((l, i) => S('r' + (i + 1), l, OO, 0)), S('r4', 'Ext', OO, 0),
  K('ra', 'Ext Level', 0, 10, 10, TEN),                                 // 10 = unity: xr = EXT IN · ra / 10
], [...range(4, k => J('m' + k, 'in', 'v', 'au', 'MIXER INPUT ' + k)), J('mo', 'out', 'v', 'au', 'MIX +'), J('mn', 'out', 'v', 'au', 'MIX −'),
  J('x4', 'in', 'v', 'cv', 'EXT IN', { sec: 1 }), J('xr', 'out', 'v', 'cv', 'EXT (REAR)', { sec: 1, rear: 1 }),
  ...range(4, k => J('a' + k, 'any', 'v', 'cv', 'MULTIPLE ' + k, { sec: 2 }))],
{ secs: ['mix', 'route', 'mult'], bus: [...KWPJ, '.xr'].map((a, i) => ({ sw: ['r' + (i + 1)], a, b: '921a|921#=.f3' })) });   // CP3A k → the k-th driver

const T_CP4A = con('cp4a', 'CP4A Routing', 'CP4A Routing', 3, 'cp', 0.0001, [   // ours: its routing stands in for the original's
  ...KWP.map((l, i) => S('c' + (i + 1), l, OO, 0)), S('c4', 'CV In', OO, 0), ...range(3, k => S('t' + k, 'Trigger ' + k, OO, 0)),
], [J('ti', 'in', 's', 'tr', 'TRIGGER IN'), J('tr', 'out', 's', 'tr', 'TRIGGER (REAR)', { rear: 1 }),
  J('ci', 'in', 'v', 'cv', 'CV IN', { sec: 1 }), J('cr', 'out', 'v', 'cv', 'CV (REAR)', { sec: 1, rear: 1 })],
{ secs: ['trig', 'cv'], bus: [...[...KWPJ, '.cr'].map((a, i) => ({ sw: ['c' + (i + 1)], a, b: '904a#1.c3' })),
  ...range(3, k => [{ sw: ['t' + k], a: 'c.ks1', b: '911#' + k + '.trg' }, { sw: ['t' + k], a: '.tr', b: '911#' + k + '.trg' }]).flat()] });

const T_CP35 = con('cp35', 'CP35 Attenuators and Sources', 'CP35 Attenuators', 4, 'cp', 0.0003,   // ours: a stand-in
  range(4, k => K('a' + k, 'Attenuator ' + k, 0, 10, 0, TEN)),          // passive: o_k = i_k · a_k / 10
  [J('p6', 'out', 'v', 'cv', '+6 V'), J('m6', 'out', 'v', 'cv', '−6 V'),
    ...range(4, k => [J('i' + k, 'in', 'v', 'cv', 'ATTENUATOR ' + k + ' IN', { sec: k, norm: k < 3 ? 'p6' : 'm6' }),   // unpatched: ±6 V sources
      J('o' + k, 'out', 'v', 'cv', 'ATTENUATOR ' + k + ' OUT', { sec: k })]).flat(),
    ...range(4, k => J('u' + k, 'any', 'v', 'cv', 'MULTIPLE ' + k, { sec: 5 }))],
  { secs: ['src', '1', '2', '3', '4', 'mult'] });

const T_CP2 = con('cp2', 'CP2 Filters and Outputs', 'CP2 Filters', 3, 'cp', 0.0007, [   // ours on a short list
  K('lp', 'Low Pass', 0, 10, 5, F_RC), K('hp', 'High Pass', 0, 10, 5, F_RC),   // one-pole passive sections: 10 Hz … 10 kHz (LAW.rc923)
], [J('li', 'in', 'v', 'au', 'LOW PASS IN'), J('lo', 'out', 'v', 'au', 'LOW PASS OUT'),
  J('hi', 'in', 'v', 'au', 'HIGH PASS IN', { sec: 1 }), J('ho', 'out', 'v', 'au', 'HIGH PASS OUT', { sec: 1 }),
  ...range(4, k => J('u' + k, 'any', 'v', 'cv', 'MULTIPLE ' + k, { sec: 2 })),
  J('po', 'out', 'v', 'cv', 'PITCH OUT', { sec: 3 }), J('so', 'out', 's', 'tr', 'S-TRIG OUT', { sec: 3 }),     // = kpr / ksr
  J('kpr', 'in', 'v', 'cv', 'PITCH (REAR)', { sec: 3, rear: 1 }), J('ksr', 'in', 's', 'tr', 'S-TRIG (REAR)', { sec: 3, rear: 1 })],
{ secs: ['lp', 'hp', 'mult', 'kbd'], bus: [{ sw: [], a: 'c.kp1', b: '.kpr' }, { sw: [], a: 'c.ks1', b: '.ksr' }] });

const T_CP8A = con('cp8a', 'CP8A Power', 'CP8A Power', 2, 'cp', 0, [], []);   // drawn only (power switch, pilot lamp, fuses): not emulated

// the 961 (the 961CP console format): two V → S (six A inputs: closed while one is high; six B: a rising edge (re)starts the
// SWITCH ON TIME one-shot), two S → V (4 V while closed), audio → V (a comparator at θ, off below θ / 2; 4 V)
const v2s = c => [...range(6, k => J('a' + c + k, 'in', 'v', 'tr', 'V→S ' + c + ' A INPUT ' + k, { sec: c - 1 })),
  ...range(6, k => J('b' + c + k, 'in', 'v', 'tr', 'V→S ' + c + ' B INPUT ' + k, { sec: c - 1 })), J('s' + c, 'out', 's', 'tr', 'V→S ' + c + ' S-TRIG OUT', { sec: c - 1 })];
const T961 = con('961', '961 Interface', '961 Interface', 3, 'seq', 0.0019, [
  K('t1', 'Switch On Time 1', 0, 10, 5, F_ON), K('t2', 'Switch On Time 2', 0, 10, 5, F_ON),   // 5: 400 ms
  K('se', 'Sensitivity', 0, 10, 5, F_TH),
], [...v2s(1), ...v2s(2),
  J('v1i', 'in', 's', 'tr', 'S→V 1 IN', { sec: 2 }), J('v1o', 'out', 'v', 'tr', 'S→V 1 OUT', { sec: 2 }),
  J('v2i', 'in', 's', 'tr', 'S→V 2 IN', { sec: 3 }), J('v2o', 'out', 'v', 'tr', 'S→V 2 OUT', { sec: 3 }),
  J('ai', 'in', 'v', 'au', 'AUDIO→V IN', { sec: 4 }), J('ao1', 'out', 'v', 'tr', 'AUDIO→V OUT 1', { sec: 4 }), J('ao2', 'out', 'v', 'tr', 'AUDIO→V OUT 2', { sec: 4 })],
{ secs: ['v2s1', 'v2s2', 's2v1', 's2v2', 'a2v'] });

// our Song clock (Q1, §3.4): the song's steps as a 50 % gate of the song position, RUN, RESTART (start, loop wrap, seek, and every
// LENGTH steps from tick 0 — P-2 (b)); MODE ALWAYS: the project tempo while stopped too
const T_CLK = con('clk', 'Song Clock', 'Song clock', 2, 'seq', 0.0003, [
  S('dv', 'Step', ['1/4', '1/8', '1/16', '1/32', '1/8T', '1/16T'], 2),  // LAW.ticks
  S('md', 'Mode', ['Song', 'Always'], 0),
  S('ln', 'Length', ['Off', ...range(31, k => String(k + 1))], 0),      // Off · 2 … 32 steps (index = N − 1)
], [J('ck', 'out', 'v', 'tr', 'CLOCK'), J('rn', 'out', 'v', 'tr', 'RUN'), J('rs', 'out', 'v', 'tr', 'RESTART')],   // 0 / +5 V
{ short: 'SONG CLOCK', lamps: [E('lr', 'RUN')] });

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

export const GROUPS = Object.freeze({ src: 'Sources', mod: 'Modifiers', ctl: 'Control', seq: 'Sequencing', cp: 'Console & routing' });
/** The tray's order, group by group (§4.6, IMPL-9b §4.3: 25 tiles); the controller is no tile. */
export const ORDER = Object.freeze(['921', '921a', '921b', '923', '903a', '904a', '904b', '907a', '914', '902', '911', '911a', '995', '994',
  '960', '961', '962', 'clk', 'cp2', 'cp3a', 'cp4a', 'cp35', 'cp8a', '992', '993']);
/** Every type, the controller first. */
export const ORDER_ALL = Object.freeze(['ctl', ...ORDER]);
/** Tidy's cabinet rows (§4.5, IMPL-9b §4.4): sources and sequencing, then modifiers and envelopes (the Model 15 types in their
 *  stage-9 order: its Tidy is unchanged, rows at dy −1 024 / −512 when no console module is present). */
export const ROWS = Object.freeze([Object.freeze(['921', '921a', '921b', '923', '903a', '995', '994', '960', '962']),
  Object.freeze(['904a', '904b', '907a', '914', '911', '911a', '902', '992', '993'])]);
/** Tidy's console row (IMPL-9b §4.4): the console-height types, flush above the controller (dy −352), the cabinet rows above it;
 *  an empty console row takes no height. ROWS + CONSOLE = ORDER. */
export const CONSOLE = Object.freeze(['cp2', 'cp3a', 'cp4a', 'cp35', '961', 'clk', 'cp8a']);
export const TYPES = deepFreeze({ ctl: TCTL, 921: T921, '921a': T921A, '921b': T921B, 923: T923, '904a': T904A, '907a': T907A,
  911: T911, 902: T902, 995: T995,
  '904b': T904B, 914: T914, '911a': T911A, '903a': T903A, 960: T960, 962: T962, 992: T992, 993: T993, 994: T994,
  cp3a: T_CP3A, cp4a: T_CP4A, cp35: T_CP35, cp2: T_CP2, cp8a: T_CP8A, 961: T961, clk: T_CLK });

/* ---------------------------------------------------------------- the Model 15 set and the starting patches (§2.5, ours) */
/** The Model 15 set (RM §2.1), in its numbering order (Tidy's rows, sources first): 921, 921A, 921B × 2, 923, 995, 904A, 907A,
 *  911 × 2, 902 × 2 — with the controller, 97 jacks. */
export const M15 = Object.freeze(['921', '921a', '921b', '921b', '923', '995', '904a', '907a', '911', '911', '902', '902']);
/** The System 35 (IMPL-9b §2.5: VK-35's list, no 995) and System 55 (+ our Song clock) sets in their numbering order (Tidy's rows,
 *  then the console row): 22 and 37 modules + the controller. A 921B is driven by the first 921A with room. */
export const S35 = Object.freeze(['921', '921a', '921a', '921b', '921b', '921b', '921b', '923', '904a', '904b', '907a', '911', '911', '911',
  '902', '902', '902', 'cp3a', 'cp3a', 'cp4a', 'cp35', 'cp8a']);
export const S55 = Object.freeze(['921', '921a', '921a', '921b', '921b', '921b', '921b', '921b', '921b', '903a', '995', '994', '960', '962',
  '904a', '904b', '914', '911', '911', '911', '911', '911', '911a', '902', '902', '902', '902', '902', '992', '993',
  'cp2', 'cp3a', 'cp3a', 'cp3a', '961', 'clk', 'cp8a']);
/** The set tiles (IMPL-9b §1.2): a set = its modules and its starting patch; m15 = FAMILY.set / starter. */
export const SETS = deepFreeze({ m15: { name: 'Model 15', set: M15, starter: 'Classic bass' }, s35: { name: 'System 35', set: S35, starter: 'Swept band' },
  s55: { name: 'System 55', set: S55, starter: 'Sequence' } });
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
  // (9b, IMPL-9b §2.6) the System 35 / 55 starting patches — ours; V9c measures, the listening renders may retune (Swept band's CP3A
  // master 7.5, +1.2 dB over V9c's 6.5: through the whole Track its single keys peaked −11.8 … −14.2 dBFS, review 1 F5)
  { name: 'Swept band', about: 'Four 921Bs on two drivers through the CP3A into the 904B high-pass and the 904A: the high-pass swept up and back by a slow third 911 at each key (the controller\'s gate converter), the 904A by the first 911 and half the keyboard',
    mods: [['d1', '921a'], ['d2', '921a'], ['o1', '921b'], ['o2', '921b'], ['o3', '921b'], ['o4', '921b'], ['mx', 'cp3a'], ['at', 'cp35'], ['hp', '904b'],
      ['f', '904a'], ['e1', '911'], ['e2', '911'], ['e3', '911'], ['a', '902']],
    drv: { o1: 'd1', o2: 'd1', o3: 'd2', o4: 'd2' },
    cords: [['c.kp1', 'c.a1'], ['c.a2', 'd1.f1'], ['c.a3', 'd2.f1'], ['c.a4', 'at.i1'], ['at.o1', 'f.c2'],
      ['o1.saw', 'mx.m1'], ['o2.rec', 'mx.m2'], ['o3.saw', 'mx.m3'], ['o4.tri', 'mx.m4'], ['mx.mo', 'hp.in'], ['hp.out', 'f.in'], ['f.out', 'a.i1'], ['a.o2', 'c.out'],
      ['c.ks1', 'e1.trg'], ['e1.out', 'f.c1'], ['c.ks2', 'e2.trg'], ['e2.out', 'a.c1'], ['c.kg', 'c.vi'], ['c.vo', 'e3.trg'], ['e3.out', 'hp.c1']],
    v: { o1: { rg: 3 }, o2: { rg: 3, fq: 0.015 }, o3: { rg: 2 }, o4: { rg: 4 }, mx: { x1: 7, x2: 6, x3: 7, x4: 5, ms: 7.5 }, at: { a1: 5 }, hp: { fc: -4 },
      f: { fc: 0.5, re: 2 }, e1: { t1: 0.5, t2: 5, es: 4, t3: 4 }, e2: { t1: 0.5, t2: 6, es: 8, t3: 3.5 }, e3: { t1: 6, t2: 7, es: 4, t3: 5 } } },
  // the 960 clocked by our Song clock (Q1 / Q2): RESTART → 994 B → IN 1 puts it on stage 1 at the first step, at a wrap or seek and
  // every LENGTH steps (P-2 (b)); the keyboard's pitch through a spare 902 opened by GATE (fixed −2 V, LIN: × 1 held, × 0 let go —
  // P-3 (b)) so a held key transposes and the riff returns at release; ROW A ×1: C C E♭ G C′ B♭ G F (a semitone = 5 / 12 of a dial)
  { name: 'Sequence', about: 'An eight-step bass riff from the 960, clocked in sixteenths by the Song clock — it starts with ▶ and its RESTART puts the 960 on stage 1 every 8 steps; hold a key to transpose it (C4 plays it as written)',
    mods: [['ck', 'clk'], ['mu', '994'], ['sq', '960'], ['iv', '961'], ['dl', '911a'], ['e1', '911'], ['e2', '911'], ['d', '921a'], ['o1', '921b'], ['o2', '921b'],
      ['o3', '921'], ['mx', 'cp3a'], ['f', '904a'], ['a', '902'], ['gt', '902']],
    drv: { o1: 'd', o2: 'd' },
    cords: [['ck.ck', 'mu.a1'], ['mu.a2', 'sq.sh'], ['mu.a3', 'iv.a11'], ['ck.rs', 'mu.b1'], ['mu.b2', 'sq.i1'],
      ['iv.s1', 'dl.i1'], ['dl.o1', 'e1.trg'], ['dl.o2', 'e2.trg'], ['sq.ra1', 'd.f1'], ['sq.ra2', 'o3.f1'],
      ['c.kp1', 'gt.i1'], ['c.kg', 'gt.c1'], ['gt.o2', 'c.a1'], ['c.a2', 'd.f2'], ['c.a3', 'o3.f2'],
      ['o1.saw', 'mx.m1'], ['o2.rec', 'mx.m2'], ['o3.saw', 'mx.m3'], ['mx.mo', 'f.in'], ['f.out', 'a.i1'], ['a.o2', 'c.out'],
      ['e1.out', 'f.c1'], ['e2.out', 'a.c1'], ['sq.rb1', 'f.c2']],
    v: { ck: { dv: 2, md: 0, ln: 7 },
      sq: { a1: 0, a2: 0, a3: 15 / 12, a4: 35 / 12, a5: 60 / 12, a6: 50 / 12, a7: 35 / 12, a8: 25 / 12, b1: 5, b2: 2, b3: 4, b4: 2, b5: 7, b6: 3, b7: 5, b8: 1, os: 0 },
      dl: { d1: 0, d2: 0, md: 1 }, e1: { t1: 0.5, t2: 4, es: 2, t3: 3 }, e2: { t1: 0.3, t2: 5, es: 7, t3: 3 },
      o1: { rg: 2 }, o2: { rg: 3, fq: 0.015 }, o3: { rg: 1, fq: -0.02 }, mx: { x1: 9, x2: 6, x3: 8, ms: 8 }, f: { fc: 0, re: 4 }, gt: { md: 0, fc: -2 }, c: { ov: 10 } } },
  // as Sequence, the three rows one line through the 962: its SHIFT from the 960's stage 1 OUT (it moves as a new cycle starts),
  // RESTART also on its TRIGGER IN 1 (both on their first every 24 steps); rows A / B / C: Cm · A♭ · G (C′ = 5 on the dial)
  { name: 'Twenty-four steps', about: 'The 960\'s three rows as one 24-step line: the 962 moves from row A to B to C each time the 960 comes round to stage 1, and the Song clock\'s RESTART puts both on their first every 24 steps; starts with ▶, a held key transposes',
    mods: [['ck', 'clk'], ['mu', '994'], ['sq', '960'], ['sw', '962'], ['iv', '961'], ['dl', '911a'], ['e1', '911'], ['e2', '911'], ['d', '921a'], ['o1', '921b'],
      ['o2', '921b'], ['o3', '921'], ['mx', 'cp3a'], ['f', '904a'], ['a', '902'], ['gt', '902']],
    drv: { o1: 'd', o2: 'd' },
    cords: [['ck.ck', 'mu.a1'], ['mu.a2', 'sq.sh'], ['mu.a3', 'iv.a11'], ['ck.rs', 'mu.b1'], ['mu.b2', 'sq.i1'], ['mu.b3', 'sw.t1'], ['sq.o1', 'sw.sh'],
      ['sq.ra1', 'sw.i1'], ['sq.rb1', 'sw.i2'], ['sq.rc1', 'sw.i3'], ['sw.q1', 'd.f1'], ['sw.q2', 'o3.f1'],
      ['iv.s1', 'dl.i1'], ['dl.o1', 'e1.trg'], ['dl.o2', 'e2.trg'],
      ['c.kp1', 'gt.i1'], ['c.kg', 'gt.c1'], ['gt.o2', 'c.a1'], ['c.a2', 'd.f2'], ['c.a3', 'o3.f2'],
      ['o1.saw', 'mx.m1'], ['o2.rec', 'mx.m2'], ['o3.saw', 'mx.m3'], ['mx.mo', 'f.in'], ['f.out', 'a.i1'], ['a.o2', 'c.out'],
      ['e1.out', 'f.c1'], ['e2.out', 'a.c1']],
    v: { ck: { dv: 2, md: 0, ln: 23 },
      sq: { a1: 0, a2: 0, a3: 15 / 12, a4: 35 / 12, a5: 60 / 12, a6: 50 / 12, a7: 35 / 12, a8: 25 / 12,
        b1: 40 / 12, b2: 40 / 12, b3: 60 / 12, b4: 75 / 12, b5: 100 / 12, b6: 95 / 12, b7: 75 / 12, b8: 60 / 12,
        c1: 35 / 12, c2: 35 / 12, c3: 55 / 12, c4: 70 / 12, c5: 95 / 12, c6: 85 / 12, c7: 70 / 12, c8: 55 / 12, os: 0 },
      dl: { d1: 0, d2: 0, md: 1 }, e1: { t1: 0.5, t2: 4, es: 2, t3: 3 }, e2: { t1: 0.3, t2: 5, es: 7, t3: 3 },
      o1: { rg: 2 }, o2: { rg: 3, fq: 0.015 }, o3: { rg: 1, fq: -0.02 }, mx: { x1: 9, x2: 6, x3: 8, ms: 8 }, f: { fc: 0, re: 4 }, gt: { md: 0, fc: -2 }, c: { ov: 10 } } },
  { name: 'Echo strikes', about: 'Each key strikes three times — root, fifth and octave from one driver, each through its own 902: the first at once, the next two 150 ms apart through the 911A in SERIES (hold the key for all three)',
    mods: [['d', '921a'], ['o1', '921b'], ['o2', '921b'], ['o3', '921b'], ['dl', '911a'], ['e1', '911'], ['e2', '911'], ['e3', '911'], ['a1', '902'], ['a2', '902'],
      ['a3', '902'], ['mx', 'cp3a']],
    drv: { o1: 'd', o2: 'd', o3: 'd' },
    cords: [['c.kp1', 'd.f1'], ['c.ks1', 'e1.trg'], ['c.ks2', 'dl.i1'], ['dl.o1', 'e2.trg'], ['dl.o2', 'e3.trg'],
      ['o1.saw', 'a1.i1'], ['o2.saw', 'a2.i1'], ['o3.saw', 'a3.i1'], ['e1.out', 'a1.c1'], ['e2.out', 'a2.c1'], ['e3.out', 'a3.c1'],
      ['a1.o2', 'mx.m1'], ['a2.o2', 'mx.m2'], ['a3.o2', 'mx.m3'], ['mx.mo', 'c.out']],
    v: { c: { pr: 1, rt: 1, ov: 8 }, o1: { rg: 3 }, o2: { rg: 3, fq: 3.5 }, o3: { rg: 4 }, dl: { d1: 6.25, d2: 6.25, md: 2 },     // 2 ms · 1000^0.625 ≈ 150 ms
      e1: { t1: 0, t2: 6, es: 3, t3: 6 }, e2: { t1: 0, t2: 6, es: 3, t3: 6 }, e3: { t1: 0, t2: 6, es: 3, t3: 6 }, mx: { x1: 6, x2: 6, x3: 6, ms: 8 } } },
  { name: 'Vowel', about: 'Two detuned 921B saws through the 914 with three bands raised (500 Hz, 1 kHz, 2.8 kHz) and the rest low, a slow 911 on the 902: a vowel-like pad',
    mods: [['d', '921a'], ['o1', '921b'], ['o2', '921b'], ['fb', '914'], ['e', '911'], ['a', '902']],
    drv: { o1: 'd', o2: 'd' },
    cords: [['c.kp1', 'd.f1'], ['o1.saw', 'c.m1'], ['o2.saw', 'c.m2'], ['c.mo', 'fb.i1'], ['fb.o1', 'a.i1'], ['a.o2', 'c.out'], ['c.ks1', 'e.trg'], ['e.out', 'a.c1']],
    v: { c: { x1: 8, x2: 8 }, o1: { rg: 3 }, o2: { rg: 3, fq: 0.03 },
      fb: { lo: 4, b1: 4, b2: 4, b3: 4, b4: 5, b5: 10, b6: 6, b7: 10, b8: 5, b9: 5, b10: 10, b11: 4, b12: 3, hi: 2 }, e: { t1: 6, t2: 7, es: 9, t3: 7 } } },
  // the 960 at audio rate: RANGE 410 Hz, VERNIER so that C4 (0 V) clocks 523.25 Hz — C2 = clock / 8; row A ×4 a falling staircase
  // 4 V … 0, row B ×4 its mean (2 V) on the 902's lower input: the differential takes the offset off before the 904A [C, §12]
  { name: 'Step bass', about: 'The 960 as an oscillator: its clock at audio rate follows the keys and its eight row-A knobs draw one cycle (a falling staircase), the 902 takes off the steps\' offset (row B) before the 904A — keys C3 … B4 play C1 … B2; above B4 the clock\'s 1 kHz top holds it near 125 Hz',
    mods: [['sq', '960'], ['a', '902'], ['f', '904a'], ['e', '911']],
    drv: {},
    cords: [['c.kp1', 'sq.ci'], ['sq.ra1', 'a.i1'], ['sq.rb1', 'a.i2'], ['c.ks1', 'e.trg'], ['e.out', 'a.c1'], ['a.o2', 'f.in'], ['f.out', 'c.out'], ['c.kp2', 'f.c2']],
    v: { c: { pr: 1, ov: 9 },
      sq: { a1: 35 / 7, a2: 30 / 7, a3: 25 / 7, a4: 20 / 7, a5: 15 / 7, a6: 10 / 7, a7: 5 / 7, a8: 0, b1: 2.5, b2: 2.5, b3: 2.5, b4: 2.5, b5: 2.5, b6: 2.5, b7: 2.5, b8: 2.5,
        ga: 2, gb: 2, rg: 6, vn: 10 * Math.log(2 * 261.6255653005986 / 409.6) / Math.log(4), os: 1 },
      f: { fc: 1, re: 3 }, e: { t1: 0.3, t2: 5, es: 7, t3: 3 } } },
  // as built: the pitch through CP3A 1's KEYBOARD switch (to 921A 1), the 993's FROM 1 · TRIGGER 1 / 2 · ENVELOPE 1 (911 1 at once,
  // 911 2 through the 911A, 911 1 on 902 1) — no pitch or trigger cord: six cords, five lit switches
  { name: 'Routed', about: 'The System 55 played as it was built: the CP3A\'s KEYBOARD switch sends the keys to the first 921A, the 993 triggers the first 911 and — through the 911A — the second, and sends the first to the first 902; only the audio is patched',
    mods: [['d', '921a'], ['o1', '921b'], ['o2', '921b'], ['mx', 'cp3a'], ['rt', '993'], ['dl', '911a'], ['e1', '911'], ['e2', '911'], ['f', '904a'], ['a', '902']],
    drv: { o1: 'd', o2: 'd' },
    cords: [['o1.saw', 'mx.m1'], ['o2.saw', 'mx.m2'], ['mx.mo', 'f.in'], ['f.out', 'a.i1'], ['a.o2', 'c.out'], ['e2.out', 'f.c1']],
    v: { c: { ov: 10 }, o1: { rg: 2 }, o2: { rg: 3, fq: 0.02 }, mx: { x1: 9, x2: 8, ms: 8, r1: 1 }, rt: { f1: 1, t1: 1, t2: 1, e1: 1 }, dl: { d1: 4 },
      f: { fc: 1, re: 3 }, e1: { t1: 0.5, t2: 5, es: 8, t3: 4 }, e2: { t1: 1, t2: 4.5, es: 3, t3: 4 } } },
]);

/** The family record patch-core registers (§2.6). */
export const FAMILY = Object.freeze({
  id: 'moog', name: '900 Series', model: 'm900', ctl: 'ctl', types: TYPES, order: ORDER, rows: ROWS, groups: GROUPS,
  set: M15, starter: 'Classic bass', sink: 'out', rackW: 1024,
  plugs: Object.freeze({ v: 'A 1/4" jack', s: 'An S-trigger socket' }), conv: 'use the controller’s trigger converter', PRESETS,
  console: CONSOLE, sets: SETS, rackWide: 2816, rackN: 16,             // rackW while ≤ rackN modules and no console module, else rackWide
});

// a module id's number, 0 for anything else: patch-core's isMid grammar (m1…m999999, IMPL-P §3.1), mirrored here because this table is a leaf
// (patch-core imports it); tests/patch-core.test.mjs holds the two equal
const midN = k => { const m = typeof k === 'string' ? /^m([1-9]\d{0,5})$/.exec(k) : null; return m ? +m[1] : 0; };
const pval = (c, x) => typeof x === 'number' && isFinite(x) ? (c.t === 's' ? Math.max(0, Math.min(c.opts.length - 1, Math.round(x))) : Math.max(c.min, Math.min(c.max, x))) : c.def;
/** A set patched as its starter on a fresh record (§1.4; IMPL-9b §1.2: the Model 15 / System 35 / System 55 tiles, a new 900 Series
 *  from the instrument menu, `#m900`, Add track) → { rec, vals } | null (no such set): modules numbered past every `m<k>` of vals.p
 *  (§1.5), in the set's order, a linked type driven by the first driver with room; the starter's roles bound (each type's k-th
 *  role its k-th module), their drivers set (a driver past its max sheds its highest unbound ones), its cords c1… coloured by the
 *  least-used rule (i % 8 from none); vals = vals + the controller's and every bound module's values (the preset's, else the
 *  defaults; an unbound routing panel is new, so off). = patch-core loadPreset(fresh, vals, starter, { ensure: set }) — the tests
 *  compare the two. null too when the set's ids would pass m999999 (a vals.p numbered within a set of it). Pure. */
export function makeSet(id, vals) {
  const S = typeof id === 'string' && Object.prototype.hasOwnProperty.call(SETS, id) ? SETS[id] : null;
  if (!S) return null;
  const v0 = vals && typeof vals === 'object' && !Array.isArray(vals) ? vals : {};
  const p0 = v0.p && typeof v0.p === 'object' && !Array.isArray(v0.p) ? v0.p : {};
  let n = 1;
  for (const k of Object.keys(p0)) n = Math.max(n, midN(k) + 1);
  if (n + S.set.length - 1 > 999999) return null;                     // no room: the set's last id would pass m999999 (patch-core: "No module numbers left"; normPatch drops ids past it)
  const P = PRESETS.find(x => x.name === S.starter), mods = {}, of = {}, bound = {}, taken = {};
  for (const t of S.set) {
    const mid = 'm' + n++, o = { t }, L = TYPES[t].link;
    if (L) { const d = (of[L.to] || []).find(k => Object.keys(mods).filter(j => mods[j].drv === k).length < L.max); if (d) o.drv = d; }
    mods[mid] = o; (of[t] = of[t] || []).push(mid);
  }
  for (const [role, t] of P.mods) { bound[role] = of[t][taken[t] || 0]; taken[t] = (taken[t] || 0) + 1; }
  for (const [role, t] of P.mods) if (TYPES[t].link) { const o = Object.assign({}, mods[bound[role]]); if (P.drv[role]) o.drv = bound[P.drv[role]]; else delete o.drv; mods[bound[role]] = o; }
  const used = new Set(Object.values(bound));                         // a driver past its max sheds unbound ones, highest first
  for (const d of Object.keys(mods)) {
    const T = ORDER.map(t => TYPES[t]).find(x => x.link && x.link.to === mods[d].t);
    if (!T) continue;
    const by = Object.keys(mods).filter(k => mods[k].drv === d), extra = by.filter(k => !used.has(k)).reverse();
    for (let c = by.length; c > T.link.max && extra.length; c--) { const k = extra.shift(); mods[k] = { t: mods[k].t }; }
  }
  const end = e => { const [r, port] = e.split('.'); return (r === 'c' ? 'c' : bound[r]) + '.' + port; };
  const cords = P.cords.map(([a, b], i) => ({ id: 'c' + (i + 1), a: end(a), b: end(b), c: i % 8 }));
  const nv = Object.assign({}, v0), np = Object.assign({}, p0), pc = P.v.c || {};
  for (const c of TCTL.params) nv[c.id] = pval(c, pc[c.id]);
  for (const [role, t] of P.mods) { const e = { _t: t }, pv = P.v[role] || {}; for (const c of TYPES[t].params) e[c.id] = pval(c, pv[c.id]); np[bound[role]] = e; }
  nv.p = np;
  return { rec: { v: 1, f: FAMILY.id, nid: n, mods, cid: cords.length + 1, cords, name: P.name }, vals: nv };
}
/** The Model 15 set patched as Classic bass on a fresh record = makeSet('m15', vals) (stage 9's records, pinned by the tests). */
export function model15(vals) { return makeSet('m15', vals); }

/** models.js m900.map's pv (§3.2): { '0': the controller's values in CTL_IDS order (its default when absent), 'm<k>': vals.p's
 *  entries as they are (`_t` and ids: the machine binds them) }. Pure; reads `vals` only (map never sees dev.patch). */
export function pvOf(vals) {
  const o = vals && typeof vals === 'object' ? vals : {}, pv = { 0: [] }, p = o.p;
  for (const c of TCTL.params) { const x = o[c.id]; pv[0].push(typeof x === 'number' && isFinite(x) ? x : c.def); }
  if (p && typeof p === 'object' && !Array.isArray(p)) for (const k of Object.keys(p)) if (midN(k) > 0 && p[k] && typeof p[k] === 'object') pv[k] = p[k];
  return pv;
}
