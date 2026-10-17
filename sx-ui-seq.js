// sx-ui-seq.js — the sequencer and keyboard panels of the Serum-style instrument (SPEC-serum2 §11.14, §13.7–§13.9;
// inv B21–B23): the ARP page (with the pattern editor overlay), the CLIP page with its piano roll, lanes, recording and
// macros pane, the keyboard strip at the bottom of every page and the OSC MAPPING editor. Owner U4. Touch first: every
// gesture works with one finger (long-press = context menu with every action, double-tap = add / delete / typed entry),
// two fingers pan / pinch-zoom the piano roll; the touch modifier latches (wk.modifierBar) stand in for Shift / Alt.
//
// The panels never see the main.js host's edit path: like sx-ui-osc they receive serum-ui's binding kit (makeKit,
// §11.14 "Binding kit"; the `host` argument of the §11.14 signatures is that kit) — destination widgets with halos,
// drag-to-modulate drops, knob menus, MIDI learn and locks; state edits through kit.edit (undo, dirty state, repaint);
// kit.host for the §11.15 host members (seqCmd, tracks, onInput, clipToTrack, download, audition, storage, bpm).
// Every host member is optional: a missing one disables its action with a notice ("… is not available") or disables its
// control. What this panel expects of them (the hand-off to I; members marked † are requested contract additions):
//   host.tracks()        the OTHER tracks of the project [{id, name, model}] — never the panel's own track (MIDI OUT to
//                        itself would feed its generated notes back into its own sequencer; Copy to Track onto itself)
//   host.onInput(fn|null) every live note main.js plays on this track (Web MIDI, the app's own keys) as fn(on, n, vel, t):
//                        vel = MIDI velocity 1–127 (a note-on with velocity 0 is a note-off), t = ms on the
//                        performance.now clock (Web MIDI event.timeStamp; default: now). It must NOT report the panel's
//                        own host.audition calls (keyboard strip, piano-roll previews): the panel records its keyboard
//                        strip itself and never records previews. The subscription may stay on while the panel is open
//                        (the keyboard strip lights up input notes, §13.9)
//   host.clipToTrack(trackId, notes)   notes = seq-core clipTrackNotes(clip, 0): [{t, d, n, v}] in song ticks relative to
//                        the paste point (§7.5.6 with playhead 0); main.js adds the song playhead to every t
//   host.metronome(on) † the app's metronome on / off while a clip is recorded (RECORD > METRO); absent → METRO disabled
//   host.latency()     † the heard delay after render in s, the playhead's (§13.8 record timing; may be slightly
//                        negative: a Latency setting past the clock's own delay); absent → 0
//   kit.snapTime()     † (U1) receive time of the current snapshot, performance.now ms; absent → the first live() call
//                        that sees the snapshot
//
//   new ArpPage(root, kit)          ARP page (§13.7): GLOBAL · slots · PATTERN · TRANSPOSE · PLAYBACK · RETRIGGER ·
//                                   VELOCITY · MIDI OUT, the ⋯ menu (Lock Module, MIDI Input Trigger Octave, Show
//                                   Pattern Names) and the pattern editor overlay (openPattern / closePattern; open while
//                                   s.ui.arpEd and SHAPE = Pattern). Members: el, sec, slots, patEd (open editor or null)
//   new ClipPage(root, kit)         CLIP page (§13.8): GLOBAL · slots · CLIP SETTINGS · piano roll (+ tool bar) · lanes ·
//                                   RECORD · MIDI OUT · MACROS pane (hidden until toggled). Members: el, sec, slots,
//                                   roll (PianoRoll on the selected clip), lanes, rec (recording state or null),
//                                   record(on), commitTake(), undoTake(), finishRecord()
//   new KeyboardPanel(root, kit)    keyboard strip (§13.9): TRANSPOSE · KEY · SCALE · SWING (+ division) · OSC MAPPING ·
//                                   piano keys (2–7 octaves by width) · ARP keys (purple) · CLIP keys (green);
//                                   collapsible (s.ui.kbdOpen). Members: el, sec, keys, arpKeys, clipKeys
//   new OscMapEditor(root, kit)     OSC MAPPING editor (§13.9): rows OSC A · OSC B · OSC C · Noise · Sub · ARP, KEY / VEL
//                                   tabs, a range bar per row (drag edges / body, double-tap to type "C1–G7" / "1–127"),
//                                   FOLD and WARP per row (no WARP for ARP); opened by KeyboardPanel through kit.popover
//   new PianoRoll(root, o)          piano roll widget (below); also the graph of the arp pattern editor (o.kind 'pat')
//   rollHit(notes, view, x, y)      pure: piano-roll hit test
//   laneValueAt(lane, x)            pure: automation-lane value
//   foldRows(notes, key, scale, mode)   pure: rows of the piano roll
// Further pure helpers (node-tested; not part of the §11.14 contract):
//   lenText(len16) / lenParse(text, max)   LENGTH fields: sixteenths ↔ "bars.beats.16ths" (1.0.0 = one bar)
//   laneWrite(lane, x0, x1, y)       an automation lane with the span (x0, x1] overwritten by y (macro-knob recording)
//   rateRemap(n, from, to)           arp RATE n kept at the nearest ladder entry when DOT / TRIP change the ladder
//   swingN(s) / swingS(n)            SWING value s ∈ [−1, 1] ↔ the field's n (300 steps: 0.25 % in Live's convention)
//
// Every class: .el (its root element, appended to root when root is given) and destroy() (idempotent). Pages repaint
// through the kit: each page registers ONE kit.custom (its own widget list, so widgets made after the build — overlays,
// popovers, rebuilt menus — never land on serum-ui's page lists) and one kit.live (snapshot-driven play states,
// playheads, recording; fn(shown): nothing is painted while the page is hidden, §13.1, but a CLIP recording goes on).
// OscMapEditor and PianoRoll are editors: refresh() redraws when what they show changed.
//
// Virtual destinations (§3.11.3): arp.rate … arp.wrange and clip.trans / clip.rate / clip.offset have no s.p entry —
// their base is the selected slot's / clip's n.* (§2.4). Their knobs are wk knobs bound here to slots[sel].n and carry
// data-dest, so halos, drag-to-modulate and the knob menu work as on any destination. They are not kit.knob widgets
// because arp.rate's base is n.rate in BPM mode and n.hz in HZ mode (§2.4.1; seqT.arp carries both and the sequencer
// reads n.hz when bpm = 0, §4.4) — the kit's virtGet / virtSet (U1) and serum-core destBase / setDestBase (C1) map it the
// same way (RULINGS2 C1/U1), so the halo, Reset Control, Enter Value and MIDI learn address n.hz in HZ mode —, and the
// macro knobs of the CLIP page also write their lane while a clip is recorded. EDIT ALL (or Alt / the Alt latch of the gesture making the edit) writes every slot / clip (§7.4.6 "Edit All
// is a UI behaviour"): slot / clip parameters and pattern settings; the pattern's event graph and the clip notes are
// edited on the selected slot only.
//
// PianoRoll(root, o) — o (functions are read on every refresh):
//   doc          the document (default root.ownerDocument, then globalThis.document)
//   kind         'clip' (default: records [t16, len16, note, vel, mute, x, y, z] in obj.notes) | 'pat' (arp pattern
//                events [t16, len16, row, vel, accent] in obj.ev; rows ±1…±16, plus any used row up to ±32)
//   clip()       the clip slot ({len, start, off, offQ, notes, lanes}, §2.4.2) or pattern ({len, ev, …}) or null
//   edit(fn, e)  state edit: fn(obj) mutates the live clip / pattern in place; e = {label, phase} (ClipPage → kit.edit)
//   key(), scale()   s.kbd.key (−1 off, 0–11) and s.kbd.scale (scale shading, Fold scale + used, Conform to Scale)
//   playhead()   playhead of the clip / pattern in sixteenths (snapshot seq) or −1
//   audition     {on(n, vel 0–1), off(n)} for the headphones note preview (the Phase-1 host.audition) or null
//   record()     null, or the record overlay {notes: pending notes (drawn red until committed)}
//   zoom(), setZoom([zx, zy])   s.ui.clipZoom (horizontal / vertical zoom factors)
//   grid(), setGrid(g)   optional: the editor grid stored in the state (the pattern's pat.grid); else a view state
//   notify(text) optional: notices (limits)
//   maxRecs()    optional: the most records the clip may hold now (the clip's share of the 4096-note bank, §2.4.2);
//                an edit that would add records beyond it is refused with a notice
//   keys()       optional: false turns the keyboard shortcuts off (the "Keyboard shortcuts" preference, §13.10)
//   viewKey()    optional: what the roll shows (e.g. the selected clip index); a change re-centres it vertically
// Methods: refresh(); tick() (playhead only); view() → the current geometry in rollHit's `view` form; command(name,
//   arg) → true when applied, the single entry point of the keyboard shortcuts, the long-press / context menus and the
//   page's buttons:
//   view   'fold' (0 off · 1 used notes · 2 scale + used), 'grid' (GRID_LADDER index), 'zoom' ([zx, zy]),
//          'audition' (0 / 1, the headphones toggle);
//   notes  'up' 'down' (semitone / row) · 'octUp' 'octDown' · 'left' 'right' (grid step) · 'shorter' 'longer' · 'cut'
//          'copy' 'paste' 'duplicate' 'delete' 'selectAll' 'selectNone' · 'chop' · 'conform' · 'legato' · 'mute' (clip) /
//          'accent' (pat) · 'quantize' (arg strength, default 1) · 'reverse' · 'scaleTime' (arg 0.5 | 2) · 'double'
//          (Double Entire Clip) · 'scaleClip' (arg 0.5 | 2) · 'wrapHere' (Wrap Clip to Begin Here, §7.5.6, clip);
//          the moves / resizes need a selection, the other note operations apply to the selection or, with none, to
//          every note; cut / copy / delete / duplicate act on the time range when one is selected (drag in the ruler),
//          paste overwrites (and splits) at the range when the clipboard holds a range, else adds at the cursor. A
//          time range and a note selection exclude each other (selecting notes clears the range and vice versa)
//   Members: sel (selected indices), range ([t0, t1) sixteenths or null), cursor (paste position).
//   Gestures: ruler — drag the start flag (clip), the length flag and the offset marker (clip; menu: Wrap Clip to Begin
//   Here, Quantize ▸), else a time-range selection (tap clears it); key column — audition; notes — press selects
//   (Shift / Shift latch toggles), drag moves (snapped to the grid; Alt = free), the ends resize, double-tap / double-
//   click deletes; empty space — drag = marquee (Shift adds), double-tap / double-click adds a note (grid length,
//   newest note orange); two fingers pan / pinch (wk.zoomPan), wheel scrolls rows, Ctrl/⌘-wheel zooms. A gesture works
//   on the geometry of its start (rows, scroll, zoom): what it edits never scrolls the roll under the pointer.
//   Keys (with the roll focused; off with the preference): §13.8, except Quantize = Q (also ⌘/Ctrl+Q where the browser
//   passes it on: macOS browsers quit on ⌘Q before the page sees it — deviation from §13.8's ⌘Q).
//
// seq-core.js (D6) exports are read through serum-core's namespace (serum-core re-exports seq-core, §11.1), so this
// module never instantiates seq-core under a second specifier. graph.js is used only through gx.CurveEditor (checked
// at use: the serum-ui unit tests map graph.js to a stub).
//
// Browser ES module: nothing touches document / window / storage at module top level (node imports it for tests).
import * as core from './serum-core.js?v=10';
import * as wk from './wk.js?v=10';
import * as gx from './graph.js?v=10';

/* ================================================================ small helpers */

const fin = x => typeof x === 'number' && isFinite(x);
const arr = x => (Array.isArray(x) ? x : []);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const clamp01 = x => (x > 0 ? (x < 1 ? x : 1) : 0);
const r5 = x => Math.round(x * 1e5) / 1e5 + 0;
const pc12 = n => ((n % 12) + 12) % 12;
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const docOf = (root, o) => (o && o.doc) || (root && root.ownerDocument) || globalThis.document;
const isMac = () => { const n = globalThis.navigator; return !!n && /Mac|iPhone|iPad|iPod/.test(n.platform || ''); };
const modKey = e => !!(e && (isMac() ? e.metaKey : e.ctrlKey));
const mods = e => (wk.modifierBar && wk.modifierBar.mods ? wk.modifierBar.mods(e) : { fine: !!(e && e.shiftKey), alt: !!(e && e.altKey), shift: !!(e && e.shiftKey) });
const consume = () => { if (wk.modifierBar && wk.modifierBar.consume) wk.modifierBar.consume(); };
// gesture.js's synthetic pointercancel: a second finger made this touch a pan / pinch — the drag is rolled back
const twoF = e => !!e && e.gesture === 'two-finger';
const NOTE_NAMES =['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = n => NOTE_NAMES[pc12(n)] + (Math.floor(n / 12) - 1);   // app naming: C4 = 60
const BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const destOf = id => { const i = core.DEST_INDEX[id]; return i === undefined ? null : core.DESTS[i]; };
const gridOf = d => (!d ? 0 : d.law === 'int' ? d.hi - d.lo : d.law === 'enum' ? d.hi : d.law === 'bool' ? 1 : 0);
// n snapped to the grid of a stepped destination (as normalizeArp / normalizeClip store the n.* bases), else 5 decimals
const snapN = (id, n) => { const m = gridOf(destOf(id)), v = clamp01(+n || 0); return m ? Math.round(v * m) / m + 0 : r5(v); };
const warnOnce = (() => { const seen = new Set(); return (k, ...a) => { if (!seen.has(k)) { seen.add(k); console.warn(...a); } }; })();
const now = () => (globalThis.performance && typeof globalThis.performance.now === 'function' ? globalThis.performance.now() : Date.now());

function mk(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}
function btn(doc, cls, label, title, onClick) {
  const b = mk(doc, 'button', cls, label);
  b.type = 'button';
  if (title) { b.setAttribute('aria-label', title); b.title = title; }
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
// an empty page section: <div class="sx-seqsec" data-sec="name"><span class="sx-ttl">TITLE</span><div class="sx-seqbody"></div></div>
function section(doc, name, title) {
  const el = mk(doc, 'div', 'sx-seqsec'), body = mk(doc, 'div', 'sx-seqbody');
  el.setAttribute('data-sec', name);
  if (title) { el.appendChild(mk(doc, 'span', 'sx-ttl', title)); el.setAttribute('aria-label', title); }
  el.appendChild(body);
  return { el, body };
}
function sections(doc, parent, list) {
  const out = {};
  for (const [name, title] of list) { const S = section(doc, name, title); parent.appendChild(S.el); out[name] = S.body; }
  return out;
}
// context menu under an anchor element (buttons, keyboard)
function menuAt(anchor, items) {
  const r = anchor.getBoundingClientRect();
  return wk.contextMenu(r.left, r.bottom + 2, items, { anchor });
}
// right-click / long-press / ContextMenu key on el → fn(x, y)
function ctxSource(el, fn, offs) {
  const off = wk.menuSource(el);
  const h = e => { e.preventDefault(); e.stopPropagation(); fn(e.clientX, e.clientY); };
  el.addEventListener('contextmenu', h);
  offs.push(off, () => el.removeEventListener('contextmenu', h));
}
// content hash of a record list (notes / events / strums): changes on any value, also for in-place edits; with nf, only
// the first nf fields of each record count (the selection key: time, length, pitch — lane edits keep a selection)
function hashRecs(L, nf) {
  const list = arr(L);
  let h = (0x811c9dc5 ^ list.length) >>> 0;
  for (const r of list) {
    if (!Array.isArray(r)) { h = Math.imul(h ^ 0x9e37, 16777619); continue; }
    for (let k = 0, m = nf > 0 ? Math.min(nf, r.length) : r.length; k < m; k++) {
      const v = Math.round((+r[k] || 0) * 1e5);
      h = Math.imul(h ^ (v & 0xffff), 16777619);
      h = Math.imul(h ^ ((v >>> 16) & 0xffff), 16777619);
    }
    h = Math.imul(h ^ 0x55, 16777619);
  }
  return (h >>> 0).toString(36);
}
// snapshot sequencer block (§7.10) or null
function seqOf(kit) {
  const sn = kit && typeof kit.snap === 'function' ? kit.snap() : null, q = sn && sn.seq;
  return q && q.length >= 11 ? q : null;
}
function hostFn(kit, name) { const h = kit && kit.host; return h && typeof h[name] === 'function' ? h[name].bind(h) : null; }
function storeGet(kit, k) {
  try { const st = kit && kit.host && kit.host.storage; return st && st.get ? st.get(k, null) : null; } catch (err) { warnOnce('get' + k, 'sx-ui-seq: storage', err); return null; }
}
function storeSet(kit, k, v) {
  try {
    const st = kit && kit.host && kit.host.storage;
    if (st && st.set) { st.set(k, v); return true; }
  } catch (err) { warnOnce('set' + k, 'sx-ui-seq: storage', err); }
  return false;
}
const bpmOf = kit => { const f = hostFn(kit, 'bpm'); const b = f ? +f() : 120; return b > 0 ? b : 120; };
const fctxOf = kit => ({ s: kit.s(), fx: kit.fx ? kit.fx() : null, bpm: bpmOf(kit) });
// the "Keyboard shortcuts" preference (§13.10; on unless the panel's prefs turn it off)
const keysOn = kit => { let p = null; try { p = kit && typeof kit.prefs === 'function' ? kit.prefs() : null; } catch (err) { p = null; } return !p || p.keys === undefined || p.keys === null || !!p.keys; };

/* ================================================================ styles (injected once per document) */

const CSS = `
.sx-arp { --sx-seqc: var(--sx-arp, #b07cff); } .sx-clip { --sx-seqc: var(--sx-clip, #3ddc84); }
.sx-seqpage > .sx-pbody { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(min(250px, 100%), 1fr)); align-items: start; }
.sx-seqsec { position: relative; min-width: 0; padding: 6px 8px 8px; background: var(--sx-panel2, #1c232b); border: 1px solid var(--sx-line, #2a333d); border-radius: 6px; }
.sx-seqsec > .sx-ttl { display: block; margin: 0 0 4px; color: var(--sx-mute, #7f8b98); font-weight: 800; font-size: 10px; letter-spacing: 0.1em; }
.sx-seqbody { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 6px 8px; min-width: 0; }
.sx-seqbody > .wk-menu { flex: 1 1 110px; min-width: 0; }
.sx-seqsec[data-sec="slots"], .sx-seqsec[data-sec="roll"], .sx-seqsec[data-sec="lanes"], .sx-seqsec[data-sec="macros"] { grid-column: 1 / -1; }
.sx-seqsec.sx-hide { display: none; }
.sx-seqbtn { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-height: 26px; min-width: 26px; padding: 2px 8px; color: var(--sx-ink, #dfe6ee); background: var(--sx-panel, #161b21); border: 1px solid var(--sx-line, #2a333d); border-radius: 5px; font: inherit; font-size: 11px; cursor: pointer; white-space: nowrap; }
.sx-seqbtn:hover { border-color: var(--sx-mute, #7f8b98); }
.sx-seqbtn[aria-pressed="true"] { color: var(--sx-bg, #0f1216); background: var(--sx-seqc, #4fb3ff); border-color: transparent; }
.sx-seqbtn:disabled, .sx-seqbtn[aria-disabled="true"] { opacity: 0.4; cursor: default; }
.sx-seqbtn:focus-visible { outline: 2px solid var(--sx-accent, #4fb3ff); outline-offset: 1px; }
.sx-bankbtn { max-width: 200px; overflow: hidden; text-overflow: ellipsis; justify-content: flex-start; font-weight: 600; }
.sx-slots { display: grid; grid-template-columns: repeat(14, minmax(0, 1fr)); grid-auto-rows: minmax(40px, auto); gap: 4px; width: 100%; }
.sx-slot { position: relative; display: flex; align-items: stretch; gap: 2px; min-width: 0; padding: 2px 2px 8px; background: var(--sx-panel, #161b21); border: 1px solid var(--sx-line, #2a333d); border-radius: 6px; touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.sx-slot.sx-blk { background: #0f1317; }
.sx-slot.sx-sel { border-color: var(--sx-seqc); box-shadow: 0 0 0 1px var(--sx-seqc) inset; }
.sx-arp .sx-slot.sx-play { background: rgba(176, 124, 255, 0.18); } .sx-clip .sx-slot.sx-play { background: rgba(61, 220, 132, 0.16); }
.sx-slotname { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 4px; color: var(--sx-ink, #dfe6ee); background: none; border: 0; font: inherit; font-size: 10px; text-align: left; cursor: pointer; }
.sx-slotplay { flex: 0 0 auto; width: 26px; padding: 0; color: var(--sx-mute, #7f8b98); background: var(--sx-panel2, #1c232b); border: 1px solid var(--sx-line, #2a333d); border-radius: 4px; font: inherit; cursor: pointer; }
.sx-slot.sx-play .sx-slotplay { color: var(--sx-seqc); border-color: var(--sx-seqc); }
.sx-rhythm { position: absolute; left: 4px; right: 32px; bottom: 2px; height: 4px; pointer-events: none; }
.sx-rollbar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; width: 100%; }
.sx-rollbar .wk-menu { flex: 0 1 120px; }
.sx-roll { position: relative; width: 100%; height: 300px; background: #0a0d10; border: 1px solid var(--sx-line, #2a333d); border-radius: 6px; overflow: hidden; touch-action: none; outline: none; user-select: none; -webkit-user-select: none; }
.sx-roll:focus-visible { border-color: var(--sx-accent, #4fb3ff); }
.sx-roll.sx-nokeys:focus-visible { border-color: var(--sx-line, #2a333d); }
.sx-roll canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; }
.sx-roll .sx-rollov { pointer-events: none; }
.sx-lanes { width: 100%; display: grid; gap: 4px; }
.sx-lanetabs { display: flex; flex-wrap: wrap; gap: 2px; }
.sx-lanetab { min-height: 24px; padding: 2px 8px; color: var(--sx-mute, #7f8b98); background: var(--sx-panel, #161b21); border: 1px solid var(--sx-line, #2a333d); border-radius: 4px; font: inherit; font-size: 10px; font-weight: 700; cursor: pointer; }
.sx-lanetab[aria-selected="true"] { color: var(--sx-bg, #0f1216); background: var(--sx-seqc, #4fb3ff); border-color: transparent; }
.sx-lanecv { display: block; width: 100%; height: 72px; background: #0a0d10; border: 1px solid var(--sx-line, #2a333d); border-radius: 6px; touch-action: none; }
.sx-laneauto { display: grid; gap: 4px; }
.sx-laneauto .sx-txt { color: var(--sx-mute, #7f8b98); font-size: 11px; }
.sx-seqov { position: absolute; inset: 0; z-index: 50; display: flex; flex-direction: column; gap: 6px; padding: 8px; background: rgba(9, 11, 14, 0.97); border-radius: 8px; overflow: auto; }
.sx-seqovhead { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
.sx-seqovhead .sx-ttl { font-weight: 800; font-size: 11px; letter-spacing: 0.1em; }
.sx-seqovhead .sx-grow { flex: 1 1 auto; }
.sx-seqrow { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 6px 8px; }
.sx-seqrow .wk-menu { flex: 0 1 130px; min-width: 0; }
.sx-kbd > .sx-pbody { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 6px 10px; }
.sx-kbd.sx-collapsed > .sx-pbody { display: none; }
.sx-kbd .sx-seqsec { padding: 4px 6px; }
.sx-kbd .sx-seqsec[data-sec="keys"] { flex: 1 1 320px; }
.sx-kbd .sx-seqsec[data-sec="keys"] .wk-piano { width: 100%; height: 72px; }
.sx-kbd .sx-seqsec[data-sec="arpkeys"] .wk-piano { width: 120px; height: 44px; --wk-pc: var(--sx-arp, #b07cff); }
.sx-kbd .sx-seqsec[data-sec="clipkeys"] .wk-piano { width: 120px; height: 44px; --wk-pc: var(--sx-clip, #3ddc84); }
.sx-trans { display: inline-flex; align-items: flex-end; gap: 2px; }
.sx-oscmaprows { display: grid; gap: 6px; }
.sx-oscmaprow { display: grid; grid-template-columns: 56px minmax(0, 1fr) auto auto; align-items: center; gap: 6px; }
.sx-oscmaprow > .sx-ttl { font-size: 10px; font-weight: 700; color: var(--sx-mute, #7f8b98); }
.sx-oscmaptabs { display: flex; gap: 2px; margin-bottom: 6px; }
.sx-oscmaptabs [aria-selected="true"] { color: var(--sx-bg, #0f1216); background: var(--sx-accent, #4fb3ff); }
.sx-oscmap.sx-keytab .wk-rbt { background-repeat: repeat-x; background-size: 9.375% 100%;
  background-image: linear-gradient(90deg, transparent 8.33%, rgba(0, 0, 0, 0.45) 8.33% 16.67%, transparent 16.67% 25%, rgba(0, 0, 0, 0.45) 25% 33.33%,
    transparent 33.33% 50%, rgba(0, 0, 0, 0.45) 50% 58.33%, transparent 58.33% 66.67%, rgba(0, 0, 0, 0.45) 66.67% 75%, transparent 75% 83.33%,
    rgba(0, 0, 0, 0.45) 83.33% 91.67%, transparent 91.67%); }
@media (max-width: 1099px) { .sx-seqov { position: fixed; z-index: 1000; border-radius: 0; } }
.sx-recbtn[aria-pressed="true"] { color: #0f1216; background: #ff5b5b; border-color: transparent; }
.sx-macpane { display: grid; grid-template-columns: repeat(auto-fill, minmax(68px, 1fr)); gap: 4px; width: 100%; }
@media (pointer: coarse) {
  .sx-seqbtn, .sx-slotplay, .sx-lanetab { min-height: 44px; min-width: 44px; }
  .sx-slot { min-height: 52px; }
  .sx-roll { height: 360px; }
  .sx-lanecv { height: 96px; }
}
.wk-touch .sx-seqbtn, .wk-touch .sx-slotplay, .wk-touch .sx-lanetab, .sx-touch .sx-seqbtn, .sx-touch .sx-slotplay, .sx-touch .sx-lanetab { min-height: 44px; min-width: 44px; }
.wk-touch .sx-slot, .sx-touch .sx-slot { min-height: 52px; }
.wk-touch .sx-roll, .sx-touch .sx-roll { height: 360px; }
.wk-touch .sx-lanecv, .sx-touch .sx-lanecv { height: 96px; }
`;
// (the touch rules apply under a coarse pointer or once any touch was seen, §13.1: an iPad with a trackpad reports a
// fine pointer — wk marks <html> with wk-touch, serum-ui its root with sx-touch)
function injectSeqStyles(doc) {
  if (!doc || !doc.createElement || (doc.getElementById && doc.getElementById('sx-seq-css'))) return;
  if (wk.injectStyles) { try { wk.injectStyles(doc); } catch (err) { /* stub documents */ } }
  const s = doc.createElement('style');
  s.id = 'sx-seq-css';
  s.textContent = CSS;
  (doc.head || doc.documentElement || doc.body).appendChild(s);
}

/* ================================================================ pure helpers */

// Semitone steps of a scale: an array of steps as given, or a SCALES index (§3.15.7; seq-core through serum-core).
// null when unknown (index out of range).
function scaleSteps(scale) {
  if (Array.isArray(scale)) return scale;
  const S = core.SCALES, e = Array.isArray(S) && Number.isInteger(scale) ? S[scale] : null;
  return e && Array.isArray(e.steps) ? e.steps : null;
}

// Rows of the piano roll, ascending MIDI notes (row 0 = the bottom row).
//   notes  clip notes [[t16, len16, note, …], …] (§2.4.2; the pitch is entry [2]; non-integer / out-of-range pitches
//          are ignored)
//   key    −1 (KEY "--") or 0–11;  scale  SCALES index (s.kbd.scale) or an array of semitone steps from the key
//   mode   0 Off: every note 0–127 · 1 Fold to the used notes · 2 Fold to the scale + the used notes (the scale's
//          pitch classes from the key over 0–127, plus every used note; with key −1 or an unknown scale as mode 1)
// A fold that would leave no row (mode 1 on an empty clip) gives every row.
export function foldRows(notes, key, scale, mode) {
  const used = new Uint8Array(128);
  let any = false;
  if (mode === 1 || mode === 2) {
    for (const e of arr(notes)) {
      const n = Array.isArray(e) ? e[2] : NaN;
      if (Number.isInteger(n) && n >= 0 && n <= 127) { used[n] = 1; any = true; }
    }
    const steps = mode === 2 && Number.isInteger(key) && key >= 0 && key <= 11 ? scaleSteps(scale) : null;
    if (steps) {
      const inScale = new Uint8Array(12);
      for (const st of steps) if (Number.isInteger(st)) inScale[pc12(st)] = 1;
      for (let n = 0; n < 128; n++) if (inScale[pc12(n - key)]) { used[n] = 1; any = true; }
    }
  }
  const out = [];
  for (let n = 0; n < 128; n++) if (!any || used[n]) out.push(n);
  return out;
}

// Piano-roll hit test at (x, y) px inside the roll's note area.
//   view  { t0 = 0: sixteenth at x = 0 · pps: px per sixteenth (> 0) · rows: ascending MIDI notes (foldRows) · rowH: px
//          per row (> 0) · top = 0: px of the row stack scrolled above y = 0 · edge = 6: px grab width at a note's ends }
// → { i, part, t, row, note }:
//   t     time at x in sixteenths (t0 + x / pps)
//   row   index into rows of the row at y (rows are drawn highest note on top), −1 outside the rows; note = rows[row] or −1
//   i     index in notes of the hit note (a note of that row whose span contains x; a note narrower than `edge` px is hit
//         over `edge` px), −1 for none; among overlapping notes the last one wins (the one drawn on top)
//   part  'start' | 'end' within min(edge, width / 3) px of the note's left / right end (the extension of a narrow
//         note counts as 'end'), else 'body'; '' when i = −1
// Touch zones (optional view fields, all 0 / absent by default = the test above): out px of reach past a note's end and
// slopY px above / below its row; with sel (indices of the selected notes) those apply to selected notes and outU / slopU
// (default 0) to the rest. Then the best note wins: a selected note's end / start within HWIN px of it, else one the
// point is inside, else a selected note's handle farther out, else any within reach (nearest by dx + 2·dy, the later
// on ties), and the result also carries near: the point is inside the note or on a selected note's near handle.
const HWIN = 6;
export function rollHit(notes, view, x, y) {
  const V = view || {}, rows = arr(V.rows);
  const t0 = fin(V.t0) ? V.t0 : 0, pps = fin(V.pps) && V.pps > 0 ? V.pps : 1, rowH = fin(V.rowH) && V.rowH > 0 ? V.rowH : 1;
  const top = fin(V.top) ? V.top : 0, edge = fin(V.edge) && V.edge >= 0 ? V.edge : 6;
  const res = { i: -1, part: '', t: t0 + x / pps, row: -1, note: -1 };
  if (!fin(x) || !fin(y)) { res.t = NaN; return res; }
  const fromTop = Math.floor((y + top) / rowH), row = rows.length - 1 - fromTop;
  const pos = k => (fin(V[k]) && V[k] > 0 ? V[k] : 0), out = pos('out'), slopY = pos('slopY');
  if (out || slopY) return rollHitZ(arr(notes), V, x, y, res, { t0, pps, rowH, top, edge, rows, fromTop, row, out, slopY, outU: V.sel ? pos('outU') : out, slopU: V.sel ? pos('slopU') : slopY });
  if (fromTop < 0 || row < 0) return res;
  res.row = row;
  res.note = rows[row];
  const L = arr(notes);
  for (let i = L.length - 1; i >= 0; i--) {
    const e = L[i];
    if (!Array.isArray(e) || e[2] !== res.note || !fin(e[0]) || !fin(e[1])) continue;
    const x0 = (e[0] - t0) * pps, w = Math.max(0, e[1] * pps), x1 = x0 + Math.max(w, edge);
    if (x < x0 || x >= x1) continue;
    const g = Math.min(edge, w / 3);
    res.i = i;
    res.part = x >= x0 + w - g ? 'end' : x < x0 + g ? 'start' : 'body';
    return res;
  }
  return res;
}
// rollHit with touch zones (o: its parsed view): every note within reach of the point is scored (see rollHit)
function rollHitZ(L, V, x, y, res, o) {
  if (o.fromTop >= 0 && o.row >= 0) { res.row = o.row; res.note = o.rows[o.row]; }
  const sel = V.sel ? new Set(arr(V.sel)) : null, rowOf = new Map();
  o.rows.forEach((p, i) => rowOf.set(p, i));
  let bk = -1, bd = Infinity;
  for (let i = L.length - 1; i >= 0; i--) {
    const e = L[i];
    if (!Array.isArray(e) || !fin(e[0]) || !fin(e[1])) continue;
    const ri = rowOf.get(e[2]);
    if (ri === undefined) continue;
    const s = !sel || sel.has(i), ry = (o.rows.length - 1 - ri) * o.rowH - o.top;
    const dy = y < ry ? ry - y : y >= ry + o.rowH ? y - (ry + o.rowH) + 1 : 0;
    if (dy > (s ? o.slopY : o.slopU)) continue;
    const x0 = (e[0] - o.t0) * o.pps, w = Math.max(0, e[1] * o.pps), xe = x0 + Math.max(w, o.edge);
    if (x < x0 || x >= xe + (s ? o.out : o.outU)) continue;
    const g = Math.min(o.edge, w / 3), part = x >= x0 + w - g ? 'end' : x < x0 + g ? 'start' : 'body';
    const dx = x >= xe ? x - xe + 1 : 0, hs = !!sel && s && part !== 'body';
    const k = hs ? (dx <= HWIN ? 3 : 1.5) : !dx && !dy ? 2 : 1, d = dx + 2 * dy;
    if (k > bk || (k === bk && d < bd)) { bk = k; bd = d; res.i = i; res.part = part; }
  }
  res.near = bk >= 2;
  return res;
}

// Value of an automation lane (§2.4.1 pat.lanes, §2.4.2 clip lanes: null or graph points [[x, y, curve], …] over
// x = t / len) at x (clamped to [0, 1]): y ∈ [0, 1] by the shared curve law (laws.evalPts); NaN for a null / empty lane
// or a non-finite x (the lane does not apply, §7.5.5). The DSP reads the lane through its 129-point table (§7.4.3).
export function laneValueAt(lane, x) {
  if (!Array.isArray(lane) || !lane.length || !fin(x)) return NaN;
  return core.evalPts(lane, clamp01(x));
}

// LENGTH fields: sixteenths → "bars.beats.16ths" (1.0.0 = 16 sixteenths = one bar; 0.1.0 = one beat)
export function lenText(len16) {
  const L = Math.max(0, Math.round(fin(len16) ? len16 : 0));
  return Math.floor(L / 16) + '.' + Math.floor((L % 16) / 4) + '.' + (L % 4);
}
// "bars[.beats[.16ths]]" (also ':' separators) → sixteenths in 1 … max (default 1024); null when unreadable or 0
export function lenParse(text, max) {
  const t = String(text === undefined || text === null ? '' : text).trim(), m = /^(\d+)(?:[.:](\d+)(?:[.:](\d+))?)?$/.exec(t);
  if (!m) return null;
  const v = 16 * +m[1] + 4 * (m[2] ? +m[2] : 0) + (m[3] ? +m[3] : 0), hi = fin(max) && max >= 1 ? Math.floor(max) : 1024;
  return v >= 1 ? Math.min(hi, v) : null;
}

// An automation lane with the half-open span (x0, x1] overwritten by y (macro-knob recording, §13.8): the points inside
// the span are removed — a point AT x0 (the previous write of a gesture) stays — and [x1, y] is inserted; the first /
// last point takes y when x1 is x = 0 / 1. A chain of writes (x0, x1], (x1, x2], … keeps every written point. A null lane
// starts flat at y. Points rounded to 5 decimals, ≤ 480 (the lane limit; a full lane keeps its points and only moves
// the end values). Returns a new lane.
export function laneWrite(lane, x0, x1, y) {
  const a = clamp01(Math.min(+x0, +x1)), b = clamp01(Math.max(+x0, +x1)), v = r5(clamp01(+y || 0)), eps = 1e-6;
  let P = Array.isArray(lane) && lane.length >= 2 ? lane.filter(p => Array.isArray(p) && fin(p[0]) && fin(p[1])).map(p => [r5(p[0]), r5(p[1]), fin(p[2]) ? p[2] : 0]) : null;
  if (!P || P.length < 2) P = [[0, v, 0], [1, v, 0]];
  P.sort((p, q) => p[0] - q[0]);
  P[0][0] = 0;
  P[P.length - 1][0] = 1;
  const last = P.length - 1;
  P = P.filter((p, i) => i === 0 || i === last || p[0] <= a + eps || p[0] > b + eps);
  if (b <= eps) P[0][1] = v;
  else if (b >= 1 - eps) P[P.length - 1][1] = v;
  else if (P.length < 480) {
    let i = 1;
    while (i < P.length - 1 && P[i][0] < b - eps) i++;
    if (Math.abs(P[i][0] - b) <= eps && i < P.length - 1) P[i] = [r5(b), v, 0];
    else P.splice(i, 0, [r5(b), v, 0]);
  }
  return P;
}

// A clip lane (over x = t / len) after the clip's length changed from L0 to L1 by Record EXTEND (or its undo / trim),
// keeping every point at its time: x → x·L0/L1; a longer clip holds the end value over the new bars, a shorter one ends
// with the value the lane had at the new end. ≤ 480 points (a full lane stretches its last segment). → a new lane
function laneResize(lane, L0, L1) {
  if (!Array.isArray(lane) || lane.length < 2 || !(L0 > 0) || !(L1 > 0) || L0 === L1) return lane;
  const a = L0 / L1, eps = 1e-6;
  if (a < 1) {
    const P = lane.map(p => [r5(p[0] * a), p[1], p[2] || 0]), end = P[P.length - 1][1];
    if (P.length < 480) P.push([1, end, 0]); else P[P.length - 1][0] = 1;
    P[0][0] = 0;
    return P;
  }
  const P = lane.filter(p => p[0] * a < 1 - eps).map(p => [r5(p[0] * a), p[1], p[2] || 0]);
  P.push([1, r5(clamp01(laneValueAt(lane, 1 / a))), 0]);
  if (P.length < 2) P.unshift([0, P[0][1], 0]);
  P[0][0] = 0;
  return P;
}

// Arp RATE n (BPM mode) when DOT / TRIP change the ladder (from / to = { dot, trip }): the same entry when the new
// ladder has it, else the entry without its suffix ('1/16T' → '1/16', '1/4.' → '1/4'), else the nearest by beats (log
// distance; ties → the earlier = straight entry)
export function rateRemap(n, from, to) {
  const A = core.arpLadder(from && from.dot ? 1 : 0, from && from.trip ? 1 : 0), B = core.arpLadder(to && to.dot ? 1 : 0, to && to.trip ? 1 : 0);
  const e0 = A[Math.round(clamp01(+n || 0) * (A.length - 1))];
  let best = B.findIndex(e => e.label === e0.label);
  if (best < 0) best = B.findIndex(e => e.label === e0.label.replace(/[.T]$/, ''));
  if (best < 0) {
    let bd = Infinity;
    B.forEach((e, i) => { const d = Math.abs(Math.log(e.beats / e0.beats)); if (d < bd - 1e-12) { bd = d; best = i; } });
  }
  return r5(best / (B.length - 1));
}

// SWING field: s ∈ [−1, 1] ↔ n ∈ [0, 1] over 300 steps (s step 1/150 = 0.25 % in Live's 50 + 37.5·s % convention)
export const swingN = s => clamp01(((fin(s) ? clamp(s, -1, 1) : 0) + 1) / 2);
export const swingS = n => r5(Math.round(clamp01(+n || 0) * 300) / 150 - 1);
function swingParse(t) {
  const q = String(t).trim().toLowerCase().replace(',', '.');
  if (q === 'off' || q === '0' || q === '50' || q === '50%') return swingN(0);
  const m = /^([+-]?\d*\.?\d+)\s*%?$/.exec(q);
  if (!m) return null;
  const p = +m[1];
  if (!(p >= 12.5 && p <= 87.5)) return null;
  return swingN((p - 50) / 37.5);
}

/* ================================================================ shared page machinery */

// One live-input event: (on, n, vel, t) or ({on, n, vel, t}) → {on, n, vel 1–127, t} or null. vel = MIDI velocity
// (rounded, clamped 1–127; a note-on with velocity 0 is a note-off, MIDI running status; a note-on without one: 100);
// t = ms on the performance.now clock (non-finite: now).
function inputEvent(a, b, c, d) {
  const o = isObj(a) ? a : { on: a, n: b, vel: c, t: d }, n = o.n;
  if (!Number.isInteger(n) || n < 0 || n > 127) return null;
  const v0 = o.vel === undefined || o.vel === null ? (o.on ? 100 : 0) : +o.vel, v = fin(v0) ? Math.round(v0) : 100;
  const on = !!o.on && v > 0;
  return { on, n, vel: on ? clamp(v, 1, 127) : 0, t: fin(o.t) ? +o.t : now(), src: o.src === 'keys' ? 'keys' : 'host' };
}
// The live input of a panel's track, per kit: host.onInput (the notes main.js plays on this track, never the panel's own
// host.audition calls) plus the keyboard strip's piano keys, which reach the engine through host.audition and are
// reported here by the strip itself (src 'keys'). Piano-roll previews are not input. host.onInput is subscribed while at
// least one listener exists; keys = keyboard strips mounted on the kit (an input source even without host.onInput).
const HUBS = new WeakMap();
function hubOf(kit) {
  let H = HUBS.get(kit);
  if (!H) { H = { subs: new Set(), host: false, keys: 0 }; HUBS.set(kit, H); }
  return H;
}
function hubEmit(kit, ev) {
  const H = HUBS.get(kit);
  if (!H || !ev) return;
  for (const f of Array.from(H.subs)) { try { f(ev); } catch (err) { warnOnce('hub', 'sx-ui-seq: input listener failed', err); } }
}
// fn(ev) on every input event → the remover
function hubAdd(kit, fn) {
  const H = hubOf(kit), f = hostFn(kit, 'onInput');
  H.subs.add(fn);
  if (f && !H.host) { H.host = true; f((a, b, c, d) => hubEmit(kit, inputEvent(a, b, c, d))); }
  return () => {
    if (!H.subs.delete(fn) || H.subs.size || !H.host) return;
    H.host = false;
    const g = hostFn(kit, 'onInput');
    if (g) { try { g(null); } catch (err) { /* the host is gone */ } }
  };
}

// Base of the pages: own widget list (updated by the page's single kit.custom), listener removers, the Alt state of
// the current gesture (EDIT ALL by Alt / the Alt latch)
class SeqPage {
  constructor(kit) {
    this.kit = kit;
    this.doc = kit.doc || globalThis.document;
    this.dead = false;
    this.ws = [];
    this.fns = [];
    this.offs = [];
    this.alt = false;
    this.sec = null;
  }
  own(w) { if (w) this.ws.push(w); return w; }
  fn(f) { this.fns.push(f); return f; }
  update() {
    if (this.dead) return;
    for (const w of this.ws) { try { w.update(); } catch (err) { warnOnce('upd', 'sx-ui-seq: widget update failed', err); } }
    for (const f of this.fns) { try { f(); } catch (err) { warnOnce('fn', 'sx-ui-seq: refresh failed', err); } }
  }
  // EDIT ALL by Alt (§7.4.6, §13.7): the Alt key / Alt latch of the gesture that makes the edit. Every gesture start on
  // the page — a press, a key, a wheel step (wheel edits fire no press) — takes it from its own event, so a plain edit
  // after an Alt gesture edits one slot; altAll() hands it to one edit and clears it at the end of that edit (a drag
  // keeps it through its start / move phases)
  watchAlt(el) {
    const p = e => { this.alt = !!mods(e).alt; }, k = e => { this.alt = !!(e && e.altKey); };
    el.addEventListener('pointerdown', p, true);
    el.addEventListener('wheel', p, { capture: true, passive: true });
    el.addEventListener('keydown', k, true);
    this.offs.push(() => {
      el.removeEventListener('pointerdown', p, true);
      el.removeEventListener('wheel', p, { capture: true, passive: true });
      el.removeEventListener('keydown', k, true);
    });
  }
  altAll(o) {
    const a = this.alt, ph = o && o.phase;
    if (ph !== 'start' && ph !== 'move') this.alt = false;
    return a;
  }
  notify(t) { if (this.kit.notify) this.kit.notify(t); }
  cmd(name, arg) {
    const f = hostFn(this.kit, 'seqCmd');
    if (!f) { this.notify('Launching from the panel is not available'); return false; }
    f(name, arg);
    return true;
  }
  fctx() { return fctxOf(this.kit); }
  // knob of a virtual destination (data-dest id): get / set over the caller's binding
  vKnob(id, label, get, set, o) {
    const O = o || {}, d = destOf(id), steps = O.steps !== undefined ? O.steps : gridOf(d);
    const w = wk.knob({ dest: id, label, size: O.size || 'md', get: () => clamp01(+get() || 0), set: (n, ph) => set(snapN(id, n), ph),
      def: O.def !== undefined ? O.def : () => d.def, fmt: n => core.fmtParam(id, n, this.fctx()), parse: t => core.parseParam(id, t, this.fctx()), steps,
      bipolar: d.ctr === 1, disabled: O.disabled });
    if (wk.tooltip) wk.tooltip(w.el, () => core.destLabel(id, this.kit.s(), this.kit.fx ? this.kit.fx() : null) + ': ' + core.fmtParam(id, get(), this.fctx()));
    return this.own(w);
  }
  tog(label, get, set, o) {
    const O = o || {};
    return this.own(wk.toggle({ label, kind: O.kind || 'btn', get: () => (get() ? 1 : 0), set: v => set(v ? 1 : 0), disabled: O.disabled }));
  }
  menu(label, items, get, set, o) {
    const O = o || {};
    return this.own(wk.menu({ label, items: typeof items === 'function' ? items : () => items, get, set: v => set(v), arrows: O.arrows !== false, wheel: true, stepGroup: O.stepGroup }));
  }
  seg(label, items, get, set, o) {
    const O = o || {};
    return this.own(wk.seg({ label, items, get, set: i => set(i), disabled: O.disabled }));
  }
  // the module's ⋯ menu entries shared by ARP and CLIP: Lock Module · MIDI Input Trigger Octave ▸. The panel title's
  // module menu (kit.panel) has its own Lock Module and gets the other entries through o.items; both lock through
  // serum-core setModuleLock (MODULE_NAMES order, per-control unlocks dropped on unlock)
  lockItem(mod) {
    const K = this.kit, locked = arr(K.s().locks && K.s().locks.mod).includes(mod);
    return { label: 'Lock Module', checked: locked, action: () => K.edit(s => { core.setModuleLock(s, mod, !locked); }, { label: 'Lock Module' }) };
  }
  trigItem(mod) {
    const K = this.kit, cur = K.s()[mod].trigOct, set = k => K.edit(s => { s[mod].trigOct = k; }, { label: 'Trigger Octave' });
    return { label: 'MIDI Input Trigger Octave', sub: [{ label: 'Off', checked: cur === 0, action: () => set(0) }]
      .concat(Array.from({ length: 11 }, (_, k) => ({ label: noteName(12 * k) + ' – ' + noteName(12 * k + 11), checked: cur === k + 1, action: () => set(k + 1) }))) };
  }
  // MIDI OUT (§7.9): Off / Clip Player / On + the target track of this project
  midiOut(body, mod) {
    const K = this.kit, M = () => K.s()[mod];
    body.appendChild(this.seg('MIDI OUT', core.MIDI_OUT.slice(), () => M().midiOut, i => K.edit(s => { s[mod].midiOut = i; }, { label: 'MIDI Out' })).el);
    const items = () => {
      const f = hostFn(K, 'tracks'), list = f ? arr(f()) : [], cur = M().outTrack;
      const out = [{ v: '', label: 'No track' }].concat(list.filter(t => t && typeof t.id === 'string' && t.id).map(t => ({ v: t.id, label: String(t.name || t.id) })));
      if (cur && !out.some(it => it.v === cur)) out.push({ v: cur, label: 'Missing track', disabled: true });
      return out;
    };
    body.appendChild(this.menu('TARGET', items, () => M().outTrack, v => K.edit(s => { s[mod].outTrack = String(v || ''); }, { label: 'MIDI Out Target' }), { arrows: false }).el);
  }
  // user library (arp banks, clip banks, pattern / clip presets): readLib over the stored list
  lib(key, type) { return core.readLib(storeGet(this.kit, key), type); }
  libSave(key, type, payload) {
    const lib = core.libPut(this.lib(key, type), payload);
    if (!storeSet(this.kit, key, lib)) { this.notify('Saving is not available'); return false; }
    return true;
  }
  libDelete(key, type, name) { storeSet(this.kit, key, core.libDel(this.lib(key, type), name)); }
  destroy() {
    if (this.dead) return;
    this.dead = true;
    for (const f of this.offs.splice(0)) { try { f(); } catch (err) { /* already gone */ } }
    for (const w of this.ws.splice(0)) if (w && w.destroy) { try { w.destroy(); } catch (err) { /* already gone */ } }
    if (this.el) this.el.remove();
  }
}

// 12 slots laid out like a keyboard octave (white keys below, black keys above, §13.7 / §13.8), slot j = key j of the
// trigger octave. o = { kind, name(j), title(j), sel(), select(j), play(j), playing(j), menu(j, x, y, anchor),
// rhythm?(j) → {len, start, notes} (CLIP: green onset strip), drag?(j, e) (desktop dragstart of a slot) }
class SlotStrip {
  constructor(page, root, o) {
    this.page = page;
    this.o = o;
    const d = page.doc;
    this.el = mk(d, 'div', 'sx-slots');
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', (o.kind === 'arp' ? 'Arp' : 'Clip') + ' slots');
    // desktop drag of a slot (deviation 21) only from a mouse press and outside touch mode: a touch long-press is the
    // slot menu (decided per gesture — an iPad with a trackpad reports a fine pointer, §13.1)
    const touchy = () => typeof wk.touchMode === 'function' && !!wk.touchMode();
    // the rhythm strips' size, from a ResizeObserver (a repaint never reads the layout)
    this.rsz = null;
    this.ro = null;
    const win = d.defaultView, RO = (win && win.ResizeObserver) || globalThis.ResizeObserver;
    if (o.rhythm && typeof RO === 'function') {
      this.ro = new RO(en => {
        const r = en && en[0] && en[0].contentRect;
        if (r && r.width > 0 && r.height > 0) { this.rsz = { w: Math.round(r.width), h: Math.round(r.height) }; for (const S of this.slots) S.rk = null; this.update(); }
      });
      page.offs.push(() => this.ro.disconnect());
    }
    this.slots = [];
    let w = 0;
    for (let j = 0; j < 12; j++) {
      const black = !!BLACK[j], s = mk(d, 'div', 'sx-slot ' + (black ? 'sx-blk' : 'sx-wht'));
      s.setAttribute('data-slot', String(j));
      s.setAttribute('role', 'group');
      s.setAttribute('aria-label', (o.kind === 'arp' ? 'Arp slot ' : 'Clip ') + NOTE_NAMES[j]);
      s.style.gridColumn = (black ? 2 * w : 2 * w + 1) + ' / span 2';
      s.style.gridRow = black ? '1' : '2';
      if (!black) w++;
      const name = btn(d, 'sx-slotname', '', null, () => o.select(j));
      const play = btn(d, 'sx-slotplay', '▶', null, () => o.play(j));
      s.append(name, play);
      let cv = null;
      if (o.rhythm) {
        cv = mk(d, 'canvas', 'sx-rhythm');
        cv.setAttribute('aria-hidden', 'true');
        s.appendChild(cv);
        if (this.ro && j === 0) this.ro.observe(cv);   // the 12 strips share one size (same CSS box)
      }
      ctxSource(s, (x, y) => o.menu(j, x, y, s), page.offs);
      if (o.drag) {
        let pt = '';
        s.setAttribute('draggable', touchy() ? 'false' : 'true');
        const pd = e => { pt = e.pointerType || 'mouse'; s.setAttribute('draggable', pt === 'mouse' && !touchy() ? 'true' : 'false'); };
        const h = e => {
          if ((pt && pt !== 'mouse') || touchy()) { e.preventDefault(); return; }
          o.drag(j, e);
        };
        s.addEventListener('pointerdown', pd, true);
        s.addEventListener('dragstart', h);
        page.offs.push(() => { s.removeEventListener('pointerdown', pd, true); s.removeEventListener('dragstart', h); });
      }
      this.el.appendChild(s);
      this.slots.push({ el: s, name, play, cv, txt: null, rk: null, on: null });
    }
    root.appendChild(this.el);
  }
  update() {
    const sel = this.o.sel();
    this.slots.forEach((S, j) => {
      const t = this.o.name(j);
      if (t !== S.txt) {
        S.txt = t;
        S.name.textContent = t;
        const tt = this.o.title(j);
        S.name.setAttribute('aria-label', tt);
        S.name.title = tt;
      }
      S.el.classList.toggle('sx-sel', j === sel);
      S.name.setAttribute('aria-pressed', j === sel ? 'true' : 'false');
      if (S.cv) this.rhythm(S, j);
    });
    this.live();
  }
  live() {
    this.slots.forEach((S, j) => {
      const on = !!this.o.playing(j);
      if (on === S.on) return;
      S.on = on;
      S.el.classList.toggle('sx-play', on);
      S.play.textContent = on ? '■' : '▶';
      const t = (on ? 'Stop ' : 'Play ') + this.o.title(j);
      S.play.setAttribute('aria-label', t);
      S.play.title = t;
    });
  }
  // the strip's size: the ResizeObserver's, else measured once (when laid out) and kept
  stripSize(cv) {
    if (this.rsz) return this.rsz;
    if (this.ro) return { w: 60, h: 4 };
    const r = cv.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) { this.rsz = { w: Math.round(r.width), h: Math.round(r.height) }; return this.rsz; }
    return { w: 60, h: 4 };
  }
  rhythm(S, j) {
    const R = this.o.rhythm(j), k = R ? R.len + '|' + R.start + '|' + hashRecs(R.notes, 5) : '';
    if (k === S.rk) return;
    S.rk = k;
    const cv = S.cv, z = this.stripSize(cv), W = Math.max(8, z.w), H = Math.max(2, z.h);
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    const g = cv.getContext ? cv.getContext('2d') : null;
    if (!g) return;
    g.clearRect(0, 0, W, H);
    if (!R) return;
    const span = Math.max(1, R.len - R.start);
    g.fillStyle = '#3ddc84';
    for (const n of arr(R.notes)) {
      if (!Array.isArray(n) || n[4] || n[0] < R.start || n[0] >= R.len) continue;
      g.fillRect(Math.floor((n[0] - R.start) / span * W), 0, Math.max(1, Math.round(n[1] / span * W)), H);
    }
  }
}

// LENGTH field: a numBox in sixteenths 1 … max shown as bars.beats.16ths; def = the length a reset gives (the schema
// default: 64 for a clip, 16 for a pattern)
function lenBox(page, label, get, set, max, def) {
  const M = () => (typeof max === 'function' ? max() : max), D = fin(def) ? def : 16;
  return page.own(wk.numBox({ label, get: () => (clamp(Math.round(get()), 1, M()) - 1) / (M() - 1), set: (n, ph) => set(Math.round(clamp01(n) * (M() - 1)) + 1, ph),
    def: () => (clamp(D, 1, M()) - 1) / (M() - 1), fmt: n => lenText(Math.round(clamp01(n) * (M() - 1)) + 1), parse: t => { const v = lenParse(t, M()); return v === null ? null : (v - 1) / (M() - 1); },
    steps: () => M() - 1 }));
}
// Gesture-scoped originals of what a LENGTH drag may cut: gMap(box, ph) → the Map (object → its copy taken at the first
// step of the gesture); each step works from the copies, so shortening and lengthening again within one drag restores
// what the shorter length had cut; gDone(box, ph) drops them after the last step (box = {} kept by the caller)
function gMap(box, ph) { if ((ph !== 'move' && ph !== 'end') || !box.m) box.m = new Map(); return box.m; }
function gDone(box, ph) { if (ph !== 'start' && ph !== 'move') box.m = null; }
function gOrig(M, obj, take) { if (!M.has(obj)) M.set(obj, take(obj)); return M.get(obj); }

/* ================================================================ ARP page (§13.7) */

const ARP_SECS = [['global', 'GLOBAL'], ['slots', 'SLOTS'], ['pattern', 'PATTERN'], ['transpose', 'TRANSPOSE'], ['playback', 'PLAYBACK'],
  ['retrigger', 'RETRIGGER'], ['velocity', 'VELOCITY'], ['midiout', 'MIDI OUT']];
const ARP_N = { 'arp.shift': 'shift', 'arp.range': 'range', 'arp.offset': 'offset', 'arp.repeats': 'repeats', 'arp.gate': 'gate',
  'arp.chance': 'chance', 'arp.rrate': 'rrate', 'arp.vdecay': 'vdecay', 'arp.vtarget': 'vtarget', 'arp.trans': 'trans', 'arp.wtrans': 'wtrans',
  'arp.wrange': 'wrange' };
let SLOT_CB = { arp: null, clip: null };   // slot clipboards (Copy / Paste Pattern, Copy / Paste Clip), shared by every panel

export class ArpPage extends SeqPage {
  constructor(root, kit) {
    super(kit);
    this.showNames = true;       // ✓ Show Pattern Names (view state)
    this.patEd = null;
    this.slots = null;
    this.el = this.build();
    if (root) root.appendChild(this.el);
  }
  A() { return this.kit.s().arp; }
  slot() { const A = this.A(); return A.slots[A.sel] || A.slots[0]; }
  // slot parameter edit: the selected slot, or every slot with EDIT ALL / Alt; marks the bank modified
  editSlots(fn, o) {
    const all = !!(this.A().editAll || this.altAll(o));
    this.kit.edit(s => { const A = s.arp, L = all ? A.slots : [A.slots[A.sel]]; for (const sl of L) if (sl) fn(sl); A.dirty = 1; }, o);
  }
  build() {
    const K = this.kit, d = this.doc;
    injectSeqStyles(d);
    const { el, head, body } = K.panel('ARP', 'arp', 'arp.on', 'sx-seqpage sx-arp', { items: () => this.moduleItems() });
    this.el = el;
    this.sec = sections(d, body, ARP_SECS);
    const more = btn(d, 'sx-hbtn sx-seqmenu', '⋯', 'ARP menu', () => menuAt(more, this.menuItems()));
    more.setAttribute('aria-haspopup', 'menu');
    head.appendChild(more);
    this.watchAlt(el);
    this.buildGlobal();
    this.buildSlots();
    this.buildPattern();
    this.buildTranspose();
    this.buildPlayback();
    this.buildRetrigger();
    this.buildVelocity();
    this.midiOut(this.sec.midiout, 'arp');
    this.fn(() => this.syncPattern());
    K.custom(() => this.update());
    K.live(on => this.live(on));
    return el;
  }
  // the title's module menu extras (after the shell's Lock Module / Init / Copy / Paste) and the ⋯ menu
  moduleItems() {
    return [this.trigItem('arp'), { sep: true },
      { label: 'Show Pattern Names', checked: this.showNames, action: () => { this.showNames = !this.showNames; this.update(); } }];
  }
  menuItems() { return [this.lockItem('arp')].concat(this.moduleItems()); }
  /* GLOBAL: BANK · LAUNCH QUANT · EDIT ALL */
  buildGlobal() {
    const K = this.kit, d = this.doc, B = this.sec.global;
    const bank = btn(d, 'sx-seqbtn sx-bankbtn', '', 'Arp bank', () => menuAt(bank, this.bankItems()));
    bank.setAttribute('aria-haspopup', 'menu');
    B.appendChild(bank);
    this.fn(() => { const A = this.A(), t = A.bank + (A.dirty ? ' *' : ''); if (bank.textContent !== t) { bank.textContent = t; bank.setAttribute('aria-label', 'Arp bank: ' + t); } });
    B.appendChild(this.menu('LAUNCH QUANT', core.LAUNCH_QUANT.map((e, i) => ({ v: i, label: e.label })), () => this.A().quant,
      v => K.edit(s => { s.arp.quant = v; }, { label: 'Launch Quant' })).el);
    B.appendChild(this.tog('EDIT ALL', () => this.A().editAll, v => K.edit(s => { s.arp.editAll = v; }, { label: 'Edit All', ui: true })).el);
  }
  bankItems() {
    const K = this.kit, load = (p, label) => K.edit(s => { s.arp = core.loadArpBank(s.arp, p); }, { label: label || 'Load Arp Bank' });
    const user = this.lib(core.STORE_KEYS.arpBanks, 'synth.sx.arpbank');
    return [
      { label: 'Factory', sub: core.FACTORY_ARP_BANKS.map(p => ({ label: p.name, action: () => load(p) })) },
      { label: 'User', sub: user.length ? user.map(p => ({ label: p.name, action: () => load(p) })) : [{ label: '(none)', disabled: true }] },
      { label: 'Init', action: () => load(core.FACTORY_ARP_BANKS[0], 'Init Arp Bank') },
      { sep: true },
      { label: 'Save Arp Bank…', action: () => this.saveBank() },
      { label: 'Delete User Bank', disabled: !user.length, sub: user.map(p => ({ label: p.name, action: () => this.libDelete(core.STORE_KEYS.arpBanks, 'synth.sx.arpbank', p.name) })) },
    ];
  }
  saveBank() {
    const K = this.kit, A = this.A();
    K.prompt('Save Arp Bank', 'Name', A.bank === 'Init' ? '' : A.bank, text => {
      const name = String(text || '').trim();
      if (!name) return false;
      const p = core.arpBankPayload(K.s().arp, name);
      if (!this.libSave(core.STORE_KEYS.arpBanks, 'synth.sx.arpbank', p)) return true;
      K.edit(s => { s.arp.bank = p.name; s.arp.dirty = 0; }, { label: 'Save Arp Bank' });
      return true;
    });
  }
  /* slots: keyboard-like, tap = select, ▶ = launch / stop, menu */
  buildSlots() {
    const K = this.kit;
    this.slots = new SlotStrip(this, this.sec.slots, {
      kind: 'arp',
      name: j => (this.showNames ? core.slotName(this.A().slots[j]) : NOTE_NAMES[j]),
      title: j => 'Arp slot ' + NOTE_NAMES[j] + ' — ' + core.slotName(this.A().slots[j]),
      sel: () => this.A().sel,
      select: j => { if (this.A().sel !== j) K.edit(s => { s.arp.sel = j; }, { label: 'Select Arp Slot' }); },
      play: j => { const q = seqOf(K); this.cmd(q && q[0] === j ? 'arpStop' : 'arpLaunch', j); },
      playing: j => { const q = seqOf(K); return !!q && q[0] === j; },
      menu: (j, x, y) => wk.contextMenu(x, y, this.slotItems(j), { anchor: this.slots.slots[j].name }),
    });
    this.fn(() => this.slots.update());
  }
  slotItems(j) {
    const K = this.kit, put = (fn, label) => K.edit(s => { fn(s.arp.slots, s.arp); s.arp.dirty = 1; }, { label });
    return [
      { label: 'Rename Pattern…', action: () => K.prompt('Rename Pattern', 'Name', this.A().slots[j].name, t => { const n = String(t || '').trim().slice(0, 32); put(S => { S[j].name = n; }, 'Rename Pattern'); return true; }) },
      { label: 'Copy Pattern', action: () => { SLOT_CB.arp = clone(this.A().slots[j]); } },
      { label: 'Paste Pattern', disabled: !SLOT_CB.arp, action: () => { const c = clone(SLOT_CB.arp); if (c) put(S => { S[j] = core.normalizeArpSlot(c); }, 'Paste Pattern'); } },
      { label: 'Erase Pattern', action: () => put(S => { S[j] = core.defaultArpSlot(); }, 'Erase Pattern') },
      { sep: true },
      { label: 'Show Pattern Names', checked: this.showNames, action: () => { this.showNames = !this.showNames; this.update(); } },
    ];
  }
  // knob of an arp virtual destination bound to the selected slot's n.* (arp.rate: n.rate in BPM mode, n.hz in Hz mode)
  arpKnob(id, label, o) {
    const key = sl => (id === 'arp.rate' ? (sl.bpm ? 'rate' : 'hz') : ARP_N[id]);
    return this.vKnob(id, label, () => { const sl = this.slot(); return sl.n[key(sl)]; },
      (n, ph) => this.editSlots(sl => { sl.n[key(sl)] = n; }, { label: destOf(id).label, phase: ph }), o);
  }
  slotTog(field, label, o) { return this.tog(label, () => this.slot()[field], v => this.editSlots(sl => { sl[field] = v; }, { label: 'Arp ' + label }), o); }
  buildPattern() {
    const d = this.doc, B = this.sec.pattern, sl = () => this.slot();
    B.appendChild(this.menu('SHAPE', core.ARP_SHAPES.map((l, i) => ({ v: i, label: l })), () => sl().shape, v => this.editSlots(x => { x.shape = v; }, { label: 'Arp Shape' })).el);
    B.appendChild(this.seg('', ['BPM', 'HZ'], () => (sl().bpm ? 0 : 1), i => this.editSlots(x => { x.bpm = i ? 0 : 1; }, { label: 'Arp BPM' })).el);
    const rateSteps = () => { const x = sl(); return x.bpm ? core.arpLadder(x.dot, x.trip).length - 1 : 0; };
    B.appendChild(this.arpKnob('arp.rate', 'RATE', { steps: rateSteps, def: () => (sl().bpm ? core.ARP_N.rate : core.ARP_N.hz) }).el);
    const key = x => (x.bpm ? 'rate' : 'hz');
    const field = this.own(wk.numBox({ dest: 'arp.rate', label: '', get: () => clamp01(sl().n[key(sl())]), set: (n, ph) => this.editSlots(x => { x.n[key(x)] = snapN('arp.rate', n); }, { label: 'Arp Rate', phase: ph }),
      def: () => (sl().bpm ? core.ARP_N.rate : core.ARP_N.hz), fmt: n => core.fmtParam('arp.rate', n, this.fctx()), parse: t => core.parseParam('arp.rate', t, this.fctx()), steps: () => rateSteps() || 1000 }));
    B.appendChild(field.el);
    const dt = (k, label) => this.tog(label, () => sl()[k], v => this.editSlots(x => {
      const from = { dot: x.dot, trip: x.trip };
      x[k] = v;
      x.n.rate = rateRemap(x.n.rate, from, { dot: x.dot, trip: x.trip });
    }, { label: 'Arp ' + label }), { disabled: () => !sl().bpm });
    B.appendChild(dt('trip', 'TRIP').el);
    B.appendChild(dt('dot', 'DOT').el);
    const ed = btn(d, 'sx-seqbtn sx-pated', 'EDIT PATTERN', 'Open the pattern editor (SHAPE = Pattern)', () => this.openPattern());
    ed.setAttribute('aria-haspopup', 'dialog');
    B.appendChild(ed);
    this.fn(() => { const on = sl().shape === 1; ed.disabled = !on; ed.setAttribute('aria-disabled', on ? 'false' : 'true'); });
  }
  buildTranspose() {
    const B = this.sec.transpose, sl = () => this.slot();
    B.appendChild(this.arpKnob('arp.shift', 'SHIFT').el);
    B.appendChild(this.arpKnob('arp.range', 'RANGE').el);
    B.appendChild(this.menu('RANGE SHAPE', core.RANGE_SHAPES.map((l, i) => ({ v: i, label: l })), () => sl().rshape, v => this.editSlots(x => { x.rshape = v; }, { label: 'Arp Range Shape' })).el);
    B.appendChild(this.arpKnob('arp.trans', 'TRANS').el);
  }
  buildPlayback() {
    const B = this.sec.playback;
    B.appendChild(this.slotTog('latch', 'LATCH').el);
    B.appendChild(this.slotTog('thru', 'THRU').el);
    B.appendChild(this.arpKnob('arp.offset', 'OFFSET').el);
    B.appendChild(this.arpKnob('arp.repeats', 'REPEATS').el);
    B.appendChild(this.arpKnob('arp.gate', 'GATE').el);
    B.appendChild(this.arpKnob('arp.chance', 'CHANCE').el);
    B.appendChild(this.slotTog('chancePre', 'PRE').el);
  }
  buildRetrigger() {
    const B = this.sec.retrigger;
    B.appendChild(this.slotTog('rLaunch', 'LAUNCH').el);
    B.appendChild(this.slotTog('rRate', 'RATE').el);
    B.appendChild(this.arpKnob('arp.rrate', 'EVERY', { size: 'sm', disabled: () => !this.slot().rRate }).el);
    B.appendChild(this.slotTog('rNote', 'NOTE').el);
    B.appendChild(this.slotTog('rFirst', 'FIRST').el);
  }
  buildVelocity() {
    const B = this.sec.velocity, off = () => !this.slot().vel;
    B.appendChild(this.slotTog('vel', 'ENABLE').el);
    B.appendChild(this.slotTog('vRetrig', 'RETRIG', { disabled: off }).el);
    B.appendChild(this.arpKnob('arp.vdecay', 'DECAY', { disabled: off }).el);
    B.appendChild(this.arpKnob('arp.vtarget', 'TARGET', { disabled: off }).el);
  }
  /* pattern editor overlay: open while s.ui.arpEd and SHAPE = Pattern */
  openPattern() {
    if (this.slot().shape !== 1) { this.notify('Set SHAPE to Pattern to edit a pattern'); return false; }
    if (!this.kit.s().ui.arpEd) this.kit.edit(s => { s.ui.arpEd = 1; }, { label: 'View', ui: true });
    this.syncPattern();
    if (this.patEd && this.patEd.roll.el.focus) this.patEd.roll.el.focus({ preventScroll: true });
    return !!this.patEd;
  }
  closePattern() {
    if (this.kit.s().ui.arpEd) this.kit.edit(s => { s.ui.arpEd = 0; }, { label: 'View', ui: true });
    this.syncPattern();
  }
  syncPattern() {
    if (this.dead) return;
    const want = !!this.kit.s().ui.arpEd && this.slot().shape === 1;
    if (want && !this.patEd) this.patEd = new PatternEditor(this);
    else if (!want && this.patEd) { this.patEd.destroy(); this.patEd = null; }
    if (this.patEd) this.patEd.refresh();
  }
  // kit.live(fn) → fn(shown): a hidden page is not painted (§13.1); the ARP page has no functional live work
  live(shown) {
    if (this.dead || shown === false) return;
    if (this.slots) this.slots.live();
    if (this.patEd) this.patEd.tick();
  }
  destroy() {
    if (this.dead) return;
    if (this.patEd) { this.patEd.destroy(); this.patEd = null; }
    super.destroy();
  }
}

// The pattern editor overlay of the ARP page (§13.7): pattern name menu, LENGTH, MODE, TIME, STEP MODE, WRAP + PITCH +
// RANGE, grid size, the event graph (a PianoRoll of kind 'pat') and its lanes (note velocity, accent, strum, automation
// lanes Velocity / Gate / Chance / Expr X). Escape or ✕ closes it (s.ui.arpEd = 0).
class PatternEditor {
  constructor(page) {
    this.page = page;
    this.kit = page.kit;
    this.ws = [];
    this.dead = false;
    const d = page.doc, K = this.kit;
    const P = () => page.slot().pat;
    const editPat = (fn, o) => page.editSlots(sl => fn(sl.pat), o);   // pattern settings: Edit All writes every slot
    const editOwn = (fn, o) => K.edit(s => { const A = s.arp, sl = A.slots[A.sel]; if (sl) fn(sl.pat); A.dirty = 1; }, o);   // the graph: selected slot
    const own = w => { this.ws.push(w); return w; };
    const el = this.el = mk(d, 'div', 'sx-seqov sx-pated');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Pattern editor');
    const head = mk(d, 'div', 'sx-seqovhead');
    this.title = mk(d, 'span', 'sx-ttl', 'PATTERN');
    const name = btn(d, 'sx-seqbtn sx-bankbtn', '', 'Pattern presets', () => menuAt(name, this.nameItems()));
    name.setAttribute('aria-haspopup', 'menu');
    this.nameBtn = name;
    const x = btn(d, 'sx-seqbtn', '✕', 'Close the pattern editor', () => page.closePattern());
    head.append(this.title, name, mk(d, 'span', 'sx-grow'), x);
    const row = mk(d, 'div', 'sx-seqrow');
    const menuW = (label, list, k, enabled) => own(wk.menu({ label, items: () => list.map((l, i) => ({ v: i, label: typeof l === 'string' ? l : l.label })), get: () => P()[k],
      set: v => editPat(p => { p[k] = v; }, { label: 'Pattern ' + label.toLowerCase() }), arrows: true, wheel: true }));
    const lenG = {};   // the events / strums a LENGTH drag may cut, per pattern, from its first step (gMap)
    row.appendChild(lenBox({ own }, 'LENGTH', () => P().len, (v, ph) => {
      const M = gMap(lenG, ph);
      editPat(p => {
        const o = gOrig(M, p, q => ({ ev: arr(q.ev).map(e => e.slice()), strum: arr(q.strum).map(e => e.slice()) }));
        p.len = v;
        p.ev = o.ev.filter(e => e[0] < v).map(e => e.slice());
        p.strum = o.strum.filter(e => e[0] < v).map(e => e.slice());
      }, { label: 'Pattern length', phase: ph });
      gDone(lenG, ph);
    }, core.MAX_PAT_LEN, core.defaultPattern().len).el);
    row.appendChild(menuW('MODE', core.ARP_PMODES, 'mode').el);
    const time = menuW('TIME', core.TIME_LADDER, 'time');
    row.appendChild(time.el);
    row.appendChild(menuW('STEP MODE', core.STEP_MODES, 'stepMode').el);
    row.appendChild(menuW('WRAP', core.WRAP_MODES, 'wrap').el);
    const vk = (id, label) => {
      const key = ARP_N[id];
      const w = page.vKnob(id, label, () => page.slot().n[key], (n, ph) => page.editSlots(sl => { sl.n[key] = n; }, { label: destOf(id).label, phase: ph }),
        { size: 'sm', disabled: () => P().wrap !== 0 });
      page.ws.splice(page.ws.indexOf(w), 1);   // owned by the editor (destroyed with it)
      return own(w);
    };
    row.appendChild(vk('arp.wtrans', 'PITCH').el);
    row.appendChild(vk('arp.wrange', 'RANGE').el);
    row.appendChild(menuW('GRID', core.GRID_LADDER, 'grid').el);
    this.timeEl = time.el;
    const box = mk(d, 'div', 'sx-patroll');
    this.roll = new PianoRoll(box, {
      doc: d, kind: 'pat',
      clip: () => page.slot().pat,
      edit: editOwn,
      viewKey: () => page.A().sel,
      keys: () => keysOn(K),
      playhead: () => {
        const q = seqOf(K), A = page.A(), p = P();
        return q && q[0] === A.sel && fin(q[1]) && q[1] >= 0 ? q[1] % Math.max(1, p.len) : -1;
      },
      zoom: () => arr(K.s().ui.clipZoom),
      setZoom: z => K.edit(s => { s.ui.clipZoom = [z[0], z[1]]; }, { label: 'View', ui: true }),
      grid: () => P().grid,
      setGrid: g => editOwn(p => { p.grid = g; }, { label: 'Pattern grid' }),
      notify: t => page.notify(t),
    });
    this.lanes = new LaneView(mk(d, 'div'), {
      doc: d, roll: this.roll, obj: P, edit: editOwn, lanes: PAT_LANES,
    });
    el.append(head, row, box, this.lanes.el);
    el.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); page.closePattern(); } });
    page.el.appendChild(el);
    this.refresh();
  }
  nameItems() {
    const page = this.page, K = this.kit, KEY = core.STORE_KEYS.arpPats, T = 'synth.sx.arppat', user = page.lib(KEY, T);
    const load = (p, label) => K.edit(s => { const A = s.arp, sl = A.slots[A.sel]; if (sl) { const g = sl.pat.grid; sl.pat = clone(p); sl.pat.grid = g; } A.dirty = 1; }, { label: label || 'Load Pattern' });
    return [
      { label: 'Factory', sub: core.FACTORY_PATTERNS.map(p => ({ label: p.name, action: () => load(p.pat) })) },
      { label: 'User', sub: user.length ? user.map(p => ({ label: p.name, action: () => load(p.pat) })) : [{ label: '(none)', disabled: true }] },
      { label: 'Init', action: () => load(core.defaultPattern(), 'Init Pattern') },
      { sep: true },
      { label: 'Save Pattern…', action: () => K.prompt('Save Pattern', 'Name', page.slot().pat.name, t => {
        const nm = String(t || '').trim();
        if (!nm) return false;
        const p = core.patPayload(page.slot().pat, nm);
        if (page.libSave(KEY, T, p)) K.edit(s => { const A = s.arp; A.slots[A.sel].pat.name = p.name; }, { label: 'Save Pattern' });
        return true;
      }) },
      { label: 'Rename Pattern…', action: () => K.prompt('Rename Pattern', 'Name', page.slot().pat.name, t => {
        const nm = String(t || '').trim().slice(0, 32);
        if (!nm) return false;
        K.edit(s => { const A = s.arp; A.slots[A.sel].pat.name = nm; A.dirty = 1; }, { label: 'Rename Pattern' });
        return true;
      }) },
      { label: 'Delete User Pattern', disabled: !user.length, sub: user.map(p => ({ label: p.name, action: () => page.libDelete(KEY, T, p.name) })) },
    ];
  }
  refresh() {
    if (this.dead) return;
    const sl = this.page.slot(), p = sl.pat;
    for (const w of this.ws) w.update();
    const t = 'PATTERN — ' + NOTE_NAMES[this.page.A().sel] + ' · ' + core.slotName(sl);
    if (this.title.textContent !== t) this.title.textContent = t;
    if (this.nameBtn.textContent !== p.name) { this.nameBtn.textContent = p.name; this.nameBtn.setAttribute('aria-label', 'Pattern: ' + p.name); }
    this.timeEl.style.display = p.mode >= 3 && p.mode <= 5 ? '' : 'none';
    this.roll.refresh();
    this.lanes.refresh();
  }
  tick() { if (!this.dead) this.roll.tick(); }
  destroy() {
    if (this.dead) return;
    this.dead = true;
    for (const w of this.ws.splice(0)) if (w.destroy) w.destroy();
    this.roll.destroy();
    this.lanes.destroy();
    this.el.remove();
  }
}

/* ================================================================ lanes (§13.7 pattern lanes, §13.8 clip lanes) */

// lane kinds: 'rec' = a value per record (field f of the notes / events; bool: a toggle), 'strum' = pat.strum entries,
// 'auto' = an automation lane (obj.lanes[lane], CurveEditor over x = t / len)
const PAT_LANES = [
  { key: 'vel', label: 'NOTE VEL', type: 'rec', f: 3, lo: 1, hi: 127, int: true },
  { key: 'acc', label: 'ACCENT', type: 'rec', f: 4, bool: true },
  { key: 'strum', label: 'STRUM', type: 'strum' },
  { key: 'L:vel', label: 'VELOCITY', type: 'auto', lane: 'vel' },
  { key: 'L:gate', label: 'GATE', type: 'auto', lane: 'gate' },
  { key: 'L:chance', label: 'CHANCE', type: 'auto', lane: 'chance' },
  { key: 'L:x', label: 'EXPR X', type: 'auto', lane: 'x' },
];
const clipLanes = macroName => [
  { key: 'vel', label: 'VELOCITY', type: 'rec', f: 3, lo: 1, hi: 127, int: true },
  { key: 'x', label: 'EXPR X', type: 'rec', f: 5, lo: 0, hi: 1 },
  { key: 'y', label: 'EXPR Y', type: 'rec', f: 6, lo: 0, hi: 1 },
  { key: 'z', label: 'EXPR Z', type: 'rec', f: 7, lo: 0, hi: 1 },
].concat(Array.from({ length: 8 }, (_, k) => ({ key: 'm' + (k + 1), label: () => macroName(k), type: 'auto', lane: 'm' + (k + 1), macro: k })));
const LANE_PAD = 4;

// o = { doc, roll (the PianoRoll whose view the record lanes follow), obj() (clip / pattern), edit(fn, e), lanes, init?(def) }
class LaneView {
  constructor(root, o) {
    this.o = o;
    this.doc = o.doc || docOf(root);
    this.dead = false;
    this.cur = o.lanes[0].key;
    this.g = null;
    this.last = null;
    this.ce = null;
    this.ceKey = null;
    this.offs = [];
    const d = this.doc;
    const el = this.el = mk(d, 'div', 'sx-lanes');
    this.tabs = mk(d, 'div', 'sx-lanetabs');
    this.tabs.setAttribute('role', 'tablist');
    this.tabBtns = o.lanes.map(L => {
      const b = btn(d, 'sx-lanetab', '', null, () => { this.cur = L.key; this.last = null; this.refresh(); });
      b.setAttribute('role', 'tab');
      b.setAttribute('data-lane', L.key);
      this.tabs.appendChild(b);
      return b;
    });
    this.cv = mk(d, 'canvas', 'sx-lanecv');
    this.cv.setAttribute('role', 'img');
    this.auto = mk(d, 'div', 'sx-laneauto');
    this.autoTxt = mk(d, 'span', 'sx-txt', '');
    this.addB = btn(d, 'sx-seqbtn', 'Add lane', 'Add an automation lane', () => this.addLane());
    this.clrB = btn(d, 'sx-seqbtn', 'Clear lane', 'Remove this automation lane', () => this.clearLane());
    this.ceBox = mk(d, 'div', 'sx-lanece');
    const bar = mk(d, 'div', 'sx-rollbar');
    bar.append(this.autoTxt, this.addB, this.clrB);
    this.auto.append(bar, this.ceBox);
    el.append(this.tabs, this.cv, this.auto);
    if (root) root.appendChild(el);
    const on = (t, type, fn) => { t.addEventListener(type, fn); this.offs.push(() => t.removeEventListener(type, fn)); };
    on(this.cv, 'pointerdown', e => this.down(e));
    on(this.cv, 'pointermove', e => this.move(e));
    on(this.cv, 'pointerup', e => this.up(e));
    on(this.cv, 'pointercancel', e => this.up(e));
    on(this.cv, 'dblclick', e => this.dbl(e));
    // width changes through a ResizeObserver (a repaint never forces a layout; size() caches)
    this.ro = null;
    this.sz = null;
    const win = this.doc.defaultView, RO = (win && win.ResizeObserver) || globalThis.ResizeObserver;
    if (typeof RO === 'function') {
      this.ro = new RO(en => {
        this.sz = null;
        this.last = null;
        const r = en && en[0] && en[0].contentRect;
        if (!r || (r.width > 0 && r.height > 0)) this.refresh();
      });
      this.ro.observe(this.cv);
      this.offs.push(() => this.ro.disconnect());
    }
  }
  def() { return this.o.lanes.find(L => L.key === this.cur) || this.o.lanes[0]; }
  label(L) { return typeof L.label === 'function' ? L.label() : L.label; }
  F() { const ob = this.o.obj(); return ob && Array.isArray(ob.ev) ? 'ev' : 'notes'; }
  refresh() {
    if (this.dead) return;
    const L = this.def(), ob = this.o.obj();
    this.tabBtns.forEach((b, i) => {
      const D = this.o.lanes[i], t = this.label(D);
      if (b.textContent !== t) b.textContent = t;
      b.setAttribute('aria-selected', D.key === L.key ? 'true' : 'false');
    });
    const auto = L.type === 'auto';
    this.cv.style.display = auto ? 'none' : '';
    this.auto.style.display = auto ? '' : 'none';
    if (auto) { this.refreshAuto(L, ob); return; }
    this.drop();
    const v = this.o.roll.view(), sig = [L.key, ob ? hashRecs(L.type === 'strum' ? ob.strum : ob[this.F()]) : '', ob && ob.len, v.t0, v.pps, this.selOf().join(','),
      Math.round(this.size().w)].join('|');
    if (sig === this.last) return;
    this.last = sig;
    this.cv.setAttribute('aria-label', this.label(L) + ' lane');
    this.draw(L, ob, v);
  }
  // automation lane: CurveEditor while the lane exists, else the Add button
  refreshAuto(L, ob) {
    const lane = ob && ob.lanes ? ob.lanes[L.lane] : null, has = Array.isArray(lane);
    this.addB.style.display = has ? 'none' : '';
    this.clrB.style.display = has ? '' : 'none';
    const t = has ? this.label(L) + ' over the ' + (this.F() === 'ev' ? 'pattern' : 'clip') : 'No ' + this.label(L) + ' lane';
    if (this.autoTxt.textContent !== t) this.autoTxt.textContent = t;
    if (!has) { this.drop(); return; }
    if (this.ceKey !== L.key && typeof gx.CurveEditor === 'function') {
      this.drop();
      this.ceKey = L.key;
      this.ce = new gx.CurveEditor(this.ceBox, { kind: 'curve', label: this.label(L) + ' lane', height: 96,
        get: () => { const b = this.o.obj(); return b && b.lanes && Array.isArray(b.lanes[L.lane]) ? b.lanes[L.lane] : [[0, 0.5, 0], [1, 0.5, 0]]; },
        set: (pts, ph) => this.o.edit(b => { if (b.lanes) b.lanes[L.lane] = pts; }, { label: this.label(L) + ' lane', phase: ph }) });
    }
    if (this.ce && this.ce.refresh) this.ce.refresh();
  }
  drop() { if (this.ce) { if (this.ce.destroy) this.ce.destroy(); this.ce = null; } this.ceKey = null; }
  addLane() {
    const L = this.def();
    if (L.type !== 'auto') return;
    const y = r5(clamp01(this.o.init ? +this.o.init(L) : 0.5));
    this.o.edit(b => { if (b.lanes) b.lanes[L.lane] = [[0, y, 0], [1, y, 0]]; }, { label: 'Add ' + this.label(L) + ' lane' });
    this.refresh();
  }
  clearLane() {
    const L = this.def();
    if (L.type !== 'auto') return;
    this.o.edit(b => { if (b.lanes) b.lanes[L.lane] = null; }, { label: 'Clear ' + this.label(L) + ' lane' });
    this.drop();
    this.refresh();
  }
  size() {
    if (this.sz) return this.sz;
    const r = this.cv.getBoundingClientRect(), s = { w: Math.max(40, r.width || 600), h: Math.max(24, r.height || 72) };
    if (this.ro && r.width > 0 && r.height > 0) this.sz = s;
    return s;
  }
  xOf(t, v) { return KEYW + (t - v.t0) * v.pps; }
  valY(u, h) { return LANE_PAD + (1 - clamp01(u)) * (h - 2 * LANE_PAD); }
  uAt(y, h) { return clamp01(1 - (y - LANE_PAD) / Math.max(1, h - 2 * LANE_PAD)); }
  norm(L, v) { return L.bool ? (v ? 1 : 0) : L.lo === undefined ? clamp01(v) : (v - L.lo) / (L.hi - L.lo); }
  denorm(L, u) { const v = L.lo === undefined ? u : L.lo + u * (L.hi - L.lo); return L.int ? Math.round(v) : r5(v); }
  draw(L, ob, v) {
    const { w, h } = this.size(), cv = this.cv, d = this.doc.defaultView, dpr = Math.min(2, Math.max(1, (d && d.devicePixelRatio) || 1));
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const g = cv.getContext ? cv.getContext('2d') : null;
    if (!g) return;
    if (g.setTransform) g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#0a0d10';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#11161c';
    g.fillRect(0, 0, KEYW, h);
    g.fillStyle = '#7f8b98';
    g.font = '9px system-ui, sans-serif';
    g.fillText(String(this.label(L)).slice(0, 6), 3, 12);
    if (!ob) return;
    const sel = new Set(this.selOf()), isPat = this.F() === 'ev', col = isPat ? '#b07cff' : '#3ddc84';
    const list = L.type === 'strum' ? arr(ob.strum) : arr(ob[this.F()]);
    g.save && g.save();
    g.beginPath && (g.beginPath(), g.rect(KEYW, 0, w - KEYW, h), g.clip && g.clip());
    // selected records last: a chord's notes share one bar, the selected ones (the ones a drag edits) on top
    const order = list.map((_, i) => i).sort((a, b) => (sel.has(a) ? 1 : 0) - (sel.has(b) ? 1 : 0) || a - b);
    for (const i of order) {
      const r = list[i];
      if (!Array.isArray(r)) continue;
      const x = this.xOf(r[0], v);
      if (x < KEYW - 8 || x > w) continue;
      const u = L.type === 'strum' ? clamp01(r[1]) : this.norm(L, r[L.f]), y = this.valY(u, h);
      g.fillStyle = L.type === 'rec' && sel.has(i) ? '#ffffff' : col;
      g.fillRect(x, y, 4, h - LANE_PAD - y);
      g.fillRect(x - 1, y - 1, 6, 2);
    }
    g.restore && g.restore();
  }
  // the roll's selection as it acts (indices into the records)
  selOf() { const R = this.o.roll; return R && typeof R.selNow === 'function' ? R.selNow() : arr(R && R.sel); }
  local(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  // index of the record (or strum entry) whose bar is nearest to x within tol px, −1 for none
  near(list, x, v, tol) {
    let best = -1, bd = tol + 1e-9;
    arr(list).forEach((r, i) => { if (!Array.isArray(r)) return; const dx = Math.abs(this.xOf(r[0], v) + 2 - x); if (dx <= bd) { bd = dx; best = i; } });
    return best;
  }
  // the records a press at x edits: the bar nearest to x and every record starting at the same time (a chord shares one
  // bar); of those the ones selected in the roll when there are any, else all of them
  group(list, x, v, tol) {
    const i = this.near(list, x, v, tol);
    if (i < 0) return [];
    const t = list[i][0], G = [];
    arr(list).forEach((r, j) => { if (Array.isArray(r) && Math.abs(r[0] - t) < 1e-6) G.push(j); });
    const sel = new Set(this.selOf()), S = G.filter(j => sel.has(j));
    return S.length ? S : G;
  }
  down(e) {
    if (this.g && this.g.type === 'tap' && e.pointerId !== this.g.id) this.g = null;   // a second finger: no tap
    if (this.dead || this.g || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const L = this.def(), ob = this.o.obj();
    if (!ob || L.type === 'auto') return;
    const p = this.local(e), v = this.o.roll.view(), { h } = this.size(), tol = e.pointerType === 'touch' ? 14 : 7;
    this.lastType = e.pointerType || 'mouse';
    e.preventDefault();
    if (L.type === 'strum') {
      const S0 = Array.isArray(ob.strum) ? ob.strum.map(q => (Array.isArray(q) ? q.slice() : q)) : ob.strum;   // (a two-finger rollback: up())
      let i = this.near(ob.strum, p.x, v, tol);
      const amt = r5(this.uAt(p.y, h));
      if (i < 0) {
        const t = this.o.roll.snapR(v.t0 + (p.x - KEYW) / v.pps);
        if (!(t >= 0 && t < ob.len)) return;
        const S = arr(ob.strum).map(q => q.slice());
        S.push([t, amt]);
        S.sort((a, b) => a[0] - b[0]);
        i = S.findIndex(q => q[0] === t && q[1] === amt);
        this.o.edit(b => { b.strum = S; }, { label: 'Strum', phase: 'start' });
      } else this.o.edit(b => { if (b.strum[i]) b.strum[i][1] = amt; }, { label: 'Strum', phase: 'start' });
      this.g = { id: e.pointerId, type: 'strum', i, amt, S0 };
    } else {
      const list = ob[this.F()], I = this.group(list, p.x, v, tol);
      if (!I.length) return;
      if (L.bool) {
        const val = list[this.near(list, p.x, v, tol)][L.f] ? 0 : 1, F = this.F();
        const flip = () => {
          this.o.edit(b => { for (const i of I) { const r = b[F][i]; if (r) r[L.f] = val; } }, { label: this.label(L), phase: 'set' });
          this.last = null;
          this.refresh();
        };
        // a finger toggles on its tap's release (≤ 10 px): a two-finger gesture (gesture.js cancels the first finger)
        // or a slide never flips a lane; a mouse / pen at the press
        if (e.pointerType === 'touch') this.g = { id: e.pointerId, type: 'tap', x: e.clientX, y: e.clientY, flip };
        else flip();
        return;
      }
      this.g = { id: e.pointerId, type: 'rec', L, done: new Map(), org: new Map(), F: this.F() };
      this.setRec(I, this.denorm(L, this.uAt(p.y, h)));
    }
    try { this.cv.setPointerCapture(e.pointerId); } catch (err) { /* pointer gone */ }
    this.last = null;
    this.refresh();
  }
  setRec(I, val) {
    const G = this.g, L = G.L, F = this.F(), ob = this.o.obj();
    const ph = G.done.size ? 'move' : 'start';
    for (const i of I) if (!G.org.has(i)) { const r = ob && arr(ob[F])[i]; G.org.set(i, Array.isArray(r) ? r[L.f] : undefined); }   // the values before
    for (const i of I) G.done.set(i, val);
    G.val = val;
    this.o.edit(b => { for (const i of I) { const r = b[F][i]; if (r) r[L.f] = val; } }, { label: this.label(L), phase: ph });
  }
  move(e) {
    const G = this.g;
    if (!G || e.pointerId !== G.id) return;
    if (G.type === 'tap') { if (Math.hypot(e.clientX - G.x, e.clientY - G.y) > 10) G.flip = null; return; }   // a slide: no tap
    const p = this.local(e), v = this.o.roll.view(), { h } = this.size(), ob = this.o.obj();
    if (!ob) return;
    if (G.type === 'strum') {
      G.amt = r5(this.uAt(p.y, h));
      const i = G.i;
      this.o.edit(b => { if (b.strum[i]) b.strum[i][1] = G.amt; }, { label: 'Strum', phase: 'move' });
    } else {
      const I = this.group(ob[this.F()], p.x, v, e.pointerType === 'touch' ? 14 : 7);
      if (I.length) this.setRec(I, this.denorm(G.L, this.uAt(p.y, h)));
    }
    this.last = null;
    this.refresh();
  }
  up(e) {
    const G = this.g;
    if (!G || e.pointerId !== G.id) return;
    this.g = null;
    if (G.type === 'tap') { if (G.flip && e.type === 'pointerup' && Math.hypot(e.clientX - G.x, e.clientY - G.y) <= 10) G.flip(); return; }
    try { this.cv.releasePointerCapture(G.id); } catch (err) { /* released */ }
    if (twoF(e)) {   // gesture.js: a second finger made it a pan / pinch — the strum list / the records as they were
      if (G.type === 'strum') { const S0 = G.S0; this.o.edit(b => { b.strum = S0; }, { label: 'Strum', phase: 'end' }); }
      else { const F = G.F, L = G.L, org = G.org; this.o.edit(b => { for (const [i, val] of org) if (b[F] && b[F][i]) b[F][i][L.f] = val; }, { label: this.label(L), phase: 'end' }); }
      this.last = null;
      this.refresh();
      return;
    }
    if (G.type === 'strum') { const i = G.i, a = G.amt; this.o.edit(b => { if (b.strum[i]) b.strum[i][1] = a; }, { label: 'Strum', phase: 'end' }); }
    else { const F = this.F(), L = G.L, done = G.done; this.o.edit(b => { for (const [i, val] of done) if (b[F][i]) b[F][i][L.f] = val; }, { label: this.label(L), phase: 'end' }); }
    consume();
    this.last = null;
    this.refresh();
  }
  // double-click on a strum bar removes it
  dbl(e) {
    const L = this.def(), ob = this.o.obj();
    if (!ob || L.type !== 'strum' || this.lastType === 'touch') return;
    const p = this.local(e), i = this.near(ob.strum, p.x, this.o.roll.view(), 7);
    if (i < 0) return;
    this.o.edit(b => { b.strum = arr(b.strum).filter((_, k) => k !== i); }, { label: 'Remove strum' });
    this.last = null;
    this.refresh();
  }
  destroy() {
    if (this.dead) return;
    this.dead = true;
    for (const f of this.offs.splice(0)) f();
    this.drop();
    this.el.remove();
  }
}

/* ================================================================ CLIP page (§13.8) */

const CLIP_SECS = [['global', 'GLOBAL'], ['slots', 'SLOTS'], ['settings', 'CLIP SETTINGS'], ['roll', ''], ['lanes', 'LANES'],
  ['record', 'RECORD'], ['midiout', 'MIDI OUT'], ['macros', 'MACROS']];
const CLIP_N = { 'clip.trans': 'trans', 'clip.rate': 'rate', 'clip.offset': 'offset' };
const sortNotes = L => L.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
const MAX_NOTES_TEXT = room => (room < core.MAX_CLIP_NOTES ? 'At most ' + core.MAX_BANK_NOTES + ' notes per clip bank' : 'At most ' + core.MAX_CLIP_NOTES + ' notes per clip');
// recording clock: re-anchor window (snapshots) and the jump that restarts it (ms of clip time: a seek, a relaunch)
const REC_WIN = 24, REC_JUMP_MS = 120;

export class ClipPage extends SeqPage {
  constructor(root, kit) {
    super(kit);
    this.slots = null;
    this.roll = null;
    this.lanes = null;
    this.rec = null;            // the recording (record(), below) or null
    this.macrosOpen = false;
    this.shown = true;          // the page is on screen (the last kit.live call)
    this.snObj = undefined;     // the last snapshot seen (object, kit.snapSeq) and its receive time (ms)
    this.snSeq = -1;
    this.snapAt = 0;
    this.el = this.build();
    if (root) root.appendChild(this.el);
  }
  C() { return this.kit.s().clip; }
  clip() { const C = this.C(); return C.clips[C.sel] || C.clips[0]; }
  // clip settings: the selected clip, or every clip with EDIT ALL / Alt; marks the bank modified
  editClips(fn, o) {
    const all = !!(this.C().editAll || this.altAll(o));
    this.kit.edit(s => { const C = s.clip, L = all ? C.clips : [C.clips[C.sel]]; for (const c of L) if (c) fn(c); C.dirty = 1; }, o);
  }
  // the selected clip's content (piano roll, lanes): never Edit All
  editSel(fn, o) { this.kit.edit(s => { const C = s.clip, c = C.clips[C.sel]; if (c) fn(c); C.dirty = 1; }, o); }
  // clip j's content (recording: the clip the take belongs to, whichever is selected now)
  editClip(j, fn, o) { this.kit.edit(s => { const C = s.clip, c = C.clips[j]; if (c) fn(c); C.dirty = 1; }, o); }
  // how many notes clip j may hold: 1024 per clip and its share of the 4096-note bank (§2.4.2; normalizeClip hands the
  // bank budget out clip by clip, so an over-full bank loses notes on reload)
  noteRoom(j) {
    const L = arr(this.C().clips);
    let other = 0;
    L.forEach((c, i) => { if (i !== j && c) other += arr(c.notes).length; });
    return Math.max(0, Math.min(core.MAX_CLIP_NOTES, core.MAX_BANK_NOTES - other));
  }
  // a clip slot for slot j (Paste Clip, Load Clip): normalised, its notes cut to the room of slot j (with a notice)
  fitClip(j, c) {
    const n = core.normalizeClipSlot(clone(c)), room = this.noteRoom(j);
    if (n.notes.length > room) {
      n.notes = sortNotes(n.notes).slice(0, room);
      this.notify(MAX_NOTES_TEXT(room) + ': the clip was cut to ' + room + ' notes');
    }
    return n;
  }
  build() {
    const K = this.kit, d = this.doc;
    injectSeqStyles(d);
    const { el, head, body } = K.panel('CLIP', 'clip', 'clip.on', 'sx-seqpage sx-clip', { items: () => [this.trigItem('clip')] });
    this.el = el;
    this.sec = sections(d, body, CLIP_SECS);
    const more = btn(d, 'sx-hbtn sx-seqmenu', '⋯', 'CLIP menu', () => menuAt(more, [this.lockItem('clip'), this.trigItem('clip')]));
    more.setAttribute('aria-haspopup', 'menu');
    head.appendChild(more);
    this.watchAlt(el);
    this.buildGlobal();
    this.buildSlots();
    this.buildSettings();
    this.buildRoll();
    this.buildRecord();
    this.midiOut(this.sec.midiout, 'clip');
    this.buildMacros();
    K.custom(() => this.update());
    K.live(on => this.live(on));
    return el;
  }
  /* GLOBAL: BANK · TRIGGER MODE · EDIT ALL */
  buildGlobal() {
    const K = this.kit, d = this.doc, B = this.sec.global;
    const bank = btn(d, 'sx-seqbtn sx-bankbtn', '', 'Clip bank', () => menuAt(bank, this.bankItems()));
    bank.setAttribute('aria-haspopup', 'menu');
    B.appendChild(bank);
    this.fn(() => { const C = this.C(), t = C.bank + (C.dirty ? ' *' : ''); if (bank.textContent !== t) { bank.textContent = t; bank.setAttribute('aria-label', 'Clip bank: ' + t); } });
    B.appendChild(this.seg('TRIGGER MODE', core.CLIP_TRIG.slice(), () => this.C().trig, i => K.edit(s => { s.clip.trig = i; }, { label: 'Trigger Mode' })).el);
    B.appendChild(this.tog('EDIT ALL', () => this.C().editAll, v => K.edit(s => { s.clip.editAll = v; }, { label: 'Edit All', ui: true })).el);
  }
  bankItems() {
    const K = this.kit, load = (p, label) => K.edit(s => { s.clip = core.loadClipBank(s.clip, p); }, { label: label || 'Load Clip Bank' });
    const user = this.lib(core.STORE_KEYS.clipBanks, 'synth.sx.clipbank');
    return [
      { label: 'Factory', sub: core.FACTORY_CLIP_BANKS.map(p => ({ label: p.name, action: () => load(p) })) },
      { label: 'User', sub: user.length ? user.map(p => ({ label: p.name, action: () => load(p) })) : [{ label: '(none)', disabled: true }] },
      { label: 'Init', action: () => load(core.FACTORY_CLIP_BANKS[0], 'Init Clip Bank') },
      { sep: true },
      { label: 'Save Clip Bank…', action: () => K.prompt('Save Clip Bank', 'Name', this.C().bank === 'Init' ? '' : this.C().bank, t => {
        const name = String(t || '').trim();
        if (!name) return false;
        const p = core.clipBankPayload(K.s().clip, name);
        if (this.libSave(core.STORE_KEYS.clipBanks, 'synth.sx.clipbank', p)) K.edit(s => { s.clip.bank = p.name; s.clip.dirty = 0; }, { label: 'Save Clip Bank' });
        return true;
      }) },
      { label: 'Delete User Bank', disabled: !user.length, sub: user.map(p => ({ label: p.name, action: () => this.libDelete(core.STORE_KEYS.clipBanks, 'synth.sx.clipbank', p.name) })) },
    ];
  }
  playing(j) { const q = seqOf(this.kit); return !!q && ((q[4] | 0) >> j & 1) === 1; }
  buildSlots() {
    const K = this.kit;
    this.slots = new SlotStrip(this, this.sec.slots, {
      kind: 'clip',
      name: j => core.slotName(this.C().clips[j], j) + (this.C().preview === j ? ' ◉' : ''),
      title: j => 'Clip ' + NOTE_NAMES[j] + ' — ' + core.slotName(this.C().clips[j], j),
      sel: () => this.C().sel,
      select: j => { if (this.C().sel !== j) K.edit(s => { s.clip.sel = j; }, { label: 'Select Clip' }); },
      play: j => this.cmd(this.playing(j) ? 'clipStop' : 'clipLaunch', j),
      playing: j => this.playing(j),
      menu: (j, x, y) => wk.contextMenu(x, y, this.slotItems(j), { anchor: this.slots.slots[j].name }),
      rhythm: j => this.C().clips[j],
      drag: (j, e) => this.dragSlot(j, e),
    });
    this.fn(() => this.slots.update());
  }
  slotItems(j) {
    const K = this.kit, put = (fn, label) => K.edit(s => { fn(s.clip.clips, s.clip); s.clip.dirty = 1; }, { label });
    const tf = hostFn(K, 'tracks'), tracks = tf ? arr(tf()).filter(t => t && t.id) : [];
    return [
      { label: 'Rename Clip…', action: () => K.prompt('Rename Clip', 'Name', this.C().clips[j].name, t => { const n = String(t || '').trim().slice(0, 32); put(S => { S[j].name = n; }, 'Rename Clip'); return true; }) },
      { label: 'Copy Clip', action: () => { SLOT_CB.clip = clone(this.C().clips[j]); } },
      { label: 'Paste Clip', disabled: !SLOT_CB.clip, action: () => { if (!SLOT_CB.clip) return; const c = this.fitClip(j, SLOT_CB.clip); put(S => { S[j] = c; }, 'Paste Clip'); } },
      { label: 'Erase Clip', action: () => put(S => { S[j] = core.defaultClipSlot(); }, 'Erase Clip') },
      { sep: true },
      { label: 'Set as Preview Clip', checked: this.C().preview === j, action: () => K.edit(s => { s.clip.preview = s.clip.preview === j ? -1 : j; }, { label: 'Preview Clip' }) },
      { label: 'Export MIDI File', action: () => this.exportSmf(j) },
      { label: 'Copy to Track', disabled: !tracks.length || !hostFn(K, 'clipToTrack'), sub: tracks.map(t => ({ label: String(t.name || t.id), action: () => this.toTrack(j, t.id) })) },
    ];
  }
  smfName(j) { return (this.C().clips[j].name || 'Clip ' + (j + 1)).replace(/[\\/:*?"<>|]+/g, '_') + '.mid'; }
  exportSmf(j) {
    const K = this.kit, f = hostFn(K, 'download');
    if (!f || typeof Blob === 'undefined') { this.notify('Downloads are not available'); return false; }
    const bytes = core.clipToSmf(this.C().clips[j], bpmOf(K));
    f(this.smfName(j), new Blob([bytes], { type: 'audio/midi' }));
    return true;
  }
  // Copy to Track ▸ (§7.5.6): the clip's unmuted notes of [start, len) in song units relative to the paste point
  // (seq-core clipTrackNotes with playhead 0: t = round(240·(t16 − start)), d = max(1, round(240·len16))); the host adds
  // the song playhead to every t and pastes them as one project-history step
  toTrack(j, id) {
    const f = hostFn(this.kit, 'clipToTrack');
    if (!f) { this.notify('Copy to Track is not available'); return false; }
    f(id, core.clipTrackNotes(this.C().clips[j], 0));
    return true;
  }
  // desktop drag of a slot = Export MIDI File through the DownloadURL drag type (Chromium, deviation 21)
  dragSlot(j, e) {
    const dt = e && e.dataTransfer, U = globalThis.URL;
    if (!dt || typeof dt.setData !== 'function' || typeof Blob === 'undefined' || !U || !U.createObjectURL) return;
    try {
      const url = U.createObjectURL(new Blob([core.clipToSmf(this.C().clips[j], bpmOf(this.kit))], { type: 'audio/midi' }));
      dt.setData('DownloadURL', 'audio/midi:' + this.smfName(j) + ':' + url);
      dt.effectAllowed = 'copy';
      const tm = setTimeout(() => U.revokeObjectURL(url), 60000);
      if (tm && typeof tm.unref === 'function') tm.unref();   // (node: never keeps a test process alive)
    } catch (err) { /* the browser refused: the menu item remains */ }
  }
  clipKnob(id, label, o) {
    const key = CLIP_N[id];
    return this.vKnob(id, label, () => this.clip().n[key], (n, ph) => this.editClips(c => { c.n[key] = n; }, { label: destOf(id).label, phase: ph }), o);
  }
  clipTog(field, label) { return this.tog(label, () => this.clip()[field], v => this.editClips(c => { c[field] = v; }, { label: 'Clip ' + label })); }
  buildSettings() {
    const d = this.doc, B = this.sec.settings, c = () => this.clip();
    const name = btn(d, 'sx-seqbtn sx-bankbtn', '', 'Clip presets', () => menuAt(name, this.clipItems()));
    name.setAttribute('aria-haspopup', 'menu');
    B.appendChild(name);
    this.fn(() => { const t = core.slotName(c(), this.C().sel); if (name.textContent !== t) { name.textContent = t; name.setAttribute('aria-label', 'Clip: ' + t); } });
    const lenG = {};   // start / offset a LENGTH drag may clamp, per clip, from its first step (gMap)
    B.appendChild(lenBox(this, 'LENGTH', () => c().len, (v, ph) => {
      const M = gMap(lenG, ph);
      this.editClips(x => {
        const o = gOrig(M, x, q => ({ start: q.start, off: q.off }));
        x.len = v;
        x.start = Math.min(o.start, v - 1);
        x.off = clamp(o.off, x.start, v - 1);
      }, { label: 'Clip length', phase: ph });
      gDone(lenG, ph);
    }, core.MAX_CLIP_LEN, core.defaultClipSlot().len).el);
    B.appendChild(this.seg('KB SPAN', core.KB_SPAN.slice(), () => c().kb, i => this.editClips(x => { x.kb = i; }, { label: 'KB Span' })).el);
    B.appendChild(this.clipKnob('clip.trans', 'TRANS').el);
    B.appendChild(this.menu('MODE', core.CLIP_MODES.map((l, i) => ({ v: i, label: l })), () => c().mode, v => this.editClips(x => { x.mode = v; }, { label: 'Clip mode' })).el);
    const time = this.menu('TIME', core.TIME_LADDER.map((e, i) => ({ v: i, label: e.label })), () => c().time, v => this.editClips(x => { x.time = v; }, { label: 'Clip time' }));
    B.appendChild(time.el);
    this.fn(() => { time.el.style.display = c().mode >= 4 && c().mode <= 7 ? '' : 'none'; });
    B.appendChild(this.clipKnob('clip.rate', 'RATE').el);
    B.appendChild(this.clipKnob('clip.offset', 'OFFSET').el);
    B.appendChild(this.menu('LAUNCH QUANT', core.LAUNCH_QUANT.map((e, i) => ({ v: i, label: e.label })), () => c().quant, v => this.editClips(x => { x.quant = v; }, { label: 'Clip launch quant' })).el);
    B.appendChild(this.clipTog('retrig', 'RETRIG').el);
    B.appendChild(this.clipTog('veloTrig', 'VELO TRIG').el);
    B.appendChild(this.clipTog('noteGate', 'NOTE GATE').el);
  }
  // CLIP field: load / save / rename the selected clip (user clips synth.sx.clips, factory clips from the banks)
  clipItems() {
    const K = this.kit, KEY = core.STORE_KEYS.clips, T = 'synth.sx.clip', user = this.lib(KEY, T);
    const load = (c, label) => { const n = this.fitClip(this.C().sel, c); this.editSel(x => { for (const k of Object.keys(n)) x[k] = n[k]; }, { label: label || 'Load Clip' }); };
    return [
      { label: 'Factory', sub: core.FACTORY_CLIP_BANKS.filter(b => b.clips.some(c => c.notes.length)).map(b => ({ label: b.name,
        sub: b.clips.map((c, j) => ({ label: core.slotName(c, j), action: () => load(c) })) })) },
      { label: 'User', sub: user.length ? user.map(p => ({ label: p.name, action: () => load(p.clip) })) : [{ label: '(none)', disabled: true }] },
      { label: 'Init Clip', action: () => load(core.defaultClipSlot(), 'Init Clip') },
      { sep: true },
      { label: 'Save Clip…', action: () => K.prompt('Save Clip', 'Name', this.clip().name, t => {
        const nm = String(t || '').trim();
        if (!nm) return false;
        const p = core.clipPayload(this.clip(), nm);
        if (this.libSave(KEY, T, p)) this.editSel(x => { x.name = p.name; }, { label: 'Save Clip' });
        return true;
      }) },
      { label: 'Rename Clip…', action: () => K.prompt('Rename Clip', 'Name', this.clip().name, t => { const nm = String(t || '').trim().slice(0, 32); this.editSel(x => { x.name = nm; }, { label: 'Rename Clip' }); return true; }) },
      { label: 'Delete User Clip', disabled: !user.length, sub: user.map(p => ({ label: p.name, action: () => this.libDelete(KEY, T, p.name) })) },
    ];
  }
  /* piano roll: tool bar (grid, zoom, fold, headphones, actions) + PianoRoll on the selected clip */
  buildRoll() {
    const K = this.kit, d = this.doc, B = this.sec.roll;
    const bar = mk(d, 'div', 'sx-rollbar');
    B.appendChild(bar);
    const sel = s => { const C = s && s.clip; return C ? arr(C.clips)[C.sel] || null : null; };
    this.roll = new PianoRoll(B, {
      doc: d,
      clip: () => sel(K.s()),
      edit: (fn, e) => K.edit(s => { const c = sel(s); if (c) fn(c); s.clip.dirty = 1; }, Object.assign({ label: 'Clip' }, e)),
      key: () => K.s().kbd.key,
      scale: () => K.s().kbd.scale,
      playhead: () => { const q = seqOf(K); return q && fin(q[5]) ? q[5] : -1; },
      audition: (K.host && K.host.audition) || null,
      record: () => (this.rec && this.rec.ci === this.C().sel ? { notes: this.pending() } : null),
      zoom: () => arr(K.s().ui.clipZoom),
      setZoom: z => K.edit(s => { s.ui.clipZoom = [z[0], z[1]]; }, { label: 'View', ui: true }),
      notify: t => this.notify(t),
      maxRecs: () => this.noteRoom(this.C().sel),
      keys: () => keysOn(K),
      viewKey: () => this.C().sel,
    });
    const R = this.roll;
    bar.appendChild(this.own(wk.menu({ label: 'GRID', items: () => core.GRID_LADDER.map((e, i) => ({ v: i, label: e.label })), get: () => R.gridIdx(), set: v => R.command('grid', v), arrows: true, wheel: true })).el);
    const zb = (t, f, label) => btn(d, 'sx-seqbtn', t, label, () => { const z = R.zoomXY(); R.command('zoom', [z[0] * f, z[1]]); });
    bar.append(zb('−', 0.5, 'Zoom out'), zb('+', 2, 'Zoom in'));
    const fold = btn(d, 'sx-seqbtn sx-fold', 'FOLD', 'Fold: used notes (Ctrl/⌘-tap or long-press: scale + used)');
    let lp = null, lpFired = false;
    fold.addEventListener('pointerdown', e => { lpFired = false; if (lp) lp.cancel(); lp = wk.longPress(fold, e, () => { lpFired = true; R.command('fold', R.foldMode === 2 ? 0 : 2); this.update(); }); });
    fold.addEventListener('pointermove', e => { if (lp) lp.move(e); });
    for (const t of ['pointerup', 'pointercancel']) fold.addEventListener(t, () => { if (lp) lp.cancel(); lp = null; });
    fold.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });
    fold.addEventListener('click', e => {
      if (lpFired) { lpFired = false; return; }
      R.command('fold', modKey(e) || mods(e).alt ? (R.foldMode === 2 ? 0 : 2) : R.foldMode ? 0 : 1);
      consume();
      this.update();
    });
    this.offs.push(() => { if (lp) lp.cancel(); });
    bar.appendChild(fold);
    const ear = btn(d, 'sx-seqbtn sx-ear', '🎧', 'Note preview', () => { R.command('audition', R.listen ? 0 : 1); this.update(); });
    bar.appendChild(ear);
    const act = btn(d, 'sx-seqbtn', '⋯', 'Piano roll actions', () => menuAt(act, R.menuItems()));
    act.setAttribute('aria-haspopup', 'menu');
    bar.appendChild(act);
    this.fn(() => {
      fold.setAttribute('aria-pressed', R.foldMode ? 'true' : 'false');
      fold.textContent = R.foldMode === 2 ? 'FOLD ♯' : 'FOLD';
      ear.setAttribute('aria-pressed', R.listen ? 'true' : 'false');
      ear.disabled = !(K.host && K.host.audition);
    });
    this.fn(() => R.refresh());
    // lanes under the roll
    this.lanes = new LaneView(this.sec.lanes, {
      doc: d, roll: R, obj: () => sel(K.s()), lanes: clipLanes(k => { const m = arr(K.s().macros)[k]; return (m && m.name) || 'Macro ' + (k + 1); }),
      edit: (fn, e) => this.editSel(fn, e),
      init: L => (L.macro !== undefined ? (arr(K.s().macros)[L.macro] || {}).v : 0.5),
    });
    this.fn(() => this.lanes.refresh());
  }
  /* RECORD (§13.8, §7.5.6): OVERDUB / EXTEND, metronome, record ●, commit ✓, undo take ↶, finish ■ */
  buildRecord() {
    const K = this.kit, d = this.doc, B = this.sec.record;
    B.appendChild(this.seg('', ['OVERDUB', 'EXTEND'], () => this.C().rec.mode, i => K.edit(s => { s.clip.rec.mode = i; }, { label: 'Record mode', ui: true })).el);
    // METRO switches the app's metronome while recording (host.metronome, a requested §11.15 addition): disabled
    // without it, so the toggle never pretends to do something
    const metro = this.tog('METRO', () => this.C().rec.metro, v => {
      K.edit(s => { s.clip.rec.metro = v; }, { label: 'Metronome', ui: true });
      const f = hostFn(K, 'metronome');
      if (f && this.rec) f(!!v);
    }, { disabled: () => !hostFn(K, 'metronome') });
    B.appendChild(metro.el);
    this.fn(() => { const t = hostFn(K, 'metronome') ? 'Metronome while recording' : 'Metronome: not available'; if (metro.el.title !== t) metro.el.title = t; });
    const recB = btn(d, 'sx-seqbtn sx-recbtn', '●', 'Record', () => this.record(!this.rec));
    const ok = btn(d, 'sx-seqbtn', '✓', 'Commit the take', () => this.commitTake());
    const undo = btn(d, 'sx-seqbtn', '↶', 'Undo the take', () => this.undoTake());
    const fin2 = btn(d, 'sx-seqbtn', '■', 'Finish recording', () => this.finishRecord());
    B.append(recB, ok, undo, fin2);
    this.fn(() => {
      const on = !!this.rec;
      recB.setAttribute('aria-pressed', on ? 'true' : 'false');
      for (const b of [ok, undo, fin2]) b.style.display = on ? '' : 'none';
    });
  }
  buildMacros() {
    const K = this.kit, d = this.doc, B = this.sec.macros, secEl = B.parentNode;
    const tgl = btn(d, 'sx-seqbtn sx-macbtn', 'MACROS', 'Show the macros pane', () => { this.macrosOpen = !this.macrosOpen; this.update(); });
    this.sec.midiout.appendChild(tgl);
    const pane = mk(d, 'div', 'sx-macpane');
    B.appendChild(pane);
    for (let k = 0; k < 8; k++) {
      // the knob label follows the macro's name
      const name = () => { const m = arr(K.s().macros)[k]; return (m && m.name) || 'Macro ' + (k + 1); };
      pane.appendChild(this.vKnob('m' + (k + 1), name, () => (arr(K.s().macros)[k] || {}).v, (n, ph) => this.setMacro(k, n, ph), { size: 'sm' }).el);
    }
    this.fn(() => {
      if (secEl && secEl.classList) secEl.classList.toggle('sx-hide', !this.macrosOpen);
      tgl.setAttribute('aria-pressed', this.macrosOpen ? 'true' : 'false');
    });
  }
  // macro knob: base value; while a recording runs on its playing clip, the move is also written into that clip's lane
  // at the heard position (§13.8) — each move overwrites the lane from the previous move's position (laneWrite)
  setMacro(k, n, ph) {
    const K = this.kit, R = this.rec, lane = 'm' + (k + 1), c = R && !R.wait && !R.stopT ? this.recClip() : null;
    if (c) {
      const x = clamp01(this.loopPos(c, this.recPos(now())) / Math.max(1, c.len)), ci = R.ci;
      const x0 = ph === 'start' || R.lane[k] === undefined ? x : R.lane[k];
      R.lane[k] = ph === 'end' ? undefined : x;
      R.wrote = true;
      K.edit(s => {
        const m = arr(s.macros)[k];
        if (m) m.v = n;
        const C = s.clip, cl = C.clips[ci];
        if (cl && cl.lanes) cl.lanes[lane] = laneWrite(cl.lanes[lane], x0 <= x ? x0 : x, x, n);
        C.dirty = 1;
      }, { label: 'Macro ' + (k + 1), phase: ph });
      return;
    }
    K.edit(s => { const m = arr(s.macros)[k]; if (m) m.v = n; }, { label: 'Macro ' + (k + 1), phase: ph });
  }

  /* recording (§13.8, §7.5.6)
   * this.rec = { ci: the clip the recording belongs to (whichever clip is selected later), lenStart / len0: its length at
   *   record start / when the current take began, grown: the length EXTEND last set (−1: none), take: finished notes,
   *   open: Map(note → {t, vel}) of held notes, buf: input events waiting for the clock, wait: no clock yet (the launch is
   *   quantised; input is buffered), launchT: deadline of the launch (ms), stopT: when the clip was first seen stopped,
   *   hold: EXTEND paused until the DSP plays the clip shortened by ↶, off / k: the clock — clip ci's DSP playhead at
   *   time t (ms, performance.now) is off + t·k (unwrapped sixteenths), win: the recent anchor offsets, latMs / latK:
   *   the output latency (ms / sixteenths), lane: macro lane positions, maxEnd / maxEnd0: end of the last placed note
   *   (now / when the take began), added / wrote: notes committed / macro lanes written so far, unIn: the input remover }
   * The clock is anchored on the first snapshot that shows clip ci playing and re-anchored on every later one: the
   * least-delayed of the last REC_WIN snapshots wins (a late delivery only makes the playhead look earlier), a jump of
   * more than REC_JUMP_MS of clip time (a seek, a relaunch) restarts the window; a tempo or RATE change re-bases it.
   * Input notes are placed at the heard position recPos(t) = off + t·k − latK; while there is no clock they are
   * buffered and placed once it exists, so a note played on the launch downbeat lands on the downbeat. EXTEND grows the
   * clip a bar ahead of the DSP playhead and only while the clip plays. A launch that does not show within LAUNCH QUANT +
   * 2.5 s, or the clip stopping for 150 ms, ends the recording with a notice. */
  recClip() { const R = this.rec; return R ? arr(this.C().clips)[R.ci] || null : null; }
  // sixteenths per ms of a clip: tempo × its RATE base (§7.5.3)
  rateK(c) {
    const rate = core.CLIP_RATE_VALUES[Math.round(clamp01(c && c.n && fin(c.n.rate) ? c.n.rate : 0.5) * 10)] || 1;
    return bpmOf(this.kit) / 60000 * 4 * rate;
  }
  dspPos(t) { const R = this.rec; return R ? R.off + t * R.k : 0; }
  recPos(t) { const R = this.rec; return R ? R.off + t * R.k - R.latK : 0; }
  loopPos(c, pos) { const span = Math.max(1, c.len - c.start); return c.start + ((((pos - c.start) % span) + span) % span); }
  // clip ci's DSP playhead in the current snapshot (§7.10): −1 not playing, NaN playing at an unknown position
  clipHead(ci) {
    const q = seqOf(this.kit);
    if (!q || !(((q[4] | 0) >> ci) & 1)) return -1;
    if (this.C().sel === ci && fin(q[5]) && q[5] >= 0) return q[5];
    if ((q[6] | 0) === ci && fin(q[7]) && q[7] >= 0) return q[7];
    return NaN;
  }
  // a new snapshot since the last call (the snapshot object / kit.snapSeq) → its receive time in this.snapAt
  seeSnap() {
    const K = this.kit, sn = typeof K.snap === 'function' ? K.snap() : null, sq = typeof K.snapSeq === 'function' ? K.snapSeq() : 0;
    if (sn === this.snObj && sq === this.snSeq) return false;
    this.snObj = sn;
    this.snSeq = sq;
    let st = NaN;
    if (typeof K.snapTime === 'function') { try { st = +K.snapTime(); } catch (err) { st = NaN; } }
    this.snapAt = fin(st) ? st : now();
    return true;
  }
  record(want) {
    const K = this.kit;
    if (!want) { this.finishRecord(); return false; }
    if (this.rec) return true;
    if (!hostFn(K, 'onInput') && !hubOf(K).keys) { this.notify('Recording is not available'); return false; }
    const C = this.C(), ci = C.sel, c = C.clips[ci];
    if (!c) return false;
    this.seeSnap();
    const playing = this.clipHead(ci) !== -1;
    if (!playing) {
      if (!hostFn(K, 'seqCmd')) { this.notify('Recording needs the clip to play: launching is not available'); return false; }
      // the CLIP module must be on for the launch to happen: switched on with the recording (its own undo step)
      if (typeof K.getN === 'function' && typeof K.setN === 'function' && !(K.getN('clip.on') >= 0.5)) K.setN('clip.on', 1, 'set');
    }
    const k = this.rateK(c), lq = core.LAUNCH_QUANT[c.quant], lat = hostFn(K, 'latency');
    let latS = 0;
    if (lat) { try { latS = Math.max(-0.1, Math.min(1, +lat() || 0)); } catch (err) { latS = 0; } } // (< 0: a Latency setting past the clock's own delay)
    this.rec = { ci, lenStart: c.len, len0: c.len, grown: -1, take: [], open: new Map(), buf: [], wait: true,
      launchT: now() + (lq ? lq.beats : 0) * 60000 / bpmOf(K) + 2500, stopT: 0, hold: false, off: 0, k, win: [],
      latMs: latS * 1000, latK: latS * 1000 * k, lane: [], maxEnd: -Infinity, maxEnd0: -Infinity, added: 0, wrote: false, unIn: null };
    if (playing) this.observe(this.snapAt);
    else this.cmd('clipLaunch', ci);
    this.rec.unIn = hubAdd(K, ev => this.input(ev));
    const mt = hostFn(K, 'metronome');
    if (mt) mt(!!C.rec.metro);
    this.update();
    return true;
  }
  // a snapshot received at `stamp` → the clock (anchor / re-anchor) or the clip's stop
  observe(stamp) {
    const R = this.rec, c = this.recClip();
    if (!R || !c) return;
    const q = this.clipHead(R.ci);
    if (q === -1) { if (!R.wait && !R.stopT) R.stopT = stamp || now(); return; }
    R.stopT = 0;
    if (!fin(q)) return;
    if (R.hold) { if (q < c.len) R.hold = false; else return; }   // the DSP still plays the length ↶ took back
    if (R.wait) {
      R.off = q - stamp * R.k;
      R.win = [R.off];
      R.wait = false;
      for (const ev of R.buf.splice(0)) this.place(ev);
      return;
    }
    const pred = R.off + stamp * R.k, span = Math.max(1, c.len - c.start);
    const u = this.C().rec.mode === 1 ? q : q + span * Math.round((pred - q) / span);   // OVERDUB loops: the pass nearest the clock
    const o = u - stamp * R.k;
    if (Math.abs(o - R.off) > Math.max(0.25, REC_JUMP_MS * R.k)) { R.win = [o]; R.off = o; return; }
    R.win.push(o);
    if (R.win.length > REC_WIN) R.win.shift();
    R.off = Math.max.apply(null, R.win);
  }
  // live input of this track (the hub: host.onInput and the keyboard strip): {on, n, vel, t}
  input(ev) {
    const R = this.rec;
    if (!R || this.dead || !ev) return;
    if (R.wait) { if (R.buf.length < 2048) R.buf.push(ev); return; }
    this.place(ev);
    this.extend(R.maxEnd);
    if (this.roll && this.shown) this.roll.refresh();
  }
  // one input event at its heard position (a repeated note-on ends the held note first)
  place(ev) {
    const R = this.rec, pos = this.recPos(ev.t), o = R.open.get(ev.n);
    if (o) {
      R.open.delete(ev.n);
      const r = this.placeNote(o.t, pos, ev.n, o.vel);
      R.take.push(r);
      R.maxEnd = Math.max(R.maxEnd, r[0] + r[1]);
    }
    if (ev.on) R.open.set(ev.n, { t: pos, vel: ev.vel });
  }
  // a recorded note in clip ci's time: OVERDUB wraps into [start, len) and cuts at the loop end; EXTEND keeps the
  // unwrapped time (a note that began before the clip start — played before the launch — starts at the start)
  placeNote(t0, t1, n, vel) {
    const R = this.rec, c = this.recClip() || { len: R.len0, start: 0 }, extend = this.C().rec.mode === 1, MAX = core.MAX_CLIP_LEN;
    let t = r5(t0), len = Math.max(core.MIN_LEN16, t1 - t0);   // (rounded first: −1e-15 is the downbeat, not the loop end)
    if (extend && t < c.start) { len -= c.start - t; t = c.start; }
    if (!extend || t >= MAX) t = r5(this.loopPos(c, t));
    if (!extend && t >= c.len) t = c.start;
    t = Math.max(0, t);
    len = r5(Math.max(core.MIN_LEN16, Math.min(len, (extend ? MAX : c.len) - t)));
    return [t, len, n, vel, 0, 0.5, 0.5, 0];
  }
  // Record EXTEND (§7.5.6): clip ci grows by whole bars (≤ 1024) while the recording plays past its end — a bar ahead,
  // once the DSP playhead (not the later heard position) comes within max(one beat, 250 ms) of the end, so the edit
  // reaches the worklet before the playhead would wrap; pos: a placed note's end that must fit as well. Never without a
  // clock, while the clip is stopping or while ↶ waits for the DSP
  extend(pos) {
    const R = this.rec;
    if (!R || R.wait || R.hold || R.stopT || this.C().rec.mode !== 1) return;
    const c = this.recClip();
    if (!c || c.len >= core.MAX_CLIP_LEN) return;
    const need = Math.max(this.dspPos(now()) + Math.max(4, 250 * R.k), fin(pos) ? pos : -Infinity);
    if (need < c.len) return;
    const L = Math.min(core.MAX_CLIP_LEN, c.len + 16 * (Math.floor((need - c.len) / 16) + 1));
    R.grown = L;
    this.recLen(L, 'Extend clip');
  }
  // the recorded clip's length set by the recording (EXTEND, ↶, the finish): start / offset kept inside it, its lanes
  // (over x = t / len) and the macro positions being written keep their times
  recLen(L, label) {
    const R = this.rec, c = this.recClip();
    if (!R || !c || c.len === L) return;
    const L0 = c.len;
    this.editClip(R.ci, x => {
      x.len = L;
      x.start = Math.min(x.start, L - 1);
      x.off = clamp(x.off, x.start, L - 1);
      if (isObj(x.lanes)) for (const k of Object.keys(x.lanes)) x.lanes[k] = laneResize(x.lanes[k], L0, L);
    }, { label });
    R.lane = R.lane.map(x => (x === undefined ? x : clamp01(x * L0 / L)));
  }
  // the pending take (drawn red): finished notes plus the held ones up to now
  pending() {
    const R = this.rec;
    if (!R) return [];
    const out = R.take.slice();
    if (!R.wait) { const p = this.recPos(now()); for (const [n, o] of R.open) out.push(this.placeNote(o.t, p, n, o.vel)); }
    return out;
  }
  // ✓: the take joins clip ci's notes in time order, within the clip's room (1024 per clip, its share of the 4096-note
  // bank): what does not fit is dropped with a notice, never the clip's existing notes. A new take begins.
  commitTake() {
    const R = this.rec, c = this.recClip();
    if (!R || !c || !R.take.length) return false;
    const take = R.take.splice(0), ci = R.ci, ext = this.C().rec.mode === 1, room = this.noteRoom(ci);
    const keep = sortNotes(take.filter(n => n[0] < c.len || ext)), add = keep.slice(0, Math.max(0, room - arr(c.notes).length));
    if (add.length < keep.length) this.notify(MAX_NOTES_TEXT(room) + ': ' + (keep.length - add.length) + ' recorded notes were not kept');
    if (add.length) this.editClip(ci, x => { x.notes = sortNotes(arr(x.notes).concat(add.map(n => n.slice()))); }, { label: 'Record' });
    R.added += add.length;
    R.len0 = (this.recClip() || c).len;
    R.maxEnd0 = R.maxEnd;
    if (this.roll) this.roll.refresh();
    return add.length > 0;
  }
  // ↶: the take is dropped and the bars EXTEND added during it are taken back (the length the take began with)
  undoTake() {
    const R = this.rec;
    if (!R) return false;
    R.take.length = 0;
    R.open.clear();
    R.buf.length = 0;
    R.maxEnd = R.maxEnd0;
    const c = this.recClip();
    if (c && R.grown === c.len && c.len > R.len0) {
      this.recLen(R.len0, 'Undo take');
      R.grown = -1;
      R.hold = true;
    }
    if (this.roll) this.roll.refresh();
    return true;
  }
  // ■ (or ● again): held notes end now, the take is committed, EXTEND keeps the whole bars the recording reached (its
  // growth runs a bar ahead), the input is released and the metronome stopped; why: a notice
  finishRecord(why) {
    const R = this.rec;
    if (!R) return false;
    if (!R.wait) {
      const p = this.recPos(now());
      for (const [n, o] of R.open) { const r = this.placeNote(o.t, p, n, o.vel); R.take.push(r); R.maxEnd = Math.max(R.maxEnd, r[0] + r[1]); }
    }
    R.open.clear();
    R.buf.length = 0;
    const reach = R.wait ? R.maxEnd : Math.max(R.maxEnd, this.recPos(now()));
    this.commitTake();
    const c = this.recClip();
    if (c && R.grown === c.len && this.C().rec.mode === 1) {
      // nothing recorded: the length it had; else the whole bars up to where the recording reached
      const L = !R.added && !R.wrote ? R.lenStart : Math.min(c.len, R.lenStart + 16 * Math.max(0, Math.ceil((reach - R.lenStart) / 16 - 1e-9)));
      if (L < c.len) this.recLen(L, 'Record');
    }
    this.rec = null;
    if (R.unIn) R.unIn();
    const mt = hostFn(this.kit, 'metronome');
    if (mt) mt(false);
    if (why) this.notify(why);
    this.update();
    return true;
  }
  // kit.live(fn) → fn(shown): the recording goes on while another page is shown (clock, EXTEND growth, launch and stop
  // checks); the slots and the roll are painted only while the CLIP page is on screen (§13.1)
  live(shown) {
    if (this.dead) return;
    this.shown = shown !== false;
    const fresh = this.seeSnap(), R = this.rec;
    if (R) {
      const k = this.rateK(this.recClip());
      if (k > 0 && Math.abs(k - R.k) > 1e-12) {        // tempo / RATE changed: the clock keeps its position
        const t = now(), p = this.dspPos(t);
        R.k = k;
        R.latK = R.latMs * k;
        R.off = p - t * k;
        R.win = [R.off];
      }
      if (fresh) this.observe(this.snapAt);
      if (R.wait && now() > R.launchT) this.finishRecord('The clip did not start: recording stopped');
      else if (R.stopT && now() - R.stopT >= 150) this.finishRecord('Recording finished: the clip stopped');
      else this.extend();
    }
    if (!this.shown) return;
    if (this.slots) this.slots.live();
    if (this.roll) {
      if (this.rec) this.roll.refresh();
      this.roll.tick();
    }
  }
  destroy() {
    if (this.dead) return;
    // a recording in progress is finished — its take committed through the kit (the host's edit path still addresses
    // this track) — and the input and the metronome released
    const R = this.rec;
    if (R) {
      try { this.finishRecord(); } catch (err) { warnOnce('recfin', 'sx-ui-seq: finishing the recording failed', err); }
      if (this.rec === R) { this.rec = null; if (R.unIn) R.unIn(); }
    }
    if (this.roll) this.roll.destroy();
    if (this.lanes) this.lanes.destroy();
    super.destroy();
  }
}

/* ================================================================ keyboard strip and OSC MAPPING (§13.9) */

const KBD_SECS = [['transpose', 'TRANSPOSE'], ['key', 'KEY'], ['scale', 'SCALE'], ['swing', 'SWING'], ['oscmap', ''], ['keys', ''],
  ['arpkeys', 'ARP'], ['clipkeys', 'CLIP']];
// SCALE menu groups (§3.15.7 order: each group is a contiguous run of indices)
const SCALE_GROUPS = [[0, 'Diatonic'], [9, 'Pentatonic & Blues'], [13, 'Symmetric'], [18, 'Exotic'], [28, 'World']];
const scaleGroup = i => { let g = SCALE_GROUPS[0][1]; for (const [k, n] of SCALE_GROUPS) if (i >= k) g = n; return g; };

export class KeyboardPanel extends SeqPage {
  constructor(root, kit) {
    super(kit);
    this.keys = null;
    this.arpKeys = null;
    this.clipKeys = null;
    this.inHeld = new Set();     // input notes of this track held now (host.onInput), lit on the piano keys
    this.shown = true;
    this.unIn = null;
    this.el = this.build();
    if (root) root.appendChild(this.el);
  }
  K() { return this.kit.s().kbd; }
  build() {
    const K = this.kit, d = this.doc;
    injectSeqStyles(d);
    const { el, head, body } = K.panel('KEYBOARD', null, null, 'sx-kbd');
    this.el = el;
    // collapse to the 40 px strip (s.ui.kbdOpen: UI state, not an undo step)
    const fold = btn(d, 'sx-hbtn', '', 'Collapse keyboard', () => K.edit(s => { s.ui.kbdOpen = s.ui.kbdOpen ? 0 : 1; }, { label: 'View', ui: true }));
    head.appendChild(fold);
    K.custom(() => {
      const open = !!K.s().ui.kbdOpen;
      el.classList.toggle('sx-collapsed', !open);
      fold.textContent = open ? '▾' : '▴';
      const t = open ? 'Collapse keyboard' : 'Expand keyboard';
      fold.title = t; fold.setAttribute('aria-label', t);
      fold.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    this.sec = sections(d, body, KBD_SECS);
    this.buildTranspose();
    this.sec.key.appendChild(this.menu('', [{ v: -1, label: '--' }].concat(core.KEY_NAMES.map((k, i) => ({ v: i, label: k }))), () => this.K().key,
      v => K.edit(s => { s.kbd.key = v; }, { label: 'Key' })).el);
    this.sec.scale.appendChild(this.menu('', core.SCALES.map((sc, i) => ({ v: i, label: sc.name, group: scaleGroup(i) })), () => this.K().scale,
      v => K.edit(s => { s.kbd.scale = v; }, { label: 'Scale' })).el);
    this.buildSwing();
    const map = btn(d, 'sx-hbtn sx-oscmapbtn', 'OSC MAPPING', 'OSC MAPPING: key and velocity ranges per oscillator', () => this.openMap(map));
    map.setAttribute('aria-haspopup', 'dialog');
    this.sec.oscmap.appendChild(map);
    this.buildKeys();
    K.custom(() => this.update());
    K.live(on => this.live(on));
    return el;
  }
  // TRANSPOSE −24…+24: field (drag / type / keys ±1), ◀ ▶ ±1, wheel ±12
  buildTranspose() {
    const K = this.kit, d = this.doc, B = this.sec.transpose;
    const set = (v, ph) => { const t = clamp(Math.round(v), -24, 24); if (t !== this.K().trans || ph) K.edit(s => { s.kbd.trans = t; }, { label: 'Transpose', phase: ph }); };
    const wrap = mk(d, 'div', 'sx-trans');
    const nb = this.own(wk.numBox({ label: '', get: () => (this.K().trans + 24) / 48, set: (n, ph) => set(Math.round(clamp01(n) * 48) - 24, ph), def: 0.5,
      fmt: n => { const t = Math.round(n * 48) - 24; return (t > 0 ? '+' : '') + t + ' st'; },
      parse: t => { const m = /^\s*([+-]?\d+)\s*(st)?\s*$/i.exec(String(t)); return m ? (clamp(+m[1], -24, 24) + 24) / 48 : null; }, steps: 48 }));
    const dn = btn(d, 'sx-seqbtn', '◀', 'Transpose down', () => set(this.K().trans - 1));
    const up = btn(d, 'sx-seqbtn', '▶', 'Transpose up', () => set(this.K().trans + 1));
    wrap.append(dn, nb.el, up);
    B.appendChild(wrap);
    const take = wk.wheelGate(wrap, nb.el);
    const wh = e => {
      const k = take(e);
      if (k === null) return;
      e.preventDefault();
      e.stopPropagation();
      if (k) set(this.K().trans + 12 * k);
    };
    wrap.addEventListener('wheel', wh, { passive: false, capture: true });
    this.offs.push(() => { wrap.removeEventListener('wheel', wh, { passive: false, capture: true }); if (take.destroy) take.destroy(); });
  }
  // SWING 12.5…87.5 % ("OFF" at 50 %), division 1/8 · 1/16 · 1/32 once it is not OFF
  buildSwing() {
    const K = this.kit, B = this.sec.swing;
    B.appendChild(this.own(wk.numBox({ label: '', get: () => swingN(this.K().swing), set: (n, ph) => K.edit(s => { s.kbd.swing = swingS(n); }, { label: 'Swing', phase: ph }),
      def: 0.5, fmt: n => core.swingLabel(swingS(n)), parse: swingParse, steps: 300 })).el);
    const div = this.menu('', core.SWING_DIVS.map((e, i) => ({ v: i, label: e.label })), () => this.K().div, v => K.edit(s => { s.kbd.div = v; }, { label: 'Swing division' }), { arrows: false });
    B.appendChild(div.el);
    this.fn(() => { div.el.style.display = this.K().swing === 0 ? 'none' : ''; });
  }
  // The piano keys play through host.audition and are this track's live input as well: their notes go to the input hub
  // (a CLIP recording takes them; host.onInput does not report audition calls). Input notes from host.onInput light up
  // as held keys (§13.9 — generated notes cannot be shown: the snapshot carries no note list, §7.10 / §6.20).
  buildKeys() {
    const K = this.kit;
    const aud = () => (K.host && K.host.audition) || null;
    hubOf(K).keys++;
    this.unIn = hubAdd(K, ev => this.onInput(ev));
    // 2–7 octaves by width around C4 (wk's fit: a ResizeObserver re-fits, so a repaint never reads the layout)
    this.keys = this.own(wk.pianoKeys({ lo: 48, hi: 72, label: 'Keyboard', labels: true, fit: { center: 60, min: 2, max: 7 },
      on: (n, v) => {
        const a = aud(), vel = clamp(Math.round(+v || 100), 1, 127);
        if (a && a.on) a.on(n, vel / 127);
        hubEmit(K, { on: true, n, vel, t: now(), src: 'keys' });
      },
      off: n => {
        const a = aud();
        if (a && a.off) a.off(n);
        hubEmit(K, { on: false, n, vel: 0, t: now(), src: 'keys' });
      },
      held: () => this.inHeld,
      scale: () => { const k = this.K(); const sc = core.SCALES[k.scale]; return k.key >= 0 && sc ? { key: k.key, steps: sc.steps } : null; } }));
    this.sec.keys.appendChild(this.keys.el);
    this.arpKeys = this.own(wk.pianoKeys({ lo: 0, hi: 11, vel: 100, label: 'ARP slots', color: '#b07cff',
      on: n => this.cmd('arpLaunch', n), off: () => {},
      lit: () => { const q = seqOf(K); return q && q[0] >= 0 ? [q[0]] : []; } }));
    this.sec.arpkeys.appendChild(this.arpKeys.el);
    this.clipKeys = this.own(wk.pianoKeys({ lo: 0, hi: 11, vel: 100, label: 'CLIP slots', color: '#3ddc84',
      on: n => { const q = seqOf(K); this.cmd(q && ((q[4] | 0) >> n & 1) ? 'clipStop' : 'clipLaunch', n); }, off: () => {},
      lit: () => { const q = seqOf(K), m = q ? q[4] | 0 : 0, out = []; for (let j = 0; j < 12; j++) if (m >> j & 1) out.push(j); return out; } }));
    this.sec.clipkeys.appendChild(this.clipKeys.el);
  }
  // the OSC MAPPING editor, anchored to its button (a second press closes it)
  openMap(anchor) {
    const K = this.kit;
    return K.popover('oscmap', anchor, 'OSC MAPPING', box => new OscMapEditor(box, K), () => oscMapSig(K.s()));
  }
  // host input (not the strip's own notes, src 'keys': the keys show those pressed already)
  onInput(ev) {
    if (this.dead || !ev || ev.src === 'keys') return;
    const had = this.inHeld.has(ev.n);
    if (ev.on) this.inHeld.add(ev.n); else this.inHeld.delete(ev.n);
    if (had !== this.inHeld.has(ev.n) && this.shown && this.keys) this.keys.update();
  }
  live(shown) {
    if (this.dead) return;
    const was = this.shown;
    this.shown = shown !== false;
    if (!this.shown) return;
    if (!was && this.keys) this.keys.update();
    if (this.arpKeys) this.arpKeys.update();
    if (this.clipKeys) this.clipKeys.update();
  }
  destroy() {
    if (this.dead) return;
    for (const P of [this.keys, this.arpKeys, this.clipKeys]) if (P && P.release) P.release();
    if (this.unIn) { this.unIn(); this.unIn = null; }
    const H = hubOf(this.kit);
    if (H.keys > 0) H.keys--;
    super.destroy();
  }
}

// what the OSC MAPPING editor shows: the maps of OSC A–C, Noise, Sub and the ARP row
const oscMapSig = s => JSON.stringify(s ? [arr(s.osc).map(o => o && o.map), s.noise && s.noise.map, s.sub && s.sub.map, s.kbd && s.kbd.arpMap] : null);
const MAP_ROWS = [['a', 'OSC A'], ['b', 'OSC B'], ['c', 'OSC C'], ['noise', 'Noise'], ['sub', 'Sub'], ['arp', 'ARP']];
// the map object of a row in a state
function mapOf(s, k) {
  if (!s) return null;
  if (k === 'a' || k === 'b' || k === 'c') { const o = arr(s.osc)['abc'.indexOf(k)]; return o ? o.map : null; }
  if (k === 'noise') return s.noise ? s.noise.map : null;
  if (k === 'sub') return s.sub ? s.sub.map : null;
  return s.kbd ? s.kbd.arpMap : null;
}
const DEF_MAP = { k: [0, 127], v: [1, 127], fold: 0, warp: 0 };

export class OscMapEditor {
  constructor(root, kit) {
    this.kit = kit;
    this.dead = false;
    this.tab = 0;                 // 0 KEY · 1 VEL
    this.rows = null;
    this.last = null;
    this.ws = [];
    this.el = this.build();
    if (root) root.appendChild(this.el);
  }
  map(k) { return mapOf(this.kit.s(), k) || DEF_MAP; }
  edit(k, fn, o) { this.kit.edit(s => { const m = mapOf(s, k); if (m) fn(m); }, o); }
  build() {
    const d = this.kit.doc || globalThis.document, el = this.el = mk(d, 'div', 'sx-oscmap');
    injectSeqStyles(d);
    el.setAttribute('aria-label', 'OSC MAPPING');
    const tabs = mk(d, 'div', 'sx-oscmaptabs');
    tabs.setAttribute('role', 'tablist');
    const mkTab = (label, k) => {
      const b = btn(d, 'sx-hbtn', label, label + ' ranges', () => { this.tab = k; this.last = null; this.refresh(); });
      b.setAttribute('role', 'tab');
      b.setAttribute('data-tab', String(k));
      return b;
    };
    this.tabBtns = [mkTab('KEY', 0), mkTab('VEL', 1)];
    tabs.append(...this.tabBtns);
    const list = mk(d, 'div', 'sx-oscmaprows');
    this.rows = {};
    this.bars = {};
    for (const [k, label] of MAP_ROWS) {
      const r = mk(d, 'div', 'sx-oscmaprow');
      r.setAttribute('data-row', k);
      const box = mk(d, 'div', 'sx-oscmapbar');
      const key = () => this.tab === 0;
      const bar = wk.rangeBar({ label: () => label + (key() ? ' keys' : ' velocity'), min: () => (key() ? 0 : 1), max: 127,
        get: () => (key() ? this.map(k).k : this.map(k).v),
        set: (v, ph) => this.edit(k, m => { m[key() ? 'k' : 'v'] = [v[0], v[1]]; }, { label: label + (key() ? ' key range' : ' velocity range'), phase: ph }),
        fmt: v => (key() ? noteName(v) : String(v)) });
      box.appendChild(bar.el);
      this.ws.push(bar);
      this.bars[k] = bar;
      const fold = wk.toggle({ label: 'FOLD', kind: 'led', get: () => (this.map(k).fold ? 1 : 0), set: v => this.edit(k, m => { m.fold = v ? 1 : 0; }, { label: label + ' fold' }) });
      fold.el.setAttribute('data-flag', 'fold');
      this.ws.push(fold);
      r.append(mk(d, 'span', 'sx-ttl', label), box, fold.el);
      if (k !== 'arp') {
        const warp = wk.toggle({ label: 'WARP', kind: 'led', get: () => (this.map(k).warp ? 1 : 0), set: v => this.edit(k, m => { m.warp = v ? 1 : 0; }, { label: label + ' warp' }) });
        warp.el.setAttribute('data-flag', 'warp');
        this.ws.push(warp);
        r.appendChild(warp.el);
      } else r.appendChild(mk(d, 'span'));
      list.appendChild(r);
      this.rows[k] = r;
    }
    el.append(tabs, list);
    this.refresh();
    return el;
  }
  refresh() {
    if (this.dead) return;
    const sig = this.tab + '|' + oscMapSig(this.kit.s());
    if (sig === this.last) return;
    this.last = sig;
    for (const b of this.tabBtns) b.setAttribute('aria-selected', +b.getAttribute('data-tab') === this.tab ? 'true' : 'false');
    this.el.classList.toggle('sx-keytab', this.tab === 0);   // the KEY bars lie over a keyboard (one octave = 12 / 128)
    for (const w of this.ws) w.update();
  }
  destroy() {
    if (this.dead) return;
    this.dead = true;
    for (const w of this.ws.splice(0)) if (w.destroy) w.destroy();
    this.el.remove();
  }
}

/* ================================================================ piano roll (§13.8; the pattern graph of §13.7) */

const ROLL_PPS = 16, ROLL_ROWH = 12, ROLL_EDGE = 6, KEYW = 34, RULER = 18;
// a finger's grab zones (rollHit's touch fields, PianoRoll.touchView): ends up to 14 px inside; a selected note reaches
// 18 px past its end and 8 px off its row, an unselected one 6 / 4 px (modest, so neighbours and empty cells stay reachable)
const ROLL_TOUCH = { edge: 14, out: 18, slopY: 8, outU: 6, slopU: 4 };
const ZOOM_MIN = 1 / 16, ZOOM_MAX = 64;   // the range normalizeSerum keeps for s.ui.clipZoom
const VIEW_CMDS = new Set(['fold', 'grid', 'zoom', 'audition']);
const NOTE_CB = { clip: null, pat: null };   // note clipboards ({mode: 'notes' | 'range', len, list}), shared by every roll
const PAT_BASE = (() => { const o = []; for (let r = -16; r <= 16; r++) if (r) o.push(r); return o; })();
const RC = { bg: '#0a0d10', white: '#121820', black: '#0d1116', out: '#090b0e', root: 'rgba(61, 220, 132, 0.10)', ruler: '#161b21',
  line: 'rgba(255, 255, 255, 0.05)', beat: 'rgba(255, 255, 255, 0.10)', bar: 'rgba(255, 255, 255, 0.22)', dim: 'rgba(0, 0, 0, 0.5)',
  clip: '#3ddc84', pat: '#b07cff', newest: '#ffb347', rec: '#ff5b5b', sel: '#ffffff', mute: '#7f8b98', ink: '#dfe6ee', flag: '#4fb3ff',
  off: '#ffd84a', play: '#ffd84a', range: 'rgba(79, 179, 255, 0.16)', marquee: 'rgba(79, 179, 255, 0.9)' };

export class PianoRoll {
  constructor(root, o) {
    this.o = Object.assign({}, o);
    this.kind = this.o.kind === 'pat' ? 'pat' : 'clip';
    this.ops = this.kind === 'pat' ? core.evOps : core.noteOps;
    this.F = this.kind === 'pat' ? 'ev' : 'notes';
    this.doc = docOf(root, this.o);
    this.dead = false;
    this.foldMode = 0;            // 0 off · 1 used notes · 2 scale + used (view state, not saved)
    this.grid = 2;                // GRID_LADDER index (1/16) when o.grid is absent
    this.listen = 0;              // headphones toggle
    this.t0 = 0;
    this.top = null;              // px scrolled (null = centred on the notes / C4 until the user scrolls)
    this.ztmp = null;             // zoom during a pinch (committed at its end)
    this.sel = [];
    this.selKey = null;           // hash of the list the selection indexes
    this.range = null;
    this.cursor = 0;
    this.newest = null;           // [t, pitch] of the note added last (drawn orange)
    this.lastLen = 0;
    this.lastVel = 100;
    this.g = null;
    this.tap = null;
    this.aud = null;
    this.last = null;
    this.ph = -2;
    this.offs = [];
    this.ro = null;               // ResizeObserver (browsers) and the size it keeps valid
    this.sz = null;
    this.real = false;            // the last size() read a laid-out box
    this.vk = undefined;          // o.viewKey() last seen
    this.el = this.build();
    if (root) root.appendChild(this.el);
    this.refresh();
  }
  build() {
    const d = this.doc, el = mk(d, 'div', 'sx-roll');
    injectSeqStyles(d);
    el.tabIndex = 0;
    el.setAttribute('role', 'application');
    el.setAttribute('aria-label', this.kind === 'pat' ? 'Pattern graph' : 'Piano roll');
    el.setAttribute('aria-roledescription', 'piano roll');
    this.cv = mk(d, 'canvas', 'sx-rollcv');
    this.cv.setAttribute('aria-hidden', 'true');
    this.ov = mk(d, 'canvas', 'sx-rollov');
    this.ov.setAttribute('aria-hidden', 'true');
    el.append(this.cv, this.ov);
    const on = (t, type, fn, opt) => { t.addEventListener(type, fn, opt); this.offs.push(() => t.removeEventListener(type, fn, opt)); };
    on(el, 'pointerdown', e => this.down(e));
    on(el, 'pointermove', e => this.move(e));
    on(el, 'pointerup', e => this.up(e));
    on(el, 'pointercancel', e => this.abort(e));
    on(el, 'lostpointercapture', e => { if (this.g && e.pointerId === this.g.id) this.up(e); });
    on(el, 'dblclick', e => { if (this.lastType !== 'touch') { e.preventDefault(); this.dbl(this.local(e)); } });
    on(el, 'contextmenu', e => this.onCtx(e));
    on(el, 'keydown', e => this.key(e));
    if (wk.menuSource) this.offs.push(wk.menuSource(el, { keys: true }));
    if (wk.zoomPan) {
      this.zp = wk.zoomPan(el, { axis: 'xy', get: () => this.zpView(), set: (v, ph) => this.zpSet(v, ph), min: 0.002, max: 1 });
      this.offs.push(() => this.zp.destroy());
    }
    const take = wk.wheelGate ? wk.wheelGate(el) : null;
    on(el, 'wheel', e => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || Math.abs(e.deltaX || 0) > Math.abs(e.deltaY || 0) || !take) return;   // zoomPan's
      if (take(e) === null) return;
      e.preventDefault();
      const v = this.view();
      this.top = v.top + (e.deltaY || 0) * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 200 : 1);
      this.refresh();
    }, { passive: false });
    if (take && take.destroy) this.offs.push(take.destroy);
    // size changes reach the roll through a ResizeObserver, so a repaint never forces a layout (size() caches)
    const win = d.defaultView, RO = (win && win.ResizeObserver) || globalThis.ResizeObserver;
    if (typeof RO === 'function') {
      this.ro = new RO(en => {
        this.sz = null;
        this.last = null;
        const r = en && en[0] && en[0].contentRect;
        if (!r || (r.width > 0 && r.height > 0)) this.refresh();   // hidden (0 × 0): redrawn when shown again
      });
      this.ro.observe(el);
      this.offs.push(() => this.ro.disconnect());
    }
    return el;
  }

  /* ---------------------------------------------------------------- data */
  clip() { const f = this.o.clip; const c = typeof f === 'function' ? f() : null; return c && typeof c === 'object' ? c : null; }
  recs() { const c = this.clip(); return c ? arr(c[this.F]) : []; }
  lenOf(c) { return c && fin(c.len) ? c.len : 64; }
  startOf(c) { return this.kind === 'clip' && c && fin(c.start) ? c.start : 0; }
  zoomXY() {
    if (this.ztmp) return this.ztmp.slice();
    const f = this.o.zoom, z = typeof f === 'function' ? arr(f()) : [];
    return [fin(z[0]) && z[0] > 0 ? z[0] : 1, fin(z[1]) && z[1] > 0 ? z[1] : 1];
  }
  gridIdx() {
    const g = typeof this.o.grid === 'function' ? this.o.grid() : this.grid;
    return Number.isInteger(g) && g >= 0 && g <= 6 ? g : 2;
  }
  step() { return core.GRID_LADDER[this.gridIdx()].beats * 4; }   // grid step in sixteenths
  snapR(t) { const s = this.step(); return r5(Math.round(t / s) * s); }
  snapF(t) { const s = this.step(); return r5(Math.floor(t / s + 1e-9) * s); }
  keyNow() { const f = this.o.key; const k = typeof f === 'function' ? f() : -1; return Number.isInteger(k) ? k : -1; }
  scaleNow() { const f = this.o.scale; return typeof f === 'function' ? f() : 0; }
  rowsNow(c) {
    if (this.kind === 'pat') {
      const extra = new Set(PAT_BASE);
      for (const e of arr(c && c.ev)) if (Array.isArray(e) && Number.isInteger(e[2]) && e[2] !== 0 && Math.abs(e[2]) <= 32) extra.add(e[2]);
      return Array.from(extra).sort((a, b) => a - b);
    }
    return foldRows(c ? c.notes : [], this.keyNow(), this.scaleNow(), this.foldMode);
  }
  lin(p) { return this.kind === 'pat' ? (p > 0 ? p - 1 : p) : p; }
  // the element's size (defaults before layout); kept while a ResizeObserver reports changes (not while hidden: 0 × 0)
  size() {
    if (this.sz) return this.sz;
    const r = this.el.getBoundingClientRect(), s = { w: Math.max(KEYW + 40, r.width || 640), h: Math.max(RULER + 24, r.height || 300) };
    this.real = r.width > 0 && r.height > 0;
    if (this.ro && this.real) this.sz = s;
    return s;
  }
  contentT(c) { return Math.max(16, this.lenOf(c) + 8); }
  // current geometry in rollHit's `view` form (+ w / h of the note area). During a gesture: the geometry of its start
  // (what the gesture edits — the notes' median, the folded rows, the content length — never moves the roll under the
  // pointer). Until the user scrolls, the rows are centred on the notes' median pitch (C4 / row 1 when empty) once
  // the roll is laid out, and again when o.viewKey() or the fold changes.
  view() {
    if (this.g && this.g.v) return this.g.v;
    const vk = typeof this.o.viewKey === 'function' ? this.o.viewKey() : undefined;
    if (vk !== this.vk) { if (this.vk !== undefined) this.top = null; this.vk = vk; }
    const c = this.clip(), [zx, zy] = this.zoomXY(), sz = this.size(), rows = this.rowsNow(c);
    const pps = ROLL_PPS * zx, rowH = ROLL_ROWH * zy, visW = sz.w - KEYW, visH = sz.h - RULER, CH = rows.length * rowH;
    const t0 = clamp(this.t0, 0, Math.max(0, this.contentT(c) - visW / pps));
    let top = this.top;
    if (!fin(top)) {
      let target = this.kind === 'pat' ? 1 : 60;
      const L = this.recs().map(r => r[2]).filter(Number.isInteger).sort((a, b) => a - b);
      if (L.length) target = L[L.length >> 1];
      let ri = rows.indexOf(target);
      if (ri < 0) ri = rows.findIndex(n => n >= target);
      if (ri < 0) ri = rows.length - 1;
      top = (rows.length - 1 - ri) * rowH - visH / 2 + rowH / 2;
      top = clamp(top, 0, Math.max(0, CH - visH));
      if (this.sz || this.real) this.top = top;   // centred once, on the real size
    }
    top = clamp(top, 0, Math.max(0, CH - visH));
    return { t0, pps, rows, rowH, top, edge: ROLL_EDGE, w: visW, h: visH };
  }
  // a view with a finger's grab zones (ROLL_TOUCH) for rollHit
  touchView(v) { return Object.assign({}, v, ROLL_TOUCH, { sel: this.selNow() }); }
  rowAt(y, v, clampIt) {
    const fromTop = Math.floor((y - RULER + v.top) / v.rowH), row = v.rows.length - 1 - fromTop;
    if (clampIt) return clamp(row, 0, v.rows.length - 1);
    return row < 0 || row >= v.rows.length ? -1 : row;
  }
  // pointer position in the roll (during a gesture against the box measured at its start: no layout read per move)
  local(e) { const G = this.g, r = G && G.rect ? G.rect : this.el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  // the selection as it acts: indices into the records, kept while the records keep their time, length and pitch (lane
  // edits of velocity / expression / accent keep it); any other change of the list clears it
  selNow() {
    const L = this.recs(), k = hashRecs(L, 3);
    if (this.selKey !== k) { this.sel = []; this.selKey = k; }
    return this.sel.filter(i => i >= 0 && i < L.length);
  }
  setSel(sel, L) { this.sel = Array.from(new Set(sel)).sort((a, b) => a - b); this.selKey = hashRecs(L || this.recs(), 3); }
  edit(fn, e) { if (typeof this.o.edit === 'function') this.o.edit(fn, e); }
  notify(t) { if (typeof this.o.notify === 'function') this.o.notify(t); }

  /* ---------------------------------------------------------------- drawing */
  sig() {
    const c = this.clip(), v = this.view(), R = typeof this.o.record === 'function' ? this.o.record() : null;
    return [c ? hashRecs(c[this.F]) : '-', c && c.len, c && c.start, c && c.off, v.t0, v.pps, v.rowH, v.top, v.rows.length, v.rows[0], v.w, v.h,
      this.gridIdx(), this.listen, this.foldMode, this.keyNow(), JSON.stringify(this.scaleNow()), this.selNow().join(','), this.range ? this.range.join(',') : '',
      this.newest ? this.newest.join(',') : '', R ? hashRecs(R.notes) : '', this.g && this.g.type === 'marquee' ? [this.g.x1, this.g.y1].join(',') : ''].join('|');
  }
  // redraws when what the roll shows changed
  refresh() {
    if (this.dead) return false;
    const nk = !this.keysOn();
    if (this.el.classList.contains('sx-nokeys') !== nk) this.el.classList.toggle('sx-nokeys', nk);   // no shortcuts: no focus ring
    const sig = this.sig();
    if (sig === this.last) return false;
    this.last = sig;
    this.draw();
    this.drawOv();
    return true;
  }
  // playhead only (snapshot frames)
  tick() {
    if (this.dead) return;
    const f = this.o.playhead, ph = typeof f === 'function' ? f() : -1;
    if (ph === this.ph) return;
    this.ph = ph;
    this.drawOv();
  }
  ctx(cv) {
    const { w, h } = this.size(), win = this.doc.defaultView, dpr = Math.min(2, Math.max(1, (win && win.devicePixelRatio) || 1));
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    const g = cv.getContext ? cv.getContext('2d') : null;
    if (!g) return null;
    if (g.setTransform) g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return g;
  }
  xOf(t, v) { return KEYW + (t - v.t0) * v.pps; }
  yOf(row, v) { return RULER + (v.rows.length - 1 - row) * v.rowH - v.top; }
  draw() {
    const g = this.ctx(this.cv);
    if (!g) return;
    const c = this.clip(), v = this.view(), { w, h } = this.size(), pat = this.kind === 'pat';
    const len = this.lenOf(c), start = this.startOf(c), key = this.keyNow();
    g.fillStyle = RC.bg;
    g.fillRect(0, 0, w, h);
    // rows
    const steps = !pat && key >= 0 ? scaleSteps(this.scaleNow()) : null, inScale = steps ? new Set(steps.map(pc12)) : null;
    const rTop = this.rowAt(RULER, v, true), rBot = this.rowAt(h - 1, v, true);
    g.font = '9px system-ui, sans-serif';
    for (let r = rBot; r <= rTop; r++) {
      const p = v.rows[r], y = this.yOf(r, v);
      let col = pat ? (p > 0 ? RC.white : RC.black) : BLACK[pc12(p)] ? RC.black : RC.white;
      if (inScale && !inScale.has(pc12(p - key))) col = RC.out;
      g.fillStyle = col;
      g.fillRect(KEYW, y, w - KEYW, v.rowH);
      if (inScale && pc12(p - key) === 0) { g.fillStyle = RC.root; g.fillRect(KEYW, y, w - KEYW, v.rowH); }
      g.fillStyle = RC.line;
      g.fillRect(KEYW, y + v.rowH - 1, w - KEYW, 1);
      // key column
      g.fillStyle = pat ? (p > 0 ? '#1c232b' : '#161b21') : BLACK[pc12(p)] ? '#0c0f13' : '#d8dee6';
      g.fillRect(0, y, KEYW - 2, v.rowH - 1);
      if (v.rowH >= 8 && (pat || pc12(p) === 0)) {
        g.fillStyle = pat ? RC.ink : '#11161c';
        g.fillText(pat ? String(p) : noteName(p), 3, y + Math.min(v.rowH - 2, 10));
      }
    }
    // vertical grid: grid step, beats, bars
    const stp = this.step(), tEnd = v.t0 + v.w / v.pps;
    const lines = (every, style, minPx) => {
      if (every * v.pps < minPx) return;
      g.fillStyle = style;
      for (let t = Math.ceil(v.t0 / every - 1e-9) * every; t <= tEnd; t += every) g.fillRect(Math.round(this.xOf(t, v)), RULER, 1, h - RULER);
    };
    lines(stp, RC.line, 4);
    lines(4, RC.beat, 6);
    lines(16, RC.bar, 4);
    // outside the played region
    g.fillStyle = RC.dim;
    const xs = this.xOf(start, v), xe = this.xOf(len, v);
    if (xs > KEYW) g.fillRect(KEYW, RULER, xs - KEYW, h - RULER);
    if (xe < w) g.fillRect(Math.max(KEYW, xe), RULER, w - Math.max(KEYW, xe), h - RULER);
    // time range
    if (this.range) { g.fillStyle = RC.range; const a = this.xOf(this.range[0], v), b = this.xOf(this.range[1], v); g.fillRect(Math.max(KEYW, a), 0, Math.max(0, b - Math.max(KEYW, a)), h); }
    // notes
    const rowOf = new Map(v.rows.map((p, i) => [p, i])), sel = new Set(this.selNow()), base = pat ? RC.pat : RC.clip;
    const drawRec = (r, i, fill) => {
      const ri = rowOf.get(r[2]);
      if (ri === undefined || ri < rBot || ri > rTop) return;
      const x = this.xOf(r[0], v), wd = Math.max(2, r[1] * v.pps), y = this.yOf(ri, v);
      if (x > w || x + wd < KEYW) return;
      const muted = !pat && r[4];
      g.globalAlpha = 0.45 + 0.55 * clamp((+r[3] || 100) / 127, 0, 1);
      g.fillStyle = fill || (this.newest && this.newest[0] === r[0] && this.newest[1] === r[2] ? RC.newest : base);
      if (muted) { g.strokeStyle = RC.mute; if (g.strokeRect) g.strokeRect(x + 0.5, y + 1.5, wd - 1, v.rowH - 3); }
      else g.fillRect(x, y + 1, wd, v.rowH - 2);
      g.globalAlpha = 1;
      if (i >= 0 && sel.has(i)) { g.strokeStyle = RC.sel; if (g.strokeRect) g.strokeRect(x + 0.5, y + 1.5, wd - 1, v.rowH - 3); }
      if (pat && r[4]) { g.fillStyle = RC.newest; g.fillRect(x, y + 1, 3, v.rowH - 2); }   // accent mark
    };
    g.save && g.save();
    if (g.beginPath) { g.beginPath(); g.rect && g.rect(KEYW, RULER, w - KEYW, h - RULER); g.clip && g.clip(); }
    this.recs().forEach((r, i) => { if (Array.isArray(r)) drawRec(r, i, null); });
    // touch: grab tabs on the selected notes' ends (and starts, on notes wide enough to grab there)
    if (sel.size && sel.size <= 256 && typeof wk.touchMode === 'function' && wk.touchMode()) {
      const L = this.recs();
      g.fillStyle = RC.sel;
      for (const i of sel) {
        const r = L[i], ri = Array.isArray(r) ? rowOf.get(r[2]) : undefined;
        if (ri === undefined || ri < rBot || ri > rTop) continue;
        const x = this.xOf(r[0], v), wd = Math.max(2, r[1] * v.pps), y = this.yOf(ri, v);
        g.fillRect(x + wd - 2, y - 1, 5, v.rowH + 2);
        if (wd >= 18) g.fillRect(x - 3, y - 1, 5, v.rowH + 2);
      }
    }
    const R = typeof this.o.record === 'function' ? this.o.record() : null;
    if (R) for (const r of arr(R.notes)) if (Array.isArray(r)) drawRec(r, -1, RC.rec);
    g.restore && g.restore();
    // ruler: bars, flags, offset marker
    g.fillStyle = RC.ruler;
    g.fillRect(0, 0, w, RULER);
    g.fillStyle = RC.ink;
    const barPx = 16 * v.pps, every = barPx >= 28 ? 1 : barPx >= 14 ? 2 : barPx >= 7 ? 4 : 8;
    for (let b = Math.max(0, Math.floor(v.t0 / 16)); b * 16 <= tEnd; b++) {
      if (b % every) continue;
      const x = this.xOf(16 * b, v);
      if (x >= KEYW) g.fillText(String(b + 1), x + 2, 12);
    }
    const flag = (t, col, dir) => {
      const x = this.xOf(t, v);
      if (x < KEYW - 1 || x > w + 1) return;
      g.fillStyle = col;
      g.fillRect(Math.round(x), 0, 1, h);
      if (g.beginPath && g.moveTo) { g.beginPath(); g.moveTo(x, 1); g.lineTo(x + 8 * dir, 1); g.lineTo(x, 9); g.fill && g.fill(); }
      else g.fillRect(dir > 0 ? x : x - 6, 1, 6, 8);
    };
    if (!pat) flag(start, RC.flag, 1);
    flag(len, RC.flag, -1);
    if (!pat && c && fin(c.off)) {
      const x = this.xOf(c.off, v);
      if (x >= KEYW - 1 && x <= w + 1) {
        g.fillStyle = RC.off;
        if (g.beginPath && g.moveTo) { g.beginPath(); g.moveTo(x, 9); g.lineTo(x + 4, 13); g.lineTo(x, 17); g.lineTo(x - 4, 13); g.fill && g.fill(); }
        else g.fillRect(x - 3, 10, 6, 7);
      }
    }
    g.fillStyle = '#11161c';
    g.fillRect(0, 0, KEYW, RULER);
  }
  drawOv() {
    const g = this.ctx(this.ov);
    if (!g) return;
    const v = this.view(), { h } = this.size(), f = this.o.playhead, ph = typeof f === 'function' ? f() : -1;
    this.ph = ph;
    if (fin(ph) && ph >= 0) {
      const x = this.xOf(ph, v);
      if (x >= KEYW) { g.fillStyle = RC.play; g.fillRect(Math.round(x), 0, 2, h); }
    }
    const G = this.g;
    if (G && G.type === 'marquee' && G.moved) {
      g.strokeStyle = RC.marquee;
      const x = Math.min(G.x0, G.x1), y = Math.min(G.y0, G.y1);
      if (g.strokeRect) g.strokeRect(x + 0.5, y + 0.5, Math.abs(G.x1 - G.x0), Math.abs(G.y1 - G.y0));
    }
  }

  /* ---------------------------------------------------------------- edits */
  // the most records the clip / pattern may hold now and the notice when an edit would exceed it: 512 events per
  // pattern; 1024 notes per clip and the clip's share of the 4096-note bank (o.maxRecs, §2.4.2)
  maxRecs() {
    if (this.kind === 'pat') return { max: core.MAX_EV, text: 'At most ' + core.MAX_EV + ' events per pattern' };
    const f = this.o.maxRecs, m = typeof f === 'function' ? +f() : NaN, max = fin(m) ? clamp(Math.floor(m), 0, core.MAX_CLIP_NOTES) : core.MAX_CLIP_NOTES;
    return { max, text: max < core.MAX_CLIP_NOTES ? 'At most ' + core.MAX_BANK_NOTES + ' notes per clip bank' : 'At most ' + core.MAX_CLIP_NOTES + ' notes per clip' };
  }
  // one edit of the record list: res = {list, sel} (seq-core note / event operations); records outside the clip /
  // pattern are dropped; an edit that adds records beyond the limit (maxRecs) is refused with a notice
  commit(res, label, phase) {
    const c = this.clip();
    if (!c || !res) return false;
    let L = arr(res.list), sel = arr(res.sel);
    const lim = this.kind === 'pat' ? this.lenOf(c) : core.MAX_CLIP_LEN, M = this.maxRecs(), n0 = this.recs().length;
    if (L.length > M.max && L.length > n0) { this.notify(M.text); return false; }
    if (L.some(r => !(r[0] < lim))) {
      const keep = [], map = new Map();
      L.forEach((r, i) => { if (r[0] < lim) { map.set(i, keep.length); keep.push(r); } });
      sel = sel.map(i => map.get(i)).filter(i => i !== undefined);
      L = keep;
    }
    const F = this.F, out = L.map(r => r.slice());
    this.edit(o => { o[F] = out.map(r => r.slice()); }, { label, phase });
    this.setSel(sel, out);
    this.refresh();
    return true;
  }
  // a whole-clip operation result (Double Entire Clip, Scale Entire Clip)
  whole(res, label) {
    const c = this.clip(), F = this.F, M = this.maxRecs(), n = arr(res && res[F]).length;
    if (!res || (res.len === c.len && hashRecs(res[F]) === hashRecs(c[F]) && res.off === c.off)) return false;
    if (n > M.max && n > this.recs().length) { this.notify(M.text); return false; }
    this.edit(o => { o.len = res.len; o[F] = arr(res[F]).map(r => r.slice()); if (this.kind === 'clip' && fin(res.off)) o.off = res.off; }, { label });
    this.setSel([], this.recs());
    this.refresh();
    return true;
  }
  audOn(n, vel) {
    const A = this.o.audition;
    if (this.kind !== 'clip' || !this.listen || !A || typeof A.on !== 'function' || !Number.isInteger(n)) return;
    this.audOff();
    A.on(n, clamp((+vel || 100) / 127, 0, 1));
    this.aud = n;
  }
  audOff() {
    const A = this.o.audition;
    if (this.aud !== null && A && typeof A.off === 'function') A.off(this.aud);
    this.aud = null;
  }

  /* ---------------------------------------------------------------- pointer gestures */
  down(e) {
    if (this.dead) return;
    if (this.g) { if (e.pointerId !== this.g.id) this.abort(); return; }
    if (e.pointerType !== 'touch' && e.button !== 0) return;
    if (this.zp && this.zp.active()) return;
    this.lastType = e.pointerType || 'mouse';
    const c = this.clip();
    if (!c) return;
    if (this.el.focus && this.keysOn()) this.el.focus({ preventScroll: true });
    const rect = this.el.getBoundingClientRect(), p = { x: e.clientX - rect.left, y: e.clientY - rect.top }, v = this.view(), m = mods(e);
    let G = null;
    if (p.y < RULER) { if (p.x >= KEYW) G = this.rulerDown(p, v, c, e); }
    else if (p.x < KEYW) {
      const row = this.rowAt(p.y, v, false);
      if (row >= 0) { G = { type: 'key' }; const L = this.listen; this.listen = 1; this.audOn(v.rows[row], 100); this.listen = L; }
    } else G = this.noteDown(p, e.pointerType === 'touch' ? this.touchView(v) : v, m, c);
    if (!G) return;
    e.preventDefault();
    // the gesture keeps the geometry and the box of its start (view(), local())
    Object.assign(G, { id: e.pointerId, x0: p.x, y0: p.y, x1: p.x, y1: p.y, moved: false, started: false, touch: e.pointerType === 'touch', free: m.alt, v, rect });
    this.g = G;
    try { this.el.setPointerCapture(e.pointerId); } catch (err) { /* pointer gone */ }
    this.refresh();
  }
  // the length / start flags hang in the ruler's upper half, the offset marker in its lower half: when both are in
  // reach (the offset marker sits on the start flag by default) the half that was pressed decides
  rulerDown(p, v, c, e) {
    const tol = e.pointerType === 'touch' ? 14 : 7, t = v.t0 + (p.x - KEYW) / v.pps;
    const flags = this.kind === 'pat' ? [['len', this.lenOf(c)]] : [['start', c.start], ['len', c.len], ['off', c.off]];
    const near = flags.filter(([, val]) => fin(val) && Math.abs(this.xOf(val, v) - p.x) <= tol)
      .sort((a, b) => Math.abs(this.xOf(a[1], v) - p.x) - Math.abs(this.xOf(b[1], v) - p.x));
    if (near.length) {
      const lower = p.y >= RULER / 2, pick2 = near.find(([k]) => (k === 'off') === lower) || near[0];
      // what the flag may cut or clamp, as at the gesture start: each step works from it, abort() puts it back
      const flag0 = this.kind === 'pat' ? { len: this.lenOf(c), ev: arr(c.ev).map(r => r.slice()), strum: arr(c.strum).map(r => r.slice()) }
        : { len: c.len, start: c.start, off: c.off };
      return { type: 'flag', which: pick2[0], flag0 };
    }
    const a = Math.max(0, this.snapR(t));
    return { type: 'range', a };
  }
  noteDown(p, v, m, c) {
    const recs = this.recs(), h = rollHit(recs, v, p.x - KEYW, p.y - RULER);
    let sel = this.selNow();
    if (h.i >= 0) {
      this.range = null;   // a note selection replaces a time range
      if (m.shift) sel = sel.includes(h.i) ? sel.filter(i => i !== h.i) : sel.concat([h.i]);
      else if (!sel.includes(h.i)) sel = [h.i];
      this.setSel(sel, recs);
      if (!sel.includes(h.i)) return { type: 'none' };
      const r = recs[h.i];
      this.lastLen = r[1];
      this.lastVel = r[3];
      this.audOn(r[2], r[3]);
      // a finger may land beside the note's row (touch zones): pitch counts from its row, the press offset yo kept off
      let row0 = h.row, yo = 0;
      if (v.rows[h.row] !== r[2]) { row0 = v.rows.indexOf(r[2]); const ry = this.yOf(row0, v); yo = p.y - clamp(p.y, ry, ry + v.rowH - 1); }
      // near: inside the note / on a selected note's near handle before this press selected it (a mouse: always) — a
      // double-tap's target (up, dbl)
      return { type: h.part === 'end' ? 'resize' : h.part === 'start' ? 'resizeStart' : 'move', orig: recs.map(q => q.slice()), sel: this.sel.slice(),
        hit: h.i, row0, yo, tp: h.t, hitNote: r[2], adn: 0, near: h.near !== false };
    }
    if (h.row < 0) return null;
    this.cursor = Math.max(0, this.snapF(h.t));
    void c;
    return { type: 'marquee', add: m.shift, base: m.shift ? sel.slice() : [] };
  }
  // a continuous edit of the gesture: fn mutates the clip; phases start → move … → end (at release)
  gEdit(G, fn, label) {
    G.fn = fn;
    G.label = label;
    this.edit(fn, { label, phase: G.started ? 'move' : 'start' });
    G.started = true;
  }
  gCommit(G, res, label) {
    const F = this.F, out = arr(res.list).map(r => r.slice()), c = this.clip(), lim = this.kind === 'pat' ? this.lenOf(c) : core.MAX_CLIP_LEN;
    const keep = [], map = new Map();
    out.forEach((r, i) => { if (r[0] < lim) { map.set(i, keep.length); keep.push(r); } });
    this.gEdit(G, o => { o[F] = keep.map(r => r.slice()); }, label);
    this.setSel(arr(res.sel).map(i => map.get(i)).filter(i => i !== undefined), keep);
  }
  move(e) {
    const G = this.g;
    if (!G || e.pointerId !== G.id) return;
    if (this.zp && this.zp.active()) { this.abort(); return; }
    const p = this.local(e);
    G.x1 = p.x; G.y1 = p.y;
    if (!G.moved) { if (Math.abs(p.x - G.x0) + Math.abs(p.y - G.y0) < (G.touch ? 8 : 3)) return; G.moved = true; }
    const v = G.v, t = v.t0 + (p.x - KEYW) / v.pps, stp = this.step(), free = G.free || mods(e).alt;
    const q = x => (free ? r5(x) : r5(Math.round(x / stp) * stp));
    const c = this.clip();
    if (!c) return;
    switch (G.type) {
      case 'move': {
        const dt = q(t - G.tp), rowNow = this.rowAt(p.y - (G.yo || 0), v, true), dn = this.lin(v.rows[rowNow]) - this.lin(v.rows[G.row0]);
        if (G.dt === dt && G.dn === dn) return;
        G.dt = dt; G.dn = dn;
        this.gCommit(G, this.ops.move(G.orig, G.sel, dt, dn), 'Move notes');
        if (G.adn !== dn) { G.adn = dn; this.audOn(clamp(G.hitNote + dn, 0, 127), this.lastVel); }
        break;
      }
      case 'resize': {
        // a finger may grab an end from well outside it (touch zones): the end follows the finger's travel, no jump
        const o = G.orig[G.hit];
        let end = q(G.touch ? o[0] + o[1] + t - G.tp : t);
        if (end <= o[0] + core.MIN_LEN16) end = o[0] + Math.min(free ? core.MIN_LEN16 : stp, Math.max(core.MIN_LEN16, o[1]));
        const dl = r5(end - (o[0] + o[1]));
        if (G.dl === dl) return;
        G.dl = dl;
        this.gCommit(G, this.ops.resize(G.orig, G.sel, dl), 'Resize notes');
        break;
      }
      case 'resizeStart': {
        const o = G.orig[G.hit], S = G.sel.map(i => G.orig[i]);
        const dt = r5(clamp(q(G.touch ? o[0] + t - G.tp : t) - o[0], -Math.min(...S.map(r => r[0])), Math.min(...S.map(r => r[1])) - core.MIN_LEN16));
        if (G.dt === dt) return;
        G.dt = dt;
        const r1 = this.ops.move(G.orig, G.sel, dt, 0);
        this.gCommit(G, this.ops.resize(r1.list, r1.sel, -dt), 'Resize notes');
        break;
      }
      case 'marquee': {
        const recs = this.recs();
        this.range = null;
        const ta = v.t0 + (Math.min(G.x0, p.x) - KEYW) / v.pps, tb = v.t0 + (Math.max(G.x0, p.x) - KEYW) / v.pps;
        const ra = this.rowAt(Math.max(G.y0, p.y), v, true), rb = this.rowAt(Math.min(G.y0, p.y), v, true);
        const found = this.ops.selectRange(recs, ta, tb, v.rows[Math.min(ra, rb)], v.rows[Math.max(ra, rb)]);
        this.setSel(G.base.concat(found), recs);
        break;
      }
      case 'range': {
        if (this.sel.length) this.setSel([], this.recs());   // a time range replaces a note selection
        const b = Math.max(0, q(t));
        this.range = b === G.a ? null : [Math.min(G.a, b), Math.max(G.a, b)];
        break;
      }
      case 'flag': this.flagMove(G, t, free); break;
      default: return;
    }
    this.refresh();
  }
  // a flag drag: every step from the values at the gesture start (G.flag0), so shortening and lengthening again
  // within one drag cuts nothing (pattern events / strums past the length, a clamped offset)
  flagMove(G, t, free) {
    const c = this.clip(), stp = Math.max(1, this.step()), F0 = G.flag0;
    if (G.which === 'len') {
      const lo = this.kind === 'pat' ? 1 : c.start + 1, hi = this.kind === 'pat' ? core.MAX_PAT_LEN : core.MAX_CLIP_LEN;
      const L = clamp(Math.round(free ? t : Math.round(t / stp) * stp), lo, hi);
      if (L === G.val) return;
      G.val = L;
      const pat = this.kind === 'pat';
      this.gEdit(G, o => {
        o.len = L;
        if (pat) { o.ev = F0.ev.filter(e => e[0] < L).map(e => e.slice()); o.strum = F0.strum.filter(e => e[0] < L).map(e => e.slice()); }
        else o.off = clamp(F0.off, o.start, L - 1);
      }, pat ? 'Pattern length' : 'Clip length');
    } else if (G.which === 'start') {
      const S = clamp(Math.round(free ? t : Math.round(t / stp) * stp), 0, c.len - 1);
      if (S === G.val) return;
      G.val = S;
      this.gEdit(G, o => { o.start = S; o.off = clamp(F0.off, S, o.len - 1); }, 'Clip start');
    } else {
      const oq = Math.max(1, core.GRID_LADDER[clamp(c.offQ | 0, 0, 6)].beats * 4);
      const O = clamp(Math.round(free ? t : Math.round(t / oq) * oq), c.start, c.len - 1);
      if (O === G.val) return;
      G.val = O;
      this.gEdit(G, o => { o.off = O; }, 'Clip offset');
    }
  }
  up(e) {
    const G = this.g;
    if (!G || e.pointerId !== G.id) return;
    const p = this.local(e);
    this.g = null;
    try { this.el.releasePointerCapture(G.id); } catch (err) { /* released */ }
    this.audOff();
    if (G.started && G.fn) this.edit(G.fn, { label: G.label, phase: 'end' });
    if (!G.moved) {
      // a double-tap counts on the same target both times (that note, or empty grid — a note's farther reach counts as
      // empty there, as in the main roll): two quick taps on neighbouring notes delete nothing
      const k = G.type === 'marquee' || G.near === false ? 'e' : G.hit != null ? 'n' + G.hit : G.type;
      const dbl = G.touch && this.tap && e.timeStamp - this.tap.t < 350 && Math.hypot(p.x - this.tap.x, p.y - this.tap.y) < 24 && this.tap.k === k;
      this.tap = G.touch && !dbl ? { t: e.timeStamp, x: p.x, y: p.y, k } : null;
      if (dbl && (G.type === 'marquee' || G.type === 'move' || G.type === 'resize' || G.type === 'resizeStart')) this.dbl(p, true, G);
      else if (G.type === 'marquee' && !G.add) this.setSel([], this.recs());
      else if (G.type === 'range') { this.range = null; this.cursor = G.a; }
    } else this.tap = null;
    consume();
    this.refresh();
    this.drawOv();
  }
  // a second finger (pinch), a cancelled pointer or a menu mid-gesture: the gesture's edit is reverted
  abort(e) {
    const G = this.g;
    if (!G || (e && e.pointerId !== undefined && e.pointerId !== G.id && e.type === 'pointercancel')) return;
    this.g = null;
    try { this.el.releasePointerCapture(G.id); } catch (err) { /* released */ }
    this.audOff();
    if (G.started) {
      if (G.orig) { const F = this.F, o0 = G.orig.map(r => r.slice()); this.edit(o => { o[F] = o0.map(r => r.slice()); }, { label: G.label, phase: 'end' }); this.setSel(G.sel, o0); }
      else if (G.flag0) {
        const F0 = G.flag0, pat = this.kind === 'pat';
        this.edit(o => {
          o.len = F0.len;
          if (pat) { o.ev = F0.ev.map(r => r.slice()); o.strum = F0.strum.map(r => r.slice()); } else { o.start = F0.start; o.off = F0.off; }
        }, { label: G.label, phase: 'end' });
      } else if (G.fn) this.edit(G.fn, { label: G.label, phase: 'end' });
    }
    this.refresh();
    this.drawOv();
  }
  // double-click / double-tap: delete the note under the pointer, or add one at the grid cell. touch (G: the second
  // tap's gesture): the note this tap pressed, if it was inside it / on its near handle before the tap (the first tap's
  // selection doesn't count) — past that, a note is added
  dbl(p, touch, G) {
    const c = this.clip();
    if (!c || p.y < RULER || p.x < KEYW) return false;
    const v0 = this.view(), v = touch ? this.touchView(v0) : v0, recs = this.recs(), h = rollHit(recs, v, p.x - KEYW, p.y - RULER);
    if (touch ? G && G.hit != null && G.near : h.i >= 0) return this.commit(this.ops.remove(recs, [touch ? G.hit : h.i]), 'Delete note', 'set');
    if (h.row < 0 || !fin(h.t)) return false;
    const t = Math.max(0, this.snapF(h.t));
    if (t >= (this.kind === 'pat' ? this.lenOf(c) : core.MAX_CLIP_LEN)) return false;
    const L = this.lastLen > 0 ? this.lastLen : this.step(), vel = clamp(Math.round(this.lastVel) || 100, 1, 127);
    const rec = this.kind === 'pat' ? [t, L, h.note, vel, 0] : [t, L, h.note, vel, 0, 0.5, 0.5, 0];
    this.newest = [t, h.note];
    return this.commit(this.ops.add(recs, [], rec), 'Add note', 'set');
  }
  onCtx(e) {
    e.preventDefault();
    e.stopPropagation();
    if (this.g) this.abort();
    const c = this.clip();
    if (!c || this.dead) return;
    const p = this.local(e), v = this.view();
    let items;
    if (p.y < RULER && this.kind === 'clip' && Math.abs(this.xOf(c.off, v) - p.x) <= 10) items = this.offItems();
    else {
      if (p.y >= RULER && p.x >= KEYW) {
        const recs = this.recs(), h = rollHit(recs, v, p.x - KEYW, p.y - RULER);
        if (h.i >= 0 && !this.selNow().includes(h.i)) this.setSel([h.i], recs);
        else if (h.i < 0 && fin(h.t)) this.cursor = Math.max(0, this.snapF(h.t));
        this.refresh();
      }
      items = this.menuItems();
    }
    wk.contextMenu(e.clientX, e.clientY, items, { anchor: this.el });
  }
  offItems() {
    const c = this.clip();
    return [
      { label: 'Wrap Clip to Begin Here', disabled: !(c && c.off > c.start), action: () => this.command('wrapHere') },
      { label: 'Quantize', sub: core.GRID_LADDER.map((e, i) => ({ label: e.label, checked: c && c.offQ === i, action: () => this.edit(o => { o.offQ = i; }, { label: 'Offset quantize' }) })) },
    ];
  }
  // every action (the long-press / context menu and the page's ⋯ button)
  menuItems() {
    const M = isMac() ? '⌘' : 'Ctrl+', pat = this.kind === 'pat', has = this.selNow().length > 0 || !!this.range, any = this.recs().length > 0;
    const c = this.clip(), cb = !!NOTE_CB[this.kind];
    const it = (label, name, arg, dis) => ({ label, disabled: !!dis, action: () => this.command(name, arg) });
    const items = [
      it('Cut (' + M + 'X)', 'cut', undefined, !has), it('Copy (' + M + 'C)', 'copy', undefined, !has), it('Paste (' + M + 'V)', 'paste', undefined, !cb),
      it('Duplicate (' + M + 'D)', 'duplicate', undefined, !has), it('Delete (⌫)', 'delete', undefined, !has),
      { sep: true },
      it('Select All (' + M + 'A)', 'selectAll', undefined, !any), it('Select None', 'selectNone', undefined, !has),
      { sep: true },
      it('Chop (' + M + 'U)', 'chop', undefined, !any),
    ];
    if (!pat) items.push(it('Conform to Scale (' + M + 'K)', 'conform', undefined, !any || this.keyNow() < 0));
    items.push(it('Legato (' + M + 'L)', 'legato', undefined, !any), pat ? it('Accent (0)', 'accent', undefined, !any) : it('Mute (0)', 'mute', undefined, !any),
      { label: 'Quantize (Q)', disabled: !any, sub: [1, 0.75, 0.5, 0.25].map(s => ({ label: Math.round(s * 100) + '%', action: () => this.command('quantize', s) })) },
      it('Reverse (' + M + 'R)', 'reverse', undefined, !any), it('Scale Time 50% (/)', 'scaleTime', 0.5, !any), it('Scale Time 200% (*)', 'scaleTime', 2, !any),
      { sep: true },
      it((pat ? 'Double Pattern' : 'Double Entire Clip') + ' (' + M + 'E)', 'double'), it((pat ? 'Scale Pattern' : 'Scale Entire Clip') + ' 50%', 'scaleClip', 0.5),
      it((pat ? 'Scale Pattern' : 'Scale Entire Clip') + ' 200%', 'scaleClip', 2),
      { sep: true },
      { label: 'Grid', sub: core.GRID_LADDER.map((e, i) => ({ label: e.label, checked: this.gridIdx() === i, action: () => this.command('grid', i) })) });
    if (!pat) {
      items.push({ label: 'Fold', sub: ['Off', 'Used Notes', 'Scale + Used Notes'].map((l, i) => ({ label: l, checked: this.foldMode === i, action: () => this.command('fold', i) })) });
      if (this.o.audition) items.push({ label: 'Note Preview', checked: !!this.listen, action: () => this.command('audition', this.listen ? 0 : 1) });
    }
    items.push({ label: 'Zoom', sub: [['Zoom In', 2], ['Zoom Out', 0.5], ['Reset Zoom', 0]].map(([l, f]) => ({ label: l, action: () => { const z = this.zoomXY(); this.command('zoom', f ? [z[0] * f, z[1]] : [1, 1]); } })) });
    if (!pat && c) items.push({ sep: true }, ...this.offItems());
    return items;
  }
  // the roll's keys (§13.8) while it has the focus, unless the Keyboard shortcuts preference is off (o.keys). Quantize
  // is Q: ⌘Q never reaches a page on macOS (the browser quits first), ⌘/Ctrl+Q still works where it does
  keysOn() { const f = this.o.keys; return typeof f !== 'function' || !!f(); }
  key(e) {
    if (this.dead || e.defaultPrevented || (e.target && e.target !== this.el) || !this.keysOn()) return;
    const k = e.key, mk2 = modKey(e), sh = e.shiftKey, low = String(k).toLowerCase();
    let cmd = null, arg;
    if (k === 'ArrowUp') cmd = sh ? 'octUp' : 'up';
    else if (k === 'ArrowDown') cmd = sh ? 'octDown' : 'down';
    else if (k === 'ArrowLeft') cmd = sh ? 'shorter' : 'left';
    else if (k === 'ArrowRight') cmd = sh ? 'longer' : 'right';
    else if (k === 'Backspace' || k === 'Delete') cmd = 'delete';
    else if (k === 'Escape') { if (!this.selNow().length && !this.range) return; cmd = 'selectNone'; }
    else if (k === '/' && !mk2) { cmd = 'scaleTime'; arg = 0.5; }
    else if (k === '*' && !mk2) { cmd = 'scaleTime'; arg = 2; }
    else if (k === '0' && !mk2) cmd = this.kind === 'pat' ? 'accent' : 'mute';
    else if (low === 'q' && !mk2 && !e.ctrlKey && !e.metaKey && !e.altKey) cmd = 'quantize';
    else if (mk2 && !e.altKey) cmd = { x: 'cut', c: 'copy', v: 'paste', d: 'duplicate', u: 'chop', k: 'conform', l: 'legato', q: 'quantize', r: 'reverse', e: 'double', a: 'selectAll' }[low] || null;
    if (!cmd) return;
    e.preventDefault();
    e.stopPropagation();
    this.command(cmd, arg);
  }

  /* ---------------------------------------------------------------- commands */
  command(name, arg) {
    if (this.dead) return false;
    if (VIEW_CMDS.has(name)) return this.viewCmd(name, arg);
    const c = this.clip();
    if (!c) return false;
    const f = this['c_' + name];
    if (typeof f !== 'function') return false;
    const ok = !!f.call(this, arg, c, this.recs(), this.selNow());
    this.refresh();
    return ok;
  }
  viewCmd(name, arg) {
    if (name === 'fold') {
      if (arg !== 0 && arg !== 1 && arg !== 2) return false;
      if (this.kind === 'pat') return false;
      this.foldMode = arg;
      this.top = null;
    } else if (name === 'grid') {
      if (!Number.isInteger(arg) || arg < 0 || arg > 6) return false;
      if (typeof this.o.setGrid === 'function') this.o.setGrid(arg); else this.grid = arg;
    } else if (name === 'zoom') {
      const z = arr(arg);
      if (!fin(z[0]) || !fin(z[1])) return false;
      this.ztmp = null;
      if (typeof this.o.setZoom === 'function') this.o.setZoom([clamp(z[0], ZOOM_MIN, ZOOM_MAX), clamp(z[1], ZOOM_MIN, ZOOM_MAX)]);
    } else this.listen = arg ? 1 : 0;
    this.refresh();
    return true;
  }
  all(recs, sel) { return sel.length ? sel : recs.map((_, i) => i); }
  c_up(a, c, L, S) { return S.length ? this.commit(this.ops.move(L, S, 0, 1), 'Transpose', 'set') : false; }
  c_down(a, c, L, S) { return S.length ? this.commit(this.ops.move(L, S, 0, -1), 'Transpose', 'set') : false; }
  c_octUp(a, c, L, S) { return S.length ? this.commit(this.ops.move(L, S, 0, 12), 'Transpose', 'set') : false; }
  c_octDown(a, c, L, S) { return S.length ? this.commit(this.ops.move(L, S, 0, -12), 'Transpose', 'set') : false; }
  c_left(a, c, L, S) { return S.length ? this.commit(this.ops.move(L, S, -this.step(), 0), 'Move notes', 'set') : false; }
  c_right(a, c, L, S) { return S.length ? this.commit(this.ops.move(L, S, this.step(), 0), 'Move notes', 'set') : false; }
  c_shorter(a, c, L, S) { return S.length ? this.commit(this.ops.resize(L, S, -this.step()), 'Resize notes', 'set') : false; }
  c_longer(a, c, L, S) { return S.length ? this.commit(this.ops.resize(L, S, this.step()), 'Resize notes', 'set') : false; }
  c_selectAll(a, c, L) { if (!L.length) return false; this.setSel(L.map((_, i) => i), L); this.range = null; return true; }
  c_selectNone(a, c, L, S) { const had = S.length > 0 || !!this.range; this.setSel([], L); this.range = null; return had; }
  c_copy(a, c, L, S) {
    if (this.range) { const cb = this.ops.timeCopy(L, this.range); NOTE_CB[this.kind] = { mode: 'range', len: cb.len, list: cb.list }; return true; }
    if (!S.length) return false;
    const R = S.map(i => L[i]), t0 = Math.min(...R.map(r => r[0])), t1 = Math.max(...R.map(r => r[0] + r[1]));
    NOTE_CB[this.kind] = { mode: 'notes', len: r5(t1 - t0), list: R.map(r => { const q = r.slice(); q[0] = r5(q[0] - t0); return q; }) };
    this.cursor = r5(t1);
    return true;
  }
  // the time range first (as copy / duplicate: cut = copy + delete of the same thing), else the selected notes
  c_delete(a, c, L, S) {
    if (this.range) return this.commit(this.ops.timePaste(L, { len: r5(this.range[1] - this.range[0]), list: [] }, this.range[0]), 'Delete notes', 'set');
    if (S.length) return this.commit(this.ops.remove(L, S), 'Delete notes', 'set');
    return false;
  }
  c_cut(a, c, L, S) { return this.c_copy(a, c, L, S) && this.c_delete(a, c, L, S); }
  c_paste(a, c, L) {
    const cb = NOTE_CB[this.kind];
    if (!cb || !cb.list || (!cb.list.length && cb.mode !== 'range')) return false;
    const at = this.range ? this.range[0] : this.cursor;
    if (cb.mode === 'range') {
      this.range = [at, r5(at + cb.len)];
      return this.commit(this.ops.timePaste(L, cb, at), 'Paste', 'set');
    }
    const n0 = L.length, all = L.concat(cb.list.map(r => { const q = r.slice(); q[0] = r5(q[0] + at); return q; }));
    this.cursor = r5(at + cb.len);
    return this.commit(this.ops.move(all, all.map((_, i) => i).slice(n0), 0, 0), 'Paste', 'set');
  }
  c_duplicate(a, c, L, S) {
    if (this.range) {
      const [t0, t1] = this.range, cb = this.ops.timeCopy(L, this.range);
      this.range = [t1, r5(t1 + (t1 - t0))];
      return this.commit(this.ops.timePaste(L, cb, t1), 'Duplicate', 'set');
    }
    return S.length ? this.commit(this.ops.duplicate(L, S), 'Duplicate', 'set') : false;
  }
  c_chop(a, c, L, S) { return L.length ? this.commit(this.ops.chop(L, this.all(L, S), this.step()), 'Chop', 'set') : false; }
  c_conform(a, c, L, S) {
    if (this.kind !== 'clip' || !L.length || typeof this.ops.conformToScale !== 'function') return false;
    const key = this.keyNow(), sc = this.scaleNow();
    if (key < 0) { this.notify('Set a KEY to conform to'); return false; }
    return this.commit(this.ops.conformToScale(L, this.all(L, S), key, Number.isInteger(sc) ? sc : 0), 'Conform to Scale', 'set');
  }
  c_legato(a, c, L, S) { return L.length ? this.commit(this.ops.legato(L, this.all(L, S)), 'Legato', 'set') : false; }
  c_mute(a, c, L, S) { return this.kind === 'clip' && L.length ? this.commit(this.ops.mute(L, this.all(L, S)), 'Mute', 'set') : false; }
  c_accent(a, c, L, S) { return this.kind === 'pat' && L.length ? this.commit(this.ops.accent(L, this.all(L, S)), 'Accent', 'set') : false; }
  c_quantize(a, c, L, S) { return L.length ? this.commit(this.ops.quantize(L, this.all(L, S), this.step(), fin(a) ? clamp(a, 0, 1) : 1), 'Quantize', 'set') : false; }
  c_reverse(a, c, L, S) { return L.length ? this.commit(this.ops.reverse(L, this.all(L, S)), 'Reverse', 'set') : false; }
  c_scaleTime(a, c, L, S) { return (a === 0.5 || a === 2) && L.length ? this.commit(this.ops.scaleTime(L, this.all(L, S), a), 'Scale Time', 'set') : false; }
  wholeObj(c) {
    return this.kind === 'pat' ? { len: this.lenOf(c), ev: this.recs().map(r => r.slice()) }
      : { start: this.startOf(c), len: this.lenOf(c), off: fin(c.off) ? c.off : 0, notes: this.recs().map(r => r.slice()) };
  }
  c_double(a, c) { return this.whole(this.ops.doubleClip(this.wholeObj(c)), this.kind === 'pat' ? 'Double Pattern' : 'Double Entire Clip'); }
  c_scaleClip(a, c) { return a === 0.5 || a === 2 ? this.whole(this.ops.scaleClip(this.wholeObj(c), a), this.kind === 'pat' ? 'Scale Pattern' : 'Scale Entire Clip') : false; }
  c_wrapHere(a, c) {
    if (this.kind !== 'clip' || !(c.off > c.start && c.off < c.len)) return false;
    this.edit(o => { o.notes = core.wrapAt(o.notes, o.start, o.off, o.len); o.off = o.start; }, { label: 'Wrap Clip to Begin Here' });
    this.setSel([], this.recs());
    return true;
  }

  /* ---------------------------------------------------------------- pinch / two-finger pan (wk.zoomPan) */
  zpView() {
    const c = this.clip(), v = this.view(), CT = this.contentT(c), CH = v.rows.length * v.rowH;
    return { x0: clamp01(v.t0 / CT), x1: clamp01((v.t0 + v.w / v.pps) / CT), y0: CH > 0 ? clamp01(v.top / CH) : 0, y1: CH > 0 ? clamp01((v.top + v.h) / CH) : 1 };
  }
  zpSet(view, ph) {
    const c = this.clip(), v = this.view(), CT = this.contentT(c), n = v.rows.length;
    const spanT = Math.max(1e-6, (view.x1 - view.x0) * CT), spanY = Math.max(1e-6, view.y1 - view.y0);
    const zx = clamp(v.w / (spanT * ROLL_PPS), ZOOM_MIN, ZOOM_MAX), zy = clamp(v.h / (spanY * n * ROLL_ROWH), ZOOM_MIN, ZOOM_MAX);
    this.t0 = Math.max(0, view.x0 * CT);
    this.top = view.y0 * n * ROLL_ROWH * zy;
    if (ph === 'start' || ph === 'move') this.ztmp = [zx, zy];
    else { this.ztmp = null; if (typeof this.o.setZoom === 'function') this.o.setZoom([zx, zy]); }
    this.refresh();
  }
  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.audOff();
    for (const f of this.offs.splice(0)) { try { f(); } catch (err) { /* already gone */ } }
    this.el.remove();
  }
}
