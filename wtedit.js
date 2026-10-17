// wtedit.js — the wavetable editor (SPEC-serum §8.9, §9.9; inv A10). Browser ES module; nothing touches the DOM at
// module top level, so node can import it (pure helpers below are exported for the tests).
//
//   const ed = new WTEditor(root, { host, osc: 0 | 1, onClose });   // host = the SerumUI host (§8.8)
//   ed.open(); … ed.close();
//
// The editor renders into `root` (serum-ui supplies the full-panel role=dialog overlay). It owns a working copy of the
// oscillator's table (copy-on-write: the first edit of a session stores a new `user:` table "<name> *" through
// host.wt.saveNew and repoints only this oscillator), an editor-local undo history (64 snapshots, ≤ 64 MB), live
// updates (host.wt.update ≤ 30 Hz with the changed frame indices; spectral-morph tables: full update debounced
// 150 ms), file import (menu, drop zones, thumbnail drop = replace frame), exports, formulas and every wt.js operation.
//
// Phase 2 (SPEC-serum2 §13.13b, §11.13; inv B11): `osc` 0–2 (OSC C); menus ALL (was PROCESS; "from Other Osc" items
// take a submenu OSC A/B/C ≠ this one, loaded on demand) and REMOVE (was ADD/REMOVE: removal items only, + "Reduce to ▸
// N frames"; Insert is the + frame button, Init All moved to the TABLE menu);
// SORT ▸ Randomize; draw tool Mirror; frame COPY / PASTE (contiguous selection, a clipboard shared by every editor of
// the page; paste inserts after the current frame, ≤ 256; Cmd/Ctrl-C / -V on the frame strip); FFT ▸ Repeat Bin Group;
// Shift-Cmd/Ctrl-click (touch: the Shift + Alt latches; menu: the FFT context menu's "Nudge Phase Right" on the phase
// row) on a phase bar nudges its phase by 1/64; IMPORT ▸ Frequency Estimation… (wt.estimatePeriod → split-size field,
// in the file's samples) and Switch OSC Type ▸ Sample/Granular/Spectral (one audio file through host.smp.import; a
// single-sample id sets the oscillator's type and `smp` and resets its sample ops, then the editor closes); stereo
// files import their left channel into OSC A/C and the right one into OSC B (channelFor); EXPORT ▸ All as 16-/32-bit
// WAV, Single-Cycle Waves (ZIP), 8-bit .256, Selection; TABLE ▸ Save Table… / Rename / Init All (the name field's menu,
// also on a right-click of the name while it is not being edited; the name is tinted while the table is an automatic
// " *" copy); a Shift/Alt modifier bar in touch mode (wk.touchMode, or the first touch inside the editor).
import * as wk from './wk.js?v=10';
import * as wt from './wt.js?v=10';

const FRAME = 2048, MAXF = 256;
const STORE_KEY = 'synth.sx.wte', FORMULA_KEY = 'synth.sx.formulas';
const UNDO_MAX = 64, UNDO_BYTES = 64 * 1024 * 1024;
const TW = 44; // thumbnail width (px)
const MENUS = [['Single', 'SINGLE'], ['Process', 'ALL'], ['Morph', 'MORPH'], ['Add/Remove', 'REMOVE'], ['Sort', 'SORT']];
const OSC_NAMES = ['OSC A', 'OSC B', 'OSC C'];
const REDUCE_TO = [2, 4, 8, 16, 32, 64, 128];
const SWITCH_TYPES = [['sample', 'Sample'], ['gran', 'Granular'], ['spec', 'Spectral']];
const WAV_ACCEPT = '.wav,.wave,audio/wav,audio/x-wav';
// Switch OSC Type takes one single-sample audio file (an SFZ or ZIP would import a multisample, which `osc.smp` cannot hold)
const SAMPLE_ACCEPT = '.wav,.wave,.aif,.aiff,.aifc,.flac,.mp3,.ogg,.oga,.m4a,.aac,audio/*';
const REMOVE_SKIP = new Set(['add.insert', 'add.initAll']); // REMOVE holds removal items only (§13.13b)
// The frame clipboard (COPY / PASTE): page-wide, so frames copied in one oscillator's editor paste into another's.
// Frames are immutable (wt.js convention), so the clipboard shares them.
const CLIP = { frames: [] };
const PROCESS_BREAKS = new Set(['all.half', 'all.setSpectra', 'all.blurBinsSpectra', 'all.removeLowSpectra']);
const IMPORT_ITEMS = [
  ['zeroSnap', 'Import: normal (dynamic pitch zero-snap)…'], ['pitchFollow', 'Import: normal (dynamic pitch follow)…'],
  ['pitchAvg', 'Import: constant frame size (pitch avg)…'], ['manual', 'Import: constant frame size (manual entry)…'],
  null, ['fft256', 'Import: FFT 256…'], ['fft512', 'Import: FFT 512…'], ['fft1024', 'Import: FFT 1024…'], ['fft2048', 'Import: FFT 2048…'],
  null, ['singles', 'Import single-cycle files…'], ['image', 'Import image (PNG)…'],
];
const DROP_ZONES = [['pitchAvg', 'Pitch Avg'], ['zeroSnap', 'Zero-Snap'], ['pitchFollow', 'Pitch Follow'], ['fft1024', 'FFT 1024']];
const TOOL_ICONS = { // 16×16 original glyphs
  flat: 'M2 8H14', slopeUp: 'M2 13L14 3', slopeDown: 'M2 3L14 13', sine: 'M1 8C3 1 5 1 8 8S13 15 15 8',
  halfValley: 'M2 5C3 15 13 15 14 5', halfPeak: 'M2 11C3 1 13 1 14 11', curveUp: 'M2 13C4 4 8 3 14 3', curveDown: 'M2 3C8 3 12 4 14 13',
  interpLin: 'M2 11L14 5M2 11h.1M14 5h.1', interpCurve: 'M2 11C7 11 9 5 14 5M2 11h.1M14 5h.1', nudge: 'M8 2V14M5 5L8 2L11 5M5 11L8 14L11 11',
  noise: 'M1 9L3 5L4 11L6 3L8 12L9 6L11 10L12 4L13 9L15 7',
  mirror: 'M1 8C2 3 5 2 7 5M9 11C11 14 14 13 15 8M8 1V3M8 7V9M8 13V15',
};
const DEF_COL = { bg: '#0f1216', panel: '#161b21', panel2: '#1c232b', line: '#2a333d', ink: '#dfe6ee', mute: '#7f8b98', accent: '#4fb3ff',
  graph: '#59c2ff', warn: '#ff6a4a', on: '#6fe3a1', cur: '#ffd84a' };

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const fileBase = n => (String(n || 'Import').replace(/\.[^.]+$/, '').slice(0, 64) || 'Import');
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

/* ================================================================== pure helpers (node-testable) */

// Thumbnail label of real frame k (inv A10.1: "1, 17, 33 … after morph" — the frame's 256-slot position).
export function thumbLabel(table, k) {
  const R = table.frames.length;
  return String((table.morph | 0) !== 0 && R > 1 && R < MAXF ? Math.round(k * 255 / (R - 1)) + 1 : k + 1);
}

export function tableBytes(t) { return t && t.frames ? t.frames.length * FRAME * 4 : 0; }

// Editor-local undo/redo of whole Tables (frames are immutable, so snapshots share unchanged frames).
export class UndoStack {
  constructor(max = UNDO_MAX, bytes = UNDO_BYTES) { this.max = max; this.bytes = bytes; this.u = []; this.r = []; }
  push(t) {
    if (!t) return;
    this.u.push(t);
    this.r.length = 0;
    this.trim();
  }
  trim() {
    let total = this.u.reduce((s, t) => s + tableBytes(t), 0);
    while (this.u.length > this.max || (total > this.bytes && this.u.length > 1)) total -= tableBytes(this.u.shift());
  }
  undo(cur) { if (!this.u.length) return null; this.r.push(cur); return this.u.pop(); }
  redo(cur) { if (!this.r.length) return null; this.u.push(cur); this.trim(); return this.r.pop(); }
  get canUndo() { return this.u.length > 0; }
  get canRedo() { return this.r.length > 0; }
  clear() { this.u.length = 0; this.r.length = 0; }
}

// Frame indices that differ between two tables (by reference), or null when the change needs a full update.
export function changedFrames(a, b) {
  if (!a || !b || a.frames.length !== b.frames.length || (a.morph | 0) !== (b.morph | 0)) return null;
  const out = [];
  for (let i = 0; i < a.frames.length; i++) if (a.frames[i] !== b.frames[i]) out.push(i);
  return out;
}

// What the formula field holds (§9.9: it doubles as the import split-size entry).
export function fieldInfo(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return { kind: 'empty' };
  if (t === '0') return { kind: 'clear' };
  const split = wt.parseSplitSize(t);
  if (split) return { kind: 'split', split, msg: wt.splitMsg(split) };
  const p = wt.parseFormula(t);
  return p.ok ? { kind: 'formula', multi: p.multi, usesQ: p.usesQ } : { kind: 'error', msg: `${p.msg} (at ${p.pos + 1})`, pos: p.pos };
}

export function classifyFiles(files) {
  const out = { wavs: [], pngs: [], txts: [], other: [] };
  for (const f of files || []) {
    const n = String(f && f.name || '').toLowerCase(), ty = String(f && f.type || '');
    if (/\.(wav|wave)$/.test(n) || /audio\/(x-)?wav/.test(ty)) out.wavs.push(f);
    else if (/\.png$/.test(n) || ty === 'image/png') out.pngs.push(f);
    else if (/\.txt$/.test(n) || ty === 'text/plain') out.txts.push(f);
    else out.other.push(f);
  }
  return out;
}

// Phase 2: the channel a stereo file imports into oscillator `osc` (§13.13b: L → OSC A or C, R → OSC B).
export function channelFor(osc, nch) { return osc === 1 && nch > 1 ? 1 : 0; }

// Phase 2: the oscillators a "from Other Osc" operation can read — every other oscillator of the state (A/B/C) with
// its table id; `ok` = it plays a wavetable (type 'wt', or no type: a v1 state).
export function otherOscs(s, osc) {
  const list = s && Array.isArray(s.osc) ? s.osc : [], out = [];
  for (let o = 0; o < Math.min(3, list.length); o++) {
    if (o === osc) continue;
    const x = list[o] || {};
    out.push({ osc: o, label: OSC_NAMES[o], id: x.wt ? String(x.wt) : '', ok: !!x.wt && (x.type == null || x.type === 'wt') });
  }
  return out;
}

// Phase 2: the frames COPY puts on the clipboard (the contiguous selection [a, b], clamped).
export function copyRange(table, sel) {
  const R = table && table.frames ? table.frames.length : 0;
  if (!R) return [];
  let a = clamp(Math.round(+(sel && sel[0]) || 0), 0, R - 1), b = clamp(Math.round(+(sel && sel[1] != null ? sel[1] : a) || 0), 0, R - 1);
  if (a > b) { const t = a; a = b; b = t; }
  return table.frames.slice(a, b + 1);
}

export function loadFormulas(storage) {
  let v = null;
  try { v = storage && storage.get ? storage.get(FORMULA_KEY, null) : null; } catch (err) { v = null; }
  const ok = l => (Array.isArray(l) ? l.filter(x => x && typeof x.name === 'string' && typeof x.src === 'string').map(x => ({ name: x.name, src: x.src })) : []);
  return { singles: ok(v && v.singles), multis: ok(v && v.multis) };
}

// Store-only ZIP (no compression) for "Export All as Single-Cycle Waves".
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
export function zipStore(files, date = new Date(2026, 0, 1)) {
  const enc = s => { const out = []; for (const ch of String(s)) { const c = ch.codePointAt(0); if (c < 0x80) out.push(c); else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63)); else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); } return Uint8Array.from(out); };
  const dosT = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosD = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const items = files.map(f => {
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(ArrayBuffer.isView(f.data) ? f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) : f.data);
    return { name: enc(f.name), data, crc: crc32(data) };
  });
  const size = items.reduce((s, it) => s + 30 + it.name.length + it.data.length + 46 + it.name.length, 0) + 22;
  const buf = new ArrayBuffer(size), dv = new DataView(buf), u8 = new Uint8Array(buf);
  let p = 0;
  const u16 = v => { dv.setUint16(p, v, true); p += 2; }, u32 = v => { dv.setUint32(p, v >>> 0, true); p += 4; };
  const offs = [];
  for (const it of items) {
    offs.push(p);
    u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(dosT); u16(dosD); u32(it.crc); u32(it.data.length); u32(it.data.length);
    u16(it.name.length); u16(0); u8.set(it.name, p); p += it.name.length; u8.set(it.data, p); p += it.data.length;
  }
  const cd = p;
  items.forEach((it, i) => {
    u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(dosT); u16(dosD); u32(it.crc); u32(it.data.length); u32(it.data.length);
    u16(it.name.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(offs[i]); u8.set(it.name, p); p += it.name.length;
  });
  const cdSize = p - cd;
  u32(0x06054b50); u16(0); u16(0); u16(items.length); u16(items.length); u32(cdSize); u32(cd); u16(0);
  return buf;
}

/* ================================================================== CSS */

const CSS = `
.wte-root { position: relative; display: flex; flex-direction: column; gap: 6px; box-sizing: border-box; width: 100%; height: 100%; min-height: 440px; padding: 8px; color: var(--sx-ink, #dfe6ee); background: var(--sx-bg, #0f1216); font: 500 12px/1.3 var(--ui, system-ui, sans-serif); outline: none; }
.wte-root *, .wte-root *::before, .wte-root *::after { box-sizing: border-box; }
.wte-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.wte-btn { min-height: 26px; padding: 3px 8px; color: var(--sx-ink, #dfe6ee); background: var(--sx-panel2, #1c232b); border: 1px solid var(--sx-line, #2a333d); border-radius: 4px; font: 600 10px/1 var(--ui, system-ui, sans-serif); letter-spacing: 0.05em; cursor: pointer; white-space: nowrap; }
.wte-btn:hover:not(:disabled) { border-color: var(--sx-mute, #7f8b98); }
.wte-btn:focus-visible, .wte-tool:focus-visible, .wte-strip:focus-visible, .wte-cv:focus-visible { outline: 2px solid var(--sx-accent, #4fb3ff); outline-offset: 1px; }
.wte-btn:disabled { opacity: 0.4; cursor: default; }
.wte-btn[aria-expanded="true"] { border-color: var(--sx-accent, #4fb3ff); }
.wte-sep { width: 1px; align-self: stretch; margin: 2px 3px; background: var(--sx-line, #2a333d); }
.wte-name { flex: 1 1 140px; min-width: 80px; max-width: 320px; min-height: 26px; padding: 3px 6px; color: var(--sx-ink, #dfe6ee); background: var(--sx-panel, #161b21); border: 1px solid var(--sx-line, #2a333d); border-radius: 4px; font: inherit; }
.wte-grow { flex: 1 1 auto; }
.wte-name.wte-tint { color: var(--sx-accent, #4fb3ff); border-color: var(--sx-accent, #4fb3ff); }
.wte-x { font-size: 13px; padding: 3px 9px; }
.wte-root:not(.wte-touch) .wte-mk { display: none; }
.wte-fft { display: flex; gap: 6px; flex: 0 0 auto; height: clamp(110px, 24vh, 210px); }
.wte-cv { position: absolute; left: 0; top: 0; display: block; width: 100%; height: 100%; border-radius: 4px; background: var(--sx-panel, #161b21); touch-action: none; cursor: crosshair; }
.wte-fftw, .wte-cvw { position: relative; flex: 1 1 0; min-width: 0; min-height: 0; }
.wte-fside, .wte-side { display: flex; flex-direction: column; gap: 6px; justify-content: space-between; width: 92px; flex: 0 0 auto; }
.wte-lab { color: var(--sx-mute, #7f8b98); font: 600 9px/1.2 var(--ui, system-ui, sans-serif); letter-spacing: 0.05em; text-transform: uppercase; }
.wte-range { width: 100%; accent-color: var(--sx-accent, #4fb3ff); }
.wte-read { min-height: 14px; color: var(--sx-mute, #7f8b98); font: 500 10px/1.3 var(--mono, ui-monospace, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wte-mid { position: relative; display: flex; gap: 6px; flex: 1 1 auto; min-height: 150px; }
.wte-tools { display: grid; grid-template-columns: repeat(2, 32px); grid-auto-rows: 32px; gap: 3px; align-content: start; flex: 0 0 auto; }
.wte-tool { display: flex; align-items: center; justify-content: center; padding: 0; color: var(--sx-mute, #7f8b98); background: var(--sx-panel2, #1c232b); border: 1px solid var(--sx-line, #2a333d); border-radius: 4px; cursor: pointer; }
.wte-tool svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.wte-tool[aria-checked="true"] { color: var(--sx-bg, #0f1216); background: var(--sx-accent, #4fb3ff); border-color: var(--sx-accent, #4fb3ff); }
.wte-wavew { display: flex; flex-direction: column; gap: 4px; flex: 1 1 auto; min-width: 0; }
.wte-zrow { display: flex; align-items: center; gap: 6px; }
.wte-zrow .wte-range { flex: 1 1 auto; }
.wte-gridbox { display: flex; flex-direction: column; gap: 2px; }
.wte-gin { width: 100%; min-height: 26px; color: var(--sx-ink, #dfe6ee); background: var(--sx-panel, #161b21); border: 1px solid var(--sx-line, #2a333d); border-radius: 4px; font: 500 12px var(--mono, ui-monospace, monospace); text-align: center; }
.wte-form { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.wte-fx { flex: 1 1 220px; min-width: 120px; min-height: 28px; padding: 3px 8px; color: var(--sx-ink, #dfe6ee); background: var(--sx-panel, #161b21); border: 1px solid var(--sx-line, #2a333d); border-radius: 4px; font: 500 12px var(--mono, ui-monospace, monospace); }
.wte-fx.wte-bad { border-color: var(--sx-warn, #ff6a4a); }
.wte-msg { flex: 1 1 100%; min-height: 15px; color: var(--sx-mute, #7f8b98); font: 500 11px/1.3 var(--mono, ui-monospace, monospace); }
.wte-msg.wte-err { color: var(--sx-warn, #ff6a4a); }
.wte-foot { display: flex; align-items: stretch; gap: 6px; flex: 0 0 auto; height: 66px; }
.wte-fctl { display: grid; grid-template-columns: repeat(4, auto); align-content: center; gap: 3px; }
.wte-fnum { width: 64px; min-height: 26px; color: var(--sx-ink, #dfe6ee); background: var(--sx-panel, #161b21); border: 1px solid var(--sx-line, #2a333d); border-radius: 4px; font: 500 12px var(--mono, ui-monospace, monospace); text-align: center; }
.wte-fcount { align-self: center; color: var(--sx-mute, #7f8b98); font: 500 11px var(--mono, ui-monospace, monospace); }
.wte-strip { position: relative; flex: 1 1 auto; min-width: 0; overflow-x: auto; overflow-y: hidden; border-radius: 4px; background: var(--sx-panel, #161b21); }
.wte-sp { position: relative; min-width: 100%; height: 100%; }
.wte-thc { position: absolute; top: 0; left: 0; height: 100%; cursor: pointer; touch-action: pan-x; }
.wte-drop { position: absolute; inset: 0; z-index: 3; display: none; gap: 4px; padding: 4px; background: rgba(10, 13, 17, 0.82); border-radius: 4px; }
.wte-drop.wte-on { display: flex; }
.wte-zone { flex: 1 1 0; display: flex; align-items: center; justify-content: center; text-align: center; color: var(--sx-ink, #dfe6ee); border: 1px dashed var(--sx-mute, #7f8b98); border-radius: 6px; font: 600 11px/1.3 var(--ui, system-ui, sans-serif); letter-spacing: 0.05em; text-transform: uppercase; }
.wte-zone.wte-hot { border-style: solid; border-color: var(--sx-accent, #4fb3ff); background: rgba(79, 179, 255, 0.12); }
.wte-busy { position: absolute; inset: 0; z-index: 4; display: flex; align-items: center; justify-content: center; color: var(--sx-mute, #7f8b98); background: var(--sx-bg, #0f1216); font-size: 13px; }
@media (max-width: 760px) {
  .wte-root { min-height: 0; padding: 6px; overflow-y: auto; }
  .wte-fft { flex-direction: column; height: auto; }
  .wte-fftw { flex: 0 0 130px; }
  .wte-mid { flex: 0 0 auto; flex-direction: column; min-height: 0; }
  .wte-tools { grid-template-columns: repeat(6, 32px); }
  .wte-wavew { flex: 0 0 auto; }
  .wte-cvw { flex: 0 0 180px; }
  .wte-side, .wte-fside { width: auto; flex-direction: row; align-items: center; }
  .wte-foot { flex-wrap: wrap; height: auto; }
  .wte-strip { flex: 1 1 100%; height: 60px; }
}
@media (pointer: coarse) { .wte-btn, .wte-fnum, .wte-gin { min-height: 32px; } }
`;
function injectCSS(d) {
  if (!d || d.getElementById('wte-css')) return;
  const s = d.createElement('style');
  s.id = 'wte-css';
  s.textContent = CSS;
  (d.head || d.documentElement || d.body).appendChild(s);
}

/* ================================================================== the editor */

export class WTEditor {
  constructor(root, opts) {
    const o = opts || {};
    this.root = root;
    this.host = o.host || {};
    this.osc = clamp(Math.round(+o.osc || 0), 0, 2);
    this.onClose = typeof o.onClose === 'function' ? o.onClose : null;
    this.isOpen = false;
    this.closed = false;
    this.table = null; // working copy
    this.id = null; // id the oscillator points at
    this.owned = false; // this session already owns a user copy (copy-on-write done)
    this.cow = null; // pending saveNew
    this.cowPre = null; // the table an import replaced while that saveNew was pending (it belongs to that copy)
    this.freshName = null; // name for the next copy-on-write (imports keep the file name)
    this.others = new Map(); // osc index → { id, table }: other oscillators' tables ("from Other Osc" ops), on demand
    this.cur = 0; this.sel = [0, 0]; this.anchor = 0;
    this.tool = 'flat'; this.grid = 0;
    this.prefs = { binZoom: 512, waveZoom: 1, split: '' };
    this.waveScroll = 0;
    this.liveFFT = 1; this.snapQuarter = 0; this.scaleByBin = 0;
    this.undo = new UndoStack();
    this.pend = { frames: new Set(), full: false, timer: 0, last: -1e9, sentR: -1, sentMorph: -1 };
    this.g = null; // active pointer gesture
    this.offs = [];
    this.raf = 0;
    this.dirty = new Set();
    this.specFor = null; this.spec = null; this.magRange = 1;
    this.hover = null;
    this.seedN = (Date.now() >>> 0) || 1;
    this.lastSel = -1;
    this.tips = [];
    this.namePress = null; // right-button press on the name field: whether it was focused already (null: none)
    this.ctxNudge = false; // a Shift-Ctrl-click just nudged a phase (the macOS context menu that follows is swallowed)
  }

  /* ------------------------------------------------------------ lifecycle */
  open() {
    if (this.isOpen || this.closed || !this.root) return;
    const d = this.doc = this.root.ownerDocument || globalThis.document;
    if (!d) return;
    this.win = d.defaultView || globalThis;
    this.isOpen = true;
    wk.injectStyles(d);
    injectCSS(d);
    this.loadPrefs();
    this.build();
    this.col = this.colors();
    const s = this.state(), osc = s && s.osc && s.osc[this.osc];
    this.id = osc && osc.wt ? String(osc.wt) : 'factory:Default';
    const W = this.host.wt;
    Promise.resolve()
      .then(() => (W && W.get ? W.get(this.id) : null))
      .catch(err => { console.warn('wtedit: load', err); return null; })
      .then(t => {
        if (this.closed) return;
        if (!t || !Array.isArray(t.frames) || !t.frames.length) {
          t = wt.factoryTable(this.id) || wt.factoryTable('factory:Default');
          if (!/^(factory|sub):/.test(this.id)) this.setMsg('Wavetable “' + this.id + '” is not available — editing a copy of the default saw', true);
        }
        this.table = { name: t.name || nameOfId(this.id), frames: t.frames.slice(0, MAXF), morph: t.morph | 0, factory: t.factory | 0 };
        const ws = s && s.ui && Array.isArray(s.ui.wtSel) ? s.ui.wtSel[this.osc] : 0;
        this.busy.remove();
        this.setCur(clamp(Math.round(+ws || 0), 0, this.table.frames.length - 1), { quiet: true });
        this.nameIn.value = this.table.name;
        this.invalidate();
      });
    try { this.rootEl.focus({ preventScroll: true }); } catch (err) { /* not focusable yet */ }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.g) this.endGesture();
    this.flush();
    for (const f of this.offs) f();
    this.offs.length = 0;
    if (this.raf && this.win && this.win.cancelAnimationFrame) this.win.cancelAnimationFrame(this.raf);
    if (this.ro) this.ro.disconnect();
    for (const t of this.tips) if (t && t.destroy) t.destroy(); // hides a shown tip and clears a pending one
    this.tips.length = 0;
    if (this.grid$ && this.grid$.destroy) this.grid$.destroy();
    if (this.live$ && this.live$.destroy) this.live$.destroy();
    if (this.mbar && this.mbar.destroy) this.mbar.destroy();
    if (this.rootEl) this.rootEl.remove();
    if (this.fileInp) this.fileInp.remove();
    this.isOpen = false;
    const cb = this.onClose;
    this.onClose = null;
    if (cb) cb();
  }

  state() { try { return this.host.state ? this.host.state() : null; } catch (err) { return null; } }
  edit(fn, opts) { if (this.host.edit) this.host.edit(fn, opts || {}); }
  notify(t) { if (this.host.notify) this.host.notify(t); }

  loadPrefs() {
    let v = null;
    try { v = this.host.storage && this.host.storage.get ? this.host.storage.get(STORE_KEY, null) : null; } catch (err) { v = null; }
    if (v && typeof v === 'object') {
      if (Number.isFinite(+v.binZoom)) this.prefs.binZoom = clamp(Math.round(+v.binZoom), 32, 512);
      if (Number.isFinite(+v.waveZoom)) this.prefs.waveZoom = clamp(+v.waveZoom, 1, 16);
      if (typeof v.split === 'string' || typeof v.split === 'number') this.prefs.split = wt.parseSplitSize(String(v.split)) ? String(v.split) : '';
    }
  }
  savePrefs() {
    try { if (this.host.storage && this.host.storage.set) this.host.storage.set(STORE_KEY, { binZoom: this.prefs.binZoom, waveZoom: this.prefs.waveZoom, split: this.prefs.split }); } catch (err) { /* storage full */ }
  }

  // The table oscillator `o` plays (cached by id for this session), or null.
  async loadOther(o) {
    const s = this.state(), x = s && s.osc && s.osc[o], W = this.host.wt;
    if (!x || !x.wt || o === this.osc) return null;
    const id = String(x.wt), c = this.others.get(o);
    if (c && c.id === id) return c.table;
    let t = null;
    try { t = W && W.get ? await W.get(id) : null; } catch (err) { t = null; }
    if (!t || !Array.isArray(t.frames) || !t.frames.length) t = wt.factoryTable(id);
    if (t) this.others.set(o, { id, table: t });
    return t;
  }
  // Touch modifier latches (wk.modifierBar; all off without a bar) and their release at a gesture's end.
  latches() { const M = wk.modifierBar && wk.modifierBar.mods; return M ? M({}) : { fine: false, alt: false, shift: false }; }
  consumeLatches() { const C = wk.modifierBar && wk.modifierBar.consume; if (C) C(); }

  /* ------------------------------------------------------------ DOM */
  h(tag, cls, text) {
    const e = this.doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  on(t, type, fn, opt) { t.addEventListener(type, fn, opt); this.offs.push(() => t.removeEventListener(type, fn, opt)); }
  btn(label, cls, fn, aria) {
    const b = this.h('button', 'wte-btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    if (aria) b.setAttribute('aria-label', aria);
    if (fn) b.addEventListener('click', fn);
    return b;
  }
  menuBtn(label, items, aria) {
    const b = this.btn(label + ' ▾', 'wte-mb', null, aria);
    b.setAttribute('aria-haspopup', 'menu');
    const openIt = () => {
      if (!this.table) return;
      const r = b.getBoundingClientRect();
      wk.contextMenu(r.left, r.bottom + 2, items(), { anchor: b });
    };
    b.addEventListener('click', openIt);
    b.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); openIt(); } });
    return b;
  }

  build() {
    const h = (t, c, x) => this.h(t, c, x);
    const root = this.rootEl = h('div', 'wte-root');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Wavetable editor, ' + OSC_NAMES[this.osc]);
    root.tabIndex = -1;

    // toolbar
    const bar = h('div', 'wte-bar');
    for (const [menu, label] of MENUS) bar.append(this.menuBtn(label, () => this.opsMenu(menu), label.charAt(0) + label.slice(1).toLowerCase() + ' menu'));
    bar.append(this.menuBtn('IMPORT', () => this.importMenu(), 'Import menu'), this.menuBtn('EXPORT', () => this.exportMenu(), 'Export menu'), h('span', 'wte-sep'));
    this.undoB = this.btn('↶', '', () => this.doUndo(), 'Undo');
    this.redoB = this.btn('↷', '', () => this.doRedo(), 'Redo');
    this.nameIn = h('input', 'wte-name');
    this.nameIn.type = 'text';
    this.nameIn.setAttribute('aria-label', 'Wavetable name');
    this.nameIn.maxLength = 64;
    this.nameIn.addEventListener('change', () => this.rename(this.nameIn.value));
    this.nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.nameIn.blur(); } });
    // Right-click (macOS: Ctrl-click) on the (tinted) name: the table menu; while the name is being edited: the browser's
    // own. Browsers focus a text field on the right-button press, before `contextmenu`, so the press records whether
    // the field was focused already and, when it was not, keeps it unfocused. (Touch: the TABLE ▾ button.)
    this.nameIn.addEventListener('mousedown', e => {
      if (!(e.button === 2 || (e.button === 0 && e.ctrlKey))) { this.namePress = null; return; }
      this.namePress = this.doc.activeElement === this.nameIn;
      if (!this.namePress) e.preventDefault();
    });
    this.nameIn.addEventListener('contextmenu', e => {
      const editing = this.namePress != null ? this.namePress : this.doc.activeElement === this.nameIn; // no press: the menu key
      this.namePress = null;
      if (!this.table || editing) return;
      e.preventDefault(); // focus returns to the TABLE button (the field would turn the next right-click into the browser's)
      wk.contextMenu(e.clientX, e.clientY, this.tableMenu(), { anchor: this.tableBtn });
    });
    const tm = this.tableBtn = this.menuBtn('TABLE', () => this.tableMenu(), 'Table menu: save, rename, init');
    const x = this.btn('✕', 'wte-x', () => this.close(), 'Close wavetable editor');
    bar.append(this.undoB, this.redoB, h('span', 'wte-sep'), this.nameIn, tm, h('span', 'wte-grow'));
    // touch mode (§13.1: coarse pointer or any touch seen; serum-ui's own bar is under this overlay): Shift (multi-select)
    // and Alt (+ Shift: phase nudge); the bar is built always and shown while the root has `wte-touch`
    if (typeof wk.modifierBar === 'function') {
      try { this.mbar = wk.modifierBar({ keys: ['shift', 'alt'] }); this.mbar.el.classList.add('wte-mk'); bar.append(this.mbar.el); } catch (err) { this.mbar = null; }
    }
    let touch = false;
    try { touch = typeof wk.touchMode === 'function' ? wk.touchMode() : !!(this.win.matchMedia && this.win.matchMedia('(pointer: coarse)').matches); } catch (err) { touch = false; }
    root.classList.toggle('wte-touch', touch);
    bar.append(x);

    // FFT area
    const fft = h('div', 'wte-fft'), fw = h('div', 'wte-fftw');
    this.fftCv = h('canvas', 'wte-cv');
    this.fftCv.tabIndex = 0;
    this.fftCv.setAttribute('role', 'img');
    this.fftCv.setAttribute('aria-label', 'Harmonics: magnitudes (top) and phases (bottom); drag to draw, context menu for spectral operations');
    fw.append(this.fftCv);
    const fs = h('div', 'wte-fside');
    this.live$ = wk.toggle({ label: 'Wave→FFT', kind: 'btn', get: () => this.liveFFT, set: v => { this.liveFFT = v ? 1 : 0; this.specFor = null; this.invalidate('fft'); } });
    const bz = h('div', 'wte-gridbox'), bzl = h('span', 'wte-lab', 'Bins');
    this.binIn = h('input', 'wte-range');
    Object.assign(this.binIn, { type: 'range', min: 32, max: 512, step: 1 });
    this.binIn.value = String(this.prefs.binZoom);
    this.binIn.setAttribute('aria-label', 'Number of harmonics shown');
    this.binIn.addEventListener('input', () => { this.prefs.binZoom = clamp(Math.round(+this.binIn.value), 32, 512); bzl.textContent = 'Bins ' + this.prefs.binZoom; this.invalidate('fft'); });
    this.binIn.addEventListener('change', () => this.savePrefs());
    bzl.textContent = 'Bins ' + this.prefs.binZoom;
    bz.append(bzl, this.binIn);
    this.fftRead = h('div', 'wte-read');
    fs.append(this.live$.el, bz, this.fftRead);
    fft.append(fw, fs);

    // tools, waveform, grid
    const mid = this.mid = h('div', 'wte-mid'), tools = h('div', 'wte-tools');
    tools.setAttribute('role', 'radiogroup');
    tools.setAttribute('aria-label', 'Draw tool');
    this.toolBtns = wt.DRAW_TOOLS.map((t, i) => {
      const b = h('button', 'wte-tool');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', t.label);
      b.dataset.tool = t.id;
      const sv = this.doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      sv.setAttribute('viewBox', '0 0 16 16');
      sv.setAttribute('aria-hidden', 'true');
      const p = this.doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', TOOL_ICONS[t.id]);
      sv.appendChild(p);
      b.appendChild(sv);
      b.addEventListener('click', () => this.setTool(t.id));
      b.addEventListener('keydown', e => {
        const k = e.key, n = wt.DRAW_TOOLS.length;
        const j = k === 'ArrowRight' || k === 'ArrowDown' ? (i + 1) % n : k === 'ArrowLeft' || k === 'ArrowUp' ? (i + n - 1) % n : -1;
        if (j < 0) return;
        e.preventDefault();
        this.setTool(wt.DRAW_TOOLS[j].id);
        this.toolBtns[j].focus();
      });
      this.tips.push(wk.tooltip(b, () => t.label));
      tools.append(b);
      return b;
    });
    const ww = h('div', 'wte-wavew');
    this.waveCv = h('canvas', 'wte-cv');
    this.waveCv.tabIndex = 0;
    this.waveCv.setAttribute('role', 'img');
    this.waveCv.setAttribute('aria-label', 'Waveform of the current frame; drag to draw with the selected tool');
    const zr = h('div', 'wte-zrow'), zl = h('span', 'wte-lab', 'Zoom');
    this.zoomIn = h('input', 'wte-range');
    Object.assign(this.zoomIn, { type: 'range', min: 1, max: 16, step: 0.25 });
    this.zoomIn.setAttribute('aria-label', 'Waveform zoom');
    this.zoomIn.addEventListener('input', () => this.setZoom(+this.zoomIn.value));
    this.zoomIn.addEventListener('change', () => this.savePrefs());
    this.scrollIn = h('input', 'wte-range');
    Object.assign(this.scrollIn, { type: 'range', min: 0, max: 1000, step: 1 });
    this.scrollIn.setAttribute('aria-label', 'Waveform scroll position');
    this.scrollIn.addEventListener('input', () => { this.waveScroll = +this.scrollIn.value / 1000; this.invalidate('wave'); });
    this.waveRead = h('span', 'wte-read');
    zr.append(zl, this.zoomIn, this.scrollIn, this.waveRead);
    const cvw = h('div', 'wte-cvw');
    cvw.append(this.waveCv);
    ww.append(cvw, zr);
    const side = h('div', 'wte-side'), gb = h('div', 'wte-gridbox');
    this.grid$ = typeof wk.numBox === 'function'
      ? wk.numBox({ label: 'GRID', get: () => this.grid / 64, set: n => this.setGrid(Math.round(n * 64)), def: 0, steps: 64, fmt: n => String(Math.round(n * 64)), parse: t => { const v = parseInt(t, 10); return Number.isFinite(v) ? clamp(v, 0, 64) / 64 : null; } })
      : this.fallbackGrid();
    gb.append(this.grid$.el);
    side.append(h('span', 'wte-grow'), gb);
    this.drop = h('div', 'wte-drop');
    this.zones = DROP_ZONES.map(([mode, label]) => { const z = h('div', 'wte-zone', label); z.dataset.mode = mode; this.drop.append(z); return z; });
    mid.append(tools, ww, side, this.drop);

    // formula / split size
    const form = h('div', 'wte-form');
    this.fxIn = h('input', 'wte-fx');
    this.fxIn.type = 'text';
    this.fxIn.placeholder = '(enter formula)';
    this.fxIn.setAttribute('aria-label', 'Formula, or import split size (samples or note name)');
    this.fxIn.setAttribute('spellcheck', 'false');
    this.fxIn.setAttribute('autocomplete', 'off');
    this.fxIn.value = this.prefs.split || '';
    this.fxIn.addEventListener('input', () => this.fieldChanged());
    this.fxIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.applyField(); } });
    const pre = this.menuBtn('PRESETS', () => this.formulaMenu(), 'Formula presets');
    const ap = this.btn('APPLY', '', () => this.applyField(), 'Apply formula');
    this.msg = h('div', 'wte-msg');
    this.msg.setAttribute('role', 'status');
    this.msg.setAttribute('aria-live', 'polite');
    form.append(this.fxIn, pre, ap, this.msg);

    // frames
    const foot = h('div', 'wte-foot'), fc = h('div', 'wte-fctl');
    this.minusB = this.btn('−', '', () => this.runOp('add.remove'), 'Remove current frame');
    this.plusB = this.btn('+', '', () => this.runOp('add.insert'), 'Insert a copy of the current frame');
    this.fnum = h('input', 'wte-fnum');
    this.fnum.type = 'text';
    this.fnum.setAttribute('inputmode', 'numeric');
    this.fnum.setAttribute('aria-label', 'Current frame');
    this.fnum.addEventListener('change', () => { const v = parseInt(this.fnum.value, 10); if (Number.isFinite(v) && this.table) this.setCur(clamp(v - 1, 0, this.table.frames.length - 1)); else this.syncUi(); });
    this.fnum.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.fnum.blur(); } });
    this.fcount = h('span', 'wte-fcount');
    const prev = this.btn('◀', '', () => this.step(-1), 'Previous frame'), next = this.btn('▶', '', () => this.step(1), 'Next frame');
    this.copyB = this.btn('COPY', '', () => this.copyFrames(), 'Copy the selected frames');
    this.pasteB = this.btn('PASTE', '', () => this.pasteFrames(), 'Paste frames after the current frame');
    fc.append(this.minusB, this.plusB, this.copyB, this.pasteB, prev, this.fnum, next, this.fcount);
    this.strip = h('div', 'wte-strip');
    this.strip.tabIndex = 0;
    this.strip.setAttribute('role', 'group');
    this.strip.setAttribute('aria-label', 'Frames: arrows select, Shift extends, Alt moves, Delete removes, Cmd/Ctrl-C copies, Cmd/Ctrl-V pastes; drag to reorder, drop audio to replace a frame');
    this.sp = h('div', 'wte-sp');
    this.thCv = h('canvas', 'wte-thc');
    this.thCv.setAttribute('aria-hidden', 'true');
    this.sp.append(this.thCv);
    this.strip.append(this.sp);
    foot.append(fc, this.strip);

    this.busy = h('div', 'wte-busy', 'Loading wavetable…');
    root.append(bar, fft, mid, form, foot, this.busy);
    this.root.appendChild(root);

    this.wire();
    this.zoomIn.value = String(this.prefs.waveZoom);
    this.syncUi();
    this.fieldChanged(true);
  }

  fallbackGrid() {
    const el = this.h('input', 'wte-gin');
    Object.assign(el, { type: 'number', min: 0, max: 64, step: 1 });
    el.setAttribute('aria-label', 'Grid size');
    el.addEventListener('change', () => this.setGrid(clamp(parseInt(el.value, 10) || 0, 0, 64)));
    const wrap = this.h('div', 'wte-gridbox');
    wrap.append(this.h('span', 'wte-lab', 'Grid'), el);
    return { el: wrap, update: () => { el.value = String(this.grid); } };
  }

  wire() {
    const R = this.rootEl, win = this.win;
    this.on(R, 'keydown', e => this.onKey(e));
    this.on(R, 'pointerdown', e => { if (e.pointerType === 'touch' && !R.classList.contains('wte-touch')) R.classList.add('wte-touch'); }, true);
    // waveform
    this.on(this.waveCv, 'pointerdown', e => this.waveDown(e));
    this.on(this.waveCv, 'pointermove', e => this.waveMove(e));
    this.on(this.waveCv, 'pointerup', e => this.pointerUp(e));
    this.on(this.waveCv, 'pointercancel', e => this.pointerCancel(e));
    this.on(this.waveCv, 'pointerleave', () => { this.waveRead.textContent = ''; });
    this.on(this.waveCv, 'wheel', e => this.waveWheel(e), { passive: false });
    // FFT
    this.on(this.fftCv, 'pointerdown', e => this.fftDown(e));
    this.on(this.fftCv, 'pointermove', e => this.fftMove(e));
    this.on(this.fftCv, 'pointerup', e => this.pointerUp(e));
    this.on(this.fftCv, 'pointercancel', e => this.pointerCancel(e));
    this.on(this.fftCv, 'pointerleave', () => { if (!this.g) { this.hover = null; this.fftRead.textContent = ''; this.invalidate('fft'); } });
    this.on(this.fftCv, 'contextmenu', e => this.fftMenu(e));
    // thumbnails
    this.on(this.thCv, 'pointerdown', e => this.thumbDown(e));
    this.on(this.thCv, 'pointermove', e => this.thumbMove(e));
    this.on(this.thCv, 'pointerup', e => this.pointerUp(e));
    this.on(this.thCv, 'pointercancel', e => this.pointerCancel(e));
    this.on(this.strip, 'scroll', () => this.invalidate('thumbs'));
    this.on(this.strip, 'keydown', e => this.stripKey(e));
    this.on(this.strip, 'wheel', e => { if (!e.deltaX && e.deltaY && this.strip.scrollWidth > this.strip.clientWidth) { e.preventDefault(); this.strip.scrollLeft += e.deltaY; } }, { passive: false });
    // files
    const hasFiles = e => !!(e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0);
    let depth = 0;
    this.on(R, 'dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; this.drop.classList.add('wte-on'); });
    this.on(R, 'dragleave', e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) this.dropOff(); });
    this.on(R, 'dragover', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      for (const z of this.zones) z.classList.toggle('wte-hot', z.contains(e.target));
    });
    this.on(R, 'drop', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      const files = Array.prototype.slice.call(e.dataTransfer.files || []);
      const zone = this.zones.find(z => z.contains(e.target));
      const onStrip = this.strip.contains(e.target);
      this.dropOff();
      if (!files.length) return;
      if (onStrip && this.table) { this.importFiles(files, 'replace', this.thumbAt(e.clientX)); return; }
      this.importFiles(files, zone ? zone.dataset.mode : 'pitchAvg');
    });
    // layout
    if (win && typeof win.ResizeObserver === 'function') {
      this.ro = new win.ResizeObserver(() => this.invalidate());
      this.ro.observe(R);
    } else if (win && win.addEventListener) this.on(win, 'resize', () => this.invalidate());
  }
  dropOff() { this.drop.classList.remove('wte-on'); for (const z of this.zones) z.classList.remove('wte-hot'); }

  /* ------------------------------------------------------------ state changes */
  frame() { return this.table.frames[this.cur]; }
  setTool(id) { this.tool = id; this.syncUi(); }
  setGrid(g) { this.grid = clamp(g | 0, 0, 64); if (this.grid$ && this.grid$.update) this.grid$.update(); this.invalidate('wave'); }
  setZoom(z, anchor) {
    const old = this.prefs.waveZoom, nz = clamp(z, 1, 16);
    if (anchor != null && nz > 1) { // keep the frame position under the pointer fixed
      const x0 = this.waveScroll * (1 - 1 / old), f = x0 + anchor / old, nx0 = clamp(f - anchor / nz, 0, 1 - 1 / nz);
      this.waveScroll = nz > 1 ? nx0 / (1 - 1 / nz) : 0;
    }
    this.prefs.waveZoom = nz;
    this.zoomIn.value = String(nz);
    this.scrollIn.value = String(Math.round(this.waveScroll * 1000));
    this.scrollIn.disabled = nz <= 1;
    this.invalidate('wave');
  }
  step(d) { if (this.table) this.setCur(clamp(this.cur + d, 0, this.table.frames.length - 1)); }
  setCur(k, o) {
    const R = this.table.frames.length;
    this.cur = clamp(k | 0, 0, R - 1);
    if (!(o && o.keepSel)) { this.sel = [this.cur, this.cur]; this.anchor = this.cur; }
    this.invalidate();
    if (this.cur !== this.lastSel) {
      this.lastSel = this.cur;
      if (!(o && o.quiet)) {
        const k2 = this.cur, osc = this.osc;
        this.edit(s => { if (s && s.ui && Array.isArray(s.ui.wtSel)) s.ui.wtSel[osc] = k2; }, { ui: true, label: 'Select frame' });
      }
    }
    this.scrollToCur();
  }
  scrollToCur() {
    const st = this.strip;
    if (!st || !st.clientWidth) return;
    const x = this.cur * TW;
    if (x < st.scrollLeft) st.scrollLeft = x;
    else if (x + TW > st.scrollLeft + st.clientWidth) st.scrollLeft = x + TW - st.clientWidth;
  }
  clampSel() {
    const R = this.table.frames.length;
    this.cur = clamp(this.cur, 0, R - 1);
    let [a, b] = this.sel;
    a = clamp(a, 0, R - 1); b = clamp(b, 0, R - 1);
    this.sel = a <= b ? [a, b] : [b, a];
    if (this.cur < this.sel[0] || this.cur > this.sel[1]) this.sel = [this.cur, this.cur];
  }

  // Replace the working table. frames = changed frame indices (live per-frame update) or null (full update).
  commit(next, o) {
    if (!next || next === this.table) return;
    if (!(o && o.noUndo)) this.undo.push(this.table);
    this.table = next;
    this.clampSel();
    this.invalidate();
    this.sync(o && o.frames !== undefined ? o.frames : changedFrames(this.undo.u[this.undo.u.length - 1], next));
  }
  setFrame(k, frame) { // live edit inside a gesture (the snapshot was taken at gesture start)
    const frames = this.table.frames.slice();
    frames[k] = frame;
    this.table = { name: this.table.name, frames, morph: this.table.morph, factory: 0 };
    this.invalidate('wave', 'fft', 'thumbs');
    this.sync([k]);
  }
  beginGesture() { if (this.table) this.undo.push(this.table); }
  endGesture() { this.g = null; this.specFor = null; this.consumeLatches(); this.invalidate(); }
  rename(name) {
    name = String(name || '').trim().slice(0, 64);
    if (!this.table || !name || name === this.table.name) { this.nameIn.value = this.table ? this.table.name : ''; return; }
    if (!this.owned) this.freshName = name; // an explicitly named copy keeps the name (no " *")
    this.commit(Object.assign({}, this.table, { name }), { frames: null });
    if (this.owned && this.host.wt && this.host.wt.rename) Promise.resolve(this.host.wt.rename(this.id, name)).catch(() => {});
  }
  doUndo() {
    if (this.g) { this.cancelGesture(); return; } // mid-stroke: undo = revert the stroke (its snapshot is on the stack)
    const t = this.undo.undo(this.table);
    if (!t) return;
    this.table = t;
    this.clampSel();
    this.nameIn.value = t.name;
    this.invalidate();
    this.sync(null);
  }
  doRedo() {
    if (this.g) return;
    const t = this.undo.redo(this.table);
    if (!t) return;
    this.table = t;
    this.clampSel();
    this.nameIn.value = t.name;
    this.invalidate();
    this.sync(null);
  }

  /* ------------------------------------------------------------ copy-on-write and live updates */
  sync(frames) {
    if (!this.table) return;
    if (!this.owned) { this.copyOnWrite(); return; }
    const t = this.table, R = t.frames.length, P = this.pend, spectral = t.morph >= 2 && R > 1 && R < MAXF;
    if (!frames || spectral || R !== P.sentR || t.morph !== P.sentMorph) P.full = true;
    else for (const f of frames) P.frames.add(f);
    this.schedule(spectral ? 150 : 33, spectral);
  }
  schedule(ms, debounce) {
    const P = this.pend, now = Date.now();
    if (debounce) { clearTimeout(P.timer); P.timer = setTimeout(() => this.flush(), ms); return; }
    if (P.timer) return;
    P.timer = setTimeout(() => this.flush(), Math.max(0, P.last + ms - now));
  }
  flush() {
    const P = this.pend;
    clearTimeout(P.timer);
    P.timer = 0;
    if (!this.owned || !this.table || !this.id || (!P.full && !P.frames.size)) return;
    const frames = P.full ? null : Array.from(P.frames).sort((a, b) => a - b);
    P.full = false;
    P.frames.clear();
    P.last = Date.now();
    P.sentR = this.table.frames.length;
    P.sentMorph = this.table.morph;
    const W = this.host.wt;
    try { if (W && W.update) W.update(this.id, this.table, { frames }); } catch (err) { console.warn('wtedit: live update', err); }
  }
  copyOnWrite() {
    const W = this.host.wt;
    if (this.cow || !W || !W.saveNew || !this.table) return;
    const base = String(this.table.name || nameOfId(this.id) || 'Wavetable').slice(0, 62);
    const name = this.freshName || (/ \*$/.test(base) ? base : base + ' *');
    this.freshName = null;
    this.table = Object.assign({}, this.table, { name, factory: 0 });
    this.nameHistory(name);
    if (this.nameIn) this.nameIn.value = name;
    this.invalidate('ui'); // the name tint
    const snap = this.table;
    this.cow = Promise.resolve()
      .then(() => W.saveNew(snap, name))
      .then(id => {
        this.cow = null;
        if (!id) throw new Error('the host returned no id');
        this.id = String(id);
        this.owned = true;
        const osc = this.osc;
        this.edit(s => { if (s && s.osc && s.osc[osc]) s.osc[osc].wt = this.id; }, { label: 'Edit wavetable' });
        const P = this.pend;
        P.sentR = snap.frames.length;
        P.sentMorph = snap.morph;
        const pre = this.cowPre;
        this.cowPre = null;
        if (pre) { // an import arrived meanwhile: this copy keeps the pre-import state, the import becomes its own table
          if (pre !== snap) try { if (W.update) W.update(this.id, pre, { frames: null }); } catch (err) { console.warn('wtedit: live update', err); }
          this.owned = false;
          this.copyOnWrite();
          return;
        }
        if (this.table !== snap) { P.full = true; if (this.closed) this.flush(); else this.schedule(33); }
      })
      .catch(err => {
        this.cow = null;
        this.cowPre = null;
        console.warn('wtedit: save', err);
        if (!this.closed) this.setMsg('Could not store the edited wavetable: ' + (err && err.message || err), true);
      });
  }

  // Every undo/redo snapshot takes the name of the table they now belong to (a new copy or a saved table), so that an
  // undo after a copy-on-write or Save Table never renames the stored table back to the source's name.
  nameHistory(name) {
    const fix = list => { for (let i = 0; i < list.length; i++) if (list[i].name !== name) list[i] = Object.assign({}, list[i], { name }); };
    fix(this.undo.u); fix(this.undo.r);
  }

  /* ------------------------------------------------------------ operations */
  seed() { this.seedN = (Math.imul(this.seedN ^ (this.seedN >>> 15), 0x2C1B3C6D) + 0x9E3779B9) >>> 0; return this.seedN || 1; }
  opCtx(extra) { return Object.assign({ cur: this.cur, sel: this.sel.slice(), grid: this.grid, other: null, clip: CLIP.frames, seed: this.seed(), to: this.table.frames.length, n: 2 }, extra || {}); }
  // extra.otherOsc (0–2): the oscillator a "from Other Osc" op reads (default: the first other one playing a wavetable).
  async runOp(id, extra) {
    if (!this.table) return;
    const op = wt.OPS[id];
    if (!op) return;
    if (op.host) { if (id === 'single.toNoise') await this.sendToNoise(); return; }
    let other = null;
    if (op.needsOther) {
      const cand = otherOscs(this.state(), this.osc).filter(c => c.ok), o = extra && extra.otherOsc != null ? +extra.otherOsc : cand.length ? cand[0].osc : -1;
      other = o >= 0 ? await this.loadOther(o) : null;
    }
    if (this.closed || !this.table) return;
    const ctx = this.opCtx(Object.assign({}, extra || {}, { other }));
    if (!wt.opEnabled(this.table, id, ctx)) {
      this.setMsg(id === 'add.paste' && ctx.clip.length ? 'The table is full (256 frames)' : id === 'add.paste' ? 'Nothing to paste — COPY frames first' : op.label + ': not available for this table');
      return;
    }
    const R0 = this.table.frames.length;
    let next;
    try { next = wt.applyOp(this.table, id, ctx); } catch (err) { this.setMsg(op.label + ' failed: ' + err.message, true); return; }
    const frames = id.startsWith('single.') ? [ctx.cur] : null;
    this.commit(next, { frames });
    this.afterOp(id, ctx, R0);
    this.setMsg(id === 'add.paste' ? this.pasteMsg(this.table.frames.length - R0, ctx.clip.length) : '');
  }
  // Where the current frame lands after an operation that changes the frame list (R0 = the frame count before).
  afterOp(id, ctx, R0) {
    const R = this.table.frames.length, a = Math.min(ctx.sel[0], ctx.sel[1]), b = Math.max(ctx.sel[0], ctx.sel[1]);
    let c = null;
    switch (id) {
      case 'add.insert': c = ctx.cur + 1; break;
      case 'add.removeSel': c = a; break;
      case 'add.removeToSel': case 'add.removeOthers': c = ctx.cur - a; break;
      case 'add.reduce': c = Math.floor(ctx.cur / ctx.n); break;
      case 'add.reduceTo': if (R0 > R && R > 1) c = Math.round(ctx.cur * (R - 1) / (R0 - 1)); break;
      case 'add.paste': { // the pasted frames: current = the first, selected = all of them
        const n = R - (R0 || R);
        if (n <= 0) return;
        this.setCur(ctx.cur + 1);
        this.sel = [ctx.cur + 1, ctx.cur + n];
        this.anchor = ctx.cur + 1;
        this.invalidate();
        return;
      }
      case 'all.half': c = 2 * ctx.cur; break;
      case 'all.double': c = Math.floor(ctx.cur / 2); break;
      case 'add.initAll': c = 0; break;
      case 'add.move': {
        const n = b - a + 1;
        if (ctx.to >= a && ctx.to <= b + 1) return;
        const na = ctx.to > b ? ctx.to - n : ctx.to;
        this.cur = clamp(na + (ctx.cur - a), na, na + n - 1);
        this.sel = [na, na + n - 1];
        this.invalidate();
        this.scrollToCur();
        return;
      }
    }
    if (c != null) this.setCur(clamp(c, 0, R - 1));
    else if (this.cur >= R) this.setCur(R - 1);
  }
  async sendToNoise() {
    const W = this.host.wt;
    if (!W || !W.saveNoise) { this.setMsg('Send to Noise Oscillator is not available', true); return; }
    const name = (this.table.name || 'Wavetable') + ' ' + (this.cur + 1);
    try {
      const id = await W.saveNoise(wt.frameToNoise(this.frame(), name), name);
      if (!id) throw new Error('the host returned no id');
      // the cycle is a loop pitched for keytrack (§7.9): picking a source sets its one-shot default (§9.3)
      this.edit(s => { s.noise.src = id; s.noise.oneshot = 0; s.noise.keytrack = 1; s.p['n.on'] = 1; }, { label: 'Send to Noise Oscillator' });
      this.setMsg('Sent frame ' + (this.cur + 1) + ' to the noise oscillator');
      this.notify('Noise oscillator: “' + name + '”');
    } catch (err) {
      this.setMsg('Send to Noise Oscillator failed: ' + (err && err.message || err), true);
    }
  }

  /* ------------------------------------------------------------ frame clipboard (COPY / PASTE) */
  copyFrames() {
    if (!this.table) return;
    CLIP.frames = copyRange(this.table, this.sel);
    const n = CLIP.frames.length, [a] = this.sel;
    this.setMsg('Copied ' + (n > 1 ? n + ' frames (' + (a + 1) + '–' + (a + n) + ')' : 'frame ' + (a + 1)));
    this.syncUi();
  }
  pasteFrames() { if (this.table && !this.g) return this.runOp('add.paste'); return Promise.resolve(); }
  pasteMsg(n, m) { return n <= 0 ? '' : 'Pasted ' + n + (n > 1 ? ' frames' : ' frame') + (n < m ? ' of ' + m + ' (256 frames at most)' : ''); }

  /* ------------------------------------------------------------ table menu (the name field's menu) */
  tableMenu() {
    return [
      { label: 'Save Table…', action: () => this.saveTable(), disabled: !(this.host.wt && this.host.wt.saveNew) },
      { label: 'Rename', action: () => { try { this.nameIn.focus(); this.nameIn.select(); } catch (err) { /* not focusable */ } } },
      { sep: true },
      { label: wt.OPS['add.initAll'].label, action: () => this.runOp('add.initAll') },
    ];
  }
  // Save Table…: stores the working table as a new user table under the chosen name and points the oscillator at it
  // (later edits go there) — the copy-on-write path with an explicit name; an earlier " *" copy stays in the store.
  async saveTable() {
    const W = this.host.wt;
    if (!this.table || !W || !W.saveNew) return;
    const def = String(this.table.name || 'Wavetable').replace(/ \*$/, ''), ask = this.win && this.win.prompt;
    const name = String((ask ? ask.call(this.win, 'Save wavetable as', def) : def) || '').trim().slice(0, 64);
    if (!name) return;
    for (let i = 0; this.cow && i < 4; i++) await this.cow; // a pending copy-on-write finishes first (it never rejects)
    if (this.closed || !this.table || this.cow) return;
    this.flush(); // pending live updates belong to the previous copy
    this.owned = false;
    this.freshName = name;
    this.copyOnWrite();
    const p = this.cow;
    if (!p) return;
    await p;
    if (!this.owned) return; // failed (copyOnWrite reported it)
    if (!this.closed) this.setMsg('Saved “' + name + '”');
    this.notify('Wavetable saved: “' + name + '”');
  }
  reduceToAsk() {
    const R = this.table ? this.table.frames.length : 0, ask = this.win && this.win.prompt;
    if (R < 3 || !ask) return;
    const v = parseInt(ask.call(this.win, 'Reduce to how many frames? (2–' + (R - 1) + ')', String(Math.max(2, R >> 1))), 10);
    if (Number.isFinite(v) && v >= 2 && v < R) this.runOp('add.reduceTo', { n: v });
  }

  opsMenu(menu) {
    const t = this.table, ctx = this.opCtx(), items = [];
    for (const op of Object.values(wt.OPS)) {
      if (op.menu !== menu || (menu === 'Add/Remove' && REMOVE_SKIP.has(op.id))) continue;
      if (menu === 'Process' && PROCESS_BREAKS.has(op.id)) items.push({ sep: true });
      if (op.id === 'add.reduceTo') {
        const R = t.frames.length;
        items.push({ label: 'Reduce to', disabled: R < 3, sub: REDUCE_TO.filter(n => n < R).map(n => ({ label: n + ' frames', action: () => this.runOp(op.id, { n }) }))
          .concat([{ sep: true }, { label: 'Other…', action: () => this.reduceToAsk() }]) });
        continue;
      }
      if (op.sub) {
        items.push({ label: op.label, disabled: t.frames.length < 2, sub: Array.from({ length: 15 }, (_, i) => i + 2).map(n => ({ label: 'Keep every ' + ordinal(n) + ' frame', action: () => this.runOp(op.id, { n }) })) });
        continue;
      }
      if (op.needsOther) { // ▸ OSC A / B / C (the others)
        const cands = otherOscs(this.state(), this.osc);
        items.push({ label: op.label, disabled: !cands.some(c => c.ok), sub: cands.map(c => ({ label: c.label, disabled: !c.ok, action: () => this.runOp(op.id, { otherOsc: c.osc }) })) });
        continue;
      }
      const it = { label: op.label, action: () => this.runOp(op.id), disabled: !wt.opEnabled(t, op.id, ctx) };
      if (menu === 'Morph') {
        const m = { 'morph.crossfade': 1, 'morph.spectral': 2, 'morph.spectralZeroFund': 3, 'morph.spectralZeroAll': 4, 'morph.remove': 0 }[op.id];
        if (op.id === 'morph.remove') it.disabled = !t.morph;
        else it.checked = t.morph === m;
      }
      if (op.host) it.disabled = !(this.host.wt && this.host.wt.saveNoise);
      items.push(it);
    }
    return items;
  }

  /* ------------------------------------------------------------ formula field */
  fieldChanged(initial) {
    const info = fieldInfo(this.fxIn.value);
    this.fxIn.classList.toggle('wte-bad', info.kind === 'error');
    if (info.kind === 'split') { this.setMsg('split size: ' + info.msg.replace(/^split at: /, '') + ' — used by audio imports'); }
    else if (info.kind === 'error') this.setMsg(info.msg, true);
    else if (!initial) this.setMsg('');
    const split = info.kind === 'split' ? String(this.fxIn.value).trim() : ''; // the held split size (serum-ui's display drops use it too)
    if (split !== this.prefs.split) { this.prefs.split = split; this.savePrefs(); }
  }
  applyField() {
    if (!this.table) return;
    const info = fieldInfo(this.fxIn.value);
    if (info.kind === 'clear') { this.fxIn.value = ''; this.fieldChanged(); this.setMsg('split size cleared'); return; }
    if (info.kind === 'empty') { this.setMsg('Enter a formula, e.g. sin(pi*x) or (1/q)^0.5'); return; }
    if (info.kind === 'split') { this.setMsg(info.msg); return; }
    if (info.kind === 'error') { this.setMsg(info.msg, true); return; }
    const res = wt.applyFormula(this.table, { src: this.fxIn.value, cur: this.cur, sel: this.cur, seed: this.seed() });
    if (res.error) { this.setMsg(res.error, true); return; }
    this.commit(res.table, { frames: info.multi ? null : [this.cur] });
    this.setMsg(info.multi ? 'Formula applied to all 256 frames' : 'Formula applied to frame ' + (this.cur + 1));
  }
  useFormula(src) { this.fxIn.value = src; this.fieldChanged(); this.applyField(); }
  formulaMenu() {
    const u = loadFormulas(this.host.storage), P = wt.FORMULA_PRESETS;
    const list = l => l.map(p => ({ label: p.name, action: () => this.useFormula(p.src) }));
    const info = fieldInfo(this.fxIn.value);
    const del = [...u.singles.map((p, i) => ({ label: p.name, action: () => this.deleteFormula('singles', i) })),
      ...u.multis.map((p, i) => ({ label: p.name + ' (multi)', action: () => this.deleteFormula('multis', i) }))];
    return [
      { label: 'Singles', sub: list(P.singles) }, { label: 'Multis', sub: list(P.multis) },
      { label: 'User Singles', sub: list(u.singles), disabled: !u.singles.length },
      { label: 'User Multis', sub: list(u.multis), disabled: !u.multis.length },
      { sep: true },
      { label: 'Save Formula…', action: () => this.saveFormula(), disabled: info.kind !== 'formula' },
      { label: 'Delete User Formula', sub: del, disabled: !del.length },
    ];
  }
  saveFormula() {
    const info = fieldInfo(this.fxIn.value);
    if (info.kind !== 'formula') return;
    const src = this.fxIn.value.trim(), ask = this.win && this.win.prompt;
    const name = String((ask ? ask.call(this.win, 'Formula name', src.slice(0, 24)) : src) || '').trim().slice(0, 48);
    if (!name) return;
    const u = loadFormulas(this.host.storage), key = info.multi ? 'multis' : 'singles';
    u[key] = u[key].filter(f => f.name !== name).concat([{ name, src }]);
    try { this.host.storage.set(FORMULA_KEY, u); this.setMsg('Saved formula “' + name + '”'); } catch (err) { this.setMsg('Could not save the formula', true); }
  }
  deleteFormula(key, i) {
    const u = loadFormulas(this.host.storage);
    const gone = u[key].splice(i, 1)[0];
    try { this.host.storage.set(FORMULA_KEY, u); if (gone) this.setMsg('Deleted formula “' + gone.name + '”'); } catch (err) { /* storage unavailable */ }
  }
  setMsg(text, err) {
    if (!this.msg) return;
    this.msg.textContent = text || '';
    this.msg.classList.toggle('wte-err', !!err && !!text);
  }

  /* ------------------------------------------------------------ import / export */
  importMenu() {
    const smp = this.host.smp, can = !!(smp && typeof smp.import === 'function');
    return IMPORT_ITEMS.map(it => (it ? { label: it[1], action: () => this.pickFiles(it[0]) } : { sep: true })).concat([
      { sep: true },
      { label: 'Frequency Estimation…', action: () => this.pickFiles('freqEst') },
      { label: 'Switch OSC Type', disabled: !can, sub: SWITCH_TYPES.map(([type, label]) => ({ label: label + '…', action: () => this.pickFiles('switch:' + type) })) },
    ]);
  }
  pickFiles(mode) {
    if (this.fileInp) this.fileInp.remove(); // a previous dialog may have been cancelled
    const inp = this.fileInp = this.h('input');
    inp.type = 'file';
    const sw = /^switch:/.test(mode);
    inp.accept = mode === 'image' ? '.png,image/png' : mode === 'freqEst' ? WAV_ACCEPT : sw ? SAMPLE_ACCEPT : WAV_ACCEPT + ',.txt,.png,image/png';
    inp.multiple = mode === 'singles' || (mode !== 'image' && mode !== 'freqEst' && !sw); // a .txt override may accompany the WAV
    inp.style.display = 'none';
    inp.addEventListener('change', () => {
      const files = Array.prototype.slice.call(inp.files || []);
      inp.remove();
      if (this.fileInp === inp) this.fileInp = null;
      if (files.length) this.importFiles(files, mode);
    });
    (this.doc.body || this.rootEl).appendChild(inp);
    inp.click();
  }
  async decodeImage(file) {
    const w = this.win, bmp = await w.createImageBitmap(file), c = this.h('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    if (bmp.close) bmp.close();
    const im = g.getImageData(0, 0, c.width, c.height);
    return { width: im.width, height: im.height, data: im.data, name: file.name };
  }
  // A stereo file's channel for this oscillator (L → A/C, R → B) as a one-channel view of the decoded file.
  chan(wav) { const c = channelFor(this.osc, wav.ch.length); return c ? Object.assign({}, wav, { ch: [wav.ch[c]] }) : wav; }
  // mode: an import mode (§8.2.5), 'singles', 'image', 'replace' (thumbnail drop at frame `target`), 'freqEst'
  // (Frequency Estimation) or 'switch:sample' | 'switch:gran' | 'switch:spec' (Switch OSC Type).
  async importFiles(files, mode, target) {
    if (!this.table) return;
    if (/^switch:/.test(String(mode))) { await this.switchType(String(mode).slice(7), files); return; }
    const cls = classifyFiles(files);
    try {
      if (mode === 'freqEst') {
        const f = cls.wavs[0];
        if (!f) { this.setMsg('Frequency estimation: choose a WAV file', true); return; }
        const wav = wt.readWav(await f.arrayBuffer()), P = wt.estimatePeriod(wav);
        if (this.closed) return;
        if (!P) { // a split size held from an earlier file would silently cut the next import: cleared
          const held = fieldInfo(this.fxIn.value).kind === 'split';
          if (held) { this.fxIn.value = ''; this.fieldChanged(); }
          this.setMsg('Frequency estimation: no pitch detected in “' + fileBase(f.name) + '”' + (held ? ' — split size cleared' : ''), true);
          return;
        }
        const v = Math.round(P * 100) / 100; // the period in the file's own samples (what its import splits by)
        this.fxIn.value = String(v);
        this.fieldChanged();
        this.setMsg(wt.splitMsg(v, wav.sr) + ' — estimated from “' + fileBase(f.name) + '”' + (wav.sr && wav.sr !== 44100 ? ' (' + wav.sr + ' Hz)' : ''));
        return;
      }
      if (mode === 'replace') {
        const f = cls.wavs[0];
        if (!f) { this.setMsg('Drop a WAV file on a thumbnail to replace that frame', true); return; }
        const wav = this.chan(wt.readWav(await f.arrayBuffer()));
        if (this.closed) return;
        const k = clamp(target | 0, 0, this.table.frames.length - 1), split = wt.parseSplitSize(this.fxIn.value);
        this.commit(wt.replaceFrame(this.table, k, wav, split ? { size: split } : undefined), { frames: [k] });
        this.setCur(k);
        this.setMsg('Frame ' + (k + 1) + ' replaced by “' + fileBase(f.name) + '”');
        return;
      }
      let table, msg = '';
      if (mode === 'image' && !cls.pngs.length) { this.setMsg('Choose a PNG image', true); return; }
      if (cls.pngs.length && (mode === 'image' || !cls.wavs.length)) {
        table = wt.importImage(await this.decodeImage(cls.pngs[0]));
        table.name = fileBase(cls.pngs[0].name);
      } else if (cls.wavs.length && (mode === 'singles' || cls.wavs.length > 1)) {
        const wavs = [];
        for (const f of cls.wavs.slice(0, MAXF)) wavs.push(this.chan(wt.readWav(await f.arrayBuffer())));
        table = wt.importSingles(wavs, fileBase(cls.wavs[0].name));
        msg = wavs.length + ' single cycles imported';
      } else if (cls.wavs.length) {
        const f = cls.wavs[0], wav = wt.readWav(await f.arrayBuffer());
        const txt = cls.txts.length ? wt.parseTxtOverride(await readText(cls.txts[0])) : null;
        const fftMode = /^fft/.test(mode), split = fftMode ? null : wt.parseSplitSize(this.fxIn.value);
        if (mode === 'manual' && !split && !wav.clm) { this.setMsg('Type a split size (1–9999 samples or a note name such as A3) into the formula field first', true); return; }
        const channel = channelFor(this.osc, wav.ch.length);
        table = wt.tableFromWav(wav, { mode: mode === 'manual' ? 'manual' : mode || 'pitchAvg', size: split || undefined, channel, txt, name: fileBase(f.name) });
        if (table.importSize && !split) { this.fxIn.value = String(Math.round(table.importSize * 100) / 100); this.fieldChanged(); }
        msg = table.importMsg || '';
        if (wav.ch.length > 1) msg = (msg ? msg + ' · ' : '') + (channel ? 'right' : 'left') + ' channel';
      } else { this.setMsg('Nothing to import — drop WAV, PNG or TXT files', true); return; }
      if (this.closed) return;
      this.importTable(table, msg);
    } catch (err) {
      console.warn('wtedit: import', err);
      if (!this.closed) this.setMsg('Import failed: ' + (err && err.message || err), true);
    }
  }
  importTable(t, msg) {
    const next = { name: String(t.name || 'Import').slice(0, 64), frames: t.frames.slice(0, MAXF), morph: t.morph | 0, factory: 0 };
    if (this.cow && !this.cowPre) this.cowPre = this.table; // the pending copy must not adopt the import (copyOnWrite)
    this.undo.push(this.table);
    this.table = next;
    this.owned = false; // an import becomes a new user table named after the file
    this.freshName = next.name;
    this.nameIn.value = next.name;
    this.setCur(0);
    this.sync(null);
    this.setMsg(msg || 'Imported “' + next.name + '” (' + next.frames.length + ' frame' + (next.frames.length > 1 ? 's' : '') + ')');
  }
  // Switch OSC Type ▸ (inv B11): the file becomes a sample asset (host.smp.import, §9.3) played by this oscillator as
  // Sample / Granular / Spectral (type + `smp` in one state edit); the editor then closes (no wavetable to edit).
  async switchType(type, files) {
    const smp = this.host.smp, T = SWITCH_TYPES.find(t => t[0] === type);
    if (!T) return;
    if (!smp || typeof smp.import !== 'function') { this.setMsg('Sample import is not available', true); return; }
    const list = Array.prototype.slice.call(files || [], 0, 1); // one file: the oscillator plays one sample
    if (!list.length) return;
    const nm = fileBase(list[0].name);
    if (/\.(sfz|zip)$/i.test(String(list[0].name || ''))) { this.setMsg('Switch OSC Type takes one audio file — load SFZ / ZIP multisamples into a Multisample oscillator', true); return; }
    this.setMsg('Importing “' + nm + '” as a ' + T[1] + ' oscillator…');
    let id = null;
    try { id = await smp.import(list, { kind: 'sample', osc: this.osc }); } catch (err) {
      if (!this.closed) this.setMsg('Import failed: ' + (err && err.message || err), true);
      return;
    }
    if (!id) { if (!this.closed) this.setMsg('Nothing imported', true); return; }
    const osc = this.osc, sid = String(id);
    if (!/^f?smp:/.test(sid)) { // §2.2.5: osc.smp holds a sample id (a multisample id would be dropped: a silent oscillator)
      const t = '“' + nm + '” is not a single sample — load multisamples into a Multisample oscillator';
      if (this.closed) this.notify(t); else this.setMsg(t, true);
      return;
    }
    this.flush();
    this.edit(s => { // as the panel's own sample loads: the previous sample's trim / reverse / normalize / fades do not carry over
      const x = s && s.osc && s.osc[osc];
      if (!x) return;
      x.type = type; x.smp = sid;
      if (x.smpo && typeof x.smpo === 'object') x.smpo.ops = { fade: 0, norm: 0, rev: 0, trim: null };
    }, { label: 'Switch OSC Type' });
    this.notify(OSC_NAMES[osc] + ': ' + T[1] + ' “' + nm + '”');
    this.close();
  }
  exportMenu() {
    const [a, b] = this.sel, base = String(this.table.name || '').replace(/ \*$/, '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Wavetable';
    const wav = (bits, frames, suffix) => () => this.download(new Blob([wt.tableToWav(this.table, { bits, frames })], { type: 'audio/wav' }), base + suffix + '.wav');
    return [
      { label: 'Export All as 16-bit WAV', action: wav(16, null, ' (16-bit)') },
      { label: 'Export All as 32-bit WAV', action: wav(32, null, '') },
      { label: 'Export All as Single-Cycle Waves (.zip)', action: () => this.download(new Blob([zipStore(wt.tableToSingles(this.table).map(s => ({ name: s.name, data: s.buffer })))], { type: 'application/zip' }), base + ' (single cycles).zip') },
      { label: 'Export All as 8-bit (.256)', action: () => this.download(new Blob([wt.tableTo256(this.table)], { type: 'application/octet-stream' }), base + '.256') },
      { label: 'Export Selection (frames ' + (a + 1) + (b > a ? '–' + (b + 1) : '') + ')', action: () => wav(32, Array.from({ length: this.sel[1] - this.sel[0] + 1 }, (_, i) => this.sel[0] + i), ' (frames ' + (this.sel[0] + 1) + '-' + (this.sel[1] + 1) + ')')() },
    ];
  }
  download(blob, name) {
    const U = this.win.URL || globalThis.URL;
    if (!U || !U.createObjectURL) { this.setMsg('Downloads are not supported here', true); return; }
    const url = U.createObjectURL(blob), a = this.h('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    (this.doc.body || this.rootEl).appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => U.revokeObjectURL(url), 10000);
    this.setMsg('Exported “' + name + '”');
  }

  /* ------------------------------------------------------------ keyboard */
  onKey(e) {
    if (e.defaultPrevented) return;
    const k = e.key, mod = e.metaKey || e.ctrlKey, inText = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') && e.target.type !== 'range';
    if (k === 'Escape') {
      e.preventDefault();
      if (this.g) { this.cancelGesture(); return; }
      if (inText) { e.target.blur(); this.rootEl.focus({ preventScroll: true }); return; } // first Escape leaves the field
      this.close();
      return;
    }
    if (inText || !mod) return;
    if ((k === 'z' || k === 'Z') && !e.shiftKey) { e.preventDefault(); this.doUndo(); }
    else if (((k === 'z' || k === 'Z') && e.shiftKey) || k === 'y' || k === 'Y') { e.preventDefault(); this.doRedo(); }
  }
  stripKey(e) {
    if (!this.table || this.g) return; // no frame list changes in the middle of a stroke or drag
    const R = this.table.frames.length, k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      const d = k === 'ArrowLeft' ? -1 : 1;
      if (e.altKey) { // move the selection one place
        const [a, b] = this.sel, to = d < 0 ? a - 1 : b + 2;
        if (to >= 0 && to <= R) this.runOp('add.move', { sel: [a, b], to });
      } else if (e.shiftKey) {
        const c = clamp(this.cur + d, 0, R - 1);
        this.cur = c;
        this.sel = [Math.min(this.anchor, c), Math.max(this.anchor, c)];
        this.invalidate();
        this.scrollToCur();
      } else this.step(d);
    } else if (k === 'Home' || k === 'End') { e.preventDefault(); this.setCur(k === 'Home' ? 0 : R - 1); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.runOp(this.sel[1] > this.sel[0] ? 'add.removeSel' : 'add.remove'); }
    else if (k === 'Insert') { e.preventDefault(); this.runOp('add.insert'); }
    else if ((e.metaKey || e.ctrlKey) && !e.altKey && (k === 'c' || k === 'C')) { e.preventDefault(); this.copyFrames(); }
    else if ((e.metaKey || e.ctrlKey) && !e.altKey && (k === 'v' || k === 'V')) { e.preventDefault(); this.pasteFrames(); }
  }

  /* ------------------------------------------------------------ pointer: waveform */
  wavePos(e) {
    const r = this.waveCv.getBoundingClientRect(), w = r.width || 1, h = r.height || 1, pad = 6;
    const z = this.prefs.waveZoom, x0 = this.waveScroll * (1 - 1 / z);
    return { x: clamp(x0 + (e.clientX - r.left) / w / z, 0, 1), y: clamp(1 - 2 * (e.clientY - r.top - pad) / Math.max(1, h - 2 * pad), -1, 1) };
  }
  capture(cv, e) { try { cv.setPointerCapture(e.pointerId); } catch (err) { /* pointer gone */ } }
  waveDown(e) {
    if (!this.table || e.button !== 0 || this.g) return;
    e.preventDefault();
    this.capture(this.waveCv, e);
    const p = this.wavePos(e);
    this.beginGesture();
    this.g = { kind: 'wave', id: e.pointerId, frame: this.cur, base: this.frame(), start: p, last: p, seed: this.seed(), cell: this.grid > 0 ? wt.cellOf(p.x, this.grid) : [0, FRAME] };
    this.waveDraw(p);
  }
  waveMove(e) {
    const p = this.table ? this.wavePos(e) : null;
    if (p) this.waveRead.textContent = 'sample ' + Math.min(FRAME - 1, Math.floor(p.x * FRAME)) + ' · ' + this.frame()[Math.min(FRAME - 1, Math.floor(p.x * FRAME))].toFixed(3);
    if (!this.g || this.g.kind !== 'wave' || e.pointerId !== this.g.id) return;
    this.waveDraw(p);
  }
  waveDraw(p) {
    const G = this.grid, g = this.g, tool = this.tool;
    let f = this.table.frames[g.frame]; // the stroke stays on the frame it started on
    const cells = () => { // cells crossed since the last pointer event
      const out = [], a = Math.min(this.cellIdx(g.last.x), this.cellIdx(p.x)), b = Math.max(this.cellIdx(g.last.x), this.cellIdx(p.x));
      for (let c = a; c <= b; c++) out.push([Math.round(c * FRAME / G), Math.round((c + 1) * FRAME / G)]);
      return out;
    };
    if (tool === 'sine') f = wt.drawTool(g.base, 'sine', { x1: p.x, y1: clamp(p.y - g.start.y, -1, 1), grid: G });
    else if (tool === 'nudge' || tool === 'noise') f = wt.drawTool(g.base, tool, { x1: p.x, y0: g.start.y, y1: p.y, cell: g.cell, seed: g.seed, grid: G });
    else if (G > 0) for (const cell of cells()) f = wt.drawTool(f, tool, { x1: p.x, y1: p.y, cell, grid: G });
    else if (tool === 'flat' || tool === 'mirror') f = wt.drawTool(f, tool, { x0: g.last.x, y0: g.last.y, x1: p.x, y1: p.y, grid: 0 });
    else f = wt.drawTool(g.base, tool, { x0: g.start.x, x1: p.x, y1: p.y, grid: 0 });
    g.last = p;
    this.setFrame(g.frame, f);
  }
  cellIdx(x) { return Math.min(this.grid - 1, Math.max(0, Math.floor(x * this.grid))); }
  waveWheel(e) {
    const r = this.waveCv.getBoundingClientRect(), ax = clamp((e.clientX - r.left) / (r.width || 1), 0, 1);
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.setZoom(this.prefs.waveZoom * Math.pow(2, -e.deltaY / 300), ax); this.savePrefs(); return; }
    if (this.prefs.waveZoom > 1 && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
      e.preventDefault();
      this.waveScroll = clamp(this.waveScroll + (e.deltaX || e.deltaY) / 1000, 0, 1);
      this.scrollIn.value = String(Math.round(this.waveScroll * 1000));
      this.invalidate('wave');
    }
  }
  pointerUp(e) {
    const g = this.g;
    if (!g || e.pointerId !== g.id) return;
    this.endGesture();
    if (g.kind === 'thumb') this.thumbUp(g);
  }
  // The browser took the pointer (a touch pan on the thumbnail strip, a system gesture): never reorder frames;
  // a wave/FFT stroke keeps what was drawn (one undo step restores the frame). gesture.js's two-finger cancel (a second
  // finger made it a pan / pinch, e.gesture === 'two-finger') undoes the stroke instead: cancelGesture.
  pointerCancel(e) {
    const g = this.g;
    if (!g || e.pointerId !== g.id) return;
    if (e.gesture === 'two-finger') this.cancelGesture(); else this.endGesture();
  }
  cancelGesture() {
    const g = this.g;
    if (!g) return;
    if (g.kind === 'wave' || g.kind === 'fft') { const t = this.undo.undo(this.table); if (t) { this.undo.r.pop(); this.table = t; this.sync(null); } }
    this.endGesture();
  }

  /* ------------------------------------------------------------ pointer: FFT area */
  fftGeom() {
    const r = this.fftCv.getBoundingClientRect(), w = r.width || 1, h = r.height || 1, gap = 6;
    const magH = Math.round((h - gap) * 0.62);
    return { r, w, h, magH, phTop: magH + gap, phH: h - magH - gap, n: this.prefs.binZoom };
  }
  fftHit(e) {
    const G = this.fftGeom(), x = e.clientX - G.r.left, y = e.clientY - G.r.top;
    const k = clamp(1 + Math.floor(x / G.w * G.n), 1, G.n), row = y < G.magH + 3 ? 'mag' : 'ph';
    const v = row === 'mag' ? clamp(1 - y / G.magH, 0, 1) * this.magRange : clamp(1 - (y - G.phTop) / G.phH, 0, 1);
    return { k, row, v, G };
  }
  spectrum() {
    const f = this.frame();
    if (this.specFor !== f) {
      if (this.g && this.g.kind === 'wave' && !this.liveFFT && this.spec) return this.spec;
      this.spec = wt.toSpectrum(f);
      this.specFor = f;
    }
    return this.spec;
  }
  fftDown(e) {
    this.ctxNudge = false;
    if (!this.table || e.button !== 0 || this.g) return;
    e.preventDefault();
    const hit = this.fftHit(e), L = this.latches();
    if (hit.row === 'ph' && ((e.shiftKey && (e.metaKey || e.ctrlKey)) || (L.shift && L.alt))) { // nudge this phase right
      this.nudge(hit.k);
      this.ctxNudge = !!e.ctrlKey; // macOS: a Ctrl-click also opens the context menu, which fftMenu then swallows
      this.consumeLatches();
      return;
    }
    this.capture(this.fftCv, e);
    const S = this.spectrum();
    this.beginGesture();
    this.g = { kind: 'fft', id: e.pointerId, frame: this.cur, row: hit.row, spec: { mag: Float64Array.from(S.mag), ph: Float64Array.from(S.ph), dc: S.dc }, lastK: hit.k, lastV: hit.v, range: this.magRange, thr: wt.emptyThreshold(S.mag) };
    this.fftPaint(hit.k, hit.v, e.shiftKey);
  }
  fftMove(e) {
    if (!this.table) return;
    const hit = this.fftHit(e), S = this.g && this.g.kind === 'fft' ? this.g.spec : this.spectrum();
    this.hover = { k: hit.k, row: hit.row };
    this.fftRead.textContent = 'H' + hit.k + ' ' + S.mag[hit.k - 1].toFixed(3) + ' · ' + Math.round(S.ph[hit.k - 1] * 100) + '%';
    if (!this.g || this.g.kind !== 'fft' || e.pointerId !== this.g.id) { this.invalidate('fft'); return; }
    this.fftPaint(hit.k, hit.v, e.shiftKey);
  }
  fftPaint(k, v, fine) {
    const g = this.g, arr = g.row === 'mag' ? g.spec.mag : g.spec.ph, range = g.row === 'mag' ? g.range : 1;
    const value = (kk, vv) => {
      let out = vv;
      if (this.snapQuarter) out = Math.round(out / range * 4) / 4 * range;
      if (g.row === 'mag' && this.scaleByBin) out = out * Math.sqrt(1 / kk) * Math.SQRT2;
      return clamp(out, 0, range);
    };
    const a = Math.min(g.lastK, k), b = Math.max(g.lastK, k);
    for (let kk = a; kk <= b; kk++) {
      const t = b > a ? (kk - g.lastK) / (k - g.lastK) : 1, vv = g.lastV + (v - g.lastV) * t, prev = arr[kk - 1];
      arr[kk - 1] = fine ? clamp(prev + (v - g.lastV) * 0.1, 0, range) : value(kk, vv);
      if (g.row === 'mag' && !(prev >= g.thr) && arr[kk - 1] >= g.thr) g.spec.ph[kk - 1] = 0.5; // new harmonic: sine phase
    }
    g.lastK = k; g.lastV = v;
    const f = wt.fromSpectrum(g.spec.mag, g.spec.ph, g.spec.dc);
    this.spec = { mag: g.spec.mag, ph: g.spec.ph, dc: g.spec.dc };
    this.specFor = f;
    this.setFrame(g.frame, f);
  }
  nudge(k) { // phase of harmonic k + 1/64 (Shift-Cmd/Ctrl-click, the touch latches, the phase row's menu item)
    const S0 = this.spectrum();
    if (S0.mag[k - 1] >= wt.emptyThreshold(S0.mag)) { this.fftOp('ph', 'nudgePhase', k); this.setMsg('Harmonic ' + k + ': phase ' + Math.round(this.spectrum().ph[k - 1] * 100) + '%'); }
    else this.setMsg('Harmonic ' + k + ' is empty: no phase to nudge');
  }
  fftMenu(e) {
    e.preventDefault();
    if (!this.table) return;
    const hit = this.fftHit(e), k = hit.k, row = hit.row;
    if (row === 'ph' && e.shiftKey && (e.ctrlKey || e.metaKey)) { // the nudge gesture, not the menu
      if (!this.ctxNudge && !this.g) this.nudge(k); // where Ctrl-click arrives as a right-button press only (no pointerdown nudge)
      this.ctxNudge = false;
      return;
    }
    this.ctxNudge = false;
    const lab = l => l.replace(/\bX\b/, String(k));
    const items = wt.FFT_OPS.map(o => ({ label: lab(o.label), action: () => this.fftOp(row, o.id, k) }));
    if (row === 'ph') { // §13.1: the menu equivalent of Shift-Cmd/Ctrl-click
      const S0 = this.spectrum();
      items.push({ sep: true }, { label: 'Nudge Phase Right (harmonic ' + k + ')', disabled: !(S0.mag[k - 1] >= wt.emptyThreshold(S0.mag)), action: () => this.nudge(k) });
    }
    items.push({ sep: true },
      { label: 'Snap vertical draw to quarters', checked: !!this.snapQuarter, action: () => { this.snapQuarter = this.snapQuarter ? 0 : 1; } },
      { label: 'Scale Freq Values by Bin Index', checked: !!this.scaleByBin, action: () => { this.scaleByBin = this.scaleByBin ? 0 : 1; } });
    wk.contextMenu(e.clientX, e.clientY, [{ label: (row === 'mag' ? 'Magnitudes' : 'Phases') + ' · harmonic ' + k, disabled: true }, { sep: true }].concat(items), { anchor: this.fftCv });
  }
  fftOp(row, id, k) {
    const S = this.spectrum(), next = wt.fftOp(S, row, id, { bin: k, seed: this.seed() });
    const frames = this.table.frames.slice();
    let f = wt.fromSpectrum(next.mag, next.ph, next.dc);
    if (id === 'repeatGroup') { // the repeated bins line up into a spike (+30…57 dB): back to max(1, the frame's peak)
      const lim = Math.max(1, peakAbs(frames[this.cur])), p = peakAbs(f);
      if (p > lim) { const g = lim / p; f = f.map(v => v * g); }
    }
    frames[this.cur] = f;
    this.commit({ name: this.table.name, frames, morph: this.table.morph, factory: 0 }, { frames: [this.cur] });
  }

  /* ------------------------------------------------------------ pointer: thumbnails */
  thumbAt(clientX) {
    const r = this.strip.getBoundingClientRect(), R = this.table ? this.table.frames.length : 1;
    return clamp(Math.floor((clientX - r.left + this.strip.scrollLeft) / TW), 0, R - 1);
  }
  gapAt(clientX) {
    const r = this.strip.getBoundingClientRect(), R = this.table.frames.length;
    return clamp(Math.round((clientX - r.left + this.strip.scrollLeft) / TW), 0, R);
  }
  thumbDown(e) {
    if (!this.table || e.button !== 0 || this.g) return;
    const k = this.thumbAt(e.clientX);
    this.strip.focus({ preventScroll: true });
    if (e.shiftKey || this.latches().shift) { // Shift (touch: the Shift latch) extends the selection
      this.consumeLatches();
      this.cur = k;
      this.sel = [Math.min(this.anchor, k), Math.max(this.anchor, k)];
      this.invalidate();
      return;
    }
    const inSel = k >= this.sel[0] && k <= this.sel[1] && this.sel[1] > this.sel[0];
    if (!inSel) this.setCur(k);
    this.capture(this.thCv, e);
    this.g = { kind: 'thumb', id: e.pointerId, k, x0: e.clientX, moved: false, range: this.sel.slice(), to: -1, click: inSel };
  }
  thumbMove(e) {
    const g = this.g;
    if (!g || g.kind !== 'thumb' || e.pointerId !== g.id) return;
    if (!g.moved && Math.abs(e.clientX - g.x0) > 4) g.moved = true;
    if (!g.moved) return;
    g.to = this.gapAt(e.clientX);
    const r = this.strip.getBoundingClientRect(); // auto-scroll near the edges
    if (e.clientX < r.left + 16) this.strip.scrollLeft -= 12;
    else if (e.clientX > r.right - 16) this.strip.scrollLeft += 12;
    this.invalidate('thumbs');
  }
  thumbUp(g) {
    if (g.moved && g.to >= 0) {
      const [a, b] = g.range;
      if (g.to < a || g.to > b + 1) this.runOp('add.move', { sel: [a, b], to: g.to, cur: this.cur });
    } else if (g.click) this.setCur(g.k);
  }

  /* ------------------------------------------------------------ rendering */
  colors() {
    const out = Object.assign({}, DEF_COL);
    try {
      const cs = this.win.getComputedStyle ? this.win.getComputedStyle(this.rootEl) : null;
      if (cs) for (const k of Object.keys(DEF_COL)) { const v = cs.getPropertyValue('--sx-' + k); if (v && v.trim()) out[k] = v.trim(); }
    } catch (err) { /* defaults */ }
    return out;
  }
  syncUi() {
    if (!this.rootEl) return;
    for (const b of this.toolBtns) {
      const on = b.dataset.tool === this.tool;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    }
    const t = this.table, R = t ? t.frames.length : 0;
    this.undoB.disabled = !this.undo.canUndo;
    this.redoB.disabled = !this.undo.canRedo;
    this.minusB.disabled = R < 2;
    this.plusB.disabled = !t || R >= MAXF;
    this.copyB.disabled = !t;
    this.pasteB.disabled = !t || R >= MAXF || !CLIP.frames.length;
    if (this.doc.activeElement !== this.fnum) this.fnum.value = t ? String(this.cur + 1) : '';
    this.fcount.textContent = t ? '/ ' + R + (t.morph ? ' · ' + ['', 'xfade', 'spectral', 'spec 0-fund', 'spec 0-all'][t.morph] : '') : '';
    this.scrollIn.disabled = this.prefs.waveZoom <= 1;
    if (this.grid$ && this.grid$.update) this.grid$.update();
    if (this.live$ && this.live$.update) this.live$.update();
    if (t && this.doc.activeElement !== this.nameIn) this.nameIn.value = t.name;
    this.nameIn.classList.toggle('wte-tint', !!t && / \*$/.test(t.name)); // an automatic copy, never saved by name
    if (t) this.sp.style.width = Math.max(R * TW, 1) + 'px';
  }
  invalidate(...parts) {
    if (this.closed) return;
    for (const p of parts.length ? parts : ['wave', 'fft', 'thumbs', 'ui']) this.dirty.add(p);
    const raf = this.win && this.win.requestAnimationFrame;
    if (!raf) { this.paint(); return; }
    if (!this.raf) this.raf = raf.call(this.win, () => { this.raf = 0; this.paint(); });
  }
  paint() {
    if (this.closed || !this.rootEl) return;
    const d = this.dirty;
    if (d.has('ui') || d.has('thumbs')) this.syncUi();
    if (this.table) {
      if (d.has('wave')) this.paintWave();
      if (d.has('fft')) this.paintFFT();
      if (d.has('thumbs')) this.paintThumbs();
    }
    d.clear();
  }
  fit(cv) {
    const r = cv.getBoundingClientRect(), dpr = Math.min(3, this.win.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d');
    if (!g) return null;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h };
  }
  paintWave() {
    const F = this.fit(this.waveCv);
    if (!F) return;
    const { g, w, h } = F, C = this.col, pad = 6, z = this.prefs.waveZoom, x0 = this.waveScroll * (1 - 1 / z), span = 1 / z;
    const X = f => (f - x0) / span * w, Y = v => pad + (1 - v) / 2 * (h - 2 * pad);
    g.fillStyle = C.panel; g.fillRect(0, 0, w, h);
    g.lineWidth = 1;
    g.strokeStyle = C.line;
    g.beginPath();
    for (const v of [-1, -0.5, 0.5, 1]) { g.moveTo(0, Math.round(Y(v)) + 0.5); g.lineTo(w, Math.round(Y(v)) + 0.5); }
    if (this.grid > 0) for (let c = 1; c < this.grid; c++) { const x = Math.round(X(c / this.grid)) + 0.5; if (x > 0 && x < w) { g.moveTo(x, 0); g.lineTo(x, h); } }
    g.stroke();
    g.strokeStyle = C.mute;
    g.beginPath(); g.moveTo(0, Math.round(Y(0)) + 0.5); g.lineTo(w, Math.round(Y(0)) + 0.5); g.stroke();
    const R = this.table.frames.length;
    if (R > 1) { // neighbour frame ghost
      g.globalAlpha = 0.25;
      this.trace(g, this.table.frames[this.cur > 0 ? this.cur - 1 : 1], X, Y, w, x0, span, C.mute);
      g.globalAlpha = 1;
    }
    this.trace(g, this.frame(), X, Y, w, x0, span, C.graph, 1.6);
    if (this.g && this.g.kind === 'wave' && this.grid > 0) {
      const [i0, i1] = wt.cellOf(this.g.last.x, this.grid);
      g.fillStyle = 'rgba(79,179,255,0.08)';
      g.fillRect(X(i0 / FRAME), 0, X(i1 / FRAME) - X(i0 / FRAME), h);
    }
  }
  trace(g, f, X, Y, w, x0, span, color, lw) {
    const i0 = Math.max(0, Math.floor(x0 * FRAME) - 1), i1 = Math.min(FRAME, Math.ceil((x0 + span) * FRAME) + 2), n = i1 - i0;
    g.strokeStyle = color;
    g.lineWidth = lw || 1;
    g.beginPath();
    if (n > w * 2) { // min/max per pixel column
      for (let px = 0; px < w; px++) {
        const a = Math.floor(i0 + px / w * n), b = Math.max(a + 1, Math.floor(i0 + (px + 1) / w * n));
        let lo = Infinity, hi = -Infinity;
        for (let i = a; i < b && i < FRAME; i++) { const v = f[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        if (px === 0) g.moveTo(px + 0.5, Y(hi)); else g.lineTo(px + 0.5, Y(hi));
        g.lineTo(px + 0.5, Y(lo));
      }
    } else {
      for (let i = i0; i < i1; i++) { const x = X(i / FRAME), y = Y(f[Math.min(FRAME - 1, i)]); if (i === i0) g.moveTo(x, y); else g.lineTo(x, y); }
    }
    g.stroke();
  }
  paintFFT() {
    const F = this.fit(this.fftCv);
    if (!F) return;
    const { g, w, h } = F, C = this.col, S = this.g && this.g.kind === 'fft' ? this.g.spec : this.spectrum(), n = this.prefs.binZoom;
    const gap = 6, magH = Math.round((h - gap) * 0.62), phTop = magH + gap, phH = h - phTop;
    let mx = 1;
    for (let k = 0; k < 1024; k++) if (S.mag[k] > mx) mx = S.mag[k];
    if (!(this.g && this.g.kind === 'fft')) this.magRange = mx;
    const range = this.g && this.g.kind === 'fft' ? this.g.range : this.magRange;
    g.fillStyle = C.panel; g.fillRect(0, 0, w, h);
    g.fillStyle = C.panel2; g.fillRect(0, phTop, w, phH);
    const bw = w / n, inner = Math.max(1, bw - (bw > 3 ? 1 : 0));
    if (this.hover) { g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect((this.hover.k - 1) * bw, 0, bw, h); }
    g.fillStyle = C.graph;
    for (let k = 1; k <= n; k++) {
      const v = Math.min(1, S.mag[k - 1] / range);
      if (v > 0.001) g.fillRect((k - 1) * bw, magH * (1 - v), inner, magH * v);
    }
    const mid = phTop + phH / 2;
    g.strokeStyle = C.line;
    g.beginPath(); g.moveTo(0, Math.round(mid) + 0.5); g.lineTo(w, Math.round(mid) + 0.5); g.stroke();
    g.fillStyle = C.accent;
    for (let k = 1; k <= n; k++) {
      if (S.mag[k - 1] < 1e-6) continue;
      const y = phTop + (1 - S.ph[k - 1]) * phH;
      g.fillRect((k - 1) * bw, Math.min(y, mid), inner, Math.max(1, Math.abs(y - mid)));
    }
    g.fillStyle = C.mute;
    g.font = '10px ' + 'ui-monospace, monospace';
    g.textBaseline = 'top';
    g.fillText('max ' + range.toFixed(2), 4, 2);
    g.fillText(String(n), Math.max(4, w - 24), 2);
  }
  paintThumbs() {
    const st = this.strip, cv = this.thCv, R = this.table.frames.length;
    const vw = Math.max(1, st.clientWidth || Math.round(st.getBoundingClientRect().width) || 1);
    cv.style.left = st.scrollLeft + 'px';
    cv.style.width = vw + 'px';
    const F = this.fit(cv);
    if (!F) return;
    const { g, w, h } = F, C = this.col, sl = st.scrollLeft, k0 = Math.max(0, Math.floor(sl / TW)), k1 = Math.min(R - 1, Math.ceil((sl + w) / TW));
    g.fillStyle = C.panel; g.fillRect(0, 0, w, h);
    g.font = '9px ui-monospace, monospace';
    g.textBaseline = 'bottom';
    for (let k = k0; k <= k1; k++) {
      const x = k * TW - sl, f = this.table.frames[k], inSel = k >= this.sel[0] && k <= this.sel[1];
      g.fillStyle = inSel && this.sel[1] > this.sel[0] ? 'rgba(79,179,255,0.18)' : C.panel2;
      g.fillRect(x + 1, 1, TW - 2, h - 2);
      g.strokeStyle = k === this.cur ? C.cur : inSel && this.sel[1] > this.sel[0] ? C.accent : C.line;
      g.lineWidth = k === this.cur ? 2 : 1;
      g.strokeRect(x + 1.5, 1.5, TW - 3, h - 3);
      const th = h - 14, ty = 3;
      g.strokeStyle = k === this.cur ? C.cur : C.graph;
      g.lineWidth = 1;
      g.beginPath();
      for (let px = 0; px < TW - 6; px++) {
        const i = Math.floor(px / (TW - 6) * FRAME), y = ty + (1 - clamp(f[i], -1, 1)) / 2 * th;
        if (px === 0) g.moveTo(x + 3 + px, y); else g.lineTo(x + 3 + px, y);
      }
      g.stroke();
      g.fillStyle = k === this.cur ? C.cur : C.mute;
      g.fillText(thumbLabel(this.table, k), x + 4, h - 2);
    }
    if (this.g && this.g.kind === 'thumb' && this.g.moved && this.g.to >= 0) { // yellow insertion cursor
      g.fillStyle = C.cur;
      g.fillRect(this.g.to * TW - sl - 1, 0, 3, h);
    }
  }
}

function peakAbs(f) { let p = 0; for (let i = 0; i < f.length; i++) { const v = Math.abs(f[i]); if (v > p) p = v; } return p; }
function nameOfId(id) { return String(id || '').replace(/^(factory|sub|user|nzuser|noise):/, '') || 'Wavetable'; }
function readText(f) {
  if (f && typeof f.text === 'function') return f.text();
  if (f && typeof f.arrayBuffer === 'function') return f.arrayBuffer().then(b => new TextDecoder().decode(b));
  return Promise.resolve('');
}
