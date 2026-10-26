// rig-core.js — Wavecraft's model: the display name and every flippable choice of stage WC, the key gate, the three named
// states, the module catalogue, the add rules, the skins and the `dev.rig` record's bounds (docs/canvas/IMPL-WC.md §2, §3.1,
// §3.3, §3.5, §5.1; the header's "cheap to reverse" list). Pure ES module, a leaf: imports serum-core and sx-edges only, no DOM
// (node-tested: tests/rig-model.test.mjs, lane K's tests/rig-core.test.mjs).
// A Wavecraft ("rig", model id RIG.ID, family 'rig') rides the Serum engine: its sound state IS a Serum state (vals.s), its
// modules are Serum's parts under our own names, and nothing here reaches the engine but that state (W2 / W3). The name is a
// display constant: RIG.NAME is the ONE place the word appears in the site's code (G4 greps for it); ids, keys, files and
// prefs say `rig` so a rename is one line and no migration.
//   RIG            NAME · ID · VIEW (the tray view) · WIRES 'cords' | 'lines' (§4.7, the regret path) · GATE_MS · HUB_OPEN (the
//                  Amplifier arrives open) · STARTER (the tile's starter patch as data; null = an Amplifier alone)
//   GATE, isGate   ENV 1 at the key-gate values (§3.3): 3 ms linear attack, sustain 1, 3 ms linear release, its flags off
//   rigBlank()     the base for a module drop: a default Serum with every source and filter off, ENV 1 the gate      → s
//   rigStarter(p)  RIG.STARTER on the blank, the GLOBAL preferences applied as serum.defaults does (what defaults() returns) → { s }
//   rigInit()      ⋯ → Init: the blank + Oscillator 1 into the Amplifier (route Main) — "the raw oscillator"              → s
//   adopt(s)       a Serum state entering a Wavecraft (§2.5): every AMP ENV switch on, a note per switch that was off → { s, notes }
//   MODULES        the catalogue (§3.1): kind → { label, labelN(i), cols, max, slots, power, jacks, rows, cut }
//   AUTOPLUG       the add rules (§3.5): kind → its targets in preference order (data)
//   SKINS, SKIN_DEFAULT   §5.1 — a skin is a CSS-variable block in style.css; here its id, label and face font
//   normRig(r)     the bounded `dev.rig` record { v: 1, cc, n } (song.normDev; §2.1)
// Lane K (IMPL-WC §2.3, §3.4, §4.2, §11.1; tests/rig-core.test.mjs, tests/rig-sound.test.mjs) — the rig's rules, all over
// sx-edges' ends ('oscA.out', 'filter.in', 'voice.main', 'env1.out', 'voice.level'), pure, nothing written in place: every
// editor returns { f: [[path, before, after] …], why, notes, lay?, links?, ids? } and the host applies `f` through the Serum
// host (sxApply: panel undo + History meta) — `f` is empty and `why` set on a refusal.
//   WORDS                          G13: every rig-facing text (sx-edges' WHY re-worded, the slot refusals, the notices, the
//                                  legends) through RIG.NAME — no Serum word on a rig surface
//   LOOK, cordColor(a, rig, kind)  §4.5: the palette index by source part (a user's dev.rig.cc pick wins), the four alphas
//   edges(s, fx, dev, rig, used)   §4.1 / §4.2: the rig's cords — sx-edges' audio / note / warp edges (kind 'fx' dropped), a
//                                  source into a filter by route 0 + share > 0 whatever the switch (switch off: `dry`), the
//                                  amp-slot cord env1.out → voice.level iff !isGate ∨ something reads ENV 1
//   can(s, fx, a, b, o)            → { ok, why, a, b }: §4.2's rules with WORDS' reasons; pure (o.used: the link rows; o.rig: the names)
//   plug / pull / repatch          the cord edits; pull / repatch take an edges() id ('x:<dev>:<edge id>' or the edge id)
//   envToAmp(s, k, o) / envFromAmp(s, o)   §3.4: the ENV slot moves over serum-core swapModules (+ the sources, s.midi /
//                                  s.locks, the lay rename, the gate back); o = { held, shown, used, rig } (or `held` alone)
//   partKeys(s, lay, dev, used, rig)   sx-edges' I1 / I2 + env1 by the amp-slot rule + I1' (a fed-but-off Filter: by a
//                                  powered source or the other Filter carrying sound)
//   nameOf(rig, key) / labelOf(part, rig) / ordinalOf / nextOrdinal   the bar titles from the fixed ordinals (dev.rig.n)
//   pruneRig(rig, s, lay, dev)     the cc / n garbage collection (§2.1)
import { defaultSerum, normalizeSerum, DESTS, DEST_INDEX, MODULE_FIELDS, swapModules, initModule, destBase, lawValue } from './serum-core.js?v=9';
import { POWER, PARTS, SRC_PARTS, FILTERS, WHY, setEdge, serumEdges, slotsUsed, partKeys as sxPartKeys, jackOf, kindOf, splitKey, partOn } from './sx-edges.js?v=9';

const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; }
const clone = x => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));

/** The display constant and the flippable choices (the header of IMPL-WC: each a constant or a pref over a structure). */
export const RIG = deepFreeze({
  NAME: 'Wavecraft',   // the user's name, provisional ("not 100 % sold"): every label, notice, tile, menu and tooltip reads it
  ID: 'rig',           // the model id (models.js), the family, the lay / pref / CSS / file stem — never the name
  VIEW: 'rig',         // the Sources tray view (§7)
  WIRES: 'cords',      // a Wavecraft canvas draws its own connections as cords; 'lines' = today's renderer (§1.3, §4.7); pref synth.rig.wires, URL ?wires=
  GATE_MS: 3,          // the key gate's attack and release (§3.3) — a constant, not a knob: "a few-ms click-free ramp"
  HUB_OPEN: true,      // the Amplifier arrives open (false: folded to its bar)
  // the Wavecraft tile's starter rig (Q7 (a)): the parts powered, then the cords plugged on the blank — Oscillator 1 → Filter 1 →
  // Amplifier, Envelope 1 on LEVEL at Serum's envelope defaults (not the gate), no LFO; null = an Amplifier alone (rigBlank)
  STARTER: { on: ['oscA', 'filter'], cords: [['oscA.out', 'filter.in'], ['filter.out', 'voice.main'], ['env1.out', 'voice.level']] },
});

/* ---------------------------------------------------------------- the key gate (§3.3) */
// laws.js pow5: t = 32·n⁵ s, so n = (t / 32)^⅕ — 3.00 ms → 0.156482…; the panel prints "3.00 ms". Linear curves (c 0.5: bend's
// identity), sustain 1 (level 1² = 1), hold 0, decay Serum's default (moot at sustain 1). The flags matter too (skeptic P2-3): BPM
// would take the times from the beat ladder, Voice Steal Retrigger would restart a re-pressed voice from 0 — a 1 → 0 step, a click.
const N3 = Math.pow(RIG.GATE_MS / 1000 / 32, 0.2);
/** ENV 1 as the key gate: the s.p fields and s.env[0]'s flags. A state, not a code path (W1: the engine is untouched). */
export const GATE = deepFreeze({
  p: { 'e1.att': N3, 'e1.hold': 0, 'e1.dec': 0.5, 'e1.sus': 1, 'e1.rel': N3, 'e1.ca': 0.5, 'e1.cd': 0.666, 'e1.cr': 0.5 },
  env: { bpm: 0, legInv: 0, stealRe: 0 },
});
const FLAGS = ['bpm', 'legInv', 'stealRe'];
/** Is ENV 1 of this state the key gate: every GATE.p field within 1e-9 of s.p's and s.env[0]'s flags GATE.env's. */
export function isGate(s) {
  if (!isObj(s) || !isObj(s.p)) return false;
  for (const k of Object.keys(GATE.p)) { const v = s.p[k]; if (typeof v !== 'number' || Math.abs(v - GATE.p[k]) > 1e-9) return false; }
  const e = Array.isArray(s.env) ? s.env[0] : null;
  return isObj(e) && FLAGS.every(k => (e[k] ? 1 : 0) === GATE.env[k]);
}
const setGate = s => { Object.assign(s.p, GATE.p); s.env[0] = Object.assign({}, GATE.env); return s; };
// ENV 1 at Serum's own envelope defaults (DESTS: attack 0.515 ms, decay 1 s, sustain 100 %, release 14.7 ms): "which then takes over the level"
const setEnvDefault = s => { for (const id of Object.keys(GATE.p)) s.p[id] = DESTS[DEST_INDEX[id]].def; s.env[0] = { bpm: 0, legInv: 0, stealRe: 0 }; return s; };

/* ---------------------------------------------------------------- the three named states (§2.2; skeptic P2-10) */
const ENV_SWITCHES = [['osc', 0], ['osc', 1], ['osc', 2], ['sub'], ['noise'], ['filter', 0], ['filter', 1]];
const at = (s, path) => { let o = s; for (const k of path) { if (!o || typeof o !== 'object') return undefined; o = o[k]; } return o; };
/** The base for a module drop: a default Serum with every source AND filter off (so the first Oscillator dropped becomes OSC A through
 * firstFree, not a second oscillator beside Serum's default A), every AMP ENV switch on, ENV 1 the gate. → a state */
export function rigBlank() {
  const s = normalizeSerum(defaultSerum());
  for (const id of ['a.on', 'b.on', 'c.on', 's.on', 'n.on', 'f.on', 'f2.on']) s.p[id] = 0;
  for (const path of ENV_SWITCHES) { const o = at(s, path); if (isObj(o)) o.env = 1; }
  return setGate(s);
}
/** The GLOBAL preferences a new Serum-engine state takes (models.js serum.defaults, SPEC-serum2 §12.7, §13.10): default oversampling,
 * author, 3D view, MPE on by default — not for a rig (`rig` true: midi.js routes MPE to a Serum only in WC-1, §13; review 1 P2-3).
 * In place → s. */
export function applyPrefs(s, prefs, rig) {
  if (prefs) {
    if (prefs.defOs === 1 || prefs.defOs === 2 || prefs.defOs === 4) s.global.os = prefs.defOs;
    if (typeof prefs.author === 'string') s.author = prefs.author.slice(0, 64);
    if (prefs.view3d) s.ui.view3d = s.ui.view3d.map(() => 1);
    if (prefs.mpeDefault && s.global.mpe && !rig) s.global.mpe.on = 1;
  }
  return s;
}
/** RIG.STARTER applied to the blank, the preferences applied as serum.defaults applies them — what the model's defaults() returns, so every
 * generic "new instrument" path (the tile, + Track, the chip menu, #rig, voiceDef, loadVals) gives the starter. → { s } */
export function rigStarter(prefs) {
  const s = rigBlank(), S = RIG.STARTER;
  if (isObj(S)) {
    for (const part of S.on || []) if (POWER[part]) s.p[POWER[part]] = 1;
    for (const [a, b] of S.cords || []) apply(s, plug(s, null, a, b).f); // (the amp slot included: env1.out → voice.level = Envelope 1 at Serum's envelope defaults, §3.4)
  }
  return { s: applyPrefs(s, prefs, true) };
}
/** ⋯ → Init: the blank + Oscillator 1 into the Amplifier (route 1, Main: no "→ Filter (off)" stub) — the raw oscillator at its knob levels (Q3). → a state */
export function rigInit() {
  const s = rigBlank();
  s.p['a.on'] = 1; s.osc[0].route = 1;
  return s;
}

/* ---------------------------------------------------------------- the catalogue (§3.1) and the add rules (§3.5) */
// a jack of a face's jack row (§3.2): sx-edges' port id, the printed label; sum: a Σ input (any number of cords); normal: the printed
// normal when nothing is plugged (the Amplifier's LEVEL: KEYS); ro: a target read-only cords land on; kind: the cord's signal
const J = (id, label, o) => Object.assign({ id, label, kind: 'audio' }, o || {});
const SLOTS = (pre, n) => Array.from({ length: n }, (_, i) => pre + (i + 1));
/** The modules: kind → label (the bar), labelN(i) (a numbered kind), cols (the RIG grid's columns, §3.8: width 64·cols + 32), max per rig,
 * slots (the engine parts in order; the Amplifier is the device key iN itself, 'voice'), power (a ⏻ on the bar: sx-edges POWER), jacks
 * (in / out), rows (the face's row kinds top to bottom — the recipe with the numbers is rig-ui's FACE), cut (1 = WC-1, 2 = WC-2). */
export const MODULES = deepFreeze({
  amp: { label: 'Amplifier', cols: 4, max: 1, slots: ['voice'], power: false,
    jacks: { in: [J('main', 'IN', { sum: true }), J('direct', 'DIRECT', { sum: true }), J('level', 'LEVEL', { kind: 'mod', normal: 'KEYS' }), J('note', 'NOTE', { kind: 'note', sum: true })], out: [J('out', 'OUT', { ro: true })] },
    rows: ['head', 'knobs', 'switches', 'knobs', 'jacks'], cut: 1 },
  osc: { label: 'Oscillator', labelN: i => 'Oscillator ' + i, cols: 5, max: 3, slots: ['oscA', 'oscB', 'oscC'], power: true,
    jacks: { in: [J('warp', 'WARP', { kind: 'warp', ro: true })], out: [J('out', 'OUT')] }, rows: ['head', 'screen', 'knobs', 'knobs', 'knobs', 'jacks'], cut: 1 },
  sub: { label: 'Sub oscillator', bar: 'Sub osc', cols: 3, max: 1, slots: ['sub'], power: true, jacks: { in: [], out: [J('out', 'OUT')] }, rows: ['head', 'knobs', 'knobs', 'jacks'], cut: 1 },
  noise: { label: 'Noise', cols: 3, max: 1, slots: ['noise'], power: true, jacks: { in: [], out: [J('out', 'OUT')] }, rows: ['head', 'knobs', 'knobs', 'jacks'], cut: 1 },
  filter: { label: 'Filter', labelN: i => 'Filter ' + i, cols: 5, max: 2, slots: ['filter', 'filter2'], power: true,
    jacks: { in: [J('in', 'IN', { sum: true })], out: [J('out', 'OUT')] }, rows: ['head', 'knobs', 'knobs', 'switches', 'switches', 'jacks'], cut: 1 },
  env: { label: 'Envelope', labelN: i => 'Envelope ' + i, cols: 5, max: 4, slots: SLOTS('env', 4), power: false,
    jacks: { in: [], out: [J('out', 'OUT', { kind: 'mod' })] }, rows: ['head', 'screen', 'knobs', 'knobs', 'jacks'], cut: 1 },
  lfo: { label: 'LFO', labelN: i => 'LFO ' + i, cols: 5, max: 10, slots: SLOTS('lfo', 10), power: false,
    jacks: { in: [], out: [J('out', 'OUT', { kind: 'mod' })] }, rows: ['head', 'screen', 'knobs', 'switches', 'jacks'], cut: 1 },
  macros: { label: 'Macros', cols: 4, max: 1, slots: ['macros'], power: false,
    jacks: { in: [], out: SLOTS('k', 8).map((id, i) => J(id, 'Macro ' + (i + 1), { kind: 'mod', inline: true })) }, rows: ['head', 'knobs', 'knobs'], cut: 1 },
  arp: { label: 'Arpeggiator', cols: 8, max: 1, slots: ['arp'], power: true, jacks: { in: [], out: [J('out', 'OUT', { kind: 'note' })] }, rows: ['head', 'screen', 'jacks'], cut: 2 },
  clip: { label: 'Clip sequencer', cols: 8, max: 1, slots: ['clip'], power: true, jacks: { in: [], out: [J('out', 'OUT', { kind: 'note' })] }, rows: ['head', 'screen', 'jacks'], cut: 2 },
});
/** The add rules (§3.5), data: kind → its OUT's targets in preference order, sx-edges' ends — the first whose module stands on the canvas
 * wins ('filter.in' = the first Filter module, its IN sums; 'voice.main' = the Amplifier's IN); [] = unplugged (a knob is its destination:
 * drag the plug). An Envelope's 'voice.level' follows §3.4: the amp slot when it is the gate, else the first free slot, unplugged. */
export const AUTOPLUG = deepFreeze({
  osc: ['filter.in', 'voice.main'], sub: ['filter.in', 'voice.main'], noise: ['filter.in', 'voice.main'],
  filter: ['voice.main'], env: ['voice.level'], lfo: [], macros: [], arp: ['voice.note'], clip: ['voice.note'],
});

/* ---------------------------------------------------------------- the skins (§5.1) */
/** The built-in skins (no editor): id = the style.css block `#world[data-cv-skin="<id>"]`, label (the WC-2 ⚙ line), font: 'narrow' (the
 * bundled narrow face, Inter its fallback) | 'ui'. WC-1 ships charcoal alone; ivory (cream panels, charcoal lettering) joins in WC-2. */
export const SKINS = deepFreeze([{ id: 'charcoal', label: 'Charcoal', font: 'narrow' }]);
export const SKIN_DEFAULT = 'charcoal';

/* ---------------------------------------------------------------- a Serum state entering a Wavecraft (§2.5) */
const SWITCH_LABELS = ['Oscillator 1', 'Oscillator 2', 'Oscillator 3', 'Sub oscillator', 'Noise', 'Filter 1', 'Filter 2'];
/** adopt(s): a conversion, a preset load, a paste. ONLY the AMP ENV switches change (every osc / sub / noise / filter `env` := 1, a note per
 * switch that was off: a per-source "no amp envelope" is not a cord and has no face control, so what you see is what plays — W4);
 * routes, forks, shares, the filters' input switches, both filters' power, every matrix row and ENV 1 are untouched. A copy; idempotent. */
export function adopt(s) {
  const S = isObj(s) ? clone(s) : normalizeSerum(s), notes = [];
  ENV_SWITCHES.forEach((path, i) => {
    const o = at(S, path);
    if (isObj(o) && o.env !== undefined && !o.env) { o.env = 1; notes.push(SWITCH_LABELS[i] + '’s AMP ENV switch was off — it is on'); }
  });
  return { s: S, notes };
}

/* ---------------------------------------------------------------- dev.rig (§2.1): cosmetics only, never a sound */
const CC_KEY = /^[a-z][a-zA-Z0-9.#]{1,40}$/, PART_KEY = /^[a-z][a-zA-Z0-9]{0,15}$/, CC_MAX = 512, N_MAX = 64;
/** The bounded record { v: 1, cc: { '<source end>': 0…7 }, n: { '<part>': 1…99 } }: cc the cord colours a user picked, keyed by the cord's
 * source end ('oscA.out', 'lfo3.out#2' a row's ordinal — a re-patch keeps the colour); n the fixed display ordinal of a module whose engine
 * slot can move (the Envelopes, §3.4), keyed by the part name of its lay key ('env2' of 'iN/env2'). ≤ 512 / ≤ 64 entries, integers in range,
 * anything else dropped; never throws; idempotent. */
export function normRig(r) {
  const o = { v: 1, cc: {}, n: {} };
  if (!isObj(r)) return o;
  const take = (src, dst, re, lo, hi, max) => {
    if (!isObj(src)) return;
    let n = 0;
    for (const k of Object.keys(src)) {
      if (n >= max) break;
      const v = src[k];
      if (k === '__proto__' || !re.test(k) || !Number.isInteger(v) || v < lo || v > hi) continue;
      dst[k] = v; n++;
    }
  };
  take(r.cc, o.cc, CC_KEY, 0, 7, CC_MAX);
  take(r.n, o.n, PART_KEY, 1, 99, N_MAX);
  return o;
}
/** The cc / n garbage collection (§2.1): at load (song.normDev's hook: the bounded record, the raw state, the track's lay, the device
 * key) and before a save (the host), entries whose end or part names nothing that exists go — a cc key's source part ('oscA' of
 * 'oscA.out', 'lfo3' of 'lfo3.out#2', 'env1' iff the amp cord exists) and an n key must be a module of the rig (partKeys; 'voice' is
 * the Amplifier). Not a state → the record as it is (nothing is known). A new object; never throws. */
export function pruneRig(rig, s, lay, dev) {
  if (!isObj(s) || !isObj(s.p)) return rig;
  const r = normRig(rig), parts = new Set(partKeys(s, lay, dev, null, r));
  parts.add('voice');
  const cc = {}, n = {};
  for (const k of Object.keys(r.cc)) if (parts.has(k.split('.')[0])) cc[k] = r.cc[k];
  for (const k of Object.keys(r.n)) if (parts.has(k)) n[k] = r.n[k];
  return { v: 1, cc, n };
}

/* ================================================================ lane K: the rig's rules (IMPL-WC §2.3, §3.4, §4.2, §11.1) */

/* ---------------------------------------------------------------- the words (G13) */
const NM = RIG.NAME;
/** Every text a rig surface shows, through RIG.NAME (G13: no "Serum", "VOICE" or "Xfer" on a rig). The first block re-words
 * sx-edges' WHY under the same keys (`can` maps a refusal through it; the bundled Serum keeps sx-edges' own words); then the
 * amp-slot and slot refusals (§3.4), the full-rig texts (main's sxFullWhy), the notices and the legends. Functions take the
 * module's display ordinal / name. Frozen. */
export const WORDS = deepFreeze({
  voice: 'An oscillator feeds a Filter or the Amplifier', filter: 'A Filter feeds the other Filter or the Amplifier',
  ro: 'Set this in the oscillator’s warp menu', fx: 'Edited in the Amplifier’s outputs', self: 'A Filter cannot feed itself',
  dir: 'Two outputs — connect an output to an input', input: 'That is an input',
  note: 'Only the Arpeggiator and the Clip sequencer play notes into NOTE', notes: 'The Arpeggiator and the Clip sequencer play notes into NOTE',
  same: 'Already connected', none: 'Not connected', bad: `Not a cord of this ${NM}`, other: `A ${NM} plugs into its own modules`,
  twoFilters: 'Two filters at most', level: 'Only an Envelope shapes the level', lfoLevel: 'An Envelope shapes the level — an LFO goes on a knob',
  env: 'An Envelope shapes the level or modulates a knob', mod: 'An Envelope, LFO or Macro goes on a knob',
  ampHeld: n => `Envelope ${n} already shapes the level — pull it first`, gate: 'The keys gate the level — nothing is plugged into LEVEL',
  envFull: 'Envelopes 2–4 are all in use — remove one first', envHeld: 'Envelopes 2–4 are all in use — held by canvas modulators',
  badEnv: `Not one of this ${NM}’s Envelopes`, ownMacro: `A ${NM}’s macros modulate that ${NM} · use a Macro module`,
  notPatchable: 'Inside its instrument: not patchable',
  // the full rig (main's sxFullWhy), a module already there, a module in use (Remove)
  full: kind => (kind === 'osc' ? `This ${NM} already has 3 oscillators` : kind === 'filter' ? `This ${NM} already has 2 filters`
    : kind === 'sub' ? `This ${NM}’s Sub oscillator is already on` : kind === 'noise' ? `This ${NM}’s Noise is already on`
      : kind === 'env' ? `This ${NM}’s Envelopes 2–4 are all in use` : kind === 'lfo' ? `This ${NM}’s 10 LFOs are all in use`
        : kind === 'macros' ? 'Macros is already on the canvas' : kind === 'arp' ? 'The Arpeggiator is already on' : kind === 'clip' ? 'The Clip sequencer is already on' : 'Already on the canvas'),
  onCanvas: name => `${name} is already on the canvas`,
  inUse: (name, n) => `${name} modulate${name === 'Macros' ? '' : 's'} ${n} knob${n > 1 ? 's' : ''} · its ⋯ → Remove All Destinations first`,
  // the notices (§3.4, §3.5)
  takesOver: n => `Envelope ${n} shapes the level`, unplugged: n => `Envelope ${n} unplugged · the keys gate the level again`,
  dropped: (n, what) => `Envelope ${n}’s ${what} dropped — Envelope 1 has none`,
  replaced: (old, label) => `Replaced ${old} with ${NM} · ${label} · tap to undo`, added: label => `Added ${label} · tap to undo`,
  nowA: `Now a ${NM} · same sound · tap to undo`, nowAChanged: `Now a ${NM} · tap to undo`, cordPulled: 'Cord pulled · tap to undo',
  heavy: `This many ${NM} modules may stutter when zooming on this device.`, theInstrument: `the ${NM}`,
  rowsFull: (used, max) => `This ${NM}’s mod rows are full (${used}/${max})`, build: `${NM} panel`,
  s1Tip: 'Legacy renditions: Oscillator 1 / 2 warp slot 1 uses the 23 legacy warps, the sub its 5 shapes and level law, Filter 1 its 96 types and the gliding key-track reference, Hz LFOs ignore HOST, PHASE / RAND knob ends set the phase memory, and the bend ranges are ±24. Every other feature works in both modes. Switching back restores the legacy sound exactly.',
  // the legends (§3.2, §4.2, §3.1)
  gateTip: `Gated by the keys until an Envelope is plugged here · ${RIG.GATE_MS} ms ramps`, gateTipScaled: `${RIG.GATE_MS} ms · scaled by the ENV scale in the Amplifier’s drawer`,
  dry: 'dry', dryTip: 'Passes dry through this Filter at its LEVEL — its input switch is off', filterOff: 'Off: passes its input at its LEVEL',
  lastNote: '∿ last note',
  mpeLater: `MPE on a ${NM} arrives in a later update`, // (review 1 P2-3: midi.js stays byte-identical in WC-1 — the Amplifier's MPE… is off)
});

/* ---------------------------------------------------------------- the look (§4.5) */
/** The palette indices by source part (cv-cords PALETTE: 0 Red · 1 Yellow · 2 Blue · 3 Green · 4 Cream · 5 Orange · 6 Violet · 7 Black)
 * and the four alphas: on 1, the rig's own mod cords 0.85, off / bypassed / warp 0.45, the 24+ fade 0.3. Every rule colour reads on the
 * charcoal skin (≥ 3 : 1, review 2 P3-6): Noise is Cream — white noise — not Black (1.4 : 1 on charcoal); Black stays a user's pick. */
export const LOOK = deepFreeze({
  c: { oscA: 2, oscB: 3, oscC: 1, sub: 6, noise: 4, filter: 5, filter2: 0, arp: 6, clip: 6, env: 1, lfo: 5, macros: 2, warp: 5 },
  o: { on: 1, row: 0.85, off: 0.45, fade: 0.3 },
});
/** The colour of a cord from source end `a` ('oscA.out', 'lfo3.out#2' a row's ordinal): the user's pick (rig.cc, keyed by that end —
 * a re-patch keeps it) else the rule (a warp cord Orange whatever its source). → 0…7 */
export function cordColor(a, rig, kind) {
  const cc = isObj(rig) && isObj(rig.cc) ? rig.cc : null;
  if (cc && Number.isInteger(cc[a]) && cc[a] >= 0 && cc[a] <= 7) return cc[a];
  if (kind === 'warp') return LOOK.c.warp;
  const part = String(a || '').split('.')[0], k = kindOf(part);
  return LOOK.c[part] !== undefined ? LOOK.c[part] : k && LOOK.c[k] !== undefined ? LOOK.c[k] : 4;
}

/* ---------------------------------------------------------------- the state as sx-edges reads it */
const SRC = { oscA: { p: 'a', ch: 'A', path: ['osc', 0], dflt: 0 }, oscB: { p: 'b', ch: 'B', path: ['osc', 1], dflt: 1 }, oscC: { p: 'c', ch: 'C', path: ['osc', 2], dflt: 1 },
  sub: { p: 's', ch: 'S', path: ['sub'], dflt: 1 }, noise: { p: 'n', ch: 'N', path: ['noise'], dflt: 1 } };
const FK = { filter: 0, filter2: 1 };
const fin = x => typeof x === 'number' && isFinite(x);
const routeOf = (o, dflt) => (isObj(o) && fin(o.route) ? Math.max(0, Math.min(3, Math.round(o.route))) : dflt);
const shareOf = (s, part, k) => { const b = lawValue(SRC[part].p + '.fbal', destBase(s, null, SRC[part].p + '.fbal')); return k ? (1 + b) / 2 : (1 - b) / 2; };
const swId = (k, part) => (k ? 'f2.route' : 'f.route') + SRC[part].ch;
const swOn = (s, k, part) => destBase(s, null, swId(k, part)) >= 0.5;
const ENV_END = /^env([1-4])\.out$/, MOD_END = /^(?:env[1-4]|lfo(?:10|[1-9]))\.out$|^macros\.k[1-8]$/;
const parsePart = e => (typeof e === 'string' ? e.split('.')[0] : '');
const sxEnd = e => typeof e === 'string' && jackOf('x', e) !== null; // (an END sx-edges knows: sources, filters, VOICE, the own FX, ARP / CLIP, env1.out)
const isOut = e => /\.out$/.test(e) || /^macros\.k[1-8]$/.test(e);
const isIn = e => /\.(?:in|main|direct|note|level|warp)$/.test(e);
/** Does something read ENV 1 (a matrix row's src / aux, a link row 'iN/env1.out' in `used`)? Then the amp slot's Envelope has a module
 * even while it is the gate (§3.4). */
export const envRead = (s, used) => slotsUsed(s, used, true).has('env1');
const opt = o => (Array.isArray(o) || o instanceof Set ? { held: o } : isObj(o) ? o : {});
// slot names from a list of names ('env3') or cv-graph injection records ({ kind, k } — k 0-based)
const slotNames = L => new Set([...(L == null ? [] : typeof L === 'string' ? [L] : L)].map(x => (typeof x === 'string' ? x : isObj(x) && typeof x.kind === 'string' ? x.kind + ((x.k | 0) + 1) : '')).filter(Boolean));

/* ---------------------------------------------------------------- field writes: a structural diff, applied along paths */
const isPlain = x => x !== null && typeof x === 'object';
/** [[path, before, after] …] between two states (leaves: primitives; an array whose length changed as one leaf) — the form sx-edges'
 * setEdge returns and main's sxApply / sxBack write (['p', id] for a knob, ['osc', 0, 'route'], ['matrix', 5, 'dst'], ['env', 0, 'bpm'] …). */
export function diff(a, b, path, out) {
  const P = path || [], O = out || [];
  if (a === b) return O;
  if (isPlain(a) && isPlain(b) && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a) && a.length !== b.length) { O.push([P, clone(a), clone(b)]); return O; }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], P.concat(Array.isArray(a) ? +k : k), O);
    return O;
  }
  if (!(typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b))) O.push([P, isPlain(a) ? clone(a) : a, isPlain(b) ? clone(b) : b]);
  return O;
}
/** Writes the after-values of `f` into s (in place; the host's sxFieldSet form). → s */
export function apply(s, f) {
  if (!isObj(s) || !Array.isArray(f)) return s;
  for (const x of f) {
    const path = x[0], v = x[2];
    if (!Array.isArray(path) || !path.length) continue;
    let o = s;
    for (let i = 0; i < path.length - 1; i++) { if (o[path[i]] == null || typeof o[path[i]] !== 'object') o[path[i]] = typeof path[i + 1] === 'number' ? [] : {}; o = o[path[i]]; }
    o[path[path.length - 1]] = isPlain(v) ? clone(v) : v;
  }
  return s;
}
const refuse = why => ({ f: [], why: why || WORDS.bad, notes: [] });
// (a slot move with equal fields is still a move: the modules swap places and names — `lay` without a write, review 1 P3-3)
const done = (f, notes, extra) => Object.assign({ f, why: f.length || (extra && Array.isArray(extra.lay) && extra.lay.length) ? '' : WORDS.same, notes: notes || [] }, extra || null);
// one write [[path, before, after]] when the value changes (p ids read as base values, as sx-edges' cur)
const w = (s, path, after) => { const before = path[0] === 'p' ? destBase(s, null, path[1]) : path[path.length - 1] === 'route' ? routeOf(at(s, path.slice(0, -1)), path[0] === 'osc' && path[1] === 0 ? 0 : 1) : at(s, path); return before === after ? null : [path, before, after]; };
const writes = (s, L) => L.map(([path, after]) => w(s, path, after)).filter(Boolean);

/* ---------------------------------------------------------------- edges (§4.1, §4.2) */
/** The rig's cords as cv-cables-shaped records: { id: 'x:<dev>:<edge id>', kind: 'audio' | 'note' | 'warp' | 'mod' (the amp-slot cord),
 * int (cv-cables' field: the kind; 'level' on the amp-slot cord), dev, edge: { a, b } (sx-edges' ends), a / b (the canvas jacks 'iN/oscA.out', 'iN.main'; the ends when dev is not a
 * string), src: [dev], c (palette index: cordColor), o (alpha), s: 0, ro?, dim?, fork?, share?, badge: 'BAL'?, dry? (a source into a
 * Filter whose input switch is off: it passes dry — the one documented difference from serumEdges, which calls it a stub), off? (the
 * target Filter is ⏻ off: it passes its input), env? (the AMP ENV switch at the Amplifier's end), label? / field? / tap: 'open' (warp) }.
 * Kind 'fx' (Amplifier → FX) is dropped: it is cv-cables' derived line. The amp-slot cord env1.out → voice.level exists iff
 * !isGate(s) or something reads ENV 1 (`used`: the host's link-row sources). Ids are sx-edges' ('a>b#field'), stable. */
export function edges(s, fx, dev, rig, used) {
  if (!isObj(s)) return [];
  const D = typeof dev === 'string' ? dev : null, out = [];
  const key = end => (D && end ? jackOf(D, end) || D + '/' + end : end);
  const mk = (a, b, kind, o) => {
    const field = o && o.field, eid = a + '>' + (b || '') + (field ? '#' + field : '');
    const r = Object.assign({ id: (D ? 'x:' + D + ':' : '') + eid, kind, int: kind, dev: D, edge: { a, b }, a: key(a), b: key(b), src: D ? [D] : [] }, o || null);
    r.c = cordColor(a, rig, kind);
    r.o = r.dim || kind === 'warp' ? LOOK.o.off : LOOK.o.on;
    r.s = 0;
    out.push(r);
    return r;
  };
  // sources: route 0 → a cord into each filter with a share above 0, whatever its switch (off: dry); 1 / 2 → the Amplifier
  for (const part of SRC_PARTS) {
    const S = SRC[part], X = at(s, S.path), r = routeOf(X, S.dflt), dim = !partOn(s, part), a = part + '.out';
    if (r === 0) {
      const lit = [0, 1].filter(k => shareOf(s, part, k) > 0);
      for (const k of lit) {
        const o = { share: shareOf(s, part, k) };
        if (lit.length === 2) { o.fork = true; o.badge = 'BAL'; }
        if (!swOn(s, k, part)) { o.dry = true; o.tag = WORDS.dry; }
        if (!partOn(s, FILTERS[k])) o.off = FILTERS[k];
        if (dim) o.dim = true;
        mk(a, FILTERS[k] + '.in', 'audio', o);
      }
    } else if (r === 1 || r === 2) mk(a, r === 1 ? 'voice.main' : 'voice.direct', 'audio', Object.assign({ env: isObj(X) && X.env !== undefined ? (X.env ? 1 : 0) : 1 }, dim ? { dim: true } : null));
  }
  // the filters, the note tools and the read-only warp / FM / pitch sources: sx-edges' (the own-FX edge dropped)
  for (const e of serumEdges(s, fx)) {
    if (e.kind === 'fx' || (e.kind === 'audio' && SRC[e.src])) continue;
    const o = {};
    if (e.dim) o.dim = true;
    if (e.ro) o.ro = true;
    if (e.env !== undefined) o.env = e.env;
    if (e.kind === 'warp') { o.tap = 'open'; o.label = e.what; o.field = e.field; }
    if (e.kind === 'audio' && e.b && FK[parsePart(e.b)] !== undefined && !partOn(s, parsePart(e.b))) o.off = parsePart(e.b);
    mk(e.a, e.b, e.kind, o);
  }
  if (!isGate(s) || envRead(s, used)) mk('env1.out', 'voice.level', 'mod', { int: 'level' });
  return out;
}

/* ---------------------------------------------------------------- can (§4.2) */
// the word for a source end that reaches nothing of the rig / the wrong kind of jack
const srcWord = a => { const p = parsePart(a); return SRC[p] ? WORDS.voice : FK[p] !== undefined ? WORDS.filter : p === 'arp' || p === 'clip' ? WORDS.notes : MOD_END.test(a) ? WORDS.mod : WORDS.bad; };
// sx-edges' refusal → the rig's words (the keys are sx-edges' WHY's)
function word(why, a) {
  if (why === WHY.voice) return srcWord(a);
  if (why === WHY.bad) return WORDS.bad;
  for (const k of Object.keys(WHY)) if (WHY[k] === why && typeof WORDS[k] === 'string') return WORDS[k];
  return why || WORDS.bad;
}
/** May a cord run from output end `a` to input end `b` (sx-edges' ends of one rig)? → { ok, why, a, b }; pure (nothing touched). The
 * amp slot: `env<k>.out` → `voice.level` is ok while ENV 1 is the gate (k = 1: Envelope 1 takes the level over at Serum's envelope
 * defaults; k ≥ 2: envToAmp), refused "Envelope <n> already shapes the level — pull it first" otherwise (n: the amp slot's module's
 * fixed name, o.rig — pre-deploy [amp-held]: it said "Envelope 1" whoever held the slot), an LFO with its own word;
 * Envelope 1 standing as the gate (read by a row, or a link row in `o.used`: its cord on LEVEL drawn) is "Already connected" (review 1:
 * a re-drop never rewrites it); a source into a Filter it already feeds (wet or dry) is "Already connected"; everything else is
 * sx-edges' setEdge, its refusal in the rig's words. */
export function can(s, fx, a, b, o) {
  const R = (ok, why) => ({ ok, why, a, b });
  if (!isObj(s)) return R(false, WORDS.bad);
  const A = sxEnd(a) || (typeof a === 'string' && MOD_END.test(a));
  if (!A) return R(false, WORDS.bad);
  const B = sxEnd(b) || (typeof b === 'string' && MOD_END.test(b));
  if (!B) return R(false, srcWord(a));
  if (!isOut(a)) return R(false, WORDS.input);
  if (!isIn(b)) return R(false, WORDS.dir);
  if (b === 'voice.level') {
    const m = ENV_END.exec(a);
    if (!m) return R(false, /^lfo/.test(a) ? WORDS.lfoLevel : WORDS.level);
    if (!isGate(s)) return R(false, +m[1] === 1 ? WORDS.same : WORDS.ampHeld(ordinalOf(opt(o).rig, 'env1'))); // ((pre-deploy [amp-held]) the amp slot's module by its name)
    if (+m[1] === 1 && envRead(s, opt(o).used)) return R(false, WORDS.same);
    return R(true, '');
  }
  if (MOD_END.test(a)) return R(false, WORDS.mod);
  const p = parsePart(a), fk = FK[parsePart(b)];
  if (SRC[p] && fk !== undefined && /\.in$/.test(b)) { // a source into a Filter: the rig's rule (a dry cord is a cord)
    const X = at(s, SRC[p].path);
    if (routeOf(X, SRC[p].dflt) === 0 && shareOf(s, p, fk) > 0) return R(false, WORDS.same);
    return R(true, '');
  }
  const r = setEdge(s, fx, a, b);
  return r.edit ? R(true, '') : R(false, word(r.why, a));
}

/* ---------------------------------------------------------------- plug / pull / repatch (§4.2, §4.4) */
/** The writes that plug a → b. → { f, why, notes, lay?, links?, ids? } (`f` empty + `why` on a refusal). A source into a Filter: route
 * Filter with the balance at it and its switch on; into a Filter while the other has a cord: a fork (balance ½, this switch on, the
 * other cord as it was — wet or dry); into the Amplifier: route Main / Direct (its filter cords go, as Serum); a Filter / the note
 * tools: sx-edges' setEdge; env1.out → voice.level from the gate: ENV 1 at Serum's envelope defaults; env<k>.out → voice.level:
 * envToAmp(s, k, o). o = { held, shown, used, rig } (the slot moves). */
export function plug(s, fx, a, b, o) {
  const O = opt(o), c = can(s, fx, a, b, O);
  if (!c.ok) return refuse(c.why);
  if (b === 'voice.level') {
    const k = +ENV_END.exec(a)[1];
    if (k !== 1) return envToAmp(s, k, O);
    const T = setEnvDefault(clone(s));
    return done(diff(s, T), [WORDS.takesOver(ordinalOf(O.rig, 'env1'))]);
  }
  const p = parsePart(a), fk = FK[parsePart(b)];
  if (SRC[p] && fk !== undefined) {
    const S = SRC[p], X = at(s, S.path), r = routeOf(X, S.dflt);
    if (r === 0 && shareOf(s, p, 1 - fk) > 0) return done(writes(s, [[['p', S.p + '.fbal'], 0.5], [['p', swId(fk, p)], 1]]), []);
    return done(writes(s, [[S.path.concat('route'), 0], [['p', S.p + '.fbal'], fk], [['p', swId(fk, p)], 1]]), []);
  }
  const r = setEdge(s, fx, a, b);
  return r.edit ? done(r.f, []) : refuse(word(r.why, a));
}
// an edges() id → its record (the id as given, 'x:<dev>:<edge id>' or the bare edge id)
function recordOf(s, fx, id, O) {
  const m = /^x:([a-z][a-z0-9]*):(.+)$/.exec(String(id || '')), dev = m ? m[1] : O.dev || null, eid = m ? m[2] : String(id || '');
  const L = edges(s, fx, dev, O.rig, O.used), pre = typeof dev === 'string' ? 'x:' + dev + ':' : '';
  return { rec: L.find(r => r.id === pre + eid) || null, dev };
}
/** The writes that pull the cord `id` (an edges() id): a fork's branch → the balance all to the other Filter; a source's / a Filter's one
 * cord → route None; a note cord → the tool's ⏻ off; the amp-slot cord → envFromAmp(s, o); a read-only cord refused. */
export function pull(s, fx, id, o) {
  if (!isObj(s)) return refuse(WORDS.bad);
  const O = opt(o), { rec } = recordOf(s, fx, id, O);
  if (!rec) return refuse(WORDS.none);
  if (rec.ro) return refuse(rec.kind === 'warp' ? WORDS.ro : WORDS.fx);
  const { a, b } = rec.edge, p = parsePart(a);
  if (b === 'voice.level') return envFromAmp(s, O);
  if (SRC[p]) {
    const S = SRC[p], fk = FK[parsePart(b)];
    if (rec.fork && fk !== undefined) return done(writes(s, [[['p', S.p + '.fbal'], 1 - fk]]), []);
    return done(writes(s, [[S.path.concat('route'), 3]]), []);
  }
  if (FK[p] !== undefined) return done(writes(s, [[['filter', FK[p], 'route'], 3]]), []);
  if (p === 'arp' || p === 'clip') return done(writes(s, [[['p', POWER[p]], 0]]), []);
  return refuse(WORDS.bad);
}
// two simultaneous renames in a row ([[from, to] …], to null: dropped) → the one rename x ↦ B(A(x)), each key once, identities left out
// (review 1 P3-3: concatenated, a key of both — 'env1.out' after envFromAmp then envToAmp — collapsed in the host's Map to the wrong one)
function compose(A, B) {
  const f = new Map(A || []), g = new Map(B || []), to = x => { const y = f.has(x) ? f.get(x) : x; return y == null ? null : g.has(y) ? g.get(y) : y; };
  return [...new Set([...f.keys(), ...g.keys()])].map(x => [x, to(x)]).filter(([x, y]) => x !== y);
}
// the editor options after slot move r (its lay / links applied): `shown` and `used` renamed, the ordinals moved — what the second
// editor of one step reads (repatch's plug after its pull: whether ENV 1 is read, the free slots, the names in the notes)
function moved(O, r) {
  const L = new Map(r.lay || []), K = new Map(r.links || []);
  if (!L.size && !K.size) return O;
  const end = x => { if (typeof x !== 'string') return x; const i = x.lastIndexOf('/'), e = x.slice(i + 1); return x.slice(0, i + 1) + (K.has(e) ? K.get(e) : L.has(e) ? L.get(e) : e); };
  const R = Object.assign({}, O, { shown: Array.isArray(O.shown) || O.shown instanceof Set ? [...O.shown].map(end) : O.shown, used: Array.isArray(O.used) ? O.used.map(end) : O.used });
  if (isObj(O.rig) && isObj(O.rig.n)) {
    const n = Object.assign({}, O.rig.n);
    for (const a of L.keys()) delete n[a];
    for (const [a, b] of L) n[b] = ordinalOf(O.rig, a);
    R.rig = Object.assign({}, O.rig, { n });
  }
  return R;
}
/** Moves one end of the cord `id` to jack `b` (end 'a': its source, 'b': its target) — a pull then a plug, one step: the combined writes.
 * The amp-slot cord's source end moved to another Envelope: envFromAmp then envToAmp, the second reading the first's renames (`used`
 * / `shown` / the ordinals), their lay / links / ids composed into one rename each (simultaneous, as one move's). */
export function repatch(s, fx, id, end, b, o) {
  if (!isObj(s)) return refuse(WORDS.bad);
  const O = opt(o), { rec } = recordOf(s, fx, id, O);
  if (!rec) return refuse(WORDS.none);
  const A = end === 'a' ? b : rec.edge.a, B = end === 'a' ? rec.edge.b : b;
  if (A === rec.edge.a && B === rec.edge.b) return refuse(WORDS.same);
  const T = clone(s), p1 = pull(T, fx, id, O);
  if (p1.why) return refuse(p1.why);
  apply(T, p1.f);
  const O2 = moved(O, p1), c = can(T, fx, A, B, O2);
  if (!c.ok) return refuse(c.why);
  const p2 = plug(T, fx, A, B, O2);
  if (p2.why) return refuse(p2.why);
  apply(T, p2.f);
  const lay = compose(p1.lay, p2.lay), links = compose(p1.links, p2.links), ids = compose(p1.ids, p2.ids);
  return done(diff(s, T), p1.notes.concat(p2.notes), { lay, links, ids });
}

/* ---------------------------------------------------------------- the ENV slot moves (§3.4) */
const ENV_K = /^env([2-4])$/;
const envName = k => 'env' + k;
// every destination id of module `from` → module `to`'s by suffix ([id, null] when `to` has none: ENV 1 has no START / END)
function idMap(from, to) {
  const a = 'e' + from.slice(3) + '.', b = 'e' + to.slice(3) + '.';
  return MODULE_FIELDS[from].p.map(id => { const t = b + id.slice(a.length); return [id, DEST_INDEX[t] !== undefined ? t : null]; });
}
// in place: rows' sources (src / aux), s.midi's and s.locks' destination ids, s.locks.mod's module names swapped between the two ENV
// modules (swapModules moves the fields, the flags and the rows' destinations; this is the rest)
function swapRest(T, m1, m2) {
  const S = new Map([[m1, m2], [m2, m1]]), I = new Map(idMap(m1, m2).concat(idMap(m2, m1)).filter(x => x[1]));
  const sw = x => (S.has(x) ? S.get(x) : x), swId2 = x => (I.has(x) ? I.get(x) : x);
  for (const r of Array.isArray(T.matrix) ? T.matrix : []) if (isObj(r)) { if (typeof r.src === 'string') r.src = sw(r.src); if (typeof r.aux === 'string') r.aux = sw(r.aux); }
  if (isObj(T.midi)) for (const k of Object.keys(T.midi)) T.midi[k] = swId2(T.midi[k]);
  if (isObj(T.locks)) {
    if (Array.isArray(T.locks.p)) T.locks.p = T.locks.p.map(swId2);
    if (Array.isArray(T.locks.unp)) T.locks.unp = T.locks.unp.map(swId2);
    if (Array.isArray(T.locks.mod)) T.locks.mod = T.locks.mod.map(sw);
  }
}
const slotK = k => (Number.isInteger(k) ? k : typeof k === 'string' && ENV_K.test(k) ? +k.slice(3) : NaN);
/** Plugs Envelope k (2–4) into LEVEL while ENV 1 is the gate: serum-core swapModules (ENV 1 ↔ ENV k: the fields — the sustain re-lawed
 * through the value, pow2 vs lin —, the flags, START / END dropped into ENV 1, every row's destination re-targeted by suffix both ways)
 * + the rows' sources, s.midi / s.locks and the lay rename; slot k then holds the gate's values and, read by nothing, returns to Serum's
 * defaults (its module goes) — read (a row or a link row named ENV 1), it stays as the module that was Envelope 1 (lay both ways).
 * Refused while a non-gate envelope holds the slot. → { f, why, notes, lay: [[fromPart, toPart] …] (simultaneous), links:
 * [[fromEnd, toEnd] …] (the host's link-row sources, part-relative: 'env3.out' → 'env1.out'), ids: [[fromId, toId | null] …] (the
 * host's canvas rows 'iN:e3.dec' → 'iN:e1.dec'; null: dropped) }. o = { held, shown, used, rig } or `held`. */
export function envToAmp(s, k, o) {
  const K = slotK(k), O = opt(o);
  if (!isObj(s) || !(K >= 2 && K <= 4)) return refuse(WORDS.badEnv);
  if (!isGate(s)) return refuse(WORDS.ampHeld(ordinalOf(O.rig, 'env1')));
  const m = envName(K), T = clone(s), notes = [], read1 = envRead(s, O.used);
  const se = ['start', 'end'].filter(x => destBase(s, null, 'e' + K + '.' + x) > 0);
  if (!swapModules(T, 'env1', m)) return refuse(WORDS.badEnv);
  swapRest(T, 'env1', m);
  if (!read1) initModule(T, m); // (slot k holds the gate's values now; read by nothing → Serum's defaults, the rows onto it cleared: its module goes)
  notes.push(WORDS.takesOver(ordinalOf(O.rig, m)));
  if (se.length) notes.push(WORDS.dropped(ordinalOf(O.rig, m), se.map(x => x.toUpperCase()).join(' and ')));
  const lay = [[m, 'env1']];
  if (read1) lay.push(['env1', m]);
  return done(diff(s, T), notes, { lay, links: [[m + '.out', 'env1.out'], ['env1.out', m + '.out']], ids: idMap(m, 'env1').concat(idMap('env1', m)) });
}
/** Pulls the amp Envelope's cord: ENV 1 moves to the first free slot k of 2–4 — free = read by nothing (slotsUsed with the link rows
 * `used`), not laid on the canvas (`shown`: an unplugged Envelope module keeps its slot) and not held by a canvas-modulator injection
 * (`held`: cv-graph's inj slots) — by the same swap (the sustain re-lawed back, the flags, the rows both ways, the lay rename) and ENV 1
 * is the gate again. None free: refused ("… remove one first" / "… held by canvas modulators"). → as envToAmp. */
export function envFromAmp(s, o) {
  const O = opt(o);
  if (!isObj(s)) return refuse(WORDS.badEnv);
  if (isGate(s)) return refuse(WORDS.gate);
  const U = slotsUsed(s, O.used, true), H = slotNames(O.held), S = slotNames(O.shown);
  let K = 0, held = false;
  for (const part of ['env2', 'env3', 'env4']) {
    if (U.has(part) || S.has(part)) continue;
    if (H.has(part)) { held = true; continue; }
    K = +part.slice(3); break;
  }
  if (!K) return refuse(held ? WORDS.envHeld : WORDS.envFull);
  const m = envName(K), T = clone(s), n = ordinalOf(O.rig, 'env1');
  if (!swapModules(T, 'env1', m)) return refuse(WORDS.badEnv);
  swapRest(T, 'env1', m);
  setGate(T);
  return done(diff(s, T), [WORDS.unplugged(n)], { lay: [['env1', m]], links: [['env1.out', m + '.out']], ids: idMap('env1', m) });
}

/* ---------------------------------------------------------------- the modules of a rig (§3.4 I1 / I2 / I1', the amp slot) */
/** The parts of rig `dev` that get a module, in PARTS order: sx-edges' partKeys (I1 a power field on, I2 a slot read by a row or a link
 * row in `used`, a laid part stays) + `env1` iff !isGate(s) or something reads ENV 1 (the amp slot's Envelope: while it is the gate and
 * unread nothing shows but the legend) + I1': a Filter whenever a powered source routes into it with a share above 0, **or the other
 * Filter routes into it while that one is powered or itself fed so** (review 1 P2-1: Filter 2 → an off Filter 1 sounds through it),
 * even when the Filter is ⏻ off (it passes its input, serum-dsp; 30 of the 86 factory presets) — no audible path without its cord.
 * `rig` is unused here (the signature of §2.3). */
export function partKeys(s, lay, dev, used, rig) { // eslint-disable-line no-unused-vars
  const K = new Set(sxPartKeys(s, lay, dev, used));
  K.delete('env1');
  if (isObj(s)) {
    if (!isGate(s) || envRead(s, used)) K.add('env1');
    const fed = new Set();
    for (const part of SRC_PARTS) {
      if (!partOn(s, part)) continue;
      const S = SRC[part];
      if (routeOf(at(s, S.path), S.dflt) !== 0) continue;
      for (const k of [0, 1]) if (shareOf(s, part, k) > 0) fed.add(FILTERS[k]);
    }
    for (const k of [0, 1]) if ((partOn(s, FILTERS[k]) || fed.has(FILTERS[k])) && routeOf(at(s, ['filter', k]), 1) === 0) fed.add(FILTERS[1 - k]); // (one direction only: the normaliser's F1 ↔ F2 rule)
    for (const f of fed) K.add(f);
  }
  return PARTS.filter(p => K.has(p));
}

/* ---------------------------------------------------------------- Tidy's targets (review 2 P2-5, the user's rule) */
// a matrix destination's module: the id's prefix ('a.wt' → oscA, 'f2.res' → filter2, 'e3.att' → env3, 'l7.rate' → lfo7, 'm2' → macros, 'fx.…'
// → the Effects), anything else of the instrument ('g.amp', 'vc.…', 'c1.rate', 'bus3') the Amplifier
const DEST_PART = { a: 'oscA', b: 'oscB', c: 'oscC', s: 'sub', n: 'noise', f: 'filter', f2: 'filter2', fx: 'fx', arp: 'arp', clip: 'clip' };
const destPart = id => { const p = String(id || '').split('.')[0], m = /^([el])(\d+)$/.exec(p); return DEST_PART[p] || (m ? (m[1] === 'e' ? 'env' : 'lfo') + m[2] : /^m[1-8]$/.test(p) ? 'macros' : 'voice'); };
const SRC_PART = src => (/^macro[1-8]$/.test(src || '') ? 'macros' : /^(?:env[1-4]|lfo(?:10|[1-9]))$/.test(src || '') ? src : null);
/** What each standing modulator of the rig drives, for Tidy's band (cv-module tidy's opts.targets through the host): modulator part →
 * the parts its cords end on — Envelope 1 the Amplifier ('voice') first (the amp slot: its cord, by definition of its module), then
 * each matrix row's destination module in row order ('fx' the Effects), each once; a destination whose module is not standing parks on
 * the Amplifier (its end does too). `parts`: the modules standing (partKeys / the laid ones). Pure. → { [part]: [part …] } */
export function targetsOf(s, parts) {
  const P = new Set(Array.isArray(parts) ? parts : []), out = {};
  if (!isObj(s)) return out;
  const add = (src, to) => { if (!P.has(src)) return; const L = out[src] || (out[src] = []); if (!L.includes(to)) L.push(to); };
  if (P.has('env1')) add('env1', 'voice');
  for (const r of Array.isArray(s.matrix) ? s.matrix : []) {
    const src = isObj(r) ? SRC_PART(r.src) : null;
    if (!src || !P.has(src) || !r.dst || r.dst === 'none') continue;
    const to = destPart(r.dst);
    add(src, to === 'voice' || to === 'fx' || P.has(to) ? to : 'voice');
  }
  return out;
}

/* ---------------------------------------------------------------- names (§3.4: fixed ordinals) */
const SLOT_N = part => { const m = /^(?:osc([ABC])|filter(2)?|env([1-4])|lfo(10|[1-9]))$/.exec(part || ''); return !m ? 1 : m[1] ? 'ABC'.indexOf(m[1]) + 1 : m[2] ? 2 : m[3] ? +m[3] : m[4] ? +m[4] : 1; };
/** A module's display ordinal: dev.rig.n[part] when set (given at creation, kept across slot moves), else its engine slot's. */
export function ordinalOf(rig, part) {
  const n = isObj(rig) && isObj(rig.n) ? rig.n[part] : undefined;
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : SLOT_N(part);
}
/** The bar title of a part: 'Oscillator 1', 'Envelope 2' (the fixed ordinal), 'Sub oscillator', 'Macros'; 'voice' / 'amp' / nothing →
 * 'Amplifier'; 'fx' → 'Effects'. */
export function labelOf(part, rig) {
  if (part == null || part === '' || part === 'voice' || part === 'amp') return MODULES.amp.label;
  if (part === 'fx') return 'Effects';
  const k = kindOf(part), M = k ? MODULES[k] : null;
  if (!M) return String(part);
  return M.labelN ? M.labelN(ordinalOf(rig, part)) : M.label;
}
/** A module bar's title: labelOf, or the kind's `bar` where the full name outgrows its face's bar (review 2 P3-2: a 3-column bar leaves its
 * title 84 px — "SUB OSCILLATOR" is 104 at 13 px — so the Sub oscillator's bar says "Sub osc", as hardware prints it; every other text
 * keeps the full name). */
export function barOf(part, rig) {
  const k = kindOf(part), M = k ? MODULES[k] : null;
  return M && M.bar ? M.bar : labelOf(part, rig);
}
/** The display name of a lay key: 'i1/env2' → labelOf('env2', rig), 'i1' → 'Amplifier', 'i1/fx' → 'Effects'. */
export function nameOf(rig, key) {
  const q = splitKey(key);
  if (q) return labelOf(q.part, rig);
  return typeof key === 'string' && /^[a-z][a-z0-9]*\/fx$/.test(key) ? labelOf('fx', rig) : MODULES.amp.label;
}
/** The ordinal a new module of `kind` gets: the lowest 1…99 none of `parts` (the rig's modules of that kind) shows. */
export function nextOrdinal(rig, kind, parts) {
  const used = new Set((Array.isArray(parts) ? parts : []).filter(p => kindOf(p) === kind).map(p => ordinalOf(rig, p)));
  for (let n = 1; n <= 99; n++) if (!used.has(n)) return n;
  return 99;
}
