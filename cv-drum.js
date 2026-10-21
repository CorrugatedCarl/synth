// cv-drum.js — the TR-808's panel widgets and their host (IMPL-7a §7.2–§7.5, §3.3, §3.6; lane P1). Plain ES module: no DOM
// at module top level (node imports it: tests); every runtime path survives tests/main-sim.mjs's DOM stub (keeps its own
// nodes, reads layout only at an event: a pointer's rect).
//
// drumHost(deps) — the page's drum machines (main.js wires it, §10.1; node-tested with fakes, as cv-keys.perfHost). It owns
// each track's session state (drum-core initState: never saved) and runs drum-core's pure press(state, drum, input) for the
// panel and for main, applying its commands through deps. Every member of deps is a function and optional unless marked:
//   mem(tr) → the track's dev.drum (normDrum'ed) | null  [required]   tr: the track a panel was built for — resolve it by id
//                                                                    (undo / load replace the track objects)
//   put(tr, D)               write the record back (persist; never a History step: §6, the 303's policy)  [required]
//   send(tr, D, S, at)       drumSend (§10.1): post drum-core payload(D, S, at) to the machine (dedupe by pk, ensure slots)
//   play(tr), stop(tr)       the project's ▶ / ■ (SYNC on: START/STOP is the transport, §13 answer 1)
//   playing() → bool, bpm() → number          the transport and the project tempo (a new entry's session)
//   setBpm(v, ph)            the project tempo from TEMPO / FINE while synced; ph 'move' inside a drag (one gesture = one
//                            tempo edit: the host coalesces), 'end' once at the gesture's end, undefined for one step
//   heard(ts?) → frame       the output frame heard at performance time ts (now without one): main.js outFrame; NaN /
//                            absent: posts show at once
//   rate() → Hz              the context's sample rate (TAP's fraction of a step)
//   barTicks() → ticks       a bar (→ Piano roll's "the pattern's length"); default 3840
//   noteOn(tr, n, v, ts), noteOff(tr, n, ts)  a pad: the track's note path (recording, held keys, the Velocity module)
//   sel(tr) → bool           the panel's track is the selected one (a stale panel's pads play nothing)
//   notice(text, ms, onTap)  a notice; onTap: its one-tap undo (PATTERN / TRACK CLEAR, DEMO)
//   toRoll(tr, bars)         → Piano roll (main: toNotes, the History step "Pattern to notes", SYNC off, its notice, §4.3)
//   confirm(text) → bool     DEMO over a key that is not empty
//   loadSample(tr, sound) → Promise<{ id, name } | null>  SOUNDS… Load… (the importer, the per-machine cap of §5)
//   learn(tr, fn) → off      MAP… learn: fn(n) with the next note played into the track
//   monitor(tr, on)          the track's drum monitor (postMon, §3.5) wanted (a mounted panel's pads light) or not
//   loop() → { loop, ls, le } the song loop (on, its start / end ticks): the extras' hint when a synced cycle is longer
//                            than the loop (main: loopInfo; and DRUM.loop() whenever the loop changes)
//   link303(tr, s)           (7b) SYNC 303s: every TB-303 of the project to SYNC, its run off, swing s (drum-core swing303)
//   n303() → { n, synced }   (7b) the project's TB-303s: how many, all on SYNC (the button's state; DRUM.link303() repaints)
//   raf(fn)                  (tests) the frame clock; default wk.frame
// The host: { api(tr) (a panel's api.drum), press(tr, input, ph), step(tr, dev, msg) (main's {t:'step'} handler for a drum
// post), mon(tr, msg) (a drum monitor post { lit, act, F }), transport(play), bpm(v), panic(), release(), changed(tr) (main
// wrote the record: undo, → Piano roll's SYNC; 7b: a record of the other machine starts a fresh session), loop() (the song
// loop changed: the hint), link303() (7b: a TB-303's SYNC or the project's 303s changed), forget(tr) }. Posts and monitor
// lights reach the panels at their HEARD time (§3.5: F against heard(), a frame's lead so the LEDs paint on time): queued per
// track, delivered by one frame loop.
//
// api.drum (P1 ↔ H1, §11): { state() → { D, S, run }, press(input, ph), end() (a TEMPO / FINE gesture ended), tap(ts) (TAP
// at the heard time: the fraction of the heard step), on(fn) → off (any change), step(fn) → off (a post at its heard time),
// lit(fn) → off (fn(mask16, act) at the heard time), pads: { on(sound, v, ts), off(sound, ts) }, hold(release) → off (the
// host's release-all), bars(), toRoll(bars), demo(), sample(sound) → Promise, learn(sound) → off | null, sel(), loop(),
// (7b) link() (SYNC 303s), n303() }. The session follows the record's machine (initState(D.m); review #16).
//
// drumPanel(DR, ctx) — the dr: widgets of one rendered panel (cv-panel render passes ctx: its doc, the hw api, the root and
// its drawing helpers). DR = api.drum, or null (a stub host, tests): the same nodes with no listeners and aria-disabled. All
// widgets repaint together at most once per animation frame (state(), drum-core leds()), never while the module is off
// screen ([data-cv-off]); flashing LEDs are a CSS animation (paused off screen by cv-module's rule). → { widget(c, o),
// show(c, o), extra(cell), start(), release(), destroy() }.
//
// 7b (IMPL-7b §7.4; lane P1): the TR-606. Per-machine tables (UI.tr808 = 7a's LANE_CODE / PAD_ORDER / GRID / DIAL, UI.tr606:
// its eight INSTRUMENT rows on the 808's lane bits, the 2 × 4 pads with the AC hold, the 8-row grid, MODE / INSTRUMENT /
// SCALE); the panel picks by ctx.model (cv-panel passes it: before a record exists, and a record of the other machine shows
// the defaults until main re-renders), the host by the record's m. The 606's widgets: FUNCTION and CLEAR/RESET held states
// and the step keys down / up (two keys held in a block: a chain; Shift + a key chains with the mouse; Alt + keys = FUNCTION
// held while Alt is), RUN/STOP, PATTERN GROUP and TAP at the press, the RUN and group LEDs, TEMPO continuous (tempo606), SYNC
// 303s. A cancelled hold (two-finger cancel, lost capture, blur, the host's release-all, destroy) sends { k: 'release' }:
// every hold let go, nothing done. Host deps added: link303(tr, s) (SYNC 303s: every TB-303 to SYNC, s its swing), n303()
// → { n, synced }; host method link303() (a 303 changed elsewhere: the panels repaint); api.drum gains link(), n303().
//
// 7c (IMPL-7c §7.4; lane P1): the TR-909. UI.tr909 (its twelve INSTRUMENT rows AC … RD on the 808's lane bits, drum-core
// LANES909; the 4 × 3 pads CR RD OH CH / LT MT HT AC / BD SD RS HC with the AC hold; the 808's grid geometry; no dials); every
// machine test three-way (machOf, the host's session, the panel's tables — a 909 never falls into the 808's grid, pads, texts
// or cancel rule); the sounds' keys / names by PERS[machine] (its ids 7 / 8 the ride / crash). Its widgets: the held keys
// (SHIFT, INSTRUMENT SELECT, CLEAR, LAST STEP, SHUFFLE/FLAM, the TEMPO key, AVAILABLE MEAS) and the step keys down / up in
// music zones (two keys: a pair, a block, a chain; Shift + a key the mouse's; Alt + a key = SHIFT + key, held while Alt is),
// the taps (START, STOP/CONT, SCALE, TRACK n, PATTERN n, BACK, FWD, CYCLE/GUIDE, ENTER: A.tap — a pinch starting there zooms),
// TEMPO continuous (tempo909), the 3-digit display and the LEDs (LIT 'dim': a normal step) painted together; a cancelled hold
// sends { k: 'release' } as the 606's. The host: a 909 key's press carries its time (`ts`) — in TAP write the host adds `f`,
// the fraction of the heard step — and its { c: 'hit', sound, v } / { c: 'hit', sound, off } plays through the pads' note path
// (the sel() gate, no REC write: the press wrote it; a note the session drops — release, panic, a fresh session — ends);
// bpm(v) presses { k: 'bpm', v } for a 909 (review #1: its flams' ticks follow the project tempo — drum-core sends 'now' when
// they move), and so does a synced 909's own TEMPO (its { c: 'bpm' } command).
import * as DC from './drum-core.js?v=9';
import * as wk from './wk.js?v=9';
import { KEY_VEL, noteName } from './cv-keys.js?v=9';

const fin = x => typeof x === 'number' && isFinite(x);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const call = (f, ...a) => { if (typeof f !== 'function') return undefined; try { return f(...a); } catch (err) { console.error(err); return undefined; } };
const r3 = v => Math.round(v * 1000) / 1000;

/* ---------------------------------------------------------------- names and geometry */
/** The lanes' panel codes (the INSTRUMENT / TRACK selector's order) and the switch's other sound; the lanes' names. */
export const LANE_CODE = Object.freeze(['AC', 'BD', 'SD', 'LT', 'MT', 'HT', 'RS', 'CP', 'CB', 'CY', 'OH', 'CH']);
export const LANE_ALT = Object.freeze([null, null, null, 'LC', 'MC', 'HC', 'CL', 'MA', null, null, null, null]);
const LANE_NAME = ['Accent', 'Bass drum', 'Snare drum', 'Low tom · low conga', 'Mid tom · mid conga', 'Hi tom · hi conga', 'Rim shot · claves',
  'Hand clap · maracas', 'Cowbell', 'Cymbal', 'Open hihat', 'Closed hihat'];
const SOUND_CODE = ['BD', 'SD', 'LT', 'MT', 'HT', 'RS', 'CP', 'CB', 'CY', 'OH', 'CH', 'LC', 'MC', 'HC', 'CL', 'MA'];
/** The pads, 4 × 4 from the top row: the kick bottom-left (the drummer's corner), the congas and claves on top. */
export const PAD_ORDER = Object.freeze(['lc', 'mc', 'hc', 'cl', 'rs', 'cb', 'cy', 'ma', 'lt', 'mt', 'ht', 'oh', 'bd', 'sd', 'cp', 'ch']);
/** The extras' step grid (world px = cv-panel DR_GRID): a header column (lane codes: tap mutes, a long press solos) and row
 * (step numbers; the corner: the 1st / 2nd part switch), 16 × 12 cells. The pads (= DR_PADS): 4 × 4 of PAD + GAP. */
export const GRID = Object.freeze({ w: 640, h: 272, head: 64, top: 32, col: 36, row: 20 });
export const PADS = Object.freeze({ w: 232, h: 232, pad: 52, gap: 8 });
/** A long press on a lane's header (ms): solo instead of mute. A tap's slop (px): a finger's, the mouse's. */
export const SOLO_MS = 500, SLOP = { touch: 10, mouse: 4 };
/** drum-core leds() step codes → a step key's data-lit (§7.4: off / on / flash / the inverted playhead lit or dark; 7c: 5 dim, a
 * normal step — style.css's .hw-btn[data-lit="dim"], steady with reduced motion). */
export const LIT = Object.freeze(['off', 'on', 'flash', 'head-on', 'head-off', 'dim']);
/** A pad's velocity from where it is touched (the 1i curve: cv-keys KEY_VEL, main.js velAt): f = 0 the back edge … 1 the front. */
export const padVel = f => Math.min(1, KEY_VEL.lo + KEY_VEL.span * clamp(fin(f) ? f : 1, 0, 1));
/** A keyboard press of a pad: an unaccented step's velocity (100 / 127, §1.3). */
export const KEY_PAD_V = 100 / 127;
/** What a point of the grid (layout px from its top-left) addresses: a cell { lane, s } (s 0–15 of the shown part), a
 * lane's header { head, lane }, the step row { top, s }, the corner { corner }; null outside. */
export function gridAt(x, y) {
  if (!(x >= 0 && y >= 0 && x < GRID.w && y < GRID.h)) return null;
  if (y < GRID.top) return x < GRID.head ? { corner: true } : { top: true, s: Math.min(15, Math.floor((x - GRID.head) / GRID.col)) };
  const lane = Math.min(11, Math.floor((y - GRID.top) / GRID.row));
  return x < GRID.head ? { head: true, lane } : { lane, s: Math.min(15, Math.floor((x - GRID.head) / GRID.col)) };
}
/** The part the grid shows: the write modes' own part, else the extras' part switch (x.part) — when the key has a 2nd part. */
export function gridPart(D, p) {
  const K = D.keys[p >> 1], m = D.ui.mode;
  if (!(K && K.l2 > 0)) return 0;
  return m === DC.M_W1 ? 0 : m === DC.M_W2 ? 1 : D.x.part ? 1 : 0;
}
// the detented sequencer controls (§3.2): the press key, the positions, the position of a record, the value a position
// writes, the value text
const MODE_TXT = ['Pattern clear', 'Pattern write · 1st part', 'Pattern write · 2nd part', 'Manual play', 'Play (rhythm track)', 'Compose (rhythm track)'];
const FILL_TXT = ['Manual', 'Every 16 measures', 'Every 12', 'Every 8', 'Every 4', 'Every 2'];
const PRE_TXT = ['1 · eighth-note triplets', '2 · sixteenth-note triplets', '3 · sixteenths', '4 · thirty-seconds'];
export const DIAL = Object.freeze({
  'dr:mode': { k: 'mode', n: 6, label: 'Mode', pos: D => D.ui.mode, val: i => i, text: i => MODE_TXT[i], def: DC.M_MAN },
  'dr:inst': { k: 'inst', n: 12, label: 'Instrument / track', pos: D => D.ui.inst, val: i => i, text: (i, D) => (D.ui.mode >= DC.M_PLAY ? 'Track ' + (i + 1) : LANE_NAME[i]), def: 1 },
  'dr:fill': { k: 'fill', n: 6, label: 'Auto fill in', pos: D => D.ui.fill, val: i => i, text: i => FILL_TXT[i], def: 0 },
  'dr:bvar': { k: 'bvar', n: 3, label: 'Basic variation', pos: D => D.ui.bvar, val: i => i, text: i => ['A', 'A then B', 'B'][i], def: 0 },
  'dr:ifv': { k: 'ifv', n: 2, label: 'Intro / fill variation', pos: D => D.ui.ifv, val: i => i, text: i => ['A', 'B'][i], def: 0 },
  'dr:pre': { k: 'pre', n: 4, label: 'Pre-scale', pos: D => D.ui.pre - 1, val: i => i + 1, text: i => PRE_TXT[i], def: 2 },
});
/* ---- (7b) the TR-606's tables: the pads 2 × 4 from the top row (the kick bottom-left; AC a hold: every hit at 127 while it
   is held), the grid (= cv-panel DR6_GRID: a 48 px header + 16 × 34, a 32 px top + 8 × 20 — its 8 rows AC … CH on the 808's
   lane bits), the pads' cell (= DR6_PADS), the dials (SCALE a vertical switch: its first position, the top, is SCALE 4) */
export const PAD6 = Object.freeze(['cy', 'oh', 'ch', 'ac', 'bd', 'sd', 'lt', 'ht']);
export const GRID6 = Object.freeze({ w: 592, h: 192, head: 48, top: 32, col: 34, row: 20 });
export const PADS6 = Object.freeze({ w: 232, h: 116, pad: 52, ph: 50, gap: 8, top: 8 }); // ((7b review 2 #4) 8 + 2 × 50 + 8: clear of the grid above)
const MODE6_TXT = ['Track write', 'Track play', 'Pattern play', 'Pattern write'];
const SC6_TXT = ['', '1 · sixteenths', '2 · thirty-seconds', '3 · eighth-note triplets', '4 · sixteenth-note triplets'];
export const DIAL6 = Object.freeze({
  'dr:mode': { k: 'mode', n: 4, label: 'Mode', pos: D => D.ui.mode, val: i => i, text: i => MODE6_TXT[i], def: DC.M6_PP },
  'dr:inst': { k: 'inst', n: 8, label: 'Track / instrument', pos: D => D.ui.inst, val: i => i, text: (i, D) => (D.ui.mode < DC.M6_PP ? 'Track ' + (i + 1) : DC.ROWS606[i]), def: 1 },
  'dr:sc': { k: 'sc', n: 4, label: 'Scale', pos: D => 4 - D.ui.sc, val: i => 4 - i, text: i => SC6_TXT[4 - i], def: 3 },
});
/* ---- (7c) the TR-909's tables: the pads 4 × 3 from the top row (CR RD OH CH / LT MT HT AC / BD SD RS HC: the kick bottom-left,
   §3.7; AC a hold), the pads' cell (= cv-panel DR9_PADS: 4 × 52 + 3 gaps of 8; 8 + 3 × 52 + 2 × 8), the pads' codes by sound id
   (its ids 7 / 8 the ride / crash; 11–15 inert), the step keys' voices (the instrument boxes under them: the left key of a pair
   the accented one; 13 + 14 the open hat) */
export const PAD9 = Object.freeze(['cr', 'rd', 'oh', 'ch', 'lt', 'mt', 'ht', 'ac', 'bd', 'sd', 'rs', 'cp']);
export const PADS9 = Object.freeze({ w: 232, h: 184, pad: 52, ph: 52, gap: 8, top: 8 });
const SOUND_CODE9 = Object.freeze(['BD', 'SD', 'LT', 'MT', 'HT', 'RS', 'HC', 'RD', 'CR', 'OH', 'CH', '', '', '', '', '']);
const KEY9 = ['Kick, accent', 'Kick', 'Snare, accent', 'Snare', 'Low tom, accent', 'Low tom', 'Mid tom, accent', 'Mid tom', 'Hi tom, accent', 'Hi tom',
  'Rim shot', 'Hand clap', 'Closed hat, accent', 'Closed hat', 'Crash', 'Ride'];
/** Each machine's panel tables (§7.4): the grid's rows (codes, the switch's other sound, the lane bit of each row), the pads,
 * the grid / pads geometry, the detented controls, the name the texts use; (7c) the pads' codes by sound id. */
export const UI = Object.freeze({
  tr808: Object.freeze({ codes: LANE_CODE, alt: LANE_ALT, lanes: Object.freeze(LANE_CODE.map((x, l) => l)), pads: PAD_ORDER, grid: GRID, padG: PADS, dial: DIAL, name: '808' }),
  tr606: Object.freeze({ codes: DC.CODES606, alt: null, lanes: DC.LANES606, pads: PAD6, grid: GRID6, padG: PADS6, dial: DIAL6, name: '606' }),
  tr909: Object.freeze({ codes: DC.CODES909, alt: null, lanes: DC.LANES909, pads: PAD9, grid: GRID, padG: PADS9, dial: Object.freeze({}), scode: SOUND_CODE9, name: '909' }),
});
/** A machine id from a model id or a record (absent / unknown: the 808; 7c: three-way, 'tr606' / 'tr909' the exact strings). */
export const machOf = x => { const m = typeof x === 'string' ? x : !!x && typeof x === 'object' ? x.m : null; return m === 'tr606' || m === 'tr909' ? m : 'tr808'; };
/** (7c) The 909's grid (the 808's geometry, its 12 rows AC … RD on their lane bits): a cell { lane, row, s }, a header { head,
 * lane, row }, the step row { top, s }, the corner { corner }; null outside. */
export function gridAt909(x, y) {
  const G = GRID;
  if (!(x >= 0 && y >= 0 && x < G.w && y < G.h)) return null;
  if (y < G.top) return x < G.head ? { corner: true } : { top: true, s: Math.min(15, Math.floor((x - G.head) / G.col)) };
  const row = Math.min(11, Math.floor((y - G.top) / G.row)), lane = DC.LANES909[row];
  return x < G.head ? { head: true, lane, row } : { lane, row, s: Math.min(15, Math.floor((x - G.head) / G.col)) };
}
/** (7b) The 606's grid: a cell { lane, row, s } (lane: the row's 808 lane bit), a header { head, lane, row }, the step row
 * { top, s }, the corner { corner }; null outside. */
export function gridAt606(x, y) {
  const G = GRID6;
  if (!(x >= 0 && y >= 0 && x < G.w && y < G.h)) return null;
  if (y < G.top) return x < G.head ? { corner: true } : { top: true, s: Math.min(15, Math.floor((x - G.head) / G.col)) };
  const row = Math.min(7, Math.floor((y - G.top) / G.row)), lane = DC.LANES606[row];
  return x < G.head ? { head: true, lane, row } : { lane, row, s: Math.min(15, Math.floor((x - G.head) / G.col)) };
}
/** The extras' one-line hint (7a review 2 #4, the lead's decision: §3.5's song-position semantics stay): SYNC on, the song
 * loop on and shorter than the machine's cycle (the plan's measures after the intro: AB, the auto fills, a rhythm track) —
 * what falls outside the loop never plays; null otherwise. L: { loop, ls, le } (main's loopInfo). Memoised on D (immutable). */
let hintC = null;
export function loopHint(D, L) {
  if (!D || !D.x || !D.x.sync || !L || !L.loop || !(L.le > L.ls)) return null;
  if (hintC && hintC.D === D && hintC.len === L.le - L.ls) return hintC.r;
  const p = DC.compilePlan(D, D.ui, D.x), len = L.le - L.ls;
  let r = null;
  if (p && p.n - p.loopFrom >= 2 && p.mT[p.n] - p.mT[p.loopFrom] > len) {
    const m = machOf(D);
    r = m === 'tr606' ? (D.ui.mode < DC.M6_PP ? 'Loop is shorter than the track — its end falls outside it' : 'Loop is shorter than the chain — its end falls outside it') // (7b)
      : m === 'tr909' ? (D.ui.mode >= DC.M9_TP ? 'Loop is shorter than the track — its end falls outside it' : 'Loop is shorter than the patterns played — the later ones fall outside it') // (7c)
      : D.ui.mode === DC.M_PLAY ? 'Loop is shorter than the rhythm track — its end falls outside it'
      : D.ui.fill > 0 ? 'Loop is shorter than the fill cycle — fills fall outside it' : 'Loop is shorter than the A / B cycle — B falls outside it';
  }
  hintC = { D, len, r };
  return r;
}
/** The panel's counters (tests, the review's CDP check): paints (LED / widget updates, ≤ 1 a frame per panel), grid repaints. */
export const drumStats = { paints: 0, grid: 0 };

/* ---------------------------------------------------------------- the host (§7.4, §10.1) */
const LEAD_S = 1 / 60;   // a post is shown one frame ahead of its heard time: the panel paints on the next frame
const QMAX = 64;         // posts held per track (≤ 40 a second: a stalled page drops the oldest)
export function drumHost(deps) {
  deps = deps || {};
  const E = new Map(), holds = new Set();
  const raf = typeof deps.raf === 'function' ? deps.raf : wk.frame;
  const idOf = tr => (tr && typeof tr === 'object' && tr.id != null ? tr.id : tr);
  const mem = tr => { const D = call(deps.mem, tr); return D && Array.isArray(D.keys) && D.ui && D.x ? D : null; };
  const heardAt = ts => { const F = call(deps.heard, ts); return typeof F === 'number' ? F : NaN; };
  const rate = () => { const r = +call(deps.rate); return r > 0 ? r : 48000; };
  const each = (S, ...a) => { for (const f of [...S]) { try { f(...a); } catch (err) { console.error(err); } } };
  // a fresh session of the record's machine (7b: initState(D.m); the transport and the project tempo as now)
  const fresh = tr => { const b = +call(deps.bpm), D = mem(tr); return Object.assign(DC.initState(D ? machOf(D) : undefined), { play: !!call(deps.playing), bpm: b > 0 ? b : 120 }); };
  const sessOf = S => (S && S.m === 'tr909' ? 'tr909' : Array.isArray(S.held) ? 'tr606' : 'tr808'); // (a 606 session holds its keys; 7c: a 909's names itself)
  function entry(tr) {
    const k = idOf(tr);
    let e = E.get(k);
    if (!e) {
      e = { tr, S: fresh(tr), q: [], mq: [], last: null, bpmT: null, on: new Set(), steps: new Set(), lits: new Set(), held: new Map(), kh: new Map() };
      E.set(k, e);
    }
    if (tr && typeof tr === 'object') e.tr = tr;
    return e;
  }
  const notify = e => each(e.on);
  // (7c §7.4) a TAP-write step key's { c: 'hit' }: its sound's primary note into the track — the pads' note path (the sel()
  // gate; no REC write: the press wrote it), e.kh (sound key → note) for the off its key's up sends
  function hit(e, D, c, ts) {
    const s = DC.PERS[machOf(D)].sounds[c.sound];
    if (typeof s !== 'string') return;
    if (c.off) { const n = e.kh.get(s); if (n != null) { e.kh.delete(s); call(deps.noteOff, e.tr, n, ts); } return; }
    if (deps.sel && !call(deps.sel, e.tr)) return;
    const n = (D.map[s] || [])[0];
    if (!(Number.isInteger(n) && n >= 0 && n <= 127)) return;
    e.kh.set(s, n);
    call(deps.noteOn, e.tr, n, clamp(fin(c.v) ? c.v / 127 : KEY_PAD_V, 0, 1), ts);
  }
  // (7c) a key's note the session no longer sounds (a cancelled hold's release, a panic, a fresh session): its off
  function khSync(e, ts) {
    const S = e.S, K = S && S.m === 'tr909' && Array.isArray(S.hits) ? DC.PERS.tr909.sounds : null;
    for (const [s, n] of [...e.kh]) if (!K || !S.hits.some(h => K[h[1]] === s)) { e.kh.delete(s); call(deps.noteOff, e.tr, n, ts); }
  }
  // a press's result applied to its entry: the session, the record written back, its commands — the panel's presses and the
  // host's own alike (7b reviews 1 #1 / #2: 'transport' ends a 606's D.S. / heard key at ■, ▶ and a seek, a 'heard' post
  // wipes CLEAR's steps: their sends reach the machine). (7c) ts: the press's time (a TAP-write key's note)
  function exec(e, D, r, ph, ts) {
    e.S = r.state;
    if (r.mem !== D) call(deps.put, e.tr, r.mem);
    for (const c of r.cmds) {
      if (c.c === 'send') call(deps.send, e.tr, r.mem, e.S, c.at);
      else if (c.c === 'play') call(deps.play, e.tr);
      else if (c.c === 'stop') call(deps.stop, e.tr);
      else if (c.c === 'bpm') {
        if (machOf(r.mem) === 'tr909') { // ((7c review #1) the session's tempo through drum-core: a synced plan whose flams move is sent now)
          const q = DC.press(e.S, r.mem, { k: 'bpm', v: c.v });
          e.S = q.state;
          for (const k of q.cmds) if (k.c === 'send') call(deps.send, e.tr, r.mem, e.S, k.at);
        } else e.S = Object.assign({}, e.S, { bpm: c.v });
        e.bpmT = ph === 'move' ? c.v : null; call(deps.setBpm, c.v, ph);
      }
      else if (c.c === 'notice') call(deps.notice, c.text, c.undo ? 8000 : 4000, c.undo ? () => press(e.tr, { k: 'undo' }) : null);
      else if (c.c === 'link303') call(deps.link303, e.tr, c.s); // (7b SYNC 303s: the host switches them, its notice undoes it)
      else if (c.c === 'hit') hit(e, r.mem, c, ts); // (7c: a TAP-write key)
    }
    if (e.kh.size) khSync(e, ts);
  }
  function press(tr, input, ph) {
    const e = entry(tr);
    let D = mem(e.tr);
    if (!D) return null;
    // (7c) a 909 key down in TAP write: f, the fraction of the heard step at its time (the posts heard by then delivered first)
    if (input && input.k === 'key' && input.down === true && machOf(D) === 'tr909' && D.ui.mode === DC.M9_PW && D.ui.wm === 1) {
      input = Object.assign({}, input, { f: frac(e, D, input.ts) });
      D = mem(e.tr);
      if (!D) return null;
    }
    // (7c review 1 F4) a free 909's STOP: the steps it already played are heard (the output's latency) — their posts delivered
    // first, so STOP/CONT continues after the last step played (the 808's / 606's queue is dropped as before)
    if (input && (input.k === 'start' || (input.k === 'tap' && input.b === 'stop')) && machOf(D) === 'tr909' && !D.x.sync && DC.running(e.S, D)) {
      deliver(e, NaN);
      D = mem(e.tr);
      if (!D) return null;
    }
    let r = null;
    try { r = DC.press(e.S, D, input); } catch (err) { console.error(err); return null; }
    exec(e, D, r, ph, input && input.ts);
    if (!DC.running(e.S, r.mem)) { e.q.length = 0; e.mq.length = 0; } // (a stopped machine: nothing left to show)
    notify(e);
    return r;
  }
  // a post at its heard time: the session's position, COMPOSE's recording (§3.3), (7b) the 606's wipe
  function heardPost(e, P) {
    const D = mem(e.tr);
    e.last = P;
    if (!D) return;
    exec(e, D, DC.press(e.S, D, { k: 'heard', post: P }));
  }
  // deliver what is heard by frame `upto` (NaN: everything): posts in order, the last one to the step listeners (≤ 1 a
  // frame), the monitor's lights OR'd
  function deliver(e, upto) {
    let P = null, lit = 0, act = null;
    while (e.q.length && !(e.q[0].F > upto)) { P = e.q.shift(); heardPost(e, P); }
    while (e.mq.length && !(e.mq[0].F > upto)) { const m = e.mq.shift(); lit |= m.lit; if (m.act) act = m.act; }
    if (P) { each(e.steps, P); notify(e); }
    if (lit || act) each(e.lits, lit, act);
  }
  let due = false;
  function later() { if (!due) { due = true; raf(pump); } }
  function pump() {
    due = false;
    const F = heardAt(), upto = F + rate() * LEAD_S;
    let more = false;
    for (const e of E.values()) { deliver(e, upto); if (e.q.length || e.mq.length) more = true; }
    if (more) later();
  }
  // TAP / REC: the fraction of the heard step elapsed at ts (the posts heard by then delivered first; §3.3: nearest step)
  function frac(e, D, ts) {
    const F = heardAt(ts);
    deliver(e, F);
    const P = e.last;
    if (!P || !fin(P.F) || !fin(F)) return undefined;
    const bpm = D.x.sync ? e.S.bpm : DC.freeBpm(D), fpt = rate() * 60 / (bpm * DC.PPQ), L = DC.stepLen(D, P);
    return fpt > 0 && L > 0 ? Math.max(0, (F - P.F) / fpt / L) : undefined;
  }
  const H = {
    press,
    step(tr, dev, msg) { if (!msg || typeof msg !== 'object') return; const e = entry(tr); if (e.q.length >= QMAX) e.q.shift(); e.q.push(msg); later(); },
    mon(tr, msg) {
      if (!msg || typeof msg !== 'object') return;
      const e = entry(tr);
      if (!e.lits.size) return;
      if (e.mq.length >= QMAX) e.mq.shift();
      e.mq.push({ F: msg.F, lit: msg.lit | 0, act: msg.act || null });
      later();
    },
    transport(play) { // ▶ / ■, and (7b review 1 #1) main's seek while playing: transport(true) again
      for (const e of E.values()) {
        const D = mem(e.tr);
        if (D) exec(e, D, DC.press(e.S, D, { k: 'transport', play: !!play })); else e.S = Object.assign({}, e.S, { play: !!play });
        if (!play) { e.q.length = 0; e.mq.length = 0; }
        notify(e);
      }
    },
    bpm(v) { // the project tempo: the sessions' (7c review #1: a 909's through drum-core — a synced plan whose flams move is sent now)
      if (!(v > 0)) return;
      for (const e of E.values()) {
        const D = mem(e.tr);
        if (D && machOf(D) === 'tr909') exec(e, D, DC.press(e.S, D, { k: 'bpm', v: +v })); else e.S = Object.assign({}, e.S, { bpm: +v });
        notify(e);
      }
    },
    panic() {
      for (const e of E.values()) { const D = mem(e.tr); if (D) exec(e, D, DC.press(e.S, D, { k: 'panic' })); e.q.length = 0; e.mq.length = 0; notify(e); }
      H.release();
    },
    release() { each(holds); },
    changed(tr) {
      const e = E.get(idOf(tr));
      if (!e) return;
      if (tr && typeof tr === 'object') e.tr = tr;
      const D = mem(e.tr); // (7b review #16: an 808 ↔ 606 Replace undone / redone under the same view — the other machine's record)
      if (D && machOf(D) !== sessOf(e.S)) { e.S = fresh(e.tr); e.q.length = 0; e.mq.length = 0; e.last = null; e.bpmT = null; if (e.kh.size) khSync(e); }
      notify(e);
    },
    loop() { for (const e of E.values()) notify(e); }, // (the song loop changed: the panels' hint)
    link303() { for (const e of E.values()) notify(e); }, // (7b: a TB-303's SYNC, the project's 303s: SYNC 303s repaints)
    forget(tr) { const e = E.get(idOf(tr)); if (e && e.kh.size) { e.S = null; khSync(e); } E.delete(idOf(tr)); }, // ((7c) a key's note ends)
    api(tr) {
      const e = entry(tr), sel = () => !deps.sel || !!call(deps.sel, e.tr);
      const sub = (S, f) => { if (typeof f !== 'function') return () => {}; S.add(f); return () => S.delete(f); };
      return {
        state() { const D = mem(e.tr); return { D, S: e.S, run: D ? DC.running(e.S, D) : false }; },
        press: (input, ph) => press(e.tr, input, ph),
        end() { if (e.bpmT != null) { const v = e.bpmT; e.bpmT = null; call(deps.setBpm, v, 'end'); } },
        tap(ts) { const D = mem(e.tr); if (D) press(e.tr, { k: 'tap', f: frac(e, D, ts), F: heardAt(ts) }); }, // ((7b review 2 #3) F: the press's heard frame, STEP RESET's rstF)
        on: f => sub(e.on, f), step: f => sub(e.steps, f),
        lit(f) {
          if (typeof f !== 'function') return () => {};
          e.lits.add(f);
          if (e.lits.size === 1) call(deps.monitor, e.tr, true);
          return () => { if (e.lits.delete(f) && !e.lits.size) { e.mq.length = 0; call(deps.monitor, e.tr, false); } };
        },
        pads: {
          on(s, v, ts) { // a pad: its sound's primary note (§4.1) into the track; REC writes its lane at the nearest step
            const D = mem(e.tr), i = D ? DC.PERS[machOf(D)].sounds.indexOf(s) : -1; // ((7c) the machine's sound keys: the 909's rd / cr)
            if (!D || i < 0 || !sel()) return false;
            const n = (D.map[s] || [])[0];
            if (!(Number.isInteger(n) && n >= 0 && n <= 127)) return false;
            const vv = clamp(fin(v) ? v : 1, 0, 1);
            e.held.set(s, n);
            call(deps.noteOn, e.tr, n, vv, ts);
            if (D.x.rec) press(e.tr, { k: 'pad', sound: i, f: frac(e, D, ts), v: vv }); // ((7b review 1 #5) v 1: the 606 writes its accent too)
            return true;
          },
          off(s, ts) { const n = e.held.get(s); if (n == null) return; e.held.delete(s); call(deps.noteOff, e.tr, n, ts); },
        },
        hold: rel => sub(holds, rel),
        bars() { // the plan's length in bars (→ Piano roll's last choice: rollPlan's, with the session — 7c review 1 F2)
          const D = mem(e.tr);
          if (!D) return 1;
          const t = DC.planTicks(DC.rollPlan(D, 120, e.S)).total, bt = +call(deps.barTicks) > 0 ? +deps.barTicks() : 3840;
          return Math.max(1, Math.ceil(t / bt));
        },
        toRoll: bars => call(deps.toRoll, e.tr, bars),
        demo() {
          const D = mem(e.tr);
          if (!D) return;
          const q = machOf(D) === 'tr606' ? 'patterns I-1 and I-2' : machOf(D) === 'tr909' ? 'patterns I-1-1 and I-1-2' : 'pattern 1 A / B and fill 1';
          if (!DC.demoFree(D) && deps.confirm && !call(deps.confirm, `Load the demo into ${q}? It replaces what is there (the notice can undo it).`)) return;
          press(e.tr, { k: 'demo' });
        },
        sample(s) {
          if (typeof deps.loadSample !== 'function') return Promise.resolve(null);
          return Promise.resolve(call(deps.loadSample, e.tr, s)).then(r => {
            if (r && typeof r.id === 'string') press(e.tr, { k: 'smp', sound: s, slot: { id: r.id, name: String(r.name || ''), on: true } });
            return r || null;
          }, err => { console.error(err); return null; });
        },
        learn(s) {
          if (typeof deps.learn !== 'function') return null;
          return call(deps.learn, e.tr, n => { const D = mem(e.tr); if (D) press(e.tr, { k: 'map', sound: s, notes: [n, ...(D.map[s] || []).filter(x => x !== n)] }); }) || (() => {});
        },
        canLoad: typeof deps.loadSample === 'function', canLearn: typeof deps.learn === 'function',
        sel, loop: () => call(deps.loop) || null,
        link: () => press(e.tr, { k: 'link303' }), // (7b SYNC 303s)
        n303() { const r = call(deps.n303); return r && typeof r === 'object' ? { n: Math.max(0, r.n | 0), synced: !!r.synced } : { n: 0, synced: true }; },
      };
    },
  };
  return H;
}

/* ---------------------------------------------------------------- the panel's widgets (§7.4, §7.5) */
export function drumPanel(DR, ctx) {
  const { doc, api: A, mk } = ctx, live = !!DR;
  ensureCSS(doc);
  const upds = [], offs = [], rels = [];
  let dead = false, due = false, recheck = null, clearHeld = false, clearUsed = false, demoB = null;
  // (7b) the machine this panel draws (ctx.model: cv-panel's model id; absent: the 808) and its tables; (7c) the 909's, and the
  // machine's sound keys / names / pad codes by sound id (the 808's and the 606's: DC.SOUNDS / SOUND_NAMES, as before)
  const M = machOf(ctx.model), U = UI[M], six = M === 'tr606', nine = M === 'tr909', SIDS = M === 'tr808' ? DC.SOUNDS.map((x, i) => i) : DC.PERS[M].sids;
  const SND = DC.PERS[M].sounds, NAMES = DC.PERS[M].names, SCODE = U.scode || SOUND_CODE, PN9 = p => (p < 48 ? 'I' : 'II') + '-' + (((p % 48) >> 4) + 1) + '-' + ((p & 15) + 1);
  const hint = mk('div', 'dr-hint'); // (7a review 2 #4) SYNC on and a loop shorter than the cycle: one line after DEMO
  hint.hidden = true; hint.setAttribute('role', 'note');
  if (six) hint.setAttribute('data-m', M);
  const FB = { D: DC.normDrum(undefined, M), S: DC.initState(M), run: false }; // (no host: the defaults; 7b: the panel's machine's)
  // (a record of the other machine — an 808 ↔ 606 Replace undone before main re-renders the view — shows the defaults)
  const st = () => { if (!DR) return FB; const s = DR.state(); return s && s.D && machOf(s.D) === M ? s : FB; };
  const setA = (el, k, v) => { if (v == null) { if (el.hasAttribute(k)) el.removeAttribute(k); } else if (el.getAttribute(k) !== String(v)) el.setAttribute(k, String(v)); };
  const off = () => { for (let n = ctx.root; n && n.nodeType === 1; n = n.parentNode) if (n.hasAttribute && n.hasAttribute('data-cv-off')) return true; return false; };
  // off screen or not mounted yet: looked at again (4 a second) until the module shows
  const retry = () => { if (recheck || dead) return; recheck = setTimeout(() => { recheck = null; dirty(); }, 250); if (recheck && typeof recheck.unref === 'function') recheck.unref(); };
  function paint() {
    if (dead) return;
    if (off()) { retry(); return; } // (off screen: nothing written)
    drumStats.paints++;
    const s = st(), led = DC.leds(s.S, s.D);
    for (const u of upds) u(s, led);
  }
  function dirty() { if (dead || due) return; due = true; wk.frame(() => { due = false; paint(); }); }
  const disable = el => { el.setAttribute('aria-disabled', 'true'); el.tabIndex = -1; };
  const btn = (cls, label, c) => {
    const b = mk('button', 'hw-btn ' + cls);
    b.type = 'button'; b.setAttribute('aria-label', label); b.setAttribute('data-led', (c && c.led) || 'none');
    if (c) ctx.prop(b, '--btn-c', ctx.named(c.color));
    b.append(mk('span', 'hw-led'));
    if (c && c.onCap) { const t = mk('span', 'hw-cap'); t.textContent = String(c.onCap); b.append(t); }
    return b;
  };
  const isKey = e => e.key === 'Enter' || e.key === ' ';
  /* ---- the face (§7.2) */
  function stepKey(c) { // a step key: its LED (leds().step); a tap → step n; CLEAR held (or Shift) → CLEAR + n
    const n = c.n, b = btn('dr-key', 'Step ' + n + (n > DC.N_BASIC ? ' · intro / fill ' + (n - DC.N_BASIC) : ''), Object.assign({}, c, { led: c.led || 'cap' }));
    b.setAttribute('data-n', String(n)); b.setAttribute('data-gesture', 'music'); b.setAttribute('aria-keyshortcuts', 'Shift+Enter');
    if (!live) disable(b);
    else {
      // CLEAR is read at the key's PRESS (the hardware acts there; review 2 #2): a finger's tap runs at its release, by when
      // CLEAR's finger may have lifted — so the press latches it (capture: before the tap's own pointerdown)
      let latch = null;
      b.addEventListener('pointerdown', e => { latch = { id: e.pointerId, cl: clearHeld }; if (clearHeld) clearUsed = true; }, true);
      b.addEventListener('pointercancel', e => { if (latch && latch.id === e.pointerId) latch = null; }, true);
      A.tap(b, e => {
        const L = latch && e && /^pointer/.test(e.type) && e.pointerId === latch.id ? latch : null;
        latch = null;
        const cl = (L ? L.cl : clearHeld) || !!(e && e.shiftKey);
        if (!L && clearHeld) clearUsed = true; // (a latched press marked it already, or did not: the key came before CLEAR)
        DR.press(cl ? { k: 'clear+step', n } : { k: 'step', n });
      });
    }
    upds.push((s, led) => { const code = led.step[n - 1] | 0; setA(b, 'data-lit', LIT[code]); setA(b, 'aria-pressed', code === 1 || code === 4 ? 'true' : 'false'); setA(b, 'aria-current', code === 2 ? 'true' : null); });
    return b;
  }
  function startBtn(c) {
    const b = btn('dr-start', 'Start / stop', c);
    if (!live) disable(b); else A.tap(b, () => DR.press({ k: 'start' }));
    upds.push(s => { setA(b, 'aria-pressed', s.run ? 'true' : 'false'); setA(b, 'data-run', s.run ? '' : null); });
    return b;
  }
  function tapBtn(c) { // TAP acts at the press (the heard time matters: TAP writes the nearest step, §3.3)
    const b = btn('dr-tap', 'Tap', c);
    b.setAttribute('data-gesture', 'music');
    if (!live) { disable(b); return b; }
    b.addEventListener('pointerdown', e => { if (e.button !== 0 || e.ctrlKey) return; e.preventDefault(); DR.tap(e.timeStamp); });
    b.addEventListener('keydown', e => { if (!isKey(e)) return; e.preventDefault(); if (!e.repeat) DR.tap(e.timeStamp); });
    b.addEventListener('contextmenu', e => e.preventDefault());
    return b;
  }
  function clearBtn(c) { // CLEAR held is a state: a step key meanwhile is CLEAR + N; released with none, CLEAR (§3.3)
    const b = btn('dr-clear', 'Clear', c);
    b.setAttribute('data-gesture', 'music'); b.setAttribute('aria-pressed', 'false');
    if (!live) { disable(b); return b; }
    let pid = null;
    const down = () => { clearHeld = true; clearUsed = false; b.setAttribute('aria-pressed', 'true'); };
    const up = fire => { if (!clearHeld) return; clearHeld = false; pid = null; b.setAttribute('aria-pressed', 'false'); if (fire && !clearUsed) DR.press({ k: 'clear' }); };
    b.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.ctrlKey || clearHeld) return;
      e.preventDefault(); pid = e.pointerId;
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
      down();
    });
    b.addEventListener('pointerup', e => { if (e.pointerId === pid) up(true); });
    for (const t of ['pointercancel', 'lostpointercapture']) b.addEventListener(t, e => { if (e.pointerId === pid) up(false); });
    b.addEventListener('keydown', e => { if (!isKey(e)) return; e.preventDefault(); if (!e.repeat && !clearHeld) down(); });
    b.addEventListener('keyup', e => { if (isKey(e)) { e.preventDefault(); up(true); } });
    b.addEventListener('blur', () => up(false));
    b.addEventListener('contextmenu', e => e.preventDefault());
    rels.push(() => { if (pid != null) try { b.releasePointerCapture(pid); } catch (err) { /* released */ } up(false); });
    return b;
  }
  // a binding over a detented control's positions (cv-panel / classic-panel dragB: a drag, the keys and the wheel)
  const posB = (T, axis, invert) => {
    const set = v => { const i = clamp(Math.round(v), 0, T.n - 1); if (i !== T.pos(st().D)) DR.press({ k: T.k, v: T.val(i) }); };
    return { label: T.label, min: 0, max: T.n - 1, step: 1, def: T.def, axis, invert: !!invert, get: () => T.pos(st().D), set,
      fmt: v => T.text(clamp(Math.round(v), 0, T.n - 1), st().D), snap: () => ({ i: T.pos(st().D) }), restore: k => { if (k) set(k.i); } };
  };
  const next = T => () => DR.press({ k: T.k, v: T.val((T.pos(st().D) + 1) % T.n) });
  function rotary(c) { // MODE, INSTRUMENT / TRACK, AUTO FILL IN (and PRE-SCALE when a rotary): today's knob drawing, detented
    const T = U.dial[c.id], N = T.n, sweep = c.sweep || 270, r0 = fin(c.rot) ? c.rot : 0, el = mk('div', 'knob hw-rot dr-rot'); // ((7b) rot: the sweep's centre)
    el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', T.label);
    el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', String(N - 1));
    ctx.skinVars(el, c);
    const { svg, rot } = ctx.knobSvg(ctx.skinOf(c));
    el.append(svg);
    upds.push(s => { const i = T.pos(s.D); setA(rot, 'transform', `rotate(${ctx.n3(r0 + (N > 1 ? -sweep / 2 + sweep * i / (N - 1) : 0))} 32 32)`); setA(el, 'aria-valuenow', i); setA(el, 'aria-valuetext', T.text(i, s.D)); });
    if (!live) disable(el); else A.dragB(el, posB(T, 'y'), { tap: next(T) });
    return el;
  }
  function slide(c, o) { // BASIC / I/F VARIATION, PRE-SCALE (7b: the 606's SCALE): a slide switch (or a rocker) over its positions
    const T = U.dial[c.id], N = T.n, style = c.style || 'slide', orient = c.orient || (c.h > c.w ? 'v' : 'h');
    const el = mk('button', 'hw-sw dr-sw');
    el.type = 'button'; el.setAttribute('aria-label', T.label); el.setAttribute('data-style', style); el.setAttribute('data-orient', orient); el.setAttribute('data-n', String(N));
    const r = o.own || o.box;
    ctx.prop(el, '--kd', ctx.r05(Math.min(r.w, r.h) * 0.8) + 'px'); ctx.prop(el, '--sw-c', ctx.named(c.color));
    let knob = null;
    if (style === 'rocker' || style === 'paddle') el.append(mk('i', 'hw-sw-a'), mk('i', 'hw-sw-b'));
    else { knob = mk('b', 'hw-sw-k'); el.append(mk('i', 'hw-sw-t'), knob); }
    if (N > 2) { el.setAttribute('role', 'slider'); el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', String(N - 1)); }
    upds.push(s => {
      const i = T.pos(s.D);
      setA(el, 'data-pos', i);
      if (knob) ctx.prop(knob, '--f', ctx.n3(N > 1 ? i / (N - 1) : 0));
      if (N > 2) setA(el, 'aria-valuenow', i); else setA(el, 'aria-pressed', i ? 'true' : 'false');
      setA(el, 'aria-valuetext', T.text(i, s.D));
    });
    if (!live) disable(el); else A.dragB(el, posB(T, orient === 'h' ? 'x' : 'y', orient === 'v'), { tap: next(T) }); // (vertical: up is the first position)
    return el;
  }
  function tempoKnob(c) { // TEMPO (40 click stops) and FINE (± half a click): the machine's tempo, or the project's when synced
    const T = c.id === 'dr:tempo', N = DC.TEMPO_CLICKS, sweep = c.sweep || 300, el = mk('div', 'knob hw-tempo dr-tempo');
    el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', T ? 'Tempo' : 'Fine tempo');
    el.setAttribute('aria-valuemin', T ? '0' : '-0.5'); el.setAttribute('aria-valuemax', T ? String(N - 1) : '0.5');
    ctx.skinVars(el, c);
    const { svg, rot } = ctx.knobSvg(ctx.skinOf(c));
    el.append(svg);
    const knobs = s => (s.D.x.sync ? DC.bpmTempo(s.S.bpm) : { tempo: s.D.ui.tempo, fine: s.D.ui.fine });
    const bpmTxt = (t, f) => { const v = DC.tempoBpm(t, f); return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, '')) + ' BPM'; };
    upds.push(s => {
      const k = knobs(s), p = T ? k.tempo / (N - 1) : k.fine + 0.5;
      setA(rot, 'transform', `rotate(${ctx.n3(-sweep / 2 + sweep * p)} 32 32)`);
      setA(el, 'aria-valuenow', T ? k.tempo : r3(k.fine));
      setA(el, 'aria-valuetext', T ? bpmTxt(k.tempo, k.fine) : (k.fine > 0 ? '+' : '') + k.fine.toFixed(2) + ' click · ' + bpmTxt(k.tempo, k.fine));
    });
    if (!live) { disable(el); return el; }
    const get = () => { const k = knobs(st()); return T ? k.tempo : k.fine; };
    const b = { label: T ? 'Tempo' : 'Fine tempo', min: T ? 0 : -0.5, max: T ? N - 1 : 0.5, step: T ? 1 : 0.01, def: T ? DC.bpmTempo(120).tempo : 0, axis: 'y', get,
      set: (v, ph) => { v = T ? clamp(Math.round(v), 0, N - 1) : clamp(r3(v), -0.5, 0.5); if (v !== get()) DR.press({ k: T ? 'tempo' : 'fine', v }, ph); },
      fmt: v => { const k = knobs(st()); return T ? bpmTxt(clamp(Math.round(v), 0, N - 1), k.fine) : bpmTxt(k.tempo, v); },
      end: () => DR.end(), snap: () => ({ v: get() }), restore: k => { if (k) { b.set(k.v); DR.end(); } } };
    A.dragB(el, b);
    return el;
  }
  /* ---- (7b) the TR-606's face (§7.4): FUNCTION and CLEAR/RESET held, the step keys down / up, RUN/STOP and PATTERN GROUP at
     the press, TEMPO continuous. H6: what this panel holds down — FUNCTION (its key, or Alt while Alt is down), CLEAR, the
     step keys (n → its pointer, 'kb' for the keyboard); a cancel lets go of it all with one { k: 'release' } (nothing done) */
  const H6 = { fn: null, alt: false, clr: null, keys: new Map() };
  const fnOn = () => !!H6.fn || H6.alt;
  const fnSet = (by, v) => { const was = fnOn(); H6[by] = v; if (fnOn() !== was) DR.press({ k: 'fn', down: fnOn() }); };
  const altKey = e => { if (e.key === 'Alt') altUp(); };
  let altDoc = null;
  function altUp() { if (altDoc) { altDoc.removeEventListener('keyup', altKey, true); altDoc = null; } if (H6.alt) fnSet('alt', false); }
  function altDown() { if (H6.alt) return; fnSet('alt', true); if (doc && typeof doc.addEventListener === 'function') { altDoc = doc; doc.addEventListener('keyup', altKey, true); } }
  function cancel6() { // two-finger cancel, lost capture, blur, the host's release-all, destroy: every hold let go, nothing done
    const any = !!H6.fn || H6.alt || !!H6.clr || H6.keys.size > 0;
    for (const h of [H6.fn, H6.clr, ...H6.keys.values()]) if (h && h.id !== 'kb') { try { h.el.releasePointerCapture(h.id); } catch (err) { /* released */ } }
    H6.fn = null; H6.clr = null; H6.keys.clear();
    if (altDoc) { altDoc.removeEventListener('keyup', altKey, true); altDoc = null; }
    H6.alt = false;
    if (any && DR) DR.press({ k: 'release' });
  }
  if (six) rels.push(cancel6);
  const cancelOn = (el, which) => { // a pointer's hold cancelled (its capture lost before its up, a pointercancel) → cancel6
    for (const t of ['pointercancel', 'lostpointercapture']) el.addEventListener(t, e => { const h = which(); if (h && h.id === e.pointerId) cancel6(); });
  };
  function holdBtn(c, k, label) { // FUNCTION / CLEAR/RESET: held states (pointer capture; Enter / Space held) sending down / up
    const b = btn(k === 'fn' ? 'dr-fn' : 'dr-clear', label, c);
    b.setAttribute('data-gesture', 'music'); b.setAttribute('aria-pressed', 'false');
    upds.push(s => setA(b, 'aria-pressed', s.S[k] ? 'true' : 'false'));
    if (!live) { disable(b); return b; }
    const down = id => { if (H6[k]) return; const h = { el: b, id }; if (k === 'fn') fnSet('fn', h); else { H6.clr = h; DR.press({ k: 'clr', down: true }); } };
    const up = id => { const h = H6[k]; if (!h || h.id !== id) return; if (k === 'fn') fnSet('fn', null); else { H6.clr = null; DR.press({ k: 'clr', down: false }); } };
    b.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.ctrlKey || H6[k]) return;
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
      down(e.pointerId);
    });
    b.addEventListener('pointerup', e => up(e.pointerId));
    cancelOn(b, () => H6[k]);
    b.addEventListener('keydown', e => { if (!isKey(e)) return; e.preventDefault(); if (!e.repeat) down('kb'); });
    b.addEventListener('keyup', e => { if (isKey(e)) { e.preventDefault(); up('kb'); } });
    b.addEventListener('blur', () => { const h = H6[k]; if (h && h.id === 'kb') cancel6(); });
    b.addEventListener('contextmenu', e => e.preventDefault());
    return b;
  }
  function stepKey606(c) { // a step key: its LED; down / up (a second key down in the block while one is held: a chain; Shift: the
    // chain to the selection's first; Alt: FUNCTION held while Alt is) — the key acts at its down, as the hardware's
    const n = c.n, b = btn('dr-key', 'Step ' + n, Object.assign({}, c, { led: c.led || 'above' }));
    b.setAttribute('data-n', String(n)); b.setAttribute('data-gesture', 'music'); b.setAttribute('aria-keyshortcuts', 'Shift+Enter Alt+Enter');
    upds.push((s, led) => { const code = led.step[n - 1] | 0; setA(b, 'data-lit', LIT[code]); setA(b, 'aria-pressed', code === 1 || code === 4 ? 'true' : 'false'); setA(b, 'aria-current', code === 2 ? 'true' : null); });
    if (!live) { disable(b); return b; }
    const down = (id, e) => {
      if (H6.keys.has(n)) return;
      if (e.altKey) altDown(); else if (H6.alt) altUp(); // (Alt let go unseen — another window: FUNCTION up first)
      H6.keys.set(n, { el: b, id });
      DR.press({ k: 'key', n, down: true, shift: !!e.shiftKey });
    };
    const up = (id, e) => {
      const h = H6.keys.get(n);
      if (!h || h.id !== id) return;
      H6.keys.delete(n);
      DR.press({ k: 'key', n, down: false });
      if (H6.alt && !e.altKey) altUp(); // (FUNCTION + key: fn down, key down, key up, fn up)
    };
    b.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.ctrlKey) return;
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
      down(e.pointerId, e);
    });
    b.addEventListener('pointerup', e => up(e.pointerId, e));
    cancelOn(b, () => H6.keys.get(n));
    b.addEventListener('keydown', e => { if (!isKey(e)) return; e.preventDefault(); if (!e.repeat) down('kb', e); });
    b.addEventListener('keyup', e => { if (isKey(e)) { e.preventDefault(); up('kb', e); } });
    b.addEventListener('blur', () => { const h = H6.keys.get(n); if (h && h.id === 'kb') cancel6(); });
    b.addEventListener('contextmenu', e => e.preventDefault());
    return b;
  }
  // RUN/STOP and PATTERN GROUP on a tap (7b review 2 #1 / #2: the 808's START's A.tap — a mouse at the press, a finger at its
  // release within the slop, a pointercancel drops it, Enter / Space; a pinch or pan starting on them presses nothing). Not a
  // music zone: FUNCTION + PATTERN GROUP still works, FUNCTION being the music touch held first
  function tapBtn6(cls, label, c, input) {
    const b = btn(cls, label, c);
    if (!live) disable(b); else A.tap(b, () => DR.press(input));
    return b;
  }
  function start606(c) {
    const b = tapBtn6('dr-start', 'Run / stop', c, { k: 'start' });
    upds.push(s => { setA(b, 'aria-pressed', s.run ? 'true' : 'false'); setA(b, 'data-run', s.run ? '' : null); });
    return b;
  }
  function grp606(c) {
    const b = tapBtn6('dr-grp', 'Pattern group', c, { k: 'grp' });
    upds.push(s => { const g = s.D.ui.mode < DC.M6_PP ? s.D.tg[s.D.ui.inst] : s.D.ui.grp; setA(b, 'aria-label', 'Pattern group · ' + (g ? 'II' : 'I')); });
    return b;
  }
  function tempo606(c) { // TEMPO 40–300 BPM, continuous on a log law (drum-core tempo606): the machine's, or the project's when synced
    const sweep = c.sweep || 300, el = mk('div', 'knob hw-tempo dr-tempo');
    el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', 'Tempo');
    el.setAttribute('aria-valuemin', String(DC.TEMPO6_LO)); el.setAttribute('aria-valuemax', String(DC.TEMPO6_HI));
    ctx.skinVars(el, c);
    const { svg, rot } = ctx.knobSvg(ctx.skinOf(c));
    el.append(svg);
    const bpmOf = s => (s.D.x.sync ? s.S.bpm : s.D.ui.tempo), txt = v => r3(Math.round(v * 100) / 100) + ' BPM';
    upds.push(s => { const v = bpmOf(s); setA(rot, 'transform', `rotate(${ctx.n3(-sweep / 2 + sweep * DC.tempo606Pos(v))} 32 32)`); setA(el, 'aria-valuenow', r3(v)); setA(el, 'aria-valuetext', txt(v)); });
    if (!live) { disable(el); return el; }
    const get = () => DC.tempo606Pos(bpmOf(st()));
    const b = { label: 'Tempo', min: 0, max: 1, def: DC.tempo606Pos(120), axis: 'y', get,
      set: (u, ph) => { const v = DC.tempo606(clamp(u, 0, 1)); if (v !== bpmOf(st())) DR.press({ k: 'tempo', v }, ph); },
      fmt: u => txt(DC.tempo606(clamp(u, 0, 1))), end: () => DR.end(), snap: () => ({ v: bpmOf(st()) }),
      restore: k => { if (k && k.v !== bpmOf(st())) { DR.press({ k: 'tempo', v: k.v }); DR.end(); } } };
    A.dragB(el, b);
    return el;
  }
  /* ---- (7c) the TR-909's face (§7.4): the held keys (SHIFT, INSTRUMENT SELECT, CLEAR, LAST STEP, SHUFFLE/FLAM, the TEMPO key,
     AVAILABLE MEAS) and the step keys send down / up — music zones: two fingers are two presses (SHIFT + a key, a pair, a
     block, finger drumming in TAP write), never a pinch; the taps (START, STOP/CONT, SCALE, TRACK n, PATTERN n, BACK, FWD,
     CYCLE/GUIDE, ENTER) on A.tap (a finger at its release: a pinch starting there zooms, 7b review 2 #1 / #2). H9: what this
     panel holds — each held key's pointer ('kb': the keyboard), Alt (SHIFT while Alt is down: the mouse's keypad), the step
     keys; a cancel (two-finger cancel, lost capture, blur, the host's release-all, destroy) lets go of it all with one
     { k: 'release' } (nothing done). (review 2 F2, the lead's) a mouse / pen click or a key press on a held key LATCHES it — lit,
     aria-pressed, "latched" in its label — until the next key uses it (a step key's up, a tap; SHIFT stays through a SHIFT
     sequence: digits, COPY / INS / DEL, until its ENTER), a second click toggles it off, Escape cancels; a finger holds as before */
  const H9 = { hold: {}, alt: false, keys: new Map() };
  const shOn9 = () => !!H9.hold.shift || H9.alt;
  const holdSet9 = (b, h) => { // a held key's state (SHIFT: its key or Alt) → down / up when it changes
    if (b === 'shift') { const was = shOn9(); H9.hold.shift = h; if (shOn9() !== was) DR.press({ k: 'hold', b, down: shOn9() }); return; }
    const was = !!H9.hold[b]; H9.hold[b] = h;
    if (!!h !== was) DR.press({ k: 'hold', b, down: !!h });
  };
  const altKey9 = e => { if (e.key === 'Alt') altUp9(); };
  let alt9Doc = null;
  function altUp9() { if (alt9Doc) { alt9Doc.removeEventListener('keyup', altKey9, true); alt9Doc = null; } if (H9.alt) { const was = shOn9(); H9.alt = false; if (shOn9() !== was) DR.press({ k: 'hold', b: 'shift', down: false }); } }
  function altDown9() {
    if (H9.alt) return;
    const was = shOn9(); H9.alt = true;
    if (!was) DR.press({ k: 'hold', b: 'shift', down: true });
    if (doc && typeof doc.addEventListener === 'function') { alt9Doc = doc; doc.addEventListener('keyup', altKey9, true); }
  }
  function cancel9() {
    const hs = Object.values(H9.hold).filter(Boolean), any = hs.length > 0 || H9.alt || H9.keys.size > 0;
    for (const h of [...hs, ...H9.keys.values()]) if (h.id !== 'kb' && h.id !== 'latch') { try { h.el.releasePointerCapture(h.id); } catch (err) { /* released */ } }
    H9.hold = {}; H9.keys.clear();
    if (alt9Doc) { alt9Doc.removeEventListener('keyup', altKey9, true); alt9Doc = null; }
    H9.alt = false;
    latchDoc9();
    if (any && DR) DR.press({ k: 'release' });
    dirty();
  }
  // (review 2 F2) the latches: Escape cancels them (a document listener while one is on); a press that used them lets them go
  const latched9 = () => Object.keys(H9.hold).filter(b => H9.hold[b] && H9.hold[b].id === 'latch');
  const esc9 = e => { if (e.key === 'Escape' && latched9().length) { e.preventDefault(); cancel9(); } };
  let esc9Doc = null;
  function latchDoc9() {
    const on = latched9().length > 0 && !!doc && typeof doc.addEventListener === 'function';
    if (on && !esc9Doc) { esc9Doc = doc; doc.addEventListener('keydown', esc9, true); }
    else if (!on && esc9Doc) { esc9Doc.removeEventListener('keydown', esc9, true); esc9Doc = null; }
  }
  function consume9() {
    const L = latched9();
    if (!L.length || !DR) return;
    const S = DR.state().S || {};
    for (const b of L) if (!(b === 'shift' && (S.dig != null || S.op != null))) holdSet9(b, null); // (SHIFT: through its sequence)
    latchDoc9(); dirty();
  }
  function latch9(b, el) { // a click / key press on a held key: latched, or (latched already) off
    const h = H9.hold[b];
    if (h && h.id === 'latch') { holdSet9(b, null); latchDoc9(); dirty(); return; }
    if (h) return;                                                   // (a finger holds it)
    const sh = latched9().includes('shift');
    holdSet9(b, { el, id: 'latch' });
    // a combination with a latched SHIFT (SHIFT + TEMPO: STEP write, + AVAILABLE MEAS: bank II) acts now: both used
    if (b !== 'shift' && sh && DR && !(DR.state().S.hold || {})[b]) { H9.hold[b] = null; consume9(); }
    latchDoc9(); dirty();
  }
  if (nine) rels.push(cancel9);
  const cancelOn9 = (el, which) => { for (const t of ['pointercancel', 'lostpointercapture']) el.addEventListener(t, e => { const h = which(); if (h && h.id === e.pointerId) cancel9(); }); };
  // a held key's pointer / keyboard plumbing (pointer capture; Enter / Space held; a blurred keyboard hold cancels)
  function held9(el, down, up, which, latch) {
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.ctrlKey) return;
      e.preventDefault();
      if (latch && e.pointerType !== 'touch') { latch(); return; } // (review 2 F2: a mouse / pen latches a held key)
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
      down(e.pointerId, e);
    });
    el.addEventListener('pointerup', e => up(e.pointerId, e));
    cancelOn9(el, which);
    el.addEventListener('keydown', e => { if (!isKey(e)) return; e.preventDefault(); if (e.repeat) return; if (latch) latch(); else down('kb', e); });
    el.addEventListener('keyup', e => { if (isKey(e)) { e.preventDefault(); up('kb', e); } });
    el.addEventListener('blur', () => { const h = which(); if (h && h.id === 'kb') cancel9(); });
    el.addEventListener('contextmenu', e => e.preventDefault());
  }
  const HOLD9 = { 'dr:shift': ['shift', 'Shift'], 'dr:isel': ['isel', 'Instrument select'], 'dr:clear': ['clear', 'Clear'], 'dr:last': ['last', 'Last step'],
    'dr:shuf': ['shuf', 'Shuffle / flam'], 'dr:tkey': ['tkey', 'Tempo · Shift: step write'], 'dr:avail': ['avail', 'Available measures · Shift: bank II'] };
  function holdBtn9(c) { // a held key; the TEMPO key and AVAILABLE MEAS show their LEDs (leds()); (review 2 F2) latched: data-latch, its label
    const [b, label] = HOLD9[c.id], lk = b === 'tkey' || b === 'avail';
    const el = btn('dr-hold' + (lk ? ' dr-lk' : ''), label, lk ? Object.assign({}, c, { led: c.led || 'cap' }) : c);
    el.setAttribute('data-gesture', 'music'); el.setAttribute('aria-pressed', 'false');
    upds.push((s, led) => {
      const lt = !!(H9.hold[b] && H9.hold[b].id === 'latch' && s.S.hold && s.S.hold[b]);
      setA(el, 'aria-pressed', s.S.hold && s.S.hold[b] ? 'true' : 'false'); if (lk) setA(el, 'data-lit', LIT[led[b] | 0]);
      setA(el, 'data-latch', lt ? '' : null); setA(el, 'aria-label', lt ? label + ' · latched: for the next key (click again or Escape to cancel)' : label);
    });
    if (!live) { disable(el); return el; }
    held9(el, id => { if (!H9.hold[b]) holdSet9(b, { el, id }); }, id => { const h = H9.hold[b]; if (h && h.id === id) holdSet9(b, null); }, () => H9.hold[b], () => latch9(b, el));
    return el;
  }
  function stepKey909(c) { // a step key: its LED (dim a normal step); down / up — its voice in TAP write (a drum pad), else the 909's key
    const n = c.n, b = btn('dr-key', 'Step ' + n + ' · ' + (KEY9[n - 1] || ''), Object.assign({}, c, { led: c.led || 'cap' }));
    b.setAttribute('data-n', String(n)); b.setAttribute('data-gesture', 'music'); b.setAttribute('aria-keyshortcuts', 'Shift+Enter Alt+Enter');
    upds.push((s, led) => { const code = led.step[n - 1] | 0; setA(b, 'data-lit', LIT[code]); setA(b, 'aria-pressed', code === 1 || code === 4 || code === 5 ? 'true' : 'false'); setA(b, 'aria-current', code === 2 ? 'true' : null); });
    if (!live) { disable(b); return b; }
    held9(b, (id, e) => {
      if (H9.keys.has(n)) return;
      if (e.altKey) altDown9(); else if (H9.alt) altUp9(); // (Alt let go unseen — another window: SHIFT up first)
      H9.keys.set(n, { el: b, id });
      DR.press({ k: 'key', n, down: true, shift: !!e.shiftKey, ts: e.timeStamp }); // (ts: TAP write's heard fraction, the host's)
    }, (id, e) => {
      const h = H9.keys.get(n);
      if (!h || h.id !== id) return;
      H9.keys.delete(n);
      DR.press({ k: 'key', n, down: false, ts: e.timeStamp });
      if (H9.alt && !e.altKey) altUp9(); // (SHIFT + key: shift down, key down, key up, shift up)
      consume9();                        // (review 2 F2: a latched hold used by this key: let go)
    }, () => H9.keys.get(n));
    return b;
  }
  const TAP9 = { 'dr:start': ['start', 'Start'], 'dr:stop': ['stop', 'Stop / continue'], 'dr:scale': ['scale', 'Scale'], 'dr:trk': ['trk', 'Track'], 'dr:pat': ['pat', 'Pattern'],
    'dr:back': ['back', 'Back · Shift: tap write'], 'dr:fwd': ['fwd', 'Forward · Shift: bank I'], 'dr:cyc': ['cyc', 'Cycle / guide · Shift: last measure'], 'dr:enter': ['enter', 'Enter'] };
  function tapBtn9(c) { // a tap (A.tap); TRACK n / PATTERN n by their n; the LED keys lit from leds() (TRACK / PATTERN: the mode's, flashing in a write mode)
    const [b, name] = TAP9[c.id], n = b === 'trk' || b === 'pat' ? c.n : 0, lk = b !== 'start' && b !== 'stop' && b !== 'scale';
    const label = n ? `${name} ${n} · Shift: ${b === 'trk' ? 'track' : 'pattern'} write` : name;
    const el = btn(b === 'start' ? 'dr-start' : 'dr-tap9' + (lk ? ' dr-lk' : ''), label, lk ? Object.assign({}, c, { led: c.led || 'cap' }) : c);
    if (n) el.setAttribute('data-n', String(n));
    if (!live) disable(el);
    else {
      // (review 2 F1) what is held at this tap's own press — sent with the tap, so a held finger lifted before the tap's release
      // (or with it: one touchend, the held one first) still counts; (review 2 F2) Alt / Shift on a desktop is SHIFT
      let lt = null;
      const heldNow = e => {
        const h = {};
        if (shOn9() || (e && (e.altKey || e.shiftKey))) h.shift = true;
        for (const k of ['isel', 'clear', 'last', 'shuf', 'tkey', 'avail']) if (H9.hold[k]) h[k] = true;
        return h;
      };
      el.addEventListener('pointerdown', e => { lt = e.button === 0 ? { id: e.pointerId, h: heldNow(e), k: [...H9.keys.keys()] } : null; });
      el.addEventListener('pointercancel', e => { if (lt && lt.id === e.pointerId) lt = null; });
      A.tap(el, e => {
        const L = lt && (!e || e.pointerId == null || e.pointerId === lt.id) ? lt : null, h = Object.assign(heldNow(e), L ? L.h : null);
        const k = [...new Set([...(L ? L.k : []), ...H9.keys.keys()])], inp = n ? { k: 'tap', b, n } : { k: 'tap', b };
        lt = null;
        if (Object.keys(h).length) inp.held = h;
        if (k.length) inp.keys = k;
        DR.press(inp);
        consume9();
      });
      el.addEventListener('pointerup', () => { lt = null; }); // (after A.tap's: a press that made no tap leaves no latch)
    }
    if (b === 'start') upds.push(s => { setA(el, 'aria-pressed', s.run ? 'true' : 'false'); setA(el, 'data-run', s.run ? '' : null); });
    else if (lk) upds.push((s, led) => {
      const v = (n ? led[b][n - 1] : led[b]) | 0;
      setA(el, 'data-lit', LIT[v]);
      if (b === 'trk' || b === 'pat' || b === 'cyc') setA(el, 'aria-pressed', v ? 'true' : 'false');
    });
    return el;
  }
  function tempo909(c) { // TEMPO 37–290 BPM, whole, continuous on a log law (drum-core tempo909): the machine's, or the project's when synced
    const sweep = c.sweep || 300, el = mk('div', 'knob hw-tempo dr-tempo');
    el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', 'Tempo');
    el.setAttribute('aria-valuemin', String(DC.TEMPO9_LO)); el.setAttribute('aria-valuemax', String(DC.TEMPO9_HI));
    ctx.skinVars(el, c);
    const { svg, rot } = ctx.knobSvg(ctx.skinOf(c));
    el.append(svg);
    const bpmOf = s => (s.D.x.sync ? s.S.bpm : s.D.ui.tempo), txt = v => r3(Math.round(v * 100) / 100) + ' BPM';
    upds.push(s => { const v = bpmOf(s); setA(rot, 'transform', `rotate(${ctx.n3(-sweep / 2 + sweep * DC.tempo909Pos(v))} 32 32)`); setA(el, 'aria-valuenow', r3(v)); setA(el, 'aria-valuetext', txt(v)); });
    if (!live) { disable(el); return el; }
    const get = () => DC.tempo909Pos(bpmOf(st()));
    const b = { label: 'Tempo', min: 0, max: 1, def: DC.tempo909Pos(120), axis: 'y', get,
      set: (u, ph) => { const v = DC.tempo909(clamp(u, 0, 1)); if (v !== bpmOf(st())) DR.press({ k: 'tempo', v }, ph); },
      fmt: u => txt(DC.tempo909(clamp(u, 0, 1))), end: () => DR.end(), snap: () => ({ v: bpmOf(st()) }),
      restore: k => { if (k && k.v !== bpmOf(st())) { DR.press({ k: 'tempo', v: k.v }); DR.end(); } } };
    A.dragB(el, b);
    return el;
  }
  function widget(c, o) {
    const id = c.id;
    if (nine) { // (7c) the 909's
      if (id === 'dr:step') return stepKey909(c);
      if (HOLD9[id]) return holdBtn9(c);
      if (TAP9[id]) return tapBtn9(c);
      if (id === 'dr:tempo') return tempo909(c);
      return null;
    }
    if (six) { // (7b) the 606's
      if (id === 'dr:step') return stepKey606(c);
      if (id === 'dr:start') return start606(c);
      if (id === 'dr:tap') return tapBtn(c);
      if (id === 'dr:clear') return holdBtn(c, 'clr', 'Clear / reset');
      if (id === 'dr:fn') return holdBtn(c, 'fn', 'Function');
      if (id === 'dr:grp') return grp606(c);
      if (id === 'dr:tempo') return tempo606(c);
    } else {
      if (id === 'dr:step') return stepKey(c);
      if (id === 'dr:start') return startBtn(c);
      if (id === 'dr:tap') return tapBtn(c);
      if (id === 'dr:clear') return clearBtn(c);
      if (id === 'dr:tempo' || id === 'dr:fine') return tempoKnob(c);
    }
    if (U.dial[id]) return c.kind === 'rotary' ? rotary(c) : slide(c, o);
    return null;
  }
  // the LEDs that are no key's: the 808's 1st / 2nd PART and variation (§3.3); (7b) the 606's RUN and group I / II (code 2:
  // PATTERN CLEAR's flash)
  const SHOW = six ? { 'dr:runLed': ['run', -1, 'Run'], 'dr:grpI': ['grp', 0, 'Pattern group I'], 'dr:grpII': ['grp', 1, 'Pattern group II'] }
    : { 'dr:part1': ['part', 0, '1st part'], 'dr:part2': ['part', 1, '2nd part'], 'dr:varA': ['vari', 0, 'Variation A'], 'dr:varB': ['vari', 1, 'Variation B'] };
  // (7c) the 909's 3-digit display (drum-core's disp: the DX7 LED's look, its characters filling the window) and the four scale
  // rows' LEDs (n 1–4), painted with the keys
  const SCL9 = ['16ths', '32nds', '8th triplets', '16th triplets'];
  function show9(c, o) {
    const r = o.own || o.box;
    if (c.id === 'dr:disp') {
      const el = mk('span', 'hw-dsp dr-dsp');
      ctx.place(el, r);
      ctx.prop(el, '--dsp-c', ctx.named(c.color) || c.color);
      el.style.fontSize = Math.max(10, Math.floor(Math.min(r.h * 0.8, (r.w - 8) / (3 * 0.62)))) + 'px';
      el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'off');
      upds.push((s, led) => { const t = typeof led.disp === 'string' ? led.disp : ''; if (el.textContent !== t) el.textContent = t; setA(el, 'aria-label', 'Display: ' + (t.trim() || 'blank')); });
      return el;
    }
    if (c.id !== 'dr:scl' || !(c.n >= 1 && c.n <= 4)) return null;
    const n = c.n, el = mk('span', 'hw-led hw-show dr-led');
    ctx.place(el, r);
    ctx.prop(el, '--led-c', ctx.named(c.color) || c.color);
    el.setAttribute('role', 'img');
    upds.push((s, led) => { const v = led.scl[n - 1] | 0, L = v === 2 ? 'flash' : v ? 'on' : 'off'; setA(el, 'data-lit', L); setA(el, 'aria-label', 'Scale ' + SCL9[n - 1] + (v === 2 ? ': flashing' : v ? ': lit' : ': off')); });
    return el;
  }
  function show(c, o) {
    if (nine) return show9(c, o);
    const k = SHOW[c.id];
    if (!k) return null;
    const el = mk('span', 'hw-led hw-show dr-led');
    ctx.place(el, o.own || o.box);
    ctx.prop(el, '--led-c', ctx.named(c.color) || c.color);
    el.setAttribute('role', 'img');
    upds.push((s, led) => { const v = k[1] < 0 ? led[k[0]] : led[k[0]][k[1]], L = v === 2 ? 'flash' : v ? 'on' : 'off'; setA(el, 'data-lit', L); setA(el, 'aria-label', k[2] + (v === 2 ? ': flashing' : v ? ': lit' : ': off')); });
    return el;
  }
  /* ---- the extras (§3.6, §7.5): the step grid, the pads, SYNC · SWING · → PIANO ROLL · REC · MAP… · SOUNDS… · DEMO */
  const menuAt = (el, items) => { const r = el.getBoundingClientRect(); return wk.contextMenu(r.left, r.bottom + 2, items, { anchor: el }); };
  const xbtn = (label, title, fn, cls) => {
    const b = mk('button', 'dr-xb' + (cls ? ' ' + cls : ''));
    b.type = 'button'; b.textContent = label; if (title) b.title = title;
    if (!live) disable(b); else A.tap(b, fn);
    return b;
  };
  function gridCell() { // (7b: the machine's rows — the 808's twelve lanes, the 606's eight rows on their lane bits — and geometry;
    // 7c: the 909's twelve rows on theirs, its cells off / normal (a small mark) / accented (a full one) / flam (a double one))
    const G = U.grid, NR = U.lanes.length, laneOf = r => U.lanes[r], atG = six ? gridAt606 : nine ? gridAt909 : gridAt;
    const flamL = l => nine && ((DC.FL909 >> l) & 1) === 1; // (7c: BD … HT take a flam — a long press, Alt, a right click, F)
    const wrap = mk('div', 'dr-grid'), cv = mk('canvas');
    cv.setAttribute('role', 'application'); cv.setAttribute('aria-roledescription', 'step grid');
    cv.style.width = G.w + 'px'; cv.style.height = G.h + 'px';
    if (six) { wrap.style.width = G.w + 'px'; wrap.style.height = G.h + 'px'; }
    wrap.append(cv);
    let sig = '', cur = { r: 1, s: 0 }, focus = false, kbd = true, pd = false; // (cur.r: the row — the 808's lane; 7c review 2 F5: kbd the keyboard cursor's, pd a press under way)
    const view = () => { // what the grid shows: the pattern, its part, the switches, mute / solo, the playhead column
      const s = st(), D = s.D, p = DC.gridPat(s.S, D), P = s.S.pos;
      if (six || nine) { const K = D.keys[p]; return { s, D, p, part: 0, len: K.l1, l2: 0, head: s.run && P && !P.f && P.k === p ? P.s : -1, A: DC.audible(D.x) }; }
      const part = gridPart(D, p), K = D.keys[p >> 1];
      const head = s.run && P && !P.f && P.k * 2 + (P.v & 1) === p && P.p === part ? P.s - part * 16 : -1;
      return { s, D, p, part, len: part ? K.l2 : K.l1, l2: K.l2, head, A: DC.audible(D.x) };
    };
    const swOf = l => (M === 'tr808' && LANE_ALT[l] && typeof A.get === 'function' && A.get(DC.LANE_SW[l]) ? 1 : 0);
    const codeOf = r => (swOf(r) ? LANE_ALT : U.codes)[r];
    const pLabel = V => (six ? 'pattern ' + (V.p >> 4 ? 'II' : 'I') + '-' + ((V.p & 15) + 1) : nine ? 'pattern ' + PN9(V.p)
      : `${V.p >= DC.N_BASIC * 2 ? 'fill ' + ((V.p >> 1) - DC.N_BASIC + 1) : 'pattern ' + ((V.p >> 1) + 1)} ${'AB'[V.p & 1]}${V.l2 ? ' · ' + (V.part ? '2nd' : '1st') + ' part' : ''}`);
    const mounted = () => { if (cv.isConnected === false) return false; for (let n = cv; n && n.nodeType === 1; n = n.parentNode) if (n.hasAttribute && n.hasAttribute('hidden')) return false; return true; };
    // (7c) a 909 cell's state: 0 off · 1 normal · 2 accented (or on, a voice without a per-voice accent) · | 4 a flam
    const st9 = (V, l, s) => { const b = 1 << l, on = V.D.st[V.p][s] & b; return !on ? 0 : (!((DC.AC909 >> l) & 1) || V.D.ac[V.p][s] & b ? 2 : 1) | (V.D.fm[V.p][s] & b ? 4 : 0); };
    const ST9 = ['off', 'normal', 'on', '', '', 'flam', 'accented flam'];
    function draw(force) {
      const V = view(), row = V.D.st[V.p], cl = laneOf(cur.r);
      const key = [V.p, row.join(','), V.part, V.len, V.l2, V.head, V.A, V.D.x.mute, V.D.x.solo, six || nine ? '' : LANE_CODE.map((x, l) => swOf(l)).join(''), focus && kbd ? cur.r + ':' + cur.s : '',
        nine ? V.D.ac[V.p].join(',') + '/' + V.D.fm[V.p].join(',') : ''].join('|');
      const cs = nine ? st9(V, cl, cur.s) : 0;
      setA(cv, 'aria-label', `Step grid · ${pLabel(V)} · ${codeOf(cur.r)} step ${cur.s + 1} ${nine ? (cs === 2 && ((DC.AC909 >> cl) & 1) ? 'accented' : ST9[cs]) : (row[V.part * 16 + cur.s] >> cl) & 1 ? 'on' : 'off'}`);
      if (!force && key === sig) return;
      if (!mounted()) { sig = ''; retry(); return; } // (not mounted yet, or a body at home: its store stays released until it shows)
      sig = key;
      const g = wk.fitCanvas(cv, G.w, G.h);
      if (!g) return;
      drumStats.grid++;
      const { head: HX, top: TY, col: CW, row: RH } = G;
      g.fillStyle = '#101216'; g.fillRect(0, 0, G.w, G.h);
      g.textBaseline = 'middle'; g.textAlign = 'center';
      // the step row (beats bold), the corner: the part switch when the key has a 2nd part, else the pattern
      for (let s = 0; s < 16; s++) {
        g.fillStyle = s === V.head ? '#f0862a' : s < V.len ? (s % 4 ? '#7d8592' : '#c9ced6') : '#3a3f48';
        g.font = (s % 4 ? '500 ' : '700 ') + '10px system-ui, sans-serif';
        g.fillText(String(V.part * 16 + s + 1), HX + s * CW + CW / 2, TY / 2);
      }
      if (V.l2) for (let q = 0; q < 2; q++) { g.fillStyle = q === V.part ? '#f0862a' : '#2a2e35'; g.fillRect(4 + q * 29, 7, 27, 18); g.fillStyle = q === V.part ? '#101216' : '#9aa1ad'; g.font = '700 9px system-ui, sans-serif'; g.fillText(q ? '2nd' : '1st', 4 + q * 29 + 13.5, 16); }
      else { g.fillStyle = '#7d8592'; g.font = '600 9px system-ui, sans-serif'; g.fillText(six ? (V.p >> 4 ? 'II' : 'I') + '-' + ((V.p & 15) + 1) : nine ? PN9(V.p) : (V.p >= DC.N_BASIC * 2 ? 'F' + ((V.p >> 1) - DC.N_BASIC + 1) : 'P' + ((V.p >> 1) + 1)) + ' ' + 'AB'[V.p & 1], HX / 2, TY / 2); }
      // the lanes: the header (the switch's sound; muted dim, soloed lit), the cells (7b: past LAST STEP dimmed), the playhead column
      for (let r = 0; r < NR; r++) {
        const l = laneOf(r), y = TY + r * RH, aud = (V.A >> l) & 1, solo = (V.D.x.solo >> l) & 1, mute = (V.D.x.mute >> l) & 1;
        g.fillStyle = solo ? '#3a2a14' : '#16191e'; g.fillRect(2, y + 1, HX - 4, RH - 2);
        g.fillStyle = !aud ? '#4b515b' : solo ? '#f0b46a' : l ? '#d8dce2' : '#f0862a';
        g.font = '700 10px system-ui, sans-serif'; g.textAlign = 'left';
        g.fillText(codeOf(r), 8, y + RH / 2);
        g.textAlign = 'right'; g.font = '700 8px system-ui, sans-serif';
        if (mute || solo) { g.fillStyle = solo ? '#f0b46a' : '#8e95a1'; g.fillText(solo ? 'S' : 'M', HX - 6, y + RH / 2); }
        g.textAlign = 'center';
        for (let s = 0; s < 16; s++) {
          const x = HX + s * CW, on = (row[V.part * 16 + s] >> l) & 1, inLen = s < V.len;
          g.fillStyle = s === V.head ? '#2b2f37' : (six || nine) && !inLen ? '#121418' : s % 4 ? '#1a1d22' : '#20242b';
          g.fillRect(x + 1, y + 1, CW - 2, RH - 2);
          if (on) {
            g.fillStyle = !inLen || !aud ? '#6b4a2e' : l ? '#f0862a' : '#e0461f';
            if (!nine) g.fillRect(x + 4, y + 4, CW - 8, RH - 8);
            else { // (7c) normal a small mark, accented (or a voice without its own accent) a full one, a flam two side by side
              const q = st9(V, l, s), h = q & 2 ? RH - 8 : RH - 12, w2 = (CW - 12) / 2;
              if (q & 4) { g.fillRect(x + 4, y + (RH - h) / 2, w2, h); g.fillRect(x + CW - 4 - w2, y + (RH - h) / 2, w2, h); }
              else if (q & 2) g.fillRect(x + 4, y + 4, CW - 8, RH - 8);
              else g.fillRect(x + 8, y + 6, CW - 16, RH - 12);
            }
          }
        }
      }
      if (focus && kbd) { g.strokeStyle = '#ffd36a'; g.lineWidth = 2; g.strokeRect(HX + cur.s * CW + 1, TY + cur.r * RH + 1, CW - 2, RH - 2); } // (the keyboard's cursor only: :focus-visible's rule)
    }
    upds.push(() => draw(false));
    offs.push(wk.onRescale(cv, () => { if (!dead) draw(true); }), wk.onRelease(cv, () => { sig = ''; dirty(); })); // (a zoom end: the new density; an unmounted body: next frame)
    if (!live) { disable(cv); return wrap; }
    cv.tabIndex = 0;
    const rowOf = h => (h.row != null ? h.row : h.lane); // (the 808's lane is its row)
    const act = (h, solo, flam) => { // ((7c) flam: a 909 flam lane's cell — the flam toggled)
      if (!h) return;
      const V = view();
      if (h.corner) { if (M === 'tr808' && V.l2 && V.D.ui.mode !== DC.M_W1 && V.D.ui.mode !== DC.M_W2) DR.press({ k: 'part', v: V.part ? 0 : 1 }); return; }
      if (h.head) { DR.press({ k: solo ? 'solo' : 'mute', lane: h.lane }); return; }
      if (h.top) return;
      cur = { r: rowOf(h), s: h.s };
      DR.press(flam && flamL(h.lane) ? { k: 'grid', lane: h.lane, s: h.s, flam: true } : { k: 'grid', lane: h.lane, s: V.part * 16 + h.s });
    };
    const at = e => { const p = wk.localPoint(cv, e); return atG(p.x, p.y); };
    const downs = new Map();
    cv.addEventListener('pointerdown', e => {
      pd = true;
      if (kbd) { kbd = false; if (focus) draw(false); } // ((7c review 2 F5) a press: no keyboard cursor until a key)
      if (e.button !== 0 || e.ctrlKey) return;
      const h = at(e);
      if (!h) return;
      if (e.pointerType === 'mouse' && !h.head) { act(h, false, !!e.altKey); return; } // (the mouse at the press; a finger on its tap; a header waits: a long press solos; 7c: Alt a flam)
      downs.set(e.pointerId, { h, x: e.clientX, y: e.clientY, t: e.timeStamp, slop: SLOP[e.pointerType] || SLOP.touch });
    });
    cv.addEventListener('pointerup', e => {
      pd = false;
      const d = downs.get(e.pointerId);
      downs.delete(e.pointerId);
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > d.slop) return;
      const long = e.altKey || e.timeStamp - d.t >= SOLO_MS;
      act(d.h, !!d.h.head && long, !d.h.head && long); // ((7c) a long press on a 909 flam lane's cell: its flam)
    });
    cv.addEventListener('pointercancel', e => { pd = false; downs.delete(e.pointerId); });
    cv.addEventListener('contextmenu', e => { e.preventDefault(); const h = at(e); downs.clear(); if (h && h.head) act(h, true); else if (h && h.lane != null && flamL(h.lane)) act(h, false, true); });
    cv.addEventListener('keydown', e => { // arrows move the cell, Space / Enter toggles it, M mutes its lane, S solos it
      const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key], cl = laneOf(cur.r);
      if (d) { cur = { r: clamp(cur.r + d[0], 0, NR - 1), s: clamp(cur.s + d[1], 0, 15) }; draw(false); }
      else if (isKey(e)) act({ lane: cl, row: cur.r, s: cur.s }, false);
      else if (e.key === 'm' || e.key === 'M') act({ head: true, lane: cl, row: cur.r }, false);
      else if (e.key === 's' || e.key === 'S') act({ head: true, lane: cl, row: cur.r }, true);
      else if ((e.key === 'f' || e.key === 'F') && flamL(cl)) act({ lane: cl, row: cur.r, s: cur.s }, false, true); // ((7c) F: the 909 cell's flam)
      else return;
      if (!kbd) { kbd = true; draw(false); }   // ((7c review 2 F5) keyboard navigation: the cursor)
      e.preventDefault(); e.stopPropagation();
    });
    cv.addEventListener('focus', () => { focus = true; if (!pd) kbd = true; draw(false); }); // (a Tab focus: the cursor; a press's: none)
    cv.addEventListener('blur', () => { focus = false; draw(false); });
    return wrap;
  }
  function padsCell() { // 16 pads, 4 × 4 (7b: the 606's 8, 2 × 4; 7c: the 909's 12, 4 × 3): velocity from where a pad is touched, every
    // finger its own hit, lit on every hit of its sound; (7b) the AC pad is a hold — every hit plays at 127 while it is held, it
    // plays nothing itself (7c: the 909's "both" accents)
    const PG = U.padG, ORD = U.pads, ph = PG.ph || PG.pad, g = mk('div', 'dr-pads'), pads = new Map(), cnt = new Map(), ptrs = new Map();
    g.setAttribute('role', 'group'); g.setAttribute('aria-label', 'Pads'); g.setAttribute('data-gesture', 'music');
    if (M !== 'tr808') { g.setAttribute('data-m', M); g.style.width = PG.w + 'px'; g.style.height = PG.h + 'px'; }
    ORD.forEach((s, i) => {
      const ac = s === 'ac', si = SND.indexOf(s), p = mk('div', 'dr-pad'); // (one element: its code, name and slot dot are CSS — the DOM budget, review 2 #3)
      p.setAttribute('data-sound', s); p.setAttribute('role', 'button'); p.setAttribute('aria-label', ac ? 'Accent pad (hold: every hit at full accent)' : NAMES[si] + ' pad');
      p.setAttribute('data-code', ac ? 'AC' : SCODE[si]); p.setAttribute('data-name', ac ? 'Hold' : NAMES[si]); // ((7b review 2 #4) one line on a 52 px pad)
      p.style.left = (i % 4) * (PG.pad + PG.gap) + 'px'; p.style.top = (PG.top || 0) + Math.floor(i / 4) * (ph + PG.gap) + 'px';
      if (M !== 'tr808') p.style.height = ph + 'px';
      if (ac) p.setAttribute('aria-pressed', 'false');
      if (!live) disable(p); else p.tabIndex = s === 'bd' ? 0 : -1;
      g.append(p); pads.set(s, p);
    });
    // (two keyframes alternate: the animation restarts) — each pad its own parity (7c review 2 F3: one counter for every pad left
    // a pad flashed after an even number of others at the value it had: no restart, no flash)
    const flash = s => { const p = pads.get(s); if (p) p.setAttribute('data-hit', p.getAttribute('data-hit') === '1' ? '0' : '1'); };
    upds.push(s => { for (const [k, p] of pads) { const e = s.D.smp[k]; setA(p, 'data-smp', e && e.on ? '' : null); setA(p, 'title', e && e.on ? NAMES[SND.indexOf(k)] + ' · your sound: ' + e.name : null); } });
    if (!live) return g;
    const padOf = t => { for (let n = t; n && n !== g; n = n.parentNode) if (n.getAttribute && n.getAttribute('data-sound')) return n; return null; };
    const hit = (s, v, ts) => {
      cnt.set(s, (cnt.get(s) || 0) + 1); setA(pads.get(s), 'data-held', '');
      if (s === 'ac') { setA(pads.get(s), 'aria-pressed', 'true'); return; } // (7b: the accent held, no note)
      flash(s); DR.pads.on(s, cnt.get('ac') ? 1 : v, ts);
    };
    const lift = (s, ts) => {
      const c = (cnt.get(s) || 0) - 1;
      if (c > 0) { cnt.set(s, c); return; }
      cnt.delete(s); setA(pads.get(s), 'data-held', null);
      if (s === 'ac') setA(pads.get(s), 'aria-pressed', 'false'); else DR.pads.off(s, ts);
    };
    g.addEventListener('pointerdown', e => {
      const p = padOf(e.target);
      if (!p || e.button !== 0 || e.ctrlKey || ptrs.has(e.pointerId)) return;
      e.preventDefault();
      const r = p.getBoundingClientRect(), f = r.height > 0 ? (e.clientY - r.top) / r.height : 1, s = p.getAttribute('data-sound');
      try { p.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
      ptrs.set(e.pointerId, { s, p });
      hit(s, padVel(f), e.timeStamp);
    });
    const end = e => { const q = ptrs.get(e.pointerId); if (!q) return; ptrs.delete(e.pointerId); lift(q.s, e.timeStamp); };
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) g.addEventListener(t, end);
    g.addEventListener('contextmenu', e => e.preventDefault());
    const keyed = new Set();
    g.addEventListener('keydown', e => { // Space / Enter: a hit at an unaccented step's velocity; the arrows move along the pads
      const p = padOf(e.target);
      if (!p) return;
      const s = p.getAttribute('data-sound'), i = ORD.indexOf(s);
      const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 }[e.key];
      if (d) { const j = i + d; if (j >= 0 && j < ORD.length) { p.tabIndex = -1; const q = pads.get(ORD[j]); q.tabIndex = 0; try { q.focus({ preventScroll: true }); } catch (err) { /* inert */ } } e.preventDefault(); return; }
      if (!isKey(e)) return;
      e.preventDefault();
      if (e.repeat || keyed.has(s)) return;
      keyed.add(s); hit(s, KEY_PAD_V, e.timeStamp);
    });
    g.addEventListener('keyup', e => { const p = padOf(e.target), s = p && p.getAttribute('data-sound'); if (s && keyed.delete(s)) { e.preventDefault(); lift(s, e.timeStamp); } });
    offs.push(DR.lit(mask => { if (dead || off()) return; for (let i = 0; i < 16; i++) if ((mask >> i) & 1) flash(SND[i]); })); // ((7c) by the machine's sound ids: the 909's 7 / 8 its ride / crash)
    rels.push(() => { // every pointer and key ends (one off per sounding pad), captures dropped
      for (const [id, q] of [...ptrs]) { ptrs.delete(id); try { q.p.releasePointerCapture(id); } catch (err) { /* released */ } }
      keyed.clear();
      for (const s of [...cnt.keys()]) { cnt.delete(s); setA(pads.get(s), 'data-held', null); if (s === 'ac') setA(pads.get(s), 'aria-pressed', 'false'); else DR.pads.off(s); }
    });
    return g;
  }
  function swingCell() { // SWING 50–75 % (50: off), a drag / the arrows / the wheel
    const el = mk('div', 'dr-xb dr-xnum'), lab = mk('span'), val = mk('b');
    el.setAttribute('role', 'slider'); el.setAttribute('aria-label', 'Swing'); el.setAttribute('aria-valuemin', String(DC.SWING_LO)); el.setAttribute('aria-valuemax', String(DC.SWING_HI));
    lab.textContent = 'Swing'; el.append(lab, val);
    const txt = v => (v <= DC.SWING_LO ? 'off' : v + ' %');
    upds.push(s => { const v = s.D.x.swing; val.textContent = txt(v); setA(el, 'aria-valuenow', v); setA(el, 'aria-valuetext', v <= DC.SWING_LO ? '50 % (off)' : v + ' %'); });
    if (!live) { disable(el); return el; }
    el.tabIndex = 0;
    const get = () => st().D.x.swing, set = v => { v = clamp(Math.round(v), DC.SWING_LO, DC.SWING_HI); if (v !== get()) DR.press({ k: 'swing', v }); };
    A.dragB(el, { label: 'Swing', min: DC.SWING_LO, max: DC.SWING_HI, step: 1, def: DC.SWING_LO, axis: 'y', get, set, fmt: v => txt(Math.round(v)), snap: () => ({ v: get() }), restore: k => { if (k) set(k.v); } });
    return el;
  }
  function toRollMenu(el) {
    const n = DR.bars(), items = [1, 2, 4, 8, 16].map(b => ({ label: b + (b > 1 ? ' bars' : ' bar') + (b === 4 ? ' (default)' : ''), action: () => DR.toRoll(b) }));
    items.push({ sep: true }, { label: `The pattern's length (${n} bar${n > 1 ? 's' : ''})`, action: () => DR.toRoll(n) });
    return menuAt(el, items);
  }
  function mapMenu(el) { // MAP…: per sound its notes (primary first): learn the next played note, type them, none; reset to GM
    const D = st().D, nm = n => n + ' (' + noteName(n) + ')';
    const items = SIDS.map(i => { // (7b: the machine's sounds — the 606's seven; 7c: the 909's eleven, by its own keys and names)
      const s = SND[i], ns = D.map[s] || [];
      return { label: NAMES[i] + ' · ' + (ns.length ? ns.map(nm).join(', ') : 'no note'), sub: [
        { label: 'Learn: play a note…', disabled: !DR.canLearn, action: () => DR.learn(s) },
        { label: 'Notes…', action: () => { const t = wk.ask(`Notes for ${NAMES[i]} (MIDI numbers, the primary first)`, ns.join(', ')); if (t != null) DR.press({ k: 'map', sound: s, notes: String(t).split(/[\s,;]+/).filter(Boolean).map(Number).filter(Number.isInteger) }); } },
        { label: 'No note', disabled: !ns.length, action: () => DR.press({ k: 'map', sound: s, notes: [] }) },
      ] };
    });
    items.push({ sep: true }, { label: 'Reset to the General MIDI drum keys', action: () => DR.press({ k: 'mapReset' }) });
    return menuAt(el, items);
  }
  function soundsMenu(el) { // SOUNDS…: per sound "Circuit (ours)" | your sound; Load…; remove (§5). (7c) The 909's hi-hats, crash and
    // ride: "Our sound" | "Your sound (through the 909's chip)" — a loaded sound becomes that voice's chip image (§5, Q2)
    const D = st().D;
    const items = SIDS.map(i => {
      const s = SND[i], e = D.smp[s], rom = nine && i >= 7 && i <= 10, chip = rom ? ' (through the 909’s chip)' : '';
      return { label: NAMES[i] + ' · ' + (e && e.on ? 'your sound: ' + (e.name || 'sample') + chip : rom ? 'our sound' : 'circuit (ours)'), sub: [
        { label: rom ? 'Our sound' : 'Circuit (ours)', checked: !(e && e.on), action: () => { if (e) DR.press({ k: 'smp', sound: s, slot: Object.assign({}, e, { on: false }) }); } },
        { label: 'Your sound' + chip + (e ? ': ' + (e.name || 'sample') : ''), checked: !!(e && e.on), disabled: !e, action: () => DR.press({ k: 'smp', sound: s, slot: Object.assign({}, e, { on: true }) }) },
        { label: 'Load…', disabled: !DR.canLoad, action: () => DR.sample(s) },
        { label: '✕ Remove your sound', disabled: !e, action: () => DR.press({ k: 'smp', sound: s, slot: null }) },
      ] };
    });
    return menuAt(el, items);
  }
  function extra(cell) {
    const id = cell.id;
    if (id === 'dr:grid') return gridCell();
    if (id === 'dr:pads') return padsCell();
    if (id === 'dr:swing') return swingCell();
    let b = null;
    if (id === 'dr:sync') {
      b = xbtn('Sync', `On: the ${U.name} follows the song (${six ? 'RUN/STOP is ▶' : nine ? 'START and STOP/CONT are ▶ and ■' : 'START/STOP is ▶'}, TEMPO the project tempo). Off: it runs on its own at its TEMPO.`, () => DR.press({ k: 'sync', v: !st().D.x.sync }));
      upds.push(s => { const t = s.D.x.sync ? 'Sync · song' : 'Sync · own'; setA(b, 'aria-pressed', s.D.x.sync ? 'true' : 'false'); if (b.textContent !== t) b.textContent = t; });
    } else if (id === 'dr:rec') {
      b = xbtn('Rec', 'Pads write their sound at the nearest step while ' + (six || nine ? 'PATTERN WRITE' : 'a write mode') + ' runs', () => DR.press({ k: 'rec', v: !st().D.x.rec }), 'dr-rec');
      upds.push(s => setA(b, 'aria-pressed', s.D.x.rec ? 'true' : 'false'));
    } else if (id === 'dr:toRoll') b = xbtn('→ Piano roll', `Write the pattern as notes in the piano roll (the ${U.name}'s own sequencer is switched off, so it isn't heard twice)`, () => toRollMenu(b));
    else if (id === 'dr:map') b = xbtn('Map…', 'Which notes play which drum (General MIDI by default)', () => mapMenu(b));
    else if (id === 'dr:sounds') b = xbtn('Sounds…', nine ? 'Our model of each circuit and our own hi-hat and cymbal sounds through the 909’s chip circuit, or your own sound in its place' : 'Our model of each circuit, or your own sound in its place', () => soundsMenu(b));
    else if (id === 'dr:demo') {
      b = xbtn('Demo', six ? 'Load our two example patterns into patterns I-1 and I-2 (chained, in PATTERN PLAY)' : nine ? 'Load our two example patterns into patterns I-1-1 and I-1-2 (block-played, in PATTERN PLAY)' : 'Load our two example patterns into pattern 1 A / B and fill 1', () => DR.demo());
      demoB = b; // (the loop hint goes beside it at start(), in its cell)
      upds.push(s => { const t = DR ? loopHint(s.D, DR.loop()) : null; if (hint.hidden !== !t) hint.hidden = !t; if (t && hint.textContent !== t) hint.textContent = t; });
    } else if (id === 'dr:link') { // (7b §3.8) SYNC 303s: every TB-303 to the song's clock and the 606's swing; hidden with no 303, "303s synced" when all are
      b = xbtn('Sync 303s', 'Switch every TB-303 of the project to SYNC (the song\'s clock, the 606\'s swing) so the two play locked · its notice undoes it', () => { if (!DR.n303().synced) DR.link(); }, 'dr-link');
      upds.push(() => {
        const L = DR ? DR.n303() : { n: 0, synced: true }, on = L.n > 0 && !L.synced, t = L.n > 0 && L.synced ? '303s synced' : 'Sync 303s';
        if (b.hidden !== !(L.n > 0)) b.hidden = !(L.n > 0);
        if (b.textContent !== t) b.textContent = t;
        if (live) { setA(b, 'aria-disabled', on ? null : 'true'); if (b.tabIndex !== (on ? 0 : -1)) b.tabIndex = on ? 0 : -1; }
      });
    }
    if (b && (id === 'dr:toRoll' || id === 'dr:map' || id === 'dr:sounds')) b.setAttribute('aria-haspopup', 'menu');
    return b;
  }
  function release() { for (const r of rels) { try { r(); } catch (err) { console.error(err); } } }
  return {
    widget, show, extra,
    start() { // the first paint now (synchronously: the panel comes back exactly), then the host's changes
      if (demoB && demoB.parentNode && !hint.parentNode) demoB.parentNode.append(hint); // (the strip's free room after DEMO)
      paint();
      dirty(); // (the grid's canvas once the body is mounted)
      if (!live) return;
      offs.push(DR.on(dirty), DR.step(dirty), DR.hold(release));
    },
    release,
    destroy() { if (dead) return; release(); dead = true; if (recheck) clearTimeout(recheck); recheck = null; for (const f of offs.splice(0)) { try { if (typeof f === 'function') f(); } catch (err) { console.error(err); } } },
  };
}

/* ---------------------------------------------------------------- CSS (one <style> per document, the cv-keys pattern) */
const CSS_ID = 'cv-drum-css';
const CSS = `
.inst.hw .hw-c > [aria-disabled="true"], .inst.hw .hw-c > [aria-disabled="true"]::before, .inst.hw .hw-extras [aria-disabled="true"] { pointer-events: none; }
.inst.hw .dr-key, .inst.hw .dr-clear, .inst.hw .dr-tap, .inst.hw .dr-fn, .inst.hw .dr-grp, .inst.hw .dr-pads, .inst.hw .dr-grid > canvas { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
.inst.hw .dr-key[data-lit="on"] > .hw-led, .inst.hw .dr-key[data-lit="head-on"] > .hw-led { background: var(--hw-led, #ff3b2a); box-shadow: 0 0 6px var(--hw-led, #ff3b2a); }
.inst.hw .dr-key[data-lit="flash"] > .hw-led { animation: dr-flash 0.5s steps(1, end) infinite; }
@keyframes dr-flash { 0% { background: var(--hw-led, #ff3b2a); box-shadow: 0 0 6px var(--hw-led, #ff3b2a); } 50% { background: var(--hw-led-off, #3a1512); box-shadow: none; } }
@media (prefers-reduced-motion: reduce) { .inst.hw .dr-key[data-lit="flash"] > .hw-led { animation: none; background: color-mix(in srgb, var(--hw-led, #ff3b2a) 55%, #000); } }
.inst.hw .dr-clear[aria-pressed="true"], .inst.hw .dr-fn[aria-pressed="true"], .inst.hw .dr-start[data-run] { box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.6); filter: brightness(0.88); }
.inst.hw .dr-led[data-lit="flash"] { animation: dr-lflash 0.5s steps(1, end) infinite; }
@keyframes dr-lflash { 0% { background: var(--led-c, #ff3b2a); box-shadow: 0 0 6px var(--led-c, #ff3b2a); } 50% { background: #2a0d0b; box-shadow: none; } }
@media (prefers-reduced-motion: reduce) { .inst.hw .dr-led[data-lit="flash"] { animation: none; background: color-mix(in srgb, var(--led-c, #ff3b2a) 55%, #000); } }
.inst.hw .dr-grid { position: relative; width: ${GRID.w}px; height: ${GRID.h}px; flex: 0 0 auto; }
.inst.hw .dr-grid > canvas { display: block; width: ${GRID.w}px; height: ${GRID.h}px; border-radius: 4px; cursor: pointer; }
.inst.hw .dr-grid > canvas:focus-visible { outline: 2px solid var(--hot, #ffb000); outline-offset: 1px; }
.inst.hw .dr-pads { position: relative; width: ${PADS.w}px; height: ${PADS.h}px; flex: 0 0 auto; touch-action: none; }
.inst.hw .dr-pad { position: absolute; width: ${PADS.pad}px; height: ${PADS.pad}px; border-radius: 6px; cursor: pointer; color: #d8dce2; touch-action: none;
  background: linear-gradient(#2a2e36, #1b1e24); box-shadow: inset 0 0 0 1px #3a3f48, 0 1px 2px rgba(0, 0, 0, 0.6); }
.inst.hw .dr-pad::before { content: attr(data-code); position: absolute; left: 6px; top: 6px; font: 700 11px/1 var(--ui, system-ui); pointer-events: none; }
.inst.hw .dr-pad::after { content: attr(data-name); position: absolute; left: 6px; right: 4px; bottom: 5px; max-height: 18px; overflow: hidden; font: 500 8px/9px var(--ui, system-ui); color: #8e95a1; pointer-events: none; }
.inst.hw .dr-pad[data-smp] { background: radial-gradient(circle at calc(100% - 8.5px) 8.5px, #7fd0ff 2.5px, transparent 2.9px), linear-gradient(#2a2e36, #1b1e24); }
.inst.hw .dr-pad[data-held] { background: linear-gradient(#f0862a, #c4621a); color: #14161a; }
.inst.hw .dr-pad[data-held][data-smp] { background: radial-gradient(circle at calc(100% - 8.5px) 8.5px, #7fd0ff 2.5px, transparent 2.9px), linear-gradient(#f0862a, #c4621a); }
.inst.hw .dr-pad[data-held]::after { color: #3a2410; }
.inst.hw .dr-pad[data-hit="0"] { animation: dr-hit0 0.16s ease-out; }
.inst.hw .dr-pad[data-hit="1"] { animation: dr-hit1 0.16s ease-out; }
@keyframes dr-hit0 { from { box-shadow: inset 0 0 0 2px #ffc58a, 0 0 12px #f0862a; } }
@keyframes dr-hit1 { from { box-shadow: inset 0 0 0 2px #ffc58a, 0 0 12px #f0862a; } }
.inst.hw .dr-pad:focus-visible { outline: 2px solid var(--hot, #ffb000); outline-offset: 1px; }
.inst.hw .dr-xb { position: relative; flex: 1 1 auto; height: 36px; margin: 0 4px; padding: 0 6px; border: 1px solid #343941; border-radius: 6px; background: #1a1d22;
  color: var(--text, #dde1e6); font: 600 11px/1 var(--ui, system-ui); white-space: nowrap; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.inst.hw .dr-xb[aria-pressed="true"] { border-color: var(--hot, #f2a33a); color: var(--hot, #f2a33a); background: #2a2016; }
.inst.hw .dr-rec[aria-pressed="true"] { border-color: #e0461f; color: #ff8a6a; background: #2a1612; }
.inst.hw .dr-xnum { display: flex; align-items: center; justify-content: center; gap: 6px; cursor: ns-resize; touch-action: none; }
.inst.hw .dr-xnum > span { color: var(--mute, #8e95a1); font-weight: 600; text-transform: uppercase; font-size: 9px; letter-spacing: 0.06em; }
.inst.hw .dr-xb:focus-visible { outline: 2px solid var(--hot, #ffb000); outline-offset: 1px; }
.inst.hw .dr-hint { position: absolute; left: calc(100% + 10px); top: 50%; transform: translateY(-50%); width: 320px; font: 500 10px/13px var(--ui, system-ui); color: #f2a33a; pointer-events: none; }
.inst.hw .dr-hint[hidden] { display: none; }
.inst.hw .dr-hint[data-m="tr606"] { left: auto; right: 0; top: auto; bottom: calc(100% + 10px); transform: none; width: 240px; text-align: right; }
.inst.hw .dr-pad[data-sound="ac"] { background: linear-gradient(#3b2b22, #251b15); box-shadow: inset 0 0 0 1px #5a3d2a, 0 1px 2px rgba(0, 0, 0, 0.6); }
.inst.hw .dr-pad[data-sound="ac"][data-held] { background: linear-gradient(#e0461f, #a83214); color: #fff; }
.inst.hw .dr-xb[hidden] { display: none; }
.inst.hw .dr-hold, .inst.hw .dr-tap9 { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
.inst.hw .dr-hold[aria-pressed="true"] { box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.6); filter: brightness(0.88); }
.inst.hw .dr-hold[data-latch] { box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.6), 0 0 0 2px var(--hot, #f2a33a), 0 0 8px var(--hot, #f2a33a); }
.inst.hw .dr-lk[data-lit="flash"] > .hw-led { animation: dr-flash 0.5s steps(1, end) infinite; }
@media (prefers-reduced-motion: reduce) { .inst.hw .dr-lk[data-lit="flash"] > .hw-led { animation: none; background: color-mix(in srgb, var(--hw-led, #ff3b2a) 55%, #000); } }
.inst.hw .dr-key[data-lit="dim"] > .hw-led { background: color-mix(in srgb, var(--hw-led, #ff3b2a) 55%, #2a0d0b); box-shadow: 0 0 3px color-mix(in srgb, var(--hw-led, #ff3b2a) 40%, transparent); }
.inst.hw .dr-dsp { letter-spacing: 0.04em; text-shadow: 0 0 6px color-mix(in srgb, var(--dsp-c, #ff3b2a) 60%, transparent); }
`;
const styledDocs = new WeakSet();
/** The drum widgets' CSS, injected once per document (style.css untouched this stage, §7.4). */
export function ensureCSS(doc) {
  if (!doc || typeof doc.createElement !== 'function') return null;
  let s = typeof doc.getElementById === 'function' ? doc.getElementById(CSS_ID) : null;
  const at = doc.head || doc.documentElement;
  if (!s && !styledDocs.has(doc) && at && typeof at.appendChild === 'function') {
    s = doc.createElement('style');
    s.id = CSS_ID; s.textContent = CSS;
    at.appendChild(s);
    styledDocs.add(doc);
  }
  return s;
}
