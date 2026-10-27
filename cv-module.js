// cv-module.js — canvas module chrome (top bar, body, jacks, fold), the stage-1b track layout (instrument,
// FX panel, OUT) and the camera-pref helpers (SPEC-canvas §2.6, §2.8, §4.5, §5.1 lay; contract: docs/canvas/IMPL-1b.md
// §4.4). Owner: MODULES lane.
// Rules: plain ES module, no DOM at module top level (node imports it), survives tests/main-sim.mjs's DOM stub;
// imports carry ?v=9.
//
// A module = .cv-mod[data-cv-mod][data-cv-kind] absolutely positioned in #world at its lay entry (top-left, world px):
//   .cv-bar (40 world px; drag = move, tap = select, double-tap = focus, long-press / right-click / ⋯ = menu, ▾ = fold)
//   .cv-body (the existing panel: #inst, #fxrack, the scope) and .cv-jack × n. The module's ring is a box-shadow, so a
//   folded module is exactly BAR_H tall and the jack offsets are pure geometry (w, fold): nothing is measured per frame. contain: paint
//   sits on the body, not the root: the jacks' hit circles and the bar's upward hit extension lie outside the module box.
// Zoom consistency (IMPL-panels §8.2): the body mounts once at creation and stays mounted for the module's life (no cards,
// nothing hidden at any zoom); off screen the root carries [data-cv-off] (CSS animations pause, host.shown → monitors).
// No module is resizable (the user's rule, 2026-10-18): each has one fixed width that fits all of its content — a classic
// instrument's Hardware layout its panel's size (host.size: {fixed: {w, h}}, cv-panel sizeOf: no measuring), its Simple
// layout FLOW_W of its model and a Serum W_SERUM (host.size: {fixed: {w}}: the height measured), the FX panel W_FX, OUT
// W_OUT. A stored width (track.lay.<id>.w, from before the rule) is ignored and never written again.
// Stage 1e (IMPL-1e §4.1): several devices per track. A module key is a device id ('i1', 'i2', 'fx1', 'i2/fx' — a Serum's
// own FX —, 'out'). createModule gains power (⏻ on the bar, [data-off] dims the module), the key-zone pill (instruments:
// "keys: all" / "keys: C3–C6 · +12", a tap opens low / high / transpose) and a bar badge. createTrackView is device-driven
// when the host gives devices(track) (else exactly the stage-1b view: instrument, FX, OUT); devicesOf(track) is the default
// list, tidy() lays out any number of devices, the cables come from track.wires (cv-cables cablesOf).
// Stage 2a (IMPL-2a §3): modulator modules — kind 'mod' (the project Mod Wheel 'wheel', a track's Velocity 've',
// Aftertouch 'at', Bend 'bd'): W_MOD wide, MOD_H tall by mod kind, one right mod-out jack (patchable whatever host.patch
// says), a column left of the instruments in Tidy; mod cables end on the knobs (destPort: [data-dest] offsets cached per
// module, measured on demand after a layout change, never per frame).
// Milestone 3 (IMPL-3 §2.1–2.2, §2.5, §2.7; lane C): Serum PART modules — host.devices(T) entries {key: 'iN/oscB', kind:
// 'part', dev: 'iN', part: 'oscB', model: 'serum', title} (lane D builds them from sx-edges partKeys): PART_JACKS by the
// part's kind, the group colour stripe (the Serum's), the chip 'S<n>', dimmed ([data-off]) while the part is off, the
// panel's own ⏻ in the bar's power slot (host.powerEl(key) → View.power: a data-dest="x.on" control — the bar ⏻ is the
// cable end), width host.size(key) else PART_W_DEF, height measured. VOICE is the device key itself: a Serum in parts view
// (lay[iN].ui === 'parts', or its device entry's ui) gets VOICE_JACKS (main / direct / note in, out → own FX, env1 mod-out);
// a view switch rebuilds the module (its jacks change). Jacks may be INLINE ({side: 'inline'}): anchored on the element
// [data-jack="<port>"] inside the module (B's MacrosPanel tiles k1…k8) — measured module-local at mount / relayout (a
// layout read outside bursts), the anchor itself becomes the jack ([data-cv-jack]); without an anchor (a 2b body) a dot
// at the right edge at the spec's y. The modulator column grows leftwards: MOD_W per kind (the Serum-faithful LFO / ENV /
// Macro / Chaos panels at their 1200 px bundled widths rounded to the dots; their heights measured), each modulator at x =
// modX(kind) (its right edge ≤ −MOD_GAP). Tidy lays a Serum in parts view out left to right: modulators → note tools →
// sources → filters → VOICE (its own ENV / LFO / MACROS stacked above it) → own FX → panels → OUT. Selecting a Serum
// outlines its members ([data-cv-member]). A knob end no mounted view of a Serum in parts view shows ends at VOICE's bar,
// {hid: true, tag} (cv-cables dashes it, tags its badge). [data-twin] controls are no ends.
// Stage 7d + 8 (IMPL-8 §1.1, §5.4, §9; lane U): the project's Pads modules ({key: 'pd<n>', kind: 'mod', mod: 'pads', jacks,
// color} in host.devices — not in MOD_ORDER: Tidy puts them after the modulators) are host-sized (host.size(key): pads-core's
// footprint, known before the module exists, so Tidy places it by its own width) and carry their jacks in the device entry
// (jacksOf reads entry.jacks: the mod pads' inline 'p<i>' and the 'notes' jack). A jack spec's `hide` (a pad outside the grid)
// keeps the jack in the set — no rebuild at a Grid… change — with its fallback dot hidden too, its cable ending at the
// module's right edge at the bar's height; it follows the entry on every sync / refresh, and so does its label (a renamed mod
// pad: the dot's and the anchor's aria-label / title, no rebuild). The 'notes' jack (kind 'note') is
// never patchable; a note cable's b '<dev>.' + NOTE_END ends on the instrument's left edge (ports(): no jack there, review #13).
// Stage 9 (IMPL-9 §4.1–§4.5; lane U9): FACE jacks (a jack spec {side: 'face', x, y, kind: 'cord', sig, dir, label, hit}: a
// transparent span.cv-jack.cv-fjack at its module-local point — the face draws the jack —, its hit circle clamped by --jp, port()
// that point, nothing measured; pressable whatever host.patch: cv-cables hands a cord jack's press to cv-patch; one tab stop per
// module, the arrows move it), patch modules (kind 'pm', 'iN/m<k>': their entry's size and face jacks, the compact bar — title
// over its sub, ⋯ —, no fold; nofold on any entry: the controller), Tidy's patch rows from host.rackLayout, host.onRelay(ports)
// after every relayout (the cord layer's anchors), host.members(key) (a driver outlines its driven modules).
import * as wk from './wk.js?v=9';
import { DOT } from './cv-world.js?v=9';
import { createCables, deriveCables, cablesOf, jackPort, createCableDrag, MOD_COLOR, MOD_PREFIX, keyKind, MACRO_PORTS, partsView, hiddenTag, NOTE_END } from './cv-cables.js?v=9';
import { PARTS, splitKey, kindOf as sxKind, partLabel, partOn, endOf } from './sx-edges.js?v=9';
// ((WC) a part's kind; ENV 1 is a module of the rig — an Envelope — whether or not sx-edges' table knows it yet)
const partKind = p => sxKind(p) || (p === 'env1' ? 'env' : null);
import { isSxId } from './models.js?v=9'; // ((WC) the own-FX key and module of a Serum-engine device — the Serum and the rig; the bundled panel's sizes stay the Serum's)
export { MOD_COLOR, MOD_PREFIX, keyKind } from './cv-cables.js?v=9';

/** Top bar height on every device (world px); the bar's hit area grows upward only (::before, calc(… * var(--ik))). */
export const BAR_H = 40;
/** Module widths (world px; fixed — nothing is resizable): a Serum's (its ≥ 1100 container layout), the FX panel's, OUT's,
 * and W_CLASSIC for a classic model FLOW_W does not list. */
export const W_CLASSIC = 1080, W_SERUM = 1200, W_FX = 760, W_OUT = 280;
/** A classic synth's Simple ('flow') layout width per model (world px, on the dots): measured so that every section,
 * control and the TB-303 step sequencer fit with room to spare (nothing clips or scrolls: the TB-303's steps need
 * ≥ 608, the DX7's operator rows ≥ 992), the sections packed into the fewest, fullest rows. */
export const FLOW_W = Object.freeze({
  modular: 1024, minimoog: 1184, arp2600: 1088, solina: 992, cs80: 1024, prophet5: 1088,
  ms20: 1056, tb303: 832, obxa: 1056, jupiter8: 864, juno60: 864, dx7: 1024,
});
/** (2a) A modulator module's width and its fixed height per mod kind (world px, the bar included, on the dots); the order
 * of Tidy's modulator column (the wheel first; (2b, IMPL-2b §1.1) then the singletons, then the multi-instance kinds by
 * number). (2b) MOD_KINDS: every track-device mod kind devicesOf lists (the project wheel is the host's). */
export const W_MOD = 240;
/** (2b) the heights by mod kind; (milestone 3) for the Serum-faithful kinds (SX_MODS: LFO / ENV / Macro / Chaos, their bodies
 * a Serum panel whose height is its content, measured) Tidy's and the drop ghost's guess until measured. */
export const MOD_H = Object.freeze({ wheel: 224, velo: 192, at: 128, bend: 128, note: 160, lfo: 256, env: 224, macro: 288, cc: 160, chaos: 224 });
export const MOD_ORDER = Object.freeze(['wheel', 'velo', 'at', 'bend', 'note', 'lfo', 'env', 'macro', 'cc', 'chaos']);
export const MOD_KINDS = Object.freeze(new Set(MOD_ORDER.filter(k => k !== 'wheel')));
/** (milestone 3, IMPL-3 §2.2) The modulator kinds whose body is a Serum panel on a slot host (lane B: the same class a Serum's
 * own slot uses): height = content (measured), width MOD_W. */
export const SX_MODS = Object.freeze(new Set(['lfo', 'env', 'macro', 'chaos']));
/** (milestone 3) A module width from a panel's: its width in the 1200 px bundled Serum rounded up to the dots (32 px). */
export const roundW = w => Math.ceil((+w || 0) / DOT) * DOT;
/** (milestone 3, §2.2) The modulator module widths by kind (world px): the Serum-faithful ones their panels' columns in the
 * 1200 px bundled Serum (sx-ui-mod PART_W, lane B: LFO 393 → 416, ENV 314 → 320, MACROS 236 → 256; the chaos row a GLOBAL
 * page column ≈ 388 → 416) rounded by roundW — frozen here (cv-migrate STEPS[6] reads them); the parity gate re-measures —,
 * the others W_MOD. */
export const MOD_W = Object.freeze({ wheel: W_MOD, velo: W_MOD, at: W_MOD, bend: W_MOD, note: W_MOD, cc: W_MOD, lfo: 416, env: 320, macro: 256, chaos: 416 });
/** (milestone 3) A modulator module's width by mod kind (W_MOD for an unknown one). */
export const modW = kind => MOD_W[kind] || W_MOD;
/** (2b) A macro module's knob rows: MACRO_ROW world px each from MACRO_Y0 (the bar, then the body's padding; cv-mods-ui
 * macroBody and style.css .cv-mmacro agree); a jack k<n> sits at the row's middle on the right edge. */
export const MACRO_ROW = 28, MACRO_Y0 = BAR_H + 12;
/** (2b) The module-local y of jack `i` (0-based) of a module of mod kind `kind`, unfolded: a macro's knob rows, every
 * other kind the single out jack at JACK_Y. Pure. */
export function modJackY(kind, i) { return kind === 'macro' ? MACRO_Y0 + MACRO_ROW * (i | 0) + MACRO_ROW / 2 : BAR_H + JACK_Y; }
/** (2b) The jack specs of a modulator module by kind: a macro's k1…k8, else one 'out'. (Milestone 3) a macro's are INLINE:
 * each name tile of its Serum MACROS panel ([data-jack="k<n>"]) is its jack; without the tiles (a 2b body) at the right
 * edge at its knob rows (y). */
export function modJacks(kind, title) {
  const T = title || 'Modulator';
  if (kind === 'macro') return MACRO_PORTS.map((id, i) => ({ id, side: 'inline', kind: 'mod', label: T + ' knob ' + (i + 1), y: modJackY(kind, i) }));
  return [{ id: 'out', side: 'right', kind: 'mod', label: T + ' out' }];
}
/** (2a U8) The gap between the modulator column and the instruments (world px): the column at x −(W_MOD + MOD_GAP) = −320,
 * so a fit with the Sources tray open on a portrait iPad keeps it beside the instrument. (Milestone 3) every modulator's
 * right edge stays at x ≤ −MOD_GAP: modX(kind). */
export const MOD_GAP = 80;
/** (milestone 3, §2.2) A modulator's x in the left-growing column: −⌈(MOD_W[kind] + MOD_GAP) / 32⌉ · 32 (−320 for the 240 px
 * kinds, −512 for an LFO). */
export const modX = kind => -roundW(modW(kind) + MOD_GAP);

/* ---- (milestone 3) Serum parts */
/** A part module's default width by part kind (world px; the host's size(key) — lane B's PART_W, rounded — wins): the
 * panels' columns in the 1200 px bundled Serum rounded to the dots; VOICE (parts view) holds VOICING + ENV 1 + OUTPUTS. */
export const PART_W_DEF = Object.freeze({ osc: 288, sub: 192, noise: 192, filter: 224, env: 320, lfo: 416, macros: 256, arp: 480, clip: 640, voice: 448, amp: 288 });
/** Tidy's height guesses for parts until measured (world px); (WC) amp: a rig's Amplifier (4 RIG-grid columns, §3.1). */
export const PART_H_DEF = Object.freeze({ osc: 384, sub: 224, noise: 224, filter: 320, env: 256, lfo: 320, macros: 224, arp: 384, clip: 448, voice: 640, amp: 416 });
const AUD = (id, side, label, y, kind) => ({ id, side, kind: kind || 'audio', label, y });
/** (WC, IMPL-WC §3.2, §4.4, §11.1; lane C) The drawing modes of a rig's canvas (rig-core RIG.WIRES, the host's drawMode). */
export const WIRES = Object.freeze(['cords', 'lines']);
/** (WC) A rig's jacks — its modules' jack rows (rig-ui's faces): every one INLINE (its anchor [data-jack="<port>"] in the row, measured
 * once a relayout; without one the dot at the right edge), its dir set, awake at every zoom (cv-world: data-cv-awake), its kind by
 * the canvas's drawing mode — 'cords': kind 'cord' + role (the stage-3 kind: audio / note / mod / warp, cv-cables' cords-mode drag)
 * + sig 'v'; 'lines': stage 3's kinds (cv-cables' line drags, the regret path §4.7). part: a part's name (env1 an Envelope) or 'amp'
 * (the Amplifier, the device key iN: IN · DIRECT · LEVEL (the amp slot, sx-edges voice.level) · NOTE ‖ OUT). The labels: the module's
 * title and the port's (the face prints its own). */
export function rigJacks(part, title, mode) {
  const cord = mode === 'cords', k = part === 'amp' ? 'amp' : partKind(part), T = title || (part === 'amp' ? 'Amplifier' : partLabel(part));
  const J = (id, role, dir, label) => (cord ? { id, side: 'inline', kind: 'cord', role, dir, sig: 'v', awake: true, label: T + ' ' + label }
    : { id, side: 'inline', kind: role, dir, awake: true, label: T + ' ' + label });
  if (k === 'amp') return [J('main', 'audio', 'in', 'IN'), J('direct', 'audio', 'in', 'DIRECT'), J('level', 'audio', 'in', 'LEVEL'), J('note', 'note', 'in', 'NOTE'), J('out', 'audio', 'out', 'OUT')];
  if (k === 'osc') return [J('out', 'audio', 'out', 'out'), J('warp', 'warp', 'in', 'warp / FM source')];
  if (k === 'sub' || k === 'noise') return [J('out', 'audio', 'out', 'out')];
  if (k === 'filter') return [J('in', 'audio', 'in', 'in'), J('out', 'audio', 'out', 'out')];
  if (k === 'env' || k === 'lfo') return [J('out', 'mod', 'out', 'out')];
  if (k === 'macros') return MACRO_PORTS.map((id, i) => J(id, 'mod', 'out', String(i + 1)));
  if (k === 'arp' || k === 'clip') return [J('out', 'note', 'out', 'notes')];
  return [];
}
/** The jacks of a part by its kind (sx-edges ENDs '<part>.<port>'): a source's out (right) and, on an oscillator, its
 * read-only warp / FM / RM / pitch input (left, kind 'warp'); a filter's in / out; an own ENV / LFO's mod-out; MACROS' k1…k8
 * inline (its name tiles); ARP / CLIP a note out. (WC) mode 'cords' | 'lines': a rig's jacks (rigJacks); env1 an Envelope. */
export function partJacks(part, title, mode) {
  if (WIRES.includes(mode)) return rigJacks(part, title, mode);
  const k = partKind(part), T = title || partLabel(part);
  if (k === 'osc') return [AUD('out', 'right', T + ' out'), AUD('warp', 'left', T + ' warp / FM source', undefined, 'warp')];
  if (k === 'sub' || k === 'noise') return [AUD('out', 'right', T + ' out')];
  if (k === 'filter') return [AUD('in', 'left', T + ' in'), AUD('out', 'right', T + ' out')];
  if (k === 'env' || k === 'lfo') return [{ id: 'out', side: 'right', kind: 'mod', label: T + ' out' }];
  if (k === 'macros') return MACRO_PORTS.map((id, i) => ({ id, side: 'inline', kind: 'mod', label: T + ' ' + (i + 1), y: modJackY('macro', i) }));
  if (k === 'arp' || k === 'clip') return [AUD('out', 'right', T + ' notes', undefined, 'note')];
  return [];
}
/** VOICE's jacks in parts view: MAIN, DIRECT and NOTE in (left), out → its own FX (right), ENV 1's mod-out (inline: its
 * [data-jack="env1"] anchor, else the right edge at the top). */
export function voiceJacks(title) {
  const T = title || 'VOICE';
  return [AUD('main', 'left', T + ' main in', BAR_H + JACK_Y), AUD('direct', 'left', T + ' direct in', BAR_H + JACK_Y + 40), AUD('note', 'left', T + ' note in', BAR_H + JACK_Y + 80, 'note'),
    { id: 'env1', side: 'inline', kind: 'mod', label: T + ' ENV 1 out', y: BAR_H + JACK_Y }, AUD('out', 'right', T + ' out', BAR_H + JACK_Y + 40)];
}
/** (9, IMPL-9 §2.2) A patch module's size when its entry gives none (world px: one 1 MU face under the bar) and its cost (the
 * world's DOM budget: ≈ 90 painted elements, §4.1). */
export const W_PM = 128, H_PM = 512, COST_PM = 90;
/** Column gap Tidy leaves between instrument → FX panel → OUT (world px). */
export const GAP = 160;
/** Stage-1b module ids (= track.lay keys, = the device ids stage 1c's toV2 gives them, SPEC §5.1 / §5.4). */
export const ID = Object.freeze({ inst: 'i1', fx: 'fx1', sxFx: 'i1/fx', out: 'out' });
/** The camera pref record (appstore key, stored as synthc.cam): { v: 1, e: [[key, tx, ty, k], …] }, most recent last, at
 * most CAM_MAX entries; key = cv-migrate.js camKey(project.uid, trackId) (stage 1a). One record, not one key per camera:
 * appstore has no delete, so an LRU of separate keys could never shrink. Device prefs only: never in the project / History. */
export const CAM_PREF = 'synth.cam', CAM_MAX = 200;
/** Press targets that pan the camera with one finger / the mouse (the press target itself must match; IMPL-1b §4.4):
 * panel backgrounds and a hardware panel's art — never the top bar (it moves the module), a control, an editor canvas or a
 * jack. */
export const BG_SEL = '.cv-body, .inst, .plate, .nameplate, .nameplate > div, .plate > .tag, .secs, '
  // a hardware panel (cv-panel): its root, the static art (the decor SVG and everything in it), the live layer's
  // gaps and the extras strip's chrome — never a .hw-c widget
  + '.inst.hw, .hw-decor, .hw-decor *, .hw-ctls, .hw-extras, .hw-xcap, '
  + '.sec, .sec > h3, .ctls, .ctl, .opswrap, .sxhost, .sx-root, .sx-head, .fxtab, .fxr-root, .fxr2-bar, .fxr-side, .fxr-rack, .fxr-empty, '
  + '.cv-out, .scope, .scope > canvas, .cv-outlab, '
  // the Serum panel's containers (a third of its surface) and the TB-303 sequencer's chrome (not .snote, not its buttons)
  + '.sx-panel, .sx-pbody, .sx-krow, .sx-ptitle, .sx-tabs, .sx-colO, .sx-col, .sx-rowA, .sx-row, .sx-master, .sx-pages, .sx-page, '
  + '.steps, .step, .seqbar, .snum, .seqhint, '
  // (8) a Pads module's body, its pad well, its footer and the grid's gaps (a gap is no pad: it pans, and a pad finger joining it
  // within the layer's time rule pinches — 1i G1 / G2; never a pad: a one-finger press on a pad plays, never pans)
  + '.pd-body, .pd-well, .pd-foot, .pd-grid';
/** Jack centre below the bar on the module's edge (world px); folded modules carry their jacks at the bar's middle height,
 * JACK_OUT world px outside the left / right edge (so the dot never covers the bar's ⋯ / ▾ / chip; the bar controls also
 * win the hit test over a jack's enlarged touch circle: style.css). */
export const JACK_Y = 28, JACK_OUT = 14;
/** Tidy's guess of a module's height before it was measured (world px): the instrument's per model in sizeFor. */
const H_GUESS = { inst: 560, serum: 840, fx: 420, out: 260 };
/** (1e) Tidy's vertical gap between stacked modules (instruments, panels; world px, on the dots). */
export const VGAP = 64;
/** (WC, review 2 P2-5) the gap between a rig's modulators side by side in their band over the chain (world px, on the dots). */
export const BAND_GAP = 64;
/** (WC, integration fixer L — review WC-int P3-3) a rig face's outer jack cells sit RIG_JACK in from its edges (§3.8: the 16 px margin + half
 * a 64 px cell): an Envelope's OUT, the Amplifier's LEVEL. Envelope 1 on the amp slot stands in the band with its OUT RIG_AMP_AIR right of
 * the Amplifier's right edge, so its cord to LEVEL hangs beside the Amplifier and comes into LEVEL from the side (centred over it, the cord
 * fell over the Amplifier's bar — its ▾ fold and ⋯ — and down its face). ampEnvCentre(amp x, amp w, its w): the centre it wants (Tidy here,
 * main.js rigSpot for a tapped one). */
export const RIG_JACK = 48, RIG_AMP_AIR = 48;
export const ampEnvCentre = (ax, aw, w) => ax + aw + RIG_AMP_AIR - (w - RIG_JACK) + w / 2;

const fin = x => typeof x === 'number' && isFinite(x);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const gsnap = v => Math.round(v / DOT) * DOT; // the visible grid's dots (cv-world DOT)
const gup = v => Math.ceil(v / DOT) * DOT;

/**
 * @typedef {{x: number, y: number, fold?: 1, z?: number, ui?: 'flow'}} LayEntry  world px (top-left incl. the bar; a stored w is ignored)
 * @typedef {Object<string, LayEntry>} Lay  track.lay (view only: never compiled, never in presets)
 * @typedef {{id: string, side: 'left' | 'right', kind: 'audio' | 'mod', label: string, y?: number}} Jack  (2b) y: the jack's
 *   module-local centre y unfolded (a macro's knob rows); without one JACK_Y below the bar
 * @typedef {{w: number, h?: number}} Fixed  a fixed module size (world px, the bar included; no h: measured)
 * @typedef {{
 *   id: string, kind: 'inst' | 'fx' | 'out', title: string, sub?: string, color?: string,
 *   x: number, y: number, w: number, fold?: boolean, z?: number,
 *   fixed?: Fixed | null, cost?: number,
 *   jacks: Jack[],
 *   body: {mount: (bodyEl: HTMLElement) => void, unmount: (bodyEl: HTMLElement) => void},
 *   chip?: HTMLElement | string,
 *   menu?: () => Array<object>,
 *   onMove?: (x: number, y: number, phase: 'start' | 'move' | 'end' | 'cancel') => void,
 *   onFold?: (fold: boolean) => void,
 *   onSelect?: () => void, onDouble?: () => void, onPress?: () => void, onScreen?: (on: boolean) => void,
 * }} ModuleOpts  (additions: onPress — a press on the bar (bring to front); onScreen — the module entered / left the
 *   screen (monitors); fixed — the instrument's size: w, and h when it is known (a Hardware layout: no measuring))
 * @typedef {{
 *   id: string, el: HTMLElement, bar: HTMLElement, body: HTMLElement, cost: number,
 *   rect: () => {x: number, y: number, w: number, h: number},
 *   onScreen: (on: boolean) => void,
 *   setPos: (x: number, y: number, live?: boolean) => void,
 *   setW: (w: number) => void, setFold: (fold: boolean) => void, setZ: (z: number) => void,
 *   setFixed: (size: Fixed | null) => void,
 *   setTitle: (title: string, sub?: string) => void, setChip: (chip: HTMLElement | string | null) => void,
 *   port: (jackId: string) => {x: number, y: number},
 *   destroy: () => void,
 * }} Module  implements cv-world Item
 */

/* ---------------------------------------------------------------- pure helpers */
/** Is el a module background (one finger / the mouse pans the camera from it)? el itself must match BG_SEL and lie
 * in a [data-cv-mod]. @param {Element} el @returns {boolean} */
export function isBackground(el) {
  if (!el || el.nodeType !== 1) return false;
  if (cableHit(el)) return true; // (1e, U13) an editable cable pans like the canvas around it; a tap on it selects (cv-cables)
  for (let n = el, i = 0; n && i < 3 && typeof n.getAttribute === 'function'; n = n.parentNode, i++) { // (2a U4) a mod cable's badge too
    if (/(^|\s)cv-mbadge(\s|$)/.test(n.getAttribute('class') || '')) return true;
  }
  if (typeof el.matches !== 'function' || typeof el.closest !== 'function') return false;
  try { return !!el.matches(BG_SEL) && !!el.closest('[data-cv-mod]'); } catch (err) { return false; }
}
// an editable cable's hit path (cv-cables: path.cv-cable-hit in g[data-cable], no [data-ro])
function cableHit(el) {
  try {
    const g = el.parentNode;
    return /(^|\s)cv-cable-hit(\s|$)/.test(el.getAttribute('class') || '') && !!g && typeof g.getAttribute === 'function' && g.getAttribute('data-cable') != null && !g.hasAttribute('data-ro');
  } catch (err) { return false; }
}
/** The lay key of a track's FX module: 'i1/fx' (a Serum's own FX) or 'fx1' (a classic track's panel).
 * @param {string} model @returns {string} */
export function fxKey(model) { return isSxId(model) ? ID.sxFx : ID.fx; }
/** A module's width (world px) on a track of `model` (the instrument: its Simple layout's, or a Serum's; a Hardware
 * layout's comes from its panel: cv-panel sizeOf). */
export function defaultW(key, model) {
  return key === ID.inst ? (model === 'serum' ? W_SERUM : FLOW_W[model] || W_CLASSIC) : key === ID.out ? W_OUT : W_FX;
}
/** (1e) A module's default width by kind: an instrument its model's (FLOW_W, W_SERUM), an FX module W_FX, OUT W_OUT. */
export function kindW(kind, model) { return kind === 'inst' ? defaultW(ID.inst, model) : kind === 'out' ? W_OUT : kind === 'mod' ? W_MOD : kind === 'pm' ? W_PM : W_FX; }
/** (2a) The mod kind of a module key ('wheel' / 've' / 'at' / 'bd' → 'wheel' / 'velo' / 'at' / 'bend'; (2b) 'nt' → 'note',
 * 'l<n>' / 'e<n>' / 'm<n>' / 'c<n>' / 'h<n>' → 'lfo' / 'env' / 'macro' / 'cc' / 'chaos'; else null). mkOf: the same. */
export function modKind(key) { return keyKind(key); }
export const mkOf = modKind;
// the stage-1b Tidy (the legacy view's: instrument → FX → OUT, keyed by the stage-1b ids)
function tidy1(track, sizes) {
  const model = track && track.model, lay = {};
  let x = 0;
  for (const k of [ID.inst, fxKey(model), ID.out]) {
    const s = isObj(sizes) ? sizes[k] : null, w = s && fin(s.w) && s.w > 0 ? s.w : defaultW(k, model);
    lay[k] = { x, y: 0 };
    x = gup(x + w + GAP);
  }
  return lay;
}
const devNum = id => { const m = /(\d+)$/.exec(id); return m ? +m[1] : 0; };
const byNum = (a, b) => devNum(a) - devNum(b) || (a < b ? -1 : a > b ? 1 : 0);
/**
 * (1e) The modules of a track, in view order: instruments (the primary first, then by device number), each Serum's own FX
 * ('iN/fx'), the shared panels (by number), OUT; (2a) then the track's modulators (every MOD_KINDS kind in MOD_ORDER, by
 * number: 'velo' / 'at' / 'bend' / 'note' / 'lfo' / … → {key, kind: 'mod', mod}) — the project's Mod Wheel ({key: 'wheel', kind: 'mod', mod: 'wheel'}) is
 * the host's to add. A track without dev (v1): the stage-1b three. Pure; the default host.devices of createTrackView.
 * @param {{prim?: string, dev?: object, model?: string}} track
 * @returns {Array<{key: string, kind: 'inst' | 'fx' | 'out' | 'mod', model: string | null, dev: object | null, prim?: boolean, own?: string, mod?: string}>}
 */
export function devicesOf(track) {
  const t = isObj(track) ? track : {}, D = isObj(t.dev) ? t.dev : null;
  if (!D) return [{ key: ID.inst, kind: 'inst', model: t.model || null, dev: null, prim: true }, { key: fxKey(t.model), kind: 'fx', model: isSxId(t.model) ? t.model : null, dev: null }, { key: ID.out, kind: 'out', model: null, dev: null }];
  const ids = Object.keys(D).filter(k => isObj(D[k])), of = kind => ids.filter(k => D[k].kind === kind);
  const syn = of('synth').sort(byNum), pr = syn.includes(t.prim) ? t.prim : syn[0];
  if (pr) syn.splice(syn.indexOf(pr), 1), syn.unshift(pr);
  const out = syn.map(k => ({ key: k, kind: 'inst', model: D[k].model || null, dev: D[k], prim: k === pr }));
  for (const k of syn) if (isSxId(D[k].model)) out.push({ key: k + '/fx', kind: 'fx', model: D[k].model, dev: D[k], own: k });
  for (const k of of('panel').sort(byNum)) out.push({ key: k, kind: 'fx', model: null, dev: D[k] });
  for (const k of of('out').sort(byNum)) out.push({ key: k, kind: 'out', model: null, dev: D[k] });
  for (const m of MOD_ORDER) if (MOD_KINDS.has(m)) for (const k of of(m).filter(k => keyKind(k) === m).sort(byNum)) out.push({ key: k, kind: 'mod', model: null, dev: D[k], mod: m }); // ((2b) every kind whose id fits its prefix (§1.1), Tidy order)
  return out;
}
/**
 * Tidy: instrument → FX → OUT in columns from (0, 0), GAP apart, tops aligned. sizes: id → {w, h} (measured or default).
 * Each column starts on the grid. Positions only: widths and folds stay the caller's.
 * (1e) Any number of devices (a v2 track, or `devs` given — createTrackView's host.devices list): the instruments stacked
 * in the left column (the primary on top, VGAP apart), each Serum's own FX beside its Serum, the shared panels stacked in
 * the next column, OUT right of everything. One instrument → panel → OUT (or a Serum → its own FX → OUT) lays out exactly
 * as the stage-1b Tidy. (2a) Modulators (kind 'mod') stack in a column left of the instruments (x < 0, MOD_GAP from them), in
 * MOD_ORDER (the wheel, Velocity, Aftertouch, Bend), VGAP apart: nothing else moves for them.
 * @param {{model?: string, dev?: object}} track @param {Object<string, {w: number, h: number}>} sizes
 * @param {Array<{key: string, kind: string, model?: string, own?: string}>} [devs]
 * @param {(instKey: string) => Object<string, {x: number, y: number}>} [rack] (9) the patch modules ('pm') of an instrument,
 *   relative to its top-left (main.js: patch-core rackLayout through cv-patch); without it one flush row above it
 * @param {{targets?: Object<string, string[]>, narrow?: boolean, past?: Object<string, boolean>}} [opts] (WC, review 2 P2-5) a rig's Tidy
 *   (rigLay below): its modulators' targets (modulator key → the module keys it drives: the host's rig-core targetsOf), a portrait canvas
 *   and (the user's stacked plugs) the rigs whose Amplifier takes a source past a filter (rig key → true); ignored elsewhere @returns {Lay}
 */
export function tidy(track, sizes, devs, rack, opts) {
  if (!Array.isArray(devs) && !(track && isObj(track.dev))) return tidy1(track, sizes);
  const L = Array.isArray(devs) ? devs.filter(d => isObj(d) && typeof d.key === 'string') : devicesOf(track), lay = {};
  const S = k => (isObj(sizes) && isObj(sizes[k]) ? sizes[k] : null);
  const mkOf = d => d.mod || modKind(d.key);
  const pOf = d => d.part || (splitKey(d.key) || {}).part; // (3) a part's name
  const voices = new Set(L.filter(d => d.kind === 'part').map(d => (typeof d.dev === 'string' ? d.dev : (splitKey(d.key) || {}).dev))); // (3) Serums in parts view: VOICE
  const rig = d => d.wires === 'cords' || d.wires === 'lines'; // ((WC) a rig's module: the Amplifier where VOICE was)
  const wOf = d => { const s = S(d.key); return s && fin(s.w) && s.w > 0 ? s.w : d.kind === 'mod' ? modW(mkOf(d)) : d.kind === 'part' ? PART_W_DEF[partKind(pOf(d))] || W_MOD : d.kind === 'inst' && voices.has(d.key) ? (rig(d) ? PART_W_DEF.amp : PART_W_DEF.voice) : kindW(d.kind, d.model); };
  const hOf = d => { const s = S(d.key); return s && fin(s.h) && s.h > 0 ? s.h : d.kind === 'inst' ? (voices.has(d.key) ? (rig(d) ? PART_H_DEF.amp : PART_H_DEF.voice) : d.model === 'serum' ? H_GUESS.serum : H_GUESS.inst) : d.kind === 'mod' ? MOD_H[mkOf(d)] || MOD_H.at : d.kind === 'part' ? PART_H_DEF[partKind(pOf(d))] || 256 : d.kind === 'pm' ? H_PM : H_GUESS[d.kind] || H_GUESS.fx; };
  // ((WC, §3.6) a rig's cords sag (the Studio rope's EXTRA 24): one more grid row of air under each of its stacked modules)
  const air = d => (d.kind === 'part' && d.wires === 'cords' ? DOT : 0);
  const ins = L.filter(d => d.kind === 'inst'), insK = new Set(ins.map(d => d.key));
  const own = new Map(), pans = [], outs = L.filter(d => d.kind === 'out');
  for (const d of L) if (d.kind === 'fx') { const o = d.own || (/^(.+)\/fx$/.exec(d.key) || [])[1]; if (o && insK.has(o) && !own.has(o)) own.set(o, d); else pans.push(d); }
  const max = (A, f) => A.reduce((m, d) => Math.max(m, f(d)), 0);
  // (milestone 3, §2.7) the parts of a Serum in parts view: note tools → sources (top to bottom) → filters, left of its VOICE
  // column (its own ENV / LFO / MACROS stacked above VOICE); a stack starts at y 0 (the column's own: above, upward)
  const parts = L.filter(d => d.kind === 'part');
  const col = f => parts.filter(d => f(partKind(pOf(d)))).sort((a, b) => (PARTS.indexOf(pOf(a)) - PARTS.indexOf(pOf(b))) || (a.key < b.key ? -1 : 1));
  const cols = [col(k => k === 'arp' || k === 'clip'), col(k => k === 'osc' || k === 'sub' || k === 'noise'), col(k => k === 'filter')].filter(c => c.length);
  const above = col(k => k === 'env' || k === 'lfo' || k === 'macros');
  const R1 = ins.length === 1 && rig(ins[0]) ? ins[0] : null; // ((WC, review 2 P2-5) one rig: its own lay; every other canvas below, as it was
  let y = 0;
  if (R1) rigLay(R1);
  else {
    let x = 0;
    for (const C of cols) {
      let yy = 0;
      for (const d of C) { lay[d.key] = { x, y: yy }; yy = gup(yy + hOf(d) + VGAP + air(d)); }
      x = gup(x + max(C, wOf) + GAP);
    }
    const xi = x, x1 = ins.length ? gup(xi + max(ins.concat(above), wOf) + GAP) : xi, ownW = max([...own.values()], wOf);
    for (const d of ins) {
      lay[d.key] = { x: xi, y };
      let h = hOf(d);
      const f = own.get(d.key);
      if (f) { lay[f.key] = { x: x1, y }; h = Math.max(h, hOf(f)); }
      y = gup(y + h + VGAP);
    }
    let ya = 0; // (own ENV / LFO / MACROS: upward from VOICE's top, the last nearest)
    for (const d of above.slice().reverse()) { ya = -gup(-ya + hOf(d) + VGAP + air(d)); lay[d.key] = { x: xi, y: ya }; }
    const x2 = ownW ? gup(x1 + ownW + GAP) : x1;
    y = 0;
    for (const d of pans) { lay[d.key] = { x: x2, y }; y = gup(y + hOf(d) + VGAP); }
    const x3 = pans.length ? gup(x2 + max(pans, wOf) + GAP) : x2;
    y = 0;
    for (const d of outs) { lay[d.key] = { x: x3, y }; y = gup(y + hOf(d) + VGAP); }
  }
  // ((WC, review 2 P2-5 — the user's rule, 2026-10-26: "shouldnt envelope come after the oscillator in the chain?") a rig: its chain on ONE
  // row left → right, each module its own column — the note tools, the sources, the filters (PARTS order), the Amplifier, its own FX, the
  // panels, OUT — tops at 0, GAP apart; its modulators (Envelopes, LFOs, Macros) in ONE band above it, bottom-aligned VGAP + a grid row (the
  // cords' sag) over the chain's tops, each centred over what it drives (opts.targets: modulator key → the module keys it drives, the host's
  // rig-core targetsOf; several → its left-most; no list: Envelope 1 the Amplifier's — the amp slot is its by definition), packed by cluster
  // merging (each wants its target's centre; neighbours closer than BAND_GAP merge into one cluster centred on the mean of their wants,
  // BAND_GAP apart inside — never one over another: an upper one's cord would cross the lower one's face); Envelope 1 on the amp slot then
  // steps right to stand its OUT beside the Amplifier when its cord to LEVEL would come down over it (ampEnvCentre: off the Amplifier's bar and
  // face, review WC-int P3-3); one with no target at the band's left end, beside the chain, until a Tidy finds it one; opts.narrow (a
  // portrait canvas): the chain wraps after the Amplifier — its FX, the panels and OUT on a row under it (Amplifier → FX stays a line: the
  // host routes it round the Amplifier's right side and along the gap — cv-cables wrapPath, review WC-int P3-11), a modulator driving that
  // row standing right of the Amplifier's slot (Envelope 1 keeps its place beside it). Measured by review 2
  // (tidyproto.mjs): S1 / S2 0 cords across a face, S3 1. (The user, 2026-10-26: stacked plugs — the Amplifier's Σ IN takes every chain
  // cord on its one socket) opts.past (rig key → true: the host's — a source of it straight to its Amplifier while a filter stands) a grid
  // row (DOT) more air before the Amplifier: that cord rises into the socket from under the filters and clears the foot of the taller
  // filter beside it (S3's Sub: 2.5 px into Filter 2's corner at GAP, 26 px clear at GAP + DOT — S3 stays 1)
  function rigLay(d0) {
    const T = isObj(opts) && isObj(opts.targets) ? opts.targets : {}, by = new Map(L.map(d => [d.key, d]));
    const wR = d => { if (d !== d0) return wOf(d); const s = S(d.key); return s && fin(s.w) && s.w > 0 ? s.w : PART_W_DEF.amp; };
    const hR = d => { if (d !== d0) return hOf(d); const s = S(d.key); return s && fin(s.h) && s.h > 0 ? s.h : PART_H_DEF.amp; };
    const kOf = d => partKind(pOf(d)), isMod = d => /^(env|lfo|macros)$/.test(kOf(d) || ''), rank = d => (kOf(d) === 'arp' || kOf(d) === 'clip' ? 0 : kOf(d) === 'filter' ? 2 : 1);
    const pord = (a, b) => PARTS.indexOf(pOf(a)) - PARTS.indexOf(pOf(b)) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    const mine = parts.filter(d => (typeof d.dev === 'string' ? d.dev : (splitKey(d.key) || {}).dev) === d0.key);
    const head = mine.filter(d => !isMod(d)).sort((a, b) => rank(a) - rank(b) || pord(a, b)).concat([d0]), f = own.get(d0.key), tail = (f ? [f] : []).concat(pans, outs);
    let x = 0;
    const air0 = isObj(opts) && isObj(opts.past) && opts.past[d0.key] ? DOT : 0; // ((the user's stacked plugs) the Amplifier's air: opts.past
    for (const d of head) { if (d === d0 && x > 0) x += air0; lay[d.key] = { x, y: 0 }; x = gup(x + wR(d) + GAP); }
    const wrap = !!(isObj(opts) && opts.narrow && tail.length);
    if (wrap) { x = lay[d0.key].x; y = gup(max(head, hR) + VGAP + DOT); } else y = 0;
    for (const d of tail) { lay[d.key] = { x, y }; x = gup(x + wR(d) + GAP); }
    const mods = mine.filter(isMod).sort(pord), band = new Set(mods.map(d => d.key)), yOf = d => -gup(hR(d) + VGAP + DOT), want = [], free = [], low = [];
    const wrapped = new Set(wrap ? tail.map(d => d.key) : []);
    for (const d of mods) {
      const t = (Array.isArray(T[d.key]) ? T[d.key] : pOf(d) === 'env1' ? [d0.key] : []).filter(k => typeof k === 'string' && !band.has(k) && by.has(k) && okEntry(lay[k]));
      if (!t.length) { free.push(d); continue; }
      const k0 = t.slice().sort((p, q) => lay[p].x - lay[q].x || lay[p].y - lay[q].y)[0]; // ((P3-11) a tie upright: the chain's module over the wrapped row's)
      (wrapped.has(k0) ? low : want).push({ d, c: lay[k0].x + wR(by.get(k0)) / 2, w: wR(d), amp: pOf(d) === 'env1' && k0 === d0.key });
    }
    want.sort((p, q) => p.c - q.c || (p.d.key < q.d.key ? -1 : 1));
    const cl = [];
    for (const q of want) {
      cl.push({ m: [q], c: q.c, w: q.w });
      while (cl.length > 1) {
        const A = cl[cl.length - 2], B = cl[cl.length - 1];
        if (B.c - B.w / 2 >= A.c + A.w / 2 + BAND_GAP) break;
        const m = A.m.concat(B.m);
        cl.splice(cl.length - 2, 2, { m, c: m.reduce((s, z) => s + z.c, 0) / m.length, w: m.reduce((s, z) => s + z.w, 0) + BAND_GAP * (m.length - 1) });
      }
    }
    let left = head.length ? lay[head[0].key].x : 0;
    for (const K of cl) { let bx = Math.round((K.c - K.w / 2) / DOT) * DOT; left = Math.min(left, bx); for (const q of K.m) { lay[q.d.key] = { x: bx, y: yOf(q.d) }; bx = gup(bx + q.w + BAND_GAP); } }
    for (const d of free.slice().reverse()) { left = Math.floor((left - BAND_GAP - wR(d)) / DOT) * DOT; lay[d.key] = { x: left, y: yOf(d) }; }
    // ((integration fixer L — review WC-int P3-3) Envelope 1 on the amp slot whose cord would come down over the Amplifier (its OUT over the
    // Amplifier's span: the bar's ▾ / ⋯, the face) steps right until its OUT stands RIG_AMP_AIR beside it (ampEnvCentre — still over the
    // Amplifier) when the band has room there; one a cluster already holds beside it, or with no room, keeps its place
    const e1 = want.find(q => q.amp), a = lay[d0.key];
    if (e1 && a) {
      const out = lay[e1.d.key].x + e1.w - RIG_JACK, ar = a.x + wR(d0), nx = Math.round((ampEnvCentre(a.x, wR(d0), e1.w) - e1.w / 2) / DOT) * DOT;
      if (out >= a.x && out < ar + RIG_AMP_AIR && !mods.some(d => d !== e1.d && lay[d.key] && lay[d.key].x < nx + e1.w + BAND_GAP && lay[d.key].x + wR(d) + BAND_GAP > nx)) lay[e1.d.key] = { x: nx, y: lay[e1.d.key].y };
    }
    // ((integration fixer L — review WC-int P3-11, after its second check) upright, a modulator driving the wrapped row (the FX panel under
    // the Amplifier: a knob on Effects) never joins the clusters over the chain — its want, the panel's centre, lay over the Amplifier and
    // pushed Envelope 1 back over it: it stands right of the Amplifier's slot — past every band module over the chain (Envelope 1 at its
    // P3-3 place) and past the Amplifier → Effects line's run (2 × RIG_AMP_AIR beside the Amplifier: its cord drops beside the Amplifier,
    // not through it) — flowed left → right in its wants' order, each at its want when that is further right
    let cur = a ? a.x + wR(d0) + 2 * RIG_AMP_AIR : -Infinity;
    for (const q of want) cur = Math.max(cur, lay[q.d.key].x + q.w + BAND_GAP);
    for (const q of low.sort((p, r) => p.c - r.c || (p.d.key < r.d.key ? -1 : 1))) {
      const bx = Math.max(Math.round((q.c - q.w / 2) / DOT) * DOT, gup(cur));
      lay[q.d.key] = { x: bx, y: yOf(q.d) }; cur = bx + q.w + BAND_GAP;
    }
  }
  const ord = d => { const i = MOD_ORDER.indexOf(mkOf(d)); return i < 0 ? MOD_ORDER.length : i; };
  const mods = L.filter(d => d.kind === 'mod').sort((a, b) => ord(a) - ord(b) || byNum(a.key, b.key));
  y = 0; // ((3) the column grows leftwards: every right edge at −MOD_GAP or left of it, a wider one further left)
  for (const d of mods) { lay[d.key] = { x: -gup(wOf(d) + MOD_GAP), y }; y = gup(y + hOf(d) + VGAP); }
  // (9, IMPL-9 §4.5) the patch modules: their instrument's rack (rack(instKey) → {key: {x, y}} relative to its top-left: the host's
  // patch-core rackLayout, rows flush above it, every width a multiple of 32 so a row stays on the dots), else one flush row above it
  const byDev = new Map();
  for (const d of L) if (d.kind === 'pm') { const k = typeof d.dev === 'string' ? d.dev : String(d.key).split('/')[0]; if (!byDev.has(k)) byDev.set(k, []); byDev.get(k).push(d); }
  for (const [k, list] of byDev) {
    const o = lay[k] || { x: 0, y: 0 }, R = typeof rack === 'function' ? rack(k) : null, top = gup(max(list, hOf));
    let rx = 0;
    for (const d of list) {
      const r = isObj(R) && okEntry(R[d.key]) ? R[d.key] : null;
      if (r) lay[d.key] = { x: o.x + r.x, y: o.y + r.y };
      else { lay[d.key] = { x: o.x + rx, y: o.y - top }; rx += gup(wOf(d)); }
    }
  }
  return lay;
}
/** (1e) A MIDI note's name in the app's naming (C4 = 60). */
export function noteName(n) { const N = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'], k = Math.round(+n) || 0; return N[((k % 12) + 12) % 12] + (Math.floor(k / 12) - 1); }
/** (1e) A key zone {lo, hi, xp} (0…127, 0…127, −48…48), clamped and ordered; anything else → all keys. */
export function zoneOf(z) {
  const c = (v, a, b, d) => (fin(v) ? Math.max(a, Math.min(b, Math.round(v))) : d);
  const lo = c(z && z.lo, 0, 127, 0), hi = c(z && z.hi, 0, 127, 127);
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi), xp: c(z && z.xp, -48, 48, 0) };
}
/** (1e) The key-zone pill's text: "keys: all", "keys: C3–C6", "keys: all · +12", "keys: C3–C6 · −5". */
export function zoneLabel(z) {
  const Z = zoneOf(z), all = Z.lo === 0 && Z.hi === 127;
  return 'keys: ' + (all ? 'all' : noteName(Z.lo) + '–' + noteName(Z.hi)) + (Z.xp ? ' · ' + (Z.xp > 0 ? '+' : '−') + Math.abs(Z.xp) : '');
}
const okEntry = e => isObj(e) && fin(e.x) && fin(e.y);
/** The lay entry of `key`, falling back to the other FX key after a classic ↔ Serum model change (its place, fold and
 * z), else Tidy's. Always a copy, never with a width (a stored w is ignored: nothing is resizable).
 * (1e) keys: the track's module keys — while the other FX key is a module of its own (a Serum primary's 'i1/fx' beside a
 * shared panel 'fx1') its entry is its own, never a fallback.
 * @param {{model: string, lay?: Lay}} track @param {string} key @param {Lay} tidied @param {string[]} [keys] @returns {LayEntry} */
export function layOf(track, key, tidied, keys) {
  const L = track && isObj(track.lay) ? track.lay : null;
  if (L && okEntry(L[key])) { const e = Object.assign({}, L[key]); delete e.w; return e; }
  const ox = key === ID.fx ? ID.sxFx : key === ID.sxFx ? ID.fx : null;
  if (L && ox && !(Array.isArray(keys) && keys.includes(ox))) {
    const o = L[ox];
    if (okEntry(o)) { const e = Object.assign({}, o); delete e.w; return e; }
  }
  const t = isObj(tidied) && okEntry(tidied[key]) ? tidied[key] : { x: 0, y: 0 };
  return { x: t.x, y: t.y };
}
const camOk = c => Array.isArray(c) && typeof c[0] === 'string' && fin(c[1]) && fin(c[2]) && fin(c[3]) && c[3] > 0;
/** The camera stored under `key` (cv-migrate camKey) in a CAM_PREF record (any shape: invalid → null).
 * @param {{v: 1, e: Array} | null} rec @param {string} key @returns {{tx: number, ty: number, k: number} | null} */
export function camGet(rec, key) {
  if (!isObj(rec) || rec.v !== 1 || !Array.isArray(rec.e)) return null;
  for (let i = rec.e.length - 1; i >= 0; i--) {
    const c = rec.e[i];
    if (camOk(c) && c[0] === key) return { tx: c[1], ty: c[2], k: c[3] };
  }
  return null;
}
/** LRU put: `key` moves to the end with `cam`; the oldest go past `max` (default CAM_MAX). Pure.
 * @returns {{v: 1, e: Array}} a new record */
export function camPut(rec, key, cam, max) {
  const n = fin(max) && max >= 1 ? Math.floor(max) : CAM_MAX;
  const old = isObj(rec) && rec.v === 1 && Array.isArray(rec.e) ? rec.e.filter(c => camOk(c) && c[0] !== key) : [];
  if (typeof key === 'string' && isObj(cam) && fin(cam.tx) && fin(cam.ty) && fin(cam.k) && cam.k > 0) {
    old.push([key, Math.round(cam.tx * 100) / 100, Math.round(cam.ty * 100) / 100, Math.round(cam.k * 1e4) / 1e4]);
  }
  return { v: 1, e: old.slice(Math.max(0, old.length - n)) };
}
/** The world size of a module about to be dropped for `modelId` (the tray's true-size outline). @returns {{w: number, h: number}} */
export function sizeFor(modelId) {
  return { w: defaultW(ID.inst, modelId), h: modelId === 'serum' ? H_GUESS.serum : H_GUESS.inst };
}
/** Room for a fixed-size instrument (IMPL-panels §7.3): the modules whose left edge is at or right of the instrument's
 * left edge and whose vertical span overlaps it (R) move right together — their relative layout kept — so the nearest
 * one starts GAP (gap) past the instrument, on the dots; null when R is empty or already starts a dot or more past it.
 * Never moves anything left. Pure. @param {Object<string, {x: number, y: number, w: number, h: number}>} rects
 * @param {string} key the instrument @param {number} [gap] @returns {Object<string, {x: number, y: number}> | null} */
export function makeRoom(rects, key, gap) {
  const I = isObj(rects) ? rects[key] : null, g = fin(gap) ? gap : GAP;
  if (!I || ![I.x, I.y, I.w, I.h].every(fin)) return null;
  const R = [];
  for (const k of Object.keys(rects)) {
    const r = rects[k];
    if (k === key || !r || ![r.x, r.y, r.w, r.h].every(fin)) continue;
    if (r.x >= I.x && r.y < I.y + I.h && I.y < r.y + Math.max(r.h, 1)) R.push(k);
  }
  if (!R.length) return null;
  const x0 = Math.min(...R.map(k => rects[k].x));
  if (x0 >= I.x + I.w + DOT) return null;
  const d = gup(I.x + I.w + g) - x0;
  if (!(d > 0)) return null;
  const out = {};
  for (const k of R) out[k] = { x: rects[k].x + d, y: rects[k].y };
  return out;
}

/* ---------------------------------------------------------------- one module */
const FOLD_SVG = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.25 6 7.75l3.5-3.5"/></svg>';
const POW_SVG = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M4.4 3.6a4.6 4.6 0 1 0 5.2 0M7 1.6v5"/></svg>';
// (1e) createModule options beside ModuleOpts: power {on, onToggle(on)} — the ⏻ button; zone {lo, hi, xp, onChange({lo, hi,
// xp})} — the key-zone pill (instruments); badge — the bar badge's first text; patch — the jacks are focusable buttons
// (role=button, tabindex 0: Enter / Space → cv-cables "Connect to…"); (9, IMPL-9 §4.1) nofold — no ▾, never folded (a face
// carries its jacks: a patch module, its instrument's controller); compact — the narrow bar of a patch module: stripe · title
// over its sub · ⋯ only (no ⏻, chip, CPU or fold in it: [data-cv-compact])
/** Builds one module's chrome (top bar · colour stripe · title · chip · ⋯ · ▾, body, jacks) as a cv-world Item.
 * env.world: the World (k, toWorld, dragPointer, on, select, focusItem); without one the module still works at k = 1.
 * @param {ModuleOpts} o @param {{world?: object, doc?: Document}} [env] @returns {Module} */
export function createModule(o, env) {
  const E = env || {}, doc = E.doc || globalThis.document, W = () => E.world || null;
  const mk = (tag, cls, txt) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const btn = (cls, label, html) => { const b = mk('button', cls); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; if (html) b.innerHTML = html; return b; };
  const id = String(o.id), kind = o.kind || 'inst';
  const fixOk = f => !!f && fin(f.w) && f.w > 0;
  let FX = fixOk(o.fixed) ? { w: Math.round(o.fixed.w), h: fin(o.fixed.h) && o.fixed.h > BAR_H ? Math.round(o.fixed.h) : 0 } : null; // the instrument's size
  let x = fin(o.x) ? o.x : 0, y = fin(o.y) ? o.y : 0, lx = x, ly = y; // committed left / top, live position
  let w = FX ? FX.w : fin(o.w) && o.w > 0 ? o.w : defaultW(kind === 'inst' ? ID.inst : kind === 'out' ? ID.out : ID.fx);
  const noFold = !!(o.nofold || o.compact), compact = !!o.compact;
  let fold = !!o.fold && !noFold, z = fin(o.z) ? o.z : 1, mounted = false, hCache = 0, dead = false, title = '', chipCur, onScr = true;
  const el = mk('div', 'cv-mod');
  el.setAttribute('data-cv-mod', id); el.setAttribute('data-cv-kind', kind);
  el.setAttribute('role', 'group');
  if (noFold) el.setAttribute('data-cv-nofold', '');
  if (compact) el.setAttribute('data-cv-compact', '');
  if (o.color) el.style.setProperty('--mc', o.color);
  const bar = mk('div', 'cv-bar');
  bar.setAttribute('data-cv-bar', ''); bar.tabIndex = 0;
  // power (1e): o.power → a ⏻ button (aria-pressed); without it the slot stays reserved and hidden (OUT, the FX panels)
  const pow = o.power ? btn('cv-pow', 'Power', POW_SVG) : mk('span', 'cv-pow');
  if (!o.power) pow.hidden = true;
  const stripe = mk('span', 'cv-stripe'); stripe.setAttribute('aria-hidden', 'true');
  const ttl = mk('span', 'cv-ttl'), tEl = mk('span', 'cv-title'), sEl = mk('span', 'cv-sub');
  ttl.append(tEl, sEl);
  const chipEl = mk('span', 'cv-chip'), cpu = mk('span', 'cv-cpu'); // CPU: per module (setCpu, the engine's stats per Inst / Chain)
  let cpuS = NaN; // (setCpu: the figure shown, %)
  const more = btn('cv-btn cv-more', 'Module menu'); more.textContent = '⋯'; more.setAttribute('aria-haspopup', 'menu');
  const foldB = btn('cv-btn cv-fold', 'Fold', FOLD_SVG);
  if (compact) bar.append(...(o.power ? [pow] : []), stripe, ttl, more); // ((9) the compact bar: the rest made, never shown)
  else bar.append(pow, stripe, ttl, chipEl, cpu, more, ...(noFold ? [] : [foldB]));
  const body = mk('div', 'cv-body');
  el.append(bar, body);
  // jack id → {el (the jack: the dot, or (3) an inline jack's anchor), dot, side, dir, kind, y (unfolded module-local centre:
  // a macro's knob rows), inline, at (an anchor's measured centre), dirty, anchor}
  const jacks = new Map();
  let nFace = 0;
  for (const j of Array.isArray(o.jacks) ? o.jacks : []) {
    // (9, IMPL-9 §4.2) a FACE jack (side 'face', a patch cord's): a transparent span at the spec's module-local (x, y) — the face
    // draws the jack —, data-kind "cord", data-sig / data-dir from the spec, its hit circle clamped by --jp (the face's room, from
    // geometry's `hit`); no anchor search, no measuring; one tab stop per module (roving: the arrows move it)
    const face = j.side === 'face' && fin(j.x) && fin(j.y);
    const je = mk('span', face ? 'cv-jack cv-fjack' : 'cv-jack'), inline = j.side === 'inline', side = face ? 'face' : j.side === 'left' ? 'left' : 'right', kd = face ? 'cord' : j.kind || 'audio';
    const dir = j.dir === 'in' || j.dir === 'out' || (face && j.dir === 'any') ? j.dir : j.id === 'in' || side === 'left' ? 'in' : 'out'; // ((3) the left jacks are inputs)
    je.setAttribute('data-cv-jack', id + '.' + j.id); je.setAttribute('data-side', side); // (an inline jack's dot: its fallback at the right edge)
    je.setAttribute('data-kind', kd); je.setAttribute('data-dir', dir);
    if (inline) je.setAttribute('data-inline', '');
    // ((WC) a rig's jack row: its cords-mode role and signal, awake at every zoom — copied onto its anchor with the rest (JA))
    if (!face && kd === 'cord') { je.setAttribute('data-cord', typeof j.role === 'string' && j.role ? j.role : 'audio'); je.setAttribute('data-sig', j.sig === 's' ? 's' : 'v'); }
    if (j.awake) je.setAttribute('data-cv-awake', '');
    if (j.label) { je.setAttribute('aria-label', j.label); je.title = j.label; }
    if (face) {
      je.setAttribute('data-sig', j.sig === 's' ? 's' : 'v');
      je.style.left = j.x + 'px'; je.style.top = j.y + 'px';
      if (fin(j.hit) && j.hit > 0) je.style.setProperty('--jp', j.hit + 'px');
      je.setAttribute('role', 'button'); je.tabIndex = nFace++ ? -1 : 0; // (a cord jack is pressable whatever o.patch says: review #4)
    } else if (o.patch) { je.setAttribute('role', 'button'); je.tabIndex = 0; } // (1e) patchable: Enter / Space → "Connect to…"
    if (j.hide) je.hidden = true; // ((8) a hidden pad's jack: no dot, ever)
    el.append(je);
    jacks.set(j.id, { el: je, dot: je, side, dir, kind: kd, label: j.label || '', y: face ? j.y : fin(j.y) && j.y > BAR_H ? j.y : BAR_H + JACK_Y, x: face ? j.x : 0, face, inline, at: null, dirty: inline, anchor: null, hide: !!j.hide });
  }
  // (9) the face jacks' roving tab stop: arrows / Home / End move it (and the focus) along the module's jacks in spec order — the
  // canvas's own arrow keys (a module nudge) never see them
  const faceList = () => [...jacks.values()].filter(j => j.face && !j.hide).map(j => j.el);
  if (nFace) el.addEventListener('keydown', e => {
    const L = faceList(), i = L.indexOf(e.target), k = e.key;
    if (i < 0) return;
    const n = k === 'ArrowRight' || k === 'ArrowDown' ? i + 1 : k === 'ArrowLeft' || k === 'ArrowUp' ? i - 1 : k === 'Home' ? 0 : k === 'End' ? L.length - 1 : null;
    if (n == null) return;
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    const t = L[(n + L.length) % L.length];
    for (const x of L) x.tabIndex = x === t ? 0 : -1;
    if (typeof t.focus === 'function') t.focus();
  });
  // ---- geometry (folded: every jack at the bar's middle height)
  const jackY = j => (fold ? BAR_H / 2 : j ? j.y : BAR_H + JACK_Y);
  function placeJacks() {
    for (const j of jacks.values()) { if (j.face) continue; const yy = jackY(j) + 'px'; if (j.dot.style.top !== yy) j.dot.style.top = yy; } // ((9) a face jack: placed once)
  }
  // (milestone 3) an inline jack's anchor [data-jack="<port>"] inside the module (never in the bar), measured module-local
  // (a layout read: at mount / relayout only, never per frame); the anchor becomes the jack (its attributes moved there, the
  // dot hidden); no anchor (a 2b body, a hidden one): the dot at the right edge at the spec's y
  const JA = ['data-cv-jack', 'data-kind', 'data-dir', 'role', 'tabindex', 'aria-label', 'data-ro', 'data-cord', 'data-sig', 'data-cv-awake']; // ((WC) a rig's jack row too)
  function anchorOf(port) {
    const st = [body];
    while (st.length) { const n = st.pop(); for (const c of n.children || []) { if (!c || typeof c.getAttribute !== 'function') continue; if (c.getAttribute('data-jack') === port) return c; st.push(c); } }
    return null;
  }
  function measureInline(j, jid) {
    const a = anchorOf(jid);
    j.dirty = !a && !j.hide; // ((WC, review 2 P1-1) no anchor yet — a face mounting after its module —: looked for again at the next port(); a hidden one once)
    let at = null;
    if (a) {
      try {
        const R = el.getBoundingClientRect(), r = a.getBoundingClientRect(), s = R.width > 0 && w > 0 ? R.width / w : 1;
        if (r && (r.width > 0 || r.height > 0)) at = { x: Math.round((r.left + r.width / 2 - R.left) / s * 100) / 100, y: Math.round((r.top + r.height / 2 - R.top) / s * 100) / 100 };
      } catch (err) { at = null; }
    }
    if (j.anchor && j.anchor !== a) { for (const k of JA) j.anchor.removeAttribute(k); j.anchor.classList.remove('cv-jack-in'); }
    j.anchor = a; j.at = at;
    if (a) {
      for (const k of JA) { const v = j.dot.getAttribute(k); if (v != null) a.setAttribute(k, v); else a.removeAttribute(k); }
      a.classList.add('cv-jack-in');
      j.el = a; j.dot.hidden = true;
    } else { j.el = j.dot; j.dot.hidden = !!j.hide; } // ((8) a hidden pad's: its dot hidden too)
  }
  // (8) a jack's hide flag from its spec (a Pads module's pad shown / hidden by a Grid… change): no rebuild, re-measured
  function setJackHide(jid, h) {
    const j = jacks.get(jid);
    if (!j || j.hide === !!h) return;
    j.hide = !!h;
    if (j.inline) j.dirty = true; // (measured again at its next port(): the anchor there or not)
    j.dot.hidden = j.hide || (j.inline && !!j.anchor);
  }
  // (8) a jack's label from its entry, refreshed at every sync (a mod pad renamed or retargeted: its name changes, its id does not
  // — no rebuild): the dot's and an inline anchor's aria-label / title; an empty label leaves the last
  function setJackLabel(jid, label) {
    const j = jacks.get(jid);
    if (!j || typeof label !== 'string' || !label || j.label === label) return;
    j.label = label;
    for (const e of new Set([j.dot, j.el])) if (e) { e.setAttribute('aria-label', label); e.title = label; }
  }
  const inlineAt = (j, jid) => { if (j.dirty) measureInline(j, jid); return j.at; };
  function measure() { // the module's layout height (world px): a layout read, never per frame (a fixed height: none)
    if (fold) return BAR_H;
    if (FX && FX.h) return FX.h;
    const hh = +el.offsetHeight || 0;
    if (hh > 0) hCache = hh;
    return hCache || BAR_H;
  }
  let ro = null;
  const RO = globalThis.ResizeObserver;
  if (typeof RO === 'function') {
    try { ro = new RO(() => { if (!dead) { const h0 = hCache; measure(); if (hCache !== h0 && o.onSize) o.onSize(); } }); ro.observe(el); } catch (err) { ro = null; }
  }
  const setPos = (nx, ny, live) => {
    if (!fin(nx) || !fin(ny)) return;
    lx = nx; ly = ny;
    if (live) {
      el.style.transform = `translate3d(${nx - x}px, ${ny - y}px, 0)`;
      if (el.style.willChange !== 'transform') el.style.willChange = 'transform';
      return;
    }
    x = nx; y = ny;
    el.style.left = x + 'px'; el.style.top = y + 'px';
    if (el.style.transform) el.style.transform = '';
    if (el.style.willChange) el.style.willChange = '';
  };
  const setW = nw => {
    if (!fin(nw) || nw <= 0) return;
    w = FX ? FX.w : Math.round(nw);
    el.style.width = w + 'px';
  };
  // the instrument's size (its layout's: a model change or the layout toggle brings a new one): with h (a Hardware
  // layout) the body's height is set once (no measuring); without, the height is measured
  const setFixed = f => {
    const n = fixOk(f) ? { w: Math.round(f.w), h: fin(f.h) && f.h > BAR_H ? Math.round(f.h) : 0 } : null;
    FX = n;
    if (n) { el.setAttribute('data-cv-fixed', ''); w = n.w; el.style.width = w + 'px'; } else el.removeAttribute('data-cv-fixed');
    body.style.height = n && n.h ? (n.h - BAR_H) + 'px' : '';
    hCache = 0;
  };
  const setFold = f => {
    fold = !!f && !noFold; // ((9) nofold: never folded — an undone fold, a stored one)
    if (fold) el.setAttribute('data-cv-fold', ''); else el.removeAttribute('data-cv-fold');
    foldB.setAttribute('aria-expanded', fold ? 'false' : 'true');
    const lbl = fold ? 'Unfold' : 'Fold';
    foldB.setAttribute('aria-label', lbl); foldB.title = lbl;
    placeJacks();
    if (!fold) hCache = 0; // re-measured on the next rect()
  };
  const setZ = nz => { if (fin(nz)) { z = Math.round(nz); el.style.zIndex = String(z); } };
  const setTitle = (t, sub) => {
    title = String(t || '');
    if (tEl.textContent !== title) tEl.textContent = title;
    const s = sub == null ? '' : String(sub);
    if (sEl.textContent !== s) sEl.textContent = s;
    sEl.hidden = !s;
    el.setAttribute('aria-label', title + ' module');
    bar.setAttribute('aria-label', title + (s ? ' · ' + s : '') + ' — drag to move');
  };
  const setChip = c => { // the same element again stays put (an open select keeps its picker and focus)
    if (c === chipCur && (typeof c !== 'object' || !c || c.parentNode === chipEl)) return;
    chipCur = c;
    if (typeof c === 'string') chipEl.textContent = c;
    else { chipEl.textContent = ''; if (c) chipEl.append(c); }
    chipEl.hidden = !c;
  };
  // ---- (1e) power, the key-zone pill, the bar badge
  let pwr = !(o.power && o.power.on === false), zv = o.zone ? zoneOf(o.zone) : null, zpill = null, zpop = null, badgeEl = null;
  const setPower = on => {
    pwr = on !== false;
    if (pwr) el.removeAttribute('data-off'); else el.setAttribute('data-off', '');
    if (o.power) {
      pow.setAttribute('aria-pressed', pwr ? 'true' : 'false');
      const L = pwr ? 'Power: on — switch off' : 'Power: off — switch on';
      pow.setAttribute('aria-label', L); pow.title = L;
    }
  };
  if (o.power) pow.addEventListener('click', e => { e.stopPropagation(); setPower(!pwr); if (o.power.onToggle) o.power.onToggle(pwr); });
  const setBadge = (text, tone) => { // "not connected – silent", "OS 4→2" (null: none); made on first use (no empty slot in the bar)
    const t = text == null || text === '' ? '' : String(text);
    if (!badgeEl) { if (!t) return; badgeEl = mk('span', 'cv-badge'); bar.insertBefore(badgeEl, chipEl); }
    if (badgeEl.textContent !== t) badgeEl.textContent = t;
    badgeEl.hidden = !t;
    badgeEl.title = t;
    if (tone) badgeEl.setAttribute('data-tone', String(tone)); else badgeEl.removeAttribute('data-tone'); // ((review 2) 'mode': a state, not a warning — an LFO's GLOBAL / PER NOTE)
  };
  if (zv) {
    zpill = btn('cv-zone', 'Key zone');
    zpill.setAttribute('aria-haspopup', 'dialog');
    zpill.addEventListener('pointerdown', e => e.stopPropagation()); // (a control: never the world's press, never a move)
    zpill.addEventListener('click', e => { e.stopPropagation(); if (zpop) zoneClose(); else zoneOpen(); });
    el.append(zpill);
  }
  function setZone(z) {
    if (!zpill) return;
    zv = zoneOf(z);
    const L = zoneLabel(zv);
    if (zpill.textContent !== L) zpill.textContent = L;
    zpill.title = L + ' — tap to set the range and transpose';
    zpill.setAttribute('aria-label', 'Key zone: ' + L.slice(6));
    if (zv.lo === 0 && zv.hi === 127 && !zv.xp) zpill.setAttribute('data-all', ''); else zpill.removeAttribute('data-all');
    if (zpop) zpop.sync();
  }
  // the zone popover: low / high / transpose (wk numBoxes: drag, arrows, typed entry) and "All keys"; in the top layer at the
  // pill (wk.layer), closed by the pill, Escape, a press outside or a camera move (wk transient). A drag's end or a key
  // step commits (o.zone.onChange: one undo step each); the pill follows live
  function zoneOpen() {
    const lay = wk.layer(el), box = mk('div', 'cv-zpop'), r = zpill.getBoundingClientRect();
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Key zone of ' + title);
    let cur = Object.assign({}, zv);
    const commit = ph => { setZone(cur); if (ph !== 'move' && ph !== 'start' && o.zone.onChange) o.zone.onChange(Object.assign({}, zv)); };
    const note = (lab, k) => wk.numBox({ label: lab, steps: 127, get: () => cur[k] / 127, def: k === 'lo' ? 0 : 1,
      fmt: n => noteName(Math.round(n * 127)),
      parse: t => { const m = /^\s*([A-Ga-g])([#b]?)\s*(-?\d+)\s*$/.exec(t); if (!m) { const v = parseFloat(t); return isFinite(v) ? v / 127 : null; } const pc = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); return (pc + (+m[3] + 1) * 12) / 127; },
      set: (n, ph) => { const v = Math.round(n * 127); cur[k] = v; if (k === 'lo' && cur.hi < v) cur.hi = v; if (k === 'hi' && cur.lo > v) cur.lo = v; commit(ph); } });
    const lo = note('Low', 'lo'), hi = note('High', 'hi');
    const xp = wk.numBox({ label: 'Transpose', steps: 96, get: () => (cur.xp + 48) / 96, def: 0.5,
      fmt: n => { const v = Math.round(n * 96) - 48; return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v); },
      parse: t => { const v = parseFloat(String(t).replace('−', '-')); return isFinite(v) ? (Math.max(-48, Math.min(48, Math.round(v))) + 48) / 96 : null; },
      set: (n, ph) => { cur.xp = Math.round(n * 96) - 48; commit(ph); } });
    const allB = mk('button', 'cv-zall', 'All keys');
    allB.type = 'button';
    allB.addEventListener('click', () => { cur = { lo: 0, hi: 127, xp: 0 }; commit('set'); sync(); });
    box.append(lo.el, hi.el, xp.el, allB);
    const sync = () => { cur = Object.assign({}, zv); lo.update(); hi.update(); xp.update(); };
    const fixed = lay !== el; // (the top layer: client px; else inside the module, below the pill)
    if (fixed) { box.style.position = 'fixed'; box.style.left = Math.round(r.left) + 'px'; box.style.top = Math.round(r.bottom + 6) + 'px'; }
    lay.append(box);
    const d = doc, onDown = e => { if (!box.contains(e.target) && !zpill.contains(e.target)) zoneClose(); };
    const onKey = e => { if (e.key === 'Escape') { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); zoneClose(true); } };
    d.addEventListener('pointerdown', onDown, true);
    box.addEventListener('keydown', onKey);
    const tOff = typeof wk.addTransient === 'function' ? wk.addTransient(() => zoneClose()) : () => {};
    zpop = { box, sync, off() { d.removeEventListener('pointerdown', onDown, true); box.removeEventListener('keydown', onKey); tOff(); for (const w of [lo, hi, xp]) w.destroy(); } };
    zpill.setAttribute('aria-expanded', 'true');
    try { lo.focus(); } catch (err) { /* no focus */ }
  }
  function zoneClose(focusBack) {
    if (!zpop) return false;
    const z = zpop;
    zpop = null;
    z.off(); z.box.remove();
    zpill.setAttribute('aria-expanded', 'false');
    if (focusBack) { try { zpill.focus(); } catch (err) { /* gone */ } }
    return true;
  }
  // ---- body: mounted at creation, for the module's life (Z1: no cards; unmounted only by destroy)
  function mount() { if (mounted || dead) return; mounted = true; if (o.body && o.body.mount) o.body.mount(body); }
  function unmount() {
    if (!mounted) return;
    mounted = false;
    if (typeof wk.releaseCanvases === 'function') { try { wk.releaseCanvases(body); } catch (err) { /* kit without it */ } }
    if (o.body && o.body.unmount) o.body.unmount(body);
  }
  // on / off screen (the world's plan): nothing visible changes — [data-cv-off] pauses CSS animations, the owner pauses
  // its live displays (monitors)
  function onScreen(on) {
    on = on !== false;
    if (on === onScr) return;
    onScr = on;
    if (on) el.removeAttribute('data-cv-off'); else el.setAttribute('data-cv-off', '');
    if (o.onScreen) o.onScreen(on);
  }
  // ---- (milestone 3) the power slot: a part's own ⏻ handed over by its panel (setPowerEl), a control of the bar
  let powEl = null;
  function setPowerEl(pe) {
    if (o.power || powEl === (pe || null)) return; // (an instrument's own ⏻ button stays)
    pow.textContent = '';
    powEl = pe && typeof pe === 'object' ? pe : null;
    if (powEl) pow.append(powEl);
    pow.hidden = !powEl;
    pow.classList.toggle('cv-powslot', !!powEl);
  }
  if (!o.power) pow.addEventListener('pointerdown', e => { if (powEl) e.stopPropagation(); });
  // ---- bar: move (wk.dragSource), tap / double-tap, menu
  const ctl = t => { for (let n = t; n && n !== bar; n = n.parentNode) if (n === chipEl || n === more || n === foldB || ((o.power || powEl) && n === pow)) return true; return false; };
  for (const c of o.power ? [pow, chipEl, more, foldB] : [chipEl, more, foldB]) c.addEventListener('pointerdown', e => e.stopPropagation()); // controls never start a move
  let D = null, camOff = null, press = null; // the live drag: {x0, y0 (module), p0 (world point under the press), last info}
  const W2 = (cx, cy) => { const wd = W(); return wd && typeof wd.toWorld === 'function' ? wd.toWorld(cx, cy) : { x: cx, y: cy }; };
  const pointer = p => { const wd = W(); if (wd && typeof wd.dragPointer === 'function') wd.dragPointer(p); };
  function follow(i) {
    if (!D) return;
    D.i = i;
    const p = W2(i.x, i.y);
    let nx = D.x0 + p.x - D.p0.x, ny = D.y0 + p.y - D.p0.y;
    nx = gsnap(nx); ny = gsnap(ny); // always on the dots (no toggle, no Shift / Fine escape)
    if (nx === lx && ny === ly) return;
    setPos(nx, ny, true);
    if (o.onMove) o.onMove(nx, ny, 'move');
  }
  function dragEnd() { pointer(null); if (camOff) { camOff(); camOff = null; } bar.classList.remove('cv-moving'); }
  const moveDrag = wk.dragSource(bar, {
    data: id, scrollAxis: 'none', autoScroll: false,
    begin(i) { // (the drag starts past the slop: the module follows from the press point, not from there)
      D = { x0: x, y0: y, p0: press ? W2(press.x, press.y) : W2(i.x, i.y), i };
      bar.classList.add('cv-moving');
      select(true); // (a member of a selection of several keeps it: the group moves with it)
      if (o.onMove) o.onMove(x, y, 'start');
      const wd = W();
      if (wd && typeof wd.on === 'function') camOff = wd.on('camera', () => { if (D) follow(D.i); }); // edge pan / a second finger: re-project
      pointer({ x: i.x, y: i.y, pointerType: i.pointerType });
    },
    move(i) { follow(i); pointer({ x: i.x, y: i.y, pointerType: i.pointerType }); },
    drop(i) {
      if (!D) return;
      follow(i);
      D = null; dragEnd();
      setPos(lx, ly, false);
      if (o.onMove) o.onMove(x, y, 'end');
    },
    cancel() { // Escape or a second finger (gesture.js two-finger pointercancel): back to where it started
      if (!D) return;
      const s = D; D = null; dragEnd();
      setPos(s.x0, s.y0, false);
      if (o.onMove) o.onMove(x, y, 'cancel');
    },
  });
  // tap = world.select, double-tap = world.focusItem (100 % and edit state); then the owner's callbacks
  function select(keep, add) { const wd = W(); if (wd && typeof wd.select === 'function') wd.select(id, keep || add ? { keep: !!keep, add: !!add } : undefined); if (o.onSelect) o.onSelect(); }
  function focus() { const wd = W(); if (wd && typeof wd.focusItem === 'function') wd.focusItem(id, { animate: true }); if (o.onDouble) o.onDouble(); }
  let tapT = -1e9, tapX = 0, tapY = 0;
  const onClick = e => {
    if (ctl(e.target)) return;
    const t = typeof e.timeStamp === 'number' ? e.timeStamp : Date.now(), dbl = t - tapT < 350 && Math.hypot(e.clientX - tapX, e.clientY - tapY) < 24;
    tapT = dbl ? -1e9 : t; tapX = e.clientX; tapY = e.clientY;
    if (dbl) focus(); else if (e.shiftKey) select(false, true); else select(); // (Shift-click: add to / take from the selection)
  };
  bar.addEventListener('click', onClick);
  // the press captures the pointer at once: a quick mouse flick leaves the 40 px bar before the drag's 4 px slop, and its
  // moves would go to whatever lies under it (dragSource captures only once the drag starts)
  const grab = (n, e) => { try { n.setPointerCapture(e.pointerId); } catch (err) { /* pointer gone */ } };
  bar.addEventListener('pointerdown', e => { if (e.button !== 0) return; press = { x: e.clientX, y: e.clientY }; grab(bar, e); if (o.onPress) o.onPress(); });
  bar.addEventListener('keydown', e => {
    if (e.target !== bar) return;
    if (e.key === 'Enter') { e.preventDefault(); focus(); }
  });
  const menuOff = wk.menuSource(bar);
  function openMenu(cx, cy) {
    const items = o.menu ? o.menu() : [];
    if (items && items.length) wk.contextMenu(cx, cy, items, { anchor: more });
  }
  bar.addEventListener('contextmenu', e => {
    if (ctl(e.target) && e.target !== more) return; // the chip's own menu (a select) stays the browser's
    e.preventDefault();
    if (D) return;
    openMenu(e.clientX, e.clientY);
  });
  more.addEventListener('click', e => {
    e.stopPropagation();
    const r = more.getBoundingClientRect();
    openMenu(r.left, r.bottom + 4);
  });
  foldB.addEventListener('click', e => {
    e.stopPropagation();
    setFold(!fold);
    if (o.onFold) o.onFold(fold);
  });
  // ---- initial state
  setPos(x, y, false); setFixed(FX); setW(w); setFold(fold); setZ(z);
  setTitle(o.title, o.sub);
  setChip(o.chip || null);
  if (o.power) setPower(pwr);
  if (zv) setZone(zv);
  if (o.badge) setBadge(o.badge);
  mount();
  const M = {
    id, el, bar, body, cost: fin(o.cost) ? o.cost : 600, kind,
    rect: () => ({ x: lx, y: ly, w, h: fold ? BAR_H : measure() }),
    onScreen,
    setPos, setW, setFold, setZ, setTitle, setChip, setFixed,
    /** (1d) the module's DSP load on its top bar: a fraction of the audio deadline (the engine's stats.per), null = none */
    setCpu(load) {
      // (IMPL-FR review 2, P2-2) the figure (cpuS, %; 0 = "<0.1") holds while the load stays within 1.5 of its display steps — 1 %
      // from 10 % up, 0.1 % below: a reading jittering across a rounding edge never rewrites the bar (each write re-laid the page out)
      const p = fin(load) && load >= 0 ? load * 100 : NaN;
      if (!(p === p && Math.abs(p - cpuS) <= (cpuS >= 10 ? 1.5 : 0.15) + 1e-9)) cpuS = p === p ? (p >= 10 ? Math.round(p) : p >= 0.1 ? +p.toFixed(1) : 0) : NaN;
      const t = cpuS === cpuS ? (cpuS >= 10 ? cpuS : cpuS > 0 ? cpuS.toFixed(1) : '<0.1') + '%' : '';
      if (cpu.textContent !== t) { cpu.textContent = t; cpu.title = t ? 'DSP load of this module: ' + t + ' of the audio deadline' : ''; }
    },
    /** module-local offset of a jack (pure geometry: w and fold; (3) an inline jack's anchor centre, measured once per relayout) */
    port(jackId) {
      const j = jacks.get(jackId), o = fold ? JACK_OUT : 0;
      if (!j) return { x: w / 2, y: BAR_H / 2 };
      if (j.face) return { x: j.x, y: j.y }; // ((9) a face jack: the spec's point — its module never folds)
      if (j.inline && !fold) { const at = inlineAt(j, jackId); if (at) return { x: at.x, y: at.y }; if (j.hide) return { x: w, y: BAR_H / 2 }; } // ((8) a hidden pad's: the right edge at the bar)
      return { x: j.side === 'left' ? (o ? -o : 0) : w + o, y: jackY(j) };
    },
    /** (milestone 3) the inline jacks are measured again at their next port() (a body re-rendered, a size change) */
    relayout() { for (const j of jacks.values()) if (j.inline) j.dirty = true; },
    /** (3) a jack's direction ('in' | 'out', from its spec) and its dot (an inline jack's fallback element) */
    jackDir: jackId => (jacks.get(jackId) || {}).dir || null,
    jackDot: jackId => (jacks.get(jackId) || {}).dot || null,
    /** (8) a jack's hide flag (a Pads module's pad outside its grid): its dot hidden, its cable at the bar's right end */
    setJackHide, jackHidden: jackId => !!(jacks.get(jackId) || {}).hide, setJackLabel,
    /** (3) the bar's power slot: a part's own ⏻ (lane B's View.power, a data-dest="x.on" control; null empties it) */
    setPowerEl,
    get titleEl() { return ttl; },
    // (additions) state reads for the track view, main.js and tests
    get x() { return lx; }, get y() { return ly; }, get w() { return w; }, get z() { return z; }, get fold() { return fold; },
    get screen() { return onScr; }, get fixed() { return FX ? Object.assign({}, FX) : null; }, get title() { return title; },
    nofold: noFold, compact, // ((9) a patch module / its controller: never folded; the compact bar)
    dragging: () => !!D,
    /** the canvas arrow keys (cv-world key): one onMove start / end pair per nudge (one undo step) */
    nudge(dx, dy) {
      if (D || !fin(dx) || !fin(dy) || (!dx && !dy)) return;
      if (o.onMove) o.onMove(x, y, 'start');
      setPos(x + dx, y + dy, false);
      if (o.onMove) o.onMove(x, y, 'end');
    },
    jack: jackId => (jacks.get(jackId) || {}).el || null,
    /** (1e) the jack ids of the module, in order */
    jackIds: () => [...jacks.keys()],
    openMenu,
    /** (1e) power: [data-off] dims the module (and the ⏻ button's aria-pressed when it has one) — the host's state, no callback */
    setPower, get on() { return pwr; },
    /** (1e) the key-zone pill's {lo, hi, xp} (an instrument made with o.zone); no callback */
    setZone, get zone() { return zv ? Object.assign({}, zv) : null; }, zoneOpen: () => { if (zpill && !zpop) zoneOpen(); }, zoneClose,
    /** (1e, U3) how far the pill reaches left of the module (world px: its width and the 10 px gap; 0 without one) — a
     * camera that frames the module keeps it clear of the rail (one layout read) */
    get zoneW() { return zpill ? (+zpill.offsetWidth || 72) + 10 : 0; },
    /** (1e) the bar badge: text or null */
    setBadge, get badge() { return badgeEl && !badgeEl.hidden ? badgeEl.textContent : null; },
    destroy() {
      if (dead) return;
      zoneClose();
      if (D) { D = null; dragEnd(); }
      moveDrag.destroy(); menuOff();
      if (ro) { try { ro.disconnect(); } catch (err) { /* gone */ } }
      unmount();
      dead = true;
      el.remove();
    },
  };
  return M;
}

/* ---------------------------------------------------------------- the track view */
/**
 * The stage-1b view of one track: instrument (ID.inst), FX module (fxKey(model)), OUT (ID.out), positioned from
 * track.lay (layOf), added to the world, plus the derived cables (cv-cables). main.js (MODULES region) supplies the
 * bodies and the edits; this module never touches the project except through host callbacks.
 * host.lay(key, entry, phase, what): 'start' opens the undo step of a move / fold (what), 'end' writes the
 * entry; an 'end' without a 'start' (bring to front: z) writes without an undo step; 'cancel' changes nothing.
 * (Additions: host.root — the element modules live in (default world.el: #world); host.shown(key) — a module went on /
 * off screen or folded (main.js: monitors.sync); host.size(kind) — the instrument's fixed size: {fixed: {w, h}} (a
 * Hardware layout) or {fixed: {w}} (the Simple layout, a Serum: the height measured; default defaultW(ID.inst, model));
 * host.select(key) / host.focus(key).)
 * (1e) Device-driven when host.devices(track) is given (IMPL-1e §4.1): its list [{key, kind: 'inst' | 'fx' | 'out', model,
 * dev}] (devicesOf(track) is the default one) makes one module per key — a module key is the device id ('i1', 'fx1',
 * 'i2/fx', 'out') — and sync diffs by key (a kind change rebuilds that one). Then, per key:
 *   host.bodies.mount(key, bodyEl) / host.bodies.unmount(key, bodyEl)   the module's body (mounted for its life)
 *   host.title(key) → {title, sub, chip}   host.menu(key) → items   host.size(key) → {fixed: {w, h?}} | null
 *   host.power(key, on)?  → instruments get the ⏻ button (dev.on !== false shows on)
 *   host.zone(key, {lo, hi, xp})?  → instruments get the key-zone pill (dev.zone)
 *   host.badge(key) → text | { text, tone } | null   the bar badge ("not connected – silent", "OS 4→2"; tone 'mode': a state such as an LFO's GLOBAL / PER NOTE), read on every sync / refresh
 *   host.cables: {onSelect(id | null), onAction(id, 'disconnect' | …), menu(id) → items, dashed?(row) → bool,
 *                 dashedSet?() → Set<row id> (asked once per refresh: 2b C4)}   the editable cables (cablesOf)
 *   host.patch: false   (1f) read-only cables: every cable and jack data-ro (no press, focus or "Connect to…"; cableDrag
 *        still works when a caller makes one — main.js does not since stage 1f)
 * Instruments' jacks are focusable buttons; the jacks inside a Serum (its out → its own FX's in) carry data-ro.
 * (2a) Modulator devices ({key, kind: 'mod', mod: 'wheel' | 'velo' | 'at' | 'bend'}): W_MOD × MOD_H[mod] (host.size may
 * say otherwise), one right jack {id: 'out', kind: 'mod'} that is always patchable (host.patch: false keeps the audio
 * cables read-only only), colour dev.color else MOD_COLOR[mod], cost 40. Mod cables (cablesOf with {project:
 * host.project(), presetRows: host.presetRows} when the host gives either; track.mods rows always) stay editable and
 * end on their knobs: V.destPort(dev, param) (host.destPort first when given) from [data-dest] offsets cached per module
 * — dropped on a fold, a size change, sync / refresh and V.remeasure(key?) (a Serum page switch) — added to ports()
 * under the cable's b ('<dev>:<param>'). host.cables.onHint(text): the 24+ hint; V.setModsVisible(mode).
 * Tidy (no lay entry) places any number of devices (tidy(track, sizes, devices)). Same geometry on every device.
 * (9, IMPL-9 §4.1–§4.5) Patch modules: entries {key: 'iN/m<k>', kind: 'pm', dev: 'iN', mid, type, title, sub, fixed: {w, h}, jacks:
 * [{id, side: 'face', x, y, kind: 'cord', sig, dir, label, hit}]} (cv-patch devices) — the compact bar, no fold, their fixed size
 * (host.size(key)), their face jacks; an entry's `side: 'face'` jacks join any module's (the controller's on its instrument);
 * a cord jack ([data-kind="cord"]) is pressable whatever host.patch (cv-cables hands its press to cv-patch). An entry with
 * nofold / compact gets them (the controller: nofold). Tidy places the 'pm' modules by host.rackLayout(instKey) → {key: {x,
 * y}} relative to their instrument's top-left (patch-core rackLayout's rows above it); host.onRelay(ports) after every
 * relayout (the cord layer's anchors: cv-cords); host.members(key) → [keys] outlined with a selected module (a driver's).
 * (WC, review 2 P2-5) host.tidyOpts(track) → tidy()'s opts (a rig's modulator targets, a portrait canvas) for the modules Tidy places.
 * (MM UI fixer, review MM-2 P2-2) an 'fx' entry with noIn: true has no left 'in' jack (the master rack: its input is the mix, never
 * patched — a modulator's cable passing under the rack must not read as plugged into it); its 'out' as ever.
 * @param {object|null} world  cv-world World (null: modules still lay out in host.root at k = 1)
 * @param {{id: string, model: string, name: string, color: string, lay?: Lay}} track
 * @param {object} host
 * @returns {{trackId: string, modules: Map<string, Module>, sync: (track: object) => void,
 *   ports: () => Map<string, {x: number, y: number}>, live: (key: string) => boolean, destroy: () => void}}
 */
export function createTrackView(world, track, host) {
  const H = host || {}, doc = H.doc || globalThis.document, root = H.root || (world && world.el) || null;
  const DEV = typeof H.devices === 'function', RO = H.patch === false;
  let T = track;
  const mods = new Map(); // key → Module
  const CB = DEV && isObj(H.cables) ? H.cables : {};
  const cables = createCables(root, { doc, onSelect: CB.onSelect, onAction: CB.onAction, menu: CB.menu, onHint: CB.onHint, ignore: CB.ignore, mods: H.mods,
    k: () => (world && world.k > 0 ? world.k : 1),
    // ((WC, IMPL-WC §4.1) the host's cords mode: which records its cord layer draws, the records + ports after each relayout, the
    // selection mirrored, a point on a drawn rope)
    cords: CB.cords, onRecords: CB.onRecords, cordSel: CB.cordSel, cordPoint: CB.cordPoint, top: CB.top, // ((WC, fixer B2) top: the layer above the cords (the claimed badges, the ×)
    route: CB.route }); // ((WC, integration fixer L — P3-11) a line the host routes (a rig's upright wrap: cv-cables wrapPath)
  let DL = [], DM = new Map(); // (1e) the host's devices, by key
  const readDevs = () => {
    if (!DEV) return;
    let L = null;
    try { L = H.devices(T); } catch (err) { console.error(err); L = null; }
    const seen = new Set();
    DL = (Array.isArray(L) ? L : []).filter(d => isObj(d) && typeof d.key === 'string' && /^(inst|fx|out|mod|part|pm)$/.test(d.kind) && !seen.has(d.key) && seen.add(d.key));
    DM = new Map(DL.map(d => [d.key, d]));
  };
  readDevs();
  // ((milestone 3, after lane A's accessor retirement) the view has no V.model any more — it read the track-level accessor,
  // and nothing read it: an instrument's model is its device entry's, modelOf(key))
  const keys = () => (DEV ? DL.map(d => d.key) : [ID.inst, fxKey(T.model), ID.out]);
  const kindOf = key => (DEV ? (DM.get(key) || { kind: 'fx' }).kind : key === ID.inst ? 'inst' : key === ID.out ? 'out' : 'fx');
  const modelOf = key => (DEV ? (DM.get(key) || {}).model || null : kindOf(key) === 'inst' ? T.model : null);
  // (milestone 3) a part's entry names its Serum by id (dev: 'iN'): its device record is the track's
  const devOf = key => { if (!DEV) return null; const d = (DM.get(key) || {}).dev; return typeof d === 'string' ? (isObj(T.dev) && isObj(T.dev[d]) ? T.dev[d] : null) : d || null; };
  const mkOf = key => (DEV ? (DM.get(key) || {}).mod || modKind(key) : null); // (2a) a modulator's mod kind
  const partOf = key => { const d = DM.get(key) || {}, q = splitKey(key); return { dev: typeof d.dev === 'string' ? d.dev : q ? q.dev : String(key).split('/')[0], part: d.part || (q ? q.part : null) }; };
  // (3) a Serum in parts view: its device entry says so (ui: 'parts'), else its lay entry (the view flag)
  const isParts = key => { const d = DM.get(key); return !!d && d.kind === 'inst' && isSxId(d.model) && (d.ui === 'parts' || (d.ui == null && partsView(T, key))); };
  // ((WC) a rig's module: its entry's drawing mode, 'cords' | 'lines' (the host's drawMode), else null — stage 3's jacks)
  const wiresOf = key => { const d = DEV ? DM.get(key) : null; return d && WIRES.includes(d.wires) ? d.wires : null; };
  const call = (f, ...a) => { try { return typeof f === 'function' ? f(...a) : undefined; } catch (err) { console.error(err); return undefined; } };
  // the instrument's fixed size from the host: {fixed: {w, h}} (a Hardware layout) or {fixed: {w}} (the height measured);
  // (1e) any module's, by key; an instrument's default its model's width; (3) a part's PART_W_DEF, a Serum-faithful
  // modulator's MOD_W (both: the height measured)
  const sizeOf = key => {
    const kind = kindOf(key);
    let s = null;
    try { s = H.size ? (DEV ? H.size(key) : kind === 'inst' ? H.size('inst') : null) : null; } catch (err) { s = null; }
    if (isObj(s) && isObj(s.fixed) && fin(s.fixed.w) && s.fixed.w > 0) return s;
    if (kind === 'mod') { const k = mkOf(key); return { fixed: SX_MODS.has(k) ? { w: modW(k) } : { w: modW(k), h: MOD_H[k] || MOD_H.at } }; }
    if (kind === 'part') return { fixed: { w: PART_W_DEF[partKind(partOf(key).part)] || W_MOD } };
    if (kind === 'pm') { const f = (DM.get(key) || {}).fixed; return { fixed: isObj(f) && fin(f.w) && f.w > 0 ? { w: f.w, h: f.h } : { w: W_PM } }; } // ((9) the entry's size, else 1 MU wide)
    if (kind === 'inst' && wiresOf(key)) return { fixed: { w: PART_W_DEF.amp } }; // ((WC) a rig's Amplifier)
    if (kind === 'inst' && isParts(key)) return { fixed: { w: PART_W_DEF.voice } };
    return kind === 'inst' ? { fixed: { w: DEV ? kindW('inst', modelOf(key)) : defaultW(ID.inst, T.model) } } : null;
  };
  // (8) a device entry's own jacks ({key, kind: 'mod', jacks: [{id, side, kind, label, y?, hide?}]}: a Pads module's mod pads
  // and its notes jack, review #4) — valid specs only, copies; null when the entry has none
  // ((9) a face jack's spec: side 'face', its module-local x / y, kind 'cord', sig, dir, hit — the patch modules' and the controller's)
  const faceSpec = j => j.side === 'face' && fin(j.x) && fin(j.y);
  const entryJacks = key => {
    const L = DEV ? (DM.get(key) || {}).jacks : null;
    if (!Array.isArray(L)) return null;
    return L.filter(j => isObj(j) && typeof j.id === 'string' && /^[\w-]{1,24}$/.test(j.id)).map(j => (faceSpec(j)
      ? { id: j.id, side: 'face', x: j.x, y: j.y, kind: 'cord', sig: j.sig === 's' ? 's' : 'v', dir: j.dir, label: typeof j.label === 'string' ? j.label : '', hit: fin(j.hit) ? j.hit : undefined }
      : { id: j.id, side: j.side === 'left' || j.side === 'inline' ? j.side : 'right', kind: typeof j.kind === 'string' ? j.kind : 'mod', label: typeof j.label === 'string' ? j.label : '', y: fin(j.y) ? j.y : undefined, hide: !!j.hide }));
  };
  const faceJacks = key => (entryJacks(key) || []).filter(j => j.side === 'face');
  // (3) the jacks a module has: they change with a Serum's view (VOICE's in parts view) — a different set rebuilds it; (9) a patch
  // module's are its face's (the entry's), an instrument's entry may add face jacks (a patch instrument's controller)
  const jacksOf = (key, title) => {
    const kind = kindOf(key), wm = wiresOf(key); // ((WC) a rig's: its jack rows, by the drawing mode)
    if (kind === 'part') return partJacks(partOf(key).part, title, wm);
    if (kind === 'pm') return faceJacks(key);
    if (kind === 'inst') return (wm ? rigJacks('amp', title, wm) : isParts(key) ? voiceJacks(title) : [{ id: 'out', side: 'right', kind: 'audio', label: (title || 'Instrument') + ' out' }]).concat(faceJacks(key));
    if (kind === 'fx') return (DEV && (DM.get(key) || {}).noIn ? [] : [{ id: 'in', side: 'left', kind: 'audio', label: (title || 'FX') + ' in' }]).concat({ id: 'out', side: 'right', kind: 'audio', label: (title || 'FX') + ' out' }); // ((MM UI fixer, review MM-2 P2-2) noIn: the master rack — nothing is patched into it
    if (kind === 'mod') { const J = entryJacks(key); return J || modJacks(mkOf(key), title); } // ((2b) a macro: k1…k8 at its knob rows; (3) inline on its tiles; (8) the entry's)
    return [{ id: 'in', side: 'left', kind: 'audio', label: 'OUT in' }];
  };
  const jsig = key => jacksOf(key, '').map(j => j.id + ':' + j.side + (j.side === 'face' ? '@' + j.x + ',' + j.y : '') + (j.awake ? '#' + j.kind : '')).join(); // ((9) a face jack's place too; (WC) a rig jack's kind: a mode flip rebuilds)
  const sizes = () => { const o = {}; for (const [k, m] of mods) { const r = m.rect(); o[k] = { w: r.w, h: r.h }; } return o; };
  // Tidy's widths (no layout read); (1e) a known fixed height too, so stacked modules never move as heights are measured
  const tidied = () => {
    const o = {};
    for (const [k, m] of mods) {
      o[k] = { w: m.w };
      if (DEV && m.fixed && m.fixed.h) o[k].h = m.fixed.h;
      else if (DEV && (m.kind === 'part' || (m.kind === 'mod' && SX_MODS.has(mkOf(k))))) { const h = m.rect().h; if (h > BAR_H) o[k].h = h; } // ((3) measured: stacks never overlap)
    }
    // ((8) a modulator not made yet with a size from the host — a Pads module's footprint —: Tidy places it by its own size,
    // its right edge at −MOD_GAP; the other kinds' sizeOf is Tidy's own guess, so nothing else moves)
    if (DEV) for (const dd of DL) if ((dd.kind === 'mod' || dd.kind === 'pm') && !o[dd.key]) { const s = sizeOf(dd.key), f = s && s.fixed; if (f && fin(f.w) && fin(f.h) && f.h > BAR_H) o[dd.key] = { w: f.w, h: f.h }; }
    return DEV ? tidy(T, o, DL, typeof H.rackLayout === 'function' ? k => call(H.rackLayout, k) : null, typeof H.tidyOpts === 'function' ? call(H.tidyOpts, T) : undefined) : tidy1(T, o); // ((9) the patch modules: the host's rack; (WC) a rig's targets and the canvas's shape)
  };
  // (P R2-F2) Tidy once per sync, not once per module (each was O(n) in the modules plus Tidy itself: O(n²) on a big rack): the result
  // is kept while its inputs hold — td = null at every change of them (a module made / removed, a width / fixed size / fold moved,
  // a measured module's size set again) — so each module still sees exactly the sizes of the ones before it
  let td = null;
  const tidyNow = () => td || (td = tidied());
  // the lay entry of a module as it stands: never a width (each module's is fixed: a stored w from before is dropped
  // here, on its next write), z only once brought to front
  const entryOf = key => {
    const m = mods.get(key);
    if (!m) return null;
    const e = { x: Math.round(m.x), y: Math.round(m.y) }, old = isObj(T.lay) && isObj(T.lay[key]) ? T.lay[key] : null;
    if (m.fold) e.fold = 1;
    if (m.zSet) e.z = m.z;
    if (old && (old.ui === 'flow' || old.ui === 'parts')) e.ui = old.ui; // the instrument's layout choice (IMPL-panels §7.1; (3) a Serum's parts view) rides along
    return e;
  };
  let lastPorts = null;
  function ports() {
    const p = new Map();
    for (const [k, m] of mods) for (const j of m.jackIds()) { const o = m.port(j); p.set(k + '.' + j, { x: m.x + o.x, y: m.y + o.y }); } // ((2b) every jack: a macro's k1…k8)
    // ((WC) a rig's ENV 1 is its own module: 'iN.env1' — the ENV 1 rows' source jack, sx-edges' voice.env1 — is its OUT)
    for (const [k] of mods) if (kindOf(k) === 'inst' && wiresOf(k) && !p.has(k + '.env1') && p.has(k + '/env1.out')) p.set(k + '.env1', p.get(k + '/env1.out'));
    for (const c of cables.list()) { // (2a) a mod cable's knob end (cached offsets: no layout read once measured)
      if (c.kind === 'note' && typeof c.b === 'string' && !p.has(c.b)) { // ((8) a note cable: the instrument's left edge, no jack (review #13))
        const i = c.b.lastIndexOf('.'), m = i > 0 && c.b.slice(i + 1) === NOTE_END ? mods.get(c.b.slice(0, i)) : null;
        if (m) p.set(c.b, { x: m.x - (m.fold ? JACK_OUT : 0), y: m.y + (m.fold ? BAR_H / 2 : BAR_H + JACK_Y) });
        continue;
      }
      if (c.kind !== 'mod' || p.has(c.b)) continue;
      const i = c.b.indexOf(':'), q = i > 0 ? destPort(c.b.slice(0, i), c.b.slice(i + 1)) : null;
      if (q) p.set(c.b, q);
    }
    return p;
  }
  /* ---- (2a) knob end points: per module, the [data-dest] elements by '<dev>:<param>' (one walk) and their module-local
   * centres (one rect read each, on first use); dropped by fold / size / sync / refresh / remeasure */
  // (U1) a Serum keeps its hidden pages in the DOM: a key can have several elements (one shown, the rest 0 × 0), so every
  // one is indexed and the first with a box wins; an end parked on the bar because none was shown is tried again on the
  // next lookup outside a live move (no rect read per frame of a drag)
  const DC = new Map(); // module key → { idx: Map(dk → [el]), pos: Map(dk → {x, y, hid?}) }
  let quiet = false; // (a module's live move: cached ends only)
  function indexOf(k, m) {
    let c = DC.get(k);
    if (c) return c;
    const idx = new Map(), st = [[m.el, k.split('/')[0]]];
    while (st.length) {
      const [n, dv0] = st.pop();
      for (const e of n.children || []) {
        if (!e || typeof e.getAttribute !== 'function' || e.getAttribute('data-twin') != null) continue; // ((3) a twin is no end)
        const dv = e.getAttribute('data-dev') || dv0, id = e.getAttribute('data-dest');
        if (id) { const q = dv + ':' + id, L = idx.get(q); if (L) L.push(e); else idx.set(q, [e]); }
        st.push([e, dv]);
      }
    }
    c = { idx, pos: new Map() };
    DC.set(k, c);
    return c;
  }
  const rectOf = e => { try { return e.getBoundingClientRect(); } catch (err) { return null; } };
  const shown = r => !!r && (r.width > 0 || r.height > 0);
  const barPt = () => ({ x: 0, y: BAR_H / 2 }); // (folded, or the knob not shown: the module's left edge at its bar)
  function localDest(k, m, dk) { // the knob's centre in module px; null: not in this module
    let c = indexOf(k, m), L = c.idx.get(dk);
    if (L && L.some(e => e.isConnected === false)) { DC.delete(k); c = indexOf(k, m); L = c.idx.get(dk); } // (the body re-rendered)
    if (!L) return null;
    if (m.fold) return barPt();
    const q = c.pos.get(dk);
    if (q && (!q.hid || quiet)) return q;
    let r = null, el = null;
    for (const e of L) { const x = rectOf(e); if (shown(x)) { r = x; el = e; break; } }
    const R = rectOf(m.el), s = R && R.width > 0 && m.w > 0 ? R.width / m.w : 1, q2 = v => Math.round(v * 100) / 100;
    const p = r && R ? { x: q2((r.left + r.width / 2 - R.left) / s), y: q2((r.top + r.height / 2 - R.top) / s) } : Object.assign(barPt(), { hid: true });
    if (r && R) p.r = q2(Math.min(r.width, r.height) / 2 / s); // ((WC) the knob's radius: a cords-mode end's rim
    const kd = r && R ? wk.discBox(el) : null; // ((WC, fixer B2) a knob's own disc (wk.discBox — the one measure, review WC-int P3-18: inside the control's box): the rim a cord ends at
    if (kd) { p.kx = q2((kd.left + kd.width / 2 - R.left) / s); p.ky = q2((kd.top + kd.height / 2 - R.top) / s); p.kr = q2(Math.min(kd.width, kd.height) / 2 / s); }
    c.pos.set(dk, p);
    return p;
  }
  function destPort(dev, pid) {
    if (typeof H.destPort === 'function') { const q = call(H.destPort, dev, pid); if (q && fin(q.x) && fin(q.y)) return { x: q.x, y: q.y }; }
    const dk = dev + ':' + pid, cand = [...mods.keys()].filter(k => k === dev || k.startsWith(dev + '/'));
    // (milestone 3) a destination is shown in one module: the first with a box (or folded: its bar) wins over one parked on
    // a hidden element; in parts view none shown → VOICE's bar, hidden (the cable dashed, tagged); ((WC) a rig's in cords mode:
    // its radius r too — the host's rim point, the badge's offset; (fixer B2) a knob's own disc kx, ky, kr: the rim a cord ends at)
    let parked = null;
    const rim = wiresOf(dev) === 'cords';
    for (const k of cand) { const m = mods.get(k), q = localDest(k, m, dk); if (q && !q.hid) return rim && fin(q.r) && !m.fold ? Object.assign({ x: m.x + q.x, y: m.y + q.y, r: q.r }, fin(q.kr) ? { kx: m.x + q.kx, ky: m.y + q.ky, kr: q.kr } : null) : { x: m.x + q.x, y: m.y + q.y }; if (q && !parked) parked = { x: m.x + q.x, y: m.y + q.y }; }
    const own = /^fx\./.test(pid) && mods.get(dev + '/fx'), m = own || mods.get(dev); // (a knob not on the panel: the module's bar)
    if (!own && m && isParts(dev)) return { x: m.x, y: m.y, hid: true, tag: hiddenTag(pid) }; // ((review 2 P1-7) VOICE's top-left corner: the tag above its bar)
    if (parked) return parked;
    return m ? { x: m.x, y: m.y + BAR_H / 2 } : null;
  }
  function relay() { lastPorts = ports(); cables.layout(lastPorts); if (typeof H.onRelay === 'function') call(H.onRelay, lastPorts); } // ((9) the cord layer's anchors)
  const meta = key => { try { return (H.title && H.title(DEV ? key : kindOf(key))) || {}; } catch (err) { return {}; } };
  const lay = (key, phase, what) => {
    if (!H.lay) return;
    H.lay(key, entryOf(key), phase, what);
    // the first write pins the modules Tidy still places, where they stand (else a later sync re-tidies them from the
    // current widths: they jump, or land on a moved sibling); inside the step 'start' opened, so undo takes them too.
    // An untouched track keeps no lay key (its History snapshots stay the same)
    if (phase === 'end') for (const k of mods.keys()) if (k !== key && !(isObj(T.lay) && okEntry(T.lay[k]))) H.lay(k, entryOf(k), 'end', 'pin');
  };
  const update = key => { if (world && typeof world.update === 'function') world.update(key); }; // (a key, or a list of keys: one world update)
  let grp = null; // a group move: { key (the mover), x0, y0, list: [{ k, m, x0, y0 }] }
  const groupOf = key => {
    const ids = world && Array.isArray(world.selection) ? world.selection : null, m = mods.get(key);
    if (!m || !ids || ids.length < 2 || !ids.includes(key)) return null;
    return { key, x0: m.x, y0: m.y, list: ids.filter(k => k !== key && mods.has(k)).map(k => { const o = mods.get(k); return { k, m: o, x0: o.x, y0: o.y }; }) };
  };
  const costOf = key => { const kind = kindOf(key); return kind === 'inst' ? (isParts(key) ? 900 : ((DEV ? modelOf(key) : T.model) === 'serum' ? 3700 : 600)) : kind === 'fx' ? 900 : kind === 'part' ? 400 : kind === 'pm' ? COST_PM : kind === 'mod' && SX_MODS.has(mkOf(key)) ? 160 : 40; };
  const colorOf = key => { const d = devOf(key), e = DEV ? DM.get(key) : null; return (d && typeof d.color === 'string' && d.color) || (e && typeof e.color === 'string' && e.color) || (kindOf(key) === 'mod' && MOD_COLOR[mkOf(key)]) || T.color; }; // ((8) an entry's own colour: the Pads module's)
  // (3) a part's title and chip: the host's, else 'OSC B' and 'S<n>' (the Serum's number: its group)
  const partMeta = (key, M0) => { const P = partOf(key), n = /(\d+)$/.exec(P.dev || ''); return { title: M0.title || partLabel(P.part), sub: M0.sub, chip: M0.chip !== undefined ? M0.chip : 'S' + (n ? n[1] : '1') }; };
  // (3) an internal end (sx-edges) that a cable edit may start or end on: not the warp inputs, not VOICE → own FX
  const intPatch = (key, j) => { const P = kindOf(key) === 'part' ? partOf(key) : isParts(key) ? { dev: key } : null, e = P ? endOf(P.dev, key + '.' + j) : null; return !!e && !/\.warp$/.test(e) && e !== 'voice.out'; };
  // (1e) the per-device state a sync / refresh brings: power, zone, badge, the inner Serum jacks, cost, colour; (3) a part's
  // power ([data-off] while off: dimmed, as an instrument switched off) and its ⏻ (host.powerEl)
  function decorate(key, m) {
    if (!DEV) return;
    const d = devOf(key), kind = kindOf(key);
    if (kind === 'inst') { m.setPower(!(d && d.on === false)); if (m.zone) m.setZone(d && d.zone); }
    if (kind === 'part') {
      const s = d && isObj(d.vals) ? d.vals.s : null;
      m.setPower(!s || partOn(s, partOf(key).part));
      if (typeof H.powerEl === 'function') m.setPowerEl(call(H.powerEl, key) || null);
    }
    const bd = typeof H.badge === 'function' ? call(H.badge, key) || null : null; // (text, or { text, tone })
    m.setBadge(isObj(bd) ? bd.text : bd, isObj(bd) ? bd.tone : null);
    // a jack inside a Serum is its own route (data-ro): no press, no focus, no "Connect to…" (U12) — the patchable ones buttons;
    // (3) a Serum's internal ends in parts view are patchable (an edit through sx-edges: lane D's resolver), whatever host.patch
    const EJ = kind === 'mod' ? entryJacks(key) : null; // ((8) the entry's hide flags: a Grid… change, no rebuild)
    if (EJ) for (const j of EJ) { m.setJackHide(j.id, j.hide); m.setJackLabel(j.id, j.label); }
    for (const j of faceJacks(key)) m.setJackLabel(j.id, j.label); // ((9) a renamed patch module: its jacks' names)
    let roving = false; // ((9) a cord jack is pressable whatever host.patch (review #4): one tab stop per module, kept where it moved)
    for (const j of m.jackIds()) if (m.jack(j).getAttribute('data-kind') === 'cord' && m.jack(j).getAttribute('data-cv-awake') == null && m.jack(j).getAttribute('tabindex') === '0') roving = true;
    for (const j of m.jackIds()) {
      const jk = m.jack(j).getAttribute('data-kind');
      // ((WC) a rig's jack row: every jack a button and a tab stop of its own — its dot too, whose attributes a re-measure copies back)
      if (jk === 'cord' && m.jack(j).getAttribute('data-cv-awake') != null) { for (const e of new Set([m.jack(j), m.jackDot(j)])) { if (!e) continue; e.removeAttribute('data-ro'); e.setAttribute('role', 'button'); e.tabIndex = 0; } continue; }
      if (jk === 'cord') { const e = m.jack(j); e.removeAttribute('data-ro'); e.setAttribute('role', 'button'); if (!roving) { e.tabIndex = 0; roving = true; } else if (e.getAttribute('tabindex') !== '0') e.tabIndex = -1; continue; }
      const pa = (kind === 'mod' && jk !== 'note') || m.jackDir(j) && (jk === 'mod' || intPatch(key, j) || (!RO && jackPort(T, key + '.' + j))); // ((8) a Pads module's notes jack: never patchable)
      for (const e of new Set([m.jack(j), m.jackDot(j)])) {
        if (!e) continue;
        if (pa) { e.removeAttribute('data-ro'); e.setAttribute('role', 'button'); e.tabIndex = 0; } // ((2a) a mod-out: always)
        else { e.setAttribute('data-ro', ''); e.removeAttribute('role'); e.tabIndex = -1; }
      }
    }
    m.cost = costOf(key);
    const c = colorOf(key);
    if (c) m.el.style.setProperty('--mc', c);
  }
  function make(key) {
    const kind = kindOf(key), M1 = meta(key), M0 = kind === 'part' ? partMeta(key, M1) : M1, L = layOf(T, key, tidyNow(), keys()), SZ = kind === 'inst' || DEV ? sizeOf(key) : null, d = devOf(key);
    const jk = jacksOf(key, M0.title);
    const ext = {};
    if (DEV) {
      ext.patch = !RO;
      const ent = DM.get(key) || {}; // ((9) a patch module: the compact bar, no fold; an entry may ask for either: the controller's nofold)
      if (kind === 'pm' || ent.compact) ext.compact = true;
      if (kind === 'pm' || ent.nofold) ext.nofold = true;
      if (kind === 'inst' && typeof H.power === 'function') ext.power = { on: !(d && d.on === false), onToggle: on => H.power(key, on) };
      if (kind === 'inst' && typeof H.zone === 'function') ext.zone = Object.assign(zoneOf(d && d.zone), { onChange: z => H.zone(key, z) });
    }
    const m = createModule(Object.assign({
      id: key, kind, title: M0.title || '', sub: M0.sub, chip: M0.chip, color: colorOf(key),
      x: L.x, y: L.y, w: DEV ? kindW(kind, modelOf(key)) : defaultW(key, T.model), fold: !!L.fold, z: fin(L.z) ? L.z : 1, fixed: SZ ? SZ.fixed : null,
      cost: costOf(key),
      jacks: jk,
      body: DEV ? { mount: b => { if (H.bodies && H.bodies.mount) H.bodies.mount(key, b); }, unmount: b => { if (H.bodies && H.bodies.unmount) H.bodies.unmount(key, b); } }
        : H.bodies && H.bodies[kind] ? H.bodies[kind] : null,
      menu: () => (H.menu ? (DEV ? H.menu(key) : H.menu(kind, key)) : []),
      onPress: () => front(key),
      onSelect: () => { if (H.select) H.select(key); },
      onDouble: () => { if (H.focus) H.focus(key); },
      onMove: (x, y, phase) => {
        // a selection of several moves together (stage 1c): the others follow the mover's delta, live, and land in the
        // same undo step (written after the mover's entry, which records it)
        if (phase === 'start') grp = groupOf(key);
        const G2 = grp && grp.key === key ? grp : null;
        if (G2) {
          const dx = m.x - G2.x0, dy = m.y - G2.y0;
          for (const g of G2.list) {
            if (phase === 'cancel') g.m.setPos(g.x0, g.y0, false);
            else if (phase !== 'start') g.m.setPos(g.x0 + dx, g.y0 + dy, phase === 'move');
          }
        }
        if (phase !== 'move') lay(key, phase, 'move');
        if (G2 && phase === 'end') for (const g of G2.list) if (H.lay) H.lay(g.k, entryOf(g.k), 'end', 'group');
        quiet = phase === 'start' || phase === 'move';
        try { relay(); } finally { quiet = false; }
        if (phase === 'end' || phase === 'cancel') { update(G2 ? [key].concat(G2.list.map(g => g.k)) : key); if (G2) grp = null; } // (a group's drop: one world update — one overlap pass)
      },
      onFold: f => { DC.delete(key); lay(key, 'start', 'fold'); lay(key, 'end', 'fold'); relay(); update(key); if (H.shown) H.shown(key); },
      onScreen: () => { if (H.shown) H.shown(key); },
      onSize: () => { DC.delete(key); m.relayout(); relay(); update(key); },
    }, ext), { world, doc });
    m.zSet = fin(L.z);
    m.jsig = jsig(key);
    decorate(key, m);
    if (root) root.append(m.el);
    mods.set(key, m);
    td = null;
    if (world && typeof world.add === 'function') world.add(m);
    return m;
  }
  // bring to front: z only (pointer capture survives); renormalised to 1…n once it passes 9999; no undo step
  function front(key) {
    const m = mods.get(key);
    if (!m) return;
    let top = -Infinity, tie = false;
    for (const [k, o] of mods) if (k !== key) { if (o.z > top) top = o.z; }
    for (const [k, o] of mods) if (k !== key && o.z === m.z) tie = true;
    if (m.z > top && !tie) return;
    if (top + 1 > 9999) {
      const order = [...mods.entries()].filter(([k]) => k !== key).sort((a, b) => a[1].z - b[1].z);
      order.forEach(([k, o], i) => { o.setZ(i + 1); o.zSet = true; lay(k, 'end', 'z'); });
      top = order.length;
    }
    m.setZ(top + 1); m.zSet = true;
    lay(key, 'end', 'z');
  }
  // (2a) the mod context: the project (its wheel) and the preset rows, when the host gives them; read-only (1f) keeps the
  // mod cables editable
  // ((2b) host.cables.dashed(row): a per-note source following the last note; (fixer C, C4) host.cables.dashedSet() → the
  // Set of such row ids, asked ONCE per refresh — the host compiles once, not per cable)
  const cOpts = () => {
    // ((WC) a rig on the track (an entry with wires): it is always its modules — cablesOf's parts gate says so (no lay flag), and
    // the host's edges(id, dev) may give its internal records (rig-core's) — else the options as before)
    const rig = DEV && DL.some(d => wiresOf(d.key) || (d.kind === 'inst' && d.ui === 'parts')), C = H.cables || {}; // ((WC, lane H) an entry that says parts — a rig whose stage-3 views stand in — too
    const R = rig ? { parts: id => isParts(id) || !!wiresOf(id), edges: typeof C.edges === 'function' ? C.edges : undefined } : null;
    if (!(typeof H.project === 'function' || H.presetRows)) return R || undefined;
    let dashed = typeof C.dashed === 'function' ? C.dashed : undefined;
    if (typeof C.dashedSet === 'function') { let S = null; dashed = r => { if (!S) { try { S = C.dashedSet(); } catch (err) { S = new Set(); } } return !!S && S.has(r.id); }; }
    return Object.assign({ project: call(H.project), presetRows: H.presetRows, dashed }, R || {});
  };
  // ((3) a Serum's internal cables stay editable under host.patch false: their edits are sx-edges', not wires)
  const cablesNow = () => (!DEV ? deriveCables(T) : RO ? cablesOf(T, cOpts()).map(c => (c.kind === 'mod' || c.int || c.kind === 'note' ? c : Object.assign({}, c, { readonly: true }))) : cablesOf(T, cOpts())); // ((8) a note cable: a tap cable, never patched)
  for (const k of keys()) make(k);
  cables.set(cablesNow());
  relay();
  // cables touching the selection are raised, the others dimmed (§2.9); kept by module id, so a re-derived cable list
  // (a model change, a Serum route edit) is highlighted again
  let selOff = null, selId = null;
  // ((WC) a part's knob — a rig's 'i1:f.cutoff' on its Filter, a Serum part's in parts view — is the part's: its [data-dest] index says)
  const inPart = (b, k) => { const i = b.indexOf(':'), m = i > 0 && k.startsWith(b.slice(0, i) + '/') ? mods.get(k) : null; return !!m && !!m.el && indexOf(k, m).idx.has(b); };
  const touches = (c, k) => c.a.startsWith(k + '.') || (c.b != null && c.b.startsWith(k + '.')) // ((3) a stub has no b)
    || (c.kind === 'mod' && (c.b.startsWith(k + ':') || (/\/fx$/.test(k) && c.b.startsWith(k.slice(0, -3) + ':fx.')) || inPart(c.b, k))); // ((2a) a knob of the module)
  const hl = () => cables.highlight(selId && mods.has(selId) ? cables.list().filter(c => touches(c, selId)).map(c => c.id) : null);
  // (3) selecting a Serum (its VOICE in parts view, or the whole panel) outlines its members: the parts and its own FX
  // ((9) and the host's members of the selected module: a driver's driven patch modules, host.members(key) → [keys])
  const members = () => {
    const ex = selId && typeof H.members === 'function' ? call(H.members, selId) : null, X = new Set(Array.isArray(ex) ? ex : []);
    for (const [k, m] of mods) { if (!!selId && k !== selId && (k.startsWith(selId + '/') || X.has(k))) m.el.setAttribute('data-cv-member', ''); else m.el.removeAttribute('data-cv-member'); }
  };
  if (world && typeof world.on === 'function') selOff = world.on('select', d => { selId = (d && d.id) || null; hl(); members(); if (selId) cables.select(null); });
  // (2a) a zoom's end: the mod cables' ends are END_PX screen px again
  const zoomOff = world && typeof world.on === 'function' ? world.on('cameraend', () => cables.rezoom()) : null;
  const drags = []; // (1e) the cable drags made through V.cableDrag
  const removeMod = k => { const m = mods.get(k); if (world && typeof world.remove === 'function') world.remove(k); m.destroy(); mods.delete(k); td = null; };
  const V = {
    trackId: T.id, modules: mods, cables,
    /** applies lay / title / model changes without remounting bodies (an FX key swap moves the FX body to the new module);
     * (1e) device-driven: modules come and go with host.devices(track) (diffed by key) */
    sync(track) {
      T = track || T;
      readDevs();
      DC.clear();
      td = null;
      V.trackId = T.id;
      const want = keys();
      // ((3) a module whose jacks changed — a Serum switched between bundled and parts view — is made again)
      for (const k of [...mods.keys()]) if (!want.includes(k) || (DEV && (mods.get(k).kind !== kindOf(k) || mods.get(k).jsig !== jsig(k)))) removeMod(k);
      let vis = false; // a fold changed (an undo / redo restore): host.shown once, after every module is in its state
      const kept = []; // (P R2-F2) the modules that stayed: ONE world update for them after the loop (one per module ran the overlap rule over every face each: O(n³))
      for (const k of want) { // (instrument first: Tidy places the others from its new width — a model change on an untouched track)
        let m = mods.get(k);
        if (!m) { make(k); continue; }
        const kind = kindOf(k), M0 = kind === 'part' ? partMeta(k, meta(k)) : meta(k), SZ = kind === 'inst' || DEV ? sizeOf(k) : null;
        const w0 = m.w, f0 = m.fixed;
        m.relayout();
        if (SZ || (DEV && f0)) m.setFixed(SZ ? SZ.fixed : null); // (the size follows the model and the layout toggle, even mid-drag; before Tidy reads the widths)
        if (DEV && !SZ) m.setW(kindW(kind, modelOf(k)));
        const f1 = m.fixed; // (a measured module — a part, a Serum-faithful modulator — is measured again after a setFixed: Tidy is read again)
        if (m.w !== w0 || (f0 ? !f1 || f0.w !== f1.w || f0.h !== f1.h : !!f1) || (DEV && (kind === 'part' || (kind === 'mod' && SX_MODS.has(mkOf(k)))))) td = null;
        const L = layOf(T, k, tidyNow(), want);
        if (!m.dragging()) {
          m.setPos(L.x, L.y, false);
          if (m.fold !== !!L.fold) { m.setFold(!!L.fold); vis = true; td = null; }
        }
        m.zSet = fin(L.z);
        m.setZ(fin(L.z) ? L.z : 1);
        m.setTitle(M0.title || '', M0.sub);
        if (M0.chip !== undefined) m.setChip(M0.chip);
        if (DEV) decorate(k, m); else if (T.color) m.el.style.setProperty('--mc', T.color);
        kept.push(k);
      }
      if (kept.length) update(kept);
      cables.set(cablesNow());
      hl(); members();
      relay();
      if (vis && H.shown) H.shown(); // (main.js: monitors.sync — the Serum / FX live displays follow an undone fold)
    },
    /** (addition) titles, chips and the derived cables after an edit (no lay, no world update); (1e) power, zone, badge */
    refresh(track) {
      if (track) T = track;
      readDevs();
      DC.clear();
      for (const [k, m] of mods) { const M0 = kindOf(k) === 'part' ? partMeta(k, meta(k)) : meta(k); m.setTitle(M0.title || '', M0.sub); if (M0.chip !== undefined) m.setChip(M0.chip); decorate(k, m); }
      cables.set(cablesNow());
      hl(); members();
      relay();
    },
    ports,
    /** the module `key` is on screen (the world's plan, CULL_MARGIN early) and not folded: its live displays run */
    live(key) { const m = mods.get(key); return !!m && m.screen && !m.fold; },
    /** user actions from the module menus (each one undo step, except front) */
    toggleFold(key) { const m = mods.get(key); if (!m || m.nofold) return; m.setFold(!m.fold); DC.delete(key); lay(key, 'start', 'fold'); lay(key, 'end', 'fold'); relay(); update(key); if (H.shown) H.shown(key); },
    front,
    sizes,
    /** (1e) the host's devices as shown; the jacks [{id, el, dir, mod, label}]; module rects (world px); a jack's model port */
    devices: () => DL.map(d => Object.assign({}, d)),
    jacks() { // ((3) dir from the jack's spec: VOICE's main / direct / note are inputs; el: an inline jack's anchor once measured)
      const L = [];
      for (const [k, m] of mods) for (const j of m.jackIds()) { const el = m.jack(j); L.push({ id: k + '.' + j, el, dir: m.jackDir(j) || (j === 'in' ? 'in' : 'out'), mod: k, label: el.getAttribute('aria-label') || k + '.' + j, kind: el.getAttribute('data-kind') || 'audio' }); }
      return L;
    },
    /** (2a) a knob's end point (world px) — host.destPort first, else the [data-dest] centre (cached per module; a folded
     * module, or a knob not shown: its bar's left end); null without the module */
    destPort,
    /** (2a) drop the cached knob offsets of `key` (all without): a body re-rendered or switched page; the cables re-laid */
    remeasure(key) { if (key == null) DC.clear(); else DC.delete(key); for (const [k, m] of mods) if (key == null || k === key) m.relayout(); relay(); }, // ((3) inline jacks too)
    /** (2a) the mod cables' visibility ('always' | 'select' | 'never': the toolbar ∿) */
    setModsVisible: m => cables.setModsVisible(m),
    rects() { const o = {}; for (const [k, m] of mods) o[k] = m.rect(); return o; },
    port: j => jackPort(T, j),
    /** (milestone 3) a Serum's internal jack in parts view → itself when a cable edit may use it (sx-edges endOf gives its END;
     * not a warp input, not VOICE → own FX), else null — a cableDrag's port for lane D's resolver: port: j => V.port(j) ||
     * V.intPort(j) */
    intPort: j => { const i = typeof j === 'string' ? j.lastIndexOf('.') : -1, k = i > 0 ? j.slice(0, i) : ''; return k && mods.has(k) && intPatch(k, j.slice(i + 1)) ? j : null; },
    /** (3) the part modules of Serum `dev` → [key] */
    partsOf: dev => [...mods.keys()].filter(k => kindOf(k) === 'part' && partOf(k).dev === dev),
    /** (1e) cv-cables createCableDrag on this view (ports, jacks, rects, port, the cables) — o: canConnect, onConnect,
     * onRepatch, onDisconnect?, onRefuse?; destroyed with the view (or earlier by the caller) */
    cableDrag(o) {
      const D = createCableDrag(world, Object.assign({ ports, jacks: () => V.jacks(), rects: () => V.rects(), port: j => jackPort(T, j), cables, color: () => T.color, doc }, o || {}));
      drags.push(D);
      return D;
    },
    destroy() {
      for (const D of drags.splice(0)) D.destroy();
      if (selOff) selOff();
      if (zoomOff) zoomOff();
      for (const [k, m] of mods) { if (world && typeof world.remove === 'function') world.remove(k); m.destroy(); }
      mods.clear();
      cables.destroy();
    },
  };
  return V;
}
