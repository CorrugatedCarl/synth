// cv-pads.js — the Pads module (IMPL-8 Part A §1–§10; lane U): a project-level pad grid shown on every track's canvas that
// plays any track (drum hits, notes, chords) and modulates any knob. Two halves:
//   padsHost(deps)  the session state, independent of any DOM (hardware pads play with the module off screen): every pad's
//                   holds (canvas pointers, keys, hardware pads, latches), the reference counts per (target track, note) —
//                   every press sends, the last release ends (D9, review #2) —, the mod values (§5.2–§5.3: a press / release
//                   posts at once, pressure ≤ once a frame), the lights (§6: the own hit at once, the target's activity at
//                   the heard time, ≤ one paint a frame for every module), the hardware echo (§8.4) and learn (§8.3), the
//                   mapping edits (one History step each, the held notes of an edited pad ended first)
//   padsBody(o)     one module's view: the grid on the cv-keys bed (§2.1: o.hit / slide false / each true / at(v, n)), the
//                   footer (✎ Edit · ⚙ · "+N on other tracks" · the hardware dot), Edit mode on the body's own
//                   [data-pads-edit] (never [data-cv-edit]: cv-world's camera edit state, review #3), the pad inspector
//                   (§7.2), the settings popovers (§7.3), the learn UI (Mac only: hidden without Web MIDI)
// Pure helpers for H: moduleSize / moduleJacks (the cvDevices entry: its fixed size, its jacks — review #4), chipText,
// srcLabel, orderOf / defaultsOf (a new module follows the track it is added on, §3.5; an SDS-V's pads in its kit's colours),
// PADS_COLOR (its bar stripe). A mod pad has ONE name everywhere — pads-core padSourceName, "Pads 1 · Kick" (jacks, srcLabel,
// cv-mods' lists).
// Gestures (§2.3, unchanged gesture.js / cv-world.js): every pad is a [data-gesture="music"] zone — two fingers on pads are two
// hits, never a pinch; the gaps, the well, the footer and the bar are not music (a pinch starting there zooms). The chrome's
// buttons act on a tap (a mouse at the press, a finger at its release within 10 px; a pointercancel drops it: a pinch
// starting on a button presses nothing — 7b review lesson), the host's tap helper when it gives one (o.tap).
// A mod pad's inline jack anchor is a corner dot, a CHILD of the pad (review #20): drawn and pressable only in Edit mode
// (visibility: hidden in play mode — still measured by cv-module, never display: none).
// The CSS is injected once per document (ensureCSS, cv-keys' pattern: no style.css edit). Plain ES module: no DOM at module
// top level (node imports it), imports carry ?v=9.
//
// padsHost(deps) — what H (main.js) gives (every dep optional; a missing one is a no-op):
//   project()                       → the project (reads / writes project.pads, reads project.tracks)
//   noteOn(tr, n, v, ts, src)       a note on track id tr: main's noteOn(n, v, src, ts, [track], { rec: 'target' }) — src 'pd<k>'
//   noteOff(tr, n, ts, src)         main's noteOff(n, src, ts)        (k: this host's session number of tr — no ':' in it)
//   ctl(tr, kind, v, ts)            main's ctl(kind, v, 0, ts, [track]) — the Pencil's aftertouch on note / chord targets
//   modVal(src, v)                  'pd1.p12' → every track holding rows of it (padTracks) → modVal(t, 'pd1', 'p12', v)
//   drumRec(tr, s, v, ts)           DRUM.rec (the machine's REC rules decide)        drumOf(t, devId) → the drum record
//   drumLit(tr, fn(mask)) → off     DRUM.api(view).lit (sound-id bits at the heard time)      monSync()  monitors.sync()
//   inputSub(tr, fn(n, on)) → off   the track's live input notes (an inputSubs entry)          heardTick() → curTick()
//   live(id) → bool                 the module is on screen and unfolded (cvLive): a hidden one lights nothing
//   step(label)                     opens ONE History step (the snapshot before an edit)      undo()  (a notice's "tap to undo")
//   changed({ id, drop })           after an edit: persist, the canvas re-synced (size, jacks, title), `drop` — the row sources
//                                   whose rows go in the same step (a pad's Modulation switched off, review #31)
//   rowsOf(src) → [{ track, label }]  a mod pad's rows on every track (the inspector lists them)
//   learnPad() → Promise<{ port, ch, n, cc } | null>   midi's     cancelLearn()  midi's / main's cancelLearn(true)
//   midiOk() → bool                 Web MIDI present (else every hardware item is hidden / disabled, §8.1)
//   inputs() / outputs() → names    hwOut(port, bytes)  midi.send     nextNote(fn(n)) → cancel  ("Play it": the next input note)
//   jump(tr, id)                    select track tr and reveal module id there (the "+N on other tracks" menu)
//   modelName(model) → text         notice(text, ms, onTap?)     confirm(text) → bool     raf(fn), now()
// → { module, light, press, lift, at, attach, view, edit, learn, learnAll, stopLearn, learning, forget, value, wants, midiIn,
//     ports, release, rebuild, resync, transport, endModule, endTrack, hwDark, warnOf, rowsOf, others, jump, tracks, … }.
import * as PC from './pads-core.js?v=9';
import * as wk from './wk.js?v=9';
import { bed } from './cv-keys.js?v=9';
import { UI as DRUM_UI, COLORV } from './cv-drum.js?v=9';
import { PERS } from './drum-core.js?v=9';

/** The module's bar stripe (a teal of the pad palette: no track's colour — it is the project's). */
export const PADS_COLOR = PC.COLORS[PC.C_TEAL].lit;
/** §6.1: lit decays to idle over FLASH_MS after its cause ends (the CSS transition / flash; a hardware flash's revert). */
export const FLASH_MS = 120;
/** Light "Both": a pad's own flash and the monitor's echo of the same hit (the output latency, a Bluetooth one too) are one flash. */
export const ECHO_MS = 400;
/** Edit mode: a drag starts past SLOP px (finger / mouse); held still COPY_MS before it moves, a drag copies (§7.1). */
export const SLOP = Object.freeze({ touch: 10, mouse: 4 }), COPY_MS = 450;
/** The module's fold-free extras: the pad well's margin around the grid (world px). */
export const WELL_PAD = 8;
/** §8.1: the hardware items' text where Web MIDI is absent (the iPad). */
export const NO_MIDI = 'Hardware pad controllers need a browser with Web MIDI — Chrome or Edge on a Mac. iPad browsers have none.';
/** §8.4: the generic light-back scheme in one line. */
export const GEN_DOC = 'Lights the pad of each learned note by sending that note back at velocity 127 — works with controllers whose pads light from incoming notes.';

const fin = x => typeof x === 'number' && isFinite(x);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const persOf = m => (typeof m === 'string' && own(PERS, m) ? PERS[m] : null);
const NK = (tr, n) => tr + '\u0000' + n;
const json = x => JSON.stringify(x);

/* ---------------------------------------------------------------- pure helpers (H's cvDevices entry, the bar chip, defaults) */
/** The bar chip: '4 × 4' (no-break spaces: a 1-column module's narrow bar never wraps it). */
export const chipText = M => (isObj(M) ? M.rows + ' × ' + M.cols : '');
/** The module's fixed size (host size(key), §1.3): pads-core footprint → { fixed: { w, h } }. */
export function moduleSize(M) { const F = PC.footprint(M && M.rows, M && M.cols, M && M.size); return { fixed: { w: F.w, h: F.h } }; }
// the project the last host reads (module-level: the cvDevices entry's moduleJacks has the module, not always the project — the
// target labels need the tracks); one host per app
let hostProj = null;
const projNow = () => { try { const p = hostProj ? hostProj() : null; return isObj(p) ? p : null; } catch (err) { return null; } };
/** A mod source's label (§5.1, H's modLabel): pads-core's padSourceName — "<module name> · <pad label | first target's | Pad k>",
 * the one wording of the Mod list, Connect to… and the jacks; '' when no such pad. project: the tracks (absent: the host's). */
export function srcLabel(pads, src, project) {
  const q = PC.padOfSrc(src), M = q && Array.isArray(pads) ? pads.find(m => isObj(m) && m.id === q.id) : null;
  return M ? PC.padSourceName(project || projNow(), M, q.i) : '';
}
/** The jacks of the cvDevices entry (§5.4, §9; review #4): every mod pad's inline 'p<i>' (slot order; hide: outside the grid —
 * kept in the set, so a Grid… change rebuilds nothing, its fallback dot hidden too; its label srcLabel's + " out", refreshed
 * by cv-module at every sync) and the 'notes' jack (kind 'note', always there: the note cables leave from it). */
export function moduleJacks(M, title, project) {
  const T = title || (isObj(M) && M.name) || 'Pads', P = project || projNow(), out = [];
  if (isObj(M) && Array.isArray(M.pads)) M.pads.forEach((p, i) => { if (isObj(p) && p.mod) out.push({ id: 'p' + i, side: 'inline', kind: 'mod', label: PC.padSourceName(P, M, i) + ' out', hide: !PC.visible(M, i) }); });
  out.push({ id: 'notes', side: 'right', kind: 'note', label: T + ' notes' });
  return out;
}
/** A drum machine's pad order and shape (§3.5; review #23): cv-drum UI[m].pads (top row first) on 4 columns; the SDS-V 1 × 5
 * (its order P1's UI.sdsv when there, else its sids); null for anything that is no drum machine. */
export function orderOf(model) {
  const U = typeof model === 'string' && own(DRUM_UI, model) ? DRUM_UI[model] : null, ord = U && Array.isArray(U.pads) ? U.pads : null;
  if (model === 'sdsv') return { order: ord && ord.length === 5 ? ord : null, cols: 5 };
  return ord ? { order: ord, cols: 4 } : persOf(model) ? { order: null, cols: 4 } : null;
}
// a track's instruments, the primary first (pads-core's order)
function insts(t) {
  const d = isObj(t) && isObj(t.dev) ? t.dev : {}, syn = Object.keys(d).filter(k => isObj(d[k]) && d[k].kind === 'synth');
  return own(d, t.prim) && syn.includes(t.prim) ? [t.prim, ...syn.filter(k => k !== t.prim)] : syn;
}
/** The first drum machine of a track (primary first): its device id, or null. */
export function drumDev(t) { for (const k of insts(t)) if (persOf(t.dev[k].model)) return k; return null; }
/** A machine's own pad colours by sound key (§6.4): the SDS-V's — its hex kit's (cv-drum COLORV by sound id) as the nearest palette
 * entries —; null for the others (the family colours). → { c: { sound key: colour } } for pads-core defaultsFor / fill. */
export function lookOf(model) {
  const P = model === 'sdsv' ? persOf(model) : null;
  if (!P || !Array.isArray(COLORV)) return null;
  const c = {};
  for (const sid of P.sids) if (typeof COLORV[sid] === 'string') c[P.sounds[sid]] = PC.nearestColor(COLORV[sid]);
  return { c };
}
/** A new module's pads following the track it is added on (§3.5, Q3): a drum machine → its pad order and shape (an SDS-V's
 * pads in its kit's colours); else a chromatic run from C3 on 4 × 4 → { rows, cols, pads } for pads-core newModule / cv-model
 * addPads. drumOf: main's. */
export function defaultsOf(track, drumOf) {
  const k = drumDev(track);
  if (!k) return PC.defaultsFor(track, null);
  const dv = track.dev[k], D = typeof drumOf === 'function' ? drumOf(track, k) : null, O = orderOf(dv.model) || { order: null, cols: 4 };
  return PC.defaultsFor(track, isObj(D) ? D : { m: dv.model }, O.order, O.cols, lookOf(dv.model));
}
// a track whose primary sound is a drum machine: its pads light from the monitor only (§6.2: no double light)
const drumTrack = t => { const L = insts(t); return !!L.length && !!persOf(t.dev[L[0]].model); };
// a pad that plays notes (latch: note / chord targets only, §3.1)
const plays = p => isObj(p) && Array.isArray(p.t) && p.t.some(x => isObj(x) && x.k !== 'drum');

/* ================================================================ the host */
/**
 * The Pads host (§4, §5, §6, §8; deps: the header). Holds are keyed by their source: 'c<v>:<id>:<i>' a body's canvas pointers
 * (the bed: an on per pointer, one off at the pad's last), 'k<v>:<id>:<i>' a key, 'h:<port>\0<ch>:<n>:<cc>' a hardware pad,
 * 'l:<id>:<i>' a latch (the next tap releases); each hit keeps the (track, note) pairs it sent, so an edit never mismatches
 * an off. @param {object} deps @returns {object}
 */
export function padsHost(deps) {
  const D = deps || {};
  hostProj = () => call(D.project);
  const call = (f, ...a) => { if (typeof f !== 'function') return undefined; try { return f(...a); } catch (err) { console.error(err); return undefined; } };
  const now = typeof D.now === 'function' ? D.now : () => (globalThis.performance && typeof globalThis.performance.now === 'function' ? globalThis.performance.now() : Date.now());
  const raf = typeof D.raf === 'function' ? D.raf : f => (typeof globalThis.requestAnimationFrame === 'function' ? globalThis.requestAnimationFrame(f) : setTimeout(() => f(now()), 16));
  const proj = () => { const p = call(D.project); return isObj(p) ? p : null; };
  const list = () => { const p = proj(); return p && Array.isArray(p.pads) ? p.pads : []; };
  const modOf = id => list().find(M => isObj(M) && M.id === id) || null;
  const tracks = () => { const p = proj(); return p && Array.isArray(p.tracks) ? p.tracks : []; };
  const trackOf = tr => tracks().find(t => isObj(t) && t.id === tr) || null;
  /* ---- the note path: session numbers, reference counts per (track, note), holds */
  const sess = new Map();
  let sessN = 0;
  const srcOf = tr => { let k = sess.get(tr); if (!k) sess.set(tr, (k = ++sessN)); return 'pd' + k; };
  const cnt = new Map(), holds = new Map(), padHolds = new Map();
  function noteUp(tr, n, v, ts) { const k = NK(tr, n); cnt.set(k, (cnt.get(k) || 0) + 1); call(D.noteOn, tr, n, v, ts, srcOf(tr)); }
  function noteDown(tr, n, ts) { // the last holder's release ends it (a reset count: already ended — nothing)
    const k = NK(tr, n), c = cnt.get(k) || 0;
    if (c > 1) { cnt.set(k, c - 1); return; }
    if (!c) return;
    cnt.delete(k);
    call(D.noteOff, tr, n, ts, srcOf(tr));
  }
  /** A hit of slot i of module id at v (0…1): its targets resolved now, every (track, note) sent (a held note is re-struck:
   * main's held retrigger), drum REC per drum target, the mod source's press; a latch pad held until its next tap. */
  function press(id, i, v, ts, key, port) {
    const M = modOf(id);
    if (!M || !PC.visible(M, i) || typeof key !== 'string') return false;
    const pad = M.pads[i], pk = id + ':' + i;
    if (isObj(pad) && pad.latch && plays(pad)) {
      const lk = 'l:' + pk;
      if (holds.has(lk)) { endKey(lk, ts); return true; } // (the next tap releases: no new hit)
      key = lk;
    }
    const vv = clamp(fin(v) ? v : 1, 0, 1), R = PC.resolve(pad, proj(), D.drumOf), notes = [], at = [];
    for (const h of R.hits) { for (const n of h.ns) { noteUp(h.tr, n, vv, ts); notes.push([h.tr, n]); } if (h.at) at.push(h.tr); }
    if (isObj(pad)) pad.t.forEach((x, j) => { if (x.k === 'drum' && !R.warn.some(w => w.i === j)) call(D.drumRec, x.tr, x.s, vv, ts); });
    const src = isObj(pad) && pad.mod ? PC.padSrc(id, i) : null, hd = { id, i, notes, at, src, port: port == null ? null : String(port), dead: false };
    let L = holds.get(key);
    if (!L) holds.set(key, (L = []));
    L.push(hd);
    padHolds.set(pk, (padHolds.get(pk) || 0) + 1);
    if (src) modEv(src, pad.mod, { e: 'press', v: vv });
    if (lightHit(M) && !PC.isOff(pad)) { ls(id, i).f++; hwFlash(id, i); if (lightFol(M)) own.set(pk, now()); }
    dirty(id, i);
    return true;
  }
  function endHold(hd, ts) {
    if (hd.dead) return;
    hd.dead = true;
    for (const [tr, n] of hd.notes) noteDown(tr, n, ts);
    for (const tr of hd.at) atEnd(tr, ts); // (R1-B: the track's pressure back to 0 once no hold carries it any more)
    const pk = hd.id + ':' + hd.i, c = (padHolds.get(pk) || 0) - 1;
    if (c > 0) padHolds.set(pk, c); else padHolds.delete(pk);
    if (hd.src && c <= 0) modEv(hd.src, mspec.get(hd.src), { e: 'release' }); // (the pad's last holder: lo, a toggle unchanged)
    dirty(hd.id, hd.i);
  }
  function endKey(key, ts) { const L = holds.get(key); if (!L) return false; holds.delete(key); for (const hd of L) endHold(hd, ts); return true; }
  /* ---- the mod values (§5.2, §5.3): per source { v, on }; a press / release posts at once, pressure ≤ once a frame */
  const mstate = new Map(), mspec = new Map(), mq = new Map();
  function modEv(src, mod, ev) {
    if (!isObj(mod)) return;
    mspec.set(src, mod);
    const s0 = mstate.get(src) || null, s1 = PC.modValue(mod, ev, s0), v0 = s0 ? s0.v : mod.lo;
    mstate.set(src, s1);
    if (ev.e === 'at') { if (s1.v !== v0) { mq.set(src, s1.v); due(); } } else if (ev.e === 'press' || s1.v !== v0 || mq.has(src)) { mq.delete(src); call(D.modVal, src, s1.v); } // (a toggle's release: nothing)
    const q = PC.padOfSrc(src);
    if (q) dirty(q.id, q.i);
  }
  function value(src) {
    const s = mstate.get(src);
    if (s) return s.v;
    const q = PC.padOfSrc(src), M = q && modOf(q.id), p = M && M.pads[q.i];
    return isObj(p) && p.mod ? p.mod.lo : 0;
  }
  /** The stored press / release state follows the edited pads (R1-A): a source whose pad is gone, lost its Modulation or changed
   * it (range, mode) is at rest again — lo of the new range —, except a toggle left on in a toggle (keepOn: on at the new hi);
   * the table gets the changed value (a restore's memo-hit compile posts no vals). Holds of a changed pad ended before (endStale). */
  function modSync(keepOn) {
    for (const [src, s0] of [...mstate]) {
      const q = PC.padOfSrc(src), M = q && modOf(q.id), p = M && M.pads[q.i], m = isObj(p) && p.mod ? p.mod : null, old = mspec.get(src);
      if (m && old && json(m) === json(old)) continue;
      mq.delete(src);
      if (m && old && keepOn && m.m === 'tog' && old.m === 'tog' && s0.on) mstate.set(src, { v: m.hi, on: true }); else mstate.delete(src);
      if (m) mspec.set(src, m); else mspec.delete(src);
      const v1 = value(src);
      if (m && v1 !== s0.v) call(D.modVal, src, v1);
      if (q) dirty(q.id, q.i);
    }
  }
  /* ---- the Pencil's aftertouch (§2.4): the pad's note / chord tracks (the lift's 0 to where the pressure went), a press-mode
   * mod pad; ≤ one ctl per track a frame */
  const atQ = new Map(), atTo = new Map(), atCur = new Map(); // atCur: track → the pressure last queued, while above 0 (a 0 is owed)
  const atSet = (tr, vv, ts) => { atQ.set(tr, () => call(D.ctl, tr, 'at', vv, ts)); if (vv > 0) atCur.set(tr, vv); else atCur.delete(tr); due(); };
  // a hold that carried a track's pressure ended: when no other live hold carries it, the track's channel aftertouch goes back to 0
  function atEnd(tr, ts) {
    if (!(atCur.get(tr) > 0)) return;
    for (const L of holds.values()) for (const h of L) if (!h.dead && h.at.includes(tr)) return;
    atSet(tr, 0, ts);
  }
  function at(id, i, v, ts) {
    const pk = id + ':' + i, trs = new Set();
    for (const L of holds.values()) for (const hd of L) if (!hd.dead && hd.id === id && hd.i === i) for (const tr of hd.at) trs.add(tr);
    if (!(v > 0)) { for (const tr of atTo.get(pk) || []) trs.add(tr); atTo.delete(pk); } else if (trs.size) atTo.set(pk, new Set(trs));
    const vv = clamp(fin(v) ? v : 0, 0, 1);
    for (const tr of trs) atSet(tr, vv, ts);
    const M = modOf(id), pad = M && M.pads[i];
    if (isObj(pad) && pad.mod && pad.mod.m === 'press') modEv(PC.padSrc(id, i), pad.mod, { e: 'at', at: vv });
  }
  /* ---- lights (§6): per pad { f: its flashes (own hits, the monitor's), fol: a target sounding }; ≤ one paint a frame */
  const LS = new Map(), own = new Map(); // own: 'id:i' → when the pad's own hit flashed it (Both: the monitor's echo of it adds none)
  const ls = (id, i) => { const k = id + ':' + i; let s = LS.get(k); if (!s) LS.set(k, (s = { f: 0, fol: false })); return s; };
  const lightHit = M => !M || M.light !== 'follow', lightFol = M => !!M && M.light !== 'hit';
  let learning = null;
  function light(id, i) {
    const M = modOf(id), pad = M && PC.visible(M, i) ? M.pads[i] : null, S = LS.get(id + ':' + i), off = PC.isOff(pad);
    const held = (padHolds.get(id + ':' + i) || 0) > 0, src = isObj(pad) && pad.mod ? PC.padSrc(id, i) : null;
    return { l: off ? 'off' : held ? 'held' : S && S.fol && lightFol(M) ? 'lit' : 'idle', f: S ? S.f : 0, held,
      b: src ? PC.modBright(pad.mod, value(src)) : null, learn: !!learning && learning.id === id && learning.i === i };
  }
  const views = new Set(), DIRTY = new Map();
  let pend = false, inFlush = false, paints = 0;
  function dirty(id, i) { let S = DIRTY.get(id); if (!S) DIRTY.set(id, (S = new Set())); S.add(i); due(); }
  function dirtyAll(id) { const M = modOf(id); if (M) for (const i of PC.visibleSlots(M)) dirty(id, i); }
  function due() { if (pend || inFlush) return; pend = true; raf(flush); }
  function flush() {
    inFlush = true;
    try {
      if (rolling()) rollCheck();
      for (const [k, t] of hwT) if (t <= now()) { hwT.delete(k); const j = k.lastIndexOf(':'); dirty(k.slice(0, j), +k.slice(j + 1)); }
      for (const [src, v] of mq) call(D.modVal, src, v);
      mq.clear();
      for (const f of atQ.values()) f();
      atQ.clear();
      if (DIRTY.size) {
        paints++;
        const L = [...DIRTY];
        DIRTY.clear();
        for (const [id, S] of L) { for (const V of views) if (V.id === id) call(V.paint, S); hwEcho(id, S); }
      }
    } finally { inFlush = false; pend = false; }
    if (DIRTY.size || mq.size || atQ.size || rolling() || hwT.size) due();
  }
  /* ---- following the targets (§6.2): the drum monitors' lit bits, live input notes, roll playback at the heard tick */
  let IDX = { drum: new Map(), note: new Map(), pn: new Map() };
  const dsub = new Map(), nsub = new Map(), liveN = new Map(), rollOn = new Set(), rollIx = new Map();
  let playing = false;
  const shownIds = () => { const S = new Set(); for (const V of views) if (call(D.live, V.id) !== false) S.add(V.id); return S; };
  function index() {
    const drum = new Map(), note = new Map(), pn = new Map();
    const add = (m, a, b, v) => { let x = m.get(a); if (!x) m.set(a, (x = new Map())); let L = x.get(b); if (!L) x.set(b, (L = [])); L.push(v); };
    for (const id of shownIds()) {
      const M = modOf(id);
      if (!M || !lightFol(M)) continue;
      for (const i of PC.visibleSlots(M)) {
        const pad = M.pads[i];
        if (!isObj(pad)) continue;
        for (const x of pad.t) {
          const t = trackOf(x.tr);
          if (!t) continue;
          if (x.k === 'drum') {
            const r = PC.drumNote(t, x.s, D.drumOf), P = r.n >= 0 ? persOf(r.model) : null, sid = P ? P.sounds.indexOf(x.s) : -1;
            if (sid >= 0) add(drum, x.tr, sid, [id, i]);
          } else if (!drumTrack(t)) for (const n of PC.targetNotes(x)) { add(note, x.tr, n, [id, i]); const k = id + ':' + i; let L = pn.get(k); if (!L) pn.set(k, (L = [])); L.push(NK(x.tr, n)); }
        }
      }
    }
    IDX = { drum, note, pn };
  }
  function resync() {
    index();
    let changed = false;
    for (const [tr, off] of [...dsub]) if (!IDX.drum.has(tr)) { call(off); dsub.delete(tr); changed = true; }
    for (const tr of IDX.drum.keys()) if (!dsub.has(tr)) { const off = call(D.drumLit, tr, mask => onMask(tr, mask)); dsub.set(tr, typeof off === 'function' ? off : null); changed = true; }
    for (const [tr, off] of [...nsub]) if (!IDX.note.has(tr)) { call(off); nsub.delete(tr); for (const k of [...liveN.keys()]) if (k.startsWith(tr + '\u0000')) liveN.delete(k); }
    for (const tr of IDX.note.keys()) if (!nsub.has(tr)) { const off = call(D.inputSub, tr, (n, on) => onNote(tr, n, on)); nsub.set(tr, typeof off === 'function' ? off : null); }
    for (const [k, S] of LS) if (S.fol && !IDX.pn.has(k)) { S.fol = false; const j = k.lastIndexOf(':'); dirty(k.slice(0, j), +k.slice(j + 1)); }
    for (const k of IDX.pn.keys()) refreshFol(k);
    if (changed) call(D.monSync);
    if (rolling()) due();
  }
  function onMask(tr, mask) {
    const S = IDX.drum.get(tr);
    if (!S || !(mask > 0)) return;
    for (const [sid, L] of S) if ((mask >> sid) & 1) for (const [id, i] of L) {
      const k = id + ':' + i, t0 = own.get(k);
      if (t0 != null) { if (now() - t0 < ECHO_MS) continue; own.delete(k); } // (its own hit's echo at the heard time: already flashed)
      ls(id, i).f++; hwFlash(id, i); dirty(id, i);
    }
  }
  function refreshFol(pk) {
    const L = IDX.pn.get(pk) || [], on = L.some(k => liveN.has(k) || rollOn.has(k)), j = pk.lastIndexOf(':'), id = pk.slice(0, j), i = +pk.slice(j + 1), S = ls(id, i);
    if (S.fol === on) return;
    S.fol = on;
    dirty(id, i);
  }
  const padsAt = (tr, n) => { const m = IDX.note.get(tr), L = m && m.get(n); return L || []; };
  function onNote(tr, n, on) {
    const k = NK(tr, n), c = liveN.get(k) || 0;
    if (on) liveN.set(k, c + 1); else if (c > 1) liveN.set(k, c - 1); else liveN.delete(k);
    for (const [id, i] of padsAt(tr, n)) refreshFol(id + ':' + i);
  }
  const rolling = () => playing && IDX.note.size > 0;
  // a track's roll notes by pitch: [[start, end], …] by start (rebuilt when t.notes changes: perfValue's cache rule)
  function rollOf(t) {
    const N = Array.isArray(t.notes) ? t.notes : [], c = rollIx.get(t.id);
    if (c && c.ref === N && c.len === N.length) return c.m;
    const m = new Map();
    for (const x of N) if (isObj(x) && fin(x.t) && fin(x.d) && fin(x.n)) { let L = m.get(x.n); if (!L) m.set(x.n, (L = [])); L.push([x.t, x.t + x.d]); }
    for (const L of m.values()) L.sort((a, b) => a[0] - b[0]);
    rollIx.set(t.id, { ref: N, len: N.length, m });
    return m;
  }
  function sounds(L, tick) {
    if (!L) return false;
    let lo = 0, hi = L.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (L[m][0] <= tick) lo = m + 1; else hi = m; }
    for (let j = lo - 1; j >= 0 && j >= lo - 8; j--) if (L[j][1] > tick) return true;
    return false;
  }
  function rollCheck() {
    const tick = +call(D.heardTick);
    if (!fin(tick)) return;
    for (const [tr, ns] of IDX.note) {
      const t = trackOf(tr), m = t ? rollOf(t) : null;
      for (const n of ns.keys()) {
        const k = NK(tr, n), on = !!m && sounds(m.get(n), tick);
        if (on === rollOn.has(k)) continue;
        if (on) rollOn.add(k); else rollOn.delete(k);
        for (const [id, i] of ns.get(n)) refreshFol(id + ':' + i);
      }
    }
  }
  function transport(on) {
    playing = !!on;
    if (!playing && rollOn.size) { const L = [...rollOn]; rollOn.clear(); for (const k of L) { const j = k.indexOf('\u0000'); for (const [id, i] of padsAt(k.slice(0, j), +k.slice(j + 1))) refreshFol(id + ':' + i); } }
    if (rolling()) due();
  }
  /* ---- the hardware echo (§8.4): per learned note pad of a 'gen' module, on a state change, ≤ one message a pad a frame */
  const hwSent = new Map(), hwT = new Map();
  const genOf = M => !!M && isObj(M.out) && M.out.prof === 'gen';
  function hwFlash(id, i) {
    const M = modOf(id), p = M && M.pads[i];
    if (genOf(M) && isObj(p) && p.hw && !p.hw.cc) { hwT.set(id + ':' + i, now() + FLASH_MS); dirty(id, i); }
  }
  function hwSend(M, i, st) {
    const p = M.pads[i], b = PC.echo('gen', p, st), k = M.id + ':' + i;
    if (!b) return;
    const s = b.join(',');
    if (hwSent.get(k) === s) return;
    hwSent.set(k, s);
    call(D.hwOut, (M.out && M.out.port) || p.hw.port, b);
  }
  function hwEcho(id, S) {
    const M = modOf(id);
    if (!genOf(M)) return;
    for (const i of S) {
      const p = M.pads[i];
      if (!isObj(p) || !p.hw || p.hw.cc || !PC.visible(M, i)) continue;
      const L = light(id, i), t = hwT.get(id + ':' + i);
      hwSend(M, i, L.l === 'held' || L.l === 'lit' || (t != null && t > now()) ? 'lit' : 'idle');
    }
  }
  /** Every learned pad of module id (all without) sent velocity 0 once (§8.4: a delete, a hidden page, a switch to Off). */
  function hwDark(id) {
    for (const M of list()) {
      if (!isObj(M) || (id != null && M.id !== id) || !genOf(M)) continue;
      M.pads.forEach((p, i) => { if (isObj(p) && p.hw && !p.hw.cc) { hwSent.delete(M.id + ':' + i); hwSend(M, i, 'off'); } });
    }
  }
  /* ---- hardware input (§8.2, M's padIn): a bound pad plays; a hidden one swallows (inert); the rest is today's dispatch */
  const hwKey = (port, ch, n, cc) => 'h:' + port + '\u0000' + ch + ':' + n + ':' + cc;
  function midiIn(e, port, ts) {
    if (!isObj(e)) return false;
    const cc = e.k === 'cc' ? 1 : 0, n = cc ? e.cc : e.n, P = String(port == null ? '' : port);
    if (!(e.k === 'on' || e.k === 'off' || e.k === 'pat' || cc)) return false;
    const b = PC.bindOf(list(), P, e.ch, n, cc);
    if (!b) return false;
    if (b.hidden) return true;
    const key = hwKey(P, e.ch, n, cc), M = modOf(b.id), pad = M && M.pads[b.i];
    if (e.k === 'pat') { at(b.id, b.i, clamp(+e.v || 0, 0, 1), ts); return true; }
    const vel = e.k === 'on' ? Math.round(clamp(+e.v || 0, 0, 1) * 127) : cc ? e.val | 0 : 0;
    if (vel > 0) { if (cc && holds.has(key)) return true; press(b.id, b.i, PC.hitVel(M, pad, { hw: vel }), ts, key, P); } // (a CC pad streams while pressed)
    else endKey(key, ts);
    return true;
  }
  /** The inputs now (M's ports hook): a hardware hold whose port went away ends (D9; review #9); port '' never. */
  function ports(names) {
    const S = new Set(Array.isArray(names) ? names.map(String) : []);
    for (const [key, L] of [...holds]) if (key.startsWith('h:') && L.some(h => h.port && !S.has(h.port))) endKey(key);
  }
  /* ---- learn (§8.3; midi's learnPad: the adapter owns the timeout and Escape) */
  let learnRun = 0;
  function learn(id, i) {
    const M = modOf(id);
    if (!M || !PC.visible(M, i) || typeof D.learnPad !== 'function') return Promise.resolve(null);
    const run = ++learnRun;
    learning = { id, i };
    dirty(id, i);
    let p;
    try { p = Promise.resolve(D.learnPad()); } catch (err) { p = Promise.resolve(null); }
    return p.then(b => {
      if (run !== learnRun) return null;
      learning = null;
      dirty(id, i);
      if (!isObj(b)) return null;
      let moved = null;
      edit('Learn pad ' + PC.padNo(modOf(id) || M, i), pads => { const r = PC.rebind(pads, id, i, b); moved = r.moved; return r.pads; });
      if (moved && !(moved.id === id && moved.i === i)) { const M2 = modOf(moved.id); call(D.notice, 'That hardware pad moved here from ' + (M2 ? M2.name + ' · pad ' + PC.padNo(M2, moved.i) : 'another pad'), 3000); }
      return b;
    }, () => { if (run === learnRun) { learning = null; dirty(id, i); } return null; });
  }
  /** "Learn the visible pads in order" (§8.3): pad 1, then 2 … until a learn ends with nothing (Escape, the timeout). */
  function learnAll(id) {
    const M = modOf(id);
    if (!M) return Promise.resolve(0);
    const S = PC.visibleSlots(M);
    let k = 0;
    const next = () => (k < S.length ? learn(id, S[k]).then(b => { if (!b) return k; k++; return next(); }) : Promise.resolve(k));
    return next();
  }
  function stopLearn() { learnRun++; const L = learning; learning = null; if (L) dirty(L.id, L.i); call(D.cancelLearn); }
  /* ---- edits (§10.3): one History step each; the held pads whose mapping changed (or that are hidden / gone) end first */
  const mapOf = p => (isObj(p) ? json([p.t, p.mod, p.latch]) : '');
  function endStale(before, after, ts) {
    const find = (A, id) => A.find(m => isObj(m) && m.id === id) || null;
    for (const [key, L] of [...holds]) {
      const keep = [];
      for (const hd of L) {
        const a = find(before, hd.id), b = find(after, hd.id);
        if (!b || !PC.visible(b, hd.i) || mapOf(a && a.pads[hd.i]) !== mapOf(b.pads[hd.i])) endHold(hd, ts); else keep.push(hd);
      }
      if (keep.length) holds.set(key, keep); else holds.delete(key);
    }
  }
  /**
   * An edit of project.pads as ONE History step: fn(a deep copy of project.pads) → the new list (normPads'd); nothing when
   * unchanged. o = { drop: [src] (their rows go in the same step), undo: true (a notice "tap to undo") }. → true when applied.
   */
  function edit(label, fn, o) {
    const p = proj();
    if (!p) return false;
    const before = Array.isArray(p.pads) ? p.pads : [];
    let next;
    try { next = fn(JSON.parse(json(before))); } catch (err) { console.error(err); return false; }
    next = PC.normPads(next);
    if (json(next) === json(before)) return false;
    call(D.step, String(label || 'Edit pads'));
    p.pads = next;
    endStale(before, next); // (a module gone: its holds too)
    modSync(true); // (a mod pad's value follows its edited range / mode — R1-A)
    for (const V of [...views]) call(V.sync);
    resync();
    for (const M of next) dirtyAll(M.id);
    call(D.changed, { id: o && o.id, drop: o && Array.isArray(o.drop) ? o.drop.slice() : [] });
    if (o && o.undo) call(D.notice, label + ' — tap to undo', 4000, () => call(D.undo));
    return true;
  }
  /** After Undo / Redo / load (§10.3): every note ended (hardware too), the views rebuilt from project.pads. */
  function rebuild() {
    release({ hw: true });
    modSync(false); // (the restored pads' rest values to the tables)
    learnRun++; learning = null;
    for (const V of [...views]) call(V.sync);
    resync();
    for (const M of list()) dirtyAll(M.id);
  }
  /** The holds of module id end (its delete, D9: H calls hwDark(id) first, then this, then removePads). */
  function endModule(id, ts) { for (const [key, L] of [...holds]) if (L.some(h => h.id === id)) endKey(key, ts); }
  /** A track deleted: every hold's notes on it end (the rest of the hold stays). */
  function endTrack(tr, ts) {
    for (const [key, L] of [...holds]) {
      const keep = [];
      for (const hd of L) {
        if (!hd.dead && hd.notes.some(x => x[0] === tr)) {
          for (const [t2, n] of hd.notes) if (t2 === tr) noteDown(t2, n, ts);
          hd.notes = hd.notes.filter(x => x[0] !== tr); hd.at = hd.at.filter(x => x !== tr);
          if (!hd.notes.length && !hd.src) { endHold(hd, ts); continue; } // (nothing of it sounds any more: no longer held)
        }
        keep.push(hd);
      }
      if (keep.length) holds.set(key, keep); else holds.delete(key);
    }
    atQ.delete(tr); atCur.delete(tr);
  }
  /**
   * Everything a body or a key holds ends (a blur, a hidden page, applyRestore, a track deleted, a track switch); o.hw: the
   * hardware pads too and the counts reset (panic, power off — before main's held loops, review #7).
   */
  function release(o) {
    const hw = !!(o && o.hw);
    for (const V of [...views]) call(V.release);
    for (const key of [...holds.keys()]) if (hw || !key.startsWith('h:')) endKey(key);
    if (hw) { cnt.clear(); padHolds.clear(); for (const L of holds.values()) for (const h of L) h.dead = true; holds.clear(); }
    for (const f of atQ.values()) f(); // (R1-B: the beds' last 0s and the holds' owed ones go out now, not dropped)
    atQ.clear();
  }
  /* ---- the bodies */
  let viewN = 0;
  /** A body registers (V: { id, paint(slots), release(), sync() }) → its number (V.n) and an off (its holds end). */
  function attach(V) {
    V.n = ++viewN;
    views.add(V);
    resync();
    dirtyAll(V.id);
    return () => {
      if (!views.delete(V)) return;
      const pre = ['c' + V.n + ':', 'k' + V.n + ':'];
      for (const key of [...holds.keys()]) if (pre.some(s => key.startsWith(s))) endKey(key);
      resync();
    };
  }
  const UIS = new Map();
  /** A module's session UI state (kept across a module rebuild — a jack set changed, cv-module.js:1146): Edit mode, the
   * selection, the inspector, the roving focus. */
  const view = id => { let s = UIS.get(id); if (!s) UIS.set(id, (s = { edit: false, sel: [], insp: false, focus: 0 })); return s; };
  /** A pad's warning (§3.3: "No Kick on “Drums” any more"), '' when fine. */
  function warnOf(id, i) {
    const M = modOf(id), pad = M && M.pads[i];
    if (!isObj(pad) || !pad.t.length) return '';
    const R = PC.resolve(pad, proj(), D.drumOf);
    return R.warn.length ? R.warn.map(w => w.text).join(' · ') : '';
  }
  /** The tracks other than `cur` the visible pads play: [{ tr, name, n (pads) }] (§9: "+N on other tracks"). */
  function others(id, cur) {
    const M = modOf(id), by = new Map();
    if (!M) return [];
    for (const i of PC.visibleSlots(M)) {
      const p = M.pads[i];
      if (!isObj(p)) continue;
      const S = new Set(p.t.map(x => x.tr).filter(tr => tr !== cur && trackOf(tr)));
      for (const tr of S) by.set(tr, (by.get(tr) || 0) + 1);
    }
    return [...by].map(([tr, n]) => ({ tr, name: (trackOf(tr) || {}).name || tr, n }));
  }
  /** The project's tracks for the inspector: [{ id, name, model (the primary's), drum (its first drum machine's model) }]. */
  function trackList() {
    return tracks().filter(isObj).map(t => {
      const L = insts(t), k = drumDev(t);
      return { id: t.id, name: typeof t.name === 'string' && t.name ? t.name : t.id, model: L.length ? t.dev[L[0]].model : null, drum: k ? t.dev[k].model : null };
    });
  }
  return {
    module: modOf, light, press, lift: endKey, at, attach, view, edit, learn, learnAll, stopLearn, learning: () => learning,
    forget: (id, i) => edit('Forget pad ' + PC.padNo(modOf(id) || { rows: 0, cols: 0 }, i), pads => PC.rebind(pads, id, i, null).pads),
    value, wants: tr => dsub.has(tr), midiIn, ports, release, rebuild, resync, transport, endModule, endTrack, hwDark, warnOf, others,
    rowsOf: src => { const r = call(D.rowsOf, src); return Array.isArray(r) ? r : []; },
    jump: (tr, id) => call(D.jump, tr, id), tracks: trackList,
    modelName: m => call(D.modelName, m) || (m ? String(m) : ''),
    midi: () => !!call(D.midiOk), inputs: () => call(D.inputs) || [], outputs: () => call(D.outputs) || [],
    confirm: t => (typeof D.confirm === 'function' ? !!call(D.confirm, t) : true), notice: (t, ms, f) => call(D.notice, t, ms, f),
    nextNote: typeof D.nextNote === 'function' ? fn => call(D.nextNote, fn) : null,
    drumOf: D.drumOf, project: proj, srcOf,
    /** (tests / the sims) the counts, the holds, the paints */
    held: () => [...cnt.entries()].map(([k, c]) => { const j = k.indexOf('\u0000'); return [k.slice(0, j), +k.slice(j + 1), c]; }),
    holdKeys: () => [...holds.keys()], stats: () => ({ paints, views: views.size, subs: dsub.size, inputs: nsub.size }),
  };
}

/* ================================================================ the body */
const BAR_H = PC.BAR_H;
// a press that acts at once for a mouse or pen, for a finger at its tap's release within 10 px (main.js pressOrTap's rule): a
// pinch or a pan starting on the button presses nothing (gesture.js cancels its first finger); Enter / Space by the button's
// own click (no detail); no context menu
export function tapOn(el, fn) {
  let p = null;
  el.addEventListener('pointerdown', e => {
    p = null;
    if (e.button !== 0 || e.ctrlKey) return;
    if (e.pointerType === 'touch') p = { id: e.pointerId, x: e.clientX, y: e.clientY }; else fn(e);
  });
  el.addEventListener('pointerup', e => { const P = p; p = null; if (P && P.id === e.pointerId && Math.hypot(e.clientX - P.x, e.clientY - P.y) <= 10) fn(e); });
  el.addEventListener('pointercancel', e => { if (p && p.id === e.pointerId) p = null; });
  el.addEventListener('click', e => { if (!(e.detail >= 1)) fn(e); });
  el.addEventListener('contextmenu', e => e.preventDefault());
}
const STEPS_SZ = ['S', 'M', 'L'];
const SCALE_L = [['chrom', 'Chromatic'], ['major', 'Major'], ['minor', 'Minor'], ['penta', 'Pentatonic']];
const MOD_L = [['', 'Off'], ['gate', 'Gate'], ['vel', 'Velocity'], ['press', 'Pressure'], ['tog', 'Toggle']];
const LIGHT_L = [['hit', 'On hit'], ['follow', 'Following its target'], ['both', 'Both']];
const Q_LABEL = { maj: 'major', min: 'minor', 7: '7', maj7: 'maj7', m7: 'm7', dim: 'dim', dim7: 'dim7', aug: 'aug', sus2: 'sus2', sus4: 'sus4', 6: '6', m6: 'm6', add9: 'add9', 5: '5 (power)' };
// 'C3 E3 G#3' → [48, 52, 56] (≤ 8, sorted, unique; names or numbers)
export function parseNotes(s) {
  const out = [];
  for (const w of String(s || '').split(/[\s,]+/)) {
    if (!w) continue;
    const m = /^([A-Ga-g])([#b♯♭]?)(-?\d+)$/.exec(w);
    let n = NaN;
    if (m) n = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()] + (m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0) + (+m[3] + 1) * 12;
    else if (/^\d+$/.test(w)) n = +w;
    if (n >= 0 && n <= 127 && !out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b).slice(0, PC.MAX_NS);
}

/**
 * One Pads module's body (§1–§3, §7): o = { host (padsHost), id ('pd1'), doc?, track?() → the canvas's track id ("this
 * track"), tap?(el, fn) (the host's tap helper), raf? }. → { el, sync(), release(), menuItems(), edit(on?), grid, destroy() }.
 * The body draws the host's module record; every mapping change goes through host.edit (one step).
 */
export function padsBody(o) {
  const O = o || {}, HS = O.host, id = String(O.id || ''), d = O.doc || globalThis.document;
  ensureCSS(d);
  const call = (f, ...a) => { if (typeof f !== 'function') return undefined; try { return f(...a); } catch (err) { console.error(err); return undefined; } };
  const mk = (tag, cls, txt) => { const e = d.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const setA = (e, k, v) => { if (v == null) { if (e.hasAttribute(k)) e.removeAttribute(k); } else if (e.getAttribute(k) !== String(v)) e.setAttribute(k, String(v)); };
  const text1 = (e, t) => { if (e.textContent !== t) e.textContent = t; };
  const tap = typeof O.tap === 'function' ? O.tap : tapOn;
  const btn = (cls, txt, label, fn) => { const b = mk('button', cls, txt); b.type = 'button'; if (label) { b.setAttribute('aria-label', label); b.title = label; } if (fn) tap(b, fn); return b; };
  const curTr = () => call(O.track) || null;
  const UI = HS.view(id);
  const el = mk('div', 'pd-body'), well = mk('div', 'pd-well'), grid = mk('div', 'pd-grid'), foot = mk('div', 'pd-foot');
  el.setAttribute('data-pads', id);
  grid.setAttribute('role', 'group');
  well.append(grid);
  const editB = btn('pd-fb pd-edit', '✎ Edit', 'Edit pads', () => setEdit(!UI.edit));
  const setB = btn('pd-fb pd-set', '⚙', 'Pad settings', () => { const r = setB.getBoundingClientRect(); wk.contextMenu(r.left, r.bottom + 4, menuItems(), { anchor: setB }); });
  const othB = btn('pd-fb pd-oth', '', '', () => othersMenu());
  const hwDot = mk('span', 'pd-hw');
  editB.setAttribute('aria-pressed', 'false');
  foot.append(editB, setB, othB, hwDot);
  el.append(well, foot);
  let M = null, G = null, F = null, B = null, dead = false, gsig = '', byPtr = false, offV = null;
  const BB = { w: 1 }, cells = new Map(), seen = new Map(), kb = new Set();
  const V = { id, paint: S => paint(S), release: () => releaseAll(), sync: () => render() };
  const ckey = i => 'c' + V.n + ':' + id + ':' + i, kkey = i => 'k' + V.n + ':' + id + ':' + i;
  const proj = () => HS.project() || {};
  const modRoot = () => { for (let n = el.parentNode; n && typeof n.getAttribute === 'function'; n = n.parentNode) if (n.getAttribute('data-cv-mod') != null) return n; return null; };
  const trName = tr => { const t = HS.tracks().find(x => x.id === tr); return t ? t.name : 'a deleted track'; };
  // a target's default colour: the family's (colorFor); a drum on an SDS-V track in that sound's kit colour (R1-F)
  const colFor = (x, mod) => { const t = isObj(x) && x.k === 'drum' ? HS.tracks().find(y => y.id === x.tr) : null, L = t ? lookOf(t.drum) : null; return L && own(L.c, x.s) ? L.c[x.s] : PC.colorFor(x, mod); };
  /* ---- render: the geometry from the record (pads-core footprint), the cells when the grid's shape changed */
  function render() {
    if (dead) return;
    M = HS.module(id);
    if (!M) { grid.textContent = ''; cells.clear(); return; }
    G = PC.gridOf(M.rows, M.cols, M.size); F = PC.footprint(M.rows, M.cols, M.size);
    BB.w = G.w;
    const gy = F.gy - BAR_H; // (the grid sits in the well, WELL_PAD in: at footprint's gx / gy of the module)
    Object.assign(well.style, { left: F.gx - WELL_PAD + 'px', top: gy - WELL_PAD + 'px', width: G.w + 2 * WELL_PAD + 'px', height: G.h + 2 * WELL_PAD + 'px' });
    Object.assign(grid.style, { left: WELL_PAD + 'px', top: WELL_PAD + 'px', width: G.w + 'px', height: G.h + 'px' });
    Object.assign(foot.style, { top: F.fy - BAR_H + 'px', height: PC.FOOTER + 'px' });
    setA(foot, 'data-w', F.w < 160 ? 'xs' : F.w < 256 ? 's' : null); // (a narrow module: the footer's short texts; the 1-column S one: no "+N")
    narrow(); // (and its bar: the title, ⋯ and ▾ only — once the body is in its module)
    setA(grid, 'aria-label', M.name); setA(grid, 'data-shape', M.shape === 'hex' ? 'hex' : null);
    const sig = [M.rows, M.cols, M.size].concat(M.pads.map(p => (isObj(p) && p.mod ? 1 : 0))).join();
    if (sig !== gsig) {
      gsig = sig;
      grid.textContent = ''; cells.clear(); seen.clear();
      for (const i of PC.visibleSlots(M)) { const c = cellFor(i); cells.set(i, c); grid.append(c); }
    }
    if (!cells.has(UI.focus)) UI.focus = PC.slotOf(0, 0);
    for (const [i, c] of cells) dress(i, c);
    UI.sel = UI.sel.filter(i => cells.has(i));
    edAttr();
    footer();
    paint(null);
    if (POP) call(POP.sync);
  }
  function narrow() { // a module narrower than 256 px: [data-pd-narrow] on its root (CSS: no chip, no sub in the bar)
    const r = modRoot();
    if (r) setA(r, 'data-pd-narrow', F && F.w < 256 ? '' : null);
    else if (typeof queueMicrotask === 'function') queueMicrotask(() => { if (!dead && modRoot()) narrow(); }); // (the host appends the body after it is made)
  }
  function cellFor(i) {
    const c = mk('div', 'pd-pad'), r = PC.padRect(G, i);
    c.setAttribute('data-i', String(i)); c.setAttribute('role', 'button'); c.setAttribute('data-gesture', 'music');
    Object.assign(c.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    if (isObj(M.pads[i]) && M.pads[i].mod) { const j = mk('span', 'pd-jk'); j.setAttribute('data-jack', 'p' + i); c.append(j); } // (the inline jack's anchor: a child, never the pad, review #20)
    return c;
  }
  function dress(i, c) { // a cell's colour, label, number, aria text, warning, tab stop
    const p = M.pads[i], P = proj(), no = PC.padNo(M, i), off = PC.isOff(p), col = PC.COLORS[isObj(p) ? p.c : PC.C_GREY] || PC.COLORS[PC.C_GREY];
    const lab = PC.padLabel(p, P), w = off ? '' : HS.warnOf(id, i);
    c.style.setProperty('--pc', col.lit); c.style.setProperty('--pi', col.idle);
    setA(c, 'data-no', String(no)); setA(c, 'data-name', lab || '');
    setA(c, 'data-mod', isObj(p) && p.mod ? '' : null); setA(c, 'data-warn', w ? '' : null); setA(c, 'title', w || null);
    let what = 'empty';
    if (!off) {
      const x = isObj(p) && p.t[0], tk = x ? HS.tracks().find(y => y.id === x.tr) : null; // (tk: the host's track list entry, no track)
      what = (lab || 'Pad') + (tk ? ', ' + tk.name + (tk.model ? ' (' + HS.modelName(tk.model) + ')' : '') : x ? ', ' + trName(x.tr) : '') + (isObj(p) && p.mod ? ', modulation source' : '') + (w ? ' — ' + w : '');
    }
    setA(c, 'aria-label', 'Pad ' + no + ': ' + what);
    c.tabIndex = i === UI.focus ? 0 : -1;
    setA(c, 'data-sel', UI.edit && UI.sel.includes(i) ? '' : null);
  }
  function paint(S) { // the host's light levels (≤ one call a frame: the host's flush)
    if (dead || !M) return;
    for (const i of S ? S : cells.keys()) {
      const c = cells.get(i);
      if (!c) continue;
      const x = HS.light(id, i);
      setA(c, 'data-l', x.l); setA(c, 'aria-pressed', x.held && x.l !== 'off' ? 'true' : 'false');
      const f0 = seen.get(i);
      if (f0 !== x.f) { seen.set(i, x.f); if (f0 !== undefined) setA(c, 'data-hit', c.getAttribute('data-hit') === '1' ? '0' : '1'); } // (two keyframes alternate: the flash restarts)
      if (x.b != null) { const s = x.b.toFixed(3); if (c.style.getPropertyValue('--pb') !== s) c.style.setProperty('--pb', s); }
      setA(c, 'data-learn', x.learn ? '' : null);
    }
  }
  function footer() {
    const L = HS.others(id, curTr()), n = L.reduce((a, x) => a + x.n, 0);
    othB.hidden = !n;
    const t = !n ? '' : '+' + n + ' pad' + (n === 1 ? '' : 's') + ' on ' + (L.length === 1 ? L[0].name : L.length + ' other tracks');
    text1(othB, foot.hasAttribute('data-w') && n ? '+' + n : t); setA(othB, 'aria-label', n ? t + ': list them' : null); othB.title = n ? t + ' — tap to list them' : '';
    const midi = HS.midi();
    hwDot.hidden = !midi;
    if (midi) {
      const ins = new Set(HS.inputs()), B0 = M.pads.filter(p => isObj(p) && p.hw), on = B0.filter(p => !p.hw.port || ins.has(p.hw.port)).length;
      setA(hwDot, 'data-on', on ? '' : null);
      hwDot.title = B0.length ? B0.length + ' hardware pad' + (B0.length === 1 ? '' : 's') + ' learned, ' + on + ' connected' : 'No hardware pads learned';
      setA(hwDot, 'aria-label', hwDot.title); setA(hwDot, 'role', 'img');
    }
  }
  function othersMenu() {
    const L = HS.others(id, curTr());
    if (!L.length) return;
    const r = othB.getBoundingClientRect();
    wk.contextMenu(r.left, r.bottom + 4, L.map(x => ({ label: x.name + ' · ' + x.n + ' pad' + (x.n === 1 ? '' : 's'), action: () => HS.jump(x.tr, id) })), { anchor: othB });
  }
  /* ---- play: the bed (§2.1) — the grid element is exactly gridOf's box, s = screen px per world px */
  const hitNow = (x, y, s) => (G ? PC.padHit(G, () => HS.module(id))(x, y, s) : null);
  function bedOn() {
    if (B || dead || UI.edit || !M) return;
    B = bed(grid, BB, { hit: hitNow, slide: false, each: true, raf: O.raf,
      on: (i, v, ts) => { HS.press(id, i, v, ts, ckey(i)); },
      off: (i, ts) => { HS.lift(ckey(i), ts); },
      at: (v, i) => { if (Number.isInteger(i)) HS.at(id, i, v); } });
  }
  function bedOff() { if (B) { const b = B; B = null; b.destroy(); } }
  function releaseKb() { for (const i of [...kb]) { kb.delete(i); HS.lift(kkey(i)); } }
  function releaseAll() { if (B) B.release(); releaseKb(); for (const P of EP.values()) P.cancel = true; EP.clear(); marks(null); }
  /* ---- keyboard and focus (§2.5): one tab stop (roving), arrows move it, Space / Enter held = the pad held, Escape releases */
  const cellOf = t => { for (let n = t; n && n !== grid && typeof n.getAttribute === 'function'; n = n.parentNode) if (n.getAttribute('data-i') != null && n.parentNode === grid) return n; return null; };
  function focusPad(i) {
    const c = cells.get(i);
    if (!c) return;
    const o0 = cells.get(UI.focus);
    if (o0) o0.tabIndex = -1;
    UI.focus = i; c.tabIndex = 0;
    try { c.focus({ preventScroll: true }); } catch (err) { /* inert */ }
  }
  const offs = [];
  const on = (t, ty, f, op) => { t.addEventListener(ty, f, op); offs.push(() => t.removeEventListener(ty, f, op)); };
  on(grid, 'pointerdown', () => { byPtr = true; grid.removeAttribute('data-kb'); }, true);
  on(grid, 'focusin', () => { byPtr = false; });
  on(grid, 'focusout', e => { if (!e.relatedTarget || !grid.contains(e.relatedTarget)) releaseKb(); });
  on(grid, 'keydown', e => {
    const c = cellOf(e.target);
    if (!c || !M || (byPtr && e.key !== 'Tab')) return; // (a pointer-focused grid gives Space / the arrows back: main's kbFocus rule)
    const i = +c.getAttribute('data-i'), r = i >> 3, cc = i & 7;
    const mv = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [1, 0], ArrowDown: [-1, 0] }[e.key]; // (row 0 is the bottom one)
    if (mv) {
      e.preventDefault(); e.stopPropagation();
      grid.setAttribute('data-kb', '');
      const r2 = r + mv[0], c2 = cc + mv[1];
      if (r2 >= 0 && r2 < M.rows && c2 >= 0 && c2 < M.cols) focusPad(PC.slotOf(r2, c2));
      return;
    }
    if (e.key === 'Escape') {
      if (!UI.edit && !kb.size) return; // (nothing of ours: main's Escape)
      e.preventDefault(); e.stopPropagation();
      if (UI.edit) setEdit(false); else releaseKb();
      return;
    }
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault(); e.stopPropagation();
    grid.setAttribute('data-kb', '');
    if (e.repeat) return;
    if (UI.edit) { select(i, e.shiftKey); return; }
    if (kb.has(i)) return;
    kb.add(i);
    HS.press(id, i, PC.hitVel(M, M.pads[i], { key: true }), e.timeStamp, kkey(i));
  });
  on(grid, 'keyup', e => { const c = cellOf(e.target); if (!c || (e.key !== ' ' && e.key !== 'Enter')) return; const i = +c.getAttribute('data-i'); if (kb.delete(i)) { e.preventDefault(); HS.lift(kkey(i), e.timeStamp); } });
  on(grid, 'contextmenu', e => e.preventDefault());
  /* ---- Edit mode (§7.1): taps select (Shift / a second finger adds), a drag onto a pad swaps (Alt / a long press first:
   * copies), onto an instrument module of this canvas retargets the pad's first target to this track */
  const EP = new Map();
  const jackIn = t => { for (let n = t; n && n !== grid && typeof n.getAttribute === 'function'; n = n.parentNode) if (n.getAttribute('data-cv-jack') != null || n.getAttribute('data-jack') != null) return true; return false; };
  function marks(P, over) {
    for (const c of cells.values()) { setA(c, 'data-drag', P && +c.getAttribute('data-i') === P.i ? (P.copy ? 'copy' : '') : null); setA(c, 'data-over', over != null && +c.getAttribute('data-i') === over ? '' : null); }
  }
  const under = (x, y) => { try { return typeof d.elementFromPoint === 'function' ? d.elementFromPoint(x, y) : null; } catch (err) { return null; } };
  on(grid, 'pointerdown', e => {
    if (!UI.edit || dead || e.button !== 0 || e.ctrlKey || jackIn(e.target)) return; // (a jack: the world's cable drag)
    const c = cellOf(e.target);
    if (!c) return;
    e.preventDefault();
    try { grid.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    EP.set(e.pointerId, { i: +c.getAttribute('data-i'), x: e.clientX, y: e.clientY, t: e.timeStamp, moved: false, add: !!(e.shiftKey || e.metaKey) || EP.size > 0, copy: !!e.altKey, type: e.pointerType || 'mouse' });
  });
  on(grid, 'pointermove', e => {
    const P = EP.get(e.pointerId);
    if (!P || !UI.edit) return;
    if (!P.moved) {
      if (Math.hypot(e.clientX - P.x, e.clientY - P.y) <= (P.type === 'mouse' ? SLOP.mouse : SLOP.touch)) return;
      P.moved = true;
      if (e.timeStamp - P.t >= COPY_MS) P.copy = true;
    }
    const t = under(e.clientX, e.clientY), c = t && grid.contains(t) ? cellOf(t) : null;
    marks(P, c ? +c.getAttribute('data-i') : null);
  });
  const eEnd = e => {
    const P = EP.get(e.pointerId);
    if (!P) return;
    EP.delete(e.pointerId);
    marks(null);
    try { grid.releasePointerCapture(e.pointerId); } catch (err) { /* released */ }
    if (P.cancel || e.type !== 'pointerup' || !UI.edit) return;
    if (!P.moved) { select(P.i, P.add); return; }
    drop(P, under(e.clientX, e.clientY));
  };
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) on(grid, t, eEnd);
  const blank = () => PC.normPad({});
  function drop(P, t) {
    const no = PC.padNo(M, P.i);
    const c = t && grid.contains(t) ? cellOf(t) : null;
    if (c) {
      const j = +c.getAttribute('data-i');
      if (j === P.i) return;
      const nj = PC.padNo(M, j);
      edPads(P.copy ? 'Copy pad ' + no + ' to pad ' + nj : 'Swap pads ' + no + ' and ' + nj, ps => {
        const a = ps[P.i], b = ps[j], strip = p => (isObj(p) ? Object.assign({}, p, { hw: null }) : null);
        if (P.copy) ps[j] = isObj(a) ? Object.assign({}, a, { hw: isObj(b) ? b.hw : null }) : isObj(b) && b.hw ? Object.assign(blank(), { hw: b.hw }) : null; // (a binding stays with its slot)
        else { ps[j] = isObj(a) ? Object.assign(strip(a), { hw: isObj(b) ? b.hw : null }) : isObj(b) && b.hw ? Object.assign(blank(), { hw: b.hw }) : null; ps[P.i] = isObj(b) ? Object.assign(strip(b), { hw: isObj(a) ? a.hw : null }) : isObj(a) && a.hw ? Object.assign(blank(), { hw: a.hw }) : null; }
      });
      return;
    }
    let m = null;
    for (let n = t; n && typeof n.getAttribute === 'function'; n = n.parentNode) if (n.getAttribute('data-cv-mod') != null) { m = n; break; }
    const tr = curTr();
    if (!m || !tr || m.getAttribute('data-cv-kind') !== 'inst') return;
    let s = null;
    for (let n = t; n && n !== m && typeof n.getAttribute === 'function'; n = n.parentNode) if (/^[a-z]{2}$/.test(n.getAttribute('data-sound') || '')) { s = n.getAttribute('data-sound'); break; } // (a drum machine's own pad: that sound)
    edPads('Pad ' + no + ' → ' + trName(tr), ps => {
      const p = isObj(ps[P.i]) ? ps[P.i] : blank(), x = p.t[0];
      if (s) p.t[0] = { k: 'drum', tr, s };
      else if (x) x.tr = tr;
      else p.t.push({ k: 'note', tr, n: PC.CHROM_FROM });
      if (!isObj(ps[P.i]) || s) p.c = colFor(p.t[0], p.mod);
      ps[P.i] = p;
    });
  }
  function select(i, add) {
    let S = UI.sel.slice();
    if (add) S = S.includes(i) ? S.filter(x => x !== i) : S.concat(i); else S = [i];
    UI.sel = S;
    UI.focus = cells.has(i) ? i : UI.focus;
    for (const [k, c] of cells) { setA(c, 'data-sel', S.includes(k) ? '' : null); c.tabIndex = k === UI.focus ? 0 : -1; }
    if (S.length) inspOpen(); else popClose();
  }
  function edAttr() {
    setA(el, 'data-pads-edit', UI.edit ? '' : null);
    setA(editB, 'aria-pressed', UI.edit ? 'true' : 'false');
    text1(editB, (UI.edit ? '✓' : '✎') + (foot.hasAttribute('data-w') ? '' : UI.edit ? ' Done' : ' Edit'));
    editB.title = UI.edit ? 'Leave Edit mode (Escape)' : 'Edit pads: tap a pad to map it';
    if (UI.edit) bedOff(); else bedOn();
  }
  /** Edit mode on / off (§7.1): the bed goes (taps select, drags swap) and comes back on leaving; the inspector with it. */
  function setEdit(onE) {
    const want = onE == null ? !UI.edit : !!onE;
    if (want === UI.edit) return;
    if (want) { releaseAll(); UI.edit = true; } else { UI.edit = false; UI.sel = []; UI.insp = false; popClose(); }
    edAttr();
    for (const [i, c] of cells) setA(c, 'data-sel', UI.edit && UI.sel.includes(i) ? '' : null);
    if (UI.edit && UI.sel.length && UI.insp) inspOpen();
  }
  /* ---- edits: the module record mutated in a copy, one host step */
  const edMod = (label, fn, x) => HS.edit(label, ps => { const m = ps.find(q => isObj(q) && q.id === id); if (m) fn(m); return ps; }, Object.assign({ id }, x || {}));
  const edPads = (label, fn, x) => edMod(label, m => { const ps = m.pads.slice(); fn(ps); m.pads = ps; }, x);
  const lab1 = () => (UI.sel.length === 1 ? 'pad ' + PC.padNo(M, UI.sel[0]) : UI.sel.length + ' pads');
  // the selected pads, each made a record (an empty slot: an off pad)
  const edSel = (fn, x) => edPads('Edit ' + lab1(), ps => { for (const i of UI.sel) { const p = isObj(ps[i]) ? ps[i] : blank(); fn(p, i); ps[i] = p; } }, x);
  /* ---- popovers (the inspector, Grid…, Velocity…, Fill from…, Hardware controller…): one at a time, beside the module, in the
   * top layer when there is one (wk.layer) — Escape, ✕, a press outside or a camera move closes it */
  let POP = null;
  function popOpen(kind, title, build) {
    popClose();
    const root = modRoot() || el, lay = wk.layer(root), box = mk('div', 'pd-pop'), head = mk('div', 'pd-ph'), body = mk('div', 'pd-pb');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', title);
    box.setAttribute('data-pop', kind);
    const ttl = mk('span', 'pd-pt', title), x = btn('pd-x', '✕', 'Close', () => popClose(true));
    head.append(ttl, x);
    box.append(head, body);
    // in the top layer (fixed): beside the module — its right, its left with no room —, clamped into the window with an 8 px
    // margin, measured with the content built and again at every sync (the content grows) and at a window resize (R2-F3)
    const fixed = lay !== root, win = d.defaultView || globalThis;
    if (fixed) box.style.position = 'fixed';
    const place = () => {
      if (!fixed) return;
      const vw = +win.innerWidth || 1024, vh = +win.innerHeight || 768, r = root.getBoundingClientRect(), w = +box.offsetWidth || 300, h = +box.offsetHeight || 0;
      let l = r.right + 10;
      if (l + w > vw - 8 && r.left - 10 - w >= 8) l = r.left - 10 - w;
      box.style.left = Math.round(clamp(l, 8, Math.max(8, vw - 8 - w))) + 'px';
      box.style.top = Math.round(clamp(r.top, 8, Math.max(8, vh - 8 - h))) + 'px';
    };
    const onRes = () => { if (POP && POP.box === box) place(); };
    lay.append(box);
    if (fixed && typeof win.addEventListener === 'function') win.addEventListener('resize', onRes);
    const onDown = e => { const t = e.target; if (box.contains(t) || (kind === 'insp' && grid.contains(t)) || foot.contains(t)) return; popClose(); };
    const onKey = e => { if (e.key !== 'Escape') return; e.preventDefault(); e.stopPropagation(); popClose(true); };
    d.addEventListener('pointerdown', onDown, true);
    box.addEventListener('keydown', onKey);
    const tOff = wk.addTransient(() => popClose());
    let outline = null;
    if (kind === 'grid') { outline = mk('div', 'pd-outline'); outline.setAttribute('aria-hidden', 'true'); (modRoot() || el).append(outline); }
    POP = { kind, box, ttl, body, outline, sync: () => { body.textContent = ''; build(body, ttl); if (outline && M) { const Fp = PC.footprint(M.rows, M.cols, M.size); Object.assign(outline.style, { width: Fp.w + 'px', height: Fp.h + 'px' }); } place(); },
      off() { d.removeEventListener('pointerdown', onDown, true); box.removeEventListener('keydown', onKey); if (fixed && typeof win.removeEventListener === 'function') win.removeEventListener('resize', onRes); tOff(); if (outline) outline.remove(); } };
    POP.sync();
    return POP;
  }
  function popClose(back, keep) {
    if (!POP) return false;
    const P = POP;
    POP = null;
    P.off(); P.box.remove();
    if (P.kind === 'insp' && !keep) UI.insp = false; // (keep: the body's destroy — a rebuilt module opens it again)
    if (back) { try { (P.kind === 'insp' ? cells.get(UI.focus) || editB : setB).focus({ preventScroll: true }); } catch (err) { /* gone */ } }
    return true;
  }
  // widgets: a row with its label, a native select, a stepper (− value +) and a segmented choice — every button a tap
  const row = (label, ...kids) => { const r = mk('div', 'pd-row'); if (label) r.append(mk('span', 'pd-rl', label)); r.append(...kids.filter(Boolean)); return r; };
  function sel(label, opts, cur, fn) {
    const s = mk('select', 'pd-sel');
    s.setAttribute('aria-label', label);
    for (const [v, t] of opts) { const op = mk('option', null, t); op.value = String(v); if (String(v) === String(cur)) op.selected = true; s.append(op); }
    s.value = String(cur);
    s.addEventListener('change', () => fn(s.value));
    return s;
  }
  function stepper(label, txt, dec, inc, shown) { // (shown: the visible text when it differs from the spoken one)
    const w = mk('span', 'pd-step'), v = mk('span', 'pd-sv', shown != null ? shown : txt);
    w.setAttribute('role', 'group'); w.setAttribute('aria-label', label + ': ' + txt);
    w.append(btn('pd-sb', '−', label + ' down', dec), v, btn('pd-sb', '+', label + ' up', inc));
    return w;
  }
  function seg(label, opts, cur, fn) {
    const w = mk('span', 'pd-seg');
    w.setAttribute('role', 'group'); w.setAttribute('aria-label', label);
    for (const [v, t] of opts) { const b = btn('pd-sg', t, null, () => fn(v)); b.setAttribute('aria-pressed', v === cur ? 'true' : 'false'); w.append(b); }
    return w;
  }
  /* ---- the pad inspector (§7.2): edits apply live, one step per field gesture */
  function inspOpen() {
    if (!UI.edit || !UI.sel.length) return;
    UI.insp = true;
    if (POP && POP.kind === 'insp') { POP.sync(); return; }
    popOpen('insp', 'Pad', inspBuild);
  }
  function inspBuild(body, ttl) {
    if (!M || !UI.sel.length) return;
    const P = proj(), T = HS.tracks(), cur = curTr(), one = UI.sel.length === 1, i0 = UI.sel[0], p = isObj(M.pads[i0]) ? M.pads[i0] : blank();
    text1(ttl, one ? 'Pad ' + PC.padNo(M, i0) + (PC.padLabel(p, P) ? ' · ' + PC.padLabel(p, P) : '') : UI.sel.length + ' pads');
    const trOpts = T.slice().sort((a, b) => (a.id === cur ? -1 : b.id === cur ? 1 : 0)).map(tk => [tk.id, tk.name + (tk.id === cur ? ' (this track)' : '') + (tk.model ? ' · ' + HS.modelName(tk.model) : '')]);
    if (!one) { // the shared fields (Colour, Velocity, Track): one step each
      body.append(row('Track', sel('Track', [['', '—']].concat(trOpts), '', v => { if (v) edSel(q => { for (const x of q.t) x.tr = v; }); })));
      velRow(body, p);
      colRow(body, p);
      return;
    }
    const w = HS.warnOf(id, i0);
    if (w) body.append(mk('div', 'pd-warn', w));
    body.append(mk('div', 'pd-h', 'Plays'));
    p.t.forEach((x, j) => body.append(targetRow(x, j, trOpts)));
    if (p.t.length < PC.MAX_T) body.append(row(null, btn('pd-tb', '+ Add target', 'Add a target', () => edSel(q => { q.t.push({ k: 'note', tr: cur || (T[0] && T[0].id) || '', n: PC.CHROM_FROM }); if (q.t.length === 1) q.c = colFor(q.t[0], q.mod); }))));
    modRows(body, p, i0);
    velRow(body, p);
    const lt = btn('pd-tg', p.latch ? 'On' : 'Off', 'Latch: a tap holds, the next tap releases', () => edSel(q => { q.latch = q.latch ? 0 : 1; }));
    lt.setAttribute('aria-pressed', p.latch ? 'true' : 'false');
    body.append(row('Latch', lt));
    colRow(body, p);
    const inp = mk('input', 'pd-in');
    inp.type = 'text'; inp.maxLength = PC.MAX_LABEL; inp.value = p.l || ''; inp.placeholder = PC.padLabel(Object.assign({}, p, { l: '' }), P) || 'Label';
    inp.setAttribute('aria-label', 'Label');
    inp.addEventListener('change', () => edSel(q => { q.l = inp.value.slice(0, PC.MAX_LABEL); }));
    body.append(row('Label', inp));
    if (HS.midi()) hwRow(body, p, i0); // (the learn UI: Mac only — hidden without Web MIDI, §8.1)
  }
  function targetRow(x, j, trOpts) {
    const r = mk('div', 'pd-tgt'), T = HS.tracks(), t = T.find(y => y.id === x.tr);
    const kind = x.k === 'notes' ? 'chord' : x.k;
    const setT = fn => edSel(q => { const y = q.t[j]; if (y) fn(y, q); });
    r.append(sel('Type', [['note', 'Note'], ['chord', 'Chord'], ['drum', 'Drum'], ['off', 'Off']], kind, v => edSel(q => {
      const y = q.t[j];
      if (!y) return;
      if (v === 'off') { q.t.splice(j, 1); return; }
      const n0 = PC.targetNotes(y)[0], n = n0 == null ? PC.CHROM_FROM : n0;
      if (v === 'note') q.t[j] = { k: 'note', tr: y.tr, n };
      else if (v === 'chord') q.t[j] = { k: 'chord', tr: y.tr, root: n, q: 'maj', inv: 0, oct: 0, spread: 'close' };
      else { const tt = T.find(z => z.id === y.tr), P = tt && persOf(tt.drum); q.t[j] = { k: 'drum', tr: y.tr, s: P ? P.sounds[P.sids[0]] : 'bd' }; }
      if (j === 0) q.c = colFor(q.t[0], q.mod);
    })));
    r.append(sel('Track', (t ? [] : [[x.tr, trName(x.tr)]]).concat(trOpts), x.tr, v => setT(y => { y.tr = v; })));
    if (x.k === 'note') {
      r.append(stepper('Note', PC.noteName(x.n), () => setT(y => { y.n = clamp(y.n - 1, 0, 127); }), () => setT(y => { y.n = clamp(y.n + 1, 0, 127); })));
      r.append(stepper('Octave', String(Math.floor(x.n / 12) - 1), () => setT(y => { y.n = clamp(y.n - 12, 0, 127); }), () => setT(y => { y.n = clamp(y.n + 12, 0, 127); }), 'oct ' + (Math.floor(x.n / 12) - 1)));
      if (HS.nextNote) {
        const pl = btn('pd-tb', 'Play it', 'Play it: the next note from the keyboard or MIDI sets it', () => {
          pl.setAttribute('aria-pressed', 'true'); text1(pl, 'Listening…');
          HS.nextNote(n => { if (Number.isInteger(n)) setT(y => { y.n = clamp(n, 0, 127); }); });
        });
        r.append(pl);
      }
    } else if (x.k === 'chord') {
      r.append(stepper('Root', PC.noteName(x.root), () => setT(y => { y.root = clamp(y.root - 1, 0, 127); }), () => setT(y => { y.root = clamp(y.root + 1, 0, 127); })));
      r.append(sel('Quality', PC.Q_ORDER.map(q => [q, Q_LABEL[q] || q]).concat([['custom', 'Custom…']]), x.q, v => setT((y, q) => {
        if (v === 'custom') q.t[j] = { k: 'notes', tr: y.tr, ns: PC.chordNotes(y) }; else y.q = v;
      })));
      r.append(sel('Inversion', [[0, 'Root'], [1, '1st inv'], [2, '2nd inv'], [3, '3rd inv']], x.inv, v => setT(y => { y.inv = +v; })));
      r.append(sel('Spread', [['close', 'Close'], ['open', 'Open']], x.spread, v => setT(y => { y.spread = v; })));
      r.append(sel('Octave', [[-2, '−2 oct'], [-1, '−1 oct'], [0, '0 oct'], [1, '+1 oct'], [2, '+2 oct']], x.oct, v => setT(y => { y.oct = +v; })));
    } else if (x.k === 'notes') {
      const inp = mk('input', 'pd-in');
      inp.type = 'text'; inp.value = x.ns.map(PC.noteName).join(' '); inp.setAttribute('aria-label', 'Notes (e.g. C3 E3 G3)');
      inp.addEventListener('change', () => { const ns = parseNotes(inp.value); if (ns.length) setT(y => { y.ns = ns; }); else inp.value = x.ns.map(PC.noteName).join(' '); });
      r.append(inp, sel('Quality', [['custom', 'Custom…']].concat(PC.Q_ORDER.map(q => [q, Q_LABEL[q] || q])), 'custom', v => { if (v !== 'custom') setT((y, q) => { q.t[j] = { k: 'chord', tr: y.tr, root: y.ns[0], q: v, inv: 0, oct: 0, spread: 'close' }; }); }));
    } else if (x.k === 'drum') {
      const P = t && persOf(t.drum);
      if (P) r.append(sel('Sound', P.sids.map(sid => [P.sounds[sid], P.names[sid]]), x.s, v => setT((y, q) => { y.s = v; if (j === 0) q.c = colFor(y, q.mod); })));
      else { const s0 = sel('Sound', [[x.s, PC.soundName(x.s, null)]], x.s, () => {}); s0.disabled = true; r.append(s0, mk('span', 'pd-note', 'no drum machine on this track')); }
    }
    return r;
  }
  function modRows(body, p, i) {
    const src = PC.padSrc(id, i), m = p.mod, rows = HS.rowsOf(src);
    body.append(mk('div', 'pd-h', 'Modulation'));
    body.append(row('Source', sel('Modulation', MOD_L, m ? m.m : '', v => {
      if (!v) {
        if (rows.length && !HS.confirm('Remove this pad’s ' + rows.length + ' modulation cable' + (rows.length === 1 ? '' : 's') + '?')) { if (POP) POP.sync(); return; }
        edSel(q => { q.mod = null; }, { drop: [src] }); // (review #31: the rows go in the same step)
      } else edSel(q => { q.mod = Object.assign({ lo: 0, hi: 1 }, q.mod || {}, { m: v }); });
    })));
    if (!m) return;
    const pc = v => Math.round(v * 100) + ' %', st = (k, dv) => edSel(q => { if (q.mod) q.mod[k] = clamp(Math.round((q.mod[k] + dv) * 20) / 20, 0, 1); });
    body.append(row('Range', stepper('Low', pc(m.lo), () => st('lo', -0.05), () => st('lo', 0.05)), stepper('High', pc(m.hi), () => st('hi', -0.05), () => st('hi', 0.05))));
    body.append(mk('div', 'pd-note', (m.m === 'press' ? 'The Pencil’s pressure (or a hardware pad’s) moves it while held. ' : '')
      + 'Drag the pad’s jack (its corner dot) onto a knob. A pad is a fast macro: its value glides in a few ms.'));
    if (rows.length) { const ul = mk('ul', 'pd-rows'); for (const r of rows) ul.append(mk('li', null, (r.track ? r.track + ' · ' : '') + (r.label || ''))); body.append(ul); }
  }
  function velRow(body, p) {
    const fixed = fin(p.v);
    body.append(row('Velocity', sel('Velocity', [['rule', 'Module’s rule'], ['fixed', 'Fixed']], fixed ? 'fixed' : 'rule', v => edSel(q => { q.v = v === 'fixed' ? q.v || 100 : null; })),
      fixed ? stepper('Velocity', String(p.v), () => edSel(q => { q.v = clamp((q.v || 100) - 5, 1, 127); }), () => edSel(q => { q.v = clamp((q.v || 100) + 5, 1, 127); })) : null));
  }
  function colRow(body, p) {
    const w = mk('div', 'pd-cols');
    w.setAttribute('role', 'group'); w.setAttribute('aria-label', 'Colour');
    PC.COLORS.forEach((c, k) => { const b = btn('pd-sw', '', c.name, () => edSel(q => { q.c = k; })); b.style.setProperty('--pc', c.lit); b.setAttribute('aria-pressed', p.c === k ? 'true' : 'false'); w.append(b); });
    body.append(row('Colour', w));
  }
  function hwRow(body, p, i) {
    const b = p.hw, L = HS.learning(), busy = !!L && L.id === id && L.i === i;
    const txt = b ? 'Ch ' + b.ch + ' · ' + (b.cc ? 'CC ' : 'note ') + b.n + (b.port ? ' · ' + b.port : '') : 'Not learned';
    const lb = btn('pd-tb pd-learn', busy ? 'Listening… (Esc)' : 'Learn', 'Learn: hit a hardware pad', () => { if (HS.learning()) HS.stopLearn(); else { HS.learn(id, i).then(() => { if (POP) POP.sync(); }); if (POP) POP.sync(); } });
    lb.setAttribute('aria-pressed', busy ? 'true' : 'false');
    body.append(mk('div', 'pd-h', 'Hardware'), row(null, lb, b ? btn('pd-tb', 'Forget', 'Forget the hardware pad', () => HS.forget(id, i)) : null, mk('span', 'pd-note', txt)));
  }
  /* ---- the module settings (§7.3) */
  const nm = () => (M ? M.name : 'Pads');
  function openGrid() {
    popOpen('grid', 'Grid', body => {
      if (!M) return;
      const set = (k, v, label) => edMod(label, m => { m[k] = v; });
      body.append(row('Rows', stepper('Rows', String(M.rows), () => set('rows', clamp(M.rows - 1, 1, 8), nm() + ': ' + clamp(M.rows - 1, 1, 8) + ' × ' + M.cols), () => set('rows', clamp(M.rows + 1, 1, 8), nm() + ': ' + clamp(M.rows + 1, 1, 8) + ' × ' + M.cols))));
      body.append(row('Columns', stepper('Columns', String(M.cols), () => set('cols', clamp(M.cols - 1, 1, 8), nm() + ': ' + M.rows + ' × ' + clamp(M.cols - 1, 1, 8)), () => set('cols', clamp(M.cols + 1, 1, 8), nm() + ': ' + M.rows + ' × ' + clamp(M.cols + 1, 1, 8)))));
      body.append(row('Pad size', seg('Pad size', STEPS_SZ.map((s, k) => [k, s]), M.size, v => set('size', v, nm() + ': pads ' + STEPS_SZ[v]))));
      body.append(mk('div', 'pd-note', 'A smaller grid hides pads, never their mapping: grow it back to see them again.'));
    });
  }
  function openVel() {
    popOpen('vel', 'Velocity', body => {
      if (!M) return;
      body.append(row(null, seg('Velocity', [['pos', 'By position'], ['fixed', 'Fixed']], M.vel, v => edMod(nm() + ': velocity ' + (v === 'pos' ? 'by position' : 'fixed'), m => { m.vel = v; }))));
      if (M.vel === 'fixed') body.append(row('Fixed', stepper('Fixed velocity', String(M.fv), () => edMod(nm() + ': velocity ' + clamp(M.fv - 5, 1, 127), m => { m.fv = clamp(m.fv - 5, 1, 127); }), () => edMod(nm() + ': velocity ' + clamp(M.fv + 5, 1, 127), m => { m.fv = clamp(m.fv + 5, 1, 127); }))));
      body.append(mk('div', 'pd-note', 'By position: the front (bottom) edge of a pad is loudest. A pad’s own fixed velocity wins.'));
    });
  }
  function openFill() {
    const st = { tr: curTr(), scale: 'chrom', root: PC.CHROM_FROM };
    popOpen('fill', 'Fill from…', body => {
      if (!M) return;
      const T = HS.tracks(), t = T.find(x => x.id === st.tr) || T[0];
      if (!t) { body.append(mk('div', 'pd-note', 'No tracks.')); return; }
      st.tr = t.id;
      body.append(row('Track', sel('Track', T.map(x => [x.id, x.name]), t.id, v => { st.tr = v; if (POP) POP.sync(); })));
      const go = how => edMod('Fill ' + nm() + ' from ' + t.name, m => { m.pads = PC.fill(m, how); }, { undo: true });
      if (t.drum) {
        const O2 = orderOf(t.drum) || { order: null, cols: 4 }, P = persOf(t.drum), order = O2.order || (P ? P.sids.map(j => P.sounds[j]) : []);
        body.append(row(null, btn('pd-tb pd-go', 'Its drum sounds', 'Fill with the drum machine’s sounds', () => go({ k: 'drum', tr: t.id, order, cols: O2.cols, look: lookOf(t.drum) }))));
      }
      body.append(row('Scale', sel('Scale', SCALE_L, st.scale, v => { st.scale = v; })), row('From', stepper('Root', PC.noteName(st.root), () => { st.root = clamp(st.root - 1, 0, 127); if (POP) POP.sync(); }, () => { st.root = clamp(st.root + 1, 0, 127); if (POP) POP.sync(); })));
      body.append(row(null, btn('pd-tb pd-go', 'Fill notes', 'Fill the visible pads with notes', () => go({ k: 'scale', tr: t.id, scale: st.scale, root: st.root }))));
    });
  }
  function openHw() {
    popOpen('hw', 'Hardware controller', body => {
      if (!M) return;
      if (!HS.midi()) { body.append(mk('div', 'pd-note', NO_MIDI)); return; }
      const outs = HS.outputs();
      body.append(row('Lights', seg('Light-back', [['off', 'Off'], ['gen', 'Note velocity (generic)']], M.out.prof, v => {
        if (v === 'off') HS.hwDark(id); // (every learned pad dark once before the switch)
        edMod(nm() + ': light-back ' + (v === 'off' ? 'off' : 'generic'), m => { m.out = Object.assign({}, m.out, { prof: v }); });
      })));
      body.append(mk('div', 'pd-note', GEN_DOC));
      body.append(row('Output', sel('Output port', [['', 'The input’s name']].concat(outs.map(n => [n, n])).concat(M.out.port && !outs.includes(M.out.port) ? [[M.out.port, M.out.port + ' (not connected)']] : []), M.out.port, v => edMod(nm() + ': output', m => { m.out = Object.assign({}, m.out, { port: v }); }))));
      const L = HS.learning(), busy = !!L && L.id === id;
      body.append(row(null, btn('pd-tb pd-go', busy ? 'Stop learning' : 'Learn the visible pads in order', 'Learn the visible pads in order: hit the hardware pads one by one', () => { if (HS.learning()) HS.stopLearn(); else { HS.learnAll(id).then(() => { if (POP) POP.sync(); }); } if (POP) POP.sync(); })));
      body.append(mk('div', 'pd-note', 'Two identical controllers share a name: a binding matches either.'));
    });
  }
  function menuItems() {
    const m = HS.module(id);
    if (!m) return [];
    const midi = HS.midi();
    return [
      { label: UI.edit ? 'Done editing pads' : 'Edit pads', action: () => setEdit(!UI.edit) },
      { label: 'Grid…', action: openGrid },
      { label: 'Velocity…', action: openVel },
      { label: 'Light', sub: LIGHT_L.map(([k, t]) => ({ label: t, checked: m.light === k, action: () => edMod(nm() + ': light ' + t.toLowerCase(), q => { q.light = k; }) })) },
      { label: 'Fill from…', action: openFill },
      { label: 'Clear pads', action: () => edMod('Clear ' + nm(), q => { const ps = q.pads.slice(); for (const i of PC.visibleSlots(q)) ps[i] = isObj(ps[i]) && ps[i].hw ? Object.assign(blank(), { hw: ps[i].hw }) : null; q.pads = ps; }, { undo: true }) }, // (a hardware binding stays with its slot) [C]
      { label: 'Pad shape', sub: [['sq', 'Square'], ['hex', 'Hexagon']].map(([k, t]) => ({ label: t, checked: m.shape === k, action: () => edMod(nm() + ': ' + t.toLowerCase() + ' pads', q => { q.shape = k; }) })) },
      { label: midi ? 'Hardware controller…' : 'Hardware controller… (needs Web MIDI)', action: openHw, disabled: !midi },
      { label: 'Rename…', action: () => { const v = wk.ask('Name of this Pads module', m.name); if (v != null && String(v).trim()) edMod('Rename ' + m.name, q => { q.name = String(v).trim().slice(0, PC.MAX_NAME); }); } },
    ];
  }
  /* ---- life */
  render();
  offV = HS.attach(V);
  // (a rebuilt module keeps Edit mode and its inspector — reopened once the host has put the body in its module: before that the
  // popover has no module root to stand beside and no top layer, and would land inside the body over the pads, R2-F2)
  const reopen = () => { if (!dead && !POP && UI.edit && UI.sel.length && UI.insp) inspOpen(); };
  if (modRoot()) reopen(); else if (typeof queueMicrotask === 'function') queueMicrotask(reopen); else reopen();
  return {
    el, grid, sync: render, release: releaseAll, menuItems, edit: setEdit,
    get editing() { return UI.edit; }, popover: () => (POP ? POP.box : null), openGrid, openVel, openFill, openHw, inspect: i => { if (!UI.edit) setEdit(true); select(i, false); },
    closePop: () => popClose(),
    destroy() {
      if (dead) return;
      releaseAll();
      bedOff();
      popClose(false, true);
      dead = true;
      for (const f of offs) f();
      if (offV) offV();
      el.remove();
    },
  };
}

/* ================================================================ CSS (one <style> per document, cv-keys' pattern) */
const CSS_ID = 'cv-pads-css';
const CSS = `
.cv-body > .pd-body { position: relative; width: 100%; height: 100%; background: #0b0d0f; color: var(--text, #e9e7e2); font-family: var(--ui, system-ui);
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.pd-well { position: absolute; border-radius: 12px; background: ${PC.WELL}; box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.75), 0 0 0 1px #2a2b31; }
.pd-grid { position: absolute; touch-action: none; outline: none; }
.pd-pad { position: absolute; box-sizing: border-box; border-radius: 8px; background: var(--pi, #26272c); touch-action: none; cursor: pointer; outline: none;
  -webkit-tap-highlight-color: transparent; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), inset 0 -2px 3px rgba(0, 0, 0, 0.35);
  transition: background-color ${FLASH_MS}ms linear, box-shadow ${FLASH_MS}ms linear; }
.pd-grid[data-shape="hex"] > .pd-pad { border-radius: 0; clip-path: polygon(25% 3%, 75% 3%, 99% 50%, 75% 97%, 25% 97%, 1% 50%); }
.pd-pad[data-l="off"] { background: #232428; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03); }
.pd-pad[data-mod]:not([data-l="off"]) { background: color-mix(in srgb, var(--pc) calc(var(--pb, 0.22) * 100%), ${PC.WELL}); }
.pd-pad[data-l="lit"] { background: var(--pc); box-shadow: 0 0 14px -2px var(--pc), inset 0 1px 0 rgba(255, 255, 255, 0.25); }
.pd-pad[data-l="held"] { background: var(--pc); box-shadow: inset 0 0 0 3px rgba(255, 255, 255, 0.92), 0 0 16px -2px var(--pc); transition: none; }
.pd-pad[data-hit="0"] { animation: pd-f0 ${FLASH_MS + 40}ms ease-out; } .pd-pad[data-hit="1"] { animation: pd-f1 ${FLASH_MS + 40}ms ease-out; }
@keyframes pd-f0 { from { background: var(--pc); box-shadow: 0 0 14px -2px var(--pc); } }
@keyframes pd-f1 { from { background: var(--pc); box-shadow: 0 0 14px -2px var(--pc); } }
.pd-pad[data-l="held"][data-hit] { animation: none; }
.pd-pad::before { content: attr(data-name); position: absolute; left: 6px; right: 6px; bottom: 5px; font: 600 10.5px/1.1 var(--ui, system-ui); color: rgba(255, 255, 255, 0.86);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); }
.pd-pad::after { content: attr(data-no); position: absolute; left: 6px; top: 4px; font: 600 9px/1 var(--mono, monospace); color: rgba(255, 255, 255, 0.45); pointer-events: none; }
.pd-pad[data-l="lit"]::before, .pd-pad[data-l="held"]::before { color: #101114; text-shadow: none; }
.pd-pad[data-l="lit"]::after, .pd-pad[data-l="held"]::after { color: rgba(16, 17, 20, 0.6); }
.pd-pad[data-warn]::after { content: '!'; left: auto; right: 6px; width: 12px; height: 12px; border-radius: 6px; background: var(--hot, #f2a33a); color: #101114; text-align: center; line-height: 12px; }
.pd-grid[data-kb] > .pd-pad:focus { box-shadow: 0 0 0 2px #0c0d0f, 0 0 0 4px var(--hot, #f2a33a); }
.pd-pad[data-learn] { animation: pd-learn 0.8s ease-in-out infinite alternate; }
@keyframes pd-learn { from { box-shadow: 0 0 0 2px var(--hot, #f2a33a); } to { box-shadow: 0 0 0 5px rgba(242, 163, 58, 0.25); } }
.pd-jk { position: absolute; right: 5px; top: 5px; width: 16px; height: 16px; border-radius: 50%; visibility: hidden; pointer-events: none; touch-action: none;
  background: radial-gradient(circle, var(--pc) 0 3.5px, #07080a 4px 5px, var(--pc) 5.5px 6.5px, #2e333b 7px); }
.pd-body[data-pads-edit] .pd-jk { visibility: visible; pointer-events: auto; cursor: crosshair; }
.pd-body[data-pads-edit] .pd-pad { cursor: grab; }
.pd-body[data-pads-edit] .pd-pad[data-sel] { box-shadow: 0 0 0 2px #0c0d0f, 0 0 0 4px var(--hot, #f2a33a); }
.pd-body[data-pads-edit] .pd-pad[data-drag] { opacity: 0.55; } .pd-body[data-pads-edit] .pd-pad[data-drag="copy"] { opacity: 0.8; }
.pd-body[data-pads-edit] .pd-pad[data-over] { box-shadow: 0 0 0 2px #0c0d0f, 0 0 0 4px #6fe3a1; }
.pd-body[data-pads-edit] .pd-well { box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.75), 0 0 0 1.5px var(--hot, #f2a33a); }
.pd-foot { position: absolute; left: 0; right: 0; display: flex; align-items: center; gap: 6px; padding: 0 12px; box-sizing: border-box; }
.pd-fb { position: relative; height: 24px; padding: 0 9px; border-radius: 12px; border: 1px solid #2c2e34; background: #131418; color: var(--text, #e9e7e2);
  font: 600 11px/1 var(--ui, system-ui); white-space: nowrap; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
.pd-fb::before { content: ''; position: absolute; left: 50%; top: calc(0px - min(16px, max(0px, (44px * var(--ik, 1) - 24px) / 2))); width: max(100%, calc(44px * var(--ik, 1))); height: max(100%, calc(44px * var(--ik, 1))); transform: translateX(-50%); }
/* (the touch area grows to 44 screen px sideways and down — up only into the 16 world px between the grid and the footer: below 69 % zoom a centred one reached over the front edge of pads 1–2, R2-F1) */
.pd-fb[aria-pressed="true"] { border-color: var(--hot, #f2a33a); color: var(--hot, #f2a33a); background: #1d1810; }
.pd-fb:hover, .pd-fb:focus-visible { background: #1a1b20; outline: none; }
.pd-oth { margin-left: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: #9fd3e6; border-color: #2f4752; background: #10181c; } .pd-oth[hidden] { display: none; }
.cv-mod[data-pd-narrow] > .cv-bar .cv-chip, .cv-mod[data-pd-narrow] > .cv-bar .cv-sub { display: none; }
.pd-foot[data-w] { gap: 4px; padding: 0 8px; } .pd-foot[data-w] .pd-fb { padding: 0 7px; } .pd-foot[data-w="xs"] .pd-oth { display: none; }
.pd-hw { flex: none; width: 8px; height: 8px; border-radius: 4px; background: #3a3b40; margin-left: 4px; } .pd-hw[data-on] { background: #6fe3a1; box-shadow: 0 0 6px #6fe3a1; }
.pd-hw[hidden] { display: none; } .pd-oth[hidden] + .pd-hw { margin-left: auto; }
.pd-outline { position: absolute; left: 0; top: 0; pointer-events: none; border: 2px dashed var(--hot, #f2a33a); border-radius: 10px; box-sizing: border-box; z-index: 5; }
.pd-pop { z-index: 60; width: 300px; max-height: min(78vh, 640px); overflow: auto; padding: 8px 12px 12px; border-radius: 12px; border: 1px solid var(--line2, #34363c);
  background: var(--pop, rgba(23, 24, 28, 0.97)); color: var(--text, #e9e7e2); font: 12px/1.3 var(--ui, system-ui); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.62);
  -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); -webkit-user-select: none; user-select: none; }
.cv-mod > .pd-pop { position: absolute; left: calc(100% + 12px); top: 0; }
.pd-ph { display: flex; align-items: center; gap: 8px; margin: 0 -4px 6px 0; } .pd-pt { flex: 1; font-weight: 700; font-size: 13px; }
.pd-x { width: 28px; height: 28px; border-radius: 14px; border: 0; background: transparent; color: var(--mute, #8d8b86); font-size: 14px; }
.pd-h { margin: 10px 0 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--mute, #8d8b86); }
.pd-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 4px 0; } .pd-rl { min-width: 64px; color: var(--mute, #8d8b86); }
.pd-tgt { display: flex; flex-wrap: wrap; gap: 4px 6px; padding: 6px; margin: 4px 0; border-radius: 8px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--line, #24262b); }
.pd-sel, .pd-in { height: 28px; max-width: 100%; border-radius: 6px; border: 1px solid var(--line, #24262b); background: var(--bg2, #141518); color: var(--text, #e9e7e2); font-size: 12px; padding: 0 6px; }
.pd-in { width: 140px; -webkit-user-select: text; user-select: text; }
.pd-step { display: inline-flex; align-items: center; border: 1px solid var(--line, #24262b); border-radius: 6px; overflow: hidden; }
.pd-sb { width: 30px; height: 28px; border: 0; background: var(--bg2, #141518); color: var(--text, #e9e7e2); font-size: 15px; }
.pd-sv { min-width: 44px; text-align: center; font: 600 12px/1 var(--mono, monospace); }
.pd-seg { display: inline-flex; border: 1px solid var(--line, #24262b); border-radius: 6px; overflow: hidden; }
.pd-sg, .pd-tb, .pd-tg { height: 28px; padding: 0 10px; border: 0; background: var(--bg2, #141518); color: var(--text, #e9e7e2); font: 600 11.5px/1 var(--ui, system-ui); }
.pd-tb, .pd-tg { border: 1px solid var(--line, #24262b); border-radius: 6px; }
.pd-sg + .pd-sg { border-left: 1px solid var(--line, #24262b); }
.pd-sg[aria-pressed="true"], .pd-tg[aria-pressed="true"], .pd-tb[aria-pressed="true"] { color: var(--hot, #f2a33a); background: #1d1810; }
.pd-go { border-color: #5b4520; }
.pd-cols { display: grid; grid-template-columns: repeat(8, 22px); gap: 5px; }
.pd-sw { width: 22px; height: 22px; border-radius: 6px; border: 1px solid rgba(0, 0, 0, 0.5); background: var(--pc); padding: 0; }
.pd-sw[aria-pressed="true"] { box-shadow: 0 0 0 2px #0c0d0f, 0 0 0 4px var(--text, #e9e7e2); }
.pd-note { color: var(--mute, #8d8b86); font-size: 11px; } .pd-warn { color: var(--hot, #f2a33a); font-size: 11.5px; margin: 2px 0 6px; }
.pd-rows { margin: 4px 0 0 16px; padding: 0; color: var(--text, #e9e7e2); font-size: 11.5px; }
.cv-cable-g[data-kind="note"] .cv-cable { stroke-width: calc(2px * var(--ik, 1)); stroke-dasharray: calc(9px * var(--ik, 1)) calc(5px * var(--ik, 1)); }
@media (prefers-reduced-motion: reduce) { .pd-pad { transition: none; } .pd-pad[data-hit], .pd-pad[data-learn] { animation: none; } }
`;
const styled = new WeakSet();
/** The Pads module's CSS, injected once per document (no style.css edit this stage). */
export function ensureCSS(doc) {
  if (!doc || typeof doc.createElement !== 'function') return null;
  let s = typeof doc.getElementById === 'function' ? doc.getElementById(CSS_ID) : null;
  const at = doc.head || doc.documentElement;
  if (!s && !styled.has(doc) && at && typeof at.appendChild === 'function') {
    s = doc.createElement('style');
    s.id = CSS_ID; s.textContent = CSS;
    at.appendChild(s);
    styled.add(doc);
  }
  return s;
}
