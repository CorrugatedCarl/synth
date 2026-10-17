// sx-ui-osc.js — the oscillator-area panels of the Serum-style instrument (SPEC-serum2 §11.14, §13.3): OSC A / B / C
// (module shell: type menu, routing popover, module menu, label drag; one view per oscillator type — Wavetable,
// Multisample, Sample, Granular, Spectral — plus the controls every type shares: pitch row with the pitch modes, unison
// row with its gear popover, WARP 1 / WARP 2 slots, PAN / LEVEL), SUB, NOISE and FILTER 1 / FILTER 2, plus the data they
// share: the table / sample caches, the source menus, file imports, LFO → wavetable / noise, Wavetable to LFO Shape and
// Render OSC Warp v2 (§13.3.1).
// Extracted from serum-ui.js in M1a by U1; owned by U2 from M1b; M2 = the full panels of §13.3.
//
// The panels never see the SerumUI or the main.js host's edit path: they receive the binding kit (serum-ui makeKit,
// §11.14) — destination widgets (kit.knob / menu / toggle / num) with halos, drag-to-modulate drops, knob menus, MIDI
// learn and locks; state edits through kit.edit (undo, dirty state, repaint); the panel shell, canvases, repaint and
// popover hooks of the kit's M1a members. The wavetable helpers of wt.js arrive as kit.wt (§0.2 gives this module no
// wt import); the WT editor overlay stays serum-ui's (kit.openWtEditor); sample data arrives through kit.host.smp.
// Every widget is built while serum-ui builds the page (so it registers on that page): popover contents are built with
// their panel and moved into kit.popover when it opens.
//
// Panels (the shell of kit.panel brings power, the module menu — Lock / Init / Copy / Copy (w/mods) / Paste — and the
// label drags; each panel passes its own module-menu items as kit.panel's o.items, exposed as menuItems())
//   new OscPanel(root, kit, o)     OSC A / B / C (o = 0 / 1 / 2): head = power, name, type menu, the shown view's source
//                                  controls, routing button; body = the type views (VIEWS order; the view of
//                                  core.oscTypeOf(s, o) is shown) and the shared rows (pitch, unison, WARP 1, WARP 2,
//                                  PAN / LEVEL). Members: el, o, shell, views {wt, multi, sample, gran, spec}, view(),
//                                  menuItems()
//   new SubPanel(root, kit)        SUB
//   new NoisePanel(root, kit)      NOISE
//   new FilterPanel(root, kit, k)  FILTER 1 (k = 0: f.*, filter[0]) / FILTER 2 (k = 1: f2.*, filter[1])
// Oscillator type views (§13.3): new XView(root, kit, o) appends `el` (a div.sx-pbody, data-otype = type) to root and
// exposes `head` (elements for the panel's title row: the source menu and its buttons; OscPanel appends them there)
//   WTView      'wt'      Wavetable    display (2D warp preview of both slots / 3D), WT POS (✓ Smooth Interpolation),
//                                      PHASE (phase memory, ✓ Phase Legato, New MemTrig phase set), RAND, MEM menu
//   MultiView   'multi'   Multisample  zone map (zoneMapLayout, the recent / last-played zone lit; tap = its waveform),
//                                      envelope popover, VEL TRACK, RAND, TIMBRE; "Missing sample" badge + relink (§9.9)
//   SampleView  'sample'  Sample       waveform (markerLayout: S / E, LS / LE, X-fade, slices, playhead; zoom / pan;
//                                      snapping; slicing), loop menu, LS / LE, SCAN | RATE (Length to BPM); "Missing
//                                      sample" badge + relink. Markers, slices and k.pos are processed-sample fractions
//                                      (smpCoords): snapping, Auto slices, clips, Trim and the displays read the stored
//                                      record through ops.trim / ops.rev; Auto marks follow every sample / ops / threshold
//                                      edit in the same step (OscData.sampleEdit)
//   GranView    'gran'    Granular     the Sample view + window popover, DENS, LENGTH, grain randomisation, X|Y Manual
//   SpecView    'spec'    Spectral     spectrogram (S / E, Hi / Lo handles), SCAN | RATE | X, CUT, FILTER (curve or a
//                                      wavetable), MIX
//   view members: static type, el, head, o, type, kit, active() (osc o has this type), show(on), key() (display key;
//   'off' when inactive), menuItems() (type-specific items of the panel's ⋯ menu)
// Data and pure helpers
//   oscData(kit)                   the table / noise / sample data shared by the panels of one kit (serum-ui uses it for
//                                  the format context, the main menu, drops on the displays and the LFO menu: tinfo,
//                                  forget, lfoToWavetable, lfoToNoise, lfoShape, renderOscWarp, canRenderWarp)
//   layers3d(F, R, max)            layers of the 3D wavetable view
//   markerLayout(m, view, w)       sample-display markers (S / E, loop band, X-fade, slices, playhead) in pixels
//   zoneMapLayout(zones, w, h, hot)   multisample zone rectangles (x = key, y = velocity; round-robin lanes)
//   sliceAt(marks, u, tol)         the slice holding sample fraction u (and the slice mark within tol of u)
//   xyToN(px, py, r, view)         pointer position in a display box → {x, y} ∈ [0,1] (x through the zoom view)
//   warpMenuItems(s, o)            WARP slot menu items of oscillator o (WARPS2, grouped, spectral modes greyed)
//   filterLit(s, k)                which routing switches S A B C N of filter k are lit (source reaches the filter)
//   autoSlices(odf, thr, rate, len, hop)   Auto slicing marks from an onset function (§9.4.5 rule = smp.slicesFromOdf)
//   smpCoords(ops)                 processed-sample fractions (markers, slices, k.pos) ↔ fractions of the stored record
//   specRect(w, h, lo, hi, rate, H)   spectrogram image rectangles on the panel's 20 Hz … 20 kHz axis
//   (view = { a, b }: the visible range of the sample, fractions, a < b; absent = the whole sample)
//
// Contract with serum-ui's drop layer: every oscillator display carries data-oscdisp="<o>" (Alt-drag of an LFO tile →
// LFO to wavetable, which also makes the oscillator a wavetable one), the NOISE panel data-noisepanel (LFO tile → LFO
// to noise), every destination widget data-dest; the granular / spectral X|Y dot carries data-xy, data-dest-x and
// data-dest-y (Modulate X / Modulate Y) with data-dest = its X destination.
// Per-control menus (SEM pitch modes, WT POS, PHASE, CUTOFF, DRIVE, SCAN, DENS, LENGTH, DIR, the warp menus, sub PHASE):
// right-click / long-press shows the control's own items first, then "Modulation, MIDI, Lock…" opens the kit's
// standard knob menu for that control.
// WARP 1 / WARP 2 (§13.3): the opened mode list also holds the slot's FM types (Thru-Zero / Exp / Linear as radio items
// in the FM category) and Swap Warps; ◀ ▶ and the wheel step through the modes only. The same items are the slot's
// right-click / long-press items, and the FM type is also a TZ / EXP / LIN switch next to an FM slot.
// Display options of the sample views (Show Marker Animation, Zoom to Start and End, Snap, Show Waveform Display) are
// view edits (smpo UI fields, §2.2.3): no undo step.
//
// Browser ES module: nothing touches document / window / storage at module top level (node imports it for tests).
import * as core from './serum-core.js?v=10';
import * as wk from './wk.js?v=10';
import * as gx from './graph.js?v=10';

/* ================================================================ constants and small helpers */

const { DESTS, DEST_INDEX, FILTERS, WARPS, SUB_SHAPES } = core;
const list = k => (Array.isArray(core[k]) ? core[k] : []);
const WARPS2 = list('WARPS2'), SUB_SHAPES2 = list('SUB_SHAPES2'), OSC_TYPES = list('OSC_TYPES'), PITCH_MODES = list('PITCH_MODES');
const PHASE_MEM = list('PHASE_MEM'), UNI_MODES = list('UNI_MODES'), UNI_SPAWN = list('UNI_SPAWN'), GRAIN_WINDOWS = list('GRAIN_WINDOWS');
const LOOP_MODES = list('LOOP_MODES'), SCAN_RANGES = list('SCAN_RANGES'), FADE_MS = list('FADE_MS'), SLICE_MODES = list('SLICE_MODES');
const DENS_MODES = list('DENS_MODES'), GLEN_MODES = list('GLEN_MODES'), XY_Y_GRAN = list('XY_Y_GRAN'), XY_Y_SPEC = list('XY_Y_SPEC');
const XY_MODES = list('XY_MODES'), COLOR_NOISES = list('COLOR_NOISES'), FILTER_CATS = list('FILTER_CATS'), LEN_LADDER = list('LEN_LADDER');
const C = { line: '#2a333d', mute: '#7f8b98', on: '#6fe3a1', graph: '#59c2ff', cur: '#ffd84a', ink: '#dfe6ee', loop: '#4fb3ff',
  slice: '#f7c948', mark: '#ffffff', xy: '#ff5b5b', bg: '#0a0d10' };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const clamp01 = x => (x > 0 ? (x < 1 ? x : 1) : 0);
const fin = x => typeof x === 'number' && isFinite(x);
const r5 = x => Math.round(x * 1e5) / 1e5 + 0;   // marks / trim values as normalizeSerum and serum-core store them
const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const arr = x => (Array.isArray(x) ? x : []);
const frac = x => x - Math.floor(x);
const destOf = id => { const i = DEST_INDEX[id]; return i === undefined ? null : DESTS[i]; };
const gridOf = d => (!d ? 0 : d.law === 'int' ? d.hi - d.lo : d.law === 'enum' ? d.hi : d.law === 'bool' ? 1 : 0);
const nameOfId = id => String(id || '').replace(/^[a-z]+:/, '') || '—';
const dsp = () => globalThis.SerumDSP || null;
const sxw = () => globalThis.SxWarp || null;
const sxf = () => globalThis.SxFilt2 || null;
const s1Of = s => !!(s && s.global && s.global.s1);
const smpType = t => t === 'sample' || t === 'gran' || t === 'spec';
const isWtId = id => /^(factory|user):/.test(id || '');
const isUserAsset = id => /^(smp|msmp):/.test(id || '');
const clone = x => JSON.parse(JSON.stringify(x));
const NOISE_OV = new Map();   // factory noise id → min/max overview (Float32Array(512)), shared by every panel set
const MISS_MS = 3000;         // a missing record / onset function is asked again after this (retried generation, relink)
const PCM_IDLE_MS = 30000;    // the snapping PCM is released this long after the last snapping gesture
const TOUCH_SLOP = 8;         // px a finger may wander before a press becomes a drag (wk's touch slop)
const warnOnce = (() => { const seen = new Set(); return (k, ...a) => { if (!seen.has(k)) { seen.add(k); console.warn(...a); } }; })();
// items of an enum destination menu: v = k / hi (as normalizeSerum stores it)
const enumItems = (id, labels, groups) => { const hi = gridOf(destOf(id)); return labels.map((label, k) => ({ v: k / hi, label, group: groups ? groups[k] : undefined })); };
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = n => NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);   // app naming: C4 = MIDI 60
// a wavetable played as a sample (§9.4.8): one frame = one cycle of the root at 48 kHz
const WT_ROOT = 69 + 12 * Math.log2(48000 / (2048 * 440));
const LOOP_SHORT = ['ONE-SHOT', 'FWD', 'REV', 'FWD/RWD', 'TAILED'];
const IMPORT_LABELS = { auto: 'Auto', clm: 'Auto (clm chunk)', zeroSnap: 'Constant Framesize (Zero Snap)', pitchFollow: 'Dynamic Pitch Follow',
  pitchAvg: 'Constant Pitch Average', manual: 'Manual Split Size', fft256: 'FFT 256 (Vocode)', fft512: 'FFT 512 (Vocode)',
  fft1024: 'FFT 1024 (Vocode)', fft2048: 'FFT 2048 (Vocode)' };
const AUDIO_ACCEPT = '.wav,.wave,.aif,.aiff,.aifc,.flac,.mp3,.ogg,.m4a,.aac,.zip,audio/*';
// menu items gathered by group: groups in the order of `order` (then of first appearance), stable inside a group
// (the rule of serum-ui's groupItems)
function groupItems(items, order) {
  const rank = new Map();
  for (const g of arr(order)) if (!rank.has(g)) rank.set(g, rank.size);
  for (const it of arr(items)) { const g = it.group === undefined ? '' : it.group; if (!rank.has(g)) rank.set(g, rank.size); }
  const key = it => rank.get(it.group === undefined ? '' : it.group);
  return arr(items).map((it, i) => [it, i]).sort((a, b) => key(a[0]) - key(b[0]) || a[1] - b[1]).map(x => x[0]);
}
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// a fresh MemTrig / Per Voice phase set (16 phases, 6 decimals)
function memTrigSet(seed) {
  const r = mulberry32(seed | 0);
  return Array.from({ length: 16 }, () => Math.round(r() * 1e6) / 1e6 % 1);
}

// oscillator o (0–2) → destination prefix, panel title, module, colour
const OSC_P = ['a', 'b', 'c'], OSC_T = ['OSC A', 'OSC B', 'OSC C'], OSC_M = ['oscA', 'oscB', 'oscC'];
const OSC_COL = ['#4fb3ff', '#6fe3a1', '#f7c948'];
const oscIdx = o => (o === 2 ? 2 : o ? 1 : 0);
const others = o => [0, 1, 2].filter(j => j !== o);

/* ---------------------------------------------------------------- DOM helpers */

const SVGNS = 'http://www.w3.org/2000/svg';
function mk(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}
function svgEl(doc, tag, a) {
  const e = doc.createElementNS(SVGNS, tag);
  for (const k in a) e.setAttribute(k, a[k]);
  return e;
}
const ICONS = {
  edit: ['M10.5 2.5l3 3-8 8H2.5v-3z', 'M9 4l3 3'],
  zoom: ['M7 2.5a4.5 4.5 0 1 1 0 9a4.5 4.5 0 1 1 0-9', 'M10.5 10.5L14 14'],
  trash: ['M2.5 4.5h11', 'M6 4.5V2.5h4v2', 'M4 4.5l.8 9h6.4l.8-9', 'M6.8 7v4', 'M9.2 7v4'],
  folder: ['M2 4.5h4l1.5 1.5H14v6.5H2z'],
  more: ['M3.5 8h.01', 'M8 8h.01', 'M12.5 8h.01'],
  gear: ['M8 5.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5', 'M8 1.5v2', 'M8 12.5v2', 'M1.5 8h2', 'M12.5 8h2', 'M3.4 3.4l1.4 1.4', 'M11.2 11.2l1.4 1.4', 'M3.4 12.6l1.4-1.4', 'M11.2 4.8l1.4-1.4'],
  env: ['M1.5 13.5L5 3l3 5h3l3.5 5.5'],
};
function icon(doc, name) {
  const s = svgEl(doc, 'svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' });
  for (const d of ICONS[name] || []) s.appendChild(svgEl(doc, 'path', { d }));
  return s;
}
function btn(doc, cls, label, title, onClick) {
  const b = mk(doc, 'button', cls);
  b.type = 'button';
  if (typeof label === 'string') b.textContent = label; else if (label) b.appendChild(label);
  if (title) { b.setAttribute('aria-label', title); b.title = title; }
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
const row = (doc, ...els) => { const r = mk(doc, 'div', 'sx-krow'); r.append(...els.filter(Boolean)); return r; };
const hide = (el, on) => { if (el && el.classList) el.classList.toggle('sx-hidden', !!on); };
// window.confirm must be called as a method (a detached call throws "Illegal invocation" in browsers)
function askConfirm(doc, msg) {
  const w = (doc && doc.defaultView) || globalThis;
  try { return typeof w.confirm === 'function' ? !!w.confirm(msg) : true; } catch (err) { return true; }
}
// file drops on a display
function fileDrop(el, fn) {
  const has = e => !!(e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0);
  el.addEventListener('dragover', e => { if (has(e)) { e.preventDefault(); el.classList.add('sx-dropok'); } });
  el.addEventListener('dragleave', () => el.classList.remove('sx-dropok'));
  el.addEventListener('drop', e => {
    el.classList.remove('sx-dropok');
    const fl = e.dataTransfer && e.dataTransfer.files;
    if (!fl || !fl.length) return;
    e.preventDefault();
    fn(Array.prototype.slice.call(fl));
  });
}
// a file picker for several files (SFZ with its samples, ZIPs, audio) → Promise<File[]> (empty when cancelled)
function pickFiles(doc, accept, multiple) {
  return new Promise(res => {
    try {
      const inp = doc.createElement('input');
      inp.type = 'file';
      if (accept) inp.accept = accept;
      if (multiple) inp.multiple = true;
      inp.style.display = 'none';
      const done = fl => { inp.remove(); res(fl ? Array.prototype.slice.call(fl) : []); };
      inp.addEventListener('change', () => done(inp.files));
      inp.addEventListener('cancel', () => done(null));
      (doc.body || doc.documentElement).appendChild(inp);
      inp.click();
    } catch (err) { res([]); }
  });
}
const modsOf = e => (wk.modifierBar && typeof wk.modifierBar.mods === 'function' ? wk.modifierBar.mods(e)
  : { fine: !!(e && e.shiftKey), alt: !!(e && e.altKey), shift: !!(e && e.shiftKey) });
const consumeMods = () => { if (wk.modifierBar && typeof wk.modifierBar.consume === 'function') wk.modifierBar.consume(); };
// a mouse move without a pressed button: the drag's pointerup was missed (lost capture, the element was hidden)
const noButton = e => e.pointerType === 'mouse' && typeof e.buttons === 'number' && e.buttons === 0;
// gesture.js's synthetic pointercancel: a second finger made this touch a pan / pinch — the drag is rolled back
const twoF = e => !!e && e.gesture === 'two-finger';
// a two-finger rollback: each destination id of v0 ({ id: n at the press }) back to its value ('move' + 'end' = one
// undo step at most; an id the gesture never changed and holds no drag of is left alone)
function putBack(K, v0) {
  const ids = Object.keys(v0).filter(id => K.getN(id) !== v0[id] || K.dragging(id));
  for (const id of ids) K.setN(id, v0[id], 'move');
  for (const id of ids) K.setN(id, v0[id], 'end');
}

// plain (non-destination) widgets, repainted with the panel
const pToggle = (kit, o) => kit.bind(wk.toggle(Object.assign({ kind: 'led' }, o)));
const pMenu = (kit, o) => kit.bind(wk.menu(Object.assign({ arrows: false }, o)));
const pSeg = (kit, o) => kit.bind(wk.seg(o));
const pNum = (kit, o) => kit.bind(wk.numBox(o));
const uiEdit = (kit, fn) => kit.edit(fn, { label: 'View', ui: true });
const fmtN = (kit, id, n) => core.fmtParam(id, n, { s: kit.s(), fx: kit.fx() });
// a destination slider (Var faders, filter LEVEL): data-dest makes it a drop target / knob-menu host, halos via setMod
function dSlider(kit, id, o) {
  const d = destOf(id);
  return kit.bind(wk.slider(Object.assign({ dest: id, get: () => kit.getN(id), set: (n, ph) => kit.setN(id, n, ph), def: d ? d.def : 0,
    fmt: n => fmtN(kit, id, n), parse: t => core.parseParam(id, t, { s: kit.s(), fx: kit.fx() }), steps: gridOf(d), bipolar: !!(d && d.ctr) }, o)));
}
// Per-control menu (§13.3 "SEM (right-click …)", "CUTOFF (menu ✓ Key Track)" …): a contextmenu on el shows items() first
// and a last entry that re-opens the event for the kit's standard knob menu (modulation, MIDI learn, locks).
function extraMenu(el, items) {
  let pass = false;
  el.addEventListener('contextmenu', e => {
    if (pass) return;
    const L = items();
    if (!L || !L.length) return;
    e.preventDefault();
    e.stopPropagation();
    const x = e.clientX, y = e.clientY;
    wk.contextMenu(x, y, L.concat([{ sep: true }, { label: 'Modulation, MIDI, Lock…', action: () => {
      pass = true;
      try { wk.fireContext(el, x, y); } finally { pass = false; }
    } }]), { anchor: el });
  });
  return el;
}
// a popover pane: its widgets were built with the panel; opening moves the pane into kit.popover (the same key again
// closes it), closing takes it out again
function openPane(K, key, anchor, title, pane) {
  return K.popover(key, anchor, title, box => { box.appendChild(pane); return { refresh() {}, destroy() { pane.remove(); } }; }, () => '');
}
const paneEl = doc => mk(doc, 'div', 'sxo-pane');

/* ---------------------------------------------------------------- CSS (scoped .sxo-*; injected once per document) */

const CSS = `
.sxo-osc > .sx-ptitle, .sxo-mod > .sx-ptitle { flex-wrap: wrap; row-gap: 4px; }
.sxo-osc > .sx-ptitle .sx-tname, .sxo-mod > .sx-ptitle .sx-tname { color: var(--sxo-c, inherit); }
.sxo-type { flex: 0 1 110px; min-width: 0; }
.sxo-src { flex: 1 1 120px; min-width: 0; }
.sxo-rbtn { min-width: 44px; font-weight: 700; font-size: 10px; letter-spacing: 0.04em; }
.sxo-rbtn[data-route="0"] { color: var(--sx-f1, #ff8a5b); } .sxo-rbtn[data-route="2"] { color: var(--sx-neg, #ffb347); }
.sxo-rbtn[data-route="3"] { color: var(--sx-mute, #7f8b98); }
.sxo-pane { display: grid; gap: 8px; min-width: 0; }
.sxo-pane .sx-krow { align-items: center; }
.sxo-dw { position: relative; min-width: 0; }
.sxo-dot { position: absolute; z-index: 2; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; background: ${C.xy}; border: 2px solid #fff; box-shadow: 0 0 0 1px #000; cursor: move; touch-action: none; }
.sxo-hl { position: absolute; z-index: 2; right: 0; width: 22px; height: 12px; margin-top: -6px; padding: 0 2px; color: #061018; background: var(--sx-accent, #4fb3ff); border-radius: 3px 0 0 3px; font: 700 8px/12px var(--mono, ui-monospace, monospace); text-align: center; cursor: ns-resize; touch-action: none; user-select: none; -webkit-user-select: none; }
.sxo-badge { display: inline-flex; align-items: center; padding: 1px 5px; color: var(--sx-on, #6fe3a1); border: 1px solid var(--sx-on, #6fe3a1); border-radius: 3px; font: 700 8px/1.4 var(--mono, ui-monospace, monospace); letter-spacing: 0.08em; }
.sxo-wrow { align-items: center; }
.sxo-wrow > .wk-menu { flex: 1 1 140px; }
.sxo-wl { min-width: 14px; color: var(--sx-mute, #7f8b98); font-size: 9px; font-weight: 800; letter-spacing: 0.06em; }
.sxo-var.wk-sl, .sxo-lvl.wk-sl { flex: 1 1 80px; min-width: 60px; }
.sxo-fm .wk-sb { padding: 1px 4px; font-size: 9px; }
.sxo-sw { display: flex; gap: 2px; }
.sxo-sw .wk-tog { min-width: 22px; padding: 2px 4px; }
.sxo-mini { height: 44px !important; }
.sxo-hint { color: var(--sx-mute, #7f8b98); font-size: 10px; }
.sxo-win { touch-action: none; }
.sxo-win svg { width: 22px; height: 14px; }
.sxo-miss { color: ${C.xy}; border-color: ${C.xy}; font-weight: 700; }
`;
function ensureCSS(doc) {
  if (!doc || !doc.head || typeof doc.createElement !== 'function') return;
  if (typeof doc.getElementById === 'function' && doc.getElementById('sxo-css')) return;
  const st = doc.createElement('style');
  st.id = 'sxo-css';
  st.textContent = CSS;
  doc.head.appendChild(st);
}

/* ---------------------------------------------------------------- display maths */

// In-place iterative radix-2 FFT (displays only; n power of two)
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
// log-frequency axis of the filter display = the cutoff law (x = n of f.cutoff: 8.18 Hz … 22.05 kHz)
const F_LO = core.MIDI0 || 8.175798915643707, F_HI = 22050;
const fOfX = u => F_LO * Math.pow(F_HI / F_LO, u);
// spectral displays (spectrogram rows, the spectral filter): log-frequency 20 Hz … 20 kHz, 0 at the bottom
const yOfHz = f => clamp01(Math.log(Math.max(1e-6, f) / 20) / Math.log(1000));
// Source and destination rectangles of a spectrogram image (host.smp.spectrogram: w × h cells, columns over the stored
// record, rows log 20 Hz … rate/2 with row 0 the highest) shown over the record fractions [lo, hi] on a display of height
// H whose axis is the panel's log 20 Hz … 20 kHz (yOfHz): rows above 20 kHz are cut off; a record below 40 kHz fills the
// lower part of the axis only. → { sx, sy, sw, sh, dy, dh } (drawn across the whole width)
export function specRect(w, h, lo, hi, rate, H) {
  const fHi = Math.max(40, rate > 0 ? rate / 2 : 24000), s = Math.log(1000) / Math.log(fHi / 20), a = clamp01(lo), b = Math.max(a, clamp01(hi));
  const sw = Math.min(w, Math.max(1, (b - a) * w)), sx = Math.min(a * w, w - sw);
  return s <= 1 ? { sx, sy: h * (1 - s), sw, sh: h * s, dy: 0, dh: H } : { sx, sy: 0, sw, sh: h, dy: H - H / s, dh: H / s };
}

// Layers of the 3D wavetable view (§9.3, §7.1), back to front: [{ z (0–1), slot (display slot of F), frame (real
// frame index | −1), real }]. Raw tables (F = R) show up to `max` evenly spaced frames, all real. Morph tables
// (F = 256 slots over R real frames) always include the real frames (up to `max` of them, at their slot
// round(k·(F−1)/(R−1))) and fill up to `max` layers with interpolated slots between them.
export function layers3d(F, R, max) {
  const M = max > 0 ? max : 40, out = [];
  if (!(F > 1)) return [{ z: 0, slot: 0, frame: 0, real: true }];
  if (!(R > 1) || F === R) {
    const n = Math.min(F, M);
    for (let c = 0; c < n; c++) { const k = Math.round(c * (F - 1) / (n - 1)); out.push({ z: k / (F - 1), slot: k, frame: R === F ? k : -1, real: R === F }); }
  } else {
    const nr = Math.min(R, M), taken = new Set();
    for (let c = 0; c < nr; c++) {
      const k = Math.round(c * (R - 1) / (nr - 1)), slot = Math.round(k * (F - 1) / (R - 1));
      taken.add(slot);
      out.push({ z: slot / (F - 1), slot, frame: k, real: true });
    }
    const ni = M - nr;
    for (let c = 1; c <= ni; c++) {
      const slot = Math.round(c * (F - 1) / (ni + 1));
      if (!taken.has(slot)) { taken.add(slot); out.push({ z: slot / (F - 1), slot, frame: -1, real: false }); }
    }
  }
  return out.sort((a, b) => b.z - a.z);
}

// The visible range { a, b } of a sample display (zoom / pan), as [a, b] with 0 ≤ a < b ≤ 1; absent or degenerate =
// the whole sample.
function viewRange(view) {
  const V = view || {}, a = fin(V.a) ? clamp01(V.a) : 0, b = fin(V.b) ? clamp01(V.b) : 1;
  return b - a > 1e-9 ? [a, b] : [0, 1];
}

// Pointer position (px, py) in the display box r ({left, top, width, height}, e.g. getBoundingClientRect()) → { x, y }
// ∈ [0,1]: x along the visible range of `view` (so a zoomed waveform maps to sample fractions; no view = the box
// fraction), y = 1 at the top. Used by the filter display (cutoff / res), the X|Y dot (k.pos / k.gy) and the markers.
export function xyToN(px, py, r, view) {
  const R = r || {}, left = fin(R.left) ? R.left : 0, top = fin(R.top) ? R.top : 0;
  const width = Math.max(1, fin(R.width) ? R.width : 0), height = Math.max(1, fin(R.height) ? R.height : 0);
  const [a, b] = viewRange(view);
  return { x: a + clamp01((px - left) / width) * (b - a), y: clamp01(1 - (py - top) / height) };
}

// The slice of sample fraction u (§6.7.5: boundaries [0, marks…, 1]): { j (slice index 0…marks.length; key
// sliceRoot + j plays it), a, b (its bounds), mark (index of the mark nearest to u within tol, else −1: the manual
// Alt-click / long-press removes it) }. A mark belongs to the slice it starts; order of `marks` does not matter.
export function sliceAt(marks, u, tol) {
  const M = arr(marks), x = fin(u) ? clamp01(u) : 0, t = fin(tol) && tol > 0 ? tol : 0;
  let j = 0, a = 0, b = 1, mark = -1, best = Infinity;
  for (let k = 0; k < M.length; k++) {
    const m = M[k];
    if (!fin(m)) continue;
    if (m <= x) { j++; if (m > a) a = m; } else if (m < b) b = m;
    const dd = Math.abs(m - x);
    if (dd <= t && dd < best) { best = dd; mark = k; }
  }
  return { j, a, b, mark };
}

// Crossfade zone of a loop from ls to le (fractions, §6.7.4; the zones sx-sample fades in): Lx = X·0.5·|le − ls|, limited
// by half the loop and the room the partner read needs. A loop played forwards (Fwd, Tailed) wraps at le: the last Lx
// before le, room before ls (after ls for a backward-ordered loop). Rev Loop (rev) runs backwards and wraps at ls: the
// first Lx after ls (toward le), room after le (before le for a backward-ordered loop).
function xfadeZone(ls, le, X, rev) {
  const d = Math.abs(le - ls), fwd = le >= ls, room = rev ? (fwd ? 1 - le : le) : (fwd ? ls : 1 - ls);
  const Lx = Math.max(0, Math.min(X * 0.5 * d, room, d / 2));
  if (rev) return fwd ? { u0: ls, u1: ls + Lx, wrap: ls, len: Lx } : { u0: ls - Lx, u1: ls, wrap: ls, len: Lx };
  return fwd ? { u0: le - Lx, u1: le, wrap: le, len: Lx } : { u0: le, u1: le + Lx, wrap: le, len: Lx };
}

// Processed-sample coordinates (§6.7.7, §9.4.2): markers, loop points, slice marks and k.pos are fractions u of the
// processed sample (the record cut to ops.trim = [t0, t1], then reversed when ops.rev); the host's record, PCM, overview,
// spectrogram and onset function are the stored record (fractions x). → { t0, t1, w, rev, toRec(u) → x, fromRec(x) → u }
export function smpCoords(ops) {
  const O = ops && typeof ops === 'object' ? ops : {}, t = O.trim;
  let t0 = 0, t1 = 1;
  if (Array.isArray(t) && t.length === 2 && fin(t[0]) && fin(t[1]) && clamp01(t[0]) < clamp01(t[1])) { t0 = clamp01(t[0]); t1 = clamp01(t[1]); }
  const w = t1 - t0, rev = !!O.rev;
  return { t0, t1, w, rev, toRec: u => (rev ? t1 - u * w : t0 + u * w), fromRec: x => (rev ? (t1 - x) / w : (x - t0) / w) };
}

// Sample-display markers in pixels (§13.3 Sample / Granular / Spectral views):
//   m     { S, E, LS, LE, X, loop, marks, slicing, play } — fractions of the processed sample (k.sstart, k.send,
//         k.lstart, k.lend; base values, or the animated snapshot.smpPos values), X = k.xfade n, loop = LOOP_MODES
//         index, marks = smpo.slice.marks, slicing = SLICE_MODES index (pass 0 while X|Y is on), play = playhead
//         fraction or null; absent fields: S 0, E 1, LS 0, LE 1, X 0, loop 0, no marks, slicing 0, no playhead
//   view  { a, b } visible range (zoom / pan); w = display width in pixels
// → { a, b, markers, loop, xfade, slices, play }
//   markers  [{ id, key, u, x, vis }] in hit-test order: S, E; LS, LE (loop modes 1–3); XF (+ y = X, the handle
//            height: drag up) at the wrap point when there is a crossfade. key = destination suffix (k.<key>)
//   loop     { u0, u1, x0, x1 } the band that loops as played: modes 1–3 LS…LE clamped into the region [min(S, E),
//            max(S, E)] (§6.7.1); Tailed the tail (S + E)/2…E (§6.7.3); One-shot null
//   xfade    { u0, u1, x0, x1, wrap, len } (§6.7.4; Fwd loops and Tailed: before the wrap at LE / E; Rev loops: after
//            the wrap at LS; ping-pong and One-shot null)
//   slices   [{ j, u, x, vis }] slice starts (the marks; slice j + 1 starts at mark j) when slicing is on
//   play     { u, x, vis } | null
// x may lie outside [0, w] (vis false) when zoomed.
export function markerLayout(m, view, w) {
  const M = m || {}, W = fin(w) && w > 0 ? w : 1, [a, b] = viewRange(view), k = W / (b - a);
  const num = (x, d) => (fin(x) ? clamp01(x) : d);
  const S = num(M.S, 0), E = num(M.E, 1), LS = num(M.LS, 0), LE = num(M.LE, 1), X = num(M.X, 0);
  const loop = fin(M.loop) ? clamp(Math.round(M.loop), 0, 4) : 0, slicing = fin(M.slicing) ? clamp(Math.round(M.slicing), 0, 2) : 0;
  const at = u => { const x = (u - a) * k; return { u, x, vis: x >= -0.5 && x <= W + 0.5 }; };
  const span = Z => Object.assign(Z, { x0: (Z.u0 - a) * k, x1: (Z.u1 - a) * k });
  const markers = [Object.assign({ id: 'S', key: 'sstart' }, at(S)), Object.assign({ id: 'E', key: 'send' }, at(E))];
  const lo = Math.min(S, E), hi = Math.max(S, E);
  let band = null, xf = null;
  if (loop >= 1 && loop <= 3) {
    markers.push(Object.assign({ id: 'LS', key: 'lstart' }, at(LS)), Object.assign({ id: 'LE', key: 'lend' }, at(LE)));
    const ls = clamp(LS, lo, hi), le = clamp(LE, lo, hi);
    band = span({ u0: Math.min(ls, le), u1: Math.max(ls, le) });
    if (loop !== 3) xf = span(xfadeZone(ls, le, X, loop === 2));
  } else if (loop === 4) {
    const mid = (S + E) / 2;
    band = span({ u0: Math.min(mid, E), u1: Math.max(mid, E) });
    xf = span(xfadeZone(mid, E, X));
  }
  if (xf) markers.push(Object.assign({ id: 'XF', key: 'xfade' }, at(xf.wrap), { y: X }));
  const slices = [];
  if (slicing) arr(M.marks).forEach(u => { if (fin(u)) slices.push(Object.assign({ j: slices.length }, at(clamp01(u)))); });
  return { a, b, markers, loop: band, xfade: xf, slices, play: fin(M.play) ? at(clamp01(M.play)) : null };
}

// Multisample zone map (§13.3 Multisample view; zones = the multi entry's / record's zones, §4.5): x = key 0–127
// (key n spans [n, n + 1)·w/128), y = velocity (127 at the top: v spans [127 − v, 128 − v)·h/127). Zones with the
// same key and velocity ranges (round robins, stacked layers) share their rectangle as horizontal lanes ordered by
// rr position, then zone order. hot = zone index | array | Set of indices to highlight (snapshot.zone).
// → [{ i (zone index), lo, hi, vlo, vhi (normalised), x, y, w, h, lane, lanes, hot }] in zone order (draw order;
// hit-test from the end); entries that are not objects are skipped.
export function zoneMapLayout(zones, w, h, hot) {
  const W = fin(w) && w > 0 ? w : 1, H = fin(h) && h > 0 ? h : 1;
  const isHot = hot instanceof Set ? i => hot.has(i) : Array.isArray(hot) ? i => hot.includes(i) : fin(hot) ? i => i === hot : () => false;
  const key = (v, d, lo) => (fin(v) ? clamp(Math.round(v), lo, 127) : d);
  const out = [], groups = new Map();
  arr(zones).forEach((z, i) => {
    if (!z || typeof z !== 'object') return;
    let lo = key(z.lo, 0, 0), hi = key(z.hi, 127, 0), vlo = key(z.vlo, 1, 1), vhi = key(z.vhi, 127, 1);
    if (hi < lo) { const t = lo; lo = hi; hi = t; }
    if (vhi < vlo) { const t = vlo; vlo = vhi; vhi = t; }
    const r = { i, lo, hi, vlo, vhi, x: lo / 128 * W, y: (127 - vhi) / 127 * H, w: (hi - lo + 1) / 128 * W, h: (vhi - vlo + 1) / 127 * H,
      lane: 0, lanes: 1, hot: isHot(i) };
    const g = lo + ':' + hi + ':' + vlo + ':' + vhi, rr = Array.isArray(z.rr) && fin(z.rr[1]) ? z.rr[1] : 0;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push([r, rr]);
    out.push(r);
  });
  for (const G of groups.values()) {
    if (G.length < 2) continue;
    G.sort((p, q) => p[1] - q[1] || p[0].i - q[0].i);
    G.forEach(([r], l) => { const hh = r.h / G.length; r.lane = l; r.lanes = G.length; r.y += l * hh; r.h = hh; });
  }
  return out;
}

// WARPS2 categories (§3.4.1, inv B3.1) of mode index i
const WARP_CATS = ['', 'Sync', 'Alt Warp', 'Filter', 'Distortion', 'FM', 'PD', 'AM', 'RM', 'Spectral (Spectral oscillators only)'];
const warpCat = i => (i <= 0 ? 0 : i === 1 ? 1 : i <= 16 ? 2 : i <= 18 ? 3 : i <= 32 ? 4 : i <= 38 ? 5 : i <= 45 ? 6 : i <= 51 ? 7 : i <= 57 ? 8 : 9);
const isFm = m => m >= 33 && m <= 38;
const isRemap2 = m => m >= 11 && m <= 14;
const BIP2 = [4, 8, 16, 78, 80];                     // WARPS2 modes whose neutral amount is 0.5 (bipolar knob arc)
const BIP1 = [6, 10, 12];                            // the Phase-1 list's (a.warpMode / b.warpMode, S1 mode)
// WARP 1 / WARP 2 menu items of oscillator o (§13.3, §3.4.2): every WARPS2 mode as { v: mode / 81, label (o1 / o2 named
// for o), group (category) }; the spectral modes are greyed (disabled: they act as Off) unless o is a Spectral oscillator
export function warpMenuItems(s, o) {
  const k = oscIdx(o), t = core.oscTypeOf(s, k);
  return WARPS2.map((w, i) => ({ v: i / 81, label: (w.nameO && w.nameO[k]) || w.name, group: WARP_CATS[warpCat(i)],
    disabled: w.avail === 'Sp' && t !== 'spec' }));
}
// modulator of a WARPS2 mode (§6.6.6): 'o1' | 'o2' | 'noise' | 'sub' | 'f1' | 'f2' | 'self' | ''
function warpSrc(m) {
  if (m >= 33 && m <= 38) return ['o1', 'o2', 'noise', 'sub', 'f1', 'f2'][m - 33];
  if (m >= 39 && m <= 45) return ['o1', 'o2', 'noise', 'sub', 'f1', 'f2', 'self'][m - 39];
  if (m >= 46 && m <= 57) return ['o1', 'o2', 'noise', 'sub', 'f1', 'f2'][(m - 46) % 6];
  return '';
}

// Routing switches S A B C N of filter k (§13.3 FILTER 1 / 2): lit = the source reaches this filter — route Filter, its
// filter-balance share of filter k > 0 (F1 (1 − b)/2, F2 (1 + b)/2, b = fbal value) and the switch (f.route<X> /
// f2.route<X>) on. → { S, A, B, C, N }
const FSRC = [['S', s => s.sub, 's.fbal'], ['A', s => s.osc[0], 'a.fbal'], ['B', s => s.osc[1], 'b.fbal'], ['C', s => s.osc[2], 'c.fbal'],
  ['N', s => s.noise, 'n.fbal']];
export function filterLit(s, k) {
  const out = {}, F = k ? 'f2.' : 'f.', feeds = typeof core.filterFeeds === 'function';
  for (const [X, get, bal] of FSRC) {
    if (feeds) { out[X] = !!(s && s.osc) && core.filterFeeds(s, k ? 1 : 0, X); continue; }
    const O = s && s.osc ? get(s) : null, b = 2 * core.destBase(s, null, bal) - 1, share = k ? (1 + b) / 2 : (1 - b) / 2;
    out[X] = !!O && O.route === 0 && share > 0 && core.destBase(s, null, F + 'route' + X) >= 0.5;
  }
  return out;
}

// Auto slicing (§9.4.5) — the rule of smp.slicesFromOdf (S1's pure helper; sx-ui-osc cannot import smp.js while the
// panel tests' wt.js stub lacks smp's imports, so this is a copy kept identical to it and tested against it): local
// maxima of the onset function (> left, ≥ right) above thr, kept strongest first (ties: earlier) with ≥ 50 ms to every
// kept mark and to the start, ≤ 256, sorted → fractions of len (frames at `rate`; odf frame t sits at t·hop, hop 256),
// rounded to 5 decimals (as normalizeSerum stores marks).
export function autoSlices(odf, thr, rate, len, hop) { return onsetMarks(odf, thr, rate, len, hop, null); }
// the same in processed coordinates (smpCoords of `ops`): onsets inside the trim, mirrored when reversed, the 50 ms rules
// applied to the processed sample
function onsetMarks(odf, thr, rate, len, hop, ops) {
  const d = odf && odf.length ? odf : [], H = hop > 0 ? hop : 256, gap = 0.05 * (rate > 0 ? rate : 48000), th = fin(thr) ? +thr : 0.5;
  if (!(len > 0) || !d.length) return [];
  const Cc = smpCoords(ops), lo = Cc.t0 * len, hi = Cc.t1 * len, PL = hi - lo, peaks = [];
  for (let t = 0; t < d.length; t++) {
    const v = d[t], l = t > 0 ? d[t - 1] : 0, r = t + 1 < d.length ? d[t + 1] : 0, pos = t * H;
    if (!(v > th && v > l && v >= r) || pos < lo || pos >= hi) continue;
    peaks.push({ t, v, p: Cc.rev ? hi - pos : pos - lo });
  }
  peaks.sort((a, b) => b.v - a.v || a.t - b.t);
  const kept = [];
  for (const q of peaks) {
    if (kept.length >= 256) break;
    if (q.p < gap || q.p >= PL) continue;
    if (kept.some(k => Math.abs(k.p - q.p) < gap)) continue;
    kept.push(q);
  }
  return kept.map(q => r5(q.p / PL)).sort((a, b) => a - b).filter((u, i, a) => u > 0 && u < 1 && (i === 0 || u !== a[i - 1]));
}
// Auto marks of a wavetable played as a sample (§9.4.8): its frame boundaries k/R, in processed coordinates
function frameMarks(R, ops) {
  const Cc = smpCoords(ops), out = [];
  for (let k = 1; k < R; k++) { const x = k / R; if (x > Cc.t0 && x < Cc.t1) out.push(r5(Cc.fromRec(x))); }
  return out.sort((a, b) => a - b).filter((u, i, a) => u > 0 && u < 1 && (i === 0 || u !== a[i - 1])).slice(0, 256);
}

/* ================================================================ shared wavetable / noise / sample data (one per kit) */

const DATA = new WeakMap();
export function oscData(kit) {
  let D = DATA.get(kit);
  if (!D) { D = new OscData(kit); DATA.set(kit, D); }
  return D;
}

class OscData {
  constructor(kit) {
    this.kit = kit;
    this.tables = new Map();          // table id → { state: 'loading' | 'ok' | 'missing', info }
    this.noiseOv = new Map();         // noise id → { min, max } overview (Float32Array) | null
    this.wtListC = null; this.wtListT = -1;
    this.nzListC = null; this.nzListT = -1;
    this.smpListC = {}; this.smpListT = {};
    this.recs = new Map();            // asset id → { state, rec, p, t }
    this.ovs = new Map();             // asset id → Float32Array(2n) | null (pending)
    this.specs = new Map();           // asset id → { w, h, data } | null (pending)
    this.odfs = new Map();            // asset id → { p: Promise<Float32Array | null>, v (undefined while pending), t }
    this.pcmE = null;                 // the PCM of one sample for the snapping searches: { id, state, pcm, t }
    this.pcmT = 0;
    this.fbuf = null;
    this.rmap = null;
  }
  s() { return this.kit.s(); }
  // a preset load, an undo, the WT editor closed, a resample, a module operation: the table and list caches go, and of
  // the sample caches everything that may have changed — wavetables played as samples (their tables may have been
  // edited), records that were missing or still loading and what was drawn from them, onset functions that were none,
  // the held PCM. The data of present samples stays (a sample id names its content; import, relink, rename and delete
  // forget theirs), so an undo does not reload every display.
  forget() {
    this.tables.clear(); this.wtListC = null; this.smpListC = {};
    const bad = new Set();
    for (const [id, e] of this.recs) if (isWtId(id) || e.state !== 'ok') bad.add(id);
    for (const M of [this.ovs, this.specs]) for (const [id, v] of M) if (!v || isWtId(id)) bad.add(id);
    for (const [id, e] of this.odfs) if (isWtId(id) || e.v === null || e.v === undefined) bad.add(id);
    for (const id of bad) { this.recs.delete(id); this.ovs.delete(id); this.specs.delete(id); this.odfs.delete(id); }
    this.pcmDrop();
  }

  /* ---------------------------------------------------------------- lists and menus (host.wt) */
  // host.wt.list() / noises(): factory first, then user; read once per repaint
  wtList() {
    if (this.wtListT !== this.kit.paintSeq() || !this.wtListC) {
      const w = this.kit.host.wt, L = w && w.list ? arr(w.list()) : [];
      this.wtListC = L.filter(t => !t.user).concat(L.filter(t => t.user));
      this.wtListT = this.kit.paintSeq();
    }
    return this.wtListC;
  }
  wtItems(o, cur) {
    const L = this.wtList(), c = cur === undefined ? this.s().osc[o].wt : cur;
    const items = L.map(t => ({ v: t.id, label: t.name || nameOfId(t.id), group: t.user ? 'User' : t.cat || 'Factory' }));
    if (c && !items.some(it => it.v === c)) items.push({ v: c, label: nameOfId(c), group: 'Current' });
    // categories in catalogue order (first appearance), then User, then the unlisted current table (§9.3)
    const cats = items.map(it => it.group).filter(g => g !== 'User' && g !== 'Current');
    return groupItems(items, cats.concat(['User', 'Current']));
  }
  noiseList() {
    if (this.nzListT !== this.kit.paintSeq() || !this.nzListC) {
      const w = this.kit.host.wt, L = w && w.noises ? arr(w.noises()) : [];
      this.nzListC = L.filter(t => !t.user).concat(L.filter(t => t.user));
      this.nzListT = this.kit.paintSeq();
    }
    return this.nzListC;
  }
  // NOISE menu (§13.3, inv B10): Color ▸ (generated colour noises) first, the factory categories, User
  noiseItems() {
    const cur = this.s().noise.src;
    const items = COLOR_NOISES.map(c => ({ v: c.id, label: c.name, group: 'Color' }))
      .concat(this.noiseList().map(t => ({ v: t.id, label: t.name || nameOfId(t.id), group: t.user ? 'User' : t.cat || 'Noise' })));
    if (!items.some(it => it.v === cur)) items.push({ v: cur, label: nameOfId(cur), group: 'Current' });
    return groupItems(items, ['Color'].concat(items.map(it => it.group).filter(g => g !== 'User' && g !== 'Current' && g !== 'Color'), ['User', 'Current']));
  }
  renameTable(o) {
    const K = this.kit, id = this.s().osc[o].wt, it = this.wtList().find(t => t.id === id);
    K.prompt('Rename Wavetable', 'Name', it ? it.name : nameOfId(id), t => {
      const name = String(t).trim().slice(0, 48);
      if (!name) return false;
      const W = K.host.wt;
      // host.wt.rename when the host has it; otherwise a full host.wt.update of the table under its new name
      // (§8.8 update persists the table, and wtstore.put stores table.name)
      const job = typeof W.rename === 'function' ? Promise.resolve(W.rename(id, name))
        : Promise.resolve(W.get(id)).then(tb => { if (tb) return W.update(id, Object.assign({}, tb, { name }), {}); throw new Error('table missing'); });
      job.then(() => { this.tables.delete(id); this.wtListC = null; K.queue(); },
        err => { console.warn('sx-ui-osc: rename', err); K.notify('Could not rename the wavetable'); });
      return true;
    });
  }
  canRename(id) {
    const W = this.kit.host.wt;
    return /^user:/.test(id || '') && !!W && (typeof W.rename === 'function' || (typeof W.get === 'function' && typeof W.update === 'function'));
  }
  // Delete (OSC A / B / C, NOISE): the selected user table / noise leaves the store after a confirmation that names the
  // other tracks using it; the host switches every sound that used it to the default source
  canDelete(id, noise) {
    const W = this.kit.host.wt;
    return (noise ? /^nzuser:/ : /^user:/).test(id || '') && !!W && typeof W.del === 'function';
  }
  deleteUser(noise, o) {
    const K = this.kit, W = K.host.wt, s = this.s(), id = noise ? s.noise.src : s.osc[o].wt;
    if (!this.canDelete(id, noise)) return;
    const it = (noise ? this.noiseList() : this.wtList()).find(t => t.id === id), nm = it && it.name ? it.name : nameOfId(id);
    const kind = noise ? 'noise' : 'wavetable', users = typeof W.users === 'function' ? arr(W.users(id)) : [];
    const also = users.length > 1 ? ' The tracks using it (' + users.join(', ') + ') switch to the default ' + kind + '.' : '';
    if (!askConfirm(K.doc, 'Delete the user ' + kind + ' “' + nm + '” from this browser? This cannot be undone.' + also)) return;
    Promise.resolve(W.del(id)).then(() => {
      if (K.dead()) return;
      this.tables.delete(id); this.noiseOv.delete(id); this.wtListC = null; this.nzListC = null;
      K.notify('Deleted “' + nm + '”');
      K.queue();
    }, err => { console.warn('sx-ui-osc: delete', err); if (!K.dead()) K.notify('Could not delete “' + nm + '”'); });
  }

  /* ---------------------------------------------------------------- tables */
  // table cache: host.wt.get(id) → { state, info: { table, R, morph, F (display frames), interp, exp }, p (settles with
  // info | null when the request did) }
  tableEntry(id) {
    let e = this.tables.get(id);
    if (e) return e;
    e = { state: 'loading', info: null, p: null };
    this.tables.set(id, e);
    const w = this.kit.host.wt;
    if (!w || typeof w.get !== 'function') { e.state = 'missing'; e.p = Promise.resolve(null); return e; }
    e.p = Promise.resolve().then(() => w.get(id)).then(t => {
      if (this.tables.get(id) !== e) return null;
      if (!t || !Array.isArray(t.frames) || !t.frames.length) e.state = 'missing';
      else {
        const R = t.frames.length, morph = t.morph | 0;
        e.info = { table: t, R, morph, F: morph && R > 1 ? 256 : R, interp: morph && R > 1 ? 1 : 0, exp: null };
        if (morph && R >= 256) e.info.F = R;
        e.state = 'ok';
      }
      this.kit.queue();
      return e.info;
    }, () => { e.state = 'missing'; this.kit.queue(); return null; });
    return e;
  }
  // display frames / interpolation of oscillator o's table (the WT POS format context, §3.2)
  tinfo(o) {
    const s = this.s(), e = s && s.osc && s.osc[o] ? this.tableEntry(s.osc[o].wt) : null;
    return e && e.info ? e.info : { F: 256, interp: 1 };
  }
  // the frame heard at normalised position n (discrete / crossfade / spectral expansion, §7.1, §6.5)
  frameAt(info, n) {
    const t = info.table, R = info.R, u = clamp01(n), W = this.kit.wt;
    if (R === 1) return t.frames[0];
    if (!info.morph) return t.frames[Math.min(R - 1, Math.floor(u * R))];
    let A, B, f;
    if (info.morph === 1 || !W || typeof W.expandTable !== 'function' || R >= 256) {
      const x = u * (R - 1), i = Math.min(R - 2, Math.floor(x));
      A = t.frames[i]; B = t.frames[i + 1]; f = x - i;
    } else {
      if (!info.exp) info.exp = W.expandTable(t);
      const x = u * 255, i = Math.min(254, Math.floor(x));
      A = info.exp.subarray(i * 2048, i * 2048 + 2048); B = info.exp.subarray((i + 1) * 2048, (i + 2) * 2048); f = x - i;
    }
    if (!this.fbuf) this.fbuf = new Float32Array(2048);
    const out = this.fbuf;
    for (let j = 0; j < 2048; j++) out[j] = A[j] + (B[j] - A[j]) * f;
    return out;
  }
  slotFrame(info, k) {   // display slot k of info.F
    if (info.F === info.R) return info.table.frames[k];
    return this.frameAt(info, info.F > 1 ? k / (info.F - 1) : 0).slice();
  }
  remapTab(o) {
    const pts = this.s().osc[o].remap, k = JSON.stringify(pts);
    this.rmap = this.rmap || [{}, {}, {}];
    if (this.rmap[o].k !== k) this.rmap[o] = { k, tab: core.renderPts(pts, 2048) };
    return this.rmap[o].tab;
  }
  // live (modulated) value while notes sound, else the base (snapshot eff by vi, §6.20)
  liveN(id) {
    const sn = this.kit.snap(), i = core.vi(id);
    return sn && sn.notes > 0 && sn.eff && i >= 0 && fin(sn.eff[i]) ? sn.eff[i] : this.kit.getN(id);
  }
  livePos(o) {
    const sn = this.kit.snap();
    return sn && sn.notes > 0 && sn.wtPos && fin(sn.wtPos[o]) ? sn.wtPos[o] : this.kit.getN(OSC_P[o] + '.wt');
  }
  // the base frame of oscillator o (its table at the base WT POS), or null while its table loads / for other types
  baseFrame(o) {
    const s = this.s();
    if (!s || core.oscTypeOf(s, o) !== 'wt') return null;
    const e = this.tableEntry(s.osc[o].wt);
    return e.info ? this.frameAt(e.info, this.kit.getN(OSC_P[o] + '.wt')).slice() : null;
  }

  /* ---------------------------------------------------------------- samples (host.smp, §11.15) */
  smpHost() { const h = this.kit.host; return h && h.smp ? h.smp : null; }
  // host.smp.list(kind): read once per repaint
  smpList(kind) {
    const t = this.kit.paintSeq();
    if (this.smpListT[kind] !== t || !this.smpListC[kind]) {
      const H = this.smpHost();
      let L = [];
      try { L = H && typeof H.list === 'function' ? arr(H.list(kind)) : []; } catch (err) { warnOnce('sl' + kind, 'sx-ui-osc: smp.list', err); }
      this.smpListC[kind] = L;
      this.smpListT[kind] = t;
    }
    return this.smpListC[kind];
  }
  // source menu of a sample-based oscillator (§13.3): factory folders (Wavetables ▸ with the tables as samples, §9.4.8),
  // User, Renders; the unlisted current id last
  smpItems(kind, cur) {
    const items = this.smpList(kind).map(t => ({ v: t.id, label: t.name || nameOfId(t.id),
      group: t.folder === 'Renders' ? 'Renders' : t.user && !/^Wavetables\//.test(t.cat || '') ? 'User' : t.cat || 'Factory' }));
    if (cur && !items.some(it => it.v === cur)) items.push({ v: cur, label: this.smpName(cur, kind), group: 'Current' });
    if (!items.length) items.push({ v: '', label: '— none —', group: '' });
    const cats = items.map(it => it.group).filter(g => !/^Wavetables\//.test(g) && g !== 'User' && g !== 'Renders' && g !== 'Current');
    const wts = items.map(it => it.group).filter(g => /^Wavetables\//.test(g));
    return groupItems(items, cats.concat(wts, ['User', 'Renders', 'Current']));
  }
  smpName(id, kind) {
    if (!id) return '— none —';
    const it = this.smpList(kind || 'sample').find(t => t.id === id) || (isWtId(id) ? this.wtList().find(t => t.id === id) : null);
    if (it && it.name) return it.name;
    const r = this.recs.get(id);
    return r && r.rec && r.rec.name ? r.rec.name : nameOfId(id);
  }
  // record (root, loop, len, rate, zones…; no PCM) of an asset: cached, asynchronous (repaint on arrival)
  record(id) { const e = this.recEntry(id); return e ? e.rec : null; }
  // the cache entry { state ('loading' | 'ok' | 'missing'), rec, p (settles with rec | null when the request did), t }.
  // A missing record is asked again after MISS_MS (a factory sound whose generation was cancelled or failed and then
  // retried, a relinked user sample); when it arrives, what was derived from the missing data (overview, spectrogram,
  // onset function) is dropped too.
  recEntry(id) {
    if (!id) return null;
    let e = this.recs.get(id);
    const was = e && e.state === 'missing' && nowMs() - e.t > MISS_MS ? e : null;
    if (was) { this.recs.delete(id); e = null; }
    if (!e) {
      e = { state: 'loading', rec: null, p: null, t: nowMs(), was: !!was };
      this.recs.set(id, e);
      const H = this.smpHost();
      if (!H || typeof H.record !== 'function') { e.state = 'missing'; e.p = Promise.resolve(null); }
      else {
        e.p = Promise.resolve().then(() => H.record(id)).then(r => {
          if (this.recs.get(id) !== e) return null;
          e.rec = r && typeof r === 'object' ? r : null;
          e.state = e.rec ? 'ok' : 'missing';
          e.t = nowMs();
          if (e.rec && e.was) { this.ovs.delete(id); this.specs.delete(id); this.odfs.delete(id); this.smpListC = {}; }
          if (!e.rec) this.missLater(id, e);
          this.kit.queue();
          return e.rec;
        }, () => { e.state = 'missing'; e.t = nowMs(); this.missLater(id, e); this.kit.queue(); return null; });
      }
    }
    return e;
  }
  // a factory sound that is not there (its generation cancelled, failed or not done): a repaint after MISS_MS asks again
  // while a display still shows it (a user asset comes back only through a relink / import, which forget it)
  missLater(id, e) {
    if (isUserAsset(id)) return;
    const t = setTimeout(() => { if (this.recs.get(id) === e && !this.kit.dead()) this.kit.queue(); }, MISS_MS + 50);
    if (t && typeof t.unref === 'function') t.unref();
  }
  // a source chosen again: what was missing about it is asked again at once
  dropMissing(id) {
    const e = this.recs.get(id), f = this.odfs.get(id);
    if (e && e.state === 'missing') { this.recs.delete(id); this.ovs.delete(id); this.specs.delete(id); }
    if (f && f.v === null) this.odfs.delete(id);
  }
  // a user sample / multisample deleted from the store (§9.9: host.smp.record(id) === null): the panel shows the
  // "Missing sample" badge and a drop relinks it
  isMissing(id) { const e = isUserAsset(id) ? this.recEntry(id) : null; return !!e && e.state === 'missing'; }
  // { len (frames), rate, root, loop } of a sample id (a wavetable id plays its frames at 48 kHz, §9.4.8) or null
  smpInfo(id) {
    if (!id) return null;
    if (isWtId(id)) {
      const e = this.tableEntry(id);
      if (!e.info) return null;
      return { len: e.info.R * 2048, rate: 48000, root: WT_ROOT, loop: { start: 0, end: e.info.R * 2048 }, frames: e.info.R };
    }
    const r = this.record(id);
    return r && r.len > 0 ? { len: r.len, rate: r.rate > 0 ? r.rate : 48000, root: fin(r.root) ? r.root : 60, loop: r.loop || null } : null;
  }
  // min/max overview (Float32Array(2n), pairs per column over the whole sample) of a sample id, or null while pending
  overview(id) {
    if (!id) return null;
    if (this.ovs.has(id)) return this.ovs.get(id);
    this.ovs.set(id, null);
    const K = this.kit, n = 1024;
    if (isWtId(id)) {   // a wavetable as a sample: its frames concatenated
      const e = this.tableEntry(id);
      const build = () => {
        const fr = e.info.table.frames, R = fr.length, mm = new Float32Array(2 * n), tot = R * 2048, per = tot / n;
        for (let c = 0; c < n; c++) {
          let lo = 0, hi = 0;
          for (let i = Math.floor(c * per), end = Math.min(tot, Math.floor((c + 1) * per) + 1); i < end; i++) { const v = fr[(i / 2048) | 0][i & 2047]; if (v < lo) lo = v; if (v > hi) hi = v; }
          mm[2 * c] = lo; mm[2 * c + 1] = hi;
        }
        this.ovs.set(id, mm);
      };
      if (e.info) build();
      else this.ovs.delete(id);   // retried on the next repaint once the table arrived
      return this.ovs.get(id) || null;
    }
    const H = this.smpHost();
    if (!H || typeof H.overview !== 'function') return null;
    Promise.resolve().then(() => H.overview(id, n)).then(ov => {
      if (!this.ovs.has(id)) return;
      if (ov && ov.length >= 2) { this.ovs.set(id, ov); K.queue(); } else this.ovs.delete(id);
    }, err => { this.ovs.delete(id); warnOnce('ov' + id, 'sx-ui-osc: overview', err); });
    return null;
  }
  // spectrogram image { w, h, data: Uint8ClampedArray(w·h) } (x = time, y = 0 the highest row; 0 … 255 = −96 … 0 dB)
  spectrogram(id) {
    if (!id) return null;
    if (this.specs.has(id)) return this.specs.get(id);
    this.specs.set(id, null);
    const H = this.smpHost();
    if (!H || typeof H.spectrogram !== 'function') return null;
    Promise.resolve().then(() => H.spectrogram(id, 256, 96)).then(sp => {
      if (!this.specs.has(id)) return;
      if (sp && sp.data && sp.w > 0 && sp.h > 0) { sp.img = null; this.specs.set(id, sp); this.kit.queue(); } else this.specs.delete(id);
    }, err => { this.specs.delete(id); warnOnce('sg' + id, 'sx-ui-osc: spectrogram', err); });
    return null;
  }
  // onset detection function of a sample id (§9.4.5) → Promise<Float32Array | null> (cached; "none" is asked again
  // after MISS_MS); odfNow(id) = the value when it has arrived (null: none), undefined while pending (the request starts)
  odfEntry(id) {
    let e = this.odfs.get(id);
    if (e && e.v === null && nowMs() - e.t > MISS_MS) { this.odfs.delete(id); e = null; }
    if (!e) {
      const H = this.smpHost();
      e = { p: null, v: undefined, t: nowMs() };
      this.odfs.set(id, e);
      e.p = (H && typeof H.odf === 'function' ? Promise.resolve().then(() => H.odf(id)) : Promise.resolve(null))
        .then(x => (x && x.length ? x : null), () => null)
        .then(v => { e.v = v; e.t = nowMs(); return v; });
    }
    return e;
  }
  odf(id) { return id ? this.odfEntry(id).p : Promise.resolve(null); }
  odfNow(id) { return id ? this.odfEntry(id).v : null; }
  // PCM of a sample id for the snapping searches (§13.3.2): { rate, L, R | null, len } as host.smp.pcm returns it (no
  // copy, no derived tables: the searches read ±5 ms windows), or null while it loads / when there is none. One sample
  // is held at a time (another id replaces it) and only while snapping is used: pcmIdle() releases it PCM_IDLE_MS after
  // the last gesture.
  pcm(id) {
    if (!id) return null;
    let e = this.pcmE;
    if (!e || e.id !== id) {
      e = this.pcmE = { id, state: 'loading', pcm: null };
      const H = this.smpHost();
      if (!H || typeof H.pcm !== 'function') e.state = 'missing';
      else {
        Promise.resolve().then(() => H.pcm(id)).then(p => {
          if (this.pcmE !== e) return;
          if (!p || !p.L || !p.L.length) { e.state = 'missing'; return; }
          const R = p.R && p.R.length ? p.R : null;
          e.pcm = { rate: p.rate > 0 ? p.rate : 48000, L: p.L, R, len: R ? Math.min(p.L.length, R.length) : p.L.length };
          e.state = 'ok';
        }, () => { if (this.pcmE === e) e.state = 'missing'; });
      }
    }
    this.pcmIdle();
    return e.pcm;
  }
  pcmIdle() {
    if (this.pcmT) clearTimeout(this.pcmT);
    this.pcmT = 0;
    if (!this.pcmE) return;
    const t = setTimeout(() => { this.pcmT = 0; this.pcmE = null; }, PCM_IDLE_MS);
    if (t && typeof t.unref === 'function') t.unref();   // node: a held PCM never keeps the process alive
    this.pcmT = t;
  }
  pcmDrop(id) {
    if (id !== undefined && (!this.pcmE || this.pcmE.id !== id)) return;
    this.pcmE = null;
    if (this.pcmT) { clearTimeout(this.pcmT); this.pcmT = 0; }
  }
  // assets changed (import, rename, delete, relink, Reload Sample): every cache of that id goes
  forgetAsset(id) {
    this.smpListC = {}; this.recs.delete(id); this.ovs.delete(id); this.specs.delete(id); this.odfs.delete(id); this.pcmDrop(id);
  }

  /* ---------------------------------------------------------------- files: wavetables / noises / samples */
  splitSize() {   // the WT editor's held import split size (§9.9), when it persists one in synth.sx.wte
    let st = null;
    try { const S = this.kit.host.storage; st = S && S.get ? S.get('synth.sx.wte', null) : null; } catch (err) { console.warn('sx-ui-osc: storage', err); }
    const v = st && st.split, W = this.kit.wt;
    if (v === undefined || v === null || v === '') return null;
    return W && typeof W.parseSplitSize === 'function' ? W.parseSplitSize(String(v)) : null;
  }
  async decodeImage(file) {
    const d = this.kit.doc, w = d.defaultView || globalThis, bmp = await w.createImageBitmap(file);
    const c = mk(d, 'canvas');
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const im = g.getImageData(0, 0, c.width, c.height);
    return { width: im.width, height: im.height, data: im.data };
  }
  async importTableFiles(o, files) {
    const K = this.kit, f = files[0], W = K.host.wt, wt = K.wt || {};
    if (!f || !W || !W.saveNew) return;
    try {
      let table;
      if (/\.png$/i.test(f.name) || f.type === 'image/png') {
        if (typeof wt.importImage !== 'function') throw new Error('PNG import unavailable');
        table = wt.importImage(await this.decodeImage(f));
      } else {
        if (typeof wt.readWav !== 'function' || typeof wt.tableFromWav !== 'function') throw new Error('WAV import unavailable');
        // clm chunk → its frames; whole multiple of 2048 → raw frames; else the held split size (manual) or Pitch Avg;
        // a stereo file gives OSC A / C its left and OSC B its right channel (inv B11)
        const wav = wt.readWav(await f.arrayBuffer()), split = this.splitSize();
        const opts = { mode: 'auto', name: (f.name || '').replace(/\.[^.]+$/, ''), channel: o === 1 && wav.ch && wav.ch.length > 1 ? 1 : 0 };
        if (split) opts.size = split;
        table = wt.tableFromWav(wav, opts);
      }
      const name = (f.name || 'Imported').replace(/\.[^.]+$/, '').slice(0, 48) || 'Imported';
      table.name = name;
      const id = await W.saveNew(table, name);
      if (K.dead() || !id) return;
      this.wtListC = null;
      K.edit(s => { s.osc[o].wt = id; }, { label: 'Import wavetable' });
      K.notify(table.importMsg || 'Imported “' + name + '”');
    } catch (err) {
      console.warn('sx-ui-osc: import', err);
      K.notify('Import failed: ' + (err && err.message ? err.message : err));
    }
  }
  async importNoiseFiles(files) {
    const K = this.kit, f = files[0], W = K.host.wt, wt = K.wt || {};
    if (!f || !W || !W.saveNoise) return;
    try {
      if (typeof wt.readWav !== 'function') throw new Error('WAV import unavailable');
      const wav = wt.readWav(await f.arrayBuffer()), L = wav.ch[0], R = wav.ch.length > 1 ? wav.ch[1] : null;
      const name = (f.name || 'Noise').replace(/\.[^.]+$/, '').slice(0, 48) || 'Noise';
      const lp = wav.loop && wav.loop.end > wav.loop.start ? wav.loop : null;
      // source default (§9.3): a file with a smpl loop loops, any other file plays once
      const oneshot = lp ? 0 : 1;
      const rec = { kind: 'noise', name, rate: wav.sr, ch: R ? 2 : 1, root: 60, len: L.length, loopStart: lp ? lp.start : 0, loopEnd: lp ? lp.end : L.length, oneshot, L, R };
      const id = await W.saveNoise(rec, name);
      if (K.dead() || !id) return;
      K.edit(s => { s.noise.src = id; s.noise.oneshot = oneshot; s.p['n.on'] = 1; }, { label: 'Import noise' });
      K.notify('Imported noise “' + name + '”');
    } catch (err) {
      console.warn('sx-ui-osc: noise import', err);
      K.notify('Import failed: ' + (err && err.message ? err.message : err));
    }
  }
  // Load Sample… / Load SFZ… / drops on a sample display (§9.3): host.smp.import → the new id on oscillator o (a sample
  // with its operations reset and its Auto slicing marks in the same step). opt.replace = a missing user asset to relink
  // (§9.9: host.smp.import {replace}): the host switches every sound that used it, this oscillator included, and the
  // markers, operations and slices stay as they were
  async importSamples(o, files, kind, opt) {
    const K = this.kit, H = this.smpHost(), fl = arr(files), multi = kind === 'multi', rep = opt && isUserAsset(opt.replace) ? opt.replace : null;
    if (!fl.length) return null;
    if (!H || typeof H.import !== 'function') { K.notify('Sample import is not available'); return null; }
    let id = null;
    const io = { kind: multi ? 'multi' : 'sample', osc: o };
    if (rep) io.replace = rep;
    try { id = await H.import(fl, io); } catch (err) {
      console.warn('sx-ui-osc: sample import', err);
      if (!K.dead()) K.notify('Import failed: ' + (err && err.message ? err.message : err));
      return null;
    }
    if (K.dead() || !id) return null;
    if (rep) {
      // relinked: a multisample keeps its id, a sample takes the new file's; every cache of either (and of the user
      // multisamples whose zones it fills) is stale
      this.recs.clear(); this.ovs.clear(); this.specs.clear(); this.odfs.clear(); this.pcmDrop(); this.smpListC = {};
      const key = multi ? 'multi' : 'smp';
      if (id !== rep && this.s().osc[o][key] === rep) this.sampleEdit(o, s => { s.osc[o][key] = id; }, 'Relink sample');   // a host without the relink
      else { K.queue(); if (!multi && this.s().osc[o].smp === id) this.refreshAuto(o, 'Auto slices'); }
      K.notify('Relinked “' + this.smpName(id, multi ? 'multi' : 'sample') + '”');
      return id;
    }
    this.forgetAsset(id);
    if (multi) K.edit(s => { s.osc[o].multi = id; }, { label: 'Load multisample' });
    else this.sampleEdit(o, s => { s.osc[o].smp = id; s.osc[o].smpo.ops = { fade: 0, norm: 0, rev: 0, trim: null }; }, 'Load sample');
    return id;
  }
  // an edit of oscillator o's sample or its operations / slicing (fn(s)): Auto slicing marks recomputed in the same
  // step when the data is at hand (else cleared for a new sample and recomputed when it arrives, under the same label),
  // Auto-Sync to Clip re-sent (§2.2.3, §7.5.6)
  sampleEdit(o, fn, label) {
    const K = this.kit;
    let pend = false;
    K.edit(s => {
      const prev = s.osc[o].smp;
      fn(s);
      pend = this.autoInEdit(s, o, prev);
    }, { label });
    if (pend) this.refreshAuto(o, label);
  }
  bpm() { const H = this.kit.host; return H && typeof H.bpm === 'function' ? +H.bpm() || 120 : 120; }
  // Auto slicing marks of sample id at threshold thr under ops (§2.2.3, §9.4.5, §9.4.8), in processed coordinates; null
  // while the data is on its way (the requests start), [] when there is none
  autoMarksNow(id, thr, ops) {
    if (!id) return [];
    if (isWtId(id)) { const e = this.tableEntry(id); return e.info ? frameMarks(e.info.R, ops) : e.state === 'loading' ? null : []; }
    const re = this.recEntry(id), odf = this.odfNow(id);
    if (!re || re.state === 'loading' || odf === undefined) return null;
    const inf = this.smpInfo(id);
    return inf && odf ? onsetMarks(odf, thr, inf.rate, inf.len, 256, ops) : [];
  }
  // inside an edit (state s): oscillator o in Auto slicing gets the marks of what it now holds — when they are not at
  // hand yet, a new sample (≠ prevId) starts without marks (never the previous sample's) → true: refreshAuto follows.
  // Then Auto-Sync to Clip.
  autoInEdit(s, o, prevId) {
    const O = s.osc[o], sl = O && O.smpo && O.smpo.slice;
    if (!sl) return false;
    let pend = false;
    if ((sl.mode | 0) === 1) {
      const m = this.autoMarksNow(O.smp, sl.thr, O.smpo.ops);
      if (m) sl.marks = m;
      else { pend = true; if (prevId !== undefined && O.smp !== prevId) sl.marks = []; }
    }
    this.clipSync(s, o);
    return pend;
  }
  // Auto-Sync to Clip (§7.5.6): slicing on and ✓ sync → the selected clip from the marks (in place)
  clipSync(s, o) {
    const O = s.osc[o], sl = O.smpo.slice;
    if (!sl.sync || !sl.mode) return false;
    const info = this.smpInfo(O.smp);
    return !!info && clipFromSlices(s, sl, info, O.smpo.ops, this.bpm());
  }
  // the Auto marks once their data has arrived: one edit under `label` (serum-ui folds it into the triggering edit's undo
  // step when it arrives within the coalescing window), only if oscillator o still holds that sample in Auto mode
  async refreshAuto(o, label) {
    const O0 = this.s().osc[o], id = O0.smp;
    if (!id || (O0.smpo.slice.mode | 0) !== 1) return;
    if (isWtId(id)) await this.tableEntry(id).p;
    else { const re = this.recEntry(id); await Promise.all([re && re.p, this.odfEntry(id).p]); }
    if (this.kit.dead()) return;
    const O = this.s().osc[o], sl = O.smpo.slice;
    if (O.smp !== id || (sl.mode | 0) !== 1) return;
    const m = this.autoMarksNow(id, sl.thr, O.smpo.ops);
    if (!m || JSON.stringify(m) === JSON.stringify(sl.marks)) return;
    this.kit.edit(s => { s.osc[o].smpo.slice.marks = m; this.clipSync(s, o); }, { label: label || 'Auto slices' });
  }
  renameAsset(id, kind) {
    const K = this.kit, H = this.smpHost();
    if (!isUserAsset(id) || !H || typeof H.rename !== 'function') return;
    K.prompt(kind === 'multi' ? 'Rename Multisample' : 'Rename Sample', 'Name', this.smpName(id, kind), t => {
      const name = String(t).trim().slice(0, 64);
      if (!name) return false;
      Promise.resolve(H.rename(id, name)).then(() => { this.forgetAsset(id); K.queue(); },
        err => { console.warn('sx-ui-osc: rename', err); K.notify('Could not rename the sample'); });
      return true;
    });
  }
  deleteAsset(id, kind) {
    const K = this.kit, H = this.smpHost();
    if (!isUserAsset(id) || !H || typeof H.del !== 'function') return;
    const nm = this.smpName(id, kind), users = typeof H.users === 'function' ? arr(H.users(id)) : [];
    const also = users.length > 1 ? ' The tracks using it (' + users.join(', ') + ') lose it.' : '';
    if (!askConfirm(K.doc, 'Delete the user sample “' + nm + '” from this browser? This cannot be undone.' + also)) return;
    Promise.resolve(H.del(id)).then(ok => {
      if (K.dead()) return;
      this.forgetAsset(id);
      this.recs.clear();   // the user multisamples playing it now list it as missing (§9.9)
      K.notify(ok === false ? 'Could not delete “' + nm + '”' : 'Deleted “' + nm + '”');
      K.queue();
    }, err => { console.warn('sx-ui-osc: delete', err); if (!K.dead()) K.notify('Could not delete “' + nm + '”'); });
  }
  // Switch to Wavetable ▸ <import mode> (§13.3 Sample / Granular / Spectral / Multisample menus): the sample through
  // wt.tableFromWav into a new user table, the oscillator becomes a wavetable oscillator (one undo step). A wavetable
  // played as a sample switches back to that table.
  async switchToWavetable(o, mode) {
    const K = this.kit, s = this.s(), O = s.osc[o], H = this.smpHost(), W = K.host.wt, wt = K.wt || {};
    let id = O.type === 'multi' ? '' : O.smp;
    if (isWtId(id)) { K.edit(st => { st.osc[o].type = 'wt'; st.osc[o].wt = id; }, { label: 'Switch to Wavetable' }); return id; }
    if (!H || typeof H.pcm !== 'function' || typeof wt.tableFromWav !== 'function' || !W || !W.saveNew) { K.notify('Switch to Wavetable is not available'); return null; }
    try {
      if (O.type === 'multi') {
        if (typeof H.saveFrom !== 'function') { K.notify('Play a note first'); return null; }
        id = await H.saveFrom(o, 'sample');
        if (!id) { K.notify('Play a note first'); return null; }
      }
      if (!id) { K.notify('No sample loaded'); return null; }
      const p = await H.pcm(id);
      if (!p || !p.L) { K.notify('Sample not available'); return null; }
      const name = (this.smpName(id) || 'Sample').slice(0, 44);
      const table = wt.tableFromWav({ sr: p.rate, ch: p.R ? [p.L, p.R] : [p.L] }, { mode: mode || 'auto', name, channel: o === 1 && p.R ? 1 : 0 });
      table.name = name;
      const tid = await W.saveNew(table, name);
      if (K.dead() || !tid) return null;
      this.wtListC = null;
      K.edit(st => { st.osc[o].type = 'wt'; st.osc[o].wt = tid; }, { label: 'Switch to Wavetable' });
      K.notify(table.importMsg || 'Wavetable “' + name + '”');
      return tid;
    } catch (err) {
      console.warn('sx-ui-osc: switch to wavetable', err);
      if (!K.dead()) K.notify('Switch to Wavetable failed: ' + (err && err.message ? err.message : err));
      return null;
    }
  }
  // Switch to Single Sample (Multisample menu, inv B5): the recent voice's zone sample becomes a Sample oscillator
  async switchToSample(o) {
    const K = this.kit, H = this.smpHost();
    if (!H || typeof H.saveFrom !== 'function') { K.notify('Switch to Single Sample is not available'); return null; }
    let id = null;
    try { id = await H.saveFrom(o, 'sample'); } catch (err) { console.warn('sx-ui-osc: saveFrom', err); }
    if (K.dead()) return null;
    if (!id) { K.notify('Play a note first'); return null; }
    this.forgetAsset(id);
    this.sampleEdit(o, s => { s.osc[o].type = 'sample'; s.osc[o].smp = id; s.osc[o].smpo.ops = { fade: 0, norm: 0, rev: 0, trim: null }; }, 'Switch to Single Sample');
    return id;
  }

  /* ---------------------------------------------------------------- conversions (LFO ↔ tables), Render OSC Warp */
  // Alt-drag an LFO tile onto an oscillator display (A, B, C): one cycle of LFO l as a 1-frame user table (inv A13);
  // a non-wavetable oscillator also becomes a wavetable oscillator in the same edit (§13.3, one undo step)
  async lfoToWavetable(l, o) {
    const K = this.kit, W = K.host.wt, wt = K.wt || {};
    if (typeof wt.ptsToFrame !== 'function' || !W || !W.saveNew) { K.notify('LFO → wavetable is not available'); return; }
    const frame = wt.ptsToFrame(core.renderPts(this.s().lfo[l].pts, 1024)), name = 'LFO ' + (l + 1);
    const id = await W.saveNew({ name, frames: [frame], morph: 0, factory: 0 }, name);
    if (K.dead() || !id) return;
    this.wtListC = null;
    K.edit(s => { s.osc[o].wt = id; if (s.osc[o].type !== 'wt') s.osc[o].type = 'wt'; }, { label: 'LFO to wavetable' });
  }
  // drag an LFO tile onto the NOISE panel: the LFO cycle as a keytrack-ready user noise (inv A8)
  async lfoToNoise(l) {
    const K = this.kit, W = K.host.wt, wt = K.wt || {};
    if (typeof wt.lfoToNoise !== 'function' || !W || !W.saveNoise) { K.notify('LFO → noise is not available'); return; }
    const name = 'LFO ' + (l + 1), entry = wt.lfoToNoise(core.renderPts(this.s().lfo[l].pts, 1024), name);
    if (entry && typeof entry === 'object') entry.oneshot = 0;
    const id = await W.saveNoise(entry, name);
    if (K.dead() || !id) return;
    // a looping single cycle tuned to the root (§7.9): looped, key-tracked (choosing a source sets oneshot, §9.3)
    K.edit(s => { s.noise.src = id; s.noise.oneshot = 0; s.noise.keytrack = 1; s.p['n.on'] = 1; }, { label: 'LFO to noise' });
  }
  // Wavetable to LFO Shape (§9.3): oscillator o's frame at its base WT POS → ≤ 64 points, or null (with a notice);
  // the LFO edit itself is the caller's (serum-ui's LFO panel)
  lfoShape(o) {
    const K = this.kit, e = this.tableEntry(this.s().osc[o].wt), wt = K.wt || {};
    if (!e.info) { K.notify('Wavetable not loaded yet'); return null; }
    if (typeof wt.frameToPoints !== 'function') { K.notify('Wavetable to LFO Shape is not available'); return null; }
    return wt.frameToPoints(this.frameAt(e.info, K.getN(OSC_P[o] + '.wt')).slice(), 64);
  }
  // modulator cycle of a warp source for previews and Render OSC Warp (§6.6.6 at base values): the other oscillators'
  // base frames, the sub shape, seeded noise; filters and Self → null (rendered as without a modulator)
  modCycle(o, src) {
    const s = this.s(), wt = this.kit.wt || {};
    if (src === 'o1' || src === 'o2') return this.baseFrame(others(o)[src === 'o1' ? 0 : 1]);
    if (src === 'sub') {
      const legacy = s1Of(s), id = legacy ? core.SUB_IDS[Math.round(4 * this.kit.getN('s.shape'))] : (core.SUB_IDS2 || [])[Math.round(5 * this.kit.getN('s.shp'))];
      const t = id && typeof wt.factoryTable === 'function' ? wt.factoryTable(id) : null;
      return t && t.frames ? t.frames[0] : new Float32Array(2048);
    }
    if (src === 'noise') {
      const r = mulberry32(0x5EED), m = new Float32Array(2048);
      for (let i = 0; i < 2048; i++) m[i] = 2 * r() - 1;
      return m;
    }
    return null;
  }
  // The two warp slots of oscillator o as the main-thread renders read them (§6.6.9, §13.3.1): [slot 1, slot 2], each
  // { mode (WARPS2), w, v, fm, src (warpSrc), legacy? } or null for Off — a spectral mode on a non-Spectral oscillator
  // acts as Off (§3.4.2). Base values; live = the eff amounts / Vars while notes sound (the 2D preview). S1 mode, OSC A /
  // B: slot 1 is the legacy slot as its S2 rendition (S1_TO_S2_WARP, exact except Sync 1/2 Win.; legacy = v1 index).
  warpSlots(o, live) {
    const K = this.kit, s = this.s(), k = oscIdx(o), P = OSC_P[k], fm = arr(s.osc[k].fm), ty = core.oscTypeOf(s, k);
    const val = id => (live ? this.liveN(id) : K.getN(id));
    const avail = m => m > 0 && m < WARPS2.length && !(WARPS2[m].avail === 'Sp' && ty !== 'spec');
    const slot = j => {
      const m = Math.round(81 * K.getN(P + (j ? '.w2' : '.w1')));
      return avail(m) ? { mode: m, w: val(P + (j ? '.warp2' : '.warp')), v: val(P + (j ? '.wvar2' : '.wvar1')), fm: fm[j] | 0, src: warpSrc(m) } : null;
    };
    let a = slot(0);
    if (k < 2 && s1Of(s)) {
      const lm = Math.round(22 * K.getN(P + '.warpMode')), e = lm > 0 && Array.isArray(core.S1_TO_S2_WARP) ? core.S1_TO_S2_WARP[lm] : null;
      a = e && avail(e[0]) ? { mode: e[0], w: val(P + '.warp'), v: e[1], fm: 0, src: warpSrc(e[0]), legacy: lm } : null;
    }
    return [a, slot(1)];
  }
  // whether Render OSC Warp applies to oscillator o (§13.3.1: a wavetable oscillator with a slot that is not (acting)
  // Off; both Off ⇒ the main-menu item is disabled)
  canRenderWarp(o) {
    const s = this.s(), k = oscIdx(o);
    if (!s || !s.osc || core.oscTypeOf(s, k) !== 'wt') return false;
    const sl = this.warpSlots(k, false);
    return !!(sl[0] || sl[1]);
  }
  // One cycle of `frame` through the slots sl = [slot 1, slot 2] (warpSlots) in the voice's order (§6.6.1: F stages,
  // P stages slot 1 then slot 2, read, windows, O stages slot 1 then slot 2) → Float32Array(2048·over), or null without
  // SxWarp. Each slot reads its own modulator (modCycle; PD (Self) and the filters none here). One renderWarp2 pass when
  // at most one modulator is read; with two different ones, two passes where that is exact — an output-domain slot run
  // on the other slot's band-limited result (the first pass at over 4) — else one pass with slot 1's modulator
  // (renderWarp2 takes one modulator for both slots). The legacy Sync 1/2 Win. (no exact S2 rendition) renders through
  // SerumDSP.renderWarp, then slot 2 on its band-limited result when slot 2 is not a phase-domain warp (exact: F and O
  // stages commute with it); with a phase-domain slot 2, its S2 rendition (Sync, Var ½) is used.
  warpCycle(o, frame, sl, over, remap) {
    const X = sxw(), S = dsp(), wt = this.kit.wt || {}, k = oscIdx(o);
    const key = x => (x && x.src && x.src !== 'self' ? x.src : '');
    const [a, b] = sl;
    if (!X || typeof X.renderWarp2 !== 'function') {   // without SxWarp: a lone legacy slot through the Phase-1 renderer
      return a && a.legacy && !b && S && typeof S.renderWarp === 'function' ? S.renderWarp(frame, a.legacy, a.w, { over, remap, mod: this.modCycle(k, key(a)) }) : null;
    }
    const dom = m => (m > 0 && X.META && X.META.dom ? X.META.dom[m] : 0);   // SxWarp.DOM: 1 F, 2 P, 3 O
    const bl = y => (y && typeof wt.bandlimit === 'function' ? wt.bandlimit(y, 4) : null);
    const bare = x => (x ? { mode: x.mode, w: x.w, v: x.v, fm: x.fm } : null);
    const pass = (fr, A, B, mod, ov) => X.renderWarp2(fr, [bare(A), bare(B)], { over: ov, remap, mod: mod || null, osc: k });
    if (a && a.legacy === 2 && S && typeof S.renderWarp === 'function' && !(b && dom(b.mode) === 2)) {
      if (!b) return S.renderWarp(frame, 2, a.w, { over, remap });
      const y = bl(S.renderWarp(frame, 2, a.w, { over: 4, remap }));
      return y ? pass(y, null, b, this.modCycle(k, key(b)), over) : null;
    }
    const ka = key(a), kb = key(b), ma = ka ? this.modCycle(k, ka) : null, mb = kb ? this.modCycle(k, kb) : null;
    if (!ka || !kb || ka === kb) return pass(frame, a, b, ka ? ma : mb, over);
    if (dom(b.mode) === 3) { const y = bl(pass(frame, a, null, ma, 4)); return y ? pass(y, null, b, mb, over) : null; }
    if (dom(a.mode) === 3) { const y = bl(pass(frame, null, b, mb, 4)); return y ? pass(y, a, null, ma, over) : null; }
    return pass(frame, a, b, ma, over);
  }
  // Render OSC Warp v2 (§13.3.1): 256 frames, frame f = the oscillator's base frame with WARP 1 at absolute amount f/255
  // (WARP 1's mode, Var, FM type and modulator and the whole WARP 2 slot, modulator included, at base); WARP 1 (acting)
  // Off ⇒ WARP 2 is swept. S1 mode, OSC A / B: the v1 slot-1 mode in slot 1 (warpSlots / warpCycle: the voice's order),
  // slot 2 at base. Every frame is rendered at over 4 and band-limited, the table saved as "<name> warp" and loaded into
  // the oscillator, and the swept slot set Off (S1 pairs synced).
  async renderOscWarp(o) {
    const K = this.kit, X = sxw(), W = K.host.wt, wt = K.wt || {}, s = this.s(), k = oscIdx(o), P = OSC_P[k];
    if (typeof wt.bandlimit !== 'function' || !W || !W.saveNew || !X || typeof X.renderWarp2 !== 'function' || core.oscTypeOf(s, k) !== 'wt') {
      K.notify('Render OSC Warp is not available'); return;
    }
    const sl = this.warpSlots(k, false);
    if (!sl[0] && !sl[1]) { K.notify('Choose a warp mode first'); return; }
    const e = this.tableEntry(s.osc[k].wt);
    if (!e.info) { K.notify('Wavetable not loaded yet'); return; }
    // a modulator from another wavetable oscillator must be at hand
    for (const x of sl) {
      if (!x || (x.src !== 'o1' && x.src !== 'o2')) continue;
      const j = others(k)[x.src === 'o1' ? 0 : 1];
      if (core.oscTypeOf(s, j) === 'wt' && !this.baseFrame(j)) { K.notify('The other oscillator’s wavetable is not loaded yet'); return; }
    }
    const frame = this.frameAt(e.info, K.getN(P + '.wt')).slice(), remap = this.remapTab(k), sweep = sl[0] ? 0 : 1, legacy = !!(sl[0] && sl[0].legacy);
    K.notify('Rendering warp…');
    const frames = [];
    try {
      for (let f = 0; f < 256; f++) {
        const cur = sl.slice();
        cur[sweep] = Object.assign({}, sl[sweep], { w: f / 255 });
        const fr = this.warpCycle(k, frame, cur, 4, remap);
        if (!fr) throw new Error('no render');
        frames.push(wt.bandlimit(fr, 4));
        if ((f & 15) === 15) await new Promise(r => setTimeout(r, 0)); // short slices: the page stays responsive
        if (K.dead()) return;
      }
    } catch (err) {
      console.warn('sx-ui-osc: render warp', err);
      K.notify('Render OSC Warp failed');
      return;
    }
    const name = (e.info.table.name || nameOfId(s.osc[k].wt)) + ' warp';
    const id = await W.saveNew({ name, frames, morph: 0, factory: 0 }, name);
    if (K.dead() || !id) return;
    this.wtListC = null;
    K.edit(st => {
      st.osc[k].wt = id;
      const off = legacy && sweep === 0 ? P + '.warpMode' : P + (sweep ? '.w2' : '.w1');
      st.p[off] = 0;
      if (typeof core.syncS1 === 'function') core.syncS1(st, off);
    }, { label: 'Render OSC Warp' });
    K.notify('Rendered “' + name + '”');
  }

  /* ---------------------------------------------------------------- noise overview */
  noiseOverview(id) {
    if (this.noiseOv.has(id)) return this.noiseOv.get(id);
    this.noiseOv.set(id, null);
    const K = this.kit;
    const build = L => {
      if (!L || !L.length) return;
      const n = 256, mm = new Float32Array(2 * n), per = L.length / n;
      for (let c = 0; c < n; c++) {
        let lo = 0, hi = 0;
        for (let i = Math.floor(c * per), e = Math.min(L.length, Math.floor((c + 1) * per) + 1); i < e; i++) { const v = L[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        mm[2 * c] = lo; mm[2 * c + 1] = hi;
      }
      this.noiseOv.set(id, mm);
      K.queue();
    };
    if (/^color:/.test(id)) {   // generated colour noises (§6.11.2): a deterministic preview of their spectral tilt
      const r = mulberry32(0xC0105 + id.length), L = new Float32Array(4096), kind = id.slice(6);
      let y = 0, b = 0;
      for (let i = 0; i < L.length; i++) {
        const w = 2 * r() - 1;
        if (kind === 'Brown') { y = 0.98 * y + 0.2 * w; L[i] = y; } else if (kind === 'Pink') { b = 0.9 * b + 0.3 * w; L[i] = 0.5 * (w + b); }
        else if (kind === 'Geiger') L[i] = r() < 0.004 ? (r() < 0.5 ? -1 : 1) * (0.5 + 0.5 * r()) : 0;
        else L[i] = w * 0.7;
      }
      build(L);
      return this.noiseOv.get(id);
    }
    const pick = rr => {
      if (!rr) return null;
      if (rr.levels && rr.levels[0]) return rr.levels[0].L;
      if (rr.L) return ArrayBuffer.isView(rr.L) ? rr.L : rr.L instanceof ArrayBuffer ? new Float32Array(rr.L) : null;
      return null;
    };
    // factory sources: generated once per page (deterministic content, shared by every panel set) with
    // wt.generateNoise (source only: no mip levels, no copies), when the browser is idle and only if the id is
    // still the selected source (arrowing through the menu does not generate every noise on the way)
    const factory = /^noise:/.test(id);
    if (factory && NOISE_OV.has(id)) { this.noiseOv.set(id, NOISE_OV.get(id)); return NOISE_OV.get(id); }
    const run = () => {
      if (K.dead()) return;
      if (factory && this.s().noise.src !== id) { this.noiseOv.delete(id); return; }
      try {
        const wt = K.wt || {}, gen = typeof wt.generateNoise === 'function' ? wt.generateNoise : typeof wt.makeNoise === 'function' ? wt.makeNoise : null;
        if (factory && gen) {
          build(pick(gen(id)));
          if (this.noiseOv.get(id)) NOISE_OV.set(id, this.noiseOv.get(id));
          return;
        }
      } catch (err) { warnOnce('nz' + id, 'sx-ui-osc: noise overview', err); }
      const w = K.host.wt;
      if (w && w.get) Promise.resolve(w.get(id)).then(rr => build(pick(rr)), () => {});
    };
    const win = K.doc.defaultView, ric = win && win.requestIdleCallback;
    if (factory && typeof ric === 'function') ric.call(win, run, { timeout: 300 }); else setTimeout(run, factory ? 120 : 0);
    return null;
  }
}

/* ================================================================ shared module pieces (route, note ranges, label drag) */

// Routing popover (§13.3 routing button; §13.4 strip semantics) of a channel: R = { key, title, obj: s → channel object
// (osc[i] / sub / noise / filter[k]), routes: labels, fbal: balance id | null, bus: [id1, id2], filter: k | undefined }.
// → { btn, pane }. The button shows the route (F1 / F2 / F1+F2, MAIN, DIRECT, NONE; filters → F1 / → F2).
function routeControls(K, R) {
  const d = K.doc, pane = paneEl(d), get = () => R.obj(K.s());
  const filt = R.filter !== undefined;
  const seg = pSeg(K, { label: 'ROUTE', items: R.routes, get: () => get().route | 0,
    set: i => K.edit(s => {
      R.obj(s).route = i;
      // both filters feeding each other is impossible (§2.2.5): the other filter goes to Main (most recent choice wins)
      if (filt && i === 0 && s.filter[1 - R.filter].route === 0) s.filter[1 - R.filter].route = 1;
    }, { label: R.title + ' routing' }) });
  const bal = R.fbal ? K.knob(R.fbal, { label: 'BALANCE', size: 'sm', disabled: () => get().route !== 0 }) : null;
  const env = pToggle(K, { label: 'ENV', kind: 'btn', get: () => (get().env ? 1 : 0), disabled: () => !(get().route === 1 || get().route === 2),
    set: v => K.edit(s => { R.obj(s).env = v ? 1 : 0; }, { label: R.title + ' ENV' }) });
  env.el.title = 'ENV 1 gates this channel on Main / Direct';
  pane.append(row(d, seg.el), row(d, bal && bal.el, env.el, K.knob(R.bus[0], { label: 'BUS 1', size: 'sm' }).el, K.knob(R.bus[1], { label: 'BUS 2', size: 'sm' }).el));
  const b = btn(d, 'sx-hbtn sxo-rbtn', '', R.title + ' routing', () => openPane(K, R.key, b, R.title + ' routing', pane));
  K.custom(() => {
    const x = get(), r = x.route | 0;
    let t = ['', 'MAIN', 'DIRECT', 'NONE'][r];
    if (r === 0) {
      if (filt) t = R.filter ? '→ F1' : '→ F2';
      else { const v = 2 * K.getN(R.fbal) - 1; t = v <= -0.995 ? 'F1' : v >= 0.995 ? 'F2' : 'F1+F2'; }
    }
    if (b.textContent !== t) b.textContent = t;
    if (b.getAttribute('data-route') !== String(r)) b.setAttribute('data-route', String(r));
  });
  return { btn: b, pane, seg };
}
// OSC MAPPING of one channel (§13.9 rows; the module menu's "Edit Note Ranges…"): KEY / VEL range bars, FOLD, WARP
// (the popover pane; built with its panel)
function mapPane(K, title, obj) {
  const d = K.doc, pane = paneEl(d), get = () => obj(K.s()).map;
  const rb = (key, min, label, fmt) => K.bind(wk.rangeBar({ label, min, max: 127, get: () => get()[key].slice(),
    set: (r, ph) => K.edit(s => { obj(s).map[key] = [r[0], r[1]]; }, { label: title + ' ' + label.toLowerCase() + ' range', phase: ph }), fmt }));
  const tg = (key, label, tip) => {
    const w = pToggle(K, { label, kind: 'btn', get: () => (get()[key] ? 1 : 0), set: v => K.edit(s => { obj(s).map[key] = v ? 1 : 0; }, { label: title + ' ' + label.toLowerCase() }) });
    w.el.title = tip;
    return w.el;
  };
  pane.append(rb('k', 0, 'KEY', noteName).el, rb('v', 1, 'VEL').el,
    row(d, tg('fold', 'FOLD', 'Fold notes outside the key range back into it by octaves'), tg('warp', 'WARP', 'Stays available as a warp modulator outside its ranges')));
  return pane;
}

/* ================================================================ OSC A / B / C (§13.3) */

// Base of the oscillator type views: new XView(root, kit, o) builds `el` (+ `head`) and appends el to root; shown only
// when oscillator o has the view's type (static type of the class: new.target.type)
class TypeView {
  constructor(root, kit, o) {
    this.kit = kit;
    this.o = oscIdx(o);
    this.P = OSC_P[this.o];
    this.type = new.target.type;
    this.D = oscData(kit);
    this.head = [];                   // elements for the panel's title row (OscPanel appends them there)
    this.shown = true;
    ensureCSS(kit.doc);
    this.el = mk(kit.doc, 'div', 'sx-pbody sx-oview');
    this.el.setAttribute('data-otype', this.type);
    this.build();
    if (root) root.appendChild(this.el);
    this.show(this.active());
  }
  O() { return this.kit.s().osc[this.o]; }
  active() { return core.oscTypeOf(this.kit.s(), this.o) === this.type; }
  // visibility through the inline display (independent of the sx-hidden state the head buttons keep themselves)
  show(on) {
    const v = on ? '' : 'none';
    this.shown = !!on;
    if (this.el.style.display !== v) this.el.style.display = v;
    for (const h of this.head) if (h && h.style && h.style.display !== v) h.style.display = v;
  }
  build() {}
  key() { return 'off'; }
  menuItems() { return []; }
  kn(id, label, size, extra) { return this.kit.knob(this.P + '.' + id, Object.assign(size ? { label, size } : { label }, extra)).el; }
  // the panel's ⋯ menu entries "Switch to Wavetable ▸ <import mode>"
  switchItems() {
    const W = this.kit.wt, modes = W && Array.isArray(W.IMPORT_MODES) ? W.IMPORT_MODES.filter(m => m !== 'clm') : ['auto'];
    return [{ label: 'Switch to Wavetable', sub: modes.map(m => ({ label: IMPORT_LABELS[m] || m, action: () => this.D.switchToWavetable(this.o, m) })) }];
  }
}

/* ---------------------------------------------------------------- Wavetable view */

export class WTView extends TypeView {
  static get type() { return 'wt'; }
  // the warp slots the display previews: { legacy (S1 slot 1 of A / B: a.warpMode index), s1, s2: WARPS2 modes }
  build() {
    const K = this.kit, D = this.D, d = K.doc, o = this.o, P = this.P, T = OSC_T[o];
    const wtm = K.bind(wk.menu({ label: T + ' wavetable', items: () => D.wtItems(o), get: () => K.s().osc[o].wt, arrows: true, stepGroup: true,
      set: v => K.edit(s => { s.osc[o].wt = v; }, { label: 'Wavetable' }) }));
    wtm.el.classList.add('sx-grow', 'sxo-src');
    const ren = btn(d, 'sx-hbtn', 'Rename', 'Rename user wavetable', () => D.renameTable(o));
    K.custom(() => ren.classList.toggle('sx-hidden', !D.canRename(K.s().osc[o].wt)));
    const del = btn(d, 'sx-hbtn', icon(d, 'trash'), 'Delete user wavetable', () => D.deleteUser(false, o));
    K.custom(() => del.classList.toggle('sx-hidden', !D.canDelete(K.s().osc[o].wt, false)));
    const edb = btn(d, 'sx-hbtn', icon(d, 'zoom'), 'Open wavetable editor (' + T + ')', () => K.openWtEditor(o));
    this.head.push(wtm.el, ren, del, edb);
    const cv = K.canvas('sx-tall', () => this.key(), (g, w, h, dpr) => this.draw(g, w, h, dpr));
    cv.el.setAttribute('data-oscdisp', String(o));
    cv.el.tabIndex = 0;
    cv.el.setAttribute('role', 'button');
    cv.el.setAttribute('aria-label', T + ' wavetable display: click to switch 2D / 3D; drop a WAV or PNG to import');
    const flip = () => uiEdit(K, s => { s.ui.view3d[o] = s.ui.view3d[o] ? 0 : 1; });
    cv.el.addEventListener('click', flip);
    cv.el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
    fileDrop(cv.el, files => D.importTableFiles(o, files));
    // WT POS (✓ Smooth Interpolation), PHASE (phase memory, ✓ Phase Legato, New MemTrig phase set), RAND, MEM menu
    const pos = extraMenu(this.kn('wt', 'WT POS'), () => [{ label: 'Smooth Interpolation', checked: !!this.O().smoothWT,
      action: () => K.edit(s => { s.osc[o].smoothWT = s.osc[o].smoothWT ? 0 : 1; }, { label: 'Smooth Interpolation' }) }]);
    const ph = extraMenu(this.kn('phase', 'PHASE', 'sm'), () => this.phaseItems());
    const mem = pMenu(K, { label: 'MEM', items: () => PHASE_MEM.map(m => ({ v: m.id, label: m.name })), get: () => this.O().phMem,
      set: v => this.setPhMem(v) });
    mem.el.title = 'Phase memory';
    K.custom(() => { const dis = o < 2 && s1Of(K.s()); mem.el.classList.toggle('wk-dis', dis); mem.el.title = dis ? 'S1 mode: Mem / MemTrig at the PHASE / RAND knob ends' : 'Phase memory'; });
    this.el.append(cv.el, row(d, pos, ph, this.kn('rand', 'RAND', 'sm'), mem.el));
  }
  setPhMem(v) {
    const K = this.kit, o = this.o;
    if (o < 2 && s1Of(K.s())) { K.notify('S1 mode: OSC ' + 'AB'[o] + ' uses the PHASE / RAND knob ends (Mem / MemTrig)'); return; }
    K.edit(s => { s.osc[o].phMem = v; }, { label: 'Phase memory' });
  }
  phaseItems() {
    const K = this.kit, o = this.o, O = this.O(), legacy = o < 2 && s1Of(K.s());
    return PHASE_MEM.map(m => ({ label: m.name, checked: O.phMem === m.id, disabled: legacy, action: () => this.setPhMem(m.id) })).concat([
      { sep: true },
      { label: 'Phase Legato', checked: !!O.phLegato, action: () => K.edit(s => { s.osc[o].phLegato = s.osc[o].phLegato ? 0 : 1; }, { label: 'Phase Legato' }) },
      { label: 'New MemTrig phase set', action: () => K.edit(s => { s.osc[o].memSet = memTrigSet(Date.now() + o); }, { label: 'New MemTrig phase set' }) },
    ]);
  }
  // the 2D preview's warp: S1 mode slot 1 of A / B through SerumDSP.renderWarp (Phase-1 modes 1–17), then the S2 slots of
  // the Sync / Alt / Filter / Distortion categories (WARPS2 1–32) through SxWarp.renderWarp2 (§13.3 "2D view shows both
  // slots' effect for Sync/Alt/Distortion")
  warpSig() {
    const K = this.kit, D = this.D, o = this.o, P = this.P, legacy = o < 2 && s1Of(K.s());
    const m1 = legacy ? Math.round(22 * K.getN(P + '.warpMode')) : Math.round(81 * K.getN(P + '.w1')), m2 = Math.round(81 * K.getN(P + '.w2'));
    return [legacy ? 1 : 0, m1, D.liveN(P + '.warp').toFixed(4), m2, D.liveN(P + '.warp2').toFixed(4), D.liveN(P + '.wvar1').toFixed(3),
      D.liveN(P + '.wvar2').toFixed(3), (legacy ? m1 >= 13 && m1 <= 16 : isRemap2(m1)) || isRemap2(m2) ? JSON.stringify(K.s().osc[o].remap) : ''].join(',');
  }
  // the slots previewed are those of the Sync / Alt / Filter / Distortion categories (WARPS2 1–32; the legacy slot's S2
  // rendition), through the same voice-order path as Render OSC Warp (OscData.warpCycle) at over 1
  warped(fr) {
    const D = this.D, o = this.o, sl = D.warpSlots(o, true).map(x => (x && x.mode >= 1 && x.mode <= 32 ? x : null));
    if (!sl[0] && !sl[1]) return fr;
    try { return D.warpCycle(o, fr, sl, 1, D.remapTab(o)) || fr; } catch (err) { warnOnce('rw2', 'sx-ui-osc: warp preview failed', err); return fr; }
  }
  key() {
    if (!this.active()) return 'off';
    const K = this.kit, D = this.D, o = this.o, s = K.s(), P = this.P, e = D.tableEntry(s.osc[o].wt);
    return [s.osc[o].wt, e.state, s.ui.view3d[o], D.livePos(o).toFixed(4), this.warpSig(),
      K.getN(P + '.uni'), K.getN(P + '.det').toFixed(3), s.osc[o].uni.mode, K.getN(P + '.on'),
      K.dragging(P + '.phase') ? K.getN(P + '.phase').toFixed(3) : '', dsp() ? 1 : 0, sxw() ? 1 : 0].join('|');
  }
  draw(g, w, h, dpr) {
    const K = this.kit, D = this.D, o = this.o, s = K.s(), P = this.P, e = D.tableEntry(s.osc[o].wt);
    g.strokeStyle = C.line; g.lineWidth = dpr;
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    g.font = Math.round(10 * dpr) + 'px ui-monospace, monospace';
    if (e.state !== 'ok') {
      g.fillStyle = C.mute;
      g.fillText(e.state === 'loading' ? 'Loading…' : 'Wavetable not found: ' + nameOfId(s.osc[o].wt), 8 * dpr, 16 * dpr);
      return;
    }
    const info = e.info, pos = D.livePos(o);
    const cur = info.interp ? Math.round(pos * (info.F - 1)) : Math.min(info.F - 1, Math.floor(pos * info.F));
    if (s.ui.view3d[o]) this.draw3d(g, w, h, dpr, info, cur);
    else {
      const fr = this.warped(D.frameAt(info, pos));
      const n = fr.length, amp = h * 0.42;
      g.beginPath();
      for (let x = 0; x <= w; x++) { const y = h / 2 - fr[Math.min(n - 1, Math.floor(x / w * n))] * amp; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
      g.strokeStyle = OSC_COL[o]; g.lineWidth = 1.6 * dpr; g.stroke();
      g.lineTo(w, h / 2); g.lineTo(0, h / 2); g.closePath();
      g.fillStyle = 'rgba(89, 194, 255, 0.10)'; g.fill();
      if (K.dragging(P + '.phase')) {
        const x = Math.min(0.99999, K.getN(P + '.phase')) * w;
        g.strokeStyle = C.cur; g.lineWidth = 1.5 * dpr;
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      }
    }
    drawStalks(K, o, g, w, h, dpr);
    g.fillStyle = C.mute;
    g.fillText((cur + 1) + ' / ' + info.F, 6 * dpr, h - 6 * dpr);
  }
  draw3d(g, w, h, dpr, info, cur) {
    const D = this.D, F = info.F, R = info.R || F, dx = w * 0.26, dy = h * 0.4, fw = w * 0.72, amp = h * 0.2;
    const line = (fr, z, col, lw) => {
      const x0 = z * dx, y0 = h * 0.7 - z * dy, n = fr.length, steps = Math.max(32, Math.round(fw / (2 * dpr)));
      g.beginPath();
      for (let j = 0; j <= steps; j++) {
        const x = x0 + j / steps * fw, y = y0 - fr[Math.min(n - 1, Math.floor(j / steps * n))] * amp;
        if (j) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.strokeStyle = col; g.lineWidth = lw; g.stroke();
    };
    for (const L of layers3d(F, R)) {   // back to front; real frames green, interpolated slots grey (§9.3)
      const fr = L.real && F !== R ? info.table.frames[L.frame] : D.slotFrame(info, L.slot);
      line(fr, L.z, L.real ? 'rgba(111, 227, 161, 0.55)' : 'rgba(127, 139, 152, 0.35)', dpr);
    }
    line(D.slotFrame(info, cur), F > 1 ? cur / (F - 1) : 0, C.cur, 1.8 * dpr);
  }
}
// unison detune "stalks" at the bottom of a display (inv A3)
function drawStalks(K, o, g, w, h, dpr) {
  const s = K.s(), P = OSC_P[o], N = Math.round(core.lawValue(P + '.uni', K.getN(P + '.uni')));
  if (N < 2) return;
  const det = core.lawValue(P + '.det', K.getN(P + '.det')), mode = s.osc[o].uni.mode;
  g.strokeStyle = 'rgba(79, 179, 255, 0.85)'; g.lineWidth = 1.5 * dpr;
  for (let i = 0; i < N; i++) {
    const t = 2 * i / (N - 1) - 1, v = mode === 4 ? t : core.detuneShape(mode, t), x = w / 2 + v * Math.max(det, 0.02) * w * 0.44;
    g.beginPath(); g.moveTo(x, h - 2 * dpr); g.lineTo(x, h - (i === (N - 1) / 2 ? 14 : 9) * dpr); g.stroke();
  }
}

/* ---------------------------------------------------------------- Multisample view (inv B5) */

export class MultiView extends TypeView {
  static get type() { return 'multi'; }
  build() {
    const K = this.kit, D = this.D, d = K.doc, o = this.o, P = this.P, T = OSC_T[o];
    this.sel = -1;                    // zone whose waveform is shown (−1: the zone map)
    this.last = { id: '', z: -1 };    // the last-played zone of the instrument (snapshot.zone, kept after the release)
    const im = K.bind(wk.menu({ label: T + ' instrument', items: () => D.smpItems('multi', this.O().multi), get: () => this.O().multi, arrows: true, stepGroup: true,
      set: v => { D.dropMissing(v); K.edit(s => { s.osc[o].multi = v; }, { label: 'Instrument' }); } }));
    im.el.classList.add('sx-grow', 'sxo-src');
    const load = btn(d, 'sx-hbtn', icon(d, 'folder'), 'Load SFZ / ZIP (' + T + ')', () => this.load());
    const ren = btn(d, 'sx-hbtn', 'Rename', 'Rename user multisample', () => D.renameAsset(this.O().multi, 'multi'));
    const del = btn(d, 'sx-hbtn', icon(d, 'trash'), 'Delete user multisample', () => D.deleteAsset(this.O().multi, 'multi'));
    const emb = mk(d, 'span', 'sxo-badge', 'EMBED');
    emb.title = 'User multisamples are embedded in exported presets and projects';
    // §9.9: a deleted user multisample (or deleted zone samples of one) — the badge relinks (tap: file picker; drop)
    const miss = btn(d, 'sx-hbtn sxo-miss', 'Missing sample', 'Missing sample: choose or drop a file to relink', () => this.relinkPick());
    fileDrop(miss, files => this.relink(files));
    K.custom(() => {
      const u = isUserAsset(this.O().multi), m = !!this.relinkTarget();
      hide(ren, !u); hide(del, !u); hide(emb, !u || m); hide(miss, !m);
      const t = this.missText();
      if (miss.textContent !== t) miss.textContent = t;
    });
    this.head.push(im.el, load, ren, del, emb, miss);
    const cv = K.canvas('sx-tall', () => this.key(), (g, w, h, dpr) => this.draw(g, w, h, dpr));
    this.cv = cv;
    cv.el.setAttribute('data-oscdisp', String(o));
    cv.el.tabIndex = 0;
    cv.el.setAttribute('role', 'button');
    cv.el.setAttribute('aria-label', T + ' zone map: click a zone to show its waveform, click again for the map; drop SFZ / ZIP / audio files to import');
    cv.el.addEventListener('click', e => this.click(e));
    fileDrop(cv.el, files => (this.relinkTarget() ? this.relink(files) : D.importSamples(o, files, 'multi')));
    // envelope popover: OVERRIDE, DELAY (BPM sync), A H D S R + draggable graph
    const envPane = paneEl(d);
    const ov = pToggle(K, { label: 'OVERRIDE', kind: 'btn', get: () => (this.O().msmo.override ? 1 : 0),
      set: v => K.edit(s => { s.osc[o].msmo.override = v ? 1 : 0; }, { label: 'Multisample envelope override' }) });
    ov.el.title = 'Replace the SFZ envelopes with these';
    // BPM Sync converts the delay to the nearest ladder entry / back to time (serum-core setMsDelayBpm, §6.14 rule)
    const dly = extraMenu(this.kn('mdly', 'DELAY', 'sm'), () => [{ label: 'BPM Sync', checked: !!this.O().msmo.dlyBpm,
      action: () => K.edit(s => {
        const on = !s.osc[o].msmo.dlyBpm;
        if (typeof core.setMsDelayBpm === 'function') core.setMsDelayBpm(s, o, on, D.bpm()); else s.osc[o].msmo.dlyBpm = on ? 1 : 0;
      }, { label: 'Delay BPM sync' }) }]);
    const ecv = K.canvas('sxo-mini', () => this.envKey(), (g, w, h, dpr) => this.drawEnv(g, w, h, dpr));
    ecv.el.setAttribute('role', 'img');
    ecv.el.setAttribute('aria-label', 'Multisample envelope: drag the corners');
    this.envDrag(ecv.el);
    envPane.append(row(d, ov.el, dly), ecv.el, row(d, this.kn('matt', 'A', 'sm'), this.kn('mhold', 'H', 'sm'), this.kn('mdec', 'D', 'sm'), this.kn('msus', 'S', 'sm'), this.kn('mrel', 'R', 'sm')));
    const eb = btn(d, 'sx-hbtn', icon(d, 'env'), 'Multisample envelope (' + T + ')', () => openPane(K, 'menv' + o, eb, T + ' envelope', envPane));
    this.el.append(cv.el, row(d, eb, K.num(P + '.mvel', { label: 'VEL TRACK' }).el, K.num(P + '.mrand', { label: 'RAND' }).el, this.kn('timbre', 'TIMBRE', 'sm')));
  }
  load() {
    pickFiles(this.kit.doc, '.sfz,.zip,' + AUDIO_ACCEPT, true).then(fl => (this.relinkTarget() ? this.relink(fl) : this.D.importSamples(this.o, fl, 'multi')));
  }
  menuItems() {
    return [{ label: 'Switch to Single Sample', action: () => this.D.switchToSample(this.o) }].concat(this.switchItems());
  }
  zones() { const r = this.D.record(this.O().multi); return r && Array.isArray(r.zones) ? r.zones : []; }
  // zone samples of a user multisample deleted from the store (the record's `missing` list, §9.9)
  missingZones() { const r = this.D.record(this.O().multi); return r && Array.isArray(r.missing) ? r.missing : []; }
  // what a drop / the badge relinks (§9.9): the deleted user multisample itself, else a deleted zone sample (the shown
  // zone's when it is one of them, else the first) → { id, kind } | null
  relinkTarget() {
    const id = this.O().multi;
    if (this.D.isMissing(id)) return { id, kind: 'multi' };
    const M = this.missingZones();
    if (!M.length) return null;
    const z = this.sel >= 0 ? this.zones()[this.sel] : null;
    return { id: z && M.includes(z.smp) ? z.smp : M[0], kind: 'sample' };
  }
  missText() { const n = this.D.isMissing(this.O().multi) ? 1 : this.missingZones().length; return n > 1 ? 'Missing samples: ' + n : 'Missing sample'; }
  relinkPick() {
    const t = this.relinkTarget();
    if (t) pickFiles(this.kit.doc, (t.kind === 'multi' ? '.sfz,.zip,' : '') + AUDIO_ACCEPT, t.kind === 'multi').then(fl => this.relink(fl));
  }
  relink(files) {
    const t = this.relinkTarget();
    if (!arr(files).length) return null;
    return t ? this.D.importSamples(this.o, files, t.kind, { replace: t.id }) : this.D.importSamples(this.o, files, 'multi');
  }
  // the zone of the recent voice (snapshot.zone) while notes sound, then the last one played on this instrument
  hot() {
    const sn = this.kit.snap(), id = this.O().multi, z = sn && sn.zone && fin(sn.zone[this.o]) ? sn.zone[this.o] : -1;
    if (sn && sn.notes > 0 && z >= 0) { if (this.last.id !== id || this.last.z !== z) this.last = { id, z }; return z; }
    return this.last.id === id && this.last.z < this.zones().length ? this.last.z : -1;
  }
  // tap (inv B5): the waveform of the last-played zone (before any note: the zone under the finger); again: the map
  click(e) {
    const r = this.cv.el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (this.sel >= 0) { this.sel = -1; this.kit.queue(); return; }
    const h = this.hot();
    if (h >= 0) { this.sel = h; this.kit.queue(); return; }
    const L = zoneMapLayout(this.zones(), r.width, r.height, -1);
    for (let i = L.length - 1; i >= 0; i--) {
      const z = L[i];
      if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) { this.sel = z.i; this.kit.queue(); return; }
    }
  }
  key() {
    if (!this.active()) return 'off';
    const id = this.O().multi, z = this.zones(), zs = this.sel >= 0 && z[this.sel] ? z[this.sel].smp : '', re = this.D.recEntry(id);
    return [id, z.length, this.hot(), this.sel, zs, zs && this.D.overview(zs) ? 1 : 0, re ? re.state : '', this.missingZones().join(',')].join('|');
  }
  draw(g, w, h, dpr) {
    const D = this.D, o = this.o, id = this.O().multi, Z = this.zones(), M = this.missingZones();
    g.font = Math.round(10 * dpr) + 'px ui-monospace, monospace';
    if (!id) { g.fillStyle = C.mute; g.fillText('Choose an instrument or load an SFZ', 8 * dpr, 16 * dpr); return; }
    if (D.isMissing(id)) {
      g.fillStyle = C.xy;
      g.fillText('Missing sample: ' + D.smpName(id, 'multi'), 8 * dpr, 16 * dpr);
      g.fillStyle = C.mute;
      g.fillText('Drop the files here or tap the badge to relink', 8 * dpr, 30 * dpr);
      return;
    }
    if (this.sel >= 0 && Z[this.sel]) {   // the selected / last-played zone's waveform
      const z = Z[this.sel], gone = M.includes(z.smp), ov = gone ? null : D.overview(z.smp);
      if (ov) drawOverview(g, ov, [0, 1], w, h, OSC_COL[o]);
      g.fillStyle = C.mute;
      g.fillText('Zone ' + (this.sel + 1) + ': ' + noteName(z.lo | 0) + '–' + noteName(z.hi | 0) + ' · vel ' + (z.vlo | 0) + '–' + (z.vhi | 0) + ' (click: map)', 6 * dpr, 12 * dpr);
      if (gone) { g.fillStyle = C.xy; g.fillText('Missing sample: drop a file here to relink', 6 * dpr, 28 * dpr); }
      return;
    }
    if (!Z.length) { g.fillStyle = C.mute; g.fillText(D.recs.has(id) && D.recs.get(id).state === 'loading' ? 'Loading…' : 'No zones (instrument not available)', 8 * dpr, 16 * dpr); return; }
    g.strokeStyle = 'rgba(42, 51, 61, 0.9)'; g.lineWidth = dpr;
    for (let oct = 1; oct < 11; oct++) { const x = oct * 12 / 128 * w; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    const live = !!(this.kit.snap() && this.kit.snap().notes > 0);
    for (const z of zoneMapLayout(Z, w, h, this.hot())) {
      const gone = M.includes(Z[z.i].smp);
      g.fillStyle = gone ? 'rgba(255, 91, 91, 0.25)' : z.hot ? (live ? 'rgba(255, 216, 74, 0.55)' : 'rgba(255, 216, 74, 0.3)') : 'rgba(79, 179, 255, 0.22)';
      g.fillRect(z.x, z.y, Math.max(dpr, z.w - dpr), Math.max(dpr, z.h - dpr));
      g.strokeStyle = gone ? C.xy : z.hot ? C.cur : 'rgba(79, 179, 255, 0.7)';
      g.strokeRect(z.x + 0.5, z.y + 0.5, Math.max(dpr, z.w - dpr), Math.max(dpr, z.h - dpr));
    }
    g.fillStyle = C.mute;
    g.fillText(D.smpName(id, 'multi') + ' · ' + Z.length + ' zones' + (M.length ? ' · ' + M.length + ' missing' : ''), 6 * dpr, h - 5 * dpr);
  }
  // the envelope graph: DELAY · A · H · D (to S) · release R (each segment ∝ its time)
  envVals() {
    const K = this.kit, P = this.P, v = id => core.lawValue(P + '.' + id, K.getN(P + '.' + id));
    return { d: v('mdly'), a: v('matt'), h: v('mhold'), dc: v('mdec'), s: clamp01(v('msus')), r: v('mrel') };
  }
  envKey() { const E = this.envVals(); return [E.d, E.a, E.h, E.dc, E.s, E.r, this.O().msmo.override].map(x => (fin(x) ? x.toFixed(4) : x)).join('|'); }
  envGeo(w, h) {
    const E = this.envVals(), seg = t => Math.sqrt(Math.max(0, t) / 32);   // pow-ish display spacing
    const sw = w / 5.2, x1 = seg(E.d) * sw, x2 = x1 + seg(E.a) * sw, x3 = x2 + seg(E.h) * sw, x4 = x3 + seg(E.dc) * sw, x5 = x4 + 0.6 * sw, x6 = x5 + seg(E.r) * sw;
    const top = h * 0.12, bot = h * 0.92, ys = bot - (bot - top) * E.s;
    return { E, pts: [[0, bot], [x1, bot], [x2, top], [x3, top], [x4, ys], [x5, ys], [x6, bot]], sw, top, bot };
  }
  drawEnv(g, w, h, dpr) {
    const G = this.envGeo(w, h);
    g.beginPath();
    G.pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.strokeStyle = this.O().msmo.override ? OSC_COL[this.o] : C.mute; g.lineWidth = 1.6 * dpr; g.stroke();
    g.fillStyle = C.cur;
    for (const i of [2, 4, 6]) g.fillRect(G.pts[i][0] - 2 * dpr, G.pts[i][1] - 2 * dpr, 4 * dpr, 4 * dpr);
  }
  // drag the attack corner (x → A), the decay corner (x → D, y → S) or the release end (x → R)
  envDrag(c) {
    const K = this.kit, P = this.P;
    let g = null;
    const tOf = px => 32 * Math.pow(Math.max(0, px) / g.sw, 2);
    c.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const r = c.getBoundingClientRect(), G = this.envGeo(r.width, r.height), px = e.clientX - r.left, py = e.clientY - r.top;
      let best = -1, bd = 14 * 14;
      for (const i of [2, 4, 6]) { const dx = G.pts[i][0] - px, dy = G.pts[i][1] - py, q = dx * dx + dy * dy; if (q < bd) { bd = q; best = i; } }
      if (best < 0) return;
      const v0 = {};
      for (const id of ['matt', 'mdec', 'msus', 'mrel']) v0[P + '.' + id] = K.getN(P + '.' + id);
      g = { id: e.pointerId, i: best, r, sw: G.sw, base: G.pts[best - 1][0], top: G.top, bot: G.bot, v0 };
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
      e.preventDefault();
    });
    const put = (e, ph) => {
      const px = e.clientX - g.r.left, py = e.clientY - g.r.top, t = tOf(px - g.base);
      const set = (id, v) => K.setN(P + '.' + id, core.lawNorm(P + '.' + id, clamp(v, 0, 32)), ph);
      if (g.i === 2) set('matt', t);
      else if (g.i === 4) { set('mdec', t); K.setN(P + '.msus', clamp01((g.bot - py) / Math.max(1, g.bot - g.top)), ph); }
      else set('mrel', t);
    };
    c.addEventListener('pointermove', e => {
      if (!g || e.pointerId !== g.id) return;
      if (noButton(e)) { end(); return; }   // its pointerup went elsewhere
      put(e, 'move');
    });
    const end = () => { const P2 = this.P; for (const id of ['matt', 'mdec', 'msus', 'mrel']) if (K.dragging(P2 + '.' + id)) K.setN(P2 + '.' + id, K.getN(P2 + '.' + id), 'end'); g = null; };
    const up = e => { if (!g || e.pointerId !== g.id) return; if (twoF(e)) putBack(K, g.v0); else put(e, 'end'); g = null; };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('lostpointercapture', e => { if (g && e.pointerId === g.id) end(); });
  }
}
// min/max overview columns (pairs) over the fraction range [a, b] of the sample (flip: b at the left, a reversed sample)
function drawOverview(g, ov, ab, w, h, col, flip) {
  const n = ov.length / 2, [a, b] = ab;
  g.fillStyle = col || 'rgba(89, 194, 255, 0.7)';
  for (let x = 0; x < w; x++) {
    const xx = flip ? w - 1 - x : x;
    const u0 = a + (b - a) * xx / w, u1 = a + (b - a) * (xx + 1) / w, c0 = Math.floor(u0 * n), c1 = Math.max(c0 + 1, Math.ceil(u1 * n));
    let lo = 0, hi = 0;
    for (let c = Math.max(0, c0); c < Math.min(n, c1); c++) { if (ov[2 * c] < lo) lo = ov[2 * c]; if (ov[2 * c + 1] > hi) hi = ov[2 * c + 1]; }
    g.fillRect(x, h / 2 - hi * h * 0.45, 1, Math.max(1, (hi - lo) * h * 0.45));
  }
}

/* ---------------------------------------------------------------- sample-based views (Sample, Granular, Spectral) */

// The shared machinery of the Sample, Granular and Spectral views: the sample menu (◀ ▶ / wheel inside the folder,
// Wavetables ▸, User, Renders), Load / Rename / Delete / Embed, the display with its markers and gestures (§13.3,
// §13.3.2), the display menu (sample operations, snapping, slicing), the loop menu, LS / LE, and the SCAN knob that
// is relabelled RATE (Sample Length to BPM → k.lenrate) or X (X|Y Manual → k.pos).
class SmpBase extends TypeView {
  build() {
    const K = this.kit, D = this.D, d = K.doc, o = this.o, T = OSC_T[o];
    this.zv = { a: 0, b: 1 };          // zoom / pan of the display (UI only)
    this.g = null;
    const sm = K.bind(wk.menu({ label: T + ' sample', items: () => D.smpItems('sample', this.O().smp), get: () => this.O().smp, arrows: true, stepGroup: true,
      set: v => this.setSample(v) }));
    sm.el.classList.add('sx-grow', 'sxo-src');
    const load = btn(d, 'sx-hbtn', icon(d, 'folder'), 'Load sample (' + T + ')', () => this.load());
    const ren = btn(d, 'sx-hbtn', 'Rename', 'Rename user sample', () => D.renameAsset(this.O().smp, 'sample'));
    const del = btn(d, 'sx-hbtn', icon(d, 'trash'), 'Delete user sample', () => D.deleteAsset(this.O().smp, 'sample'));
    const emb = mk(d, 'span', 'sxo-badge', 'EMBED');
    emb.title = 'User samples are embedded in exported presets and projects';
    // §9.9: the user sample was deleted from the store — the badge (tap: file picker; drop) relinks it
    const miss = btn(d, 'sx-hbtn sxo-miss', 'Missing sample', 'Missing sample: choose or drop a file to relink', () => this.load());
    fileDrop(miss, files => this.drop(files));
    K.custom(() => { const id = this.O().smp, u = isUserAsset(id), m = D.isMissing(id); hide(ren, !u); hide(del, !u); hide(emb, !u || m); hide(miss, !m); });
    this.head.push(sm.el, load, ren, del, emb, miss);
    // display (+ overlays: X|Y dot, Hi / Lo handles) in a positioned wrapper
    const wrap = mk(d, 'div', 'sxo-dw');
    const cv = K.canvas('sx-tall', () => this.key(), (g, w, h, dpr) => this.draw(g, w, h, dpr));
    this.cv = cv;
    cv.el.setAttribute('data-oscdisp', String(o));
    cv.el.tabIndex = 0;
    cv.el.setAttribute('role', 'application');
    cv.el.setAttribute('aria-label', T + ' ' + this.dispName() + ': drag markers; drag up / down to zoom, left / right to pan; right-click or long-press for the menu');
    wrap.appendChild(cv.el);
    this.wrap = wrap;
    this.attach(cv.el);
    fileDrop(cv.el, files => this.drop(files));
    if (this.hasXY()) this.buildDot(wrap);
    this.overlays(wrap);
    // loop menu button, LS / LE, SCAN | RATE | X
    const lb = btn(d, 'sx-hbtn', '', 'Loop mode (' + T + ')', () => { const r = lb.getBoundingClientRect(); wk.contextMenu(r.left, r.bottom + 2, this.loopItems(), { anchor: lb }); });
    K.custom(() => {
      const O = this.O(), t = LOOP_SHORT[O.smpo.loop | 0] + (this.xyOn() ? ' · X|Y' : '') + ' ▾';
      if (lb.textContent !== t) lb.textContent = t;
    });
    // START / END (the S / E markers as values: typed entry, drop targets), LS / LE, X-FADE, SLICE (Play Single Slice:
    // the slice k.slice plays), Y (X|Y Manual)
    const P = this.P, num = (id, label) => K.num(P + '.' + id, { label });
    const st = num('sstart', 'START'), en = num('send', 'END'), ls = num('lstart', 'LS'), le = num('lend', 'LE'), xf = num('xfade', 'X-FADE');
    const slc = num('slice', 'SLICE'), gy = this.hasXY() ? num('gy', 'Y') : null;
    K.custom(() => {
      const so = this.O().smpo, lp = so.loop | 0, off = !(lp >= 1 && lp <= 3);
      ls.el.classList.toggle('wk-dis', off); le.el.classList.toggle('wk-dis', off);
      hide(xf.el, !(lp === 1 || lp === 2 || lp === 4));
      hide(slc.el, !(so.slice.mode && so.slice.single) || this.xyOn());
      if (gy) hide(gy.el, !this.xyOn());
    });
    const scan = this.scanKnobs();
    this.el.append(wrap, row(d, lb, st.el, en.el, ls.el, le.el, xf.el), row(d, ...scan, gy && gy.el, slc.el));
    this.buildMore();
  }
  dispName() { return 'waveform'; }
  hasXY() { return false; }
  xyOn() { return this.hasXY() && !!this.O().xy.on; }
  overlays() {}
  buildMore() {}
  load() { pickFiles(this.kit.doc, AUDIO_ACCEPT, true).then(fl => this.drop(fl)); }
  // files from Load / a drop: imported onto this oscillator, or relinking its missing user sample (§9.9)
  drop(files) {
    if (!arr(files).length) return null;
    const id = this.O().smp;
    return this.D.importSamples(this.o, files, 'sample', this.D.isMissing(id) ? { replace: id } : null);
  }
  setSample(v) {
    const o = this.o;
    this.D.dropMissing(v);
    this.D.sampleEdit(o, s => { s.osc[o].smp = v; s.osc[o].smpo.ops = { fade: 0, norm: 0, rev: 0, trim: null }; }, 'Sample');
    this.zv = { a: 0, b: 1 };
  }
  // SCAN / RATE / X: three knobs, one shown (a knob's binding never changes, §15.12 "with the right binding")
  scanKnobs() {
    const K = this.kit;
    const scan = extraMenu(this.kn('scan', 'SCAN'), () => this.scanItems());
    const rate = extraMenu(this.kn('lenrate', 'RATE'), () => this.scanItems());
    const x = this.hasXY() ? this.kn('pos', 'X') : null;
    K.custom(() => {
      const xy = this.xyOn(), bpm = !xy && !!this.O().smpo.lenBpm;
      hide(scan, xy || bpm); hide(rate, !bpm); if (x) hide(x, !xy);
    });
    return [scan, rate, x];
  }
  // SCAN menu (§13.3): Range ±200 / 400 / 800 %, Reverse (k.scanrev), Lock Scan Rate, Sample Length to BPM; the
  // Granular view adds Key Track, the Spectral view Key Track, Phase Lock and Transients (scanExtra)
  scanItems() {
    const K = this.kit, P = this.P, so = this.O().smpo, rev = K.getN(P + '.scanrev') >= 0.5;
    return [
      { label: 'Range', sub: SCAN_RANGES.map((r, i) => ({ label: '±' + r * 100 + ' %', checked: (so.scanRange | 0) === i, action: () => this.smpo(x => { x.scanRange = i; }, 'Scan range') })) },
      { label: 'Reverse', checked: rev, action: () => K.setN(P + '.scanrev', rev ? 0 : 1, 'set') },
      this.smpTog('scanLock', 'Lock Scan Rate'), this.smpTog('lenBpm', 'Sample Length to BPM'),
    ].concat(this.scanExtra());
  }
  scanExtra() { return []; }
  // a ✓ menu item toggling the 0/1 field k of smpo
  smpTog(k, label) { const so = this.O().smpo; return { label, checked: !!so[k], action: () => this.smpo(x => { x[k] = x[k] ? 0 : 1; }, label) }; }
  smpo(fn, label, phase) { const o = this.o; this.kit.edit(s => fn(s.osc[o].smpo, s), phase ? { label, phase } : { label }); }
  uiSmpo(fn) { const o = this.o; uiEdit(this.kit, s => fn(s.osc[o].smpo, s)); }
  loopItems() {
    const so = this.O().smpo, L = so.loop | 0;
    const tg = (k, label) => ({ label, checked: !!so[k], action: () => this.smpo(x => { x[k] = x[k] ? 0 : 1; }, label) });
    return LOOP_MODES.map((m, i) => ({ label: m, checked: L === i, action: () => this.smpo(x => { x.loop = i; }, 'Loop mode') }))
      .concat([{ sep: true }, tg('rel', 'Relative Loop'), tg('link', 'Link Loop Length'), tg('exitRel', 'Exit Loop on Release')], this.loopExtra());
  }
  loopExtra() { return []; }
  // X|Y Manual items (Granular / Spectral loop menus): ✓ Manual, Y Axis ▸, Y Modulation ▸
  xyItems(ylist) {
    const K = this.kit, o = this.o, xy = this.O().xy;
    return [{ sep: true },
      { label: 'Manual (X|Y)', checked: !!xy.on, action: () => K.edit(s => { s.osc[o].xy.on = s.osc[o].xy.on ? 0 : 1; }, { label: 'X|Y Manual' }) },
      { label: 'Y Axis', disabled: !xy.on, sub: ylist.map((y, i) => ({ label: y, checked: (xy.y | 0) === i, action: () => K.edit(s => { s.osc[o].xy.y = i; }, { label: 'X|Y Y axis' }) })) },
      { label: 'Y Modulation', disabled: !xy.on, sub: XY_MODES.map((y, i) => ({ label: y, checked: (xy.yMode | 0) === i, action: () => K.edit(s => { s.osc[o].xy.yMode = i; }, { label: 'X|Y Y modulation' }) })) }];
  }
  // display menu (§13.3 Sample view context menu)
  dispItems() {
    const K = this.kit, so = this.O().smpo, ops = so.ops || {}, sl = so.slice, xy = this.xyOn(), id = this.O().smp;
    // display options (smpo.anim, zoomSE, snap: UI fields, §2.2.3) are view edits (no undo step, §13.2.4)
    const tg = (k, label) => ({ label, checked: !!so[k], action: () => { this.uiSmpo(x => { x[k] = x[k] ? 0 : 1; }); if (k === 'zoomSE') this.zv = { a: 0, b: 1 }; } });
    const op = (k, label) => ({ label, checked: !!ops[k], action: () => this.smpo(x => { x.ops = Object.assign({}, x.ops, { [k]: x.ops && x.ops[k] ? 0 : 1 }); }, label) });
    const S = K.getN(this.P + '.sstart'), E = K.getN(this.P + '.send'), a = Math.min(S, E), b = Math.max(S, E);
    const o = this.o, D = this.D;
    const items = [tg('anim', 'Show Marker Animation'), tg('zoomSE', 'Zoom to Start and End'),
      { label: 'Snap', sub: ['Off', 'to Zero', 'to Beats', 'to Loop'].map((t, i) => ({ label: 'Snap ' + t, checked: (so.snap | 0) === i, action: () => this.uiSmpo(x => { x.snap = i; }) })) },
      { sep: true },
      { label: 'Fade Edges', sub: FADE_MS.map((ms, i) => ({ label: i ? ms + ' ms' : 'None', checked: (ops.fade | 0) === i, action: () => this.smpo(x => { x.ops = Object.assign({}, x.ops, { fade: i }); }, 'Fade edges') })) },
      op('norm', 'Normalize'),
      // Reverse: the processed sample turns around under the markers; Auto marks follow it
      { label: 'Reverse', checked: !!ops.rev, action: () => D.sampleEdit(o, s => { const x = s.osc[o].smpo; x.ops = Object.assign({}, x.ops, { rev: x.ops && x.ops.rev ? 0 : 1 }); }, 'Reverse') },
      { label: 'Trim', disabled: !id || !(b - a >= 1e-4) || (a <= 0 && b >= 1), action: () => this.trim() }]
      .concat(ops.trim ? [{ label: 'Untrim', action: () => this.untrim() }] : [], [
        // Reload Sample (§9.4.2): the record is read again, the operations cleared with the markers carried to the
        // record's coordinates (serum-core clearSampleOps: they keep pointing at the same audio)
        { label: 'Reload Sample', disabled: !id, action: () => {
          D.forgetAsset(id);
          D.sampleEdit(o, s => { if (typeof core.clearSampleOps === 'function') core.clearSampleOps(s, o); else s.osc[o].smpo.ops = { fade: 0, norm: 0, rev: 0, trim: null }; }, 'Reload Sample');
        } },
        { sep: true }]);
    for (let m = 0; m < 3; m++) items.push({ label: 'Slicing ' + ['Off', 'Auto', 'Manual'][m], checked: (sl.mode | 0) === m, disabled: xy, action: () => this.setSliceMode(m) });
    if (sl.mode) {
      const csel = K.s().clip ? (K.s().clip.sel | 0) : 0;
      const t = (k, label) => ({ label, checked: !!sl[k], disabled: xy, action: () => this.sliceEdit(x => { x[k] = x[k] ? 0 : 1; if (k === 'toEnd' && x.toEnd) x.single = 0; if (k === 'single' && x.single) x.toEnd = 0; }, label) });
      items.push(t('toEnd', 'Play Slice to End'), t('single', 'Play Single Slice'),
        { label: 'Root Note', disabled: xy, sub: Array.from({ length: 10 }, (_, k) => ({ label: noteName(12 * k), checked: (sl.root | 0) === 12 * k, action: () => this.sliceEdit(x => { x.root = 12 * k; }, 'Slice root') })) },
        { label: 'Send to Selected Clip (' + (csel + 1) + ')', disabled: xy || !sl.marks.length, action: () => this.sendToClip() },
        t('sync', 'Auto-Sync to Clip'));
    }
    return items;
  }
  // Trim (§9.4.2, non-destructive; serum-core trimSample): the processed sample becomes the region S…E — ops.trim the
  // matching range of the record through the current trim and reverse, the markers, slice marks and k.pos re-expressed in
  // the new processed coordinates (S → 0, E → 1); Auto marks recomputed, the clip re-sent with Auto-Sync
  trim() {
    const o = this.o;
    if (typeof core.trimSample !== 'function') { this.kit.notify('Trim is not available'); return; }
    this.D.sampleEdit(o, s => { core.trimSample(s, o); }, 'Trim');
    this.zv = { a: 0, b: 1 };
  }
  // Untrim: the whole record again, every marker carried back onto the same audio (the inverse of trimSample)
  untrim() {
    const o = this.o;
    this.D.sampleEdit(o, s => { untrimSample(s, o); }, 'Untrim');
    this.zv = { a: 0, b: 1 };
  }
  // the snapshot / base marker model of markerLayout
  mm() {
    const K = this.kit, P = this.P, O = this.O(), so = O.smpo, sn = K.snap(), o = this.o;
    const anim = !!so.anim && sn && sn.notes > 0 && sn.smpPos && sn.smpPos.length >= 4 * o + 4;
    return { S: anim ? sn.smpPos[4 * o + 1] : K.getN(P + '.sstart'), E: K.getN(P + '.send'), LS: anim ? sn.smpPos[4 * o + 2] : K.getN(P + '.lstart'),
      LE: anim ? sn.smpPos[4 * o + 3] : K.getN(P + '.lend'), X: K.getN(P + '.xfade'), loop: so.loop | 0, marks: so.slice.marks,
      slicing: this.xyOn() ? 0 : so.slice.mode | 0, play: anim && !this.xyOn() ? sn.smpPos[4 * o] : null };
  }
  viewR() {
    const so = this.O().smpo;
    if (so.zoomSE) {
      const S = this.kit.getN(this.P + '.sstart'), E = this.kit.getN(this.P + '.send'), a = Math.min(S, E), b = Math.max(S, E);
      if (b - a > 1e-4) return { a, b };
    }
    return this.zv;
  }
  key() {
    if (!this.active()) return 'off';
    const K = this.kit, P = this.P, O = this.O(), so = O.smpo, m = this.mm(), v = this.viewR(), id = O.smp;
    return [id, this.D.isMissing(id) ? 'missing' : '', this.bgKey(), v.a.toFixed(5), v.b.toFixed(5), m.S.toFixed(5), m.E.toFixed(5), m.LS.toFixed(5), m.LE.toFixed(5),
      m.X.toFixed(4), m.loop, m.slicing, so.slice.marks.join(','), so.slice.thr,
      m.play === null ? '' : m.play.toFixed(4), JSON.stringify(so.ops), K.getN(P + '.on'),
      K.getN(P + '.uni'), K.getN(P + '.det').toFixed(3), O.uni.mode,   // the unison stalks
      this.g && this.g.thr !== undefined ? this.g.thr.toFixed(3) : ''].join('|');
  }
  bgKey() { const id = this.O().smp; return this.D.overview(id) ? 1 : 0; }
  // a missing user sample (§9.9) / no sample / still loading: the display's message, true when one was drawn
  drawMsg(g, w, h, dpr, pending) {
    const id = this.O().smp, put = (t, y, col) => { g.fillStyle = col || C.mute; g.font = Math.round(10 * dpr) + 'px ui-monospace, monospace'; g.fillText(t, 8 * dpr, y * dpr); };
    if (!id) { put('Choose a sample, load one or drop a file', 16); return true; }
    if (this.D.isMissing(id)) { put('Missing sample: ' + this.D.smpName(id, 'sample'), 16, C.xy); put('Drop a file here or tap the badge to relink', 30); return true; }
    if (pending) { put(pending, 16); return true; }
    return false;
  }
  // the processed sample's overview range: [v.a, v.b] of the processed sample through trim and reverse (smpCoords)
  drawBg(g, w, h, dpr, v) {
    const id = this.O().smp, ov = this.D.overview(id), Cc = smpCoords(this.O().smpo.ops);
    if (this.drawMsg(g, w, h, dpr, ov ? '' : 'Loading…')) return;
    const a = Cc.toRec(v.a), b = Cc.toRec(v.b);
    drawOverview(g, ov, [Math.min(a, b), Math.max(a, b)], w, h, 'rgba(89, 194, 255, 0.65)', Cc.rev);
  }
  draw(g, w, h, dpr) {
    const v = this.viewR(), m = this.mm(), L = markerLayout(m, v, w), so = this.O().smpo;
    this.drawBg(g, w, h, dpr, v);
    const vline = (x, col, lw) => { g.strokeStyle = col; g.lineWidth = lw * dpr; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); };
    if (L.loop) { g.fillStyle = 'rgba(79, 179, 255, 0.12)'; g.fillRect(L.loop.x0, 0, L.loop.x1 - L.loop.x0, h); }
    if (L.xfade && L.xfade.len > 0) {
      g.fillStyle = 'rgba(79, 179, 255, 0.22)';
      g.beginPath(); g.moveTo(L.xfade.x0, h); g.lineTo(L.xfade.x1, 0); g.lineTo(L.xfade.x1, h); g.closePath(); g.fill();
    }
    // the region outside S…E dimmed
    const S = L.markers[0], E = L.markers[1], x0 = Math.min(S.x, E.x), x1 = Math.max(S.x, E.x);
    g.fillStyle = 'rgba(10, 13, 16, 0.55)';
    if (x0 > 0) g.fillRect(0, 0, x0, h);
    if (x1 < w) g.fillRect(x1, 0, w - x1, h);
    for (const sl of L.slices) if (sl.vis) vline(sl.x, C.slice, 1);
    if (m.slicing === 1) {   // Auto: the threshold line
      const thr = this.g && this.g.thr !== undefined ? this.g.thr : so.slice.thr;
      g.strokeStyle = 'rgba(247, 201, 72, 0.6)'; g.lineWidth = dpr; g.setLineDash && g.setLineDash([4 * dpr, 3 * dpr]);
      g.beginPath(); g.moveTo(0, (1 - thr) * h); g.lineTo(w, (1 - thr) * h); g.stroke();
      if (g.setLineDash) g.setLineDash([]);
    }
    for (const mk2 of L.markers) {
      if (!mk2.vis) continue;
      if (mk2.id === 'XF') {
        const y = this.xfY(mk2.y, h);
        g.fillStyle = C.loop; g.beginPath(); g.arc ? g.arc(mk2.x, y, 4 * dpr, 0, 2 * Math.PI) : g.rect(mk2.x - 4 * dpr, y - 4 * dpr, 8 * dpr, 8 * dpr); g.fill();
      } else vline(mk2.x, mk2.id === 'S' || mk2.id === 'E' ? C.mark : C.loop, mk2.id === 'S' || mk2.id === 'E' ? 1.5 : 1.2);
    }
    if (L.play && L.play.vis) vline(L.play.x, C.cur, 1.5);
    drawStalks(this.kit, this.o, g, w, h, dpr);
  }
  xfY(X, h) { return h * (0.92 - 0.84 * clamp01(X)); }

  /* -------------------------------------------------- display gestures */
  attach(c) {
    const K = this.kit;
    this.touches = new Set();           // touch pointers down on the display (a second one = pinch: wk.zoomPan's)
    c.addEventListener('pointerdown', e => this.down(e));
    c.addEventListener('pointermove', e => this.move(e));
    c.addEventListener('pointerup', e => { this.touches.delete(e.pointerId); this.up(e, false); });
    c.addEventListener('pointercancel', e => { this.touches.delete(e.pointerId); this.up(e, true); });
    // a capture lost mid-drag (the view hidden by an undo, a page switch, a dialog): the gesture ends where it is
    c.addEventListener('lostpointercapture', e => { this.touches.delete(e.pointerId); if (this.g && e.pointerId === this.g.id) this.up(e, true); });
    c.addEventListener('contextmenu', e => { e.preventDefault(); if ((this.ate && Date.now() - this.ate < 700) || this.pinching()) return; this.openMenu(e.clientX, e.clientY); });
    c.addEventListener('keydown', e => {
      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); const r = c.getBoundingClientRect(); this.openMenu(r.left + 8, r.top + 8); }
    });
    this.zp = null;
    if (typeof wk.zoomPan === 'function') {
      this.zp = wk.zoomPan(c, { axis: 'x', get: () => { const v = this.viewR(); return { x0: v.a, x1: v.b }; },
        set: v => { this.zv = { a: v.x0, b: v.x1 }; if (this.O().smpo.zoomSE) this.uiSmpo(x => { x.zoomSE = 0; }); K.queue(); } });
    }
  }
  pinching() { return !!(this.zp && typeof this.zp.active === 'function' && this.zp.active()) || (this.touches && this.touches.size > 1); }
  openMenu(x, y) { wk.contextMenu(x, y, this.dispItems(), { anchor: this.cv.el }); }
  geo(e) {
    const r = this.cv.el.getBoundingClientRect(), v = this.viewR(), W = Math.max(1, r.width), H = Math.max(1, r.height);
    const px = e.clientX - r.left, py = e.clientY - r.top;
    return { r, v, W, H, px, py, u: v.a + clamp01(px / W) * (v.b - v.a) };
  }
  down(e) {
    if (e.button !== 0) return;
    if (e.pointerType === 'touch') this.touches.add(e.pointerId);
    if (this.g) {
      // a second finger: a pinch (wk.zoomPan) — the first finger's gesture is rolled back (a pinch never drags what it
      // lands on, G1; gesture.js sends no cancel within one own element), its long-press never fires; a touch during a
      // pen or mouse gesture (a palm) ends it, kept
      if (e.pointerType === 'touch' && e.pointerId !== this.g.id) {
        const g = this.g;
        if (this.touches.size > 1) { this.g = null; if (g.lp) { clearTimeout(g.lp); g.lp = 0; } this.rollback(g, true); } else this.up(e, true, g);
        return;
      }
      this.up(e, true, this.g);   // a stale gesture whose pointerup was missed gives way to the new press
    }
    if (this.pinching()) return;
    const K = this.kit, P = this.P, G = this.geo(e), m = this.mm(), L = markerLayout(m, G.v, G.W), so = this.O().smpo, mods = modsOf(e);
    const tolU = 6 / G.W * (G.v.b - G.v.a);
    let g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, px0: G.px, py0: G.py, u0: G.u, v0: G.v, moved: false, kind: 'view' };
    // Manual slicing: Alt-click (or the Alt latch) adds / removes a mark
    if (m.slicing === 2 && mods.alt) { consumeMods(); this.toggleMark(G.u, tolU); return; }
    // the X-fade handle, then the markers (nearest within 8 px)
    const xf = L.markers.find(x => x.id === 'XF');
    if (xf && Math.abs(xf.x - G.px) <= 8 && Math.abs(this.xfY(xf.y, G.H) - G.py) <= 10) g = Object.assign(g, { kind: 'xf', X0: m.X, H: G.H });
    else {
      let best = null, bd = 8;
      for (const mk2 of L.markers) { if (mk2.id === 'XF') continue; const dd = Math.abs(mk2.x - G.px); if (dd <= bd) { bd = dd; best = mk2; } }
      if (best) g = Object.assign(g, { kind: 'marker', key: best.key });
      else if (m.slicing === 1 && Math.abs((1 - so.slice.thr) * G.H - G.py) <= 6) g = Object.assign(g, { kind: 'thr', thr: so.slice.thr });
      else if (this.xyOn()) g = Object.assign(g, { kind: 'xy' });
      else if (L.loop && m.loop >= 1 && m.loop <= 3 && G.px > L.loop.x0 + 8 && G.px < L.loop.x1 - 8 && G.py < G.H * 0.25) g = Object.assign(g, { kind: 'loop', LS: K.getN(P + '.lstart'), LE: K.getN(P + '.lend') });
    }
    // what the gesture may set, as at the press (a two-finger rollback puts it back: up())
    g.back = g.kind === 'marker' ? [P + '.' + g.key] : g.kind === 'xf' ? [P + '.xfade'] : g.kind === 'xy' ? [P + '.pos', P + '.gy'] : [];
    g.v0n = {};
    for (const id of g.back) g.v0n[id] = K.getN(id);
    this.g = g;
    try { this.cv.el.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    if (e.pointerType === 'touch') {   // long-press: Manual slicing toggles a mark, else the display menu
      g.lp = setTimeout(() => {
        g.lp = 0;
        if (this.g !== g || g.moved || this.pinching()) return;
        this.g = null;
        this.ate = Date.now();
        if (m.slicing === 2) this.toggleMark(G.u, tolU * 2); else this.openMenu(e.clientX, e.clientY);
      }, 500);
    }
    e.preventDefault();
  }
  move(e) {
    const g = this.g;
    if (!g || e.pointerId !== g.id) return;
    if (noButton(e)) { this.up(e, true); return; }   // the pointerup went elsewhere: the gesture ends, the hover edits nothing
    if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < (e.pointerType === 'touch' ? TOUCH_SLOP : 3)) return;
    const first = !g.moved, ph = first ? 'start' : 'move';
    g.moved = true;
    const K = this.kit, P = this.P, G = this.geo(e);
    switch (g.kind) {
      case 'marker': K.setN(P + '.' + g.key, this.snapU(g.key, G.u), ph); break;
      case 'xf': K.setN(P + '.xfade', clamp01(g.X0 + (g.py0 - G.py) / (0.84 * g.H)), ph); break;
      case 'thr': g.thr = clamp01(1 - G.py / G.H); K.queue(); break;
      case 'xy': this.putXY(G, ph); break;
      case 'loop': {
        const du = G.u - g.u0, lo = Math.min(g.LS, g.LE), hi = Math.max(g.LS, g.LE), dd = clamp(du, -lo, 1 - hi);
        K.edit(s => { s.p[P + '.lstart'] = clamp01(g.LS + dd); s.p[P + '.lend'] = clamp01(g.LE + dd); }, { label: 'Move loop', phase: g.lphase ? 'move' : 'start' });
        g.lphase = 1;
        break;
      }
      default: {   // zoom (drag up = in) around the press point, pan (drag left / right)
        const f = Math.exp((g.py0 - G.py) / 90), cx = clamp01(g.px0 / G.W);
        let a = g.v0.a, b = g.v0.b;
        const span = clamp((b - a) / f, 0.0005, 1), p = a + cx * (b - a);
        a = p - cx * span; b = a + span;
        const shift = -(G.px - g.px0) / G.W * span;
        a += shift; b += shift;
        if (a < 0) { b -= a; a = 0; }
        if (b > 1) { a -= b - 1; b = 1; }
        this.zv = { a: clamp01(a), b: clamp01(b) };
        if (this.O().smpo.zoomSE) this.uiSmpo(x => { x.zoomSE = 0; });
        K.queue();
      }
    }
  }
  // the end of the display gesture g (default this.g; its pointer = e's unless `force`): moves close their undo gesture,
  // a cancelled one (pointercancel, a lost capture, a stale gesture replaced, a palm during a pen gesture) keeps what it
  // had set — except gesture.js's two-finger cancel (twoF): a second finger elsewhere made it a pan / pinch, so
  // rollback() (a second finger on this display: down())
  up(e, cancel, force) {
    const g = force || this.g;
    if (!g || (!force && e.pointerId !== g.id)) return;
    this.g = null;
    if (g.lp) { clearTimeout(g.lp); g.lp = 0; }
    const K = this.kit, P = this.P;
    if (cancel && !force && twoF(e)) { this.rollback(g, false); return; }
    if (g.kind === 'marker' && g.moved) { K.setN(P + '.' + g.key, K.getN(P + '.' + g.key), 'end'); this.D.pcmIdle(); }
    else if (g.kind === 'xf' && g.moved) K.setN(P + '.xfade', K.getN(P + '.xfade'), 'end');
    else if (g.kind === 'xy' && g.moved) this.putXY(cancel ? null : this.geo(e), 'end');
    else if (g.kind === 'xy' && !cancel) this.putXY(this.geo(e), 'set');   // a tap places the dot
    else if (g.kind === 'loop' && g.lphase) K.edit(() => {}, { label: 'Move loop', phase: 'end' });
    else if (g.kind === 'thr' && g.moved && !cancel) {
      const t = Math.round(clamp01(g.thr) * 1000) / 1000, o = this.o;
      this.D.sampleEdit(o, s => { s.osc[o].smpo.slice.thr = t; }, 'Slice threshold');
    } else if (g.kind === 'thr') K.queue();
    consumeMods();
  }
  // a two-finger rollback of g: markers, X-fade, X/Y and the loop go back to how they were at the press ('move' + 'end':
  // no net undo step), a view drag too — unless own (the pinch on this display: wk.zoomPan's capture listener already
  // took the dragged view as its start, putting it back would jump a frame); the modifier latches stay for the next gesture
  rollback(g, own) {
    const K = this.kit, P = this.P;
    if (!g.moved) { if (g.kind === 'thr') K.queue(); return; }
    if (g.kind === 'loop' && g.lphase) K.edit(s => { s.p[P + '.lstart'] = g.LS; s.p[P + '.lend'] = g.LE; }, { label: 'Move loop', phase: 'end' });
    else if (g.kind === 'view') { if (!own) { this.zv = { a: g.v0.a, b: g.v0.b }; K.queue(); } }
    else if (g.kind === 'thr') K.queue();
    else if (g.back && g.back.length) { putBack(K, g.v0n); if (g.kind === 'marker') this.D.pcmIdle(); }
  }
  putXY(G, ph) {   // G null: the gesture ends where it is
    const K = this.kit, P = this.P;
    K.setN(P + '.pos', G ? G.u : K.getN(P + '.pos'), ph);
    K.setN(P + '.gy', G ? clamp01(1 - G.py / G.H) : K.getN(P + '.gy'), ph);
  }
  // marker snapping (§13.3.2), in processed coordinates (smpCoords: the searches read the stored record through trim and
  // reverse; lengths are the processed sample's): Zero — the nearest upward zero crossing of the processed signal's mono
  // sum within ±5 ms; Beats — 1/16 at the tempo from S, or sixteenths of the region with Length to BPM; Loop (LS / LE) —
  // whole root periods from the other loop marker, the least seam error within ±5 ms when the PCM is at hand (not for
  // manual slice marks, key 'mark')
  snapU(key, u) {
    const K = this.kit, P = this.P, O = this.O(), mode = O.smpo.snap | 0, info = this.D.smpInfo(O.smp);
    if (!mode || !info || !(info.len > 0)) return u;
    const Cc = smpCoords(O.smpo.ops), len = info.len, PL = Cc.w * len, x = u * PL, win = 0.005 * info.rate;
    if (!(PL > 0)) return u;
    const pcmAt = () => {   // the processed signal's mono sum at processed frame p: the stored PCM read through the ops
      const pc = this.D.pcm(O.smp);   // (§6.7.7: reversed, frame p of the trimmed entry [s, e) is stored frame e − 1 − p)
      if (!pc) return null;
      const sc = pc.len / len, n = pc.len, L = pc.L, R = pc.R;
      return p => { const i = clamp(Math.round((Cc.rev ? Cc.t1 * len - 1 - p : Cc.t0 * len + p) * sc), 0, n - 1); return R ? 0.5 * (L[i] + R[i]) : L[i]; };
    };
    if (mode === 1) {
      const at = pcmAt();
      if (!at) return u;
      let best = -1;
      for (let p = Math.max(1, Math.ceil(x - win)), e = Math.min(PL - 1, Math.floor(x + win)); p <= e; p++) {
        if (at(p - 1) < 0 && at(p) >= 0 && (best < 0 || Math.abs(p - x) < Math.abs(best - x))) best = p;
      }
      return best >= 0 ? clamp01(best / PL) : u;
    }
    if (mode === 2) {
      const S = K.getN(P + '.sstart') * PL, E = K.getN(P + '.send') * PL;
      const beats = O.smpo.lenBpm && LEN_LADDER.length ? LEN_LADDER[Math.round(K.getN(P + '.lenrate') * (LEN_LADDER.length - 1))].beats : 0;
      const grid = core.snapGrid(2, { bpm: this.D.bpm(), rate: info.rate, S, E, lenBeats: beats });
      return grid ? clamp01(core.snapTo(grid, x) / PL) : u;
    }
    if (mode === 3 && (key === 'lstart' || key === 'lend')) {
      const fixed = K.getN(P + (key === 'lstart' ? '.lend' : '.lstart')) * PL, T0 = info.rate / (440 * Math.pow(2, (info.root - 69) / 12));
      const grid = core.snapGrid(3, { S: fixed, loop: T0 });
      if (!grid) return u;
      let best = core.snapTo(grid, x);
      const at = pcmAt();
      if (at) {   // seam error |x(LE) − x(LS)| + slope difference over the whole-period candidates within ±5 ms
        const sl = p => at(p) - at(p - 1);
        let be = Infinity;
        for (let k = Math.ceil((x - win - fixed) / T0); fixed + k * T0 <= x + win; k++) {
          const p = fixed + k * T0;
          if (p < 0 || p > PL || k === 0) continue;
          const err = Math.abs(at(p) - at(fixed)) + Math.abs(sl(p) - sl(fixed));
          if (err < be) { be = err; best = p; }
        }
      }
      return clamp01(best / PL);
    }
    return u;
  }

  /* -------------------------------------------------- slicing */
  // a slicing edit: fn(slice) — Auto marks / Auto-Sync to Clip follow in the same step (OscData.sampleEdit)
  sliceEdit(fn, label) { const o = this.o; this.D.sampleEdit(o, s => fn(s.osc[o].smpo.slice), label); }
  setSliceMode(m) { this.sliceEdit(x => { x.mode = m; }, 'Slicing ' + ['Off', 'Auto', 'Manual'][m]); }   // Auto → Manual keeps the marks
  // Manual: a mark added at u (snapped with Snap to Zero / to Beats, §13.3.2) or the mark within tol of u removed
  toggleMark(u, tol) {
    const sl = this.O().smpo.slice, hit = sliceAt(sl.marks, u, tol), q = r5(clamp01(this.snapU('mark', u)));
    this.sliceEdit(x => {
      const M = x.marks.slice();
      if (hit.mark >= 0) M.splice(hit.mark, 1);
      else if (q > 0 && q < 1 && M.length < 256) M.push(q);
      x.marks = Array.from(new Set(M)).sort((a, b) => a - b);
    }, hit.mark >= 0 ? 'Remove slice' : 'Add slice');
  }
  // Auto mode: the marks from the onset function at the threshold (a wavetable as a sample: its frame boundaries)
  refreshAuto() { return this.D.refreshAuto(this.o, 'Auto slices'); }
  sendToClip() {
    const K = this.kit, o = this.o;
    if (!this.D.smpInfo(this.O().smp)) { K.notify('Sample not loaded yet'); return; }
    K.edit(s => { const O = s.osc[o]; clipFromSlices(s, O.smpo.slice, this.D.smpInfo(O.smp), O.smpo.ops, this.D.bpm()); }, { label: 'Send to Selected Clip' });
  }

  /* -------------------------------------------------- X|Y dot (Granular / Spectral Manual) */
  buildDot(wrap) {
    const K = this.kit, d = K.doc, P = this.P, dot = mk(d, 'div', 'sxo-dot');
    dot.setAttribute('role', 'slider');
    dot.setAttribute('aria-label', OSC_T[this.o] + ' X|Y position');
    dot.tabIndex = 0;
    dot.setAttribute('data-xy', '1');
    dot.setAttribute('data-dest-x', P + '.pos');
    dot.setAttribute('data-dest-y', P + '.gy');
    K.dropTarget(dot, P + '.pos');
    wrap.appendChild(dot);
    this.dot = dot;
    let g = null;
    dot.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      g = { id: e.pointerId, v0: { [P + '.pos']: K.getN(P + '.pos'), [P + '.gy']: K.getN(P + '.gy') } };   // (v0: a two-finger rollback)
      try { dot.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
      this.putXY(this.geo(e), 'start');
    });
    dot.addEventListener('pointermove', e => { if (g && e.pointerId === g.id) { if (noButton(e)) lost(e); else this.putXY(this.geo(e), 'move'); } });
    const up = e => { if (g && e.pointerId === g.id) { const G = g; g = null; if (twoF(e)) putBack(K, G.v0); else this.putXY(this.geo(e), 'end'); } };
    const lost = e => { if (g && e.pointerId === g.id) { g = null; this.putXY(null, 'end'); } };   // its pointerup went elsewhere
    dot.addEventListener('pointerup', up);
    dot.addEventListener('pointercancel', up);
    dot.addEventListener('lostpointercapture', lost);
    dot.addEventListener('keydown', e => {
      const k = e.key, st = e.shiftKey ? 0.001 : 0.01;
      if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); K.setN(P + '.pos', K.getN(P + '.pos') + (k === 'ArrowRight' ? st : -st), 'set'); }
      else if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); K.setN(P + '.gy', K.getN(P + '.gy') + (k === 'ArrowUp' ? st : -st), 'set'); }
    });
    // live position: the eff X / Y while notes sound, else the base (zoom view applied)
    K.live(() => {
      const on = this.shown && this.xyOn();
      if (dot.style.display !== (on ? '' : 'none')) dot.style.display = on ? '' : 'none';
      if (!on) return;
      const v = this.viewR(), x = (this.D.liveN(P + '.pos') - v.a) / (v.b - v.a), y = 1 - this.D.liveN(P + '.gy');
      const l = (clamp01(x) * 100).toFixed(2) + '%', t = (clamp01(y) * 100).toFixed(2) + '%';
      if (dot.style.left !== l) dot.style.left = l;
      if (dot.style.top !== t) dot.style.top = t;
    });
  }
}
// Send to Selected Clip (§7.5.6): slicesToNotes replaces the notes and length of clip.clips[clip.sel] (in place) — the
// slices span the processed sample (its length after the trim, smpCoords of ops); the clip bank is marked modified
function clipFromSlices(s, sl, info, ops, bpm) {
  const Cl = s.clip;
  if (!Cl || !Array.isArray(Cl.clips) || typeof core.slicesToNotes !== 'function' || !info || !(info.rate > 0)) return false;
  const c = Cl.clips[clamp(Cl.sel | 0, 0, Cl.clips.length - 1)];
  if (!c) return false;
  const r = core.slicesToNotes(sl.marks, smpCoords(ops).w * info.len / info.rate, bpm, sl.root), was = JSON.stringify([c.notes, c.len, c.start, c.off]);
  c.notes = r.notes;
  c.len = r.len16;
  if (!(c.start < c.len)) c.start = 0;
  if (!(c.off >= c.start && c.off < c.len)) c.off = c.start;
  if (JSON.stringify([c.notes, c.len, c.start, c.off]) !== was) Cl.dirty = 1;
  return true;
}
// Untrim (in place; the inverse of serum-core trimSample): ops.trim cleared, oscillator o's markers, slice marks and k.pos
// carried from the trimmed processed coordinates to the whole record's (still reversed when ops.rev) so they keep pointing
// at the same audio; k.pos as a Manual X|Y point through the same map, else as a read offset (kept in audio length)
function untrimSample(s, o) {
  const O = s && s.osc && s.osc[o], so = O && O.smpo, ops = so && so.ops;
  if (!ops || !Array.isArray(ops.trim)) return false;
  const Cc = smpCoords(ops), k = OSC_P[o], f = u => (Cc.rev ? 1 - Cc.t1 + u * Cc.w : Cc.t0 + u * Cc.w), g = u => u * Cc.w;
  for (const m of ['sstart', 'send', 'lstart', 'lend']) s.p[k + '.' + m] = clamp01(f(core.destBase(s, null, k + '.' + m))) + 0;
  const ty = core.oscTypeOf(s, o), pt = (ty === 'gran' || ty === 'spec') && O.xy && O.xy.on;
  s.p[k + '.pos'] = clamp01((pt ? f : g)(core.destBase(s, null, k + '.pos'))) + 0;
  const sl = so.slice;
  if (sl && Array.isArray(sl.marks)) {
    const out = [];
    for (const x of sl.marks) { const q = fin(x) ? r5(f(x)) : -1; if (q > 0 && q < 1 && out.indexOf(q) < 0) out.push(q); }
    sl.marks = out.sort((a, b) => a - b).slice(0, 256);
  }
  so.ops = Object.assign({}, ops, { trim: null });
  return true;
}

// Sample (§13.3, inv B6)
export class SampleView extends SmpBase {
  static get type() { return 'sample'; }
  menuItems() { return [{ label: 'Sample Display', sub: this.dispItems() }].concat(this.switchItems()); }
}

// Granular (§13.3, inv B7): the Sample view's display and menus + loop menu Loop Grains / Manual (X|Y), window popover,
// DENS, LENGTH, OFFSET, DIR (✓ Reverse Grains), PITCH, RAND LEN, RAND PAN, RAND LEVEL
const winFn = (k, u) => {
  switch (k) {
    case 1: return 1 - (2 * u - 1) * (2 * u - 1);
    case 2: return Math.exp(-0.5 * Math.pow((u - 0.5) / 0.15, 2));
    case 3: return 0.35875 - 0.48829 * Math.cos(2 * Math.PI * u) + 0.14128 * Math.cos(4 * Math.PI * u) - 0.01168 * Math.cos(6 * Math.PI * u);
    case 4: { const t = 4 * (2 * u - 1), sc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t); return sc * (0.5 - 0.5 * Math.cos(2 * Math.PI * u)); }
    case 5: return u < 0.25 ? 0.5 - 0.5 * Math.cos(2 * Math.PI * u / 0.5) : u > 0.75 ? 0.5 - 0.5 * Math.cos(2 * Math.PI * (1 - u) / 0.5) : 1;
    case 6: return 1 - Math.abs(2 * u - 1);
    case 7: return Math.min(1, 4 * u, 4 * (1 - u));
    case 8: return Math.exp(-6 * u) * Math.min(1, 200 * u);
    case 9: return Math.exp(-6 * (1 - u)) * Math.min(1, 200 * (1 - u));
    default: return 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
  }
};
const winPath = k => { let p = ''; for (let j = 0; j <= 16; j++) { const u = j / 16; p += (j ? 'L' : 'M') + (u * 15 + 0.5).toFixed(2) + ' ' + (14.5 - 13 * clamp01(winFn(k, u))).toFixed(2); } return p; };

export class GranView extends SampleView {
  static get type() { return 'gran'; }
  hasXY() { return true; }
  buildMore() {
    const K = this.kit, d = K.doc, o = this.o, P = this.P, T = OSC_T[o];
    // window button (popover: AMOUNT + rand, SKEW + rand, SHAPE ×10); Alt-drag on it: x = amount, y = skew
    const pane = paneEl(d);
    const shapes = K.bind(wk.iconSeg({ label: 'SHAPE', items: GRAIN_WINDOWS.map((w, k) => ({ icon: winPath(k), label: w.name })),
      get: () => this.O().smpo.win | 0, set: i => this.smpo(x => { x.win = i; }, 'Grain window') }));
    pane.append(row(d, this.kn('wamt', 'AMOUNT', 'sm'), K.num(P + '.rwamt', { label: 'RAND' }).el, this.kn('wskew', 'SKEW', 'sm'), K.num(P + '.rwskew', { label: 'RAND' }).el), shapes.el);
    const ico = svgEl(d, 'svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' }), path = svgEl(d, 'path', { d: winPath(0) });
    ico.appendChild(path);
    const wb = btn(d, 'sx-hbtn sxo-win', ico, 'Grain window (' + T + '); Alt-drag: amount (x) / skew (y)');
    wb.appendChild(mk(d, 'span', '', 'WINDOW'));
    let last = -1, gd = null;
    K.custom(() => { const k = this.O().smpo.win | 0; if (k !== last) { last = k; path.setAttribute('d', winPath(k)); } });
    wb.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !modsOf(e).alt) return;
      e.preventDefault();
      gd = { id: e.pointerId, x: e.clientX, y: e.clientY, a: K.getN(P + '.wamt'), k: K.getN(P + '.wskew'), moved: false };
      try { wb.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
      K.setN(P + '.wamt', gd.a, 'start'); K.setN(P + '.wskew', gd.k, 'start');
    });
    wb.addEventListener('pointermove', e => {
      if (!gd || e.pointerId !== gd.id) return;
      if (noButton(e)) { wup(e); return; }
      gd.moved = true;
      K.setN(P + '.wamt', clamp01(gd.a + (e.clientX - gd.x) / 150), 'move');
      K.setN(P + '.wskew', clamp01(gd.k + (gd.y - e.clientY) / 150), 'move');
    });
    const wup = e => {
      if (!gd || e.pointerId !== gd.id) return;
      const G = gd;
      gd = null;
      if (twoF(e)) { putBack(K, { [P + '.wamt']: G.a, [P + '.wskew']: G.k }); return; }   // a two-finger rollback
      K.setN(P + '.wamt', K.getN(P + '.wamt'), 'end'); K.setN(P + '.wskew', K.getN(P + '.wskew'), 'end');
      consumeMods();
      this.ateWin = G.moved ? Date.now() : 0;
    };
    wb.addEventListener('pointerup', wup);
    wb.addEventListener('pointercancel', wup);
    wb.addEventListener('lostpointercapture', wup);
    wb.addEventListener('click', () => { if (this.ateWin && Date.now() - this.ateWin < 400) { this.ateWin = 0; return; } openPane(K, 'win' + o, wb, T + ' grain window', pane); });
    const dens = extraMenu(this.kn('dens', 'DENS'), () => this.densItems());
    const glen = extraMenu(this.kn('glen', 'LENGTH'), () => this.glenItems());
    const dir = extraMenu(this.kn('rdir', 'DIR', 'sm'), () => { const on = K.getN(P + '.grev') >= 0.5; return [{ label: 'Reverse Grains', checked: on, action: () => K.setN(P + '.grev', on ? 0 : 1, 'set') }]; });
    this.el.append(row(d, wb, dens, glen),
      row(d, this.kn('roff', 'OFFSET', 'sm'), dir, this.kn('rpitch', 'PITCH', 'sm'), this.kn('rlen', 'RAND LEN', 'sm'), this.kn('rpan', 'RAND PAN', 'sm'), this.kn('rlvl', 'RAND LVL', 'sm')));
  }
  loopExtra() { return [{ sep: true }, this.smpTog('loopGrains', 'Loop Grains')].concat(this.xyItems(XY_Y_GRAN)); }
  scanExtra() { return [{ sep: true }, this.smpTog('scanKey', 'Key Track')]; }
  densItems() {
    const K = this.kit, g = this.O().smpo.dens;
    const set = (fn, label) => this.smpo(x => fn(x), label);
    return DENS_MODES.map((m, i) => ({ label: m, checked: (g.mode | 0) === i, action: () => set(x => { x.dens.mode = i; if (i === 2 && (x.glen.mode | 0) === 2) x.glen.mode = 0; }, 'Density mode') }))
      .concat([{ sep: true },
        { label: 'Triplet', checked: !!g.trip, disabled: (g.mode | 0) !== 1, action: () => set(x => { x.dens.trip = x.dens.trip ? 0 : 1; if (x.dens.trip) x.dens.dot = 0; }, 'Density triplet') },
        { label: 'Dotted', checked: !!g.dot, disabled: (g.mode | 0) !== 1, action: () => set(x => { x.dens.dot = x.dens.dot ? 0 : 1; if (x.dens.dot) x.dens.trip = 0; }, 'Density dotted') },
        { label: 'Jump Start', checked: !!g.jump, action: () => set(x => { x.dens.jump = x.dens.jump ? 0 : 1; }, 'Jump Start') },
        { label: 'Max Grains… (' + (g.max | 0) + ')', action: () => K.prompt('Max Grains', 'Grains (1–256, unison grains included)', String(g.max | 0), t => {
          const v = Math.round(parseFloat(String(t).replace(',', '.')));
          if (!(v >= 1 && v <= 256)) return false;
          set(x => { x.dens.max = v; }, 'Max Grains');
          return true;
        }) }]);
  }
  glenItems() {
    const g = this.O().smpo.glen, grains = (this.O().smpo.dens.mode | 0) === 2;
    const set = (fn, label) => this.smpo(x => fn(x), label);
    return GLEN_MODES.map((m, i) => ({ label: m, checked: (g.mode | 0) === i, disabled: i === 2 && grains, action: () => set(x => { x.glen.mode = i; }, 'Grain length mode') }))
      .concat([{ sep: true },
        { label: 'Triplet', checked: !!g.trip, disabled: (g.mode | 0) !== 1, action: () => set(x => { x.glen.trip = x.glen.trip ? 0 : 1; if (x.glen.trip) x.glen.dot = 0; }, 'Length triplet') },
        { label: 'Dotted', checked: !!g.dot, disabled: (g.mode | 0) !== 1, action: () => set(x => { x.glen.dot = x.glen.dot ? 0 : 1; if (x.glen.dot) x.glen.trip = 0; }, 'Length dotted') }]);
  }
}

// Spectral (§13.3, inv B8): spectrogram (S / E, Hi / Lo handles k.flo / k.fhi), the Sample view's menus, SCAN (+ Phase
// Lock, Transients), CUT, the spectral FILTER (curve editor kind 'spec' or a wavetable), MIX
export class SpecView extends SmpBase {
  static get type() { return 'spec'; }
  dispName() { return 'spectrogram'; }
  hasXY() { return true; }
  overlays(wrap) {
    const K = this.kit, d = K.doc, P = this.P;
    this.hl = [['fhi', 'HI'], ['flo', 'LO']].map(([k, t]) => {
      const id = P + '.' + k, h = mk(d, 'div', 'sxo-hl', t);
      h.setAttribute('role', 'slider');
      h.setAttribute('aria-label', OSC_T[this.o] + ' ' + (k === 'fhi' ? 'Freq Hi' : 'Freq Lo'));
      h.tabIndex = 0;
      K.dropTarget(h, id);
      wrap.appendChild(h);
      let g = null;
      // the handle sits at the frequency's height on the spectrogram's log axis (20 Hz … 20 kHz)
      const nAt = e => { const r = this.cv.el.getBoundingClientRect(), y = clamp01(1 - (e.clientY - r.top) / Math.max(1, r.height)); return core.lawNorm(id, 20 * Math.pow(1000, y)); };
      h.addEventListener('pointerdown', e => { if (e.button !== 0) return; e.stopPropagation(); e.preventDefault(); g = { id: e.pointerId, n0: K.getN(id) }; try { h.setPointerCapture(e.pointerId); } catch (err) { /* gone */ } K.setN(id, nAt(e), 'start'); });
      h.addEventListener('pointermove', e => { if (g && e.pointerId === g.id) { if (noButton(e)) lost(e); else K.setN(id, nAt(e), 'move'); } });
      // (a two-finger rollback, twoF: the frequency from before the press — the press itself jumped it)
      const up = e => { if (g && e.pointerId === g.id) { const G = g; g = null; if (twoF(e)) putBack(K, { [id]: G.n0 }); else K.setN(id, nAt(e), 'end'); } };
      const lost = e => { if (g && e.pointerId === g.id) { g = null; K.setN(id, K.getN(id), 'end'); } };   // its pointerup went elsewhere
      h.addEventListener('pointerup', up);
      h.addEventListener('pointercancel', up);
      h.addEventListener('lostpointercapture', lost);
      h.addEventListener('keydown', e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); K.setN(id, K.getN(id) + (e.key === 'ArrowUp' ? 0.01 : -0.01), 'set'); } });
      return { h, id };
    });
    K.live(() => {
      for (const { h, id } of this.hl) {
        const t = ((1 - yOfHz(core.lawValue(id, this.D.liveN(id)))) * 100).toFixed(2) + '%';
        if (h.style.top !== t) h.style.top = t;
      }
    });
  }
  buildMore() {
    const K = this.kit, D = this.D, d = K.doc, o = this.o, T = OSC_T[o];
    // the spectral FILTER: a preview (click opens the curve editor popover), presets / wavetable menu
    const fcv = K.canvas('sxo-mini', () => this.filtKey(), (g, w, h, dpr) => this.drawFilt(g, w, h, dpr));
    fcv.el.tabIndex = 0;
    fcv.el.setAttribute('role', 'button');
    fcv.el.setAttribute('aria-label', T + ' spectral filter: click to edit');
    const open = () => {
      const Ed = gx.CurveEditor;
      if (typeof Ed !== 'function') { K.notify('Curve editor not available'); return; }
      K.popover('sflt' + o, fcv.el, T + ' spectral filter', box => new Ed(box, {
        kind: 'spec', height: 150,
        get: () => this.O().spec.filt.pts,
        set: (pts, ph) => K.edit(s => { s.osc[o].spec.filt.pts = pts; s.osc[o].spec.filt.kind = 'curve'; }, { label: 'Spectral filter', phase: ph }),
        gridField: { get: () => this.O().spec.filt.grid | 0, set: (g, ph) => K.edit(s => { s.osc[o].spec.filt.grid = clamp(Math.round(g), 0, 64); }, { label: 'Spectral filter grid', phase: ph }) },
        presets: () => this.filtPresets(),
      }), () => JSON.stringify(this.O().spec.filt));
    };
    fcv.el.addEventListener('click', open);
    fcv.el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    fcv.el.addEventListener('contextmenu', e => { e.preventDefault(); wk.contextMenu(e.clientX, e.clientY, this.filtPresets(), { anchor: fcv.el }); });
    this.el.append(fcv.el, row(d, this.kn('cut', 'CUT', 'sm'), this.kn('smix', 'MIX', 'sm')));
    void D;
  }
  // Key Track as the Granular SCAN menu (inv B8 lists it for Spectral too; sx-spec honours sScanKey), + Phase Lock, Transients
  scanExtra() { return [{ sep: true }, this.smpTog('scanKey', 'Key Track'), this.smpTog('phaseLock', 'Phase Lock'), this.smpTog('transients', 'Transients')]; }
  loopExtra() { return this.xyItems(XY_Y_SPEC); }
  dispItems() {
    const K = this.kit, o = this.o, O = this.O(), tg = (get, put, label) => ({ label, checked: !!get(O), action: () => K.edit(s => put(s.osc[o]), { label }) });
    return [{ label: 'Show Waveform Display', checked: !!O.smpo.wave, action: () => this.uiSmpo(x => { x.wave = x.wave ? 0 : 1; }) },
      tg(x => x.spec.smooth, x => { x.spec.smooth = x.spec.smooth ? 0 : 1; }, 'Smooth'),
      tg(x => x.spec.postWarp, x => { x.spec.postWarp = x.spec.postWarp ? 0 : 1; }, 'Post Warp'),
      { sep: true }].concat(super.dispItems());
  }
  menuItems() { return [{ label: 'Spectrogram', sub: this.dispItems() }, { label: 'Spectral Filter', sub: this.filtPresets() }].concat(this.switchItems()); }
  // presets menu (§13.3): Factory ▸, User ▸, Save…, Default; Use Wavetable as Filter ▸ / Curve Filter
  filtPresets() {
    const K = this.kit, o = this.o, F = this.O().spec.filt, St = K.host && K.host.storage;
    const user = () => { try { return St && St.get ? arr(St.get('synth.sx.specfilt', [])) : []; } catch (err) { return []; } };
    const setPts = (pts, name) => K.edit(s => { s.osc[o].spec.filt.kind = 'curve'; s.osc[o].spec.filt.pts = clone(pts); }, { label: 'Spectral filter: ' + name });
    const fac = arr(core.FACTORY_SPEC_FILTERS).map(p => ({ label: p.name, action: () => setPts(p.pts, p.name) }));
    const us = user().filter(p => p && p.name && Array.isArray(p.pts)).map(p => ({ label: p.name, action: () => setPts(p.pts, p.name) }));
    return [
      { label: 'Factory', disabled: !fac.length, sub: fac },
      { label: 'User', disabled: !us.length, sub: us },
      { label: 'Save…', disabled: !St || typeof St.set !== 'function' || F.kind !== 'curve', action: () => K.prompt('Save Spectral Filter', 'Name', '', t => {
        const name = String(t).trim().slice(0, 32);
        if (!name) return false;
        try { St.set('synth.sx.specfilt', user().filter(p => p && p.name !== name).concat([{ name, pts: clone(F.pts) }])); K.notify('Saved “' + name + '”'); } catch (err) { K.notify('Could not save the filter'); }
        return true;
      }) },
      { label: 'Default', action: () => setPts([[0, 1, 0], [1, 1, 0]], 'Default') },
      { sep: true },
      { label: 'Use Wavetable as Filter', sub: this.D.wtItems(o, F.wt || '').map(it => ({ label: it.label, checked: F.kind === 'wt' && F.wt === it.v,
        action: () => this.useWtFilter(it.v) })) },
      { label: 'Curve Filter', checked: F.kind !== 'wt', action: () => K.edit(s => { s.osc[o].spec.filt.kind = 'curve'; }, { label: 'Curve filter' }) },
    ];
  }
  // ▸ Use Wavetable as Filter (§6.10.6): the table's frame 0 becomes the curve the DSP compiles — spec.filt = {kind 'wt',
  // wt, pts: frameToPoints(frame 0, 128)} (frameToPoints maps y = 0.5 + 0.5·x) — in one edit once the table is loaded
  async useWtFilter(id) {
    const K = this.kit, D = this.D, o = this.o, wt = K.wt || {};
    if (typeof wt.frameToPoints !== 'function') { K.notify('Use Wavetable as Filter is not available'); return false; }
    const info = await D.tableEntry(id).p;
    if (K.dead()) return false;
    const fr = info && info.table && info.table.frames ? info.table.frames[0] : null;
    if (!fr) { K.notify('Wavetable not found: ' + nameOfId(id)); return false; }
    const pts = wt.frameToPoints(fr, 128);
    K.edit(s => { const F = s.osc[o].spec.filt; F.kind = 'wt'; F.wt = id; F.pts = pts; }, { label: 'Wavetable as filter' });
    return true;
  }
  filtKey() {
    if (!this.active()) return 'off';
    const F = this.O().spec.filt;
    return [F.kind, F.wt, JSON.stringify(F.pts), this.D.liveN(this.P + '.cut').toFixed(3), this.D.liveN(this.P + '.smix').toFixed(3)].join('|');
  }
  // the filter's gain curve (x = log frequency) shifted by CUT (−1…+1 = ±half the axis) and mixed with MIX: the points
  // the DSP compiles (a wavetable filter's are its frame 0, stored when it was chosen)
  drawFilt(g, w, h, dpr) {
    const F = this.O().spec.filt, cut = 2 * this.D.liveN(this.P + '.cut') - 1, mix = this.D.liveN(this.P + '.smix');
    const gain = u => core.evalPts(F.pts, clamp01(u));
    g.font = Math.round(9 * dpr) + 'px ui-monospace, monospace';
    g.beginPath();
    for (let x = 0; x <= w; x++) {
      const u = x / w - 0.5 * cut, v = 1 - mix + mix * clamp01(gain(u));
      const y = h - 2 * dpr - v * (h - 6 * dpr);
      if (x) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.strokeStyle = OSC_COL[this.o]; g.lineWidth = 1.4 * dpr; g.stroke();
    g.fillStyle = C.mute;
    g.fillText(F.kind === 'wt' ? 'WT FILTER · ' + nameOfId(F.wt) : 'FILTER', 6 * dpr, 11 * dpr);
  }
  bgKey() { const id = this.O().smp; return [this.D.spectrogram(id) ? 1 : 0, this.O().smpo.wave, this.O().smpo.wave ? (this.D.overview(id) ? 1 : 0) : ''].join(','); }
  // the spectrogram over the processed view range (through trim; mirrored when reversed, as the waveform), its rows
  // (log 20 Hz … rate/2 from the host) placed on the panel's 20 Hz … 20 kHz axis (yOfHz: the Hi / Lo handles, the dimming)
  drawBg(g, w, h, dpr, v) {
    const id = this.O().smp, sp = this.D.spectrogram(id), Cc = smpCoords(this.O().smpo.ops), info = this.D.smpInfo(id);
    if (this.drawMsg(g, w, h, dpr, '')) return;
    const x0 = Cc.toRec(v.a), x1 = Cc.toRec(v.b), lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    if (sp) {
      // a cached offscreen image of the spectrogram (palette: dark → blue → white)
      if (!sp.img && typeof g.createImageData === 'function') {
        try {
          const im = g.createImageData(sp.w, sp.h);
          if (im && im.data) {
            for (let i = 0; i < sp.w * sp.h; i++) { const q = sp.data[i] / 255; im.data[4 * i] = 255 * q * q; im.data[4 * i + 1] = 255 * Math.pow(q, 1.4) * 0.85; im.data[4 * i + 2] = 255 * Math.sqrt(q); im.data[4 * i + 3] = 255; }
            const c = this.kit.doc.createElement('canvas');
            c.width = sp.w; c.height = sp.h;
            const cg = c.getContext ? c.getContext('2d') : null;
            if (cg && typeof cg.putImageData === 'function') { cg.putImageData(im, 0, 0); sp.img = c; }
          }
        } catch (err) { warnOnce('spimg', 'sx-ui-osc: spectrogram image', err); sp.img = false; }
      }
      if (sp.img && typeof g.drawImage === 'function') {
        const R = specRect(sp.w, sp.h, lo, hi, info && info.rate > 0 ? info.rate : 48000, h);
        if (Cc.rev && typeof g.save === 'function') {
          g.save(); g.translate(w, 0); g.scale(-1, 1);
          g.drawImage(sp.img, R.sx, R.sy, R.sw, R.sh, 0, R.dy, w, R.dh);
          g.restore();
        } else g.drawImage(sp.img, R.sx, R.sy, R.sw, R.sh, 0, R.dy, w, R.dh);
      }
    } else { g.fillStyle = C.mute; g.font = Math.round(10 * dpr) + 'px ui-monospace, monospace'; g.fillText('Analysing…', 8 * dpr, 16 * dpr); }
    if (this.O().smpo.wave) { const ov = this.D.overview(id); if (ov) drawOverview(g, ov, [lo, hi], w, h, 'rgba(223, 230, 238, 0.35)', Cc.rev); }
    // the band outside Lo … Hi dimmed
    const flo = 1 - yOfHz(core.lawValue(this.P + '.flo', this.D.liveN(this.P + '.flo'))), fhi = 1 - yOfHz(core.lawValue(this.P + '.fhi', this.D.liveN(this.P + '.fhi')));
    g.fillStyle = 'rgba(10, 13, 16, 0.5)';
    if (fhi > 0) g.fillRect(0, 0, w, fhi * h);
    if (flo < 1) g.fillRect(0, flo * h, w, h - flo * h);
  }
}

// the type views of an oscillator panel, in core.OSC_TYPES order
const VIEWS = [WTView, MultiView, SampleView, GranView, SpecView];

export class OscPanel {
  constructor(root, kit, o) {
    this.kit = kit;
    this.o = oscIdx(o);
    this.P = OSC_P[this.o];
    this.D = oscData(kit);
    this.views = {};
    ensureCSS(kit.doc);
    this.el = this.build();
    if (root) root.appendChild(this.el);
  }
  O() { return this.kit.s().osc[this.o]; }
  build() {
    const K = this.kit, d = K.doc, o = this.o, P = this.P, T = OSC_T[o];
    // the shell's module menu (Lock / Init / Copy / Paste, label drags: serum-ui) gets this panel's items (§13.3);
    // collapse: the shell folds to its title row while the oscillator is off (C1, as SUB, NOISE and the filters)
    const shell = K.panel(T, OSC_M[o], P + '.on', '', { items: () => this.menuItems(), collapse: true });
    const { el, head, body } = shell;
    this.shell = shell;
    el.classList.add('sxo-osc');
    if (el.style && el.style.setProperty) el.style.setProperty('--sxo-c', OSC_COL[o]);
    // type menu (§13.3 header): Wavetable · Multisample · Sample · Granular · Spectral
    const type = pMenu(K, { label: T + ' type', items: () => OSC_TYPES.map(t => ({ v: t.id, label: t.name })), get: () => core.oscTypeOf(K.s(), o),
      set: v => K.edit(s => { s.osc[o].type = v; }, { label: T + ' type' }) });
    type.el.classList.add('sxo-type');
    head.appendChild(type.el);
    for (const V of VIEWS) {
      const v = new V(body, K, o);
      this.views[v.type] = v;
      if (v.head.length) head.append(...v.head);
    }
    const route = routeControls(K, { key: 'route' + o, title: T, obj: s => s.osc[o], routes: ['Filter', 'Main', 'Direct', 'None'], fbal: P + '.fbal', bus: [P + '.bus1', P + '.bus2'] });
    this.mapPane = mapPane(K, T, s => s.osc[o]);
    head.append(route.btn);
    this.route = route;
    K.custom(() => { const t = core.oscTypeOf(K.s(), o); for (const V of VIEWS) { const v = this.views[V.type]; if (v.shown !== (V.type === t)) v.show(V.type === t); } });
    body.append(this.pitchRow(), this.uniRow(), this.warpRow(0), this.warpRow(1), row(d, K.knob(P + '.pan', { label: 'PAN', size: 'sm' }).el, K.knob(P + '.level', { label: 'LEVEL' }).el));
    return el;
  }
  // the view of the oscillator's current type
  view() { return this.views[core.oscTypeOf(this.kit.s(), this.o)] || this.views.wt; }

  /* -------------------------------------------------- pitch row (inv B2, §6.3.3) */
  pitchRow() {
    const K = this.kit, d = K.doc, o = this.o, P = this.P, T = OSC_T[o], mode = () => (this.O().pitch && this.O().pitch.mode) || 'semi';
    const oct = extraMenu(K.knob(P + '.oct', { label: 'OCT', size: 'sm' }).el, () => this.pitchItems());
    const sem = extraMenu(K.knob(P + '.semi', { label: 'SEM', size: 'sm', labelFn: () => ({ harm: 'HARM', step: 'STEP' })[mode()] || 'SEM' }).el, () => this.pitchItems());
    const src = pMenu(K, { label: 'SRC', items: () => [{ v: 'note', label: 'Note' }].concat(others(o).map(j => ({ v: 'ABC'[j], label: 'ABC'[j] }))),
      get: () => this.O().pitch.src, set: v => this.pitchEdit(undefined, v, 'Ratio source') });
    const ratio = extraMenu(K.knob(P + '.ratio', { label: 'RATIO', size: 'sm' }).el, () => this.pitchItems());
    const hzPane = paneEl(d);
    hzPane.append(row(d, K.knob(P + '.hz', { label: 'HZ', size: 'sm' }).el, mk(d, 'span', 'sxo-hint', 'Linear detune in Hz (Hz Offset)')));
    const hzb = btn(d, 'sx-hbtn', icon(d, 'more'), 'More pitch controls (' + T + ')', () => openPane(K, 'hz' + o, hzb, T + ' pitch', hzPane));
    K.custom(() => { const r = mode() === 'ratio'; hide(oct, r); hide(sem, r); hide(src.el, !r); hide(ratio, !r); });
    return row(d, oct, sem, src.el, ratio, K.knob(P + '.fine', { label: 'FIN', size: 'sm' }).el, K.knob(P + '.crs', { label: 'CRS', size: 'sm' }).el, hzb);
  }
  // OCT / SEM menu: Semitones · Harmonics · Ratio · Step (only with a .scl tuning)
  pitchItems() {
    const K = this.kit, o = this.o, s = K.s(), cur = (this.O().pitch && this.O().pitch.mode) || 'semi', scl = !!(s.global && s.global.tun && s.global.tun.kind === 'scl');
    return PITCH_MODES.map(m => ({ label: m.id === 'step' && !scl ? 'Step (load a .scl tuning)' : m.name, checked: cur === m.id, disabled: m.id === 'step' && !scl,
      action: () => this.pitchEdit(m.id, undefined, 'Pitch mode') }));
  }
  // pitch mode / ratio source of this oscillator (serum-core pitchChoice, §2.2.5): a ratio-source cycle of any length
  // through it is broken with this choice as the most recent one — the oscillator that read this one falls back to Note
  // (notice), so the state needs no normalisation (it sounds the same after a reload)
  pitchEdit(mode, src, label) {
    const K = this.kit, o = this.o;
    let reset = [];
    K.edit(s => {
      if (typeof core.pitchChoice === 'function') reset = core.pitchChoice(s, o, mode === undefined ? null : mode, src === undefined ? null : src) || [];
      else { if (mode !== undefined) s.osc[o].pitch.mode = mode; if (src !== undefined) s.osc[o].pitch.src = src === 'ABC'[o] ? 'note' : src; }
    }, { label });
    if (reset.length) K.notify('Ratio source cycle: ' + reset.map(j => OSC_T[j]).join(', ') + ' set to Note');
  }

  /* -------------------------------------------------- unison row + gear popover (inv B4) */
  uniRow() {
    const K = this.kit, d = K.doc, o = this.o, P = this.P, T = OSC_T[o];
    const uni = K.num(P + '.uni', { label: 'UNISON' });
    K.live(() => { const sn = K.snap(); uni.el.classList.toggle('sx-amber', !!(sn && sn.oscVoices > 128)); });   // > 128 voices
    const pane = paneEl(d), t = () => core.oscTypeOf(K.s(), o);
    const mode = pSeg(K, { label: 'MODE', items: UNI_MODES.slice(), get: () => this.O().uni.mode | 0, set: i => K.edit(s => { s.osc[o].uni.mode = i; }, { label: 'Unison mode' }) });
    const range = pNum(K, { label: 'RANGE', get: () => clamp01(this.O().uni.range / 48), def: 2 / 48, steps: 4800,
      fmt: n => (48 * n).toFixed(2) + ' st', parse: tx => { const v = parseFloat(String(tx).replace(',', '.')); return isFinite(v) ? clamp01(v / 48) : null; },
      set: (n, ph) => K.edit(s => { s.osc[o].uni.range = Math.round(4800 * clamp01(n)) / 100; }, { label: 'Unison range', phase: ph }) });
    const wtpos = K.knob(P + '.uniwt', { label: 'WT POS', size: 'sm' }).el;
    const start = K.knob(P + '.ustart', { label: 'START', size: 'sm' }).el, span = K.knob(P + '.uspan', { label: 'SPAN', size: 'sm' }).el;
    const spawn = pSeg(K, { label: 'SPAWN PATTERN', items: UNI_SPAWN.slice(), get: () => this.O().uni.spawn | 0, set: i => K.edit(s => { s.osc[o].uni.spawn = i; }, { label: 'Spawn pattern' }) });
    pane.append(mode.el, row(d, K.num(P + '.stack', { label: 'STACK' }).el, range.el, K.knob(P + '.uniw', { label: 'WIDTH', size: 'sm' }).el, wtpos),
      row(d, K.knob(P + '.uniwarp', { label: 'WARP 1', size: 'sm' }).el, K.knob(P + '.uniwarp2', { label: 'WARP 2', size: 'sm' }).el, start, span), spawn.el);
    K.custom(() => { const ty = t(); hide(wtpos, ty !== 'wt'); hide(start, !smpType(ty)); hide(span, !smpType(ty)); hide(spawn.el, ty !== 'gran'); });
    const gear = btn(d, 'sx-hbtn', icon(d, 'gear'), 'Unison settings (' + T + ')', () => openPane(K, 'uni' + o, gear, T + ' unison', pane));
    return row(d, uni.el, gear, K.knob(P + '.det', { label: 'DETUNE', size: 'sm' }).el, K.knob(P + '.blend', { label: 'BLEND', size: 'sm' }).el);
  }

  /* -------------------------------------------------- WARP 1 / WARP 2 (inv B3, B3.1; §3.4) */
  // Slot k: the mode menu (◀ ▶; WARPS2 grouped, spectral modes greyed; S1 mode slot 1 of A / B: the Phase-1 list on
  // k.warpMode), the amount knob, Var fader (Sync), FM type seg (FM modes), remap pen (Remap 1–4), RAND (Granular)
  warpRow(k) {
    const K = this.kit, d = K.doc, o = this.o, P = this.P, T = OSC_T[o];
    const wid = P + (k ? '.w2' : '.w1'), amt = P + (k ? '.warp2' : '.warp'), vid = P + (k ? '.wvar2' : '.wvar1');
    const legacy = () => k === 0 && o < 2 && s1Of(K.s());
    const mode2 = () => Math.round(81 * K.getN(wid)), mode1 = () => Math.round(22 * K.getN(P + '.warpMode'));
    // a mode choice (warpChoice2: a closed oscillator cycle sets the other oscillators' conflicting slots Off, with a
    // notice); every slot it wrote keeps its S1 pair in sync (§2.6.4: the chosen one and those set Off)
    const choose = (id, steps) => v => K.edit(s => {
      const other = o < 2 ? OSC_P[1 - o] + '.warpMode' : '', was = other ? s.p[other] : 0;
      const off = core.warpChoice2(s, o, k, Math.round(v * steps)) || [];
      if (typeof core.syncS1 === 'function') {
        core.syncS1(s, id);
        const s1 = s1Of(s);
        for (const x of off) core.syncS1(s, OSC_P[x.o] + (s1 && x.o < 2 && x.slot === 0 ? '.warpMode' : x.slot ? '.w2' : '.w1'));
        // S1 mode: the Phase-1 rule of the v1 slot (warpChoice) clears the other one's FM / AM / RM from this oscillator
        if (other && s.p[other] !== was) core.syncS1(s, other);
      }
      if (off.length) K.notify('Warp cycle: ' + off.map(x => OSC_T[x.o] + ' WARP ' + (x.slot + 1)).join(', ') + ' set Off');
    }, { label: 'Warp mode' });
    // §13.3: the opened list also holds the slot's FM types (radio items in the FM category) and Swap Warps; ◀ ▶, the
    // wheel and ← → step through the warp modes only (wk.menu steps through every value item: the action items are
    // listed only for the list that opens — a press / ↓ ↑ on the menu button, flagged around wk.menu's own handler)
    let opening = false;
    const onBtn = (e, el) => { for (let n = e.target; n && n !== el; n = n.parentNode) if (n.classList && n.classList.contains('wk-mbtn')) return true; return false; };
    const flagOpen = el => {
      el.addEventListener('click', e => { if (onBtn(e, el)) opening = true; }, true);
      el.addEventListener('keydown', e => { if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && onBtn(e, el)) opening = true; }, true);
      el.addEventListener('click', () => { opening = false; });
      el.addEventListener('keydown', () => { opening = false; });
    };
    const withActs = (L, fmTypes) => {
      if (!opening) return L;
      const ft = arr(this.O().fm)[k] | 0, names = Array.isArray(core.FM_TYPES) ? core.FM_TYPES : ['Thru-Zero', 'Exp', 'Linear'];
      const fmIt = fmTypes ? names.map((nm, i) => ({ v: 'fm:' + i, label: (ft === i ? '● ' : '○ ') + nm, group: 'FM' })) : [];
      const at = fmTypes ? L.reduce((x, it, i) => (it.group === 'FM' ? i + 1 : x), L.length) : L.length;
      return L.slice(0, at).concat(fmIt, L.slice(at), [{ v: 'swap', label: 'Swap Warps', group: '' }]);
    };
    const setV = (id, steps) => { const c = choose(id, steps); return v => (v === 'swap' ? this.swapWarps() : typeof v === 'string' && v.slice(0, 3) === 'fm:' ? this.setFm(k, +v.slice(3)) : c(v)); };
    const m2 = K.bind(wk.menu({ dest: wid, label: 'WARP ' + (k + 1), items: () => withActs(warpMenuItems(K.s(), o), true), get: () => K.getN(wid), set: setV(wid, 81), arrows: true }));
    flagOpen(m2.el);
    extraMenu(m2.el, () => this.warpItems(k));
    const els = [mk(d, 'span', 'sxo-wl', String(k + 1)), m2.el];
    let m1 = null;
    if (k === 0 && o < 2) {   // S1 mode: the v1 slot (a.warpMode / b.warpMode, 23 modes)
      m1 = K.bind(wk.menu({ dest: P + '.warpMode', label: 'WARP MODE', items: () => withActs(WARPS.map((w, i) => ({ v: i / 22, label: o ? w.nameB : w.name })), false),
        get: () => K.getN(P + '.warpMode'), set: setV(P + '.warpMode', 22), arrows: true }));
      flagOpen(m1.el);
      extraMenu(m1.el, () => this.warpItems(k));
      els.push(m1.el);
      K.custom(() => { const L = legacy(); hide(m1.el, !L); hide(m2.el, L); });
    }
    const knob = K.knob(amt, { label: k ? 'WARP 2' : 'WARP', size: 'sm', bipolarFn: () => (legacy() ? BIP1.includes(mode1()) : BIP2.includes(mode2())) }).el;
    const vsl = dSlider(K, vid, { label: 'VAR' });
    vsl.el.classList.add('sxo-var');
    const fm = pSeg(K, { label: '', items: ['TZ', 'EXP', 'LIN'], get: () => arr(this.O().fm)[k] | 0, set: i => this.setFm(k, i) });
    fm.el.classList.add('sxo-fm');
    fm.el.title = 'FM type: Thru-Zero / Exp / Linear';
    const pen = btn(d, 'sx-hbtn', icon(d, 'edit'), 'Edit remap curve (' + T + ', WARP ' + (k + 1) + ')', () => this.remap(pen));
    const rnd = K.knob(P + (k ? '.rwarp2' : '.rwarp'), { label: 'RAND', size: 'sm' }).el;
    K.custom(() => {
      const L = legacy(), m = L ? -1 : mode2(), lm = L ? mode1() : -1;
      hide(vsl.el, m !== 1);
      hide(fm.el, !isFm(m));
      hide(pen, !(isRemap2(m) || (lm >= 13 && lm <= 16)));
      hide(rnd, core.oscTypeOf(K.s(), o) !== 'gran');
    });
    const r = row(d, ...els, knob, vsl.el, fm.el, pen, rnd);
    r.classList.add('sxo-wrow');
    return r;
  }
  // a warp menu's own items: FM type (Thru-Zero / Exp / Linear) of an FM slot, Swap Warps
  warpItems(k) {
    const K = this.kit, o = this.o, m = Math.round(81 * K.getN(this.P + (k ? '.w2' : '.w1'))), legacy = k === 0 && o < 2 && s1Of(K.s()), ft = arr(this.O().fm)[k] | 0;
    const out = [];
    if (!legacy && isFm(m)) {
      for (let i = 0; i < 3; i++) out.push({ label: (core.FM_TYPES || ['Thru-Zero', 'Exp', 'Linear'])[i], checked: ft === i, action: () => this.setFm(k, i) });
      out.push({ sep: true });
    }
    out.push({ label: 'Swap Warps', action: () => this.swapWarps() });
    return out;
  }
  setFm(k, i) { const o = this.o; this.kit.edit(s => { s.osc[o].fm[k] = clamp(i | 0, 0, 2); }, { label: 'FM type' }); }
  // Swap Warps (serum-core swapWarps), the slot-1 S1 pair synced afterwards (§2.6.4)
  swapWarps() {
    const K = this.kit, o = this.o, P = this.P;
    let ok = true;
    K.edit(s => { ok = core.swapWarps(s, o); if (ok && typeof core.syncS1 === 'function') core.syncS1(s, P + '.w1'); }, { label: 'Swap Warps' });
    if (!ok) K.notify('S1 mode: WARP 2’s mode has no Serum 1 equivalent for WARP 1');
  }
  // remap curve popover (Remap 1–4 of either slot; the Phase-1 modes 13–16 in S1 mode)
  remap(anchor) {
    const K = this.kit, o = this.o, Ed = gx.CurveEditor, T = OSC_T[o] + ' remap';
    if (typeof Ed !== 'function') { K.notify('Curve editor not available'); return; }
    K.popover('remap' + o, anchor, T, eb => new Ed(eb, {
      get: () => K.s().osc[o].remap,
      set: (pts, ph) => K.edit(s => { s.osc[o].remap = pts; }, { label: T, phase: ph }),
      grid: () => { const g = K.s().lfoGrid; return { x: g.x, y: g.y }; },
      kind: 'remap', shapes: K.shapes(), height: 150,
    }), () => JSON.stringify([K.s().osc[o].remap, K.s().lfoGrid]));
  }

  /* -------------------------------------------------- module menu items (after the shell's Lock / Init / Copy / Paste) */
  // ✓ Enable Pitch Tracking, ✓ Pitch Bend Tracking (tracking off, Sample / Granular / Spectral), Edit Note Ranges…,
  // Swap Warps, then the shown view's own items (Swap with ▸ is the shell's own module-menu item, serum-ui)
  menuItems() {
    const K = this.kit, o = this.o, P = this.P, T = OSC_T[o], O = this.O(), trk = K.getN(P + '.track') >= 0.5, t = core.oscTypeOf(K.s(), o);
    const items = [{ label: 'Enable Pitch Tracking', checked: trk, action: () => K.setN(P + '.track', trk ? 0 : 1, 'set') }];
    if (!trk && smpType(t)) items.push({ label: 'Pitch Bend Tracking', checked: !!O.bendTrack, action: () => K.edit(s => { s.osc[o].bendTrack = s.osc[o].bendTrack ? 0 : 1; }, { label: 'Pitch Bend Tracking' }) });
    items.push({ label: 'Edit Note Ranges…', action: () => openPane(K, 'map' + o, this.shell.name || this.route.btn, T + ' note ranges', this.mapPane) },
      { label: 'Swap Warps', action: () => this.swapWarps() });
    const v = this.view(), extra = v ? v.menuItems() : [];
    if (t === 'wt') extra.push({ label: 'Smooth Interpolation', checked: !!O.smoothWT, action: () => K.edit(s => { s.osc[o].smoothWT = s.osc[o].smoothWT ? 0 : 1; }, { label: 'Smooth Interpolation' }) },
      { label: 'Phase Memory', sub: this.views.wt.phaseItems() });
    return extra.length ? items.concat([{ sep: true }], extra) : items;
  }
}
/* ================================================================ SUB (inv B9) */

const SUB_SH = [p => -Math.sin(2 * Math.PI * p), p => -Math.tanh(4 * Math.sin(2 * Math.PI * p)) / Math.tanh(4), p => -(1 - 4 * Math.abs(frac(p + 0.25) - 0.5)),
  p => 1 - 2 * frac(p + 0.5), p => (p < 0.5 ? -1 : 1), p => (p < 0.25 ? -1 : 1 / 3)];
const SUB_OF_V1 = [0, 1, 3, 4, 5];   // the Phase-1 shapes' drawings (S1_TO_S2_SUB)

export class SubPanel {
  constructor(root, kit) {
    this.kit = kit;
    ensureCSS(kit.doc);
    this.el = this.build();
    if (root) root.appendChild(this.el);
  }
  // module menu items: ✓ Enable Pitch Tracking (s.track), Edit Note Ranges…
  menuItems() {
    const K = this.kit, trk = K.getN('s.track') >= 0.5;
    return [{ label: 'Enable Pitch Tracking', checked: trk, action: () => K.setN('s.track', trk ? 0 : 1, 'set') },
      { label: 'Edit Note Ranges…', action: () => openPane(K, 'map-sub', this.shell.name || this.route.btn, 'SUB note ranges', this.map) }];
  }
  build() {
    const K = this.kit, d = K.doc, shell = K.panel('SUB', 'sub', 's.on', '', { items: () => this.menuItems(), collapse: true }), { el, head, body } = shell;
    this.shell = shell;
    el.classList.add('sxo-mod');
    if (el.style && el.style.setProperty) el.style.setProperty('--sxo-c', '#a78bfa');
    // S2: 6 shapes (s.shp); S1 mode: the Phase-1 5 (s.shape) — both built, one shown
    const shape2 = K.menu('s.shp', () => enumItems('s.shp', SUB_SHAPES2.map(x => x.name)), { label: 'Sub shape' });
    const shape1 = K.menu('s.shape', () => enumItems('s.shape', SUB_SHAPES.map(x => x.name)), { label: 'Sub shape (S1)' });
    shape2.el.classList.add('sx-grow'); shape1.el.classList.add('sx-grow');
    const ico = mk(d, 'span', 'sx-ico'), sv = svgEl(d, 'svg', { viewBox: '0 0 32 16', 'aria-hidden': 'true' }), path = svgEl(d, 'path', { d: '' });
    sv.appendChild(path); ico.appendChild(sv);
    let last = -1;
    K.custom(() => {
      const s1 = s1Of(K.s());
      hide(shape2.el, s1); hide(shape1.el, !s1);
      const k = s1 ? SUB_OF_V1[Math.round(4 * K.getN('s.shape'))] : Math.round(5 * K.getN('s.shp'));
      if (k === last || !SUB_SH[k]) return;
      last = k;
      let dd = '';
      for (let j = 0; j <= 64; j++) dd += (j ? 'L' : 'M') + (j / 2).toFixed(2) + ' ' + (8 - 6 * SUB_SH[k](j / 64)).toFixed(2);
      path.setAttribute('d', dd);
    });
    const route = routeControls(K, { key: 'route-sub', title: 'SUB', obj: s => s.sub, routes: ['Filter', 'Main', 'Direct', 'None'], fbal: 's.fbal', bus: ['s.bus1', 's.bus2'] });
    this.route = route;
    this.map = mapPane(K, 'SUB', s => s.sub);
    head.append(shape2.el, shape1.el, ico, route.btn);
    const crs = K.knob('s.crs', { label: 'CRS', size: 'sm', disabled: () => s1Of(K.s()) }).el;
    const phase = extraMenu(K.knob('s.phase', { label: 'PHASE', size: 'sm' }).el, () => [{ label: 'Contiguous', checked: !!K.s().sub.contig,
      action: () => K.edit(s => { s.sub.contig = s.sub.contig ? 0 : 1; }, { label: 'Sub phase contiguous' }) }]);
    body.append(row(d, K.num('s.oct', { label: 'OCTAVE' }).el, crs, phase, K.knob('s.pan', { label: 'PAN', size: 'sm' }).el, K.knob('s.level', { label: 'LEVEL' }).el));
    return el;
  }
}

/* ================================================================ NOISE (inv B10) */

export class NoisePanel {
  constructor(root, kit) {
    this.kit = kit;
    this.D = oscData(kit);
    ensureCSS(kit.doc);
    this.el = this.build();
    if (root) root.appendChild(this.el);
  }
  isColor() { return /^color:/.test(this.kit.s().noise.src); }
  // module menu items (inv B2): ✓ Pitch Track (noise.keytrack), Edit Note Ranges…
  menuItems() {
    const K = this.kit, trk = !!K.s().noise.keytrack;
    return [{ label: 'Pitch Track', checked: trk, action: () => K.edit(s => { s.noise.keytrack = s.noise.keytrack ? 0 : 1; }, { label: 'Noise pitch track' }) },
      { label: 'Edit Note Ranges…', action: () => openPane(K, 'map-noise', this.shell.name || this.route.btn, 'NOISE note ranges', this.map) }];
  }
  build() {
    const K = this.kit, D = this.D, d = K.doc, shell = K.panel('NOISE', 'noise', 'n.on', '', { items: () => this.menuItems(), collapse: true }), { el, head, body } = shell;
    this.shell = shell;
    el.classList.add('sxo-mod');
    el.setAttribute('data-noisepanel', '1');
    if (el.style && el.style.setProperty) el.style.setProperty('--sxo-c', '#94a3b8');
    const nm = K.bind(wk.menu({ label: 'Noise source', arrows: true, stepGroup: true, get: () => K.s().noise.src,
      items: () => D.noiseItems(),
      set: v => {
        const it = D.noiseList().find(t => t.id === v);
        K.edit(s => { s.noise.src = v; if (it && it.oneshot !== undefined) s.noise.oneshot = it.oneshot ? 1 : 0; }, { label: 'Noise source' });
      } }));
    nm.el.classList.add('sx-grow', 'sxo-src');
    const load = btn(d, 'sx-hbtn', icon(d, 'folder'), 'Load noise sample (WAV)', () => pickFiles(d, '.wav,.wave,audio/wav', false).then(fl => { if (fl.length) D.importNoiseFiles(fl); }));
    const del = btn(d, 'sx-hbtn', icon(d, 'trash'), 'Delete user noise', () => D.deleteUser(true));
    const emb = mk(d, 'span', 'sxo-badge', 'EMBED');
    emb.title = 'User noises are embedded in exported presets and projects';
    K.custom(() => { const u = /^nzuser:/.test(K.s().noise.src || ''); del.classList.toggle('sx-hidden', !D.canDelete(K.s().noise.src, true)); hide(emb, !u); });
    const route = routeControls(K, { key: 'route-noise', title: 'NOISE', obj: s => s.noise, routes: ['Filter', 'Main', 'Direct', 'None'], fbal: 'n.fbal', bus: ['n.bus1', 'n.bus2'] });
    this.route = route;
    this.map = mapPane(K, 'NOISE', s => s.noise);
    head.append(nm.el, load, del, emb, route.btn);
    const cv = K.canvas('sx-short', () => this.key(), (g, w, h, dpr) => this.draw(g, w, h, dpr));
    cv.el.setAttribute('role', 'img');
    cv.el.setAttribute('aria-label', 'Noise overview; drop a WAV file to import a noise');
    fileDrop(cv.el, files => D.importNoiseFiles(files));
    const one = pToggle(K, { label: 'ONE SHOT', kind: 'btn', get: () => K.s().noise.oneshot, set: v => K.edit(s => { s.noise.oneshot = v ? 1 : 0; }, { label: 'Noise one shot' }),
      disabled: () => this.isColor() });
    one.el.title = 'One-shot (off = loop)';
    const col = () => this.isColor(), geiger = () => K.s().noise.src === 'color:Geiger';
    const kn = (id, label, size, dis) => K.knob(id, Object.assign(size ? { label, size } : { label }, dis ? { disabled: dis } : {})).el;
    const start = K.num('n.phase', { label: 'START', disabled: col });
    const stereo = kn('n.stereo', 'STEREO', 'sm'), filt = kn('n.color', 'FILTER', 'sm');
    K.custom(() => { const c = col(); hide(stereo, !c); hide(filt, !c); });
    body.append(cv.el, row(d, one.el, start.el, kn('n.rand', 'RAND', 'sm', col), stereo, filt),
      row(d, kn('n.pitch', 'PITCH', 'sm', () => col() && !geiger()), kn('n.fine', 'FINE', 'sm', col), kn('n.pan', 'PAN', 'sm'), kn('n.level', 'LEVEL')));
    return el;
  }
  key() {
    const K = this.kit, s = K.s(), sn = K.snap(), ov = this.D.noiseOverview(s.noise.src);
    return [s.noise.src, ov ? 1 : 0, sn && sn.notes > 0 && fin(sn.noisePos) ? sn.noisePos.toFixed(3) : '', K.getN('n.on')].join('|');
  }
  draw(g, w, h, dpr) {
    const K = this.kit, s = K.s(), mm = this.D.noiseOverview(s.noise.src), sn = K.snap();
    g.fillStyle = C.mute;
    if (!mm) { g.font = Math.round(10 * dpr) + 'px ui-monospace, monospace'; g.fillText(nameOfId(s.noise.src), 6 * dpr, h / 2 + 4 * dpr); return; }
    g.fillStyle = 'rgba(89, 194, 255, 0.7)';
    const n = mm.length / 2;
    for (let x = 0; x < w; x++) {
      const c = Math.min(n - 1, Math.floor(x / w * n)), lo = mm[2 * c], hi = mm[2 * c + 1];
      g.fillRect(x, h / 2 - hi * h * 0.45, 1, Math.max(1, (hi - lo) * h * 0.45));
    }
    if (/^color:/.test(s.noise.src)) { g.fillStyle = C.mute; g.font = Math.round(9 * dpr) + 'px ui-monospace, monospace'; g.fillText(nameOfId(s.noise.src).toUpperCase(), 6 * dpr, 11 * dpr); }
    else if (sn && sn.notes > 0 && fin(sn.noisePos)) {
      g.fillStyle = C.cur;
      g.fillRect(Math.round(clamp01(sn.noisePos) * (w - 1)), 0, Math.max(1, dpr), h);
    }
  }
}

/* ================================================================ FILTER 1 / FILTER 2 (inv B12, §13.3) */

// the display views ui.filtView[k] (§2.2.2): 0 response, 1 response + FFT, 2 phase + FFT; click / Enter / Alt-click
// cycle 0 → 2 → 1 → 0 (the Phase-1 magnitude → phase → spectrum order)
const FV_NEXT = [2, 0, 1];
const FV_NAMES = ['Frequency Response', 'Frequency Response & FFT', 'Phase Response & FFT'];

export class FilterPanel {
  constructor(root, kit, k) {
    this.kit = kit;
    this.k = k ? 1 : 0;
    this.F = this.k ? 'f2.' : 'f.';
    this.D = oscData(kit);
    ensureCSS(kit.doc);
    this.el = this.build();
    if (root) root.appendChild(this.el);
  }
  // the type destination in use: Filter 2 f2.type; Filter 1 f.type (S1 mode, 96 types) or f.type2 (108)
  typeId() { return this.k ? 'f2.type' : s1Of(this.kit.s()) ? 'f.type' : 'f.type2'; }
  typeN(live) {
    const id = this.typeId(), n = live ? this.D.liveN(id) : this.kit.getN(id);
    return Math.round(n * (id === 'f.type' ? 95 : 107));
  }
  build() {
    const K = this.kit, D = this.D, d = K.doc, k = this.k, F = this.F, T = k ? 'FILTER 2' : 'FILTER 1', mod = k ? 'filter2' : 'filter';
    const shell = K.panel(T, mod, F + 'on', '', { collapse: true }), { el, head, body } = shell;
    this.shell = shell;
    el.classList.add('sxo-mod');
    if (el.style && el.style.setProperty) el.style.setProperty('--sxo-c', k ? '#ff5b8a' : '#ff8a5b');
    const cats = FILTERS.map(f => f.cat);
    const t2 = K.menu(k ? 'f2.type' : 'f.type2', () => groupItems(FILTERS.map((f, i) => ({ v: i / 107, label: f.name, group: f.cat })), FILTER_CATS), { label: T + ' type' });
    t2.el.classList.add('sx-grow');
    head.appendChild(t2.el);
    if (!k) {   // S1 mode: the v1 destination (96 types)
      const t1 = K.menu('f.type', () => FILTERS.slice(0, 96).map((f, i) => ({ v: i / 95, label: f.name, group: cats[i] })), { label: 'Filter type' });
      t1.el.classList.add('sx-grow');
      head.appendChild(t1.el);
      K.custom(() => { const s1 = s1Of(K.s()); hide(t1.el, !s1); hide(t2.el, s1); });
    }
    const route = routeControls(K, { key: 'route-f' + k, title: T, obj: s => s.filter[k], routes: [k ? 'Filter 1' : 'Filter 2', 'Main', 'Direct', 'None'], fbal: null,
      bus: [F + 'bus1', F + 'bus2'], filter: k });
    head.appendChild(route.btn);
    this.route = route;
    // display: drag x = cutoff, y = res; click / Enter / Alt-click cycles the views; right-click: the view menu
    const cv = K.canvas('sx-tall', () => this.key(), (g, w, h, dpr) => this.draw(g, w, h, dpr));
    const c = cv.el;
    c.tabIndex = 0;
    c.setAttribute('role', 'button');
    c.setAttribute('aria-label', T + ' display: click cycles the views; drag sets cutoff (x) and resonance (y); right-click for the view menu');
    // a mouse / pen drag puts the cutoff / res point under the pointer; a finger drags it relatively (from the values at
    // the press, so the jitter of a tap is no jump) and only after TOUCH_SLOP px, so a tap still cycles the views
    let g = null;
    const at = e => {
      const r = c.getBoundingClientRect(), n = xyToN(e.clientX, e.clientY, r);
      if (!g || !g.rel) return [n.x, n.y];
      return [clamp01(g.c0 + (e.clientX - g.x) / Math.max(1, r.width)), clamp01(g.r0 - (e.clientY - g.y) / Math.max(1, r.height))];
    };
    const put = (e, ph) => { const [u, v] = at(e); K.edit(s => { s.p[F + 'cutoff'] = u; s.p[F + 'res'] = v; }, { label: 'Filter cutoff / res', phase: ph }); };
    const cycle = () => uiEdit(K, s => { s.ui.filtView[k] = FV_NEXT[s.ui.filtView[k] | 0] | 0; });
    c.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      if (g && g.moved) put(e, 'end');   // a stale drag (its pointerup was missed) ends where it was
      const rel = e.pointerType === 'touch';
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, rel, slop: rel ? TOUCH_SLOP : 3, c0: K.getN(F + 'cutoff'), r0: K.getN(F + 'res') };
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    });
    c.addEventListener('pointermove', e => {
      if (!g || e.pointerId !== g.id) return;
      if (noButton(e)) { lost(e); return; }
      if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) > g.slop) { g.moved = true; put(e, 'start'); }
      if (g.moved) put(e, 'move');
    });
    const up = e => {
      if (!g || e.pointerId !== g.id) return;
      const G = g;
      // a two-finger rollback (twoF): cutoff / res from before the press
      if (G.moved && twoF(e)) K.edit(s => { s.p[F + 'cutoff'] = G.c0; s.p[F + 'res'] = G.r0; }, { label: 'Filter cutoff / res', phase: 'end' });
      else if (G.moved) put(e, 'end');
      g = null;
      if (!G.moved && e.type === 'pointerup') cycle();
    };
    // a lost capture / a button-less mouse move: the drag ends at its last values (no tap, no jump to the pointer)
    const lost = e => {
      if (!g || e.pointerId !== g.id) return;
      const G = g;
      g = null;
      if (G.moved) K.edit(() => {}, { label: 'Filter cutoff / res', phase: 'end' });
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('lostpointercapture', lost);
    c.addEventListener('contextmenu', e => {
      e.preventDefault();
      wk.contextMenu(e.clientX, e.clientY, FV_NAMES.map((nm, i) => ({ label: nm, checked: (K.s().ui.filtView[k] | 0) === i, action: () => uiEdit(K, s => { s.ui.filtView[k] = i; }) })), { anchor: c });
    });
    c.addEventListener('keydown', e => {
      const key = e.key;
      if (key === 'Enter' || key === ' ') { e.preventDefault(); cycle(); }
      else if (key === 'ArrowLeft' || key === 'ArrowRight') { e.preventDefault(); K.setN(F + 'cutoff', K.getN(F + 'cutoff') + (key === 'ArrowRight' ? 0.01 : -0.01), 'set'); }
      else if (key === 'ArrowUp' || key === 'ArrowDown') { e.preventDefault(); K.setN(F + 'res', K.getN(F + 'res') + (key === 'ArrowUp' ? 0.01 : -0.01), 'set'); }
    });
    // routing switches S A B C N: lit = the source reaches this filter; a tap turns a lit source off, an unlit one on
    // (switch on; a source routed elsewhere comes to Filter with its balance at this filter)
    const sw = mk(d, 'div', 'sxo-sw sx-route');
    sw.setAttribute('role', 'group');
    sw.setAttribute('aria-label', T + ' routing (S A B C N)');
    for (const [X] of FSRC) {
      const id = F + 'route' + X;
      const w = K.bind(wk.toggle({ dest: id, label: X, kind: 'btn', get: () => (filterLit(K.s(), k)[X] ? 1 : 0), set: () => this.routeTap(X) }));
      w.el.title = ({ S: 'Sub', A: 'OSC A', B: 'OSC B', C: 'OSC C', N: 'Noise' })[X] + ' → ' + T;
      sw.appendChild(w.el);
    }
    const key = pToggle(K, { label: 'KEY', kind: 'btn', get: () => K.s().filter[k].keytrack, set: v => K.edit(s => { s.filter[k].keytrack = v ? 1 : 0; }, { label: 'Filter key track' }) });
    key.el.title = 'Key track: cutoff follows the pitch';
    const kt = () => [{ label: 'Key Track', checked: !!K.s().filter[k].keytrack, action: () => K.edit(s => { s.filter[k].keytrack = s.filter[k].keytrack ? 0 : 1; }, { label: 'Filter key track' }) }];
    const cl = () => [{ label: 'Clean Mode', checked: !!K.s().filter[k].clean, action: () => K.edit(s => { s.filter[k].clean = s.filter[k].clean ? 0 : 1; }, { label: 'Filter clean mode' }) }];
    const cutoff = extraMenu(K.knob(F + 'cutoff', { label: 'CUTOFF', size: 'lg' }).el, kt);
    const drive = extraMenu(K.knob(F + 'drive', { label: 'DRIVE', size: 'sm' }).el, cl);
    const vr = K.knob(F + 'var', { label: 'VAR', size: 'sm', labelFn: () => core.varLabel(this.typeN(false)) || 'VAR', disabled: () => !core.varLabel(this.typeN(false)) }).el;
    const mix = K.knob(F + 'mix', { label: 'MIX', size: 'sm', disabled: () => this.typeN(true) === 80 }).el;
    const lvl = dSlider(K, F + 'level', { label: 'LEVEL' });
    lvl.el.classList.add('sxo-lvl');
    // PZ SVF (type 103): the PZ editor popover (corners + X/Y), a pane with the X / Y knobs as the fallback
    this.xyPane = paneEl(d);
    this.xyPane.append(row(d, K.knob(F + 'x', { label: 'X', size: 'sm' }).el, K.knob(F + 'y', { label: 'Y', size: 'sm' }).el));
    const pzb = btn(d, 'sx-hbtn', 'PZ', 'PZ SVF corners and X / Y (' + T + ')', () => this.pzEditor(pzb));
    K.custom(() => hide(pzb, this.typeN(false) !== 103));
    body.append(c, row(d, sw, key.el, pzb),
      row(d, cutoff, K.knob(F + 'res', { label: 'RES' }).el, K.knob(F + 'pan', { label: 'PAN', size: 'sm' }).el),
      row(d, drive, vr, mix, lvl.el));
    void D;
    return el;
  }
  // tap on routing switch X (§13.3; serum-core toggleFilterRoute): a source routed to Filter toggles the switch only (its
  // balance never moves: two taps restore the state); an off-route source comes to Filter with the balance at this filter
  routeTap(X) {
    const K = this.kit, k = this.k, F = this.F, spec = FSRC.find(r => r[0] === X), sid = F + 'route' + X;
    K.edit(s => {
      if (typeof core.toggleFilterRoute === 'function') { core.toggleFilterRoute(s, k, X); return; }
      const O = spec[1](s);
      if (O.route === 0) s.p[sid] = core.destBase(s, null, sid) >= 0.5 ? 0 : 1;
      else { O.route = 0; s.p[spec[2]] = k ? 1 : 0; s.p[sid] = 1; }
    }, { label: (k ? 'Filter 2' : 'Filter 1') + ' routing' });
  }
  pzEditor(anchor) {
    const K = this.kit, k = this.k, F = this.F, T = k ? 'FILTER 2' : 'FILTER 1', Ed = gx.PZEditor;
    const ax = id => { const d = destOf(id); return { dest: id, get: () => K.getN(id), set: (n, ph) => K.setN(id, n, ph), def: d ? d.def : 0, fmt: n => fmtN(K, id, n) }; };
    if (typeof Ed !== 'function') { openPane(K, 'pz' + k, anchor, T + ' PZ SVF', this.xyPane); return; }
    K.popover('pz' + k, anchor, T + ' PZ SVF', box => new Ed(box, {
      get: () => K.s().filter[k].pz,
      set: (pz, ph) => K.edit(s => { s.filter[k].pz = pz; }, { label: 'PZ SVF', phase: ph }),
      x: ax(F + 'x'), y: ax(F + 'y'),
    }), () => JSON.stringify([K.s().filter[k].pz, K.getN(F + 'x'), K.getN(F + 'y')]));
  }
  key() {
    const K = this.kit, D = this.D, s = K.s(), k = this.k, F = this.F, v = s.ui.filtView[k] | 0, sn = K.snap();
    const base = [v, this.typeN(true), D.liveN(F + 'cutoff').toFixed(4), D.liveN(F + 'res').toFixed(3), D.liveN(F + 'drive').toFixed(3), D.liveN(F + 'var').toFixed(3),
      K.getN(F + 'on'), dsp() ? 1 : 0, sxf() ? 1 : 0, this.typeN(false) === 103 ? JSON.stringify(s.filter[k].pz) + D.liveN(F + 'x').toFixed(3) + D.liveN(F + 'y').toFixed(3) : ''];
    if (v) base.push(K.snapSeq(), sn && sn.notes > 0 ? 1 : 0);
    return base.join('|');
  }
  // impulse response of the current type (types ≥ 96 through SxFilt2.impulse with X / Y / corners), or null
  impulse(type, fc, res, drive, vr) {
    const K = this.kit, D = this.D, F = this.F;
    if (type >= 96) {
      const X = sxf();
      if (X && typeof X.impulse === 'function') {
        const pz = [].concat(...arr(K.s().filter[this.k].pz).map(c => arr(c)));
        return X.impulse(type, fc, res, drive, vr, 48000, 4096, D.liveN(F + 'x'), D.liveN(F + 'y'), pz.length === 12 ? pz : null);
      }
    }
    const S = dsp();
    return S && typeof S.filterImpulse === 'function' ? S.filterImpulse(type, fc, res, drive, vr, 48000, 4096) : null;
  }
  draw(g, w, h, dpr) {
    const K = this.kit, D = this.D, s = K.s(), k = this.k, F = this.F, view = s.ui.filtView[k] | 0, type = this.typeN(true);
    g.font = Math.round(9 * dpr) + 'px ui-monospace, monospace';
    g.strokeStyle = 'rgba(42, 51, 61, 0.9)'; g.lineWidth = dpr; g.fillStyle = C.mute;
    for (const f of [100, 1000, 10000]) {
      const x = Math.log(f / F_LO) / Math.log(F_HI / F_LO) * w;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      g.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), x + 2 * dpr, h - 3 * dpr);
    }
    const label = ['MAG', 'MAG + FFT', 'PHASE + FFT'][view] || '';
    g.fillText(label, w - g.measureText(label).width - 4 * dpr, 10 * dpr);
    if (view) this.drawSpectrum(g, w, h, dpr);
    if (type >= 76 && type <= 79) { this.drawIcon(g, w, h, dpr, type); return; }
    const fc = core.lawValue(F + 'cutoff', D.liveN(F + 'cutoff'));
    let ir = null;
    try { ir = this.impulse(type, fc, D.liveN(F + 'res'), D.liveN(F + 'drive'), D.liveN(F + 'var')); } catch (err) { warnOnce('fi' + type, 'sx-ui-osc: filter impulse', err); }
    if (!ir) { g.fillStyle = C.mute; g.fillText('Filter display needs the DSP scripts', 6 * dpr, 14 * dpr); return; }
    const N = ir.length, re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = fin(ir[i]) ? ir[i] : 0;
    fft(re, im);
    const binHz = 48000 / N, y0 = h * 0.5;
    g.beginPath();
    for (let x = 0; x <= w; x++) {
      const b = clamp(fOfX(x / w) / binHz, 0, N / 2 - 1), i = Math.floor(b), f = b - i, j = Math.min(N / 2, i + 1);
      let y;
      if (view === 2) {
        const ph = Math.atan2(im[i] + (im[j] - im[i]) * f, re[i] + (re[j] - re[i]) * f);
        y = y0 - ph / Math.PI * h * 0.42;
      } else {
        const m = Math.hypot(re[i], im[i]) * (1 - f) + Math.hypot(re[j], im[j]) * f, db = 20 * Math.log10(Math.max(1e-6, m));
        y = h * (24 - clamp(db, -60, 30)) / 72;
      }
      if (x) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.strokeStyle = K.getN(F + 'on') >= 0.5 ? (k ? '#ff5b8a' : '#ff8a5b') : C.mute; g.lineWidth = 1.6 * dpr; g.stroke();
    if (view === 0) {
      g.lineTo(w, h); g.lineTo(0, h); g.closePath();
      g.fillStyle = 'rgba(255, 138, 91, 0.08)'; g.fill();
      g.strokeStyle = 'rgba(223, 230, 238, 0.25)';
      g.beginPath(); g.moveTo(0, h * 24 / 72); g.lineTo(w, h * 24 / 72); g.stroke();
    }
    const cx = D.liveN(F + 'cutoff') * w;
    g.fillStyle = C.cur; g.fillRect(cx - dpr, h - 5 * dpr, 2 * dpr, 5 * dpr);
  }
  drawIcon(g, w, h, dpr, type) {   // Ring Mod / S&H types: symbolic display (inv A11.1)
    g.strokeStyle = C.graph; g.lineWidth = 1.6 * dpr;
    g.beginPath();
    for (let x = 0; x <= w; x++) {
      const p = x / w;
      let y;
      if (type <= 77) y = Math.sin(2 * Math.PI * 3 * p) * Math.sin(2 * Math.PI * 23 * p) * (type === 77 ? Math.cos(2 * Math.PI * 1.5 * p) : 1);
      else { const q = Math.floor(p * 14) / 14; y = Math.sin(2 * Math.PI * 2 * q); if (type === 79) y = Math.sin(2 * Math.PI * 2 * p) - y; }
      const yy = h / 2 - y * h * 0.35;
      if (x) g.lineTo(x, yy); else g.moveTo(x, yy);
    }
    g.stroke();
    g.fillStyle = C.mute;
    g.fillText(FILTERS[type].name, 6 * dpr, 12 * dpr);
  }
  // FFT of this filter's output tap (snapshot.filtTap: Filter 1 then Filter 2, 1024 each)
  drawSpectrum(g, w, h, dpr) {
    const sn = this.kit.snap(), tapAll = sn && sn.filtTap, N = 1024, off = this.k && tapAll && tapAll.length >= 2 * N ? N : 0;
    let any = false;
    if (tapAll) for (let i = off; i < off + N && i < tapAll.length; i += 7) if (tapAll[i] !== 0) { any = true; break; }
    if (!sn || !sn.notes || !tapAll || !any) { g.fillStyle = C.mute; g.fillText('no signal', w / 2 - 22 * dpr, h / 2); return; }
    const re = new Float64Array(N), im = new Float64Array(N), rate = sn.tapRate > 0 ? sn.tapRate : 48000;
    for (let i = 0; i < N; i++) re[i] = (tapAll[off + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
    fft(re, im);
    g.beginPath();
    for (let x = 0; x <= w; x++) {
      const b = clamp(fOfX(x / w) / (rate / N), 0, N / 2 - 1), i = Math.floor(b), j = Math.min(N / 2, i + 1), f = b - i;
      const m = (Math.hypot(re[i], im[i]) * (1 - f) + Math.hypot(re[j], im[j]) * f) / (N / 4);
      const db = 20 * Math.log10(Math.max(1e-7, m)), y = h * (6 - clamp(db, -96, 6)) / 102;
      if (x) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.strokeStyle = 'rgba(111, 227, 161, 0.6)'; g.lineWidth = 1.2 * dpr; g.stroke();
  }
}
